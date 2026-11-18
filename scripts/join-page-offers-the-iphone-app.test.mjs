// THE INVITE PAGE OFFERS AN IPHONE THE TESTFLIGHT APP — NOT "ADD TO HOME SCREEN".
// Run: node --test scripts/join-page-offers-the-iphone-app.test.mjs
//
// During the pilot the iPhone app comes through Apple's TestFlight. join.html used to tell an iPhone to
// "Add to Home Screen" and showed no app button and no church code. An invite link does not open the
// iPhone app yet, so the church code shown as text is how an iPhone member joins inside the app.
//
// This RUNS the real join.js against a small DOM (CLAUDE.md rule 3: no text-matching the file), built from
// the element ids join.html actually carries, and reads what a person would see.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const JS = readFileSync(new URL('../join.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../join.html', import.meta.url), 'utf8');
const TF_MEMBER = 'https://testflight.apple.com/join/u5CZnMp9';
const TF_STORE = 'https://apps.apple.com/app/testflight/id899247664';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

// ── a DOM just big enough for join.js ──
class Node_ {
  constructor(tag) { this.tagName = tag; this.children = []; this.parentNode = null; this.attrs = {}; this._text = ''; this.id = ''; this.className = ''; this.href = ''; }
  get classList() { const self = this; return {
    add: (c) => { const s = new Set(self.className.split(/\s+/).filter(Boolean)); s.add(c); self.className = [...s].join(' '); },
    remove: (c) => { self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
    contains: (c) => self.className.split(/\s+/).includes(c),
  }; }
  get textContent() { return this.tagName === '#text' ? this._text : this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = []; this._text = String(v); }
  // innerHTML is kept as raw text so that anything written through it is still SEEN by the assertions.
  set innerHTML(v) { this.children = []; this._text = String(v); this._html = (this._html || '') + String(v); }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  insertBefore(n, ref) { n.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.children.indexOf(this); return p.children[i + 1] || null; }
  *walk() { yield this; for (const c of this.children) yield* c.walk(); }
}
function run(search, ua) {
  const card = new Node_('div');
  const byId = {};
  // The ids and classes join.html carries, read from the file so a renamed id breaks this test.
  for (const m of HTML.matchAll(/<(\w+)\s+class="([^"]*)"\s+id="(\w+)"|<(\w+)\s+id="(\w+)"/g)) {
    const tag = m[1] || m[4], cls = m[2] || '', id = m[3] || m[5];
    const n = new Node_(tag); n.id = id; n.className = cls; byId[id] = n; card.appendChild(n);
  }
  for (const id of ['getApp', 'getAppLabel', 'note', 'openNow']) assert.ok(byId[id], 'precondition: join.html has no #' + id);
  assert.ok(byId.getApp.classList.contains('hide'), 'precondition: the app button starts hidden in join.html');
  const document = {
    getElementById: (id) => { for (const n of card.walk()) if (n.id === id) return n; return null; },
    createElement: (t) => new Node_(t),
    createTextNode: (t) => { const n = new Node_('#text'); n._text = String(t); return n; },
  };
  const real = { document, location: { search }, navigator: { userAgent: ua, platform: '', maxTouchPoints: 0 }, URLSearchParams, RegExp, encodeURIComponent };
  const sandbox = new Proxy(real, { has: () => true, get: (t, k) => (k in t ? t[k] : undefined) });
  new Function('S', 'with(S){' + JS + '}')(sandbox);
  const links = [...card.walk()].filter((n) => n.tagName === 'a' && n.href);
  return { byId, card, text: card.textContent, links };
}
const FOLLOW = 'npub1q3sle0kvfsehgsuexttt3ugjd8xdklxfwwkh559wxckmzddywnws6cd26p';

