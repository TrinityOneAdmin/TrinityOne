# Giving / treasury — Phase 2 prep (not yet wired)

The Giving tab is currently a **mock** (no real funds move). Per the roadmap, giving is
**Stage 4** — it deliberately lags the comms layer (trust earned on low stakes first), and
money code must be built carefully and tested smallest-amount-first. This file captures the
architecture + concrete setup so it's ready to wire when comms is proven. Spec ref:
`trinityone-fellowship-spec.md` §7.

## Principles (carried from the spec)
- **No central pot.** Each church runs its **own** Lightning treasury; the network never holds
  collective funds. Each congregation is financially sovereign.
- **Treasury = hot wallet.** Keep its balance low, reserves in cold storage, and scope the
  NWC connection's budget/permissions.
- **Self-custodial, minimal entanglement.** Prefer members bringing their own sats / peer
  onboarding; any fiat→BTC onramp is an isolated, optional, KYC'd touchpoint off the critical path.

## Components (per church)
- **Treasury backend:** **LNbits** (lighter; multi-wallet; LNURL/Lightning-Address + NWC
  extensions) or **BTCPay Server** (heavier; runs its own node; most sovereign). Either needs a
  funding source (an LND/CLN node, or a hosted funding backend). This is the real infra cost.
- **Receiving (give to church / a member): NIP-57 Zaps.** Each fund / recipient has a Lightning
  Address (LUD-16), e.g. `tithe@trinity.example`. Flow: client builds a **kind-9734** zap request
  → LNURL callback returns a bolt11 invoice → payer pays → recipient service publishes a
  **kind-9735** zap receipt → clients show it.
- **Disbursing (church → member in need): NIP-47 NWC.** The app holds an NWC connection string
  to the treasury wallet and calls `pay_invoice` against the recipient's Lightning Address. The
  wallet service runs on an always-on box (the church's local box is a natural home).

## Setup steps (when Stage 4 begins)
1. Stand up **LNbits** (docker) with a funding backend; create a wallet for the church treasury.
2. Enable the **Lightning Address** + **NWC** extensions. Create a Lightning Address per fund
   (Tithe & Offering, Missions, Building, Benevolence).
3. Generate an **NWC connection string** for the treasury wallet, **budget-scoped** (low cap).
4. Fund the hot wallet with a small float; keep reserves cold.
5. Configure the app with the fund Lightning Addresses + the NWC string (a per-church config,
   like the relay URL — see `src/fellowship.src.js` `DEFAULT_RELAYS` for the pattern).

## Client wiring plan (the code to write later)
- Library: `@nostr-dev-kit/ndk-wallet` (NIP-57 zaps + NIP-47 NWC, same NDK family) **or** a
  hand-rolled LNURL/NWC path on `nostr-tools`. Route LNURL HTTP fetches through **CapacitorHttp**
  (already enabled) to avoid WebView CORS. **No WebLN** in a Capacitor WebView — use NWC.
- Replace `screens-giving.jsx` mock flows: `StrikeLoadSheet` → real load (or "bring your own
  sats"), `GiveSheet` → real NIP-57 zap to the fund's Lightning Address, wallet balance → real
  via NWC `get_balance`.
- **Test plan (non-negotiable):** smallest-amount-first; unhappy paths (failed/expired invoice,
  address typo, app-closed-mid-pay); both giver and steward must *see* success (zap receipt).

## Optional / later
- **Cashu / NIP-60** (`ndk-wallet` supports it) — Chaumian eCash for a more private treasury;
  introduces mint trust. Candidate post-MVP.
- Fiat onramp — only if convenience outweighs entanglement; keep it isolated/optional.
