# Handoff — five audits merged to main, never used as an app

Written 2026-09-04, end of session. **`main` is at `a75b7f5`. Suite 2665: 2664 pass, 0 fail, 1 todo.**
Nothing is deployed.

---

## 0. DO THIS FIRST, BEFORE ANY TESTING OR DIAGNOSIS

**The running relay is older than the code.** Process started `Wed Sep 2 22:59`; `scripts/gateway.mjs` was
last written `2026-09-04 13:58` by the merge. A stale relay enforces OLD gates against NEW bundles and looks
exactly like a broken gate — it has produced a false finding on three separate occasions (CLAUDE.md rule 10).

    sudo systemctl restart trinity-gateway     # then re-check:
    ps -eo lstart,args | grep '[g]ateway.mjs 8000'
    stat -c '%y' scripts/gateway.mjs
    # the process MUST be newer than the file

`/status` currently reports `versionShort 7767d26` while `releases ref main` is `a75b7f5` — i.e. the relay
knows an update exists and is not running it.

---

## 1. What landed, in one paragraph

51 commits over five independent read-only audits. Every audit found real defects, and **the fourth and
fifth each found a regression introduced by the fixes for the audit before it** — that pattern has not
obviously stopped, which is the main reason to be careful rather than confident.

The user-visible repairs: a young person's request could sit under the button that publishes it to the whole
congregation during the moments before the safeguarding lists arrive (the console was fixed 09-03, the phone
runs the same triage and had been left); a bank statement could import £25 of a £45 file and close as a
success; "stay open on this phone" died on the first restart and deleted its own record; a crash meant no
steward could create a group; eight controls said "done" over work that never left the phone; a rename done
twice in one sitting was silently dropped; Undo on a removed message failed about half the time; the
onboarding "Try again" was inert on the screen where skipping loses the account for ever.

Full detail is in the individual commit messages — they are written to be read.

---

## 2. THE GAP. This is the next job.

**Nothing on this branch has ever been used as an app.** Every check — including the final smoke test — drove
components in isolation: render this card, call that function, feed a fake relay. No church has been created,
no phone joined to one, no request made by one person and answered by another.

Isolated checks catch broken parts. They do not catch parts that each work and do not fit together, and this
branch changed care, finance, safeguarding, identity and onboarding at once.

### The session I would run, in order

Stage a church on the console, join both phones, then:

1. **Safeguarding, with a skewed clock.** `adb shell cmd alarm set-time <epochMillis>` works on both phones
   (`settings put global auto_time` does NOT — it is blocked, and that is the route I wrongly reported as
   impossible). Put a phone 15 minutes out, then open the care screens as a care admin. Requests must be held
   as confidential ("still checking who these are from"), never offered "Set up help". Put the clock back and
   CHECK it against the host before moving on.
2. **Two consoles.** Close a request on one; the other must see it closed. Then approve one while the relay
   is unreachable for the second publish and confirm the "help is set up, the request is still open" line.
3. **The bank import.** `scripts/fixtures/bank-statement-sample.csv` is built for this — 15 lines, real UK
   export shape, and two payments that are deliberately identical. Import it; import it again (nothing should
   post); then import with the network pulled halfway, reconnect, press **Try again**, and reconcile to the
   closing balance **£4,744.09**. `scripts/fixtures/bank-statement-sample.md` explains every line.
4. **Identity.** Change a display name twice in one sitting (the second used to vanish). Remove a message and
   press Undo immediately (used to fail about half the time).
5. **Then just use it for twenty minutes** and write down what feels wrong. That is the part no test replaces.

**Only after that, deploy.** Main is green but nothing has reached a8. Deploying first makes the pilot the
test.

---

## 3. Still open, with reasons

1. **The relay's own NIP-42 window** — owner's decision to leave it. Consequence: a phone with a skewed clock
   is admitted and then silently unauthenticated; gated reads come back empty with nothing on screen, and the
   relay reports it as "bad signature", which misattributes a clock to a signature. A distinct reason plus one
   line on the phone would close it without touching the window.
2. **The blocked list says "A member with no name set"** for people who set one, on any console except the
   one that blocked them (the relay withholds a blocked key's own documents). The fix records the name at
   block time — but that changes `setBlocked(pubkeys)`, which FOUR test files slice by that exact signature,
   and it publishes a NAMED ban list where the relay holds only keys today. Wants sealing under the church
   name key and its own device pass.
3. **"Remove relay" has three faults:** a church-listed relay is re-added on the same tick by
   `_applyChurchList`; the socket and its subscriptions are never closed; and it is offered on the church's
   OWN relay whenever the proof cache is cold — which for a self-hosting church is "a member loses their
   church". CLAUDE.md rule 10 territory: read `reference/RELAY-ADMISSION.md` first.
4. **`reactDM`, `react`, `publishWalletBackup`** still swallow a failed publish. Reactions want a different
   fix (do not draw it until it lands); the wallet backup is unreachable while Lightning is off for the pilot.
5. **The statement de-dup fingerprint keeps only 40 characters of the description.** Two different payments
   on one day for the same amount whose descriptions match for 40 characters share a key — the Wickes "PART
   1"/"PART 2" pair in the fixture. Within one import both post; on a re-import both are skipped, so if only
   one had landed the other can never be added by importing again. Pinned by a test; a decision, not a bug.

---

## 4. Traps this session paid for. Do not re-learn them.

- **`git checkout -- <file>` silently discards uncommitted work.** It cost an engine fix mid-session. Restore
  from a scratchpad copy instead.
- **`www/` is not in git.** A freshly merged `main` has a stale `www/`, and `scripts/app-boots.test.mjs` and
  the relay block read it — 48 phantom failures until `bash scripts/sync-web.sh`. NOT a deploy hazard:
  `release.sh:71` runs sync-web itself.
- **A test that stubs what it is named for.** FIVE separate times on this branch, twice in files written the
  same day. Before believing any new test, delete the feature and watch it go red — and remember that
  deleting a CALL lets esbuild tree-shake the helper the test lifts, so an all-red result means suspect the
  harness.
- **A device probe that stops at an earlier guard** looks exactly like one that passed. Twice: a console with
  no care key refused before reaching the line under test, and a phone with no church answered "we don't
  know" for the wrong reason.
- **A clean install cannot see a migration bug.** The "stay open" fix was proved on a fresh install and
  reached no existing device; that is what audit #5 caught.
- **esbuild renames imported helpers** (`normalizeURL` → `normalizeURL2`) and rewrites dynamic imports. A
  lifted function needs the name the SHIPPED text uses, and `const { X } = ({ X })` is a temporal-dead-zone
  error swallowed by the function's own try/catch.

## 5. Where things are

- **Devices:** Oppo `J77HDMTC7TKBZDFM` connected, both APKs current from `f976eaa`. Pixel `57141FDCH008X4`
  unplugged; its member app is a fresh debug install (its old release-signed one, with four churches and
  personal data, was replaced with the owner's go-ahead).
- **PINs** are in the session scratchpad, never the repo. Both phones' member apps: `441739`.
- **Worktrees** `/mnt/storage/tmp/trinity-fix-audit` and `/mnt/storage/tmp/trinity-followups`, both at
  `f976eaa`, both now contained in main. Safe to remove.
- `reference/HANDOFF-2026-09-04-FIX-BRANCH.md` has the per-batch detail; this file supersedes its "what next".
