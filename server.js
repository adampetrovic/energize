require('dotenv').config();
const express = require('express');
const path = require('path');
const { fetchHourlyEnergy } = require('./lib/influxdb');
const { getHolidays, STATES } = require('./lib/holidays');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, influxConfigured: !!process.env.INFLUXDB_TOKEN });
});

app.get('/api/states', (_req, res) => {
  res.json({ states: STATES });
});

app.get('/api/holidays', (req, res) => {
  const { state } = req.query;
  if (!state) return res.status(400).json({ error: 'state is required' });
  const sy = parseInt(req.query.startYear) || 2024;
  const ey = parseInt(req.query.endYear) || 2027;
  try {
    const holidays = getHolidays(state, sy, ey);
    res.json({ state, holidays });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/energy/hourly', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) {
    return res.status(400).json({ error: 'start and end dates required (YYYY-MM-DD)' });
  }
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

app.listen(PORT, () => {
  console.log(`Energize running on http://localhost:${PORT}`);
});
