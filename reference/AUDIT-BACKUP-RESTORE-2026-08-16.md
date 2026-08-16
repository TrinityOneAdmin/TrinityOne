# Backup & restore — UX audit, 16 August 2026

Read-only. Everything below was established by reading the shipped screens and, where noted, by driving them.
The brief was specifically: **what is the optimal flow for a member who is not technical, and how do we make it
foolproof.**

The short answer: the mechanics mostly work. The *shape* is wrong. A member is asked to understand two
different recovery objects, is offered two competing backup UIs on one screen, and — the part that actually
loses accounts — **cannot reach the file route at all on a new phone, which is the only moment it exists for.**

---

## 1. What exists today

**Two recovery objects, with different properties, both presented as chores.**

| | 12 words | Backup file |
|---|---|---|
| Brings back | who you are (identity, church) | *everything* — identity **and** notes, journal, plans |
| Costs the member | write on paper, once | choose a passphrase, remember it, keep a file |
| Restorable on a new phone | yes, offered at first run | **no route exists** |

The file is a **superset** — it contains the identity. The words are a subset that needs no second secret.
Neither is redundant, and the app never says how they relate except in one line of a help doc, which is the
best sentence in the product and is buried:

> *"the 12 words bring back who you are, the file brings back what you wrote."*

**Two backup UIs, on the same screen.** The member's account screen renders a row → `RecoverySheet`
(identity-extras.jsx), which contains its own "Save an encrypted backup / Restore" section; and directly below
it `<BackupCard>` (screens-library.jsx), which contains "Back up your data → Save to device / cloud" and
"Restore from a backup file". Same feature, twice, with different rules and different restore mechanics.
`screens-library.jsx`'s own comment already says "this is what a duplicated flow costs".

---

## 2. Findings, ranked by what a real person loses

### F1 — There is no way to restore a backup file on a new phone. CRITICAL.
"Bring your account back" offers exactly four routes: old phone (transfer), someone set this up for me (scan),
I have my 12 words, I've lost my 12 words. **No "I have my backup file."** Both file inputs
(`identity-extras`, `screens-library`) live behind an account that already exists.

