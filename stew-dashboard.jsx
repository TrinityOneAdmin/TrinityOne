// stew-dashboard.jsx — desktop Steward Console running state. Exports StewDashboard.

const NAV = [
  { key: 'overview', label: 'Overview', ic: 'today' },
  { key: 'groups', label: 'Groups', ic: 'chat' },
  { key: 'rota', label: 'Rota', ic: 'calCheck' },
  { key: 'calendar', label: 'Calendar', ic: 'calendar' },
  { key: 'resources', label: 'Resources', ic: 'read' },
  { key: 'members', label: 'Members', ic: 'pray' },
  { key: 'settings', label: 'Settings', ic: 'sliders' },
  // { key: 'giving', label: 'Giving', ic: 'gift' },   // parked for the pilot (chat first)
];

// sidebar identity control: switch the WHOLE console between the church and any network it owns.
// With no owned networks it's just the church name button (tap to rename).
function IdentitySwitcher({ church, churchName, initials, onEditName }) {
  const idv = window.useStewardIdv ? window.useStewardIdv() : 0;
  const [open, setOpen] = React.useState(false);
  const [, force] = React.useState(0);
  // owning a network (create/import) fires 'steward-networks' — re-render so the church/network switch appears live
  React.useEffect(() => { const f = () => force(x => x + 1); window.addEventListener('steward-networks', f); return () => window.removeEventListener('steward-networks', f); }, []);
  const ids = (window.Steward.identities ? window.Steward.identities() : []);
  const activePub = window.Steward.activePub;
  const networks = ids.filter(i => i.kind === 'network');
  const viewingNetwork = window.Steward.isViewingNetwork && window.Steward.isViewingNetwork();
  const pick = (pub) => { window.Steward.setActiveIdentity(pub); setOpen(false); };
  // no networks owned → original behaviour (tap to set/rename the church)
  if (!networks.length) {
    return (
      <button onClick={onEditName} title="Set church name" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--surface-2)', cursor: 'pointer', marginBottom: 18, textAlign: 'left' }}>
        <SkBadge initials={initials} size={34} radius={10} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: church.name ? 'var(--ink)' : 'var(--ink-3)' }}>{churchName}</span>{church.name ? <Icon name="check" size={12} stroke={3} color="var(--sage)" /> : null}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: church.nip05 ? 'var(--font-ui)' : 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{church.nip05 ? '@' + String(church.nip05).split('@')[0] : (church.npub ? church.npub.slice(0, 18) + '…' : 'no key')}</div>
        </div>
        <Icon name="pen" size={14} color="var(--ink-3)" />
      </button>
    );
  }
  return (
    <div style={{ position: 'relative', marginBottom: 18 }}>
      <button onClick={() => setOpen(o => !o)} title="Switch between your church and network" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 13, width: '100%', border: '1px solid ' + (viewingNetwork ? 'color-mix(in oklab, var(--clay) 45%, var(--line))' : 'var(--line)'), background: viewingNetwork ? 'color-mix(in oklab, var(--clay) 9%, var(--surface))' : 'var(--surface-2)', cursor: 'pointer', textAlign: 'left' }}>
        <SkBadge initials={initials} size={34} radius={10} accent={viewingNetwork ? 'var(--clay)' : undefined} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{churchName}</span>
            <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '.5px', color: viewingNetwork ? 'var(--clay-ink)' : 'var(--ink-3)', background: viewingNetwork ? 'var(--clay-soft)' : 'var(--surface)', border: viewingNetwork ? 'none' : '1px solid var(--line)', borderRadius: 999, padding: '1px 5px', flexShrink: 0 }}>{viewingNetwork ? 'NETWORK' : 'CHURCH'}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Tap to switch view</div>
        </div>
        <Icon name={open ? 'chevU' : 'chevD'} size={14} color="var(--ink-3)" />
      </button>
      {open ? (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6, zIndex: 60, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 13, boxShadow: 'var(--shadow-lg)', padding: 6, animation: 'lumenScale .16s ease both' }}>
          {ids.map(idn => {
            const on = idn.pub === activePub;
            const label = idn.kind === 'church' ? (church.name || 'Your church') : (idn.name || 'Network');
            return (
              <button key={idn.pub} onClick={() => pick(idn.pub)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', textAlign: 'left', background: on ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'transparent', fontFamily: 'var(--font-ui)' }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, var(--clay) 13%, var(--surface))', color: 'var(--clay)' }}><Icon name={idn.kind === 'network' ? 'globe' : 'bank'} size={15} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{idn.kind === 'network' ? 'Network console' : 'Your church'}</div>
                </div>
                {on ? <Icon name="check" size={15} stroke={2.6} color="var(--clay)" /> : null}
              </button>
            );
          })}
          <div style={{ height: 1, background: 'var(--line)', margin: '5px 4px' }} />
          <button onClick={() => { setOpen(false); onEditName(); }} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', textAlign: 'left', background: 'transparent', color: 'var(--ink-2)', fontWeight: 700, fontSize: 12.5, fontFamily: 'var(--font-ui)' }}><Icon name="pen" size={13} color="var(--ink-3)" /> Rename {viewingNetwork ? 'network' : 'church'}</button>
        </div>
      ) : null}
    </div>
  );
}

// surfaces a relay rejection (e.g. this console's church key isn't the one the relay enforces)
function PublishErrorBanner() {
  const [msg, setMsg] = React.useState('');
  React.useEffect(() => {
    const f = (e) => {
      const reason = (e.detail && e.detail.reason) || '';
      setMsg(/not a member|not permitted|blocked/i.test(reason)
        ? 'Changes weren’t saved: this relay is set up for a different church. Restore this church’s key in Settings, or point the relay at this church.'
        : 'Couldn’t save to the relay — check the connection and try again.');
      clearTimeout(f._t); f._t = setTimeout(() => setMsg(''), 9000);
    };
    window.addEventListener('steward-publish-error', f);
    return () => window.removeEventListener('steward-publish-error', f);
  }, []);
  if (!msg) return null;
  return (
    <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 140, maxWidth: 560, width: 'calc(100% - 32px)', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 13, background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 40%, transparent)', boxShadow: 'var(--shadow-lg)' }}>
      <Icon name="bolt" size={17} color="var(--clay)" style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.45, fontWeight: 600 }}>{msg}</div>
      <button onClick={() => setMsg('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}><Icon name="x" size={15} /></button>
    </div>
  );
}

// toasts the steward when a brand-new member joins. A 4s settle window lets the existing roster stream
// in first (so the backfill doesn't alert), and we key off new pubkeys — not the `joined` timestamp —
// so a returning member's heartbeat never looks like a fresh join.
function JoinNotifier() {
  const [toast, setToast] = React.useState('');
  const tmr = React.useRef(null);
  React.useEffect(() => {
    if (!(window.Steward && window.Steward.subscribeMembers)) return;
    let known = new Set(), ready = false;
    const settle = setTimeout(() => { ready = true; }, 4000);
    const off = window.Steward.subscribeMembers((members) => {
      if (!ready) { known = new Set(members.map(m => m.pubkey)); return; }
      const fresh = members.filter(m => !known.has(m.pubkey));
      if (!fresh.length) return;
      fresh.forEach(m => known.add(m.pubkey));
      const last = fresh[fresh.length - 1];
      setToast(fresh.length > 1 ? `${fresh.length} people just joined your church 🎉` : `${last.name || 'Someone'} just joined your church 🎉`);
      clearTimeout(tmr.current); tmr.current = setTimeout(() => setToast(''), 9000);
    });
    return () => { clearTimeout(settle); clearTimeout(tmr.current); try { off && off(); } catch (e) {} };
  }, []);
  if (!toast) return null;
  return (
    <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 141, maxWidth: 520, width: 'calc(100% - 32px)', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 15px', borderRadius: 13, background: 'color-mix(in oklab, var(--sage) 14%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 42%, transparent)', boxShadow: 'var(--shadow-lg)', animation: 'lumenScale .2s ease both' }}>
      <Icon name="users" size={17} color="var(--sage)" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 13, color: 'var(--ink)', lineHeight: 1.4, fontWeight: 700 }}>{toast}</div>
      <button onClick={() => setToast('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}><Icon name="x" size={15} /></button>
    </div>
  );
}

// wizard step chrome — module-level so its component type is stable across renders
// (defining it inside StewSetupWizard would remount on every keystroke and blur the inputs).
function WizShell({ step, title, sub, children, footer }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'color-mix(in oklab, var(--ink) 42%, transparent)', backdropFilter: 'blur(4px)', animation: 'lumenFade .18s ease both' }}>
      <div className="no-scrollbar" style={{ width: 520, maxWidth: '100%', maxHeight: '92%', overflowY: 'auto', borderRadius: 24, background: 'var(--paper)', border: '1px solid var(--line)', boxShadow: '0 30px 80px rgba(0,0,0,.32)', animation: 'lumenScale .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div style={{ padding: '26px 28px 0' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>{[0, 1, 2, 3, 4].map(i => <span key={i} style={{ height: 5, flex: 1, borderRadius: 999, background: i <= step ? 'var(--clay)' : 'var(--line)' }} />)}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, letterSpacing: '-.4px' }}>{title}</div>
          {sub ? <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 0' }}>{sub}</div> : null}
          <div style={{ marginTop: 18 }}>{children}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 28px 24px' }}>{footer}</div>
      </div>
    </div>
  );
}

// First-run setup wizard — catches a brand-new church on first console load and walks
// name → starter groups → first serving team (or defer). Each step publishes immediately;
// a localStorage flag (set on finish/skip) keeps it from reappearing.
function StewSetupWizard({ church, onDone, onTab }) {
  const [step, setStep] = React.useState(0);
  const [name, setName] = React.useState(church.name || '');
  const [busy, setBusy] = React.useState(false);
  const [teamName, setTeamName] = React.useState('');
  const STARTERS = [
    { id: 'whole', name: 'Whole Church', kind: 'broadcast', sub: 'Announcements for everyone' },
    { id: 'prayer', name: 'Prayer', kind: 'group', sub: 'Share & lift requests' },
    { id: 'life', name: 'Life Group', kind: 'group', sub: 'A midweek small group' },
  ];
  const [picks, setPicks] = React.useState(() => new Set(['whole', 'prayer']));
  const toggle = (id) => setPicks(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // step 1 — key backup + optional relay registration
  const [saved, setSaved] = React.useState(false);
  const [keyCopied, setKeyCopied] = React.useState(false);
  const [relayOpen, setRelayOpen] = React.useState(false);
  const [relayToken, setRelayToken] = React.useState('');
  const [relayMsg, setRelayMsg] = React.useState('');
  const [relayBusy, setRelayBusy] = React.useState(false);
  const phrase = (() => { try { return window.Steward.exportMnemonic() || ''; } catch { return ''; } })();
  const npub = church.npub || window.Steward.npub || '';
  const doRegister = async () => {
    if (!relayToken.trim()) return;
    setRelayBusy(true); setRelayMsg('Connecting…');
    try { await window.Steward.registerWithRelay(relayToken.trim(), name.trim() || church.name); setRelayMsg('✓ Registered — this relay will accept your church now.'); }
    catch (e) { setRelayMsg('✗ ' + (e.message || 'Couldn’t reach the relay.')); }
    setRelayBusy(false);
  };
  const next = () => setStep(s => s + 1);
  const fld = { width: '100%', boxSizing: 'border-box', height: 48, padding: '0 14px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 15.5, color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontWeight: 600 };
  const lbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 7 };

  const saveName = async () => { const n = name.trim(); if (n && n !== church.name) { setBusy(true); await Promise.resolve(window.Steward.publishProfile({ name: n, nip05: church.nip05 })); setBusy(false); } next(); };
  const saveGroups = async () => { const chosen = STARTERS.filter(s => picks.has(s.id)); if (chosen.length) { setBusy(true); for (const g of chosen) await Promise.resolve(window.Steward.publishGroup({ name: g.name, kind: g.kind, sub: g.sub })); setBusy(false); } next(); };
  const saveTeam = async () => { const t = teamName.trim(); if (t) { setBusy(true); await Promise.resolve(window.Steward.publishGroup({ name: t, kind: 'team', sub: 'Serving team' })); setBusy(false); } next(); };

  if (step === 0) return (
    <WizShell step={step} title="Welcome to your console" sub="Let’s get your church set up — about a minute. First, what’s it called? Members see this name when they join."
      footer={<React.Fragment>
        <button onClick={onDone} className="sk-btn sk-btn--ghost" style={{ padding: '12px 16px' }}>Skip setup</button>
        <div style={{ flex: 1 }} />
        <button onClick={saveName} disabled={busy || !name.trim()} className="sk-btn sk-btn--clay" style={{ padding: '12px 20px', opacity: (busy || !name.trim()) ? .5 : 1 }}>Continue <Icon name="chevR" size={15} color="#fff" /></button>
      </React.Fragment>}>
      <div style={lbl}>CHURCH NAME</div>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim()) saveName(); }} placeholder="Your church’s name" style={fld} />
    </WizShell>
  );

  if (step === 1) return (
    <WizShell step={step} title="Your church’s recovery key" sub="These 12 words ARE your church — they sign everything you post. Write them on paper and keep them safe: without them the church can’t be recovered, and no one (not even us) can reset it for you."
      footer={<React.Fragment>
        <button onClick={() => setStep(0)} className="sk-btn sk-btn--ghost" style={{ padding: '12px 16px' }}><Icon name="chevL" size={15} color="currentColor" /> Back</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => saved && next()} disabled={!saved} className="sk-btn sk-btn--clay" style={{ padding: '12px 20px', opacity: saved ? 1 : .5 }}>Continue <Icon name="chevR" size={15} color="#fff" /></button>
      </React.Fragment>}>
      <div style={lbl}>RECOVERY PHRASE — 12 WORDS</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 14.5, lineHeight: 1.8, wordSpacing: 3, color: 'var(--ink)', background: 'color-mix(in oklab, var(--clay) 7%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, var(--line))', borderRadius: 12, padding: '14px 16px' }}>{phrase || 'No recovery phrase available for this key.'}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 2px' }}>
        {phrase ? <button onClick={() => { copyText(phrase); setKeyCopied(true); setTimeout(() => setKeyCopied(false), 1400); }} className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name={keyCopied ? 'check' : 'receipt'} size={14} color="currentColor" /> {keyCopied ? 'Copied' : 'Copy'}</button> : null}
        <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{npub.slice(0, 22)}…</span>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, cursor: 'pointer', fontSize: 13.5, fontWeight: 600 }}>
        <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--clay)' }} />
        I’ve written these 12 words on paper and stored them safely
      </label>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        {!relayOpen ? (
          <button onClick={() => setRelayOpen(true)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-ui)', padding: 0 }}>Running your own relay? Connect it →</button>
        ) : (
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 9 }}>Paste your relay’s <b>admin token</b> (from the installer output, or <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>journalctl -u trinityone-relay | grep "admin token"</span>) to register your church so the relay stops rejecting it.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={relayToken} onChange={e => setRelayToken(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doRegister(); }} type="password" placeholder="relay admin token" autoComplete="off" style={{ ...fld, height: 44, fontWeight: 400 }} />
              <button onClick={doRegister} disabled={relayBusy || !relayToken.trim()} className="sk-btn sk-btn--clay" style={{ padding: '0 16px', fontSize: 13, whiteSpace: 'nowrap', opacity: (relayBusy || !relayToken.trim()) ? .5 : 1 }}>Connect</button>
            </div>
            {relayMsg ? <div style={{ fontSize: 12.5, marginTop: 8, fontWeight: 600, color: relayMsg[0] === '✓' ? 'var(--sage)' : relayMsg[0] === '✗' ? 'var(--clay)' : 'var(--ink-3)' }}>{relayMsg}</div> : null}
          </div>
        )}
      </div>
    </WizShell>
  );

  if (step === 2) return (
    <WizShell step={step} title="Create a few spaces" sub="Groups are chat rooms (or announcement channels) your members join. Pick a few to start — you can add or remove any time."
      footer={<React.Fragment>
        <button onClick={() => setStep(1)} className="sk-btn sk-btn--ghost" style={{ padding: '12px 16px' }}><Icon name="chevL" size={15} color="currentColor" /> Back</button>
        <div style={{ flex: 1 }} />
        <button onClick={saveGroups} disabled={busy} className="sk-btn sk-btn--clay" style={{ padding: '12px 20px', opacity: busy ? .5 : 1 }}>{picks.size ? `Create ${picks.size} & continue` : 'Skip for now'} <Icon name="chevR" size={15} color="#fff" /></button>
      </React.Fragment>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {STARTERS.map(s => {
          const on = picks.has(s.id);
          return (
            <button key={s.id} onClick={() => toggle(s.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '13px 15px', borderRadius: 14, cursor: 'pointer', background: on ? 'color-mix(in oklab, var(--clay) 9%, var(--surface))' : 'var(--surface)', border: '1.5px solid ' + (on ? 'var(--clay)' : 'var(--line)'), fontFamily: 'var(--font-ui)' }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--clay)' : 'var(--surface-2)', color: on ? '#fff' : 'var(--ink-3)' }}><Icon name={s.kind === 'broadcast' ? 'send' : 'chat'} size={18} color="currentColor" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{s.name}{s.kind === 'broadcast' ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', marginLeft: 7 }}>Broadcast</span> : null}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{s.sub}</div>
              </div>
              <div style={{ width: 22, height: 22, borderRadius: 999, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--clay)' : 'transparent', border: on ? 'none' : '1.5px solid var(--line)' }}>{on ? <Icon name="check" size={14} color="#fff" /> : null}</div>
            </button>
          );
        })}
      </div>
    </WizShell>
  );

  if (step === 3) return (
    <WizShell step={step} title="Serving rota" sub="Teams are who serves on a Sunday — welcome, kids, sound, and so on. Start one now if you like, or set this up later in the Rota tab."
      footer={<React.Fragment>
        <button onClick={() => setStep(2)} className="sk-btn sk-btn--ghost" style={{ padding: '12px 16px' }}><Icon name="chevL" size={15} color="currentColor" /> Back</button>
        <div style={{ flex: 1 }} />
        <button onClick={saveTeam} disabled={busy} className="sk-btn sk-btn--clay" style={{ padding: '12px 20px', opacity: busy ? .5 : 1 }}>{teamName.trim() ? 'Create team & continue' : 'I’ll do this later'} <Icon name="chevR" size={15} color="#fff" /></button>
      </React.Fragment>}>
      <div style={lbl}>FIRST TEAM (OPTIONAL)</div>
      <input value={teamName} onChange={e => setTeamName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveTeam(); }} placeholder="e.g. Welcome Team" style={fld} />
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 10, lineHeight: 1.5 }}>You’ll add who’s on the team and build the schedule from the Rota tab.</div>
    </WizShell>
  );

  return (
    <WizShell step={step} title="You’re all set 🎉" sub="Your church is live. Hand members a joining code from “Invite code”, and post your first note any time."
      footer={<React.Fragment>
        <div style={{ flex: 1 }} />
        <button onClick={() => { if (onTab) onTab('overview'); onDone(); }} className="sk-btn sk-btn--clay" style={{ padding: '12px 22px' }}><Icon name="check" size={16} color="#fff" /> Go to dashboard</button>
      </React.Fragment>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {[['qr', 'Share a joining code', 'Invite members with a QR or short code.'], ['send', 'Post a note', 'Reach your whole church from “New post”.'], ['globe', 'Relays & settings', 'Manage relays, video & audio in Settings.']].map(([ic, t, d]) => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', color: 'var(--clay)' }}><Icon name={ic} size={17} color="currentColor" /></div>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13.5 }}>{t}</div><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{d}</div></div>
          </div>
        ))}
      </div>
    </WizShell>
  );
}

