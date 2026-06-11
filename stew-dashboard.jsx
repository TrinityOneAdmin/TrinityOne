// stew-dashboard.jsx — desktop Steward Console running state. Exports StewDashboard.

const NAV = [
  { key: 'overview', label: 'Overview', ic: 'today' },
  { key: 'groups', label: 'Groups', ic: 'chat' },
  { key: 'rota', label: 'Rota', ic: 'calCheck' },
  { key: 'calendar', label: 'Calendar', ic: 'calendar' },
  { key: 'resources', label: 'Resources', ic: 'read' },
  { key: 'members', label: 'Members', ic: 'pray' },
  { key: 'relays', label: 'Relays', ic: 'globe' },
  { key: 'settings', label: 'Settings', ic: 'sliders' },
  // { key: 'giving', label: 'Giving', ic: 'gift' },   // parked for the pilot (chat first)
];

function StewDashboard({ initial = 'overview' }) {
  const [tab, setTab] = React.useState(initial);
  const [invite, setInvite] = React.useState(new URLSearchParams(location.search).get('invite') === '1');
  const [posting, setPosting] = React.useState(new URLSearchParams(location.search).get('newpost') === '1');
  const [addingTeam, setAddingTeam] = React.useState(false);
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
      {posting ? <NewPostModal onClose={() => setPosting(false)} /> : null}
      <NewTeamModal open={addingTeam} onClose={() => setAddingTeam(false)} />
      <MemberChatDock />
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
            {tab === 'rota'
              ? <button onClick={() => setAddingTeam(true)} className="sk-btn sk-btn--clay" style={{ padding: '9px 14px', fontSize: 13 }}><Icon name="plus" size={15} color="#fff" /> New team</button>
              : <button onClick={() => setPosting(true)} className="sk-btn sk-btn--clay" style={{ padding: '9px 14px', fontSize: 13 }}><Icon name="send" size={15} color="#fff" /> New post</button>}
            <SkBadge initials="PJ" size={36} radius={11} accent="var(--sage)" />
          </div>
          {/* content */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: 28, background: 'var(--paper)' }}>
            {tab === 'overview' && <DashOverview onTab={setTab} />}
            {tab === 'giving' && <DashGiving />}
            {tab === 'groups' && <DashGroups />}
            {tab === 'rota' && <DashRota onNewTeam={() => setAddingTeam(true)} />}
            {tab === 'calendar' && <DashCalendar />}
            {tab === 'resources' && <DashResources />}
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

