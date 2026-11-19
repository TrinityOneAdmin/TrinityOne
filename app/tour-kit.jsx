// tour-kit.jsx — the parts of a first-run tour that do not care which app they are in.
//
// Loaded by BOTH pages: steward.html (before stew-tour.jsx) and index.html (before member-tour.jsx). Each page
// keeps its own steps, its own start rules and its own idea of "is a dialog open"; this file only knows how to
// find an anchor, where to put a bubble beside it, and how to draw the bubble with its ring and dimmed backdrop.
//
// The file MUST NOT be named stew-*.jsx: scripts/sync-web.sh deletes app/stew-*.js from the member build, and the
// member app loads this file. scripts/build-steward-apk.sh copies whatever steward.html references, so the console
// APK picks it up from the <script> tag alone.
//
// Globals this file takes from elsewhere: React (vendor), document, window, localStorage.
// Top-level names DECLARED here — unique across BOTH pages' single global scopes on purpose (a duplicate top-level
// name in classic scripts blanks the whole app): tourKitFind, tourKitWalk, tourKitPlace, tourKitReducedMotion,
// tourKitInsets, tourKitSeenMem, tourKitFlag, tourKitFlagSet, TourKitBubble.

// An anchor that is on screen (in the DOM and laid out), or null. Anchors are `data-tour="…"` attributes.
function tourKitFind(t) {
  try {
    const el = document.querySelector('[data-tour="' + t + '"]');
    if (!el) return null;
    if (el.getClientRects && !el.getClientRects().length) return null;   // display:none / not laid out
    return el;
  } catch (e) { return null; }
}
// From index `from`, walking `dir` (+1 / -1), the first step that can be shown: one with no anchor, or whose
// first anchor `present()` finds. -1 when there is none (the end, or the start).
function tourKitWalk(plan, from, dir, present) {
  for (let i = from; i >= 0 && i < plan.length; i += dir) {
    const s = plan[i];
    if (!s.targets.length || present(s.targets[0])) return i;
  }
  return -1;
}
// Where the bubble goes: beside the target if there is room (the console's sidebar), else below, else above,
// always inside a 16px gutter. No rect → centred. `vp.t` / `vp.b` (optional, default 0) are extra room to leave
// at the top and bottom — a phone's safe areas; with neither given this is exactly the console's placement.
function tourKitPlace(rect, size, vp) {
  const M = 16, G = 12;
  const T = M + (vp.t || 0), B = M + (vp.b || 0);
  const clampX = (x) => Math.max(M, Math.min(x, vp.w - size.w - M));
  const clampY = (y) => Math.max(T, Math.min(y, vp.h - size.h - B));
  if (!rect) return { side: 'center', left: clampX((vp.w - size.w) / 2), top: clampY((vp.h - size.h) / 2) };
  if (rect.right + G + size.w <= vp.w - M && rect.width <= vp.w / 3) {
    return { side: 'right', left: rect.right + G, top: clampY(rect.top + rect.height / 2 - size.h / 2) };
  }
  const left = clampX(rect.left + rect.width / 2 - size.w / 2);
  if (rect.bottom + G + size.h <= vp.h - B) return { side: 'below', left, top: Math.max(T, rect.bottom + G) };
  if (rect.top - G - size.h >= T) return { side: 'above', left, top: rect.top - G - size.h };
  return { side: 'below', left, top: clampY(rect.bottom + G) };
}
function tourKitReducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
}
// The phone's safe areas (notch, home bar) in CSS pixels, read once from a throwaway element. 0s where there are
// none, or where the page cannot be measured.
function tourKitInsets() {
  try {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.appendChild(d);
    const cs = getComputedStyle(d);
    const out = { t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
    d.remove();
    return out;
  } catch (e) { return { t: 0, b: 0 }; }
}
// "Seen" flags: per device, in localStorage, never a relay. Each flag set is ALSO kept in memory for this page
// session, and a read consults that first: with a blocked or full store (setItem throws) a write is lost, and
// without the memory "Got it" would offer the same tip again on the very next render, for ever. With it, the
// worst case is a tip shown again on the next launch, never a broken page and never a tip that cannot be closed.
const tourKitSeenMem = new Set();
function tourKitFlag(key) { if (tourKitSeenMem.has(key)) return true; try { return localStorage.getItem(key) === '1'; } catch (e) { return false; } }
function tourKitFlagSet(key) { tourKitSeenMem.add(key); try { localStorage.setItem(key, '1'); } catch (e) {} }

// ── the bubble ──────────────────────────────────────────────────────────────────────────────────────────────
// One step: a small card pointing at one real element, a ring round it and (for a tour) the rest dimmed.
//   step     { id, title, text, targets }  — targets are data-tour anchors; the first one places the bubble
//   panelRef the caller's ref for the card: each page passes the one its own dialog hook returned, which is how
//            Escape / Android Back / focus trapping stay each app's own
//   mark     the attribute the layer, card and tip carry ('data-stew-tour' / 'data-member-tour'), so each page's
//            "is something else open?" check can leave the tour itself out
//   variant  'tour' (default): dimmed, a dialog, "n of m", Skip tour / Back / Next|Done.
//            'tip': no dim, nothing behind it blocked, announced politely, one "Got it" (onNext).
//   insets   optional { t, b } safe areas for placement; ringMaxH optional cap on the ring's height (a long list)
//   primary  optional style for the Next / Done / Got it button, anim optional entrance keyframes — the console's
//            defaults are its own (the sk-btn class, lumenScale); the member page has neither and passes its own
function TourKitBubble({ step, pos, count, first, last, onNext, onBack, onSkip, panelRef, mark, variant, insets, ringMaxH, z, primary, anim }) {
  const tip = variant === 'tip';
  const attr = mark || 'data-tour-kit';
  const ownRef = React.useRef(null);
  const ref = panelRef || ownRef;
  const layerRef = React.useRef(null);
  const [box, setBox] = React.useState(null);
  const reduced = tourKitReducedMotion();
  const measure = () => {
    let rects = [], size = { w: 320, h: 190 }, vp = { w: 1024, h: 768 };
    try {
      // the LAYOUT viewport: on a phone innerWidth can report wider than the page is laid out (measured at
      // 390px: a 390px-wide bubble placed off the right edge), clientWidth is what the CSS pixels are
      const de = document.documentElement;
      vp = { w: (de && de.clientWidth) || window.innerWidth || 1024, h: (de && de.clientHeight) || window.innerHeight || 768 };
      if (insets) vp = { ...vp, t: insets.t || 0, b: insets.b || 0 };
      size = { w: Math.min(320, vp.w - 32), h: 190 };   // the width is ours to set; only the height is measured
      const p = ref.current;
      if (p && p.getBoundingClientRect) { const r = p.getBoundingClientRect(); if (r.height) size = { w: size.w, h: r.height }; }
      // A transformed ancestor makes position:fixed relative to IT, not the screen; element rects are always
      // screen coordinates. Measure where the layer really starts and draw relative to that.
      let ox = 0, oy = 0;
      const L = layerRef.current;
      if (L && L.getBoundingClientRect) { const r = L.getBoundingClientRect(); ox = r.left || 0; oy = r.top || 0; }
      for (const t of step.targets) {
        const el = tourKitFind(t);
        if (el && el.getBoundingClientRect) {
          const r = el.getBoundingClientRect();
          const h = ringMaxH ? Math.min(r.height, ringMaxH) : r.height;
          rects.push({ left: r.left - ox, top: r.top - oy, right: r.right - ox, bottom: r.top - oy + h, width: r.width, height: h });
        }
      }
    } catch (e) {}
    setBox({ rects, size, vp });
  };
  React.useEffect(() => {
    try { const el = step.targets.length ? tourKitFind(step.targets[0]) : null; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
    measure();
    const t = setTimeout(measure, 80);   // once more after layout settles (the bubble's own height, a scroll)
    return () => clearTimeout(t);
  }, [step.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const f = () => measure();
    try { window.addEventListener('resize', f); window.addEventListener('scroll', f, true); } catch (e) {}
    return () => { try { window.removeEventListener('resize', f); window.removeEventListener('scroll', f, true); } catch (e) {} };
  }, [step.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const vp = box ? box.vp : { w: 1024, h: 768 };
  const size = box ? box.size : { w: 320, h: 190 };
  const rects = box ? box.rects : [];
  const place = tourKitPlace(rects[0] || null, size, vp);
  const PAD = 6;
  const idBase = attr.replace(/^data-/, '');
  const titleId = idBase + '-title', textId = idBase + '-text', maskId = idBase + '-mask';
  const btn = { minHeight: 40, padding: '8px 14px', borderRadius: 11, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' };
  const card = tip
    ? { role: 'status', 'aria-live': 'polite', 'aria-label': 'Tip: ' + step.title }
    : { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': textId, tabIndex: -1 };
  return (
    <div ref={layerRef} {...{ [attr]: tip ? 'tip' : 'layer' }} style={{ position: 'fixed', inset: 0, zIndex: z || 260, pointerEvents: tip ? 'none' : 'auto' }}>
      {/* the dim, with a hole round each target. Clicks on it do nothing — a stray tap must not end the tour. */}
      {tip ? null : (
        <svg width="100%" height="100%" aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'block' }}>
          <defs>
            <mask id={maskId}>
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {rects.map((r, i) => <rect key={i} x={r.left - PAD} y={r.top - PAD} width={r.width + PAD * 2} height={r.height + PAD * 2} rx="12" fill="black" />)}
            </mask>
          </defs>
          <rect x="0" y="0" width="100%" height="100%" fill="rgba(30,24,18,.46)" mask={'url(#' + maskId + ')'} />
        </svg>
      )}
      {rects.map((r, i) => <div key={i} aria-hidden="true" style={{ position: 'absolute', left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2, borderRadius: 12, boxShadow: '0 0 0 3px var(--clay)', pointerEvents: 'none' }} />)}
      <div ref={ref} {...{ [attr]: tip ? 'tip-card' : 'bubble' }} {...card}
        style={{ position: 'absolute', left: place.left, top: place.top, width: size.w, boxSizing: 'border-box', visibility: box ? 'visible' : 'hidden',
          background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 16, padding: '16px 16px 14px',
          boxShadow: '0 18px 50px rgba(0,0,0,.24)', outline: 'none', fontFamily: 'var(--font-ui)', pointerEvents: 'auto',
          borderLeft: tip ? '4px solid var(--clay)' : '1px solid var(--line)',
          animation: reduced ? 'none' : (anim || 'lumenScale') + ' .2s ease both' }}>
        {tip ? null : <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 4 }}>{pos} of {count}</div>}
        <h2 id={titleId} style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16.5, margin: '0 0 6px' }}>{step.title}</h2>
        <p id={textId} style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink-2)', margin: '0 0 14px' }}>{step.text}</p>
        {tip ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onNext} className="sk-btn sk-btn--clay" style={{ ...btn, ...(primary || {}) }}>Got it</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={onSkip} style={{ ...btn, border: 'none', background: 'none', color: 'var(--ink-3)', padding: '8px 4px' }}>Skip tour</button>
            <div style={{ flex: 1 }} />
            {first ? null : <button onClick={onBack} style={{ ...btn, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)' }}>Back</button>}
            <button onClick={onNext} className="sk-btn sk-btn--clay" style={{ ...btn, ...(primary || {}) }}>{last ? 'Done' : 'Next'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

window.TourKitBubble = TourKitBubble;
