// A CONTROL REPORTS WHAT HAPPENED, NOT WHAT WAS ATTEMPTED.
// Run: node --test scripts/controls-report-what-happened.test.mjs
//
// AUDIT 2026-08-29 (member-app round). Four controls announced success over an action that had not happened:
//   · the directory opt-out toasted "Hidden from the church directory" BEFORE the save ran, and the save is
//     fire-and-forget — so a member who chose to be hidden was still listed, and told otherwise;
//   · sharing to a person announced "Sent to Anna" over a send the relay had permanently refused;
//   · remove / pin / unpin toasted success and discarded the result, so a leader removing a phone number a
//     child had posted saw "Message removed" while it stayed up for the whole group;
//   · the serving-reminder scheduler never re-ran when a rota was published.
//
// This repo has shipped six of these at once before. The rule it settled on is in screens-chat.jsx's own
// words: losing something quietly while claiming it worked is the worst failure this app can produce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const CHAT = read('app/screens-chat.jsx');
const APP = read('app/app.jsx');
const IDENT = read('app/identity.jsx');
const FELLOW = read('vendor/fellowship.js');
const line = (src, needle) => {
  const l = src.split('\n').find(x => x.includes(needle));
  assert.ok(l, 'could not find ' + needle + ' — re-anchor this test, do not delete it');
  return l;
};

// ── sharing to a person ──────────────────────────────────────────────────────────────────────────────────
function shareTo({ result }) {
  const toasts = [];
  const src = (() => {
    const at = CHAT.indexOf('const sendToPerson = (m) => {');
    assert.notEqual(at, -1, 'sendToPerson has moved — re-anchor this test');
    let depth = 0, q = '';
    for (let i = CHAT.indexOf('{', at + 25); i < CHAT.length; i++) {
      const c = CHAT[i], p = CHAT[i - 1];
      if (q) { if (c === q && p !== '\\') q = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{') depth++; else if (c === '}' && --depth === 0) return CHAT.slice(at, i + 1);
    }
    assert.fail('could not find the end of sendToPerson');
  })();
  const scope = {
    FS: { sendDM: async () => result },
    ctx: { toast: (m) => toasts.push(m) },
    asText: 'hello', comment: { trim: () => '' },
    onClose: () => {},
    dmFailWording: (evt) => (evt && evt._refused ? 'REFUSED' : 'QUEUED'),
    Promise,
  };
  const args = Object.keys(scope);
  const fn = new Function(...args, src + '\nreturn sendToPerson;')(...args.map(k => scope[k]));
  return { run: () => fn({ pubkey: 'p', name: 'Anna' }), toasts };
}

test('a share the relay REFUSED is not announced as sent', async () => {
  const s = shareTo({ result: { _refused: true } });
  await s.run(); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(s.toasts, ['REFUSED'], 'the member was told it reached Anna when the relay refused it');
});

test('a share that is only QUEUED says so rather than claiming delivery', async () => {
  const s = shareTo({ result: { _delivered: false } });
  await s.run(); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(s.toasts, ['QUEUED']);
});

test('…and a share that really went says it went', async () => {
  const s = shareTo({ result: { id: 'evt1', _delivered: true } });
  await s.run(); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(s.toasts, ['Sent to Anna']);
});

// ── moderation ───────────────────────────────────────────────────────────────────────────────────────────
test('remove, pin and unpin report the real outcome', async () => {
  // The helper spans several lines; take from its declaration to the end of its catch.
  const lines = CHAT.split('\n');
  const i = lines.findIndex(l => l.includes('const _moderated = (p, done, failed)'));
  assert.notEqual(i, -1, '_moderated has moved — re-anchor this test, do not delete it');
  let j = i;
  while (j < lines.length && !lines[j].includes('.catch(')) j++;
  const src = lines.slice(i, j + 1).join('\n').trim().replace(/^const _moderated = /, 'return ');
  const toasts = [];
  const fn = new Function('ctx', 'Promise', src)({ toast: (m) => toasts.push(m) }, Promise);
  await fn(Promise.resolve(null), 'Pinned', 'Couldn’t pin that');
  await fn(Promise.resolve({ id: 'e' }), 'Pinned', 'Couldn’t pin that');
  await fn(Promise.reject(new Error('x')), 'Pinned', 'Couldn’t pin that');
  assert.deepEqual(toasts, ['Couldn’t pin that', 'Pinned', 'Couldn’t pin that'],
    'a moderation action that never published was reported as done');
});

test('every moderation control goes through it', () => {
  for (const [what, needle] of [['remove', 'hideMessage(churchNpub'], ['pin', 'pinPost(churchNpub'], ['unpin', 'unpin(churchNpub']]) {
    assert.match(line(CHAT, needle), /_moderated\(/, `${what} still discards its result and toasts success`);
  }
});

// ── the serving reminder ─────────────────────────────────────────────────────────────────────────────────
test('the reminder scheduler re-runs when a rota is published', () => {
  const l = line(APP, 'TrinityReminders.sync(servConfirmed)');
  for (const dep of ['servConfirmed', 'churchRotas', 'churchServices', 'churchRosters', 'churchTeams']) {
    assert.ok(l.includes(dep), `the effect does not re-run when ${dep} changes, so "we'll remind you the ` +
      'day before you serve" never fires for a rota published after launch');
  }
});

// ── the directory opt-out ────────────────────────────────────────────────────────────────────────────────
test('the directory switch does not assert a change that has not happened yet', () => {
  const l = line(IDENT, 'const flip = () =>');
  assert.doesNotMatch(l, /'Hidden from the church directory'/,
    'the switch claims the opt-out has taken effect before the fire-and-forget save has even run');
  assert.match(l, /Hiding you from the church directory…/);
});

test('a profile publish that no relay accepted tells the member', () => {
  // The withheld branch already spoke up; the branch that DID try and failed said nothing, while the change
  // was written to this device either way — so the switch sat in its new position and the church saw the
  // old profile. `hidden` is the one that matters: it is a privacy control.
  const at = FELLOW.indexOf('profile publish failed');
  assert.notEqual(at, -1, 're-anchor: the failed-publish branch has moved');
  const near = FELLOW.slice(at, at + 700);
  assert.match(near, /trinityToast/, 'a failed profile publish is still silent');
  assert.match(near, /still listed in the directory/, 'the member is not told the opt-out did not land');
});
