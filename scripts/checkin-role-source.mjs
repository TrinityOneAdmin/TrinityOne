// WHO MAY HOLD THE CHECK-IN HELPER KEY. Asked once, here, and nowhere else.
//
// ══ TWO DOCUMENTS, TWO QUESTIONS — RESTRUCTURED 2026-09-09 ═════════════════════════════════════════════════
// reference/FINDING-CHECKIN-GRANTS-SHOULD-BE-PER-PERSON-2026-09-09.md, the owner's DECIDED block.
//
// The first cut of this file answered ONE question — "who may hold the key for THIS SERVICE" — and the answer
// document was structurally per-service (`checkinhelper:<serviceId>`). The owner, reading it back:
//
//     "in general most people approved as safeguarding adults, are approved church wide on a yearly basis.
//      If I'm reading this correctly, we probably don't need per session permissions."
//
// He was right, and the mismatch was real: UK churches clear volunteers ANNUALLY AND CHURCH-WIDE (DBS, a
// safeguarding lead's sign-off, a training course). A system that made twelve cleared people be re-authorised
// every Sunday was not reflecting the church's policy, it was substituting a stricter one — the exact mistake
// reference/DOMAIN.md records him correcting the day before ("we are not the policy and we are not the
// inspector").
//
// THE TRADE HE WAS OFFERED, and the one he refused: a person-scoped grant that simply wrapped a longer-lived
// register key. Simpler, and a lost phone would then expose the whole YEAR's register instead of one Sunday.
// He kept the blast radius and paid for it in machinery. So there are now two documents:
//
//   • A PERMISSION — `trinityone/checkinperm:<personPub>` — says A PERSON IS CLEARED. Scoped to the person,
//     lasting until the church ends it. This is what a steward grants, ONCE, matching the annual clearance the
//     church already does. It carries NO KEY AT ALL: it is an authorisation, not an envelope.
//   • A SESSION KEY — `trinityone/checkinhelper:<serviceId>` — stays per session, and is ISSUED TO WHOEVER THE
//     PERMISSION ADMITS WITHOUT A STEWARD DOING ANYTHING WEEKLY. Same shape as before, same enforcement, and
//     it can no longer be open-ended (see HELPER_LIFETIMES).
//
// BOTH ARE REQUIRED, AND THAT CONJUNCTION IS THE LOAD-BEARING PART. The relay admits a helper to a session's
// records iff the session envelope names them AND a live permission covers them. Without it, revoking a
// person's clearance would leave every envelope already issued for future Sundays still admitting them, and
// "lasts until the church ends it" would need a steward to hunt down one document per service — which is the
// per-service chore this restructure exists to delete.
//
// WHAT THAT BUYS, and it is the property the extra machinery is for: a compromised helper phone holds the
// session keys it actually fetched. It cannot obtain a key for a session that closed before its permission
// opened, nor for any session after the permission is revoked or lapses, nor for one more than
// KEY_LEAD_SECONDS in the future. One Sunday, or a fortnight at the very worst — never the year.
//
// WHAT IT COSTS, said here because it is a PRODUCT problem and not an implementation detail: the session key
// must be wrapped to each recipient with the church's own key, so THE ISSUER IS THE CONSOLE, and a console has
// to open at some point between the permission being granted and the Sunday. Nothing on the relay can do it —
// a relay that could wrap the key could read the register. See issueCheckinSessionKeys in src/steward.src.js.
//
// ══ AND THE ORIGINAL QUESTION, UNCHANGED ══════════════════════════════════════════════════════════════════
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
  // THERE IS NO `open` HERE ANY MORE, AND ITS ABSENCE IS THE POINT OF THE 2026-09-09 RESTRUCTURE.
  //
  // It used to live here — "until a steward ends it" — because a session grant was ALSO the thing that said a
  // person was cleared, so the small church that re-staffs nothing had to be able to say "leave it open". Now
  // that "is this person cleared" is its own document with its own lifetimes (PERMISSION_LIFETIMES below), an
  // open-ended SESSION KEY would be a standing key to the children's register and nothing else. Worse under
  // the new model than under the old one: session keys are now issued WITHOUT A STEWARD ACTING, so an
  // open-ended one could be minted by machinery nobody watched.
  //
  // So every lifetime in this table has a `max`, windowFault refuses a missing `until` under all of them, and
  // NO SESSION KEY THIS PRODUCT CAN MINT OUTLIVES 26 HOURS. The church's "until a steward ends it" is not
  // lost — it moved to the permission, where it means what a church means by it: this person is cleared until
  // we say otherwise.
});

