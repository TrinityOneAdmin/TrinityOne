# Proposal: MyData encrypted-Nostr backend (propose-then-go)

Status: DRAFT for review. Nothing here is built yet. This is the high-stakes slice the SPINE
flags as "propose, never assume" -- it touches keys, encryption, and relays. Approve (or amend)
before any code lands.

Relates to: `src/mydata.src.js` (the local store shipped on branch `claude/mydata-ui`),
`reference/SPINE.md` (User-owned data + Backup & recovery sections).

---

## 1. Goal

Make the user's own data -- highlights, bookmarks, notes, journal, prayer list, settings --
**real**: signed to the user's key, **private data encrypted**, and **synced across their devices**
through relays. Deliver the SPINE promise: "the user's key is their portable database."

Non-goal (separate slices, see section 10): the Argon2id cloud "back up everything" snapshot,
relay hosting/infra, NIP-29 group data, and giving.

---

## 2. The swap point (why this is low-blast-radius)

`MyData` is already built over a `Backend` interface with exactly two methods:

```
getDoc(key) -> value | null          // a "doc" = one collection array, or the settings object
putDoc(key, value) -> void
```

Today the only implementation is `LocalBackend` (localStorage). **Everything above the backend
line -- the typed API (`list/put/remove/setVisibility/count/...`), every screen, the per-item
`visibility` flags -- stays exactly as-is.** This proposal only adds a second backend.

