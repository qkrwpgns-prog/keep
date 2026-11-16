import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const ADMIN_URL = process.env.TEST_PG_ADMIN_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
export const DB_NAME = 'keep_test';

export default async function setup() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${DB_NAME} with (force)`);
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();
  const db = new pg.Client({ connectionString: ADMIN_URL.replace(/\/[^/]*$/, '/' + DB_NAME) });
  await db.connect();
  const root = join(import.meta.dirname, '../../supabase');
  await db.query(readFileSync(join(root, 'tests/supabase_shim.sql'), 'utf8'));
  for (const f of readdirSync(join(root, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
    await db.query(readFileSync(join(root, 'migrations', f), 'utf8'));
  }
  await db.end();
}
