// stew-tour.jsx — the first-run walkthrough for the STEWARD CONSOLE (steward.html).
//
// Three things, all in one host component (StewTourHost) that StewDashboard mounts once, in both layouts:
//   1. A tour in two parts (2026-11-22). Part 1 walks the Overview page card by card; Part 2 steps down every
//      section in the side menu, one step each. Each step is a small bubble pointing at one real element, with
//      Next / Back / Skip tour, a step counter, and a cutout round the target. Step 1 is centred with no pointer.
//   2. A section tip: the FIRST time each section opens, one bubble with "Got it". No Manna tip.
//   3. A locked-section tip, shown once, the first time a helper opens a section stewNav() marked `locked`.
//
// WHEN THE TOUR STARTS (owner decisions, 2026-11-18). Automatically only on two transitions, both of which
// happen once: the owner finishing the setup wizard (StewDashboard → finishWizard) and a helper closing their
// welcome screen (StewDashboard → closeBrief). Each calls window.stewTourStart(). An established church that
// passed the wizard on an earlier version never goes through either, so it is never ambushed. Help →
// "Take the tour again" (app/stew-help.jsx) replays it any time.
//
// WHAT IT NEVER DOES. It never points at a missing element: a step whose anchor is not in the DOM is skipped,
// and the plan already drops sections the church switched off (stewNav filters church.features) and sections a
// helper cannot use (locked). It never shows while another console dialog, the error banner or a join toast is
// up — it waits. It writes nothing to a relay: "seen" is per device, in localStorage, per church.
//
// The anchors are `data-tour="…"` attributes in app/stew-dashboard.jsx (identity, nav-<key>, menu, main, and on
// the Overview needs, verse, joincode, activity) and app/stew-help.jsx (help). On the phone the nav lives behind
// ☰, so a step that points at a nav item points at the menu button instead and its title says "· in the menu".
// The tour does not open the menu (owner, 2026-11-22: the lighter phone path).
//
// The file MUST be named stew-*.jsx: scripts/sync-web.sh strips app/stew-*.js out of the member web build, and
// scripts/build-steward-apk.sh derives the steward APK's file list from steward.html.
//
// THE BUBBLE ITSELF LIVES IN app/tour-kit.jsx (2026-11-18), shared with the member app's tour: finding an anchor,
// placing the bubble, drawing the ring and the dim. What stays here is everything that is the console's own — the
// steps and tips, who sees which, when it starts, and what counts as "another console dialog is open".
//
// Globals this file takes from elsewhere (loaded before it in steward.html): React, useStewDialog
// (stew-modal.jsx), window.stewModalOpen and window.stewModalCount (stew-modal.jsx), window.Steward, and from tour-kit.jsx tourKitFind,
// tourKitWalk, tourKitReducedMotion, tourKitFlag, tourKitFlagSet, TourKitBubble (which uses tourKitPlace).
// Top-level names DECLARED here — unique across the console's single global scope on purpose (a duplicate
// top-level name in classic scripts blanks the whole app): STEW_TOUR_STEPS, STEW_TOUR_NAV, STEW_TOUR_TIPS, STEW_TOUR_LOCKED,
// stewTourStore, stewTourChurch, stewTourKey, stewTourSeen, stewTourSeenSet, stewTourMarkTipsSeen, stewTourStart, stewTourPlan,
// stewTourSectionTip, stewTourBlocked, stewTourMainTop, stewTourLater, STEW_TOUR_TIP_ROOM, StewTourBubble, StewTourTip, StewTourHost.

