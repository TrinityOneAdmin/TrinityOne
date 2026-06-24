#!/usr/bin/env node
// One-shot helper: create relay/catalog-key.json if it doesn't exist, and print the public key.
// The pubkey is baked into engine.js (CATALOG_PUB) so members verify the signed catalog event.
// The secret stays on disk (gitignored), same custody model as relay/release-key.pem.
//
// Usage: node scripts/init-catalog-key.mjs
// Re-runs are safe — won't overwrite an existing key.
import { writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
const bytesToHex = (u8) => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const KEY_PATH = join(ROOT, 'relay', 'catalog-key.json');

if (existsSync(KEY_PATH)) {
  // SECURITY-AUDIT-2026-06-24 M7: warn loudly if mode has drifted from 0600 (writeFileSync's
  // mode arg only applies at create-time, so a later editor save or restore could expose the key).
  const _mode = statSync(KEY_PATH).mode & 0o777;
  if (_mode !== 0o600) {
    console.warn('⚠  ' + KEY_PATH + ' has mode ' + _mode.toString(8) + ' (expected 600). Fix with: chmod 600 ' + KEY_PATH);
  }
  const { pubkey } = JSON.parse((await import('node:fs')).readFileSync(KEY_PATH, 'utf8'));
  console.log('catalog-key.json already exists.');
  console.log('pubkey (hex):', pubkey);
  console.log('npub:        ', npubEncode(pubkey));
  process.exit(0);
}

mkdirSync(dirname(KEY_PATH), { recursive: true });
const sk = generateSecretKey();
const skHex = bytesToHex(sk);
const pubkey = getPublicKey(sk);
writeFileSync(KEY_PATH, JSON.stringify({ sk: skHex, pubkey, created: new Date().toISOString() }, null, 2), { mode: 0o600 });
console.log('wrote', KEY_PATH);
console.log('pubkey (hex):', pubkey);
console.log('npub:        ', npubEncode(pubkey));
console.log('\nBake the hex pubkey into engine.js as CATALOG_PUB.');
