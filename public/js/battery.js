/**
 * Battery simulator — config, strategy rules, simulation engine, and UI.
 */

/* ================================================================== */
/*  DATA MODELS                                                       */
/* ================================================================== */

const DEFAULT_BATTERY = {
  enabled: false,
  capacityKwh: 16,          // Sigenergy 2x BAT 8.0
  usablePercent: 97,         // 97% DoD (LFP)
  chargeRateKw: 8,            // 4kW per battery module × 2
  dischargeRateKw: 8,         // 4kW per battery module × 2
  efficiencyPercent: 90,     // AC round-trip ~90%
  degradationPercent: 3,     // 70% after 10yr warranty
  initialSocPercent: 50,
  purchasePrice: 12000,
};

const RULE_TEMPLATE = {
  days: [0,1,2,3,4,5,6], months: [1,2,3,4,5,6,7,8,9,10,11,12],
  socAbove: null, socBelow: null, rateAbove: null, rateBelow: null,
  solarWindowFrom: null, solarWindowTo: null, solarBelow: null, solarAbove: null,
  maxGridKwh: null,
};
const R = (overrides) => ({ ...RULE_TEMPLATE, ...overrides });

const DEFAULT_RULES = [
  R({ name: 'EV Trickle Charge', action: 'charge_grid', enabled: true, timeFrom: 0, timeTo: 2, socBelow: 50 }),
  R({ name: 'Free Midday Charge', action: 'charge_grid', enabled: true, timeFrom: 11, timeTo: 14 }),
  R({ name: 'Morning Discharge', action: 'discharge', enabled: true, timeFrom: 6, timeTo: 11, socAbove: 5 }),
  R({ name: 'Afternoon Discharge', action: 'discharge', enabled: true, timeFrom: 14, timeTo: 24, socAbove: 5 }),
  R({ name: 'Hold', action: 'hold', enabled: true, timeFrom: 0, timeTo: 24 }),
];

const STRATEGY_PRESETS = {
  'optimized': {
    label: '⚡ Optimized',
    desc: 'Best ROI: trickle EV to 50% SoC, free midday, discharge all other. $2,242/yr savings, 5.35yr payback.',
    rules: [
      R({ name: 'EV Trickle Charge', action: 'charge_grid', enabled: true, timeFrom: 0, timeTo: 2, socBelow: 50 }),
      R({ name: 'Free Midday Charge', action: 'charge_grid', enabled: true, timeFrom: 11, timeTo: 14 }),
      R({ name: 'Morning Discharge', action: 'discharge', enabled: true, timeFrom: 6, timeTo: 11, socAbove: 5 }),
      R({ name: 'Afternoon Discharge', action: 'discharge', enabled: true, timeFrom: 14, timeTo: 24, socAbove: 5 }),
      R({ name: 'Hold', action: 'hold', enabled: true, timeFrom: 0, timeTo: 24 }),
    ],
  },
  'full-arbitrage': {
    label: 'Full Arbitrage',
    desc: 'Full overnight charge + free midday. Good blackout protection but crowds out free energy.',
    rules: [
      R({ name: 'Overnight Grid Charge', action: 'charge_grid', enabled: true, timeFrom: 0, timeTo: 6 }),
      R({ name: 'Free Midday Charge', action: 'charge_grid', enabled: true, timeFrom: 11, timeTo: 14 }),
      R({ name: 'Morning Discharge', action: 'discharge', enabled: true, timeFrom: 6, timeTo: 11, socAbove: 5 }),
      R({ name: 'Afternoon Discharge', action: 'discharge', enabled: true, timeFrom: 14, timeTo: 24, socAbove: 5 }),
      R({ name: 'Hold', action: 'hold', enabled: true, timeFrom: 0, timeTo: 24 }),
    ],
  },
  'free-midday-only': {
    label: 'Free Midday Only',
    desc: 'No overnight charge. Relies on free midday + solar only. Lower savings but zero charge cost.',
    rules: [
      R({ name: 'Free Midday Charge', action: 'charge_grid', enabled: true, timeFrom: 11, timeTo: 14 }),
      R({ name: 'Discharge All Other', action: 'discharge', enabled: true, timeFrom: 6, timeTo: 24, socAbove: 5 }),
      R({ name: 'Hold', action: 'hold', enabled: true, timeFrom: 0, timeTo: 24 }),
    ],
  },
  'cloudy-day-arbitrage': {
    label: 'Cloudy Day + Free',
    desc: 'EV charge only when next-day solar forecast is low (<6kWh 6–11am). Adaptive strategy.',
    rules: [
      R({ name: 'EV Charge (Low Solar)', action: 'charge_grid', enabled: true, timeFrom: 0, timeTo: 2,
          socBelow: 50, solarWindowFrom: 6, solarWindowTo: 11, solarBelow: 6 }),
      R({ name: 'Free Midday Charge', action: 'charge_grid', enabled: true, timeFrom: 11, timeTo: 14 }),
      R({ name: 'Morning Discharge', action: 'discharge', enabled: true, timeFrom: 6, timeTo: 11, socAbove: 5 }),
      R({ name: 'Afternoon Discharge', action: 'discharge', enabled: true, timeFrom: 14, timeTo: 24, socAbove: 5 }),
      R({ name: 'Hold', action: 'hold', enabled: true, timeFrom: 0, timeTo: 24 }),
    ],
  },
};

