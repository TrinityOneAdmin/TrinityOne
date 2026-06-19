// screens-watch.jsx — "Watch" tab: the church's YouTube videos.
// Data comes from the bundled trinity-videos.json (window.Bible.getVideos());
// inside the APK that can refresh live from the channel RSS feed.
const { useState: useW } = React;

function parseYT(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(url.trim())) return url.trim();
  return null;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function openExternal(url) {
  if (url) window.open(url, '_blank', 'noopener');
}

// Real YouTube thumbnail when available; warm gradient fallback otherwise.
function VideoPoster({ v, h = 200, rounded = 20 }) {
  const [err, setErr] = useW(false);
  const accent = v.accent || 'var(--clay)';
  const showThumb = v.thumb && !err;
  return (
    <div style={{
      position: 'relative', height: h, borderRadius: rounded, overflow: 'hidden',
      background: `linear-gradient(150deg, ${accent}, color-mix(in oklab, ${accent} 55%, #16120c))`,
    }}>
      {showThumb
        ? <img src={v.thumb} alt="" loading="lazy" onError={() => setErr(true)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        : <div style={{ position: 'absolute', right: -22, bottom: -26, opacity: .16 }}><Icon name={v.icon || 'play'} size={Math.round(h * 0.9)} stroke={1.2} color="#fff" /></div>}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,.30), transparent 48%)' }} />
      {/* play button */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 54, height: 54, borderRadius: 999, background: 'rgba(255,255,255,.92)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 20px rgba(0,0,0,.3)' }}>
          <Icon name="play" size={22} color="var(--clay-ink)" />
        </div>
      </div>
      {v.live ? <span style={{ position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 5,
        background: '#e0322f', color: '#fff', padding: '4px 9px', borderRadius: 7, fontSize: 11, fontWeight: 800, letterSpacing: '.5px' }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }} />LIVE</span> : null}
      {v.dur ? <span style={{ position: 'absolute', bottom: 10, right: 10, background: 'rgba(0,0,0,.7)', color: '#fff',
        padding: '3px 8px', borderRadius: 7, fontSize: 11.5, fontWeight: 700 }}>{v.dur}</span> : null}
    </div>
  );
}

function VideoRow({ v, onClick }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', gap: 12, cursor: 'pointer' }}>
      <div style={{ width: 150, flexShrink: 0 }}><VideoPoster v={v} h={86} rounded={14} /></div>
      <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14.5, lineHeight: 1.22,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{v.title}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 5 }}>{fmtDate(v.published)}</div>
      </div>
    </div>
  );
}

// church avatar (real image; initial-letter fallback)
function ChannelAvatar({ ch, size = 56 }) {
  const [err, setErr] = useW(false);
  if (ch.avatar && !err) {
    return <img src={ch.avatar} alt="" onError={() => setErr(true)}
      style={{ width: size, height: size, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }} />;
  }
  return <div style={{ width: size, height: size, borderRadius: 999, background: 'var(--clay)', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800,
    fontFamily: 'var(--font-display)', fontSize: size * 0.4 }}>{(ch.name || '?')[0]}</div>;
}

