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

  async importEmePlan(planId, postcode) {
    const res = await fetch(`/api/eme/plan?planId=${encodeURIComponent(planId)}&postcode=${encodeURIComponent(postcode)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Failed to import plan');
    }
    return res.json();
  },

  async listPlans() {
    const res = await fetch('/api/plans');
    return (await res.json()).plans || [];
  },

  async savePlan(slug, name, planData, source, emePlanId, emePostcode) {
    const res = await fetch(`/api/plans/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, planData, source, emePlanId, emePostcode }),
    });
    return res.json();
  },

  async loadPlan(slug) {
    const res = await fetch(`/api/plans/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    return res.json();
  },

  async deletePlan(slug) {
    await fetch(`/api/plans/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  },
};
