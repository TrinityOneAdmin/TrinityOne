// member-tour.jsx — the first-run walkthrough for the MEMBER APP (index.html).
//
// Two things, both shown by one host component (MemberTourHost) that App (app/app.jsx) mounts once:
//   1. A tour in two parts, in the same bubbles as the console's (app/tour-kit.jsx): Next / Back / Skip tour, a
//      step counter, a ring round the target. Part 1, the Bible (everyone, 5 steps). Part 2, Community (3 steps),
//      the first time the person has joined a church.
//   2. Reader tips: "Tap a verse" the first time the reader opens, then Translation, Listen (only with an audio
//      Bible on the phone) and Study, each the first time its button is on screen — one at a time, never stacked.
//
// WHEN THE TOUR STARTS (owner decisions, 2026-11-18). Automatically only on first-run transitions:
//   · finishing (or skipping) the setup screen — App → IdentityOnboarding onSave / onSkip → memberTourStart();
//   · an invite link adopting an account on a phone that had never been set up (App's invite effect);
//   · joining a church — App → followChurch → memberTourJoined(), the Community part only, once per device.
// A person who was already set up before this version never goes through the first two, and one who already
// follows a church when the app starts has Community marked as seen (the host's boot effect) — so nobody
// upgrading is ambushed. Help → "Take the tour again" (app/screens-help-main.jsx → ctx.replayTour) replays it.
//
// THE COMMUNITY PART WAITS UNTIL THE CHURCH HAS LET THE PERSON IN (owner, 2026-11-19; audit M1). Joining only
// records that it is wanted (the `community.wait` flag); App says when the person is admitted (`admitted`: their
// key is on the church's admitted list, or the church's trusted policy needs no approval) and the host queues it
// then. An automatic Community start also waits until the person is ON the Community page (plan §12.1), so the
// Groups step has its list to point at. Nothing is spent while waiting: "seen" is written only when it starts.
// Someone still waiting for approval when the app starts (`pendingAtBoot`, App's cached join answer) is not an
// upgrading member, so the boot rule leaves their Community part to come.
//
// WHERE IT RUNS. Wherever the person is when it can start: it never changes the tab. A step whose anchor is not
// on screen is skipped (the verse card is on Today, the groups list on Community); the tab bar is always there.
// Landing on Community in a church runs the Community part first, then the Bible part.
//
// WHAT IT NEVER DOES. It never shows over the splash, the setup screen, the PIN gate, the follow-a-church sheet or
// any other open sheet (App's `hold`, plus every BottomSheet/Overlay on the back stack, plus any aria-modal
// dialog) — it waits. An automatic start also waits while the person is typing (memberTourTyping, audit L4): the
// Community part can come long after the join, and a dialog taking focus would drop the keyboard mid-message. It writes nothing to a relay: "seen" is per device, in localStorage.
//
// YOUNG PEOPLE. The Groups step reads what the Community screen itself drew (data-tour-minor / data-tour-count /
// data-tour-loaded on its groups anchor, app/screens-chat.jsx), so it can only ever point at the list that young
// person really has. With no groups opened for them it says so in ordinary words (reference/DOMAIN.md: a church may
// have none). It NEVER GUESSES (audit L3): while it is not known whether the reader is a child, or a child's list
// has not arrived, or an adult has no groups to point at, the step is left out. An automatic start on Community
// first waits up to MEMBER_TOUR_GROUPS_WAIT for that to be known; a Help replay does not wait.
//
// Anchors: `data-tour="…"` in app/ui.jsx (tab-today, tab-read, tab-chat, tab-library, tab-you — TabBar and
// DesktopNav), app/screens-today.jsx (votd, happening), app/screens-chat.jsx (groups), app/screens-read.jsx
// (verse, version, listen, study).
//
// The file MUST NOT be named stew-*.jsx (scripts/sync-web.sh deletes those from the member build).
// Globals this file takes from elsewhere (loaded before it in index.html): React, tourKitFind, tourKitWalk,
// tourKitInsets, tourKitFlag, tourKitFlagSet, TourKitBubble (app/tour-kit.jsx), useDialogA11y and
// window.__trinityBackStack (app/ui.jsx), window.TrinityAudioStore (app/audio-store.jsx, optional).
// Top-level names DECLARED here — unique across the member app's single global scope on purpose (a duplicate
// top-level name in classic scripts blanks the whole app): MEMBER_TOUR_BIBLE, MEMBER_TOUR_COMMUNITY,
// MEMBER_TOUR_GROUPS, MEMBER_TOUR_GROUPS_WAIT, MEMBER_TOUR_TIPS, MEMBER_TOUR_NOT_TEXT, memberTourStore, memberTourKey, memberTourSeen,
// memberTourSeenSet, memberTourWaiting, memberTourWaitSet, memberTourTyping, memberTourStart, memberTourJoined,
// memberTourReader, memberTourPlan, memberTourGroupsText, memberTourGroupsUnknown, memberTourGroupFacts, memberTourPing, memberTourNextTip,
// memberTourHasAudio, memberTourBlocked, useMemberTourLayer, memberTourPrimary, MemberTourBubble, MemberTourHost.
// (member-tour.jsx is loaded by index.html only; steward.html does not load it.)

