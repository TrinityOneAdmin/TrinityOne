# Handoff — 2026-07-31 (second pass): the console write path, five audits later

Everything below was **measured**, not reasoned, unless marked SUSPECTED. This supersedes the numbers in
`HANDOFF-2026-07-31-CONSOLE.md` but not its findings — read that one first for the original six.

---

## Start here

**Nothing is merged and nothing is deployed.** `main` is untouched at `155485c` / 812 tests. The work is nine
commits on `fix/console-write-path-2026-07-31`, at **886 tests / 886 pass / 0 fail / 0 skipped** (three
consecutive runs). a8 still runs `8a6cecf`.

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
- **Read-before-write verifies only its OWN author.** The member accepts a clearance from the church or any
  current steward, newest-wins. A stale doc written by a *different* trusted author can therefore no longer be
  displaced by the console that did not write it. Needs the two consoles to disagree about the owner-signed
  `minors:` list, so unlikely — but it is the same shape as the multi-relay bug, one level up.
- **B7's retained breadcrumb is still never acted on.** `encBlobWrite` now keeps it when the hardware write
  fails, but the next boot's resume discards it at its entry guard. The previous church's ciphertext stays in
  the Keystore. Harmless to data; matters a little under the seizure model. Wants a separate stale-slot marker.
- **The per-relay skip loop is default-ALLOW.** If `perRelay` were ever empty the loop body would not run and
  every member would be skipped. Unreachable today (`readFrom.length` guards it), but it is one deleted
  condition from silently stranding a roster. Invert it.
- **The un-skipped toggle test has no delay between its four iterations**, so the same-second collision it was
  fixed for could recur between iterations. Did not fire in 18 runs; one `sleep(1100)` would make it durable.

**Pre-existing, not this branch.** `restoreKey()` does not trigger a re-auth, so a console restored from its
12 words cannot save anything until the socket is replaced by a reload or a relay restart — measured
identically on `main`. Matches the known pin-lock-breaks-relay-auth note, whose fix was re-auth-on-unlock;
restore/adopt appear to have missed it. **This now also blocks end-to-end verification of the recovery path**,
so it is worth doing next.

**Also pre-existing:** B8, the 8s batch race (original handoff finding 6, never addressed).

**Two UI defects found on the phone.** The care confirmation card wraps its title one word per line at 720px.
"Withdraw" retracts a request for help immediately, with no confirm and no undo (sits with the open U7 item).

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
