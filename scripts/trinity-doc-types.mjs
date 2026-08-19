// THE DECLARED LIST OF DOCUMENT TYPES. One place that says what each `d`-tag is and who may touch it.
//
// ARCHITECTURE-2026-07-29, recommendation 2. Church data is kind-30078 addressable documents keyed by their
// `d`-tag, and the d-tag STRINGS were typed out independently in three files: 49 of them appear in both
// scripts/gateway.mjs and at least one client engine, with no shared definition. A typo in one place is not a
// build error — it is a document the relay gates under one name while a client publishes under another, and
// nothing fails loudly.
//
// It also turned up five types that exist in the clients and have NO rule in the relay at all:
// checkin:, groupkey:, msgtags, sermon:, wallet:. Measured against a real gateway, all five currently behave
// acceptably — none is world-readable, and wallet: is author-only because it carries no church tag — but they
// do so by inheriting a GENERIC rule that nobody chose for them, rather than by declaration. That is an
// assurance gap, not a live hole, and this file is where it stops being invisible.
//
// WHAT THIS FILE IS NOT, YET. It does not replace the constants in gateway.mjs or the engines. Rewiring the
// authorization spine to read from here is a behaviour-changing edit to infrastructure and is deliberately a
// separate, later step. For now this is the DECLARATION, and scripts/doc-registry.test.mjs is the conformance
// check: if any source file grows, loses or misspells a d-tag relative to this list, the test says so by name.
// Value now, risk later, in that order.
//
// ── ARCHITECTURE-AUDIT-2026-07-30 A6 ─────────────────────────────────────────────────────────────────────
// This list said "all 55". It was 55 of at least 65. The conformance check read THREE files — gateway.mjs and
// the two big engines — which are the same three this file was built from, so its universe was identical to
// this one's and it could not, by construction, discover a type living anywhere else. It reported green over:
//
//     finance/account:  finance/fund:  finance/settings          app/stew-finance.jsx
//     trinityone/manna-  (a stem for 7 sub-types)                src/steward-manna.src.js
//     trinityone/highlights bookmarks notes journal prayer settings   src/mydata.src.js
//
// The MyData six are the ones that sting: they publish to every relay in the pool, and their anonymous
// readability WAS SECURITY-AUDIT-2026-07-20 C1 — "an anonymous REQ for #d=trinityone/highlights returned a
// list of every member pubkey" plus the verses each had marked. A registry whose entire premise is "the type
// nobody thought about is where the next leak comes from" had never heard of the six that proved it.
//
// The scan is now a glob over src/ and app/, so a new file is covered the day it lands. Widening it also
// turned up `trinityone/xfer`, which is NOT a document type at all (a QR payload label and a hash
// domain-separator, never published) — recorded as an explicit exception in the test, with its reason.
//
// Columns:
//   write    — who accept() lets write it:  church | leader | steward | member | recipient | mixed
//   read     — who canRead() serves it to:  public | members | church | subject | author | care-team
//   scope    — how the owning church is resolved: suffix (<prefix><churchpub>) | tag (['church',cp]) | author | none
//   gatedBy  — OPTIONAL. The relay rule that covers this type when its NAME never appears in gateway.mjs,
//              because a prefix rule or a general one catches it. The test greps gateway.mjs for this exact
//              string, so a stale or invented claim fails rather than quietly excusing the type.
// These describe what the relay ALREADY does — they were read out of accept()/canRead(), not invented here.

