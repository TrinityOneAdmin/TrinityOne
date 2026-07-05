# Safeguarding in TrinityOne — a guide for elders & safeguarding officers

*Last updated 2026-06-19. Covers v1 (steward-anchored), v2 (parent-linked + steward-linked child accounts), and kids check-in.*

This is for the people responsible for safeguarding in your church — elders, trustees,
your designated safeguarding lead (DSL). It explains, in plain terms, **what TrinityOne
does to protect children and young people, how to set it up, and — just as importantly —
what it does *not* do.**

> **The one thing to hold onto:** TrinityOne's child-safety features **support** your
> church's safeguarding — your policy, your background checks, your trained leaders, your
> supervision of activities. They **do not replace any of it.** A good app cannot make a
> church safe; safe people and good practice do. This tool is there to make the *digital*
> side line up with the care you already take in person.

---

## Why our approach is different

Most apps try to keep children safe with a tick-box: "Are you over 18?" That is worthless.
A predator ticks "adult"; a curious child unticks it. Self-declared age protects no one.

TrinityOne's advantage is simple: **a church knows its people.** You know who the children
are. You know which adults are background-checked and cleared to work with young people. So instead
of trusting a stranger's tick-box, the protection is anchored in **your** knowledge, applied
by **your** steward, and it mirrors decisions you have *already* made in the real world.

---

## What it does, in plain English

There are three building blocks. Your steward sets all of them up in the steward console.

1. **Marking who is a child.**
   In the **Members** list, the steward marks each under-18 as a **Child**. (Nothing about
   this is shown to other members as a public badge — it changes what *that account* can do
   and see.)

2. **Marking which adults are cleared to work with young people.**
   Also in **Members**, the steward marks the adults who are **cleared for youth**. This list
   should **mirror your real cleared-worker list** — the same people your policy already
   trusts with children. No one is cleared by default.

3. **Marking which groups are child-safe.**
   Each chat group has a **Child-safe** switch. Turn it on for the groups children are meant to
   be in (e.g. *Youth*, *Whole Church Notices*). Leave it off for adult spaces.

From those three lists, two protections follow automatically:

### Children only see child-safe groups
A member marked as a child will **only see and join groups you've marked child-safe.** Adult
groups simply don't appear for them. There's nothing for them to stumble into.

### Private messages between a child and an adult are blocked — unless that adult is cleared
This is the heart of it. A one-to-one private message (a "DM") **between a child and an adult
is not allowed** — *unless that adult is on your cleared-for-youth list.*

- A cleared youth leader **can** message a young person (e.g. to arrange a lift to camp).
- Any other adult **cannot** — the message is refused.
- This works **both ways**: a child can't message a non-cleared adult, and a non-cleared
  adult can't message a child.
- Two children can't privately message each other either (neither is a cleared adult).
- Your **steward/church account is always reachable** — a child can always message the church,
  and the church can always reach a child.

In the app, a child (or a non-cleared adult) trying to start a blocked conversation simply
sees a gentle note: *"For safeguarding, private messaging is limited here. Speak with your
church leaders if you need to get in touch."*

---

## Why you can trust that the block actually holds

A safeguarding feature is only worth anything if it can't be switched off by a determined
person fiddling with their phone. TrinityOne's DM block is **enforced on the relay** — the
small server your church runs that carries the messages — **not just in the app.**

That matters: even if someone installed a modified app, sideloaded a different client, or
tried to craft a message by hand, **the relay refuses to deliver it.** The rule is applied at
the point messages pass through, in both directions, on sending *and* on retrieval. The app's
own restrictions (greying out the message button, hiding adult groups from children) are a
helpful second layer on top — but the real lock is on the server.

The lists that drive all this are **signed by your church's key**. Only your steward can
change who is a child, who is cleared, or which groups are child-safe.

---

## Setting it up — a checklist for your steward

1. Open the steward console → **Members**.
2. For every child/young person in the church, tap **Child**.
3. For every adult who is **background-checked and cleared to work with young people**, tap
   **Clear for youth**. Keep this list matched to your real cleared-worker list — review it
   whenever someone's clearance starts or ends.
4. Go to **Groups**. Turn **Child-safe** on for the groups young people belong in. Leave it
   off everywhere else.
