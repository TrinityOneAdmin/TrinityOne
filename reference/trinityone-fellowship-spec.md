# TrinityOne — Fellowship & Giving Module: Build Specification

**Working name for the network layer:** Koinonia (Acts 2:44–45 — "all the believers were together and had everything in common… they gave to anyone who had need").

**Audience:** Claude Code (CC), building onto the existing TrinityOne app.
**Status:** Architecture agreed; this document is the build brief. Not greenfield — it bolts onto what already exists.

---

## 0. Context — what already exists (do not rebuild)

TrinityOne is a **Capacitor** app:

```json
{
  "appId": "com.trinityone.app",
  "appName": "TrinityOne",
  "webDir": "www",
  "plugins": { "CapacitorHttp": { "enabled": true } }
}
```

- **Bible reader:** loads Open.Bible modules. Working. Out of scope here.
- **Nostr chat:** *designed* (by Claude Designer) but **not yet integrated** — UI exists, wiring does not. This spec covers wiring it up.
- **Client library:** NDK (`@nostr-dev-kit/ndk`).
- **Runtime:** web codebase in `www/`, wrapped by Capacitor → Android APK now; iOS via `npx cap add ios` against the same web layer.
- **`CapacitorHttp` is enabled** — useful: route LNURL/HTTP fetches (NIP-57) through it to sidestep WebView CORS. WebSockets (NDK relay connections) run natively through the WebView and need no plugin.

**Substrate assumption for this spec:** relays, identity, and chat transport are things we are *adding/wiring*, not inventing from scratch — the chat UI is already designed. Build to fit it.

---

## 1. Guiding principles (these drive technical choices)

These are not decoration — when a design fork appears, resolve it toward these:

