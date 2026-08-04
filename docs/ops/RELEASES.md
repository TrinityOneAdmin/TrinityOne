# TrinityOne — Releases

How we version and ship. Keep it short; update when the policy changes.

## Stages

| Stage | What it means | Version line |
|---|---|---|
| **Pilot (Alpha)** ← *we are here* | One church (Trinity Church Littlehampton). Rapid iteration, not feature-frozen. Lightning/giving + FCM push parked. | `0.9.x` |
| **Beta** | A handful of invited churches. Feature set settling; still pre-public. | `0.9.x` → `0.10.x` |
| **1.0 — public launch** | Anyone can start a church. | `1.0.0` |

"**Pilot**" is the church-facing word; "**Alpha**" is the engineering reality. We don't call it 1.0 until it's earned (see gates).

## Version policy

- **SemVer-ish, pre-1.0:** `0.MINOR.PATCH`. Patch = fixes/polish; minor = notable features or a stage bump.
- **Member and Steward share one version line** (both built from `main`).
- **Android `versionName`** (e.g. `0.9.0`) lives in `android/app/build.gradle` — which is **gitignored (disk-only)**. Set it by hand when you cut a build. **`versionCode`** (the integer Android compares for updates) is **auto-bumped by `scripts/release.sh`** every build, so each one supersedes the last.
- **Service-worker cache** (`sw.js` `trinity-shell-vNN`) is a **separate cache-buster**, not the product version. `release.sh` bumps it each web deploy.
- **Git tag** each build that goes to testers: `git tag v0.9.1 && git push --tags`.

## Gates for 1.0 (don't ship 1.0 until these are done)

- [ ] **Security audit** of key custody, invite links, relay write-policy, exposure, backups (see `reference/SPINE.md` → Security audit).
- [x] **Signing keys backed up off-box + restore-verified** — 2026-08-04, see "Signing keys" below. One gap
      remains: the relay release key is backed up but has **not** been drilled against a known bundle signature.
- [ ] **Giving decision**: ship Lightning giving, or formally scope it out of 1.0 (it's parked now).
- [ ] **Relay resilience**: more than one canonical node so a church can't go dark (SPINE → Relay resilience).
- [ ] Onboarding + first-launch wizard solid across a clean install.

## Cutting a release

Everything goes through **`scripts/release.sh`** (commit your code first — the web build deploys `git archive HEAD`, so uncommitted tracked edits silently don't ship).

```sh
# bump the versionName by hand first if this is a new pilot build:
#   android/app/build.gradle:  versionName "0.9.1"
scripts/release.sh            # web (Pages, production) + BOTH APKs + restart gateway
scripts/release.sh --web      # web only (fast)
scripts/release.sh --apk      # APKs only
scripts/release.sh --dry      # show steps, change nothing
git tag v0.9.1 && git push --tags
```

Artifacts (repo root, served by the gateway at `/apks.html`; the steward one also ships on Pages):
- `trinityone.apk` — member
- `trinityone-steward.apk` — steward console

**Never hand-run `gradlew` without `sync-web.sh` first.** A bare gradle build packages the *last-synced* web assets and silently ships stale code (`sync-web.sh` ends with `npx cap sync`, which copies `www/` into the native project). This is what `release.sh` does for you.

## Signing keys — BACK THESE UP (loss is unrecoverable)

Two irreplaceable secrets live **only** on the dev/release box (both gitignored, disk-only). If either is
lost, you cannot ship again to existing installs — Android rejects an APK signed by a different key, and relays
reject a self-update signed by a different release key. There is no recovery.

| Key | File (gitignored, disk-only) | Loss = | Fingerprint |
|---|---|---|---|
| **APK signing keystore** | `android/app/*.keystore` + `android/app/keystore.properties` | every member's app can never update again (must uninstall/reinstall, losing local data) | `9A:51:21…` |
| **Relay release key** | `relay/release-key.pem` (+ public `relay-app/release-pubkey.pem`) | no church relay can receive a signed self-update again | — |

**Do this now and re-verify each release:**

- [x] Both keys are backed up **off this box** — 2026-08-04. All three files (`release.keystore`,
      `keystore.properties`, `relay/release-key.pem`) in one AES-256 `gpg --symmetric` archive, copied to
      **Proton Drive + the NAS** (owner-confirmed). One copy on one machine is not a backup.
- [x] The keystore password travels **inside** the archive (`keystore.properties`), so the thing to protect is
      the archive passphrase — held **on paper**, deliberately NOT in the same account as the archive, since
      Drive + password-manager behind one login hands over both halves at once.
- [x] Restore drill run 2026-08-04 — decrypted, extracted, and `keytool` reproduced
      `9A:51:21…AD:8C:A6:00`. **Not just created: opened.**
- [x] Relay key drilled 2026-08-04. Ed25519 is **deterministic**, so the drill is exact: the backed-up key
      signed a fixed blob, `openssl pkeyutl -verify` passed against the committed `release-pubkey.pem`, and
      the signature was byte-identical (`daaf3bae…`) to the live key's. Also confirmed
      `openssl pkey -in relay/release-key.pem -pubout` equals `relay-app/release-pubkey.pem` — i.e. this
      secret really is the counterpart of the key baked into every church's relay.
      *Note: a8 is NOT the release host — it 404s `/relay-app/bundle.{tgz,sig}` with "this host has no
      release key". Bundles are signed and published from the dev box. Drill locally, not against a8.*

### Rebuild the backup (run these yourself, so the passphrase stays out of any log)

```sh
tar -czf - -C /mnt/storage/projects/TrinityOne \
  android/app/release.keystore android/app/keystore.properties relay/release-key.pem \
  | gpg --symmetric --cipher-algo AES256 -o ~/trinityone-keys-$(date +%F).tar.gz.gpg

# drill it — must print 9A:51:21…AD:8C:A6:00
d=$(mktemp -d); gpg -d ~/trinityone-keys-$(date +%F).tar.gz.gpg 2>/dev/null | tar -xzf - -C "$d" \
  && keytool -list -v -keystore "$d/android/app/release.keystore" \
       -storepass "$(grep -oP '(?<=storePassword=).*' "$d/android/app/keystore.properties")" \
     2>/dev/null | grep SHA256; rm -rf "$d"
```

> **Why this sat unticked for 30 days:** no audit missed it — `reference/SIGNING.md`, `ARCHITECTURE.md:112`
> and `PILOT-CHECKLIST.md` all name it. Audits scope to *running code*, and custody is an action in the
> physical world with no line of code to point at, so nothing could ever go red. A checkbox does not enforce
> anything. If this regresses, the fix is a gate in `release.sh`, not a louder warning.

> `ARCHITECTURE.md:112` carries the same warning for the keystore; this is the operational checklist for it.

## Channels

- **Web (always latest):** https://trinityone.pages.dev — the production apex. Each deploy also gets an immutable `https://<hash>.trinityone.pages.dev` preview URL; **don't test on those**, they're frozen snapshots.
- **APKs:** the gateway funnel `…/apks.html` (member APK is too big for Pages); the steward APK also rides on Pages for the "Start a church" CTA.
