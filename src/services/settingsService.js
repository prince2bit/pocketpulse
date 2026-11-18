// Preference rules. Setters validate first and return { ok, value } or { ok, error }.

import { DEFAULT_CURRENCY } from '../config/defaults.js';
import { THEMES, resolveThemeName } from '../ui/theme.js';
import { getSystemTimeZone, normalizeTimeZone } from '../utils/dateTime.js';
import { normalizeCurrency, supportedCurrencyCodes } from '../utils/money.js';

export function createSettingsService(repo, { systemTimeZone = getSystemTimeZone } = {}) {
  return {
    getDefaultCurrency() {
      return normalizeCurrency(repo.get('default_currency') ?? '') ?? DEFAULT_CURRENCY;
    },
    setDefaultCurrency(input) {
      const code = normalizeCurrency(input);
      if (!code) {
        return { ok: false, error: `"${String(input).trim()}" isn't a supported currency. Choose one of: ${supportedCurrencyCodes().join(', ')}.` };
      }
      repo.set('default_currency', code);
      return { ok: true, value: code };
    },

    // The time zone override, if the person set one. null means "use the computer's".
    getTimeZoneOverride: () => repo.get('time_zone'),
    getTimeZone() {
      const saved = repo.get('time_zone');
      return saved && normalizeTimeZone(saved) ? saved : systemTimeZone();
    },
    setTimeZone(input) {
      const zone = normalizeTimeZone(input);
      if (!zone) {
        return { ok: false, error: `"${String(input).trim()}" isn't a time zone I know. Use a name like Asia/Kolkata or Europe/London.` };
      }
      repo.set('time_zone', zone);
      return { ok: true, value: zone };
    },
    clearTimeZone() { repo.remove('time_zone'); },

    // Has the person been through the first-run welcome (choosing a currency)?
    isSetupDone: () => repo.get('setup_done') === '1',
    markSetupDone() { repo.set('setup_done', '1'); },

    getTheme: () => resolveThemeName(repo.get('theme') ?? ''),
    setTheme(input) {
      const name = resolveThemeName(input);
      if (!name) return { ok: false, error: `"${String(input).trim()}" isn't a theme. Choose one of: ${Object.keys(THEMES).join(', ')}.` };
      repo.set('theme', name);
      return { ok: true, value: name };
    },
  };
}
