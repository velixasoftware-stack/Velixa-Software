const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { ROLES } = require('../utils/roles');
const ctrl = require('../controllers/doctorCommission.controller');

// Referral doctor commission - the clinic's MANAGER (and ADMIN), like Payor Invoices.
router.use(authenticate, requireActiveSubscription, requireRole(ROLES.MANAGER));

router.get('/doctors', ctrl.listDoctors);
router.get('/doctors/:doctorId/rates', ctrl.getDoctorRates);
router.put('/doctors/:doctorId/rates', ctrl.saveDoctorRates);
router.get('/preview', ctrl.preview);
router.get('/statements', ctrl.listStatements);
router.post('/statements', ctrl.generateStatements);
router.get('/statements/:id', ctrl.getStatement);
router.put('/statements/:id/pay', ctrl.markPaid);
router.delete('/statements/:id', ctrl.cancelStatement);

module.exports = router;
