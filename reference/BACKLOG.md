# Backlog — noted for later

(Care-partners roadmap idea moved to `reference/SPINE.md` → Phase 2, beside "Church-adjacent charities".)


## Watch (likely already resolved)
- **Care card hiding / blinking out on the member APK.** Earlier the Today "Practical care" card seemed to
  hide under visibility = "whole church" and vanish/reappear on reload. Both trace to the same root —
  the card was empty until the relay round-tripped (plus general relay lag, same as the team-removal lag).
  The **0.9.9 (97)** cache hydration paints the card from a per-church `lsGet` cache instantly, which should
  fix both. ONLY if it recurs (card empty while needs genuinely exist): re-add the `[CareCard-DEBUG]`
  console.log in `screens-today.jsx` CareCard (just before `if (!live.length) return null`) + set
  `debuggable true` on the release buildType, install, plug phone into the dev box (USB debugging ON +
  "Allow USB debugging?" approved — an MTP-only USB descriptor means it's NOT authorised), then
  `adb logcat | grep CareCard-DEBUG` to read vis / needs / live / onTeam.

## Steward console
- ✅ DONE (2026-06-27): **Filter Groups / Teams / Rooms** — type-filter chips on the list (appear once there's
  more than one type), reorder disabled while filtering.
- ✅ DONE (2026-06-27): **Roster: block duplicate people** — dedupe a linked member by pubkey + an unlinked one
  by name, and hide already-added members from the link dropdown.

## Meal trains
- ✅ DONE (2026-06-27): **care-team membership now flows through the roster** (root of the visibility saga).
  The meals "Members" button opens the same `RosterModal` the Rota page uses (`publishRoster` → roster.people),
  so the steward UI, the relay (`careAdmin`/`ROSTER_PEOPLE`) and the member CareCard (`onCareRoster`) all read
  ONE source. "Only the care team" visibility works now. Settings warn when no team is selected OR the selected
  team's roster is empty.
- **Follow-up (low priority): care-team chat membership.** RosterModal writes roster.people, not the team's
  group.members, so care-team members aren't auto-added to the team's CHAT group. Fine for needs (roster-driven);
  if the care team should also chat together, sync group.members ← roster.people when editing a care team.

## Relay
- ✅ DONE on branch `claude/relay-sqlite` (2026-06-27) — **pending your review + deploy**: **DB migration →
  node:sqlite.** Events now in SQLite (indexed reads, durable, per-church `church` column), auto-migration
  from relay-db.json, no native dependency. Needs Node 22+. Tested (correctness vs old, boot, WS round-trip).
- **Per-church ephemeral fairness.** The retention cull is still GLOBAL (oldest ephemeral across all churches),
  so on a shared relay a chatty church can age out a quiet one's older chat. The new `church` column makes a
  per-church cull straightforward — give each church its own ephemeral budget. Follow-up on the SQLite base.
- **Tag-index table for extreme single-pool scale.** Arbitrary `#tags` (e.g. `#p` DMs, `#e`) are matched in JS
  on the SQL-narrowed result — correct + cheap while queries narrow by kind/author/church (they do today). A
  `tags(event_id, tag, value)` index would make tag-only queries scale on one giant shared pool. Not needed
  until a single relay serves very many churches. NOTE: the relay is GATED (accept() only takes registered
  churches' content — not an open public Nostr relay), so this is about scale, never spam.

## Sharing
- ✅ DONE (2026-06-27): **multi-verse select.** Reader selection is now a set; the verse action sheet has a
  − / + passage stepper (the modal backdrop blocks tapping more verses) that extends a contiguous selection.
  Copy/Share compose the verses into one passage with a compact range ref ("John 3:16-18,20"). Per-verse
  actions (note/bookmark/highlight) hide once more than one is selected.

## Shipped this session (for the record)
- Off-grid APK + Bible share; full care/meals flow (additive day picker, dietary, both-level meal types
  B/L/D + per-day override, steward skip, "what I'm bringing" note); relay care-read fix (members see each
  other's help + notes); release signing (stable key); auto-update banner one-shot fix; approval-toast loop
  fix; smart relay eviction; care-card cache hydration. (through 0.9.9 / 97)

## Verify next session (2026-07-30)
- **Does a correctly-formed pending join appear in the console's Members page?** Left mid-test while the
  owner was away. Church `Test Church 01` has `approval: true`, so a new joiner is held as PENDING until
  admitted. A member doc was published to a8 from a throwaway key with the SAME shape the real app uses
  (`src/fellowship.src.js:1798` — `[['d','trinityone/member:'+cp], ['t',NET], ['p',cp]]`) plus a kind-0 so
  it renders with a name: **"Audit test member"**,
  `npub1g4sr2fa5wyegky6v0ar7yt597shhe6sugsdd93a8runuqapy6fnqf82fqy`.

  **If it shows up:** there is no bug. The earlier "a join popped up then vanished" was two test artefacts
  of mine — one join that published a LEAVE a second later (a deliberate retraction test), and two joins
  that OMITTED the `['p', cp]` tag. The console subscribes with `{kinds:[30078], '#p':[pub]}`
  (`src/steward.src.js:2751`), so those were invisible to it while the relay still stored them and the push
  still fired — which is exactly why it looked like a console fault.

  **If it does NOT show up:** it is real, and this is the correctly-formed case to debug with. Two unverified
  suspects, both only guesses: `subscribeMembers` paints from the `trinityone.steward.members.<pub>`
  localStorage cache and then OVERWRITES that cache with whatever the live subscription emits; and the
  Members page only builds `pendingJoins` when `joinApproval && mRosterLoaded` are both true
  (`app/stew-dashboard.jsx:3348`).

  Already ruled out by measurement: the relay serves a pending member's join doc to the church key
  (reproduced locally with `approval:true`), and a8 retained the join across a reconnect.

  Cleanup: the key for "Audit test member" is kept, so it can be retracted properly. An earlier throwaway
  (`30c9c850…fd9a`) is malformed and therefore invisible to the console — it needs no action.

## P6 — measured and WITHDRAWN (2026-07-31)
- **The console's ~10 "byte-identical" subscriptions are not on the wire.** The audit priced them at 2,500ms
  and 3,428 KB. Measured in a real browser against a real relay, ten screens each calling a different
  `subscribe*` that uses the union: **main opened 2 REQs, the deduplicated branch opened 2 REQs.** Identical.
  All ten were verified to actually subscribe. nostr-tools' SimplePool already merges identical filter sets.

  The 17 duplicated call sites in `src/steward.src.js` are real, and `app/steward-root.jsx:68` still names
  porting `_docsHub` as the deeper fix — but the COST attributed to them was not reproducible, so there is
  nothing to buy back. Do not re-open this on the strength of the source duplication alone; measure first.

  A working, sabotage-verified implementation sits unmerged on `perf/console-shared-docs` (ten tests, aimed at
  the dangerous half: a screen that mounts late must still receive everything). Ready if the console ever
  moves off SimplePool.

- **Two things worth keeping from that branch if it is ever revived:**
  - `_resetSharedSubs()` must be wired into `setKey()` and `removeKey()`. The registry is keyed by filter and
    every filter names the church pubkey, so a church switch otherwise hands the next screen a dead stream —
    the member app's "Retry button does nothing" bug (AUDIT 2026-07-25).
  - A REQ count taken from a console that never mounts its screens measures nothing: those subscriptions open
    when their screens do. My first measurement did exactly that and showed no difference for the wrong reason.