function WatchView({ ctx }) {
  const [data, setData] = useW(null);
  const [paste, setPaste] = useW('');
  const channelUrl = (ctx.church && ctx.church.channel) || '';
  React.useEffect(() => {
    let alive = true; setData(null);
    const done = (d) => { if (alive) setData(d || { channel: null, videos: [] }); };
    const FS = window.Fellowship;
    if (channelUrl && FS && FS.gatewayBase && FS.gatewayBase()) {
      // the church set a YouTube/Rumble channel — the gateway fetches its feed for us (CORS-free)
      fetch(FS.gatewayBase() + '/feed?url=' + encodeURIComponent(channelUrl))
        .then(r => r.json()).then(done).catch(() => done({ channel: null, videos: [] }));
    } else {
      window.Bible.getVideos().then(done);
    }
    return () => { alive = false; };
  }, [channelUrl]);

  const add = () => {
    const id = parseYT(paste);
    if (!id) { ctx.toast('Paste a valid YouTube link'); return; }
    ctx.openVideo({ id: 'paste-' + id, title: 'Your video', ytId: id, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      published: '', desc: 'Added from a YouTube link.' });
    setPaste('');
  };

  // the "paste a YouTube link" box — shown whether or not a channel/feed is configured, so a member
  // can always loop in their own video.
  const pasteBox = (
    <div style={{ marginTop: 24, padding: 16, borderRadius: 20, background: 'var(--surface-2)', border: '1px dashed color-mix(in oklab, var(--clay) 40%, var(--line))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon name="plus" size={17} color="var(--clay)" stroke={2.4} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>Loop in a video</span>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.4 }}>Paste any YouTube link and it plays right here.</p>
      <div style={{ display: 'flex', gap: 9 }}>
        <input value={paste} onChange={e => setPaste(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }}
          placeholder="youtube.com/watch?v=…" style={{ flex: 1, minWidth: 0, height: 44, padding: '0 14px', borderRadius: 13,
          border: '1px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 14, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }} />
        <button onClick={add} style={{ border: 'none', background: 'var(--clay)', color: '#fff', padding: '0 18px', borderRadius: 13,
          fontWeight: 700, fontSize: 14.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', flexShrink: 0 }}>Add</button>
      </div>
    </div>
  );

  if (!data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 50, color: 'var(--ink-3)', gap: 14 }}>
        <div style={{ width: 24, height: 24, borderRadius: 999, border: '2.5px solid var(--clay-soft)', borderTopColor: 'var(--clay)', animation: 'trinitySpin .8s linear infinite' }} />
      </div>
    );
  }

  const ch = data.channel || null;
  const videos = data.videos || [];

  // no channel feed yet — invite the member to add their own
  if (!videos.length) {
    return (
      <div style={{ animation: 'trinityFade .4s ease both' }}>
        <div style={{ textAlign: 'center', padding: '28px 16px 6px', color: 'var(--ink-3)' }}>
          <div style={{ width: 54, height: 54, borderRadius: 16, background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}><Icon name="play" size={26} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: 'var(--ink)', marginBottom: 5 }}>No videos yet</div>
          <p style={{ fontSize: 14, lineHeight: 1.5, maxWidth: 280, margin: '0 auto' }}>Paste a YouTube link below to watch it here, or your church will add their videos.</p>
        </div>
        {pasteBox}
      </div>
    );
  }

  const featured = videos[0];
  const rest = videos.slice(1);

  return (
    <div style={{ animation: 'trinityFade .4s ease both' }}>
      {/* channel header — only when a channel is configured */}
      {ch ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <ChannelAvatar ch={ch} size={56} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, lineHeight: 1.15 }}>{ch.name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{ch.handle} · YouTube</div>
          </div>
          {ch.url ? <button onClick={() => openExternal(ch.url)} style={{ border: 'none', background: 'var(--ink)', color: 'var(--paper)',
            padding: '9px 15px', borderRadius: 999, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)', flexShrink: 0 }}>
            Channel
          </button> : null}
        </div>
      ) : null}

      {/* featured (latest) */}
      <div onClick={() => ctx.openVideo(featured)} style={{ cursor: 'pointer', marginBottom: 22 }}>
        <VideoPoster v={featured} h={196} />
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16.5, lineHeight: 1.22, marginTop: 11 }}>{featured.title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 3 }}>{[ch && ch.name, fmtDate(featured.published)].filter(Boolean).join(' · ')}</div>
      </div>

      {/* list */}
      <SectionLabel>Latest</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {rest.map(v => <VideoRow key={v.id} v={v} onClick={() => ctx.openVideo(v)} />)}
      </div>

      {pasteBox}
    </div>
  );
}

// ── player overlay ──
function VideoPlayer({ video, open, onClose, ctx }) {
  const [liveId, setLiveId] = useW(null);
  const [data, setData] = useW(null);
  React.useEffect(() => { if (open) window.Bible.getVideos().then(setData); }, [open]);
  React.useEffect(() => { if (open) setLiveId(video && video.ytId ? video.ytId : null); }, [open, video]);
  if (!video) return null;
  const ch = (data && data.channel) || {};
  const more = ((data && data.videos) || []).filter(v => v.id !== video.id).slice(0, 4);

  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 14px 8px' }}>
          <IconBtn name="chevD" onClick={onClose} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>Watch</span>
          <IconBtn name="share" onClick={() => { openExternal(`https://youtu.be/${video.ytId}`); }} />
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', paddingBottom: 30 }}>
        {/* video frame */}
        <div style={{ margin: '0 14px', borderRadius: 18, overflow: 'hidden', background: '#000', aspectRatio: '16/9', position: 'relative' }}>
          {liveId ? (
            <iframe title="video" width="100%" height="100%" style={{ border: 'none', display: 'block' }}
              src={`https://www.youtube-nocookie.com/embed/${liveId}?autoplay=1&rel=0&modestbranding=1`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
          ) : (
            <div onClick={() => setLiveId(video.ytId || null)} style={{ position: 'absolute', inset: 0, cursor: 'pointer' }}>
              <VideoPoster v={video} h={9999} rounded={0} />
            </div>
          )}
        </div>

        <div style={{ padding: '14px 18px 0' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, margin: 0, lineHeight: 1.18 }}>{video.title}</h1>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 5 }}>{fmtDate(video.published)}</div>

          {/* channel row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, margin: '16px 0', paddingBottom: 16, borderBottom: '1px solid var(--line)' }}>
            <ChannelAvatar ch={ch} size={42} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{ch.name || 'Church'}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{ch.handle || 'YouTube'}</div>
            </div>
            <button onClick={() => openExternal(ch.url)} style={{ border: 'none', background: 'var(--ink)', color: 'var(--paper)', padding: '9px 16px', borderRadius: 999, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Channel</button>
          </div>

          {video.desc ? <p style={{ fontFamily: 'var(--font-read)', fontSize: 16, lineHeight: 1.6, color: 'var(--ink)', margin: '0 0 22px', textWrap: 'pretty' }}>{video.desc}</p> : null}

          {more.length ? <React.Fragment>
            <SectionLabel>Up next</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {more.map(v => <VideoRow key={v.id} v={v} onClick={() => ctx.openVideo(v)} />)}
            </div>
          </React.Fragment> : null}
        </div>
      </div>
    </Overlay>
  );
}

Object.assign(window, { WatchView, VideoPlayer, parseYT });
