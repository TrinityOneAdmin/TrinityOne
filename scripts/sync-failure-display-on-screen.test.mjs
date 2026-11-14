// THE SCREEN HALF of the failed-sync display (plan 2026-11-14): a refused church shows "Needs attention" on its relay
// row, the clock variant, the quiet "couldn't reach" line, "Check again", and the Settings detail behind them.
// Run: node --test scripts/sync-failure-display-on-screen.test.mjs
//
// Rule 1 (point of use) + rule 3 (never text-match app/*.jsx). Two things run for real:
//   · the REAL bundle functions relaySyncStates / relaySyncState / _nip98 from vendor/steward.js (scripts/sync-status-lift.mjs),
//   · the REAL DashRelaysCard from app/stew-dashboard.jsx, compiled with the build's own jsx transform.
// The fake fetch answers /sync-status ONLY for a request that names the active church in the query, is bound to that
// exact URL and carries a valid NIP-98 proof signed for that church; anything else is a 401. So deleting the query, the
// signature or the chip from the shipped code turns this red. Nothing here matches text in a .jsx file.
//
// node_modules is hard-linked in the worktree so esbuild runs (a bare worktree would fail on esbuild ENOENT).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { liftSteward } from './sync-status-lift.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const nowS = () => Math.floor(Date.now() / 1000);

function sliceComponent(src, anchor) {
  const start = src.indexOf(anchor); assert.ok(start > 0, `${anchor} is not in app/stew-dashboard.jsx — re-anchor`);
  const end = src.indexOf('\nfunction ', start + anchor.length); assert.ok(end > start, `no top-level function follows ${anchor}`);
  return src.slice(start, end);
}
function mini() {
  const states = []; const memos = []; const effDeps = []; let queued = [];
  let i = 0, mi = 0, ei = 0;
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, n) => Object.is(v, b[n]));
  const React = {
    useState(init) { const k = i++; if (!(k in states)) states[k] = typeof init === 'function' ? init() : init;
      return [states[k], (v) => { states[k] = typeof v === 'function' ? v(states[k]) : v; }]; },
    useMemo(f, deps) { const k = mi++; if (!memos[k] || !same(memos[k].deps, deps)) memos[k] = { deps, v: f() }; return memos[k].v; },
    useCallback(f, deps) { return React.useMemo(() => f, deps); },
    useEffect(fn, deps) { const k = ei++; if (!(k in effDeps) || !same(effDeps[k], deps)) { effDeps[k] = deps; queued.push(fn); } },
    useRef: () => ({ current: null }),
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
    Fragment: 'Fragment',
  };
  const flush = () => { const r = queued; queued = []; r.forEach(f => { try { f(); } catch (e) {} }); };
  return { React, reset: () => { i = 0; mi = 0; ei = 0; }, flush };
}
const find = (n, p, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => find(c, p, out)); return out; }
  if (p(n)) out.push(n);
  (n.kids || []).forEach(c => find(c, p, out));
  return out;
};
const texts = (n, out = []) => {
  if (n == null || n === false) return out;
  if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; }
  if (Array.isArray(n)) { n.forEach(c => texts(c, out)); return out; }
  (n.kids || []).forEach(c => texts(c, out));
  return out;
};
const textOf = (n) => texts(n).join(' ').replace(/\s+/g, ' ');
async function compileComponent(anchor, name, globals) {
  const src = sliceComponent(DASH, anchor);
  const tmp = join(tmpdir(), name + '-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try { writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__ui_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const pre = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64')))[name];
}

// ── the world: two relays that answer the signed route, one OLD relay that does not know it ─────────────────────
const SK = generateSecretKey(), PUB = getPublicKey(SK);
const X = 'wss://x.example/relay', Y = 'wss://y.example/relay', OLD = 'wss://old.example/relay';
const boxOf = (u) => u.replace(/^wss:/, 'https:').replace(/\/relay$/, '');

