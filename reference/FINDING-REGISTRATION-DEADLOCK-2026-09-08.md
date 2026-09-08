# Why one church could not save "people must be approved before they can join"

**Status:** finding. Reproduced against a real relay. Nothing fixed.
**Question asked:** the owner's test church showed a permanent banner while a brand-new church worked.

---

## The answer

A church that is not registered on any of its relays **cannot get itself registered again**, because the
one thing the recovery path waits for is the one thing the relay will not let it write.

```
   not registered on the relay
              │
              ▼
   its own kind-0 profile is REFUSED
              │
              ▼
   the console never learns the church's name
              │
              ▼
   the self-registration retry never fires   (it is guarded on `!church.name`)
              │
              └──────────────► still not registered
```

It never breaks out. The banner is permanent, and no amount of reloading, reconnecting or waiting
changes it.

## Measured, not reasoned

Against a freshly started relay with no churches (`scripts/gateway.mjs`, clean data dir), an
unregistered church key was asked to publish two things:

| Event | Result |
|---|---|
| its own **kind-0 profile** | `blocked: not a member or not permitted for this group` |
| its own **join policy** | `blocked: not a member or not permitted for this group` |

Both refused. The profile refusal is the one that closes the loop.

## The three links, in the code

1. **The join policy needs registration.** `canWrite` for a `joinpolicy:` d-tag is
   `leaderOf(cp) || stewardCan(pubkey, cp, 'members')` (`gateway.mjs:2288`), and `leaderOf` is
   `CHURCH_PUBS.has(cp) && (e.pubkey === cp || …)` (`:2170`). No registration, no write. **So the
   original banner was right in substance** — only "this relay" was wrong, which is what was fixed
   earlier today.

2. **The profile needs registration too.** A church's kind-0 is deliberately public *once it is
   registered* (`:3031`, so a stranger can see the name before joining) — but an unregistered key is
   refused on the way in.

3. **The retry is guarded on the name.** `app/stew-dashboard.jsx:1339`:

   ```js
   if (!S || S.actingChurch || !church.name || !S.selfRegister) return;
   S.selfRegister(church.name).catch(() => {});
   ```

   and `church.name` comes from `useStewardChurch` (`app/steward-root.jsx:298`), which fills only from
   `subscribeProfile` — the kind-0 **read back from the relays**. It starts `{}`. There is no local
   cache of the name.

   The nameless boot-time call cannot cover for it: `steward-root.jsx:342` already records that
   `selfRegister('')` "cannot succeed and never could — the relay refuses a NEW nameless church".

## Why a new church is fine, and this one is not

At creation the console calls `selfRegister(name, { createHere: true })` with the name **in hand**
(`stew-dashboard.jsx:754`), before it needs to read anything back. That is why the church I created on
the Oppo today registered (a8 went 14 → 15 churches), wrote its join policy to both relays, and showed
no banner.

The failure needs a church that **was** registered and then was not:

- a relay reset or restore (`scripts/relay-reset.sh` exists, and its own note warns that the phones
  keep pointing at the box afterwards);
- a church moved to a relay it was never added to;
- any registration that was lost while the console happened to be closed.

From the next console reload, that church is stuck.

## Corroboration on a8

An anonymous read of a8 returns **7 join-policy documents** — for **15 registered churches** — and
**11 kind-0 profiles**. Four registered churches have no profile at all. The counts are consistent with
several churches sitting in, or near, this state. (The remainder cannot be identified without the
admin token; `/config` is admin-only, correctly.)

## One more thing, and it points the wrong way

The refusal string is `blocked: not a member or not permitted for this group`. That is exactly the
string `publishErrorMessage` classifies as **wrongChurch**, whose remedy is *"this relay is set up for
a different church. Restore this church's key in Settings."*

The key is fine. Restoring it changes nothing, and restoring a key is destructive. A steward following
that advice would be doing something irreversible for a problem it cannot fix.

## What would break the loop

Not implemented — this is a finding. In rough order of how much they cost:

1. **Cache the church's own name locally** when it is set, and let the retry use that when the relay
   has nothing to tell us. Smallest change; the console already knows the name at the moment it
   matters. It fixes exactly the deadlock and nothing else.
2. **Retry registration on the refusal signal.** `noteRelayRejection()` already fires the moment a
   write is refused as a membership problem — which is precisely when re-registering is worth trying.
   Today nothing listens to it except the banner.
3. **Let a church write its own kind-0 unregistered.** Cheapest at the relay and the most tempting, and
   I would not: it lets any key seed a profile on any relay. The document is public *after*
   registration for a reason, and that reason is not "before it, too".
4. Both 1 and 2 leave the admin-token panel as the last resort it was meant to be, rather than the only
   way out — which is what the pending-request design
   (`reference/PENDING-CHURCH-REQUESTS-2026-09-08.md`) is about.

**This is also the concrete case for self-healing.** The machinery to recover already exists —
`autoPickRelays` would put this church on a relay that will carry it — and the only thing that calls it
is a button labelled "Auto-find relays for me".
