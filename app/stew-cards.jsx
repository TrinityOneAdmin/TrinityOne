// CONSOLE CARD RENDERERS — the steward's own view of a RENDERABLE card post (PLAN-CONSOLE-CARD-RENDER-2026-10-30).
//
// When a treasurer posts a financial statement to members, the post is an ordinary kind-1 group message whose
// plain-text body is the fallback AND which carries a ['card','1',<json>] tag (app/stew-finance.jsx
// postStatementToMembers). The MEMBER app draws that tag as a branded finance card (app/screens-chat.jsx
// FinanceCard); this file is the CONSOLE's own copy so the steward sees the same card in GroupChatModal
// instead of only the text body.
//
// DUPLICATE, not shared (PLAN §4): the member renderer is an esbuild-bundled component; the console is classic
// scripts sharing one global scope. The two module systems don't share a view file. CARD-ENVELOPE-contract.md
// is the single source of truth both read. This is ~pure presentation with no business logic to drift.
//
// ONE consumer: GroupChatModal in app/stew-dashboard.jsx (mounted at the groups list, the group sheet and the
// docked chat tray). cardRenderable()/ConsoleCard are the only names it reads from here.
//
// SECURITY — anti-beacon, the same rule as _avPhoto/_avColor (app/stew-data.jsx) and invImgDataUrl/
// churchMarkDataUrl (app/stew-dashboard.jsx): the branding comes from the church profile the console already
// holds (church.picture/.banner/.accent), NEVER from the post. Only ever embed a data: image — validate the
// WHOLE string (base64's alphabet excludes ')', so no url() beacon can ride the tail into the CSS/img sink) —
// and only interpolate a plain hex colour. The console has no `church.initials` field, so they are derived
// from church.name (as app/stew-dashboard.jsx does elsewhere).

const CARD_SYM = { GBP: '£', USD: '$', EUR: '€', sats: 'sats' };

function cardMoney(minor, currency, decimals) {
  const d = Number.isInteger(decimals) && decimals >= 0 ? decimals : 2;
  const s = ((Number(minor) || 0) / Math.pow(10, d)).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sym = CARD_SYM[currency] || '';
  return currency === 'sats' ? (s + ' ' + sym) : (sym + s);
}

// a data: image only, whole-string validated (anti-beacon). 512KB cap stops a megabyte of image in a bubble.
function cardImgUrl(src) {
  const v = typeof src === 'string' ? src : '';
  if (v.length > 512 * 1024) return '';
  return /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(v) ? v : '';
}

// a plain hex colour only (it is interpolated into CSS), else the fallback. Mirrors the member safeCssColor
// guard; a crafted string could otherwise smuggle url() into a gradient and beacon that way.
function cardColor(c, fallback) {
  const h = typeof c === 'string' ? c.trim() : '';
  return /^#[0-9a-fA-F]{3,8}$/.test(h) ? h : (fallback || 'var(--clay)');
}

// darken a pale accent so title text stays legible on the card's surface (copied from the member renderer).
function cardInk(accent) {
  const h = typeof accent === 'string' ? accent.trim() : '';
  if (!/^#[0-9a-fA-F]{3,8}$/.test(h)) return cardColor(accent, 'var(--clay)');
  let c = h.slice(1);
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (c.length < 6) return '#2b2723';
  c = c.slice(0, 6);
  let r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum > 0.62) { const k = 0.62 / lum; r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k); }
  const hx = n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return '#' + hx(r) + hx(g) + hx(b);
}

function cardInitials(name) {
  return (String(name || '').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase()) || '';
}

