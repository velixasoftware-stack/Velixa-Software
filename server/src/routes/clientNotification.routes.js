const router = require('express').Router();
const { authenticate, requireChiefAdminRole } = require('../middleware/auth.middleware');
const { CHIEF_ADMIN_ROLES } = require('../utils/roles');
const ctrl = require('../controllers/clientNotification.controller');

// Chief Admin (ADMIN role) only: each client's messaging accounts hold
// passwords/tokens, so this isn't assignable to sales roles.
router.use(authenticate, requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN));

router.get('/:clientId', ctrl.getConfig);
router.put('/:clientId', ctrl.saveConfig);
router.post('/:clientId/test', ctrl.testSend);
router.get('/:clientId/logs', ctrl.listLogs);

module.exports = router;
