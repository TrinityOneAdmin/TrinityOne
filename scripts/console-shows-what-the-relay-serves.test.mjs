// THE CONSOLE MUST SHOW WHAT THE RELAY IS STILL SERVING TO THE CONGREGATION.
// Run: node --test scripts/console-shows-what-the-relay-serves.test.mjs
//
// 2026-08-29, third round on this area. The fix before this one correctly split two questions that had been
// sharing one parameter — `trusted` = who may be SHOWN, `opts.mayName` = who may WITHDRAW the church's copy —
// and then answered the display half with the withdrawal predicate. `_consoleDisplay` delegated to
// `_consoleChurchVoice`, which requires the steward's CONTENT capability.
//
// The relay draws the same line and draws it the other way round. scripts/gateway.mjs:1927 gates the WRITE on
// `stewardCan(pubkey, cp, 'content')` — that is the withdrawal question, and _consoleChurchVoice mirroring it
// is right. gateway.mjs:2341 gates RETRACTION, i.e. what is still SERVED, on `'any'`, "deliberately, and NOT
// this document's own capability… so that narrowing a delegate to Finance does not make every group they ever
// created stop being served to the congregation."
//
// Measured consequence: an owner unticks "Groups, rotas, services, events, posts" for an existing steward —
// one ordinary checkbox — and every group, rota, service, plan, devotional and event that steward ever
// authored disappears from the OWNER'S OWN console, while the relay keeps serving them and every phone still
// shows them. Console ["Sunday Prayer"], phones ["Sunday Prayer","Youth","Mums & Tots"]. Silent, and visible
// only to somebody else: this codebase's worst failure class.
//
// The second half is the empty roster. `_careRosterKnown` is set from subscribeStewards' oneose whenever ANY
// relay is authenticated, and in SimplePool a relay that CLOSEs counts towards that EOSE (handleClose calls
// handleEose), so "we asked and got nothing" becomes "this church has no stewards". There is no _reduceAll in
// the console bundle, so that answer is never revisited, and each reader writes the filtered list back to
// localStorage where it survives the next cold start. `_careRosterSeen` separates the two empties.
//
// EVERYTHING HERE IS DRIVEN THROUGH A REAL READER. The predicate is not called directly anywhere in this
// file: subscribeStewards and subscribeGroups are lifted out of the shipped bundle into ONE scope, so the
// roster state they share is the real module state and a reader that stops consulting it fails these tests.
// (scripts/delegated-withdrawal-clears.test.mjs has the cautionary version — a _consoleDisplay test that drove
// the one reader which does not use it, and therefore could not fail.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

function lift(src, name) {
  const re = new RegExp('\\n  function ' + name + '\\([\\s\\S]*?\\n  \\}');
  const m = re.exec(src);
  assert.ok(m, `could not lift ${name} — re-anchor this test, do not delete it`);
  return m[0];
}
function grabMethod(src, sig) {
  const at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped bundle — re-anchor this test, do not delete it');
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}

const CHURCH = 'c'.repeat(64);
const GORDON = 'a'.repeat(64);    // a steward the church empowered, who has authored real documents
const STRANGER = 'f'.repeat(64);  // on nobody's roster
const GROUP_D = 'trinityone/group:';
const STEWARDS_D = 'trinityone/stewards:';
const NET = 'trinityone';