function StewDashboard({ initial = 'overview' }) {
  const [tab, setTab] = React.useState(initial);
  const [invite, setInvite] = React.useState(new URLSearchParams(location.search).get('invite') === '1');
  const [posting, setPosting] = React.useState(new URLSearchParams(location.search).get('newpost') === '1');
  const [addingTeam, setAddingTeam] = React.useState(false);
  const church = window.useStewardChurch();   // real church profile + npub from the relay
  const churchName = church.name || 'Your Church';
  const initials = (church.name ? church.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'TO').toUpperCase();
  // once the church name resolves, re-run self-registration so the pool relays store the readable name
  React.useEffect(() => { if (church.name && window.Steward.selfRegister) window.Steward.selfRegister(church.name).catch(() => {}); }, [church.name]);
  const [renaming, setRenaming] = React.useState(false);   // styled rename dialog (replaces window.prompt)
  const editName = () => setRenaming(true);
  // responsive: a phone/narrow window collapses the desktop sidebar into a top header + scrollable nav
  const [vw, setVw] = React.useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  React.useEffect(() => { const f = () => setVw(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const narrow = vw < 760;

  // first-run wizard: on a fresh church (no published name) show the setup wizard once.
  // Wait ~1.8s for the relay to answer so an existing church doesn't flash it; a localStorage
  // flag (set on finish/skip) keeps it from returning.
  const [wizard, setWizard] = React.useState(false);
  const nameRef = React.useRef(church.name);
  nameRef.current = church.name;
  React.useEffect(() => {
    let done = true; try { done = localStorage.getItem('trinityone.steward.wizard.done') === '1'; } catch {}
    if (done || church.isNetwork) return;
    const t = setTimeout(() => { if (!nameRef.current) setWizard(true); }, 1800);
    return () => clearTimeout(t);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const finishWizard = () => { try { localStorage.setItem('trinityone.steward.wizard.done', '1'); } catch {} setWizard(false); };

  // tab content + topbar actions, shared by both layouts
  const content = (
    <React.Fragment>
      {tab === 'overview' && <DashOverview onTab={setTab} />}
      {tab === 'giving' && <DashGiving />}
      {tab === 'groups' && <DashGroups />}
      {tab === 'rota' && <DashRota onNewTeam={() => setAddingTeam(true)} />}
      {tab === 'calendar' && <DashCalendar />}
      {tab === 'resources' && <DashResources />}
      {tab === 'members' && <DashMembers />}
      {tab === 'settings' && <DashSettings onTab={setTab} />}
    </React.Fragment>
  );
  const actions = (
    <React.Fragment>
      <button onClick={() => setInvite(true)} className="sk-btn sk-btn--ghost" style={{ padding: narrow ? '8px 10px' : '9px 14px', fontSize: 13 }}><Icon name="qr" size={15} color="currentColor" /> {narrow ? '' : 'Invite code'}</button>
      {tab === 'rota'
        ? <button onClick={() => setAddingTeam(true)} className="sk-btn sk-btn--clay" style={{ padding: narrow ? '8px 10px' : '9px 14px', fontSize: 13 }}><Icon name="plus" size={15} color="#fff" /> {narrow ? '' : 'New team'}</button>
        : <button onClick={() => setPosting(true)} className="sk-btn sk-btn--clay" style={{ padding: narrow ? '8px 10px' : '9px 14px', fontSize: 13 }}><Icon name="send" size={15} color="#fff" /> {narrow ? '' : 'New post'}</button>}
      <button onClick={() => setTab('settings')} title="Settings" style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', borderRadius: 11 }}><SkBadge initials="PJ" size={narrow ? 32 : 36} radius={11} accent="var(--sage)" /></button>
    </React.Fragment>
  );

  if (narrow) {
    return (
      <ConsoleChrome>
        {invite ? <JoinModal onClose={() => setInvite(false)} /> : null}
        {posting ? <NewPostModal onClose={() => setPosting(false)} /> : null}
        <NewTeamModal open={addingTeam} onClose={() => setAddingTeam(false)} />
        <MemberChatDock />
        <PublishErrorBanner /><JoinNotifier />
        {wizard ? <StewSetupWizard church={church} onTab={setTab} onDone={finishWizard} /> : null}
        {renaming ? <NameEditModal current={church.name} isNetwork={church.isNetwork} onSave={(n) => Promise.resolve(window.Steward.publishProfile({ name: n, nip05: church.nip05 }))} onClose={() => setRenaming(false)} /> : null}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
          <div style={{ flexShrink: 0, background: church.isNetwork ? 'color-mix(in oklab, var(--clay) 7%, var(--surface))' : 'var(--surface)', borderBottom: '1px solid var(--line)', padding: '10px 12px 8px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Halo size={22} color="var(--ink)" spark="var(--clay)" />
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15 }}>Trinity<span style={{ color: 'var(--clay)' }}>One</span></span>
              <div style={{ flex: 1 }} />
              {actions}
            </div>
            <IdentitySwitcher church={church} churchName={churchName} initials={initials} onEditName={editName} />
            <div className="no-scrollbar" style={{ display: 'flex', gap: 6, overflowX: 'auto', margin: '0 -12px', padding: '2px 12px' }}>
              {NAV.map(n => {
                const on = n.key === tab;
                return (
                  <button key={n.key} onClick={() => setTab(n.key)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, border: '1px solid ' + (on ? 'var(--clay)' : 'var(--line)'), cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, background: on ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface)', color: on ? 'var(--clay-ink)' : 'var(--ink-2)', fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-ui)' }}>
                    <Icon name={n.ic} size={15} color={on ? 'var(--clay)' : 'var(--ink-3)'} /> {n.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px 12px 24px', background: 'var(--paper)' }}>
            {content}
          </div>
        </div>
      </ConsoleChrome>
    );
  }

  return (
    <ConsoleChrome>
      {invite ? <JoinModal onClose={() => setInvite(false)} /> : null}
      {posting ? <NewPostModal onClose={() => setPosting(false)} /> : null}
      <NewTeamModal open={addingTeam} onClose={() => setAddingTeam(false)} />
      <MemberChatDock />
        <PublishErrorBanner /><JoinNotifier />
        {wizard ? <StewSetupWizard church={church} onTab={setTab} onDone={finishWizard} /> : null}
        {renaming ? <NameEditModal current={church.name} isNetwork={church.isNetwork} onSave={(n) => Promise.resolve(window.Steward.publishProfile({ name: n, nip05: church.nip05 }))} onClose={() => setRenaming(false)} /> : null}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'var(--paper)' }}>
        {/* sidebar */}
        <div style={{ width: 232, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', padding: '22px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 8px', marginBottom: 22 }}>
            <Halo size={26} color="var(--ink)" spark="var(--clay)" />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17 }}>Trinity<span style={{ color: 'var(--clay)' }}>One</span></span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.5px', color: 'var(--ink-3)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 6px', marginLeft: 'auto' }}>STEWARD</span>
          </div>
          <IdentitySwitcher church={church} churchName={churchName} initials={initials} onEditName={editName} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {NAV.map(n => {
              const on = n.key === tab;
              return (
                <button key={n.key} onClick={() => setTab(n.key)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 11, border: 'none', cursor: 'pointer', textAlign: 'left', background: on ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'transparent', color: on ? 'var(--clay-ink)' : 'var(--ink-2)', fontWeight: on ? 700 : 600, fontSize: 14.5, fontFamily: 'var(--font-ui)' }}>
                  <Icon name={n.ic} size={19} color={on ? 'var(--clay)' : 'var(--ink-3)'} /> {n.label}
                </button>
              );
            })}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 12px', borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 10%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 24%, transparent)' }}>
            <Icon name="lock" size={16} color="var(--sage)" />
            <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>Keykeeper</div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Extension connected</div></div>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--sage)' }} />
          </div>
        </div>

        {/* main */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* topbar */}
          <div style={{ height: 64, flexShrink: 0, borderBottom: '1px solid var(--line)', background: church.isNetwork ? 'color-mix(in oklab, var(--clay) 7%, var(--surface))' : 'var(--surface)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: 16 }}>
            <div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20 }}>{NAV.find(n => n.key === tab).label}</div></div>
            {church.isNetwork ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, letterSpacing: '.3px', color: 'var(--clay-ink)', background: 'var(--clay-soft)', borderRadius: 999, padding: '5px 11px' }}><Icon name="globe" size={13} color="var(--clay)" /> Network view · {churchName}</span> : null}
            <div style={{ flex: 1 }} />
            {actions}
          </div>
          {/* content */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: 28, background: 'var(--paper)' }}>
            {content}
          </div>
        </div>
      </div>
    </ConsoleChrome>
  );
}

// ---- the join flow: a real QR + code members scan/paste to follow this church ----
function shortNpub(np) { return np ? np.slice(0, 14) + '…' + np.slice(-6) : '—'; }
function copyText(t) {
  if (!t) return false;
  // navigator.clipboard only works in a secure context (https / localhost). Over plain http on the
  // LAN it's undefined, so fall back to a hidden-textarea execCommand copy (works everywhere).
  try { if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(String(t)); return true; } } catch (e) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = String(t); ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.left = '-9999px'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, String(t).length);
    const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
  } catch (e) { return false; }
}

// The printable paper invite (church QR + steps + blank recovery-phrase grid) is generated on demand
// by window.TrinityTemplates.printInviteSheet — see stew-templates.jsx. Wired into "Print invite" below.

function JoinCard({ qrSize = 92, center = false }) {
  const church = window.useStewardChurch();   // re-renders once the npub is ready
  const np = church.npub || '';
  const url = np ? window.Steward.joinUrl() : '';
  const svg = np ? window.Steward.joinQR() : '';
  const [copied, setCopied] = React.useState('');
  const doCopy = (what, text) => { copyText(text); setCopied(what); setTimeout(() => setCopied(''), 1400); };
  return (
    <div style={{ display: 'flex', flexDirection: center ? 'column' : 'row', gap: 16, alignItems: 'center', textAlign: center ? 'center' : 'left' }}>
      <div style={{ width: qrSize + 18, height: qrSize + 18, borderRadius: 14, background: '#fff', boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 9, boxSizing: 'border-box' }}>
        {svg ? <div style={{ width: qrSize, height: qrSize, display: 'flex' }} dangerouslySetInnerHTML={{ __html: svg }} /> : <SkQR size={qrSize} />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Your church code</div>
        <div onClick={() => doCopy('code', np)} title={np} style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 15, letterSpacing: '.3px', margin: '4px 0 2px', cursor: 'pointer' }}>{shortNpub(np)}</div>
        {/* full code, selectable — so copy works even if the buttons can't reach the clipboard */}
        <textarea readOnly value={np} onFocus={e => e.target.select()} style={{ width: '100%', maxWidth: 280, height: 40, resize: 'none', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink-2)', fontFamily: 'var(--mono)', fontSize: 10.5, padding: '6px 8px', marginTop: 2, lineHeight: 1.3, wordBreak: 'break-all' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: center ? 'center' : 'flex-start' }}>
          <button onClick={() => doCopy('code', np)} className="sk-btn sk-btn--clay" style={{ padding: '7px 11px', fontSize: 12 }}><Icon name={copied === 'code' ? 'check' : 'receipt'} size={14} color="#fff" /> {copied === 'code' ? 'Copied' : 'Copy code'}</button>
          <button onClick={() => doCopy('link', url)} className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 12 }}><Icon name={copied === 'link' ? 'check' : 'link'} size={14} color="currentColor" /> {copied === 'link' ? 'Copied' : 'Copy link'}</button>
          <button onClick={() => window.TrinityTemplates.printInviteSheet({ name: church.name, url, qrSvg: svg })} className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 12 }} title="Print a paper invite with the QR + space for the recovery phrase"><Icon name="receipt" size={14} color="currentColor" /> Print invite</button>
        </div>
      </div>
    </div>
  );
}

