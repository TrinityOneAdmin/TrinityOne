// header-more.jsx — ONE chevron + panel for the Today and Community headers (PLAN-today-header-narrow, owner
// decisions 2026-11-16; AUDIT-PLAN-headers-today-community-2026-11-16 HIGH 1).
//
// WHY IT IS ITS OWN FILE and not in ui.jsx: scripts/render-jsx-screen.mjs `loadScreen` builds each screen with
// `new Function(...injectedNames, source)`, so a free identifier the test did not inject is a ReferenceError.
// Both screens use these three names; loadScreen prepends THIS file when a screen mentions `useHeaderMore`
// (the same way it prepends reply-kit.jsx for TrinityReplyKit). Prepending ui.jsx the same way would redeclare
// IconBtn and friends inside the function and shadow the tests' own stubs, so the shared code is small and
// stands alone. Dependencies: React, Icon and TrinityReplyKit — the last only at effect time (reply-kit.jsx
// loads AFTER this file's neighbours, never touch it at load).
//
// Loaded between ui.jsx and screens-today.jsx (index.html). Classic script: function declarations only, no
// top-level const/let (they would be shared globals — see memory "classic-script global collisions"), and the
// hooks are called as React.useState / React.useEffect, never destructured.
//
//   const hm = useHeaderMore();                       // open state + Escape + tap-off + focus
//   <HeaderMoreChevron hm={hm} />                     // a direct button child of the header's controls
//   <HeaderMorePanel hm={hm} items={[{ id, label, ariaLabel, title, icon | iconNode, onPick, refocus }]} />
//
// ONE shared attribute, data-hdr-more, is on the chevron AND the panel and is the tapOffHandler selector: a press
// ON the chevron is not "outside", so the chevron can close the row it opened (otherwise pointerdown closes it
// and the click that follows reopens it). The panel is rendered only while open, and nothing is hidden by CSS.
function useHeaderMore() {
  const [open, setOpen] = React.useState(false);
  // The close handlers read the CURRENT state from a ref and do nothing once the menu is shut, because a handler can
  // outlive its render by one tick (e.g. after Listen was picked and its overlay owns Back and Escape).
  const openRef = React.useRef(false);
  openRef.current = open;
  // preventScroll ALWAYS: a bare focus() scrolls the focused element into view, and the chevron lives at the top of the
  // page, so a page scrolled down would jump back to the top.
  const focusSel = (sel) => { try { const el = document.querySelector(sel); if (el && el.focus) el.focus({ preventScroll: true }); } catch (e) {} };
  // Escape and hardware Back: shut it and hand focus back to the chevron.
  const dismiss = () => { if (!openRef.current) return; setOpen(false); focusSel('[data-hdr-more="chevron"]'); };
  // A TAP OFF closes the menu and moves NOTHING: the press is aimed at something else (a card), and a focus() call made
  // during the pointerdown scrolled a scrolled page back to the top, so the click that followed missed its card.
  const tapOff = () => { if (!openRef.current) return; setOpen(false); };
  React.useEffect(() => {
    if (!open) return undefined;
    const off = TrinityReplyKit.tapOffHandler('[data-hdr-more]', tapOff);
    document.addEventListener('pointerdown', off, true);
    focusSel('[data-hdr-item]');   // first item in DOM order
    return () => document.removeEventListener('pointerdown', off, true);
  }, [open]);
  // HARDWARE BACK *AND* ESCAPE both close the menu through the app's one back stack, so each runs `dismiss` ONCE.
  // The mechanism is useBackLayer (app/ui.jsx): an open layer registers its close handler on window.__trinityBackStack;
  // app.jsx's popstate handler calls window.trinityGoBack(), which closes the topmost one before it considers tab
  // navigation, and ui.jsx's own global keydown handler sends Escape to the same trinityGoBack. Same hook the sheets,
  // overlays and the Read-screen popover use. This file used to add an Escape listener of its own, which made Escape
  // close the menu twice. `typeof` because other test harnesses load this file without ui.jsx; in the app the name
  // is always defined, so the hook order never changes within one environment.
  if (typeof useBackLayer === 'function') useBackLayer(open, dismiss);
  return {
    open,
    toggle: () => setOpen(o => !o),
    close: () => setOpen(false),
    focusChevron: () => focusSel('[data-hdr-more="chevron"]'),
  };
}

function HeaderMoreChevron({ hm }) {
  return (
    <button onClick={hm.toggle} aria-label="More" aria-expanded={hm.open} aria-controls={hm.open ? 'hdr-more-panel' : undefined}
      data-hdr-more="chevron" style={{
      width: 44, height: 44, borderRadius: 14, border: hm.open ? '1px solid var(--clay)' : '1px solid var(--line)', flexShrink: 0,
      background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', boxShadow: 'var(--shadow)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
    }}><Icon name={hm.open ? 'chevU' : 'chevD'} size={19} /></button>
  );
}

function HeaderMorePanel({ hm, items, style }) {
  if (!hm.open) return null;
  return (
    <div id="hdr-more-panel" data-hdr-more="panel" style={{ display: 'flex', gap: 8, ...(style || {}) }}>
      {items.map(it => (
        <button key={it.id} data-hdr-item={it.id} aria-label={it.ariaLabel} title={it.title}
          onClick={() => { it.onPick(); hm.close(); if (it.refocus) hm.focusChevron(); }} style={{
          flex: 1, minWidth: 0, minHeight: 48, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)',
          cursor: 'pointer', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          font: 'inherit', fontWeight: 700, fontSize: 14.5, padding: '0 6px',
        }}>
          {it.iconNode ? it.iconNode : <Icon name={it.icon} size={19} />}
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}

if (typeof window !== 'undefined') { window.useHeaderMore = useHeaderMore; window.HeaderMoreChevron = HeaderMoreChevron; window.HeaderMorePanel = HeaderMorePanel; }
