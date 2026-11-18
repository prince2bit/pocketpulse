// The database lives in the OS per-user data folder, outside the repository.

import os from 'node:os';
import path from 'node:path';

export function getDataDir({ env = process.env, platform = process.platform, homedir = os.homedir() } = {}) {
  // Handy for experiments and tests: POCKETPULSE_HOME=/some/folder
  if (env.POCKETPULSE_HOME) return path.resolve(env.POCKETPULSE_HOME);

  if (platform === 'win32') {
    return path.join(env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), 'PocketPulse');
  }
  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', 'PocketPulse');
  }
  return path.join(env.XDG_DATA_HOME || path.join(homedir, '.local', 'share'), 'pocketpulse');
}

export const getDatabasePath = (options) => path.join(getDataDir(options), 'pocketpulse.db');