// church blocks the "relays" report, by relay
function world(blocks, { boxSync = {}, hole = [] } = {}) {
  const log = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url); log.push({ url: String(url), path: u.pathname, method: (init.method || 'GET') });
    const origin = u.origin;
    if (hole.includes(origin)) return new Promise(() => {});   // a black-holed box: never answers, never errors
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (u.pathname === '/status') return json(200, { sync: boxSync[origin] || { at: 100, imported: 0, ok: false, error: 'a peer refused this box - its trust list or a clock may be wrong', running: false, peers: 1 } });
    if (u.pathname !== '/sync-status') return json(404, { error: 'not found' });
    // The relay answers only a request that is correctly addressed and signed. Everything else is the one flat refusal.
    const refuse = () => json(401, { error: 'unauthorized' });
    try {
      const m = /^Nostr\s+(.+)$/.exec((init.headers || {}).Authorization || ''); if (!m) return refuse();
      const ev = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
      if (ev.kind !== 27235 || !verifyEvent(ev) || Math.abs(nowS() - ev.created_at) > 300) return refuse();
      const tag = (k) => (ev.tags.find(t => t[0] === k) || [])[1];
      if (tag('u') !== String(url) || tag('church') !== PUB || u.searchParams.get('church') !== PUB) return refuse();
      if (ev.pubkey !== PUB) return refuse();
    } catch { return refuse(); }
    const b = blocks[origin];
    return b ? json(200, { church: b }) : json(404, { error: 'not found' });
  };
  return { fetch, log };
}
const block = (o) => ({ peers: 1, state: 'reached', reason: '', at: nowS() - 240, lastReachedAt: nowS() - 240, running: false, refusedPasses: 0, ...o });

// ── the real card, fed by the real bundle ────────────────────────────────────────────────────────────────────
async function card({ blocks, relays = [X, Y], delegated = false, network = false, boxSync, hole, openPage }) {
  const w = world(blocks, { boxSync, hole });
  const lifted = liftSteward({ sk: SK, pub: PUB, relays: () => relays, fetch: w.fetch, viewingNetwork: () => network });
  const { React, reset, flush } = mini();
  const A8 = '6a4267558c9990d0391b3472bac9735d33a5e99b5c7cb0e49bdece7ea6b770f2';
  const Steward = Object.assign(lifted.Steward, {
    provenRelayPub: () => A8, classifyRelay: () => 'neutral', sharedRelayKeys: () => [A8], relayNet: async () => [], ownRelay: () => '',
    isSelfHosted: () => false, relayNameFor: () => '', canRemoveRelay: () => true, removeRelay: () => true, isDelegated: () => delegated,
  });
  const win = { Steward, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {} };
  lifted.stubs.window.Steward = Steward;
  const STATUS = relays.map(url => ({ url, status: 'on', ms: 20, member: true }));
  const globals = {
    React, window: win, Icon: () => null, writeSyncCache: () => {}, readSyncCache: () => null,
    SkPill: ({ children }) => ({ type: 'span', props: {}, kids: [children] }), SkCard: ({ children }) => ({ type: 'div', props: {}, kids: [children] }),
    relayRejectionActive: false, noteRelayRejection: () => {}, clearRelayRejection: () => {}, shortNpub: () => '', dropRefusalsNotListed: () => {},
    useRelayBackupState: () => ({ status: STATUS, backup: { boxes: 2, online: 2, syncOn: true } }),
    location: { host: 'app.trinityone.church' }, relaysThatRefused: () => [],
    Panel: ({ children }) => ({ type: 'section', props: {}, kids: [children] }),
  };
  const Comp = await compileComponent('function DashRelaysCard()', 'DashRelaysCard', globals);
  const draw = () => { reset(); const t = Comp({ onOpenPage: openPage }); flush(); return t; };
  draw();
  await new Promise(r => setTimeout(r, 20));
  return { tree: draw(), draw, log: w.log, flush, settle: () => new Promise(r => setTimeout(r, 20)) };
}
const rowFor = (tree, label) => find(tree, n => n && n.props && n.props.title && n.props.title === undefined)[0] || null;
const chipOf = (tree, state) => find(tree, n => n && n.props && n.props['data-sync'] === state);
const detail = (tree, state) => find(tree, n => n && n.props && n.props['data-sync-detail'] === state);

