# Fix plan: a relay must declare where it answers, and the guard must run

Branch `relay/closed-network` @ `b567bad`. **NO-GO to merge until items 1–3 land.**

The branch's security design (§1, §2, §3a, §3c of `PLAN-T1-ONLY-2026-09-02.md`) is sound and is **not**
what this fixes. This fixes the operational half: a relay cannot declare the address it is actually
reached at, and every check that should have caught that reports success.

**The failure shape you are working against:** all 124 tests on this branch pass, and the defect is
invisible to every one of them. **A green suite is not evidence for any change made here.**

---

## MEASURED ON THE a8 ITSELF, 2026-09-02 — closes two of the audit's unverifiable items

The auditor could not see that box. The owner ran the checks. Results:

| Check | Result |
|---|---|
| Service | `trinityone-relay.service` (system-wide), `WorkingDirectory=/opt/trinityone` |
| `Environment=` | **empty** — `RELAY_PUBLIC_URL` is NOT set |
| Tunnel | `trinityone-relay-tunnel.service` — *"cloudflared **named tunnel** → trinityone.church"* |
| `relay-addresses.json` | **absent** — confirmed at `/opt/trinityone/relay/` |
| `relay/origin` | **`https://trinityone.tailbeaac0.ts.net`** — see below |

**The named tunnel is the finding, and it is worse than a missing variable.** `cfPublicWss()` derives
its URL by matching `/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i` against cloudflared's output
(`gateway.mjs:879`). A **named** tunnel to your own domain never prints that string. So the
auto-declaration this branch shipped is **structurally incapable of working on a8**, whatever is
configured — and `405d8fc`'s commit message says "Nothing to configure on the Suite, on a8, or in a
test." That line is false for the one box that matters.

**And `relay/origin` confirms the first "do not do this", against a real box.** a8's copy holds
`https://trinityone.tailbeaac0.ts.net` — that is the DEV BOX's Tailscale funnel, the machine a8 pulls its
updates from. a8's own canonical name is `trinityone-master-01.tailbeaac0.ts.net`, a different host. So the
file means exactly what the plan assumed: *where this box gets its code*, never *where this box is reached*.
Seed the address declaration from it and **a8 would declare and sign the dev box's address**, telling every
phone that dialled a8 it was talking to another machine. This is no longer reasoning from a variable name;
it is measured.

There is also a live `trinityone-update.service`, so the inert guard is wired to a real timer.

---

## Two orderings, and conflating them is the likeliest way to get this wrong

| Gate | What must be true | Items |
|---|---|---|
| **Merge** | code + tests landed | 1, 2, 3 |
| **Deploy 1 — before ANY relay is updated** | a8 declared, verified by hand at **both** canonical URLs | 1 (operator half) |
| **Deploy 2 — before the apps ship** | every fleet relay answers 200 at every address it declares | verification only |

An old app against a new relay is fine; **a new app against an undeclared relay is refused.** The
client-side check ships in the app, so relays must be updated *and declared* first.

---

# GATE ITEMS

## Item 1 — a relay must not silently serve a public address it does not declare

**Defect.** `_declaredAddresses()` (`gateway.mjs:606`) derives a public address only from
`cfPublicWss()`, the Tailscale funnel, and `RELAY_PUBLIC_URL`. The first can only ever yield a
quick-tunnel URL; the third is set nowhere. A box behind a named tunnel declares loopback only and
421s every member.

### Operator half — a8

Set `RELAY_PUBLIC_URL=wss://app.trinityone.church/relay` in the relay's **service** environment. The
Tailscale canonical is picked up by `_tsPublicWss` separately. Two public roads and neither Tailscale →
use `relay-addresses.json` (`{"addresses":[...]}`); both sources are unioned and the bare-origin form
of each is appended automatically.

Then verify **every** address, not just the box — a 200 whose `relay` tag names a *different* address
is the forwarding hole, not a pass:

