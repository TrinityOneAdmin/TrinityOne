# Device test checklist — account recovery work, 2026-07-26

Everything below needs a **real device**. Nothing here is covered by `npm test` (340 passing), because none of
it can be: cameras, a second phone, a locked screen, a dead network, and a human reading the copy.

**Before you start**
- Wake the screen and keep it awake. A sleeping phone throttles the WebView and every reading comes back zero —
  that has been misread as an app failure more than once.
- If a step shows nothing, first check: is the screen on, is the app PIN-locked, is there signal?
- The OPPO **already has** a release-signed APK built at **21:51 on 2026-07-26** containing all of this work
  (verified on device: the transfer and name-lookup APIs are present). The **Pixel does not** — it dropped to
  `unauthorized` before it could be installed.
- To rebuild/install after any change:
  `source scripts/android-env.sh && npm run sync:web && (cd android && ./gradlew assembleRelease -q)`
  then `adb install -r android/app/build/outputs/apk/release/app-release.apk`. It is **release-signed with the
  stable key**, so it upgrades in place and keeps the identity — you do NOT need to uninstall (and must not, if
  you want to keep "Sir Lloyd").
- ⚠ **Never run `npm run build:vendor` to rebuild a bundle.** It regenerates all of `vendor/` and silently
  deleted the entire Sora font block from `vendor/fonts/fonts.css` on 2026-07-26 — no test fails, the app just
  renders in the wrong font. Use the specific script: `build:fellowship`, `build:identity`,
  `bash scripts/build-steward.sh`.
- The work is on branch **`recovery/2026-07-26`**, not `main`. `git checkout recovery/2026-07-26` first.

Legend: ⬜ untested · ✅ pass · ❌ fail (note what you saw)

---

## Surface 1 — Member app (Android)

### 1a. First launch / the fork *(new)*
- ⬜ On a genuinely clean install (uninstall first — reinstall is not clean), the **first screen asks "have you
  used TrinityOne before?"**, with two equal options, not a create-account form.
- ⬜ "I'm new here" → the normal setup wizard, unchanged.
- ⬜ "I've used it before" → the three recovery routes.
- ⬜ "Skip setup for now" still works and lands in the Bible.
- ⬜ Back from any recovery route returns to the fork, not out of onboarding.

### 1b. Restore with 12 words *(fixed today — this never worked before)*
- ⬜ Type a real member's 12 words → **name AND church both come back**. (Before today only the name did.)
- ⬜ It happens **on the restore screen** with "Finding your church…", not after landing in an empty app.
- ⬜ A wrong/mistyped phrase gives a clear error and does not wipe the current identity.
- ⬜ **Multi-church member**: all their churches return, newest-joined first, and that one is active.
- ⬜ A church they deliberately **left** does not come back.
- ⬜ Restore with **aeroplane mode on** → honest failure, no false success, retries on next launch.

### 1c. Phone-to-phone transfer *(new — needs BOTH phones)*
- ⬜ Old phone: Settings → **Move to a new phone** exists and opens.
- ⬜ New phone: "I've used it before" → **"I still have my old phone"** shows a QR and a 4-character check code.
- ⬜ Old phone scans it → shows a second QR and **the same 4 characters**. ← if these differ, stop; that is the
  security property doing its job.
- ⬜ New phone scans the second QR → account arrives; name and church appear.
- ⬜ **Old phone stays signed in** (this is deliberate — moving is not logging out).
- ⬜ New phone can then show its own 12 words (Settings → Recovery key). If it cannot, the transfer gave it an
  account it can never back up — a serious failure.
- ⬜ Camera denied / no camera → falls back gracefully, does not hang.
- ⬜ Cancel midway, then try again → works; the old code no longer does anything.
- ⬜ Scan an **unrelated** QR (e.g. a church invite) into the transfer → clear error, not a crash.

### 1d. Lost the 12 words → ask the church *(new)*
- ⬜ "I've lost my 12 words" shows **this phone's own code** as a QR plus text, and a Copy button.
- ⬜ The honest panel is visible: what comes back (name, church, groups) and what does not (old private
  messages, sealed care records).
- ⬜ "Done — take me to my church" opens the follow-a-church scanner.

### 1e. Church-name lookup *(new)*
- ⬜ Restore that finds **no church** → the "couldn't find your church" screen appears, not a silent empty app.
- ⬜ Typing a real relay name finds it, adds the relay, and the church then appears.
- ⬜ A nonsense name gives a clear, non-alarming error.
- ⬜ **Security check worth doing by hand:** a directory entry resolving to a `ws://` (cleartext) URL must be
  refused. Only `wss://` may ever be adopted. This is guarded in code but has no automated test.

### 1f. After a re-seat (pairs with Surface 2)
- ⬜ Once a steward reconnects them, the member's new key sees the church, groups and roster.
- ⬜ The member list shows them **once**, not twice.
- ⬜ Old private messages are **absent** — confirm this, because the UI promises it.

---

## Surface 2 — Steward console

### 2a. Reconnect a member *(new)*
- ⬜ Members list → each member row has a **Reconnect** button.
- ⬜ It explains what it does, and warns clearly if the member is marked as a **child**.
- ⬜ **Scan** the member's code works; **paste** also works (for a member who isn't present).
- ⬜ Pasting rubbish, or the member's *existing* key, is refused with a readable message.
- ⬜ After confirming: the roster shows **one** entry, the member count does **not** increase, and the new key
  can post immediately (it is admitted automatically).
- ⬜ Do it as a **delegated steward**, not just the owner — that path stamps the church tag differently and is
  the one most likely to be broken.
- ⬜ Re-seat the wrong person on purpose, then re-seat correctly → the mistake can be undone.

### 2b. Regression around it
- ⬜ Approve / block / child / clear-for-youth / link-parent all still behave.
- ⬜ Member count on the dashboard matches the list.
- ⬜ Revoke a steward → they can no longer reconnect anyone.

---

## Surface 3 — Relay / gateway

- ⬜ After deploying, `curl -s https://app.trinityone.church/status` reports the new `versionShort`.
  (Remember: the bundle is built from **`main`** — a commit on a side branch deploys nothing.)
- ⬜ Both domains briefly 530 during an update. That is normal; re-poll before concluding an outage.
- ⬜ An **old APK** still works against the updated relay (members will not all update at once).
- ⬜ The re-seat document is not readable by an anonymous client. Quick check from any machine: connect to
  `wss://app.trinityone.church/relay`, `REQ` for `kinds:[30078], #d:["trinityone/reseat:<churchpub>"]`
  without authenticating — expect **no events**.

---

## Known gaps — not covered by any automated test

| Gap | Why it matters |
|---|---|
| Camera hand-off between two phones | The crypto and state machine are tested; the cameras are not. |
| `wss://`-only guard on the name lookup | Structurally present, no test drives it. |
| Re-seat end to end across two real apps | Each half is tested separately; the join has never run. |
| PIN interaction with all new screens | A PIN-locked boot has broken relay auth before. |
| Any of this on a genuinely slow/2G connection | Timeouts and "finding your church…" copy are untested under real latency. |
