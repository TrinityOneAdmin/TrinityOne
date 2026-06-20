# Plugin: Livestream / sermon broadcast

*Post-pilot. Branch `claude/plugins`. Stream a church's service live into members' apps. The cleanest
"obviously paid" plugin — bandwidth/transcoding has real marginal cost, so the price needs no
justification.*

See [`README.md`](README.md) for the plugin seam, and `reference/SPINE.md` → "Live stream (church
services)" (the original roadmap thread this productises) + "Add-ons / plugins".

---

## The idea

A "**Live**" surface in the member app that lights up when the church is streaming — Sunday gathering,
midweek teaching — so members who can't attend in person can join, ideally with the group chat beside
it as a **watch-along**. Distinct from the existing **Video channel** (recorded VOD via the `/feed`
proxy → Watch tab). This is the *live* moment.

## Tiers (cheapest → richest) — ship in this order

**Tier 0 — "Live now" on the existing channel (near-free, do first).**
Most churches already go live on YouTube/Rumble. The `/feed` proxy in `gateway.mjs` detects the active
live item; the Watch tab shows a "● LIVE now" card that auto-opens it. No new infra — just live-state
detection. This is arguably *core*, not a paid plugin (it's just smarter use of the channel they
already set). Ship it free; it makes the paid tiers' value obvious by contrast.

**Tier 1 — "Go live" link + native live surface (light infra).**
A steward pastes a stream/HLS URL (or flips "Go live"); the app shows a native live banner + player and
ties the group chat in as a watch-along. *Nostr:* publish a **NIP-53 live event** (kind `30311`, "live
activity") with status `live`/`ended` + the stream URL; the app renders a Live tab off it. Works with
any platform the church already uses. Still mostly *their* bandwidth — so this is the **entry paid tier**
(we provide the integrated surface + chat, not the pipe).

**Tier 2 — Hosted streaming (the real paid product).**
We run the **ingest + transcode + delivery** so the church doesn't touch YouTube at all — they stream
from OBS / a phone to our endpoint, we transcode to adaptive HLS and serve it to members. This is where
the **marginal cost = clean pricing** lives (per-stream-hour / per-viewer-GB / a monthly tier with an
hours cap). Optionally **self-hostable** on the church's own box (Owncast / RTMP→HLS) for churches that
want zero third-party pipe — the "Cornerstone" hardware story.

## Architecture (plugin form)

Follows the seam in [`README.md`](README.md): the **core ships only the render surface**; the streaming
service is a **separate (paid) service** with its own identity.

```
Streaming service (separate, paid)            Core app (free, AGPL)
──────────────────────────────────           ─────────────────────────────
 ingest (RTMP/SRT from OBS/phone)              reads church 'plugins:' registry → livestream enabled?
   ↓ transcode → adaptive HLS                  subscribes to NIP-53 kind 30311 for this church
   ↓ publishes/updates the live event   ───►   shows a "● Live" tab when status=live
   (kind 30311: status, title, HLS url,        renders HLS player + the linked group as watch-along
    starts/ends, viewer count)                 push: "We're live" to opted-in members (existing VAPID)
   ↓ on end → status=ended, optional VOD ──►   falls back to the recording when the stream ends
```

- **Registry:** church enables "Livestream" in `plugins:<churchpub>`; config carries the service origin
  (for the player/HLS) + which group is the watch-along chat.
- **Identity & grants:** the streaming service authenticates as its **own Nostr key**, granted publish
  rights for kind `30311` scoped to this church (relay write-policy rule keyed off the registry). It is
  **never** given the church key.
- **Render contract:** Tier 0/1 = native event-kind surface (no third-party code in the app). Tier 2
  player is an HLS `<video>`/player pointed at our delivery origin — that origin must be **CSP
  allow-listed per church** (`media-src`/`connect-src`), flowing from the registry. Prefer the native
  surface; the player is just a media element, not an embedded third-party UI.
- **Chat watch-along:** reuse the existing group chat — the live event references a group id; the Live
  tab renders player + that group's messages side by side. Safeguarding rules on the group still apply.

## Build steps

1. **Tier 0** first (free, in core): live-state detection in the `/feed` proxy + a "● LIVE now" Watch
   card. Quick, high-value, sets up the paid contrast.
2. **NIP-53 surface** (the plugin seam): subscribe to kind `30311` for the church; a "Live" tab; the
   watch-along layout (player + linked group). Steward "Go live" control (paste URL / toggle) → publishes
   the live event. This is **Tier 1**.
3. **"We're live" push** via the existing VAPID web-push (opt-in category, like announcements/serving).
4. **Tier 2 hosted ingest/transcode** as a separate service: RTMP/SRT ingest → HLS (e.g. an
   `nginx-rtmp`/`MediaMTX` + transcode worker, or a managed video API behind our origin); it publishes
   the kind-30311 event + serves HLS; metering for billing. Self-host variant (Owncast on the church
   box) shares the same event contract.

## Open questions / decisions

- **How members learn it's starting:** push (Tier-1+) — confirm it's opt-in and not noisy (one "we're
  live" per stream, throttled).
- **Watch-along chat:** combine live + an existing group, or a dedicated ephemeral "live chat" room that
  closes when the stream ends? (Lean: link an existing group; optional ephemeral room later.)
- **VOD hand-off:** on `ended`, auto-publish the recording to the Watch tab (Tier 2 can capture it; Tier
  0/1 relies on the platform's own VOD).
- **Pricing:** per-stream-hour vs monthly hours-cap vs per-viewer-GB. Lean **monthly tier with an hours
  cap + overage** (predictable for a church, covers our delivery cost). Bundle with hosted relay?
- **Privacy:** a church stream may include minors on camera — keep streams **church-scoped** (members of
  that church, behind the relay's read-gate where possible) rather than a public URL by default; public
  is an explicit choice.
- **Bandwidth reality:** adaptive HLS + a CDN in front for Tier 2 (delivery cost dominates) — model the
  per-viewer cost before pricing.

## Reuse / touchpoints

- `gateway.mjs` `/feed` proxy (Tier-0 live detection), VAPID web-push (the "live" category), the Watch
  tab + `DashMediaPanel` (steward channel config), group chat (watch-along), the relay write-policy
  (scoped publish grant for the streaming service's key).
