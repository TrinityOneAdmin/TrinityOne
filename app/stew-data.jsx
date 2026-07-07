// stew-data.jsx — shared sample data + small UI primitives for the steward surfaces
// Exports to window: SK (data), and primitives SkPill, SkBadge, SkField, SkToggle, SkQR, SkKey, SkSpark

const SK = {
  church: {
    name: 'Grace Chapel', sub: 'Riverside · main campus', initials: 'GC', accent: 'var(--clay)',
    npub: 'npub1grace8s7v3x2k9m4f7p0r6t1y5w8n2c4j6h3l9d0a7q',
    nip05: 'grace.org', code: 'GRACE-7K2', members: 312,
  },
  steward: { name: 'Pastor John', initials: 'PJ' },
  funds: [
    { id: 'general', name: 'General Tithes & Offerings', sub: 'Default fund', custody: 'Custodial · Strike', icon: 'gift', month: '$6,540', ytd: '$48,210' },
    { id: 'building', name: 'Building Fund', sub: 'New sanctuary roof', custody: 'Self-hosted · LNbits', icon: 'bank', month: '$3,120', ytd: '$22,870', goal: 50000, raised: 22870 },
    { id: 'missions', name: 'Missions — Honduras', sub: 'Summer trip', custody: 'Custodial · Strike', icon: 'globe', month: '$1,200', ytd: '$9,430' },
    { id: 'benevolence', name: 'Benevolence', sub: 'Care for members in need', custody: 'Self-hosted · LNbits', icon: 'heart', month: '$640', ytd: '$5,120' },
  ],
  groups: [
    { id: 'announce', name: 'Announcements', sub: 'Broadcast · 312 reached', kind: 'broadcast' },
    { id: 'men', name: "Men's Life Group", sub: '18 members · active', kind: 'group' },
    { id: 'women', name: "Women's Bible Study", sub: '24 members · active', kind: 'group' },
    { id: 'youth', name: 'Youth', sub: '31 members · 2 stewards', kind: 'group' },
    { id: 'prayer', name: 'Prayer Wall', sub: 'open · 140 requests', kind: 'group' },
  ],
  // reading plans the steward can share with the congregation (public-domain, chapter-a-day structure)
  planLibrary: (function () {
    const chapters = (book, n) => Array.from({ length: n }, (_, i) => ({ d: i + 1, ref: book + ' ' + (i + 1), label: 'Chapter ' + (i + 1) }));
    const psalms = (list) => list.map((p, i) => ({ d: i + 1, ref: 'Psalm ' + p, label: 'Psalm ' + p }));
    return [
      { id: 'john21', title: 'The Gospel of John', sub: '21 days · a chapter a morning', tag: 'Gospels', accent: 'var(--clay)', blurb: 'Walk slowly through John, one chapter a day.', days: chapters('John', 21) },
      { id: 'mark', title: 'The Gospel of Mark', sub: '16 days', tag: 'Gospels', accent: '#5360D6', blurb: 'The fast-paced gospel, a chapter a day.', days: chapters('Mark', 16) },
      { id: 'proverbs', title: 'A Proverb a Day', sub: '31 days', tag: 'Wisdom', accent: 'var(--gold)', blurb: 'Daily wisdom — one chapter of Proverbs each day.', days: chapters('Proverbs', 31) },
      { id: 'romans', title: 'Romans', sub: '16 days', tag: 'Epistles', accent: 'var(--sage)', blurb: "Paul's gospel laid out, a chapter a day.", days: chapters('Romans', 16) },
      { id: 'psalms-comfort', title: 'Psalms of Comfort', sub: '7 days', tag: 'Devotional', accent: 'var(--sage)', blurb: 'A week in the Psalms for anxious seasons.', days: psalms([23, 27, 34, 42, 91, 121, 139]) },
    ];
  })(),
  relays: [
    { url: 'relay.trinityone.app', label: 'TrinityOne shared', status: 'on', kind: 'shared' },
    { url: 'relay.damus.io', label: 'Public relay', status: 'on', kind: 'shared' },
    { url: 'relay.grace.org', label: 'Grace Chapel · self-hosted', status: 'on', kind: 'own' },
  ],
  // weekly giving, sats-ish bars (relative heights 0..1)
  week: [
    { d: 'Mon', v: 0.34 }, { d: 'Tue', v: 0.52 }, { d: 'Wed', v: 0.46 },
    { d: 'Thu', v: 0.61 }, { d: 'Fri', v: 0.4 }, { d: 'Sat', v: 0.3 }, { d: 'Sun', v: 1.0 },
  ],
  activity: [
    { ic: 'bolt', tint: 'gold', text: 'Published fund · Building Fund', time: '2m ago' },
    { ic: 'pray', tint: 'sage', text: 'New prayer request in Prayer Wall', time: '14m ago' },
    { ic: 'qr', tint: 'clay', text: 'New member followed via code', time: '1h ago' },
    { ic: 'send', tint: 'gold', text: 'Posted to Announcements', time: '3h ago' },
  ],
  // pending signing request for the extension
  request: {
    site: 'console.trinityone.app',
    action: 'Publish fund', target: 'Building Fund',
    kind: 30078, d: 'building-fund',
    relays: 3,
  },
};

