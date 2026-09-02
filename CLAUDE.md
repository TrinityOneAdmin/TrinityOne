# Working rules for this repo

Written 2026-08-29 after three independent audits found defects in five of seven fixes made in one
sitting. Every rule below exists because breaking it cost real money or real safety, and the example
is named so nobody has to take it on faith.

## 1. Test at the point of USE, not the point of change

Every fix needs at least one test that fails **if the feature is deleted from the screen**, not only
if the engine behind it is broken.

*Why:* the child-safety fix that hides adults-only rooms from a young person had eight passing tests
over its engine. Deleting the one line in the app that actually calls it left all 1,982 tests green.
A well-tested engine nobody is required to consult is not a feature.

## 2. List every user of shared code BEFORE editing it, in the commit

If the list is not in the commit message, the change is not finished.

*Why:* the document store has 13 readers and the file-save helper has 4 callers. Both were changed
without enumerating them, and both broke at a caller that had not been looked at — once by filtering
what a console displays, once by missing one of four save paths.

## 3. Never assert behaviour in a test by matching text in `app/*.jsx`

Those files ship unbundled, so `false && ` in front of a condition leaves every word of it in place
and any text-matching assertion still passes. (It does NOT work against `vendor/*.js` — the bundler
removes dead code, so the text disappears and the match fails.) Lift the function and run it, or
make no claim.

## 4. Nothing goes in a commit message unless a test proves it

*Why:* three commit messages in one sitting asserted behaviour that was never true — "a retry reuses
the key" (it minted a second child account), "the guardian request re-sends when the screen is
reopened" (nothing re-sends it), "the relay reads it the same way" (it deliberately does not).
A false claim in the permanent record is worse than the bug it describes.

## 5. Audit every two fixes, not every seven

*Why:* seven fixes then one audit found five defective. Audited after two, the remaining five would
have been written already knowing what the first audit found.

## 6. Verify on a device before merging anything user-facing

The suite passing is not the gate. Two of the three worst findings in the 2026-08-29 round were only
provable by driving the app on the attached phone.

## 7. Check your real-world assumptions before designing, not after

Read `reference/DOMAIN.md` before anything user-facing, and especially anything touching safeguarding.
State your assumptions about how churches and families actually behave in one line and check them. When
the owner corrects one, WRITE IT INTO THAT FILE so the next session does not need the same correction.

*Why:* three corrections in one session, all the same failure — reasoning from the one code path in view
instead of from how a church works. A child can reach this app by several routes, not just the one the
family screen shows. A church may deliberately have no group rooms for its children. Neither is derivable
from the code, and a fix built on the narrow reading looks complete and is not.

## 8. Account for the test count every time it moves

If the total went down, say which tests you removed and why. If you cannot, you did not remove them
on purpose.

*Why:* a scripted edit meant to replace ONE test replaced everything from it to the end of the file,
silently deleting three — including the executable point-of-use test that a previous fix had just
added. It was caught only because the total went 2029 to 2026 and that was three tests nobody could
account for. A deleted test never fails, so the suite would have stayed green over the hole for ever.

This is the cheapest guard in this file. Use it.

## 9. Stop when the error rate climbs

Basic syntax errors in new files, and claims made without checking, cluster in the back half of a long
session. Stopping is a control, not a failure of one.

## 10. Never widen which relays a church talks to

Read `reference/RELAY-ADMISSION.md` before touching `relay-net.src.js`, `_netRelays`, `churchRelays()`,
`relaysForChurch()`, or any relay list. The rule, the roots and four traps are written up there.

The short version: **a relay is admitted iff it proves, at the address dialled, that it holds a relay
identity key — "it runs our software".** The pin / origin / church roots no longer decide admission: they
are diagnostics, plus **one refusal** — a box answering at an address we ship must prove a key we ship.
`relayPub` from `/status` or NIP-11 is an unauthenticated string and is never proof.

And do not overclaim what the proof buys: it refuses a replacement box at a shipped address and a forwarder
at a DIFFERENT address. A proxy at the SAME address, run by whoever controls that name's DNS/TLS, is not
refused and never was.

*Why:* the product actively suggested non-TrinityOne relays. Every protection this app has lives in
the relay, so "which machines get the data" IS the security boundary, not a networking detail.

Two things in there look like bugs and are load-bearing. **The relay-net read at
`fellowship.src.js:650` is unfiltered on purpose** — the proof that a relay is ours is a document you
must read from a relay you have not yet proved; gate it and no phone can ever bootstrap. **Root 3
matches the pubkey, never the URL** — tunnel addresses churn, so URL-matching drops every
self-hosting church off every phone on each reboot.

And before diagnosing any relay behaviour: check the relay process is NEWER than `scripts/gateway.mjs`.
A stale relay enforces old gates against new bundles and looks exactly like a broken gate. It has
produced a false finding on three separate occasions.


---

## Audit briefs: two things that have cost three auditors real time

- **A git worktree sits at a stale commit.** Say the target commit in the brief and tell the agent to
  check out that tip before reading anything. One auditor skipped it and filed a confident, false
  headline claim that the branch did not pass its own tests.
- **A worktree has no `node_modules`,** so ~5 tests fail on `esbuild ENOENT` no matter which commit is
  checked out, and fixed-port tests collide with any concurrent suite. Neither is a code failure. Say
  so in the brief.

## Sabotage must be scoped to the function under test

Near-identical sibling functions are this codebase's house style, so a plain string-replace hits the
first match — usually somebody else's. Slice the enclosing function, assert the anchor appears exactly
once inside it, then replace. A mis-aimed sabotage reports exactly what a blind test reports.
