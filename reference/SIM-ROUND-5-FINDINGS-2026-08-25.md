# Simulated-congregation findings — round 5, 2026-08-25

**Tracked copy.** The working notes live in `reference/sim/`, which is gitignored because it also holds
CREDENTIALS.md — the PINs and twelve-word recovery phrases for every simulated person. Those stay off the
repository permanently. THIS file is the findings only, and exists because 715 lines of a day's work sat in an
untracked file on one machine, which is one disk failure away from gone.

**How to read it.** Items are numbered S5-n in the order they were found, and several were later WITHDRAWN or
corrected — the corrections are as much the point as the findings. Two things shaped this round:

  · Sixteen agents drove sixteen phones as members of one church. They were briefed to report only "I tried X,
    it didn't work" — no diagnosis — and every claim was verified against the live app before being recorded.
  · The rig lied twice. `tap` reported success while hitting a covered element, and the steward console ran at
    780×437 on an 800×600 virtual display. Between them they manufactured two findings that were later
    withdrawn, and the withdrawals are recorded here in full rather than quietly deleted.

**Anything not marked CONFIRMED has not been verified by a human.** The owner's own hand-testing on freshly
wiped relays is still outstanding and is the point at which this list becomes trustworthy.

---

# ROUND 5 — findings

## Revd Esther Mbeki, founding St Chad's from the website (sha b85622a)

A clean church nobody had touched. Signal-to-noise is far better than round 4 — almost nothing here is
test-data noise, because there was none.

### VERIFIED ALREADY

| # | Finding | Verdict |
|---|---|---|
| E5-1 | **Her notice posted as one run-on paragraph.** The composer sends the text intact (`text.trim()` touches only the ends) — it is the CONSOLE'S OWN message view that collapses it. **This is my miss.** I confirmed exactly this last round, did not fix it, and did not say so: it was not among the three I chose. Both console renderers still lack the rule. Every notice this round will look wrong. | REAL — mine |
| E5-2 | **"2 of 3 relays Offline, including app.trinityone.church."** That is the SAFETY GUARD working: the sim launcher deliberately maps the production hostnames to a dead address so a simulation can never reach a real church. Not a defect — and worth stating loudly so nobody chases it. | REFUTED |
| E5-3 | **But her real point stands:** the QR poster prints whatever relay the church is actually on. Here that is an ephemeral tunnel address, and the app itself warns those can change. A church that self-hosts through a quick tunnel would pin a poster on the porch that later goes dead. Pilot risk, needs a decision, not a patch. | REAL — decide |

### TO VERIFY — her words, not yet checked

| E5-4 | "Continue" pressed FOUR times on the very first screen, name plainly typed, nothing happened. First impression of the whole product. |
| E5-5 | **"Child-safe?" has no explanation at all** — she tapped it to find out what it meant and it simply switched on. "In the Church of England 'child-safe' is not a casual phrase; I need to know exactly what I'm claiming." The neighbouring "Encrypt?" explains itself properly. |
| E5-6 | Changing any setting on a group throws it to the BOTTOM of the order members see. Sealing Life Group and marking Whole Church child-safe both did it. Her all-church channel is now last. |
| E5-7 | After setup finished, the dashboard still said "Your Church" and "No groups yet" — she thought the evening's work was lost. Correct after switching tabs. The silent-blank-screen class. |
| E5-8 | The backup said "Saved 15 records" and never said WHERE. No filename, no folder. For something billed as "you always hold your own copy", she has nothing to carry to the safe. |
| E5-9 | Rota did not know about the services she had already entered during setup; she typed the Parish Eucharist a second time. The Calendar shows services on the right Sundays AND says "No upcoming services" underneath. |
| E5-10 | US date format throughout (`8/25/2026`, `mm/dd/yyyy`) for a UK parish. Default service name "Sunday Gathering" — not a phrase used in any Anglican parish. |
| E5-11 | Two toggles ignore their label (Kids check-in, real-name requirement) — the switch-row work missed these two. |
| E5-12 | "Your steward code" on Security appears to be the identical npub to the church's. |
| E5-13 | The new-post box is three lines tall; she could not see her own notice while writing it. |

### WHAT SHE PRAISED — worth protecting

- **The recovery ceremony.** "If these words are lost, the church is gone — not locked, gone", and then the
  line that made her act: *"Most churches don't lose this to theft. They lose it because the laptop died, or
  the person who set it up moved on."* It then HID the words and made her type three back from paper,
  choosing different ones each time so she could not cheat. She called it best-in-class. Do not water it down.
- Switching care on **offered to tell the congregation**, with a draft written, explaining that otherwise
  "the people who most need it are the least likely to find it."
- Making a Care team warned her plainly that nobody was on it yet, so "ask for help" would reach no one —
  the consequence, not just the fact.
- Delegated stewards: a churchwarden with powers but not the church key.

### HER OWN ACCESSIBILITY NOTE, which is a real finding

"The three recovery-check boxes, and several others, have no placeholder or label text at all... A person
with a mouse would click them without a thought — but a screen reader would find them just as blank as I did."


## THE SUITE'S THREE DOORS — investigated and fixed, 2026-08-25

The owner asked why the Suite offers three choices at launch when a steward has two jobs, and separately
had noticed that two of those choices land you in DIFFERENT CHURCHES. They were one problem.

WHAT THE THREE WERE: "Full suite" and "Console only" opened the SAME console screen. The only difference was
where the church's records were kept — this computer, or the shared community relays. So the third door was
never a third job; it was "where does my church live" dressed up as a launch mode.

THE MECHANISM, verified in code: choosing "console only" wrote a sticky marker to local storage that
survived for ever, and from then on the console read and wrote to the community pool INSTEAD OF this box.
Nothing on screen ever said which. Consequences a church would feel:
  · same key, two churches — a name and a congregation in one store, blank or stale in the other
  · invitations differed by door, so a congregation recruited under both became two halves that could
    not see each other
  · the "setup finished" marker is SHARED, so the second door never offered to set anything up — it showed
    a normal-looking console over an empty church. That is the "it has lost my church" moment.