// THE DEFAULT IS THE TIGHTEST OPTION, and it is asserted by name in the tests so that a later, well-meant
// change of it fails rather than ships.
export const DEFAULT_HELPER_LIFETIME = 'session';

export const isDeclaredLifetime = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(HELPER_LIFETIMES, id);

// The ceiling above every capped lifetime. A lifetime may be tighter than this and none may be looser, so
// adding a fourth shape cannot quietly extend the longest EXPIRING grant this product will store.
export const MAX_SESSION_SECONDS = 26 * 3600;

// ── HOW LONG A PERMISSION LIVES: THE ANNUAL CLEARANCE, IN THE CHURCH'S OWN WORDS ───────────────────────────
// The finding: "Expiry moves from a window around a service to a date the church sets."
//
// THREE SHAPES AGAIN, and deliberately not the same three. A session key's lifetimes are about a morning; a
// permission's are about a person's standing in the church, so they are the three sentences a safeguarding
// lead would actually say:
//
//   • "just today"  — the parent helping out this week, the visiting speaker's assistant, a one-off holiday
//     club. The finding asks for this explicitly: "Keep per-session as the narrower option, because it has a
//     real use … those are exactly the people a church has NOT cleared for the year."
//   • "until this date" — the annual clearance, which is what almost every church will pick. The DATE is the
//     church's; we only cap how far it can reach.
//   • "until we say otherwise" — the small church that clears three people and reviews it when something
//     changes. Its safety is revocation, which is immediate, and a screen offering it must SAY so.
//
// THE DEFAULT IS THE TIGHTEST, as it is for session keys, and for the same reason: a church that never opens
// the screen gets the safest behaviour rather than the most convenient one.
//
// WHY `open` IS LEGAL HERE AND NOT FOR A SESSION KEY. This document carries no key material. An open-ended
// permission means "we have not withdrawn her clearance"; an open-ended session key would mean "this phone
// opens the children's register for ever". The first is a fact about a person that the church maintains; the
// second is a standing key. That distinction IS the restructure.
export const PERMISSION_LIFETIMES = Object.freeze({
  // THE DEFAULT, and the tightest.
  day: {
    id: 'day', max: 26 * 3600,
    label: 'Just that day',
    describe: 'Cleared for that one day. Ends at the end of it.',
  },
  // The annual clearance. 400 days is a year plus slack for a church that renews late — long enough that
  // "annually" is expressible, short enough that a clearance nobody ever revisits still lapses.
  dated: {
    id: 'dated', max: 400 * 24 * 3600,
    label: 'Until a date the church sets',
    describe: 'Cleared until the date you choose. Nothing renews it on its own.',
  },
  // No end. Ended by a steward, and by nothing else.
  open: {
    id: 'open', max: null,
    label: 'Until a steward ends it',
    describe: 'Cleared until somebody removes it. Nothing expires on its own.',
  },
});

// THE DEFAULT IS THE TIGHTEST OPTION, asserted by name in the tests so a later, well-meant change of it fails
// rather than ships.
export const DEFAULT_PERMISSION_LIFETIME = 'day';
export const isDeclaredPermissionLifetime = (id) =>
  typeof id === 'string' && Object.prototype.hasOwnProperty.call(PERMISSION_LIFETIMES, id);

// The ceiling above every capped PERMISSION lifetime, the sibling of MAX_SESSION_SECONDS. Adding a fourth
// shape cannot quietly extend the longest EXPIRING clearance this product will store.
export const MAX_PERMISSION_SECONDS = 400 * 24 * 3600;