// ── the words (approved by the owner, 2026-11-22 — CONSOLE-WALKTHROUGH-DETAIL-COPY-2026-11-22.html) ─────────
// PART 1: the Overview page. `targets` names the anchors a step points at; a step with none is centred. `card`
// marks a step that points at a card ON the Overview page: the host opens Overview before the tour starts so the
// card is there, and a card that is not drawn (nobody waiting to join; no verse prompt out) is skipped like any
// other missing anchor. `ownerOnly` drops the step for a helper: a helper cannot rename the church. A helper is
// the `delegate` StewDashboard passes — its `actingChurch`.
// The Overview's "Groups & rooms" card is NOT a step (owner, 2026-11-22): Groups is covered once, in Part 2.
const STEW_TOUR_STEPS = [
  { id: 'welcome', title: 'Welcome', text: 'Your church is ready. Here’s a proper look around — a couple of minutes, and you can stop any time.' },
  { id: 'identity', title: 'Your church’s name', targets: ['identity'], ownerOnly: true,
    text: 'This is your church. Tap the name to change it. If you also help run a network or another church, switch to it from here.' },
  { id: 'needs', title: 'What needs you', targets: ['needs'], card: true,
    text: 'Anything waiting on you shows here first — new people asking to join, and clearances coming up for renewal. Clear this and you’re up to date.' },
  { id: 'verse', title: 'Verse prompt', targets: ['verse'], card: true,
    text: 'A verse goes out to everyone’s phone each day. This shows what’s scheduled — change it under Resources.' },
  { id: 'invite', title: 'Joining code', targets: ['joincode'], card: true,
    text: 'This is how people join. Share the code or QR: they scan it or type it into the TrinityOne app.' },
  { id: 'activity', title: 'Recent activity', targets: ['activity'], card: true,
    text: 'A running list of what’s happened lately — who joined, what was posted, what changed across the church.' },
];
// PART 2: one step per section in the side menu, keyed by the section's nav key. The step's title is the
// section's own label from the nav unless `title` is given. `helperText` (here and in STEW_TOUR_TIPS) is what a
// helper is told instead: the owner's words name things only the church key can do (owner, 2026-11-19). `also`
// names a second anchor to ring. Manna has no entry on purpose (it is not built yet), so it gets no step.
const STEW_TOUR_NAV = {
  overview: { text: 'The page you just saw. Start here each time you open the console.' },
  members: { text: 'Everyone who has joined. Mark who is a child, and which adults are cleared to work with them. The safety rules then apply on their own.',
    // A helper cannot mark children or cleared adults: the relay takes those lists only from the church key
    // (scripts/gateway.mjs, owner-only). So a helper is told only the first, true, sentence.
    helperText: 'Everyone who has joined.' },
  groups: { text: 'Chat rooms and announcement channels. Choose which are open, invite-only, or safe for children.' },
  rota: { text: 'Build serving teams, then fill the dates. People get a “Can you serve?” request and answer from their phone.' },
  calendar: { text: 'Services, events and socials. Members see them in their app and can say they’re coming.' },
  rooms: { text: 'The rooms in your building. Add them, then book one when you add an event.' },
  resources: { text: 'Reading plans, devotionals, sermons, and the verse prompt your members see.' },
  meals: { text: 'Meal trains, lifts and errands. Set up a need, and members sign up to help.' },
  checkin: { text: 'The children’s register. Sign children in and out at the door, and see who’s in the room.' },
  finance: { text: 'Record giving and spending, import a bank statement, and share a summary with the church.' },
  settings: { title: 'Settings & Help', also: ['help'],
    text: 'Switch sections on or off, back up the church, and choose where its data lives. Stuck? Help is here, and so is this tour.',
    helperText: 'Stuck? Help is here, and so is this tour.' },
};
// One per section. Manna has none on purpose (owner, 2026-11-18: it is not built yet).
const STEW_TOUR_TIPS = {
  overview: { title: 'Overview', text: 'What needs you today, and recent activity across the church.' },
  groups: { title: 'Groups', text: 'Add a group with New group. Open one to change who’s in it, who leads it, and whether children can join.' },
  rota: { title: 'Rota', text: 'Build serving teams, then fill the dates. People get a “Can you serve?” request and answer from their phone.' },
  calendar: { title: 'Calendar', text: 'Services, events and socials. Members see them in their app and can say they’re coming.' },
  rooms: { title: 'Rooms', text: 'Add the rooms in your building, then book them when you add an event.' },
  resources: { title: 'Resources', text: 'Reading plans, devotionals, sermons and the verse prompt your members see.' },
  // helperText: a helper with `members` can approve (the relay's admitted:/joinpolicy: gate is stewardCan
  // 'members'), but the children and cleared-adults lists are OWNER-ONLY at the relay (gateway.mjs accept(),
  // minors:/approved:), so "mark children and cleared adults" is not something a helper can do — not said.
  members: { title: 'Members', text: 'Approve new people, mark children and cleared adults, and add helpers to share the work.',
    helperText: 'Approve new people.' },
  finance: { title: 'Finance', text: 'Record giving and spending, import a bank statement, and share a summary with the church.' },
  checkin: { title: 'Check-in', text: 'The children’s register. Sign children in and out at the door, and see who’s in the room.' },
  meals: { title: 'Care', text: 'Meal trains, lifts and errands. Set up a need, and members sign up to help.' },
  settings: { title: 'Settings', text: 'Your church’s name, which sections are switched on, where its data lives, and backup.',
    helperText: 'Some settings here belong to whoever holds the church key.' },
};
const STEW_TOUR_LOCKED = 'This part hasn’t been given to you. Nothing’s wrong. Ask whoever holds the church key if you need it.';