// ── the words (approved by the owner, 2026-11-18 — MEMBER-WALKTHROUGH-COPY-2026-11-18.html) ─────────────────
// Three sentences of the approved draft are NOT here because they are not true of the app today (rule: never
// ship a false sentence): the Listen tip's "It keeps playing with the screen off." (background playback is still
// being fixed on another branch, which the owner said takes it out), the young person's "A grown-up from church
// looks after each one." (nothing requires a leader on a child-safe group), and "Some open straight away; others
// need a steward to let you in." (an invite-only group a member is not in is not listed to them at all, and
// there is no way to ask to join one).
const MEMBER_TOUR_BIBLE = [
  { id: 'welcome', title: 'Welcome', targets: [],
    text: 'Welcome to TrinityOne. Here’s a quick look at your Bible. It takes under a minute, and you can skip it.' },
  { id: 'votd', title: 'Verse of the day', targets: ['votd'],
    text: 'A verse for each day. Tap it to open it up and share it.' },
  { id: 'read', title: 'Read', targets: ['tab-read'],
    text: 'The whole Bible. It opens where you left off.' },
  { id: 'library', title: 'Library', targets: ['tab-library'],
    text: 'More Bibles, devotionals, and things to watch and listen to. Your highlights, notes and bookmarks are kept here too.' },
  { id: 'you', title: 'You', targets: ['tab-you'],
    text: 'Your name, settings and Help. You can replay this tour from Help.' },
];
const MEMBER_TOUR_COMMUNITY = [
  { id: 'community', title: 'Community', targets: ['tab-chat'],
    text: 'Your church is here: announcements, events, groups and teams.' },   // owner, 2026-11-19
  { id: 'groups', title: 'Groups and teams', targets: ['groups'] },   // text: memberTourGroupsText
  { id: 'happening', title: 'What’s happening', targets: ['happening'],
    text: 'What’s on at your church this week shows up here on Today too.' },
];
const MEMBER_TOUR_GROUPS = {
  adult: 'Groups you can join.',
  child: 'The groups your church has opened for you.',
  none: 'Your church hasn’t opened any groups for you yet.',
};
const MEMBER_TOUR_GROUPS_WAIT = 10000;   // ms an automatic Community start waits for the Groups facts to be known
// In the order they are offered. `audio`: only when an audio Bible is on this phone.
const MEMBER_TOUR_TIPS = [
  { id: 'verse', anchor: 'verse', title: 'Tap a verse', text: 'Tap any verse to highlight it, add a note, bookmark it, share it, or look up a word.' },
  { id: 'version', anchor: 'version', title: 'Translation', text: 'Switch translation here. Get more from Library.' },
  { id: 'listen', anchor: 'listen', title: 'Listen', text: 'Hear this chapter read aloud.', audio: true },
  { id: 'study', anchor: 'study', title: 'Study', text: 'Cross-references and commentary for the verse you’re reading.' },
];