// FINANCE CARD — the console's copy of the member FinanceCard. Reads ONLY aggregate fields (title, periodLabel,
// currency, decimals, generatedAt; summary totals; rows[].name + amount/balance; a note's text). Name-free by
// construction. An unknown section kind is skipped, never thrown.
function ConsoleFinanceCard({ card, church }) {
  const ch = church || {};
  const ink = cardInk(ch.accent);
  const branded = card.branded !== false;
  const banner = branded ? cardImgUrl(ch.banner) : '';
  const logo = branded ? cardImgUrl(ch.picture) : '';   // data: URI only (anti-beacon) — never a remote logo URL
  const initials = cardInitials(ch.name);
  const f = m => cardMoney(m, card.currency, card.decimals);
  const sections = Array.isArray(card.sections) ? card.sections : [];
  const line = (label, value, strong, key) => (
    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0', fontSize: 13.5 }}>
      <span style={{ color: 'var(--ink-2)', fontWeight: strong ? 700 : 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: strong ? 800 : 600, color: 'var(--ink)' }}>{value}</span>
    </div>
  );
  return (
    <div style={{ maxWidth: 300, borderRadius: 16, overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }}>
      {banner ? <img src={banner} alt="" style={{ display: 'block', width: '100%', height: 72, objectFit: 'cover' }} /> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px 11px', borderBottom: '2px solid ' + ink }}>
        {logo
          ? <img src={logo} alt="" width={34} height={34} style={{ width: 34, height: 34, borderRadius: 9, objectFit: 'cover', flexShrink: 0 }} />
          : <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: ink, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13 }}>{initials}</div>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: ink, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.title || ch.name || 'Financial statement'}</div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.4px', color: 'var(--ink-3)', textTransform: 'uppercase', marginTop: 2 }}>Financial statement{card.periodLabel ? ' · ' + card.periodLabel : ''}</div>
        </div>
      </div>
      <div style={{ padding: '10px 15px 13px' }}>
        {sections.map((s, i) => {
          if (!s || typeof s !== 'object') return null;
          if (s.kind === 'summary') {
            return (
              <div key={i} style={{ marginBottom: 10 }}>
                {line('Total income', f(s.income), false, 'in')}
                {line('Total spending', f(s.expenditure), false, 'ex')}
                {line(Number(s.surplus) < 0 ? 'Deficit' : 'Surplus', f(s.surplus), true, 'su')}
              </div>
            );
          }
          if (s.kind === 'rows') {
            const rows = Array.isArray(s.rows) ? s.rows : [];
            if (!rows.length) return null;
            return (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.5px', color: ink, textTransform: 'uppercase', margin: '4px 0 3px' }}>{s.label || ''}</div>
                {rows.map((r, j) => line((r && r.name) || '—', f(r && (r.amount != null ? r.amount : r.balance)), false, j))}
              </div>
            );
          }
          if (s.kind === 'note') {
            const txt = typeof s.text === 'string' ? s.text.trim() : '';
            if (!txt) return null;
            return (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.5px', color: ink, textTransform: 'uppercase', margin: '4px 0 3px' }}>Treasurer's note</div>
                <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--ink-2)', whiteSpace: 'pre-wrap', textWrap: 'pretty' }}>{txt}</div>
              </div>
            );
          }
          return null;   // a section kind this build does not know → skip it, never throw
        })}
        <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 6, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
          Prepared with TrinityOne · aggregate figures only{card.generatedAt ? ' · ' + card.generatedAt : ''}
        </div>
      </div>
    </div>
  );
}

// Does this card have a type THIS console can draw? Finance-only for now (PLAN decision 2). GroupChatModal asks
// this before rendering; anything else (unknown type, or no card) falls back to the plain-text body. Adding a
// future card type means extending this and ConsoleCard, NOT touching GroupChatModal.
function cardRenderable(card) {
  return !!(card && typeof card === 'object' && card.type === 'finance');
}

// The dispatcher: a card object → its console component, or null for a type this build can't draw.
function ConsoleCard({ card, church }) {
  if (!card || typeof card !== 'object') return null;
  if (card.type === 'finance') return <ConsoleFinanceCard card={card} church={church} />;
  return null;
}
