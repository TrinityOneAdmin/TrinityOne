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
  const color = (av && av.color) || '#5E8C6A';
  const initial = (name && name.trim()) ? name.trim()[0].toUpperCase() : null;
  const bg = `linear-gradient(150deg, ${color}, color-mix(in oklab, ${color} 62%, #16120c))`;
  return (
    <div style={{
      width: size, height: size, borderRadius: 999, flexShrink: 0, background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
      boxShadow: ring ? `0 0 0 3px var(--surface), 0 0 0 4.5px ${color}` : 'none',
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
function AvatarPicker({ value, name, onChange }) {
  const D = window.TrinityData;
  const [tab, setTab] = useAv(value.kind === 'monogram' ? 'monogram' : 'symbol');
  const color = value.color;
  const setColor = (c) => onChange({ ...value, color: c });

  return (
    <div>
      {/* preview */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
        <UserAvatar av={value} name={name} size={96} />
      </div>

      {/* source toggle */}
      <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 16 }}>
        {[['symbol', 'Symbol'], ['monogram', 'Initial']].map(([k, lbl]) => {
          const on = tab === k;
          return (
            <button key={k} onClick={() => { setTab(k); onChange({ ...value, kind: k, symbol: k === 'symbol' ? (value.symbol || 'olive') : undefined }); }} style={{
              flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14,
              background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--clay)' : 'var(--ink-2)',
              boxShadow: on ? 'var(--shadow)' : 'none',
            }}>{lbl}</button>
          );
        })}
      </div>

      {/* symbol gallery */}
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
      ) : (
        <p style={{ textAlign: 'center', fontSize: 13.5, color: 'var(--ink-2)', margin: '0 0 18px', fontFamily: 'var(--font-read)' }}>
          {name && name.trim() ? `Your initial “${name.trim()[0].toUpperCase()}” on a color you pick.` : 'Add a name above and your initial appears here.'}
        </p>
      )}

      {/* color row */}
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
    </div>
  );
}
window.AvatarPicker = AvatarPicker;
