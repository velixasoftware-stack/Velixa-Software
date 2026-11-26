const { Op } = require('sequelize');
const XLSX = require('xlsx');
const {
  sequelize, ReferralDoctor, Bill, BillItem, TestMaster, Patient, ClientTestPrice,
  DoctorCommissionRate, CommissionStatement, CommissionStatementLine,
} = require('../models');

/**
 * Referral doctor commission (client side, Manager screen).
 *
 * Billing is untouched - the patient pays the normal price. Commission is
 * worked out afterwards from the bills a doctor referred:
 *   test's billed price x (1 - bill discount / bill total)  = its net amount
 *   PERCENT rate -> net x rate %,  FIXED rate -> ₹ rate per test
 * using the doctor's own rate for that test, else the doctor's default.
 * Cancelled tests and bills with no doctor / "Self" never earn commission.
 * A week's or month's commission is generated into one statement per doctor;
 * each billed test can be in only one statement (unique billItemId).
 */

const IST_OFFSET_MS = 330 * 60 * 1000;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const isSelf = (name) => /^\s*(dr\.?\s*)?self\s*$/i.test(name || '');
const RATE_TYPES = ['PERCENT', 'FIXED'];

/** "YYYY-MM-DD" (IST calendar days, both inclusive) -> UTC range for createdAt. */
function istRange(from, to) {
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  if (!ok(from) || !ok(to) || from > to) return null;
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 24 * 60 * 60 * 1000);
  return { [Op.gte]: start, [Op.lt]: end };
}
const istDate = (d) => new Date(new Date(d).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** { default: {rateType, rate} | null, byTest: Map(testId -> {rateType, rate}) } per doctor id. */
async function ratesFor(clientId, doctorIds, transaction) {
  const rows = doctorIds.length
    ? await DoctorCommissionRate.findAll({ where: { clientId, doctorId: doctorIds }, transaction })
    : [];
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.doctorId)) map.set(r.doctorId, { default: null, byTest: new Map() });
    const entry = { rateType: r.rateType, rate: Number(r.rate) };
    if (r.testId == null) map.get(r.doctorId).default = entry;
    else map.get(r.doctorId).byTest.set(r.testId, entry);
  }
  return map;
}

function commissionFor(rate, netAmount) {
  if (!rate || !(rate.rate > 0) || !(netAmount > 0)) return 0;
  return rate.rateType === 'FIXED' ? round2(rate.rate) : round2((netAmount * rate.rate) / 100);
}

/**
 * Commission lines not yet in any statement, for bills made in [from, to]
 * (IST), grouped by doctor. doctorIds limits it to those doctors.
 */