1. **No central authority over identity or money.** No entity (including the project maintainer) should be a required trusted key-holder for the network, nor ever custody the network's funds.
2. **Self-custodial identity, federated infrastructure.** Members own their keys on their own devices. Infrastructure (relays, treasuries) is shared *plumbing*, not a control point.
3. **Local resilience.** A congregation keeps working when its internet — or the wider network — is down.
4. **Gentle onboarding.** A non-technical 70-year-old must be able to join in one or two taps and never see a raw key.
5. **Minimise external/state entanglement.** Prefer self-hosted and peer onboarding. Any unavoidable third-party touchpoint (e.g. a fiat→BTC card onramp, which inherently uses a KYC'd provider) is isolated, optional, and never on the critical path.

---

## 2. Architecture overview

```
                       ┌──────────────────────────┐
                       │   BACKBONE RELAY(S)        │   federation-wide groups,
                       │   (VPS, 1–2 instances)     │   network broadcasts,
                       │   Khatru + NIP-29          │   authoritative group rosters
                       └────────────┬───────────────┘
                                    │  negentropy sync (NIP-77)
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
     ┌────────┴────────┐   ┌────────┴────────┐   ┌────────┴────────┐
     │ LOCAL BOX        │   │ LOCAL BOX        │   │ LOCAL BOX        │
     │ Church A (Pi)    │   │ Church B (Pi)    │   │ Church C (Pi)    │
     │ Khatru + NIP-29  │   │ ...              │   │ ...              │
     └────────┬─────────┘   └──────────────────┘   └──────────────────┘
              │  local writes, offline-first
     ┌────────┴─────────┐
     │ TrinityOne clients     │  NDK · identity in secure store · NIP-57 giving
     │ (Capacitor app)   │
     └───────────────────┘
```

**Three ideas doing the work:**

- **Federation = groups = subgroups, all via NIP-29.** One federation; each church is a NIP-29 group; each ministry is a subgroup. Membership is a **relay-managed roster**, not a key-distribution problem — adding/removing a member is one moderation event, never a re-key. This is the decision that makes the federation tractable.
- **Tiered relays.** Local box per church for instant writes + offline resilience; backbone relay(s) for the federation; **negentropy sync** between tiers gives "instant local, eventually global."
- **Scope by tag, not by silo.** Separation between churches is a *filtering* concern (group id / `h` tag), not separate infrastructure. Same relays, scoped views.

---

## 3. Identity & onboarding

### 3.1 The rule that must not be broken

**Do NOT derive keys from personal info** (favourite verse + birthdate + name, or any variant). That is a *brainwallet* and it is one of the most reliably drained patterns in Bitcoin: the input entropy is a few thousand to a few million guesses (verses ~hundreds, birthdates ~30k, names often public/known), the derivation would sit in open-source code, and the **same key controls the member's giving wallet and chat identity** — derived from facts that can never change, so a compromised key can never be rotated. Sweeper bots brute-force exactly this, continuously. **Forbidden.**

The legitimate goal underneath it — *easy setup/recovery without scary key strings* — is achieved differently: keep the **secret random**, make **setup and recovery** gentle. Those are separable.

### 3.2 Identity model (MVP)

- **Key generation:** on first launch, generate a random secp256k1 key via a **BIP-39 mnemonic**, deriving the Nostr key with **NIP-06** (`m/44'/1237'/0'/0/0`). Entropy comes from the random words, not from anything meaningful to the user.
- **Storage:** persist the key in the **OS secure store** — iOS Keychain / Android Keystore — via a Capacitor secure-storage plugin (e.g. `@aparajita/capacitor-secure-storage` or `capacitor-secure-storage-plugin`). **Never `localStorage`** — in a WebView it is trivially extractable, and this key holds money.
- **User never sees the key.** UI shows display names/avatars (kind 0 profile metadata) only.
- **Recovery:** the 12-word BIP-39 phrase, shown once for the member to photograph, or printed by a steward and kept on their behalf. This is the "easy for the congregation" path *without* the brainwallet entropy hole.

### 3.3 Onboarding paths (offer both)

1. **Self-onboard:** install → app generates key → choose a display name → show recovery phrase once → done.
2. **Steward-issued:** a deacon/leader generates a keypair and hands it over as a **QR code / invite link**; the member taps once to import. Zero typing — ideal for the least technical members. Works identically across the federation.

### 3.4 Deferred / optional

- **NIP-46 remote signer ("bunker"):** *not* the default (it reintroduces a trusted key-holder, wrong for a federation). Available later as an *optional, per-church, locally-hosted* convenience only.
- Loss model, stated plainly: pure self-custody means **a lost device with no backed-up phrase = a lost identity**, with no admin able to reset it. BIP-39 backup + optional steward-held copies soften this without recreating a central authority. This is the deliberate cost of removing the middleman.

---

## 4. Federation, groups & membership (NIP-29)

### 4.1 Structure

- **Federation:** a top-level NIP-29 group every church joins (working id e.g. `koinonia-net`).
- **Church:** a NIP-29 group (e.g. `ldh` for Littlehampton).
- **Ministry/subgroup:** a NIP-29 group (e.g. `ldh-youth`, `ldh-eldership`).

Each is a distinct group id (the `h` tag) with its own roster and roles.

### 4.2 Why NIP-29 over key-distribution

Membership lives in the **relay**, not in who-holds-the-key. Add/remove = one moderation event; no re-keying; hierarchy and roles (admin/moderator) are native. This is what makes "one federation, churches as groups, ministries as subgroups" *easier* than managing private membership across the federation cryptographically.

### 4.3 The trade-off (be clear-eyed)

NIP-29 groups are **relay-enforced, not cryptographically private**: the relay knows the roster and can read group content. For an MVP where the relay is the federation's own trusted infrastructure, that is an acceptable trust boundary. **True E2E** (relay cannot read) is a later upgrade (§6, §8) via NIP-17 / Marmot-MLS, applied selectively to channels that need it.

### 4.4 Relay-managed event kinds (NIP-29)

- Group metadata `39000`, admins `39001`, members `39002`, roles `39003` (relay-generated, addressable).
- Group chat message `9`; threaded `11`.
- Moderation/management events `9000`–`9020` (add user, remove user, edit metadata, etc.); join request `9021`.
- All group-scoped events carry the `h` tag = group id. Clients filter by `h` to render the right church/ministry view.

---

## 5. Relay layer

### 5.1 Recommendation

- **Group/membership/roles logic + AUTH-gated access:** a **Khatru-based NIP-29 relay**. Evaluate **`coracle-social/frith`** (Khatru-based, NIP-29 + access controls, whitelist via `RELAY_WHITELIST`, dynamic auth via `RELAY_AUTH_BACKEND`, `RELAY_ENABLE_GROUPS`) and **`max21dev/groups-relay`** (Khatru + `relay29`, ships with a working group client). frith is the closest fit for closed church groups with whitelisting.
- **Sync tier (Phase 1+):** negentropy (NIP-77). Both strfry and Khatru can do negentropy; keep relay software consistent across tiers if possible to minimise sync friction.

### 5.2 Maturity risk — treat as the #1 build risk

The shared NIP-29 core (`relay29`) carries an explicit author warning that it may be broken and not for serious use yet. Therefore:

- **Pin versions; budget for breakage; expect to wipe and rebuild the relay DB during development.**
- **Build Phase 0 against a single backbone NIP-29 relay first.** Do not take on multi-relay sync *and* young NIP-29 code simultaneously. Prove group semantics, then add the resilience/sync tier.
- **Keep a fallback (Plan B):** if NIP-29 maturity blocks progress, degrade to **tag-based grouping** — a `congregation` tag and a `network` tag on standard signed events, on a mature whitelisted Khatru/strfry relay, with membership in app-level lists. Less elegant, battle-tested relay code. The app's channel model (§6) is designed so this swap is contained to the relay/query layer.

### 5.3 Topology roles

| Tier | Software | Runs on | Holds | Operated by |
|---|---|---|---|---|
| Local relay | Khatru/NIP-29 | Church Pi / mini-PC | That church's events; cached network events | Each congregation |
| Backbone relay | Khatru/NIP-29 | VPS (1–2) | Network-wide events; authoritative group rosters | Network stewards |

The backbone is **shared plumbing, not an authority**: it relays already-signed (and, for E2E channels later, already-encrypted) events. If it goes down or rogue, churches keep running locally and re-point to another backbone. No identity or money ever lives there. (It *can* see NIP-29 group membership and non-E2E group content — see §4.3.)

---

## 6. MVP channel model

Scope agreed: **in** — congregation broadcast (essential), network broadcast (essential), congregation private chat. **Deferred** — encrypted cross-church private messaging.

| Channel | Scope | Privacy (MVP) | Group / tag | Relay path | Who can send |
|---|---|---|---|---|---|
| Congregation broadcast | One church | Signed, member-readable | `h = <church>` | Local relay → sync | Steward role *(default — see §9)* |
| Congregation chat | One church | NIP-29 closed group (relay-readable, access-controlled) | `h = <church>` | Local relay → sync | Members |
| Network broadcast | All churches | Signed, member-readable | `h = koinonia-net` | Backbone → all local boxes | Network steward role *(default)* |
| Cross-church private | — | **Deferred** (NIP-17 / Marmot later) | — | — | — |

Notes:

- The two **broadcasts are the same primitive** (signed events to a NIP-29 group the relay gates by sender role) differing only by group id and routing.
- **Congregation private chat in MVP = a NIP-29 closed group** (access-controlled, relay-readable). This is the simplest correct MVP given the trusted-infra boundary. If a congregation needs content the relay cannot read, that is the **E2E upgrade** in §8 (NIP-17 for small/DM, Marmot-MLS for scalable private groups) — design the chat data layer so this upgrade is swappable per channel.

---

## 7. Giving & treasury module (Phase 2 — see §9)

Native to the stack: Nostr has Lightning payments built in.

### 7.1 Components

- **Per-church treasury (no central pot):** each church runs its **own** Lightning backend — **LNbits** (lighter, multi-wallet, has LNURL/Lightning-Address + NWC extensions) or **BTCPay Server** (heavier, own node, most sovereign). Each church is financially sovereign; the network never holds collective funds.
- **Receiving (giving to the church / a member):** **NIP-57 Zaps**. Recipient has a Lightning Address (LUD-16, e.g. `give@ldh.example`). Flow: client builds a **kind 9734** zap request → LNURL callback returns a bolt11 invoice → sender pays → recipient's service publishes a **kind 9735** zap receipt to the named relays → clients display it.
- **Disbursing (church → member in need):** **NIP-47 Nostr Wallet Connect (NWC)**. The app holds an NWC connection string to the church treasury's wallet service (LNbits/BTCPay), and calls `pay_invoice` against the recipient's Lightning Address. NWC is client↔wallet over E2E-encrypted events on a relay — the wallet service runs on an always-on box (the church's local box is a natural home).
- **Library:** `@nostr-dev-kit/ndk-wallet` implements **NIP-57 (zaps)**, **NIP-47 (NWC)**, and **NIP-60 (Cashu eCash)** in the same toolkit you're already using.

### 7.2 Mobile / Capacitor specifics

- **No WebLN** in a Capacitor WebView (no browser extension). The in-app payment path is **NWC**, not WebLN.
- Use **`CapacitorHttp`** (already enabled) for the LNURL HTTP fetches to avoid CORS.
- **Hot-wallet hygiene:** the treasury connected via NWC is a hot wallet — keep its balance low, hold reserves in cold storage, scope the NWC connection's permissions/budget.

### 7.3 Sovereignty options (optional, later)

- **Cashu / NIP-60 (`ndk-wallet` supports it):** Chaumian bearer eCash — blind-signed, so the mint can't see balances/transactions. Very private, very on-ethos, but introduces *mint* trust. Candidate for a more private treasury model post-MVP.
- **Fiat onramp (optional, isolated):** any card→BTC onramp routes through a **KYC'd regulated provider** — the one unavoidable external touchpoint. Keep it an *optional module*, off the critical path. If minimising entanglement matters more than convenience, prefer **members bringing their own sats** / peer onboarding / direct Lightning donation, and omit the onramp entirely.

---

## 8. Privacy upgrade path (post-MVP)

- **NIP-17** (gift-wrapped DMs, kind 14 inside kind 1059 wraps, NIP-44 encryption): E2E for 1:1 and small groups; relay cannot read content.
- **Marmot / NIP-EE (MLS over Nostr):** scalable E2E *group* messaging with forward secrecy; relay sees only encrypted blobs and cannot attribute senders. Implementation kits: **MDK** (Rust), **marmot-ts** (TypeScript); **White Noise** reference client. This is the path for **encrypted cross-church private messaging** (the deferred channel) and for any congregation chat that must be relay-opaque.

Design the chat data/transport layer now so encryption is a **per-channel swappable strategy** (none / NIP-29-gated / NIP-17 / Marmot), not a global assumption.

---

## 9. Assumptions & open decisions (overrule freely)

Two items weren't explicitly settled; sensible defaults chosen so the build can proceed:

1. **Giving = Phase 2 (fast-follow), not Phase 0.** Rationale: the comms substrate (identity + relay + chat) must work before money rides on it. The original driver was giving, so if you'd rather **promote it into the MVP**, say so — the module is fully specified and can move forward.
2. **Network broadcast = steward/leader role only (default).** A global network where any of thousands of members can blast everyone is almost certainly not what you want. Maps to a NIP-29 role check (relay-enforced). One-line change to open it up.

Also confirm when convenient: group-id naming scheme; backbone hosting location/operator; LNbits vs BTCPay per church; whether the fiat onramp is ever included.

---

## 10. Build phases

**Phase 0 — Comms MVP (foundation).**
Wire the existing designed chat UI to NDK. Identity: BIP-39 random key (NIP-06), secure-store persistence, self-onboard + steward-QR onboarding. Stand up **one backbone Khatru NIP-29 relay** (evaluate frith). Create the federation group + one church group + a ministry subgroup. Ship: congregation broadcast (steward-gated), network broadcast (steward-gated), congregation group chat (members). Prove group semantics end-to-end on the real device build.

**Phase 1 — Resilience.**
Add the local-box relay tier; negentropy sync (NIP-77) between local boxes and backbone; offline-first behaviour (local writes survive internet loss; reconcile on reconnect).

**Phase 2 — Giving.**
Per-church LNbits/BTCPay + Lightning Address; in-app NIP-57 zaps (give to church / member); NWC treasury disbursement via `ndk-wallet`; hot-wallet hygiene + budgeted NWC permissions.

**Phase 3 — Privacy & scale.**
Per-channel E2E (NIP-17 → Marmot/MLS), including the deferred encrypted cross-church private channel; iOS release (`npx cap add ios`); optional Cashu/NIP-60 private treasury.

---

## 11. Tech stack summary

| Layer | Choice | Notes |
|---|---|---|
| App shell | Capacitor (`com.trinityone.app`) | iOS via `cap add ios`, same `www/` |
| Bible | Open.Bible modules | Existing; out of scope |
| Nostr client | NDK (`@nostr-dev-kit/ndk`) | Chat UI already designed; wire it |
| Wallet | `@nostr-dev-kit/ndk-wallet` | NIP-57 + NIP-47 (+ NIP-60) |
| Key storage | Capacitor secure-storage plugin | Keychain/Keystore; **never localStorage** |
| Key derivation | BIP-39 + NIP-06 | Random entropy; **no brainwallet** |
| Relay (groups) | Khatru NIP-29 (frith / groups-relay) | Highest build risk; keep tag-based Plan B |
| Relay sync | Negentropy (NIP-77) | Phase 1+ |
| Lightning backend | LNbits or BTCPay (per church) | Self-hosted; per-church sovereignty |
| HTTP (LNURL) | `CapacitorHttp` (enabled) | Avoids WebView CORS |

## 12. Relevant NIPs

| NIP | Purpose in TrinityOne |
|---|---|
| NIP-06 | Derive Nostr key from BIP-39 mnemonic (recovery) |
| NIP-29 | Relay-based groups → federation/church/ministry + roles + membership |
| NIP-42 | Relay AUTH (gating closed groups) |
| NIP-44 | Encryption primitive (for NIP-17/Marmot, later) |
| NIP-17 | Gift-wrapped private DMs/small groups (privacy upgrade) |
| NIP-EE / Marmot | MLS group E2E (cross-church private, later) |
| NIP-57 | Lightning Zaps (giving) — kinds 9734/9735 |
| NIP-47 | Nostr Wallet Connect (treasury disbursement) |
| NIP-60 | Cashu eCash wallet (optional private treasury) |
| NIP-77 | Negentropy sync (relay tiers) |
| NIP-46 | Remote signer (optional, per-church only) |

---

## 13. Hard constraints (do not violate)

1. **No brainwallet / personal-info key derivation.** Random entropy only (§3.1).
2. **Private key never in `localStorage`.** Secure store only (§3.2).
3. **No central custody of identity or network funds.** Self-custodial keys; per-church treasuries (§1, §7).
4. **Treasury = hot wallet.** Low balance, cold reserves, budgeted NWC scope (§7.2).
5. **Encryption is per-channel and swappable** — don't hard-code a single assumption (§6, §8).
6. **Expect NIP-29 tooling to break;** pin versions, keep the tag-based fallback live (§5.2).
