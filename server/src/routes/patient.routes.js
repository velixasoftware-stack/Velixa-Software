const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { ROLES } = require('../utils/roles');
const patientCtrl = require('../controllers/patient.controller');

router.use(authenticate, requireActiveSubscription, requireRole(ROLES.FRONT_OFFICE));

router.post('/', patientCtrl.createPatient);
router.put('/:id', patientCtrl.updatePatient);
router.get('/', patientCtrl.listPatients);
router.get('/lookup', patientCtrl.lookupPatient);

module.exports = router;
