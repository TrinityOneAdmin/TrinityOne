# Design brief — TrinityOne pitch deck (8 slides)

*A short, broad-strokes deck to hand a church leadership team or an interested group. In a few
slides they should "get it": what TrinityOne is, why it's different, what it does, and how to start.*

---

## 1. The ask

- **Format:** 8-slide presentation, 16:9, PowerPoint/Keynote style (one big idea per slide, not dense).
- **Deliverable:** editable deck (PPTX or Google Slides) **plus** a PDF export. Use real, selectable text — not images of text.
- **Audience:** church leaders, pastors, elders, trustees — and the curious non-technical helper who ends up running it. Assume **little tech knowledge**; assume they **do** care about cost, privacy, safeguarding, and not being locked in.
- **Goal:** they finish the 8 slides able to explain TrinityOne to someone else in two sentences, and know the one action to take next.
- **Tone:** warm, calm, confident, pastoral — not salesy, not "startup". Think a well-made church welcome booklet, not a SaaS deck. Plain language; gloss any unavoidable term.

## 2. What TrinityOne is (so the designer has the gist)

An offline-first **Bible app** and a **private community for a church** — fellowship chat, serving rotas, a shared calendar, safeguarding, and optional giving records — built on **open protocols** with **self-custodial keys**. No accounts, no email, no central company. A church can even run it on its own hardware. It's free and open-source (AGPL), and it stays that way.

**The core idea in one line:** *Not a platform. A protocol. Owned by the church, captured by no one.*

## 3. Positioning lines (use these verbatim — they're the established voice)

- **Hero / essence:** "Tend your flock on ground you own." (alt: "Don't build your church on ground you don't own.")
- **Category:** "Not a platform. A protocol."
- **Footer/value:** "Made for the church, owned by no one."
- **Rhythm of the app:** "Read · Gather · Share."
- Avoid: jargon (Nostr/relay/keys) on headline slides — it can appear once, gently explained, on the "how it works" beat. Keep the deck nation-neutral: **no country-specific tax/giving terms** (no Gift Aid/HMRC/£ — say "giving records & year-end statements").

---

## 4. Brand system (match the product exactly)

**Palette (hex):**
| Role | Token | Hex |
|---|---|---|
| Paper (bg) | paper | `#F4EEE2` |
| Paper soft | paper-soft | `#FBF6EC` |
| Surface (cards) | surface | `#FFFDF8` |
| Ink (text) | ink | `#221C16` |
| Ink soft | ink-2 | `#6B6052` |
| **Clay (PRIMARY)** | clay | `#C25A38` |
| Clay deep | clay-deep | `#9C4327` |
| **Gold (SPARK)** | gold | `#C8962E` / soft `#E0B860` |
| **Sage (success)** | sage | `#5E8C6A` |
| Midnight (dark) | midnight | `#17120B` |

**Colour discipline (important):** Clay is the primary/brand colour (CTAs, the wordmark "One"). Gold is a *spark* — the Halo's centre light and rare accents, used sparingly. Sage is functional (success/giving), never decorative. Backgrounds are warm paper, never stark white. Dark slides use Midnight, not black.

**Type:**
- Display & UI: **Sora** (700–800 for headlines, tight letter-spacing).
- Long-form / scripture / warm body: **Newsreader** (serif) — use for any quoted scripture or reflective lines.

**The mark — "The Halo":** a clay rounded-square tile, a broken cream halo ring, and a single gold spark dot at the centre. The wordmark is "Trinity" + **"One"** in clay. (Asset: the SVG `#to-mark` / `#to-halo` lives in the repo `welcome.html`; an app icon exists too — request these.)

**Motifs to draw from:** the warm paper texture, soft rounded cards with gentle shadows, the Halo ring, occasional understated line-icons (dove, wheat, flame, olive branch, anchor) — quiet, not clip-arty. Real product screenshots may be supplied later; for now, clean mockup-style cards are fine.

---

## 5. The 8 slides

> Each slide below: **purpose → headline → supporting copy → visual direction.** Keep words few; let the design and one image carry each slide.

**Slide 1 — Cover**
- *Purpose:* set the tone and the one idea.
- *Headline:* **TrinityOne** + "Tend your flock on ground you own."
- *Copy:* one quiet sub-line: "A church's whole life — Scripture, fellowship and care — on infrastructure you own, not a platform you rent."
- *Visual:* the Halo mark large; warm paper; a faint scripture or congregation image behind a soft scrim. Minimal.

