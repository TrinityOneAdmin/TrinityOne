# Marketing site audit — 2026-08-05, read-only

Read-only pass over the served HTML at the repo root, at `a160c3e`. The brief was the owner's: *"trim it
down, have it still making clear sense, but with less bloat."* So this is a trim plan, not a list of
complaints. Nothing has been changed.

`[C]` = the reviewer read it and I have no reason to doubt it. `[S]` = suspected, needs a check.

---

## The headline

**52% of the site's prose — 7,851 of 15,102 words — is on five pages that nothing on the site links to.**
`pilot-features.html` and `how-trinityone-stays-up.html` are the two largest bodies of text on the whole
site, and both are unreachable.

The structural cause is three different navs: a 7-link nav on five pages, a 2-link nav on two, and **no nav
at all** on nine.

Site today: 17 pages, ~356 KB, 15,102 words.

---

## The map

| Page | Bytes | Words | Inbound | Job |
|---|---:|---:|---|---|
| `welcome.html` | 39,244 | 801 | nav ×5 + 3 | Home; member + leader door |
| `features.html` | 49,604 | 1,234 | nav ×5 | Feature depth, 10 sections with mock UI |
| `why.html` | 36,225 | 1,292 | nav ×5 | The persecuted-church argument |
| `welcome-churches.html` | 35,276 | 1,166 | footer ×5 + 2 | Leader door: price, relays, admin |
| `pilot-features.html` | 33,644 | **2,291** | **ORPHAN** | Plain-language inventory |
| `how-trinityone-stays-up.html` | 29,961 | **3,077** | **ORPHAN** | Resilience architecture |
| `downloads.html` | 23,948 | 344 | nav ×7 | Get the app |
| `about.html` | 21,881 | 445 | nav ×5 | Positioning + 2 PDF decks |
| `help.html` | 14,292 | 163 | nav ×4 | Renders 19 topics from `app/help-data.jsx` |
| `stewards-guide.html` | 12,657 | 940 | **ORPHAN** (zero `href`) | Delegated steward vs handoff |
| `install-anywhere.html` | 12,364 | 850 | **ORPHAN** | Install from any church's relay |
| `migrate.html` | 11,812 | 879 | welcome-churches ×2 | Move-over guide |
| `verify-a-child.html` | 11,615 | 693 | **ORPHAN** (zero `href`) | Safeguarding how-to |
| `roadmap.html` | 9,854 | 658 | 1 footer link | 13 planned modules |
| `quick-card.html` | 7,996 | 194 | help only | Printable 12-words card |
| `join.html` | 5,244 | 75 | invite URLs | Invite landing |
| `apks.html` | — | — | — | **DOES NOT EXIST** on main `[C]` |

---

## The recommended site: 17 pages → 8

1. **`welcome.html`** — what is this, is it safe, how do I join; hands leaders off
2. **`why.html`** — the conviction; protocol-not-platform lives here ONLY
3. **`welcome-churches.html`** — the leader door; absorbs `migrate.html`
4. **`features.html`** — what it does today; absorbs pilot-features' glosses
5. **`downloads.html`** — get it; absorbs `install-anywhere.html`
6. **`help.html`** — the 19 topics from `help-data.jsx`
7. **`quick-card.html`** — print-only, out of nav
8. **`join.html`** — invite landing, out of nav

**~356 KB → ~190 KB. 15,102 words → ~8,000.**

`help.html` is the model the rest should copy: **one source of truth (`app/help-data.jsx`), two surfaces**
(web + in-app). All four deleted how-to pages should have been topics in it.

---

## What to cut, ranked by removed-per-lost

| # | Action | Bytes | Words | Lost |
|---|---|---:|---:|---|
| 1 | `how-trinityone-stays-up.html` → move to `reference/` | 29,961 | 3,077 | Nothing public |
| 2 | `pilot-features.html` → harvest ~8 glosses, delete | 33,644 | 2,291 | Nothing |
| 3 | `about.html` → decks + one sentence to `why.html` | 21,881 | 445 | Nothing but the decks |
| 4 | `stewards-guide.html` + `verify-a-child.html` → 2 blocks into `help-data.jsx` | 24,272 | 1,633 | Nothing |
| 5 | `migrate.html` → `welcome-churches.html` | ~11,800 | ~530 | Nothing |
| 6 | `install-anywhere.html` → `downloads.html` | ~12,400 | ~450 | Nothing |
| 7 | `roadmap.html` → keep Keykeeper + Lightning on features | 9,854 | ~560 | 13 unbuilt entries |
| 8 | `welcome.html:335-392` (8 cards) + duplicate diagram | ~7,000 | ~350 | Nothing |
| 9 | `why.html:356-371` | ~1,500 | ~130 | Nothing |
| 10 | Link `brand.css` on the 2 surviving pages that inline it | ~5,000 | 0 | Nothing |

**~157 KB and ~9,500 words — 44% of bytes, 63% of prose.** Every item is unreachable today or a verbatim
restatement of something on a surviving page.

