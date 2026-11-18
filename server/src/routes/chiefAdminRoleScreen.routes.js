const router = require('express').Router();
const {
  authenticate, requireChiefAdmin, requireChiefAdminRole, salesRoleScreens, chiefAdminScreensFor,
} = require('../middleware/auth.middleware');
const { ChiefAdminRoleScreen } = require('../models');
const { CHIEF_ADMIN_ROLES, SALES_ROLES, SALES_SCREEN_KEYS } = require('../utils/roles');

router.use(authenticate, requireChiefAdmin);

// GET /api/chief-admin-role-screens/mine - the screens the signed-in Chief
// Admin user can open (drives their side menu).
router.get('/mine', async (req, res) => res.json({ screens: await chiefAdminScreensFor(req) }));

// Below: ADMIN only - choosing which screens each sales role gets.
router.use(requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN));

// GET /api/chief-admin-role-screens  -> { roles: { MARKETING: [...], MARKETING_LEAD: [...] }, screenKeys }
router.get('/', async (req, res) => res.json({ roles: await salesRoleScreens(), screenKeys: SALES_SCREEN_KEYS }));

// PUT /api/chief-admin-role-screens/:role  { screens: [...] }
router.put('/:role', async (req, res) => {
  const { role } = req.params;
  if (!SALES_ROLES.includes(role)) return res.status(400).json({ message: 'Screens can be set only for Marketing and Marketing Lead' });
  const screens = [...new Set((req.body.screens || []).filter((k) => SALES_SCREEN_KEYS.includes(k)))];
  const [row] = await ChiefAdminRoleScreen.findOrCreate({ where: { role }, defaults: { screens } });
  await row.update({ screens });
  return res.json({ role, screens });
});

module.exports = router;
