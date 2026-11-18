const {
  sequelize, Client, TestMaster, ParameterMaster, ParameterNormalRange,
  ClientParameterOverride, ClientParameterLabel, ClientParameterTrend, ClientHiddenParameter,
  ClientTestPrice, ClientTestShortName, ClientTestSpecimen,
} = require('../models');

/**
 * Chief Admin: copy one client's own test setup to another client.
 *
 * Tests themselves are shared by every client (Test Master); what belongs to a
 * client is layered on top of them, per test:
 *  - ownParameters: parameters the client added for itself (clientId = it),
 *    with their age/gender normal-range rows and the tests they're assigned to
 *  - normalRanges:  its own copy of the ranges / printed range text of a
 *    Chief Admin (universal) parameter (ClientParameterOverride + its rows)
 *  - labels:        its own name / unit / method for a universal parameter
 *  - testSettings:  its specimen and short name per test
 *  - hiddenTrend:   universal parameters it removed from a test, and which
 *    parameters print the AI trend
 *  - prices:        its test price and Active/Inactive switch per test
 *
 * Nothing of the source client changes. In the target, what it already has is
 * kept unless `overwrite` is set; a copied own parameter whose name the target
 * already has on that test is never duplicated.
 */

const PARTS = ['ownParameters', 'normalRanges', 'labels', 'testSettings', 'hiddenTrend', 'prices'];
const LINK = () => sequelize.models.test_parameter_link;
const key = (s) => String(s || '').trim().toLowerCase();

// Columns of a normal-range row worth copying (not id, owner, timestamps or audit).
const RANGE_FIELDS = ['gender', 'ageMin', 'ageMax', 'ageUnit', 'ageMaxUnit', 'normalRangeLow', 'normalRangeHigh', 'rangeText'];
const PARAM_FIELDS = ['parameterName', 'unit', 'method', 'normalRangeLow', 'normalRangeHigh', 'normalRangeText',
  'normalRangeTextMale', 'normalRangeTextFemale', 'description', 'isInterpretation', 'sequence', 'testId'];
const pick = (obj, fields) => Object.fromEntries(fields.map((f) => [f, obj[f]]));

/** Every client-specific thing the source client has, grouped by test. */
async function collectSource(clientId) {
  const client = await Client.findByPk(clientId, { attributes: ['id', 'clientCode', 'clientName'] });
  if (!client) return null;

  const ownParams = await ParameterMaster.findAll({ where: { clientId, active: true } });
  const ownIds = ownParams.map((p) => p.id);
  const ownLinks = ownIds.length ? await LINK().findAll({ where: { parameterId: ownIds } }) : [];

  const overrides = await ClientParameterOverride.findAll({ where: { clientId } });
  const labels = await ClientParameterLabel.findAll({ where: { clientId } });
  const trends = await ClientParameterTrend.findAll({ where: { clientId } });
  const hidden = await ClientHiddenParameter.findAll({ where: { clientId } });
  const specimens = await ClientTestSpecimen.findAll({ where: { clientId } });
  const shortNames = await ClientTestShortName.findAll({ where: { clientId } });
  const prices = await ClientTestPrice.findAll({ where: { clientId } });

  // Which tests a universal parameter belongs to: its home test plus any it's assigned to.
  const universalIds = [...new Set([...overrides, ...labels, ...trends].map((r) => r.parameterId))];
  const universal = universalIds.length
    ? await ParameterMaster.findAll({ where: { id: universalIds, clientId: null }, attributes: ['id', 'testId', 'parameterName'] })
    : [];
  const uniLinks = universalIds.length ? await LINK().findAll({ where: { parameterId: universalIds } }) : [];
  const testsOfParam = new Map();
  const addTest = (pid, tid) => { if (tid) testsOfParam.set(pid, new Set([...(testsOfParam.get(pid) || []), tid])); };
  for (const p of [...universal, ...ownParams]) addTest(p.id, p.testId);
  for (const l of [...uniLinks, ...ownLinks]) addTest(l.parameterId, l.testId);
  const universalById = new Map(universal.map((p) => [p.id, p]));

  return {
    client, ownParams, ownLinks, overrides, labels, trends, hidden, specimens, shortNames, prices,
    testsOfParam, universalById,
  };
}

