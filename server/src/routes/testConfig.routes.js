const router = require('express').Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { ROLES } = require('../utils/roles');
const testCtrl = require('../controllers/testMaster.controller');
const shortNameCtrl = require('../controllers/clientTestShortName.controller');

const upload = multer({ storage: multer.memoryStorage() });

// Separate from master.routes.js (which stays MASTER_MANAGER-only) so a
// Manager can create their own client-private parameters and test short
// names without gaining access to Test Master creation, pricing or packages.
router.use(authenticate, requireActiveSubscription, requireRole(ROLES.MANAGER, ROLES.MASTER_MANAGER));

router.get('/tests', testCtrl.listTests);
router.post('/tests/:testId/parameters', testCtrl.addParameter);
router.post('/tests/:testId/parameters/:parameterId/assign', testCtrl.assignParameter);
router.put('/tests/:testId/parameter-order', testCtrl.reorderParameters);
router.put('/tests/:testId/parameters/:parameterId/sequence', testCtrl.setParameterSequence);
router.delete('/tests/:testId/parameters/:parameterId', testCtrl.removeParameter);
router.post('/parameters/:parameterId/ranges', testCtrl.addNormalRange);
router.delete('/parameters/:parameterId/ranges/:rangeId', testCtrl.deleteNormalRange);

router.get('/test-shortname', shortNameCtrl.listShortNames);
router.put('/test-shortname', shortNameCtrl.setShortName);
router.get('/test-shortname/template', shortNameCtrl.downloadTemplate);
router.post('/test-shortname/upload/preview', upload.single('file'), shortNameCtrl.previewUpload);
router.post('/test-shortname/upload/commit', shortNameCtrl.commitUpload);

module.exports = router;
