const Holidays = require('date-holidays');

const STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'];

/**
 * Get public holidays for an Australian state across a year range.
 * Uses the `date-holidays` library for accurate, maintained data.
 */
function getHolidays(state, startYear, endYear) {
  const hd = new Holidays('AU', state);
  const holidays = [];

  for (let year = startYear; year <= endYear; year++) {
    const yearHols = hd.getHolidays(year) || [];
    for (const h of yearHols) {
      // Only include public holidays (type 'public'), not observances
      if (h.type === 'public') {
        const d = new Date(h.date);
        const dateStr = [
          d.getFullYear(),
          String(d.getMonth() + 1).padStart(2, '0'),
          String(d.getDate()).padStart(2, '0'),
        ].join('-');
        holidays.push({ date: dateStr, name: h.name });
      }
    }
  }

  return holidays;
}

module.exports = { getHolidays, STATES };
