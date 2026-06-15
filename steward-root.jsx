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

function useStewardEvents() {
  const idv = useStewardIdv();
  const [events, setEvents] = useSt([]);
  useStE(() => window.Steward.subscribeEvents(setEvents), [idv]);
  return events;
}
window.useStewardEvents = useStewardEvents;

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

// people participating in this church's chat (derived from messages addressed to the church)
function useStewardMembers() {
  const idv = useStewardIdv();
  const [members, setMembers] = useSt([]);
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
  return { name: (p && p.name) || '', nip05: (p && p.nip05) || '', channel: (p && p.channel) || '', audioFeed: (p && p.audioFeed) || '', lud16: (p && p.lud16) || '', giving: !!(p && p.giving), picture: (p && p.picture) || '', npub: window.Steward.npub || '', isNetwork: window.Steward.isViewingNetwork ? window.Steward.isViewingNetwork() : false };
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
  if (adopt && !window.Steward.hasKey) { try { window.Steward.adoptChurch(adopt); } catch (e) {} }
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
  const [mode, setMode] = useSt('choose');   // choose | restore | scanning
  const [phrase, setPhrase] = useSt('');
  const [err, setErr] = useSt('');
  const adopt = (payload) => {
    setErr('');
    try { window.Steward.adoptChurch(payload); if (window.Steward.selfRegister) window.Steward.selfRegister('').catch(() => {}); }
    catch (e) { setMode('restore'); setErr((e && e.message) || 'That code or phrase isn’t valid.'); }
  };
  const card = { width: 'min(440px, 92vw)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 22, boxShadow: 'var(--shadow-lg)', padding: 28 };
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'radial-gradient(120% 80% at 50% -10%, var(--gold-tint, #f6edda), var(--paper))' }}>
      <div style={card}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 18, textAlign: 'center' }}>
          <Halo size={40} color="var(--ink)" spark="var(--clay)" />
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, letterSpacing: '-.3px' }}>Steward console</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{mode === 'choose' ? 'Set up a new church, or take over an existing one.' : 'Restore a church from another steward.'}</div>
        </div>

        {mode === 'choose' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <button onClick={seedNewChurch} className="sk-btn sk-btn--clay" style={{ padding: '14px 16px', fontSize: 15, justifyContent: 'center' }}><Icon name="plus" size={17} color="#fff" /> Start a new church</button>
            <button onClick={() => { setErr(''); setMode('restore'); }} className="sk-btn sk-btn--ghost" style={{ padding: '14px 16px', fontSize: 15, justifyContent: 'center' }}><Icon name="refresh" size={17} color="currentColor" /> Restore a church</button>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', marginTop: 4, lineHeight: 1.5 }}>Restoring? You’ll scan the handoff QR from another steward (or paste the recovery phrase).</div>
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

function StewardRoot() {
  const params = new URLSearchParams(location.search);
  const showcase = params.get('showcase') === '1';   // ?showcase=1 = the design gallery (reference)
  const [surface, setSurface] = useSt(SURFACES.some(s => s.key === params.get('surface')) ? params.get('surface') : 'console');
  const [consoleView, setConsoleView] = useSt(params.get('setup') === '1' ? 'wizard' : 'dashboard');
  // a fresh install has no church key → show the welcome (Start new / Restore); re-render when it changes
  const [hasKey, setHasKey] = useSt(!!window.Steward.hasKey);
  useStE(() => { const f = () => setHasKey(!!window.Steward.hasKey); window.addEventListener('steward-key', f); return () => window.removeEventListener('steward-key', f); }, []);

  // ── Real product: steward.html IS the console, full-window ──
  if (!showcase) {
    return (
      <div className="stew-root" style={{ height: '100%' }}>
        {!hasKey ? <StewardWelcome />
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