// ── HOW FAR AHEAD A PHONE MAY FETCH A SESSION KEY ─────────────────────────────────────────────────────────
// THE BLAST RADIUS, ENFORCED BY THE RELAY RATHER THAN CHOSEN BY A CONSOLE, and this is what makes the owner's
// decision worth its machinery.
//
// Session keys are now issued automatically, ahead of time, for every service a console can see. Without this
// number a helper cleared for the year could fetch every envelope the console had run ahead and minted — which
// is the whole-year exposure he refused, arriving through the back door of an automatic issuer.
//
// So: a named helper may fetch a session key from `until` back to `from - KEY_LEAD_SECONDS`, and outside that
// the relay refuses it. A console that issues a year ahead therefore leaks a fortnight, not a year, and the
// limit lives in the box rather than in a client's judgement. It is NOT a limit on working: the records
// themselves are gated on the session's own window, which is unchanged.
export const KEY_LEAD_SECONDS = 14 * 24 * 3600;

// The window a permission covers. Same division of labour as lifetimeWindow(): the caller passes the church's
// chosen shape and gets a window or null, and never does the arithmetic itself.
//
//   `date`  — 'YYYY-MM-DD', required by `day`: the one day the person is cleared for.
//   `until` — 'YYYY-MM-DD', required by `dated`: the last day of the clearance.
//   `from`  — unix seconds, when the clearance starts. Defaults to `at`, which defaults to now.
//
// LOCAL TIME, matching lifetimeWindow() and every other date comparison in this product. A church saying
// "cleared to the 31st of December" means their own 31st of December.
export function permissionWindow(lifetimeId, opts) {
  const o = opts || {};
  if (!isDeclaredPermissionLifetime(lifetimeId)) return null;   // FAIL CLOSED: an unknown shape is no clearance
  const at = Number.isFinite(o.at) ? Math.floor(o.at) : Math.floor(Date.now() / 1000);
  const dayBounds = (str) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]) - 1, dd = Number(m[3]);
    const a = Math.floor(new Date(y, mo, dd, 0, 0, 0, 0).getTime() / 1000);
    const b = Math.floor(new Date(y, mo, dd, 23, 59, 59, 0).getTime() / 1000);
    return (Number.isFinite(a) && Number.isFinite(b)) ? { a, b } : null;
  };
  if (lifetimeId === 'day') {
    const b = dayBounds(o.date);
    if (!b) return null;                       // no date we can place → NO permission. Never a default one.
    return { from: b.a, until: b.b, lifetime: 'day' };
  }
  if (lifetimeId === 'dated') {
    const b = dayBounds(o.until);
    if (!b) return null;
    const from = Number.isFinite(o.from) ? Math.floor(o.from) : at;
    if (b.b <= from) return null;              // a clearance that ended before it began is a typo, not a window
    if (b.b - from > PERMISSION_LIFETIMES.dated.max) return null;   // refused, not silently shortened: a church
    return { from, until: b.b, lifetime: 'dated' };                 // that typed 2099 must see it, not get 2027
  }
  return { from: Number.isFinite(o.from) ? Math.floor(o.from) : at, until: null, lifetime: 'open' };
}

// Is this window one the relay will accept, under the PERMISSION lifetime it declares? The sibling of
// windowFault, kept separate rather than generalised because the two tables answer different questions and one
// of them permits an open end. Returns a REASON on refusal, for the same reason windowFault does.
export function permissionFault(from, until, lifetimeId) {
  if (!isDeclaredPermissionLifetime(lifetimeId)) return 'unknown permission lifetime ' + JSON.stringify(lifetimeId);
  const life = PERMISSION_LIFETIMES[lifetimeId];
  if (!Number.isInteger(from) || from <= 0) return 'from must be a positive whole unix second';
  if (until === null || until === undefined) {
    // AN OPEN-ENDED PERMISSION IS ONLY EVER LEGAL FOR THE LIFETIME WHOSE POINT IT IS. Omitting `until` under
    // `day` or `dated` is how "cleared for today" would quietly become "cleared for ever".
    return life.max == null ? '' : 'a ' + lifetimeId + ' permission must carry an end';
  }
  if (life.max == null) return 'an open-ended permission must not carry an end — revoke it to end it';
  if (!Number.isInteger(until) || until <= 0) return 'until must be a positive whole unix second';
  if (until <= from) return 'the clearance closes before it opens';
  if (until - from > life.max) return 'a ' + lifetimeId + ' permission may not exceed ' + life.max + ' seconds';
  if (until - from > MAX_PERMISSION_SECONDS) return 'no expiring permission may exceed ' + MAX_PERMISSION_SECONDS + ' seconds';
  return '';
}

