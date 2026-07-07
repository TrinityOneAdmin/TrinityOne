// stew-relay.jsx — TrinityOne Relay: a cross-platform desktop app (Mac/Win/Linux)
// for setting up and running a church's own relay node.
// Exports: RelayNodeApp (initial="setup" | "running")

const RLY = {
  address: 'relay.grace.org',
  managedAddress: 'grace.relay.trinityone.app',
  church: { name: 'Grace Chapel', initials: 'GC', accent: 'var(--clay)' },
  version: 'v1.4.2',
  uptime: '14d 6h',
  stats: [
    { label: 'Events stored', value: '48,920', sub: 'since Apr 2', ic: 'database', tint: 'clay' },
    { label: 'Connected now', value: '37', sub: 'members + console', ic: 'pulse', tint: 'sage' },
    { label: 'On disk', value: '184 MB', sub: '212 GB free', ic: 'server', tint: 'ink' },
    { label: 'Served this week', value: '2.3 GB', sub: '↑ steady', ic: 'bolt', tint: 'gold' },
  ],
  log: [
    { t: '09:41:07', dir: 'in', kind: 'EVENT 30078', who: 'Grace Chapel', note: 'Building Fund published' },
    { t: '09:41:06', dir: 'out', kind: 'REQ', who: 'member · Quiet Cedar', note: 'subscribe church feed' },
    { t: '09:40:58', dir: 'in', kind: 'EVENT 1', who: 'Prayer Wall', note: 'new request' },
    { t: '09:40:51', dir: 'in', kind: 'EVENT 9735', who: 'zap receipt', note: '5,000 sats → Missions' },
    { t: '09:40:43', dir: 'out', kind: 'REQ', who: 'member · Bright Sparrow', note: 'subscribe groups' },
    { t: '09:40:39', dir: 'in', kind: 'EVENT 30078', who: 'Grace Chapel', note: 'Announcement' },
    { t: '09:40:32', dir: 'out', kind: 'EOSE', who: 'member · Gentle Harbor', note: 'feed delivered' },
  ],
};

// ─────────────────────────── desktop window chrome ───────────────────────────
function WinControls({ os }) {
  if (os === 'mac') {
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ width: 12, height: 12, borderRadius: 999, background: '#E06C5B' }} />
        <span style={{ width: 12, height: 12, borderRadius: 999, background: '#E0B860' }} />
        <span style={{ width: 12, height: 12, borderRadius: 999, background: '#5E8C6A' }} />
      </div>
    );
  }
  // win / linux — controls on the right
  const btn = { width: 30, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: os === 'linux' ? 999 : 6, color: 'var(--ink-3)' };
  return (
    <div style={{ display: 'flex', gap: os === 'linux' ? 8 : 2, alignItems: 'center' }}>
      <div style={{ ...btn, background: os === 'linux' ? 'var(--surface-2)' : 'transparent' }}><svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg></div>
      <div style={{ ...btn, background: os === 'linux' ? 'var(--surface-2)' : 'transparent' }}><svg width="11" height="11" viewBox="0 0 12 12"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg></div>
      <div style={{ ...btn, background: os === 'linux' ? '#E06C5B' : 'transparent', color: os === 'linux' ? '#fff' : 'var(--ink-3)' }}><svg width="11" height="11" viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg></div>
    </div>
  );
}

function DesktopChrome({ os, title = 'TrinityOne Relay', children, bg = 'var(--paper)' }) {
  const macLayout = os === 'mac';
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: bg, fontFamily: 'var(--font-ui)', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)' }}>
      <div style={{ height: 42, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }}>
        {macLayout ? <WinControls os={os} /> : null}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: macLayout ? 'center' : 'flex-start', gap: 8, color: 'var(--ink-2)' }}>
          <Halo size={16} color="var(--ink)" spark="var(--clay)" />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.2px' }}>{title}</span>
        </div>
        {!macLayout ? <WinControls os={os} /> : <div style={{ width: 52 }} />}
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>{children}</div>
    </div>
  );
}

