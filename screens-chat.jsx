// screens-chat.jsx — "Chat" tab: anonymous church + life-group messaging over Nostr.
// UI is wired; transport is mock for now. Identity is REAL when lib/identity.js has
// derived a key (window.LumenIdentity), otherwise falls back to the mock identity.
const { useState: useC, useEffect: useCE, useRef: useCR } = React;

// reflect the live (real-or-mock) anonymous identity; re-render on regeneration
function useIdentity() {
  const read = () => (window.LumenIdentity && window.LumenIdentity.current) || window.LumenData.CHAT_IDENTITY;
  const [id, setId] = useC(read);
  useCE(() => {
    const h = () => setId(read());
    window.addEventListener('lumen-identity', h); h();
    return () => window.removeEventListener('lumen-identity', h);
  }, []);
  return id;
}

// avatar = colored circle with the descriptive word's initial
function Avatar({ handle, color, size = 38 }) {
  const word = (handle || 'Anonymous').split(' ').slice(-1)[0];
  return (
    <div style={{
      width: size, height: size, borderRadius: 999, flexShrink: 0,
      background: `linear-gradient(150deg, ${color}, color-mix(in oklab, ${color} 60%, #16120c))`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: size * 0.4,
    }}>{word[0]}</div>
  );
}

// ── Nostr explainer sheet ──
function NostrSheet({ open, onClose, ctx }) {
  const id = useIdentity();
  const relays = window.LumenData.RELAYS;
  const copyNpub = () => {
    if (window.LumenIdentity && window.LumenIdentity.copyNpub) window.LumenIdentity.copyNpub();
    else if (navigator.clipboard) navigator.clipboard.writeText(id.npub).catch(() => {});
    ctx.toast('Public key copied');
  };
  const regen = async () => {
    if (window.LumenIdentity && window.LumenIdentity.regenerate) { await window.LumenIdentity.regenerate(); ctx.toast('New anonymous identity created'); }
    else ctx.toast('Identity layer not ready');
  };
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="84%">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--clay-soft)', color: 'var(--clay-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="shield" size={21} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>You’re anonymous</div>
        </div>
        <IconBtn name="x" onClick={onClose} />
      </div>
      <p style={{ fontFamily: 'var(--font-read)', fontSize: 16, lineHeight: 1.55, color: 'var(--ink-2)', margin: '8px 0 18px', textWrap: 'pretty' }}>
        Chat runs on <b style={{ color: 'var(--ink)' }}>Nostr</b>, an open protocol. There’s no email, no phone number, no account — just a key that lives on your device. Your church sees a friendly handle, never you.
      </p>

      {/* identity card */}
      <div style={{ borderRadius: 18, padding: 16, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar handle={id.handle} color={id.color} size={48} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>{id.handle}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--ink-3)', fontSize: 12, fontFamily: 'var(--font-ui)' }}>
              <Icon name="key" size={13} /><span style={{ fontFamily: 'monospace', letterSpacing: '-.3px' }}>{id.npub.slice(0, 20)}…</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 9, marginTop: 14 }}>
          <button onClick={copyNpub} style={miniBtn()}><Icon name="copy" size={15} /> Copy npub</button>
          <button onClick={regen} style={miniBtn()}><Icon name="refresh" size={15} /> New identity</button>
        </div>
      </div>

      {/* relays */}
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '4px 0 9px' }}>RELAYS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
        {relays.map(r => (
          <div key={r.url} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <Icon name="globe" size={17} color={r.status === 'on' ? 'var(--sage)' : 'var(--ink-3)'} />
            <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 13.5, color: 'var(--ink)' }}>{r.url}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: r.status === 'on' ? 'var(--sage)' : 'var(--ink-3)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: r.status === 'on' ? 'var(--sage)' : 'var(--ink-3)' }} />
              {r.status === 'on' ? 'Connected' : 'Off'}
            </span>
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}
function miniBtn() {
  return { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px',
    borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer',
    color: 'var(--ink)', fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-ui)' };
}

