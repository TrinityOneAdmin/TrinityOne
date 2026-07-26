# Device test checklist — account recovery work, 2026-07-26

Everything below needs a **real device**. Nothing here is covered by `npm test` (358 passing), because none of
it can be: cameras, a second phone, a locked screen, a dead network, and a human reading the copy.

**Updated 2026-07-26, later session.** The five CRITICALs in `AUDIT-2026-07-26-RECOVERY.md` are now fixed, and
two of them changed what you should EXPECT to see, so the steps below have been rewritten to match. The biggest
change: the transfer's check code is no longer four characters shown up front — it is **eight characters shown
on both phones AFTER they have swapped codes**, and the new phone now asks you to confirm before it adopts
anything. If you test against the old expectations you will report a bug that isn't one.

**Before you start**
- Wake the screen and keep it awake. A sleeping phone throttles the WebView and every reading comes back zero —
  that has been misread as an app failure more than once.
- If a step shows nothing, first check: is the screen on, is the app PIN-locked, is there signal?
- The **Pixel** has a release-signed APK built at **23:00 on 2026-07-26** with everything below, installed and
  smoke-checked on the device (it boots, renders, `confirmTransfer` is present, `beginTransfer` no longer emits
  the old precomputable code, and `sealTransfer` still refuses while PIN-locked). It was PIN-locked at the time,
  so nothing further could be driven on it.
- The **OPPO** has the OLDER 21:51 build — it was not attached this session. Reinstall it before testing, or you
  will be testing yesterday's bugs.
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

### 1c. Phone-to-phone transfer *(needs BOTH phones — flow CHANGED, read this first)*
- ⬜ Old phone: tap **your picture** in the bottom bar → **Move to a new phone** exists and opens. (The screens
  used to say "Settings →", which does not exist in this app; if you still see that wording, it's an old build.)
- ⬜ New phone: "I've used it before" → **"I still have my old phone"** shows a QR. **There is deliberately no
  check code on this screen** — nothing has been exchanged yet, so any code here could only be forged.
- ⬜ Old phone scans it → shows a second QR **and an eight-character check code**.
- ⬜ New phone scans the second QR → it does **not** log you in yet. It shows the **same eight characters** plus
  the start of the account it is about to become, and asks whether they match.
- ⬜ **They match** → account arrives; name and church appear.
- ⬜ Run it once more and tap **"They're different"** instead → nothing is moved, the phone stays itself, and
  starting over works. ← this is the security property; if tapping it still logs you in, stop and report it.
- ⬜ If the two codes ever genuinely differ in normal use, that is a **bug**, not an attack — capture both.
- ⬜ **Old phone stays signed in** (this is deliberate — moving is not logging out).
- ⬜ New phone can then show its own 12 words (your picture → Recovery key). If it cannot, the transfer gave it
  an account it can never back up — a serious failure.
- ⬜ **No camera / camera denied on either phone** → a paste box appears with "Use this code", and the matching
  "Can't scan? Copy the code instead" button on the other phone. Do the whole transfer by copy-paste at least
  once; before today this path dead-ended on both phones.
- ⬜ Cancel midway (Back is now always enabled, and says "Cancel" while it is working), then try again → works.
- ⬜ Scan an **unrelated** QR (e.g. a church invite) into the transfer → clear error, not a crash.
- ⬜ After a transfer, the "back up your 12 words" nudge is **still showing** — the member typed nothing and has
  never seen their phrase, so it must not have been silenced.

### 1d. Lost the 12 words → ask the church *(new)*
- ⬜ "I've lost my 12 words" shows **this phone's own code** as a QR plus text, and a Copy button.
- ⬜ The honest panel is visible: what comes back (name, church, ordinary groups), what needs a steward's hand
  (invite-only groups), and what does not come back at all (old private messages, sealed care records).
- ⬜ "Done — take me to my church" opens the **follow-a-church scanner** — NOT the welcome wizard asking whether
  you have used TrinityOne before. That loop was the bug; if you see the wizard, the fix did not ship.

### 1e. Church-name lookup *(new)*
- ⬜ Restore that finds **no church** → the "couldn't find your church" screen appears, not a silent empty app.
- ⬜ Same again but coming in by **transfer** rather than typed words: it must reach that same screen and not sit
  on "Bringing your account across…". That was a permanent dead-end with a disabled Back button.
- ⬜ While the name lookup is running, the screen **stays put** with its progress text — it must not flick back
  to the 12-words textarea and forward again.
- ⬜ Typing a real relay name finds it, adds the relay, and the church then appears.
- ⬜ A nonsense name gives a clear, non-alarming error.
- ⬜ **Security check worth doing by hand:** a directory entry resolving to a `ws://` (cleartext) URL must be
  refused. Only `wss://` may ever be adopted. This is guarded in code but has no automated test.

### 1f. After a re-seat (pairs with Surface 2)
- ⬜ Once a steward reconnects them, the member's new key sees the church, groups and roster.
- ⬜ **Their NAME is back** — on their own phone and in everyone else's member list — not "Anonymous …". Give it
  a few seconds: their app publishes the vouched name as its own profile the moment the document arrives.
- ⬜ Then rename yourself on that phone → the new name sticks and is **not** reverted by the church's vouched one.
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
- ⬜ The confirmation says their name comes with them, **and** tells you to add them back to any invite-only
  groups by hand. Check that instruction is true: open an invite-only group and confirm the new key is absent
  until you add it.
- ⬜ A member with **no name set** reconnects cleanly too (nothing is published as their name).

### 2b. Regression around it
- ⬜ Approve / block / child / clear-for-youth / link-parent all still behave.
- ⬜ Member count on the dashboard matches the list.
- ⬜ Revoke a steward → they can no longer reconnect anyone.

---

### 1g. The restore-recovery loop *(fixed — this one is about what should NOT happen)*
- ⬜ Restore an account where the church cannot be found, then leave the app open on the Today screen for five
  minutes with the steward console watching that member. Their profile must **not** keep updating. The bug this
  replaces republished the member's profile roughly every four seconds, forever, to everyone in the church.
- ⬜ Same test with the phone in **aeroplane mode**: it must sit quietly, not spin.

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
