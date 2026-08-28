// A CHURCH THAT SWITCHES MEMBER PHOTOS OFF MUST ACTUALLY GET WHAT IT ASKED FOR.
// Run: node --test scripts/church-photos-off-means-off.test.mjs
//
// The relay gate landed first and the client did not know about it, which broke two things at once.
//
//   Publishing. setProfile carries the PREVIOUS photo into every kind-0 it writes. After the switch, a name
//   change — or the hide-me-from-the-directory toggle — still carried the forbidden photo, so the relay
//   refused the whole event. The app toasted "Profile saved", kept the change on the phone, and told nobody:
//   Margaret's new surname shows on her phone for ever and the old one shows to the church for ever.
//
//   Rendering. Switching photos off stopped NEW photos and uncovered none of the old ones, while the console
//   said "colour, initial or symbol only" — a protection a church is shown and does not have.
//
// One rule, both doors: a photo this church forbids is not published and not rendered. These tests EXECUTE
// the functions lifted out of vendor/fellowship.js — the file the app actually loads — rather than a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripComments } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const SRC    = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');

// ── lift the real code out of the shipped bundle and run it ──
function lift(name, kind = 'function') {
  const re = kind === 'function'
    ? new RegExp('\\n  function ' + name + '\\([\\s\\S]*?\\n  \\}')
    : new RegExp('\\n  (?:var|let|const) ' + name + ' = [\\s\\S]*?;');
  const m = re.exec(BUNDLE);
  assert.ok(m, `could not lift ${name} from vendor/fellowship.js — re-anchor this test, do not delete it`);
  return m[0];
}

function harness() {
  const ctx = { events: [], window: { dispatchEvent(e) { ctx.events.push(e); } }, CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } } };
  vm.createContext(ctx);
  vm.runInContext([
    lift('AV_SYMBOLS', 'var'),
    lift('hashStr'),
    lift('normPub', 'var'),
    lift('isPhotoSuppressed'),
    lift('suppressPhotoAv'),
    lift('_photosOffChurches', 'var'),
    'let _noPhoto = new Set();',
    lift('_notePhotoPolicy'),
    lift('_churchPhotosOff'),
    lift('_stripPhoto'),
    lift('_avSuppressPhoto'),
    'this.api = { _notePhotoPolicy, _churchPhotosOff, _avSuppressPhoto, _photosOffChurches, setNoPhoto: (s) => { _noPhoto = s; } };',
  ].join('\n'), ctx);
  return ctx.api;
}

const CHURCH = 'aa'.repeat(32);
const OTHER  = 'bb'.repeat(32);
const MEMBER = 'cc'.repeat(32);
const PHOTO  = { kind: 'photo', photo: 'data:image/jpeg;base64,AAAA', color: '#c33' };

test('with photos allowed, a photograph is left exactly alone', () => {
  const a = harness();
  a._notePhotoPolicy(CHURCH, { features: { memberPhotos: true } });
  assert.equal(a._avSuppressPhoto(MEMBER, PHOTO), PHOTO, 'a permissive church had its members’ photos stripped');
});

test('a church that never mentioned photos still allows them', () => {
  // A brand-new church has no features object at all. Reading absent as "off" would silently strip every
  // photo in every church that had not touched the setting.
  const a = harness();
  a._notePhotoPolicy(CHURCH, {});
  a._notePhotoPolicy(OTHER, { features: {} });
  assert.equal(a._avSuppressPhoto(MEMBER, PHOTO), PHOTO);
  assert.equal(a._churchPhotosOff(), false);
});

test('photos off: a photograph already published stops being rendered', () => {
  // THE RETENTION HALF. Nothing is deleted from the relay — but this church's app stops showing it, which is
  // what the console promised. Without this, every photo taken before the switch stayed on screen for ever.
  const a = harness();
  a._notePhotoPolicy(CHURCH, { features: { memberPhotos: false } });
  const out = a._avSuppressPhoto(MEMBER, PHOTO);
  assert.equal(out.kind, 'symbol', 'the photograph is still being rendered after the church switched photos off');
  assert.ok(out.symbol, 'it fell back to no mark at all rather than the member’s symbol');
  assert.equal(out.color, PHOTO.color, 'the member’s chosen colour was thrown away with the photo');
});

