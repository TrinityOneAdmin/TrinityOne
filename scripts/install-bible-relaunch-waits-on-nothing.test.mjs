// A MEMBER'S OWN IMPORTED BIBLE DOES NOT WAIT ON THE NETWORK TO COME BACK AFTER A RELAUNCH.
// Run: node --test scripts/install-bible-relaunch-waits-on-nothing.test.mjs
//
// FOUND BY RUNNING IT (2026-11-17, Chromium, the real Library > install-from-file path, probe in the commit message): an imported
// USFM Bible installed and read perfectly, but after a relaunch it came back ~10 s AFTER the shipped Bible on the web build, because
// restoreInstalled asked moduleLinkAllowed("is this url ours?") first, and that fetched the 414 KB eBible mirror list before the
// member's own file was touched (and every record after it waited too). On a thin pipe that is minutes, and if the connection hangs
// the fetch never settles: the Bible's text is simply never loaded. An imported/ key can never be a published module, so nothing
// has to be read to know that; and no list read may wait for ever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, readyPhone, bibleDb, realFflate, sleep, newStores, file } from './install-bible-harness.mjs';

const usfmZip = (name) => realFflate.zipSync({ '02-GEN.usfm': new TextEncoder().encode(`\\id GEN - ${name}\n\\c 1\n\\p\n\\v 1 In the beginning ${name}.\n`) });

async function installedState(zip) {
  const p = await readyPhone();
  const r = await p.Bible.installFromBytes(zip, 'my-bible.zip');
  assert.equal(r.ok, true, JSON.stringify(r));
  return { state: p.state, abbr: r.abbr };
}

test('RELAUNCH 1 — an imported USFM Bible reads again after a relaunch WITHOUT any list being fetched for it', async () => {
  const { state, abbr } = await installedState(usfmZip('Relaunch Bible'));
  const p = phone({ state }); await p.boot();
  for (let i = 0; i < 100 && p.Bible.versions().length < 1; i++) await sleep(20);
  assert.equal(p.Bible.versions().length, 1);
  assert.match(p.Bible.getVerses(1, 1, abbr)[0].text, /In the beginning Relaunch Bible/);
  assert.ok(!p.fetched.includes('ebible-catalog.json'), 'the 414 KB eBible list was fetched before the member\'s own file was loaded: ' + p.fetched);
});

test('RELAUNCH 2 — a mirror list that NEVER answers does not stop the member\'s Bible, or the ones after it, from loading', async () => {
  const { state, abbr } = await installedState(usfmZip('Hang Bible'));
  const p = phone({ state, mirrorHangs: true }); const t0 = Date.now(); await p.boot();
  for (let i = 0; i < 150 && p.Bible.versions().length < 1; i++) await sleep(20);
  assert.equal(p.Bible.versions().length, 1, 'the imported Bible never loaded while the mirror list hung');
  assert.match(p.Bible.getVerses(1, 1, abbr)[0].text, /In the beginning Hang Bible/);
  assert.ok(Date.now() - t0 < 3000, 'it waited ' + (Date.now() - t0) + ' ms');
});

test('RELAUNCH 3 — an https record still waits for the lists (bounded), and a hung list means SKIP, not quarantine and not load', async () => {
  const url = 'https://evil.example/x.zip';
  const good = Buffer.from(realFflate.zipSync({ 'ok.bbl.mybible': await bibleDb('OK', 'Ok Bible', 'x') })); const at = good.length - 22;
  const loc = Buffer.alloc(20); loc.writeUInt32LE(0x07064b50, 0);
  const refused = new Uint8Array(Buffer.concat([good.subarray(0, at), loc, good.subarray(at)]));
  const honestKey = 'imported/okok/ok.zip';
  const honest = usfmZip('After The Hang');
  const st = newStores(); st.stores.set('modules', new Map([[url, refused], [honestKey, honest]]));
  st.ls.set('trinityone.installed', JSON.stringify({
    [url]: { url, id: 'OK', abbr: 'OK', name: 'Legacy', kind: 'bible', category: 'bibles' },
    [honestKey]: { url: honestKey, id: 'ATH', abbr: 'ATH', name: 'After The Hang', kind: 'bible', category: 'bibles' } }));
  const p = phone({ state: st, mirrorHangs: true }); await p.boot();
  await sleep(14000);   // LIST_WAIT_MS is 6 s, waited once to vouch for the url and once to judge a refusal
  assert.equal(p.Bible.versions().length, 1, 'the record AFTER the hung one never loaded: the restore loop is stuck on the network');
  assert.equal(p.Bible.versions()[0].name, 'After The Hang');
  assert.ok(!JSON.parse(st.ls.get('trinityone.installed'))[url].quarantined, 'a record was branded unsafe because a list never answered');
});