export const DOC_TYPES = Object.freeze({
  // ── the church's own content: church key or a rostered steward writes, members read ──────────────────
  'trinityone/group:':        { write: 'steward',   read: 'members', scope: 'tag',    note: 'a group; invite-only ones gate reads by membership' },
  'trinityone/category:':     { write: 'steward',   read: 'members', scope: 'tag',    note: 'named container for groups' },
  'trinityone/event:':        { write: 'mixed',     read: 'members', scope: 'tag',    note: 'church/steward, or a group leader the church empowered' },
  'trinityone/plan:':         { write: 'steward',   read: 'members', scope: 'tag' },
  'trinityone/devotional:':   { write: 'steward',   read: 'members', scope: 'tag' },
  'trinityone/rota:':         { write: 'steward',   read: 'members', scope: 'tag',    note: 'narrowed to the serving teams / stewards when rota-settings says so' },
  'trinityone/rota-settings': { write: 'steward',   read: 'members', scope: 'author', note: 'who may FETCH rota:/runsheet: — church-signed {visibility}' },
  'trinityone/roster:':       { write: 'steward',   read: 'members', scope: 'tag' },
  'trinityone/service:':      { write: 'steward',   read: 'members', scope: 'tag' },
  'trinityone/request:':      { write: 'steward',   read: 'members', scope: 'tag' },
  'trinityone/runsheet:':     { write: 'steward',   read: 'members', scope: 'tag' },
  'trinityone/room:':         { write: 'steward',   read: 'members', scope: 'tag' },
  'trinityone/booking:':      { write: 'steward',   read: 'members', scope: 'tag' },
  'trinityone/pin:':          { write: 'mixed',     read: 'members', scope: 'tag',    note: 'pinned message in a group' },
  'trinityone/hidden:':       { write: 'mixed',     read: 'members', scope: 'tag',    note: 'moderation: a removed message' },
  'trinityone/pinsermon:':    { write: 'steward',   read: 'members', scope: 'suffix' },
  'trinityone/fund:':         { write: 'leader',    read: 'members', scope: 'tag' },
  'trinityone/relays':        { write: 'church',    read: 'members', scope: 'author', note: 'the church\'s trusted-relay list' },
  'trinityone/network:':      { write: 'church',    read: 'members', scope: 'author', note: 'the church declares it joined a network' },

  // ── membership and joining ───────────────────────────────────────────────────────────────────────────
  'trinityone/member:':       { write: 'member',    read: 'members', scope: 'suffix', note: 'a member\'s own join document' },
  'trinityone/joinpolicy:':   { write: 'steward',   read: 'public',  scope: 'suffix', note: 'THE ONE PUBLIC DOC — a not-yet-member must read it before joining' },
  'trinityone/admitted:':     { write: 'steward',   read: 'members', scope: 'suffix' },
  'trinityone/blocked:':      { write: 'leader',    read: 'members', scope: 'suffix', note: 'owner-only: banning is not delegated' },
  'trinityone/stewards:':     { write: 'church',    read: 'members', scope: 'suffix', note: 'owner-only — this is what grants steward authority' },
  'trinityone/stewardreq:':   { write: 'member',    read: 'members', scope: 'tag',    note: 'capped: anti-flood' },
  'trinityone/reseat:':       { write: 'steward',   read: 'members', scope: 'suffix', note: 'moves a member\'s seat onto a new key' },

  // ── identity: names sealed to the congregation ───────────────────────────────────────────────────────
  'trinityone/namekey:':      { write: 'steward',   read: 'members', scope: 'suffix', note: 'the congregation name key, wrapped per member' },
  'trinityone/name:':         { write: 'member',    read: 'members', scope: 'suffix', note: 'a member\'s own name, sealed' },

  // ── safeguarding. The most sensitive rules in the product ────────────────────────────────────────────
  'trinityone/minors:':       { write: 'church',    read: 'church',  scope: 'suffix', note: 'OWNER-ONLY write, NOT served to ordinary members' },
  'trinityone/approved:':     { write: 'church',    read: 'members', scope: 'suffix', note: 'cleared adults — a child\'s app needs this to know who is safe' },
  'trinityone/guardians:':    { write: 'church',    read: 'church',  scope: 'suffix', note: 'child->parents map, NOT served to ordinary members' },
  'trinityone/guardreq:':     { write: 'member',    read: 'members', scope: 'tag',    note: 'the AUTHOR is the claimed parent — never trust a parent field' },
  'trinityone/guardnotice:':  { write: 'church',    read: 'subject', scope: 'tag' },
  'trinityone/clearance:':    { write: 'steward',   read: 'subject', scope: 'tag',    note: 'sealed to the member: tells them only about themselves' },
  'trinityone/nophoto:':      { write: 'steward',   read: 'members', scope: 'suffix', note: 'photo suppression — see scripts/trinity-rules.mjs' },

  // ── care / meal trains ───────────────────────────────────────────────────────────────────────────────
  'trinityone/meals-settings': { write: 'steward',  read: 'members', scope: 'author' },
  'trinityone/care:':         { write: 'mixed',     read: 'members', scope: 'tag',    note: 'church/steward/care-admin, or any member when openedBy=member' },
  'trinityone/careslot:':     { write: 'member',    read: 'members', scope: 'tag' },
  'trinityone/careskip:':     { write: 'recipient', read: 'members', scope: 'tag',    note: 'RECIPIENT-only, enforced by a sealed token' },
  'trinityone/careavail:':    { write: 'member',    read: 'members', scope: 'suffix', note: 'non-minors only' },
  'trinityone/carekey:':      { write: 'steward',   read: 'members', scope: 'suffix' },
  'trinityone/careteam:':     { write: 'steward',   read: 'members', scope: 'suffix' },
  'trinityone/carereq:':      { write: 'member',    read: 'care-team', scope: 'tag',  note: 'a private ask for help — care team only, never the whole church' },
  'trinityone/carereqstatus:': { write: 'steward',  read: 'care-team', scope: 'tag' },
  'trinityone/carechat:':     { write: 'member',    read: 'care-team', scope: 'tag' },

  // ── emergency roll-call ──────────────────────────────────────────────────────────────────────────────
  'trinityone/safetycheck:':  { write: 'steward',   read: 'members', scope: 'suffix' },
  'trinityone/safe:':         { write: 'member',    read: 'subject', scope: 'suffix', note: 'encrypted to the check\'s creator' },

  // ── member replies to church content ─────────────────────────────────────────────────────────────────
  'trinityone/rsvp:':         { write: 'member',    read: 'members', scope: 'tag' },
  'trinityone/reqreply:':     { write: 'member',    read: 'members', scope: 'tag' },
  'trinityone/unavail:':      { write: 'member',    read: 'members', scope: 'suffix' },

  // ── money ────────────────────────────────────────────────────────────────────────────────────────────
  'trinityone/mediakey:':     { write: 'steward',   read: 'members', scope: 'suffix', note: 'its key set IS the member roster — gated accordingly' },
  'finance/journal:':         { write: 'steward',   read: 'church',  scope: 'tag',    note: 'append-only, single-writer, relay is the ordering authority' },
  // ARCHITECTURE-AUDIT-2026-07-30 A6. The other three finance docs, from app/stew-finance.jsx — a file the
  // old extraction never read. gateway.mjs gates them explicitly and generically:
  //     if (d.startsWith('finance/')) { const cp = finCp(e); return !!cp && (e.pubkey === cp || stewardOf(e.pubkey, cp)); }
  // so the same church-or-rostered-steward rule as the journal, without the seq ordering.
  'finance/account:':         { write: 'steward',   read: 'church',  scope: 'author', gatedBy: "d.startsWith('finance/')", note: 'chart of accounts; church-encrypted, relay sees ciphertext' },
  'finance/fund:':            { write: 'steward',   read: 'church',  scope: 'author', gatedBy: "d.startsWith('finance/')", note: 'fund accounting bucket — NOT trinityone/fund:, which is a giving destination and owner-only' },
  'finance/settings':         { write: 'steward',   read: 'church',  scope: 'author', gatedBy: "d.startsWith('finance/')", note: 'finance module settings' },

  // ── a member's OWN data (MyData) ──────────────────────────────────────────────────────────────────────
  // A6, and the ten-missing-types finding is really about these six. They are published by src/mydata.src.js
  // to EVERY relay in the pool — signed with the member's own key, NIP-44 sealed to themselves, and carrying
  // NO church tag of any kind (`tags: [['d', SYNC[key].d]]`, nothing else).
  //
  // That last detail is what decides the read policy: with no church to resolve, the only rule in canRead
  // that can serve them is "your own event is always readable by you", and everything else falls to
  // default-DENY. The gate names them in its own comment for exactly this reason.
  //
  // THESE ARE THE TYPES WHOSE EXPOSURE WAS SECURITY-AUDIT-2026-07-20 C1: they used to publish priv:false —
  // signed, timestamped, PLAINTEXT — and an anonymous REQ for `#d=trinityone/highlights` returned a list of
  // every member pubkey with the verses each had marked. `settings` compounded it by carrying plansFollowed,
  // which binds a pubkey to a specific congregation. Both halves of that fix (encrypt here, default-deny at
  // the relay) are in place; declaring them is the third half — so the next person to touch this cannot
  // reintroduce it without something going red.
  'trinityone/highlights':    { write: 'member',    read: 'author',  scope: 'none', gatedBy: 'authed === e.pubkey',   note: 'C1: was world-readable — a congregation-wide arrest list. Now NIP-44 self-sealed + default-deny' },
  'trinityone/bookmarks':     { write: 'member',    read: 'author',  scope: 'none', gatedBy: 'authed === e.pubkey' },
  'trinityone/notes':         { write: 'member',    read: 'author',  scope: 'none', gatedBy: 'authed === e.pubkey' },
  'trinityone/journal':       { write: 'member',    read: 'author',  scope: 'none', gatedBy: 'authed === e.pubkey',   note: 'not finance/journal: — a member\'s private journal, unrelated' },
  'trinityone/prayer':        { write: 'member',    read: 'author',  scope: 'none', gatedBy: 'authed === e.pubkey' },
  'trinityone/settings':      { write: 'member',    read: 'author',  scope: 'none', gatedBy: 'authed === e.pubkey',   note: 'C1: carried plansFollowed, which binds a pubkey to a specific congregation' },
  // F17, 2026-07-30. Which messages this member has already read: {groupSlug: unixSeconds}. Added so the marks
  // survive a locked-boot wipe — they are deleted from the device on lock (the slugs name the church's groups)
  // and restored from here on unlock. Same shape and policy as the five above: member writes, author-only
  // reads, no church tag, NIP-44 sealed to themselves. It names GROUPS, so it is the most church-revealing of
  // the MyData set — author-only is doing real work here, not just tidiness.
  'trinityone/chatseen':      { write: 'member',    read: 'author',  scope: 'none', gatedBy: 'authed === e.pubkey',   note: 'F17: unread marks, keyed by group slug — restored after a locked-boot wipe' },
});

