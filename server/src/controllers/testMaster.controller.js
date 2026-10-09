const { Op } = require('sequelize');
const XLSX = require('xlsx');
const { TestGroup, TestMaster, ParameterMaster, ParameterNormalRange } = require('../models');
const { sortParameters } = require('../utils/parameterOrder');

const GENDER_OPTIONS = ['Male', 'Female', 'Other', 'Any'];
const AGE_UNIT_OPTIONS = ['Years', 'Months', 'Days'];

// Chief Admin adds to the shared/universal catalog (clientId null, seen by
// everyone) exactly as before; a client-side user's own parameter is scoped
// to their client only and never shows up for anyone else.
function requesterClientId(req) {
  return req.user?.type === 'CLIENT_USER' ? req.user.clientId : null;
}

// Parameter codes are always system-generated, never typed in - one uniform
// "PARM" prefix plus a zero-padded number, shared across every parameter
// regardless of its name (not a per-name prefix like "HEMO001"/"GLUC001",
// which made every parameter's own count effectively restart at 001). The
// sequence number is the highest one already in use across every existing
// parameter code, the same shared-sequence approach used for Client Code.
// Used identically from the client-side Test Parameters screen, the Chief
// Admin Test Master screen, and the Excel bulk upload.
async function generateParameterCode() {
  const prefix = 'PARM';
  const existing = await ParameterMaster.findAll({ attributes: ['parameterCode'] });
  let maxN = 0;
  for (const p of existing) {
    const match = p.parameterCode?.match(/(\d+)/);
    if (match) maxN = Math.max(maxN, parseInt(match[1], 10));
  }

  let n = maxN + 1;
  let code = `${prefix}${String(n).padStart(3, '0')}`;
  while (await ParameterMaster.findOne({ where: { parameterCode: code } })) {
    n += 1;
    code = `${prefix}${String(n).padStart(3, '0')}`;
  }
  return code;
}

// GET /api/admin/masters/groups  (Chief Admin only)
async function listTestGroups(req, res) {
  const groups = await TestGroup.findAll({ order: [['name', 'ASC']] });
  return res.json(groups);
}

// POST /api/admin/masters/groups  { name }  (Chief Admin only)
async function createTestGroup(req, res) {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ message: 'Group name is required' });

  const existing = await TestGroup.findOne({ where: { name: { [Op.iLike]: name } } });
  if (existing) return res.status(200).json(existing); // resubmit-safe, same as parameter creation

  const group = await TestGroup.create({ name });
  return res.status(201).json(group);
}

// POST /api/masters/tests
async function createTest(req, res) {
  const { testCode, testName, category, sampleType, interpretation, parameters } = req.body;
  if (!testCode || !testName) {
    return res.status(400).json({ message: 'testCode and testName are required' });
  }

  const existing = await TestMaster.findOne({ where: { testCode } });
  if (existing) return res.status(409).json({ message: 'Test Code already exists' });

  const test = await TestMaster.create({ testCode, testName, category, sampleType, interpretation });

  if (Array.isArray(parameters)) {
    const clientId = requesterClientId(req);
    for (const p of parameters) {
      await ParameterMaster.create({
        testId: test.id,
        clientId,
        parameterCode: await generateParameterCode(),
        parameterName: p.parameterName,
        unit: p.unit,
        method: p.method,
        normalRangeLow: p.normalRangeLow,
        normalRangeHigh: p.normalRangeHigh,
        isInterpretation: !!p.isInterpretation,
      });
    }
  }

  return res.status(201).json(test);
}

