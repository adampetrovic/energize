/**
 * Tariff data model & editor UI.
 *
 * Structure:
 *   plan.name               string
 *   plan.dailySupplyCharge  number $/day
 *   plan.feedInTariff       number $/kWh
 *   plan.seasons[]
 *     .name                 string
 *     .months               number[]  1-12
 *     .schedules[]
 *       .name               string   e.g. "Weekdays", "Weekends", "All Days"
 *       .days               number[] 0=Sun..6=Sat
 *       .rates[]
 *         .name             string   e.g. "Peak"
 *         .startHour        number   0-23
 *         .endHour          number   1-24
 *         .rate             number   $/kWh
 */

const RATE_COLORS = {
  'peak': 'var(--rate-peak)',
  'off peak': 'var(--rate-offpeak)',
  'offpeak': 'var(--rate-offpeak)',
  'off-peak': 'var(--rate-offpeak)',
  'shoulder': 'var(--rate-shoulder)',
  'super off peak': 'var(--rate-superoffpeak)',
  'super offpeak': 'var(--rate-superoffpeak)',
  'ev': 'var(--rate-ev)',
  'ev charging': 'var(--rate-ev)',
  'overnight': 'var(--rate-ev)',
};
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const DEFAULT_OVO_PLAN = {
  name: 'OVO EV Plan',
  dailySupplyCharge: 1.023,
  feedInTariff: 0.028,
  seasons: [
    {
      name: 'Summer / Winter',
      months: [1,2,3,6,7,8,11,12],
      schedules: [{
        name: 'All Days',
        days: [0,1,2,3,4,5,6],
        rates: [
          { name: 'EV', startHour: 0, endHour: 6, rate: 0.08 },
          { name: 'Off Peak', startHour: 6, endHour: 11, rate: 0.4081 },
          { name: 'Super Off Peak', startHour: 11, endHour: 14, rate: 0.00 },
          { name: 'Off Peak', startHour: 14, endHour: 15, rate: 0.4081 },
          { name: 'Peak', startHour: 15, endHour: 21, rate: 0.6127 },
          { name: 'Off Peak', startHour: 21, endHour: 24, rate: 0.4081 },
        ],
      }],
    },
    {
      name: 'Shoulder',
      months: [4,5,9,10],
      schedules: [{
        name: 'All Days',
        days: [0,1,2,3,4,5,6],
        rates: [
          { name: 'EV', startHour: 0, endHour: 6, rate: 0.08 },
          { name: 'Off Peak', startHour: 6, endHour: 11, rate: 0.4081 },
          { name: 'Super Off Peak', startHour: 11, endHour: 14, rate: 0.00 },
          { name: 'Off Peak', startHour: 14, endHour: 24, rate: 0.4081 },
        ],
      }],
    },
  ],
};

const POWERSHOP_EV_DAY_PLAN = {
  name: 'Powershop EV Day',
  dailySupplyCharge: 1.2284,
  feedInTariff: 0.005,
  seasons: [
    {
      name: 'All Year',
      months: [1,2,3,4,5,6,7,8,9,10,11,12],
      schedules: [{
        name: 'All Days',
        days: [0,1,2,3,4,5,6],
        rates: [
          { name: 'Off Peak', startHour: 0, endHour: 12, rate: 0.2376 },
          { name: 'Super Off Peak', startHour: 12, endHour: 14, rate: 0.00 },
          { name: 'Off Peak', startHour: 14, endHour: 15, rate: 0.2376 },
          { name: 'Peak', startHour: 15, endHour: 21, rate: 0.4620 },
          { name: 'Off Peak', startHour: 21, endHour: 24, rate: 0.2376 },
        ],
      }],
    },
  ],
};

const EMPTY_PLAN = {
  name: '',
  dailySupplyCharge: 0,
  feedInTariff: 0,
  seasons: [{
    name: 'All Year',
    months: [1,2,3,4,5,6,7,8,9,10,11,12],
    schedules: [
      {
        name: 'Weekdays',
        days: [1,2,3,4,5],
        rates: [{ name: 'Peak', startHour: 14, endHour: 20, rate: 0 },
                { name: 'Off Peak', startHour: 0, endHour: 14, rate: 0 },
                { name: 'Off Peak', startHour: 20, endHour: 24, rate: 0 }],
      },
      {
        name: 'Weekends',
        days: [0,6],
        rates: [{ name: 'Off Peak', startHour: 0, endHour: 24, rate: 0 }],
      },
    ],
  }],
};

