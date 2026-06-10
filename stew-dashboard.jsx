// stew-dashboard.jsx — desktop Steward Console running state. Exports StewDashboard.

const NAV = [
  { key: 'overview', label: 'Overview', ic: 'today' },
  { key: 'groups', label: 'Groups', ic: 'chat' },
  { key: 'plans', label: 'Plans', ic: 'read' },
  { key: 'members', label: 'Members', ic: 'pray' },
  { key: 'relays', label: 'Relays', ic: 'globe' },
  { key: 'settings', label: 'Settings', ic: 'sliders' },
  // { key: 'giving', label: 'Giving', ic: 'gift' },   // parked for the pilot (chat first)
];

function StewDashboard({ initial = 'overview' }) {
  const [tab, setTab] = React.useState(initial);
  const [invite, setInvite] = React.useState(new URLSearchParams(location.search).get('invite') === '1');
  const [posting, setPosting] = React.useState(new URLSearchParams(location.search).get('newpost') === '1');
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
            <button onClick={() => setPosting(true)} className="sk-btn sk-btn--clay" style={{ padding: '9px 14px', fontSize: 13 }}><Icon name="send" size={15} color="#fff" /> New post</button>
            <SkBadge initials="PJ" size={36} radius={11} accent="var(--sage)" />
          </div>
          {/* content */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: 28, background: 'var(--paper)' }}>
            {tab === 'overview' && <DashOverview onTab={setTab} />}
            {tab === 'giving' && <DashGiving />}
            {tab === 'groups' && <DashGroups />}
            {tab === 'plans' && <DashPlans />}
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
  const targets = groups.filter(g => g.kind === 'broadcast');
  const [text, setText] = React.useState('');
  const [target, setTarget] = React.useState(targets[0] ? targets[0].id : 'announce');
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
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>New announcement</div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 18px' }}>A signed message from your church. Everyone who joined sees it in the chosen room.</p>
        {targets.length ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>Post to</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {targets.map(g => (
                <button key={g.id} onClick={() => setTarget(g.id)} style={{ padding: '7px 13px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, border: '1px solid ' + (target === g.id ? 'var(--clay)' : 'var(--line)'), background: target === g.id ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface)', color: target === g.id ? 'var(--clay-ink)' : 'var(--ink-2)' }}>{g.name}</button>
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
            {activity.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '6px 2px' }}>Nothing yet — activity shows here as your church chats.</div> : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
  const status = window.useStewardRelays();   // [{ url, status:'on'|'off', ms }]
  const stats = window.useStewardStats();     // { events }
  const host = (typeof location !== 'undefined' && location.host) || '';
  const online = status.filter(r => r.status === 'on').length;
  const checking = status.length === 0;
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
              </div>
            );
          })}
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

function DashPlans() {
  const shared = window.useStewardPlans();          // plans currently shared with the church
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      <Panel title={`Shared with your church${shared.length ? ` · ${shared.length}` : ''}`}>
        {shared.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '6px 2px' }}>No plans shared yet — pick one from the library below and your congregation can follow along.</div>
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
        <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
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

window.StewDashboard = StewDashboard;