function JoinModal({ onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'rgba(40,32,24,.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: '92%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 30 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, textAlign: 'center' }}>Invite your church</div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 22px', textAlign: 'center' }}>Show this on screen or print it. One scan with a phone camera opens TrinityOne already following your church — anonymously, no sign-up.</p>
        <JoinCard qrSize={168} center />
        <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ width: '100%', padding: 11, fontSize: 14, marginTop: 24 }}>Done</button>
      </div>
    </div>
  );
}

// post a signed announcement to the church (kind-1), targeting a broadcast room
function NewPostModal({ onClose }) {
  const groups = window.useStewardGroups();
  const targets = groups;   // post to any chat group or team (not only Announcements)
  const broadcast = groups.find(g => g.kind === 'broadcast');
  const [text, setText] = React.useState('');
  const [target, setTarget] = React.useState(broadcast ? broadcast.id : (groups[0] ? groups[0].id : 'announce'));
  const [sending, setSending] = React.useState(false);
  const post = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try { await window.Steward.publishPost(text.trim(), target); } catch {}
    onClose();
  };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'rgba(40,32,24,.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: '92%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 28 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>New post</div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 18px' }}>A signed message from your church. Members see it in the chosen group or team.</p>
        {targets.length ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>Post to</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {targets.map(g => (
                <button key={g.id} onClick={() => setTarget(g.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, border: '1px solid ' + (target === g.id ? 'var(--clay)' : 'var(--line)'), background: target === g.id ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface)', color: target === g.id ? 'var(--clay-ink)' : 'var(--ink-2)' }}>
                  <Icon name={g.kind === 'team' ? (g.icon || 'shield') : g.kind === 'broadcast' ? 'send' : 'chat'} size={13} color="currentColor" />{g.name}{g.kind === 'team' ? <span style={{ fontSize: 10, fontWeight: 800, opacity: .6, letterSpacing: '.4px' }}>TEAM</span> : null}</button>
              ))}
            </div>
          </div>
        ) : null}
        <textarea value={text} onChange={e => setText(e.target.value)} autoFocus rows={4} placeholder="Write to your church…" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface-2)', padding: '13px 15px', fontSize: 14.5, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', resize: 'vertical', lineHeight: 1.5 }} />
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12, fontSize: 14 }}>Cancel</button>
          <button onClick={post} disabled={!text.trim() || sending} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 12, fontSize: 14, opacity: (!text.trim() || sending) ? 0.55 : 1 }}><Icon name="send" size={16} color="#fff" /> {sending ? 'Posting…' : 'Post'}</button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, ic, tint }) {
  const t = SK_TINT[tint];
  return (
    <div style={{ flex: 1, padding: 18, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: t.bg, color: t.fg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={ic} size={17} color="currentColor" /></div>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)' }}>{label}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, letterSpacing: '-.6px', marginTop: 12 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function Panel({ title, action, children, style = {}, scroll = false }) {
  return (
    <div style={{ borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', padding: 22, ...(scroll ? { display: 'flex', flexDirection: 'column', minHeight: 0 } : {}), ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16.5 }}>{title}</div>
        <div style={{ flex: 1 }} />
        {action}
      </div>
      {scroll ? <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{children}</div> : children}
    </div>
  );
}

function DashOverview({ onTab }) {
  const groups = window.useStewardGroups();   // real chat groups (the focus)
  const members = window.useStewardMembers(); // real members (joined and/or active)
  const relays = window.useStewardRelays();   // real relay status
  const stats = window.useStewardStats();     // real footprint + announcement counts
  const activity = window.useStewardActivity(); // real recent-events feed
  const relayUp = relays.some(r => r.status === 'on');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, height: '100%' }}>
      <div style={{ display: 'flex', gap: 14 }}>
        <StatCard label="Members" value={members.length ? String(members.length) : '—'} sub={members.length ? 'invite more' : 'invite your church'} ic="pray" tint="sage" />
        <StatCard label="Groups" value={String(groups.length)} sub="chat rooms · signed" ic="chat" tint="clay" />
        <StatCard label="Announcements" value={stats.announcements ? String(stats.announcements) : '—'} sub="post to everyone" ic="send" tint="gold" />
        <StatCard label="Your relay" value={relays.length === 0 ? '…' : (relayUp ? 'Live' : 'Down')} sub="self-hosted" ic="globe" tint={relayUp || relays.length === 0 ? 'ink' : 'clay'} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.45fr 1fr', gap: 18, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
          <Panel title="Groups & rooms" action={<button onClick={() => onTab('groups')} style={{ border: 'none', background: 'none', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Manage →</button>} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {groups.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '8px 2px' }}>No groups yet — create your church’s first chat room.</div> : null}
              {groups.map(g => (
                <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface-2)', color: g.kind === 'broadcast' ? '#8a6717' : 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={g.kind === 'broadcast' ? 'send' : 'chat'} size={18} color="currentColor" /></div>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{g.name}</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{g.sub || (g.kind === 'broadcast' ? 'Broadcast' : 'Group')}</div></div>
                  {g.kind === 'broadcast' ? <SkPill tint="gold">Broadcast</SkPill> : null}
                </div>
              ))}
            </div>
          </Panel>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
          <Panel title="Joining code">
            <JoinCard qrSize={92} />
          </Panel>
          <Panel title="Recent activity" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {activity.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '6px 2px' }}>Nothing yet — activity shows here as your church chats.</div> : null}
            <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {activity.map((a) => {
                const t = SK_TINT[a.tint] || SK_TINT.ink;
                return (
                  <div key={a.id} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 9, background: t.bg, color: t.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={a.ic} size={16} color="currentColor" /></div>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{a.text}</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 1 }}>{ago(a.ts)}</div></div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function DashGiving() {
  const funds = window.useStewardFunds();   // REAL funds the church has published (kind-30078)
  const newFund = () => {
    const name = window.prompt('New fund name (e.g. Missions)');
    if (name && name.trim()) window.Steward.publishFund({ name: name.trim(), custody: 'Custodial · Strike', icon: 'gift' });
  };
  return (
    <Panel title="Funds" action={<button onClick={newFund} className="sk-btn sk-btn--clay" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="plus" size={15} color="#fff" /> New fund</button>} style={{ height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1.3fr 1fr 1fr 0.4fr', padding: '0 8px 12px', borderBottom: '1px solid var(--line)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
        <div>Fund</div><div>Custody</div><div style={{ textAlign: 'right' }}>This month</div><div style={{ textAlign: 'right' }}>Year to date</div><div></div>
      </div>
      {funds.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '36px 10px', color: 'var(--ink-3)' }}>
          <Icon name="gift" size={26} color="var(--ink-3)" /><p style={{ margin: '10px 0 0', fontSize: 13.5 }}>No funds yet — add your first.</p></div>
      ) : null}
      {funds.map(f => (
        <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '2.2fr 1.3fr 1fr 1fr 0.4fr', alignItems: 'center', padding: '15px 8px', borderBottom: '1px solid var(--line-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface-2)', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={f.icon} size={18} color="currentColor" /></div>
            <div><div style={{ fontWeight: 700, fontSize: 14.5 }}>{f.name}</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{f.sub}{f.goal ? ` · ${Math.round(f.raised / f.goal * 100)}% of $${(f.goal / 1000)}k` : ''}</div></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-2)', fontWeight: 600 }}><Icon name={(f.custody || '').includes('Strike') ? 'wallet' : 'bank'} size={15} color="var(--ink-3)" /> {f.custody || 'Custodial · Strike'}</div>
          <div style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: 15 }}>{f.month || '—'}</div>
          <div style={{ textAlign: 'right', fontWeight: 600, fontSize: 14, color: 'var(--ink-2)' }}>{f.ytd || '—'}</div>
          <div style={{ textAlign: 'right' }}><Icon name="dots" size={18} color="var(--ink-3)" /></div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 9, marginTop: 16, padding: 13, borderRadius: 12, background: 'color-mix(in oklab, var(--gold) 10%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 28%, transparent)' }}>
        <Icon name="bolt" size={17} fill color="var(--gold)" style={{ flexShrink: 0 }} />
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>Editing a fund republishes a signed event to your relays. Your <b style={{ color: 'var(--ink)' }}>Keykeeper</b> extension will ask you to approve the change.</div>
      </div>
    </Panel>
  );
}

function ListPanel({ title, items, addLabel, renderRight, onAdd, empty, reorderable, onReorder }) {
  const [order, setOrder] = React.useState(null);   // working copy while dragging
  const [dragId, setDragId] = React.useState(null);
  const [overId, setOverId] = React.useState(null);
  const list = order || items;
  const idOf = (it, i) => it.id != null ? it.id : i;
  const onDragOver = (e, id) => {
    e.preventDefault();
    if (dragId == null || id === dragId) return;
    const arr = (order || items).slice();
    const from = arr.findIndex((x, i) => idOf(x, i) === dragId), to = arr.findIndex((x, i) => idOf(x, i) === id);
    if (from < 0 || to < 0) return;
    const [m] = arr.splice(from, 1); arr.splice(to, 0, m);
    setOrder(arr); setOverId(id);
  };
  const onDrop = () => { if (order && onReorder) onReorder(order); setDragId(null); setOverId(null); setOrder(null); };
  const move = (idx, dir) => { const arr = items.slice(); const j = idx + dir; if (j < 0 || j >= arr.length) return; const t = arr[idx]; arr[idx] = arr[j]; arr[j] = t; if (onReorder) onReorder(arr); };
  return (
    <Panel title={title} action={<button onClick={onAdd} className="sk-btn sk-btn--clay" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="plus" size={15} color="#fff" /> {addLabel}</button>} style={{ height: '100%' }}>
      {items.length === 0 ? <div style={{ textAlign: 'center', padding: '34px 10px', color: 'var(--ink-3)', fontSize: 13.5 }}>{empty || 'Nothing here yet.'}</div> : null}
      {reorderable && items.length > 1 ? <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 2px 10px', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="dots" size={13} color="var(--ink-3)" /> Drag to reorder — this is the order your members see.</div> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map((it, i) => {
          const id = idOf(it, i), dragging = dragId === id;
          return (
          <div key={id} draggable={!!reorderable}
            onDragStart={reorderable ? (e) => { setDragId(id); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(id)); } catch (err) {} } : undefined}
            onDragOver={reorderable ? (e) => onDragOver(e, id) : undefined} onDrop={reorderable ? onDrop : undefined} onDragEnd={reorderable ? () => { setDragId(null); setOverId(null); setOrder(null); } : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid ' + (overId === id && !dragging ? 'var(--clay)' : 'var(--line)'), opacity: dragging ? 0.4 : 1, boxShadow: dragging ? 'var(--shadow-lg)' : 'none', transition: 'border-color .12s, opacity .12s' }}>
            {reorderable ? <div title="Drag to reorder" style={{ cursor: 'grab', color: 'var(--ink-3)', display: 'flex', flexShrink: 0, touchAction: 'none' }}><Icon name="dots" size={18} color="currentColor" /></div> : null}
            <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--surface)', color: it.fg || 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)' }}><Icon name={it.ic} size={19} color="currentColor" /></div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14.5 }}>{it.name}</div><div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{it.sub}</div></div>
            {renderRight(it)}
          </div>
          );
        })}
      </div>
    </Panel>
  );
}

// create-a-group modal (a real form, not a prompt)
function NewGroupModal({ open, onClose }) {
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState('group');
  const [sub, setSub] = React.useState('');
  const [inviteOnly, setInviteOnly] = React.useState(false);
  const [sel, setSel] = React.useState(new Set());   // chosen member pubkeys for an invite-only group
  const members = window.useStewardMembers ? window.useStewardMembers() : [];
  React.useEffect(() => { if (open) { setName(''); setKind('group'); setSub(''); setInviteOnly(false); setSel(new Set()); } }, [open]);
  if (!open) return null;
  const togglePk = (pk) => setSel(s => { const n = new Set(s); n.has(pk) ? n.delete(pk) : n.add(pk); return n; });
  const create = () => {
    if (!name.trim()) return;
    const g = { name: name.trim(), kind, sub: sub.trim() };
    if (kind === 'group' && inviteOnly) { g.visibility = 'invite'; g.members = [...sel]; }
    window.Steward.publishGroup(g); onClose();
  };
  const fld = { width: '100%', boxSizing: 'border-box', height: 46, padding: '0 14px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 15, color: 'var(--ink)', fontFamily: 'var(--font-ui)' };
  const lbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 7px' };
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30,
      background: 'color-mix(in oklab, var(--ink) 32%, transparent)', backdropFilter: 'blur(3px)', animation: 'lumenFade .18s ease both' }}>
      <div style={{ width: 480, maxWidth: '100%', borderRadius: 22, background: 'var(--paper)', border: '1px solid var(--line)', boxShadow: '0 24px 70px rgba(0,0,0,.28)', overflow: 'hidden', animation: 'lumenScale .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div className="no-scrollbar" style={{ padding: '24px 26px 0', maxHeight: '64vh', overflowY: 'auto' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, marginBottom: 4 }}>New group</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 18, lineHeight: 1.5 }}>A chat room (or a broadcast channel) for your church. It’s published as a signed event your members can join.</div>
          <div style={lbl}>NAME</div>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }} placeholder="e.g. Sunday Service" style={{ ...fld, fontWeight: 600, marginBottom: 16 }} />
          <div style={lbl}>TYPE</div>
          <SkToggle value={kind} onChange={setKind} options={[{ value: 'group', label: 'Group chat', icon: 'chat' }, { value: 'broadcast', label: 'Broadcast', icon: 'send' }]} style={{ marginBottom: 6 }} />
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '6px 0 16px', lineHeight: 1.45 }}>{kind === 'broadcast' ? 'Only stewards post; everyone reads. Good for announcements.' : 'Everyone in the group can post and reply.'}</div>
          <div style={lbl}>DESCRIPTION</div>
          <input value={sub} onChange={e => setSub(e.target.value)} placeholder="Optional — e.g. Whole church" style={{ ...fld, fontSize: 14.5 }} />
          {kind === 'group' ? (
            <React.Fragment>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '18px 0 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={inviteOnly} onChange={e => setInviteOnly(e.target.checked)} style={{ marginTop: 2 }} />
                <span style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.45 }}><b>Invite-only</b> — hidden from the group list, and only the members you choose can post (the relay enforces it).</span>
              </label>
              {inviteOnly ? (
                <div style={{ marginTop: 14 }}>
                  <div style={lbl}>WHO’S IN · {sel.size}</div>
                  {members.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>No members have joined yet — create the group, then add people here once they’re in.</div> : (
                    <div className="no-scrollbar" style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {members.map(m => { const on = sel.has(m.pubkey); return (
                        <button key={m.pubkey} type="button" onClick={() => togglePk(m.pubkey)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, border: '1px solid ' + (on ? 'color-mix(in oklab, var(--sage) 45%, var(--line))' : 'var(--line)'), background: on ? 'color-mix(in oklab, var(--sage) 8%, var(--surface))' : 'var(--surface)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
                          <div style={{ width: 20, height: 20, borderRadius: 6, border: '2px solid ' + (on ? 'var(--sage)' : 'var(--line)'), background: on ? 'var(--sage)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{on ? <Icon name="check" size={13} stroke={3} color="#fff" /> : null}</div>
                          <span style={{ fontWeight: 700, fontSize: 13.5 }}>{m.name || 'Anonymous'}</span>
                          <span style={{ fontSize: 11, color: m.nip05 ? 'var(--sage)' : 'var(--ink-3)', fontWeight: m.nip05 ? 700 : 400, fontFamily: m.nip05 ? 'var(--font-ui)' : 'var(--mono)', marginLeft: 'auto' }}>{m.nip05 ? '@' + String(m.nip05).split('@')[0] : shortNpub(m.npub)}</span>
                        </button>
                      ); })}
                    </div>
                  )}
                </div>
              ) : null}
            </React.Fragment>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '20px 26px 22px' }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: '12px' }}>Cancel</button>
          <button onClick={create} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: '12px', opacity: name.trim() ? 1 : .5 }}><Icon name="plus" size={16} color="#fff" /> Create group</button>
        </div>
      </div>
    </div>
  );
}

