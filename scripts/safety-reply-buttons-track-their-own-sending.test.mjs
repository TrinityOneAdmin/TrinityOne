// "I'M SAFE" AND "I NEED HELP" MUST NOT BOTH SAY "SENDING…" (sim item 42, SIM-VERIFY-2026-10-02).
//   Run: node --test scripts/safety-reply-buttons-track-their-own-sending.test.mjs
//
// THE DEFECT: the two reply buttons on the safety check shared ONE boolean, `sending`, so tapping "I'm safe"
// turned BOTH labels into "Sending…". On the one screen where a frightened person is choosing between the two,
// a button that says "Sending…" about a reply they never chose is the worst label to get wrong.
//
// THE FIX: `sending` names WHICH reply is in flight ('' | 'safe' | 'help'); only that button says "Sending…",
// the other keeps its own label and stays disabled so a second reply cannot overlap the first.
//
// POINT OF USE (CLAUDE.md rule 1, rule 3): both components are compiled from app/screens-today.jsx and DRAWN
// through the miniature React (scripts/render-jsx-screen.mjs); the assertions read the drawn buttons, not the
// source text. The users of the shared state are exactly two components, SafetyDock (rendered by app/app.jsx on
// every tab but Today) and SafetyBanner (Today, and the Care tab with `persistent`); both are driven below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact as renderMini, texts as treeTexts, find as treeFind } from './render-jsx-screen.mjs';

const btn = (tree, re) => treeFind(tree, n => n.type === 'button' && re.test(treeTexts(n).join(' ')));
const label = (b) => treeTexts(b).join(' ').trim();

const CHECK = { id: 'chk1', by: 'b'.repeat(64), message: 'Storm — are you safe?', audience: 'stewards' };
const CTX = { church: { npub: 'npub1church', name: 'St Chad’s' }, care: { settings: { enabled: true } } };

function screen() {
  const { React, draw } = renderMini();
  const Icon = ({ name }) => React.createElement('i', { 'data-icon': name });
  const Stub = (n) => function S(p) { return React.createElement('div', { 'data-stub': n }, p && p.children); };
  // markSafe is HELD OPEN until the test lets it finish, so the draw in between is the "in flight" screen.
  const gate = { release: null, calls: [] };
  const win = { addEventListener() {}, removeEventListener() {}, innerWidth: 360,
    Fellowship: {
      markSafe: (check, s) => { gate.calls.push(s); return new Promise(r => { gate.release = () => r({ ok: true, narrowed: false, reason: '' }); }); },
      subscribeSafetyCheck: (cb) => { cb(CHECK); return () => {}; },
      subscribeCareRequests: () => () => {}, childCareAudience: async () => [] },
    TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1,
             activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) } };
  const globals = {
    React, window: win,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon, ChurchBadge: Stub('ChurchBadge'), SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'),
    Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    lsGet: (k, d) => d, lsSet: () => {}, cx: (...a) => a.filter(Boolean).join(' '),
    useTrinityAudio: () => ({ track: null, playing: false }), todayISO: () => '2026-09-15',
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const mod = loadScreen('app/screens-today.jsx', ['SafetyBanner', 'SafetyDock'], globals);
  const settle = (Comp, props) => { draw(Comp, props); return draw(Comp, props); };
  return { draw, settle, gate, ...mod };
}

for (const [name, props] of [['SafetyBanner', { ctx: CTX, persistent: true }], ['SafetyDock', { ctx: CTX, onOpenToday: () => {} }]]) {
  for (const [tapped, other, tappedRe, otherRe, tappedWas, otherWas] of [
    ['safe', 'help', /I’m safe/, /I need help/, 'I’m safe', 'I need help'],
    ['help', 'safe', /I need help/, /I’m safe/, 'I need help', 'I’m safe'],
  ]) {
    test(name + ': tapping "' + tappedWas + '" says Sending… on THAT button only', async () => {
      const s = screen();
      const Comp = s[name];
      const tree = s.settle(Comp, props);
      const b = btn(tree, tappedRe)[0];
      assert.ok(b && btn(tree, otherRe)[0], 're-anchor: ' + name + ' did not draw both reply buttons');
      assert.equal(label(b), tappedWas, 're-anchor: the idle label changed');
      const pending = b.props.onClick({ stopPropagation() {} });          // NOT awaited: the send is in flight
      assert.deepEqual(s.gate.calls, [tapped], 're-anchor: the tap did not reach markSafe — nothing below is exercised');
      const mid = s.draw(Comp, props);
      const t = btn(mid, /Sending…/);
      assert.equal(t.length, 1,
        'BOTH REPLY BUTTONS READ "Sending…" (or neither does) while one reply is in flight. Drawn buttons: ' +
        JSON.stringify(treeFind(mid, n => n.type === 'button').map(label)));
      assert.equal(btn(mid, tappedRe).length, 0, 'the tapped button still shows its idle label while its reply is in flight');
      const stillOther = btn(mid, otherRe)[0];
      assert.ok(stillOther, 'the button that was NOT tapped lost its own label ("' + otherWas + '")');
      assert.equal(!!stillOther.props.disabled, true,
        'the other reply button is tappable mid-send, so two replies can overlap');
      s.gate.release();
      await pending;
    });
  }
}
