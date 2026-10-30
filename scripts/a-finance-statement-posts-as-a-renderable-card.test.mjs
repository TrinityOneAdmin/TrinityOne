// A SHARED FINANCE STATEMENT IS POSTED WITH A RENDERABLE ["card","1",json] ENVELOPE — console half (Stream G).
//   Run: node --test scripts/a-finance-statement-posts-as-a-renderable-card.test.mjs
//
// POINT OF USE (CLAUDE.md rules 1 & 3). This drives the SHIPPED chain the treasurer drives: it renders the real
// DashFinanceBook, opens the "Share statement" modal, clicks Post → Yes, and spies Steward.publishPost at the
// boundary. Nothing is asserted by matching app/*.jsx text (that file ships UNBUNDLED, where a `false &&` would
// still match) — every claim reads the captured publishPost call and the parsed JSON. The whole point-of-use
// signal is the 4th arg: DROP the card tag from postStatementToMembers and the `extraTags`/`cardTag` assertions
// below turn red, while the plain-text body keeps working (the backward-compatible fallback).
//
// The emitted envelope matches CARD-ENVELOPE-contract.md and the member renderer fixture byte-for-byte
// (scripts/a-finance-statement-renders-as-a-branded-card.test.mjs, feat/rich-card-member): a real post renders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

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
  { id: 'youth', name: 'Youth', kind: 'group', sub: 'The youth group' },
];
const BROADCAST_ID = 'notices';
const DONOR_NAME = 'Zebediah Quux';   // a DISTINCTIVE donor name the aggregate card must never carry

const toItems = (docs) => docs.map(d => {
  if (d.t === 'settings') return { ...d, id: 'settings' };
  if (d.t === 'account') return { ...d, id: 'account:' + d.id };
  if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
  if (d.t === 'journal') return { ...d, id: 'journal:' + d.seq };
  if (d.t === 'donor') return { ...d, id: 'donor:' + d.id };
  return d;
});

