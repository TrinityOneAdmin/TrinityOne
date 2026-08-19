# Simulation feature checklist — what exists, and which settings change it

Written 2026-08-19. Derived from the console and member screens in `app/`, the engines in `src/`, and the
document registry in `scripts/trinity-doc-types.mjs` — not from memory.

Two things this is for:

1. **Coverage.** Rounds keep missing whole features because nobody had a list. Tick what a round exercised.
2. **Configuration.** Most defects this project has found live in a SETTING, not a screen — care opened to
   members vs stewards, a rota narrowed to teams, a church with approval off. The same screen behaves
   differently and only one variant ever gets tested. Section A exists so a round picks a configuration on
   purpose rather than inheriting whatever the last steward happened to click.

A feature is only ticked when it was verified against `relay/relay.sqlite`, not when a screen said it worked.

---

## A. CHURCH CONFIGURATIONS — run different rounds on different ones

Each row is a church a steward could plausibly set up. Never run two rounds on the same configuration
without a reason.

| # | Configuration | Set where | What it changes for members |
|---|---|---|---|
| A1 | **Care ON, members may ask** (`openedBy: member`) | Care settings | Anyone can raise a request; care team actions it |
| A2 | **Care ON, stewards only raise needs** (`openedBy: steward`) | Care settings | Members can only volunteer, never ask — the quieter church |
| A3 | **Care ON, needs visible to the CARE TEAM only** (`visibility: team`) | Care settings | Congregation never sees needs; only the team does |
| A4 | **Care ON, needs visible to the WHOLE CHURCH** (`visibility: all`) | Care settings | Everyone sees who needs help — best turnout, least privacy |
| A5 | **Care OFF** (default) | Care settings | No Care tab at all. Three agents once hunted for a feature that was off |
| A6 | **Care team roster with UNLINKED people** | Rota → Care team roster | Names with no account: the team is an audience of nobody |
| A7 | **Join requires steward approval** | Members / join policy | New members wait; the whole pending-state experience |
| A8 | **Join open to anyone with the link** | Members / join policy | No waiting state; anyone with the code is in |
| A9 | **Rota visible to EVERYONE** (default) | Rota → "Who sees it" | Any member sees the whole church's rota |
| A10 | **Rota visible to SERVING TEAMS only** | Rota → "Who sees it" | Members not on a team lose the Rota tab entirely |
| A11 | **Groups: invite-only** | Groups → visibility | Group hidden from non-members of that group |
| A12 | **Groups: child-safe marked / not marked** | Groups | Whether minors may enter the room |
| A13 | **Groups: broadcast (announcement) vs open chat** | Groups | Who may post |
| A14 | **Encrypt all comms ON / OFF** | Settings → Congregation features | Whether rooms are sealed; changes the room badge members read |
| A15 | **Member photos ON / OFF, child photos ON / OFF** | Settings → Congregation features | Avatars, and the safeguarding question underneath them |
| A16 | **Kids check-in ON / OFF** | Settings → Congregation features | Check-in flow exists or not |
| A17 | **Full-name rule ON / OFF** | Settings → Rules & privacy | Whether "Continue without a name" is acceptable |
| A18 | **Delegated stewards present / owner only** | Settings → Delegated stewards | The whole second-steward path, and every replay-order bug it exposed |
| A19 | **Relay: own relay only / also the shared relays** | Settings → Relays | Whether church data leaves the box; per-relay enforcement |
| A20 | **Giving ON** (pilot-locked — expect it refused) | Settings → Giving | Confirm it is genuinely locked, not half-enabled |

---

## B. STEWARD CONSOLE — every tool

### Setting up
- [ ] Create a church from the website (front door, not a deep link)
- [ ] Recovery phrase shown, the 3-word check, and refusing to continue without it
- [ ] Console PIN set; lock and unlock; wrong PIN refused
- [ ] Church name, branding, banner, accent, church web address
- [ ] Restore a church from 12 words onto a second device
- [ ] "My church is on another device" handoff / QR
- [ ] Back up the church — **and confirm a file actually lands on disk** (this once reported success while writing nothing)

### People
- [ ] Joining code and invite QR; printed invite card
- [ ] Approve a waiting member; confirm an `admitted:` document appears
- [ ] Mark a member as a child; link a guardian; clear an adult to work with youth
- [ ] Publish clearances (`clearance:` per member) — the child's own phone depends on these
- [ ] Block a member; confirm they lose access
- [ ] Reconnect (re-seat) a member who lost their words, and check safeguarding follows them
- [ ] Delegated steward: invite, approve, act as, revoke — then **restart the relay** and check it all survives
- [ ] Requests to steward queue

