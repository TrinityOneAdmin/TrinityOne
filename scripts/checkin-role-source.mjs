// WHO MAY HOLD THE CHECK-IN HELPER KEY. Asked once, here, and nowhere else.
//
// reference/DESIGN-CHECKIN-IN-THE-MEMBER-APP-2026-09-09.md §7, the owner's decision:
//
//     "Holding the helper key will be a rota role, but we may change that to be more specifically a
//      'safeguarding team' after the pilot."
//
// Two consequences he named, and this file exists for the second one: **the source of the role must be
// swappable.** So "who may hold the helper key" is one question with one answer function — answered by the
// rota today, answerable by a named team tomorrow — and the rest of the feature never learns which.
//
// WHAT SWAPPING COSTS, stated so it can be checked rather than believed: change the `source` field the console
// passes to eligibleHelpers(). Nothing else. The relay validates that the source NAME is one this file
// declares (so a grant cannot claim an invented provenance) and enforces the WINDOW and the PUBKEY LIST; it
// never re-derives eligibility, because it cannot — see "WHY THE RELAY CANNOT ASK THIS QUESTION" below.
//
// ── WHY THE RELAY CANNOT ASK THIS QUESTION ────────────────────────────────────────────────────────────────
// `trinityone/rota:<serviceId>` is SEALED under the church name key (src/steward.src.js publishRota →
// _sealChurchDocReady), so the relay cannot read `assign` and cannot see who is on which slot. gateway.mjs
// says so itself, above onAnyRoster: "the relay cannot read who is assigned to what and cannot gate on the
// assignment."
//
// So the division of labour is:
//   • the CONSOLE (which holds the church key, and can therefore read the rota) derives the eligible set with
//     this module and publishes a CLEARTEXT, CHURCH-SIGNED grant: these pubkeys, this session, this window.
//   • the RELAY enforces that grant, and enforces that it is bounded.
//   • the CRYPTO is what makes "access ends when the turn does" true rather than asserted: the grant carries a
//     key minted FOR THAT SESSION, wrapped to that session's helpers. Last week's helper holds last week's
//     session key. It does not open this week's records, whatever any gate does or fails to do.
//
// The grant is cleartext on purpose and carries NOTHING about any child: a session id, two timestamps, a
// source name, and a set of pubkeys the relay must be able to compare against a REQ's authenticated key. The
// same reasoning as `trinityone/rota-settings` and `roster:`'s cleartext `pubs` array — the relay has to read
// what it is asked to enforce.

// The grant document is `trinityone/checkinhelper:<serviceId>`, declared in scripts/trinity-doc-types.mjs.
// THE STRING IS DELIBERATELY NOT DEFINED HERE. That file is the one authority for d-tags — the relay takes it
// from `D.CHECKINHELPER`, the console names it as a literal beside its forty siblings, and
// scripts/doc-registry.test.mjs is what makes the second copy safe. A third definition in this module would be
// the exact defect the registry exists to prevent: a name the relay gates under one spelling and a client
// publishes under another, with nothing failing loudly.

