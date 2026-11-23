// Direct Mode background check — Commit 1 entry (bundled by build-bg.mjs into assets/directpush/bg-bundle.js).
// Runs in a WebView hosted by DirectPushWorker at https://localhost (the app's own origin). NO React, NO UI.
//
// Import order matters: fellowship.src.js is evaluated first and installs window.Fellowship; its init() waits on the
// TrinityIdentity stub that bg.html defined, and the native layer resolves it with the mnemonic it read from the
// Keystore. Nothing here publishes: the only frames this page sends are REQ / AUTH / CLOSE (see __dpWsStats).
import '../../../src/fellowship.src.js';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';

const rep = (o) => { try { window.__dpRep(o); } catch (e) {} };
const NOTIFY_KINDS = [1, 4];   // group chat, DMs (Deliverable 1)
const SINCE_SLOP = 3 * 86400;            // fellowship's own overlap (SINCE_SLOP); kept equal, see summary
const lsJson = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };

window.__dpStart = async function (mnemonic, opts) {
  opts = opts || {};
  try {
    window.__dpSetMnemonic(mnemonic);
    const F = window.Fellowship;
    await F.ready;                                          // fellowship derived its own sk/pub from the injected mnemonic
    const sk = privateKeyFromSeedWords(mnemonic);           // the same derivation, for OUR signer (nip06)
    const pub = getPublicKey(sk);
    rep({ stage: 'keyderive', pub, fellowshipPub: F.myPubkey, match: pub === F.myPubkey });

    // ---- GATE 2: boot to the admitted relay set ----
    // PREREQUISITE (audit F-F): churchPub must be set BEFORE relaysForChurch(); app.jsx:1344 does exactly this.
    const activeId = lsJson('trinityone.activeChurch', null);
    const followed = lsJson('trinityone.followedChurches', []) || [];
    const entry = followed.find((c) => c && c.id === activeId) || null;
    const np = (entry && entry.npub) || (typeof activeId === 'string' && activeId.indexOf('npub1') === 0 ? activeId : null);
    if (!np) { rep({ stage: 'gate2', ok: false, why: 'no active church in localStorage', activeId }); return finish({ verdict: 'no-church', newSinceCursor: 0 }); }
    const cp = F.setChurch(np);
    const rfc = window.__dpRelaysForChurch;                 // the EXISTING relaysForChurch(), exposed by the build plugin
    if (typeof rfc !== 'function') { rep({ stage: 'gate2', ok: false, why: 'relaysForChurch not reachable' }); return finish({ verdict: 'gate2-fail', newSinceCursor: 0 }); }
    let set = [], warm = true;
    set = rfc(cp) || [];
    if (!set.length) {                                      // cold proof cache: let the normal prover run, never widen
      warm = false;
      try { await F.proveRelays(F.relays); } catch (e) {}
      const t0 = Date.now();
      while (Date.now() - t0 < 15000 && !(set = rfc(cp) || []).length) await new Promise((r) => setTimeout(r, 500));
    }
    // Rule-10 self-check: every address must be one the app itself would use (candidate list, church boxes, shipped pool).
    const known = new Set([...(F.relays || []), ...(F.CANONICAL_RELAYS || [])]);
    const outside = set.filter((u) => !known.has(u));
    rep({ stage: 'gate2', ok: set.length > 0, churchPub: cp, warmProofCache: warm, relays: set, notInAppCandidatesOrCanonical: outside });
    if (!set.length) return finish({ verdict: 'gate2-empty', newSinceCursor: 0 });

    // ---- GATE 3: NIP-42 auth + ONE since= REQ, counted ----
    const docs = lsJson('trinityone.docshub.' + cp, {});
    const mems = lsJson('trinityone.memhub.' + cp, {});
    const cursor = Math.max(docs.since || 0, mems.since || 0);          // READ only. We never write these (Phase 3).
    const since = opts.since && opts.since > 0 ? opts.since : cursor;   // opts.since is a debug override for the window
    const reqSince = Math.max(0, since - SINCE_SLOP);
    let skew = null; try { skew = await F.measureRelaySkew(); } catch (e) {}

    const pool = new SimplePool();
    const sign = (url) => async (authEvent) => {
      if (!F.relayVerified(url)) throw new Error('nip42: relay not admitted');   // same refusal fellowship applies
      stats.authSigned++; return finalizeEvent(authEvent, sk);
    };
    pool.automaticallyAuth = sign;
    const stats = { authSigned: 0, closed: [] };
    const seen = new Map();
    const dbg = opts.debug || {};   // debug-build aids only (adb --es debug): pTarget swaps the #p value; authProbe adds a gated read
    const KINDS = Array.isArray(dbg.kinds) ? dbg.kinds : NOTIFY_KINDS;   // debug-only widening of the KIND list; the relay set is never touched
    const filter = { kinds: KINDS, '#p': [dbg.pTarget === 'church' ? cp : pub], since: reqSince };
    if (dbg.noP) { delete filter['#p']; filter.limit = 5; }   // debug-only: any events at all, to prove count + notify
    const filters = [filter];
    // authProbe: a read of the safety-check doc is one the relay gates, so it draws a NIP-42 challenge from an
    // unauthenticated connection. Its events are NEVER counted; it exists only to exercise the auth path on-device.
    if (dbg.authProbe) filters.push({ kinds: [30078], '#d': ['safetycheck:' + cp] });
    rep({ stage: 'req', debug: dbg, filter: { kinds: NOTIFY_KINDS, since: reqSince }, cursor, sinceUsed: since, skew });
    await new Promise((resolve) => {
      let doneFlag = false;
      const fin = (why) => { if (doneFlag) return; doneFlag = true; try { sub.close(); } catch (e) {} try { pool.close(set); } catch (e) {} stats.endedBy = why; resolve(); };
      const sub = pool.subscribeMany(set, filters, {
        maxWait: 15000,
        onauth: async (ev) => { stats.authSigned++; return finalizeEvent(ev, sk); },   // if a relay answers CLOSED "auth-required:" (set is already admitted)
        onevent(e) { if (KINDS.indexOf(e.kind) >= 0 && !seen.has(e.id)) seen.set(e.id, e); },
        // An EOSE that arrives while we have just signed an AUTH can precede the relay's post-auth replay of the gated
        // events; closing at once would count a false zero. Give a replay a short window, only when auth happened.
        oneose() { if (stats.authSigned > 0) setTimeout(() => fin('eose+auth-grace'), 4000); else fin('eose'); },
        onclose(reasons) { stats.closed = (reasons || []).map((r) => String(r).slice(0, 120)); if (!doneFlag && stats.closed.length) fin('closed'); },
      });
      setTimeout(() => fin('timeout-30s'), 30000);
    });
    const evs = [...seen.values()];
    const newer = evs.filter((e) => e.created_at > since);
    const authProblem = stats.closed.some((r) => /auth|restricted|blocked/i.test(r));
    const skewBad = typeof skew === 'number' && Math.abs(skew) > 600;
    let verdict;
    if (evs.length === 0 && (authProblem || skewBad)) verdict = 'AUTH-FAILED-OR-CLOCK-SKEW (count is NOT a real zero)';
    else if (evs.length === 0 && stats.endedBy !== 'eose' && stats.endedBy !== 'eose+auth-grace') verdict = 'NO-ANSWER (' + stats.endedBy + ') (count is NOT a real zero)';
    else if (newer.length === 0) verdict = 'genuinely-0-new';
    else verdict = 'new-events';
    const byKind = {}; for (const e of newer) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    return finish({ verdict, newSinceCursor: newer.length, fetchedInWindow: evs.length, byKind, endedBy: stats.endedBy,
      authSigned: stats.authSigned, closedReasons: stats.closed, skew, cursor, since, reqSince });
  } catch (e) {
    rep({ stage: 'fatal', err: String(e && e.stack || e) });
  }
};

function finish(o) {
  const w = window.__dpWsStats || {};
  rep(Object.assign({ stage: 'summary', framesSent: w.sent, rx: (window.__dpRx || []).slice(0, 60), socketsOpened: Object.keys(w.urls || {}) }, o));
}
