# TrinityOne — Release & Testing Roadmap (User-Facing)

Companion to the technical build spec. This document describes the journey from a **user's** position: what people can actually do at each stage, who's testing, how each release is gated, and what "done" looks like before money and the wider network come into play.

**Guiding rule for a community of mostly non-technical congregants:** release narrow, prove it with real people, widen slowly. Never expose a stage to grandparents that the dev team hasn't lived in for a week. Money and federation scale come *last*, not first.

Pilot congregation throughout: **Littlehampton** (your home church) as the first real-world testbed.

---

## Stage map at a glance

| Stage | Codename | Who's in | What they can do | Gate to exit |
|---|---|---|---|---|
| 0 | **Dogfood** | You + 1–2 technical helpers | Everything, on test data | Core flows work on a real device, daily, for a week |
| 1 | **Closed Alpha** | ~5 trusted, semi-technical members | Join, read, broadcast, chat | No data loss; onboarding works unaided for 1 non-dev |
| 2 | **Pilot Beta** | One full congregation (Littlehampton) | Real church comms, daily use | A real Sunday/week runs on it without you firefighting |
| 3 | **Multi-Church Beta** | 2–3 congregations | Network broadcasts between churches | Cross-church sync stable; a second church self-onboards |
| 4 | **Giving Pilot** | Littlehampton only, tiny amounts | Give to church; receive a disbursement | Money moves correctly, safely, reversibly-understood |
| 5 | **Network Release** | Wider church network | Full comms + giving, per church | Onboarding a new church needs no developer |
| 6 | **iOS + Privacy** | All, both platforms | E2E private chat; iPhone users | App Store approval; E2E verified opaque to relay |

---

## Stage 0 — Dogfood (internal)

**User experience:** only you and a helper or two. You use the real device build (not just the browser) every day on throwaway accounts and a test church group.

**What must work:** generate identity → see your name → post a congregation broadcast → others see it → group chat → kill the internet, post, restore, confirm it reconciles.

**Testing focus:**
- Install the APK on at least two *different* physical Android phones (not just your dev machine / emulator).
- Force-quit and relaunch — does the identity persist from secure storage every time?
- Airplane-mode test: local writes survive and sync on reconnect.

**Exit gate:** a week of daily use with no key loss, no "where did my message go," no relay crash you couldn't recover from. **The NIP-29 relay is the thing to watch here** — if it's flaky, stay in Stage 0 and don't drag real people into it.

---

## Stage 1 — Closed Alpha (~5 trusted members)

**User experience:** five people you trust and who'll forgive rough edges. Mix in at least **one genuinely non-technical** person — they are the real test.

**What they can do:** self-onboard *or* be steward-onboarded by QR, set a display name, read and post congregation broadcasts, take part in group chat.

**Testing focus — onboarding is the headline:**
- Can the non-technical person get in **without you touching their phone**? Watch them do it silently. Every place they hesitate is a UI fix.
- Recovery drill: have someone "lose" their phone (use a second device), recover from their 12-word phrase. If recovery is confusing now, it's a disaster at scale later.
- Steward-issued QR path: a leader generates and hands off an identity cleanly.

**Exit gate:** one non-developer onboarded and posting unaided; one successful recovery; a week with no lost data. Collect the top 5 confusion points and fix before widening.

---

## Stage 2 — Pilot Beta (one full congregation)

**User experience:** Littlehampton, properly. This is where it stops being a tech demo and becomes *your church's actual noticeboard and chat*. Announcements, prayer requests, "anyone got a lift to the Tuesday meeting," the real texture of congregation life.

**What they can do:** everything in §6 of the spec's MVP — congregation broadcast (stewards), congregation chat (everyone), all on the tiered relay with the local box running.

**Testing focus:**
- **Stand up the local box** (church Pi/mini-PC) and run real traffic through it with backbone sync. This is the first real test of the resilience tier.
- **Load & rhythm:** a whole congregation posting around Sunday is a different load profile than 5 alpha users. Watch relay behaviour around peak.
- **Steward workflow:** can leaders add/remove members and post broadcasts without you? Write them a one-page "how to run TrinityOne for your church" sheet — if you can't, the UX isn't ready for Stage 5.
- **Support load:** track how often someone needs help. That number must trend toward zero before you add more churches.

**Exit gate:** a real church week (including a Sunday) runs on TrinityOne without you actively firefighting, and stewards manage membership themselves.

---

## Stage 3 — Multi-Church Beta (2–3 congregations)

**User experience:** a second (and third) congregation joins. Members now see **two scopes**: their own church's traffic, and network-wide broadcasts from across the federation. The "we're part of something bigger" moment.

**What they can do:** everything from Stage 2, plus receive **network broadcasts** (steward-sent), and stewards of the network can post to all churches.

**Testing focus:**
- **Federation sync under real conditions:** does a network broadcast from Church B reach Church A's members promptly via backbone → local boxes? Latency, ordering, duplicates.
- **Scope clarity:** do users understand what's "our church" vs "the whole network"? Mis-scoped posting (a local notice blasted network-wide) is a UX problem to design against, not just train away.
- **The decisive test: can a new church onboard itself** with the steward sheet and minimal hand-holding? If a second church needs *you* to stand up its box and groups, Stage 5 isn't ready.
- Steward-only network broadcast permission (your confirmed default) actually enforced at the relay.

