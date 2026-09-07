# SIM round 4 — findings (2026-09-07)

Church: **SIM Riverside Chapel** `1093a69c…`, created on `a1e7eb2` (the deployed build plus the two
bug fixes, the banner fix and console help). Relay :8000, restarted 08:47:55, newer than gateway.mjs.

---

## R4-1 — a new church dead-ends in its own setup wizard (found during setup, before any agent)

**What happens.** The setup wizard's "Your regular meetings" step cannot save:

> "Couldn't save your meetings — the relay didn't accept them. Check you're online and try again;
> your rows are still here."

Pressed twice, minutes apart. The step offers **Back** and **Add 2 & continue** — no skip. Escape does
not dismiss it, and the dashboard behind is covered (`elementFromPoint` returns a DIV, not the tab).

**It is not the relay.** Nothing from this church appears in `relay/rejected.log`; the relay was never
offered the write. Everything else in the same wizard saved fine — profile, join policy, three rooms and
their group keys, seven documents in all.

**Mechanism, read in the code and matched against the relay.** The church has **no name key**:

    namekey 0 · carekey 0 · financekey 0 · checkinkey 0 · service 0 · event 0   (7 events total)

The calendar publishers on this branch seal through `_sealChurchDocReady`, which waits for the church
name key and **bails rather than writing a gathering in the clear** — that is the 2026-09-05 fix working
exactly as designed. But the name key is only ever minted by `ensureNameKeyForMembers`, and every caller
is in the Members area (`stew-dashboard.jsx:547, :4826, :4864`). The setup wizard never reaches it, and
`_ensureNameKeyLocked` additionally refuses to mint on an unestablished view (`!_nameKeyChecked ||
!_isRelayAuthed()`). So a brand-new church has no name key, and the calendar step can never succeed.

**Severity — bounded, and lower than it first looks.** Reloading the page escapes the wizard entirely:
the church is intact and the dashboard works ("SIM Riverside Chapel" renders, all tabs present). So this
is not a permanent blocker.

But: it is the FIRST thing a new church does, it fails with an error implying the network is at fault,
it offers no way forward, and the escape is "reload the page" — which the message never suggests and a
non-technical person would not think to try.

**Honest note on attribution.** The sealing fix is right and should not be reverted; writing a
gathering in the clear is worse than this. What is missing is that setup never mints the key the sealed
publishers need. Round 3's R3-11 ("nothing reached the calendar, rota or resources all round") was
attributed to the driver's typing bug; this suggests at least part of it was this instead. I have not
proved that, and the driver bug was independently real.

**Not established:** whether the same dead-end occurs on a church created against a relay where the
console is already authenticated differently, and whether the wizard's other steps that publish
(rota, run sheets) share it.

### R4-1, second-order effect — checked and NOT a separate defect

Immediately after escaping the stuck wizard by reloading, `window.Steward.npub` and `.pub` were both
empty while `identities()[0].pub` correctly held the church key — so `joinUrl()` produced
`?follow=&relay=…` with no church in it, i.e. an invite nobody could join through.

A second clean reload + unlock restored it: `npub1zzf6d8q2z0u37…`, and the join link carries the church.
So this was a consequence of leaving the wizard mid-flight, not an independent bug. Recorded because an
empty invite link would be a pilot blocker if it were persistent — and because the first reading looked
exactly like one.

---

## R4-2 — "Help run a church" leaves you in a console indistinguishable from owning one

The 9501 agent tapped "Help run a church", got a steward name and code, set a PIN, and landed on a
console it described as:

> "Steward console dashboard appeared immediately … church appeared without waiting for vicar!
>  Church code: npub1fzyfcmdl6…dy0e5y … Finance tab visible … Settings visible"

It then filed three findings: the relay is down, Finance permissions are bypassed, and the church
arrived without a grant. **All three are false**, and I checked each:

- the relay was up throughout (`/status` ok, 4h uptime);
- `identities()` on that console shows `kind: "church", pub: 48889c6d…` — **its own** church, not
  Riverside Chapel (`1093a69c…`), with `actingChurch` empty. Finance is correct for an owner;
- the relay holds **no stewards document at all** for Riverside — the vicar had not added anyone.

