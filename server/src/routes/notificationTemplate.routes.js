const router = require('express').Router();
const { authenticate, requireChiefAdminScreen } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/notificationTemplate.controller');

// ADMIN, or a sales role given the Integrations screen.
router.use(authenticate, requireChiefAdminScreen('integrations'));

router.get('/', ctrl.listTemplates);
router.post('/', ctrl.createTemplate);
router.put('/:id', ctrl.updateTemplate);
router.delete('/:id', ctrl.deleteTemplate);

module.exports = router;
