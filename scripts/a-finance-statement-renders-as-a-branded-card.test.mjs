// A CHURCH'S FINANCE STATEMENT, POSTED AS A CARD, RENDERS AS A BRANDED CARD ON THE MEMBER'S SCREEN — and an
// older/unknown/broken card never breaks the room, it just shows the plain-text body (PLAN-UX-E, member half).
//   Run: node --test scripts/a-finance-statement-renders-as-a-branded-card.test.mjs
//
// The member app renders a group post as one of a fixed set of kinds (evtToMsg → Bubble, app/screens-chat.jsx).
// This feature adds a DEDICATED ['card','1',<json>] tag that evtToMsg turns into { kind:'card', card, text } and
// Bubble renders as a designed finance card — logo + accent taken from the CHURCH PROFILE the app already holds
// (ctx.church), NEVER from the post, which carries only the aggregate figures (thin-pipe / anti-beacon).
//
// WHAT THIS GUARANTEES
//   1. a ['card','1',{type:'finance',…}] event renders the figures AND the church's own logo, and leaks NO
//      member/donor name (statements are aggregate by design);
//   2. an unknown card.type degrades to the plain-text body (forward-compat for a card type a build can't draw);
//   3. a plain post, and an existing verse/devotional post, render EXACTLY as before (no regression);
//   4. malformed card json does not throw and falls back to the text body.
//   5. DELETION / SABOTAGE: with the finance render branch disabled in a scratchpad COPY, the card no longer
//      renders and the post shows its text body — so the branch is load-bearing (CLAUDE.md rule 1).
//
// CLAUDE.md rule 3: app/*.jsx ships UNBUNDLED, so a text match in the source is worthless. Nothing here matches
// source text — Bubble/evtToMsg are compiled with the build's own esbuild and rendered through the miniature
// React in render-jsx-screen.mjs, and every assertion reads the tree that came back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CHURCH = 'c'.repeat(64);

// The EXACT card envelope the console side must publish (PLAN-UX-E §2): a general resource shape with finance
// as the first `type`. Figures are minor units (pence). It carries the AGGREGATE statement model only — a
// summary and category/fund ROWS — and is name-free: no member/donor names, no per-person giving.
const ENVELOPE = {
  type: 'finance',
  title: 'Grace Community Church',
  periodLabel: 'Q3 2026',
  sections: [
    { kind: 'summary', income: 1234500, expenditure: 980000, surplus: 254500 },
    { kind: 'rows', label: 'Income by category', rows: [{ name: 'Giving', amount: 900000 }, { name: 'Hall hire', amount: 334500 }] },
    { kind: 'rows', label: 'Fund balances (closing)', tag: true, rows: [{ name: 'General', kind: 'general', balance: 512300 }, { name: 'Building', kind: 'restricted', balance: 180000 }] },
  ],
  currency: 'GBP', decimals: 2, generatedAt: '2026-10-30',
};

// 1x1 png data URIs — the church's logo + banner exactly as the profile holds them (data: only; a remote URL
// is rejected). Distinct bytes so a test can tell the banner from the logo on the rendered tree.
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const BANNER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwAEhQGA7bYgBwAAAABJRU5ErkJggg==';
// The church profile the member app already holds (same fields ChurchBadge reads). Accent is a PALE hex, so
// the card's accentInk darkening is exercised. It carries BOTH a banner and a display picture (logo).
const CHURCH_PROFILE = { id: CHURCH, npub: CHURCH, name: 'Grace Community Church', initials: 'GC', accent: '#8bd3c7', picture: LOGO, banner: BANNER };

// The body a card post also carries (what an OLD app shows). Here it deliberately contains NEITHER the figures
// NOR the branding, so finding those on the tree proves the CARD rendered them — the point-of-use signal.
const FALLBACK_BODY = 'Grace Community Church — financial statement for Q3 2026. Open the app to see the figures.';

// A card event as the console will publish it: kind-1 group post, text body in content, figures in the tag.
function cardEvent(envelope = ENVELOPE, body = FALLBACK_BODY) {
  return {
    id: 'ev-card', pubkey: CHURCH, created_at: 1760000000,
    tags: [['t', 'net'], ['t', 'g1'], ['p', CHURCH], ['card', '1', JSON.stringify(envelope)]],
    content: body,
  };
}

