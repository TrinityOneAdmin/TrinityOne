// SHARE-STATEMENT DOWNLOAD BRANDING + POST SUCCESS STATE ARE ACTUALLY ON THE SCREEN (2026-10-30).
//   Run: node --test scripts/the-share-statement-download-branding-and-success.test.mjs
//
// CLAUDE.md rules 1 & 3 (point-of-use, rendered-tree only). Every claim renders the REAL FinanceShareStatement
// through scripts/console-screens.mjs (compiled the way the phone loads it) and reads the RENDERED TREE
// (React.createElement nodes) or the real `model` the component hands its callbacks — NEVER the .jsx text
// (app/stew-finance.jsx ships UNBUNDLED, where a `false && ` would still satisfy a text match).
//
// FIX 1 — the DOWNLOAD honours branding. The `model` the modal builds (used by BOTH the PDF/HTML download and
//   the post) carries the church logo AND banner when "Show church banner & logo" is ON, and NEITHER when OFF.
//   statementHtml(model) — exactly what the HTML download writes — gains/loses both <img> tags with the toggle.
//   Delete `logo: branded ? …` / `banner: branded ? …` from the model and the ON/OFF assertions diverge → red.
//   Plus a buildStatement-level check that `banner` is data:-validated (anti-beacon) and carried.
//
// FIX 2 — a clear SUCCESS state after a post. After a successful post the footer is REPLACED by a success panel
//   ("Shared with members" + a single "Done" button) and the still-clickable "Post to members" button is GONE
//   (no double-post). Done calls onClose. Delete the `posting === 'done'` branch and these turn red.
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook renders FinanceShareStatement; the modal's
// doDownload/doPost both consume the SAME `model`). buildStatement/statementHtml: src/finance-statement.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';
import { buildStatement, statementHtml, yearRange } from '../src/finance-statement.mjs';

const _ledger = await import('../src/finance-ledger.mjs');
const _store = await import('../src/finance-store.mjs');
const _statement = await import('../src/finance-statement.mjs');
const _import = await import('../src/finance-import.mjs');
const _reconcile = await import('../src/finance-reconcile.mjs');
const _reports = await import('../src/finance-reports.mjs');
const FL = { ..._ledger, ..._store, ..._statement, ..._import, ..._reconcile, ..._reports };

const GROUPS = [{ id: 'notices', name: 'Notices', kind: 'broadcast' }, { id: 'prayer', name: 'Prayer', kind: 'group' }];
const DATA_LOGO = 'data:image/png;base64,TESTLOGO123';     // a church dp already a data: URI → churchMarkDataUrl returns it as-is
const DATA_BANNER = 'data:image/png;base64,TESTBANNER456'; // a church banner data: URI → bannerData keeps it