// ── seen-state and requests ─────────────────────────────────────────────────────────────────────────────────
// pending: a tour asked for and not yet shown, { bible, community, replay }. reader: the reader has drawn a
// chapter, so its tips may be offered. audio: an audio Bible was found on the phone (probed once).
const memberTourStore = { pending: null, reader: false, audio: null };
function memberTourKey(what) { return 'trinityone.tour.' + what; }
function memberTourSeen(what) { return tourKitFlag(memberTourKey(what)); }
function memberTourSeenSet(what) { tourKitFlagSet(memberTourKey(what)); }
function memberTourPing() { try { window.dispatchEvent(new Event('member-tour')); } catch (e) {} }
// The Community part is wanted and has not run: set on joining, read by the host on admission. Never cleared —
// every reader also asks memberTourSeen('community'). No identifier in the key, so the PIN-lock wipe leaves it.
function memberTourWaiting() { return tourKitFlag(memberTourKey('community.wait')); }
function memberTourWaitSet() { tourKitFlagSet(memberTourKey('community.wait')); }

// Ask for the tour. 'onboarding' and 'invite' are first-run starts and happen once per device; 'replay' (Help)
// always starts it. Returns whether a start was queued.
function memberTourStart(reason) {
  const why = reason || 'replay';
  if (why === 'replay') { memberTourStore.pending = { bible: true, community: true, replay: true }; memberTourPing(); return true; }
  if (memberTourSeen('bible')) return false;
  const p = memberTourStore.pending || {};
  memberTourStore.pending = { ...p, bible: true, community: true };
  memberTourPing();
  return true;
}
// The person has just joined a church (App → followChurch). The Community part, once per device — queued by the
// host when the church lets them in, not now. Returns whether it is (still) to come.
function memberTourJoined() {
  if (memberTourSeen('community')) return false;
  memberTourWaitSet();
  memberTourPing();
  return true;
}
// The reader has drawn a chapter (ReadScreen's effect). Its tips may now be offered.
function memberTourReader() {
  memberTourStore.reader = true;
  memberTourPing();
  return true;
}

// ── pure logic (scripts/member-walkthrough.test.mjs RUNS these) ─────────────────────────────────────────────
// The steps to walk, in order. parts: { bible, community }; page: the tab the person is on. Landing on Community
// puts the Community part first (owner, 2026-11-18). Each step: { id, title, text, targets }.
function memberTourPlan(opts) {
  const o = opts || {};
  const parts = o.parts || {};
  const bible = parts.bible ? MEMBER_TOUR_BIBLE : [];
  const comm = parts.community ? MEMBER_TOUR_COMMUNITY : [];
  const order = o.page === 'chat' ? comm.concat(bible) : bible.concat(comm);
  return order.map(s => ({ id: s.id, title: s.title, text: s.id === 'groups' ? memberTourGroupsText(o.groups) : s.text, targets: s.targets.slice() }));
}
// The Groups step's words, or null when there is nothing TRUE to say yet (the step is then left out). facts:
// { minor: true | false | null (not known), count, loaded (the church's list has arrived) } as the Community
// screen drew them.
function memberTourGroupsText(facts) {
  if (!facts || facts.minor == null) return null;
  const n = facts.count || 0;
  if (facts.minor) return n > 0 ? MEMBER_TOUR_GROUPS.child : (facts.loaded ? MEMBER_TOUR_GROUPS.none : null);
  return n > 0 ? MEMBER_TOUR_GROUPS.adult : null;
}
// Not known YET — worth waiting for on an automatic start: who the reader is, or (with nothing listed) whether the
// church's list has arrived. An adult whose church's list arrived with nothing for them is known: nothing to say.
function memberTourGroupsUnknown(facts) {
  return !facts || facts.minor == null || ((facts.count || 0) === 0 && !facts.loaded);
}
// What the Community screen drew on its groups anchor, or null when it is not on screen.
function memberTourGroupFacts() {
  const el = tourKitFind('groups');
  if (!el || !el.getAttribute) return null;
  const m = el.getAttribute('data-tour-minor');
  return { minor: m === '1' ? true : m === '0' ? false : null, count: parseInt(el.getAttribute('data-tour-count'), 10) || 0, loaded: el.getAttribute('data-tour-loaded') === '1' };
}
// The next reader tip to offer, or null. seen(id) answers from storage, present(anchor) from the screen, audio
// says whether an audio Bible is on the phone. One at a time: the first unseen tip whose button is on screen.
function memberTourNextTip(opts) {
  const o = opts || {};
  const seen = typeof o.seen === 'function' ? o.seen : () => false;
  const present = typeof o.present === 'function' ? o.present : () => false;
  for (const t of MEMBER_TOUR_TIPS) {
    if (seen('tip.' + t.id)) continue;
    if (t.audio && !o.audio) continue;
    if (!present(t.anchor)) continue;
    return { key: 'tip.' + t.id, id: t.id, title: t.title, text: t.text, targets: [t.anchor] };
  }
  return null;
}