// GET /api/masters/tests
// A client sees every universal parameter plus whatever parameters they've
// added for themselves; Chief Admin (no client context) sees only the
// universal catalog - matching what it managed before this feature existed.
// Each test's ParameterMasters list is its own (home) parameters plus any
// parameter *assigned* to it from elsewhere - merged into one array so
// nothing else in the app needs to know about the distinction.
async function listTests(req, res) {
  const clientId = requesterClientId(req);
  const paramWhere = clientId ? { [Op.or]: [{ clientId: null }, { clientId }] } : { clientId: null };

  const tests = await TestMaster.findAll({
    include: [
      { model: ParameterMaster, where: paramWhere, required: false, include: [ParameterNormalRange] },
      { model: ParameterMaster, as: 'AssignedParameters', where: paramWhere, required: false, include: [ParameterNormalRange], through: { attributes: [] } },
    ],
    order: [['testCode', 'ASC']],
  });

  const result = tests.map((t) => {
    const json = t.toJSON();
    const owned = json.ParameterMasters || [];
    const ownedIds = new Set(owned.map((p) => p.id));
    const assigned = (json.AssignedParameters || [])
      .filter((p) => !ownedIds.has(p.id))
      .map((p) => ({ ...p, isAssigned: true }));
    json.ParameterMasters = sortParameters([...owned, ...assigned]);
    delete json.AssignedParameters;
    return json;
  });
  return res.json(result);
}

// PUT /api/masters/tests/:id
async function updateTest(req, res) {
  const test = await TestMaster.findByPk(req.params.id);
  if (!test) return res.status(404).json({ message: 'Test not found' });
  const { testName, category, sampleType, interpretation, active } = req.body;
  await test.update({
    testName: testName ?? test.testName,
    category: category !== undefined ? category : test.category,
    sampleType: sampleType !== undefined ? sampleType : test.sampleType,
    interpretation: interpretation !== undefined ? interpretation : test.interpretation,
    active: active ?? test.active,
  });
  return res.json(test);
}

// POST /api/masters/tests/:testId/parameters
// Body: { parameterName, unit, method, normalRangeLow, normalRangeHigh,
//         normalRanges?: [{ gender, ageMin, ageMax, normalRangeLow, normalRangeHigh }] }
// parameterCode is always generated here, never accepted from the caller.
// normalRangeLow/High on the parameter itself are the default range, used
// whenever a result's patient doesn't match any age/gender-specific rule
// below. normalRanges is optional - a parameter can be created with just a
// default range and have age/gender rules added to it later.
async function addParameter(req, res) {
  const test = await TestMaster.findByPk(req.params.testId);
  if (!test) return res.status(404).json({ message: 'Test not found' });

  const { parameterName, unit, method, normalRangeLow, normalRangeHigh, description, isInterpretation, normalRanges } = req.body;
  if (!parameterName) return res.status(400).json({ message: 'parameterName is required' });

  if (normalRanges !== undefined) {
    if (!Array.isArray(normalRanges)) return res.status(400).json({ message: 'normalRanges must be an array' });
    for (const r of normalRanges) {
      if (r.gender && !GENDER_OPTIONS.includes(r.gender)) {
        return res.status(400).json({ message: `Invalid gender "${r.gender}" - must be one of ${GENDER_OPTIONS.join(', ')}` });
      }
      if (r.ageUnit && !AGE_UNIT_OPTIONS.includes(r.ageUnit)) {
        return res.status(400).json({ message: `Invalid ageUnit "${r.ageUnit}" - must be one of ${AGE_UNIT_OPTIONS.join(', ')}` });
      }
    }
  }

  const clientId = requesterClientId(req);
  // A parameter name is meant to be unique per test (per client scope) - a rapid double-click/double-submit
  // of "Add Parameter" would otherwise create two identical rows. Return the existing one instead of erroring
  // so a resubmit is a harmless no-op rather than a duplicate or a scary failure.
  const existing = await ParameterMaster.findOne({
    where: { testId: test.id, clientId, parameterName: { [Op.iLike]: parameterName } },
    include: [ParameterNormalRange],
  });
  if (existing) return res.status(200).json(existing);

  const parameterCode = await generateParameterCode();
  // A new parameter goes to the end of its test's order unless a sequence is given.
  const seqGiven = req.body.sequence !== undefined && req.body.sequence !== '' && req.body.sequence !== null;
  const maxSeq = seqGiven ? null : await ParameterMaster.max('sequence', { where: { testId: test.id } });
  const parameter = await ParameterMaster.create({
    testId: test.id, clientId, parameterCode, parameterName, unit, method, normalRangeLow, normalRangeHigh, description,
    isInterpretation: !!isInterpretation,
    sequence: seqGiven ? Number(req.body.sequence) : (Number(maxSeq) || 0) + 1,
  });

  for (const r of normalRanges || []) {
    await ParameterNormalRange.create({
      parameterId: parameter.id,
      gender: r.gender || 'Any',
      ageMin: r.ageMin === '' || r.ageMin == null ? null : Number(r.ageMin),
      ageMax: r.ageMax === '' || r.ageMax == null ? null : Number(r.ageMax),
      ageUnit: r.ageUnit || 'Years',
      normalRangeLow: r.normalRangeLow,
      normalRangeHigh: r.normalRangeHigh,
    });
  }

  const full = await ParameterMaster.findByPk(parameter.id, { include: [ParameterNormalRange] });
  return res.status(201).json(full);
}

