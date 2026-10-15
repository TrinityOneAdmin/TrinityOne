// ORIGINAL-LANGUAGE TEXT (D10, phase 1a): the Greek NT + Hebrew OT modules and the engine that serves them.
// Run: node --test scripts/original-language-modules.test.mjs
//
// Chain asserted, each link on the REAL thing:
//   1. scripts/build-original.mjs over lines copied verbatim from STEPBible's TAGNT / TAHOT (real columns, a
//      Byzantine-only word that must be dropped, a "Psa.3.0(3.1)" double reference, a Qere word).
//   2. The modules that SHIP (modules/original-*.json) carry the right words for John 1:1 and Genesis 1:1 and
//      match the sha256 the catalogue pins.
//   3. The WHOLE engine.js is executed (vm) and its real installModule downloads the shipped file (fetch is the
//      only stub; the bytes and the catalogue entry are the real ones), verifies the pin, caches it, and
//      window.Bible.getOriginal — the function the reader will call — answers from it. Removal empties it.
//
// NOT PROVED HERE: the reader wiring (phase 1b, the Define sheet) is proved in original-language-reaches-the-reader.test.mjs;
// not on a device; IndexedDB is an in-memory Map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { build, parseLine, BOOK_NUM } from './build-original.mjs';

const J = x => JSON.parse(JSON.stringify(x));   // vm arrays are another realm's; compare as plain data
const N = s => s.normalize('NFC');
const ROOT = new URL('../', import.meta.url).pathname;
const CATALOG = JSON.parse(readFileSync(ROOT + 'catalog.json', 'utf8'));
const ITEMS = Object.fromEntries(CATALOG.categories.flatMap(c => c.items).filter(i => i.kind === 'original').map(i => [i.id, i]));

// ── lines copied from the real files (tab-separated; trailing empty columns trimmed) ───────────────────────
const TAGNT = [
  '# a header line that must be ignored',
  'Jhn.1.1#01=NKO\tἘν (En)\tIn [the]\tG1722=PREP\tἐν=in/on/among\tNA28+NA27+Tyn+SBL+WH+Treg+TR+Byz\t\t\tEn\tin\t#01\tG1722',
  'Jhn.1.1#02=NKO\tἀρχῇ (archēa)\tbeginning\tG0746=N-DSF\tἀρχή=beginning\tNA28+NA27+Tyn+SBL+WH+Treg+TR+Byz\t\t\tprincipio\tbeginning\t#02\tG0746',
  'Jhn.1.1#03=NKO\tἦν (ēn)\twas\tG1510=V-IAI-3S\tεἰμί=to be\tNA28+NA27+Tyn+SBL+WH+Treg+TR+Byz\t\t\testaba siendo\tto be\t#03\tG1510_A\tG2258',
  'Jhn.1.1#05=NKO\tλόγος, (logos)\tWord,\tG3056=N-NSM\tλόγος=word\tNA28+NA27+Tyn+SBL+WH+Treg+TR+Byz\t\t\tPalabra\tword\t#05\tG3056_A',
  'Jhn.1.1#06=NKO\tλόγος (logos)\tWord\tG3056=N-NSM\tλόγος=word\tNA28+NA27+Tyn+SBL+WH+Treg+TR+Byz\t\t\tPalabra\tword\t#08\tG3056_B',
  'Jhn.1.1#07=K\tτοῦ (tou)\tof the\tG3588=T-GSM\tὁ=the\tByz\t\t\tdel\tof the\t#07\tG3588',   // Byzantine-only: not in the critical text
  'Rev.22.21#01=NKO\tἡ (hē)\tthe\tG3588=T-NSF\tὁ=the\tNA28\t\t\tla\tthe\t#01\tG3588',
].join('\n');
const TAHOT = [
  '# Gen.1.1\tbe.re.Shit (בְּרֵאשִׁ֖ית)',
  'Gen.1.1#01=L\tבְּ/רֵאשִׁ֖ית\tbe./re.Shit\tin/ beginning\tH9003/{H7225G}\tHR/Ncfsa\t\t\tH7225G\t\tH9003=ב=in/{H7225G=רֵאשִׁית=: beginning»first:1_beginning}',
  'Gen.1.1#02=L\tבָּרָ֣א\tba.Ra\'\the created\t{H1254A}\tHVqp3ms\t\t\tH1254A\t\t{H1254A=בָּרָא=to create}',
  'Gen.1.1#03=L\tאֱלֹהִ֑ים\t\'E.lo.Him\tGod\t{H0430G}\tHNcmpa\t\t\tH0430G\t\t{H0430G=אֱלֹהִים=God}',
  'Gen.1.1#04=K\tשגגג\tx\tKetiv only\t{H0001}\tHNcmsa',   // Ketiv-only word: dropped
  'Psa.3.0(3.1)#01=L\tמִזְמ֥וֹר\tmiz.Mor\ta psalm\t{H4210}\tHNcmsc',   // English ref first, Hebrew ref in brackets
  'Psa.3.1(3.2)#01=Q(K)\tיְהוָ֣ה\tYah.weh\tLORD\t{H3068G}\tHNpt',
].join('\n');

