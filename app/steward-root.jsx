// steward-root.jsx — real entry for the TrinityOne steward surfaces.
// Renders the handoff's stew-* components as navigable pages (NOT on the design canvas).
// Phase B: wired to window.Steward (real church key + Nostr publishing on the self-hosted relay).
const { useState: useSt, useEffect: useStE } = React;

// bumps whenever the console's active identity switches (church <-> a network), so every data hook
// below re-subscribes against the now-active pubkey. (The header toggle calls setActiveIdentity.)
function useStewardIdv() {
  const [v, setV] = useSt(0);
  useStE(() => {
    const f = () => setV(x => x + 1);
    window.addEventListener('steward-identity', f);
    return () => window.removeEventListener('steward-identity', f);
  }, []);
  return v;
}
window.useStewardIdv = useStewardIdv;

// reconnect recovery: a relay WebSocket drops while the console is backgrounded AND every time the relay
// restarts (which happens on every deploy) — and a dropped socket silently misses live events, so the console
// shows stale data (e.g. a sermon uploaded elsewhere doesn't appear). Mirror the member app's connTick: bump on
// return-to-foreground / network-online / a 90s heartbeat, so every subscription tears down + re-subscribes and
// catches up. Kept SEPARATE from the identity version so it drives re-subscribe WITHOUT changing the cache key
// (no blank flash on reconnect — the last-known value stays painted while the fresh sub refreshes it).
// ONE shared reconnect ticker for the whole console (not one per hook — a dashboard mounts ~20 subscription hooks,
// which would otherwise each register 3 listeners + a 90s timer). It bumps a monotonic counter ONLY when a relay
// this console opened has actually dropped (relaysHealthy() === false) — so a healthy socket never fires the
// full-corpus re-query storm; a real drop (every deploy restarts the relay) re-subscribes everything once to recover.
const _connListeners = new Set();
let _connWired = false, _connLast = 0;
function _stewardHealthy() { try { return !window.Steward || !window.Steward.relaysHealthy || window.Steward.relaysHealthy(); } catch (e) { return true; } }
function _maybeBumpConn() { if (_stewardHealthy()) return; _connLast = Date.now(); _connListeners.forEach(fn => { try { fn(x => x + 1); } catch (e) {} }); }
function _wireStewardConn() {
  if (_connWired || typeof document === 'undefined') return; _connWired = true;
  const onVis = () => { if (document.visibilityState === 'visible' && Date.now() - _connLast > 2500) _maybeBumpConn(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('online', _maybeBumpConn);
  window.addEventListener('focus', onVis);
  setInterval(() => { if (document.visibilityState === 'visible') _maybeBumpConn(); }, 90000);   // insurance for a silently-dropped socket that no foreground event caught
}
function useStewardConn() {
  const [c, setC] = useSt(0);   // a real drop bumps this via the shared listener set → effects keyed on it re-subscribe
  useStE(() => { _wireStewardConn(); _connListeners.add(setC); return () => _connListeners.delete(setC); }, []);
  return c;
}
window.useStewardConn = useStewardConn;

// live church data from the relay. Nearly every hook here is the same shape — subscribe to a data stream,
// re-render when the active identity changes — so they're built from ONE factory instead of copy-paste.
// makeSub(getObj, method, makeInit) returns such a hook: guarded (a missing engine/method is a no-op),
// lazy per-instance initial value, re-subscribes on identity change. The handful that don't fit (custom
// callback, derived, polling, two-effect) stay hand-written below.
(function () {   // factory scope — keeps makeSub / S / MA / ME / _subCache out of the shared global scope
// PERF (2026-07-07): each console tab unmounts when you leave it, so a plain useState hook resets to empty and
// re-fetches from the relay on every navigation — over the Cloudflare tunnel that's a ~0.5s blank-then-reload on
// every page switch. Keep the last value each subscription delivered in a module-level cache (keyed by method +
// active identity) so a re-mounted tab paints its last-known data INSTANTLY, then the re-subscribe refreshes it
// silently in the background. Nothing is lost across navigation; only a genuine change re-renders.
const _subCache = {};
// PERF (audit 2026-07-24): this opened a fresh relay subscription per hook CALL, not per stream —
// useStewardMembers() is called at 20 sites, useStewardGroups() at 10, and every concurrently-mounted one
// re-streamed the church's whole document corpus (these filters carry no limit and no since-cursor). On a
// 2G link that made the console effectively unusable for a real church. The callers all want the SAME data,
// so hold one live subscription per (stream, identity, connection) and fan it out to every listener; close it
// when the last one unmounts. Ref-counted rather than leaked, and unchanged in behaviour: every listener still
// gets every delivery, and a late subscriber is handed the latest value immediately instead of waiting for the
// next one. (The deeper fix is porting the member app's _docsHub — cursors + one socket — but this is the
// contained 90% and does not touch the data layer.)
const _subShared = {};
function makeSub(getObj, method, makeInit) {
  return function () {
    const idv = useStewardIdv();
    const conn = useStewardConn();                                                       // reconnect → re-subscribe
    const key = method + '|' + idv;                                                      // cache by IDENTITY only (stable across reconnects → no blank flash)
    const [v, setV] = useSt(() => (key in _subCache ? _subCache[key] : makeInit()));   // paint last-known instantly
    useStE(() => {
      const o = getObj(); if (!o || !o[method]) return undefined;
      const skey = key + '|' + conn;                                                     // a reconnect must genuinely re-subscribe
      let entry = _subShared[skey];
      if (!entry) {
        entry = { listeners: new Set(), unsub: null, last: undefined };
        _subShared[skey] = entry;
        entry.unsub = o[method]((val) => { _subCache[key] = val; entry.last = val; for (const fn of [...entry.listeners]) { try { fn(val); } catch (e) {} } });
      }
      entry.listeners.add(setV);
      if (entry.last !== undefined) setV(entry.last);                                    // joined late — don't wait for the next delivery
      return () => {
        entry.listeners.delete(setV);
        if (!entry.listeners.size) { try { entry.unsub && entry.unsub(); } catch (e) {} delete _subShared[skey]; }
      };
    }, [idv, conn]);   // re-subscribe on identity change OR reconnect
    return v;
  };
}
// A cache key is written ONLY when the relay actually delivers, so its presence is the "this stream has
// loaded" signal. Exposed because an empty list is ambiguous: on a hard reload "nobody is admitted yet"
// and "the admitted list hasn't arrived" look identical, and a screen that concludes from the wrong one
// raises a false alarm for the second or two before the real data lands. Read it in a component that also
// holds the matching subscription — that hook's re-render on first delivery is what makes this flip.
window.stewardStreamLoaded = function (method, idv) { return (method + '|' + idv) in _subCache; };

const S = () => window.Steward, MA = () => window.StewardManna, ME = () => window.StewardMeals;

window.useStewardFunds = makeSub(S, 'subscribeFunds', () => []);
window.useStewardGroups = makeSub(S, 'subscribeGroups', () => []);
window.useStewardCategories = makeSub(S, 'subscribeCategories', () => []);
window.useStewardPlans = makeSub(S, 'subscribePlans', () => []);
window.useStewardDevotionals = makeSub(S, 'subscribeDevotionals', () => []);
window.useStewardRotas = makeSub(S, 'subscribeRotas', () => []);
window.useStewardRosters = makeSub(S, 'subscribeRosters', () => []);
window.useStewardServices = makeSub(S, 'subscribeServices', () => []);
window.useStewardRunsheets = makeSub(S, 'subscribeRunsheets', () => []);
window.useStewardCheckins = makeSub(S, 'subscribeCheckins', () => []);
window.useStewardEvents = makeSub(S, 'subscribeEvents', () => []);
window.useStewardRooms = makeSub(S, 'subscribeRooms', () => []);
window.useStewardBookings = makeSub(S, 'subscribeBookings', () => []);
window.useStewardUnavail = makeSub(S, 'subscribeUnavail', () => ({}));
window.useStewardRsvps = makeSub(S, 'subscribeRsvps', () => ({}));
window.useStewardRequestReplies = makeSub(S, 'subscribeRequestReplies', () => []);
window.useStewardRequests = makeSub(S, 'subscribeRequests', () => []);
window.useStewardBlocked = makeSub(S, 'subscribeBlocked', () => []);
window.useStewardStewards = makeSub(S, 'subscribeStewards', () => []);
window.usePendingStewards = makeSub(S, 'subscribeStewardRequests', () => []);
window.useStewardSafeguard = makeSub(S, 'subscribeSafeguard', () => ({ minors: [], approved: [] }));
window.useStewardGuardianRequests = makeSub(S, 'subscribeGuardianRequests', () => []);
window.useStewardGuardians = makeSub(S, 'subscribeGuardians', () => ({}));
window.useStewardJoinPolicy = makeSub(S, 'subscribeJoinPolicy', () => false);
window.useStewardAdmitted = makeSub(S, 'subscribeAdmitted', () => []);
window.useStewardStats = makeSub(S, 'subscribeStats', () => ({ events: 0, announcements: 0 }));
window.useStewardActivity = makeSub(S, 'subscribeActivity', () => []);
// Manna — optional money-out / disbursement module
window.useMannaSettings = makeSub(MA, 'subscribeSettings', () => ({ enabled: (window.StewardManna && window.StewardManna.cachedEnabled) ? window.StewardManna.cachedEnabled() : false }));
window.useMannaFunds = makeSub(MA, 'subscribeFunds', () => []);
window.useMannaRequests = makeSub(MA, 'subscribeRequests', () => []);
window.useMannaVouches = makeSub(MA, 'subscribeVouches', () => []);
window.useMannaTestimony = makeSub(MA, 'subscribeTestimony', () => []);
window.useMannaRecords = makeSub(MA, 'subscribeRecords', () => []);
// Meals / Care — optional practical-care module
window.useMealsSettings = makeSub(ME, 'subscribeSettings', () => ({ enabled: (window.StewardMeals && window.StewardMeals.cachedEnabled) ? window.StewardMeals.cachedEnabled() : false }));
window.useMealsNeeds = makeSub(ME, 'subscribeNeeds', () => []);
window.useMealsSlots = makeSub(ME, 'subscribeSlots', () => []);
window.useMealsSkips = makeSub(ME, 'subscribeSkips', () => []);
})();

// ── hooks that don't fit the factory (custom callback / derived / polling / two-effect) ──
function useStewardNetworks() {
  const [networks, setNetworks] = useSt([]);
  const conn = useStewardConn();
  useStE(() => window.Steward.subscribeNetworks(setNetworks), [conn]);   // re-subscribe after a relay restart / reconnect
  return networks;
}
window.useStewardNetworks = useStewardNetworks;

// churches whose owner-signed roster lists OUR key — we can act as their steward (phase 2b).
function useStewardStewardedChurches() {
  const conn = useStewardConn();
  const [churches, setChurches] = useSt([]);
  useStE(() => (window.Steward.subscribeStewardedChurches
    ? window.Steward.subscribeStewardedChurches(list => { setChurches(list); try { window.dispatchEvent(new CustomEvent('steward-networks')); } catch {} })
    : undefined), [conn]);   // re-subscribe after a relay drop/restart
  return churches;
}
window.useStewardStewardedChurches = useStewardStewardedChurches;

// people in this church's chat — seeded from the local roster cache so Members paints on first render
function useStewardMembers() {
  const idv = useStewardIdv();
  const conn = useStewardConn();
  const [members, setMembers] = useSt(() => { try { return JSON.parse(localStorage.getItem('trinityone.steward.members.' + ((window.Steward && window.Steward.churchPub) || '')) || '[]') || []; } catch { return []; } });
  useStE(() => window.Steward.subscribeMembers(setMembers), [idv, conn]);   // re-subscribe after a relay drop/restart
  return members;
}
window.useStewardMembers = useStewardMembers;

// pubkey -> member, for name lookups (derived from the members list)
function useStewardDirectory() {
  const members = useStewardMembers();
  return React.useMemo(() => {
    const map = {};
    (members || []).forEach(m => { if (m && m.pubkey) map[m.pubkey] = m; });
    return map;
  }, [members]);
}
window.useStewardDirectory = useStewardDirectory;

// live relay status (re-probed every 10s) + the church's footprint count on the relay
function useStewardRelays() {
  const [status, setStatus] = useSt([]);
  useStE(() => {
    let alive = true;
    const probe = () => window.Steward.relayStatus().then(s => { if (alive) setStatus(s); }).catch(() => {});
    // same as the member app: don't dial sockets on a timer while the tab is hidden (see screens-chat.jsx)
    probe(); const t = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') probe(); }, 30000);
    window.addEventListener('steward-relays', probe);
    return () => { alive = false; clearInterval(t); window.removeEventListener('steward-relays', probe); };
  }, []);
  return status;
}
window.useStewardRelays = useStewardRelays;

// the active identity's own profile (name etc.) + npub — church, or a network when toggled
function useStewardChurch() {
  const idv = useStewardIdv();
  const conn = useStewardConn();
  const [p, setP] = useSt({});
  useStE(() => { setP({}); }, [idv]);   // clear on identity switch ONLY (not on a reconnect — avoids a blank church-name flash)
  useStE(() => window.Steward.subscribeProfile(setP), [idv, conn]);   // (re)subscribe on identity change OR relay drop/restart
  // any instance that receives the kind-0 broadcasts it, so every view stays in sync even if this
  // instance's own relay sub mounted before the church's relays were ready.
  useStE(() => { const f = (e) => { if (e.detail) setP(e.detail); }; window.addEventListener('steward-profile', f); return () => window.removeEventListener('steward-profile', f); }, [idv]);
  return { name: (p && p.name) || '', nip05: (p && p.nip05) || '', channel: (p && p.channel) || '', audioFeed: (p && p.audioFeed) || '', lud16: (p && p.lud16) || '', giving: !!(p && p.giving), picture: (p && p.picture) || '', banner: (p && p.banner) || '', bannerFade: (p && typeof p.bannerFade === 'number') ? p.bannerFade : undefined, accent: (p && p.accent) || '', features: (p && p.features) || {}, rules: (p && p.rules) || {}, npub: window.Steward.npub || '', isNetwork: window.Steward.isViewingNetwork ? window.Steward.isViewingNetwork() : false };
}
window.useStewardChurch = useStewardChurch;

// load the church key if this device already has one. A fresh install has NO key — it shows the
// welcome screen (Start a new church / Restore a church) instead of silently minting one, so the
// steward chooses. Seeding the starter groups happens in "Start a new church" (seedNewChurch).
function initChurch() {
  const params = new URLSearchParams(location.search);
  // SECURITY-AUDIT-2026-07-06 H7: ?churchkey= is a DEV-ONLY test hook that overwrites the church key in
  // localStorage. Ungated, a crafted same-origin link ("tap to restore your church") could load an attacker
  // seed and — via the forced PIN step — overwrite the real encrypted key, permanently destroying an
  // un-backed-up church identity. Gate to localhost, and never overwrite an existing key (mirrors ?adopt).
  const isDevHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const inject = params.get('churchkey');                 // test hook: load a known church key (dev only)
  if (inject && isDevHost && !window.Steward.hasKey) { window.Steward.init(inject); return; }
  const adopt = params.get('adopt');                      // QR/link handoff: adopt a church on launch
  if (adopt && !window.Steward.hasKey) { try { window.Steward.adoptChurch(adopt); try { localStorage.setItem('trinityone.steward.wizard.done', '1'); } catch {} } catch (e) {} }
  // Scrub the seed-bearing params from the URL immediately — a church seed must never persist in history,
  // bookmarks, Referer, or the service-worker cache (see sw.js SENSITIVE_QS). Mirrors app.jsx's member-seed scrub.
  if (params.has('churchkey') || params.has('adopt') || params.has('church')) {
    try { const u = new URL(location.href); ['churchkey', 'adopt', 'church'].forEach(k => u.searchParams.delete(k)); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); } catch (e) {}
  }
  window.Steward.init();                                  // load the saved key if there is one (no auto-create)
  if (window.Steward.hasKey && window.Steward.selfRegister) window.Steward.selfRegister('').catch(() => {});
  // D2: once the console is up with a key, if the church already runs >=2 separate relay boxes, turn on cross-relay
  // sync automatically (deferred so it never competes with boot). Single-box churches are left alone + nudged.
  if (window.Steward.hasKey && window.Steward.autoSyncIfRedundant) setTimeout(() => { try { window.Steward.autoSyncIfRedundant(); } catch {} }, 5000);
}

// "Start a new church": mint a fresh key, register it, and seed the sample chat groups once (real
// signed events members can read). Self-register proves key ownership to the pool relays (no token).
function seedNewChurch() {
  window.Steward.createKey();
  if (window.Steward.selfRegister) window.Steward.selfRegister('').catch(() => {});
  try {
    if (!localStorage.getItem('trinityone.steward.seeded')) {
      localStorage.setItem('trinityone.steward.seeded', '1');
      // Seed with honest descriptions — NOT the showcase stats on SK.groups ("312 reached", "18 members"),
      // which would show invented member counts to a brand-new church's first real member.
      const SEED_SUB = { announce: 'Announcements for everyone', men: 'A midweek small group', women: 'A weekly Bible study', youth: 'For the young people', prayer: 'Share & lift requests' };
      (window.SK.groups || []).forEach(g => window.Steward.publishGroup({ id: g.id, name: g.name, kind: g.kind, sub: SEED_SUB[g.id] || '' }));
    }
  } catch (e) {}
}

// first-run choice for a fresh install: start a new church, or restore one (scan a handoff QR / paste
// the phrase). Once a key exists the StewardRoot swaps to the console (steward-key event re-renders).
function StewardWelcome() {
  const [mode, setMode] = useSt('choose');   // choose | restore | scanning | steward
  const [phrase, setPhrase] = useSt('');
  const [err, setErr] = useSt('');
  const [code, setCode] = useSt('');         // this device's "become a steward" code (steward path)
  const [npub, setNpub] = useSt('');
  const [showQR, setShowQR] = useSt(false);
  const [copied, setCopied] = useSt(false);
  const adopt = (payload) => {
    setErr('');
    try {
      window.Steward.adoptChurch(payload);
      // a restored church already exists (name, groups) — don't run the new-church setup wizard
      try { localStorage.setItem('trinityone.steward.wizard.done', '1'); } catch {}
      if (window.Steward.selfRegister) window.Steward.selfRegister('').catch(() => {});
    } catch (e) { setMode('restore'); setErr((e && e.message) || 'That code or phrase isn’t valid.'); }
  };
  // "Help run a church": mint an identity quietly (no church registration) and show its steward code, so a
  // newcomer can become a steward without first creating their own church. They give the code to the owner.
  const becomeSteward = () => {
    const r = window.Steward.createKeyQuiet ? window.Steward.createKeyQuiet() : null;
    if (!r) return;
    try { localStorage.setItem('trinityone.steward.wizard.done', '1'); } catch {}
    setCode(r.code); setNpub(r.npub); setMode('steward');
  };
  const [pinVal, setPinVal] = useSt('');
  const [pinBusy, setPinBusy] = useSt(false);
  // a steward key can act for a church → encrypt it at rest behind a PIN before entering the console.
  const finishWithPin = async () => {
    if (pinVal.length < 6) { setErr('Use at least 6 characters — a short PIN is quick to guess. A memorable passphrase is stronger still.'); return; }   // SECURITY-AUDIT-2026-07-18: raised 4→6 (a 4-digit PIN is ~10^4, brute-forceable offline from a copied blob even at PBKDF2-600k)
    setPinBusy(true);
    try { await window.Steward.setPin(pinVal); } catch (e) {}
    setPinBusy(false);
    window.Steward.enterConsole();
  };
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());   // camera scan is app-only; the webapp uses the paste/code paths
  const card = { width: 'min(440px, 92vw)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 22, boxShadow: 'var(--shadow-lg)', padding: 28 };
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'radial-gradient(120% 80% at 50% -10%, var(--gold-tint, #f6edda), var(--paper))' }}>
      <div style={card}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 18, textAlign: 'center' }}>
          <Halo size={40} color="var(--ink)" spark="var(--clay)" />
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, letterSpacing: '-.3px' }}>Steward console</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{mode === 'choose' ? 'Set up a new church, take over an existing one, or help run one.' : (mode === 'steward' || mode === 'steward-pin') ? 'Becoming a steward of an existing church.' : 'Restore a church from another steward.'}</div>
        </div>

        {mode === 'choose' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <button onClick={seedNewChurch} className="sk-btn sk-btn--clay" style={{ padding: '14px 16px', fontSize: 15, justifyContent: 'center' }}><Icon name="plus" size={17} color="var(--on-clay)" /> Start a new church</button>
            <button onClick={() => { setErr(''); setMode('restore'); }} className="sk-btn sk-btn--ghost" style={{ padding: '14px 16px', fontSize: 15, justifyContent: 'center' }}><Icon name="refresh" size={17} color="currentColor" /> Restore a church</button>
            <button onClick={becomeSteward} className="sk-btn sk-btn--ghost" style={{ padding: '14px 16px', fontSize: 15, justifyContent: 'center' }}><Icon name="shield" size={17} color="currentColor" /> Help run a church</button>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', marginTop: 4, lineHeight: 1.5 }}>“Help run a church” makes your steward code — the church’s owner adds it to make you a steward (no key shared).</div>
          </div>
        ) : mode === 'steward' ? (
          <div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 12 }}>Tell the church’s owner your steward name and give them this code. They add it under <b>Delegated stewards</b>, and that church then appears here in your switcher. It shares only your public ID — never a key.</div>
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'color-mix(in oklab, var(--gold) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 26%, var(--line))', marginBottom: 10 }}>
              <div title="A memorable name generated from your key — the same key always makes this exact name. The owner compares it when adding you, so it's a quick human cross-check that they've got the right person. It isn't a display name; your npub is the real identifier." style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', cursor: 'help' }}>Your steward name</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, color: 'var(--ink)' }}>{(window.Steward.stewardName && window.Steward.stewardName(npub)) || '—'}</div>
            </div>
            <SkKey value={npub || '—'} label="your steward code" />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button onClick={() => { copyText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); }} className="sk-btn sk-btn--clay" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name={copied ? 'check' : 'receipt'} size={14} color="var(--on-clay)" /> {copied ? 'Copied' : 'Copy code'}</button>
              <button onClick={() => setShowQR(s => !s)} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="qr" size={14} color="currentColor" /> {showQR ? 'Hide QR' : 'Show QR'}</button>
            </div>
            {showQR && window.Steward.qrSVG ? <div role="img" aria-label="Handoff QR code — or use the code shown below" style={{ width: 184, height: 184, margin: '12px auto 0', background: '#fff', borderRadius: 12, padding: 8, boxSizing: 'border-box' }} dangerouslySetInnerHTML={{ __html: window.Steward.qrSVG(code) }} /> : null}
            <button onClick={() => { setErr(''); setMode('steward-pin'); }} className="sk-btn sk-btn--clay" style={{ padding: '12px 16px', fontSize: 14.5, width: '100%', justifyContent: 'center', marginTop: 16 }}>Continue <Icon name="chevR" size={15} color="var(--on-clay)" /></button>
            <button onClick={() => { try { location.reload(); } catch (e) {} }} className="sk-btn sk-btn--ghost" style={{ padding: '10px 16px', fontSize: 13, width: '100%', justifyContent: 'center', marginTop: 8 }}>Start over</button>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>You can find this code again anytime under Settings → Security → Become a steward.</div>
          </div>
        ) : mode === 'steward-pin' ? (
          <div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>Set a PIN to protect this device. Your steward key can act for a church, so it’s <b>encrypted on this device</b> and the PIN unlocks it — a lost or shared phone can’t act as a church without it.</div>
            <input type="password" inputMode="numeric" value={pinVal} onChange={e => { setPinVal(e.target.value); setErr(''); }} autoFocus placeholder="Choose a PIN (6+ chars, or a longer passphrase)" onKeyDown={e => { if (e.key === 'Enter' && pinVal.length >= 6 && !pinBusy) finishWithPin(); }} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '12px 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', letterSpacing: '2px' }} />
            {err ? <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', fontWeight: 600, marginTop: 7 }}>{err}</div> : null}
            <button onClick={finishWithPin} disabled={pinVal.length < 6 || pinBusy} className="sk-btn sk-btn--clay" style={{ padding: '12px 16px', fontSize: 14.5, width: '100%', justifyContent: 'center', marginTop: 14, opacity: (pinVal.length >= 6 && !pinBusy) ? 1 : 0.5 }}><Icon name="lock" size={16} color="var(--on-clay)" /> {pinBusy ? 'Setting…' : 'Set PIN & enter'}</button>
            <button onClick={() => { setErr(''); setMode('steward'); }} className="sk-btn sk-btn--ghost" style={{ padding: '10px 16px', fontSize: 13.5, width: '100%', justifyContent: 'center', marginTop: 8 }}><Icon name="chevL" size={15} color="currentColor" /> Back</button>
            {/* SECURITY-AUDIT-2026-06-25 Critical-2: Skip is gone — PIN is mandatory. If the user
                bypasses this screen anyway (back-button, refresh), the StewardForcedPin modal will
                fire on the next render because window.Steward.needsPin is still true. */}
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>You can change this later under Settings → Security → Console lock.</div>
          </div>
        ) : mode === 'scanning' ? (
          <div>
            <StewQRScanner onResult={adopt} onCancel={() => setMode('restore')} />
            <button onClick={() => setMode('restore')} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13, marginTop: 12, width: '100%', justifyContent: 'center' }}>Enter the phrase instead</button>
          </div>
        ) : (
          <div>
            {isNative ? <button onClick={() => { setErr(''); setMode('scanning'); }} className="sk-btn sk-btn--clay" style={{ padding: '13px 16px', fontSize: 14.5, width: '100%', justifyContent: 'center', marginBottom: 14 }}><Icon name="qr" size={16} color="var(--on-clay)" /> Scan the handoff QR</button> : null}
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 7 }}>{isNative ? 'OR PASTE THE 12-WORD PHRASE' : 'PASTE THE 12-WORD PHRASE'}</div>
            <textarea value={phrase} onChange={e => setPhrase(e.target.value)} rows={3} placeholder="word one  word two  word three …" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '11px 13px', fontSize: 13.5, fontFamily: 'var(--mono)', color: 'var(--ink)', outline: 'none', resize: 'vertical', lineHeight: 1.6 }} />
            {err ? <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', fontWeight: 600, marginTop: 6 }}>{err}</div> : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => adopt(phrase)} disabled={!phrase.trim()} className="sk-btn sk-btn--clay" style={{ padding: '10px 14px', fontSize: 14, opacity: phrase.trim() ? 1 : 0.5 }}><Icon name="refresh" size={15} color="var(--on-clay)" /> Restore church</button>
              <button onClick={() => { setErr(''); setMode('choose'); }} className="sk-btn sk-btn--ghost" style={{ padding: '10px 14px', fontSize: 14 }}>Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
window.StewardWelcome = StewardWelcome;

const SURFACES = [
  { key: 'console',   label: 'Console',     ic: 'sliders' },
  { key: 'relay',     label: 'Suite',       ic: 'globe' },
  { key: 'extension', label: 'Extension',   ic: 'lock' },
  { key: 'phone',     label: 'Phone mode',  ic: 'today' },
  { key: 'custody',   label: 'Key custody', ic: 'shield' },
];

// fixed-size desktop frame for the surfaces that fill their container
function Frame({ w, h, children }) {
  return (
    <div style={{ width: w, height: h, maxWidth: '100%', maxHeight: '100%', borderRadius: 18, overflow: 'hidden',
      background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)' }}>{children}</div>
  );
}

function SegBtn({ on, onClick, children, icon }) {
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', cursor: 'pointer',
      padding: '8px 13px', borderRadius: 9, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13,
      background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--clay)' : 'var(--ink-2)',
      boxShadow: on ? 'var(--shadow-sm)' : 'none', transition: 'all .15s' }}>
      {icon ? <Icon name={icon} size={15} color={on ? 'var(--clay)' : 'var(--ink-3)'} /> : null}{children}
    </button>
  );
}

