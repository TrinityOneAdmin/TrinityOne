# TrinityOne — pilot readiness checklist

*Pre-launch go/no-go. Generated 2026-06-20 after a readiness pass. Local working doc (untracked).
Tick items as you go; re-run the green checks after any further code change.*

---

## ✅ Verified green (checked 2026-06-20)

- [x] **Production relay current + secure** — master-01 reinstalled (`a328d33`, built 2026-06-20 11:46),
      write-policy ON, **C1 signature-verify live** (relay rejects forged events: fake church posts /
      fake giving funds / event-flood eviction).
- [x] **Both apps boot clean** — `index.html` + `steward.html` headless boot with **0 JS errors** after
      all of today's edits.
- [x] **No dup-globals** — member `.jsx` have no duplicate top-level names (the footgun that silently
      blanks the APK).
- [x] **New-feature default paths don't regress the common case:**
      - Member photos: a church that hasn't enabled them shows the normal symbol/initial picker (no
        Photo tab) — `identity-avatar.jsx` `allowPhoto` gate.
      - Reset-photo moderation: `displayFor`/`_avSuppressPhoto` returns avatars unchanged for anyone not
        on the suppression list.
      - Finance generic: default (Gift Aid off) → generic Donors/Funds tiles; UK pilot (Gift Aid on) →
        full Gift Aid flow; currency-safe (`finMoney`).
- [x] **First-launch onboarding gate intact** — `trinityone.onboarded` still gates the wizard; fresh
      client sees onboarding.
- [x] **Web deployed + current** (Cloudflare Pages); **APKs rebuilt today** — `trinityone.apk` (member)
      + `trinityone-steward.apk` (steward), **v0.9.3 / versionCode 83**, carrying photos + moderation +
      nationality-agnostic finance.

## ⚠️ Owner actions before launch

- [ ] **Wipe master-01 test data** — it still holds **3 churches + 1 member** (the 2026-06-18 purge only
      cleared the dev box). Reset it the same way before real members join.
- [ ] **Confirm pilot devices have today's APKs** (v0.9.3 / 83). If installed earlier, reinstall from the
      fresh `trinityone.apk` / `trinityone-steward.apk` so they get photos + moderation + generic finance.
- [x] **`claude/release-schedule` — RESOLVED (nothing to merge).** All its features (release
      scheduling/drip, draft staging, join-push to phone, directory hide-me, resilient subs, audio,
      member directory) are **already in current main and deployed** — confirmed by code presence
      2026-06-20. The branch only looks "224 ahead" because the OSS orphan-rebuild severed shared
      history (no merge base); its content was already merged before the rebuild. **Do not merge it**
      (unrelated histories = conflict mess + possible regression). Leave as dead history or delete the
      branch. *Bonus:* join-push (`maybePushJoin`) is in main + now on master-01 (reinstalled
      `a328d33`), so phone push for new joins is live in production.

## 🔍 Needs a device run-through (can't be verified headless)

On the real APK with a **fresh test church**:

- [ ] **Member journey:** onboarding → follow church → see groups → chat → Bible works offline → back up
      the 12 words.
- [ ] **Steward journey:** set up church → invite a steward → **PIN-approve** → create a group → post a
      devotional → Members panel.
- [ ] **Member photos:** an adult in a photos-enabled church can upload + crop a photo; a **child has no
      Photo tab**.
- [ ] **Reset-photo moderation:** steward "Turn off photo" on a member → their picture reverts to a
      symbol **on a second device**, and that member can no longer set a new one until re-allowed.
- [ ] **Finance:** toggle Gift Aid OFF (generic Donors/Funds, no HMRC) vs ON (UK Gift Aid flow returns).

---

## Notes / context

- **Relay deploy command** (if master-01 ever needs the latest again):
  `curl -fsSL https://trinityone.tailbeaac0.ts.net/relay-app/install.sh | sudo bash`
- **Release command** (web + APK, refuses a dirty tree): `bash scripts/release.sh`
- **Pilot scope** (memory `pilot-scope-2026-06`): delegated stewards shipped; Finance optional/in-pilot;
  Lightning giving + Keykeeper = roadmap; multi-church custody parked.
- **Post-pilot, parked on `claude/plugins`:** the add-on/plugin model (Treasury, tax packs, livestream,
  calls, forms, ticketing), the Cornerstone hardware box, entitlement/licensing design. Not for the pilot.
- If a device run-through surfaces a bug, capture the symptom + which journey — fixes are quick from there.
