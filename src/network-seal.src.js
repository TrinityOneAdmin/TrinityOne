// NETWORK CONTENT SEALING -- ONE COPY, BOTH BUNDLES (Networks MVP, N5b).
// The member app (src/fellowship.src.js) and the steward console (src/steward.src.js) are built separately and share no local
// modules at runtime, so the two-hop sealing would exist twice and drift. Everything here is PURE: no key store, no network,
// no clock. Each bundle supplies its own keys.
//
// Ported 2026-11-18 (feat/networks-port-2026-11-18) from October's 9a1f5595 copy, feed-free.
//
// THE TWO HOPS (owner-approved 2026-10-21; reference/SCOPE-NETWORKS-MVP-2026-10-21.md, N5b):
//   RING     an array of 32-byte hex keys, CURRENT FIRST, that seals a network's posts.
//   hop-1    netkey:<np>   authored by the NETWORK key:  { v:1, rev, keys: { <churchHex>: nip44(JSON({k:ring}), ECDH(netSk, church)) } }
//            One ring, wrapped once PER JOINED CHURCH. Readable by the network and by each wrapped church; a member never reads it.
//   hop-2    netkeyc:<np>  authored by the CHURCH key:   { e: nip44(JSON({k:ring}), churchNameRing[0]) }
//            The church unwraps hop-1 with its own secret and re-seals the SAME ring under the name key its members already hold.
//            There is NO per-member wrap: that would need every church's member list.
//   content  netann:/netevent:<id>  authored by the NETWORK key:  { v:1, e: nip44(JSON(body), ring[0]) }
//
// ⚠ NOTHING HERE DECIDES WHO MAY READ. The relay does (netReader, scripts/gateway.mjs) and so does the church (it decides whether
// to re-seal). This file only makes the ciphertext; a ring held by a member who should not have it opens everything sealed to it.
import { encrypt as e44, decrypt as d44, getConversationKey as ck44 } from 'nostr-tools/nip44';

export const NETANN_D = 'trinityone/netann:', NETEVENT_D = 'trinityone/netevent:';
export const NETKEY_D = 'trinityone/netkey:', NETKEYC_D = 'trinityone/netkeyc:';
export const NET_RING_MAX = 12;   // a leave rotates the ring; keep enough history that older posts still open
const HEX64 = /^[0-9a-f]{64}$/;
const toBytes = (k) => (k instanceof Uint8Array ? k : new Uint8Array((String(k).match(/.{1,2}/g) || []).map(x => parseInt(x, 16))));
const toHex = (u) => Array.from(u, b => b.toString(16).padStart(2, '0')).join('');

// A ring is only ever 64-hex strings, current first, no repeats. Anything else is dropped (a ring read from a document is untrusted).
export function cleanRing(r) {
  const out = [];
  for (const k of (Array.isArray(r) ? r : [])) {
    const h = typeof k === 'string' ? k.toLowerCase() : '';
    if (HEX64.test(h) && !out.includes(h)) out.push(h);
  }
  return out.slice(0, NET_RING_MAX);
}
export function newNetKey(cryptoObj) { return toHex((cryptoObj || globalThis.crypto).getRandomValues(new Uint8Array(32))); }
// THE FIRST KEY IS DERIVED, NOT DRAWN (B1 audit, 2026-11-19). Two first-mints for one network -- two syncs overlapping on a brand-new network,
// or a founder re-minting after a relay wrongly answered "there is none" -- used to produce two DIFFERENT first keys, and whichever envelope
// landed second made every post sealed under the other unopenable. HKDF-SHA256 over the network secret, with its own label, gives every
// first-mint the SAME key, so a repeat does no harm. Only the network's secret holder can compute it -- the same party that can already open
// every hop-1 entry. Later rotations (a church leaving) stay random: those must be keys the departed church never held. Async: WebCrypto.
// -> 64-hex | null
export async function firstNetKey(netSk, cryptoObj) {
  try {
    // EXACTLY 32 BYTES OR NOTHING (re-audit 2026-11-19): toBytes would turn a short, long or non-hex value into SOME bytes, and a key derived from
    // garbage is a key nobody else can derive. A secp256k1 secret is 32 bytes; anything else is refused and the caller must not mint.
    if (!(netSk instanceof Uint8Array) && !(typeof netSk === 'string' && /^[0-9a-f]{64}$/i.test(netSk))) return null;
    const ikm = netSk instanceof Uint8Array ? netSk : toBytes(netSk);
    if (ikm.length !== 32) return null;
    const subtle = (cryptoObj || globalThis.crypto).subtle;
    const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('trinityone'), info: new TextEncoder().encode('trinityone/netring/0') }, k, 256);
    return toHex(new Uint8Array(bits));
  } catch (e) { return null; }
}
// A new key goes in FRONT; the old ones stay so older posts still open. (The church that left keeps only the rings it already held.)
export function rotateRing(ring, cryptoObj) { return cleanRing([newNetKey(cryptoObj), ...cleanRing(ring)]); }

