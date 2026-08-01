# Handoff — 2026-07-31 (second pass): the console write path, five audits later

Everything below was **measured**, not reasoned, unless marked SUSPECTED. This supersedes the numbers in
`HANDOFF-2026-07-31-CONSOLE.md` but not its findings — read that one first for the original six.

---

## Start here

**Nothing is merged and nothing is deployed.** `main` is untouched at `155485c` / 812 tests. The work is eleven
commits on `fix/console-write-path-2026-07-31`, at **895 tests / 895 pass / 0 fail / 0 skipped**. a8 still runs
`8a6cecf`.

**UPDATED 2026-08-01.** Two more commits since the text below was written — `18c338c` (false safeguarding
alarms) and `dfa4baa` (the clearance the member actually applies). Both are measured in the SECOND simulation
run further down, which supersedes the first run's table. A seventh audit is running against them.

**FIVE audits have run.** Audits 1–3 each found bugs the previous round's fixes introduced. Audit 4 found three
confirmed defects and overturned two of my written conclusions. Audit 5 overturned another and found two more,
one of them critical. All of audit 5's blockers are now fixed, tested, and sabotage-verified — but that pattern
is the most important thing on this page: **every single round has found something real, and most rounds found
it in the previous round's fix.** Do not merge without a sixth audit.

**Verified since the last round:** full suite stable at 886 over three runs; smoke test 7/7; and a real browser
against a real relay confirms the audit-5 case — after a relay restart, an ordinary READ no longer makes the
console report itself healthy (`afterReadHealthy: false`, `relaysReplaced: true`, so the ticker acts).

**The one thing the browser run could NOT verify** is saving after recovery, because the console never
authenticated at all in that probe — the pre-existing `restoreKey` re-auth gap below. That gap is not caused by
this branch (measured identically on `main`), but it means "a restored console can save again after a drop"
remains unproven end to end.

## What landed

| commit | what |
|---|---|
| `71e09eb` | the original six fix-plan items |
| `79c62dd` | reverted item 2 after audit 1; closed four audit-1 findings |
| `cc9d71f` | read-before-write for clearances (handoff item 7) |
| `793c5e9` | reconnect probe instead of backoff; removal breadcrumb |
| `4883c97` | audit-3: a boot that deleted a live key, a probe that hung |
| `c1547e9` | the four-audit write-up (superseded by this file) |
| `a31267e` | audit-4: the read/write asymmetry attempt, and the test un-skipped |
| `e11d2a7` | audit-4 B3: ask every connected relay, not a union |
| `270b290` | audit-4 B5/B4/B6/B7: the helpers' console, and three smaller ones |
| `aedfca7` | audit-5: reads reopen sockets too; a late Keystore delete now repairs itself |

16 files, ~4000 insertions. Source changes are confined to `src/steward.src.js`, `app/stew-dashboard.jsx`,
`app/steward-root.jsx` (+ the rebuilt `vendor/steward.js`). Three new test files:
`console-publish-honesty`, `console-relay-health`, `console-relay-auth-state`.

**The headline fix works.** Measured in a real browser against a real relay, branch vs `main`:

| with the relay killed | main | branch |
|---|---|---|
| `relaysHealthy()` | `true` | **`false`** |
| `publishClearance()` | returns the event (**"saved"**) | **`false`** |
| whole-roster back-fill | `{failed: 0}` | **`{failed: 1}`** |

Read-before-write also works live: a repeat Members visit skipped **6 of 6** clearances, and a freshly-loaded
console still skipped them (so the skip comes from the relay, not page memory).

---

## Corrections to earlier conclusions — read these before trusting the older notes

