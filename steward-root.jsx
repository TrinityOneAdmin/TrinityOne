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

// live church data from the relay (published by this console). Shared by the dashboard sections.
function useStewardFunds() {
  const idv = useStewardIdv();
  const [funds, setFunds] = useSt([]);
  useStE(() => window.Steward.subscribeFunds(setFunds), [idv]);
  return funds;
}
window.useStewardFunds = useStewardFunds;

function useStewardGroups() {
  const idv = useStewardIdv();
  const [groups, setGroups] = useSt([]);
  useStE(() => window.Steward.subscribeGroups(setGroups), [idv]);
  return groups;
}
window.useStewardGroups = useStewardGroups;

function useStewardCategories() {
  const idv = useStewardIdv();
  const [cats, setCats] = useSt([]);
  useStE(() => window.Steward.subscribeCategories ? window.Steward.subscribeCategories(setCats) : undefined, [idv]);
  return cats;
}
window.useStewardCategories = useStewardCategories;

function useStewardPlans() {
  const idv = useStewardIdv();
  const [plans, setPlans] = useSt([]);
  useStE(() => window.Steward.subscribePlans(setPlans), [idv]);
  return plans;
}
window.useStewardPlans = useStewardPlans;

function useStewardDevotionals() {
  const idv = useStewardIdv();
  const [devos, setDevos] = useSt([]);
  useStE(() => window.Steward.subscribeDevotionals(setDevos), [idv]);
  return devos;
}
window.useStewardDevotionals = useStewardDevotionals;

function useStewardRotas() {
  const idv = useStewardIdv();
  const [rotas, setRotas] = useSt([]);
  useStE(() => window.Steward.subscribeRotas(setRotas), [idv]);
  return rotas;
}
window.useStewardRotas = useStewardRotas;

function useStewardRosters() {
  const idv = useStewardIdv();
  const [rosters, setRosters] = useSt([]);
  useStE(() => window.Steward.subscribeRosters(setRosters), [idv]);
  return rosters;
}
window.useStewardRosters = useStewardRosters;

function useStewardServices() {
  const idv = useStewardIdv();
  const [services, setServices] = useSt([]);
  useStE(() => window.Steward.subscribeServices(setServices), [idv]);
  return services;
}
window.useStewardServices = useStewardServices;
function useStewardRunsheets() {
  const idv = useStewardIdv();
  const [sheets, setSheets] = useSt([]);
  useStE(() => window.Steward.subscribeRunsheets(setSheets), [idv]);
  return sheets;
}
window.useStewardRunsheets = useStewardRunsheets;
function useStewardCheckins() {
  const idv = useStewardIdv();
  const [list, setList] = useSt([]);
  useStE(() => window.Steward.subscribeCheckins(setList), [idv]);
  return list;
}
window.useStewardCheckins = useStewardCheckins;

function useStewardEvents() {
  const idv = useStewardIdv();
  const [events, setEvents] = useSt([]);
  useStE(() => window.Steward.subscribeEvents(setEvents), [idv]);
  return events;
}
window.useStewardEvents = useStewardEvents;

function useStewardRooms() {
  const idv = useStewardIdv();
  const [rooms, setRooms] = useSt([]);
  useStE(() => window.Steward.subscribeRooms(setRooms), [idv]);
  return rooms;
}
window.useStewardRooms = useStewardRooms;

function useStewardBookings() {
  const idv = useStewardIdv();
  const [bookings, setBookings] = useSt([]);
  useStE(() => window.Steward.subscribeBookings(setBookings), [idv]);
  return bookings;
}
window.useStewardBookings = useStewardBookings;

function useStewardUnavail() {
  const idv = useStewardIdv();
  const [unavail, setUnavail] = useSt({});
  useStE(() => window.Steward.subscribeUnavail(setUnavail), [idv]);
  return unavail;
}
window.useStewardUnavail = useStewardUnavail;

