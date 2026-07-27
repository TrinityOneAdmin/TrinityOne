# Plugin: Event ticketing

*Post-pilot. Branch `claude/plugins`. Paid (and free-but-registered) events — camps, conferences,
men's breakfast, the Christmas concert — with sign-up, payment, capacity and check-in.*

See [`README.md`](README.md) for the plugin seam. Sits on top of the existing **Calendar/Events** + the
core **Lightning Giving** rails.

---

## The idea

A church runs an event that needs more than a casual RSVP: a **camp** with a fee and a cap, a
**conference** with sessions, a **concert** with tickets. Members (and the public) register, pay if
there's a fee, get a ticket (QR), and are **checked in** at the door. It extends today's
Going/Maybe/Can't RSVP into real ticketing.

## Why it's a fair paid plugin

It's where **money + logistics** meet: payment handling, capacity management, ticket issuance, check-in.
A church will gladly pay a small platform fee (or per-ticket) for the convenience — and because real
money moves, the value is obvious. (Contrast: casual event RSVP stays **free/core** in the Calendar;
ticketing is the paid step up.)

## Architecture (plugin form; reuses Calendar + Giving)

```
Ticketing (plugin: thin service + core surfaces)
────────────────────────────────────────────────
 Event (existing calendar event)  + ticketing config: { tiers[], price, capacity, public? }
 Register → ticket request          → ticket event (encrypted holder details to church key)
 Pay (if fee) → core Lightning      → paid via the member's own wallet (NIP-57 / lud16) — non-custodial
 Ticket issued → signed QR          → in-app ticket + QR; capacity decremented
 Check-in → scan QR at the door      → existing kids-checkin-style scan flow, marks attended
```

- **Builds on the Calendar.** A ticketed event is a normal calendar event with a **ticketing config**
  (church-signed extension to the event doc: tiers, price, capacity, public flag). Free events keep the
  plain RSVP; ticketing is opt-in per event.
- **Payment = core Giving rails (key point).** Because **Lightning giving is core and non-custodial**,
  ticket payment rides the member's **own wallet** straight to the church's receiving address (`lud16`)
  — **we never hold the money.** The plugin's job is correlation (payment → ticket issued), not custody.
  That keeps us out of money-transmitter / custody territory and reuses what's built.
- **Ticket = signed token + QR.** On payment (or free registration), issue a ticket the holder shows;
  the QR is verifiable. **Check-in reuses the existing kids check-in scan flow** (secure code/QR scan →
  mark attended) — same UX, retargeted to event tickets.
- **Capacity & waitlist:** the church-signed event holds the cap; the ticketing service (or the console)
  tracks issued count and closes/​waitlists at capacity. Holder PII (name/contact/dietary/medical for a
  camp) is **encrypted to the church key** — same model as Treasury/Forms.
- **Public events:** a public link/QR (gateway-served, like Forms) lets non-members buy a ticket and pay
  by Lightning, then optionally onboard them. Anti-abuse as in Forms.
- **Identity & grants:** the ticketing service has its own key + scoped grants; never the church key.
  Money flows member→church directly (non-custodial); the service only reads payment confirmations to
  release tickets.

## Build steps

1. **Ticketing config** on calendar events (tiers/price/capacity/public) + the register flow.
2. **Payment correlation** to the core Lightning wallet (member pays own→church `lud16`; confirm →
   issue). Free-event path skips payment.
3. **Ticket + QR issuance**; capacity/waitlist tracking.
4. **Door check-in** reusing the kids-checkin scan flow (mark attended; live attendee count).
5. **Public ticket page** (gateway-served) + onboarding handoff (cf. Forms/migration).
6. **Reporting:** attendees, revenue (into Treasury if enabled), dietary/medical for camps (encrypted).

## Open questions / decisions

- **Fee model:** flat platform fee per event vs small per-ticket fee. Since payment is non-custodial we
  **can't** skim the Lightning flow cleanly — so charge a **platform/plugin fee** (enable ticketing for
  £X/event or a tier), not a cut of ticket sales. Cleaner legally and ethically.
- **Refunds/cancellations:** non-custodial payment means refunds are church→member directly — the
  plugin tracks status, doesn't move money. Define the flow.
- **Camp data (minors):** medical/consent/dietary for under-18s is **safeguarding-grade** PII — encrypt
  to the church key, owner-only, with retention/delete controls (cf. Forms).
- **Non-Lightning payment:** some will want card — out of scope for v1 (stay non-custodial / Lightning).
  Could later integrate a church's own Stripe via a separate arm's-length pay-link (church holds the
  Stripe account; we never touch funds).
- **Relationship to Giving:** keep the line crisp — **casual RSVP = free Calendar; paid/ticketed =
  plugin; the payment rail itself = core Giving.**

## Reuse / touchpoints

- Calendar/Events (`screens-serving.jsx` events, the church-signed event docs), **core Lightning Giving**
  (`giving-ln.jsx`/`TrinityLN` + church `lud16` — stays core), the **kids check-in** scan flow (door
  check-in), NIP-44 encrypt-to-church (holder PII), the gateway (public ticket page), Treasury (revenue
  reporting, if enabled).