const SK_TINT = {
  clay: { bg: 'var(--clay-soft)', fg: 'var(--clay)' },
  gold: { bg: 'var(--gold-tint)', fg: '#8a6717' },
  sage: { bg: 'var(--sage-soft)', fg: '#345c41' },
  ink:  { bg: 'var(--surface-2)', fg: 'var(--ink-2)' },
};

// ── ministry-team presets: icon + accent + a starter role list (for New team) ──
const TEAM_PRESETS = [
  { id: 'welcome', name: 'Welcome', icon: 'hand',   accent: '#C25A38', roles: 'Welcome desk\nDoor · North\nDoor · South\nNewcomer host' },
  { id: 'worship', name: 'Worship', icon: 'music',  accent: '#5360D6', roles: 'Lead\nVocals\nKeys\nGuitar\nDrums' },
  { id: 'kids',    name: 'Kids',    icon: 'child',  accent: '#1F9488', roles: 'Lead\nToddlers\nJuniors\nCheck-in' },
  { id: 'av',      name: 'AV / Tech', icon: 'sliders', accent: '#8a6717', roles: 'Sound\nSlides\nStream' },
  { id: 'coffee',  name: 'Coffee',  icon: 'coffee', accent: '#C24B7A', roles: 'Barista\nServe\nWash up' },
  { id: 'prayer',  name: 'Prayer',  icon: 'pray',   accent: '#5E8C6A', roles: 'Lead\nMinistry team\nMinistry team' },
];
window.TEAM_PRESETS = TEAM_PRESETS;   // NewTeamModal reads window.TEAM_PRESETS (a top-level const isn't a window prop)

// ── pill ──
function SkPill({ children, tint = 'clay', style = {} }) {
  const t = SK_TINT[tint] || SK_TINT.clay;
  return <span className="sk-pill" style={{ background: t.bg, color: t.fg, ...style }}>{children}</span>;
}

// ── church badge (rounded square initials) ──
function SkBadge({ size = 44, radius = 13, accent = 'var(--clay)', initials = 'GC', picture = '', style = {} }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: 'hidden',
      background: picture ? `center/cover no-repeat url(${picture})` : `linear-gradient(150deg, ${accent}, color-mix(in oklab, ${accent} 60%, #16120c))`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
      fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: size * 0.38, letterSpacing: '.3px', ...style,
    }}>{picture ? '' : initials}</div>
  );
}

// ── labelled field (display) ──
function SkField({ label, value, mono = false, hint, accessory, style = {} }) {
  return (
    <div style={style}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 48, padding: '0 14px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <span style={{ flex: 1, fontSize: mono ? 14 : 15, fontWeight: 600, fontFamily: mono ? 'var(--mono)' : 'var(--font-ui)', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        {accessory}
      </div>
      {hint ? <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.4 }}>{hint}</div> : null}
    </div>
  );
}

