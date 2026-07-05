# Go-live runbook — switch to `trinityone.church`

*Prep pass done 2026-06-22. Status: **blocked on Namecheap account unlock** → then nameservers →
Cloudflare Active. Everything below is staged and audited so the switch is mechanical once the
domain answers. The pilot keeps running on `trinityone.tailbeaac0.ts.net` until then — do NOT apply
Part C before `https://trinityone.church` actually serves, or the live APK/web will break.*

**Decision (2026-06-22):** all-in-one on the **a8 box** (= master-01), exposed via a **Cloudflare
named tunnel** at `trinityone.church`. a8 has no personal files. Domain registered at Namecheap; DNS
moving to Cloudflare.

---

## Part A — Owner actions (accounts / DNS; can't be scripted here)

1. **Unlock Namecheap** (in progress) — verify via official Namecheap **Live Chat / support ticket**
   on namecheap.com (never via the email link). Provide only the payment descriptor; never card
   number / CVV / password / 2FA.
2. **Cloudflare DNS active** — site already added; set the two assigned nameservers
   (`oswald.ns.cloudflare.com`, `vita.ns.cloudflare.com`) as **Custom DNS** at Namecheap. Parking
   records (apex `A → 192.64.119.40`, `www` CNAME) deleted; MX/SPF (email forwarding) kept. Confirm
   DNSSEC is off. Wait for **Active**.
3. **Set up email forwarding** so the new contact addresses work: forward **hello@trinityone.church**
   (and **security@trinityone.church**) to a real inbox — Namecheap email forwarding (the MX/SPF kept
   above) or Cloudflare Email Routing. (Contact links in the marketing pages already point here.)
4. **Create the Cloudflare Tunnel** — Zero Trust → Networks → Tunnels → Create → Cloudflared. Copy the
   **tunnel token**. Add a **Public Hostname**: `trinityone.church` → HTTP → `localhost:8000`
   (relay rides the same origin at `/relay`; WebSockets work automatically).

## Part B — Stand up a8 on the domain (run ON the a8 box)

```
curl -fsSL https://trinityone.tailbeaac0.ts.net/relay-app/install.sh | sudo bash -s -- \
  --tunnel cloudflared --cf-token <TUNNEL_TOKEN> --domain trinityone.church \
  --church <CHURCH_NPUB>
```
Pulls the latest bundle from the dev box (so a8 gets categories, the new dictionaries, everything),
serves app + relay at `https://trinityone.church`, and runs cloudflared as a service.

**Verify before Part C:**
```
curl -I https://trinityone.church/                       # 200, serves the app
curl -I https://trinityone.church/modules/strongs-dict.json   # 200
curl -I https://trinityone.church/catalog.json           # 200
# WebSocket: relay answers a REQ at wss://trinityone.church/relay
```

## Part C — Flip the app onto the domain (my action; only after Part B verifies)

Exact edits (all `…tailbeaac0.ts.net` / `…pages.dev` → `trinityone.church`), then rebuild + deploy:

| File | Line | From → To |
|---|---|---|
| `engine.js` | ASSET_BASE | `https://trinityone.tailbeaac0.ts.net/` → `https://trinityone.church/` |
| `src/fellowship.src.js` | `CANONICAL_RELAYS` | primary → `wss://trinityone.church/relay`; keep `wss://trinityone-master-01.tailbeaac0.ts.net/relay` as fallback; drop the dev-box relay |
| `src/steward.src.js` | `CANONICAL_RELAYS` (l.80) | same as fellowship |
| `src/steward.src.js` | `PUBLIC_BASE` (l.~1488) | `https://trinityone.pages.dev` → `https://trinityone.church` (invite/join links) |
| `identity-extras.jsx` | l.~180/183 | invite base + relay fallback → `trinityone.church` |
| `join.html` | OG urls + APK link | `pages.dev` / `ts.net` → `trinityone.church` |
| `migrate.html` | OG image | `pages.dev` → `trinityone.church` |
| `welcome.html` | l.~754 APK link | `ts.net` → `trinityone.church` |
| `welcome-churches.html` | l.~215 relay-install cmd | `ts.net` → `trinityone.church` |
| `relay-app/install.sh` | `SRC=` default (l.25) | `ts.net` → `trinityone.church` (churches then install from the domain) |
| docs (`HOSTING.md`, `README.md`, `reference/SPINE.md`, `RELEASES.md`) | — | update host references (cosmetic) |

Then:
```
bash scripts/build-fellowship.sh && bash scripts/build-steward.sh   # rebuild engines (relay URLs)
bash scripts/release.sh                                              # web (Pages) + APK + gateway
```
Rebuilds + redeploys with the new host baked in; cut a fresh APK so installs pull modules from
`trinityone.church`.

**Verify after:** fresh APK installs a Bible/dictionary (ASSET_BASE), chat connects (relay), a new
invite link shows `trinityone.church`.

## Rollback
Revert the Part C commit and re-run `scripts/release.sh`. The `.ts.net` / master-01 relay still works
throughout (kept as fallback), so chat data is never stranded.

## Already done in this prep pass (safe, on `main`)
- Contact email → **hello@trinityone.church** (`welcome.html`, `welcome-churches.html`, `features.html`).
- Security contact → **security@trinityone.church** (`SECURITY.md`).
- This runbook.