// ── the DOM ─────────────────────────────────────────────────────────────────────────────────────────────────
// Is an audio Bible on this phone? A ready set in the audio store's registry (the member's own, or World English
// once it has moved to file storage) answers at once; World English chapters still in IndexedDB are found by one
// asynchronous look, remembered for the session.
function memberTourHasAudio() {
  const S = window.TrinityAudioStore;
  try { if (S && S.readySets && S.readySets().length) return true; } catch (e) {}
  if (memberTourStore.audio === null) {
    memberTourStore.audio = false;
    try {
      if (S && S.listAll) Promise.resolve(S.listAll('WEB')).then(m => { if (m && m.size) { memberTourStore.audio = true; memberTourPing(); } }).catch(() => {});
    } catch (e) {}
  }
  return !!memberTourStore.audio;
}
// Is something else in front of the app? Every BottomSheet / Overlay registers on the back stack (app/ui.jsx
// useBackLayer); an aria-modal dialog that does not is caught by the selector. The tour's own entry and its own
// bubble are left out.
function memberTourBlocked() {
  try { const st = window.__trinityBackStack; if (st && st.some(e => e && !e.memberTour)) return true; } catch (e) {}
  try { return !!document.querySelector('[role="dialog"][aria-modal="true"]:not([data-member-tour])'); } catch (e) { return false; }
}
// Is the person typing? Focus in a text box, a text-like input, a select or an editable area — not one of the
// tour's own. An automatic start waits for it to end (audit L4); a replay from Help does not.
const MEMBER_TOUR_NOT_TEXT = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file', 'color'];
function memberTourTyping() {
  try {
    const a = document.activeElement;
    if (!a || !a.tagName) return false;
    if (a.closest && a.closest('[data-member-tour]')) return false;
    const t = String(a.tagName).toUpperCase();
    if (t === 'TEXTAREA' || t === 'SELECT') return true;
    if (t === 'INPUT') return MEMBER_TOUR_NOT_TEXT.indexOf(String(a.type || 'text').toLowerCase()) < 0;
    return !!a.isContentEditable;
  } catch (e) { return false; }
}
// Put the TOUR on the back stack, so Android Back and Escape (both go through window.trinityGoBack) close it first,
// as they close a sheet. Marked, so memberTourBlocked does not count it. A reader TIP is not put there (triage P1,
// 2026-11-19): it blocks nothing and takes no focus, so Back must do what it always does on Read — leave it. The tip
// was marked seen when drawn and goes when its anchor does; "Got it" still dismisses it.
function useMemberTourLayer(open, onClose) {
  const ref = React.useRef(onClose);
  ref.current = onClose;
  React.useEffect(() => {
    if (!open) return undefined;
    const st = (window.__trinityBackStack = window.__trinityBackStack || []);
    const entry = { memberTour: true, close: () => { try { ref.current && ref.current(); } catch (e) {} } };
    st.push(entry);
    return () => { const i = st.indexOf(entry); if (i >= 0) st.splice(i, 1); };
  }, [open]);
}

