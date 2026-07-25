// ui.jsx — TrinityOne shared UI primitives. Exports several to window.
// Alias the hooks (not bare useState/useEffect/useRef): as a classic script this file's top-level
// consts are shared globals, so land-grabbing the canonical names would collide with the idiomatic
// `const { useState } = React;` in any other .jsx and blank the APK. Every other .jsx aliases too.
const { useState: useU, useEffect: useUE, useRef: useUR } = React;

function cx(...a) { return a.filter(Boolean).join(' '); }

// Name-clash disambiguation: identity is the pubkey, names are free-text labels, so two members
// (or churches) can share a name. Build a labeller over a list that appends a discriminator ONLY to
// the colliding names — a verified @handle if there is one, else a short key tag — so the common
// case stays clean and duplicates are always tellable apart (also a quiet guard against copycats).
function makeNameDisambiguator(list, getName, getHandle, getKey) {
  const norm = (s) => String(s || '').trim().toLowerCase();
  const counts = {};
  (list || []).forEach((e) => { const n = norm(getName(e)); if (n) counts[n] = (counts[n] || 0) + 1; });
  const shortKey = (k) => { k = String(k || ''); return k.length > 14 ? k.slice(0, 10) + '…' + k.slice(-4) : k; };
  return (e) => {
    const name = getName(e) || '';
    if (!name || (counts[norm(name)] || 0) < 2) return name;       // unique here → show plain
    const h = getHandle ? getHandle(e) : '';
    const disc = h ? '@' + String(h).split('@')[0] : shortKey(getKey ? getKey(e) : '');
    return disc ? name + ' · ' + disc : name;
  };
}

// ── Warm status bar ──
function StatusBar() {
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
      height: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 30px', paddingTop: 14, color: 'var(--ink)',
      fontFamily: 'var(--font-ui)', pointerEvents: 'none',
    }}>
      <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '.2px' }}>9:41</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="18" height="11" viewBox="0 0 18 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx=".6"/><rect x="4.5" y="4.6" width="3" height="6.4" rx=".6"/><rect x="9" y="2.3" width="3" height="8.7" rx=".6"/><rect x="13.5" y="0" width="3" height="11" rx=".6"/></svg>
        <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor"><path d="M8 2.6c2.1 0 4 .8 5.4 2.2l1-1A9 9 0 0 0 8 1 9 9 0 0 0 1.6 3.8l1 1A7.5 7.5 0 0 1 8 2.6Z"/><path d="M8 6c1.1 0 2.1.4 2.9 1.2l1-1A6 6 0 0 0 8 4.4 6 6 0 0 0 4.1 6.2l1 1A4.2 4.2 0 0 1 8 6Z"/><circle cx="8" cy="9.4" r="1.3"/></svg>
        <svg width="25" height="12" viewBox="0 0 25 12"><rect x="0.5" y="0.5" width="21" height="11" rx="3" fill="none" stroke="currentColor" strokeOpacity=".35"/><rect x="2" y="2" width="17" height="8" rx="1.6" fill="currentColor"/><rect x="23" y="4" width="1.5" height="4" rx=".75" fill="currentColor" fillOpacity=".5"/></svg>
      </div>
    </div>
  );
}

// ── Device bezel ──
function PhoneFrame({ children, bare }) {
  // bare = a real device (native app / installed PWA / phone-sized viewport): fill the screen,
  // no mockup bezel / notch / fake status bar — the OS provides those.
  if (bare) {
    return (
      <div style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        background: 'var(--paper)', color: 'var(--ink)',
        fontFamily: 'var(--font-ui)', WebkitFontSmoothing: 'antialiased',
      }}>
        {children}
      </div>
    );
  }
  return (
    <div style={{
      width: 392, height: 846, borderRadius: 54, padding: 5,
      background: 'linear-gradient(150deg, #2b2b2e, #0d0d0f 60%)',
      boxShadow: '0 50px 90px rgba(40,30,20,.32), 0 0 0 1.5px rgba(0,0,0,.5), inset 0 0 3px rgba(255,255,255,.2)',
      position: 'relative',
    }}>
      <div style={{
        width: '100%', height: '100%', borderRadius: 49, overflow: 'hidden',
        position: 'relative', background: 'var(--paper)', color: 'var(--ink)',
        fontFamily: 'var(--font-ui)', WebkitFontSmoothing: 'antialiased',
      }}>
        <div style={{
          position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)',
          width: 116, height: 34, borderRadius: 20, background: '#000', zIndex: 40,
        }} />
        <StatusBar />
        {children}
      </div>
    </div>
  );
}

