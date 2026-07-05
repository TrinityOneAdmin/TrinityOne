# TrinityOne docs

Documentation, organised. For the codebase map, start with [`ARCHITECTURE.md`](../ARCHITECTURE.md) at the repo root.

## Guides — how to use / run it
- [`guides/STEWARD-GUIDE.md`](guides/STEWARD-GUIDE.md) — running a church from the steward console
- [`guides/STEWARDS-AND-HANDOFF-EXPLAINED.md`](guides/STEWARDS-AND-HANDOFF-EXPLAINED.md) — delegated stewards + handing off a church without handing over the key

## Design — product & module specs
- [`design/ROADMAP.md`](design/ROADMAP.md) — product roadmap
- [`design/FINANCE-MODULE.md`](design/FINANCE-MODULE.md) — the Finance module (double-entry ledger, donation nudge, CSV import)
- [`design/TREASURY.md`](design/TREASURY.md) — the giving-records / treasury design
- [`design/MANNA-MODULE.md`](design/MANNA-MODULE.md) — the Manna module (money-out / disbursements)
- [`design/STEWARD-ROSTER-DESIGN.md`](design/STEWARD-ROSTER-DESIGN.md) — the owner-signed, revocable delegated-steward roster
- [`design/CHURCH-BOX.md`](design/CHURCH-BOX.md) — the self-host appliance ("church box") design
- [`design/CORNERSTONE-DESIGN-BRIEF.md`](design/CORNERSTONE-DESIGN-BRIEF.md) — the visual / product design brief
- [`design/PITCH-DECK-BRIEF.md`](design/PITCH-DECK-BRIEF.md) — pitch-deck brief

## Ops — deploy, release, hosting
- [`ops/HOSTING.md`](ops/HOSTING.md) — self-hosting a relay
- [`ops/GO-LIVE-DOMAIN.md`](ops/GO-LIVE-DOMAIN.md) — the go-live domain split (marketing vs app + relay)
- [`ops/RELEASES.md`](ops/RELEASES.md) — the release process
- [`ops/IOS-BUILD.md`](ops/IOS-BUILD.md) — building for iOS
- [`ops/PILOT-READINESS.md`](ops/PILOT-READINESS.md) — pilot readiness checklist
- [`ops/POST-RENAME-TEST.md`](ops/POST-RENAME-TEST.md) — post-rename smoke checklist

## Security
- [`security/SAFEGUARDING.md`](security/SAFEGUARDING.md) — child-protection design (child-safe groups + gated child↔adult DMs)

## Refactor plan
- [`REFACTOR-PLAN.md`](REFACTOR-PLAN.md) — the code-quality backlog (large-file splits, DRY, comment style) and why the risky parts are staged

---

**At the repo root** (GitHub convention — kept there on purpose): [`README.md`](../README.md), [`ARCHITECTURE.md`](../ARCHITECTURE.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`SECURITY.md`](../SECURITY.md).
**Internal working material** (briefs, backlog, design notes, archive) lives in [`../reference/`](../reference/) — including `reference/SPINE.md`, the architecture spine + live roadmap.
