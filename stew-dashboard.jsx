// stew-dashboard.jsx — desktop Steward Console running state. Exports StewDashboard.

const NAV = [
  { key: 'overview', label: 'Overview', ic: 'today' },
  { key: 'groups', label: 'Groups', ic: 'chat' },
  { key: 'members', label: 'Members', ic: 'pray' },
  { key: 'relays', label: 'Relays', ic: 'globe' },
  { key: 'settings', label: 'Settings', ic: 'sliders' },
  // { key: 'giving', label: 'Giving', ic: 'gift' },   // parked for the pilot (chat first)
];

function StewDashboard({ initial = 'overview' }) {
  const [tab, setTab] = React.useState(initial);
  const [invite, setInvite] = React.useState(new URLSearchParams(location.search).get('invite') === '1');
  const church = window.useStewardChurch();   // real church profile + npub from the relay
  const churchName = church.name || 'Your Church';
  const initials = (church.name ? church.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'TO').toUpperCase();
  const editName = () => {
    const n = window.prompt('Church name (members see this)', church.name || '');
    if (n != null && n.trim()) window.Steward.publishProfile({ name: n.trim(), nip05: church.nip05 });
  };
  return (
    <ConsoleChrome>
      {invite ? <JoinModal onClose={() => setInvite(false)} /> : null}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'var(--paper)' }}>
        {/* sidebar */}
        <div style={{ width: 232, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', padding: '22px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 8px', marginBottom: 22 }}>
            <Halo size={26} color="var(--ink)" spark="var(--clay)" />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17 }}>Trinity<span style={{ color: 'var(--clay)' }}>One</span></span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.5px', color: 'var(--ink-3)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 6px', marginLeft: 'auto' }}>STEWARD</span>
          </div>
          <button onClick={editName} title="Set church name" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--surface-2)', cursor: 'pointer', marginBottom: 18, textAlign: 'left' }}>
            <SkBadge initials={initials} size={34} radius={10} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: church.name ? 'var(--ink)' : 'var(--ink-3)' }}>{churchName}</span>{church.name ? <Icon name="check" size={12} stroke={3} color="var(--sage)" /> : null}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{church.npub ? church.npub.slice(0, 18) + '…' : 'no key'}</div>
            </div>
            <Icon name="pen" size={14} color="var(--ink-3)" />
          </button>
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
          <div style={{ height: 64, flexShrink: 0, borderBottom: '1px solid var(--line)', background: 'var(--surface)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: 16 }}>
            <div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20 }}>{NAV.find(n => n.key === tab).label}</div></div>
            <div style={{ flex: 1 }} />
            <button onClick={() => setInvite(true)} className="sk-btn sk-btn--ghost" style={{ padding: '9px 14px', fontSize: 13 }}><Icon name="qr" size={15} color="currentColor" /> Invite code</button>
            <button className="sk-btn sk-btn--clay" style={{ padding: '9px 14px', fontSize: 13 }}><Icon name="send" size={15} color="#fff" /> New post</button>
            <SkBadge initials="PJ" size={36} radius={11} accent="var(--sage)" />
          </div>
          {/* content */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: 28, background: 'var(--paper)' }}>
            {tab === 'overview' && <DashOverview onTab={setTab} />}
            {tab === 'giving' && <DashGiving />}
            {tab === 'groups' && <DashGroups />}
            {tab === 'members' && <DashMembers />}
            {tab === 'relays' && <DashRelays />}
            {tab === 'settings' && <DashSettings onTab={setTab} />}
          </div>
        </div>
      </div>
    </ConsoleChrome>
  );
}

