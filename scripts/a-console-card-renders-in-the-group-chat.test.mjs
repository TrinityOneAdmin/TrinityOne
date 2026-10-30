// CONSOLE GROUP CHAT: A FINANCE CARD RENDERS ON THE STEWARD'S OWN SCREEN. Run:
//   node --test scripts/a-console-card-renders-in-the-group-chat.test.mjs
//
// Point of use (CLAUDE.md rules 1 and 3): the real GroupChatModal is sliced out of app/stew-dashboard.jsx and
// the real ConsoleCard/ConsoleFinanceCard out of app/stew-cards.jsx, compiled with the build's own esbuild and
// RENDERED through the mini React. Every assertion reads the drawn tree; nothing matches source text. The
// engine half (the ['card',...] tag → a message's `card`) is a-console-group-chat-parses-the-card-tag.test.mjs.
//
// Users of the code touched (rule 2): GroupChatModal (mounted at the groups list, the group sheet and the docked
// chat tray) now renders ConsoleCard in place of the text body when the card is renderable, else msgText(m).
// ConsoleCard/cardRenderable are NEW (app/stew-cards.jsx) and read by GroupChatModal only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadComponent, Stub, settle, ROOT } from './console-component-rig.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const CHURCH = 'c'.repeat(64), RUTH = 'a'.repeat(64);
const ESBUILD = join(ROOT, 'node_modules/.bin/esbuild');

// 1x1 png data URIs — the church's logo + banner exactly as the profile holds them (data: only). Distinct bytes.
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const BANNER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwAEhQGA7bYgBwAAAABJRU5ErkJggg==';
// The console's OWN church profile (useStewardChurch). Accent is a PALE hex, so cardInk's darkening is exercised.
// There is deliberately NO `initials` field — the card derives them from the name, as the console does elsewhere.
const CHURCH_PROFILE = { name: 'Grace Community Church', accent: '#8bd3c7', picture: LOGO, banner: BANNER };

const ENVELOPE = {
  type: 'finance', title: 'Grace Community Church', periodLabel: 'Q3 2026',
  sections: [
    { kind: 'summary', income: 1234500, expenditure: 980000, surplus: 254500 },
    { kind: 'rows', label: 'Income by category', rows: [{ name: 'Giving', amount: 900000 }, { name: 'Hall hire', amount: 334500 }] },
    { kind: 'rows', label: 'Fund balances (closing)', tag: true, rows: [{ name: 'General', kind: 'general', balance: 512300 }] },
  ],
  currency: 'GBP', decimals: 2, generatedAt: '2026-10-30',
};
// The fallback body carries NEITHER the figures NOR the branding — so finding those on the tree proves the CARD
// rendered them (the point-of-use signal). msgText shortens a card to title+period, so the body text below is
// only shown when the card DOESN'T render.
const FALLBACK_BODY = 'Grace Community Church — financial statement for Q3 2026. Open the app for the figures.';

