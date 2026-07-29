# Audit — 2026-07-28, read-only

Four independent adversarial audits of the work done on `recovery/2026-07-26` and merged to `main` on
2026-07-27/28. Run under an explicit instruction to **fix nothing**, so nothing here has been touched.

This document exists to be handed to a fresh session. Read the next section before you act on any of it.

---

## How to use this document

**Every finding is labelled with how much it has actually been proved.** This matters more than the findings
themselves, because the central failure this audit uncovered is a fix that was *reported* as working, was
*tested* as working, and does not work.

| Label | Meaning |
|---|---|
| **VERIFIED** | I ran the check myself, in this session, and saw the result. The evidence is quoted. |
| **CLAIMED** | An auditor asserted it from reading. Plausible, unproved. **Reproduce it before you fix it.** |

A CLAIMED finding is a lead, not a fact. Several are subtle enough that an auditor reading quickly could be
wrong about them, and acting on a wrong finding is how new bugs got introduced all week. The rule that came
out of the previous session applies with full force here:

> Prove the bug exists by running the code, prove the fix works by running it again, and prove the test
> fails against the old code before you trust it.

Do not batch these. Each fix below is independently verifiable; a batch that goes out together cannot be
bisected when the phone shows nothing.

---

## The finding that matters most

### F1 — The `setProfile` guard does not refuse. It waits, then destroys the profile anyway.

**VERIFIED.** `src/fellowship.src.js:1891-1897`, current `main`:

```js
if (pub && !_k0Seen.has(pub) && Object.keys(profiles[pub] || {}).length === 0) {
  try {
    window.Fellowship.requestProfiles([pub]);
    const t0 = Date.now();
    while (!_k0Seen.has(pub) && Date.now() - t0 < 6000) await new Promise(r => setTimeout(r, 150));
  } catch (e) {}
}
const prev = profiles[pub] || {};        // ← reached whether or not the wait succeeded
```

Two independent defects:

1. **No failure branch.** After six seconds the loop exits and execution continues to `prev = {}`, publishing
   `{about:'', picture:''}` — clearing the photo and the directory opt-out on the relay, which is precisely
   the data loss the change was written to prevent. Six seconds is generous on a desk and short on the
   connections this product is built for, so on the target audience this is the *normal* path.
2. **The guard is skipped entirely once a name is known.** The condition requires the cached profile to be
   empty, but `_recoverOwnName` (added the same evening) populates a name-only entry. After recovery the
   guard is false, no wait happens, and the blank publish goes out immediately.

**The commit message is wrong.** It claims the behaviour matches the console's `publishProfile`. The console
**refuses** and tells the steward. This copied the wait and dropped the refusal.

**The test for it passes against the vulnerable code right now.** It asserts that two strings appear, in
order. It does not assert refusal, so it cannot fail. This is the worst artefact of the day: a green test
standing over a live bug, which will stop anyone else from looking.

**Fix direction:** delete the guard rather than patch it. A wait with no refusal is worse than no wait,
because it reads as protection. Replace with an explicit refusal that surfaces to the user — mirror
`publishProfile` properly — and write the test as *sabotage-first*: break the refusal, watch the test go red,
then restore.

---

## Live exposure

### F2 — The entire repository is publicly downloadable, unauthenticated.

**VERIFIED.** `GET https://trinityone.tailbeaac0.ts.net/relay-app/bundle.tgz` → **HTTP 200, 54,055,346
bytes**, no auth. Contains **61 markdown files**, including `AUDIT-2026-07-26-RECOVERY.md`,
`AUDIT-BACKLOG.md`, `HANDOFF.md`, `DEVICE-TEST-CHECKLIST.md`.

The docs denylist added on 2026-07-28 sits at `scripts/gateway.mjs:3196`. The bundle endpoint is at
`scripts/gateway.mjs:2386` — roughly 800 lines earlier, and it is a `git archive` of the whole ref, so it
carries every tracked file regardless of the denylist. **The morning's fix is bypassed.**

These documents name vulnerabilities and the dates they were introduced. This is the highest-value finding
for an attacker and the cheapest to exploit.

Note this also means **this very document is exposed** until F2 is fixed. `reference/` is in `DENY_DIR`, which
blocks the direct-serve route only.

**Fix direction:** the bundle needs its own exclusion path — either a `.gitattributes` `export-ignore` set
(which `git archive` honours) or a filtered rebuild. Verify by downloading the served bundle and listing it,
not by reading the code. Then check whether the signature covers the filtered bytes.

### F3 — Deploy unit files are served.

**CLAIMED** (one auditor reports verifying over HTTP; I did not re-check). `deploy/systemd/*.service` expose
the deploy path, the account name and the exact Node version, on every church's box.

The property test written this morning only ever asked about `.md` files, so it cannot catch this class.

**Fix direction:** widen the test to "what is served" rather than "are markdown files served", then fix what
it finds. The test is the deliverable here, not the single file.

### F4 — Cloudflare Pages ships `docs/`.

**CLAIMED.** Its markdown-stripping step is reported to be non-recursive. Separate route from F2, same class.

### F5 — Tracked in a public GitHub repo.

**CLAIMED.** `main` is reported ~140 commits ahead of the public mirror. If accurate this is a disclosure
question independent of any code fix, and is the owner's call, not a code change.

---

## Safeguarding

### F6 — The console renders photos a steward has switched off.

**CLAIMED.** `nophotoSet` / `photosAllowed` are never consulted on the console's member list, so a photo
suppressed for safeguarding still draws — on the screen where a steward would be moderating an image of a
child. Every member's phone honours the setting; the console does not. The tooltip promises the opposite.