// ── Floating tab bar ──
const TABS = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'read', label: 'Read', icon: 'read' },
  { id: 'chat', label: 'Community', icon: 'chat' },
  { id: 'library', label: 'Library', icon: 'library' },
];
function TabBar({ active, onChange, unread = {}, tabs = TABS, onProfile, profileAv, profileName }) {
  return (
    <div style={{
      position: 'absolute', left: 12, right: 12, bottom: 'max(12px, env(safe-area-inset-bottom))', zIndex: 25,
      height: 66, borderRadius: 26, display: 'flex', alignItems: 'center',
      justifyContent: 'space-around', padding: '0 6px',
      background: 'color-mix(in oklab, var(--surface) 82%, transparent)',
      backdropFilter: 'blur(20px) saturate(160%)', WebkitBackdropFilter: 'blur(20px) saturate(160%)',
      border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)',
    }}>
      {tabs.map(t => {
        const on = active === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            border: 'none', background: 'none', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            padding: '6px 4px', flex: 1, color: on ? 'var(--clay)' : 'var(--ink-3)',
            transition: 'color .2s', position: 'relative',
          }}>
            <div style={{ position: 'relative', transform: on ? 'translateY(-1px)' : 'none', transition: 'transform .25s cubic-bezier(.34,1.56,.64,1)' }}>
              <Icon name={t.icon} size={23} stroke={on ? 2.1 : 1.8} />
              {unread[t.id] && !on ? <span style={{ position: 'absolute', top: -2, right: -5, width: 9, height: 9, borderRadius: 999, background: 'var(--clay)', border: '2px solid var(--surface)' }} /> : null}
            </div>
            <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 500, letterSpacing: '.1px' }}>{t.label}</span>
          </button>
        );
      })}
      {/* You & settings — reachable from every tab (hidden while the community is PIN-locked, so a locked
         phone still reads as a plain Bible app). Opens the identity/settings hub. */}
      {onProfile ? (
        <button onClick={onProfile} title="You & settings" style={{
          border: 'none', background: 'none', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          padding: '6px 4px', flex: 1, color: 'var(--ink-3)', position: 'relative',
        }}>
          <div style={{ lineHeight: 0 }}><UserAvatar av={profileAv} name={profileName} size={24} /></div>
          <span style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '.1px' }}>You</span>
        </button>
      ) : null}
    </div>
  );
}

// ── Desktop left sidebar nav (replaces the floating TabBar on a wide screen) ──
function DesktopNav({ active, onChange, unread = {}, tabs = TABS, onProfile, profileAv, profileName }) {
  return (
    <div style={{
      width: 240, flexShrink: 0, height: '100%', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', padding: '20px 14px',
      background: 'var(--surface)', borderRight: '1px solid var(--line)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 10px 20px' }}>
        <Halo size={26} color="var(--ink)" spark="var(--clay)" />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19, letterSpacing: '-.3px' }}>Trinity<span style={{ color: 'var(--clay)' }}>One</span></span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {tabs.map(t => {
          const on = active === t.id;
          return (
            <button key={t.id} onClick={() => onChange(t.id)} style={{
              display: 'flex', alignItems: 'center', gap: 13, padding: '11px 13px', borderRadius: 13,
              border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: on ? 700 : 600,
              background: on ? 'color-mix(in oklab, var(--clay) 12%, var(--surface))' : 'transparent',
              color: on ? 'var(--clay)' : 'var(--ink-2)', transition: 'background .15s, color .15s', textAlign: 'left',
            }}>
              <Icon name={t.icon} size={21} stroke={on ? 2.1 : 1.8} color={on ? 'var(--clay)' : 'var(--ink-3)'} /> {t.label}
              {unread[t.id] && !on ? <span style={{ marginLeft: 'auto', width: 8, height: 8, borderRadius: 999, background: 'var(--clay)' }} /> : null}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1 }} />
      {/* You & settings — same hub as mobile; hidden while PIN-locked */}
      {onProfile ? (
        <button onClick={onProfile} title="You & settings" style={{
          display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 13, marginBottom: 4,
          border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--ink-2)',
          fontFamily: 'var(--font-ui)', fontSize: 14.5, fontWeight: 700, textAlign: 'left',
        }}>
          <UserAvatar av={profileAv} name={profileName} size={26} /> You &amp; settings
        </button>
      ) : null}
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink-3)', padding: '10px 13px' }}>Read · Gather · Share</div>
    </div>
  );
}
window.DesktopNav = DesktopNav;