// Build the permission body the console publishes. Pure, and it does NO CRYPTO — there is nothing to wrap.
// That absence is the whole reason a permission may be open-ended and a session key may not.
//
// SHAPE: { person, source, lifetime, from, until }
//
//   `person` is repeated inside the body even though it is already the d-tag suffix, and the relay refuses a
//   document where the two disagree. Same rule as the grant's `session`, and for the same reason: a permission
//   whose d-tag names one member and whose body names another is how a clearance meant for one person would
//   admit somebody else entirely.
//
//   `source` records WHICH question said this person is cleared — the rota, a named safeguarding team, or a
//   steward naming them directly. It may NOT be 'permission': a permission cannot cite itself as its own
//   provenance, and isPermissionSource is what refuses that.
//
//   THERE IS NO KEY AND NO `keys` OBJECT. If you find yourself adding one, stop: that is the collapse back to
//   "a person-scoped grant wrapping a longer-lived register key", which the owner considered and refused
//   because a lost phone would then expose the year rather than the Sunday.
export function buildCheckinPermission({ person, source, lifetime, from, until }) {
  const who = String(person || '').trim().toLowerCase();
  if (!HEX64.test(who)) throw new Error('buildCheckinPermission: person must be a 64-hex pubkey');
  if (!isPermissionSource(source)) throw new Error('buildCheckinPermission: undeclared permission source ' + JSON.stringify(source));
  if (!isDeclaredPermissionLifetime(lifetime)) throw new Error('buildCheckinPermission: undeclared lifetime ' + JSON.stringify(lifetime));
  const end = (until === undefined) ? null : until;
  const fault = permissionFault(from, end, lifetime);
  if (fault) throw new Error('buildCheckinPermission: ' + fault);
  return { person: who, source, lifetime, from, until: end };
}

// Read a permission back. One parser, used by the relay's ingest, by its write gate, and by the console's
// issuer — so "what a permission means" is decided once. Returns null for anything it cannot vouch for, and a
// caller must treat null as "no permission", NEVER as "no limits".
export function readCheckinPermission(content) {
  let c;
  try { c = JSON.parse(content || ''); } catch { return null; }
  if (!c || typeof c !== 'object') return null;
  const person = String(c.person || '').trim().toLowerCase();
  const until = (c.until === undefined) ? null : c.until;
  if (!HEX64.test(person)) return null;
  if (!isPermissionSource(c.source)) return null;
  if (permissionFault(c.from, until, c.lifetime)) return null;
  return { person, source: c.source, lifetime: c.lifetime, from: c.from, until };
}