### Why #1 is first, and why it should MOVE not die `[C]`

`how-trinityone-stays-up.html` is unreachable, says *"Last updated 2026-06-23"* at `:325`, marks shipped
work as "Not yet merged" — **and publishes your infrastructure**. `:139-141` tables your live relay hosts
including the tailnet names; `:121` names `scripts/gateway.mjs` and its write-policy internals; `:221` names
a gitignored key file "on the release host only"; `:312` explains the deploy key.

Under a lawful-compulsion-and-seizure threat model that is a public map of where to apply pressure and which
single box is the choke point. Its 12-line glossary is genuinely good — fold "relay", "Nostr", "module" into
`help-data.jsx:303`.

---

## Said 3+ times

| Idea | Times | Canonical home |
|---|---|---|
| "Free forever, no subscription" | **7 pages** | `welcome-churches.html:204-206` (it has the £1,450/yr arithmetic) |
| "A relay is a small private server…" full gloss | **7 places** (twice on welcome alone) | `welcome.html:319` |
| "No account, no password, 12 words" | **9 pages** | `help.html` / `quick-card.html` |
| Safeguarding | 6 places | `help-data.jsx:230` (how-to), `welcome-churches` (the sell) |
| "Protocol, not platform" full comparison | 3 | `why.html:378-400` |
| Persecuted ↔ comfortable duality | 4 | `why.html` |

---

## New drift findings

**D1 — `features.html:356` claimed safety replies are "encrypted to your church".** `[C]` When written this
was FALSE: `markSafe` sealed to `check.by`, the single key that signed the check. **This is now TRUE as of
`dae79c7`** — the church key is always a reader. The marketing was accidentally describing the product we
have since built. Nothing to change; recorded because it is the exact class
`scripts/no-overclaims.test.mjs` exists to catch, on a life-safety feature, and that test does not pin it.

**D2 — `features.html:167` promises an offline Bible.** `[C]` True as of `b395543`; was false when written
(UX audit finding 1). Same lesson: the marketing claim is the one a persecuted church acts on.

**D3 — `how-trinityone-stays-up.html:266` records install-anywhere as "linked from welcome.html footer".**
`[C]` It is not. That false record is *why* the page is an orphan — the doc that owns the resilience story
says the link shipped, so nobody re-checked.

**D4 — `stewards-guide.html:151` says a delegate can "approve / admit".** `[C]` Per UX audit finding 7 a
delegate can approve but silently cannot decline. The caveat must travel with the table into `help-data.jsx`.

**D5 — "Reminders reach you even with the app closed" is Android-only.** `[C]` `app/reminders.jsx:52-59` is
a `setTimeout` "while this tab is alive" on web/iOS — and the site routes iPhone users to the browser.
Qualify or drop.

**D6 — the Android CTA rewrite may 404.** `[S]` `welcome.4.js`, `welcome-churches.2.js` and `migrate.js`
rewrite `[data-steward-cta]` to the RELATIVE `./trinityone-steward.apk`, and no `.apk` is git-tracked, so
`pages-dist/` may not contain it. `downloads.html` uses absolute URLs and is unaffected — which looks like
downloads was fixed and the three CTA scripts were not. **Load a marketing page on an Android UA and tap
"Start a church" — settles in ten seconds.**

**D7 — `apks.html` does not exist** on main. `[C]`

**D8 — three unresolved screenshot placeholders** are publicly served on `verify-a-child.html:110,135,145`,
live since 2026-06-25. `[C]`

---

## Two live contradictions worth fixing regardless of the trim

1. **Opposite install advice.** `downloads.html:336`: *"Only install TrinityOne from this page — never a
   copy sent to you another way."* `install-anywhere.html:69`: *"An APK from a friend church is … byte-for-
   byte identical."* Two live pages, opposite security advice, same reader. Merging them forces one answer.
2. **`welcome.html:301` "three simple steps"** presents hosting as a required decision; `welcome-churches.html:226`
   says there is nothing to set up. Make it two steps.

Minor: **`welcome-churches.html:361` footer reads `← trinityone.app`** — wrong domain, one-word fix.

---

## Where the pages bury their point

* **`welcome.html`** answers "what is this" in line one — right for a member, but never answers "is it
  safe" above the fold; that waits ~2,000px. One clause in the hero fixes it.
* **`why.html:285`** is the best opening on the site and should not be touched.
* **`welcome-churches.html:159`** leads with price. Correct. The `£1,450 a year` arithmetic at `:206` is the
  most persuasive sentence on the site.
* **`features.html:156`** is the only page that tells you where the short version lives. Keep.
* **`features.html:169-194`** — the NIV answer — is the one place the site handles an objection head-on.
  **Do not trim it.**

---

## Also

**108 KB of inline CSS** across 16 pages, of which **22 KB is byte-identical rules repeated across pages**.
**8 of 16 pages do not link `brand.css` at all**, which is where the three drifted brand palettes come from.
Deleting six of those eight removes the drift as a side effect; the surviving two should link it.
**~30 KB recoverable with zero visual change.**
