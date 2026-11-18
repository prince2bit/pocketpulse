import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';

describe('settings', () => {
  it('defaults: INR, the computer\'s time zone, no saved theme', async () => {
    const { app } = await makeApp({ zone: 'Asia/Calcutta' });
    assert.equal(app.settings.getDefaultCurrency(), 'INR');
    assert.equal(app.settings.getTimeZone(), 'Asia/Calcutta');
    assert.equal(app.settings.getTimeZoneOverride(), null);
    assert.equal(app.settings.getTheme(), null);
  });
  it('saves a valid currency (any capitalisation) and refuses an unknown one', async () => {
    const { app } = await makeApp();
    assert.deepEqual(app.settings.setDefaultCurrency('eur'), { ok: true, value: 'EUR' });
    assert.equal(app.settings.getDefaultCurrency(), 'EUR');
    const bad = app.settings.setDefaultCurrency('bitcoin');
    assert.equal(bad.ok, false);
    assert.match(bad.error, /INR, USD/);
    assert.equal(app.settings.getDefaultCurrency(), 'EUR'); // unchanged by the failed attempt
  });
  it('lets a time zone override beat the computer\'s, and can be reset', async () => {
    const { app } = await makeApp({ zone: 'UTC' });
    assert.deepEqual(app.settings.setTimeZone('asia/kolkata'), { ok: true, value: 'Asia/Kolkata' });
    assert.equal(app.settings.getTimeZone(), 'Asia/Kolkata');
    app.settings.clearTimeZone();
    assert.equal(app.settings.getTimeZone(), 'UTC');
  });
  it('refuses invalid time zones', async () => {
    const { app } = await makeApp();
    assert.equal(app.settings.setTimeZone('Mars/Base').ok, false);
    assert.equal(app.settings.setTimeZone('+05:30').ok, false);
    assert.equal(app.settings.getTimeZoneOverride(), null);
  });
  it('falls back to the computer\'s zone if a saved override is somehow garbage', async () => {
    const { app } = await makeApp({ zone: 'Europe/London' });
    app.db.prepare("INSERT INTO settings (key, value) VALUES ('time_zone', 'Nowhere/Land')").run();
    assert.equal(app.settings.getTimeZone(), 'Europe/London');
  });
  it('saves a theme and refuses an unknown one', async () => {
    const { app } = await makeApp();
    assert.deepEqual(app.settings.setTheme('Ocean'), { ok: true, value: 'ocean' });
    assert.equal(app.settings.getTheme(), 'ocean');
    assert.equal(app.settings.setTheme('neon-disco').ok, false);
    assert.equal(app.settings.getTheme(), 'ocean');
  });
});
