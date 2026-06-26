# Backlog — noted for later

## Steward console
- **Filter Groups / Teams / Rooms** — a type filter/tabs on the "Groups, teams & rooms" list
  (it's one combined list today). (2026-06-26)
- **Roster: block duplicate people** — adding the same linked member twice to a team roster should be
  prevented (dedupe by linked pub; the "PEOPLE WHO CAN SERVE" list can currently show the same person
  twice). (2026-06-26)

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