function setup() {
  const fr = fakeReact();
  let encSubCb = null;
  const published = [];   // every Steward.publishPost(content, groupId, replyTo, extraTags) call, captured WHOLE
  const Steward = fakeSteward({
    actingChurch: '',
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async () => true,
    relayAuthed: () => true,
    publishPost: async (content, groupId, replyTo, extraTags) => { published.push({ content, groupId, replyTo, extraTags }); return true; },
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook, FinanceShareStatement }' });
  window.useStewardChurch = () => ({ name: 'Grace', accent: '', picture: '' });
  window.useStewardGroups = () => GROUPS;
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const all = () => nodes(tree);
  const feedItems = (items) => { assert.ok(encSubCb, 'encSubscribe was not wired'); encSubCb(items); draw(); };
  return { fr, mods, published, draw, all, feedItems, get tree() { return tree; } };
}

function seedBook() {
  const Y = new Date().getFullYear();
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  // a gift TAGGED to a donor — the donor's NAME lives only in the donor doc, never in the journal
  FL.post(b, { date: Y + '-01-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 25000 }, { account: 'giving', dir: 'cr', amount: 25000, donor: 'd1' }] });
  FL.post(b, { date: Y + '-01-20', memo: 'electric', postings: [{ account: 'utilities', dir: 'dr', amount: 8000 }, { account: 'bank', dir: 'cr', amount: 8000 }] });
  return b;
}
const seedItems = () => [...toItems(FL.bookToDocs(seedBook())), { t: 'donor', id: 'donor:d1', name: DONOR_NAME }];

const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// Open the REAL modal with the REAL postStatementToMembers DashFinanceBook wired onto it, pick the "This year"
// period (so the seeded January postings are in range → deterministic figures), and post.
function openRealModal(h) {
  h.draw();
  h.feedItems(seedItems());
  const shareBtn = h.all().find(n => n.type === 'button' && texts(n).join(' ').includes('Share statement'));
  assert.ok(shareBtn, 're-anchor: no "Share statement" button on the screen');
  shareBtn.props.onClick({ stopPropagation() {}, preventDefault() {} }); h.draw();
  const modal = h.all().find(n => n.type === h.mods.FinanceShareStatement);
  assert.ok(modal, 'the "Share statement" button did not open the FinanceShareStatement modal');
  const props = modal.props;
  assert.equal(props.canPost, true, 'canPost should be true with a broadcast group + relay Steward present');
  const fr = h.fr; fr.fresh();
  let m = null;
  const drawM = () => { fr.reset(); m = h.mods.FinanceShareStatement(props); fr.flush(); return m; };
  drawM();
  const mBtn = (label) => nodes(m).find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const clickM = (label) => { const b = mBtn(label); assert.ok(b, 're-anchor: no modal button "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); drawM(); };
  const post = async () => {
    clickM('Post to members');                                                                   // → confirm
    mBtn('Yes, post to members').props.onClick({ stopPropagation() {}, preventDefault() {} });    // → doPost (async)
    await new Promise(r => setTimeout(r));
  };
  return { props, clickM, post, drawM, get m() { return m; } };
}

test('posting a statement keeps the plain-text body AND attaches a contract-exact ["card","1",json] envelope', async () => {
  const h = setup();
  const d = openRealModal(h);
  d.clickM('This year');   // deterministic period: covers the seeded Jan postings
  await d.post();

  assert.equal(h.published.length, 1, 'expected exactly one publishPost call, got ' + h.published.length);
  const call = h.published[0];
  assert.equal(call.groupId, BROADCAST_ID, 'the default target (whole church) must be used');

  // ── (a) the FALLBACK body is still the plain-text statement (lead + statementText), name-free ──
  assert.equal(typeof call.content, 'string');
  assert.match(call.content, /Total income/, 're-anchor: the body is not the aggregate statement text');
  assert.match(call.content, /£250\.00/, 'the This-year income figure is missing from the fallback body');
  assert.match(call.content, /£80\.00/, 'the This-year spending figure is missing from the fallback body');
  assert.ok(!call.content.includes('"type"'), 'the card JSON leaked into the fallback body — it must ride the TAG');
  assert.ok(!call.content.includes(DONOR_NAME), 'INVARIANT: a donor name reached the plain-text statement');

  // exact: body === lead + statementText(model), rebuilt from the SAME book + period the modal used
  const Y = new Date().getFullYear();
  const today = todayISO();
  const expModel = {
    ...FL.buildStatement(d.props.book, {
      from: Y + '-01-01', to: Y + '-12-31', periodLabel: 'Year to date ' + Y,
      title: '', note: '', sections: ['summary', 'income', 'spending', 'funds'],
      generatedAt: today, accent: '', logo: '',
    }),
    title: 'Grace',
  };
  assert.equal(call.content, 'Grace — Year to date ' + Y + '\n\n' + FL.statementText(expModel), 'the posted body is not exactly lead + statementText');

  // ── (b) the 4th arg carries the card tag — this is the POINT-OF-USE signal (drop it → red) ──
  assert.ok(Array.isArray(call.extraTags), 'publishPost got no extraTags array (4th arg) — the card tag was NOT attached');
  const cardTag = call.extraTags.find(t => Array.isArray(t) && t[0] === 'card');
  assert.ok(cardTag, 'no ["card",…] tag in the 4th arg — the renderable card was not attached');
  assert.equal(cardTag[1], '1', 'the card envelope version must be "1"');

  const env = JSON.parse(cardTag[2]);
  // top-level fields the member renderer reads (CARD-ENVELOPE-contract.md)
  assert.equal(env.type, 'finance');
  assert.equal(env.title, 'Grace');
  assert.equal(env.periodLabel, 'Year to date ' + Y);
  assert.equal(env.currency, 'GBP');
  assert.equal(env.decimals, 2);
  assert.equal(env.generatedAt, today);
  assert.equal(env.branded, true, 'a posted card defaults to branded (the member app shows the church banner + logo)');
  assert.ok(Array.isArray(env.sections));

  // summary — figures in MINOR units (pence)
  const summary = env.sections.find(s => s.kind === 'summary');
  assert.ok(summary, 'no summary section');
  assert.equal(summary.income, 25000);
  assert.equal(summary.expenditure, 8000);
  assert.equal(summary.surplus, 17000);

  // income + spending category rows
  const income = env.sections.find(s => s.kind === 'rows' && s.label === 'Income by category');
  assert.ok(income, 'no "Income by category" section');
  assert.deepEqual(income.rows, [{ name: 'Giving', amount: 25000 }]);
  const spending = env.sections.find(s => s.kind === 'rows' && s.label === 'Spending by category');
  assert.ok(spending, 'no "Spending by category" section');
  assert.deepEqual(spending.rows, [{ name: 'Utilities', amount: 8000 }]);

  // fund balances — tag:true, {name,kind,balance}
  const funds = env.sections.find(s => s.kind === 'rows' && s.label === 'Fund balances (closing)');
  assert.ok(funds, 'no "Fund balances (closing)" section');
  assert.equal(funds.tag, true);
  assert.deepEqual(funds.rows, [{ name: 'General fund', kind: 'general', balance: 17000 }]);

  // ── name-free: the WHOLE envelope leaks no donor name, and carries only fields the renderer reads ──
  assert.ok(!JSON.stringify(env).includes(DONOR_NAME), 'a donor name leaked into the card envelope — aggregate privacy broken');
  for (const s of env.sections) {
    const allowed = s.kind === 'summary' ? ['kind', 'income', 'expenditure', 'surplus']
      : s.kind === 'note' ? ['kind', 'text']
      : ['kind', 'label', 'tag', 'rows'];
    for (const k of Object.keys(s)) assert.ok(allowed.includes(k), 'unexpected field smuggled onto a card section: ' + k);
    if (s.kind === 'rows') for (const r of s.rows) {
      const okFields = ['name', 'amount', 'kind', 'balance'];
      for (const k of Object.keys(r)) assert.ok(okFields.includes(k), 'unexpected field on a card row: ' + k);
    }
  }
});

// ── the treasurer's note + the branding toggle are POINT-OF-USE: driven on the real modal, read off the post ──
// Tick "Treasurer's note" + type one, untick "Show church banner & logo", post — then read the captured
// publishPost envelope. Delete the note-section push or the `branded` wiring and these turn red.
const labelsWith = (root, s) => nodes(root).filter(n => n.type === 'label' && texts(n).join(' ').includes(s));
const checkboxIn = (labelNode) => nodes(labelNode).find(n => n.type === 'input' && n.props && n.props.type === 'checkbox');

test("the treasurer's note rides as a note section and the branding toggle sets env.branded", async () => {
  const h = setup();
  const d = openRealModal(h);
  d.clickM('This year');

  // tick "Treasurer's note" → the textarea appears → type a note
  const noteCb = checkboxIn(labelsWith(d.m, 'Treasurer')[0] || {});
  assert.ok(noteCb, 're-anchor: no "Treasurer\'s note" checkbox in the modal');
  noteCb.props.onChange({ target: { checked: true } }); d.drawM();
  const ta = nodes(d.m).find(n => n.type === 'textarea');
  assert.ok(ta, 'ticking the note did not reveal the note textarea');
  ta.props.onChange({ target: { value: 'Thank you for your faithful giving this quarter.' } }); d.drawM();

  // untick "Show church banner & logo on the card"
  const brandCb = checkboxIn(labelsWith(d.m, 'Show church banner')[0] || {});
  assert.ok(brandCb, 're-anchor: no "Show church banner & logo" checkbox in the modal');
  assert.equal(brandCb.props.checked, true, 'the branding toggle must default to ON');
  brandCb.props.onChange({ target: { checked: false } }); d.drawM();

  await d.post();

  assert.equal(h.published.length, 1, 'expected exactly one publishPost call');
  const env = JSON.parse(h.published[0].extraTags.find(t => Array.isArray(t) && t[0] === 'card')[2]);

  // branding flag flipped off by the toggle
  assert.equal(env.branded, false, 'unticking "Show church banner & logo" must set env.branded === false');

  // the note rides as its OWN section, name-free, with only {kind,text}
  const note = env.sections.find(s => s.kind === 'note');
  assert.ok(note, 'the ticked treasurer note did not ride as a {kind:"note"} section');
  assert.equal(note.text, 'Thank you for your faithful giving this quarter.');
  assert.deepEqual(Object.keys(note).sort(), ['kind', 'text'], 'a note section must carry only {kind,text}');
  assert.ok(!JSON.stringify(env).includes(DONOR_NAME), 'INVARIANT: a donor name reached the card envelope via the note path');

  // the note is ALSO in the plain-text fallback body (statementText renders the note section)
  assert.match(h.published[0].content, /faithful giving/, 'the note is missing from the plain-text fallback body');
});