// ── seen-state: per device, per church, per thing ───────────────────────────────────────────────────────────
// A request to start is held here until the host can show it (a dialog may still be closing).
// up: the tour bubble is mounted, and so is counted in stew-modal.jsx's count (StewTourBubble sets it).
const stewTourStore = { pending: null, up: false };
// The church being looked at: a helper's own key is Steward.pubkey, the church they act for is actingChurch.
function stewTourChurch() {
  try { const S = window.Steward || {}; return String(S.actingChurch || S.pubkey || S.churchPub || ''); } catch (e) { return ''; }
}
function stewTourKey(church, what) { return 'trinityone.steward.tour.' + (church || 'none') + '.' + what; }
function stewTourSeen(church, what) { return tourKitFlag(stewTourKey(church, what)); }
function stewTourSeenSet(church, what) { tourKitFlagSet(stewTourKey(church, what)); }
// The tour has just covered every section, so none of them needs its own first-open tip (owner, 2026-11-22):
// spend the tip of every section in `nav` (stewNav's output), and the locked-section tip. Called when the tour is
// FINISHED, never when it is skipped. A section the church switches on later is not in `nav` now, so it keeps its tip.
// A LOCKED section keeps its tip too (audit L4, 2026-11-22): it got no tour step, so a helper later given it still sees the tip once.
function stewTourMarkTipsSeen(church, nav) {
  for (const n of (Array.isArray(nav) ? nav : [])) { if (n && n.key && !n.locked) stewTourSeenSet(church, 'tip.' + n.key); }
  stewTourSeenSet(church, 'locked');
}

// Ask for the tour. 'wizard' and 'brief' are the two automatic starts and happen at most once per church on
// this device; 'replay' (Help) always starts it. Returns whether a start was queued.
// An automatic start is also RECORDED (`pending`, per church): one asked for and never shown — the page left before
// it could start — is picked up the next time the console opens (the host's resume). opts (audit L2):
//   keepTab: start where the steward is, without opening Overview (the wizard's "Relays & settings" exit);
//   defer:   only record it — the page is about to be left (the wizard's "Back to the Suite" exit).
function stewTourStart(reason, opts) {
  const why = reason || 'replay';
  const o = opts || {};
  const church = stewTourChurch();
  if (why !== 'replay' && stewTourSeen(church, 'tour')) return false;
  if (why !== 'replay') stewTourSeenSet(church, 'pending');
  if (o.defer) return true;
  stewTourStore.pending = { reason: why, keepTab: !!o.keepTab };
  try { window.dispatchEvent(new Event('stew-tour')); } catch (e) {}
  return true;
}

