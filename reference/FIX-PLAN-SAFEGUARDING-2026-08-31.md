# Fix plan — the four safeguarding gaps

Written 2026-08-31 against `a2e3ca3` on `fix/console-sweep-defects`. Baseline suite: **2109 tests,
2108 pass, 0 fail, 1 pre-existing todo**. The findings and the honest boundary they produce are in
`reference/SAFEGUARDING-BOUNDARY.md`; this file is the executable half.

**All four were independently re-tested by an agent briefed to REFUTE them. All four reproduced**, against a
real `scripts/gateway.mjs` over WebSocket and against functions lifted out of `vendor/fellowship.js` and
executed. Where that pass corrected the original account, the correction is in the section below — read it,
because two of the four are different in shape from how they were first described.

**Read `CLAUDE.md` before starting.** Rules 1, 2, 4 and 8 are load-bearing here. Read `reference/DOMAIN.md`
too — a supervised shared family device is NOT a threat model, and a church may legitimately have no
child-safe rooms at all.

**Order.** Severity order, worst first. **Stop after Fix 2 and get an independent audit** (rule 5) before
starting Fix 3. Fixes 2, 3 and 4 are relay changes and share a harness; Fix 1 is a client change.

**Do not touch finance.** It is locked off.

**Backwards compatibility (owner, 2026-08-25): add, never repurpose.** The relay rehydrates all history on
every update, so an ingest change is retroactive. Fix 4 adds an ingest for a document type already written
by consoles in the field — it must tolerate old and malformed content without throwing.

---

## Fix 1 — a child's request for help is sealed to people who were never cleared

**Severity: highest. This is a disclosure, not only a delivery failure** — the original account got that
wrong and the boundary document has been corrected.

**What a young person experiences.** They work up to telling someone something difficult. The sheet says
*"This goes privately to your care team — no one else sees it."* Nobody on that team is coming, because this
relay refuses to serve it to them — while their words sit sealed and openable by that same team on every
other relay the church uses.

**What was proven.** Driving the shipped `publishCareRequest` with the clearance not yet arrived and an
empty cleared list: the request is sealed to CHURCH, the CHILD, and two **uncleared care-rota members, both
of whom could decrypt it**. The `['aud', …]` tag is written as `team`. Rendering the real screen returns
"Sent to your care team" and the adult wording. Then, with two real gateways holding identical churches and
rosters: the relay **with** the `minors:` document refused to serve it to an uncleared care steward; the
relay **without** it served it, and that steward holds the key. `_publishAny(churchRelays(), evt)`
(`fellowship.src.js:4102`) sends to all of them.

**Reachability — CONFIRMED, and not exotic.** Three conditions: the person is a minor at the relay; their own
`clearance:<pub>` has not landed on this device; and the church has an empty `approved:` list *and* no
safeguarding-capable steward (`_fetchChildCareAudience` unions both). The second is every cold start before
the subscription delivers — `publishCareRequest` reads `_sgMine().known` raw and does **not** consult the
`trinityone.sgassume.` cache that `_assumeMinor` uses. `app/stew-dashboard.jsx:4051` records a measured run
where 50 of 150 clearance publishes silently never landed. The perverse part: once the clearance arrives the
child is correctly refused with a helpful message. Protection turns on whether one document has arrived.

**The change.** The bug is the inference, at `src/fellowship.src.js:4030-4042`: an empty cleared-adults list
is treated as evidence that safeguarding is unused here, when it is only evidence that nobody is cleared.
When `_sgMine(cp)` is unknown, **ask the document that actually answers the question** — fetch this member's
own `clearance:<pub>`, which the relay serves to them — rather than inferring from `approved:`. Keep the
existing refusals: `unknown-clearance` when the answer cannot be obtained, `no-one-cleared` when it can and
nobody is cleared. Do not widen anything.

Also consider making `publishCareRequest` consult the same `trinityone.sgassume.` cache `_assumeMinor` uses,
so the cold-start window closes rather than merely narrowing. Decide deliberately and say which you did.

**Consumers you MUST check (rule 2).** `publishCareRequest`; `sendCareChat`, which reuses the `['aud', …]`
tag so changing the audience changes replies too; `app/screens-today.jsx:747, 758, 775-776` (the pre-flight
and the "no form" guard, both gated on `isMinor`); `:4044-4045` (`no-one-cleared`); and `careSentWording`.

