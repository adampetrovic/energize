const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

async function migrate() {
  const p = getPool();
  if (!p) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      source TEXT,
      eme_plan_id TEXT,
      eme_postcode TEXT,
      plan_data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function listPlans() {
  const p = getPool();
  if (!p) return [];
  const { rows } = await p.query('SELECT id, slug, name, source, eme_plan_id, created_at FROM plans ORDER BY name');
  return rows;
}

async function getPlan(slug) {
  const p = getPool();
  if (!p) return null;
  const { rows } = await p.query('SELECT * FROM plans WHERE slug = $1', [slug]);
  return rows[0] || null;
}

async function upsertPlan(slug, name, planData, source = null, emePlanId = null, emePostcode = null) {
  const p = getPool();
  if (!p) throw new Error('No database configured');
  await p.query(`
    INSERT INTO plans (slug, name, source, eme_plan_id, eme_postcode, plan_data)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name, source = EXCLUDED.source,
      eme_plan_id = EXCLUDED.eme_plan_id, eme_postcode = EXCLUDED.eme_postcode,
      plan_data = EXCLUDED.plan_data, updated_at = NOW()
  `, [slug, name, source, emePlanId, emePostcode, planData]);
}

async function deletePlan(slug) {
  const p = getPool();
  if (!p) throw new Error('No database configured');
  await p.query('DELETE FROM plans WHERE slug = $1', [slug]);
}

async function getSetting(key) {
  const p = getPool();
  if (!p) return null;
  const { rows } = await p.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value || null;
}

async function setSetting(key, value) {
  const p = getPool();
  if (!p) throw new Error('No database configured');
  await p.query(`
    INSERT INTO settings (key, value) VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `, [key, value]);
}

module.exports = { migrate, listPlans, getPlan, upsertPlan, deletePlan, getSetting, setSetting, getPool };