// ---- the join flow: a real QR + code members scan/paste to follow this church ----
function shortNpub(np) { return np ? np.slice(0, 14) + '…' + np.slice(-6) : '—'; }
function copyText(t) { try { navigator.clipboard.writeText(t); } catch {} }

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
        <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 15, letterSpacing: '.3px', margin: '4px 0 2px' }}>{shortNpub(np)}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: center ? 'center' : 'flex-start' }}>
          <button onClick={() => doCopy('link', url)} className="sk-btn sk-btn--clay" style={{ padding: '7px 11px', fontSize: 12 }}><Icon name={copied === 'link' ? 'check' : 'link'} size={14} color="#fff" /> {copied === 'link' ? 'Copied' : 'Copy link'}</button>
          <button onClick={() => doCopy('code', np)} className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 12 }}><Icon name={copied === 'code' ? 'check' : 'receipt'} size={14} color="currentColor" /> {copied === 'code' ? 'Copied' : 'Copy code'}</button>
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

function Panel({ title, action, children, style = {} }) {
  return (
    <div style={{ borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', padding: 22, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16.5 }}>{title}</div>
        <div style={{ flex: 1 }} />
        {action}
      </div>
      {children}
    </div>
  );
}

function DashOverview({ onTab }) {
  const groups = window.useStewardGroups();   // real chat groups (the focus)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, height: '100%' }}>
      <div style={{ display: 'flex', gap: 14 }}>
        <StatCard label="Members" value="—" sub="invite your church" ic="pray" tint="sage" />
        <StatCard label="Groups" value={String(groups.length)} sub="chat rooms · signed" ic="chat" tint="clay" />
        <StatCard label="Announcements" value="—" sub="post to everyone" ic="send" tint="gold" />
        <StatCard label="Your relay" value="Live" sub="self-hosted" ic="globe" tint="ink" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.45fr 1fr', gap: 18, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Panel title="Groups & rooms" action={<button onClick={() => onTab('groups')} style={{ border: 'none', background: 'none', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Manage →</button>} style={{ flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Panel title="Joining code">
            <JoinCard qrSize={92} />
          </Panel>
          <Panel title="Recent activity" style={{ flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {SK.activity.map((a, i) => {
                const t = SK_TINT[a.tint];
                return (
                  <div key={i} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 9, background: t.bg, color: t.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={a.ic} size={16} color="currentColor" fill={a.ic === 'bolt'} /></div>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{a.text}</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 1 }}>{a.time} · signed by Grace Chapel</div></div>
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

function ListPanel({ title, items, addLabel, renderRight, onAdd, empty }) {
  return (
    <Panel title={title} action={<button onClick={onAdd} className="sk-btn sk-btn--clay" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="plus" size={15} color="#fff" /> {addLabel}</button>} style={{ height: '100%' }}>
      {items.length === 0 ? <div style={{ textAlign: 'center', padding: '34px 10px', color: 'var(--ink-3)', fontSize: 13.5 }}>{empty || 'Nothing here yet.'}</div> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--surface)', color: it.fg || 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)' }}><Icon name={it.ic} size={19} color="currentColor" /></div>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14.5 }}>{it.name}</div><div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{it.sub}</div></div>
            {renderRight(it)}
          </div>
        ))}
      </div>
    </Panel>
  );
}

