// THE SERVICE WORKER MUST NEVER CACHE BACKUPS OR SERMON BLOBS.
//   Run: node --test scripts/a-backup-is-never-cached-by-the-service-worker.test.mjs
//
// Without the fix, /export (the church backup ZIP) and /blob/<sha> (sermon
// audio/video) fell through to the cache-first catch-all. The backup was
// cached on first download and served from cache forever — so every
// subsequent "Download backup" got the same stale ZIP. Sermon audio filled
// Cache Storage with unbounded media.
//
// The fix adds both routes to the never-cache regex. This test reads the
// SHIPPED sw.js and verifies the regex matches them. CLAUDE.md §1: it fails
// if the fix is deleted from the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SW = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

// Extract the never-cache regex from the fetch handler
function getNeverCacheRegex() {
  const m = SW.match(/if\s*\(\/\^\\\/\(([^)]+)\)\/\.test\(url\.pathname\)\)\s*return/);
  assert.ok(m, 'the never-cache regex is missing from sw.js');
  return new RegExp('^\\/(' + m[1] + ')');
}

test('/export is in the never-cache list', () => {
  const re = getNeverCacheRegex();
  assert.ok(re.test('/export'), '/export is not excluded — backups will be cached and repeat the first one');
  assert.ok(re.test('/export-media'), '/export-media is not excluded — media backups will be cached too');
});

test('/blob is in the never-cache list', () => {
  const re = getNeverCacheRegex();
  assert.ok(re.test('/blob/abc123'), '/blob/<sha> is not excluded — sermon audio will fill the cache forever');
});

test('the never-cache list still covers the routes it always covered', () => {
  const re = getNeverCacheRegex();
  for (const path of ['/relay', '/modules/', '/push/', '/config', '/status', '/feed',
    '/tunnel', '/settings', '/update', '/local-token']) {
    assert.ok(re.test(path), path + ' fell out of the never-cache list');
  }
});
