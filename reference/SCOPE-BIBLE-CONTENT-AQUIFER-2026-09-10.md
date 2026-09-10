# Scope: Aquifer Bible content — study resources, texts, mirroring, audio

Written 2026-09-10. Owner decisions taken in conversation the same day and recorded verbatim below.
Every technical claim marked "measured" was executed against the repo or the GitHub API on 2026-09-10;
anything reasoned is marked so.

## What Bible Aquifer is

An open-licensed Bible content library (github.com/BibleAquifer, ~40 repositories, contact
rbrannan@gloo.us). It is NOT primarily another Bible text source — it is study resources keyed to verse
references, plus a smaller set of Bible texts.

- **Aquifer Open Study Notes** — Tyndale Open Study Notes (© 2023 Tyndale House) adapted by Mission
  Mutual. **CC BY-SA 4.0.**
  ⚠ **10 language directories, not 11 — measured 2026-09-10, correcting an earlier claim in this doc and in
  conversation.** On disk: `arb eng fra hin ind por rus spa swh zht`. The README advertises Tok Pisin but
  there is **no `tpi/` directory**, and it calls `zht` "Simplified Chinese" while `zht` conventionally means
  Traditional. **Check with the source before promising a language count to anyone.** Slice-2 problem.
- **Berean Standard Bible** — **CC0 public domain**, shipped as USFM *and* USX, with word-level
  `alignments/` and `audio/` alongside.
- Other texts: Arabic Van Dyck, Biblica New Arabic 2012, Chinese Union Traditional, Hindi (Gateway
  Literal/Simplified, Open Hindi Contemporary), Indonesian (Gateway Literal/Simplified), Nepali (Unlocked
  Literal, Biblica Open Contemporary), Open Kiswahili Contemporary, unfoldingWord Literal, PSLE, IRV.

## Owner decisions — 2026-09-10

1. **Resources in scope:** dictionary, translation notes, book intros, key terms, character profiles, maps.
   Images and video **later**. (The named intros/key-terms/profiles repos are sub-resources of the study
   notes family, so the core study notes are in scope too — confirmed with the owner in the same exchange.)
2. **Languages: ALL of them.** "no point holding back on that imo." (See the corrected count above —
   10 shipped directories, not the 11 the README advertises.)
3. **Their Bible texts only where notes exist in that language**, so text and notes agree on versification.
4. **A relay operator CHOOSES whether to host.** Not automatic, not all-or-nothing.
5. **Attribution on the TrinityOne marketing site AND in the Study panel.** Placement in the panel open to
   suggestion.
6. **Share-alike:** reformatting into our module container is not an adaptation (container change, words
   untouched — cf. Word→PDF). Share-alike binds adapted *content*, never TrinityOne's code. Mitigation is to
   ship the licence notice inside each module and display attribution. Do not blend differently-licensed
   content into one module file.
7. **Rebuild on a NEW branch.** Do not merge `blossom/module-distribution` (2026-07-19, untested, 8 weeks
   of relay work behind it).