// POST /api/masters/tests/:testId/parameters/:parameterId/assign
// Attaches an *existing* parameter to this test instead of creating a
// duplicate row - the same code, unit, method and normal ranges are shared,
// so editing them later (e.g. updating a range) updates every test that uses
// it. Idempotent: assigning the same parameter twice, or a parameter that's
// already this test's own, is a harmless no-op.
async function assignParameter(req, res) {
  const test = await TestMaster.findByPk(req.params.testId);
  if (!test) return res.status(404).json({ message: 'Test not found' });

  const parameter = await ParameterMaster.findByPk(req.params.parameterId, { include: [ParameterNormalRange] });
  if (!parameter) return res.status(404).json({ message: 'Parameter not found' });

  // A client may only assign a universal parameter or one of its own - never
  // another client's private parameter.
  const clientId = requesterClientId(req);
  if (clientId && parameter.clientId && parameter.clientId !== clientId) {
    return res.status(403).json({ message: 'You cannot assign another client\'s parameter' });
  }

  if (parameter.testId !== test.id) {
    // Checked explicitly (not just relying on the frontend's rapid-click
    // guard) so a double-click or retried request can't create a second
    // test_parameter_link row for the same pair - there's no unique
    // constraint on the auto-generated join table to catch that for us.
    const alreadyLinked = await test.hasAssignedParameter(parameter);
    if (!alreadyLinked) await test.addAssignedParameter(parameter);
  }
  return res.status(200).json(parameter);
}

// PUT /api/.../tests/:testId/parameter-order   Body: { parameterIds: [id, id, ...] }
// Saves the display order of a test's parameters (its own + assigned ones):
// the first id gets sequence 1, the next 2, and so on. Used for result entry
// and the printed report.
async function reorderParameters(req, res) {
  const test = await TestMaster.findByPk(req.params.testId);
  if (!test) return res.status(404).json({ message: 'Test not found' });
  const ids = Array.isArray(req.body.parameterIds) ? req.body.parameterIds.map(Number).filter(Boolean) : [];
  if (ids.length === 0) return res.status(400).json({ message: 'parameterIds is required' });

  // Only parameters that actually belong to (or are assigned to) this test.
  const owned = await ParameterMaster.findAll({ where: { id: ids, testId: test.id }, attributes: ['id'] });
  const assigned = await test.getAssignedParameters({ where: { id: ids }, attributes: ['id'], joinTableAttributes: [] });
  const allowed = new Set([...owned, ...assigned].map((p) => p.id));
  const clientId = requesterClientId(req);
  if (clientId) {
    // A client can't reorder another client's private parameters.
    const foreign = await ParameterMaster.count({ where: { id: [...allowed], clientId: { [Op.ne]: clientId } } });
    if (foreign > 0) return res.status(403).json({ message: 'You cannot reorder another client\'s parameters' });
  }

  let seq = 0;
  for (const id of ids) {
    if (!allowed.has(id)) continue;
    seq += 1;
    await ParameterMaster.update({ sequence: seq }, { where: { id } });
  }
  return res.json({ message: 'Parameter order saved', count: seq });
}