// SECURITY-AUDIT-2026-06-25 Critical-2: Forced PIN-setup modal. Shown the moment a fresh church key
// is created (no PIN yet → plaintext only in memory) OR an existing plaintext seed is found in
// localStorage on init (legacy install, needs migration). PIN is now MANDATORY — no Skip. The
// modal blocks every other surface until the steward sets one, which atomically replaces any
// plaintext seed in KEY_LS with the AES-GCM/PBKDF2-encrypted form in ENC_LS.
function StewardForcedPin() {
  const [pin, setPin] = useSt('');
  const [busy, setBusy] = useSt(false);
  const [err, setErr] = useSt('');
  const submit = async () => {
    if (pin.length < 4 || busy) return;
    setBusy(true); setErr('');
    const ok = await window.Steward.setPin(pin);
    if (!ok) { setBusy(false); setErr('Setting the PIN failed — try again.'); setPin(''); return; }
    // success: window.Steward.needsPin becomes false, the steward-needs-pin event fires, StewardRoot re-renders into the console.
  };
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'radial-gradient(120% 80% at 50% -10%, var(--gold-tint, #f6edda), var(--paper))' }}>
      <div style={{ width: 'min(440px, 92vw)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 22, boxShadow: 'var(--shadow-lg)', padding: 28, textAlign: 'center' }}>
        <Halo size={40} color="var(--ink)" spark="var(--clay)" />
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21, margin: '12px 0 4px' }}>Set a console PIN</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 18, textAlign: 'left' }}>
          Your church key signs as the <b>whole church</b> — if it leaks, an attacker can impersonate
          the church to every member. A PIN encrypts the key on this device so a stolen phone or
          copied browser storage holds nothing usable. You can change it anytime under{' '}
          <b>Settings → Security</b>.
        </div>
        <input type="password" value={pin} autoFocus onChange={e => { setPin(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="Choose a PIN (4+ chars; passphrase OK)" inputMode="numeric" autoComplete="new-password"
          style={{ width: '100%', boxSizing: 'border-box', height: 50, textAlign: 'center', letterSpacing: 6, fontSize: 20, border: `1px solid ${err ? 'var(--clay)' : 'var(--line)'}`, borderRadius: 13, background: 'var(--surface-2)', color: 'var(--ink)', outline: 'none', fontFamily: 'var(--font-ui)' }} />
        {err ? <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', fontWeight: 600, marginTop: 8 }}>{err}</div> : null}
        <button onClick={submit} disabled={pin.length < 4 || busy} className="sk-btn sk-btn--clay" style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15, marginTop: 14, opacity: (pin.length >= 4 && !busy) ? 1 : .5 }}><Icon name="lock" size={16} color="var(--on-clay)" /> {busy ? 'Setting…' : 'Set PIN & enter'}</button>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 11, lineHeight: 1.5 }}>
          Required. If you forget the PIN, recover the church via your 12-word phrase on any device.
        </div>
      </div>
    </div>
  );
}
window.StewardForcedPin = StewardForcedPin;

