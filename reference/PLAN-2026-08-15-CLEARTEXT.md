# Plan — what a compelled relay can read, and what to do about it

Written 2026-08-15, after the protocol audit and a direct read of `relay/relay.sqlite`.
Nothing here is implemented yet. This is the argument and the sequence, for approval.

## What we actually found

Measured against the seeded church's real stored events — not reasoned from the source:

```
219  member       {"joined":1758894665}
133  name         {"c":"Ak26Npswx…"}                        ← sealed
 22  group        {"name":"Whole Church","visibility":"open"}
 13  event        {"date":"2026-07-24","time":"10:30","title":"Sunday Service","where":"…"}
  7  service      {"date":"2026-07-26","time":"10:30","name":"Sunday Service"}
  7  rota         {"service":"svc-2026-08-02","assign":{"Welcome":["abd…"]}}
  7  roster       {"roles":[{"name":"Lead"},{"name":"Toddlers"}…]}
  6  care         {"type":"meals","dates":["2026-08-18"]}
  5  sermon       {"title":"Behold, He Is Coming"…}
  3  room         {"name":"Main Hall"…}
```

Plus, confirmed from source (absent from the seed church, present in any real one):
`minors` (a list of the church's children), `approved` (adults cleared to contact youth),
`guardians` (a parent↔child map), `admitted`, `stewards`, `reseat` (old pubkey → new pubkey).

**The most dangerous document is `event`, not the safeguarding lists.** Date, time, title and
*where*. `service`, `room` and `booking` repeat it; `rota` then names who is serving at which
gathering, which is an attendance record. For a congregation where meeting is the risk, this is the
operational intelligence that gets people arrested. Member names are sealed; the meetings they
attend are not.

This was missed by every previous audit — including one that specifically looked at safeguarding
data — because the question asked was "is the safeguarding mechanism sound", not "what is legible
in the database".

## The decision that shapes everything else

For every document type, does the RELAY read its content, or only route on its tag and author?
Measured:

| Relay reads the content | Relay only routes on tag/author |
|---|---|
| minors, approved, guardians | **event, service, room, booking, rota** |
| admitted, stewards, group, sermon | plan, devotional |

The right-hand column can be encrypted **at no cost to relay policy**, because the relay never
looks inside. And it is almost exactly the list of things that expose when and where a church
meets. The highest-value fix is the cheapest one.

The left-hand column is a genuinely harder conversation and is **out of scope for this plan** —
see "Deliberately not doing" below.

## Phase 1 — encrypt time and place (the whole of this plan)

**Scope:** `event`, `service`, `room`, `booking`, `rota`. Not `plan`/`devotional` — devotional
content is low-sensitivity and mostly public-domain scripture; encrypting it spends the same
migration risk for far less.

**Which key.** Reuse the existing **name key** ring rather than minting a fourth per-church key.

The case for reuse is strong and mostly hard-won: the name key is already distributed to every
member via per-recipient envelopes, already rotated on block, already fitted to the 1 MB envelope
ceiling, already persisted as a sealed envelope in the docs-hub buffer so it survives an offline
cold start, and — after this week — already has the failure modes fixed (silent seal skips, the
re-entrancy race, the fire-and-forget distribution). A new key ring means a fourth copy of every
one of those failure modes, and this week proved they are hard to get right.

The cost of reuse, stated plainly: anything that compromises the name key also exposes meeting
times. That is a smaller loss than it sounds, because both are held by exactly the same set of
people — every member — so they were always going to fall together.

**The migration order is the risky part, and it is not negotiable.** This repo has already shipped
one silent field break of exactly this shape (writing only the new key-envelope form, so
un-updated phones opened encrypted groups to an empty room). Consoles update first and phones
follow over days.

1. **Read support ships first.** Clients learn to open an encrypted `event`/`service`/etc. and
   continue to read cleartext ones. Nothing is written encrypted yet. This is a no-op release.
2. **Wait for adoption.** Long enough that the in-app update check has plausibly reached the pilot
   churches. Now that the release pipeline actually ships APKs, that number means something.
3. **Consoles start writing encrypted.** Old clients now fail — so read support must genuinely be
   out there first, which is why step 2 is a wait and not a formality.
4. **A one-off re-write** of existing cleartext documents by the console, so history is covered
   rather than just new events.

**The failure mode to design for, from the start.** A member without the key must not see an empty
calendar. That is the silent-blank class this project treats as its worst failure — an empty
calendar looks exactly like a church with nothing on. It must say "waiting for your church key",
the same way an encrypted room now says "Encrypted · no key yet" rather than looking quiet.

**The test that makes it real.** Not a source grep. Query `relay/relay.sqlite` directly and assert
that no `event`/`service`/`room`/`booking`/`rota` document contains a readable date, time or
address. That is the invariant a compelled relay defeats or does not, and it is checkable against
the actual store — the same technique that proved the encrypted-room work on the phone.

**Rollback.** Read support is additive and safe. The write switch (step 3) is the irreversible
one: documents written encrypted cannot be read by older clients, ever. It should be a
per-church flag, defaulting off, so one church can be moved and watched before the rest.

## Deliberately not doing (and why)

- **The safeguarding lists** (`minors`, `approved`, `guardians`). These are the documents the relay
  parses to enforce safeguarding server-side, which is a real strength — a modified client cannot
  bypass the rules. Encrypting them moves enforcement to clients only. That is a design decision
  about where authority lives, not a patch, and it deserves its own plan. **The exposure should be
  written down honestly in the meantime**: handing over the relay hands over a list of the church's
  children and their parents.
- **`member`.** The relay gates reads on membership; encrypting it breaks the gate. Inherent to the
  current design, already recorded in AUDIT-BACKLOG.md, and properly fixed by NIP-17 rather than by
  encrypting this document.
- **`group` names, `sermon` titles.** Real but lower value, and the relay reads both. Revisit after
  Phase 1 lands.
- **Encrypting everything.** Considered and rejected earlier this week on its merits: the envelope
  ceiling multiplies per room, the ring trim would destroy church history at scale, and a new
  member starts blind. Phase 1 avoids all three because these documents are per-church, not
  per-room, and already sit behind a key every member holds.

## What this does not fix

A compelled relay still learns the roster, the join dates, and the DM social graph — who attends
and who talks to whom. That is the top finding and it is untouched by this plan. Encrypting the
calendar removes *when and where*, which is the part that is cheap to remove today. It should not
be described, internally or in marketing, as more than that.
