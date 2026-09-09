# Settings layout: one set of rules for the console and the relay panel

Owner, 2026-09-09: *"whatever we land on needs to be mirrored onto the relay, as I am finding the same
issues (mainly cramped layout of cards and cards changing location as they change size)."*

Design note. Nothing built.

---

## 1. Three separate problems, measured

They are usually described as one ("settings is bulky") and they need different fixes.

### (a) Cards change place when they change size — the relay panel only

`relay-app/control.html:168`:

```css
.deck3 { column-count: 3; column-gap: 16px; }
```

CSS multi-column. **The browser decides which card lands in which column, from their heights.** Add a
church, expand a section, and the break point moves — so cards hop between columns while the operator is
looking at them. Measured at 1280px (where the media query gives 2 columns): deck 1169px, left column
285 + 227 + 412, right column 555.

The steward console had exactly this and removed it. Its own stylesheet records why:

> the BROWSER chose where the column broke. Three things followed from the card heights that nobody had
> decided: the reading order ran down one column and then across, the Tab order jumped back up the page,
> and **the split moved whenever a card grew.**

So this is a solved problem on one surface and live on the other. **The console's fix is what gets
mirrored.**

### (b) Cramped — both surfaces

Two rounds on the console got Features from 1599px to 1034px, and Network & relays barely moved (1242 →
1128). The reason is in `reference/BACKLOG.md`: the remaining height is CONTENT, not spacing. The Relays
card alone is over 1000px and does six jobs. The relay panel has milder versions of the same — "What this
relay serves" at 555px.

**More spacing tuning will not fix this on either surface.** Both real wins so far were structural.

### (c) The two surfaces cannot share a fix even when we want them to

`steward.html` loads `brand.css`. **`relay-app/control.html` does not** — it carries 319 lines of its own
CSS and re-declares the same tokens (`--ink-2` appears 20 times there and never in `steward.html`, which
gets it from the shared file). They resemble each other by hand-copying.

That is why "mirror it onto the relay" is currently a manual chore, and why they drift.

## 2. The rules to land on

**1. Positions are authored, never computed.** A card's column is a decision a person made and written
down. No `column-count`, no masonry, no packing algorithm. This is the console's `.sk-cols` pattern: a
grid whose direct children are hand-written column `<div>`s, each a flex column of cards.

*Consequence, and it is the point:* a card that grows pushes only what is below it **in its own column**.
Nothing ever hops.

*Evidence it is the right shape:* three layouts were built and compared on the live console at 1400px
(2026-09-01). Dead column space on Church / Features / Security measured **133 / 363 / 262px** for
authored stacks, **469 / 488 / 799px** for masonry, and **1270 / 800 / 749px** for a plain row-major grid.
Authored stacks won on the metric masonry is supposed to be good at.

**2. Density is a question about the container, never the viewport.** Both surfaces have cards that live
inside a sidebar or a grid track, so window width says nothing about the room a card actually has. The
console already uses `@container`; the relay panel uses viewport media queries and should stop. This also
keeps the phone layout intact, which the owner has confirmed is correct as it stands.

**3. A card is sized for one job.** The console's Relays card and the panel's "What this relay serves" are
each several cards wearing one hat. Splitting everyday controls from once-in-a-lifetime ones will take
more off the page than any amount of padding, and makes both surfaces legible rather than merely shorter.

**4. One vocabulary, shared rather than copied.** The layout primitives — the stack grid, the panel, the
setting row, the standing note, and the density rules — belong in a file both surfaces load. Then
"mirrored onto the relay" is automatic instead of a promise.

## 3. Order of work

1. **Relay panel: authored stacks.** Replace `.deck3`'s `column-count` with the console's pattern —
   wrap the cards in column `<div>`s and let a human choose. This alone ends the jumping, which is the
   complaint that actually costs an operator confidence in the page.
2. **Extract the shared layout CSS.** Move the primitives into a file `control.html` also loads, so the
   two stop diverging. Do this second: the relay panel needs to be on the same pattern first, or there is
   nothing worth sharing.
3. **Split the oversized cards** on both surfaces. Biggest remaining win, and it is a design job, not a
   CSS one.
4. **Then** revisit spacing, if it still needs it.

## 4. What not to do

- **No more `@container` tuning as an opening move.** Two rounds have taken what there is to take.
- **No row-major grid.** Measured worst of the three: a 130px card sits in a 630px row.
- **No masonry anywhere.** That is what we are removing, and it is why cards move.
- **Do not hide the consequence text** beside a switch. This console describes consequences rather than
  prescribing policy, deliberately. Whole rarely-opened cards may collapse; the sentence under a toggle
  may not.
