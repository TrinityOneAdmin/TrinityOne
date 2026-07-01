// screens-church.jsx — church switcher + follow-a-church flow
const { useState: useCh, useEffect: useChE, useRef: useChR } = React;

// ════ in-app QR scanner (camera + BarcodeDetector, no native plugin) ════
// Calls onResult(text) with the decoded QR; degrades gracefully if there's no camera/detector.
function QRScanner({ onResult, onCancel }) {
  const vref = useChR();
  const [status, setStatus] = useCh('starting');   // starting | scanning | unsupported | error
  useChE(() => {
    let stream, raf, stopped = false, detector = null, canvas = null, cctx = null;
    const hasBD = ('BarcodeDetector' in window);
    const hasJsQR = (typeof window.jsQR === 'function');   // pure-JS fallback (Android WebView has no BarcodeDetector)
    (async () => {
      try {
        if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || (!hasBD && !hasJsQR)) { setStatus('unsupported'); return; }
        if (hasBD) { try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; } }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        const v = vref.current; if (!v) return;
        v.srcObject = stream; v.setAttribute('playsinline', ''); v.muted = true; await v.play();
        setStatus('scanning');
        const tick = async () => {
          if (stopped) return;
          try {
            if (detector) {
              const codes = await detector.detect(v);
              if (codes && codes.length && codes[0].rawValue) { onResult(codes[0].rawValue); return; }
            } else if (v.videoWidth) {
              if (!canvas) { canvas = document.createElement('canvas'); cctx = canvas.getContext('2d', { willReadFrequently: true }); }
              canvas.width = v.videoWidth; canvas.height = v.videoHeight;
              cctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = cctx.getImageData(0, 0, canvas.width, canvas.height);
              const res = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              if (res && res.data) { onResult(res.data); return; }
            }
          } catch (e) {}
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) { setStatus('error'); }
    })();
    return () => { stopped = true; if (raf) cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); };
  }, []);

  if (status === 'unsupported' || status === 'error') {
    return (
      <div style={{ borderRadius: 18, background: 'color-mix(in oklab, var(--clay) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, var(--line))', padding: '18px 16px', textAlign: 'center', marginBottom: 16 }}>
        <Icon name="qr" size={26} color="var(--clay)" />
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, margin: '8px 0 12px' }}>{status === 'unsupported' ? 'This device can’t scan in-app — enter the code below instead.' : 'Couldn’t open the camera. Allow camera access, or enter the code below.'}</p>
        <button onClick={onCancel} className="" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 12, padding: '8px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13.5, fontFamily: 'var(--font-ui)', color: 'var(--ink)' }}>Enter a code instead</button>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative', borderRadius: 22, overflow: 'hidden', background: '#000', aspectRatio: '1 / 1', marginBottom: 16, boxShadow: 'var(--shadow-lg)' }}>
      <video ref={vref} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      <div style={{ position: 'absolute', inset: '16%', border: '3px solid rgba(255,255,255,.92)', borderRadius: 20, boxShadow: '0 0 0 100vmax rgba(0,0,0,.35)' }} />
      <div style={{ position: 'absolute', top: 12, left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 13, fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,.6)' }}>
        {status === 'starting' ? 'Starting camera…' : 'Point at the church’s QR'}</div>
      <button onClick={onCancel} style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', border: 'none', background: 'rgba(0,0,0,.55)', color: '#fff', borderRadius: 999, padding: '8px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 13.5, fontFamily: 'var(--font-ui)' }}>Cancel</button>
    </div>
  );
}

// church avatar — rounded square with initials over the church accent
function ChurchBadge({ church, size = 46, radius = 14 }) {
  const accent = church.accent || 'var(--clay)';
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: 'hidden',
      background: church.picture ? `center/cover no-repeat url(${church.picture})` : `linear-gradient(150deg, ${accent}, color-mix(in oklab, ${accent} 62%, #16120c))`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
      fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: size * 0.38, letterSpacing: '.3px',
    }}>{church.picture ? '' : church.initials}</div>
  );
}
window.ChurchBadge = ChurchBadge;

