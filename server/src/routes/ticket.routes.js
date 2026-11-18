const router = require('express').Router();
const { authenticate, chiefAdminScreensFor } = require('../middleware/auth.middleware');
const ticketCtrl = require('../controllers/ticket.controller');

// Tickets are attended to by the Chief Admin's ADMIN, or sales staff whose role
// has the Tickets screen (their own assigned clients only - see ticket.controller),
// or a client's own ADMIN.
async function requireChiefAdminOrClientAdmin(req, res, next) {
  if (req.user.type === 'CHIEF_ADMIN' && (await chiefAdminScreensFor(req)).includes('tickets')) return next();
  if (req.user.type === 'CLIENT_USER' && (req.user.roles || []).includes('ADMIN')) return next();
  return res.status(403).json({ message: 'Only an Admin can manage tickets' });
}

router.use(authenticate);

// Any logged-in client user can raise a ticket, even while payment is pending.
router.post('/', ticketCtrl.createTicket);
// A Chief Admin sales user sees tickets only when their role has the Tickets screen.
router.get('/', async (req, res, next) => {
  if (req.user.type === 'CHIEF_ADMIN' && !(await chiefAdminScreensFor(req)).includes('tickets')) {
    return res.status(403).json({ message: 'This screen is not assigned to your role' });
  }
  return next();
}, ticketCtrl.listTickets);
router.put('/:id/assign', requireChiefAdminOrClientAdmin, ticketCtrl.assignTicket);
router.put('/:id/resolve', requireChiefAdminOrClientAdmin, ticketCtrl.resolveTicket);
router.put('/:id/close', requireChiefAdminOrClientAdmin, ticketCtrl.closeTicket);

module.exports = router;
