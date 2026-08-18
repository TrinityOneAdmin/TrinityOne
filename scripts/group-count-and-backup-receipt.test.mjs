// AN OPEN GROUP DOES NOT INVENT A MEMBER COUNT, AND A BACKUP LEAVES A LASTING RECEIPT.
// Run: node --test scripts/group-count-and-backup-receipt.test.mjs
//
// Two legibility findings from simulated members, 2026-08-18.
//
// 1. OPEN-GROUP COUNT. Every open group showed the church's TOTAL as "N members", read as "N people in THIS
//    study". An open group has no per-group membership — everyone in the church can read it — so the number is
//    a fiction. Only an invite-only group has a roster to count. Open groups now say "open to your church".
//
// 2. SILENT BACKUP. The success toast lasts a few seconds and then nothing on the screen says a backup exists,
//    so members re-ran it or assumed failure. markSaved now records the DATE and the panel shows "Last backed
//    up <date>" — and the several places that suppress the backup nudge on that key must treat the new ISO
//    value as backed-up, not only the legacy '1'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CHAT = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');
const EXTRAS = readFileSync(new URL('../app/identity-extras.jsx', import.meta.url), 'utf8');
const TODAY = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');
const IDENTITY = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');

test('an open group carries no fabricated member count', () => {
  assert.match(CHAT, /members: g\.visibility === 'invite' \? \(Array\.isArray\(g\.members\) \? g\.members\.length : 0\) : null/,
    'an open group must map to a null member count, not the church-wide total');
  assert.match(CHAT, /openToChurch: g\.visibility !== 'invite'/, 'and carry an honest open-to-church flag instead');
  assert.match(CHAT, /Open to your church/, 'the room header must render that honestly');
});

test('markSaved records a date, and the panel shows it', () => {
  assert.match(EXTRAS, /localStorage\.setItem\('trinityone\.backedup\.' \+ np, new Date\(\)\.toISOString\(\)\)/,
    'the backup marker must be a timestamp, not a bare flag');
  assert.match(EXTRAS, /Last backed up/, 'the export panel must show a persistent last-backed-up line');
  assert.match(EXTRAS, /if \(!v \|\| v === '1'\) return null/, 'and read legacy "1" as date-unknown, not crash');
});

test('every backup-nudge check treats the new ISO value as backed up', () => {
  // if any of these still compares === '1', a member who backed up under the new code is nagged forever
  for (const [name, src] of [['screens-today.jsx', TODAY], ['identity.jsx', IDENTITY]]) {
    assert.doesNotMatch(src, /getItem\('trinityone\.backedup\.' \+ np\) === '1'\) return true/,
      `${name} still checks the backup flag with === '1' — an ISO-dated backup would read as not-backed-up`);
    assert.match(src, /getItem\('trinityone\.backedup\.' \+ np\)\) return true/,
      `${name} must treat any truthy backup value as backed up`);
  }
});