// Is this permission live at `at`? Inclusive at both ends, and `at` is a parameter rather than a clock read so
// a test can prove the boundary instead of asserting around it — exactly as grantAdmits does.
//
// A PERMISSION THAT HAS NOT OPENED YET ADMITS NOBODY, which is what makes granting a January clearance in
// December safe.
export function permissionAdmits(perm, at) {
  if (!perm || !Number.isFinite(at)) return false;
  if (!HEX64.test(String(perm.person || ''))) return false;
  // THE SHAPE, NOT ONLY THE WINDOW — and this checked only the window until it was measured wrong on
  // 2026-09-09, by the issuer test in checkin-helper-mint-is-the-shipped-one.test.mjs. An object of the form
  // { person, from: 1, until: null } with NO declared source and NO declared lifetime was admitted, because
  // every field this function looked at was fine and the ones that make a permission a permission were not
  // looked at at all.
  //
  // WHY THAT MATTERED. Real permissions reach here through readCheckinPermission, which does validate both, so
  // nothing shipped was reachable — but this is the function every caller asks, and "an unknown shape clears
  // NOBODY" is the rule the whole module is built on. A window-only check quietly made the opposite true for
  // anything that had not been through the parser: an unbounded, sourceless clearance would have been honoured.
  if (!isPermissionSource(perm.source)) return false;
  if (permissionFault(perm.from, perm.until == null ? null : perm.until, perm.lifetime)) return false;
  if (at < perm.from) return false;
  if (perm.until != null && at > perm.until) return false;
  return true;
}

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
  // A STEWARD NAMED THEM, BY HAND. Added 2026-09-09 with the permission layer, and it is the ordinary case
  // rather than an escape hatch: an annual clearance is a HUMAN decision — a DBS certificate, a lead's
  // sign-off, a training course — and none of those facts are in this product. A steward types the names.
  //
  // It also stops `helpers`/`people` being a way AROUND the source system. Before this, publishCheckinHelpers
  // took an explicit `helpers` array and recorded whatever `source` it was told, so a hand-picked list could be
  // filed under 'rota' provenance and nothing would notice. Now naming somebody by hand IS a declared source
  // and says so in the enforced record.
  steward: {
    id: 'steward',
    label: 'A steward named them',
    resolve(ctx) { return clean((ctx && ctx.people) || []); },
  },
  // THE ONLY SOURCE A SESSION ENVELOPE MAY DECLARE, and the one that makes the weekly steward act disappear.
  //
  // It is not interchangeable with the three above: they answer "who should the church CLEAR", which is a
  // question about people, and this answers "who HAS the church cleared, right now", which is a question about
  // documents the church has already signed. isPermissionSource() is what keeps them apart — a permission may
  // not cite this as its provenance (that would be circular) and an envelope may cite nothing else (that would
  // be the pre-restructure model, where a rota decided who held a key).
  //
  // `ctx.permissions` is an array of parsed permissions (readCheckinPermission's output) and `ctx.at` the
  // instant to judge them at. It reads a clock from nowhere.
  permission: {
    id: 'permission',
    label: 'Whoever the church has cleared',
    resolve(ctx) {
      const at = Number.isFinite(ctx && ctx.at) ? ctx.at : Math.floor(Date.now() / 1000);
      return clean(((ctx && ctx.permissions) || []).filter(pm => permissionAdmits(pm, at)).map(pm => pm && pm.person));
    },
  },
});

// WHICH SOURCES MAY SAY A PERSON IS CLEARED — every declared one EXCEPT 'permission'. A permission citing
// 'permission' as its own provenance is a loop, and a loop in a safeguarding record is not a shape to leave
// legal on the grounds that nothing writes one today.
export const isPermissionSource = (id) => isDeclaredSource(id) && id !== GRANT_SOURCE;

// The one source name a session envelope may declare. Named rather than spelled out at four call sites,
// because a typo in one of them is a grant the relay refuses on a Sunday morning.
export const GRANT_SOURCE = 'permission';

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

