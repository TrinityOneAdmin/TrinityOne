#!/usr/bin/env node
// Publish catalog.json as a signed NIP-78 (kind:30078) event so members can fetch the module
// list via any Nostr relay — not just the central HTTP host. Signed by the dedicated catalog
// key (relay/catalog-key.json, gitignored). The pubkey is baked into engine.js as CATALOG_PUB
// so clients verify the signature before trusting the catalog.
//
// d-tag = 'catalog:trinityone' (NIP-78 addressable; latest event for this {author,d} wins).
// content = the full catalog.json text.
//
// Broadcasts to the canonical relays (mirrors of CANONICAL_RELAYS in src/fellowship.src.js).
// Run as the last step of scripts/release.sh.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalizeEvent } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const KEY_PATH = join(ROOT, 'relay', 'catalog-key.json');
const CATALOG = join(ROOT, 'catalog.json');

const RELAYS = [
  'wss://trinityone-master-01.tailbeaac0.ts.net/relay',
  'wss://trinityone.tailbeaac0.ts.net/relay',
  'wss://trinityone-nas.tailbeaac0.ts.net/relay',
];

if (!existsSync(KEY_PATH)) {
  console.error('✖ relay/catalog-key.json missing — run: node scripts/init-catalog-key.mjs');
  process.exit(1);
}

// SECURITY-AUDIT-2026-06-24 M7: re-assert mode 0600 on every sign. writeFileSync's { mode: 0o600 }
// only applies on file CREATION; a later editor save / manual rotation / backup-restore can leave
// the key world-readable. Refuse to publish if that ever happens.
{
  const _st = statSync(KEY_PATH);
  if (_st.mode & 0o077) {
    console.error('✖ relay/catalog-key.json has permissions ' + (_st.mode & 0o777).toString(8)
      + ' — must be 0600. Run: chmod 600 ' + KEY_PATH);
    process.exit(1);
  }
}

const key = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
const sk = Uint8Array.from(key.sk.match(/.{2}/g).map(h => parseInt(h, 16)));
const catalogText = readFileSync(CATALOG, 'utf8');
const catalog = JSON.parse(catalogText);

const evt = finalizeEvent({
  kind: 30078,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ['d', 'catalog:trinityone'],
    ['t', 'trinityone'],
    ['version', String(catalog.version || 1)],
  ],
  content: catalogText,
}, sk);

console.log(`signing catalog v${catalog.version} as ${evt.pubkey}`);
console.log(`event id: ${evt.id}`);

const pool = new SimplePool();
const results = await Promise.allSettled(pool.publish(RELAYS, evt));
let ok = 0;
results.forEach((r, i) => {
  if (r.status === 'fulfilled') { ok++; console.log(`  ✓ ${RELAYS[i]}`); }
  else console.warn(`  ✗ ${RELAYS[i]} — ${r.reason?.message || r.reason}`);
});
pool.close(RELAYS);

if (ok === 0) {
  console.error('✖ catalog publish failed on every relay');
  process.exit(1);
}
console.log(`published to ${ok}/${RELAYS.length} relay(s)`);