**Watch for.** The comment at `:4034-4042` argues the fallback is safe because "the relay is the backstop
either way". That is true for one relay and false for the church's relay list. Update the comment — a
comment stating a wrong reason is how this class of bug survives review.

**Test (rule 1).** Lift the real `publishCareRequest` from `vendor/fellowship.js` and execute it. Assert
that with the clearance absent and the church clearing nobody, the request is NOT sealed to an uncleared
rota member. A stub must not supply the minor/adult decision — that is the decision under test.

---

## Fix 2 — a marked child stays advertised as an available helper

**What a young person experiences.** They listed themselves as willing to help. A steward later marks them
as a child. On every ordinary member's Care tab they remain under "Ready to help" with their offer text,
inviting adults to contact them.

**What was proven.** Before marking, the listing is served. The church marks them a child; a REFRESH of the
listing is refused; **the original keeps being served**, with zero kind-5 deletions on the relay. On the
client half: `minors:` served to an authenticated ordinary member = 0, to the minor themself = 0, to the
church = 1. Rendering the shipped `CareAvailability` with `minors: []` draws the marked child; the control
with a steward's populated list does not. So the filter is live and correct, running on input it can never
receive.

**The change.** Gate it at the relay, where the knowledge lives. Add an `AVAIL_D` branch to `canRead`
mirroring the write gate at `:2006`: a minor's availability doc is not served. Decide explicitly whether the
author, the church and stewards still see it — a steward must, or they cannot understand why someone
vanished. The CAREREQ branch at `:2225` is the precedent for that shape.

**Do NOT** fix this by populating `safeguard.minors` on member devices. That would undo AUDIT-2026-07-27 and
hand every member the congregation's list of children. Leave the client filter for stewards; it is correct
where it can see.

**Consumers (rule 2).** `src/fellowship.src.js:1305, 1308, 1342`; `src/steward.src.js:5541`;
`app/screens-today.jsx:840-841, 870`; `scripts/trinity-doc-types.mjs:98, 255`.

**Watch for.** Do not break the ordinary non-minor helper list — the common case, heavily used.

**Test (rule 1).** Real relay: member publishes `careavail:`, steward marks them minor, an ordinary member
reads the register and does NOT get the listing, while the church/steward still does.

---

## STOP HERE. Independent audit of Fixes 1 and 2 before continuing (rule 5).

Read-only worktree, briefed to REFUTE. Give it the target commit; tell it a worktree has no `node_modules`
(~5 `esbuild ENOENT` failures are environmental) and that fixed-port tests collide with a concurrent suite.

---

## Fix 3 — an adults-only room's NAME is served to a young person

**What a young person experiences.** Their chat list shows "Marriage counselling", "Safeguarding concerns",
"Elders — pastoral" by name. Tapping shows nothing; posting fails. The name is the disclosure.

**What was proven.** With a room named `Marriage counselling` and `childsafe` absent: messages served to the
minor 0 (adult 1), the minor's post refused, definition served to anonymous 0 — and **definition served to
the minor 1**, content `{"name":"Marriage counselling","kind":"open"}`. A room-list REQ as the minor returns
both the child-safe and the adults-only room. No earlier `canRead` branch returns false for a minor.

**The precedent.** Fifteen lines above the gap, `canRead` already withholds *team* room definitions for the
identical reason: *"Gating only its MESSAGES left the room listed in the member's chat list, where it
accepted typing and silently discarded it… Listing the room is what makes it look joinable, so the
DEFINITION has to go too."* The child-safe case never got the same treatment.

**The change.** In the `GROUP_D` branch of `canRead` (`:2383`), after the `team` case, add the test the
message gate already makes at `:2474`, including its `GROUP_CHURCH.get(gid) || idNamesOwner(gid)` fallback.
Stewards, the church key and networks return true earlier and are unaffected.

**Consumers (rule 2).** `src/fellowship.src.js:3387-3390`; `src/steward.src.js:3651, 3670, 3732,
5420-5421`; `gateway.mjs:1552` (ingest) and `:1918` (write gate); `app/screens-chat.jsx:358`.

