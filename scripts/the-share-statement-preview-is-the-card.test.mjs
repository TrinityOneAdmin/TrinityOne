// THE SHARE-STATEMENT DIALOG PREVIEW *IS* THE POSTED CARD (owner device-test follow-up, 2026-10-30).
//   Run: node --test scripts/the-share-statement-preview-is-the-card.test.mjs
//
// CLAUDE.md rules 1 & 3 (point-of-use, rendered-tree only). The owner's screenshots showed the old hand-built
// letterhead preview (banner stacked over a boxed logo) did NOT look like what members receive. The fix renders
// the preview with the REAL ConsoleFinanceCard (app/stew-cards.jsx) from the SAME envelope the post emits
// (financeCardEnvelope), so preview == result.
//
// The fake React does NOT expand child COMPONENTS (it leaves {type: ConsoleFinanceCard, props} in the tree), so
// these tests (a) find that node — proving the preview hands the REAL card component the envelope + church
// (delete the ConsoleFinanceCard preview → no node → red), and (b) CALL the shipped ConsoleFinanceCard with
// those exact props and read ITS rendered tree — proving the banner/name/figures actually draw.
//
// Shared-code callers (rule 2): financeCardEnvelope has TWO callers, both in app/stew-finance.jsx —
// postStatementToMembers (DashFinanceBook, the posted card) and FinanceShareStatement (this preview). The
// post envelope is unchanged (a-finance-statement-posts-as-a-renderable-card.test.mjs stays green).
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

const GROUPS = [{ id: 'notices', name: 'Notices', kind: 'broadcast' }, { id: 'prayer', name: 'Prayer', kind: 'group' }];
// valid data: images per stew-cards.jsx cardImgUrl (strict base64 alphabet) — else the card drops them.
const DATA_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const DATA_BANNER = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==';

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

function mountModal(props) {
  const fr = fakeReact();
  const { window } = fakeBrowser();
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ FinanceShareStatement, ConsoleFinanceCard }' });
  fr.fresh();
  let m = null;
  const drawM = () => { fr.reset(); m = mods.FinanceShareStatement(props); fr.flush(); return m; };
  const btn = (label) => nodes(m).find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const click = (label) => { const b = btn(label); assert.ok(b, 're-anchor: no modal button "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); drawM(); };
  const label = (s) => nodes(m).filter(n => n.type === 'label' && texts(n).join(' ').includes(s));
  const checkboxIn = (labelNode) => nodes(labelNode).find(n => n.type === 'input' && n.props && n.props.type === 'checkbox');
  // the preview card node (type IS the shipped ConsoleFinanceCard function; the fake React leaves it unexpanded)
  const cardNode = () => nodes(m).find(n => n.type === mods.ConsoleFinanceCard);
  const renderCard = () => { const c = cardNode(); assert.ok(c, 'the preview did not render ConsoleFinanceCard'); return mods.ConsoleFinanceCard(c.props); };
  drawM();
  return { fr, mods, drawM, btn, click, label, checkboxIn, cardNode, renderCard, get m() { return m; } };
}

test('the preview renders the REAL ConsoleFinanceCard from the same envelope the post emits (branded ON)', () => {
  const d = mountModal({ book: seedBook(), F: FL, churchName: 'Grace', accent: '#2a9d8f', logo: DATA_LOGO, banner: DATA_BANNER,
    canPost: true, groups: GROUPS, onPostToMembers: async () => true, onClose() {} });
  d.click('This year');   // deterministic period → the seeded Jan postings are in range

  // (a) the preview hands the REAL card component the envelope + the church profile
  const node = d.cardNode();
  assert.ok(node, 'the preview is NOT a ConsoleFinanceCard — the hand-built letterhead was not replaced');
  assert.equal(node.props.card.type, 'finance', 'the preview card envelope is not the finance envelope');
  assert.equal(node.props.card.branded, true, 'branded ON must set card.branded true');
  assert.equal(node.props.card.title, 'Grace', 'the card title must be the church name');
  assert.ok(node.props.card.sections.some(s => s.kind === 'summary'), 'the envelope carries no summary section');
  // church profile passed straight through (raw data: URIs the card validates) — NOT churchMarkDataUrl output.
  // Field-wise (the props object is a vm-realm object, so a cross-realm deepStrictEqual would fail on prototype).
  assert.equal(node.props.church.name, 'Grace', 'the preview did not pass the church name to the card');
  assert.equal(node.props.church.picture, DATA_LOGO, 'the preview did not pass church.picture (the logo) to the card');
  assert.equal(node.props.church.banner, DATA_BANNER, 'the preview did not pass church.banner to the card');
  assert.equal(node.props.church.accent, '#2a9d8f', 'the preview did not pass the church accent to the card');

  // (b) the shipped card actually DRAWS the header (banner img + name + "Financial statement") and the figures
  const card = d.renderCard();
  const imgs = nodes(card).filter(n => n.type === 'img');
  assert.ok(imgs.some(im => im.props && im.props.src === DATA_BANNER), 'branded ON: the card did not draw the church banner');
  const t = texts(card).join(' ');
  assert.ok(/Grace/.test(t), 'the card header is missing the church name');
  assert.ok(/financial statement/i.test(t), 'the card header is missing the "Financial statement" label');
  assert.ok(/Total income/.test(t) && /£250\.00/.test(t), 'the card is missing the This-year income figure');
  assert.ok(/£80\.00/.test(t), 'the card is missing the This-year spending figure');
});

test('with branding OFF the preview card shows NO banner or logo image', () => {
  const d = mountModal({ book: seedBook(), F: FL, churchName: 'Grace', accent: '', logo: DATA_LOGO, banner: DATA_BANNER,
    canPost: true, groups: GROUPS, onPostToMembers: async () => true, onClose() {} });
  d.click('This year');
  const brandCb = d.checkboxIn(d.label('Show church banner')[0] || {});
  assert.ok(brandCb, 're-anchor: no "Show church banner & logo" checkbox');
  brandCb.props.onChange({ target: { checked: false } }); d.drawM();

  const node = d.cardNode();
  assert.ok(node, 'the preview is not a ConsoleFinanceCard');
  assert.equal(node.props.card.branded, false, 'unticking the toggle must set card.branded false');
  const card = d.renderCard();
  assert.equal(nodes(card).filter(n => n.type === 'img').length, 0, 'branded OFF: the preview card must carry no banner/logo image');
  // the figures still render — only the branding is gone
  assert.ok(/£250\.00/.test(texts(card).join(' ')), 'branded OFF must still show the figures');
});

test('with nothing ticked the preview keeps the "Tick at least one section" empty state (no card)', () => {
  const d = mountModal({ book: seedBook(), F: FL, churchName: 'Grace', accent: '', logo: '', banner: '',
    canPost: true, groups: GROUPS, onPostToMembers: async () => true, onClose() {} });
  // untick every Include section
  for (const s of (FL.STATEMENT_SECTIONS || [])) {
    const cb = d.checkboxIn(d.label(s.label)[0] || {});
    if (cb && cb.props.checked) { cb.props.onChange({ target: { checked: false } }); d.drawM(); }
  }
  assert.ok(!d.cardNode(), 'with no sections ticked the card must not render');
  assert.ok(texts(d.m).join(' ').includes('Tick at least one section'), 'the empty-state message is missing');
});