async function pendingCommission(clientId, from, to, { doctorIds = null, transaction } = {}) {
  const range = istRange(from, to);
  if (!range) return null;
  const bills = await Bill.findAll({
    where: {
      clientId, createdAt: range,
      referredDoctorId: doctorIds ? doctorIds : { [Op.ne]: null },
    },
    include: [
      { model: ReferralDoctor, attributes: ['id', 'name'] },
      { model: Patient, attributes: ['name'] },
      { model: BillItem, attributes: ['id', 'price', 'status', 'testId'], include: [{ model: TestMaster, attributes: ['id', 'testCode', 'testName'] }] },
    ],
    order: [['createdAt', 'ASC']],
    transaction,
  });
  const useful = bills.filter((b) => b.ReferralDoctor && !isSelf(b.ReferralDoctor.name));
  const itemIds = useful.flatMap((b) => (b.BillItems || []).map((i) => i.id));
  const settled = new Set(itemIds.length
    ? (await CommissionStatementLine.findAll({ where: { billItemId: itemIds }, attributes: ['billItemId'], transaction })).map((l) => l.billItemId)
    : []);
  const rates = await ratesFor(clientId, [...new Set(useful.map((b) => b.ReferralDoctor.id))], transaction);

  const doctors = new Map();
  for (const b of useful) {
    const total = Number(b.totalAmount) || 0;
    const factor = total > 0 ? Math.max(0, Math.min(1, 1 - (Number(b.discount) || 0) / total)) : 0;
    const docRates = rates.get(b.ReferralDoctor.id);
    for (const item of b.BillItems || []) {
      if (item.status === 'CANCELLED' || settled.has(item.id)) continue;
      const rate = docRates?.byTest.get(item.testId) || docRates?.default || null;
      const netAmount = round2(Number(item.price) * factor);
      const commission = commissionFor(rate, netAmount);
      if (commission <= 0) continue; // no rate set for this doctor/test - nothing to pay
      if (!doctors.has(b.ReferralDoctor.id)) {
        doctors.set(b.ReferralDoctor.id, { doctorId: b.ReferralDoctor.id, doctorName: b.ReferralDoctor.name, lines: [] });
      }
      doctors.get(b.ReferralDoctor.id).lines.push({
        billItemId: item.id, billId: b.id, billNo: b.billNo, billDate: b.createdAt, patientName: b.Patient?.name || '',
        testCode: item.TestMaster?.testCode || '', testName: item.TestMaster?.testName || '',
        price: round2(item.price), netAmount, rateType: rate.rateType, rate: rate.rate, commission,
      });
    }
  }
  return [...doctors.values()].map((d) => ({
    ...d,
    billCount: new Set(d.lines.map((l) => l.billId)).size,
    testCount: d.lines.length,
    totalAmount: round2(d.lines.reduce((s, l) => s + l.netAmount, 0)),
    totalCommission: round2(d.lines.reduce((s, l) => s + l.commission, 0)),
  })).sort((a, b) => b.totalCommission - a.totalCommission);
}

// GET /api/doctor-commission/doctors - this clinic's doctors (Self left out) with their default rate.
async function listDoctors(req, res) {
  const { clientId } = req.user;
  const doctors = (await ReferralDoctor.findAll({ where: { clientId }, attributes: ['id', 'name', 'mobile'], order: [['name', 'ASC']] }))
    .filter((d) => !isSelf(d.name));
  const rates = await ratesFor(clientId, doctors.map((d) => d.id));
  return res.json(doctors.map((d) => ({
    id: d.id, name: d.name, mobile: d.mobile,
    defaultRate: rates.get(d.id)?.default || null,
    testRateCount: rates.get(d.id)?.byTest.size || 0,
  })));
}

// GET /api/doctor-commission/doctors/:doctorId/rates - default + every test with its own rate (if any) and this clinic's price.
async function getDoctorRates(req, res) {
  const { clientId } = req.user;
  const doctor = await ReferralDoctor.findOne({ where: { id: req.params.doctorId, clientId }, attributes: ['id', 'name'] });
  if (!doctor) return res.status(404).json({ message: 'Doctor not found' });
  const [rates, prices] = await Promise.all([
    ratesFor(clientId, [doctor.id]),
    ClientTestPrice.findAll({ where: { clientId }, attributes: ['testId', 'price', 'active'], include: [{ model: TestMaster, attributes: ['id', 'testCode', 'testName', 'category'] }] }),
  ]);
  const mine = rates.get(doctor.id);
  // The tests this clinic bills (has a price for), plus any test that already has a rate.
  const tests = prices.filter((p) => p.TestMaster).map((p) => ({
    testId: p.testId, testCode: p.TestMaster.testCode, testName: p.TestMaster.testName, category: p.TestMaster.category,
    price: Number(p.price), rate: mine?.byTest.get(p.testId) || null,
  })).sort((a, b) => a.testName.localeCompare(b.testName));
  return res.json({ doctor, defaultRate: mine?.default || null, tests });
}

