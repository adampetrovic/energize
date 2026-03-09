/**
 * API client for Energize backend.
 */
const API = {
  async fetchHourlyEnergy(startDate, endDate) {
    const res = await fetch(`/api/energy/hourly?start=${startDate}&end=${endDate}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Failed to fetch energy data');
    }
    return res.json();
  },

  async fetchHolidays(state, startYear, endYear) {
    const res = await fetch(`/api/holidays?state=${state}&startYear=${startYear}&endYear=${endYear}`);
    if (!res.ok) throw new Error('Failed to fetch holidays');
    return res.json();
  },

  async healthCheck() {
    const res = await fetch('/api/health');
    return res.json();
  },
};