// ── the bubble ──────────────────────────────────────────────────────────────────────────────────────────────
// The tour is a dialog like the app's sheets (useDialogA11y): focus moves into it and is trapped there, Escape
// and Back skip it. A tip takes no focus, blocks nothing and is on no back stack: Back and Escape pass it by.
const memberTourPrimary = { border: 'none', background: 'var(--clay-ink, var(--clay))', color: 'var(--on-clay, #fff)' };
function MemberTourBubble(props) {
  const panelRef = React.useRef(null);
  const isTip = props.variant === 'tip';
  if (typeof useDialogA11y === 'function') useDialogA11y(!isTip, panelRef, props.onSkip);
  useMemberTourLayer(!isTip, props.onSkip);
  const insets = React.useMemo(() => tourKitInsets(), []);
  return <TourKitBubble {...props} panelRef={panelRef} mark="data-member-tour" insets={insets} primary={memberTourPrimary} anim="trinityScale" ringMaxH={props.step && props.step.id === 'groups' ? 200 : undefined} z={isTip ? 70 : 260} />;
}

// ── the host ────────────────────────────────────────────────────────────────────────────────────────────────
// Mounted once by App. page: the open tab. inChurch: following a real church. admitted: the church has let this
// person in (App's tourAdmitted). pendingAtBoot: App's cached join answer said "waiting for approval" when the
// app started. hold: App's own reasons to wait (splash, setup screen, PIN gate, the follow-a-church sheet). It is
// never handed a way to change the tab.
function MemberTourHost({ page, inChurch, admitted, pendingAtBoot, hold }) {
  const [, force] = React.useState(0);
  const [run, setRun] = React.useState(null);   // { plan, i } while the tour is showing
  const [tip, setTip] = React.useState(null);   // the reader tip on screen
  React.useEffect(() => {
    // Boot: someone who already follows a church when the app starts has joined before — the Community part is
    // for the first join, so an upgrading member is not shown it. Unless they are still waiting to be let in (or
    // their join is already waiting for that): then it is still to come.
    if (inChurch && !memberTourStore.pending) {
      if (pendingAtBoot) memberTourWaitSet();
      else if (!memberTourWaiting()) memberTourSeenSet('community');
    }
    const f = () => force(x => x + 1);
    try { window.addEventListener('member-tour', f); } catch (e) {}
    return () => { try { window.removeEventListener('member-tour', f); } catch (e) {} };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // While the tour runs, anything that comes up over it (the PIN idle-lock, a sheet, an aria-modal dialog) hides
  // the bubble; the run and its step are kept, and it comes back at the same step once that has gone.
  const blocked = !!hold || memberTourBlocked();
  // The Groups step counts as on screen only with something true to say (L3).
  const present = (t) => !!tourKitFind(t) && (t !== 'groups' || memberTourGroupsText(memberTourGroupFacts()) != null);
  const wantTip = () => memberTourStore.reader && memberTourNextTip({ seen: memberTourSeen, present, audio: memberTourHasAudio() });
  // Is any reader tip still unseen, whatever is on screen? When none is, there is nothing to wait for.
  const tipsLeft = () => memberTourStore.reader && !!memberTourNextTip({ seen: memberTourSeen, present: () => true, audio: memberTourHasAudio() });
  // Let in, on the Community page, and the Community part still to come: ask for it now (M1).
  if (admitted && page === 'chat' && memberTourWaiting() && !memberTourSeen('community') && !(memberTourStore.pending && memberTourStore.pending.community)) {
    memberTourStore.pending = { ...(memberTourStore.pending || {}), community: true, at: Date.now() };
  }
  const pending = memberTourStore.pending;
  const typing = !!(pending && !pending.replay) && memberTourTyping();   // an automatic start waits; nothing is consumed
  // An automatic Community start on Community waits (up to MEMBER_TOUR_GROUPS_WAIT from its request) while the Groups
  // facts are not known yet — group documents arrive a few seconds after admission. A replay never waits (§12.3).
  let groupsWait = false;
  if (pending && pending.community && !pending.replay && page === 'chat' && !!tourKitFind('groups') && memberTourGroupsUnknown(memberTourGroupFacts())) {
    if (!pending.at) pending.at = Date.now();
    groupsWait = Date.now() - pending.at < MEMBER_TOUR_GROUPS_WAIT;
  }
  React.useEffect(() => {
    // The Groups step is up and its words have just become unknown (the list changed under it): move on, never
    // draw an empty bubble (§12.5).
    if (run && !blocked) {
      const st = run.plan[run.i];
      if (st && st.id === 'groups' && !present('groups')) {
        const n = tourKitWalk(run.plan, run.i + 1, 1, present);
        setRun(n < 0 ? null : { plan: run.plan, i: n });
        force(x => x + 1);
        return;
      }
    }
    if (pending && !run && !blocked && !typing && !groupsWait) {
      memberTourStore.pending = null;
      // Community only for someone the church has let in; an automatic start only on the Community page. Left
      // out here, nothing is spent: the wait flag asks again on the next admission / visit.
      const parts = { bible: !!pending.bible, community: !!pending.community && !!admitted && (pending.replay || (!memberTourSeen('community') && page === 'chat')) };
      if (!pending.replay && memberTourSeen('bible')) parts.bible = false;
      if (parts.bible) memberTourSeenSet('bible');
      if (parts.community) memberTourSeenSet('community');
      const plan = memberTourPlan({ parts, page });
      const i = tourKitWalk(plan, 0, 1, present);
      setTip(null);
      if (i >= 0) setRun({ plan, i });
      return;
    }
    if (run || pending) return;   // (a pending start held back while typing stays pending)
    if (tip && (blocked || !present(tip.targets[0]))) { setTip(null); return; }   // a sheet opened, or the reader closed: it has been seen
    if (tip || blocked) return;
    const c = wantTip();
    if (c) { memberTourSeenSet(c.key); setTip(c); }
  });
  // Waiting behind something that sends no event (a sheet closing, the keyboard closing): look again shortly.
  React.useEffect(() => {
    if (!((typing || groupsWait) && pending) && (!blocked || !(pending || run || (!tip && tipsLeft())))) return undefined;
    const t = setTimeout(() => force(x => x + 1), 700);
    return () => clearTimeout(t);
  });
  if (run) {
    if (blocked) return null;
    const step = run.plan[run.i];
    if (!step) return null;
    const shown = step.id === 'groups' ? { ...step, text: memberTourGroupsText(memberTourGroupFacts()) } : step;
    if (shown.text == null) return null;   // its words became unknown: the effect moves on (§12.5)
    const live = run.plan.filter(s => !s.targets.length || present(s.targets[0]) || s === step);
    const next = tourKitWalk(run.plan, run.i + 1, 1, present);
    const prev = tourKitWalk(run.plan, run.i - 1, -1, present);
    const end = () => setRun(null);
    return <MemberTourBubble step={shown} pos={live.indexOf(step) + 1} count={live.length} first={prev < 0} last={next < 0}
      onSkip={end} onNext={() => { if (next < 0) end(); else setRun({ plan: run.plan, i: next }); }} onBack={() => { if (prev >= 0) setRun({ plan: run.plan, i: prev }); }} />;
  }
  if (tip && !blocked) return <MemberTourBubble variant="tip" step={tip} onNext={() => setTip(null)} onSkip={() => setTip(null)} />;
  return null;
}

window.memberTourStart = memberTourStart;
window.memberTourJoined = memberTourJoined;
window.memberTourReader = memberTourReader;
window.MemberTourHost = MemberTourHost;
