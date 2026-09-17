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
  'trinityone/relay-net':     { write: 'church',    read: 'public',  scope: 'author', note: 'closed-network plan C3 — the church\'s own statement of WHICH RELAY BOXES ARE ITS NETWORK, as [{pubkey, alwaysOn, url?}]. NOT trinityone/relays, which means "cross-relay sync is on": syncEnable refuses to write that below two boxes (so a single-relay church could never author its own membership) and syncDisable writes [] to it (which would un-admit a church\'s own relay as a side effect of turning mirroring off). Add, never repurpose. The client matches on PUBKEY ONLY — `url` is an advisory hint about where the box was last seen, because a tunnelled relay changes address on every restart. READ IS PUBLIC (C4): under the client gate a phone will not publish anywhere until it has read this, so a newcomer who has scanned an invite must be able to read it BEFORE joining — the same reason joinpolicy: is public. It carries relay pubkeys and nothing about any person, and kind-10002 already publishes the same church\'s relay addresses to anyone' },
  'trinityone/network:':      { write: 'church',    read: 'members', scope: 'author', note: 'the church declares it joined a network' },

  // ── membership and joining ───────────────────────────────────────────────────────────────────────────
  'trinityone/member:':       { write: 'member',    read: 'members', scope: 'suffix', note: 'a member\'s own join document' },
  'trinityone/joinpolicy:':   { write: 'steward',   read: 'public',  scope: 'suffix', note: 'THE ONE PUBLIC DOC — a not-yet-member must read it before joining' },
  'trinityone/admitted:':     { write: 'steward',   read: 'members', scope: 'suffix' },
  'trinityone/blocked:':      { write: 'leader',    read: 'members', scope: 'suffix', note: 'owner-only: banning is not delegated' },
  'trinityone/voice:':        { write: 'church',    read: 'members', scope: 'suffix', note: 'who signs what the church sends — a display by-line only. Church-signed so it cannot be forged; readable by members because it is what they see under a notice. Deliberately NOT part of the steward roster: a name is cosmetic, a roster is authority, and a bug in one must never damage the other.' },
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
  'trinityone/careavail:':    { write: 'member',    read: 'members', scope: 'suffix', note: 'non-minors only, on BOTH sides: a minor may not write one, and one written before they were marked is no longer served to ordinary members \u2014 only to the author, the church, its network, its stewards and care admins' },
  'trinityone/carekey:':      { write: 'steward',   read: 'members', scope: 'suffix' },
  'trinityone/financekey:':   { write: 'church',    read: 'members', scope: 'suffix', note: 'owner-only mint — the church books\u2019 key, wrapped to the church and to every steward holding the finance capability' },
  'trinityone/checkinkey:':   { write: 'church',    read: 'members', scope: 'suffix', note: 'owner-only mint — the children\u2019s register key, wrapped to the church and to every steward holding the SAFEGUARDING capability. Separate from financekey: deliberately: until 2026-08-20 both the register and the ledger were sealed with one key derived from the church secret, so granting a treasurer Finance handed them every child\u2019s name, room and pickup code' },
  'trinityone/checkin:':      { write: 'mixed',     read: 'church',  scope: 'tag',    note: 'one child\u2019s presence at one session, sealed under the SAFEGUARDING key. Church or a steward holding safeguarding; NOT the member catch-all — these are addressable, so an ordinary member could otherwise overwrite a child\u2019s presence record with anything and it would vanish from the register. READ WAS \'members\' UNTIL 2026-09-09 \u2014 every member of the church received the ciphertext, and this registry said so outright. The check-in helper capability made that indefensible: a helper key is scoped to one session, and a register whose ciphertext the whole congregation already holds cannot be re-scoped by any gate afterwards. The set is now the church, its network, a steward the church EXPLICITLY ticked for safeguarding (stewardCanExplicitly — an unscoped steward is refused, owner 2026-09-12: they were never given the register key, so all they ever received was the cleartext tags), an IN-WINDOW HELPER of the session named in the record\u2019s [\'session\'] tag, the guardian the record names in a [\'p\'] tag, and \u2014 for an older young person who has an account \u2014 a guardian of that person in the church\u2019s own guardians: map (guardianOfIn, one-directional, with minorOf as a second refusal). WRITE gained that same helper. The column says \'church\' because there is no value for this set and \'members\' would now be a lie; the honest list is the sentence above. \u26a0 THIS SENTENCE WAS TRUE OF THE DESIGN AND FALSE OF THE CODE UNTIL 2026-09-11: canRead short-circuited on stewardCan(\u2026,\'any\') || careAdmin(\u2026) BEFORE reaching the check-in branch, so a Finance-only treasurer, a Groups-&-rotas volunteer and every care admin were served every record. Sealed, but [\'p\'] and [\'session\'] are cleartext and roster: turns a pubkey into a name \u2014 \u201cthis named parent had a child at church on this date\u201d, with no key. REACH, measured rather than waved at: publishCheckin wrote no [‘p’] and no [‘session’] tag until 2026-09-09, and a record naming no parent supports no inference about one — so this reaches every record written SINCE that date, not the whole history. Fixed by deciding the check-in documents BEFORE that short-circuit; see checkinReader() in scripts/gateway.mjs' },
  // \u2500\u2500 THE CHECK-IN HELPER CAPABILITY, 2026-09-09 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'trinityone/checkinhelper:': { write: 'church',  read: 'church',  scope: 'author', note: 'ONE SESSION’S key, wrapped to whoever the church’s PERMISSIONS admit — d=checkinhelper:<serviceId>. RESTRUCTURED 2026-09-09 (reference/FINDING-CHECKIN-GRANTS-SHOULD-BE-PER-PERSON-2026-09-09.md): this document used to be the whole feature — it said WHO was cleared as well as carrying the key — which made clearance structurally per-service, and churches clear volunteers annually and church-wide. It is now the KEY HALF only. “Is this person cleared” moved to trinityone/checkinperm:<personPub>, and the relay requires BOTH: the envelope must name the pubkey AND a live permission must cover it, so revoking one permission ends every session at once instead of one document per Sunday. OWNER-ONLY mint, unchanged and for the unchanged reason: whoever writes this decides who may read a child’s pickup code, and a safeguarding steward being able to hand that to a third party is an escalation they do not have today. CLEARTEXT and deliberately so — {session, source, lifetime, from, until, pubs:[…], keys:{<pub>:wrapped}} — because the relay has to read the window and the pubkey list it is being asked to enforce, exactly as it reads rota-settings and roster:’s cleartext pubs. It names NO child and carries no child data. `source` IS NOW PINNED TO THE LITERAL ‘permission’ and every other value is refused: an envelope is issued from the church’s permissions and from nothing else, so a console that tried to mint the pre-restructure rota-derived shape is refused rather than quietly honoured. `lifetime` is session or day and NEVER open — the open-ended shape moved to the permission, because session keys are now issued WITHOUT A STEWARD ACTING and an open-ended one would be a standing key to the children’s register minted by machinery nobody watched. No key this product can mint outlives 26 hours. The WINDOW is enforced against the relay’s OWN clock, never the event’s created_at, and the cap travels with the declared lifetime. NOT MEMBER-READABLE, and the column said ‘members’ until 2026-09-09 because it was copied from the other key envelopes without asking what THIS one carries. Measured on a live gateway: an ordinary member correctly refused `rota:` under `rota-settings` visibility ‘stewards’ was still served this document, whose cleartext `pubs` array names everyone doing children’s work that morning — silently reversing the decision the church had just made. The honest read set is the church, its network, a steward EXPLICITLY ticked for SAFEGUARDING, and A PUBKEY THE GRANT ITSELF NAMES (who may not be a member of the congregation at all). NARROWED 2026-09-11 from “any steward, a care admin”: that grant was decided at a short-circuit running before this document’s own rule, and the cleartext `pubs` array names everyone rostered to children’s work that morning — which is the children’s-work half of exactly what a church narrowing its rota visibility said the congregation does not get to see. The envelope stays safe to hand a named helper for the usual reason — each recipient can only unwrap their own slot and the relay never sees the session key. A NAMED HELPER’S READ IS NOW TIME-BOUNDED TOO: from `until` back to `from - KEY_LEAD_SECONDS` (a fortnight), so a phone belonging to somebody cleared for the year cannot hoover up every envelope a console ran ahead and minted. Early fetch is still how a Sunday starts; a year’s worth in one REQ is what the owner paid machinery to prevent.' },
  'trinityone/checkinperm:': { write: 'church',   read: 'church',  scope: 'author', note: 'A PERSON IS CLEARED FOR CHILDREN’S CHECK-IN — d=checkinperm:<personPub>, new 2026-09-09. The owner’s DECIDED block in reference/FINDING-CHECKIN-GRANTS-SHOULD-BE-PER-PERSON-2026-09-09.md: “a permission says a person is cleared, is scoped to the person, and lasts until the church ends it — this is what a steward grants, once, matching the annual clearance the church already does”. It is an AUTHORISATION AND CARRIES NO KEY: {person, source, lifetime, from, until|null} and nothing else. That absence is deliberate and is the design the owner chose over the simpler one — a person-scoped document wrapping a longer-lived register key would have meant a lost phone exposed the whole year’s register instead of one Sunday. If anybody adds a `keys` object here, that is the collapse back to the rejected design. `person` is repeated inside the body and the relay refuses a document whose d-tag and body disagree, exactly as it does for the grant’s `session`. `source` records which question said so — rota, team, or a steward naming them by hand — and may NOT be ‘permission’, which would be circular. `lifetime` is day / dated / open, the church’s choice with the tightest as default, and the cap travels in the signed record (400 days for a dated clearance; only ‘open’ may omit an end, and revocation is then the ONLY thing that ends it). OWNER-ONLY mint, for the same reason checkinhelper: and checkinkey: are: whoever decides who may read the children’s register must be the key holder, not a delegate. NOT MEMBER-READABLE — it names the church’s cleared safeguarding team, which is precisely what a church narrowing its rota visibility said the congregation does not get to see. Read by the church, its network, a steward EXPLICITLY ticked for SAFEGUARDING, and THE PERSON IT NAMES (who already knows), and nobody else. NARROWED 2026-09-11 from “any steward, a care admin”, for the reason this line already gives one sentence up: the document IS the church’s cleared safeguarding team, one person at a time, so the people who may read it are the people who hold that job. Nothing here blocks a child being checked in: the church key and every safeguarding steward write the register with no permission at all, which is reference/DOMAIN.md’s rule that this feature supports a safeguarded church and does not enforce safeguarding.' },
  // ── A PARENT SAYS “WE ARE HERE”, 2026-09-11 ─ STEP 1 of reference/DESIGN-CHECKIN-IN-THE-MEMBER-APP-2026-09-09.md §3 ───────
  'trinityone/checkinarrival:': { write: 'member', read: 'church', scope: 'tag', note: 'AN ARRIVAL, NOT A REGISTER ROW — d=checkinarrival:<sessionId>:<authorpubhex>, authored by the PARENT, cleartext [‘session’,sid] + [‘church’,cp], content self-sealed and empty of meaning. IT EXISTS BECAUSE A PARENT MUST NEVER AUTHOR A trinityone/checkin: RECORD. In the normal case the child has no account at all (design §7, the owner: “most children getting checked in will not have a phone”), so nothing at the relay links a parent to a child — guardianOfIn is keyed on the CHILD’s pubkey and guardians: is owner-only. A parent-authored register row would therefore reduce to “any member may invent a child and a pickup code”, which is the hole F-B (90c4bf5) closed. So the parent writes THIS, and the WORKER’s phone — which holds the session key and belongs to a cleared person — turns it into the register row through the already-audited writeCheckin. Forging an arrival buys a spurious line on a worker’s screen, the same data-quality nuisance the printed room code already knowingly accepts; forging a register row buys a child. IT CARRIES NO KEY MATERIAL AND NO CHILD’S NAME: its only job is to deliver the parent’s pubkey provably, which a signature already does. WRITE is split in two halves exactly as carereq: is: a STATELESS half (the d-tag’s author suffix must equal the event’s pubkey) applied at the websocket door AND at all three ingest sites, and a WINDOW half (the named session has a live envelope and now is within [from - KEY_LEAD_SECONDS, until]) applied at the websocket door ONLY, because it consults a hydrated map and an author-authority check on /import once refused a safeguarding steward’s own archive on restore (9f17160). READ is DEFAULT-DENY with no fall-through to the ordinary member rule: the author’s own, and an in-window helper of the named session. NARROWED 2026-09-11 ABOVE THAT: the church, its network and an EXPLICITLY ticked SAFEGUARDING steward (checkinReader) — it was “its stewards and its care admins”, decided at a privileged short-circuit that ran BEFORE this branch, so a Finance-only treasurer and every care admin were served every arrival. An arrival needs no decryption to give up a household: the parent’s pubkey is in the ADDRESS and the session is a cleartext tag, so it is “this family was at the creche door this morning” read straight off the d-tag.' },
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
  // old extraction never read. gateway.mjs gates them explicitly and generically, on BOTH sides:
  //     accept():   if (d.startsWith('finance/')) { const cp = finCp(e); return !!cp && (e.pubkey === cp || stewardCan(e.pubkey, cp, 'finance')); }
  //     canRead():  if (d.startsWith('finance/')) return authed === cp || networkOf(authed, cp) || stewardCan(authed, cp, 'finance');
  // so the same church-or-finance-steward rule as the journal, without the seq ordering.
  //
  // ⚠ `read: 'church'` WAS FALSE FOR THESE FOUR TYPES UNTIL 2026-09-16, and the registry existing is how it
  // was found. canRead() had no `finance/` branch at all: the books fell through to the ordinary
  // effective-member rule, and an ordinary member of the church — measured on a live relay — was served
  // every entry, the chart of accounts and the settings. Sealed, so no amount leaked; the d-tag and the
  // created_at are cleartext, so the SHAPE of the books did. The branch above is what made the column true.
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
  'trinityone/groupkey:':  'key envelope for one encrypted room, wrapped per member; member-readable is correct — each member can only unwrap their own copy. NOT always church-authored: a delegated steward with "Groups & rotas" seals rooms too, and from 2026-09-16 their envelope carries a [\'church\'] tag so the congregation can actually find it. THE GAP IS ON THE WRITE SIDE AND IS STILL OPEN: there is no groupkey: rule in accept() at all, so the write survives on the generic "a member may write their own documents" path — MEASURED 2026-09-16 against a live relay, a steward who holds the capability but is NOT ALSO A MEMBER of that church is refused outright ("blocked: not a member or not permitted for this group") and the room they just made is dead. A church that grants a capability to someone outside its congregation is exactly the case this misses. Deliberately not fixed alongside the tag: adding a write rule here changes who may publish a group key, which is a decision, not a repair',
  'trinityone/sermon:':    'church content for members; generic church rule is right, but undeclared',
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
  RELAY_NET:      k('trinityone/relay-net'),
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
  FINANCEKEY:     k('trinityone/financekey:'),
  CHECKINKEY:     k('trinityone/checkinkey:'),
  CHECKIN:        k('trinityone/checkin:'),
  CHECKINHELPER:  k('trinityone/checkinhelper:'),
  CHECKINPERM:    k('trinityone/checkinperm:'),
  CHECKINARRIVAL: k('trinityone/checkinarrival:'),
  GUARDREQ:       k('trinityone/guardreq:'),
  NOPHOTO:        k('trinityone/nophoto:'),
  MEDIAKEY:       k('trinityone/mediakey:'),
  JOINPOLICY:     k('trinityone/joinpolicy:'),
  ADMITTED:       k('trinityone/admitted:'),
  RESEAT:         k('trinityone/reseat:'),
  // Who signs what the church sends — a display by-line, church-signed. Deliberately its OWN document rather
  // than a field on the roster: a name is cosmetic, a roster is authority, and a bug in one must never be able
  // to damage the other.
  VOICE:          k('trinityone/voice:'),
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