/* ================================================================== */
/*  SIMULATION ENGINE                                                 */
/* ================================================================== */

const BatterySimulator = {

  /**
   * Run battery simulation over hourly data.
   * Returns modified hours array with adjusted import/export and SoC tracking.
   */
  simulate(hours, plan, battery, rules, holidaySet, holidayTreatment, gstInclusive) {
    if (!battery.enabled) return null;

    const baseCapWh = battery.capacityKwh * 1000 * (battery.usablePercent / 100);
    const chargeMaxWh = battery.chargeRateKw * 1000;
    const dischargeMaxWh = battery.dischargeRateKw * 1000;
    const eff = battery.efficiencyPercent / 100;
    const degRate = battery.degradationPercent / 100;

    // Pre-compute daily solar totals by time window
    const dailySolar = this.precomputeDailySolar(hours);

    // Find simulation start date for degradation calc
    const startDate = hours.length > 0 ? hours[0].localDate : null;

    let socWh = baseCapWh * (battery.initialSocPercent / 100);
    const results = [];

    // Track daily grid charge per rule index to enforce maxGridKwh
    const dailyGridCharge = {};  // { "YYYY-MM-DD:ruleIdx": whCharged }

    for (const h of hours) {
      // Effective capacity with degradation
      const monthsElapsed = this.monthsBetween(startDate, h.localDate);
      const effectiveCapWh = baseCapWh * Math.max(0, 1 - degRate * monthsElapsed / 12);
      socWh = Math.min(socWh, effectiveCapWh);

      let modImport = h.importWh;
      let modExport = h.exportWh;
      let solarChargeWh = 0;
      let gridChargeWh = 0;
      let dischargeWh = 0;

      // Step 1: Solar charging (always — excess solar charges battery before export)
      const capRemaining = Math.max(0, effectiveCapWh - socWh);
      solarChargeWh = Math.min(h.exportWh, capRemaining, chargeMaxWh);
      modExport -= solarChargeWh;
      socWh += solarChargeWh;
      let chargeUsedWh = solarChargeWh;

      // Step 2: Evaluate strategy rules
      const currentRate = this.getCurrentRate(h, plan, holidaySet, holidayTreatment);
      const socPct = effectiveCapWh > 0 ? (socWh / effectiveCapWh) * 100 : 0;
      const daySolar = dailySolar[h.localDate] || {};

      const { action, ruleIndex } = this.evaluateRules(rules, h, socPct, currentRate, daySolar);

      if (action === 'charge_grid') {
        // Charge from grid, respecting maxGridKwh daily cap if set
        let canCharge = Math.min(effectiveCapWh - socWh, chargeMaxWh - chargeUsedWh);

        const rule = ruleIndex != null ? rules[ruleIndex] : null;
        if (rule && rule.maxGridKwh != null) {
          const dayKey = `${h.localDate}:${ruleIndex}`;
          const alreadyCharged = dailyGridCharge[dayKey] || 0;
          const remainingCap = Math.max(0, rule.maxGridKwh * 1000 - alreadyCharged);
          canCharge = Math.min(canCharge, remainingCap);
        }

        if (canCharge > 0) {
          gridChargeWh = canCharge;
          modImport += gridChargeWh;
          socWh += gridChargeWh;

          if (rule && rule.maxGridKwh != null) {
            const dayKey = `${h.localDate}:${ruleIndex}`;
            dailyGridCharge[dayKey] = (dailyGridCharge[dayKey] || 0) + gridChargeWh;
          }
        }
      } else if (action === 'discharge') {
        // Discharge to offset grid import only — never export to grid
        // (FiT is almost always far below charge cost, so exporting = net loss)
        const available = Math.max(0, socWh);
        const maxDeliver = Math.min(available * eff, dischargeMaxWh * eff);
        const delivered = Math.min(maxDeliver, modImport); // cap at what house needs
        if (delivered > 0) {
          const drained = eff > 0 ? delivered / eff : 0;
          dischargeWh = delivered;
          modImport -= delivered;
          socWh -= drained;
        }
      }

      socWh = Math.max(0, Math.min(socWh, effectiveCapWh));

      results.push({
        ...h,
        importWh: Math.max(0, modImport),
        exportWh: Math.max(0, modExport),
        originalImportWh: h.importWh,
        originalExportWh: h.exportWh,
        solarChargeWh,
        gridChargeWh,
        dischargeWh,
        socWh,
        socPercent: effectiveCapWh > 0 ? (socWh / effectiveCapWh) * 100 : 0,
        effectiveCapWh,
        action,
      });
    }

    return results;
  },

  precomputeDailySolar(hours) {
    const daily = {};
    for (const h of hours) {
      if (!daily[h.localDate]) daily[h.localDate] = {};
      const key = `solar_${h.hour}`;
      daily[h.localDate][key] = (h.solarWh || 0) + (h.exportWh || 0);
      // Also accumulate by window
      daily[h.localDate][`s${h.hour}`] = h.solarWh || 0;
    }
    // Pre-sum common windows
    for (const [date, d] of Object.entries(daily)) {
      for (let from = 0; from < 24; from++) {
        for (let to = from + 1; to <= 24; to++) {
          let sum = 0;
          for (let h = from; h < to; h++) sum += (d[`s${h}`] || 0);
          d[`win_${from}_${to}`] = sum / 1000; // kWh
        }
      }
    }
    return daily;
  },

  getCurrentRate(h, plan, holidaySet, holidayTreatment) {
    const isHoliday = holidaySet.has(h.localDate);
    let dow = h.dayOfWeek;
    if (isHoliday && holidayTreatment === 'weekend') dow = 0;
    const season = Calculator.findSeason(plan, h.month);
    if (!season) return 0;
    const schedule = Calculator.findSchedule(season, dow);
    if (!schedule) return 0;
    const rate = Calculator.findRate(schedule.rates, h.hour);
    return rate ? rate.rate : 0;
  },

  evaluateRules(rules, h, socPct, currentRate, daySolar) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!rule.enabled) continue;
      if (!this.ruleMatches(rule, h, socPct, currentRate, daySolar)) continue;
      return { action: rule.action, ruleIndex: i };
    }
    return { action: 'hold', ruleIndex: null };
  },

  ruleMatches(rule, h, socPct, currentRate, daySolar) {
    // Time window
    if (rule.timeFrom != null && rule.timeTo != null) {
      if (!(h.hour >= rule.timeFrom && h.hour < rule.timeTo)) return false;
    }
    // Days
    if (rule.days && rule.days.length > 0 && rule.days.length < 7) {
      if (!rule.days.includes(h.dayOfWeek)) return false;
    }
    // Months
    if (rule.months && rule.months.length > 0 && rule.months.length < 12) {
      if (!rule.months.includes(h.month)) return false;
    }
    // SoC
    if (rule.socAbove != null && socPct <= rule.socAbove) return false;
    if (rule.socBelow != null && socPct >= rule.socBelow) return false;
    // Rate
    if (rule.rateAbove != null && currentRate <= rule.rateAbove) return false;
    if (rule.rateBelow != null && currentRate >= rule.rateBelow) return false;
    // Solar window condition
    if (rule.solarWindowFrom != null && rule.solarWindowTo != null) {
      const key = `win_${rule.solarWindowFrom}_${rule.solarWindowTo}`;
      const solarKwh = daySolar[key] || 0;
      if (rule.solarBelow != null && solarKwh >= rule.solarBelow) return false;
      if (rule.solarAbove != null && solarKwh <= rule.solarAbove) return false;
    }
    return true;
  },

  monthsBetween(startDate, currentDate) {
    if (!startDate || !currentDate) return 0;
    const [sy, sm] = startDate.split('-').map(Number);
    const [cy, cm] = currentDate.split('-').map(Number);
    return (cy - sy) * 12 + (cm - sm);
  },

  /** Compute payback period in years. */
  paybackYears(annualSavings, purchasePrice) {
    if (annualSavings <= 0) return Infinity;
    return purchasePrice / annualSavings;
  },
};