// PIN unlock gate — shown when the church key is encrypted at rest and not yet unlocked this session
function StewardUnlock() {
  // SECURITY-AUDIT-2026-07-18: throttle on-device PIN guessing (grab-and-guess). After 5 misses, impose an
  // escalating cooldown persisted across reloads so a reload can't reset it. NB this defends the on-device
  // attacker; offline brute-force of a copied blob is bounded by PIN length + PBKDF2-600k, not by this guard.
  const GUARD_KEY = 'trinityone.steward.pinguard';
  const readGuard = () => { try { return JSON.parse(localStorage.getItem(GUARD_KEY) || '{}') || {}; } catch { return {}; } };
  const [pin, setPin] = useSt('');
  const [busy, setBusy] = useSt(false);
  const [err, setErr] = useSt('');
  const [waitLeft, setWaitLeft] = useSt(() => { const g = readGuard(); return Math.max(0, Math.ceil(((g.until || 0) - Date.now()) / 1000)); });
  useStE(() => { if (waitLeft <= 0) return; const t = setInterval(() => { const g = readGuard(); const left = Math.max(0, Math.ceil(((g.until || 0) - Date.now()) / 1000)); setWaitLeft(left); if (left <= 0) { setErr(''); clearInterval(t); } }, 500); return () => clearInterval(t); }, [waitLeft > 0]);   // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    if (!pin || busy) return;
    const g0 = readGuard();
    if ((g0.until || 0) > Date.now()) { setErr('Too many attempts — wait a moment.'); return; }
    setBusy(true); setErr('');
    const ok = await window.Steward.unlock(pin);   // fires steward-key on success → StewardRoot re-renders
    if (ok) { try { localStorage.removeItem(GUARD_KEY); } catch {} return; }
    const fails = (g0.fails || 0) + 1;
    const until = fails >= 5 ? Date.now() + Math.min(30 * Math.pow(2, fails - 5), 3600) * 1000 : 0;   // 30s,60s,120s… cap 1h from the 5th miss
    try { localStorage.setItem(GUARD_KEY, JSON.stringify({ fails, until })); } catch {}
    setBusy(false); setPin('');
    if (until > Date.now()) { setWaitLeft(Math.ceil((until - Date.now()) / 1000)); setErr('Too many attempts — locked briefly.'); }
    else setErr('Wrong PIN — try again.' + (fails >= 3 ? ' (' + fails + ' tries)' : ''));
  };
  const blocked = waitLeft > 0;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'radial-gradient(120% 80% at 50% -10%, var(--gold-tint, #f6edda), var(--paper))' }}>
      <div style={{ width: 'min(380px, 92vw)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 22, boxShadow: 'var(--shadow-lg)', padding: 28, textAlign: 'center' }}>
        <Halo size={40} color="var(--ink)" spark="var(--clay)" />
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21, margin: '12px 0 4px' }}>Console locked</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 18 }}>Enter the PIN to unlock this church on this device.</div>
        <input type="password" value={pin} autoFocus disabled={blocked} onChange={e => { setPin(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter' && !blocked) submit(); }}
          placeholder="PIN" inputMode="numeric" autoComplete="off"
          style={{ width: '100%', boxSizing: 'border-box', height: 50, textAlign: 'center', letterSpacing: 6, fontSize: 20, border: `1px solid ${err ? 'var(--clay)' : 'var(--line)'}`, borderRadius: 13, background: 'var(--surface-2)', color: 'var(--ink)', outline: 'none', fontFamily: 'var(--font-ui)', opacity: blocked ? .6 : 1 }} />
        {err ? <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', fontWeight: 600, marginTop: 8 }}>{err}{blocked ? ' (' + waitLeft + 's)' : ''}</div> : null}
        <button onClick={submit} disabled={!pin || busy || blocked} className="sk-btn sk-btn--clay" style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15, marginTop: 14, opacity: (!pin || busy || blocked) ? .5 : 1 }}>{blocked ? 'Locked — wait ' + waitLeft + 's' : (busy ? 'Unlocking…' : 'Unlock')}</button>
      </div>
    </div>
  );
}

