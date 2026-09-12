// A CHILD'S NAME SURVIVES THE SQUARE — THE ONE TRANSPORT THIS DESIGN INTRODUCES, DRIVEN END TO END.
// Run: node --test scripts/a-childs-name-survives-the-square.test.mjs
//
// §3b of reference/PLAN-CHECKIN-NO-TYPING-2026-09-11.md moves the children's names OFF the relay and onto an
// optical channel: "if the QR carries the children's names optically, the names never travel through the
// relay at all." That channel is the whole novelty of the design, and on 2026-09-12 it was the only part of
// it with NO coverage — every one of the ten `qrSVG` references across scripts/*.test.mjs is a stub that
// captures the text and returns a fixed string, so ten tests asserted about a square nobody had ever drawn.
// "A stub answers the question", verbatim.
//
// WHAT IT HID. qrcode-generator's default `stringToBytes` is `charCodeAt(i) & 0xff` — one lossy byte per
// UTF-16 code unit — while jsQR reads byte mode as UTF-8:
//
//     Milo -> 4d 69 6c 6f   "Milo"          ASCII survives; the two encoders agree below U+0080
//     Zoë  -> 5a 6f eb      decodes to ''   U+0080-U+00FF encodes, then fails the decoder's UTF-8 pass
//     安安  -> 89 89         decodes to ''   above U+00FF the character is GONE at ENCODE time
//     Даша -> 14 30 48 30   "0H0"           …and can come back looking like plausible ASCII
//
// So a parent typing "Zoë" got a square every worker's phone reported as "That isn't a check-in code", with
// no way to know. It failed SAFE — the typed path is untouched and no child is kept out of a room — but
// reference/DOMAIN.md and the persecuted-church-first positioning make non-ASCII the AUDIENCE rather than an
// edge case, so a feature that works only for ASCII names is a feature that does not work.
//
// ⚠ EVERYTHING BELOW IS SHIPPED CODE. The encoder is window.TrinityIdentity.qrSVG out of vendor/identity.js,
// the decoder is vendor/jsqr.js — the same file app/ui.jsx's ensureJsQR() fetches onto a phone — and the
// payload builder and parser are lifted out of vendor/fellowship.js. The only thing this file supplies is
// the bitmap between the two, which a camera supplies on a phone.
//
// NO RELAY AND NO PORT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { fnBody } from './test-slice.mjs';

const require_ = createRequire(import.meta.url);
const jsQR = require_('../vendor/jsqr.js');
assert.equal(typeof jsQR, 'function', 're-anchor: vendor/jsqr.js did not export a decoder');

// ── THE SHIPPED ENCODER ───────────────────────────────────────────────────────────────────────────────────
// vendor/identity.js is a browser bundle, so it gets a browser-shaped context and is run whole. `init()`
// fails in here (no CustomEvent, no real DOM) and is caught by the bundle's own `.catch`; nothing this file
// touches depends on it. Lifting qrSVG alone would mean re-supplying the bundler's `qrcode` singleton, which
// is precisely the object whose configuration is under test.
const qrSVG = (() => {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    crypto: webcrypto, TextEncoder, TextDecoder, URL,
    fetch: async () => ({ ok: false }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, setAttribute() {} }),
      head: { appendChild() {} }, body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} },
    navigator: { userAgent: '' }, location: { href: 'http://localhost/' },
    CustomEvent: function CustomEvent() {},
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../vendor/identity.js', import.meta.url), 'utf8'), ctx);
  assert.equal(typeof (ctx.TrinityIdentity || {}).qrSVG, 'function',
    'window.TrinityIdentity.qrSVG is not in vendor/identity.js — did build:bundles run? re-anchor, do not delete');
  return ctx.TrinityIdentity.qrSVG;
})();

// ── THE BITMAP A CAMERA WOULD SEE ─────────────────────────────────────────────────────────────────────────
// qrSVG emits `cellSize: 4, margin: 2` as one `M<x>,<y>l4,0 0,4 -4,0 0,-4z` path segment per DARK module on a
// white ground. Painted at four device pixels per SVG unit, which is roughly what a phone hands jsQR.
const SCALE = 4;
function decode(svg) {
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  assert.ok(vb, 'the shipped qrSVG no longer emits a viewBox — re-anchor this rasteriser');
  const w = Number(vb[1]) * SCALE;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  let dark = 0;
  for (const m of svg.matchAll(/M(\d+),(\d+)l4,0 0,4 -4,0 0,-4z/g)) {
    dark++;
    const x = Number(m[1]) * SCALE, y = Number(m[2]) * SCALE;
    for (let dy = 0; dy < 4 * SCALE; dy++) {
      for (let dx = 0; dx < 4 * SCALE; dx++) {
        const i = (((y + dy) * w) + (x + dx)) * 4;
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
      }
    }
  }
  // A RASTERISER THAT PAINTED NOTHING WOULD MAKE EVERY ASSERTION BELOW VACUOUS, and it would look exactly
  // like a decode failure. A version-1 symbol has 441 modules, so anything under a hundred dark ones means
  // the path syntax moved and this file is measuring a blank page.
  assert.ok(dark > 100, 'the rasteriser found ' + dark + ' dark modules — the SVG path shape changed, re-anchor it');
  const r = jsQR(data, w, w);
  return r ? r.data : null;
}