function useStewardRsvps() {
  const idv = useStewardIdv();
  const [rsvps, setRsvps] = useSt({});
  useStE(() => window.Steward.subscribeRsvps(setRsvps), [idv]);
  return rsvps;
}
window.useStewardRsvps = useStewardRsvps;

function useStewardRequestReplies() {
  const idv = useStewardIdv();
  const [replies, setReplies] = useSt([]);
  useStE(() => window.Steward.subscribeRequestReplies(setReplies), [idv]);
  return replies;
}
window.useStewardRequestReplies = useStewardRequestReplies;

function useStewardRequests() {
  const idv = useStewardIdv();
  const [requests, setRequests] = useSt([]);
  useStE(() => window.Steward.subscribeRequests(setRequests), [idv]);
  return requests;
}
window.useStewardRequests = useStewardRequests;

function useStewardNetworks() {
  const [networks, setNetworks] = useSt([]);
  useStE(() => window.Steward.subscribeNetworks(setNetworks), []);
  return networks;
}
window.useStewardNetworks = useStewardNetworks;

// churches whose owner-signed roster lists OUR key — we can switch to acting as their steward (phase 2b).
// Fires 'steward-networks' so the IdentitySwitcher re-renders with the new actable identities.
function useStewardStewardedChurches() {
  const [churches, setChurches] = useSt([]);
  useStE(() => (window.Steward.subscribeStewardedChurches
    ? window.Steward.subscribeStewardedChurches(list => { setChurches(list); try { window.dispatchEvent(new CustomEvent('steward-networks')); } catch {} })
    : undefined), []);
  return churches;
}
window.useStewardStewardedChurches = useStewardStewardedChurches;

// people participating in this church's chat (derived from messages addressed to the church)
function useStewardMembers() {
  const idv = useStewardIdv();
  // seed from the local roster cache so the Members list paints on first render (no empty→list flash)
  const [members, setMembers] = useSt(() => { try { return JSON.parse(localStorage.getItem('trinityone.steward.members.' + ((window.Steward && window.Steward.churchPub) || '')) || '[]') || []; } catch { return []; } });
  useStE(() => window.Steward.subscribeMembers(setMembers), [idv]);
  return members;
}
window.useStewardMembers = useStewardMembers;

function useStewardBlocked() {
  const idv = useStewardIdv();
  const [blocked, setBlocked] = useSt([]);
  useStE(() => window.Steward.subscribeBlocked(setBlocked), [idv]);
  return blocked;   // array of blocked hex pubkeys
}
window.useStewardBlocked = useStewardBlocked;

// the delegated steward roster (owner-signed) → array of hex pubkeys
function useStewardStewards() {
  const idv = useStewardIdv();
  const [stewards, setStewards] = useSt([]);
  useStE(() => (window.Steward.subscribeStewards ? window.Steward.subscribeStewards(setStewards) : undefined), [idv]);
  return stewards;
}
window.useStewardStewards = useStewardStewards;

// would-be stewards who scanned this church's invite and are waiting for the owner to approve them
function usePendingStewards() {
  const idv = useStewardIdv();
  const [reqs, setReqs] = useSt([]);
  useStE(() => (window.Steward.subscribeStewardRequests ? window.Steward.subscribeStewardRequests(setReqs) : undefined), [idv]);
  return reqs;   // [{ pubkey, npub, name }]
}
window.usePendingStewards = usePendingStewards;

// safeguarding: this church's minors + cleared-adults lists → { minors:[], approved:[] } (hex pubkeys)
function useStewardSafeguard() {
  const idv = useStewardIdv();
  const [lists, setLists] = useSt({ minors: [], approved: [] });
  useStE(() => window.Steward.subscribeSafeguard(setLists), [idv]);
  return lists;
}
window.useStewardSafeguard = useStewardSafeguard;

