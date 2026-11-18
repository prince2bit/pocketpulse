// PocketPulse must never talk to the internet. This test reads every source
// file and fails if one even MENTIONS a way to make network requests or run
// other programs. If you ever need to change it, that should be a deliberate,
// reviewed decision, not an accident.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sourceDir = path.resolve(import.meta.dirname, '..', 'src');
const sourceFiles = fs.readdirSync(sourceDir, { recursive: true })
  .filter((name) => name.endsWith('.js'))
  .map((name) => path.join(sourceDir, name));

const FORBIDDEN = [
  [/node:(http|https|http2|net|tls|dgram|dns|cluster|worker_threads|child_process|inspector)\b/, 'a Node module that can reach the network or run programs'],
  [/from\s+['"](http|https|http2|net|tls|dgram|dns|child_process)['"]/, 'a bare network module import'],
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bnavigator\.sendBeacon\b/, 'sendBeacon'],
  [/https?:\/\/(?!www\.w3\.org)[a-z0-9.-]+\.[a-z]{2,}/i, 'a hard-coded web address'],
];

describe('privacy: the app is 100% local', () => {
  it('found the source files to check', () => {
    assert.ok(sourceFiles.length >= 15, `only found ${sourceFiles.length} files`);
  });
  for (const [pattern, description] of FORBIDDEN) {
    it(`no source file uses ${description}`, () => {
      for (const file of sourceFiles) {
        const code = fs.readFileSync(file, 'utf8')
          .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n'); // comments may mention URLs
        assert.ok(!pattern.test(code), `${path.relative(sourceDir, file)} uses ${description}`);
      }
    });
  }
  it('has no runtime dependencies at all', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(sourceDir, '..', 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies, undefined);
  });
});
