// screens-church.jsx — church switcher + follow-a-church flow
const { useState: useCh, useEffect: useChE } = React;

// church avatar — rounded square with initials over the church accent
function ChurchBadge({ church, size = 46, radius = 14 }) {
  const accent = church.accent || 'var(--clay)';
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0,
      background: `linear-gradient(150deg, ${accent}, color-mix(in oklab, ${accent} 62%, #16120c))`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
      fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: size * 0.38, letterSpacing: '.3px',
    }}>{church.initials}</div>
  );
}
window.ChurchBadge = ChurchBadge;

// compact header pill used at the top of Chat — shows current church, opens switcher
function ChurchPill({ ctx }) {
  const c = ctx.church;
  if (!c) return null;
  return (
    <button onClick={ctx.openChurchSwitcher} style={{
      display: 'inline-flex', alignItems: 'center', gap: 9, border: '1px solid var(--line)',
      background: 'var(--surface)', borderRadius: 999, padding: '5px 12px 5px 5px', cursor: 'pointer',
      boxShadow: 'var(--shadow)', maxWidth: 200,
    }}>
      <ChurchBadge church={c} size={28} radius={9} />
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
      <Icon name="chevD" size={15} stroke={2.2} color="var(--ink-3)" />
    </button>
  );
}
window.ChurchPill = ChurchPill;

