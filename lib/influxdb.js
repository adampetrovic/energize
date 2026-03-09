const INFLUX_URL = process.env.INFLUXDB_URL || 'https://influx.petrovic.network';
const INFLUX_ORG = process.env.INFLUXDB_ORG || '71d6d270b25881e5';
const INFLUX_TOKEN = process.env.INFLUXDB_TOKEN;
const INFLUX_BUCKET = process.env.INFLUXDB_BUCKET || 'iotawatt';
const TZ = 'Australia/Sydney';

async function queryFlux(flux) {
  const res = await fetch(`${INFLUX_URL}/api/v2/query?org=${INFLUX_ORG}`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${INFLUX_TOKEN}`,
      'Accept': 'application/csv',
      'Content-Type': 'application/vnd.flux',
    },
    body: flux,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`InfluxDB query failed (${res.status}): ${body}`);
  }
  return res.text();
}

function parseCSV(csv) {
  const lines = csv.trim().split('\n').filter(l => l && !l.startsWith('#'));
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1)
    .filter(l => l.trim())
    .map(line => {
      const vals = line.split(',');
      const row = {};
      headers.forEach((h, i) => { row[h.trim()] = vals[i]?.trim() ?? ''; });
      return row;
    });
}

/**
 * Convert a local date string (YYYY-MM-DD) in Australia/Sydney to UTC ISO string.
 */
function localDateToUTC(dateStr) {
  const refDate = new Date(dateStr + 'T12:00:00Z');
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(refDate);
  const localHour = parseInt(parts.find(p => p.type === 'hour').value);
  const utcHour = refDate.getUTCHours();
  let offset = localHour - utcHour;
  if (offset < 0) offset += 24;

  const midnight = new Date(dateStr + 'T00:00:00Z');
  midnight.setUTCHours(midnight.getUTCHours() - offset);
  return midnight.toISOString();
}

/**
 * Convert a UTC Date to local components in Australia/Sydney.
 */
function utcToLocal(utcIso) {
  const date = new Date(utcIso);
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map(p => [p.type, p.value])
  );

  const hour = parseInt(parts.hour);
  const month = parseInt(parts.month);
  const day = parseInt(parts.day);
  const year = parseInt(parts.year);
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;

  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  const dayOfWeek = weekdayMap[parts.weekday] ?? 0;

  return { hour, month, day, year, localDate, dayOfWeek };
}

/**
 * Fetch hourly energy data (GridImport + SolarExport) from InfluxDB.
 * @param {string} startDate - local date YYYY-MM-DD (inclusive)
 * @param {string} endDate   - local date YYYY-MM-DD (inclusive, end of day)
 * @returns {Array<{localDate, hour, month, dayOfWeek, importWh, exportWh}>}
 */
async function fetchHourlyEnergy(startDate, endDate) {
  const startUTC = localDateToUTC(startDate);
  // End date is inclusive, so we need midnight of the NEXT day
  const endParts = endDate.split('-').map(Number);
  const nextDay = new Date(endParts[0], endParts[1] - 1, endParts[2] + 1);
  const endNextDay = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
  const stopUTC = localDateToUTC(endNextDay);

  const flux = `
import "timezone"
option location = timezone.location(name: "${TZ}")

from(bucket: "${INFLUX_BUCKET}")
  |> range(start: ${startUTC.replace('Z', '')}Z, stop: ${stopUTC.replace('Z', '')}Z)
  |> filter(fn: (r) => (r._measurement == "GridImport" or r._measurement == "SolarExport" or r._measurement == "SolarGeneration") and r.unit == "Wh")
  |> aggregateWindow(every: 1h, fn: sum, createEmpty: true, timeSrc: "_start")
  |> pivot(rowKey: ["_time"], columnKey: ["_measurement"], valueColumn: "_value")
  |> keep(columns: ["_time", "GridImport", "SolarExport", "SolarGeneration"])
  |> sort(columns: ["_time"])
`;

  const csv = await queryFlux(flux);
  const rows = parseCSV(csv);

  // InfluxDB pivot can produce split rows (solar/export/import on separate rows
  // for the same hour). Merge by (localDate, hour).
  const merged = new Map();
  for (const r of rows) {
    if (!r._time) continue;
    const local = utcToLocal(r._time);
    const key = `${local.localDate}|${local.hour}`;
    if (!merged.has(key)) {
      merged.set(key, {
        time: r._time,
        localDate: local.localDate,
        hour: local.hour,
        month: local.month,
        dayOfWeek: local.dayOfWeek,
        importWh: 0,
        exportWh: 0,
        solarWh: 0,
      });
    }
    const m = merged.get(key);
    m.importWh += parseFloat(r.GridImport) || 0;
    m.exportWh += parseFloat(r.SolarExport) || 0;
    m.solarWh += parseFloat(r.SolarGeneration) || 0;
  }

  return Array.from(merged.values()).sort((a, b) =>
    a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : a.hour - b.hour
  );
}

module.exports = { fetchHourlyEnergy, localDateToUTC };
