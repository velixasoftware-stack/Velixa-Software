const XLSX = require('xlsx');
const { Package, TestMaster } = require('../models');

// The client's next package code: "PKG" + the number after its highest
// PKG number (PKG001, PKG002 ...). Codes are per client.
async function nextPackageCode(clientId) {
  const existing = await Package.findAll({ where: { clientId }, attributes: ['packageCode'] });
  let maxN = 0;
  for (const p of existing) {
    const m = String(p.packageCode || '').match(/^PKG(\d+)$/i);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  const taken = new Set(existing.map((p) => String(p.packageCode).toUpperCase()));
  let n = maxN + 1;
  while (taken.has(`PKG${String(n).padStart(3, '0')}`)) n += 1;
  return `PKG${String(n).padStart(3, '0')}`;
}

// POST /api/masters/packages  { packageName, price, testIds: [1,2,3] }
// The package code is always generated (PKG001, PKG002 ... per client).
async function createPackage(req, res) {
  const { clientId } = req.user;
  const { packageName, price, testIds } = req.body;

  if (!String(packageName || '').trim() || price == null || price === '' || !Array.isArray(testIds) || testIds.length === 0) {
    return res.status(400).json({ message: 'Package name, price and at least one test are required' });
  }
  if (!Number.isFinite(Number(price)) || Number(price) < 0) {
    return res.status(400).json({ message: 'Enter a valid package price (0 or more)' });
  }
  const packageCode = await nextPackageCode(clientId);

  const tests = await TestMaster.findAll({ where: { id: testIds } });
  if (tests.length !== testIds.length) {
    return res.status(400).json({ message: 'One or more selected tests are invalid' });
  }

  const pkg = await Package.create({ clientId, packageCode, packageName, price });
  await pkg.setTestMasters(tests);

  return res.status(201).json(pkg);
}

// GET /api/masters/packages
async function listPackages(req, res) {
  const { clientId } = req.user;
  const packages = await Package.findAll({
    where: { clientId },
    include: [TestMaster],
    order: [['packageCode', 'ASC']],
  });
  return res.json(packages);
}

// PUT /api/masters/packages/:id  { packageName, price, testIds, active }
async function updatePackage(req, res) {
  const { clientId } = req.user;
  const pkg = await Package.findOne({ where: { id: req.params.id, clientId } });
  if (!pkg) return res.status(404).json({ message: 'Package not found' });

  const { packageName, price, testIds, active } = req.body;
  if (price !== undefined && (price === null || price === '' || !Number.isFinite(Number(price)) || Number(price) < 0)) {
    return res.status(400).json({ message: 'Enter a valid package price (0 or more)' });
  }
  if (packageName !== undefined && !String(packageName || '').trim()) {
    return res.status(400).json({ message: 'Package name cannot be empty' });
  }
  await pkg.update({
    packageName: packageName ?? pkg.packageName,
    price: price ?? pkg.price,
    active: active ?? pkg.active,
  });

  if (Array.isArray(testIds)) {
    if (testIds.length === 0) return res.status(400).json({ message: 'A package needs at least one test' });
    const tests = await TestMaster.findAll({ where: { id: testIds } });
    if (tests.length !== testIds.length) return res.status(400).json({ message: 'One or more selected tests are invalid' });
    await pkg.setTestMasters(tests);
  }

  return res.json(pkg);
}

// GET /api/masters/packages/template
async function downloadTemplate(req, res) {
  const { clientId } = req.user;
  const packages = await Package.findAll({ where: { clientId }, order: [['packageCode', 'ASC']] });

  const rows = packages.length
    ? packages.map((p) => ({ PACKAGE_CODE: p.packageCode, PACKAGE_NAME: p.packageName, PRICE: p.price }))
    : [{ PACKAGE_CODE: 'PKG001', PACKAGE_NAME: 'Example Package', PRICE: 999 }];

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Package Prices');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="package-price-template.xlsx"');
  return res.send(buffer);
}

// POST /api/masters/packages/upload/preview  (multipart file)
async function previewUpload(req, res) {
  const { clientId } = req.user;
  if (!req.file) return res.status(400).json({ message: 'Excel/CSV file is required' });

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const codes = [...new Set(rows.map((r) => String(r.PACKAGE_CODE || '').trim()).filter(Boolean))];
  const packages = await Package.findAll({ where: { clientId, packageCode: codes } });
  const packageByCode = new Map(packages.map((p) => [p.packageCode, p]));

  const preview = rows.map((r, idx) => {
    const packageCode = String(r.PACKAGE_CODE || '').trim();
    const price = Number(r.PRICE);
    const errors = [];
    if (!packageCode) errors.push('PACKAGE_CODE is missing');
    else if (!packageByCode.has(packageCode)) errors.push(`Unknown PACKAGE_CODE: ${packageCode}`);
    if (Number.isNaN(price) || price < 0) errors.push('PRICE is invalid');

    return {
      row: idx + 2,
      packageCode,
      packageName: r.PACKAGE_NAME,
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

// POST /api/masters/packages/upload/commit  { rows: [{ packageCode, price }] }
async function commitUpload(req, res) {
  const { clientId } = req.user;
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'rows array is required' });
  }

  const results = { success: [], errors: [] };
  for (const row of rows) {
    const pkg = await Package.findOne({ where: { clientId, packageCode: row.packageCode } });
    if (!pkg || Number.isNaN(Number(row.price))) {
      results.errors.push({ packageCode: row.packageCode, reason: 'Invalid package code or price' });
      continue;
    }
    if (pkg.price != row.price) await pkg.update({ price: row.price });
    results.success.push({ packageCode: row.packageCode, price: row.price });
  }

  return res.json(results);
}

module.exports = { createPackage, listPackages, updatePackage, downloadTemplate, previewUpload, commitUpload };
