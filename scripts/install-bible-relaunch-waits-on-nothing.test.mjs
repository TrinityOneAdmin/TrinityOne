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
