# Backlog — noted for later

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
- **Filter Groups / Teams / Rooms.** The "Groups, teams & rooms" screen shows all three types in one combined
  list. As a church accrues groups, give it a filter or tab bar (All / Groups / Teams / Rooms). Low effort —
  each item already carries a `kind`, so it's a client-side filter on the existing list.
- **Roster: block duplicate people.** A team roster ("PEOPLE WHO CAN SERVE") currently lets you add the same
  linked member twice (seen: Luke Lexar ×2). Dedupe by linked pubkey — skip/disable adding someone already on
  the roster, and de-dupe on save. Low effort.

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
- ✅ DONE (2026-06-27, branch `claude/relay-sqlite`): **DB migration → node:sqlite.** Events now live in
  SQLite (`event-store.mjs`), not an in-memory JSON array: REQ reads are indexed SQL queries narrowed by
  kind/author/created_at/church/d-tag with the canonical `matchFilter` applied for exactness; writes go
  through the store (replaceable dedup + smart retention in SQL); a `church` column partitions per-church;
  one-time auto-migration from `relay-db.json`. No native dependency (built-in node:sqlite, Node 22+).
  Tested: 20/20 correctness vs the old full-scan, boot+migrate, and a WS round-trip smoke. NOT yet merged
  — review + deploy when ready (see the branch handoff).
- ✅ DONE (2026-06-27, branch `claude/relay-sqlite`): **Per-church ephemeral fairness.** Retention is now
  per-church: each church (incl. a `''` shared bucket) keeps only its newest `maxEvents` EPHEMERAL events;
  structured docs never culled — so a chatty church can't age out a quiet one's chat. `maxEvents`
  (`RELAY_MAX_EVENTS`) is now the PER-CHURCH ephemeral budget. The gateway resolves each event's church
  (church tag → group's owning church via `GROUP_CHURCH` → member's church via `MEMBER_CHURCH` → `''`),
  with a startup `reattribute()` pass that buckets migrated/unattributed events. Tested (church A flood
  doesn't evict church B; reattribute backfill).
- **Tag-index table for extreme single-pool scale.** Arbitrary `#tags` (e.g. `#p` DMs, `#e`) are matched in
  JS on the SQL-narrowed result — correct + cheap when queries narrow by kind/author/church (they do today).
  A `tags(event_id, tag, value)` index would make tag-only queries scale on one giant shared pool. Not needed
  until a single relay serves very many churches.

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
