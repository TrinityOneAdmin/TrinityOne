// Rules that MORE THAN ONE surface has to agree about, written once.
//
// ARCHITECTURE-2026-07-29, recommendation 1. The relay, the member app and the steward console each
// implemented the trust and safeguarding rules separately, sharing no code. In a single session that produced
// four separate "the rule was applied here and not to its neighbour" defects — photo suppression existed on
// every member's phone and nowhere in the console; "an empty answer is not proof" was applied to the
// clearance back-fill and not to the name sync three functions away; the locked-boot gate was fixed and the
// wipe three lines below it was not; default-deny went to documents and never to event kinds.
//
// This module is the answer to that, and it starts DELIBERATELY SMALL. One rule, shared, with the divergence
// it already had proved by a test. More move here as they earn it; a big-bang extraction of security code is
// exactly the change that goes wrong quietly.
//
// WHERE THIS LIVES, and why it is scripts/ rather than src/: gateway.mjs already imports
// scripts/event-store.mjs at RUNTIME, so this directory is a proven deployment path — it demonstrably ships
// wherever the relay runs (the release bundle and the desktop payload both carry it). The two client engines
// are built with `esbuild --bundle`, so their import is inlined at build time and the source location cannot
// affect them at runtime at all. Choosing the already-proven path over the tidier-looking one is the whole
// point when the code is infrastructure.
//
// No imports, no I/O, no platform APIs — so it runs identically under Node and inside both bundles.

// One spelling of a public key. Nostr pubkeys are lower-case hex by convention, but "by convention" is not
// "always", and a set lookup is exact. See normalisation note in isPhotoSuppressed.
export const normPub = (p) => String(p == null ? '' : p).trim().toLowerCase();

// Build the lookup set for a church-signed list of pubkeys (photo suppression, and anything else shaped like
// it). Normalised on the way IN so every consumer gets the same answer regardless of how the list was typed.
export function pubSet(list) {
  const s = new Set();
  for (const p of (Array.isArray(list) ? list : [])) { const h = normPub(p); if (h) s.add(h); }
  return s;
}

// Has a steward switched this member's uploaded photo off?
//
// THE DIVERGENCE THIS EXISTS TO END, measured on 2026-07-29 before the two were merged:
//   member app  `_noPhoto.has(pubkey)`              — no normalisation on either side
//   console     `_noPhoto.has(pubkey.toLowerCase())` — normalised on both sides
// so a list carrying a single upper-case pubkey suppressed the photo on the steward's screen and NOT on the
// congregation's phones. A safeguarding control, disagreeing with itself, twenty-four hours after the second
// copy was written — by me.
//
// Normalising is also the fail-safe direction: an ambiguous case now suppresses rather than displays.
export function isPhotoSuppressed(pubkey, suppressed) {
  const h = normPub(pubkey);
  return !!h && !!suppressed && suppressed.has(h);
}

// The member app needs the transformed avatar, not just the boolean: a suppressed photo falls back to the
// member's own symbol and colour rather than to nothing. Kept here so the fallback shape is defined once too.
// `symbolFor` supplies the deterministic per-pubkey symbol; the caller owns that table.
export function suppressPhotoAv(pubkey, av, suppressed, symbolFor) {
  if (!av || av.kind !== 'photo') return av;
  if (!isPhotoSuppressed(pubkey, suppressed)) return av;
  return { kind: 'symbol', color: av.color, symbol: av.symbol || (symbolFor ? symbolFor(pubkey) : undefined) };
}
