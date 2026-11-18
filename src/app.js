// Composition root: connects the database, repositories and services.
// Everything receives its dependencies instead of creating them, which is
// what lets the tests run against an in-memory database.

import { openDatabase, withTransaction } from './database/connection.js';
import { migrate } from './database/migrations.js';
import { createCategoryRepository } from './database/repositories/categoryRepository.js';
import { createExpenseRepository } from './database/repositories/expenseRepository.js';
import { createSettingsRepository } from './database/repositories/settingsRepository.js';
import { createAnalyticsService } from './services/analyticsService.js';
import { createCategoryService } from './services/categoryService.js';
import { createExpenseService } from './services/expenseService.js';
import { createSettingsService } from './services/settingsService.js';

export async function createApp({ dbPath, clock, systemTimeZone } = {}) {
  const db = await openDatabase(dbPath);
  try {
    migrate(db); // create or upgrade tables before anything else touches them
  } catch (error) {
    db.close();
    throw error;
  }

  const settings = createSettingsService(createSettingsRepository(db), { systemTimeZone });
  const categories = createCategoryService({
    categories: createCategoryRepository(db),
    transaction: (work) => withTransaction(db, work),
    clock,
  });
  const expenseRepository = createExpenseRepository(db);
  const expenses = createExpenseService({ expenses: expenseRepository, settings, categories, clock });
  const analytics = createAnalyticsService({ expenses: expenseRepository, settings, clock });

  return { db, settings, categories, expenses, analytics, close: () => db.close() };
}