FIXED: two doors, named after the jobs — "Run your church" and "Mind the server". The sticky marker is gone
from the source AND the shipped bundle. Where the records live is no longer asked; it is worked out, and the
console says so permanently in its sidebar so a divergence can never be silent again.

TWO THINGS THE BUILD ITSELF TAUGHT, both caught by looking rather than reasoning:
  · My first detection asked only on 127.0.0.1, so a self-hosted church reached through a TUNNEL — which is
    most of them — was told it lived on the community relays. Flatly untrue.
  · The token-gated /config check returns 401 through a tunnel, so it can never answer there. The plainest
    signal turned out to be the right one: THIS CONSOLE WAS SERVED BY THAT RELAY. If you are reading the
    console at any address other than the community pool, the relay at that address is your church's — that
    is why it is serving you. /config is now a refinement for the one case the origin cannot tell you.

STILL OPEN, found during the investigation: the development launcher prints `localhost` links while the app
itself uses `127.0.0.1`. A browser opened on the wrong one is a THIRD separate store with its own church
key. Not fixed here; it affects developers rather than churches, but it is the same family.

---

## S5-1 — the server panel says the relay is DOWN while showing its live traffic, and tells the steward to restart
**VERIFIED IN CODE AND ON SCREEN. Round 5, the first time a sim has ever opened the Suite's server door.**

What a churchwarden sees at the top of "Mind the server":

    ● Relay not reachable
      Is the relay running? Restart the app.

Directly beneath it, on the same screen: the tunnel marked **"✓ Reachable from anywhere"**, an activity chart
reading **38 events**, St Chad's named as its busiest church, a live public address and a working Copy button.
The page is contradicted by its own contents. Churches / Members / Events stored / Connected now all sit at **—**.

WHY IT HAPPENS — not a network failure at all. `poll()` in `relay-app/control.js:36` fetches `/status`, which
returns **200 with a perfectly good body**; the panel's own browser was made to fetch it and got
`{"ok":true,"port":8000,...}`. The next line reads `s.counts.churches`, and `counts` is not there, so it
throws `Cannot read properties of undefined (reading 'churches')` — proven by running that exact expression in
the live panel. The throw lands in a `catch` written years earlier for a dead socket, so a **missing field is
reported as a dead relay**.

The field went missing for a GOOD reason, and the relay says so at `scripts/gateway.mjs:2649`: a red-team pass on
2026-08-18 moved per-church counts behind the admin token, because an unauthenticated `/status` was handing a
stranger "this named church is real, active, and has ~29 people" — the exact aggregate the UK pilot's threat
model exists to deny. That hardening was right. It just left this panel reading a field it is no longer allowed
to see, and nothing failed loudly enough to notice.

The relay still serves the counts to an authenticated caller — `...(adminOK(req) ? { counts: ... } : {})`. And
`control.js` **already has `authHeaders()`, defined twelve lines below the broken fetch.** The panel simply
never uses it here — and it is **already holding a valid token**: `to_relay_admin_token` was present in the live
panel's storage (the relay hands it out to genuinely-local callers by design). So the panel has every right to
those numbers and every means to ask. It asks unauthenticated and then calls the empty answer a dead relay.

WHY THIS IS WORSE THAN A WRONG LABEL: the message issues an instruction, and the instruction causes the outage
it falsely reports. A steward who restarts the relay takes the **public tunnel down with it**, and a Cloudflare
quick tunnel comes back on a DIFFERENT address — so every QR code, every printed invitation and every poster
the church has put on a noticeboard stops working. A cosmetic bug talks a churchwarden into a real, permanent
break, at the exact moment they have been told something is wrong.

DO NOT FIX DURING THE ROUND. When it is picked up, the shape is: send `authHeaders()` on the `/status` poll,
and split the `catch` so "could not reach the relay" and "reached it but could not read the answer" stop
sharing one alarming sentence. The second is the more important half — this failed silently for a week
because every unexpected shape of answer looks like a dead relay.

---

## S5-2 — a printed QR only survives a relay restart if the steward is sitting AT the church's computer
**VERIFIED BY DIRECT A/B MEASUREMENT on the live relay. Chains with S5-1.**

The relay knows it has an unstable address, and the protection exists: it claims a stable directory name —
this box is **`steady-harbor-18`** — and an invite can carry that name so a member resolves it to the relay's
CURRENT address at the moment they join. The Settings panel advertises this in as many words: *"Members connect
by the name you claim, so it keeps working even if this URL changes."*

That protection is switched off for any steward who is not physically at the machine. `src/steward.src.js:6097`:

    const nm = ownIsLoopback() ? selfRelayName() : '';

Two consoles, same relay, same tunnel, same minute — the only difference is where the steward sits:

| console opened at | invite contains |
|---|---|
| `http://127.0.0.1:8000/steward.html` (at the machine) | `&relay=wss://…trycloudflare.com/relay` **`&relayname=steady-harbor-18`** |
| `https://…trycloudflare.com/steward.html` (from anywhere else) | `&relay=wss://…trycloudflare.com/relay` — **no name at all** |

The cache behind it (`trinityone.steward.self-relay-name`) reads `steady-harbor-18` in the first and `null` in
the second, because `refreshSelfPublicRelay()` returns immediately unless the console is on loopback.

WHY A CHURCH MEETS THIS: the second row is not an exotic case. It is the vicar doing the rota from a laptop in
the vestry, or from home. And the relay panel **hands them that exact address** — its Settings tab prints a
copyable *"CONSOLE  https://…trycloudflare.com/steward.html"*. Following the panel's own advice puts the steward
on the unprotected path. (The Suite's own "Run your church" door is fine: it opens the loopback console, so a
steward at the machine is protected.)

THE CHAIN WITH S5-1, which is why these two belong together:
  1. S5-1 tells the steward, falsely, that the relay is down and to restart the app.
  2. Restarting rotates the Cloudflare quick-tunnel to a brand-new address.
  3. Invites printed from a tunnel-served console carry only the old address, with no name to fall back on.
  4. Every QR on the noticeboard, every slip in a welcome pack, is now dead — and nothing announces it.