// The console as the owner sits at it: the engine's OWN steward subscription and its OWN groups reader,
// sharing the one set of roster globals, exactly as they do in the bundle.
// `mountGroups: 'later'` opens the groups page AFTER the roster has answered — the ordering that matters for
// the cache paint, because _seedFromCache consults the display predicate at mount time and there is no
// _reduceAll to revisit it. Mounting first (the default) hides that entirely: an earlier draft of the cache
// test did exactly that and survived its own sabotage.
function consoleAt({ relayAuthed = true, cache = null, mountGroups = 'now' } = {}) {
  const opened = [];
  const stored = new Map();
  if (cache) stored.set('trinityone.steward.groups.' + CHURCH, JSON.stringify(cache));
  const scope = {
    pool: { subscribeMany: (_r, _f, h) => { opened.push(h); return { close() {} }; } },
    relays: () => ['wss://relay.example'],
    pub: CHURCH, NET, GROUP_D, STEWARDS_D,
    GROUPKEY_D: 'trinityone/groupkey:',
    stewIngestKey: () => {},
    _authFuture: () => false,
    _byChurch: (e) => e.pubkey === CHURCH,     // the roster is owner-only; the real one says the same thing
    _isRelayAuthed: () => relayAuthed,
    localStorage: { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, v) },
    _careRoster: new Set(), _careRosterKnown: false, _careRosterSeen: false,
    _stewardCaps: {}, _stewardNames: {}, _stewardSince: {},
  };
  const body = ['_pickWinner', '_reduceVersions', '_absorbById', '_forgetById', '_tombstoneTargets',
    // `_capsOf` is how both predicates read the capability list — it normalises it the way the relay does
    // (gateway.mjs:1611: non-empty strings, lower-cased) instead of counting the raw length. Lift it with
    // them, or they call a function that is not there.
    '_seedFromCache', '_capsOf', '_consoleDisplay', '_consoleChurchVoice'].map(n => lift(STEWARD, n)).join('\n');
  const args = Object.keys(scope);
  const api = new Function(...args, `${body}\nreturn ({\n${grabMethod(STEWARD, 'subscribeStewards(onList)')},\n${grabMethod(STEWARD, 'subscribeGroups(onGroups)')}\n});`)
    (...args.map(k => scope[k]));

  let roster = [], groups = [];
  api.subscribeStewards((l) => { roster = l; });
  assert.equal(opened.length, 1, 'the steward roster reader never opened its subscription — re-anchor this test');
  const stewardsSub = opened[0];
  let groupsSub = null;
  const mount = () => {
    api.subscribeGroups((l) => { groups = l; });
    assert.equal(opened.length, 2, 'the groups reader never opened its subscription — re-anchor this test');
    groupsSub = opened[1];
  };
  if (mountGroups === 'now') mount();
  const sub = () => { assert.ok(groupsSub, 'the groups page was never opened in this test'); return groupsSub; };
  return {
    roster: () => roster,
    mountGroups: mount,
    // the church publishes (or re-publishes) its signed steward roster
    publishRoster: (pubkeys, caps, ts = 100) => stewardsSub.onevent({
      pubkey: CHURCH, created_at: ts, content: JSON.stringify({ pubkeys, caps }),
      tags: [['d', STEWARDS_D + CHURCH], ['t', NET]],
    }),
    // …or the relays simply finish, having served no roster at all
    rosterEose: () => stewardsSub.oneose(),
    group: (by, id, name, ts = 200) => sub().onevent({
      pubkey: by, created_at: ts, content: JSON.stringify({ name }),
      tags: [['d', GROUP_D + id], ['t', NET], ...(by === CHURCH ? [] : [['church', CHURCH]])],
    }),
    deleteGroup: (by, id, forWhom = [], ts = 300) => sub().onevent({
      pubkey: by, created_at: ts, content: '',
      tags: [['d', GROUP_D + id], ['t', NET], ['deleted', '1'], ['church', CHURCH], ...forWhom.map(f => ['for', f])],
    }),
    eose: () => sub().oneose(),
    names: () => groups.map(g => g.name).filter(Boolean).sort(),
    cached: () => JSON.parse(stored.get('trinityone.steward.groups.' + CHURCH) || '[]').map(g => g.name).filter(Boolean).sort(),
  };
}

// What the relay is still serving in each case, so the assertions below are checkable against gateway.mjs
// rather than against my own belief about it.
const RELAY_SERVES = 'the relay serves this to every phone in the congregation — the console must not hide it';

test('READER: narrowing a steward to Finance does not empty the console of everything they ever wrote', () => {
  // gateway.mjs:2341 keeps serving these. The console used to ask for the CONTENT capability and hide them.
  const c = consoleAt();
  c.publishRoster([GORDON], { [GORDON]: ['finance'] });
  c.group(CHURCH, 'g1', 'Sunday Prayer');
  c.group(GORDON, 'g2', 'Youth');
  c.group(GORDON, 'g3', 'Mums & Tots');
  c.eose();
  assert.deepEqual(c.names(), ['Mums & Tots', 'Sunday Prayer', 'Youth'],
    'unticking one capability checkbox emptied the owner’s own console — ' + RELAY_SERVES);
});

