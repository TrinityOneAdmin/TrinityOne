# Architecture audit — 2026-07-30, read-only

A re-run of the 2026-07-29 architecture pass. That pass produced two commits (`e26accf`, `c0cd4c0`) that
cite it as `ARCHITECTURE-2026-07-29` — **but the document itself was never written to disk**, so everything
from its recommendation 3 onward is unrecoverable. This file is written **incrementally, as findings land**,
precisely so that cannot happen twice.

**Fix nothing.** This is a read-only pass, run under the same instruction as
`reference/AUDIT-2026-07-28-READONLY.md`, because that convention worked: the value of that audit came from
being allowed to say "four of yesterday's fixes are wrong" without also being the one rushing to patch them.

---

## How to use this document

| Label | Meaning |
|---|---|
| **VERIFIED** | I ran the check myself, in this session, and saw the result. Evidence quoted. |
| **CLAIMED** | Read only. Plausible, unproved. **Reproduce it before you fix it.** |

A CLAIMED finding is a lead, not a fact. Acting on unverified claims is how new bugs were introduced all of
the week of 07-26.

### Scope

The three programs and the seams between them: the member app (`app/*.jsx` + `src/fellowship.src.js`), the
steward console (`app/stew-*.jsx` + `src/steward.src.js`), the relay (`scripts/gateway.mjs` +
`scripts/event-store.mjs`), and the build/deploy path that ships all three.

### Deliberately out of scope

- **Anything requiring a phone.** None of the 07-29 work has been on a device; a device pass is queued
  *behind* this audit. Where a finding can only be settled on hardware, it is marked as such and left there.
- **Re-raising known-open items.** F17 (`chatSeen` wiped on lock), F5 (public mirror ~174 commits behind),
  and S4/S6 (accepted, not dropped — every mitigation carried more risk than the finding).
- **Re-proposing what already landed.** `scripts/trinity-rules.mjs` (rec 1) and `scripts/trinity-doc-types.mjs`
  (rec 2) exist. The deferred *second half* of rec 2 — wiring the authorization spine to read from the
  registry — is explicitly in scope to re-rank.

### Starting state (measured, not quoted)

| | |
|---|---|
| `main` | `c0cd4c0` (+ `f028e77`, this session, committing the 07-28 audit that was still untracked) |
| Working tree | clean; no stashes |
| `npm test` | **639 pass, 0 fail, 0 skipped, exit 0** — run in this session (~2 min), not quoted |
| a8 `/status` | `c0cd4c0` at the start of the pass; **updated to `f028e77` mid-session** (owner-initiated). Both measured, not quoted. |
| Prior audits on disk | `AUDIT-2026-07-28-READONLY.md` (F1–F19), `AUDIT-2026-07-29-SECURITY.md` (S1–S6) |

---

## Findings

_Written as they land. Nothing here is fixed._

### A1 — Withdrawn files stay on a relay for ever, and the test that guards this is structurally blind to them

**VERIFIED, live, against a8 right now.** Nine files have been deleted from the repo since 2026-05-01 and sit
outside the denied directories. **Eight of the nine are still served**, on a box whose `/status` reports
`c0cd4c0` built `2026-07-29T14:41` — i.e. *after* the S2 reconcile fix landed at 13:44:

```
404      9 bytes   /app/landing-today.jsx
200 11,228 bytes   /app/screens-onboarding.jsx
200  2,650 bytes   /landing-app-today.html
200 37,720 bytes   /stew-finance.jsx
200 109,931 bytes  /vendor/react.development.js
200 1,080,227 bytes /vendor/react-dom.development.js
200 19,805 bytes   /vendor/steward-finance.js
200 1,091,718 bytes /welcome-app-today.png
200 37,164 bytes   /welcome-simple.html
```

**Severity, stated precisely — this is an assurance gap, not a live hole.** I checked the two stale files that
are directly loadable as pages. `landing-app-today.html` carries **no** inline script and no `on*=` handler
(it was CSP-fixed before it was deleted), a8 serves it under the full strict CSP
(`script-src 'self' 'wasm-unsafe-eval'`), and every `<script src>` in it points at `app/landing-today.js`,
which 404s. The page is inert. `welcome-simple.html` has no scripts at all. What is actually exposed is
**withdrawn application source** and two React *development* builds — old client logic, useful to someone
diffing for what got fixed, in the same way the audit documents were, but nothing executes.