test('strictest church wins — one permissive church does not undo another’s decision', () => {
  // Exactly how the relay scopes it. Belonging to a church that allows photos must not reopen the door in
  // the church that closed it.
  const a = harness();
  a._notePhotoPolicy(CHURCH, { features: { memberPhotos: false } });
  a._notePhotoPolicy(OTHER,  { features: { memberPhotos: true } });
  assert.equal(a._avSuppressPhoto(MEMBER, PHOTO).kind, 'symbol');
});

test('switching photos back ON restores them', () => {
  const a = harness();
  a._notePhotoPolicy(CHURCH, { features: { memberPhotos: false } });
  assert.equal(a._avSuppressPhoto(MEMBER, PHOTO).kind, 'symbol');
  a._notePhotoPolicy(CHURCH, { features: { memberPhotos: true } });
  assert.equal(a._avSuppressPhoto(MEMBER, PHOTO), PHOTO,
    'the church turned photos back on and the app went on hiding them — a one-way switch');
});

test('flipping the switch repaints what is already on screen', () => {
  // Without the event the avatars on the current screen keep the old answer until the member navigates away,
  // which reads as the setting not working.
  const ctx = { events: [], window: { dispatchEvent(e) { ctx.events.push(e); } } };
  const a = harness();
  // count via the real module's own window: re-lift with a recording window
  const src = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
  assert.match(src.slice(src.indexOf('function _notePhotoPolicy')).slice(0, 700), /dispatchEvent/,
    'nothing tells the screen to repaint when a steward flips the switch');
  a._notePhotoPolicy(CHURCH, { features: { memberPhotos: false } });   // exercises the path
});

test('the per-account suppression list still works alongside it', () => {
  // A steward resetting ONE member's photo is a different control and must not be broken by the church-wide one.
  const a = harness();
  a.setNoPhoto(new Set([MEMBER]));
  a._notePhotoPolicy(CHURCH, { features: { memberPhotos: true } });
  assert.equal(a._avSuppressPhoto(MEMBER, PHOTO).kind, 'symbol', 'the per-account photo reset stopped working');
  assert.equal(a._avSuppressPhoto(OTHER, PHOTO), PHOTO, 'it suppressed someone who was not on the list');
});

// ── the publish door ──

test('setProfile drops a forbidden photo BEFORE the profile is stringified', () => {
  // Order is the whole bug. Stripping after the body is built publishes the photo anyway and the relay
  // refuses the event — which is the silent-failed-save this fix exists to end.
  const i = SRC.search(/\n  async setProfile\(/);
  assert.ok(i > 0, 're-anchor: setProfile is gone');
  const fn = stripComments(SRC.slice(i, SRC.indexOf('requestProfiles(pubkeys)', i)));
  const strip = fn.indexOf('_churchPhotosOff()');
  const body  = fn.indexOf('JSON.stringify(wire)');
  assert.ok(strip > 0, 'setProfile still carries the previous photo into every profile update, so once a ' +
    'church switches photos off the relay refuses the whole event and the member’s name change is lost');
  assert.ok(body > 0, 're-anchor: the profile body is no longer built with JSON.stringify(wire)');
  assert.ok(strip < body, 'the photo is stripped AFTER the published body is built, so the photo still goes out');
});

test('both fields the relay inspects are cleared, not just one', () => {
  // scripts/gateway.mjs:_profileHasPhoto refuses on EITHER a photo `av` or a non-empty `picture`. Clearing
  // one and leaving the other means the event is still refused and nothing has been fixed.
  const i = SRC.search(/\n  async setProfile\(/);
  assert.ok(i > 0, 're-anchor: setProfile is gone');
  const fn = stripComments(SRC.slice(i, SRC.indexOf('requestProfiles(pubkeys)', i)));
  const line = fn.slice(fn.indexOf('_churchPhotosOff()'), fn.indexOf('_churchPhotosOff()') + 200);
  assert.match(line, /p\.picture = ''/, 'the `picture` field still carries the photo, so the relay still refuses');
  assert.match(line, /_stripPhoto\(/, 'the `av` field still carries the photo, so the relay still refuses');
});

test('the member is told why their photograph vanished', () => {
  const ID = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
  assert.match(ID, /doesn’t use photographs/,
    'a member who had a photo watches it disappear with no explanation, which reads as the app losing it');
});

test('the shipped bundle carries the whole rule', () => {
  assert.match(BUNDLE, /_churchPhotosOff/, 'vendor/fellowship.js predates this fix — run: npm run build:fellowship');
  assert.ok(BUNDLE.includes('memberPhotos === false'), 'the policy read did not make it into the bundle');
});