// Console chat view for one group/team — read the scrollback + post as the church.
function GroupChatModal({ group, onClose }) {
  const [msgs, setMsgs] = React.useState([]);
  const [text, setText] = React.useState('');
  const [rxFor, setRxFor] = React.useState('');
  const scRef = React.useRef(null);
  const GROUP_EMOJI = ['❤️', '🙏', '👍', '😂', '🔥', '🎉'];
  React.useEffect(() => window.Steward.subscribeGroupChat(group.id, setMsgs), [group.id]);
  React.useEffect(() => { if (scRef.current) scRef.current.scrollTop = scRef.current.scrollHeight; }, [msgs]);
  const send = () => { if (!text.trim()) return; window.Steward.publishPost(text.trim(), group.id); setText(''); };
  const react = (m, emoji) => { window.Steward.reactGroup(group.id, m.id, m.by, m.myReaction === emoji ? '-' : emoji); setRxFor(''); };
  const isTeam = group.kind === 'team';
  const accent = isTeam ? (group.accent || 'var(--clay)') : group.kind === 'broadcast' ? '#8a6717' : 'var(--sage)';
  return (
    <div style={{ position: 'absolute', right: 24, bottom: 0, zIndex: 92, width: 344, maxWidth: 'calc(100% - 48px)', height: 480, maxHeight: '82%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: '16px 16px 0 0', border: '1px solid var(--line)', borderBottom: 'none', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', animation: 'lumenRise .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 15px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, background: `color-mix(in oklab, ${accent} 16%, var(--surface))`, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={isTeam ? (group.icon || 'shield') : group.kind === 'broadcast' ? 'send' : 'chat'} size={19} /></div>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{group.name}</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{isTeam ? 'Team chat' : group.kind === 'broadcast' ? 'Broadcast' : 'Group chat'} · you post as the church</div></div>
          <button onClick={onClose} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', display: 'flex' }}><Icon name="x" size={16} /></button>
        </div>
        <div ref={scRef} className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          {msgs.length === 0 ? <div style={{ fontSize: 13.5, color: 'var(--ink-3)', textAlign: 'center', margin: 'auto' }}>No messages yet. Say hello to your church.</div> : null}
          {msgs.map(m => (
            <div key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '76%', display: 'flex', flexDirection: 'column', alignItems: m.mine ? 'flex-end' : 'flex-start' }}>
              {!m.mine ? <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginBottom: 2, paddingLeft: 4 }}>{'member …' + (m.by || '').slice(-8)}</div> : null}
              <div onClick={() => setRxFor(v => v === m.id ? '' : m.id)} title="Tap to react" style={{ padding: '9px 13px', borderRadius: 15, fontSize: 14, lineHeight: 1.4, background: m.mine ? 'var(--clay)' : 'var(--surface-2)', color: m.mine ? '#fff' : 'var(--ink)', border: m.mine ? 'none' : '1px solid var(--line)', cursor: 'pointer' }}>{m.kind === 'prayer' ? '🙏 ' : ''}{m.text}</div>
              {m.reactions && m.reactions.length ? (
                <div style={{ display: 'flex', gap: 3, marginTop: 3, flexWrap: 'wrap' }}>
                  {Object.entries(m.reactions.reduce((a, e) => (a[e] = (a[e] || 0) + 1, a), {})).map(([emo, n]) => (
                    <button key={emo} onClick={() => react(m, emo)} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 6px', borderRadius: 999, fontSize: 11.5, border: '1px solid var(--line)', background: m.myReaction === emo ? 'color-mix(in oklab, var(--clay) 16%, var(--surface))' : 'var(--surface)', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>{emo}{n > 1 ? <span style={{ color: 'var(--ink-3)', fontWeight: 700 }}>{n}</span> : null}</button>
                  ))}
                </div>
              ) : null}
              {rxFor === m.id ? (
                <div style={{ display: 'flex', gap: 2, marginTop: 4, padding: '4px 6px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, boxShadow: 'var(--shadow)' }}>
                  {GROUP_EMOJI.map(emo => (
                    <button key={emo} onClick={() => react(m, emo)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 3px', borderRadius: 7, opacity: m.myReaction === emo ? 1 : 0.85 }}>{emo}</button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 9, padding: '12px 14px', borderTop: '1px solid var(--line)' }}>
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} placeholder="Message your church…" style={{ flex: 1, height: 42, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '0 14px', fontSize: 14, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
          <button onClick={send} disabled={!text.trim()} className="sk-btn sk-btn--clay" style={{ padding: '0 16px', opacity: text.trim() ? 1 : 0.55 }}><Icon name="send" size={16} color="#fff" /></button>
        </div>
    </div>
  );
}

function DashGroups() {
  const all = window.useStewardGroups();   // groups AND teams (teams are chat channels too)
  const rosters = window.useStewardRosters();
  const [adding, setAdding] = React.useState(new URLSearchParams(location.search).get('newgroup') === '1');
  const [chatGroup, setChatGroup] = React.useState(null);
  const [teamMembers, setTeamMembers] = React.useState(null);   // { team, people }
  const [leadersFor, setLeadersFor] = React.useState(null);     // group whose event-leaders we're editing
  const [pendingDelete, setPendingDelete] = React.useState(null);   // group awaiting delete confirmation
  const [undo, setUndo] = React.useState(null);                     // recently-deleted group (restorable)
  const undoTimer = React.useRef(null);
  const items = all.map(g => ({ ...g, ic: g.kind === 'team' ? (g.icon || 'shield') : g.kind === 'broadcast' ? 'send' : 'chat', fg: g.kind === 'team' ? (g.accent || 'var(--clay)') : g.kind === 'broadcast' ? '#8a6717' : 'var(--sage)' }));
  const confirmDelete = () => {
    const g = pendingDelete; if (!g) return;
    window.Steward.removeGroup(g.id);
    setPendingDelete(null); setUndo(g);
    clearTimeout(undoTimer.current); undoTimer.current = setTimeout(() => setUndo(null), 9000);
  };
  const doUndo = () => { if (undo) window.Steward.publishGroup({ id: undo.id, name: undo.name, kind: undo.kind, sub: undo.sub, icon: undo.icon, accent: undo.accent }); clearTimeout(undoTimer.current); setUndo(null); };
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      {pendingDelete ? (
        <div onClick={() => setPendingDelete(null)} style={{ position: 'absolute', inset: 0, zIndex: 95, background: 'rgba(40,32,24,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: '94%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26, animation: 'lumenScale .2s ease both' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 8 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="trash" size={21} /></div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>Delete “{pendingDelete.name}”?</div>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 8px' }}>This removes the {pendingDelete.kind === 'team' ? 'team and its rota roles' : 'group'} for everyone. Members will no longer see it{pendingDelete.kind === 'team' ? ', and its rota assignments stop applying' : ' or its chat'}.</p>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 20px' }}>Past messages stay on the relay but won’t be shown. You can undo this for a few seconds.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setPendingDelete(null)} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 13, fontSize: 14 }}>Keep it</button>
              <button onClick={confirmDelete} className="sk-btn" style={{ flex: 1, padding: 13, fontSize: 14, background: 'var(--clay)', color: '#fff' }}><Icon name="trash" size={15} color="#fff" /> Delete</button>
            </div>
          </div>
        </div>
      ) : null}
      {undo ? (
        <div style={{ position: 'absolute', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 90, display: 'flex', alignItems: 'center', gap: 14, background: 'var(--ink)', color: 'var(--paper)', padding: '11px 14px 11px 18px', borderRadius: 14, boxShadow: 'var(--shadow-lg)', fontSize: 13.5, fontWeight: 600 }}>
          Removed “{undo.name}”
          <button onClick={doUndo} style={{ border: 'none', background: 'rgba(255,255,255,.16)', color: '#fff', borderRadius: 9, padding: '6px 13px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13 }}>Undo</button>
        </div>
      ) : null}
      <ListPanel title="Groups, teams & rooms" addLabel="New group" onAdd={() => setAdding(true)} items={items}
        reorderable onReorder={(arr) => arr.forEach((g, i) => { if (g.order !== i) window.Steward.publishGroup({ ...g, order: i }); })}
        empty="No groups yet — create your church's first chat room (or a team on the Rota page)."
        renderRight={(it) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {it.kind === 'broadcast' ? <SkPill tint="gold">Broadcast</SkPill> : null}
            {it.kind === 'team' ? <button onClick={() => { const r = rosters.find(x => x.team === it.id) || { people: [] }; setTeamMembers({ team: it, people: r.people || [] }); }} title="See team members" style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}><SkPill tint="clay">Team · {(rosters.find(x => x.team === it.id) || { people: [] }).people.length}</SkPill></button> : null}
            {(it.leaders && it.leaders.length) ? <SkPill tint="sage">{it.leaders.length} leader{it.leaders.length === 1 ? '' : 's'}</SkPill> : null}
            <button onClick={() => setLeadersFor(it)} title="Members who help run this group" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 9px', cursor: 'pointer', color: 'var(--sage)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}><Icon name="users" size={15} color="currentColor" /> Leaders</button>
            <button onClick={() => setChatGroup(it)} title="Open chat" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 9px', cursor: 'pointer', color: 'var(--clay)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}><Icon name="chat" size={15} color="currentColor" /> Chat</button>
            <button onClick={() => setPendingDelete(it)} title={it.kind === 'team' ? 'Remove team' : 'Remove group'} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 7px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="trash" size={15} color="currentColor" /></button>
          </div>
        )} />
      <NewGroupModal open={adding} onClose={() => setAdding(false)} />
      {chatGroup ? <GroupChatModal group={chatGroup} onClose={() => setChatGroup(null)} /> : null}
      {teamMembers ? (
        <div onClick={() => setTeamMembers(null)} style={{ position: 'absolute', inset: 0, zIndex: 92, background: 'rgba(40,32,24,.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: '94%', maxHeight: '80%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 24, animation: 'lumenScale .2s ease both' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: `color-mix(in oklab, ${teamMembers.team.accent || 'var(--clay)'} 16%, var(--surface))`, color: teamMembers.team.accent || 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={teamMembers.team.icon || 'shield'} size={20} /></div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{teamMembers.team.name}</div><div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{teamMembers.people.length} member{teamMembers.people.length === 1 ? '' : 's'}</div></div>
              <button onClick={() => setTeamMembers(null)} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', display: 'flex' }}><Icon name="x" size={16} /></button>
            </div>
            <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {teamMembers.people.length === 0 ? <div style={{ fontSize: 13.5, color: 'var(--ink-3)', textAlign: 'center', padding: 24 }}>No one on this team yet — add people via the team’s roster on the Rota page.</div>
                : teamMembers.people.map((p, i) => (
                  <div key={p.id || p.pub || i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 999, flexShrink: 0, background: `linear-gradient(150deg, ${teamMembers.team.accent || 'var(--clay)'}, color-mix(in oklab, ${teamMembers.team.accent || 'var(--clay)'} 60%, #16120c))`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 11 }}>{(p.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>{p.pub ? <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>linked member</div> : <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>not linked to an app account</div>}</div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ) : null}
      {leadersFor ? <GroupLeadersModal group={leadersFor} onClose={() => setLeadersFor(null)} /> : null}
    </div>
  );
}

// pick which members may post events for a group. The chosen pubkeys go into the group def's `leaders`;
// the relay then lets exactly those members publish events scoped to this group.
function GroupLeadersModal({ group, onClose }) {
  const members = window.useStewardMembers().filter(m => m.pubkey);
  const [sel, setSel] = React.useState(() => new Set(group.leaders || []));
  const [saving, setSaving] = React.useState(false);
  const toggle = (pk) => setSel(s => { const n = new Set(s); n.has(pk) ? n.delete(pk) : n.add(pk); return n; });
  const save = async () => {
    setSaving(true);
    const before = new Set(group.leaders || []);
    await window.Steward.setGroupLeaders(group, [...sel]);
    // tell newly-added leaders, so they know they can now manage this group
    const added = [...sel].filter(pk => !before.has(pk));
    for (const pk of added) {
      try { await window.Steward.sendDM(pk, `You’re now a leader of “${group.name}”. You can post events for it from your app — open the group and tap “Event”.`); } catch {}
    }
    onClose();
  };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 95, background: 'rgba(40,32,24,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: '94%', maxHeight: '82%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 24, animation: 'lumenScale .2s ease both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="users" size={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19 }}>Group leaders</div><div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{group.name}</div></div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 14px' }}>Leaders help run this group. They can create events for it from their app (shown on everyone’s calendar and in the group’s chat), and we’ll message them to let them know. You can change this anytime.</p>
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {members.length === 0 ? <div style={{ fontSize: 13.5, color: 'var(--ink-3)', textAlign: 'center', padding: 24 }}>No app members yet. Once people join your church they’ll be selectable here.</div>
            : members.map(m => {
              const on = sel.has(m.pubkey);
              const nm = m.name || ('Anon · ' + (m.npub || m.pubkey).slice(-6));
              return (
                <button key={m.pubkey} onClick={() => toggle(m.pubkey)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12, border: '1px solid ' + (on ? 'color-mix(in oklab, var(--sage) 45%, var(--line))' : 'var(--line)'), background: on ? 'color-mix(in oklab, var(--sage) 8%, var(--surface))' : 'var(--surface-2)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
                  <SkBadge initials={(nm.replace(/^Anon · /, '').split(/\s+/).map(w => w[0]).join('').slice(0, 2) || 'AN').toUpperCase()} size={32} radius={9} accent={on ? 'var(--sage)' : undefined} />
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{nm}</div><div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>{(m.npub || '').slice(0, 16)}…</div></div>
                  <div style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, border: '1.5px solid ' + (on ? 'var(--sage)' : 'var(--line)'), background: on ? 'var(--sage)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on ? <Icon name="check" size={14} stroke={3} color="#fff" /> : null}</div>
                </button>
              );
            })}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12, fontSize: 14 }}>Cancel</button>
          <button onClick={save} disabled={saving} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 12, fontSize: 14, opacity: saving ? 0.6 : 1 }}><Icon name="check" size={15} color="#fff" /> {saving ? 'Saving…' : 'Save leaders'}</button>
        </div>
      </div>
    </div>
  );
}

// New team — a ministry/rota team with an icon, accent and a starter role list. Creates a kind:'team'
// group (so it's also a chat channel) + a roster doc (its roles + people). Lives on the Rota page.
function NewTeamModal({ open, onClose }) {
  const [name, setName] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [icon, setIcon] = React.useState('hand');
  const [accent, setAccent] = React.useState('#C25A38');
  const [roles, setRoles] = React.useState('');
  const [selId, setSelId] = React.useState('');   // which preset is applied (so switching repopulates)
  React.useEffect(() => { if (open) { setName(''); setDesc(''); setIcon('hand'); setAccent('#C25A38'); setRoles(''); setSelId(''); } }, [open]);
  if (!open) return null;
  const applyPreset = (p) => {
    setIcon(p.icon); setAccent(p.accent);
    // switching templates repopulates name/roles — but keep anything you typed by hand (i.e. that no
    // longer matches the previously-applied preset).
    const prev = (window.TEAM_PRESETS || []).find(x => x.id === selId);
    if (!name.trim() || (prev && name === prev.name)) setName(p.name);
    if (!roles.trim() || (prev && roles === prev.roles)) setRoles(p.roles);
    setSelId(p.id);
  };
  const create = () => {
    if (!name.trim()) return;
    const roleList = roles.split('\n').map(s => s.trim()).filter(Boolean).map(n => ({ name: n }));
    Promise.resolve(window.Steward.publishGroup({ name: name.trim(), kind: 'team', sub: desc.trim(), icon, accent }))
      .then(g => { if (g && g.id) window.Steward.publishRoster(g.id, { roles: roleList, people: [] }); });
    onClose();
  };
  const fld = { width: '100%', boxSizing: 'border-box', height: 44, border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface-2)', padding: '0 13px', fontSize: 14.5, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' };
  const lbl = { fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '14px 0 6px' };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'rgba(40,32,24,.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 500, maxWidth: '93%', maxHeight: '90%', overflow: 'auto', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 28 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>New team</div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 4px' }}>Pick a kind to start from, then tweak. The team is a private chat channel and its people fill rota slots.</p>
        <div style={lbl}>Kind</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(window.TEAM_PRESETS || []).map(p => {
            const on = selId === p.id;
            return (
              <button key={p.id} onClick={() => applyPreset(p)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13,
                border: on ? `2px solid ${p.accent}` : '1px solid var(--line)', background: on ? `color-mix(in oklab, ${p.accent} 10%, var(--surface))` : 'var(--surface)', color: 'var(--ink)' }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, background: `color-mix(in oklab, ${p.accent} 16%, var(--surface))`, color: p.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={p.icon} size={15} /></div>{p.name}</button>
            );
          })}
        </div>
        <div style={lbl}>Name</div>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. Worship Team" style={fld} />
        <div style={lbl}>Roles to fill (one per line)</div>
        <textarea value={roles} onChange={e => setRoles(e.target.value)} rows={5} placeholder={'Lead\nVocals\nKeys\nSound'} style={{ ...fld, height: 'auto', padding: '11px 13px', lineHeight: 1.5, resize: 'vertical', fontFamily: 'var(--font-ui)' }} />
        <div style={lbl}>What's it for (optional)</div>
        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Sunday musicians & singers" style={fld} />
        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12, fontSize: 14 }}>Cancel</button>
          <button onClick={create} disabled={!name.trim()} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 12, fontSize: 14, opacity: name.trim() ? 1 : 0.55 }}><Icon name="plus" size={16} color="#fff" /> Create team</button>
        </div>
      </div>
    </div>
  );
}
window.NewTeamModal = NewTeamModal;

