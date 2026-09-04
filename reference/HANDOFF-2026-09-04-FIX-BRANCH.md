# Handoff — the audit fix branch, ready to test

Written overnight 2026-09-03/04. **Nothing has been merged and nothing is deployed.** All of it is on
`fix/audit-2026-09-02`, 28 commits on top of `50e196c`.

---

## 1. Where to look first

**Both apps are already installed on the Oppo**, built from this branch:

    com.trinityone.app       the member app
    com.trinityone.steward   the console

If you reinstall or rebuild, the recipe and its traps are in
`reference/DEVICE-VERIFICATION-fix-audit-2026-09-02.md` — read the `cap sync` trap before trusting any
device result.

**Suite: 2559 tests, 2554 pass, 3 skipped, 1 todo, 1 fail.** The one failure is
`sim-harness-dialogs.test.mjs`, which cannot pass in a worktree (the sim drivers are gitignored); it passes
in the main tree. Baseline before this work was 2476, so **+83 tests**, each accounted for in its commit.

The run is only valid from a quiet box. Two `node --test` processes from an earlier run were still alive
after ~4 hours and produced 42 phantom failures across unrelated relay files before they were killed. Check
`ps -eo cmd | grep 'node --test'` first.

---

## 2. What is fixed, in the order it matters

Nearly all of it is one shape: **a control reported success over a write nobody checked.**