/* ------------------------------------------------------------------ */

class TariffEditor {
  constructor(containerId, defaultPlan) {
    this.container = document.getElementById(containerId);
    this.plan = JSON.parse(JSON.stringify(defaultPlan));
    this.openAll();
    this.bound = false;
    this.render();
  }

  getPlan()  { return JSON.parse(JSON.stringify(this.plan)); }

  /** Rebuild openSeasons/openSchedules to include every season & schedule. */
  openAll() {
    this.openSeasons = new Set();
    this.openSchedules = new Set();
    this.plan.seasons.forEach((s, si) => {
      this.openSeasons.add(si);
      (s.schedules || []).forEach((_, sci) => this.openSchedules.add(`${si}-${sci}`));
    });
  }
  setPlan(p) {
    this.plan = JSON.parse(JSON.stringify(p));
    this.openAll();
    this.render();
  }

  /* ---- colour helper ---- */
  rateColor(name) {
    return RATE_COLORS[(name || '').toLowerCase().trim()] || 'var(--rate-default)';
  }

  /* ---- main render ---- */
  render() {
    const p = this.plan;
    const usedMonths = {};
    p.seasons.forEach((s, si) => (s.months || []).forEach(m => { usedMonths[m] = si; }));

    let h = `<div class="plan-fields">
      <div class="field-row">
        <div class="field" style="flex:2"><label>Plan Name</label>
          <input type="text" value="${esc(p.name)}" data-field="name"></div>
        <div class="field"><label>Supply ($/day)</label>
          <input type="text" value="${p.dailySupplyCharge}" data-field="dailySupplyCharge"></div>
        <div class="field"><label>Feed-in ($/kWh)</label>
          <input type="text" value="${p.feedInTariff}" data-field="feedInTariff"></div>
      </div></div>
      <div class="seasons-area">`;

    p.seasons.forEach((season, si) => { h += this.renderSeason(season, si, usedMonths); });

    h += `<div style="padding:0.5rem 1.25rem 0.75rem">
        <button class="btn-add" data-action="add-season">+ Add Season</button></div></div>`;

    this.container.innerHTML = h;
    this.bind();
  }

