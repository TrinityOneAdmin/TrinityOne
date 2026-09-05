# Sim round brief — 2026-09-05

Written before the round, as the round's own instructions. Branch `fix/session-2026-09-04`, tip `a208d55`.
Suite 2775: 2775 pass, 0 fail, 0 todo. Nothing merged, nothing deployed, nothing on the pilot.

**Why this round exists.** The handoff that opened this session said the gap was that *nothing on this branch
had ever been used as an app*. That is still true. Since then the branch has gained eight commits and been
through three independent audits, each of which found regressions in the fixes for the audit before it. Tests
and audits have taken it as far as they can. What is left is the thing neither can do: use it.

---

## Ground state, verified before the round

- Relay running build `192da7a`; `scripts/gateway.mjs` has not changed since that process started. **A relay
  older than the gateway file enforces old gates against new bundles and has produced a false finding on
  three separate occasions** — check this again if the round is resumed on another day.
- `vendor/fellowship.js`, `vendor/steward.js`, `vendor/identity.js` all newer than their sources, and the
  bundle the relay serves matches the file on disk byte for byte.
- Production is black-holed in `scripts/sim-launch.mjs`: `app.trinityone.church`, `trinityone.church` and
  `*.ts.net` all map to `127.0.0.1:9`. No sim can reach the live site.

### Clear before starting
- Two sim browsers from a previous round, ~22h old, holding ports 9401/9402 at an 800x600 window.
- Two `node --test` processes ~14h old, holding fixed ports.
- 71 abandoned browser profiles under `/mnt/storage/tmp/trinity-scratch/`.

### Decide before starting
Whether to wipe the relay. It still holds the cleartext calendar and name documents written before the
fixes. The owner has confirmed no real churches are running, so this is test data. A wipe gives a clean
reading; it also destroys the existing sim church, so a fresh one must be staged (and see rule 3).

---

## The rules

Every one of these was paid for by a previous round.

**1. A sim is read-only.** Collect findings during the round; fix in a separate pass afterwards. Fixing
mid-round means every later finding is against code nobody has reviewed.

**2. The prior is that the app WORKS.** Anything the round flags is a candidate until reproduced. File
survivors as *potential user issues*, not defects. **An absence claim — "nobody could see X", "it never
arrived" — is the weakest thing a round produces, and three out of three have been wrong.**

**3. Write down every PIN and every recovery phrase, to the session scratchpad, never the repo.** Round 8
lost its entire church to a PIN nobody recorded: the relay kept every document and nothing could ever sign
as that church again.

**4. Seed through the screens, not through helper functions.** `setMinors` / `setGuardians` skip the sealed
per-member publishes that real use performs. That shortcut cost three false safeguarding findings in one
round — the very area this brief cares most about.

**5. Read the relay's database, not the console.** Most of round 9's coverage was lost to console state that
looked right on screen and had never been published. `relay/relay.sqlite` is the truth.

**6. Answer every dialog.** An unanswered `confirm()` kills a headless instance permanently, and Chrome then
reports "No dialog is showing". Three "the console froze" reports were this.

**7. Headless lies twice** — it truncates what `see` shows you, and it reports the window as permanently
hidden. Both have put false findings into a written document.

**8. Fresh browser profile every run.** A reused `--user-data-dir` serves run 1's service worker for ever, so
every finding is about code that is no longer on disk.

**9. Report failures BY NAME, never as a count.** "26 of 30 came up" is how four people who were never in the
room become a finding about people who could not see something.

**10. Full-size window for the console.** 800x600 invented a finding in round 5 about a care-team picker that
was working correctly all along.

**11. Confirm what you actually clicked.** `tap` once hit a heading that shared a button's text and still
reported "tapped X", faking two defects in round 9.

---

## The matrix

### A. Safeguarding — run this group first

This is the area where a false pass is most expensive, and where this branch has the most indirect reach:
the relay resolves **care-team admin through the roster's pubkeys**, and this branch changed how the roster
is written and read. If that is wrong, the care team is empty and nobody is a care admin — and it will look
like a configuration problem, not a bug.

`reference/SAFEGUARDING-BOUNDARY.md` distinguishes what is *enforced by the relay* from what is *presented
by the app*. S1-S6 below are the enforced list; a failure there is a genuine protection failure, not a UI
bug. Seed the church's children and guardians **through the console screens** (rule 4).

