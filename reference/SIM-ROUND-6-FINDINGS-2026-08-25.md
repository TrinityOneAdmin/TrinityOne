# Simulated-congregation findings — round 6, St Aidan's, Barnwell Green, 2026-08-25

**Tracked copy.** The working notes live in `reference/sim/`, which is gitignored because it also holds the
PINs and twelve-word recovery phrases for every simulated person. Those stay off the repository permanently.
This file is the findings only — checked before copying: no PINs, no recovery words, no keys.

**What made this round different, and worth trusting more than the last one.** The relay was wiped to zero,
every previous browser profile destroyed, and the church founded from nothing by an agent who chose its own
name. **The twenty testers were told NOTHING about what we had been building** — not the Suite work, not the
capability fix, not the care-privacy investigation, not one earlier finding. Owner's design. Whatever they hit,
they hit cold, which is why several of these confirmations carry more weight than a code audit could.

The rig was repaired first: taps now refuse a covered element instead of reporting success, sends wait for the
words to actually appear, and the console runs at a real desktop size rather than the cramped window that
fabricated a finding in round 5.

**Read the corrections as carefully as the findings.** Two entries below withdraw or narrow something —
including one where I was wrong to dismiss four agents in the previous round. A list that only ever grows is
not measuring anything.

---

# Round 6 — St Aidan's, Barnwell Green, 2026-08-25
Fresh everything: relay wiped to zero, all 19 previous profiles destroyed, a church founded from nothing by an
agent who chose its name. **The agents were told NOTHING about our recent work** — no mention of the Suite, the
capability fix, the care-privacy chain, or any earlier finding. Owner's design, and the right one: whatever
they hit, they hit cold.

Rig repaired before this round: `tap` refuses a covered element instead of reporting success; `send` waits for
the words to actually appear in the room; the console runs at 1440x900 instead of the 780x437 that fabricated
a finding last time.

---

## R6-1 — MESSAGES SENT BEFORE THE GROUP KEY ARRIVES ARE LOST, AND THE APP NEVER SAYS SO
**Two independent witnesses, and between them they give the mechanism that round 5 could not find.**

Round 5 had SIX people report messages vanishing — the composer clears, nothing posts, no error. It never
reproduced on demand and the "enter key" theory died under testing. Round 6 supplies the missing piece:

  · **Priya Sharma** — her messages vanished silently in Life Group and Prayer, twice each, while Alan's and
    Grace's arrived fine. The Prayer room was showing **"Encrypted · no key yet"**.
    `priya-my-message-vanishes-lifegroup.png`, `priya-prayer-room-no-key-yet.png`
  · **Alan Frost** — posted to Life Group BEFORE he was admitted: his message rendered **as a wall of base64
    gibberish marked "Waiting to send", and it is still sitting there**, now buried under later messages.
    After admission he posted again and it worked perfectly. `alan-message-shows-as-gibberish.png`

So the shape is: **a member who does not yet hold the room's key cannot send to it, and the app neither
prevents the attempt nor reports the failure.** It clears the box, which every witness read as success. One of
them was left with unreadable ciphertext permanently in the church's room.

NOT YET VERIFIED BY ME — this is the strongest lead we have had on the silent-message-loss family, not a
diagnosis. What would settle it: whether the encrypt path has a no-key branch that fails soft, and whether the
"Waiting to send" queue ever retries once the key arrives. Note Priya's phone held ZERO group keys when
measured mid-round.

## R6-2 — ONE TAP ON "GOING" ANSWERS FOR EVERY FUTURE OCCURRENCE
**Priya, this round. Peter, Jacob and Grace reported the identical thing in round 5 — four witnesses now.**
Tapping "Going" on Wednesday 26 August marked her as going to **all 25 future Wednesdays**. Worse in the other
direction: one "Can't" on Sunday 30 August marked her absent from **every** Parish Communion. The card carries
the words "every time" beside it, but that is **a static label, not a choice** — there is no way to answer for
a single date.
Her summary is the finding: *"the one thing I did manage to say about my availability came out as 'Priya never
comes to church'."* For a shift worker that is precisely backwards.

## R6-3 — THE FRONT DOOR TELLS A WAITING MEMBER NOTHING TRUE
A cluster, from people who could not get in for over an hour:
  · **"Check again" does not check.** Margaret: *"it just jumps to the Community tab and repeats the same
    message in different words. That's not a refresh button, that's a signpost pretending to be one."* Raj hit
    the same. `margaret-still-waiting-approval.png`
  · **Two wordings for one state** — "Waiting to be let in" (Today) vs "Pending steward approval" (Community).
  · **The bell showed a "1" badge throughout**; opening it said "You're all caught up" with nothing in it.
    `margaret-notifications.png`
  · **The tab strip runs off the right edge** — "Calendar" chopped in half. Same clipping that hid the Care tab
    in round 5.
  · **Nothing tells the vicar anyone is waiting.** Ada set the church up, went to make supper, and twenty
    people queued.

