// A REQUEST SENT FROM THE FINANCE APP PRE-SELECTS "FINANCE HELPER" ON THE OWNER'S APPROVE SHEET — AND GRANTS NOTHING ITSELF.
//   Run: node --test scripts/a-finance-app-request-preselects-the-finance-preset.test.mjs
//
// T1Finance plan §3.7 + M6. A helper asking from finance.html (window.TRINITY_APP === 'finance') puts app:'finance'
// INSIDE the request's sealed object, next to their name — never as a tag and never in the clear, which would mark
// them on the relay as the church's would-be treasurer. The owner's console reads it from the sealed object only, and
// only the exact string 'finance' counts. It pre-selects the Finance helper preset on the approve sheet; the owner can
// pick another, and what is granted is always presetCaps() of the preset the owner confirms. Older owner consoles
// read only `.name`, so they simply ignore the field.
//
// POINT OF USE. requestSteward and subscribeStewardRequests are LIFTED FROM THE SHIPPED BUNDLE (vendor/steward.js,
// bundle names) and run with real nip44 and real keys: the helper's request is the event the owner's subscription
// reads. The owner's screen is the REAL DashStewardsPanel (console-screens.mjs) fed by that real subscription; the
// approve sheet's controls are pressed, and the roster write it would publish is the assertion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { fnBody, deps } from './test-slice.mjs';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const CONSTS = new Function(deps(VENDOR, 'NET STEWARDREQ_D STEWARDS_D PENDING_CHURCH_KEY', []) + '\nreturn { NET, STEWARDREQ_D, STEWARDS_D, PENDING_CHURCH_KEY };')();
const method = (anchor, name) => 'function ' + fnBody(VENDOR, VENDOR.indexOf('\n    ' + anchor) + 5, name);
const REQUEST_SRC = method('requestSteward(payload, name) {', 'requestSteward');
const SUBSCRIBE_SRC = method('subscribeStewardRequests(onReqs) {', 'subscribeStewardRequests');
const presetBody = fnBody(VENDOR, 'function _presetCaps(id) {', '_presetCaps');
const presetCaps = new Function(deps(VENDOR, presetBody, []) + '\nreturn ' + presetBody)();
const PRESETS = new Function(deps(VENDOR, 'STEWARD_PRESETS', []) + '\nreturn STEWARD_PRESETS;')();

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
const churchSk = generateSecretKey(), churchPub = getPublicKey(churchSk);

// THE HELPER'S SIDE: the real requestSteward, signing with a real key, `publish` a spy (what reaches the wire is the claim).
async function helperSends({ app, name = 'Tom Treasurer' }) {
  const hsk = generateSecretKey(), hpub = getPublicKey(hsk);
  const sent = [];
  const scope = {
    ...CONSTS,
    window: { TRINITY_APP: app, Steward: { checkStewardInvite: () => ({ ok: true, church: churchPub }) }, dispatchEvent() {} },
    CustomEvent: class { constructor(t) { this.type = t; } }, localStorage: memStore(),
    sk: hsk, churchPub: hpub, publish: (e) => { sent.push(e); return Promise.resolve(true); },
    finalizeEvent2: finalizeEvent, _monotonic: (t) => t, now: () => 1795000000, npubEncode,
    encrypt2: nip44.encrypt, getConversationKey: nip44.utils.getConversationKey,
  };
  const names = Object.keys(scope);
  const requestSteward = new Function(...names, REQUEST_SRC + '\nreturn requestSteward;')(...names.map(n => scope[n]));
  const r = await requestSteward('trinityone-stewardinvite:' + npubEncode(churchPub), name);
  assert.ok(r && r.ok, 'the request was not sent');
  assert.equal(sent.length, 1);
  return { evt: sent[0], hpub, hsk };
}

// THE OWNER'S SIDE: the real subscribeStewardRequests over a pool that delivers `events`, then end-of-stored-events.
function ownerReads(events) {
  let rows = [];
  const scope = {
    ...CONSTS, pub: churchPub, sk: churchSk, npubEncode, decrypt3: nip44.decrypt, getConversationKey: nip44.utils.getConversationKey,
    lsGet: () => null, lsSet() {}, relays: () => ['wss://relay.example'],
    pool: { subscribeMany: (_r, _f, h) => { for (const e of events) h.onevent(e); h.oneose(); return { close() {} }; } },
  };
  const names = Object.keys(scope);
  const subscribe = new Function(...names, SUBSCRIBE_SRC + '\nreturn subscribeStewardRequests;')(...names.map(n => scope[n]));
  subscribe((list) => { rows = list; });
  return { rows, subscribe };
}

test('a request from the finance app carries app:"finance" SEALED — nothing about it is on the wire in the clear', async () => {
  const { evt } = await helperSends({ app: 'finance' });
  assert.doesNotMatch(JSON.stringify(evt.tags), /finance/i, 'the hint is in a TAG — readable by anyone holding the relay');
  assert.doesNotMatch(evt.content, /finance/i, 'the hint is in the clear in the content');
  const sealed = JSON.parse(nip44.decrypt(JSON.parse(evt.content).n, nip44.utils.getConversationKey(churchSk, evt.pubkey)));
  assert.deepEqual(sealed, { name: 'Tom Treasurer', app: 'finance' }, 'the sealed request does not carry the hint next to the name');
});

test('a request from the steward console carries no hint (CONTROL)', async () => {
  const { evt } = await helperSends({ app: undefined });
  const sealed = JSON.parse(nip44.decrypt(JSON.parse(evt.content).n, nip44.utils.getConversationKey(churchSk, evt.pubkey)));
  assert.deepEqual(sealed, { name: 'Tom Treasurer' });
});

