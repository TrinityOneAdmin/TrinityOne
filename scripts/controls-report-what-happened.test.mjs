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
import { stmt } from './test-slice.mjs';

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
// CLAUDE.md rule 3, and the reason it is written down. The test that used to live here read the LINE and
// checked the dependency names appeared on it. An auditor wrapped the call as
//     useAE(() => { if (false && window.TrinityReminders) window.TrinityReminders.sync(servConfirmed); }, [...])
// and it stayed green 8/8 — every word of the line was still there, and reminders would never be scheduled
// for anyone, ever. app/*.jsx ships unbundled, so no assertion that matches its text can tell a live call
// from a dead one. RUN the effect instead.
// Anchor on the CALL, then take the whole statement around it — never on the guard itself, or a sabotage
// of the guard would show up as "re-anchor this test" instead of "no reminder was ever scheduled".
const REMINDER_EFFECT = (() => {
  const at = APP.indexOf('TrinityReminders.sync(servConfirmed)');
  assert.notEqual(at, -1,
    'nothing anywhere in app.jsx calls the serving-reminder scheduler — re-anchor this test only after ' +
    'checking that reminders are still scheduled somewhere');
  const rest = APP.slice(APP.lastIndexOf('\n', at) + 1);
  assert.match(rest.slice(0, 40), /^\s*useAE\(/, 'the reminder call has moved out of its effect — re-anchor');
  return stmt(rest, 'useAE(', 'the reminder effect');
})();

function reminderEffect({ reminders }) {
  const seen = { calls: [], deps: null };
  const scope = {
    useAE: (fn, deps) => { seen.deps = deps; fn(); },
    window: { TrinityReminders: reminders },
    servConfirmed: [{ id: 'rota:sun:1' }],
    servReqs: ['req'], servReplies: {}, churchRotas: ['rota'], churchServices: ['svc'],
    churchRosters: ['roster'], churchTeams: ['team'],
    console,
  };
  const args = Object.keys(scope);
  new Function(...args, REMINDER_EFFECT)(...args.map(k => scope[k]));
  return { seen, scope };
}

test('the reminder scheduler is actually CALLED — not merely mentioned', () => {
  const calls = [];
  const r = reminderEffect({ reminders: { sync: (slots) => calls.push(slots) } });
  assert.equal(calls.length, 1,
    'nothing schedules a serving reminder. The screen promises "we’ll remind you the day before you serve" ' +
    'and no reminder is ever set, for anybody');
  assert.deepEqual(calls[0], r.scope.servConfirmed,
    'the scheduler was handed something other than the member’s confirmed slots');
});

test('…and it survives a phone with no reminder plugin at all', () => {
  // The guard exists for a reason: web builds have no TrinityReminders. It must skip, not throw.
  assert.doesNotThrow(() => reminderEffect({ reminders: undefined }));
});

test('the reminder scheduler re-runs when a rota is published', () => {
  // Executed, not read: assert the values the effect was ACTUALLY given as dependencies, so a dep list that
  // merely names the right variables in a comment or a dead branch cannot satisfy it.
  const r = reminderEffect({ reminders: { sync: () => {} } });
  assert.ok(Array.isArray(r.seen.deps), 'the effect has no dependency array, so it re-runs on every render');
  for (const dep of ['servConfirmed', 'churchRotas', 'churchServices', 'churchRosters', 'churchTeams']) {
    assert.ok(r.seen.deps.includes(r.scope[dep]),
      `the effect does not re-run when ${dep} changes, so "we'll remind you the ` +
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

test('POINT OF USE: the failed-publish report is RUN, not read', async () => {
  // The test above matches text in the bundle, and the bundler does strip dead code — so it catches a
  // `if (false)`. It does NOT catch the deletion an auditor actually made: dropping 'hidden' from
  //     ['about', 'picture', 'av', 'hidden'].some(k => meta && meta[k] != null)
  // leaves `trinityToast` and "still listed in the directory" sitting right there in the window it reads,
  // and the test stays green while a member who chose to be hidden is silently left in the church
  // directory. `hidden` is the one entry in that list that is a privacy control. So run the real
  // setProfile against a relay that refuses, and assert the member is told.
  const at = FELLOW.indexOf('async setProfile(meta) {');
  assert.notEqual(at, -1, 'setProfile is gone from the shipped bundle — re-anchor this test, do not delete it');
  const BODY = (() => {
    let depth = 0, q = '';
    for (let i = FELLOW.indexOf('{', at + 20); i < FELLOW.length; i++) {
      const c = FELLOW[i], p = FELLOW[i - 1];
      if (q) { if (c === q && p !== '\\') q = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '/' && FELLOW[i + 1] === '/') { i = FELLOW.indexOf('\n', i); if (i === -1) break; continue; }
      if (c === '{') depth++; else if (c === '}' && --depth === 0) return FELLOW.slice(at, i + 1);
    }
    assert.fail('could not find the end of setProfile');
  })();
  // esbuild renumbers its imports (finalizeEvent2, …); bind whatever this body actually calls.
  const finalizeName = (BODY.match(/\bfinalizeEvent\d*\b/) || ['finalizeEvent'])[0];

  const ME = 'a'.repeat(64);
  const run = async ({ meta, publishFails = true }) => {
    const toasts = [];
    const scope = {
      sk: new Uint8Array(32), pub: ME,
      _k0Seen: new Set([ME]),           // our own kind-0 has arrived, so this is the DID-TRY branch
      profiles: {},
      _churchPhotosOff: () => false,
      _stripPhoto: (p, av) => av,
      _profilePubFor: null, _profilePubBody: null,
      PROFILE_KEY: 'trinityone.profile',
      [finalizeName]: (t) => ({ ...t, id: 'e1', sig: 'x' }),
      _publishAny: async () => { if (publishFails) throw new Error('no relay accepted it'); },
      window: {
        Fellowship: { relays: ['wss://test.invalid'], ready: Promise.resolve(), requestProfiles: () => {}, syncSealedNames: () => {} },
        trinityToast: (m) => toasts.push(m),
        dispatchEvent: () => {},
      },
      localStorage: { setItem: () => {} },
      console: { warn() {} },
      CustomEvent: class { constructor(n, o) { this.n = n; this.o = o; } },
      Promise, Set, JSON, Date, Math, Object, setTimeout,
    };
    const args = Object.keys(scope);
    const fn = new Function(...args, `return ({ ${BODY} }).setProfile;`)(...args.map(k => scope[k]));
    await fn(meta);
    return toasts;
  };

  const hidden = await run({ meta: { hidden: true } });
  assert.equal(hidden.length, 1,
    'a member tapped "hide me from the church directory", no relay accepted it, and they were told nothing ' +
    '— the switch sits in its new position and the church still lists them');
  assert.match(hidden[0], /still listed in the directory/,
    'the member was told something, but not the thing that is actually true of them right now');

  // the wording must be specific to the opt-out, not the generic profile message
  const about = await run({ meta: { about: 'Hello' } });
  assert.equal(about.length, 1, 'a failed profile save is silent again');
  assert.doesNotMatch(about[0], /still listed in the directory/,
    'an ordinary profile save now claims the member is listed in a directory, which is not what happened');

  // and a save that lost nothing must not cry wolf
  assert.deepEqual(await run({ meta: { name: 'Ruth' } }), [],
    'a name-only save warns that nothing was saved — the name does not travel in kind-0 at all, so that is ' +
    'a false alarm');

  // …and a publish that WORKED says nothing
  assert.deepEqual(await run({ meta: { hidden: true }, publishFails: false }), [],
    'a successful opt-out tells the member it failed');
});
