// "POST TO MEMBERS" IS OFFERED ONLY TO A CONSOLE THE RELAY WILL LET POST (T1Finance step 0, 2026-11-17).
//   Run: node --test scripts/finance-post-to-members-needs-content.test.mjs
//
// The relay accepts a post into a broadcast group from the church key or from a delegate holding `content`
// (scripts/gateway.mjs stewardCan(e.pubkey, gcp, 'content')); a delegate with NO capabilities recorded is a
// full steward there (the `if (!caps) return true` compat branch). A finance-only helper used to be shown
// "Post to members", pressed it, and was refused with "Check your connection".
//
// POINT OF USE (CLAUDE.md rules 1 & 3): this renders the real DashFinanceBook with a Steward whose
// myStewardCaps() answers as the engine does, clicks the real "Share statement" button, then renders the
// FinanceShareStatement modal with the props DashFinanceBook actually passed it, and looks for the buttons.
// No text of app/*.jsx is matched. Remove the capability check from where canPost is computed and the
// finance-only case turns red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';
import { rosterEngine, rosterEvent } from './steward-roster-engine.mjs';

const _ledger = await import('../src/finance-ledger.mjs');
const _store = await import('../src/finance-store.mjs');
const _statement = await import('../src/finance-statement.mjs');
const _import = await import('../src/finance-import.mjs');
const _reconcile = await import('../src/finance-reconcile.mjs');
const _reports = await import('../src/finance-reports.mjs');
const FL = { ..._ledger, ..._store, ..._statement, ..._import, ..._reconcile, ..._reports };

const GROUPS = [
  { id: 'notices', name: 'Notices', kind: 'broadcast', sub: 'Dates, news and what’s on' },
  { id: 'prayer', name: 'Prayer', kind: 'group', sub: 'Share & lift requests' },
];
const CHURCH = 'c'.repeat(64);
const ME = 'd'.repeat(64);   // this console's own key — the one the roster grants capabilities to