// ── Bible / Plans segmented toggle (the Read tab holds both views) ──
function ReadPlansTabs({ ctx, style = {} }) {
  const v = ctx.readView || 'bible';
  return (
    <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)', ...style }}>
      {[['bible', 'Bible', 'read'], ['plans', 'Plans', 'plans']].map(([id, label, ic]) => {
        const on = v === id;
        return (
          <button key={id} onClick={() => ctx.setReadView(id)} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px',
            borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5,
            background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--clay)' : 'var(--ink-2)',
            boxShadow: on ? 'var(--shadow-sm)' : 'none', transition: 'all .2s',
          }}><Icon name={ic} size={16} stroke={on ? 2.1 : 1.8} />{label}</button>
        );
      })}
    </div>
  );
}
window.ReadPlansTabs = ReadPlansTabs;

// ── Bottom sheet ──
// ── global back-stack ──
// Every open BottomSheet / Overlay registers its close handler here, so the Android hardware back
// button (wired in app.jsx) dismisses the topmost layer instead of exiting the app.
const _backStack = (window.__trinityBackStack = window.__trinityBackStack || []);
function useBackLayer(open, onClose) {
  const ref = useUR(onClose);
  ref.current = onClose;
  useUE(() => {
    if (!open) return;
    const entry = { close: () => { try { ref.current && ref.current(); } catch (e) {} } };
    _backStack.push(entry);
    return () => { const i = _backStack.indexOf(entry); if (i >= 0) _backStack.splice(i, 1); };
  }, [open]);
}
// returns true if it closed a layer; app.jsx falls back to tab nav / exit when it returns false
window.trinityGoBack = function () {
  if (_backStack.length) { _backStack[_backStack.length - 1].close(); return true; }
  return false;
};
// a11y: keyboard Escape closes the topmost open layer — the desktop/keyboard equivalent of the hardware
// back button. Delegates to window.trinityGoBack() (app.jsx overrides it with its own overlay-state list;
// ui.jsx's version reads _backStack) — whichever is live closes the topmost modal and returns true. Only
// swallow the key when something actually closed. Registered once (ui.jsx loads once).
if (typeof document !== 'undefined' && !window.__t1EscWired) {
  window.__t1EscWired = true;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && window.trinityGoBack && window.trinityGoBack()) e.preventDefault();
  });
}
// a11y: dialog focus management for a modal panel. On open, remember what had focus and move focus onto the
// panel container (NOT its first input — auto-focusing an input would pop the mobile soft-keyboard on every
// sheet open, a regression for this touch-first audience); trap Tab within the panel; on close, restore focus
// to where it was. panelRef points at the panel element (which must carry tabIndex={-1}).
// `onClose` is optional so existing callers keep working; when given, Escape closes the dialog. The console's
// useStewDialog has always done this and the member app's twin never did — so a keyboard user could open a
// sheet and have no way out without a pointer.
// ACCESSIBLE NAME for a dialog. Every BottomSheet/Overlay supports a `label`, and not one of the 59 call
// sites passes it — so with a screen reader they all announce as a bare "dialog". Rather than hand-label 59
// sites (and watch them drift as copy changes), derive the name from the sheet's own first line of text when
// no explicit label is given. An explicit label always wins.
function useAutoDialogLabel(active, panelRef, label) {
  const [auto, setAuto] = useU('');
  useUE(() => {
    if (!active || label) return;
    const t = setTimeout(() => {
      const p = panelRef.current; if (!p) return;
      const line = (p.innerText || '').split('\n').map(x => x.trim()).filter(Boolean)[0] || '';
      if (line) setAuto(line.slice(0, 60));
    }, 80);   // after the panel has rendered its content
    return () => clearTimeout(t);
  }, [active, label]);
  return label || auto || undefined;
}
function useDialogA11y(active, panelRef, onClose) {
  const prevFocus = useUR(null);
  useUE(() => {
    if (!active) return;
    prevFocus.current = (typeof document !== 'undefined') ? document.activeElement : null;
    // move focus onto the panel — but NOT if the modal already moved focus inside itself (e.g. a search/compose
    // sheet that deliberately autofocuses its input); stealing that would drop the caret + hide the keyboard.
    const t = setTimeout(() => { const p = panelRef.current; if (p && !p.contains(document.activeElement)) { try { p.focus(); } catch (e) {} } }, 60);
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const p = panelRef.current; if (!p) return;
      const nodes = p.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
      if (!nodes.length) { e.preventDefault(); p.focus(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || a === p)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    };
    const p = panelRef.current; if (p) p.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); if (p) p.removeEventListener('keydown', onKey); const pf = prevFocus.current; if (pf && pf.focus) { try { pf.focus(); } catch (e) {} } };
  }, [active]);
}

