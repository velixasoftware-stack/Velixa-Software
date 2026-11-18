const router = require('express').Router();
const { authenticate, requireChiefAdminScreen } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/roleScreen.controller');

// The platform-wide baseline is Chief-Admin (ADMIN) territory only.
// ADMIN, or a sales role given the Role Screen Defaults screen.
router.use(authenticate, requireChiefAdminScreen('role-screen-defaults'));

router.get('/', ctrl.getRoleScreenDefaults);
router.put('/', ctrl.updateRoleScreenDefault);

module.exports = router;
