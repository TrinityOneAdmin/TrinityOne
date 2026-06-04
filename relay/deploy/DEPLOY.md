# Deploy the TrinityOne relay

This stands up a real **`wss://` relay** so chat works on phones and across devices — the one
thing the app can't do against the localhost dev relay. It's a mature **NIP-01** relay
(`nostr-rs-relay`) behind **Caddy** (automatic HTTPS), which matches the app's current
tag-based transport (spec §5.2 "Plan B"). A NIP-29 relay (e.g. `coracle-social/frith`) is a
later upgrade for relay-managed group rosters/roles.

## You need
- A small always-on box with a **public IP**: a cheap VPS, or a **Raspberry Pi / mini-PC** at
  the church (the spec's "local box") with ports **80 + 443** reachable.
- **Docker** + the Docker Compose plugin.
- A **domain/subdomain** pointing at the box, e.g. `relay.yourchurch.org` (an A record → the IP).

## Steps
1. Copy this `deploy/` folder onto the box.
2. Edit two files, replacing `CHANGE-ME` with your domain:
   - `Caddyfile` → `relay.yourchurch.org`
   - `config.toml` → `relay_url = "wss://relay.yourchurch.org/"`
3. Bring it up:
   ```bash
   docker compose up -d
   docker compose logs -f caddy        # watch the cert get issued (first run)
   ```
4. Verify it's live (should connect and return an empty result, not an error):
   ```bash
   # from any machine with websocat installed:
   echo '["REQ","x",{"kinds":[1],"limit":1}]' | websocat wss://relay.yourchurch.org
   ```

## Point the app at it
In the app: **Chat → tap your identity banner → RELAYS** → type `wss://relay.yourchurch.org`
→ **Add**, then remove the `ws://127.0.0.1:7447` dev entry. (The list is saved on the device.)
For a shipped build you can also change the default in `src/fellowship.src.js` (`DEFAULT_RELAYS`)
and rebuild with `scripts/build-fellowship.sh`.

## Lock it down to your congregation (recommended)
By default anyone can post. To restrict **writes** to known members (reads stay open):
1. Get each member's **hex public key** (the 64-char hex behind their `npub` — visible/Copy in
   the identity sheet; decode npub→hex with any Nostr tool).
2. Add them to `config.toml` under `[authorization] pubkey_whitelist = [ ... ]`.
3. `docker compose restart nostr-relay`.

## Operating notes
- **Data** lives in the `relay-data` Docker volume (SQLite). Back it up:
  `docker run --rm -v deploy_relay-data:/db -v "$PWD":/out alpine tar czf /out/relay-backup.tgz /db`
- **Update:** `docker compose pull && docker compose up -d` (pin the image digest for stability).
- **Two-tier later (Phase 1):** run one of these per church (local box) plus a backbone instance,
  with negentropy (NIP-77) sync between them — see `reference/trinityone-fellowship-spec.md` §5.
- **Risk watch:** the spec flags NIP-29 tooling as the #1 build risk; this Plan-B relay is the
  battle-tested fallback — keep it even after trialling NIP-29.
