// Fails if placeholder text is still in the repository. Run before publishing:
//   npm run release:check

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const PLACEHOLDER = /YOUR[ _-]?(NAME|USERNAME|HANDLE)|<your-|\bTODO\b|\bFIXME\b/i;
const SKIP = new Set(['node_modules', '.git', 'tests', 'scripts']);

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (/\.(md|json|ya?ml|js|txt)$|LICENSE$/.test(entry.name)) yield full;
  }
}

const hits = [];
for (const file of files(root)) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    if (PLACEHOLDER.test(line)) hits.push(`${path.relative(root, file)}:${index + 1}  ${line.trim().slice(0, 90)}`);
  });
}

if (hits.length > 0) {
  console.error(`Found ${hits.length} placeholder(s) to replace before publishing:\n`);
  console.error(hits.map((hit) => `  ${hit}`).join('\n'));
  process.exit(1);
}
console.log('No placeholders found.');
