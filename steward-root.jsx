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
  return { name: (p && p.name) || '', nip05: (p && p.nip05) || '', channel: (p && p.channel) || '', audioFeed: (p && p.audioFeed) || '', npub: window.Steward.npub || '', isNetwork: window.Steward.isViewingNetwork ? window.Steward.isViewingNetwork() : false };
}
window.useStewardChurch = useStewardChurch;

// ensure a church key exists; on first run, seed the church's starter groups from the sample set
// (published for real, so the console is populated AND every group is a signed event members read).
function initChurch() {
  const params = new URLSearchParams(location.search);
  const inject = params.get('churchkey');                 // test hook: load a known church key
  if (inject) window.Steward.init(inject);
  window.Steward.ensureKey();
  // self-register this church with the shared pool relays (proves key ownership — no admin token), so a
  // new church is write-policy-enabled + moderation-capable with zero manual relay setup. Fire-and-forget.
  if (window.Steward.selfRegister) window.Steward.selfRegister('').catch(() => {});
  // first run: publish the sample chat groups (the focus) as REAL signed events. Funds are NOT
  // seeded — giving is parked for the pilot, so the console stays chat-only.
  if (inject) return;
  try {
    if (localStorage.getItem('trinityone.steward.seeded')) return;
    localStorage.setItem('trinityone.steward.seeded', '1');
    (window.SK.groups || []).forEach(g => window.Steward.publishGroup({ id: g.id, name: g.name, kind: g.kind, sub: g.sub }));
  } catch (e) {}
}

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

  // ── Real product: steward.html IS the console, full-window ──
  if (!showcase) {
    return (
      <div className="stew-root" style={{ height: '100%' }}>
        {consoleView === 'wizard' ? <StewWizard onDone={() => setConsoleView('dashboard')} /> : <StewDashboard initial={params.get('tab') || 'overview'} />}
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
