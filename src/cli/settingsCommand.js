// `pocketpulse settings`: view and change preferences.
//
//   pocketpulse settings                    show everything
//   pocketpulse settings currency [USD]     default currency (menu if no code given)
//   pocketpulse settings timezone [ZONE]    override the computer's time zone ("reset" undoes it)
//   pocketpulse settings theme [ocean]      colour theme, remembered between runs

import { THEMES } from '../ui/theme.js';
import { SUPPORTED_CURRENCIES } from '../utils/money.js';

export async function runSettings(args, ctx) {
  const { theme, write, error } = ctx;
  const [topic, ...valueWords] = args.filter((arg) => !arg.startsWith('-'));
  const value = valueWords.join(' ');
  const app = await ctx.getApp();
  const fail = (message) => { error(`${theme.danger(theme.symbols.cross)} ${message}`); return 2; };

  if (!topic) return showSettings(app, ctx);

  // Shared by all three settings: apply a validated change and report it.
  const finish = (result, label, extra = '') => {
    if (!result.ok) return fail(result.error);
    write(`${theme.primary(theme.symbols.tick)} ${label} set to ${theme.bold(result.value)}.${extra}`);
    return 0;
  };

  switch (topic.toLowerCase()) {
    case 'currency': {
      let code = value;
      if (!code) {
        if (!ctx.interactive) return fail(`Say which one, e.g. "pocketpulse settings currency USD". Options: ${SUPPORTED_CURRENCIES.map((c) => c.code).join(', ')}.`);
        const picked = await ctx.getPrompts().select('Choose your default currency:', SUPPORTED_CURRENCIES.map((c) => ({ ...c, label: `${c.code}  ${c.name}` })));
        if (!picked) { write(theme.muted('Cancelled.')); return 0; }
        code = picked.code;
      }
      return finish(app.settings.setDefaultCurrency(code), 'Default currency', theme.muted(' Past expenses keep the currency they were saved with.'));
    }

    case 'timezone': {
      if (!value) return fail('Say which one, e.g. "pocketpulse settings timezone Asia/Kolkata", or "reset" to use your computer\'s.');
      if (value.toLowerCase() === 'reset') {
        app.settings.clearTimeZone();
        write(`${theme.primary(theme.symbols.tick)} Time zone is back to your computer's: ${theme.bold(app.settings.getTimeZone())}.`);
        return 0;
      }
      return finish(app.settings.setTimeZone(value), 'Time zone', theme.muted(' Past expenses keep the time zone they were saved in.'));
    }

    case 'theme': {
      let name = value;
      if (!name) {
        if (!ctx.interactive) return fail(`Say which one, e.g. "pocketpulse settings theme ocean". Options: ${Object.keys(THEMES).join(', ')}.`);
        const picked = await ctx.getPrompts().select('Choose a theme:', Object.entries(THEMES).map(([key, def]) => ({ key, label: `${key.padEnd(8)}${def.description}` })));
        if (!picked) { write(theme.muted('Cancelled.')); return 0; }
        name = picked.key;
      }
      return finish(app.settings.setTheme(name), 'Theme', theme.muted(' You will see it on your next command.'));
    }

    default:
      return fail(`I don't have a setting called "${topic}". Try: currency, timezone or theme.`);
  }
}

function showSettings(app, { theme, write }) {
  const currency = app.settings.getDefaultCurrency();
  const name = SUPPORTED_CURRENCIES.find((c) => c.code === currency)?.name;
  const override = app.settings.getTimeZoneOverride();
  const label = (text) => theme.muted(text.padEnd(11));

  write('');
  write(theme.bold(theme.secondary('SETTINGS')));
  write(`  ${label('Currency')}${theme.bold(currency)}  ${theme.muted(name)}`);
  write(`  ${label('Time zone')}${theme.bold(app.settings.getTimeZone())}  ${theme.muted(override ? '(your override)' : "(your computer's)")}`);
  write(`  ${label('Theme')}${theme.bold(theme.name)}`);
  write('');
  write(theme.muted('Change one with: pocketpulse settings currency | timezone | theme'));
  return 0;
}