**Exit gate:** cross-church broadcast is reliable; a congregation other than your own gets running with the docs, not the developer.

---

## Stage 4 — Giving Pilot (Littlehampton, tiny amounts)

**User experience:** giving appears, **only in your home church, only with trivial sums** at first (think £1–£5 / a few hundred sats). Members can give to the church inside the app; a steward can send a disbursement to a member. This is the first time real money moves, so it gets its own slow, deliberate stage.

**What they can do:** give to the church (NIP-57 zap to the church Lightning Address); stewards disburse to a member's address via the treasury (NWC).

**Testing focus — money demands more care than comms:**
- **Smallest-amount-first:** prove the give-to-church and church-to-member flows with tiny sums before any real giving.
- **Treasury safety:** confirm the hot wallet holds only a small float, reserves are cold, and the NWC connection is budget-scoped. Test what happens at the budget limit.
- **The unhappy paths:** failed payment, expired invoice, recipient address typo, app closed mid-payment. Users must never be left unsure whether money moved.
- **Receipts & trust:** can a giver and a steward both *see* that a gift succeeded (zap receipt)? Financial trust lives in visible confirmation.
- **Onboarding sats:** decide and test how a member with no bitcoin participates (bring-your-own-sats / peer top-up). Keep any KYC onramp out of this pilot.

**Exit gate:** dozens of small real transactions, both directions, with correct receipts and clean failure handling — and a steward comfortable running the treasury. Only then raise amounts.

---

## Stage 5 — Network Release (wider church network)

**User experience:** the network opens to the broader fellowship. New churches join, each financially and operationally sovereign (own local box, own treasury), all sharing the federation backbone for network-wide life.

**What they can do:** full MVP comms + giving, per church, across the network.

**Testing focus:**
- **Self-service onboarding at scale:** a new church should get running from documentation + steward training alone. Your involvement per new church should be ~zero.
- **Backbone capacity:** more churches = more sync and network traffic. Watch the backbone; add a second backbone instance before you need it (the topology already allows 1–2).
- **Support model:** by now support should be steward-to-steward, not everything routing to you. A "network steward" group and a shared troubleshooting doc matter more than code here.
- **Rollback ready:** keep the tag-based fallback (spec §5.2) understood and reachable in case a NIP-29 issue surfaces at scale.

**Exit gate:** two or more churches onboarded without developer involvement; backbone stable under combined load.

---

## Stage 6 — iOS + Privacy upgrade

**User experience:** iPhone users join (same web codebase via `npx cap add ios`), and private channels become genuinely end-to-end — content the relay itself cannot read.

**What they can do:** everything, on both platforms; congregation/cross-church private chat upgraded to E2E (NIP-17 → Marmot/MLS); the deferred encrypted cross-church private channel arrives here.

**Testing focus:**
- **App Store review is its own gate.** Lightning/crypto and donation flows draw Apple scrutiny — budget time for review back-and-forth, and confirm the giving flow's framing (donations to a fellowship, not in-app purchases) before submitting. Treat approval as a milestone you can't fully control the timing of.
- **E2E verification:** prove the relay stores only opaque blobs for E2E channels — actually inspect what the relay holds, don't assume.
- **Cross-platform parity:** identity, secure storage (Keychain vs Keystore), and payments behave identically on both.
- **Migration:** existing Android users' identities and history carry over unchanged.

**Exit gate:** iOS approved and live; E2E confirmed opaque to the relay; feature parity across platforms.

---

## Cross-cutting practices (every stage)

- **Recruit one non-technical tester per stage from the start.** The whole project's success metric is "can a grandparent use it." Test that continuously, not at the end.
- **Recovery is a feature, test it every stage.** Lost-phone → restore-from-phrase should get *easier* to pass over time, never be discovered broken late.
- **Keep a one-page steward guide and grow it.** The moment it lets a new church self-onboard is the real readiness signal for Stage 5.
- **Never widen on a flaky relay.** The NIP-29 layer is the known risk; if it wobbles, hold the line and keep the fallback live rather than exposing more people.
- **Money lags comms by a full stage, deliberately.** Giving only opens (Stage 4) after a congregation has lived on the comms layer (Stage 2–3). Trust is earned on low stakes first.
- **Two defaults, now decisions:** giving is Stage 4 (not earlier); network broadcast is steward-only. Both locked.

---

## How this maps to the technical phases

| Technical phase (build spec §10) | User stage(s) here |
|---|---|
| Phase 0 — Comms MVP | Stages 0–2 |
| Phase 1 — Resilience (local box + sync) | Stages 2–3 |
| Phase 2 — Giving | Stage 4 |
| (Network hardening) | Stage 5 |
| Phase 3 — Privacy & iOS | Stage 6 |

The build phases say *what's constructed*; the stages say *who gets to use it and how it's proven*. Build runs slightly ahead of release: e.g. the local-box sync is built in Phase 1 but proven with real users across Stages 2–3.
