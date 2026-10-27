const { Op } = require('sequelize');
const { PatientTitle } = require('../models');

// Offered out of the box so the billing dropdown is never empty - Chief Admin
// can add more or delete these. Only seeded while the table is empty.
const DEFAULT_TITLES = ['Mr.', 'Mrs.', 'Ms.', 'Miss', 'Master', 'Baby', 'Dr.'];

async function seedDefaultPatientTitles() {
  if (await PatientTitle.count() > 0) return;
  await PatientTitle.bulkCreate(DEFAULT_TITLES.map((name, i) => ({ name, sequence: i + 1, createdBy: 'SYSTEM' })));
}

// GET /api/admin/masters/patient-titles (Chief Admin) and
// GET /api/patients/titles (client billing dropdown) - same list for both.
async function listPatientTitles(req, res) {
  const titles = await PatientTitle.findAll({ attributes: ['id', 'name', 'sequence'], order: [['sequence', 'ASC'], ['name', 'ASC']] });
  return res.json(titles);
}

// POST /api/admin/masters/patient-titles  Body: { name }
async function createPatientTitle(req, res) {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ message: 'Title is required' });
  if (name.length > 20) return res.status(400).json({ message: 'Title cannot be more than 20 characters' });

  const existing = await PatientTitle.findOne({ where: { name: { [Op.iLike]: name } } });
  if (existing) return res.status(409).json({ message: `"${existing.name}" already exists` });

  const sequence = (await PatientTitle.max('sequence')) || 0;
  const title = await PatientTitle.create({ name, sequence: sequence + 1 });
  return res.status(201).json(title);
}

// DELETE /api/admin/masters/patient-titles/:id - patients already saved with
// this title keep it (Patient.title is plain text); it just stops being offered.
async function deletePatientTitle(req, res) {
  const deleted = await PatientTitle.destroy({ where: { id: req.params.id } });
  if (!deleted) return res.status(404).json({ message: 'Title not found' });
  return res.status(204).end();
}

module.exports = { seedDefaultPatientTitles, listPatientTitles, createPatientTitle, deletePatientTitle };
