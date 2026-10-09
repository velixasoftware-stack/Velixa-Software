const { Op } = require('sequelize');
const {
  Sample, BillItem, TestMaster, ParameterMaster, ParameterNormalRange, Result, Report, Bill, Patient, Client,
  ReferralDoctor, Payor, ClientUser,
} = require('../models');
const { buildParameterInsight } = require('../utils/trendInsights');
const { resolveNormalRange } = require('../utils/normalRange');
const { sendEmail, sendWhatsApp } = require('../utils/notify');
const { sortParameters, sortResultsByParameter } = require('../utils/parameterOrder');

// A client doing result entry sees every universal parameter plus whatever
// parameters it added for itself for that test - never another client's own.
// Also includes parameters *assigned* to the test from elsewhere (see
// TestMaster.AssignedParameters in models/index.js) - merged into
// ParameterMasters by withResolvedRanges below, so result entry shows them
// exactly like the test's own parameters.
function buildSampleIncludes(clientId) {
  const paramWhere = { [Op.or]: [{ clientId: null }, { clientId }] };
  return [
    {
      model: BillItem,
      include: [
        {
          model: TestMaster,
          include: [
            { model: ParameterMaster, where: paramWhere, required: false },
            { model: ParameterMaster, as: 'AssignedParameters', where: paramWhere, required: false, through: { attributes: [] } },
          ],
        },
        { model: Bill, include: [Patient] },
      ],
    },
    Report,
    { model: Result, include: [ParameterMaster] },
  ];
}

// Deliberately NOT eager-loaded via a nested Sequelize `include` anywhere in
// this file - at 3+ levels of nesting (e.g. Sample->BillItem->TestMaster->
// ParameterMaster->ParameterNormalRange), Postgres's 63-byte identifier limit
// truncates the long generated join aliases, and Sequelize then maps the
// truncated columns back onto the wrong/colliding attribute names, silently
// corrupting the nested rows. Fetching ranges with their own flat query and
// attaching them in JS sidesteps that entirely.
async function attachNormalRanges(parameterMasters) {
  const ids = [...new Set(parameterMasters.map((p) => p.id))];
  if (ids.length === 0) return;
  const ranges = await ParameterNormalRange.findAll({ where: { parameterId: ids } });
  const byParamId = new Map();
  for (const r of ranges) {
    const list = byParamId.get(r.parameterId) || [];
    list.push(r.toJSON ? r.toJSON() : r);
    byParamId.set(r.parameterId, list);
  }
  for (const p of parameterMasters) {
    p.ParameterNormalRanges = byParamId.get(p.id) || [];
  }
}

/**
 * Overrides every parameter's flat normalRangeLow/High in a sample's JSON
 * with the range resolved for this sample's own patient (age/gender), so
 * callers (result entry UI, isOutOfRange) never need their own age/gender
 * matching logic - they just read normalRangeLow/High as before.
 */
async function withResolvedRanges(sampleJson) {
  const patient = sampleJson.BillItem?.Bill?.Patient;
  const age = patient?.age;
  const gender = patient?.gender;
  const ageUnit = patient?.ageUnit;

  const testMaster = sampleJson.BillItem?.TestMaster;
  if (testMaster) {
    const owned = testMaster.ParameterMasters || [];
    const ownedIds = new Set(owned.map((p) => p.id));
    const assigned = (testMaster.AssignedParameters || []).filter((p) => !ownedIds.has(p.id));
    testMaster.ParameterMasters = sortParameters([...owned, ...assigned]);
    delete testMaster.AssignedParameters;
  }

  const params = sampleJson.BillItem?.TestMaster?.ParameterMasters;
  if (Array.isArray(params) && params.length > 0) {
    await attachNormalRanges(params);
    for (const p of params) {
      const resolved = resolveNormalRange(p, age, gender, ageUnit);
      p.normalRangeLow = resolved.normalRangeLow;
      p.normalRangeHigh = resolved.normalRangeHigh;
    }
  }
  return sampleJson;
}

// GET /api/lab/samples?status=PENDING_COLLECTION
async function listSamples(req, res) {
  const { clientId } = req.user;
  const { status } = req.query;
  const where = { clientId };
  if (status) where.status = status;

  const samples = await Sample.findAll({ where, include: buildSampleIncludes(clientId), order: [['createdAt', 'DESC']] });
  const withRanges = await Promise.all(samples.map((s) => withResolvedRanges(s.toJSON())));
  return res.json(withRanges);
}