**Why it will never clear on its own.** `scripts/relay-update.sh` (the S2 fix, `4cf91f7`) is deliberately
self-limiting and correctly so — it runs as root on boxes nobody can log into. It removes only files
**recorded in a previous run's manifest** that the new bundle no longer contains:

```sh
MANIFEST="$DIR/relay/installed-files.txt"
if [ -s "$MANIFEST" ]; then … comm -23 "$MANIFEST" "$NEWLIST" … else
  log "reconcile: no previous manifest — recording one, nothing removed this time"
fi
cp "$NEWLIST" "$MANIFEST"
```

The manifest is bootstrapped from **the current bundle**. A file installed before manifests existed and absent
from the bundle now can therefore never appear in *any* manifest, so `comm -23` can never emit it. The one
thing that covers pre-manifest leftovers is the explicit sweep beside it — and its class list is `*.md` plus
the `docs`/`reference`/`deploy`/`ci`/`relay-app/desktop` trees. **Withdrawn application source is in neither
set.** These eight files are permanent on every relay that already holds them.

The commit message anticipated exactly half of this ("Leftovers installed before manifests existed are NOT
cleaned up by this — see the explicit sweep below"). The gap is that the sweep's classes were chosen as
"internal documentation and build/deploy descriptors", and the class that is actually still live on a8 is
neither.

**CONFIRMED BY PREDICTION, not by reading.** a8 updated during this audit (owner-initiated, mid-session). That
update ran the **new** `relay-update.sh` — reconcile included — for the first time. Before it completed I
wrote down the prediction this analysis implies: *the first reconcile run writes a manifest and deletes
nothing on that basis, and the explicit sweep covers only `*.md` and those five directories, so all eight
files should still be served afterwards.* Measured after a8 came back up on `f028e77` (uptime 97s):

```
200 11,228     /app/screens-onboarding.jsx        200 1,080,227  /vendor/react-dom.development.js
200 2,650      /landing-app-today.html            200 19,805     /vendor/steward-finance.js
200 37,720     /stew-finance.jsx                  200 1,091,718  /welcome-app-today.png
200 109,931    /vendor/react.development.js       200 37,164     /welcome-simple.html
```

Eight of eight, unchanged, across a complete update cycle. This is no longer inferred from the shell script —
it is an observed property of the deployed system.

**The part that matters more than the eight files.** `scripts/no-internal-docs.test.mjs` is the property test
that asks "what does the relay serve?" — the one written specifically because the 07-06 fix "named one
directory rather than asking what else the bundle contains". It enumerates:

```js
const tracked = execSync('git ls-files', …)
```

`git ls-files` lists what is tracked **now**. A file the repo has deleted is, by construction, not in that
list, so the sweep at line 106 — the one that measured "220 of 447 were served" and is the strongest test in
the suite — **cannot see a single one of these eight.** The test's own allowlist (`SERVE_OK`) is a genuine
default-deny and is the right shape; it is pointed at the wrong universe. It measures the repo, not the box.

So the standing claim "we know what a relay serves" is not supported by anything currently running. It is
supported for tracked files only.

**Fix direction (not applied).** Two independent halves, and they are worth separating:
1. Give the test a second universe: enumerate what the *box* has (or at minimum
   `git log --diff-filter=D --name-only` over the release history) and assert those 404 too. This is the half
   that stops the class recurring, and it is verifiable on the dev box with no phone.
2. Decide whether the sweep should cover withdrawn app source. Note the tension the commit already reasoned
   about: an earlier draft's blanket sweep would have deleted a self-hoster's own `docker-compose.yml`. A
   manifest seeded from `git ls-files` at a known release, rather than from the live bundle, would close the
   bootstrap gap without widening what the script is willing to delete — that is the smaller, safer change.

**Do not** treat this as urgent on the basis of the eight files. Treat it as urgent on the basis that the next
file withdrawn *for a security reason* will behave identically, and the test will report green.

### A2 — The console can tell a steward a write failed. The member app has no way to tell anyone anything.

**VERIFIED by measurement.** The two engines are the same shape and the same age, and only one of them grew a
channel for reporting failure. Every `CustomEvent` each dispatches:

```
src/steward.src.js  (console)          src/fellowship.src.js  (member app)
  steward-key            × 6             trinity-profiles        × 8
  steward-write-blocked  × 4  ← failure  trinity-relays          × 1
  steward-relays         × 4             trinity-reconnect       × 1
  steward-networks       × 3             trinity-guardian-added  × 1
  steward-publish-ok     × 1             trinity-church-trust    × 1
  steward-publish-error  × 1  ← failure
  steward-profile        × 1
  steward-needs-pin      × 1
  steward-identity       × 1
```

The console has **three** failure channels, wired to a banner at `app/stew-dashboard.jsx:168-174`, and they
are used for exactly the right things — a refused journal entry, a refused join policy, a safeguarding
clearance back-fill that the relay would not take. The member app has **zero**. All five of its events are
data-update notifications. There is no path by which the member app can say "that did not work".

This is the architectural root of the failure class the project already knows is its worst: *looks normal,
shows nothing*. The mechanism is well documented in the code itself —
`src/fellowship.src.js:1126`, the shared docs bus that nearly every member feature registers on:

```js
try { h.onevent(e, d); } catch (err) { console.error(err); }
```

A throw inside one feature's handler is caught, logged to a console **that does not exist on a phone**, and
the loop continues. The feature yields an empty result rather than a broken one, so it looks like "this church
has no groups" instead of "this code threw". That is precisely how the member-restore bug survived for its
entire life, and the same shape is recorded against family rebuild and the blank-names failure.

Supporting measurement, all run in this session:

| | empty `catch {}` (swallow, no log) |
|---|---|
| `src/fellowship.src.js` | 176 |
| `src/steward.src.js` | 166 |
| `scripts/gateway.mjs` | 152 |
| the four smaller engines | 37 |
| **total** | **531**, against **46** catches anywhere that log at all |

**I am not claiming 531 bugs.** Most are `try { JSON.parse(…) } catch {}` around untrusted relay content,
where skipping a malformed event is exactly right. The finding is that **nothing distinguishes the two
cases**: "I deliberately skipped a malformed event" and "my code threw" produce byte-identical observable
behaviour, which is none.

**One correction to my own working assumption, worth recording.** I expected to find no global handler at all.
There is one, `src/fellowship.src.js:596-601` — and it is a *suppressor*, not a reporter:

```js
window.addEventListener('unhandledrejection', (e) => {
  const m = e && e.reason && (e.reason.message || String(e.reason));
  if (m && /auth[\s-]?(timed out|required|failed)|no key/i.test(m)) e.preventDefault();
});
```

Its purpose is legitimate and the comment above it is sound (a best-effort NIP-42 handshake must not surface
as an uncaught error). But the only global error hook in the member app exists to make a class of error
quieter, and there is nothing anywhere making any class louder. The relay, by contrast, does register both
`unhandledRejection` and `uncaughtException` (`scripts/gateway.mjs:25-26`) — so of the three programs, the one
running on twenty people's phones is the only one with no failure reporting of any kind.

**Fix direction (not applied).** Mirror what the console already has rather than inventing anything: a
`trinity-write-blocked` / `trinity-feature-failed` event and one banner. The cheap, high-value first step is
narrower still — make the docs-bus catch at `:1126` dispatch as well as log, so a handler that throws is
attributable to a feature by name. That is a small change to one dispatcher, it needs no new UI to be useful
in a device session, and it is independently verifiable: sabotage one handler, watch the signal appear.

**Device-gated caveat:** whether the resulting banner is *usable* is a design question that needs the phone
pass, not this audit. The plumbing is not.

### A3 — Rec 1 fixed the rule in both engines. The console's *UI* still keeps nine private copies of it.

**VERIFIED as a divergence. NOT live today — I could not construct a path to trigger it, and I say so below.**

`scripts/trinity-rules.mjs` exists because two copies of photo suppression disagreed about pubkey
normalisation. `scripts/shared-rules.test.mjs` then pinned the fix — and its scope is exactly three files:

```js
const F = read('src/fellowship.src.js');   // the member engine
const S = read('src/steward.src.js');      // the console engine
const R = read('scripts/trinity-rules.mjs');
// + vendor/fellowship.js and vendor/steward.js, to catch a stale bundle
```

It never reads `app/`. And `app/stew-dashboard.jsx` — the members screen, where a steward actually operates
every one of these controls — builds its own membership sets straight from the raw lists:

```js
149,1505,3239  const blockedSet  = new Set(blockedList);                    // raw
148,1504,3326  const admittedSet = new Set(…useStewardAdmitted());          // raw
3242           const minorsSet   = new Set(sg.minors   || []);              // raw
3243           const approvedSet = new Set(sg.approved || []);              // raw
3244           const nophotoSet  = new Set(sg.nophoto  || []);              // raw
```

…against exactly one that does it properly, 90 lines above the first raw copy:

```js
240  const blockedSet = React.useMemo(() => new Set((blockedList || []).map(p => String(p || '').toLowerCase())), [blockedList]);
241  const notBlocked = (pk) => pk && !blockedSet.has(String(pk).toLowerCase());
```

So `blockedSet` is built **four times in one file from the same source list**, and one of the four normalises.
That is rec 1's defect class verbatim, one layer up from where rec 1 looked.

**The sharpest single artefact — two lines of one function that cannot both be right.** In `block()`, the
handler that removes a member and rotates every encrypted-group key away from them:

```js
3353  const remaining = members.map(m => m.pubkey).filter(p => p && p.toLowerCase() !== String(pk||'').toLowerCase() && !blockedSet.has(p));
3381  const recips = (g.visibility === 'invite' ? (g.members||[]).filter(p => p !== pk && !blockedSet.has(String(p||'').toLowerCase())) : remaining);
```

Line 3353 queries the **unnormalised** set with a **raw** key. Line 3381 queries the **same unnormalised set**
with a **lower-cased** key. Whatever the intended rule is, these two express different ones. If the blocklist
ever held a non-lower-case pubkey, line 3381 would fail to find it and that member would be included in
`recips` — i.e. **handed the freshly rotated key to the encrypted group they were just removed from**. The
twenty lines of comment immediately above exist to prevent precisely that outcome ("a blocked person's phone
carried on decrypting every future message in every encrypted group — forever. AUDIT-2026-07-27").

**Why it is not live, stated as precisely as the finding.** I traced every writer. `setBlocked` is called from
two places only (`stew-dashboard.jsx:3351`, `:3397`), both passing `m.pubkey` taken from the members roster,
which comes from signature-verified relay events and is therefore lower-case hex. `setBlocked`
(`steward.src.js:1819-1825`) and `setNoPhoto` (`:1870-1874`) both publish the list verbatim with no
normalisation, but nothing upstream can hand them anything else: **there is no `nip19`/npub→hex conversion
anywhere in `app/stew-dashboard.jsx`** (grep returns nothing), so no typed or scanned key reaches these
lists. The relay normalises independently via `toHexPub` on ingest, so relay-side enforcement is correct
regardless. **Today the data cannot diverge.**

That is exactly what made the original photo-suppression bug so quiet: it also could not diverge, until the
day someone added a second way to get a pubkey into a list.

**No test covers any of this.** `grep -n 'nophotoSet\|minorsSet\|approvedSet' scripts/*.test.mjs` returns
nothing at all. The shared-rules test asserts the two engines route through the shared module, which is true
and which the commit message correctly called the important half — but "both engines import it" is not the
same claim as "every surface that decides this question uses it", and the console UI is a surface that
decides this question nine times.

**Fix direction (not applied).** Do not mass-rewrite nine call sites — that is the big-bang extraction the
rec-1 commit deliberately avoided. Two smaller steps, in order:
1. **Make line 3381 agree with 3353.** One of them is wrong on its face; that is a one-line change with a
   decidable answer, independent of everything else.
2. **Widen the shared-rules test to `app/`**, asserting that no `.jsx` builds a pubkey membership set with a
   bare `new Set(` over these lists. That converts the whole class from "someone must remember" into a gate,
   and it is a test-only change — no runtime risk, verifiable on the dev box.

### A4 — The documented self-host installer is broken on the domain it is documented with. The route answers 200 with an empty body.

**VERIFIED, live, reproduced three times, with the relay healthy throughout.**

```
                                        /relay-app/bundle.tgz     /relay-app/bundle.sig
app.trinityone.church   (public, a8)    200 —          0 bytes    404 — "no signature (this host has no release key)"
trinityone.tailbeaac0…  (origin, here)  200 — 52,505,809 bytes    200 — 64 bytes
```

`/status` on a8 answered 200 throughout, so this is not the update blip. Three consecutive polls, ~1s each,
all 200 with `content-length: 0`.

**The mechanism**, `scripts/gateway.mjs:2409-2424`. The route tries the signed cache, and when there is no
release key it falls back to streaming `git archive` — but it writes the success header *before* it knows
whether that will work:

```js
const b = ensureSignedBundle();
if (b && existsSync(b.tgz)) { … return; }                       // release host: fine
res.writeHead(200, { 'Content-Type': 'application/gzip', … });   // ← 200 committed HERE
const git = spawn('git', ['-C', ROOT, 'archive', '--format=tar.gz', 'HEAD'], …);
git.stdout.pipe(res);
git.on('error', () => { try { res.destroy(); } catch {} });
git.on('close', (code) => { if (code !== 0) { try { res.destroy(); } catch {} } });
```

A relay box is installed by untarring a bundle, so it has no `.git` and `git archive` cannot succeed. By the
time that is known the 200 is already on the wire, and all the handler can do is destroy the socket — which
through the tunnel arrives as a clean, empty, successful response. **A failure is indistinguishable from a
zero-byte release.**

**Its own neighbour gets this right.** Four lines below, `/relay-app/bundle.sig` asks the same question and
refuses honestly:

```js
if (!b || !b.sig || !existsSync(b.sig)) { res.writeHead(404, …); res.end('no signature (this host has no release key)'); return; }
```

Same file, same author, same concern, adjacent routes — one refuses, one pretends. This is the "the rule was
applied here and not to its neighbour" class that `scripts/trinity-rules.mjs` was created for, and it is
sitting in the release path.

**Why this matters more than it looks.** `relay-app/install.sh:25` defaults to the broken host:

```sh
SRC="https://app.trinityone.church"
```

and three separate places in the served pages publish exactly that one-liner (`app.trinityone.church` ×3,
the origin funnel ×2). The installer's fetch cannot detect it, because `curl -f` only fails on an HTTP
error status and this is a 200:

```sh
curl -fsSL "$SRC/relay-app/bundle.tgz" -o "$TARBALL" || die "couldn't download the code bundle from …"
tar -xzf "$TARBALL" -C "$DIR" … || die "couldn't unpack the code bundle"
```

**It does fail safe — I checked rather than assumed.** `tar -xzf` on a zero-byte file exits 2
(`gzip: stdin: unexpected end of file`), so the installer dies at the unpack step. Nothing is half-installed.
But it dies with "couldn't unpack the code bundle", which points at the tarball rather than at the host, and
`/relay-app/install.sh` **is** served from that domain (200, 13,096 bytes) — so the documented path leads
someone all the way to a misleading error.

**Net: the entire published self-hosting route is non-functional on the advertised domain right now.** For a
product whose premise is that a church holds its own relay, and with a pilot onboarding, that is a
product-blocking defect. It is not a security hole — nothing leaks, nothing half-installs.

**Relay self-update is unaffected**, and it is worth saying so explicitly: `relay-update.sh` pulls from
`$ORIGIN`, which for a8 is the funnel, which serves the real 52 MB bundle. That is why this has been invisible
— the path that runs every day works, and only the path a new self-hoster takes is broken.

**Fix direction (not applied).** Make the fallback prove it can produce bytes before committing a 200 —
buffer or probe `git archive` first, and 404 with a plain reason the way `/bundle.sig` already does. A relay
that is not a release host should say so, not emit an empty release. Verifiable with one curl against a8
after deploy, no phone needed.

### A5 — The bundle's exclusion list is a denylist, and it disagrees with the static handler about what is sensitive

**VERIFIED against the real released bundle** (52,505,809 bytes, downloaded from the origin funnel and listed;
386 files, **0 markdown** — the 07-28 F2 fix is genuinely holding for documents).

But the two routes that expose this repo now enforce two different, hand-written rules, and the *bundle* — the
one that is world-downloadable and that every self-hoster and every self-update consumes — has the weaker one.
Everything below **ships in the public bundle** and is **explicitly 404'd** by the static handler:

| shipped in bundle | static handler | |
|---|---|---|
| `scripts/` — **144 files, of which 92 are `*.test.mjs`** | `DENY_DIR` has `scripts` | |
| `src/` — 14 files | `DENY_DIR` has `src` | unbundled engine source |
| `package-lock.json`, `package.json`, `capacitor.config.json` | named 404 list | "fingerprints every dependency and its exact version" |
| `relay-app/desktop/src-tauri/{Cargo.toml,build.rs,src/main.rs}` | `/relay-app/desktop/` prefix 404 | |
| `.github/workflows/{test,ios,relay-desktop}.yml` | `DENY_EXT` has `.yml` | |

**The part that undoes F2's intent.** F2 was raised because the bundle carried documents that "name
vulnerabilities and the dates they were introduced". The documents are gone. The **test files that describe
the same vulnerabilities are not**: 52 of the 92 shipped `*.test.mjs` files carry audit narrative, and the
finding IDs they name include

```
AUDIT-2026-07-20 C2/E1 · AUDIT-2026-07-24 FINDINGS · AUDIT-2026-07-26 CRITICAL/S5
AUDIT-2026-07-28 F1 F2 F3 F6 F7 F9 F10 F11 F12 F14 F15 F18 F19 · AUDIT-2026-07-29 S1 S2
```

These are not terse references. The headers of these files are the same prose as the audit documents — what
the hole was, when it was introduced, what was measured, and in several cases what is still only partly
fixed. Removing `AUDIT-2026-07-28-READONLY.md` from the tarball while shipping 52 files that narrate F1–F19
is not a meaningful reduction in what an attacker learns.

**Why the class is open, not just these files.** The exclusion is a denylist in both layers:

```
.gitattributes            docs / reference / deploy / ci / *.md  export-ignore
bundle-contents.test.mjs  assert no *.md, no ^(docs|reference|deploy|ci)/, plus a NAMED file list
```

Its sibling `no-internal-docs.test.mjs` guards the *served* route with a genuine allowlist (`SERVE_OK`, with
"anything not covered has to be justified before it gets added — which is the point"). The bundle route, whose
blast radius is larger, got the denylist. A new `notes/`, `audits/` or `handover/` directory — or any internal
material without a `.md` extension — ships publicly and both layers stay green.

**Fix direction (not applied).** Give `bundle-contents.test.mjs` the same shape its sibling already has: an
allowlist of what a relay needs in order to run, asserted against the real tarball, with everything else
requiring a stated reason. Then decide `scripts/*.test.mjs` deliberately — a relay does not need the test
suite to run, and `MUST_SHIP` already enumerates what it does need. Both halves are dev-box verifiable.

### A6 — The doc-type registry declares 55 types. There are at least 65, and the missing ten include the ones whose exposure was a CRITICAL

**VERIFIED by running the registry's own `describe()` against literals taken from files it does not read.**

This is the re-rank the brief asked for, and it changes the answer — but not in the direction I expected.

`scripts/trinity-doc-types.mjs` is described as declaring "all 55" kind-30078 document types.
`scripts/doc-registry.test.mjs` then guards it. Its extraction is:

```js
const literals = (src) => new Set([...src.matchAll(/'((?:trinityone|finance)\/[a-z-]+:?)'/g)].map(m => m[1]));
const G = literals(GATEWAY), F = literals(FELLOWSHIP), S = literals(STEWARD);
```

Three files: `scripts/gateway.mjs`, `src/fellowship.src.js`, `src/steward.src.js`. Those are exactly the three
files the registry was *built from*. So the guard's universe is the same as the registry's universe, and by
construction it can never discover a document type that lives anywhere else. Asking the registry about the
literals in the files it does not read:

```
finance/account:           *** NOT IN REGISTRY AT ALL ***      app/stew-finance.jsx:559
finance/fund:              *** NOT IN REGISTRY AT ALL ***      app/stew-finance.jsx:560
finance/settings           *** NOT IN REGISTRY AT ALL ***      app/stew-finance.jsx:558
trinityone/manna-          *** NOT IN REGISTRY AT ALL ***      src/steward-manna.src.js:27
trinityone/highlights      *** NOT IN REGISTRY AT ALL ***      src/mydata.src.js:58
trinityone/bookmarks       *** NOT IN REGISTRY AT ALL ***      src/mydata.src.js:59
trinityone/notes           *** NOT IN REGISTRY AT ALL ***      src/mydata.src.js:60
trinityone/journal         *** NOT IN REGISTRY AT ALL ***      src/mydata.src.js:61
trinityone/prayer          *** NOT IN REGISTRY AT ALL ***      src/mydata.src.js:62
trinityone/settings        *** NOT IN REGISTRY AT ALL ***      src/mydata.src.js:63
finance/journal:           declared (steward/church)           — the only one of the eleven that is
```

Not "declared as undeclared" — the registry has an explicit `UNDECLARED` list for the six types the 07-29 pass
knowingly could not place, and these ten are not in that either. They are simply outside its field of view.
**The real count is at least 65, not 55.**

**These are live relay documents, not local state.** I checked, because "MyData is local-only" would have made
this a naming curiosity. `src/mydata.src.js` owns its own `SimplePool`, signs with `finalizeEvent`, and
publishes each of those six as kind-30078 to every relay in the pool.

**And they are the exact types whose exposure was a CRITICAL two weeks ago.** From the file's own header:

> anonymous REQ for `#d=trinityone/highlights` returned a list of every member pubkey (plus which verses each
> highlighted, and when). That is the same arrest list the 07-13 roster gate removed, re-exposed through a
> d-tag nobody thought of as sensitive. `settings` compounded it by carrying `plansFollowed` — church-published
> plan ids, which bind a pubkey to a SPECIFIC congregation.

`SECURITY-AUDIT-2026-07-20 C1`. So the registry — whose entire purpose is "a document type nobody thought
about is where the next leak comes from" — omits the six types that most recently proved that thesis.

**They are safe right now, and I want that stated as precisely as the 07-29 commit stated its own version.**
All six publish with `priv: true` (NIP-44 sealed to the author's own key), and the relay's d-tag read gate is
default-DENY with a public allowlist, so an unknown prefix is refused rather than served. I have not found a
way to read another member's `trinityone/notes`. This is an **assurance gap**, not a live hole — the same
sentence the 07-29 pass wrote about its six, now applying to ten more that it did not know were there.

**What this does to the re-rank.** The brief flagged rec 2's deferred second half — wiring the relay and both
engines to read their constants from the registry — as "a live candidate for this audit to re-rank". My answer:

**Do not wire the spine yet. Fix the registry's coverage first.** The reasoning is evidence, not caution:

1. **Wiring a registry that is missing 15% of the real vocabulary would be actively harmful.** It would move
   the authorization spine onto a declaration that has never seen `trinityone/notes` — converting today's
   quiet assurance gap into a load-bearing one, on the code path where being wrong is worst.
2. **The measured drift rate is zero.** I extracted the d-tag vocabulary of all three surfaces independently,
   with a different regex from the registry's, and the only mismatch is the six already-known undeclared
   types — no new drift, and no client publishing under a name the relay gates differently. The typo risk the
   wiring would eliminate is real but has not once occurred. That is a poor trade against a behaviour-changing
   edit to `accept()`/`canRead()` that the brief itself says needs a phone attached.
3. **Widening the extraction is cheap, safe and dev-box verifiable.** Point `literals()` at every file that
   publishes or gates a d-tag — `app/*.jsx`, the four smaller engines — and add digits to the character class
   (`[a-z0-9-]`, which the current pattern excludes). Then declare what falls out. No runtime behaviour
   changes at all.

The 07-29 commit was right that declaring before wiring was the correct order. The finding is that the
declaration is not finished, and the check that was supposed to prove it was finished inherited the same
blind spot — which is the same shape as F13/F1 from 07-28: **a green test standing over an incomplete fix,
because the test asks the question the fix was shaped by.**

<!-- A7 onward -->

---

## What I could not break

_Recorded deliberately. A finding list with no denominator reads as if everything is broken._

- **Both previously-inverted gates are genuinely default-deny, and stayed that way.** The brief said "the kind
  gate and the d-tag gate have each been inverted; assume there is a third." I checked both rather than
  trusting the record. The kind gate now ends `if (e.kind !== 1) return !!authed && authed === e.pubkey;`
  (`gateway.mjs:1701`) — closed, with the deliberate "your own events stay yours" exception. The kind-30078
  gate is own-event → explicit public allowlist → authenticated member/steward/care-admin/owning church, and
  nothing else. Neither has regressed.
- **I found the third denylist, and it is not where it was expected.** It is not another read gate — it is
  `.gitattributes` + `bundle-contents.test.mjs` (A5). The *served* route's guard, which looks like the obvious
  candidate, turned out to be the well-built one: `no-internal-docs.test.mjs` enforces a real allowlist
  (`SERVE_OK`) with each exception justified by name, tests each layer of the fix in isolation with
  purpose-built probe files, and explicitly asserts the app still works so the rule cannot be over-tightened.
  That is the best-guarded surface I looked at all pass. Its only defect is the universe it enumerates (A1).
- **Rec 1 is genuinely wired, not decorative.** Both engines import `scripts/trinity-rules.mjs`, both call
  through it, and — the part that usually rots — **both shipped `vendor/` bundles actually contain it**, which
  I confirmed by grepping the built artefacts rather than the sources. The console's badge renderer
  (`SkBadge`, `app/stew-data.jsx:121-128`) does consult `window.Steward.photoSuppressed`, so the F6
  safeguarding display bug is genuinely closed on the render path. A3's divergence is in the *controls* beside
  it, not the display.
- **No live d-tag drift between the three main surfaces.** I extracted every `trinityone/` and `finance/`
  literal from `gateway.mjs`, `fellowship.src.js` and `steward.src.js` with my own regex, independently of the
  registry's, and diffed the vocabularies. The only mismatch is the six types the 07-29 pass already recorded
  as undeclared. No client publishes under a name the relay gates differently. The typo risk rec 2 exists to
  prevent has not yet materialised anywhere — which is a real finding in its own right, and is why A6 argues
  against wiring the spine right now.
- **My extraction independently reproduced the 07-29 pass's six undeclared types** — `checkin:`, `groupkey:`,
  `msgtags`, `sermon:`, `wallet:`, `backup-meta:` — exactly, from a different starting point. That is a
  meaningful cross-check on that pass's method, and the reason I trust its numbers where I could not re-derive
  them.
- **The 07-28 F2 document leak is closed on the artefact, not just in the code.** I downloaded the real 52 MB
  released bundle from the origin funnel and listed it: **386 files, 0 markdown**. What is left is a different
  class of content (A5), not a failure of that fix.
- **`relay-update.sh`'s reconcile is careful in the direction that matters.** It is easy to read
  "deletes files" and worry. It deletes only what a previous manifest recorded, skips `relay/` and
  `node_modules/` throughout, removes nothing when the bundle cannot be listed, and removes nothing at all on
  its first run. Its restraint is the reason A1 exists, and I would not trade the restraint away to fix A1.

---

## Suggested order

_Not a bare severity list — an order that keeps each step independently verifiable. Every item below is
dev-box verifiable; none needs the phone. Do not batch them: a batch that ships together cannot be bisected._

1. **A4 — the empty-200 bundle route.** Live, reproduced, and it breaks the product's headline capability
   (a church self-hosting) on the domain the docs point at. Independent of everything else, one curl to
   verify, and the correct shape is already written four lines below the bug.
2. **A6 — widen the registry's extraction before anything is wired to it.** Test-and-declaration only, no
   runtime change. Do this *before* any spine work, because wiring to a registry missing ten live types would
   make things worse. Ten types to declare, and the answer for each is readable out of `accept()`/`canRead()`.
3. **A1 — point the served-files test at the right universe.** Add deleted-file history (or the box's actual
   contents) to `no-internal-docs.test.mjs`. This is the half that stops the class recurring; do it before
   deciding whether to widen the sweep, because the test tells you how big the problem actually is.
4. **A5 — turn `bundle-contents.test.mjs` into the allowlist its sibling already is.** Then decide
   `scripts/*.test.mjs` deliberately. Ranked below A1 only because A1's fix will inform what belongs here.
5. **A3 — reconcile `stew-dashboard.jsx:3381` with `:3353`.** One line, a decidable answer, no data
   dependency. Then widen the shared-rules test to `app/` so the class is gated rather than remembered.
6. **A2 — give the member app a failure channel.** Largest change and the only one with a UI question in it.
   Start with the docs-bus catch at `fellowship.src.js:1126` dispatching as well as logging; that alone is
   verifiable by sabotage on the dev box, and it is the piece that makes the queued device pass far more
   informative than it would otherwise be.

**One thing to carry into the device pass rather than act on here:** A2's plumbing is a dev-box change, but
whether the resulting signal is *usable* by a member is a design question that needs the phone. None of the
07-29 work has been on hardware yet, and nothing in this audit changes that ordering.

---

## What the pattern says

Three of the six findings are the same shape, and it is the shape both prior audits named:

- **A1, A5, A6 are each a guard whose universe is smaller than its claim.** `no-internal-docs.test.mjs` asks
  git what is tracked and calls it "what the relay serves". `doc-registry.test.mjs` reads the three files the
  registry was built from and calls it "every document type the code uses". `bundle-contents.test.mjs` names
  four directories and an extension and calls it "no internal documentation". Each is a good test. Each
  answers a narrower question than the sentence written above it.
- **A4 and A3 are "the rule was applied here and not to its neighbour"** — the class `trinity-rules.mjs` was
  created for, still producing defects two adjacent lines apart (`bundle.tgz` vs `bundle.sig`;
  `stew-dashboard.jsx:3353` vs `:3381`).
- **A2 is why all of the above stayed quiet.** The one program with no way to report a failure is the one
  running on twenty people's phones.

The encouraging half: the security *reasoning* in this codebase is strong and getting stronger — the two
inverted gates stayed inverted, the shared rule is really wired into the shipped bundles, and the
served-files guard is genuinely well built. What repeatedly falls short is not the fix but **the scope of the
check that vouches for it**. Every item in the order above is a scope correction, not a redesign.
