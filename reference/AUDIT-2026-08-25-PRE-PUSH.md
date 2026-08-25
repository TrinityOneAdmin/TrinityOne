# Pre-push audit, 2026-08-25 — 87 commits, 18–25 August

Run before pushing to the PUBLIC repository and cutting a Windows installer. Owner's reason, in their words:
*"I feel anxious that we've been fixing things that, in reality are not issues, and perhaps creating more
issues in the process."*

**VERDICT WHEN WRITTEN: DO NOT PUSH AS-IS. NOW RESOLVED — the critical is fixed in `1a793dd`.** One critical privacy regression, reproduced twice by the auditor and twice
again independently by me against the real `main` gateway.

---

## CRITICAL — FIXED in `1a793dd` — narrowing a steward's tickboxes opens the church's private rooms at the next relay restart

### What a church experiences
A steward set up the church's groups, teams and rota. Later the church uses the new "who can do what" editor
to give that steward a narrower role — say Finance and Care, but not Groups & rotas. Nothing appears to break.
Then the relay restarts, which it does routinely because it self-updates. After the restart:

  · **invite-only rooms and serving-team rooms become readable AND postable by the whole congregation** — the
    eldership room, the safeguarding team room, whatever that steward created
  · a church that **required approval to join silently reverts to open-join**, so a stranger who self-joins can
    read members-only content
  · a **rota narrowed to "serving teams only" is served to everyone again**, while the console still says
    "Serving teams"

Nobody is told. Nothing on any screen changes. It looks exactly like "the app lost my church" — except it is
the opposite: the church has been quietly opened.

### The mechanism
The capability work (`10059bf`) made the relay's steward check ask WHICH capability, not merely whether you are
a steward. The **read** path was deliberately made tolerant, so narrowing a delegate does not hide the content
they authored — `scripts/gateway.mjs:2138`:

    if (ch && !retractionExempt) { if (!(e.pubkey === ch || stewardCan(e.pubkey, ch, 'any'))) return false; }

But the **ingest** path — `note()`, replayed on EVERY restart — re-validates each HISTORICAL document against
the author's CURRENT, narrowed capability:

    gateway.mjs:1402  GROUP_D       … stewardCan(e.pubkey, namedChurch(e), 'content')   → invite/team rooms
    gateway.mjs:1467  ROSTER_D      … stewardCan(e.pubkey, namedChurch(e), 'content')   → team membership
    gateway.mjs:1428  JOINPOLICY_D  … stewardCan(e.pubkey, cp, 'members')               → approval-required flag
    gateway.mjs:1433  ADMITTED_D    … stewardCan(e.pubkey, cp, 'members')               → admitted allowlist

When the author no longer holds that specific capability the branch is skipped, so `GROUP_VIS`,
`GROUP_MEMBERS`, `REQUIRE_APPROVAL` and `ROTA_VIS` are never populated for that document. The event is still
SERVED (the read path's `'any'` lets it through) but **its restrictions are never derived** — an invite-only
room collapses to `GROUP_VIS !== 'invite' → return true`, i.e. public to any authenticated member.

The read path was hardened for exactly this scenario. The ingest path is the missed sibling. The two gates
disagree, and the tolerant one is the only one anybody tested.

The two-pass hydrate added in this same batch loads `stewards:` FIRST, which guarantees the newest narrowed
roster is in force when the old documents replay. It makes the drop deterministic rather than preventing it.

### Reproduced — by the auditor, then independently by me
    BEFORE restart: mallory (not in the group) sees 0 messages          ← correct
    narrow deborah  content → members
    AFTER restart:  mallory sees 1 message: "private eldership matter"  ← BUG
                    mallory can also POST in it

    BEFORE: self-joined, non-admitted stranger reads members-only plan: 0   ← correct, church is approval-gated
    narrow deborah  members → finance
    AFTER restart: stranger reads members-only plan: 1                      ← BUG, approval gate dropped

### Would the tests catch it? NO.
`rota-visibility.test.mjs` does restart the relay after a roster edit — but it edits the roster with **no
`caps`**, so the steward keeps full power and the narrowing case is never exercised. It passes 11/11.
`relay-steward-caps.test.mjs` never restarts the relay at all. The suite is green over this, all 1622 of it.

### RESOLVED, 2026-08-25, commit `1a793dd`
All SEVEN gates widened to `'any'`, not the four listed above — my own enumeration missed FIN_JOURNAL,
MEALS_SETTINGS and ROTA_SETTINGS, and a second reader caught it. Fixing off my list would have been another
half-fix. `scripts/caps-narrowing-keeps-restrictions.test.mjs` drives both failure directions, a live
`/config` rehydrate as well as a restart, and a forgery guard; sabotage-verified (bug back → 4 of 6 fail).
Full suite 1632, 0 failures.

### What the fix had to be true of — recorded before it was written
The ingest gates must agree with the read path's tolerant `'any'` semantics, or the difference must be a
conscious decision carrying a test that **restarts the relay after a NARROWING**. That is the state no test
drives, and it is where the whole defect lives.

---

## MEDIUM/HIGH — "the six controls that thanked you for a message never sent" is half done
`a4b4ee4` fixed only the case where no request exists. When one DOES exist, `app/app.jsx:1826` fires the
publish without awaiting it and returns `true` before any I/O; the helper underneath swallows the failure
(`src/fellowship.src.js:3894`, `try { await _publishAny(...) } catch {}`). A member on a published rota taps
"I'm away" with no signal, is told "Taken off — thanks for letting us know", and the church receives nothing.
They do not turn up on Sunday. That is the exact scenario the commit is named for.
Worse: `serving-response-honesty.test.mjs` asserts the real function CONTAINS `return true;` — it **pins the
ungated success as correct**. See fix-the-control-not-the-label; this is that lesson recurring.

## MEDIUM — pre-existing, not a regression: the care-volunteer controls still lie
`fillCareSlot`, `clearCareSlot`, `setCareAvail`, `clearCareAvail` all swallow the publish failure and return
the signed event, and the callers toast on that truthy object, so the rollback branch is dead code. A member
taps "I'll bring Tuesday's meal", is thanked, and the day stays open. `clearCareAvail` fails OPEN on a privacy
control — "you're off the list" when you may still be listed.
**These files are byte-identical to `origin/main`** — the 87 commits never touched them. So the round advertised
a fixed class while the siblings still lie. No test exists for any of them.

---

## WHAT IS SOLID — where the week's effort landed well
  · **Safeguarding: a child can never be a cleared worker** — enforced at the relay on both the read/eval path
    and the `approved:` write gate, fail-closed.
  · **Guardian-link removal is complete on BOTH sides** — console sends a sealed removal notice, member app
    handles it, and both are in the shipped bundle. Not a half-fix.
  · **Finance / check-in key separation** — owner-only minting; a treasurer can no longer read a child's pickup
    code. One gap remains and is flagged in-code rather than hidden.
  · **The `/import` write-gate revert** — correct, with the reasoning recorded: replaying `accept()` over an
    import once deleted a whole finance journal.
  · **Vendor freshness** — the `src/*.src.js` edits ARE present in the shipped `vendor/*.js`. No stale bundle.
  · **No duplicate top-level globals** across the classic scripts in either page. No blank-app collision.

## CORRECTION TO MY OWN COMMIT MESSAGE
`1a79a27` says the sim removal "takes 36 private keys with it". **It does not.** Those keys were committed in
`2661177`, already an ancestor of the public `origin/main` — they are in public history now, and deleting the
file going forward leaves that history intact. They are throwaway simulation fixtures so the impact is low,
but the message claims a protection it does not provide. Treat all 36 as permanently burned.