**Watch for.** A child-safe room must still be served. A minor who is a group LEADER is an edge case —
decide and state which way it goes. Confirm the console still sees every room.

**Test (rule 1).** Real relay, a church, an adults-only group, a child-safe group, a member marked minor:
the minor is served the child-safe definition and NOT the adults-only one; a steward is still served both.
Remove the new lines and watch it go red.

---

## Fix 4 — a steward's "reset this person's photo" is never enforced

**Lowest of the four for a child, but it always bites an adult.** With child photos left off — the default —
a child is covered by `childPhotoBlocked`, and the console back-fills every minor into the suppression list
(`app/stew-dashboard.jsx:4205`). So for a child this bites only in a church that opted children's photos in.
For an adult it bites always.

**What was proven.** In a church with `features.childPhotos: true` and member photos absent: a suppressed
**adult** re-published a kind-0 with a photo — accepted; a suppressed **child** likewise — accepted; both
photos then served to another member. Separator control: with church-wide child photos off, the same child's
photo was refused, by the church-wide rule and not by the per-account one.

**The corrected location.** `nophoto:` is consulted in `gateway.mjs` only at `:1900` (who may write the
list) and `:983`. It is never consulted in `accept()` for kind-0 and never in `canRead`.

**The change.** Three parts, patterned on `MEMBER_PHOTOS_OFF`:
1. A `NOPHOTO_BY` map (church → Set of suppressed pubkeys), populated where the other church-scoped
   safeguarding docs are ingested (around `:1508`). The doc is `nophoto:<churchpub>`, content
   `{"pubkeys":[…]}` — see `src/fellowship.src.js:3509` for the shape the client already parses.
2. **Add it to the rehydrate clear list at `:1406`.** This is the step most likely to be forgotten, and
   `:1402` carries a note about `GROUP_CHILDSAFE` having had exactly this bug.
3. A `photoSuppressed(pub)` predicate scoped like `memberPhotoBlocked`, added to the kind-0 condition
   at `:1717`.

**Also fix the copy.** The console tooltip (`app/stew-dashboard.jsx:4535`) promises the church sees only
their symbol and that they cannot set a new photo until allowed again. Until the relay enforces it, both are
false. If the code fix lands, the copy becomes true and can stay; if it does not, the copy must change.

**Consumers (rule 2).** `scripts/trinity-rules.mjs` `suppressPhotoAv`, used by `src/fellowship.src.js:1800`;
`src/fellowship.src.js:3442, 3455, 3474, 3509`; the console writer and `stew-dashboard.jsx:4205, 4535`;
`gateway.mjs:1900` (write gate — unchanged, this adds an accept consequence, not a new writer).

**Watch for.** Keep this separate from `childPhotoBlocked`. Test a suppressed ADULT, and a suppressed child
in a church with `childPhotos:true`. Malformed or absent content must not throw — old consoles are live.

**Test (rule 1).** A suppressed member's kind-0 carrying a picture is refused by a real relay; the same
member's kind-0 without a picture is accepted; an unsuppressed member's photo is accepted.

---

## Rules that apply to every fix here

- **Rule 1 — test at the point of USE.** An engine test is not enough. For relay fixes, drive a real
  `gateway.mjs` over a WebSocket on a temp port with a temp data dir. For client fixes, lift the real
  function out of `vendor/fellowship.js` and execute it — never reimplement it, and never let a stub supply
  the decision the test is named after.
- **Rule 3 — never assert behaviour by matching text in `app/*.jsx`.** They ship unbundled, so `false && `
  in front of a condition leaves every word in place and the assertion still passes.
- **Rule 4 — nothing in a commit message unless a test proves it.**
- **Rule 8 — account for the test count every time it moves.** Baseline 2109.
- **Sabotage must be scoped to the function under test.** Slice the enclosing function, assert the anchor
  appears exactly once inside it, replace, splice back. A mis-aimed sabotage reports what a blind test
  reports, and has produced false conclusions five times here.
- **Rule 6 — device verification.** Nothing merges until it has been driven on the attached phone. The
  handset is currently locked; that is the owner's to clear.
- **Rule 9 — stop when the error rate climbs.** Four fixes is a long session. Stopping is a control.
