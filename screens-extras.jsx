// screens-extras.jsx — Listen (audio) page + Notifications page. Both full-screen overlays.
const { useState: useX } = React;

// ── Notifications (note 8) ──
function relTimeNotif(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

const NOTIF_ICON = { message: 'chat', prayer: 'pray', giving: 'bolt', amen: 'heart', notice: 'bell', plan: 'plans', network: 'globe', devotional: 'read', event: 'calendar' };
const NOTIF_ACCENT = { network: 'var(--clay)', notice: 'var(--clay)', devotional: 'var(--sage)', plan: 'var(--gold)', event: 'var(--clay)' };

function NotificationsScreen({ open, onClose, ctx }) {
  const [detail, setDetail] = useX(null);   // a notification opened for its full text
  const netSeen = (() => { try { return Number(localStorage.getItem('trinityone.net-seen') || 0); } catch { return 0; } })();
  const items = (ctx.notifications || []).map(n => ({ ...n, time: relTimeNotif(n.ts), unread: (n.ts || 0) > netSeen, accent: NOTIF_ACCENT[n.kind] || 'var(--clay)' }));
  // mark seen when this screen opens
  React.useEffect(() => { if (open && ctx.markNetSeen) ctx.markNetSeen(); }, [open]);
  const onRowClick = (n) => {
    if (n.devo) { onClose(); ctx.openChurchDevo(n.devo); return; }
    if (n.go === 'plans') { onClose(); ctx.openPlans && ctx.openPlans(); return; }
    if (n.go === 'event' && n.event) { onClose(); ctx.openEvent ? ctx.openEvent(n.event) : (ctx.openServing && ctx.openServing()); return; }
    if (n.go === 'serving') { onClose(); ctx.openServing && ctx.openServing(); return; }
    if (n.groupObj && ctx.openGroup) { onClose(); ctx.openGroup(n.groupObj); return; }   // broadcast: open its chat
    if (n.go === 'chat') { onClose(); ctx.go('chat'); return; }
    setDetail(n);   // network announcement: show the full message
  };
  const newItems = items.filter(n => n.unread);
  const earlierItems = items.filter(n => !n.unread);
  return (
    <Overlay open={open} onClose={onClose}>
      {detail ? (
        <div onClick={() => setDetail(null)} style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(20,15,10,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '80%', overflowY: 'auto', background: 'var(--surface)', borderRadius: '22px 22px 0 0', border: '1px solid var(--line)', borderBottom: 'none', boxShadow: 'var(--shadow-lg)', padding: '20px 20px 30px', animation: 'trinityRise .24s cubic-bezier(.2,.8,.3,1) both' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, flexShrink: 0, background: `color-mix(in oklab, ${detail.accent} 16%, var(--surface))`, color: detail.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={NOTIF_ICON[detail.kind] || 'bell'} size={21} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>{detail.group}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{detail.kind === 'network' ? 'Network announcement' : 'Announcement'} · {relTimeNotif(detail.ts)}</div>
              </div>
              <button onClick={() => setDetail(null)} style={{ border: 'none', background: 'var(--surface-2)', borderRadius: 999, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}><Icon name="x" size={17} /></button>
            </div>
            <p style={{ fontFamily: 'var(--font-read)', fontSize: 17, lineHeight: 1.6, color: 'var(--ink)', margin: 0, textWrap: 'pretty', whiteSpace: 'pre-wrap' }}>{detail.text}</p>
          </div>
        </div>
      ) : null}
      <div style={{ paddingTop: 50, flexShrink: 0, borderBottom: '1px solid var(--line-2)',
        background: 'color-mix(in oklab, var(--paper) 92%, transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 14px' }}>
          <button onClick={onClose} aria-label="Back" style={{ width: 40, height: 40, borderRadius: 13, border: '1px solid var(--line)',
            background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow)' }}>
            <Icon name="chevL" size={20} /></button>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-.4px' }}>Notifications</h1>
          </div>
          {items.length ? <button onClick={() => { if (ctx.markNetSeen) ctx.markNetSeen(); ctx.toast('All caught up'); }} style={{ border: 'none', background: 'none', color: 'var(--clay)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Mark all read</button> : null}
        </div>
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 30px' }}>
        {!items.length ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--ink-3)' }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}><Icon name="bell" size={26} color="var(--ink-3)" /></div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: 'var(--ink-2)' }}>You’re all caught up</div>
            <p style={{ fontSize: 14, lineHeight: 1.5, maxWidth: 250, margin: '6px auto 0' }}>When your church shares a devotional, plan, event, or announcement, it’ll show up here.</p>
          </div>
        ) : null}
        {newItems.length ? <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 10 }}>NEW</div> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 22 }}>
          {newItems.map(n => <NotifRow key={n.id} n={n} ic={NOTIF_ICON[n.kind] || 'bell'} onClick={() => onRowClick(n)} />)}
        </div>
        {earlierItems.length ? <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 10 }}>EARLIER</div> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {earlierItems.map(n => <NotifRow key={n.id} n={n} ic={NOTIF_ICON[n.kind] || 'bell'} onClick={() => onRowClick(n)} />)}
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

// ── Listen / audio: streams the church's podcast feed (set in the steward console) ──
const lsnClock = (s) => { s = Math.floor(s || 0); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); };
const lsnPubDate = (s) => { try { const d = new Date(s); if (isNaN(d)) return ''; return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; } };

function ListenScreen({ open, onClose, ctx }) {
  const audioFeed = (ctx.church && ctx.church.audioFeed) || '';
  const [data, setData] = useX(null);     // { channel, episodes }
  const [loading, setLoading] = useX(false);
  const audio = useTrinityAudio();         // persistent player state — survives closing this screen
  const FS = window.Fellowship;

  React.useEffect(() => {
    if (!open || !audioFeed) { if (!audioFeed) setData({ episodes: [] }); return; }
    const base = FS && FS.gatewayBase && FS.gatewayBase();
    if (!base) { setData({ episodes: [], error: 'offline' }); return; }
    setLoading(true);
    fetch(base + '/audiofeed?url=' + encodeURIComponent(audioFeed))
      .then(r => r.json()).then(d => setData(d || { episodes: [] }))
      .catch(() => setData({ episodes: [] }))
      .then(() => setLoading(false));
  }, [open, audioFeed]);

  const episodes = (data && data.episodes) || [];
  const chName = (data && data.channel && data.channel.name) || 'Sermons';
  const trackOf = (ep) => ({ id: ep.id, title: ep.title, subtitle: [lsnPubDate(ep.published), chName].filter(Boolean).join(' · '), src: ep.audio, image: ep.image, album: chName });
  const curId = audio.track && audio.track.id;
  const cur = episodes.find(e => e.id === curId) || null;
  const playing = audio.playing;
  const pos = { t: audio.t, d: audio.d };
  const playEp = (ep) => { if (!ep.audio) { ctx.toast('That episode has no audio'); return; } window.TrinityAudio.play(trackOf(ep), episodes.map(trackOf)); };
  const toggle = () => window.TrinityAudio.toggle();
  const seek = (delta) => window.TrinityAudio.seek(delta);
  const onBar = (e) => { const r = e.currentTarget.getBoundingClientRect(); window.TrinityAudio.seekTo((e.clientX - r.left) / r.width); };

  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 6px' }}>
          <button onClick={onClose} aria-label="Back" style={{ width: 40, height: 40, borderRadius: 13, border: '1px solid var(--line)',
            background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow)' }}>
            <Icon name="chevL" size={20} /></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-.4px' }}>Listen</h1>
            {data && data.channel && data.channel.name ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{data.channel.name}</div> : null}
          </div>
        </div>
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 30px' }}>
        {loading && !episodes.length ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--ink-3)' }}><div style={{ width: 26, height: 26, margin: '0 auto', borderRadius: 999, border: '2.5px solid var(--line)', borderTopColor: 'var(--clay)', animation: 'trinitySpin .8s linear infinite' }} /><p style={{ marginTop: 14, fontSize: 14 }}>Loading episodes…</p></div>
        ) : null}
        {!loading && !episodes.length ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--ink-3)' }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}><Icon name="headphones" size={26} color="var(--ink-3)" /></div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: 'var(--ink-2)' }}>Nothing to listen to yet</div>
            <p style={{ fontSize: 14, lineHeight: 1.5, maxWidth: 260, margin: '6px auto 0' }}>{audioFeed ? 'Your church’s audio will appear here soon.' : 'Your church hasn’t added an audio feed yet.'}</p>
          </div>
        ) : null}

        {/* now playing */}
        {cur ? (
          <div style={{ borderRadius: 26, overflow: 'hidden', background: 'linear-gradient(155deg, var(--clay), var(--clay-deep))', color: '#fff', padding: 22, marginBottom: 24, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', opacity: .9 }}>
              <Icon name="headphones" size={16} stroke={2} color="#fff" /> Now playing
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '18px 0' }}>
              <div style={{ width: 72, height: 72, borderRadius: 16, background: cur.image ? `center/cover url(${cur.image})` : 'rgba(255,255,255,.16)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{!cur.image ? <Icon name="headphones" size={28} color="#fff" /> : null}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700, lineHeight: 1.15 }}>{cur.title}</div>
                <div style={{ fontSize: 12.5, opacity: .85, marginTop: 4 }}>{[lsnPubDate(cur.published), cur.duration].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
            <div onClick={onBar} style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,.25)', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ width: `${pos.d ? (pos.t / pos.d) * 100 : 0}%`, height: '100%', background: '#fff', borderRadius: 3 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 600, opacity: .85, marginTop: 7 }}>
              <span>{lsnClock(pos.t)}</span><span>{pos.d ? lsnClock(pos.d) : (cur.duration || '')}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 26, marginTop: 16 }}>
              <button onClick={() => seek(-15)} aria-label="Back 15s" style={transBtn}><Icon name="rewind" size={26} color="#fff" /></button>
              <button onClick={toggle} aria-label="Play/pause" style={{ width: 64, height: 64, borderRadius: 999, border: 'none', cursor: 'pointer', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 18px rgba(0,0,0,.25)' }}>
                <Icon name={playing ? 'pause' : 'play'} size={26} color="var(--ink)" />
              </button>
              <button onClick={() => seek(15)} aria-label="Forward 15s" style={transBtn}><Icon name="forward" size={26} color="#fff" /></button>
            </div>
          </div>
        ) : null}

        {/* episode list */}
        {episodes.length ? (
          <React.Fragment>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 12 }}>EPISODES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {episodes.map(ep => {
                const isCur = cur && cur.id === ep.id;
                return (
                  <button key={ep.id} onClick={() => (isCur ? toggle() : playEp(ep))} style={{
                    display: 'flex', alignItems: 'center', gap: 13, padding: 13, width: '100%', textAlign: 'left', cursor: 'pointer',
                    borderRadius: 18, background: isCur ? 'color-mix(in oklab, var(--clay) 8%, var(--surface))' : 'var(--surface)', border: '1px solid ' + (isCur ? 'color-mix(in oklab, var(--clay) 30%, var(--line))' : 'var(--line)'), boxShadow: 'var(--shadow)', fontFamily: 'var(--font-ui)' }}>
                    <div style={{ width: 46, height: 46, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: ep.image ? `center/cover url(${ep.image})` : 'color-mix(in oklab, var(--clay) 15%, var(--surface))', color: 'var(--clay)' }}>{!ep.image ? <Icon name={isCur && playing ? 'pause' : 'play'} size={20} color="var(--clay)" /> : null}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--ink)', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{ep.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>{[lsnPubDate(ep.published), ep.duration].filter(Boolean).join(' · ')}</div>
                    </div>
                    <Icon name={isCur && playing ? 'pause' : 'play'} size={18} color="var(--clay)" style={{ flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>
          </React.Fragment>
        ) : null}
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
