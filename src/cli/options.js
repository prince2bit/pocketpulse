// Flags every command accepts. Each command's parser includes them, so
// `add chips 20 --theme ocean` doesn't treat "ocean" as part of the expense.
export const GLOBAL_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  'no-color': { type: 'boolean' },
  theme: { type: 'string' },
};