test('READER: …and it does not poison the cache the next cold start paints from', () => {
  // Each reader writes what it is showing back to localStorage, so a wrong answer outlives the session.
  const c = consoleAt();
  c.publishRoster([GORDON], { [GORDON]: ['finance'] });
  c.group(CHURCH, 'g1', 'Sunday Prayer');
  c.group(GORDON, 'g2', 'Youth');
  c.eose();
  assert.deepEqual(c.cached(), ['Sunday Prayer', 'Youth'],
    'the filtered list was written back to localStorage — the groups stay gone after a restart');
});

test('READER: a capability list the owner emptied outright still means "nothing"', () => {
  // The relay's own reading: `caps.size > 0`. An EXPLICIT empty list is how a church says "no powers", and
  // gateway.mjs stops serving that author's documents, so the console must stop showing them too.
  const c = consoleAt();
  c.publishRoster([GORDON], { [GORDON]: [] });
  c.group(CHURCH, 'g1', 'Sunday Prayer');
  c.group(GORDON, 'g2', 'Youth');
  c.eose();
  assert.deepEqual(c.names(), ['Sunday Prayer'],
    'a steward the church stripped of every capability still fills the console with their documents');
});

test('READER: a steward with no capabilities recorded at all keeps everything (pre-capabilities rosters)', () => {
  const c = consoleAt();
  c.publishRoster([GORDON], {});
  c.group(CHURCH, 'g1', 'Sunday Prayer');
  c.group(GORDON, 'g2', 'Youth');
  c.eose();
  assert.deepEqual(c.names(), ['Sunday Prayer', 'Youth'],
    'every church whose roster predates capabilities lost its stewards’ documents');
});

test('READER: someone off the roster is still not shown', () => {
  // The relaxation is to the CAPABILITY question only. Roster membership still decides.
  const c = consoleAt();
  c.publishRoster([GORDON], { [GORDON]: ['finance'] });
  c.group(CHURCH, 'g1', 'Sunday Prayer');
  c.group(STRANGER, 'g9', 'Forged Group');
  c.eose();
  assert.deepEqual(c.names(), ['Sunday Prayer'],
    'a relay could put a group nobody authorised on the console by serving one');
});

// ── THE EMPTY ROSTER: THE ONE THIS CHANGE WOULD OTHERWISE HAVE MADE WORSE ────────────────────────────────

test('READER: relays that answer with no roster at all must not blank the church’s documents', () => {
  // The wrong-answer case. `_careRosterKnown` is set from oneose whenever ANY relay is authenticated, and a
  // relay that CLOSEs counts towards that EOSE — so a church WITH stewards is recorded as having none. With
  // no _reduceAll in this bundle nothing ever re-asks, and the filtered list is cached to disk.
  const c = consoleAt({ relayAuthed: true });
  c.group(CHURCH, 'g1', 'Sunday Prayer');
  c.group(GORDON, 'g2', 'Youth');
  c.rosterEose();               // authenticated, and nothing came back
  c.group(GORDON, 'g3', 'Mums & Tots');
  c.eose();
  assert.deepEqual(c.names(), ['Mums & Tots', 'Sunday Prayer', 'Youth'],
    'an EOSE with no roster in it removed the stewards’ documents for the rest of the session — ' + RELAY_SERVES);
});

test('READER: …including the ones already painted from the last session’s cache', () => {
  // The groups page is opened AFTER the roster has answered, which is the ordinary case for any page the
  // steward reaches after the first: _seedFromCache asks the display predicate as it seeds, and with no
  // _reduceAll nothing revisits it. A wrong empty roster here means the page paints blank and stays blank —
  // including with no network at all, where the cache is the only copy there is.
  const c = consoleAt({ relayAuthed: true, cache: [{ id: 'g2', name: 'Youth', ts: 50, _by: GORDON }], mountGroups: 'later' });
  c.rosterEose();
  c.mountGroups();
  c.eose();
  assert.deepEqual(c.names(), ['Youth'],
    'the cached paint went blank on an empty EOSE, so the console flashes empty and stays empty offline');
});