// ── HOW LONG A HELPER KEY LIVES: THE CHURCH'S CHOICE, NOT OURS ────────────────────────────────────────────
// Owner, 2026-09-09, mid-build: "for the safeguarding, we need to be able to make it as flexible as possible,
// giving control over expiry etc where possible by a steward."
//
// This file first shipped with one hard-coded lifetime — the rostered session — because the brief stated
// "access ends when the turn does" as a rule. It is not a rule. It is a POLICY, and this project has a
// standing principle for exactly that, recorded from the owner on 2026-08-27: **ship the gates, never the
// policy.** A mid-size church with a fixed Sunday team and a small church where three people cover everything
// need different answers and neither is wrong.
//
// THREE SHAPES, chosen because they are the three a church would actually name out loud, and no more. An
// elaborate scheme here would be a settings page nobody can reason about, in the one part of the product where
// being unable to reason about the setting is the whole failure mode.
//
// THE LINE THAT DOES NOT MOVE, and it is the reason this section is safe to have at all: a lifetime changes
// WHEN a key is valid. Nothing here changes WHAT it opens. "This key opens the children's register and
// provably nothing else" is mechanism, not policy, and no setting may widen it — that is the August failure
// (granting Finance handed over the children's register) arriving by a different road.
//
// `max` is the longest window a grant declaring that lifetime may carry. `null` means genuinely open-ended,
// and ONLY the lifetime whose entire point is "until a steward ends it" has it. So a church that chose
// `session` can never, by any client, end up with a grant that is still open next weekend — the cap travels
// with the declared lifetime, in the enforced record, rather than living in one client's arithmetic.
export const HELPER_LIFETIMES = Object.freeze({
  // THE DEFAULT, and the tightest. A church that never opens the setting gets the safest behaviour rather than
  // the most convenient one. Twelve hours covers a Sunday morning with hours of slack either side and refuses
  // a grant that would still be open next weekend.
  session: {
    id: 'session', max: 12 * 3600,
    label: 'The rostered session only',
    describe: 'Access ends when the session does.',
    window(start, o) {
      const before = Number.isFinite(o.before) ? Math.max(0, Math.floor(o.before)) : 45 * 60;
      const after = Number.isFinite(o.after) ? Math.max(0, Math.floor(o.after)) : 3 * 3600;
      return { from: start - before, until: start + after };
    },
  },
  // For a church whose children's work runs across a morning and an afternoon, or an all-day event, and which
  // does not want a steward re-issuing a grant at lunchtime. Ends at local midnight of the service's own date,
  // so "that whole day" means the day the church means, not twenty-four hours from an arbitrary instant.
  day: {
    id: 'day', max: 26 * 3600,
    label: 'The whole of that day',
    describe: 'Access ends at the end of the day the session is on.',
    window(start, o, endOfDay) {
      const before = Number.isFinite(o.before) ? Math.max(0, Math.floor(o.before)) : 45 * 60;
      return { from: start - before, until: endOfDay };
    },
  },
  // For the small church where the same three people cover everything and re-issuing a grant every week is a
  // chore that would simply be skipped — which would leave them on the console, or on paper. Its safety comes
  // from revocation being immediate rather than from a clock, and a screen offering it must SAY that, because
  // "until a steward ends it" is only as good as somebody remembering to end it.
  open: {
    id: 'open', max: null,
    label: 'Until a steward ends it',
    describe: 'Access continues until a steward revokes it. Nothing expires on its own.',
    window(start, o) {
      const before = Number.isFinite(o.before) ? Math.max(0, Math.floor(o.before)) : 45 * 60;
      return { from: start - before, until: null };
    },
  },
});

// THE DEFAULT IS THE TIGHTEST OPTION, and it is asserted by name in the tests so that a later, well-meant
// change of it fails rather than ships.
export const DEFAULT_HELPER_LIFETIME = 'session';

export const isDeclaredLifetime = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(HELPER_LIFETIMES, id);

// The ceiling above every capped lifetime. A lifetime may be tighter than this and none may be looser, so
// adding a fourth shape cannot quietly extend the longest EXPIRING grant this product will store.
export const MAX_SESSION_SECONDS = 26 * 3600;

// ── THE SOURCES ───────────────────────────────────────────────────────────────────────────────────────────
// Each source answers exactly one question: given what the console knows, which pubkeys may hold the helper
// key for this session? Nothing else. No key material, no window, no publishing — those belong to the caller,
// so that adding a third source cannot accidentally change how a grant is minted.
//
// `resolve` returns an ARRAY of 64-hex pubkeys, de-duplicated, with falsy and malformed entries dropped. It
// must never throw on shabby input: a rota half-written by a console mid-edit must produce a shorter list,
// never an exception that leaves a church unable to staff its crèche.
const HEX64 = /^[0-9a-f]{64}$/;
const clean = (pubs) => {
  const out = [];
  const seen = new Set();
  for (const p of (pubs || [])) {
    const h = typeof p === 'string' ? p.trim().toLowerCase() : '';
    if (!HEX64.test(h) || seen.has(h)) continue;
    seen.add(h); out.push(h);
  }
  return out;
};

