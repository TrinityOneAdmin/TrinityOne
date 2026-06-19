// icons.jsx — TrinityOne line icons. <Icon name="..." size={22} stroke={1.8} />
// Exports window.Icon

function Icon({ name, size = 22, stroke = 1.8, fill = false, style = {}, color = 'currentColor' }) {
  const p = {
    fill: 'none', stroke: color, strokeWidth: stroke,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  const paths = {
    // tab bar
    today: <><circle cx="12" cy="12" r="3.4" {...p} /><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" {...p} /></>,
    read: <><path d="M12 5.6C10.4 4.5 8.2 4 5.8 4 4.8 4 4 4.8 4 5.8v11.4c0 1 .8 1.6 1.8 1.6 2.4 0 4.6.5 6.2 1.6 1.6-1.1 3.8-1.6 6.2-1.6 1 0 1.8-.6 1.8-1.6V5.8C20 4.8 19.2 4 18.2 4c-2.4 0-4.6.5-6.2 1.6Z" {...p} /><path d="M12 5.6v13.4" {...p} /></>,
    study: <><circle cx="11" cy="11" r="6.4" {...p} /><path d="m20 20-3.6-3.6" {...p} /><path d="M11 8.2v5.6M8.2 11h5.6" {...p} /></>,
    plans: <><rect x="3.6" y="4.8" width="16.8" height="15.6" rx="2.6" {...p} /><path d="M3.6 9.2h16.8M8 3.2v3.4M16 3.2v3.4" {...p} /><path d="m8.4 14 2 2 3.6-3.8" {...p} /></>,
    library: <><rect x="3.8" y="3.8" width="6.6" height="6.6" rx="1.8" {...p} /><rect x="13.6" y="3.8" width="6.6" height="6.6" rx="1.8" {...p} /><rect x="3.8" y="13.6" width="6.6" height="6.6" rx="1.8" {...p} /><rect x="13.6" y="13.6" width="6.6" height="6.6" rx="1.8" {...p} /></>,
    // actions
    marker: <><path d="M14.2 4.6 19.4 9.8 10 19.2l-5.2.9.9-5.2 8.5-10.3Z" {...p} /><path d="m12.4 6.4 5.2 5.2" {...p} /></>,
    pen: <><path d="M16.5 4.5 19.5 7.5 8.5 18.5l-3.6.9.9-3.6L16.5 4.5Z" {...p} /></>,
    bookmark: <><path d="M6.5 4.5h11a1 1 0 0 1 1 1V20l-6.5-3.6L5.5 20V5.5a1 1 0 0 1 1-1Z" {...p} fill={fill ? color : 'none'} /></>,
    share: <><circle cx="6" cy="12" r="2.4" {...p} /><circle cx="17.5" cy="6" r="2.4" {...p} /><circle cx="17.5" cy="18" r="2.4" {...p} /><path d="m8.1 10.9 7.3-3.8M8.1 13.1l7.3 3.8" {...p} /></>,
    copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.4" {...p} /><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" {...p} /></>,
    compare: <><rect x="3.8" y="5" width="7" height="14" rx="1.6" {...p} /><rect x="13.2" y="5" width="7" height="14" rx="1.6" {...p} /></>,
    link: <><path d="M9.5 14.5 14.5 9.5" {...p} /><path d="M8 11 6 13a3.5 3.5 0 0 0 5 5l2-2" {...p} /><path d="M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2" {...p} /></>,
    comment: <><path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10l-4 3.2V16.5H6.5a2 2 0 0 1-2-2Z" {...p} /></>,
    sun: <><circle cx="12" cy="12" r="3.8" {...p} /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" {...p} /></>,
    books: <><path d="M5 4.5h4.2a1.8 1.8 0 0 1 1.8 1.8V19a1.6 1.6 0 0 0-1.6-1.6H5Z" {...p} /><path d="M19 4.5h-4.2A1.8 1.8 0 0 0 13 6.3V19a1.6 1.6 0 0 1 1.6-1.6H19Z" {...p} /></>,
    cloud: <><path d="M7.2 18.5a4.2 4.2 0 0 1-.7-8.35A5.5 5.5 0 0 1 17.4 11.2a3.65 3.65 0 0 1-.4 7.3Z" {...p} /></>,
    cloudCheck: <><path d="M7.2 18.5a4.2 4.2 0 0 1-.7-8.35A5.5 5.5 0 0 1 17.4 11.2a3.65 3.65 0 0 1-.4 7.3Z" {...p} /><path d="m9.7 14 1.7 1.7 3.2-3.4" {...p} /></>,
    trash: <><path d="M5 7h14M10 7V5.6a1.6 1.6 0 0 1 1.6-1.6h.8A1.6 1.6 0 0 1 14 5.6V7M6.8 7l.7 11.1a2 2 0 0 0 2 1.9h5a2 2 0 0 0 2-1.9L17.2 7" {...p} /></>,
    wallet: <><rect x="3.5" y="6" width="17" height="13" rx="3" {...p} /><path d="M3.5 9.5h17" {...p} /><circle cx="16.5" cy="13" r="1.3" fill={color} stroke="none" /></>,
    bank: <><path d="M4 9.5 12 4l8 5.5" {...p} /><path d="M5 9.5h14M6 10v8M10 10v8M14 10v8M18 10v8M4 19h16" {...p} /></>,
    power: <><path d="M12 4v8" {...p} /><path d="M7.6 6.5a7 7 0 1 0 8.8 0" {...p} /></>,
    bell: <><path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 4.2 1.3 5.6 1.8 6.1.3.3.1.9-.4.9H5.1c-.5 0-.7-.6-.4-.9.5-.5 1.8-1.9 1.8-6.1Z" {...p} /><path d="M10 19.5a2 2 0 0 0 4 0" {...p} /></>,
    pause: <><rect x="6.5" y="5" width="3.6" height="14" rx="1.2" {...p} fill={color} /><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" {...p} fill={color} /></>,
    rewind: <><path d="M11 6.5 5 12l6 5.5v-11Z" {...p} fill={color} /><path d="M19 6.5 13 12l6 5.5v-11Z" {...p} fill={color} /></>,
    forward: <><path d="M13 6.5 19 12l-6 5.5v-11Z" {...p} fill={color} /><path d="M5 6.5 11 12l-6 5.5v-11Z" {...p} fill={color} /></>,
    lex: <><path d="M6 4.5h9.5a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5H6Z" {...p} /><path d="M9 9h6M9 12h4.5" {...p} /></>,
    book: <><path d="M6 4.5h9.5a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5H6Z" {...p} /><path d="M6 4.5a1.5 1.5 0 0 0-1.5 1.5V20A1.5 1.5 0 0 1 6 18.5" {...p} /></>,
    // misc
    search: <><circle cx="11" cy="11" r="7" {...p} /><path d="m20 20-3.5-3.5" {...p} /></>,
    chevR: <><path d="m9 5 7 7-7 7" {...p} /></>,
    chevL: <><path d="m15 5-7 7 7 7" {...p} /></>,
    chevD: <><path d="m5 9 7 7 7-7" {...p} /></>,
    chevU: <><path d="m5 15 7-7 7 7" {...p} /></>,
    x: <><path d="m6 6 12 12M18 6 6 18" {...p} /></>,
    plus: <><path d="M12 5v14M5 12h14" {...p} /></>,
    check: <><path d="m5 12.5 4.5 4.5L19 6.5" {...p} /></>,
    flame: <><path d="M12 3.5c.5 3 2.2 4.1 3.6 5.6 1.2 1.3 2.4 2.8 2.4 5.1A6 6 0 0 1 6 14.2c0-1.6.6-2.8 1.4-3.7.3 1 .9 1.6 1.7 1.9-.4-2.6.9-5.6 2.9-8.9Z" {...p} /></>,
    sparkle: <><path d="M12 3.5c.7 4 1.8 5.1 5.8 5.8-4 .7-5.1 1.8-5.8 5.8-.7-4-1.8-5.1-5.8-5.8 4-.7 5.1-1.8 5.8-5.8Z" {...p} /><path d="M18.5 14.5c.3 1.7.8 2.2 2.5 2.5-1.7.3-2.2.8-2.5 2.5-.3-1.7-.8-2.2-2.5-2.5 1.7-.3 2.2-.8 2.5-2.5Z" {...p} /></>,
    sliders: <><path d="M5 7h9M18 7h1M5 12h2M11 12h8M5 17h6M15 17h4" {...p} /><circle cx="16" cy="7" r="2" {...p} /><circle cx="9" cy="12" r="2" {...p} /><circle cx="13" cy="17" r="2" {...p} /></>,
    headphones: <><path d="M5 13v-1a7 7 0 0 1 14 0v1" {...p} /><rect x="3.6" y="13" width="3.8" height="6" rx="1.6" {...p} /><rect x="16.6" y="13" width="3.8" height="6" rx="1.6" {...p} /></>,
    play: <><path d="M8 5.5v13l11-6.5-11-6.5Z" {...p} fill={color} /></>,
    heart: <><path d="M12 20s-7-4.4-7-9.4A3.9 3.9 0 0 1 12 7a3.9 3.9 0 0 1 7 3.6c0 5-7 9.4-7 9.4Z" {...p} fill={fill ? color : 'none'} /></>,
    moon: <><path d="M19 13.5A7.5 7.5 0 0 1 10.5 5a6 6 0 1 0 8.5 8.5Z" {...p} /></>,
    arrowUp: <><path d="M12 19V6M6 11l6-6 6 6" {...p} /></>,
    dots: <><circle cx="5.5" cy="12" r="1.4" fill={color} stroke="none" /><circle cx="12" cy="12" r="1.4" fill={color} stroke="none" /><circle cx="18.5" cy="12" r="1.4" fill={color} stroke="none" /></>,
    grid2: <><path d="M4 7h16M4 12h16M4 17h16" {...p} /></>,
    note: <><rect x="4.5" y="3.8" width="15" height="16.4" rx="2.2" {...p} /><path d="M8 8h8M8 12h8M8 16h5" {...p} /></>,
    history: <><path d="M4 12a8 8 0 1 0 2.5-5.8" {...p} /><path d="M4 4v3.5h3.5" {...p} /><path d="M12 8v4.2l2.8 1.8" {...p} /></>,
    // ── fellowship (chat + giving) ──
    shield: <><path d="M12 3.5 19 6v5.2c0 4.2-2.9 7-7 8.3-4.1-1.3-7-4.1-7-8.3V6Z" {...p} /><path d="m9.2 11.8 1.9 1.9 3.7-3.9" {...p} /></>,
    key: <><circle cx="8" cy="8" r="3.4" {...p} /><path d="m10.4 10.4 7 7M15 13.5l2 2M17.5 11l2 2" {...p} /></>,
    refresh: <><path d="M19 8a7.5 7.5 0 0 0-13-1.6M5 5v3.4h3.4" {...p} /><path d="M5 16a7.5 7.5 0 0 0 13 1.6M19 19v-3.4h-3.4" {...p} /></>,
    globe: <><circle cx="12" cy="12" r="8.2" {...p} /><path d="M3.8 12h16.4M12 3.8c2.3 2.2 3.4 5.1 3.4 8.2S14.3 18 12 20.2C9.7 18 8.6 15.1 8.6 12S9.7 6 12 3.8Z" {...p} /></>,
    chat: <><path d="M4.5 6.2a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2H10l-4.2 3.2a.5.5 0 0 1-.8-.4v-2.8a2 2 0 0 1-.5-1.3Z" {...p} /><path d="M8.5 9h7M8.5 12h4.5" {...p} /></>,
    bolt: <><path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z" {...p} fill={fill ? color : 'none'} /></>,
    pray: <><path d="M12 4c-1 2.4-2 3.8-2 6.2V14M12 4c1 2.4 2 3.8 2 6.2V14" {...p} /><path d="M8 14c-1.4.4-2.2 1.4-2.2 3v2.5h12.4V17c0-1.6-.8-2.6-2.2-3" {...p} /><path d="M10 14h4" {...p} /></>,
    lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2.4" {...p} /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" {...p} /></>,
    send: <><path d="M5 12 19.5 5.5 14 20l-3.4-6.2L5 12Z" {...p} /><path d="m10.6 13.8 4-4" {...p} /></>,
    qr: <><rect x="4" y="4" width="6" height="6" rx="1.2" {...p} /><rect x="14" y="4" width="6" height="6" rx="1.2" {...p} /><rect x="4" y="14" width="6" height="6" rx="1.2" {...p} /><path d="M14 14h2.5v2.5M20 14v.01M14 20h.01M17 17v3M20 17v.01M20 20v.01" {...p} /></>,
    gift: <><rect x="4" y="9" width="16" height="11" rx="2" {...p} /><path d="M4 13h16M12 9v11" {...p} /><path d="M12 9C12 6.5 10.5 5 8.8 5 7.5 5 7 6 7 6.8 7 8.2 8.6 9 12 9ZM12 9c0-2.5 1.5-4 3.2-4C16.5 5 17 6 17 6.8 17 8.2 15.4 9 12 9Z" {...p} /></>,
    receipt: <><path d="M6 3.5h12v17l-2.5-1.6L13 20.5l-2.5-1.6L8 20.5l-2-1.6Z" {...p} /><path d="M9 8h6M9 11.5h6M9 15h3.5" {...p} /></>,
    // serving / rota / calendar
    calendar: <><rect x="3.6" y="5" width="16.8" height="15" rx="2.6" {...p} /><path d="M3.6 9.4h16.8M8 3.2v3.4M16 3.2v3.4" {...p} /></>,
    calCheck: <><rect x="3.6" y="5" width="16.8" height="15" rx="2.6" {...p} /><path d="M3.6 9.4h16.8M8 3.2v3.4M16 3.2v3.4M8.6 14.5l2.2 2.2 4-4.3" {...p} /></>,
    calPlus: <><rect x="3.6" y="5" width="16.8" height="15" rx="2.6" {...p} /><path d="M3.6 9.4h16.8M8 3.2v3.4M16 3.2v3.4M12 12.4v4.4M9.8 14.6h4.4" {...p} /></>,
    clock: <><circle cx="12" cy="12" r="8" {...p} /><path d="M12 7.4V12l3 1.8" {...p} /></>,
    users: <><circle cx="9" cy="8.4" r="3.2" {...p} /><path d="M3.8 19c0-3 2.3-5.2 5.2-5.2s5.2 2.2 5.2 5.2" {...p} /><path d="M16 5.4a3.2 3.2 0 0 1 0 6.1M17.6 14.1c2.1.5 3.6 2.3 3.6 4.9" {...p} /></>,
    swap: <><path d="M6 9h12l-3.4-3.4" {...p} /><path d="M18 15H6l3.4 3.4" {...p} /></>,
    hand: <><path d="M8 13.5V7a1.4 1.4 0 0 1 2.8 0v4.6M10.8 11.6V5.6a1.4 1.4 0 0 1 2.8 0v5.6M13.6 11.4V6.9a1.4 1.4 0 0 1 2.8 0V14c0 3.1-2.1 5.6-5.5 5.6-2 0-3.4-.9-4.5-2.6L5 14.3a1.4 1.4 0 0 1 2.3-1.5l.7 1" {...p} /></>,
    music: <><path d="M9 18V6.4l9-2.1v9.4" {...p} /><circle cx="6.6" cy="18" r="2.4" {...p} /><circle cx="15.6" cy="15.8" r="2.4" {...p} /></>,
    coffee: <><path d="M5 8h11v5.4a3.6 3.6 0 0 1-3.6 3.6H8.6A3.6 3.6 0 0 1 5 13.4Z" {...p} /><path d="M16 9.2h1.4a2.4 2.4 0 0 1 0 4.8H16" {...p} /><path d="M8 3.4c-.5.7-.5 1.3 0 2M11.5 3.4c-.5.7-.5 1.3 0 2" {...p} /></>,
    child: <><circle cx="12" cy="5.8" r="2.4" {...p} /><path d="M12 8.4v6.2M8 11h8M9 20l3-5.6 3 5.6" {...p} /></>,
    pin: <><path d="M12 21c4-4.2 6-7.3 6-10.2A6 6 0 0 0 6 10.8C6 13.7 8 16.8 12 21Z" {...p} /><circle cx="12" cy="10.8" r="2.2" {...p} /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden="true">
      {paths[name] || null}
    </svg>
  );
}

window.Icon = Icon;

// TrinityOne "Halo" mark — one ring, three breaks, a gold spark
function Halo({ size = 28, color = 'currentColor', spark = 'var(--gold)', open = false, style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={style} aria-hidden="true">
      <circle cx="50" cy="50" r="36" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
        strokeDasharray="57.4 18" transform="rotate(-90 50 50)" />
      {!open ? <circle cx="50" cy="50" r="6.5" fill={spark} /> : null}
    </svg>
  );
}
window.Halo = Halo;