8. **Audio: yes. Alignment: yes** — see the note on why it matters below.
11. **Cross-book passage associations are HONOURED, not filtered** (owner, 2026-09-10: "those sound like
    cross references of some kind. probably fine."). Five English articles carry a passage association
    pointing into a different book from the file they sit in — the note titled "Numbers 6:1-21" is
    associated with Acts 18:18 (Paul's vow), "Acts 14:4" with Luke 10:1. These are read as the source's
    deliberate claim that a note is worth reading at that passage too, and are filed where the association
    says rather than where the filename says. Do NOT add a filename filter in a later slice.

10. **Ship alignment WITH a provenance line** (owner, 2026-09-10): "yeah, ship with the line, its fair."
    The alignment is LLM-generated (see slice 4, item 3). It ships, and it carries a short disclosure where
    the word appears — wording along the lines of *"word links are machine-generated and may be wrong."*
    Rationale the owner accepted: a reader doing word study for a sermon cannot detect a wrong link, because
    not reading Hebrew is the reason they tapped. Mission Mutual recorded the provenance honestly in the
    file; we pass that on rather than launder it. The rejected alternative was holding alignment back until
    source tokens can be tied to scholar-made Strong's data.

9. **Alignment interaction: TAP THE WORD ITSELF** (owner, 2026-09-10), not the Strong's superscript.
   The cheaper option was rejected: baking alignment into an AKJV+S-style tagged module would have reused
   the existing `sup.st` tap path with zero reader changes, but a superscript is a fiddly target under a
   thumb. **Consequence for slice 4: this is NOT a build-script-only change.** Each word must become its
   own tappable element, so the aligned data has to reach the reader per word rather than as embedded
   `<WG25>` markup — a different module shape from the rejected option. Do not start slice 4 by generating
   a tagged module.

## Why the fit is unusually clean — all measured

- **Their study-note content is already HTML.** Sample article body: `<ul><li><p><em>The elder</em>: …`.
- **Our sanitiser already permits every tag they use** (`engine.js:8` — `UL OL LI P DIV BLOCKQUOTE SPAN SUP
  SUB EM I B STRONG SMALL` …). It drops `A` and `IMG`, which suits the anti-beacon rule
  (`engine.js:~30`, safeImgUrl/safeCssColor).
  ⚠ **CORRECTED 2026-09-10 (slice-1 build, measured):** an earlier draft of this doc said "links become
  plain text; nothing breaks". **That is wrong** — `A` is in `sanitizeHtml`'s `DROP` set, so an `<a>` is
  removed **together with its content**. There is exactly one `<a>` in the English notes (1 Cor 11) and it
  wraps a space between two italicised phrases; left alone it would have joined two words together. The
  converter must unwrap `<a>` at build time and keep the text.
  ⚠ **The cross-reference markup is `<data class="bible-ref">`, not `<a>`** — 39,110 of them in English,
  plus 1,298 `<data class="resource-ref">`. `data` is not in the allowlist, so it is unwrapped (text kept).
  Unwrapping at build time is also worth 3.3 MB of the artefact size.
- **Verse keys match ours exactly.** Their `associations.passage[].start_ref` is `BBBCCCVVV`
  (e.g. `63001001` = 2 John 1:1) and `bookName = n => BOOK_NAMES[n - 1]` (`engine.js:66`) proves our
  `loc.book` is 1-based too. **No off-by-one** — the failure that would otherwise put every note one book out.
- **One file per Bible book** (`eng/json/01.content.json` … 66 files), which is the download granularity we
  want anyway.
- **Our commentary loader sniffs column names** (`engine.js:270-282`): book|booknumber,
  chapter|chapternumber|chapterbegin|fromchapter, fromverse|versebegin|verse|versenumber, toverse|verseend,
  comments|data|text|commentary|definition. So a converted module needs only
  `book, chapter, fromverse, toverse, comments`.
- **Their Bible texts are USFM** (`eng/usfm/01GENBSB.SFM`), and our installer already ingests a zip of USFM
  books or a single loose one (`engine.js:~373`, `buildFromUSFM`).
- **The module system already exists**: kinds `bible | comment | dict | devotional`, a `catalog.json`,
  download-once with `localStorage` key `trinityone.installed`, `ASSET_BASE` = `https://app.trinityone.church/`
  (`engine.js:397-405`). BSB (`modules/engbsb.zip`) and Strong's (`modules/strongs-dict.json`) already arrive
  this way.

**Consequence: this is build-time conversion work plus catalog entries. It needs no reader-interface change.**

## Sizes — measured, and the one rule that makes this feasible

GitHub reports **43.5 GB** across all Aquifer repos. That number is misleading: it includes git history and
the `docx/`, `pdf/` and `audio/` trees. The JSON is a sliver — English study notes `eng/json` total **26.3 MB**
(arb 28.5, swh 7.2, hin 2.2). A sample article file gzips to **20%** of its size.

**RULE: mirror the `json/` (or `md/`) trees only. Never `docx/`, `pdf/`, or `audio/` inside a study resource.**
That is the difference between impossible and comfortable on a small church box. Audio, where wanted, is a
separate deliberate module (decision 8), not a side effect of mirroring a text.

Largest repos, for planning: UWTranslationNotes 10.1 GB, UBSRealiaLexicon 5.9 GB,
AquiferOpenBibleDictionary 4.8 GB, AquiferOpenStudyNotes 4.3 GB, FIATranslationGuide 3.2 GB. Expect the
JSON-only fraction to be one to two orders of magnitude smaller; **measure per resource before shipping it.**

## Why alignment matters (decision 8)

Strong's numbers reach our reader as MySword markup embedded in the verse text — `<WG25>` / `<WH430>`,
parsed at `engine.js:158-164` into `<sup class="st" data-s="…">`. **Only a tagged module carries them.**
AKJV+S does; **the BSB does not.** So today, tapping a word in the default Bible cannot reach Greek or
Hebrew — the reader has to switch Bibles.

Aquifer ships word-level `alignments/` beside their BSB. That data maps BSB words to original-language
words, which would let tap-a-word resolve on our DEFAULT Bible, against the Strong's lexicon
(14,197 entries) we already auto-install. This is a real gap closed, not a flourish. It is **not** in slice 1.

## Mirroring on our relays — the existing groundwork

- **Relays already store and serve blobs.** Merged, in use for church media. `scripts/gateway.mjs` on `main`
  has 16 blob/Blossom references; the relay data dir has `blobs/` (currently empty) and a
  `catalog-key.json` (199 B, 23 June — a key was initialised, nothing was ever published).
- **The missing half is the signed catalog and its tooling**, which exists only on
  `blossom/module-distribution`: `scripts/build-catalog.mjs`, `publish-catalog.mjs`, `init-catalog-key.mjs`,
  `build-torrents.sh`, plus `gateway.mjs +97` and `engine.js +152`, and `reference/proposal-blossom.md`
  (327 lines of design). **Untested.** Owner decision 7: read it for the design, rebuild rather than merge.

## OWNER DECISION — 2026-09-10: fix the module update path BEFORE slice 2

Owner: *"fix it so the app checks against what's published."*

**The change:** on a cache hit, if the catalogue entry carries a `sha256`, hash the cached bytes and fall
through to a re-download on mismatch. That turns the pin into a version identity for free, and makes
"we published a corrected module" actually reach a phone that already has the old one.

**Why it must come first:** today a phone that installed v1 keeps v1 for ever, silently — measured. Slice 2
publishes ten languages at ten URLs that will each be rebuilt at least once, so shipping slice 2 first would
strand every one of them. It also settles the collision with the pilot rule *add, never repurpose*:
republishing at the same URL is currently a provable no-op for existing installs.

**Scope, and the two places that need it:**
- `fetchAndCacheModule` — the cache-hit branch, which is where the pin is skipped.
- `restoreInstalled` — worse, it calls `loadModuleBytes` on cached bytes with **no verification at all** on
  every cold boot.

**Also fold in the deployment fact measured on the device:** a *new* catalogue entry already arrives one
launch late (`catalog.json` is cache-first with background refresh in `sw.js`). That is acceptable and not
part of this fix, but the two together are what "publishing a module" actually means today, and slice 2's
plan should say so.

**Not a security fix, and the commit must not claim to be one.** Refused bytes never enter the cache — the
verify-then-cache order holds and is now guarded by a test that bites — and on native an attacker who can
write IndexedDB can already patch the APK. This is an **update mechanism**.

## Slices

Slice 1 must prove the content path before any distribution work. Do not reorder.

### Slice 1 — one resource, one language, end to end (THE ONLY SLICE BRIEFED SO FAR)
Converter script → module file → catalog entry → served from the existing `ASSET_BASE` → renders in the
Study panel → **verified on a phone.** English study notes are the right subject: the licence is confirmed,
the content is HTML already, and 26 MB is small enough to iterate on.

### Slice 2 — the rest of the resources and all languages
Dictionary, translation notes, intros, key terms, profiles, maps, across all 11 languages. Per-resource size
measured before it ships. Texts added only where notes exist in that language (decision 3).

### Slice 3 — relay mirroring with operator choice
Signed catalog rebuilt on a new branch, relay-side serving, and an operator control to choose what this box
hosts (decision 4 and 7). `proposal-blossom.md` is design input, not code to merge.

### Slice 4 — alignment (tap the word), then audio

**Owner decision 9: the tap target is THE WORD ITSELF**, not the Strong's superscript. The cheaper option
(bake alignment into an AKJV+S-style tagged module and reuse the existing `sup.st` path with zero reader
changes) was considered and rejected — a superscript is a fiddly target under a thumb.

#### What already exists

`VerseRow`'s tap dispatcher (`app/screens-read.jsx:16-21`) already routes a tap on `sup.st` to
`onWord(strongsNumber)` and on into the Strong's lexicon; anything else in the verse selects the verse. So a
word-level *destination* exists. Also helpful: `window.sanitizeHtml`'s attribute allowlist is
`{ class, data-s }` (`engine.js:12`), so per-word markup carrying `data-s` already survives sanitising —
no sanitiser change needed.

#### The alignment data as it actually is — measured 2026-09-10

Sampled `eng/alignments/json/19-117.alignment.json` (Psalm 117) from the `BereanStandardBible` repo.
`format: "alignment"`, `version: "0.4"`, **one file per chapter** (`<book>-<chapter>.alignment.json`).

```
groups[0].documents = [ {scheme:"BCVWP|token-string", docid:"WLCM"},      // Hebrew source
                        {scheme:"BCVWP|token-string", docid:"BSB"} ]      // English target
groups[0].roles     = ["source","target"]
groups[0].records   = [ {source:["191170010011|הַלְלוּ"], target:["19117001001|Praise"]}, … ]
```

Token ids are **BCVWP**: target `19117001001` = book 19, chapter 117, verse 001, word 001 (2+3+3+3 digits).
Source ids carry an extra trailing morpheme index (12 digits). The surface form follows a `|`.

Three properties that shape the build:

1. **Nearly half the records are many-to-many — 9 of 19 in the sample.** One Hebrew word maps to several
   English words (`יְהוָה` → "the", "LORD"; `גּוֹיִם` → "you", "nations"), with `meta.secondary` marking the
   less-central English token. **So a tap must resolve to a PHRASE, not a word.** This is not an edge case
   to defer; it is about half the data, and a design that highlights one word will look broken immediately.
2. ⚠ **There are NO Strong's numbers anywhere in the alignment.** It maps English tokens to Hebrew/Greek
   *tokens*, not to Strong's. **This corrects an earlier claim in conversation**: alignment alone does NOT
   deliver tap-a-word → our existing Strong's lexicon. That needs a third piece — a lexicon keyed by BCVWP
   token id for the source text (`WLCM` for the OT, whatever the NT source document is). Aquifer's `ACAI`
   repo may carry it; **UNVERIFIED, and it must be checked before slice 4 is planned as a Strong's feature.**
   What alignment gives us on its own is still useful and shippable: tap "LORD" → see `יְהוָה`, because the
   surface form is in the record.
3. ⚠ **The alignment is LLM-GENERATED.** `meta.llm = { provider: "gloo", model: "gloo-openai-gpt-5-mini",
   reasoning_effort: "high" }`, creator Mission Mutual, `conformsTo: "0.4"`. It is not human-verified.
   `meta.nonEquivalent` lists source and target words with no counterpart, so the producers know it is
   incomplete. **This must be disclosed in the UI, not buried in a licence page.** A Bible app that asserts
   "this English word is this Hebrew word" on machine-generated data without saying so is overclaiming, and
   `reference/DOMAIN.md` and the product ethos both forbid exactly that. **DECIDED (owner, 2026-09-10):
   ship it, with a short line where the word appears — "word links are machine-generated and may be wrong"
   or similar.** See decision 10. The line is part of the feature, not a nice-to-have: a slice 4 that ships
   the taps without the disclosure is not finished.

#### ⚠ The trap that would make every tap wrong

Target token ids index words in **their** BSB. We ship our own `modules/engbsb.zip`. If the two tokenise even
one word differently in a verse, every tap after that point in the verse resolves to the wrong Hebrew word —
silently, and looking entirely plausible. **Either use their `eng/usfm` BSB as the aligned text, or prove by
execution that our tokenisation is identical.** Do not assume; two BSB editions is exactly the kind of
difference nobody notices until a reader is told the wrong Greek word.

#### What slice 4 builds

- A converter turning per-chapter alignment JSON into per-word data the reader can use, keyed so a rendered
  word can find its record. Include `meta.secondary` and `nonEquivalent`, and preserve the many-to-many
  grouping — the phrase is the unit, not the word.
- Reader work in `app/screens-read.jsx`: each word becomes its own hit target, a tap highlights the whole
  aligned phrase, and the panel shows the source-language word(s). This is a change to the file every reader
  surface depends on, so it needs the point-of-use test and device verification more than most.
- The provenance disclosure from item 3.
- Audio afterwards, as its own module kind against the existing Listen surface (`app/screens-audio.jsx`).

#### Size

`engine.js:471` records a deliberate module ceiling with BSB ≈ 3 MB and KJV+S ≈ 9 MB as reference points.
Per-word alignment lands nearer the latter, so it ships as its own optional download and **must not replace
the default BSB**. Measure the converted artefact before shipping.

### Later / not scoped
Images, video dictionary (decision 1).

## DEVICE-VERIFIED — 2026-09-10, Oppo CPH2477

Driven in the phone's browser against the Funnel-served app (not the APK — see the gap below).

| what | result |
|---|---|
| catalogue entry reaches the phone | **one launch late** — see the service-worker note below |
| install (download 1.9 MB → verify pin → unzip to 5.75 MB → open in sql.js WASM → register) | **2,288 ms** |
| the pin was actually enforced | `pinned: true`; the `9c292b2` fix works on hardware |
| chapter turn, steady state over 40 turns | **2.36 ms** |
| heaviest chapters — Psalm 119 (57 rows), Mark 13 (most HTML) | **12.2 ms / 12.7 ms** |
| first call after install (query warm-up included) | 69.7 ms |
| renders in the Study panel | source heading, licence line beneath it, then the notes |
| the licence on screen | *"© Mission Mutual · CC BY-SA 4.0 · an adaptation of Tyndale Open Study Notes © 2023 Tyndale House Publishers, also CC BY-SA 4.0"* |

**The performance worry is answered.** 5.75 MB of SQLite in WASM is a non-issue on a modest phone: a chapter
turn is imperceptible and the worst chapter in the module is ~12 ms.

### ⚠ A new catalogue entry appears on a phone's SECOND launch, not its first

`catalog.json` is in `sw.js`'s `EXTRA` precache list and falls into the fetch handler's final branch —
cache-first with background refresh (`sw.js:133`). App shell (HTML/JSX) is network-first, so a deploy is
picked up immediately; **`catalog.json` is not.** Measured on the phone: the app reported 3 commentaries
while the server served 4, and one reload fixed it.

This is normal stale-while-revalidate, not a defect — but it means **"publish a module and it is available"
is false for one launch.** Combined with the same-URL update problem above, plan slice 2's ten languages
accordingly: a new module is one launch late, and a *revised* module at the same URL never arrives at all.

### The gap this did not close

Everything above is the phone's **browser**. The APK's native path — `CapacitorHttp`, `ASSET_BASE`
resolution, and the local-first/gateway-second `fetchAsset` fallback — is still unexercised, because
`release.sh --apk` signs the member app with the stable key and cannot upgrade a test device
(see the owner note on TESTING signing). That is the one remaining device gap for slice 1.

## Follow-ups found while building slice 1 — not slice-1 work

- ⚠ **The module checksum was never checked for ANY non-JSON module** — `installModule` forwarded
  `item.sha256` only on the `format: "JSON"` branch, so every Bible, every USFM zip and every commentary
  reached `verifyIntegrity` with `undefined`. That includes `app/screens-library.jsx:694` reaching it from
  `MirrorBrowser` over `ebible-catalog.json`'s 1,290 USFM entries. **Fixed in slice 1** (`9c292b2`), because
  slice 1's catalogue entry is the first in the repo's history to carry a pin and the commit had claimed a
  protection that did not exist. Proved by installing with a pin of 64 zeros and being refused, having first
  proved the pre-fix code accepted it.

- ⚠ **A MODULE CAN NEVER BE UPDATED AT THE SAME URL — measured 2026-09-10, and slice 2 walks straight into it.**
  `fetchAndCacheModule` returns cached bytes without re-verifying, and `restoreInstalled` calls
  `loadModuleBytes` on cached bytes with **no verification at all** on every cold boot. Measured: install
  honestly, then move the pin in `catalog.json` for the same URL → the phone is served the OLD cached bytes
  and the new pin never gets a chance to notice. **A phone that installed v1 keeps v1 for ever, silently.**

  The tampering story is weak and that is fine: refused bytes never enter the cache (verify runs before
  `cachePut`, now guarded by a test that bites), IndexedDB is per-origin, and on native an attacker who can
  write it can already patch the APK. **So this is not a security fix — it is an update mechanism**, and the
  pin today is a first-download check rather than a what-you-are-holding check.

  Why it is urgent for slice 2: the converter's own header documents the workflow "rebuild the module, paste
  the two fields it prints into `catalog.json`", and slice 2 adds ten languages at ten URLs that will each be
  rebuilt at least once. It also collides with the pilot rule *add, never repurpose*: republishing at the same
  URL is not merely untested, it is provably a no-op for existing installs.

  Cheapest correct fix: on a cache hit, if `meta.sha256` is present, hash the cached bytes and fall through to
  a re-download on mismatch. That makes the pin a version identity for free. **Do this before slice 2, or
  publish every rebuild at a new URL.**

- **The lazy-bible guard was lost and restored.** Lifting `parseUSFM`/`inlineUSFM`/`stripTags` for the
  versification test removed two throwing stubs that were the only thing in `scripts/*.test.mjs` asserting
  that `buildFromUSFM` does not parse verses to list books — a property `engine.js` values at "~0.6 s on
  desktop / 2-5 s on a modest phone on EVERY boot". The property held throughout; only the guard went.

- ⚠ **The fixed-port clash guard has THREE blind spots, and one is causing cross-tenant test failures.**
  Widened once at `0f35e85` (68 → 80 ports), but still blind to:
  1. **alternative names on their own lines** — `DEAD_PORT`, `WEDGED_PORT`, `SILENT_PORT`, `CHAIN_PORT`,
     `SLOW_PORT`: six ports across three files, five of them live clashes;
  2. **ports declared inside a function body** — `console-publish-honesty.test.mjs:760` binds
     `const B_PORT = 8993` from inside a function, indented, and `relay-church-scope.test.mjs:32` binds
     `const PORT = 8993` at the top level. **This collision makes four cross-tenant scoping tests fail in a
     full run** (`a DIFFERENT church on the same relay cannot touch it`, and three siblings) while the file
     passes 4/4 alone. Diagnosed 2026-09-10 from the source after two full-suite runs failed to explain it.
     Terrifying-looking, and a port collision.
  3. the original `;`-terminated form, fixed at `0f35e85`.

  **The lesson for whoever takes the ticket:** a port that is "unique among the declarations the guard reads"
  is not a unique port. Assign real unused numbers across at least six files, widen the reader to find
  indented and arbitrarily-named declarations, and give it its own audit — this is the third distinct blind
  spot found in one day.

- **The fixed-port clash guard is blind to every browser test.** `scripts/test-ports.test.mjs`'s second guard
  requires a `;` immediately after the port number, so the `const PORT = 8807, CDP = 9357;` form used by
  every browser test in the suite is invisible to it — `app-boots`, `a-join-while-locked-is-not-lost`,
  `a-cancelled-event-tells-the-people-it-was-for` and the new tampered-module test are all exempt from the
  guard written after two abandoned suite runs. Being fixed alongside the deletion of `requireFreePorts`
  (zero callers).

- **`scripts/test-ports.test.mjs:59` rejects correct code.** It matches the literals
  `requireFreePort(PORT` / `requireFreePort(CDP`, so it cannot see `requireFreePorts([PORT, CDP])` — the
  plural helper `test-ports.mjs` itself documents for "the browser tests, which hold two fixed ports". A
  correct first draft using the plural was failed by the guard. Either widen the regex or delete the unused
  helper; shipping both is a trap for the next person.

- **Versification, pinned as a test rather than prose.** Four rows of 16,932 fall outside the shipped BSB's
  verse ranges: `3 John 1:13-15`, `3 John 1:15-15`, `Revelation 12:18-0`, `Revelation 12:18-18`. The set is
  asserted exactly, computed from `modules/engbsb.zip` by `engine.js`'s own `parseUSFM`, so a fifth turns it
  red. **"All 66 books match exactly" is a claim about CHAPTER COUNTS, never versification** — say it that
  way anywhere it is repeated.

- **Coverage is 1,188 of 1,189 chapters.** Exodus 36 has no notes, confirmed upstream (no article in
  `02.content.json` carries an Exodus 36 association). Member-facing copy must not say "every chapter".

### ⚠ A COMMENTARY OR DICTIONARY CAN BE INSTALLED AND NEVER REMOVED — found by a sim round, 2026-09-10

A sim persona ("an ordinary churchgoer who wants study notes") hit this on its first round: pressing
**Remove** on the study notes gives *"Couldn't remove Aquifer Open Study Notes"*, reproduced twice, and the
module stays installed and working.

**Confirmed in code, and it is pre-existing — `removeModule` is byte-identical on `main`.**

`engine.js`'s `removeModule(abbr)` opens with `if(!modules[abbr] || abbr === active) return false;`. But
`modules` (declared ~`engine.js:340`) is the **Bible** registry — `addSource` writes it. Commentaries live in
a *separate* registry, `commentaries` (~`:128`, written by `addCommentary`), and dictionaries in a third,
`dicts` (~`:109`, an array `addDict` pushes to). **Nothing anywhere removes from either** — there is no
`removeCommentary`, and no `delete commentaries[...]` in the tree.

So `removeModule` works for **Bibles only**. Every commentary and every dictionary is install-once: Matthew
Henry, Jamieson-Fausset-Brown, Adam Clarke, Strong's, and now the study notes. The Library shows a Remove
button for all of them (`app/screens-library.jsx:796`).

**Whoever wrote the current handler already knew.** The comment at `app/screens-library.jsx:751-754` says it
outright: *"AWAIT IT. removeModule is `async`, so this tested a PROMISE — always truthy — and the success
toast fired even when the removal returned false. A commentary that is not in `modules` cannot be removed at
all, and the app said 'Removed' anyway."* So the lying toast was fixed and the underlying inability was left.
The app is now honest about failing, which is why a sim could find it.

**Scope of a fix:** remove from the right registry per kind, drop the `localStorage` record and the IndexedDB
cache entry (`removeModule` already does the latter two), and re-notify. Un-installing a dictionary also has
to deal with `_ensureFullLexicon`'s early return and `dicts` being an unkeyed array. **Not slice-1 work, and
not caused by any of today's changes.**

### Follow-ups from the `c14f744` audit — none merge-blocking

1. **"cannot drift apart" is overstated.** `cachedCopyIsCurrent` and `verifyIntegrity` hold **two textually
   identical copies** of the pin expression (`engine.js:433` and `:467`), not a shared function. T6 covers the
   drift that exists today (the `KNOWN_HASHES` half, since that is the only pin source for the two bundled
   defaults). The **unguarded** direction is adding a new pin source to `verifyIntegrity` alone — e.g. a
   per-church catalogue in slice 3 — which would silently reintroduce exactly the bug this commit fixed, for
   the new source. Fix: extract `expectedPin(url, declaredHash)` and call it from both.
2. **An unstated cost.** `modules/engbsb.zip` is in `KNOWN_HASHES`, so **the default Bible is now hashed on
   every cold boot by every install**, whether or not anyone took an optional module — about 12 ms per
   launch, ~19 ms with the study notes, ~34 ms once the lexicon is installed. Measured 4.78 MB / 18.4 ms with
   two modules. The commit reads as though only the optional module pays; it should say this.
3. **Three line citations drifted** when this commit added 101 lines to `engine.js`: `engine.js:866` → 867;
   `buildCommentaryFromDb (engine.js:268)` → 278 (268 now lands inside a *different* function); and the
   module-ceiling comment cited as `engine.js:471` → 544.

### Ticket for a FRESH session — every Chrome launcher litters the repo root

**Not Aquifer work; found while doing it, and deliberately not fixed.** Each browser test puts its Chrome
*profile* in `tmpdir()` correctly, but the `spawn` call passes no `cwd`, so Chrome inherits the repo root
and drops its spellcheck dictionary (`en-US-*.bdic`) there. Measured 2026-09-10: **19 launchers declare a
`user-data-dir`, 18 of them spawn Chrome.** The fix is one option per call — `cwd: prof` on the spawn, or
`--disable-features=SpellcheckService`.

Why it was left: it touches ~18 files, rule 2 requires every one enumerated in the commit, and it surfaced
in the back half of a long session that had already had one measurement silently corrupted (rule 9). **It is
a clean, well-scoped ticket and should be taken on its own, not bolted onto a feature commit.** Symptom to
recognise: an untracked `en-US-10-1.bdic` making a "working tree clean" claim false.

## What every slice must carry

- **Attribution and licence shipped inside the module and displayed** (decision 5). A module whose licence
  notice is not reachable from the Study panel is not finished.
- **A test that fails if the feature is deleted from the screen**, not only if the converter breaks.
- **The caller list in the commit message** for anything shared (`engine.js` is shared by every reader
  surface).
- **The test count accounted for.**
- **Device verification before merge** — `engine.js` is the reader; a phone is the only honest check.

## Traps

- **`engine.js` is a served classic script, not a bundled one.** It is not rebuilt by any bundler step, so
  editing it takes effect directly — but it is also shared by every reader surface, so a mistake there is a
  blank Read tab rather than a broken module.
- **`npm run build:vendor` exits 0 and rebuilds nothing of ours.** `build:bundles` runs
  `build-identity.sh && build-fellowship.sh`. `vendor/steward.js` is rebuilt ONLY by
  `bash scripts/build-steward.sh`. Know which file you changed.
- **Never assert behaviour by text-matching `app/*.jsx`** — they ship unbundled, so `false && ` leaves every
  word in place and the assertion still passes. Lift and run, or drive the screen with
  `scripts/render-jsx-screen.mjs`.
- **Module size ceiling**: `engine.js:471` notes BSB ≈ 3 MB and KJV+S ≈ 9 MB against a deliberate ceiling —
  read that comment before shipping a large module.
- **Sims and probes must never reach production.** Browser launchers here carry
  `--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, …` for that reason
  (`scripts/sim-launch.mjs:51`). `ASSET_BASE` points at `app.trinityone.church`, so a test that downloads a
  module must be pointed at a local host explicitly.
