// THE READER KEEPS THE TRANSLATION YOU PICKED, ACROSS A RESTART.
// Run: node --test scripts/the-reader-keeps-the-translation-you-picked.test.mjs
//
// Round-2 device testing, 2026-11-17: "the reader returns to BSB after every restart". Measured cause (plan
// reference/PLAN-reader-version-and-new-church-console-2026-11-18.md, A1): nothing ever saved the choice.
// engine.js's `active` was a closure variable, `setActive` only set it, and at boot `addSource` made the FIRST
// Bible registered active — BSB, because BSB is the first Bible every phone installs.
//
// The REAL engine.js runs in a vm over in-memory IndexedDB + localStorage (scripts/install-bible-harness.mjs). A
// "reboot" is a second phone({ state }) over the SAME state — the same bytes and the same localStorage.
//
// S0-2 is the row that catches a "switch to it later" fix: the moment Bible.loaded first turns true is when the
// reader resolves its saved place (app/app.jsx boot effect), Today picks its verse and the widget publishes, so the
// chosen Bible must already be the active one at that moment, not a beat later.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { phone, realFflate, sleep, newStores, ROOT } from './install-bible-harness.mjs';

const PREF = 'trinityone.bible.translation';
const usfmZip = (name) => realFflate.zipSync({ '02-GEN.usfm': new TextEncoder().encode(`\\id GEN - ${name}\n\\c 1\n\\p\n\\v 1 In the beginning ${name}.\n`) });
async function settled(p, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (p.Bible.loaded && !p.Bible.loading) return Date.now() - t0; await sleep(20); }
  assert.fail('the boot never settled');
}
// A phone that installed BSB (the default download) and then a member's own file Bible, and picked `pick`.
async function pickedPhone({ pick = 'file' } = {}) {
  const p = phone({ serveBsb: true }); await p.boot(); await settled(p);
  assert.equal(p.Bible.activeVersion, 'BSB', 'fixture: BSB should be the first Bible on a new phone');
  const r = await p.Bible.installFromBytes(usfmZip('Picked Bible'), 'picked.zip');
  assert.equal(r.ok, true, JSON.stringify(r));
  if (pick === 'file') p.Bible.setActive(r.abbr);   // what the VersionSheet / "Read it now" call
  return { state: p.state, abbr: r.abbr, url: p.Bible.activeUrl };
}
// Reboot over the same state, recording the active Bible at the first notify where Bible.loaded is true.
async function reboot(state, opts = {}) {
  const p = phone({ state, serveBsb: true, ...opts });
  const seen = { atFirstLoaded: undefined };
  p.Bible.subscribe(() => { if (seen.atFirstLoaded === undefined && p.Bible.loaded) seen.atFirstLoaded = p.Bible.activeVersion; });
  await p.boot();
  const took = await settled(p);
  return { p, seen, took };
}

test('S0-1 — a Bible picked before a restart is the active one after it', async () => {
  const { state, abbr } = await pickedPhone();
  const { p } = await reboot(state);
  assert.equal(p.Bible.activeVersion, abbr, 'THE FINDING: after a restart the reader is back on ' + p.Bible.activeVersion);
  assert.equal(p.Bible._error, null);
});

test('S0-2 — it is ALREADY active the first moment Bible.loaded is true (no BSB-then-switch)', async () => {
  const { state, abbr } = await pickedPhone();
  const { seen } = await reboot(state);
  assert.equal(seen.atFirstLoaded, abbr, 'the first Bible the screens saw at boot was ' + seen.atFirstLoaded);
});

test('S0-3 — the picked Bible\'s bytes gone → BSB, no error, nothing throws, and the choice is kept for a later boot', async () => {
  const { state, url } = await pickedPhone();
  state.stores.get('modules').delete(url);
  const { p } = await reboot(state);
  assert.equal(p.Bible.activeVersion, 'BSB');
  assert.equal(p.Bible._error, null);
  assert.equal(JSON.stringify(p.Bible.versions().map(v => v.abbr)), '["BSB"]');   // stringified: the engine's arrays are another realm's
  assert.equal(JSON.parse(state.ls.get(PREF) || 'null')?.url, url, 'a fallback boot overwrote the member\'s choice');
});