So the file that carries everything is unreachable at the only moment it matters. The workaround — create an
identity, then replace it — is exactly the mistake the welcome fork was built to prevent ("a member on a new
phone therefore started creating a SECOND identity by default").

### F2 — One flag means two different things, so the app cannot tell who is actually safe. HIGH.
`trinityone.backedup.<npub>` is written by *three* places: passing the wizard's word check, tapping "I've
saved these" in RecoverySheet, and completing a file export. The Today nudge reads that one flag.

So a member who saved a file but never wrote the words, and a member who wrote the words but has no file, are
indistinguishable to the app — and both are told they are covered. Whichever one they did first silences the
prompt for the other, permanently.

### F3 — Nothing verifies a backup. HIGH.
No path decrypts the file it just wrote. "Backup created" is asserted, never checked. Given that `saveFile`
was — until today — capable of reporting success having written nothing at all, an unverified claim is exactly
the wrong close for this feature.

### F4 — The passphrase is invited at 6 characters and refused at 12. HIGH.
`identity-extras.jsx` placeholder: *"Choose a PIN or passphrase (6+)"*. `checkPass` throws below `PASS_MIN`
(12). The member types six characters, is bounced, and has no idea by how much. This is the identical defect
the 2026-08-04 UX audit fixed **in the console** — which now reads the floor rather than restating it — and
the member screen was never brought along.

### F5 — Restore asks for the passphrase in a native OS prompt, before it has even looked at the file. HIGH.
`window.prompt('Enter the passphrase or PIN for this backup file:')` — a system dialog, passphrase **visible
in clear**, no masking, no paste affordance, no way to correct course. And it is asked *before* the file is
read, so picking the wrong file wastes the passphrase and produces a confusing error afterwards. The church
restore does the same thing (`stew-dashboard.jsx`).

### F6 — Restore failures are transient toasts. HIGH.
`ctx.toast(err.message || 'Couldn’t restore that file')`. "Wrong passphrase, or the file is damaged" appears
and disappears. On the one screen where a member is already anxious, the error must stay on screen next to the
field they can fix. `decryptStr` already distinguishes "that isn't a TrinityOne backup file" from "wrong
passphrase" — that distinction is thrown away by the shared toast.

### F7 — The overwrite warning is unreadable to the person it protects. MEDIUM.
A `window.confirm` wall of text containing `npub1x30fzpv0cs5xg…`. The mechanism is right (this replaces a
self-custodial key and the ugliness is deliberate) but the content is addressed to a developer. A member
cannot act on a truncated npub.

### F8 — The member is left to invent a passphrase, which is where they will fail. MEDIUM.
The copy says "four random words is ideal" and then offers a blank box. Choosing and *remembering* a 12+
character secret months later is the single likeliest way this feature fails in the field. A BIP-39 English
wordlist is **already bundled** (`vendor/identity.js`), so generating four words costs nothing.

### F9 — The church backup has the same shape at higher stakes. MEDIUM.
Same `window.prompt`, same lack of verification, one file, one steward, the whole congregation. Its
recovery-phrase restore is well guarded; the *file* path is not.

---

## 3. The recommended flow

Four principles, then the screens.

1. **One ceremony, two outputs, one piece of paper.** Stop presenting the words and the file as separate
   chores. They are one act: *make yourself recoverable*.
2. **Generate the passphrase; do not ask for one.** Choice is where non-technical people fail.
3. **Verify, then claim.** Read the file back and open it before saying it is saved.
4. **Restore is the flow that must be foolproof**, because it is used once, under stress, on a new phone, by
   someone who has just lost something.

### A. Backing up — one screen, replacing both

> **Keep your account safe**
> Two things, one evening, and you are covered.
>
> **1 · Write these 12 words on paper.** They bring back *who you are* — your name, your church.
> `[the 12 words]`  · [ I've written them down ]
>
> **2 · Save a file with everything in it.** It brings back *what you wrote* — your notes, journal and
> reading plans, as well as your account.
> Your file password (write this on the same paper):
> `harbour · candle · thistle · marrow`   [ Use different words ]
> [ Save to my phone ]   [ Save somewhere else… ]
>
> ✓ Saved to Documents/trinityone-backup-2026-08-16.json — **and checked: this file opens.**

Notes on each part:

* The passphrase is **generated from the bundled wordlist**, four words, and shown as part of the same paper
  ceremony. "Write this on the same paper" is the whole trick: one artefact, not two secrets in two places.
  Keep a "type my own" escape for the confident, but never make it the default.
* Track the two steps **separately** (F2). The nudge should say what is actually missing — "you have your 12
  words but no backup file yet" — not go quiet because one of them is done.
* **Verify before claiming** (F3): after `saveFile`, `readFile` + `decryptStr` with the passphrase just used.
  Say so. That one line is the difference between a promise and a receipt.
* Name where it went (already shipped today).

### B. Restoring — add the missing route, and put it first

"Bring your account back" becomes five routes, **ordered by the situation people are actually in**. Today it
leads with "I still have my old phone", which is useless in the common case (lost, stolen, broken, wiped):

> 1. **I have my backup file** — brings back everything, including your notes  ← *new, F1*
> 2. **I have my 12 words** — brings back your account and your church
> 3. **I still have my old phone** — move it across by scanning
> 4. **Someone set this up for me** — scan their code
> 5. **I've lost my 12 words** — ask your church to put you back

### C. The file-restore screen itself — in-app, in this order

The order is load-bearing. Today it is backwards.

1. **Choose the file.** Read it, and say what it is *before* asking for anything:
   *"This is a TrinityOne backup made on 16 August."* If it isn't, say so now — the member has spent nothing.
2. **Then ask for the password**, in an ordinary in-app field, masked, with a show/hide, and the hint
   *"the four words you wrote on your paper"*. Never `window.prompt` (F5).
3. **Errors stay on screen**, beside the field, and distinguish wrong-password from wrong-file (F6).
4. **Then confirm**, in plain words, in-app (F7):
   *"This phone will become **Sir Lloyd** again, and your notes will come back. Anything currently on this
   phone will be replaced."* Name the person, not the npub. Only show the "unrecoverable" warning when there
   genuinely is an account to lose.

### D. Do the same on the console for the church file (F9)
Higher stakes, identical shape. Plus one addition worth considering: a church whose key has **never been
verifiably backed up** should be told so persistently on the dashboard, not once in Settings.

---

## 4. Sequencing — if only some of this gets built

1. **F1** — the missing restore route. Everything else is polish next to a file that cannot be used.
2. **F5 + F6 + C** — the restore screen. This is the flow that runs under stress.
3. **F3 + F4** — verify the file; read the floor instead of restating it. Both small.
4. **F2** — split the flag, so the nudge tells the truth.
5. **F8 + A** — the generated passphrase and the merged screen. The biggest UX win, the most design work.
6. **F9** — the console.

Merging the two backup UIs (§A) is the natural moment to delete the duplicate, but it is also the riskiest
edit in the list — both copies contain security guards that were once fixed in only one of them. Do it as its
own change, with the guards enumerated first.

---

## 5. Decisions taken with the owner, 16 August

* **Keep the three-word check in Step ①, first time only.** It is the only thing separating "saw the words"
  from "wrote the words down"; repeating it on every settings visit is friction with no gain.
* **Generate the file password by default.** Four words from the BIP-39 wordlist already bundled in
  `vendor/identity.js`, shown as part of the same paper ceremony ("write this on the same paper"), with
  "type my own instead" kept as an escape. Choice is where non-technical members fail, so remove the choice.

### The reseated member keeps their picture — agreed, with conditions

A member reconnected by the church ("I've lost my 12 words") currently loses their picture **permanently**.
It lives in `av` inside their own kind-0, signed by the key they no longer hold; the new key has no kind-0, so
they fall back to a monogram, and if the phone is gone the photo is gone with it. The church already holds the
bytes — the console caches `m.av` / `m.hasPhoto` per member from those kind-0 events.

**Two implementations.**

* *Copy* the avatar into the reseat pair. `reseatMember` already writes `{ old, new, name, at }`, so `av` sits
  beside `name`. Simple — but the reseats list is ONE replaceable document that grows per reseat, and a
  cropped photo data-URI is tens of KB. Ten reconnections is a several-hundred-KB document republished on
  every roster change, over exactly the connections this product exists for.
* *Follow the pair* — **recommended.** The pair already records `old`, so anything drawing the new key can
  resolve the old key's cached avatar. No copy, no new document, no size cost, and it falls away by itself the
  moment the member's new phone publishes its own kind-0. The old kind-0 is replaceable and still stored, so
  it survives a console restart.

Check before committing: whether the MEMBER app can read the `reseats` document. If not, members would still
see a monogram while the console sees the picture, and the copy approach (bounded to non-photo avatars, or
with a size cap) becomes the fallback.

**Three conditions.**

1. **Safeguarding wins.** `suppressPhotoAv` is keyed on pubkey. Reseat writes the child marking BEFORE
   admission and throws if it fails, so the new key is marked before the pair lands — but the carried avatar
   must go through the same suppression at render time. A photo pre-dating the church turning children's
   photos off must not return through this door.
2. **Prefer the member's own assertion.** Following the pair keeps their own key as the source of their face.
   Copying makes the CHURCH key assert a member's photograph, so a seized church key yields a photo roster in
   one document instead of scattered kind-0s. Not new exposure; it is concentration, and this threat model
   cares about concentration.
3. **Let them decline.** A member reconnecting after a phone was taken at a checkpoint may not want their face
   reattached. One tickbox in the Reconnect modal — *"Bring their picture back too"*, on by default.