// safeguarding v2: pending parent guardian-link requests → [{ child, parent, parentName, childName, ts }]
function useStewardGuardianRequests() {
  const idv = useStewardIdv();
  const [reqs, setReqs] = useSt([]);
  useStE(() => window.Steward.subscribeGuardianRequests(setReqs), [idv]);
  return reqs;
}
window.useStewardGuardianRequests = useStewardGuardianRequests;

// safeguarding v2: confirmed parent↔child map → { childPub: [parentPub, …] }
function useStewardGuardians() {
  const idv = useStewardIdv();
  const [map, setMap] = useSt({});
  useStE(() => window.Steward.subscribeGuardians(setMap), [idv]);
  return map;
}
window.useStewardGuardians = useStewardGuardians;

// joining: does this church require steward approval, and who's been admitted
function useStewardJoinPolicy() {
  const idv = useStewardIdv();
  const [approval, setApproval] = useSt(false);
  useStE(() => window.Steward.subscribeJoinPolicy(setApproval), [idv]);
  return approval;
}
window.useStewardJoinPolicy = useStewardJoinPolicy;

function useStewardAdmitted() {
  const idv = useStewardIdv();
  const [list, setList] = useSt([]);
  useStE(() => window.Steward.subscribeAdmitted(setList), [idv]);
  return list;   // array of admitted hex pubkeys
}
window.useStewardAdmitted = useStewardAdmitted;

// ---- optional Finance module (encrypted to the church key; window.StewardFinance) ----
function useFinanceSettings() {
  const idv = useStewardIdv();
  // seed from the local cache so the "Finance" nav item paints on the FIRST render (no relay-round-trip lag)
  const [s, setS] = useSt(() => ({ enabled: (window.StewardFinance && window.StewardFinance.cachedEnabled) ? window.StewardFinance.cachedEnabled() : false }));
  useStE(() => (window.StewardFinance ? window.StewardFinance.subscribeSettings(setS) : undefined), [idv]);
  return s;
}
window.useFinanceSettings = useFinanceSettings;

function useFinanceDonors() {
  const idv = useStewardIdv();
  const [d, setD] = useSt([]);
  useStE(() => (window.StewardFinance ? window.StewardFinance.subscribeDonors(setD) : undefined), [idv]);
  return d;
}
window.useFinanceDonors = useFinanceDonors;

function useFinanceFunds() {
  const idv = useStewardIdv();
  const [f, setF] = useSt([]);
  useStE(() => (window.StewardFinance ? window.StewardFinance.subscribeFunds(setF) : undefined), [idv]);
  return f;
}
window.useFinanceFunds = useFinanceFunds;

function useFinanceTx() {
  const idv = useStewardIdv();
  const [t, setT] = useSt([]);
  useStE(() => (window.StewardFinance ? window.StewardFinance.subscribeTx(setT) : undefined), [idv]);
  return t;
}
window.useFinanceTx = useFinanceTx;

function useFinanceClaims() {
  const idv = useStewardIdv();
  const [c, setC] = useSt([]);
  useStE(() => (window.StewardFinance ? window.StewardFinance.subscribeClaims(setC) : undefined), [idv]);
  return c;
}
window.useFinanceClaims = useFinanceClaims;

// live relay status (re-probed every 10s) + the church's footprint count on the relay
function useStewardRelays() {
  const [status, setStatus] = useSt([]);
  useStE(() => {
    let alive = true;
    const probe = () => window.Steward.relayStatus().then(s => { if (alive) setStatus(s); }).catch(() => {});
    probe(); const t = setInterval(probe, 10000);
    window.addEventListener('steward-relays', probe);
    return () => { alive = false; clearInterval(t); window.removeEventListener('steward-relays', probe); };
  }, []);
  return status;
}
window.useStewardRelays = useStewardRelays;

function useStewardStats() {
  const idv = useStewardIdv();
  const [stats, setStats] = useSt({ events: 0, announcements: 0 });
  useStE(() => window.Steward.subscribeStats(setStats), [idv]);
  return stats;
}
window.useStewardStats = useStewardStats;

