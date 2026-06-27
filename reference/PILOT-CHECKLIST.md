# Pre-pilot checklist (captured 2026-06-27)

## 🔴 Must-do
- **Deploy the latest.** a8 is on build **96 (0.9.8)** but we're at **100 (0.9.12)** — production is missing the
  care-card cache (97), steward filter/roster/care-team warning (98), the **care-team membership fix** (99,
  the visibility-saga root) and multi-verse (100). Dev box already serves 100, so: a8 → `.update-request` +
  "Fetch latest APK". Until then the pilot runs the OLD care-team behaviour.
- **Relay data backup.** No backup mechanism exists. The relay store (`relay-db.json` / `relay.sqlite` after
  the migration) holds ALL church data — members, rosters, needs, chat. Add a periodic OFF-box copy. (Offered
  to build a rotating-backup script.)
- **Back up the release keystore.** `android/app/release.keystore` + `keystore.properties` off this box —
  lose them and no app update can ever install again.

## 🟠 Should-do
- **Safeguarding config.** Relay enforces minors / approved-adults / guardian DM-gating, but each pilot church
  must mark its minors + cleared adults before any under-18s use it. Walk both churches through it.
- **Deploy SQLite migration + per-church fairness** (branch `claude/relay-sqlite`) — verify **Node 22+** on a8
  and the NUC first. Built + tested; you wanted fairness for the two-church pilot. Not strictly blocking at
  pilot volume, but it's the right base.
- **Onboarding dry-run.** Walk both churches through join → follow → first-launch wizard end-to-end once, on a
  real thin connection.