// Types the CLIENTS use that the relay has no explicit rule for. They fall through to generic rules, which
// were measured on 2026-07-29 and are acceptable — but nobody chose them, and that is the point of listing
// them here. Anything ADDED to this list is a decision someone has to make on purpose.
export const UNDECLARED = Object.freeze({
  'trinityone/groupkey:':  'church-authored key envelope, wrapped per member; member-readable is correct — each member can only unwrap their own copy',
  'trinityone/sermon:':    'church content for members; generic church rule is right, but undeclared',
  'trinityone/checkin:':   'church-authored and self-encrypted to the church key, so members see ciphertext; the EXISTENCE of check-ins is visible to members',
  'trinityone/msgtags':    'steward-defined chat tag labels; church-wide and not sensitive',
  'trinityone/backup-meta:': 'church-authored, CLEARTEXT {at, remind} — when the church last exported its data and how often it is reminded. Member-readable under the generic rule. Harmless in itself, but it does tell any member how long the church has gone without a backup',
  'trinityone/wallet:':    'MEMBER-authored with no church tag, so canRead falls to author-only — verified: another member of the same church cannot read it',
  // ARCHITECTURE-AUDIT-2026-07-30 A6. A PREFIX, not one type: src/steward-manna.src.js builds seven d-tags
  // from it (settings, fund:, request:, vouch:, approval:, record:, testimony:) by concatenation, so none of
  // them ever appears as a whole literal and the extraction can only ever see the stem. All seven go out
  // through window.Steward.encPublish — signed with the CHURCH key and self-encrypted to it, so the relay
  // stores ciphertext — and gateway.mjs has no `manna-` rule at all, so they land on the generic
  // church-authored-content path. Same shape as sermon:/checkin: above: acceptable, but nobody chose it.
  // Note the module is not in the pilot, so this is declared before it can bite rather than after.
  'trinityone/manna-':     'benevolence module (7 sub-types built from this stem). Church-authored, self-encrypted; no explicit relay rule — inherits the generic church-content path',
});

