// ONE SET OF REPLY PIECES for every chat surface that lets you answer a message.
//
// Why this file exists: swipe-to-reply was written out five times (group Row, member DMSwipe, console
// StewDmWindow and the two care chats), and the copies drifted — the console one had no visual cue and no
// touch-action, so a swipe was invisible and the scroller could steal it. The "Replying to" bar and the quoted
// line above a reply had drifted the same way. Everything here is shared so that cannot happen again.
//
// ONE GLOBAL NAME: `TrinityReplyKit` (classic scripts share a global scope — a second top-level name that
// collided with another file's would blank the app). Loaded by index.html (before screens-chat.jsx) and
// steward.html (before stew-dashboard.jsx). NOT named stew-*: sync-web.sh strips stew-* from the member build.
//
// ⚠ bar() / quote() / cue() are plain functions that RETURN elements, called as `{TrinityReplyKit.bar({...})}`,
// not `<Bar/>` components. That is on purpose: the tests render the screens through a mini React that does not
// expand function elements, and a component here would hide the reply bar from every one of them.
//
// Users (CLAUDE.md rule 2): Row (group rooms, app/screens-chat.jsx) · DMSwipe + DMThread (member DM, same file)
// · ChatRoom's reply bar (same file) · StewDmWindow (console DM, app/stew-dashboard.jsx). · CareChatSheet (app/screens-today.jsx) · StewCareChat (app/stew-meals.jsx).
// The console GROUP chat is deliberately NOT an adopter yet.
var TrinityReplyKit = (function () {
  var ARM = 48;   // how far to drag before letting go replies
  var MAX = 76;   // and how far the row will move at all

  // The touch handlers. `st` is a ref ({current}), `setDx` redraws, `onReply` answers. The LIVE offset is
  // st.current.dx — never React state: the last touchmove of a flick and the touchend after it reach these
  // handlers with no render between them, so state read in onTouchEnd is stale (the bug a-direct-message-can-
  // be-answered.test.mjs pins). For the same reason every reset calls setDx(0) unconditionally rather than
  // `if (dx) setDx(0)`: `dx` there is the last COMPLETED render's, and testing it left the arrow on screen.
  //   opts.enabled   false -> the row never arms (default true)
  //   opts.onStart / onMove / onEnd   hooks for extras (Row's press-and-hold share timer)
  function handlers(st, setDx, onReply, opts) {
    opts = opts || {};
    var enabled = opts.enabled !== false;
    var finish = function (e) {
      if (opts.onEnd) opts.onEnd();
      var s0 = st.current;
      var far = s0 && s0.dx || 0;
      // A lift with no touchmove seen (some webviews coalesce) still counts if it ended far enough right.
      var t = e && e.changedTouches && e.changedTouches[0];
      if (s0 && s0.on && t) {
        var ddx = t.clientX - s0.x, ddy = t.clientY - s0.y;
        if (Math.abs(ddy) <= Math.abs(ddx)) far = Math.max(far, Math.min(MAX, ddx));
      }
      // A CANCEL PAST THE THRESHOLD STILL REPLIES, deliberately: touchcancel is how Android ends a horizontal
      // drag inside a scrolling list, and once the arrow has filled in the app has promised "let go and you
      // reply". Below the threshold nothing was promised, so a cancel just springs back.
      var fire = enabled && !!onReply && far >= ARM;
      st.current = { x: 0, y: 0, on: false, dx: 0 };
      setDx(0);
      if (fire) { try { onReply(); } catch (err) {} }
    };
    return {
      onTouchStart: function (e) {
        if (opts.onStart) opts.onStart();
        var t = e && e.touches && e.touches[0];
        st.current = t ? { x: t.clientX, y: t.clientY, on: true, dx: 0 } : { x: 0, y: 0, on: false, dx: 0 };
        setDx(0);
      },
      onTouchMove: function (e) {
        if (opts.onMove) opts.onMove();
        var t = e && e.touches && e.touches[0], s0 = st.current;
        if (!t || !s0 || !s0.on || !enabled) return;
        var ddx = t.clientX - s0.x, ddy = t.clientY - s0.y;
        if (Math.abs(ddy) > Math.abs(ddx)) { s0.on = false; s0.dx = 0; setDx(0); return; }   // a scroll, not a swipe
        s0.dx = Math.max(0, Math.min(MAX, ddx));
        setDx(s0.dx);
      },
      onTouchEnd: function (e) { finish(e); },
      onTouchCancel: function () { finish(); },
    };
  }

  // What the swipe wrapper puts on the row: touch-action: pan-y lets the list keep scrolling and tells the
  // compositor NOT to treat a horizontal drag as a pan it owns (React's touch listeners are passive, so
  // preventDefault() cannot do this job — the CSS has to). Spread it into the row's style.
  function style(dx) {
    return { touchAction: 'pan-y', transform: dx ? ('translateX(' + dx + 'px)') : '', transition: dx ? '' : 'transform .18s ease' };
  }

  // The arrow that appears from under the row as it moves, and fills in once far enough to let go.
  //
  // WHERE IT SITS (owner 2026-10-15): the cue is a child of the row, so it rides along with the row's slide.
  // At `left: -34` it is 8px left of the row's own left edge, and a received (left-aligned) group message sits
  // flush against the ~16px gutter — so for the first ~18px of the drag the arrow was half off the SCREEN, and
  // it faded in from opacity 0 at the same time, which read as "a tiny dot clipped by the edge". The fix is
  // to hold the cue still at CUE_INSET px inside the row's ORIGINAL left edge until the row has moved far
  // enough to trail it (dx >= 34 + CUE_INSET), then let it trail at -34 exactly as before. So the arrow's
  // position measured from where the row started is never left of CUE_INSET, and from dx 38 on it is
  // unchanged for every surface. Users of cue(): Row (group) and DMSwipe (member DM) via useSwipe; called
  // directly by CareChatSheet (screens-today), StewCareChat (stew-meals), GroupChatModal and StewDmWindow
  // (stew-dashboard).
  var CUE_INSET = 4;
  function cueLeft(dx) { return Math.max(-34, CUE_INSET - dx); }
  function cue(dx) {
    if (!dx) return null;
    return (
      <div aria-hidden="true" data-reply-cue="1" style={{ position: 'absolute', left: cueLeft(dx), top: '50%', transform: 'translateY(-50%)', opacity: Math.min(1, dx / ARM),
        width: 26, height: 26, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: dx >= ARM ? 'var(--clay)' : 'var(--surface-2)', border: '1px solid var(--line)' }}>
        <Icon name="reply" size={14} color={dx >= ARM ? 'var(--on-clay)' : 'var(--ink-3)'} />
      </div>
    );
  }

  // CLOSE AN OPEN POP-OVER WHEN THE FINGER LANDS OUTSIDE IT (owner 2026-10-15). The ⋯ moderation menu in the
  // console group chat already did this inline; the reactions picker did it nowhere and the member + console
  // DM windows did it nowhere, so a picker or a menu, once open, stayed open until you tapped it again — on a
  // phone there is no "click elsewhere" the way a mouse has.
  //
  // This is the ONE thing worth sharing: the rule for what counts as a press "off" the pop-over. It is a PURE
  // function (no React), because the kit is a classic-script global and, in the console's unit rig, is built
  // with a hook-free stub React — a hook here would crash every console test that renders these screens. Each
  // screen keeps its own three-line effect (its React, its `document`), registered while the pop-over is open:
  //
  //   useCE(() => {
  //     if (!openKey) return undefined;
  //     const off = TrinityReplyKit.tapOffHandler('[data-...]', () => setOpen(''));
  //     document.addEventListener('pointerdown', off, true);
  //     return () => document.removeEventListener('pointerdown', off, true);
  //   }, [openKey]);
  //
  //   selector  what counts as INSIDE: a pointerdown whose target .closest(selector) is non-null is ignored,
  //             so the trigger and the pop-over itself carry it (the bubble that toggles the picker, the ⋯
  //             wrapper that holds the menu). Everything else closes it.
  //   close     what to call for a press outside — setRxFor(''), setMenuFor(null), …
  // pointerdown + capture (set by the caller): a touch and a mouse behave alike and a child's own handler
  // cannot swallow it, the same shape the original inline ⋯-menu effect used.
  function tapOffHandler(selector, close) {
    return function (e) {
      var t = e && e.target;
      if (t && typeof t.closest === 'function' && t.closest(selector)) return;
      close();
    };
  }

  // The hook for a row that owns its own state (Row, DMSwipe).
  function useSwipe(onReply, opts) {
    var st = React.useRef({ x: 0, y: 0, on: false, dx: 0 });
    var d = React.useState(0), dx = d[0], setDx = d[1];
    return { dx: dx, handlers: handlers(st, setDx, onReply, opts), style: style(dx), cue: cue(dx) };
  }

  // The line above a reply that says what it answers.
  //   variant 'card' : a group room's bordered card (who + words)        — Row
  //   variant 'line' : a private chat's small italic line (words only)   — DMThread, StewDmWindow
  //   missing        : the original isn't loaded / was hidden; say so without leaking any content
  function quote(o) {
    if (o.variant === 'card') {
      if (o.missing) {
        return (
          <div style={{ maxWidth: 260, marginBottom: 4, padding: '5px 10px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)', borderLeft: '2.5px solid var(--line)', fontSize: 12, lineHeight: 1.3, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Icon name="reply" size={12} color="var(--ink-3)" /><span style={{ fontStyle: 'italic' }}>replying to an earlier message</span>
          </div>
        );
      }
      return (
        <div style={{ maxWidth: 260, marginBottom: 4, padding: '5px 10px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)', borderLeft: '2.5px solid var(--clay)', fontSize: 12, lineHeight: 1.3 }}>
          <div style={{ fontWeight: 700, color: 'var(--ink-3)' }}>{o.who}</div>
          <div style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{o.text}</div>
        </div>
      );
    }
    if (o.missing) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: o.size, color: 'var(--ink-3)', margin: '0 4px 3px' }}>
          <Icon name="reply" size={11} color="var(--ink-3)" /><span style={{ fontStyle: 'italic' }}>replying to an earlier message</span>
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: o.size, color: 'var(--ink-3)', margin: '0 4px 3px', maxWidth: o.maxWidth }}>
        <Icon name="reply" size={11} color="var(--ink-3)" />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }}>{o.text}</span>
      </div>
    );
  }

  // The bar above the composer while a reply is being written.
  //   variant 'card'    : group room (clay edge, "Cancel reply")
  //   variant 'dm'      : member private chat
  //   variant 'console' : the docked console chat (smaller; cancel carries both a title and an aria-label)
  function bar(o) {
    if (o.variant === 'card') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', marginBottom: 8, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', borderLeft: '2.5px solid var(--clay)' }}>
          <Icon name="reply" size={15} color="var(--clay)" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.3 }}>
            <div style={{ fontWeight: 700, color: 'var(--ink-2)' }}>Replying to {o.who}</div>
            <div style={{ color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.text}</div>
          </div>
          <button onClick={o.onCancel} title="Cancel reply" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0, padding: 2 }}><Icon name="x" size={16} /></button>
        </div>
      );
    }
    if (o.variant === 'console') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 11px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)', flexShrink: 0 }}>
          <Icon name="reply" size={13} color="var(--ink-3)" />
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--ink-2)' }}>
            <div style={{ fontWeight: 700, fontSize: 10.5, color: 'var(--ink-3)' }}>Replying to {o.who}</div>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }}>{o.text}</div>
          </div>
          <button onClick={o.onCancel} aria-label="Stop replying" title="Stop replying" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 2, flexShrink: 0 }}><Icon name="x" size={14} /></button>
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 14px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)' }}>
        <Icon name="reply" size={14} color="var(--ink-3)" />
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--ink-3)' }}>Replying to {o.who}</div>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }}>{o.text}</div>
        </div>
        <button onClick={o.onCancel} aria-label="Stop replying" style={{ border: 'none', background: 'var(--surface)', borderRadius: 999, width: 26, height: 26, cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="x" size={14} /></button>
      </div>
    );
  }

  return { ARM: ARM, MAX: MAX, CUE_INSET: CUE_INSET, handlers: handlers, style: style, cue: cue, useSwipe: useSwipe, tapOffHandler: tapOffHandler, quote: quote, bar: bar };
})();
