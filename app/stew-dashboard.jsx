// stew-dashboard.jsx — desktop Steward Console running state. Exports StewDashboard.

const NAV = [
  { key: 'overview', label: 'Overview', ic: 'today' },
  { key: 'groups', label: 'Groups', ic: 'chat' },
  { key: 'rota', label: 'Rota', ic: 'calCheck' },
  { key: 'calendar', label: 'Calendar', ic: 'calendar' },
  { key: 'rooms', label: 'Rooms', ic: 'marker' },
  { key: 'resources', label: 'Resources', ic: 'read' },
  { key: 'members', label: 'Members', ic: 'pray' },
  { key: 'settings', label: 'Settings', ic: 'sliders' },
  // { key: 'giving', label: 'Giving', ic: 'gift' },   // parked for the pilot (chat first)
];

// sidebar identity control: switch the WHOLE console between the church and any network it owns.
// With no owned networks it's just the church name button (tap to rename).
function IdentitySwitcher({ church, churchName, initials, onEditName }) {
  const idv = window.useStewardIdv ? window.useStewardIdv() : 0;
  const stewarded = window.useStewardStewardedChurches ? window.useStewardStewardedChurches() : [];   // churches we steward (delegated)
  const [open, setOpen] = React.useState(false);
  const [, force] = React.useState(0);
  // owning a network (create/import) or gaining/losing a stewarded church fires 'steward-networks' — re-render live
  React.useEffect(() => { const f = () => force(x => x + 1); window.addEventListener('steward-networks', f); return () => window.removeEventListener('steward-networks', f); }, []);
  const ids = (window.Steward.identities ? window.Steward.identities() : []);
  const activePub = window.Steward.activePub;
  const networks = ids.filter(i => i.kind === 'network');
  const viewingNetwork = window.Steward.isViewingNetwork && window.Steward.isViewingNetwork();
  const delegated = window.Steward.isDelegated && window.Steward.isDelegated();
  const offChurch = viewingNetwork || delegated;   // not on our own church identity
  const pick = (pub) => { window.Steward.setActiveIdentity(pub); setOpen(false); };
  // no other identities (no owned networks, no stewarded churches) → original behaviour (tap to set/rename the church)
  if (!networks.length && !stewarded.length) {
    return (
      <button onClick={onEditName} title="Set church name" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--surface-2)', cursor: 'pointer', marginBottom: 18, textAlign: 'left' }}>
        <SkBadge initials={initials} picture={church.picture} size={34} radius={999} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: church.name ? 'var(--ink)' : 'var(--ink-3)' }}>{churchName}</span>{church.name ? <Icon name="check" size={12} stroke={3} color="var(--sage)" /> : null}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: churchHandle(church) ? 'var(--font-ui)' : 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{churchHandle(church) || (church.npub ? church.npub.slice(0, 18) + '…' : 'no key')}</div>
        </div>
        <Icon name="pen" size={14} color="var(--ink-3)" />
      </button>
    );
  }
  return (
    <div style={{ position: 'relative', marginBottom: 18 }}>
      <button onClick={() => setOpen(o => !o)} title="Switch between your church, networks, and churches you steward" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 13, width: '100%', border: '1px solid ' + (offChurch ? 'color-mix(in oklab, var(--clay) 45%, var(--line))' : 'var(--line)'), background: offChurch ? 'color-mix(in oklab, var(--clay) 9%, var(--surface))' : 'var(--surface-2)', cursor: 'pointer', textAlign: 'left' }}>
        <SkBadge initials={initials} picture={offChurch ? '' : church.picture} size={34} radius={999} accent={offChurch ? 'var(--clay)' : undefined} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{churchName}</span>
            <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '.5px', color: offChurch ? 'var(--clay-ink)' : 'var(--ink-3)', background: offChurch ? 'var(--clay-soft)' : 'var(--surface)', border: offChurch ? 'none' : '1px solid var(--line)', borderRadius: 999, padding: '1px 5px', flexShrink: 0 }}>{delegated ? 'STEWARD' : viewingNetwork ? 'NETWORK' : 'CHURCH'}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{delegated ? 'Acting as steward · tap to switch' : 'Tap to switch view'}</div>
        </div>
        <Icon name={open ? 'chevU' : 'chevD'} size={14} color="var(--ink-3)" />
      </button>
      {open ? (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6, zIndex: 60, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 13, boxShadow: 'var(--shadow-lg)', padding: 6, animation: 'lumenScale .16s ease both' }}>
          {ids.map(idn => {
            const on = idn.pub === activePub;
            const label = idn.kind === 'church' ? (church.name || 'Your church') : (idn.name || (idn.kind === 'steward' ? 'Church' : 'Network'));
            const subtitle = idn.kind === 'network' ? 'Network console' : idn.kind === 'steward' ? 'You steward this church' : 'Your church';
            const icon = idn.kind === 'network' ? 'globe' : idn.kind === 'steward' ? 'shield' : 'bank';
            return (
              <button key={idn.pub} onClick={() => pick(idn.pub)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', textAlign: 'left', background: on ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'transparent', fontFamily: 'var(--font-ui)' }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, var(--clay) 13%, var(--surface))', color: 'var(--clay)' }}><Icon name={icon} size={15} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{subtitle}</div>
                </div>
                {on ? <Icon name="check" size={15} stroke={2.6} color="var(--clay)" /> : null}
              </button>
            );
          })}
          {!delegated ? <React.Fragment>
          <div style={{ height: 1, background: 'var(--line)', margin: '5px 4px' }} />
          <button onClick={() => { setOpen(false); onEditName(); }} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', textAlign: 'left', background: 'transparent', color: 'var(--ink-2)', fontWeight: 700, fontSize: 12.5, fontFamily: 'var(--font-ui)' }}><Icon name="pen" size={13} color="var(--ink-3)" /> Rename {viewingNetwork ? 'network' : 'church'}</button>
          </React.Fragment> : null}
        </div>
      ) : null}
    </div>
  );
}

// A relay refusing this church's writes is the ONLY situation in which registering with a relay's
// allow-list makes sense, so that control stays hidden until it happens. The banner is where the
// rejection is already classified, so the flag is set here rather than duplicating the test. It is
// persisted because the banner clears itself after 9s and the fix lives on another screen — by the time
// the steward reaches Settings the event is long gone.
window.REG_NEEDED_LS = 'trinityone.steward.relay-rejected';
const REG_NEEDED_TTL = 7 * 24 * 60 * 60 * 1000;   // a rejection older than a week is stale — the relay was likely fixed another way
function noteRelayRejection() {
  try { localStorage.setItem(window.REG_NEEDED_LS, String(Date.now())); } catch (e) {}
  try { window.dispatchEvent(new CustomEvent('steward-relay-rejected')); } catch (e) {}
}
function clearRelayRejection() {
  try { localStorage.removeItem(window.REG_NEEDED_LS); } catch (e) {}
  try { window.dispatchEvent(new CustomEvent('steward-relay-cleared')); } catch (e) {}
}
// The flag says "a relay refused our posts". It's stale once posts are landing again — the steward may well
// have fixed it another way (restored the key, the operator added the church) without touching the in-console
// token, and the alarm shouldn't linger forever. True only if a rejection is recorded AND still fresh.
function relayRejectionActive() {
  try { const t = parseInt(localStorage.getItem(window.REG_NEEDED_LS) || '', 10);
    if (!t) return false;
    if (Date.now() - t > REG_NEEDED_TTL) { clearRelayRejection(); return false; }
    return true;
  } catch (e) { return false; }
}

// surfaces a relay rejection (e.g. this console's church key isn't the one the relay enforces)
// Turn the relay's refusal into something true and actionable.
//
// AUDIT 2026-07-25: this used to test three substrings and pick one of two sentences. Two consequences, both
// bad. "invalid: a newer version of this is already stored" fell through to "check the connection and try
// again" — the connection is fine and trying again will fail identically, forever. And anything containing
// "blocked" — including "blocked: this event was deleted by its author" — was diagnosed as WRONG CHURCH, which
// tells the steward to restore their church key: a destructive action, suggested for an unrelated cause.
//
// Rules: only the genuine membership refusal counts as wrong-church (it is the only one that should raise the
// relay-rejection alarm); each known reason gets its own sentence; anything else we do not recognise is quoted
// from the relay verbatim rather than given an invented explanation. Only a genuine connection failure — the
// case with no reason at all — is auto-dismissed, because the others need the steward to do something.
function publishErrorMessage(reason) {
  const r = String(reason || '');
  if (/not a member|not permitted/i.test(r)) return { wrongChurch: true, sticky: true,
    msg: 'Changes weren’t saved: this relay is set up for a different church. Restore this church’s key in Settings, or point the relay at this church.' };
  if (/newer version/i.test(r)) return { wrongChurch: false, sticky: true,
    msg: 'Someone else saved a newer version of this while you were editing. Reload the page and make your change again — trying again as-is won’t help.' };
  if (/deleted by its author/i.test(r)) return { wrongChurch: false, sticky: true,
    msg: 'That item has been deleted, so it can’t be changed. Create it again if you still need it.' };
  if (/too far in the future/i.test(r)) return { wrongChurch: false, sticky: true,
    msg: 'Changes weren’t saved: this device’s clock is wrong, so the relay refused the date. Fix the date and time, then try again.' };
  if (/^(invalid|blocked|restricted|rejected)\b/i.test(r)) return { wrongChurch: false, sticky: true,
    msg: 'The relay refused this change: ' + r.replace(/^(invalid|blocked|restricted|rejected):?\s*/i, '') };
  return { wrongChurch: false, sticky: false, msg: 'Couldn’t save to the relay — check the connection and try again.' };
}

// Who counts as a member of this church, in one place.
//
// `subscribeMembers` returns every member doc the relay has ever served — including people who were BLOCKED
// and people still QUEUING for approval. Counting those made a seven-person church read "26 members", and told
// every group that 26 people could see it. Blocked are excluded always; pending only once the admitted/blocked
// rosters have actually arrived, because on a hard reload those sets are briefly empty and everyone would
// momentarily look like they were queuing at the door.
function useRealMemberCount() {
  const members = window.useStewardMembers ? window.useStewardMembers() : [];
  const admittedSet = new Set(window.useStewardAdmitted ? window.useStewardAdmitted() : []);
  const blockedSet = new Set(window.useStewardBlocked ? window.useStewardBlocked() : []);
  const joinApproval = window.useStewardJoinPolicy ? window.useStewardJoinPolicy() : false;
  const idvNow = window.useStewardIdv ? window.useStewardIdv() : 0;
  const rosterLoaded = !window.stewardStreamLoaded
    || (window.stewardStreamLoaded('subscribeAdmitted', idvNow) && window.stewardStreamLoaded('subscribeBlocked', idvNow));
  return members.filter(m => !blockedSet.has(m.pubkey)
    && !(joinApproval && rosterLoaded && !admittedSet.has(m.pubkey))).length;
}

function PublishErrorBanner() {
  const [msg, setMsg] = React.useState('');
  React.useEffect(() => {
    const f = (e) => {
      const { msg: m, wrongChurch, sticky } = publishErrorMessage((e.detail && e.detail.reason) || '');
      if (wrongChurch) noteRelayRejection();
      setMsg(m);
      clearTimeout(f._t);
      if (!sticky) f._t = setTimeout(() => setMsg(''), 9000);   // actionable failures stay until dismissed
    };
    window.addEventListener('steward-publish-error', f);
    return () => window.removeEventListener('steward-publish-error', f);
  }, []);
  if (!msg) return null;
  return (
    <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 140, maxWidth: 560, width: 'calc(100% - 32px)', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 13, background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 40%, transparent)', boxShadow: 'var(--shadow-lg)' }}>
      <Icon name="bolt" size={17} color="var(--clay)" style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.45, fontWeight: 600 }}>{msg}</div>
      <button onClick={() => setMsg('')} title="Dismiss this message" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}><Icon name="x" size={15} /></button>
    </div>
  );
}

// toasts the steward when a brand-new member joins. A 4s settle window lets the existing roster stream
// in first (so the backfill doesn't alert), and we key off new pubkeys — not the `joined` timestamp —
// so a returning member's heartbeat never looks like a fresh join.
function JoinNotifier() {
  const [toast, setToast] = React.useState('');
  const tmr = React.useRef(null);
  React.useEffect(() => {
    if (!(window.Steward && window.Steward.subscribeMembers)) return;
    let known = new Set(), ready = false;
    const settle = setTimeout(() => { ready = true; }, 4000);
    const off = window.Steward.subscribeMembers((members) => {
      if (!ready) { known = new Set(members.map(m => m.pubkey)); return; }
      const fresh = members.filter(m => !known.has(m.pubkey));
      if (!fresh.length) return;
      fresh.forEach(m => known.add(m.pubkey));
      const last = fresh[fresh.length - 1];
      setToast(fresh.length > 1 ? `${fresh.length} people just joined your church 🎉` : `${last.name || 'Someone'} just joined your church 🎉`);
      clearTimeout(tmr.current); tmr.current = setTimeout(() => setToast(''), 9000);
    });
    return () => { clearTimeout(settle); clearTimeout(tmr.current); try { off && off(); } catch (e) {} };
  }, []);
  if (!toast) return null;
  return (
    <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 141, maxWidth: 520, width: 'calc(100% - 32px)', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 15px', borderRadius: 13, background: 'color-mix(in oklab, var(--sage) 14%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 42%, transparent)', boxShadow: 'var(--shadow-lg)', animation: 'lumenScale .2s ease both' }}>
      <Icon name="users" size={17} color="var(--sage)" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 13, color: 'var(--ink)', lineHeight: 1.4, fontWeight: 700 }}>{toast}</div>
      <button onClick={() => setToast('')} title="Dismiss this message" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}><Icon name="x" size={15} /></button>
    </div>
  );
}

// auto-distribute encrypted-group keys to NEW members (an open group keys everyone; an invite group its
// allowlist). reuse-only — it never mints a new key in the background (that would orphan history); removals
// are rotated explicitly from the edit-members modal. Renders nothing.
function KeyDistributor() {
  const groups = window.useStewardGroups ? window.useStewardGroups() : [];
  const members = window.useStewardMembers ? window.useStewardMembers() : [];
  const last = React.useRef({});
  const membersRef = React.useRef([]); membersRef.current = members;
  // #17: load the church media key whenever the console is open (not only on the Sermons tab) so we can re-key joiners
  React.useEffect(() => (window.Steward && window.Steward.subscribeMediaKey ? window.Steward.subscribeMediaKey() : undefined), []);
  // the church CARE key — same envelope, sealing the identifying half of care needs (H3)
  React.useEffect(() => (window.Steward && window.Steward.subscribeCareKey ? window.Steward.subscribeCareKey() : undefined), []);
  // keep the envelope's author check current: a revoked steward's envelope must stop being accepted
  const stewardRoster = window.useStewardStewards ? window.useStewardStewards() : [];
  React.useEffect(() => { if (window.Steward && window.Steward.setCareRoster) window.Steward.setCareRoster(stewardRoster); }, [stewardRoster]);
  // BLOCKED MEMBERS MUST NEVER BE RE-KEYED. useStewardMembers() does not filter the blocklist (DashMembers does
  // that itself), so every recipient set built here silently included people the steward had removed: the next
  // time anyone joined, `grew` fired and the freshly-rotated key was wrapped straight back to them. The care and
  // media re-key paths had the same hole via `want`. AUDIT-2026-07-27.
  const blockedList = window.useStewardBlocked ? window.useStewardBlocked() : [];
  const blockedSet = React.useMemo(() => new Set((blockedList || []).map(p => String(p || '').toLowerCase())), [blockedList]);
  const notBlocked = (pk) => pk && !blockedSet.has(String(pk).toLowerCase());
  React.useEffect(() => {
    const memberPubs = members.map(m => m.pubkey).filter(notBlocked);
    for (const g of groups) {
      if (!g.encrypted) continue;
      const recips = (g.visibility === 'invite' ? (g.members || []) : memberPubs).filter(notBlocked);
      const key = [...new Set(recips)].sort().join(',');
      const prev = last.current[g.id];
      if (prev === undefined) { last.current[g.id] = key; continue; }   // first sighting — already keyed by create/edit
      if (key !== prev) {
        const grew = recips.some(pk => pk && !prev.split(',').includes(pk));
        if (grew && window.Steward.publishGroupKey) window.Steward.publishGroupKey(g.id, recips, { reuseOnly: true });
        last.current[g.id] = key;
      }
    }
    // #17: re-wrap the church MEDIA key for the current roster too. Unlike groups (keyed at create/edit), the media
    // key is only published at sermon UPLOAD, so a member who joined since is missing from it and can't decrypt
    // existing sermons. ensureMediaKeyForMembers self-guards (only republishes if someone's actually missing).
    if (window.Steward && window.Steward.ensureMediaKeyForMembers) window.Steward.ensureMediaKeyForMembers(memberPubs);
    // H3: and the CARE key, so every member can open a need and volunteer. Mints only after the
    // subscription has confirmed no envelope exists — never on a cold null, which is what orphaned
    // every sealed need in the first attempt. Stewards are included so a delegated console can re-key.
    if (window.Steward && window.Steward.ensureCareKeyForMembers) window.Steward.ensureCareKeyForMembers(memberPubs, stewardRoster);
  }, [groups, members, stewardRoster]);
  // the media key loads ASYNC (subscribeMediaKey) and may arrive AFTER the roster settles, so the effect above can run
  // before we hold the key. Re-check a couple of times on mount — ensureMediaKeyForMembers is idempotent + cheap.
  React.useEffect(() => {
    const call = () => { if (window.Steward && window.Steward.ensureMediaKeyForMembers) window.Steward.ensureMediaKeyForMembers(membersRef.current.map(m => m.pubkey)); };
    const t1 = setTimeout(call, 3500), t2 = setTimeout(call, 9000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return null;
}

// wizard step chrome — module-level so its component type is stable across renders
// (defining it inside StewSetupWizard would remount on every keystroke and blur the inputs).
function WizShell({ step, title, sub, children, footer }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'color-mix(in oklab, var(--ink) 42%, transparent)', backdropFilter: 'blur(4px)', animation: 'lumenFade .18s ease both' }}>
      <div className="no-scrollbar" style={{ width: 520, maxWidth: '100%', maxHeight: '92%', overflowY: 'auto', borderRadius: 24, background: 'var(--paper)', border: '1px solid var(--line)', boxShadow: '0 30px 80px rgba(0,0,0,.32)', animation: 'lumenScale .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div style={{ padding: '26px 28px 0' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>{[0, 1, 2, 3, 4, 5, 6].map(i => <span key={i} style={{ height: 5, flex: 1, borderRadius: 999, background: i <= step ? 'var(--clay)' : 'var(--line)' }} />)}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, letterSpacing: '-.4px' }}>{title}</div>
          {sub ? <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 0' }}>{sub}</div> : null}
          <div style={{ marginTop: 18 }}>{children}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 28px 24px' }}>{footer}</div>
      </div>
    </div>
  );
}

// First-run setup wizard — catches a brand-new church on first console load and walks
// name → starter groups → first serving team (or defer). Each step publishes immediately;
// a localStorage flag (set on finish/skip) keeps it from reappearing.
function StewSetupWizard({ church, onDone, onTab, onInvite, onNewPost }) {
  const [step, setStep] = React.useState(0);
  const [name, setName] = React.useState(church.name || '');
  const [busy, setBusy] = React.useState(false);
  const [teamName, setTeamName] = React.useState('');
  const STARTERS = [
    { id: 'whole', name: 'Whole Church', kind: 'broadcast', sub: 'Announcements for everyone' },
    { id: 'prayer', name: 'Prayer', kind: 'group', sub: 'Share & lift requests' },
    { id: 'life', name: 'Life Group', kind: 'group', sub: 'A midweek small group' },
  ];
  const [picks, setPicks] = React.useState(() => new Set(['whole', 'prayer']));
  const toggle = (id) => setPicks(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // step 1 — key backup + optional relay registration
  const [saved, setSaved] = React.useState(false);
  const [keyCopied, setKeyCopied] = React.useState(false);
  const [relayOpen, setRelayOpen] = React.useState(false);
  const [relayToken, setRelayToken] = React.useState('');
  const [relayMsg, setRelayMsg] = React.useState('');
  const [relayBusy, setRelayBusy] = React.useState(false);
  const [relayAddr, setRelayAddr] = React.useState('');
  const [addrMsg, setAddrMsg] = React.useState('');
  // The desktop "church-in-a-box" build serves the console from its OWN relay, so there is nothing to add.
  const isRelayApp = (() => { try { return new URLSearchParams(location.search).get('relayapp') === '1'; } catch (e) { return false; } })();
  const addOwnRelay = () => {
    const u = (relayAddr || '').trim(); if (!u) return;
    // addRelay RETURNS false for a malformed address, a duplicate, or this church's own relay — it never throws.
    // The version of this that shipped before treated every outcome as success, so a leader who typoed their
    // address saw a green tick and walked away believing their church was reachable there.
    const ok = window.Steward.addRelay ? window.Steward.addRelay(u) : false;
    if (ok) { setAddrMsg('✓ Added — your church now uses this relay too.'); setRelayAddr(''); }
    else setAddrMsg('✗ Couldn’t add that. Check it starts with wss:// and isn’t one you’ve already added.');
  };
  const phrase = (() => { try { return window.Steward.exportMnemonic() || ''; } catch { return ''; } })();
  const npub = church.npub || window.Steward.npub || '';
  // backup check: after they tick "written down", make them re-type 3 of the 12 words before continuing
  const words = phrase ? phrase.trim().split(/\s+/) : [];
  // The three positions are drawn at RANDOM each time the phrase is hidden, not fixed. They used to be
  // hardcoded to #3/#7/#11 — the same question for every church on earth, which is a pattern to learn rather
  // than a check. Re-drawn whenever the steward goes back to look at the phrase again, so re-reading it costs
  // a fresh question instead of handing over the answers.
  const [challenge, setChallenge] = React.useState([]);
  React.useEffect(() => {
    if (!saved || words.length < 12) return;
    const idx = []; let guard = 0;
    while (idx.length < 3 && guard++ < 200) { const r = Math.floor(Math.random() * words.length); if (!idx.includes(r)) idx.push(r); }
    setChallenge(idx.sort((a, b) => a - b));
  }, [saved, words.length]);
  const [vw, setVw] = React.useState(['', '', '']);
  const verified = challenge.length === 3 && challenge.every((pos, i) => vw[i].trim().toLowerCase() === (words[pos] || '').toLowerCase());
  // A phrase we cannot quiz (imported key, or fewer than 12 words) must not trap the steward: the challenge
  // effect early-returns in that case, so `verified` could never become true and Continue was dead forever.
  const canQuiz = words.length >= 12;
  const canContinue = !phrase || !canQuiz || (saved && verified);
  // step 2 — lock the church key on this device with a PIN (optional, strongly recommended)
  const [pinA, setPinA] = React.useState('');
  const [pinB, setPinB] = React.useState('');
  const [pinErr, setPinErr] = React.useState('');
  const [pinBusy, setPinBusy] = React.useState(false);
  const savePin = async () => {
    if (pinBusy) return;
    if ((pinA || '').length < 6) { setPinErr('Use at least 6 characters — a longer passphrase is stronger.'); return; }
    if (pinA !== pinB) { setPinErr('The two entries don’t match.'); return; }
    setPinBusy(true); setPinErr('');
    let ok = false; try { ok = await window.Steward.setPin(pinA); } catch (e) { ok = false; }
    setPinBusy(false);
    if (ok) next(); else setPinErr('Couldn’t set the PIN. Try again.');
  };
  const doRegister = async () => {
    if (!relayToken.trim()) return;
    setRelayBusy(true); setRelayMsg('Connecting…');
    try { await window.Steward.registerWithRelay(relayToken.trim(), name.trim() || church.name); setRelayMsg('✓ Registered — this relay will accept your church now.'); }
    catch (e) { setRelayMsg('✗ ' + (e.message || 'Couldn’t reach the relay.')); }
    setRelayBusy(false);
  };
  const next = () => setStep(s => s + 1);
  const fld = { width: '100%', boxSizing: 'border-box', height: 48, padding: '0 14px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 15.5, color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontWeight: 600 };
  const lbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 7 };

  const saveName = async () => { const n = name.trim(); if (n && n !== church.name) { setBusy(true); await Promise.resolve(window.Steward.publishProfile({ name: n, nip05: church.nip05 })); setBusy(false); } next(); };
  const saveGroups = async () => { const chosen = STARTERS.filter(s => picks.has(s.id)); if (chosen.length) { setBusy(true); for (const g of chosen) await Promise.resolve(window.Steward.publishGroup({ name: g.name, kind: g.kind, sub: g.sub })); setBusy(false); } next(); };
  const saveTeam = async () => { const t = teamName.trim(); if (t) { setBusy(true); await Promise.resolve(window.Steward.publishGroup({ name: t, kind: 'team', sub: 'Serving team' })); setBusy(false); } next(); };
  // Step 4 — the church's weekly rhythm. This step did not exist: the ONLY wizard that pre-filled Sunday
  // Service / Midweek was StewWizard, which renders solely with ?setup=1 and no key, so a real new church
  // finished setup with an EMPTY calendar and no hint that meetings were a thing. Reported by the owner
  // 2026-07-25 ("that doesn't look like it turned up in the test calendar").
  // WizMeetings is reused from stew-console.jsx — both files load into the same global scope, so this is the
  // same UI the other wizard used rather than a second one to keep in sync.
  const [meetings, setMeetings] = React.useState(() => ([
    { id: _wizMeetingId(), title: 'Sunday Service', day: 0, time: '10:00', recur: 'weekly' },
    { id: _wizMeetingId(), title: 'Midweek', day: 3, time: '19:30', recur: 'weekly' },
  ]));
  const [meetingErr, setMeetingErr] = React.useState('');
  const saveMeetings = async () => {
    const rows = meetings.filter(m => m.title.trim());
    if (!rows.length) { next(); return; }   // deliberately skipped — nothing to publish
    setBusy(true); setMeetingErr('');
    let failed = 0;
    try {
      // publishMeeting resolves null when no relay accepted. The previous version awaited it and advanced
      // regardless, so an offline or wrong-key relay produced exactly the empty calendar this step exists to
      // prevent — with the only signal a generic 9-second toast the steward was already scrolling past.
      for (const m of rows) {
        const r = await Promise.resolve(window.Steward.publishMeeting({ id: m.id, title: m.title.trim(), day: m.day, time: m.time, recur: m.recur }));
        if (!r) failed++;
      }
    } catch (e) { failed = rows.length; }
    finally { setBusy(false); }   // ALWAYS: `busy` is shared by every step's primary button, so leaving it set
                                  // disabled Continue AND Back AND the other steps — a silent, inescapable
                                  // wizard with no error text anywhere on screen.
    if (failed) { setMeetingErr(failed === rows.length
      ? 'Couldn’t save your meetings — the relay didn’t accept them. Check you’re online and try again; your rows are still here.'
      : `Saved ${rows.length - failed} of ${rows.length}. Try again to save the rest.`); return; }
    next();
  };

  if (step === 0) return (
    <WizShell step={step} title="Welcome to your console" sub="Let’s get your church set up — about a minute. First, what’s it called? Members see this name when they join."
      footer={<React.Fragment>
        <button onClick={onDone} className="sk-btn sk-btn--ghost" style={{ padding: '12px 16px' }}>Skip setup</button>
        <div style={{ flex: 1 }} />
        <button onClick={saveName} disabled={busy || !name.trim()} className="sk-btn sk-btn--clay" style={{ padding: '12px 20px', opacity: (busy || !name.trim()) ? .5 : 1 }}>Continue <Icon name="chevR" size={15} color="var(--on-clay)" /></button>
      </React.Fragment>}>
      <div style={lbl}>CHURCH NAME</div>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim()) saveName(); }} placeholder="Your church’s name" style={fld} />
    </WizShell>
  );

  if (step === 1) return (
    <WizShell step={step} title="Your church’s recovery key" sub="These 12 words ARE your church — they sign everything you post. Write them on paper and keep them safe: without them the church can’t be recovered, and no one (not even us) can reset it for you."
      footer={<React.Fragment>
        <button onClick={() => setStep(0)} className="sk-btn sk-btn--ghost" style={{ padding: '12px 16px' }}><Icon name="chevL" size={15} color="currentColor" /> Back</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => { if (canContinue) next(); }} disabled={!canContinue} className="sk-btn sk-btn--clay" style={{ padding: '12px 20px', opacity: canContinue ? 1 : .5 }}>Continue <Icon name="chevR" size={15} color="var(--on-clay)" /></button>
      </React.Fragment>}>
      <div style={lbl}>RECOVERY PHRASE — 12 WORDS</div>
      {/* The phrase and the check must NEVER share a screen. With the words still visible the "quick check" is
          copying from the box above — it proves nothing about what was written on paper, and it teaches the
          steward to click through the one ceremony standing between them and losing the church key for good.
          Ticking the box hides the phrase; going back to read it re-draws a different three. */}
      {!saved ? (<React.Fragment>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 14.5, lineHeight: 1.8, wordSpacing: 3, color: 'var(--ink)', background: 'color-mix(in oklab, var(--clay) 7%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, var(--line))', borderRadius: 12, padding: '14px 16px' }}>{phrase || 'No recovery phrase available for this key.'}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 2px' }}>
        {phrase ? <button onClick={() => { copyText(phrase); setKeyCopied(true); setTimeout(() => setKeyCopied(false), 1400); }} className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name={keyCopied ? 'check' : 'receipt'} size={14} color="currentColor" /> {keyCopied ? 'Copied' : 'Copy'}</button> : null}
        <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{npub.slice(0, 22)}…</span>
      </div>
      </React.Fragment>) : (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px', borderRadius: 12, background: 'var(--surface-2)', border: '1px dashed var(--line)' }}>
        <Icon name="lock" size={16} color="var(--ink-3)" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>
          {!canQuiz ? 'Recovery phrase hidden. (This key’s phrase is too short to check here — keep your written copy safe.)'
            : verified ? 'Recovery phrase hidden.' : 'Phrase hidden — answer from the paper copy you just wrote.'}
        </div>
        <button onClick={() => { setSaved(false); setVw(['', '', '']); }} className="sk-btn sk-btn--ghost" style={{ padding: '8px 12px', fontSize: 12.5, flexShrink: 0 }}>Show my words again</button>
      </div>
      )}
      {phrase && !saved ? (
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, cursor: 'pointer', fontSize: 13.5, fontWeight: 600 }}>
        <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--clay)' }} />
        I’ve written these 12 words on paper and stored them safely
      </label>
      ) : null}
      {phrase && saved ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 8, lineHeight: 1.5 }}>Quick check — type these three from your written list to confirm:</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {challenge.map((pos, i) => {
              const ok = !!vw[i] && vw[i].trim().toLowerCase() === (words[pos] || '').toLowerCase();
              return (
                <div key={pos} style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 700, marginBottom: 4 }}>WORD #{pos + 1}</div>
                  <input value={vw[i]} onChange={e => setVw(a => a.map((x, j) => (j === i ? e.target.value : x)))} autoComplete="off" spellCheck={false} autoCapitalize="none" style={{ ...fld, height: 42, fontWeight: 400, borderColor: ok ? 'var(--sage)' : 'var(--line)' }} />
                </div>
              );
            })}
          </div>
          {verified ? <div style={{ fontSize: 12.5, color: 'var(--sage)', marginTop: 7, fontWeight: 600 }}>✓ Got them — your church is safely backed up.</div>
            : vw.some(x => x.trim()) ? <div style={{ fontSize: 12.5, color: 'var(--clay)', marginTop: 7 }}>Not quite — check your written list.</div> : null}
        </div>
      ) : null}
      {!phrase ? (
      <div style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>This key was imported, so its recovery phrase isn’t shown here — keep the copy you set up with somewhere safe. You can continue.</div>
      ) : null}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        {!relayOpen ? (
          <button onClick={() => setRelayOpen(true)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-ui)', padding: 0 }}>Running your own relay? Connect it →</button>
        ) : (
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 9 }}>Paste your relay’s <b>admin token</b> — shown in the TrinityOne Suite window (or the installer output) — to register your church so the relay stops rejecting it.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={relayToken} onChange={e => setRelayToken(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doRegister(); }} type="password" placeholder="relay admin token" autoComplete="off" style={{ ...fld, height: 44, fontWeight: 400 }} />
              <button onClick={doRegister} disabled={relayBusy || !relayToken.trim()} className="sk-btn sk-btn--clay" style={{ padding: '0 16px', fontSize: 13, whiteSpace: 'nowrap', opacity: (relayBusy || !relayToken.trim()) ? .5 : 1 }}>Connect</button>
            </div>
            {relayMsg ? <div style={{ fontSize: 12.5, marginTop: 8, fontWeight: 600, color: relayMsg[0] === '✓' ? 'var(--sage)' : relayMsg[0] === '✗' ? 'var(--clay)' : 'var(--ink-3)' }}>{relayMsg}</div> : null}
            {/* Restores the capability lost when WizRelays was deleted with the second wizard: this panel took
                only an admin TOKEN (which registers the church ON a relay), with no way to tell the church which
                relay ADDRESS to publish to and read from. A church-in-a-box operator finished setup with their
                own relay running and the church still pointed only at the shared pool. Different jobs — a church
                self-hosting needs both. */}
            {isRelayApp ? (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                <b>This app is your relay.</b> Your church already publishes here — there’s nothing to connect.
              </div>
            ) : (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 9 }}>Have your relay’s <b>address</b>? Add it so your church publishes and reads there as well as on the shared relays.</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={relayAddr} onChange={e => setRelayAddr(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addOwnRelay(); }} placeholder="wss://relay.yourchurch.org" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ ...fld, height: 44, fontWeight: 400, fontFamily: 'var(--mono)', fontSize: 13 }} />
                  <button onClick={addOwnRelay} disabled={!relayAddr.trim()} className="sk-btn sk-btn--ghost" style={{ padding: '0 16px', fontSize: 13, whiteSpace: 'nowrap', opacity: relayAddr.trim() ? 1 : .5 }}>Add</button>
                </div>
                {addrMsg ? <div style={{ fontSize: 12.5, marginTop: 8, fontWeight: 600, color: addrMsg[0] === '✓' ? 'var(--sage)' : 'var(--clay)' }}>{addrMsg}</div> : null}
              </div>
            )}
          </div>
        )}
      </div>
    </WizShell>
  );

  if (step === 2) return (
    <WizShell step={step} title="Lock this device with a PIN" sub="Your 12 words live encrypted on this computer. A PIN adds a second lock: without it, anyone who picks up this laptop could open the console and post as your whole church. You’ll enter it when you open the console."
      footer={<React.Fragment>
        <button onClick={() => setStep(1)} className="sk-btn sk-btn--ghost" style={{ padding: '12px 16px' }}><Icon name="chevL" size={15} color="currentColor" /> Back</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => next()} className="sk-btn sk-btn--ghost" style={{ padding: '12px 16px' }}>Skip for now</button>
        <button onClick={savePin} disabled={pinBusy || !pinA || !pinB} className="sk-btn sk-btn--clay" style={{ padding: '12px 20px', opacity: (pinBusy || !pinA || !pinB) ? .5 : 1 }}>{pinBusy ? 'Setting…' : 'Set a PIN'} <Icon name="chevR" size={15} color="var(--on-clay)" /></button>
      </React.Fragment>}>
      <div style={lbl}>PIN OR PASSPHRASE</div>
      <input type="password" autoFocus value={pinA} onChange={e => { setPinA(e.target.value); setPinErr(''); }} placeholder="At least 6 characters" inputMode="numeric" autoComplete="new-password" style={fld} />
      <div style={{ ...lbl, marginTop: 12 }}>CONFIRM</div>
      <input type="password" value={pinB} onChange={e => { setPinB(e.target.value); setPinErr(''); }} onKeyDown={e => { if (e.key === 'Enter') savePin(); }} placeholder="Type it again" inputMode="numeric" autoComplete="new-password" style={fld} />
      {pinErr ? <div style={{ fontSize: 12.5, color: 'var(--clay)', marginTop: 9, fontWeight: 600 }}>{pinErr}</div> : null}
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 12, lineHeight: 1.5 }}>We can’t reset this for you — if you forget it, restore the church from your 12 words. You can add or change it later in <b>Settings → Security</b>.</div>
    </WizShell>
  );

  if (step === 3) return (
    <WizShell step={step} title="Create a few spaces" sub="Groups are chat rooms (or announcement channels) your members join. Pick a few to start — you can add or remove any time."
      footer={<React.Fragment>
        <button onClick={() => setStep(2)} className="sk-btn sk-btn--ghost" style={{ padding: '12px 16px' }}><Icon name="chevL" size={15} color="currentColor" /> Back</button>
        <div style={{ flex: 1 }} />
        <button onClick={saveGroups} disabled={busy} className="sk-btn sk-btn--clay" style={{ padding: '12px 20px', opacity: busy ? .5 : 1 }}>{picks.size ? `Create ${picks.size} & continue` : 'Skip for now'} <Icon name="chevR" size={15} color="var(--on-clay)" /></button>
      </React.Fragment>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {STARTERS.map(s => {
          const on = picks.has(s.id);
          return (
            <button key={s.id} onClick={() => toggle(s.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '13px 15px', borderRadius: 14, cursor: 'pointer', background: on ? 'color-mix(in oklab, var(--clay) 9%, var(--surface))' : 'var(--surface)', border: '1.5px solid ' + (on ? 'var(--clay)' : 'var(--line)'), fontFamily: 'var(--font-ui)' }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--clay)' : 'var(--surface-2)', color: on ? '#fff' : 'var(--ink-3)' }}><Icon name={s.kind === 'broadcast' ? 'send' : 'chat'} size={18} color="currentColor" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{s.name}{s.kind === 'broadcast' ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', marginLeft: 7 }}>Broadcast</span> : null}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{s.sub}</div>
              </div>
              <div style={{ width: 22, height: 22, borderRadius: 999, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--clay)' : 'transparent', border: on ? 'none' : '1.5px solid var(--line)' }}>{on ? <Icon name="check" size={14} color="var(--on-clay)" /> : null}</div>
            </button>
          );
        })}
      </div>
    </WizShell>
  );

  if (step === 4) return (
    <WizShell step={step} title="Your regular meetings" sub="Set your weekly rhythm. These fill the calendar automatically, so members always see what’s on — you can edit or add more any time from the Calendar tab."
      footer={<React.Fragment>
        <button onClick={() => setStep(3)} className="sk-btn sk-btn--ghost" style={{ padding: '12px 16px' }}><Icon name="chevL" size={15} color="currentColor" /> Back</button>
        <div style={{ flex: 1 }} />
        <button onClick={saveMeetings} disabled={busy} className="sk-btn sk-btn--clay" style={{ padding: '12px 20px', opacity: busy ? .5 : 1 }}>{meetings.filter(m => m.title.trim()).length ? `Add ${meetings.filter(m => m.title.trim()).length} & continue` : 'Skip for now'} <Icon name="chevR" size={15} color="var(--on-clay)" /></button>
      </React.Fragment>}>
      <WizMeetings meetings={meetings} setMeetings={setMeetings} />
      {meetingErr ? <div style={{ marginTop: 12, padding: '11px 13px', borderRadius: 11, background: 'color-mix(in oklab, var(--clay) 10%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 34%, transparent)', fontSize: 13, color: 'var(--ink)', lineHeight: 1.45 }}>{meetingErr}</div> : null}
    </WizShell>
  );

  if (step === 5) return (
    <WizShell step={step} title="Serving rota" sub="Teams are who serves on a Sunday — welcome, kids, sound, and so on. Start one now if you like, or set this up later in the Rota tab."
      footer={<React.Fragment>
        <button onClick={() => setStep(4)} className="sk-btn sk-btn--ghost" style={{ padding: '12px 16px' }}><Icon name="chevL" size={15} color="currentColor" /> Back</button>
        <div style={{ flex: 1 }} />
        <button onClick={saveTeam} disabled={busy} className="sk-btn sk-btn--clay" style={{ padding: '12px 20px', opacity: busy ? .5 : 1 }}>{teamName.trim() ? 'Create team & continue' : 'I’ll do this later'} <Icon name="chevR" size={15} color="var(--on-clay)" /></button>
      </React.Fragment>}>
      <div style={lbl}>FIRST TEAM (OPTIONAL)</div>
      <input value={teamName} onChange={e => setTeamName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveTeam(); }} placeholder="e.g. Welcome Team" style={fld} />
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 10, lineHeight: 1.5 }}>You’ll add who’s on the team and build the schedule from the Rota tab.</div>
    </WizShell>
  );

  return (
    <WizShell step={step} title="You’re all set 🎉" sub="Your church is live. Hand members a joining code from “Invite code”, and post your first note any time."
      footer={<React.Fragment>
        <div style={{ flex: 1 }} />
        <button onClick={() => { if (onTab) onTab('overview'); onDone(); }} className="sk-btn sk-btn--clay" style={{ padding: '12px 22px' }}><Icon name="check" size={16} color="var(--on-clay)" /> Go to dashboard</button>
      </React.Fragment>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {[
          ['qr', 'Share a joining code', 'Invite members with a QR or short code.', () => { if (onDone) onDone(); if (onInvite) onInvite(); }],
          ['send', 'Post a note', 'Reach your whole church from “New post”.', () => { if (onDone) onDone(); if (onNewPost) onNewPost(); }],
          ['globe', 'Relays & settings', 'Manage relays, video & audio in Settings.', () => { if (onTab) onTab('settings'); if (onDone) onDone(); }],
        ].map(([ic, t, d, act]) => (
          <button key={t} onClick={act} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'var(--font-ui)' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', color: 'var(--clay)' }}><Icon name={ic} size={17} color="currentColor" /></div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink)' }}>{t}</div><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{d}</div></div>
            <Icon name="chevR" size={16} color="var(--ink-3)" />
          </button>
        ))}
      </div>
    </WizShell>
  );
}

// in-app QR scanner for the steward console (camera + BarcodeDetector; jsQR fallback for Android WebView).
// Calls onResult(text) with the decoded QR; degrades gracefully with no camera/detector.
function StewQRScanner({ onResult, onCancel }) {
  const vref = React.useRef(null);
  const [status, setStatus] = React.useState('starting');
  React.useEffect(() => {
    let stream, raf, stopped = false, detector = null, canvas = null, cctx = null;
    const hasBD = ('BarcodeDetector' in window);
    (async () => {
      try {
        if (window.ensureJsQR) { try { await window.ensureJsQR(); } catch (e) {} }   // fetch the ~251 KB decoder on demand, not on every cold start
        const hasJsQR = (typeof window.jsQR === 'function');
        const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        if (!isNative) { setStatus('unsupported'); return; }   // camera scanning is app-only; in a browser there's no good camera, so paste the code/phrase instead
        if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || (!hasBD && !hasJsQR)) { setStatus('unsupported'); return; }
        if (hasBD) { try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; } }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        const v = vref.current; if (!v) return;
        v.srcObject = stream; v.setAttribute('playsinline', ''); v.muted = true; await v.play();
        setStatus('scanning');
        const tick = async () => {
          if (stopped) return;
          try {
            if (detector) { const codes = await detector.detect(v); if (codes && codes.length && codes[0].rawValue) { onResult(codes[0].rawValue); return; } }
            else if (v.videoWidth) {
              if (!canvas) { canvas = document.createElement('canvas'); cctx = canvas.getContext('2d', { willReadFrequently: true }); }
              canvas.width = v.videoWidth; canvas.height = v.videoHeight; cctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = cctx.getImageData(0, 0, canvas.width, canvas.height);
              const res = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              if (res && res.data) { onResult(res.data); return; }
            }
          } catch (e) {}
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) { setStatus('error'); }
    })();
    return () => { stopped = true; if (raf) cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); };
  }, []);
  if (status === 'unsupported' || status === 'error') {
    return (
      <div style={{ borderRadius: 14, background: 'color-mix(in oklab, var(--clay) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, var(--line))', padding: 16, textAlign: 'center' }}>
        <Icon name="qr" size={24} color="var(--clay)" />
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '8px 0 12px' }}>{status === 'unsupported' ? 'This device can’t scan here — paste the phrase instead.' : 'Couldn’t open the camera. Allow access, or paste the phrase.'}</p>
        <button onClick={onCancel} className="sk-btn sk-btn--ghost" style={{ padding: '8px 14px', fontSize: 13 }}>Back</button>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: '#000', aspectRatio: '1 / 1', maxWidth: 320, margin: '0 auto' }}>
      <video ref={vref} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      <div style={{ position: 'absolute', inset: '16%', border: '3px solid rgba(255,255,255,.92)', borderRadius: 16 }} />
      <div style={{ position: 'absolute', top: 10, left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 12.5, fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,.6)' }}>{status === 'starting' ? 'Starting camera…' : 'Point at the handoff QR'}</div>
      <button onClick={onCancel} style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', border: 'none', background: 'rgba(0,0,0,.55)', color: '#fff', borderRadius: 999, padding: '7px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-ui)' }}>Cancel</button>
    </div>
  );
}
window.StewQRScanner = StewQRScanner;

function StewDashboard({ initial = 'overview' }) {
  const [tab, setTab] = React.useState(initial);
  const [settingsSection, setSettingsSection] = React.useState(null);   // deep-link a Settings sub-tab (e.g. relay → network)
  const [settingsIntent, setSettingsIntent] = React.useState(null);     // a one-shot action within that sub-tab (e.g. open the Set-PIN dialog)
  const openSettings = (section = null, intent = null) => { setSettingsSection(section); setSettingsIntent(intent); setTab('settings'); };
  const [invite, setInvite] = React.useState(new URLSearchParams(location.search).get('invite') === '1');
  const [posting, setPosting] = React.useState(new URLSearchParams(location.search).get('newpost') === '1');
  const [addingTeam, setAddingTeam] = React.useState(false);
  const church = window.useStewardChurch();   // real church profile + npub from the relay
  // double-entry Finance module — church-key console ONLY. Under a delegated steward's key encPublish
  // signs/encrypts with the wrong key and carries no ['church'] tag, so the relay rejects every write and
  // encSubscribe returns nothing → the book silently re-seeds empty on reload (data loss). Hide it until
  // the delegated-steward finance path exists. (audit 2026-07-06 #3)
  const finOn = !!window.DashFinance && !(window.Steward && window.Steward.actingChurch);
  const mannaOn = false;   // Manna LOCKED for the pilot — not ready to surface yet (was: window.useMannaSettings ? !!window.useMannaSettings().enabled : false)
  const mealsOn = window.useMealsSettings ? !!window.useMealsSettings().enabled : false;   // optional meal-trains / care module
  const checkinOn = !!(church.features && church.features.checkin === true);   // opt-in kids check-in
  const nav = React.useMemo(() => {
    const copy = NAV.slice();
    const at = () => { const i = copy.findIndex(n => n.key === 'settings'); return i < 0 ? copy.length : i; };
    if (checkinOn) copy.splice(at(), 0, { key: 'checkin', label: 'Check-in', ic: 'child' });
    if (finOn) copy.splice(at(), 0, { key: 'finance', label: 'Finance', ic: 'gift' });
    if (mannaOn) copy.splice(at(), 0, { key: 'manna', label: 'Manna', ic: 'hand' });
    if (mealsOn) copy.splice(at(), 0, { key: 'meals', label: 'Care', ic: 'heart' });
    return copy;
  }, [finOn, mannaOn, mealsOn, checkinOn]);
  const churchName = church.name || 'Your Church';
  const initials = (church.name ? church.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'TO').toUpperCase();
  // once the church name resolves, re-run self-registration so the pool relays store the readable name
  React.useEffect(() => { if (church.name && window.Steward.selfRegister) window.Steward.selfRegister(church.name).catch(() => {}); }, [church.name]);
  const [renaming, setRenaming] = React.useState(false);   // styled rename dialog (replaces window.prompt)
  const editName = () => setRenaming(true);
  // responsive: a phone/narrow window collapses the desktop sidebar into a top header + scrollable nav
  const [vw, setVw] = React.useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  React.useEffect(() => { const f = () => setVw(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const narrow = vw < 760;

  // first-run wizard: shown only when THIS device created THIS church (`newchurch`, set by seedNewChurch) and
  // setup hasn't been completed or skipped. It used to infer "fresh church" from the name still being empty
  // 1.8s after mount, which is a guess about relay latency — wrong on 2G, and since this wizard now publishes
  // the church's meetings, an established church that tripped it gained duplicate Sunday Service / Midweek
  // events that can never replace the originals. The restore / adopt / become-steward paths all set
  // `wizard.done`, so they were already covered; this closes the case where a real church simply loads slowly.
  // The name check and the 1.8s wait are kept as belt-and-braces: never show it over a church that has a name.
  const [wizard, setWizard] = React.useState(false);
  const nameRef = React.useRef(church.name);
  nameRef.current = church.name;
  React.useEffect(() => {
    let done = true, isNew = false;
    try {
      done = localStorage.getItem('trinityone.steward.wizard.done') === '1';
      isNew = localStorage.getItem('trinityone.steward.newchurch') === '1';
    } catch {}
    if (done || !isNew || church.isNetwork) return;
    const t = setTimeout(() => { if (!nameRef.current) setWizard(true); }, 1800);
    return () => clearTimeout(t);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const finishWizard = () => { try { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); } catch {} setWizard(false); };
  // the church's brand accent (a hex) recolours the whole console too, derived from the one hex
  const ca = (typeof church.accent === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(church.accent.trim())) ? church.accent.trim() : null;
  const accentStyle = ca ? {
    '--clay': ca,
    '--clay-ink': `color-mix(in oklab, ${ca} 86%, #000)`,
    '--clay-soft': `color-mix(in oklab, ${ca} 16%, #fff)`,
    '--clay-deep': `color-mix(in oklab, ${ca} 74%, #000)`,
  } : null;

  // tab content + topbar actions, shared by both layouts
  const content = (
    <React.Fragment>
      {tab === 'overview' && <DashOverview onTab={setTab} onSettings={openSettings} onNewPost={() => setPosting(true)} />}
      {tab === 'giving' && <DashGiving />}
      {tab === 'groups' && <DashGroups />}
      {tab === 'rota' && <DashRota onNewTeam={() => setAddingTeam(true)} />}
      {tab === 'calendar' && <DashCalendar />}
      {tab === 'rooms' && <DashRooms />}
      {tab === 'resources' && <DashResources />}
      {tab === 'members' && <DashMembers />}
      {tab === 'checkin' && <DashCheckin />}
      {tab === 'finance' && <DashFinance />}
      {tab === 'manna' && <DashManna />}
      {tab === 'meals' && <DashMeals />}
      {tab === 'settings' && <DashSettings onTab={setTab} initialSection={settingsSection} initialIntent={settingsIntent} onSectionConsumed={() => { setSettingsSection(null); setSettingsIntent(null); }} />}
    </React.Fragment>
  );
  const actions = (
    <React.Fragment>
      <button onClick={() => setInvite(true)} title="Show your church’s joining code and QR for new members" className="sk-btn sk-btn--ghost" style={{ padding: narrow ? '8px 10px' : '9px 14px', fontSize: 13 }}><Icon name="qr" size={15} color="currentColor" /> {narrow ? '' : 'Invite code'}</button>
      {tab === 'rota'
        ? <button onClick={() => setAddingTeam(true)} title="Create a new serving team" className="sk-btn sk-btn--clay" style={{ padding: narrow ? '8px 10px' : '9px 14px', fontSize: 13 }}><Icon name="plus" size={15} color="var(--on-clay)" /> {narrow ? '' : 'New team'}</button>
        : <button onClick={() => setPosting(true)} title="Write a new post for your church" className="sk-btn sk-btn--clay" style={{ padding: narrow ? '8px 10px' : '9px 14px', fontSize: 13 }}><Icon name="send" size={15} color="var(--on-clay)" /> {narrow ? '' : 'New post'}</button>}
      <button onClick={() => setTab('settings')} title="Settings" style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', borderRadius: 11 }}><SkBadge initials={initials} picture={church.picture} size={narrow ? 32 : 36} radius={999} accent="var(--sage)" /></button>
    </React.Fragment>
  );

  if (narrow) {
    return (
      <ConsoleChrome accentStyle={accentStyle}>
        {invite ? <JoinModal onClose={() => setInvite(false)} /> : null}
        {posting ? <NewPostModal onClose={() => setPosting(false)} /> : null}
        <NewTeamModal open={addingTeam} onClose={() => setAddingTeam(false)} />
        <MemberChatDock />
        <PublishErrorBanner /><JoinNotifier /><KeyDistributor />
        {wizard ? <StewSetupWizard church={church} onTab={setTab} onDone={finishWizard} onInvite={() => setInvite(true)} onNewPost={() => setPosting(true)} /> : null}
        {renaming ? <NameEditModal current={church.name} isNetwork={church.isNetwork} onSave={(n) => Promise.resolve(window.Steward.publishProfile({ name: n, nip05: church.nip05 }))} onClose={() => setRenaming(false)} /> : null}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
          <div style={{ flexShrink: 0, background: church.isNetwork ? 'color-mix(in oklab, var(--clay) 7%, var(--surface))' : 'var(--surface)', borderBottom: '1px solid var(--line)', padding: '10px 12px 8px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Halo size={22} color="var(--ink)" spark="var(--clay)" />
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15 }}>Trinity<span style={{ color: 'var(--clay)' }}>One</span></span>
              <div style={{ flex: 1 }} />
              {actions}
            </div>
            <IdentitySwitcher church={church} churchName={churchName} initials={initials} onEditName={editName} />
            {/* tabs WRAP onto multiple rows rather than scrolling sideways (no awkward horizontal scroll) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {nav.map(n => {
                const on = n.key === tab;
                return (
                  <button key={n.key} onClick={() => setTab(n.key)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 999, border: '1px solid ' + (on ? 'var(--clay)' : 'var(--line)'), cursor: 'pointer', whiteSpace: 'nowrap', background: on ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface)', color: on ? 'var(--clay-ink)' : 'var(--ink-2)', fontWeight: 700, fontSize: 12.5, fontFamily: 'var(--font-ui)' }}>
                    <Icon name={n.ic} size={14} color={on ? 'var(--clay)' : 'var(--ink-3)'} /> {n.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px 12px 24px', background: 'var(--paper)' }}>
            {content}
          </div>
        </div>
      </ConsoleChrome>
    );
  }

  return (
    <ConsoleChrome accentStyle={accentStyle}>
      {invite ? <JoinModal onClose={() => setInvite(false)} /> : null}
      {posting ? <NewPostModal onClose={() => setPosting(false)} /> : null}
      <NewTeamModal open={addingTeam} onClose={() => setAddingTeam(false)} />
      <MemberChatDock />
        <PublishErrorBanner /><JoinNotifier /><KeyDistributor />
        {wizard ? <StewSetupWizard church={church} onTab={setTab} onDone={finishWizard} onInvite={() => setInvite(true)} onNewPost={() => setPosting(true)} /> : null}
        {renaming ? <NameEditModal current={church.name} isNetwork={church.isNetwork} onSave={(n) => Promise.resolve(window.Steward.publishProfile({ name: n, nip05: church.nip05 }))} onClose={() => setRenaming(false)} /> : null}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'var(--paper)' }}>
        {/* sidebar */}
        <div style={{ width: 232, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', padding: '22px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 8px', marginBottom: 22 }}>
            <Halo size={26} color="var(--ink)" spark="var(--clay)" />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17 }}>Trinity<span style={{ color: 'var(--clay)' }}>One</span></span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.5px', color: 'var(--ink-3)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 6px', marginLeft: 'auto' }}>STEWARD</span>
          </div>
          <IdentitySwitcher church={church} churchName={churchName} initials={initials} onEditName={editName} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {nav.map(n => {
              const on = n.key === tab;
              return (
                <button key={n.key} onClick={() => setTab(n.key)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 11, border: 'none', cursor: 'pointer', textAlign: 'left', background: on ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'transparent', color: on ? 'var(--clay-ink)' : 'var(--ink-2)', fontWeight: on ? 700 : 600, fontSize: 14.5, fontFamily: 'var(--font-ui)' }}>
                  <Icon name={n.ic} size={19} color={on ? 'var(--clay)' : 'var(--ink-3)'} /> {n.label}
                </button>
              );
            })}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 12px', borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 10%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 24%, transparent)' }}>
            <Icon name="lock" size={16} color="var(--sage)" />
            <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>Key on this device</div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{(window.Steward.hasPinLock && window.Steward.hasPinLock()) ? 'Stored locally · locked' : <React.Fragment>Stored locally · <span onClick={() => openSettings('security', 'pin')} style={{ color: 'var(--clay-ink)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>lock with a PIN</span></React.Fragment>}</div></div>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--sage)' }} />
          </div>
          {/* In the desktop Suite (served from loopback), this box IS the relay — give a one-click door back to the
              relay panel / launcher so stewards don't have to dig through Settings. Hidden on the hosted web console (a8). */}
          {typeof location !== 'undefined' && ['localhost', '127.0.0.1', '0.0.0.0'].includes(location.hostname) && (
            <a href="/relay-app/home.html" title="Relay & Suite controls" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '10px 12px', marginTop: 10, borderRadius: 11, border: '1px solid var(--line)', textDecoration: 'none', background: 'var(--surface)', color: 'var(--ink-2)', fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-ui)' }}>
              <Icon name="grid2" size={18} color="var(--ink-3)" /> Relay &amp; Suite home
            </a>
          )}
        </div>

        {/* main */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* topbar */}
          <div style={{ height: 64, flexShrink: 0, borderBottom: '1px solid var(--line)', background: church.isNetwork ? 'color-mix(in oklab, var(--clay) 7%, var(--surface))' : 'var(--surface)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: 16 }}>
            <div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20 }}>{(nav.find(n => n.key === tab) || {}).label || ''}</div></div>
            {church.isNetwork ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, letterSpacing: '.3px', color: 'var(--clay-ink)', background: 'var(--clay-soft)', borderRadius: 999, padding: '5px 11px' }}><Icon name="globe" size={13} color="var(--clay)" /> Network view · {churchName}</span> : null}
            <div style={{ flex: 1 }} />
            {actions}
          </div>
          {/* content */}
          <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 28, background: 'var(--paper)' }}>
            {content}
          </div>
        </div>
      </div>
    </ConsoleChrome>
  );
}

// ---- the join flow: a real QR + code members scan/paste to follow this church ----
function shortNpub(np) { return np ? np.slice(0, 14) + '…' + np.slice(-6) : '—'; }
// the resolvable handle local-part: the NIP-05 local part if it's a real "local@domain", else a slug of
// the display name (the relay resolves either way). A pasted URL has no '@', so it falls back to the name
// slug — never surfaces "http…" junk. '' only when there's no name at all.
function handleLocal(nip05, name) {
  const slug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '').slice(0, 30);
  const n5 = String(nip05 || '');
  return n5.includes('@') ? slug(n5.split('@')[0]) : slug(name);
}
function nameHandle(m) { return m ? handleLocal(m.nip05, m.name) : ''; }
// a church's resolvable joining handle, e.g. "@yourchurch"
function churchHandle(church) { const l = church ? handleLocal(church.nip05, church.name) : ''; return l ? '@' + l : ''; }
function copyText(t) {
  if (!t) return false;
  // hidden-textarea execCommand copy — works in a non-secure context (plain http on the LAN, where
  // navigator.clipboard is undefined) AND when clipboard.writeText is denied (no user gesture / permission).
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = String(t); ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.left = '-9999px'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, String(t).length);
      const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
    } catch (e) { return false; }
  };
  // clipboard.writeText returns a PROMISE that rejects ASYNC (permission denied / no gesture) — a plain
  // try/catch can't catch that, so attach .catch() and fall back, else it's an unhandled rejection.
  try { if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(String(t)).catch(fallback); return true; } } catch (e) {}
  return fallback();
}

// The printable paper invite (church QR + steps + blank recovery-phrase grid) is generated on demand
// by window.TrinityTemplates.printInviteSheet — see stew-templates.jsx. Wired into "Print invite" below.

// rasterise an SVG string to a PNG data URI (jsPDF can't embed SVG directly). Force explicit pixel
// dims so it renders even when the source SVG is scalable (width/height 100%).
function svgToPng(svgStr, size) {
  return new Promise((resolve, reject) => {
    try {
      const sized = String(svgStr)
        .replace(/(<svg[^>]*?)\swidth="[^"]*"/i, '$1').replace(/(<svg[^>]*?)\sheight="[^"]*"/i, '$1')
        .replace(/<svg/i, '<svg width="' + size + '" height="' + size + '"');
      const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = size; c.height = size;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        URL.revokeObjectURL(url); resolve(c.toDataURL('image/png'));
      };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    } catch (e) { reject(e); }
  });
}

// SECURITY (anti-beacon, mirrors app/screens-church.jsx safeImgUrl): only ever embed a data: image, NEVER
// fetch a remote URL. church.picture is UNTRUSTED relay-published content; loading a URL here (img.src=url)
// would leak the steward's IP/geo/online-time — the exact persecuted-church deanonymisation the app forbids
// everywhere else. A non-data src returns null; churchMarkDataUrl then falls back to the initials badge.
function invImgDataUrl(src) {
  return Promise.resolve(/^data:image\//i.test(String(src || '')) ? String(src) : null);
}
// The church's "mark" (its display picture) as a raster data: URI for embedding in <img> or jsPDF: the
// uploaded dp if there is one, else the SAME initials-on-accent badge the app shows — so an artifact always
// carries the church's mark exactly as it appears in-app, even when no photo was uploaded.
async function churchMarkDataUrl({ picture, name, accent } = {}) {
  const pic = await invImgDataUrl(picture);
  if (pic) return pic;
  const initials = (String(name || '').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase()) || 'CH';
  const acc = (typeof accent === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(accent.trim())) ? accent.trim() : '#b4462f';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#ffffff"/><circle cx="60" cy="60" r="60" fill="' + acc + '"/><text x="60" y="76" font-family="Georgia, serif" font-size="46" fill="#ffffff" text-anchor="middle">' + initials.replace(/[<>&]/g, '') + '</text></svg>';
  try { return await svgToPng(svg, 240); } catch (e) { return null; }
}
// build the printable invite as a real PDF (A4) — CHURCH-branded (name + accent + logo), then QR + steps.
async function buildInvitePdf({ name, url, svg, accent, logo }) {
  const J = window.jspdf && window.jspdf.jsPDF; if (!J) return null;
  const doc = new J({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), M = 56; let y = 66;
  const nm = name || 'your church';
  // church brand accent → rgb (falls back to TrinityOne clay when unset); the church is the hero, TO the footer.
  const hx = String(accent || '').match(/^#?([0-9a-fA-F]{6})$/) || String(accent || '').match(/^#?([0-9a-fA-F]{3})$/);
  let ar = 184, ag = 82, ab = 52;
  if (hx) { let h = hx[1]; if (h.length === 3) h = h.split('').map(c => c + c).join(''); ar = parseInt(h.slice(0, 2), 16); ag = parseInt(h.slice(2, 4), 16); ab = parseInt(h.slice(4, 6), 16); }
  // the heading prints as accent-coloured text on white paper — darken a too-pale brand colour so "Join …" stays legible
  { const lum = (0.2126 * ar + 0.7152 * ag + 0.0722 * ab) / 255; if (lum > 0.62) { const k = 0.62 / lum; ar = Math.round(ar * k); ag = Math.round(ag * k); ab = Math.round(ab * k); } }
  if (logo) { try { const ls = 58; doc.addImage(logo, 'PNG', (W - ls) / 2, y - 8, ls, ls); y += ls + 8; } catch (e) {} }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.setTextColor(ar, ag, ab);
  doc.text(doc.splitTextToSize('Join ' + nm, W - 2 * M), W / 2, y, { align: 'center' }); y += 26;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(150, 140, 124);
  doc.text('on TrinityOne', W / 2, y, { align: 'center', charSpace: 1 }); y += 20;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(107, 96, 82);
  doc.text(doc.splitTextToSize('A private, offline-first place to read and belong — no sign-up, no tracking.', W - 2 * M), W / 2, y, { align: 'center' }); y += 26;
  try { const png = await svgToPng(svg, 600); const qs = 168; doc.addImage(png, 'PNG', (W - qs) / 2, y, qs, qs); y += qs + 16; } catch (e) { y += 6; }
  doc.setFontSize(10.5); doc.setTextColor(120, 110, 95);
  doc.text('Scan with a phone camera, or go to:', W / 2, y, { align: 'center' }); y += 14;
  doc.setFont('courier', 'normal'); doc.setFontSize(8); doc.setTextColor(90, 80, 70);
  const ul = doc.splitTextToSize(url, W - 2 * M); doc.text(ul, W / 2, y, { align: 'center' }); y += ul.length * 10 + 16;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(60, 52, 44);
  [['1.', 'Open your phone camera and point it at the code (or type the link).'],
   ['2.', 'Tap Add to Home Screen / Install so it works offline.'],
   ['3.', 'It opens already following ' + nm + '. Set your name so your church family recognises you — you can stay private if you need to.'],
   ['4.', 'When asked, write your 12-word recovery phrase in the boxes below.']].forEach(([n, s]) => {
    const l = doc.splitTextToSize(s, W - 2 * M - 18); doc.text(n, M, y); doc.text(l, M + 18, y); y += l.length * 13 + 4;
  });
  y += 8;
  const warn = doc.splitTextToSize('Keep your recovery phrase safe — it is the only way to restore your account on a new phone. No one, not even your church, can recover it for you. Never share it.', W - 2 * M - 20);
  const wh = warn.length * 12 + 16; doc.setDrawColor(206, 124, 92); doc.setFillColor(250, 242, 238);
  doc.roundedRect(M, y, W - 2 * M, wh, 6, 6, 'FD'); doc.setFontSize(9.5); doc.setTextColor(80, 70, 60);
  doc.text(warn, M + 10, y + 14); y += wh + 20;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(34, 28, 22);
  doc.text('My 12-word recovery phrase', M, y); y += 18;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120, 110, 95);
  const colW = (W - 2 * M - 24) / 2, rowH = 27, sy = y;
  for (let i = 0; i < 12; i++) {
    const x = M + (i % 2) * (colW + 24), ly = sy + Math.floor(i / 2) * rowH;
    doc.text(String(i + 1) + '.', x, ly); doc.setDrawColor(172, 162, 147); doc.line(x + 20, ly + 2, x + colW, ly + 2);
  }
  doc.setFontSize(8.5); doc.setTextColor(150, 140, 124);
  doc.text('TrinityOne · your church, in your hands', W / 2, 812, { align: 'center' });
  return doc;
}

// Print/PDF a generated HTML document without trapping the steward. Desktop: a new tab (window.open).
// In the Capacitor app a chrome-less window.open() traps the user (no back/chrome), so render the doc in
// an in-app overlay (iframe) with Print + Close, hardware-back wired to close. (Same lesson as the poster.)
window.skPrintable = function (html) {
  var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (!isNative) {
    var w = window.open('', '_blank');
    if (w) { try { w.document.write(html); w.document.close(); } catch (e) {} return; }
    // popup blocked → fall through to the in-app overlay
  }
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#fff;display:flex;flex-direction:column';
  var bar = document.createElement('div');
  bar.style.cssText = 'flex:0 0 auto;display:flex;gap:8px;align-items:center;padding:9px 12px;background:#f4efe6;border-bottom:1px solid #e9e1d4;font:600 14px system-ui,sans-serif;color:#1b1714';
  var lbl = document.createElement('span'); lbl.textContent = isNative ? 'Save or send this document' : 'Print or save as PDF'; lbl.style.flex = '1';
  var pr = document.createElement('button'); pr.textContent = isNative ? 'Save / Share' : 'Print / PDF'; pr.style.cssText = 'font:700 13px system-ui;background:#b4533f;color:#fff;border:0;border-radius:8px;padding:8px 13px';
  var cl = document.createElement('button'); cl.textContent = 'Close'; cl.style.cssText = 'font:700 13px system-ui;background:#fff;color:#1b1714;border:1px solid #d8cfbf;border-radius:8px;padding:8px 13px';
  var fr = document.createElement('iframe'); fr.style.cssText = 'flex:1;width:100%;border:0;background:#fff';
  bar.appendChild(lbl); bar.appendChild(pr); bar.appendChild(cl); ov.appendChild(bar); ov.appendChild(fr);
  document.body.appendChild(ov);
  try { fr.srcdoc = html; } catch (e) { try { fr.contentWindow.document.write(html); fr.contentWindow.document.close(); } catch (e2) {} }
  // overlay is native-only (desktop uses the new tab above) → reliable Close + hardware-back; no history games.
  var sub;
  var close = function () { try { ov.remove(); } catch (e) {} try { sub && sub.remove && sub.remove(); } catch (e) {} };
  try { var AP = window.Capacitor && window.Capacitor.Plugins; if (AP && AP.App && AP.App.addListener) sub = AP.App.addListener('backButton', close); } catch (e) {}
  cl.onclick = close;
  // window.print() is a no-op in the Capacitor webview, so on the phone we write the doc to a file and
  // hand it to the OS share sheet (Drive, a browser, email…) where it can be opened, printed, or saved.
  pr.onclick = async function () {
    try {
      var P = window.Capacitor && window.Capacitor.Plugins;
      if (P && P.Filesystem && P.Share) {
        var fname = 'trinityone-' + Date.now() + '.html';
        var res = await P.Filesystem.writeFile({ path: fname, data: html, directory: 'Cache', encoding: 'utf8' });
        await P.Share.share({ title: 'TrinityOne document', text: 'Open in a browser to print or save as PDF.', files: [res.uri] });
        return;
      }
    } catch (e) {}
    try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { try { window.print(); } catch (e2) {} }
  };
};

// On-theme confirm dialog (replaces the browser's native window.confirm, which looks off-brand).
function SkConfirm({ icon, tint, title, body, confirmLabel, onConfirm, onCancel }) {
  const t = tint || 'var(--clay)';
  const dlgRef = useStewDialog(onCancel);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 220, background: 'rgba(40,32,24,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, animation: 'lumenFade .16s ease both' }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: '94%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26, animation: 'lumenScale .2s ease both', outline: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 9 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'color-mix(in oklab, ' + t + ' 14%, var(--surface))', color: t, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={icon || 'lock'} size={21} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, lineHeight: 1.15 }}>{title}</div>
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 20px' }}>{body}</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 13, fontSize: 14 }}>Cancel</button>
          <button onClick={onConfirm} className="sk-btn" style={{ flex: 1, padding: 13, fontSize: 14, background: t, color: '#fff' }}>{confirmLabel || 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}
window.SkConfirm = SkConfirm;

// In-app invite poster. Replaces a window.open() print popup that TRAPPED the steward in the Capacitor
// webview (chrome-less window, hardware back did nothing). This is a normal in-app overlay: X / Done /
// backdrop close it, and the hardware back button closes it too (Capacitor App + popstate).
function InvitePosterModal({ church, url, svg, onClose }) {
  React.useEffect(() => {
    try { history.pushState({ inviteposter: 1 }, ''); } catch (e) {}
    const onPop = () => onClose();
    window.addEventListener('popstate', onPop);
    let sub;
    try { const P = window.Capacitor && window.Capacitor.Plugins; if (P && P.App && P.App.addListener) sub = P.App.addListener('backButton', () => onClose()); } catch (e) {}
    // print just the poster card (window.print prints the page; this hides everything else). Works in
    // the Capacitor webview too — Android's print dialog can Save as PDF — with no trapping popup.
    const style = document.createElement('style');
    style.textContent = '@media print {'
      + ' body * { visibility: hidden !important; }'
      + ' .invite-poster, .invite-poster * { visibility: visible !important; }'
      + ' .invite-poster { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; max-width: none !important; margin: 0 !important; border: none !important; box-shadow: none !important; background: #fff !important; padding: 28px !important; }'
      + ' .invite-poster .no-print { display: none !important; } }';
    document.head.appendChild(style);
    return () => { window.removeEventListener('popstate', onPop); try { sub && sub.remove && sub.remove(); } catch (e) {} try { document.head.removeChild(style); } catch (e) {} };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // window.print() is a no-op in the Capacitor webview (Android doesn't wire it up), so on the phone the
  // useful action is Share — send the join link. The printable paper sheet (with the recovery grid) is a
  // desktop/web task, where window.print() works.
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const shareInvite = async () => {
    const msg = 'Join ' + (church.name || 'our church') + ' on TrinityOne — a private, offline-first place to read and belong. Open this on your phone:\n' + url;
    try {
      const Share = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
      if (Share) { await Share.share({ title: 'Join ' + (church.name || 'our church'), text: msg, url, dialogTitle: 'Share invite' }); return; }
      if (navigator.share) { await navigator.share({ title: 'Join ' + (church.name || 'our church'), text: msg, url }); return; }
    } catch (e) {}
    try { copyText(url); } catch (e) {}   // last resort: copy the link
  };
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const savePdf = async () => {
    setPdfBusy(true);
    try {
      const logo = await churchMarkDataUrl({ picture: church.picture, name: church.name, accent: church.accent });   // dp, or the initials badge
      const doc = await buildInvitePdf({ name: church.name, url, svg, accent: church.accent, logo });
      if (!doc) { window.print(); return; }   // jsPDF missing → fall back to browser print
      const fname = 'TrinityOne-invite-' + ((church.name || 'church').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'church') + '.pdf';
      if (isNative) {
        const b64 = doc.output('datauristring').split(',')[1];
        const P = window.Capacitor.Plugins;
        try {
          const res = await P.Filesystem.writeFile({ path: fname, data: b64, directory: 'Cache' });
          await P.Share.share({ title: fname, text: 'Invite to ' + (church.name || 'our church'), files: [res.uri], dialogTitle: 'Save or share invite PDF' });
        } catch (e) {
          // file-share unsupported on this device → share the link instead so it's not a dead button
          try { await P.Share.share({ title: 'Join ' + (church.name || 'our church'), text: 'Join us on TrinityOne:\n' + url, url }); } catch (e2) {}
        }
      } else {
        doc.save(fname);
      }
    } catch (e) {} finally { setPdfBusy(false); }
  };
  const lineBox = { display: 'flex', alignItems: 'baseline', gap: 7 };
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 120, background: 'color-mix(in oklab, var(--ink) 45%, transparent)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '22px 16px' }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={'Join ' + (church.name || 'your church')} tabIndex={-1} className="invite-poster" onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: '100%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26, position: 'relative', margin: 'auto', outline: 'none' }}>
        <button onClick={onClose} title="Close" className="no-print" style={{ position: 'absolute', top: 13, right: 13, border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 999, width: 34, height: 34, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-2)' }}><Icon name="x" size={18} color="currentColor" /></button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.6px', color: 'var(--clay)', marginBottom: 8 }}>TRINITYONE</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, lineHeight: 1.1, marginBottom: 8 }}>Join {church.name || 'your church'}</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 16, maxWidth: 320, marginLeft: 'auto', marginRight: 'auto' }}>A private, offline-first place to read and belong — no sign-up, no tracking.</div>
          <div style={{ display: 'inline-flex', padding: 12, background: '#fff', borderRadius: 16, border: '1px solid var(--line)', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ width: 190, height: 190 }} dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '14px 0 6px' }}>Scan with a phone camera, or go to:</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-2)', wordBreak: 'break-all', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 11px', textAlign: 'left' }}>{url}</div>
        </div>
        {/* getting started + a place to write the recovery phrase (so the printed sheet is self-contained) */}
        <ol style={{ margin: '18px 0 0', paddingLeft: 20, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          <li>Open your phone camera and point it at the code (or type the link).</li>
          <li>Tap <b>Add to Home Screen / Install</b> so it works offline.</li>
          <li>It opens already following <b>{church.name || 'your church'}</b>. Set your name so your church family recognises you — you can stay private if you need to.</li>
          <li>When asked, write your <b>12-word recovery phrase</b> in the boxes below.</li>
        </ol>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, padding: '10px 12px', borderRadius: 11, background: 'color-mix(in oklab, var(--clay) 7%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 28%, transparent)' }}>
          <Icon name="lock" size={16} color="var(--clay)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>Keep your recovery phrase safe — it’s the <b>only</b> way to restore your account on a new phone. No one, not even your church, can recover it for you. Never share it.</div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', margin: '16px 0 3px' }}>My 12-word recovery phrase</div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 9 }}>Write each word exactly as the app shows it, in order.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '11px 16px' }}>
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} style={lineBox}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)', width: 15, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ flex: 1, borderBottom: '1px solid var(--ink-3)', height: 17 }} />
            </div>
          ))}
        </div>
        <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 20, justifyContent: 'center' }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ padding: '10px 16px', fontSize: 13.5 }}>Done</button>
          <button onClick={savePdf} disabled={pdfBusy} className="sk-btn sk-btn--clay" style={{ padding: '10px 16px', fontSize: 13.5, opacity: pdfBusy ? 0.6 : 1 }}><Icon name={pdfBusy ? 'refresh' : 'receipt'} size={15} color="var(--on-clay)" /> {pdfBusy ? 'Making PDF…' : 'Save PDF'}</button>
          {isNative
            ? <button onClick={shareInvite} className="sk-btn sk-btn--ghost" style={{ padding: '10px 16px', fontSize: 13.5 }}><Icon name="share" size={15} color="currentColor" /> Share link</button>
            : <button onClick={() => window.print()} className="sk-btn sk-btn--ghost" style={{ padding: '10px 16px', fontSize: 13.5 }}><Icon name="receipt" size={15} color="currentColor" /> Print</button>}
        </div>
      </div>
    </div>
  );
}

// ── "Go public" gate for any invite surface ─────────────────────────────────────────────────────────────
// In the desktop Suite this box IS the relay, reachable only on the local wifi until the operator turns on the
// free Cloudflare tunnel. A QR shared before then embeds a loopback address that fails on anyone else's phone.
// This hook drives the HOST component's own re-render, so joinUrl() recomputes with the public relay the moment
// go-public succeeds (a wrapper component couldn't — its children are built before the state changes). Off the
// Suite (web console, phone APK, community relays) selfHosted is false and the whole thing is a no-op.
function useGoPublicGate() {
  const isRelayApp = typeof location !== 'undefined' && new URLSearchParams(location.search).get('relayapp') === '1';
  const selfHosted = isRelayApp && window.Steward && window.Steward.isSelfHosted && window.Steward.isSelfHosted();
  const [pub, setPub] = React.useState(selfHosted ? null : { skip: true });   // null=checking · false=not public · {wss,name}=public
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [override, setOverride] = React.useState(false);
  const alive = React.useRef(true);
  React.useEffect(() => () => { alive.current = false; }, []);
  React.useEffect(() => {
    if (!selfHosted) return;
    const check = async () => {
      try { const st = await window.Steward.tunnelState(); if (!alive.current) return;
        if (st && st.running && st.wss) { const nm = await window.Steward.ownRelayName().catch(() => ''); if (alive.current) setPub({ wss: st.wss, name: nm }); }
        else if (alive.current) setPub(false);
      } catch (e) { if (alive.current) setPub(false); }
    };
    check();
    // keep sibling invite surfaces coherent — go-public (or a cleared stale url) dispatches 'steward-relays'.
    // tunnelState() only re-writes the cache on a real change, so this settles without looping.
    window.addEventListener('steward-relays', check);
    return () => { window.removeEventListener('steward-relays', check); };
  }, [selfHosted]);
  const goPublic = async () => {
    setBusy(true); setErr('');
    try { const r = await window.Steward.goPublic(); const nm = await window.Steward.ownRelayName().catch(() => ''); if (alive.current) setPub({ wss: r.wss, name: nm || r.name }); }
    catch (e) { if (alive.current) setErr((e && e.message) || 'The tunnel couldn’t open.'); }
    if (alive.current) setBusy(false);
  };
  // gate is "open" (show the invite) when: not self-hosted, already public, or the operator chose to skip
  const blocking = selfHosted && (pub === null || (pub === false && !override));
  return { selfHosted, pub, busy, err, override, setOverride, goPublic, blocking };
}

// The go-public prompt shown IN PLACE of an invite until the relay is reachable (or the operator skips).
function GoPublicPanel({ gate }) {
  const { pub, busy, err, goPublic, setOverride } = gate;
  if (pub === null) return <div style={{ fontSize: 14, color: 'var(--ink-3)', display: 'inline-flex', alignItems: 'center', gap: 9, padding: '6px 0' }}><span style={{ width: 15, height: 15, border: '2px solid var(--line)', borderTopColor: 'var(--clay)', borderRadius: '50%', display: 'inline-block', animation: 'trinitySpin .7s linear infinite' }} /> Checking whether your relay is reachable…</div>;
  return (
    <div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, color: 'var(--clay)', fontWeight: 700, fontSize: 15 }}><Icon name="globe" size={18} color="var(--clay)" /> Make your church reachable</div>
      <p style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.6, margin: '8px 0 0', maxWidth: 560 }}>Right now your relay only answers on this building’s wifi, so an invite would fail on anyone else’s phone. Turn on a secure tunnel — <b style={{ color: 'var(--ink)' }}>free, no account</b>, no router or port setup — and your church becomes reachable worldwide.</p>
      <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 13, flexWrap: 'wrap' }}>
        <button className="sk-btn sk-btn--clay" onClick={goPublic} disabled={busy} style={busy ? { opacity: .6, cursor: 'wait' } : undefined}>
          {busy ? <><span style={{ width: 15, height: 15, border: '2px solid rgba(255,255,255,.5)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', marginRight: 4, animation: 'trinitySpin .7s linear infinite' }} /> Opening a secure tunnel… (up to 30s)</> : <><Icon name="globe" size={17} color="#fff" /> Turn on public access</>}
        </button>
        {!busy && <button className="sk-btn sk-btn--ghost" onClick={() => setOverride(true)} style={{ fontSize: 13.5 }}>I’ll do this later</button>}
      </div>
      {err ? <div style={{ marginTop: 14, padding: '11px 14px', borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 8%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, transparent)', fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>{err}</div> : null}
    </div>
  );
}

// The status note shown ABOVE an invite once it's live (or a caution if the operator skipped go-public).
function GoPublicNote({ gate }) {
  const { selfHosted, pub, override } = gate;
  if (!selfHosted) return null;
  if (pub && pub.wss) return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 12px', borderRadius: 11, marginBottom: 14, background: 'color-mix(in oklab, var(--sage) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 24%, transparent)', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
      <Icon name="globe" size={15} color="var(--sage)" style={{ flexShrink: 0, marginTop: 1 }} /><span>Reachable from anywhere{pub.name ? <> as <b style={{ color: 'var(--ink)' }}>{pub.name}</b></> : ''} — this invite works on any network.</span>
    </div>
  );
  if (override) return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 12px', borderRadius: 11, marginBottom: 14, background: 'color-mix(in oklab, var(--clay) 8%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, transparent)', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
      <Icon name="bell" size={15} color="var(--clay)" style={{ flexShrink: 0, marginTop: 1 }} /><span>Not public yet — this code won’t reach anyone else until you turn on public access (relay control panel → <b style={{ color: 'var(--ink)' }}>Reach members</b>).</span>
    </div>
  );
  return null;
}

function JoinCard({ qrSize = 92, center = false }) {
  const church = window.useStewardChurch();   // re-renders once the npub is ready
  const np = church.npub || '';
  const gate = useGoPublicGate();
  const direct = np ? window.Steward.joinUrl() : '';
  // share the smart /join landing (offers the app, or instant-web) — this is what you paste into WhatsApp/email
  const url = direct ? direct.replace('/?follow=', '/join?follow=') + (church.name ? '&c=' + encodeURIComponent(church.name) : '') : '';
  const svg = (np && window.Steward.qrSVG) ? window.Steward.qrSVG(url) : '';
  const nice = churchHandle(church);   // resolvable @handle members can type (from name slug / clean nip05)
  const codeText = nice || np;
  const [copied, setCopied] = React.useState('');
  const [poster, setPoster] = React.useState(false);
  const doCopy = (what, text) => { copyText(text); setCopied(what); setTimeout(() => setCopied(''), 1400); };
  const shareLink = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Join on TrinityOne', text: 'Join ' + (church.name || 'our church') + ' on TrinityOne', url }); return; } catch (e) {} }
    doCopy('link', url);
  };
  const saveQrPng = () => {
    if (!url || !window.Steward.qrSVG) return;
    const u = URL.createObjectURL(new Blob([window.Steward.qrSVG(url)], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = 560; c.height = 560; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 560, 560); x.drawImage(img, 24, 24, 512, 512);
      c.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'join-' + ((church.name || 'church').toLowerCase().replace(/[^a-z0-9]+/g, '-')) + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }, 'image/png');
      URL.revokeObjectURL(u);
    };
    img.onerror = () => URL.revokeObjectURL(u);
    img.src = u;
  };
  // reachability gate: in the self-hosted Suite, show "make your church reachable" until the tunnel is on
  if (gate.blocking) return <GoPublicPanel gate={gate} />;
  return (
    <React.Fragment>
      <GoPublicNote gate={gate} />
    <div style={{ display: 'flex', flexDirection: center ? 'column' : 'row', gap: 16, alignItems: 'center', textAlign: center ? 'center' : 'left' }}>
      <div style={{ width: qrSize + 18, height: qrSize + 18, borderRadius: 14, background: '#fff', boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 9, boxSizing: 'border-box' }}>
        {svg ? <div role="img" aria-label="Invite QR code" style={{ width: qrSize, height: qrSize, display: 'flex' }} dangerouslySetInnerHTML={{ __html: svg }} /> : <SkQR size={qrSize} />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Your church code</div>
        <div onClick={() => doCopy('code', codeText)} title={nice ? church.nip05 : np} style={{ fontFamily: nice ? 'var(--font-display)' : 'var(--mono)', fontWeight: nice ? 800 : 700, fontSize: nice ? 18 : 15, letterSpacing: nice ? '-.2px' : '.3px', margin: '4px 0 2px', cursor: 'pointer', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nice || shortNpub(np)}</div>
        {nice ? <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 2 }}>members can scan the QR, or type this name</div> : null}
        {/* full key, selectable — so copy works even if the buttons can't reach the clipboard */}
        <textarea readOnly value={np} onFocus={e => e.target.select()} style={{ width: '100%', maxWidth: 280, height: 38, resize: 'none', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: 10.5, padding: '6px 8px', marginTop: 4, lineHeight: 1.3, wordBreak: 'break-all' }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, justifyContent: center ? 'center' : 'flex-start' }}>
          <button onClick={() => doCopy('code', codeText)} className="sk-btn sk-btn--clay" style={{ padding: '7px 11px', fontSize: 12 }}><Icon name={copied === 'code' ? 'check' : 'receipt'} size={14} color="var(--on-clay)" /> {copied === 'code' ? 'Copied' : 'Copy code'}</button>
          <button onClick={() => doCopy('link', url)} title="Copy a join link to paste into WhatsApp, email or a group chat" className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 12 }}><Icon name={copied === 'link' ? 'check' : 'link'} size={14} color="currentColor" /> {copied === 'link' ? 'Copied' : 'Copy link'}</button>
          <button onClick={shareLink} title="Share the join link (e.g. straight into a WhatsApp group)" className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 12 }}><Icon name="share" size={14} color="currentColor" /> Share</button>
          <button onClick={saveQrPng} title="Save the QR as an image to post in a chat or on a poster" className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 12 }}><Icon name="qr" size={14} color="currentColor" /> Save QR</button>
          <button onClick={() => setPoster(true)} className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 12 }} title="Show the invite poster (QR + link) to display, print, or save"><Icon name="receipt" size={14} color="currentColor" /> Invite poster</button>
        </div>
      </div>
      {poster ? <InvitePosterModal church={church} url={url} svg={svg} onClose={() => setPoster(false)} /> : null}
    </div>
    </React.Fragment>
  );
}

function JoinModal({ onClose }) {
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'rgba(40,32,24,.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Invite your church" tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: '92%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 30 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, textAlign: 'center' }}>Invite your church</div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 22px', textAlign: 'center' }}>Show this on screen or print it. One scan with a phone camera opens TrinityOne already following your church — no account, no phone number.</p>
        <JoinCard qrSize={168} center />
        <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ width: '100%', padding: 11, fontSize: 14, marginTop: 24 }}>Done</button>
      </div>
    </div>
  );
}

// post a signed announcement to the church (kind-1), targeting a broadcast room
function NewPostModal({ onClose }) {
  const groups = window.useStewardGroups();
  const targets = groups;   // post to any chat group or team (not only Announcements)
  const broadcast = groups.find(g => g.kind === 'broadcast');
  const [text, setText] = React.useState('');
  const [target, setTarget] = React.useState(broadcast ? broadcast.id : (groups[0] ? groups[0].id : 'announce'));
  const [sending, setSending] = React.useState(false);
  const post = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try { await window.Steward.publishPost(text.trim(), target); } catch {}
    onClose();
  };
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'rgba(40,32,24,.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="New post" tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: '92%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 28 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>New post</div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 18px' }}>A signed message from your church. Members see it in the chosen group or team.</p>
        {targets.length ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>Post to</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {targets.map(g => (
                <button key={g.id} onClick={() => setTarget(g.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, border: '1px solid ' + (target === g.id ? 'var(--clay)' : 'var(--line)'), background: target === g.id ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface)', color: target === g.id ? 'var(--clay-ink)' : 'var(--ink-2)' }}>
                  <Icon name={g.kind === 'team' ? (g.icon || 'shield') : g.kind === 'broadcast' ? 'send' : 'chat'} size={13} color="currentColor" />{g.name}{g.kind === 'team' ? <span style={{ fontSize: 10, fontWeight: 800, opacity: .6, letterSpacing: '.4px' }}>TEAM</span> : null}</button>
              ))}
            </div>
          </div>
        ) : null}
        <textarea value={text} onChange={e => setText(e.target.value)} autoFocus rows={4} placeholder="Write to your church…" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface-2)', padding: '13px 15px', fontSize: 14.5, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', resize: 'vertical', lineHeight: 1.5 }} />
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12, fontSize: 14 }}>Cancel</button>
          <button onClick={post} disabled={!text.trim() || sending} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 12, fontSize: 14, opacity: (!text.trim() || sending) ? 0.55 : 1 }}><Icon name="send" size={16} color="var(--on-clay)" /> {sending ? 'Posting…' : 'Post'}</button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, ic, tint, onClick }) {
  const t = SK_TINT[tint];
  return (
    <div onClick={onClick} role={onClick ? 'button' : undefined} style={{ flex: 1, padding: 18, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', cursor: onClick ? 'pointer' : 'default', transition: 'box-shadow .12s, transform .12s', textAlign: 'left', boxShadow: onClick ? 'var(--shadow-sm)' : 'none' }}
      onMouseEnter={onClick ? (e) => { e.currentTarget.style.boxShadow = 'var(--shadow)'; } : undefined}
      onMouseLeave={onClick ? (e) => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: t.bg, color: t.fg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={ic} size={17} color="currentColor" /></div>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)' }}>{label}</span>
        {onClick ? <Icon name="chevR" size={15} color="var(--ink-3)" style={{ marginLeft: 'auto' }} /> : null}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, letterSpacing: '-.6px', marginTop: 12 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function Panel({ title, action, children, style = {}, scroll = false }) {
  const narrow = useStewNarrow();
  return (
    <div style={{ borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', padding: 22, ...(scroll ? { display: 'flex', flexDirection: 'column', minHeight: 0 } : {}), ...style }}>
      <div style={{ display: 'flex', flexDirection: (narrow && action) ? 'column' : 'row', alignItems: (narrow && action) ? 'stretch' : 'center', gap: (narrow && action) ? 11 : 0, marginBottom: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16.5 }}>{title}</div>
          <div style={{ flex: 1, minWidth: 24 }} />
          {!narrow ? action : null}
        </div>
        {(narrow && action) ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{action}</div> : null}
      </div>
      {scroll ? <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{children}</div> : children}
    </div>
  );
}

// lets the steward put join alerts on their phone (web-push, PWA). Silently re-registers if permission
// is already granted; otherwise a tap prompts for it. Hidden on native (uses local notifs) / unsupported.
function PushEnabler() {
  const [state, setState] = React.useState('off');   // off | working | on | denied | hide
  React.useEffect(() => {
    if (typeof Notification === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) { setState('hide'); return; }
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) { setState('hide'); return; }
    if (Notification.permission === 'granted') { window.Steward.registerPush().then(r => setState(r === 'on' ? 'on' : (r === 'native' || r === 'unsupported' ? 'hide' : 'off'))); }
    else if (Notification.permission === 'denied') setState('denied');
  }, []);
  if (state === 'hide') return null;
  const enable = async () => { setState('working'); const r = await window.Steward.registerPush(); setState(r === 'on' ? 'on' : (r === 'denied' ? 'denied' : 'off')); };
  const on = state === 'on';
  return (
    <button onClick={on ? undefined : enable} disabled={state === 'working' || on} title={on ? 'You’ll get a phone notification when someone joins' : 'Get a phone notification when a new member joins'}
      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', boxSizing: 'border-box', padding: '10px 13px', borderRadius: 12, cursor: on ? 'default' : 'pointer', textAlign: 'left',
        background: on ? 'color-mix(in oklab, var(--sage) 12%, var(--surface))' : 'var(--surface-2)', border: '1px solid ' + (on ? 'color-mix(in oklab, var(--sage) 40%, transparent)' : 'var(--line)'), fontFamily: 'var(--font-ui)' }}>
      <Icon name="bell" size={16} color={on ? 'var(--sage)' : 'var(--clay)'} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{on ? 'Join alerts are on' : 'Notify my phone on joins'}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{state === 'working' ? 'Enabling…' : state === 'denied' ? 'Notifications are blocked in your browser settings' : on ? 'A push lands here even when the console is shut' : 'Tap to allow notifications'}</div>
      </div>
    </button>
  );
}

// shared responsive flag for the dashboard cards (phone/narrow window)
function useStewNarrow(bp = 760) {
  const [n, setN] = React.useState(typeof window !== 'undefined' ? window.innerWidth < bp : false);
  React.useEffect(() => { const f = () => setN(window.innerWidth < bp); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  return n;
}

// Live group subtitle (2026-07-07): replaces the old stored `sub` text, which on some churches carried stale
// SAMPLE-DATA counts ("31 members · 2 stewards") baked in at setup and never updated. Compute from live relay
// data: invite-only groups show their allowlist size, teams their roster size, open groups the church size
// (everyone can join), broadcasts just "Broadcast". Recomputes on every render so it's always current.
function groupLiveSub(g, memberCount, rosters) {
  const n = (x) => x + (x === 1 ? ' member' : ' members');
  if (g.kind === 'broadcast') return 'Broadcast';
  if (g.kind === 'team') { const c = ((rosters || []).find(r => r.team === g.id) || { people: [] }).people.length; return c ? n(c) : 'Team'; }
  if (g.visibility === 'invite') return n(Array.isArray(g.members) ? g.members.length : 0) + ' · invite-only';
  return n(memberCount || 0);   // open group: every church member can join
}
function DashOverview({ onTab, onNewPost, onSettings }) {
  const goSettings = onSettings || ((s) => onTab('settings'));   // deep-links a settings sub-tab when available
  const groups = window.useStewardGroups();   // real chat groups (the focus)
  const members = window.useStewardMembers(); // real members (joined and/or active)
  const rosters = window.useStewardRosters ? window.useStewardRosters() : [];   // team rosters, for live team counts
  const relays = window.useStewardRelays();   // real relay status
  const stats = window.useStewardStats();     // real footprint + announcement counts
  const activity = window.useStewardActivity(); // real recent-events feed
  const relayUp = relays.some(r => r.status === 'on');
  const narrow = useStewNarrow();
  const [chatGroup, setChatGroup] = React.useState(null);   // group whose chat is open (from a list/activity row)
  // open a chat by group id (used by both the groups list and the activity feed)
  const openChat = (gid) => { const g = groups.find(x => x.id === gid); if (g) window.dispatchEvent(new CustomEvent('steward-open-group-chat', { detail: g })); else onTab('groups'); };
  // people waiting for approval (only when the church requires it) — surfaced big on the dashboard
  const joinApproval = window.useStewardJoinPolicy ? window.useStewardJoinPolicy() : false;
  const admittedSet = new Set(window.useStewardAdmitted ? window.useStewardAdmitted() : []);
  const blockedSet = new Set(window.useStewardBlocked ? window.useStewardBlocked() : []);
  // "Pending" is the ABSENCE of a member from two other streams, so it is only meaningful once both have
  // actually arrived. On a hard reload the members list lands first and those sets are still empty, which
  // briefly makes every member in the church look like they are queuing at the door — an alarming banner,
  // for a second, that was never true. Wait for the evidence before drawing the conclusion.
  const idvNow = window.useStewardIdv ? window.useStewardIdv() : 0;
  const rosterLoaded = !window.stewardStreamLoaded
    || (window.stewardStreamLoaded('subscribeAdmitted', idvNow) && window.stewardStreamLoaded('subscribeBlocked', idvNow));
  const pendingCount = (joinApproval && rosterLoaded) ? members.filter(m => !admittedSet.has(m.pubkey) && !blockedSet.has(m.pubkey)).length : 0;
  const realCount = useRealMemberCount();   // blocked + still-pending excluded — see useRealMemberCount
  const pendingBanner = pendingCount ? (
    <button onClick={() => onTab('members')} style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left', cursor: 'pointer', padding: '16px 18px', borderRadius: 16, border: '1px solid color-mix(in oklab, var(--clay) 32%, var(--line))', background: 'color-mix(in oklab, var(--clay) 10%, var(--surface))', fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)' }}>
      <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: 'var(--clay)', color: 'var(--on-clay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="pray" size={22} color="var(--on-clay)" /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--clay-ink)' }}>{pendingCount} {pendingCount === 1 ? 'person is' : 'people are'} waiting to join</div>
        <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>Review and approve them in Members.</div>
      </div>
      <span className="sk-btn sk-btn--clay" style={{ padding: '9px 14px', fontSize: 13.5, flexShrink: 0 }}>Review <Icon name="chevR" size={15} color="var(--on-clay)" /></span>
    </button>
  ) : null;
  // people asking to become a steward — surfaced big too, so a request never just sits unseen in Settings
  const stewardReqs = window.usePendingStewards ? window.usePendingStewards() : [];
  const stewardReqBanner = stewardReqs.length ? (
    <button onClick={() => goSettings('security')} style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left', cursor: 'pointer', padding: '16px 18px', borderRadius: 16, border: '1px solid color-mix(in oklab, var(--gold) 38%, var(--line))', background: 'color-mix(in oklab, var(--gold) 12%, var(--surface))', fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)' }}>
      <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: 'var(--gold)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="shield" size={22} color="#fff" /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: '#8a6717' }}>{stewardReqs.length} {stewardReqs.length === 1 ? 'person wants' : 'people want'} to help steward</div>
        <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>Approve them under Settings → Security → Delegated stewards.</div>
      </div>
      <span className="sk-btn sk-btn--clay" style={{ padding: '9px 14px', fontSize: 13.5, flexShrink: 0 }}>Review <Icon name="chevR" size={15} color="var(--on-clay)" /></span>
    </button>
  ) : null;
  // on narrow, panels size to content and the page scrolls; on wide they fill a fixed-height grid + scroll inside
  const fillStyle = narrow ? {} : { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' };
  const listStyle = narrow ? { display: 'flex', flexDirection: 'column', gap: 10 } : { display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0, overflowY: 'auto' };

  const stat = (
    <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr 1fr' : 'repeat(4, 1fr)', gap: narrow ? 10 : 14 }}>
      <StatCard label="Members" value={realCount ? String(realCount) : '—'} sub={realCount ? 'invite more' : 'invite your church'} ic="pray" tint="sage" onClick={() => onTab('members')} />
      <StatCard label="Groups" value={String(groups.length)} sub="chat rooms · signed" ic="chat" tint="clay" onClick={() => onTab('groups')} />
      <StatCard label="Announcements" value={stats.announcements ? String(stats.announcements) : '—'} sub="post to everyone" ic="send" tint="gold" onClick={() => (onNewPost ? onNewPost() : onTab('groups'))} />
      <StatCard label="Your relay" value={relays.length === 0 ? '…' : (relayUp ? 'Live' : 'Down')} sub="where you publish" ic="globe" tint={relayUp || relays.length === 0 ? 'ink' : 'clay'} onClick={() => goSettings('relays')} />
    </div>
  );
  const groupsPanel = (
    <Panel title="Groups & rooms" action={<button onClick={() => onTab('groups')} style={{ border: 'none', background: 'none', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Manage →</button>} style={fillStyle}>
      <div className="no-scrollbar" style={listStyle}>
        {groups.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '8px 2px' }}>No groups yet — create your church’s first chat room.</div> : null}
        {groups.map(g => (
          <button key={g.id} onClick={() => window.dispatchEvent(new CustomEvent('steward-open-group-chat', { detail: g }))} title="Open chat" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 11, padding: '6px 8px', margin: '0 -8px', cursor: 'pointer', fontFamily: 'var(--font-ui)', transition: 'background .12s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
            <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: 'var(--surface-2)', color: g.kind === 'broadcast' ? '#8a6717' : 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={g.kind === 'broadcast' ? 'send' : 'chat'} size={18} color="currentColor" /></div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{groupLiveSub(g, realCount, rosters)}</div></div>
            {g.kind === 'broadcast' ? <SkPill tint="gold">Broadcast</SkPill> : null}
            <Icon name="chat" size={16} color="var(--ink-3)" style={{ flexShrink: 0 }} />
          </button>
        ))}
      </div>
    </Panel>
  );
  const joinPanel = (
    <Panel title="Joining code">
      <JoinCard qrSize={92} center={narrow} />
      <div style={{ marginTop: 12 }}><PushEnabler /></div>
    </Panel>
  );
  const activityPanel = (
    <Panel title="Recent activity" style={fillStyle}>
      {activity.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '6px 2px' }}>Nothing yet — activity shows here as your church chats.</div> : null}
      <div className="no-scrollbar" style={narrow ? { display: 'flex', flexDirection: 'column', gap: 14 } : { display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {activity.map((a) => {
          const t = SK_TINT[a.tint] || SK_TINT.ink;
          // resolve a group name for chat-linked rows (the gid is the group id, not its name)
          const grp = a.gid ? groups.find(x => x.id === a.gid) : null;
          const text = grp ? a.text.replace('a group', `“${grp.name}”`) : a.text;
          const act = grp ? () => window.dispatchEvent(new CustomEvent('steward-open-group-chat', { detail: grp })) : a.to ? () => onTab(a.to) : null;
          const inner = (
            <React.Fragment>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: t.bg, color: t.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={a.ic} size={16} color="currentColor" /></div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{text}</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 1 }}>{ago(a.ts)}</div></div>
              {act ? <Icon name="chevR" size={15} color="var(--ink-3)" style={{ flexShrink: 0, alignSelf: 'center' }} /> : null}
            </React.Fragment>
          );
          return act
            ? <button key={a.id} onClick={act} title="Open the related chat or page" style={{ display: 'flex', gap: 11, alignItems: 'flex-start', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 10, padding: '4px 8px', margin: '0 -8px', cursor: 'pointer', fontFamily: 'var(--font-ui)', transition: 'background .12s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>{inner}</button>
            : <div key={a.id} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>{inner}</div>;
        })}
      </div>
    </Panel>
  );

  const chatModal = chatGroup ? <GroupChatModal group={chatGroup} onClose={() => setChatGroup(null)} /> : null;
  if (narrow) {
    return (
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {pendingBanner}{stewardReqBanner}{stat}{joinPanel}{groupsPanel}{activityPanel}
        {chatModal}
      </div>
    );
  }
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 18, height: '100%' }}>
      {pendingBanner}
      {stewardReqBanner}
      {stat}
      <div style={{ display: 'grid', gridTemplateColumns: '1.45fr 1fr', gap: 18, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>{groupsPanel}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>{joinPanel}{activityPanel}</div>
      </div>
      {chatModal}
    </div>
  );
}

function DashGiving() {
  const funds = window.useStewardFunds();   // REAL funds the church has published (kind-30078)
  const newFund = () => {
    const name = window.prompt('New fund name (e.g. Missions)');
    if (name && name.trim()) window.Steward.publishFund({ name: name.trim(), custody: 'Custodial · Strike', icon: 'gift' });
  };
  return (
    <Panel title="Funds" action={<button onClick={newFund} className="sk-btn sk-btn--clay" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="plus" size={15} color="var(--on-clay)" /> New fund</button>} style={{ height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1.3fr 1fr 1fr 0.4fr', padding: '0 8px 12px', borderBottom: '1px solid var(--line)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
        <div>Fund</div><div>Custody</div><div style={{ textAlign: 'right' }}>This month</div><div style={{ textAlign: 'right' }}>Year to date</div><div></div>
      </div>
      {funds.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '36px 10px', color: 'var(--ink-3)' }}>
          <Icon name="gift" size={26} color="var(--ink-3)" /><p style={{ margin: '10px 0 0', fontSize: 13.5 }}>No funds yet — add your first.</p></div>
      ) : null}
      {funds.map(f => (
        <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '2.2fr 1.3fr 1fr 1fr 0.4fr', alignItems: 'center', padding: '15px 8px', borderBottom: '1px solid var(--line-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface-2)', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={f.icon} size={18} color="currentColor" /></div>
            <div><div style={{ fontWeight: 700, fontSize: 14.5 }}>{f.name}</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{f.sub}{f.goal ? ` · ${Math.round(f.raised / f.goal * 100)}% of $${(f.goal / 1000)}k` : ''}</div></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-2)', fontWeight: 600 }}><Icon name={(f.custody || '').includes('Strike') ? 'wallet' : 'bank'} size={15} color="var(--ink-3)" /> {f.custody || 'Custodial · Strike'}</div>
          <div style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: 15 }}>{f.month || '—'}</div>
          <div style={{ textAlign: 'right', fontWeight: 600, fontSize: 14, color: 'var(--ink-2)' }}>{f.ytd || '—'}</div>
          <div style={{ textAlign: 'right' }}><Icon name="dots" size={18} color="var(--ink-3)" /></div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 9, marginTop: 16, padding: 13, borderRadius: 12, background: 'color-mix(in oklab, var(--gold) 10%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 28%, transparent)' }}>
        <Icon name="bolt" size={17} fill color="var(--gold)" style={{ flexShrink: 0 }} />
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>Editing a fund republishes a signed event to your relays, so members always see the current details.</div>
      </div>
    </Panel>
  );
}

function ListPanel({ title, items, addLabel, renderRight, renderAside, onAdd, empty, reorderable, onReorder, headerExtra, filters }) {
  const [order, setOrder] = React.useState(null);   // working copy while dragging
  const [dragId, setDragId] = React.useState(null);
  const [overId, setOverId] = React.useState(null);
  const [q, setQ] = React.useState('');   // filter — keeps a long list manageable
  const [kindF, setKindF] = React.useState('all');   // type filter (e.g. Groups/Teams/Rooms) when `filters` is supplied
  const searchable = items.length > 7;    // only show the search box once the list gets long
  const query = q.trim().toLowerCase();
  const activeTest = (filters && kindF !== 'all') ? (filters.find(f => f.key === kindF) || {}).test : null;
  const base = activeTest ? items.filter(activeTest) : items;
  // filter by name/description; reordering is disabled while filtering or type-filtering (only reorder the full list)
  const filtered = query ? base.filter(it => ((it.name || '') + ' ' + (it.sub || '')).toLowerCase().includes(query)) : base;
  const canDrag = reorderable && !query && kindF === 'all';
  const list = order || filtered;
  const idOf = (it, i) => it.id != null ? it.id : i;
  const onDragOver = (e, id) => {
    e.preventDefault();
    if (dragId == null || id === dragId) return;
    const arr = (order || items).slice();
    const from = arr.findIndex((x, i) => idOf(x, i) === dragId), to = arr.findIndex((x, i) => idOf(x, i) === id);
    if (from < 0 || to < 0) return;
    const [m] = arr.splice(from, 1); arr.splice(to, 0, m);
    setOrder(arr); setOverId(id);
  };
  const onDrop = () => { if (order && onReorder) onReorder(order); setDragId(null); setOverId(null); setOrder(null); };
  const move = (idx, dir) => { const arr = items.slice(); const j = idx + dir; if (j < 0 || j >= arr.length) return; const t = arr[idx]; arr[idx] = arr[j]; arr[j] = t; if (onReorder) onReorder(arr); };
  const fld = { width: '100%', boxSizing: 'border-box', height: 40, padding: '0 14px 0 38px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', outline: 'none', fontSize: 14, color: 'var(--ink)', fontFamily: 'var(--font-ui)' };
  return (
    <Panel title={title} action={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{headerExtra || null}<button onClick={onAdd} className="sk-btn sk-btn--clay" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="plus" size={15} color="var(--on-clay)" /> {addLabel}</button></div>} style={{ height: '100%' }} scroll>
      {searchable ? (
        <div style={{ position: 'relative', marginBottom: 12, flexShrink: 0 }}>
          <Icon name="search" size={16} color="var(--ink-3)" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${items.length} items by name…`} style={fld} />
          {q ? <button onClick={() => setQ('')} title="Clear" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 4 }}><Icon name="x" size={15} /></button> : null}
        </div>
      ) : null}
      {filters && filters.length && items.length ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, flexShrink: 0 }}>
          {[{ key: 'all', label: 'All' }, ...filters].map(f => { const on = kindF === f.key; return (
            <button key={f.key} onClick={() => setKindF(f.key)} style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid ' + (on ? 'var(--clay)' : 'var(--line)'), background: on ? 'var(--clay)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-2)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>{f.label}</button>
          ); })}
        </div>
      ) : null}
      {items.length === 0 ? <div style={{ textAlign: 'center', padding: '34px 10px', color: 'var(--ink-3)', fontSize: 13.5 }}>{empty || 'Nothing here yet.'}</div> : null}
      {items.length > 0 && filtered.length === 0 ? <div style={{ textAlign: 'center', padding: '28px 10px', color: 'var(--ink-3)', fontSize: 13.5 }}>{q ? 'Nothing matches “' + q + '”.' : 'Nothing in this filter yet.'}</div> : null}
      {canDrag && items.length > 1 ? <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 2px 10px', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="dots" size={13} color="var(--ink-3)" /> Drag to reorder — this is the order your members see.</div> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map((it, i) => {
          const id = idOf(it, i), dragging = dragId === id;
          return (
          <div key={id} draggable={!!canDrag}
            onDragStart={canDrag ? (e) => { setDragId(id); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(id)); } catch (err) {} } : undefined}
            onDragOver={canDrag ? (e) => onDragOver(e, id) : undefined} onDrop={canDrag ? onDrop : undefined} onDragEnd={canDrag ? () => { setDragId(null); setOverId(null); setOrder(null); } : undefined}
            style={{ display: 'flex', flexDirection: 'column', gap: 11, padding: '13px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid ' + (overId === id && !dragging ? 'var(--clay)' : 'var(--line)'), opacity: dragging ? 0.4 : 1, boxShadow: dragging ? 'var(--shadow-lg)' : 'none', transition: 'border-color .12s, opacity .12s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
              {canDrag ? <div title="Drag to reorder" style={{ cursor: 'grab', color: 'var(--ink-3)', display: 'flex', flexShrink: 0, touchAction: 'none' }}><Icon name="dots" size={18} color="currentColor" /></div> : null}
              <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--surface)', color: it.fg || 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', flexShrink: 0 }}><Icon name={it.ic} size={19} color="currentColor" /></div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>{it.sub ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.sub}</div> : null}</div>
              {renderAside ? <div style={{ flexShrink: 0 }}>{renderAside(it)}</div> : null}
            </div>
            {renderRight ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingLeft: canDrag ? 82 : 51 }}>{renderRight(it)}</div> : null}
          </div>
          );
        })}
      </div>
    </Panel>
  );
}

// create-a-group modal (a real form, not a prompt)
function NewGroupModal({ open, onClose }) {
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState('group');
  const [sub, setSub] = React.useState('');
  const [inviteOnly, setInviteOnly] = React.useState(false);
  const [encrypted, setEncrypted] = React.useState(false);
  const [childsafe, setChildsafe] = React.useState(false);
  const [sel, setSel] = React.useState(new Set());   // chosen member pubkeys for an invite-only group
  const [category, setCategory] = React.useState('');   // chosen category id ('' = uncategorised)
  const members = window.useStewardMembers ? window.useStewardMembers() : [];
  const cats = window.useStewardCategories ? window.useStewardCategories() : [];
  const church = window.useStewardChurch ? window.useStewardChurch() : {};
  const encByDefault = !!(church.features && church.features.encryptComms);   // "Encrypt all comms" → new groups sealed by default
  React.useEffect(() => { if (open) { setName(''); setKind('group'); setSub(''); setInviteOnly(false); setEncrypted(encByDefault); setChildsafe(false); setSel(new Set()); setCategory(''); } }, [open]);
  if (!open) return null;
  const togglePk = (pk) => setSel(s => { const n = new Set(s); n.has(pk) ? n.delete(pk) : n.add(pk); return n; });
  const create = () => {
    if (!name.trim()) return;
    const g = { name: name.trim(), kind, sub: sub.trim() };
    if (category) g.category = category;
    if (kind === 'group' && inviteOnly) { g.visibility = 'invite'; g.members = [...sel]; }
    if (kind === 'group' && encrypted) g.encrypted = true;
    if (childsafe) g.childsafe = true;
    Promise.resolve(window.Steward.publishGroup(g)).then(pub => {
      // encrypted → mint + distribute the group key. Recipients: the allowlist (invite) or everyone (open).
      if (encrypted && pub && pub.id && window.Steward.publishGroupKey) {
        const recips = inviteOnly ? [...sel] : members.map(m => m.pubkey);
        window.Steward.publishGroupKey(pub.id, recips);
      }
    });
    onClose();
  };
  const fld = { width: '100%', boxSizing: 'border-box', height: 46, padding: '0 14px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 15, color: 'var(--ink)', fontFamily: 'var(--font-ui)' };
  const lbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 7px' };
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30,
      background: 'color-mix(in oklab, var(--ink) 32%, transparent)', backdropFilter: 'blur(3px)', animation: 'lumenFade .18s ease both' }}>
      <div style={{ width: 480, maxWidth: '100%', borderRadius: 22, background: 'var(--paper)', border: '1px solid var(--line)', boxShadow: '0 24px 70px rgba(0,0,0,.28)', overflow: 'hidden', animation: 'lumenScale .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div className="no-scrollbar" style={{ padding: '24px 26px 0', maxHeight: '64vh', overflowY: 'auto' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, marginBottom: 4 }}>New group</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 18, lineHeight: 1.5 }}>A chat room (or a broadcast channel) for your church. It’s published as a signed event your members can join.</div>
          <div style={lbl}>NAME</div>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }} placeholder="e.g. Sunday Service" style={{ ...fld, fontWeight: 600, marginBottom: 16 }} />
          <div style={lbl}>TYPE</div>
          <SkToggle value={kind} onChange={setKind} options={[{ value: 'group', label: 'Group chat', icon: 'chat' }, { value: 'broadcast', label: 'Broadcast', icon: 'send' }]} style={{ marginBottom: 6 }} />
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '6px 0 16px', lineHeight: 1.45 }}>{kind === 'broadcast' ? 'Only stewards post; everyone reads. Good for announcements.' : 'Everyone in the group can post and reply.'}</div>
          <div style={lbl}>DESCRIPTION</div>
          <input value={sub} onChange={e => setSub(e.target.value)} placeholder="Optional — e.g. Whole church" style={{ ...fld, fontSize: 14.5 }} />
          {cats.length ? (
            <React.Fragment>
              <div style={{ ...lbl, margin: '16px 0 7px' }}>CATEGORY</div>
              <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...fld, fontSize: 14.5, cursor: 'pointer' }}>
                <option value="">Uncategorised</option>
                {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </React.Fragment>
          ) : null}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '18px 0 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={childsafe} onChange={e => setChildsafe(e.target.checked)} style={{ marginTop: 2 }} />
            <span style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.45 }}><b>👶 Child-safe</b> — members marked as a child can see and join this group. Groups that aren’t child-safe are hidden from children.</span>
          </label>
          {kind === 'group' ? (
            <React.Fragment>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '18px 0 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={inviteOnly} onChange={e => setInviteOnly(e.target.checked)} style={{ marginTop: 2 }} />
                <span style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.45 }}><b>Invite-only</b> — hidden from the group list, and only the members you choose can post (the relay enforces it).</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '12px 0 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={encrypted} onChange={e => setEncrypted(e.target.checked)} style={{ marginTop: 2 }} />
                <span style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.45 }}><b>🔒 Encrypted</b> — messages are sealed end-to-end; not even the relay can read them. {inviteOnly ? 'Keyed to the chosen members.' : 'Keyed to everyone in the church.'} New members can read past messages.</span>
              </label>
              {inviteOnly ? (
                <div style={{ marginTop: 14 }}>
                  <div style={lbl}>WHO’S IN · {sel.size}</div>
                  {members.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>No members have joined yet — create the group, then add people here once they’re in.</div> : (
                    <div className="no-scrollbar" style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {members.map(m => { const on = sel.has(m.pubkey); return (
                        <button key={m.pubkey} type="button" onClick={() => togglePk(m.pubkey)} title="Tick to add this person to the group, untick to leave them out" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, border: '1px solid ' + (on ? 'color-mix(in oklab, var(--sage) 45%, var(--line))' : 'var(--line)'), background: on ? 'color-mix(in oklab, var(--sage) 8%, var(--surface))' : 'var(--surface)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
                          <div style={{ width: 20, height: 20, borderRadius: 6, border: '2px solid ' + (on ? 'var(--sage)' : 'var(--line)'), background: on ? 'var(--sage)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{on ? <Icon name="check" size={13} stroke={3} color="#fff" /> : null}</div>
                          <span style={{ fontWeight: 700, fontSize: 13.5 }}>{m.name || 'Anonymous'}</span>
                          <span style={{ fontSize: 11, color: nameHandle(m) ? 'var(--sage)' : 'var(--ink-3)', fontWeight: nameHandle(m) ? 700 : 400, fontFamily: nameHandle(m) ? 'var(--font-ui)' : 'var(--mono)', marginLeft: 'auto' }}>{nameHandle(m) ? '@' + nameHandle(m) : shortNpub(m.npub)}</span>
                        </button>
                      ); })}
                    </div>
                  )}
                </div>
              ) : null}
            </React.Fragment>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '20px 26px 22px' }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: '12px' }}>Cancel</button>
          <button onClick={create} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: '12px', opacity: name.trim() ? 1 : .5 }}><Icon name="plus" size={16} color="var(--on-clay)" /> Create group</button>
        </div>
      </div>
    </div>
  );
}

// Manage who's in an invite-only group after it's created (add/remove the allowlist). Re-publishes the
// group with the new member set — the relay then enforces posting + the read-gate against it.
function EditGroupMembersModal({ group, onClose }) {
  const members = window.useStewardMembers ? window.useStewardMembers() : [];
  const [sel, setSel] = React.useState(() => new Set(Array.isArray(group.members) ? group.members : []));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const togglePk = (pk) => setSel(s => { const n = new Set(s); n.has(pk) ? n.delete(pk) : n.add(pk); return n; });
  const known = new Set(members.map(m => m.pubkey));
  const orphans = [...sel].filter(pk => !known.has(pk));   // in the group but not in the current roster
  const save = () => {
    setBusy(true); setErr('');
    const newM = [...sel];
    const removed = (group.members || []).some(pk => !sel.has(pk));   // someone dropped → rotate the key
    // don't hang forever if the relay never ACKs — surface it so it's not a dead button
    const guard = setTimeout(() => { setBusy(false); setErr('Couldn’t reach the relay — check your connection and try again.'); }, 8000);
    Promise.resolve(window.Steward.publishGroup({ ...group, visibility: 'invite', members: newM }))
      .then(() => { if (group.encrypted && window.Steward.publishGroupKey) return window.Steward.publishGroupKey(group.id, newM, { rotate: removed }); })
      .then(() => { clearTimeout(guard); onClose(); })
      .catch((e) => { clearTimeout(guard); setBusy(false); setErr((e && e.message) || 'Couldn’t save members — please try again.'); });
  };
  const lbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 8px' };
  const dlgRef = useStewDialog(() => { if (!busy) onClose(); });   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={() => !busy && onClose()} style={{ position: 'absolute', inset: 0, zIndex: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28, background: 'color-mix(in oklab, var(--ink) 32%, transparent)', backdropFilter: 'blur(3px)', animation: 'lumenFade .18s ease both' }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={'Who’s in ' + group.name} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: '100%', maxHeight: '88%', display: 'flex', flexDirection: 'column', borderRadius: 22, background: 'var(--paper)', border: '1px solid var(--line)', boxShadow: '0 24px 70px rgba(0,0,0,.28)', overflow: 'hidden', animation: 'lumenScale .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div style={{ padding: '22px 24px 14px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>Who’s in “{group.name}”</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4, lineHeight: 1.5 }}>Invite-only — only these members can post and read. Remove someone and the relay locks them out of the chat.</div>
        </div>
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={lbl}>MEMBERS · {sel.size}</div>
          {members.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>No members have joined yet.</div> : members.map(m => { const on = sel.has(m.pubkey); return (
            <button key={m.pubkey} type="button" onClick={() => togglePk(m.pubkey)} title="Tick to keep this person in the group, untick to remove them" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, border: '1px solid ' + (on ? 'color-mix(in oklab, var(--sage) 45%, var(--line))' : 'var(--line)'), background: on ? 'color-mix(in oklab, var(--sage) 8%, var(--surface))' : 'var(--surface)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
              <div style={{ width: 20, height: 20, borderRadius: 6, border: '2px solid ' + (on ? 'var(--sage)' : 'var(--line)'), background: on ? 'var(--sage)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{on ? <Icon name="check" size={13} stroke={3} color="#fff" /> : null}</div>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>{m.name || 'Anonymous'}</span>
              <span style={{ fontSize: 11, color: nameHandle(m) ? 'var(--sage)' : 'var(--ink-3)', fontFamily: nameHandle(m) ? 'var(--font-ui)' : 'var(--mono)', marginLeft: 'auto' }}>{nameHandle(m) ? '@' + nameHandle(m) : shortNpub(m.npub)}</span>
            </button>
          ); })}
          {orphans.length ? <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>{orphans.length} other member{orphans.length === 1 ? '' : 's'} in this group aren’t on the current roster (left/quiet) — they stay unless you’ve unticked them above.</div> : null}
        </div>
        {err ? <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', fontWeight: 600, padding: '8px 24px 0', lineHeight: 1.45 }}>{err}</div> : null}
        <div style={{ display: 'flex', gap: 10, padding: '16px 24px 20px', borderTop: '1px solid var(--line)' }}>
          <button onClick={onClose} disabled={busy} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: '12px', opacity: busy ? .5 : 1 }}>Cancel</button>
          <button onClick={save} disabled={busy} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: '12px', opacity: busy ? .5 : 1 }}><Icon name="check" size={16} color="var(--on-clay)" /> {busy ? 'Saving…' : 'Save members'}</button>
        </div>
      </div>
    </div>
  );
}

// Console chat view for one group/team — read the scrollback + post as the church.
function GroupChatModal({ group, onClose }) {
  const [msgs, setMsgs] = React.useState([]);
  const members = window.useStewardMembers ? window.useStewardMembers() : [];   // resolve a sender's display name
  const nameFor = (pub) => { const mm = members.find(x => x.pubkey === pub); return (mm && (mm.name || '').trim()) || ('member …' + (pub || '').slice(-8)); };
  const [text, setText] = React.useState('');
  const [rxFor, setRxFor] = React.useState('');
  const [pin, setPin] = React.useState(null);     // the group's pinned message { msgId, text, by, ts } or null
  const [menuFor, setMenuFor] = React.useState('');   // message id whose moderation menu is open
  const scRef = React.useRef(null);
  const GROUP_EMOJI = ['❤️', '🙏', '👍', '😂', '🔥', '🎉'];
  React.useEffect(() => window.Steward.subscribeGroupChat(group.id, setMsgs), [group.id]);
  React.useEffect(() => window.Steward.subscribeGroupPin(group.id, setPin), [group.id]);
  React.useEffect(() => { if (scRef.current) scRef.current.scrollTop = scRef.current.scrollHeight; }, [msgs]);
  const send = () => { if (!text.trim()) return; window.Steward.publishPost(text.trim(), group.id); setText(''); };
  const react = (m, emoji) => { window.Steward.reactGroup(group.id, m.id, m.by, m.myReaction === emoji ? '-' : emoji); setRxFor(''); };
  const doPin = (m) => { window.Steward.pinPost(group.id, m); setMenuFor(''); };
  const doUnpin = () => { window.Steward.unpin(group.id); };
  const doRemove = (m) => { window.Steward.hideMessage(group.id, m.id); setMenuFor(''); };
  const msgText = (m) => {   // render polls gracefully (members vote in the member app); avoids showing raw JSON
    if (m.kind === 'poll') { try { const p = JSON.parse(m.text); return '📊 ' + (p.question || 'Poll') + ' — ' + (p.options || []).join(' · '); } catch { return '📊 Poll'; } }
    return (m.kind === 'prayer' ? '🙏 ' : '') + m.text;
  };
  // ── group events: schedule from the chat window + show what's upcoming ──
  const [gevents, setGevents] = React.useState([]);
  React.useEffect(() => (window.Steward.subscribeGroupEvents ? window.Steward.subscribeGroupEvents(group.id, setGevents) : undefined), [group.id]);
  const [composeEvt, setComposeEvt] = React.useState(false);
  const [evt, setEvt] = React.useState({ title: '', date: '', time: '', where: '' });
  const [evtBusy, setEvtBusy] = React.useState(false);
  const [evDetail, setEvDetail] = React.useState(null);   // a tapped event → full details
  const postEvent = async () => {
    if (!evt.title.trim() || !evt.date) return;
    setEvtBusy(true);
    try { await window.Steward.publishEvent({ ...evt, title: evt.title.trim(), where: evt.where.trim(), groupId: group.id }); } catch (e) {}
    setEvtBusy(false); setComposeEvt(false); setEvt({ title: '', date: '', time: '', where: '' });
  };
  const isTeam = group.kind === 'team';
  const accent = isTeam ? (group.accent || 'var(--clay)') : group.kind === 'broadcast' ? '#8a6717' : 'var(--sage)';
  return (
    <div style={{ width: 344, maxWidth: 'calc(100vw - 48px)', height: 480, maxHeight: '82vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: '16px 16px 0 0', border: '1px solid var(--line)', borderBottom: 'none', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', animation: 'lumenRise .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 15px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, background: `color-mix(in oklab, ${accent} 16%, var(--surface))`, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={isTeam ? (group.icon || 'shield') : group.kind === 'broadcast' ? 'send' : 'chat'} size={19} /></div>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{group.name}</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{isTeam ? 'Team chat' : group.kind === 'broadcast' ? 'Broadcast' : 'Group chat'} · you post as the church</div></div>
          <button onClick={() => setComposeEvt(v => !v)} title="Schedule an event for this group" style={{ border: 'none', background: composeEvt ? 'var(--clay-soft)' : 'var(--clay)', color: composeEvt ? 'var(--clay-ink)' : '#fff', borderRadius: 9, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5 }}><Icon name="calPlus" size={15} color="currentColor" /> Event</button>
          <button onClick={onClose} title="Close chat" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', display: 'flex' }}><Icon name="x" size={16} /></button>
        </div>
        {pin && pin.msgId ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 14px', background: 'color-mix(in oklab, var(--gold) 11%, var(--surface))', borderBottom: '1px solid color-mix(in oklab, var(--gold) 30%, var(--line))' }}>
            <Icon name="pin" size={14} color="#8a6717" style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.5px', color: '#8a6717', marginBottom: 1 }}>PINNED</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{pin.text || '(message)'}</div>
            </div>
            <button onClick={doUnpin} title="Unpin" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 2, flexShrink: 0 }}><Icon name="x" size={15} /></button>
          </div>
        ) : null}
        {composeEvt ? (
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', background: 'color-mix(in oklab, var(--clay) 6%, var(--surface))', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <input value={evt.title} onChange={e => setEvt(v => ({ ...v, title: e.target.value }))} placeholder="Event title" style={{ boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 9, background: 'var(--surface)', padding: '8px 10px', fontSize: 13.5, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
            <div style={{ display: 'flex', gap: 7 }}>
              <input type="date" value={evt.date} onChange={e => setEvt(v => ({ ...v, date: e.target.value }))} style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 9, background: 'var(--surface)', padding: '8px 10px', fontSize: 13, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
              <input type="time" value={evt.time} onChange={e => setEvt(v => ({ ...v, time: e.target.value }))} style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 9, background: 'var(--surface)', padding: '8px 10px', fontSize: 13, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
            </div>
            <input value={evt.where} onChange={e => setEvt(v => ({ ...v, where: e.target.value }))} placeholder="Where (optional)" style={{ boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 9, background: 'var(--surface)', padding: '8px 10px', fontSize: 13, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
            <div style={{ display: 'flex', gap: 7 }}>
              <button onClick={postEvent} disabled={!evt.title.trim() || !evt.date || evtBusy} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: '8px', fontSize: 13, opacity: (evt.title.trim() && evt.date && !evtBusy) ? 1 : 0.5 }}>{evtBusy ? 'Posting…' : 'Post event'}</button>
              <button onClick={() => setComposeEvt(false)} className="sk-btn sk-btn--ghost" style={{ padding: '8px 12px', fontSize: 13 }}>Cancel</button>
            </div>
          </div>
        ) : null}
        {gevents.length ? (
          <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.5px', color: 'var(--clay-ink)', marginBottom: 5 }}>UPCOMING IN THIS GROUP</div>
            {gevents.slice(0, 3).map(ev => (
              <button key={ev.id} onClick={() => setEvDetail(ev)} title="See full details" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink)', padding: '3px 0', width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
                <Icon name="calendar" size={13} color="var(--clay)" />
                <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</span>
                <span style={{ color: 'var(--ink-3)', flexShrink: 0, marginLeft: 'auto' }}>{ev.date}{ev.time ? ' · ' + ev.time : ''}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div ref={scRef} className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          {msgs.length === 0 ? <div style={{ fontSize: 13.5, color: 'var(--ink-3)', textAlign: 'center', margin: 'auto' }}>No messages yet. Say hello to your church.</div> : null}
          {msgs.map(m => (
            <div key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '76%', display: 'flex', flexDirection: 'column', alignItems: m.mine ? 'flex-end' : 'flex-start' }}>
              {!m.mine ? <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginBottom: 2, paddingLeft: 4, fontWeight: 600 }}>{nameFor(m.by)}</div> : null}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexDirection: m.mine ? 'row-reverse' : 'row' }}>
                <div onClick={() => setRxFor(v => v === m.id ? '' : m.id)} title="Tap to react" style={{ padding: '9px 13px', borderRadius: 15, fontSize: 14, lineHeight: 1.4, background: m.mine ? 'var(--clay)' : 'var(--surface-2)', color: m.mine ? '#fff' : 'var(--ink)', border: m.mine ? 'none' : '1px solid var(--line)', cursor: 'pointer' }}>{msgText(m)}</div>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <button onClick={() => setMenuFor(v => v === m.id ? '' : m.id)} title="Moderate" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 3, borderRadius: 7 }}><Icon name="dots" size={15} /></button>
                  {menuFor === m.id ? (
                    <div style={{ position: 'absolute', top: 22, [m.mine ? 'left' : 'right']: 0, zIndex: 6, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: 5, minWidth: 154, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button onClick={() => (pin && pin.msgId === m.id) ? doUnpin() : doPin(m)} style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'none', cursor: 'pointer', padding: '8px 10px', borderRadius: 8, fontFamily: 'var(--font-ui)', fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', textAlign: 'left' }}><Icon name="pin" size={15} color="#8a6717" /> {(pin && pin.msgId === m.id) ? 'Unpin message' : 'Pin message'}</button>
                      <button onClick={() => doRemove(m)} style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'none', cursor: 'pointer', padding: '8px 10px', borderRadius: 8, fontFamily: 'var(--font-ui)', fontSize: 13.5, fontWeight: 600, color: 'var(--clay)', textAlign: 'left' }}><Icon name="trash" size={15} color="var(--clay)" /> Remove message</button>
                    </div>
                  ) : null}
                </div>
              </div>
              {m.reactions && m.reactions.length ? (
                <div style={{ display: 'flex', gap: 3, marginTop: 3, flexWrap: 'wrap' }}>
                  {Object.entries(m.reactions.reduce((a, e) => (a[e] = (a[e] || 0) + 1, a), {})).map(([emo, n]) => (
                    <button key={emo} onClick={() => react(m, emo)} title="Add or remove your reaction" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 6px', borderRadius: 999, fontSize: 11.5, border: '1px solid var(--line)', background: m.myReaction === emo ? 'color-mix(in oklab, var(--clay) 16%, var(--surface))' : 'var(--surface)', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>{emo}{n > 1 ? <span style={{ color: 'var(--ink-3)', fontWeight: 700 }}>{n}</span> : null}</button>
                  ))}
                </div>
              ) : null}
              {rxFor === m.id ? (
                <div style={{ display: 'flex', gap: 2, marginTop: 4, padding: '4px 6px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, boxShadow: 'var(--shadow)' }}>
                  {GROUP_EMOJI.map(emo => (
                    <button key={emo} onClick={() => react(m, emo)} title={'React with ' + emo} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 3px', borderRadius: 7, opacity: m.myReaction === emo ? 1 : 0.85 }}>{emo}</button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 9, padding: '12px 14px', borderTop: '1px solid var(--line)' }}>
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} placeholder="Message your church…" style={{ flex: 1, height: 42, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '0 14px', fontSize: 14, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
          <button onClick={send} disabled={!text.trim()} title="Send this message" className="sk-btn sk-btn--clay" style={{ padding: '0 16px', opacity: text.trim() ? 1 : 0.55 }}><Icon name="send" size={16} color="var(--on-clay)" /></button>
        </div>
        {evDetail && window.SchEventDetail ? React.createElement(window.SchEventDetail, { event: evDetail, onClose: () => setEvDetail(null) }) : null}
    </div>
  );
}

// Manage the church's group categories — named containers (e.g. "Lifegroups", "Cell groups") the
// steward sorts groups into. Add / rename / reorder / delete; deleting just un-categorises its groups.
function CategoriesModal({ cats, groups, onClose }) {
  const [adding, setAdding] = React.useState('');
  const [editId, setEditId] = React.useState(null);
  const [editName, setEditName] = React.useState('');
  const [pendingDelete, setPendingDelete] = React.useState(null);
  const countIn = (id) => (groups || []).filter(g => g.category === id).length;
  const add = () => { const n = adding.trim(); if (!n) return; window.Steward.publishCategory({ name: n, order: cats.length }); setAdding(''); };
  const saveEdit = () => { const c = cats.find(x => x.id === editId); if (c && editName.trim()) window.Steward.publishCategory({ ...c, name: editName.trim() }); setEditId(null); setEditName(''); };
  const move = (idx, dir) => { const j = idx + dir; if (j < 0 || j >= cats.length) return; const arr = cats.slice(); const t = arr[idx]; arr[idx] = arr[j]; arr[j] = t; arr.forEach((c, i) => { if (c.order !== i) window.Steward.publishCategory({ ...c, order: i }); }); };
  const del = () => { const c = pendingDelete; setPendingDelete(null); if (!c) return;
    (groups || []).filter(g => g.category === c.id).forEach(g => window.Steward.publishGroup({ ...g, category: undefined }));   // un-categorise its groups
    window.Steward.removeCategory(c.id);
  };
  const fld = { flex: 1, minWidth: 0, boxSizing: 'border-box', height: 42, padding: '0 13px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 14.5, color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontWeight: 600 };
  const iconBtn = (extra) => ({ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', ...extra });
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  const pdDlgRef = useStewDialog(() => setPendingDelete(null), !!pendingDelete);   // a11y: nested delete-confirm
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30, background: 'color-mix(in oklab, var(--ink) 32%, transparent)', backdropFilter: 'blur(3px)', animation: 'lumenFade .18s ease both' }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Group categories" tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: '100%', borderRadius: 22, background: 'var(--paper)', border: '1px solid var(--line)', boxShadow: '0 24px 70px rgba(0,0,0,.28)', overflow: 'hidden', animation: 'lumenScale .22s cubic-bezier(.2,.8,.3,1.1) both', outline: 'none' }}>
        <div className="no-scrollbar" style={{ padding: '24px 26px 0', maxHeight: '66vh', overflowY: 'auto' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, marginBottom: 4 }}>Group categories</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 18, lineHeight: 1.5 }}>Name your own groupings — e.g. <b>Lifegroups</b>, <b>Cell groups</b>, <b>Ministries</b> — then sort each group into one. Members see their groups under these headings.</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input autoFocus value={adding} onChange={e => setAdding(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="New category name…" style={fld} />
            <button onClick={add} className="sk-btn sk-btn--clay" style={{ padding: '0 16px', opacity: adding.trim() ? 1 : .5 }}><Icon name="plus" size={15} color="var(--on-clay)" /> Add</button>
          </div>
          {cats.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 10px', color: 'var(--ink-3)', fontSize: 13.5 }}>No categories yet. Add one above, then assign groups to it.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cats.map((c, i) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                  <Icon name="books" size={17} color="var(--clay)" />
                  {editId === c.id ? (
                    <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') { setEditId(null); setEditName(''); } }} onBlur={saveEdit} style={{ ...fld, height: 34 }} />
                  ) : (
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{countIn(c.id)} group{countIn(c.id) === 1 ? '' : 's'}</div></div>
                  )}
                  {editId === c.id ? null : (
                    <React.Fragment>
                      <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up" style={iconBtn({ opacity: i === 0 ? .35 : 1 })}><Icon name="chevU" size={15} color="currentColor" /></button>
                      <button onClick={() => move(i, 1)} disabled={i === cats.length - 1} title="Move down" style={iconBtn({ opacity: i === cats.length - 1 ? .35 : 1 })}><Icon name="chevD" size={15} color="currentColor" /></button>
                      <button onClick={() => { setEditId(c.id); setEditName(c.name); }} title="Rename" style={iconBtn()}><Icon name="pen" size={15} color="currentColor" /></button>
                      <button onClick={() => setPendingDelete(c)} title="Delete category" style={iconBtn({ color: 'var(--clay)' })}><Icon name="trash" size={15} color="currentColor" /></button>
                    </React.Fragment>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '20px 26px 22px' }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: '12px' }}>Done</button>
        </div>
      </div>
      {pendingDelete ? (
        <div onClick={(e) => { e.stopPropagation(); setPendingDelete(null); }} style={{ position: 'absolute', inset: 0, zIndex: 61, background: 'rgba(40,32,24,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div ref={pdDlgRef} role="dialog" aria-modal="true" aria-label={'Delete ' + pendingDelete.name} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: '94%', background: 'var(--surface)', borderRadius: 20, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 24, animation: 'lumenScale .2s ease both', outline: 'none' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19, marginBottom: 8 }}>Delete “{pendingDelete.name}”?</div>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 20px' }}>The category is removed. Its {countIn(pendingDelete.id)} group{countIn(pendingDelete.id) === 1 ? '' : 's'} stay — they just become uncategorised.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setPendingDelete(null)} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12 }}>Keep it</button>
              <button onClick={del} className="sk-btn" style={{ flex: 1, padding: 12, background: 'var(--clay)', color: 'var(--on-clay)' }}><Icon name="trash" size={15} color="var(--on-clay)" /> Delete</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DashGroups() {
  const all = window.useStewardGroups();   // groups AND teams (teams are chat channels too)
  const realCount = useRealMemberCount();   // "who can see this" must not count blocked or pending people
  const rosters = window.useStewardRosters();
  const members = window.useStewardMembers ? window.useStewardMembers() : [];
  const cats = window.useStewardCategories ? window.useStewardCategories() : [];   // named containers groups sit in
  const [catsOpen, setCatsOpen] = React.useState(false);
  const recipsFor = (g) => g.visibility === 'invite' ? (g.members || []) : members.map(m => m.pubkey);
  // seal/unseal a single group. Enabling loses nothing (past plaintext stays); KeyDistributor keys new members after.
  const [sealing, setSealing] = React.useState(null);   // { g, on } → styled confirm before (un)sealing
  const toggleEncrypt = (g) => setSealing({ g, on: !g.encrypted });
  const doSeal = () => {
    const s = sealing; setSealing(null); if (!s) return;
    window.Steward.publishGroup({ ...s.g, encrypted: s.on });
    if (s.on && window.Steward.publishGroupKey) window.Steward.publishGroupKey(s.g.id, recipsFor(s.g));
  };
  const [adding, setAdding] = React.useState(new URLSearchParams(location.search).get('newgroup') === '1');
  const [chatGroup, setChatGroup] = React.useState(null);
  const [teamMembers, setTeamMembers] = React.useState(null);   // { team, people }
  const [leadersFor, setLeadersFor] = React.useState(null);     // group whose event-leaders we're editing
  const [editMembersFor, setEditMembersFor] = React.useState(null);   // invite-only group whose members we're editing
  const [pendingDelete, setPendingDelete] = React.useState(null);   // group awaiting delete confirmation
  const [undo, setUndo] = React.useState(null);                     // recently-deleted group (restorable)
  const undoTimer = React.useRef(null);
  const items = all.map(g => ({ ...g, sub: groupLiveSub(g, realCount, rosters), ic: g.kind === 'team' ? (g.icon || 'shield') : g.kind === 'broadcast' ? 'send' : 'chat', fg: g.kind === 'team' ? (g.accent || 'var(--clay)') : g.kind === 'broadcast' ? '#8a6717' : 'var(--sage)' }));
  // type filter for the list — only surfaces when there's more than one type to choose between
  const groupFilters = (() => {
    const f = [];
    if (items.some(g => g.kind !== 'team' && g.kind !== 'broadcast')) f.push({ key: 'group', label: 'Groups', test: g => g.kind !== 'team' && g.kind !== 'broadcast' });
    if (items.some(g => g.kind === 'team')) f.push({ key: 'team', label: 'Teams', test: g => g.kind === 'team' });
    if (items.some(g => g.kind === 'broadcast')) f.push({ key: 'broadcast', label: 'Broadcasts', test: g => g.kind === 'broadcast' });
    return f.length > 1 ? f : null;
  })();
  const confirmDelete = () => {
    const g = pendingDelete; if (!g) return;
    window.Steward.removeGroup(g.id);
    setPendingDelete(null); setUndo(g);
    clearTimeout(undoTimer.current); undoTimer.current = setTimeout(() => setUndo(null), 9000);
  };
  const doUndo = () => { if (undo) window.Steward.publishGroup({ id: undo.id, name: undo.name, kind: undo.kind, sub: undo.sub, icon: undo.icon, accent: undo.accent, category: undo.category }); clearTimeout(undoTimer.current); setUndo(null); };
  const pdDlgRef = useStewDialog(() => setPendingDelete(null), !!pendingDelete);   // a11y: delete-confirm
  const tmDlgRef = useStewDialog(() => setTeamMembers(null), !!teamMembers);        // a11y: team-members list
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      {pendingDelete ? (
        <div onClick={() => setPendingDelete(null)} style={{ position: 'absolute', inset: 0, zIndex: 95, background: 'rgba(40,32,24,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div ref={pdDlgRef} role="dialog" aria-modal="true" aria-label={'Delete ' + pendingDelete.name} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: '94%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26, animation: 'lumenScale .2s ease both' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 8 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="trash" size={21} /></div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>Delete “{pendingDelete.name}”?</div>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 8px' }}>This removes the {pendingDelete.kind === 'team' ? 'team and its rota roles' : 'group'} for everyone. Members will no longer see it{pendingDelete.kind === 'team' ? ', and its rota assignments stop applying' : ' or its chat'}.</p>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 20px' }}>Past messages stay on the relay but won’t be shown. You can undo this for a few seconds.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setPendingDelete(null)} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 13, fontSize: 14 }}>Keep it</button>
              <button onClick={confirmDelete} className="sk-btn" style={{ flex: 1, padding: 13, fontSize: 14, background: 'var(--clay)', color: 'var(--on-clay)' }}><Icon name="trash" size={15} color="var(--on-clay)" /> Delete</button>
            </div>
          </div>
        </div>
      ) : null}
      {undo ? (
        <div style={{ position: 'absolute', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 90, display: 'flex', alignItems: 'center', gap: 14, background: 'var(--ink)', color: 'var(--paper)', padding: '11px 14px 11px 18px', borderRadius: 14, boxShadow: 'var(--shadow-lg)', fontSize: 13.5, fontWeight: 600 }}>
          Removed “{undo.name}”
          <button onClick={doUndo} style={{ border: 'none', background: 'rgba(255,255,255,.16)', color: '#fff', borderRadius: 9, padding: '6px 13px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13 }}>Undo</button>
        </div>
      ) : null}
      <ListPanel title="Groups, teams & rooms" addLabel="New group" onAdd={() => setAdding(true)} items={items} filters={groupFilters}
        reorderable onReorder={(arr) => arr.forEach((g, i) => { if (g.order !== i) window.Steward.publishGroup({ ...g, order: i }); })}
        empty="No groups yet — create your church's first chat room (or a team on the Rota page)."
        headerExtra={<button onClick={() => setCatsOpen(true)} className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 13 }} title="Create named categories (e.g. Lifegroups) to group your groups"><Icon name="books" size={15} /> Categories{cats.length ? ' · ' + cats.length : ''}</button>}
        renderRight={(it) => (
          <React.Fragment>
            {it.kind !== 'team' && cats.length ? (
              <select value={it.category || ''} onChange={(e) => window.Steward.publishGroup({ ...it, category: e.target.value || undefined })} title="Put this group in a category" onClick={(e) => e.stopPropagation()} style={{ border: '1px solid ' + (it.category ? 'color-mix(in oklab, var(--clay) 35%, var(--line))' : 'var(--line)'), background: it.category ? 'color-mix(in oklab, var(--clay) 7%, var(--surface))' : 'var(--surface)', borderRadius: 9, padding: '5px 8px', cursor: 'pointer', color: it.category ? 'var(--clay)' : 'var(--ink-3)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}>
                <option value="">No category</option>
                {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : null}
            {it.kind === 'broadcast' ? <SkPill tint="gold">Broadcast</SkPill> : null}
            {it.kind === 'team' ? <button onClick={() => { const r = rosters.find(x => x.team === it.id) || { people: [] }; setTeamMembers({ team: it, people: r.people || [] }); }} title="See team members" style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}><SkPill tint="clay">Team · {(rosters.find(x => x.team === it.id) || { people: [] }).people.length}</SkPill></button> : null}
            {(it.leaders && it.leaders.length) ? <SkPill tint="sage">{it.leaders.length} leader{it.leaders.length === 1 ? '' : 's'}</SkPill> : null}
            <button onClick={() => window.Steward.publishGroup({ ...it, childsafe: !it.childsafe })} title={it.childsafe ? 'Child-safe — members marked as a child can join. Click to restrict to adults' : 'Hidden from children. Click to mark child-safe so under-18s can join'} style={{ border: '1px solid ' + (it.childsafe ? 'color-mix(in oklab, var(--sage) 40%, var(--line))' : 'var(--line)'), background: it.childsafe ? 'color-mix(in oklab, var(--sage) 8%, var(--surface))' : 'var(--surface)', borderRadius: 9, padding: '5px 9px', cursor: 'pointer', color: it.childsafe ? 'var(--sage)' : 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}><Icon name={it.childsafe ? 'check' : 'pray'} size={14} color="currentColor" /> {it.childsafe ? 'Child-safe' : 'Child-safe?'}</button>
            {it.kind !== 'team' ? <button onClick={() => toggleEncrypt(it)} title={it.encrypted ? 'Sealed end-to-end — even the relay can’t read it. Click to turn off' : 'Encrypt this group end-to-end. Click to seal'} style={{ border: '1px solid ' + (it.encrypted ? 'color-mix(in oklab, var(--clay) 40%, var(--line))' : 'var(--line)'), background: it.encrypted ? 'color-mix(in oklab, var(--clay) 8%, var(--surface))' : 'var(--surface)', borderRadius: 9, padding: '5px 9px', cursor: 'pointer', color: it.encrypted ? 'var(--clay)' : 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}><Icon name="lock" size={14} color="currentColor" /> {it.encrypted ? 'Encrypted' : 'Encrypt?'}</button> : null}
            {it.visibility === 'invite' ? <button onClick={() => setEditMembersFor(it)} title="Manage who's in this invite-only group" style={{ border: '1px solid color-mix(in oklab, var(--clay) 35%, var(--line))', background: 'color-mix(in oklab, var(--clay) 7%, var(--surface))', borderRadius: 9, padding: '5px 9px', cursor: 'pointer', color: 'var(--clay)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}><Icon name="lock" size={14} color="currentColor" /> Invite · {(it.members || []).length}</button> : null}
            <button onClick={() => setLeadersFor(it)} title="Members who help run this group" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 9px', cursor: 'pointer', color: 'var(--sage)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}><Icon name="users" size={15} color="currentColor" /> Leaders</button>
            <button onClick={() => window.dispatchEvent(new CustomEvent('steward-open-group-chat', { detail: it }))} title="Open chat" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 9px', cursor: 'pointer', color: 'var(--clay)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}><Icon name="chat" size={15} color="currentColor" /> Chat</button>
          </React.Fragment>
        )}
        renderAside={(it) => (
          <button onClick={() => setPendingDelete(it)} title={it.kind === 'team' ? 'Remove team' : 'Remove group'} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '8px 10px', minWidth: 40, minHeight: 40, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="trash" size={15} color="currentColor" /></button>
        )} />
      <NewGroupModal open={adding} onClose={() => setAdding(false)} />
      {catsOpen ? <CategoriesModal cats={cats} groups={all} onClose={() => setCatsOpen(false)} /> : null}
      {chatGroup ? <GroupChatModal group={chatGroup} onClose={() => setChatGroup(null)} /> : null}
      {teamMembers ? (
        <div onClick={() => setTeamMembers(null)} style={{ position: 'absolute', inset: 0, zIndex: 92, background: 'rgba(40,32,24,.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div ref={tmDlgRef} role="dialog" aria-modal="true" aria-label={teamMembers.team.name} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: '94%', maxHeight: '80%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 24, animation: 'lumenScale .2s ease both' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: `color-mix(in oklab, ${teamMembers.team.accent || 'var(--clay)'} 16%, var(--surface))`, color: teamMembers.team.accent || 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={teamMembers.team.icon || 'shield'} size={20} /></div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{teamMembers.team.name}</div><div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{teamMembers.people.length} member{teamMembers.people.length === 1 ? '' : 's'}</div></div>
              <button onClick={() => setTeamMembers(null)} title="Close" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', display: 'flex' }}><Icon name="x" size={16} /></button>
            </div>
            <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {teamMembers.people.length === 0 ? <div style={{ fontSize: 13.5, color: 'var(--ink-3)', textAlign: 'center', padding: 24 }}>No one on this team yet — add people via the team’s roster on the Rota page.</div>
                : teamMembers.people.map((p, i) => (
                  <div key={p.id || p.pub || i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 999, flexShrink: 0, background: `linear-gradient(150deg, ${teamMembers.team.accent || 'var(--clay)'}, color-mix(in oklab, ${teamMembers.team.accent || 'var(--clay)'} 60%, #16120c))`, color: 'var(--on-clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 11 }}>{(p.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>{p.pub ? <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>linked member</div> : <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>not linked to an app account</div>}</div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ) : null}
      {leadersFor ? <GroupLeadersModal group={leadersFor} onClose={() => setLeadersFor(null)} /> : null}
      {editMembersFor ? <EditGroupMembersModal group={editMembersFor} onClose={() => setEditMembersFor(null)} /> : null}
      {sealing ? <SkConfirm icon="lock" title={(sealing.on ? 'Seal “' : 'Unseal “') + sealing.g.name + '”?'} confirmLabel={sealing.on ? 'Seal it' : 'Unseal'} body={sealing.on ? 'From now on its messages are encrypted end-to-end — not even the relay can read them. Messages already posted stay as they are.' : 'New messages become readable by the relay again. Messages already sealed stay sealed.'} onConfirm={doSeal} onCancel={() => setSealing(null)} /> : null}
    </div>
  );
}

// pick which members may post events for a group. The chosen pubkeys go into the group def's `leaders`;
// the relay then lets exactly those members publish events scoped to this group.
function GroupLeadersModal({ group, onClose }) {
  const members = window.useStewardMembers().filter(m => m.pubkey);
  const [sel, setSel] = React.useState(() => new Set(group.leaders || []));
  const [saving, setSaving] = React.useState(false);
  const toggle = (pk) => setSel(s => { const n = new Set(s); n.has(pk) ? n.delete(pk) : n.add(pk); return n; });
  const save = async () => {
    setSaving(true);
    const before = new Set(group.leaders || []);
    await window.Steward.setGroupLeaders(group, [...sel]);
    // tell newly-added leaders, so they know they can now manage this group
    const added = [...sel].filter(pk => !before.has(pk));
    for (const pk of added) {
      try { await window.Steward.sendDM(pk, `You’re now a leader of “${group.name}”. You can post events for it from your app — open the group and tap “Event”.`); } catch {}
    }
    onClose();
  };
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 95, background: 'rgba(40,32,24,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Group leaders" tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: '94%', maxHeight: '82%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 24, animation: 'lumenScale .2s ease both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="users" size={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19 }}>Group leaders</div><div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{group.name}</div></div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 14px' }}>Leaders help run this group. They can create events for it from their app (shown on everyone’s calendar and in the group’s chat), and we’ll message them to let them know. You can change this anytime.</p>
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {members.length === 0 ? <div style={{ fontSize: 13.5, color: 'var(--ink-3)', textAlign: 'center', padding: 24 }}>No app members yet. Once people join your church they’ll be selectable here.</div>
            : members.map(m => {
              const on = sel.has(m.pubkey);
              const nm = m.name || ('Anon · ' + (m.npub || m.pubkey).slice(-6));
              return (
                <button key={m.pubkey} onClick={() => toggle(m.pubkey)} title="Tick to make this person a leader, untick to remove them" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12, border: '1px solid ' + (on ? 'color-mix(in oklab, var(--sage) 45%, var(--line))' : 'var(--line)'), background: on ? 'color-mix(in oklab, var(--sage) 8%, var(--surface))' : 'var(--surface-2)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
                  <SkBadge initials={(nm.replace(/^Anon · /, '').split(/\s+/).map(w => w[0]).join('').slice(0, 2) || 'AN').toUpperCase()} size={32} radius={9} accent={on ? 'var(--sage)' : undefined} />
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{nm}</div><div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>{(m.npub || '').slice(0, 16)}…</div></div>
                  <div style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, border: '1.5px solid ' + (on ? 'var(--sage)' : 'var(--line)'), background: on ? 'var(--sage)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on ? <Icon name="check" size={14} stroke={3} color="#fff" /> : null}</div>
                </button>
              );
            })}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12, fontSize: 14 }}>Cancel</button>
          <button onClick={save} disabled={saving} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 12, fontSize: 14, opacity: saving ? 0.6 : 1 }}><Icon name="check" size={15} color="var(--on-clay)" /> {saving ? 'Saving…' : 'Save leaders'}</button>
        </div>
      </div>
    </div>
  );
}

// New team — a ministry/rota team with an icon, accent and a starter role list. Creates a kind:'team'
// group (so it's also a chat channel) + a roster doc (its roles + people). Lives on the Rota page.
function NewTeamModal({ open, onClose }) {
  const [name, setName] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [icon, setIcon] = React.useState('hand');
  const [accent, setAccent] = React.useState('#C25A38');
  const [roles, setRoles] = React.useState('');
  const [selId, setSelId] = React.useState('');   // which preset is applied (so switching repopulates)
  React.useEffect(() => { if (open) { setName(''); setDesc(''); setIcon('hand'); setAccent('#C25A38'); setRoles(''); setSelId(''); } }, [open]);
  const dlgRef = useStewDialog(onClose, open);   // a11y: Escape + focus — before the early return so hook order is stable
  if (!open) return null;
  const applyPreset = (p) => {
    setIcon(p.icon); setAccent(p.accent);
    // switching templates repopulates name/roles — but keep anything you typed by hand (i.e. that no
    // longer matches the previously-applied preset).
    const prev = (window.TEAM_PRESETS || []).find(x => x.id === selId);
    if (!name.trim() || (prev && name === prev.name)) setName(p.name);
    if (!roles.trim() || (prev && roles === prev.roles)) setRoles(p.roles);
    setSelId(p.id);
  };
  const create = () => {
    if (!name.trim()) return;
    const roleList = roles.split('\n').map(s => s.trim()).filter(Boolean).map(n => ({ name: n }));
    Promise.resolve(window.Steward.publishGroup({ name: name.trim(), kind: 'team', sub: desc.trim(), icon, accent }))
      .then(g => { if (g && g.id) window.Steward.publishRoster(g.id, { roles: roleList, people: [] }); });
    onClose();
  };
  const fld = { width: '100%', boxSizing: 'border-box', height: 44, border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface-2)', padding: '0 13px', fontSize: 14.5, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' };
  const lbl = { fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '14px 0 6px' };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'rgba(40,32,24,.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="New team" tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 500, maxWidth: '93%', maxHeight: '90%', overflow: 'auto', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 28 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>New team</div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 4px' }}>Pick a kind to start from, then tweak. The team is a private chat channel and its people fill rota slots.</p>
        <div style={lbl}>Kind</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(window.TEAM_PRESETS || []).map(p => {
            const on = selId === p.id;
            return (
              <button key={p.id} onClick={() => applyPreset(p)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13,
                border: on ? `2px solid ${p.accent}` : '1px solid var(--line)', background: on ? `color-mix(in oklab, ${p.accent} 10%, var(--surface))` : 'var(--surface)', color: 'var(--ink)' }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, background: `color-mix(in oklab, ${p.accent} 16%, var(--surface))`, color: p.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={p.icon} size={15} /></div>{p.name}</button>
            );
          })}
        </div>
        <div style={lbl}>Name</div>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. Worship Team" style={fld} />
        <div style={lbl}>Roles to fill (one per line)</div>
        <textarea value={roles} onChange={e => setRoles(e.target.value)} rows={5} placeholder={'Lead\nVocals\nKeys\nSound'} style={{ ...fld, height: 'auto', padding: '11px 13px', lineHeight: 1.5, resize: 'vertical', fontFamily: 'var(--font-ui)' }} />
        <div style={lbl}>What's it for (optional)</div>
        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Sunday musicians & singers" style={fld} />
        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12, fontSize: 14 }}>Cancel</button>
          <button onClick={create} disabled={!name.trim()} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 12, fontSize: 14, opacity: name.trim() ? 1 : 0.55 }}><Icon name="plus" size={16} color="var(--on-clay)" /> Create team</button>
        </div>
      </div>
    </div>
  );
}
window.NewTeamModal = NewTeamModal;

// Its own card, not a footer inside Relays. Running a relay box is a separate decision from managing the
// relays a church already publishes to, and buried under the relay list it read like a footnote to it.
function DashRunRelayCard() {
  const isRelayApp = typeof location !== 'undefined' && new URLSearchParams(location.search).get('relayapp') === '1';
  if (isRelayApp) return (
    <Panel title="This computer is your relay">
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 11 }}>It’s running as part of this app — your church uses it automatically. The control panel has the advanced relay settings (make it reachable from anywhere, software updates, storage).</div>
      <a href="/relay-app/control.html" className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13, textDecoration: 'none', display: 'inline-flex' }}><Icon name="globe" size={15} color="currentColor" /> Open relay control panel</a>
    </Panel>
  );
  return (
    <Panel title="Run your own relay box">
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 11 }}>The TrinityOne Suite app turns any always-on computer into your church’s relay — no command line. Install it, open it, then add the address it gives you to your relays.</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[['macOS', 'TrinityOne-Suite-macos-arm64.dmg'], ['Windows', 'TrinityOne-Suite-windows-x64-setup.exe'], ['Linux', 'TrinityOne-Suite-linux-x86_64.AppImage']].map(([label, file]) => (
          <a key={label} href={'https://github.com/TrinityOneAdmin/TrinityOne/releases/latest/download/' + file} target="_blank" rel="noopener" className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13, textDecoration: 'none' }}><Icon name="download" size={15} color="currentColor" /> {label}</a>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.5 }}>Download &amp; open it — it starts your relay. <a href="https://github.com/TrinityOneAdmin/TrinityOne/releases/latest" target="_blank" rel="noopener" style={{ color: 'var(--clay)' }}>Other builds</a> (Debian package, older Macs). Headless server? <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>curl -fsSL app.trinityone.church/relay-app/install.sh | sudo bash</span></div>
    </Panel>
  );
}

function DashRelaysCard() {
  const status = window.useStewardRelays();   // [{ url, status:'on'|'off', ms }]
  const host = (typeof location !== 'undefined' && location.host) || '';
  const online = status.filter(r => r.status === 'on').length;
  const checking = status.length === 0;
  const allUp = online === status.length;
  const own = window.Steward.ownRelay ? window.Steward.ownRelay() : '';
  const [draft, setDraft] = React.useState('');
  const [err, setErr] = React.useState('');
  const [syncBusy, setSyncBusy] = React.useState(false);
  const [syncMsg, setSyncMsg] = React.useState(null);
  const [backup, setBackup] = React.useState(null);   // D2: { boxes, online, syncOn } — distinct relay BOXES (redundancy)
  React.useEffect(() => { let ok = true; (async () => { try { const b = await window.Steward.backupState(); if (ok) setBackup(b); } catch {} })(); return () => { ok = false; }; }, [status.length]);
  const doSync = async (on) => {
    setSyncBusy(true); setSyncMsg(null);
    try { const r = on ? await window.Steward.syncEnable() : await window.Steward.syncDisable(); setSyncMsg({ ok: true, text: on ? '✓ Sync on — your ' + r.relays + ' relays will keep each other in step.' : 'Sync turned off.' }); }
    catch (e) { setSyncMsg({ ok: false, text: e.message || 'Couldn’t update sync.' }); }
    setSyncBusy(false);
  };
  const addRelay = () => {
    const r = window.Steward.addRelay && window.Steward.addRelay(draft);
    if (!r) { setErr('Enter a relay address, e.g. nos.lol (or wss://relay.example.com)'); return; }
    setDraft(''); setErr('');
  };
  // Connect a church to a relay by its memorable NAME (Phase 2): resolve the handle at the directory → add the
  // relay. (Registering write-access still uses the token/pairing below.)
  const [byName, setByName] = React.useState('');
  const [byNameMsg, setByNameMsg] = React.useState(null);
  const RELAY_DIRECTORY = 'https://app.trinityone.church';
  const connectByName = async () => {
    const n = (byName || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''); if (!n) return;   // "Quiet Dove 45" → "quiet-dove-45"
    setByNameMsg({ text: 'Looking up “' + n + '”…' });
    try {
      const j = await window.Steward.resolveRelayName(n);   // mirrored directory — tries this church's relay + the shared hosts
      if (!j || !j.url) { setByNameMsg({ ok: false, text: '✗ No relay is registered under “' + n + '”.' }); return; }
      window.Steward.addRelay(j.url);
      window.Steward.rememberRelayName(n, j.url);   // so it auto-follows when the relay's tunnel url rotates
      setByNameMsg({ text: 'Connecting your church…' });
      let reg = { ok: false }; try { reg = await window.Steward.registerAtRelay(j.url, ''); } catch (e) {}
      setByNameMsg({ ok: true, text: reg.ok ? '✓ Connected to “' + n + '” — your church is registered and can post.' : '✓ Added “' + n + '”. If it rejects your posts, the relay operator may need to approve your church (register below).' });
      setByName('');
    } catch (e) { setByNameMsg({ ok: false, text: '✗ Couldn’t reach the relay directory.' }); }
  };
  // Bring a church's history onto THIS relay by copying it from another (e.g. a community node after a restore).
  const [cloneSrc, setCloneSrc] = React.useState('');
  const [cloneMsg, setCloneMsg] = React.useState(null);
  const [cloning, setCloning] = React.useState(false);
  const cloneFromHere = async () => {
    const raw = (cloneSrc || '').trim(); if (!raw || cloning) return;
    setCloning(true); setCloneMsg({ text: 'Copying your church’s history…' });
    try {
      let url = raw;
      if (!/:\/\//.test(raw) && !raw.includes('.')) {   // a name, not a URL → resolve via the mirrored directory
        const jj = await window.Steward.resolveRelayName(raw);
        if (!jj || !jj.url) { setCloneMsg({ ok: false, text: '✗ No relay named “' + raw + '”.' }); setCloning(false); return; }
        url = jj.url;
      }
      const res = await window.Steward.cloneFromRelay(url);
      setCloneMsg({ ok: true, text: '✓ Copied ' + (res && res.imported != null ? res.imported + ' events' : 'your church’s data') + ' onto this relay.' });
      setCloneSrc('');
    } catch (e) { setCloneMsg({ ok: false, text: '✗ ' + ((e && e.message) || 'Clone failed.') }); }
    setCloning(false);
  };
  // FEDERATION Phase 3c — auto-find open relays (primary + backup) that have offered to host new churches.
  const [finding, setFinding] = React.useState(false);
  const [findMsg, setFindMsg] = React.useState('');
  const autoFind = async () => {
    setFinding(true); setFindMsg('');
    try {
      const picks = window.Steward.autoPickRelays ? await window.Steward.autoPickRelays(2) : [];
      if (picks && picks.length) setFindMsg('✓ Added ' + picks.length + ' relay' + (picks.length > 1 ? 's' : '') + ' for backup: ' + picks.map(p => p.name || p.url).join(', '));
      else setFindMsg('No open relays available to join right now — your church stays on its current relays.');
    } catch (e) { setFindMsg('✗ ' + (e.message || 'Couldn’t search for relays.')); }
    setFinding(false);
  };
  // The copy lands on whichever relay is serving this console — which "this relay" did nothing to convey
  // from a console that lists several. Name it. Read from the engine, not location.host: when the console
  // is served from pages.dev or runs natively the destination falls back to the canonical relay, so the
  // address in the URL bar is exactly the case where guessing would print the wrong one.
  const cloneDest = React.useMemo(() => {
    try { return String(window.Steward.ownRelay() || '').replace(/^wss?:\/\//i, '').replace(/\/relay\/?$/i, '').replace(/\/+$/, ''); }
    catch (e) { return ''; }
  }, []);
  const [regOpen, setRegOpen] = React.useState(false);
  // shown only after this relay has actually refused a write — see noteRelayRejection(). Pasting a
  // relay's admin token hands over full control of that relay, so it is not something to leave sitting
  // on screen inviting a steward to go and find one.
  const [regNeeded, setRegNeeded] = React.useState(relayRejectionActive);
  React.useEffect(() => {
    const onRejected = () => setRegNeeded(true);
    // A write landing (steward-publish-ok) means the relay is accepting our posts again — so whatever the
    // steward did to fix it (in-console token, restored key, operator added the church), clear the alarm.
    const onOk = () => { clearRelayRejection(); setRegNeeded(false); };
    const onCleared = () => setRegNeeded(false);
    window.addEventListener('steward-relay-rejected', onRejected);
    window.addEventListener('steward-publish-ok', onOk);
    window.addEventListener('steward-relay-cleared', onCleared);
    return () => { window.removeEventListener('steward-relay-rejected', onRejected); window.removeEventListener('steward-publish-ok', onOk); window.removeEventListener('steward-relay-cleared', onCleared); };
  }, []);
  const [regToken, setRegToken] = React.useState('');
  const [regMsg, setRegMsg] = React.useState('');
  const [regBusy, setRegBusy] = React.useState(false);
  const register = async () => {
    if (!regToken.trim()) return;
    setRegBusy(true); setRegMsg('Registering…');
    try {
      await window.Steward.registerWithRelay(regToken.trim());
      setRegMsg('✓ Done — the relay will accept this church now.');
      clearRelayRejection();   // the problem this control exists for is solved — clear the alarm + sync listeners
      setRegToken('');
    }
    catch (e) { setRegMsg('✗ ' + (e.message || 'Couldn’t reach the relay.')); }
    setRegBusy(false);
  };
  return (
      <Panel title="Relays" action={!checking ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: allUp ? 'var(--sage)' : 'var(--clay)' }}><span style={{ width: 8, height: 8, borderRadius: 999, background: allUp ? 'var(--sage)' : 'var(--clay)' }} /> {online}/{status.length} online</span> : null}>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>Where your church publishes. Add your own relay (self-host it with the TrinityOne Suite) and public ones for redundancy — if one is offline, members reach another.</div>
        {/* D2: single-point-of-failure nudge (counts DISTINCT relay boxes by identity — two routes to one box don't
            count as redundancy) — or a "backup on" reassurance once the church runs 2+ separate relays that mirror. */}
        {backup && backup.boxes < 2 ? (
          <div style={{ display: 'flex', gap: 11, padding: '12px 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--clay)', marginBottom: 14 }}>
            <div style={{ flexShrink: 0, color: 'var(--clay)', fontSize: 16, lineHeight: 1.3, fontWeight: 800 }}>⚠</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}><b style={{ color: 'var(--ink)' }}>One relay is a single point of failure.</b> If it goes offline, members can’t reach your church. Add a second relay your church runs — self-host with the TrinityOne Suite, or connect one by name below — and your data will mirror across both automatically.</div>
          </div>
        ) : backup && backup.syncOn ? (
          <div style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '10px 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 14 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--sage)', flexShrink: 0 }} />
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}><b style={{ color: 'var(--ink)' }}>Backup on.</b> Your {backup.boxes} relays mirror each other — if one goes down, nothing is lost.</div>
          </div>
        ) : null}
        {checking ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '8px 2px' }}>Checking relays…</div> : null}
        {/* One line per relay: address, role, health. It used to stack the URL over an indented meta row —
            right for a narrow card, but this card is wide now and two relays were eating a third of it for
            two short addresses. Everything sits inline and wraps only if the card actually gets narrow. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {status.map(r => {
            const self = host && r.url.includes(host);
            const up = r.status === 'on';
            return (
              <div key={r.url} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 12px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--surface)', color: up ? 'var(--sage)' : 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="globe" size={15} color="currentColor" /></div>
                <div style={{ flex: 1, minWidth: 140, fontWeight: 700, fontSize: 12.5, fontFamily: 'var(--mono)', overflowWrap: 'anywhere', lineHeight: 1.35 }}>{r.url}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
                  {self ? <SkPill tint="clay">Self-hosted</SkPill> : <SkPill tint="ink">Shared</SkPill>}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: up ? 'var(--sage)' : 'var(--clay)' }}><span style={{ width: 8, height: 8, borderRadius: 999, background: up ? 'var(--sage)' : 'var(--clay)' }} /> {up ? 'Live' : 'Offline'}</span>
                  {up && r.ms != null ? <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>· {r.ms}ms</span> : null}
                  {!self && r.url !== own ? <button onClick={() => window.Steward.removeRelay(r.url)} title="Remove relay" aria-label="Remove relay" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 7px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="trash" size={14} color="currentColor" /></button> : null}
                </div>
              </div>
            );
          })}
        </div>
        {/* relay actions → responsive 2-column grid so the many sections sit side by side on a wide card */}
        <div className="relay-grid">
        {/* add a public relay (redundancy) */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 9 }}>
            <input value={draft} onChange={e => { setDraft(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') addRelay(); }}
              placeholder="nos.lol  ·  relay.damus.io  ·  wss://relay.example.com" spellCheck={false} autoCapitalize="none"
              style={{ flex: 1, height: 42, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink)', outline: 'none' }} />
            <button onClick={addRelay} className="sk-btn sk-btn--clay" style={{ padding: '0 16px', fontSize: 13 }}><Icon name="plus" size={15} color="var(--on-clay)" /> Add relay</button>
          </div>
          {err ? <div style={{ fontSize: 12, color: 'var(--clay-ink)', marginTop: 7 }}>{err}</div> : null}
          <button onClick={autoFind} disabled={finding} title="Only lists relays that publicly offer to host churches and that enforce TrinityOne’s membership + safeguarding rules" className="sk-btn sk-btn--ghost" style={{ marginTop: 9, fontSize: 13, opacity: finding ? 0.6 : 1 }}><Icon name="globe" size={15} color="currentColor" /> {finding ? 'Searching…' : 'Auto-find relays for me'}</button>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.45 }}>Lists only relays that offer to host churches and enforce TrinityOne’s rules — so your safeguarding + membership policy still applies.</div>
          {findMsg ? <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 7, lineHeight: 1.45 }}>{findMsg}</div> : null}
          {/* connect to a relay by its memorable name (resolved via the directory) */}
          <div style={{ marginTop: 13 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.5px', color: 'var(--ink-3)', marginBottom: 4 }}>OR CONNECT BY NAME</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 7, lineHeight: 1.45 }}>The name the relay’s operator claimed in its panel — it always points at the relay’s current address, even if the tunnel URL changes.</div>
            <div style={{ display: 'flex', gap: 9 }}>
              <input value={byName} onChange={e => { setByName(e.target.value); setByNameMsg(null); }} onKeyDown={e => { if (e.key === 'Enter') connectByName(); }}
                placeholder="your relay’s name, e.g. grace-city" spellCheck={false} autoCapitalize="none"
                aria-label="Relay name to connect to" title="Type the name the relay’s operator claimed (e.g. grace-city). It resolves to the relay’s current address, so it keeps working even after the tunnel URL changes."
                style={{ flex: 1, height: 42, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink)', outline: 'none' }} />
              <button onClick={connectByName} aria-label="Connect to relay by name" title="Look up this name in the relay directory and add its relay to your church." className="sk-btn sk-btn--ghost" style={{ padding: '0 16px', fontSize: 13, whiteSpace: 'nowrap' }}><Icon name="globe" size={15} color="currentColor" /> Connect</button>
            </div>
            {byNameMsg ? <div style={{ fontSize: 12.5, marginTop: 7, fontWeight: 600, color: byNameMsg.ok === false ? 'var(--clay)' : byNameMsg.ok ? 'var(--sage)' : 'var(--ink-3)' }}>{byNameMsg.text}</div> : null}
          </div>
        </div>
        {/* Only after a relay has actually refused a write. Named for the symptom the steward has, not for
            the mechanism — "register with the relay's allow-list" means nothing to someone whose actual
            problem is that their posts aren't saving. */}
        {!regNeeded ? null : (
        <div style={{ marginTop: 12 }}>
          {!regOpen ? (
            <button onClick={() => setRegOpen(true)} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="key" size={15} color="currentColor" /> A relay is refusing our posts — fix it</button>
          ) : (
            <div style={{ padding: 13, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 9 }}>One of your relays wouldn’t save a recent change, because it only carries churches on its own list and yours isn’t on it yet. Adding it is the relay operator’s call — if that’s you, paste the relay’s <b>admin token</b> to add this church now. It’s in the TrinityOne Suite window, or the installer output. <b>Anyone with that token controls the whole relay</b>, so don’t ask for it if the relay isn’t yours — ask its operator to add your church instead.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={regToken} onChange={e => setRegToken(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') register(); }} type="password" placeholder="relay admin token" autoComplete="off" style={{ flex: 1, height: 42, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 13, color: 'var(--ink)', outline: 'none' }} />
                <button onClick={register} disabled={regBusy || !regToken.trim()} className="sk-btn sk-btn--clay" style={{ padding: '0 16px', fontSize: 13, whiteSpace: 'nowrap', opacity: (regBusy || !regToken.trim()) ? .5 : 1 }}>Register</button>
              </div>
              {regMsg ? <div style={{ fontSize: 12.5, marginTop: 8, fontWeight: 600, color: regMsg[0] === '✓' ? 'var(--sage)' : regMsg[0] === '✗' ? 'var(--clay)' : 'var(--ink-3)' }}>{regMsg}</div> : null}
            </div>
          )}
        </div>
        )}
        {/* one-time clone: copy a church's whole history from another relay onto this one (e.g. after restore) */}
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>Copy your history to {cloneDest || 'this relay'}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 10 }}>Copies every message, record and file your church has onto <b>{cloneDest || 'this relay'}</b>{cloneDest ? ' — the relay serving this console' : ''}. Use it when your history lives somewhere else and this relay is starting empty: after restoring from your recovery phrase, or when moving your church onto your own box. Nothing is removed from the relay you copy from, and nothing already here is overwritten. Name the relay to copy <b>from</b>.</div>
          <div style={{ display: 'flex', gap: 9 }}>
            <input value={cloneSrc} onChange={e => { setCloneSrc(e.target.value); setCloneMsg(null); }} onKeyDown={e => { if (e.key === 'Enter') cloneFromHere(); }}
              placeholder="grace-city  ·  wss://relay.example.com" spellCheck={false} autoCapitalize="none"
              style={{ flex: 1, height: 42, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink)', outline: 'none' }} />
            <button onClick={cloneFromHere} disabled={cloning || !cloneSrc.trim()} className="sk-btn sk-btn--clay" style={{ padding: '0 16px', fontSize: 13, whiteSpace: 'nowrap', opacity: (cloning || !cloneSrc.trim()) ? .5 : 1 }}>{cloning ? 'Copying…' : 'Copy across'}</button>
          </div>
          {cloneMsg ? <div style={{ fontSize: 12.5, marginTop: 8, fontWeight: 600, color: cloneMsg.ok === false ? 'var(--clay)' : cloneMsg.ok ? 'var(--sage)' : 'var(--ink-3)' }}>{cloneMsg.text}</div> : null}
        </div>
        {/* cross-relay sync: the church's own TrinityOne relays continuously exchange their full history */}
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>Keep your relays in sync</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 11 }}>Your church’s own relays can continuously exchange their full history — so if one goes offline it catches up when it’s back, and nothing is lost. {backup != null ? (backup.boxes >= 2 ? <b>{backup.boxes} separate relays can sync{backup.syncOn ? ' — sync is on.' : '.'}</b> : 'Add a second relay your church runs to switch this on — public relays (nos.lol etc.) stay publish-only, so gated content never leaves your own infrastructure.') : 'Checking…'}</div>
          {backup != null && backup.boxes >= 2 ? (
            <div style={{ display: 'flex', gap: 9 }}>
              <button onClick={() => doSync(true)} disabled={syncBusy} className="sk-btn sk-btn--clay" style={{ padding: '9px 15px', fontSize: 13 }}>{syncBusy ? 'Saving…' : (backup.syncOn ? 'Re-sync now' : 'Turn on sync')}</button>
              <button onClick={() => doSync(false)} disabled={syncBusy} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}>Turn off</button>
            </div>
          ) : null}
          {syncMsg ? <div style={{ fontSize: 12.5, marginTop: 9, fontWeight: 600, color: syncMsg.ok ? 'var(--sage)' : 'var(--clay)' }}>{syncMsg.text}</div> : null}
        </div>
        </div>{/* end relay-actions grid */}
        <div style={{ display: 'flex', gap: 9, marginTop: 16, padding: 13, borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 24%, transparent)' }}>
          <Icon name="shield" size={17} color="var(--sage)" style={{ flexShrink: 0 }} /><div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>Your church's messages, groups and members live on the relays above. Self-host one with the TrinityOne Suite for infrastructure you fully control — or run on the shared community relays. Either way, members reach it wherever you serve the app.</div>
        </div>
      </Panel>
  );
}


function ago(ts) {
  if (!ts) return '';
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 90) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 14) return Math.floor(s / 86400) + 'd ago';
  return new Date(ts * 1000).toLocaleDateString();
}

function NewPlanModal({ onClose }) {
  const [name, setName] = React.useState('');
  const [tag, setTag] = React.useState('');
  const [text, setText] = React.useState('');
  const [schedAt, setSchedAt] = React.useState(0);   // unix sec; 0 = publish now
  const toLocalInput = (sec) => { if (!sec) return ''; const d = new Date(sec * 1000); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const fromLocalInput = (s) => { if (!s) return 0; const t = new Date(s).getTime(); return Number.isFinite(t) ? Math.floor(t / 1000) : 0; };
  const isFuture = schedAt && schedAt * 1000 > Date.now();
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const create = (asDraft) => {
    if (!name.trim() || !lines.length) return;
    const days = lines.map((ref, i) => ({ d: i + 1, ref, label: ref }));
    window.Steward.publishPlan({ id: 'custom-' + Date.now().toString(36), title: name.trim(), sub: days.length + ' day' + (days.length === 1 ? '' : 's'), tag: tag.trim() || 'Custom', accent: 'var(--clay)', blurb: '', days, publishAt: isFuture ? schedAt : 0, draft: !!asDraft });
    onClose();
  };
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'rgba(40,32,24,.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Create a reading plan" tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 500, maxWidth: '92%', maxHeight: '88%', overflowY: 'auto', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 28 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>Create a reading plan</div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 18px' }}>Your own plan — a sermon series, a season's readings, anything. One reading per line; each line is a day.</p>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Name</div>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. Advent — Light Has Come" style={{ width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '0 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }} />
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Tag (optional)</div>
        <input value={tag} onChange={e => setTag(e.target.value)} placeholder="e.g. Advent" style={{ width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '0 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }} />
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Readings — one per line {lines.length ? `· ${lines.length} day${lines.length === 1 ? '' : 's'}` : ''}</div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={7} placeholder={'John 1\nJohn 2\nIsaiah 53\nPsalm 22'} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '12px 14px', fontSize: 14.5, fontFamily: 'var(--mono)', color: 'var(--ink)', outline: 'none', resize: 'vertical', lineHeight: 1.6 }} />
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '16px 0 6px' }}>Release</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setSchedAt(0)} style={{ flex: 1, padding: '11px 12px', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, background: !schedAt ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface-2)', border: '1.5px solid ' + (!schedAt ? 'var(--clay)' : 'var(--line)'), color: !schedAt ? 'var(--clay-ink)' : 'var(--ink-2)' }}>Now</button>
          <button type="button" onClick={() => setSchedAt(schedAt || Math.floor(Date.now() / 1000) + 7 * 86400)} style={{ flex: 1, padding: '11px 12px', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, background: schedAt ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface-2)', border: '1.5px solid ' + (schedAt ? 'var(--clay)' : 'var(--line)'), color: schedAt ? 'var(--clay-ink)' : 'var(--ink-2)' }}>Schedule…</button>
        </div>
        {schedAt ? (
          <React.Fragment>
            <input type="datetime-local" value={toLocalInput(schedAt)} min={toLocalInput(Math.floor(Date.now() / 1000))} onChange={e => setSchedAt(fromLocalInput(e.target.value))} style={{ width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '0 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', margin: '8px 0 6px' }} />
            <div style={{ fontSize: 12, color: isFuture ? 'var(--ink-2)' : 'var(--clay)' }}>{isFuture ? `Hidden from members until ${new Date(schedAt * 1000).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.` : 'That time is in the past — it will publish immediately.'}</div>
          </React.Fragment>
        ) : null}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: '0 0 auto', padding: '12px 14px', fontSize: 14 }}>Cancel</button>
          <button onClick={() => create(true)} disabled={!name.trim() || !lines.length} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12, fontSize: 13.5, opacity: (!name.trim() || !lines.length) ? 0.55 : 1 }} title="Hold it — members won’t see it until you publish">Save as draft</button>
          <button onClick={() => create(false)} disabled={!name.trim() || !lines.length} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 12, fontSize: 13.5, opacity: (!name.trim() || !lines.length) ? 0.55 : 1 }}><Icon name="send" size={15} color="var(--on-clay)" /> {isFuture ? 'Schedule' : 'Publish now'}</button>
        </div>
      </div>
    </div>
  );
}

function DashPlans() {
  const shared = window.useStewardPlans();          // plans currently shared with the church
  const [creating, setCreating] = React.useState(false);
  const sharedIds = new Set(shared.map(p => p.id));
  const library = (window.SK && window.SK.planLibrary) || [];
  const available = library.filter(p => !sharedIds.has(p.id));
  const planDrafts = shared.filter(p => p.draft);
  const PlanRow = ({ p, isShared }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface)', color: p.accent || 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="read" size={19} color="currentColor" /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: isShared && p.draft ? 0.7 : 1 }}>{p.title}</span>
          {isShared && p.draft ? <span title="Hidden from members — press Publish to make it live" style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, letterSpacing: '.3px', color: 'var(--ink-2)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, padding: '2px 8px' }}><Icon name="pen" size={10} color="var(--ink-3)" /> DRAFT</span> : null}
          {isShared && p.publishAt && p.publishAt * 1000 > Date.now() ? <span title={'Members see it on ' + new Date(p.publishAt * 1000).toLocaleString()} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, letterSpacing: '.3px', color: 'var(--clay-ink)', background: 'var(--clay-soft)', borderRadius: 999, padding: '2px 8px' }}><Icon name="clock" size={11} color="var(--clay)" /> SCHEDULED</span> : null}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{p.sub || (p.days ? p.days.length + ' days' : '')}{p.tag ? ' · ' + p.tag : ''}{isShared && p.publishAt && p.publishAt * 1000 > Date.now() ? ' · ' + new Date(p.publishAt * 1000).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</div>
      </div>
      {isShared && p.draft ? <button onClick={() => window.Steward.publishPlan({ ...p, draft: false })} className="sk-btn sk-btn--clay" style={{ padding: '7px 11px', fontSize: 12.5 }} title="Publish this plan now"><Icon name="send" size={13} color="var(--on-clay)" /> Publish</button> : null}
      {isShared
        ? <button onClick={() => window.Steward.removePlan(p.id)} className="sk-btn sk-btn--ghost" style={{ padding: '7px 12px', fontSize: 12.5 }}>Unshare</button>
        : <button onClick={() => window.Steward.publishPlan(p)} className="sk-btn sk-btn--clay" style={{ padding: '7px 12px', fontSize: 12.5 }}><Icon name="send" size={14} color="var(--on-clay)" /> Share</button>}
    </div>
  );
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {creating ? <NewPlanModal onClose={() => setCreating(false)} /> : null}
      {/* single scroll container so a long drafts list can't push the library off the bottom */}
      <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 12 }}>
      <Panel title={`Shared with your church${shared.length ? ` · ${shared.length}` : ''}`}
        action={<div style={{ display: 'flex', gap: 8 }}>
          {planDrafts.length > 0 ? <button onClick={() => { if (confirm(`Publish ${planDrafts.length} draft plan${planDrafts.length === 1 ? '' : 's'}? Scheduled ones still wait for their date.`)) planDrafts.forEach(p => window.Steward.publishPlan({ ...p, draft: false })); }} className="sk-btn sk-btn--clay" style={{ padding: '8px 13px', fontSize: 13 }} title="Take all held draft plans live"><Icon name="send" size={15} color="var(--on-clay)" /> Publish {planDrafts.length} draft{planDrafts.length === 1 ? '' : 's'}</button> : null}
          <button onClick={() => setCreating(true)} className="sk-btn sk-btn--clay" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="plus" size={15} color="var(--on-clay)" /> New plan</button>
        </div>}>
        {shared.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '6px 2px' }}>No plans shared yet — make your own with “New plan”, or pick one from the library below.</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{shared.map(p => <PlanRow key={p.id} p={p} isShared />)}</div>}
      </Panel>
      <Panel title="Plan library">
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 14 }}>Share a reading plan and the whole church sees it in their app — members start it and track their own progress.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {available.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Every plan is shared.</div> : available.map(p => <PlanRow key={p.id} p={p} />)}
        </div>
      </Panel>
      </div>
    </div>
  );
}
window.DashPlans = DashPlans;

// Upload OR edit a devotional — a reflection on a passage as a text (.txt) or Markdown (.md) file.
// Passing `editing` (an existing devo) pre-fills it and re-publishes under the same id; the file is
// optional when editing (title/passage can change without re-uploading the text).
function NewDevotionalModal({ onClose, editing, seriesOptions }) {
  const [title, setTitle] = React.useState(editing ? editing.title || '' : '');
  const [ref, setRef] = React.useState(editing ? editing.ref || '' : '');
  const [series, setSeries] = React.useState(editing ? editing.series || '' : '');
  const [schedAt, setSchedAt] = React.useState(editing && editing.publishAt ? editing.publishAt : 0);   // unix sec; 0 = publish now
  const [file, setFile] = React.useState(null);   // { type, name, text? } — a NEW replacement file
  const [busy, setBusy] = React.useState(false);
  const toLocalInput = (sec) => { if (!sec) return ''; const d = new Date(sec * 1000); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const fromLocalInput = (s) => { if (!s) return 0; const t = new Date(s).getTime(); return Number.isFinite(t) ? Math.floor(t / 1000) : 0; };
  const isFuture = schedAt && schedAt * 1000 > Date.now();
  const pick = (f) => {
    if (!f) return;
    const isText = /\.(txt|md|markdown)$/i.test(f.name) || /^text\//i.test(f.type) || f.type === '';
    if (!isText) { setFile({ error: 'Only .txt or .md files — please pick a text file.' }); return; }
    if (f.size > 2 * 1024 * 1024) { setFile({ error: 'File is over 2 MB — please use a smaller text file.' }); return; }
    const isMd = /\.(md|markdown)$/i.test(f.name);
    const r = new FileReader();
    r.onload = () => setFile({ type: isMd ? 'md' : 'txt', name: f.name, text: r.result });
    r.readAsText(f);
    if (!title.trim()) setTitle(f.name.replace(/\.(txt|md|markdown)$/i, ''));
  };
  const canSave = title.trim() && (file ? !file.error : !!editing) && !busy;   // new needs a file; edit can reuse the old text
  const wasDraft = !editing || !!editing.draft;   // new uploads + held items default to draft; a live item stays live
  // asDraft: true holds it (hidden from members); false publishes it (live now or on its schedule)
  const create = (asDraft) => {
    if (!canSave) return;
    setBusy(true);
    const text = file ? file.text : (editing ? editing.text : '');
    const type = file ? file.type : (editing ? editing.type : 'txt');
    Promise.resolve(window.Steward.publishDevotional({ id: editing ? editing.id : undefined, title: title.trim(), ref: ref.trim(), series: series.trim(), publishAt: isFuture ? schedAt : 0, draft: !!asDraft, type, text: text || '', order: editing ? editing.order : undefined })).then(() => onClose());
  };
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'rgba(40,32,24,.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={editing ? 'Edit devotional' : 'Upload a devotional'} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: '92%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 28 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>{editing ? 'Edit devotional' : 'Upload a devotional'}</div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 18px' }}>{editing ? 'Update the title or passage, or replace the text file. Members see the change in their app.' : 'A reflection on a passage, as a text (.txt) or Markdown (.md) file. Your congregation reads it in their app.'}</p>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Title</div>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Resting in Psalm 23" style={{ width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '0 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }} />
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Passage (optional)</div>
        <input value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. Psalm 23" style={{ width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '0 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }} />
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Series (optional)</div>
        <input value={series} onChange={e => setSeries(e.target.value)} list="devo-series-list" placeholder="e.g. The Weekly Word — groups it with the rest" style={{ width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '0 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }} />
        <datalist id="devo-series-list">{(seriesOptions || []).map(s => <option key={s} value={s} />)}</datalist>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Release</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: schedAt ? 6 : 14 }}>
          <button type="button" onClick={() => setSchedAt(0)} style={{ flex: 1, padding: '11px 12px', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, background: !schedAt ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface-2)', border: '1.5px solid ' + (!schedAt ? 'var(--clay)' : 'var(--line)'), color: !schedAt ? 'var(--clay-ink)' : 'var(--ink-2)' }}>Now</button>
          <button type="button" onClick={() => setSchedAt(schedAt || Math.floor(Date.now() / 1000) + 7 * 86400)} style={{ flex: 1, padding: '11px 12px', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, background: schedAt ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface-2)', border: '1.5px solid ' + (schedAt ? 'var(--clay)' : 'var(--line)'), color: schedAt ? 'var(--clay-ink)' : 'var(--ink-2)' }}>Schedule…</button>
        </div>
        {schedAt ? (
          <React.Fragment>
            <input type="datetime-local" value={toLocalInput(schedAt)} min={toLocalInput(Math.floor(Date.now() / 1000))} onChange={e => setSchedAt(fromLocalInput(e.target.value))} style={{ width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '0 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 6 }} />
            <div style={{ fontSize: 12, color: isFuture ? 'var(--ink-2)' : 'var(--clay)', marginBottom: 14 }}>{isFuture ? `Hidden from members until ${new Date(schedAt * 1000).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.` : 'That time is in the past — it will publish immediately.'}</div>
          </React.Fragment>
        ) : null}
        <label style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 16px', borderRadius: 13, border: '1px dashed var(--line)', background: 'var(--surface-2)', cursor: 'pointer' }}>
          <Icon name="read" size={20} color="var(--clay)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: file && !file.error ? 'var(--ink)' : 'var(--ink-2)' }}>{file && file.name ? file.name : (editing ? 'Replace the text file (optional)' : 'Choose a .txt or .md file')}</div>
            <div style={{ fontSize: 12, color: file && file.error ? 'var(--clay)' : 'var(--ink-3)' }}>{file && file.error ? file.error : (file && file.type ? file.type.toUpperCase() + ' ready' : (editing ? 'Keeping the current text unless you pick a new file' : 'Tap to pick a file'))}</div>
          </div>
          <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={e => pick(e.target.files && e.target.files[0])} style={{ display: 'none' }} />
        </label>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: '0 0 auto', padding: '12px 14px', fontSize: 14 }}>Cancel</button>
          {wasDraft ? (
            <React.Fragment>
              <button onClick={() => create(true)} disabled={!canSave} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12, fontSize: 13.5, opacity: canSave ? 1 : 0.55 }} title="Hold it — members won’t see it until you publish">{busy ? '…' : 'Save as draft'}</button>
              <button onClick={() => create(false)} disabled={!canSave} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 12, fontSize: 13.5, opacity: canSave ? 1 : 0.55 }}><Icon name="send" size={15} color="var(--on-clay)" /> {busy ? 'Saving…' : (isFuture ? 'Schedule' : 'Publish now')}</button>
            </React.Fragment>
          ) : (
            <button onClick={() => create(false)} disabled={!canSave} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 12, fontSize: 14, opacity: canSave ? 1 : 0.55 }}><Icon name="check" size={16} color="var(--on-clay)" /> {busy ? 'Saving…' : 'Save changes'}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function DashDevotionals() {
  const devos = window.useStewardDevotionals();
  const narrow = useStewNarrow();   // stack series/devotional row actions on phones
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [order, setOrder] = React.useState(null);   // local working order while dragging (array of devos)
  const [dragId, setDragId] = React.useState(null);
  const [overId, setOverId] = React.useState(null);
  const [seriesRename, setSeriesRename] = React.useState(null);   // { items, current } when naming/renaming a series
  const [seriesSchedule, setSeriesSchedule] = React.useState(null);   // { items, label } when drip-scheduling a series
  // the list to show: the live order, unless we're mid-drag with a local working order
  const list = order || devos;
  const draftCount = devos.filter(d => d.draft).length;   // held items not yet visible to members
  const [seriesOpen, setSeriesOpen] = React.useState({});   // collapsible series sections (keyed by series id)
  const [churchName, setChurchName] = React.useState('');   // labels a series group by the church that uploaded it
  React.useEffect(() => {
    if (!window.Steward || !window.Steward.subscribeProfile) return;
    return window.Steward.subscribeProfile(p => { if (p && p.name) setChurchName(p.name); });
  }, []);
  const seriesOptions = [...new Set(devos.map(d => d.series).filter(Boolean))];   // existing series names (datalist + reuse)
  // group devotionals into collapsible series. A devo is in a series when the steward set its Series field;
  // legacy "Series N" devos (no explicit field) fall into one unnamed group the steward can name. The group
  // is labelled by the series name, falling back to the church name. Order preserved; loners get their own row.
  const seriesKeyOf = (d) => {
    if (d.series && d.series.trim()) return 'name:' + d.series.trim();                     // explicit series the steward set
    const r = String(d.ref || ''); const m = r.match(/^\s*(.+?)\s*[—\-–:]\s*series\b/i) || r.match(/series\s*:\s*(.+?)\s*$/i);
    if (m && m[1].trim()) return 'name:' + m[1].trim();
    return /series/i.test(r) ? '__series__' : null;                                        // legacy bare "Series N"
  };
  const devoGroups = (() => {
    const out = [], idx = {};
    list.forEach(d => { const k = seriesKeyOf(d); const key = k == null ? 'solo:' + d.id : k; if (idx[key] == null) { idx[key] = out.length; out.push({ key, series: k != null, named: k && k.indexOf('name:') === 0, items: [] }); } out[idx[key]].items.push(d); });
    out.forEach(g => { if (!g.series) return; g.label = (g.named ? g.key.slice(5) : '') || churchName || 'Devotionals'; });
    return out;
  })();
  // re-publish a devotional carrying ALL its fields, with optional overrides — so an edit to order/series/
  // schedule never silently drops the draft state, text, or anything else.
  const republish = (d, over) => window.Steward.publishDevotional({ id: d.id, title: d.title, ref: d.ref, type: d.type, text: d.text, order: d.order, series: d.series, publishAt: d.publishAt, draft: d.draft, ...over });
  // give a group an explicit name (also migrates a legacy "Series N" group): re-publish each with the new series
  const renameSeries = (items, name) => { items.forEach(d => republish(d, { series: name })); };
  // drip-release a series: stagger each item's publishAt by `interval` seconds from `startSec`, in display
  // order. Keeps draft state — the steward still presses Publish to make the schedule live.
  const scheduleSeries = (items, startSec, intervalSec) => { items.forEach((d, i) => republish(d, { publishAt: startSec + i * intervalSec })); };
  // "Publish all now" from the schedule dialog: clear schedules AND go live (drop draft)
  const unscheduleSeries = (items) => { items.forEach(d => republish(d, { publishAt: 0, draft: false })); };
  // master publish: take held drafts live, keeping each one's schedule (a scheduled draft stays hidden
  // until its date; an unscheduled one goes live now)
  const publishDrafts = (items) => { items.filter(d => d.draft).forEach(d => republish(d, { draft: false })); };
  // persist a new order: number each devotional by position, re-publish only the ones that changed (keep series + draft)
  const persist = (arr) => { arr.forEach((d, i) => { if (d.order !== i) republish(d, { order: i }); }); };
  // sort the list and bake it into the saved order (so the member app shows the same). "number" is a
  // numeric-aware title sort, so "Day 2" comes before "Day 10".
  // pull the SERIES number from a title ("Series 3", "Series #3", "Series03"); fall back to a leading
  // "#3", then the first number anywhere.
  const numIn = (s) => { s = String(s || ''); const m = s.match(/series\s*#?\s*(\d+)/i) || s.match(/#\s*(\d+)/) || s.match(/(\d+)/); return m ? parseInt(m[1], 10) : Infinity; };
  const seriesOf = (d) => numIn((d.ref || '') + ' ' + (d.title || ''));   // "Series N" lives in ref (or title)
  const applySort = (mode) => {
    const arr = devos.slice();
    if (mode === 'number') arr.sort((a, b) => seriesOf(a) - seriesOf(b) || String(a.title || '').localeCompare(String(b.title || ''), undefined, { numeric: true }));
    else if (mode === 'title') arr.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { numeric: true }));
    else if (mode === 'newest') arr.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    persist(arr);
  };
  // arrow fallback (accessibility): swap with a neighbour
  const move = (idx, dir) => { const arr = devos.slice(); const j = idx + dir; if (j < 0 || j >= arr.length) return; const t = arr[idx]; arr[idx] = arr[j]; arr[j] = t; persist(arr); };
  // drag: reorder the working copy live; commit on drop
  const onDragOver = (e, id) => {
    e.preventDefault();
    if (!dragId || id === dragId) return;
    const arr = (order || devos).slice();
    const from = arr.findIndex(x => x.id === dragId), to = arr.findIndex(x => x.id === id);
    if (from < 0 || to < 0) return;
    const [m] = arr.splice(from, 1); arr.splice(to, 0, m);
    setOrder(arr); setOverId(id);
  };
  const onDrop = () => { if (order) persist(order); setDragId(null); setOverId(null); setOrder(null); };
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      {adding ? <NewDevotionalModal onClose={() => setAdding(false)} seriesOptions={seriesOptions} /> : null}
      {editing ? <NewDevotionalModal editing={editing} onClose={() => setEditing(null)} seriesOptions={seriesOptions} /> : null}
      {seriesRename ? <SeriesNameModal current={seriesRename.current} count={seriesRename.items.length} onSave={(n) => renameSeries(seriesRename.items, n)} onClose={() => setSeriesRename(null)} /> : null}
      {seriesSchedule ? <SeriesScheduleModal label={seriesSchedule.label} count={seriesSchedule.items.length} onApply={(start, interval) => scheduleSeries(seriesSchedule.items, start, interval)} onClear={() => unscheduleSeries(seriesSchedule.items)} onClose={() => setSeriesSchedule(null)} /> : null}
      <Panel scroll title={`Devotionals${devos.length ? ` · ${devos.length}` : ''}`}
        action={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {draftCount > 0 ? <button onClick={() => { if (confirm(`Publish ${draftCount} draft${draftCount === 1 ? '' : 's'}? Scheduled ones still wait for their date.`)) publishDrafts(devos); }} className="sk-btn sk-btn--clay" style={{ padding: '8px 13px', fontSize: 13 }} title="Take all held drafts live (keeping any schedules)"><Icon name="send" size={15} color="var(--on-clay)" /> Publish {draftCount} draft{draftCount === 1 ? '' : 's'}</button> : null}
          <button onClick={() => window.TrinityTemplates.openDevoTemplate()} className="sk-btn sk-btn--ghost" style={{ padding: '8px 12px', fontSize: 13 }} title="The writing template + house style for a devotional series"><Icon name="receipt" size={15} color="currentColor" /> Template</button>
          <button onClick={() => setAdding(true)} className="sk-btn sk-btn--clay" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="plus" size={15} color="var(--on-clay)" /> Upload devotional</button>
        </div>} style={{ height: '100%' }}>
        {devos.length === 0 ? (
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, padding: '6px 2px' }}>No devotionals yet. Upload a .txt or .md reflection on a passage — your congregation reads it in their app.</div>
        ) : (
          <React.Fragment>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 2px 10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="dots" size={13} color="var(--ink-3)" /> Drag to reorder, or sort:</span>
            {[['number', 'By series #'], ['title', 'A→Z'], ['newest', 'Newest']].map(([m, lbl]) => (
              <button key={m} onClick={() => applySort(m)} title="Sets the order your members see" style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', borderRadius: 8, padding: '4px 9px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>{lbl}</button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(() => {
              const renderRow = (d) => {
                const i = list.findIndex(x => x.id === d.id);
                const dragging = dragId === d.id;
                return (
              <div key={d.id} draggable
                onDragStart={(e) => { setDragId(d.id); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', d.id); } catch (err) {} }}
                onDragOver={(e) => onDragOver(e, d.id)} onDrop={onDrop} onDragEnd={() => { setDragId(null); setOverId(null); setOrder(null); }}
                style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', alignItems: narrow ? 'stretch' : 'center', gap: narrow ? 10 : 12, padding: '12px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid ' + (overId === d.id && !dragging ? 'var(--clay)' : 'var(--line)'), opacity: dragging ? 0.4 : 1, boxShadow: dragging ? 'var(--shadow-lg)' : 'none', transition: 'border-color .12s, opacity .12s' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: narrow ? 'none' : 1 }}>
                <div title="Drag to reorder" style={{ cursor: 'grab', color: 'var(--ink-3)', display: 'flex', flexShrink: 0, touchAction: 'none' }}><Icon name="dots" size={18} color="currentColor" /></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
                  <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 7, padding: '0 4px', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.35 : 1, color: 'var(--ink-2)', display: 'flex' }}><Icon name="chevU" size={13} color="currentColor" /></button>
                  <button onClick={() => move(i, 1)} disabled={i === devos.length - 1} title="Move down" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 7, padding: '0 4px', cursor: i === devos.length - 1 ? 'default' : 'pointer', opacity: i === devos.length - 1 ? 0.35 : 1, color: 'var(--ink-2)', display: 'flex' }}><Icon name="chevD" size={13} color="currentColor" /></button>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface)', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="read" size={19} color="currentColor" /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: d.draft ? 0.7 : 1 }}>{d.title}</span>
                    {d.draft ? <span title="Hidden from members — press Publish to make it live" style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, letterSpacing: '.3px', color: 'var(--ink-2)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, padding: '2px 8px' }}><Icon name="pen" size={10} color="var(--ink-3)" /> DRAFT</span> : null}
                    {d.publishAt && d.publishAt * 1000 > Date.now() ? <span title={'Members see it on ' + new Date(d.publishAt * 1000).toLocaleString()} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, letterSpacing: '.3px', color: 'var(--clay-ink)', background: 'var(--clay-soft)', borderRadius: 999, padding: '2px 8px' }}><Icon name="clock" size={11} color="var(--clay)" /> SCHEDULED</span> : null}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{[d.ref, (d.type || '').toUpperCase(), d.publishAt && d.publishAt * 1000 > Date.now() ? new Date(d.publishAt * 1000).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''].filter(Boolean).join(' · ')}</div>
                </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0, justifyContent: narrow ? 'flex-end' : 'initial' }}>
                {d.draft ? <button onClick={() => republish(d, { draft: false })} title="Publish this one now" style={{ border: 'none', background: 'var(--clay)', borderRadius: 9, padding: '6px 10px', cursor: 'pointer', color: 'var(--on-clay)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, flexShrink: 0 }}><Icon name="send" size={13} color="var(--on-clay)" /> Publish</button> : null}
                <button onClick={() => setEditing(d)} title="Edit" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 9px', cursor: 'pointer', color: 'var(--clay)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}><Icon name="pen" size={14} color="currentColor" /> Edit</button>
                <button onClick={() => window.Steward.removeDevotional(d.id)} title="Remove" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '8px 10px', minWidth: 40, minHeight: 40, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="trash" size={15} color="currentColor" /></button>
                </div>
              </div>
                );
              };
              return devoGroups.map(g => g.series ? (
                <div key={g.key} style={{ border: '1px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
                  <div onClick={() => setSeriesOpen(s => ({ ...s, [g.key]: !s[g.key] }))} style={{ width: '100%', display: 'flex', flexDirection: narrow ? 'column' : 'row', alignItems: narrow ? 'stretch' : 'center', gap: narrow ? 10 : 11, padding: '11px 13px', background: 'var(--surface-2)', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, flex: narrow ? 'none' : 1 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--surface)', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="read" size={17} color="currentColor" /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{g.items.length} devotionals{g.named ? '' : ' · unnamed'}{g.items.some(d => d.draft) ? ` · ${g.items.filter(d => d.draft).length} draft` : ''}</div>
                      </div>
                      {narrow ? <Icon name={seriesOpen[g.key] ? 'chevU' : 'chevD'} size={17} color="var(--ink-3)" /> : null}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0, paddingLeft: narrow ? 43 : 0 }}>
                      <button onClick={(e) => { e.stopPropagation(); setSeriesSchedule({ items: g.items, label: g.label }); }}
                        title="Drip-release this series on a cadence" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 9px', cursor: 'pointer', color: 'var(--clay)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, flexShrink: 0 }}><Icon name="clock" size={13} color="currentColor" /> Schedule</button>
                      <button onClick={(e) => { e.stopPropagation(); setSeriesRename({ items: g.items, current: g.named ? g.label : '' }); }}
                        title={g.named ? 'Rename series' : 'Name this series'} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 9px', cursor: 'pointer', color: 'var(--clay)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, flexShrink: 0 }}><Icon name="pen" size={13} color="currentColor" /> {g.named ? 'Rename' : 'Name'}</button>
                      {!narrow ? <Icon name={seriesOpen[g.key] ? 'chevU' : 'chevD'} size={17} color="var(--ink-3)" /> : null}
                    </div>
                  </div>
                  {seriesOpen[g.key] ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10, borderTop: '1px solid var(--line)' }}>{g.items.map(renderRow)}</div> : null}
                </div>
              ) : renderRow(g.items[0]));
            })()}
          </div>
          </React.Fragment>
        )}
      </Panel>
    </div>
  );
}

// Bulk-upload resources: drop a set of .md/.txt files and publish them all at once — each file becomes
// a devotional (Markdown body) or a reading plan (one Bible reference per line).
function BulkUploadModal({ kind, onClose }) {
  const isPlans = kind === 'plans';
  const [items, setItems] = React.useState([]);   // [{ name, title, text?, ref?, days?, count?, error? }]
  const [drag, setDrag] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(0);
  const [rejected, setRejected] = React.useState([]);   // names of non-text files we couldn't read
  const inputRef = React.useRef(null);

  const parse = (name, raw) => {
    const baseTitle = name.replace(/\.(txt|md|markdown)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Untitled';
    if (isPlans) {
      let lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
      let title = baseTitle;
      if (lines[0] && /^#+\s+/.test(lines[0])) { title = lines[0].replace(/^#+\s*/, '').trim() || baseTitle; lines = lines.slice(1); }
      const days = lines.map((ref, i) => ({ d: i + 1, ref, label: ref }));
      return { name, title, count: days.length, days, error: days.length ? '' : 'no readings' };
    }
    const h = raw.match(/^\s*#\s+(.+)$/m);
    const rf = raw.match(/\b(?:[1-3]\s?)?[A-Z][a-z]+\s+\d+(?::\d+(?:-\d+)?)?\b/);
    const text = raw.trim();
    return { name, title: (h ? h[1].trim() : baseTitle), ref: rf ? rf[0].trim() : '', text, error: text ? '' : 'empty file' };
  };
  const addFiles = (list) => {
    const all = [...list];
    const files = all.filter(f => /\.(txt|md|markdown)$/i.test(f.name)).slice(0, 200);
    const bad = all.filter(f => !/\.(txt|md|markdown)$/i.test(f.name)).map(f => f.name);
    setRejected(bad);
    if (!files.length) return;
    Promise.all(files.map(f => new Promise(res => { const r = new FileReader(); r.onload = () => res(parse(f.name, String(r.result || ''))); r.onerror = () => res({ name: f.name, title: f.name, error: 'unreadable' }); r.readAsText(f); })))
      .then(parsed => setItems(prev => { const seen = new Set(prev.map(p => p.name)); return [...prev, ...parsed.filter(p => !seen.has(p.name))]; }));
  };
  const valid = items.filter(it => !it.error);
  const publishAll = async () => {
    setBusy(true); setDone(0);
    for (let i = 0; i < valid.length; i++) {
      const it = valid[i];
      try {
        // bulk uploads land as DRAFTS so the steward can arrange + schedule a series before any of it
        // reaches members — then they publish (or schedule) it deliberately.
        if (isPlans) await Promise.resolve(window.Steward.publishPlan({ id: 'bulk-' + Date.now().toString(36) + i, title: it.title, sub: it.count + ' day' + (it.count === 1 ? '' : 's'), tag: 'Custom', accent: 'var(--clay)', blurb: '', days: it.days, draft: true }));
        else await Promise.resolve(window.Steward.publishDevotional({ title: it.title, ref: it.ref || '', type: 'txt', text: it.text, draft: true }));
      } catch (e) {}
      setDone(d => d + 1);
    }
    setBusy(false); setTimeout(onClose, 650);
  };
  const fld = { display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', marginBottom: 8 };
  const dlgRef = useStewDialog(() => { if (!busy) onClose(); });   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={() => !busy && onClose()} style={{ position: 'absolute', inset: 0, zIndex: 96, background: 'rgba(40,32,24,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={'Bulk upload ' + (isPlans ? 'reading plans' : 'devotionals')} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 560, maxWidth: '96%', maxHeight: '90%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', animation: 'lumenScale .2s ease both' }}>
        <div style={{ padding: '24px 26px 0' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>Bulk upload {isPlans ? 'reading plans' : 'devotionals'}</div>
          <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 16px' }}>{isPlans ? 'Drop one or more text files — each file becomes a plan, with one Bible reference per line (a “# Title” first line is used as the name).' : 'Drop one or more Markdown / text files — each becomes a devotional. The first “# Heading” (or the filename) is the title.'} They land as <b>drafts</b>, so you can arrange and schedule them before anything reaches members.</p>
        </div>
        <div style={{ padding: '0 26px' }}>
          <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }} onClick={() => inputRef.current && inputRef.current.click()}
            style={{ border: '2px dashed ' + (drag ? 'var(--clay)' : 'var(--line)'), borderRadius: 16, background: drag ? 'color-mix(in oklab, var(--clay) 7%, var(--surface))' : 'var(--surface-2)', padding: '24px 18px', textAlign: 'center', cursor: 'pointer', transition: 'all .15s' }}>
            <Icon name="share" size={26} color="var(--ink-3)" />
            <div style={{ fontWeight: 700, fontSize: 14.5, marginTop: 8 }}>Drop files here, or click to choose</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 3 }}>.md · .markdown · .txt</div>
            <input ref={inputRef} type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" multiple onChange={e => { addFiles(e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />
          </div>
          {rejected.length ? (
            <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 10, padding: '10px 12px', borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 8%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 28%, var(--line))' }}>
              <Icon name="info" size={16} color="var(--clay)" />
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                <b style={{ color: 'var(--ink)' }}>{rejected.length} file{rejected.length === 1 ? '' : 's'} skipped</b> — only plain-text <b>.txt</b>, <b>.md</b> or <b>.markdown</b> files work here. Word/PDF documents can’t be read. {rejected.slice(0, 3).join(', ')}{rejected.length > 3 ? ` +${rejected.length - 3} more` : ''}
              </div>
            </div>
          ) : null}
        </div>
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: items.length ? '14px 26px 4px' : 0 }}>
          {items.map((it, i) => (
            <div key={i} style={{ ...fld, border: '1px solid ' + (it.error ? 'color-mix(in oklab, var(--clay) 30%, var(--line))' : 'var(--line)') }}>
              <Icon name={it.error ? 'x' : (isPlans ? 'read' : 'receipt')} size={17} color={it.error ? 'var(--clay)' : 'var(--clay)'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</div>
                <div style={{ fontSize: 11.5, color: it.error ? 'var(--clay)' : 'var(--ink-3)' }}>{it.error ? it.error : (isPlans ? it.count + ' readings' : ((it.ref ? it.ref + ' · ' : '') + it.text.length + ' chars'))} · {it.name}</div>
              </div>
              {!busy ? <button onClick={() => setItems(items.filter((_, x) => x !== i))} title="Remove this file from the list" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="x" size={15} /></button> : null}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 26px 20px', borderTop: '1px solid var(--line)' }}>
          <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-3)' }}>{busy ? `Publishing… ${done}/${valid.length}` : (valid.length ? `${valid.length} ready${items.length - valid.length ? ` · ${items.length - valid.length} skipped` : ''}` : 'No files yet')}</div>
          <button onClick={onClose} disabled={busy} className="sk-btn sk-btn--ghost" style={{ padding: '10px 16px', fontSize: 13.5, opacity: busy ? .5 : 1 }}>Cancel</button>
          <button onClick={publishAll} disabled={busy || !valid.length} className="sk-btn sk-btn--clay" style={{ padding: '10px 18px', fontSize: 13.5, opacity: (busy || !valid.length) ? .5 : 1 }}><Icon name="plus" size={15} color="var(--on-clay)" /> Add {valid.length || ''} as draft{valid.length === 1 ? '' : 's'}</button>
        </div>
      </div>
    </div>
  );
}

function DashResources() {
  const [view, setView] = React.useState('plans');   // plans | devotionals
  const [bulk, setBulk] = React.useState(false);
  const seg = { display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' };
  const btn = (k, label) => (
    <button onClick={() => setView(k)} style={{ padding: '8px 13px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', background: view === k ? 'var(--surface)' : 'transparent', color: view === k ? 'var(--clay)' : 'var(--ink-2)', boxShadow: view === k ? 'var(--shadow-sm)' : 'none' }}>{label}</button>
  );
  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {bulk ? <BulkUploadModal kind={view} onClose={() => setBulk(false)} /> : null}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div style={{ ...seg, maxWidth: '100%', overflowX: 'auto' }}>{btn('plans', 'Reading plans')}{btn('devotionals', 'Devotionals')}{btn('media', 'Sermons')}</div>
        <div style={{ flex: 1 }} />
        {view !== 'media' ? <button onClick={() => setBulk(true)} className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0 }}><Icon name="share" size={15} color="currentColor" /> Bulk upload</button> : null}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>{view === 'plans' ? <DashPlans /> : view === 'devotionals' ? <DashDevotionals /> : <DashSermons />}</div>
    </div>
  );
}
window.DashResources = DashResources;

// Steward-initiated parent↔child link: pick an adult member as a child's guardian (no parent request needed).
// The child keeps their own account; this records who their guardian is (church-signed), so the relay lets
// them always reach each other and the parent can collect them at check-in.
// ── Reconnect a member who lost their 12 words ────────────────────────────────────────────────────────
// Their old key cannot be recovered by anyone, so this does not "restore" it — it moves their SEAT onto the
// key they have now, on this church's word that they are the same person. The steward recognising them IS the
// authorisation; there is deliberately no code or token to hand over, because such a token would be a bearer
// credential to become that member.
// `realName` is the member's ACTUAL display name or '' — deliberately separate from `memberName`, which
// falls back to "this member" for the prose. Only a real name may be vouched across with the seat; writing
// a placeholder into the re-seat doc would publish "this member" as somebody's profile name.
function ReseatModal({ member, memberName, realName, isMinor, admittedList, onClose }) {
  const [scan, setScan] = React.useState(false);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [done, setDone] = React.useState(false);
  const reseats = window.useStewardReseats ? window.useStewardReseats() : [];
  const newPub = window.Steward && window.Steward.parseMemberKey ? window.Steward.parseMemberKey(text) : null;
  const same = newPub && newPub === member;

  const confirm = async () => {
    if (!newPub || same || busy) return;
    setBusy(true); setErr('');
    try {
      // Record the vouch FIRST, then admit. If admitting failed on its own the member would be able to post
      // while the church still showed two of them; this order fails the safer way round.
      const pairs = [...(reseats || []).filter(p => p && p.new !== newPub), { old: member, new: newPub, name: realName || '', at: Math.floor(Date.now() / 1000) }];
      await window.Steward.setReseats(pairs);
      await window.Steward.setAdmitted([...new Set([...(admittedList || []), newPub])]);
      setDone(true);
    } catch (e) { setErr((e && e.message) || 'Couldn’t save that — try again.'); }
    setBusy(false);
  };

  return (
    <CkModal title={'Reconnect ' + memberName} onClose={onClose}>
      {done ? (<React.Fragment>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--ink-2)', margin: '4px 0 14px' }}>
          Done. {memberName} is back in their place on the new phone, and the old entry is folded into it.
          {realName ? ' Their name goes with them — it will appear on the new phone shortly.' : ''}
        </p>
        {/* Say the part the product does NOT do, here, where it can still be acted on. Invite-only group
            membership is a list of pubkeys on each group document; a re-seat does not rewrite those, so the
            new key is not in them. Telling the steward now costs one sentence; leaving them to find out means
            the member sits outside their own small group wondering why. AUDIT-2026-07-26 CRITICAL 3. */}
        <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-3)', margin: '0 0 14px' }}>
          One thing to finish by hand: if they were in any <b>invite-only</b> groups, open Groups and add them
          again. Ordinary groups need nothing — they are already back in those.
        </p>
        <button onClick={onClose} className="sk-btn sk-btn--clay" style={{ width: '100%', padding: '10px 14px' }}>Close</button>
      </React.Fragment>) : (<React.Fragment>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--ink-2)', margin: '4px 0 10px' }}>
          For a member who has lost their 12 words. On their new phone they choose <b>“I’ve lost my 12 words”</b>, which shows a code — scan or paste it here.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-3)', margin: '0 0 12px' }}>
          Only do this if you know it is really them. It gives that new key {memberName}’s name and place in your church, and their access to your ordinary groups. Invite-only groups you will need to add them to again by hand. Their old private messages and any sealed care records stay unreadable — those went with the lost key, and nothing can bring them back.
        </p>
        {isMinor ? (
          <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--clay)', fontWeight: 700, border: '1px solid color-mix(in oklab, var(--clay) 35%, var(--line))', background: 'color-mix(in oklab, var(--clay) 8%, var(--surface))', borderRadius: 12, padding: '9px 11px', margin: '0 0 12px' }}>
            This member is marked as a child. Confirm with their parent or guardian before you reconnect them.
          </div>
        ) : null}
        {scan ? (
          <StewQRScanner onResult={(t) => { setText(t); setScan(false); setErr(''); }} onCancel={() => setScan(false)} />
        ) : (
          <button onClick={() => setScan(true)} className="sk-btn" style={{ width: '100%', padding: '9px 14px', marginBottom: 8 }}>Scan their code</button>
        )}
        <input value={text} onChange={e => { setText(e.target.value); setErr(''); }} placeholder="…or paste their new code / npub"
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)', padding: '9px 11px', fontSize: 13.5, fontFamily: 'var(--mono)', color: 'var(--ink)', outline: 'none', marginBottom: 8 }} />
        {text && !newPub ? <div style={{ fontSize: 13, color: 'var(--clay)', fontWeight: 700, marginBottom: 8 }}>That isn’t a TrinityOne member code.</div> : null}
        {same ? <div style={{ fontSize: 13, color: 'var(--clay)', fontWeight: 700, marginBottom: 8 }}>That’s the key they already have — nothing to reconnect.</div> : null}
        {err ? <div style={{ fontSize: 13, color: 'var(--clay)', fontWeight: 700, marginBottom: 8 }}>{err}</div> : null}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} className="sk-btn" style={{ flex: 1, padding: '10px 14px' }}>Cancel</button>
          <button onClick={confirm} disabled={!newPub || same || busy} className="sk-btn sk-btn--clay" style={{ flex: 2, padding: '10px 14px', opacity: (!newPub || same || busy) ? .5 : 1 }}>
            {busy ? 'Reconnecting…' : 'Yes — this is ' + memberName}</button>
        </div>
      </React.Fragment>)}
    </CkModal>
  );
}

function GuardianLinkModal({ child, childName, members, guardians, minorsSet, onLink, onUnlink, onClose }) {
  const [q, setQ] = React.useState('');
  const linked = guardians[child] || [];
  const nameFor = (pub) => { const m = members.find(x => x.pubkey === pub); return (m && m.name) || ('…' + (pub || '').slice(-6)); };
  const candidates = members
    .filter(m => m.pubkey !== child && !minorsSet.has(m.pubkey) && !linked.includes(m.pubkey))
    .filter(m => !q.trim() || (m.name || '').toLowerCase().includes(q.toLowerCase()));
  return (
    <CkModal title={'Parents of ' + (childName || 'this child')} onClose={onClose}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 12, lineHeight: 1.45 }}>A linked parent can always message this child and collect them at check-in. The child keeps their own account — this just records who their guardian is. Only adults (not other children) can be linked.</div>
      {linked.length ? (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Linked</div>
          {linked.map(p => (
            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 11, background: 'color-mix(in oklab, var(--sage) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 26%, var(--line))', marginBottom: 6 }}>
              <Icon name="users" size={15} color="var(--sage)" />
              <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 13.5 }}>{nameFor(p)}</span>
              <button onClick={() => onUnlink(child, p)} title="Remove this parent’s link to the child" className="sk-btn sk-btn--ghost" style={{ padding: '5px 10px', fontSize: 12 }}>Unlink</button>
            </div>
          ))}
        </div>
      ) : null}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search members…" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 10, padding: '9px 11px', fontSize: 13.5, fontFamily: 'var(--font-ui)', background: 'var(--surface-2)', color: 'var(--ink)', outline: 'none', marginBottom: 8 }} />
      <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
        {candidates.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '8px 0' }}>No matching adult members.</div> :
          candidates.slice(0, 60).map(m => (
            <button key={m.pubkey} onClick={() => onLink(child, m.pubkey)} title="Link this person as the child’s parent" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 13.5 }}>{m.name || ('Anonymous …' + (m.pubkey || '').slice(-6))}</span>
              <Icon name="plus" size={15} color="var(--clay)" />
            </button>
          ))}
      </div>
    </CkModal>
  );
}
window.GuardianLinkModal = GuardianLinkModal;

// Bring a whole congregation across: paste / import member names → a printable sheet of join slips,
// one QR each, the person's name already on it. Scanning opens the web app (no download, no account):
// it mints their key on-device, pre-fills their name, and follows the church. (See joinUrl + ?name.)
function BulkInviteModal({ onClose }) {
  const church = window.useStewardChurch ? window.useStewardChurch() : {};
  const [names, setNames] = React.useState('');
  const gate = useGoPublicGate();   // printing slips before the relay is public would hand out dead QR codes
  const list = names.split('\n').map(n => n.trim()).filter(Boolean).slice(0, 500);
  const onFile = (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const rdr = new FileReader();
    rdr.onload = () => {
      const txt = String(rdr.result || '');
      setNames(txt.split(/\r?\n/).map(s => (s.split(',')[0] || '').trim()).filter(Boolean).join('\n'));   // first CSV column per line
    };
    rdr.readAsText(f);
  };
  const printSlips = async () => {
    if (!list.length || !window.Steward.joinUrl) return;
    const base = window.Steward.joinUrl().replace('/?follow=', '/join?follow=');   // the smart /join landing (offers the app, or instant-web)
    const cn = church.name ? '&c=' + encodeURIComponent(church.name) : '';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
    const acc = (typeof church.accent === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(church.accent.trim())) ? church.accent.trim() : '#b4533f';
    const mark = await churchMarkDataUrl({ picture: church.picture, name: church.name, accent: church.accent });   // church dp/badge
    const markImg = mark ? `<img class="mark" src="${esc(mark)}" alt="">` : '';
    const slips = list.map(name => {
      const link = base + '&name=' + encodeURIComponent(name) + cn;
      const qr = window.Steward.qrSVG ? window.Steward.qrSVG(link) : '';
      return `<div class="slip">${markImg}<div class="qr">${qr}</div><div class="nm">${esc(name)}</div><div class="ch">Join ${esc(church.name || 'our church')} on TrinityOne</div><div class="hint">Point your phone camera at this code — no app to download, no password. Then tap “Add to Home Screen” to keep it handy.</div></div>`;
    }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Join slips · ${esc(church.name || '')}</title><style>`
      + `body{font-family:system-ui,sans-serif;margin:0;padding:14px;color:#1b1714}`
      + `.bar{background:#f4efe6;border:1px solid #e6ddcb;border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:13px;display:flex;gap:12px;align-items:center}`
      + `.bar button{font:inherit;background:${acc};color:#fff;border:none;border-radius:8px;padding:7px 13px;cursor:pointer;font-weight:700}`
      + `.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}`
      + `.slip{border:1px dashed #bbb;border-top:4px solid ${acc};border-radius:12px;padding:16px 14px;text-align:center;page-break-inside:avoid;display:flex;flex-direction:column;align-items:center;gap:6px}`
      + `.mark{width:46px;height:46px;border-radius:999px;object-fit:cover}`
      + `.qr{width:150px;height:150px}.qr svg{width:100%;height:100%}`
      + `.nm{font-weight:800;font-size:18px;margin-top:2px}.ch{font-size:12px;color:${acc};font-weight:600}`
      + `.hint{font-size:11px;color:#555;max-width:230px;line-height:1.35;margin-top:4px}`
      + `@media print{.bar{display:none}}`
      + `</style></head><body><div class="bar"><span>${list.length} join slip${list.length === 1 ? '' : 's'} for ${esc(church.name || 'your church')}. Print, cut along the dashes, and hand them out.</span><button onclick="window.print()">Print / Save as PDF</button></div><div class="grid">${slips}</div></body></html>`;
    if (window.skPrintable) window.skPrintable(html);
  };
  if (gate.blocking) return (
    <CkModal title="Bring your church on" onClose={onClose}>
      <GoPublicPanel gate={gate} />
    </CkModal>
  );
  return (
    <CkModal title="Bring your church on" onClose={onClose}>
      <GoPublicNote gate={gate} />
      <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 12 }}>Paste your members’ names (one per line) — or import the CSV your old church software exports. We make a printable <b>join slip</b> for each person: a QR they scan, already showing their name. Scanning opens TrinityOne <b>right in their browser</b> — no app to download, no account, no password — and joins them to your church, named.</div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
        <label className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 13, cursor: 'pointer' }}><Icon name="globe" size={14} color="currentColor" /> Import CSV<input type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: 'none' }} /></label>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{list.length} name{list.length === 1 ? '' : 's'}</span>
      </div>
      <textarea value={names} onChange={e => setNames(e.target.value)} placeholder={'Maria Gonzalez\nJohn Park\nGrace Okafor\n…'} style={{ width: '100%', boxSizing: 'border-box', minHeight: 170, border: '1px solid var(--line)', borderRadius: 12, padding: 12, fontSize: 14, fontFamily: 'var(--font-ui)', background: 'var(--surface-2)', color: 'var(--ink)', outline: 'none', resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 11 }}>Cancel</button>
        <button onClick={printSlips} disabled={!list.length} className="sk-btn sk-btn--clay" style={{ flex: 2, padding: 11, opacity: list.length ? 1 : 0.5 }}><Icon name="qr" size={15} color="var(--on-clay)" /> Make {list.length || ''} join slips</button>
      </div>
    </CkModal>
  );
}
window.BulkInviteModal = BulkInviteModal;

function DashMembers() {
  // needed by block(): rotating an encrypted group's key on removal requires knowing the groups.
  const groups = window.useStewardGroups ? window.useStewardGroups() : [];
  const members = window.useStewardMembers();   // real members: joined (presence) and/or active (posts)
  const stewardRoster = window.useStewardStewards ? window.useStewardStewards() : [];   // care-key rotation must keep stewards keyed
  const church = window.useStewardChurch ? window.useStewardChurch() : {};
  const photosAllowed = !(church.features && church.features.memberPhotos === false);   // member photos on by default; church can opt out
  const blockedList = window.useStewardBlocked ? window.useStewardBlocked() : [];
  const blockedSet = new Set(blockedList);
  // safeguarding: who's a child, and which adults are cleared to contact youth (mirrors the church's cleared-worker list)
  const sg = window.useStewardSafeguard ? window.useStewardSafeguard() : { minors: [], approved: [], nophoto: [] };
  const minorsSet = new Set(sg.minors || []);
  const approvedSet = new Set(sg.approved || []);
  const nophotoSet = new Set(sg.nophoto || []);
  const toggleNoPhoto = (pk) => window.Steward.setNoPhoto(nophotoSet.has(pk) ? (sg.nophoto || []).filter(p => p !== pk) : [...(sg.nophoto || []), pk]);
  // Whenever either safeguarding list changes, re-seal the affected member's OWN clearance. Their app reads that
  // instead of the church's list of children, which the relay no longer serves to ordinary members.
  // AUDIT-2026-07-27. Best-effort and deliberately not awaited: the list write is the authoritative one.
  const _reseal = (mins, appr, who) => { try { if (window.Steward.refreshClearances) window.Steward.refreshClearances(who, mins, appr); } catch (e) {} };
  const toggleMinor = (pk) => {
    const next = minorsSet.has(pk) ? (sg.minors || []).filter(p => p !== pk) : [...(sg.minors || []), pk];
    const r = window.Steward.setMinors(next); _reseal(next, sg.approved || [], [pk]); return r;
  };
  const toggleApproved = (pk) => {
    const next = approvedSet.has(pk) ? (sg.approved || []).filter(p => p !== pk) : [...(sg.approved || []), pk];
    const r = window.Steward.setApproved(next); _reseal(sg.minors || [], next, [pk]); return r;
  };
  // safeguarding v2: parent↔child links — pending parent requests + the confirmed map
  const guardReqs = window.useStewardGuardianRequests ? window.useStewardGuardianRequests() : [];
  const guardians = window.useStewardGuardians ? window.useStewardGuardians() : {};
  const pendingReqs = guardReqs.filter(r => !((guardians[r.child] || []).includes(r.parent)));
  const parentSet = new Set(); Object.values(guardians).forEach(ps => (ps || []).forEach(p => parentSet.add(p)));
  const nameByPub = {}; members.forEach(m => { if (m.name) nameByPub[m.pubkey] = m.name; });
  // C1: the guardian-link card must show identities a forger CANNOT control — the roster name we resolved
  // ourselves from the signer's pubkey, plus the npub — not the names carried in the request's content.
  const npubByPub = {}; members.forEach(m => { if (m.npub) npubByPub[m.pubkey] = m.npub; });
  const idOf = (pk) => npubByPub[pk] ? shortNpub(npubByPub[pk]) : ((pk || '').slice(0, 16) + '…');
  const knownName = (pk) => nameByPub[pk] || (members.some(m => m.pubkey === pk) ? 'a member with no name set' : 'someone not on your roster');
  const approveGuardian = (r) => {
    window.Steward.setGuardians({ ...guardians, [r.child]: [...new Set([...(guardians[r.child] || []), r.parent])] });
    if (!minorsSet.has(r.child)) { const next = [...(sg.minors || []), r.child]; window.Steward.setMinors(next); _reseal(next, sg.approved || [], [r.child]); }   // a linked child is a minor
  };
  // steward-initiated link (no parent request): pick an adult as the child's guardian, from the child's row
  const [linkChild, setLinkChild] = React.useState(null);
  const [reseatFor, setReseatFor] = React.useState(null);   // member who lost their 12 words and is back on a new key
  const [bulkOpen, setBulkOpen] = React.useState(false);   // bulk-invite (print join slips) — bring a congregation across
  // safeguarding (child marking, youth clearance, parent links) is OWNER-ONLY at the relay — a delegated
  // steward's writes are rejected. Hide those actions when acting as someone else's steward, so the UI
  // matches the relay instead of silently no-op'ing. (Pills stay visible so they can still SEE the state.)
  const delegated = !!(window.Steward && window.Steward.actingChurch);
  const linkParent = (childPub, parentPub) => {
    if (childPub === parentPub || minorsSet.has(parentPub)) return;   // a parent must be a different, adult account
    window.Steward.setGuardians({ ...guardians, [childPub]: [...new Set([...(guardians[childPub] || []), parentPub])] });
    if (!minorsSet.has(childPub)) { const next = [...(sg.minors || []), childPub]; window.Steward.setMinors(next); _reseal(next, sg.approved || [], [childPub]); }   // a linked child is a minor
    // notify the newly-linked parent so the child actually shows up in THEIR app (they never set it up locally)
    if (window.Steward.notifyGuardian) window.Steward.notifyGuardian(parentPub, childPub, nameByPub[childPub] || '');
  };
  const unlinkParent = (childPub, parentPub) => {
    const cur = (guardians[childPub] || []).filter(p => p !== parentPub);
    const next = { ...guardians }; if (cur.length) next[childPub] = cur; else delete next[childPub];
    window.Steward.setGuardians(next);
  };
  // joining: when approval is on, members who haven't been admitted yet are pending requests
  const joinApproval = window.useStewardJoinPolicy ? window.useStewardJoinPolicy() : false;
  const admittedList = window.useStewardAdmitted ? window.useStewardAdmitted() : [];
  const admittedSet = new Set(admittedList);
  // same reasoning as the dashboard banner: pending is an absence, so it can only be read once the
  // streams that would fill it have landed. Otherwise a hard reload shows the whole church "wanting to
  // join" for a second, each with an Approve button next to them.
  const mIdv = window.useStewardIdv ? window.useStewardIdv() : 0;
  const mRosterLoaded = !window.stewardStreamLoaded
    || (window.stewardStreamLoaded('subscribeAdmitted', mIdv) && window.stewardStreamLoaded('subscribeBlocked', mIdv));
  const pendingJoins = (joinApproval && mRosterLoaded) ? members.filter(m => !admittedSet.has(m.pubkey) && !blockedSet.has(m.pubkey)) : [];
  const pendingSet = new Set(pendingJoins.map(m => m.pubkey));
  const admitMember = (pk) => window.Steward.setAdmitted([...admittedList, pk]);
  const [copied, setCopied] = React.useState('');
  const [showInactive, setShowInactive] = React.useState(false);
  const [showBlocked, setShowBlocked] = React.useState(false);
  const [confirmBlock, setConfirmBlock] = React.useState(null);
  const [q, setQ] = React.useState('');
  const ql = q.trim().toLowerCase();
  const matchQ = (m) => !ql || (m.name || '').toLowerCase().includes(ql) || (m.nip05 || '').toLowerCase().includes(ql) || (m.npub || '').toLowerCase().includes(ql);
  const doCopy = (np) => { copyText(np); setCopied(np); setTimeout(() => setCopied(''), 1400); };
  // Blocking is how a member is removed. Rotate the church's care key at the same time, re-wrapped to everyone
  // EXCEPT them — otherwise "we removed him" left him holding a working copy of the key to the congregation's
  // care records for ever. The ring keeps the old keys so the church never loses its own history; he simply
  // never receives the new one, so nothing sealed from now on is readable to him. (Past records he could
  // already read are past — no key change can retract those, and we don't pretend otherwise.)
  const block = (pk) => {
    setConfirmBlock(null);
    window.Steward.setBlocked([...blockedList, pk]);
    try {
      const remaining = members.map(m => m.pubkey).filter(p => p && p.toLowerCase() !== String(pk || '').toLowerCase() && !blockedSet.has(p));
      if (window.Steward.rotateCareKey) window.Steward.rotateCareKey(remaining, stewardRoster || []);
      if (window.Steward.rotateMediaKey) window.Steward.rotateMediaKey(remaining);   // same for encrypted sermons
      // ENCRYPTED GROUPS TOO. Blocking rotated the care and media keys and nothing else, so a blocked person's
      // phone carried on decrypting every future message in every encrypted group — forever. The background
      // distributor cannot cover it: it only republishes when the recipient set GREW, and a block shrinks it,
      // so a removal published nothing at all. The only {rotate:true} call site was the invite-only members
      // editor, which does not exist for an OPEN encrypted group. The contract in steward.src.js says removal
      // MUST rotate; this is the path that was missing it. AUDIT-2026-07-27.
      // NOT AS A DELEGATED STEWARD. publishGroupKey always signs with churchSk and always seeds the recipient set
      // with churchPub — this device's OWN church key. Acting for a church we merely steward, that re-keys THEIR
      // group under OUR key and leaves the owning church out of the recipients, locking them out of their own
      // room. The same commit added exactly this guard to publishProfile and missed it here. AUDIT-2026-07-27.
      const grps = (!delegated && Array.isArray(groups)) ? groups : [];
      for (const g of grps) {
        if (!g || !g.encrypted) continue;
        const wasIn = g.visibility === 'invite' ? (g.members || []).includes(pk) : true;   // an open group includes everyone
        if (!wasIn) continue;
        const recips = (g.visibility === 'invite' ? (g.members || []).filter(p => p !== pk && !blockedSet.has(String(p || '').toLowerCase())) : remaining);
        if (window.Steward.publishGroupKey) window.Steward.publishGroupKey(g.id, recips, { rotate: true });
        if (g.visibility === 'invite' && window.Steward.publishGroup) window.Steward.publishGroup({ ...g, members: recips });
      }
    } catch (e) {}
  };
  const unblock = (pk) => window.Steward.setBlocked(blockedList.filter(p => p !== pk));
  const total = members.length;
  // "last seen" = newest of a post or a membership heartbeat. No activity in 90 days → inactive list.
  const INACTIVE_DAYS = 90;
  const cutoff = Math.floor(Date.now() / 1000) - INACTIVE_DAYS * 86400;
  const seen = (m) => Math.max(m.lastTs || 0, m.joined || 0);
  const activeM = members.filter(m => seen(m) >= cutoff && !blockedSet.has(m.pubkey) && !pendingSet.has(m.pubkey) && matchQ(m));
  const inactiveM = members.filter(m => seen(m) < cutoff && !blockedSet.has(m.pubkey) && !pendingSet.has(m.pubkey) && matchQ(m));
  const chatting = activeM.filter(m => m.count > 0).length;
  const memberRow = (m, inactive) => {
    const named = !!m.name;
    const label = named ? m.name : 'Anonymous';
    const initials = (named ? m.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'AN').toUpperCase();
    return (
      <div key={m.pubkey} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)', opacity: inactive ? 0.62 : 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <SkBadge initials={initials} size={36} radius={11} accent={SK_TINT[named ? 'gold' : 'sage'].fg} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>{label}</span>
              {nameHandle(m)
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: 'var(--sage)', fontWeight: 700, flexShrink: 0 }} title={m.nip05 || m.npub}>@{nameHandle(m)} <Icon name="check" size={11} stroke={3} color="var(--sage)" /></span>
                : <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.npub}>{shortNpub(m.npub)}</span>}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.count > 0 ? `${m.count} message${m.count === 1 ? '' : 's'} · last ${ago(m.lastTs)}` : `joined ${ago(m.joined)} · hasn’t posted yet`}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button onClick={() => doCopy(m.npub)} title="Copy npub" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', fontFamily: 'var(--font-ui)' }}>
              <Icon name={copied === m.npub ? 'check' : 'link'} size={15} color={copied === m.npub ? 'var(--sage)' : 'currentColor'} /></button>
            {confirmBlock === m.pubkey
              ? <React.Fragment>
                  <button onClick={() => block(m.pubkey)} title="Confirm — bans them from posting & hides their messages" style={{ border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', borderRadius: 9, padding: '6px 9px', cursor: 'pointer', display: 'flex', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}>Block</button>
                  <button onClick={() => setConfirmBlock(null)} title="Cancel" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', fontFamily: 'var(--font-ui)' }}><Icon name="x" size={15} color="currentColor" /></button>
                </React.Fragment>
              : <button onClick={() => setConfirmBlock(m.pubkey)} title="Remove / block this member" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', fontFamily: 'var(--font-ui)' }}><Icon name="shield" size={15} color="currentColor" /></button>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', paddingLeft: 48 }}>
          {inactive ? <SkPill tint="ink">inactive</SkPill> : (m.count === 0 ? <SkPill tint="ink">joined</SkPill> : null)}
          {!named ? <SkPill tint="sage">anonymous</SkPill> : null}
          {minorsSet.has(m.pubkey) ? <SkPill tint="clay">child</SkPill> : null}
          {approvedSet.has(m.pubkey) ? <SkPill tint="gold">cleared for youth</SkPill> : null}
          {(guardians[m.pubkey] && guardians[m.pubkey].length) ? <SkPill tint="sage">parent: {guardians[m.pubkey].map(p => nameByPub[p] || 'linked').join(', ')}</SkPill> : null}
          {minorsSet.has(m.pubkey) && !(guardians[m.pubkey] && guardians[m.pubkey].length) ? <SkPill tint="ink">no guardian</SkPill> : null}
          {parentSet.has(m.pubkey) ? <SkPill tint="sage">parent account</SkPill> : null}
          <button onClick={() => window.dispatchEvent(new CustomEvent('steward-open-dm', { detail: { pubkey: m.pubkey, npub: m.npub, name: label, nip05: m.nip05 } }))} title="Message privately" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 10px', cursor: 'pointer', color: 'var(--clay)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}>
            <Icon name="chat" size={15} color="currentColor" /> Chat</button>
          {!delegated ? (<React.Fragment>
          <button onClick={() => toggleMinor(m.pubkey)} title={minorsSet.has(m.pubkey) ? 'Unmark as a child' : 'Mark as a child — they’ll only see child-safe groups, and adults can only DM them if cleared for youth'} style={{ border: '1px solid ' + (minorsSet.has(m.pubkey) ? 'color-mix(in oklab, var(--clay) 40%, var(--line))' : 'var(--line)'), background: minorsSet.has(m.pubkey) ? 'color-mix(in oklab, var(--clay) 12%, var(--surface))' : 'var(--surface)', borderRadius: 9, padding: '6px 10px', cursor: 'pointer', color: minorsSet.has(m.pubkey) ? 'var(--clay)' : 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}>
            <Icon name="pray" size={14} color="currentColor" /> {minorsSet.has(m.pubkey) ? 'Child ✓' : 'Child'}</button>
          <button onClick={() => toggleApproved(m.pubkey)} title={approvedSet.has(m.pubkey) ? 'Remove youth clearance' : 'Cleared to contact youth — mirror your church’s cleared-worker list. Only cleared adults can DM a child'} style={{ border: '1px solid ' + (approvedSet.has(m.pubkey) ? 'color-mix(in oklab, var(--gold) 45%, var(--line))' : 'var(--line)'), background: approvedSet.has(m.pubkey) ? 'color-mix(in oklab, var(--gold) 14%, var(--surface))' : 'var(--surface)', borderRadius: 9, padding: '6px 10px', cursor: 'pointer', color: approvedSet.has(m.pubkey) ? '#8a6717' : 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}>
            <Icon name="shield" size={14} color="currentColor" /> {approvedSet.has(m.pubkey) ? 'Cleared ✓' : 'Clear for youth'}</button>
          {minorsSet.has(m.pubkey) ? (
            <button onClick={() => setLinkChild(m.pubkey)} title="Link this child to a parent / guardian — they can always reach each other and the parent can collect them at check-in" style={{ border: '1px solid ' + ((guardians[m.pubkey] && guardians[m.pubkey].length) ? 'color-mix(in oklab, var(--sage) 40%, var(--line))' : 'var(--line)'), background: (guardians[m.pubkey] && guardians[m.pubkey].length) ? 'color-mix(in oklab, var(--sage) 10%, var(--surface))' : 'var(--surface)', borderRadius: 9, padding: '6px 10px', cursor: 'pointer', color: 'var(--sage)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}>
              <Icon name="users" size={14} color="currentColor" /> {(guardians[m.pubkey] && guardians[m.pubkey].length) ? 'Parents' : 'Link parent'}</button>
          ) : null}
          <button onClick={() => setReseatFor(m.pubkey)} title="They lost their 12 words and are back on a new phone with a new key — put them back in their place here" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 10px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}>
            <Icon name="swap" size={14} color="currentColor" /> Reconnect</button>
          {photosAllowed && (m.hasPhoto || nophotoSet.has(m.pubkey)) ? (
            <button onClick={() => toggleNoPhoto(m.pubkey)} title={nophotoSet.has(m.pubkey) ? 'Photos are off for this member — your church sees their symbol/initial, and they can’t set a new photo. Tap to allow photos again.' : 'Turn off photos for this member — your church sees their symbol/initial, and they can’t set a photo until you allow it again.'} style={{ border: '1px solid ' + (nophotoSet.has(m.pubkey) ? 'color-mix(in oklab, var(--clay) 40%, var(--line))' : 'var(--line)'), background: nophotoSet.has(m.pubkey) ? 'color-mix(in oklab, var(--clay) 12%, var(--surface))' : 'var(--surface)', borderRadius: 9, padding: '6px 10px', cursor: 'pointer', color: nophotoSet.has(m.pubkey) ? 'var(--clay)' : 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}>
              <Icon name="refresh" size={14} color="currentColor" /> {nophotoSet.has(m.pubkey) ? 'Photos off ✓' : 'Turn off photo'}</button>
          ) : null}
          </React.Fragment>) : null}
        </div>
      </div>
    );
  };
  return (
    <Panel title="Members" action={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>{/* "Invite your church" printed cards hidden for the pilot — re-add this button to restore (BulkInviteModal + state remain below) */}<SkPill tint="sage">{total ? `${activeM.length} active${chatting ? ` · ${chatting} chatting` : ''}` : 'none yet'}</SkPill></span>} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {total === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--ink-3)', padding: 24 }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}><Icon name="pray" size={26} color="var(--ink-3)" /></div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-2)' }}>No members yet.</div>
          <p style={{ fontSize: 13, margin: '6px 0 0', maxWidth: 320, lineHeight: 1.5 }}>Share your invite code — people appear here the moment they join, whether or not they’ve posted.</p>
        </div>
      ) : (
        <React.Fragment>
        {total > 6 || ql ? (
          <div style={{ position: 'relative', marginBottom: 12, flexShrink: 0 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', display: 'flex' }}><Icon name="study" size={15} color="currentColor" /></span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search members by name or @handle" style={{ width: '100%', boxSizing: 'border-box', height: 40, padding: '0 12px 0 34px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 14, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }} />
            {q ? <button onClick={() => setQ('')} title="Clear the search" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="x" size={15} /></button> : null}
          </div>
        ) : null}
        {pendingJoins.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '11px 12px', borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 8%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, var(--line))', marginBottom: 10, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 800, color: 'var(--clay)' }}><Icon name="qr" size={15} color="currentColor" /> Requests to join · {pendingJoins.length}
              {pendingJoins.length > 4 ? <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>scroll for the rest</span> : null}</div>
            {/* The list scrolls INSIDE the panel. It used to grow without limit, so a church with a queue of
                requests had the whole page pushed down — the members list, the safeguarding note and everything
                below it were shoved off-screen behind a wall of Approve buttons. ~4 rows visible, rest scroll. */}
            <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 268, overflowY: 'auto', overscrollBehavior: 'contain' }}>
            {pendingJoins.map(m => {
              const named = !!m.name; const label = named ? m.name : 'Anonymous';
              const initials = (named ? m.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'AN').toUpperCase();
              return (
                <div key={m.pubkey} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)' }}>
                  <SkBadge initials={initials} size={32} radius={10} accent={SK_TINT[named ? 'gold' : 'sage'].fg} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontFamily: nameHandle(m) ? 'var(--font-ui)' : 'var(--mono)' }}>{nameHandle(m) ? '@' + nameHandle(m) : shortNpub(m.npub)} · wants to join</div>
                  </div>
                  <button onClick={() => admitMember(m.pubkey)} className="sk-btn sk-btn--clay" style={{ padding: '7px 12px', fontSize: 12.5, flexShrink: 0 }}><Icon name="check" size={14} color="var(--on-clay)" /> Approve</button>
                  <button onClick={() => block(m.pubkey)} title="Decline — blocks this person from joining or posting" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '7px 9px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}><Icon name="x" size={15} color="currentColor" /></button>
                </div>
              );
            })}
            </div>
          </div>
        ) : null}
        {!delegated && pendingReqs.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '11px 12px', borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 8%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, var(--line))', marginBottom: 10, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 800, color: 'var(--clay)' }}><Icon name="pray" size={15} color="currentColor" /> Parent / child links to confirm · {pendingReqs.length}</div>
            <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', overscrollBehavior: 'contain' }}>
            {pendingReqs.map(r => (
              // SECURITY-AUDIT-2026-07-20 C1: this card used to read "<parentName> set up a child account for
              // <childName>" from content the requester supplied, with nothing verifiable on screen — so a
              // forged request looked exactly like a real one. It now leads with the UNSPOOFABLE identities
              // (the signer's pet-name + both npubs) and demotes the self-reported names to "claims to be",
              // mirroring the steward-approval card. Confirming grants DM access to a child: the steward has
              // to be able to see WHO they are actually linking.
              <div key={r.child} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.4 }}>
                  <div><b style={{ color: 'var(--ink)' }}>{knownName(r.parent)}</b> asks to be linked as a parent{r.claimedParentName ? <span style={{ color: 'var(--ink-3)' }}> · claims to be “{r.claimedParentName}”</span> : null}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--ink-3)', wordBreak: 'break-all', lineHeight: 1.3 }}>parent {idOf(r.parent)}</div>
                  <div style={{ marginTop: 4 }}>of <b style={{ color: 'var(--ink)' }}>{knownName(r.child)}</b>{r.claimedChildName ? <span style={{ color: 'var(--ink-3)' }}> · claims to be “{r.claimedChildName}”</span> : null}{minorsSet.has(r.child) ? null : <span style={{ color: 'var(--clay)' }}> — not currently marked as a child</span>}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--ink-3)', wordBreak: 'break-all', lineHeight: 1.3 }}>child {idOf(r.child)}</div>
                  <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--ink-3)' }}>Confirming lets this person DM the child directly and marks the child as under-18. Check both npubs are who you expect.</div>
                </div>
                <button onClick={() => approveGuardian(r)} className="sk-btn sk-btn--clay" style={{ padding: '7px 13px', fontSize: 12.5, flexShrink: 0 }}><Icon name="check" size={14} color="var(--on-clay)" /> Confirm</button>
              </div>
            ))}
            </div>
          </div>
        ) : null}
        <DismissibleNote id="safeguarding-intro" icon="shield" tone="sage" style={{ marginBottom: 10, flexShrink: 0 }}><b>Safeguarding.</b> Mark under-18s as <b>Child</b> — they’ll only see child-safe groups, and a private message between a child and an adult is blocked unless that adult is <b>cleared for youth</b> (or that adult is the child’s linked <b>parent</b>). Clear only adults on your church’s cleared-worker list. This works alongside — not instead of — your safeguarding policy.</DismissibleNote>
        <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {activeM.map(m => memberRow(m, false))}
          {activeM.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '8px 2px' }}>{ql ? 'No members match “' + q + '”.' : 'No active members in the last ' + INACTIVE_DAYS + ' days.'}</div> : null}
          {inactiveM.length ? (
            <React.Fragment>
              <button onClick={() => setShowInactive(s => !s)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 12px', borderRadius: 11, border: '1px dashed var(--line)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, marginTop: 4 }}>
                <Icon name={showInactive ? 'chevU' : 'chevD'} size={15} color="currentColor" /> {showInactive ? 'Hide' : 'See'} inactive · {inactiveM.length} (no activity in {INACTIVE_DAYS} days)
              </button>
              {showInactive ? inactiveM.map(m => memberRow(m, true)) : null}
            </React.Fragment>
          ) : null}
          {blockedList.length ? (
            <React.Fragment>
              <button onClick={() => setShowBlocked(s => !s)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 12px', borderRadius: 11, border: '1px dashed color-mix(in oklab, var(--clay) 30%, var(--line))', background: 'var(--surface)', cursor: 'pointer', color: 'var(--clay)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, marginTop: 4 }}>
                <Icon name={showBlocked ? 'chevU' : 'chevD'} size={15} color="currentColor" /> {showBlocked ? 'Hide' : 'See'} blocked · {blockedList.length}
              </button>
              {showBlocked ? blockedList.map(pk => (
                <div key={pk} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid color-mix(in oklab, var(--clay) 22%, var(--line))', opacity: 0.85 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 11, background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="shield" size={18} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Blocked member</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-3)' }}>{String(pk).slice(0, 12)}…</div>
                  </div>
                  <button onClick={() => unblock(pk)} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 11px', cursor: 'pointer', color: 'var(--sage)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}>Unblock</button>
                </div>
              )) : null}
            </React.Fragment>
          ) : null}
        </div>
        </React.Fragment>
      )}
      {linkChild ? <GuardianLinkModal child={linkChild} childName={nameByPub[linkChild]} members={members} guardians={guardians} minorsSet={minorsSet} onLink={linkParent} onUnlink={unlinkParent} onClose={() => setLinkChild(null)} /> : null}
      {reseatFor ? <ReseatModal member={reseatFor} memberName={nameByPub[reseatFor] || 'this member'} realName={nameByPub[reseatFor] || ''} isMinor={minorsSet.has(reseatFor)} admittedList={admittedList} onClose={() => setReseatFor(null)} /> : null}
      {bulkOpen ? <BulkInviteModal onClose={() => setBulkOpen(false)} /> : null}
    </Panel>
  );
}
window.DashMembers = DashMembers;

// ── Kids check-in (opt-in; encrypted to the church key) ──────────────────────────────────────────
function CkModal({ title, children, onClose }) {
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 26, background: 'color-mix(in oklab, var(--ink) 34%, transparent)', backdropFilter: 'blur(3px)', animation: 'lumenFade .18s ease both' }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', maxHeight: '88%', display: 'flex', flexDirection: 'column', borderRadius: 22, background: 'var(--paper)', border: '1px solid var(--line)', boxShadow: '0 24px 70px rgba(0,0,0,.28)', overflow: 'hidden', animation: 'lumenScale .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 4px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{title}</div>
          <button onClick={onClose} title="Close" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '8px 10px', minWidth: 40, minHeight: 40, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', display: 'flex' }}><Icon name="x" size={14} /></button>
        </div>
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 20px 20px' }}>{children}</div>
      </div>
    </div>
  );
}
function CheckinPicker({ available, nameFor, guardiansOf, onPick, onClose }) {
  return (
    <CkModal title="Check a child in" onClose={onClose}>
      {available.length === 0 ? <div style={{ fontSize: 13.5, color: 'var(--ink-3)', padding: '12px 0' }}>Everyone’s already checked in.</div> : (
        <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {available.map(c => { const gs = guardiansOf(c); return (
            <button key={c} onClick={() => onPick(c)} title="Check this child in" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
              <div style={{ width: 36, height: 36, borderRadius: 999, background: 'var(--clay-soft)', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="child" size={18} /></div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{nameFor(c)}</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{gs.length ? 'Pickup: ' + gs.join(', ') : 'No guardian linked'}</div></div>
              <Icon name="plus" size={16} color="var(--clay)" />
            </button>
          ); })}
        </div>
      )}
    </CkModal>
  );
}
function CheckoutModal({ rec, onConfirm, onClose }) {
  const [code, setCode] = React.useState('');
  const ok = code.trim() === String(rec.code);
  return (
    <CkModal title={'Check out · ' + (rec.childName || 'child')} onClose={onClose}>
      <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 12 }}>Ask the parent for the <b>pickup code</b> on their slip and enter it to confirm collection.</div>
      <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoFocus placeholder="0000" style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', letterSpacing: '8px', fontSize: 24, fontWeight: 800, fontFamily: 'var(--mono)', padding: '12px', borderRadius: 12, border: '1px solid ' + (code && !ok ? 'var(--clay)' : 'var(--line)'), background: 'var(--surface-2)', color: 'var(--ink)', outline: 'none' }} />
      {code && !ok ? <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', marginTop: 8 }}>That code doesn’t match — don’t release the child if it’s wrong.</div> : null}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 11 }}>Cancel</button>
        <button onClick={onConfirm} disabled={!ok} className="sk-btn sk-btn--clay" style={{ flex: 2, padding: 11, opacity: ok ? 1 : 0.5 }}>Confirm collection</button>
      </div>
    </CkModal>
  );
}
function DashCheckin() {
  const recs = window.useStewardCheckins ? window.useStewardCheckins() : [];
  const sg = window.useStewardSafeguard ? window.useStewardSafeguard() : { minors: [] };
  const minors = sg.minors || [];
  const guardians = window.useStewardGuardians ? window.useStewardGuardians() : {};
  const members = window.useStewardMembers ? window.useStewardMembers() : [];
  const nameFor = (pub) => { const m = members.find(x => x.pubkey === pub); return (m && m.name) || ('Child ' + (pub || '').slice(-6)); };
  const guardiansOf = (pub) => (guardians[pub] || []).map(nameFor).filter(Boolean);
  const today = todayISO();
  const todays = recs.filter(r => r.date === today);
  const present = todays.filter(r => !r.out).sort((a, b) => (b.in || 0) - (a.in || 0));
  const out = todays.filter(r => r.out).sort((a, b) => (b.out || 0) - (a.out || 0));
  const inIds = new Set(present.map(r => r.child));
  const available = minors.filter(c => !inIds.has(c));
  const [picking, setPicking] = React.useState(false);
  const [checkout, setCheckout] = React.useState(null);
  const fmtT = (ts) => { try { return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
  const checkIn = (childPub) => {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    window.Steward.publishCheckin({ child: childPub, childName: nameFor(childPub), date: today, in: Math.floor(Date.now() / 1000), code });
    setPicking(false);
  };
  return (
    <Panel title="Kids check-in" action={
      <button onClick={() => setPicking(true)} disabled={!minors.length} className="sk-btn sk-btn--clay" style={{ padding: '7px 12px', fontSize: 12.5, opacity: minors.length ? 1 : 0.5 }}><Icon name="plus" size={14} color="var(--on-clay)" /> Check a child in</button>
    } style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <DismissibleNote id="kids-checkin-intro" icon="shield" tone="sage" style={{ marginBottom: 14 }}>Check children in and give the parent the <b>pickup code</b>. At collection, match the code on their slip before checking out. Records are <b>encrypted to your church key</b> — only this console sees who’s present.</DismissibleNote>
      {!minors.length ? (
        <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '40px 24px' }}><Icon name="child" size={26} color="var(--ink-3)" /><p style={{ fontSize: 13.5, margin: '10px 0 0', lineHeight: 1.5 }}>No children marked yet. In <b>Members</b>, mark each child (and confirm their guardian) first.</p></div>
      ) : (
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--ink-3)', marginBottom: 8 }}>Checked in · {present.length}</div>
          {present.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 18 }}>Nobody checked in yet today.</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 18 }}>
              {present.map(r => { const gs = guardiansOf(r.child); return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 13, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.childName || nameFor(r.child)}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>In {fmtT(r.in)}{gs.length ? ' · pickup: ' + gs.join(', ') : ' · no guardian linked'}</div>
                  </div>
                  <div title="Pickup code — write it on the parent's slip" style={{ fontFamily: 'var(--mono)', fontWeight: 800, fontSize: 18, letterSpacing: '2px', color: 'var(--clay-ink)', background: 'var(--clay-soft)', borderRadius: 9, padding: '4px 10px', flexShrink: 0 }}>{r.code}</div>
                  <button onClick={() => setCheckout(r)} className="sk-btn sk-btn--ghost" style={{ padding: '7px 12px', fontSize: 12.5, flexShrink: 0 }}>Check out</button>
                </div>
              ); })}
            </div>
          )}
          {out.length ? (
            <React.Fragment>
              <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--ink-3)', marginBottom: 8 }}>Collected · {out.length}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {out.map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink-2)' }}>{r.childName || nameFor(r.child)}</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>In {fmtT(r.in)} · out {fmtT(r.out)}</div></div>
                    <Icon name="check" size={16} stroke={2.4} color="var(--sage)" />
                  </div>
                ))}
              </div>
            </React.Fragment>
          ) : null}
        </div>
      )}
      {picking ? <CheckinPicker available={available} nameFor={nameFor} guardiansOf={guardiansOf} onPick={checkIn} onClose={() => setPicking(false)} /> : null}
      {checkout ? <CheckoutModal rec={checkout} onConfirm={() => { window.Steward.publishCheckin({ ...checkout, out: Math.floor(Date.now() / 1000) }); setCheckout(null); }} onClose={() => setCheckout(null)} /> : null}
    </Panel>
  );
}
window.DashCheckin = DashCheckin;

// full backup dialog: what's included + a passphrase OR PIN + download the encrypted file
function StewBackupModal({ church, onClose }) {
  const [pass, setPass] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [done, setDone] = React.useState(false);
  const secure = (typeof window !== 'undefined') && window.isSecureContext && (typeof crypto !== 'undefined') && crypto.subtle;
  const strength = pass.length === 0 ? null
    : pass.length < 4 ? { t: 'Too short', c: 'var(--ink-3)' }
    : /^\d+$/.test(pass) && pass.length < 6 ? { t: 'PIN — easy to use, easier to guess', c: 'var(--clay)' }
    : pass.length < 8 ? { t: 'OK', c: 'var(--gold)' }
    : { t: 'Strong', c: 'var(--sage)' };
  const make = async () => {
    if (pass.length < 4) { setErr('Use at least 4 characters (a numeric PIN is fine).'); return; }
    setBusy(true); setErr('');
    try {
      const obj = window.TrinityBackup.collectSteward();
      const text = await window.TrinityBackup.encryptObj(obj, pass);
      await window.TrinityBackup.saveFile('trinityone-' + ((church.name || 'church').toLowerCase().replace(/[^a-z0-9]+/g, '-')) + '-' + new Date().toISOString().slice(0, 10) + '.json', text);
      setDone(true); setTimeout(onClose, 1300);
    } catch (e) { setErr('Backup failed: ' + (e.message || e)); setBusy(false); }
  };
  const incl = [
    ['key', 'Your church recovery key', 'The one irreplaceable thing — restores the church anywhere'],
    ['chat', 'Console settings', 'Relays, video channel, preferences'],
    ['globe', 'Your groups, rota & members', 'Live on the relay — they return when you restore the key'],
  ];
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 95, background: 'rgba(40,32,24,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Back up your church" tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 470, maxWidth: '94%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26, maxHeight: '92%', overflowY: 'auto', animation: 'lumenScale .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="lock" size={21} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21 }}>Back up your church</div>
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 18px' }}>One encrypted file you can keep safe (cloud drive, USB stick). You’ll need your passphrase or PIN to restore it.</p>
        {!secure ? (
          <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 28%, transparent)', marginBottom: 16 }}>
            <Icon name="lock" size={17} color="var(--clay)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>You’re on an <b>http</b> address, where the browser disables encryption. Open the console over <b>https</b> (your church’s Tailscale link) to create a backup.</div>
          </div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 18 }}>
          {incl.map(([ic, t, s]) => (
            <div key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--surface)', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={ic} size={16} /></div>
              <div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{t}</div><div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.4 }}>{s}</div></div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>Passphrase or PIN</div>
        <div style={{ display: 'flex', gap: 9 }}>
          <input value={pass} onChange={e => { setPass(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') make(); }} type={show ? 'text' : 'password'} autoFocus inputMode="text" placeholder="a memorable passphrase, or a PIN" style={{ flex: 1, height: 46, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
          <button onClick={() => setShow(s => !s)} className="sk-btn sk-btn--ghost" style={{ padding: '0 14px' }}>{show ? 'Hide' : 'Show'}</button>
        </div>
        {strength ? <div style={{ fontSize: 12, color: strength.c, fontWeight: 600, marginTop: 7 }}>{strength.t}{strength.c === 'var(--clay)' ? ' · longer is safer' : ''}</div> : null}
        {err ? <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', marginTop: 7 }}>{err}</div> : null}
        <div style={{ display: 'flex', gap: 9, padding: '11px 12px', borderRadius: 12, background: 'color-mix(in oklab, var(--gold) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 26%, transparent)', margin: '16px 0 18px' }}>
          <Icon name="shield" size={16} color="#8a6717" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>If you forget this, the backup can’t be opened — not even by us. Store it with the file.</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 13, fontSize: 14 }}>Cancel</button>
          <button onClick={make} disabled={busy || done || pass.length < 4 || !secure} className="sk-btn sk-btn--clay" style={{ flex: 2, padding: 13, fontSize: 14, opacity: (busy || pass.length < 4 || !secure) ? 0.6 : 1 }}>
            <Icon name={done ? 'check' : 'share'} size={15} color="#fff" /> {done ? 'Saved' : busy ? 'Encrypting…' : 'Download encrypted backup'}</button>
        </div>
      </div>
    </div>
  );
}

// a single joined-network row that resolves its name from the network's profile
function NetworkRow({ net, onLeave }) {
  const [name, setName] = React.useState('');
  React.useEffect(() => window.Steward.subscribeNetworkProfile(net.networkPub, (p) => { if (p && p.name) setName(p.name); }), [net.networkPub]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface)', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="globe" size={18} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: name ? 'var(--ink)' : 'var(--ink-3)' }}>{name || 'Resolving…'}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{net.npub.slice(0, 22)}…</div>
      </div>
      <button onClick={() => onLeave(net)} className="sk-btn sk-btn--ghost" style={{ padding: '6px 11px', fontSize: 12.5 }}>Leave</button>
    </div>
  );
}

// the wider network this church belongs to (one for now). A network is its own npub.
// compose & broadcast an announcement AS a network this console owns (the key lives here)
function NetworkAnnounceComposer() {
  const [owned, setOwned] = React.useState(() => (window.Steward.ownedNetworks ? window.Steward.ownedNetworks() : []));
  const [text, setText] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [posts, setPosts] = React.useState([]);
  React.useEffect(() => {
    const refresh = () => setOwned(window.Steward.ownedNetworks ? window.Steward.ownedNetworks() : []);
    window.addEventListener('steward-networks', refresh);
    return () => window.removeEventListener('steward-networks', refresh);
  }, []);
  const net = owned[0] || null;           // one owned network for now
  const [liveName, setLiveName] = React.useState('');
  React.useEffect(() => { if (!net || !window.Steward.subscribeNetworkAnnouncements) return; return window.Steward.subscribeNetworkAnnouncements(net.pub, setPosts); }, [net && net.pub]);
  React.useEffect(() => { setLiveName(''); if (!net || !window.Steward.subscribeNetworkProfile) return; return window.Steward.subscribeNetworkProfile(net.pub, (p) => { if (p && p.name) setLiveName(p.name); }); }, [net && net.pub]);
  if (!net) return null;
  const post = async () => {
    if (!text.trim()) return;
    await window.Steward.publishNetworkAnnouncement(net.pub, text.trim());
    setText(''); setSent(true); setTimeout(() => setSent(false), 1600);
  };
  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Icon name="globe" size={16} color="var(--clay)" />
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>Announce to <b>{liveName || net.name}</b></div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45, marginBottom: 9 }}>Reaches every member of every church in the network.</div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Share news with the whole network…" style={{ width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', padding: '11px 13px', fontSize: 14, lineHeight: 1.5, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', resize: 'vertical', marginBottom: 9 }} />
      <button onClick={post} disabled={!text.trim()} className="sk-btn sk-btn--clay" style={{ padding: '9px 15px', fontSize: 13.5, opacity: text.trim() ? 1 : 0.55 }}><Icon name={sent ? 'check' : 'send'} size={15} color="var(--on-clay)" /> {sent ? 'Sent' : 'Post announcement'}</button>
      {posts.length ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>Recent</div>
          {posts.slice(0, 4).map(p => (
            <div key={p.id} style={{ padding: '10px 12px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 7 }}>
              <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{p.text}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DashNetworksPanel() {
  const networks = window.useStewardNetworks();
  const net = networks[0] || null;        // a church belongs to one network for now
  const [draft, setDraft] = React.useState('');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [created, setCreated] = React.useState(null);   // { npub, mnemonic } just-created — show to save
  const [naming, setNaming] = React.useState(false);    // the create-network wizard
  const [newName, setNewName] = React.useState('');
  const join = () => { const r = window.Steward.joinNetwork && window.Steward.joinNetwork(draft.trim()); if (!r) { setErr('Paste the network’s code (npub1…).'); return; } Promise.resolve(r).then(() => { setDraft(''); setErr(''); }); };
  const leave = (n) => { if (window.confirm('Leave this network? Your members will stop seeing its shared content.')) window.Steward.leaveNetwork(n.networkPub); };
  const doCreate = async () => {
    if (!newName.trim()) return;
    setBusy(true); setNaming(false);
    try { const r = await window.Steward.createNetwork(newName.trim()); if (r) setCreated(r); } catch (e) { setErr('Couldn’t create the network.'); }
    setBusy(false); setNewName('');
  };
  const namingRef = useStewDialog(() => setNaming(false), naming);   // a11y: Escape + focus (create-network dialog)
  return (
    <Panel title="Network">
      {naming ? (
        <div onClick={() => setNaming(false)} style={{ position: 'absolute', inset: 0, zIndex: 95, background: 'rgba(40,32,24,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div ref={namingRef} role="dialog" aria-modal="true" aria-label="Create a network" tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: '94%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26, animation: 'lumenScale .2s ease both' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="globe" size={21} /></div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>Create a network</div>
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 16px' }}>Give it a name your churches will recognise — a region (“Sussex Gospel Partnership”), a family of churches (“Regions Beyond”), or a denomination. You can rename it later from its own console.</p>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>Network name</div>
            <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doCreate(); }} autoFocus placeholder="e.g. Regions Beyond" style={{ width: '100%', height: 46, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 18 }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setNaming(false); setNewName(''); }} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 13, fontSize: 14 }}>Cancel</button>
              <button onClick={doCreate} disabled={!newName.trim()} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 13, fontSize: 14, opacity: newName.trim() ? 1 : 0.55 }}><Icon name="globe" size={15} color="var(--on-clay)" /> Create</button>
            </div>
          </div>
        </div>
      ) : null}
      {created ? (
        <div style={{ borderRadius: 14, border: '1.5px solid color-mix(in oklab, var(--sage) 40%, var(--line))', background: 'color-mix(in oklab, var(--sage) 7%, var(--surface))', padding: 16, marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Network created 🎉</div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 10px' }}>Save this recovery phrase — it’s the network’s key. Restore it in a console to post network-wide announcements, events and plans. Share the code with other churches so they can join.</p>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 3 }}>NETWORK CODE</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, wordBreak: 'break-all', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 9px', marginBottom: 9 }}>{created.npub}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 3 }}>RECOVERY PHRASE</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.6, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', marginBottom: 10 }}>{created.mnemonic}</div>
          <button onClick={() => setCreated(null)} className="sk-btn sk-btn--clay" style={{ padding: '8px 14px', fontSize: 13 }}>I’ve saved it</button>
        </div>
      ) : null}
      <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>Belong to a wider group of churches — a region, a denomination, or a family of churches. Your members see its shared announcements, events and plans alongside your own.</div>
      {net ? (
        <NetworkRow net={net} onLeave={leave} />
      ) : (
        <React.Fragment>
          <button onClick={() => setNaming(true)} disabled={busy} className="sk-btn sk-btn--clay" style={{ width: '100%', padding: 12, fontSize: 14, marginBottom: 12, opacity: busy ? 0.6 : 1 }}><Icon name="globe" size={16} color="var(--on-clay)" /> {busy ? 'Creating…' : 'Create a network'}</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-3)', fontSize: 12, fontWeight: 700, margin: '4px 0 12px' }}><div style={{ flex: 1, height: 1, background: 'var(--line)' }} />OR JOIN ONE<div style={{ flex: 1, height: 1, background: 'var(--line)' }} /></div>
          <div style={{ display: 'flex', gap: 9 }}>
            <input value={draft} onChange={e => { setDraft(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') join(); }} spellCheck={false} autoCapitalize="none"
              placeholder="npub1… (a network’s code)" style={{ flex: 1, height: 44, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink)', outline: 'none' }} />
            <button onClick={join} className="sk-btn sk-btn--ghost" style={{ padding: '0 16px', fontSize: 13 }}>Join</button>
          </div>
        </React.Fragment>
      )}
      {err ? <div style={{ fontSize: 12, color: 'var(--clay-ink)', marginTop: 7 }}>{err}</div> : null}
      <NetworkAnnounceComposer />
    </Panel>
  );
}

// Delegated stewards — the OWNER (this church key) names co-stewards by promoting members. The relay grants
// those keys day-to-day church powers (NOT roster/blocklist/relay-policy) and revocation is instant. The
// roster is owner-signed via Steward.setStewards; see STEWARD-ROSTER-DESIGN.md. Phase 2a: owner-side control.
function DashStewardsPanel({ church }) {
  const stewards = window.useStewardStewards ? window.useStewardStewards() : [];   // hex pubkeys, owner-signed
  const members = window.useStewardMembers ? window.useStewardMembers() : [];
  const stewardSet = new Set(stewards);
  const byPub = new Map(members.map(m => [m.pubkey, m]));
  const ownerPub = (window.Steward && window.Steward.pubkey) || '';
  const [adding, setAdding] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [code, setCode] = React.useState('');
  const [scanning, setScanning] = React.useState(false);
  const [addErr, setAddErr] = React.useState('');
  const [confirmRemove, setConfirmRemove] = React.useState(null);
  const requests = window.usePendingStewards ? window.usePendingStewards() : [];   // would-be stewards awaiting approval
  const [dismissed, setDismissed] = React.useState({});
  const [inviteQR, setInviteQR] = React.useState(false);
  const [copiedInvite, setCopiedInvite] = React.useState(false);
  const [approving, setApproving] = React.useState(null);   // pubkey awaiting PIN confirm
  const [approvePin, setApprovePin] = React.useState('');
  const [approveErr, setApproveErr] = React.useState('');
  const hasPin = !!(window.Steward.hasPinLock && window.Steward.hasPinLock());
  const add = (pk) => { setAdding(false); setScanning(false); setQ(''); setCode(''); setAddErr(''); setApproving(null); window.Steward.setStewards([...stewards, pk]); };
  // approving a steward request is a sensitive action → step up with the console PIN when one is set
  const startApprove = (pk) => { if (hasPin) { setApproving(pk); setApprovePin(''); setApproveErr(''); } else { add(pk); } };
  const confirmApprove = async () => {
    const ok = await window.Steward.verifyPin(approvePin);
    if (!ok) { setApproveErr('That PIN isn’t right.'); return; }
    add(approving);
  };
  const pending = requests.filter(r => !dismissed[r.pubkey] && !stewardSet.has(r.pubkey) && r.pubkey !== ownerPub);
  const remove = (pk) => { setConfirmRemove(null); window.Steward.setStewards(stewards.filter(p => p !== pk)); };
  // add by the steward's own code/npub (from their Steward app → "Become a steward"). The correct path:
  // it names the exact key they'll act with, with no dependency on them being a member here.
  const addByCode = (text) => {
    const pk = window.Steward.stewardCodeToPub ? window.Steward.stewardCodeToPub(text) : null;
    if (!pk) { setAddErr('That doesn’t look like a steward code or npub.'); return; }
    if (pk === ownerPub) { setAddErr('That’s your own key.'); return; }
    if (stewardSet.has(pk)) { setAddErr('They’re already a steward.'); return; }
    add(pk);
  };
  const candidates = members.filter(m => m.pubkey && m.pubkey !== ownerPub && !stewardSet.has(m.pubkey)
    && (!q || (m.name || '').toLowerCase().includes(q.toLowerCase()) || (m.npub || '').includes(q)));
  const initialsOf = (m) => (m && m.name ? m.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'ST').toUpperCase();
  const niceName = (pk) => (window.Steward.stewardName ? window.Steward.stewardName(pk) : '') || 'Steward';
  const row = (pk) => {
    const m = byPub.get(pk) || {};
    const label = m.name || niceName(pk);   // member's real name if known, else the deterministic friendly name
    return (
      <div key={pk} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
        <SkBadge initials={label.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()} size={34} radius={11} accent={SK_TINT.gold.fg} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.npub || ''}>{m.npub ? shortNpub(m.npub) : (pk.slice(0, 10) + '…' + pk.slice(-4))}</div>
        </div>
        {confirmRemove === pk
          ? <React.Fragment>
              <button onClick={() => remove(pk)} title="Confirm — revoke this steward immediately" style={{ border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', borderRadius: 9, padding: '6px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}>Revoke</button>
              <button onClick={() => setConfirmRemove(null)} title="Cancel" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="x" size={15} color="currentColor" /></button>
            </React.Fragment>
          : <button onClick={() => setConfirmRemove(pk)} title="Revoke this steward" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="x" size={15} color="currentColor" /></button>}
      </div>
    );
  };
  return (
    <Panel title="Delegated stewards">
      <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 12 }}>Give a trusted member steward powers <b style={{ color: 'var(--ink)' }}>without sharing the church key</b>. They help run {church.name || 'the church'} — post, create groups, manage members — under their own key. You stay the owner: stewards can’t add other stewards, ban people, or change relay settings. <b style={{ color: 'var(--ink)' }}>Remove anyone anytime</b> and it takes effect immediately.</div>
      {pending.length ? <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--clay-ink)', marginBottom: 7 }}>Requests to steward · {pending.length}</div>
        {pending.map(r => (
          <div key={r.pubkey} style={{ padding: '10px 12px', borderRadius: 12, background: 'color-mix(in oklab, var(--gold) 8%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 26%, var(--line))', marginBottom: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <SkBadge initials={niceName(r.pubkey).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()} size={32} radius={10} accent={SK_TINT.gold.fg} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{niceName(r.pubkey)}</div>
                {r.name ? <div style={{ fontSize: 11.5, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>claims to be “{r.name}”</div> : null}
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--ink-3)', wordBreak: 'break-all', lineHeight: 1.3 }}>{r.npub} · wants to steward</div>
              </div>
              {approving === r.pubkey ? null : <React.Fragment>
                <button onClick={() => startApprove(r.pubkey)} className="sk-btn sk-btn--clay" style={{ padding: '6px 11px', fontSize: 12.5 }}>{hasPin ? 'Approve…' : 'Approve'}</button>
                <button onClick={() => setDismissed(d => ({ ...d, [r.pubkey]: 1 }))} title="Dismiss" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="x" size={14} color="currentColor" /></button>
              </React.Fragment>}
            </div>
            {approving === r.pubkey ? <div style={{ marginTop: 9 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 6 }}>Enter your PIN to approve <b>{niceName(r.pubkey)}</b>{r.name ? ' (claims to be “' + r.name + '”)' : ''} — check the npub above is who you expect.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="password" inputMode="numeric" autoFocus value={approvePin} onChange={e => { setApprovePin(e.target.value); setApproveErr(''); }} onKeyDown={e => { if (e.key === 'Enter') confirmApprove(); }} placeholder="PIN" style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)', padding: '9px 11px', fontSize: 14, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', letterSpacing: '2px' }} />
                <button onClick={confirmApprove} className="sk-btn sk-btn--clay" style={{ padding: '8px 12px', fontSize: 12.5 }}>Approve</button>
                <button onClick={() => setApproving(null)} className="sk-btn sk-btn--ghost" style={{ padding: '8px 10px', fontSize: 12.5 }}>Cancel</button>
              </div>
              {approveErr ? <div style={{ fontSize: 12, color: 'var(--clay)', fontWeight: 600, marginTop: 6 }}>{approveErr}</div> : null}
            </div> : null}
          </div>
        ))}
      </div> : null}
      {stewards.length === 0
        ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '2px 0 10px' }}>No delegated stewards yet.</div>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>{stewards.map(row)}</div>}
      {!adding
        ? <button onClick={() => setAdding(true)} className="sk-btn sk-btn--clay" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="plus" size={15} color="var(--on-clay)" /> Add a steward</button>
        : scanning
          ? <div>
              <StewQRScanner onResult={(payload) => { setScanning(false); addByCode(payload); }} onCancel={() => setScanning(false)} />
              <button onClick={() => setScanning(false)} className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 12.5, marginTop: 8 }}>Cancel scan</button>
            </div>
          : <div>
            {/* primary, easiest path: show an invite QR; they scan it → appear under "Requests to steward" */}
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 8 }}>Show this invite to the would-be steward — in their Steward app they tap <b>Become a steward → Scan an invite</b>. They’ll then appear above under <b>Requests to steward</b> for you to approve.</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => setInviteQR(v => !v)} className="sk-btn sk-btn--clay" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="qr" size={15} color="var(--on-clay)" /> {inviteQR ? 'Hide invite QR' : 'Show invite QR'}</button>
              <button onClick={() => { copyText(window.Steward.stewardInvitePayload ? window.Steward.stewardInvitePayload() : ''); setCopiedInvite(true); setTimeout(() => setCopiedInvite(false), 1400); }} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name={copiedInvite ? 'check' : 'receipt'} size={14} color="currentColor" /> {copiedInvite ? 'Copied' : 'Copy invite'}</button>
            </div>
            {inviteQR ? <div style={{ textAlign: 'center', padding: 12, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--line)', marginTop: 10 }}>
              {window.Steward.stewardInvitePayload && window.Steward.qrSVG ? <div role="img" aria-label="Steward invite QR code" style={{ width: 180, height: 180, margin: '0 auto', background: '#fff', borderRadius: 12, padding: 8, boxSizing: 'border-box' }} dangerouslySetInnerHTML={{ __html: window.Steward.qrSVG(window.Steward.stewardInvitePayload()) }} /> : null}
            </div> : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 8px' }}><div style={{ flex: 1, height: 1, background: 'var(--line)' }} /><span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 700 }}>or add by their code</span><div style={{ flex: 1, height: 1, background: 'var(--line)' }} /></div>
            {/* alternative: add by the steward's OWN code (from their Steward app) */}
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 8 }}>Or ask them to open the <b>Steward app</b> → <b>Become a steward</b> and read you their code (or show its QR).</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <input value={code} onChange={e => { setCode(e.target.value); setAddErr(''); }} autoFocus placeholder="Paste their steward code / npub…" style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface-2)', padding: '10px 12px', fontSize: 13.5, fontFamily: 'var(--mono)', color: 'var(--ink)', outline: 'none' }} />
              <button onClick={() => addByCode(code)} disabled={!code.trim()} className="sk-btn sk-btn--clay" style={{ padding: '9px 13px', fontSize: 13, opacity: code.trim() ? 1 : 0.5, flexShrink: 0 }}>Add</button>
            </div>
            {(() => { const pv = code.trim() && window.Steward.stewardCodeToPub ? window.Steward.stewardCodeToPub(code) : null; return pv ? <div style={{ fontSize: 12.5, color: 'var(--sage)', fontWeight: 700, margin: '2px 0 8px' }}>Adds: {niceName(pv)} — check this matches what they told you.</div> : null; })()}
            {(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ? <button onClick={() => { setAddErr(''); setScanning(true); }} className="sk-btn sk-btn--ghost" style={{ padding: '8px 12px', fontSize: 12.5 }}><Icon name="qr" size={14} color="currentColor" /> Scan their QR</button> : null}
            {addErr ? <div style={{ fontSize: 12.5, color: 'var(--clay)', fontWeight: 600, marginTop: 7 }}>{addErr}</div> : null}
            {/* secondary convenience: promote a member who uses this SAME key in the Steward app */}
            {candidates.length ? <React.Fragment>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 8px' }}><div style={{ flex: 1, height: 1, background: 'var(--line)' }} /><span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 700 }}>or pick a member</span><div style={{ flex: 1, height: 1, background: 'var(--line)' }} /></div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45, marginBottom: 7 }}>Only if they use the <b>same key</b> in the Steward app (e.g. they restored their member phrase there). Otherwise use their steward code above.</div>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search members…" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface-2)', padding: '9px 12px', fontSize: 13, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 8 }} />
              <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {candidates.slice(0, 40).map(m => (
                  <button key={m.pubkey} onClick={() => add(m.pubkey)} title="Add this member as a steward" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
                    <SkBadge initials={(m.name ? m.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'AN').toUpperCase()} size={30} radius={9} accent={SK_TINT[m.name ? 'gold' : 'sage'].fg} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || 'Anonymous'}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>{shortNpub(m.npub)}</div>
                    </div>
                    <Icon name="plus" size={16} color="var(--clay)" />
                  </button>
                ))}
              </div>
            </React.Fragment> : null}
            <button onClick={() => { setAdding(false); setQ(''); setCode(''); setAddErr(''); }} className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 12.5, marginTop: 10 }}>Done</button>
          </div>}
    </Panel>
  );
}

// "Become a steward" — the OTHER side of the handshake: this console shows ITS OWN public code so a church
// owner can add it under Delegated stewards. Shares only the npub (public), never a key. See
// STEWARDS-AND-HANDOFF-EXPLAINED.md.
function DashBecomeStewardPanel() {
  const npub = (window.Steward && window.Steward.npub) || '';
  const code = window.Steward.becomeStewardPayload ? window.Steward.becomeStewardPayload() : '';
  const [showQR, setShowQR] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [scanInvite, setScanInvite] = React.useState(false);
  const [inviteText, setInviteText] = React.useState('');
  const [reqMsg, setReqMsg] = React.useState('');
  const svg = showQR && window.Steward.qrSVG ? window.Steward.qrSVG(code) : '';
  if (!code) return null;
  const onInvite = (payload) => {
    setScanInvite(false);
    Promise.resolve(window.Steward.requestSteward(payload)).then(r => {
      setReqMsg(r && r.ok ? '✓ Request sent — the church’s owner will approve you. The church will then appear in your switcher (top-left).' : ((r && r.error) || 'Couldn’t send the request.'));
    });
  };
  return (
    <Panel title="Become a steward">
      <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 12 }}>Helping run <b style={{ color: 'var(--ink)' }}>another</b> church? Easiest: <b style={{ color: 'var(--ink)' }}>scan its invite</b> and the owner approves you. (Or give the owner your code below.) This shares only your public ID — never a key.</div>
      {scanInvite
        ? <div><StewQRScanner onResult={onInvite} onCancel={() => setScanInvite(false)} /><button onClick={() => setScanInvite(false)} className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 12.5, marginTop: 8 }}>Cancel scan</button></div>
        : <div>
            <button onClick={() => { setReqMsg(''); setScanInvite(true); }} className="sk-btn sk-btn--clay" style={{ padding: '10px 14px', fontSize: 13.5 }}><Icon name="qr" size={15} color="var(--on-clay)" /> Scan a church’s invite</button>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', margin: '9px 0 6px' }}>No camera? Paste the invite the owner sent you:</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={inviteText} onChange={e => { setInviteText(e.target.value); setReqMsg(''); }} placeholder="Paste the church invite…" style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface-2)', padding: '10px 12px', fontSize: 13.5, fontFamily: 'var(--mono)', color: 'var(--ink)', outline: 'none' }} />
              <button onClick={() => onInvite(inviteText)} disabled={!inviteText.trim()} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13, opacity: inviteText.trim() ? 1 : 0.5, flexShrink: 0 }}>Send</button>
            </div>
          </div>}
      {reqMsg ? <div style={{ fontSize: 12.5, color: reqMsg.startsWith('✓') ? 'var(--sage)' : 'var(--clay)', fontWeight: 600, marginTop: 9, lineHeight: 1.45 }}>{reqMsg}</div> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 12px' }}><div style={{ flex: 1, height: 1, background: 'var(--line)' }} /><span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 700 }}>or give the owner your code</span><div style={{ flex: 1, height: 1, background: 'var(--line)' }} /></div>
      <div style={{ padding: '12px 14px', borderRadius: 12, background: 'color-mix(in oklab, var(--gold) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 26%, var(--line))', marginBottom: 10 }}>
        <div title="A memorable name generated from your key — the same key always makes this exact name. The owner compares it when adding you, so it's a quick human cross-check that they've got the right person. It isn't a display name; your npub is the real identifier." style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', cursor: 'help' }}>Your steward name</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, color: 'var(--ink)' }}>{(window.Steward.stewardName && window.Steward.stewardName(npub)) || '—'}</div>
      </div>
      <SkKey value={npub || '—'} label="your steward code" />
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={() => { copyText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); }} className="sk-btn sk-btn--clay" style={{ padding: '8px 12px', fontSize: 13 }}><Icon name={copied ? 'check' : 'receipt'} size={14} color="var(--on-clay)" /> {copied ? 'Copied' : 'Copy code'}</button>
        <button onClick={() => setShowQR(s => !s)} className="sk-btn sk-btn--ghost" style={{ padding: '8px 12px', fontSize: 13 }}><Icon name="qr" size={14} color="currentColor" /> {showQR ? 'Hide QR' : 'Show QR'}</button>
      </div>
      {showQR && svg ? <div style={{ width: 184, height: 184, margin: '12px auto 0', background: '#fff', borderRadius: 12, padding: 8, boxSizing: 'border-box' }} dangerouslySetInnerHTML={{ __html: svg }} /> : null}
    </Panel>
  );
}

// church video channel — members' Watch tab auto-fills from this on follow (via the gateway feed proxy)
// church media — video channel (Watch tab) + podcast RSS (Listen tab), merged into one panel to save space
function DashMediaPanel({ church }) {
  const [vid, setVid] = React.useState(''); const [vidSaved, setVidSaved] = React.useState(false);
  const [aud, setAud] = React.useState(''); const [audSaved, setAudSaved] = React.useState(false);
  React.useEffect(() => { setVid(church.channel || ''); }, [church.channel]);
  React.useEffect(() => { setAud(church.audioFeed || ''); }, [church.audioFeed]);
  const saveVid = () => { window.Steward.publishProfile({ channel: vid.trim() }); setVidSaved(true); setTimeout(() => setVidSaved(false), 1700); };
  const saveAud = () => { window.Steward.publishProfile({ audioFeed: aud.trim() }); setAudSaved(true); setTimeout(() => setAudSaved(false), 1700); };
  const lbl = { fontSize: 11.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 6px' };
  const inp = { flex: 1, height: 44, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--ink)', outline: 'none' };
  return (
    <Panel title="Video & audio">
      <div style={lbl}>Video channel · Watch tab</div>
      <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 10 }}>Your church’s <b>YouTube</b> or <b>Rumble</b> channel — or an <b>unlisted YouTube playlist</b> (not publicly searchable — a private set only your members see). Videos appear in members’ Watch tab, auto-updated.</div>
      <div style={{ display: 'flex', gap: 9 }}>
        <input value={vid} onChange={e => setVid(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveVid(); }} spellCheck={false} autoCapitalize="none" placeholder="youtube.com/@yourchurch · youtube.com/playlist?list=… · rumble.com/c/…" style={inp} />
        <button onClick={saveVid} className="sk-btn sk-btn--clay" style={{ padding: '0 16px', fontSize: 13 }}><Icon name={vidSaved ? 'check' : 'send'} size={15} color="var(--on-clay)" /> {vidSaved ? 'Saved' : 'Save'}</button>
      </div>
      {church.channel ? <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>Current: <span style={{ fontFamily: 'var(--mono)' }}>{church.channel}</span></div> : null}
      <div style={{ height: 1, background: 'var(--line)', margin: '16px 0' }} />
      <div style={lbl}>Audio / podcast · Listen tab</div>
      <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 10 }}>A <b>podcast RSS feed</b> (sermons, devotionals) — episodes stream in the Listen tab. Most hosts (Buzzsprout, Podbean, Apple, Spotify for Podcasters) give an RSS link. An <b>unlisted / private feed URL works too</b> — keep the link unguessable and it stays members-only.</div>
      <div style={{ display: 'flex', gap: 9 }}>
        <input value={aud} onChange={e => setAud(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveAud(); }} spellCheck={false} autoCapitalize="none" placeholder="https://feeds.yourhost.com/yourchurch.xml" style={inp} />
        <button onClick={saveAud} className="sk-btn sk-btn--clay" style={{ padding: '0 16px', fontSize: 13 }}><Icon name={audSaved ? 'check' : 'send'} size={15} color="var(--on-clay)" /> {audSaved ? 'Saved' : 'Save'}</button>
      </div>
      {church.audioFeed ? <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>Current: <span style={{ fontFamily: 'var(--mono)' }}>{church.audioFeed}</span></div> : null}
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 14, lineHeight: 1.5 }}>Want to host your church’s <b>own</b> audio/video (members-only, no YouTube)? That lives in <b>Resources → Sermons</b>.</div>
    </Panel>
  );
}

// Self-hosted media (Tier 2) — the church uploads its OWN audio/video, stored on its relay, members-only.
// Lives under Resources (content authoring), not Settings. Backup hosts auto-fill from the church's relays.
// Edit an uploaded sermon's name + details (re-publishes the same doc; the file/blob is untouched).
function SermonEditModal({ sermon, onSave, onClose }) {
  const [title, setTitle] = React.useState(sermon.title || '');
  const [desc, setDesc] = React.useState(sermon.desc || '');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const isVideo = String(sermon.mime || '').startsWith('video');
  const save = async () => {
    if (!title.trim()) return;
    setBusy(true); setErr('');
    try { await onSave({ title: title.trim(), desc: desc.trim() }); onClose(); }   // close only on success
    catch (e) { setErr((e && e.message) || 'Couldn’t save — check your connection and try again.'); }
    finally { setBusy(false); }
  };
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 96, background: 'rgba(40,32,24,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={'Edit ' + (isVideo ? 'video' : 'audio') + ' details'} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: '94%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26, animation: 'lumenScale .2s ease both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={isVideo ? 'play' : 'headphones'} size={21} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>Edit {isVideo ? 'video' : 'audio'} details</div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 16px' }}>Rename it and add details{isVideo ? ' — members see the description under the video in Watch' : ''}. This only changes the label — the file itself stays as uploaded.</p>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>Title</div>
        <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} autoFocus placeholder="e.g. Sunday sermon — the Prodigal Son" aria-label="Title" style={{ width: '100%', boxSizing: 'border-box', height: 46, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }} />
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>Details <span style={{ textTransform: 'none', fontWeight: 500 }}>· optional</span></div>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="Speaker, date, passage, or a short summary…" aria-label="Details" style={{ width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 14, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 18, resize: 'vertical', lineHeight: 1.45 }} />
        {err ? <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12.5, color: 'var(--clay-ink)', marginBottom: 12, lineHeight: 1.45 }}><Icon name="alert" size={15} color="var(--clay)" /><span>{err}</span></div> : null}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 13, fontSize: 14 }}>Cancel</button>
          <button onClick={save} disabled={busy || !title.trim()} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 13, fontSize: 14, opacity: (busy || !title.trim()) ? 0.55 : 1 }}><Icon name="check" size={15} color="var(--on-clay)" /> {busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
// Detect H.265/HEVC video — phones' default "High Efficiency" format, which desktop browsers can't decode.
// Scans the mp4 sample-description fourcc ('hvc1'/'hev1') at the head AND tail (moov may be faststart or trailing).
// Device-independent, so it warns even when a steward uploads from a phone (where the file plays fine locally).
async function probeHevcVideo(file) {
  try {
    if (!String(file.type || '').startsWith('video')) return false;
    const hit = (buf) => {
      const b = new Uint8Array(buf);
      for (let i = 0; i + 4 <= b.length; i++) {
        if (b[i] === 0x68) { const a = b[i + 1], c = b[i + 2], d = b[i + 3];   // 'h'
          if ((a === 0x76 && c === 0x63 && d === 0x31) || (a === 0x65 && c === 0x76 && d === 0x31)) return true; }   // 'hvc1' / 'hev1'
      }
      return false;
    };
    const CH = 2 * 1048576;
    if (hit(await file.slice(0, Math.min(file.size, CH)).arrayBuffer())) return true;
    if (file.size > CH && hit(await file.slice(Math.max(0, file.size - CH)).arrayBuffer())) return true;
    return false;
  } catch { return false; }
}

function DashSermons() {
  const [sermons, setSermons] = React.useState([]);
  const members = window.useStewardMembers ? window.useStewardMembers() : [];
  const [encOn, setEncOn] = React.useState(false);
  const autoBackups = React.useMemo(() => { try { return (window.Steward.mediaHosts ? window.Steward.mediaHosts() : []).slice(1); } catch { return []; } }, []);
  const [mirrorHosts, setMirrorHosts] = React.useState(autoBackups.join(', '));   // auto-filled from the church's other relays; editable
  const [pinnedId, setPinnedId] = React.useState(null);   // the currently-featured sermon (pushed to members' Today)
  const conn = window.useStewardConn ? window.useStewardConn() : 0;   // re-subscribe after a relay restart / reconnect (else a sermon uploaded elsewhere never appears)
  React.useEffect(() => (window.Steward.subscribeSermons ? window.Steward.subscribeSermons(setSermons) : undefined), [conn]);
  React.useEffect(() => (window.Steward.subscribeMediaKey ? window.Steward.subscribeMediaKey() : undefined), [conn]);
  React.useEffect(() => (window.Steward.subscribePinnedSermon ? window.Steward.subscribePinnedSermon(p => setPinnedId(p && p.id)) : undefined), [conn]);
  const togglePin = (s) => { if (pinnedId === s.id) window.Steward.unpinSermon(); else window.Steward.pinSermon(s); };
  const fileRef = React.useRef(null);
  const [upBusy, setUpBusy] = React.useState(false); const [upMsg, setUpMsg] = React.useState('');
  const [editing, setEditing] = React.useState(null);
  const [notify, setNotify] = React.useState(true);   // feature the new upload on members' Today + push
  const [pendingDelete, setPendingDelete] = React.useState(null);
  const [pendingHevc, setPendingHevc] = React.useState(null);   // an HEVC video awaiting "upload anyway?" confirmation
  const [pendingBigEnc, setPendingBigEnc] = React.useState(null);   // a large ENCRYPTED video awaiting "upload anyway?" (OOM risk on low-end phones)
  const ENC_VIDEO_WARN = 50 * 1048576;   // encrypted media downloads whole + decrypts in RAM (~2-3× its size); above this a 2GB phone can OOM before it plays
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    if (await probeHevcVideo(f)) { setPendingHevc(f); return; }   // warn before uploading a format web browsers can't play
    if (encOn && String(f.type || '').startsWith('video') && f.size > ENC_VIDEO_WARN) { setPendingBigEnc(f); return; }   // #18 interim: guard the real OOM path
    doUpload(f);
  };
  const doUpload = async (f) => {
    const bigVid = String(f.type || '').startsWith('video') && f.size > 25 * 1048576;   // stopgap until on-device transcode: flag a heavy video
    setUpBusy(true); setUpMsg((bigVid ? '⚠ Large video (' + fmtSize(f.size) + ') — slow to upload' + (encOn ? ' + play' : '') + '. ' : '') + (encOn ? 'Encrypting + uploading ' : 'Uploading ') + f.name + '…');
    let ok = false;
    try {
      const encFn = (encOn && window.Steward.mediaEncryptor) ? await window.Steward.mediaEncryptor(members.map(m => m.pubkey).filter(Boolean)) : undefined;
      const mirrors = mirrorHosts.split(',').map(s => s.trim()).filter(Boolean);
      const b = await window.Steward.uploadBlob(f, encFn, mirrors);
      const pub = await window.Steward.publishSermon({ title: f.name.replace(/\.[^.]+$/, ''), sha256: b.sha256, host: b.host, hosts: b.hosts, mime: b.mime, size: b.size, enc: b.enc });
      if (notify && pub && window.Steward.pinSermon) { try { await window.Steward.pinSermon(pub); } catch (e) {} }   // feature on members' Today → "New video / New audio clip" card + push
      const backups = (b.hosts || []).length - 1;
      setUpMsg('✓ Uploaded “' + f.name + '”' + (b.enc ? ' (encrypted)' : '') + (notify ? ' · members notified' : '') + (backups > 0 ? ` · ${backups} backup${backups > 1 ? 's' : ''}` : (mirrors.length ? ' · backups failed' : '')));
      ok = true;
    } catch (err) { setUpMsg('✗ ' + ((err && err.message) || 'Upload failed')); }   // surface the relay's real message (storage full / too large / …)
    setUpBusy(false); if (ok) setTimeout(() => setUpMsg(''), 3500);   // keep errors visible; only auto-clear success
  };
  const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  return (
    <div className="no-scrollbar" style={{ height: '100%', overflowY: 'auto' }}>
      {editing ? <SermonEditModal sermon={editing} onSave={(fields) => Promise.resolve(window.Steward.publishSermon({ ...editing, ...fields }))} onClose={() => setEditing(null)} /> : null}
      {pendingDelete ? <SkConfirm icon="trash" title={'Remove “' + (pendingDelete.title || 'this') + '”?'} confirmLabel="Remove" body="It disappears from members’ apps and the stored file is deleted from your relay(s) to free the space. This can’t be undone." onConfirm={() => { window.Steward.removeSermon(pendingDelete); setPendingDelete(null); }} onCancel={() => setPendingDelete(null)} /> : null}
      {pendingHevc ? <SkConfirm icon="alert" tint="var(--gold)" title="This video may not play in web browsers" confirmLabel="Upload anyway" body="It’s recorded in H.265/HEVC — your phone’s “High Efficiency” format. Phones play it fine, but web browsers (and some older devices) can’t. To reach everyone, set your camera to “Most Compatible” (H.264) and re-record. Upload this one anyway? Members on the phone app will still be able to watch it." onConfirm={() => { const f = pendingHevc; setPendingHevc(null); doUpload(f); }} onCancel={() => setPendingHevc(null)} /> : null}
      {pendingBigEnc ? <SkConfirm icon="alert" tint="var(--gold)" title="Large encrypted video" confirmLabel="Upload anyway" body={'This encrypted video is ' + fmtSize(pendingBigEnc.size) + '. Encrypted media has to download in full and decrypt in memory before it plays — which needs 2–3× its size in RAM, so on an older phone it may fail to play at all. To be safe, trim it, export at 720p, or leave encryption off for this one (it stays members-only either way). Upload it as-is?'} onConfirm={() => { const f = pendingBigEnc; setPendingBigEnc(null); doUpload(f); }} onCancel={() => setPendingBigEnc(null)} /> : null}
      <Panel title="Self-hosted sermons">
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 12 }}>Upload the church’s <b>own audio or video</b> — it lives on your relay, <b>members only</b> (no YouTube, no public feed). Audio appears in members’ <b>Listen</b> tab, video in <b>Watch</b>. Great over a thin connection.</div>
        {sermons.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 12 }}>{sermons.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <Icon name={String(s.mime || '').startsWith('video') ? 'play' : 'headphones'} size={16} color="var(--sage)" />
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.desc ? s.desc : (fmtSize(s.size || 0) + (s.enc ? ' · encrypted' : ''))}</div></div>
            <button onClick={() => setEditing(s)} title="Edit name & details" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '8px 10px', minWidth: 40, minHeight: 40, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="pen" size={14} color="currentColor" /></button>
            <button onClick={() => togglePin(s)} title={pinnedId === s.id ? 'Pinned to members’ Today — tap to unpin' : 'Pin to members’ Today (sends a notification)'} style={{ border: '1px solid ' + (pinnedId === s.id ? 'var(--clay)' : 'var(--line)'), background: pinnedId === s.id ? 'var(--clay)' : 'var(--surface)', borderRadius: 9, padding: '8px 10px', minWidth: 40, minHeight: 40, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: pinnedId === s.id ? '#fff' : 'var(--ink-3)', display: 'flex' }}><Icon name="pin" size={14} color="currentColor" /></button>
            <button onClick={() => setPendingDelete(s)} title="Remove" aria-label="Remove sermon" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '8px 10px', minWidth: 40, minHeight: 40, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="trash" size={14} color="currentColor" /></button>
          </div>))}</div> : null}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-2)', margin: '0 0 10px', cursor: 'pointer', lineHeight: 1.4 }}>
          <input type="checkbox" checked={encOn} onChange={e => setEncOn(e.target.checked)} style={{ flexShrink: 0 }} />
          <span><b>Encrypt</b> — only your members can decrypt it (protects it from the host and any cloud backup)</span>
        </label>
        {encOn ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, color: 'var(--ink-2)', background: 'color-mix(in oklab, var(--gold) 12%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 30%, var(--line))', borderRadius: 10, padding: '9px 11px', margin: '0 0 10px', lineHeight: 1.45 }}>
            <Icon name="alert" size={15} color="var(--gold)" />
            <span>Encrypted media <b>can’t stream</b> — the whole file downloads (at its full size in data) and decrypts <b>before</b> it plays, so a large video means a long wait before it starts. It stays members-only either way, so for a big sermon video you may prefer to leave this off.</span>
          </div>
        ) : null}
        <input value={mirrorHosts} onChange={e => setMirrorHosts(e.target.value)} placeholder="Backup copy host(s) — optional, comma-separated"
          title="Mirror each upload to another media host for redundancy. Content-addressed, so playback fails over automatically."
          style={{ width: '100%', boxSizing: 'border-box', height: 38, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 12.5, color: 'var(--ink)', margin: '0 0 4px', fontFamily: 'var(--font-ui)' }} />
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 10, lineHeight: 1.4 }}>{autoBackups.length ? 'Auto-filled from your church’s other relays — each upload is mirrored there for redundancy. Edit if needed.' : 'Add another media host to keep backup copies. When your church runs a second relay, it’s suggested here automatically.'}</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-2)', margin: '0 0 12px', cursor: 'pointer', lineHeight: 1.4 }}>
          <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} style={{ flexShrink: 0 }} />
          <span><b>Notify members</b> — feature it on everyone’s Today (“New video / New audio clip”) + send a notification. It becomes the one featured item, replacing any previous. Leave off for a quiet upload.</span>
        </label>
        <input ref={fileRef} type="file" accept="audio/*,video/*" style={{ display: 'none' }} onChange={onFile} />
        <button onClick={() => fileRef.current && fileRef.current.click()} disabled={upBusy} className="sk-btn sk-btn--clay" style={{ fontSize: 13, opacity: upBusy ? 0.6 : 1 }}><Icon name={upBusy ? 'refresh' : 'plus'} size={15} color="var(--on-clay)" /> {upBusy ? 'Working…' : 'Upload audio or video'}</button>
        {upMsg ? <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 8 }}>{upMsg}</div> : null}
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 10, lineHeight: 1.45 }}>Big videos are slow to upload and, if encrypted, slow to play. Record or export at <b>~720p</b> and keep clips short — a few minutes is usually a few MB. <a href="https://github.com/TrinityOneAdmin/TrinityOne/blob/main/docs/guides/STEWARD-GUIDE.md#keeping-video-small-and-fast" target="_blank" rel="noopener" style={{ color: 'var(--clay)', textDecoration: 'none', fontWeight: 600 }}>How to shrink a video →</a></div>
      </Panel>
    </div>
  );
}
window.DashSermons = DashSermons;

// Steward-defined chat message tags. Members can flag a message as a "Prayer request" (built-in); this lets
// the church add its own — Testimony, Praise, … — published as one church-signed doc. Icon/accent come from
// fixed allowlists (no free-text CSS/icons). A tag's id is STABLE once saved, so renaming its label never
// orphans messages already flagged with it.
const CHATTAG_ICONS = ['pray', 'sparkle', 'heart', 'flame', 'hand', 'gift', 'music'];
const CHATTAG_ACCENTS = [['gold', 'var(--gold)'], ['sage', 'var(--sage)'], ['clay', 'var(--clay)'], ['sky', '#5360D6'], ['plum', '#C24B7A'], ['teal', '#2E8B8B']];
const chatTagCss = (a) => (CHATTAG_ACCENTS.find(x => x[0] === a) || CHATTAG_ACCENTS[2])[1];
const CHATTAG_PRAYER = { id: 'prayer', label: 'Prayer request', icon: 'pray', accent: 'gold' };
function DashChatTagsPanel({ church }) {
  const [tags, setTags] = React.useState(null);   // null = still loading; else the editable list
  const [editIdx, setEditIdx] = React.useState(-1);   // which row's icon/colour picker is expanded (-1 = none)
  const [msg, setMsg] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!window.Steward.subscribeMessageTags) { setTags([{ ...CHATTAG_PRAYER }]); return; }
    // t === null → this church has NO tags doc yet: seed the default (Prayer request), editable + removable.
    return window.Steward.subscribeMessageTags(t => setTags(t === null ? [{ ...CHATTAG_PRAYER }] : t));
  }, []);
  const list = tags || [];
  const setRow = (i, patch) => setTags(list.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const add = () => { setTags([...list, { id: '', label: '', icon: 'sparkle', accent: 'clay' }]); setEditIdx(list.length); };   // open the new row's picker
  const remove = (i) => { setTags(list.filter((_, j) => j !== i)); setEditIdx(-1); };
  const save = async () => {
    setBusy(true); setMsg('');
    try { const saved = await window.Steward.publishMessageTags(list); setTags(saved || []); setEditIdx(-1); setMsg('✓ Saved — members see these on their next sync.'); }
    catch (e) { setMsg('Couldn’t save — try again.'); }
    setBusy(false);
    setTimeout(() => setMsg(''), 4000);
  };
  const swatch = { width: 22, height: 22, borderRadius: 999, cursor: 'pointer', flexShrink: 0, padding: 0 };
  const iconBtn = (active) => ({ width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, background: active ? 'color-mix(in oklab, var(--clay) 12%, var(--surface))' : 'var(--surface)', border: '1px solid ' + (active ? 'var(--clay)' : 'var(--line)') });
  const sq = (open) => ({ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '1px solid ' + (open ? 'var(--clay)' : 'var(--line)'), background: open ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface)' });
  return (
    <Panel title="Chat message tags">
      <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 12 }}>Members can flag a message so it stands out. <b>Prayer request</b> is here by default — rename, recolour or remove it. Add your own, like Testimony or Praise. Up to 6.</div>

      {tags === null ? <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Loading…</div> : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((t, i) => { const ac = chatTagCss(t.accent); const open = editIdx === i; return (
          <div key={i} style={{ borderRadius: 11, border: '1px solid ' + (open ? 'color-mix(in oklab, var(--clay) 30%, var(--line))' : 'var(--line)'), background: 'var(--surface-2)', padding: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, ' + ac + ' 12%, var(--surface))', color: ac }}><Icon name={t.icon} size={16} color={ac} /></div>
              <input value={t.label} onChange={e => setRow(i, { label: e.target.value.slice(0, 24) })} placeholder="Tag name" maxLength={24} style={{ flex: 1, minWidth: 0, height: 32, padding: '0 10px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 14, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
              <button onClick={() => setEditIdx(open ? -1 : i)} aria-label="Icon &amp; colour" title="Change icon &amp; colour" style={sq(open)}><Icon name="pen" size={14} color={open ? 'var(--clay)' : 'var(--ink-3)'} /></button>
              <button onClick={() => remove(i)} aria-label="Remove tag" title="Remove tag" style={sq(false)}><Icon name="trash" size={14} color="var(--ink-3)" /></button>
            </div>
            {open ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                {CHATTAG_ICONS.map(ic => (
                  <button key={ic} onClick={() => setRow(i, { icon: ic })} aria-label={'Icon ' + ic} style={iconBtn(t.icon === ic)}><Icon name={ic} size={15} color={t.icon === ic ? ac : 'var(--ink-3)'} /></button>
                ))}
                <div style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 2px' }} />
                {CHATTAG_ACCENTS.map(([id, css]) => (
                  <button key={id} onClick={() => setRow(i, { accent: id })} aria-label={'Colour ' + id} title={id} style={{ ...swatch, background: css, border: t.accent === id ? '2px solid var(--ink)' : '2px solid transparent', boxShadow: t.accent === id ? '0 0 0 2px var(--surface) inset' : 'none' }} />
                ))}
              </div>
            ) : null}
          </div>
        ); })}
        {list.length < 6 ? (
          <button onClick={add} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 12px', borderRadius: 10, border: '1px dashed var(--line)', background: 'none', cursor: 'pointer', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-ui)' }}><Icon name="plus" size={15} color="var(--clay)" /> Add a tag</button>
        ) : <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>You’ve reached the limit of 6 tags.</div>}
      </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <button onClick={save} disabled={busy || tags === null} className="sk-btn sk-btn--clay" style={{ padding: '9px 16px', fontSize: 13.5, opacity: (busy || tags === null) ? .5 : 1 }}>{busy ? 'Saving…' : 'Save tags'}</button>
        {msg ? <div style={{ fontSize: 12.5, fontWeight: 600, color: msg[0] === '✓' ? 'var(--sage-ink)' : 'var(--clay-ink)' }}>{msg}</div> : null}
      </div>
    </Panel>
  );
}

window.DashChatTagsPanel = DashChatTagsPanel;

// Congregation features — the steward chooses which parts of the app members see. Published on the
// kind-0 profile as `features:{read,community,library}`; the member app hides the disabled tabs.
// Unset = on (so existing churches are unaffected). Today (home) + Giving are controlled separately.
function DashFeaturesPanel({ church }) {
  const f = church.features || {};
  const on = (k) => f[k] !== false;   // default enabled
  const onOpt = (k) => f[k] === true;   // opt-in extras: default OFF
  const toggle = (k) => { window.Steward.publishProfile({ features: { ...f, [k]: !on(k) } }); };          // default-on features
  const toggleOpt = (k) => { window.Steward.publishProfile({ features: { ...f, [k]: !onOpt(k) } }); };     // opt-in extras
  const ITEMS = [['read', 'Bible', 'Scripture reading, plans & devotionals'], ['community', 'Community', 'Group chat, prayer & people'], ['library', 'Library', 'Books, commentaries & study tools']];
  // opt-in extras (default OFF, switchable per church) — kids check-in
  const EXTRAS = [['checkin', 'Kids check-in', 'Check children in/out with a secure pickup code']];
  // Privacy: "Encrypt all comms" — seal every group + default new groups to encrypted.
  const allGroups = window.useStewardGroups ? window.useStewardGroups() : [];
  const allMembers = window.useStewardMembers ? window.useStewardMembers() : [];
  const encOn = f.encryptComms === true;
  const [confirmEnc, setConfirmEnc] = React.useState(false);
  const encRecips = (g) => g.visibility === 'invite' ? (g.members || []) : allMembers.map(m => m.pubkey);
  const doEncryptAll = () => {
    setConfirmEnc(false);
    for (const g of allGroups) { if (g.kind !== 'team' && !g.encrypted) { window.Steward.publishGroup({ ...g, encrypted: true }); if (window.Steward.publishGroupKey) window.Steward.publishGroupKey(g.id, encRecips(g)); } }
    window.Steward.publishProfile({ features: { ...f, encryptComms: true } });
  };
  const toggleEncryptAll = () => { if (encOn) window.Steward.publishProfile({ features: { ...f, encryptComms: false } }); else setConfirmEnc(true); };
  // member photos — ON by default; a church opts out via memberPhotos:false. Children are excluded unless
  // the church also turns on childPhotos (off by default — safeguarding). Minors enforced member-side too.
  const photosOn = f.memberPhotos !== false;
  const togglePhotos = () => window.Steward.publishProfile({ features: { ...f, memberPhotos: !photosOn } });
  const kidPhotosOn = f.childPhotos === true;
  const toggleKidPhotos = () => window.Steward.publishProfile({ features: { ...f, childPhotos: !kidPhotosOn } });
  const approval = window.useStewardJoinPolicy ? window.useStewardJoinPolicy() : false;
  const rules = church.rules || {};
  const fullName = !!rules.fullName;
  const fMembers = window.useStewardMembers ? window.useStewardMembers() : [];
  const fAdmitted = window.useStewardAdmitted ? window.useStewardAdmitted() : [];
  const toggleApproval = () => {
    // turning ON: grandfather everyone already here so only NEW joiners wait for approval
    if (!approval) window.Steward.setAdmitted([...new Set([...fAdmitted, ...fMembers.map(m => m.pubkey)])]);
    window.Steward.setJoinPolicy(!approval);
  };
  return (
    <React.Fragment>
    <Panel title="Congregation features">
      <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 12 }}>Choose which parts of the app your members see — turn off what your church doesn’t use.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ITEMS.map(([k, label, sub]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 11, border: '1px solid var(--line)', background: on(k) ? 'color-mix(in oklab, var(--sage) 10%, var(--surface))' : 'var(--surface-2)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{label}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1 }}>{on(k) ? 'On' : 'Off'} — {sub}</div>
            </div>
            <button onClick={() => toggle(k)} aria-label={'Toggle ' + label} role="switch" aria-checked={on(k)} title={(on(k) ? 'Turn off ' : 'Turn on ') + label + ' for your members'} style={{ width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, background: on(k) ? 'var(--sage)' : 'var(--line)', position: 'relative', transition: 'background .2s' }}>
              <span style={{ position: 'absolute', top: 3, left: on(k) ? 23 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 10, lineHeight: 1.45 }}>Today (home) and Giving are controlled separately. Members see changes on their next sync.</div>

      <div style={{ height: 1, background: 'var(--line)', margin: '14px 0 11px' }} />
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 6 }}>Extras</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {EXTRAS.map(([k, label, sub]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 11, border: '1px solid var(--line)', background: onOpt(k) ? 'color-mix(in oklab, var(--sage) 10%, var(--surface))' : 'var(--surface-2)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{label}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1 }}>{onOpt(k) ? 'On' : 'Off'} — {sub}</div>
            </div>
            <button onClick={() => toggleOpt(k)} aria-label={'Toggle ' + label} role="switch" aria-checked={onOpt(k)} title={(onOpt(k) ? 'Turn off ' : 'Turn on ') + label + ' for your members'} style={{ width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, background: onOpt(k) ? 'var(--sage)' : 'var(--line)', position: 'relative', transition: 'background .2s' }}>
              <span style={{ position: 'absolute', top: 3, left: onOpt(k) ? 23 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
            </button>
          </div>
        ))}
      </div>
    </Panel>

    <Panel title="Rules & privacy">
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 6 }}>Privacy</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 11, border: '1px solid var(--line)', background: encOn ? 'color-mix(in oklab, var(--clay) 9%, var(--surface))' : 'var(--surface-2)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>Encrypt all group chat</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1, lineHeight: 1.45 }}>{encOn ? 'On — every group sealed end-to-end; the relay can’t read them.' : 'Off — chat is readable on the relay. (You can seal groups individually.)'}</div>
        </div>
        <button onClick={toggleEncryptAll} aria-label="Toggle encrypt all group chat" role="switch" aria-checked={encOn} title="Seal every group’s messages end-to-end so not even the relay can read them" style={{ width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, background: encOn ? 'var(--clay)' : 'var(--line)', position: 'relative', transition: 'background .2s' }}>
          <span style={{ position: 'absolute', top: 3, left: encOn ? 23 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
        </button>
      </div>
      {confirmEnc ? <SkConfirm icon="lock" title="Encrypt all group chat?" confirmLabel="Encrypt all" body="Every group’s messages will be sealed end-to-end from now on — even the relay can’t read them. Messages already posted stay as they are, and new groups will be sealed by default too." onConfirm={doEncryptAll} onCancel={() => setConfirmEnc(false)} /> : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 11, border: '1px solid var(--line)', background: photosOn ? 'color-mix(in oklab, var(--clay) 9%, var(--surface))' : 'var(--surface-2)', marginTop: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>Allow member photos</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1, lineHeight: 1.45 }}>{photosOn ? 'On — adults may set a real photo. Children only if allowed below.' : 'Off — colour, initial or symbol only (recommended for privacy).'}</div>
        </div>
        <button onClick={togglePhotos} aria-label="Toggle member photos" role="switch" aria-checked={photosOn} title="Let adult members use a real photo as their picture (children never can)" style={{ width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, background: photosOn ? 'var(--clay)' : 'var(--line)', position: 'relative', transition: 'background .2s' }}>
          <span style={{ position: 'absolute', top: 3, left: photosOn ? 23 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
        </button>
      </div>
      {photosOn ? (
        <React.Fragment>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 11, border: '1px solid var(--line)', background: kidPhotosOn ? 'color-mix(in oklab, var(--clay) 9%, var(--surface))' : 'var(--surface-2)', marginTop: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>Allow children’s photos</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1, lineHeight: 1.45 }}>{kidPhotosOn ? 'On — members marked as a child may also set a photo. Use with care.' : 'Off — children use a colour, initial or symbol. Recommended for safeguarding.'}</div>
            </div>
            <button onClick={toggleKidPhotos} aria-label="Toggle children’s photos" role="switch" aria-checked={kidPhotosOn} title="Let members marked as a child set a real photo (off is recommended)" style={{ width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, background: kidPhotosOn ? 'var(--clay)' : 'var(--line)', position: 'relative', transition: 'background .2s' }}>
              <span style={{ position: 'absolute', top: 3, left: kidPhotosOn ? 23 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 9, padding: '11px 12px', borderRadius: 11, background: 'color-mix(in oklab, var(--gold) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 24%, transparent)', marginTop: 10 }}><Icon name="shield" size={15} color="#8a6717" style={{ flexShrink: 0, marginTop: 1 }} /><div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}>Photos are visible to your whole church. {kidPhotosOn ? 'Children’s photos are ON — only keep this on where it’s safe.' : 'Children can’t add one unless you turn on children’s photos above.'} You can switch these off again any time.</div></div>
        </React.Fragment>
      ) : null}

      <div style={{ height: 1, background: 'var(--line)', margin: '14px 0 11px' }} />
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 6 }}>Joining</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 11, border: '1px solid var(--line)', background: approval ? 'color-mix(in oklab, var(--clay) 9%, var(--surface))' : 'var(--surface-2)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>Require approval to join</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1, lineHeight: 1.45 }}>{approval ? 'On — new joiners wait in “Requests to join” (Members) until you approve.' : 'Off — anyone with your code or QR joins straight away.'}</div>
        </div>
        <button onClick={toggleApproval} aria-label="Toggle approval to join" role="switch" aria-checked={approval} title="Make new people wait for your approval before they can join" style={{ width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, background: approval ? 'var(--clay)' : 'var(--line)', position: 'relative', transition: 'background .2s' }}>
          <span style={{ position: 'absolute', top: 3, left: approval ? 23 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
        </button>
      </div>

      <div style={{ height: 1, background: 'var(--line)', margin: '14px 0 11px' }} />
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 6 }}>Member names</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 11, border: '1px solid var(--line)', background: fullName ? 'color-mix(in oklab, var(--sage) 10%, var(--surface))' : 'var(--surface-2)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>Require a real first &amp; last name</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1, lineHeight: 1.45 }}>{fullName ? 'On — members are asked to set a full name (e.g. “Jane Smith”); those without one are nudged to add a surname.' : 'Off — members may use a single name or stay anonymous.'}</div>
        </div>
        <button onClick={() => window.Steward.publishProfile({ rules: { ...rules, fullName: !fullName } })} aria-label="Toggle require full name" role="switch" aria-checked={fullName} title="Ask members to set a full first and last name instead of staying anonymous" style={{ width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, background: fullName ? 'var(--sage)' : 'var(--line)', position: 'relative', transition: 'background .2s' }}>
          <span style={{ position: 'absolute', top: 3, left: fullName ? 23 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
        </button>
      </div>
    </Panel>
    </React.Fragment>
  );
}

// church giving — the Lightning address gifts pay to (published as kind-0 lud16, NIP-57).
// Self-custody: this is the church's OWN wallet; the app never holds funds.
function DashGivingPanel({ church }) {
  const [draft, setDraft] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const [check, setCheck] = React.useState(null); // null | 'checking' | 'ok' | 'bad'
  const [expanded, setExpanded] = React.useState(false);   // when giving is OFF, the setup is collapsed
  React.useEffect(() => { setDraft(church.lud16 || church.lnaddr || ''); setCheck(null); }, [church.lud16, church.lnaddr]);
  const showConfig = church.giving || expanded;            // on = always show; off = collapsed until "set up"
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.trim());

  // verify it's a real LNURL-pay address before saving
  const verify = async () => {
    const addr = draft.trim(); if (!valid) { setCheck('bad'); return; }
    setCheck('checking');
    try {
      const [n, d] = addr.split('@');
      const r = await fetch(`https://${d}/.well-known/lnurlp/${encodeURIComponent(n)}`, { headers: { Accept: 'application/json' } });
      const p = await r.json();
      setCheck(p && p.tag === 'payRequest' ? 'ok' : 'bad');
    } catch { setCheck('bad'); }
  };
  const save = () => { window.Steward.publishProfile({ lud16: draft.trim() }); setSaved(true); setTimeout(() => setSaved(false), 1700); };

  const toggleGiving = () => window.Steward.publishProfile({ giving: !church.giving });

  return (
    <Panel title="Giving">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, transparent)', marginBottom: 14 }}>
        <Icon name="lock" size={16} color="var(--clay-ink)" style={{ flexShrink: 0 }} />
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45 }}><b>Locked during the pilot.</b> This opens up once testing is finished.</div>
      </div>
      {/* steward owns the switch: giving only appears for members when this church turns it on */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 11, border: '1px solid var(--line)',
        background: church.giving ? 'color-mix(in oklab, var(--sage) 10%, var(--surface))' : 'var(--surface-2)', marginBottom: showConfig ? 16 : 0 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>Show the Giving tab to members</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1 }}>{church.giving ? 'On — members can give to this church.' : 'Off — members won’t see giving.'}</div>
        </div>
        <button onClick={toggleGiving} disabled aria-label="Toggle giving" title="Giving is locked during the pilot" style={{ width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'not-allowed', opacity: .4, flexShrink: 0,
          background: church.giving ? 'var(--sage)' : 'var(--line)', position: 'relative', transition: 'background .2s' }}>
          <span style={{ position: 'absolute', top: 3, left: church.giving ? 23 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
        </button>
      </div>
      {/* when giving is OFF the setup collapses to a single link, so the panel doesn't sit there full of dead fields */}
      {!showConfig ? (
        <button onClick={() => setExpanded(true)} style={{ border: 'none', background: 'none', padding: '10px 0 0', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Icon name="pen" size={13} color="currentColor" /> {(church.lud16 || church.lnaddr) ? 'Edit the Lightning address' : 'Set up the Lightning address'}
        </button>
      ) : (
        <React.Fragment>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>Where gifts land. Paste your church’s <b>Lightning address</b> (looks like an email: <span style={{ fontFamily: 'var(--mono)' }}>giving@yourchurch.org</span>). It’s the church’s <b>own wallet</b> — Strike, Phoenix, Alby, Coinos, a node, anywhere that gives a Lightning address. Members give straight to it; <b>the app never holds your money</b>.</div>
          <div style={{ display: 'flex', gap: 9 }}>
            <input value={draft} onChange={e => { setDraft(e.target.value); setCheck(null); }} onKeyDown={e => { if (e.key === 'Enter') save(); }} spellCheck={false} autoCapitalize="none" inputMode="email"
              placeholder="giving@yourchurch.org"
              style={{ flex: 1, height: 44, padding: '0 13px', borderRadius: 12, border: `1px solid ${check === 'bad' ? 'var(--clay)' : 'var(--line)'}`, background: 'var(--surface-2)', fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--ink)', outline: 'none' }} />
            <button onClick={verify} disabled={!valid || check === 'checking'} title="Check this Lightning address really works before saving" className="sk-btn sk-btn--ghost" style={{ padding: '0 14px', fontSize: 13 }}>{check === 'checking' ? '…' : 'Check'}</button>
            <button onClick={save} disabled={!valid} className="sk-btn sk-btn--clay" style={{ padding: '0 16px', fontSize: 13 }}><Icon name={saved ? 'check' : 'send'} size={15} color="var(--on-clay)" /> {saved ? 'Saved' : 'Save'}</button>
          </div>
          {check === 'ok' ? <div style={{ fontSize: 12, color: 'var(--sage)', fontWeight: 700, marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="check" size={13} stroke={3} color="var(--sage)" /> Valid Lightning address — ready to receive.</div> : null}
          {check === 'bad' ? <div style={{ fontSize: 12, color: 'var(--clay)', fontWeight: 700, marginTop: 8 }}>That doesn’t resolve to a Lightning pay address — double-check it.</div> : null}
          {(church.lud16 || church.lnaddr) ? <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>Current: <span style={{ fontFamily: 'var(--mono)' }}>{church.lud16 || church.lnaddr}</span></div> : null}
        </React.Fragment>
      )}
    </Panel>
  );
}

// a real dialog for renaming the church (or a network) — replaces window.prompt
function NameEditModal({ current, isNetwork, onSave, onClose }) {
  const [name, setName] = React.useState(current || '');
  const [busy, setBusy] = React.useState(false);
  const label = isNetwork ? 'network' : 'church';
  const save = async () => { if (!name.trim()) return; setBusy(true); await onSave(name.trim()); onClose(); };
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 96, background: 'rgba(40,32,24,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={current ? ('Rename ' + label) : ('Name your ' + label)} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: '94%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26, animation: 'lumenScale .2s ease both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={isNetwork ? 'globe' : 'bank'} size={21} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>{current ? `Rename ${label}` : `Name your ${label}`}</div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 16px' }}>This is the name your {isNetwork ? 'churches' : 'members'} see in the app. You can change it anytime.</p>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>{label} name</div>
        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} autoFocus placeholder={isNetwork ? 'e.g. Regions Beyond' : 'e.g. Grace Community Church'} style={{ width: '100%', boxSizing: 'border-box', height: 46, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 18 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 13, fontSize: 14 }}>Cancel</button>
          <button onClick={save} disabled={busy || !name.trim()} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 13, fontSize: 14, opacity: (busy || !name.trim()) ? 0.55 : 1 }}><Icon name="check" size={15} color="var(--on-clay)" /> {busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// styled dialog for naming / renaming a devotional series (replaces window.prompt)
function SeriesNameModal({ current, count, onSave, onClose }) {
  const [name, setName] = React.useState(current || '');
  const [busy, setBusy] = React.useState(false);
  const save = async () => { if (!name.trim()) return; setBusy(true); await Promise.resolve(onSave(name.trim())); setBusy(false); onClose(); };
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 96, background: 'rgba(40,32,24,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={current ? 'Rename series' : 'Name this series'} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: '94%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26, animation: 'lumenScale .2s ease both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="read" size={21} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>{current ? 'Rename series' : 'Name this series'}</div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 16px' }}>Groups these {count} devotionals under one heading in your members’ apps. You can change it anytime.</p>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>Series name</div>
        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} autoFocus placeholder="e.g. The Weekly Word" style={{ width: '100%', boxSizing: 'border-box', height: 46, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 18 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 13, fontSize: 14 }}>Cancel</button>
          <button onClick={save} disabled={busy || !name.trim()} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 13, fontSize: 14, opacity: (busy || !name.trim()) ? 0.55 : 1 }}><Icon name="check" size={15} color="var(--on-clay)" /> {busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// drip-release a whole series on a cadence: pick a start + interval, and each item's release is staggered
// in order (one a day / week / fortnight / month). Members see each only when its turn comes.
function SeriesScheduleModal({ label, count, onApply, onClear, onClose }) {
  const CADENCES = [['1d', 'Every day', 86400], ['1w', 'Weekly', 7 * 86400], ['2w', 'Fortnightly', 14 * 86400], ['1m', 'Monthly', 30 * 86400]];
  const nextSunday9 = () => { const d = new Date(); d.setHours(9, 0, 0, 0); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); return Math.floor(d.getTime() / 1000); };
  const [startSec, setStartSec] = React.useState(nextSunday9);
  const [cad, setCad] = React.useState('1w');
  const [busy, setBusy] = React.useState(false);
  const interval = (CADENCES.find(c => c[0] === cad) || CADENCES[1])[2];
  const toLocalInput = (sec) => { const d = new Date(sec * 1000); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const fromLocalInput = (s) => { const t = new Date(s).getTime(); return Number.isFinite(t) ? Math.floor(t / 1000) : startSec; };
  const lastSec = startSec + (count - 1) * interval;
  const fmt = (sec) => new Date(sec * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const apply = async () => { setBusy(true); await Promise.resolve(onApply(startSec, interval)); setBusy(false); onClose(); };
  const clear = async () => { setBusy(true); await Promise.resolve(onClear()); setBusy(false); onClose(); };
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 96, background: 'rgba(40,32,24,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Schedule release" tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: '94%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26, animation: 'lumenScale .2s ease both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="clock" size={21} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>Schedule release</div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 16px' }}>Drip <b>{label}</b> out to your members — its {count} devotionals release one at a time, in their current order.</p>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>First one releases</div>
        <input type="datetime-local" value={toLocalInput(startSec)} onChange={e => setStartSec(fromLocalInput(e.target.value))} style={{ width: '100%', boxSizing: 'border-box', height: 46, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }} />
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>Then one</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {CADENCES.map(([id, lbl]) => (
            <button key={id} onClick={() => setCad(id)} style={{ flex: '1 1 0', minWidth: 92, padding: '9px 10px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, background: cad === id ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface-2)', border: '1.5px solid ' + (cad === id ? 'var(--clay)' : 'var(--line)'), color: cad === id ? 'var(--clay-ink)' : 'var(--ink-2)' }}>{lbl}</button>
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 11, padding: '10px 13px', lineHeight: 1.5, marginBottom: 18 }}>
          First on <b>{fmt(startSec)}</b>, last on <b>{fmt(lastSec)}</b>{startSec * 1000 <= Date.now() ? ' · the first one publishes straight away' : ''}.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={clear} disabled={busy} className="sk-btn sk-btn--ghost" style={{ padding: 13, fontSize: 13.5 }} title="Clear schedules — publish all now">Publish all now</button>
          <button onClick={apply} disabled={busy} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 13, fontSize: 14, opacity: busy ? 0.55 : 1 }}><Icon name="clock" size={15} color="var(--on-clay)" /> {busy ? 'Scheduling…' : 'Schedule'}</button>
        </div>
      </div>
    </div>
  );
}

// edit the church's web address / NIP-05 domain. The engine cleans whatever's typed (strips http/www);
// blank reverts to the relay-served default handle. Members join with the @handle either way.
function WebAddressModal({ church, onClose }) {
  const cur = String(church.nip05 || '');
  const dom = cur.includes('@') ? cur.split('@')[1] : cur.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  // the auto-claimed handle lives on the RELAY's own host (tailscale .ts.net / tunnel) — that's the default,
  // not a domain the church owns. Don't pre-fill it: the field would expose the relay's internal address as
  // if it were the church's website. Only show a genuinely custom domain the steward set themselves.
  const isRelayHost = /(\.ts\.net|\.trycloudflare\.com)$/i.test(dom || '');
  const [val, setVal] = React.useState(isRelayHost ? '' : (dom || ''));
  const [busy, setBusy] = React.useState(false);
  const save = async (v) => { setBusy(true); await Promise.resolve(window.Steward.publishProfile({ name: church.name, nip05: v })); setBusy(false); onClose(); };
  const custom = cur.includes('@') && !isRelayHost;
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 96, background: 'rgba(40,32,24,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Church web address" tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: '94%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26, animation: 'lumenScale .2s ease both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="globe" size={21} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>Church web address</div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 10px' }}>Your church’s own domain (optional). Just the domain — no <span style={{ fontFamily: 'var(--mono)' }}>https://</span>. Members always join with your <b>{churchHandle(church) || '@handle'}</b>; leave this blank to use the default.</p>
        <a href="https://github.com/TrinityOneAdmin/TrinityOne/blob/main/docs/guides/STEWARD-GUIDE.md#your-churchs-own-web-address-custom-domain" target="_blank" rel="noopener" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: 'var(--clay)', textDecoration: 'none', marginBottom: 16 }}><Icon name="book" size={14} color="currentColor" /> How to connect your own domain →</a>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>Web address</div>
        <input value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(val); }} autoFocus placeholder="yourchurch.org" style={{ width: '100%', boxSizing: 'border-box', height: 46, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', marginBottom: 18 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 13, fontSize: 14 }}>Cancel</button>
          {custom ? <button onClick={() => save('')} disabled={busy} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 13, fontSize: 14 }}>Use default</button> : null}
          <button onClick={() => save(val)} disabled={busy} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 13, fontSize: 14, opacity: busy ? 0.55 : 1 }}><Icon name="check" size={15} color="var(--on-clay)" /> {busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}


// Crop + placement for an uploaded image: drag to reposition, slider to zoom — saved at the target
// size (banner 3:1, picture square). Replaces the silent centre-crop, so a steward controls the framing.
function ImageCropModal({ file, outW, outH, round, radiusPct, title, onSave, onClose }) {
  const ref = React.useRef(null);
  const [img, setImg] = React.useState(null);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0.5, y: 0.5 });
  const [busy, setBusy] = React.useState(false);
  const drag = React.useRef(null);
  const DW = 360, DH = Math.round(DW * outH / outW);
  React.useEffect(() => {
    const im = new Image();
    im.onload = () => setImg(im);
    const r = new FileReader(); r.onload = () => { im.src = r.result; }; r.readAsDataURL(file);
  }, [file]);
  const paint = (canvas, cw, ch) => {
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, cw, ch);
    if (!img) return;
    const cover = Math.max(cw / img.width, ch / img.height), s = cover * zoom;
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, -(dw - cw) * pan.x, -(dh - ch) * pan.y, dw, dh);
  };
  React.useEffect(() => { if (ref.current) paint(ref.current, DW, DH); }, [img, zoom, pan]);   // eslint-disable-line
  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {} };
  const onMove = (e) => {
    if (!drag.current || !img) return;
    const cover = Math.max(DW / img.width, DH / img.height), s = cover * zoom;
    const ovX = img.width * s - DW, ovY = img.height * s - DH;
    const nx = drag.current.px - (e.clientX - drag.current.x) / (ovX || 1);
    const ny = drag.current.py - (e.clientY - drag.current.y) / (ovY || 1);
    setPan({ x: Math.min(1, Math.max(0, nx)), y: Math.min(1, Math.max(0, ny)) });
  };
  const onUp = () => { drag.current = null; };
  const save = () => {
    if (!img) return; setBusy(true);
    const c = document.createElement('canvas'); c.width = outW; c.height = outH; paint(c, outW, outH);
    let uri = ''; try { uri = c.toDataURL('image/webp', 0.85); } catch (e) {}
    if (!uri || uri.length < 30) uri = c.toDataURL('image/jpeg', 0.85);
    onSave(uri);
  };
  return (
    <CkModal title={title || 'Position image'} onClose={onClose}>
      <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 12 }}>Drag to reposition, slide to zoom. What’s inside the frame is exactly what members will see.</div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <canvas ref={ref} width={DW} height={DH} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
          style={{ width: DW, height: DH, maxWidth: '100%', borderRadius: round ? '50%' : (radiusPct != null ? Math.round(Math.min(DW, DH) * radiusPct) : 14), border: '1px solid var(--line)', cursor: 'grab', touchAction: 'none', background: 'var(--surface-2)' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, margin: '15px 2px 4px' }}>
        <Icon name="search" size={15} color="var(--ink-3)" />
        <input type="range" min="1" max="4" step="0.01" value={zoom} onChange={e => setZoom(parseFloat(e.target.value))} style={{ flex: 1 }} />
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 11 }}>Cancel</button>
        <button onClick={save} disabled={!img || busy} className="sk-btn sk-btn--clay" style={{ flex: 2, padding: 11, opacity: (!img || busy) ? .6 : 1 }}><Icon name="check" size={15} color="var(--on-clay)" /> {busy ? 'Saving…' : 'Save'}</button>
      </div>
    </CkModal>
  );
}
window.ImageCropModal = ImageCropModal;

// Church branding — a wide banner + a brand accent colour, published on the kind-0 profile
// (banner ~768×256, accent as a hex). The logo lives on the identity card above. Members' app
// shows the banner on the church header and tints its clay accents to the church's colour.
function DashBrandingPanel({ church }) {
  const [busy, setBusy] = React.useState(false);
  const [accent, setAccentState] = React.useState(church.accent || '');
  const saveTimer = React.useRef(null);
  // PERF/BUGFIX 2026-07-07: useStewardChurch resets the profile to {} on mount and re-fetches over the ~0.5s
  // Cloudflare tunnel, so church.accent/bannerFade go transiently undefined. Only sync the control from a
  // DEFINED value — never snap back to the default on that transient — otherwise a saved fade (persisted fine on
  // the relay) visibly reverts to 16 after you set it. Clearing (accent → '') is a defined value, so it still syncs.
  React.useEffect(() => { if (church.accent !== undefined) setAccentState(church.accent || ''); }, [church.accent]);
  const [cropFile, setCropFile] = React.useState(null);
  const [fade, setFadeState] = React.useState(typeof church.bannerFade === 'number' ? church.bannerFade : 16);
  const fadeTimer = React.useRef(null);
  React.useEffect(() => { if (typeof church.bannerFade === 'number') setFadeState(church.bannerFade); }, [church.bannerFade]);
  const onFade = (v) => { setFadeState(v); if (fadeTimer.current) clearTimeout(fadeTimer.current); fadeTimer.current = setTimeout(() => window.Steward.publishProfile({ bannerFade: v }), 400); };
  const onPickBanner = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) setCropFile(f); };
  const saveBanner = async (uri) => { setCropFile(null); setBusy(true); try { await Promise.resolve(window.Steward.publishProfile({ banner: uri })); } catch (e) {} setBusy(false); };
  const removeBanner = () => Promise.resolve(window.Steward.publishProfile({ banner: '' }));
  const onAccent = (v) => {
    setAccentState(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => window.Steward.publishProfile({ accent: v }), 400);
  };
  const resetAccent = () => { if (saveTimer.current) clearTimeout(saveTimer.current); setAccentState(''); setHexDraft(''); window.Steward.publishProfile({ accent: '' }); };
  // typed hex code — free text while typing, publishes only once it's a valid #RGB / #RRGGBB
  const [hexDraft, setHexDraft] = React.useState((church.accent || '').toUpperCase());
  React.useEffect(() => { setHexDraft(accent ? accent.toUpperCase() : ''); }, [accent]);
  const onHex = (v) => {
    let s = v.trim(); if (s && s[0] !== '#') s = '#' + s;
    setHexDraft(s.toUpperCase());
    if (/^#[0-9a-fA-F]{3}$/.test(s)) onAccent('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]);
    else if (/^#[0-9a-fA-F]{6}$/.test(s)) onAccent(s);
  };
  const acc = accent || '#C25A38';
  const swatches = ['#C25A38', '#3B6FB0', '#5E8C6A', '#7A4FA3', '#B0853B', '#1F2A37'];
  const lbl = { fontSize: 11.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 6px' };
  const initials = (church.name ? church.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'TO').toUpperCase();
  return (
    <Panel title="Church branding">
      {cropFile ? <ImageCropModal file={cropFile} outW={768} outH={256} title="Position your banner" onSave={saveBanner} onClose={() => setCropFile(null)} /> : null}
      <div style={lbl}>Banner</div>
      <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 10 }}>A wide image at the top of your church in members’ apps. Landscape works best (about 3:1) — it’s centre-cropped to fit.</div>
      {/* live preview — banner + logo + name, the way members see the header */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '3 / 1', borderRadius: 14, overflow: 'hidden', background: church.banner ? `center/cover no-repeat url(${church.banner})` : `linear-gradient(135deg, ${acc}, color-mix(in oklab, ${acc} 60%, #000))`, WebkitMaskImage: (church.banner && fade > 0) ? `linear-gradient(to bottom, #000 ${100 - fade}%, transparent)` : 'none', maskImage: (church.banner && fade > 0) ? `linear-gradient(to bottom, #000 ${100 - fade}%, transparent)` : 'none' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,.55), rgba(0,0,0,0) 60%)' }} />
        <div style={{ position: 'absolute', left: 12, bottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <SkBadge initials={initials} picture={church.picture} accent={acc} size={36} radius={999} style={{ boxShadow: '0 2px 8px rgba(0,0,0,.35)' }} />
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,.6)' }}>{church.name || 'Your church'}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 9, marginTop: 10 }}>
        <label className="sk-btn sk-btn--clay" style={{ padding: '9px 14px', fontSize: 13, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1 }}>
          <Icon name={busy ? 'refresh' : (church.banner ? 'pen' : 'plus')} size={15} color="#fff" /> {busy ? 'Uploading…' : (church.banner ? 'Replace banner' : 'Upload banner')}
          <input type="file" accept="image/*" disabled={busy} onChange={onPickBanner} style={{ display: 'none' }} />
        </label>
        {church.banner ? <button onClick={removeBanner} className="sk-btn sk-btn--ghost" style={{ padding: '9px 14px', fontSize: 13 }}>Remove</button> : null}
      </div>

      {church.banner ? (
        <div style={{ marginTop: 14 }}>
          <div style={lbl}>Banner fade</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 8 }}>How softly the bottom of the banner blends into the page.</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input type="range" min="0" max="80" step="2" value={fade} onChange={e => onFade(Number(e.target.value))} style={{ flex: 1, accentColor: acc }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-2)', minWidth: 52, textAlign: 'right' }}>{fade === 0 ? 'None' : fade + '%'}</span>
          </div>
        </div>
      ) : null}

      <div style={{ height: 1, background: 'var(--line)', margin: '16px 0' }} />

      <div style={lbl}>Brand colour</div>
      <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 10 }}>Tints the highlights, buttons and active states in your members’ app to match your church.</div>
      {/* big spectrum-picker tile + a prominent # hex field */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <label title="Pick any colour" style={{ position: 'relative', width: 54, height: 54, borderRadius: 14, cursor: 'pointer', flexShrink: 0, background: acc, border: '1px solid var(--line)', boxShadow: 'inset 0 0 0 3px var(--surface)' }}>
          <input type="color" value={acc} onChange={e => onAccent(e.target.value)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', padding: 0, cursor: 'pointer', opacity: 0 }} />
        </label>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', height: 46, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', padding: '0 13px', gap: 3 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700, color: 'var(--ink-3)' }}>#</span>
          <input value={hexDraft.replace(/^#/, '')} onChange={e => onHex('#' + e.target.value.replace(/[^0-9a-fA-F]/g, ''))} spellCheck={false} autoCapitalize="characters" maxLength={6} placeholder="C25A38"
            style={{ flex: 1, minWidth: 0, fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink)', background: 'transparent', border: 'none', outline: 'none', padding: 0 }} />
          {accent ? <button onClick={resetAccent} title="Reset to default" style={{ border: 'none', background: 'none', padding: '4px 6px', color: 'var(--clay-ink)', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12.5 }}>Reset</button> : <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>default</span>}
        </div>
      </div>
      {/* quick presets */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        {swatches.map(s => (
          <button key={s} onClick={() => onAccent(s)} title={s} style={{ width: 28, height: 28, borderRadius: 999, background: s, cursor: 'pointer', border: (accent.toLowerCase() === s.toLowerCase()) ? '3px solid var(--ink)' : '1px solid var(--line)', padding: 0 }} />
        ))}
      </div>
    </Panel>
  );
}

// set or change the console PIN — encrypts the church key at rest with it
function PinModal({ action, onClose }) {
  const change = action === 'change', remove = action === 'remove';
  const [pin, setPin] = React.useState('');
  const [pin2, setPin2] = React.useState('');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    if (remove) {   // removing the lock requires the CURRENT pin (so an unattended unlocked console can't be stripped)
      if (!pin) { setErr('Enter your current PIN.'); return; }
      setBusy(true);
      const ok = await window.Steward.removeLock(pin);
      setBusy(false);
      if (ok) onClose(true); else setErr('That PIN isn’t right.');
      return;
    }
    if (pin.length < 4) { setErr('Use at least 4 digits — a longer PIN or passphrase is safer.'); return; }
    if (pin !== pin2) { setErr('They don’t match.'); return; }
    setBusy(true);
    const ok = await window.Steward.setPin(pin);
    setBusy(false);
    if (ok) onClose(true); else setErr('Couldn’t set the PIN.');
  };
  const inp = { width: '100%', boxSizing: 'border-box', height: 48, padding: '0 14px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 16, color: 'var(--ink)', outline: 'none', fontFamily: 'var(--font-ui)', marginBottom: 10 };
  const dlgRef = useStewDialog(() => onClose(false));   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div onClick={() => onClose(false)} style={{ position: 'absolute', inset: 0, zIndex: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28, background: 'color-mix(in oklab, var(--ink) 32%, transparent)', backdropFilter: 'blur(3px)' }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={remove ? 'Remove console PIN' : change ? 'Change console PIN' : 'Lock with a PIN'} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 400, maxWidth: '94%', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19, marginBottom: 4 }}>{remove ? 'Remove console PIN' : change ? 'Change console PIN' : 'Lock with a PIN'}</div>
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 16 }}>{remove
          ? 'Enter your current PIN to remove the lock. The key goes back to being stored unlocked on this device.'
          : 'Encrypts the church key on this device. You’ll enter it to open the console; it auto-locks after 10 minutes idle. Don’t forget it — without it (or the 12-word phrase) this device can’t open the church.'}</div>
        <input type="password" autoFocus value={pin} onChange={e => { setPin(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter' && remove) save(); }} placeholder={remove ? 'Current PIN' : 'New PIN or passphrase'} inputMode="numeric" autoComplete="off" style={inp} />
        {!remove ? <input type="password" value={pin2} onChange={e => { setPin2(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') save(); }} placeholder="Confirm" inputMode="numeric" autoComplete="off" style={inp} /> : null}
        {err ? <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', fontWeight: 600, marginBottom: 8 }}>{err}</div> : null}
        <div style={{ display: 'flex', gap: 9, marginTop: 6 }}>
          <button onClick={() => onClose(false)} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: '11px' }}>Cancel</button>
          <button onClick={save} disabled={busy} className={remove ? 'sk-btn sk-btn--ghost' : 'sk-btn sk-btn--clay'} style={{ flex: 1, padding: '11px', opacity: busy ? .6 : 1, color: remove ? 'var(--clay)' : undefined }}><Icon name={remove ? 'x' : 'lock'} size={15} color={remove ? 'currentColor' : '#fff'} /> {busy ? (remove ? 'Removing…' : 'Saving…') : (remove ? 'Remove lock' : change ? 'Update PIN' : 'Set PIN')}</button>
        </div>
      </div>
    </div>
  );
}

// Phase 1 backup: save the church's complete corpus to a file (native share sheet / web download) + a reminder cadence.
function DashBackup() {
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);   // { ok, text }
  const [last, setLast] = React.useState(() => { try { return Number(localStorage.getItem('trinityone.lastBackupAt') || 0); } catch { return 0; } });
  const [freq, setFreq] = React.useState(() => { try { return localStorage.getItem('trinityone.backupRemind') || 'monthly'; } catch { return 'monthly'; } });
  const setFrequency = (f) => { setFreq(f); try { localStorage.setItem('trinityone.backupRemind', f); } catch {} try { window.Steward.setBackupMeta && window.Steward.setBackupMeta(last, f); } catch {} };
  // church-wide backup state: same 'last backed up' + cadence on every steward/device, not just this one
  React.useEffect(() => {
    if (!window.Steward.subscribeBackupMeta) return;
    return window.Steward.subscribeBackupMeta((m) => {
      if (!m) return;
      if (m.at) setLast((prev) => { const v = Math.max(prev || 0, m.at); try { localStorage.setItem('trinityone.lastBackupAt', String(v)); } catch {} return v; });
      if (m.remind) { setFreq(m.remind); try { localStorage.setItem('trinityone.backupRemind', m.remind); } catch {} }
    });
  }, []);
  const [encrypt, setEncrypt] = React.useState(() => { try { return localStorage.getItem('trinityone.backupEncrypt') !== '0'; } catch { return true; } });
  const setEncryptPref = (v) => { setEncrypt(v); try { localStorage.setItem('trinityone.backupEncrypt', v ? '1' : '0'); } catch {} };
  const [includeMedia, setIncludeMedia] = React.useState(() => { try { return localStorage.getItem('trinityone.backupMedia') !== '0'; } catch { return true; } });
  const setMediaPref = (v) => { setIncludeMedia(v); try { localStorage.setItem('trinityone.backupMedia', v ? '1' : '0'); } catch {} };
  const [media, setMedia] = React.useState(null);   // { count, bytes } — for the include-media toggle + size guard
  React.useEffect(() => { let ok = true; (async () => { try { const m = await window.Steward.mediaSize(); if (ok) setMedia(m); } catch {} })(); return () => { ok = false; }; }, []);
  const fmtBytes = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';
  // restore / clone
  const [restoreOpen, setRestoreOpen] = React.useState(false);
  const [restoreFile, setRestoreFile] = React.useState(null);   // { name, bytes }
  const [restoreTarget, setRestoreTarget] = React.useState('this');   // 'this' | 'other'
  const [restoreUrl, setRestoreUrl] = React.useState('');
  const [restoreBusy, setRestoreBusy] = React.useState(false);
  const [restoreProg, setRestoreProg] = React.useState(null);   // { phase, done, total }
  const [restoreMsg, setRestoreMsg] = React.useState(null);
  const onPickRestore = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return; setRestoreMsg(null); const rd = new FileReader(); rd.onload = () => setRestoreFile({ name: f.name, bytes: new Uint8Array(rd.result) }); rd.onerror = () => setRestoreMsg({ ok: false, text: 'Couldn’t read that file.' }); rd.readAsArrayBuffer(f); };
  const doRestore = async () => {
    if (!restoreFile) return;
    setRestoreBusy(true); setRestoreMsg(null); setRestoreProg(null);
    try {
      const relayUrl = restoreTarget === 'other' ? restoreUrl.trim() : '';
      if (restoreTarget === 'other' && !/^wss?:\/\/|^https?:\/\//i.test(relayUrl)) throw new Error('Enter the other relay’s web address (https://…).');
      const r = await window.Steward.restoreChurchData(restoreFile.bytes, { relayUrl: relayUrl.replace(/^ws/i, 'http'), onProgress: (phase, done, total) => setRestoreProg({ phase, done, total }) });
      setRestoreMsg({ ok: true, text: 'Restored ' + r.imported + ' records' + (r.duplicates ? ' (' + r.duplicates + ' already there)' : '') + (r.mediaTotal ? ' + ' + r.mediaRestored + '/' + r.mediaTotal + ' media' : '') + (r.registered ? ' — church set up on ' + (relayUrl ? 'that' : 'this') + ' relay.' : '.') + (r.invalid ? ' ' + r.invalid + ' entries were skipped (couldn’t verify).' : '') });
      setRestoreFile(null);
    } catch (e) { setRestoreMsg({ ok: false, text: e.message || 'Restore failed' }); }
    setRestoreBusy(false); setRestoreProg(null);
  };
  const windowDays = { weekly: 7, monthly: 30, off: Infinity };
  const overdue = freq !== 'off' && (Date.now() / 1000 - last) > windowDays[freq] * 86400;
  const doBackup = async () => {
    setBusy(true); setMsg(null);
    try {
      const { data, binary, mime, count, filename, encrypted, media: mediaCount } = await window.Steward.exportChurchData({ encrypt, includeMedia });
      const mediaBit = mediaCount ? ' + ' + mediaCount + ' media file' + (mediaCount > 1 ? 's' : '') : '';
      const P = window.Capacitor && window.Capacitor.Plugins;
      if (P && P.Filesystem && P.Share) {   // native: write to cache then hand to the OS share sheet (save/send anywhere)
        let res;
        if (binary) {   // zip bytes -> base64 for Filesystem (no encoding = base64)
          let bin = ''; const CH = 0x8000; for (let i = 0; i < data.length; i += CH) bin += String.fromCharCode.apply(null, data.subarray(i, Math.min(i + CH, data.length)));
          res = await P.Filesystem.writeFile({ path: filename, data: btoa(bin), directory: 'Cache' });
        } else {
          res = await P.Filesystem.writeFile({ path: filename, data, directory: 'Cache', encoding: 'utf8' });
        }
        await P.Share.share({ title: 'TrinityOne church backup', text: count + ' records' + mediaBit + (encrypted ? ' — encrypted; only your church key can open it.' : ' — keep this file somewhere safe.'), files: [res.uri] });
      } else {   // web: a file download (Blob accepts string or Uint8Array)
        const blob = new Blob([data], { type: mime });
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }
      const ts = Math.floor(Date.now() / 1000); setLast(ts); try { localStorage.setItem('trinityone.lastBackupAt', String(ts)); } catch {}
      try { window.Steward.setBackupMeta && window.Steward.setBackupMeta(ts, freq); } catch {}   // record church-wide so every steward's nudge resets
      setMsg({ ok: true, text: 'Saved ' + count + ' records' + mediaBit + (encrypted ? ' — encrypted to your church key.' : ' (unencrypted).') });
    } catch (e) { setMsg({ ok: false, text: e.message || 'Backup failed' }); }
    setBusy(false);
  };
  const seg = { display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' };
  return (
    <Panel title="Backup &amp; data">
      <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>Save a complete copy of your church’s data — messages, groups, plans, records — to a file you keep. It’s <b>your</b> church’s data; this is how you always hold your own copy, even if a relay is ever lost.</div>
      {overdue ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', borderRadius: 12, marginBottom: 12, background: 'color-mix(in oklab, var(--gold) 12%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 34%, var(--line))' }}>
          <Icon name="clock" size={17} color="var(--gold)" />
          <span style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 600 }}>{last ? 'It’s been a while since your last backup.' : 'You haven’t backed up yet.'} Worth saving a fresh copy.</span>
        </div>
      ) : null}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '4px 0 14px', cursor: 'pointer' }}>
        <input type="checkbox" checked={encrypt} onChange={(e) => setEncryptPref(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: 'var(--clay)', flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          <b>Encrypt with your church key</b> — the file can only be opened with your church’s recovery phrase, so your members’ names and messages stay private even if it’s lost or kept in the cloud.
          {!encrypt ? <span style={{ display: 'block', marginTop: 5, color: 'var(--gold)', fontWeight: 600 }}>⚠ Off: anyone who gets the file can read your members’ names and messages.</span> : null}
        </span>
      </label>
      {media && media.count > 0 ? (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '0 0 14px', cursor: 'pointer' }}>
          <input type="checkbox" checked={includeMedia} onChange={(e) => setMediaPref(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: 'var(--clay)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            <b>Include media</b> — your {media.count} uploaded file{media.count > 1 ? 's' : ''} ({fmtBytes(media.bytes)}) go in too, so a restore brings back everything, not just the text.
            {includeMedia && media.bytes > 250 * 1024 * 1024 ? <span style={{ display: 'block', marginTop: 5, color: 'var(--gold)', fontWeight: 600 }}>⚠ That’s large — this backup may take a while and use a lot of memory. Turn it off for a quick records-only copy.</span> : null}
          </span>
        </label>
      ) : null}
      <button onClick={doBackup} disabled={busy} className="sk-btn sk-btn--clay" style={{ padding: '11px 16px', fontSize: 14 }}><Icon name="share" size={16} color="var(--on-clay)" /> {busy ? 'Backing up…' : 'Back up church data'}</button>
      {msg ? <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: msg.ok ? 'var(--sage)' : 'var(--clay)' }}>{msg.ok ? '✓ ' : '✗ '}{msg.text}</div> : null}
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 10 }}>Last backup: {last ? new Date(last * 1000).toLocaleDateString() : 'never'}</div>
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Remind me to back up</div>
        <div style={seg}>
          {[['off', 'Off'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([k, label]) => (
            <button key={k} onClick={() => setFrequency(k)} style={{ padding: '8px 15px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, background: freq === k ? 'var(--clay)' : 'transparent', color: freq === k ? '#fff' : 'var(--ink-2)' }}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        <div onClick={() => setRestoreOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Restore or clone from a backup</div>
          <span style={{ color: 'var(--ink-3)', fontSize: 12, fontWeight: 600 }}>{restoreOpen ? 'Hide' : 'Open'}</span>
        </div>
        {restoreOpen ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 12 }}>Load a backup file to rebuild this church’s data — into <b>this</b> relay (recover after a loss) or <b>another</b> relay (set up a spare, or move). Encrypted backups open with your church key automatically.</div>
            <input id="restoreFileInput" type="file" accept=".json,.jsonl,.zip,.tone-backup,application/json,application/zip" onChange={onPickRestore} style={{ display: 'none' }} />
            <button onClick={() => document.getElementById('restoreFileInput').click()} className="sk-btn" style={{ padding: '9px 14px', fontSize: 13 }}>{restoreFile ? '✓ ' + restoreFile.name : 'Choose backup file…'}</button>
            {restoreFile ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ ...seg, marginBottom: 10 }}>
                  {[['this', 'This relay'], ['other', 'Another relay']].map(([k, label]) => (
                    <button key={k} onClick={() => setRestoreTarget(k)} style={{ padding: '7px 13px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, background: restoreTarget === k ? 'var(--clay)' : 'transparent', color: restoreTarget === k ? '#fff' : 'var(--ink-2)' }}>{label}</button>
                  ))}
                </div>
                {restoreTarget === 'other' ? <input value={restoreUrl} onChange={(e) => setRestoreUrl(e.target.value)} placeholder="https://other-relay.example" spellCheck={false} autoCapitalize="none" style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 13, marginBottom: 10 }} /> : null}
                <button onClick={doRestore} disabled={restoreBusy} className="sk-btn sk-btn--clay" style={{ padding: '10px 16px', fontSize: 13.5 }}>{restoreBusy ? (restoreProg && restoreProg.phase === 'media' ? 'Restoring media ' + restoreProg.done + '/' + restoreProg.total + '…' : 'Importing records…') : 'Restore this backup'}</button>
              </div>
            ) : null}
            {restoreMsg ? <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: restoreMsg.ok ? 'var(--sage)' : 'var(--clay)' }}>{restoreMsg.ok ? '✓ ' : '✗ '}{restoreMsg.text}</div> : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function DashSettings({ onTab, initialSection, initialIntent, onSectionConsumed }) {
  const idv = window.useStewardIdv ? window.useStewardIdv() : 0;   // re-render when the active identity changes
  const delegated = !!(window.Steward.isDelegated && window.Steward.isDelegated());   // acting as a steward of a church we don't own
  const church = window.useStewardChurch();   // real church name + npub
  const [revealed, setRevealed] = React.useState(false);
  const [phrase, setPhrase] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [editingName, setEditingName] = React.useState(false);
  const [editingWeb, setEditingWeb] = React.useState(false);
  const [hasPin, setHasPin] = React.useState(() => !!(window.Steward.hasPinLock && window.Steward.hasPinLock()));
  const [pinAction, setPinAction] = React.useState(null);   // null | 'set' | 'change' | 'remove'
  // settings are grouped into sub-tabs; a deep-link (e.g. the Overview relay card) can open one directly
  // 'relays' was its own tab until it merged into 'network'; anything still deep-linking to it (a saved
  // link, an older screen's onTab call) must land on the page that now holds it, not on a blank panel.
  const [section, setSection] = React.useState(initialSection === 'relays' ? 'network' : (initialSection || 'church'));
  React.useEffect(() => { if (initialIntent === 'pin' && !hasPin) setPinAction('set'); if (initialSection && onSectionConsumed) onSectionConsumed(); }, []);   // clear the one-shot intent + run a one-shot action (e.g. open Set-PIN)
  const [picBusy, setPicBusy] = React.useState(false);
  const [picFile, setPicFile] = React.useState(null);
  const onPickPicture = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) setPicFile(f); };
  const savePicture = async (uri) => { setPicFile(null); setPicBusy(true); try { await Promise.resolve(window.Steward.publishProfile({ picture: uri })); } catch (e) {} setPicBusy(false); };
  const removePicture = () => Promise.resolve(window.Steward.publishProfile({ picture: '' }));
  const saveName = (n) => Promise.resolve(window.Steward.publishProfile({ name: n, nip05: church.nip05 }));
  const reveal = () => { try { setPhrase(window.Steward.exportMnemonic() || ''); } catch {} setRevealed(true); };
  const [restoreOpen, setRestoreOpen] = React.useState(false);
  const [backupOpen, setBackupOpen] = React.useState(false);
  const [restorePhrase, setRestorePhrase] = React.useState('');
  const [restoreErr, setRestoreErr] = React.useState('');
  const [confirmRemove, setConfirmRemove] = React.useState(false);   // "remove church from this device" guard
  const [showQR, setShowQR] = React.useState(false);                 // handoff QR (new steward scans it)
  const [scanning, setScanning] = React.useState(false);             // camera open to scan ANOTHER device's handoff QR
  const handoffSvg = showQR ? (window.Steward.qrSVG ? window.Steward.qrSVG(window.Steward.handoffPayload()) : '') : '';
  // scan another steward's handoff QR to bring their church onto THIS device (replaces the key held here)
  const adoptScanned = (payload) => {
    setScanning(false);
    if (!payload) return;
    if (!window.confirm('Restore this church onto this device?\n\nThis replaces the church key currently held here — make sure it’s backed up. The console will reload.')) return;
    try { window.Steward.adoptChurch(payload); window.location.reload(); }
    catch (e) { window.alert('That QR isn’t a valid church handoff.'); }
  };
  const doRestore = () => {
    setRestoreErr('');
    // confirm BEFORE we replace anything — restoreKey overwrites + persists the church key on this device
    if (window.Steward.hasKey && !window.confirm('This replaces the church currently on this device — make sure its recovery phrase is backed up first.\n\nContinue and reload?')) return;
    try {
      window.Steward.restoreKey(restorePhrase);
      window.location.reload();
    } catch (e) { setRestoreErr(e.message || 'That phrase isn’t valid.'); }
  };
  const restoreFromFile = (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const p = window.prompt('Enter the passphrase for this backup file:'); if (p == null) return;
    window.TrinityBackup.readFile(f).then(t => window.TrinityBackup.decryptStr(t, p)).then(obj => {
      // confirm BEFORE applySteward replaces the on-device key
      if (window.Steward.hasKey && !window.confirm('This replaces the church currently on this device — back it up first.\n\nRestore from the file and reload?')) return;
      window.TrinityBackup.applySteward(obj);
      window.location.reload();
    }).catch(err => window.alert('Restore failed: ' + (err.message || err)));
  };
  return (
    <div style={{ paddingBottom: 24 }}>
      {backupOpen ? <StewBackupModal church={church} onClose={() => setBackupOpen(false)} /> : null}
      {editingName ? <NameEditModal current={church.name} isNetwork={church.isNetwork} onSave={saveName} onClose={() => setEditingName(false)} /> : null}
      {picFile ? <ImageCropModal file={picFile} outW={256} outH={256} round title="Position your picture" onSave={savePicture} onClose={() => setPicFile(null)} /> : null}
      {editingWeb ? <WebAddressModal church={church} onClose={() => setEditingWeb(false)} /> : null}
      {pinAction ? <PinModal action={pinAction} onClose={(ok) => { const wasRemove = pinAction === 'remove'; setPinAction(null); if (ok) setHasPin(!wasRemove); }} /> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {[['church', 'Church'], ['features', 'Features'], ['network', 'Network & relays'], ['security', 'Security']].map(([k, label]) => (
          <button key={k} onClick={() => setSection(k)} style={{ padding: '8px 15px', borderRadius: 999, border: '1px solid ' + (section === k ? 'var(--clay)' : 'var(--line)'), cursor: 'pointer', background: section === k ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface)', color: section === k ? 'var(--clay-ink)' : 'var(--ink-2)', fontWeight: 700, fontSize: 13.5, fontFamily: 'var(--font-ui)' }}>{label}</button>
        ))}
      </div>
      <div className={section === 'network' ? 'net-grid' : 'sk-masonry'}>
      {section === 'church' ? <React.Fragment>
      <Panel title={church.isNetwork ? 'Network identity' : 'Church identity'} action={<button onClick={() => setEditingName(true)} className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="pen" size={14} color="currentColor" /> Edit name</button>}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16 }}>
          <label title="Upload a church picture" style={{ position: 'relative', cursor: picBusy ? 'default' : 'pointer', flexShrink: 0, opacity: picBusy ? .6 : 1 }}>
            <SkBadge initials={(church.name ? church.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'TO').toUpperCase()} picture={church.picture} size={44} radius={999} />
            <span style={{ position: 'absolute', right: -4, bottom: -4, width: 20, height: 20, borderRadius: 999, background: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--surface)' }}><Icon name={picBusy ? 'refresh' : 'pen'} size={10} color="var(--on-clay)" /></span>
            <input type="file" accept="image/*" disabled={picBusy} onChange={onPickPicture} style={{ display: 'none' }} />
          </label>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: church.name ? 'var(--ink)' : 'var(--ink-3)' }}>{church.name || 'Name your church'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{church.picture ? <button onClick={removePicture} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--clay-ink)', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12.5 }}>Remove picture</button> : 'Tap the badge to add a picture'}</div>
          </div>
        </div>
        <SkKey value={church.npub || '—'} label="npub" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 12, padding: '11px 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <Icon name="globe" size={18} color="var(--sage)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Joining handle{(church.nip05 && church.nip05.includes('@')) ? ' · web address' : ''}</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={church.nip05 || ''}>{churchHandle(church) || '—'}{(church.nip05 && church.nip05.includes('@')) ? ' · ' + church.nip05.split('@')[1] : ''}</div>
          </div>
          <button onClick={() => setEditingWeb(true)} className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 12.5, flexShrink: 0 }}><Icon name="pen" size={13} color="currentColor" /> Edit</button>
        </div>
      </Panel>

      <DashBrandingPanel church={church} />

      <DashMediaPanel church={church} />

      <DashBackup />
      </React.Fragment> : null}

      {section === 'features' ? <React.Fragment>
      <DashFeaturesPanel church={church} />

      <DashChatTagsPanel church={church} />

      {/* Giving is a short card — place it right after the short Chat-tags card so the masonry column flow
          packs it there, instead of stranding it at the bottom of the tall Practical-care column. */}
      <DashGivingPanel church={church} />

      <DashMealsPanel church={church} />
      </React.Fragment> : null}

      {/* Network and relays are one page. Apart, the Relays card was the only child of .net-grid and so
          landed in that grid's NARROW first track (capped at 360px) with the wide track left empty — which
          is what squeezed its inner two-column grid down to about 150px a side and broke every line to one
          word. Together they use the grid as designed: the narrow Network card beside the wide Relays one. */}
      {/* Two grid children, not three: the narrow column is a stack. As three siblings the third card
          would land in row 2, which starts below the tall Relays card — leaving a screen of empty space
          under Network. Stacking keeps it directly beneath. */}
      {section === 'network' ? <React.Fragment>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <DashNetworksPanel />
        <DashRunRelayCard />
      </div>
      <DashRelaysCard />
      </React.Fragment> : null}

      {section === 'security' && delegated ? (
      <Panel title="Security">
        <div style={{ display: 'flex', gap: 11, padding: 13, borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 8%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 24%, var(--line))' }}>
          <Icon name="shield" size={18} color="var(--clay)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>You’re acting as a <b style={{ color: 'var(--ink)' }}>steward</b> of this church — you can post and help manage it, but its key, recovery phrase, blocklist and steward list belong to the owner. Switch back to your own identity (top-left) to manage your own key.</div>
        </div>
      </Panel>
      ) : null}
      {section === 'security' && !delegated ? <React.Fragment>
      <Panel title="Church key">
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>This church is self-custodial: its identity is one key, held on this device. Whoever holds it can post and manage the church — so keep the recovery phrase safe and private.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 14px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 12 }}>
          <Icon name="lock" size={18} color="var(--sage)" />
          <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14 }}>Held on this device</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Pilot key custody · a Keykeeper signer comes later</div></div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--sage)' }}><span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--sage)' }} /> Active</span>
        </div>
        {!revealed ? (
          <button onClick={reveal} className="sk-btn sk-btn--ghost" style={{ padding: '10px 14px', fontSize: 13 }}><Icon name="key" size={15} color="currentColor" /> Reveal recovery phrase</button>
        ) : (
          <div style={{ padding: 14, borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 7%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, var(--line))' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 14, lineHeight: 1.7, wordSpacing: 3, color: 'var(--ink)' }}>{phrase || 'No phrase available for this key.'}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {phrase ? <button onClick={() => { copyText(phrase); setCopied(true); setTimeout(() => setCopied(false), 1400); }} className="sk-btn sk-btn--clay" style={{ padding: '7px 11px', fontSize: 12 }}><Icon name={copied ? 'check' : 'receipt'} size={14} color="var(--on-clay)" /> {copied ? 'Copied' : 'Copy'}</button> : null}
              <button onClick={() => { setRevealed(false); setPhrase(''); }} className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 12 }}>Hide</button>
            </div>
          </div>
        )}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setBackupOpen(true)} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="share" size={15} color="currentColor" /> Back up to a file</button>
          <label className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13, cursor: 'pointer' }}><Icon name="refresh" size={15} color="currentColor" /> Restore from a file<input type="file" accept=".json,application/json" onChange={restoreFromFile} style={{ display: 'none' }} /></label>
        </div>
        <div style={{ marginTop: 12 }}>
          {!restoreOpen ? (
            <button onClick={() => setRestoreOpen(true)} className="sk-btn sk-btn--ghost" style={{ padding: '10px 14px', fontSize: 13 }}><Icon name="key" size={15} color="currentColor" /> Restore from a recovery phrase</button>
          ) : (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 8 }}>Paste a church’s 12-word recovery phrase to make <b>this</b> device that church. Use this if the console lost its key, or to move a church to a new machine.</div>
              <textarea value={restorePhrase} onChange={e => setRestorePhrase(e.target.value)} rows={3} placeholder="word one  word two  word three …" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', padding: '11px 13px', fontSize: 13.5, fontFamily: 'var(--mono)', color: 'var(--ink)', outline: 'none', resize: 'vertical', lineHeight: 1.6 }} />
              {restoreErr ? <div style={{ fontSize: 12.5, color: 'var(--clay)', fontWeight: 600, marginTop: 6 }}>{restoreErr}</div> : null}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={doRestore} disabled={!restorePhrase.trim()} className="sk-btn sk-btn--clay" style={{ padding: '8px 13px', fontSize: 13, opacity: restorePhrase.trim() ? 1 : 0.5 }}><Icon name="refresh" size={14} color="var(--on-clay)" /> Restore church</button>
                <button onClick={() => { setRestoreOpen(false); setRestorePhrase(''); setRestoreErr(''); }} className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 13 }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Console lock">
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>{hasPin
          ? 'This console is locked with a PIN — the church key is encrypted on this device and auto-locks after 10 minutes idle.'
          : 'Add a PIN to encrypt the church key on this device. Without it, anyone who opens this browser can post as the church. A longer PIN or passphrase is safer.'}</div>
        {!hasPin ? (
          <button onClick={() => setPinAction('set')} className="sk-btn sk-btn--clay" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="lock" size={15} color="var(--on-clay)" /> Lock with a PIN</button>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setPinAction('change')} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="key" size={15} color="currentColor" /> Change PIN</button>
            <button onClick={() => setPinAction('remove')} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13, color: 'var(--clay)' }}><Icon name="x" size={15} color="currentColor" /> Remove lock</button>
          </div>
        )}
      </Panel>

      <Panel title="Stewards & handoff">
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 12 }}>A church is one key. To <b style={{ color: 'var(--ink)' }}>add another steward</b> or <b style={{ color: 'var(--ink)' }}>hand the church over</b>, share its recovery phrase — they enter it on their device under <b>Church key → Restore from a recovery phrase</b> (or in the Steward app). Then they can manage {church.name || 'the church'} too.</div>
        <ol style={{ margin: '0 0 12px', paddingLeft: 20, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          <li><b>Show the handoff QR</b> below (or reveal the phrase above) — in person is safest.</li>
          <li>They open the Steward app → <b>Restore a church</b> → <b>Scan</b> it (or paste the phrase) — now a co-steward.</li>
          <li>Handing off entirely? <b>Remove it from this device</b> below once they’re set up.</li>
        </ol>
        <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 11, background: 'color-mix(in oklab, var(--gold) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 26%, transparent)', marginBottom: 14 }}>
          <Icon name="shield" size={16} color="var(--gold)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}><b style={{ color: 'var(--ink)' }}>Anyone with this phrase can fully manage the church</b> — it hands over the whole identity, so only share it with someone you fully trust. To add a helper <b>without</b> giving away the key, use <b>Delegated stewards</b> below: they get their own revocable access.</div>
        </div>
        {/* handoff QR — the new steward scans this to adopt the church */}
        <div style={{ marginBottom: 14 }}>
          {!showQR ? (
            <button onClick={() => setShowQR(true)} className="sk-btn sk-btn--clay" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="qr" size={15} color="var(--on-clay)" /> Show handoff QR</button>
          ) : (
            <div style={{ textAlign: 'center', padding: 14, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              {handoffSvg
                ? <div style={{ width: 184, height: 184, margin: '0 auto', background: '#fff', borderRadius: 12, padding: 8, boxSizing: 'border-box' }} dangerouslySetInnerHTML={{ __html: handoffSvg }} />
                : <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: 20 }}>No church key on this device.</div>}
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '12px 6px 0' }}>New steward: open the Steward app → <b>Restore a church</b> → <b>Scan</b>, and point the camera here. This carries the church key — show it only to someone you trust, in person.</div>
              <button onClick={() => setShowQR(false)} className="sk-btn sk-btn--ghost" style={{ padding: '7px 13px', fontSize: 12.5, marginTop: 10 }}>Hide QR</button>
            </div>
          )}
        </div>
        {/* scan side — bring another steward's church onto this device by scanning their handoff QR */}
        <div style={{ marginBottom: 14 }}>
          {!scanning ? (
            <React.Fragment>
              <button onClick={() => setScanning(true)} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="qr" size={15} color="currentColor" /> Scan a handoff QR</button>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, marginTop: 7 }}>Point this device at another steward’s handoff QR to take over their church here. It replaces the church key on this device, so back yours up first.</div>
            </React.Fragment>
          ) : (
            <div style={{ padding: 14, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <StewQRScanner onResult={adoptScanned} onCancel={() => setScanning(false)} />
            </div>
          )}
        </div>
        {!confirmRemove ? (
          <button onClick={() => setConfirmRemove(true)} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13, color: 'var(--clay)' }}><Icon name="x" size={15} color="currentColor" /> Remove this church from this device</button>
        ) : (
          <div style={{ padding: 13, borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 7%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, var(--line))' }}>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 10 }}>This forgets the church key on <b>this</b> device only — the church keeps running wherever its phrase is held. Make sure you’ve backed up the phrase or handed it on first, or this church is gone from here.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { window.Steward.removeKey(); window.location.reload(); }} className="sk-btn" style={{ padding: '8px 13px', fontSize: 13, background: 'var(--clay)', color: 'var(--on-clay)' }}><Icon name="x" size={14} color="var(--on-clay)" /> Remove &amp; reload</button>
              <button onClick={() => setConfirmRemove(false)} className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 13 }}>Cancel</button>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 14, fontSize: 12.5, color: 'var(--ink-3)' }}>
          <Icon name="pray" size={14} color="var(--ink-3)" /> See who’s joined in the <button onClick={() => onTab && onTab('members')} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--clay-ink)', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12.5 }}>Members list</button>.
        </div>
      </Panel>

      <DashStewardsPanel church={church} />

      <DashBecomeStewardPanel />
      </React.Fragment> : null}
      </div>
      <StewVersion />
    </div>
  );
}

// small build/version line at the foot of Settings. On the APK it reads the real native version
// (versionName + build) via the Capacitor App plugin; on the web it reads the live service-worker
// cache version (trinity-shell-vNN) so it always reflects what's actually running.
function StewVersion() {
  const [v, setV] = React.useState('');
  React.useEffect(() => {
    let alive = true;
    const P = window.Capacitor && window.Capacitor.Plugins;
    if (P && P.App && P.App.getInfo) {
      P.App.getInfo().then(i => { if (alive && i) setV('v' + i.version + ' (' + i.build + ')'); }).catch(() => {});
    } else if (typeof caches !== 'undefined' && caches.keys) {
      caches.keys().then(keys => {
        const nums = keys.map(k => (k.match(/trinity-shell-v(\d+)/) || [])[1]).filter(Boolean).map(Number);
        if (alive && nums.length) setV('web build ' + Math.max(...nums));
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, []);
  return (
    <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--ink-3)', marginTop: 20, fontFamily: 'var(--font-ui)' }}>
      TrinityOne Steward{v ? ' · ' + v : ''}
    </div>
  );
}

// ── Facebook-style docked DM window: the church <-> one member, encrypted ──
function StewDmWindow({ peer, offset, onClose }) {
  const [msgs, setMsgs] = React.useState([]);
  const [text, setText] = React.useState('');
  const [min, setMin] = React.useState(false);
  const scRef = React.useRef(null);
  const [rxFor, setRxFor] = React.useState('');   // msg id whose emoji picker is open
  React.useEffect(() => window.Steward.subscribeDMThread(peer.pubkey, setMsgs), [peer.pubkey]);
  React.useEffect(() => { if (!min && scRef.current) scRef.current.scrollTop = scRef.current.scrollHeight; }, [msgs, min]);
  const send = () => { if (!text.trim()) return; window.Steward.sendDM(peer.pubkey, text.trim()); setText(''); };
  const react = (m, emoji) => { window.Steward.reactDM(peer.pubkey, m.id, m.myReaction === emoji ? '-' : emoji); setRxFor(''); };
  const DM_EMOJI = ['❤️', '🙏', '👍', '😂', '😮', '😢'];
  const initials = (peer.name && peer.name !== 'Anonymous' ? peer.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'AN').toUpperCase();
  return (
    <div style={{ width: 316, background: 'var(--surface)', borderRadius: '14px 14px 0 0', border: '1px solid var(--line)', borderBottom: 'none', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', height: min ? 48 : 420, transition: 'height .18s' }}>
      <div onClick={() => setMin(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', cursor: 'pointer', background: 'var(--surface)', borderBottom: min ? 'none' : '1px solid var(--line)', flexShrink: 0 }}>
        <SkBadge initials={initials} size={28} radius={9} accent={SK_TINT.gold.fg} />
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{peer.name || 'Member'}</div><div style={{ fontSize: 10.5, color: nameHandle(peer) ? 'var(--sage)' : 'var(--ink-3)', fontWeight: nameHandle(peer) ? 700 : 400, fontFamily: nameHandle(peer) ? 'var(--font-ui)' : 'var(--mono)' }}>{nameHandle(peer) ? '@' + nameHandle(peer) : shortNpub(peer.npub)}</div></div>
        <button onClick={(e) => { e.stopPropagation(); setMin(v => !v); }} title={min ? 'Expand this chat' : 'Minimise this chat'} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 3 }}><Icon name={min ? 'chevU' : 'chevD'} size={16} /></button>
        <button onClick={(e) => { e.stopPropagation(); onClose(); }} title="Close chat" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 3 }}><Icon name="x" size={16} /></button>
      </div>
      {!min ? (
        <React.Fragment>
          <div ref={scRef} className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}><Icon name="lock" size={12} /> Encrypted · only you two can read this</div>
            {msgs.map(m => (
              <div key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '82%', display: 'flex', flexDirection: 'column', alignItems: m.mine ? 'flex-end' : 'flex-start', position: 'relative' }}>
                <div onClick={() => setRxFor(v => v === m.id ? '' : m.id)} title="Tap to react" style={{ padding: '8px 12px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.4, background: m.mine ? 'var(--clay)' : 'var(--surface-2)', color: m.mine ? '#fff' : 'var(--ink)', border: m.mine ? 'none' : '1px solid var(--line)', cursor: 'pointer' }}>{m.text}</div>
                {m.reactions && m.reactions.length ? (
                  <div style={{ display: 'flex', gap: 3, marginTop: 2, flexWrap: 'wrap' }}>
                    {Object.entries(m.reactions.reduce((a, e) => (a[e] = (a[e] || 0) + 1, a), {})).map(([emo, n]) => (
                      <button key={emo} onClick={() => react(m, emo)} title="Add or remove your reaction" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 6px', borderRadius: 999, fontSize: 11.5, border: '1px solid var(--line)', background: m.myReaction === emo ? 'color-mix(in oklab, var(--clay) 16%, var(--surface))' : 'var(--surface)', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>{emo}{n > 1 ? <span style={{ color: 'var(--ink-3)', fontWeight: 700 }}>{n}</span> : null}</button>
                    ))}
                  </div>
                ) : null}
                {rxFor === m.id ? (
                  <div style={{ display: 'flex', gap: 2, marginTop: 4, padding: '4px 6px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, boxShadow: 'var(--shadow)' }}>
                    {DM_EMOJI.map(emo => (
                      <button key={emo} onClick={() => react(m, emo)} title={'React with ' + emo} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 3px', borderRadius: 7, opacity: m.myReaction === emo ? 1 : 0.85 }}>{emo}</button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '10px 11px', borderTop: '1px solid var(--line)', flexShrink: 0 }}>
            <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} autoFocus placeholder="Message…" style={{ flex: 1, height: 38, border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface-2)', padding: '0 12px', fontSize: 13.5, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
            <button onClick={send} disabled={!text.trim()} title="Send this message" className="sk-btn sk-btn--clay" style={{ padding: '0 13px', opacity: text.trim() ? 1 : 0.5 }}><Icon name="send" size={15} color="var(--on-clay)" /></button>
          </div>
        </React.Fragment>
      ) : null}
    </div>
  );
}

function MemberChatDock() {
  const [peers, setPeers] = React.useState([]);
  const [grps, setGrps] = React.useState([]);   // group chats docked alongside DMs — several windows along the bottom
  React.useEffect(() => {
    const onDm = (e) => { const p = e.detail; if (!p || !p.pubkey) return; setPeers(ps => ps.some(x => x.pubkey === p.pubkey) ? ps : [...ps, p].slice(-3)); };
    const onGrp = (e) => { const g = e.detail; if (!g || !g.id) return; setGrps(gs => gs.some(x => x.id === g.id) ? gs : [...gs, g].slice(-3)); };
    window.addEventListener('steward-open-dm', onDm);
    window.addEventListener('steward-open-group-chat', onGrp);
    return () => { window.removeEventListener('steward-open-dm', onDm); window.removeEventListener('steward-open-group-chat', onGrp); };
  }, []);
  const close = (pk) => setPeers(ps => ps.filter(x => x.pubkey !== pk));
  const closeG = (id) => setGrps(gs => gs.filter(x => x.id !== id));
  if (!peers.length && !grps.length) return null;
  return (
    <div style={{ position: 'absolute', right: 20, bottom: 0, zIndex: 130, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
      {grps.map(g => <GroupChatModal key={g.id} group={g} onClose={() => closeG(g.id)} />)}
      {peers.map(p => <StewDmWindow key={p.pubkey} peer={p} onClose={() => close(p.pubkey)} />)}
    </div>
  );
}

window.StewDashboard = StewDashboard;