// PUT /api/doctor-commission/doctors/:doctorId/rates
// { defaultRate: {rateType, rate} | null, tests: [{ testId, rateType, rate }] } - replaces the doctor's rates.
async function saveDoctorRates(req, res) {
  const { clientId } = req.user;
  const doctor = await ReferralDoctor.findOne({ where: { id: req.params.doctorId, clientId }, attributes: ['id', 'name'] });
  if (!doctor) return res.status(404).json({ message: 'Doctor not found' });
  if (isSelf(doctor.name)) return res.status(400).json({ message: 'Self has no commission' });

  const check = (r, label) => {
    if (!RATE_TYPES.includes(r.rateType)) return `${label}: choose % or ₹`;
    const v = Number(r.rate);
    if (!Number.isFinite(v) || v < 0) return `${label}: enter a valid rate (0 or more)`;
    if (r.rateType === 'PERCENT' && v > 100) return `${label}: a percentage cannot be more than 100`;
    return null;
  };
  const def = req.body.defaultRate && Number(req.body.defaultRate.rate) > 0 ? req.body.defaultRate : null;
  if (def) { const e = check(def, 'Default'); if (e) return res.status(400).json({ message: e }); }
  const tests = [];
  const seen = new Set();
  for (const t of Array.isArray(req.body.tests) ? req.body.tests : []) {
    const testId = Number(t.testId);
    if (!testId || seen.has(testId) || t.rate === '' || t.rate == null) continue;
    const e = check(t, `Test ${testId}`);
    if (e) return res.status(400).json({ message: e });
    seen.add(testId);
    tests.push({ testId, rateType: t.rateType, rate: round2(t.rate) });
  }

  await sequelize.transaction(async (transaction) => {
    await DoctorCommissionRate.destroy({ where: { clientId, doctorId: doctor.id }, transaction });
    const rows = [
      ...(def ? [{ clientId, doctorId: doctor.id, testId: null, rateType: def.rateType, rate: round2(def.rate) }] : []),
      ...tests.map((t) => ({ clientId, doctorId: doctor.id, ...t })),
    ];
    if (rows.length) await DoctorCommissionRate.bulkCreate(rows, { transaction });
  });
  return res.json({ message: `Commission rates saved for ${doctor.name}`, testRates: tests.length, defaultRate: def });
}

// GET /api/doctor-commission/preview?from=&to= - commission not yet in a statement, per doctor.
async function preview(req, res) {
  const data = await pendingCommission(req.user.clientId, req.query.from, req.query.to);
  if (!data) return res.status(400).json({ message: 'Choose a valid period' });
  return res.json(data);
}

// POST /api/doctor-commission/statements { from, to, periodType, doctorIds? }
async function generateStatements(req, res) {
  const { clientId } = req.user;
  const { from, to } = req.body;
  const periodType = req.body.periodType === 'WEEK' ? 'WEEK' : 'MONTH';
  const doctorIds = Array.isArray(req.body.doctorIds) && req.body.doctorIds.length ? req.body.doctorIds.map(Number) : null;
  if (!istRange(from, to)) return res.status(400).json({ message: 'Choose a valid period' });

  const created = await sequelize.transaction(async (transaction) => {
    // One generation at a time per clinic, so two clicks can't build overlapping statements.
    await sequelize.query('SELECT pg_advisory_xact_lock(:key)', { replacements: { key: 920000000 + Number(clientId) }, transaction });
    const doctors = await pendingCommission(clientId, from, to, { doctorIds, transaction });
    let seq = await CommissionStatement.count({ where: { clientId }, transaction });
    const out = [];
    for (const d of doctors) {
      seq += 1;
      // eslint-disable-next-line no-await-in-loop
      const st = await CommissionStatement.create({
        clientId, doctorId: d.doctorId, doctorName: d.doctorName,
        statementNo: `DC-${String(seq).padStart(4, '0')}`, periodType, fromDate: from, toDate: to,
        billCount: d.billCount, testCount: d.testCount, totalAmount: d.totalAmount, totalCommission: d.totalCommission,
      }, { transaction });
      // eslint-disable-next-line no-await-in-loop
      await CommissionStatementLine.bulkCreate(d.lines.map((l) => ({ ...l, statementId: st.id })), { transaction });
      out.push({ id: st.id, statementNo: st.statementNo, doctorName: d.doctorName, totalCommission: d.totalCommission });
    }
    return out;
  });
  if (created.length === 0) return res.status(400).json({ message: 'No commission to generate for this period - every eligible test is already in a statement, or no rates are set.' });
  return res.status(201).json({ statements: created });
}