**MY FAULT, NOT THE APP'S, and recorded so it is not miscounted as a finding:** the vicar's agent finished
before the congregation arrived, so the queue went unattended for over an hour. Margaret tapped "Check again"
fourteen times across 75 minutes. When Ada returned, all twenty were admitted and admission propagated
correctly — verified on three phones. The waiting-room defects above are real; the *duration* was my
scheduling.

## R6-4 — SETTING A CHURCH UP: nine things the vicar hit before anyone arrived
From Ada, founding St Aidan's with no help and no prior knowledge:
  · A red banner **"Couldn't save to the relay — check the connection and try again"** over three groups that
    **were created perfectly well**. `ada-PROBLEM-couldnt-save-to-relay-on-group-create.png`
  · **Tick boxes ignore their own labels** — "Child-safe" and the feature toggles only respond to the tiny
    square/switch itself, not the words beside it. `ada-PROBLEM-childsafe-checkbox-not-tappable.png`,
    `ada-PROBLEM-feature-toggles-dont-turn-on.png`
  · **The calendar insists "No upcoming services. Add one on the Rota page"** while displaying those services.
    `ada-PROBLEM-calendar-says-no-upcoming-services.png`
  · **The rota was empty** — none of the services entered during setup reached it.
    `ada-PROBLEM-rota-empty-no-add-service.png`
  · Marking a group child-safe **jumps it to the bottom of the list**, silently reordering what members see.
  · Continue looked greyed out and gave no feedback; she retyped the church name thinking it had not taken.
  · The backup logged the date as **8/25/2026** — American format, in an English parish.
  · The invite poster **stayed stuck open over the next dialog** until she found a small ×.
  · GOOD, and worth protecting: the 12-word ceremony (write them down, hide, then quiz on three of them), the
    invite poster itself with spaces for members to write their own words, and the offer to write the
    announcement for her when she switched a feature on.

## R6-5 — THE LIBRARY IS THE BEST-LIKED PART, AND ITS PROGRESS IS INVISIBLE
Alan Frost, who came for the Bible and is the hardest person here to please, called the reading "genuinely
pleasant" and singled out the Strong's dictionary. Against that:
  · **Installing a translation or commentary shows a spinner for many minutes with no progress and no message**
    — he twice concluded it had failed. Both eventually installed.
  · **With Matthew Henry installed, the reader's Commentary panel still says "Nothing here for John 1 — Install
    a commentary from the Library."** `alan-commentary-installed-but-empty.png`
  · **A reading plan cannot be advanced** — "Begin · Day 1" opens the chapter, and afterwards the card still
    reads START A PLAN, 0%. He found nothing anywhere to mark a day done.
    `alan-plan-still-zero-percent.png`
  · **Typing a search does nothing** — only the suggested chips work, so "Romans 8:28" left the previous
    results on screen and read as though it had returned verses about Isaac. Jacob reported the same in round
    5, so two witnesses. `alan-search-reference-ignored.png`
  · The Verse of the Day is labelled **WEB** but the wording is King James.

## STILL OPEN AT TIME OF WRITING
Agents still running. Care, safeguarding, kids check-in, prayer, run sheets and direct messages had no evidence
on the relay when this was written — 11 of 27 systems exercised. A blank line on that checklist means nobody
drove it, NOT that it works.

---
## R6-6 — SOME MEMBERS CANNOT SEND PRIVATE MESSAGES AT ALL, AND ARE NEVER TOLD. **I VERIFIED THIS MYSELF.**
**The most serious finding of the round, and it closes a question round 5 left open.**

  · **Esther Wills** wrote five private letters — including a sorry-for-your-loss note to a man whose wife died
    four months ago. The box emptied each time. Nothing appeared. No error. Her thread still says "No messages
    yet". `esther-dm-david-vanished.png`, `esther-dm-sent-but-thread-empty.png`
  · **Chloe Mensah**, 16, sent four messages to her own father. His arrived and showed in the thread; hers
    vanished. `chloe-reply-to-dad-vanishes.png`
  · Esther isolated it herself, and this is the key: *"the care-team chat DID send and stayed on screen, so it
    isn't me: it's direct messages specifically."*

**MEASURED ON THE RELAY, not inferred.** DMs that reached it: **13 total. From Esther: 0. From Chloe: 0.**
Other members' private messages landed perfectly well in the same church at the same time. So the messages
never left those two phones — this is not a rendering problem, and their words are simply gone.