function useStewardActivity() {
  const idv = useStewardIdv();
  const [activity, setActivity] = useSt([]);
  useStE(() => window.Steward.subscribeActivity(setActivity), [idv]);
  return activity;
}
window.useStewardActivity = useStewardActivity;

// the active identity's own profile (name etc.) + npub — church, or a network when toggled
function useStewardChurch() {
  const idv = useStewardIdv();
  const [p, setP] = useSt({});
  useStE(() => { setP({}); return window.Steward.subscribeProfile(setP); }, [idv]);
  // any instance that receives the kind-0 broadcasts it, so every view (header, Settings, badges)
  // stays in sync even if this instance's own relay sub mounted before the church's relays were ready.
  useStE(() => { const f = (e) => { if (e.detail) setP(e.detail); }; window.addEventListener('steward-profile', f); return () => window.removeEventListener('steward-profile', f); }, [idv]);
  return { name: (p && p.name) || '', nip05: (p && p.nip05) || '', channel: (p && p.channel) || '', audioFeed: (p && p.audioFeed) || '', lud16: (p && p.lud16) || '', giving: !!(p && p.giving), picture: (p && p.picture) || '', banner: (p && p.banner) || '', accent: (p && p.accent) || '', features: (p && p.features) || {}, rules: (p && p.rules) || {}, npub: window.Steward.npub || '', isNetwork: window.Steward.isViewingNetwork ? window.Steward.isViewingNetwork() : false };
}
window.useStewardChurch = useStewardChurch;

// load the church key if this device already has one. A fresh install has NO key — it shows the
// welcome screen (Start a new church / Restore a church) instead of silently minting one, so the
// steward chooses. Seeding the starter groups happens in "Start a new church" (seedNewChurch).
function initChurch() {
  const params = new URLSearchParams(location.search);
  const inject = params.get('churchkey');                 // test hook: load a known church key
  if (inject) { window.Steward.init(inject); return; }
  const adopt = params.get('adopt');                      // QR/link handoff: adopt a church on launch
  if (adopt && !window.Steward.hasKey) { try { window.Steward.adoptChurch(adopt); try { localStorage.setItem('trinityone.steward.wizard.done', '1'); } catch {} } catch (e) {} }
  window.Steward.init();                                  // load the saved key if there is one (no auto-create)
  if (window.Steward.hasKey && window.Steward.selfRegister) window.Steward.selfRegister('').catch(() => {});
}

