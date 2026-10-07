const router = require('express').Router();
const { authenticate, requireChiefAdminRole } = require('../middleware/auth.middleware');
const { CHIEF_ADMIN_ROLES } = require('../utils/roles');
const ctrl = require('../controllers/chiefAdminUser.controller');
const salesReportCtrl = require('../controllers/salesReport.controller');

router.use(authenticate);

// Listing the team and resetting a password (never roles/active) are shared
// between ADMIN and MARKETING, since MARKETING also needs the Reset Password screen.
const teamAccess = requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN, CHIEF_ADMIN_ROLES.MARKETING);
router.get('/', teamAccess, ctrl.listChiefAdminUsers);
router.put('/:id/reset-password', teamAccess, ctrl.resetPassword);

// Everything else that manages Chief-Admin-side staff accounts (creating them,
// editing roles/active status, the sales report) is ADMIN-only.
router.use(requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN));

router.post('/', ctrl.createChiefAdminUser);
router.post('/bulk', ctrl.createChiefAdminUsersBulk);
router.put('/:id', ctrl.updateChiefAdminUser);

router.get('/sales-report', salesReportCtrl.getSalesReport);
router.get('/sales-report/export', salesReportCtrl.exportSalesReport);

module.exports = router;
