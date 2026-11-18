// SQL for the settings table. Values are bound as parameters, never concatenated.

export function createSettingsRepository(db) {
  const getOne = db.prepare('SELECT value FROM settings WHERE key = ?');
  // "Upsert": insert, or if the key already exists, update it.
  const setOne = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const removeOne = db.prepare('DELETE FROM settings WHERE key = ?');

  return {
    get: (key) => getOne.get(key)?.value ?? null,
    set: (key, value) => { setOne.run(key, value); },
    remove: (key) => { removeOne.run(key); },
  };
}