So a panel bug that is merely wrong on screen becomes permanently destroyed paper, by a route the steward was
explicitly instructed to take.

DO NOT FIX DURING THE ROUND. The shape when it is picked up: the loopback gate is the wrong question in two
places — `refreshSelfPublicRelay()` and `joinUrl()`. A tunnel-served console CAN learn the name (it is the same
relay answering, and `/relay-names/mine` is token-gated rather than loopback-gated), so the gate wants to be
"is this console served by our own relay" — the same question the two-doors fix already answers with
`whereChurchLives()`. Note the mirror of the trap that fix hit: **loopback-only detection told tunnelled
churches the wrong thing there too.** That is twice now.

---

## S5-3 — the whole congregation is inside the Church Council, five minutes after being let in
**VERIFIED FROM BOTH SIDES. Not a code bug — a labelling trap. Which makes it likelier to reach a real church, not less.**

Esther created six groups when she founded St Chad's, among them **PCC (Church Council)**, and ticked
🔒 Encrypted on it. Four parishioners were admitted to the CHURCH today. All four are now in the COUNCIL.

Margaret Oyelaran, admitted five minutes earlier, opened the room and got a working message box under this
heading: *"PCC (Church Council) · Open to your church · private to your church · End-to-end encrypted."*
Tom Whitfield, who has clicked nothing at all, has the same access. The console agrees: **PCC — 4 members**.

THE APP DOES SAY SO, and that is the whole problem. The create dialog offers two adjacent controls:

  · **Invite-only** — "hidden from the group list, and only the members you choose can post (the relay enforces it)"
  · **🔒 Encrypted** — "messages are sealed end-to-end; not even the relay can read them. **Keyed to everyone in
    the church. New members can read past messages.**"

Invite-only is the control a Church Council needs. Encrypted is the one with the padlock, the strong promise,
and a disclosure tacked onto the end of a reassuring sentence. A vicar reading those two in a hurry picks the
padlock — and publishes the PCC to the congregation. Esther did exactly that, unprompted, on her first day.

WHAT A PCC ACTUALLY DISCUSSES: a stipend, a complaint about a churchwarden, a safeguarding referral, whether
to let someone go. "Private to your church" is a true sentence and a dangerous one, because the reader supplies
the word they expected — private *from* the church.

AND NOTHING WARNS LATER. Once created, the console's row for PCC shows "**Encrypted**" and "**4 members**". It
never says those four arrived automatically, nor that the next person admitted joins too. Compare the Care team
row, which shows "**Invite · 0**" — an invite-only group advertises its membership control; this one shows none.

DO NOT FIX DURING THE ROUND. For the owner to weigh, since it is a judgement call rather than a defect: the
cheap half is wording — put the "keyed to everyone in the church" half FIRST, and give the console row a
standing "everyone in the church" marker beside the member count. The real question is whether a group named
like a committee should default to church-wide at all.

---

## S5-4 — a member's phone says a group has 0 members while the console says 4
**VERIFIED ON TWO MEMBERS INDEPENDENTLY, one of whom had clicked nothing.**

Same church, same minute, three groups the console reports as identically configured (Group · Encrypted · 4 members):

| group | Esther's console | Margaret's phone | Tom's phone |
|---|---|---|---|
| Life Group | 4 members | **· 0 members** | **· 0 members** |
| Prayer | 4 members | **· 0 members** | **· 0 members** |
| PCC (Church Council) | 4 members | · open to your church | · open to your church |

Two things are wrong at once. The counts CONTRADICT the console — and "0 members" is the discouraging
direction to be wrong in: a parishioner opening Community sees the church's prayer group announcing that nobody
is in it. That is the silent-blank shape again — nothing looks broken, so nobody reports it; they just quietly
conclude the church has not really moved in yet.

And three groups the console presents as identical render under TWO different label styles on the same screen,
so whatever decides the label disagrees with whatever the console counts. Tom is the control: he has opened
nothing, so this is not something my clicking caused.

Not yet diagnosed, deliberately — that is fix-time work. The thing to establish first is which list each side is
counting, because this project already has a two-lists-one-team trap (`group:.members` vs `roster:.people`) and
this has its shape.

---

## S5-5 — a member's phone stopped accepting ANY tap, and nothing on screen said so
**VERIFIED AND MEASURED. Not reproduced on demand — see the honest limits at the bottom.**

Margaret's app reached a state where **every tap was swallowed**. The church was on screen, her groups were
listed, Esther's notice was readable — and none of the five tabs along the bottom would move. Today, Read,
Community, Library, You: tapped each in turn, the screen never changed.

WHAT WAS ACTUALLY THERE, read out of the live page:

    <div style="position: fixed; inset: 0px; z-index: 9;"></div>

A transparent layer over the entire viewport — 390 × 844, the whole phone. Sampled at three points (bottom
left, middle of the screen, bottom right): **BLOCKED, BLOCKED, BLOCKED.** Not a broken tab bar. The whole app
had a sheet of glass over it.

It comes from `app/screens-chat.jsx:1568` — the click-catcher behind the composer's "+" popover (prayer / poll
/ new event):

    {actionsOpen ? <div onClick={() => setActionsOpen(false)} style={{ position:'fixed', inset:0, zIndex:9 }} /> : null}

That is the ordinary pattern: an invisible layer that closes the popover when you tap away. Here it outlived
the popover. `actionsOpen` is plain `React.useState` (`useC` is an alias for it, screens-chat.jsx:4), so for
the catcher to still be painting over the group-list screen, **the chat screen must still be mounted** with the
flag set — which is the thing to chase when this is picked up.

WHY THIS IS THE WORST CLASS WE HAVE. There is no error, no spinner, no blank page — the church looks perfectly
normal and simply does not respond. A parishioner does not report "an invisible layer is intercepting my
touches". They put the phone down and say the app is rubbish, or that they never got in. It is
[[silent-blank-app-bugs]] with the added cruelty that everything LOOKS right.