// POST /api/masters/parameters/:parameterId/ranges  - add one age/gender-specific
// normal range rule to an existing parameter.
async function addNormalRange(req, res) {
  const parameter = await ParameterMaster.findByPk(req.params.parameterId);
  if (!parameter) return res.status(404).json({ message: 'Parameter not found' });

  const { gender, ageMin, ageMax, ageUnit, normalRangeLow, normalRangeHigh } = req.body;
  if (gender && !GENDER_OPTIONS.includes(gender)) {
    return res.status(400).json({ message: `Invalid gender "${gender}" - must be one of ${GENDER_OPTIONS.join(', ')}` });
  }
  if (ageUnit && !AGE_UNIT_OPTIONS.includes(ageUnit)) {
    return res.status(400).json({ message: `Invalid ageUnit "${ageUnit}" - must be one of ${AGE_UNIT_OPTIONS.join(', ')}` });
  }
  if (!normalRangeLow?.toString().trim() && !normalRangeHigh?.toString().trim()) {
    return res.status(400).json({ message: 'At least one of normalRangeLow/normalRangeHigh is required' });
  }

  const normalizedAgeMin = ageMin === '' || ageMin == null ? null : Number(ageMin);
  const normalizedAgeMax = ageMax === '' || ageMax == null ? null : Number(ageMax);
  const normalizedAgeUnit = ageUnit || 'Years';

  // Same defense-in-depth as addParameter above: a double-click/double-submit of "Add Range" would
  // otherwise create two identical rule rows, so an exact-match resubmit returns the existing one instead.
  const existing = await ParameterNormalRange.findOne({
    where: {
      parameterId: parameter.id,
      gender: gender || 'Any',
      ageMin: normalizedAgeMin,
      ageMax: normalizedAgeMax,
      ageUnit: normalizedAgeUnit,
      normalRangeLow: normalRangeLow ?? null,
      normalRangeHigh: normalRangeHigh ?? null,
    },
  });
  if (existing) return res.status(200).json(existing);

  const range = await ParameterNormalRange.create({
    parameterId: parameter.id,
    gender: gender || 'Any',
    ageMin: normalizedAgeMin,
    ageMax: normalizedAgeMax,
    ageUnit: normalizedAgeUnit,
    normalRangeLow, normalRangeHigh,
  });
  return res.status(201).json(range);
}

// DELETE /api/masters/parameters/:parameterId/ranges/:rangeId
async function deleteNormalRange(req, res) {
  const range = await ParameterNormalRange.findOne({ where: { id: req.params.rangeId, parameterId: req.params.parameterId } });
  if (!range) return res.status(404).json({ message: 'Normal range rule not found' });
  await range.destroy();
  return res.json({ message: 'Deleted' });
}

