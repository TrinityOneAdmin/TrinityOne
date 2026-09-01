// DOES THIS BOX HOLD THE KEY IT ADVERTISES? — one copy, both bundles.
//
// ONE COPY, BOTH BUNDLES. The member app and the steward console are built separately and share no local
// modules, so this would otherwise exist twice and drift. Imported by src/fellowship.src.js (what the
// congregation reaches) and src/steward.src.js (where the church's writes come from). Both surfaces must
// answer this question identically or the two disagree about who they are talking to.
//
// WHY IT EXISTS. A relay publishes its identity pubkey in two places — `/status` and its NIP-11 document —
// and both are bare strings over an unauthenticated GET. Anyone can copy a relay's `/status` onto their own
// host and be believed to be that relay. The console already reads `relayPub`, but only to count distinct
// machines for redundancy; it has never been a gate, and a gate laid on top of a string anyone can copy is a
// badge nobody checks. So before any of that can mean anything, the relay has to PROVE it.
//
// HOW. We choose a fresh 128-bit nonce, ask `GET /relay-identity?nonce=…`, and require back a kind-27235
// event signed by the pubkey it is claiming, carrying OUR nonce and a recent timestamp. A host that merely
// copied `/status` cannot produce that, because producing it needs the secret key. A host that captured a
// real proof cannot re-use it, because the nonce in it is not the one we just asked with.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not decide whether the relay may be talked to. It answers
// "which key is answering here, provably" and nothing else — admission is the closed-network plan's C3/C4,
// and lands separately with an audit between, because a relay older than this cannot answer at all and would
// silently drop out of its own church's network the moment something started requiring one.
//
// It also does not refuse a relay whose signed URL differs from the URL we dialled. That is not an oversight:
// a relay behind a tunnel changes URL on every restart, so URL-to-key binding is a server-side job (plan C6)
// and a church signs PUBKEYS. The claimed url is returned so a later caller can use it; it is not a gate here.
import { verifyEvent } from 'nostr-tools/pure';

// The house freshness window, ±5 minutes — the same number gateway.mjs applies to every other kind-27235
// proof it checks (_exportAuth, _syncAuth, the relay-name claims). Not a new constant: a second, different
// window would mean a proof one side calls fresh and the other calls stale.
export const RELAY_PROOF_WINDOW_SEC = 300;

// 32 hex characters = 128 bits from the platform CSPRNG. Returns '' if there is no CSPRNG at all, which
// fails the whole check closed — a predictable nonce is not a question only the real relay can answer, and
// asking a weak one is worse than not asking, because the answer LOOKS like proof.
export function relayIdentityNonce() {
  try {
    const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    if (!c || typeof c.getRandomValues !== 'function') return '';
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    let out = '';
    for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, '0');
    return out;
  } catch { return ''; }
}

// A relay's HTTP origin from the ws/wss URL we talk to it on — the same transform _relayInfo() uses for the
// NIP-11 probe, plus the trailing `/relay` path the member app carries on its socket URLs.
export function relayHttpBase(wssUrl) {
  return String(wssUrl || '')
    .replace(/^wss:\/\//i, 'https://')
    .replace(/^ws:\/\//i, 'http://')
    .replace(/\/relay\/?$/i, '')
    .replace(/\/+$/, '');
}

// → { relayPub, url } when this box proved it holds that key, or null.
//
// FAILS CLOSED ON EVERYTHING ELSE — unreachable, non-200, unparseable, wrong kind, bad signature, a nonce
// that is not the one we sent, a timestamp outside the window. There is no partial answer and no "probably":
// a caller that cannot tell those apart from success would be back to trusting a string.
export async function verifyRelayIdentity(wssUrl) {
  try {
    const base = relayHttpBase(wssUrl);
    if (!base) return null;
    const nonce = relayIdentityNonce();
    if (!nonce) return null;
    // Hard timeout via Promise.race as well as the signal — CapacitorHttp (native Android/iOS) patches fetch
    // and may IGNORE an AbortController, so the race is what actually bounds a hung probe on a device.
    const ctrl = new AbortController();
    const to = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 6000);
    let body = null;
    try {
      body = await Promise.race([
        (async () => {
          const res = await fetch(base + '/relay-identity?nonce=' + nonce, { signal: ctrl.signal, cache: 'no-store' });
          return res.ok ? res.json() : null;
        })(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('relay-identity timeout')), 6500)),
      ]);
    } finally { clearTimeout(to); }

    const ev = body && body.proof;
    if (!ev || ev.kind !== 27235) return null;
    if (typeof ev.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(ev.pubkey)) return null;
    // The signature is checked against the pubkey INSIDE the event, so an impostor putting the real relay's
    // pubkey in the field it wants to claim has to sign as that key to get past here — which is the point.
    if (!verifyEvent(ev)) return null;
    const tag = (n) => { const t = (ev.tags || []).find(x => Array.isArray(x) && x[0] === n); return t ? String(t[1] || '') : ''; };
    // OUR question, not one this host was asked earlier by somebody else. This single line is what makes a
    // captured proof worthless and a static pre-signed answer detectable.
    if (tag('nonce').toLowerCase() !== nonce) return null;
    const age = Math.abs(Math.floor(Date.now() / 1000) - (Number(ev.created_at) || 0));
    if (!(age <= RELAY_PROOF_WINDOW_SEC)) return null;
    return { relayPub: String(ev.pubkey).toLowerCase(), url: tag('relay') };
  } catch { return null; }
}
