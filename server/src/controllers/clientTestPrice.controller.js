const XLSX = require('xlsx');
const {
  sequelize, ClientTestPrice, ClientTestShortName, TestMaster, Client, Payor, PayorTestPrice, Package,
} = require('../models');

function resolveClientId(req) {
  return req.params.clientId || req.user.clientId;
}

// GET /api/clients/:clientId/test-prices  (or /api/masters/client-test-price for a client admin)
async function listPrices(req, res) {
  const prices = await ClientTestPrice.findAll({
    where: { clientId: resolveClientId(req) },
    include: [TestMaster],
  });
  return res.json(prices);
}

// PUT /api/clients/:clientId/test-prices  { testId, price }
async function setPrice(req, res) {
  const clientId = resolveClientId(req);
  const { testId, price } = req.body;
  if (!testId || price == null) return res.status(400).json({ message: 'testId and price are required' });

  const [record] = await ClientTestPrice.findOrCreate({
    where: { clientId, testId },
    defaults: { price },
  });
  if (record.price != price) await record.update({ price });
  return res.json(record);
}

// GET /api/masters/client-test-price/template  - a ready-to-fill Excel sheet,
// pre-populated with every test and this client's current price (if any).
async function downloadTemplate(req, res) {
  const clientId = resolveClientId(req);
  const [tests, prices] = await Promise.all([
    TestMaster.findAll({ where: { active: true }, order: [['testCode', 'ASC']] }),
    ClientTestPrice.findAll({ where: { clientId } }),
  ]);
  const priceByTestId = new Map(prices.map((p) => [p.testId, p.price]));

  const rows = tests.map((t) => ({
    TEST_CODE: t.testCode,
    TEST_NAME: t.testName,
    PRICE: priceByTestId.get(t.id) ?? '',
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Test Prices');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="test-price-template.xlsx"');
  return res.send(buffer);
}

/**
 * Parses an uploaded Excel/CSV buffer of TEST_CODE, TEST_NAME, PRICE rows and
 * validates each against the global Test Master, without writing anything.
 * Step 1 of the Preview -> Validation -> Upload -> Success/Error flow.
 */
async function previewUpload(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Excel/CSV file is required' });

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const testCodes = [...new Set(rows.map((r) => String(r.TEST_CODE || '').trim()).filter(Boolean))];
  const tests = await TestMaster.findAll({ where: { testCode: testCodes } });
  const testByCode = new Map(tests.map((t) => [t.testCode, t]));

  const preview = rows.map((r, idx) => {
    const testCode = String(r.TEST_CODE || '').trim();
    const price = Number(r.PRICE);
    const errors = [];
    if (!testCode) errors.push('TEST_CODE is missing');
    else if (!testByCode.has(testCode)) errors.push(`Unknown TEST_CODE: ${testCode}`);
    if (Number.isNaN(price) || price < 0) errors.push('PRICE is invalid');

    return {
      row: idx + 2, // account for header row
      testCode,
      testName: r.TEST_NAME,
      price,
      valid: errors.length === 0,
      errors,
    };
  });

  return res.json({
    totalRows: preview.length,
    validRows: preview.filter((r) => r.valid).length,
    invalidRows: preview.filter((r) => !r.valid).length,
    preview,
  });
}

// POST /api/clients/:clientId/test-prices/upload/commit  { rows: [{ testCode, price }] }
async function commitUpload(req, res) {
  const clientId = resolveClientId(req);
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'rows array is required' });
  }

  const client = await Client.findByPk(clientId);
  if (!client) return res.status(404).json({ message: 'Client not found' });

  const results = { success: [], errors: [] };
  for (const row of rows) {
    const test = await TestMaster.findOne({ where: { testCode: row.testCode } });
    if (!test || Number.isNaN(Number(row.price))) {
      results.errors.push({ testCode: row.testCode, reason: 'Invalid test code or price' });
      continue;
    }
    const [record] = await ClientTestPrice.findOrCreate({
      where: { clientId, testId: test.id },
      defaults: { price: row.price },
    });
    if (record.price != row.price) await record.update({ price: row.price });
    results.success.push({ testCode: row.testCode, price: row.price });
  }

  return res.json(results);
}

// PUT /api/masters/client-test-price/:testId/status  { active }
// Switches a test on/off for this client's billing only - the shared Test
// Master and every other client are untouched.
async function setPriceStatus(req, res) {
  const clientId = resolveClientId(req);
  if (typeof req.body.active !== 'boolean') return res.status(400).json({ message: 'active (true/false) is required' });
  const record = await ClientTestPrice.findOne({ where: { clientId, testId: req.params.testId } });
  if (!record) return res.status(404).json({ message: 'This test has no price for your clinic yet - set a price first' });
  await record.update({ active: req.body.active });
  return res.json(record);
}

// DELETE /api/masters/client-test-price/:testId
// Removes a test from this client's own masters: its price, short name, payor
// prices and package memberships. A package left with no tests is switched
// inactive. Bills already made keep their own copy of the test and price.
async function removeClientTest(req, res) {
  const clientId = resolveClientId(req);
  const testId = Number(req.params.testId);
  const test = await TestMaster.findByPk(testId);
  if (!test) return res.status(404).json({ message: 'Test not found' });

  await sequelize.transaction(async (transaction) => {
    await ClientTestPrice.destroy({ where: { clientId, testId }, transaction });
    await ClientTestShortName.destroy({ where: { clientId, testId }, transaction });
    const payors = await Payor.findAll({ where: { clientId }, attributes: ['id'], transaction });
    if (payors.length) {
      await PayorTestPrice.destroy({ where: { testId, payorId: payors.map((p) => p.id) }, transaction });
    }
    const packages = await Package.findAll({ where: { clientId }, include: [TestMaster], transaction });
    for (const pkg of packages) {
      if (!pkg.TestMasters.some((t) => t.id === testId)) continue;
      await pkg.removeTestMaster(testId, { transaction });
      if (pkg.TestMasters.length === 1) await pkg.update({ active: false }, { transaction });
    }
  });

  return res.json({ message: `${test.testName} was removed from your clinic's masters` });
}

module.exports = { listPrices, setPrice, setPriceStatus, removeClientTest, downloadTemplate, previewUpload, commitUpload };