  /* ---- season ---- */
  renderSeason(season, si, usedMonths) {
    const open = this.openSeasons.has(si);
    const chevron = `<svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;

    let h = `<div class="season-block" data-season="${si}">
      <div class="season-header ${open?'open':''}" data-action="toggle-season" data-si="${si}">
        <h4>${esc(season.name)}
          <span style="color:var(--text-muted);font-weight:400;font-size:0.75rem">(${(season.months||[]).map(m=>MONTH_LABELS[m-1]).join(', ')||'no months'})</span></h4>
        <div style="display:flex;align-items:center;gap:0.5rem">
          ${this.plan.seasons.length>1?`<button class="btn-icon danger" data-action="rm-season" data-si="${si}" title="Remove">&times;</button>`:''}
          ${chevron}</div></div>
      <div class="season-body" ${open?'':'hidden'}>
        <div class="season-name-row">
          <input class="season-name-input" type="text" value="${esc(season.name)}" data-action="season-name" data-si="${si}" placeholder="Season name">
        </div>
        <div>
          <label style="font-size:0.7rem;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">Months</label>
          <div class="month-picker">`;

    for (let m = 1; m <= 12; m++) {
      const active = (season.months||[]).includes(m);
      const taken = usedMonths[m] !== undefined && usedMonths[m] !== si;
      h += `<button class="month-btn ${active?'active':''} ${taken?'disabled':''}"
        data-action="toggle-month" data-si="${si}" data-month="${m}" ${taken?'disabled':''}>${MONTH_LABELS[m-1]}</button>`;
    }
    h += `</div></div>`;

    /* schedules inside season */
    (season.schedules||[]).forEach((sched, sci) => {
      h += this.renderSchedule(sched, si, sci, season);
    });

    h += `<div style="padding:0.25rem 0"><button class="btn-add" data-action="add-schedule" data-si="${si}">+ Add Day Schedule</button></div>`;
    h += `</div></div>`;
    return h;
  }

  /* ---- schedule (day-group) ---- */
  renderSchedule(sched, si, sci, season) {
    const key = `${si}-${sci}`;
    const open = this.openSchedules.has(key);
    const usedDays = {};
    (season.schedules||[]).forEach((s, i) => { if (i !== sci) (s.days||[]).forEach(d => { usedDays[d] = i; }); });

    const chevron = `<svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;

    let h = `<div class="schedule-block">
      <div class="schedule-header ${open?'open':''}" data-action="toggle-schedule" data-si="${si}" data-sci="${sci}">
        <span class="schedule-title">${esc(sched.name)} <span style="color:var(--text-muted);font-weight:400;font-size:0.7rem">(${(sched.days||[]).map(d=>DAY_LABELS[d]).join(', ')||'none'})</span></span>
        <div style="display:flex;align-items:center;gap:0.5rem">
          ${(season.schedules||[]).length>1?`<button class="btn-icon danger" data-action="rm-schedule" data-si="${si}" data-sci="${sci}" title="Remove">&times;</button>`:''}
          ${chevron}</div></div>
      <div class="schedule-body" ${open?'':'hidden'}>
        <div class="field-row" style="align-items:center">
          <input class="season-name-input" type="text" value="${esc(sched.name)}" data-action="sched-name" data-si="${si}" data-sci="${sci}" placeholder="Schedule name" style="width:140px">
        </div>
        <div>
          <label style="font-size:0.7rem;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">Days</label>
          <div class="day-picker">`;

    for (let d = 0; d < 7; d++) {
      const active = (sched.days||[]).includes(d);
      const taken = usedDays[d] !== undefined;
      h += `<button class="day-btn ${active?'active':''} ${taken?'disabled':''}"
        data-action="toggle-day" data-si="${si}" data-sci="${sci}" data-day="${d}" ${taken?'disabled':''}>${DAY_LABELS[d]}</button>`;
    }
    h += `</div></div>`;

    /* rate table */
    h += `<div class="rate-section-label"><span>Rates</span>
      <button class="btn-add" data-action="add-rate" data-si="${si}" data-sci="${sci}">+ Rate</button></div>`;
    h += `<table class="rate-table"><thead><tr>
      <th>Name</th><th>From</th><th>To</th><th>$/kWh</th><th></th></tr></thead><tbody>`;

    (sched.rates||[]).forEach((r, ri) => {
      h += `<tr>
        <td><input class="rate-name-input" type="text" value="${esc(r.name)}" data-action="rate-field" data-si="${si}" data-sci="${sci}" data-ri="${ri}" data-prop="name"></td>
        <td><input class="rate-hour-input" type="number" min="0" max="23" value="${r.startHour}" data-action="rate-field" data-si="${si}" data-sci="${sci}" data-ri="${ri}" data-prop="startHour"></td>
        <td><input class="rate-hour-input" type="number" min="1" max="24" value="${r.endHour}" data-action="rate-field" data-si="${si}" data-sci="${sci}" data-ri="${ri}" data-prop="endHour"></td>
        <td><input class="rate-price-input" type="text" value="${r.rate}" data-action="rate-field" data-si="${si}" data-sci="${sci}" data-ri="${ri}" data-prop="rate"></td>
        <td><button class="btn-icon danger" data-action="rm-rate" data-si="${si}" data-sci="${sci}" data-ri="${ri}">&times;</button></td></tr>`;
    });

    h += `</tbody></table>`;
    h += this.renderTimeline(sched.rates);
    h += `</div></div>`;
    return h;
  }