// The handful of names Bubble → Row → ReactionsRow → FinanceCard take from other app files. The real screen is
// compiled whole and in one piece; these are the genuine siblings (safeImgUrl/safeCssColor) or faithful stubs.
const globalsFor = (React) => ({
  React,
  window: {
    Fellowship: { myPubkey: 'mehex', displayFor: () => ({ handle: 'Grace Community Church', isChurch: true }) },
    addEventListener() {}, removeEventListener() {},
  },
  Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
  UserAvatar: () => null,
  safeCssColor: (c, f) => (typeof c === 'string' && (/^#[0-9a-fA-F]{3,8}$/.test(c.trim()) || /^var\(--[\w-]+\)$/.test(c.trim())) ? c.trim() : (f || 'var(--clay)')),
  safeImgUrl: (v) => { const s = typeof v === 'string' ? v.trim() : ''; return /^data:image\/[a-zA-Z0-9.+-]+;/.test(s) ? s : ''; },
  setTimeout: () => 0, clearTimeout: () => {},
});

const CTX = { church: CHURCH_PROFILE, shareText() {} };

function load(React) {
  return loadScreen('app/screens-chat.jsx', ['Bubble', 'evtToMsg', 'shareTextOf', 'searchableText'], globalsFor(React));
}
function renderBubble(mod, React, draw, m) {
  return draw(mod.Bubble, { m, ctx: CTX, summary: [], live: false });
}
const imgs = (tree) => find(tree, n => n.type === 'img' && typeof n.props.src === 'string');

// ── (1) a finance card renders the figures + the church branding, name-free ──────────────────────────────────
test('a ["card","1",{type:"finance"}] event renders a branded finance card with the figures', () => {
  const { React, draw } = miniReact();
  const mod = load(React);
  const m = mod.evtToMsg(cardEvent());
  assert.equal(m.kind, 'card', 'evtToMsg did not detect the card tag');
  assert.equal(m.text, FALLBACK_BODY, 'the plain-text fallback body must be kept on the card message');

  const tree = renderBubble(mod, React, draw, m);
  const seen = texts(tree).join(' | ');

  // figures — only the card renders these (the fallback body above carries none of them)
  assert.match(seen, /£12,345\.00/, 'total income is not on the card');
  assert.match(seen, /£9,800\.00/, 'total spending is not on the card');
  assert.match(seen, /£2,545\.00/, 'surplus is not on the card');
  assert.match(seen, /£9,000\.00/, 'an income-by-category figure is not on the card');
  assert.match(seen, /£3,345\.00/, 'the second income figure is not on the card');
  assert.match(seen, /£5,123\.00/, 'a closing fund balance is not on the card');
  assert.match(seen, /£1,800\.00/, 'the second fund balance is not on the card');
  // aggregate labels + the "aggregate figures only" footer
  assert.match(seen, /Income by category/);
  assert.match(seen, /Fund balances/);
  assert.match(seen, /Surplus/);
  assert.match(seen, /aggregate figures only/i);

  // branding: the church's OWN logo (the data: URI from the profile, never from the post) is on the card
  assert.ok(imgs(tree).some(i => i.props.src === LOGO), 'the church logo from the profile is not rendered on the card');
});

// ── (1b) the church BANNER + the treasurer's NOTE render (2026-10-30 owner device-test feedback) ─────────────
test("the church banner and the treasurer's note render on the card", () => {
  const { React, draw } = miniReact();
  const mod = load(React);
  const env = JSON.parse(JSON.stringify(ENVELOPE));
  env.sections.push({ kind: 'note', text: 'Thank you for your faithful giving this quarter.' });
  const tree = renderBubble(mod, React, draw, mod.evtToMsg(cardEvent(env)));
  const seen = texts(tree).join(' | ');

  // the treasurer's note (heading + text) — only the new note section renders these
  assert.match(seen, /Treasurer/, 'the treasurer-note heading is not on the card');
  assert.match(seen, /faithful giving this quarter/, 'the treasurer-note text is not on the card');

  // the church BANNER from the profile (never from the post) renders alongside the logo
  assert.ok(imgs(tree).some(i => i.props.src === BANNER), 'the church banner from the profile is not rendered on the card');
  assert.ok(imgs(tree).some(i => i.props.src === LOGO), 'the church logo is not rendered alongside the banner');
});

// ── (1c) branded:false → a plain card (no banner, no logo) that still carries the figures ────────────────────
test('branded:false renders a plain card — no banner, no logo — but keeps the figures', () => {
  const { React, draw } = miniReact();
  const mod = load(React);
  const env = JSON.parse(JSON.stringify(ENVELOPE));
  env.branded = false;
  const tree = renderBubble(mod, React, draw, mod.evtToMsg(cardEvent(env)));
  const seen = texts(tree).join(' | ');
  assert.equal(imgs(tree).length, 0, 'branded:false must suppress BOTH the banner and the logo');
  assert.match(seen, /GC/, 'the initials fallback must show when branding is off');
  assert.match(seen, /£12,345\.00/, 'the figures must still render on an unbranded card');
});

test('the finance card leaks NO member or donor name even if the envelope smuggles one in', () => {
  // The renderer must read ONLY the aggregate fields (summary totals; rows[].name + amount/balance). Plant
  // personal names in fields it does not read — if it ever surfaced one, aggregate privacy would be broken.
  const sneaky = JSON.parse(JSON.stringify(ENVELOPE));
  sneaky.sections[0].topDonor = 'Jane Smith';                       // not a field the card reads
  sneaky.sections[1].rows[0].contributors = ['John Doe'];           // not a field the card reads
  sneaky.donors = [{ name: 'Mary Okafor', amount: 50000 }];         // not a section the card reads

  const { React, draw } = miniReact();
  const mod = load(React);
  const tree = renderBubble(mod, React, draw, mod.evtToMsg(cardEvent(sneaky)));
  const seen = texts(tree).join(' | ');
  for (const name of ['Jane Smith', 'John Doe', 'Mary Okafor']) {
    assert.ok(!seen.includes(name), `a per-person name leaked onto the aggregate card: ${name}`);
  }
  // the aggregate category/fund labels — the only names a statement carries — still render
  assert.match(seen, /Giving/);
  assert.match(seen, /General/);
});

// ── (2) an unknown card.type degrades to the text body ────────────────────────────────────────────────────────
test('an unknown card.type falls back to the plain-text body (forward-compat)', () => {
  const { React, draw } = miniReact();
  const mod = load(React);
  const m = mod.evtToMsg(cardEvent({ type: 'mystery-future-type', title: 'X', sections: [] }, 'ONLY THE BODY SHOWS'));
  assert.equal(m.kind, 'card', 'the card tag is still parsed');
  const tree = renderBubble(mod, React, draw, m);
  assert.match(texts(tree).join(' | '), /ONLY THE BODY SHOWS/, 'an unknown card type must show its text body');
  assert.equal(imgs(tree).length, 0, 'an unknown card type must not render a card logo');
});

// ── (3) no regression: a plain post, and existing verse/devotional cards, render as before ───────────────────
test('a plain text post renders as before — no card, no logo', () => {
  const { React, draw } = miniReact();
  const mod = load(React);
  const m = mod.evtToMsg({ id: 'p1', pubkey: 'someone', created_at: 1, tags: [['t', 'g1']], content: 'Hello everyone' });
  assert.equal(m.kind, undefined, 'a plain post must have no special kind');
  assert.equal(m.text, 'Hello everyone');
  const tree = renderBubble(mod, React, draw, m);
  assert.match(texts(tree).join(' | '), /Hello everyone/);
  assert.equal(imgs(tree).length, 0, 'a plain post must render no image');
});

test('an existing verse card still renders unchanged', () => {
  const { React, draw } = miniReact();
  const mod = load(React);
  const m = mod.evtToMsg({ id: 'v1', pubkey: 'x', created_at: 1, tags: [['k', 'verse']], content: JSON.stringify({ text: 'For God so loved the world', ref: 'John 3:16', version: 'NIV' }) });
  assert.equal(m.kind, 'verse');
  const seen = texts(renderBubble(mod, React, draw, m)).join(' | ');
  assert.match(seen, /For God so loved the world/);
  assert.match(seen, /John 3:16/);
});

test('an existing devotional card still renders unchanged', () => {
  const { React, draw } = miniReact();
  const mod = load(React);
  const m = mod.evtToMsg({ id: 'd1', pubkey: 'x', created_at: 1, tags: [['k', 'devotional']], content: JSON.stringify({ title: 'Morning Light', excerpt: 'A short reading', ref: 'Psalm 23' }) });
  assert.equal(m.kind, 'devotional');
  const seen = texts(renderBubble(mod, React, draw, m)).join(' | ');
  assert.match(seen, /Morning Light/);
  assert.match(seen, /DEVOTIONAL/);
});

// ── (4) malformed card json never throws and falls back to text ───────────────────────────────────────────────
test('malformed card json does not throw and falls back to the text body', () => {
  const { React, draw } = miniReact();
  const mod = load(React);
  const ev = { id: 'bad', pubkey: CHURCH, created_at: 1, tags: [['t', 'g1'], ['card', '1', '{not valid json']], content: 'FALLBACK ON BAD JSON' };
  let m;
  assert.doesNotThrow(() => { m = mod.evtToMsg(ev); }, 'evtToMsg threw on malformed card json');
  assert.notEqual(m.kind, 'card', 'malformed json must not produce a card');
  assert.equal(m.text, 'FALLBACK ON BAD JSON');
  assert.match(texts(renderBubble(mod, React, draw, m)).join(' | '), /FALLBACK ON BAD JSON/);
});

test('a card tag carrying a non-object (string/number) falls through to text', () => {
  const { React, draw } = miniReact();
  const mod = load(React);
  for (const payload of ['"just a string"', '42', 'null', '[1,2,3]']) {
    const ev = { id: 'x', pubkey: CHURCH, created_at: 1, tags: [['t', 'g1'], ['card', '1', payload]], content: 'PLAIN FALLBACK' };
    const m = mod.evtToMsg(ev);
    assert.notEqual(m.kind, 'card', `a non-object card body (${payload}) must not render as a card`);
    assert.match(texts(renderBubble(mod, React, draw, m)).join(' | '), /PLAIN FALLBACK/);
  }
});

// searchableText / shareTextOf cover the card so search + press-and-hold share still work
test('searchableText and shareTextOf cover a card (title + period + body)', () => {
  const { React } = miniReact();
  const mod = load(React);
  const s = mod.searchableText(cardEvent());
  assert.match(s, /Grace Community Church/);
  assert.match(s, /Q3 2026/);
  assert.match(s, /Open the app/);                                   // the body is searchable too
  assert.equal(mod.shareTextOf(mod.evtToMsg(cardEvent())), FALLBACK_BODY, 'sharing a card must share its text body');
});

// ── (5) DELETION: disable the finance render branch in a COPY → the card stops rendering ─────────────────────
// CLAUDE.md "sabotage must be scoped": the anchor is asserted unique first, then disabled, in a scratchpad copy
// (the tree is never touched). The sabotage is read by RENDER, not by source text, so `false &&` is a valid
// behavioural disable here (rule 3 only bites text-matching assertions, of which this has none).
test('DELETION: with the finance branch disabled the card stops rendering and the body shows', () => {
  const src = readFileSync(join(ROOT, 'app/screens-chat.jsx'), 'utf8');
  const ANCHOR = 'if (c.type === \'finance\') {';
  assert.equal(src.split(ANCHOR).length - 1, 1, 'the finance-card anchor is not unique — re-scope this sabotage');

  const dir = mkdtempSync(join(tmpdir(), 'trin-card-'));
  try {
    const sabPath = join(dir, 'screens-chat.jsx');
    writeFileSync(sabPath, src.replace(ANCHOR, 'if (false && c.type === \'finance\') {'));

    // compile + load the sabotaged copy the same way loadScreen does (reply-kit prepended, one new-Function scope)
    const { React, draw } = miniReact();
    const g = globalsFor(React);
    const names = Object.keys(g);
    const esbuild = join(ROOT, 'node_modules/.bin/esbuild');
    const kit = execFileSync(esbuild, [join(ROOT, 'app/reply-kit.jsx'), '--jsx=transform', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const js = execFileSync(esbuild, [sabPath, '--jsx=transform', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const mod = new Function(...names, kit + '\n' + js + '\nreturn { Bubble, evtToMsg };')(...names.map(k => g[k]));

    const m = mod.evtToMsg(cardEvent());
    assert.equal(m.kind, 'card', 'control: evtToMsg still detects the card (only the render branch is disabled)');
    const seen = texts(draw(mod.Bubble, { m, ctx: CTX, summary: [], live: false })).join(' | ');

    assert.ok(!/£12,345\.00/.test(seen), 'the card still rendered the figures with its branch disabled — the test is not pinned to the branch');
    assert.equal(imgs(draw(mod.Bubble, { m, ctx: CTX, summary: [], live: false })).length, 0, 'the branded logo still rendered with the branch disabled');
    assert.match(seen, /Open the app/, 'with the card branch gone the post must fall back to its plain-text body');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