// the "runs on" platform switch — demonstrates cross-platform + drives the chrome
function OSSwitch({ os, setOs, dark = false }) {
  const opts = [['mac', 'macOS'], ['win', 'Windows'], ['linux', 'Linux']];
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: dark ? 'rgba(255,255,255,.5)' : 'var(--ink-3)' }}>Runs on</span>
      <div style={{ display: 'inline-flex', padding: 3, borderRadius: 10, gap: 3, background: dark ? 'rgba(255,255,255,.08)' : 'var(--surface-2)', border: dark ? '1px solid rgba(255,255,255,.12)' : '1px solid var(--line)' }}>
        {opts.map(([v, l]) => {
          const on = v === os;
          return (
            <button key={v} onClick={() => setOs(v)} style={{
              border: 'none', cursor: 'pointer', padding: '5px 11px', borderRadius: 7, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12,
              background: on ? (dark ? 'rgba(255,255,255,.16)' : 'var(--surface)') : 'transparent',
              color: on ? (dark ? '#fff' : 'var(--ink)') : (dark ? 'rgba(255,255,255,.55)' : 'var(--ink-3)'),
              boxShadow: on && !dark ? 'var(--shadow-sm)' : 'none',
            }}>{l}</button>
          );
        })}
      </div>
    </div>
  );
}

