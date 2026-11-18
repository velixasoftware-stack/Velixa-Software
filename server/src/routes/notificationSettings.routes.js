const router = require('express').Router();
const { authenticate, requireChiefAdminScreen } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/notificationSettings.controller');

// ADMIN, or a sales role given the Integrations screen.
router.use(authenticate, requireChiefAdminScreen('integrations'));

router.get('/', ctrl.getNotificationSettings);
router.put('/', ctrl.updateNotificationSettings);

module.exports = router;
