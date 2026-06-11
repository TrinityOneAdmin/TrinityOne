# TrinityOne — Release Roadmap (versions, not dates)

Version numbers + what each unlocks. Companion to `reference/trinityone-release-roadmap.md` (the
stage-by-stage user/testing journey) and `reference/SPINE.md` (architecture). **Dates deliberately
omitted** — each release ships when its exit gate is met, not on a calendar.

**Scheme:** semver, pre-1.0 = pilot. `0.x` minors are feature themes; patches are fixes/polish.
`1.0` = a church the dev team isn't in can run a full week unaided. Money + federation scale come
*after* 1.0, never before.

**Pilot congregation throughout:** Littlehampton.

| Version | Theme | Stage (codename) | Ships | Exit gate |
|---|---|---|---|---|
| **0.1** | Scripture + identity | 0 · Dogfood | Offline Bible read; self-custodial BIP-39 identity in OS secure store; reader, notes, highlights, plans, devotionals | Core read + identity persist on a real device for a week |
| **0.2** | Fellowship | 0 · Dogfood | Church groups + chat (kind-1), DMs (NIP-04), reactions (kind-7); follow a church by npub | Two phones chat through the relay; identity persists |
| **0.3** | Rota & calendar | 1 · Closed Alpha | Services, rosters, rotas, "can you serve?" requests + replies, events, RSVPs, reminders | A real serving schedule round-trips steward→member→steward |
| **0.4** | Steward console | 1 · Closed Alpha | Real console: groups, rota, members, calendar, resources, relays, backup; church key custody | A steward runs their church from the console unaided |
| **0.5** | Networks + content | 2 · Pilot Beta | Church↔network: create/join, dual-identity publish, network announcements/events/plans aggregated into members' views | A network broadcast reaches a second church's members |
| **0.6** | Onboarding + media | 2 · Pilot Beta | Working invites (QR adopts identity + joins + relay); in-app QR scan; Listen (narrated scripture + church podcast); notifications feed; backup/restore | A non-dev onboards by QR unaided; restores on a new phone |
| **0.7** | Self-hosting | 2→3 · Pilot/Multi | **Relay app** (desktop, double-click): runs the church relay + tunnel via a setup wizard. Multi-church relay already live as the hosted stopgap | A steward stands up their own relay with no code |
| **0.8** | Hardening | 3 · Multi-Church Beta | Stability, scope-clarity, support-load → zero; a second church **self-onboards** end-to-end | 2–3 congregations stable; second church self-onboards |
| **0.9** | Privacy + iOS | 6 · iOS + Privacy | NIP-44 E2E private chat; iOS build; NIP-29 relay-enforced groups (upgrade from NIP-01 allowlist) | Relay verified opaque to message content; App Store approval |
| **1.0** | **Pilot graduation** | — | Everything above, stable, documented; a church runs a full week with no developer in the loop | The 1.0 bar: unaided church, a week, a Sunday, zero firefighting |
| **1.x** | Giving | 4 · Giving Pilot | Lightning giving (NIP-57 zaps, NIP-47 wallet connect), funds/treasury — **money, scoped + reviewed separately** | Money moves correctly, safely, reversibly-understood |
| **2.0** | Network release | 5 · Network Release | Wider church network onboards itself per-church; library catalogue populated; feeds (RSS) | A new church onboards with no developer |

## Where we are now

**~0.6 → 0.7.** 0.1–0.6 are functionally built and on the pilot relay (multi-church hosted). The
open edge is **0.7 self-hosting** — the Relay app wizard (in scope now) — and **0.8 hardening**
(stability + a second church self-onboarding).

## Rules of the road

- Release narrow, prove with real people, widen slowly (`reference/trinityone-release-roadmap.md`).
- Anything touching **keys, relays, or money** is propose-then-go. Giving is post-1.0 on purpose.
- Each version updates this table + the SPINE roadmap; nothing else needs to move.
