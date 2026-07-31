# Handoff — 2026-07-31 (second pass): the console write path, four audits later

Everything below was **measured**, not reasoned, unless marked SUSPECTED. This supersedes the numbers in
`HANDOFF-2026-07-31-CONSOLE.md` but not its findings — read that one first for the original six.

---

## Start here

**Nothing is merged and nothing is deployed.** `main` is untouched at `155485c` / 812 tests. The work is five
commits on `fix/console-write-path-2026-07-31`, at **871 tests / 870 pass / 0 fail / 1 skipped** (verified 3
runs back to back). a8 still runs `8a6cecf`.

**The branch is a clear net improvement and it is not ready for a phone.** Four adversarial audits ran; each
found something real, and **three of the four found bugs in the previous round's fixes**. The fourth audit
overturned one of my own written conclusions. Three things should land before merge — B1/B2, B3, A1 below.

**The single worst open item (B1) is a stuck state this branch CREATED**: after any relay restart the console
can end up refusing every safeguarding write with *"this device hasn't finished connecting… wait a moment and
try again"*, and waiting never helps. On `main` those writes went through (dangerously). The branch turns
silently-dangerous into permanently-refused.

---

## What landed

| commit | what |
|---|---|
| `71e09eb` | the original six fix-plan items |
| `79c62dd` | reverted item 2 after audit 1; closed four audit-1 findings |
| `cc9d71f` | read-before-write for clearances (handoff item 7) |
| `793c5e9` | reconnect probe instead of backoff; removal breadcrumb |
| `4883c97` | audit-3: a boot that deleted a live key, a probe that hung |

14 files, ~2700 insertions. Source changes are confined to `src/steward.src.js`, `app/stew-dashboard.jsx`,
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

**B1 — CONFIRMED, worst. After a drop the console goes blind AND write-locked, while reporting itself healthy.**
The drop deletes the relay from `pool.relays` and destroys every subscription. Then *any* ordinary read or
write — a tab switch, a save, any `_one()` — re-opens the socket via `ensureRelay`. Now `st.get(url) === true`,
so `relaysHealthy()` returns true (ticker never fires), `reconnectDownRelays()` skips the relay and returns
false (nothing re-subscribes), and the gateway's lazy NIP-42 means nothing re-authenticates — so
`_isRelayAuthed()` stays false for the rest of the session. Measured:

```
B. relay killed                 : authed=false  healthy=false     <- the branch's fix works here
C. socket re-opened by a write  : authed=false  healthy=true   probe: came-back=false
D. 6s later, more writes        : authed=false  healthy=true
E. after a NEW gated sub        : authed=true
```

Consequence: `_requireTrustedView` throws for the minors list, approved list, blocklist and photo settings;
the care-key, name-key, group-key and media paths all refuse. Only a tab switch or reload recovers.

**B2 — CONFIRMED. HANDOFF finding 4 is not actually closed in the common case** — same root cause. A live
subscription still misses events after a restart while `relaysHealthy()` reads true, once any ordinary write
has re-opened the socket. The branch closes it only for the window between the drop and the next read/write,
which on a real console is seconds. Not a regression (main was blind too), but the branch's claim is overstated.

**B1 and B2 share one fix:** a per-URL *connection epoch*, bumped whenever `pool.relays` loses or replaces an
entry, compared against the epoch at the last re-subscribe. `relaysHealthy()` currently asks "is a socket
open?"; the ticker needs "has the connection I subscribed on been replaced?". The re-subscribe issues gated
REQs, which re-authenticates — so this closes B1 too. `_authedRelays` already stores the `AbstractRelay`
instance, so half the machinery exists.

**B3 — CONFIRMED regression. Read-before-write makes partial relay replication permanent.** `publish()`
succeeds via `Promise.any` (one relay is enough) but `_newestByD` unions *all* relays. Once relay A holds a
clearance, every later visit skips that member and relay B never receives it. Measured with two independent
gateways: `stored on A: 3/3, stored on B: 0/3`, and after a retry visit from a fresh console, still `0/3`. On
`main` the unconditional republish healed this. Scope: the default `relays()` is the canonical *pair*, which is
two routes to one box, so a default church is unaffected; it bites a church with a genuinely distinct second
relay. Harm when it bites: a child's app reads no clearance, falls back to the `minors:` list the relay won't
serve them, and is treated as an adult. Cheap fix: only skip when every URL in `relays()` held the doc.

**B4 — CONFIRMED. The breadcrumb guard does not hold across the await.** `encBlobRemoveResume()` checks
`lsGet(ENC_LS)` *before* an unbounded native call and never re-checks, and it is fire-and-forget from `init()`
with nothing serialising it against `encBlobWrite()`. A hung `S.remove` can land *after* a new church key is
written, destroying it — the exact end-state audit 3 described. The 3 s race on the button makes "reload while
the bridge is still working" a design guarantee, not an accident. Fix: re-check immediately before `S.remove`,
and bound it.

**B6 — SUSPECTED (high confidence). `_clearanceSent` survives a church switch.** `setActiveIdentity` clears
every other per-church global, each with a comment naming the bug that carrying it across caused.
`_clearanceSent` is keyed by member pubkey only and is not cleared, so within 15 s of switching, a member in
both churches can be skipped for the wrong one. One line.

**B5 — CONFIRMED. Read-before-write is inert for a delegated steward console.** In delegated mode the
clearance is authored under the *steward's* pubkey while `_newestByD` filters on the *church's*, and the seal
uses a different key. So the branch's headline cure does not apply to the console that actually marks children
in practice. Not a regression; the reach is narrower than the comments claim.

**B7 — LOW.** `encBlobWrite` clears the breadcrumb *before* attempting the hardware write, so a failed write
loses the retry marker while the previous ciphertext is still in the Keystore.

**B8 — LOW, pre-existing (original handoff finding 6, never addressed).** The 8 s batch race vs a 7.4 s worst
case. It now costs more: a spurious timeout marks 20 members failed, fires the banner, and trips the 60 s
cooldown.

**Pre-existing, not this branch.** `restoreKey()` does not trigger a re-auth, so a console restored from its
12 words cannot save anything until the socket is replaced by a reload or a relay restart — measured
identically on `main`. Matches the known pin-lock-breaks-relay-auth note, whose fix was re-auth-on-unlock;
restore/adopt appear to have missed it.

**Two UI defects found on the phone.** The care confirmation card wraps its title one word per line at 720px
(Message/Withdraw squeeze the text column to ~110px). "Withdraw" retracts a request for help immediately with
no confirm and no undo — sits with the open U7 item.

---

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