// small reusable card
function RCard({ children, style = {}, pad = 20 }) {
  return <div style={{ borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', padding: pad, ...style }}>{children}</div>;
}
function RTitle({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>{children}</div>
      <div style={{ flex: 1 }} />{action}
    </div>
  );
}

// ═══════════════════════════════ RUNNING DASHBOARD ═══════════════════════════════
const R_NAV = [
  { key: 'status', label: 'Status', ic: 'pulse' },
  { key: 'network', label: 'Network', ic: 'globe' },
  { key: 'storage', label: 'Storage', ic: 'database' },
  { key: 'logs', label: 'Live log', ic: 'sliders' },
  { key: 'settings', label: 'Settings', ic: 'sliders' },
];

function RelayDashboard({ os, setOs }) {
  const [running, setRunning] = React.useState(true);
  return (
    <DesktopChrome os={os}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'var(--paper)' }}>
        {/* sidebar */}
        <div style={{ width: 210, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', padding: '18px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 0', marginBottom: 18 }}>
            <SkBadge initials="GC" size={32} radius={10} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>Grace Chapel</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>your relay</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {R_NAV.map((n, i) => {
              const on = i === 0;
              return (
                <div key={n.key} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', borderRadius: 10, cursor: 'pointer',
                  background: on ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'transparent', color: on ? 'var(--clay-ink)' : 'var(--ink-2)', fontWeight: on ? 700 : 600, fontSize: 13.5 }}>
                  <Icon name={n.ic} size={17} color={on ? 'var(--clay)' : 'var(--ink-3)'} /> {n.label}
                </div>
              );
            })}
          </div>
          <div style={{ flex: 1 }} />
          {/* signing reassurance */}
          <div style={{ display: 'flex', gap: 9, padding: '11px 11px', borderRadius: 11, background: 'color-mix(in oklab, var(--sage) 10%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 24%, transparent)', marginBottom: 12 }}>
            <Icon name="lock" size={15} color="var(--sage)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>No keys here. Signing stays in <b style={{ color: 'var(--ink)' }}>Keykeeper</b> — this app only stores &amp; serves.</div>
          </div>
          <OSSwitch os={os} setOs={setOs} />
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 10, padding: '0 4px' }}>TrinityOne Relay {RLY.version} · up to date</div>
        </div>

        {/* main */}
        <div className="no-scrollbar" style={{ flex: 1, minWidth: 0, overflow: 'hidden', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* status hero */}
          <div style={{ borderRadius: 18, padding: 22, background: 'linear-gradient(155deg, var(--midnight-2), var(--midnight))', color: 'var(--paper)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: running ? 'var(--sage-soft)' : '#E0A85B' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: running ? '#7DC893' : '#E0A85B', boxShadow: running ? '0 0 0 4px rgba(125,200,147,.25)' : 'none' }} />
                  {running ? 'Live · reachable from anywhere' : 'Stopped'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0 0' }}>
                  <Icon name="globe" size={20} color="var(--paper)" />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 21, fontWeight: 600, letterSpacing: '-.2px' }}>wss://{RLY.address}</span>
                </div>
                <div style={{ display: 'flex', gap: 18, marginTop: 14, fontSize: 12.5, color: 'rgba(255,255,255,.65)' }}>
                  <span><b style={{ color: 'var(--paper)', fontWeight: 700 }}>{RLY.uptime}</b> uptime</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="lock" size={13} color="#7DC893" /> TLS valid</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="shield" size={13} color="#7DC893" /> Secure tunnel — no router setup</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 9, flexShrink: 0 }}>
                <button onClick={() => setRunning(r => !r)} title={running ? 'Stop the relay — members and giving will stop loading until you start it again' : 'Start the relay so your church’s messages and giving load again'} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 15px', borderRadius: 11, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(255,255,255,.08)', color: 'var(--paper)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
                  <Icon name="power" size={16} color={running ? '#E0A85B' : '#7DC893'} /> {running ? 'Stop' : 'Start'}
                </button>
                <button title="Restart the relay — briefly stops and starts it again (handy after a settings change)" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 15px', borderRadius: 11, border: 'none', background: 'rgba(255,255,255,.12)', color: 'var(--paper)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
                  <Icon name="refresh" size={15} color="var(--paper)" /> Restart
                </button>
              </div>
            </div>
          </div>

          {/* stats */}
          <div style={{ display: 'flex', gap: 13, flexShrink: 0 }}>
            {RLY.stats.map(s => {
              const t = SK_TINT[s.tint];
              return (
                <div key={s.label} style={{ flex: 1, padding: 15, borderRadius: 15, background: 'var(--surface)', border: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 27, height: 27, borderRadius: 8, background: t.bg, color: t.fg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={s.ic} size={15} color="currentColor" fill={s.ic === 'bolt'} /></div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' }}>{s.label}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, letterSpacing: '-.5px', marginTop: 9 }}>{s.value}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 1 }}>{s.sub}</div>
                </div>
              );
            })}
          </div>

          {/* log + network */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, flex: 1, minHeight: 0 }}>
            <RCard pad={0} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '15px 18px 12px', borderBottom: '1px solid var(--line-2)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: '#7DC893' }} />
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>Live event log</div>
                <div style={{ flex: 1 }} />
                <SkPill tint="sage">streaming</SkPill>
              </div>
              <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {RLY.log.map((l, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 12 }}>
                    <span style={{ color: 'var(--ink-3)', flexShrink: 0 }}>{l.t}</span>
                    <span style={{ flexShrink: 0, width: 16, color: l.dir === 'in' ? 'var(--sage)' : 'var(--clay)' }}>{l.dir === 'in' ? '▼' : '▲'}</span>
                    <span style={{ flexShrink: 0, fontWeight: 700, color: 'var(--ink-2)', minWidth: 92 }}>{l.kind}</span>
                    <span style={{ color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.who} · {l.note}</span>
                  </div>
                ))}
              </div>
            </RCard>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
              <RCard style={{ flex: 1 }}>
                <RTitle>Network</RTitle>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {[
                    { ic: 'shield', t: 'Secure tunnel', s: 'TrinityOne · no port-forwarding', ok: 'On' },
                    { ic: 'lock', t: 'TLS certificate', s: "Let's Encrypt · renews in 67d", ok: 'Valid' },
                    { ic: 'globe', t: 'Public address', s: 'Port 443 · IPv4 + IPv6', ok: 'Open' },
                  ].map(r => (
                    <div key={r.t} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--surface-2)', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={r.ic} size={16} color="currentColor" /></div>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.t}</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.s}</div></div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--sage)', flexShrink: 0 }}><Icon name="check" size={14} stroke={2.6} color="var(--sage)" /> {r.ok}</span>
                    </div>
                  ))}
                </div>
              </RCard>
              <RCard>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface-2)', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="bank" size={18} color="currentColor" /></div>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13.5 }}>Nightly backup</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Encrypted · last night 3:00am</div></div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--sage)' }}><Icon name="cloudCheck" size={15} color="var(--sage)" /> Done</span>
                </div>
              </RCard>
            </div>
          </div>
        </div>
      </div>
    </DesktopChrome>
  );
}