// GET /api/lab/samples/:id
async function getSample(req, res) {
  const { clientId } = req.user;
  const sample = await Sample.findOne({ where: { id: req.params.id, clientId }, include: buildSampleIncludes(clientId) });
  if (!sample) return res.status(404).json({ message: 'Sample not found' });
  return res.json(await withResolvedRanges(sample.toJSON()));
}

// POST /api/lab/samples/:id/collect
async function collectSample(req, res) {
  const { clientId } = req.user;
  const sample = await Sample.findOne({ where: { id: req.params.id, clientId } });
  if (!sample) return res.status(404).json({ message: 'Sample not found' });
  if (sample.status !== 'PENDING_COLLECTION') {
    return res.status(400).json({ message: `Sample already ${sample.status}` });
  }

  await sample.update({ status: 'COLLECTED', collectedAt: new Date() });
  return res.json(sample);
}

// Parameters are optional at result entry - one left blank has no value to
// print, compare or share, so it is skipped everywhere a result is read back.
function hasValue(r) {
  return r.value != null && r.value.toString().trim() !== '';
}

function isOutOfRange(value, low, high) {
  const v = Number(value);
  if (Number.isNaN(v) || low == null || high == null) return false;
  const l = Number(low);
  const h = Number(high);
  if (Number.isNaN(l) || Number.isNaN(h)) return false;
  return v < l || v > h;
}

// POST /api/lab/samples/:id/results  { results: [{ parameterId, value }], remarks?, remarksBig? }
// Allowed up to and including VERIFIED - editing an already-verified result
// moves the sample back to RESULT_ENTERED, since a value change invalidates
// the earlier verification and it must be re-verified before release.
// remarks (optional free text, printed on the report under "Remarks") is saved
// alongside; omitting it leaves any existing remarks untouched.
async function enterResults(req, res) {
  const { clientId } = req.user;
  const { results = [], remarks, remarksBig } = req.body;
  if (!Array.isArray(results) || (results.length === 0 && remarks === undefined)) {
    return res.status(400).json({ message: 'results array is required' });
  }

  const sample = await Sample.findOne({
    where: { id: req.params.id, clientId },
    include: [Report, { model: BillItem, include: [{ model: Bill, include: [Patient] }] }],
  });
  if (!sample) return res.status(404).json({ message: 'Sample not found' });
  if (!['COLLECTED', 'RESULT_ENTERED', 'VERIFIED'].includes(sample.status)) {
    return res.status(400).json({ message: 'Sample must be collected before entering results' });
  }

  const patient = sample.BillItem?.Bill?.Patient;

  for (const r of results) {
    const parameter = await ParameterMaster.findByPk(r.parameterId, { include: [ParameterNormalRange] });
    if (!parameter) continue;
    const range = resolveNormalRange(parameter, patient?.age, patient?.gender, patient?.ageUnit);
    const isAbnormal = isOutOfRange(r.value, range.normalRangeLow, range.normalRangeHigh);

    const [record] = await Result.findOrCreate({
      where: { sampleId: sample.id, parameterId: r.parameterId },
      defaults: { value: r.value, isAbnormal },
    });
    if (record.value !== r.value) await record.update({ value: r.value, isAbnormal });
  }

  const update = { status: 'RESULT_ENTERED' };
  if (remarks !== undefined) {
    update.remarks = remarks?.toString().trim() || null;
    update.remarksBig = !!remarksBig;
  }
  await sample.update(update);
  if (sample.Report.status !== 'PENDING') {
    await sample.Report.update({ status: 'PENDING', verifiedAt: null });
  }
  return res.json({ message: 'Results saved' });
}

// POST /api/lab/samples/:id/verify
async function verifySample(req, res) {
  const { clientId } = req.user;
  const sample = await Sample.findOne({ where: { id: req.params.id, clientId }, include: [Report] });
  if (!sample) return res.status(404).json({ message: 'Sample not found' });
  if (sample.status !== 'RESULT_ENTERED') {
    return res.status(400).json({ message: 'Results must be entered before verification' });
  }

  await sample.update({ status: 'VERIFIED' });
  await sample.Report.update({ status: 'VERIFIED', verifiedAt: new Date() });
  return res.json({ message: 'Sample verified' });
}

