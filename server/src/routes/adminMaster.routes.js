const router = require('express').Router();
const multer = require('multer');
const { authenticate, requireChiefAdminRole } = require('../middleware/auth.middleware');
const { CHIEF_ADMIN_ROLES } = require('../utils/roles');
const testCtrl = require('../controllers/testMaster.controller');

const upload = multer({ storage: multer.memoryStorage() });

// Chief Admin can also manage the global Test Master (same central data
// client-side MASTER_MANAGER users manage under /api/masters/tests).
// Restricted to the ADMIN role - Marketing staff don't touch master data.
router.use(authenticate, requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN));

router.get('/groups', testCtrl.listTestGroups);
router.post('/groups', testCtrl.createTestGroup);

router.get('/tests', testCtrl.listTests);
router.post('/tests', testCtrl.createTest);
router.put('/tests/:id', testCtrl.updateTest);
router.post('/tests/:testId/parameters', testCtrl.addParameter);
router.post('/tests/:testId/parameters/:parameterId/assign', testCtrl.assignParameter);
router.put('/tests/:testId/parameter-order', testCtrl.reorderParameters);
router.put('/tests/:testId/parameters/:parameterId/sequence', testCtrl.setParameterSequence);
router.delete('/tests/:testId/parameters/:parameterId', testCtrl.removeParameter);
router.post('/parameters/:parameterId/ranges', testCtrl.addNormalRange);
router.delete('/parameters/:parameterId/ranges/:rangeId', testCtrl.deleteNormalRange);

router.get('/tests/template', testCtrl.downloadTemplate);
router.post('/tests/upload/preview', upload.single('file'), testCtrl.previewUpload);
router.post('/tests/upload/commit', testCtrl.commitUpload);

module.exports = router;