export const HELPER_SOURCES = Object.freeze({
  // TODAY. Whoever is on the rota for this service, in a slot belonging to a team the church has named as
  // children's work.
  //
  // THREE THINGS THIS HAS TO GET RIGHT, and each of them is a real trap in the shipped rota model:
  //
  //   1. `published` is a DRAFT FLAG and it is checked client-side only. A rota nobody has published is a
  //      steward pencilling names in. Deriving a key grant from a draft would hand the register to whoever
  //      was in the box at the moment somebody scrolled past. scripts/rota-view.test.mjs already sabotage-
  //      tests this for the serving screen; the same rule has to hold here, with more at stake.
  //   2. `assign` values carry `pub: ''` for a person with no app identity at all (stew-schedule.jsx lets a
  //      steward name someone who has never installed anything). Those are not helpers — there is no key to
  //      wrap anything to. They are dropped silently, which is correct: the rota is still right, the person
  //      still serves, they simply cannot hold a key they have no key for.
  //   3. Assign keys are the literal string `<teamId>::<roleId>`. A roleId may itself contain no `::`, but a
  //      teamId is console-minted and must be compared as the FIRST segment only — splitting on every `::`
  //      and taking [0] is the same thing app/app.jsx does.
  //
  // AND THE THING THE MODEL DOES NOT HAVE: there is no ministry taxonomy. A children's team is a
  // `trinityone/group:<id>` whose `kind` is 'team' and whose NAME a steward typed. Nothing marks a team as
  // children's work, so the church must SAY which teams they are — `childrenTeams`. That is a deliberate
  // input, not a guess: matching on the word "kids" in a team name would be a safeguarding gate built on
  // spelling, and a church running "Sunday Club" or "Junior Church" would silently get nobody.
  rota: {
    id: 'rota',
    label: 'Whoever is on the rota for this session',
    resolve(ctx) {
      const rota = (ctx && ctx.rota) || null;
      const teams = new Set(((ctx && ctx.childrenTeams) || []).filter(t => typeof t === 'string' && t));
      if (!rota || !rota.published || !rota.assign || !teams.size) return [];
      const out = [];
      for (const key of Object.keys(rota.assign)) {
        const teamId = String(key).split('::')[0];
        if (!teams.has(teamId)) continue;
        const who = rota.assign[key];
        if (who && who.pub) out.push(who.pub);
      }
      return clean(out);
    },
  },
  // TOMORROW, if the owner decides it. A named safeguarding team, taken from its roster.
  //
  // Written NOW rather than left as a comment, and this is the point of the file: if the swap were a
  // to-do it would be a rewrite, and the day it is wanted is the day somebody discovers that "the rota"
  // was welded into six places. It is also the honest test of the abstraction — a second implementation
  // that fits the same signature is the only proof the first one was not shaped around its caller.
  //
  // `roster:<teamId>` carries its pubkeys in the CLEAR (a top-level `pubs` array, sealed names beside it) —
  // exactly what six existing relay grants hang off — so this source needs no key to answer. Note the legacy
  // fallback: rosters written before 2026-09-05 have `people: [{pub}]` and no `pubs`, and a church that has
  // not re-saved a team since then would otherwise resolve to nobody.
  team: {
    id: 'team',
    label: 'A named safeguarding team',
    resolve(ctx) {
      const teamId = ctx && ctx.teamId;
      if (!teamId) return [];
      const roster = ((ctx && ctx.rosters) || []).find(r => r && (r.team === teamId || r.id === teamId));
      if (!roster) return [];
      const pubs = Array.isArray(roster.pubs) ? roster.pubs
        : ((roster.people || []).map(p => p && p.pub));
      return clean(pubs);
    },
  },
});

export const DEFAULT_HELPER_SOURCE = 'rota';

// Is this a source this build declares? The relay asks this of every grant it stores, so a grant claiming a
// provenance nobody implemented is refused rather than recorded as if it meant something.
export const isDeclaredSource = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(HELPER_SOURCES, id);

// THE ONE QUESTION. Everything that wants to know who may hold the helper key calls this.
//
// FAILS CLOSED, and that is not a detail. Every other fail-open default in this product is a fail-open for a
// good reason — an unknown rota-visibility value falls back to the OPEN setting because hiding a church's own
// rota from its congregation over a typo is its own harm. This is the opposite case: an unknown source here
// would be handing the children's register to a set nobody chose. So an unrecognised source is [], and the
// caller publishes a grant for nobody, and the crèche is staffed by the safeguarding steward as it is today.
// Nothing breaks that was working; nobody is admitted who was not named.
export function eligibleHelpers(sourceId, ctx) {
  if (!isDeclaredSource(sourceId)) return [];
  try { return HELPER_SOURCES[sourceId].resolve(ctx || {}); } catch { return []; }
}