// POST /api/lab/samples/:id/release
async function releaseSample(req, res) {
  const { clientId } = req.user;
  const sample = await Sample.findOne({
    where: { id: req.params.id, clientId },
    include: [Report, { model: BillItem, include: [Bill] }],
  });
  if (!sample) return res.status(404).json({ message: 'Sample not found' });
  if (sample.status !== 'VERIFIED') {
    return res.status(400).json({ message: 'Sample must be verified before release' });
  }
  const dueAmount = Number(sample.BillItem?.Bill?.dueAmount || 0);
  if (dueAmount > 0) {
    return res.status(400).json({
      message: `This bill has ₹${dueAmount.toFixed(2)} still due - collect it (Orders > Due Payment) before releasing the report.`,
    });
  }

  await sample.update({ status: 'RELEASED' });
  await sample.Report.update({ status: 'RELEASED', releasedAt: new Date(), releasedByUserId: req.user.id });
  return res.json({ message: 'Report released' });
}

// PUT /api/lab/samples/:id/revoke  Body: { reason }
// Undoes a release (e.g. a mistake was found after the fact) - the report is
// never deleted, just stamped as revoked, and the sample rolls back to
// VERIFIED so results can be corrected and it can go through release again.
async function revokeReport(req, res) {
  const { clientId } = req.user;
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ message: 'A reason is required to revoke a released report' });

  const sample = await Sample.findOne({ where: { id: req.params.id, clientId }, include: [Report] });
  if (!sample) return res.status(404).json({ message: 'Sample not found' });
  if (sample.status !== 'RELEASED') {
    return res.status(400).json({ message: 'Only a released report can be revoked' });
  }

  await sample.update({ status: 'VERIFIED' });
  await sample.Report.update({ status: 'REVOKED', revokedAt: new Date(), revokedReason: reason.trim() });
  return res.json({ message: 'Report revoked' });
}

// GET /api/lab/bills/:billId/report
// A single consolidated report covering every RELEASED test on this bill -
// a patient with several tests on one visit gets one combined report, and
// tests not yet released simply aren't included until they are.
async function getBillReport(req, res) {
  const { clientId } = req.user;
  const bill = await Bill.findOne({ where: { id: req.params.billId, clientId }, include: [Patient, Client, ReferralDoctor, Payor] });
  if (!bill) return res.status(404).json({ message: 'Bill not found' });

  const samples = await Sample.findAll({
    where: { clientId },
    include: [
      { model: BillItem, where: { billId: bill.id }, include: [TestMaster] },
      { model: Report, include: [{ model: ClientUser, as: 'ReleasedByUser', attributes: ['name', 'username', 'designation', 'signaturePath', 'signatureName'] }] },
      { model: Result, include: [ParameterMaster] },
    ],
  });
  const releasedSamples = samples.filter((s) => s.status === 'RELEASED');
  if (releasedSamples.length === 0) {
    return res.status(404).json({ message: 'No released reports for this bill yet' });
  }

  const age = bill.Patient?.age;
  const gender = bill.Patient?.gender;
  const ageUnit = bill.Patient?.ageUnit;
  await attachNormalRanges(releasedSamples.flatMap((s) => s.Results.map((r) => r.ParameterMaster)));

  // One signature printed per report, even though a bill can have several
  // released tests - whoever released the most recent one represents it.
  // Only a user who has actually set up a signature (via Report Branding)
  // shows one; otherwise the report footer prints with no signature, same as
  // before this feature existed.
  const latestReleased = [...releasedSamples].sort((a, b) => new Date(b.Report.releasedAt) - new Date(a.Report.releasedAt))[0];
  const releasedByUser = latestReleased?.Report?.ReleasedByUser;
  const doctor = releasedByUser?.signaturePath
    ? {
        name: releasedByUser.signatureName || releasedByUser.name || releasedByUser.username,
        designation: releasedByUser.designation,
        signatureUrl: releasedByUser.signaturePath,
      }
    : null;

  return res.json({
    doctor,
    bill: {
      id: bill.id, billNo: bill.billNo, createdAt: bill.createdAt, walkInDate: bill.walkInDate,
      referredDoctor: bill.ReferralDoctor?.name || null,
      payor: bill.Payor?.name || null,
    },
    patient: bill.Patient,
    // Branding details (set from Report Branding) shown on the report -
    // separate from clientName/address/mobile/email Chief Admin set at
    // client creation, falling back to those until this client sets its own.
    client: {
      clientName: bill.Client.brandingName || bill.Client.clientName,
      address: bill.Client.brandingAddress || bill.Client.address,
      mobile: bill.Client.brandingMobile || bill.Client.mobile,
      email: bill.Client.brandingEmail || bill.Client.email,
      logoUrl: bill.Client.reportLogoPath,
      letterheadUrl: bill.Client.reportLetterheadPath,
    },
    tests: releasedSamples.map((s) => ({
      testName: s.BillItem.TestMaster.testName,
      testCode: s.BillItem.TestMaster.testCode,
      interpretation: s.BillItem.TestMaster.interpretation,
      barcode: s.barcode,
      collectedAt: s.collectedAt,
      releasedAt: s.Report.releasedAt,
      remarks: s.remarks || null,
      remarksBig: s.remarksBig,
      parameters: sortResultsByParameter(s.Results.filter(hasValue)).map((r) => {
        const range = resolveNormalRange(r.ParameterMaster, age, gender, ageUnit);
        return {
          parameterCode: r.ParameterMaster.parameterCode,
          parameterName: r.ParameterMaster.parameterName,
          value: r.value,
          unit: r.ParameterMaster.unit,
          normalRangeLow: range.normalRangeLow,
          normalRangeHigh: range.normalRangeHigh,
          isAbnormal: r.isAbnormal,
          isInterpretation: r.ParameterMaster.isInterpretation,
        };
      }),
    })),
  });
}

