const { Ticket, Client } = require('../models');

// POST /api/tickets  (client user opens a ticket)
async function createTicket(req, res) {
  const { clientId } = req.user;
  const { subject, description } = req.body;
  if (!subject) return res.status(400).json({ message: 'subject is required' });

  const ticket = await Ticket.create({ clientId, subject, description, status: 'OPEN' });
  return res.status(201).json(ticket);
}

// GET /api/tickets  (Chief Admin ADMIN role sees all, client user sees own client's)
async function listTickets(req, res) {
  if (req.user.type === 'CHIEF_ADMIN' && !(req.user.roles || []).includes('ADMIN')) {
    return res.status(403).json({ message: 'Only the Chief Admin ADMIN role can view tickets' });
  }

  const where = req.user.type === 'CLIENT_USER' ? { clientId: req.user.clientId } : {};
  const { status } = req.query;
  if (status) where.status = status;

  const tickets = await Ticket.findAll({ where, include: [Client], order: [['createdAt', 'DESC']] });
  return res.json(tickets);
}

// PUT /api/tickets/:id/assign  (Admin)
async function assignTicket(req, res) {
  const { assignedTo } = req.body;
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
  await ticket.update({ assignedTo, status: 'ASSIGNED' });
  return res.json(ticket);
}

// PUT /api/tickets/:id/resolve
async function resolveTicket(req, res) {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
  await ticket.update({ status: 'RESOLVED' });
  return res.json(ticket);
}

// PUT /api/tickets/:id/close
async function closeTicket(req, res) {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
  await ticket.update({ status: 'CLOSED' });
  return res.json(ticket);
}

module.exports = { createTicket, listTickets, assignTicket, resolveTicket, closeTicket };
