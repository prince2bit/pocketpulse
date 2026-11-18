// All SQL about expenses lives here.

// snake_case columns -> camelCase fields.
function toExpense(row) {
  if (!row) return null;
  return {
    id: row.id,
    description: row.description,
    amountMinor: row.amount_minor,
    currency: row.currency,
    spentAtUtc: row.spent_at_utc,
    timeZone: row.time_zone,
    localDate: row.local_date,
    createdAtUtc: row.created_at_utc,
    categoryId: row.category_id,
    // The category's current name, icon and colour, joined in by the queries below.
    category: row.category_id == null ? null : {
      id: row.category_id, name: row.category_name, icon: row.category_icon, color: row.category_color,
    },
  };
}

// Every read joins the categories table so callers get the name/icon/colour too.
// LEFT JOIN keeps expenses even if they somehow have no category.
const SELECT_WITH_CATEGORY = `
  SELECT e.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
  FROM expenses e LEFT JOIN categories c ON c.id = e.category_id`;

export function createExpenseRepository(db) {
  const insertOne = db.prepare(`
    INSERT INTO expenses
      (description, amount_minor, currency, spent_at_utc, time_zone, local_date, created_at_utc, category_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findOne = db.prepare(`${SELECT_WITH_CATEGORY} WHERE e.id = ?`);
  // Newest first. `id DESC` breaks ties when two expenses share a timestamp.
  const recent = db.prepare(`${SELECT_WITH_CATEGORY} ORDER BY e.spent_at_utc DESC, e.id DESC LIMIT ?`);
  const countAll = db.prepare('SELECT count(*) AS total FROM expenses');
  // COLLATE NOCASE makes "Chips" and "chips" count as the same text.
  const duplicate = db.prepare(`${SELECT_WITH_CATEGORY}
    WHERE e.description = ? COLLATE NOCASE AND e.amount_minor = ? AND e.currency = ? AND e.spent_at_utc >= ?
    ORDER BY e.spent_at_utc DESC LIMIT 1
  `);

  // Aggregates. local_date (YYYY-MM-DD) sorts chronologically, so BETWEEN works.
  // Sums are over integer minor units and always grouped by currency.
  const totalsByCurrency = db.prepare(`
    SELECT currency, SUM(amount_minor) AS total_minor, COUNT(*) AS n
    FROM expenses WHERE local_date BETWEEN ? AND ? AND (? IS NULL OR category_id = ?)
    GROUP BY currency ORDER BY n DESC, currency`);
  const totalsByCategory = db.prepare(`
    SELECT e.category_id, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
           SUM(e.amount_minor) AS total_minor, COUNT(*) AS n
    FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.local_date BETWEEN ? AND ? AND e.currency = ?
    GROUP BY e.category_id ORDER BY total_minor DESC, n DESC, c.name`);
  const mostUsedCategory = db.prepare(`
    SELECT e.category_id, c.name AS category_name, c.icon AS category_icon, c.color AS category_color, COUNT(*) AS n
    FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.local_date BETWEEN ? AND ?
    GROUP BY e.category_id ORDER BY n DESC, e.category_id LIMIT 1`);
  const dailyTotals = db.prepare(`
    SELECT local_date, SUM(amount_minor) AS total_minor FROM expenses
    WHERE local_date BETWEEN ? AND ? AND currency = ? AND (? IS NULL OR category_id = ?)
    GROUP BY local_date`);
  const largestBetween = db.prepare(`${SELECT_WITH_CATEGORY}
    WHERE e.local_date BETWEEN ? AND ? AND e.currency = ? AND (? IS NULL OR e.category_id = ?)
    ORDER BY e.amount_minor DESC, e.spent_at_utc DESC, e.id DESC LIMIT 1`);
  const listBetween = db.prepare(`${SELECT_WITH_CATEGORY}
    WHERE e.local_date BETWEEN ? AND ? ORDER BY e.spent_at_utc DESC, e.id DESC LIMIT ?`);
  const countBetween = db.prepare('SELECT count(*) AS n FROM expenses WHERE local_date BETWEEN ? AND ? AND (? IS NULL OR category_id = ?)');

  const toCategoryRef = (row) => (row.category_id == null ? null : {
    id: row.category_id, name: row.category_name, icon: row.category_icon, color: row.category_color,
  });

  return {
    // `categoryId` is optional: pass one to look at just that category, or null for all.
    totalsByCurrency: (from, to, categoryId = null) => totalsByCurrency.all(from, to, categoryId, categoryId)
      .map((row) => ({ currency: row.currency, totalMinor: row.total_minor, count: row.n })),
    totalsByCategory: (from, to, currency) => totalsByCategory.all(from, to, currency)
      .map((row) => ({ category: toCategoryRef(row), totalMinor: row.total_minor, count: row.n })),
    mostUsedCategory: (from, to) => {
      const row = mostUsedCategory.get(from, to);
      return row ? { category: toCategoryRef(row), count: row.n } : null;
    },
    dailyTotals: (from, to, currency, categoryId = null) => new Map(dailyTotals.all(from, to, currency, categoryId, categoryId)
      .map((row) => [row.local_date, row.total_minor])),
    largest: (from, to, currency, categoryId = null) => toExpense(largestBetween.get(from, to, currency, categoryId, categoryId)),
    listBetween: (from, to, limit) => listBetween.all(from, to, limit).map(toExpense),
    countBetween: (from, to, categoryId = null) => countBetween.get(from, to, categoryId, categoryId).n,

    insert(expense) {
      const result = insertOne.run(
        expense.description, expense.amountMinor, expense.currency,
        expense.spentAtUtc, expense.timeZone, expense.localDate, expense.createdAtUtc,
        expense.categoryId ?? null,
      );
      return Number(result.lastInsertRowid);
    },
    findById: (id) => toExpense(findOne.get(id)),
    listRecent: (limit) => recent.all(limit).map(toExpense),
    count: () => countAll.get().total,
    findDuplicate: ({ description, amountMinor, currency, sinceUtc }) =>
      toExpense(duplicate.get(description, amountMinor, currency, sinceUtc)),
  };
}