const toItems = (docs) => docs.map(d => {
  if (d.t === 'settings') return { ...d, id: 'settings' };
  if (d.t === 'account') return { ...d, id: 'account:' + d.id };
  if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
  if (d.t === 'journal') return { ...d, id: 'journal:' + d.seq };
  return d;
});
function seedItems() {
  const Y = new Date().getFullYear();
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.post(b, { date: Y + '-01-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 25000 }, { account: 'giving', dir: 'cr', amount: 25000 }] });
  return toItems(FL.bookToDocs(b));
}

// `who` describes the acting identity: { actingChurch, caps } where caps is what the church's roster grants this console
// (null = the roster records no capabilities for it). The roster is read by the REAL engine (scripts/steward-roster-engine.mjs:
// subscribeStewards, myStewardCaps and listIsFresh lifted from vendor/steward.js); only the relay is replaced. It is
// delivered and settled at once unless `who.rosterLater` — then the harness's `eose()` / `arrive()` play the relay (S0-1, F3).
function shareModalHarness(who) {
  const fr = fakeReact();
  let encSubCb = null;
  const eng = rosterEngine({ actingChurch: who.actingChurch, pub: CHURCH, churchPub: ME });
  const Steward = fakeSteward({
    actingChurch: who.actingChurch,
    myStewardCaps: () => eng.myStewardCaps(),
    subscribeStewards: (cb) => eng.subscribeStewards(cb),
    listIsFresh: (l, since) => eng.listIsFresh(l, since),
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async () => true,
    relayAuthed: () => true,
    publishPost: async () => true,
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook, FinanceShareStatement }' });
  window.useStewardChurch = () => ({ name: 'Grace', accent: '', picture: '' });
  window.useStewardGroups = () => GROUPS;
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  draw();
  // the relay's answer to the roster read: the church's roster (granting who.caps), its end of stored events, the settle
  const arrive = () => { eng.relay.event(rosterEvent(CHURCH, [ME], who.caps === null ? null : { [ME]: who.caps })); eng.relay.eose(); eng.relay.settle(); draw(); };
  const eose = () => { eng.relay.eose(); draw(); };   // an end of stored events with NO roster delivered (audit F3)
  if (!who.rosterLater) arrive();
  assert.ok(encSubCb, 'encSubscribe was not wired');
  encSubCb(seedItems()); draw();
  const shareBtn = nodes(tree).find(n => n.type === 'button' && texts(n).join(' ').includes('Share statement'));
  assert.ok(shareBtn, 're-anchor: no "Share statement" button on the finance screen');
  shareBtn.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw();
  // the buttons of the modal as DashFinanceBook is passing it props NOW (rendered in a separate hook store)
  const labels = () => {
    const modal = nodes(tree).find(n => n.type === mods.FinanceShareStatement);
    assert.ok(modal, '"Share statement" did not open FinanceShareStatement');
    const mr = fakeReact(); window.React = mr.React;
    const m = mods.FinanceShareStatement(modal.props); mr.flush();
    window.React = fr.React;
    return nodes(m).filter(n => n.type === 'button').map(n => texts(n).join(' ').trim());
  };
  return { labels, arrive, eose };
}
const shareModalButtons = (who) => shareModalHarness(who).labels();

test('a finance-only helper is NOT offered "Post to members" — but can still Download', () => {
  const labels = shareModalButtons({ actingChurch: CHURCH, caps: ['finance'] });
  assert.ok(labels.includes('Download'), 're-anchor: the modal has no Download button: ' + JSON.stringify(labels));
  assert.ok(!labels.includes('Post to members'), 'a finance-only helper was offered "Post to members" — the relay will refuse it');
});

test('a helper with no capabilities at all ([]) is not offered "Post to members"', () => {
  const labels = shareModalButtons({ actingChurch: CHURCH, caps: [] });
  assert.ok(labels.includes('Download'));
  assert.ok(!labels.includes('Post to members'));
});

test('a helper given content (alongside finance) IS offered "Post to members"', () => {
  const labels = shareModalButtons({ actingChurch: CHURCH, caps: ['finance', 'content'] });
  assert.ok(labels.includes('Post to members'), 'a content helper must be offered "Post to members"');
});

test('a helper with NO capabilities recorded (myStewardCaps() === null) is a full steward and IS offered it', () => {
  const labels = shareModalButtons({ actingChurch: CHURCH, caps: null });
  assert.ok(labels.includes('Post to members'), 'null caps = full steward at the relay (compat) — must be offered');
});

test('the church key (owner console; myStewardCaps() === null) IS offered "Post to members"', () => {
  const labels = shareModalButtons({ actingChurch: '', caps: null });
  assert.ok(labels.includes('Post to members'), 'the church key must be offered "Post to members"');
});

test('S0-1: a delegate whose roster has NOT arrived yet is not offered "Post to members" — and is, once it arrives with content', () => {
  const who = { actingChurch: CHURCH, caps: null, rosterLater: true };   // myStewardCaps() is null until the roster lands
  const h = shareModalHarness(who);
  const before = h.labels();
  assert.ok(before.includes('Download'), 're-anchor: no Download button: ' + JSON.stringify(before));
  assert.ok(!before.includes('Post to members'), 'Post was offered while this delegate\'s capabilities were still unknown — a finance-only helper is refused');
  who.caps = ['finance', 'content'];                                  // the roster arrives, granting content
  h.arrive();
  assert.ok(h.labels().includes('Post to members'), 'the roster arrived with content and Post was still not offered');
});

test('S0-1: …and a finance-only delegate stays without it after the roster arrives', () => {
  const who = { actingChurch: CHURCH, caps: null, rosterLater: true };
  const h = shareModalHarness(who);
  assert.ok(!h.labels().includes('Post to members'));
  who.caps = ['finance'];
  h.arrive();
  assert.ok(!h.labels().includes('Post to members'), 'a finance-only helper was offered Post once the roster arrived');
});

test('F3: an empty end-of-stored-events (no roster read yet) is NOT "roster known" — no Post; the settled roster with content then offers it', () => {
  const who = { actingChurch: CHURCH, caps: ['finance', 'content'], rosterLater: true };
  const h = shareModalHarness(who);
  h.eose();   // the relay ends its stored events having sent no roster: the stream delivers [] while myStewardCaps() is null
  const before = h.labels();
  assert.ok(before.includes('Download'), 're-anchor: no Download button: ' + JSON.stringify(before));
  assert.ok(!before.includes('Post to members'), 'the empty end-of-stored-events was read as "roster known" — Post offered on unknown capabilities');
  h.arrive();
  assert.ok(h.labels().includes('Post to members'), 'the settled roster granted content and Post was not offered');
});
