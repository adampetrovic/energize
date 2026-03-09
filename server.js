require('dotenv').config();
const express = require('express');
const path = require('path');
const { fetchHourlyEnergy } = require('./lib/influxdb');
const { getHolidays, STATES } = require('./lib/holidays');
const { fetchPlan, convertPlan } = require('./lib/eme');
const db = require('./lib/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ── Health ── */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, influxConfigured: !!process.env.INFLUXDB_TOKEN, dbConfigured: !!process.env.DATABASE_URL });
});

/* ── States & Holidays ── */
app.get('/api/states', (_req, res) => res.json({ states: STATES }));

app.get('/api/holidays', (req, res) => {
  const { state } = req.query;
  if (!state) return res.status(400).json({ error: 'state is required' });
  const sy = parseInt(req.query.startYear) || 2024;
  const ey = parseInt(req.query.endYear) || 2027;
  try {
    res.json({ state, holidays: getHolidays(state, sy, ey) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Energy Data ── */
app.get('/api/energy/hourly', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end dates required (YYYY-MM-DD)' });
  try {
    const hours = await fetchHourlyEnergy(start, end);
    const totalImportWh = hours.reduce((s, h) => s + h.importWh, 0);
    const totalExportWh = hours.reduce((s, h) => s + h.exportWh, 0);
    res.json({
      start, end,
      totalImportKwh: +(totalImportWh / 1000).toFixed(3),
      totalExportKwh: +(totalExportWh / 1000).toFixed(3),
      hoursCount: hours.length,
      hours,
    });
  } catch (err) {
    console.error('InfluxDB query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── Energy Made Easy Plan Import ── */
app.get('/api/eme/plan', async (req, res) => {
  const { planId, postcode } = req.query;
  if (!planId || !postcode) return res.status(400).json({ error: 'planId and postcode required' });
  try {
    const raw = await fetchPlan(planId, postcode);
    const plan = convertPlan(raw);
    res.json({ plan, raw: { planId: raw.planId, planName: raw.planData?.planName, retailer: raw.planData?.retailerName } });
  } catch (err) {
    console.error('EME API error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

/* ── Saved Plans CRUD ── */
app.get('/api/plans', async (_req, res) => {
  try {
    res.json({ plans: await db.listPlans() });
  } catch (err) {
    res.json({ plans: [] }); // graceful fallback if no DB
  }
});

app.get('/api/plans/:slug', async (req, res) => {
  try {
    const plan = await db.getPlan(req.params.slug);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/plans/:slug', async (req, res) => {
  const { name, planData, source, emePlanId, emePostcode } = req.body;
  if (!name || !planData) return res.status(400).json({ error: 'name and planData required' });
  try {
    await db.upsertPlan(req.params.slug, name, planData, source, emePlanId, emePostcode);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/plans/:slug', async (req, res) => {
  try {
    await db.deletePlan(req.params.slug);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Settings ── */
app.get('/api/settings/:key', async (req, res) => {
  try {
    const value = await db.getSetting(req.params.key);
    res.json({ value });
  } catch (err) {
    res.json({ value: null });
  }
});

app.put('/api/settings/:key', async (req, res) => {
  try {
    await db.setSetting(req.params.key, req.body.value);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Start ── */
(async () => {
  try {
    await db.migrate();
    console.log('Database migrated');
  } catch (err) {
    console.log('No database configured, running without persistence');
  }
  app.listen(PORT, () => {
    console.log(`Energize running on http://localhost:${PORT}`);
  });
})();
