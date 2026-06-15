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

## Channels

- **Web (always latest):** https://trinityone.pages.dev — the production apex. Each deploy also gets an immutable `https://<hash>.trinityone.pages.dev` preview URL; **don't test on those**, they're frozen snapshots.
- **APKs:** the gateway funnel `…/apks.html` (member APK is too big for Pages); the steward APK also rides on Pages for the "Start a church" CTA.