// ── THE NAMES THE RELAY GATES BY. ARCHITECTURE-AUDIT-2026-07-30, rec 2's deferred second half ────────────
// scripts/gateway.mjs used to define all 50 of these itself, as its own `const GROUP_D = 'trinityone/group:'`
// literals. That is the defect rec 2 was written about: a typo there is not a build error — it is a document
// the relay gates under one name while a client publishes under another, and NOTHING FAILS LOUDLY.
//
// The spine now takes its vocabulary from here, through k(), which refuses anything this file has not
// declared. A mistyped or undeclared name is now a THROW AT RELAY STARTUP, before it serves a request.
//
// WHAT THIS DELIBERATELY IS NOT: accept()/canRead() keep their own rules. The write/read/scope columns above
// are a SUMMARY — the real rules carry dozens of special cases (single-writer seq on the finance journal,
// cross-church group binding, recipient-only care skips, the guardreq content-vs-signer check). Deriving
// authorization from a summary would mean rewriting the security spine out of a simplification: a far larger
// and more dangerous change than the one this fixes. NAMES here; POLICY there.
//
// The strings appear twice — once as a DOC_TYPES key, once here — and k() is what makes that safe: the second
// occurrence is CHECKED against the first at module load. Building DOC_TYPES out of these constants would
// remove the duplication, but it means rewriting 61 keys where any slip silently changes a live d-tag.
// Checked duplication now; single-occurrence is a later tidy-up that deserves its own test.
const k = (s) => {
  if (!(s in DOC_TYPES) && !(s in UNDECLARED)) {
    throw new Error('trinity-doc-types: "' + s + '" is not a declared document type. Declare it here — with who '
      + 'may write it, who may read it and how its owning church resolves — before the relay gates by it.');
  }
  return s;
};