// Console chat view for one group/team — read the scrollback + post as the church.
function GroupChatModal({ group, onClose }) {
  const [msgs, setMsgs] = React.useState([]);
  const [text, setText] = React.useState('');
  const scRef = React.useRef(null);
  React.useEffect(() => window.Steward.subscribeGroupChat(group.id, setMsgs), [group.id]);
  React.useEffect(() => { if (scRef.current) scRef.current.scrollTop = scRef.current.scrollHeight; }, [msgs]);
  const send = () => { if (!text.trim()) return; window.Steward.publishPost(text.trim(), group.id); setText(''); };
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
            <div key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '76%' }}>
              {!m.mine ? <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginBottom: 2, paddingLeft: 4 }}>{'member …' + (m.by || '').slice(-8)}</div> : null}
              <div style={{ padding: '9px 13px', borderRadius: 15, fontSize: 14, lineHeight: 1.4, background: m.mine ? 'var(--clay)' : 'var(--surface-2)', color: m.mine ? '#fff' : 'var(--ink)', border: m.mine ? 'none' : '1px solid var(--line)' }}>{m.kind === 'prayer' ? '🙏 ' : ''}{m.text}</div>
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
  const [adding, setAdding] = React.useState(new URLSearchParams(location.search).get('newgroup') === '1');
  const [chatGroup, setChatGroup] = React.useState(null);
  const items = all.map(g => ({ ...g, ic: g.kind === 'team' ? (g.icon || 'shield') : g.kind === 'broadcast' ? 'send' : 'chat', fg: g.kind === 'team' ? (g.accent || 'var(--clay)') : g.kind === 'broadcast' ? '#8a6717' : 'var(--sage)' }));
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <ListPanel title="Groups, teams & rooms" addLabel="New group" onAdd={() => setAdding(true)} items={items}
        empty="No groups yet — create your church's first chat room (or a team on the Rota page)."
        renderRight={(it) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {it.kind === 'broadcast' ? <SkPill tint="gold">Broadcast</SkPill> : null}
            {it.kind === 'team' ? <SkPill tint="clay">Team</SkPill> : null}
            <button onClick={() => setChatGroup(it)} title="Open chat" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 9px', cursor: 'pointer', color: 'var(--clay)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}><Icon name="chat" size={15} color="currentColor" /> Chat</button>
            <button onClick={() => window.Steward.removeGroup(it.id)} title={it.kind === 'team' ? 'Remove team' : 'Remove group'} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 7px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="trash" size={15} color="currentColor" /></button>
          </div>
        )} />
      <NewGroupModal open={adding} onClose={() => setAdding(false)} />
      {chatGroup ? <GroupChatModal group={chatGroup} onClose={() => setChatGroup(null)} /> : null}
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
  React.useEffect(() => { if (open) { setName(''); setDesc(''); setIcon('hand'); setAccent('#C25A38'); setRoles(''); } }, [open]);
  if (!open) return null;
  const applyPreset = (p) => { setIcon(p.icon); setAccent(p.accent); if (!name.trim()) setName(p.name); if (!roles.trim()) setRoles(p.roles); };
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
            const on = icon === p.icon && accent === p.accent;
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

function DashRelays() {
  const status = window.useStewardRelays();   // [{ url, status:'on'|'off', ms }]
  const stats = window.useStewardStats();     // { events }
  const host = (typeof location !== 'undefined' && location.host) || '';
  const online = status.filter(r => r.status === 'on').length;
  const checking = status.length === 0;
  const own = window.Steward.ownRelay ? window.Steward.ownRelay() : '';
  const [draft, setDraft] = React.useState('');
  const [err, setErr] = React.useState('');
  const addRelay = () => {
    const r = window.Steward.addRelay && window.Steward.addRelay(draft);
    if (!r) { setErr('Enter a relay address, e.g. nos.lol (or wss://relay.example.com)'); return; }
    setDraft(''); setErr('');
  };
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 14 }}>
        <StatCard label="Relays online" value={checking ? '…' : `${online}/${status.length}`} sub={online === status.length && !checking ? 'all reachable' : 'check connection'} ic="globe" tint={online ? 'sage' : 'clay'} />
        <StatCard label="Events stored" value={String(stats.events)} sub="your church's footprint" ic="receipt" tint="clay" />
        <StatCard label="Hosting" value="Self" sub="this church's relay" ic="shield" tint="ink" />
      </div>
      <Panel title="Relays" style={{ flex: 1 }}>
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
        <div style={{ display: 'flex', gap: 9, marginTop: 16, padding: 13, borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 24%, transparent)' }}>
          <Icon name="shield" size={17} color="var(--sage)" style={{ flexShrink: 0 }} /><div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>Your church hosts its own relay — every message, group, and member lives on infrastructure you control. Members reach it wherever you serve the app.</div>
        </div>
      </Panel>
    </div>
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
      <Panel title="Plan library" style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 14 }}>Share a reading plan and the whole church sees it in their app — members start it and track their own progress.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {available.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Every plan is shared.</div> : available.map(p => <PlanRow key={p.id} p={p} />)}
        </div>
      </Panel>
    </div>
  );
}
window.DashPlans = DashPlans;

