/**
 * Chart rendering for Energize.
 */
const Charts = {
  instances: {},

  destroy(id) {
    if (this.instances[id]) {
      this.instances[id].destroy();
      delete this.instances[id];
    }
  },

  destroyAll() {
    Object.keys(this.instances).forEach(id => this.destroy(id));
  },

  getChartColors() {
    const style = getComputedStyle(document.documentElement);
    return {
      accent: style.getPropertyValue('--accent').trim(),
      positive: style.getPropertyValue('--positive').trim(),
      negative: style.getPropertyValue('--negative').trim(),
      peak: style.getPropertyValue('--rate-peak').trim(),
      offpeak: style.getPropertyValue('--rate-offpeak').trim(),
      shoulder: style.getPropertyValue('--rate-shoulder').trim(),
      superoffpeak: style.getPropertyValue('--rate-superoffpeak').trim(),
      ev: style.getPropertyValue('--rate-ev').trim(),
      text: style.getPropertyValue('--text-secondary').trim(),
      border: style.getPropertyValue('--border').trim(),
      muted: style.getPropertyValue('--text-muted').trim(),
    };
  },

  /**
   * Tariff rate preview — coloured bars showing $/kWh for each hour of the day.
   */
  renderRatePreview(canvasId, hourlyRates) {
    this.destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    const c = this.getChartColors();

    const rateColorMap = {
      'peak': c.peak,
      'off peak': c.offpeak,
      'offpeak': c.offpeak,
      'off-peak': c.offpeak,
      'shoulder': c.shoulder,
      'super off peak': c.superoffpeak,
      'super offpeak': c.superoffpeak,
      'ev': c.ev,
      'ev charging': c.ev,
      'overnight': c.ev,
    };
    const defaultColor = '#6b7280';

    const labels = Array.from({ length: 24 }, (_, i) => {
      if (i === 0) return '12am';
      if (i === 12) return '12pm';
      return i < 12 ? i + 'am' : (i - 12) + 'pm';
    });

    const bgColors = hourlyRates.map(h => {
      const key = (h.name || '').toLowerCase().trim();
      return (rateColorMap[key] || defaultColor) + 'cc';
    });
    const borderColors = hourlyRates.map(h => {
      const key = (h.name || '').toLowerCase().trim();
      return rateColorMap[key] || defaultColor;
    });

    this.instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: hourlyRates.map(h => h.rate),
          backgroundColor: bgColors,
          borderColor: borderColors,
          borderWidth: 1,
          borderRadius: 2,
          barPercentage: 1,
          categoryPercentage: 0.92,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const i = items[0].dataIndex;
                return `${labels[i]} — ${hourlyRates[i].name || 'Unknown'}`;
              },
              label: (ctx) => `$${ctx.raw.toFixed(4)}/kWh`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: "'JetBrains Mono', monospace", size: 9 }, maxRotation: 0 },
          },
          y: {
            beginAtZero: true,
            grid: { color: c.border },
            ticks: {
              font: { family: "'JetBrains Mono', monospace", size: 10 },
              callback: (v) => v.toFixed(2) + 'c',
              stepSize: 0.1,
            },
          },
        },
      },
    });
  },

  /**
   * 12-month bar chart comparing two plans.
   */
  renderMonthlyComparison(canvasId, periodResults) {
    this.destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    const c = this.getChartColors();

    const labels = periodResults.map(p => p.label);
    const currentData = periodResults.map(p => p.currentCost);
    const comparisonData = periodResults.map(p => p.comparisonCost);
    const hasBattery = periodResults.some(p => p.currentBatCost != null);

    const datasets = [
      {
        label: 'Current Plan',
        data: currentData,
        backgroundColor: c.accent + '99',
        borderColor: c.accent,
        borderWidth: 1,
        borderRadius: 4,
      },
      {
        label: 'Comparison Plan',
        data: comparisonData,
        backgroundColor: '#6366f1' + '99',
        borderColor: '#6366f1',
        borderWidth: 1,
        borderRadius: 4,
      },
    ];

    if (hasBattery) {
      datasets.push({
        label: 'Current + Battery',
        data: periodResults.map(p => p.currentBatCost),
        backgroundColor: c.accent + '44',
        borderColor: c.accent,
        borderWidth: 1,
        borderDash: [4, 4],
        borderRadius: 4,
      });
      datasets.push({
        label: 'Comparison + Battery',
        data: periodResults.map(p => p.comparisonBatCost),
        backgroundColor: '#6366f1' + '44',
        borderColor: '#6366f1',
        borderWidth: 1,
        borderDash: [4, 4],
        borderRadius: 4,
      });
    }

    this.instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            position: 'top',
            labels: { font: { family: "'Outfit', sans-serif", size: 12 }, padding: 16 },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: $${ctx.raw.toFixed(2)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { family: "'Outfit', sans-serif", size: 10 },
              maxRotation: 45,
            },
          },
          y: {
            grid: { color: c.border },
            ticks: {
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              callback: (v) => '$' + v,
            },
          },
        },
      },
    });
  },

  /**
   * Daily cost line chart.
   */
  renderDailyCost(canvasId, currentDaily, comparisonDaily) {
    this.destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    const c = this.getChartColors();

    const labels = currentDaily.map(d => {
      const parts = d.date.split('-');
      return `${parseInt(parts[2])}/${parseInt(parts[1])}`;
    });

    this.instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Current Plan',
            data: currentDaily.map(d => d.totalCost),
            borderColor: c.accent,
            backgroundColor: c.accent + '18',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
          },
          {
            label: 'Comparison Plan',
            data: comparisonDaily.map(d => d.totalCost),
            borderColor: '#6366f1',
            backgroundColor: '#6366f1' + '18',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            position: 'top',
            labels: { font: { family: "'Outfit', sans-serif", size: 12 }, padding: 16 },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: $${ctx.raw.toFixed(2)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: "'JetBrains Mono', monospace", size: 10 } },
          },
          y: {
            grid: { color: c.border },
            ticks: {
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              callback: (v) => '$' + v.toFixed(0),
            },
          },
        },
      },
    });
  },

  /**
   * Battery SoC line chart.
   */
  renderSoC(canvasId, batteryHours) {
    this.destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    const c = this.getChartColors();

    // Thin out labels: show every 24th (once per day)
    const labels = batteryHours.map((h, i) => {
      if (i % 24 === 0) return h.localDate.slice(5); // "MM-DD"
      return '';
    });

    this.instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'SoC %',
          data: batteryHours.map(h => h.socPercent),
          borderColor: c.accent,
          backgroundColor: c.accent + '18',
          borderWidth: 1.5,
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          pointHoverRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const i = items[0].dataIndex;
                const h = batteryHours[i];
                return `${h.localDate} ${h.hour}:00`;
              },
              label: (ctx) => `SoC: ${ctx.raw.toFixed(1)}%`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: "'JetBrains Mono', monospace", size: 9 }, maxRotation: 0 },
          },
          y: {
            min: 0, max: 100,
            grid: { color: c.border },
            ticks: {
              font: { family: "'JetBrains Mono', monospace", size: 10 },
              callback: (v) => v + '%',
            },
          },
        },
      },
    });
  },

  /**
   * Average hourly usage pattern bar chart.
   */
  renderHourlyPattern(canvasId, hourlyAvg) {
    this.destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    const c = this.getChartColors();

    const labels = Array.from({ length: 24 }, (_, i) => {
      if (i === 0) return '12am';
      if (i === 12) return '12pm';
      return i < 12 ? i + 'am' : (i - 12) + 'pm';
    });

    this.instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Avg kWh',
          data: hourlyAvg,
          backgroundColor: hourlyAvg.map((_, i) => {
            if (i >= 15 && i < 21) return c.peak + 'cc';
            if (i >= 11 && i < 14) return c.superoffpeak + 'cc';
            if (i < 6) return c.ev + 'cc';
            return c.offpeak + 'cc';
          }),
          borderRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.raw.toFixed(3)} kWh avg`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: "'JetBrains Mono', monospace", size: 10 } },
          },
          y: {
            grid: { color: c.border },
            ticks: {
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              callback: (v) => v.toFixed(1) + ' kWh',
            },
          },
        },
      },
    });
  },
};
