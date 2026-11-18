const {
  Client, TestMaster, ParameterMaster, ClientHiddenParameter,
} = require('../models');

/**
 * Chief Admin: parameters a client removed, and bringing them back. Client
 * users can remove parameters but not restore them.
 *  - kind 'hidden': a Chief Admin (universal) parameter the client removed
 *    from one test for its lab only (ClientHiddenParameter)
 *  - kind 'own':    a parameter the client added itself and then removed
 *    (ParameterMaster active = false)
 */

// GET /api/admin/removed-parameters?clientId=
async function listRemoved(req, res) {
  const clientId = Number(req.query.clientId);
  if (!clientId) return res.status(400).json({ message: 'Select a client' });
  const client = await Client.findByPk(clientId, { attributes: ['id', 'clientCode', 'clientName'] });
  if (!client) return res.status(404).json({ message: 'Client not found' });

  const hidden = await ClientHiddenParameter.findAll({
    where: { clientId },
    include: [
      { model: TestMaster, attributes: ['id', 'testCode', 'testName'] },
      { model: ParameterMaster, attributes: ['id', 'parameterName', 'unit'] },
    ],
  });
  const own = await ParameterMaster.findAll({
    where: { clientId, active: false },
    include: [{ model: TestMaster, attributes: ['id', 'testCode', 'testName'] }],
  });

  const rows = [
    ...hidden.filter((h) => h.TestMaster && h.ParameterMaster).map((h) => ({
      kind: 'hidden', testId: h.testId, parameterId: h.parameterId,
      testCode: h.TestMaster.testCode, testName: h.TestMaster.testName,
      parameterName: h.ParameterMaster.parameterName, unit: h.ParameterMaster.unit,
      removedBy: h.createdBy || null, removedAt: h.createdAt,
    })),
    ...own.filter((p) => p.TestMaster).map((p) => ({
      kind: 'own', testId: p.testId, parameterId: p.id,
      testCode: p.TestMaster.testCode, testName: p.TestMaster.testName,
      parameterName: p.parameterName, unit: p.unit,
      removedBy: p.updatedBy || null, removedAt: p.updatedAt,
    })),
  ].sort((a, b) => a.testName.localeCompare(b.testName) || a.parameterName.localeCompare(b.parameterName));

  return res.json({ client, rows });
}

// POST /api/admin/removed-parameters/restore  { clientId, kind, testId, parameterId }
async function restoreRemoved(req, res) {
  const clientId = Number(req.body.clientId);
  const testId = Number(req.body.testId);
  const parameterId = Number(req.body.parameterId);
  const { kind } = req.body;
  if (!clientId || !parameterId) return res.status(400).json({ message: 'clientId and parameterId are required' });

  if (kind === 'hidden') {
    const removed = await ClientHiddenParameter.destroy({ where: { clientId, testId, parameterId } });
    if (!removed) return res.status(404).json({ message: 'That parameter is not removed for this client' });
    return res.json({ message: 'Parameter restored to the test for this client' });
  }
  if (kind === 'own') {
    const parameter = await ParameterMaster.findOne({ where: { id: parameterId, clientId, active: false } });
    if (!parameter) return res.status(404).json({ message: 'That removed parameter was not found for this client' });
    await parameter.update({ active: true });
    return res.json({ message: 'Parameter restored for this client' });
  }
  return res.status(400).json({ message: 'Unknown kind of removed parameter' });
}

module.exports = { listRemoved, restoreRemoved };
