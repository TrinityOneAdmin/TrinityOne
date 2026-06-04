# Design brief — TrinityOne Identity & Profile

**For:** Claude Design. **Re:** how a user's public "identity" is set up, surfaced, and viewed.
This bolts onto the existing, working TrinityOne app (Capacitor, "Halo" design language —
warm cream/clay editorial; Bricolage Grotesque display, Newsreader serif, Plus Jakarta Sans
UI; tokens `--paper/--surface/--ink/--clay/--gold/--sage`). Recreate visuals on-brand; the
data layer already exists.

## The identity model (please internalise — it shapes the UX)
- **No account, no login, no email/phone.** Each user is a self-custodial key on their device
  (Nostr). There is no central user database.
- **"Anonymous" here means "no personal data," not "faceless."** A user picks a **display name**
  and an **avatar**; those are public and how the church recognises them. So the real model is
  **pseudonymous**, and that's good.
- Identity already supports, in code: a display **name**, an **avatar**, a public key (`npub`),
  a **12-word recovery phrase**, **restore from phrase**, and a **steward QR invite**.

## Decisions already made (design to these)
1. **Lead with "anonymous, optional name."** Privacy is the promise (no email/phone), but the
   expected path is that **most people set a name** — so naming should feel like the default,
   gentle step, not a hidden power-user feature. (Today it's buried in a Chat sub-sheet and
   users don't realise it's "their username" — that's the core problem to fix.)
2. **No photo uploads.** Avatars are **either initials** (colored monogram, exists today) **or a
   pick from a gallery of preset vector graphics.** No camera-roll upload, no image hosting, no
   faces / no PII.

## What to design
1. **First-run identity moment.** A gentle onboarding step: "Pick a name your church will see
   (or stay anonymous)" + choose an avatar. Skippable → stays the anonymous monogram. Should
   feel warm and 2-tap simple (a 70-year-old must manage it unaided).
2. **A discoverable "you" entry point.** A persistent, obvious affordance — e.g. the user's
   avatar in a consistent spot (proposed: top-right of the **Today** screen) — that opens the
   profile. Right now the only entry is a Chat banner labelled "tap to manage," which reads as
   relay settings, not "your username." Make "this is **you**" unmistakable.
3. **Profile screen/sheet (reorganised).** One clear place to: set/change **display name**,
   choose **avatar**, and — secondary/utility — see `npub` (copy), **back up recovery phrase**,
   **restore**, **steward invite QR**, **new identity**. Lead with name+avatar; tuck the
   key-management under a "Security / recovery" group so it doesn't dominate.
4. **Avatar picker.** The hero of the profile. Two sources:
   - **Monogram** — initial + a palette of brand colors (clay/sage/gold/etc.).
   - **Vector gallery** — a grid of preset marks the user can choose from (see open question).
5. **"View a member" card.** Tapping someone's name/avatar in chat opens a small card: their
   avatar, display name, "anonymous · TrinityOne member" line, and (nice-to-have) a short bio
   and their recent shared verses. No personal data, by design.

## Constraints
- On-brand Halo; works offline; warm/editorial, not corporate.
- The privacy promise stays literally true: **never** ask for or imply email/phone/real name.
- Avatars = monogram or vector preset only. No uploads.
- Tone: gentle, inviting, low-friction; readable for older, non-technical congregants.

## Open question for you (Claude Design)
The user asked: **could the avatar presets be a set of vector "saints"?** Please explore — but
weigh the nuance: TrinityOne's pilot is a **Protestant** church (Littlehampton), where literal
saint iconography may feel off or even contentious across traditions. Options to consider and
mock up a couple of:
- A set of **Christian/nature symbol** marks (dove, fish, lamp/flame, vine, wheat, anchor,
  shepherd's crook, bread & cup, olive branch, mountain, well, star) — universal, warm, Halo-styled.
- **Abstract Halo-derived marks** (variations on the ring + spark) in different colors.
- The **"saints" idea** itself, if you can do it tastefully and non-denominationally (e.g.
  stylised, symbolic, not venerative).
Recommend a direction + show ~8–12 avatar options in your pick.

## Reference
- Working app + tokens: `/mnt/storage/projects/lumen-bible` (engine.js, app.jsx, screens-*.jsx).
- Brand: `reference/D _ Halo.png`, `reference/TrinityOne-design-notes.md`, latest handoff in
  `reference/TrinityOne-handoff.zip`.
- Existing identity UI to evolve: the Chat-tab "tap to manage" sheet (`NostrSheet` in
  `screens-chat.jsx`).
