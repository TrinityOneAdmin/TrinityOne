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
// IT DOES REFUSE A RELAY WHOSE SIGNED ADDRESS IS NOT THE ONE WE DIALLED, and that is the whole point of the
// binding. Without it a host running NONE of our software forwards this request to a real relay, passes the
// genuine proof back, and terminates the socket itself — the corpus and every member's IP land on a reverse
// proxy while every check says "TrinityOne". The relay half (gateway.mjs `relayIdentityUrl`) is what makes
// the comparison mean anything: a box declares the addresses it answers at and signs the dialled one only
// when it is one of them, because a `Host` header is chosen by whoever stands in front of it.
//
// COMPARED THE WAY THE POOL COMPARES. Trailing slash, default :80/:443, case, and http↔ws form all have to
// normalise away or a correct relay is refused for a cosmetic difference — three trailing-slash misses are
// already recorded in this codebase. And the comparison is against the URL we DIALLED, never `response.url`:
// fetch follows redirects, so a 302 to the real relay would otherwise compare a forwarder's proof against
// the relay's own address and pass.
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

// Normalise a relay address for comparison, the way nostr-tools' normalizeURL does for the pool: lowercase
// host, ws/wss form, no default port, no trailing slash, path preserved. Path IS preserved deliberately —
// clients dial `wss://host/relay`, and comparing host-only would re-admit a forwarder sitting on another
// port or path of a legitimate host, which is the quiet version of the hole this closes.
// SCHEME IS DELIBERATELY EXCLUDED; HOST, PORT AND PATH ARE NOT.
//
// Those three are what a forwarder cannot fake — it would have to be declared by the relay to be signed at
// all — and keeping the PATH is what stops a forwarder sitting on another path of a legitimate host, which
// is the quiet version of the hole this closes. The scheme carries no such weight and cannot be compared
// honestly: the same box is legitimately dialled `wss://` through a tunnel that terminates TLS and `ws://`
// on the loopback behind it, an invite is REQUIRED to carry wss://, and a proxy that does not set
// `x-forwarded-proto` leaves the relay unable to know which one the caller used. Comparing it refuses
// correct relays for a cosmetic difference — measured: 8 legitimate cases in
// an-invite-cannot-choose-your-relay.test.mjs, every one a real box.
//
// Refusing cleartext `ws://` is a SEPARATE rule and belongs on the dialled URL before we ever get here, not
// smuggled into an equality test that would then be silently doing two jobs.
export function relayAddrKey(u) {
  let str = String(u || '').trim();
  if (!str) return '';
  str = str.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
  try {
    const p = new URL(str);
    const proto = p.protocol.toLowerCase();
    const port = ((p.port === '80' && proto === 'ws:') || (p.port === '443' && proto === 'wss:')) ? '' : p.port;
    const path = p.pathname.replace(/\/+$/, '');
    return p.hostname.toLowerCase() + (port ? ':' + port : '') + path;
  } catch { return str.toLowerCase().replace(/^wss?:\/\//, '').replace(/\/+$/, ''); }
}

// → { relayPub, url } when this box proved it holds that key AT THE ADDRESS WE DIALLED, or null.
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
          // `for=` names the address we are about to trust, so the relay can bind the PATH as well as the
          // host — this HTTP request carries no trace of the socket URL otherwise. The relay signs it only
          // if it is one of the addresses it declares, so this chooses among declared entries and can never
          // introduce one.
          const res = await fetch(base + '/relay-identity?nonce=' + nonce + '&for=' + encodeURIComponent(String(wssUrl || '')),
            { signal: ctrl.signal, cache: 'no-store' });
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
    // THE ADDRESS BINDING. The signed `relay` tag must be the address we dialled. A forwarder that sends its
    // own Host gets no proof at all (the relay refuses to sign an address it does not declare); a forwarder
    // that rewrites Host to the real relay's name gets a proof naming THAT relay, which is not what we
    // dialled. Compare against `wssUrl`, the argument — never anything derived from the response.
    if (relayAddrKey(tag('relay')) !== relayAddrKey(wssUrl)) return null;
    const age = Math.abs(Math.floor(Date.now() / 1000) - (Number(ev.created_at) || 0));
    if (!(age <= RELAY_PROOF_WINDOW_SEC)) return null;
    return { relayPub: String(ev.pubkey).toLowerCase(), url: tag('relay') };
  } catch { return null; }
}