// GET /api/doctor-commission/statements?status=&doctorId=
async function listStatements(req, res) {
  const { clientId } = req.user;
  const where = { clientId };
  if (['GENERATED', 'PAID'].includes(req.query.status)) where.status = req.query.status;
  if (Number(req.query.doctorId)) where.doctorId = Number(req.query.doctorId);
  const rows = await CommissionStatement.findAll({ where, order: [['fromDate', 'DESC'], ['id', 'DESC']], limit: 500 });
  return res.json(rows);
}

async function findStatement(req, withLines = true) {
  return CommissionStatement.findOne({
    where: { id: req.params.id, clientId: req.user.clientId },
    include: withLines ? [CommissionStatementLine] : [],
    order: withLines ? [[CommissionStatementLine, 'billDate', 'ASC'], [CommissionStatementLine, 'id', 'ASC']] : undefined,
  });
}

// GET /api/doctor-commission/statements/:id[?format=xlsx]
async function getStatement(req, res) {
  const st = await findStatement(req);
  if (!st) return res.status(404).json({ message: 'Statement not found' });
  if (req.query.format !== 'xlsx') return res.json(st);
  const lines = st.CommissionStatementLines.map((l) => ({
    'Bill No': l.billNo, 'Bill Date': istDate(l.billDate), Patient: l.patientName, 'Test Code': l.testCode, 'Test Name': l.testName,
    'Test Price': Number(l.price), 'After Discount': Number(l.netAmount),
    Rate: l.rateType === 'FIXED' ? `₹${Number(l.rate)}` : `${Number(l.rate)}%`, Commission: Number(l.commission),
  }));
  lines.push({ 'Bill No': 'TOTAL', 'After Discount': Number(st.totalAmount), Commission: Number(st.totalCommission) });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(lines), st.statementNo);
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${st.statementNo}-${st.doctorName.replace(/[^\w.-]+/g, '_')}.xlsx"`);
  return res.send(buffer);
}

// PUT /api/doctor-commission/statements/:id/pay { paidAt, paymentMode, paymentReference?, notes? }
async function markPaid(req, res) {
  const st = await findStatement(req, false);
  if (!st) return res.status(404).json({ message: 'Statement not found' });
  if (st.status === 'PAID') return res.status(400).json({ message: 'This statement is already paid' });
  const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.paidAt || '')) ? req.body.paidAt : istDate(new Date());
  const paymentMode = String(req.body.paymentMode || '').trim();
  if (!paymentMode) return res.status(400).json({ message: 'Choose how the commission was paid' });
  await st.update({
    status: 'PAID', paidAt, paymentMode,
    paymentReference: String(req.body.paymentReference || '').trim() || null,
    notes: String(req.body.notes || '').trim() || null,
  });
  return res.json(st);
}

// DELETE /api/doctor-commission/statements/:id - cancel an unpaid statement; its tests can be generated again.
async function cancelStatement(req, res) {
  const st = await findStatement(req, false);
  if (!st) return res.status(404).json({ message: 'Statement not found' });
  if (st.status === 'PAID') return res.status(400).json({ message: 'A paid statement cannot be cancelled' });
  await sequelize.transaction(async (transaction) => {
    await CommissionStatementLine.destroy({ where: { statementId: st.id }, transaction });
    await st.destroy({ transaction });
  });
  return res.json({ message: `${st.statementNo} cancelled - its tests can be generated again` });
}

module.exports = {
  listDoctors, getDoctorRates, saveDoctorRates, preview, generateStatements, listStatements, getStatement, markPaid, cancelStatement,
  pendingCommission,
};
