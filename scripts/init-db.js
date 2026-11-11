#!/usr/bin/env node
// Apply the 5thSave schema to DATABASE_URL.
// Safe to re-run: init.sql and the migration use IF NOT EXISTS / upserts.
//
// Usage:
//   DATABASE_URL=postgres://... npm run db:init
//   (or put DATABASE_URL in backend/.env)
const fs = require('fs');
const path = require('path');
const db = require('../backend/db');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'database/init.sql',
  'database/migrations/update_schema.sql',
];

async function main() {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    throw new Error('DATABASE_URL is not set (put it in backend/.env or the environment)');
  }

  const client = await db.getClient();
  try {
    for (const file of FILES) {
      const sql = fs.readFileSync(path.join(ROOT, file), 'utf8');
      console.log(`Applying ${file} ...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    console.log('Database schema is up to date.');
  } finally {
    client.release();
    await db.close();
  }
}

main().catch((err) => {
  console.error(`Database initialization failed: ${err.message}`);
  process.exit(1);
});