  /* ---- 24-h timeline ---- */
  renderTimeline(rates) {
    if (!rates || !rates.length) return '';
    const sorted = [...rates].sort((a,b) => a.startHour - b.startHour);
    let h = `<div class="rate-timeline">`;
    for (const r of sorted) {
      const left = (r.startHour / 24) * 100;
      const width = ((r.endHour - r.startHour) / 24) * 100;
      const color = this.rateColor(r.name);
      const lbl = width > 8 ? r.name : '';
      h += `<div class="rate-segment" style="left:${left}%;width:${width}%;background:${color}" title="${r.name} ${r.startHour}:00–${r.endHour}:00 $${r.rate}/kWh">${lbl}</div>`;
    }
    h += `</div><div class="timeline-hours">`;
    for (let t = 0; t <= 24; t += 3) {
      h += `<span>${t===0?'12a':t===12?'12p':t<12?t+'a':(t-12)+'p'}</span>`;
    }
    h += `</div>`;
    return h;
  }

  /* ---- events ---- */
  bind() {
    if (this.bound) return;
    this.bound = true;
    const el = this.container;

    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      const si = parseInt(btn.dataset.si);
      const sci = parseInt(btn.dataset.sci);

      switch (a) {
        case 'toggle-season':
          if (e.target.closest('.btn-icon')) return;
          this.openSeasons.has(si) ? this.openSeasons.delete(si) : this.openSeasons.add(si);
          this.render(); break;
        case 'rm-season':
          e.stopPropagation();
          this.plan.seasons.splice(si, 1);
          this.openAll();
          this.render(); break;
        case 'add-season':
          this.plan.seasons.push({ name: 'New Season', months: [], schedules: [
            { name: 'All Days', days: [0,1,2,3,4,5,6], rates: [{ name:'Peak', startHour:0, endHour:24, rate:0 }] }
          ]});
          this.openSeasons.add(this.plan.seasons.length - 1);
          this.render(); break;
        case 'toggle-month': {
          const m = parseInt(btn.dataset.month);
          const months = this.plan.seasons[si].months;
          const idx = months.indexOf(m);
          idx >= 0 ? months.splice(idx,1) : months.push(m);
          months.sort((a,b)=>a-b);
          this.render(); break;
        }
        case 'toggle-schedule':
          if (e.target.closest('.btn-icon')) return;
          { const k = `${si}-${sci}`; this.openSchedules.has(k) ? this.openSchedules.delete(k) : this.openSchedules.add(k); }
          this.render(); break;
        case 'rm-schedule':
          e.stopPropagation();
          this.plan.seasons[si].schedules.splice(sci, 1);
          this.render(); break;
        case 'add-schedule':
          this.plan.seasons[si].schedules.push({ name:'New Schedule', days:[], rates:[{ name:'Peak', startHour:0, endHour:24, rate:0 }] });
          this.openSchedules.add(`${si}-${this.plan.seasons[si].schedules.length-1}`);
          this.render(); break;
        case 'toggle-day': {
          const d = parseInt(btn.dataset.day);
          const days = this.plan.seasons[si].schedules[sci].days;
          const idx = days.indexOf(d);
          idx >= 0 ? days.splice(idx,1) : days.push(d);
          days.sort((a,b)=>a-b);
          this.render(); break;
        }
        case 'add-rate':
          this.plan.seasons[si].schedules[sci].rates.push({ name:'', startHour:0, endHour:24, rate:0 });
          this.render(); break;
        case 'rm-rate':
          this.plan.seasons[si].schedules[sci].rates.splice(parseInt(btn.dataset.ri), 1);
          this.render(); break;
      }
    });

    el.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.field) {
        this.plan[t.dataset.field] = t.dataset.field === 'name' ? t.value : (parseFloat(t.value) || 0);
      }
      if (t.dataset.action === 'season-name') this.plan.seasons[parseInt(t.dataset.si)].name = t.value;
      if (t.dataset.action === 'sched-name') this.plan.seasons[parseInt(t.dataset.si)].schedules[parseInt(t.dataset.sci)].name = t.value;
      if (t.dataset.action === 'rate-field') {
        const r = this.plan.seasons[parseInt(t.dataset.si)].schedules[parseInt(t.dataset.sci)].rates[parseInt(t.dataset.ri)];
        const prop = t.dataset.prop;
        r[prop] = prop === 'name' ? t.value : prop === 'rate' ? (parseFloat(t.value) || 0) : (parseInt(t.value) || 0);
      }
    });

    el.addEventListener('focusout', (e) => {
      if (e.target.dataset.action === 'rate-field') this.render();
    });
  }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s||''; return d.innerHTML; }
