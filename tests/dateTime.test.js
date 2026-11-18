import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getGreeting } from '../src/utils/dateTime.js';

// new Date(year, monthIndex, day, hour) builds a date in the LOCAL timezone,
// which is exactly what getGreeting reads, so these tests pass in any timezone.
const atHour = (hour) => new Date(2026, 0, 15, hour, 30);

describe('getGreeting', () => {
  it('greets by time of day, including the boundaries', () => {
    assert.equal(getGreeting(atHour(5)), 'Good morning');
    assert.equal(getGreeting(atHour(11)), 'Good morning');
    assert.equal(getGreeting(atHour(12)), 'Good afternoon');
    assert.equal(getGreeting(atHour(16)), 'Good afternoon');
    assert.equal(getGreeting(atHour(17)), 'Good evening');
    assert.equal(getGreeting(atHour(21)), 'Good evening');
    assert.equal(getGreeting(atHour(22)), 'Burning the midnight oil');
    assert.equal(getGreeting(atHour(2)), 'Burning the midnight oil');
  });
});

import { formatLocalDateTime, getLocalDate, getSystemTimeZone, isValidTimeZone, normalizeTimeZone } from '../src/utils/dateTime.js';

describe('getLocalDate: which calendar day was it for you?', () => {
  it('11:45 PM in Los Angeles is already "tomorrow" in UTC but stays on the local day', () => {
    const instant = new Date('2026-11-13T07:45:00Z'); // 11:45 PM on 12 Nov in Los Angeles
    assert.equal(getLocalDate(instant, 'America/Los_Angeles'), '2026-11-12');
    assert.equal(getLocalDate(instant, 'UTC'), '2026-11-13');
  });
  it('moves forward for zones ahead of UTC (Kolkata is UTC+5:30)', () => {
    assert.equal(getLocalDate(new Date('2026-11-12T18:29:00Z'), 'Asia/Kolkata'), '2026-11-12');
    assert.equal(getLocalDate(new Date('2026-11-12T18:30:00Z'), 'Asia/Kolkata'), '2026-11-13');
  });
  it('handles month boundaries, including leap day', () => {
    assert.equal(getLocalDate(new Date('2026-03-01T04:59:00Z'), 'America/New_York'), '2026-02-28'); // 2026 is not a leap year
    assert.equal(getLocalDate(new Date('2028-02-29T12:00:00Z'), 'UTC'), '2028-02-29');
    assert.equal(getLocalDate(new Date('2028-03-01T04:59:00Z'), 'America/New_York'), '2028-02-29');
  });
  it('handles year boundaries', () => {
    assert.equal(getLocalDate(new Date('2027-01-01T04:30:00Z'), 'America/New_York'), '2026-12-31');
    assert.equal(getLocalDate(new Date('2026-12-31T20:00:00Z'), 'Asia/Tokyo'), '2027-01-01');
  });
  it('gives the right local day on both sides of a daylight-saving change', () => {
    // US clocks jump forward on 8 March 2026 (01:59 EST -> 03:00 EDT)
    assert.equal(getLocalDate(new Date('2026-03-08T06:59:00Z'), 'America/New_York'), '2026-03-08');
    assert.equal(getLocalDate(new Date('2026-03-08T07:00:00Z'), 'America/New_York'), '2026-03-08');
    // and fall back on 1 November 2026: 1:30 AM happens TWICE, an hour apart
    const first = new Date('2026-11-01T05:30:00Z'); // 1:30 AM EDT
    const second = new Date('2026-11-01T06:30:00Z'); // 1:30 AM EST
    assert.equal(getLocalDate(first, 'America/New_York'), '2026-11-01');
    assert.equal(getLocalDate(second, 'America/New_York'), '2026-11-01');
    assert.equal(formatLocalDateTime(first.toISOString(), 'America/New_York'), formatLocalDateTime(second.toISOString(), 'America/New_York'));
    assert.notEqual(first.toISOString(), second.toISOString()); // UTC keeps them apart
  });
});

describe('time zone names', () => {
  it('detects the computer time zone as a valid name', () => {
    assert.ok(isValidTimeZone(getSystemTimeZone()));
  });
  it('accepts real zones and fixes their capitalisation', () => {
    assert.equal(normalizeTimeZone('asia/kolkata'), 'Asia/Kolkata');
    assert.equal(normalizeTimeZone('America/Los_Angeles'), 'America/Los_Angeles');
    assert.equal(normalizeTimeZone('utc'), 'UTC');
  });
  it('rejects nonsense, blanks and raw offsets', () => {
    for (const bad of ['Mars/Base', '', '   ', '+05:30', '5', null, undefined, 42]) {
      assert.equal(normalizeTimeZone(bad), null, `${JSON.stringify(bad)} should be rejected`);
    }
  });
});

