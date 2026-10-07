const { Sequelize } = require('sequelize');
require('dotenv').config();

// Supabase (and most managed Postgres) requires TLS; local dev Postgres does not.
const useSsl = process.env.DB_SSL === 'true';
const dialectOptions = useSsl ? { ssl: { require: true, rejectUnauthorized: false } } : {};

// DATABASE_URL (e.g. Supabase's connection string) takes priority when set;
// otherwise fall back to the discrete DB_* vars used for local development.
const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, { dialect: 'postgres', logging: false, dialectOptions })
  : new Sequelize(
      process.env.DB_NAME || 'hms_lims',
      process.env.DB_USER || 'postgres',
      process.env.DB_PASSWORD || 'postgres',
      {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: false,
        dialectOptions,
      }
    );

module.exports = sequelize;