This is the same shape as round 5's Michael Achterberg — *"I can hear everyone; nobody can hear me"* — which
also measured healthy. Six witnesses across two rounds now, and for the first time we have a clean signature:
**a member whose sends fail while their receives work, silently, with the composer clearing as if successful.**

The diagnostic question for whoever fixes it: what distinguishes the members who CAN send from those who
cannot, given both were admitted at the same moment by the same steward.

## R6-7 — THE FIRST THING A NEW MEMBER SEES IS A BLANK SCREEN FOR HALF A MINUTE. **REPRODUCED.**
Three witnesses independently, then me. Tapping "Open TrinityOne now" from the invitation:

    t+5s   readyState loading, page empty
    t+15s  readyState complete, page STILL EMPTY
    t+30s  content finally appears

No spinner, no message, no explanation. Bill Radcliffe's verdict is the finding: *"If the blank screen had
been my one and only try, I'd have put the phone down and never picked it up again."* Esther waited "well over
a minute". David only got in by reloading; Bill only got in with help. `bill-blank-after-open.png`,
`esther-blank-after-open.png`, `david-blank-after-open.png`, `priya-blank-after-open.png`
This is the very first moment of the product, on the path every single member takes.

## R6-8 — "CHILD-SAFE" MEANS VISIBLE *TO* CHILDREN, NOT PROTECTED *FOR* THEM
**Measured in the church's own documents:**

    Sunday Club (Children)   visibility=(open)   childsafe=True   encrypted=True

So the children's room is **open to the whole church**. David Hargreaves, a stranger of ten minutes with no
role and no checks, walked into it — and flagged it himself: *"a brand-new stranger in the children's room is
a PCC matter."* `david-newcomer-inside-childrens-room.png`

Chloe, who is 16, was **dropped straight into it with full read and write**, and reports: *"Nobody asked my
age, nothing was explained."*