### Groups, chat, calendar
- [ ] Create groups, categories, cell/life groups; reorder; rename; delete
- [ ] Group leaders; invite-only membership; child-safe flag; broadcast vs open
- [ ] Announcements / new post to the whole church
- [ ] Chat message tags (steward-defined, e.g. "Prayer request")
- [ ] Moderate: hide a message, pin a message
- [ ] Schedule an event for a group; event policy; RSVPs
- [ ] Calendar: services, one-off events, recurring meetings
- [ ] Rooms and bookings

### Serving
- [ ] Teams with roles; roster with **linked** people (a name with no account is inert)
- [ ] Services; publish a rota; copy last week; auto-fill; create-and-fill ahead
- [ ] Send "can you serve?" requests; see accepts, declines and swap asks
- [ ] Run sheet / order of service
- [ ] Who sees the rota (A9/A10)

### Care
- [ ] Turn the module on; choose who may open needs; choose visibility; pick the care team
- [ ] Receive a member's request and convert it into a need **with days on it**
- [ ] Watch sign-ups arrive; see who is covering which day
- [ ] Recipient-only "not needed that day" skip
- [ ] Close a need
- [ ] Safety check ("mark as safe" roll-call): start, respond, close

### Finance
- [ ] Record money in and money out; categories; funds
- [ ] Refuse malformed amounts (`-500`, `500-600`) — verified 2026-08-19
- [ ] Create a bookkeeping fund (distinct from a giving fund)
- [ ] **Import a bank statement** (CSV): column mapping, split money in/out, duplicates against prior imports, duplicates against MANUAL entries, a comma inside a quoted description
- [ ] Reports: quarterly / yearly share statement, aggregate-only
- [ ] Export CSV
- [ ] Reverse an entry

### Relay & infrastructure
- [ ] Relays list; add and remove; connect by name; go public
- [ ] Relay & Suite controls; relay panel
- [ ] Manna, resources, plan library, devotionals, sermons (self-hosted)
- [ ] Custody / church key handling; extension and phone tools

---

## C. MEMBER APP — every surface

### Getting in
- [ ] Arrive from the marketing site and find the way in (round 2: the CTA led nowhere)
- [ ] "I'm new here" / "I've used it before" / "Someone set this up for me"
- [ ] Display name — including "Continue without a name" and what that costs later
- [ ] 12-word backup and the quick check; "I'll do this later"
- [ ] PIN: set, skip, lock, unlock, forgotten
- [ ] Join by code, by link, by QR
- [ ] The **waiting for approval** state, and admission arriving live without a reopen
- [ ] Restore on a NEW device: identity, church, display name all return

### Daily use
- [ ] Today: verse, reading plan, streak, notices
- [ ] Bible: read, search, highlight, bookmark, note, journal (all work with no church)
- [ ] Library, devotionals, audio, sermons
- [ ] Text size, dark mode, listen-to-page
- [ ] Community: groups, chat, DMs
- [ ] Chat features: reply (swipe), react, edit, delete, pin, tag, events in a group, RSVP
- [ ] People directory; search; privacy of your own name and photo
- [ ] Notifications and their settings

### Serving
- [ ] See your next slot and who is with you
- [ ] The church-wide Rota tab (subject to A9/A10)
- [ ] Accept / decline a request; ask to swap; "I'm away" with multiple dates that must all survive
- [ ] Run sheet

### Care
- [ ] Ask for help (A1) — multiple kinds at once, and the details field
- [ ] See that the request was received, and who is coming, and when
- [ ] Volunteer for a day; **undo**; re-sign; two days then remove one
- [ ] Care team: read the request, see what is hidden and what is not
- [ ] Safety check response

### Safeguarding, as experienced
- [ ] A minor: what is restricted, and whether the app ever explains it
- [ ] A guardian: whether the link is visible anywhere, and whether they can reach their child
- [ ] An uncleared adult: refused, and told
- [ ] A cleared adult: permitted

---

## D. Cross-cutting checks to run in EVERY round

- [ ] Every "saved / sent / published" claim verified from a second screen or the relay
- [ ] Nothing served to a member who has not been admitted (verified 2026-08-19: only `joinpolicy`)
- [ ] The app is usable with no church at all
- [ ] A relay restart changes nothing a church configured
- [ ] Same church viewed on two devices agrees
- [ ] Nothing reaches the canonical relays that the church did not intend
