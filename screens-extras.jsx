// screens-extras.jsx — Listen (audio) page + Notifications page. Both full-screen overlays.
const { useState: useX } = React;

// ── Notifications (note 8) ──
function NotificationsScreen({ open, onClose, ctx }) {
  const D = window.TrinityData;
  const items = D.NOTIFICATIONS;
  const kindIcon = { message: 'chat', prayer: 'pray', giving: 'bolt', amen: 'heart', notice: 'bell', plan: 'plans' };
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, flexShrink: 0, borderBottom: '1px solid var(--line-2)',
        background: 'color-mix(in oklab, var(--paper) 92%, transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 14px' }}>
          <button onClick={onClose} aria-label="Back" style={{ width: 40, height: 40, borderRadius: 13, border: '1px solid var(--line)',
            background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow)' }}>
            <Icon name="chevL" size={20} /></button>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-.4px' }}>Notifications</h1>
          </div>
          <button onClick={() => ctx.toast('All caught up')} style={{ border: 'none', background: 'none', color: 'var(--clay)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Mark all read</button>
        </div>
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 30px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 10 }}>NEW</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 22 }}>
          {items.filter(n => n.unread).map(n => <NotifRow key={n.id} n={n} ic={kindIcon[n.kind]} onClick={() => { onClose(); ctx.go('chat'); }} />)}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 10 }}>EARLIER</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {items.filter(n => !n.unread).map(n => <NotifRow key={n.id} n={n} ic={kindIcon[n.kind]} onClick={() => { onClose(); ctx.go('chat'); }} />)}
        </div>
      </div>
    </Overlay>
  );
}

function NotifRow({ n, ic, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 14px', textAlign: 'left', width: '100%',
      borderRadius: 18, cursor: 'pointer', fontFamily: 'var(--font-ui)',
      background: n.unread ? 'var(--clay-soft)' : 'var(--surface)',
      border: n.unread ? '1px solid color-mix(in oklab, var(--clay) 22%, transparent)' : '1px solid var(--line)',
      boxShadow: n.unread ? 'none' : 'var(--shadow)',
    }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `color-mix(in oklab, ${n.accent} 16%, var(--surface))`, color: n.accent }}>
        <Icon name={ic} size={20} stroke={2} fill={n.kind === 'amen'} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{n.group}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 600, flexShrink: 0 }}>{n.time}</span>
        </div>
        <p style={{ margin: '3px 0 0', fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.4, textWrap: 'pretty' }}>
          <b style={{ color: 'var(--ink)', fontWeight: 700 }}>{n.who}</b> {n.text}
        </p>
      </div>
      {n.unread ? <div style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--clay)', flexShrink: 0, marginTop: 6 }} /> : null}
    </button>
  );
}

// ── Listen / audio (note 5) ──
function ListenScreen({ open, onClose, ctx }) {
  const D = window.TrinityData;
  const L = D.LISTEN;
  const [playing, setPlaying] = useX(true);
  const now = L.now;
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 6px' }}>
          <button onClick={onClose} aria-label="Back" style={{ width: 40, height: 40, borderRadius: 13, border: '1px solid var(--line)',
            background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow)' }}>
            <Icon name="chevL" size={20} /></button>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-.4px' }}>Listen</h1>
        </div>
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 30px' }}>
        {/* now playing */}
        <div style={{ borderRadius: 26, overflow: 'hidden', background: now.color, color: '#fff', padding: 22, marginBottom: 24, boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', opacity: .9 }}>
            <Icon name="headphones" size={16} stroke={2} color="#fff" /> Now playing
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '18px 0' }}>
            <div style={{ width: 72, height: 84, borderRadius: 14, background: 'rgba(255,255,255,.16)', display: 'flex', alignItems: 'flex-end', padding: 9, flexShrink: 0 }}>
              <span style={{ fontFamily: 'var(--font-display)', color: '#fff', fontWeight: 700, fontSize: 15, lineHeight: 1 }}>{now.tag}</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 700, lineHeight: 1.15 }}>{now.title}</div>
              <div style={{ fontSize: 13.5, opacity: .9, marginTop: 4 }}>{now.sub}</div>
              <div style={{ fontSize: 12, opacity: .7, marginTop: 2 }}>{now.reader}</div>
            </div>
          </div>
          {/* scrubber */}
          <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,.25)', overflow: 'hidden' }}>
            <div style={{ width: `${now.pos * 100}%`, height: '100%', background: '#fff', borderRadius: 3 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 600, opacity: .85, marginTop: 7 }}>
            <span>{now.at}</span><span>-{now.len}</span>
          </div>
          {/* transport */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 26, marginTop: 16 }}>
            <button onClick={() => ctx.toast('Back 15s')} aria-label="Rewind" style={transBtn}><Icon name="rewind" size={26} color="#fff" /></button>
            <button onClick={() => setPlaying(p => !p)} aria-label="Play/pause" style={{
              width: 64, height: 64, borderRadius: 999, border: 'none', cursor: 'pointer', background: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 18px rgba(0,0,0,.25)' }}>
              <Icon name={playing ? 'pause' : 'play'} size={26} color="var(--ink)" />
            </button>
            <button onClick={() => ctx.toast('Forward 15s')} aria-label="Forward" style={transBtn}><Icon name="forward" size={26} color="#fff" /></button>
          </div>
        </div>

        {/* up next */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 12 }}>UP NEXT</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {L.queue.map(a => (
            <button key={a.id} onClick={() => ctx.toast('Playing · ' + a.title)} style={{
              display: 'flex', alignItems: 'center', gap: 13, padding: 13, width: '100%', textAlign: 'left', cursor: 'pointer',
              borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', fontFamily: 'var(--font-ui)' }}>
              <div style={{ width: 46, height: 46, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `color-mix(in oklab, ${a.accent} 15%, var(--surface))`, color: a.accent }}>
                <Icon name={a.ic} size={22} stroke={1.9} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', lineHeight: 1.2 }}>{a.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 2 }}>{a.sub}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>{a.dur}</span>
                <Icon name="play" size={18} color="var(--clay)" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </Overlay>
  );
}

const transBtn = { width: 44, height: 44, borderRadius: 999, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };

// ── Search as a page (note 3 — moved off the tab bar) ──
function SearchOverlay({ open, onClose, ctx }) {
  return (
    <Overlay open={open} onClose={onClose}>
      {open ? <SearchScreen ctx={ctx} onBack={onClose} /> : null}
    </Overlay>
  );
}

Object.assign(window, { NotificationsScreen, ListenScreen, SearchOverlay });
