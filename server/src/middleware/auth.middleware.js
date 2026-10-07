const { verifyToken } = require('../utils/jwt');
const { ChiefAdmin, ClientUser, Client, Role } = require('../models');
const { runWithActor } = require('../utils/auditContext');

/**
 * Verifies the JWT and attaches `req.user`, re-deriving roles/active status
 * from the database on every request rather than trusting whatever was
 * baked into the token at login time. Without this, revoking a role or
 * deactivating a user would have no effect until that token expired or the
 * user logged in again - a stale-permissions bug, not just a UX gap.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Authentication token missing' });

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }

  if (payload.type === 'CHIEF_ADMIN') {
    const admin = await ChiefAdmin.findByPk(payload.id, { include: [Role] });
    if (!admin || !admin.active) {
      return res.status(401).json({ message: 'This account is no longer active' });
    }
    if (admin.currentSessionId !== payload.sessionId) {
      return res.status(401).json({ message: 'You have been logged out because this account signed in elsewhere' });
    }
    req.user = { ...payload, roles: admin.Roles.map((r) => r.name) };
    return runWithActor(`${admin.username} (CHIEF_ADMIN)`, next);
  }

  if (payload.type === 'CLIENT_USER') {
    const user = await ClientUser.findByPk(payload.id, { include: [Role, Client] });
    if (!user || !user.active || !user.Client || !user.Client.active) {
      return res.status(401).json({ message: 'This account is no longer active' });
    }
    if (user.currentSessionId !== payload.sessionId) {
      return res.status(401).json({ message: 'You have been logged out because this account signed in elsewhere' });
    }
    req.user = { ...payload, roles: user.Roles.map((r) => r.name) };
    return runWithActor(`${user.username} (${user.Client.clientCode})`, next);
  }

  return res.status(401).json({ message: 'Invalid token' });
}

function requireChiefAdmin(req, res, next) {
  if (req.user?.type !== 'CHIEF_ADMIN') {
    return res.status(403).json({ message: 'Chief Admin access required' });
  }
  return next();
}

/** Restricts a route to Chief-Admin-side staff holding at least one of the given roles. */
function requireChiefAdminRole(...allowedRoles) {
  return (req, res, next) => {
    if (req.user?.type !== 'CHIEF_ADMIN') {
      return res.status(403).json({ message: 'Chief Admin access required' });
    }
    const userRoles = req.user.roles || [];
    if (userRoles.some((r) => allowedRoles.includes(r))) {
      return next();
    }
    return res.status(403).json({ message: 'You do not have permission to access this screen' });
  };
}

module.exports = { authenticate, requireChiefAdmin, requireChiefAdminRole };
