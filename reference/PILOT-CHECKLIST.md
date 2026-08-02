# Pre-pilot checklist (captured 2026-06-27)

## 🔴 Must-do
- **Deploy the latest.** a8 is on build **96 (0.9.8)** but we're at **100 (0.9.12)** — production is missing the
  care-card cache (97), steward filter/roster/care-team warning (98), the **care-team membership fix** (99,
  the visibility-saga root) and multi-verse (100). Dev box already serves 100, so: a8 → `.update-request` +
  "Fetch latest APK". Until then the pilot runs the OLD care-team behaviour.
- **Relay data backup.** ~~No backup mechanism exists.~~ **UPDATED 2026-08-02:** a full backup AND restore now
  exist, are wired to the relay control panel, and were driven end to end (14/14 docs, 12/12 chat, media blobs
  and their owner sidecars all returned, read gate still default-deny). What is still missing is a **periodic,
  automatic, off-box copy** — there is no cron and no systemd timer, so durability depends on a human clicking
  "Download backup".
  - **Back up the WHOLE data directory, never `relay.sqlite` alone.** SQLite writes new rows into
    `relay.sqlite-wal` and folds them in later, so the main file can be almost empty while the church's data
    sits in the side file. A hand-copied `relay.sqlite` opens **without any error** and reports an empty
    church. The control-panel backup is correct (it checkpoints first), and as of 2026-08-02 so is a clean
    `systemctl stop` — but an improvised `cp` of that one file is not.
  - The archive is **unencrypted** and contains `admin.json` (full relay takeover) and the relay's private
    key. Treat a backup file as you would the keys themselves.
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
