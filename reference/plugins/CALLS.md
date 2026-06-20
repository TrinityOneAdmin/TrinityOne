# Plugin: Prayer & meeting calls

*Post-pilot. Branch `claude/plugins`. Audio/video rooms for prayer meetings, small groups, and elders'
calls — inside TrinityOne, privacy-respecting, no Zoom account.*

See [`README.md`](README.md) for the plugin seam. Sibling of [`LIVESTREAM.md`](LIVESTREAM.md) (one is
*broadcast*, one is *conversation* — share infra thinking but keep separate).

---

## The idea

A church can start a **live call room** — "Tuesday prayer", a small-group catch-up, an elders' meeting —
and members join from the app. Two-way, many-to-many (unlike livestream's one-to-many). No external
account, ties into the group it belongs to.

## Why it's a fair paid plugin

Real-time media has genuine **marginal cost**: a relay/SFU (Selective Forwarding Unit) for group video,
TURN servers for NAT traversal, and bandwidth that scales with participants × minutes. Charging is
honest — you're paying for the calling infrastructure, priced per-minute / per-participant or a monthly
tier.

## Tiers (cheapest → richest)

- **Tier 0 — audio prayer room (lowest cost).** Voice-only, small groups. Audio is far cheaper than
  video; a good entry tier and often all a prayer meeting needs.
- **Tier 1 — small group video** (≤ ~8–12 via an SFU). The core paid product.
- **Tier 2 — larger meetings / webinar mode** (one-to-many with hand-raise) — overlaps livestream;
  consider sharing infra.

## Architecture (plugin form)

The core ships only the **room surface**; the media (SFU/TURN) is a **separate paid service**.

```
Calling service (separate, paid)              Core app (free, AGPL)
─────────────────────────────────            ─────────────────────────────
 SFU (e.g. LiveKit/mediasoup/Janus)           church 'plugins:' → calls enabled?
 + TURN (coturn) for NAT traversal            subscribes to NIP-53 'room' events (kind 30311/interactive)
   ↑ WebRTC media                             shows a "● Live call" card on the linked group
 issues short-lived join tokens        ◄───►  "Join" → WebRTC to the SFU using a scoped token
 publishes/updates the room event             in-app call UI (mute, leave, participant list)
```

- **Signalling over Nostr.** The room's existence/state is a **NIP-53 live event** (kind `30311`,
  "live activity" / interactive room) published by the calling service for the church; the app renders a
  "join" surface. The actual **media is WebRTC** to the SFU (not over Nostr — Nostr just announces +
  coordinates). NIP-100 (WebRTC-over-Nostr signalling) is an option for serverless 1:1 but **doesn't
  scale to group** — use an SFU for anything multi-party.
- **Identity & grants.** The calling service has its **own Nostr key**, granted publish rights for the
  room kind scoped to the church (relay write-policy, keyed off the registry). It issues **short-lived,
  scoped join tokens** to members the church admits — never the church key.
- **Auth = church membership.** Only members of the church (and of the room's group) may join — gate the
  join-token issuance on the relay's membership + the group's roster. **Safeguarding applies**: a room
  on a child-safe group inherits the minor/approved rules; a child can't be pulled into an adults' room.
- **CSP.** WebRTC needs `connect-src` for the SFU/TURN endpoints — allow-list per church from the
  registry. No third-party UI embed needed (the call UI is native), so no `frame-src` relaxation.

## Build steps

1. **Stand up an SFU + TURN** (LiveKit is the pragmatic choice — open-source, self-hostable, good
   tokens/SDK; or mediasoup for full control). One deployment serves many churches, namespaced by room.
2. **Room event + render surface:** publish kind-30311 room state for the church; app shows a "live
   call" card on the linked group + a native call screen (join/mute/leave/participants).
3. **Token issuance** gated on relay membership + group roster + safeguarding; short-lived.
4. **"Call starting" push** via the existing VAPID web-push (opt-in category).
5. **Self-host variant:** the SFU can run on the church's **Cornerstone box** for a church that wants
   its calls on its own hardware — same room-event contract.

## Open questions / decisions

- **SFU choice:** LiveKit (fastest path) vs mediasoup (most control) vs Jitsi (turnkey but heavier).
  Lean **LiveKit**.
- **Recording:** offer call recording (→ storage cost, another tier) or keep calls ephemeral by default
  (better for prayer/pastoral privacy). Lean **ephemeral default**, recording opt-in + clearly flagged.
- **Scheduling:** ad-hoc "start now" vs scheduled (ties into the Calendar) — scheduled rooms are nicer
  for "Tuesday prayer". Could publish a future room event the Calendar surfaces.
- **Pricing:** per-participant-minute vs monthly tier with a minutes cap. Lean monthly cap + overage.
- **Pastoral privacy:** calls can be sensitive — default to **church-scoped, members-only, ephemeral**;
  no public rooms.

## Reuse / touchpoints

- Group chat + roster (rooms attach to a group; safeguarding inherited), VAPID web-push (the "call"
  category), relay write-policy (scoped room-publish grant + membership-gated token issuance), the
  Calendar (scheduled rooms). Shares media-infra thinking with [`LIVESTREAM.md`](LIVESTREAM.md).