RECOVERY, tested: closing and reopening clears it — the layer is gone after a reload. The cost is the PIN
screen ("Your account is locked on this phone"), which is correct behaviour, and Margaret's own PIN let her
back in. So it is escapable, IF the person thinks to force-close an app that appears to be working. Afterwards
the tabs moved normally again — Community, then Today — so nothing was permanently damaged.

WHAT I CANNOT CLAIM. I did not reproduce it deliberately. Tom, on the same build in the same church, was
unaffected throughout, and repeating Margaret's route on his phone did not trigger it. So the trigger is
unknown, and a fix that guesses at it will not be verifiable. The evidence above is what the page actually
held, not an inference — but the repro is missing and that is the first job when this is picked up.

---

## S5-6 — the vicar's welcome notice arrived as one wall of text
**CONFIRMS a known defect, now with a real church behind it. Fix already written, sitting UNMERGED.**

Esther's first notice to St Chad's, read on Margaret's phone, arrives as a single unbroken paragraph:

    Dear friends, Welcome to St Chad's on TrinityOne. From now on I'll put the notices here, so do join us.
    Sunday: said Communion at 8am, Parish Eucharist at 10am. Wednesday: Home Group at 7.30pm. Two for the
    diary: Harvest Festival - Sunday 4 October, 10am, with lunch in the hall afterwards. Remembrance Sunday -
    Sunday 8 November, 10am, with the act of remembrance at the war memorial. If you need a hand - a meal, a
    lift, an errand, a visit - you can now ask quietly through the app...

She clearly wrote it in blocks: a greeting, the regular pattern of services, two dates for the diary, and a
note about asking for help. All of it ran together. This is exactly the shape a church notice takes — a list of
things on separate lines — and it is the format most likely to be pasted straight from a pew sheet.

This is M4-1, confirmed once before and fixed on `fix/console-notice-shape` (28af43b). **That branch is still
unmerged, so the fix is not in anyone's hands.** Noted here because this is the first time it has been seen
happening to a real notice in a real church rather than to test data — and because the last time a confirmed
line-break defect went unmerged, the next round's vicar hit it as her first complaint.

---
# ROUND 5, SECOND PASS — 16 agents, one church, one afternoon
Every item below was reported by an agent who does not read code and does not know what the others found.
Where a claim is repeated by people who never spoke to each other, that is said explicitly, because independent
repetition is the strongest evidence a sim produces.

## S5-7 — the app swallows messages and says nothing. FIVE INDEPENDENT WITNESSES.
**The most serious finding of the round.**

  · **Naomi Frost** — wrote a prayer request about her seriously ill father, sent it, "the box emptied as if it
    had gone, but the message never appeared in the room. No error, no 'not sent', nothing to tap to retry."
    Tried again. Then sent a plain "Hello everyone". **All three vanished.** Her phone was demonstrably online:
    other rooms received traffic at 12:40 and 12:43 while she was doing it.
  · **Ruth Kowalczyk** — first message to Life Group vanished, box emptied, no error, room still read "No
    messages yet". Retyped it, tapped the send arrow, and that one posted.
  · **Hannah Oduya** — lost two in PCC by pressing ENTER; the send arrow worked immediately. Her words:
    "only the enter key loses messages."
  · **Dennis Achebe** — direct message to Tom: box cleared, nothing ever appeared in the thread. Twice.
  · **Priya Raghunathan** — received a DM from Tom reading "**Second try** — Tom here, can you see this?", which
    is Tom's own evidence that his first one never arrived.

Naomi's closing sentence is the finding: *"the app told me clearly who could read the room and I trusted it —
but it also told me the room had 0 members, and then swallowed three messages, including something I found
hard to write, without ever admitting it had failed."*

DO NOT FIX DURING THE ROUND. Hannah's enter-key isolation is the best lead and the cheapest to test, but it
cannot be the whole story: Dennis lost DMs, and Naomi lost three in a row. Whatever is done, the second half
matters as much as the first — a send that fails must SAY so and leave the words recoverable. Every witness
described the same thing: the box empties, which reads as success.

## S5-8 — the bottom tabs are visible, unreachable, and report success. MEASURED, five witnesses.
While a chat room or the "Serving & events" panel is open, the five bottom tabs still LOOK available and do
nothing when tapped. Measured on two different phones: **all five tabs covered** — Today, Read, Community,
Library, You. On Alan's phone the thing covering them is the broadcast composer bar ("Announcements only —
your church posts here"), sitting at y=772 over a nav at the same height. Nothing is on top in the z-index
sense; ordinary page content simply paints over it.

  · **Alan Pemberton** (71): "the back arrow did nothing, twice, and the bottom menu was hidden. I was stuck
    until I used the phone's own back button." He also notes the same arrow DOES work in chat, "so I couldn't
    predict which one would."
  · **Sarah Bright**: "the Serving & events panel sits over the bottom tabs; taps on Community/People silently
    hit it instead, and its only way out is an unlabelled arrow."
  · **Margaret Oyelaran**: "tapping the bottom bar reports success but nothing moves — I had to back out first."
  · **Hannah Oduya**: got fully stuck after moving through six groups quickly; "only the phone's own back button
    got me out."
  · **Peter Nwosu**: "the Serving panel covered the whole app until I clicked it by screen position."

THE EXIT IS UNLABELLED. Margaret checked properly: the back chevron has "no text, no aria-label, no title", so
it can only be pressed by position. A person with a screen reader cannot leave that screen at all.

This is almost certainly the everyday form of S5-5, the total tap-death I saw earlier and could not reproduce.
S5-5 had an additional invisible full-screen catcher; note Hannah reports the composer "+" opening NOTHING when
tapped, which is the control that catcher belongs to.

## S5-9 — a member is given a message box in a room she is not allowed to post in, then blamed for it
**Margaret Oyelaran, verified against her own working connection.**
Whole Church is a broadcast: members cannot post. The app nonetheless gave her a normal "Message…" box and a
send arrow, ACCEPTED her message, and parked it as **"Waiting to send — No signal, we'll send it as soon as
you're back online"** — where it sat indefinitely. She had signal throughout; her Life Group message sent
instantly at 12:44 and her RSVP saved. Only afterwards did the composer change to "Announcements only" and the
header flip from "Members only" to "Open to your church".