// ── hop-1 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// -> the document CONTENT (a string). `churches` = the recipient church keys (hex); anything that is not 64 hex is skipped.
export function sealHop1(netSk, ring, churches, rev) {
  const r = cleanRing(ring);
  if (!r.length) return null;
  const body = JSON.stringify({ k: r }), keys = {};
  for (const c of [...new Set((churches || []).map(x => String(x || '').toLowerCase()))]) {
    if (!HEX64.test(c)) continue;
    keys[c] = e44(body, ck44(netSk, c));
  }
  return JSON.stringify({ v: 1, rev: Number.isFinite(rev) ? rev : r.length, keys });
}
// A CHURCH opens its own entry: ECDH(churchSk, networkPub) == ECDH(networkSk, churchPub). -> ring | null
export function openHop1ForChurch(content, churchSk, churchPub, networkPub) {
  try {
    const env = JSON.parse(content || '{}'), mine = env && env.keys && env.keys[String(churchPub).toLowerCase()];
    if (typeof mine !== 'string') return null;
    const r = cleanRing((JSON.parse(d44(mine, ck44(churchSk, networkPub))) || {}).k);
    return r.length ? r : null;
  } catch (e) { return null; }
}
// THE NETWORK can open ANY entry (it holds the secret half of every ECDH), so it needs no entry of its own. -> ring | null
export function openHop1AsNetwork(content, netSk) {
  try {
    const env = JSON.parse(content || '{}'), ks = (env && env.keys) || {};
    for (const c of Object.keys(ks)) {
      if (!HEX64.test(c) || typeof ks[c] !== 'string') continue;
      try { const r = cleanRing((JSON.parse(d44(ks[c], ck44(netSk, c))) || {}).k); if (r.length) return r; } catch (e) {}
    }
  } catch (e) {}
  return null;
}
export const hop1Recipients = (content) => { try { return Object.keys((JSON.parse(content || '{}') || {}).keys || {}).filter(c => HEX64.test(c)); } catch (e) { return []; } };

// ── hop-2 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// nameKey = the church's CURRENT name key (hex or bytes). null when there is none: the caller must NOT publish, never fall back to clear.
export function sealHop2(ring, nameKey) {
  const r = cleanRing(ring);
  if (!r.length || !nameKey) return null;
  try { return JSON.stringify({ e: e44(JSON.stringify({ k: r }), toBytes(nameKey)) }); } catch (e) { return null; }
}
// nameKeys = the church's whole name ring (so a rotation never hides an older document). A document with no `e` is REFUSED:
// nothing in this app writes one, so one that arrives is a forgery or a leak. -> ring | null
export function openHop2(content, nameKeys) {
  let o; try { o = JSON.parse(content || ''); } catch (e) { return null; }
  if (!o || typeof o.e !== 'string') return null;
  for (const k of (nameKeys || [])) {
    try { const r = cleanRing((JSON.parse(d44(o.e, toBytes(k))) || {}).k); if (r.length) return r; } catch (e) {}
  }
  return null;
}

// ── content ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export function sealPost(body, ring) {
  const r = cleanRing(ring);
  if (!r.length) return null;
  try { return JSON.stringify({ v: 1, e: e44(JSON.stringify(body), toBytes(r[0])) }); } catch (e) { return null; }
}
export function openPost(content, ring) {
  let o; try { o = JSON.parse(content || ''); } catch (e) { return null; }
  if (!o || typeof o.e !== 'string') return null;
  for (const k of cleanRing(ring)) {
    try { const b = JSON.parse(d44(o.e, toBytes(k))); if (b && typeof b === 'object') return b; } catch (e) {}
  }
  return null;
}

// ── bodies: a NETWORK event uses the core church-event fields, so every event renderer already reads it ─────────────────────
// PORTED 2026-11-18 from October (365dff7a) WITHOUT its refactor of the church's own publishEvent / subscribeEvents /
// subscribeChurchEvents onto these two helpers: since October the church event body grew fields (imgPos, imgZoom, exceptions) these
// do not carry, so routing the church path through them would silently drop those fields. They are used for network events only.
// A NETWORK event is the core body MINUS groupId: a network has no church-owned group, and `groupId` is what routes an event into one.
export function churchEventBody(ev) {
  ev = ev || {};
  return {
    date: ev.date || '', time: ev.time || '', title: ev.title || 'Event', where: ev.where || '', blurb: ev.blurb || '',
    accent: ev.accent || 'var(--clay)', image: ev.image || '', groupId: ev.groupId || '', recur: ev.recur || '',
    day: (typeof ev.day === 'number' ? ev.day : null),
    nth: (typeof ev.nth === 'number' && ((ev.nth >= 1 && ev.nth <= 5) || ev.nth === -1)) ? ev.nth : null,   // -1 = the LAST <day> of the month (app/recur.jsx NTH_LAST)
  };
}
export function churchEventFields(c) {
  c = c || {};
  return { date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent, image: c.image || '', groupId: c.groupId || '', recur: c.recur || '', day: c.day, nth: c.nth || null };
}
export function netEventBody(ev) { const b = churchEventBody(ev); delete b.groupId; return b; }
export function netEventFields(c) { const f = churchEventFields(c); delete f.groupId; return f; }
export const netAnnounceBody = (text) => ({ text: String(text || '').trim().slice(0, 2000) });