test('BUILD (Greek): the right words for John 1:1, in order, critical text only, keyed by TrinityOne book number', () => {
  const m = build('greek', [TAGNT]);
  assert.deepEqual(m.meta, { abbr: 'TAGNT', name: m.meta.name, lang: 'greek', license: 'STEPBible.org CC BY', kind: 'original', source: m.meta.source });
  assert.equal(BOOK_NUM.Jhn, 43);
  assert.deepEqual(m.v['43.1.1'], [
    ['Ἐν', 'En', 'G1722', 'PREP', 'In the'], ['ἀρχῇ', 'archēa', 'G0746', 'N-DSF', 'beginning'], ['ἦν', 'ēn', 'G1510', 'V-IAI-3S', 'was'],
    ['λόγος,', 'logos', 'G3056', 'N-NSM', 'Word,'], ['λόγος', 'logos', 'G3056', 'N-NSM', 'Word']]);
  assert.deepEqual(m.v['66.22.21'], [['ἡ', 'hē', 'G3588', 'T-NSF', 'the']], 'Revelation must be book 66');
  assert.deepEqual(Object.keys(m.v).sort(), ['43.1.1', '66.22.21']);
});

test('BUILD (Hebrew): Genesis 1:1, separators removed, braces pick the head word, Ketiv-only dropped, English ref wins', () => {
  const m = build('hebrew', [TAHOT]);
  assert.equal(m.meta.lang, 'hebrew');
  assert.deepEqual(m.v['1.1.1'], [
    ['בְּרֵאשִׁית', 'be.re.Shit', 'H7225G', 'HR/Ncfsa', 'in beginning'], ['בָּרָא', "ba.Ra'", 'H1254A', 'HVqp3ms', 'he created'], ['אֱלֹהִים', "'E.lo.Him", 'H0430G', 'HNcmpa', 'God']]);
  assert.deepEqual(m.v['19.3.0'].map(w => w[2]), ['H4210'], 'Psa.3.0(3.1) must be filed under the English reference 3.0');
  assert.deepEqual(m.v['19.3.1'].map(w => w[2]), ['H3068G'], 'a Qere word is a reading word');
  assert.equal(parseLine('Gen.1.1#04=K\tx\tx\tx\t{H0001}\tHN', 'hebrew'), null);
});