**A1. The quarantine reason on the skipped test is WRONG, and it is my error.**
`scripts/console-publish-honesty.test.mjs:500` says the test is skipped because *"the console loses its
authenticated socket mid-run"*, and tells the next engineer to *"make the authenticated socket stable"*. That
is a misdiagnosis. Audit 4 un-skipped it, instrumented every socket close and the relay's refusal reason, and
ran it 24 times: **4 failures, zero socket closes, `authed === true` throughout**. The real cause is the NIP-01
tie-break between two writes of *different* content in the same wall-clock second — the test seeds 12 members
as adults and starts toggling 0.5–1.5 s later, so the seed and the first toggles share a second.
Read-before-write cannot help (the content genuinely differs) and is not supposed to.

Corroboration that the stated cause is impossible: `pruneIdleRelays` exists in the bundle but is **never
called**, and `enablePing` is never set — there is no idle-prune to fix.

**Fix is one line: give the seed ≥1.1 s before the first toggle, then delete the skip.** Also note the test's
`assert.equal(stored, 12)` counts d-tags present, not content, so a member left holding a *stale* clearance
would pass it.

**A2. Half of the argument for reverting fix 2 was theatre.** The clock-skew half is sound and was verified
independently: the relay accepts `created_at` up to +900 s, the console only rejects beyond +600 s, `_authFuture`
is applied to every safeguarding *list* read but **never to a clearance event** (including the new
`_newestByD` results), and a delegated steward's clearance writes really are accepted by the gateway. So a
steward's phone running 1–15 minutes fast can store `{minor:false}` that the honest correction can never
displace. Keep the revert on that basis.

The "a compelled relay could fake that refusal string" half does **not** hold: a compelled relay can simply
answer `OK true` and drop the event, and nothing in the console verifies storage. Accepting have-newer granted
an adversary no capability they lacked. Do not reuse that reasoning elsewhere as if it were load-bearing.

---

## Open, ranked by what a steward or child experiences

Everything audits 1–4 raised is now closed except the items below. The two audit-5 blockers (a read re-opening
the socket, and a hung Keystore delete landing late) are fixed in `aedfca7`.

**Backlog from audit 5, none of them blockers:**

- **The reconciliation's reach is narrower than its commit claims.** `_clearanceSent.clear()` on reconnect only
  matters inside a 15s window, and the real repair — the per-relay read — needs a *later* back-fill, which
  `clearanceBackfillDone` suppresses while the roster signature is unchanged. Cross-session healing works;
  same-session healing often will not.
- ~~**Read-before-write verifies only its OWN author.**~~ **CLOSED 2026-08-01 in `dfa4baa`** — and it was not
  unlikely. It does NOT need the two consoles to disagree about the `minors:` list: a steward's console
  back-filling from a roster subscription that has not caught up is enough, which is an ordinary Tuesday. See
  the section below. Reproduced against a real relay, asserting what the child's phone reads.
- **B7's retained breadcrumb is still never acted on.** `encBlobWrite` now keeps it when the hardware write
  fails, but the next boot's resume discards it at its entry guard. The previous church's ciphertext stays in
  the Keystore. Harmless to data; matters a little under the seizure model. Wants a separate stale-slot marker.
- **The per-relay skip loop is default-ALLOW.** If `perRelay` were ever empty the loop body would not run and
  every member would be skipped. Unreachable today (`readFrom.length` guards it), but it is one deleted
  condition from silently stranding a roster. Invert it. **Still open, and now slightly worse:** the same loop
  gained a second default-allow in `dfa4baa` (`sawAll` starts true), so an empty `perRelay` would also mark
  every member `seen` — i.e. condemn them with the definite wording instead of the honest one.
- **The un-skipped toggle test has no delay between its four iterations**, so the same-second collision it was
  fixed for could recur between iterations. Did not fire in 18 runs; one `sleep(1100)` would make it durable.

**Pre-existing, not this branch.** `restoreKey()` does not trigger a re-auth, so a console restored from its
12 words cannot save anything until the socket is replaced by a reload or a relay restart — measured
identically on `main`. Matches the known pin-lock-breaks-relay-auth note, whose fix was re-auth-on-unlock;
restore/adopt appear to have missed it. **This now also blocks end-to-end verification of the recovery path**,
so it is worth doing next.