// create-a-group modal (a real form, not a prompt)
function NewGroupModal({ open, onClose }) {
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState('group');
  const [sub, setSub] = React.useState('');
  React.useEffect(() => { if (open) { setName(''); setKind('group'); setSub(''); } }, [open]);
  if (!open) return null;
  const create = () => { if (!name.trim()) return; window.Steward.publishGroup({ name: name.trim(), kind, sub: sub.trim() }); onClose(); };
  const fld = { width: '100%', boxSizing: 'border-box', height: 46, padding: '0 14px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 15, color: 'var(--ink)', fontFamily: 'var(--font-ui)' };
  const lbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 7px' };
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30,
      background: 'color-mix(in oklab, var(--ink) 32%, transparent)', backdropFilter: 'blur(3px)', animation: 'lumenFade .18s ease both' }}>
      <div style={{ width: 480, maxWidth: '100%', borderRadius: 22, background: 'var(--paper)', border: '1px solid var(--line)', boxShadow: '0 24px 70px rgba(0,0,0,.28)', overflow: 'hidden', animation: 'lumenScale .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div style={{ padding: '24px 26px 0' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, marginBottom: 4 }}>New group</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 18, lineHeight: 1.5 }}>A chat room (or a broadcast channel) for your church. It’s published as a signed event your members can join.</div>
          <div style={lbl}>NAME</div>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }} placeholder="e.g. Sunday Service" style={{ ...fld, fontWeight: 600, marginBottom: 16 }} />
          <div style={lbl}>TYPE</div>
          <SkToggle value={kind} onChange={setKind} options={[{ value: 'group', label: 'Group chat', icon: 'chat' }, { value: 'broadcast', label: 'Broadcast', icon: 'send' }]} style={{ marginBottom: 6 }} />
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '6px 0 16px', lineHeight: 1.45 }}>{kind === 'broadcast' ? 'Only stewards post; everyone reads. Good for announcements.' : 'Everyone in the group can post and reply.'}</div>
          <div style={lbl}>DESCRIPTION</div>
          <input value={sub} onChange={e => setSub(e.target.value)} placeholder="Optional — e.g. Whole church" style={{ ...fld, fontSize: 14.5 }} />
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '20px 26px 22px' }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: '12px' }}>Cancel</button>
          <button onClick={create} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: '12px', opacity: name.trim() ? 1 : .5 }}><Icon name="plus" size={16} color="#fff" /> Create group</button>
        </div>
      </div>
    </div>
  );
}

function DashGroups() {
  const groups = window.useStewardGroups();   // REAL chat groups the church has published
  const [adding, setAdding] = React.useState(new URLSearchParams(location.search).get('newgroup') === '1');
  const items = groups.map(g => ({ ...g, ic: g.kind === 'broadcast' ? 'send' : 'chat', fg: g.kind === 'broadcast' ? '#8a6717' : 'var(--sage)' }));
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <ListPanel title="Groups & rooms" addLabel="New group" onAdd={() => setAdding(true)} items={items}
        empty="No groups yet — create your church's first chat room."
        renderRight={(it) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {it.kind === 'broadcast' ? <SkPill tint="gold">Broadcast</SkPill> : null}
            <button onClick={() => window.Steward.removeGroup(it.id)} title="Remove group" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 7px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="trash" size={15} color="currentColor" /></button>
          </div>
        )} />
      <NewGroupModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function DashRelays() {
  const items = SK.relays.map(r => ({ name: r.url, sub: r.label, ic: 'globe', fg: 'var(--sage)', kind: r.kind }));
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ListPanel title="Relays" addLabel="Add relay" items={items} renderRight={(it) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {it.kind === 'own' ? <SkPill tint="clay">Self-hosted</SkPill> : <SkPill tint="ink">Shared</SkPill>}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--sage)' }}><span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--sage)' }} /> Live</span>
        </div>
      )} />
    </div>
  );
}

