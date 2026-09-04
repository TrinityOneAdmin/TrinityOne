# Device verification log — branch `fix/audit-2026-09-02`

Owner's instruction, 2026-09-03: **test each batch on the phone before moving to the next.** This file is
the evidence, batch by batch. CLAUDE.md rule 6: the suite passing is not the gate.

**The device.** Oppo CPH2477 (`J77HDMTC7TKBZDFM`), `com.trinityone.app`, debug build, attached over
`adb` + CDP with `webContentsDebuggingEnabled` ON (pilot posture).

**CORRECTION, 2026-09-03 — the first version of this file was WRONG.** It said "the steward console is not
in the APK, so a console-only change has no phone surface", and logged batches 3 and 4 as unverifiable.
The owner corrected me. **There are two Android apps**, built from the one shared `android/` project:

- `com.trinityone.app` — the member app. `scripts/sync-web.sh` never copies `steward.html`, so the MEMBER
  APK holds the member app only. That much was right.
- `com.trinityone.steward` — **the console as its own Android app**, so a steward can run a church from a
  phone when the web console is blocked. Built by `scripts/build-steward-apk.sh`, which swaps the
  applicationId / name / icon / webDir and always restores the member project on exit.

So console work IS phone-testable, and everything below the batch-2 entry has been redone on the device.

**Use `source scripts/android-env.sh`** — JAVA_HOME, ANDROID_HOME, GRADLE_USER_HOME and PATH all point at
`/mnt/storage/android-tools`. Nothing is on the default PATH and there is no system JDK. Do not hand-roll
those paths (I did, before finding the script).

**A LIMIT I KEPT DELIBERATELY.** The phone can reach the live relays for real — there is no
`--host-resolver-rules` on a handset. The owner's instruction is that a8 stays untouched, and creating or
restoring a church on the phone console would self-register it to the canonical relays. So no church was
created or restored on the phone. The console checks below render the PACKAGED component under the page's
own React, with the outbound calls stubbed and no network touched at all. That proves the shipped code
behaves correctly on the device; it does not exercise a relay round-trip, and this file does not claim it.

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

## Batch 3 — Undo restores a room's protections (#2, #4-DashGroups) — VERIFIED ON DEVICE

Steward APK built from this branch and installed (`com.trinityone.steward`, 2026-09-03 08:25). Proved the
packaged code carried the fix before trusting anything: `pubOr` 5, `rowErr` 3, `setRowErr` 4 in
`assets/public/app/stew-dashboard.js`, matching the source exactly.

The packaged `DashGroups` rendered under the phone's own React, delete -> confirm -> Undo driven with real
DOM clicks. The room went in as invite-only, encrypted, 2 members, 1 leader. What Undo published:

    visibility "invite" · members ["aa11","bb22"] · encrypted true · leaders ["aa11"]
    name "Safeguarding leads" · category "staff"

Every field the old build dropped came back. Failure-first was proved on the desktop against 50e196c
(`the room came back OPEN. It was invite-only`); this entry proves the shipped APK behaves correctly on the
handset.

## Batch 4 — safeguarding lists fail closed (#3, #17-checkin, #24) — VERIFIED ON DEVICE

Packaged console components rendered on the phone under its own React:

| component | state | result |
|---|---|---|
| care requests | lists not yet known | **0** "Set up help", heading reads "CHECKING WHO THESE ARE FROM", does NOT claim "FROM A YOUNG PERSON" |
| care requests | known, church has no children marked | **1** "Set up help" — the care module still works |
| check-in | lists not yet known | "Loading the children's list…" |
| check-in | known, no children marked | "No children marked yet" |

The second row is the one that matters most: it is the design decision under test. Gating these screens on
`loaded` instead of `minorsKnown` would show 0 there, permanently, in every church that has never marked a
child. On the device it shows 1.