test('the owner reads the hint from the sealed object — and ONLY the exact string "finance", only when sealed', async () => {
  const fin = await helperSends({ app: 'finance' });
  const stw = await helperSends({ app: undefined, name: 'Ruth' });
  // forged requests: anyone who knows the church key can publish one, sealed or clear, with any app value
  const forge = (obj, clear) => { const sk = generateSecretKey(); const ck = nip44.utils.getConversationKey(sk, churchPub);
    const content = clear ? JSON.stringify(obj) : JSON.stringify({ n: nip44.encrypt(JSON.stringify(obj), ck) });
    return finalizeEvent({ kind: 30078, created_at: 1795000001, tags: [['d', CONSTS.STEWARDREQ_D + churchPub], ['t', CONSTS.NET], ['p', churchPub]], content }, sk); };
  const odd = [forge({ name: 'A', app: 'Finance' }), forge({ name: 'B', app: 'finance ' }), forge({ name: 'C', app: ['finance'] }),
    forge({ name: 'D', app: 'all' }), forge({ name: 'E', app: 'finance' }, true)];
  const { rows } = ownerReads([fin.evt, stw.evt, ...odd]);
  const by = (pk) => rows.find(r => r.pubkey === pk);
  assert.equal(by(fin.hpub).app, 'finance', 'the owner did not read the finance hint');
  assert.equal(by(fin.hpub).name, 'Tom Treasurer');
  assert.equal(by(stw.hpub).app, undefined, 'a steward-console request was read as a finance one');
  for (const e of odd) assert.equal(by(e.pubkey).app, undefined, 'a request with app ' + e.content.slice(0, 40) + '… was read as a finance hint');
});

// ── the owner's approve sheet, fed by the real subscription ───────────────────────────────────────────────────────
function ownerScreen(events) {
  const fr = fakeReact();
  const wrote = [];
  const OWNER = churchPub;
  const Steward = fakeSteward({
    actingChurch: '', pubkey: OWNER,
    stewardPresets: () => PRESETS.map(p => ({ ...p, caps: Array.isArray(p.caps) ? p.caps.slice() : null })),
    presetCaps: (id) => presetCaps(id),
    stewardCapNames: () => ['finance', 'care', 'safeguarding', 'members', 'content', 'sealedrooms'],
    hasPinLock: () => false,
    stewardLabels: () => ({}), stewardCaps: () => ({}), stewardSince: () => ({}),
    // the REAL subscription, lifted from the bundle, over a pool that delivers `events`
    subscribeStewardRequests: (cb) => { cb(ownerReads(events).rows); return () => {}; },
    setStewards: (pubkeys, caps, names) => { wrote.push({ pubkeys, caps, names }); return Promise.resolve(true); },
  });
  const { window } = fakeBrowser({ Steward });
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashStewardsPanel }' });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashStewardsPanel({ church: { name: 'St Aidan' } }); fr.flush(); return tree; };
  const all = () => nodes(tree);
  const press = (label) => { const b = all().find(n => n.type === 'button' && texts(n).join(' ').includes(label)); assert.ok(b, 're-anchor: no button "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw(); };
  const radio = (aria) => all().find(n => n.type === 'input' && n.props && n.props.type === 'radio' && n.props['aria-label'] === aria);
  const pick = (aria) => { const r = radio(aria); assert.ok(r, 're-anchor: no preset ' + aria); r.props.onChange({ target: { checked: true } }); draw(); };
  draw(); draw();
  return { press, radio, pick, get wrote() { return wrote; } };
}

test('owner: a finance-app request opens the approve sheet with "Finance helper" ticked, and approving grants exactly finance', async () => {
  const { evt, hpub } = await helperSends({ app: 'finance' });
  const s = ownerScreen([evt]);
  s.press('Approve');
  assert.equal(s.radio('Finance helper').props.checked, true, 'the finance-app request did not pre-select the Finance helper preset');
  assert.equal(s.radio('General helper').props.checked, false);
  s.press('Approve as helper');
  assert.equal(s.wrote.length, 1);
  assert.deepEqual(s.wrote[0].caps[hpub], ['finance'], 'the grant is not exactly the Finance preset');
});

test('owner: the hint is only a pre-selection — the owner can still choose another preset', async () => {
  const { evt, hpub } = await helperSends({ app: 'finance' });
  const s = ownerScreen([evt]);
  s.press('Approve');
  s.pick('General helper');
  s.press('Approve as helper');
  assert.deepEqual(s.wrote[0].caps[hpub].slice().sort(), ['care', 'content', 'members'], 'the owner\'s choice did not override the hint');
});

test('owner: a request with no hint, or any other app value, opens on the conservative General preset — a hint can never add a capability', async () => {
  const plain = await helperSends({ app: undefined });
  const sk = generateSecretKey();
  const forged = finalizeEvent({ kind: 30078, created_at: 1795000002, tags: [['d', CONSTS.STEWARDREQ_D + churchPub], ['t', CONSTS.NET], ['p', churchPub]],
    content: JSON.stringify({ n: nip44.encrypt(JSON.stringify({ name: 'Mallory', app: 'all' }), nip44.utils.getConversationKey(sk, churchPub)) }) }, sk);
  for (const [evt, pk] of [[plain.evt, plain.hpub], [forged, forged.pubkey]]) {
    const s = ownerScreen([evt]);
    s.press('Approve');
    assert.equal(s.radio('General helper').props.checked, true, 'a request without the exact finance hint did not open on General');
    assert.equal(s.radio('Full helper (everything except the church key)').props.checked, false, 'a request\'s app value selected the FULL preset');
    s.press('Approve as helper');
    assert.deepEqual(s.wrote[0].caps[pk].slice().sort(), ['care', 'content', 'members']);
  }
});