**Slide 2 — The problem**
- *Purpose:* name the pain without bashing.
- *Headline:* "Your church shouldn't live on someone else's platform."
- *Copy:* three short points — *charged for the tools · the data mined · the rules can change overnight.* Today churches are scattered across a dozen apps that each want a cut.
- *Visual:* a gentle "scattered logos / tangle" metaphor vs. one calm home; or three muted pain-point cards.

**Slide 3 — The idea**
- *Purpose:* the reframe — the memorable beat.
- *Headline:* **"Not a platform. A protocol."**
- *Copy:* "Like email or the web — a shared, open standard *anyone* can run. You hold the keys. No company in the middle." End line: *Owned by the church, captured by no one.*
- *Visual:* the established **platform-vs-protocol contrast** (two columns: "Something you join ✕" vs "Something you run ✓"). This is the conceptual heart of the deck.

**Slide 4 — What it is, in one app**
- *Purpose:* the product overview at a glance.
- *Headline:* "Everything a life of faith needs, in one place." (rhythm: **Read · Gather · Share**)
- *Copy:* three pillars — **Read** (a whole offline Bible) · **Gather** (your church, privately) · **Share** (encouragement, serving, giving).
- *Visual:* three warm pillar cards with a line-icon each; or a single phone showing the app.

**Slide 5 — Features at a glance**
- *Purpose:* breadth, broad strokes — not a manual.
- *Headline:* "One home for the whole church."
- *Copy:* 6 tiles, a few words each: **Offline Bible** (1,000+ translations) · **Fellowship chat** (groups, prayer, encouragement) · **Serving & calendar** (rotas, events, RSVP) · **Safeguarding** (children protected, leaders in control) · **Giving records** (optional treasurer's tools) · **Your own relay** (self-host it).
- *Visual:* a clean 2×3 grid of icon tiles. Consistent, calm.

**Slide 6 — Safe & private by design**
- *Purpose:* the trust slide — often the decider for churches.
- *Headline:* "No accounts. No data mined. Children protected."
- *Copy:* three points — *No email or phone number — just a name your church knows · Private messages stay private; safeguarding is built in and enforced for the under-18s · Your church's data lives on your hardware, not a company's.*
- *Visual:* a shield/Halo motif; warm, reassuring, not techy.

**Slide 7 — Own it. And it's free.**
- *Purpose:* remove the two big frictions — lock-in and cost.
- *Headline:* "Yours to keep — and free, for good."
- *Copy:* *Open-source (AGPL) · Run it yourself on a small, low-cost computer, or just use the app · Walk away anytime with all your data · No subscription, no "free trial that ends" — free is the model, not a teaser.*
- *Visual:* a small relay device (Raspberry-Pi-ish) or an open-padlock/key motif; one bold "Always free" callout.

**Slide 8 — Start your church**
- *Purpose:* one clear next step.
- *Headline:* "Bring your whole church on — in an afternoon."
- *Copy:* steps in brief: *1. Start a church (free) · 2. Share a joining code · 3. Your people are in.* Then the links.
- *CTA + contact:* **trinityone.pages.dev** · "Start a church — free" · Contact: **31app@proton.me**
- *Visual:* the Halo mark; a QR code placeholder (to `welcome-churches.html`); warm, inviting close. End line: *Made for the church, owned by no one.*

---

## 6. Practical notes

- **Slide master:** build a reusable master (paper background, Sora headings, clay accent, a footer with the small Halo + "TrinityOne"). Consistent margins; generous whitespace.
- **Density:** headline + ≤3 supporting points per slide. If a slide needs a paragraph, it's too much — cut it.
- **Accessibility:** body text ≥ 18pt on screen; check clay-on-paper and any text-on-image contrast (use scrims on photos).
- **Imagery:** warm, human, real church life where possible; avoid stocky/corporate or techy server-room clichés. Screenshots of the app may be provided — leave neat placeholders sized for a phone frame.
- **What NOT to do:** no stark white, no neon, no startup-deck hockey-stick charts, no jargon on headlines, no country-specific tax language, no claims that aren't true today (Lightning giving is roadmap — only mention as "coming soon" if at all).

## 7. Source material the designer can pull from

- Live site for voice, layout and the exact look: `welcome.html` (main), `welcome-churches.html` (church-facing), `features.html` (the deep dive — good for slide 5 wording).
- Brand tokens: `brand.css`. The mark/Halo SVG: search `#to-mark` / `#to-halo` in `welcome.html`. App icon assets exist in the repo (`/icon` / Capacitor resources) — request if needed.
- One-line product summary and feature list: `README.md`.
