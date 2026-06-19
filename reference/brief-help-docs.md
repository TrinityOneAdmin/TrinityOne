# Design brief — TrinityOne Help / Setup guides

**For:** Claude Design. **Re:** lay out a help/setup guide system, focused on **securing the
account (the self-custodial key/recovery phrase) and the giving wallet**. Content is written
and provided — **your job is the layout, visual treatment, navigation, and accessibility.**

- **Content (source of truth):** `reference/help-content.md` — 7 short articles + a printable
  quick-reference card. Use this copy; you may regroup/retitle for layout, but don't change the
  safety meaning. If you think a point needs different wording for clarity, flag it.
- **Brand:** "Halo" design language (warm cream/clay editorial; Bricolage Grotesque display,
  Newsreader serif, Plus Jakarta Sans UI; tokens `--paper/--ink/--clay/--gold/--sage`). See
  `reference/D _ Halo.png`, `reference/TrinityOne-design-notes.md`.

## The #1 constraint: elderly, non-technical readers
Design for someone in their 70s–80s who finds most apps confusing. This drives everything:
- **Large, high-contrast type** with comfortable line spacing; an obvious **"larger text"**
  option would be ideal.
- **Short chunks, lots of breathing room** — never a wall of text. One idea per screen/card.
- **Plain, calm visuals**; big tap targets; simple, linear navigation (a clear list of topics,
  easy "back"). No clever gestures.
- **Reassuring tone made visual** — friendly, not alarming, even on the safety pages.
- Gentle **icons/illustrations** that *aid understanding* (e.g. writing words on paper; a safe;
  a "no photo" mark) — not decoration.

## Two surfaces, same content
1. **Embedded on the landing page / website** (the public marketing site — you already built a
   first version: `TrinityOne Landing.html` in the handoff). The help/setup guides should be a
   section of that site, **matching its existing look** — so prospective members *and* church
   leaders can understand the privacy/security model before installing. Reassurance-forward.
2. **In-app Help section** — reachable any time inside the app (propose where it lives; at
   minimum from the identity/profile area, and surfaced during first-run setup).
Design a layout that works for both (shared article content, different surrounding chrome).
*(Note: this is the **landing page/website**, not the app's animated boot splash — the splash
is a ~2-second logo reveal and stays as-is.)*

## What to design
1. **Help index / home** — a simple, scannable list of the topics, with the **recovery-phrase**
   topic visually elevated as the hero (it's the one that must not be missed).
2. **Article template** — heading + summary + steps + Do/Don't, tuned for big readable type.
3. **The recovery-phrase guide ("Your 12 words")** — the centrepiece. Make backing up feel
   important but *doable*, not scary. Consider an **interactive "back up your phrase"
   walkthrough** (show words → "have you written them down?" → confirm), since this is the one
   action that matters most.
4. **First-run setup flow** — the welcome → pick a name (or stay anonymous) → **back up your 12
   words** moment. Gentle, 2-tap simple, skippable but with a clear nudge to do the backup.
5. **Printable quick-reference card** — a one-page handout (the card at the end of the content)
   a steward can print and give to members. Design it to print cleanly in B/W.

## Open questions for you
- **Read-aloud / audio:** would a "listen to this page" option be worth designing for, given the
  audience? If so, where does the control live?
- **Illustration style:** simple line illustrations (Halo-flavoured) vs. icon-only — recommend one.
- **Steward handout:** is the printable card enough, or design a short printable "Setting up
  TrinityOne for a member" leaflet for stewards too?
- **Site integration:** should the guides be a new page/section in the existing landing site,
  or a dedicated "Help / Get started" sub-site that links back? Recommend a structure.

## Deliverable
Mock the Help index, the article template, the recovery-phrase hero/walkthrough, the first-run
backup moment, and the printable card — on-brand, accessibility-first. Hand back and the content
+ your layout get built into the app and the landing page.
