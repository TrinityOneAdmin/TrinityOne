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
