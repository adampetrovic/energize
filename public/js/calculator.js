/**
 * Energy cost calculator.
 *
 * Takes hourly energy data + tariff plan (with seasons→schedules→rates)
 * + holiday set → detailed cost breakdown.
 */
const Calculator = {

  /**
   * @param {Array}  hours             [{hour, month, dayOfWeek, localDate, importWh, exportWh}]
   * @param {Object} plan              tariff plan (seasons→schedules→rates)
   * @param {Set}    holidaySet        date strings "YYYY-MM-DD"
   * @param {string} holidayTreatment  'weekend' → remap to Sunday(0), 'weekday' → keep original
   * @param {boolean} gstInclusive     whether entered prices already include GST
   */
  calculate(hours, plan, holidaySet, holidayTreatment, gstInclusive) {
    const byRate = {};
    const byDay = {};
    let totalImportWh = 0;
    let totalExportWh = 0;

    for (const h of hours) {
      const isHoliday = holidaySet.has(h.localDate);
      let dow = h.dayOfWeek; // 0=Sun .. 6=Sat
      if (isHoliday && holidayTreatment === 'weekend') dow = 0; // treat as Sunday

      // 1) find season by month
      const season = this.findSeason(plan, h.month);
      if (!season) continue;

      // 2) find schedule by day-of-week
      const schedule = this.findSchedule(season, dow);
      if (!schedule) continue;

      // 3) find rate by hour
      const rate = this.findRate(schedule.rates, h.hour);
      if (!rate) continue;

      const rateName = rate.name || 'Unknown';
      const importKwh = h.importWh / 1000;
      const exportKwh = h.exportWh / 1000;

      let effectiveRate = rate.rate;
      if (!gstInclusive) effectiveRate *= 1.1;

      const importCost = importKwh * effectiveRate;

      totalImportWh += h.importWh;
      totalExportWh += h.exportWh;

      if (!byRate[rateName]) byRate[rateName] = { kwh: 0, cost: 0, rate: rate.rate, effectiveRate };
      byRate[rateName].kwh += importKwh;
      byRate[rateName].cost += importCost;

      if (!byDay[h.localDate]) byDay[h.localDate] = { importKwh: 0, exportKwh: 0, importCost: 0 };
      byDay[h.localDate].importKwh += importKwh;
      byDay[h.localDate].exportKwh += exportKwh;
      byDay[h.localDate].importCost += importCost;
    }

    // Feed-in credit (not subject to GST)
    const totalExportKwh = totalExportWh / 1000;
    const fitRate = plan.feedInTariff || 0;
    const totalExportCredit = totalExportKwh * fitRate;

    // Days & supply
    const days = Object.keys(byDay).length;
    let dailySupply = plan.dailySupplyCharge || 0;
    if (!gstInclusive) dailySupply *= 1.1;
    const supplyCharge = days * dailySupply;

    const totalUsageCost = Object.values(byRate).reduce((s, r) => s + r.cost, 0);
    const totalCost = totalUsageCost + supplyCharge - totalExportCredit;

    // GST component
    const gstableAmount = totalUsageCost + supplyCharge;
    const gstAmount = gstInclusive ? gstableAmount / 11 : gstableAmount - gstableAmount / 1.1;

    // Daily array
    const dailyCosts = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        importKwh: d.importKwh,
        exportKwh: d.exportKwh,
        importCost: d.importCost,
        exportCredit: d.exportKwh * fitRate,
        supplyCost: dailySupply,
        totalCost: d.importCost + dailySupply - d.exportKwh * fitRate,
      }));

    return {
      totalCost, totalImportKwh: totalImportWh / 1000, totalExportKwh,
      totalUsageCost, totalExportCredit, supplyCharge, gstAmount,
      days, dailySupplyRate: dailySupply, byRate, dailyCosts,
    };
  },

  /* ---- look-ups ---- */

  findSeason(plan, month) {
    return (plan.seasons || []).find(s => (s.months || []).includes(month));
  },

  findSchedule(season, dow) {
    return (season.schedules || []).find(s => (s.days || []).includes(dow));
  },

  findRate(rates, hour) {
    return (rates || []).find(r => hour >= r.startHour && hour < r.endHour);
  },

  /* ---- billing-period helpers ---- */

  generateBillingPeriods(billingDay, count = 14) {
    const periods = [];
    const now = new Date();
    const today = fmtDate(now);

    let year = now.getFullYear();
    let month = now.getMonth() + 1;

    for (let i = 0; i < count; i++) {
      const sy = month > 0 ? year : year - 1;
      const sm = month > 0 ? month : month + 12;
      const start = `${sy}-${z(sm)}-${z(billingDay)}`;

      let em = sm + 1, ey = sy;
      if (em > 12) { em = 1; ey++; }
      const end = `${ey}-${z(em)}-${z(billingDay - 1)}`;

      periods.push({
        start, end,
        label: this.fmtPeriodLabel(start, end),
        isComplete: end <= today,
        isCurrent: start <= today && end > today,
      });
      month--;
      if (month <= 0) { month += 12; year--; }
    }
    return periods;
  },

  fmtPeriodLabel(start, end) {
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const [sy,sm,sd] = start.split('-').map(Number);
    const [ey,em,ed] = end.split('-').map(Number);
    return `${sd} ${M[sm-1]} ${sy} — ${ed} ${M[em-1]} ${ey}`;
  },

  /**
   * Calculate solar savings by comparing "with solar" vs "without solar".
   * Without solar: all house consumption comes from grid (import + self-consumed solar).
   * Self-consumed solar = solarWh - exportWh per hour.
   */
  calculateSolar(hours, plan, holidaySet, holidayTreatment, gstInclusive) {
    let totalSolarWh = 0;
    let totalSelfConsumedWh = 0;
    let totalExportWh = 0;
    let selfConsumedValue = 0;
    let exportValue = 0;

    const fitRate = plan.feedInTariff || 0;

    for (const h of hours) {
      const solarWh = h.solarWh || 0;
      const exportWh = h.exportWh || 0;
      const selfConsumedWh = Math.max(0, solarWh - exportWh);

      totalSolarWh += solarWh;
      totalSelfConsumedWh += selfConsumedWh;
      totalExportWh += exportWh;

      // Self-consumed solar avoids import at the TOU rate for this hour
      const isHoliday = holidaySet.has(h.localDate);
      let dow = h.dayOfWeek;
      if (isHoliday && holidayTreatment === 'weekend') dow = 0;
      const season = this.findSeason(plan, h.month);
      if (!season) continue;
      const schedule = this.findSchedule(season, dow);
      if (!schedule) continue;
      const rate = this.findRate(schedule.rates, h.hour);
      if (!rate) continue;

      let effectiveRate = rate.rate;
      if (!gstInclusive) effectiveRate *= 1.1;

      selfConsumedValue += (selfConsumedWh / 1000) * effectiveRate;
      exportValue += (exportWh / 1000) * fitRate;
    }

    const totalSolarKwh = totalSolarWh / 1000;
    const selfConsumedKwh = totalSelfConsumedWh / 1000;
    const exportKwh = totalExportWh / 1000;
    const selfConsumptionRate = totalSolarWh > 0 ? selfConsumedKwh / totalSolarKwh : 0;
    const totalSavings = selfConsumedValue + exportValue;

    return {
      totalSolarKwh,
      selfConsumedKwh,
      exportKwh,
      selfConsumptionRate,
      selfConsumedValue,
      exportValue,
      totalSavings,
    };
  },

  /**
   * Compute "without solar" hours — add self-consumed solar back onto import, zero export.
   */
  withoutSolarHours(hours) {
    return hours.map(h => {
      const solarWh = h.solarWh || 0;
      const exportWh = h.exportWh || 0;
      const selfConsumedWh = Math.max(0, solarWh - exportWh);
      return { ...h, importWh: h.importWh + selfConsumedWh, exportWh: 0, solarWh: 0 };
    });
  },

  /**
   * Apply calibration factors to IoTaWatt hours.
   * Solar has no OVO reference — use average of import+export factors as best estimate.
   */
  calibrateHours(hours, importFactor, exportFactor) {
    if (importFactor === 1 && exportFactor === 1) return hours;
    const solarFactor = (importFactor + exportFactor) / 2;
    return hours.map(h => ({
      ...h,
      importWh: h.importWh * importFactor,
      exportWh: h.exportWh * exportFactor,
      solarWh: (h.solarWh || 0) * solarFactor,
    }));
  },

  hourlyAverage(hours) {
    const sums = Array(24).fill(0), counts = Array(24).fill(0);
    for (const h of hours) { sums[h.hour] += h.importWh / 1000; counts[h.hour]++; }
    return sums.map((s, i) => counts[i] ? s / counts[i] : 0);
  },

  splitIntoPeriods(hours, periods) {
    return periods.map(p => ({
      ...p,
      hours: hours.filter(h => h.localDate >= p.start && h.localDate <= p.end),
    }));
  },
};

function z(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) {
  return [d.getFullYear(), z(d.getMonth()+1), z(d.getDate())].join('-');
}
