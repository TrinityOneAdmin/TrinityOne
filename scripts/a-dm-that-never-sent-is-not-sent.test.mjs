// A DM THAT WAS NEVER SENT — AND NEVER QUEUED — MUST NOT BE REPORTED AS SENT.
// Run: node --test scripts/a-dm-that-never-sent-is-not-sent.test.mjs
//
// AUDIT 2026-08-30. Both sendDM implementations return `null` from paths that run BEFORE they touch their
// outbox, so on those paths the words are not on the wire, not queued, and not on the screen:
//   · window.Fellowship.sendDM  (src/fellowship.src.js) — `_dmEncrypt` throws;
//   · window.Steward.sendDM     (src/steward.src.js)    — no signing key, no peer hex, or nip04 encrypt throws.
// Commit e06cb36 taught the callers to read `_refused` and `_delivered === false`. It did not teach them that
// `null` is falsy, so a null fell straight through into the success arm.
//
// ALL FOUR CALL SITES (CLAUDE.md rule 2 — this is the complete list; `grep -rn sendDM` over app/):
//   1. app/screens-chat.jsx  sendToPerson   — share a verse to one person: toasted "Sent to Anna".
//   2. app/screens-chat.jsx  DM composer    — cleared the composer and said NOTHING at all.
//   3. app/stew-dashboard.jsx GroupLeadersModal.save — "we’ll message them to let them know", nobody messaged.
//   4. app/stew-dashboard.jsx StewDmWindow.send      — no screen in the console rendered this failure at all.
//
// A NOTE ON dmFailWording: with no `_refused` it returns "we’ll send it as soon as you’re back online". That is
// correct for `_delivered === false` (which IS queued) and a lie for `null` (which is not), so null must never
// be passed to it. Tests below assert that specifically.
//
// The sibling `sendToGroup`/`publishMessage` has the same shape, but publishMessage cannot return null — it
// always finalises and returns an event. It is latent only, and is deliberately left alone.
//
// CLAUDE.md rule 3: app/*.jsx ships UNBUNDLED, so `false && ` in front of a condition leaves every word of it
// in place and any text-matching assertion still passes. Nothing here matches text in app/*.jsx. Handlers are
// lifted and RUN; the two console surfaces are rendered through a miniature React and read out of the tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const CHAT = read('app/screens-chat.jsx');
const STEW = read('app/stew-dashboard.jsx');
const tick = () => new Promise(r => setTimeout(r, 0));