// shared promote-to-steward confirmation (founder action)
function PromoteModal({ member, onConfirm, onClose }) {
  if (!member) return null;
  const isDemote = member.role === 'steward';
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30,
      background: 'color-mix(in oklab, var(--ink) 32%, transparent)', backdropFilter: 'blur(3px)', animation: 'lumenFade .18s ease both' }}>
      <div style={{ width: 460, maxWidth: '100%', borderRadius: 22, background: 'var(--paper)', border: '1px solid var(--line)', boxShadow: '0 24px 70px rgba(0,0,0,.28)', overflow: 'hidden', animation: 'lumenScale .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div style={{ padding: '24px 26px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16 }}>
            <SkBadge initials={member.h.split(' ').map(w => w[0]).join('').slice(0, 2)} size={46} radius={13} accent={isDemote ? 'var(--ink-3)' : 'var(--clay)'} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{isDemote ? `Remove ${member.h} as steward?` : `Make ${member.h} a steward?`}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{member.handle || member.npub}</div>
            </div>
          </div>

          {isDemote ? (
            <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, margin: '0 0 18px' }}>
              They’ll lose sign-off rights for Grace Chapel. Their delegation is revoked at your next publish — past actions they signed stay valid. They remain an ordinary member.</p>
          ) : (
            <React.Fragment>
              <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, margin: '0 0 14px' }}>
                Stewards can create funds, post announcements, and manage groups for Grace Chapel. Here’s exactly what that grants — and what it doesn’t:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
                {[
                  { ic: 'check', fg: 'var(--sage)', t: 'Signs on the church’s behalf', s: 'Via NIP-26 delegation from their own key' },
                  { ic: 'lock', fg: 'var(--sage)', t: 'Your secret key is never shared', s: 'It stays in your Keykeeper — delegation is a signed permission, not a copy' },
                  { ic: 'refresh', fg: 'var(--clay)', t: 'You can revoke it anytime', s: 'Removing them ends their sign-off rights at once' },
                ].map(r => (
                  <div key={r.t} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: 'var(--surface-2)', color: r.fg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={r.ic} size={16} color="currentColor" stroke={2.2} /></div>
                    <div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.t}</div><div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>{r.s}</div></div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 9, padding: '11px 13px', borderRadius: 12, background: 'color-mix(in oklab, var(--gold) 10%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 28%, transparent)', marginBottom: 4 }}>
                <Icon name="bolt" size={16} fill color="var(--gold)" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>Confirming signs a delegation token. <b style={{ color: 'var(--ink)' }}>Keykeeper</b> will ask you to approve it.</div>
              </div>
            </React.Fragment>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '18px 26px 22px' }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: '12px' }}>Cancel</button>
          <button onClick={() => onConfirm(member)} className="sk-btn" style={{ flex: 1, padding: '12px', background: isDemote ? 'var(--ink)' : 'var(--clay)', color: '#fff' }}>
            {isDemote ? <React.Fragment><Icon name="refresh" size={16} color="#fff" /> Remove steward</React.Fragment> : <React.Fragment><Icon name="shield" size={16} color="#fff" /> Confirm &amp; sign</React.Fragment>}
          </button>
        </div>
      </div>
    </div>
  );
}

