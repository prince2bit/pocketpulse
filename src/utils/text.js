// Normalising text for keyword matching: lowercase words with plurals reduced,
// so "chips" and "chip" compare equal. The canonical form is stored in the database,
// so changing these rules needs a migration that recomputes stored keywords.

/** "chips" -> "chip", "sandwiches" -> "sandwich", but "bus" stays "bus". */
export function canonicalWord(word) {
  if (word.length <= 3 || !word.endsWith('s')) return word;
  if (/(ches|shes|xes|zes|sses)$/.test(word)) return word.slice(0, -2); // sandwiches, boxes, glasses
  if (/(ss|us|is)$/.test(word)) return word; // pass, campus, tennis: not plurals
  return word.slice(0, -1);
}

/** "  Bought: 2 Samosas! " -> ["bought", "2", "samosa"]  (punctuation vanishes) */
export function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFC')
    // \p{L} letters, \p{M} combining marks (vowel signs in Hindi words like चाय), \p{N} digits.
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean)
    .map(canonicalWord);
}

/** The standard form we store and compare: "Face Wash" -> "face wash". */
export const canonicalize = (text) => tokenize(text).join(' ');