// ── pure logic (scripts/console-walkthrough.test.mjs RUNS these) ────────────────────────────────────────────
// Which steps apply, given the church's nav (stewNav's output: switched-off sections already gone, a helper's
// out-of-scope sections `locked`), the layout, and who is looking. Each returned step carries `targets`: the
// data-tour anchors to highlight, the first being the one it must have (a step with none is centred); `card` is
// true for a step that points at a card on the Overview page.
// Part 1 is STEW_TOUR_STEPS. Part 2 is one step per entry of `nav`, in its order: a locked section is left out (a
// helper is not walked through a section they cannot use), and so is one with no words in STEW_TOUR_NAV (Manna).
function stewTourPlan(nav, opts) {
  const o = opts || {};
  const list = Array.isArray(nav) ? nav : [];
  const at = (k) => o.narrow ? 'menu' : 'nav-' + k;
  const out = [];
  for (const s of STEW_TOUR_STEPS) {
    if (s.ownerOnly && o.delegate) continue;
    out.push({ id: s.id, title: s.title, text: (o.delegate && s.helperText) || s.text, targets: (s.targets || []).slice(), card: !!s.card });
  }
  for (const n of list) {
    const w = n && STEW_TOUR_NAV[n.key];
    if (!w || n.locked) continue;
    const targets = [at(n.key)];
    for (const a of (w.also || [])) {
      const t = a === 'help' ? (o.narrow ? 'menu' : 'help') : a;
      if (targets.indexOf(t) < 0) targets.push(t);
    }
    const title = w.title || n.label || n.key;
    out.push({ id: 'nav.' + n.key, title: o.narrow ? title + ' · in the menu' : title, text: (o.delegate && w.helperText) || w.text, targets, card: false });
  }
  return out;
}
// The tip for a section, or null. `seen(what)` answers from storage. A locked section gets the locked tip
// (helpers only, once); an unlocked one gets its own tip once; Manna and anything unknown get nothing.
function stewTourSectionTip(section, opts) {
  const o = opts || {};
  const seen = typeof o.seen === 'function' ? o.seen : () => false;
  if (section === 'manna') return null;
  if (o.locked) {
    if (!o.delegate || seen('locked')) return null;
    const t = STEW_TOUR_TIPS[section];
    return { kind: 'locked', key: 'locked', title: t ? t.title : 'Locked', text: STEW_TOUR_LOCKED };
  }
  const t = STEW_TOUR_TIPS[section];
  if (!t || seen('tip.' + section)) return null;
  return { kind: 'section', key: 'tip.' + section, title: t.title, text: (o.delegate && t.helperText) || t.text };
}
// ── the DOM ─────────────────────────────────────────────────────────────────────────────────────────────────
// Is something else in front of the console? Every console dialog registers in stew-modal.jsx's count; the
// error banner and the join toast carry data-stew-overlay; an aria-modal dialog that skipped the count is
// caught by the last selector. The tour's own bubble is excluded — from the count too: while it is up it is
// one of the dialogs counted (useStewDialog), so only a count beyond it means something else opened over it.
function stewTourBlocked() {
  const own = stewTourStore.up ? 1 : 0;
  try {
    if (typeof window.stewModalCount === 'function') { if (window.stewModalCount() > own) return true; }
    else if (!own && typeof window.stewModalOpen === 'function' && window.stewModalOpen()) return true;
  } catch (e) {}
  try { return !!document.querySelector('[data-stew-overlay], [role="dialog"][aria-modal="true"]:not([data-stew-tour])'); } catch (e) { return false; }
}

// ── the tour bubble ─────────────────────────────────────────────────────────────────────────────────────────
// A console dialog like any other (useStewDialog): Escape and Android Back skip the tour, focus moves into the
// bubble and is trapped there, and it counts as an open dialog so the error banner gets out of its way.
function StewTourBubble(props) {
  const panelRef = useStewDialog(props.onSkip);
  // AFTER useStewDialog's own effect, so on mount it is counted before `up` says so, and on unmount (cleanups run
  // in the same order) it has left the count before `up` clears — the host never subtracts a bubble that is not there.
  React.useEffect(() => { stewTourStore.up = true; return () => { stewTourStore.up = false; }; }, []);
  return <TourKitBubble {...props} panelRef={panelRef} mark="data-stew-tour" />;
}

