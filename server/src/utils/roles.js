// Client-side roles (assigned to ClientUser accounts, scoped to one client).
const ROLES = {
  ADMIN: 'ADMIN',
  FRONT_OFFICE: 'FRONT_OFFICE',
  LAB_USER: 'LAB_USER',
  MANAGER: 'MANAGER',
  MASTER_MANAGER: 'MASTER_MANAGER',
};

const ALL_ROLES = Object.values(ROLES);

// Chief-Admin-side roles (assigned to ChiefAdmin accounts - SaaS operator staff).
// ADMIN reuses the same Role row/name as the client-side ADMIN role; it is a
// distinct grant in practice because ChiefAdmin and ClientUser are separate
// account types checked by separate middleware, never interchangeable.
const CHIEF_ADMIN_ROLES = {
  ADMIN: 'ADMIN',
  MARKETING: 'MARKETING',
  MARKETING_LEAD: 'MARKETING_LEAD',
};

const ALL_CHIEF_ADMIN_ROLES = Object.values(CHIEF_ADMIN_ROLES);

// The sales roles: each user sees only the clients assigned to them (as
// salesPerson). Which Chief Admin screens each sales role gets is set by
// ADMIN (Chief Admin > Sales Role Screens); the Dashboard (their clients) is always on.
const SALES_ROLES = [CHIEF_ADMIN_ROLES.MARKETING, CHIEF_ADMIN_ROLES.MARKETING_LEAD];
// Screens ADMIN may give a sales role - "sales-safe" ones only; setup and
// money screens (Test Master, Data Reset, Integrations ...) stay ADMIN-only.
const SALES_SCREEN_KEYS = ['create-client', 'tickets', 'team-passwords', 'sales-dashboard', 'team-view'];
// Used until ADMIN saves a choice for the role - what MARKETING always had.
const BUILTIN_SALES_ROLE_SCREENS = {
  MARKETING: ['create-client', 'tickets', 'team-passwords', 'sales-dashboard'],
  MARKETING_LEAD: ['create-client', 'tickets', 'team-passwords', 'sales-dashboard', 'team-view'],
};

// Every screen a client-side role can be granted access to, and which of the
// client-side roles have their screen access configurable at all (ADMIN
// always sees everything, by design - it's the role doing the configuring).
const ALL_SCREEN_KEYS = ['masters', 'payors', 'tickets', 'billing', 'orders', 'lab', 'reports', 'report-branding', 'payor-invoices', 'test-parameters', 'pending-tests'];
const CONFIGURABLE_ROLES = [ROLES.FRONT_OFFICE, ROLES.LAB_USER, ROLES.MANAGER, ROLES.MASTER_MANAGER];

// Built-in fallback used the moment a role has no RoleScreenDefault row yet
// (e.g. right after this feature ships, before Chief Admin has saved anything).
// Mirrors the screens each role could already reach before this became configurable.
const BUILTIN_ROLE_SCREEN_DEFAULTS = {
  FRONT_OFFICE: ['billing', 'orders', 'pending-tests'],
  LAB_USER: ['lab', 'pending-tests'],
  MANAGER: ['reports', 'tickets', 'report-branding', 'payor-invoices', 'test-parameters', 'orders', 'pending-tests'],
  MASTER_MANAGER: ['masters', 'payors'],
};

module.exports = {
  ROLES, ALL_ROLES, CHIEF_ADMIN_ROLES, ALL_CHIEF_ADMIN_ROLES,
  ALL_SCREEN_KEYS, CONFIGURABLE_ROLES, BUILTIN_ROLE_SCREEN_DEFAULTS,
  SALES_ROLES, SALES_SCREEN_KEYS, BUILTIN_SALES_ROLE_SCREENS,
};