/** Counts per test of what the source has - shown on the screen before copying. */
function summarise(src, testById) {
  const rows = new Map();
  const row = (tid) => {
    if (!rows.has(tid)) rows.set(tid, { testId: tid, ownParameters: 0, normalRanges: 0, labels: 0, specimen: null, shortName: null, hidden: 0, trend: 0, price: null, createdBySource: false });
    return rows.get(tid);
  };
  const forParam = (pid, field) => { for (const tid of src.testsOfParam.get(pid) || []) row(tid)[field] += 1; };

  for (const p of src.ownParams) forParam(p.id, 'ownParameters');
  for (const o of src.overrides) if (src.universalById.has(o.parameterId)) forParam(o.parameterId, 'normalRanges');
  for (const l of src.labels) if (src.universalById.has(l.parameterId)) forParam(l.parameterId, 'labels');
  for (const t of src.trends) forParam(t.parameterId, 'trend');
  for (const h of src.hidden) row(h.testId).hidden += 1;
  for (const s of src.specimens) row(s.testId).specimen = s.sampleType;
  for (const s of src.shortNames) row(s.testId).shortName = s.shortName;
  for (const p of src.prices) row(p.testId).price = { price: p.price, active: p.active };

  return [...rows.values()]
    .filter((r) => testById.has(r.testId))
    .map((r) => {
      const t = testById.get(r.testId);
      return { ...r, testCode: t.testCode, testName: t.testName, category: t.category, createdBySource: (t.createdBy || '').includes(`(${src.client.clientCode})`) };
    })
    .sort((a, b) => (b.createdBySource - a.createdBySource) || a.testName.localeCompare(b.testName));
}

// GET /api/admin/client-copy/preview?fromClientId=&toClientId=
async function previewCopy(req, res) {
  const fromId = Number(req.query.fromClientId);
  const toId = Number(req.query.toClientId) || null;
  if (!fromId) return res.status(400).json({ message: 'Select the client to copy from' });
  if (toId === fromId) return res.status(400).json({ message: 'Pick two different clients' });
  const src = await collectSource(fromId);
  if (!src) return res.status(404).json({ message: 'Client not found' });

  const tests = await TestMaster.findAll({ attributes: ['id', 'testCode', 'testName', 'category', 'createdBy'] });
  const testById = new Map(tests.map((t) => [t.id, t]));
  const rows = summarise(src, testById);

  // Tests the source created but has nothing else on yet - still listed (prices etc. may be added later).
  const listed = new Set(rows.map((r) => r.testId));
  for (const t of tests) {
    if (!listed.has(t.id) && (t.createdBy || '').includes(`(${src.client.clientCode})`)) {
      rows.push({ testId: t.id, testCode: t.testCode, testName: t.testName, category: t.category, ownParameters: 0, normalRanges: 0, labels: 0, specimen: null, shortName: null, hidden: 0, trend: 0, price: null, createdBySource: true });
    }
  }

  // What the target already has on each test, so the screen can show "B already has".
  let targetHas = {};
  if (toId) {
    const [ov, lb, pr, own] = await Promise.all([
      ClientParameterOverride.count({ where: { clientId: toId } }),
      ClientParameterLabel.count({ where: { clientId: toId } }),
      ClientTestPrice.findAll({ where: { clientId: toId }, attributes: ['testId'] }),
      ParameterMaster.findAll({ where: { clientId: toId, active: true }, attributes: ['testId'] }),
    ]);
    const priced = new Set(pr.map((p) => p.testId));
    const ownByTest = new Map();
    for (const p of own) ownByTest.set(p.testId, (ownByTest.get(p.testId) || 0) + 1);
    targetHas = { overrides: ov, labels: lb };
    rows.forEach((r) => { r.targetPriced = priced.has(r.testId); r.targetOwnParameters = ownByTest.get(r.testId) || 0; });
  }

  return res.json({ from: src.client, rows, targetHas });
}

