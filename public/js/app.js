/**
 * Energize — Results-First Dashboard Controller
 *
 * Loads data immediately, shows results, lets user tweak via drawers.
 */
document.addEventListener('DOMContentLoaded', () => {

  /* ── State ── */
  let holidays = new Set();
  let energyData = null;
  let currentPlan = JSON.parse(JSON.stringify(DEFAULT_OVO_PLAN));
  let batteryConfig = JSON.parse(JSON.stringify(DEFAULT_BATTERY));
  batteryConfig.enabled = true; // On by default in dashboard mode
  let batteryRules = JSON.parse(JSON.stringify(DEFAULT_RULES));
  let activePreset = 'optimized';
  let comparisonPlan = null;
  let comparisonResults = null;
  let solarConfig = { panelsKw: 7.4, inverterKw: 6, cost: 6400, installDate: '2022-12-01' };

  /* ── Editors (lazy init) ── */
  let tariffEditor = null;
  let batteryUI = null;
  let comparisonEditor = null;

  /* ── DOM ── */
  const $loading = document.getElementById('loading-state');
  const $error = document.getElementById('error-state');
  const $dashboard = document.getElementById('dashboard');
  const $loadingText = document.getElementById('loading-text');

  /* ── Settings Drawer ── */
  const settingsBtn = document.getElementById('settings-btn');
  const settingsDrawer = document.getElementById('settings-drawer');
  const settingsOverlay = document.getElementById('drawer-overlay');
  const settingsClose = document.getElementById('settings-close');
  const stateSelect = document.getElementById('state-select');
  const billingDay = document.getElementById('billing-day');
  const holidaySelect = document.getElementById('holiday-treatment');
  const gstCheckbox = document.getElementById('gst-inclusive');
  const calImport = document.getElementById('cal-import');
  const calExport = document.getElementById('cal-export');

  function openDrawer(drawer, overlay) { drawer.hidden = false; overlay.hidden = false; }
  function closeDrawer(drawer, overlay) { drawer.hidden = true; overlay.hidden = true; }

  settingsBtn.addEventListener('click', () => openDrawer(settingsDrawer, settingsOverlay));
  settingsClose.addEventListener('click', () => closeDrawer(settingsDrawer, settingsOverlay));
  settingsOverlay.addEventListener('click', () => closeDrawer(settingsDrawer, settingsOverlay));

  // Re-calculate on settings change
  [stateSelect, billingDay, holidaySelect, gstCheckbox, calImport, calExport].forEach(el => {
    el.addEventListener('change', async () => {
      if (el === stateSelect) await loadHolidays();
      if (energyData) recalculate();
    });
  });

  /* ── Tariff Drawer ── */
  const tariffOverlay = document.getElementById('tariff-overlay');
  const tariffDrawer = document.getElementById('tariff-drawer');
  document.getElementById('edit-tariff-btn').addEventListener('click', () => {
    if (!tariffEditor) {
      tariffEditor = new TariffEditor('tariff-editor-container', currentPlan);
    } else {
      tariffEditor.setPlan(currentPlan);
    }
    openDrawer(tariffDrawer, tariffOverlay);
  });
  document.getElementById('tariff-close').addEventListener('click', () => closeDrawer(tariffDrawer, tariffOverlay));
  tariffOverlay.addEventListener('click', () => closeDrawer(tariffDrawer, tariffOverlay));
  document.getElementById('tariff-apply').addEventListener('click', () => {
    currentPlan = tariffEditor.getPlan();
    closeDrawer(tariffDrawer, tariffOverlay);
    recalculate();
  });

  /* ── Battery Drawer ── */
  const batteryOverlay = document.getElementById('battery-overlay');
  const batteryDrawer = document.getElementById('battery-drawer');
  document.getElementById('edit-battery-btn').addEventListener('click', () => {
    if (!batteryUI) {
      batteryUI = new BatteryUI('battery-editor-container');
      batteryUI.battery = JSON.parse(JSON.stringify(batteryConfig));
      batteryUI.battery.enabled = true;
      batteryUI.rules = JSON.parse(JSON.stringify(batteryRules));
      batteryUI.render();
    } else {
      batteryUI.battery = JSON.parse(JSON.stringify(batteryConfig));
      batteryUI.battery.enabled = true;
      batteryUI.rules = JSON.parse(JSON.stringify(batteryRules));
      batteryUI.render();
    }
    openDrawer(batteryDrawer, batteryOverlay);
  });
  document.getElementById('battery-close').addEventListener('click', () => closeDrawer(batteryDrawer, batteryOverlay));
  batteryOverlay.addEventListener('click', () => closeDrawer(batteryDrawer, batteryOverlay));
  document.getElementById('battery-apply').addEventListener('click', () => {
    batteryConfig = batteryUI.getConfig();
    batteryConfig.enabled = true;
    batteryRules = batteryUI.getRules();
    activePreset = null; // Custom
    closeDrawer(batteryDrawer, batteryOverlay);
    recalculate();
  });

  /* ── Solar Drawer ── */
  const solarOverlay = document.getElementById('solar-overlay');
  const solarDrawer = document.getElementById('solar-drawer');
  document.getElementById('edit-solar-btn').addEventListener('click', () => {
    document.getElementById('solar-panels-kw').value = solarConfig.panelsKw;
    document.getElementById('solar-inverter-kw').value = solarConfig.inverterKw;
    document.getElementById('solar-cost').value = solarConfig.cost;
    document.getElementById('solar-install-date').value = solarConfig.installDate;
    openDrawer(solarDrawer, solarOverlay);
  });
  document.getElementById('solar-close').addEventListener('click', () => closeDrawer(solarDrawer, solarOverlay));
  solarOverlay.addEventListener('click', () => closeDrawer(solarDrawer, solarOverlay));
  document.getElementById('solar-apply').addEventListener('click', () => {
    solarConfig.panelsKw = parseFloat(document.getElementById('solar-panels-kw').value) || 0;
    solarConfig.inverterKw = parseFloat(document.getElementById('solar-inverter-kw').value) || 0;
    solarConfig.cost = parseFloat(document.getElementById('solar-cost').value) || 0;
    solarConfig.installDate = document.getElementById('solar-install-date').value;
    closeDrawer(solarDrawer, solarOverlay);
    recalculate();
  });

  /* ── Comparison Drawer ── */
  const COMPARISON_PLANS = {
    'powershop-ev-day': POWERSHOP_EV_DAY_PLAN,
    'empty': EMPTY_PLAN,
  };
  const compOverlay = document.getElementById('comparison-overlay');
  const compDrawer = document.getElementById('comparison-drawer');

  function ensureComparisonEditor(plan) {
    if (!comparisonEditor) {
      comparisonEditor = new TariffEditor('comparison-editor-container', plan || EMPTY_PLAN);
    } else {
      comparisonEditor.setPlan(plan || EMPTY_PLAN);
    }
  }

  document.getElementById('add-comparison-btn').addEventListener('click', () => {
    ensureComparisonEditor(comparisonPlan || null);
    // Load saved plans into picker
    loadSavedPlansIntoPicker();
    openDrawer(compDrawer, compOverlay);
  });
  document.getElementById('comparison-close').addEventListener('click', () => closeDrawer(compDrawer, compOverlay));
  compOverlay.addEventListener('click', () => closeDrawer(compDrawer, compOverlay));

  // Plan picker
  const compPicker = document.getElementById('comparison-plan-picker');
  if (compPicker) {
    compPicker.addEventListener('change', () => {
      const plan = COMPARISON_PLANS[compPicker.value];
      if (plan) ensureComparisonEditor(plan);
    });
  }

  // EME Import
  document.getElementById('eme-import-btn').addEventListener('click', async () => {
    const planId = document.getElementById('eme-plan-id').value.trim();
    const postcode = document.getElementById('eme-postcode').value.trim();
    const status = document.getElementById('eme-import-status');
    if (!planId || !postcode) { status.textContent = '⚠ Plan ID and postcode required'; return; }
    status.textContent = '⏳ Importing...';
    try {
      const { plan } = await API.importEmePlan(planId, postcode);
      ensureComparisonEditor(plan);
      status.textContent = '✅ Imported: ' + plan.name;
      // Try to save to DB
      const slug = planId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      API.savePlan(slug, plan.name, plan, 'eme', planId, postcode).catch(() => {});
      // Add to picker dynamically
      addSavedPlanOption(slug, plan.name);
    } catch (err) {
      status.textContent = '❌ ' + err.message;
    }
  });

  async function loadSavedPlansIntoPicker() {
    try {
      const plans = await API.listPlans();
      const picker = document.getElementById('comparison-plan-picker');
      // Remove old saved-plan options
      picker.querySelectorAll('option[data-saved]').forEach(o => o.remove());
      for (const p of plans) {
        addSavedPlanOption(p.slug, p.name);
      }
    } catch {}
  }

  function addSavedPlanOption(slug, name) {
    const picker = document.getElementById('comparison-plan-picker');
    if (picker.querySelector(`option[value="saved:${slug}"]`)) return;
    const opt = document.createElement('option');
    opt.value = 'saved:' + slug;
    opt.textContent = '💾 ' + name;
    opt.dataset.saved = '1';
    picker.insertBefore(opt, picker.querySelector('option[value="empty"]'));
  }

  // Handle loading saved plans from picker
  compPicker?.addEventListener('change', async () => {
    const val = compPicker.value;
    if (val.startsWith('saved:')) {
      const slug = val.replace('saved:', '');
      try {
        const saved = await API.loadPlan(slug);
        if (saved?.plan_data) ensureComparisonEditor(saved.plan_data);
      } catch {}
    }
  });

  document.getElementById('comparison-apply').addEventListener('click', () => {
    comparisonPlan = comparisonEditor.getPlan();
    closeDrawer(compDrawer, compOverlay);
    recalculate();
  });

  /* ── Chart Tabs ── */
  document.querySelectorAll('.chart-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.chart-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    });
  });

  /* ── Battery Preset Buttons (in mini card) ── */
  document.getElementById('battery-presets').addEventListener('click', (e) => {
    const btn = e.target.closest('.preset-btn');
    if (!btn) return;
    const key = btn.dataset.preset;
    const preset = STRATEGY_PRESETS[key];
    if (!preset) return;
    batteryRules = JSON.parse(JSON.stringify(preset.rules));
    activePreset = key;
    recalculate();
  });

  /* ── Retry ── */
  document.getElementById('retry-btn').addEventListener('click', init);

  /* ══════════════════ INIT ══════════════════ */
  init();

  async function init() {
    showLoading();
    try {
      $loadingText.textContent = 'Loading holidays...';
      await loadHolidays();
      $loadingText.textContent = 'Querying 12 months of energy data...';
      await loadEnergyData();
      showDashboard();
      recalculate();
    } catch (err) {
      console.error('Init failed:', err);
      showError(err.message);
    }
  }

  function showState(state) {
    $loading.hidden = state !== 'loading';
    $error.hidden = state !== 'error';
    $dashboard.hidden = state !== 'dashboard';
  }
  function showLoading() { showState('loading'); }
  function showError(msg) {
    showState('error');
    document.getElementById('error-text').textContent = msg;
  }
  function showDashboard() { showState('dashboard'); }

  async function loadHolidays() {
    const state = stateSelect.value;
    const data = await API.fetchHolidays(state, 2024, 2027);
    holidays = new Set(data.holidays.map(h => typeof h === 'string' ? h : h.date));
  }

  async function loadEnergyData() {
    const day = parseInt(billingDay.value) || 23;
    const periods = Calculator.generateBillingPeriods(day, 14);
    const complete = periods.filter(p => p.isComplete);
    const last12 = complete.slice(0, 12);
    if (last12.length === 0) throw new Error('No complete billing periods found');
    const startDate = last12[last12.length - 1].start;
    const endDate = last12[0].end;
    energyData = await API.fetchHourlyEnergy(startDate, endDate);
    if (!energyData.hours || energyData.hours.length === 0) {
      throw new Error('No energy data returned');
    }
  }

  /* ══════════════════ RECALCULATE ══════════════════ */
  function recalculate() {
    if (!energyData) return;
    const gst = gstCheckbox.checked;
    const ht = holidaySelect.value;

    // Apply calibration
    const calImp = parseFloat(calImport.value) || 1;
    const calExp = parseFloat(calExport.value) || 1;
    const hours = Calculator.calibrateHours(energyData.hours, calImp, calExp);

    // 1) Without solar (hypothetical: all consumption from grid)
    const noSolarHours = Calculator.withoutSolarHours(hours);
    const noSolar = Calculator.calculate(noSolarHours, currentPlan, holidays, ht, gst);

    // 2) With solar, without battery (current state)
    const withSolar = Calculator.calculate(hours, currentPlan, holidays, ht, gst);

    // 3) Solar savings analysis
    const solarAnalysis = Calculator.calculateSolar(hours, currentPlan, holidays, ht, gst);

    // 4) With solar + battery
    const batHours = BatterySimulator.simulate(hours, currentPlan, batteryConfig, batteryRules, holidays, ht, gst);
    const withBat = batHours ? Calculator.calculate(batHours, currentPlan, holidays, ht, gst) : withSolar;

    const solarSavings = noSolar.totalCost - withSolar.totalCost;
    const batterySavings = withSolar.totalCost - withBat.totalCost;
    const totalSavings = noSolar.totalCost - withBat.totalCost;
    const batteryPayback = BatterySimulator.paybackYears(batterySavings, batteryConfig.purchasePrice);

    // Solar payback estimate
    const installDate = new Date(solarConfig.installDate);
    const now = new Date();
    const yearsOwned = (now - installDate) / (365.25 * 86400000);
    const annualSolarSavings = solarSavings; // 12-month data
    const estCumulativeSavings = annualSolarSavings * yearsOwned;
    const solarPaybackPct = Math.min(100, (estCumulativeSavings / solarConfig.cost) * 100);
    const solarPaidOff = estCumulativeSavings >= solarConfig.cost;

    // KPIs
    document.getElementById('kpi-nosolar-val').textContent = '$' + Math.round(noSolar.totalCost).toLocaleString();
    document.getElementById('kpi-nosolar-sub').textContent = noSolar.days + ' days';
    document.getElementById('kpi-withsolar-val').textContent = '$' + Math.round(withSolar.totalCost).toLocaleString();
    document.getElementById('kpi-withsolar-sub').textContent = '-$' + Math.round(solarSavings).toLocaleString() + '/yr';
    document.getElementById('kpi-withbat-val').textContent = '$' + Math.round(withBat.totalCost).toLocaleString();
    document.getElementById('kpi-withbat-sub').textContent = '-$' + Math.round(batterySavings).toLocaleString() + '/yr';
    document.getElementById('kpi-savings-val').textContent = '$' + Math.round(totalSavings).toLocaleString();
    document.getElementById('kpi-savings-sub').textContent = 'saved per year';

    // Tariff mini card
    renderTariffMini();

    // Solar mini card
    renderSolarMini(solarAnalysis, solarSavings, solarPaybackPct, solarPaidOff, yearsOwned);

    // Battery mini card
    renderBatteryMini(batterySavings, batteryPayback);

    // 5) Comparison plan (if set)
    let compWithSolar = null, compWithBat = null;
    if (comparisonPlan) {
      compWithSolar = Calculator.calculate(hours, comparisonPlan, holidays, ht, gst);
      const compBatHours = BatterySimulator.simulate(hours, comparisonPlan, batteryConfig, batteryRules, holidays, ht, gst);
      compWithBat = compBatHours ? Calculator.calculate(compBatHours, comparisonPlan, holidays, ht, gst) : compWithSolar;
    }

    // Charts
    renderCharts(hours, withSolar, withBat, batHours, compWithSolar, compWithBat);

    // Breakdown
    renderBreakdown(noSolar, withSolar, withBat, compWithBat);

    // Animate
    document.querySelectorAll('.kpi-strip, .config-row, .charts-section, .breakdown-section, .compare-strip').forEach((el, i) => {
      el.classList.remove('fade-in', 'fade-in-d1', 'fade-in-d2', 'fade-in-d3', 'fade-in-d4');
      void el.offsetWidth;
      el.classList.add('fade-in', `fade-in-d${i}`);
    });
  }

  /* ── Tariff Mini ── */
  const RATE_COLORS = {
    'peak': 'var(--rate-peak)', 'off peak': 'var(--rate-offpeak)', 'offpeak': 'var(--rate-offpeak)',
    'super off peak': 'var(--rate-superoffpeak)', 'super offpeak': 'var(--rate-superoffpeak)',
    'ev': 'var(--rate-ev)', 'ev charging': 'var(--rate-ev)', 'shoulder': 'var(--rate-shoulder)',
  };
  // Fallback hex values for computed colour lookup
  const RATE_HEX = {
    'var(--rate-peak)': '#ef4444', 'var(--rate-offpeak)': '#3b82f6',
    'var(--rate-superoffpeak)': '#22c55e', 'var(--rate-ev)': '#8b5cf6',
    'var(--rate-shoulder)': '#f59e0b', 'var(--rate-default)': '#94a3b8',
  };

  function renderTariffMini() {
    document.getElementById('tariff-card-name').textContent = currentPlan.name || 'Custom Plan';

    const season = currentPlan.seasons[0];
    const schedule = season?.schedules?.[0];
    const rates = schedule?.rates || [];
    const sorted = [...rates].sort((a, b) => a.startHour - b.startHour);

    const timeline = document.getElementById('tariff-mini-timeline');
    timeline.innerHTML = sorted.map(r => {
      const pct = ((r.endHour - r.startHour) / 24 * 100);
      const color = RATE_COLORS[(r.name || '').toLowerCase().trim()] || 'var(--rate-default)';
      return `<div class="tariff-seg" style="width:${pct}%;background:${color}"
        title="${r.name} ${r.startHour}:00–${r.endHour}:00 $${r.rate}/kWh"></div>`;
    }).join('');

    // Hour markers
    const hoursEl = document.getElementById('tariff-mini-hours');
    if (hoursEl) {
      const ticks = [0, 3, 6, 9, 12, 15, 18, 21, 24];
      hoursEl.innerHTML = ticks.map(h => {
        const pct = (h / 24 * 100);
        const label = h === 0 ? '12a' : h === 12 ? '12p' : h === 24 ? '12a' : h < 12 ? h + 'a' : (h - 12) + 'p';
        return `<span class="tariff-hour-label" style="left:${pct}%">${label}</span>`;
      }).join('');
    }

    // Legend — deduplicated by name
    const legendEl = document.getElementById('tariff-mini-legend');
    if (legendEl) {
      const seen = new Map();
      sorted.forEach(r => {
        const key = r.name.toLowerCase().trim();
        if (!seen.has(key)) seen.set(key, r);
      });
      legendEl.innerHTML = Array.from(seen.values()).map(r => {
        const color = RATE_COLORS[r.name.toLowerCase().trim()] || 'var(--rate-default)';
        return `<span class="tariff-legend-item">
          <span class="tariff-legend-swatch" style="background:${color}"></span>
          ${esc(r.name)} <span class="tariff-legend-rate">$${r.rate}/kWh</span>
        </span>`;
      }).join('');
    }

    // Stats
    const stats = document.getElementById('tariff-mini-stats');
    stats.innerHTML = `
      <div class="mini-stat"><span class="mini-stat-label">Supply</span><span class="mini-stat-value">$${currentPlan.dailySupplyCharge}/day</span></div>
      <div class="mini-stat"><span class="mini-stat-label">Feed-in</span><span class="mini-stat-value">$${currentPlan.feedInTariff}/kWh</span></div>
    `;
  }

  /* ── Solar Mini ── */
  function renderSolarMini(analysis, annualSavings, paybackPct, paidOff, yearsOwned) {
    document.getElementById('solar-card-title').textContent = solarConfig.panelsKw + ' kW System';

    const scRate = (analysis.selfConsumptionRate * 100).toFixed(0);
    document.getElementById('solar-mini-stats').innerHTML = `
      <div class="solar-stat"><span class="solar-stat-label">Generated</span><span class="solar-stat-value">${Math.round(analysis.totalSolarKwh).toLocaleString()} kWh</span></div>
      <div class="solar-stat"><span class="solar-stat-label">Self-consumed</span><span class="solar-stat-value">${scRate}%</span></div>
      <div class="solar-stat"><span class="solar-stat-label">Saves</span><span class="solar-stat-value">$${Math.round(annualSavings).toLocaleString()}/yr</span></div>
      <div class="solar-stat"><span class="solar-stat-label">System cost</span><span class="solar-stat-value">$${solarConfig.cost.toLocaleString()}</span></div>
    `;

    const fill = document.getElementById('solar-payback-fill');
    fill.style.width = Math.min(100, paybackPct).toFixed(1) + '%';
    const label = document.getElementById('solar-payback-label');
    if (paidOff) {
      label.textContent = '✅ Paid off in ~' + (solarConfig.cost / annualSavings).toFixed(1) + ' yrs';
      fill.style.background = 'linear-gradient(90deg, #22c55e, #16a34a)';
    } else {
      const remaining = solarConfig.cost - (annualSavings * yearsOwned);
      const monthsLeft = (remaining / annualSavings) * 12;
      label.textContent = Math.round(paybackPct) + '% — ~' + Math.ceil(monthsLeft) + ' months left';
    }
  }

  /* ── Battery Mini ── */
  function renderBatteryMini(savings, payback) {
    const presetLabel = activePreset
      ? (STRATEGY_PRESETS[activePreset]?.label || activePreset)
      : 'Custom';
    document.getElementById('battery-card-title').textContent = presetLabel;

    document.getElementById('battery-mini-specs').innerHTML = `
      <span><span class="spec-dot"></span>${batteryConfig.capacityKwh} kWh</span>
      <span><span class="spec-dot"></span>${batteryConfig.chargeRateKw} kW</span>
      <span><span class="spec-dot"></span>$${Math.round(savings).toLocaleString()}/yr</span>
      <span><span class="spec-dot"></span>${payback === Infinity ? '∞' : payback.toFixed(1) + 'yr'} payback</span>
    `;

    const presetsEl = document.getElementById('battery-presets');
    presetsEl.innerHTML = Object.entries(STRATEGY_PRESETS).map(([key, p]) => {
      const isActive = key === activePreset;
      return `<button class="preset-btn ${isActive ? 'active' : ''}" data-preset="${key}" title="${esc(p.desc || '')}">${p.label}</button>`;
    }).join('');
  }

  /* ── Charts ── */
  function renderCharts(hours, noBat, withBat, batHours, compWithSolar, compWithBat) {
    const day = parseInt(billingDay.value) || 23;
    const periods = Calculator.generateBillingPeriods(day, 14);
    const complete = periods.filter(p => p.isComplete).slice(0, 12).reverse();
    const gst = gstCheckbox.checked;
    const ht = holidaySelect.value;

    const periodResults = complete.map(p => {
      const pHours = hours.filter(h => h.localDate >= p.start && h.localDate <= p.end);
      const c = Calculator.calculate(pHours, currentPlan, holidays, ht, gst);
      let bat = null;
      if (batHours) {
        const bH = batHours.filter(h => h.localDate >= p.start && h.localDate <= p.end);
        bat = Calculator.calculate(bH, currentPlan, holidays, ht, gst);
      }
      let comp = null, compBat = null;
      if (comparisonPlan) {
        comp = Calculator.calculate(pHours, comparisonPlan, holidays, ht, gst);
        const compBatH = BatterySimulator.simulate(pHours, comparisonPlan, batteryConfig, batteryRules, holidays, ht, gst);
        compBat = compBatH ? Calculator.calculate(compBatH, comparisonPlan, holidays, ht, gst) : comp;
      }
      const [y, m] = p.start.split('-').map(Number);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return {
        label: months[m - 1] + ' ' + y,
        currentCost: c.totalCost,
        currentBatCost: bat ? bat.totalCost : c.totalCost,
        compCost: comp ? comp.totalCost : null,
        compBatCost: compBat ? compBat.totalCost : null,
      };
    });

    Charts.destroy('monthly-chart');
    const ctx = document.getElementById('monthly-chart').getContext('2d');
    const colors = Charts.getChartColors();
    const datasets = [
      {
        label: currentPlan.name + ' (no battery)',
        data: periodResults.map(p => p.currentCost),
        backgroundColor: colors.offpeak + '60',
        borderColor: colors.offpeak,
        borderWidth: 1, borderRadius: 4,
      },
      {
        label: currentPlan.name + ' + Battery',
        data: periodResults.map(p => p.currentBatCost),
        backgroundColor: colors.accent + '80',
        borderColor: colors.accent,
        borderWidth: 1, borderRadius: 4,
      },
    ];
    if (comparisonPlan) {
      datasets.push({
        label: comparisonPlan.name + ' (no battery)',
        data: periodResults.map(p => p.compCost),
        backgroundColor: colors.peak + '60',
        borderColor: colors.peak,
        borderWidth: 1, borderRadius: 4,
      });
      datasets.push({
        label: comparisonPlan.name + ' + Battery',
        data: periodResults.map(p => p.compBatCost),
        backgroundColor: '#f59e0b80',
        borderColor: '#f59e0b',
        borderWidth: 1, borderRadius: 4,
      });
    }
    Charts.instances['monthly-chart'] = new Chart(ctx, {
      type: 'bar',
      data: { labels: periodResults.map(p => p.label), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            position: 'top',
            labels: { font: { family: "'Outfit', sans-serif", size: 11 }, padding: 12, usePointStyle: true, pointStyle: 'rectRounded' },
          },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: $${c.raw.toFixed(2)}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: "'Outfit', sans-serif", size: 10 }, maxRotation: 45 } },
          y: { grid: { color: colors.border }, ticks: { font: { family: "'JetBrains Mono', monospace", size: 11 }, callback: v => '$' + v } },
        },
      },
    });

    // Daily cost
    Charts.renderDailyCost('daily-chart', noBat.dailyCosts, withBat.dailyCosts);

    // Hourly pattern
    Charts.renderHourlyPattern('hourly-chart', Calculator.hourlyAverage(hours));

    // SoC
    if (batHours) Charts.renderSoC('soc-chart', batHours);
  }

  /* ── Breakdown ── */
  function renderBreakdown(noSolar, withSolar, withBat, compWithBat) {
    const COLORS = {
      'peak': 'var(--rate-peak)', 'off peak': 'var(--rate-offpeak)',
      'super off peak': 'var(--rate-superoffpeak)', 'ev': 'var(--rate-ev)',
      'shoulder': 'var(--rate-shoulder)',
    };

    function buildTable(result, caption) {
      let html = `<table class="breakdown-table"><caption>${caption}</caption>
        <thead><tr><th>Rate</th><th>kWh</th><th>Cost</th></tr></thead><tbody>`;
      const sorted = Object.entries(result.byRate).sort(([, a], [, b]) => b.cost - a.cost);
      for (const [name, data] of sorted) {
        const color = COLORS[name.toLowerCase()] || 'var(--rate-default)';
        html += `<tr>
          <td><span class="rate-dot" style="background:${color}"></span>${name}</td>
          <td class="mono">${data.kwh.toFixed(0)}</td>
          <td class="mono">$${data.cost.toFixed(2)}</td></tr>`;
      }
      html += `</tbody><tfoot>
        <tr><td>Usage</td><td class="mono">${result.totalImportKwh.toFixed(0)}</td><td class="mono">$${result.totalUsageCost.toFixed(2)}</td></tr>
        <tr><td>Supply</td><td></td><td class="mono">$${result.supplyCharge.toFixed(2)}</td></tr>
        <tr><td>Solar FiT</td><td class="mono">${result.totalExportKwh.toFixed(0)}</td><td class="mono">-$${result.totalExportCredit.toFixed(2)}</td></tr>
        <tr><td><strong>Total</strong></td><td></td><td class="mono"><strong>$${result.totalCost.toFixed(2)}</strong></td></tr>
      </tfoot></table>`;
      return html;
    }

    let html = buildTable(noSolar, 'No Solar') +
      buildTable(withSolar, currentPlan.name) +
      buildTable(withBat, currentPlan.name + ' + Battery');
    if (compWithBat && comparisonPlan) {
      html += buildTable(compWithBat, comparisonPlan.name + ' + Battery');
    }
    document.getElementById('rate-breakdown').innerHTML = html;
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
});