// Upload a devotional — a reflection on a passage as a text (.txt) or Markdown (.md) file.
function NewDevotionalModal({ onClose }) {
  const [title, setTitle] = React.useState('');
  const [ref, setRef] = React.useState('');
  const [file, setFile] = React.useState(null);   // { type, name, text? }
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
  const create = () => {
    if (!title.trim() || !file || file.error || busy) return;
    setBusy(true);
    Promise.resolve(window.Steward.publishDevotional({ title: title.trim(), ref: ref.trim(), type: file.type, text: file.text || '' })).then(() => onClose());
  };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'rgba(40,32,24,.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: '92%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 28 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>Upload a devotional</div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 18px' }}>A reflection on a passage, as a text (.txt) or Markdown (.md) file. Your congregation reads it in their app.</p>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Title</div>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Resting in Psalm 23" style={{ width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '0 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }} />
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Passage (optional)</div>
        <input value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. Psalm 23" style={{ width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '0 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 16px', borderRadius: 13, border: '1px dashed var(--line)', background: 'var(--surface-2)', cursor: 'pointer' }}>
          <Icon name="read" size={20} color="var(--clay)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: file && !file.error ? 'var(--ink)' : 'var(--ink-2)' }}>{file && file.name ? file.name : 'Choose a .txt or .md file'}</div>
            <div style={{ fontSize: 12, color: file && file.error ? 'var(--clay)' : 'var(--ink-3)' }}>{file && file.error ? file.error : (file && file.type ? file.type.toUpperCase() + ' ready' : 'Tap to pick a file')}</div>
          </div>
          <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={e => pick(e.target.files && e.target.files[0])} style={{ display: 'none' }} />
        </label>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12, fontSize: 14 }}>Cancel</button>
          <button onClick={create} disabled={!title.trim() || !file || file.error || busy} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 12, fontSize: 14, opacity: (!title.trim() || !file || file.error || busy) ? 0.55 : 1 }}><Icon name="send" size={16} color="#fff" /> {busy ? 'Sharing…' : 'Share devotional'}</button>
        </div>
      </div>
    </div>
  );
}

