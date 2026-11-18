const router = require('express').Router();
const { authenticate, requireChiefAdminScreen, clientsAssignedToRequester } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/removedParameters.controller');

// ADMIN, or a sales role given the screen - its own clients only.
router.use(authenticate, requireChiefAdminScreen('removed-parameters'));
router.use(async (req, res, next) => {
  if (await clientsAssignedToRequester(req, [req.query.clientId, req.body?.clientId].filter(Boolean))) return next();
  return res.status(403).json({ message: 'This client is not assigned to you' });
});

router.get('/', ctrl.listRemoved);
router.post('/restore', ctrl.restoreRemoved);

module.exports = router;
