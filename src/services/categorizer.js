// Suggests a category for a description. Pure and deterministic: the same input
// always gives the same answer, with no database or network.
//
//   1. Find rules whose keyword words appear consecutively in the description.
//   2. The user's own rules beat built-in ones.
//   3. A longer phrase beats a shorter one inside it ("water bottle" over "water").
//   4. Matches from different categories give low confidence plus alternatives.

import { tokenize } from '../utils/text.js';

/**
 * @param {string} description
 * @param {Array<{categoryId:number, keyword:string, keywordNorm:string, source:string}>} rules
 * @returns {{categoryId:number|null, keyword:string|null, source:string|null,
 *            confidence:'high'|'low'|'none', alternativeCategoryIds:number[]}}
 */
export function suggestCategory(description, rules) {
  const words = tokenize(description);

  // Find every place a rule's words appear, in order.
  let matches = [];
  for (const rule of rules) {
    const keywordWords = rule.keywordNorm.split(' ');
    for (let start = 0; start + keywordWords.length <= words.length; start += 1) {
      if (keywordWords.every((word, offset) => words[start + offset] === word)) {
        matches.push({ rule, start, end: start + keywordWords.length });
      }
    }
  }
  if (matches.length === 0) {
    return { categoryId: null, keyword: null, source: null, confidence: 'none', alternativeCategoryIds: [] };
  }

  // Rules the user taught override the built-ins.
  if (matches.some((m) => m.rule.source !== 'default')) {
    matches = matches.filter((m) => m.rule.source !== 'default');
  }

  // Drop matches nested inside a longer match.
  const length = (m) => m.end - m.start;
  matches = matches.filter((m) => !matches.some((other) =>
    other !== m && other.start <= m.start && other.end >= m.end && length(other) > length(m)));

  // Best first: more words, then more letters, then earliest, then lowest id (for stable ties).
  const score = (m) => length(m) * 100 + m.rule.keywordNorm.length;
  matches.sort((a, b) => score(b) - score(a) || a.start - b.start || a.rule.categoryId - b.rule.categoryId);

  const best = matches[0];
  const categoryIds = [...new Set(matches.map((m) => m.rule.categoryId))];
  return {
    categoryId: best.rule.categoryId,
    keyword: best.rule.keyword,
    source: best.rule.source,
    confidence: categoryIds.length === 1 ? 'high' : 'low',
    alternativeCategoryIds: categoryIds.filter((id) => id !== best.rule.categoryId),
  };
}
