# TrinityOne — Design handoff notes (2026-06-04)

Source: `reference/TrinityOne-handoff.zip` (Claude Designer). Older handoffs live in
`reference/archive/`. This documents what's new and how our build maps to it.

## Brand identity — "Halo"
- **Logo (Halo):** one ring with three breaks (unity + trinity) and a single gold spark
  at centre; also reads as the "O" in *One*. Chosen concept = `D · Halo` (see
  `reference/D _ Halo.png`). SVG = three arcs (`a1/a2/a3`) + a centre `circle` spark.
- **Wordmark:** `TRINITY` (ink) + `ONE` (clay). **Tagline:** *Read · Gather · Share*.
- **Tokens:** the app's runtime tokens are unchanged from ours (same `.lumen`/`.trinity`
  CSS vars). `brand.css` in the handoff is a fuller "Halo" design-language token set used
  by the landing/design-language pages — NOT the app runtime — so our app tokens stay as-is.

## App changes integrated (this is the "marry up")
1. **Boot / splash screen** — animated Halo logo reveal (arcs draw in, gold spark pops,
   wordmark + tagline rise), auto-dismiss ~2.35s. CSS `.to-splash` in `index.html`,
   `Splash` component in `app.jsx`, rendered over the frame on launch.
2. **Chat search** — a search bar in the Chat tab (Groups view) that filters **groups**
   (name/kind) and **messages** (live, from a recent-message buffer), with match
   highlighting; tap a hit to open the group. Wired to our real Nostr groups/messages
   (design searched mock data).
3. **Tab order** — bar reordered to match the design: Chat · Plans · Read · Today ·
   Library · Search (default screen stays Today).

## Additional front-end builds (separate web artifacts — NOT in the mobile app)
These ship as their own pages later (marketing / brand site), not the APK:
- `TrinityOne Landing.html` — marketing landing page.
- `TrinityOne Logo Reveal.html` — standalone logo-reveal animation (the splash derives from it).
- `TrinityOne Design Language.html` — the Halo design-system doc.
- `Trinity One Logos.html` + `logos.jsx` — four logo concepts (Aurae / Ember / Meridian /
  **Halo**); Halo is the chosen mark. `design-canvas.jsx`, `image-slot.js`, `tweaks-panel.jsx`
  are design-tool scaffolding, not for production.

## Deferred / not done
- Hosting the landing / design-language / logo-reveal pages.
- Adopting the full `brand.css` token superset app-wide (app tokens already match the design).