function DashRelaysCard() {
  const status = window.useStewardRelays();   // [{ url, status:'on'|'off', ms }]
  const host = (typeof location !== 'undefined' && location.host) || '';
  const online = status.filter(r => r.status === 'on').length;
  const checking = status.length === 0;
  const allUp = online === status.length;
  const own = window.Steward.ownRelay ? window.Steward.ownRelay() : '';
  const [draft, setDraft] = React.useState('');
  const [err, setErr] = React.useState('');
  const addRelay = () => {
    const r = window.Steward.addRelay && window.Steward.addRelay(draft);
    if (!r) { setErr('Enter a relay address, e.g. nos.lol (or wss://relay.example.com)'); return; }
    setDraft(''); setErr('');
  };
  const [regOpen, setRegOpen] = React.useState(false);
  const [regToken, setRegToken] = React.useState('');
  const [regMsg, setRegMsg] = React.useState('');
  const [regBusy, setRegBusy] = React.useState(false);
  const register = async () => {
    if (!regToken.trim()) return;
    setRegBusy(true); setRegMsg('Registering…');
    try { await window.Steward.registerWithRelay(regToken.trim()); setRegMsg('✓ Registered — the relay will accept this church now.'); }
    catch (e) { setRegMsg('✗ ' + (e.message || 'Couldn’t reach the relay.')); }
    setRegBusy(false);
  };
  return (
      <Panel title="Relays" action={!checking ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: allUp ? 'var(--sage)' : 'var(--clay)' }}><span style={{ width: 8, height: 8, borderRadius: 999, background: allUp ? 'var(--sage)' : 'var(--clay)' }} /> {online}/{status.length} online</span> : null}>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>Where your church publishes. It hosts its own relay; add public relays for redundancy in case yours is ever offline.</div>
        {checking ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '8px 2px' }}>Checking relays…</div> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {status.map(r => {
            const self = host && r.url.includes(host);
            const up = r.status === 'on';
            return (
              <div key={r.url} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface)', color: up ? 'var(--sage)' : 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="globe" size={18} color="currentColor" /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{self ? 'Your relay · self-hosted' : 'Shared relay'}{up && r.ms != null ? ` · ${r.ms}ms` : ''}</div>
                </div>
                {self ? <SkPill tint="clay">Self-hosted</SkPill> : <SkPill tint="ink">Shared</SkPill>}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: up ? 'var(--sage)' : 'var(--clay)' }}><span style={{ width: 8, height: 8, borderRadius: 999, background: up ? 'var(--sage)' : 'var(--clay)' }} /> {up ? 'Live' : 'Offline'}</span>
                {!self && r.url !== own ? <button onClick={() => window.Steward.removeRelay(r.url)} title="Remove relay" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="trash" size={15} color="currentColor" /></button> : null}
              </div>
            );
          })}
        </div>
        {/* add a public relay (redundancy) */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 9 }}>
            <input value={draft} onChange={e => { setDraft(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') addRelay(); }}
              placeholder="nos.lol  ·  relay.damus.io  ·  wss://relay.example.com" spellCheck={false} autoCapitalize="none"
              style={{ flex: 1, height: 42, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink)', outline: 'none' }} />
            <button onClick={addRelay} className="sk-btn sk-btn--clay" style={{ padding: '0 16px', fontSize: 13 }}><Icon name="plus" size={15} color="#fff" /> Add relay</button>
          </div>
          {err ? <div style={{ fontSize: 12, color: 'var(--clay-ink)', marginTop: 7 }}>{err}</div> : null}
        </div>
        {/* register this church with the relay's write policy — fixes "Changes weren't saved: different church" */}
        <div style={{ marginTop: 12 }}>
          {!regOpen ? (
            <button onClick={() => setRegOpen(true)} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="key" size={15} color="currentColor" /> Register this church with the relay</button>
          ) : (
            <div style={{ padding: 13, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 9 }}>If the relay rejects your changes (“set up for a different church”), add this church to its allow-list. Paste the relay’s <b>admin token</b> (installer output, or <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>journalctl -u trinityone-relay | grep "admin token"</span>).</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={regToken} onChange={e => setRegToken(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') register(); }} type="password" placeholder="relay admin token" autoComplete="off" style={{ flex: 1, height: 42, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 13, color: 'var(--ink)', outline: 'none' }} />
                <button onClick={register} disabled={regBusy || !regToken.trim()} className="sk-btn sk-btn--clay" style={{ padding: '0 16px', fontSize: 13, whiteSpace: 'nowrap', opacity: (regBusy || !regToken.trim()) ? .5 : 1 }}>Register</button>
              </div>
              {regMsg ? <div style={{ fontSize: 12.5, marginTop: 8, fontWeight: 600, color: regMsg[0] === '✓' ? 'var(--sage)' : regMsg[0] === '✗' ? 'var(--clay)' : 'var(--ink-3)' }}>{regMsg}</div> : null}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 9, marginTop: 16, padding: 13, borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 24%, transparent)' }}>
          <Icon name="shield" size={17} color="var(--sage)" style={{ flexShrink: 0 }} /><div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>Your church hosts its own relay — every message, group, and member lives on infrastructure you control. Members reach it wherever you serve the app.</div>
        </div>
      </Panel>
  );
}


function ago(ts) {
  if (!ts) return '';
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 90) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 14) return Math.floor(s / 86400) + 'd ago';
  return new Date(ts * 1000).toLocaleDateString();
}

function NewPlanModal({ onClose }) {
  const [name, setName] = React.useState('');
  const [tag, setTag] = React.useState('');
  const [text, setText] = React.useState('');
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const create = () => {
    if (!name.trim() || !lines.length) return;
    const days = lines.map((ref, i) => ({ d: i + 1, ref, label: ref }));
    window.Steward.publishPlan({ id: 'custom-' + Date.now().toString(36), title: name.trim(), sub: days.length + ' day' + (days.length === 1 ? '' : 's'), tag: tag.trim() || 'Custom', accent: 'var(--clay)', blurb: '', days });
    onClose();
  };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'rgba(40,32,24,.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 500, maxWidth: '92%', maxHeight: '88%', overflowY: 'auto', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 28 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>Create a reading plan</div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 18px' }}>Your own plan — a sermon series, a season's readings, anything. One reading per line; each line is a day.</p>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Name</div>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. Advent — Light Has Come" style={{ width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '0 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }} />
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Tag (optional)</div>
        <input value={tag} onChange={e => setTag(e.target.value)} placeholder="e.g. Advent" style={{ width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '0 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }} />
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Readings — one per line {lines.length ? `· ${lines.length} day${lines.length === 1 ? '' : 's'}` : ''}</div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={7} placeholder={'John 1\nJohn 2\nIsaiah 53\nPsalm 22'} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '12px 14px', fontSize: 14.5, fontFamily: 'var(--mono)', color: 'var(--ink)', outline: 'none', resize: 'vertical', lineHeight: 1.6 }} />
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12, fontSize: 14 }}>Cancel</button>
          <button onClick={create} disabled={!name.trim() || !lines.length} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 12, fontSize: 14, opacity: (!name.trim() || !lines.length) ? 0.55 : 1 }}><Icon name="check" size={16} color="#fff" /> Create &amp; share</button>
        </div>
      </div>
    </div>
  );
}

function DashPlans() {
  const shared = window.useStewardPlans();          // plans currently shared with the church
  const [creating, setCreating] = React.useState(false);
  const sharedIds = new Set(shared.map(p => p.id));
  const library = (window.SK && window.SK.planLibrary) || [];
  const available = library.filter(p => !sharedIds.has(p.id));
  const PlanRow = ({ p, isShared }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface)', color: p.accent || 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="read" size={19} color="currentColor" /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{p.title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{p.sub || (p.days ? p.days.length + ' days' : '')}{p.tag ? ' · ' + p.tag : ''}</div>
      </div>
      {isShared
        ? <button onClick={() => window.Steward.removePlan(p.id)} className="sk-btn sk-btn--ghost" style={{ padding: '7px 12px', fontSize: 12.5 }}>Unshare</button>
        : <button onClick={() => window.Steward.publishPlan(p)} className="sk-btn sk-btn--clay" style={{ padding: '7px 12px', fontSize: 12.5 }}><Icon name="send" size={14} color="#fff" /> Share</button>}
    </div>
  );
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {creating ? <NewPlanModal onClose={() => setCreating(false)} /> : null}
      <Panel title={`Shared with your church${shared.length ? ` · ${shared.length}` : ''}`}
        action={<button onClick={() => setCreating(true)} className="sk-btn sk-btn--clay" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="plus" size={15} color="#fff" /> New plan</button>}>
        {shared.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '6px 2px' }}>No plans shared yet — make your own with “New plan”, or pick one from the library below.</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{shared.map(p => <PlanRow key={p.id} p={p} isShared />)}</div>}
      </Panel>
      <Panel scroll title="Plan library" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 14 }}>Share a reading plan and the whole church sees it in their app — members start it and track their own progress.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {available.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Every plan is shared.</div> : available.map(p => <PlanRow key={p.id} p={p} />)}
        </div>
      </Panel>
    </div>
  );
}
window.DashPlans = DashPlans;

// Upload OR edit a devotional — a reflection on a passage as a text (.txt) or Markdown (.md) file.
// Passing `editing` (an existing devo) pre-fills it and re-publishes under the same id; the file is
// optional when editing (title/passage can change without re-uploading the text).
function NewDevotionalModal({ onClose, editing }) {
  const [title, setTitle] = React.useState(editing ? editing.title || '' : '');
  const [ref, setRef] = React.useState(editing ? editing.ref || '' : '');
  const [file, setFile] = React.useState(null);   // { type, name, text? } — a NEW replacement file
  const [busy, setBusy] = React.useState(false);
  const pick = (f) => {
    if (!f) return;
    const isText = /\.(txt|md|markdown)$/i.test(f.name) || /^text\//i.test(f.type) || f.type === '';
    if (!isText) { setFile({ error: 'Only .txt or .md files — please pick a text file.' }); return; }
    if (f.size > 2 * 1024 * 1024) { setFile({ error: 'File is over 2 MB — please use a smaller text file.' }); return; }
    const isMd = /\.(md|markdown)$/i.test(f.name);
    const r = new FileReader();
    r.onload = () => setFile({ type: isMd ? 'md' : 'txt', name: f.name, text: r.result });
    r.readAsText(f);
    if (!title.trim()) setTitle(f.name.replace(/\.(txt|md|markdown)$/i, ''));
  };
  const canSave = title.trim() && (file ? !file.error : !!editing) && !busy;   // new needs a file; edit can reuse the old text
  const create = () => {
    if (!canSave) return;
    setBusy(true);
    const text = file ? file.text : (editing ? editing.text : '');
    const type = file ? file.type : (editing ? editing.type : 'txt');
    Promise.resolve(window.Steward.publishDevotional({ id: editing ? editing.id : undefined, title: title.trim(), ref: ref.trim(), type, text: text || '' })).then(() => onClose());
  };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'rgba(40,32,24,.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: '92%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 28 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>{editing ? 'Edit devotional' : 'Upload a devotional'}</div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 18px' }}>{editing ? 'Update the title or passage, or replace the text file. Members see the change in their app.' : 'A reflection on a passage, as a text (.txt) or Markdown (.md) file. Your congregation reads it in their app.'}</p>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Title</div>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Resting in Psalm 23" style={{ width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '0 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }} />
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Passage (optional)</div>
        <input value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. Psalm 23" style={{ width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '0 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 16px', borderRadius: 13, border: '1px dashed var(--line)', background: 'var(--surface-2)', cursor: 'pointer' }}>
          <Icon name="read" size={20} color="var(--clay)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: file && !file.error ? 'var(--ink)' : 'var(--ink-2)' }}>{file && file.name ? file.name : (editing ? 'Replace the text file (optional)' : 'Choose a .txt or .md file')}</div>
            <div style={{ fontSize: 12, color: file && file.error ? 'var(--clay)' : 'var(--ink-3)' }}>{file && file.error ? file.error : (file && file.type ? file.type.toUpperCase() + ' ready' : (editing ? 'Keeping the current text unless you pick a new file' : 'Tap to pick a file'))}</div>
          </div>
          <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={e => pick(e.target.files && e.target.files[0])} style={{ display: 'none' }} />
        </label>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12, fontSize: 14 }}>Cancel</button>
          <button onClick={create} disabled={!canSave} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 12, fontSize: 14, opacity: canSave ? 1 : 0.55 }}><Icon name={editing ? 'check' : 'send'} size={16} color="#fff" /> {busy ? 'Saving…' : (editing ? 'Save changes' : 'Share devotional')}</button>
        </div>
      </div>
    </div>
  );
}

