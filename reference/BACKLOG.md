# Backlog — noted for later

(Care-partners roadmap idea moved to `reference/SPINE.md` → Phase 2, beside "Church-adjacent charities".)


## Decided NOT to do — relay tag index (2026-09-05)

Finding 4 of the re-verification audit was "the relay has no tag index, so queries degrade as a church
accumulates history". True, deliberate, and **the decision is to leave it alone.** Recorded here so the next
round does not rediscover it and "fix" it.

**What the relay actually does.** `scripts/event-store.mjs` indexes `(kind, created_at)`, `(pubkey,
created_at)`, `(church, created_at)`, `dtag` and `repl`. `#d` and `#church` are columns. Any OTHER `#tag`
filter streams the indexed set newest-first, `JSON.parse`s each row and post-matches, capped at 200,000 rows
per filter with a per-connection allowance of 300,000 rows/s authed and 25,000 anon.

**It was tried and reverted** (`540fc9e` added it, `0c3c88b` reverted, 2026-07-14). The index ordered by
`e.created_at` rather than the tag table's, so `LIMIT` never early-terminated and it materialised every
match — measured *worse* than the scan at ~123 ms per filter. And compound single-letter filters (`#p` +
`#t`, which is the shape this product actually sends) limited on one tag and post-filtered the other,
**silently truncating results**. Two reviewers and `EXPLAIN QUERY PLAN` at the time. Do not re-apply that
design.

**Measured 2026-09-05** against the real store at 200,000 synthetic rows: one doc by `#d` 0.3 ms; a quiet
group `#t`+`#g` limit 50, 9.4 ms; a group with NO messages (scans to the cap) 807 ms; 32 crafted no-match
filters against the authed budget, 1.2 s. The live relay holds **265 events**. `MAX_EVENTS` is 20,000 per
church for ephemeral kinds, so three pilot churches sharing a box is ≤ 60k chat rows — a no-match scan of
roughly 240 ms of single-thread time. Today it is microseconds.

Note the finding's framing was backwards: the cost is **relay CPU**, not bytes on the wire, so it is not
worse on a thin pipe.

**Revisit when either is true:**
1. A box exceeds ~50,000 rows of a single kind. Then build `event_tags(tag, val, created_at DESC,
   event_id)` as a covering index, and the test must assert the query PLAN via `EXPLAIN` at 200k rows **with
   a compound `#p`+`#t` filter in the fixture** — the two things the reverted attempt lacked.
2. Sooner and cheaper, if relay CPU shows up at all: **scope member REQs by `church`** on the relay for
   authed members. The column and its index already exist, and it bounds every scan to one church's rows.
   Exempt the console, which authenticates as the church key and reads across churches for networks. Every
   REQ path is a caller, including the post-AUTH replay.

Also still open from the 2026-07-14 network sims and unchanged by this: A3 tag-scan truncation and E1
crafted-REQ DoS, both scale-gated.