// Compile ConsoleCard/ConsoleFinanceCard from the real app/stew-cards.jsx (whole file; it is pure + needs only React).
function loadCards(React) {
  const js = execFileSync(ESBUILD, [join(ROOT, 'app/stew-cards.jsx'), '--jsx=transform', '--format=cjs', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const m = { exports: {} };
  new Function('React', 'module', 'exports', js + '\nmodule.exports = { ConsoleCard, ConsoleFinanceCard, cardRenderable };')(React, m, m.exports);
  return m.exports;
}

// Spy for TrinityReplyKit.quote so a reply's quote text (what a quoted card shows) can be read; the card tests
// use messages with no replyTo, so the real quote markup is never needed.
function makeReplyKit(quoteCalls) {
  return { quote: (o) => { quoteCalls.push(o); return null; }, bar: () => null, cue: () => null, style: () => ({}), dotsProps: () => ({}) };
}

async function chat({ msgs, cards, replyKit }) {
  const { React, draw } = miniReact();
  const win = {
    Steward: {
      pubkey: CHURCH, stewardLabels: () => ({}),
      subscribeGroupChat: (id, cb) => { cb(msgs); return () => {}; },
      subscribeGroupPin: (id, cb) => { cb(null); return () => {}; },
      subscribeGroupEvents: (id, cb) => { cb([]); return () => {}; },
      publishPost: () => Promise.resolve({ id: 'e1' }),
    },
    useStewardMembers: () => [{ pubkey: RUTH, name: 'Ruth' }],
    useStewardChurch: () => CHURCH_PROFILE,
    useStewardStewards: () => [],
    dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  };
  const mod = await loadComponent('app/stew-dashboard.jsx', ['function GroupChatModal({ group, onClose }) {', 'function groupIcon('], {
    React, window: win, CustomEvent, setTimeout, clearTimeout,
    document: { addEventListener() {}, removeEventListener() {} },
    TrinityReplyKit: replyKit || makeReplyKit([]),
    Icon: Stub('Icon'), SkBadge: Stub('SkBadge'), useStewDialog: () => ({}),
    ConsoleCard: cards.ConsoleCard, ConsoleFinanceCard: cards.ConsoleFinanceCard, cardRenderable: cards.cardRenderable,
  });
  const props = { group: { id: 'g1', name: 'Whole Church', kind: 'group' }, onClose() {} };
  const paint = () => draw(mod.GroupChatModal, props);
  paint(); await settle(); const tree = paint();
  return { React, draw, tree };
}
const imgs = (tree) => find(tree, n => n.type === 'img' && typeof n.props.src === 'string');
const cardMsg = (env = ENVELOPE, body = FALLBACK_BODY, over = {}) => ({ id: 'm-card', by: CHURCH, mine: true, ts: 1, text: body, card: env, ...over });

test('a finance card message renders the figures AND the church branding on the console screen', async () => {
  const { React } = miniReact();
  const cards = loadCards(React);
  const { tree } = await chat({ msgs: [cardMsg()], cards });
  const seen = texts(tree).join(' | ');
  // figures — only the card renders these (the fallback body carries none of them)
  assert.match(seen, /£12,345\.00/, 'total income is not on the card');
  assert.match(seen, /£9,800\.00/, 'total spending is not on the card');
  assert.match(seen, /£2,545\.00/, 'surplus is not on the card');
  assert.match(seen, /£9,000\.00/, 'an income-by-category figure is not on the card');
  assert.match(seen, /£5,123\.00/, 'a closing fund balance is not on the card');
  assert.match(seen, /Income by category/);
  assert.match(seen, /Fund balances/);
  assert.match(seen, /aggregate figures only/i);
  // branding: the church's OWN logo (data: URI from the profile, never the post) is on the card
  assert.ok(imgs(tree).some(i => i.props.src === LOGO), 'the church logo from the profile is not on the card');
  assert.ok(!seen.includes('Open the app for the figures'), 'the plain-text body showed instead of the card');
});

test("the church banner and the treasurer's note render on the card", async () => {
  const { React } = miniReact();
  const cards = loadCards(React);
  const env = JSON.parse(JSON.stringify(ENVELOPE));
  env.sections.push({ kind: 'note', text: 'Thank you for your faithful giving this quarter.' });
  const { tree } = await chat({ msgs: [cardMsg(env)], cards });
  const seen = texts(tree).join(' | ');
  assert.match(seen, /Treasurer/, 'the treasurer-note heading is not on the card');
  assert.match(seen, /faithful giving this quarter/, 'the treasurer-note text is not on the card');
  assert.ok(imgs(tree).some(i => i.props.src === BANNER), 'the church banner from the profile is not on the card');
  assert.ok(imgs(tree).some(i => i.props.src === LOGO), 'the church logo is not on the card alongside the banner');
});

test('branded:false renders a plain card — no banner, no logo — but keeps the figures', async () => {
  const { React } = miniReact();
  const cards = loadCards(React);
  const env = JSON.parse(JSON.stringify(ENVELOPE)); env.branded = false;
  const { tree } = await chat({ msgs: [cardMsg(env)], cards });
  const seen = texts(tree).join(' | ');
  assert.equal(imgs(tree).length, 0, 'branded:false must suppress BOTH the banner and the logo');
  assert.match(seen, /GC/, 'the initials (derived from the church name) must show when branding is off');
  assert.match(seen, /£12,345\.00/, 'the figures must still render on an unbranded card');
});

test('the card leaks no per-person name even if the envelope smuggles one in', async () => {
  const { React } = miniReact();
  const cards = loadCards(React);
  const sneaky = JSON.parse(JSON.stringify(ENVELOPE));
  sneaky.sections[0].topDonor = 'Jane Smith';
  sneaky.sections[1].rows[0].contributors = ['John Doe'];
  sneaky.donors = [{ name: 'Mary Okafor', amount: 50000 }];
  const { tree } = await chat({ msgs: [cardMsg(sneaky)], cards });
  const seen = texts(tree).join(' | ');
  for (const name of ['Jane Smith', 'John Doe', 'Mary Okafor']) assert.ok(!seen.includes(name), `a per-person name leaked onto the card: ${name}`);
  assert.match(seen, /Giving/);
  assert.match(seen, /General/);
});

test('an unknown card type falls back to the plain-text body (forward-compat)', async () => {
  const { React } = miniReact();
  const cards = loadCards(React);
  const m = cardMsg({ type: 'mystery-future-type', title: 'X', sections: [] }, 'ONLY THE BODY SHOWS');
  const { tree } = await chat({ msgs: [m], cards });
  const seen = texts(tree).join(' | ');
  assert.match(seen, /ONLY THE BODY SHOWS/, 'an unknown card type must show its text body');
  assert.equal(imgs(tree).length, 0, 'an unknown card type must not render a card logo');
});

test('a plain text post (no card) renders as before — the text, no card', async () => {
  const { React } = miniReact();
  const cards = loadCards(React);
  const { tree } = await chat({ msgs: [{ id: 'p1', by: RUTH, mine: false, ts: 1, text: 'Hello everyone', card: null }], cards });
  const seen = texts(tree).join(' | ');
  assert.match(seen, /Hello everyone/);
  assert.equal(imgs(tree).length, 0, 'a plain post must render no card image');
});

test("a reply quoting a card shows the card's concise text (title + period), not raw json", async () => {
  const { React } = miniReact();
  const cards = loadCards(React);
  const quoteCalls = [];
  const parent = cardMsg();
  const reply = { id: 'r1', by: RUTH, mine: false, ts: 2, text: 'thanks', card: null, replyTo: 'm-card',
    quote: { id: 'm-card', by: CHURCH, text: FALLBACK_BODY, card: ENVELOPE } };
  await chat({ msgs: [parent, reply], cards, replyKit: makeReplyKit(quoteCalls) });
  assert.ok(quoteCalls.length > 0, 'the reply did not draw a quote');
  const quoted = quoteCalls.map(c => c.text).filter(Boolean).join(' | ');
  assert.match(quoted, /Grace Community Church · Q3 2026/, 'the quoted card did not show its concise title + period');
  assert.ok(!/sections/.test(quoted), 'the quote leaked raw card json');
});

// DELETION (CLAUDE.md rule 1; "sabotage must be scoped to the function under test"): disable ONLY the card
// render branch inside GroupChatModal, in a scratchpad copy, and confirm the card stops and the body shows.
test('DELETION: with the card render branch disabled, the card stops and the text body shows', async () => {
  const src = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
  const ANCHOR = 'cardRenderable(m.card)';
  assert.equal(src.split(ANCHOR).length - 1, 1, 'the card-render anchor is not unique in stew-dashboard.jsx — re-scope this sabotage');

  const dir = mkdtempSync(join(tmpdir(), 'trin-concard-'));
  try {
    const sabPath = join(dir, 'stew-dashboard.jsx');
    writeFileSync(sabPath, src.replace(ANCHOR, 'false && cardRenderable(m.card)'));
    // Compile the sabotaged GroupChatModal the same way loadComponent does (slice + esbuild + inject globals).
    const sab = readFileSync(sabPath, 'utf8');
    const pieces = [fnBody(sab, 'function GroupChatModal({ group, onClose }) {', 'GroupChatModal'), fnBody(sab, 'function groupIcon(', 'groupIcon')];
    const tmp = join(dir, 'slice.jsx');
    writeFileSync(tmp, pieces.join('\n') + '\nexport { GroupChatModal, groupIcon };\n');
    const js = execFileSync(ESBUILD, [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 });

    const { React, draw } = miniReact();
    const cards = loadCards(React);
    const win = {
      Steward: { pubkey: CHURCH, stewardLabels: () => ({}), subscribeGroupChat: (id, cb) => { cb([cardMsg()]); return () => {}; },
        subscribeGroupPin: (id, cb) => { cb(null); return () => {}; }, subscribeGroupEvents: (id, cb) => { cb([]); return () => {}; }, publishPost: () => Promise.resolve({ id: 'e1' }) },
      useStewardMembers: () => [], useStewardChurch: () => CHURCH_PROFILE, useStewardStewards: () => [],
      dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
    };
    const g = { React, window: win, CustomEvent, setTimeout, clearTimeout, document: { addEventListener() {}, removeEventListener() {} },
      TrinityReplyKit: makeReplyKit([]), Icon: Stub('Icon'), SkBadge: Stub('SkBadge'), useStewDialog: () => ({}),
      ConsoleCard: cards.ConsoleCard, ConsoleFinanceCard: cards.ConsoleFinanceCard, cardRenderable: cards.cardRenderable };
    const names = Object.keys(g);
    globalThis.__concard = g;
    const preamble = names.map(k => `const ${k} = globalThis.__concard.${k};`).join('\n');
    const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));

    const props = { group: { id: 'g1', name: 'Whole Church', kind: 'group' }, onClose() {} };
    const p = () => draw(mod.GroupChatModal, props);
    p(); await settle(); const tree = p();
    const seen = texts(tree).join(' | ');
    // The point-of-use signal: with the render branch gone the FIGURES and the branded LOGO disappear from the
    // screen — the card is no longer on it. (msgText still shortens a finance card to its title+period label,
    // so the fallback shows that concise text, never the figures.)
    assert.ok(!/£12,345\.00/.test(seen), 'the card still rendered the figures with its branch disabled — the test is not pinned to the branch');
    assert.ok(!/£2,545\.00/.test(seen), 'the surplus figure still rendered with the branch disabled');
    assert.equal(imgs(tree).length, 0, 'the branded logo still rendered with the branch disabled');
    assert.match(seen, /Grace Community Church · Q3 2026/, 'with the card branch gone the row must show msgText(m) (title + period), not the card');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