// POST /api/admin/client-copy  { fromClientId, toClientId, testIds: [], parts: [], overwrite }
async function runCopy(req, res) {
  const fromId = Number(req.body.fromClientId);
  const toId = Number(req.body.toClientId);
  const testIds = new Set((req.body.testIds || []).map(Number).filter(Boolean));
  const parts = new Set((req.body.parts || []).filter((p) => PARTS.includes(p)));
  const overwrite = !!req.body.overwrite;
  if (!fromId || !toId) return res.status(400).json({ message: 'Select both clients' });
  if (fromId === toId) return res.status(400).json({ message: 'Pick two different clients' });
  if (testIds.size === 0) return res.status(400).json({ message: 'Tick at least one test to copy' });
  if (parts.size === 0) return res.status(400).json({ message: 'Tick at least one thing to copy' });
  const target = await Client.findByPk(toId, { attributes: ['id'] });
  if (!target) return res.status(404).json({ message: 'Target client not found' });

  const src = await collectSource(fromId);
  if (!src) return res.status(404).json({ message: 'Source client not found' });
  // A parameter is in scope when any test it belongs to is ticked.
  const inScope = (pid) => [...(src.testsOfParam.get(pid) || [])].some((tid) => testIds.has(tid));

  const done = { ownParameters: 0, rangeRows: 0, normalRanges: 0, labels: 0, specimens: 0, shortNames: 0, hidden: 0, trend: 0, prices: 0 };
  const skipped = { ownParameters: 0, normalRanges: 0, labels: 0, specimens: 0, shortNames: 0, prices: 0 };

  await sequelize.transaction(async (transaction) => {
    const t = { transaction };
    // Source own parameter id -> the target's parameter it became (or already had).
    const paramMap = new Map();
    // New parameter codes (PARM + number, as in Test Master), counted on from the
    // highest in use - inside this transaction, so codes made here are never reused.
    let codeN = 0;
    const nextParameterCode = async () => {
      if (!codeN) {
        const all = await ParameterMaster.findAll({ attributes: ['parameterCode'], ...t });
        for (const p of all) {
          const m = p.parameterCode?.match(/(\d+)/);
          if (m) codeN = Math.max(codeN, parseInt(m[1], 10));
        }
      }
      codeN += 1;
      return `PARM${String(codeN).padStart(3, '0')}`;
    };

    if (parts.has('ownParameters')) {
      const targetOwn = await ParameterMaster.findAll({ where: { clientId: toId, active: true }, ...t });
      const targetByTestName = new Map(targetOwn.map((p) => [`${p.testId}|${key(p.parameterName)}`, p]));
      const ranges = await ParameterNormalRange.findAll({ where: { parameterId: src.ownParams.map((p) => p.id), clientId: null }, ...t });
      for (const p of src.ownParams) {
        if (!inScope(p.id)) continue;
        const existing = targetByTestName.get(`${p.testId}|${key(p.parameterName)}`);
        if (existing) { paramMap.set(p.id, existing.id); skipped.ownParameters += 1; continue; }
        // eslint-disable-next-line no-await-in-loop
        const created = await ParameterMaster.create({ ...pick(p, PARAM_FIELDS), clientId: toId, active: true, parameterCode: await nextParameterCode() }, t);
        paramMap.set(p.id, created.id);
        targetByTestName.set(`${p.testId}|${key(p.parameterName)}`, created);
        done.ownParameters += 1;
        const rows = ranges.filter((r) => r.parameterId === p.id).map((r) => ({ ...pick(r, RANGE_FIELDS), parameterId: created.id, clientId: null }));
        // eslint-disable-next-line no-await-in-loop
        if (rows.length) { await ParameterNormalRange.bulkCreate(rows, t); done.rangeRows += rows.length; }
      }
      // Assignments of those parameters to other ticked tests.
      const links = src.ownLinks.filter((l) => paramMap.has(l.parameterId) && testIds.has(l.testId));
      for (const l of links) {
        // eslint-disable-next-line no-await-in-loop
        await LINK().findOrCreate({ where: { testId: l.testId, parameterId: paramMap.get(l.parameterId) }, ...t });
      }
    }

    if (parts.has('normalRanges')) {
      const overrides = src.overrides.filter((o) => src.universalById.has(o.parameterId) && inScope(o.parameterId));
      const srcRows = overrides.length
        ? await ParameterNormalRange.findAll({ where: { clientId: fromId, parameterId: overrides.map((o) => o.parameterId) }, ...t })
        : [];
      for (const o of overrides) {
        // eslint-disable-next-line no-await-in-loop
        const existing = await ClientParameterOverride.findOne({ where: { clientId: toId, parameterId: o.parameterId }, ...t });
        if (existing && !overwrite) { skipped.normalRanges += 1; continue; }
        const text = { normalRangeText: o.normalRangeText, normalRangeTextMale: o.normalRangeTextMale, normalRangeTextFemale: o.normalRangeTextFemale };
        // eslint-disable-next-line no-await-in-loop
        if (existing) await existing.update(text, t);
        // eslint-disable-next-line no-await-in-loop
        else await ClientParameterOverride.create({ ...text, clientId: toId, parameterId: o.parameterId }, t);
        // eslint-disable-next-line no-await-in-loop
        await ParameterNormalRange.destroy({ where: { clientId: toId, parameterId: o.parameterId }, ...t });
        const rows = srcRows.filter((r) => r.parameterId === o.parameterId).map((r) => ({ ...pick(r, RANGE_FIELDS), parameterId: o.parameterId, clientId: toId }));
        // eslint-disable-next-line no-await-in-loop
        if (rows.length) { await ParameterNormalRange.bulkCreate(rows, t); done.rangeRows += rows.length; }
        done.normalRanges += 1;
      }
    }

    // One row per (client, parameter) or (client, test): create, or update only when overwriting.
    const upsert = async (Model, where, values, doneKey, skipKey) => {
      const existing = await Model.findOne({ where: { clientId: toId, ...where }, ...t });
      if (existing && !overwrite) { if (skipKey) skipped[skipKey] += 1; return; }
      if (existing) await existing.update(values, t);
      else await Model.create({ clientId: toId, ...where, ...values }, t);
      done[doneKey] += 1;
    };

    if (parts.has('labels')) {
      for (const l of src.labels) {
        if (!src.universalById.has(l.parameterId) || !inScope(l.parameterId)) continue;
        // eslint-disable-next-line no-await-in-loop
        await upsert(ClientParameterLabel, { parameterId: l.parameterId }, { parameterName: l.parameterName, unit: l.unit, method: l.method }, 'labels', 'labels');
      }
    }

    if (parts.has('testSettings')) {
      for (const s of src.specimens) {
        // eslint-disable-next-line no-await-in-loop
        if (testIds.has(s.testId)) await upsert(ClientTestSpecimen, { testId: s.testId }, { sampleType: s.sampleType }, 'specimens', 'specimens');
      }
      for (const s of src.shortNames) {
        // eslint-disable-next-line no-await-in-loop
        if (testIds.has(s.testId)) await upsert(ClientTestShortName, { testId: s.testId }, { shortName: s.shortName }, 'shortNames', 'shortNames');
      }
    }

    if (parts.has('hiddenTrend')) {
      for (const h of src.hidden) {
        if (!testIds.has(h.testId)) continue;
        // eslint-disable-next-line no-await-in-loop
        const [, created] = await ClientHiddenParameter.findOrCreate({ where: { clientId: toId, testId: h.testId, parameterId: h.parameterId }, ...t });
        if (created) done.hidden += 1;
      }
      for (const tr of src.trends) {
        // A trend on the source's own parameter goes to the target's copy of it (only if that was copied).
        const own = src.ownParams.some((p) => p.id === tr.parameterId);
        const parameterId = own ? paramMap.get(tr.parameterId) : tr.parameterId;
        if (!parameterId || !inScope(tr.parameterId)) continue;
        // eslint-disable-next-line no-await-in-loop
        const [, created] = await ClientParameterTrend.findOrCreate({ where: { clientId: toId, parameterId }, ...t });
        if (created) done.trend += 1;
      }
    }

    if (parts.has('prices')) {
      for (const p of src.prices) {
        if (!testIds.has(p.testId)) continue;
        // eslint-disable-next-line no-await-in-loop
        await upsert(ClientTestPrice, { testId: p.testId }, { price: p.price, active: p.active, overrideChiefInactive: p.overrideChiefInactive }, 'prices', 'prices');
      }
    }
  });

  return res.json({ done, skipped });
}

module.exports = { previewCopy, runCopy, PARTS };