// "Start a new church": mint a fresh key, register it, and seed the sample chat groups once (real
// signed events members can read). Self-register proves key ownership to the pool relays (no token).
function seedNewChurch() {
  window.Steward.createKey();
  if (window.Steward.selfRegister) window.Steward.selfRegister('').catch(() => {});
  try {
    if (!localStorage.getItem('trinityone.steward.seeded')) {
      localStorage.setItem('trinityone.steward.seeded', '1');
      (window.SK.groups || []).forEach(g => window.Steward.publishGroup({ id: g.id, name: g.name, kind: g.kind, sub: g.sub }));
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
    if (pinVal.length < 4) { setErr('Use at least 4 characters.'); return; }
    setPinBusy(true);
    try { await window.Steward.setPin(pinVal); } catch (e) {}
    setPinBusy(false);
    window.Steward.enterConsole();
  };
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
            <button onClick={seedNewChurch} className="sk-btn sk-btn--clay" style={{ padding: '14px 16px', fontSize: 15, justifyContent: 'center' }}><Icon name="plus" size={17} color="#fff" /> Start a new church</button>
            <button onClick={() => { setErr(''); setMode('restore'); }} className="sk-btn sk-btn--ghost" style={{ padding: '14px 16px', fontSize: 15, justifyContent: 'center' }}><Icon name="refresh" size={17} color="currentColor" /> Restore a church</button>
            <button onClick={becomeSteward} className="sk-btn sk-btn--ghost" style={{ padding: '14px 16px', fontSize: 15, justifyContent: 'center' }}><Icon name="shield" size={17} color="currentColor" /> Help run a church</button>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', marginTop: 4, lineHeight: 1.5 }}>“Help run a church” makes your steward code — the church’s owner adds it to make you a steward (no key shared).</div>
          </div>
        ) : mode === 'steward' ? (
          <div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 12 }}>Tell the church’s owner your steward name and give them this code. They add it under <b>Delegated stewards</b>, and that church then appears here in your switcher. It shares only your public ID — never a key.</div>
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'color-mix(in oklab, var(--gold) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 26%, var(--line))', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Your steward name</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, color: 'var(--ink)' }}>{(window.Steward.stewardName && window.Steward.stewardName(npub)) || '—'}</div>
            </div>
            <SkKey value={npub || '—'} label="your steward code" />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button onClick={() => { copyText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); }} className="sk-btn sk-btn--clay" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name={copied ? 'check' : 'receipt'} size={14} color="#fff" /> {copied ? 'Copied' : 'Copy code'}</button>
              <button onClick={() => setShowQR(s => !s)} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="qr" size={14} color="currentColor" /> {showQR ? 'Hide QR' : 'Show QR'}</button>
            </div>
            {showQR && window.Steward.qrSVG ? <div style={{ width: 184, height: 184, margin: '12px auto 0', background: '#fff', borderRadius: 12, padding: 8, boxSizing: 'border-box' }} dangerouslySetInnerHTML={{ __html: window.Steward.qrSVG(code) }} /> : null}
            <button onClick={() => { setErr(''); setMode('steward-pin'); }} className="sk-btn sk-btn--clay" style={{ padding: '12px 16px', fontSize: 14.5, width: '100%', justifyContent: 'center', marginTop: 16 }}>Continue <Icon name="chevR" size={15} color="#fff" /></button>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>You can find this code again anytime under Settings → Security → Become a steward.</div>
          </div>
        ) : mode === 'steward-pin' ? (
          <div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>Set a PIN to protect this device. Your steward key can act for a church, so it’s <b>encrypted on this device</b> and the PIN unlocks it — a lost or shared phone can’t act as a church without it.</div>
            <input type="password" inputMode="numeric" value={pinVal} onChange={e => { setPinVal(e.target.value); setErr(''); }} autoFocus placeholder="Choose a PIN (or a longer passphrase)" onKeyDown={e => { if (e.key === 'Enter' && pinVal.length >= 4 && !pinBusy) finishWithPin(); }} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '12px 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', letterSpacing: '2px' }} />
            {err ? <div style={{ fontSize: 12.5, color: 'var(--clay)', fontWeight: 600, marginTop: 7 }}>{err}</div> : null}
            <button onClick={finishWithPin} disabled={pinVal.length < 4 || pinBusy} className="sk-btn sk-btn--clay" style={{ padding: '12px 16px', fontSize: 14.5, width: '100%', justifyContent: 'center', marginTop: 14, opacity: (pinVal.length >= 4 && !pinBusy) ? 1 : 0.5 }}><Icon name="lock" size={16} color="#fff" /> {pinBusy ? 'Setting…' : 'Set PIN & enter'}</button>
            <button onClick={() => window.Steward.enterConsole()} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 12.5, width: '100%', justifyContent: 'center', marginTop: 8 }}>Skip for now</button>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>You can set or change this later under Settings → Security → Console lock.</div>
          </div>
        ) : mode === 'scanning' ? (
          <div>
            <StewQRScanner onResult={adopt} onCancel={() => setMode('restore')} />
            <button onClick={() => setMode('restore')} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13, marginTop: 12, width: '100%', justifyContent: 'center' }}>Enter the phrase instead</button>
          </div>
        ) : (
          <div>
            <button onClick={() => { setErr(''); setMode('scanning'); }} className="sk-btn sk-btn--clay" style={{ padding: '13px 16px', fontSize: 14.5, width: '100%', justifyContent: 'center', marginBottom: 14 }}><Icon name="qr" size={16} color="#fff" /> Scan the handoff QR</button>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 7 }}>OR PASTE THE 12-WORD PHRASE</div>
            <textarea value={phrase} onChange={e => setPhrase(e.target.value)} rows={3} placeholder="word one  word two  word three …" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '11px 13px', fontSize: 13.5, fontFamily: 'var(--mono)', color: 'var(--ink)', outline: 'none', resize: 'vertical', lineHeight: 1.6 }} />
            {err ? <div style={{ fontSize: 12.5, color: 'var(--clay)', fontWeight: 600, marginTop: 6 }}>{err}</div> : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => adopt(phrase)} disabled={!phrase.trim()} className="sk-btn sk-btn--clay" style={{ padding: '10px 14px', fontSize: 14, opacity: phrase.trim() ? 1 : 0.5 }}><Icon name="refresh" size={15} color="#fff" /> Restore church</button>
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
  { key: 'relay',     label: 'Relay app',   ic: 'globe' },
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