test('a church refused two passes in a row shows "Needs attention" on its row, with the approved explanation and the owner\'s instruction', async () => {
  const c = await card({ blocks: { [boxOf(X)]: block({ state: 'refused', reason: 'trust', refusedPasses: 2 }), [boxOf(Y)]: block({ state: 'reached' }) } });
  const chips = chipOf(c.tree, 'attention');
  assert.equal(chips.length, 1, 'the refused relay must carry the "Needs attention" chip — nothing on screen shows a failed sync');
  assert.match(textOf(chips[0]), /Needs attention/);
  assert.equal(chipOf(c.tree, 'synced').length, 1, 'the OTHER relay, reached, still reads Synced ✓');
  const d = textOf(detail(c.tree, 'attention'));
  assert.match(d, /Another of your relays is turning this one away\./);
  assert.match(d, /Your messages are safe on every relay that’s answering\./);
  assert.match(d, /when all your relays show Answering, open Settings → Relays → Keep relays in sync and save it again\./);
  assert.doesNotMatch(d, /ask the person who holds the church key/, 'the owner\'s console is not told to ask somebody else');
  assert.match(d, /This row updates after the next copy round\./);
  assert.doesNotMatch(d, /few minutes|fixes itself|add a relay|remove|edit/i, 'no promise of a time, and never an add/remove/edit cure for a refusal');
});

test('the request really was signed for the ACTIVE church and bound to its URL (the fake answers nothing else)', async () => {
  const c = await card({ blocks: { [boxOf(X)]: block({ state: 'refused', reason: 'trust', refusedPasses: 2 }) }, relays: [X] });
  const asked = c.log.filter(l => l.path === '/sync-status');
  assert.equal(asked.length, 1);
  assert.match(asked[0].url, new RegExp('/sync-status\\?church=' + PUB + '$'));
  assert.equal(chipOf(c.tree, 'attention').length, 1, 'with the query and the proof intact the refusal is shown');
});

test('a helper\'s console is told to ask the church-key holder, not to do it itself', async () => {
  const c = await card({ delegated: true, blocks: { [boxOf(X)]: block({ state: 'refused', reason: 'trust', refusedPasses: 2 }) }, relays: [X] });
  const d = textOf(detail(c.tree, 'attention'));
  assert.match(d, /ask the person who holds the church key to open Settings → Relays → Keep relays in sync and save it again\./);
  assert.doesNotMatch(d, /when all your relays show Answering/);
});

test('REFUSED OUTRANKS CATCHING UP: a church still being refused is not softened to "Catching up…"', async () => {
  const c = await card({ blocks: { [boxOf(X)]: block({ state: 'refused', reason: 'trust', refusedPasses: 3, running: true }) }, relays: [X] });
  assert.equal(chipOf(c.tree, 'attention').length, 1); assert.equal(chipOf(c.tree, 'syncing').length, 0);
});

test('ONE refused pass shows nothing red, and never "Synced"', async () => {
  const c = await card({ blocks: { [boxOf(X)]: block({ state: 'refused', reason: 'trust', refusedPasses: 1 }) }, relays: [X] });
  assert.equal(chipOf(c.tree, 'attention').length, 0); assert.equal(chipOf(c.tree, 'clock').length, 0);
  assert.equal(chipOf(c.tree, 'synced').length, 0);
});

test('a time refusal says "Check the clock" with its own words and no promise of a time', async () => {
  const c = await card({ blocks: { [boxOf(X)]: block({ state: 'refused', reason: 'time', refusedPasses: 2 }) }, relays: [X] });
  assert.match(textOf(chipOf(c.tree, 'clock')[0]), /Check the clock/);
  const d = textOf(detail(c.tree, 'clock'));
  assert.match(d, /A clock looks wrong, so your relays are turning each other away\. Nothing is lost\./);
  assert.match(d, /Set time automatically/); assert.match(d, /This row clears after the next copy round\./);
  assert.doesNotMatch(d, /few minutes|fixes itself/i);
});