// ── group list (the Chat tab body) ──
function ChatScreen({ ctx }) {
  const D = window.LumenData;
  const [nostr, setNostr] = useC(false);
  const [view, setView] = useC('groups');
  const id = useIdentity();
  const onCount = D.RELAYS.filter(r => r.status === 'on').length;

  return (
    <ScreenScroll>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, animation: 'lumenFade .5s ease both' }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, letterSpacing: '-.5px' }}>Chat</h1>
        <IconBtn name="plus" onClick={() => ctx.toast(view === 'giving' ? 'Load funds or give' : 'Create or join a group')} />
      </div>

      {/* segmented: Groups / Giving */}
      <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 15, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 20 }}>
        {[['groups', 'Groups', 'chat'], ['giving', 'Giving', 'bolt']].map(([gid, label, ic]) => {
          const on = view === gid;
          return (
            <button key={gid} onClick={() => setView(gid)} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px',
              borderRadius: 11, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14,
              background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--clay)' : 'var(--ink-2)',
              boxShadow: on ? 'var(--shadow)' : 'none', transition: 'all .2s',
            }}><Icon name={ic} size={17} stroke={on ? 2.1 : 1.8} fill={ic === 'bolt' && on} />{label}</button>
          );
        })}
      </div>

      {view === 'giving' ? (
        <GivingView ctx={ctx} balance={ctx.walletSats} setBalance={ctx.setWalletSats} history={ctx.giving} setHistory={ctx.setGiving} />
      ) : (
      <React.Fragment>
      {/* anonymous identity banner */}
      <button onClick={() => setNostr(true)} style={{
        width: '100%', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--line)',
        background: 'var(--surface)', borderRadius: 20, padding: 14, marginBottom: 22, boxShadow: 'var(--shadow)',
        display: 'flex', alignItems: 'center', gap: 13, animation: 'lumenFade .5s ease .05s both',
      }}>
        <Avatar handle={id.handle} color={id.color} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{id.handle}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--clay-soft)', color: 'var(--clay-ink)', padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 800, letterSpacing: '.3px' }}>
              <Icon name="shield" size={11} /> ANON</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--ink-3)', fontSize: 12, marginTop: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--sage)' }} />
            {onCount} relays · Nostr · tap to manage
          </div>
        </div>
        <Icon name="chevR" size={18} color="var(--ink-3)" />
      </button>

      <SectionLabel>Your groups</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, animation: 'lumenFade .5s ease .1s both' }}>
        {D.GROUPS.map(g => (
          <div key={g.id} onClick={() => ctx.openGroup(g)} style={{
            display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18,
            background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', boxShadow: 'var(--shadow)',
          }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{ width: 50, height: 50, borderRadius: 16, background: `color-mix(in oklab, ${g.accent} 16%, var(--surface))`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: g.accent }}>
                <Icon name={g.prayer ? 'pray' : 'chat'} size={25} stroke={1.8} />
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--ink-3)', flexShrink: 0 }}>{g.when}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
                <span style={{ fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{g.last}</span>
                {g.unread ? <span style={{ flexShrink: 0, minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: 'var(--clay)', color: '#fff', fontSize: 11.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{g.unread}</span> : null}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', padding: '1px 7px', borderRadius: 999, fontWeight: 600 }}>{g.kind}</span>
                · {g.members} members
              </div>
            </div>
          </div>
        ))}
      </div>
      </React.Fragment>
      )}

      <NostrSheet open={nostr} onClose={() => setNostr(false)} ctx={ctx} />
    </ScreenScroll>
  );
}

// ── message bubble ──
function Bubble({ m, onAmen, ctx }) {
  const me = m.me;
  const bg = me ? 'var(--clay)' : 'var(--surface)';
  const fg = me ? '#fff' : 'var(--ink)';

  if (m.kind === 'verse') {
    return (
      <Row me={me} m={m}>
        <div onClick={() => ctx.openShare(m.verse)} style={{
          maxWidth: 270, borderRadius: 18, padding: 0, overflow: 'hidden', cursor: 'pointer',
          background: 'linear-gradient(155deg, var(--clay), var(--clay-deep))', color: '#fff', boxShadow: 'var(--shadow)',
        }}>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: '.6px', opacity: .9, marginBottom: 7 }}>
              <Icon name="sparkle" size={13} stroke={2} color="#fff" /> SHARED A VERSE</div>
            <p style={{ fontFamily: 'var(--font-read)', fontSize: 17, lineHeight: 1.42, margin: '0 0 9px', fontWeight: 500, textWrap: 'pretty' }}>“{m.verse.text}”</p>
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>{m.verse.ref} · {m.verse.version}</div>
          </div>
        </div>
      </Row>
    );
  }

  if (m.kind === 'prayer') {
    return (
      <Row me={me} m={m}>
        <div style={{ maxWidth: 280, borderRadius: 18, padding: '13px 15px', background: 'var(--surface)',
          border: '1.5px solid color-mix(in oklab, var(--gold) 45%, var(--line))', boxShadow: 'var(--shadow)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: '.5px', color: 'var(--gold)', marginBottom: 6 }}>
            <Icon name="pray" size={14} color="var(--gold)" /> PRAYER REQUEST</div>
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 16, lineHeight: 1.5, margin: '0 0 11px', color: 'var(--ink)', textWrap: 'pretty' }}>{m.text}</p>
          <button onClick={() => onAmen(m.id)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid var(--line)',
            background: m._amened ? 'var(--clay-soft)' : 'var(--surface-2)', color: m._amened ? 'var(--clay-ink)' : 'var(--ink-2)',
            padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-ui)',
          }}>
            <Icon name="pray" size={15} fill={m._amened} /> Amen · {m.amens}</button>
        </div>
      </Row>
    );
  }

  return (
    <Row me={me} m={m}>
      <div style={{ maxWidth: 270, borderRadius: 18, padding: '10px 14px', background: bg, color: fg,
        border: me ? 'none' : '1px solid var(--line)', boxShadow: 'var(--shadow)',
        borderBottomRightRadius: me ? 5 : 18, borderBottomLeftRadius: me ? 18 : 5 }}>
        <p style={{ fontFamily: 'var(--font-ui)', fontSize: 14.5, lineHeight: 1.45, margin: 0, textWrap: 'pretty' }}>{m.text}</p>
      </div>
    </Row>
  );
}