So the app invented a network fault to explain a permission it knew about all along. A member with a phone that
works is told her phone does not.

## CONFIRMED BY THE CROWD — findings from the first pass, independently repeated
  · **S5-3 (everyone is in the Church Council)** — repeated by **Sarah, Priya and Peter**, unprompted, each on
    their first day. Priya read the council's traffic and then POSTED in it: "Apologies if I have landed in the
    wrong room." Sarah read the Harvest lunch list. Peter: "I can read PCC on my first day."
  · **S5-4 (0 members)** — repeated by **Ruth, Hannah, Priya, Naomi**. Naomi's is the sharpest: "'Only members
    can see this room' plus '0 members' left me unsure whether anybody would ever read my dad's news."
  · **S5-1 (relay says it is down while showing live traffic)** — the Suite steward found it unprompted and went
    further than I did, checking /status from outside to prove the server was fine.
  · **S5-2 (the poster address)** — the Suite steward's verdict: "four random words reading
    railway-emails-hood-operator looks like spam to a congregation", plus the page's own warning that the URL
    may change. "I would not print it."

## WORKING, AND WORTH PROTECTING — a round that only lists faults is a lie
  · **Care privacy holds.** Dennis checked the Care tab BEFORE the vicar added him to the care team and could
    see nobody's requests — not Ian's, not Sarah's. That is the invariant behaving exactly as designed.
  · **The waiting experience is genuinely good.** Every joiner said so independently. Alan: "reassuring".
    Naomi: "calm and clear". The locked areas saying "hidden until a steward approves you — NOT NECESSARILY
    EMPTY" was singled out by Sarah and Alan as the thing that stopped them thinking the church was dead.
  · **The privacy copy is trusted.** Sarah, asked directly whether she believed it: "yes — every room states its
    reach, and the vicar's own notice repeats it. That is the best thing in the app for someone in my state."
    Naomi believed the shield too. Honest copy about the relay operator being able to read unencrypted rooms was
    called "honest rather than salesy".
  · **Safeguarding guidance is right.** Ruth tried to add Jacob as a child and was told NOT to, because he is
    setting up his own phone, and to ask a steward to link them instead. She called it "exactly the right advice".
  · **RSVP, profile editing, the directory and the join queue all worked** for everyone who tried them.

## NOT A DEFECT — do not "fix" these
  · **Peter could not find the order of service.** He searched everywhere. This is the DECIDED behaviour: run
    sheets are visible only to those rostered, and no rota was published, so he had no route. See
    runsheets-are-rota-only. Do not treat as a bug.
  · **Harvest and Remembrance missing from the calendar** (Ruth, Priya). Esther announced them in a NOTICE and
    never created events. That is the vicar's doing, not the app's — though it is a fair argument for letting a
    notice create a date.

## NEW, SINGLE-WITNESS — verify before treating as real
  · Peter: RSVPing "Going" to one Sunday service silently RSVP'd him to **every later Sunday too**.
  · Priya + Alan: the Events "Services" list shows ONLY the 10:00 Parish Eucharist across all 14 entries; the
    08:00 Said Communion appears only lower down under "What's on". A churchwarden would misinform people.
  · Ruth: **kids check-in cannot be found anywhere** by a parent — searching "youth", "children" and "check in"
    all return "No matches", though the console has a Check-in tab.
  · Sarah, Priya, Peter: **Esther is not in the People directory**, so the leader who holds Sarah's private care
    request cannot be messaged. Counts also disagree: 11 people, 12, and 14 depending on where you look.
  · Priya: on first load **10 of 14 members had no name**, just "Member · npub1fjv0…"; they filled in minutes
    later. Compare names-blank-subcap.
  · Hannah: a message rendered as ciphertext ("Ao2oGv3mxKrDbm…") marked "Waiting to send" before turning into
    her words.
  · Hannah: the vicar's notice is attributed to "**Member**", not Esther.
  · Sarah: nothing lets a member browse or request a group; there is no group discovery at all.
  · Dennis: his care availability ("I'm available") **reverted** a minute later, and the page said "Nobody else
    has listed themselves as available yet" while he was listed.
  · Alan, Naomi: taps on Community/People while a help page is open report success and do nothing (same family
    as S5-8).
  · The Suite steward: the relay panel's **backup gives no feedback of any kind**. VERIFIED IN CODE — the server
    produces a real 22.7 MB file, but control.js:248-257 has `if (!r.ok) return;` and `catch (err) {}` with no
    message on success or failure. His "no file appeared" is probably my headless harness, but the SILENCE is
    real, and this is the backup that contains the church's keys. It uses the `<a download>` pattern that was
    found inert in the APK WebView — worth checking on the real Tauri Suite.

---
## HARNESS CAVEATS — read these BEFORE acting on anything above
Two of this round's loudest signals are entangled with the tools the agents drove, not only the app. Filing
them as app defects without a clean repro would repeat the mistake that put three of round 4's fourteen
"findings" down to my own test data.

**1. "The enter key loses messages" is NOT yet a verified app defect.**
Four agents said it (Hannah, Tom, Grace, and Ruth in effect), and Grace named the mechanism outright: *"with
the harness `send` (Enter) → the box emptied as if sent but the message never appeared; retyping and clicking
the send button posted it fine."* But `scripts/sim-actor.mjs send` does not type like a person: it sets the
textarea's `.value` directly, fires one synthetic `input`, waits 250ms, then dispatches a real Enter. **And its
success check is "the composer is now empty"** — precisely the false signal every agent reported believing.
I tested it directly on Tom's phone: `send` posted a DM cleanly, timestamped, no "Waiting to send". So it does
not fail on demand. Before this becomes a finding it needs a repro that types character by character and
presses Enter as a human would.
WHAT DOES STAND, on weight of evidence across six people in both groups and DMs: **messages sometimes vanish
with the composer clearing and nothing else happening.** Naomi lost three in a row including a prayer request
for her ill father; Dennis lost two DMs; Tom's own "Second try" DM to Priya proves his first never arrived.
Worth noting for the repro: the losses cluster in the busiest period, with sixteen browsers hammering one
relay. It works now that the load has dropped. That points at load or timing, not the enter key.

