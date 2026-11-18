// Time handling. An instant is stored once in UTC, together with the IANA time zone
// and the local calendar day ("YYYY-MM-DD") at that moment. Periods group by that
// stored day, so an 11:45 PM purchase belongs to the day it happened even when its
// UTC date is already the next one.

/**
 * Greeting based on the local hour. Pass a time zone to use THAT zone's hour
 * (the app passes your configured one); without it, the computer's own.
 */
export function getGreeting(date = new Date(), timeZone) {
  const hour = timeZone
    ? Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(date))
    : date.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Good evening';
  return 'Burning the midnight oil';
}

/** The computer's own time zone, e.g. "Asia/Calcutta". Never hardcoded. */
export function getSystemTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Check a time zone name. Returns the name to store, or null if invalid.
 * We accept real IANA names ("Asia/Kolkata", "UTC") but not raw offsets
 * ("+05:30"): offsets can't follow daylight saving rules.
 */
export function normalizeTimeZone(input) {
  if (typeof input !== 'string') return null;
  const zone = input.trim();
  if (!zone || /^[+-]?\d/.test(zone)) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }); // throws if unknown
  } catch {
    return null;
  }
  // Fix capitalisation. Prefer the exact spelling from the official list...
  const known = Intl.supportedValuesOf('timeZone').find((z) => z.toLowerCase() === zone.toLowerCase());
  if (known) return known;
  if (zone.toUpperCase() === 'UTC') return 'UTC';
  // ...otherwise (legacy aliases such as "Asia/Kolkata") capitalise each word.
  return zone.toLowerCase().replace(/(^|[/_-])([a-z])/g, (_, divider, letter) => divider + letter.toUpperCase());
}

export const isValidTimeZone = (input) => normalizeTimeZone(input) !== null;

/** The calendar day ("YYYY-MM-DD") that `date` falls on in `timeZone`. */
export function getLocalDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type).value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/**
 * Friendly display like "Thu 12 Nov, 11:45 pm" for a stored UTC instant.
 * The year is added only when it isn't the current one.
 */
export function formatLocalDateTime(isoUtc, timeZone, { now = new Date() } = {}) {
  const date = new Date(isoUtc);
  const options = {
    timeZone, weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  };
  const yearOf = (d) => new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(d);
  const showYear = yearOf(date) !== yearOf(now);
  const parts = new Intl.DateTimeFormat('en-GB', { ...options, ...(showYear && { year: 'numeric' }) })
    .formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? '';

  const day = `${pick('weekday')} ${pick('day')} ${pick('month')}${showYear ? ` ${pick('year')}` : ''}`;
  return `${day}, ${pick('hour')}:${pick('minute')} ${pick('dayPeriod').toLowerCase()}`;
}

// Calendar arithmetic on "YYYY-MM-DD" strings, done on UTC dates so daylight
// saving never shifts a day.

const parseDay = (day) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date));
};
const formatDay = (date) => date.toISOString().slice(0, 10);

/** addDays("2026-11-30", 1) -> "2026-12-01". Negative numbers go backwards. */
export function addDays(day, count) {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + count);
  return formatDay(date);
}

/** The first day of the week containing `day`. Weeks start on Monday unless told otherwise (0 = Sunday). */
export function startOfWeek(day, weekStartsOn = 1) {
  const daysSinceStart = (parseDay(day).getUTCDay() - weekStartsOn + 7) % 7;
  return addDays(day, -daysSinceStart);
}
export const endOfWeek = (day, weekStartsOn = 1) => addDays(startOfWeek(day, weekStartsOn), 6);

export const startOfMonth = (day) => `${day.slice(0, 7)}-01`;
export function endOfMonth(day) {
  const [year, month] = day.split('-').map(Number);
  return formatDay(new Date(Date.UTC(year, month, 0))); // "day 0" of next month = last day of this one
}