test('READER: a church that really did revoke its last steward stops showing their work', () => {
  // The other empty. Here a roster DOCUMENT was read and it lists nobody, which is what publishing a
  // revocation looks like — and the relay's retraction gate then stops serving that author to the
  // congregation. A console that ignored this would show the office documents the members had already lost,
  // which is the disagreement two-authors-one-document.test.mjs records as the known gap.
  //
  // This is the whole reason the branch above is `!_careRosterSeen && !_careRoster.size` and not
  // `!_careRoster.size`. Written the loose way, a genuinely revoked steward's documents come back.
  const c = consoleAt();
  c.publishRoster([GORDON], { [GORDON]: ['content'] }, 100);
  c.group(CHURCH, 'g1', 'Sunday Prayer');
  c.eose();
  c.publishRoster([], {}, 200);                    // the owner removes Gordon
  c.group(GORDON, 'g2', 'Youth');                  // a replay of his work, or a second relay serving it
  c.eose();
  assert.deepEqual(c.names(), ['Sunday Prayer'],
    'a revoked steward’s documents kept filling the console while the congregation could no longer see them');
});

test('KNOWN GAP: a revocation does not clear what the console is ALREADY showing', () => {
  // There is no _reduceAll in the console bundle (two-authors-one-document.test.mjs asserts its absence by
  // name), so nothing re-chooses winners when the roster changes: a document absorbed while its author was
  // still a steward stays on the screen, and in the cache, after they are removed. The predicate is only
  // consulted as each event arrives.
  //
  // Recorded rather than left as a comment so the day somebody wires the re-choose in, this fails and tells
  // them to rewrite it. It is the SAFE direction — the console over-shows, it does not blank — and it is
  // unchanged by this round's fix.
  const c = consoleAt();
  c.publishRoster([GORDON], { [GORDON]: ['content'] }, 100);
  c.group(CHURCH, 'g1', 'Sunday Prayer');
  c.group(GORDON, 'g2', 'Youth');
  c.eose();
  c.publishRoster([], {}, 200);
  c.eose();
  assert.deepEqual(c.names(), ['Sunday Prayer', 'Youth'],
    'the console now re-chooses on a roster change — wire _reduceAll in properly and rewrite this test');
});

test('READER: an unauthenticated console is not told anything by an empty answer', () => {
  // A relay serves the roster only to an authenticated reader, so an empty answer here means nothing at all.
  const c = consoleAt({ relayAuthed: false });
  c.group(CHURCH, 'g1', 'Sunday Prayer');
  c.group(GORDON, 'g2', 'Youth');
  c.rosterEose();
  c.eose();
  assert.deepEqual(c.names(), ['Sunday Prayer', 'Youth'],
    'an unauthenticated read’s empty answer was treated as "this church has no stewards"');
});

// ── AND THE WITHDRAWAL AUTHORITY, WHICH MUST NOT HAVE MOVED ──────────────────────────────────────────────
// Relaxing what is SHOWN must not relax what may be DESTROYED. gateway.mjs:1927 gates the write on the
// content capability; _consoleChurchVoice mirrors that and stays where it is.

test('READER: a Finance-only steward still cannot withdraw the church’s own group', () => {
  const c = consoleAt();
  c.publishRoster([GORDON], { [GORDON]: ['finance'] });
  c.group(CHURCH, 'g1', 'Sunday Prayer');
  c.eose();
  c.deleteGroup(GORDON, 'g1', [CHURCH]);
  assert.deepEqual(c.names(), ['Sunday Prayer'],
    'showing a narrowed steward’s documents also handed them the church-copy withdrawal');
});

test('READER: a steward who still holds content withdraws the church’s copy as before', () => {
  const c = consoleAt();
  c.publishRoster([GORDON], { [GORDON]: ['content'] });
  c.group(CHURCH, 'g1', 'Sunday Prayer');
  c.eose();
  c.deleteGroup(GORDON, 'g1', [CHURCH]);
  assert.deepEqual(c.names(), [], 'an empowered steward’s delete stopped reaching the console');
});

test('READER: a delete does not re-filter what the console was already showing', () => {
  // The defect the previous round introduced, held down at reader level with the new predicate in place: the
  // delete door and the absorb door must ask the SAME display question.
  const c = consoleAt();
  c.publishRoster([GORDON], { [GORDON]: ['finance'] });
  c.group(CHURCH, 'g1', 'Sunday Prayer');
  c.group(GORDON, 'g2', 'Youth');
  c.eose();
  c.deleteGroup(CHURCH, 'g1');
  assert.deepEqual(c.names(), ['Youth'],
    'deleting one group silently re-filtered the screen and took a steward’s group with it');
});