// GET /api/admin/masters/tests/template  - a ready-to-fill Excel sheet covering
// every parameter field (code excluded - that's always generated): unit,
// method, default range, and one row per age/gender-specific range rule, so
// re-downloading it after edits doubles as an up-to-date export.
async function downloadTemplate(req, res) {
  // Chief-Admin-only endpoint - the export covers just the universal catalog,
  // never a client's own private parameters.
  const tests = await TestMaster.findAll({
    include: [{ model: ParameterMaster, where: { clientId: null }, required: false, include: [ParameterNormalRange] }],
    order: [['testCode', 'ASC']],
  });

  const rows = [];
  for (const t of tests) {
    const params = t.ParameterMasters || [];
    if (params.length === 0) {
      rows.push({
        TEST_CODE: t.testCode, TEST_NAME: t.testName, TEST_CATEGORY: t.category || '', SAMPLE_TYPE: t.sampleType || '',
        PARAMETER_NAME: '', UNIT: '', METHOD: '', IS_INTERPRETATION: '',
        NORMAL_RANGE_LOW: '', NORMAL_RANGE_HIGH: '', GENDER: '', AGE_MIN: '', AGE_MAX: '', AGE_UNIT: '', RANGE_LOW: '', RANGE_HIGH: '',
      });
      continue;
    }
    for (const p of params) {
      const base = {
        TEST_CODE: t.testCode, TEST_NAME: t.testName, TEST_CATEGORY: t.category || '', SAMPLE_TYPE: t.sampleType || '',
        PARAMETER_NAME: p.parameterName,
        UNIT: p.unit || '', METHOD: p.method || '', IS_INTERPRETATION: p.isInterpretation ? 'Y' : '',
        NORMAL_RANGE_LOW: p.normalRangeLow || '', NORMAL_RANGE_HIGH: p.normalRangeHigh || '',
      };
      const ranges = p.ParameterNormalRanges || [];
      if (ranges.length === 0) {
        rows.push({ ...base, GENDER: '', AGE_MIN: '', AGE_MAX: '', AGE_UNIT: '', RANGE_LOW: '', RANGE_HIGH: '' });
      } else {
        for (const r of ranges) {
          rows.push({
            ...base, GENDER: r.gender, AGE_MIN: r.ageMin ?? '', AGE_MAX: r.ageMax ?? '', AGE_UNIT: r.ageUnit || 'Years',
            RANGE_LOW: r.normalRangeLow || '', RANGE_HIGH: r.normalRangeHigh || '',
          });
        }
      }
    }
  }
  if (rows.length === 0) {
    rows.push(
      {
        TEST_CODE: 'CBC001', TEST_NAME: 'Complete Blood Count', TEST_CATEGORY: 'Haematology', SAMPLE_TYPE: 'Blood',
        PARAMETER_NAME: 'Hemoglobin', UNIT: 'g/dL', METHOD: 'Photometry', IS_INTERPRETATION: '',
        NORMAL_RANGE_LOW: '13', NORMAL_RANGE_HIGH: '17', GENDER: '', AGE_MIN: '', AGE_MAX: '', AGE_UNIT: '', RANGE_LOW: '', RANGE_HIGH: '',
      },
      {
        TEST_CODE: 'CBC001', TEST_NAME: 'Complete Blood Count', TEST_CATEGORY: 'Haematology', SAMPLE_TYPE: 'Blood',
        PARAMETER_NAME: 'Hemoglobin', UNIT: 'g/dL', METHOD: 'Photometry', IS_INTERPRETATION: '',
        NORMAL_RANGE_LOW: '13', NORMAL_RANGE_HIGH: '17', GENDER: 'Male', AGE_MIN: '18', AGE_MAX: '60', AGE_UNIT: 'Years', RANGE_LOW: '13', RANGE_HIGH: '17',
      },
      {
        TEST_CODE: 'CBC001', TEST_NAME: 'Complete Blood Count', TEST_CATEGORY: 'Haematology', SAMPLE_TYPE: 'Blood',
        PARAMETER_NAME: 'Hemoglobin', UNIT: 'g/dL', METHOD: 'Photometry', IS_INTERPRETATION: '',
        NORMAL_RANGE_LOW: '13', NORMAL_RANGE_HIGH: '17', GENDER: 'Female', AGE_MIN: '18', AGE_MAX: '60', AGE_UNIT: 'Years', RANGE_LOW: '12', RANGE_HIGH: '15',
      },
      {
        TEST_CODE: 'WIDAL001', TEST_NAME: 'Widal Test', TEST_CATEGORY: 'Serology', SAMPLE_TYPE: 'Blood',
        PARAMETER_NAME: 'Interpretation', UNIT: '', METHOD: 'Slide Agglutination', IS_INTERPRETATION: 'Y',
        NORMAL_RANGE_LOW: '', NORMAL_RANGE_HIGH: '', GENDER: '', AGE_MIN: '', AGE_MAX: '', AGE_UNIT: '', RANGE_LOW: '', RANGE_HIGH: '',
      },
    );
  }

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Tests & Parameters');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="test-parameter-template.xlsx"');
  return res.send(buffer);
}

