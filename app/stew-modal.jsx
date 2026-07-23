// stew-modal.jsx — shared modal a11y for the STEWARD CONSOLE (steward.html), which does NOT load the member
// app's ui.jsx and so had bespoke dialog overlays with no role=dialog / aria-modal / keyboard Escape / focus
// management. useStewDialog(onClose, active) returns a ref you put on the modal's PANEL element (the inner box,
// not the dimmed backdrop). While the dialog is active it:
//   • registers onClose on a small stack so keyboard Escape closes the TOPMOST dialog (nested dialogs pop in order);
//   • moves focus onto the panel — but NOT if the modal already focused its own field (e.g. an autoFocus input),
//     and never auto-focuses an input itself (would pop the mobile soft-keyboard);
//   • traps Tab within the panel; restores focus to the trigger on close.
// Purely additive: callers keep their existing backdrop/panel markup, styles, and backdrop-click/hardware-back.
// `active` defaults true (for the common conditionally-mounted `{cond && <Modal/>}` pattern); pass the open flag
// for a modal that stays mounted and toggles an `open` prop.
const _stewBack = [];
if (typeof document !== 'undefined' && !window.__stewEscWired) {
  window.__stewEscWired = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !_stewBack.length) return;
    e.preventDefault();
    const top = _stewBack[_stewBack.length - 1];
    try { top.close(); } catch (err) {}
  });
}
function useStewDialog(onClose, active) {
  const on = active === undefined ? true : active;
  const panelRef = React.useRef(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    if (!on) return;
    const entry = { close: () => { try { closeRef.current && closeRef.current(); } catch (e) {} } };
    _stewBack.push(entry);
    const prevFocus = (typeof document !== 'undefined') ? document.activeElement : null;
    const t = setTimeout(() => { const p = panelRef.current; if (p && !p.contains(document.activeElement)) { try { p.focus(); } catch (e) {} } }, 60);
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const p = panelRef.current; if (!p) return;
      const nodes = p.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
      if (!nodes.length) { e.preventDefault(); p.focus(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || a === p)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    };
    const p = panelRef.current; if (p) p.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      if (p) p.removeEventListener('keydown', onKey);
      const i = _stewBack.indexOf(entry); if (i >= 0) _stewBack.splice(i, 1);
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} }
    };
  }, [on]);
  return panelRef;
}
window.useStewDialog = useStewDialog;

// A dismissible help/intro banner — the tinted "here's what this section does" callouts. The × writes a
// per-note localStorage flag ('trinityone.note.<id>') so a steward who's read it never sees it again.
// tone: 'sage' (default) | 'gold' | 'clay'. Pass `style` for the caller's spacing (e.g. marginBottom).
function DismissibleNote({ id, icon, tone, children, style }) {
  const key = 'trinityone.note.' + id;
  const [gone, setGone] = React.useState(() => { try { return localStorage.getItem(key) === '1'; } catch (e) { return false; } });
  if (gone) return null;
  const cv = tone === 'gold' ? 'var(--gold)' : tone === 'clay' ? 'var(--clay)' : 'var(--sage)';
  const ic = tone === 'gold' ? '#8a6717' : tone === 'clay' ? 'var(--clay-ink)' : 'var(--sage)';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 12px', borderRadius: 12, background: 'color-mix(in oklab, ' + cv + ' 8%, var(--surface))', border: '1px solid color-mix(in oklab, ' + cv + ' 24%, var(--line))', ...(style || {}) }}>
      {icon ? <Icon name={icon} size={16} color={ic} style={{ flexShrink: 0, marginTop: 1 }} /> : null}
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>{children}</div>
      <button onClick={() => { try { localStorage.setItem(key, '1'); } catch (e) {} setGone(true); }} aria-label="Dismiss this note" title="Dismiss" style={{ flexShrink: 0, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 2, margin: '-2px -3px 0 0' }}><Icon name="x" size={15} color="currentColor" /></button>
    </div>
  );
}
window.DismissibleNote = DismissibleNote;
