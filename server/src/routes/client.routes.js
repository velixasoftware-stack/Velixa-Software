const router = require('express').Router();
const multer = require('multer');
const { authenticate, requireChiefAdmin, requireChiefAdminRole } = require('../middleware/auth.middleware');
const { CHIEF_ADMIN_ROLES } = require('../utils/roles');
const clientCtrl = require('../controllers/client.controller');
const subCtrl = require('../controllers/subscription.controller');
const userCtrl = require('../controllers/user.controller');
const priceCtrl = require('../controllers/clientTestPrice.controller');
const roleScreenCtrl = require('../controllers/roleScreen.controller');
const paymentCtrl = require('../controllers/payment.controller');

const upload = multer({ storage: multer.memoryStorage() });

// All routes here are Chief Admin only.
router.use(authenticate, requireChiefAdmin);

router.post('/', clientCtrl.createClient);
router.get('/', clientCtrl.listClients);
router.get('/marketing-persons', clientCtrl.listMarketingPersons);
router.get('/next-code', clientCtrl.previewNextClientCode);
router.get('/:id', clientCtrl.getClient);
router.put('/:id', clientCtrl.updateClient);
// Opens this client's app as their auto-provisioned support login - ADMIN
// only, since it grants full access to that client's data without a password.
router.post('/:id/impersonate', requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN), clientCtrl.impersonateClient);

router.get('/:clientId/subscriptions', subCtrl.listSubscriptions);
router.get('/:clientId/subscriptions/current', subCtrl.getCurrentSubscription);
// A client that paid Chief Admin directly (outside the app) - ADMIN only, money-touching like role-screens below.
router.post('/:clientId/manual-payment', requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN), paymentCtrl.recordManualPayment);
// This client's lab-billing revenue (money collected from their own patients) - ADMIN only, same as other financial data.
router.get('/:clientId/revenue', requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN), clientCtrl.getClientRevenue);
// A promotional free period for an existing client - ADMIN only, money-related like manual-payment above.
router.post('/:clientId/free-days', requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN), subCtrl.grantFreeDays);

router.post('/:clientId/users', userCtrl.createUser);
router.get('/:clientId/users', userCtrl.listUsers);
router.put('/:clientId/users/:userId', userCtrl.updateUser);
router.post('/:clientId/users/:userId/signature', upload.single('signature'), userCtrl.uploadSignature);

router.get('/:clientId/test-prices', priceCtrl.listPrices);
router.put('/:clientId/test-prices', priceCtrl.setPrice);
router.post('/:clientId/test-prices/upload/preview', upload.single('file'), priceCtrl.previewUpload);
router.post('/:clientId/test-prices/upload/commit', priceCtrl.commitUpload);

// Role -> screen access for this one client's staff - Chief Admin (ADMIN role) only,
// not Marketing, matching /role-screen-defaults' restriction on the platform-wide baseline.
const requireAdminRole = requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN);
router.get('/:clientId/role-screens', requireAdminRole, roleScreenCtrl.getClientRoleScreensForAdmin);
router.put('/:clientId/role-screens', requireAdminRole, roleScreenCtrl.updateClientRoleScreensForAdmin);

module.exports = router;
