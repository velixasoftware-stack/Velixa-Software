const router = require('express').Router();
const { authenticate, requireChiefAdminRole } = require('../middleware/auth.middleware');
const { CHIEF_ADMIN_ROLES } = require('../utils/roles');
const ctrl = require('../controllers/clientCopy.controller');

// Chief Admin (ADMIN role): copy one client's own tests setup - parameters,
// normal ranges, labels, specimens, prices - to another client.
router.use(authenticate, requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN));

router.get('/preview', ctrl.previewCopy);
router.post('/', ctrl.runCopy);

module.exports = router;