~~**Also pre-existing:** B8, the 8s batch race~~ — **CLOSED 2026-08-01 in `18c338c`**, along with three other
causes of the same false banner that only showed up once B8 itself was out of the way.

**Two UI defects found on the phone.** The care confirmation card wraps its title one word per line at 720px.
"Withdraw" retracts a request for help immediately, with no confirm and no undo (sits with the open U7 item).

## Network simulation — SECOND RUN, after the two fixes (2026-08-01)

Same eight profiles, same measurement, `node scripts/netsim-console.mjs`. The metric is now split, because the
first run was scoring two different things as one. A banner that says *"N members did not receive their
record"* is a CLAIM OF FAILURE; one that says *"couldn't confirm these saved"* is an admission of ignorance.
On a link too poor to read back, the second is the honest thing to say and must not count as crying wolf — but
it must never be allowed to masquerade as the first.

| link | children delivered | told "saved" falsely | **cried wolf** | said "couldn't confirm" |
|---|---|---|---|---|
| fast | 3/3 | no | 0 | 0 |
| DSL | 3/3 | no | 0 | 0 |
| 2G/EDGE | 3/3 | no | **0** (was 1) | 0 |
| satellite | 3/3 | no | **0** (was 1) | 1 |
| awful (2.5s RTT, 4 kB/s) | 0/3 | no | 0 | 0 |
| link cut mid-write, 2G | 3/3 | no | **0** (was 1) | 1 |
| blackholed mid-write, 2G | 0/3 | no | 0 | 0 |
| second visit, nothing changed, 2G | 3/3 | no | — | **published 0, skipped 8/8** |

**Cried wolf: NONE, on any profile.** No scenario now tells a steward a child lost their safeguarding record
when the record is on the relay. `lied = false` still holds everywhere, and the genuinely broken links (awful,
blackholed) still report failure rather than being softened into silence.

B8 is closed. Three separate causes, each the same mistake at a different depth — treating *"I did not see it"*
as *"it did not happen"*:

1. **The fixed 8s batch bound.** Now derived from `pool.maxWaitForConnection` + the publish bound, and
   unacknowledged members are collected as UNCONFIRMED rather than counted as failed.
2. **No verification before the alarm.** Unconfirmed members are read back before anyone is told anything. Most
   of them are simply there. The read is SHARED with read-before-write (`_clearancesMatching`) rather than
   duplicated — the copy that decides whether a safeguarding warning is true must not drift from the copy that
   decides whether to write.
3. **An unfinished read taken as proof of absence.** `_newestByD` resolved with whatever had arrived when its
   timer fired, indistinguishable from a relay that answered fully and held nothing. It now reports whether it
   reached EOSE.

And a fourth, found only because the second run put the numbers back up: **a read can overtake its own write.**
On satellite the verify read got an honest EOSE from a relay that had genuinely not received the still-in-flight
writes yet, and condemned 7 of 8 members whose records stored moments later. A completed read is not enough to
condemn — the console must also have SEEN the record. Read-it-and-it-is-wrong stays a plain *"did not receive"*;
read-and-found-nothing is *"couldn't confirm"*.

### The one that only the member's phone could see (commit `dfa4baa`)

Not from the simulator — from asking a different question in the tests: *what does the CHILD'S APP read?*

A replaceable event is keyed by `(pubkey, kind, d)`, so the church's copy of a member's clearance and a
steward's copy are **two separate documents that never collide on the relay**. The member's app takes the newest
across all authorised writers. Read-before-write read `authors: [its own key]`. So the console was asking *"did
I write what I meant to"* when the question is *"does the member see what I meant"*.

Reproduced end to end: owner marks a child → a delegated steward's console back-fills from a roster view that
has not caught up and writes its own copy saying "not a minor" → the owner's next Members visit reads its own
copy, finds it correct, and reports **1 skipped, 0 failed, no banner**. The child's app reads "not a minor" and
nothing ever retries.