// WHO HAS THE CHURCH CLEARED, RIGHT NOW. The finding asked for exactly this rename of the question:
// "eligibleHelpers currently answers 'who is rostered to THIS service'. It would answer 'who has the church
// cleared', with the rota as one possible source."
//
// A THIN ALIAS OVER eligibleHelpers, not a second implementation — the same reason sessionWindow is a thin
// alias over lifetimeWindow. This is what the ISSUER calls, once per service, and it is the only thing that
// decides who a session envelope is wrapped to.
export const permittedHelpers = (permissions, at) => eligibleHelpers(GRANT_SOURCE, { permissions, at });

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
    // NO SESSION KEY MAY BE OPEN-ENDED, under any lifetime. This read `life.max == null ? '' : …` until
    // 2026-09-09, when `open` was a helper lifetime; now the open-ended shape belongs to a PERMISSION, and a
    // session key with no end would be a standing key to the children's register minted by machinery rather
    // than by a steward. Refused rather than defaulted: the mismatch is the mistake, and a mistake a church
    // needs to see.
    return 'a ' + lifetimeId + ' key must carry an end — only a PERMISSION may be open-ended';
  }
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
    // `source` NARROWED TO A PERMISSION SOURCE, 2026-09-09. It used to be the envelope's provenance; the
    // envelope's is pinned to GRANT_SOURCE now, and this is the question it always really answered — which
    // list a steward is shown when deciding WHO TO CLEAR. A church whose stored setting says 'permission'
    // (nothing writes one, but a hand-edited or future document could) falls to the default rather than being
    // honoured, because "clear whoever is already cleared" is not an answer.
    source: isPermissionSource(s.source) ? s.source : DEFAULT_HELPER_SOURCE,
    // The SESSION KEY's lifetime. A church that stored 'open' before 2026-09-09 falls back to the tightest
    // here rather than keeping a shape that no longer exists — the safe direction, and the one this function's
    // own comment above already commits to.
    lifetime: isDeclaredLifetime(s.lifetime) ? s.lifetime : DEFAULT_HELPER_LIFETIME,
  };
}