**2. `tap` reports success while hitting a dead card title.**
Grace: *"tapping the 'Serving & events' card by its TITLE did not open it, twice; tapping its SUBTITLE opened it
every time. Same for chat rows — tapping the group NAME did nothing, tapping its message preview opened it.
In both cases the harness still reported 'tapped X'."* This is sim-tap-can-click-a-label all over again, and it
may explain several "nothing happened" reports this round, including Sarah's "Ask for help" opening the camera
and Peter's untappable service cards. It is ALSO a real finding in its own right if a card's heading is not
tappable while its subtitle is — a person aims at the title.

---
## S5-10 — the vicar could not staff her care team, so the whole care loop stayed shut
**Esther tried both routes. I reproduced the failure on the console.**
Groups → Care team → "Invite · 0" opens "Who's in Care team" showing its explanation and Cancel / Save members
— **and no list of people to tick.** She tapped where the names should be, twice; the count stayed MEMBERS · 0.
The other route, Rota → Care team → Roster, opened nothing. My own attempt: the modal did not open at all, no
checkboxes present.
CONSEQUENCE, traced across three agents: Dennis was told he was being added, checked repeatedly, and reported
*"the vicar never appeared to add me… I was never able to take on Ian's lift/meals or reach Sarah."* Ian's and
Sarah's requests sat unclaimed. A church would read this as "nobody cared", when in fact the vicar tried twice.
GOOD NEWS, and it matters for the fix: **the care loop itself works.** Grace was on the team and took a meal
day for Sarah — "I'll help" plus a note, saved with a ✓, count 0/19 → 1/19, and it appeared on her Serving page
as a commitment. Only the staffing control is broken.

## S5-11 — a child was offered as a candidate for the care team
**Esther, immediately after marking him.** Jacob Kowalczyk, 15, whom she had just set as a Child, was offered to
her as a candidate for the Care team. Pastoral care means visiting people alone, meals, lifts. A church's own
safeguarding policy would forbid it, and the app knows he is a child — it had just been told.

## S5-12 — a private care request comes pre-filled with the asker's own words, ready to publish
**Esther, caught by hand.** Opening Ian McCready's need, the notes box was **pre-filled with his own words,
including his home address and the sentence "I would rather this was not talked about widely"** — staged to go
out to everyone who can sign up for a slot. She rewrote it before publishing and said: *"I'd not have spotted
that in a hurry."*
Ian asked privately, and the app quietly promoted his private words into a public sign-up sheet with his address
in them. Sarah's request has the same shape — she wrote "baby three weeks ago… please keep this quiet".

## S5-13 — one care request becomes 43 sign-up slots; and asking for two kinds of help loses one
**Esther.** Ian asked for lifts AND meals. The need opened as **"Meals" only, with no mention of rides** — so the
lift he actually needs to get to church is simply gone. Then it created **43 sign-up slots for 43 days** for a
man who asked for a meal a couple of times a week. Sarah's came out as 19 slots for 19 days.

## S5-14 — one tap on "Going" signs you up to every future occurrence
**Three witnesses: Peter, Jacob, Grace.** Jacob tapped Going once on Home Group and was signed up to **25** of
them. Grace: all 25, "which I did not intend". Peter: RSVP'd to 6, 13, 20 Sep "and every later Sunday too". The
card says "every time" beside it, but Jacob reports tapping that does nothing, so there is no way to say yes to
one night.

## SAFEGUARDING WORKED — the invariant held under test
Jacob, after being marked a Child: only his mother Ruth and Michael Achterberg (the one adult cleared for youth)
showed a "Message" button; every other adult read "Restricted" and could not be messaged. His own "You" page
explained why, in his words: *"set up as a young person… limited to the adults your church has checked — 1
person so far, and to your parent or guardian."* Michael flipped from Restricted to Message partway through,
which is the clearance propagating live. Esther's console flagged "NO GUARDIAN" with a Link parent button, and
the link held when she checked back. That is the whole chain working.
The gap: **People shows a child only the word "Restricted", with no explanation and no response to tapping.**

---
## S5-15 — a private request for help is republished to the whole church, in the asker's own words
**THE MOST SERIOUS FINDING OF THE ROUND. Verified with a photograph: `ian-can-read-another-members-private-note.png`.**

Sarah Bright asked for meals. She was told, before she typed a word: *"This goes privately to your care team —
no one else sees it."* She wrote: *"baby three weeks ago… please keep this quiet."*

Ian McCready — a member who joined an hour earlier, on no care team, holding no office — opened Care on his own
phone and read this, under the heading "Someone in the church could use a hand":

    Sarah Bright · Meals · 18 days still open · 1/19
    "Evening meals for Sarah and the new baby. Please keep this between those helping – no
     announcement. Contact Rev. Esther for delivery details."
    Wed, Aug 26 — Grace Adeyemi — Chicken and rice, plus a fruit salad — Covered

**The sentence asking for it not to be announced IS the announcement.** He could also see who had signed up and
what they were cooking. His own name and need sit in the same list.

THE CHAIN, now verified end to end across four agents and both sides of the app:
  1. The member is promised privacy and writes candidly under it (Sarah, Ian).
  2. The steward opens the request and the notes box is **PRE-FILLED with the member's own private words** —
     S5-12, which Esther caught by hand on Ian's, including his HOME ADDRESS and "I would rather this was not
     talked about widely". She rewrote his. **Sarah's went out untouched.**
  3. Publishing creates a church-wide sign-up sheet, which is reasonable — you need volunteers.
  4. Every member can now read what was written in confidence.

The sign-up sheet being church-wide is almost certainly intended. **The defect is that the private note travels
into it verbatim**, and that the only thing standing between a congregation and a member's confidences is
whether a busy vicar happens to notice and rewrite the box. Esther noticed on one of two, and said herself:
"I'd not have spotted that in a hurry."