describe('formatLocalDateTime', () => {
  const now = new Date('2026-11-12T18:15:00Z');
  it('shows the stored instant in the zone it was saved in', () => {
    assert.equal(formatLocalDateTime('2026-11-12T18:15:00Z', 'Asia/Kolkata', { now }), 'Thu 12 Nov, 11:45 pm');
    assert.equal(formatLocalDateTime('2026-11-12T18:15:00Z', 'UTC', { now }), 'Thu 12 Nov, 6:15 pm');
  });
  it('adds the year only when it is not the current year', () => {
    assert.equal(formatLocalDateTime('2025-01-03T09:05:00Z', 'UTC', { now }), 'Fri 3 Jan 2025, 9:05 am');
  });
});

import { addDays, describeLocalDate, endOfMonth, endOfWeek, formatLocalDay, formatLocalTime, monthName, startOfMonth, startOfWeek } from '../src/utils/dateTime.js';

describe('calendar arithmetic', () => {
  it('addDays crosses month, year, leap-day and daylight-saving boundaries', () => {
    assert.equal(addDays('2026-11-30', 1), '2026-12-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2027-01-01', -1), '2026-12-31');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29'); // leap year
    assert.equal(addDays('2026-02-28', 1), '2026-03-01'); // not a leap year
    assert.equal(addDays('2026-03-08', 1), '2026-03-09'); // US clocks jump this night; calendar days don't care
    assert.equal(addDays('2026-11-01', 1), '2026-11-02');
    assert.equal(addDays('2026-11-12', 0), '2026-11-12');
    assert.equal(addDays('2026-01-01', -365), '2025-01-01');
  });
  it('weeks run Monday to Sunday', () => {
    assert.deepEqual([startOfWeek('2026-11-09'), endOfWeek('2026-11-09')], ['2026-11-09', '2026-11-15']); // a Monday
    assert.deepEqual([startOfWeek('2026-11-12'), endOfWeek('2026-11-12')], ['2026-11-09', '2026-11-15']); // a Thursday
    assert.deepEqual([startOfWeek('2026-11-15'), endOfWeek('2026-11-15')], ['2026-11-09', '2026-11-15']); // a Sunday belongs to the week BEFORE it
    assert.equal(startOfWeek('2026-11-16'), '2026-11-16'); // the next Monday starts a new week
  });
  it('weeks can span months and years', () => {
    assert.deepEqual([startOfWeek('2026-12-30'), endOfWeek('2026-12-30')], ['2026-12-28', '2027-01-03']);
    assert.deepEqual([startOfWeek('2027-03-02'), endOfWeek('2027-03-02')], ['2027-03-01', '2027-03-07']);
  });
  it('can start the week on Sunday if asked', () => {
    assert.equal(startOfWeek('2026-11-12', 0), '2026-11-08');
    assert.equal(endOfWeek('2026-11-12', 0), '2026-11-14');
  });
  it('knows where months start and end, including February in leap years', () => {
    assert.deepEqual([startOfMonth('2026-11-12'), endOfMonth('2026-11-12')], ['2026-11-01', '2026-11-30']);
    assert.equal(endOfMonth('2026-12-05'), '2026-12-31');
    assert.equal(endOfMonth('2026-02-01'), '2026-02-28');
    assert.equal(endOfMonth('2028-02-10'), '2028-02-29');
    assert.equal(endOfMonth('2100-02-10'), '2100-02-28'); // 2100 is NOT a leap year
    assert.equal(endOfMonth('2000-02-10'), '2000-02-29'); // 2000 is
  });
});

describe('describing days and times', () => {
  it('says Today, Yesterday, or the date', () => {
    const today = '2026-11-13';
    assert.equal(describeLocalDate('2026-11-13', today), 'Today');
    assert.equal(describeLocalDate('2026-11-12', today), 'Yesterday');
    assert.equal(describeLocalDate('2026-11-09', today), 'Mon 9 Nov');
    assert.equal(describeLocalDate('2025-12-25', today), 'Thu 25 Dec 2025');
  });
  it('knows "yesterday" across a month boundary', () => {
    assert.equal(describeLocalDate('2026-10-31', '2026-11-01'), 'Yesterday');
  });
  it('formats days, month names and clock times', () => {
    assert.equal(formatLocalDay('2026-11-12'), 'Thu 12 Nov');
    assert.equal(monthName('2026-11-13'), 'November');
    assert.equal(formatLocalTime('2026-11-12T18:15:00Z', 'Asia/Kolkata'), '11:45 pm');
    assert.equal(formatLocalTime('2026-11-12T00:05:00Z', 'UTC'), '12:05 am');
    assert.equal(formatLocalTime('2026-11-12T12:00:00Z', 'UTC'), '12:00 pm');
  });
  it('greets by the hour in the zone you choose, not the computer\'s', () => {
    const instant = new Date('2026-11-12T18:15:00Z'); // 11:45 pm in Kolkata, 10:15 am in Los Angeles
    assert.equal(getGreeting(instant, 'Asia/Kolkata'), 'Burning the midnight oil');
    assert.equal(getGreeting(instant, 'America/Los_Angeles'), 'Good morning');
    assert.equal(getGreeting(new Date('2026-11-12T00:30:00Z'), 'UTC'), 'Burning the midnight oil'); // 00:30 must not break (h23)
  });
});

