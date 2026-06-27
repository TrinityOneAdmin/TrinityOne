# Backlog — noted for later

## OPEN BUG — Practical care card hidden on member APK when visibility = "whole church"
On the member APK, the Today **Practical care** card shows when visibility = **"Only the care team"**
(and the member is on the team) but NOT when visibility = **"The whole church"** ('all'). This is
backwards vs the code: CareCard only *narrows* `live` on `visibility==='team'`; `'all'` should show
every (future-dated) need unconditionally.
- Confirmed NOT a relay/subscription bug: the **Serving** page on the same APK shows the member's care
  commitments, so `ctx.care.slots` + `ctx.care.needs` ARE populated. Data is reaching the member.
- Web app shows the card fine (likely the steward / on-team identity).
- Leading theory: the member's *received* `s.visibility` isn't actually `'all'` (settings update not
  reaching the member, or stale), OR `live` collapses for another reason with 'all'.
- NEXT STEP: re-cut the debuggable diagnostic build (re-add the `[CareCard-DEBUG]` console.log before
  `if (!live.length) return null` in screens-today.jsx CareCard; set `debuggable true` on the release
  buildType in android/app/build.gradle — both reverted now), connect the phone via `adb` on the dev box
  (USB debugging must be ON + the "Allow USB debugging?" prompt approved — MTP-only descriptor = not
  authorized), then `adb logcat | grep CareCard-DEBUG` to read visibility / needs / live / amCareTeam.
- Footgun also noted: team-visibility + empty care team silently hides all needs — warn the steward +
  auto-add the creating steward to the roster.


## Steward console
- **Filter Groups / Teams / Rooms** — a type filter/tabs on the "Groups, teams & rooms" list
  (it's one combined list today). (2026-06-26)
- **Roster: block duplicate people** — adding the same linked member twice to a team roster should be
  prevented (dedupe by linked pub; the "PEOPLE WHO CAN SERVE" list can currently show the same person
  twice). (2026-06-26)

## Relay
- **Smarter event eviction (not space — correctness).** Relay keeps newest 20k events (`dedupEvents().slice(-MAX_EVENTS)`).
  Risk: an old-but-current addressable doc (profile/roster/care-settings, old `created_at`) gets sliced off once
  chat+DMs exceed 20k newer events → member names/rosters/settings silently vanish. Fix: never evict
  addressable/replaceable kinds (0, 10000-19999, 30000-39999); only cull oldest ephemeral (kind-1 chat, kind-4
  DMs, reactions). Also scale/per-church the 20k cap for a multi-church network. Not urgent at pilot scale. (2026-06-27)
- **Shared/network relay scaling.** The relay is GATED (accept() only takes registered churches' member/church
  content — not an open public Nostr relay, so no internet spam). One-church self-hosted (mini-PC) is naturally
  bounded → 20k fine, preferred default (cheap, private, resilient, no culling). BUT a single relay serving MANY
  churches stacks up: the store is a 20k-entry JSON array in memory — doesn't scale past a handful. Before going
  multi-church on one box: real embedded DB (SQLite/LMDB), per-church partitioning + caps (one busy church can't
  evict another's data), retention by kind. (2026-06-27)

## Sharing
- **Multi-verse select** — select several verses and share them together, not one at a time. (2026-06-26)

## Meal trains — next focused pass
- **Steward skip** — mark a day "covered" from the console need view (relay already accepts steward skips).
- **Meal-type selector — both levels:** per-NEED toggles for Breakfast / Lunch / Dinner that set what the
  whole Care task needs (e.g. turn breakfast off universally), then a per-DAY override so a specific day
  can differ (Tue = dinner only, Thu = lunch + dinner). Data: `need.meals` (default set) + optional
  per-day overrides; a day with no override inherits `need.meals`. Show the meal(s) on each day chip +
  on the member's care card so helpers know what to bring and when.
- **"What I'm bringing" note** — prompt when a helper taps "I'll help" + show it on the day so two
  people don't bring the same dish (the sign-up slot already carries a `note` field to reuse).
