# Fix plan — the four safeguarding gaps

Written 2026-08-31 against `a2e3ca3` on `fix/console-sweep-defects`. Baseline suite: **2109 tests,
2108 pass, 0 fail, 1 pre-existing todo**. Findings and their evidence are in
`reference/SAFEGUARDING-BOUNDARY.md`; this file is the executable half.

**Read `CLAUDE.md` before starting.** Rules 1, 2, 4 and 8 are load-bearing here and each fix below names
how it satisfies them. Read `reference/DOMAIN.md` too — in particular, a supervised shared family device
is NOT a threat model, and a church may legitimately have no child-safe rooms at all.

**Order and cadence.** Do them in the order below. **Stop after Fix 2 and get an independent audit**
(rule 5) before starting Fix 3. Fixes 1–3 are relay changes and share a test harness; Fix 4 is a client
change and is the only one that is partly a copy change.

**Do not touch finance.** It is locked off.

**Backwards compatibility (owner, 2026-08-25): add, never repurpose.** The relay rehydrates all history on
every update, so an ingest change is retroactive. None of these fixes may change the meaning of an existing
document — Fix 2 adds an ingest for a document type that already exists and is already written by consoles
in the field, so it must tolerate old and malformed content without throwing.

---

## Fix 1 — an adults-only room's NAME is served to a young person

**What a young person experiences.** Their chat list shows "Safeguarding concerns", "Elders — pastoral",
"Marriage counselling" by name, with subtitle and category. Tapping one shows nothing; posting fails. The
name itself is the disclosure.

**Evidence.** `canRead`'s `group:` branch (`gateway.mjs:2383`) special-cases only `GROUP_VIS === 'team'`,
then falls to the ordinary effective-member test. CONFIRMED by execution: the relay served a minor
`{"name":"Leaders"}` while refusing the room's messages and refusing their post.

**The precedent that makes this uncontroversial.** The same file, ~15 lines above, already fixed the exact
shape for team rooms: *"Gating only its MESSAGES left the room listed in the member's chat list, where it
accepted typing and silently discarded it… Listing the room is what makes it look joinable, so the
DEFINITION has to go too."* The child-safe case never got the same treatment. The message gate at
`:2470-2475` already holds the check to mirror.

**The change.** In the `d.startsWith(GROUP_D)` branch of `canRead`, after the existing `team` case, withhold
the definition from a minor of the governing church unless the group is child-safe — mirroring `:2474`
exactly, including its `GROUP_CHURCH.get(gid) || idNamesOwner(gid)` fallback. Stewards, the church key and
networks return true earlier and are unaffected.

**Consumers of the group definition you MUST check before editing (rule 2).** Read each and say in the
commit what it does when the doc is withheld:
- `src/fellowship.src.js:3387-3390` — the member app's group subscription/room list
- `src/steward.src.js:3651, 3670, 3732, 5420-5421` — console group editing and listing
- `scripts/gateway.mjs:1552` — ingest, and `:1918` — the write gate
- `app/screens-chat.jsx:358` — the client filter this is backstopping

**Watch for.** A child-safe room must still be served. A minor who is a group LEADER is an edge case —
decide and state which way it goes. Confirm the console still sees every room (it authenticates as the
church or a steward, so it should return true before this branch).

**Test that must fail if the feature is deleted (rule 1).** Drive a real relay: a church, an adults-only
group, a child-safe group, and a member marked minor. Assert the minor is served the child-safe
definition and NOT the adults-only one, and that a steward is still served both. It must fail if the new
lines are removed — prove that by removing them and watching it go red.

---

## Fix 2 — a steward's "reset this person's photo" is never enforced

**What happens now.** A steward suppresses a photo; the member re-uploads and the relay stores and serves
it. Only compliant clients hide it. `app/identity.jsx:1399` tells the steward something stronger than the
truth.

**Evidence.** `nophoto:` appears in `gateway.mjs` only at `:398` (declaration), `:1896` and `:1898` (the
write gate that says who may edit the list). It is never consulted when accepting a kind-0. CONFIRMED by
execution: a suppressed adult AND a suppressed child both re-published a photo successfully in a church
with `childPhotos:true`.

