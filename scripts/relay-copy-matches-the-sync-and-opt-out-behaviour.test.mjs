// THE RELAY COPY TELLS THE TRUTH THE RELAY CODE ALREADY LIVES BY (plan A3 + B3 + B4, 2026-11-20).
//   Run: node --test scripts/relay-copy-matches-the-sync-and-opt-out-behaviour.test.mjs
//
// A, B1 and A2 are already built; this is the user-facing copy that has to MATCH them, and the companion help
// entry. Three claims, each proved by RENDERING the real component and reading the drawn tree — never by
// matching text in app/*.jsx, which ships unbundled so a `false &&` reverted control leaves every word in place
// (CLAUDE.md rule 3). Each test fails if the copy / link is deleted FROM THE SCREEN (rule 1):
//
//   A3  the Add/Connect consent line names that the box will hold the FULL COPY of the church's records — Add
//       grants sync trust (signRelay chains a forced syncHeal that signs the proved box into trinityone/relays).
//   B3  the community-relays switch states, in one plain sentence, that up to `publicTarget` boxes are adopted
//       UNLESS turned off, and only ones that PROVE they run TrinityOne and are REGISTERED to the church.
//   B4  a short high-risk help entry is reachable FROM the switch (a real StewHelpLink → the real StewardHelp
//       dialog) and renders its opt-out guidance; it is listed among the console's own guides (STEW_HELP_IDS).
//
// Nothing here asserts a claim the code does not back (rule 4): the three facts are what A/B1/A2 shipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScreen, miniReact, find, texts, button } from './render-jsx-screen.mjs';

// The console's classic scripts in ONE scope, in steward.html's load order — so StewHelpLink and StewardHelp
// are the REAL components (help files), beside the REAL DashAddRelayCard / DashCommunityRelaysCard / RelayConsent.
const FILES = ['app/help-illustrations.jsx', 'app/help-data.jsx', 'app/screens-help.jsx', 'app/stew-modal.jsx', 'app/stew-help.jsx', 'app/stew-dashboard.jsx'];
const JS = FILES.map(compileScreen).join('\n;\n');
const WANT = ['DashAddRelayCard', 'DashCommunityRelaysCard', 'RelayConsent', 'StewardHelp', 'StewHelpLink'];

function boot(over = {}) {
  const { React, draw } = miniReact();
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const winListeners = {};
  const win = {
    useStewardRelays: () => [], useStewardChurch: () => ({ name: 'St Aidan’s' }),
    addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
    removeEventListener(t, f) { winListeners[t] = (winListeners[t] || []).filter((x) => x !== f); },
    dispatchEvent() { return true; }, localStorage,
    // the relay prefs the switch reads (owner console: no actingChurch). Overridable per test.
    Steward: {
      relayPrefs: async () => ({ complete: true, publicAuto: true, publicTarget: 4, chosen: [] }),
      setPublicAuto: async () => ({ written: true }), setPublicTarget: async () => ({ written: true }),
      addRelay: (u) => String(u).trim(), knownRelay: () => '',
      signRelay: async (u) => ({ proven: [{ url: u, pubkey: 'a'.repeat(64) }], entries: [{ pubkey: 'a'.repeat(64) }], published: true }),
      ...(over.steward || {}),
    },
  };
  const globals = {
    React, window: win, localStorage,
    location: { host: 'app.example', hostname: 'app.example' }, navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} },
    history: { pushState() {}, replaceState() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: function Icon() { return null; }, Halo: function Halo() { return null; },
    SkPill: function SkPill() { return null; }, SkBadge: function SkBadge() { return null; },
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { ' + WANT.join(', ') + ' };')(...names.map((k) => globals[k]));
  for (const n of WANT) assert.equal(typeof mod[n], 'function', `${n} is not a component any more — re-anchor this test`);
  assert.ok(Array.isArray(win.HelpData && win.HelpData.articles), 'help-data.jsx did not put its articles on window');
  return { mod, win, draw, winListeners };
}

const settle = () => new Promise((r) => setImmediate(r));
const said = (n) => texts(n).join(' ').replace(/\s+/g, ' ').trim();

// ── A3: the Add/Connect consent says the box will hold the full copy of the church's records ───────────────────
test('A3: the Add/Connect consent names that the box will hold the FULL COPY of the church’s records', async () => {
  const { mod, draw } = boot();
  const drawCard = () => draw(mod.DashAddRelayCard, {});
  let tree = drawCard(); await settle(); tree = drawCard();
  const input = find(tree, (n) => n.type === 'input' && n.props['aria-label'] === 'Relay address to add');
  assert.equal(input.length, 1, 're-anchor: the relay address field is gone');
  input[0].props.onChange({ target: { value: 'wss://second.aidans.example/relay' } });
  button(drawCard(), 'Add relay')[0].props.onClick();
  await settle();
  const s = said(drawCard());
  // the existing consent is kept verbatim …
  assert.match(s, /Connecting this relay lets your whole church’s data go to it\./, 're-anchor: the base consent line changed');
  // … and the A3 sentence is added — the point of this test. Delete it and this goes red.
  assert.match(s, /hold the full copy of your church’s records/, 'ADD NO LONGER SAYS THE BOX HOLDS THE FULL COPY — Add grants sync trust (A3), and the consent must say so');
});

