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

// Build-time constant (build-bg.mjs --debug => true; default/release => false). esbuild folds `if (DP_DEBUG)` away, so a
// release bundle contains none of the debug switches or verbose reporting below.
// (DP_DEBUG is an esbuild `define`, substituted textually, so `DP_DEBUG && x` is folded away in release.)
// Release reports ONLY the two terminal stages the worker needs; nothing else leaves the page (no pub, relays, frames).
const rep = (o) => { try { if (DP_DEBUG || o.stage === 'summary' || o.stage === 'fatal') window.__dpRep(o); } catch (e) {} };
const DM_KIND = 4, GROUP_KIND = 1;   // DMs are #p-tagged to the member; group chat is #t-tagged to the group id (Deliverable 1)
const SINCE_SLOP = 3 * 86400;            // fellowship's own overlap (SINCE_SLOP); kept equal, see summary
const lsJson = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };

// ---- pure helpers (kept free of window/localStorage so they can be lifted and run by tests) ----
// The room-visibility rule, mirrored from app/screens-chat.jsx `churchGroups`. FAILS CLOSED: anything not clearly visible is out.
function visibleGroupIds(raw, myPub, minor) {
  if (!Array.isArray(raw)) return [];
  const me = String(myPub || '').toLowerCase();
  const out = new Set();
  for (const g of raw) {
    if (!g || typeof g.id !== 'string' || !g.id) continue;
    if (g.visibility === 'invite' && !(Array.isArray(g.members) && me && g.members.some((m) => String(m || '').toLowerCase() === me))) continue;
    if (minor && g.childsafe !== true) continue;
    out.add(g.id);
  }
  return [...out];
}
// OPT-IN GATE (Deliverable 2). The member's choice lives in the app's own localStorage (same origin as this page) under
// DP_OPTIN_KEY, written by NotifSettingsScreen in app/screens-extras.jsx. Anything but the exact string '1' is OFF
// (absent = default OFF; a read that throws = OFF). Fails closed.
const DP_OPTIN_KEY = 'trinityone.directpush.optin';
function directPushOptedIn(raw) { return raw === '1'; }
const readOptIn = () => { try { return localStorage.getItem(DP_OPTIN_KEY); } catch (e) { return null; } };
const isBlockDoc = (e, cp, d) => !!e && e.kind === 30078 && e.pubkey === cp && ((e.tags || []).find((t) => t[0] === 'd') || [])[1] === d;
// null => unparseable doc (caller fails closed); empty Set => no blocklist / nobody blocked.
function parseBlocked(doc) {
  const out = new Set();
  if (!doc) return out;
  try {
    const o = JSON.parse(doc.content || '{}');
    for (const p of (Array.isArray(o.pubkeys) ? o.pubkeys : [])) out.add(String(p || '').toLowerCase());
    return out;
  } catch (e) { return null; }
}
window.__dpStart = async function (mnemonic, opts) {
  opts = opts || {};
  try {
    // Not opted in: finish quietly BEFORE anything connects, authenticates or notifies (no Fellowship init, no sockets).
    if (!directPushOptedIn(readOptIn())) return finish({ verdict: 'not-opted-in', newSinceCursor: 0 });
    window.__dpSetMnemonic(mnemonic);
    const F = window.Fellowship;
    await F.ready;                                          // fellowship derived its own sk/pub from the injected mnemonic
    const sk = privateKeyFromSeedWords(mnemonic);           // the same derivation, for OUR signer (nip06)
    const pub = getPublicKey(sk);
    // The remember record's own `pub` must name the account this mnemonic derives; a record that does not match is never
    // used (fails closed for a remember record naming no owner). The plaintext source has no recorded owner to check.
    // (The app's 'trinityone.nostr.pub' marker is deliberately NOT used: identity.src.js documents it can be lost or stale.)
    const markerPub = (() => { try { return localStorage.getItem('trinityone.nostr.pub') || ''; } catch (e) { return ''; } })();
    if (DP_DEBUG) rep({ stage: 'idcheck', source: opts.source, recordPubMatches: opts.recordPub === pub, markerPubMatches: markerPub === pub });
    if (opts.source === 'remember' && opts.recordPub !== pub) return finish({ verdict: 'identity-mismatch', newSinceCursor: 0 });
    if (DP_DEBUG) rep({ stage: 'keyderive', pub, fellowshipPub: F.myPubkey, match: pub === F.myPubkey });

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
    if (DP_DEBUG) rep({ stage: 'gate2', ok: set.length > 0, churchPub: cp, warmProofCache: warm, relays: set, notInAppCandidatesOrCanonical: outside });
    if (!set.length) return finish({ verdict: 'gate2-empty', newSinceCursor: 0 });

    // ---- GATE 3: NIP-42 auth + ONE since= REQ, counted ----
    const docs = lsJson('trinityone.docshub.' + cp, {});
    const mems = lsJson('trinityone.memhub.' + cp, {});
    const cursor = Math.max(docs.since || 0, mems.since || 0);          // READ only. We never write these (Phase 3).
    const since = DP_DEBUG && opts.since && opts.since > 0 ? opts.since : cursor;   // opts.since is a debug override (compiled out of release)
    const reqSince = Math.max(0, since - SINCE_SLOP);
    let skew = null; try { skew = await F.measureRelaySkew(); } catch (e) {}

    const pool = new SimplePool();
    const stats = { authSigned: 0, closed: [] };
    const sign = (url) => async (authEvent) => {
      if (!F.relayVerified(url)) throw new Error('nip42: relay not admitted');   // same refusal fellowship applies
      stats.authSigned++; return finalizeEvent(authEvent, sk);
    };
    pool.automaticallyAuth = sign;
    const seen = new Map();
    let blockDoc = null;

    // GROUP IDS = the rooms THIS member could actually open, never the church's full directory (audit L1/F4).
    // The app caches the church's group DIRECTORY (every group, unfiltered; screens-chat.jsx writes it from
    // subscribeChurchGroups) at localStorage 'trinityone.groups.<church npub>'. Room visibility is applied at RENDER time
    // in screens-chat.jsx (`churchGroups`), so we re-apply EXACTLY that rule here, and fail closed:
    //   1. invite-only room: only if my pubkey is in its member list;
    //   2. a young person sees only rooms the church marked `childsafe` (Fellowship.assumeMinor, which answers TRUE when
    //      it cannot ask or has not heard, and for a fail-closed `catch`) -- an adults-only room is never counted.
    // Group chat events carry #t=<group id> (NOT #p=member). Missing cache => DM-only (never the full directory).
    const rawGroups = lsJson('trinityone.groups.' + np, []);
    // !! SAFEGUARDING NOTE -- minor-detection here is BEST-EFFORT. assumeMinor() runs BEFORE the main authed REQ, so
    // !! Fellowship's _relayAuthedAt is still unset and it FAILS CLOSED to minor=true (fewer rooms counted, never more).
    // !! The RELAY is the real safeguarding authority: it refuses adults-only content to a known minor no matter what
    // !! this phone asks for. Do NOT move this after any gated/authed read without re-checking that fail-closed
    // !! behaviour. Pinned by scripts/the-background-notify-filter-counts-only-rooms-the-member-can-open.test.mjs.
    let minor = true;                                       // fail closed until the engine answers
    try { minor = !!(await F.assumeMinor(np)); } catch (e) { minor = true; }
    const groupIds = visibleGroupIds(rawGroups, pub, minor);
    const dirSize = Array.isArray(rawGroups) ? rawGroups.length : 0;
    const filters = [{ kinds: [DM_KIND], '#p': [pub], since: reqSince }];
    if (groupIds.length) filters.push({ kinds: [GROUP_KIND], '#t': groupIds, since: reqSince });
    else rep({ stage: 'groups', ok: false, why: 'no visible groups (no cache, none for me, or all adults-only for a minor); DM-only', dirSize, minor });
    // BLOCKED SENDERS (audit L2): the church's own signed blocklist (kind 30078, author = church key, d = blocked:<cp>;
    // same document fellowship's _withoutBlocked reads). Read on the SAME admitted/authed REQ; its event is never counted.
    // A member may read it (the relay serves it to the church's members and to a blocked reader of their own entry).
    const BLOCKED_D = 'trinityone/blocked:' + cp;
    filters.push({ kinds: [30078], authors: [cp], '#d': [BLOCKED_D] });
    let KINDS = [DM_KIND, GROUP_KIND];
    if (DP_DEBUG) {
      // debug-build aids only (adb --es debug); compiled out of release. The relay set is never touched.
      const dbg = opts.debug || {};
      if (Array.isArray(dbg.kinds)) KINDS = dbg.kinds;
      if (dbg.noP) { filters.length = 0; filters.push({ kinds: KINDS, limit: 5, since: reqSince }); }
      else if (dbg.pTarget === 'church') filters[0]['#p'] = [cp];
      // authProbe: a gated read that draws a NIP-42 challenge; its events are NEVER counted.
      if (dbg.authProbe) filters.push({ kinds: [30078], '#d': ['safetycheck:' + cp] });
      rep({ stage: 'req', debug: dbg, filters, cursor, sinceUsed: since, skew });
    }
    // Group events are only ours if p-tagged to this church (same check subscribeGroups applies) and not our own posts.
    const counts = (e) => {
      if (KINDS.indexOf(e.kind) < 0) return false;
      if (e.kind === GROUP_KIND && !(DP_DEBUG && opts.debug && opts.debug.noP)) {
        if (e.pubkey === pub) return false;
        if (!e.tags.some((t) => t[0] === 'p' && t[1] === cp)) return false;
        if (!e.tags.some((t) => t[0] === 't' && groupIds.indexOf(t[1]) >= 0)) return false;
      }
      return true;
    };
    await new Promise((resolve) => {
      let doneFlag = false;
      const fin = (why) => { if (doneFlag) return; doneFlag = true; try { sub.close(); } catch (e) {} try { pool.close(set); } catch (e) {} stats.endedBy = why; resolve(); };
      const sub = pool.subscribeMany(set, filters, {
        maxWait: 15000,
        // if a relay answers CLOSED "auth-required:": the AUTH event names the relay (tag 'relay'); sign only for an admitted one
        onauth: async (ev) => {
          const rt = (ev.tags || []).find((t) => t[0] === 'relay');
          const url = rt && rt[1];
          if (!url || set.indexOf(url) < 0 || !F.relayVerified(url)) throw new Error('nip42: relay not admitted');
          stats.authSigned++; return finalizeEvent(ev, sk);
        },
        onevent(e) {
          if (isBlockDoc(e, cp, BLOCKED_D)) { if (!blockDoc || (e.created_at || 0) > (blockDoc.created_at || 0)) blockDoc = e; return; }
          if (counts(e) && !seen.has(e.id)) seen.set(e.id, e);
        },
        // An EOSE that arrives while we have just signed an AUTH can precede the relay's post-auth replay of the gated
        // events; closing at once would count a false zero. Give a replay a short window, only when auth happened.
        oneose() { if (stats.authSigned > 0) setTimeout(() => fin('eose+auth-grace'), 4000); else fin('eose'); },
        onclose(reasons) { stats.closed = (reasons || []).map((r) => String(r).slice(0, 120)); if (!doneFlag && stats.closed.length) fin('closed'); },
      });
      setTimeout(() => fin('timeout-30s'), 30000);
    });
    // Drop anything authored by a blocked sender (DMs and group chat alike). The blocklist arrives in the same stream, in any
    // order, so it is applied AFTER collection. No doc at all = nobody blocked; a doc we cannot parse fails CLOSED (count nothing).
    const bl = parseBlocked(blockDoc);
    let droppedBlocked = 0;
    const evs = [...seen.values()].filter((e) => {
      if (bl === null) { droppedBlocked++; return false; }
      if (bl.has(String(e.pubkey || '').toLowerCase())) { droppedBlocked++; return false; }
      return true;
    });
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
      authSigned: stats.authSigned, closedReasons: stats.closed, skew, cursor, since, reqSince, groupIds: groupIds.length, dirSize, minor, blockDocSeen: !!blockDoc, blockedCount: bl ? bl.size : -1, droppedBlocked });
  } catch (e) {
    // NEVER echo secrets: release sends only the error class; debug sends a message/stack scrubbed of the mnemonic and any 64-hex key.
    let err = String(e && e.name || 'Error');
    if (DP_DEBUG) {
      let t = String(e && e.stack || e);
      for (const w of String(mnemonic).trim().split(/\s+/)) if (w.length > 2) t = t.split(w).join('[w]');
      err = t.replace(/[0-9a-fA-F]{64}/g, '[hex]');
    }
    rep({ stage: 'fatal', err });
  }
};

function finish(o) {
  const w = window.__dpWsStats || {};
  if (DP_DEBUG) rep(Object.assign({ stage: 'summary', framesSent: w.sent, rx: (window.__dpRx || []).slice(0, 60), socketsOpened: Object.keys(w.urls || {}) }, o));
  else rep({ stage: 'summary', verdict: o.verdict, newSinceCursor: o.newSinceCursor });
}