// compact header pill used at the top of Chat — shows current church, opens switcher
function ChurchPill({ ctx }) {
  const c = ctx.church;
  if (!c) return null;
  // with a brand banner: a wide header image with the badge + name overlaid (the church's identity).
  if (c.banner) {
    return (
      <button onClick={ctx.openChurchSwitcher} style={{
        position: 'relative', display: 'block', width: '100%',
        overflow: 'hidden', cursor: 'pointer', boxShadow: 'var(--shadow)', textAlign: 'left',
        aspectRatio: '3 / 1', background: `center/cover no-repeat url(${c.banner})`,
        WebkitMaskImage: 'linear-gradient(to bottom, #000 84%, transparent)', maskImage: 'linear-gradient(to bottom, #000 84%, transparent)',   // soft fade at the bottom edge into the page
      }}>
        <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,.62), rgba(0,0,0,0) 62%)' }} />
        <span style={{ position: 'absolute', right: 12, top: 'calc(env(safe-area-inset-top, 0px) + 12px)', width: 30, height: 30, borderRadius: 999, background: 'rgba(0,0,0,.32)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="chevD" size={18} stroke={2.4} color="#fff" /></span>
        <span style={{ position: 'absolute', left: 14, bottom: 22, right: 50, display: 'flex', alignItems: 'center', gap: 11 }}>
          <ChurchBadge church={c} size={40} radius={12} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19, color: '#fff', lineHeight: 1.15, textShadow: '0 1px 6px rgba(0,0,0,.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
        </span>
      </button>
    );
  }
  // compact single-line pill — the badge + chevron already say "tap to switch church",
  // so the old two-line "Your church" caption is dropped to save vertical space.
  return (
    <button onClick={ctx.openChurchSwitcher} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: '1px solid var(--line)',
      background: 'var(--surface)', borderRadius: 14, padding: '7px 11px', cursor: 'pointer',
      boxShadow: 'var(--shadow)', textAlign: 'left',
    }}>
      <ChurchBadge church={c} size={30} radius={9} />
      <div style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>{c.name}</div>
      <Icon name="chevD" size={18} stroke={2.2} color="var(--ink-3)" />
    </button>
  );
}
window.ChurchPill = ChurchPill;

// ════ Follow a church (scan / code) ════
function FollowChurch({ onBack, onFollowed, ctx }) {
  const [code, setCode] = useCh('');
  const [err, setErr] = useCh('');
  const [scanning, setScanning] = useCh(false);
  const [busy, setBusy] = useCh(false);
  const hasNpub = /npub1[0-9a-z]{20,}/.test(code);
  // joinable = a bare npub / invite link, OR a NIP-05 nice name (@church-name / name@host) we can resolve
  const joinable = hasNpub || /^@?[a-z0-9._-]{2,}(@[a-z0-9.-]+)?$/i.test(code.trim());
  // follow by npub (from a bare npub, invite link, or scanned QR), else resolve a nice name → npub.
  const resolve = async (raw) => {
    const input = raw != null ? raw : code;
    setErr('');
    if (ctx.followChurch(input) !== false) { onFollowed(); return true; }   // fast path: npub / invite link
    setBusy(true);
    let npub = null;
    try { npub = (window.Fellowship && window.Fellowship.resolveChurch) ? await window.Fellowship.resolveChurch(input) : null; } catch (e) {}
    setBusy(false);
    if (npub && ctx.followChurch(npub) !== false) { onFollowed(); return true; }
    setScanning(false);
    setErr('Couldn’t find that church. Check the @name, or paste the npub or invite link your steward shared.');
    return false;
  };
  return (
    <div style={{ animation: 'trinityFade .25s ease both' }}>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-2)', fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-ui)', marginBottom: 10, padding: 0 }}>
        <Icon name="chevL" size={18} /> Back</button>

      {scanning ? (
        <QRScanner onResult={(r) => resolve(r)} onCancel={() => setScanning(false)} />
      ) : (
        <button onClick={() => { setErr(''); setScanning(true); }} style={{
          width: '100%', marginBottom: 16, padding: 16, borderRadius: 16, border: 'none', cursor: 'pointer',
          background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, boxShadow: 'var(--shadow)' }}>
          <Icon name="qr" size={20} color="#fff" /> Scan the church’s QR
        </button>
      )}
      <p style={{ textAlign: 'center', fontFamily: 'var(--font-read)', fontSize: 15, lineHeight: 1.5, color: 'var(--ink-2)', margin: '0 0 18px', textWrap: 'pretty' }}>
        Scan the QR your steward shows — or enter the code they gave you.</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 16px' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--line)' }} /><span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>enter code</span><div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      </div>
      <input value={code} onChange={e => { setCode(e.target.value.trim()); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter' && joinable && !busy) resolve(); }} autoFocus placeholder="@church-name, npub1… or invite link" style={{
        width: '100%', height: 58, border: '1px solid ' + (err ? 'var(--clay)' : 'var(--line)'), borderRadius: 14, background: 'var(--surface)', padding: '0 18px',
        fontSize: 14, fontFamily: 'monospace', fontWeight: 600, color: 'var(--ink)', outline: 'none', boxShadow: 'var(--shadow)', textAlign: 'center', textOverflow: 'ellipsis' }} />
      {err ? <div style={{ fontSize: 12.5, color: 'var(--clay)', fontWeight: 600, marginTop: 8, lineHeight: 1.4 }}>{err}</div> : null}
      <button onClick={() => resolve()} disabled={!joinable || busy} style={{
        width: '100%', marginTop: 16, padding: 16, borderRadius: 15, border: 'none', cursor: (joinable && !busy) ? 'pointer' : 'default',
        background: (joinable && !busy) ? 'var(--clay)' : 'var(--line)', color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
        <Icon name="check" size={18} stroke={2.4} color="#fff" /> {busy ? 'Finding church…' : 'Follow church'}</button>

      <div style={{ display: 'flex', gap: 9, padding: 13, borderRadius: 14, background: 'color-mix(in oklab, var(--sage) 11%, var(--surface))',
        border: '1px solid color-mix(in oklab, var(--sage) 28%, transparent)', marginTop: 16 }}>
        <Icon name="shield" size={18} color="var(--sage)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>Following only subscribes you to that church’s signed posts. You’re in control — no account, and no phone number or email is ever shared.</div>
      </div>
    </div>
  );
}

