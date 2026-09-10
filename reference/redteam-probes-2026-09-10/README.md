# Red-team probes, children's check-in, 2026-09-10

The eight probes from the red-team pass that produced findings F1-F9 in
`../SCOPE-CHECKIN-SEALING-2026-09-10.md`. Kept because they are the **reproduction** for those findings and
the proof any fix has to satisfy — they were written in a throwaway agent worktree and would have died with it.

They are probes, not tests: they spawn a real gateway, sign real events, and print what happened. They are
NOT run by `npm test` and must not be — several bind fixed ports in the 9111-9115 range.

    node reference/redteam-probes-2026-09-10/zz-redteam-matrix.probe.mjs

- `matrix`   — 32 rows: cross-session, cross-church, both doors. F1 lived here (row "ada OVERWRITES r2").
- `ck`       — the shipped reader; shows a forged body replacing the church's row before `cac7751`.
- `sync`     — F2: `/sync` handing a Finance-only steward `minors:`/`guardians:` in cleartext.
- `revauth`  — F3: a withdrawn clearance returning after a restart once its author is de-capped.
- `mirror`   — F4: the same in reverse; a de-capped grantor still granting until a restart.
- `console`  — F3's console half, which needs no restart at all.
- `doors`    /`doors2` — accept() vs ingest agreement, and F5's two-author clock-skew case.

⚠ **F7 contradicts `matrix`.** F7 claims the relay accepts a helper's hand-crafted tombstone; `matrix`'s own
row `ada TOMBSTONES r1` measured it **refused**, both before and after the fix. Resolve before building on F7.