`#24` (the young person's explainer) is in the MEMBER app; the wording is present in the installed member
assets. Not yet driven on screen as a minor — that needs a church with a child account on the phone, which
the no-production-writes limit above rules out for now.

## Batch 5 — safeguarding writes are checked before the screen asserts them (#4 core) — VERIFIED ON DEVICE

Steward APK rebuilt from this branch and installed. Proved the packaged code carried the fix first:
`clearanceRemoved` 3, `tone: "fail"` 9 in `assets/public/app/stew-dashboard.js`.

The packaged `DashMembers` rendered under the phone's own React, one active member, the child control
pressed with real DOM clicks, and the relay's answer stubbed to fail the way `_publishToRelays` does:

| what the relay did | reseal to the member's phone | what the steward is told |
|---|---|---|
| refused the child mark | **0** — nothing sealed | "Couldn't mark …" and nothing about their status changed |
| took the child mark, refused the clearance removal | 1 (correct: they ARE no longer a minor) | "**still cleared** / could NOT be removed" — and NOT "clearance was removed" |
| took both | 1 | "clearance was removed" — the honest consequence, as before |

The middle row is the one that matters. Before this batch the console said the youth-work clearance had
been removed whether or not the relay accepted it, so a steward could believe a person was no longer
cleared to work with young people while every relay still said they were.

**Note on the harness, for whoever repeats this:** `DashMembers` hides members whose `lastTs` is older than
90 days, so a fixture with `lastTs: 1` renders "0 ACTIVE" and no row at all. Use a recent timestamp or the
control under test is not on screen.

## Batch 6 (part) — the blocked list names who was blocked (#17-blocked-list) — VERIFIED ON DEVICE

Packaged `DashMembers` rendered on the phone under its own React, two blocked pubkeys, one of whom is a
known member and one of whom never set a name; the "See blocked" toggle pressed with a real DOM click:

    namesTheBlockedPerson  true    ("Bram Whitlock" is on screen)
    stillSaysBlockedMember false   (the old label is gone)
    callsOutTheNameless    true    ("A member with no name set")

Fails first on 50e196c: `not ok 2 A BLOCKED MEMBER IS NAMED`, `not ok 3 …somebody who never set a name`,
with the CONTROL (the list opens at all) green on both.

**NOT done in this part, and still open:** the one-tap ✕ on the JOIN QUEUE, which blocks permanently and
rotates every church key with no confirm (audit #5). The two-step it needs already exists in the members
list a few lines away.

## Batch 6 (rest) — declining a joiner takes two taps (#5) — VERIFIED ON DEVICE

Packaged `DashMembers` on the phone, one person waiting in the join queue, driven with real DOM clicks:

    declineNamesThem     true   (the ✕ is labelled "Decline Nia Okafor — asks you to confirm")
    blockedAfterOneTap   0      (one tap blocks NOBODY)
    confirmAppeared      true
    confirmNamesThem     true   ("Confirm: block Nia Okafor and refuse them entry")
    blockedAfterConfirm  1      (the second tap is what acts)

Fails first on 50e196c: `not ok 2/3/4`, with the CONTROL (the row renders with a Decline) green on both.

**A guard worth knowing about, found doing this.** `pendingJoins` is gated on `mRosterLoaded`, which is
`!window.stewardStreamLoaded || (stewardStreamLoaded('subscribeAdmitted') && …('subscribeBlocked'))`. On a
console with NO church that helper exists and answers false, so the join queue correctly renders nothing —
a console that has not yet loaded the admitted and blocked lists must not show a "pending" queue, because
everyone would look pending. The probe has to stub it true or the rows under test never appear. In the Node
test the helper is absent entirely, so the `!window.stewardStreamLoaded` arm makes it true — the two
environments reach the same place by opposite routes, which is worth remembering before trusting either.

## Batch 7 — serving replies, RSVPs and leaving report what happened (#6) — VERIFIED ON DEVICE

MEMBER APK this time, not the steward one. Which build the phone loaded, read from its own WebView:

    447945 bytes · appliesAClockWindow false · servingReturnsNullOnFailure true

The three shipped methods lifted out of the bundle THE PHONE LOADED and run on the handset, against a
`_publishAny` that rejects the way the real one does when no relay accepted:

| method | no relay accepted | a relay accepted |
|---|---|---|
| `respondToServingRequest` | **null** | the event |
| `setEventRsvp` | **null** | the event |
| `leaveMembership` | **null** | the event |

**Why lifted rather than called live, and this is a real limit.** Calling `F.respondToServingRequest(...)`
on the phone returns `undefined` before touching any network: `if (!cp || !sk) return;` — this install has
no identity. Creating one would mean a keypair and a profile publish, and a handset has no
`--host-resolver-rules`, so that write could reach the live relays. The owner's instruction is that a8 is
left alone. So the shipped BYTES are executed on the device with their collaborators stubbed; the
end-to-end "member taps Yes with no signal" path is NOT covered here.

**Still owed on this batch (the plan marks it DEVICE for exactly this):** the wedged-socket case, where
`_publishAny` times out at 11 s rather than rejecting, only reproduces on a phone whose radio drops
mid-publish. That needs a church on the phone and airplane mode at the right moment.

## Batch 8 — a backup is recorded only when one exists (#7) — VERIFIED ON DEVICE

Member APK. The shipped `doExport` lifted out of the file the phone loaded and both branches run with the
backup helpers stubbed (no file written, no network touched):

| saveFile said | backup recorded? | member shown |
|---|---|---|
| `{ saved: true, warn: "…no copy may have been kept" }` | **false** | the warning |
| `{ saved: true, where: "Documents" }` | true | nothing (the ordinary toast) |

Note: the JSX→JS transpile strips comments, so a marker-comment grep against the APK assets returns 0. The
behaviour above is the proof, not the comment.

## Audit response (batches 3-7 audit) — cold-start safeguarding, and the row-vs-document fix — ON DEVICE

Two defects the independent audit of batches 3-7 found, both fixed and both checked on the steward APK.

**The hook's first-paint default**, read from inside a real render on the phone:

    { minors: [], approved: [], minorsKnown: false }   hasMinorsKnownKey true

**Both screens given a payload with the key ABSENT** (the shape the old default had):

    care requests:  0 "Set up help",  "CHECKING WHO THESE ARE FROM"
    check-in:       no "No children marked yet",  "Loading the children's list…"

So the batch 4 gate now holds at cold start, which is where the audit proved it did not.

## Batch 9 — relay adoption waits for its proof; a member can drop an address (#10, #21, #9) — ON DEVICE

Member APK.

**`proveRelays` on the shipped Fellowship, called live against an address that cannot answer:**

    exists true · result [] · took 208 ms

It resolves with nothing proved rather than rejecting or hanging — which is the whole requirement, because
a recovery screen must not die on a dead relay. (208 ms is the local failure path, not the 2G case.)

**The Remove control, rendered on the phone with three relays — one proved, one unproved, one canonical:**

    offered on the unproved row   yes
    offered on the proved relay   NO
    offered on the canonical      NO
    removed after one tap         0
    confirm appeared              yes
    removed after confirming      1

**NOT covered here, and the plan marks this batch DEVICE for it:** the 2G timing this fixes. The failure
mode is a recovery on a slow link where all three search passes land inside the proof window; a local relay
failing in 208 ms cannot produce it. That needs a throttled radio and a real church.

## Batch 10 — redundancy counted from the proof; sync reports (#11, #17) — VERIFIED ON DEVICE

Steward APK. The shipped `relayIdentities` and `syncEnable` lifted from the bundle the phone loaded and run
against a relay that CLAIMS a key on `/status` but cannot produce the proof. Nothing published anywhere.

    a relay that only CLAIMS a key   pubkey ""          online true
    a relay that PROVES a key        pubkey aaaaaaaa…
    sync with no relay accepting     throws "Sync could not be switched on — no relay accepted the setting"
    sync when a relay accepted       { relays: 2 }

`online: true` on the liar is deliberate: "reachable but cannot prove itself" must stay visible, or an old
relay looks dead rather than old.

## Batch 11 — removing a message can be undone (#16) — VERIFIED ON DEVICE

Steward APK. The shipped `subscribeHidden` lifted from the phone's own bundle and fed two stewards'
decisions in BOTH arrival orders:

    newer un-hide, delivered in order    -> []      (message is back)
    newer un-hide, delivered reversed    -> []      (message is back)
    newer hide,    delivered in order    -> ["m1"]  (message stays removed)
    newer hide,    delivered reversed    -> ["m1"]  (message stays removed)

The outcome no longer depends on which relay answered last, which is what makes an Undo button honest.

## Batch 12 — the care team comes from the church (#19, backlog HIGH S1) — VERIFIED ON DEVICE

Member APK. The shipped `_fetchCareTeam` lifted from the phone's own bundle, its steward-capability helper
injected, and fed competing `careteam:` documents:

    a stranger's NEWER list        -> ["real"]                 (the church's own is used)
    the care steward's newer list  -> ["from-care-steward"]    (the delegation works)
    the FINANCE steward's newer    -> ["from-church"]          (refused — capability keys hold)
    a roster with no caps recorded -> ["from-steward"]         (compat rule preserved)

## Batch 13 — NIP-42 on an IPv6-literal host (#20) — NO PHONE SURFACE

`scripts/gateway.mjs` is the RELAY. It does not ship in either APK, so there is nothing to install on the
handset: its surface is a running relay process. Covered by `relay-auth-binding.test.mjs`, which spawns a
real relay and drives a real websocket (9/9, and the new case proved failing against the 50e196c relay).

Remember the standing trap when checking this anywhere: a relay process OLDER than `scripts/gateway.mjs`
enforces the old parsing against new clients and makes this look unfixed. Check
`ps -o lstart=` against `stat -c '%y' scripts/gateway.mjs` before diagnosing.

## Batch 14 — "copied" means copied; the wizard cannot skip words it never showed (#13, #14) — ON DEVICE

Member APK. The shipped `copyPhrase` lifted from the phone's own `app/identity-extras.js` and run against
three clipboards. Nothing was written to the real clipboard:

    clipboard refuses     -> "Couldn't copy — write the words down instead"
    no clipboard at all   -> "This phone won't let the app copy — write the words down instead"
    clipboard works       -> "Phrase copied — paste somewhere safe"

**NOT reproduced on the device, and the plan flags it:** #14's real-world trigger is SecureStorage
deferring on a SLEEPING SCREEN — the phone put down mid-onboarding. The fix is covered by tests against the
shipped source, but producing the actual hang needs a sleeping handset and is still owed if the owner
wants it seen.

## Batch 15 — "Saved" follows the save (#17-publishProfile, #18) — VERIFIED ON DEVICE

Member APK. The shipped `saveIdentity` and the helper card's `save` lifted from the phone's own files:

    profile, nothing accepted   -> null                (so the toast says it failed)
    profile, accepted           -> truthy
    helper card, not accepted   -> not listed, and "Couldn't list you — the church hasn't been told"
    helper card, accepted       -> listed

The church's video/audio feed rows are CONSOLE, covered by the same commit's structural test.

## Batches 16 & 17 — care/finance confirmations; a tick means success — VERIFIED ON DEVICE

**Batch 16** (steward APK), the shipped `closeCheck` and the import modal's `doPost`:

    end check, nothing accepted -> confirm STAYS OPEN, "It is still live, and members are still being asked…"
    end check, accepted         -> confirm closes, no error
    import, one line failed     -> modal STAYS OPEN and names the line
    import, all posted          -> modal closes

**Batch 17** (member APK), the shipped `Toast` rendered on the phone:

    plain string   role="status"  icon present  "Saved"
    failure object role="alert"   icon present  "Couldn't send your answer — you're still shown as…"

The role flips, which is what a screen reader acts on; the icon changes from a tick to a shield.

## Batches 18 & 19 — accessibility; delete what nothing references — VERIFIED ON DEVICE

Steward APK, the real `NewGroupModal` rendered on the phone:

    announces itself as a dialog   true
    aria-modal                     "true"
    has an accessible name         true, and it resolves to the heading "New group"
    password fields with no name   0

Batch 19 deletes two files nothing referenced; a test asserts they are gone AND that nothing references
them, so their removal cannot silently break a page.

## Audit response (full-branch audit) — the modal crash, on device, through the transition that broke

The pre-merge audit proved that `NewGroupModal` threw React #310 the moment it OPENED, because a hook sat
below its early return. **No steward could create a group on that build.** My own device check had rendered
it ALREADY OPEN — the one transition that does not throw — so it passed over a crash.

Re-checked on the steward APK through the full cycle a steward actually drives:

    mounted closed, renders nothing   true
    opens without throwing            true
    the Name field is there           true
    closes again                      true
    REOPENS                           true
    React errors captured on window   [] (none)

**The lesson, kept here because it cost the most:** a device check that does not drive the STATE CHANGE is
not a device check. Render closed, then open, then close, then open again.

## The five swallowed care actions (2026-09-04) — both APKs on the Oppo

Both apps rebuilt from `11e38d9` and installed. Every check below drove the SHIPPED components in the live
WebView, not a copy of them.

**Which build is loaded** — read off the phone, not assumed:

    cancelCareRequest / setCareRequestStatus / fillCareSlot / clearCareSlot / clearCareSkip
      all five report failure          true
    approveCareRequest reports which half landed (member + console)   true

**Member app** — the real `MyRequestRow` and `CareRequestCard`, pressed:

    the row is quiet before anything is pressed        true
    Withdraw still asks for confirmation first         true
    a withdrawal that reached no relay says so         true   ("…this request is still open")
    that failure is a role="alert", not just colour    true
    CONTROL: a withdrawal that DID land stays quiet    true
    a close that reached no relay says so              true
      "That didn't reach the church — this request is still open, and the person who asked
       has not been told anything."

**Steward console** — the real `StewApproveSheet` and `StewCareRequests`:

    nothing published at all: the sheet stays open and says so   true
    …and does NOT report success to the list                     true
    need published, request never closed: reported upward        true
    the list then shows "it still shows below"                   true
    CONTROL: a clean approval is not flagged                     true
    CONTROL: the list stays quiet after a clean approval         true

**One thing the first run of the console probe got wrong, kept because it is the more useful finding.**
It reported "no Set up help button" and looked like a defect. It is not: the safeguarding lists had not
arrived in that hidden mount, and since the 2026-09-03 fix an unknown answer holds every request in the
CONFIDENTIAL section, where that button is absent on purpose. The fail-closed gate was working. The probe
was corrected to say the lists had arrived; the gate was not touched.

## The 2026-09-04 audit fixes — both APKs on the Oppo, from `3f3b6a6`

Every check drove SHIPPED code in the live WebView. The loaded build was read off the phone, never assumed:

    member  — safeguarding stream reports minorsKnown            true
            — …and asks the second question (_relayAuthedAt)     true
            — setProfile answers "did my change save?"           true
            — undo outranks the thing it undoes (_monotonicF)    true
    console — publishNeed refuses a failed publish               true
            — approve reports which half landed                  true
            — "sync off" is checked                              true
            — the ledger can discard what was refused            true

**The safeguarding one, on the phone:**

    lists not yet arrived: no "Set up help" anywhere       true
    …and the screen says it is still checking              true
    CONTROL: lists arrived, adult's request keeps it       true

**The console, with a publishSigned that fails the way the real `publish()` does (returns `false`):**

    a refused need is not a saved need                     true
    CONTROL: an accepted need still comes back             true
    need accepted + status refused -> stillOpen            true
    nothing accepted -> total failure, not "half done"     true
    the need sheet does not close as saved                 true, and says why
    CONTROL: a clean save still finishes                   true
    dropFrom discarded 2 refused entries, book contiguous  true

**The first run of the console probe could not reach the line under test**, and the reason is worth keeping:
this console holds no care key, so `publishNeed` refuses at its own guard before ever publishing — correct
behaviour, and it means a probe must lend it a seal to exercise the publish path at all. A probe that stops
at an earlier guard and reports nothing looks exactly like a probe that passed.

**Not driven on the device:** the bank-statement import retry. It needs a real church, a real relay and a
real CSV, so it is covered instead by `a-retried-import-does-not-post-twice.test.mjs`, which runs the SHIPPED
ledger and the SHIPPED importStatement against a relay enforcing the real exact-next-seq rule. Worth a human
pass with a real statement before this reaches a church.