// ════ Church switcher sheet ════
function ChurchSwitcher({ open, onClose, ctx, churches, activeId, onPick, onFollowed, initialMode }) {
  const [mode, setMode] = useCh('list'); // 'list' | 'follow'
  const [confirmLeave, setConfirmLeave] = useCh(null);   // church id awaiting leave confirmation
  useChE(() => { if (open) setMode(initialMode === 'follow' || new URLSearchParams(location.search).get('church') === 'follow' ? 'follow' : 'list'); }, [open]);
  // two churches can share a name — disambiguate clashes with the verified @handle, else a short key
  const churchLabel = window.makeNameDisambiguator(churches || [], c => c.name || '', c => c.nip05, c => c.npub || c.id);

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
              const followed = !!c.npub;   // a real followed church (vs a built-in/sample) can be left
              return (
                <div key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18,
                  border: on ? '2px solid var(--clay)' : '1px solid var(--line)',
                  background: on ? 'color-mix(in oklab, var(--clay) 8%, var(--surface))' : 'var(--surface)', boxShadow: 'var(--shadow)',
                }}>
                  <div onClick={() => onPick(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 13, flex: 1, minWidth: 0, cursor: 'pointer', textAlign: 'left' }}>
                    <ChurchBadge church={c} size={50} radius={15} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16.5 }}>{churchLabel(c)}</span>
                        {c.kind === 'network' ? <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.5px', color: 'var(--clay-ink)', background: 'var(--clay-soft)', borderRadius: 999, padding: '2px 7px' }}>NETWORK</span> : null}
                        {c.verified ? <Icon name="check" size={14} stroke={3} color="var(--sage)" /> : null}
                      </div>
                      {c.tagline ? <div style={{ fontFamily: 'var(--font-read)', fontSize: 13.5, color: 'var(--ink-2)', fontStyle: 'italic', lineHeight: 1.35, marginTop: 1 }}>“{c.tagline}”</div> : null}
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 600, marginTop: 5 }}>{c.kind === 'network' ? 'A network of churches' : <React.Fragment><b style={{ color: 'var(--ink-2)' }}>{c.members}</b> members</React.Fragment>}</div>
                    </div>
                  </div>
                  {followed ? (
                    confirmLeave === c.id
                      ? <button onClick={() => { setConfirmLeave(null); ctx.leaveChurch(c.id); }} style={{ flexShrink: 0, border: 'none', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 12.5, padding: '7px 11px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Confirm leave</button>
                      : <button onClick={() => setConfirmLeave(c.id)} title="Leave this church" style={{ flexShrink: 0, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-3)', fontWeight: 700, fontSize: 12.5, padding: '7px 11px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Leave</button>
                  ) : (on ? <div style={{ width: 24, height: 24, borderRadius: 999, background: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="check" size={15} stroke={2.8} color="#fff" /></div>
                    : <div style={{ width: 24, height: 24, borderRadius: 999, border: '2px solid var(--line)', flexShrink: 0 }} />)}
                </div>
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