test('RELAUNCH 4 — a catalogue that NEVER answers delays the member\'s Bible by the pins\' bounded wait ONLY (not twice), and it loads', async () => {
  const { state, abbr } = await installedState(usfmZip('Catalogue Hang Bible'));
  const p = phone({ state, catalogHangs: true }); const t0 = Date.now(); await p.boot();
  for (let i = 0; i < 520 && p.Bible.versions().length < 1; i++) await sleep(20);
  const took = Date.now() - t0;
  assert.equal(p.Bible.versions().length, 1, 'the imported Bible never loaded while the catalogue hung');
  assert.match(p.Bible.getVerses(1, 1, abbr)[0].text, /Catalogue Hang Bible/);
  assert.ok(took < 8500, `it waited ${took} ms: once for the pins (6 s) is the most it should cost; the "is it ours?" question must not wait again`);
});

test('RELAUNCH 5 — a RELATIVE record that is not in the catalogue does not fetch the eBible list either (its urls are all https)', async () => {
  const key = 'modules/not-ours.zip';
  const st = newStores(); st.stores.set('modules', new Map([[key, usfmZip('Relative Stranger')]]));
  st.ls.set('trinityone.installed', JSON.stringify({ [key]: { url: key, id: 'RS', abbr: 'RS', name: 'Relative Stranger', kind: 'bible', category: 'bibles' } }));
  const p = phone({ state: st }); await p.boot();
  for (let i = 0; i < 100 && p.Bible.versions().length < 1; i++) await sleep(20);
  assert.ok(!p.fetched.includes('ebible-catalog.json'), 'the 414 KB eBible list was fetched for a relative url: ' + p.fetched);
});

// ---- audit c0421cca F2/F3/F4: ONE bounded answer per list per boot ----
const refusedZip = async () => {
  const good = Buffer.from(realFflate.zipSync({ 'ok.bbl.mybible': await bibleDb('OK', 'Ok Bible', 'x') })); const at = good.length - 22;
  const loc = Buffer.alloc(20); loc.writeUInt32LE(0x07064b50, 0);
  return new Uint8Array(Buffer.concat([good.subarray(0, at), loc, good.subarray(at)]));
};
const rec = (url, abbr, name) => ({ url, id: abbr, abbr, name, kind: 'bible', category: 'bibles' });

test('RELAUNCH 6 — FIVE catalogue records plus the member\'s own Bible, catalogue NEVER answers: the member\'s Bible appears after ONE bounded wait, not five', async () => {
  const urls = ['modules/engbsb.zip', 'modules/eng-kjv.zip', 'modules/eng-web.zip', 'modules/eng-asv.zip', 'modules/ahirani-usfm.zip'];
  const st = newStores(); const mods = new Map(); const ls = {};
  urls.forEach((u, i) => { mods.set(u, usfmZip('Cat ' + i)); ls[u] = rec(u, 'C' + i, 'Cat ' + i); });
  const own = 'imported/aaaaaaaaaaaa/mine.zip'; mods.set(own, usfmZip('My Own Bible')); ls[own] = rec(own, 'MINE', 'My Own Bible');
  st.stores.set('modules', mods); st.ls.set('trinityone.installed', JSON.stringify(ls));
  const p = phone({ state: st, catalogHangs: true }); const t0 = Date.now(); await p.boot();
  for (let i = 0; i < 700 && !p.Bible.versions().some(v => v.name === 'My Own Bible'); i++) await sleep(20);
  const took = Date.now() - t0;
  assert.ok(p.Bible.versions().some(v => v.name === 'My Own Bible'), 'the member\'s own Bible never appeared');
  assert.ok(took < 8500, `it took ${took} ms: every catalogue record paid its own 6 s wait (q18b: 69 s for ten)`);
  assert.ok(Object.values(JSON.parse(st.ls.get('trinityone.installed'))).every(r => !r.quarantined), 'a record was branded unsafe because the catalogue never answered');
});

test('RELAUNCH 7 — a catalogue record whose bytes the reader refuses, catalogue hung: the record after it still loads in ONE bounded wait (the "readable?" question does not wait for ever)', async () => {
  const bad = 'modules/eng-kjv.zip', own = 'imported/bbbbbbbbbbbb/mine.zip';
  const st = newStores(); st.stores.set('modules', new Map([[bad, await refusedZip()], [own, usfmZip('Behind The Refusal')]]));
  st.ls.set('trinityone.installed', JSON.stringify({ [bad]: rec(bad, 'KJV', 'King James'), [own]: rec(own, 'BTR', 'Behind The Refusal') }));
  const p = phone({ state: st, catalogHangs: true }); const t0 = Date.now(); await p.boot();
  for (let i = 0; i < 700 && !p.Bible.versions().some(v => v.name === 'Behind The Refusal'); i++) await sleep(20);
  assert.ok(p.Bible.versions().some(v => v.name === 'Behind The Refusal'), 'the record after the refused one never loaded');
  assert.ok(Date.now() - t0 < 8500, `it took ${Date.now() - t0} ms`);
  assert.ok(!JSON.parse(st.ls.get('trinityone.installed'))[bad].quarantined, 'a catalogue Bible was branded unsafe while the catalogue was hung');
});