// POST /api/report-view/bills/:billId/report/share  Body: { channel: 'whatsapp' | 'email', to? }
// `to` defaults to the patient's own mobile/email on file. Sends a text/HTML
// summary of released results, not a copy of the printed report - sendWhatsApp/
// sendEmail don't support attachments today (see utils/notify.js).
async function shareReport(req, res) {
  const { clientId } = req.user;
  const { channel, to } = req.body;
  if (channel !== 'whatsapp' && channel !== 'email') {
    return res.status(400).json({ message: 'channel must be "whatsapp" or "email"' });
  }

  const bill = await Bill.findOne({ where: { id: req.params.billId, clientId }, include: [Patient, Client] });
  if (!bill) return res.status(404).json({ message: 'Bill not found' });

  const samples = await Sample.findAll({
    where: { clientId, status: 'RELEASED' },
    include: [
      { model: BillItem, where: { billId: bill.id }, include: [TestMaster] },
      Report,
      { model: Result, include: [ParameterMaster] },
    ],
  });
  if (samples.length === 0) return res.status(404).json({ message: 'No released reports for this bill yet' });

  const age = bill.Patient?.age;
  const gender = bill.Patient?.gender;
  const ageUnit = bill.Patient?.ageUnit;
  await attachNormalRanges(samples.flatMap((s) => s.Results.map((r) => r.ParameterMaster)));

  const lines = samples.map((s) => {
    const testLine = `${s.BillItem.TestMaster.testName}:`;
    const paramLines = sortResultsByParameter(s.Results.filter(hasValue)).map((r) => {
      if (r.ParameterMaster.isInterpretation) {
        return `  ${r.ParameterMaster.parameterName}: ${r.value}`;
      }
      const range = resolveNormalRange(r.ParameterMaster, age, gender, ageUnit);
      const flag = r.isAbnormal ? ' (abnormal)' : '';
      return `  ${r.ParameterMaster.parameterName}: ${r.value} ${r.ParameterMaster.unit || ''} (Normal: ${range.normalRangeLow}-${range.normalRangeHigh})${flag}`;
    }).join('\n');
    const remarksLine = s.remarks ? `\n  Remarks: ${s.remarks.replace(/\t/g, ' | ')}` : '';
    return `${testLine}\n${paramLines}${remarksLine}`;
  }).join('\n\n');

  if (channel === 'whatsapp') {
    const mobile = to || bill.Patient?.mobile;
    if (!mobile) return res.status(400).json({ message: "No mobile number on file for this patient - provide 'to'" });
    const result = await sendWhatsApp({
      to: mobile,
      message: `Hi ${bill.Patient?.name || ''}, here is your lab report from ${bill.Client.clientName}.\n\n${lines}\n\nThank you!`,
    });
    return res.json(result);
  }

  const email = to || bill.Patient?.email;
  if (!email) return res.status(400).json({ message: "No email on file for this patient - provide 'to'" });
  const result = await sendEmail({
    to: email,
    subject: `Your lab report from ${bill.Client.clientName} - Bill ${bill.billNo}`,
    html: `<p>Hi ${bill.Patient?.name || ''},</p><p>Here is your lab report from ${bill.Client.clientName}.</p><pre>${lines}</pre><p>Thank you!</p>`,
  });
  return res.json(result);
}

