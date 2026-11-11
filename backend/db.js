const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const config = {
  // POSTGRES_URL is the name used by Vercel's Postgres integration.
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  // Serverless platforms can spin up many instances; keep each pool small and
  // use your provider's pooled connection string (Neon/Supabase pooler).
  max: Number(process.env.PG_POOL_MAX || 5),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

// Most managed providers ship valid certificates and need no extra flags.
// Enable this only when the provider uses a self-signed certificate.
if (process.env.DATABASE_SSL === 'true') {
  config.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(config);

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  close: () => pool.end(),
};
