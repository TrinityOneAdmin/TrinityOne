# "Stay open on this phone for 30 days" does not stick — and destroys its own record

Found 2026-09-04, after the owner said "I don't know if it actually sticks". It does not, on at least one
of the two test phones, and the way it fails means ticking the box again cannot help.

**This is NOT caused by fresh installs.** An app UPDATE (`install -r`) preserves it; only a full uninstall
would wipe it, which is expected. The real cause is below.

## Reproduced from a clean install, Pixel 10 Pro (Android 16), member APK at `486c559`

    1. fresh install, set a PIN, tick "stay open"
         setPin              true
         rememberDevice      true      <- read-back verified, so the record really is in the secure store
         rememberedUntil     30 days
         marker              {"v":2,"native":1,"pub":"0309aa78cdea753f…"}

    2. ONE force-stop and relaunch (no reinstall, no reboot)

    3. marker              {"v":2,"native":1}      <- the owner is GONE
       isLocked            true                     <- asks for the PIN anyway
       rememberedUntil     0                        <- and the record has been DESTROYED

## Why

`setPin()` writes the localStorage marker `trinityone.nostr.mnemonic.enc` as `{v, native, pub}`. The `pub`
is the only reference a locked boot can consult, and `rememberedSeed()` refuses — and CLEARS the record —
when it cannot match it.

That marker did not survive the restart. `init()` then took its orphan-recovery branch:

```js
if (isNative() && await hasOrphanEncBlob()) {
  localStorage.setItem(ENC_KEY, JSON.stringify({ v: 2, native: 1 }));   // no `pub` — it cannot know it
  applyLocked(); return;
}
```

…which is correct on its own terms (it recovers a PIN-locked identity rather than minting a new key), but it
rewrites the marker WITHOUT the owner. From that moment the remember record can never be verified, so it is
deleted on sight. Confirmed in logcat at boot — an `internalGetItem` for `trinityone.nostr.remember`
immediately followed by an `internalRemoveItem` for the same key.

## Why it looks intermittent

The Oppo (CPH2477, Android 12) kept the record across two force-stop relaunches and stayed open. The Pixel
(Android 16) loses it on the first. It is a WebView localStorage flush race, so it will look like "sometimes
it works" to anyone using it — which is exactly how it was reported.

## What it costs

The member ticks a box that says "stay open for 30 days", is told nothing went wrong, and is asked for the
PIN on the very next launch. If they have not written the PIN down they are locked out of their church and
must use their 12 words. The feature is not merely inert: it deletes the record, so the second and third
attempts fail the same way with no explanation.

## FIXED, `74b1645` — option 1 below was the one taken

Owner chose it the same day. setPin now writes the owner alongside the ciphertext in the hardware store and
the recovery path rebuilds the marker whole, then consults the remembered seed (that branch never did).
Re-measured on the Pixel with the identical three steps: open after one force-stop, record intact, 30 days.

## The two options as they were put, kept for the reasoning

Two candidate fixes, and choosing between them is a security decision, not a 3am one:

1. **Store the owner where the blob already lives.** `setPin` puts the ciphertext in the hardware store and
   the marker in localStorage; only the localStorage half is lost. Keeping `pub` alongside the blob would
   let the orphan path restore a COMPLETE marker. This looks right and changes what is written at rest.
2. **Fall back to `trinityone.nostr.pub`** on the orphan path, which did survive here. Cheaper, but that
   value is written by `apply()` and is "the last identity that loaded", not "the account this blob holds" —
   the file's own comments are explicit that guessing the owner is the thing not to do.

Neither should go in without its own audit. `scripts/` has no test that drives this path at all.