// How far the console's scroller (<main data-tour="main">, both layouts) is scrolled down; 0 when it is not found.
function stewTourMainTop() {
  try { const el = document.querySelector('main[data-tour="main"]'); return Number(el && el.scrollTop) || 0; } catch (e) { return 0; }
}
// Run fn after the browser's next frame — so after every effect of the frame being drawn, the section's own included.
function stewTourLater(fn) {
  try { if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn); } catch (e) {}
  return setTimeout(fn, 0);
}

// ── the section tip ─────────────────────────────────────────────────────────────────────────────────────────
// Not a dialog: nothing behind it is blocked, it takes no focus, and it is announced politely. Escape (with
// nothing else open) or "Got it" dismisses it.
// IN FLOW, NOT FIXED (2026-11-19). It was a fixed card over the top of <main>, which is exactly where Overview
// puts new sign-ups and Members its Approve buttons — the tip covered them. The host is drawn inside <main>,
// just before the section, so as an ordinary block the tip sits ABOVE the section and pushes it down, and covers
// nothing in it.
// THE ONE EXCEPTION: A SECTION OPENED ALREADY SCROLLED (triage P2, owner-accepted 2026-11-19). <main> keeps its
// scroll across sections, and an in-flow tip at the top of a scrolled <main> is out of sight — worse, inserting it
// above what is in view makes Chromium's scroll anchoring push the view down by the tip's height. So when <main> is
// scrolled at the moment the tip is decided (after the section's own effects: the host decides a frame later),
// the tip FLOATS: the same card in a zero-height sticky holder at the top of what is in view. It adds no height,
// so nothing moves, but it DOES cover the top ~100px of what is in view until "Got it".
// IT NEVER FLOATS OVER THE SECTION'S OWN TOP (stage-4 audit). While <main> is scrolled by less than the room the
// floating card takes (its measured height + its 14px margin + the 8px sticky offset), the section's first cards —
// sign-ups on Overview, Approve on Members — are still in view under where it would sit. So then, and the moment a
// scroll back up comes within that distance (touch momentum often stops a little short of 0), the tip DOCKS: <main>
// is set to its top and the tip drops into the flow, both before the browser paints (a layout effect, re-rendered
// synchronously). Setting 0 first is what keeps the in-flow insert from being scroll-anchored: Chromium does not
// anchor at scrollTop 0. The small move up is the price of never covering Approve; the section's top was in view.
const STEW_TOUR_TIP_ROOM = 160;   // px; the room a floating tip takes, used only when the card cannot be measured
function StewTourTip({ tip, onDone, onDock }) {
  const cardRef = React.useRef(null);
  const reduced = tourKitReducedMotion();
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !(typeof window.stewModalOpen === 'function' && window.stewModalOpen())) onDone(); };
    try { document.addEventListener('keydown', onKey); } catch (e) {}
    return () => { try { document.removeEventListener('keydown', onKey); } catch (e) {} };
  }, [tip.key, tip.title]);   // eslint-disable-line react-hooks/exhaustive-deps
  // The room the floating card takes: its own height, its margin and the sticky offset.
  const room = () => {
    let h = 0;
    try { const r = cardRef.current && cardRef.current.getBoundingClientRect ? cardRef.current.getBoundingClientRect() : null; h = r ? Number(r.height) || 0 : 0; } catch (e) {}
    return h > 0 ? h + 14 + 8 : STEW_TOUR_TIP_ROOM;
  };
  // Dock: <main> to its top FIRST (no scroll anchoring at 0), then the tip into the flow.
  const dock = () => {
    try { const el = document.querySelector('main[data-tour="main"]'); if (el) el.scrollTop = 0; } catch (e) {}
    if (onDock) onDock();
  };
  // Decided as floating, but <main> is scrolled by less than the card's room: dock before the browser paints.
  (React.useLayoutEffect || React.useEffect)(() => {
    if (tip.float && stewTourMainTop() < room()) dock();
  }, [tip.float, tip.key]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Floating: watch <main> and dock once a scroll back up comes within the card's room of the top. The listener
  // goes with the tip.
  React.useEffect(() => {
    if (!tip.float) return undefined;
    let el = null;
    try { el = document.querySelector('main[data-tour="main"]'); } catch (e) {}
    if (!el || !el.addEventListener) return undefined;
    const onScroll = () => { if (stewTourMainTop() < room()) dock(); };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { try { el.removeEventListener('scroll', onScroll); } catch (e) {} };
  }, [tip.float, tip.key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const card = (
    <div ref={cardRef} data-stew-tour="tip" role="status" aria-live="polite" aria-label={'Tip: ' + tip.title}
      style={{ position: 'relative', maxWidth: 520, margin: '0 auto 14px', boxSizing: 'border-box',
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 12px 12px 14px', borderRadius: 14,
        background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', borderLeft: '4px solid var(--clay)',
        boxShadow: '0 12px 34px rgba(0,0,0,.18)', fontFamily: 'var(--font-ui)', animation: reduced ? 'none' : 'lumenFade .2s ease both' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>{tip.title}</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--ink-2)' }}>{tip.text}</div>
      </div>
      <button onClick={onDone} className="sk-btn sk-btn--ghost" style={{ flexShrink: 0, minHeight: 40, padding: '8px 12px', fontSize: 13, fontWeight: 700 }}>Got it</button>
    </div>
  );
  if (!tip.float) return card;
  return <div data-stew-tour-float="1" style={{ position: 'sticky', top: 8, height: 0, zIndex: 5, overflow: 'visible' }}>{card}</div>;
}

// ── the host ────────────────────────────────────────────────────────────────────────────────────────────────
// Mounted once by StewDashboard (inside its shared `content`, so it is in both layouts). `nav` is stewNav()'s
// output, `tab` the open section, `onTab` the dashboard's setTab (the tour opens Overview so the cards its
// Part 1 points at are there). `holdTips`: StewDashboard's own answer to "might the setup wizard still open, or is it
// open?" — section tips wait for it, so a new owner sees the wizard first (audit L1: it ends when the dashboard
// decides, so an abandoned wizard no longer holds the tips for ever).
function StewTourHost({ nav, tab, narrow, delegate, isNetwork, onTab, holdTips }) {
  const [, force] = React.useState(0);
  const [run, setRun] = React.useState(null);   // { i } while the tour is showing
  const [tip, setTip] = React.useState(null);   // the section tip on screen
  const church = stewTourChurch();
  // A section tip is decided a frame after it is wanted (stewTourLater), once the section's own effects have run —
  // one of them may move <main> (DashSettings puts a re-picked Settings back at its top). deciding: the section
  // a decision is waiting for; tabNow: the section open when it comes.
  const deciding = React.useRef(null);
  const tabNow = React.useRef(tab);
  tabNow.current = tab;
  const runNow = React.useRef(false);   // for the late decision: the tour is up, or tips are held, as of the latest draw
  const holdNow = React.useRef(false);
  React.useEffect(() => {
    const f = () => force(x => x + 1);
    try { window.addEventListener('stew-tour', f); window.addEventListener('stew-modals', f); } catch (e) {}
    return () => { try { window.removeEventListener('stew-tour', f); window.removeEventListener('stew-modals', f); } catch (e) {} };
  }, []);
  // RESUME (audit L2): an automatic start recorded for this church and never shown (deferred by the wizard's Suite
  // exit, or the page closed first) is queued on mount and on a church change — here in the render, so the first
  // frame already has it and no section tip flashes up before it. Once it starts, `tour` is seen and it is not
  // queued again.
  const resumeFor = React.useRef(null);
  if (!isNetwork && church && resumeFor.current !== church) {
    resumeFor.current = church;
    if (stewTourSeen(church, 'pending') && !stewTourSeen(church, 'tour') && !stewTourStore.pending) stewTourStore.pending = { reason: 'resume' };
  }
  const plan = stewTourPlan(nav, { narrow: !!narrow, delegate: !!delegate });
  // While the tour runs, something opening over it (another dialog, the error banner, a join toast) hides the
  // bubble; the run and its step are kept, and it comes back at the same step once that has gone.
  const blocked = stewTourBlocked();
  runNow.current = !!run;
  holdNow.current = !!holdTips;
  const pending = stewTourStore.pending;
  const navItem = (Array.isArray(nav) ? nav : []).find(n => n && n.key === tab);
  // Only a section that is IN the nav: one the church switched off is still `tab` for the one render before
  // StewDashboard snaps back to Overview, and must not spend its tip in that moment.
  const tipFor = () => navItem ? stewTourSectionTip(tab, { locked: !!navItem.locked, delegate: !!delegate, seen: (k) => stewTourSeen(church, k) }) : null;
  // Start a queued tour, or show/clear a section tip. Runs after every render; each branch settles in one step.
  React.useEffect(() => {
    if (isNetwork) return;
    if (pending && !run && !blocked) {
      stewTourStore.pending = null;
      stewTourSeenSet(church, 'tour');
      setTip(null);
      if (onTab && !pending.keepTab && tab !== 'overview' && plan.some(s => s.card)) onTab('overview');
      setRun({ i: 0 });
      return;
    }
    if (run || pending) return;
    if (tip && tip.section !== tab) { setTip(null); return; }
    if (tip || blocked || holdTips) return;
    const c = tipFor();
    // NOT marked seen here: a steward can open a section and not read its tip. Seen = "Got it".
    // float: <main> is scrolled, so the tip floats at the top of what is in view (see StewTourTip).
    if (c && deciding.current !== tab) {
      deciding.current = tab;
      const sec = tab;
      stewTourLater(() => {
        deciding.current = null;
        if (tabNow.current !== sec) return;   // they moved on; the next section decides its own
        if (stewTourStore.pending || runNow.current || holdNow.current) return;   // the tour came, or tips are held: not now
        setTip(t => t || { ...c, section: sec, float: stewTourMainTop() > 0 });
        force(x => x + 1);
      });
    }
  });
  // Waiting behind something that sends no event (the error banner, a join toast): look again shortly.
  React.useEffect(() => {
    if (isNetwork || !blocked || !(run || pending || (!tip && tipFor()))) return;
    const t = setTimeout(() => force(x => x + 1), 700);
    return () => clearTimeout(t);
  });
  if (isNetwork) return null;
  if (run) {
    if (blocked) return null;
    const present = (t) => !!tourKitFind(t);
    const step = plan[run.i];
    if (!step) return null;
    const live = plan.filter(s => !s.targets.length || present(s.targets[0]) || s === step);
    const next = tourKitWalk(plan, run.i + 1, 1, present);
    const prev = tourKitWalk(plan, run.i - 1, -1, present);
    const end = () => setRun(null);
    // FINISHED (Next on the last step that can be shown) is not SKIPPED (Skip tour, Escape, Android Back): only a
    // finished tour has covered every section, so only it spends their first-open tips (owner, 2026-11-22).
    const finish = () => { stewTourMarkTipsSeen(church, nav); end(); };
    return <StewTourBubble step={step} pos={live.indexOf(step) + 1} count={live.length} first={prev < 0} last={next < 0}
      onSkip={end} onNext={() => { if (next < 0) finish(); else setRun({ i: next }); }} onBack={() => { if (prev >= 0) setRun({ i: prev }); }} />;
  }
  if (tip && tip.section === tab && !blocked) return <StewTourTip tip={tip} onDone={() => { stewTourSeenSet(church, tip.key); setTip(null); }} onDock={() => setTip(t => (t && t.float ? { ...t, float: false } : t))} />;
  return null;
}

window.stewTourStart = stewTourStart;
window.StewTourHost = StewTourHost;