function DashMembers() {
  const [members, setMembers] = React.useState([
    { id: 'm1', h: 'Quiet Cedar', role: 'anonymous', when: 'joined today', handle: 'Anonymous · npub1qc…7v3' },
    { id: 'm2', h: 'Pastor John', role: 'steward', when: 'founder', founder: true, handle: 'npub1grace…d0a7q' },
    { id: 'm3', h: 'Gentle Harbor', role: 'anonymous', when: 'joined 2d ago', handle: 'Anonymous · npub1gh…k2m' },
    { id: 'm4', h: 'Maria R.', role: 'named', when: 'gives with receipt', handle: 'npub1mar…5e2' },
    { id: 'm5', h: 'David Okafor', role: 'named', when: 'small groups lead', handle: 'npub1dav…9l4' },
    { id: 'm6', h: 'Bright Sparrow', role: 'anonymous', when: 'joined 1w ago', handle: 'Anonymous · npub1bs…r8t' },
  ]);
  const [promote, setPromote] = React.useState(null);
  const [flash, setFlash] = React.useState('');

  const tintFor = (r) => r === 'steward' ? 'clay' : r === 'named' ? 'gold' : 'sage';
  const confirm = (m) => {
    const becoming = m.role !== 'steward';
    setMembers(ms => ms.map(x => x.id === m.id ? { ...x, role: becoming ? 'steward' : (x.named ? 'named' : 'anonymous'), prevRole: becoming ? x.role : undefined } : x));
    setPromote(null);
    setFlash(becoming ? `${m.h} is now a steward` : `${m.h} is no longer a steward`);
    setTimeout(() => setFlash(''), 2600);
  };

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <Panel title="Members" action={<SkPill tint="sage">312 following · most anonymous</SkPill>} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          {members.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <SkBadge initials={r.h.split(' ').map(w => w[0]).join('').slice(0, 2)} size={36} radius={11} accent={SK_TINT[tintFor(r.role)].fg} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.h}</div><div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{r.when}</div></div>
              {r.role === 'steward'
                ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <SkPill tint="clay">{r.founder ? 'founder' : 'steward'}</SkPill>
                    {r.founder ? null : <button onClick={() => setPromote(r)} title="Remove steward" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 7px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', fontFamily: 'var(--font-ui)' }}><Icon name="dots" size={16} color="currentColor" /></button>}
                  </div>
                : <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <SkPill tint={tintFor(r.role)}>{r.role}</SkPill>
                    <button onClick={() => setPromote(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid color-mix(in oklab, var(--clay) 35%, var(--line))', background: 'var(--surface)', color: 'var(--clay-ink)', borderRadius: 10, padding: '7px 11px', cursor: 'pointer', fontWeight: 700, fontSize: 12.5, fontFamily: 'var(--font-ui)' }}>
                      <Icon name="shield" size={14} color="var(--clay)" /> Make steward</button>
                  </div>}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 9, marginTop: 16, padding: 13, borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 24%, transparent)', flexShrink: 0 }}>
          <Icon name="shield" size={17} color="var(--sage)" style={{ flexShrink: 0 }} /><div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>You can’t see who gave anonymously — and that’s the point. Promoting a steward grants sign-off rights via their own key (NIP-26); it never reveals anyone’s giving.</div>
        </div>
      </Panel>

      {flash ? (
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 40, display: 'flex', alignItems: 'center', gap: 9,
          background: 'var(--ink)', color: 'var(--paper)', padding: '11px 18px', borderRadius: 999, fontSize: 13.5, fontWeight: 600, boxShadow: '0 12px 30px rgba(0,0,0,.25)', animation: 'lumenFade .25s ease both' }}>
          <Icon name="check" size={16} stroke={2.6} color="var(--sage-soft)" /> {flash}</div>
      ) : null}

      <PromoteModal member={promote} onConfirm={confirm} onClose={() => setPromote(null)} />
    </div>
  );
}
window.DashMembers = DashMembers;

function DashSettings({ onTab }) {
  const stewards = [
    { h: 'Pastor John', sub: 'Founder · holds the church key', founder: true },
    { h: 'David Okafor', sub: 'Steward · delegated Apr 12', founder: false },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <Panel title="Church key">
        <SkKey value={SK.church.npub} label="npub" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 14, padding: '13px 14px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <Icon name="lock" size={18} color="var(--sage)" />
          <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14 }}>Signer · Keykeeper extension</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Secret key held in your browser add-on</div></div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--sage)' }}><span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--sage)' }} /> Connected</span>
        </div>
      </Panel>
      <Panel title="Stewards" action={<button onClick={() => onTab && onTab('members')} className="sk-btn sk-btn--clay" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="plus" size={15} color="#fff" /> Add a steward</button>}>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>Leaders who can sign for Grace Chapel. Each gets sign-off rights via their own key (NIP-26 delegation) — your church’s secret is never shared.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {stewards.map(s => (
            <div key={s.h} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <SkBadge initials={s.h.split(' ').map(w => w[0]).join('').slice(0, 2)} size={36} radius={11} accent="var(--clay)" />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14.5 }}>{s.h}</div><div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{s.sub}</div></div>
              {s.founder ? <SkPill tint="clay">founder</SkPill> : <SkPill tint="ink">steward</SkPill>}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, fontSize: 12.5, color: 'var(--ink-3)' }}>
          <Icon name="shield" size={14} color="var(--ink-3)" /> Promote anyone from the <button onClick={() => onTab && onTab('members')} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--clay-ink)', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12.5 }}>Members list</button>.
        </div>
      </Panel>
    </div>
  );
}

window.StewDashboard = StewDashboard;
