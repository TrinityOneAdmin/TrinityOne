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
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });   // undefined → the device's own locale (nationality-agnostic)
}

function openExternal(url) {
  if (url) window.open(url, '_blank', 'noopener');
}

// Real YouTube thumbnail when available; warm gradient fallback otherwise.
function VideoPoster({ v, h = 200, rounded = 20 }) {
  const [err, setErr] = useW(false);
  const accent = safeCssColor(v.accent);   // SECURITY-AUDIT-2026-07-06 H2/L6: no url() beacon via a crafted accent
  // SECURITY-AUDIT-2026-07-06 M8-family: v.thumb comes from an untrusted video doc; a remote thumb URL would
  // beacon every viewer's IP. Legit thumbs are always YouTube's i.ytimg.com — accept only that host.
  const thumb = /^https:\/\/i\.ytimg\.com\//.test(v.thumb || '') ? v.thumb : '';
  const showThumb = thumb && !err;
  return (
    <div style={{
      position: 'relative', height: h, borderRadius: rounded, overflow: 'hidden',
      background: `linear-gradient(150deg, ${accent}, color-mix(in oklab, ${accent} 55%, #16120c))`,
    }}>
      {showThumb
        ? <img src={thumb} alt="" loading="lazy" onError={() => setErr(true)}
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

// a self-hosted sermon row (audio or video) — the church's own, relay-hosted media
function SermonRow({ s, loading, onClick }) {
  const isVideo = String(s.mime || '').startsWith('video');
  const sz = s.size > 1048576 ? (s.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((s.size || 0) / 1024)) + ' KB';
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 13, width: '100%', textAlign: 'left', cursor: 'pointer', borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', fontFamily: 'var(--font-ui)' }}>
      <div style={{ width: 46, height: 46, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, var(--clay) 15%, var(--surface))' }}><Icon name={isVideo ? 'play' : 'headphones'} size={20} color="var(--clay)" /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--ink)', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{s.title}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>{[isVideo ? 'Video' : 'Audio', sz, s.ts ? fmtDate(s.ts * 1000) : null, 'members only', s.enc ? 'encrypted' : null].filter(Boolean).join(' · ')}</div>
      </div>
      {loading
        ? <div style={{ width: 18, height: 18, flexShrink: 0, borderRadius: 999, border: '2.5px solid var(--line)', borderTopColor: 'var(--clay)', animation: 'trinitySpin .8s linear infinite' }} />
        : <Icon name="play" size={18} color="var(--clay)" style={{ flexShrink: 0 }} />}
    </button>
  );
}

function WatchView({ ctx }) {
  const [data, setData] = useW(null);
  const [sermons, setSermons] = useW([]);   // Tier 2: ALL self-hosted sermons (audio + video) — the church's own media
  const [loadingId, setLoadingId] = useW(null);
  const [sermonsReady, setSermonsReady] = useW(false);   // U8: tell "still loading" apart from "genuinely none" so the empty state can't flash on a slow relay
  const channelUrl = (ctx.church && ctx.church.channel) || '';
  const churchNpub = ctx.church && ctx.church.npub;
  const chName = (ctx.church && ctx.church.name) || 'your church';
  React.useEffect(() => {
    setSermonsReady(false);
    const FS = window.Fellowship;
    if (!churchNpub || !FS || !FS.subscribeSermons) { setSermons([]); setSermonsReady(true); return; }
    return FS.subscribeSermons(churchNpub, (l) => { setSermons(l); setSermonsReady(true); });
  }, [churchNpub]);
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

  // play a self-hosted sermon: video opens the player; audio plays in the persistent mini-player
  const playSelf = async (s) => {
    const isVideo = String(s.mime || '').startsWith('video');
    const hosts = (s.hosts && s.hosts.length) ? s.hosts : (s.host ? [s.host] : []);
    if (!hosts.length || !s.sha256) { ctx.toast('This sermon is unavailable'); return; }
    if (isVideo) { ctx.openVideo({ id: s.id, title: s.title, desc: s.desc, _sermon: true, sha256: s.sha256, hosts, mime: s.mime, enc: s.enc, size: s.size, published: s.ts ? new Date(s.ts * 1000).toISOString() : '' }); return; }
    setLoadingId(s.id);
    try {
      const FS = window.Fellowship;
      const dec = s.enc && FS.mediaDecryptor ? await FS.mediaDecryptor(churchNpub) : null;
      if (s.enc && !dec) { ctx.toast('This encrypted sermon needs the church media key'); setLoadingId(null); return; }
      const src = await FS.fetchSermon({ sha256: s.sha256, hosts, mime: s.mime, enc: s.enc }, { mime: s.mime || 'audio/mpeg', decrypt: dec });
      window.TrinityAudio.play({ id: s.id, title: s.title, subtitle: chName, src, album: chName });
    } catch (e) { ctx.toast('Couldn’t load: ' + (e.message || 'error')); }
    setLoadingId(null);
  };

  if (!data || !sermonsReady) {   // U8: wait for BOTH the channel feed AND the sermons sub before deciding it's empty
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 50, color: 'var(--ink-3)', gap: 14 }}>
        <div style={{ width: 24, height: 24, borderRadius: 999, border: '2.5px solid var(--clay-soft)', borderTopColor: 'var(--clay)', animation: 'trinitySpin .8s linear infinite' }} />
      </div>
    );
  }

  const ch = data.channel || null;
  const ytVideos = data.videos || [];
  const hasChurch = sermons.length > 0;
  // U7: audio lives in a "Watch" tab, so a listener wouldn't look here. When a church has both, split the group
  // into a "Listen" (audio) and a "Watch" (video) sub-head so audio is findable; homogeneous groups need no split.
  const audioSermons = sermons.filter(s => !String(s.mime || '').startsWith('video'));
  const videoSermons = sermons.filter(s => String(s.mime || '').startsWith('video'));
  const bothTypes = audioSermons.length > 0 && videoSermons.length > 0;
  const hasYT = ytVideos.length > 0;

  if (!hasChurch && !hasYT) {
    return (
      <div style={{ animation: 'trinityFade .4s ease both' }}>
        <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--ink-3)' }}>
          <div style={{ width: 54, height: 54, borderRadius: 16, background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}><Icon name="play" size={26} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: 'var(--ink)', marginBottom: 5 }}>Nothing to watch yet</div>
          <p style={{ fontSize: 14, lineHeight: 1.5, maxWidth: 280, margin: '0 auto' }}>Your church’s sermons and videos will appear here.</p>
        </div>
      </div>
    );
  }

  const ytFeatured = hasYT ? ytVideos[0] : null;
  const ytRest = hasYT ? ytVideos.slice(1) : [];

  return (
    <div style={{ animation: 'trinityFade .4s ease both' }}>
      {/* GROUP 1 — the church's own, relay-hosted sermons (audio + video) */}
      {hasChurch ? (
        <React.Fragment>
          <SectionLabel>From {chName}</SectionLabel>
          {audioSermons.length ? (
            <React.Fragment>
              {bothTypes ? <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', textTransform: 'uppercase', margin: '0 2px 8px' }}><Icon name="headphones" size={13} color="var(--ink-3)" /> Listen</div> : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: (videoSermons.length || hasYT) ? 22 : 0 }}>
                {audioSermons.map(s => <SermonRow key={s.id} s={s} loading={loadingId === s.id} onClick={() => playSelf(s)} />)}
              </div>
            </React.Fragment>
          ) : null}
          {videoSermons.length ? (
            <React.Fragment>
              {bothTypes ? <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', textTransform: 'uppercase', margin: '0 2px 8px' }}><Icon name="play" size={13} color="var(--ink-3)" /> Watch</div> : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: hasYT ? 28 : 0 }}>
                {videoSermons.map(s => <SermonRow key={s.id} s={s} loading={loadingId === s.id} onClick={() => playSelf(s)} />)}
              </div>
            </React.Fragment>
          ) : null}
        </React.Fragment>
      ) : null}

      {/* GROUP 2 — the church's YouTube / Rumble channel */}
      {hasYT ? (
        <React.Fragment>
          {ch ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <ChannelAvatar ch={ch} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5, lineHeight: 1.15 }}>{ch.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{ch.handle} · YouTube</div>
              </div>
              {ch.url ? <button onClick={() => openExternal(ch.url)} style={{ border: 'none', background: 'var(--ink)', color: 'var(--paper)', padding: '8px 14px', borderRadius: 999, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', flexShrink: 0 }}>Channel</button> : null}
            </div>
          ) : <SectionLabel>Videos</SectionLabel>}
          {ytFeatured ? (
            <div onClick={() => ctx.openVideo(ytFeatured)} style={{ cursor: 'pointer', marginBottom: 18 }}>
              <VideoPoster v={ytFeatured} h={196} />
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16.5, lineHeight: 1.22, marginTop: 11 }}>{ytFeatured.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 3 }}>{[ch && ch.name, fmtDate(ytFeatured.published)].filter(Boolean).join(' · ')}</div>
            </div>
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {ytRest.map(v => <VideoRow key={v.id} v={v} onClick={() => ctx.openVideo(v)} />)}
          </div>
        </React.Fragment>
      ) : null}
    </div>
  );
}

// Download/decrypt feedback for a self-hosted sermon. Web streams so we show a live % + bar;
// native (CapacitorHttp) can't report mid-download, so we show the size + a spinner honestly.
function SermonLoading({ prog, enc, onCancel }) {
  const fmtMB = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const total = prog && prog.total > 0 ? prog.total : 0;
  const loaded = prog ? prog.loaded : 0;
  const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  const done = total > 0 && loaded >= total;   // bytes are in — now verifying/decrypting
  const label = done ? (enc ? 'Decrypting…' : 'Finishing…')
    : total ? `Downloading… ${pct}%`
    : (loaded ? `Downloading… ${fmtMB(loaded)}` : 'Downloading…');
  return (
    <>
      {total && !done
        ? <div style={{ width: '78%', maxWidth: 240, height: 5, borderRadius: 999, background: 'rgba(255,255,255,.22)', overflow: 'hidden' }}>
            <div style={{ width: pct + '%', height: '100%', background: '#fff', borderRadius: 999, transition: 'width .2s ease' }} />
          </div>
        : <div style={{ width: 26, height: 26, borderRadius: 999, border: '2.5px solid rgba(255,255,255,.3)', borderTopColor: '#fff', animation: 'trinitySpin .8s linear infinite' }} />}
      <div>{label}{enc && !done ? <div style={{ fontSize: 11, opacity: .7, marginTop: 3 }}>Encrypted — the whole video downloads before it plays</div> : null}</div>
      {onCancel ? <button onClick={onCancel} style={{ marginTop: 2, padding: '5px 14px', borderRadius: 999, border: 'none', background: 'transparent', color: 'rgba(255,255,255,.75)', fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}>Cancel</button> : null}
    </>
  );
}

// ── player overlay ──
function VideoPlayer({ video, open, onClose, ctx }) {
  const [liveId, setLiveId] = useW(null);
  const [data, setData] = useW(null);
  const [selfSrc, setSelfSrc] = useW(null);   // Tier 2: object URL for a self-hosted (member-gated) video blob
  const [selfErr, setSelfErr] = useW('');
  const [prog, setProg] = useW(null);         // { loaded, total } bytes while downloading (web reports live; native reports on completion)
  const [retry, setRetry] = useW(0);          // bump to re-attempt after an error
  const abortRef = React.useRef(null);
  const watchdog = React.useRef(null);        // fires if <video> neither plays nor errors (silent codec stall)
  React.useEffect(() => { if (open) window.Bible.getVideos().then(setData); }, [open]);
  React.useEffect(() => { if (open) setLiveId(video && video.ytId ? video.ytId : null); }, [open, video]);
  React.useEffect(() => {
    if (!open || !video || !video._sermon) { setSelfSrc(null); setSelfErr(''); setProg(null); return; }
    let url = null, alive = true; const FS = window.Fellowship; setSelfErr(''); setProg(null);
    const ac = (typeof AbortController !== 'undefined') ? new AbortController() : null; abortRef.current = ac;
    (async () => {
      try {
        const dec = video.enc && FS.mediaDecryptor ? await FS.mediaDecryptor(ctx.church && ctx.church.npub) : null;
        if (video.enc && !dec) { if (alive) setSelfErr('This encrypted video needs the church media key'); return; }
        url = await FS.fetchSermon(
          { sha256: video.sha256, hosts: video.hosts, mime: video.mime, enc: video.enc },
          { mime: video.mime || 'video/mp4', decrypt: dec, total: video.size || 0,
            signal: ac && ac.signal, onProgress: (loaded, total) => { if (alive) setProg({ loaded, total }); } });
        if (alive) setSelfSrc(url); else URL.revokeObjectURL(url);
      } catch (e) {
        if (!alive) return;
        if (e && (e.name === 'AbortError' || String(e).indexOf('abort') >= 0)) return;   // user cancelled — leave the overlay closing
        setSelfErr('Couldn’t load this video — check your connection and try again.');
      }
    })();
    return () => { alive = false; if (ac) try { ac.abort(); } catch {} if (url) URL.revokeObjectURL(url); };
  }, [open, video, retry]);
  // Watchdog: once we have a blob, the browser should reach canplay in a second or two. If it neither plays
  // nor errors (some browsers silently stall on an unsupported codec), surface a reason instead of spinning.
  React.useEffect(() => {
    if (!selfSrc || selfErr) return;
    watchdog.current = setTimeout(() => setSelfErr('This video isn’t starting — its format may not be supported in the browser (common for phone H.265/HEVC recordings). It should still play in the phone app.'), 20000);
    return () => { if (watchdog.current) { clearTimeout(watchdog.current); watchdog.current = null; } };
  }, [selfSrc, selfErr]);
  if (!video) return null;
  const ch = (data && data.channel) || {};
  const more = ((data && data.videos) || []).filter(v => v.id !== video.id).slice(0, 4);

  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 14px 8px' }}>
          <IconBtn name="chevL" onClick={onClose} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>Watch</span>
          {video._sermon ? <div style={{ width: 40 }} /> : <IconBtn name="share" onClick={() => { openExternal(`https://youtu.be/${video.ytId}`); }} />}
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', paddingBottom: 30 }}>
        {/* video frame */}
        <div style={{ margin: '0 14px', borderRadius: 18, overflow: 'hidden', background: '#000', aspectRatio: '16/9', position: 'relative' }}>
          {video._sermon ? (
            selfSrc && !selfErr
              ? <video src={selfSrc} controls autoPlay playsInline style={{ width: '100%', height: '100%', display: 'block', background: '#000' }}
                  onCanPlay={() => { if (watchdog.current) { clearTimeout(watchdog.current); watchdog.current = null; } }}
                  onError={e => {
                    const er = e.target && e.target.error; const code = er ? er.code : 0;
                    // MediaError: 3 = DECODE (corrupt), 4 = SRC_NOT_SUPPORTED (codec/container the browser can't play)
                    console.error('[sermon] video playback failed', { code, message: er && er.message, mime: video.mime });
                    setSelfErr(code === 4
                      ? 'This recording’s video format can’t be played in the browser (often the case for phone H.265/HEVC video). It should still play in the phone app.'
                      : code === 3 ? 'This video couldn’t be decoded — the file may be damaged.'
                      : 'This video couldn’t be played here.');
                  }} />
              : <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, textAlign: 'center', padding: 20 }}>
                  {selfErr
                    ? <><Icon name="alert" size={22} color="#fff" />{selfErr}
                        <button onClick={() => { setSelfErr(''); setRetry(r => r + 1); }} style={{ marginTop: 4, padding: '7px 18px', borderRadius: 999, border: '1px solid rgba(255,255,255,.5)', background: 'transparent', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Try again</button></>
                    : <SermonLoading prog={prog} enc={video.enc} onCancel={() => { if (abortRef.current) try { abortRef.current.abort(); } catch {} onClose(); }} />}
                </div>
          ) : liveId ? (
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

          {/* poster row: for a self-hosted sermon this is the CHURCH — never a "YouTube" channel with a dead button */}
          {video._sermon ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, margin: '16px 0', paddingBottom: 16, borderBottom: '1px solid var(--line)' }}>
              <div style={{ width: 42, height: 42, borderRadius: 999, background: 'color-mix(in oklab, var(--clay) 16%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="bank" size={20} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(ctx.church && ctx.church.name) || 'Your church'}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Members only · your church’s own recording</div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, margin: '16px 0', paddingBottom: 16, borderBottom: '1px solid var(--line)' }}>
              <ChannelAvatar ch={ch} size={42} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{ch.name || 'Church'}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{ch.handle || 'YouTube'}</div>
              </div>
              <button onClick={() => openExternal(ch.url)} style={{ border: 'none', background: 'var(--ink)', color: 'var(--paper)', padding: '9px 16px', borderRadius: 999, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Channel</button>
            </div>
          )}

          {video.desc ? <p style={{ fontFamily: 'var(--font-read)', fontSize: 16, lineHeight: 1.6, color: 'var(--ink)', margin: '0 0 22px', textWrap: 'pretty', whiteSpace: 'pre-wrap' }}>{video.desc}</p> : null}

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