import { daysBetween, addMonths, isValidDay, parseLocalDate, describeRange, formatDayShort, formatDaySpan, weekRange, monthRange } from '../src/utils/dateTime.js';

describe('report date helpers', () => {
  it('daysBetween counts both ends', () => {
    assert.equal(daysBetween('2026-11-09', '2026-11-15'), 7);
    assert.equal(daysBetween('2026-11-12', '2026-11-12'), 1);
    assert.equal(daysBetween('2026-02-01', '2026-03-01'), 29);
    assert.equal(daysBetween('2028-02-01', '2028-03-01'), 30); // leap year
    assert.equal(daysBetween('2026-12-30', '2027-01-02'), 4);
    assert.equal(daysBetween('2026-03-07', '2026-03-09'), 3); // across a US daylight-saving change
  });
  it('addMonths lands on the first of the month, crossing years either way', () => {
    assert.equal(addMonths('2026-11-20', 0), '2026-11-01');
    assert.equal(addMonths('2026-11-20', -1), '2026-10-01');
    assert.equal(addMonths('2026-01-31', -1), '2025-12-01');
    assert.equal(addMonths('2026-12-31', 1), '2027-01-01');
    assert.equal(addMonths('2026-03-31', -1), '2026-02-01'); // no "Feb 31" trouble
    assert.equal(addMonths('2026-11-20', -23), '2024-12-01');
  });
  it('isValidDay accepts real dates and rejects the rest', () => {
    for (const good of ['2026-11-12', '2028-02-29', '2026-12-31']) assert.equal(isValidDay(good), true, good);
    for (const bad of ['2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-11-31', '26-11-12', '2026-1-2', '', 'abc', null, undefined, 20261112]) {
      assert.equal(isValidDay(bad), false, String(bad));
    }
  });
  it('parseLocalDate understands dates, "today" and "yesterday" in any capitals', () => {
    assert.equal(parseLocalDate('2026-11-09', '2026-11-12'), '2026-11-09');
    assert.equal(parseLocalDate(' Today ', '2026-11-12'), '2026-11-12');
    assert.equal(parseLocalDate('YESTERDAY', '2026-11-12'), '2026-11-11');
    assert.equal(parseLocalDate('yesterday', '2026-11-01'), '2026-10-31');
    assert.equal(parseLocalDate('tomorrow', '2026-11-12'), null);
    assert.equal(parseLocalDate('2026-02-30', '2026-11-12'), null);
  });
  it('describeRange writes the year once when it can', () => {
    assert.equal(describeRange('2026-11-09', '2026-11-15'), 'Mon 9 – Sun 15 Nov 2026');
    assert.equal(describeRange('2026-10-26', '2026-11-01'), 'Mon 26 Oct – Sun 1 Nov 2026');
    assert.equal(describeRange('2026-12-28', '2027-01-03'), 'Mon 28 Dec 2026 – Sun 3 Jan 2027');
    assert.equal(describeRange('2026-11-12', '2026-11-12'), 'Thu 12 Nov 2026');
  });
  it('makes short labels for charts', () => {
    assert.equal(formatDayShort('2026-11-09'), 'Mon 9');
    assert.equal(formatDaySpan('2026-11-02', '2026-11-08'), '2–8 Nov');
    assert.equal(formatDaySpan('2026-11-30', '2026-12-06'), '30 Nov–6 Dec');
    assert.equal(formatDaySpan('2026-11-01', '2026-11-01'), '1 Nov');
  });
  it('weekRange and monthRange step backwards', () => {
    assert.deepEqual(weekRange('2026-11-12'), { from: '2026-11-09', to: '2026-11-15' });
    assert.deepEqual(weekRange('2026-11-12', 1), { from: '2026-11-02', to: '2026-11-08' });
    assert.deepEqual(weekRange('2027-01-05', 2), { from: '2026-12-21', to: '2026-12-27' });
    assert.deepEqual(monthRange('2026-11-12'), { from: '2026-11-01', to: '2026-11-30' });
    assert.deepEqual(monthRange('2026-03-31', 1), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(monthRange('2028-03-15', 1), { from: '2028-02-01', to: '2028-02-29' });
    assert.deepEqual(monthRange('2027-01-05', 1), { from: '2026-12-01', to: '2026-12-31' });
  });
});
