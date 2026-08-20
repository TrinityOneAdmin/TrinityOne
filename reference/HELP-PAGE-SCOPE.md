# Scoping — what `help.html` needs to become

**Written 2026-08-20. Read-only pass: nothing in the product was changed to produce this.**
Grounded in `app/help-data.jsx`, `reference/SIM-FEATURE-CHECKLIST.md`, `docs/design/STEWARD-ROSTER-DESIGN.md`,
`reference/ROADMAP-NOTES.md`, `reference/ROADMAP.html`, `README.md`, `docs/README.md`, and the shipped code
cited inline. Every claim below that came from code names the file and line so the writer can re-check it
rather than trust this document.

Where I could not settle something by reading, it is marked **UNVERIFIED** and must be confirmed before it
goes on a public page. The governing rule for this whole job is the one at the top of `reference/ROADMAP.html`:

> Never describe a protection as more than it is. An honest limit survives a police visit; an overclaim gets
> someone charged.

---

## 0. The structural fact that changes the job

**`help.html` is a 179-line shell with no content in it. The content is `app/help-data.jsx`, and that same
file is the in-app help.**

- `help.html:176-177` loads `<script src="app/help-data.jsx">` then `help.js`.
- `help.js` renders `window.HelpData.articles` into the page — all 18 of them, in order, in full.
- `app/screens-help-main.jsx` renders the *same* `window.HelpData` inside the app.

So the brief's premise — that the in-app help is "a different surface, much richer" — is not the case. They
are one body of copy with two frames around it. This matters in three ways:

