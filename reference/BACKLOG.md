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
- **BUG — care-team membership has two out-of-sync sources (likely root of the whole visibility saga).**
  The care-team "Members" button (`EditGroupMembersModal`) writes the GROUP's `members` via `publishGroup`.
  But "on the care team" for BOTH the relay (`careAdmin` → `ROSTER_PEOPLE`) AND the member CareCard
  (`onCareRoster` → `ctx.churchRosters`) is the ROSTER (`publishRoster` people), NOT the group members. So
  anyone added via that "Members" button never counts for "Only the care team" visibility or who-can-open-a-
  need → team-visibility silently hides needs from everyone. FIX: pick ONE source and make all three agree.
  The ROSTER is the only member-readable one (an invite-only group's members aren't served to non-members),
  so route care-team membership through the roster — when editing the care-admin group's members, also
  `publishRoster` those people (or have the care-team "Members" flow edit the roster directly). Then
  onCareRoster + careAdmin + the steward UI all read roster.people. (diagnosed 2026-06-27)
- ✅ DONE (2026-06-27): safe warning when visibility = "Only the care team" but NO care team is selected.

## Relay
- **Per-church ephemeral fairness.** Smart eviction (shipped) protects ALL structured data globally, but the
  ephemeral (chat/DM) budget is SHARED. On a shared relay, a chatty church can age out a quiet church's older
  chat sooner. Fix: track + cap ephemeral PER church so one can't evict another's. Best done on top of the DB
  move below. Moderate–high effort.
- **Shared/network relay scaling → real DB.** Events live in one in-memory JSON array (capped, persisted to a
  JSON file). Fine for one church or a handful; doesn't scale to many (memory + whole-file load/save + no
  per-church queries). For a genuine public/multi-church relay: move to an embedded DB (SQLite or LMDB) with
  per-church partitioning, indexed queries, and retention-by-kind. Unlocks per-church fairness above + real
  scale. Higher effort (a migration). NOTE: the relay is GATED (accept() only takes registered churches'
  member/church content — not an open public Nostr relay), so this is about scale, not spam.

## Sharing
- **Multi-verse select.** Share is one verse at a time; let a member select several (a range or multi-pick) and
  share them together as one message/image. Moderate effort (verse-share UI + composing the multi-verse payload).

## Shipped this session (for the record)
- Off-grid APK + Bible share; full care/meals flow (additive day picker, dietary, both-level meal types
  B/L/D + per-day override, steward skip, "what I'm bringing" note); relay care-read fix (members see each
  other's help + notes); release signing (stable key); auto-update banner one-shot fix; approval-toast loop
  fix; smart relay eviction; care-card cache hydration. (through 0.9.9 / 97)
