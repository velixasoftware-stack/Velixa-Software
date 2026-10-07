const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { ROLES } = require('../utils/roles');
const labCtrl = require('../controllers/lab.controller');

router.use(authenticate, requireActiveSubscription, requireRole(ROLES.LAB_USER));

router.get('/samples', labCtrl.listSamples);
router.get('/samples/:id', labCtrl.getSample);
router.post('/samples/:id/collect', labCtrl.collectSample);
router.post('/samples/:id/results', labCtrl.enterResults);
router.post('/samples/:id/verify', labCtrl.verifySample);
router.post('/samples/:id/release', labCtrl.releaseSample);
router.put('/samples/:id/revoke', labCtrl.revokeReport);

module.exports = router;