function StewardRoot() {
  const params = new URLSearchParams(location.search);
  const showcase = params.get('showcase') === '1';   // ?showcase=1 = the design gallery (reference)
  const [surface, setSurface] = useSt(SURFACES.some(s => s.key === params.get('surface')) ? params.get('surface') : 'console');
  // Setup wizard is for a church that doesn't exist yet — never gate it behind an unlock PIN. So ?setup=1 only
  // opens the wizard when there's NO church key; an existing church (locked or not) goes to its normal console.
  const [consoleView, setConsoleView] = useSt((params.get('setup') === '1' && !window.Steward.hasKey) ? 'wizard' : 'dashboard');
  // a fresh install has no church key → welcome; an encrypted key → unlock gate; otherwise → console.
  const [ks, setKs] = useSt(() => ({ has: !!window.Steward.hasKey, locked: !!window.Steward.locked }));
  useStE(() => { const f = () => setKs({ has: !!window.Steward.hasKey, locked: !!window.Steward.locked }); window.addEventListener('steward-key', f); return () => window.removeEventListener('steward-key', f); }, []);
  // A RESTORED / adopted / "help run a church" identity already exists — the restore path marks the wizard
  // "done" (see StewardWelcome). Honour that once a key lands, so opening with ?setup=1 (the desktop app's
  // first launch) never drops a JUST-RESTORED church into the new-church setup wizard.
  useStE(() => { if (ks.has) { try { if (localStorage.getItem('trinityone.steward.wizard.done') === '1') setConsoleView('dashboard'); } catch (e) {} } }, [ks.has]);
  // SECURITY-AUDIT-2026-06-25 Critical-2: needsPin gates the entire console behind a forced PIN modal
  // whenever a freshly-created or legacy-plaintext seed has not been encrypted yet. Tracks both the
  // dedicated steward-needs-pin event AND steward-key (because createKey() fires steward-key after
  // marking needsPin).
  const [needsPin, setNeedsPin] = useSt(() => !!window.Steward.needsPin);
  useStE(() => {
    const f = () => setNeedsPin(!!window.Steward.needsPin);
    window.addEventListener('steward-needs-pin', f);
    window.addEventListener('steward-key', f);
    return () => { window.removeEventListener('steward-needs-pin', f); window.removeEventListener('steward-key', f); };
  }, []);
  // idle auto-lock: when a PIN is set, forget the key after 10 min of no activity (re-prompt on return)
  useStE(() => {
    if (!ks.has || !window.Steward.hasPinLock || !window.Steward.hasPinLock()) return;
    let t; const reset = () => { clearTimeout(t); t = setTimeout(() => window.Steward.lock(), 10 * 60 * 1000); };
    const evs = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    evs.forEach(e => window.addEventListener(e, reset, { passive: true })); reset();
    return () => { clearTimeout(t); evs.forEach(e => window.removeEventListener(e, reset)); };
  }, [ks.has]);

  // ── Real product: steward.html IS the console, full-window ──
  if (!showcase) {
    return (
      <div className="stew-root" style={{ height: '100%' }}>
        {ks.locked ? <StewardUnlock />
          : !ks.has ? <StewardWelcome />
          : needsPin ? <StewardForcedPin />
          : consoleView === 'wizard' ? <StewWizard onDone={() => setConsoleView('dashboard')} /> : <StewDashboard initial={params.get('tab') || 'overview'} />}
      </div>
    );
  }

  // ── ?showcase=1: the design gallery of every surface (kept for reference) ──
  let body = null;
  if (surface === 'console') body = <Frame w={1180} h={800}>{consoleView === 'wizard' ? <StewWizard onDone={() => setConsoleView('dashboard')} /> : <StewDashboard initial={params.get('tab') || 'overview'} />}</Frame>;
  else if (surface === 'relay') body = <Frame w={1180} h={760}><RelayNodeApp initial={params.get('relay') === 'setup' ? 'setup' : 'running'} /></Frame>;
  else if (surface === 'extension') body = params.get('ext') === 'home' ? <StewExtensionHome /> : <StewExtensionRequest />;
  else if (surface === 'phone') body = <StewPhone initial={params.get('phone') || 'home'} />;
  else if (surface === 'custody') body = <Frame w={1180} h={624}><CustodyExplainer /></Frame>;

  const seg = { display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' };
  return (
    <div className="stew-root" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Halo size={24} color="var(--ink)" spark="var(--clay)" />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>Trinity<span style={{ color: 'var(--clay)' }}>One</span></span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.5px', color: 'var(--ink-3)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 6px' }}>SHOWCASE</span>
        </div>
        <div style={{ flex: 1 }} />
        {surface === 'console' ? (
          <div style={seg}>
            <SegBtn on={consoleView === 'dashboard'} onClick={() => setConsoleView('dashboard')}>Dashboard</SegBtn>
            <SegBtn on={consoleView === 'wizard'} onClick={() => setConsoleView('wizard')}>Setup</SegBtn>
          </div>
        ) : null}
        <div style={seg}>
          {SURFACES.map(s => <SegBtn key={s.key} on={s.key === surface} icon={s.ic} onClick={() => setSurface(s.key)}>{s.label}</SegBtn>)}
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28, background: '#efece6' }}>
        {body}
      </div>
    </div>
  );
}

initChurch();   // set the church key + start seeding BEFORE any component subscribes to funds
ReactDOM.createRoot(document.getElementById('root')).render(<StewardRoot />);