// ═══════════════════════════════ SETUP (FIRST RUN) ═══════════════════════════════
function RelaySetup({ os, setOs }) {
  const [mode, setMode] = React.useState('managed'); // managed | own
  const checks = [
    { ic: 'shield', t: 'Reachable from the internet', s: 'Secure tunnel — no router or port setup' },
    { ic: 'lock', t: 'HTTPS certificate', s: "Issued automatically by Let's Encrypt" },
    { ic: 'database', t: '212 GB free on disk', s: 'Plenty for years of church events' },
    { ic: 'check', t: 'Paired with Grace Chapel', s: 'Pulled from your Steward console' },
  ];
  return (
    <DesktopChrome os={os}>
      <div className="no-scrollbar" style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: 'var(--paper)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 40px 48px' }}>
          {/* header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <SkPill tint="clay">First-time setup</SkPill>
            <OSSwitch os={os} setOs={setOs} />
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 32, letterSpacing: '-.8px', margin: '16px 0 0' }}>Run your church’s relay</h1>
          <p style={{ fontSize: 15.5, color: 'var(--ink-2)', lineHeight: 1.6, margin: '8px 0 0', maxWidth: 560 }}>
            This app turns this computer into your relay — it stores and serves your church’s signed events so giving and messages always load. Your keys never touch it; signing stays in <b style={{ color: 'var(--ink)' }}>Keykeeper</b>.
          </p>

          {/* address mode */}
          <div style={{ marginTop: 28, fontSize: 11.5, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 11 }}>Relay address</div>
          <SkToggle value={mode} onChange={setMode} options={[{ value: 'managed', label: 'TrinityOne address', icon: 'cloud' }, { value: 'own', label: 'Your own domain', icon: 'globe' }]} />
          <div style={{ marginTop: 14 }}>
            {mode === 'managed' ? (
              <SkField label="Your relay will live at" value={'wss://' + RLY.managedAddress} mono accessory={<SkPill tint="sage">Auto TLS + tunnel</SkPill>} />
            ) : (
              <SkField label="Point this domain at the app" value={'wss://' + RLY.address} mono hint="Add the CNAME we show you — we issue and renew the TLS certificate for you." accessory={<SkPill tint="clay">We verify DNS</SkPill>} />
            )}
          </div>

          {/* pairing */}
          <div style={{ marginTop: 26, fontSize: 11.5, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 11 }}>Pair with your church</div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
            <div style={{ flex: 1 }}><SkField label="Pair code · from Steward console → Relays → Add relay" value="RELAY-PAIR-9F2C" mono /></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '0 16px', borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 26%, transparent)' }}>
              <SkBadge initials="GC" size={34} radius={10} />
              <div><div style={{ fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 5 }}>Grace Chapel <Icon name="check" size={13} stroke={3} color="var(--sage)" /></div><div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>detected · grace.org</div></div>
            </div>
          </div>

          {/* prerequisites — the app satisfies them */}
          <div style={{ marginTop: 26, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 15 }}>
              <Icon name="check" size={17} stroke={2.6} color="var(--sage)" />
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>Ready to go — we handled the hard parts</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {checks.map(c => (
                <div key={c.t} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                  <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--sage-soft)', color: '#345c41', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={c.ic} size={16} color="currentColor" /></div>
                  <div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.t}</div><div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.4 }}>{c.s}</div></div>
                </div>
              ))}
            </div>
          </div>

          {/* footer actions */}
          <div style={{ marginTop: 26, display: 'flex', alignItems: 'center', gap: 14 }}>
            <button className="sk-btn sk-btn--clay" style={{ padding: '13px 22px', fontSize: 15 }}><Icon name="power" size={17} color="#fff" /> Start relay</button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: 'var(--ink-2)', cursor: 'pointer' }}>
              <span style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={13} stroke={3} color="#fff" /></span>
              Launch at login &amp; keep running in the background
            </label>
          </div>
        </div>
      </div>
    </DesktopChrome>
  );
}

// ─────────────────────────── wrapper ───────────────────────────
function RelayNodeApp({ initial = 'running' }) {
  const [os, setOs] = React.useState('mac');
  return initial === 'setup' ? <RelaySetup os={os} setOs={setOs} /> : <RelayDashboard os={os} setOs={setOs} />;
}

window.RelayNodeApp = RelayNodeApp;
