# End-to-end session on a staged church — 2026-09-04

**What this was.** The job HANDOFF-2026-09-04-END.md called "THE GAP": nothing on the merged branch had
ever been used as an app. This session staged a real church, joined three members (one on a real phone),
and worked section 2's five items. Read-only as to code: **no source was edited, nothing was committed,
nothing was deployed.**

**Build under test.** Gateway restarted first, as the handoff demands, and verified newer than the file:
process `17:39:29` vs `scripts/gateway.mjs` mtime `13:58:11`, serving `d21b74d` = main's tip. Every
console bundle loaded `?v=d21b74d`. The Oppo's `vendor/fellowship.js` hashes **identical** to the repo's
(same SHA-256 over UTF-8). So nothing here is a stale-relay or stale-bundle artefact.

**Method.** Every claim about what was saved is read from `relay/relay.sqlite` directly, not from the
console's own screen. Phone screens are judged from screenshots, never `innerText` — that rule was earned
three times over during this session.

**a8, measured (contradicts one thing said in passing during the session).** All three hosts answer;
fingerprinted by `relayPub`:

| host | build | relayPub |
|---|---|---|
| `app.trinityone.church` | `7a292ca` | `6a4267558c99` |
| `trinityone-master-01.tailbeaac0.ts.net` | `7a292ca` | `6a4267558c99` |
| `trinityone.tailbeaac0.ts.net` (this dev box) | `d21b74d` | `16731f4c40ed` |

The first two are the same machine. a8 is **up** and running a build behind main — consistent with the
owner's note that it has not been updated lately, and with "nothing is deployed".

---

## Results at a glance

| item | verdict |
|---|---|
| 1 · Safeguarding, skewed clock | **PASS** — gate fails safe on console and phone. Produced **F5**. |
| 2 · Two consoles | **First half PASS.** Second half **not achieved** — see why. Produced **F6**. |
| 3 · Bank import | **PASS**, including the interruption. One caveat on the £4,744.09 figure. |
| 4 · Identity | **PASS** — rename ×2 stuck; Undo 4/4. |
| 5 · Use it and say what feels wrong | written up from the session itself |

**Findings F1–F6 below.** F4 and F5 are the two worth acting on first.

## What I did NOT check, stated plainly

- **The "help is set up, the request is still open" line was never triggered** — I could not make only the
  second publish fail (the two are ~1s apart; my stop at +0.47s let both through).
- **No second phone.** The Pixel was unavailable; everything cross-device used one phone plus browsers.
- **Giving, Lightning, kids check-in, rooms/bookings, rota scheduling, resources, safety check** were
  swept for rendering only — never driven.
- **Nothing was tested against a8**, deliberately.
- The £4,744.09 reconciliation was **not** performed — see item 3.

---

# End-to-end session findings — 2026-09-04
Build under test: gateway + bundles all `?v=d21b74d` (main tip). Console driven headless
(chromium, unique profile, production hosts mapped to a discard port). Oppo J77HDMTC7TKBZDFM.

Status key: CONFIRMED = I drove it and measured it. NOT CHECKED = stated plainly, not implied.

---

## F1 — The recovery-phrase quiz boxes have no accessible name, on both console and phone
**CONFIRMED (console, measured in the live page).**

On the church-key ceremony (`Your church's recovery key` → `Quick check — type these three…`)
the three answer boxes are, measured live:

    labels:0  aria-labelledby:null  aria-label:null  placeholder:""  title:""  id:""

The visible "WORD #1 / #10 / #12" is a sibling `<div>`, not associated with anything.
A screen-reader user is offered three anonymous edit boxes and is not told which word each wants.

- Console: `app/stew-dashboard.jsx:866-867` — the caption is a `<div>`; the input has no name at all.
- Member app: `app/identity.jsx:924-925` — the caption IS a `<label>`, but it has no `htmlFor` and does
  not wrap the input, so it associates with nothing either. That input does carry
  `placeholder="type it here"` — so all three boxes report the SAME name, which distinguishes none of them.

Why it matters more than a normal a11y gap: this is the one screen where a wrong answer loses the
church key, and it is unskippable (`canContinue` requires `saved && verified`).