// THE SAME, FOR A PERMISSION. Kept as its own function rather than a third field on helperPolicy: "how long is
// this person cleared for" and "how long does a Sunday's key last" are different decisions taken on different
// screens, and a single object would let a caller apply one where it meant the other. Two functions cannot be
// confused by accident; two fields of one object can.
export function permissionPolicy(settings) {
  const s = settings || {};
  return {
    source: isPermissionSource(s.source) ? s.source : DEFAULT_HELPER_SOURCE,
    lifetime: isDeclaredPermissionLifetime(s.lifetime) ? s.lifetime : DEFAULT_PERMISSION_LIFETIME,
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
//   WHAT ACTUALLY ORDERS TWO GRANTS is created_at, enforced by put() before anything here runs. It is THE
//   SURVIVING RULE, AND IT IS NOT THE RIGHT ONE — corrected 2026-09-09, because the sentence that stood here
//   until then was measured false and a false claim in the permanent record is worse than the bug it hides.
//
//   WHAT IT SAID: "this document is OWNER-ONLY, so the only key that can produce a grant carrying a later
//   timestamp is the church's own" — therefore a later timestamp IS the church speaking more recently.
//
//   WHY THAT IS FALSE: scripts/event-store.mjs:149 accepts a created_at up to +900s ahead of the relay's own
//   clock. A church device whose clock runs fast writes a grant stamped up to fifteen minutes in the future,
//   and every HONEST correction the same church signs in that window carries a LOWER timestamp and is refused
//   as stale. The signing key is the church's in both cases; the timestamps are what disagree. So an honest
//   revocation can be refused for up to fifteen minutes by the church's own fast clock.
//
//   WHY IT STANDS ANYWAY: the owner judged mid-session revocation unlikely in practice and chose not to spend
//   on it (2026-09-09). The window is bounded at 900 seconds, it needs the church's OWN device to be running
//   fast, and the restructure below narrows what a stale grant can even do — a session key is now useless
//   without a live PERMISSION, and revoking the permission is a DIFFERENT document, so it is not exposed to
//   this window at all. That is the mitigation; it is not a fix, and nobody should read this paragraph as one.
//
//   A stale copy replayed by a rehydrate or arriving from a peer sync carries its ORIGINAL created_at inside
//   the signature and cannot be given a fresher one — that case, which is the one this guard was really for,
//   created_at does handle. `rev` was the relay second-guessing the church's own signed timestamp and then
//   forgetting it had, which is a different and worse failure than the one described above.
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
  // THE ENVELOPE'S SOURCE IS PINNED, NOT MERELY DECLARED — tightened 2026-09-09 with the permission layer.
  // This read `isDeclaredSource(source)` until then, which was right when a rota decided who held a key. It no
  // longer does: an envelope is issued from the church's PERMISSIONS and from nothing else. Refusing every
  // other name here (and in readHelperGrant, and so at the relay) means a console that tried to mint a
  // rota-derived envelope — the pre-restructure shape — is refused rather than quietly honoured. That is the
  // regression this pin exists to catch, and it would otherwise look exactly like working software.
  if (source !== GRANT_SOURCE) throw new Error('buildHelperGrant: a session envelope must declare source ' +
    JSON.stringify(GRANT_SOURCE) + ', not ' + JSON.stringify(source) + ' — who may hold a key is a PERMISSION now');
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
  if (!session || source !== GRANT_SOURCE || windowFault(from, until, lifetime)) return null;
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

// ── THE OTHER END OF THAT KEY: OPEN THE HELPER'S COPY OF A CHECK-IN RECORD ────────────────────────────────
//
// Piece 1 of reference/SCOPE-CHECKIN-SEALING-2026-09-10.md. `helperKeyFor` above hands back a session key;
// until this function existed there was nothing that key opened, because a record was sealed only to the
// church's safeguarding ring. The owner's decision of 2026-09-10 double-locks each record: `content` stays
// the ring's ciphertext, byte for byte, and a SECOND copy rides in a `['ck', …]` tag sealed under the session
// key. This is the reader for that tag.
//
// IT LIVES HERE, beside the grant parser, for the reason the rest of this module exists: the writer is in the
// steward console, the first product reader is also the console (encSubscribe's fallback), and the client that
// actually needs it — a cleared helper's own app — DOES NOT EXIST YET. A copy of these rules in each would be
// three chances to disagree about what a malformed record means.
//
// `unseal(ciphertext, keyHex)` IS CALLER-SUPPLIED, exactly as `unwrap` is in buildHelperGrant and
// helperKeyFor, and for the same reason: this module must not depend on a crypto implementation, and the
// relay imports it too.
//
// RETURNS null FOR ANYTHING IT CANNOT VOUCH FOR, and a caller must read null as "no helper copy" and NEVER as
// "no record". The distinction matters on this data more than most: the register still exists and the church
// can still read it through `content`. A reader that treated null as an empty register would show a leader at
// the door an empty room.
//
// FOUR REFUSALS, each for a measured reason rather than for tidiness:
//   • NO `ck` TAG — the ordinary case, not a fault. Every record written before this feature, and every
//     record written for a session this console held no key for, has none. reference/DOMAIN.md and design
//     §10: nothing may block a check-in, so the writer omits the copy rather than refusing to write.
//   • A KEY THAT IS NOT 32 BYTES OF HEX — helperKeyFor returns '' for "my turn is not on" and "I am not a
//     helper", and '' must not be handed to a cipher as if it were a key.
//   • THE FIRST `ck` ONLY. Tags are attacker-controlled in the sense that matters here: the event is signed,
//     so only its author can add one, but an author could add several. Trying each in turn would let a
//     writer offer alternatives; taking the first is the same rule the d-tag and session-tag readers apply.
//   • A BODY THAT IS NOT AN OBJECT — a JSON string or array parses fine and would spread into a row as
//     characters.
export function readCheckinHelperCopy(tags, keyHex, unseal) {
  if (!Array.isArray(tags)) return null;
  if (!/^[0-9a-f]{64}$/.test(String(keyHex || ''))) return null;
  if (typeof unseal !== 'function') return null;
  const ct = (tags.find(t => Array.isArray(t) && t[0] === 'ck') || [])[1] || '';
  if (!ct) return null;
  try {
    const obj = JSON.parse(unseal(String(ct), String(keyHex)));
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : null;
  } catch { return null; }
}

// WHICH SESSION A RECORD BELONGS TO, read from its CLEARTEXT tag rather than from the sealed body.
//
// This is the one thing a reader must know BEFORE it can open anything: which session key to reach for. The
// body would answer the same question and is no use — it is inside the ciphertext this is trying to open.
// `_encCleartextTags` in the console emits it for exactly this purpose, and the relay's own read gate keys on
// the same tag, so the client and the box agree about which session a record is in by construction.
export function checkinSessionOf(tags) {
  if (!Array.isArray(tags)) return '';
  return String(((tags.find(t => Array.isArray(t) && t[0] === 'session') || [])[1] || '')).trim();
}