export const D = Object.freeze({
  GROUP:          k('trinityone/group:'),
  FUND:           k('trinityone/fund:'),
  MEMBER:         k('trinityone/member:'),
  PLAN:           k('trinityone/plan:'),
  DEVO:           k('trinityone/devotional:'),
  ROTA:           k('trinityone/rota:'),
  CATEGORY:       k('trinityone/category:'),
  ROSTER:         k('trinityone/roster:'),
  SERVICE:        k('trinityone/service:'),
  EVENT:          k('trinityone/event:'),
  REQUEST:        k('trinityone/request:'),
  FIN_JOURNAL:    k('finance/journal:'),
  ROOM:           k('trinityone/room:'),
  BOOKING:        k('trinityone/booking:'),
  RUNSHEET:       k('trinityone/runsheet:'),
  RELAYS:         k('trinityone/relays'),
  NETWORK:        k('trinityone/network:'),
  BLOCKED:        k('trinityone/blocked:'),
  PIN:            k('trinityone/pin:'),
  PINSERMON:      k('trinityone/pinsermon:'),
  HIDE:           k('trinityone/hidden:'),
  MINORS:         k('trinityone/minors:'),
  APPROVED:       k('trinityone/approved:'),
  CLEARANCE:      k('trinityone/clearance:'),
  GUARDIANS:      k('trinityone/guardians:'),
  GUARDNOTICE:    k('trinityone/guardnotice:'),
  RSVP:           k('trinityone/rsvp:'),
  REQREPLY:       k('trinityone/reqreply:'),
  UNAVAIL:        k('trinityone/unavail:'),
  NAMEKEY:        k('trinityone/namekey:'),
  NAME:           k('trinityone/name:'),
  CAREKEY:        k('trinityone/carekey:'),
  GUARDREQ:       k('trinityone/guardreq:'),
  NOPHOTO:        k('trinityone/nophoto:'),
  MEDIAKEY:       k('trinityone/mediakey:'),
  JOINPOLICY:     k('trinityone/joinpolicy:'),
  ADMITTED:       k('trinityone/admitted:'),
  RESEAT:         k('trinityone/reseat:'),
  STEWARDS:       k('trinityone/stewards:'),
  STEWARDREQ:     k('trinityone/stewardreq:'),
  MEALS_SETTINGS: k('trinityone/meals-settings'),
  ROTA_SETTINGS:  k('trinityone/rota-settings'),
  NEED:           k('trinityone/care:'),
  SLOT:           k('trinityone/careslot:'),
  SKIP:           k('trinityone/careskip:'),
  AVAIL:          k('trinityone/careavail:'),
  CAREREQ:        k('trinityone/carereq:'),
  CARETEAM:       k('trinityone/careteam:'),
  CAREREQSTATUS:  k('trinityone/carereqstatus:'),
  CARECHAT:       k('trinityone/carechat:'),
  SAFE:            k('trinityone/safe:'),
  SAFETY:         k('trinityone/safetycheck:'),
});

export const ALL_PREFIXES = Object.freeze([...Object.keys(DOC_TYPES), ...Object.keys(UNDECLARED)]);

// Look a d-tag up. Returns the declaration, or null for an unknown type — which is the answer that should
// make a caller stop and think rather than guess.
export function describe(dtag) {
  const d = String(dtag || '');
  for (const p of Object.keys(DOC_TYPES)) if (d === p || d.startsWith(p)) return { prefix: p, declared: true, ...DOC_TYPES[p] };
  for (const p of Object.keys(UNDECLARED)) if (d === p || d.startsWith(p)) return { prefix: p, declared: false, note: UNDECLARED[p] };
  return null;
}