function DashDevotionals() {
  const devos = window.useStewardDevotionals();
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [order, setOrder] = React.useState(null);   // local working order while dragging (array of devos)
  const [dragId, setDragId] = React.useState(null);
  const [overId, setOverId] = React.useState(null);
  // the list to show: the live order, unless we're mid-drag with a local working order
  const list = order || devos;
  // persist a new order: number each devotional by position, re-publish only the ones that changed
  const persist = (arr) => { arr.forEach((d, i) => { if (d.order !== i) window.Steward.publishDevotional({ id: d.id, title: d.title, ref: d.ref, type: d.type, text: d.text, order: i }); }); };
  // sort the list and bake it into the saved order (so the member app shows the same). "number" is a
  // numeric-aware title sort, so "Day 2" comes before "Day 10".
  // pull the SERIES number from a title ("Series 3", "Series #3", "Series03"); fall back to a leading
  // "#3", then the first number anywhere.
  const numIn = (s) => { s = String(s || ''); const m = s.match(/series\s*#?\s*(\d+)/i) || s.match(/#\s*(\d+)/) || s.match(/(\d+)/); return m ? parseInt(m[1], 10) : Infinity; };
  const seriesOf = (d) => numIn((d.ref || '') + ' ' + (d.title || ''));   // "Series N" lives in ref (or title)
  const applySort = (mode) => {
    const arr = devos.slice();
    if (mode === 'number') arr.sort((a, b) => seriesOf(a) - seriesOf(b) || String(a.title || '').localeCompare(String(b.title || ''), undefined, { numeric: true }));
    else if (mode === 'title') arr.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { numeric: true }));
    else if (mode === 'newest') arr.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    persist(arr);
  };
  // arrow fallback (accessibility): swap with a neighbour
  const move = (idx, dir) => { const arr = devos.slice(); const j = idx + dir; if (j < 0 || j >= arr.length) return; const t = arr[idx]; arr[idx] = arr[j]; arr[j] = t; persist(arr); };
  // drag: reorder the working copy live; commit on drop
  const onDragOver = (e, id) => {
    e.preventDefault();
    if (!dragId || id === dragId) return;
    const arr = (order || devos).slice();
    const from = arr.findIndex(x => x.id === dragId), to = arr.findIndex(x => x.id === id);
    if (from < 0 || to < 0) return;
    const [m] = arr.splice(from, 1); arr.splice(to, 0, m);
    setOrder(arr); setOverId(id);
  };
  const onDrop = () => { if (order) persist(order); setDragId(null); setOverId(null); setOrder(null); };
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      {adding ? <NewDevotionalModal onClose={() => setAdding(false)} /> : null}
      {editing ? <NewDevotionalModal editing={editing} onClose={() => setEditing(null)} /> : null}
      <Panel scroll title={`Devotionals${devos.length ? ` · ${devos.length}` : ''}`}
        action={<div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => window.TrinityTemplates.openDevoTemplate()} className="sk-btn sk-btn--ghost" style={{ padding: '8px 12px', fontSize: 13 }} title="The writing template + house style for a devotional series"><Icon name="receipt" size={15} color="currentColor" /> Template</button>
          <button onClick={() => setAdding(true)} className="sk-btn sk-btn--clay" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="plus" size={15} color="#fff" /> Upload devotional</button>
        </div>} style={{ height: '100%' }}>
        {devos.length === 0 ? (
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, padding: '6px 2px' }}>No devotionals yet. Upload a .txt or .md reflection on a passage — your congregation reads it in their app.</div>
        ) : (
          <React.Fragment>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 2px 10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="dots" size={13} color="var(--ink-3)" /> Drag to reorder, or sort:</span>
            {[['number', 'By series #'], ['title', 'A→Z'], ['newest', 'Newest']].map(([m, lbl]) => (
              <button key={m} onClick={() => applySort(m)} title="Sets the order your members see" style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', borderRadius: 8, padding: '4px 9px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>{lbl}</button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {list.map((d, i) => {
              const dragging = dragId === d.id;
              return (
              <div key={d.id} draggable
                onDragStart={(e) => { setDragId(d.id); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', d.id); } catch (err) {} }}
                onDragOver={(e) => onDragOver(e, d.id)} onDrop={onDrop} onDragEnd={() => { setDragId(null); setOverId(null); setOrder(null); }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid ' + (overId === d.id && !dragging ? 'var(--clay)' : 'var(--line)'), opacity: dragging ? 0.4 : 1, boxShadow: dragging ? 'var(--shadow-lg)' : 'none', transition: 'border-color .12s, opacity .12s' }}>
                <div title="Drag to reorder" style={{ cursor: 'grab', color: 'var(--ink-3)', display: 'flex', flexShrink: 0, touchAction: 'none' }}><Icon name="dots" size={18} color="currentColor" /></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
                  <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 7, padding: '0 4px', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.35 : 1, color: 'var(--ink-2)', display: 'flex' }}><Icon name="chevU" size={13} color="currentColor" /></button>
                  <button onClick={() => move(i, 1)} disabled={i === devos.length - 1} title="Move down" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 7, padding: '0 4px', cursor: i === devos.length - 1 ? 'default' : 'pointer', opacity: i === devos.length - 1 ? 0.35 : 1, color: 'var(--ink-2)', display: 'flex' }}><Icon name="chevD" size={13} color="currentColor" /></button>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface)', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="read" size={19} color="currentColor" /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{d.title}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{[d.ref, (d.type || '').toUpperCase()].filter(Boolean).join(' · ')}</div>
                </div>
                <button onClick={() => setEditing(d)} title="Edit" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 9px', cursor: 'pointer', color: 'var(--clay)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}><Icon name="pen" size={14} color="currentColor" /> Edit</button>
                <button onClick={() => window.Steward.removeDevotional(d.id)} title="Remove" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 7px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="trash" size={15} color="currentColor" /></button>
              </div>
              );
            })}
          </div>
          </React.Fragment>
        )}
      </Panel>
    </div>
  );
}

// Bulk-upload resources: drop a set of .md/.txt files and publish them all at once — each file becomes
// a devotional (Markdown body) or a reading plan (one Bible reference per line).
function BulkUploadModal({ kind, onClose }) {
  const isPlans = kind === 'plans';
  const [items, setItems] = React.useState([]);   // [{ name, title, text?, ref?, days?, count?, error? }]
  const [drag, setDrag] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(0);
  const [rejected, setRejected] = React.useState([]);   // names of non-text files we couldn't read
  const inputRef = React.useRef(null);

  const parse = (name, raw) => {
    const baseTitle = name.replace(/\.(txt|md|markdown)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Untitled';
    if (isPlans) {
      let lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
      let title = baseTitle;
      if (lines[0] && /^#+\s+/.test(lines[0])) { title = lines[0].replace(/^#+\s*/, '').trim() || baseTitle; lines = lines.slice(1); }
      const days = lines.map((ref, i) => ({ d: i + 1, ref, label: ref }));
      return { name, title, count: days.length, days, error: days.length ? '' : 'no readings' };
    }
    const h = raw.match(/^\s*#\s+(.+)$/m);
    const rf = raw.match(/\b(?:[1-3]\s?)?[A-Z][a-z]+\s+\d+(?::\d+(?:-\d+)?)?\b/);
    const text = raw.trim();
    return { name, title: (h ? h[1].trim() : baseTitle), ref: rf ? rf[0].trim() : '', text, error: text ? '' : 'empty file' };
  };
  const addFiles = (list) => {
    const all = [...list];
    const files = all.filter(f => /\.(txt|md|markdown)$/i.test(f.name)).slice(0, 200);
    const bad = all.filter(f => !/\.(txt|md|markdown)$/i.test(f.name)).map(f => f.name);
    setRejected(bad);
    if (!files.length) return;
    Promise.all(files.map(f => new Promise(res => { const r = new FileReader(); r.onload = () => res(parse(f.name, String(r.result || ''))); r.onerror = () => res({ name: f.name, title: f.name, error: 'unreadable' }); r.readAsText(f); })))
      .then(parsed => setItems(prev => { const seen = new Set(prev.map(p => p.name)); return [...prev, ...parsed.filter(p => !seen.has(p.name))]; }));
  };
  const valid = items.filter(it => !it.error);
  const publishAll = async () => {
    setBusy(true); setDone(0);
    for (let i = 0; i < valid.length; i++) {
      const it = valid[i];
      try {
        if (isPlans) await Promise.resolve(window.Steward.publishPlan({ id: 'bulk-' + Date.now().toString(36) + i, title: it.title, sub: it.count + ' day' + (it.count === 1 ? '' : 's'), tag: 'Custom', accent: 'var(--clay)', blurb: '', days: it.days }));
        else await Promise.resolve(window.Steward.publishDevotional({ title: it.title, ref: it.ref || '', type: 'txt', text: it.text }));
      } catch (e) {}
      setDone(d => d + 1);
    }
    setBusy(false); setTimeout(onClose, 650);
  };
  const fld = { display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', marginBottom: 8 };
  return (
    <div onClick={() => !busy && onClose()} style={{ position: 'absolute', inset: 0, zIndex: 96, background: 'rgba(40,32,24,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 560, maxWidth: '96%', maxHeight: '90%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', animation: 'lumenScale .2s ease both' }}>
        <div style={{ padding: '24px 26px 0' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>Bulk upload {isPlans ? 'reading plans' : 'devotionals'}</div>
          <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 16px' }}>{isPlans ? 'Drop one or more text files — each file becomes a plan, with one Bible reference per line (a “# Title” first line is used as the name).' : 'Drop one or more Markdown / text files — each becomes a devotional. The first “# Heading” (or the filename) is the title.'}</p>
        </div>
        <div style={{ padding: '0 26px' }}>
          <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }} onClick={() => inputRef.current && inputRef.current.click()}
            style={{ border: '2px dashed ' + (drag ? 'var(--clay)' : 'var(--line)'), borderRadius: 16, background: drag ? 'color-mix(in oklab, var(--clay) 7%, var(--surface))' : 'var(--surface-2)', padding: '24px 18px', textAlign: 'center', cursor: 'pointer', transition: 'all .15s' }}>
            <Icon name="share" size={26} color="var(--ink-3)" />
            <div style={{ fontWeight: 700, fontSize: 14.5, marginTop: 8 }}>Drop files here, or click to choose</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 3 }}>.md · .markdown · .txt</div>
            <input ref={inputRef} type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" multiple onChange={e => { addFiles(e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />
          </div>
          {rejected.length ? (
            <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 10, padding: '10px 12px', borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 8%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 28%, var(--line))' }}>
              <Icon name="info" size={16} color="var(--clay)" />
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                <b style={{ color: 'var(--ink)' }}>{rejected.length} file{rejected.length === 1 ? '' : 's'} skipped</b> — only plain-text <b>.txt</b>, <b>.md</b> or <b>.markdown</b> files work here. Word/PDF documents can’t be read. {rejected.slice(0, 3).join(', ')}{rejected.length > 3 ? ` +${rejected.length - 3} more` : ''}
              </div>
            </div>
          ) : null}
        </div>
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: items.length ? '14px 26px 4px' : 0 }}>
          {items.map((it, i) => (
            <div key={i} style={{ ...fld, border: '1px solid ' + (it.error ? 'color-mix(in oklab, var(--clay) 30%, var(--line))' : 'var(--line)') }}>
              <Icon name={it.error ? 'x' : (isPlans ? 'read' : 'receipt')} size={17} color={it.error ? 'var(--clay)' : 'var(--clay)'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</div>
                <div style={{ fontSize: 11.5, color: it.error ? 'var(--clay)' : 'var(--ink-3)' }}>{it.error ? it.error : (isPlans ? it.count + ' readings' : ((it.ref ? it.ref + ' · ' : '') + it.text.length + ' chars'))} · {it.name}</div>
              </div>
              {!busy ? <button onClick={() => setItems(items.filter((_, x) => x !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="x" size={15} /></button> : null}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 26px 20px', borderTop: '1px solid var(--line)' }}>
          <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-3)' }}>{busy ? `Publishing… ${done}/${valid.length}` : (valid.length ? `${valid.length} ready${items.length - valid.length ? ` · ${items.length - valid.length} skipped` : ''}` : 'No files yet')}</div>
          <button onClick={onClose} disabled={busy} className="sk-btn sk-btn--ghost" style={{ padding: '10px 16px', fontSize: 13.5, opacity: busy ? .5 : 1 }}>Cancel</button>
          <button onClick={publishAll} disabled={busy || !valid.length} className="sk-btn sk-btn--clay" style={{ padding: '10px 18px', fontSize: 13.5, opacity: (busy || !valid.length) ? .5 : 1 }}><Icon name="send" size={15} color="#fff" /> Publish {valid.length || ''}</button>
        </div>
      </div>
    </div>
  );
}

function DashResources() {
  const [view, setView] = React.useState('plans');   // plans | devotionals
  const [bulk, setBulk] = React.useState(false);
  const seg = { display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' };
  const btn = (k, label) => (
    <button onClick={() => setView(k)} style={{ padding: '8px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5, background: view === k ? 'var(--surface)' : 'transparent', color: view === k ? 'var(--clay)' : 'var(--ink-2)', boxShadow: view === k ? 'var(--shadow-sm)' : 'none' }}>{label}</button>
  );
  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {bulk ? <BulkUploadModal kind={view} onClose={() => setBulk(false)} /> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={seg}>{btn('plans', 'Reading plans')}{btn('devotionals', 'Devotionals')}</div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setBulk(true)} className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="share" size={15} color="currentColor" /> Bulk upload</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>{view === 'plans' ? <DashPlans /> : <DashDevotionals />}</div>
    </div>
  );
}
window.DashResources = DashResources;

function DashMembers() {
  const members = window.useStewardMembers();   // real members: joined (presence) and/or active (posts)
  const blockedList = window.useStewardBlocked ? window.useStewardBlocked() : [];
  const blockedSet = new Set(blockedList);
  const [copied, setCopied] = React.useState('');
  const [showInactive, setShowInactive] = React.useState(false);
  const [showBlocked, setShowBlocked] = React.useState(false);
  const [confirmBlock, setConfirmBlock] = React.useState(null);
  const doCopy = (np) => { copyText(np); setCopied(np); setTimeout(() => setCopied(''), 1400); };
  const block = (pk) => { setConfirmBlock(null); window.Steward.setBlocked([...blockedList, pk]); };
  const unblock = (pk) => window.Steward.setBlocked(blockedList.filter(p => p !== pk));
  const total = members.length;
  // "last seen" = newest of a post or a membership heartbeat. No activity in 90 days → inactive list.
  const INACTIVE_DAYS = 90;
  const cutoff = Math.floor(Date.now() / 1000) - INACTIVE_DAYS * 86400;
  const seen = (m) => Math.max(m.lastTs || 0, m.joined || 0);
  const activeM = members.filter(m => seen(m) >= cutoff && !blockedSet.has(m.pubkey));
  const inactiveM = members.filter(m => seen(m) < cutoff && !blockedSet.has(m.pubkey));
  const chatting = activeM.filter(m => m.count > 0).length;
  const memberRow = (m, inactive) => {
    const named = !!m.name;
    const label = named ? m.name : 'Anonymous';
    const initials = (named ? m.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'AN').toUpperCase();
    return (
      <div key={m.pubkey} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)', opacity: inactive ? 0.62 : 1 }}>
        <SkBadge initials={initials} size={36} radius={11} accent={SK_TINT[named ? 'gold' : 'sage'].fg} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontWeight: 700, fontSize: 14.5 }}>{label}</span>
            {m.nip05
              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: 'var(--sage)', fontWeight: 700 }} title={m.nip05}>@{String(m.nip05).split('@')[0]} <Icon name="check" size={11} stroke={3} color="var(--sage)" /></span>
              : <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-3)' }} title={m.npub}>{shortNpub(m.npub)}</span>}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{m.count > 0 ? `${m.count} message${m.count === 1 ? '' : 's'} · last ${ago(m.lastTs)}` : `joined ${ago(m.joined)} · hasn’t posted yet`}</div>
        </div>
        {inactive ? <SkPill tint="ink">inactive</SkPill> : (m.count === 0 ? <SkPill tint="ink">joined</SkPill> : null)}
        {!named ? <SkPill tint="sage">anonymous</SkPill> : null}
        <button onClick={() => window.dispatchEvent(new CustomEvent('steward-open-dm', { detail: { pubkey: m.pubkey, npub: m.npub, name: label } }))} title="Message privately" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 10px', cursor: 'pointer', color: 'var(--clay)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}>
          <Icon name="chat" size={15} color="currentColor" /> Chat</button>
        <button onClick={() => doCopy(m.npub)} title="Copy npub" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', fontFamily: 'var(--font-ui)' }}>
          <Icon name={copied === m.npub ? 'check' : 'link'} size={15} color={copied === m.npub ? 'var(--sage)' : 'currentColor'} /></button>
        {confirmBlock === m.pubkey
          ? <span style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => block(m.pubkey)} title="Confirm — bans them from posting & hides their messages" style={{ border: 'none', background: 'var(--clay)', color: '#fff', borderRadius: 9, padding: '6px 9px', cursor: 'pointer', display: 'flex', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}>Confirm block</button>
              <button onClick={() => setConfirmBlock(null)} title="Cancel" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', fontFamily: 'var(--font-ui)' }}><Icon name="x" size={15} color="currentColor" /></button>
            </span>
          : <button onClick={() => setConfirmBlock(m.pubkey)} title="Remove / block this member" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', fontFamily: 'var(--font-ui)' }}><Icon name="shield" size={15} color="currentColor" /></button>}
      </div>
    );
  };
  return (
    <Panel title="Members" action={<SkPill tint="sage">{total ? `${activeM.length} active${chatting ? ` · ${chatting} chatting` : ''}` : 'none yet'}</SkPill>} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {total === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--ink-3)', padding: 24 }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}><Icon name="pray" size={26} color="var(--ink-3)" /></div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-2)' }}>No members yet.</div>
          <p style={{ fontSize: 13, margin: '6px 0 0', maxWidth: 320, lineHeight: 1.5 }}>Share your invite code — people appear here the moment they join, whether or not they’ve posted.</p>
        </div>
      ) : (
        <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {activeM.map(m => memberRow(m, false))}
          {activeM.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '8px 2px' }}>No active members in the last {INACTIVE_DAYS} days.</div> : null}
          {inactiveM.length ? (
            <React.Fragment>
              <button onClick={() => setShowInactive(s => !s)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 12px', borderRadius: 11, border: '1px dashed var(--line)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, marginTop: 4 }}>
                <Icon name={showInactive ? 'chevU' : 'chevD'} size={15} color="currentColor" /> {showInactive ? 'Hide' : 'See'} inactive · {inactiveM.length} (no activity in {INACTIVE_DAYS} days)
              </button>
              {showInactive ? inactiveM.map(m => memberRow(m, true)) : null}
            </React.Fragment>
          ) : null}
          {blockedList.length ? (
            <React.Fragment>
              <button onClick={() => setShowBlocked(s => !s)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 12px', borderRadius: 11, border: '1px dashed color-mix(in oklab, var(--clay) 30%, var(--line))', background: 'var(--surface)', cursor: 'pointer', color: 'var(--clay)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, marginTop: 4 }}>
                <Icon name={showBlocked ? 'chevU' : 'chevD'} size={15} color="currentColor" /> {showBlocked ? 'Hide' : 'See'} blocked · {blockedList.length}
              </button>
              {showBlocked ? blockedList.map(pk => (
                <div key={pk} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid color-mix(in oklab, var(--clay) 22%, var(--line))', opacity: 0.85 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 11, background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="shield" size={18} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Blocked member</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-3)' }}>{String(pk).slice(0, 12)}…</div>
                  </div>
                  <button onClick={() => unblock(pk)} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 11px', cursor: 'pointer', color: 'var(--sage)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}>Unblock</button>
                </div>
              )) : null}
            </React.Fragment>
          ) : null}
        </div>
      )}
      <div style={{ display: 'flex', gap: 9, marginTop: 16, padding: 13, borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 24%, transparent)', flexShrink: 0 }}>
        <Icon name="shield" size={17} color="var(--sage)" style={{ flexShrink: 0 }} /><div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>Anonymous by design — you see who’s <b style={{ color: 'var(--ink)' }}>joined</b> and who’s active, never anyone’s real-world identity unless they chose a name. No giving is ever shown here.</div>
      </div>
    </Panel>
  );
}
window.DashMembers = DashMembers;