function Row({ me, m, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: me ? 'flex-end' : 'flex-start', animation: 'lumenFade .3s ease both' }}>
      {!me ? <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '0 0 4px 4px' }}>
        <Avatar handle={m.handle} color={m.color} size={22} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)' }}>{m.handle}</span>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.when}</span>
      </div> : null}
      {children}
      {me ? <span style={{ fontSize: 11, color: 'var(--ink-3)', margin: '3px 4px 0' }}>{m.when}</span> : null}
    </div>
  );
}

// ── conversation room (overlay) ──
function ChatRoom({ group, open, onClose, ctx }) {
  const [msgs, setMsgs] = useC([]);
  const [draft, setDraft] = useC('');
  const id = useIdentity();
  const scRef = useCR();
  useCE(() => {
    if (group) setMsgs((window.LumenData.GROUP_MESSAGES[group.id] || []).map(m => ({ ...m })));
    setDraft('');
  }, [group]);
  useCE(() => {
    if (open && scRef.current) scRef.current.scrollTop = scRef.current.scrollHeight;
  }, [msgs, open]);

  if (!group) return null;

  const send = (extra) => {
    const base = { id: 'me-' + Date.now(), me: true, handle: id.handle, color: id.color, when: 'now' };
    setMsgs(prev => [...prev, { ...base, ...extra }]);
  };
  const sendText = () => { if (!draft.trim()) return; send({ text: draft.trim() }); setDraft(''); };
  const shareVerse = () => { send({ kind: 'verse', verse: { ...window.LumenData.VOTD } }); ctx.toast('Verse shared'); };
  const amen = (mid) => setMsgs(prev => prev.map(m => m.id === mid ? { ...m, _amened: !m._amened, amens: m.amens + (m._amened ? -1 : 1) } : m));

  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, background: 'color-mix(in oklab, var(--surface) 92%, transparent)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 14px 11px' }}>
          <button onClick={onClose} style={{ width: 38, height: 38, borderRadius: 12, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="chevL" size={22} /></button>
          <div style={{ width: 40, height: 40, borderRadius: 13, background: `color-mix(in oklab, ${group.accent} 16%, var(--surface))`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: group.accent, flexShrink: 0 }}>
            <Icon name={group.prayer ? 'pray' : 'chat'} size={22} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, lineHeight: 1.1 }}>{group.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--sage)' }} /> {group.members} anonymous · Nostr</div>
          </div>
          <IconBtn name="shield" onClick={() => ctx.toast('Everyone here is anonymous')} />
        </div>
      </div>

      <div ref={scRef} className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ textAlign: 'center', margin: '2px 0 4px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--ink-3)', padding: '6px 13px', borderRadius: 999, fontSize: 11.5, fontWeight: 600 }}>
            <Icon name="lock" size={13} /> Messages are anonymous & relayed over Nostr</span>
        </div>
        {msgs.map(m => <Bubble key={m.id} m={m} onAmen={amen} ctx={ctx} />)}
      </div>

      <div style={{ padding: '8px 12px 14px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9 }}>
          <button onClick={shareVerse} title="Share a verse" style={{ width: 44, height: 44, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface-2)', cursor: 'pointer', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="sparkle" size={20} /></button>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={1}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }}
            placeholder="Message anonymously…" style={{
              flex: 1, resize: 'none', minHeight: 44, maxHeight: 96, padding: '12px 15px', borderRadius: 16,
              border: '1px solid var(--line)', background: 'var(--surface-2)', outline: 'none', fontSize: 14.5,
              fontFamily: 'var(--font-ui)', color: 'var(--ink)', lineHeight: 1.35 }} />
          <button onClick={sendText} style={{ width: 44, height: 44, borderRadius: 14, border: 'none',
            background: draft.trim() ? 'var(--clay)' : 'var(--line)', cursor: draft.trim() ? 'pointer' : 'default',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background .2s' }}>
            <Icon name="send" size={20} color="#fff" /></button>
        </div>
      </div>
    </Overlay>
  );
}

Object.assign(window, { ChatScreen, ChatRoom });
