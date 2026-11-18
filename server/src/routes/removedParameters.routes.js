const router = require('express').Router();
const { authenticate, requireChiefAdminRole } = require('../middleware/auth.middleware');
const { CHIEF_ADMIN_ROLES } = require('../utils/roles');
const ctrl = require('../controllers/removedParameters.controller');

// Chief Admin (ADMIN role) only: a client's removed parameters, and restoring them.
router.use(authenticate, requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN));

router.get('/', ctrl.listRemoved);
router.post('/restore', ctrl.restoreRemoved);

module.exports = router;