// full backup dialog: what's included + a passphrase OR PIN + download the encrypted file
function StewBackupModal({ church, onClose }) {
  const [pass, setPass] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [done, setDone] = React.useState(false);
  const secure = (typeof window !== 'undefined') && window.isSecureContext && (typeof crypto !== 'undefined') && crypto.subtle;
  const strength = pass.length === 0 ? null
    : pass.length < 4 ? { t: 'Too short', c: 'var(--ink-3)' }
    : /^\d+$/.test(pass) && pass.length < 6 ? { t: 'PIN — easy to use, easier to guess', c: 'var(--clay)' }
    : pass.length < 8 ? { t: 'OK', c: 'var(--gold)' }
    : { t: 'Strong', c: 'var(--sage)' };
  const make = async () => {
    if (pass.length < 4) { setErr('Use at least 4 characters (a numeric PIN is fine).'); return; }
    setBusy(true); setErr('');
    try {
      const obj = window.TrinityBackup.collectSteward();
      const text = await window.TrinityBackup.encryptObj(obj, pass);
      await window.TrinityBackup.saveFile('trinityone-' + ((church.name || 'church').toLowerCase().replace(/[^a-z0-9]+/g, '-')) + '-' + new Date().toISOString().slice(0, 10) + '.json', text);
      setDone(true); setTimeout(onClose, 1300);
    } catch (e) { setErr('Backup failed: ' + (e.message || e)); setBusy(false); }
  };
  const incl = [
    ['key', 'Your church recovery key', 'The one irreplaceable thing — restores the church anywhere'],
    ['chat', 'Console settings', 'Relays, video channel, preferences'],
    ['globe', 'Your groups, rota & members', 'Live on the relay — they return when you restore the key'],
  ];
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 95, background: 'rgba(40,32,24,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 470, maxWidth: '94%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26, maxHeight: '92%', overflowY: 'auto', animation: 'lumenScale .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="lock" size={21} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21 }}>Back up your church</div>
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 18px' }}>One encrypted file you can keep safe (cloud drive, USB stick). You’ll need your passphrase or PIN to restore it.</p>
        {!secure ? (
          <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 28%, transparent)', marginBottom: 16 }}>
            <Icon name="lock" size={17} color="var(--clay)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>You’re on an <b>http</b> address, where the browser disables encryption. Open the console over <b>https</b> (your church’s Tailscale link) to create a backup.</div>
          </div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 18 }}>
          {incl.map(([ic, t, s]) => (
            <div key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--surface)', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={ic} size={16} /></div>
              <div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{t}</div><div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.4 }}>{s}</div></div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>Passphrase or PIN</div>
        <div style={{ display: 'flex', gap: 9 }}>
          <input value={pass} onChange={e => { setPass(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') make(); }} type={show ? 'text' : 'password'} autoFocus inputMode="text" placeholder="a memorable passphrase, or a PIN" style={{ flex: 1, height: 46, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
          <button onClick={() => setShow(s => !s)} className="sk-btn sk-btn--ghost" style={{ padding: '0 14px' }}>{show ? 'Hide' : 'Show'}</button>
        </div>
        {strength ? <div style={{ fontSize: 12, color: strength.c, fontWeight: 600, marginTop: 7 }}>{strength.t}{strength.c === 'var(--clay)' ? ' · longer is safer' : ''}</div> : null}
        {err ? <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', marginTop: 7 }}>{err}</div> : null}
        <div style={{ display: 'flex', gap: 9, padding: '11px 12px', borderRadius: 12, background: 'color-mix(in oklab, var(--gold) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 26%, transparent)', margin: '16px 0 18px' }}>
          <Icon name="shield" size={16} color="#8a6717" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>If you forget this, the backup can’t be opened — not even by us. Store it with the file.</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 13, fontSize: 14 }}>Cancel</button>
          <button onClick={make} disabled={busy || done || pass.length < 4 || !secure} className="sk-btn sk-btn--clay" style={{ flex: 2, padding: 13, fontSize: 14, opacity: (busy || pass.length < 4 || !secure) ? 0.6 : 1 }}>
            <Icon name={done ? 'check' : 'share'} size={15} color="#fff" /> {done ? 'Saved' : busy ? 'Encrypting…' : 'Download encrypted backup'}</button>
        </div>
      </div>
    </div>
  );
}

// a single joined-network row that resolves its name from the network's profile
function NetworkRow({ net, onLeave }) {
  const [name, setName] = React.useState('');
  React.useEffect(() => window.Steward.subscribeNetworkProfile(net.networkPub, (p) => { if (p && p.name) setName(p.name); }), [net.networkPub]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface)', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="globe" size={18} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: name ? 'var(--ink)' : 'var(--ink-3)' }}>{name || 'Resolving…'}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{net.npub.slice(0, 22)}…</div>
      </div>
      <button onClick={() => onLeave(net)} className="sk-btn sk-btn--ghost" style={{ padding: '6px 11px', fontSize: 12.5 }}>Leave</button>
    </div>
  );
}