The word is doing the opposite of what a vicar would read it as. Ada ticked "Child-safe" believing she was
protecting a room; it made the room visible to children while leaving it open to everyone else. To her credit
the app's own tooltip is accurate — but the label is the thing people act on, and a churchwarden will not
read a tooltip before ticking a box marked child-safe.
(Ada DID mark a minor and link a guardian — minors, guardians and cleared-worker documents all exist. The
machinery works. The room's audience is the problem.)

## R6-9 — THE APP TELLS A CHURCH ITS RECORDS STAY WITH THE PARISH WHILE TALKING TO TWO OTHER SERVERS
**David Hargreaves, who joined specifically to check this.** Settings → Relays showed **three** connected: the
church's own tunnel, plus `app.trinityone.church` and `trinityone-master-01.tailbeaac0.ts.net`.
`david-three-relays-two-not-ours.png`
Against that, Ada's welcome says the church's records "stay with the parish, not with a company", and the
privacy guide says "No company in the middle" — while the technical guide does admit a church may "run its own
or use ours". As actually configured today, the first two statements are not true.
His conclusion, which is the right one: *"before I recommend it to the parish I want two things on the record:
we run our own server or we stop saying the data stays with the parish."* This is exactly the overclaiming the
UK threat model warns against — see uk-pilot-threat-model.

## R6-10 — ONE TAP ANSWERS FOR SIX MONTHS, AND CANNOT BE UNDONE
**Raj's version is worse than Priya's.** One tap of "Can't" on tomorrow's Midweek Communion declined **all 25
Wednesdays to February**, with no confirmation. He then tapped "Going" once and it flipped **all 25 to going,
wiping every decline**. Tapping "every time" did nothing; tapping "You're going" did nothing. There is no way
to answer for a single date. `raj-one-tap-declined-25-services.png`, `raj-going-overwrote-all-25-declines.png`
The explanation exists — "this repeats, so your answer covers every date" — but only inside a sheet you reach
by tapping the title. In the list it is two grey words. Six witnesses across two rounds.

## R6-11 — THE DIRECTORY DOES NOT AGREE WITH ITSELF OR WITH THE CHURCH
  · David saw **"0 people"** and was listed as "Member" despite having typed his name — while reading four
    members' full names, and one member's road, in Life Group. `david-people-0-and-name-lost.png`
  · Tom saw 20 people but **8 were just "Member · npub1e33r…"**, with no roles at all: *"I couldn't pick out
    the vicar."* `tom-people-no-names.png`
  · **Rev Ada is not in the People list at all** — Bill checked: 20 people, no vicar. Identical to round 5,
    where three agents found the vicar missing in a completely different church. `bill-people-no-vicar.png`
  · Groups say **"0 members"** while six people talk in them with unread badges — round 5's finding, unchanged.

## WHAT IS GOOD, AND WOULD BE LOST IF IT WERE TRADED AWAY
  · **The privacy labels are honest and were BELIEVED by the sceptic.** David checked each room against its
    label — "Not encrypted", "End-to-end encrypted", "Encrypted · no key yet" — and found they matched
    reality: *"I did not expect that honesty."* He would vote to keep the app.
  · **Care intake showed nobody else's request.** David looked specifically and could see only his own form.
  · **The 12-word ceremony** — write them down, hide them, then quiz on three — was praised by name by Ada,
    Alan, Sarah, Margaret, Tom and Chloe. Six people, unprompted.
  · **The Bible.** Alan, the hardest man here to please, called it "genuinely pleasant" and singled out the
    Strong's dictionary.
  · **The church worked as a church.** Tom, who knew nobody and nearly left twice, was rescued by people:
    Michael offered him a lift, Margaret messaged him unprompted about which door to use. *"More part of it —
    clearly."* That is the product's actual purpose, and it happened.

---
## R6-8 REFINED, from Peter Mensah — the safeguarding MACHINERY works; the ROUTE TO IT does not
Peter joined specifically to check what the app does about his 16-year-old daughter, and his evidence corrects
my framing above. Recording it because the correction matters more than the original claim:

**What is genuinely good, and he did not expect it to be:** the app explains itself in two places (You →
Children's accounts, and a Help guide), and the explanation is *"plain and reassuring"* — a child sees only
child-safe groups, only her parent and church-cleared adults can message her, **a steward marks her, never a
tick-box**, and it is enforced at the server rather than on her phone. The link itself worked: "Chloe Mensah —
Linked by your steward" appeared. `peter-chloe-linked.png`. Minors, guardians and cleared-worker documents all
exist on the relay. The machinery is real.

**What fails is every route a parent would actually take:**
  · **There is no button anywhere for a parent to request the link.** The guide says "ask a steward" —
  · **and the steward is unreachable.** Rev Ada is not in the People directory, so Peter had no way to message
    her at all. He asked in a group and hoped. (Same defect as R6-11, but this is where it costs something.)
  · **Nothing told him it had worked.** The link appeared silently; he only found out by going back to look.
  · **Nothing on Chloe's row shows she is protected.** She looks like every other adult in the directory, so a
    parent has to take the help page's word for it. His verdict: *"I'm taking the help page's word for it."*

So R6-8's real content is narrower than I first wrote and still serious: **the children's room was open to the
whole church** (measured: `Sunday Club (Children) visibility=(open) childsafe=True`), and **a stranger of ten
minutes read it**. But "the app never marked the child" was wrong — it did, once a steward got to it. What is
missing is the parent's half of the loop: no way in, no confirmation, no visible state.

Also new from Peter: **an RSVP silently reverted twice before sticking** — the button lit, then went back on
its own; the third attempt held. `peter-rsvp-reverted-after-8s.png`

---
## R6-12 — THE VICAR IS NOT IN HER OWN CHURCH'S DIRECTORY. NINE WITNESSES ACROSS TWO ROUNDS.
**The most-reported defect we have, in two different churches founded by two different people.**
Round 6: Bill, Peter, Michael, Luke, Doreen and Tom all looked for Rev Ada and found 20 people, no vicar.
Round 5: Sarah, Priya and Peter found the same about Rev Esther.

It is not cosmetic, because everything the app tells you to do routes through her:
  · **Peter** could not request the parent link for his 16-year-old — the guide says "ask a steward", and there
    was no steward to ask. He posted into a group and hoped.
  · **Michael**, who volunteers for everything, could not ask to be put on a serving team: *"the app gives a
    willing member no way to put his own name down"*, and no way to reach the person who can.
  · **Doreen**, 78, simply wanted to thank her vicar for the welcome. Whole Church is announcements-only, so
    there was no route at all.
  · **Luke** needed to know who was on music: *"there's no obvious person to ask; nobody is labelled leader or
    steward."*
Four different needs, one missing row. `bill-people-no-vicar.png`, `peter-chloe-search.png`

## R6-13 — A WILLING MEMBER CANNOT PUT HIS OWN NAME DOWN
**Michael Osei, who exists to volunteer.** He managed exactly one thing: the Care page's "I'm here to help",
where he listed all eight kinds of help. Everything else was closed to him — Serving says "your leader adds
you", the Rota says "No rota published yet" even though services exist in Events, and there is no self-signup
anywhere. Luke likewise found **no way for a member to create a group** — he could not get the music team a
room. Two people, both trying to give the church something, both blocked.
Also: having listed himself as available, the page still told him *"Nobody else has listed themselves as
available yet"* — the same contradiction round 5 saw with Dennis.

## R6-14 — SMALL THINGS THAT DECIDE WHETHER DOREEN COMES BACK
From the 78-year-old, who is the person this app most needs to work for. She got what she came for — both
service times — and said the sign-up made her feel "looked after". Against that:
  · **A message she typed was lost for good** — box emptied, nothing appeared. She rewrote it, and the second
    attempt took about five seconds of blank screen before arriving. *"I nearly sent it three times."*
  · **She was trapped in Help & Guides** — the phone's Back button did nothing, the bottom tabs did nothing,
    and only a small unlabelled arrow got her out. `doreen-11-cannot-leave-help-screen.png`
  · **Words she could not guess:** "CHOOSE YOUR MARK", "Set unavailable" (she is on no team), and Library's
    "Modules", "Lexicons", "Cross References".
  · **Help still said "Back up your 12 words — START HERE"** after she had done it, so she thought it had not
    saved.
  · The honest-answer trap: her daughter set the phone up, so "Someone set this up for me" looked right — but
    it then asked her to scan a code nobody was showing her.
  · Currency defaults to **US dollars** in an English parish. Ada's backup dated **8/25/2026**. Third and
    fourth sightings of the same wrong-locale assumption.

## R6-15 — RELOADING READS AS "MY CHURCH HAS DISAPPEARED"
**Luke.** A mid-session reload made the whole church side vanish — Community and You gone, tab bar down to
Today/Read/Library — for about ten seconds before the PIN prompt appeared. *"It reads as 'my church has
disappeared', not 'I'm locked'."* `luke-after-reload-church-gone.png`
That is the silent-blank shape again, at the moment a nervous member is most likely to be reloading because
something already looked wrong.

---
## R6-16 — THE CHURCH ITSELF WORKED. Recorded because it is the point of the product.
**Grace Ncube got EIGHT replies** — Alan, Tom, Michael, Raj, David, Margaret, Ibrahim (also privately), Luke
and Doreen — and Ibrahim accepted an invitation to an evening social. **Tom**, who arrived knowing nobody and
nearly gave up twice, was rescued entirely by people: Michael offered him a lift, Margaret messaged him
unprompted about which door to use. His verdict: *"More part of it — clearly."*
Twenty strangers, none told anything about the app or each other, held a real conversation and looked after
the newcomer and the bereaved man among them. Whatever is broken below, that happened.

## R6-17 — THE VICAR'S OWN NOTICES ARE SIGNED "MEMBER"
Grace: both of Ada's announcements to the whole church are attributed to **"Member"**, with her name appearing
only inside the text she typed. `grace-wholechurch.png`. Round 5 saw the identical thing in a different church.
A noticeboard where the vicar's letter is signed by nobody is a small defect with a large effect on trust —
and it compounds R6-12, where she is missing from the directory entirely.

## R6-18 — WHAT THE NOTICEBOARD PROMISES IS NOT IN THE DIARY
Grace and Ibrahim, independently: the midweek gathering at the Rectory that Ada's noticeboard talks about is
**not in Events at all**. Events holds only the three recurring services on repeat to 14 February plus Harvest.
Round 5 had the same split — Harvest and Remembrance announced in a notice, absent from the calendar.
A church announces things in prose and the app never turns them into dates, so the diary is permanently a
partial truth.

## DM FAILURE IS PER-MEMBER, NOT UNIVERSAL — narrowing R6-6
Grace's DMs worked in both directions. Bill's message to Margaret sent properly. Michael DM'd four people
successfully. Esther sent five that never left her phone; Chloe four. So roughly a quarter of the congregation
silently could not use private messaging at all, in the same church, at the same time, admitted by the same
steward in the same batch. That is the shape the fix has to explain.

---
# R6-6 RESOLVED — IT IS THE ENTER KEY. AND I WAS WRONG TO SET THAT ASIDE.
**Ibrahim Sesay, blind to everything, using the real on-screen keyboard rather than any test tooling:**

> *"I tried messaging Alan Frost privately, twice, pressing send on the keyboard → the box emptied and the
> thread stayed blank... **Tapping the little send arrow on screen worked every time.** So two messages I wrote
> to a stranger are simply gone and I'd never have known."*

That is the whole finding. **Enter-to-send silently discards the message. The on-screen arrow works.**

## The correction I owe round 5
Four agents in round 5 said exactly this. I could not reproduce it, found their claim was entangled with the
harness's own `send` command (which sets the textarea value directly and calls an emptied box "sent"), and
recorded it as *"NOT yet a verified app defect"*. Setting it aside pending a clean repro was the right call on
the evidence I had. **The theory was correct and I under-weighted it**, and four people telling me the same
thing should have bought a better test than the one I ran — I tested a DM that happened to succeed and treated
one green as an answer.

## What it explains, measured on the relay
    Members whose messages reached the relay:  15 of 20
    From Ruth:    0  (six attempts — a prayer request for her mother, two Life Group posts, a reply, a DM)
    From Esther:  0  (five private letters, including a condolence note)
    From Chloe:   0  (four messages to her own father)
Ruth has NINE other documents on the relay, so her phone was talking to the church perfectly well. Only her
words were dropped. She could hear the church; the church could not hear her.

## Why this is the most damaging defect in the product
Nobody experiences it as a bug. They experience it as being ignored.
  · **Ruth** never asked her church to pray for her mother, and could not answer the two people who spoke to her.
  · **Ibrahim**, four months widowed: *"I nearly concluded nobody wanted to talk to me, when in fact the app had
    swallowed what I'd written."*
  · **Chloe**, 16, wrote four times to her father and got silence back.
  · **Esther's** condolence letter to Ibrahim never arrived. Both of them were in the same church, that evening,
    each thinking the other had not bothered.
A church would never report this. It would simply become a quiet place where some people stopped talking.

## What a fix must be true of
A send that does not reach the relay must SAY so and keep the words. Every witness across two rounds described
the same thing: the composer empties, which every single person read as success. Fixing the Enter path alone is
not enough — the silent-failure shape is what turned a keyboard bug into people believing they had been snubbed.

---
## R6-19 — THE GAP BETWEEN A CHILD JOINING AND A STEWARD MARKING THEM IS UNPROTECTED AND INVISIBLE
**Stated precisely, because the alarming version is not quite what happened.**

Hannah Byrne, who runs the youth work, joined and twenty minutes later tapped Chloe's row in the directory. It
opened a private encrypted chat headed *"Only you two can read these messages"* — no warning, no badge, nothing
saying Chloe is 16. Hannah had been checked by nobody. `hannah-dm-16yo-no-warning.png`

**What I verified before writing this up:** Chloe IS marked as a minor — the relay holds a `minors:` document
naming her exact key, written at **19:39**. So the machinery was applied. Hannah's attempt was very likely
BEFORE that moment, and her messages failed anyway for the unrelated Enter-key reason (R6-6), so we cannot know
whether the relay would have refused delivery. Round 5 showed the relay DOES enforce this: non-cleared adults
saw "Restricted" and could not message the child; only the parent and the one cleared adult saw "Message".

**So the finding is narrower and still real: a child is unprotected from the moment they join until a steward
gets round to marking them, and NOTHING anywhere shows that state.** In this round that window was long enough
for the youth worker to open a private channel to a 16-year-old. Nobody — not the child, not the parent, not
the steward, not the adult — can see whether the protection is on yet.
Peter, her father, ended up *"taking the help page's word for it"*. Hannah's verdict on running her youth work
through the app: **"No."** The reasons she gave are the register, the clearance record, and this.

## R6-20 — THERE IS NOWHERE FOR A CHURCH COUNCIL TO MEET
**Joseph Adeyemi, the council secretary, sent specifically to check.**
  · **No confidential room exists and a member cannot create one.** Every room he could see is labelled "Open
    to your church". (Ada made a PCC room, invite-only and encrypted — he could not see it, which is correct.
    But then nothing told him it existed either, so from his seat the church has no council room at all.)
  · **There is no member list for any room.** "More options" on a group offers only "Prayer request" and
    "Poll". *"A label is all you get, and the labels are wrong."*
  · **"0 members" on rooms where he counted eight named people posting.**
  · **No way to add the council meeting to the calendar** — Events has no add button, Calendar says "Nothing on
    this day" with no add.
  · **Nowhere for agenda or minutes.** Library is Bibles and journals only.
  · **Back threw him clean out of the app** to the public invitation page; re-entering showed "Waiting to be
    let in" until he found a PIN box painted invisibly over it.
His verdict: *"I would not put a personnel matter, a safeguarding case or a set of accounts anywhere in this
app as it stands."*
Note the shape: the council room DOES exist and is correctly private. The failure is that a church officer
cannot discover it, cannot see who is in any room, and cannot create what he needs.

---
## R6-21 — THE CHURCHWARDEN CANNOT BUILD A ROTA. IT IS HER ENTIRE JOB.
**Margaret Ellis, eleven years running this parish's practical side, back inside after being admitted.**
The Rota said "No rota published yet" when she arrived and still said it an hour later. **There is no button
anywhere for her to build one, publish one, or add a single person to a team.** Michael Osei asked her directly
to put him on Sunday; she could not. Ada had entered the services during setup and they never reached the rota
at all (R6-4).

So the chain across four people: Ada enters services → they do not reach the rota → Margaret cannot create one
→ Michael cannot get on one → Luke cannot find out who is on music → Peter cannot volunteer. Six of the
twenty came to the app wanting to serve or organise serving, and not one of them could.

Her closing line is the finding:
> *"The talking works very well and the church came alive in it. The rota does not exist, and nothing in the
> app lets me make it exist. I have written Sunday's arrangements in my paper book, which has never once told
> me it wasn't published yet."*

`margaret-service-card-opens-nothing.png`, `margaret-vicar-not-in-people.png`

## R6-22 — SAVED, BUT SILENTLY
Margaret set herself unavailable for 20 September: the sheet shut with **no confirmation at all** and the page
showed nothing. It HAD saved — the tick was still there on reopening — but nothing said so. Luke reported the
identical thing. Peter had the opposite: an RSVP that lit up and silently reverted twice before the third
attempt held.
Both directions of the same defect: **the app does not tell you what it did.** Combined with R6-6, a member has
no reliable way to know whether anything they do has actually happened.

---
## R6-23 — THE CARE PRIVACY LEAK REPRODUCED IN A FRESH CHURCH, BY SOMEONE WHO KNEW NOTHING ABOUT IT
**This is the strongest confirmation the sim has ever produced, and it validates today's code audit.**

Round 5 found that a private request for help is republished to the whole church in the asker's own words. We
investigated it by reading code, traced four copy sites, and established the mechanism. Round 6's Naomi Blake —
told nothing, in a different church, founded by a different vicar, on a wiped relay — walked straight into it:

> *"The form promised 'no one else sees it', but the sign-up sheet on my Today screen is headed 'Someone in the
> church could use a hand' and shows me Doreen Pike's visits and Ibrahim Sesay's visits alongside Sarah's
> meals — and my whole note, **'Sarah has just had her baby'**, is printed there for anyone to read. Sarah
> asked me to keep it between her and the care team. It isn't."*

Three different people's private circumstances — a new mother, and two people wanting visits — on one screen,
readable by an ordinary member. Exactly the chain the audit described: private intake → steward publishes →
the words travel verbatim into a church-wide sheet.

Note who was harmed here: Naomi wrote that note ABOUT SOMEONE ELSE, under a promise of confidence, and it was
published under Sarah's name. Ibrahim had chosen the quiet route specifically to avoid being "publicly
present"; his request for visits is on the same sheet.

Her verdict on whether the paper list goes in the bin: **"No. Not yet."** Two conditions, both ours:
> *"my messages must stop disappearing when I press Enter, and the app must stop telling people a request is
> private when the whole church can read it."*

**And she independently confirmed the Enter-key defect** with no knowledge of it: four messages lost by
keyboard, *"clicking the paper-plane arrow instead worked first time — so the Enter key throws your message
away."* That is now three blind isolations of the same mechanism in one round.

ALSO: the "Ask for help" form opened as a **letterbox 108px tall inside an 844px page**, with 744px of content
crammed into it — she could see the title and had to scroll a two-line window to reach the options.
`naomi-PROBLEM-askforhelp-sheet-clipped-108px.png`

## WHAT THE MEAL TRAIN GOT RIGHT
Recorded because it is the feature she came to test and it nearly won her over: once a leader set it up, the
day-by-day list, "I'll help", and a box for what you are bringing all worked. She took Wednesday and saved
"Chicken and rice bake, dairy-free"; Margaret answered her post and took two more days. *"This bit is genuinely
good... I'd use it tomorrow if two things changed."*

---
## R6-24 — THERE ARE TWO ROUTES TO THE SAME HARM, AND THE SECOND ONE IS WORSE
**Sarah Lindqvist, back inside, and this reframes the whole care finding.**

Round 5's leak — code-audited today — is: a steward publishes a need, and the member's private note travels
verbatim into a church-wide sign-up sheet. Naomi hit that path this round.

**Sarah hit a different one, and it is the more damning of the two.** She found her name, her baby, "evenings
are the hard bit" and her dairy restriction **posted in Life Group**, a room with about a dozen people in it,
where Margaret then discussed her dinners by name. `sarah-private-request-leaked-into-life-group.png`

She does not blame the person who posted it, and her reasoning is the finding:

> *"The app's Care section says 'Nothing to sign up for yet' and no one can set a meal train up, so the only
> place to organise food is a group chat. **The app made a promise its own tools force someone to break.**
> For a private person that is worse than never promising."*

So the promise "no one else sees it" is broken TWO ways: once by the publish path copying her words, and once
because the care tools are too incomplete to use, which drives a willing organiser into a public room. Fixing
the copy path alone leaves the second route wide open — as long as a meal train cannot be run from Care, it
will be run in chat, with names.

Her closing instruction to us:
> *"The 'no one else sees it' line is the whole reason I pressed send. Either give the care team a way to
> organise meals without naming me in public, or stop saying that sentence."*

ALSO from Sarah, and it compounds it: **sending the request gave no confirmation at all.** No "sent", no
thank-you, nothing; reopening the form showed it blank *"as if I'd never written it"*. A card appeared much
later — *"by then I'd already gone and bothered someone about it."* She had just typed something raw and the
app answered with silence. `sarah-after-send-no-confirmation.png`
And the form renders in a **letterbox about two lines tall**, jammed between the verse card and "Continue
reading" — same defect Naomi measured at 108px inside an 844px page.

**The best moment she had in the app was a human being answering her.** She messaged Naomi privately because
she could not tell whether the request had sent; Naomi replied within minutes with Mon/Wed/Fri, no dairy, left
at the door. *"Someone answered me."*

---
## R6-25 — THE ONLY LABELLED WAY TO SEND A MESSAGE IS THE ONE THAT LOSES IT
**Rev Ada, from the console.** The send button *"has no accessible name at all"*, so she pressed Enter instead
— and Enter is the gesture that silently discards messages (R6-6). `ada2-send-button-missing.png`

That is a vicious pairing rather than two separate defects. Anyone who navigates by labels — a screen-reader
user, or simply someone who cannot tell what an unlabelled arrow does — is pushed onto the broken path by the
app's own accessibility gap. Doreen, 78, hit the same thing from the other end: she lost a message to Enter,
then found *"the little paper-plane"* by luck. The working control is the one nobody can name.

## R6-26 — BOTH SIDES OF THE FRONT DOOR WERE BLIND
**Ada, asked directly how she discovered twenty people were queuing: "I went looking. Nothing told me."**
No badge, no count on the Members nav, no banner. She found "Requests to join · 20" by clicking in on a hunch.
`ada2-landing-groups.png` vs `ada2-members-first-look.png`

Then the part that closes the loop with the members' side: the console's one alerting feature, "Notify my phone
on joins", returned **"Notifications are blocked in your browser settings"** when she finally tapped it — and
had never said so before. `ada2-notifications-blocked.png`

Her sentence is the finding: *"the app's only way to reach me was switched off at the browser and it never said
so until I asked. **Sarah pressed that button for twenty minutes into silence.**"*
Admitting all twenty, once found, worked cleanly in one action with a confirm dialog naming everyone.

## R6-27 — "COULDN'T SAVE TO THE RELAY" OVER ACTIONS THAT SUCCEEDED
Marking Chloe as a child took **four attempts over about forty seconds**, throwing "Couldn't save to the relay"
and "this device hasn't finished connecting" — immediately after admitting twenty people had saved perfectly.
Both error banners **stayed on screen after the action eventually succeeded**. `ada2-child-mark-relay-fail.png`
Ada hit the identical false error at setup over three groups that were created fine (R6-4). A steward cannot
tell a real failure from a phantom one, which is the state in which people retry destructive things.

## R6-28 — A CHILD IS OFFERED AS A CANDIDATE FOR DELEGATED STEWARD
**Ada, after marking her.** Chloe, flagged CHILD with a linked parent, appears in the picker for "make someone
a delegated steward". Round 5 found the same shape — a child offered as a candidate for the care team. Two
rounds, two different churches, two different pickers, same omission: **the candidate lists do not know what
the safeguarding records know.**

## R6-29 — THE VOLUNTEER CHAIN FAILS AT THE STEWARD'S END TOO
Ada tried to make Michael a leader of Sidespersons & Welcome and **could not reach his checkbox** in the Group
leaders panel; it saved with no change and the team still reads TEAM · 0. `ada2-leaders-panel.png`
So Michael offered, Margaret could not add him, and Ada could not either. *"Michael's offer is still not taken
up."* Three people, one willing volunteer, no route.
Also: delegated stewards demanded *"Give them a name first"* with the name field scrolled off-screen above.

## THE HARNESS FIX EARNED ITSELF, IN THE FIELD
Ada's console had two chat panels left open from earlier floating over the Members action buttons. The repaired
`tap` refused them and said so — *"COVERED: … NOT tapped"* — instead of reporting success over a press that
never landed. That is precisely the fabrication that cost round 5 two withdrawn findings.