## Watch (likely already resolved)
- **Care card hiding / blinking out on the member APK.** Earlier the Today "Practical care" card seemed to
  hide under visibility = "whole church" and vanish/reappear on reload. Both trace to the same root —
  the card was empty until the relay round-tripped (plus general relay lag, same as the team-removal lag).
  The **0.9.9 (97)** cache hydration paints the card from a per-church `lsGet` cache instantly, which should
  fix both. ONLY if it recurs (card empty while needs genuinely exist): re-add the `[CareCard-DEBUG]`
  console.log in `screens-today.jsx` CareCard (just before `if (!live.length) return null`) + set
  `debuggable true` on the release buildType, install, plug phone into the dev box (USB debugging ON +
  "Allow USB debugging?" approved — an MTP-only USB descriptor means it's NOT authorised), then
  `adb logcat | grep CareCard-DEBUG` to read vis / needs / live / onTeam.

## Steward console
- ✅ DONE (2026-06-27): **Filter Groups / Teams / Rooms** — type-filter chips on the list (appear once there's
  more than one type), reorder disabled while filtering.
- ✅ DONE (2026-06-27): **Roster: block duplicate people** — dedupe a linked member by pubkey + an unlinked one
  by name, and hide already-added members from the link dropdown.

## Meal trains
- ✅ DONE (2026-06-27): **care-team membership now flows through the roster** (root of the visibility saga).
  The meals "Members" button opens the same `RosterModal` the Rota page uses (`publishRoster` → roster.people),
  so the steward UI, the relay (`careAdmin`/`ROSTER_PEOPLE`) and the member CareCard (`onCareRoster`) all read
  ONE source. "Only the care team" visibility works now. Settings warn when no team is selected OR the selected
  team's roster is empty.
- **Follow-up (low priority): care-team chat membership.** RosterModal writes roster.people, not the team's
  group.members, so care-team members aren't auto-added to the team's CHAT group. Fine for needs (roster-driven);
  if the care team should also chat together, sync group.members ← roster.people when editing a care team.

## Relay
- ✅ DONE on branch `claude/relay-sqlite` (2026-06-27) — **pending your review + deploy**: **DB migration →
  node:sqlite.** Events now in SQLite (indexed reads, durable, per-church `church` column), auto-migration
  from relay-db.json, no native dependency. Needs Node 22+. Tested (correctness vs old, boot, WS round-trip).
- **Per-church ephemeral fairness.** The retention cull is still GLOBAL (oldest ephemeral across all churches),
  so on a shared relay a chatty church can age out a quiet one's older chat. The new `church` column makes a
  per-church cull straightforward — give each church its own ephemeral budget. Follow-up on the SQLite base.
- **Tag-index table for extreme single-pool scale.** Arbitrary `#tags` (e.g. `#p` DMs, `#e`) are matched in JS
  on the SQL-narrowed result — correct + cheap while queries narrow by kind/author/church (they do today). A
  `tags(event_id, tag, value)` index would make tag-only queries scale on one giant shared pool. Not needed
  until a single relay serves very many churches. NOTE: the relay is GATED (accept() only takes registered
  churches' content — not an open public Nostr relay), so this is about scale, never spam.

## Sharing
- ✅ DONE (2026-06-27): **multi-verse select.** Reader selection is now a set; the verse action sheet has a
  − / + passage stepper (the modal backdrop blocks tapping more verses) that extends a contiguous selection.
  Copy/Share compose the verses into one passage with a compact range ref ("John 3:16-18,20"). Per-verse
  actions (note/bookmark/highlight) hide once more than one is selected.

## Shipped this session (for the record)
- Off-grid APK + Bible share; full care/meals flow (additive day picker, dietary, both-level meal types
  B/L/D + per-day override, steward skip, "what I'm bringing" note); relay care-read fix (members see each
  other's help + notes); release signing (stable key); auto-update banner one-shot fix; approval-toast loop
  fix; smart relay eviction; care-card cache hydration. (through 0.9.9 / 97)

## RESOLVED 2026-07-31 — there was no console bug (kept as the record)
- **ANSWERED: yes.** The owner confirmed "Audit test member is admitted" — a correctly-formed join appeared in
  Members and was approved normally. So the console is fine, and the earlier "a join popped up then vanished"
  was entirely my own test artefacts: one join that published a LEAVE a second later, and two that omitted the
  `['p', cp]` tag the console subscribes on. Do NOT chase the two suspects named below; they were guesses and
  both were wrong.

  Verified on production afterwards, which is the useful part: once ADMITTED, that member's `safe:` and
  `careavail:` writes were ACCEPTED (they had been correctly REFUSED while pending). Together with yesterday's
  refusals, that is the 2026-07-30 accept() scoping work proven in both directions against the live church.
  The test member has since left, so the roster is clean.

- ~~**Does a correctly-formed pending join appear in the console's Members page?**~~ Left mid-test while the
  owner was away. Church `Test Church 01` has `approval: true`, so a new joiner is held as PENDING until
  admitted. A member doc was published to a8 from a throwaway key with the SAME shape the real app uses
  (`src/fellowship.src.js:1798` — `[['d','trinityone/member:'+cp], ['t',NET], ['p',cp]]`) plus a kind-0 so
  it renders with a name: **"Audit test member"**,
  `npub1g4sr2fa5wyegky6v0ar7yt597shhe6sugsdd93a8runuqapy6fnqf82fqy`.

  **If it shows up:** there is no bug. The earlier "a join popped up then vanished" was two test artefacts
  of mine — one join that published a LEAVE a second later (a deliberate retraction test), and two joins
  that OMITTED the `['p', cp]` tag. The console subscribes with `{kinds:[30078], '#p':[pub]}`
  (`src/steward.src.js:2751`), so those were invisible to it while the relay still stored them and the push
  still fired — which is exactly why it looked like a console fault.

  **If it does NOT show up:** it is real, and this is the correctly-formed case to debug with. Two unverified
  suspects, both only guesses: `subscribeMembers` paints from the `trinityone.steward.members.<pub>`
  localStorage cache and then OVERWRITES that cache with whatever the live subscription emits; and the
  Members page only builds `pendingJoins` when `joinApproval && mRosterLoaded` are both true
  (`app/stew-dashboard.jsx:3348`).

  Already ruled out by measurement: the relay serves a pending member's join doc to the church key
  (reproduced locally with `approval:true`), and a8 retained the join across a reconnect.

  Cleanup: the key for "Audit test member" is kept, so it can be retracted properly. An earlier throwaway
  (`30c9c850…fd9a`) is malformed and therefore invisible to the console — it needs no action.

## P6 — measured and WITHDRAWN (2026-07-31)
- **The console's ~10 "byte-identical" subscriptions are not on the wire.** The audit priced them at 2,500ms
  and 3,428 KB. Measured in a real browser against a real relay, ten screens each calling a different
  `subscribe*` that uses the union: **main opened 2 REQs, the deduplicated branch opened 2 REQs.** Identical.
  All ten were verified to actually subscribe. nostr-tools' SimplePool already merges identical filter sets.

  The 17 duplicated call sites in `src/steward.src.js` are real, and `app/steward-root.jsx:68` still names
  porting `_docsHub` as the deeper fix — but the COST attributed to them was not reproducible, so there is
  nothing to buy back. Do not re-open this on the strength of the source duplication alone; measure first.

  A working, sabotage-verified implementation sits unmerged on `perf/console-shared-docs` (ten tests, aimed at
  the dangerous half: a screen that mounts late must still receive everything). Ready if the console ever
  moves off SimplePool.

- **Two things worth keeping from that branch if it is ever revived:**
  - `_resetSharedSubs()` must be wired into `setKey()` and `removeKey()`. The registry is keyed by filter and
    every filter names the church pubkey, so a church switch otherwise hands the next screen a dead stream —
    the member app's "Retry button does nothing" bug (AUDIT 2026-07-25).
  - A REQ count taken from a console that never mounts its screens measures nothing: those subscriptions open
    when their screens do. My first measurement did exactly that and showed no difference for the wrong reason.

## Relay-name directory accumulates permanent tombstones (found 2026-09-02)

`GET /relay-names/sync?since=0` on both canonical relays returns two records, and **both advertise
dead addresses**:

| handle | key | address | state |
|---|---|---|---|
| `steady-harbor-18` | `16731f4c…` | `penn-angle-demonstrate-laws.trycloudflare.com` | **this dev box**; tunnel NXDOMAIN; still advertises `churches:3` |
| `quitedoverelay` | `b90496e2…` | `task-blend-consistency-accomplish.trycloudflare.com` | unknown key, NXDOMAIN, claimed `churches:1` on 2026-08-23 |

Neither is the a8 (`6a4267558c…`, confirmed at both canonical URLs). **Both are the two relays the
owner had taken down earlier on 2026-09-02** — the dead addresses are the evidence that shutdown
worked, not a mystery. `quitedoverelay` carries a different key from this dev box because it was a
separate relay process, most likely a subagent's temporary one. **No live church is affected and there
is nothing to chase.**

**The actual defect, which outlives those two relays:** a claim can only be withdrawn by the key that
made it, and there is no operator removal path. Our own entry is withdrawable (the dev box still holds `16731f4c…`); **`quitedoverelay`
is permanent** because its key is gone. Anyone resolving that name gets a dead address for ever, and
the directory will accumulate one of these per abandoned test relay.

Wanted: an operator removal path, and/or expiry of a claim whose address has not answered for N days.
Note the interaction with the T1-only plan — a name that resolves to a dead address now fails at the
identity challenge rather than silently, which is better, but the tombstone remains.

## Relay UI wants the same pass the console settings page got (2026-09-02)

Owner, after the console settings rework: *"We should probably apply the same/similar changes to the relay
ui that we applied to the steward console settings page."* Not urgent.

The console settings work made cards more compact, fixed awkward stacking, and improved accessibility
(reachable names on controls, tappable rows, authored stacks rather than ad-hoc spacing) — see the
`settings-cards-sit-in-authored-stacks` / `settings-rows-tap-the-words` / `controls-have-accessible-names`
tests for what was actually asserted. `app/stew-relay.jsx` never had that pass.

Worth doing alongside whatever relay-UI work the declaration change eventually needs: the relay now has an
operator-facing state it did not have before — *which addresses do I declare, and am I loopback-only?* — and
that has no UI at all today. It is only visible in the startup log and an admin-gated route. An operator who
has not read the release notes has no way to see it.

## Relay payload: stop shipping reference/, and version by content (after round 7)

Owner 2026-09-02, after a documentation-only commit prompted every relay to offer an update.

**1. `reference/` ships to relays and must not.** `build-relay-payload.sh:30` strips `android ios .github
docs modules marketing` — not `reference`. So **9.9 MB across 46 markdown files** of internal planning sits
on every church's relay: audit findings, threat-model reasoning, and a list of where the gaps are. Under the
recorded threat model (lawful compulsion and seizure) a seized relay currently hands over a map of the
system's weaknesses. This is a disclosure item, not just dead weight. One line.

**2. Version by payload content, not by commit.** `build-relay-payload.sh:56` stamps `version.txt` with
`git rev-parse HEAD`, so ANY commit — a typo in a document — makes every relay report an update available.
The version answers "did the repo move", when the question is "did the code change". Hash the payload
instead; a doc-only commit then produces a byte-identical payload and no prompt, and the answer becomes true
rather than approximately true.

**3. Release on tags, going forward.** Owner: *"Release on tags sounds like a good process going forward as
well."* A deliberate release moment rather than every main commit, which also fits the
backwards-compatibility discipline the pilot needs (`backwards-compatibility-from-pilot`: add, never
repurpose, and the relay rehydrates ALL history on every update).

Sequenced after round 7 so the round tests what is currently deployed.

---

## ~~UI polish — the first-launch "Welcome to TrinityOne" buttons are unevenly spaced~~ DONE

Owner, 2026-09-04: *"the buttons are unevenly spaced, and that could look a bit tidier."*

Confirmed, and it is one property. `app/identity.jsx` ~:454–470, the three choice buttons:

| button | `marginBottom` |
|---|---|
| "I'm new here" | 10 |
| "I've used it before" | **absent** |
| "Someone set this up for me" | 10 |

So the gap between the second and third is 0 while the first and second have 10px, and the last one carries
a bottom margin against the panel edge that the layout does not need. It reads as two buttons stuck together
under one that is spaced properly.

**How it got there:** the third button was added later — AUDIT-2026-07-28, "Someone set this up for me",
raised because a child whose parent made their account has never used TrinityOne and would otherwise pick
"I'm new here" and orphan the real account. It was inserted with the same style as the first, and the second
button's missing margin was never noticed because it had been the last one.

**Worth doing properly rather than adding one number:** give the group a single `gap` on the container
instead of per-button margins, so the next button someone inserts cannot reintroduce this. The three buttons
carry an otherwise identical inline style; a shared constant would also stop them drifting apart.

Not urgent, and deliberately not done during the audit-fix branch: this is the first screen every new member
sees, and it wants a look on a real phone at a couple of widths rather than a blind edit.

**Done 2026-09-04.** The three buttons now share one style object and one `gap` on their container, and carry
no margins of their own — so a fourth button inserted beside them inherits the spacing instead of choosing
it. `scripts/the-welcome-choices-are-evenly-spaced.test.mjs` renders the real screen and fails if any choice
spaces itself again, if they stop sharing a style, or if one of them is quietly promoted to look like the
primary action (they are deliberately equal weight). Measured 1/3 against the old spacing.