**The real finding is what made all three plausible to a careful reader.** A person who asks to help
run a church is left in a console that is identical to owning one: the same "Your Church" heading, every
tab including Finance and Settings, and **their own npub presented as "Church code"**. Nothing on screen
says "you have asked to help — you are waiting for the owner". The only clue is a relay status of
"Down", which is about a different thing entirely and is itself misleading (that console's own empty
church cannot publish — R4-1's shape).

This is R3-1's symptom surviving R3-1's fix. Discovery now works — I proved that on the console that was
actually stranded — but the WAITING state is still indistinguishable from the arrived state. Round 3's
agent misread it, and so did this one, independently.

**What it costs a real person:** they believe they are in, start working in an empty church that cannot
publish, and conclude the app is broken. The owner meanwhile sees nothing and thinks the job is done.

**Cheap fix, on the evidence:** the waiting console should say it is waiting, name the church it asked
to join if it knows it, and not present the person's own key as a "church code".

---

## R4-3 — Full-screen pages read as traps. Fourth independent instance.

Not a defect in any single screen. A pattern, and the evidence is now strong enough to act on.

**Round 3:** two members independently called Help "a navigation trap … covers all tabs with no clear
close button". A third called the Search tab a trap: "an absolute-positioned fullscreen div covers them,
preventing any tab switching."

**Round 4, today:** the 9510 member reported "a content overlay div completely covers all navigation …
the app is essentially unusable". The 9502 steward reported the console's new Help "lacks a visible
close button — users must use browser back navigation, which is not intuitive."

**What is actually true, screenshotted (`9510-blocked.png`):** the member had opened **Serving**, which
is a full-screen page — back chevron top-left, its own sub-tabs (Serving · Rota · Events · Calendar),
and an honest empty state: "Not shared with you yet — Your church may already have a full rota, it isn't
shared until a steward approves you." The bottom tab bar is in the DOM but not on screen, which is
correct for a full-screen view. The covering element is `position: static`, `zIndex: auto`, transparent
— ordinary page content, not a modal.

So each individual report is wrong, and I have withdrawn each. **But four users across two rounds, on
three different screens, all concluded they were stuck.** One of them was deliberately playing a
less-confident person; the others were not.

**The common factor:** a full-screen view replaces everything, and its only exit is an unlabelled `‹`
chevron in the corner. Nothing says "back", nothing names what you would go back TO, and the navigation
you were using a moment ago is gone.

On a phone this is softened by the OS back gesture (I verified that works). In the console, and for
anyone who does not think to swipe, the chevron is the whole affordance.

**Cost:** the people who hit this hardest are the ones already lost — it is why they opened Help or went
looking through tabs in the first place. Withdrawing four false bug reports does not make the confusion
that produced them false.

**Cheapest change on this evidence:** give the chevron a visible word, and name the destination
("‹ Today", "‹ Console"). The console Help dialog additionally has no Escape-visible close at all.

### R4-3 corroborated — a fifth instance, and a second on the SAME screen

The 9514 rota volunteer, independently and without seeing 9510's report:

> "Navigation Bug — When in Serving section, content div overlays tabs at bottom (Community, Library,
> You), making them untappable. User cannot navigate between main sections without workarounds or page
> reload."

Same screen as 9510, same conclusion, reached separately. Five reports now, across two rounds, four
screens (Help ×2, Search, Serving ×2), from agents who could not see each other's work.

I have verified the mechanism is not a stuck overlay — it is a full-screen view behaving correctly, and
its exit is an unlabelled chevron. But the consistency of the misreading IS the finding. When five
independent users on four screens all conclude they are trapped, the screens are not communicating that
there is a way back.

Note the same agent reports a genuine success worth keeping: "Marked unavailable for Sep 13, then undid
it — works correctly."

---

## R4-4 — "Ask for help is not discoverable" — WITHDRAWN, and it is correct behaviour

The 9512 member reported a "critical blocker": the Care / "Ask for help" feature "is not discoverable in
the UI", root-caused to "Prayer room opens as an overlay that covers and blocks the bottom navigation
tabs", and listed six tasks as blocked by it.

Checked, and both halves are wrong:

- **The tabs were reachable.** Measured on that very browser: Today, Read, Community, Library and You all
  at y=773 and all `clickable: yes`. Nothing was covering them.
- **The feature is absent on purpose.** SIM Riverside Chapel's profile carries `features: {}` — care has
  not been switched on for this church. The member's Today screen shows What's happening, Verse of the
  day and the reading plan, and no "Practical care" card. In round 3's church, which HAD care enabled,
  that card was present and said "Ask for help — Tell your care team what would help — privately."

So the app hid a feature the church has not enabled, which is right, and the member could not find a
thing that was not there.

**Worth keeping from it anyway, as a product question rather than a bug:** a member in genuine need sees
nothing at all — no "your church hasn't set this up" and no route to ask a human. Whether that silence is
correct is the owner's call (the standing rule is ship the mechanism, not the policy, and not advertising
what a church has not chosen is consistent with that). Recorded as a question, not a defect.

---

# Round 4 — reliability note on the agents themselves

Six member/steward agents have reported, and **four filed confident "critical" findings that were their
own misreadings**: the relay being down (it was up, 4h uptime), Finance permissions bypassed (their own
church, so correct), the app being unusable behind an overlay (a working full-screen page), and Care
being undiscoverable (not enabled by that church). Each took several minutes to disprove against the
relay database or the live DOM.

That is the honest yield of simulated testing: it exercises paths well and interprets them badly. The
pattern in the misreadings is itself the round's most valuable output (R4-3), but every individual
"critical" needs checking against ground truth before it goes anywhere near a fix list.