5. Spot-check: ask a young person (or a test account you've marked as a child) to confirm they
   only see the right groups and can't message adults who shouldn't be messageable.

> **Keep it current.** These lists are only as good as the day they were last reviewed. When a
> young person turns 18, when a new leader is cleared, or when a leader stands down — update
> the lists. Build it into your existing safeguarding review rhythm.

---

## What this is **not** — please read this

We would rather under-promise. The following are **your church's responsibility, not the
app's**:

- **It is not a substitute for background checks, training, or your safeguarding policy.** The
  "cleared for youth" list should *reflect* your real checks — it does not perform them.
- **It does not supervise relationships.** A cleared leader can still message a young person;
  the app trusts your clearance. Normal safeguarding practice (avoiding one-to-one private
  contact where your policy says so, transparency, accountability) still applies online.
- **It cannot verify someone's age or identity for you.** It applies *your* decisions. If a
  child is never marked as a child, they aren't protected by these rules — so accurate, prompt
  marking matters.
- **It does not monitor the *content* of messages.** Private messages are encrypted for
  privacy. The app controls *who may message whom*, not *what is said*. Concerns about the
  content of a conversation are handled the way they always have been — through your DSL.
- **It is one church's pilot today.** This is an early version (v1). It's deliberately simple
  and conservative. Treat it as a helpful guardrail, and keep your existing practices fully in
  place.

If you are ever unsure, follow your safeguarding policy and speak to your DSL or the relevant
statutory body. Nothing here changes your legal duties.

---

## A note on privacy

For the relay to enforce the rules, it needs to know which accounts are children and which
adults are cleared. Within a single church — where everyone is already known to one another —
this is appropriate and expected. The lists are not published publicly to the wider internet,
but they are readable by your church's own relay and app. We'll strengthen this further as the
product grows beyond a single congregation.

---

## Parent-linked child accounts

A parent can **set up and look after their child's account** from inside their own app
(*You → My family → Children's accounts → Add a child*). This is the recommended way to bring a
younger child onto TrinityOne.

How it works:

1. The parent enters the child's name. The app creates a brand-new account for the child and
   shows the parent the child's **12 recovery words** plus a **one-scan login QR**.
2. The parent writes down the recovery words (they're the only way to restore the child's
   account) and, when the child has a device, scans the QR on the child's phone to sign them
   in and join them to the church.
3. The parent's request to be linked appears in the steward's **Members** tab as *"Parent /
   child links to confirm"*. When the steward **Confirms** it, the child is marked as under-18
   and the parent↔child link is recorded.

What the link gives you:

- **The parent can always privately message their own child**, and the child can message their
  parent — even though the parent isn't on the church's general "cleared for youth" list.
  (Being a parent clears you for *your own* child, **not** for other people's children — that
  still requires being cleared for youth.)
- The child is reliably marked as under-18, so all the protections above (child-safe groups
  only, blocked adult DMs) apply to them.

The steward still confirms every link — so a parent can't quietly attach themselves to a child
who isn't theirs. The parent holds the child's recovery words, which is what "owning" the
account means here; nothing about the child's secret key is stored on anyone else's device.

### Two routes to the same link

- **Parent-led (above).** The parent creates and holds the child's account and requests the
  link. Best for a **young child with no device** — the parent truly *owns* the account.
- **Steward-led.** For an **older child or teen who joined on their own device**, the parent
  needn't do anything. On the child's row in **Members**, tap **Link parent** and pick the
  parent from your members. The child keeps their own account; you're just recording who their
  guardian is. (Only adults — not other children — can be picked; these actions are owner-only.)

### A child can have **no** linked parent — and that's fine

A guardian link is **optional**. A youth-club child whose parents don't attend simply has no
parent to link — mark them **Child** and leave it. They're still fully protected: only
**cleared** youth workers (and the church) can message them, and they only see child-safe
groups. The link only adds *"this one specific adult can also always reach them."* A quiet
**"no guardian"** tag on the child's row makes that state visible at a glance.

> **Still coming:** automatic family grouping across siblings, and letting a parent manage the
> child's account fully from their own phone without a second device.

---

## Kids check-in  *(optional)*

Turn it on in **Settings → Congregation features → Extras → Kids check-in**, and the console
gains a **Check-in** tab for running a children's session safely:

1. **Check a child in** from your **Child**-marked members (their linked guardians are shown).
   The app generates a **4-digit pickup code**.
2. Give the parent/guardian that code — written on a slip, as with any printed check-in label.
3. At collection, **Check out** and **enter the code on their slip** before releasing the
   child. A code that doesn't match is refused, so a child isn't handed to the wrong person.

Check-in records — who's present, and the codes — are **encrypted to your church key**: they
never reach the relay or other members in readable form. v1 is run from the **church-key
holder's** console. Like everything here, it's a digital aid to your in-person practice
(signing-in, ratios, supervision), **not** a replacement for it.

---

## Questions an elder might ask

**"Can a stranger from the internet message one of our children?"**
No. Only people who have **joined your church** can message anyone in it at all, and a child
can only be privately messaged by an adult **you** have cleared for youth work.

**"What if a youth leader leaves or loses clearance?"**
Have your steward remove them from **Clear for youth**. From that moment the relay stops
letting them privately message young people.

**"Our youth worker needs to message a teenager about a lift. Can they?"**
Yes — once that worker is marked **Clear for youth**, those messages work normally.

**"Could a tech-savvy teenager get around the block with a different app?"**
The block is on the server, not the app, so a different or modified app makes no difference —
the message is still refused.

**"Does this mean we can relax our usual safeguarding?"**
No. It's a guardrail on the digital side. Your policy, training, background checks and supervision
remain exactly as essential as before.

**"How does a parent add their child?"**
In their own app: *You → My family → Children's accounts → Add a child*. They save the child's
recovery words and the link shows up for the steward to confirm. See *Parent-linked child
accounts* above.

**"Could a parent attach themselves to a child who isn't theirs?"**
No — every parent↔child link has to be **confirmed by the steward** before it does anything.
