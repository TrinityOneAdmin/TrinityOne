# Device verification log — branch `fix/audit-2026-09-02`

Owner's instruction, 2026-09-03: **test each batch on the phone before moving to the next.** This file is
the evidence, batch by batch. CLAUDE.md rule 6: the suite passing is not the gate.

**The device.** Oppo CPH2477 (`J77HDMTC7TKBZDFM`), `com.trinityone.app`, debug build, attached over
`adb` + CDP with `webContentsDebuggingEnabled` ON (pilot posture).

**What the phone can and cannot verify.** The APK carries the MEMBER app only — `index.html`, `app/*.js`
and `vendor/*.js`. **The steward console is not in the APK** (`steward.html` is never synced), so a
console-only change has no phone surface and its real surface is a desktop browser. Each entry below says
which it was. Claiming a console fix was "verified on the phone" would be a false claim in the record.

**Building the branch onto the phone** — the toolchain is not on `PATH`:

    cd <worktree> && bash scripts/sync-web.sh
    rsync -a --delete www/ /mnt/storage/projects/TrinityOne/android/app/src/main/assets/public/
    cd /mnt/storage/projects/TrinityOne/android && \
      JAVA_HOME=/mnt/storage/android-tools/jdk ANDROID_HOME=/mnt/storage/android-tools/sdk \
      ANDROID_SDK_ROOT=/mnt/storage/android-tools/sdk GRADLE_USER_HOME=/mnt/storage/android-tools/gradle-home \
      PATH=/mnt/storage/android-tools/jdk/bin:$PATH ./gradlew assembleDebug
    adb install -r android/app/build/outputs/apk/debug/app-debug.apk

**TRAP, cost real time on the first run:** `npx cap sync android` did NOT copy the worktree's `www/` when
`android/` is a symlink into the main tree — it left the PREVIOUS build's assets in place, and the first
probe would have "verified" the fix against the unfixed bundle. The `rsync` line above is what makes it
deterministic. **Always prove which build loaded before believing a device result.**

---

## Batch 2 — the clock fix (#1) — VERIFIED ON DEVICE, with a control

**Which build was loaded** (read out of the phone's own WebView, not assumed):

    bytes 447870 · hasVerifier true · appliesAClockWindow FALSE · checksTheNonce true

**The fix, on the device, against the live relay over the Tailscale funnel.** The app's own shipped
`Fellowship.verifyRelayIdentity`, with only the device's idea of "now" moved:

| phone clock | relay admitted? |
|---|---|
| correct | yes |
| 15 minutes fast | yes |
| 15 minutes slow | yes |
| a full day behind | yes |

**The control — the same phone, the same relay, a genuine freshly-fetched proof, judged by the rule the
old build applied** (`|now − created_at| ≤ 300`). The proof was genuine and its nonce matched, so freshness
is intact:

| phone clock | age of proof | old rule |
|---|---|---|
| correct | 2 s | accepted |
| 15 minutes fast | 902 s | **REFUSED** |
| 15 minutes slow | 898 s | **REFUSED** |
| a full day behind | 86398 s | **REFUSED** |

So on this handset the old build admits no relay at all once the clock is a quarter of an hour out, and
the new build admits it at every skew tested. That is the finding and the fix, on real hardware.

---

## Batch 3 — Undo restores a room's protections (#2, #4-DashGroups) — NO PHONE SURFACE
Console-only (`app/stew-dashboard.jsx`). Not in the APK. Verified by the point-of-use tests in
`scripts/undo-brings-the-room-back-whole.test.mjs` driving the real component, proved failing against
50e196c. **Still wants a human on a desktop console before merge.**

## Batch 4 — safeguarding lists fail closed (#3, #17-checkin, #24) — PART PHONE, PART CONSOLE
- `#3` care requests and `#17-checkin` are console-only. No phone surface. Same status as batch 3.
- `#24` the young person's explainer IS the member app. Present in the installed assets, verified by
  string on the device (`app/screens-chat.js` carries the empty-cleared-list wording). **Not yet driven
  on screen as a minor** — that needs a church on the phone with a minor account, which is a longer setup.