/**
 * Parses an uploaded Excel/CSV and validates each row, without writing
 * anything yet. Columns: TEST_CODE, TEST_NAME, TEST_CATEGORY, SAMPLE_TYPE,
 * PARAMETER_NAME, UNIT, METHOD, IS_INTERPRETATION, NORMAL_RANGE_LOW,
 * NORMAL_RANGE_HIGH, GENDER, AGE_MIN, AGE_MAX, AGE_UNIT, RANGE_LOW,
 * RANGE_HIGH. IS_INTERPRETATION ("Y" or blank) marks a qualitative
 * free-text parameter (e.g. a Widal conclusion) - its NORMAL_RANGE/RANGE_*
 * columns are ignored even if filled in. TEST_CATEGORY/SAMPLE_TYPE
 * only take effect the first time a TEST_CODE is created - they're test-level,
 * not per-row, so they're ignored on a row for a test that already exists.
 * A row with no PARAMETER_NAME just ensures the test
 * exists. A row whose RANGE_LOW/RANGE_HIGH are filled in adds an age/gender-
 * specific rule to that parameter (multiple rows can target the same
 * TEST_CODE+PARAMETER_NAME to add several rules). Step 1 of Preview ->
 * Validate -> Commit.
 */
async function previewUpload(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Excel/CSV file is required' });

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const existingTests = await TestMaster.findAll({
    include: [{ model: ParameterMaster, where: { clientId: null }, required: false }],
  });
  // Seeded from the database, then updated as rows are walked below - so a
  // brand-new test's first row (which introduces it) doesn't make every one
  // of its *other* rows in this same upload (its other parameters, or extra
  // age/gender range rows for the same parameter) look like they're each
  // creating ANOTHER new test/parameter too. Mirrors what commitUpload's
  // real findOrCreate calls do against the live database, row by row.
  const seenParamsByTestCode = new Map(existingTests.map((t) => [
    t.testCode, new Set(t.ParameterMasters.map((p) => p.parameterName.toLowerCase())),
  ]));

  const preview = rows.map((r, idx) => {
    const testCode = String(r.TEST_CODE || '').trim();
    const testName = String(r.TEST_NAME || '').trim();
    const testCategory = String(r.TEST_CATEGORY || '').trim();
    const sampleType = String(r.SAMPLE_TYPE || '').trim();
    const parameterName = String(r.PARAMETER_NAME || '').trim();
    const unit = String(r.UNIT || '').trim();
    const method = String(r.METHOD || '').trim();
    const isInterpretation = String(r.IS_INTERPRETATION || '').trim().toUpperCase() === 'Y';
    const normalRangeLow = String(r.NORMAL_RANGE_LOW || '').trim();
    const normalRangeHigh = String(r.NORMAL_RANGE_HIGH || '').trim();
    const gender = String(r.GENDER || '').trim();
    const ageMin = String(r.AGE_MIN ?? '').trim();
    const ageMax = String(r.AGE_MAX ?? '').trim();
    const ageUnit = String(r.AGE_UNIT || '').trim();
    const rangeLow = String(r.RANGE_LOW || '').trim();
    const rangeHigh = String(r.RANGE_HIGH || '').trim();
    const hasRangeRule = !!(rangeLow || rangeHigh);

    const errors = [];
    if (!testCode) errors.push('TEST_CODE is missing');
    if (!testName) errors.push('TEST_NAME is missing');
    if (hasRangeRule && !parameterName) errors.push('PARAMETER_NAME is required to add an age/gender range');
    if (gender && !GENDER_OPTIONS.includes(gender)) errors.push(`GENDER must be one of ${GENDER_OPTIONS.join(', ')}`);
    if (ageUnit && !AGE_UNIT_OPTIONS.includes(ageUnit)) errors.push(`AGE_UNIT must be one of ${AGE_UNIT_OPTIONS.join(', ')}`);

    const isNewTest = testCode && !seenParamsByTestCode.has(testCode);
    const paramAlreadyExists = !isNewTest && parameterName
      && seenParamsByTestCode.get(testCode).has(parameterName.toLowerCase());

    let action;
    if (hasRangeRule) {
      action = `Add ${gender || 'Any'} range rule${paramAlreadyExists ? '' : ' (+ new parameter)'}`;
    } else if (parameterName) {
      action = paramAlreadyExists ? 'Parameter already exists — skipped' : (isNewTest ? 'New test + parameter' : 'Add parameter');
    } else {
      action = isNewTest ? 'New test (no parameter)' : 'Test already exists';
    }

    // This row's test/parameter now "exist" for every later row in this same
    // upload, exactly like commitUpload's findOrCreate would see them.
    if (testCode) {
      if (!seenParamsByTestCode.has(testCode)) seenParamsByTestCode.set(testCode, new Set());
      if (parameterName) seenParamsByTestCode.get(testCode).add(parameterName.toLowerCase());
    }

    return {
      row: idx + 2, // account for header row
      testCode, testName, testCategory, sampleType, parameterName, unit, method, isInterpretation, normalRangeLow, normalRangeHigh,
      gender, ageMin, ageMax, ageUnit, rangeLow, rangeHigh,
      isNewTest,
      action,
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

// POST /api/admin/masters/tests/upload/commit  { rows: [{ testCode, testName, parameterName, unit,
//   method, normalRangeLow, normalRangeHigh, gender, ageMin, ageMax, ageUnit, rangeLow, rangeHigh }] }
async function commitUpload(req, res) {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'rows array is required' });
  }

  const results = { testsCreated: 0, parametersAdded: 0, rangesAdded: 0, skipped: 0, errors: [] };
  for (const row of rows) {
    const testCode = String(row.testCode || '').trim();
    const testName = String(row.testName || '').trim();
    if (!testCode || !testName) {
      results.errors.push({ testCode, reason: 'Missing TEST_CODE or TEST_NAME' });
      continue;
    }

    const [test, testCreated] = await TestMaster.findOrCreate({
      where: { testCode },
      defaults: { testName, category: row.testCategory || null, sampleType: row.sampleType || null },
    });
    if (testCreated) results.testsCreated += 1;

    const parameterName = String(row.parameterName || '').trim();
    if (!parameterName) continue;

    const [parameter, paramCreated] = await ParameterMaster.findOrCreate({
      where: { testId: test.id, parameterName, clientId: null },
      defaults: {
        parameterCode: await generateParameterCode(),
        unit: row.unit, method: row.method, isInterpretation: !!row.isInterpretation,
        normalRangeLow: row.normalRangeLow, normalRangeHigh: row.normalRangeHigh,
      },
    });
    // Range rules don't apply to a qualitative/free-text interpretation parameter.
    const hasRangeRule = !parameter.isInterpretation && !!(String(row.rangeLow || '').trim() || String(row.rangeHigh || '').trim());
    if (paramCreated) results.parametersAdded += 1;
    else if (!hasRangeRule) results.skipped += 1;

    if (hasRangeRule) {
      const gender = String(row.gender || '').trim() || 'Any';
      const ageUnit = String(row.ageUnit || '').trim() || 'Years';
      const ageMin = row.ageMin === '' || row.ageMin == null ? null : Number(row.ageMin);
      const ageMax = row.ageMax === '' || row.ageMax == null ? null : Number(row.ageMax);
      const [, rangeCreated] = await ParameterNormalRange.findOrCreate({
        where: {
          parameterId: parameter.id, gender, ageMin, ageMax, ageUnit,
          normalRangeLow: row.rangeLow || null, normalRangeHigh: row.rangeHigh || null,
        },
        defaults: {},
      });
      if (rangeCreated) results.rangesAdded += 1;
      else results.skipped += 1;
    }
  }

  return res.json(results);
}

module.exports = {
  createTest, listTests, updateTest, addParameter, assignParameter, addNormalRange, deleteNormalRange, reorderParameters,
  downloadTemplate, previewUpload, commitUpload, listTestGroups, createTestGroup,
};