function DashDevotionals() {
  const devos = window.useStewardDevotionals();
  const [adding, setAdding] = React.useState(false);
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      {adding ? <NewDevotionalModal onClose={() => setAdding(false)} /> : null}
      <Panel title={`Devotionals${devos.length ? ` · ${devos.length}` : ''}`}
        action={<div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => window.TrinityTemplates.openDevoTemplate()} className="sk-btn sk-btn--ghost" style={{ padding: '8px 12px', fontSize: 13 }} title="The writing template + house style for a devotional series"><Icon name="receipt" size={15} color="currentColor" /> Template</button>
          <button onClick={() => setAdding(true)} className="sk-btn sk-btn--clay" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="plus" size={15} color="#fff" /> Upload devotional</button>
        </div>} style={{ height: '100%' }}>
        {devos.length === 0 ? (
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, padding: '6px 2px' }}>No devotionals yet. Upload a .txt or .md reflection on a passage — your congregation reads it in their app.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {devos.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface)', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="read" size={19} color="currentColor" /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{d.title}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{[d.ref, (d.type || '').toUpperCase()].filter(Boolean).join(' · ')}</div>
                </div>
                <button onClick={() => window.Steward.removeDevotional(d.id)} title="Remove" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 7px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="trash" size={15} color="currentColor" /></button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function DashResources() {
  const [view, setView] = React.useState('plans');   // plans | devotionals
  const seg = { display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 16 };
  const btn = (k, label) => (
    <button onClick={() => setView(k)} style={{ padding: '8px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5, background: view === k ? 'var(--surface)' : 'transparent', color: view === k ? 'var(--clay)' : 'var(--ink-2)', boxShadow: view === k ? 'var(--shadow-sm)' : 'none' }}>{label}</button>
  );
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={seg}>{btn('plans', 'Reading plans')}{btn('devotionals', 'Devotionals')}</div>
      <div style={{ flex: 1, minHeight: 0 }}>{view === 'plans' ? <DashPlans /> : <DashDevotionals />}</div>
    </div>
  );
}
window.DashResources = DashResources;

function DashMembers() {
  const members = window.useStewardMembers();   // real members: joined (presence) and/or active (posts)
  const [copied, setCopied] = React.useState('');
  const total = members.length;
  const active = members.filter(m => m.count > 0).length;
  const doCopy = (np) => { copyText(np); setCopied(np); setTimeout(() => setCopied(''), 1400); };
  return (
    <Panel title="Members" action={<SkPill tint="sage">{total ? `${total} member${total === 1 ? '' : 's'}${active ? ` · ${active} chatting` : ''}` : 'none yet'}</SkPill>} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {total === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--ink-3)', padding: 24 }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}><Icon name="pray" size={26} color="var(--ink-3)" /></div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-2)' }}>No members yet.</div>
          <p style={{ fontSize: 13, margin: '6px 0 0', maxWidth: 320, lineHeight: 1.5 }}>Share your invite code — people appear here the moment they join, whether or not they’ve posted.</p>
        </div>
      ) : (
        <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {members.map(m => {
            const named = !!m.name;
            const label = named ? m.name : 'Anonymous';
            const initials = (named ? m.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'AN').toUpperCase();
            return (
              <div key={m.pubkey} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <SkBadge initials={initials} size={36} radius={11} accent={SK_TINT[named ? 'gold' : 'sage'].fg} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontWeight: 700, fontSize: 14.5 }}>{label}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-3)' }}>{shortNpub(m.npub)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{m.count > 0 ? `${m.count} message${m.count === 1 ? '' : 's'} · last ${ago(m.lastTs)}` : `joined ${ago(m.joined)} · hasn’t posted yet`}</div>
                </div>
                {m.count === 0 ? <SkPill tint="ink">joined</SkPill> : null}
                {!named ? <SkPill tint="sage">anonymous</SkPill> : null}
                <button onClick={() => window.dispatchEvent(new CustomEvent('steward-open-dm', { detail: { pubkey: m.pubkey, npub: m.npub, name: label } }))} title="Message privately" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 10px', cursor: 'pointer', color: 'var(--clay)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}>
                  <Icon name="chat" size={15} color="currentColor" /> Chat</button>
                <button onClick={() => doCopy(m.npub)} title="Copy npub" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', fontFamily: 'var(--font-ui)' }}>
                  <Icon name={copied === m.npub ? 'check' : 'link'} size={15} color={copied === m.npub ? 'var(--sage)' : 'currentColor'} /></button>
              </div>
            );
          })}
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
          <button onClick={make} disabled={busy || done || pass.length < 4} className="sk-btn sk-btn--clay" style={{ flex: 2, padding: 13, fontSize: 14, opacity: (busy || pass.length < 4) ? 0.6 : 1 }}>
            <Icon name={done ? 'check' : 'share'} size={15} color="#fff" /> {done ? 'Saved' : busy ? 'Encrypting…' : 'Download encrypted backup'}</button>
        </div>
      </div>
    </div>
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

function DashSettings({ onTab }) {
  const church = window.useStewardChurch();   // real church name + npub
  const [revealed, setRevealed] = React.useState(false);
  const [phrase, setPhrase] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const editName = () => {
    const n = window.prompt('Church name (members see this)', church.name || '');
    if (n != null && n.trim()) window.Steward.publishProfile({ name: n.trim(), nip05: church.nip05 });
  };
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      {backupOpen ? <StewBackupModal church={church} onClose={() => setBackupOpen(false)} /> : null}
      <Panel title="Church identity" action={<button onClick={editName} className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="pen" size={14} color="currentColor" /> Edit name</button>}>
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
  React.useEffect(() => window.Steward.subscribeDMThread(peer.pubkey, setMsgs), [peer.pubkey]);
  React.useEffect(() => { if (!min && scRef.current) scRef.current.scrollTop = scRef.current.scrollHeight; }, [msgs, min]);
  const send = () => { if (!text.trim()) return; window.Steward.sendDM(peer.pubkey, text.trim()); setText(''); };
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
              <div key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '82%', padding: '8px 12px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.4, background: m.mine ? 'var(--clay)' : 'var(--surface-2)', color: m.mine ? '#fff' : 'var(--ink)', border: m.mine ? 'none' : '1px solid var(--line)' }}>{m.text}</div>
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