test('COULD NOT REACH the other relay: a quiet grey line, never "Synced"', async () => {
  const c = await card({ blocks: { [boxOf(X)]: block({ state: 'unreached' }) }, relays: [X] });
  const q = chipOf(c.tree, 'unreached');
  assert.equal(q.length, 1);
  assert.match(textOf(q[0]), /Couldn’t reach your other relay last time/);
  assert.equal(chipOf(c.tree, 'synced').length, 0);
  assert.doesNotMatch(textOf(c.tree), /Synced ✓/, 'the Synced ✓ chip must not appear anywhere for a relay we could not reach');
  assert.equal(find(c.tree, n => n && n.props && n.props['data-sync-status'] === 'synced').length, 0);
  assert.equal(q[0].props.style.fontWeight, undefined, 'a quiet line, not a bold alarm');
});

test('a church with no partners reads "Not syncing" from its OWN block even though the box synced other churches', async () => {
  const c = await card({ blocks: { [boxOf(X)]: block({ peers: 0, state: 'none', at: 0 }) }, relays: [X], boxSync: { [boxOf(X)]: { at: nowS(), imported: 3, ok: true, error: '', running: false, peers: 4 } } });
  assert.equal(chipOf(c.tree, 'island').length, 1); assert.equal(chipOf(c.tree, 'synced').length, 0);
});

test('an OLD relay (no /sync-status route) keeps today\'s chip from /status, and a refused-looking box-wide flag is still not red', async () => {
  const c = await card({ blocks: {}, relays: [OLD], boxSync: { [boxOf(OLD)]: { at: nowS(), imported: 0, ok: true, error: '', running: false, peers: 1 } } });
  assert.equal(chipOf(c.tree, 'synced').length, 1);
  const c2 = await card({ blocks: {}, relays: [OLD] });   // box-wide ok:false
  assert.equal(chipOf(c2.tree, 'attention').length, 0, 'box-wide sync.ok === false must never redden a church');
});

test('a NETWORK identity sends no per-church read at all', async () => {
  const c = await card({ network: true, blocks: { [boxOf(X)]: block({ state: 'refused', reason: 'trust', refusedPasses: 5 }) }, relays: [X] });
  assert.equal(c.log.filter(l => l.path === '/sync-status').length, 0);
  assert.equal(chipOf(c.tree, 'attention').length, 0);
});

test('"Check again" only RE-READS (no /sync-now, no other write) and says when the relay last checked', async () => {
  const c = await card({ blocks: { [boxOf(X)]: block({ state: 'refused', reason: 'trust', refusedPasses: 2, at: nowS() - 240 }) }, relays: [X] });
  assert.match(textOf(detail(c.tree, 'attention')), /relay last checked 4 min ago/);
  const btn = find(c.tree, n => n && n.type === 'button' && textOf(n) === 'Check again');
  assert.ok(btn.length >= 1, 'no Check again button on a refused row');
  const before = c.log.length;
  btn[0].props.onClick(); c.draw(); await c.settle();
  const after = c.log.slice(before);
  assert.ok(after.length >= 1, 'Check again did not re-read');
  for (const l of after) { assert.equal(l.method, 'GET', 'a re-read must be a GET: ' + l.url); assert.ok(['/status', '/sync-status'].includes(l.path), 'Check again touched ' + l.path + ' — it must only re-read'); }
});

test('ONE BLACK-HOLED RELAY DOES NOT HOLD UP THE OTHERS: rows paint as each answer lands, with no timeout', async () => {
  const w = world({ [boxOf(Y)]: block({ state: 'reached' }) }, { hole: [boxOf(X)] });
  const { Steward } = liftSteward({ sk: SK, pub: PUB, relays: () => [X, Y], fetch: w.fetch });
  const landed = [];
  const all = Steward.relaySyncStates((e) => landed.push(e.url));
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(landed, [Y], 'the answering relay must be reported while the black-holed one is still pending');
  let done = false; all.then(() => { done = true; }); await new Promise(r => setTimeout(r, 20));
  assert.equal(done, false, 'the call waits for the black hole rather than inventing a cutoff');
});