NOT CONTRADICTED BY DENNIS. He reported he could NOT see anyone's requests before being put on the care team,
and that was true — he looked BEFORE publication. Both findings hold. The leak happens at the moment of
publishing, which is exactly why it would survive a privacy review that only tested the intake.

## S5-16 — the privacy promise changes AFTER you have committed
**Ian McCready, screenshot `ian-privacy-promise-changed.png`.**
Before sending, the form promises: *"This goes privately to your care team — no one else sees it"*, and the
button reads "Send to care team". The moment he sent it, the card said something different — *"Sent privately —
only your church leader can open this"* — and a message flashed up: *"Sent to your church leader — **no care
team is set up yet**."*
He was invited to confide in a care team that did not exist, and only told after he had handed over his private
business. Honest AFTER the fact is not the same as honest. (Sarah met the same message and, to be fair, liked
that it admitted the change — but she had already sent hers too.)

## S5-13 REFINED — the member's side works; the publish drops half of it
**Ian, screenshots `ian-lift-missing-only-meals.png`, `ian-no-lift-slots-only-dinners.png`.**
Asking for two kinds of help WORKS on the phone: the form said "Pick as many as you need", he ticked Meals and
Rides, and both stayed ticked. So the multi-kind fix holds where it was made.
What is published is another matter. The header still reads "Meals · Rides" and Esther's note still says "Lifts
to the 10:00 on Sundays, and an evening meal twice a week" — but **all 43 slots are "Dinner" and the word Rides
appears nowhere as a slot. Nobody can sign up to drive him.** The header promises a lift that the sheet makes it
impossible to offer. And "an evening meal twice a week" became 43 consecutive nightly dinners — six weeks of
them.

---
# CORRECTIONS — three entries above are wrong or overstated. Read this before acting on them.
Written after re-testing at a realistic screen size and after two agents went back to photograph their own
findings. Every correction here cuts AGAINST a finding, which is the direction that matters: a sim that only
ever adds to the list is not measuring anything.

## S5-10 IS WITHDRAWN — the care-team picker is not broken
**It works.** Re-tested with the console viewport overridden to **1440 × 900**, the "Who's in Care team" dialog
opens with all twelve candidates listed: Grace Adeyemi, Tom Whitfield, Margaret Oyelaran, Hannah Oduya, Ruth
Kowalczyk, Peter Nwosu, Sarah Bright, Ian McCready, Alan Pemberton, Jacob Kowalczyk, Michael Achterberg,
Naomi Frost.

The cause was the window. **This box has an 800 × 600 virtual display, so every console session all round ran at
780 × 437** — barely a third of a real steward's screen. The dialog's own markup is correct and always was:
`maxHeight: '88%'`, a flex column, and a list that is a proper scroll container (`flex: 1, minHeight: 0,
overflowY: 'auto'`, stew-dashboard.jsx:2453). At 437px the header, explanation and button bar consume nearly
the whole dialog and the names end up behind the footer, which is exactly what Esther measured.

**My own "I reproduced it on the console" was worthless** — I reproduced it in the same undersized window. That
is the lesson, not the dialog: a reproduction in the same broken conditions confirms nothing.

CONSEQUENCE FOR THE ROUND: Dennis was never added to the care team, Ian's and Sarah's needs went unclaimed by
him, and I attributed that to the app. It was the rig. **Add `--window 1440x900` handling to sim-launch before
the next round, or every console finding is suspect.**

## S5-11 IS CONFIRMED — a child IS offered for the care team
Measured directly in that same working dialog: **"Jacob Kowalczyk" is one of the twelve candidate buttons**, and
Esther had already marked him as a Child. So this one is real, and it was hiding inside a finding that was not.

## S5-8 IS OVERSTATED — the way out works; the label does not
**Alan went back to photograph the stuck state and could not reproduce it, and said so rather than staging it.**
His own words: "I found the fault was mine, not the app's." What he had been tapping was never the panel's back
arrow — his tool matched a control labelled **"Minimise"**, which belongs to the Verse of the Day chevron on the
Today page *underneath* the panel. His taps were landing on the covered page. Aimed at the arrow itself (33,77)
the panel closes correctly, confirmed twice. Same for the notification cards: a properly dispatched tap opens
the notice in full.

WHAT SURVIVES, and it is still worth fixing:
  · **The arrow has no accessible name at all** — Margaret checked properly: no text, no aria-label, no title.
    That is what misled the tooling, and it is what would strand a screen-reader user. Real, and unchanged.
  · **The tab strip is clipped at both edges** while the panel is open — photographed in
    `alan-stuck-serving.png`: "Serving" cut off at the left, "Calendar" at the right, and **"Care" not visible
    at all**. A member cannot see that Care exists.
  · **The bottom menu is not reachable while the panel is open** — measured on a real 390 × 844 phone viewport,
    all five tabs covered. Less of a trap than I framed it, since the panel hides them rather than leaving them
    looking available.

## S5-5 STANDS
Unaffected by the above. It was not a mis-aimed tap: I read the offending element out of the live page —
`<div style="position: fixed; inset: 0px; z-index: 9;">`, transparent, 390 × 844 — and sampled three separate
points across the screen, all blocked. Different failure, still unexplained, still unreproduced.

## AND A HARNESS FIX THIS DEMANDS
`sim-actor tap` matched "Minimise" on a covered page beneath an open panel and reported success. It must refuse
to tap an element that is not the topmost thing at its own centre point — `document.elementFromPoint` already
answers this, and it is the same check that proved S5-5. Until then, every "I tapped X and nothing happened" in
this round and the last is suspect. That is now twice this trap has manufactured findings.

---
## S5-17 — a member who can hear everyone and be heard by nobody. THIS SUPERSEDES S5-7.
**Michael Achterberg, with screenshots either side of the send. The sharpest evidence of the round.**

His own summary: *"I can hear everyone; nobody can hear me."*

  · Three private messages to Jacob: box emptied each time, thread stayed completely blank. No bubble, no
    "sending", no error, no "not delivered". `michael-dm-jacob-before-send.png` / `-vanishes-after-send.png`
  · A hello into Life Group: identical, and still absent after scrolling to the bottom.
  · Meanwhile **Grace, Margaret, Tom, Hannah and Ruth all arrived while he watched.** Receiving is perfect.

