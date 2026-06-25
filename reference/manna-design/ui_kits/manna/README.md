# Manna — UI kit

Manna is a tab in the **TrinityOne** Steward Console plus a set of member-app touchpoints. It is mutual aid for a church community: two tiers of help that must *feel* like different rooms.

> **The one feeling to get right:** receiving help must feel like *being known and loved by a community* — never like applying to a system, being assessed, or being watched.

## Shells
- **`PhoneFrame`** — member-app device shell on the warm `--paper` canvas (receiver / giver touchpoints).
- **`ConsoleChrome`** — Steward Console desktop shell; Manna is a quiet fourth verb beside *Read · Gather · Share*.

## Screens
| Screen | Shell | Tier / role | Notes |
|---|---|---|---|
| `MercyDraw` | Phone | Mercy (gleaning) | Frictionless. Amount → done. No form, no reason, no record. Speed *is* the dignity. |
| `CovenantJourney` | Phone | Covenant | Person-first: sponsor beside receiver + a path over time. **NET-NEW: journey timeline.** |
| `GiverTestimony` | Phone | Giver | One consented line of fruit, permission-gated. **NET-NEW: consent gate.** Never a feed. |
| `NominationVouch` | Console | Barnabas / sponsor | "I'll walk with this person" — reskinned trust-graph link, not "Approve". |
| `StewardApproval` | Console | Steward / Keykeeper | Sign-on-device gravity + **NET-NEW: witness/multisig "N of 3 present" row.** |
| `TreasuryHealth` | Console | Steward | Quiet solidity — money & shared-control reassurance. No charts, no tickers. |

## The line to hold
If a screen could be mistaken for a **government benefits portal** *or* a **crypto app**, it is wrong. It should look like what it is: a community quietly looking after its own. Warm `--paper` canvas, plain nouns (help, give, walk with), fiat-labelled amounts, `--gold` rationed to a spark.

## Interactive demo
`index.html` is a self-contained click-through of all six screens (top switcher; phone vs console framing). The `.jsx` modules are the bundle source consuming the shared primitives in `/components`.

## Derivation (from the annotated brief's T1 cheat-sheet)
Mercy ← `GiveSheet` one-tap flow · Covenant ← `TodayScreen` warmth · Vouch ← `GuardianLinkModal` · Approval ← `CustodyExplainer`/`CustodyCard` · Testimony ← announcements + giving success · Treasury ← `StatCard`/`Panel` + fund goal bar.
