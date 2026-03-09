/**
 * Energy Made Easy API integration.
 *
 * Fetches plan data from the EME consumer plan API and converts
 * to the Energize tariff plan format.
 *
 * API rates are in c/kWh (ex-GST). We convert to $/kWh (inc-GST).
 */

const EME_API = 'https://api.energymadeeasy.gov.au/consumerplan/plan';

const DAY_MAP = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

function parseDays(dayStr) {
  return (dayStr || '').split('|').map(d => DAY_MAP[d.trim()]).filter(d => d !== undefined).sort();
}

function parseTime(timeStr) {
  // "1500" → 15, "2059" → 21, "2359" → 24
  const h = parseInt((timeStr || '0000').substring(0, 2));
  const m = parseInt((timeStr || '0000').substring(2));
  return m >= 30 ? h + 1 : h;
}

function parseEndTime(timeStr) {
  // endTime "2059" means up to 20:59 → endHour 21
  const h = parseInt((timeStr || '0000').substring(0, 2));
  const m = parseInt((timeStr || '0000').substring(2));
  if (m === 59) return h + 1;
  if (m === 0 && h === 0) return 24; // "0000" as end = midnight
  return m >= 30 ? h + 1 : h;
}

function seasonMonths(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('nov') && n.includes('mar')) return [11, 12, 1, 2, 3];
  if (n.includes('apr') && n.includes('may')) return [4, 5];
  if (n.includes('jun') && n.includes('aug')) return [6, 7, 8];
  if (n.includes('sep') && n.includes('oct')) return [9, 10];
  if (n.includes('jul') && n.includes('jun')) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  // Try parsing "1 Jul - 30 Jun" style
  const match = n.match(/(\d+)\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/gi);
  if (match && match.length >= 2) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const start = months.findIndex(m => match[0].toLowerCase().includes(m)) + 1;
    const end = months.findIndex(m => match[1].toLowerCase().includes(m)) + 1;
    if (start && end) {
      const result = [];
      let m = start;
      while (true) {
        result.push(m);
        if (m === end) break;
        m = m === 12 ? 1 : m + 1;
      }
      return result;
    }
  }
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
}

function buildRatesFromTouBlocks(touBlocks) {
  const rates = [];
  for (const block of (touBlocks || [])) {
    const price = block.blockRate?.[0]?.unitPrice || 0;
    // c/kWh ex-GST → $/kWh inc-GST
    const ratePerKwh = Math.round(price * 1.1) / 10000 * 100;
    const rateValue = Math.round(price * 1.1 / 100 * 10000) / 10000;

    for (const tou of (block.timeOfUse || [])) {
      const days = parseDays(tou.days);
      const startHour = parseTime(tou.startTime);
      const endHour = parseEndTime(tou.endTime);

      rates.push({
        name: block.name || 'Unknown',
        startHour,
        endHour: endHour === 0 ? 24 : endHour,
        rate: rateValue,
        days,
      });
    }
  }
  return rates;
}

function groupByDays(rates) {
  // Group rates that share the same day sets into schedules
  const schedules = new Map();
  for (const r of rates) {
    const dayKey = r.days.join(',');
    if (!schedules.has(dayKey)) {
      schedules.set(dayKey, { days: r.days, rates: [] });
    }
    schedules.get(dayKey).rates.push({ name: r.name, startHour: r.startHour, endHour: r.endHour, rate: r.rate });
  }

  return Array.from(schedules.values()).map(s => {
    const allDays = [0, 1, 2, 3, 4, 5, 6];
    const weekdays = [1, 2, 3, 4, 5];
    const weekends = [0, 6];
    let name = 'Custom';
    if (JSON.stringify(s.days) === JSON.stringify(allDays)) name = 'All Days';
    else if (JSON.stringify(s.days) === JSON.stringify(weekdays)) name = 'Weekdays';
    else if (JSON.stringify(s.days) === JSON.stringify(weekends)) name = 'Weekends';

    // Sort rates by startHour
    s.rates.sort((a, b) => a.startHour - b.startHour);

    return { name, days: s.days, rates: s.rates };
  });
}

function mergeSeasonsWithSameRates(seasons) {
  // Merge seasons that have identical rate structures
  const merged = [];
  for (const s of seasons) {
    const rateKey = JSON.stringify(s.schedules.map(sc => ({ days: sc.days, rates: sc.rates })));
    const existing = merged.find(m => JSON.stringify(m.schedules.map(sc => ({ days: sc.days, rates: sc.rates }))) === rateKey);
    if (existing) {
      existing.months = [...new Set([...existing.months, ...s.months])].sort((a, b) => a - b);
      existing.name += ' / ' + s.name;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

async function fetchPlan(planId, postcode) {
  const url = `${EME_API}/${encodeURIComponent(planId)}?postcode=${encodeURIComponent(postcode)}&withPrices=true`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`EME API error ${res.status}: ${body}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0].detail || 'Plan not found');
  }
  return json.data;
}

function convertPlan(data) {
  const contract = data.planData?.contract?.[0];
  if (!contract) throw new Error('No contract data in plan');

  const planName = data.planData.planName || data.planId;
  const retailer = data.planData.retailerName || '';

  // Feed-in tariff (ex-GST, FiT is not subject to GST)
  let fitRate = 0;
  if (contract.solarFit?.length) {
    // Take the latest/most recent FiT
    const latestFit = contract.solarFit.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))[0];
    fitRate = (latestFit.rate || latestFit.singleTariffRates?.[0]?.unitPrice || 0) / 100;
  }

  // Build seasons from tariff periods
  const seasons = [];
  for (const tp of (contract.tariffPeriod || [])) {
    const months = seasonMonths(tp.name);
    const supply = ((tp.dailySupplyCharge || 0) * 1.1) / 100; // c ex-GST → $ inc-GST

    const rawRates = buildRatesFromTouBlocks(tp.touBlock);
    const schedules = groupByDays(rawRates);

    seasons.push({ name: tp.name, months, schedules });

    // Store supply charge (should be same across seasons)
    if (!seasons._supply || supply > seasons._supply) seasons._supply = supply;
  }

  const dailySupply = seasons._supply || 0;
  delete seasons._supply;

  // Merge seasons with identical rate structures
  const mergedSeasons = mergeSeasonsWithSameRates(seasons);

  return {
    name: retailer ? `${retailer} — ${planName}` : planName,
    dailySupplyCharge: Math.round(dailySupply * 10000) / 10000,
    feedInTariff: Math.round(fitRate * 10000) / 10000,
    seasons: mergedSeasons,
  };
}

module.exports = { fetchPlan, convertPlan };