// ── the files that ship ───────────────────────────────────────────────────────────────────────────────────
const SHIPPED = {
  greek: JSON.parse(readFileSync(ROOT + 'modules/original-greek.json', 'utf8')),
  hebrew: JSON.parse(readFileSync(ROOT + 'modules/original-hebrew.json', 'utf8')),
};
test('SHIPPED modules: John 1:1 / Genesis 1:1 are right, every key is a TrinityOne verse id in the right testament, and the catalogue pins the bytes', () => {
  assert.equal(SHIPPED.greek.v['43.1.1'].map(w => w[0]).join(' ').normalize('NFC'), 'Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν, καὶ θεὸς ἦν ὁ λόγος.'.normalize('NFC'));
  assert.equal(SHIPPED.hebrew.v['1.1.1'][0][2], 'H7225G');
  assert.equal(SHIPPED.hebrew.v['1.1.1'].length, 7);
  for (const [lang, lo, hi] of [['greek', 40, 66], ['hebrew', 1, 39]]) {
    const mod = SHIPPED[lang];
    assert.equal(mod.meta.kind, 'original'); assert.equal(mod.meta.lang, lang); assert.equal(mod.meta.license, 'STEPBible.org CC BY');
    for (const k in mod.v) {
      const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(k);
      assert.ok(m && +m[1] >= lo && +m[1] <= hi, `${lang}: bad verse key ${k}`);
      assert.ok(mod.v[k].every(w => w.length === 5 && w[0] && w[2]), `${lang} ${k}: malformed word`);
    }
  }
  assert.ok(Object.keys(SHIPPED.greek.v).length > 7800, 'the Greek NT should have ~7,900 verses');
  assert.ok(Object.keys(SHIPPED.hebrew.v).length > 23000, 'the Hebrew OT should have ~23,200 verses');
  for (const [id, file] of [['original-greek', 'original-greek.json'], ['original-hebrew', 'original-hebrew.json']]) {
    const it = ITEMS[id];
    assert.ok(it, `catalog.json has no ${id}`);
    assert.equal(it.format, 'JSON'); assert.equal(it.url, 'modules/' + file);
    assert.equal(it.sha256, createHash('sha256').update(readFileSync(ROOT + 'modules/' + file)).digest('hex'), `${id}: the catalogue pin is not the shipped file's hash`);
  }
});