// Lift a handler whose own name is not unique in the file: anchor on something that IS unique inside it,
// then walk back to the declaration that encloses it.
function handlerAround(src, unique, decl, what) {
  const at = src.indexOf(unique);
  assert.notEqual(at, -1, `${what}: "${unique}" is gone — re-anchor this test, do not delete it`);
  assert.equal(src.indexOf(unique, at + 1), -1, `${what}: "${unique}" is no longer unique — re-anchor`);
  const start = src.lastIndexOf(decl, at);
  assert.notEqual(start, -1, `${what}: could not find "${decl}" above it — re-anchor`);
  return fnBody(src, start, what);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. app/screens-chat.jsx — sharing to one person
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const SHARE = fnBody(CHAT, 'const sendToPerson = (m) => {', 'sendToPerson');

function shareTo(result) {
  const toasts = [];
  const scope = {
    FS: { sendDM: async () => result },
    ctx: { toast: (m) => toasts.push(m) },
    asText: 'For God so loved the world', comment: { trim: () => '' },
    onClose: () => {},
    // the REAL wording helper's null behaviour, spelled out: no _refused ⇒ it promises a retry.
    dmFailWording: (evt) => (evt && evt._refused ? 'REFUSED' : 'PROMISED-A-RETRY'),
    Promise,
  };
  const args = Object.keys(scope);
  const fn = new Function(...args, SHARE + '\nreturn sendToPerson;')(...args.map(k => scope[k]));
  return { run: () => fn({ pubkey: 'p', name: 'Anna' }), toasts };
}

test('sharing to a person: a send that never happened is not announced as "Sent to Anna"', async () => {
  const s = shareTo(null);
  await s.run(); await tick();
  assert.equal(s.toasts.length, 1, 'the share said nothing at all');
  assert.doesNotMatch(s.toasts[0], /Sent to Anna/,
    'sendDM could not encrypt, so nothing was sent and nothing was queued — and the member was told it ' +
    'reached Anna. Losing something quietly while claiming it worked is the worst failure this app can make');
  assert.notEqual(s.toasts[0], 'PROMISED-A-RETRY',
    'a null was handed to dmFailWording, which with no _refused promises "we’ll send it as soon as you’re ' +
    'back online" — there is nothing queued to send, so that retry never comes');
});

test('…and the outcomes that DO mean something still read correctly', async () => {
  const refused = shareTo({ _refused: 'blocked' }); await refused.run(); await tick();
  assert.deepEqual(refused.toasts, ['REFUSED']);
  const queued = shareTo({ _delivered: false }); await queued.run(); await tick();
  assert.deepEqual(queued.toasts, ['PROMISED-A-RETRY'], 'a QUEUED share must still promise the retry it has');
  const sent = shareTo({ id: 'e1', _delivered: true }); await sent.run(); await tick();
  assert.deepEqual(sent.toasts, ['Sent to Anna'], 'a share that really went is no longer reported as sent');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2. app/screens-chat.jsx — the member's DM composer
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const DM_SEND = handlerAround(CHAT, 'FS.sendDM(peer,', 'const send = () => {', 'the DM composer send');

function composerSend(result) {
  const toasts = [], drafts = [];
  const scope = {
    draft: 'are you all right?', peer: 'peerhex', dmReply: null, allowDM: true,
    FS: { sendDM: async () => result },
    ctx: { toast: (m) => toasts.push(m) },
    // the composer is cleared synchronously first, so a functional updater sees ''
    setDraft: (v) => drafts.push(typeof v === 'function' ? v(drafts.length ? drafts[drafts.length - 1] : '') : v),
    setDmReply: () => {},
    dmFailWording: (evt) => (evt && evt._refused ? 'REFUSED' : 'PROMISED-A-RETRY'),
    Promise,
  };
  const args = Object.keys(scope);
  const fn = new Function(...args, DM_SEND + '\nreturn send;')(...args.map(k => scope[k]));
  return { run: () => fn(), toasts, drafts };
}

test('the DM composer: a message that was never sent OR queued does not vanish in silence', async () => {
  const s = composerSend(null); s.run(); await tick(); await tick();
  assert.ok(s.toasts.length >= 1,
    'sendDM returned null: nothing was published, nothing was queued (the encrypt step runs BEFORE the ' +
    'outbox push), so outboxForPeer has nothing and no pending bubble appears — and the member was told ' +
    'nothing whatsoever. They watched their message cease to exist');
  assert.equal(s.drafts[s.drafts.length - 1], 'are you all right?',
    'the composer was cleared and the words were not put back — they exist nowhere on the device now');
});

test('…and a QUEUED or DELIVERED message still leaves the composer clear', async () => {
  for (const [what, result] of [['queued', { _delivered: false }], ['delivered', { id: 'e', _delivered: true }]]) {
    const s = composerSend(result); s.run(); await tick(); await tick();
    assert.deepEqual(s.drafts, [''], `a ${what} message put the member's words back into the composer, so ` +
      'sending it again would send it twice');
    assert.deepEqual(s.toasts, [], `a ${what} message raised a failure notice`);
  }
  const refused = composerSend({ _refused: 'safeguarding' }); refused.run(); await tick(); await tick();
  assert.deepEqual(refused.toasts, ['REFUSED'], 'a PERMANENT refusal is no longer explained');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// The console: a miniature React, so the two surfaces below are READ OUT OF THE RENDERED TREE.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function loadConsoleComponent(name, anchor, extraGlobals = {}) {
  const src = fnBody(STEW, anchor, name);
  const tmp = join(tmpdir(), 'dmnull-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__dmnull_' + Math.random().toString(36).slice(2);
  globalThis[key] = extraGlobals;
  const preamble = Object.keys(extraGlobals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const b64 = Buffer.from(preamble + '\n' + js).toString('base64');
  return (await import('data:text/javascript;base64,' + b64))[name];
}

// Enough React to render a function component repeatedly and let its setters actually stick. useState is
// keyed by call order, exactly as React does it, so a setter fired from a handler is visible on the redraw.
function miniReact() {
  const states = [];
  let i = 0;
  const React = {
    useState(init) {
      const k = i++;
      if (!(k in states)) states[k] = typeof init === 'function' ? init() : init;
      return [states[k], (v) => { states[k] = typeof v === 'function' ? v(states[k]) : v; }];
    },
    useEffect() {}, useRef: () => ({ current: null }), useMemo: (f) => f(), useCallback: (f) => f,
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
    Fragment: 'Fragment',
  };
  return { React, reset: () => { i = 0; } };
}

// Walk a rendered tree collecting every string, and every node matching a predicate.
const texts = (n, out = []) => {
  if (n == null || n === false) return out;
  if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; }
  if (Array.isArray(n)) { n.forEach(c => texts(c, out)); return out; }
  if (n.props) Object.values(n.props).forEach(v => { if (typeof v === 'string') out.push(v); else if (v && (v.kids || Array.isArray(v))) texts(v, out); });
  (n.kids || []).forEach(c => texts(c, out));
  return out;
};
const find = (n, pred, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => find(c, pred, out)); return out; }
  if (pred(n)) out.push(n);
  (n.kids || []).forEach(c => find(c, pred, out));
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 4. app/stew-dashboard.jsx — StewDmWindow (the auditor's worst: no screen rendered this failure at all)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function dmWindow(result) {
  const sent = [];
  const { React, reset } = miniReact();
  const Steward = {
    subscribeDMThread: () => () => {},
    sendDM: async (pk, body) => { sent.push([pk, body]); return result; },
    reactDM: () => {},
  };
  const Comp = await loadConsoleComponent('StewDmWindow', 'function StewDmWindow(', {
    React,
    window: { Steward },
    Icon: () => null, SkBadge: () => null,
    SK_TINT: { gold: { fg: '#000' } },
    nameHandle: () => '', shortNpub: () => 'npub1…',
  });
  const draw = () => { reset(); return Comp({ peer: { pubkey: 'peerhex', name: 'Ruth' }, offset: 0, onClose: () => {} }); };
  return { draw, sent };
}

test('CONTROL: the console DM window renders, and its send button reaches Steward.sendDM', async () => {
  // If this fails, every assertion below is meaningless — see console-photo-suppression.test.mjs.
  const w = await dmWindow({ id: 'e1' });
  const tree = w.draw();
  const input = find(tree, n => n.type === 'input')[0];
  assert.ok(input, 'the console DM window no longer renders a composer — re-anchor this test');
  input.props.onChange({ target: { value: 'I am praying for you' } });
  const btn = find(w.draw(), n => n.type === 'button' && n.props.title === 'Send this message')[0];
  assert.ok(btn, 'the send button is gone — re-anchor this test');
  btn.props.onClick(); await tick(); await tick();
  assert.deepEqual(w.sent, [['peerhex', 'I am praying for you']]);
});

test('the console DM window SHOWS a send that never left the console', async () => {
  const w = await dmWindow(null);
  const tree = w.draw();
  find(tree, n => n.type === 'input')[0].props.onChange({ target: { value: 'I am praying for you' } });
  find(w.draw(), n => n.type === 'button' && n.props.title === 'Send this message')[0].props.onClick();
  await tick(); await tick();
  const after = w.draw();
  const alerts = find(after, n => n.props && n.props.role === 'alert');
  assert.equal(alerts.length, 1, 'no notice is rendered on this screen at all');
  const shown = texts(alerts[0]).join(' | ');
  assert.match(shown, /Not sent/,
    'Steward.sendDM returned null — no signing key, no peer hex, or the encrypt threw, every one of them ' +
    'BEFORE the outbox push — so the message was not sent, not queued, and not in the thread, and NOTHING ' +
    'on this screen said so. A vicar answering a member in distress had no way to know their reply never left');
  const input = find(after, n => n.type === 'input')[0];
  assert.equal(input.props.value, 'I am praying for you',
    'the composer was cleared over a message that exists nowhere — the steward’s words are simply gone');
});

test('…and a console DM that WAS sent or queued shows no failure and clears the composer', async () => {
  for (const [what, result] of [['sent', { id: 'e1' }], ['queued', { id: 'e1', _queued: true }]]) {
    const w = await dmWindow(result);
    find(w.draw(), n => n.type === 'input')[0].props.onChange({ target: { value: 'hello' } });
    find(w.draw(), n => n.type === 'button' && n.props.title === 'Send this message')[0].props.onClick();
    await tick(); await tick();
    const after = w.draw();
    assert.equal(find(after, n => n.props && n.props.role === 'alert').length, 0,
      `a ${what} message is reported as a failure`);
    assert.equal(find(after, n => n.type === 'input')[0].props.value, '',
      `a ${what} message left the steward’s words in the composer, so sending again would send it twice`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 3. app/stew-dashboard.jsx — GroupLeadersModal ("we’ll message them to let them know")
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function leadersModal(result) {
  const closed = [], published = [];
  const { React, reset } = miniReact();
  const Comp = await loadConsoleComponent('GroupLeadersModal', 'function GroupLeadersModal(', {
    React,
    window: {
      useStewardMembers: () => [{ pubkey: 'newpk', name: 'Ronald', npub: 'npub1ronald' }],
      Steward: {
        publishGroup: async (g) => { published.push(g); return { id: 'g1' }; },
        sendDM: async () => result,
      },
    },
    Icon: () => null, SkBadge: () => null,
    useStewDialog: () => ({ current: null }),
  });
  const draw = () => { reset(); return Comp({ group: { id: 'g1', name: 'Youth', leaders: [] }, onClose: () => closed.push(1) }); };
  const tick3 = async () => { await tick(); await tick(); await tick(); };
  const run = async () => {
    const tree = draw();
    const row = find(tree, n => n.type === 'button' && n.props.title && n.props.title.startsWith('Tick to make'))[0];
    assert.ok(row, 'the member rows are gone from the leaders modal — re-anchor this test');
    row.props.onClick();
    const save = find(draw(), n => n.type === 'button' && String(n.props.className || '').includes('sk-btn--clay'))[0];
    assert.ok(save, 'the Save button is gone — re-anchor this test');
    await save.props.onClick(); await tick3();
    return draw();
  };
  return { run, closed, published };
}

test('CONTROL: promoting a leader publishes the group and messages the new leader', async () => {
  const m = await leadersModal({ id: 'dm1' });
  await m.run();
  assert.equal(m.published.length, 1, 'the leadership change no longer publishes at all');
  assert.deepEqual(m.published[0].leaders, ['newpk']);
  assert.equal(m.closed.length, 1, 'a fully successful save no longer closes the modal');
});

test('a new leader who could NOT be messaged is named, and the modal does not close over it', async () => {
  const m = await leadersModal(null);
  const after = await m.run();
  assert.equal(m.published.length, 1, 'the leadership change itself must still publish — only the DM failed');
  // READ THE BANNER, NOT THE PAGE. The first version of this matched /Ronald/ anywhere in the rendered tree
  // — and Ronald's name is also on his own member row in the list above, so deleting the banner from the
  // screen entirely left this green. That is the mis-aimed assertion this repo keeps re-learning: it reports
  // exactly what a working fix reports. Find the alert node and read ITS text.
  const alerts = find(after, n => n.props && n.props.role === 'alert');
  assert.equal(alerts.length, 1,
    'nothing on this modal reports a new leader who was never messaged — the notice is not on the screen');
  const shown = texts(alerts[0]).join(' | ');
  assert.match(shown, /Ronald/,
    'Steward.sendDM returned null, so nothing was sent and nothing is queued, and this discarded the result ' +
    'and closed. The panel promises in so many words "we’ll message them to let them know", so the steward ' +
    'believed Ronald had been told — and Ronald never posts an event because nobody ever told him he could');
  assert.match(shown, /couldn’t message/i, 'the notice does not say what actually failed');
  assert.equal(m.closed.length, 0, 'the modal closed over a notification that was never sent');
});

test('…a leader whose message is only QUEUED counts as told — the console outbox will flush it', async () => {
  const m = await leadersModal({ id: 'dm1', _queued: true });
  await m.run();
  assert.equal(m.closed.length, 1,
    'a queued DM is treated as a failure — the console outbox retries it, so this cries wolf at the steward ' +
    'every time they promote someone while the relay is briefly unreachable');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// The sibling that was deliberately NOT changed.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('publishMessage has no null exit, which is the whole reason sendToGroup needs no guard', () => {
  // sendToGroup reads a falsy result into its success arm exactly the way sendToPerson did. It is safe only
  // because publishMessage cannot return one. That is a property of another function in another file, so it
  // is asserted rather than trusted: the day a fourth exit is added, this goes red and the comment in
  // screens-chat.jsx stops being a claim nobody checked. CLAUDE.md rule 4.
  const SRC = readFileSync(join(ROOT, 'vendor/fellowship.js'), 'utf8');
  const body = fnBody(SRC, 'async publishMessage(groupId, content, extraTags = [], opts = {}) {', 'publishMessage');
  const exits = [...body.matchAll(/\breturn\b([^\n;]*);/g)].map(m => m[1].trim());
  assert.ok(exits.length >= 3, 'publishMessage lost exits — re-read it before trusting the note in sendToGroup');
  for (const e of exits) {
    assert.notEqual(e, '', 'publishMessage has a bare `return;` — it now yields undefined, and sendToGroup ' +
      'reports that as "Shared to <group>" over a message that was never sent');
    assert.doesNotMatch(e, /^null$/, 'publishMessage now returns null, and sendToGroup announces it as shared');
  }
});
