const router = require('express').Router();
const { authenticate, requireChiefAdminScreen, clientsAssignedToRequester } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/clientCopy.controller');

// Chief Admin: copy one client's own tests setup - parameters,
// normal ranges, labels, specimens, prices - to another client.
// ADMIN, or a sales role given the screen - and then only between its own clients.
router.use(authenticate, requireChiefAdminScreen('client-setup-copy'));
router.use(async (req, res, next) => {
  const ids = [req.query.fromClientId, req.query.toClientId, req.body?.fromClientId, req.body?.toClientId];
  if (await clientsAssignedToRequester(req, ids.filter(Boolean))) return next();
  return res.status(403).json({ message: 'You can copy only between clients assigned to you' });
});

router.get('/preview', ctrl.previewCopy);
router.post('/', ctrl.runCopy);

module.exports = router;