test('S0-4 — picking BSB back is kept too (the choice is followed, not "the newest install wins")', async () => {
  const { state } = await pickedPhone();
  const p1 = (await reboot(state)).p;
  p1.Bible.setActive('BSB');
  const { p, seen } = await reboot(state);
  assert.equal(p.Bible.activeVersion, 'BSB');
  assert.equal(seen.atFirstLoaded, 'BSB');
});

test('S0-5 — NO saved choice: today\'s order is kept (a Bible recorded before BSB is still the one that opens)', async () => {
  const { state, abbr } = await pickedPhone({ pick: 'none' });
  assert.equal(state.ls.get(PREF), undefined, 'fixture: nothing was picked, so nothing may be saved');
  const m = JSON.parse(state.ls.get('trinityone.installed'));
  const keys = Object.keys(m); const bsbKey = keys.find(k => m[k].abbr === 'BSB');
  const reordered = {}; for (const k of keys) if (k !== bsbKey) reordered[k] = m[k]; reordered[bsbKey] = m[bsbKey];
  state.ls.set('trinityone.installed', JSON.stringify(reordered));
  const { p, seen } = await reboot(state);
  assert.equal(p.Bible.activeVersion, abbr, 'with no choice saved the first-recorded Bible must open, as before');
  assert.equal(seen.atFirstLoaded, abbr);
});

test('S0-6 — a damaged or hostile saved value never breaks the boot', async () => {
  const { state } = await pickedPhone({ pick: 'none' });
  const bsbUrl = Object.keys(JSON.parse(state.ls.get('trinityone.installed'))).find(k => /engbsb/.test(k));
  for (const raw of ['null', '5', '"x"', '{', '{"url":"constructor"}', '{"url":"__proto__"}', '{"url":5}', JSON.stringify({ url: bsbUrl })]) {
    state.ls.set(PREF, raw);
    const { p } = await reboot(state);
    const abbrs = p.Bible.versions().map(v => v.abbr);
    assert.equal(abbrs.length, 2, raw + ': ' + JSON.stringify(abbrs));
    assert.equal(new Set(abbrs).size, 2, raw + ': a Bible was loaded twice: ' + JSON.stringify(abbrs));
    assert.ok(abbrs.includes(p.Bible.activeVersion), raw + ': active is ' + p.Bible.activeVersion);
    assert.equal(p.Bible._error, null, raw);
  }
});

test('S0-7 — an https (eBible mirror) Bible that was picked comes back first, bounded even when the mirror list hangs', async () => {
  const url = 'https://ebible.org/Scriptures/kud_usfm.zip';
  const base = await pickedPhone({ pick: 'none' });
  const st = base.state;
  st.stores.get('modules').set(url, usfmZip('Mirror Bible'));
  const m = JSON.parse(st.ls.get('trinityone.installed'));
  m[url] = { url, id: 'MIR', abbr: 'MIR', name: 'Mirror Bible', kind: 'bible', format: 'USFM', category: 'bibles' };
  st.ls.set('trinityone.installed', JSON.stringify(m));
  st.ls.set(PREF, JSON.stringify({ url }));
  for (const mirrorHangs of [false, true]) {
    const p = phone({ state: st, serveBsb: true, mirrorHangs });
    const seen = {}; const t0 = Date.now();
    p.Bible.subscribe(() => { if (seen.at === undefined && p.Bible.loaded) { seen.at = p.Bible.activeVersion; seen.ms = Date.now() - t0; } });
    await p.boot();
    for (let i = 0; i < 400 && seen.at === undefined; i++) await sleep(20);
    console.log(`  mirror ${mirrorHangs ? 'HANGS' : 'answers'}: first loaded after ${seen.ms} ms, active = ${seen.at}`);
    assert.equal(seen.at, 'MIR', 'mirrorHangs=' + mirrorHangs);
    assert.ok(seen.ms < 7000, 'mirrorHangs=' + mirrorHangs + ': waited ' + seen.ms + ' ms (LIST_WAIT_MS is 6 s)');
  }
});

test('GUARD — no Bible in catalog.json carries a sha256 pin', () => {
  const c = JSON.parse(readFileSync(ROOT + 'catalog.json', 'utf8'));
  const pinned = (c.categories || []).filter(g => g.id === 'bibles').flatMap(g => g.items || []).filter(it => it && it.sha256).map(it => it.abbr);
  assert.deepEqual(pinned, [], 'a Bible is now pinned — the chosen Bible could wait on a re-download before first paint; revisit Q3 (owner: show BSB, never blank) before shipping the pin');
});