// ── THE WINDOW ────────────────────────────────────────────────────────────────────────────────────────────
// A service says `{ date: 'YYYY-MM-DD', time: 'HH:MM' }` in LOCAL time, as strings, and nothing else — no
// duration, no end. So the window has to be constructed, and the arithmetic is worth doing in one place
// because a wrong sign here reads as "the helper key never works" or, far worse, "the helper key still works".
//
// ONE FUNCTION ANSWERS "WHEN", for every lifetime, exactly as eligibleHelpers answers "who". A caller passes
// the church's chosen lifetime and gets a window or null; it never does the arithmetic itself and never learns
// which shape it got.
export function lifetimeWindow(lifetimeId, service, opts) {
  const o = opts || {};
  const life = HELPER_LIFETIMES[isDeclaredLifetime(lifetimeId) ? lifetimeId : ''];
  if (!life) return null;                        // FAIL CLOSED: an unknown lifetime is no grant, never a long one
  const date = String((service && service.date) || '');
  const time = String((service && service.time) || '10:30');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;                     // no date we can place → no window → no grant. Never a default one.
  // Local time, matching how every other rota comparison in this product treats a service date
  // (app/app.jsx builds todayStr locally and compares strings, deliberately not UTC).
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]), 0, 0);
  const startS = Math.floor(start.getTime() / 1000);
  if (!Number.isFinite(startS)) return null;
  const endOfDay = Math.floor(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 0).getTime() / 1000);
  const w = life.window(startS, o, endOfDay);
  let from = Math.floor(w.from);
  let until = w.until == null ? null : Math.floor(w.until);
  // The cap is applied HERE as well as refused in windowFault, so a console asking for too much gets a valid
  // shorter grant rather than a silent nothing — a church that typed a generous margin should get its session,
  // not an unstaffed creche and no message.
  if (until != null && life.max != null && until - from > life.max) until = from + life.max;
  if (until != null && until <= from) return null;
  return { from, until, lifetime: life.id };
}

// Kept under its old name because it is the shape most callers want and reads better at a call site. It is
// the DEFAULT lifetime's window and nothing more — a thin alias, not a second implementation.
export const sessionWindow = (service, opts) => lifetimeWindow(DEFAULT_HELPER_LIFETIME, service, opts);

// Is a window one the relay will accept, under the lifetime it declares? Both sides call this so a console
// cannot mint something a relay silently drops. Returns a REASON on refusal rather than a bare false, because
// "the grant did not save" with no explanation is how a church ends up with an unstaffed creche and nothing
// to look at.
export function windowFault(from, until, lifetimeId) {
  if (!isDeclaredLifetime(lifetimeId)) return 'unknown lifetime ' + JSON.stringify(lifetimeId);
  const life = HELPER_LIFETIMES[lifetimeId];
  if (!Number.isInteger(from) || from <= 0) return 'from must be a positive whole unix second';
  if (until === null || until === undefined) {
    // AN OPEN-ENDED GRANT IS ONLY EVER LEGAL FOR THE LIFETIME WHOSE POINT IT IS. Omitting `until` under any
    // other lifetime is how a `session` grant would quietly become permanent, so it is refused rather than
    // defaulted — the mismatch is the mistake, and a mistake a church needs to see.
    return life.max == null ? '' : 'a ' + lifetimeId + ' grant must carry an end';
  }
  if (life.max == null) return 'an open-ended grant must not carry an end — revoke it to end it';
  if (!Number.isInteger(until) || until <= 0) return 'until must be a positive whole unix second';
  if (until <= from) return 'the window closes before it opens';
  if (until - from > life.max) return 'a ' + lifetimeId + ' grant may not exceed ' + life.max + ' seconds';
  if (until - from > MAX_SESSION_SECONDS) return 'no expiring grant may exceed ' + MAX_SESSION_SECONDS + ' seconds';
  return '';
}

