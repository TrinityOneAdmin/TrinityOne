# Making the console's Settings compact in a browser

**Status:** plan. Nothing changed yet.
**Asked for:** *"the stewards console settings is still really bulky in browser, I'd like it more compact…
should just be a bit of css."*

Mostly right — four of the five changes below are CSS or markup. One is not, and it is the single
biggest win, so it is called out rather than smuggled in.

---

## 1. Measured, not guessed

Driven in a real headless Chromium at **1280 × 713** against the console served from this box
(`/steward.html`), church restored so every panel had real content. Not the APK WebView — that was
measured first and is a different surface.

| Section | Content height | Screens to read it |
|---|---|---|
| Church | 1219px | 1.9 |
| **Features** | **1599px** | **2.5** |
| Network & relays | 1242px | 1.9 |
| Security | 1364px | 2.1 |

**Every section is about two screenfuls.** Nothing in Settings fits on one.

The frame:

| | |
|---|---|
| Viewport | 1280px |
| Content container | 1033px used, `max-width: 1120px` |
| **Unused width** | **~247px** |
| Layout | 2 columns × 480.5px, `gap: 16px` |
| Scroller padding | 28px |

And the repeating parts, measured inside the panels:

- a **toggle row is 79px** — title on one line, explanation stacked beneath it
- an **explanatory paragraph is 78px**, always visible, never collapsed
- each field carries its **own 44px Save button** (four across Settings)
- Features alone holds **11 toggles**

## 2. What is actually making it tall

The page is a phone layout widened by adding a second column. Inside each column everything is still
stacked vertically — label above description above control — so a 480px-wide card is 700-1400px tall
while 247px of screen width sits empty beside it.

Nothing here is a bug. It is a mobile-first layout that was never given a desktop pass.

## 3. The changes, biggest win first

### A. Lay rows out sideways when there is room — CSS

At ≥1024px, a settings row should be **label and description on the left, control on the right**,
instead of three stacked blocks. A 79px toggle row becomes ~48px; a 78px paragraph stops owning a
full-width band of its own.

Applies to roughly 11 toggles plus every labelled field. **This alone should take ~30% off each
section.** One media query and a flex direction, guarded so the phone layout is untouched.

### B. Stop giving every field its own Save button — NOT CSS

Four 44px buttons, each with its own gap, and each one a decision the steward has to make. Two ways:

1. **Save on blur**, with the existing "✓ Saved" flash as confirmation, or
2. **one Save per panel**, enabled only when something in it changed.

I would take (1): it removes the button entirely and matches the toggles, which already save
themselves the moment they are flipped. It is a behaviour change and needs its own test — a field
that silently fails to save is worse than a button nobody liked.

### C. Demote the explanations — CSS/markup

78px paragraphs at 13px, permanently on screen, next to a control most stewards understand after the
first read. Make them 12px secondary text on one or two lines, and let the long form live in a
`title` — the copy stays, it just stops setting the height of the page.

**Not** to be hidden behind a click. This console explains consequences rather than prescribing
policy, and that is deliberate; the words stay, the whitespace goes.

### D. Use the width — CSS

`max-width: 1120px` against a 1280px viewport leaves 247px unused, and the two 480px columns are
narrow enough to force wrapping inside every row. Raising the cap to ~1280px and letting the columns
breathe to ~560px makes A far more effective, because a sideways row needs somewhere to put the
control.

### E. Trim the frame — CSS

28px scroller padding → 20px, grid gap 16px → 12px. Worth ~40px per section. Do it last: it is the
smallest win and the easiest to overdo.

## 4. What this should get to

A and D together should take each section from ~2 screens to ~1.2. Adding B and C should land every
section at **roughly one screen**, which is the actual goal — a steward should be able to see a whole
section without scrolling.

## 5. Risks

**The phone must not regress.** Every change here is desktop-side, and the console ships in its own
APK where the current stacked layout is correct. Each rule goes behind a `min-width` guard, and the
APK gets checked on the Oppo before merge (CLAUDE.md rule 6).

**Density can cost legibility.** The contrast floors in `console-ink-colours-are-covered.test.mjs`
are not negotiable — that test renders the real card and measures it, and it already caught two
regressions this week. Smaller secondary text must stay above the floor, and tapping stays comfortable.

**B can lose a save silently.** Save-on-blur must surface a failure as loudly as the button did.
The publish path already raises `steward-publish-error`; the row has to show it.

## 6. Order

1. **D** then **A** — pure layout, no behaviour, biggest effect. Measure again after.
2. **C** — copy demotion, once the rows have shape.
3. **E** — final trim, only if still needed.
4. **B** — separately, with its own tests, because it is the only behavioural change here.

Steps 1-3 are the "bit of CSS". Step 4 is a small feature.