// PIN unlock gate — shown when the church key is encrypted at rest and not yet unlocked this session
function StewardUnlock() {
  const [pin, setPin] = useSt('');
  const [busy, setBusy] = useSt(false);
  const [err, setErr] = useSt('');
  const submit = async () => {
    if (!pin || busy) return; setBusy(true); setErr('');
    const ok = await window.Steward.unlock(pin);   // fires steward-key on success → StewardRoot re-renders
    if (!ok) { setBusy(false); setErr('Wrong PIN — try again.'); setPin(''); }
  };
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'radial-gradient(120% 80% at 50% -10%, var(--gold-tint, #f6edda), var(--paper))' }}>
      <div style={{ width: 'min(380px, 92vw)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 22, boxShadow: 'var(--shadow-lg)', padding: 28, textAlign: 'center' }}>
        <Halo size={40} color="var(--ink)" spark="var(--clay)" />
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21, margin: '12px 0 4px' }}>Console locked</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 18 }}>Enter the PIN to unlock this church on this device.</div>
        <input type="password" value={pin} autoFocus onChange={e => { setPin(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="PIN" inputMode="numeric" autoComplete="off"
          style={{ width: '100%', boxSizing: 'border-box', height: 50, textAlign: 'center', letterSpacing: 6, fontSize: 20, border: `1px solid ${err ? 'var(--clay)' : 'var(--line)'}`, borderRadius: 13, background: 'var(--surface-2)', color: 'var(--ink)', outline: 'none', fontFamily: 'var(--font-ui)' }} />
        {err ? <div style={{ fontSize: 12.5, color: 'var(--clay)', fontWeight: 600, marginTop: 8 }}>{err}</div> : null}
        <button onClick={submit} disabled={!pin || busy} className="sk-btn sk-btn--clay" style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15, marginTop: 14, opacity: (!pin || busy) ? .5 : 1 }}>{busy ? 'Unlocking…' : 'Unlock'}</button>
      </div>
    </div>
  );
}

function StewardRoot() {
  const params = new URLSearchParams(location.search);
  const showcase = params.get('showcase') === '1';   // ?showcase=1 = the design gallery (reference)
  const [surface, setSurface] = useSt(SURFACES.some(s => s.key === params.get('surface')) ? params.get('surface') : 'console');
  const [consoleView, setConsoleView] = useSt(params.get('setup') === '1' ? 'wizard' : 'dashboard');
  // a fresh install has no church key → welcome; an encrypted key → unlock gate; otherwise → console.
  const [ks, setKs] = useSt(() => ({ has: !!window.Steward.hasKey, locked: !!window.Steward.locked }));
  useStE(() => { const f = () => setKs({ has: !!window.Steward.hasKey, locked: !!window.Steward.locked }); window.addEventListener('steward-key', f); return () => window.removeEventListener('steward-key', f); }, []);
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