This changes the shape of the message-loss problem. S5-7 read it as intermittent and load-related; Michael's is
**total, persistent and one-directional**. Naomi's three-in-a-row has the same shape, and she too was reading
other rooms' traffic while her own words disappeared.

MEASURED ON HIS PHONE: `relaysHealthy()` returns **true**. The app is confident its connection is fine.

A LEAD, NOT A CONCLUSION — do not treat the next paragraph as diagnosed. This project already has a trap of
exactly this shape: chat-subs-die-on-reconnect records that a returning socket does not re-issue its REQs and
that **`relaysHealthy()` being true is what disables the safety net**. And pin-lock-breaks-relay-auth records
reads working anonymously while writes are refused, because the relay's write gate needs an authenticated
session that reads do not. "Receives everything, sends nothing, reports healthy" fits that description closely
enough to check FIRST.

WHY THIS IS THE ONE TO FIX. Every other finding costs a church confusion. This one costs it people. A member
who cannot be heard does not file a bug — they conclude the church ignored them and quietly stop opening the
app. Michael's messages were to a 15-year-old he had just been cleared to look after. Naomi's was a prayer
request about her dying father. Neither of them will ever know it did not arrive, and neither will the church.

WHAT MUST BE TRUE OF THE FIX, whatever the cause turns out to be: a send that does not reach the relay must say
so and keep the words. Every witness this round described the same thing — the composer empties, which every
single one of them read as success.

---
# S5-15 INVESTIGATED — read-only audit, 2026-08-25. Findings only; nothing fixed.
The owner asked whether the stewards had set care to "care team only", which would have made this an
enforcement failure. **Measured: `visibility: "all"`, the shipped default** (steward-meals.src.js:61). Nothing
was bypassed. The hypothesis was wrong and productive — ruling it out is what exposed the real shape.

## The intake really is private. Twice over.
At St Chad's a request could be opened by exactly TWO keys — the church console and the asker — because the
care-team recipient list was never published (the roster is `people: []`). The relay also refuses to serve
intake documents to ordinary members. **This is why Dennis saw nothing, and his finding stands.** The front
door is sound.

## The exposure begins at one click, and the label lies
When the steward opens "Set up help", the Notes box **arrives already containing the member's private
message**, and whatever is in that box is published to the church-wide card every member sees. Verified by
content at four sites — two screens and two data layers, so fixing one would not fix it:

  · `app/screens-today.jsx:334` and `app/stew-meals.jsx:438` — `useState(req.note || '')`
  · `src/fellowship.src.js:3555` — `notes: String(f.notes != null ? f.notes : (req.note || '')).trim()`
  · `src/steward-meals.src.js:370` — the console twin

That fallback is the sharp end: **a caller that passes no notes at all still copies the private note.**

And the phone's approve sheet labels that box **"Notes for the team (optional)"** (`screens-today.jsx:368`).
It does not go to the team. It goes to the congregation. The label states the opposite of the truth.

The asker's REAL NAME is copied the same way, with no option to anonymise at that moment.

DELIBERATE OR ACCIDENT? Deliberate as a convenience, unconsidered as a disclosure. The introducing commit
(d5ba5db, 24 Jul) advertises "a pre-filled 'Set up help' sheet" as the feature. Nothing in it or its console
twin discusses private text crossing into a church-wide document.

## The promise is FIXED TEXT — so the default configuration makes it false
"This goes privately to your care team — no one else sees it" does not vary with the visibility setting. So
**every church on the shipped default promises a privacy it does not provide**, and the member discovers it
when a stranger reads their words back. The console's own setting is framed as turnout ("Every member sees
needs — best for turnout"), never as privacy, and nothing tells a steward what the member was promised.
This is a broken promise, not a broken gate — worse for a church, easier to fix.

## S5-18 — the approval receipt hands the relay exactly what the seal exists to hide
**I verified this one myself, verbatim out of relay.sqlite.** Every approval writes a document whose content is
**cleartext**:

    "content":"{\"status\":\"approved\",\"needId\":\"ca…
    "tags":[…,["p","cbf87c74f24d3c1c…"]]

A `p` tag naming the member, beside the need id, in the clear. The sealed half of a care need exists precisely
so the relay never learns **who a need is for** — and this row, written at the same second, says it outright.
Under this project's threat model (lawful compulsion and seizure of the box) that voids the seal's purpose for
every need created through the approve flow. See uk-pilot-threat-model.

## S5-19 — "Only the care team" is cosmetic, and it fails the churches trying hardest to be careful
The relay parses only `adminGroupId` and `openedBy` from the care settings; **"visibility" appears in
gateway.mjs only in a comment.** The team-only filter lives solely in the member's own app, and the church care
key is wrapped to EVERY member regardless. So a church that deliberately picks "Only the care-team group below
sees needs" gets: the card hidden on well-behaved phones, the relay still serving it to any member who asks,
and every member still holding the key to decrypt it. Confirms the older project note, and it is worse than
what round 5 actually observed — because it only bites the churches that tried to be private.

## What the auditor could NOT establish, and said so
That Sarah's published note is byte-for-byte her intake note. Her intake decrypts only for the church key and
for Sarah. The pre-fill mechanism and the steward's testimony make it near-certain, but it is not proven.

## What a fix must be true of — NOT a fix, and no patch was written
  · The member's words never reach a congregation-visible field without a human deliberately putting them
    there — at all four sites, in both bundles. Fixing the label alone is the documented failure mode here.
  · Every field on the approve sheet says truthfully who will see it, before the publish button, name included.
  · The intake promise and the visibility setting stop contradicting each other — either the promise becomes
    conditional, or the pipeline makes it true.
  · Team-only is enforced where enforcement is real (the relay and the key audience), or relabelled to stop
    overclaiming.
  · The approval receipt stops linking requester to need in relay-readable cleartext, or the anti-seizure claim
    is withdrawn from the design docs.
  · It is proven on the state the tests never drove: **a request approved without the steward touching the
    notes box.**
