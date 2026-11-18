// All SQL about categories and their keyword rules.

function toCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    isDefault: row.is_default === 1,
    isFallback: row.is_fallback === 1,
    expenseCount: row.expense_count ?? 0,
    ruleCount: row.rule_count ?? 0,
  };
}

function toRule(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    keyword: row.keyword,
    keywordNorm: row.keyword_norm,
    source: row.source,
  };
}

export function createCategoryRepository(db) {
  // The two sub-selects count expenses and rules per category in one query.
  const withCounts = `
    SELECT c.*,
      (SELECT count(*) FROM expenses e WHERE e.category_id = c.id) AS expense_count,
      (SELECT count(*) FROM category_rules r WHERE r.category_id = c.id) AS rule_count
    FROM categories c`;

  const listAll = db.prepare(`${withCounts} ORDER BY c.is_fallback, c.id`); // "Other" always last
  const findOne = db.prepare(`${withCounts} WHERE c.id = ?`);
  const findByName = db.prepare(`${withCounts} WHERE c.name = ? COLLATE NOCASE`);
  const findFallback = db.prepare(`${withCounts} WHERE c.is_fallback = 1`);
  const insertOne = db.prepare('INSERT INTO categories (name, icon, color, created_at_utc) VALUES (?, ?, ?, ?)');
  const updateOne = db.prepare('UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?');
  const deleteOne = db.prepare('DELETE FROM categories WHERE id = ?');
  const moveExpenses = db.prepare('UPDATE expenses SET category_id = ? WHERE category_id = ?');

  const ruleSelect = `
    SELECT r.*, c.name AS category_name FROM category_rules r
    JOIN categories c ON c.id = r.category_id`;
  const allRules = db.prepare(`${ruleSelect} ORDER BY c.is_fallback, c.id, r.source = 'default', r.keyword COLLATE NOCASE`);
  const rulesForCategory = db.prepare(`${ruleSelect} WHERE r.category_id = ? ORDER BY r.source = 'default', r.keyword COLLATE NOCASE`);
  const ruleByNorm = db.prepare(`${ruleSelect} WHERE r.keyword_norm = ?`);
  const upsertRule = db.prepare(`
    INSERT INTO category_rules (category_id, keyword, keyword_norm, source, created_at_utc)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(keyword_norm) DO UPDATE SET
      category_id = excluded.category_id, keyword = excluded.keyword, source = excluded.source`);
  const deleteRule = db.prepare('DELETE FROM category_rules WHERE keyword_norm = ?');

  return {
    list: () => listAll.all().map(toCategory),
    findById: (id) => toCategory(findOne.get(id)),
    findByName: (name) => toCategory(findByName.get(name)),
    findFallback: () => toCategory(findFallback.get()),
    insert: ({ name, icon, color, createdAtUtc }) => Number(insertOne.run(name, icon, color, createdAtUtc).lastInsertRowid),
    update: (id, { name, icon, color }) => { updateOne.run(name, icon, color, id); },
    delete: (id) => { deleteOne.run(id); },
    moveExpenses: (fromId, toId) => Number(moveExpenses.run(toId, fromId).changes),

    allRules: () => allRules.all().map(toRule),
    rulesFor: (categoryId) => rulesForCategory.all(categoryId).map(toRule),
    findRule: (keywordNorm) => { const row = ruleByNorm.get(keywordNorm); return row ? toRule(row) : null; },
    saveRule: ({ categoryId, keyword, keywordNorm, source, createdAtUtc }) => {
      upsertRule.run(categoryId, keyword, keywordNorm, source, createdAtUtc);
    },
    deleteRule: (keywordNorm) => Number(deleteRule.run(keywordNorm).changes),
  };
}
