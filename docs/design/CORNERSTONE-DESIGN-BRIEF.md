# Design brief — "Cornerstone" (the TrinityOne hardware box)

*A small industrial-design brief: the physical enclosure for a church's self-hosted TrinityOne relay —
a Raspberry Pi in a distinctive, on-brand case. Provisional product name: **Cornerstone**.*

---

## 1. The ask

Design the **look and form of a small, always-on box** that holds a church's TrinityOne relay. A
Raspberry Pi lives inside; the church plugs in power + ethernet, scans a QR, and it's live — quietly
running their whole church's data **on hardware they own**. We need concept renders + an enclosure
design direction (3D-printable first, injection-mouldable later).

**Audience for the object:** a church office, a vestry shelf, a pastor's windowsill. It will sit in view,
on 24/7. It should feel like a considered, dignified object someone is *glad* to have on display — not a
gadget hidden in a cupboard.

## 2. What it *is* (so form follows meaning)

Cornerstone is **"ground you own" made physical** — the literal stone the church's digital life is built
on. The whole TrinityOne idea is *owned by the church, captured by no one*; this is that idea you can
hold in your hands. The name is deliberate: a **cornerstone** is the foundation stone a building is set
on (and, for a church, a loaded and beautiful biblical image). Lean into **stone / foundation / warmth**,
not "tech gadget."

## 3. The feeling

Warm, calm, quietly sacred — **considered, not techy, not kitsch.** Reference points: the restraint of
Muji / Bang & Olufsen / a fine speaker, with a faith warmth. A small monument, not a router.

- **Yes:** warm, tactile, matte, solid, timeless, dignified, a little reverent.
- **No:** gamer RGB, server-rack black, blinking-lights tech, blatant religious clichés (no crosses
  stuck all over it), glossy plastic, stark white.

## 4. Brand system (match the product exactly)

**Palette (hex):** Paper `#F4EEE2` · Surface `#FFFDF8` · Ink `#221C16` · **Clay (primary) `#C25A38`**,
deep `#9C4327` · **Gold (the spark) `#C8962E` / soft `#E0B860`** · Sage `#5E8C6A` · Midnight `#17120B`.

**Colour discipline:** Clay is the hero. Gold is *the spark* — reserve it for the status light. Warm
paper/clay body; no cold whites or blacks. A **terracotta/clay matte shell** is both on-brand *and*
evokes stone/earth/foundation — a strong starting direction. A natural accent (warm wood, a stone/grit
texture, or a fabric-wrapped face) would reinforce "cornerstone."

**Type:** Sora (display/UI), Newsreader (serif). Any wordmark on the object: minimal, debossed.

**The mark — "The Halo":** a broken cream halo ring with a single gold spark at centre, on a clay
rounded-square tile (assets in the repo: `#to-mark` / `#to-halo` in `welcome.html`). On the box, render
it **embossed or debossed into the top surface** — subtle and tactile, felt more than seen.

**The signature detail — the living light:** the Halo's **gold spark becomes the status LED** — a soft,
slow *breathing* glow when the relay is alive and serving the church. This is the one light on the
object, and it's the emotional centre: the church's life, quietly lit. Calm, never blinking/techy.

## 5. Functional constraints (it has to actually work)

- **Houses a Raspberry Pi 4/5** (board ≈ 85 × 56 × 17 mm) + an **SSD/eMMC** (not a bare SD card —
  24/7 writes). Leave room and a mount for it.
- **Passive cooling, fanless** — it runs 24/7 and must be silent. Vents should look *intentional and
  beautiful* (a design feature — slots, a perforation pattern, fins), not an afterthought. The case
  itself doubling as a heatsink (e.g. an aluminium element) is welcome.
- **Ports accessible, rear-clean:** USB-C power, **Gigabit ethernet**, USB; micro-HDMI can be hidden/
  recessed (setup-only). Keep the front face uncluttered — ideally just the Halo + the living light.
- **Small footprint**, stable on a shelf; soft feet; doesn't slide. Cable exit tidy from the rear.
- **Manufacturable:** simple geometry, **3D-printable for the pilot** (so we can prototype the Halo
  emboss + vent pattern cheaply), with **draft angles / snap-fit or minimal screws** so the same form
  injection-moulds later. Tool-free access to the Pi is a plus (servicing, SSD swap).

## 6. Deliverables

- **Hero render** — a warm 3/4 view, on a real surface (office shelf / windowsill), the living light
  softly lit.
- **Orthographic views** — front (Halo + light), rear (ports, labelled), top (embossed Halo + vents).
- **One recommended colourway + material call** (lead with the clay/terracotta matte direction; show
  one alternate if it helps).
- **A close-up of the living light + embossed Halo** (the signature details).
- *Nice to have:* a glimpse of **packaging / the unboxing moment** — a church opening it; the "set your
  cornerstone" feeling. And a one-line size reference (it's small).

## 7. Don't

Stark white, glossy plastic, black server look, RGB, fan grilles that look like a PC, crosses/overt
religious motifs, fake "premium tech" clichés. Keep it warm, quiet, and built to be *seen and kept*.

## 8. Reference

Brand tokens: `brand.css`. The Halo/mark SVG: `#to-mark` / `#to-halo` in `welcome.html` (request clean
exports if needed). Voice + world: `welcome.html`, `welcome-churches.html` ("Don't build your church on
ground you don't own" / "Made for the church, owned by no one"). The product's role: `reference/SPINE.md`
→ "Add-ons / plugins" (the Cornerstone box) and `reference/plugins/README.md`.