// ── THE SHIPPED PAYLOAD BUILDER AND PARSER ────────────────────────────────────────────────────────────────
const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const { buildArrivalQR, parseArrivalQR } = (() => {
  const start = FELLOWSHIP.indexOf('var MYKIDS_MAX =');
  assert.notEqual(start, -1, 'the parent-side engine is not in the bundle — did build:fellowship run?');
  const src = FELLOWSHIP.slice(start, FELLOWSHIP.indexOf('function arrivalSessionNow(', start))
    + fnBody(FELLOWSHIP, 'function buildArrivalQR(myPub, names) {', 'buildArrivalQR')
    + '\n' + fnBody(FELLOWSHIP, 'function parseArrivalQR(text) {', 'parseArrivalQR');
  return new Function(src + '\nreturn { buildArrivalQR, parseArrivalQR };')();
})();

const ME = 'a'.repeat(64);

// THE NAMES. Not decoration: every one of these is a name a child in a church this product is built for
// actually has, and every one was measured decoding to the EMPTY STRING before 2026-09-12.
const NAMES = [
  ['Latin-1, the half that encodes and then fails to decode', ['Zoë', 'José', 'Müller', 'Ngô', 'Trần']],
  ['Arabic, right to left', ['مریم', 'علی']],
  ['Han', ['安安', '李明']],
  ['Cyrillic', ['Даша', 'Ольга']],
  ['Devanagari', ['आरव']],
  ['Greek', ['Δημήτρης']],
  ['Hebrew', ['נועם']],
  ['above the basic plane — a surrogate pair', ['Milo 🙂']],
  ['and plain ASCII, which must not have regressed', ['Milo', 'Ivy']],
];

for (const [what, names] of NAMES) {
  test('a name in ' + what + ' survives the square', () => {
    for (const n of names) {
      const out = decode(qrSVG(n));
      assert.equal(out, n,
        'THE NAME DID NOT SURVIVE THE QR. Typed ' + JSON.stringify(n) + ', decoded ' + JSON.stringify(out) +
        '. A parent holds this square up at a door and every worker’s phone says "that isn’t a check-in code".');
    }
  });
}

test('THE WHOLE PAYLOAD ROUND-TRIPS — built, drawn, decoded, parsed, identical', () => {
  // The end-to-end claim, through four pieces of shipped code and nothing of this file's own but the bitmap.
  const kids = ['Zoë', '安安', 'Даша', 'مریم'];
  const text = buildArrivalQR(ME, kids);
  assert.ok(text, 're-anchor: the shipped builder produced no payload');
  const back = decode(qrSVG(text));
  assert.equal(back, text, 'the payload did not survive the square: ' + JSON.stringify(back));
  const parsed = parseArrivalQR(back);
  assert.ok(parsed, 'THE SHIPPED PARSER REFUSED THE SHIPPED ENCODER’S OWN OUTPUT — which is what a worker’s ' +
    'phone does at a door, and it says "that isn’t a check-in code".');
  assert.deepEqual(parsed.c, kids, 'the names changed on the way through: ' + JSON.stringify(parsed.c));
  assert.equal(parsed.g, ME);
});

test('a full family of long non-ASCII names still fits in one square', () => {
  // The caps are twelve names of forty characters. Non-ASCII costs up to four bytes a character, so a payload
  // that fits comfortably in ASCII can stop fitting — and a square that fails to BUILD is the same dead end
  // at a door as one that fails to decode. Measured at the cap rather than assumed.
  const kids = Array.from({ length: 12 }, (_, i) => ('محمد' + i + '安安安安安安安安安安安安安安安安安安安').slice(0, 40));
  const text = buildArrivalQR(ME, kids);
  const back = decode(qrSVG(text));
  assert.equal(back, text, 'a full family of long non-ASCII names did not survive the square');
  assert.deepEqual(parseArrivalQR(back).c, parseArrivalQR(text).c);
});

// ── AND THE FOUR CALLERS THAT CAME BEFORE THIS ONE ────────────────────────────────────────────────────────
test('the encoder change cannot have altered any ASCII payload — the two encoders agree byte for byte', () => {
  // qrSVG had four callers before the children's code: a join URL (app/screens-chat.jsx), a transfer payload
  // and a reseat code (app/identity.jsx, app/identity-extras.jsx) and an invite URL (app/identity.jsx). All
  // ASCII. Rather than asserting that from a reading of them, this compares the two encoders directly: below
  // U+0080 UTF-8 IS the identity map, so for any ASCII string the new byte array is the old one.
  const ctx = { console };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../node_modules/qrcode-generator/qrcode.js', import.meta.url), 'utf8')
    + '\nglobalThis.__q = qrcode;', ctx);
  const q = ctx.__q;
  const dflt = q.stringToBytesFuncs['default'], utf8 = q.stringToBytesFuncs['UTF-8'];
  assert.equal(typeof dflt, 'function');
  assert.equal(typeof utf8, 'function', 'the library no longer ships a UTF-8 encoder — the fix rests on it');
  const shapes = [
    'npub1' + 'qwertyuiop'.repeat(6),
    'trinityone-reseat:npub1' + 'qwertyuiop'.repeat(6),
    'https://app.trinityone.church/join#c=' + 'a'.repeat(64),
    'f'.repeat(64),
    '{"v":1,"g":"' + ME + '","c":["Milo","Ivy"]}',
  ];
  for (const s of shapes) {
    assert.deepEqual(utf8(s), dflt(s),
      'an ASCII payload encodes differently under the UTF-8 encoder: ' + s.slice(0, 40));
    assert.equal(decode(qrSVG(s)), s, 'an existing caller’s payload no longer round-trips: ' + s.slice(0, 40));
  }
});

test('the empty string and a missing argument still produce something rather than throwing', () => {
  // qrSVG is called unguarded in several places. It must not be the thing that blanks a screen.
  for (const v of ['', null, undefined]) {
    assert.doesNotThrow(() => qrSVG(v), 'qrSVG threw on ' + JSON.stringify(v));
  }
});