/* ================================================================== */
/*  UI COMPONENT                                                      */
/* ================================================================== */

const ACTION_LABELS = { charge_grid: 'Charge from Grid', discharge: 'Discharge', hold: 'Hold' };
const ACTION_COLORS = { charge_grid: 'var(--rate-ev)', discharge: 'var(--rate-peak)', hold: 'var(--text-muted)' };

class BatteryUI {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.battery = JSON.parse(JSON.stringify(DEFAULT_BATTERY));
    this.rules = JSON.parse(JSON.stringify(DEFAULT_RULES));
    this.openRules = new Set([0]);
    this.bound = false;
    this.render();
  }

  getConfig() { return JSON.parse(JSON.stringify(this.battery)); }
  getRules() { return JSON.parse(JSON.stringify(this.rules)); }

  isEnabled() { return this.battery.enabled; }

  render() {
    const b = this.battery;
    const enabled = b.enabled;

    let h = `
    <div class="battery-toggle">
      <label class="toggle-label">
        <input type="checkbox" id="battery-enabled" ${enabled ? 'checked' : ''} data-action="toggle-battery">
        <span>Enable Battery Simulation</span>
      </label>
    </div>
    <div class="battery-content" ${enabled ? '' : 'hidden'}>
      <div class="battery-config">
        <h4>Battery Specifications</h4>
        <div class="battery-fields">
          ${this.field('Capacity (kWh)', b.capacityKwh, 'capacityKwh')}
          ${this.field('Usable (%)', b.usablePercent, 'usablePercent')}
          ${this.field('Charge Rate (kW)', b.chargeRateKw, 'chargeRateKw')}
          ${this.field('Discharge Rate (kW)', b.dischargeRateKw, 'dischargeRateKw')}
          ${this.field('Efficiency (%)', b.efficiencyPercent, 'efficiencyPercent')}
          ${this.field('Degradation (%/yr)', b.degradationPercent, 'degradationPercent')}
          ${this.field('Initial SoC (%)', b.initialSocPercent, 'initialSocPercent')}
          ${this.field('Purchase Price ($)', b.purchasePrice, 'purchasePrice')}
        </div>
      </div>
      <div class="battery-strategy">
        <div class="strategy-header">
          <h4>Strategy Rules</h4>
          <div class="strategy-presets">
            ${Object.entries(STRATEGY_PRESETS).map(([k, v]) =>
              `<button class="btn-secondary btn-sm" data-action="load-preset" data-preset="${k}" title="${esc(v.desc || '')}">${v.label}</button>`
            ).join('')}
          </div>
        </div>
        <p class="strategy-hint">Solar charging is automatic. Rules below control grid charging and discharging. First matching rule wins.</p>
        <div class="rules-list">`;

    this.rules.forEach((rule, ri) => {
      h += this.renderRule(rule, ri);
    });

    h += `</div>
        <button class="btn-add" data-action="add-rule" style="margin-top:0.5rem">+ Add Rule</button>
      </div>
    </div>`;

    this.container.innerHTML = h;
    this.bind();
  }

  field(label, value, key) {
    return `<div class="bat-field">
      <label>${label}</label>
      <input type="text" value="${value}" data-bat-field="${key}">
    </div>`;
  }

  renderRule(rule, ri) {
    const open = this.openRules.has(ri);
    const actionColor = ACTION_COLORS[rule.action] || 'var(--text-muted)';
    const chevron = `<svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;

    const condParts = [];
    if (rule.timeFrom != null && rule.timeTo != null) condParts.push(`${rule.timeFrom}:00–${rule.timeTo}:00`);
    if (rule.socBelow != null) condParts.push(`SoC < ${rule.socBelow}%`);
    if (rule.socAbove != null) condParts.push(`SoC > ${rule.socAbove}%`);
    if (rule.rateBelow != null) condParts.push(`Rate < $${rule.rateBelow}`);
    if (rule.rateAbove != null) condParts.push(`Rate > $${rule.rateAbove}`);
    if (rule.solarBelow != null && rule.solarWindowFrom != null)
      condParts.push(`Solar ${rule.solarWindowFrom}–${rule.solarWindowTo}h < ${rule.solarBelow}kWh`);
    if (rule.solarAbove != null && rule.solarWindowFrom != null)
      condParts.push(`Solar ${rule.solarWindowFrom}–${rule.solarWindowTo}h > ${rule.solarAbove}kWh`);
    if (rule.maxGridKwh != null) condParts.push(`Max ${rule.maxGridKwh} kWh/day`);

    const condStr = condParts.length ? condParts.join(', ') : 'Always';

    let h = `<div class="rule-card ${rule.enabled ? '' : 'rule-disabled'}">
      <div class="rule-header" data-action="toggle-rule" data-ri="${ri}">
        <span class="rule-priority">${ri + 1}</span>
        <span class="rule-action-badge" style="background:${actionColor}">${ACTION_LABELS[rule.action] || rule.action}</span>
        <span class="rule-name">${esc(rule.name)}</span>
        <span class="rule-cond-summary">${condStr}</span>
        <div style="display:flex;align-items:center;gap:0.3rem;margin-left:auto">
          <label class="rule-enable-toggle" onclick="event.stopPropagation()">
            <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-action="toggle-rule-enabled" data-ri="${ri}">
          </label>
          <button class="btn-icon danger" data-action="rm-rule" data-ri="${ri}" onclick="event.stopPropagation()">&times;</button>
          ${chevron}
        </div>
      </div>`;

    if (open) {
      h += `<div class="rule-body">
        <div class="rule-fields-row">
          <div class="bat-field"><label>Name</label>
            <input type="text" value="${esc(rule.name)}" data-action="rule-field" data-ri="${ri}" data-prop="name" style="font-family:var(--font-sans)"></div>
          <div class="bat-field"><label>Action</label>
            <select data-action="rule-field" data-ri="${ri}" data-prop="action">
              <option value="charge_grid" ${rule.action==='charge_grid'?'selected':''}>Charge from Grid</option>
              <option value="discharge" ${rule.action==='discharge'?'selected':''}>Discharge</option>
              <option value="hold" ${rule.action==='hold'?'selected':''}>Hold</option>
            </select></div>
          <div class="bat-field"><label>From Hour</label>
            <input type="number" min="0" max="23" value="${rule.timeFrom ?? 0}" data-action="rule-field" data-ri="${ri}" data-prop="timeFrom"></div>
          <div class="bat-field"><label>To Hour</label>
            <input type="number" min="1" max="24" value="${rule.timeTo ?? 24}" data-action="rule-field" data-ri="${ri}" data-prop="timeTo"></div>
        </div>
        <div class="rule-conditions">
          <span class="rule-cond-label">Conditions (leave blank to ignore)</span>
          <div class="rule-fields-row">
            <div class="bat-field"><label>SoC Above (%)</label>
              <input type="text" value="${rule.socAbove ?? ''}" data-action="rule-field" data-ri="${ri}" data-prop="socAbove" placeholder="—"></div>
            <div class="bat-field"><label>SoC Below (%)</label>
              <input type="text" value="${rule.socBelow ?? ''}" data-action="rule-field" data-ri="${ri}" data-prop="socBelow" placeholder="—"></div>
            <div class="bat-field"><label>Rate Above ($/kWh)</label>
              <input type="text" value="${rule.rateAbove ?? ''}" data-action="rule-field" data-ri="${ri}" data-prop="rateAbove" placeholder="—"></div>
            <div class="bat-field"><label>Rate Below ($/kWh)</label>
              <input type="text" value="${rule.rateBelow ?? ''}" data-action="rule-field" data-ri="${ri}" data-prop="rateBelow" placeholder="—"></div>
          </div>
          <div class="rule-fields-row">
            <div class="bat-field"><label>Solar Window From</label>
              <input type="number" min="0" max="23" value="${rule.solarWindowFrom ?? ''}" data-action="rule-field" data-ri="${ri}" data-prop="solarWindowFrom" placeholder="—"></div>
            <div class="bat-field"><label>Solar Window To</label>
              <input type="number" min="1" max="24" value="${rule.solarWindowTo ?? ''}" data-action="rule-field" data-ri="${ri}" data-prop="solarWindowTo" placeholder="—"></div>
            <div class="bat-field"><label>Solar Below (kWh)</label>
              <input type="text" value="${rule.solarBelow ?? ''}" data-action="rule-field" data-ri="${ri}" data-prop="solarBelow" placeholder="—"></div>
            <div class="bat-field"><label>Solar Above (kWh)</label>
              <input type="text" value="${rule.solarAbove ?? ''}" data-action="rule-field" data-ri="${ri}" data-prop="solarAbove" placeholder="—"></div>
          </div>
          <div class="rule-fields-row">
            <div class="bat-field"><label>Max Grid Charge (kWh/day)</label>
              <input type="text" value="${rule.maxGridKwh ?? ''}" data-action="rule-field" data-ri="${ri}" data-prop="maxGridKwh" placeholder="—"></div>
          </div>
        </div>
      </div>`;
    }

    h += `</div>`;
    return h;
  }

  bind() {
    if (this.bound) return;
    this.bound = true;
    const el = this.container;

    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      const ri = parseInt(btn.dataset.ri);

      switch (a) {
        case 'toggle-battery':
          this.battery.enabled = btn.checked;
          this.render(); break;
        case 'toggle-rule':
          if (e.target.closest('.btn-icon') || e.target.closest('.rule-enable-toggle')) return;
          this.openRules.has(ri) ? this.openRules.delete(ri) : this.openRules.add(ri);
          this.render(); break;
        case 'toggle-rule-enabled':
          this.rules[ri].enabled = btn.checked;
          this.render(); break;
        case 'rm-rule':
          e.stopPropagation();
          this.rules.splice(ri, 1);
          this.render(); break;
        case 'add-rule':
          this.rules.push({
            name: 'New Rule', action: 'hold', enabled: true,
            timeFrom: 0, timeTo: 24, days: [0,1,2,3,4,5,6],
            months: [1,2,3,4,5,6,7,8,9,10,11,12],
            socAbove: null, socBelow: null, rateAbove: null, rateBelow: null,
            solarWindowFrom: null, solarWindowTo: null, solarBelow: null, solarAbove: null,
            maxGridKwh: null,
          });
          this.openRules.add(this.rules.length - 1);
          this.render(); break;
        case 'load-preset': {
          const preset = STRATEGY_PRESETS[btn.dataset.preset];
          if (preset) {
            this.rules = JSON.parse(JSON.stringify(preset.rules));
            this.openRules = new Set([0]);
            this.render();
          }
          break;
        }
      }
    });

    el.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.batField) {
        const v = parseFloat(t.value);
        this.battery[t.dataset.batField] = isNaN(v) ? 0 : v;
      }
      if (t.dataset.action === 'rule-field') {
        const ri = parseInt(t.dataset.ri);
        const prop = t.dataset.prop;
        if (prop === 'name' || prop === 'action') {
          this.rules[ri][prop] = t.value;
        } else {
          const v = t.value.trim() === '' ? null : parseFloat(t.value);
          this.rules[ri][prop] = (v != null && isNaN(v)) ? null : v;
        }
      }
    });

    el.addEventListener('focusout', (e) => {
      if (e.target.dataset.action === 'rule-field') this.render();
    });
  }
}