// the wider network this church belongs to (one for now). A network is its own npub.
// compose & broadcast an announcement AS a network this console owns (the key lives here)
function NetworkAnnounceComposer() {
  const [owned, setOwned] = React.useState(() => (window.Steward.ownedNetworks ? window.Steward.ownedNetworks() : []));
  const [text, setText] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [posts, setPosts] = React.useState([]);
  React.useEffect(() => {
    const refresh = () => setOwned(window.Steward.ownedNetworks ? window.Steward.ownedNetworks() : []);
    window.addEventListener('steward-networks', refresh);
    return () => window.removeEventListener('steward-networks', refresh);
  }, []);
  const net = owned[0] || null;           // one owned network for now
  const [liveName, setLiveName] = React.useState('');
  React.useEffect(() => { if (!net || !window.Steward.subscribeNetworkAnnouncements) return; return window.Steward.subscribeNetworkAnnouncements(net.pub, setPosts); }, [net && net.pub]);
  React.useEffect(() => { setLiveName(''); if (!net || !window.Steward.subscribeNetworkProfile) return; return window.Steward.subscribeNetworkProfile(net.pub, (p) => { if (p && p.name) setLiveName(p.name); }); }, [net && net.pub]);
  if (!net) return null;
  const post = async () => {
    if (!text.trim()) return;
    await window.Steward.publishNetworkAnnouncement(net.pub, text.trim());
    setText(''); setSent(true); setTimeout(() => setSent(false), 1600);
  };
  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Icon name="globe" size={16} color="var(--clay)" />
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>Announce to <b>{liveName || net.name}</b></div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45, marginBottom: 9 }}>Reaches every member of every church in the network.</div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Share news with the whole network…" style={{ width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', padding: '11px 13px', fontSize: 14, lineHeight: 1.5, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', resize: 'vertical', marginBottom: 9 }} />
      <button onClick={post} disabled={!text.trim()} className="sk-btn sk-btn--clay" style={{ padding: '9px 15px', fontSize: 13.5, opacity: text.trim() ? 1 : 0.55 }}><Icon name={sent ? 'check' : 'send'} size={15} color="#fff" /> {sent ? 'Sent' : 'Post announcement'}</button>
      {posts.length ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>Recent</div>
          {posts.slice(0, 4).map(p => (
            <div key={p.id} style={{ padding: '10px 12px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 7 }}>
              <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{p.text}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DashNetworksPanel() {
  const networks = window.useStewardNetworks();
  const net = networks[0] || null;        // a church belongs to one network for now
  const [draft, setDraft] = React.useState('');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [created, setCreated] = React.useState(null);   // { npub, mnemonic } just-created — show to save
  const [naming, setNaming] = React.useState(false);    // the create-network wizard
  const [newName, setNewName] = React.useState('');
  const join = () => { const r = window.Steward.joinNetwork && window.Steward.joinNetwork(draft.trim()); if (!r) { setErr('Paste the network’s code (npub1…).'); return; } Promise.resolve(r).then(() => { setDraft(''); setErr(''); }); };
  const leave = (n) => { if (window.confirm('Leave this network? Your members will stop seeing its shared content.')) window.Steward.leaveNetwork(n.networkPub); };
  const doCreate = async () => {
    if (!newName.trim()) return;
    setBusy(true); setNaming(false);
    try { const r = await window.Steward.createNetwork(newName.trim()); if (r) setCreated(r); } catch (e) { setErr('Couldn’t create the network.'); }
    setBusy(false); setNewName('');
  };
  return (
    <Panel title="Network">
      {naming ? (
        <div onClick={() => setNaming(false)} style={{ position: 'absolute', inset: 0, zIndex: 95, background: 'rgba(40,32,24,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: '94%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26, animation: 'lumenScale .2s ease both' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="globe" size={21} /></div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>Create a network</div>
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 16px' }}>Give it a name your churches will recognise — a region (“Sussex Gospel Partnership”), a family of churches (“Regions Beyond”), or a denomination. You can rename it later from its own console.</p>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>Network name</div>
            <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doCreate(); }} autoFocus placeholder="e.g. Regions Beyond" style={{ width: '100%', height: 46, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 18 }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setNaming(false); setNewName(''); }} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 13, fontSize: 14 }}>Cancel</button>
              <button onClick={doCreate} disabled={!newName.trim()} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 13, fontSize: 14, opacity: newName.trim() ? 1 : 0.55 }}><Icon name="globe" size={15} color="#fff" /> Create</button>
            </div>
          </div>
        </div>
      ) : null}
      {created ? (
        <div style={{ borderRadius: 14, border: '1.5px solid color-mix(in oklab, var(--sage) 40%, var(--line))', background: 'color-mix(in oklab, var(--sage) 7%, var(--surface))', padding: 16, marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Network created 🎉</div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 10px' }}>Save this recovery phrase — it’s the network’s key. Restore it in a console to post network-wide announcements, events and plans. Share the code with other churches so they can join.</p>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 3 }}>NETWORK CODE</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, wordBreak: 'break-all', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 9px', marginBottom: 9 }}>{created.npub}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 3 }}>RECOVERY PHRASE</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.6, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', marginBottom: 10 }}>{created.mnemonic}</div>
          <button onClick={() => setCreated(null)} className="sk-btn sk-btn--clay" style={{ padding: '8px 14px', fontSize: 13 }}>I’ve saved it</button>
        </div>
      ) : null}
      <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>Belong to a wider group of churches — a region, a denomination, or a family of churches. Your members see its shared announcements, events and plans alongside your own.</div>
      {net ? (
        <NetworkRow net={net} onLeave={leave} />
      ) : (
        <React.Fragment>
          <button onClick={() => setNaming(true)} disabled={busy} className="sk-btn sk-btn--clay" style={{ width: '100%', padding: 12, fontSize: 14, marginBottom: 12, opacity: busy ? 0.6 : 1 }}><Icon name="globe" size={16} color="#fff" /> {busy ? 'Creating…' : 'Create a network'}</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-3)', fontSize: 12, fontWeight: 700, margin: '4px 0 12px' }}><div style={{ flex: 1, height: 1, background: 'var(--line)' }} />OR JOIN ONE<div style={{ flex: 1, height: 1, background: 'var(--line)' }} /></div>
          <div style={{ display: 'flex', gap: 9 }}>
            <input value={draft} onChange={e => { setDraft(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') join(); }} spellCheck={false} autoCapitalize="none"
              placeholder="npub1… (a network’s code)" style={{ flex: 1, height: 44, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink)', outline: 'none' }} />
            <button onClick={join} className="sk-btn sk-btn--ghost" style={{ padding: '0 16px', fontSize: 13 }}>Join</button>
          </div>
        </React.Fragment>
      )}
      {err ? <div style={{ fontSize: 12, color: 'var(--clay-ink)', marginTop: 7 }}>{err}</div> : null}
      <NetworkAnnounceComposer />
    </Panel>
  );
}

// church video channel — members' Watch tab auto-fills from this on follow (via the gateway feed proxy)
function DashChannelPanel({ church }) {
  const [draft, setDraft] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => { setDraft(church.channel || ''); }, [church.channel]);
  const save = () => { window.Steward.publishProfile({ channel: draft.trim() }); setSaved(true); setTimeout(() => setSaved(false), 1700); };
  return (
    <Panel title="Video channel">
      <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>Paste your church’s <b>YouTube</b> or <b>Rumble</b> channel. Members who follow you get its videos right inside the app’s Watch tab — kept up to date automatically.</div>
      <div style={{ display: 'flex', gap: 9 }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} spellCheck={false} autoCapitalize="none"
          placeholder="youtube.com/@yourchurch  ·  @yourchurch  ·  rumble.com/c/yourchurch"
          style={{ flex: 1, height: 44, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--ink)', outline: 'none' }} />
        <button onClick={save} className="sk-btn sk-btn--clay" style={{ padding: '0 16px', fontSize: 13 }}><Icon name={saved ? 'check' : 'send'} size={15} color="#fff" /> {saved ? 'Saved' : 'Save'}</button>
      </div>
      {church.channel ? <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>Current: <span style={{ fontFamily: 'var(--mono)' }}>{church.channel}</span></div> : null}
    </Panel>
  );
}

// church audio — a podcast RSS feed whose episodes members stream in the app's Listen tab
function DashAudioPanel({ church }) {
  const [draft, setDraft] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => { setDraft(church.audioFeed || ''); }, [church.audioFeed]);
  const save = () => { window.Steward.publishProfile({ audioFeed: draft.trim() }); setSaved(true); setTimeout(() => setSaved(false), 1700); };
  return (
    <Panel title="Audio / podcast">
      <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>Paste a <b>podcast RSS feed</b> (sermons, audio devotionals). Members who follow you stream its episodes in the app’s <b>Listen</b> tab — most podcast hosts (Spotify for Podcasters, Buzzsprout, Podbean, Apple) give you an RSS link.</div>
      <div style={{ display: 'flex', gap: 9 }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} spellCheck={false} autoCapitalize="none"
          placeholder="https://feeds.yourhost.com/yourchurch.xml"
          style={{ flex: 1, height: 44, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--ink)', outline: 'none' }} />
        <button onClick={save} className="sk-btn sk-btn--clay" style={{ padding: '0 16px', fontSize: 13 }}><Icon name={saved ? 'check' : 'send'} size={15} color="#fff" /> {saved ? 'Saved' : 'Save'}</button>
      </div>
      {church.audioFeed ? <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>Current: <span style={{ fontFamily: 'var(--mono)' }}>{church.audioFeed}</span></div> : null}
    </Panel>
  );
}

// a real dialog for renaming the church (or a network) — replaces window.prompt
function NameEditModal({ current, isNetwork, onSave, onClose }) {
  const [name, setName] = React.useState(current || '');
  const [busy, setBusy] = React.useState(false);
  const label = isNetwork ? 'network' : 'church';
  const save = async () => { if (!name.trim()) return; setBusy(true); await onSave(name.trim()); onClose(); };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 96, background: 'rgba(40,32,24,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: '94%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26, animation: 'lumenScale .2s ease both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={isNetwork ? 'globe' : 'bank'} size={21} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>{current ? `Rename ${label}` : `Name your ${label}`}</div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 16px' }}>This is the name your {isNetwork ? 'churches' : 'members'} see in the app. You can change it anytime.</p>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>{label} name</div>
        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} autoFocus placeholder={isNetwork ? 'e.g. Regions Beyond' : 'e.g. Grace Community Church'} style={{ width: '100%', boxSizing: 'border-box', height: 46, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 18 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 13, fontSize: 14 }}>Cancel</button>
          <button onClick={save} disabled={busy || !name.trim()} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 13, fontSize: 14, opacity: (busy || !name.trim()) ? 0.55 : 1 }}><Icon name="check" size={15} color="#fff" /> {busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function DashSettings({ onTab }) {
  const church = window.useStewardChurch();   // real church name + npub
  const [revealed, setRevealed] = React.useState(false);
  const [phrase, setPhrase] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [editingName, setEditingName] = React.useState(false);
  const saveName = (n) => Promise.resolve(window.Steward.publishProfile({ name: n, nip05: church.nip05 }));
  const reveal = () => { try { setPhrase(window.Steward.exportMnemonic() || ''); } catch {} setRevealed(true); };
  const [restoreOpen, setRestoreOpen] = React.useState(false);
  const [backupOpen, setBackupOpen] = React.useState(false);
  const [restorePhrase, setRestorePhrase] = React.useState('');
  const [restoreErr, setRestoreErr] = React.useState('');
  const doRestore = () => {
    setRestoreErr('');
    try {
      const { npub } = window.Steward.restoreKey(restorePhrase);
      if (window.confirm('Restore church to ' + npub.slice(0, 18) + '…?\n\nThis replaces the key held on this device. The console will reload.')) {
        window.location.reload();
      }
    } catch (e) { setRestoreErr(e.message || 'That phrase isn’t valid.'); }
  };
  const restoreFromFile = (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const p = window.prompt('Enter the passphrase for this backup file:'); if (p == null) return;
    window.TrinityBackup.readFile(f).then(t => window.TrinityBackup.decryptStr(t, p)).then(obj => {
      window.TrinityBackup.applySteward(obj);
      if (window.confirm('Restore this church key from the file? The console will reload.')) window.location.reload();
    }).catch(err => window.alert('Restore failed: ' + (err.message || err)));
  };
  return (
    <div className="no-scrollbar sk-masonry" style={{ height: '100%', overflowY: 'auto', paddingBottom: 4 }}>
      {backupOpen ? <StewBackupModal church={church} onClose={() => setBackupOpen(false)} /> : null}
      {editingName ? <NameEditModal current={church.name} isNetwork={church.isNetwork} onSave={saveName} onClose={() => setEditingName(false)} /> : null}
      <Panel title={church.isNetwork ? 'Network identity' : 'Church identity'} action={<button onClick={() => setEditingName(true)} className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="pen" size={14} color="currentColor" /> Edit name</button>}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16 }}>
          <SkBadge initials={(church.name ? church.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'TO').toUpperCase()} size={44} radius={13} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: church.name ? 'var(--ink)' : 'var(--ink-3)' }}>{church.name || 'Name your church'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Shown to everyone who joins</div>
          </div>
        </div>
        <SkKey value={church.npub || '—'} label="npub" />
      </Panel>

      <DashChannelPanel church={church} />

      <DashAudioPanel church={church} />

      <DashNetworksPanel />

      <DashRelaysCard />

      <Panel title="Church key">
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>This church is self-custodial: its identity is one key, held on this device. Whoever holds it can post and manage the church — so keep the recovery phrase safe and private.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 14px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 12 }}>
          <Icon name="lock" size={18} color="var(--sage)" />
          <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14 }}>Held on this device</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Pilot key custody · a Keykeeper signer comes later</div></div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--sage)' }}><span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--sage)' }} /> Active</span>
        </div>
        {!revealed ? (
          <button onClick={reveal} className="sk-btn sk-btn--ghost" style={{ padding: '10px 14px', fontSize: 13 }}><Icon name="key" size={15} color="currentColor" /> Reveal recovery phrase</button>
        ) : (
          <div style={{ padding: 14, borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 7%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, var(--line))' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 14, lineHeight: 1.7, wordSpacing: 3, color: 'var(--ink)' }}>{phrase || 'No phrase available for this key.'}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {phrase ? <button onClick={() => { copyText(phrase); setCopied(true); setTimeout(() => setCopied(false), 1400); }} className="sk-btn sk-btn--clay" style={{ padding: '7px 11px', fontSize: 12 }}><Icon name={copied ? 'check' : 'receipt'} size={14} color="#fff" /> {copied ? 'Copied' : 'Copy'}</button> : null}
              <button onClick={() => { setRevealed(false); setPhrase(''); }} className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 12 }}>Hide</button>
            </div>
          </div>
        )}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setBackupOpen(true)} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="share" size={15} color="currentColor" /> Back up to a file</button>
          <label className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13, cursor: 'pointer' }}><Icon name="refresh" size={15} color="currentColor" /> Restore from a file<input type="file" accept=".json,application/json" onChange={restoreFromFile} style={{ display: 'none' }} /></label>
        </div>
        <div style={{ marginTop: 12 }}>
          {!restoreOpen ? (
            <button onClick={() => setRestoreOpen(true)} className="sk-btn sk-btn--ghost" style={{ padding: '10px 14px', fontSize: 13 }}><Icon name="key" size={15} color="currentColor" /> Restore from a recovery phrase</button>
          ) : (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 8 }}>Paste a church’s 12-word recovery phrase to make <b>this</b> device that church. Use this if the console lost its key, or to move a church to a new machine.</div>
              <textarea value={restorePhrase} onChange={e => setRestorePhrase(e.target.value)} rows={3} placeholder="word one  word two  word three …" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '11px 13px', fontSize: 13.5, fontFamily: 'var(--mono)', color: 'var(--ink)', outline: 'none', resize: 'vertical', lineHeight: 1.6 }} />
              {restoreErr ? <div style={{ fontSize: 12.5, color: 'var(--clay)', fontWeight: 600, marginTop: 6 }}>{restoreErr}</div> : null}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={doRestore} disabled={!restorePhrase.trim()} className="sk-btn sk-btn--clay" style={{ padding: '8px 13px', fontSize: 13, opacity: restorePhrase.trim() ? 1 : 0.5 }}><Icon name="refresh" size={14} color="#fff" /> Restore church</button>
                <button onClick={() => { setRestoreOpen(false); setRestorePhrase(''); setRestoreErr(''); }} className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 13 }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Stewards">
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>For the pilot, this one key runs {church.name || 'your church'}. Shared sign-off for multiple leaders — each with their own key via NIP-26 delegation, so the church secret is never copied — is on the roadmap.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, fontSize: 12.5, color: 'var(--ink-3)' }}>
          <Icon name="pray" size={14} color="var(--ink-3)" /> See who’s joined in the <button onClick={() => onTab && onTab('members')} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--clay-ink)', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12.5 }}>Members list</button>.
        </div>
      </Panel>
    </div>
  );
}

// ── Facebook-style docked DM window: the church <-> one member, encrypted ──
function StewDmWindow({ peer, offset, onClose }) {
  const [msgs, setMsgs] = React.useState([]);
  const [text, setText] = React.useState('');
  const [min, setMin] = React.useState(false);
  const scRef = React.useRef(null);
  const [rxFor, setRxFor] = React.useState('');   // msg id whose emoji picker is open
  React.useEffect(() => window.Steward.subscribeDMThread(peer.pubkey, setMsgs), [peer.pubkey]);
  React.useEffect(() => { if (!min && scRef.current) scRef.current.scrollTop = scRef.current.scrollHeight; }, [msgs, min]);
  const send = () => { if (!text.trim()) return; window.Steward.sendDM(peer.pubkey, text.trim()); setText(''); };
  const react = (m, emoji) => { window.Steward.reactDM(peer.pubkey, m.id, m.myReaction === emoji ? '-' : emoji); setRxFor(''); };
  const DM_EMOJI = ['❤️', '🙏', '👍', '😂', '😮', '😢'];
  const initials = (peer.name && peer.name !== 'Anonymous' ? peer.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'AN').toUpperCase();
  return (
    <div style={{ width: 316, background: 'var(--surface)', borderRadius: '14px 14px 0 0', border: '1px solid var(--line)', borderBottom: 'none', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', height: min ? 48 : 420, transition: 'height .18s' }}>
      <div onClick={() => setMin(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', cursor: 'pointer', background: 'var(--surface)', borderBottom: min ? 'none' : '1px solid var(--line)', flexShrink: 0 }}>
        <SkBadge initials={initials} size={28} radius={9} accent={SK_TINT.gold.fg} />
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{peer.name || 'Member'}</div><div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>{shortNpub(peer.npub)}</div></div>
        <button onClick={(e) => { e.stopPropagation(); setMin(v => !v); }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 3 }}><Icon name={min ? 'chevU' : 'chevD'} size={16} /></button>
        <button onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 3 }}><Icon name="x" size={16} /></button>
      </div>
      {!min ? (
        <React.Fragment>
          <div ref={scRef} className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}><Icon name="lock" size={12} /> Encrypted · only you two can read this</div>
            {msgs.map(m => (
              <div key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '82%', display: 'flex', flexDirection: 'column', alignItems: m.mine ? 'flex-end' : 'flex-start', position: 'relative' }}>
                <div onClick={() => setRxFor(v => v === m.id ? '' : m.id)} title="Tap to react" style={{ padding: '8px 12px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.4, background: m.mine ? 'var(--clay)' : 'var(--surface-2)', color: m.mine ? '#fff' : 'var(--ink)', border: m.mine ? 'none' : '1px solid var(--line)', cursor: 'pointer' }}>{m.text}</div>
                {m.reactions && m.reactions.length ? (
                  <div style={{ display: 'flex', gap: 3, marginTop: 2, flexWrap: 'wrap' }}>
                    {Object.entries(m.reactions.reduce((a, e) => (a[e] = (a[e] || 0) + 1, a), {})).map(([emo, n]) => (
                      <button key={emo} onClick={() => react(m, emo)} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 6px', borderRadius: 999, fontSize: 11.5, border: '1px solid var(--line)', background: m.myReaction === emo ? 'color-mix(in oklab, var(--clay) 16%, var(--surface))' : 'var(--surface)', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>{emo}{n > 1 ? <span style={{ color: 'var(--ink-3)', fontWeight: 700 }}>{n}</span> : null}</button>
                    ))}
                  </div>
                ) : null}
                {rxFor === m.id ? (
                  <div style={{ display: 'flex', gap: 2, marginTop: 4, padding: '4px 6px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, boxShadow: 'var(--shadow)' }}>
                    {DM_EMOJI.map(emo => (
                      <button key={emo} onClick={() => react(m, emo)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 3px', borderRadius: 7, opacity: m.myReaction === emo ? 1 : 0.85 }}>{emo}</button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '10px 11px', borderTop: '1px solid var(--line)', flexShrink: 0 }}>
            <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} autoFocus placeholder="Message…" style={{ flex: 1, height: 38, border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface-2)', padding: '0 12px', fontSize: 13.5, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
            <button onClick={send} disabled={!text.trim()} className="sk-btn sk-btn--clay" style={{ padding: '0 13px', opacity: text.trim() ? 1 : 0.5 }}><Icon name="send" size={15} color="#fff" /></button>
          </div>
        </React.Fragment>
      ) : null}
    </div>
  );
}

function MemberChatDock() {
  const [peers, setPeers] = React.useState([]);
  React.useEffect(() => {
    const onOpen = (e) => { const p = e.detail; if (!p || !p.pubkey) return; setPeers(ps => ps.some(x => x.pubkey === p.pubkey) ? ps : [...ps, p].slice(-3)); };
    window.addEventListener('steward-open-dm', onOpen);
    return () => window.removeEventListener('steward-open-dm', onOpen);
  }, []);
  const close = (pk) => setPeers(ps => ps.filter(x => x.pubkey !== pk));
  if (!peers.length) return null;
  return (
    <div style={{ position: 'absolute', right: 20, bottom: 0, zIndex: 130, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
      {peers.map(p => <StewDmWindow key={p.pubkey} peer={p} onClose={() => close(p.pubkey)} />)}
    </div>
  );
}

window.StewDashboard = StewDashboard;
