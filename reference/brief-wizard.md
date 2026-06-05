# Design brief — TrinityOne first-run Setup Wizard

**For:** Claude Design. **Re:** stitch the first-run experience into one cohesive, guided
**setup wizard**, and design the few screens that don't exist yet.

## Important — what you've ALREADY delivered (don't redo)
The latest handoff already includes most of the pieces. Reuse them; this brief is about
**connecting them into one flow + filling gaps**:
- `IdentityOnboarding` (identity.jsx) — choose name + avatar (the `AvatarPicker` symbol/initial). ✅
- `BackupWalkthrough` (screens-help-main.jsx) — the guided "write your 12 words" + verify check. ✅
- `BackupNudge` (screens-help-main.jsx) — gentle later prompt to back up. ✅
- Boot **splash** (logo reveal) runs first, then the wizard. ✅

## The job: one cohesive wizard
Right now these are separate moments. Design a single, oriented first-run flow that a
**non-technical, elderly** user can complete unaided (the whole project's success metric is
"can a grandparent do it"). Halo brand; large type; big targets; calm, warm, reassuring.

Proposed flow (refine as you see fit), with clear progress/orientation throughout:
1. **Welcome** *(gap — design this)* — after the splash. Warm one-liner + a clear fork:
   - **"I'm new here"** → continues to step 2.
   - **"I've used TrinityOne before"** → goes to **Restore** (step 5). Returning users on a new
     phone must find this immediately — today restore is buried.
2. **Choose your identity** — the existing `IdentityOnboarding` (name + avatar), in-flow.
3. **Back up your 12 words** — the existing `BackupWalkthrough`, as a step in the wizard (not
   only a later nudge). Skippable, but the `BackupNudge` remains the safety net if skipped.
4. **Join your church** *(gap — design this; optional step)* — the **steward-QR onboarding**:
   "Were you given a QR code by a church leader? Scan it." → camera scan → success; or
   "I'll do this later." (This is the gentlest path for the least technical members.)
5. **Done** — you're set; one clear next action (Start reading / Find help).

## Gaps to design specifically
- **Welcome / new-vs-restore fork** (step 1).
- **Restore on a new phone** (step 5 / from welcome) — a gentle screen to enter the 12 words
  (large field, paste, and ideally **scan a steward QR** as an alternative to typing). Include
  the "invalid phrase, try again" state, kindly worded.
- **Steward-QR onboarding** (step 4) — the camera-permission ask (plain-language reason),
  the scan UI, and the success state. Also design the **steward's** side: how a leader
  generates and presents the invite QR to hand over (this exists functionally; needs a screen).
- **Orientation** — a simple progress indicator / step labels so users know where they are and
  that it's nearly done.
- **Edge/empty states** — camera denied (fall back to paste), back-navigation, and the fact
  that setup works fully **offline** (no "connecting…" dead-ends).
- **Accessibility carried through** — large type, big targets; consider a **read-aloud** option
  on the wizard (you already built read-aloud for Help — reuse the pattern if it fits).

## Open questions for you
- **Backup: mandatory or skippable?** Recommend a stance — block until backed up (safest, but
  more friction for the elderly) vs. allow skip + persistent nudge (current design). 
- **Steward QR for restore too?** Should "Restore" accept a scanned QR as well as typed words?
- **How prominent is "Restore" on Welcome** — equal billing with "I'm new", or a quieter link?

## Reference
- Existing components to reuse/extend: `identity.jsx` (`IdentityOnboarding`), `identity-avatar.jsx`
  (`AvatarPicker`), `screens-help-main.jsx` (`BackupWalkthrough`, `BackupNudge`).
- Brand: `reference/D _ Halo.png`, `reference/TrinityOne-design-notes.md`.
- A working basis already exists in-app (`screens-onboarding.jsx`) — your design supersedes it.