| | What was wrong |
|---|---|
| **Safeguarding** | The console said a child mark / clearance / guardian link had saved when it half-saved or failed. Sharpest: unmarking a child claimed their youth-work clearance was revoked whether or not the relay took it — a steward could believe someone is no longer cleared to work with young people while every relay says they are. |
| | A child's care request could be filed with the adults, under the button that publishes a need church-wide, while the safeguarding lists were still loading. |
| | The care team — who a private request for help is sealed to — was taken from whoever wrote last, not from the church. (This was the backlog's own HIGH S1.) |
| **Relay** | A phone with a clock >5 min out could admit NO relay at all, and the app blamed the church. |
| | "My church runs its own relay" searched before the proof it had just started, so it said "No church found" while the right address sat unproved. |
| | A member could not stop talking to an address an invite had added. The control existed and was never rendered. |
| | "If one goes down, nothing is lost" was counted from a string any host can type. |
| | NIP-42 auth could never succeed on an IPv6 host — every gated read came back empty. |
| **Member app** | "Yes, I'll serve", RSVPs and **leaving a church** all reported success over sends that were never checked. Leaving removed the church from the phone whether or not anyone was told. |
| | "Recovery words copied" was said whether or not the clipboard write happened. Those words are the account. |
| | The 12-word wizard could be confirmed past words it had never shown. |
| | A backup that warned "no copy may have been kept" was recorded as a backup — silencing the reminder for exactly the people with no file. |
| **Console** | Undo on a deleted room brought it back **open, unencrypted, not child-safe**, with its members emptied. |
| | The ✕ next to Approve was a one-tap permanent block that re-keys the whole church. |
| | The blocked list would not say who anyone was. |
| | Ending a safety check, closing someone's request for help, and importing a bank statement all reported success unchecked. |
| **Everywhere** | Every toast drew a green tick, including the failures, and a 30-word failure vanished in 1.9s. |

---

## 2b. A third audit ran after the handoff was first written — read this

The full-branch audit returned "**not yet safe to merge**" and was right. Four things it found, all now
fixed and all re-verified:

- **A crash I shipped.** `NewGroupModal` called a hook below its early return, so opening it threw React
  #310 and rendered nothing — **no steward could create a group**. My test was a source-text match and my
  device check rendered the modal already open, the one transition that works. There is now a structural
  test that walks every component and fails on a hook below an early return, and the device check drives
  closed → open → closed → open.
- **"I'm here to help" was inert.** The engine swallowed the failed publish, so the screen fix could never
  fire — and its test stubbed the very thing that was broken. Fixed, with a test that drives the shipped
  engine and cannot be satisfied by a stub. **Eight more functions share that shape and are listed in the
  commit, deliberately not changed overnight.**
- **Two duplicate JSX attributes** silently killed two of my own fixes (a double-fire guard and a touch
  target). Swept the whole branch; no others.
- **Refusing a care-team document answered "this church has nobody"** rather than "unknown", which would
  have narrowed who a request seals to. Now returns unknown.

**Still open and needing your decision — do this one first:** the relay refuses NIP-42 auth beyond its own
window, and batch 2 removed only the CLIENT's clock check. A phone 15 minutes out now *admits* the relay
and then silently fails to authenticate: gated reads come back empty with nothing on screen, and the
console's care requests and check-in sit in "loading" for ever. Better than "no relay at all", still wrong.
Changing a relay-side auth window is a security decision and I have not made it.

## 2c. The eight swallowed publishes — five now fixed, three left on purpose

The audit's "I'm here to help" finding was one instance of a shape; a sweep found nine in all. Worth saying
plainly: **none of these was ever broken in normal use.** They work whenever the message actually sends,
which is nearly always. What was broken is the failure case — a send that reached no relay came back looking
exactly like one that worked.

Fixed, with the screen made to say it, and both apps checked on the phone:

- withdrawing your own request for help
- a care team closing or approving a request
- taking a meal slot, and standing down from one
- a recipient undoing "not this day"

Plus a case neither engine handled: **setting up help is two publishes.** The need goes up, then the request
is marked dealt-with. If only the first lands, help really IS arranged and the request still reads open —
the team works it twice and the person who asked is told nothing. Both engines now report which half landed,
and both screens say so instead of "Opened as a need".

Left alone deliberately: **emoji reactions** (a warning about a thumbs-up is noise; the right fix is not
drawing it until it lands, which is a different change) and **the wallet backup** — same shape, worst
version of it, but every Lightning surface is off for the pilot.

## 3. What I would test by hand, in this order

1. **The clock fix** — set the phone's clock 15 minutes out and use the app normally. This is the one with
   the widest blast radius and it is already device-verified with a control, but a human should feel it.
2. **The console's Undo** — make a room invite-only + encrypted + child-safe, delete it, press Undo, then
   look at the room's settings. Every one of those should have survived.
3. **Decline on the join queue** — it should now take two taps and name the person.
4. **Mark someone as a child, then unmark them** while the relay is unreachable (turn the box's relay off).
   The console should refuse to claim anything, and should say they are still cleared.
5. **A failure toast** — anything offline. It should have no tick and stay up long enough to read.

---

## 4. What is NOT covered — read this before trusting the branch

- **No end-to-end run with a real church on the phone.** Every device check drives the SHIPPED code on the
  handset with its outbound calls stubbed. A handset has no way to blackhole the live relays, and the
  instruction was that a8 stays untouched, so no church was created or restored on it.
- **2G timing** — the relay-adoption fix (#10) is about a window that only opens on a slow link. A local
  relay failing in 208 ms cannot produce it.
- **A wedged socket mid-publish** — the 11-second timeout case only happens when a radio drops mid-send.
- **A sleeping screen deferring SecureStorage** — the real trigger for the 12-word dead end.
- **TalkBack** — the accessibility batch sets the attributes TalkBack reads; nobody has heard it speak them.
- **Double-taps.** None of the newly-async controls gained a busy state, so a fast double-press can still
  fire two writes (mark-as-child, block-confirm, unblock). An audit confirmed this is real. It is the
  largest known gap on the branch.

---

## 5. Decisions recorded, and one still open

In `reference/DOMAIN.md`, from 2026-09-03:
- a member who leaves KEEPS their name on what they already wrote (the privacy narrowing was declined);
- a well-formed code that is not a church says "not found" — **decided but NOT yet implemented**;
- Lightning and wallet components are off for the pilot and are not to be worked on. The Lightning address
  row has the same "Saved" defect as its neighbours and was deliberately left alone.

Still needing the owner: `removeFund`, `removeService`, `removeRota`, `rotateFinanceKey` and 14 uncalled
Fellowship methods are either unbuilt features or dead code, and only you can say which.

---

## 6. Process notes worth keeping

- **Three audits ran against this branch** (batches 1-2, 3-7, and the whole branch). Each found real
  defects, including a fix that did not work in the state it was written for and two untrue claims in
  commit messages. Rule 5 earned its place.
- **Changing a function's signature has TWO caller lists** — the code that calls it, and the tests that
  slice it out of the file BY NAME. That bit five times. A sliced test does not fail loudly; it says
  "re-anchor this test", which reads like harness noise.
- **Per-batch test runs are not enough.** Three separate times, a file that passed when its own batch
  landed broke two or three batches later. Only the full suite caught it.
- **A "proved it fails first" is worthless if the old code fails for the wrong reason.** Twice a lift threw
  on a missing name instead of returning the wrong answer. Inject the new helper so the same harness runs
  against both.
