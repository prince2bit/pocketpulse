// Turns saved expenses into dashboard and report numbers.
//
// Two rules apply throughout:
// - Periods are local calendar days (the local_date stored with each expense),
//   so a purchase at 11:45 PM counts for the day it happened.
// - Currencies are never mixed. Totals come back one entry per currency, and
//   anything that needs a single currency uses a "primary" one.

import {
  addDays, addMonths, daysBetween, endOfMonth, endOfWeek, getLocalDate, startOfMonth, startOfWeek,
} from '../utils/dateTime.js';

const RECENT_COUNT = 5;
const TODAY_LIST_LIMIT = 50;

export function createAnalyticsService({ expenses, settings, clock = () => new Date() }) {
  const today = () => getLocalDate(clock(), settings.getTimeZone());

  /** Totals per currency and the number of expenses, for a range of local days. */
  const period = (from, to) => ({
    from,
    to,
    totals: expenses.totalsByCurrency(from, to),
    count: expenses.countBetween(from, to),
  });

  /**
   * Which currency should single-currency parts of the screen use?
   * Your default if you've spent in it, otherwise whichever you used most.
   */
  function pickPrimaryCurrency(periods, requested) {
    const active = new Map(); // currency -> number of expenses across the periods
    for (const { totals } of periods) {
      for (const { currency, count } of totals) active.set(currency, (active.get(currency) ?? 0) + count);
    }
    const preferred = requested ?? settings.getDefaultCurrency();
    if (active.has(preferred) || requested) return { primary: preferred, others: [...active.keys()].filter((c) => c !== preferred) };
    const mostUsed = [...active.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? preferred;
    return { primary: mostUsed, others: [...active.keys()].filter((c) => c !== mostUsed) };
  }

  /** Category breakdown for one currency, with each category's share of the total. */
  function breakdown(from, to, currency) {
    const rows = expenses.totalsByCategory(from, to, currency);
    const grand = rows.reduce((sum, row) => sum + row.totalMinor, 0);
    return rows.map((row) => ({ ...row, share: grand === 0 ? 0 : row.totalMinor / grand }));
  }

  return {
    today,

    /** Everything the main dashboard shows. `currency` forces the primary currency. */
    dashboard({ currency } = {}) {
      const day = today();
      const weekFrom = startOfWeek(day);
      const weekTo = endOfWeek(day);
      const monthFrom = startOfMonth(day);
      const monthTo = endOfMonth(day);

      const periods = { today: period(day, day), week: period(weekFrom, weekTo), month: period(monthFrom, monthTo) };
      const { primary, others } = pickPrimaryCurrency(Object.values(periods), currency);

      // The last seven days, oldest first, for the sparkline. Days with no spending are 0.
      const dailyMap = expenses.dailyTotals(addDays(day, -6), day, primary);
      const last7 = Array.from({ length: 7 }, (_, index) => {
        const date = addDays(day, index - 6);
        return { date, totalMinor: dailyMap.get(date) ?? 0 };
      });

      return {
        hasExpenses: expenses.count() > 0,
        today: day,
        periods,
        primaryCurrency: primary,
        otherCurrencies: others,
        breakdown: breakdown(monthFrom, monthTo, primary),
        largest: expenses.largest(monthFrom, monthTo, primary),
        mostUsedCategory: expenses.mostUsedCategory(monthFrom, monthTo),
        last7,
        recent: expenses.listRecent(RECENT_COUNT),
      };
    },

    /**
     * A full report for any range of days. This is what week, month and
     * range analytics are built from.
     *
     * @param {object} options
     * @param {string} options.from first local day, "YYYY-MM-DD"
     * @param {string} options.to last local day (inclusive)
     * @param {'week'|'month'|'range'} [options.kind] decides what the "previous period" means
     * @param {string} [options.currency] force the currency for charts and breakdowns
     * @param {number|null} [options.categoryId] look at one category only
     */
    report({ from, to, kind = 'range', currency, categoryId = null }) {
      const day = today();
      const length = daysBetween(from, to);
      const started = day >= from;
      const inProgress = started && day < to; // today is inside the period, which isn't over yet
      const elapsed = !started ? 0 : Math.min(length, daysBetween(from, day));

      // The period just before this one.
      let previousFrom;
      let previousTo;
      if (kind === 'week') {
        previousFrom = addDays(from, -7);
        previousTo = addDays(from, -1);
      } else if (kind === 'month') {
        previousFrom = startOfMonth(addMonths(from, -1));
        previousTo = endOfMonth(previousFrom);
      } else {
        previousFrom = addDays(from, -length);
        previousTo = addDays(from, -1);
      }
      // Compare like with like. Day 3 of this week is compared with the first 3
      // days of last week, not with all of it (which would always look like a drop).
      const previousLength = daysBetween(previousFrom, previousTo);
      const comparedTo = inProgress ? addDays(previousFrom, Math.min(elapsed, previousLength) - 1) : previousTo;

      const totals = expenses.totalsByCurrency(from, to, categoryId);
      const previousTotals = started ? expenses.totalsByCurrency(previousFrom, comparedTo, categoryId) : [];
      const { primary, others } = pickPrimaryCurrency([{ totals }, { totals: previousTotals }], currency);

      // One entry per day, quiet days included as 0, for the primary currency.
      const dailyMap = expenses.dailyTotals(from, to, primary, categoryId);
      const daily = Array.from({ length }, (_, index) => {
        const date = addDays(from, index);
        return { date, totalMinor: dailyMap.get(date) ?? 0 };
      });
      const busiest = daily.reduce((best, d) => (d.totalMinor > (best?.totalMinor ?? 0) ? d : best), null);

      // Per currency: the total, the average per day so far, and the change versus before.
      const currencies = [...new Set([...totals.map((t) => t.currency), ...previousTotals.map((t) => t.currency)])];
      const find = (list, code) => list.find((t) => t.currency === code);
      const summary = currencies.map((code) => {
        const current = find(totals, code)?.totalMinor ?? 0;
        const before = find(previousTotals, code)?.totalMinor ?? 0;
        return {
          currency: code,
          totalMinor: current,
          count: find(totals, code)?.count ?? 0,
          averageMinor: elapsed === 0 ? 0 : Math.round(current / elapsed),
          previousMinor: before,
          changeMinor: current - before,
          changeFraction: before === 0 ? null : (current - before) / before, // null = nothing to compare with
        };
      }).sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency));

      // Bars: one per day for short ranges, one per week for longer ones.
      const unit = kind === 'week' || (kind === 'range' && length <= 14) ? 'day' : 'week';
      const buckets = [];
      if (unit === 'day') {
        for (const d of daily) buckets.push({ from: d.date, to: d.date, totalMinor: d.totalMinor });
      } else {
        for (let weekStart = startOfWeek(from); weekStart <= to; weekStart = addDays(weekStart, 7)) {
          const bucketFrom = weekStart < from ? from : weekStart;
          const bucketEnd = addDays(weekStart, 6);
          const bucketTo = bucketEnd > to ? to : bucketEnd;
          const total = daily.filter((d) => d.date >= bucketFrom && d.date <= bucketTo).reduce((sum, d) => sum + d.totalMinor, 0);
          buckets.push({ from: bucketFrom, to: bucketTo, totalMinor: total });
        }
      }

      return {
        from,
        to,
        kind,
        today: day,
        days: length,
        elapsedDays: elapsed,
        inProgress,
        notStarted: !started,
        count: expenses.countBetween(from, to, categoryId),
        summary,
        primaryCurrency: primary,
        otherCurrencies: others,
        comparison: { previousFrom, previousTo, comparedTo, partial: inProgress, available: started },
        daily,
        busiestDay: busiest,
        buckets,
        bucketUnit: unit,
        breakdown: categoryId === null ? breakdown(from, to, primary) : [],
        largest: expenses.largest(from, to, primary, categoryId),
        categoryId,
      };
    },

    /**
     * Spending over time: one entry per week or month, oldest first, ending
     * with the current (unfinished) one.
     */
    trend({ unit = 'week', count = 8, currency, categoryId = null }) {
      const day = today();
      const periods = Array.from({ length: count }, (_, index) => {
        const back = count - 1 - index;
        const from = unit === 'week' ? addDays(startOfWeek(day), -7 * back) : startOfMonth(addMonths(day, -back));
        const to = unit === 'week' ? addDays(from, 6) : endOfMonth(from);
        const totals = expenses.totalsByCurrency(from, to, categoryId);
        return { from, to, totals, count: totals.reduce((sum, t) => sum + t.count, 0), inProgress: day >= from && day <= to };
      });
      const { primary, others } = pickPrimaryCurrency(periods, currency);
      return {
        unit,
        today: day,
        primaryCurrency: primary,
        otherCurrencies: others,
        periods: periods.map((p) => ({ ...p, primaryMinor: p.totals.find((t) => t.currency === primary)?.totalMinor ?? 0 })),
        categoryId,
      };
    },

    /** The "Today" screen: everything spent today. */
    todayView({ currency } = {}) {
      const day = today();
      const now = period(day, day);
      const { primary, others } = pickPrimaryCurrency([now], currency);
      return {
        today: day,
        period: now,
        primaryCurrency: primary,
        otherCurrencies: others,
        breakdown: breakdown(day, day, primary),
        expenses: expenses.listBetween(day, day, TODAY_LIST_LIMIT),
      };
    },
  };
}