1. **Every wording fix lands in both places at once.** That is a gift, not a problem: fix it once.
2. **Anything public-only cannot go in `help-data.jsx`** without also appearing in a phone overlay where it
   does not belong (a "should our church adopt this" section, links to `docs/guides/*`, an operator's page).
   §5 names this as the one decision that blocks the shape of the rest.
3. **`reference/help-content.md` is a trap.** Its own header says it is "the source of truth for *what it
   says*". It was last touched **2026-06-19**; `app/help-data.jsx` has had eight commits since. Whoever
   writes must edit `app/help-data.jsx` and treat `help-content.md` as an archived first draft, or delete it.

**The page is also in better shape than "seriously out of date" suggests.** `app/help-data.jsx` has 12
commits, the most recent **yesterday** (`d867261`, 2026-08-19). Several of its passages — the "why any of
this matters" section, the FAQ, the DM-metadata disclosure — are the most honest writing in the project. The
drift is real but it is *specific*, and §1 lists exactly where. Do not rewrite the parts that are working.

**One deployment note:** `pages-dist/` is the built site and is gitignored. Its `app/help-data.jsx` differs
from the repo by exactly one line — yesterday's child-scan fix has not been deployed. Whatever is written
here reaches the public only after a deploy.

---

## 1. What the current page says, and what is wrong, stale or missing

### 1a. What it says

Hero ("Your 12 words"), a chip index, then 18 articles rendered in full down one page, then a CTA to
`quick-card.html`. The articles, in page order:

`welcome` · `words`★ · `faq`★ · `name` · `reading` · `plans` · `library` · `community` · `serving` · `care` ·
`directory` · `family-safety` · `notifications` · `restore` · `how-it-works` · `scams` · `console` ·
`giving-records` · `steward`

Two are starred "MOST IMPORTANT" (`words`, `faq`). Each article offers "Listen to this page"
(`speechSynthesis`) and the page has a three-step text-size control.

### 1b. Wrong — fix these first

**W1. The Finance article describes a protection that no longer exists, in the direction that overclaims.**

> "The books are your church's private bookkeeping, encrypted to the church's own key — the relay only ever
> holds unreadable ciphertext, and only this console can open it."

The books stopped being sealed to the church key. `src/steward.src.js:283` introduces
`FINKEY_D = 'trinityone/financekey:'` — "the church books' key, wrapped per reader (owner-signed)" — and
`:4485` explains why: under the old scheme a delegated treasurer's reads returned nothing. A steward holding
the `finance` capability can now open the whole ledger, history included, via the key ring at `:4497`. The
console's own copy was corrected for exactly this (`app/stew-dashboard.jsx:4565-4568`: *"copy describing a
limit that no longer exists is its own kind of lie"*). The help page still carries the old sentence.
"Only this console can open it" now reads to a church leader as "the treasurer cannot see the books", which
is the opposite of true.

**W2. A steward console path that no longer exists.**

> "when you're ready, Settings → Relays can point your church at one you trust, or your own"

The Relays tab was merged into **Network & relays**. `app/stew-dashboard.jsx:5797-5799` keeps a redirect for
saved deep links precisely because the name changed; the live sub-tabs at `:5896` are
`Church · Features · Network & relays · Security`. Sweep every console path in the copy at the same time —
"Settings → Congregation features" is the tab now labelled **Features**, and "Rules & privacy"
(`:5173`) is a panel inside a tab, not a tab.

### 1c. Stale — true when written, overtaken since

**S1. Delegated stewards, as described, are two days out of date.** The `console` article says a steward
"gets their own key and can be added or removed at any time" and contrasts a delegate with a full handoff.
All correct, and the handoff warning is genuinely good. What is missing is everything built on 2026-08-19 and
2026-08-20 (`docs/design/STEWARD-ROSTER-DESIGN.md` §3a, phases 2b–2d):

| Capability | Label in the console | What it covers |
|---|---|---|
| `finance` | Finance | The church books, funds and statements — read the whole history and add entries |
| `care` | Care | Care needs, the care team, safety checks |
| `safeguarding` | Safeguarding | Clearances and photo decisions — the child / cleared-adult / guardian **lists stay owner-only** |
| `members` | Members | Admit people, join policy, re-seat someone who lost their words |
| `content` | Groups & rotas | Groups, rotas, services, events, posts |

(Labels from `app/stew-dashboard.jsx:54` and `:4564`; the set from `src/steward.src.js:282`.)

Also unsaid, and all of it worth a church leader's time:
- Capabilities are chosen **when the steward is added**, and the grant is explicit — including the explicit
  empty one. "Everything" is no longer the default a single click produces.
- The owner **must name** each steward in their own words before the add is allowed
  (`app/stew-dashboard.jsx`, `addByCode`: *"Give them a name first — you'll need it to tell your stewards
  apart."*). The design doc records the reason verbatim: *"a mis-pasted code is a stranger with everything
  and I'd never spot it."*
- The relay enforces capabilities **on reads as well as writes**.
- **The honest limit**, from the design doc: *"a relay running an older build ignores `caps` entirely and
  keeps giving that steward everything."* The console says so. The public page must too — see §4, L5.
- What a delegate still cannot do, unchanged: edit the roster, edit the blocklist, change the relay's write
  policy. The article's existing note about blocking being owner-only is **correct** and verified today at
  `scripts/gateway.mjs:1520` (`if (d.startsWith(BLOCKED_D)) return isLeader;`). Keep it.

**S2. Safeguarding predates the work that made it explain itself.** `family-safety` describes the rules
accurately from the *church's* side and says nothing about what a young person actually sees. As of
2026-08-19 (`reference/ROADMAP-NOTES.md` §8, marked BUILT and sabotage-verified in
`scripts/safeguarding-explains-itself.test.mjs`) a child account now: says on the young person's own profile
what kind of account it is and who else can see that ("Only you and your church's stewards"); turns the
"Restricted" chip in the directory into a tappable control that explains the restriction **differently to
each side** — a young person is told what they can still do, an adult is told only that messages here are
limited and is never told the other person is a child; and a refused DM now says "Not delivered" instead of
falsely promising to send it later.

The reason this matters publicly is in the same note, measured in a simulation: a 15-year-old saw 23 of 26
people marked "Restricted" and concluded *"a young person might think the app is broken, not that it's
protecting them."* A parent reading the public help page is trying to decide whether their child will feel
punished. That answer now exists and is not on the page.

**S3. `care` describes only half the feature.** The article is entirely about volunteering — see a need, pick
a day, say what you are bringing. It never mentions that a member can **ask for help**. The flow is shipped
(`app/screens-today.jsx:197` onwards): a private sealed request to the care team that is *not* a public need,
a private care-team chat thread, and a withdraw that deletes the request and the thread together. Nor does it
mention the **safety check** roll-call ("I'm safe" / "I need help", `app/screens-today.jsx:676-901`), which is
the most consequential thing in the whole Care module.

**S4. The `words` article's headline promise is slightly wider than what restore returns.**

> "As long as you have these 12 words, you can always get back into your account — even on a new phone."

The FAQ and the `restore` article both give the correct, careful boundary (old DMs and sealed care records do
not come back; notes and journal need the backup *file*). But `restore`'s `tech` block hides one consequence
in the technical register: *"your followed churches are stored on this device, so re-following is a manual
step today."* A member restoring at a kitchen table needs that in plain words, not in the small print.

### 1d. Missing — shipped features with no help at all

Checked against `reference/SIM-FEATURE-CHECKLIST.md` (written 2026-08-19, derived from the screens rather
than from memory). None of the following appears anywhere in `help-data.jsx`:

| Missing | Where it lives | Why it belongs on a public page |
|---|---|---|
| **Safety check / "mark as safe"** | `app/screens-today.jsx:676+`, console §Care | The one feature a church uses on its worst day |
| **The backup FILE** | `app/backup.jsx` | Mentioned in passing three times, never explained. See L3 |
| **PIN / community lock** | `app/identity-extras.jsx:230+` | A member who sets one and forgets it has only their 12 words left |
| **Kids check-in** | `app/stew-dashboard.jsx` (`tab === 'checkin'`) | Parents ask about this before anything else |
| **Per-steward capabilities** | §S1 | The headline change of the last two days |
| **Church networks** | `app/stew-dashboard.jsx:106`, `gateway.mjs` `NETWORKS_BY` | A deanery or denomination asks first |
| **Rooms & bookings, chat message tags, run sheets, resources / plan library / sermons** | console | Each is a "can it do X?" a leader asks |
| **Manna** (money-out / disbursements) | `app/stew-manna.jsx` | Pilot-locked; say so rather than let it be discovered |
| **"How do I report someone?"** | — | Decided: no member-facing report for the pilot (`ROADMAP-NOTES` §6c). The answer is "go to a steward, who has the tools." That is an answer and it should be given |

Two smaller gaps in existing articles:
- `notifications` lists four categories. The relay also pushes a **featured sermon** and a **safety check**
  (`gateway.mjs:1181`, `:1200`), both under the `announce` category — so "Church announcements" quietly
  covers more than the article says.
- Serving reminders are **local** notifications fired at 18:00 the day before (`app/reminders.jsx:18`), not
  server push. On the Android APK they fire with the app closed; the file's own header says the web path is
  "best-effort while a tab is alive". Since iOS is a PWA (`README.md`), the article's flat promise of "a
  gentle reminder the evening before" is stronger on Android than on iPhone. Say which.

### 1e. Wrong for the *page*, not the words

- **No search.** Eighteen long articles on one scroll, no filter (`help.html`, `help.js`: zero matches for
  "search"). A steward stuck mid-Sunday cannot find "swap" or "block" without reading past the Bible reader.
- **`minutes` is dead data.** Every article carries a `minutes:` estimate; neither `help.js` nor
  `app/screens-help-main.jsx` ever reads it. Either render it or drop the field.
- **No date, no version.** A page whose credibility rests on accuracy should say when it was last checked.
- **No route to a human.** `welcome.html`'s footer offers GitHub Issues; `help.html`'s footer offers a
  wordmark and a verse. A church leader who has read the honest limits and is now worried has nowhere to go.
- **No link to the written guides.** `docs/guides/` holds `GETTING-STARTED`, `RELAY-SETUP`,
  `RELAY-WALKTHROUGH`, `STEWARD-GUIDE`, `STEWARDS-AND-HANDOFF-EXPLAINED`, `TROUBLESHOOTING` — 721 lines
  aimed exactly at the reader the public page cannot serve in a phone-sized article. Nothing points at them.
- **Nav label drift.** `help.html:123` calls the section "Downloads"; `welcome.html:297` calls the same
  anchor "Get the app". Harmless, but it is the kind of thing this page is judged on.

---

## 2. Who reads this page

Four readers, arriving with different questions and different amounts of patience. The page currently
serves the third well, the fourth partly, and the first two hardly at all.

**A. The church leader deciding whether to adopt it.** On a laptop, before any install, comparing this
against ChurchSuite or a WhatsApp group. Their questions: *What does it actually do? What can't it do? Who
can see our members' data? What happens when our administrator leaves? Is anyone holding our money? Who do I
call when it breaks?* They will read the limits section closely and will trust the product **more** for it —
this is the reader for whom an honest limit is a selling point. They need the roadmap's "deliberately not
doing" list, which today lives only in an internal file. They are not served at all right now: the page opens
with "your 12 words", which is a member's problem, not theirs.

**B. The steward stuck on a Sunday.** On a phone, in a corridor, with four minutes. *How do I let this person
in? Why can't Sarah see the rota? How do I take someone off the team? Why can't our treasurer open Finance?*
They need answer-shaped headings and a search box. Long-form articles fail them completely.

**C. The member who has lost their phone.** Frightened, possibly using someone else's device. *Can I get back
in? What have I lost?* The page serves them well — `words`, `restore` and the FAQ's "I lost my 12 words and
my phone" answer are careful and accurate. Protect this; it is the best writing on the page.

**D. Someone sent a joining link.** Has not installed anything and is deciding whether to. *What is this?
What will the church see about me? Do I need an email? Is it safe for my daughter?* The FAQ answers "I can't
find my church" and "waiting for approval" (both verified still accurate: the relay pushes a join request to
the *steward* at `gateway.mjs:1105` but never notifies the *waiting member* on admission, so "check back
rather than waiting for a buzz" is true). What is missing is the parent's question, which §S2 can now answer.

There is a fifth reader — the **relay operator** self-hosting a box. They are already served by
`docs/guides/RELAY-WALKTHROUGH.md` and should be *linked*, not duplicated.

---

## 3. Proposed structure

Reader-first, not feature-first. Four bands. The chip index becomes a router by *who you are*, and a search
box sits above it.

**Band 0 — Find it fast** *(new)*
Search across article titles, summaries and body text (all client-side; the data is already one object).
Under it, four routes: "I'm new here" · "I'm stuck now" · "I lead a church" · "I've lost my phone".

**Band 1 — Start here** *(keep, tighten)*
1. `words` — the 12 words. Unchanged in substance; add the plain-words version of S4.
2. `restore` — new phone / lost phone. Keep.
3. `welcome` — why it works this way. Keep; it is the strongest passage on the page.
4. `scams` — nobody will ever ask for your words. Keep as-is.

**Band 2 — Using it** *(keep; three additions)*
5. `name` · 6. `reading` · 7. `plans` · 8. `library` — keep, unchanged.
9. `community` — keep. Its room-vs-DM distinction is exactly right.
10. `directory` — keep.
11. `serving` — keep; correct the reminder claim per §1d.
12. `care` — **rewrite**: add "asking for help", add the safety check, and answer *who will see that I need
    help?* directly (§4, L6).
13. `family-safety` — **rewrite**: add what a young person sees (§S2), and keep the steward instructions.
14. `notifications` — keep; correct the two points in §1d.
15. **Keeping your phone locked** *(new)* — the PIN, what it protects and what it does not, and the fact
    that forgetting it leaves only the 12 words.
16. **Your backup file** *(new)* — what it holds, why it needs a passphrase not a PIN, where to keep it.

**Band 3 — For leaders** *(the band that barely exists today)*
17. **Is this right for our church?** *(new)* — what it does, what it deliberately does not do, what it costs
    (nothing), what a church has to hold itself.
18. `console` — **rewrite** for capabilities (§S1) and correct the relay path (§W2).
19. **Sharing the load: stewards, capabilities and handoff** *(promote out of `console`)* — the five scopes,
    the naming requirement, revocation, the one-way handoff, and the older-relay limit.
20. **Safeguarding for stewards** *(promote out of `family-safety`)* — marking a child, clearing an adult,
    guardian links, and the line that this supports rather than replaces the church's own safeguarding.
21. `giving-records` — **rewrite** the encryption claim (§W1); state plainly that giving from a member's own
    wallet is **off for the pilot**.
22. **Running your own relay** *(new, thin)* — three paragraphs and a link to `docs/guides/RELAY-SETUP.md`
    and `RELAY-WALKTHROUGH.md`. Do not duplicate 294 lines of guide onto a marketing domain.

**Band 4 — Straight answers** *(keep; expand)*
23. `faq` — keep every existing answer; add "how do I report someone?", "can our treasurer see the books?",
    "what happens if our administrator leaves?", "is my child's account safe?".
24. **What this does not protect you from** *(new — see §4)*.
25. `how-it-works` — keep. Its glossary (relay / Nostr / module) is the only definition of those words on
    the whole site.
26. `steward` — keep as the closing reassurance.

Then the printable-card CTA, a "last checked" date, and a route to a human.

---

## 4. The honest-limits section

One section, its own heading, written in the page's own voice — not a legal footer, and not buried in a
`tech` block. Several of these limits are *already stated somewhere* in `help-data.jsx`; the value of
gathering them is that the reader in §2A can read them in one sitting and judge.

| # | The limit | Stated today? |
|---|---|---|
| **L1** | **The 12 words cannot bring back your old private messages, or care records sealed to you.** They are gone with the words. | ✅ FAQ, and `restore`. Keep the wording; it is good. |
| **L2** | **The 12 words do not bring back your notes, journal, highlights or which churches you follow.** Those are on the device. The notes need the backup *file*; the churches must be re-followed by hand. | ⚠️ Half. The file is covered; re-following churches is only in a `tech` block (§S4). |
| **L3** | **A backup file is a spare key to your whole account, and to your church's group conversations.** `app/backup.jsx` states it plainly: whoever opens the file *is* you, and it unwraps the church's group keys from the relay, "so one cracked file opens the congregation's private conversations, not just one person's notes." A file kept in a cloud drive can be guessed at offline, on the attacker's hardware, for as long as they like. The floor is 12 characters (`PASS_MIN`) and the app tells you to use words, not a PIN. | ⚠️ One line in `welcome` ("A proper password on any backup file"). The consequence — that it is the *congregation's* conversations, not just yours — is unstated. |
| **L4** | **Whoever runs your church's relay can read your church rooms** unless that room says "End-to-end encrypted", and can see **that** you messaged someone and **when**, even when they cannot read it. | ✅ Stated three times, well — `community`, `faq`, `how-it-works`. Keep verbatim. |
| **L5** | **Safeguarding, rota visibility and steward capabilities are enforced by the relay — so they hold only on relays running current code.** The steward design doc: *"a relay running an older build ignores `caps` entirely and keeps giving that steward everything."* `ROADMAP-NOTES` §7 records the same for rota visibility: *"a church that narrows its rota is only protected on relays running the new code."* | ❌ **Completely unstated.** This is the most important addition in this document. A church that believes a capability restriction holds everywhere, when it does not, has been overclaimed to. |
| **L6** | **Who sees that you need help depends on a setting your church chose.** Care is off by default; when on, needs are visible to *the whole church* (default) or *the care team only*. An "Ask for help" request is sealed to the care team, not published as a need. | ⚠️ `care` says "some churches keep this to a small care team" but never answers the question in the reader's head. |
| **L7** | **A phone that is examined will show that you use TrinityOne and which congregation you follow.** No app can hide that. | ✅ Stated in `welcome`. |
| **L8** | **A PIN protects what is inside your church, not the fact that you are in one.** The app already says this, word for word, at `app/identity-extras.jsx:313`. | ❌ Not on the help page at all — because there is no PIN article. Lift the in-app sentence unchanged. |
| **L9** | **Nobody, including this project, can reset your account or restore your church's data** — deliberately. `ROADMAP.html`, "Deliberately not doing": *"Any recovery route we control — if we can restore a church's data, we can be compelled to."* | ✅ In `welcome`, as a feature. Restate it in the limits section as a *cost*, which is how the leader in §2A will read it. |
| **L10** | **Giving from a member's own wallet is off for the pilot.** Verified: `app/screens-chat.jsx:284` is a hard `const givingOn = false`, and the console's toggle is `disabled` with the title "Giving is locked during the pilot" (`app/stew-dashboard.jsx:5277`). | ⚠️ `giving-records` says "still building — nothing to set up for it yet", which is honest but soft. The site's own pitch line still names giving (`README.md`). Say it in one sentence. |
| **L11** | **Your notes, journal, highlights and prayers are not backed up to any server.** Today the relay refuses those documents outright (`ROADMAP-NOTES` §1 — measured, 40 refusals in one round). Local-first is the design; the *consequence* is that a lost phone with no backup file loses them. | ⚠️ Stated as a privacy feature ("these stay private on your phone"), never as the loss it also is. |
| **L12** | **A member cannot report or block another member in the pilot** — go to a steward, who has the tools. Decided (`ROADMAP-NOTES` §6c). | ❌ Unstated. Absence of a feature people expect reads as a bug until it is named. |

The four that **must** be added because they are currently unstated: **L5, L8, L12**, and the plain-words
half of **L2**. **L3** must be deepened. Everything else already exists somewhere and needs gathering, not
rewriting.

**One thing to leave alone.** `ROADMAP-NOTES` §3 records that the Android ≤10 backup path is
**unmeasured** — the write may be refused outright on those versions, for both the member's file and the
church key. Do not make any Android-version claim about backups until someone has run it on a real Android
9/10 handset.

---

## 5. What is blocked

Six things cannot be scoped further because a product decision has not been made. Each names the decision.

**B1 — One source of copy, or two?** *(blocks the shape of Bands 0 and 3)*
`app/help-data.jsx` is both surfaces. Band 0 (search), Band 3 (leaders, relays, links into `docs/guides/`)
and Band 4's limits section are public-page material that would be noise inside a phone overlay.
**Decision needed:** split `help-data.jsx` into shared articles plus a public-only set, or keep one file and
give the in-app renderer a per-article `surface: 'app' | 'web' | 'both'` flag. I would recommend the flag —
one file, one edit, no divergence — but it is not mine to choose.

**B2 — Does a church choose its relay?** *(blocks §3 items 18 and 22, and part of `console`)*
`ROADMAP-NOTES` §6a records the owner's reframing: *"NOBODY picks relays… the CHURCH should not have to
choose either."* The console still ships a Network & relays tab, and the help still tells stewards to use it.
Until that lands, the page cannot say which is true. **Decision needed:** is choosing a relay a supported
church-facing act, or an operator-only one?

**B3 — Can a church leave a relay?** *(blocks the honest answer to "can we walk away with our data?")*
`ROADMAP-NOTES` §7: a single-church relay cannot be emptied at all, so a church cannot leave a relay it no
longer trusts and an operator cannot decommission cleanly. This directly contradicts the pitch in `README.md`
— *"can walk away with all of its data at any time"* — which the leader in §2A will test. **Decision needed:**
the relay MODE work, and specifically whether a church can de-provision itself. Until then the page must not
repeat the walk-away claim without qualification.

**B4 — Where do the 12 words get shown?** *(blocks a deep rewrite of `words` and `restore`)*
Moving the backup ceremony to the "You're approved" moment was analysed and **deferred by the owner on
2026-08-06** until the pilot proves it is needed. Both articles describe the current placement. **Decision
needed:** ship or drop the move. Do light corrections now (§S4); do not restructure these two.

**B5 — What is the public support route?** *(blocks the page footer and §2A's last question)*
There is no email, no form, and no support address anywhere on the site — only GitHub Issues in
`welcome.html`'s footer, which a vicar will not use. **Decision needed:** what a church contacts, and who
answers.

**B6 — Are the "deliberately not doing" commitments public?** *(blocks §3 item 17)*
The five commitments in `ROADMAP.html` — no telemetry ever, never holding anyone's money, no central
directory of churches, no recovery route we control, never naming a protection more strongly than it
deserves — are the single most persuasive thing this project could show a cautious church leader, and they
live in an internal file. **Decision needed:** publish them, in the owner's words, or not.

---

## 6. Effort and order

Sized in half-days of writing, assuming the writer has read `app/help-data.jsx` end to end first. All of it
is copy in one file plus a small amount of work in `help.js`; nothing here needs product changes.

### First — corrections. Nothing new, only things that are currently false. **~1 day.**
1. **W1** — the Finance encryption sentence. *Half a day at most, and it is the highest-value half-day on
   this list:* it is the only place the page currently claims a protection the code does not provide.
2. **W2** — the console paths sweep (Relays → Network & relays, Congregation features → Features).
3. **§1d minor** — the serving-reminder platform caveat, and the two notification categories.
4. **S4** — the plain-words note that followed churches must be re-followed.

Do these even if nothing else in this document is ever built. They are the difference between a page that is
thin and a page that is wrong.

### Second — the honest-limits section. **~1 day.**
Write Band 4 item 24 from the L1–L12 table. **L5** is the one that must not be dropped. Most of the text can
be lifted from copy that already exists in the app and the design docs, which is the right way to write it —
those sentences have already survived an argument.

### Third — the two rewrites the product has outrun. **~2 days.**
5. **S1** — steward capabilities into `console`, and promote §3 item 19 into its own article.
6. **S2** — what a young person sees, into `family-safety`.
7. **S3** — asking for help and the safety check, into `care`.

### Fourth — the leader's band. **~2 days, and blocked on B2/B3/B6.**
§3 item 17 ("Is this right for our church?"), item 22 (relays, thin, linking to `docs/guides/`), and the
FAQ additions. Cannot be finished honestly until B2, B3 and B6 are decided; item 17 can be *drafted* now with
the blocked paragraphs left as gaps.

### Fifth — the page itself. **~1 day, blocked on B1.**
Search box, the four reader routes, a "last checked" date, a route to a human, `minutes` either rendered or
deleted, the nav-label fix.

### Can wait
- The two new member articles (PIN, backup file) — real gaps, but a member who needs them is usually sitting
  with a steward. After the pilot.
- Kids check-in, rooms, chat tags, networks, Manna — one FAQ line each is enough for now; full articles are
  post-pilot.
- Read-aloud and text-size already work and need nothing.

**Total: about 3 days to get the page truthful and complete for members, another 2 for leaders once the
blocked decisions land.**

---

## Sources

Product truth: `app/help-data.jsx` · `app/screens-help-main.jsx` · `help.html` · `help.js` ·
`app/screens-today.jsx` · `app/screens-chat.jsx` · `app/stew-dashboard.jsx` · `app/stew-meals.jsx` ·
`app/identity-extras.jsx` · `app/backup.jsx` · `app/reminders.jsx` · `src/steward.src.js` ·
`src/steward-meals.src.js` · `scripts/gateway.mjs`.
Documents: `docs/design/STEWARD-ROSTER-DESIGN.md` · `reference/SIM-FEATURE-CHECKLIST.md` ·
`reference/ROADMAP-NOTES.md` · `reference/ROADMAP.html` · `README.md` · `docs/README.md` ·
`reference/help-content.md` (stale — see §0).

### Marked UNVERIFIED — confirm before publishing

- **Does `openedBy: 'steward'` hide the member's "Ask for help" button?** `app/screens-today.jsx:490` gates it
  on `careOn` alone (`= care.settings.enabled`), which suggests a member can always ask privately and
  `openedBy` governs only who opens a public *need*. But `reference/SIM-FEATURE-CHECKLIST.md` A2 reads
  "Members can only volunteer, never ask". One of the two is wrong. Settle it before writing L6 or S3 —
  telling a hurting member they can ask when they cannot is the worst possible error on this page.
- **Whether the safety-check and featured-sermon pushes are separately switchable** in the member's
  Notifications screen, or arrive under "Church announcements". Both use `category: 'announce'` at
  `gateway.mjs:1181` and `:1200`; the settings UI was not read.
- **Whether "Restore / Scan invite"** — the wording in the `steward` article's step 1 — still matches the
  current first-run wizard. The neighbouring child-account step was corrected only yesterday (`d867261`),
  which suggests this family of instructions drifts.