/** "Thu 12 Nov" for a local day (the year is added when it isn't `today`'s year). */
export function formatLocalDay(day, today) {
  const showYear = today !== undefined && day.slice(0, 4) !== today.slice(0, 4);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', ...(showYear && { year: 'numeric' }),
  }).formatToParts(parseDay(day));
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('weekday')} ${pick('day')} ${pick('month')}${showYear ? ` ${pick('year')}` : ''}`;
}

/** "Today", "Yesterday", or "Thu 12 Nov". */
export function describeLocalDate(day, today) {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return formatLocalDay(day, today);
}

/** "November" for a local day. */
export function monthName(day) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long' }).format(parseDay(day));
}

/** Just the clock part of a stored instant: "7:23 am". */
export function formatLocalTime(isoUtc, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(isoUtc));
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('hour')}:${pick('minute')} ${pick('dayPeriod').toLowerCase()}`;
}

// Helpers for reports

/** How many days from `from` to `to`, counting both ends: ("2026-11-09", "2026-11-15") -> 7. */
export function daysBetween(from, to) {
  return Math.round((parseDay(to) - parseDay(from)) / 86_400_000) + 1;
}

/** The first of the month, `count` months away: addMonths("2026-11-20", -1) -> "2026-10-01". */
export function addMonths(day, count) {
  const [year, month] = day.split('-').map(Number);
  return formatDay(new Date(Date.UTC(year, month - 1 + count, 1)));
}

/** Is this a real calendar day written as YYYY-MM-DD? ("2026-02-30" is not.) */
export function isValidDay(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = parseDay(text);
  return !Number.isNaN(date.getTime()) && formatDay(date) === text; // round-trip catches Feb 30
}

/** Understand "2026-11-09", "today" or "yesterday". Returns the day, or null if unclear. */
export function parseLocalDate(text, today) {
  const word = String(text ?? '').trim().toLowerCase();
  if (word === 'today') return today;
  if (word === 'yesterday') return addDays(today, -1);
  return isValidDay(word) ? word : null;
}

/**
 * "Mon 9 – Sun 15 Nov 2026" for a range of days. The year appears once at the
 * end when both ends share it, or on both ends when they don't.
 */
export function describeRange(from, to) {
  const part = (day) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    }).formatToParts(parseDay(day));
    const pick = (type) => parts.find((p) => p.type === type).value;
    return { weekday: pick('weekday'), day: pick('day'), month: pick('month'), year: pick('year') };
  };
  const a = part(from);
  const b = part(to);
  if (from === to) return `${a.weekday} ${a.day} ${a.month} ${a.year}`;
  if (a.year !== b.year) return `${a.weekday} ${a.day} ${a.month} ${a.year} – ${b.weekday} ${b.day} ${b.month} ${b.year}`;
  if (a.month !== b.month) return `${a.weekday} ${a.day} ${a.month} – ${b.weekday} ${b.day} ${b.month} ${b.year}`;
  return `${a.weekday} ${a.day} – ${b.weekday} ${b.day} ${b.month} ${b.year}`;
}

/** "Mon 9": just weekday and day number, for chart labels. */
export function formatDayShort(day) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric' }).formatToParts(parseDay(day));
  return `${parts.find((p) => p.type === 'weekday').value} ${parts.find((p) => p.type === 'day').value}`;
}

/** "2–8 Nov" or "30 Nov–6 Dec": a compact label for a stretch of days. */
export function formatDaySpan(from, to) {
  const part = (day) => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).formatToParts(parseDay(day));
    return { day: parts.find((p) => p.type === 'day').value, month: parts.find((p) => p.type === 'month').value };
  };
  const a = part(from);
  const b = part(to);
  if (from === to) return `${a.day} ${a.month}`;
  return a.month === b.month ? `${a.day}–${b.day} ${a.month}` : `${a.day} ${a.month}–${b.day} ${b.month}`;
}

/** The Monday-to-Sunday week containing `day`, `back` weeks ago: { from, to }. */
export function weekRange(day, back = 0) {
  const from = addDays(startOfWeek(day), -7 * back);
  return { from, to: addDays(from, 6) };
}

/** The calendar month containing `day`, `back` months ago: { from, to }. */
export function monthRange(day, back = 0) {
  const from = addMonths(day, -back);
  return { from, to: endOfMonth(from) };
}