/** Every past RELEASED value this patient has for one parameter, oldest first. */
async function getPatientParameterHistory(clientId, patientId, parameterId) {
  const results = await Result.findAll({
    where: { parameterId },
    include: [
      {
        model: Sample,
        required: true,
        where: { clientId, status: 'RELEASED' },
        include: [
          { model: BillItem, required: true, include: [{ model: Bill, required: true, where: { patientId } }] },
          { model: Report, required: true },
        ],
      },
    ],
  });

  return results
    .filter(hasValue)
    .map((r) => ({ date: r.Sample.Report.releasedAt, value: r.value, isAbnormal: r.isAbnormal }))
    .filter((r) => r.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

const PENDING_STATUS_LABEL = {
  PENDING_COLLECTION: 'Pending collection',
  COLLECTED: 'Collected',
  RESULT_ENTERED: 'Result entered',
  VERIFIED: 'Verified',
};

// GET /api/report-view/pending-tests?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=xlsx]
// Every test still in progress - from registration (billing) up to, but not
// including, report release - for the client's pending worklist. Filtered by
// the bill's walk-in date; cancelled tests are left out. format=xlsx returns
// the same rows as an Excel download instead of JSON.
async function getPendingTests(req, res) {
  const { clientId } = req.user;
  const { from, to, format, status, q } = req.query;
  const billWhere = {};
  if (from || to) {
    billWhere.walkInDate = {};
    if (from) billWhere.walkInDate[Op.gte] = from;
    if (to) billWhere.walkInDate[Op.lte] = to;
  }

  const samples = await Sample.findAll({
    where: {
      clientId,
      status: { [Op.in]: PENDING_STATUS_LABEL[status] ? [status] : Object.keys(PENDING_STATUS_LABEL) },
    },
    include: [{
      model: BillItem,
      required: true,
      where: { status: 'ACTIVE' },
      include: [
        TestMaster,
        { model: Bill, required: true, where: billWhere, include: [Patient] },
      ],
    }],
    order: [['id', 'DESC']],
  });

  // Optional free-text search (same fields the screen searches), so an export
  // contains exactly the rows on screen.
  const needle = (q || '').toString().trim().toLowerCase();
  const rows = samples.map((s) => {
    const bill = s.BillItem.Bill;
    return {
      sampleId: s.id,
      patientName: bill.Patient?.name || '',
      age: bill.Patient?.age ?? null,
      ageUnit: bill.Patient?.ageUnit || 'Years',
      gender: bill.Patient?.gender || '',
      mobile: bill.Patient?.mobile || '',
      barcode: s.barcode,
      billNo: bill.billNo,
      umr: bill.Patient?.umr || '',
      testName: s.BillItem.TestMaster?.testName || '',
      status: s.status,
      statusLabel: PENDING_STATUS_LABEL[s.status],
      priority: bill.priority || 'ROUTINE',
      walkInDate: bill.walkInDate,
      registeredAt: bill.createdAt,
      updatedAt: s.updatedAt,
    };
  }).filter((r) => !needle || [r.patientName, r.barcode, r.billNo, r.umr, r.testName, r.mobile]
    .some((f) => (f || '').toString().toLowerCase().includes(needle)));

  if (format === 'xlsx') {
    const XLSX = require('xlsx');
    const sheet = XLSX.utils.json_to_sheet(rows.map((r) => ({
      'Patient Name': r.patientName,
      Barcode: r.barcode,
      'Bill No': r.billNo,
      'UMR No': r.umr,
      'Test Name': r.testName,
      'Test Status': r.statusLabel,
      'Walk-in Date': r.walkInDate,
      Priority: r.priority,
      Mobile: r.mobile,
    })));
    sheet['!cols'] = [{ wch: 24 }, { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 28 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 13 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Pending Tests');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="pending-tests_${from || 'all'}_to_${to || 'all'}.xlsx"`);
    return res.send(buffer);
  }
  return res.json(rows);
}

// GET /api/lab/bills/:billId/previous-results
// For delta checks during result entry: this patient's most recent RELEASED
// value of each parameter on this bill, taken from any *earlier* bill (never
// this one). Shape: { [parameterId]: { value, date, isAbnormal, billNo } }.
async function getPreviousResults(req, res) {
  const { clientId } = req.user;
  const bill = await Bill.findOne({ where: { id: req.params.billId, clientId } });
  if (!bill) return res.status(404).json({ message: 'Bill not found' });

  const items = await BillItem.findAll({
    where: { billId: bill.id },
    include: [{ model: TestMaster, include: [ParameterMaster] }],
  });
  const parameterIds = [...new Set(items.flatMap((i) => (i.TestMaster?.ParameterMasters || [])
    .filter((p) => !p.isInterpretation).map((p) => p.id)))];
  if (parameterIds.length === 0) return res.json({});

  const results = await Result.findAll({
    where: { parameterId: parameterIds },
    include: [{
      model: Sample,
      required: true,
      where: { clientId, status: 'RELEASED' },
      include: [
        { model: BillItem, required: true, include: [{ model: Bill, required: true, where: { patientId: bill.patientId, id: { [Op.ne]: bill.id } } }] },
        { model: Report, required: true },
      ],
    }],
  });

  const latest = {};
  for (const r of results) {
    const date = r.Sample.Report.releasedAt;
    if (!date || !hasValue(r)) continue;
    const prev = latest[r.parameterId];
    if (!prev || new Date(date) > new Date(prev.date)) {
      latest[r.parameterId] = { value: r.value, date, isAbnormal: r.isAbnormal, billNo: r.Sample.BillItem.Bill.billNo };
    }
  }
  return res.json(latest);
}

// GET /api/lab/bills/:billId/trend  ("AI Report" - each parameter on this bill
// compared against this same patient's own history of that same parameter,
// with a short rule-based interpretation of the trend).
async function getBillTrendReport(req, res) {
  const { clientId } = req.user;
  const bill = await Bill.findOne({ where: { id: req.params.billId, clientId }, include: [Patient] });
  if (!bill) return res.status(404).json({ message: 'Bill not found' });

  const samples = await Sample.findAll({
    where: { clientId, status: 'RELEASED' },
    include: [
      { model: BillItem, where: { billId: bill.id }, include: [TestMaster] },
      Report,
      { model: Result, include: [ParameterMaster] },
    ],
  });
  if (samples.length === 0) {
    return res.status(404).json({ message: 'No released reports for this bill yet' });
  }
  await attachNormalRanges(samples.flatMap((s) => s.Results.map((r) => r.ParameterMaster)));

  const parameters = [];
  for (const sample of samples) {
    for (const result of sortResultsByParameter([...sample.Results])) {
      const param = result.ParameterMaster;
      if (param.isInterpretation) continue; // a trend/sparkline over free text is meaningless
      if (!hasValue(result)) continue; // left blank at entry - nothing to trend
      const history = await getPatientParameterHistory(clientId, bill.patientId, param.id);
      const range = resolveNormalRange(param, bill.Patient?.age, bill.Patient?.gender, bill.Patient?.ageUnit);
      parameters.push({
        testName: sample.BillItem.TestMaster.testName,
        parameterCode: param.parameterCode,
        parameterName: param.parameterName,
        unit: param.unit,
        normalRangeLow: range.normalRangeLow,
        normalRangeHigh: range.normalRangeHigh,
        history,
        insight: buildParameterInsight(history),
      });
    }
  }

  return res.json({
    patient: { name: bill.Patient.name, umr: bill.Patient.umr },
    parameters,
  });
}

module.exports = {
  listSamples, getSample, collectSample, enterResults, verifySample, releaseSample, revokeReport, getBillReport, getBillTrendReport, shareReport,
  getPreviousResults, getPendingTests,
};