```sh
for U in https://app.trinityone.church https://trinityone-master-01.tailbeaac0.ts.net; do
  N=$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')
  W="${U/https/wss}/relay"
  curl -s "$U/relay-identity?nonce=$N&for=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$W")"
done
```

### Code half — so it cannot recur

1. **Log the declared set at startup, always.** Silent success is what let this hide.
2. **Warn loudly when the set is loopback-only** and no opt-in is present, naming the consequence:
   *"this relay will refuse every member who is not on this machine."*
3. **An explicit opt-in for genuine loopback/LAN boxes** — `RELAY_LOOPBACK_ONLY=1` or
   `{"loopbackOnly":true}`. Present → silent. Absent → the **update** fails (item 2).

**Why not refuse to start.** A relay that will not start cannot serve the console an operator would use
to fix it, and cannot be repaired remotely. At startup the box genuinely cannot distinguish "I am a LAN
relay" from "I am a public relay nobody configured" — the distinguishing evidence arrives only when
someone dials a public Host. The opt-in gets the same hard failure at update time, where it is
recoverable. **Cost:** every existing loopback/LAN box needs the flag once, or its first update fails.
Small, one-time, and *visible* — the alternative is a silent fleet outage.

**Do not flip `/status`'s `ok` on undeclared refusals.** Internet scanners send junk `Host` values;
that hands a stranger a switch to mark the relay unhealthy.

### Proof — point-of-use, executable

Spawn a real relay via `relay-network-harness.mjs`:
- with `RELAY_PUBLIC_URL` → `for=<that url>` returns **200** and the `relay` tag equals it;
- with no public env → a non-loopback `for=` returns **421 `undeclared-address`** *and* loopback
  simultaneously returns 200 (both halves, or it passes against a relay refusing everything);
- with no public env and no opt-in → the startup warning appears in the spawned process's output;
- with the opt-in → that warning is absent.

The last two assert on **captured output from a spawned relay**, never on the text of `gateway.mjs`.

---

## Item 2 — `relay-update.sh` must ask the question, for every address

**Defect.** The probe reads the public address from `/relay-names/mine`, which is `adminOK`-gated
(`gateway.mjs:3384`) with no loopback exemption (`:916`), while the script sends no credential. So
`pub_url` is always empty, the `elif` branch runs, and **every update passes**. Measured: the route
returns 401 to an unauthenticated GET, and the script contains zero auth references.

**Use `/local-token` (`gateway.mjs:3368`) — the codebase already built exactly this.** Verified
present and hardened: loopback socket **and** not proxied **and** loopback `Host`, with no
`Access-Control-Allow-Origin`. Adds no new route, no new public disclosure, and no trust assumption
beyond one already reviewed. A new unauthenticated route listing declared addresses would be a
permanent internet-facing disclosure on every box to catch an operator mistake — the wrong trade.

**The change:**
1. `tok=$(curl -fsS --max-time 5 http://localhost:$PORT/local-token | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')`
2. Fetch the **declared set**, not one address — extend `/relay-names/mine` with `declared: [...]`, or
   add an admin-gated `/relay-addresses`. `ownUrl()` returns only its first match, so a8's second
   canonical road would never be checked.
3. Probe **every non-loopback** entry with a fresh 32-hex nonce; require 200 **and** the `relay` tag to
   name the address asked for.
4. Any non-200 → `ok=0`, which the existing code already turns into a rollback.

**When a box legitimately has no public address**, decide from the declared set:
- non-loopback entries present → all must answer, else fail;
- loopback-only **with** opt-in → log and pass;
- loopback-only **without** opt-in → **fail**. This is the a8 case, and the only branch that turns
  today's silent pass into a stop.

**Same shape, same file:** the existing health check is `curl -fsS .../status >/dev/null` — it
discards the body. `/status` returns 200 unconditionally, so its `ok: !STORE_DEGRADED` field
(`:3309`, "AUDIT 2026-08-02", written precisely so a relay refusing every write cannot report healthy)
is read by **nothing**. Parse `ok` and fail on `false`.