The read now takes every author and compares the copy on TOP — which then needs a rule for who gives way,
because "rewrite whenever someone else is on top" is symmetric, and symmetric means a fight: two consoles would
rewrite the whole roster past each other on every visit, permanently, which is the exact cost read-before-write
was added to remove. `_clearanceOutranks` is asymmetric on purpose: the church key outranks every steward
(`minors:`/`approved:` are owner-only documents, so the owner's console is the authority by construction and a
steward's is only mirroring), and between two stewards the hex pubkey breaks the tie. Arbitrary but stable, and
stable is the whole requirement — exactly one of the pair gives way.

**A trap that nearly shipped inert.** Commit A's `complete` flag was patched into `_one()` by mistake — same
three lines, wrong function — so `definitive` was hardcoded false and half the fix did nothing. Its test passed
anyway, because the other guard covered the same case. It was caught by reading the function while doing
something else, not by the suite. If you take one method note from this page, take that one: **a green test
does not prove the code you think you changed is the code that ran.**

Tests: 895/895. Five new in `console-publish-honesty.test.mjs`, every guard sabotaged INDIVIDUALLY — including
one sabotage that had been reaching only part of the lifted source and so was matching nothing.

Browser: the real `steward.html` loaded headless against the branch bundle (sha reported, unique
`--user-data-dir` so no service-worker cache) — `window.Steward` wired, real UI rendered, **zero uncaught
exceptions**.

## Network simulation — the console over a bad link (2026-07-31, FIRST RUN, superseded above)

`scripts/netsim-console.mjs` + `scripts/netsim-link.mjs`. Not part of `npm test`; run by hand when the write
path changes. The 2026-07-14 sims measured the RELAY (DoS, partition, scale); this measures the CONSOLE, which
is a different question and the one this branch is about. The link shim models what a bad path actually
presents to an application — latency, jitter, a bandwidth ceiling, connection churn, and BLACKHOLE (accept the
socket then say nothing, the DPI/half-open-NAT case). It deliberately does not drop packets: TCP retransmits,
so byte-level loss would corrupt WebSocket framing and test the wrong thing.

Marking 3 children out of an 8-member roster, measuring whether each child's record actually ARRIVES and
DECRYPTS to `minor: true` — presence is not enough, a stale record passes a presence check and still tells a
child's app they are an adult:

| link | children delivered | told "saved" falsely | false alarms | bytes |
|---|---|---|---|---|
| fast | 3/3 | no | 0 | 9 kB |
| DSL | 3/3 | no | 0 | 9 kB |
| 2G/EDGE | 3/3 | no | **1** (`failed=3` of 8) | 9 kB |
| satellite | 3/3 | no | **1** (`failed=6` of 8) | 8 kB |
| awful (2.5s RTT, 4 kB/s) | **0/3** | no | 0 | 0 kB |
| link cut mid-write, 2G | 3/3 | no | **1** (`failed=2`) | 8 kB |
| blackholed mid-write, 2G | **0/3** | no | 0 | 1 kB |
| second visit, nothing changed, 2G | 3/3 | no | — | 10 kB, **published 0 events, skipped 8/8** |

**The headline fix holds everywhere.** `lied = false` in all eight scenarios: the console never reported a save
that did not happen, on any link, including mid-write cuts and blackholes. That is what this branch was for and
it is now measured under adverse conditions rather than only against a healthy or hard-killed relay.

**Read-before-write works on a slow link too** — a repeat visit published nothing at all and skipped 8 of 8.

**But the alarm fatigue is NOT fixed for real links, and this is the finding.** On every link slower than DSL
the steward is warned that children did not receive their safeguarding record while all of them did: 3 of 8
reported failed on 2G, 6 of 8 on satellite. The cause is not the tie-break this branch fixed — it is the 8s
batch bound in `refreshClearances` racing `maxWaitForConnection` 3000 + `publishTimeout` 4400 = 7400 ms worst
case. That is **B8 / original handoff finding 6**, carried as backlog through six audits on the grounds that it
was theoretical. It is not theoretical: it fires on the ordinary connection this product is built for, and it
produces exactly the false banner the branch set out to remove. **Promote it to a blocker.**

On the two worst profiles nothing is delivered at all. For the blackhole that is arguably honest (the link is a
black hole and the console says so); for "awful" it means a 2.5s-RTT link cannot complete a back-fill within
the current bounds — the same B8 arithmetic, one step further.

**A methodology trap worth keeping:** the first run crashed mid-matrix and left its gateway behind. The next run
then reported 0/3 on EVERY scenario including the fast one, because the stray relay answered `/status` with a
different church key and refused every write. `scripts/test-ports.mjs` exists for exactly this — it usually
makes broken code look green; here it made working code look catastrophic. The sim now calls `requireFreePort`
and cleans up on `uncaughtException`.

## Device + smoke coverage added today (Oppo, build 197, Test Church 01, PIN `778899`)

| route | result |
|---|---|
| the "No messages yet" question | **ANSWERED — the preview is not broken.** The relay holds exactly 1 kind-1 across all 9 rooms; the room that has it displays it with the right date and unread badge. The console's "42 messages" is a different metric (`subscribeMembers` counts kind-1 tagged `['p', churchPub]` by author, all rooms, all time) — so that console was on a different church. |
| chat posting | **pass** — posted, outbox drained to 0, relay echoed both messages back decrypted |
| reader | **pass** — John 1 BSB, headings, cross-refs, Notes rail |
| settings + recovery | **pass** — identity lock on, backup + recovery key, "Relays: 2 connected", v0.9.71 (197) |
| care, full round trip | **pass** — intake → submit → **survives force-stop + cold boot + PIN unlock** → withdraw. Test church left clean. |
| calendar | **pass** — July 2026, today marked, event dots |
| safety check | **not covered** — needs a steward to start a roll-call |
| smoke test | **7/7** |

---

## Method notes that cost real time today

- **A headless-chromium probe MUST use a unique `--user-data-dir` and report which bundle it loaded.** The
  service worker caches `vendor/*.js`, so a fixed profile serves the first run's bundle for ever. This
  silently invalidated a branch-vs-main comparison — both runs were the same build and "the fix changed
  nothing" was the answer it gave.
- **esbuild renames imported bindings** (`finalizeEvent2`, `normalizeURL2`, `encrypt3`, `decrypt3`). Bind what
  the bundle emitted. Binding `finalizeEvent` made the auth signer throw, no AUTH frame was ever sent, and
  every private read came back empty — while `_isRelayAuthed()` still said true, which is how audit-2's
  finding 6 (record-before-sign) turned out to matter.
- **`grab()`-style lifting must anchor on the declaration.** After adding a wrapper, the first textual match
  for `refreshClearances(` / `_isRelayAuthed(` / `_refreshClearancesNow(` is a *call site*, and brace-matching
  from there silently returns a different function's tail.
- **Fixed-window slices rot.** `slice(at, at + 2600)` from a method that became a short wrapper reads past it
  into the neighbour and asserts nothing.
- **Do not run `npm test` while another suite is running** (e.g. an audit agent's). These tests bind fixed
  ports; a concurrent run produced 6 failures that looked exactly like a flake. `requireFreePort` exists for
  this.
- **Node's `server.close()` waits on open sockets** — destroy them or a probe hangs the whole file.
- **Audit subagents must run with `isolation: "worktree"`.** "Delete your probes when done" is compliance, not
  isolation.
- **Screenshot the phone; `innerText` lies under overlays.** A tap at the pre-keyboard coordinate hit the
  clipboard panel instead of Unlock.

---

## If you do nothing else

Land B1/B2 (one fix), B3 (one line), and A1 (one line + delete the skip). Then re-audit, in a worktree, and
put the console in front of a real browser again before any phone sees it.