**Checked against the recent work before claiming it (owner's warning).** Commit `d5cd066`
("name the secret fields") was scoped deliberately to `type="password"` inputs — nine of them plus the
relay admin token — and its test `every-secret-field-has-a-name.test.mjs` sweeps for password fields.
These quiz boxes are `type="text"`, so they were **outside that commit's scope by design**. This is a
NEW gap, not a regression and not a missed fix. I measured the console PIN boxes: they DO carry
`aria-label` ("Choose a console PIN or passphrase" / "Repeat the console PIN or passphrase"), so that
commit did what it said.

Weaker sibling, recorded but not pressed: the church-name field behind Settings -> Edit name has
`aria-label:null, labels:0` and only a placeholder ("e.g. Grace Community Church"). For a TEXT field a
screen reader still reads the value back once something is typed, so this is milder than the password
case that commit argued — noted for completeness, not as an equal.

---

## F2 — The setup wizard's Groups step reports success over three groups that were never created
**CONFIRMED (driven live; verified against the relay's sqlite, not the console).**

I clicked `Create 3 & continue` (Whole Church, Notices, Prayer). The wizard advanced to the next step
with no error. Measured immediately afterwards:

- `relay/relay.sqlite`: **0 events** authored by this church (newest event on the whole relay predates
  today). Read off disk, so the relay's own read gate cannot be what hid them.
- `localStorage[...steward.groups.<pub>]`: **`[]`** — length 0.
- Dashboard tile: `Groups 0`.

So all three publishes failed, nothing was stored anywhere, and the wizard said nothing.

**Cause, read in the shipped source.** `app/stew-dashboard.jsx` `saveGroups` awaits
`window.Steward.publishGroup(...)` and never inspects the result for the unsealed path, then calls
`next()` unconditionally. `publishGroup` is explicitly written to report failure —
`src/steward.src.js:4211-4212` resolves `{...}` on success and **`null`** on failure, under a comment
that says *"A partial write now reports FAILURE… An error is recoverable, false reassurance is not."*
The return value is discarded.

**The asymmetry is the point.** The very next step of the same wizard, `saveMeetings`, counts failures
and renders *"Couldn't save your meetings — the relay didn't accept them. Check you're online and try
again; your rows are still here."* — I saw that message on screen, and its Continue button was
re-enabled with the rows preserved. Two adjacent steps, one honest and one not.

**Checked against the recent work before claiming it (owner's warning).** Commit `2c8da57`
("row controls stop swallowing failures") enumerated EVERY caller of `publishGroup` under repo rule 2,
and its list includes `app/stew-dashboard.jsx:722, 726, 749` — which is this wizard (`saveGroups`'s call
is line 725 today, `saveTeam`'s is 752). But it scoped itself to "the DashGroups half of #4" and
classified only the row controls as fire-and-forget (2683/2763/2812/2840/2846/2854), fixing 2812, 2846,
2854 and confirmDelete, and deliberately leaving 2763 and 2840 with stated reasons. Batch 5 (`db5f056`)
then covered the safeguarding setters.

So `saveGroups` was **seen and enumerated, classified as neither fixed nor deliberately-left, and still
discards the result.** That is a remaining gap in a piece of work that was otherwise careful to account
for every caller — not a regression, and not a fix that failed.

`saveTeam` (line 752) has the same shape and is also unaccounted for; I have not yet driven it.

Severity in plain terms: this only bites when a publish fails. That is exactly the pilot's stated threat
model — "does this work over a thin pipe in Tehran" — where a failed publish is ordinary, not exotic.

---

## F3 — Creating a church on a self-hosted console permanently orphans it from its own relay
**CONFIRMED for the cause and the trigger. The "permanent" half is argued from source; my experiment is below.**

The console was served from `http://127.0.0.1:8000`, which IS a TrinityOne relay, and that relay is
already admitted — measured in `localStorage['trinityone.relays.verified']`:

    {"ws://127.0.0.1:8000/relay":{"pub":"16731f4c40ed644ffdd20fa8b541734de9a062b68557219eae52a6e91e5c1f1a",…}}

Yet `Steward.ownRelay()` returns **`wss://app.trinityone.church/relay`** — the hosted pool — so every
publish in the setup wizard was aimed off-box. (a8 is down today, so this is not only a harness artefact.)

**The chain, each link measured or read:**
1. `localStorage['trinityone.steward.boxhosts.<pub>']` = **`"0"`** (measured).
2. `src/steward.src.js:586` maps `'0'` → `_boxHostsUs = false`.
3. `src/steward.src.js:571` — `if (_boxHostsUs === false) return CANONICAL_RELAY;`
4. `_refreshBoxHostsUs` is the ONLY writer of that key (`:602-603`, confirmed by grepping every reference),
   and it early-returns at `if (!pub || ownRelay() === CANONICAL_RELAY) return;`.

So once `'0'` is cached, `ownRelay()` is canonical, which makes `_refreshBoxHostsUs` return immediately,
which means the key can never be rewritten to `'1'`. Self-locking.

**Why a brand-new church trips it.** `_refreshBoxHostsUs` asks the box `/config` "do you host this church?".
For a church created seconds ago the honest answer is no — it has not been registered with the box yet —
so the console caches "this box is not ours" as a permanent fact about a church that is 30 seconds old.

The codebase already knows this shape: the comment at `src/steward.src.js:2248-2260` calls it
*"already latent in the shipped console and it is permanent, not transient"* and forbids enrolment code
from consulting `ownRelay()` or the cache. That guard protects relay ENROLMENT. Ordinary church CREATION
walks into the same trap, and creation on a self-hosted box is the route DOMAIN.md says we want to push
("The Suite is the path we push").

**Consequence:** a churchwarden who installs the Suite and starts a church gets a console that has
silently decided its own box is not its relay, and publishes the congregation to the hosted pool instead
— the exact opposite of what self-hosting is for.

### F3 — the "permanent" claim, now MEASURED end to end

I did not leave this as an argument from source. The full experiment:

| step | `boxhosts` | `Steward.ownRelay()` |
|---|---|---|
| after church creation | `"0"` | `wss://app.trinityone.church/relay` |
| after registering the church on the box (`POST /config {addChurch}`, relay confirms it in `/config`) | `"0"` | still **`wss://app.trinityone.church/relay`** |
| after `delete localStorage[...boxhosts.<pub>]`, reload, unlock | `"1"` | `ws://127.0.0.1:8000/relay` |

The middle row is the finding. The box demonstrably hosts the church — the relay's own `/config` lists
`SIM St Aidan's` — and the console still refuses to use it. Only clearing that key escapes, and nothing
in the product clears it.

One caveat I want stated rather than buried: between reload and unlock, `ownRelay()` transiently returns
the ORIGIN relay, because `_boxHostsKey()` is `'…boxhosts.' + (pub || '')` and `pub` is empty while the
console is locked — so it reads a different, absent key. That transient is why a quick check can wrongly
conclude the console is fine. It re-locks the moment the PIN is entered.

**Proof that the stage was genuinely broken, and is now genuinely fixed:** with the church registered AND
the cache cleared, the console's `joinpolicy` document and its kind-0 profile
(`{"name":"SIM St Aidan's",…}`) both appear in `relay/relay.sqlite`. Before, it had published nothing at all.

---

## F4 — On an invite-only relay, a console whose church IS registered permanently says "nothing you set up will save"
**CONFIRMED. Highest-value finding of the session so far, and it is on the recommended setup path.**

Every console tab carries a red banner:

> This relay has not accepted your church, so nothing you set up will save: "this relay is invite-only —
> ask the operator to add your church"

while the SAME screen says **"Your relay — Live"**. Both cannot be true, and the banner is the false one.

**Measured, in this order:**
1. Operator added the church: `POST /config {addChurch}` → `{"ok":true,…}`, and `GET /config` lists
   `SIM St Aidan's` alongside the relay's other church.
2. I created a group in the console. It landed on the relay — read out of `relay/relay.sqlite`:
   `kind 30078  trinityone/group:dac19a52…  {"name":"Whole Church","kind":"group",…}` plus its
   `groupkey:`, and the church's `carekey:`, `namekey:`, `joinpolicy:` and kind-0 profile.
3. The banner was **still shown**, and still shown after a full reload + PIN unlock.

So writes are landing and the console says they cannot.

**Cause, read in shipped source.** `src/steward.src.js` `selfRegister` (~:6885) authenticates ONLY with a
NIP-98 proof signed by the church key — it never sends the admin token. `scripts/gateway.mjs` (~:3987)
refuses that on an invite-only relay *before* it ever looks at whether the church is already registered:

    if (SETTINGS.inviteOnly) { res.writeHead(403…, 'this relay is invite-only — ask the operator to add your church') }

So the console cannot distinguish **"invite-only, and my church is not registered"** (a real problem)
from **"invite-only, and the operator already added me"** (entirely fine). It shows the alarming text for
both. And it never stops: `:6892` deliberately does NOT mark a 403 as done — *"A 400 … or 403
(invite-only / already set up) must stay un-marked so a later, correct attempt is still made"* — so the
attempt, and the banner, repeat on every single load.

**Not a regression.** The invite-only refusal is deliberate and correct (`ea7ed48`, and the gateway's
bootstrap-only comment for RELAY-AUDIT-2026-07-20 H4). The write-blocked banner is deliberate and correct
in intent — its comment records 17 silently-lost setup writes on 2026-08-17 that it exists to prevent.
The defect is the **interaction**: a refusal that means "not by this route" is reported as "your church is
not accepted".

**CORRECTED 2026-09-04, after the owner said he had never seen this banner. I had the severity wrong.**
`inviteOnly` **defaults to `false`** (`scripts/gateway.mjs:99`). It is `true` on this dev box only because
someone turned it on (`relay/relay-settings.json`). With the default, a new church self-registers, the 403
never happens and this banner never appears — which is exactly why it has never been seen in normal use.

So the real precondition is narrower than I first wrote: **invite-only turned ON _and_ the church added by
the operator by hand.** That is a deliberate, more locked-down posture — reasonable for a shared relay or a
cautious church — but it is NOT the default and NOT "the recommended path". My earlier claim that it lands
on the recommended Suite route was wrong.

**What survives.** In that configuration the warning is still permanent, still false, still on every tab,
and still survives a reload — and it is precisely the configuration where a steward is least able to judge
it, because someone else runs their relay. Worth fixing; not a pilot blocker.

**Note for whoever fixes it:** the relay cannot currently answer the question either — the invite-only
branch returns before the `CHURCH_PUBS.has(hex)` check, so "already registered" and "refused" are the same
response. Fixing the console alone may not be enough.

---

# ITEM 3 — the bank import. PASSES, including the interruption. One caveat on the £4,744.09 figure.

Driven on the console against the live local relay; every count below read out of `relay/relay.sqlite`,
not off the screen.

**Import #1 — `scripts/fixtures/bank-statement-sample.csv`.** `guessColumns` auto-detected
`{date:0, description:1, moneyIn:3, moneyOut:4}` with no help and left "dates are month-first" unticked —
exactly what the fixture predicts. Review offered **15 lines, 0 flagged already-imported**, with:
- **both** `STANDING ORDER GIVING` £20.00 lines present — the regression case the fixture exists for;
- both `WICKES … PART 1` / `PART 2` lines present;
- `REFUND - HALL HIRE CANCELLED` rendered **−£35.00**, i.e. direction taken from the column and not the word "refund";
- `J & M PATTERSON, REGULAR GIVING` intact, so the quoted embedded comma parsed;
- day-first dates correct (`08/09/2026` → `2026-09-08`).

Posted: **income £1,943.81, spending £1,362.27** — matching the fixture's stated totals to the penny —
and `finance/journal:1` … `finance/journal:15` on the relay.

**Import #2 — the same file again.** Every row flagged "already imported"; the button read
**"Post 0 transactions"**. I pressed it anyway: totals unchanged, still exactly 15 journal docs. Nothing posted.

**Import #3 — the relay genuinely unreachable.** Two methods, and the first is worth recording because it
produced a false pass: CDP `Network.emulateNetworkConditions {offline:true}` **does not affect an
already-open WebSocket**, so the writes went through and the import "succeeded" while the page was
nominally offline. Anyone testing an offline path in this app that way is testing nothing.

Stopping `trinity-gateway` for real gave the true behaviour, and it is good:

> **15 of 15 lines did not reach the relay, and they are NOT in your books:** 2026-12-01 STANDING ORDER
> GIVING; 2026-12-01 STANDING ORDER GIVING; 2026-12-01 J & M PATTERSON, REGULAR GIV; 2026-12-02 SUMUP
> PAYMENTS LTD SETTLEME …and 11 more. Try again.

Totals did not move, and no journal docs were written. Restarted the relay, pressed the (still-present)
post button: all 15 landed, **60 journal docs for 4 imports — no duplicates, nothing missing**, and totals
came out at exactly 4× the single-import figures (£2,326.16 / £7,775.24 / £5,449.08).

**Minor, on the retry affordance.** The failure text ends "Try again." but nothing on screen carries that
label — I searched the DOM and the only matches are inside `<script>` source. The retry is the unchanged
"Post 15 transactions" button. Discoverable, but the copy names a control that does not exist.

**Minor, a lingering alert.** After the successful retry the row-level alert *"That entry was NOT recorded
— your church's relay refused or did not answer"* was still on screen, though the import-level
"15 of 15" message had correctly cleared.

**The £4,744.09 caveat, stated plainly.** The import is arithmetically exact, but £4,744.09 is the
statement's **closing balance**, and the ledger starts from zero: net movement is £581.54. Reaching
£4,744.09 needs an opening balance of £4,162.55 (4,162.55 + 581.54 = 4,744.09 — the arithmetic checks out).
I could find no opening-balance or reconciliation feature; Finance's own Reports panel lists
"bank reconciliation" under **"Coming soon"**. So **this figure is not reachable in the product today**,
and I did not reconcile to it. That is a gap in the instruction, not a defect I can pin on the import.

---

# ITEM 4 — identity. BOTH PASS.

**4a — a display name changed twice in one sitting.** Ruth Ellery → "Ruth Ellery-Hall" → "Ruth E. Hall",
with no reload between them. Both landed:

| | relay `trinityone/name:` doc |
|---|---|
| baseline | 17:20:34 |
| after rename #1 | 17:32:44 |
| after rename #2 | 17:33:24 |

The member app held "Ruth E. Hall" on reopening the editor, and — the better check — the **steward console**
attributed her existing chat message to "Ruth E. Hall" without a reload. The "second rename silently
dropped" defect did not reproduce.

**4b — remove a message, press Undo immediately.** Ran it **4 times; 4 successes**, every one reporting
"Message put back", with the message visible again on the console AND in Ruth's app. The
"fails about half the time" defect did not reproduce.

Mechanism, for the record: removal publishes a replaceable `trinityone/hidden:<msgId>` document carrying
`{"groupId":…}`; Undo republishes the same d-tag with **empty content**. The original kind-1 is never
deleted — `deletions` is empty and there are no kind-5 events. So removal is a reversible moderation flag,
not a deletion, which is what makes Undo possible at all.

## Observation (minor, but it is the owner's own stated principle)

**The reverse action is only reachable for 9 seconds.** `showMod` sets
`modTimer = setTimeout(() => setModMsg(null), 9000)` (`app/stew-dashboard.jsx:2570-2574`), and the Undo
lives only on that banner. `unhideMessage` has no other entry point on either surface — which is exactly
what commit `2c8da57`'s predecessor found ("built on both surfaces since the feature landed and was called
by nothing"). It is now called, but only from a control that disappears after nine seconds.

I hit this by accident: I detected the Undo button, and my next command four seconds later got
`NOT FOUND: Undo`. A steward who removes a message and then hesitates — reads it again, checks with
someone — cannot put it back, and nothing tells them the window has closed.

This is worth raising because the recorded principle is "collapse answered banners after ~5s, **keep the
reverse action reachable**". The banner collapses; the reverse action goes with it.

## Also seen while doing this

- The message's `…` moderation menu button has **no text and no `aria-label`** (measured: 21px wide,
  `innerText` empty, `aria-label` null) — the same class as F1, on the control that gates Remove and Pin.
- The four column-mapping `<select>`s on the bank importer likewise have `labels:0`, no `aria-label`,
  no `aria-labelledby`, no `id` — measured.
- **The stale alert from F4's family:** "That entry was NOT recorded — your church's relay refused or did
  not answer" stayed on screen across tab navigation long after the successful retry, and is only
  dismissable by hand (it has an × ). The import-level "15 of 15" message DID clear correctly.

---

# ITEM 2 — two consoles. FIRST HALF PASSES. Second half not run (needs your consent to stop the relay).

**Setup.** Console 2 is a separate headless browser with its own fresh profile, restored from the church's
12-word phrase with a different console PIN. It picked up the whole church — Ruth E. Hall (under her
renamed name), the Whole Church group, the finance ledger — with no manual sync.

**Close on one, seen on the other: PASS.**
- Ruth (member app) sent a care request → `trinityone/carereq:1ef5136fc9322914-681c5530` on the relay, 17:44:20.
- Both consoles showed it identically: *"REQUESTS FOR HELP · 1 — Meals · for Ruth E. Hall"*.
- Closing on console 1 takes **two taps** ("Close — not needed" → "Yes, close it" / "Keep it open"), which
  is the deliberate two-tap pattern from `51dc899`. Worth knowing: my first click looked like a no-op and
  I nearly recorded it as one — it had actually turned the row into an inline confirm.
- The close published `trinityone/carereqstatus:1ef5136fc9322914-681c55` **signed by the church key**, 17:45:46.
- **Console 2 showed it closed**, unprompted and without a reload.

**Second half NOT RUN.** "Approve one with the relay unreachable for the second publish" needs the relay
stopped mid-sequence. I stopped `trinity-gateway` once earlier for the bank-import test before being asked
to check first, so I have not repeated it. Waiting on consent.

## A correct refusal worth recording, because I nearly filed it as a defect

The care intake refused my first send and I initially could not find the request on the relay. That was
**correct behaviour**: I had not picked a category, and the form was showing *"Pick what would help."* in
clay text at the bottom. A screenshot showed it; `innerText` did not surface it in the slice I read.

Twice more in this session `innerText` read as though a screen had not changed when it had — the member
onboarding wizard and the Serving→Care sheet both rendered correctly and read as stale text. **Anything
overlay-shaped in this app must be judged from a screenshot**, or the round will invent defects.

---

# ITEM 1 — safeguarding. THE GATE HOLDS, on console AND on the real phone. Skew half awaiting consent.

**Cast staged:** Sam Petrie marked as a child (relay: `trinityone/minors:` cleartext, `{"pubkeys":["e8783ee3…"]}`
— as DOMAIN.md records), Ada Whitfield cleared for youth work (relay: sealed `trinityone/clearance:1e02b3be…`),
Ruth E. Hall an ordinary adult member. Sam's request reached the relay as
`trinityone/carereq:e8783ee3730a5bf6-9a77125a`.

**The differentiation is real and starts before the request is even written.** Sam's intake form says
*"This goes privately to the people at your church who can help young people — no one else sees it"* and
its button is **"Send"**; Ruth's adult form says *"This goes privately to your care team"* with
**"Send to care team"**.

**Steward console — PASS.** The child's request is filed under a different heading entirely:

> **FROM A YOUNG PERSON · 1 · CONFIDENTIAL**
> Only people on your **cleared list** can see these, and nobody on the care rota sees them unless they are
> cleared too. Reply privately below. There is no "set up help" here on purpose: that publishes a need the
> whole church reads and signs up to, which is not somewhere a young person's request belongs. Handle it
> under your safeguarding policy.

The row offers **Message** and **Close — not needed** ONLY. **No "Set up help".** Ruth's adult request in
the same session DID offer "Set up help", so this is a genuine branch and not an absent feature.

**On the real phone (Oppo, cleared care admin, correct clock) — PASS.** Ada sees the same
"FROM A YOUNG PERSON · 1 · CONFIDENTIAL" heading, the cleared-worker explanation, and only
Message / Close — not needed. Phone clock verified in sync with the host at the time (both 18:56:52).

**NOT YET RUN: the skewed clock.** The handoff's actual question is whether the gate still holds in the
window where the safeguarding lists have NOT arrived — a skewed clock breaks NIP-42 auth, gated reads come
back empty, and the app may not know Sam is a minor. That is the "cache paints before authority arrives"
shape, and it is the half that matters most. It needs `adb shell cmd alarm set-time`, which changes the
device, so I have not run it.

Note for whoever does: my `innerText` search for "REQUESTS FOR HELP" returned "(no requests section)" on a
screen that was showing the child's request perfectly well — because the heading is different. **A probe
looking for the adult heading will report a child's request as missing.**

## ITEM 1, skewed-clock half — RUN ON THE REAL PHONE. The gate holds. A separate defect fell out of it.

Phone clock moved +15:00 (`cmd alarm set-time`), verified: phone 19:14:21 vs host 18:59:21. The relay's
NIP-42 window is **600 seconds** (`scripts/gateway.mjs:5270`, `Math.abs(now - created_at) < 600`), so a
15-minute skew must fail auth — which is what makes this test meaningful rather than decorative.

**The safeguarding gate FAILS SAFE.** With auth broken, no care surface renders at all: the "Ask for help"
card is absent from Today, and Sam's request is nowhere. So a care admin is never offered "Set up help"
for a young person's request in the cold window — because nothing is offered. That is silent absence,
which is what DOMAIN.md asks for. **Item 1's assertion holds.**

### F5 — a member with a skewed clock is told they have not been admitted, and fixing the clock does not fix it
**CONFIRMED on the Oppo, with a control.**

Ada Whitfield is an admitted, youth-cleared member — the relay holds `trinityone/member:dac19a52…`
authored by `1e02b3be` at 17:53:48, plus her sealed `trinityone/clearance:1e02b3be…`. Under the skew her
phone showed, full width on Today:

> **Waiting to be let in**
> Your request has been sent to SIM St Aidan's. A steward usually lets people in within a day — you don't
> need to do anything else.   [ **Check again** ]

Every word of that is false, and "Check again" cannot ever succeed while the clock is wrong. Nothing
mentions the clock. `relaysHealthy()` reports **true** throughout, so the app believes it is fine.

**The sticky part, which is the reason this is worth fixing.** I restored the clock (verified **drift 0
seconds** against the host) and the phone stayed on "Waiting to be let in" through:
- a `setRelays` reconnect, then 15s;
- a background → foreground cycle, then 12s.

It recovered **only after a full force-stop and relaunch**, after which `waiting:false`, the care card
returned, and the confidential young-person view came back intact (`FROM A YOUNG PERSON` ✓,
`CONFIDENTIAL` ✓, `Set up help` **absent** ✓, Sam's request present ✓).

So a member whose clock drifts is locked out of their own church, is told the wrong reason, and stays
locked out after correcting the clock until they know to force-quit the app. No member will know that.

This is the handoff's open item #1 — "a phone with a skewed clock is admitted and then silently
unauthenticated" — now demonstrated end to end on a device, with the extra fact that **it does not
self-heal**. The suggested one-line fix there ("a distinct reason plus one line on the phone") would need
to also re-attempt auth, not just explain.

### A false finding I nearly filed, recorded because the trap is cheap to repeat

My first skew run showed exactly the same "Waiting to be let in" text and no care surfaces — but the app
was sitting on the **PIN lock screen** the whole time, which `innerText` did not reveal (it returned the
stale content behind the lock). The screenshot caught it. Had I trusted the text I would have reported
this finding off an invalid run, and the clock would have been irrelevant to it.
**On this app, judge every phone screen from a screenshot.**

## ITEM 2, second half — attempted twice, NOT achieved. What I learned instead.

**I could not make only the second publish fail, and I am not going to claim I did.** Approving a request
is two publishes about **one second apart** — measured on the relay: `trinityone/care:caremtn9rn0dyvanm`
at 18:10:25 and `trinityone/carereqstatus:1ef5136fc9322914-92417352` at 18:10:26. I stopped
`trinity-gateway` 0.47s after the click and **both still landed**. So the "help is set up, the request is
still open" line was never triggered and remains unverified.

First attempt missed for a different reason worth noting: **"Set up help" only opens a dialog** — it
publishes nothing. The publishing action is "Open the need", and it is gated on picking dates
("Pick the days first — a need with no days is one nobody can sign up to"). A timing test aimed at the
wrong button proves nothing.

### F6 — after a relay blip, the console shows an already-handled request as still needing action
**CONFIRMED, with a reload as the control.**

With the relay stopped mid-operation and then restarted, console 1 showed, simultaneously:
- **OPEN NEEDS — Ruth E. Hall, Meals · 3 days, 0/3** (the need had been created), and
- **REQUESTS FOR HELP · 1 — Meals · for Ruth E. Hall … [Set up help]** — the very request that need came
  from, still offered for setting up.

The relay disagreed: it held the `carereqstatus:…92417352` marking that request handled, published at
18:10:26 by this same console. A **reload fixed it completely** — the Meals request vanished, the newer
Rides request appeared in its place, and OPEN NEEDS stayed correct.

So the stale state was in the console, not the relay, and it survived the socket coming back. Note the
console *did* receive new events after reconnect (Ruth's later Rides request arrived), so this is not
"subscriptions are dead" — it is that the handled-status did not take effect in the view.

Consequence: a steward who sets up help during a network blip sees the request still asking to be set up,
and the obvious action is to set it up a second time. This is the shape recorded in
`chat-subs-die-on-reconnect` — a returning socket, and `relaysHealthy()` reporting true throughout.

---

# ITEM 5 — what felt wrong, from several hours of actually driving it

Not a separate 20-minute pass: this is the friction that accumulated while doing items 1–4, which is
better evidence than a walk-through with no task in hand.

## The thing a churchwarden would notice first

**Every screen shouts that nothing is saving, and it is wrong** (F4). It is the largest, reddest thing on
the page, it is on all ten tabs, it survives reloads, and it appeared on a brand-new second console within
seconds of restoring the church. Everything underneath it works perfectly. A steward has no way to tell
it is lying, and the natural response — stop, or redo the setup — is the wrong one.

## Failure messages that outlive the failure

The row-level alert *"That entry was NOT recorded — your church's relay refused or did not answer"* stayed
on screen through tab navigation long after the retry had succeeded, and is only dismissable by hand. The
import-level message beside it cleared correctly, so the two behave differently on the same screen. After
a while the console accumulates warnings that describe things that are no longer true.

## Copy that names a control that does not exist

The import failure ends *"Try again."* There is no Try again. I searched the DOM: the only matches are
inside `<script>` text. The retry is the unchanged "Post 15 transactions" button.

## Actions that look like they did nothing

Two separate two-tap confirms — closing a care request, and the console's decline flow — respond to the
first tap by *replacing the button with a confirm pair*. That is good design, but if you are not looking
at that exact row it reads as "my click did nothing", and I nearly filed it as a broken control. So did
the Groups wizard step, for the opposite and worse reason: there it really had done nothing (F2).

## A reverse action with a nine-second life

Undo after removing a message disappears after 9 seconds and has no other entry point (item 4). I lost it
by pausing to read the screen. A steward who removes a message and then thinks about it cannot put it back.

## Controls a screen reader cannot name

Measured, not guessed — all have `labels:0` and no `aria-label`:
- the three recovery-phrase quiz boxes, on **both** console and phone (F1) — the phone's three share the
  identical placeholder "type it here", so all three announce the same;
- the `…` menu on a chat message, which is the only route to Remove and Pin;
- the four column-mapping selects in the bank importer;
- the 12-word textarea on "Restore a church" — the field that takes the church key.

Against that, the per-member safeguarding buttons are exemplary: `"Mark as a child: Sam Petrie"`,
`"Clear for youth work: Ada Whitfield"`. The good pattern already exists in the codebase.

## The console locks often

It auto-locked three times during the session, twice mid-task, each needing the full passphrase again. It
is the right instinct for a key-holding device, but a churchwarden working through setup will hit it
repeatedly, and there is no "still working" grace.

## What felt genuinely good, because that is worth recording too

- **The bank import's failure reporting.** "15 of 15 lines did not reach the relay, and they are NOT in
  your books", then it names them and keeps the rows. That is the standard the rest of the app should meet.
- **The safeguarding copy.** The young-person section explains the consequence rather than the mechanism,
  and says *why* there is no "set up help" instead of silently omitting it. The child's own intake form is
  worded differently from the adult's before a single word is typed.
- **The care intake refusing an incomplete request** with "Pick what would help." — though it sits at the
  bottom in small clay text and is easy to miss above the fold.
- **Restoring a church onto a second console** took a phrase and a PIN and brought over everything,
  including a rename made minutes earlier.

---

# Minor, found during cleanup

`POST /config {removeChurch:{npub}}` dry-run reports **`wouldDelete: {events: 119}`**. But the three modes
(`gateway.mjs:4055-4062`) are: no flags = dry run; **`confirm` = de-provision and KEEP the data**;
`confirm + purge` = erase. So `confirm` alone deletes nothing, and the dry run's `wouldDelete` describes
only the `purge` path. An operator reading that number before pressing the safer of the two buttons is
told they are about to destroy 119 events when they are not. Verified: after `confirm` (no purge), the
church list was back to one entry and all **119 events remained** in `relay.sqlite`.

The separation itself is well judged, and the comment says why: *"an operator may remove a church to
protect it, and must not have its history deleted as a side effect of that intent."* Only the dry-run
wording is misleading.

---

# State left behind

- **`SIM St Aidan's` de-provisioned** from the relay (`confirm`, no purge). Relay's church list is back to
  `St Editha's, Marchwood` alone. Its **119 events remain** in `relay.sqlite` — purge with
  `{removeChurch:{npub,confirm:true,purge:true}}` if they are not wanted.
- **No source edited, nothing committed, nothing deployed.** The only repo change is this file.
- `trinity-gateway` was stopped and restarted three times during the session (bank import ×1, care approve
  ×2) and is running.
- Keys, PINs and recovery phrases for the staged church and its three members were written to the session
  scratchpad only, never to the repo.

---

# WHAT WAS FIXED, 2026-09-04/05 — and what the audits cost

Six commits on `fix/session-2026-09-04`. Suite 2665 -> 2731 (2730 pass, 0 fail, 1 todo). Nothing deployed.

| | |
|---|---|
| `625bfdb` | a new church stops being orphaned from its own box; a Suite box auto-registers |
| `f0ceb92` | the false "nothing you set up will save" banner; a durable "Put back"; repairs from audit #1 |
| `42f8080` | the recovery worked by accident of boot timing, and its test stubbed the reason |
| `7f5eed0` + `52ceada` | a relay holds a petname, not a church name; then the repairs that migration needed |
| `dd22062` + `48df084` | a refused proof stops meaning "you are not admitted"; then the repairs THAT needed |
| `22870fc` | the wizard stops advancing over rooms it never made; five controls named; care survives a reconnect |

**Every one of the three fix batches needed repair after an audit, and two of the repairs needed repairing.**
That is the headline. The audits were not a formality; they found defects I had shipped into the branch,
including two that were WORSE than the bug being fixed:

- a guard keyed on a per-BROWSER record, so a church restored from its phrase could never record a
  legitimate "this box is not ours" again;
- a clock fix that gave every member a church had BLOCKED a permanent 90-second reconnect loop against the
  relay that removed them, and told them their clock was wrong.

Three faults were found only by driving the phone, and could not have been found any other way: a skew
measurement that asked one relay and gave up (so the recovery never fired at all); a retry cooldown measured
on the very clock it was recovering from; and a card that flickered between two wordings every 90 seconds.

## My own audit of items 2 and 3, since the agent for it was lost

- **`publishGroup`'s failure contract, settled by reading the code rather than the comments.**
  `_publishToRelays` returns the event ONLY when every target accepted (`accepted === targets.length ? evt
  : false`), so `publishGroup` yields an object with a valid `ts`, or `null`. `saveGroups`' `if (!pub)` is
  therefore complete for both partial and total failure.
  **Stale comment, not fixed:** `app/stew-dashboard.jsx:2401` says "publishGroup resolves an object even
  when every relay refused — `ts` is false in that case". That is not true of the current code. The
  `!pub.ts` check beside it is harmless, but the comment will mislead whoever reads it next.

- **164 controls in `app/*.jsx` have NO accessible name at all** — no `aria-label`, `aria-labelledby`, `id`,
  placeholder or title. Comments stripped; file/checkbox/radio inputs excluded. Concentrated in
  `stew-dashboard.jsx` (58), `screens-chat.jsx` (15), `stew-finance.jsx` (12), `screens-giving.jsx` (11),
  `screens-today.jsx` (11), `stew-schedule.jsx` (11), `screens-library.jsx` (10).
  This week fixed FIVE of them, chosen by consequence (the recovery-phrase quiz on both surfaces, the
  moderation menu, the import column selects, the restore textarea). **The pattern is systemic and hand-
  fixing it will not converge** — the existing sweep test only looks at `type="password"`. What is wanted
  is a test that fails on any NEW unnamed control, plus a prioritised pass over the 164; that is its own
  piece of work and is NOT started.

## Still open

- `removed` / "waiting for approval" is consumed correctly on Today and Chat only. Four other screens
  (`screens-serving.jsx` x2, `screens-chat.jsx` elsewhere, the approved-toast) still assert a waiting state
  under a refused proof. Additive, so nothing regressed — but "the screen stops guessing" is true of two
  screens, not seven.
- The relay's NIP-42 window is untouched, by the owner's standing decision. A phone more than 5 minutes out
  still cannot authenticate; it now says so and recovers by itself once the clock is right.
- A church's name is still in its kind-0 profile, in cleartext, and that is public by design — see DOMAIN.md.
  The petname change did NOT close that and must not be described as if it did.
