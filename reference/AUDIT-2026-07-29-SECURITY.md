# Security audit — 2026-07-29

One pass, security only. Findings only: nothing here has been changed.

Labels follow the convention of the 07-28 audit, because it worked:

| Label | Meaning |
|---|---|
| **VERIFIED** | I ran it, in this session, against a real relay or a real device. Evidence quoted. |
| **CLAIMED** | Read only. Plausible, unproved. **Reproduce it before you fix it.** |

Scope: the relay's HTTP + WebSocket surface, the authorization spine (`accept` / `canRead` / `note`),
at-rest crypto, the release/update path, and client-side trust. Not covered this pass: the Finance module's
single-writer ledger, the Cashu wallet (gated off), iOS, and the desktop relay app's Tauri shell.

---

## What I could not break

Recording this deliberately. A finding list with no denominator reads as if everything is broken.

- **`/local-token` is not exploitable.** It hands the admin token to a genuine same-machine caller. I attacked
  it through both public tunnels, with forged `Host: localhost` and `Host: 127.0.0.1`, from the LAN address,
  and from loopback with an injected `X-Forwarded-For`. Every one returned `403 not a local request`; only a
  direct loopback request with a loopback Host and no proxy header got the token. The triple check is correct
  and the comment above it reasons about the tunnel case explicitly.
- **Admin gating holds across the surface.** I sent unauthenticated GET and POST to 44 routes — 88 requests.
  22 were answered and every one of those is intentionally public (`/status`, `/push/vapid`, feeds,
  `.well-known`, the relay-name directory). `/config`, `/update`, `/export`, `/import`, `/relay-backup`,
  `/relay-restore`, `/sync-*`, `/tunnel/*`, `/tailscale/*` all refused.
- **The relay-name directory is hardened.** Signature-verified, future-dated claims rejected with a 5-minute
  skew, per-key monotonic `created_at` (so a replayed old claim cannot roll a name back), first-claim-wins per
  handle, one handle per key, capped, and the unauthenticated merge is serialized with a batch cap and yields
  to the event loop every 32 verifies.
- **Retention is per-church.** A chatty congregation cannot age out a quiet one's chat, and structured docs are
  bounded by `MEMBER_DOC_CAP = 500` per member.
- **PIN derivation is PBKDF2-SHA256 at 600 000 iterations in BOTH apps.** I went looking for an asymmetry
  between the member key and the church key and there is none.
- **a8 serves the strict CSP** — `script-src 'self' 'wasm-unsafe-eval'`, no `unsafe-inline`, no `unsafe-eval`.
- **HTML sinks are sanitised.** Every `dangerouslySetInnerHTML` passes through an allowlist sanitiser
  (allowlisted tags, only `class`/`data-s` attributes, dangerous elements removed with their content) or
  renders a locally generated QR. No `eval` or `new Function` anywhere in the app code.

---

## Findings

### S1 — The read gate fails OPEN for any event kind nobody has thought about

**VERIFIED.** `canRead` ends with `if (e.kind !== 1) return true;`. Kinds 0, 4, 5, 7 and 30078 are gated with
real care; everything else is served to anyone who asks. The 30078 gate directly above it was deliberately
inverted to default-DENY in July, for exactly this reason — "a denylist cannot hold this line: every new
feature is a new leak until someone remembers to edit it". The **kind** gate is still a denylist.

Measured against a real gateway, publishing as an ordinary member and reading back over an **anonymous**
socket:

```
kind  what                                    accepted  readable ANONYMOUSLY
9802  NIP-84 highlight (a verse you marked)   true      YES — served to a stranger
30000 NIP-51 people set ("praying for")       true      YES — served to a stranger
10003 NIP-51 bookmarks                        true      YES — served to a stranger
1059  NIP-17 gift wrap (planned)              false     —
30078 church doc (the gated baseline)         true      no
```

**Not currently exploitable**, because the shipped app publishes only kinds 0/1/4/5/7/10002/27235/30078, all
of which are gated. This is a loaded gun, not a wound.

What makes it worth the top slot is that `reference/SPINE.md` names all three of those kinds as the intended
direction for user-owned data — highlights as NIP-84 `9802`, bookmarks and **people sets** as NIP-51
`10003`/`30000` — and describes them as portable to other Nostr clients. A "praying for" people-set is a
social graph of a congregation. The day that ships, it is world-readable, and nothing will fail.

**Fix direction:** invert the kind gate the same way the d-tag gate was inverted — an explicit allowlist of
kinds that may be served, everything else denied. Then add a test that publishes an unknown kind as a member
and asserts an anonymous reader gets nothing, so the next new kind fails closed.

### S2 — A relay serves every file it has ever been shipped, for ever