function BottomSheet({ open, onClose, children, maxHeight = '78%', pad = true, z = 50, docked, passthrough, label }) {
  // docked = rendered inside a desktop side panel (e.g. reader study panel): fill the pane, no
  // backdrop/slide/handle, no backstack.
  useBackLayer(open && !docked, onClose);
  const [mounted, setMounted] = useU(open);
  const panelRef = useUR(null);
  useUE(() => { if (open) setMounted(true); }, [open]);
  // a11y: a passthrough sheet leaves the page behind interactive (e.g. verse-select over the Bible), so it is
  // NOT a modal dialog — don't trap focus or mark aria-modal there. All other sheets are true modals.
  const modal = !docked && !passthrough;
  useDialogA11y(open && modal, panelRef, onClose);
  const _label = useAutoDialogLabel(open && modal, panelRef, label);
  if (!mounted && !open) return null;
  if (docked) {
    return (
      <div className="no-scrollbar" style={{ position: 'absolute', inset: 0, overflow: 'auto', background: 'var(--surface)', padding: pad ? '18px 20px' : 0 }}>
        {children}
      </div>
    );
  }
  return (
    // passthrough = no dimming backdrop + the wrapper ignores pointer events, so the page behind (e.g. the Bible
    // while selecting verses with the +/− card) stays scrollable + tappable. Only the sheet panel is interactive.
    <div style={{ position: 'absolute', inset: 0, zIndex: z, pointerEvents: (open && !passthrough) ? 'auto' : 'none' }}>
      {!passthrough && <div onClick={onClose} style={{
        position: 'absolute', inset: 0, background: 'rgba(20,14,8,.42)',
        opacity: open ? 1 : 0, transition: 'opacity .28s',
      }} />}
      <div ref={panelRef} {...(modal ? { role: 'dialog', 'aria-modal': 'true' } : {})} aria-label={_label} tabIndex={-1} onTransitionEnd={() => { if (!open) setMounted(false); }} style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        maxWidth: 500, marginLeft: 'auto', marginRight: 'auto',   // centered column on a wide screen; full-width on a phone (maxWidth > viewport)
        background: 'var(--surface)', borderRadius: '30px 30px 0 0',
        maxHeight, display: 'flex', flexDirection: 'column',
        boxShadow: '0 -10px 40px rgba(20,14,8,.22)',
        transform: open ? 'translateY(0)' : 'translateY(102%)',
        transition: 'transform .34s cubic-bezier(.32,.72,0,1)',
        paddingBottom: 14, pointerEvents: 'auto', outline: 'none',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '11px 0 4px', flexShrink: 0 }}>
          <div style={{ width: 38, height: 5, borderRadius: 3, background: 'var(--ink-3)', opacity: .4 }} />
        </div>
        <div className="no-scrollbar" style={{ overflow: 'auto', padding: pad ? '4px 20px 8px' : 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Full overlay (slides up, opaque) ──
function Overlay({ open, onClose, children, docked, label }) {
  // docked = rendered inside a desktop pane (e.g. two-pane chat): fill the pane, no slide/backstack.
  useBackLayer(open && !docked, onClose);
  const [mounted, setMounted] = useU(open);
  const panelRef = useUR(null);
  useUE(() => { if (open) setMounted(true); }, [open]);
  useDialogA11y(open && !docked, panelRef, onClose);   // a11y: focus-trap + return-focus + Escape (a docked overlay is an inline pane, not a modal)
  const _label = useAutoDialogLabel(open && !docked, panelRef, label);
  if (!mounted && !open) return null;
  if (docked) {
    return (
      <div style={{ position: 'absolute', inset: 0, background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    );
  }
  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label={_label} tabIndex={-1} onTransitionEnd={() => { if (!open) setMounted(false); }} style={{
      position: 'absolute', inset: 0, zIndex: 55, background: 'var(--paper)',
      transform: open ? 'translateY(0)' : 'translateY(100%)',
      transition: 'transform .4s cubic-bezier(.32,.72,0,1)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', outline: 'none',
    }}>
      {/* desktop: centre the content at a readable width instead of stretching full-width (no-op on mobile) */}
      <div style={{ width: '100%', maxWidth: 860, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}

// ── Small bits ──
// A sensible accessible name per icon, so an icon-only button is never announced as just "button". 56 of 58
// call sites pass no title — these are the close/back controls of nearly every full-screen surface, so with a
// screen reader Giving announced as "dialog … button … button". An explicit title still wins.
const ICON_LABELS = {
  chevL: 'Back', chevR: 'Forward', chevU: 'Collapse', chevD: 'Expand', x: 'Close', plus: 'Add',
  share: 'Share', trash: 'Delete', pen: 'Edit', check: 'Confirm', search: 'Search', bell: 'Notifications',
  qr: 'Show QR code', link: 'Copy link', chat: 'Message', send: 'Send', settings: 'Settings', user: 'Profile',
  refresh: 'Refresh', download: 'Download', play: 'Play', pause: 'Pause', heart: 'Care', calendar: 'Calendar',
};
function IconBtn({ name, onClick, size = 20, badge, style = {}, stroke = 1.9, title, ...rest }) {
  const _name = title || ICON_LABELS[name] || undefined;
  return (
    <button onClick={onClick} title={title} aria-label={_name} {...rest} style={{
      width: 40, height: 40, borderRadius: 14, border: '1px solid var(--line)',
      background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
      boxShadow: 'var(--shadow)', flexShrink: 0, ...style,
    }}>
      <Icon name={name} size={size} stroke={stroke} />
      {badge ? <span style={{
        position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, padding: '0 4px',
        borderRadius: 8, background: 'var(--clay)', color: 'var(--on-clay)', fontSize: 10, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{badge}</span> : null}
    </button>
  );
}

function Chip({ children, active, onClick, accent = 'var(--clay)' }) {
  return (
    <button onClick={onClick} style={{
      border: active ? `1.5px solid ${accent}` : '1px solid var(--line)',
      background: active ? 'color-mix(in oklab, ' + accent + ' 12%, var(--surface))' : 'var(--surface)',
      color: active ? accent : 'var(--ink-2)', cursor: 'pointer',
      padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600,
      fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap', flexShrink: 0,
      transition: 'all .18s',
    }}>{children}</button>
  );
}

function SectionLabel({ children, action, onAction }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 0 12px' }}>
      <h2 style={{
        margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700,
        fontSize: 19, color: 'var(--ink)', letterSpacing: '-.2px',
      }}>{children}</h2>
      {action ? <button onClick={onAction} style={{
        border: 'none', background: 'none', color: 'var(--clay)', fontWeight: 600,
        fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)',
      }}>{action}</button> : null}
    </div>
  );
}

// ── Toast ──
function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      position: 'absolute', bottom: 92, left: 16, right: 16, marginInline: 'auto', width: 'fit-content', maxWidth: 'calc(100% - 32px)',
      zIndex: 60, background: 'var(--ink)', color: 'var(--paper)',
      padding: '11px 18px', borderRadius: 14, fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, textAlign: 'center',
      fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow-lg)',
      animation: 'trinityScale .3s ease both', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    }}>
      <Icon name="check" size={16} stroke={2.4} color="var(--clay)" style={{ flexShrink: 0 }} /><span>{msg}</span>
    </div>
  );
}

Object.assign(window, { cx, makeNameDisambiguator, PhoneFrame, TabBar, BottomSheet, Overlay, IconBtn, Chip, SectionLabel, Toast });
