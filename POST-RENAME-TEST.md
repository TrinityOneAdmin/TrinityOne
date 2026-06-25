# TrinityOne — post-rename test checklist

*Generated 2026-06-23. Focus: confirm the `lumen-bible → TrinityOne` directory rename didn't break anything, plus device-validate the recent feature work that's only had headless smoke tests so far. Tick items as you go.*

**Out of scope on purpose:** the Blossom branch (Phase 1+2 censorship-resistance) — that's on `claude/blossom`, not yet merged to main, so its checks belong to a separate session.

---

## A. Rename essentials *(must pass — proves the move worked)*

- [ ] **Public Tailscale URL still serves.** `curl -I https://trinityone.tailbeaac0.ts.net/` returns `200`.
- [ ] **Cloudflare Pages still serves.** `https://trinityone.pages.dev/welcome` loads.
- [ ] **Gateway active under new path.** `systemctl --user is-active trinity-gateway` → `active`, and `systemctl --user cat trinity-gateway | grep WorkingDirectory` shows `/mnt/storage/projects/TrinityOne`.
- [ ] **Gateway survives a reboot** *(only if you're rebooting the box anyway)* — `sudo reboot`, then after login: `systemctl --user is-active trinity-gateway` → `active`. The reboot is the real test that systemd lingering + the new path stuck.
- [ ] **Nostr `/relay` answers.** From the box: `wscat -c wss://trinityone.tailbeaac0.ts.net/relay` should connect; from the member app, sending a chat message should appear immediately.
- [ ] **Git push works from this box.** `git push origin main` succeeds (will push commit `a7899a4` — the systemd-template path fix).
- [ ] **`release.sh --dry` passes** *(after committing the Manna WIP, or stashing it)*: `bash scripts/release.sh --dry` ends with "release complete (dry run — nothing changed)".

---

## B. Member app *(recent work needing real-device validation)*

Install `trinityone.apk` from `https://trinityone.tailbeaac0.ts.net/apks.html` (current build: versionCode 90).

### Reader
- [ ] **Header chapter pill drops a chapter/verse menu.** In the Bible reader, tap the chapter number next to the book name → compact grid with CHAPTER row + VERSE row. Picking a chapter highlights it; picking a verse jumps to it and closes the menu.
- [ ] **Book button still opens the full picker.** Tap the book name → full book picker (Old Testament + New Testament sections).
- [ ] **Strong's tap on a verse → word study opens.** Verse with Strong's superscripts (e.g. John 1) → tap a number → bottom sheet with lemma, definition, derivation, KJV usage.
- [ ] **Derivation links are tappable.** In the word-study sheet's *Derivation* line, a `G####` or `H####` reference (e.g. G3956 in πανοπλία) is clay-coloured and underlined → tapping it loads that entry.
- [ ] **Back nav in word study.** After tapping a derivation link, a `‹` back chevron appears top-left → tap it → returns to the previous definition. Disappears at the original entry.

### Library / Dictionaries
- [ ] **Three dictionaries listed.** Library → Get Modules → Dictionaries & Lexicons shows: Strong's (installed), Abbott-Smith (Get button), BDB (Get button), then the Import row.
- [ ] **Install Abbott-Smith.** Tap **Get** on Abbott-Smith Greek Lexicon → spinner → ✓ Installed. ~4 MB download.
- [ ] **Tap a Greek word — uses Abbott-Smith now.** Open a Greek-tagged verse (any NT verse in KJV+S) → tap a Strong's number → definition body is now richer (Abbott-Smith's longer entry, not just Strong's gloss).
- [ ] **Install BDB.** Same flow for the Hebrew lexicon, then tap a Hebrew Strong's in any OT verse to confirm.

### Community
- [ ] **Church header pill is slim.** Community top: single-line pill with church badge + name + ▾ chevron (not a tall two-line card).
- [ ] **Groups sectioned by category if categories exist.** If you've created categories in the steward console (see section C), groups appear under the category headings here; uncategorised ones fall into "Other groups."

---

## C. Steward console *(recent work)*

Open `https://trinityone.tailbeaac0.ts.net/steward.html` in a browser (or the steward APK).

- [ ] **Steward console boots without JS errors.** DevTools console clean.
- [ ] **Groups → "Categories" button.** Groups, teams & rooms panel header has a **Categories** button next to **+ New group**.
- [ ] **Add a category.** Click Categories → type "Lifegroups" → Add. Appears in the list.
- [ ] **Rename + reorder.** Tap the pen icon to rename, ▲/▼ to reorder. Both work.
- [ ] **Assign a group to a category.** On a non-team group row, the new category dropdown (right side of the row) shows the category options → pick one → group's category updates.
- [ ] **Cross-check from the member app.** Member app → Community → groups now appear under "Lifegroups" heading.
- [ ] **Delete a category — groups become uncategorised.** Trash icon → confirmation says "This will move N groups to no category" → confirm → groups still exist, now uncategorised.

---

## D. Marketing site *(public-facing recent changes)*

Open `https://trinityone.pages.dev/welcome` in a browser.

- [ ] **Hero scripture is Acts 4:32 KJV.** *"And the multitude of them that believed were of one heart and of one soul…"* with "**one heart and of one soul**" highlighted gold. Cite reads "Acts 4:32 · King James Version".
- [ ] **Sanctuary photo behind the hero.** Cambridge sanctuary with stained-glass windows visible behind the gold-accented text (not flat dark).
- [ ] **Final CTA is KJV.** *"The kingdom of God is within you"* (not "among you"), reference: Luke 17:21.
- [ ] **Footer scripture is KJV.** *"Where the Spirit of the Lord is, there is liberty"* (not "freedom").
- [ ] **Support section has two cards.** **Share** (existing) + **Open source** (new) side-by-side. The Open-source card has a "View on GitHub" button + "Source under AGPL-3.0 · Report an issue" beneath.
- [ ] **Install-anywhere page reachable.** Footer's App column has "Install from any church" → opens `/install-anywhere`. The small "Site hard to reach?" line under the install CTA also links there.
- [ ] **Contact links.** Footer "Email us" mailto → `hello@trinityone.church`. *(Note: that mailbox only routes once you've set up email forwarding at Namecheap/Cloudflare — bouncing right now is expected.)*

---

## E. Pilot-readiness items *(carried over — still relevant)*

These are from `PILOT-READINESS.md` and weren't tied to the rename, but worth re-verifying since you'll be on a device anyway:

- [ ] **Member onboarding → follow church → see groups → chat works.** Full first-launch flow on a fresh install.
- [ ] **Steward PIN-approve a new steward invite.** Settings → Stewards → invite QR → approve from another device.
- [ ] **Photo upload (in a photo-enabled church).** An adult member can upload + crop a photo. A child has no Photo tab.
- [ ] **Steward "Turn off photo" moderation.** A steward can reset a member's photo; the reset shows on a second device.
- [ ] **Finance Gift Aid toggle.** Off → generic Donors/Funds tiles. On → UK Gift Aid flow appears.

---

## F. Push pipeline *(if you want to ship the rename-fix commit)*

- [ ] **Push the rename-fix commit.** `git push origin main` lands `a7899a4` ("Repo move: rename …") on TrinityOneAdmin.
- [ ] **Confirm public repo is at the new HEAD.** Visit `https://github.com/TrinityOneAdmin/TrinityOne/commits/main` — top commit is the rename one, authored by **TrinityOneAdmin** (not swasb-altFreeBird).

---

## G. Release pipeline *(optional — only if you want to cut a release tomorrow)*

- [ ] **Full release dry-run.** `bash scripts/release.sh --dry` lists every step (no APK rebuild step changed from rename; just confirming the orchestrator still wires together).
- [ ] **Real release.** `bash scripts/release.sh` — bumps SW cache, deploys Pages, rebuilds both APKs, refreshes apks.html, restarts gateway. Then install the new APK on a device and confirm versionCode bumped.

---

## What "good" looks like

If A passes, the rename is unequivocally fine. B–E are about recent feature work that's only had headless/Node-level testing so far — these are the items where surfacing a bug on a real device actually catches something.

If anything fails, ping me with the symptom + which item — fixes are quick from there.
