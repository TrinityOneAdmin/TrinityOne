# Handoff — closed relay network merged and deployed; round 7 staged

Written 2026-09-02, end of session. `main` is at the merge; a8 is updated and verified.

---

## 1. What is done, and how sure we are

**Merged to main (`7a292ca`) and DEPLOYED — a8 builds from main, so merging IS deploying.**

The rule now: **a relay is admitted iff it proves, at the address we dialled, that it runs TrinityOne relay
software.** Our own shared relay is additionally identified by its KEY, not its address, so seizing
`app.trinityone.church` and answering with a different key is refused — that address ships in every app and
would otherwise need no adversary effort at all.

| Claim | Evidence |
|---|---|
| a8 declares and proves both canonical roads | measured live: 200 on each, `relay` tag naming the address dialled, fresh nonce |
| A forwarder cannot inherit an identity | 7 variants refused incl. 302; verified in a browser through a real TLS funnel |
| The two address normalisers agree | fuzz: 0 divergences over 70 crafted + 20,000 cases, src and both bundles |
| Suite | **2476 / 0** from a quiesced box |
| Audited | GO, with both riders closed (IPv6 probe fix; connect-by-name browser pass) |

**a8's config:** `/opt/trinityone/relay/relay-addresses.json` holds both canonical addresses. It was staged
BEFORE the update, which is why a8's first update passed its own new check instead of rolling back.

### What the decision cost, stated plainly

*"A church's data only goes where the church chose"* became *"…only goes to TrinityOne machines."* Fifteen
tests guarded the former. Thirteen were kept against the new line by staging a box that behaves like a relay
but holds no key (`H.startFakeRelay`), three lost a single assertion, one was deleted and named. Nothing was
quietly weakened — see the commit messages, which name each.

---

## 2. Round 7 — staged, one finding already, NOT started

The box is ready. **Do not re-stage; verify and continue.**

- **Relay:** wiped to zero (backup at `relay-backup-20260902-214826.tgz`), identity key kept, declares its
  funnel address, warns loudly that it has no public address when it has none.
- **Phone (Oppo):** uninstalled and reinstalled from a build made AFTER the merge (21:32 vs 21:18). Storage
  empty. `pm clear` does NOT work on ColorOS — uninstall is the only clean route, and it is genuinely clean
  because `allowBackup=false`.
- **a8:** untouched by the wipe and must stay that way. Sims never reach it.

### FINDING R7-01 — an ad-hoc browser launch bypasses the production guard

**A simulated church wrote a kind-0 profile to the production relay a8.** Measured: 1 event for pubkey
`91acb0b8735e5e3af80fdb2fe8dc708707f618bfd4018dd3ac86f2a2344b4a4d` on
`wss://trinityone-master-01.tailbeaac0.ts.net/relay`.

**The guard is not at fault.** `no-browser-reaches-production.test.mjs` requires every launcher IN THE REPO
to map `app.trinityone.church` AND `*.ts.net` to `127.0.0.1:9` — a port nothing listens on, so a mapped host
FAILS rather than silently hitting the local relay. It passed 3/3 throughout.

I launched chromium by hand with a rule covering neither. Both consequences landed: the Tailscale canonical
resolved to the real a8 and was admitted, and `app.trinityone.church` quietly hit the local relay.

**So: always launch through `scripts/sim-launch.mjs`.** It already has the correct rule
(`sim-launch.mjs:51`). Proven correct afterwards — with it, `ownRelay()` becomes the local box and both
canonical addresses go `off`. A guard that inspects files cannot see a command you type.

**Owed:** clear that stray kind-0 from a8.

### To continue the round

`node scripts/sim-launch.mjs 9333 "http://127.0.0.1:8000/steward.html" --name steward`, then found a church
through the wizard. Owner's parameters: **max 10 members, self-hosting, focus on relays and the steward
console, still touch every app surface possible.** Round 6's design — testers told NOTHING about what was
built — is what lets a round contradict us rather than confirm us; keep it.

