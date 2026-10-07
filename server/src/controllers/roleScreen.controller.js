const { RoleScreenDefault, ClientRoleScreen } = require('../models');
const { ALL_SCREEN_KEYS, CONFIGURABLE_ROLES, BUILTIN_ROLE_SCREEN_DEFAULTS } = require('../utils/roles');

/** The platform-wide baseline: a RoleScreenDefault row if one's been saved, else the built-in fallback. */
async function getDefaultsMap() {
  const rows = await RoleScreenDefault.findAll();
  const map = { ...BUILTIN_ROLE_SCREEN_DEFAULTS };
  for (const row of rows) map[row.role] = row.screens;
  return map;
}

async function getOverrideMap(clientId) {
  const rows = await ClientRoleScreen.findAll({ where: { clientId } });
  return Object.fromEntries(rows.map((r) => [r.role, r.screens]));
}

/**
 * Combines a client's saved override with the current platform default,
 * always intersecting against the default - so if Chief Admin later tightens
 * the default after a client saved a wider override, the client's effective
 * access shrinks immediately too, without needing them to resave anything.
 */
function computeEffective(defaults, overrides) {
  const effective = {};
  for (const role of CONFIGURABLE_ROLES) {
    const allowed = defaults[role] || [];
    const chosen = overrides[role] ?? allowed;
    effective[role] = chosen.filter((s) => allowed.includes(s));
  }
  return effective;
}

// GET /api/role-screen-defaults  (Chief Admin, ADMIN only)
async function getRoleScreenDefaults(req, res) {
  const defaults = await getDefaultsMap();
  return res.json({ roles: CONFIGURABLE_ROLES, screens: ALL_SCREEN_KEYS, defaults });
}

// PUT /api/role-screen-defaults  { role, screens: [...] }
async function updateRoleScreenDefault(req, res) {
  const { role, screens } = req.body;
  if (!CONFIGURABLE_ROLES.includes(role)) {
    return res.status(400).json({ message: 'Unknown or non-configurable role' });
  }
  const screenList = Array.isArray(screens) ? screens : [];
  const invalid = screenList.filter((s) => !ALL_SCREEN_KEYS.includes(s));
  if (invalid.length) return res.status(400).json({ message: `Unknown screen(s): ${invalid.join(', ')}` });

  const [row] = await RoleScreenDefault.findOrCreate({ where: { role }, defaults: { screens: screenList } });
  if (JSON.stringify(row.screens) !== JSON.stringify(screenList)) await row.update({ screens: screenList });
  return res.json({ role, screens: screenList });
}

// GET /api/role-screens  (Client ADMIN - their own client, scoped via JWT)
async function getClientRoleScreens(req, res) {
  const clientId = req.user.clientId;
  const [defaults, overrides] = await Promise.all([getDefaultsMap(), getOverrideMap(clientId)]);
  const effective = computeEffective(defaults, overrides);
  return res.json({ roles: CONFIGURABLE_ROLES, screens: ALL_SCREEN_KEYS, defaults, effective });
}

// PUT /api/role-screens  { role, screens: [...] }
// A client can only ever narrow the platform default for a role, never widen it.
async function updateClientRoleScreens(req, res) {
  const clientId = req.user.clientId;
  const { role, screens } = req.body;
  if (!CONFIGURABLE_ROLES.includes(role)) {
    return res.status(400).json({ message: 'Unknown or non-configurable role' });
  }
  const screenList = Array.isArray(screens) ? screens : [];
  const defaults = await getDefaultsMap();
  const allowed = new Set(defaults[role] || []);
  const invalid = screenList.filter((s) => !allowed.has(s));
  if (invalid.length) {
    return res.status(400).json({ message: `Your platform plan does not allow enabling: ${invalid.join(', ')}` });
  }

  const [row] = await ClientRoleScreen.findOrCreate({ where: { clientId, role }, defaults: { screens: screenList } });
  if (JSON.stringify(row.screens) !== JSON.stringify(screenList)) await row.update({ screens: screenList });
  return res.json({ role, screens: screenList });
}

// GET /api/role-screens/effective  (any authenticated Client User - builds their own nav)
async function getEffectiveRoleScreens(req, res) {
  const clientId = req.user.clientId;
  const [defaults, overrides] = await Promise.all([getDefaultsMap(), getOverrideMap(clientId)]);
  return res.json(computeEffective(defaults, overrides));
}

// GET /api/clients/:clientId/role-screens  (Chief Admin, ADMIN only - same override
// a client's own ADMIN sets via /role-screens, but settable by Chief Admin for any client).
async function getClientRoleScreensForAdmin(req, res) {
  const clientId = Number(req.params.clientId);
  const [defaults, overrides] = await Promise.all([getDefaultsMap(), getOverrideMap(clientId)]);
  const effective = computeEffective(defaults, overrides);
  return res.json({ roles: CONFIGURABLE_ROLES, screens: ALL_SCREEN_KEYS, defaults, effective });
}

// PUT /api/clients/:clientId/role-screens  { role, screens: [...] }
async function updateClientRoleScreensForAdmin(req, res) {
  const clientId = Number(req.params.clientId);
  const { role, screens } = req.body;
  if (!CONFIGURABLE_ROLES.includes(role)) {
    return res.status(400).json({ message: 'Unknown or non-configurable role' });
  }
  const screenList = Array.isArray(screens) ? screens : [];
  const defaults = await getDefaultsMap();
  const allowed = new Set(defaults[role] || []);
  const invalid = screenList.filter((s) => !allowed.has(s));
  if (invalid.length) {
    return res.status(400).json({ message: `Not part of the platform default for this role: ${invalid.join(', ')}` });
  }

  const [row] = await ClientRoleScreen.findOrCreate({ where: { clientId, role }, defaults: { screens: screenList } });
  if (JSON.stringify(row.screens) !== JSON.stringify(screenList)) await row.update({ screens: screenList });
  return res.json({ role, screens: screenList });
}

module.exports = {
  getRoleScreenDefaults, updateRoleScreenDefault, getClientRoleScreens, updateClientRoleScreens, getEffectiveRoleScreens,
  getClientRoleScreensForAdmin, updateClientRoleScreensForAdmin,
};
