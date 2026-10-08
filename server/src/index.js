require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
require('express-async-errors'); // makes thrown/rejected errors in async route handlers reach the error middleware instead of crashing the process
const cors = require('cors');
const helmet = require('helmet');
const { sequelize } = require('./models');
const routes = require('./routes');
const { expireOverdueSubscriptions } = require('./controllers/subscription.controller');
const { backfillSystemUsers } = require('./controllers/client.controller');

const app = express();
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

app.use(helmet({
  // Disabled: the default CSP would block the Razorpay checkout script and
  // other external resources this app loads; a tuned CSP can be added later
  // if needed.
  contentSecurityPolicy: false,
  // Disabled: the client (Netlify) and this API are served from different
  // origins, and the client needs to load /uploads images (logos,
  // letterheads, signatures) cross-origin - the default policy would block that.
  crossOriginResourcePolicy: false,
}));
app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
}));
app.use('/uploads', express.static(UPLOAD_ROOT));

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', routes);

// In production the built React app (app/client/dist) is served by this same
// process, so the whole thing is reachable at one URL - no separate static
// host or CORS setup needed. Any path that isn't /api or /uploads falls
// through to index.html so React Router can handle client-side routes.
const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;

async function start() {
  await sequelize.authenticate();
  await sequelize.sync(); // dev convenience; use real migrations in production
  // sync() above never alters an already-existing table, so a column added to a model after the
  // table was first created has to be added out-of-band here — idempotent, safe to run every boot.
  await sequelize.query('ALTER TABLE parameter_master ADD COLUMN IF NOT EXISTS method VARCHAR(255)');
  await sequelize.query('ALTER TABLE sample ADD COLUMN IF NOT EXISTS remarks TEXT');
  await sequelize.query('ALTER TABLE sample ADD COLUMN IF NOT EXISTS "remarksBig" BOOLEAN NOT NULL DEFAULT false');
  await sequelize.query("ALTER TABLE patient ADD COLUMN IF NOT EXISTS \"ageUnit\" VARCHAR(255) DEFAULT 'Years'");
  await sequelize.query("ALTER TABLE parameter_normal_range ADD COLUMN IF NOT EXISTS \"ageUnit\" VARCHAR(255) DEFAULT 'Years'");
  await sequelize.query("ALTER TABLE bill ADD COLUMN IF NOT EXISTS \"visitType\" VARCHAR(255) DEFAULT 'WALK-IN'");
  await sequelize.query("ALTER TABLE bill ADD COLUMN IF NOT EXISTS \"priority\" VARCHAR(255) DEFAULT 'ROUTINE'");
  await sequelize.query('ALTER TABLE client_user ADD COLUMN IF NOT EXISTS department VARCHAR(255)');
  await sequelize.query('ALTER TABLE client_user ADD COLUMN IF NOT EXISTS designation VARCHAR(255)');
  await sequelize.query("ALTER TABLE client_user ADD COLUMN IF NOT EXISTS \"signaturePath\" VARCHAR(255)");
  await sequelize.query("ALTER TABLE bill ADD COLUMN IF NOT EXISTS \"dueAmount\" DECIMAL(10,2) NOT NULL DEFAULT 0");
  await sequelize.query("ALTER TABLE bill_discount ADD COLUMN IF NOT EXISTS \"cancelledAt\" TIMESTAMPTZ");
  await sequelize.query('ALTER TABLE bill_discount ADD COLUMN IF NOT EXISTS "fromDueAmount" DECIMAL(10,2) NOT NULL DEFAULT 0');
  await sequelize.query("ALTER TABLE client_user ADD COLUMN IF NOT EXISTS \"isSystemUser\" BOOLEAN NOT NULL DEFAULT false");
  await sequelize.query("ALTER TABLE client ADD COLUMN IF NOT EXISTS \"qrPaymentRequired\" BOOLEAN NOT NULL DEFAULT true");
  await sequelize.query('ALTER TABLE parameter_master ADD COLUMN IF NOT EXISTS description TEXT');
  await sequelize.query("ALTER TYPE enum_report_status ADD VALUE IF NOT EXISTS 'REVOKED'");
  await sequelize.query('ALTER TABLE report ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMPTZ');
  await sequelize.query('ALTER TABLE report ADD COLUMN IF NOT EXISTS "revokedReason" VARCHAR(255)');
  await sequelize.query('ALTER TABLE bill ADD COLUMN IF NOT EXISTS "gstPercent" DECIMAL(5,2) NOT NULL DEFAULT 0');
  await sequelize.query('ALTER TABLE bill ADD COLUMN IF NOT EXISTS "cgstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0');
  await sequelize.query('ALTER TABLE bill ADD COLUMN IF NOT EXISTS "sgstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0');
  await sequelize.query('ALTER TABLE bill ADD COLUMN IF NOT EXISTS "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0');
  await sequelize.query('ALTER TABLE client ADD COLUMN IF NOT EXISTS "defaultGstPercent" DECIMAL(5,2) NOT NULL DEFAULT 0');
  await sequelize.query('ALTER TABLE client ADD COLUMN IF NOT EXISTS "brandingName" VARCHAR(255)');
  await sequelize.query('ALTER TABLE client ADD COLUMN IF NOT EXISTS "brandingAddress" VARCHAR(255)');
  await sequelize.query('ALTER TABLE client ADD COLUMN IF NOT EXISTS "brandingMobile" VARCHAR(255)');
  await sequelize.query('ALTER TABLE client ADD COLUMN IF NOT EXISTS "brandingEmail" VARCHAR(255)');
  await sequelize.query('ALTER TABLE report ADD COLUMN IF NOT EXISTS "releasedByUserId" INTEGER');
  await sequelize.query('ALTER TABLE client_user ADD COLUMN IF NOT EXISTS "signatureName" VARCHAR(255)');
  await backfillSystemUsers();
  await expireOverdueSubscriptions();
  setInterval(() => {
    expireOverdueSubscriptions().catch((err) => console.error('expireOverdueSubscriptions failed:', err));
  }, 24 * 60 * 60 * 1000);

  app.listen(PORT, () => console.log(`HMS/LIMS API listening on port ${PORT}`));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