// ════ Follow a church (scan / code) ════
function FollowChurch({ onBack, onFollowed, ctx }) {
  const [code, setCode] = useCh('');
  const [err, setErr] = useCh('');
  const hasNpub = /npub1[0-9a-z]{20,}/.test(code);
  // follow by the church's real npub (a scanned QR opens ?follow= directly; here we accept the
  // npub or invite link a steward pasted/typed).
  const resolve = () => {
    const off = ctx.followChurch(code);
    if (off === false) { setErr('That doesn’t look like a church code. Paste the npub or invite link your steward shared.'); return; }
    onFollowed();
  };
  return (
    <div style={{ animation: 'trinityFade .25s ease both' }}>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-2)', fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-ui)', marginBottom: 10, padding: 0 }}>
        <Icon name="chevL" size={18} /> Back</button>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        <div style={{ width: 168, height: 168, borderRadius: 22, background: '#fff', boxShadow: 'var(--shadow-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <svg viewBox="0 0 19 19" width="138" height="138"><rect width="19" height="19" fill="#fff"/><g fill="#1a1410">{
            (() => { const cells = []; const seed = 'follow'; let h = 0; for (let i = 0; i < seed.length; i++) h = (h*31+seed.charCodeAt(i))>>>0;
              const rnd = (i) => { const x = Math.sin(h + i*12.9898)*43758.5453; return x - Math.floor(x); };
              for (let r = 0; r < 19; r++) for (let cc = 0; cc < 19; cc++) {
                const f = (rr,c2) => rr<6&&c2<6; const isF = f(r,cc)||f(r,18-cc)||f(18-r,cc);
                const on = isF ? (()=>{const br=r<6?r:18-r,bc=cc<6?cc:18-cc;return br===0||br===5||bc===0||bc===5||(br>=2&&br<=3&&bc>=2&&bc<=3);})() : rnd(r*19+cc)>0.55;
                if (on) cells.push(<rect key={r+'-'+cc} x={cc} y={r} width="1" height="1" rx="0.18"/>);
              } return cells; })()
          }</g></svg>
          <div style={{ position: 'absolute', width: 38, height: 38, borderRadius: 999, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 6px rgba(0,0,0,.15)' }}>
            <Halo size={26} color="var(--ink)" spark="var(--clay)" />
          </div>
        </div>
      </div>
      <p style={{ textAlign: 'center', fontFamily: 'var(--font-read)', fontSize: 16, lineHeight: 1.5, color: 'var(--ink-2)', margin: '0 0 18px', textWrap: 'pretty' }}>
        Point your camera at a steward’s invite QR — or enter the code they gave you.</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 16px' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--line)' }} /><span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>enter code</span><div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      </div>
      <input value={code} onChange={e => { setCode(e.target.value.trim()); setErr(''); }} autoFocus placeholder="npub1… or invite link" style={{
        width: '100%', height: 58, border: '1px solid ' + (err ? 'var(--clay)' : 'var(--line)'), borderRadius: 14, background: 'var(--surface)', padding: '0 18px',
        fontSize: 14, fontFamily: 'monospace', fontWeight: 600, color: 'var(--ink)', outline: 'none', boxShadow: 'var(--shadow)', textAlign: 'center', textOverflow: 'ellipsis' }} />
      {err ? <div style={{ fontSize: 12.5, color: 'var(--clay)', fontWeight: 600, marginTop: 8, lineHeight: 1.4 }}>{err}</div> : null}
      <button onClick={resolve} disabled={!hasNpub} style={{
        width: '100%', marginTop: 16, padding: 16, borderRadius: 15, border: 'none', cursor: hasNpub ? 'pointer' : 'default',
        background: hasNpub ? 'var(--clay)' : 'var(--line)', color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
        <Icon name="check" size={18} stroke={2.4} color="#fff" /> Follow church</button>

      <div style={{ display: 'flex', gap: 9, padding: 13, borderRadius: 14, background: 'color-mix(in oklab, var(--sage) 11%, var(--surface))',
        border: '1px solid color-mix(in oklab, var(--sage) 28%, transparent)', marginTop: 16 }}>
        <Icon name="shield" size={18} color="var(--sage)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>Following only subscribes you to that church’s public, signed posts. You stay anonymous — no personal details are shared.</div>
      </div>
    </div>
  );
}

// ════ Church switcher sheet ════
function ChurchSwitcher({ open, onClose, ctx, churches, activeId, onPick, onFollowed, initialMode }) {
  const [mode, setMode] = useCh('list'); // 'list' | 'follow'
  useChE(() => { if (open) setMode(initialMode === 'follow' || new URLSearchParams(location.search).get('church') === 'follow' ? 'follow' : 'list'); }, [open]);

  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="86%" z={60}>
      {mode === 'list' ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>Your churches</div>
            <IconBtn name="x" onClick={onClose} />
          </div>
          <p style={{ fontSize: 13.5, color: 'var(--ink-2)', margin: '0 0 16px', lineHeight: 1.5 }}>Groups and giving funds are scoped to the church you’re viewing.</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {churches.map(c => {
              const on = c.id === activeId;
              return (
                <button key={c.id} onClick={() => onPick(c.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18, cursor: 'pointer', textAlign: 'left',
                  border: on ? '2px solid var(--clay)' : '1px solid var(--line)',
                  background: on ? 'color-mix(in oklab, var(--clay) 8%, var(--surface))' : 'var(--surface)', boxShadow: 'var(--shadow)',
                }}>
                  <ChurchBadge church={c} size={50} radius={15} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16.5 }}>{c.name}</span>
                      {c.verified ? <Icon name="check" size={14} stroke={3} color="var(--sage)" /> : null}
                    </div>
                    {c.tagline ? <div style={{ fontFamily: 'var(--font-read)', fontSize: 13.5, color: 'var(--ink-2)', fontStyle: 'italic', lineHeight: 1.35, marginTop: 1 }}>“{c.tagline}”</div> : null}
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 600, marginTop: 5 }}><b style={{ color: 'var(--ink-2)' }}>{c.members}</b> members</div>
                  </div>
                  {on ? <div style={{ width: 24, height: 24, borderRadius: 999, background: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="check" size={15} stroke={2.8} color="#fff" /></div>
                    : <div style={{ width: 24, height: 24, borderRadius: 999, border: '2px solid var(--line)', flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>

          <button onClick={() => setMode('follow')} style={{
            width: '100%', marginTop: 14, padding: 15, borderRadius: 16, border: '1px dashed var(--line)', background: 'var(--surface-2)',
            color: 'var(--ink)', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
            <Icon name="plus" size={18} stroke={2.2} color="var(--clay)" /> Follow another church</button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center', marginTop: 14, color: 'var(--ink-3)', fontSize: 11.5 }}>
            <Icon name="globe" size={13} color="var(--ink-3)" /> Discovered over Nostr · in-person invite only
          </div>
        </div>
      ) : (
        <FollowChurch onBack={() => setMode('list')} onFollowed={onFollowed} ctx={ctx} />
      )}
    </BottomSheet>
  );
}
window.ChurchSwitcher = ChurchSwitcher;