**VERIFIED on a8.** `relay-update.sh` applies an update with
`tar -xzf "$TARBALL" -C "$DIR" --no-same-owner --exclude='relay/*'` — it unpacks OVER the install and **deletes
nothing**. So removing a file from a release does not remove it from any relay that already has it.

Live, right now, on a8 — which was updated from the current bundle today:

```
in the CURRENT release bundle:   ./vendor/babel.min.js   absent (removed by the strict build)
                                 ./app/app.jsx           absent (removed by the strict build)
served by a8 anyway:             /vendor/babel.min.js    HTTP 200
                                 /app/app.jsx            HTTP 200
```

Neither is exploitable on its own under the strict CSP. The finding is the mechanism, and it has three
consequences:

1. **A file removed for a security reason stays reachable** on every relay that already had it. This is
   precisely why the internal documents kept being served after the morning fix on 07-28 — the fix stopped
   them SHIPPING, and the static denylist is the only thing stopping them being SERVED.
2. **You cannot reason about what a relay serves from the current release.** The served set is the union of
   every bundle that box has ever installed.
3. It accumulates silently — nothing reports it, and a relay operator has no way to see the difference.

**Fix direction:** make the update reconcile rather than overlay — unpack to a staging directory and swap, or
compute the delete-set from the bundle's manifest and remove what is no longer in it, keeping `relay/` and
`node_modules/`. Verify by checking that a file removed from the bundle 404s on a relay after it updates.

### S3 — The member app calls the central domain on the join path, for self-hosted churches too

**VERIFIED by reading, with the call site quoted.** `app/app.jsx:638`:

```js
if (name) fetch('https://app.trinityone.church/relay-names/resolve/' + encodeURIComponent(name), …)
```

When an invite carries `?relayname=`, the app resolves that name against **the hardcoded central host**, not
against the church's own relay. The purpose is sound — a self-hosted relay behind a free tunnel gets a new URL
on each restart, so a printed invite's `?relay=` goes stale and the stable name is the only recovery.

But the effect is that a member of a **self-hosted** congregation, joining from a printed slip, makes their
device tell `app.trinityone.church`: this IP exists, it is joining now, and it is looking for this relay name.
For a congregation that self-hosts precisely so that no central party can see it, that is the one request that
undoes it — and it happens at the single most sensitive moment, the join.

Mitigating: it is best-effort, on the join path only, the URL is fixed (an invite cannot redirect it), and
`CANONICAL_RELAYS` already points every pilot app at the same host anyway. The finding matters for the
self-hosted future the product is being built towards, not for the pilot.

**Fix direction:** resolve the name against the relay already named in the invite (`?relay=`) first and fall
back to the directory only if that fails; or make the directory host a build/church setting rather than a
constant. Either way it is a small change, and it is worth doing before the first genuinely self-hosted church.

---

## Lower severity, unproved

### S4 — Relay-name directory can be flooded out of usefulness

**CLAIMED.** `RELAY_NAMES_CAP = 20000`, and when the map is over cap the **oldest by claim time** are evicted.
Every record needs a valid signature, but an attacker generates keypairs offline for free, so 20 000 valid
claims is cheap. Legitimate names would be evicted until their owners' next gossip tick re-claims them.

Fails closed (a resolution returns nothing rather than an attacker's URL) and is self-healing, so this is
intermittent unavailability of the "type a memorable relay name" feature, not a redirect. Not reproduced —
I did not want to push 20 000 records into the live directory to find out.

### S5 — Another 4-character id generator, same class as the one fixed today

**CLAIMED.** `src/fellowship.src.js:3147`:

```js
const id = ev.id || ('evt' + Date.now() + Math.random().toString(36).slice(2, 6));
```

Four random base-36 characters ≈ 1.7 million values, with `Date.now()` constant across rows created in one
expression. These are replaceable documents keyed by this id, so a collision means the second event **deletes**
the first. This is the same defect I fixed in `app/stew-console.jsx` today (where the guarding test was failing
the release gate one run in five). `src/steward.src.js:2580` uses five characters and carries a comment about
exactly this. Not reproduced here.

### S6 — A member can age out their own church's chat history

**CLAIMED.** Ephemeral events are retained per church up to `MAX_EVENTS` (default 20 000). An admitted member
publishing that many messages would evict the congregation's real chat. Structured documents — calendar,
groups, finance journal — are kept regardless, and a steward can block the member, so this is bounded insider
abuse rather than a remote attack. Not reproduced.

---

## What this pass says overall

The authorization spine is in good shape and has clearly been attacked before: the things I tried first —
the admin token, the route gating, the directory replay and squatting paths, cross-church reads — are all
closed, several with comments naming the exact incident that closed them.

The two findings that matter share one shape, and it is the same shape as three of the four fixed on 07-28:
**a denylist where a default-deny belongs** (S1), and **a fix that stops something shipping without removing
what already shipped** (S2). Both are cheap to close now and expensive to discover later.