| # | Do this | Must happen |
|---|---|---|
| S1 | Young person messages an adult the church has NOT cleared; then that adult replies | Both directions refused, and a message that somehow got stored is still never served back |
| S2 | A young person has a photo on their profile, church has never opened the photo setting | Photo does not appear. Default off, including for a church that never touched it |
| S3 | Young person tries to post a public request for help, and to list themselves in "I'm here to help" | Both refused |
| S4 | Young person makes a PRIVATE request for help | Served only to cleared adults — not the wider care team, not ordinary members. **Verify on a relay that has ingested the church's list of children**; a relay that has not cannot make this judgement and will serve it to whoever the phone sealed it to |
| S5 | Young person opens an adults-only room and tries to post | Existing messages refused, and the post refused |
| S6 | An adults-only room generates a notification | Its NAME does not reach the young person's lock screen |
| S7 | Open the care screens in the first moments after launch, before the safeguarding lists arrive | Requests held as confidential — "still checking who these are from" — and **never** offered "Set up help". This is the recurring shape: the cache paints before authority arrives |
| S8 | A cleared youth worker who is NOT on the care rota messages a child; the child replies | The reply reaches him. Fixed 2026-08-27 after a measurement where the child answered and nobody came, and her words were also wrapped for the group the feature exists to keep out. Regression check |
| S9 | Staff a care team through the roster, then check the relay | The care admin resolves, and the team room reaches exactly the people on it. Directly exposed to this branch's roster change |
| S10 | Re-seat a CHILD onto a new phone (the lost-12-words route) | Their name comes back without a restart, and their minor status and guardian link survive |
| S11 | Check a child in and out of a group | The register is sealed; the child's presence and pickup code are not readable on the relay |
| S12 | A guardian notice is raised | It reaches the parent and nobody else |

### B. What this branch changed

No test can reach these — that is why the round exists.

| # | Do this | Must happen |
|---|---|---|
| 1 | New church, then immediately add a service and a rota | Saves promptly; nothing readable in the database |
| 2 | Same, before the church's key exists | Refuses, says why, **keeps what was typed** |
| 3 | Pull the network, then save a service | The same honest refusal |
| 4 | Publish a rota with the relay unreachable | **Nobody is messaged** asking them to serve |
| 5 | "Create + fill this quarter" before the key is ready | No duplicate services. Untested — no test could be written that would fail |
| 6 | Build a serving team with real names, then read the database | Names encrypted; care team and team rooms still reach the right people |
| 7 | Open the console and edit stewards immediately, before the key loads | Every steward's label survives |
| 8 | Remove a steward before the key loads | The removal still happens. A label must never block a revocation |
| 9 | Reconnect a member on a new phone | Their name returns **without restarting the app** |
| 10 | Ask to become a steward with the relay down | It must NOT say "Request sent" |
| 11 | Set a 6-digit PIN on a phone | Accepted (owner decision, `reference/DOMAIN.md` 2026-09-05) |

### C. The owner's original five

| # | Do this | Watch for |
|---|---|---|
| 12 | Care screens with the clock 15 minutes out | Requests held as confidential; never "Set up help". Put the clock back and CHECK it |
| 13 | Two consoles; close a request on one | The other sees it closed. Then approve one with the relay unreachable for the second publish |
| 14 | Bank import: once, again, then interrupted and retried | Reconciles to £4,744.09; the second import posts nothing |
| 15 | Change a display name twice in one sitting; remove a message and undo it at once | Both stick |
| 16 | **Use it for twenty minutes** | Whatever feels wrong. This is the part no test replaces |

---

## Known blind spots of this round, stated up front

- **Items 9, 10 and 11 need a real phone**, not a sim.
- **The page-speed change is invisible here.** The relay serves the development page; the `defer` change is
  in the packaged page. A sim against this relay cannot exercise it either way.
- **Two known defects are open and will show up if the round reaches them:** team creation ignores a failed
  roster save (`app/stew-dashboard.jsx`), and the first-launch wizard's keyboard trap only works on its first
  step. Both are confirmed. Finding them again is not a new finding.

## Output

Findings to `reference/`, named by what a person would experience, not by the code. For each: what was done,
what happened, what was expected, and **which surface it was seen on** — console, member app, phone, or the
relay's database. A finding without its surface has caused two of the last three withdrawn claims.