function seedBook() {
  const Y = new Date().getFullYear();
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  FL.post(b, { date: Y + '-01-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 25000 }, { account: 'giving', dir: 'cr', amount: 25000 }] });
  FL.post(b, { date: Y + '-01-20', memo: 'electric', postings: [{ account: 'utilities', dir: 'dr', amount: 8000 }, { account: 'bank', dir: 'cr', amount: 8000 }] });
  return b;
}

// Mount the REAL FinanceShareStatement with the given props and return a driver. `logo`/`banner` are resolved in
// effects (logo via churchMarkDataUrl → a microtask; banner synchronously), so the driver flushes + awaits + redraws.
function mountModal(props) {
  const fr = fakeReact();
  const { window } = fakeBrowser();
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ FinanceShareStatement }' });
  fr.fresh();
  let m = null;
  const drawM = () => { fr.reset(); m = mods.FinanceShareStatement(props); fr.flush(); return m; };
  const settle = async () => { await new Promise(r => setTimeout(r)); drawM(); };   // let the logo microtask resolve, then redraw
  const btn = (label) => nodes(m).find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const click = (label) => { const b = btn(label); assert.ok(b, 're-anchor: no modal button "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); drawM(); };
  const label = (s) => nodes(m).filter(n => n.type === 'label' && texts(n).join(' ').includes(s));
  const checkboxIn = (labelNode) => nodes(labelNode).find(n => n.type === 'input' && n.props && n.props.type === 'checkbox');
  drawM();
  return { fr, mods, drawM, settle, btn, click, label, checkboxIn, get m() { return m; } };
}

// Post through the SHIPPED confirm → Yes chain, capturing the `model` the modal hands onPostToMembers.
async function postCapturing(d) {
  d.click('Post to members');                                                                   // → confirm
  d.btn('Yes, post to members').props.onClick({ stopPropagation() {}, preventDefault() {} });    // → doPost (async)
  await new Promise(r => setTimeout(r));
  d.drawM();
}

test('FIX1 — with branding ON the model carries BOTH logo and banner; statementHtml writes both <img> tags', async () => {
  let captured = null;
  const d = mountModal({ book: seedBook(), F: FL, churchName: 'Grace', accent: '', logo: DATA_LOGO, banner: DATA_BANNER,
    canPost: true, groups: GROUPS, onPostToMembers: async (model) => { captured = model; return true; }, onClose() {} });
  await d.settle();   // logo (churchMarkDataUrl) + banner resolved into state
  // branding defaults ON
  const brandCb = d.checkboxIn(d.label('Show church banner')[0] || {});
  assert.ok(brandCb, 're-anchor: no "Show church banner & logo" checkbox');
  assert.equal(brandCb.props.checked, true, 'the branding toggle must default to ON');
  await postCapturing(d);
  assert.ok(captured, 'onPostToMembers was not called — could not capture the built model');
  // the SAME model the download (doDownload → fsBuildStatementPdf/statementHtml) consumes
  assert.equal(captured.logo, DATA_LOGO, 'branded ON: the model must carry the church logo');
  assert.equal(captured.banner, DATA_BANNER, 'branded ON: the model must carry the church banner');
  const html = statementHtml(captured);   // exactly what the HTML download writes
  assert.match(html, /<img class="banner"/, 'the HTML download is missing the banner letterhead');
  assert.match(html, /<img class="logo"/, 'the HTML download is missing the church logo');
});

test('FIX1 — with branding OFF the model carries NEITHER logo nor banner; statementHtml writes no <img>', async () => {
  let captured = null;
  const d = mountModal({ book: seedBook(), F: FL, churchName: 'Grace', accent: '', logo: DATA_LOGO, banner: DATA_BANNER,
    canPost: true, groups: GROUPS, onPostToMembers: async (model) => { captured = model; return true; }, onClose() {} });
  await d.settle();
  const brandCb = d.checkboxIn(d.label('Show church banner')[0] || {});
  assert.ok(brandCb, 're-anchor: no "Show church banner & logo" checkbox');
  brandCb.props.onChange({ target: { checked: false } }); d.drawM();   // turn branding OFF
  await postCapturing(d);
  assert.ok(captured, 'onPostToMembers was not called — could not capture the built model');
  assert.equal(captured.logo, '', 'branded OFF: the model must NOT carry the logo');
  assert.equal(captured.banner, '', 'branded OFF: the model must NOT carry the banner');
  const html = statementHtml(captured);
  assert.ok(!html.includes('<img'), 'branded OFF: the HTML download must carry no logo/banner image');
});

test('FIX1 — buildStatement validates the banner as a data: image (anti-beacon) and carries it', () => {
  const Y = new Date().getFullYear();
  const ok = buildStatement(seedBook(), { ...yearRange(Y), banner: 'data:image/png;base64,AAAA', sections: ['summary'] });
  assert.equal(ok.banner, 'data:image/png;base64,AAAA', 'a data: banner must be carried on the model');
  assert.match(statementHtml(ok), /<img class="banner"/, 'statementHtml must render a data: banner');
  const beacon = buildStatement(seedBook(), { ...yearRange(Y), banner: 'https://evil.example/track.png', sections: ['summary'] });
  assert.equal(beacon.banner, '', 'a remote banner URL must be refused (anti-beacon)');
  assert.ok(!statementHtml(beacon).includes('<img'), 'a refused banner must not reach the HTML');
});

test('FIX2 — after a successful post the modal shows a success panel with Done, and NO "Post to members" button', async () => {
  let closed = 0;
  const d = mountModal({ book: seedBook(), F: FL, churchName: 'Grace', accent: '', logo: '', banner: '',
    canPost: true, groups: GROUPS, onPostToMembers: async () => true, onClose: () => { closed++; } });
  await d.settle();
  // before posting: the "Post to members" trigger exists
  assert.ok(d.btn('Post to members'), 're-anchor: no "Post to members" button before posting');
  await postCapturing(d);
  // success panel: the confirmation text + a single Done button
  assert.ok(texts(d.m).join(' ').includes('Shared with members'), 'the success panel "Shared with members" node is missing');
  assert.ok(texts(d.m).join(' ').includes('They'), 're-anchor: the success sub-line (target) is missing');
  const done = d.btn('Done');
  assert.ok(done, 'the success panel has no "Done" button');
  // the still-clickable "Post to members" button is GONE (no double-post)
  assert.ok(!d.btn('Post to members'), 'the "Post to members" button is still clickable after a post — double-post risk');
  // Done closes the dialog
  done.props.onClick({ stopPropagation() {}, preventDefault() {} });
  assert.equal(closed, 1, 'the "Done" button did not call onClose');
});