test('the Settings detail (C) shows status, last good copy, last checked and the explanation behind the row', async () => {
  const c = await card({ blocks: { [boxOf(X)]: block({ state: 'refused', reason: 'trust', refusedPasses: 2, lastReachedAt: nowS() - 660 }), [boxOf(Y)]: block({ state: 'reached' }) } });
  const sec = find(c.tree, n => n && n.props && n.props['data-sync-section'] === 'detail');
  assert.equal(sec.length, 1, 'the detail section is missing');
  const t = textOf(sec[0]);
  assert.match(t, /Needs attention/); assert.match(t, /Last good copy 11 min ago/); assert.match(t, /Relay last checked 4 min ago/);
  assert.match(t, /Syncing switched on Yes/); assert.match(t, /Your relays hold the same history\. Nothing to do\./);
});

test('"Not syncing" links to the existing Add a relay page and to nothing else', async () => {
  let opened = null;
  const c = await card({ blocks: { [boxOf(X)]: block({ peers: 0, state: 'none', at: 0 }) }, relays: [X], openPage: (k) => { opened = k; } });
  const links = find(detail(c.tree, 'island'), n => n && n.props && n.props.role === 'button' && textOf(n) === 'Add a relay');
  assert.equal(links.length, 1, 'the add-a-relay advice is said ONCE, not under the row and again in the Settings detail');
  opened = null; links[0].props.onClick(); assert.equal(opened, 'add-relay', 'it must open the existing Add a relay page and nothing else');
  assert.equal(find(c.tree, n => n && n.props && n.props['data-sync-detail'] === 'island').length, 1, 'one explanation in the whole card');
});

test('two Not-syncing relays still say the add-a-relay advice only once', async () => {
  const c = await card({ blocks: { [boxOf(X)]: block({ peers: 0, state: 'none', at: 0 }), [boxOf(Y)]: block({ peers: 0, state: 'none', at: 0 }) } });
  assert.equal(chipOf(c.tree, 'island').length, 2, 'both rows still carry their chip');
  assert.equal(find(c.tree, n => n && n.props && n.props['data-sync-detail'] === 'island').length, 1);
});

test('the Settings detail names an unreached relay the same way its row does, never "Not checked yet"', async () => {
  const c = await card({ blocks: { [boxOf(X)]: block({ state: 'unreached' }) }, relays: [X] });
  const sec = textOf(find(c.tree, n => n && n.props && n.props['data-sync-section'] === 'detail')[0]);
  assert.match(sec, /Status Couldn’t reach your other relay last time/);
  assert.doesNotMatch(sec, /Not checked yet/);
});

test('CHECK AGAIN IS NEVER HELD UP BY A RELAY THAT DOES NOT ANSWER: with X black-holed, Y\'s button is usable and re-reads', async () => {
  const c = await card({ hole: [boxOf(X)], blocks: { [boxOf(Y)]: block({ state: 'refused', reason: 'trust', refusedPasses: 2 }) } });
  const btns = () => find(c.draw(), n => n && n.type === 'button' && /^(Check again|Checking…)$/.test(textOf(n)));
  const mine = btns();
  assert.ok(mine.length >= 1, 'Y is refused so it has a Check again button');
  for (const b of mine) { assert.ok(!b.props.disabled, 'the button must never be disabled while another relay is still outstanding'); assert.equal(textOf(b), 'Check again', 'Y has answered, so its button must not say Checking…'); }
  const before = c.log.length;
  mine[0].props.onClick(); c.draw(); await c.settle();
  assert.ok(c.log.length > before, 'clicking it must start a fresh read even though X never answered');
});
