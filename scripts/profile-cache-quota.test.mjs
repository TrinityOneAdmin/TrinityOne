// A BIG CHURCH MUST NOT LOSE ITS WHOLE PROFILE CACHE. Run: node --test scripts/profile-cache-quota.test.mjs
//
// THE DEFECT (Fable verification audit, 2026-08-10). Member avatars live INSIDE the cached profile as a
// data: URI — deliberately, because a remote image URL would beacon every member's IP to whoever hosts it.
// At the app's own 256px WebP that is roughly 9 KB each, so this one localStorage key passes the browser's
// ~5 MB per-origin limit at about 540 members who have set a photo. (The audit said ~500; measured, 500
// members is ~4.5 MB and still fits. The threshold is real, just slightly further out, and it arrives
// sooner for a church whose members upload larger pictures.)
//
// The write was `try { setItem(...) } catch {}`. Over the limit setItem throws, the catch swallows it, and
// NOTHING persists — not the photos, and not the names either. Every launch then refetches every member's
// profile over the network, silently, for ever. For a congregation on a thin or metered connection — the
// churches this product exists for — that is the most expensive possible failure, and nothing reports it.
//
// The fix sheds the expendable part instead of losing everything: names, handles and "about" are tiny and are
// what make a roster readable offline; photos are decoration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// Drive the shipped saveProfiles against a fake localStorage with a real byte limit.
function rig({ quota = 5 * 1024 * 1024, members = 500, avatarKB = 9 } = {}) {
  const pick = (name) => {
    const at = SRC.indexOf(name);
    assert.notEqual(at, -1, name + ' is gone — re-anchor this test');
    let depth = 0;
    for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
      if (SRC[i] === '{') depth++;
      else if (SRC[i] === '}' && --depth === 0) return SRC.slice(at, i + 1);
    }
    assert.fail('could not find the end of ' + name);
  };
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      const s = String(v);
      if (s.length > quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      store.set(k, s);
    },
  };
  const profiles = {};
  for (let i = 0; i < members; i++) {
    profiles['ab'.repeat(31) + i.toString(16).padStart(2, '0')] = {
      name: 'Member ' + i, about: '', nip05: '',
      picture: 'data:image/webp;base64,' + 'A'.repeat(avatarKB * 1024),
    };
  }
  const warnings = [];
  const scope = {
    PROFILES_KEY: 'trinityone.profiles',
    localStorage, profiles,
    _mayCache: () => true,
    console: { warn: (...a) => warnings.push(a.join(' ')) },
    setTimeout: (fn) => { fn(); return 1; },       // run the debounce immediately
  };
  const names = Object.keys(scope);
  const body = pick('function _writeProfiles(obj)') + '\nlet _profShedWarned = false;\nlet _profSaveT = null;\n' + pick('function saveProfiles()');
  const api = new Function(...names, body + '\nreturn { saveProfiles };')(...names.map(n => scope[n]));
  return { ...api, store, warnings, profiles };
}

const parse = (r) => JSON.parse(r.store.get('trinityone.profiles') || '{}');

test('a small church caches everything, photos included', () => {
  const r = rig({ members: 100 });
  r.saveProfiles();
  const got = parse(r);
  assert.equal(Object.keys(got).length, 100);
  assert.ok(got[Object.keys(got)[0]].picture.length > 100, 'photos were dropped when they comfortably fit');
  assert.deepEqual(r.warnings, [], 'a cache that fits should not be warning about anything');
});

test('a big church keeps every NAME even when the photos will not fit', () => {
  const r = rig({ members: 800 });
  r.saveProfiles();
  const got = parse(r);
  assert.equal(Object.keys(got).length, 800,
    'THE BUG: over the limit the write threw, the catch swallowed it and NOTHING was stored — so every ' +
    'launch refetches all 800 profiles over the network, silently, for ever');
  assert.equal(got[Object.keys(got)[0]].picture, '', 'photos should be the part that is shed, not the names');
  assert.ok(got[Object.keys(got)[0]].name, 'the name — the part that makes a roster readable — was lost');
});

test('the shed is reported, not silent', () => {
  const r = rig({ members: 800 });
  r.saveProfiles();
  assert.ok(r.warnings.some(w => /photos/i.test(w)),
    'the cache quietly stopped storing photos with nothing said. Silence is what hid this for months');
});

test('a church too big even for names keeps the most recent rather than nothing', () => {
  const r = rig({ members: 4000, quota: 300 * 1024 });
  r.saveProfiles();
  const got = parse(r);
  assert.ok(Object.keys(got).length > 0,
    'nothing at all was persisted, which is the original failure by another route — a partial roster beats ' +
    'a cold start on every launch');
  assert.ok(Object.keys(got).length < 4000, 'the trim did not actually trim');
  assert.ok(r.warnings.some(w => /most recent/i.test(w)), 'the trim was not reported');
});

test('the shipped bundle carries it', () => {
  assert.match(VENDOR, /_writeProfiles/,
    'vendor/fellowship.js predates this fix, so the app still loses the whole cache — run npm run build:bundles');
});