Introduced by the avatar work on 2026-07-27 (`app/stew-data.jsx`, `SkBadge`).

**Fix direction:** consult the same suppression set the member app uses. Verify by suppressing a photo in the
console and confirming it disappears from the console's own list, on device.

### F7 — The locked-boot forensic wipe never runs.

**CLAIMED.** `app/app.jsx:399`. The wipe is gated on the same first-render sample that the lock-screen fix
declared unreliable earlier the same day. The gate was fixed; the wipe beside it was not, so
`clearCommunityCache` does not run on a locked boot — the one boot it was written for.

### F8 — `clearCommunityCache` does not do what its comment says.

**CLAIMED.** `followedChurches`, `care.*` and `serv.*` all survive it: the church list, cached care needs and
serving rosters remain, with church identifiers embedded in the key names. The function's own comment claims
otherwise.

F7 and F8 compound: the wipe does not run, and would not be sufficient if it did. Treat the forensic-hygiene
claim as **unsubstantiated** until both are fixed and verified on a device.

---

## Fixes from 2026-07-27/28 that do not work

Each of these shipped as "fixed". None are on the phones.

### F9 — Clearance back-fill re-fires and is silently truncated.

**CLAIMED.** Re-runs the whole roster on every visit to the Members tab, and exceeds the relay's 100/s cap.
Members past roughly the first hundred receive nothing, so **their children are treated as adults**. The
failure is silent — the same swallowed-error class that hid the member-restore bug for its entire life.

### F10 — The join-policy fix is rejected by any relay that already hosts a church.

**CLAIMED.** It succeeded only against the freshly wiped relay it was tested on. On a8 — which hosts a church
— the write is refused, so **new churches stay open-join, silently.**

This is the same shape as the `publishClearance` bug found earlier in the week: correct against an empty
relay, rejected against a real one.

### F11 — `_rebuildFamily` has never returned a child.

**CLAIMED.** Inert on every path: `_docsHubs` is empty at cold boot, and on unlock `reconnectAll()` tears down
its subscription about sixteen lines later. Additionally, any child it *did* rebuild would come back
**nameless and permanently marked unconfirmed**.

This aligns with the observed symptom — the child that vanished from the app while still linked in the
console — so this one has real-world corroboration, but the mechanism is unproved.

### F12 — The name-downgrade guard relies on an unsound signal.

**CLAIMED.** `syncSealedNames` gates on `hub.eosed`, which is also set by empty and by unauthenticated reads.
EOSE is not evidence that data was absent — the same rule that was correctly applied to the clearance gate in
the same commit, and not applied here.

---

## Tests

### F13 — A test passes against vulnerable code.

**VERIFIED** by inspection of F1's test and the code it covers. See F1.

### F14 — A leftover test relay can decide a result.

**CLAIMED, with a caveat I verified.** An auditor saw 526 pass / 3 fail at `HEAD` because a stray gateway was
squatting port 8907. **I checked this box and found no stray listeners** — only the legitimate relay on
:8000 — so the suite result here is not currently contaminated.

The finding still stands as an infrastructure defect, and the dangerous direction is the one nobody saw: a
stray relay from a *fixed* tree makes *broken* code report green.

**Fix direction:** bind tests to an ephemeral port, or fail loudly when the expected port is already in use.

### F15 — Eight fixed-width test windows remain.

**CLAIMED.** One is already shorter than the function it reads. This is the bug class that bit five times in
one session — a test that slices N lines and silently stops covering the code when the function grows.

### F16 — The sabotage claims mostly hold.

**CLAIMED.** 14 of 17 tests genuinely fail when the code they cover is broken. The suite is not worthless;
it is unevenly trustworthy, and F1/F13 shows where the trust runs out.

---

## Carried forward, still open

- **F17 — `trinityone.chatSeen` is unrecoverable.** Device-only, so everything reads unread after a lock.
  The next item in the same series as the identity and family keys.
- **F18 — PIN minimum is inconsistent.** `PinModal` still accepts 4 characters immediately after the forced
  gate demands 6. `src/identity.src.js:331` and `app/identity-extras.jsx:88,236` enforce 6; the modal does
  not.
- **F19 — The forced PIN gate can stick permanently.** An unhandled rejection while setting the PIN leaves
  `StewardForcedPin` with no way forward and no way out.

---

## Suggested order

Not a priority ranking — an order that keeps each step independently verifiable.

1. **F2** (bundle exposure). Live, verified, exploitable now, and independent of everything else.
2. **F1** (delete the guard). Verified, causes active data loss, and its green test is actively misleading
   anyone who looks.
3. **F6** (console photo suppression). Safeguarding, and small.
4. **F3/F4** by widening the served-files test rather than patching single files.
5. **F9, F10** — both silent, both leave churches wrongly configured.
6. **F7/F8** together, on a device, or not at all.
7. **F11, F12** — reproduce first; F11 in particular is inferred from a symptom.
8. **F14, F15** before trusting any future suite number.
9. **F17, F18, F19** as ordinary work.

---

## What the pattern says

Four of the fixes from 2026-07-27/28 are wrong, and one ships with a test that vouches for it. The pattern is
consistent and it is mine:

- **Verified the case, not the class.** The join-policy and clearance fixes each work against the one relay
  they were tried on and fail against a real one.
- **Wrote tests shaped like the fix rather than like the bug.** A test asserting that the new lines exist
  cannot fail while the bug survives beside them.
- **Applied a rule in one place and not the neighbouring one.** EOSE (F12) and the first-render sample (F7)
  were each fixed correctly a few lines from where the same defect was left standing.

**Nothing from the last two commits is on the phones.** That is the one piece of good luck in this document,
and it means all of the above can be fixed before anyone is running it.