test('an iPhone is offered the TestFlight app, with the church code to join by', () => {
  const r = run('?follow=' + FOLLOW + '&c=St%20Aidan', UA_IPHONE);
  const getApp = r.byId.getApp;
  assert.ok(!getApp.classList.contains('hide'), 'on an iPhone the app button is still hidden');
  assert.equal(getApp.href, TF_MEMBER, 'the iPhone app button does not go to the member TestFlight link');
  assert.equal(r.byId.getAppLabel.textContent, 'Get the iPhone app', 'the iPhone app button has the wrong label');
  assert.ok(r.links.some((a) => a.href === TF_STORE), 'there is no link to get TestFlight itself from the App Store');
  assert.doesNotMatch(r.text, /Home Screen/i, 'an iPhone is still told to "Add to Home Screen"');
  const code = r.byId.note.parentNode.children.find((n) => n.className === 'joincode');
  assert.ok(code, 'no church code is shown to an iPhone, and an invite link does not open the iPhone app yet');
  assert.ok(code.textContent.includes(FOLLOW), 'the church code shown to an iPhone is not this church');
  assert.ok(r.byId.openNow.href.startsWith('index.html?follow='), '"Open TrinityOne now" no longer opens the web app');
});

test('the church code from the URL is shown as text, never as markup', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const r = run('?follow=' + encodeURIComponent(hostile), UA_IPHONE);
  const code = [...r.card.walk()].find((n) => n.tagName === 'code');
  assert.ok(code, 'precondition: the code element is present');
  assert.equal(code.textContent, hostile, 'the code was not set as plain text');
  for (const n of r.card.walk()) assert.ok(!String(n._html || '').includes('<img'), 'the URL value reached innerHTML');
});

test('Android is unchanged: the .apk button and the lost-link code', () => {
  const r = run('?follow=' + FOLLOW, UA_ANDROID);
  assert.ok(!r.byId.getApp.classList.contains('hide'), 'the Android app button is hidden');
  assert.equal(r.byId.getApp.href, './trinityone.apk', 'the Android button no longer downloads the .apk');
  assert.equal(r.byId.getApp.attrs.download, '', 'the Android button lost its download attribute');
  assert.match(r.text, /Get the Android app/);
  assert.doesNotMatch(r.text, /TestFlight/, 'Android is being sent to TestFlight');
  const code = r.byId.note.parentNode.children.find((n) => n.className === 'joincode');
  assert.ok(code && code.textContent.includes('Lost this link') && code.textContent.includes(FOLLOW), 'the Android lost-link code is gone');
});

// THE 12 WORDS COME BEFORE THE CHURCH. The app's first-run setup asks for them ("Back up your 12 words",
// app/identity.jsx); the invite page says so, marked, before the church code is scanned or pasted.
test('an iPhone is told to write down the 12 words, marked, before pasting or scanning the church code', () => {
  const r = run('?follow=' + FOLLOW, UA_IPHONE);
  const key = [...r.byId.note.walk()].find((n) => n.className === 'key');
  assert.ok(key && /write down your 12 words/i.test(key.textContent), 'the iPhone note has no marked 12-words step');
  const t = r.text;
  assert.ok(t.indexOf('12 words') < t.search(/paste or scan your church code/i) && t.search(/paste or scan/i) >= 0,
    'on an iPhone the 12-words step does not come before pasting or scanning the church code');
});
test('Android is told to write down the 12 words, marked, before it joins', () => {
  const r = run('?follow=' + FOLLOW, UA_ANDROID);
  const t = r.text;
  assert.ok(t.indexOf('you’re in') >= 0, 'the Android note no longer says how joining ends');
  assert.ok(!/you’re joined/.test(t), 'the Android note claims the member is already joined — a church that checks new members must still let them in');
  assert.match(r.byId.note.textContent, /<span class="key">[\s\S]*12 words/, 'the Android note has no marked 12-words step');
  assert.ok(t.indexOf('12 words') < t.indexOf('you’re in'), 'on Android the 12-words step comes after joining');
  assert.ok(t.indexOf('12 words') < t.indexOf('paste this church code'), 'on Android the 12-words step comes after the church code');
});