// ── THE CHURCH'S ANSWER TO BOTH QUESTIONS, READ IN ONE PLACE ──────────────────────────────────────────────
// "Who may hold it" and "how long does it last" are both the church's to decide, and both must be read here
// rather than each caller reaching into a settings object and applying its own default. Two callers with two
// different notions of the default is how a console mints a grant the relay refuses, or worse, a longer one
// than the church chose.
//
// UNKNOWN VALUES FALL TO THE TIGHTEST, not to the status quo. That is the opposite of rota-settings, which
// falls back to the OPEN setting on purpose because hiding a church's rota over a typo is its own harm. Here
// the wrong direction hands the children's register to a set nobody chose, for longer than anybody chose.
export function helperPolicy(settings) {
  const s = settings || {};
  return {
    source: isDeclaredSource(s.source) ? s.source : DEFAULT_HELPER_SOURCE,
    lifetime: isDeclaredLifetime(s.lifetime) ? s.lifetime : DEFAULT_HELPER_LIFETIME,
  };
}

// ── THE GRANT ─────────────────────────────────────────────────────────────────────────────────────────────
// Build the document body the console publishes. Pure: it does no crypto of its own and touches no network.
// `wrap(pub, plaintext)` is supplied by the caller — nip44 in the console, a stub in a test — so this function
// can be executed for real in a test without a browser, a bundle, or a relay.
//
// SHAPE, and why each field is where it is:
//   { session, source, lifetime, from, until, pubs: [...], keys: { <pub>: <wrapped session key> } }
//
//   `pubs` is CLEARTEXT and is what the relay enforces. `keys` is the same set with the session key wrapped to
//   each of them, and is what actually opens anything. They must agree, so they are built from ONE list in ONE
//   pass — an earlier sketch of this took `recipients` for the keys and `pubs` for the relay separately, which
//   is precisely the shape that lets a rotation hand the key to someone the gate refuses (the bug CAP_KEYS's
//   _capAllows comment describes: "if those two ever disagreed, a rotation would quietly hand the key to
//   someone the mint had excluded").
//
//   THERE IS NO `rev`, AND THERE WAS ONE UNTIL 2026-09-09. It is recorded here rather than quietly dropped,
//   because the reason it was added is written into a commit message that is now wrong: "newest wins, by rev
//   then by timestamp … with a rev in front of it because a church may republish a corrected grant inside the
//   same second." It cannot do that job. `scripts/event-store.mjs` tie-breaks a same-second addressable
//   replacement by LOWEST EVENT ID and returns 'have-newer', and the gateway only calls note() when put()
//   returned 'stored' — so a corrected same-second grant is rejected one layer BELOW the comparison, and `rev`
//   is never looked at. Measured 2026-09-09 over 200 pairs of real signed events: 90 corrections rejected, a
//   coin-flip on two sha256 ids.
//
//   Worse than useless, in the one case where it did fire — a grant carrying a NEWER created_at and a LOWER
//   rev. Measured against a live relay the same day: the guard correctly kept a removed helper out, the store
//   kept the newer document the guard had refused, and A RESTART PUT THE HELPER BACK ON THE CHILDREN'S
//   REGISTER. The map and the corpus disagreed and the reboot resolved it the wrong way. This relay restarts
//   itself, so that is a scheduled reversal, not a corner.
//
//   WHAT ACTUALLY ORDERS TWO GRANTS is created_at, enforced by put() before anything here runs, and it is the
//   right rule rather than merely the surviving one: this document is OWNER-ONLY, so the only key that can
//   produce a grant carrying a later timestamp is the church's own. A stale copy replayed by a rehydrate or a
//   peer sync carries its ORIGINAL created_at inside the signature and cannot be given a fresher one. `rev`
//   was the relay second-guessing the church's own signed timestamp, and then forgetting it had.
//
//   Nothing shipped ever incremented it either: src/steward.src.js sent `rev: 1` on every grant it minted and
//   nothing anywhere bumped it, which is the same defect CAP_KEYS's own comment lists among the five real bugs
//   in the finance key — "`rev` written but never compared".
//
// RECIPIENTS ARE NOT ONLY THE HELPERS. The church and its safeguarding stewards are wrapped in too, or a
// record a helper writes is unreadable by the people accountable for the register — a check-in that nobody
// but the volunteer who typed it can ever open is not a safeguarding record. That is also what keeps this
// slice from narrowing existing access: the register's own key (trinityone/checkinkey:) is untouched, and the
// people who hold it are additionally given each session's key.
export function buildHelperGrant({ session, source, lifetime, from, until, helpers, keepers, sessionKeyHex, wrap }) {
  const sid = String(session || '');
  if (!sid) throw new Error('buildHelperGrant: no session id');
  if (!isDeclaredSource(source)) throw new Error('buildHelperGrant: undeclared helper source ' + JSON.stringify(source));
  // NO DEFAULT APPLIED HERE, deliberately. helperPolicy() is where the church's answer is read and where a
  // missing setting becomes the tightest lifetime; a second default in the builder would be a second opinion,
  // and the one place this feature must not have two opinions is how long a key to the children's register
  // lives. An omitted lifetime is a caller that has not asked the church, and that is an error, not a session.
  if (!isDeclaredLifetime(lifetime)) throw new Error('buildHelperGrant: undeclared lifetime ' + JSON.stringify(lifetime));
  const end = (until === undefined) ? null : until;
  const fault = windowFault(from, end, lifetime);
  if (fault) throw new Error('buildHelperGrant: ' + fault);
  if (typeof wrap !== 'function') throw new Error('buildHelperGrant: wrap must be a function');
  if (!/^[0-9a-f]{64}$/.test(String(sessionKeyHex || ''))) throw new Error('buildHelperGrant: sessionKeyHex must be 32 bytes of hex');
  // The helpers are what the relay admits; the keepers are the church + its safeguarding stewards, who must be
  // able to READ what a helper writes but are NOT admitted BY this grant — they already hold that authority
  // through trinityone/stewards: and it must not appear to come from here. Kept as two lists for exactly that
  // reason, unioned only for the key wrapping.
  const pubs = clean(helpers);
  const readers = clean([...pubs, ...(keepers || [])]);
  const keys = {};
  const failed = [];
  for (const p of readers) {
    try { keys[p] = wrap(p, sessionKeyHex); } catch { failed.push(p); }
  }
  // A grant that silently omitted somebody is a helper who turns up and finds an empty room with no error.
  // Report it; do not refuse the whole grant, or one damaged pubkey denies the session to everyone else —
  // the same judgement _warnUnsealed makes in the console for capability keys.
  return { doc: { session: sid, source, lifetime, from, until: end, pubs, keys }, failed };
}