// ── segmented toggle ──
function SkToggle({ options, value, onChange, style = {} }) {
  return (
    <div style={{ display: 'inline-flex', padding: 4, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', gap: 4, ...style }}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', cursor: 'pointer',
            padding: '8px 14px', borderRadius: 9, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5,
            background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--ink)' : 'var(--ink-2)',
            boxShadow: on ? 'var(--shadow-sm)' : 'none', transition: 'all .15s',
          }}>{o.icon ? <Icon name={o.icon} size={16} color={on ? 'var(--clay)' : 'var(--ink-3)'} /> : null}{o.label}</button>
        );
      })}
    </div>
  );
}

// ── procedural faux-QR ──
function SkQR({ size = 120, seed = 'GRACE-7K2', halo = true, fg = '#1a1410' }) {
  const N = 19;
  const cells = React.useMemo(() => {
    let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const rnd = (i) => { const x = Math.sin(h + i * 12.9898) * 43758.5453; return x - Math.floor(x); };
    const finder = (r, c) => r < 6 && c < 6;
    const out = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const isF = finder(r, c) || finder(r, N - 1 - c) || finder(N - 1 - r, c);
      let on;
      if (isF) { const br = r < 6 ? r : N - 1 - r, bc = c < 6 ? c : N - 1 - c; on = br === 0 || br === 5 || bc === 0 || bc === 5 || (br >= 2 && br <= 3 && bc >= 2 && bc <= 3); }
      else on = rnd(r * N + c) > 0.55;
      if (on) out.push(<rect key={r + '-' + c} x={c} y={r} width="1" height="1" rx="0.18" />);
    }
    return out;
  }, [seed]);
  return (
    <svg viewBox="0 0 19 19" width={size} height={size}>
      <rect width="19" height="19" fill="#fff" />
      <g fill={fg}>{cells}</g>
      {halo ? <><circle cx="9.5" cy="9.5" r="2.7" fill="#fff" /><g transform="translate(7 7) scale(0.05)"><circle cx="50" cy="50" r="36" fill="none" stroke="var(--ink)" strokeWidth="9" strokeLinecap="round" strokeDasharray="57.4 18" transform="rotate(-90 50 50)" /><circle cx="50" cy="50" r="9" fill="var(--clay)" /></g></> : null}
    </svg>
  );
}

// ── truncated mono key chip with copy ──
function SkKey({ value, label = 'npub', tint = 'clay', style = {} }) {
  const [copied, setCopied] = React.useState(false);
  const short = value.length > 26 ? value.slice(0, 14) + '…' + value.slice(-7) : value;
  const t = SK_TINT[tint] || SK_TINT.clay;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)', ...style }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', color: t.fg, background: t.bg, padding: '3px 7px', borderRadius: 6 }}>{label}</span>
      <span style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{short}</span>
      <button onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: copied ? 'var(--sage)' : 'var(--ink-3)', display: 'flex', padding: 4 }}>
        <Icon name={copied ? 'check' : 'copy'} size={16} stroke={2} color="currentColor" />
      </button>
    </div>
  );
}

// ── weekly giving bars ──
function SkSpark({ data, height = 70, accent = 'var(--clay)', barW = 16 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height }}>
      {data.map((b, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1 }}>
          <div style={{ width: barW, height: Math.max(4, b.v * (height - 22)), borderRadius: 5, background: b.v === 1 ? accent : `color-mix(in oklab, ${accent} 34%, var(--surface-2))` }} />
          <span style={{ fontSize: 10.5, fontWeight: 600, color: b.v === 1 ? 'var(--ink-2)' : 'var(--ink-3)' }}>{b.d}</span>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { SK, SK_TINT, SkPill, SkBadge, SkField, SkToggle, SkQR, SkKey, SkSpark });