**The change.** Three parts, patterned exactly on `MEMBER_PHOTOS_OFF`, which is the same shape:
1. A `NOPHOTO_BY = new Map()` (church → Set of suppressed pubkeys), populated where the other church-scoped
   safeguarding docs are ingested (`gateway.mjs` around `:1508`). The doc is `nophoto:<churchpub>` with
   content `{"pubkeys":[…]}` — see `src/fellowship.src.js:3509` for the shape the client already parses.
2. Add it to the rehydrate clear list at `:1406` alongside `CHILD_PHOTOS_OK` and `MEMBER_PHOTOS_OFF`.
   **This is the step most likely to be forgotten**, and `:1402` carries a note about `GROUP_CHILDSAFE`
   having had exactly this bug.
3. A `photoSuppressed(pub)` predicate scoped like `memberPhotoBlocked` — any church the person belongs to
   that lists them suppresses the photo — added to the existing kind-0 condition at `:1717`.

**Consumers you MUST check (rule 2).**
- `scripts/trinity-rules.mjs` `suppressPhotoAv` — the shared client rule, used by `src/fellowship.src.js:1800`
- `src/fellowship.src.js:3442, 3455, 3474, 3509` — where the client builds `_noPhoto` and `photoBlocked`
- `src/steward.src.js` — wherever the console writes the list
- `gateway.mjs:1898` — the write gate stays as it is; this fix adds a READ/accept consequence, not a new writer

**Watch for.** Keep this SEPARATE from `childPhotoBlocked`. In a church with child photos off, a suppressed
child is already covered for a different reason; that is not evidence this fix works. Test a suppressed
ADULT, and a suppressed child in a church with `childPhotos:true`. Malformed or absent content must not
throw — old consoles are in the field.

**Test (rule 1).** A suppressed member's kind-0 carrying a picture is refused by a real relay; the same
member's kind-0 with no picture is accepted; an unsuppressed member's photo is accepted.

---

## STOP HERE. Independent audit of Fixes 1 and 2 before continuing (rule 5).

Run it read-only in a worktree, briefed to REFUTE. Give it the target commit and tell it a worktree has no
`node_modules` (~5 `esbuild ENOENT` failures are environmental) and that fixed-port tests collide with a
concurrent suite.

---

## Fix 3 — a member marked as a child stays advertised as an available helper

**What a young person experiences.** They listed themselves as willing to help. A steward later marks them
as a child. On every ordinary member's Care tab they remain under "Ready to help" with their offer text,
inviting adults to contact them. The DM itself is refused by the relay, so the lived harm is repeated
contact attempts and a lock nobody explains.

**Evidence.** `accept()` AVAIL_D (`:2006`) refuses a REFRESH (`!minorOf`), but nothing withdraws the stored
doc and `canRead` never names AVAIL_D — the only `careavail` in that region (`:2284`) is a COMMENT, not a
gate. The client filter (`app/screens-today.jsx:840`) reads `ctx.safeguard.minors`, which
`src/fellowship.src.js:3446-3450` documents as arriving EMPTY on every non-steward device — deliberately,
because serving a congregation's list of children to ordinary members was itself a fault fixed in
AUDIT-2026-07-27. Two correct decisions combining into a filter that cannot fire where it is needed.
Per DOMAIN, marking an existing member as a child is *fairly common*, so this is a live path.

**The change.** Gate it at the relay, where the knowledge lives. In `canRead`, add an AVAIL_D branch
modelled on the CAREREQ precedent at `:2225` (`if (minorOf(e.pubkey, cp)) return authed === e.pubkey || …`):
a minor's availability doc is served to its author, the church, and stewards who may act on it — not to
ordinary members.

**Do NOT** try to fix this by populating `safeguard.minors` on member devices. That would undo
AUDIT-2026-07-27 and hand every member the list of the congregation's children. Leave the client filter
in place for stewards; it is correct where it can see.

**Consumers you MUST check (rule 2).**
- `src/fellowship.src.js:1305, 1308, 1342` — publish/read of `careavail:`
- `src/steward.src.js:5541` — the console's view of the helper register
- `app/screens-today.jsx:840-841, 870` — the list and the minor's own listing control
- `scripts/trinity-doc-types.mjs:98, 255` — the doc-type registry

