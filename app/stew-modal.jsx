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
// ANDROID BACK CLOSES THE TOPMOST DIALOG — the member app's way (app/ui.jsx useBackLayer: one stack, one
// handler), and the same stack Escape already uses. Device round 2026-10-01 (Oppo): CkModal dialogs ("Parents
// of …") and the schedule's service dialog ignored Back, because only a handful of console dialogs had wired
// their own Capacitor listener, one by one. Now every dialog that comes through useStewDialog has it.
// ONE native listener, present only WHILE A DIALOG IS OPEN: with none open, Back does what it always did. And
// one, not one per dialog, because Capacitor calls EVERY backButton listener — a dialog over a dialog that each
// held its own closed both on one press. The dialogs that used to register their own (StewSectionsMenu,
// StewMemberSheet, StewardHelp) no longer do; InvitePosterModal and the printable overlay are not on this
// stack and keep theirs.
let _stewBackSub = null, _stewBackWait = false;
function _stewBackSync() {
  try {
    const AppP = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (_stewBack.length && !_stewBackSub && !_stewBackWait && AppP && AppP.addListener) {
      const h = AppP.addListener('backButton', () => { const top = _stewBack[_stewBack.length - 1]; if (top) { try { top.close(); } catch (e) {} } });
      if (h && typeof h.remove === 'function') _stewBackSub = h;   // Capacitor's handle (also a promise on some versions)
      else if (h && typeof h.then === 'function') {
        _stewBackWait = true;
        h.then((hh) => { _stewBackWait = false; _stewBackSub = hh || null; _stewBackSync(); }, () => { _stewBackWait = false; });
      }
    } else if (!_stewBack.length && _stewBackSub) {
      const h = _stewBackSub; _stewBackSub = null;
      try { h.remove(); } catch (e) {}
    }
  } catch (e) {}
}
if (typeof document !== 'undefined' && !window.__stewEscWired) {
  window.__stewEscWired = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !_stewBack.length) return;
    // A DOCUMENT-WIDE Escape HANDLER MUST NOT STEAL Escape FROM WHAT HAS FOCUS. Audit 2026-09-02 #27.
    // Escape closes an open <select> and cancels an IME composition; swallowing it there shut the whole
    // modal instead, losing whatever the steward had typed. Costs one thing, said plainly: with a SELECT
    // focused, Escape no longer closes the modal — tab off it first.
    if (e.isComposing) return;
    const el = typeof document !== 'undefined' && document.activeElement;
    if (el && String(el.tagName || '').toUpperCase() === 'SELECT') return;
    e.preventDefault();
    const top = _stewBack[_stewBack.length - 1];
    try { top.close(); } catch (err) {}
  });
}
// ── IS ANY MODAL OPEN? ────────────────────────────────────────────────────────────────────────────────────
//
// Nothing outside a modal could answer that question, and one thing needs to: the console's error banner sits
// ABOVE every overlay on purpose (z-index 240 over the overlays' 50-220 — AUDIT-9, because it was painted
// underneath them, greyed and untappable, while FinanceShareStatement and the first-run wizard both publish
// with their modal still open). The cost of that fix, found by the owner on the Oppo on 2026-09-17 and
// described as “oddly cropped”: an opaque pink band across the TOP of an open dialog, over its title and
// first lines. Both readings are right; what has to change is WHERE the banner sits while a dialog is up.
//
// A COUNTER, NOT A DOM QUERY. Every console dialog already comes through useStewDialog for Escape and focus,
// so this is the one place that already knows, and it is exact — no observer, no polling, and a test can
// drive it. What it does NOT cover is an overlay that skips this hook; the two in the console that did
// (WizShell, and the meals care conversation) now call useStewModalOpen directly.
//
// ⚠ IT COUNTS, IT DOES NOT FLAG. Dialogs nest — SkConfirm opens over the categories modal — and a boolean
// would clear on the inner one's close while the outer was still up.
const _stewModals = [];
function _stewModalsChanged() {
  try { window.dispatchEvent(new CustomEvent('stew-modals', { detail: { open: _stewModals.length } })); } catch (e) {}
}
function useStewModalOpen(active) {
  const on = active === undefined ? true : active;
  React.useEffect(() => {
    if (!on) return;
    const tag = {};
    _stewModals.push(tag);
    _stewModalsChanged();
    return () => {
      const i = _stewModals.indexOf(tag);
      if (i >= 0) _stewModals.splice(i, 1);
      _stewModalsChanged();
    };
  }, [on]);
}
window.useStewModalOpen = useStewModalOpen;
window.stewModalOpen = () => _stewModals.length > 0;

function useStewDialog(onClose, active) {
  useStewModalOpen(active);   // every console dialog registers itself by coming through here
  const on = active === undefined ? true : active;
  const panelRef = React.useRef(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    if (!on) return;
    const entry = { close: () => { try { closeRef.current && closeRef.current(); } catch (e) {} } };
    _stewBack.push(entry);
    _stewBackSync();
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
      _stewBackSync();
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
      <button onClick={() => { try { localStorage.setItem(key, '1'); } catch (e) {} setGone(true); }} aria-label="Dismiss this note" title="Dismiss" style={{ flexShrink: 0, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, padding: 0, margin: '-4px -5px 0 0' }}><Icon name="x" size={15} color="currentColor" /></button>
    </div>
  );
}
window.DismissibleNote = DismissibleNote;