**Driving the UI: synthetic events do not work.** `.click()` and `dispatchEvent` change the DOM and React
resets it on the next render — a checkbox reads `checked:true` while the state behind it never moved. Use
real CDP input at real coordinates (`Input.dispatchMouseEvent` + `Input.insertText`). Two throwaway helpers
exist at `scripts/.sim-click.mjs` and `scripts/.sim-words.mjs`; fold them into the sim harness properly
rather than leaving dotfiles around.

---

## 3. Open items, ranked

1. **Twelve ungated read subscriptions** (`fellowship.src.js:3596, 3632, 3657, 3669, 3702, 3730, 4994, 5055,
   5069, 5096, 5115, 5223`). No church data leaves on a read; an unproven relay learns metadata. Deferred
   deliberately, needs its own device pass — a read gate wrong means a blank screen, this codebase's worst
   failure class.
2. **Stop shipping `reference/` to relays** and **version by payload content, not commit** — see BACKLOG.
   9.9 MB of audit findings and threat-model notes currently sit on every church's relay, and any commit at
   all makes every relay report an update available. Owner also asked for **release on tags** going forward.
3. **`_oneComplete` has no `maxWait`** (`steward.src.js:2247`) while its sibling `_newestByD` does. Measured:
   a dead port returns `{ev:null, complete:true}` in 7ms. Unreachable today (its only callers are
   enrolment-only), so it is a lie waiting for its next caller.
4. **`quitedoverelay`** — a permanent dead entry in the public directory. Only the claiming key can withdraw
   a name and that key is gone. Wants an operator removal path or expiry.
5. **Relay UI** wants the pass the console settings page got, plus a surface for the new operator-facing
   state (which addresses am I declaring? am I loopback-only?) which today exists only in a startup log.
6. **`webContentsDebuggingEnabled`** is ON for the pilot and must be OFF at go-live. Signing stays on the
   TESTING key until then.

---

## 4. Traps that cost real time today — do not re-learn these

- **A stale relay enforces old gates against new bundles.** Check `ps -o lstart=` against
  `stat -c '%y' scripts/gateway.mjs` BEFORE diagnosing anything. This produced three false findings in one
  day, including one that looked exactly like a member-side deadlock.
- **A suite run is only evidence if the box was quiet when it STARTED and stayed quiet.** Restarting a relay
  or wiping data mid-run produces scattered failures across unrelated files, with controls failing alongside
  the things they control. I mis-attributed real failures to this twice, and attributed contamination to real
  causes once. Check `ps` for `node --test` and chrome before starting, and do not touch the box during.
- **A timed-out command is not a result.** If a run prints no summary, it did not finish.
- **esbuild strips `if (false && x)` entirely**, so a lifted helper vanishes from the bundle and the test DIES
  with no summary rather than failing — which reads like a pass. Neuter the comparison instead, and confirm
  with `grep -c 'function <helper>' vendor/<bundle>.js`. I corrupted a whole bisect this way: I disabled a
  guard for an experiment, the command timed out before restoring it, and I saved the sabotaged file as my
  working copy.
- **Never put `git stash` in a background command without a matching pop.** Nearly lost a session's work.
- **`DEFAULT_OLD_REV` must be re-pinned at every release.** It was `main`; merging made "the old build"
  identical to the working tree and every old-relay skew case failed rather than passing vacuously. Now
  pinned to `26aa696`. If you see "identical to the working tree", move the pin — never delete the assertion.

---

## 5. What must not change

- Fail closed on a failed proof. No grace path, least of all at church creation.
- Identity is the KEY; an address is a claim that must be proved. Never match membership on a URL — tunnel
  addresses churn, and URL matching would drop every self-hosting church off every phone on each reboot.
- `fellowship.src.js:650` stays unfiltered. The proof that a relay is ours is a document you must read from a
  relay you have not yet proved; gate it and no phone can ever bootstrap.
- `relayPub` from `/status` or NIP-11 is an unauthenticated string and is never proof.
- **Relays before apps.** The address check ships IN THE APP. An old app against a new relay is fine; a new
  app against an undeclared relay is refused.
- `restoreChurchData`'s destination stays ungated (a steward types it on a screen whose job is migration),
  but it now refuses cleartext and `restore-scope.test.mjs` fails if a second caller appears.

See `reference/RELAY-ADMISSION.md` for the architecture and `CLAUDE.md` rule 10 for the short version.