// ── B3: the community-relays switch states the default-on behaviour plainly ────────────────────────────────────
test('B3: the switch states up-to-N, opt-out, proven + registered — in one plain sentence', async () => {
  const { mod, draw } = boot({ steward: { relayPrefs: async () => ({ complete: true, publicAuto: true, publicTarget: 4, chosen: [] }) } });
  const drawCard = () => draw(mod.DashCommunityRelaysCard, {});
  drawCard(); await settle();
  const s = said(drawCard());
  assert.match(s, /[Uu]nless you turn this off/, 'the consent sentence does not say the adoption is OPT-OUT');
  assert.match(s, /up to 4\b/, 'the sentence does not name the church’s target (publicTarget) — “up to N”');
  assert.match(s, /prove they run TrinityOne/, 'the sentence does not say a box must PROVE it runs TrinityOne');
  assert.match(s, /accept your church/, 'the sentence does not say a box must be REGISTERED to the church (B2)');
});

test('B3: the same switch still drives publicAuto (the sentence sits on a live control, not decoration)', async () => {
  const calls = [];
  const { mod, draw } = boot({ steward: {
    relayPrefs: async () => ({ complete: true, publicAuto: false, publicTarget: 4, chosen: [] }),
    setPublicAuto: async (on) => { calls.push(on); return { written: true }; },
  } });
  const drawCard = () => draw(mod.DashCommunityRelaysCard, {});
  drawCard(); await settle();
  const sw = find(drawCard(), (n) => n.type === 'button' && n.props.role === 'switch' && n.props['aria-label'] === 'Use community relays automatically');
  assert.equal(sw.length, 1, 're-anchor: the community-relays switch is gone');
  await sw[0].props.onClick();
  await settle();
  assert.deepEqual(calls, [true], 'the switch beside the consent sentence is wired to nothing');
});

// ── B4: a high-risk help entry, reachable FROM the switch, that renders its opt-out guidance ───────────────────
// The real StewHelpLink inside the card opens the real StewardHelp dialog on the real article — end to end.
test('B4: the switch links to a high-risk guide, and opening it renders the opt-out guidance', async () => {
  const { mod, draw } = boot();
  const drawCard = () => draw(mod.DashCommunityRelaysCard, {});
  drawCard(); await settle();
  // the link is a real button (not a tooltip) carrying the guide's label — StewHelpLink sets title "Open the guide: …"
  const link = find(drawCard(), (n) => n.type === 'button' && /^Open the guide: /.test((n.props || {}).title || ''));
  assert.equal(link.length, 1, 'THE HIGH-RISK GUIDE IS NOT LINKED FROM THE SWITCH — a church in danger has no one-tap path to the opt-out (B4)');
  link[0].props.onClick();
  const tree = drawCard();
  const dlg = find(tree, (n) => n.props && n.props.role === 'dialog' && n.props['aria-label'] === 'Help');
  assert.equal(dlg.length, 1, 'tapping the link mounted no help dialog');
  const s = said(dlg[0]);
  assert.match(s, /high-risk situation/i, 'the guide that opened is not the high-risk one');
  assert.match(s, /turn (this|it) off|automatically/i, 'the high-risk guide does not tell a church how to turn automatic community relays off');
});

test('B4: the high-risk guide is one of the console’s own guides, and its body reaches the screen', async () => {
  const { mod, win, draw } = boot();
  const article = win.HelpData.articles.find((a) => a.id === 'console-high-risk-relays');
  assert.ok(article && Array.isArray(article.blocks), 'help-data.jsx has no "console-high-risk-relays" article with blocks');
  // StewardHelp only lists/open ids in STEW_HELP_IDS (stewHelpArticles filters on it) — so opening it here proves
  // it is REACHABLE in the console's Help, not merely present in the data.
  const drawHelp = () => draw(mod.StewardHelp, { onClose() {}, initialId: 'console-high-risk-relays' });
  drawHelp(); await settle();
  const tree = drawHelp();
  const dlg = find(tree, (n) => n.props && n.props.role === 'dialog' && n.props['aria-label'] === 'Help');
  assert.equal(dlg.length, 1, 'the help dialog did not open on the high-risk guide');
  const s = said(dlg[0]);
  // the article's OWN words, read from the data at run time — not strings copied into this test (so the test
  // cannot drift from the shipped copy). If the id leaves STEW_HELP_IDS, stewHelpArticles drops it and this fails.
  for (const b of article.blocks) {
    if (b.type === 'p' || b.type === 'note' || b.type === 'callout' || b.type === 'rule') {
      assert.ok(s.includes(b.text.replace(/\s+/g, ' ').trim()), `a ${b.type} block of the high-risk guide did not reach the dialog`);
    }
    if (b.type === 'steps') for (const it of b.items) assert.ok(s.includes(it.replace(/\s+/g, ' ').trim()), `a step of the high-risk guide did not reach the dialog`);
  }
});