**Watch for.** A steward must still see it, or they cannot understand why someone vanished. Decide whether
the church console shows a marker. Do not break the ordinary (non-minor) helper list — that is the common
case and is heavily used.

**Test (rule 1).** Against a real relay: member publishes `careavail:`, steward marks them minor, an
ordinary member reads the register and does NOT get the listing, while the church/steward still does.

---

## Fix 4 — a child in a church that has cleared nobody is told the wrong thing

**Status: the narrowest of the four, and the one to think about before coding.** It is NOT a disclosure.

**What actually happens.** At `src/fellowship.src.js:4030-4042`: when the child's own sealed clearance has
not arrived (`!sure`) AND `_fetchChildCareAudience(cp)` returns `[]`, the code falls through with
`childish = false` and seals the request to the FULL CARE ROTA. `_fetchChildCareAudience` is deliberately
the mirror of the relay's `childCareReader` — cleared adults ∪ safeguarding-capable stewards — so `[]`
means the church has cleared nobody *and* has no safeguarding steward. `childCareReader` then reduces to
the church key and its network. The church key is always in `recips`, so **the console can both receive and
decrypt; the care rota holds keys but is never served; a safeguarding steward, if one existed, would be
served but hold no key.** The sheet meanwhile tells the child it went privately to their care team.

**Reachability, which must be established before any code changes.** This needs a church that has marked
this person as a minor (so the relay withholds) while the phone does not yet know (so `!sure`), and that
has cleared nobody. Plausible during setup, but it is a conjunction. **A refutation pass is running on
exactly this question — do not start Fix 4 until its result is in.** If it reports UNREACHABLE, close this
item as "no change, reasoning recorded" rather than inventing a fix.

**If it is reachable, the change is copy first, code second.** The relay's behaviour here is protective and
should not be loosened: sending a child's disclosure to a general care rota is exactly what the gate exists
to prevent. So:
- The confirmation the child sees must not promise a care team that will not receive it.
- Consider sealing to the set the relay will actually serve (church + network) rather than to a rota that
  can never read it, so the seal and the gate agree.
- The comment at `:4034-4042` argues the current fallback is safe because "the relay is the backstop either
  way". That is true for confidentiality and false for delivery. Update it either way — a comment that
  states a wrong reason is how this class of bug survives review.

**Consumers you MUST check (rule 2).** `publishCareRequest` and `sendCareChat` — the latter reuses the
`['aud', …]` tag written at `:4097` so a reply reaches the same set; changing the audience changes replies
too. Also `app/screens-today.jsx:747, 758, 776` (the pre-flight that decides whether a form is shown at
all) and `:4044-4045` (`no-one-cleared`).

---

## Rules that apply to every fix here

- **Rule 1 — test at the point of USE.** An engine test is not enough. For the relay fixes that means
  driving a real `gateway.mjs` over a WebSocket on a temp port with a temp data dir. For Fix 4 it means
  lifting the real function out of `vendor/fellowship.js` and executing it, never reimplementing it, and
  never letting a stub supply the decision the test is named after.
- **Rule 3 — never assert behaviour by matching text in `app/*.jsx`.** They ship unbundled, so `false && `
  in front of a condition leaves every word in place and the assertion still passes. Lift and run, or make
  no claim.
- **Rule 4 — nothing in a commit message unless a test proves it.** Three commit messages in one sitting
  here have asserted things that were never true.
- **Rule 8 — account for the test count every time it moves.** Baseline 2109. If it goes down, say which
  tests went and why, in the commit.
- **Sabotage must be scoped to the function under test.** Near-identical siblings are this codebase's house
  style; a plain string-replace takes the first match, which has produced false conclusions five times here.
  Slice the enclosing function, assert the anchor appears exactly once inside it, replace, splice back.
- **Rule 6 — device verification.** None of this is merged until it has been driven on the attached phone.
  The handset is currently locked; that is the owner's to clear.
- **Rule 9 — stop when the error rate climbs.** Four fixes is a long session. Stopping is a control.
