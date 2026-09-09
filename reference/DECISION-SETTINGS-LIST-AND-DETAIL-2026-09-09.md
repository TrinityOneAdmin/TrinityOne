# DECIDED: Settings becomes a list and a detail page, on both surfaces

**Owner, 2026-09-09**, after two rounds of density work and a mockup:
*"that looks cleaner. more official and less inline with the broader design language, but for this I
think it's preferable."*

Mockup kept at `reference/mockups/settings-list-detail.html` — open it, no church or login needed. It
carries a Browser/Phone toggle and three real pages (Congregation features, Rules & privacy, Relays).

## The decision

Settings stops being a wall of cards packed into columns. It becomes **a list of pages on the left and
one page at a time on the right**, with the phone showing that same list as its first screen and one page
per tap.

**It is allowed to look plainer than the rest of the app.** That was the owner's own observation and it
is the point: settings is a workshop, not the front room. The consistency that matters is between the
steward console and the relay panel, not between settings and the Today screen.

## Why, after two rounds of tuning failed to fix it

The measured problem was never spacing.

- **Cards move when they change size.** The relay panel still uses `column-count`, so the browser decides
  which card is in which column from their heights — add a church and cards hop. The console fixed this
  with authored stacks; the panel never did.
- **Cramped is content, not padding.** Round one took Features 1599px -> 1034px by rebalancing one
  column. Round two dropped the type and trimmed copy. Network & relays moved 1242 -> 1128 because its
  height is a single card doing six jobs.
- **Both surfaces drift** because `control.html` does not load `brand.css` — 319 lines of duplicated
  tokens, so a fix in one never reaches the other.

A layout that does not pack cards makes the first problem impossible, the second unnecessary, and gives
the third somewhere obvious to live.

## What it buys

- Nothing packs, so nothing moves when a panel grows.
- Each page gets the full width. No 435px card forcing a sentence onto three lines.
- Adding a setting reflows nothing.
- The Relays card stops being 1000px: connect-by-name, copy-history, keep-in-sync and run-your-own-box
  become their own pages.
- The same shape drops onto the relay panel, which is what the owner asked for.

## What it costs

- One more click to reach a setting.
- A real rebuild: roughly 15 panels on the console, plus the relay panel.
- Deep links and any "take me to that setting" navigation need a page to point at.

## Rules carried forward from the design note

1. **Positions are authored, never computed.** No `column-count`, no masonry. Measured 2026-09-01: dead
   column space 133/363/262px for authored stacks vs 469/488/799 masonry vs 1270/800/749 plain grid.
2. **Density is a question about the container, never the viewport.** The phone layout is CORRECT as it
   stands — the owner has confirmed it twice — and must not change.
3. **One card, one job.**
4. **Shared primitives, not copied ones**, so the relay panel gets fixes automatically.
5. **Do not hide the consequence text** beside a switch. Whole rarely-opened pages may be a click away;
   the sentence under a toggle may not.

## Order of work

1. **Console: Relays first.** It is the worst card and breaking one card into four pages proves the whole
   idea before anything else is touched.
2. The remaining console sections.
3. Extract the shared layout CSS.
4. Relay panel adopts the same shape — which also kills its `column-count` jumping.

Supersedes the "third pass" item in `reference/BACKLOG.md`; the design note
`reference/SETTINGS-LAYOUT-DESIGN-2026-09-09.md` still holds for the rules and the measurements.