### Proof — must spawn a relay and run the probe logic

Extract the probe into a sourceable function so a test can invoke it against a chosen `PORT`, then
assert on **exit status and emitted log lines**:
- declared address answering → success, `ok` stays 1;
- declared public address made unanswerable → **fails**, `ok` becomes 0 *(this is the case that would
  have caught today's defect and must exist)*;
- loopback-only + opt-in → passes and logs it;
- loopback-only, no opt-in → **fails**.

---

## Item 3 — replace the grep test with one that executes the guard

**Defect.** `a-relay-declares-where-it-answers.test.mjs`, case *"the update script asks the public
question, not the loopback one"*, asserts `assert.match(sh, /relay-identity/)` and
`assert.match(sh, /relay-names\/mine/)` against the script's **text**. Both strings are present and
both pass over a guard that provably never runs.

Delete those two assertions; replace with item 2's executable cases. Keep the ordering assertion
(`idx > sh.indexOf('systemctl restart')`) only if ordering cannot be expressed behaviourally — a
positional string check is a structural claim, weaker but not dishonest.

**Rule 8:** you are removing assertions from a case, not the case. Say so, and say what now covers it.

This repo records the same failure four times under different names — *a stub answers the question*,
*injected outcomes cannot catch a dead classifier*, *comments can satisfy assertions*, and CLAUDE.md
rule 1. This test file's own header names the property it fails to test: *"asking it on loopback CANNOT
tell you whether it will answer where members actually reach it."* Write the test the header describes.

---

# RIDE-ALONG ITEMS

## Item 4 — connect-by-name sends a blank church name

`app/stew-dashboard.jsx:3172` calls `registerAtRelay(j.url, '')`; `gateway.mjs:3897` refuses a *new*
nameless self-registration with 400 (rule H4). Since `b567bad` a fresh box then refuses all its writes
instead of accepting them through the old open-relay gap.

**The one-line fix is NOT sufficient — checked.** Three things:
1. `church` is not in scope. `connectByName` is in `DashRelaysCard()` (`:3122`); obtain it the way the
   file already does — `const church = window.useStewardChurch ? window.useStewardChurch() : { name: '' };`
   (pattern at `:394`, `:1085`).
2. Then pass `church.name`. `registerAtRelay` forwards `name || ''` unchanged; no change needed there.
3. **Handle the empty name honestly.** The 400 is *correct* — H4 exists because a box accumulated 37
   unidentifiable bare-npub rows. Say "name your church first", not "the relay operator may need to
   approve your church". `selfRegister` models this with `_regNeedsName`; mirror it.

**Proof:** spawn a fresh relay, register with a non-empty name → 200 **and** a subsequent church-signed
write is accepted (the mirror matters); repeat with an empty name → the refusal surfaces as "name your
church first". Rule 3: do not assert this by matching text in `app/*.jsx`.

## Item 5 — correct the founding-wait claim, and restage its test

`bc04450` says *"an established console never pays this at all."* **False.** `_openRegGate()`
(`steward.src.js:2144`) resolves `_regGate` but never nulls it — only `_waitForRegistration` does
(`:2193`) — and `app/stew-dashboard.jsx:1203` fires `selfRegister(church.name)` on every owner console
once the name resolves, arming the gate unconditionally (`:6796`). The test staging `_regGate = null`
stages a state the product occupies only before its church name loads.

**No code change needed.** Measured cost: warm cache → **0 ms, one `admit()` call**; cold cache → the
full 8 s budget **once per session**, ~80 polls at 10/sec, no spin, no probe storm (`schedule()` is
guarded by `inflight` plus a 60 s backoff).

Correct the comment (`steward.src.js:2163-2165`) to what is true, and **add** a case (keep the null one,
which still guards founding scope) staging the real established state: `_regGate` a **resolved
promise**, `_proofWaited` false, `_gate.admit` returning `[]`; assert bounded by `PROOF_GATE_MS` and
paid at most once.

## Item 6 — three comments now assert the opposite of the code

- `scripts/join-policy.test.mjs:6-11` — *"an UNCONFIGURED relay accepts everything"*, with a table row
  reading `relay hosts NOTHING → accepted`.
- `scripts/relay-tenancy.test.mjs:6` — *"accept() returns true unconditionally"*.
- `scripts/gateway.mjs:491` — *"the write policy is OFF (an open relay…)"*, contradicted by the new
  comment 1,485 lines below.

Not cosmetic here: the recorded incident had 935 tests green over a reintroduced safeguarding bug
because a comment satisfied an ordering check.

---

# DO NOT DO THIS

1. **Do not seed the declared set from `relay/origin`.** It is the box's *update* origin. Every
   satellite would declare and sign **its master's** address — fleet-wide, and worse than the bug.
2. **Do not match host-only.** Every test goes green and a proxy on another *path* of a legitimate host
   inherits that relay's identity. Host, port **and** path are the boundary.
3. **Do not fall back to the `Host` header when undeclared.** That is hole 1. The 421 is the feature.
4. **Do not let `for=` introduce an address** rather than select among declared ones. Same as (3).
5. **Do not add an unauthenticated route listing declared addresses.** Use `/local-token`.
6. **Do not refuse to start when no public address is set.** It bricks LAN deployments and the box
   cannot tell the cases apart at startup.
7. **Do not flip `/status`'s `ok` on undeclared refusals.** Scanners would control your health signal.
8. **Do not assert any of this by matching text** — not `app/*.jsx` (unbundled; `false && ` leaves the
   words intact), not `relay-update.sh` (that is item 3), not `gateway.mjs`. Spawn it. Run it. Read the
   output.
9. **Do not sabotage by deleting a call.** esbuild strips `if (false && x)` entirely, the lifted helper
   vanishes from the bundle, and the test **dies** with no summary — which reads like a pass in a
   truncated log. Neuter the comparison; confirm with `grep -c 'function <helper>' vendor/<bundle>.js`.
10. **Do not treat a green suite as evidence.** All 124 cases pass today with the guard fully inert.
11. **Do not "verify" a relay by curling `/status` for a 200.** That is the existing check, and it is
    why `/status` on localhost was never evidence.

---

# Test-count arithmetic (rule 8)

**Current at `b567bad`: 2463.** Model: 2388 static top-level `test(` + **75** = 2463. The offset is
fully enumerated — 74 generated from 18 `test(` calls inside `for` loops, +1 for
`event-store-import.test.mjs` which declares none and counts as one file.

**Expected after this plan: 2470 (+7).**

| Item | Δ |
|---|---|
| 1 — startup warning present / absent under opt-in | +2 |
| 2 — probe fails an unanswerable address; loopback+opt-in passes; loopback without fails | +3 |
| 3 — two text assertions removed from an existing case | 0 |
| 4 — name passed; empty name refused | +2 |
| 5 — established console, cold cache, bounded and once | +1 |
| 6 — comments only | 0 |
| *(item 2's third case replaces item 1's second)* | −1 |

**Write these as plain top-level `test(...)`.** Generating any in a loop changes the +75 offset and the
next person cannot reconcile. If the measured total is not 2470, **do not adjust the expectation** —
find the difference and name it.

---

# Still unverified

- **The live fleet inventory.** `quitedoverelay` in the directory is an unresolved key claiming
  churches; if it is a real church's box its operator must declare before the app release. Both its
  advertised address and ours are dead tunnels — see `BACKLOG.md`.
- **Whether `relay-update.sh` can reach `/local-token` in its own context.** If it returns 403 there,
  the probe is inert again. **Assert the token fetch succeeded; never let an empty token degrade into
  the pass branch — that is precisely today's bug, one level down.**
