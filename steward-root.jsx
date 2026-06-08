// steward-root.jsx — real entry for the TrinityOne steward surfaces.
// Renders the handoff's stew-* components as navigable pages (NOT on the design canvas).
const { useState: useSt } = React;

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
  const initSurface = SURFACES.some(s => s.key === params.get('surface')) ? params.get('surface') : 'console';
  const [surface, setSurface] = useSt(initSurface);
  const [consoleView, setConsoleView] = useSt(params.get('setup') === '1' ? 'wizard' : 'dashboard');

  let body = null;
  if (surface === 'console') body = <Frame w={1180} h={800}>{consoleView === 'wizard' ? <StewWizard /> : <StewDashboard initial={params.get('tab') || 'overview'} />}</Frame>;
  else if (surface === 'relay') body = <Frame w={1180} h={760}><RelayNodeApp initial={params.get('relay') === 'setup' ? 'setup' : 'running'} /></Frame>;
  else if (surface === 'extension') body = params.get('ext') === 'home' ? <StewExtensionHome /> : <StewExtensionRequest />;
  else if (surface === 'phone') body = <StewPhone initial={params.get('phone') || 'home'} />;
  else if (surface === 'custody') body = <Frame w={1180} h={624}><CustodyExplainer /></Frame>;

  const seg = { display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' };

  return (
    <div className="stew-root" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* top surface switcher */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Halo size={24} color="var(--ink)" spark="var(--clay)" />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>Trinity<span style={{ color: 'var(--clay)' }}>One</span></span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.5px', color: 'var(--ink-3)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 6px' }}>STEWARD</span>
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
      {/* stage */}
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28, background: '#efece6' }}>
        {body}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<StewardRoot />);