test('RELAUNCH 8 — a catalogue that answers at 14 s (after the 6 s bound) does not turn a timed-out "not ours" into "readable" and quarantine a catalogue Bible (q18b-race)', async () => {
  const bad = 'modules/eng-kjv.zip';
  const st = newStores(); st.stores.set('modules', new Map([[bad, await refusedZip()]]));
  st.ls.set('trinityone.installed', JSON.stringify({ [bad]: rec(bad, 'KJV', 'King James') }));
  const p = phone({ state: st, catalogDelay: 14000 }); await p.boot();
  await sleep(17000);
  assert.ok(!JSON.parse(st.ls.get('trinityone.installed'))[bad].quarantined, 'a late catalogue quarantined a published Bible whose bytes would not read');
});

// ---- audit round 2: G1 (mirror shared), G2 (boot answer cleared), N3 (a failed read is retried) ----
const namedUsfm = (name) => realFflate.zipSync({ '02-GEN.usfm': new TextEncoder().encode(`\\id GEN ${name}\n\\c 1\n\\p\n\\v 1 In the beginning ${name}.\n`) });

test('RELAUNCH 9 — FOUR https records, the eBible mirror NEVER answers: ONE bounded wait in total, not one per record (G1)', async () => {
  const st = newStores(); const mods = new Map(); const ls = {};
  for (let i = 0; i < 4; i++) { const u = `https://example.invalid/m${i}.zip`; mods.set(u, usfmZip('Mirror ' + i)); ls[u] = rec(u, 'M' + i, 'Mirror ' + i); }
  st.stores.set('modules', mods); st.ls.set('trinityone.installed', JSON.stringify(ls));
  const p = phone({ state: st, mirrorHangs: true }); const t0 = Date.now(); await p.boot();
  for (let i = 0; i < 700 && p.Bible.versions().length < 4; i++) await sleep(20);
  const took = Date.now() - t0;
  assert.equal(p.Bible.versions().length, 4, 'not every https record loaded (' + p.Bible.versions().length + ')');
  assert.ok(took < 8500, `it took ${took} ms: each https record paid its own 6 s mirror wait`);
});

test('RELAUNCH 10 — after a boot whose catalogue timed out, a LATER install reads the catalogue fresh: the lookalike label is back (G2)', async () => {
  const url = 'https://example.invalid/slow.zip'; const st = newStores();
  st.stores.set('modules', new Map([[url, usfmZip('Slow Catalogue Guest')]]));
  st.ls.set('trinityone.installed', JSON.stringify({ [url]: rec(url, 'SCG', 'Slow Catalogue Guest') }));
  const p = phone({ state: st, catalogDelay: 8000 }); await p.boot();
  for (let i = 0; i < 700 && p.Bible.versions().length < 1; i++) await sleep(20);   // boot waited its one bound (6 s) and gave up on the catalogue
  await sleep(2600);                                                                // ...and the catalogue has now arrived
  const r = await p.Bible.installFromBytes(namedUsfm('American Standard Version'), 'asv.zip');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.name, 'American Standard Version (from a file)', 'the boot\'s "catalogue unreadable" answer outlived the boot: ' + r.name);
});

test('RELAUNCH 11 — a failed catalogue read is NOT remembered: a later install tries again and gets the label (N3)', async () => {
  const p = await readyPhone();
  p.net.catalogDown = true;
  const a = await p.Bible.installFromBytes(namedUsfm('King James Version'), 'kjv.zip');
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.name, 'King James Version', 'with the lists down the label cannot be known (offline behaviour)');
  p.net.catalogDown = false;
  const b = await p.Bible.installFromBytes(namedUsfm('American Standard Version'), 'asv.zip');
  assert.equal(b.name, 'American Standard Version (from a file)', 'the failed read was remembered for the whole session: ' + b.name);
});

test('RELAUNCH 12 — a failed eBible-mirror read is NOT remembered either: a later install of a mirror name is labelled (N3)', async () => {
  const p = await readyPhone();
  p.net.catalogDown = 'mirror';
  const a = await p.Bible.installFromBytes(namedUsfm('Abureni NT Portions'), 'a.zip');
  assert.equal(a.name, 'Abureni NT Portions', 'with the mirror list down the label cannot be known');
  p.net.catalogDown = false;
  const b = await p.Bible.installFromBytes(namedUsfm('God so Sokior-ok Iwon'), 'b.zip');
  assert.equal(b.name, 'God so Sokior-ok Iwon (from a file)', 'the failed mirror read was remembered for the whole session: ' + b.name);
});
