// help-illustrations.jsx — gentle Halo line illustrations that aid understanding.
// <HelpIllo name="paper" size={120} tone="var(--clay)" />  Exports window.HelpIllo
function HelpIllo({ name, size = 120, tone = 'var(--clay)', soft = 'var(--clay-soft)' }) {
  const s = { fill: 'none', stroke: tone, strokeWidth: 4, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const fillSoft = { fill: soft, stroke: 'none' };
  const art = {
    // safety / key ring (welcome)
    shield: <>
      <circle cx="60" cy="58" r="30" {...fillSoft} />
      <path d="M60 26 86 36v20c0 18-12 29-26 34-14-5-26-16-26-34V36Z" {...s} />
      <path d="m49 57 7 7 15-16" {...s} />
    </>,
    // paper + pen, words written (12 words) — the hero
    paper: <>
      <rect x="26" y="22" width="52" height="64" rx="6" {...fillSoft} />
      <rect x="26" y="22" width="52" height="64" rx="6" {...s} />
      <path d="M36 40h26M36 52h32M36 64h20" {...s} strokeWidth="3.4" />
      <path d="M70 78c6-3 11-9 16-19 2-4-3-8-6-5-6 6-9 14-10 24Z" {...s} />
      <path d="m83 53 4-6" {...s} />
    </>,
    // face in a circle — name & picture
    face: <>
      <circle cx="60" cy="56" r="30" {...fillSoft} />
      <circle cx="60" cy="56" r="30" {...s} />
      <circle cx="60" cy="48" r="9" {...s} />
      <path d="M44 74c3-7 9-11 16-11s13 4 16 11" {...s} />
    </>,
    // two phones, arrow (new phone / restore)
    phone: <>
      <rect x="22" y="30" width="34" height="56" rx="7" {...fillSoft} />
      <rect x="22" y="30" width="34" height="56" rx="7" {...s} />
      <rect x="66" y="22" width="34" height="56" rx="7" {...s} />
      <path d="M39 76h.04M83 30h.04" {...s} />
      <path d="M58 56h8m0 0-3-3m3 3-3 3" {...s} strokeWidth="3.4" />
    </>,
    // hand raised "no / don't ask" (scams)
    noask: <>
      <circle cx="60" cy="56" r="30" {...fillSoft} />
      <path d="M48 60V44a4 4 0 0 1 8 0v12m0-2v-4a4 4 0 0 1 8 0v6m0-3a4 4 0 0 1 8 0v9c0 9-6 15-15 15s-13-5-16-13l-2-5c-1-4 4-6 6-3l3 5" {...s} />
      <circle cx="60" cy="56" r="30" {...s} />
      <path d="M38 34 82 78" stroke={tone} strokeWidth="4" strokeLinecap="round" />
    </>,
    // purse / wallet with coin (giving)
    wallet: <>
      <rect x="24" y="38" width="60" height="44" rx="9" {...fillSoft} />
      <rect x="24" y="38" width="60" height="44" rx="9" {...s} />
      <path d="M24 50c10-12 26-18 40-14l14 4" {...s} />
      <circle cx="74" cy="60" r="6" {...s} />
    </>,
    // QR invite (steward)
    qr: <>
      <rect x="28" y="28" width="64" height="64" rx="8" {...fillSoft} />
      <rect x="28" y="28" width="64" height="64" rx="8" {...s} />
      <rect x="40" y="40" width="14" height="14" rx="3" {...s} strokeWidth="3.4" />
      <rect x="66" y="40" width="14" height="14" rx="3" {...s} strokeWidth="3.4" />
      <rect x="40" y="66" width="14" height="14" rx="3" {...s} strokeWidth="3.4" />
      <path d="M66 66h6v6m8 0v.04M72 80h.04M80 80v-6" {...s} strokeWidth="3.4" />
    </>,
    // open book (reading the Bible)
    book: <>
      <path d="M60 34c-7-6-17-8-28-7-3 0-5 2-5 5v36c0 3 2 5 5 5 11-1 21 1 28 7" {...fillSoft} />
      <path d="M60 34c7-6 17-8 28-7 3 0 5 2 5 5v36c0 3-2 5-5 5-11-1-21 1-28 7" {...s} />
      <path d="M60 34c-7-6-17-8-28-7-3 0-5 2-5 5v36c0 3 2 5 5 5 11-1 21 1 28 7 7-6 17-8 28-7 3 0 5-2 5-5V32c0-3-2-5-5-5-11-1-21 1-28 7Z" {...s} />
      <path d="M60 34v46" {...s} strokeWidth="3.4" />
    </>,
    // two people (community / fellowship)
    people: <>
      <circle cx="60" cy="56" r="30" {...fillSoft} />
      <circle cx="48" cy="48" r="9" {...s} />
      <circle cx="73" cy="51" r="7" {...s} />
      <path d="M33 76c2-8 8-13 15-13s13 5 15 13" {...s} />
      <path d="M66 70c2-5 6-8 11-8 5 0 9 3 11 8" {...s} strokeWidth="3.4" />
    </>,
    // bell with a gentle alert dot (notifications)
    bell: <>
      <circle cx="60" cy="54" r="30" {...fillSoft} />
      <path d="M44 68c-3 0-4-3-2-5 3-3 5-6 5-12a13 13 0 0 1 26 0c0 6 2 9 5 12 2 2 1 5-2 5Z" {...s} />
      <path d="M54 74a6 6 0 0 0 12 0" {...s} strokeWidth="3.4" />
      <path d="M60 33v-5" {...s} strokeWidth="3.4" />
      <circle cx="80" cy="40" r="6" fill={tone} stroke="none" />
    </>,
    // safe / lockbox (backup hero variant)
    safe: <>
      <rect x="24" y="30" width="62" height="56" rx="8" {...fillSoft} />
      <rect x="24" y="30" width="62" height="56" rx="8" {...s} />
      <circle cx="58" cy="58" r="13" {...s} />
      <path d="M58 58v-6M58 58l5 3" {...s} strokeWidth="3.4" />
      <path d="M34 86v6M76 86v6" {...s} />
    </>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 120 116" aria-hidden="true">{art[name] || art.shield}</svg>
  );
}
window.HelpIllo = HelpIllo;