// ── the real engine.js, whole ────────────────────────────────────────────────────────────────────────────
function phone(prev) {   // `prev` = a previous phone: the same storage, i.e. a relaunch
  const stores = prev ? prev.stores : new Map();   // key -> bytes: an in-memory IndexedDB, nothing more
  const ls = prev ? prev.ls : new Map();
  const req = () => ({});
  const settle = (r, v) => { setTimeout(() => { r.result = v; r.onsuccess && r.onsuccess(); }, 0); return r; };
  const indexedDB = { open() {
    const r = req();
    r.result = { createObjectStore() {}, transaction() {
      const tx = {};
      const done = () => setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
      tx.objectStore = () => ({
        transaction: tx,
        get: k => { const q = settle(req(), stores.get(k)); done(); return q; },
        put: (v, k) => { stores.set(k, v); const q = settle(req(), k); done(); return q; },
        delete: k => { stores.delete(k); const q = settle(req(), undefined); done(); return q; },
        getAllKeys: () => { const q = settle(req(), [...stores.keys()]); done(); return q; },
        count: k => { const q = settle(req(), stores.has(k) ? 1 : 0); done(); return q; },
      });
      return tx;
    } };
    setTimeout(() => { r.onupgradeneeded && r.onupgradeneeded(); r.onsuccess && r.onsuccess(); }, 0);
    return r;
  } };
  const fetched = [];
  const win = { addEventListener() {}, removeEventListener() {}, location: { search: '', href: 'http://localhost/' } };
  const ctx = vm.createContext({
    window: win, indexedDB, crypto: webcrypto, console, setTimeout, clearTimeout, TextDecoder, TextEncoder, URL, URLSearchParams,
    Uint8Array, Promise, Response, AbortController, DOMException,
    location: win.location, navigator: undefined,
    document: { addEventListener() {}, createElement: () => ({}), readyState: 'complete' },
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) },
    // the ONE stub: the network. It serves the real shipped files at the url the catalogue names.
    fetch: async u => {
      fetched.push(String(u));
      const rel = String(u).replace(/^.*?(modules\/[^?#]+).*$/, '$1');
      // only the original-language files exist here; the engine's own boot also asks for the default Bible, which 404s
      if (!/original-/.test(rel)) return new Response('nope', { status: 404 });
      try { return new Response(readFileSync(ROOT + rel)); } catch { return new Response('nope', { status: 404 }); }
    },
  });
  vm.runInContext(readFileSync(ROOT + 'engine.js', 'utf8'), ctx, { filename: 'engine.js' });
  return { Bible: win.Bible, stores, ls, fetched };
}

test('ENGINE: nothing installed -> getOriginal is [] and nothing is fetched on its own (on demand, never a default)', async () => {
  const p = phone();
  assert.equal(typeof p.Bible.getOriginal, 'function');
  assert.deepEqual(J(p.Bible.getOriginal(43, 1, 1)), []);
  assert.equal(p.Bible.hasOriginal(), false);
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(p.fetched.filter(u => /original-/.test(u)), [], 'merely asking must not download an original-language module');
});

test('ENGINE: install through the real installModule -> window.Bible.getOriginal answers John 1:1 / Genesis 1:1; Strong\'s filter; remove empties it', async () => {
  const p = phone();
  await p.Bible.installModule(ITEMS['original-greek']);
  await p.Bible.installModule(ITEMS['original-hebrew']);
  assert.ok(p.stores.has('modules/original-greek.json'), 'the verified bytes should be cached for offline use');
  const rec = p.Bible.installedMap()['modules/original-greek.json'];
  assert.equal(rec.kind, 'original'); assert.equal(rec.category, 'dictionaries', 'filed with the dictionaries so the Library lists and removes it');

  const john = p.Bible.getOriginal(43, 1, 1);
  assert.equal(john.length, 17);
  assert.deepEqual(J(john[4]), { w: N('λόγος,'), t: 'logos', s: 'G3056', m: 'N-NSM', g: 'Word,' });
  assert.deepEqual(J(p.Bible.getOriginal(1, 1, 1)).map(x => x.s), ['H7225G', 'H1254A', 'H0430G', 'H0853', 'H8064', 'H0853', 'H0776G']);
  // verse + Strong's: the plain lexicon number, the extended one, and a different-letter variant all find the same word
  for (const q of ['G3056', 'G03056', 'g3056']) assert.equal(p.Bible.getOriginal(43, 1, 1, 'greek', q).length, 3, q);
  assert.deepEqual(J(p.Bible.getOriginal(1, 1, 1, 'hebrew', 'H7225')).map(x => x.w), [N('בְּרֵאשִׁית')]);
  assert.deepEqual(J(p.Bible.getOriginal(1, 1, 1, 'greek')), [], 'the language filter must not answer a Hebrew verse from Greek');
  assert.deepEqual(J(p.Bible.getOriginal(43, 1, 1, 'greek', 'G9999')), []);
  assert.deepEqual(J(p.Bible.getOriginal(1, 999, 1)), [], 'a verse the text does not have');
  assert.deepEqual(J(p.Bible.originalList()).map(x => x.lang).sort(), ['greek', 'hebrew']);

  await p.Bible.removeModule('modules/original-greek.json');
  assert.deepEqual(J(p.Bible.getOriginal(43, 1, 1)), [], 'removed, and still answering');
  assert.equal(p.stores.has('modules/original-greek.json'), false, 'bytes still on the phone');
  assert.equal(p.Bible.getOriginal(1, 1, 1).length, 7, 'removing Greek must not take Hebrew with it');
});

test('ENGINE: a relaunch reloads an installed original module from the cache, without the network', async () => {
  const p = phone();
  await p.Bible.installModule(ITEMS['original-greek']);
  const q = phone(p);   // same IndexedDB + localStorage, fresh engine: the engine's own boot restores what is installed
  for (let i = 0; i < 100 && !q.Bible.hasOriginal('greek'); i++) await new Promise(r => setTimeout(r, 50));
  assert.equal(q.Bible.getOriginal(43, 1, 1).length, 17, 'the module did not come back after a relaunch');
  assert.deepEqual(q.fetched.filter(u => /original-/.test(u)), [], 'restoring should read the cache, not the network');
});