**Key design choice: `NostrBackend` wraps the local store; it does not replace it.**
The local copy stays the synchronous working copy (offline-first; SPINE: "treat relays as sync,
keep a local working copy"). The Nostr layer is sync/backup on top:

- `getDoc(key)` -> returns from the local cache (synchronous, instant -- unchanged behavior).
- `putDoc(key, value)` -> writes the local cache (synchronous) AND queues a debounced encrypted
  publish to relays (async, fire-and-forget).
- On init / identity-change: subscribe to the user's own events, decrypt, **reconcile** into the
  local cache, emit `trinity-mydata` so the UI re-reads.

Result: the `getDoc/putDoc` contract stays synchronous; no screen or the MyData API changes.

---

## 3. Carrier mapping (the main decision -- needs your call)

Each MyData doc maps to a Nostr event on the user's pubkey. Two routes:

### Option A -- Uniform NIP-78 (RECOMMENDED for v1)
One replaceable app-data event (kind `30078`, addressable by a `d` tag) per doc:

| Doc | Kind | `d` tag | Encrypted? |
|---|---|---|---|
| highlights | 30078 | `trinityone/highlights` | no (public) |
| bookmarks | 30078 | `trinityone/bookmarks` | no (public) |
| notes | 30078 | `trinityone/notes` | **yes (NIP-44)** |
| journal | 30078 | `trinityone/journal` | **yes (NIP-44)** |
| prayer | 30078 | `trinityone/prayer` | **yes (NIP-44)** |
| settings | 30078 | `trinityone/settings` | no |

- **Pros:** near-zero-friction -- the existing "doc = array" model maps 1:1 to one replaceable
  event. Simple reconciliation (one event per doc). Ships encryption + cross-*device* sync now.
- **Cons:** not cross-*app* portable (another Nostr client won't recognize your highlights as
  standard NIP-84). Whole-doc republish on each change (fine at our sizes -- tens of items).

### Option B -- Native kinds (SPINE's eventual target; cross-app portable)
- highlights -> **NIP-84** kind `9802`, one event per highlight (readable by other Nostr readers).
- bookmarks -> **NIP-51** kind `10003`; "people/groups" sets -> kind `30000`.
- notes / journal / prayer -> NIP-78 `30078`, encrypted (no standard cross-app kind for a private
  journal exists anyway).
- settings -> NIP-78 `30078`.

- **Pros:** real interop -- your highlights/bookmarks outlive the app and open in any Nostr reader.
- **Cons:** per-event items (not per-doc) means an item<->event mapping, NIP-09 deletes, and
  harder reconciliation. A bigger lift.

**Recommendation:** ship **Option A** now (encryption + your-own-device sync, minimal risk), then
**graduate highlights->NIP-84 and bookmarks->NIP-51 as an additive follow-up** for cross-app
interop. Decision needed: A-now-B-later (recommended) vs. straight to B.

---

## 4. Encryption (NIP-44)

- Self-encryption: derive the NIP-44 v2 conversation key from the user's own key to their own
  pubkey (`nip44.getConversationKey(sk, ownPubkey)`); `content = nip44.encrypt(json, ck)` for
  private docs, plaintext JSON for public docs.
- **v1 encrypts by doc type** (notes/journal/prayer encrypted; highlights/bookmarks plaintext),
  matching the per-type defaults already in the schema.
- The per-*item* `visibility` flag (already in the data model) is honored **later**: a private
  item inside an otherwise-public type would be split into an encrypted companion doc. Out of
  scope for v1; the flag is carried now so that change is non-breaking. Decision: accept per-type
  encryption for v1 (recommended) vs. build per-item routing now.

---

## 5. Key handling

- Reuse `window.TrinityIdentity` (BIP-39/NIP-06): `exportMnemonic()` ->
  `privateKeyFromSeedWords` -> sk. Same pattern as `window.Fellowship`.
- The secret key **never leaves the device** and is never persisted by this layer.
- Re-derive on the `trinity-identity` event (regenerate / restore).
- **Web (ephemeral identity):** a fresh key each load means no persistent remote to sync with --
  the backend no-ops gracefully (local-only). Real sync is a native-device feature. Documented,
  not a bug.

---

## 6. Sync + reconciliation (the genuinely tricky part)

On init, subscribe to `{ kinds:[30078], authors:[me], '#d':[all doc d-tags] }`. For each event:
decrypt if needed, parse, reconcile with the local cache, write cache, emit.

**Conflict policy.** Replaceable events give "latest by `created_at`," but naive last-write-wins
can drop offline local edits. Proposed: **item-level merge** before adopting --

- Union items by `id`; on a clash, keep the newer by item `ts`.
- **Deletes** propagate via a small per-doc tombstone list (`deleted: [ids...]` carried in the
  event) so a removal on phone A reaches phone B. (Without this, additive merge would resurrect
  deleted items.)
- `settings` is small and low-conflict: last-write-wins by `created_at` is fine.

This is the main net-new complexity and the part most worth reviewing. Decision: item-merge +
tombstones (recommended, safe) vs. simple last-write-wins (simpler, can lose data).

**Relays:** reuse `window.Fellowship.relays` for publish/subscribe in v1; move to NIP-65
(kind 10002 relay routing) in a later pass. Republish is debounced (~800ms) per doc.

**Local stays authoritative.** A relay must never be the sole copy of a journal (SPINE caution) --
the local working copy is the source of truth; relays are redundancy/sync.

---

## 7. Migration

The local MyData docs already exist (seeded/owned on the current branch). First Nostr-enabled run:
publish the existing local docs up (so relays have them), then continue normal sync. No data
reshaping -- the doc shapes are unchanged. Fully backward compatible: if relays are unreachable,
the app behaves exactly like the local-only build.

---

## 8. Risks + guardrails

- Secret key never leaves device; private-by-default for sensitive types.
- Relays can drop/expire events -> local copy authoritative; never sole-copy a journal.
- Encryption correctness -> round-trip tests are a gate (section 9).
- Republish volume -> debounce; whole-doc events stay small (tens of items).
- Self-custody floor unchanged: lost key = lost data (the Argon2id cloud snapshot, a separate
  slice, is what protects against that -- not this layer).

---

## 9. Test plan (headless, dev relay)

1. Encrypt/decrypt round-trip for each private doc type.
2. put -> publish -> subscribe -> reconcile on the local dev relay (single session).
3. Offline edit, then reconnect: item-merge keeps both sides; tombstone propagates a delete.
4. Identity regenerate/restore re-derives the key and re-pulls.
5. Web ephemeral: confirm graceful local-only no-op.
6. Boot-clean across reader/library/today (no regressions to the local path).

---

## 10. Explicitly out of scope (separate proposals)

- **Argon2id cloud "back up everything"** sealed snapshot (passphrase-derived, whole-library;
  different mechanism from per-type events) -- SPINE Backup layer 3.
- **Relay infrastructure / hosting** (a real `wss://` relay so this works off localhost).
- **NIP-29 group data**, **giving/Lightning** (Phase 2).
- **Option B native kinds** (NIP-84/NIP-51) -- recommended as the follow-up to this slice.

---

## 11. Effort + sequencing

- Add `NostrBackend` (+ a small sync/merge engine) inside `src/mydata.src.js` -- it already
  bundles via esbuild, so nostr-tools imports (`pool`, `pure`, `nip06`, `nip44`) are available.
  MyData's API and every screen are untouched.
- Rough order: (a) NostrBackend publish path + encryption + tests; (b) subscribe + reconcile +
  tombstones; (c) wire selection (use NostrBackend when a real identity exists, else LocalBackend);
  (d) migration publish-up; (e) headless verification.
- Lands on its own branch off `claude/mydata-ui`, behind the same `go` gate.

---

## Decisions needed before "go"

1. **Carrier:** Option A now + B later (recommended) -- or straight to native kinds (B)?
2. **Encryption granularity:** per-type for v1 (recommended) -- or per-item routing now?
3. **Conflict policy:** item-merge + tombstones (recommended) -- or simple last-write-wins?
4. **Relays:** reuse the Fellowship relay list for v1 (recommended) -- or add NIP-65 routing now?

Reply with any amendments and a "go" and I'll implement against these choices.