// Read a grant back. Used by the relay's ingest and by any client that needs to know whether its turn is on,
// so there is one parser and one set of rules about what a malformed grant means.
//
// Returns null for anything it cannot vouch for. A caller must treat null as "no grant", never as "no limits".
export function readHelperGrant(content) {
  let c;
  try { c = JSON.parse(content || ''); } catch { return null; }
  if (!c || typeof c !== 'object') return null;
  const session = String(c.session || '');
  const source = c.source;
  // A GRANT WITH NO LIFETIME IS NOT A SESSION GRANT, it is a grant we cannot vouch for. Defaulting it here
  // would silently reinterpret a document written by some other client, and the value being reinterpreted is
  // how long somebody may read the children's register.
  const lifetime = c.lifetime;
  const from = c.from;
  const until = (c.until === undefined) ? null : c.until;
  if (!session || !isDeclaredSource(source) || windowFault(from, until, lifetime)) return null;
  return {
    session, source, lifetime, from, until,
    pubs: clean(c.pubs),
    keys: (c.keys && typeof c.keys === 'object') ? c.keys : {},
  };
}

// Is `pub` a helper for this grant, right now? The ONE time-scoped membership test.
//
// Inclusive at both ends, and `at` is always passed in rather than read from the clock here, so a test can
// prove the boundary rather than assert around it.
export function grantAdmits(grant, pub, at) {
  if (!grant || !pub || !Number.isFinite(at)) return false;
  if (at < grant.from) return false;
  // `until == null` is the open-ended lifetime, and ONLY windowFault decides that is legal for the lifetime
  // the grant declares — so this line cannot be reached by a `session` grant that simply omitted its end.
  if (grant.until != null && at > grant.until) return false;
  return grant.pubs.indexOf(String(pub).toLowerCase()) >= 0;
}

// Unwrap this session's key, if there is one here for me. `unwrap(ciphertext)` is caller-supplied, as in
// buildHelperGrant. Returns '' rather than throwing: "my turn is not on" and "I am not a helper" are ordinary
// answers, not faults.
export function helperKeyFor(grant, pub, at, unwrap) {
  if (!grantAdmits(grant, pub, at)) return '';
  const ct = grant.keys[String(pub).toLowerCase()];
  if (!ct) return '';
  try { const k = unwrap(ct); return /^[0-9a-f]{64}$/.test(String(k || '')) ? String(k) : ''; } catch { return ''; }
}
