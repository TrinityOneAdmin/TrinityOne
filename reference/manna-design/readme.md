# TrinityOne — Halo design system

The visual language of **TrinityOne (T1)** — a sovereign, warm, un-clinical platform for churches — and its mutual-aid module **Manna**. T1's design language is named **Halo**. Everything renders inside one of two shells: the **member app** (`PhoneFrame`) and the **Steward Console** (`ConsoleChrome`), both on a warm `--paper` canvas.

**The product on screen is Manna, not TrinityOne.** The visible brand is the **Manna** wordmark (Sora 800) beside the ring mark, with a quiet **"by TrinityOne"** attribution underneath — TrinityOne is the platform lineage, never the headline. Do not put the TrinityOne wordmark on Manna screens.

## Sources

This system was reconstructed from the **Manna Experience Brief (annotated)** at `uploads/Manna_Experience_Brief.annotated.md` — specifically its embedded *TrinityOne UI cheat-sheet* (real Halo tokens, component names, and icon names pulled from the live T1 clone).

> ⚠ **The actual T1 codebase was not available** (`brand.css`, `ui.jsx`, `stew-console.jsx`, `screens-giving.jsx`, `stew-custody.jsx`, `icons.jsx`, …). Tokens are exact (from the cheat-sheet); **components, icons, and the Halo mark are faithful reconstructions** from descriptions, not copies of the originals. When the repo is attached, reconcile: real icon path data → `components/icons/Icon.jsx`; the official `<Halo/>` mark → `components/icons/Halo.jsx`; and the real component markup/props.

> ✅ **Reconciliation note (this import):** the live T1 repo *was* attached. Its `brand.css` matches these tokens **exactly** — `--clay`, `--paper`, `--midnight`, `--sage`, `--gold`, `--clay-soft`, `--gold-tint`, `--shadow-*`, `--ease`, and `--font-display`/`--font-ui: 'Sora'` all exist verbatim. So the screens implement against the real tokens with no palette remap. The app's real `Icon`/`Halo`/`Panel` components are used in the in-app implementation (`stew-manna.jsx`); the inlined copies here are demo-only.

---

## CONTENT FUNDAMENTALS

**Voice: pastoral, plain, unhurried.** Liturgical calm over startup energy. The copy's job is to make a person feel *known and loved*, never *assessed*.

- **Plain nouns only.** Use **help · give · gift · fund · donor · walk with**. **Never** "disbursement · beneficiary · claim · application · eligibility · approved/denied · transaction." Aid is not a loan decision rendered on a human being.
- **Person, second-person, warm.** "Good morning, Ruth." "It's yours — take it." "I'll walk with this person." Address the human directly and by name where it reassures (receiver), and keep them *anonymous by default* everywhere a third party could see them.
- **Reassurance is copy, not chrome.** Security is explained gently in words: *"No one person controls this. The console asks, each guardian approves, and the secret stays on their own device."* *"No form. No reason needed. No one is told."*
- **Scripture, sparingly, in serif.** A single blessing/welcome line in Newsreader italic (`.scripture`) sets a pastoral register: *"Two are better than one…"* Never stack scripture; one line per screen at most.
- **Casing:** sentence case for body and headings; UPPERCASE only for tiny pills/labels (12px, wide tracking). **No emoji.** No exclamatory marketing tone. No anti-state slogans — show the fruit ("our church looks after its own"), never the politics.

**What must never appear:** verdict/eligibility language aimed at a person · worthiness scores or spending surveillance · leaderboards comparing recipients · public exposure of who received · charity-pity imagery or donor-wall gamification · crypto vibe (neon, tickers, "number go up").

---

## VISUAL FOUNDATIONS

See `tokens/` for the exact values. Palette: warm sovereign canvas — `--paper`/`--surface` neutrals carry everything; `--clay` is the single human action per screen; `--gold` a rationed spark; `--sage` success-only; `--midnight` for gravity. Type: **Sora** for all UI, **Newsreader** italic for scripture (`.scripture`). Generous radii, soft warm layered shadows, one signature `--ease`.

## INDEX / manifest

- **`styles.css`** — global entry point (link this one file). `@import`s everything in `tokens/`.
- **`tokens/`** — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`.
- **`ui_kits/manna/index.html`** — the self-contained interactive demo (six screens).

In the live repo these tokens are already present as `brand.css`; this `reference/manna-design/` copy is the design source + runnable demo, kept for reconciliation.
