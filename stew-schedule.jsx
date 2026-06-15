// stew-schedule.jsx — Steward Rota board + Calendar (the coverage board).
// The anti-ChurchSuite centerpiece: pick a service -> teams-as-cards with filled chips vs gold gaps
// -> tap a gap for smart suggestions (free first) -> one-tap assign; Auto-fill, Copy last week, Publish.
// Wired to window.Steward (services/rotas/rosters/events on the church relay). Exports DashRota, DashCalendar.
const { useState: useSch, useEffect: useSchE, useRef: useSchR } = React;

const SCH_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SCH_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function schDate(s) { try { return new Date(s + 'T00:00'); } catch { return new Date(); } }
function schKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function schParts(s) { const d = schDate(s); return { dow: SCH_DOW[d.getDay()], day: d.getDate(), mon: SCH_MON[d.getMonth()] }; }
function schAddDays(iso, n) { const d = schDate(iso); d.setDate(d.getDate() + n); return schKey(d); }
function schAddMonths(iso, n) { const d = schDate(iso); d.setMonth(d.getMonth() + n); return schKey(d); }
// dates from start (inclusive) stepping weekly/monthly up to and including untilIso
function schGenDates(startIso, cadence, untilIso) {
  if (!startIso) return []; const out = [startIso]; let cur = startIso, guard = 0;
  while (guard++ < 400) { cur = cadence === 'monthly' ? schAddMonths(cur, 1) : schAddDays(cur, 7); if (!untilIso || cur > untilIso) break; out.push(cur); }
  return out;
}
function teamMeta(t) { return { name: t.name, icon: t.icon || 'hand', accent: t.accent || 'var(--clay)' }; }
function memDisplay(m) { return (m && m.name && m.name.trim()) || ('Anon · ' + ((m && (m.npub || m.pubkey)) || '').slice(-6)); }
function sameAssign(a, b) { const k = o => Object.keys(o || {}).filter(x => (o[x] && o[x].name)).sort().map(x => x + '=' + o[x].name + '/' + (o[x].pub || '')).join('|'); return k(a) === k(b); }

// small date block used across the board
function SchDateBlock({ dateStr, accent = 'var(--clay)' }) {
  const p = schParts(dateStr);
  return (
    <div style={{ width: 50, flexShrink: 0, textAlign: 'center', borderRadius: 12, padding: '6px 0', background: `color-mix(in oklab, ${accent} 13%, var(--surface))`, border: `1px solid color-mix(in oklab, ${accent} 26%, transparent)` }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: accent }}>{p.dow}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, lineHeight: 1, color: 'var(--ink)' }}>{p.day}</div>
      <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase' }}>{p.mon}</div>
    </div>
  );
}

const schFld = { width: '100%', boxSizing: 'border-box', height: 44, border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface-2)', padding: '0 13px', fontSize: 14.5, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' };
const schLbl = { fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '14px 0 6px' };
function SchModal({ title, children, onClose, width = 480 }) {
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 95, background: 'rgba(40,32,24,.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width, maxWidth: '94%', maxHeight: '90%', overflow: 'auto', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 26 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21, marginBottom: 4 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

// ── manage a team's roster: the roles it needs + the people who can serve ──
function RosterModal({ team, roster, members, onClose }) {
  const [roles, setRoles] = useSch(() => (roster && roster.roles ? roster.roles.map(r => ({ ...r })) : []));
  const [people, setPeople] = useSch(() => (roster && roster.people ? roster.people.map(p => ({ ...p })) : []));
  const [newRole, setNewRole] = useSch('');
  const [newPerson, setNewPerson] = useSch('');
  const [linkPub, setLinkPub] = useSch('');
  const rid = () => 'r' + Math.random().toString(36).slice(2, 7);
  const pid = () => 'p' + Math.random().toString(36).slice(2, 7);
  const addRole = () => { if (!newRole.trim()) return; setRoles(r => [...r, { id: rid(), name: newRole.trim() }]); setNewRole(''); };
  const addPerson = () => {
    let name = newPerson.trim(), pub = '';
    if (linkPub) { const m = (members || []).find(x => x.pubkey === linkPub); if (m) { name = memDisplay(m); pub = m.pubkey; } }
    if (!name) return;
    setPeople(p => [...p, { id: pid(), name, pub }]); setNewPerson(''); setLinkPub('');
  };
  const save = () => { window.Steward.publishRoster(team.id, { roles, people }); onClose(); };
  const m = teamMeta(team);
  return (
    <SchModal title={`${team.name} · roster`} onClose={onClose} width={520}>
      <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '6px 0 2px' }}>The roles this team fills each service, and the people who can be put on. Linking a person to a member lets them get reminders and accept on their phone.</p>
      <div style={schLbl}>Roles</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 9 }}>
        {roles.map(r => (
          <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 11px', borderRadius: 999, background: `color-mix(in oklab, ${m.accent} 12%, var(--surface))`, border: `1px solid color-mix(in oklab, ${m.accent} 26%, transparent)`, fontSize: 13, fontWeight: 700 }}>
            {r.name}<button onClick={() => setRoles(x => x.filter(y => y.id !== r.id))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 0 }}><Icon name="x" size={13} /></button></span>
        ))}
        {roles.length === 0 ? <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>No roles yet.</span> : null}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={newRole} onChange={e => setNewRole(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addRole(); }} placeholder="Add a role — e.g. Sound" style={schFld} />
        <button onClick={addRole} className="sk-btn sk-btn--ghost" style={{ padding: '0 16px', flexShrink: 0 }}><Icon name="plus" size={15} color="currentColor" /></button>
      </div>
      <div style={schLbl}>People who can serve</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 9 }}>
        {people.map(pp => (
          <div key={pp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <div style={{ width: 30, height: 30, borderRadius: 999, flexShrink: 0, background: `linear-gradient(150deg, ${m.accent}, color-mix(in oklab, ${m.accent} 60%, #16120c))`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 11 }}>{(pp.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{pp.name}</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{pp.pub ? 'On the app · gets reminders' : 'Off-app'}</div></div>
            <button onClick={() => setPeople(x => x.filter(y => y.id !== pp.id))} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 7px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="trash" size={14} /></button>
          </div>
        ))}
        {people.length === 0 ? <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>No one added yet.</span> : null}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
        <input value={newPerson} onChange={e => setNewPerson(e.target.value)} placeholder="Name" style={schFld} disabled={!!linkPub} />
        <select value={linkPub} onChange={e => setLinkPub(e.target.value)} style={schFld}>
          <option value="">…or link a member</option>
          {(members || []).map(mm => <option key={mm.pubkey} value={mm.pubkey}>{memDisplay(mm)}</option>)}
        </select>
        <button onClick={addPerson} className="sk-btn sk-btn--ghost" style={{ padding: '0 16px' }}><Icon name="plus" size={15} color="currentColor" /></button>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
        <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12, fontSize: 14 }}>Cancel</button>
        <button onClick={save} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 12, fontSize: 14 }}><Icon name="check" size={16} color="#fff" /> Save roster</button>
      </div>
    </SchModal>
  );
}

// ── the assign picker: suggestions for a gap, free-first ──
function AssignModal({ slot, roster, assign, unavail, onAssign, onClear, onClose }) {
  const m = teamMeta(slot.team);
  const date = slot.service.date;
  // who's already on the rota this service (by pub or name)
  const taken = new Set();
  Object.values(assign || {}).forEach(a => { if (a && a.name) { taken.add('n:' + a.name); if (a.pub) taken.add('p:' + a.pub); } });
  const cur = assign[slot.key];
  const ranked = (roster && roster.people ? roster.people : []).map(p => {
    const away = p.pub && (unavail[p.pub] || []).includes(date);
    const onRota = taken.has('n:' + p.name) || (p.pub && taken.has('p:' + p.pub));
    const isThis = cur && ((cur.pub && cur.pub === p.pub) || cur.name === p.name);
    return { ...p, away, onRota: onRota && !isThis, isThis, rank: (away ? 2 : (onRota && !isThis) ? 1 : 0) };
  }).sort((a, b) => a.rank - b.rank);
  return (
    <SchModal title={`Assign · ${slot.role.name}`} onClose={onClose} width={460}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-2)', margin: '4px 0 14px' }}>
        <div style={{ width: 24, height: 24, borderRadius: 7, background: `color-mix(in oklab, ${m.accent} 15%, var(--surface))`, color: m.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={m.icon} size={14} /></div>
        {m.name} · {schParts(date).dow} {schParts(date).day} {schParts(date).mon} · {slot.service.time}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 9 }}>SUGGESTED — FREE FIRST</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ranked.length === 0 ? <div style={{ fontSize: 13.5, color: 'var(--ink-3)', padding: '6px 2px' }}>No one in this team's roster yet — add people via “Roster”.</div> : null}
        {ranked.map(p => {
          const stTxt = p.isThis ? 'Assigned here' : p.away ? 'Away' : p.onRota ? 'On rota' : 'Free';
          const stCol = p.isThis ? 'var(--clay)' : p.away ? 'var(--ink-3)' : p.onRota ? '#8a6717' : 'var(--sage)';
          return (
            <button key={p.id} onClick={() => onAssign(p)} disabled={p.away} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: 11, borderRadius: 13, cursor: p.away ? 'not-allowed' : 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', opacity: p.away ? 0.6 : 1,
              border: p.isThis ? '2px solid var(--clay)' : '1px solid var(--line)', background: 'var(--surface)' }}>
              <div style={{ width: 34, height: 34, borderRadius: 999, flexShrink: 0, background: `linear-gradient(150deg, ${m.accent}, color-mix(in oklab, ${m.accent} 60%, #16120c))`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12 }}>{(p.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14.5 }}>{p.name}</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{p.pub ? 'On the app' : 'Off-app'}</div></div>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: stCol }}>{stTxt}</span>
            </button>
          );
        })}
      </div>
      {cur && cur.name ? <button onClick={onClear} className="sk-btn sk-btn--ghost" style={{ width: '100%', padding: 12, marginTop: 16, fontSize: 14 }}><Icon name="x" size={15} color="currentColor" /> Clear this slot</button> : null}
    </SchModal>
  );
}

function SchRepeatRow({ repeat, setRepeat, until, setUntil }) {
  return (
    <React.Fragment>
      <div style={schLbl}>Repeat</div>
      <div style={{ display: 'flex', gap: 7 }}>
        {[['none', 'Once'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([v, l]) => (
          <button key={v} onClick={() => setRepeat(v)} style={{ flex: 1, padding: '9px 0', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, border: repeat === v ? '2px solid var(--clay)' : '1px solid var(--line)', background: repeat === v ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface)', color: 'var(--ink)' }}>{l}</button>
        ))}
      </div>
      {repeat !== 'none' ? (<React.Fragment><div style={schLbl}>Until</div><input type="date" value={until} onChange={e => setUntil(e.target.value)} style={schFld} /></React.Fragment>) : null}
    </React.Fragment>
  );
}

function SchAddServiceModal({ onClose }) {
  const [name, setName] = useSch('Sunday Gathering');
  const [date, setDate] = useSch('');
  const [time, setTime] = useSch('10:30');
  const [repeat, setRepeat] = useSch('none');
  const [until, setUntil] = useSch('');
  const save = () => {
    if (!date) return;
    const dates = repeat === 'none' ? [date] : schGenDates(date, repeat, until || schAddMonths(date, 3));
    dates.forEach(d => window.Steward.publishService({ name: name.trim() || 'Service', date: d, time }));
    onClose();
  };
  return (
    <SchModal title="Add a service" onClose={onClose} width={420}>
      <div style={schLbl}>Name</div>
      <input value={name} onChange={e => setName(e.target.value)} style={schFld} />
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><div style={schLbl}>Date</div><input type="date" value={date} onChange={e => setDate(e.target.value)} style={schFld} /></div>
        <div style={{ width: 130 }}><div style={schLbl}>Time</div><input type="time" value={time} onChange={e => setTime(e.target.value)} style={schFld} /></div>
      </div>
      <SchRepeatRow repeat={repeat} setRepeat={setRepeat} until={until} setUntil={setUntil} />
      <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
        <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12, fontSize: 14 }}>Cancel</button>
        <button onClick={save} disabled={!date} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 12, fontSize: 14, opacity: date ? 1 : 0.55 }}><Icon name="plus" size={16} color="#fff" /> {repeat === 'none' ? 'Add service' : 'Add services'}</button>
      </div>
    </SchModal>
  );
}

// ════════════════════════ ROTA BOARD ════════════════════════
function DashRota({ onNewTeam }) {
  const teams = window.useStewardGroups().filter(g => g.kind === 'team');
  const rosters = window.useStewardRosters();
  const services = window.useStewardServices();
  const rotas = window.useStewardRotas();
  const members = window.useStewardMembers();
  const unavail = window.useStewardUnavail();
  const requests = window.useStewardRequests();          // "can you serve?" docs we sent
  const replies = window.useStewardRequestReplies();     // members' accept/decline/swap
  const narrow = (typeof useStewNarrow === 'function') ? useStewNarrow() : false;   // stack the toolbar on phones

  // verdict for an assigned slot: 'accept' | 'decline' | 'swap' | 'pending' (asked, no reply) | '' (not asked)
  const replyById = {}; replies.forEach(r => { if (r.id) replyById[r.id] = r.v; });
  const slotVerdict = (svcId, teamId, roleId, pub) => {
    const matches = requests.filter(q => q.serviceId === svcId && q.teamId === teamId && q.roleId === roleId && (!pub || !q.memberPub || q.memberPub === pub));
    if (!matches.length) return '';
    matches.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return replyById[matches[0].id] || 'pending';
  };

  const rosterFor = (id) => rosters.find(r => r.team === id) || { roles: [], people: [] };
  const persisted = (svcId) => rotas.find(r => r.service === svcId) || null;
  const sortedSvcs = services.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const todayStr = schKey(new Date());
  const defaultSvc = (sortedSvcs.find(s => (s.date || '') >= todayStr) || sortedSvcs[sortedSvcs.length - 1] || {}).id;

  const [sel, setSel] = useSch(null);
  const [draft, setDraft] = useSch({});         // { svcId: assignMap } — local unsaved edits
  const seeded = useSchR(new Set());
  const [assignSlot, setAssignSlot] = useSch(null);
  const [rosterTeam, setRosterTeam] = useSch(null);
  const [adding, setAdding] = useSch(false);
  const [fillMenu, setFillMenu] = useSch(false);
  const [flash, setFlash] = useSch('');

  // seed each service's draft from its published rota the first time we see it
  useSchE(() => {
    let changed = false; const next = { ...draft };
    rotas.forEach(r => { if (!seeded.current.has(r.service)) { seeded.current.add(r.service); next[r.service] = { ...(r.assign || {}) }; changed = true; } });
    if (changed) setDraft(next);
  }, [rotas]);

  const svcId = sel || defaultSvc;
  const svc = sortedSvcs.find(s => s.id === svcId);
  const assign = (svcId && draft[svcId] !== undefined) ? draft[svcId] : (persisted(svcId) ? persisted(svcId).assign : {});
  const setAssign = (next) => setDraft(d => ({ ...d, [svcId]: next }));

  // coverage across all teams for this service
  let total = 0, filled = 0;
  teams.forEach(t => { const rs = rosterFor(t.id).roles; total += rs.length; rs.forEach(role => { if (assign[t.id + '::' + role.id] && assign[t.id + '::' + role.id].name) filled++; }); });
  const gaps = total - filled;

  const pers = persisted(svcId);
  const isPublished = pers && pers.published && sameAssign(assign, pers.assign);

  // Assigning only edits the draft — the member is NOT asked until you Publish (so you can move people
  // around freely first). Publish then sends a "Can you serve?" to anyone newly assigned.
  const doAssign = (slot, person) => {
    const next = { ...assign, [slot.key]: { name: person.name, pub: person.pub || '' } };
    setAssign(next); setAssignSlot(null);
  };
  const clearSlot = (slot) => { const next = { ...assign }; delete next[slot.key]; setAssign(next); setAssignSlot(null); };
  // already asked this person for this exact slot? (don't re-send on every publish)
  const alreadyAsked = (sId, tId, rId, pub) => requests.some(q => q.serviceId === sId && q.teamId === tId && q.roleId === rId && q.memberPub === pub);
  const sendRequestsFor = (sId, sDate, sTime, sName, assignMap) => {
    for (const key in assignMap) {
      const a = assignMap[key]; if (!a || !a.pub) continue;
      const [teamId, roleId] = key.split('::');
      if (alreadyAsked(sId, teamId, roleId, a.pub)) continue;
      const team = teams.find(t => t.id === teamId); const m = team ? teamMeta(team) : {};
      const role = rosterFor(teamId).roles.find(r => r.id === roleId);
      window.Steward.sendServingRequest({ memberPub: a.pub, serviceId: sId, teamId, roleId, role: role ? role.name : '', teamName: m.name || (team && team.name) || 'Team', icon: m.icon, accent: m.accent, date: sDate, time: sTime, service: sName, note: `Can you serve on ${m.name || (team && team.name) || 'the team'} (${role ? role.name : ''})?` });
    }
  };
  // pure: fill the gaps of `base` for a given date, not reusing anyone already on that day
  const fillAssign = (base, date, svcId) => {
    const next = { ...base };
    // clear slots whose member declined / asked to swap, so Auto-fill treats them as open — and
    // remember who said no so we don't put them straight back on.
    const noFor = {};
    for (const key in next) {
      const a = next[key]; if (!a || !a.name) continue;
      const [teamId, roleId] = key.split('::');
      const v = svcId ? slotVerdict(svcId, teamId, roleId, a.pub) : '';
      if (v === 'decline' || v === 'swap') { const s = noFor[key] = noFor[key] || new Set(); s.add('n:' + a.name); if (a.pub) s.add('p:' + a.pub); delete next[key]; }
    }
    const used = new Set(Object.values(next).filter(a => a && a.name).map(a => 'n:' + a.name));
    // gather every empty slot + its eligible roster people (not away, not declined)
    const slots = [];
    teams.forEach(t => { const r = rosterFor(t.id); r.roles.forEach(role => {
      const key = t.id + '::' + role.id; if (next[key] && next[key].name) return;
      const no = noFor[key] || new Set();
      const cand = r.people.filter(p => !no.has('n:' + p.name) && !(p.pub && no.has('p:' + p.pub)) && !(p.pub && (unavail[p.pub] || []).includes(date)));
      slots.push({ key, cand });
    }); });
    // fill the MOST-CONSTRAINED slot first (fewest free people), so people shared across teams don't
    // get grabbed by an early team and starve a later one — maximises how many slots get covered.
    while (true) {
      let best = null;
      for (const s of slots) {
        if (next[s.key] && next[s.key].name) continue;
        const avail = s.cand.filter(p => !used.has('n:' + p.name));
        if (!avail.length) continue;
        if (!best || avail.length < best.avail.length) best = { s, avail };
      }
      if (!best) break;
      const pick = best.avail[0];
      next[best.s.key] = { name: pick.name, pub: pick.pub || '' };
      used.add('n:' + pick.name);
    }
    return next;
  };
  const autoFill = () => { setAssign(fillAssign(assign, svc.date, svc.id)); setFlash('Filled the gaps — including anyone who said no'); setTimeout(() => setFlash(''), 2200); };
  // create + fill: generate weekly services for the period (if missing), then auto-fill & publish each
  const autoFillAhead = async (months) => {
    setFillMenu(false);
    const until = schAddMonths(svc.date, months);
    const dates = schGenDates(svc.date, 'weekly', until);
    const byDate = {}; sortedSvcs.forEach(s => { byDate[s.date] = s; });
    const ensured = [];
    for (const dt of dates) { if (byDate[dt]) ensured.push(byDate[dt]); else { const ns = await window.Steward.publishService({ name: svc.name, date: dt, time: svc.time }); if (ns) ensured.push(ns); } }
    for (const s of ensured) { const filled = fillAssign(assignFor(s.id) || {}, s.date, s.id); await window.Steward.publishRota({ service: s.id, published: true, assign: filled }); sendRequestsFor(s.id, s.date, s.time, s.name, filled); if (s.id === svcId) setAssign(filled); }
    setFlash(`Created + filled ${ensured.length} service${ensured.length > 1 ? 's' : ''}`); setTimeout(() => setFlash(''), 2800);
  };
  const assignFor = (id) => (draft[id] !== undefined ? draft[id] : (persisted(id) ? persisted(id).assign : null));
  const copyLastWeek = () => {
    // most recent earlier service that has any assignments (published OR draft)
    const earlier = sortedSvcs.filter(s => s.id !== svcId && (s.date || '') < (svc.date || '')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const src = earlier.find(s => { const a = assignFor(s.id); return a && Object.values(a).some(x => x && x.name); });
    if (!src) { setFlash('No earlier rota with people to copy'); setTimeout(() => setFlash(''), 2400); return; }
    setAssign({ ...assignFor(src.id) }); setFlash(`Copied ${schParts(src.date).day} ${schParts(src.date).mon}`); setTimeout(() => setFlash(''), 2200);
  };
  const publish = () => { window.Steward.publishRota({ service: svcId, published: true, assign }); sendRequestsFor(svcId, svc.date, svc.time, svc.name, assign); setFlash('Published — everyone assigned has been asked'); setTimeout(() => setFlash(''), 2400); };

  if (teams.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 380 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}><Icon name="hand" size={28} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19, marginBottom: 6 }}>Build your first team</div>
          <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 16 }}>Create a ministry team (Welcome, Worship, Kids…) with the roles it fills. Then add a service and put people on — gaps glow gold so coverage reads at a glance.</p>
          <button onClick={onNewTeam} className="sk-btn sk-btn--clay" style={{ padding: '11px 18px' }}><Icon name="plus" size={16} color="#fff" /> New team</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* service strip */}
      <div className="no-scrollbar" style={{ display: 'flex', gap: 9, overflowX: 'auto', paddingBottom: 14, flexShrink: 0 }}>
        {sortedSvcs.map(s => {
          const on = s.id === svcId; const p = schParts(s.date);
          return (
            <button key={s.id} onClick={() => setSel(s.id)} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)', textAlign: 'left',
              border: on ? '2px solid var(--clay)' : '1px solid var(--line)', background: on ? 'color-mix(in oklab, var(--clay) 8%, var(--surface))' : 'var(--surface)' }}>
              <div style={{ textAlign: 'center', lineHeight: 1 }}><div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--clay)', textTransform: 'uppercase' }}>{p.dow}</div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17 }}>{p.day}</div></div>
              <div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.name}</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{p.mon} · {s.time}</div></div>
            </button>
          );
        })}
        <button onClick={() => setAdding(true)} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 14, cursor: 'pointer', border: '1px dashed var(--line)', background: 'transparent', color: 'var(--ink-2)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13 }}><Icon name="plus" size={15} color="currentColor" /> Service</button>
      </div>

      {!svc ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 14 }}>Add a service to start building a rota.</div>
      ) : (
        <React.Fragment>
          {/* coverage bar + actions */}
          <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', alignItems: narrow ? 'stretch' : 'center', gap: narrow ? 12 : 16, padding: '14px 16px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: narrow ? 'none' : 1 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18 }}>{filled}/{total} <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink-3)' }}>roles filled</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, marginTop: 2, color: gaps ? '#8a6717' : 'var(--sage)' }}>{gaps ? <><Icon name="sparkle" size={13} color="var(--gold)" /> {gaps} gap{gaps > 1 ? 's' : ''} to fill</> : <><Icon name="check" size={13} stroke={2.6} color="var(--sage)" /> Fully covered</>}</div>
              </div>
              <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden', minWidth: 80 }}><div style={{ width: `${total ? (filled / total) * 100 : 0}%`, height: '100%', background: gaps ? 'linear-gradient(90deg, var(--sage), var(--gold))' : 'var(--sage)', borderRadius: 999, transition: 'width .3s' }} /></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0, flexWrap: 'wrap', justifyContent: narrow ? 'flex-end' : 'initial' }}>
            <button onClick={copyLastWeek} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="copy" size={15} color="currentColor" /> Copy last week</button>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setFillMenu(v => !v)} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="sparkle" size={15} color="currentColor" /> Auto-fill <Icon name="chevD" size={13} color="currentColor" /></button>
              {fillMenu ? (
                <React.Fragment>
                  <div onClick={() => setFillMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                  <div style={{ position: 'absolute', top: '110%', right: 0, zIndex: 41, width: 232, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: 6 }}>
                    {[['This service', () => { setFillMenu(false); autoFill(); }, 'Fill the gaps on this service only'],
                      ['Create + fill this month', () => autoFillAhead(1), 'Add weekly services for ~4 weeks and fill them'],
                      ['Create + fill this quarter', () => autoFillAhead(3), 'Add weekly services for ~3 months and fill them']].map(([t, go, s]) => (
                      <button key={t} onClick={go} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 11px', borderRadius: 9, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-ui)' }} onMouseDown={e => e.preventDefault()}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{t}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{s}</div>
                      </button>
                    ))}
                  </div>
                </React.Fragment>
              ) : null}
            </div>
            <button onClick={publish} className={isPublished ? 'sk-btn' : 'sk-btn sk-btn--clay'} style={{ padding: '9px 15px', fontSize: 13, background: isPublished ? 'var(--sage)' : undefined, color: '#fff' }}>
              <Icon name={isPublished ? 'check' : 'send'} size={15} color="#fff" /> {isPublished ? 'Published' : (pers && pers.published ? 'Publish changes' : 'Publish rota')}</button>
            </div>
          </div>

          {/* team cards */}
          <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflow: 'auto', marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, alignContent: 'start' }}>
            {teams.map(t => {
              const m = teamMeta(t); const r = rosterFor(t.id);
              const tFilled = r.roles.filter(role => assign[t.id + '::' + role.id] && assign[t.id + '::' + role.id].name).length;
              return (
                <div key={t.id} style={{ borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ width: 34, height: 34, borderRadius: 11, background: `color-mix(in oklab, ${m.accent} 16%, var(--surface))`, color: m.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={m.icon} size={19} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>{m.name}</div><div style={{ fontSize: 11.5, color: r.roles.length && tFilled === r.roles.length ? 'var(--sage)' : 'var(--ink-3)', fontWeight: 600 }}>{tFilled}/{r.roles.length} filled</div></div>
                    <button onClick={() => setRosterTeam(t)} title="Manage roster" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 10px', cursor: 'pointer', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12 }}><Icon name="users" size={14} /> Roster</button>
                  </div>
                  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {r.roles.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)', padding: '4px 2px' }}>No roles — add some via <b>Roster</b>.</div> : null}
                    {r.roles.map(role => {
                      const key = t.id + '::' + role.id; const a = assign[key];
                      const slot = { key, service: svc, team: t, role };
                      if (a && a.name) {
                        const verdict = slotVerdict(svc.id, t.id, role.id, a.pub);
                        const vmap = {
                          accept: { fg: 'var(--sage)', bg: 'var(--sage)', soft: 8, line: 32, label: 'Accepted', ic: 'check' },
                          decline: { fg: 'var(--clay)', bg: 'var(--clay)', soft: 9, line: 40, label: 'Declined', ic: 'x' },
                          swap: { fg: '#8a6717', bg: 'var(--gold)', soft: 10, line: 40, label: 'Wants swap', ic: 'swap' },
                          pending: { fg: 'var(--ink-3)', bg: 'var(--ink-3)', soft: 5, line: 20, label: 'Asked', ic: 'clock' },
                          '': { fg: 'var(--sage)', bg: 'var(--sage)', soft: 8, line: 32, label: '', ic: 'check' },
                        };
                        const vm = vmap[verdict] || vmap[''];
                        return (
                          <button key={role.id} onClick={() => setAssignSlot(slot)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', border: `1px solid color-mix(in oklab, ${vm.bg} ${vm.line}%, var(--line))`, background: `color-mix(in oklab, ${vm.bg} ${vm.soft}%, var(--surface))` }}>
                            <div style={{ width: 28, height: 28, borderRadius: 999, flexShrink: 0, background: `linear-gradient(150deg, ${m.accent}, color-mix(in oklab, ${m.accent} 60%, #16120c))`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 10.5 }}>{a.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600 }}>{role.name}{vm.label ? <span style={{ color: vm.fg, marginLeft: 6, fontWeight: 700 }}>· {vm.label}</span> : null}</div>
                              <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: verdict === 'decline' ? 'line-through' : 'none', color: verdict === 'decline' ? 'var(--ink-3)' : 'var(--ink)' }}>{a.name}</div>
                            </div>
                            <Icon name={vm.ic} size={15} stroke={2.4} color={vm.fg} />
                          </button>
                        );
                      }
                      return (
                        <button key={role.id} onClick={() => setAssignSlot(slot)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', border: '1.5px dashed color-mix(in oklab, var(--gold) 55%, var(--line))', background: 'color-mix(in oklab, var(--gold) 8%, var(--surface))' }}>
                          <div style={{ width: 28, height: 28, borderRadius: 999, flexShrink: 0, background: 'color-mix(in oklab, var(--gold) 20%, var(--surface))', color: '#8a6717', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={15} /></div>
                          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600 }}>{role.name}</div><div style={{ fontWeight: 700, fontSize: 13.5, color: '#8a6717' }}>Assign</div></div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </React.Fragment>
      )}

      {flash ? <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', background: 'var(--ink)', color: 'var(--paper)', padding: '9px 16px', borderRadius: 999, fontSize: 13, fontWeight: 700, boxShadow: 'var(--shadow-lg)', zIndex: 80 }}>{flash}</div> : null}
      {assignSlot ? <AssignModal slot={assignSlot} roster={rosterFor(assignSlot.team.id)} assign={assign} unavail={unavail} onAssign={(p) => doAssign(assignSlot, p)} onClear={() => clearSlot(assignSlot)} onClose={() => setAssignSlot(null)} /> : null}
      {rosterTeam ? <RosterModal team={rosterTeam} roster={rosterFor(rosterTeam.id)} members={members} onClose={() => setRosterTeam(null)} /> : null}
      {adding ? <SchAddServiceModal onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
window.DashRota = DashRota;

// ════════════════════════ CALENDAR ════════════════════════
function SchEventModal({ day, onClose }) {
  const ACCENTS = [['var(--clay)', 'Gathering'], ['var(--sage)', 'Prayer'], ['var(--gold)', 'Social'], ['#5360D6', 'Youth']];
  const allGroups = window.useStewardGroups();   // chat groups + teams the event can belong to
  const [title, setTitle] = useSch('');
  const [date, setDate] = useSch(day || '');
  const [time, setTime] = useSch('19:30');
  const [where, setWhere] = useSch('');
  const [blurb, setBlurb] = useSch('');
  const [accent, setAccent] = useSch('var(--clay)');
  const [group, setGroup] = useSch('');          // '' = whole church; else a group/team id
  const [image, setImage] = useSch('');          // optional cover image (resized data-URL)
  const [repeat, setRepeat] = useSch('none');
  const [until, setUntil] = useSch('');
  const ownedNets = React.useMemo(() => (window.Steward.ownedNetworks ? window.Steward.ownedNetworks() : []), []);
  const [asPub, setAsPub] = useSch('');          // '' = the church; else an owned network's pub
  const asNetwork = !!asPub;
  const onImage = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload = () => {
      const max = 720; let w = img.width, h = img.height; if (w > max) { h = Math.round(h * max / w); w = max; }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h);
      try { setImage(cv.toDataURL('image/jpeg', 0.72)); } catch (e) {}
    }; img.src = r.result; };
    r.readAsDataURL(file);
  };
  const save = () => {
    if (!title.trim() || !date) return;
    const dates = repeat === 'none' ? [date] : schGenDates(date, repeat, until || schAddMonths(date, 3));
    // a group is church-scoped, so a network-wide event never belongs to a church group
    const gid = asNetwork ? '' : group;
    dates.forEach(d => window.Steward.publishEvent({ title: title.trim(), date: d, time, where: where.trim(), blurb: blurb.trim(), accent, image, groupId: gid }, asPub));
    onClose();
  };
  return (
    <SchModal title="New event" onClose={onClose} width={460}>
      {ownedNets.length ? (
        <React.Fragment>
          <div style={schLbl}>Publish as</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {[{ pub: '', name: 'This church', kind: 'church' }, ...ownedNets.map(n => ({ pub: n.pub, name: n.name, kind: 'network' }))].map(idn => {
              const on = asPub === idn.pub;
              return (
                <button key={idn.pub || 'church'} onClick={() => setAsPub(idn.pub)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, border: '1px solid ' + (on ? 'var(--clay)' : 'var(--line)'), background: on ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface)', color: on ? 'var(--clay-ink)' : 'var(--ink-2)' }}>
                  <Icon name={idn.kind === 'network' ? 'globe' : 'bank'} size={13} color="currentColor" />{idn.name}</button>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', margin: '6px 2px 0', lineHeight: 1.4 }}>{asNetwork ? 'Reaches every church in the network.' : 'Only your own congregation sees this.'}</div>
        </React.Fragment>
      ) : null}
      <div style={schLbl}>Title</div>
      <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="e.g. Prayer evening" style={schFld} />
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><div style={schLbl}>Date</div><input type="date" value={date} onChange={e => setDate(e.target.value)} style={schFld} /></div>
        <div style={{ width: 130 }}><div style={schLbl}>Time</div><input type="time" value={time} onChange={e => setTime(e.target.value)} style={schFld} /></div>
      </div>
      <div style={schLbl}>Where</div>
      <input value={where} onChange={e => setWhere(e.target.value)} placeholder="e.g. Prayer chapel" style={schFld} />
      <div style={schLbl}>Type</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {ACCENTS.map(([c, lbl]) => <button key={c} onClick={() => setAccent(c)} style={{ flex: 1, padding: '9px 0', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, border: accent === c ? `2px solid ${c}` : '1px solid var(--line)', background: accent === c ? `color-mix(in oklab, ${c} 12%, var(--surface))` : 'var(--surface)', color: 'var(--ink)' }}>{lbl}</button>)}
      </div>
      {!asNetwork ? (
        <React.Fragment>
          <div style={schLbl}>Belongs to</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {[{ id: '', name: 'Whole church', icon: 'send' }, ...allGroups].map(g => {
              const on = group === g.id;
              return (
                <button key={g.id || 'all'} onClick={() => setGroup(g.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, border: '1px solid ' + (on ? 'var(--clay)' : 'var(--line)'), background: on ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface)', color: on ? 'var(--clay-ink)' : 'var(--ink-2)' }}>
                  <Icon name={g.id ? (g.kind === 'team' ? (g.icon || 'shield') : 'chat') : 'send'} size={13} color="currentColor" />{g.name}</button>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', margin: '6px 2px 0', lineHeight: 1.4 }}>Group events still show on everyone’s calendar, and appear inside that group’s chat too.</div>
        </React.Fragment>
      ) : null}
      <div style={schLbl}>Cover image (optional)</div>
      {image ? (
        <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', marginBottom: 4, border: '1px solid var(--line)' }}>
          <img src={image} alt="" style={{ width: '100%', height: 130, objectFit: 'cover', display: 'block' }} />
          <button onClick={() => setImage('')} style={{ position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 999, border: 'none', background: 'rgba(20,15,10,.6)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={16} color="#fff" /></button>
        </div>
      ) : (
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 64, borderRadius: 12, border: '1.5px dashed var(--line)', background: 'var(--surface-2)', cursor: 'pointer', color: 'var(--ink-2)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13 }}>
          <Icon name="plus" size={18} color="var(--ink-3)" /> Add a photo
          <input type="file" accept="image/*" onChange={e => onImage(e.target.files && e.target.files[0])} style={{ display: 'none' }} />
        </label>
      )}
      <div style={schLbl}>Note (optional)</div>
      <textarea value={blurb} onChange={e => setBlurb(e.target.value)} rows={3} placeholder="A short description members will read." style={{ ...schFld, height: 'auto', padding: '11px 13px', lineHeight: 1.5, resize: 'vertical', fontFamily: 'var(--font-ui)' }} />
      <SchRepeatRow repeat={repeat} setRepeat={setRepeat} until={until} setUntil={setUntil} />
      <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
        <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12, fontSize: 14 }}>Cancel</button>
        <button onClick={save} disabled={!title.trim() || !date} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 12, fontSize: 14, opacity: (title.trim() && date) ? 1 : 0.55 }}><Icon name="calPlus" size={16} color="#fff" /> {repeat === 'none' ? 'Add event' : 'Add events'}</button>
      </div>
    </SchModal>
  );
}

function DashCalendar() {
  const narrow = (typeof useStewNarrow === 'function') ? useStewNarrow() : false;   // stack on phones
  const services = window.useStewardServices();
  const events = window.useStewardEvents();
  const rotas = window.useStewardRotas();
  const rosters = window.useStewardRosters();
  const teams = window.useStewardGroups().filter(g => g.kind === 'team');
  const rsvps = window.useStewardRsvps();              // { eventId: { memberPub: 'going'|'maybe'|'no' } }
  const members = window.useStewardMembers();
  const nameFor = (pub) => { const m = members.find(x => x.pubkey === pub); return (m && m.name) || 'Anonymous'; };
  const rsvpSummary = (eventId) => {
    const map = rsvps[eventId] || {}; const out = { going: [], maybe: [], no: [] };
    for (const pub in map) { if (out[map[pub]]) out[map[pub]].push(nameFor(pub)); }
    return out;
  };
  const today = new Date();
  const [view, setView] = useSch({ y: today.getFullYear(), m: today.getMonth() });
  const [pickedDay, setPickedDay] = useSch(null);
  const [adding, setAdding] = useSch(null);   // day string for new event, or '' for generic

  const coverageFor = (svcId) => {
    const rota = rotas.find(r => r.service === svcId); const assign = rota ? rota.assign : {};
    let total = 0, filled = 0;
    teams.forEach(t => { const r = rosters.find(x => x.team === t.id) || { roles: [] }; total += r.roles.length; r.roles.forEach(role => { if (assign[t.id + '::' + role.id] && assign[t.id + '::' + role.id].name) filled++; }); });
    return { total, filled, published: rota && rota.published };
  };
  const dayItems = (key) => ({
    services: services.filter(s => s.date === key),
    events: events.filter(e => e.date === key),
  });
  const first = new Date(view.y, view.m, 1);
  const startPad = first.getDay();
  const daysIn = new Date(view.y, view.m + 1, 0).getDate();
  const cells = []; for (let i = 0; i < startPad; i++) cells.push(null); for (let d = 1; d <= daysIn; d++) cells.push(d);
  const monKey = (d) => `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const upcoming = services.slice().filter(s => (s.date || '') >= schKey(today)).sort((a, b) => (a.date || '').localeCompare(b.date || '')).slice(0, 6);

  return (
    <div style={{ position: 'relative', height: narrow ? 'auto' : '100%', display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: 16 }}>
      <div style={{ flex: narrow ? 'none' : 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>{['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][view.m]} {view.y}</div>
          <button onClick={() => setView(v => ({ y: v.m === 0 ? v.y - 1 : v.y, m: v.m === 0 ? 11 : v.m - 1 }))} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', display: 'flex' }}><Icon name="chevL" size={16} /></button>
          <button onClick={() => setView(v => ({ y: v.m === 11 ? v.y + 1 : v.y, m: v.m === 11 ? 0 : v.m + 1 }))} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', display: 'flex' }}><Icon name="chevR" size={16} /></button>
          <div style={{ flex: 1 }} />
          <button onClick={() => setAdding('')} className="sk-btn sk-btn--ghost" style={{ padding: '8px 13px', fontSize: 13 }}><Icon name="calPlus" size={15} color="currentColor" /> New event</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5, marginBottom: 5, flexShrink: 0 }}>
          {SCH_DOW.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.4px' }}>{d.toUpperCase()}</div>)}
        </div>
        <div className="no-scrollbar" style={{ flex: narrow ? 'none' : 1, minHeight: 0, overflow: narrow ? 'visible' : 'auto', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: narrow ? 'minmax(52px, auto)' : 'minmax(74px, 1fr)', gap: 5 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const key = monKey(d); const it = dayItems(key); const isToday = key === schKey(today);
            const has = it.services.length || it.events.length;
            return (
              <button key={i} onClick={() => setPickedDay(key)} style={{ textAlign: 'left', padding: 7, borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden',
                border: pickedDay === key ? '2px solid var(--clay)' : '1px solid var(--line)', background: isToday ? 'color-mix(in oklab, var(--clay) 7%, var(--surface))' : 'var(--surface)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: isToday ? 'var(--clay)' : 'var(--ink-2)' }}>{d}</div>
                {it.services.map(s => { const c = coverageFor(s.id); return <div key={s.id} style={{ fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 6, background: 'color-mix(in oklab, var(--clay) 13%, var(--surface))', color: 'var(--clay-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 5, height: 5, borderRadius: 999, background: c.total && c.filled === c.total ? 'var(--sage)' : 'var(--gold)' }} />{s.name}</div>; })}
                {it.events.map(e => <div key={e.id} style={{ fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 6, background: `color-mix(in oklab, ${e.accent} 13%, var(--surface))`, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>)}
              </button>
            );
          })}
        </div>
      </div>

      {/* side panel: picked-day detail OR upcoming services */}
      <div style={{ width: narrow ? 'auto' : 300, flexShrink: 0, borderLeft: narrow ? 'none' : '1px solid var(--line)', borderTop: narrow ? '1px solid var(--line)' : 'none', paddingLeft: narrow ? 0 : 16, paddingTop: narrow ? 14 : 0, overflow: narrow ? 'visible' : 'auto' }} className="no-scrollbar">
        {pickedDay ? (() => {
          const it = dayItems(pickedDay); const p = schParts(pickedDay);
          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <SchDateBlock dateStr={pickedDay} />
                <div style={{ flex: 1 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{p.dow} {p.day} {p.mon}</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{it.services.length + it.events.length} on this day</div></div>
                <button onClick={() => setPickedDay(null)} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 7px', cursor: 'pointer', display: 'flex' }}><Icon name="x" size={14} /></button>
              </div>
              {it.services.map(s => { const c = coverageFor(s.id); return (
                <div key={s.id} style={{ padding: 12, borderRadius: 13, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', marginBottom: 9 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 7 }}>{s.time} · {c.filled}/{c.total} filled {c.published ? '· published' : ''}</div>
                  <div style={{ height: 6, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}><div style={{ width: `${c.total ? (c.filled / c.total) * 100 : 0}%`, height: '100%', background: c.total && c.filled === c.total ? 'var(--sage)' : 'var(--gold)' }} /></div>
                </div>
              ); })}
              {it.events.map(e => (
                <div key={e.id} style={{ padding: 12, borderRadius: 13, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', marginBottom: 9 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: e.accent }} /><div style={{ fontWeight: 700, fontSize: 14 }}>{e.title}</div></div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{e.time}{e.where ? ' · ' + e.where : ''}</div>
                  {e.blurb ? <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '7px 0 0' }}>{e.blurb}</p> : null}
                  {(() => {
                    const rs = rsvpSummary(e.id); const total = rs.going.length + rs.maybe.length + rs.no.length;
                    if (!total) return <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 7 }}>No RSVPs yet</div>;
                    return (
                      <div style={{ marginTop: 8, borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
                        <div style={{ display: 'flex', gap: 12, fontSize: 12, fontWeight: 700 }}>
                          <span style={{ color: 'var(--sage)' }}>{rs.going.length} going</span>
                          {rs.maybe.length ? <span style={{ color: '#8a6717' }}>{rs.maybe.length} maybe</span> : null}
                          {rs.no.length ? <span style={{ color: 'var(--ink-3)' }}>{rs.no.length} can’t</span> : null}
                        </div>
                        {rs.going.length ? <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.45 }}>{rs.going.slice(0, 8).join(', ')}{rs.going.length > 8 ? ` +${rs.going.length - 8}` : ''}</div> : null}
                      </div>
                    );
                  })()}
                  <button onClick={() => window.Steward.removeEvent(e.id)} style={{ border: 'none', background: 'none', color: 'var(--ink-3)', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 6, padding: 0 }}>Remove</button>
                </div>
              ))}
              {it.services.length + it.events.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 12 }}>Nothing on this day yet.</div> : null}
              <button onClick={() => setAdding(pickedDay)} className="sk-btn sk-btn--ghost" style={{ width: '100%', padding: 11, fontSize: 13.5 }}><Icon name="calPlus" size={15} color="currentColor" /> Add event on this day</button>
            </div>
          );
        })() : (
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, marginBottom: 12 }}>Upcoming services</div>
            {upcoming.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>No upcoming services. Add one on the Rota page.</div> : null}
            {upcoming.map(s => { const c = coverageFor(s.id); return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: 11, borderRadius: 13, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', marginBottom: 9 }}>
                <SchDateBlock dateStr={s.date} />
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</div><div style={{ fontSize: 12, color: c.total && c.filled === c.total ? 'var(--sage)' : '#8a6717', fontWeight: 600 }}>{c.filled}/{c.total} filled</div></div>
              </div>
            ); })}
          </div>
        )}
      </div>

      {adding !== null ? <SchEventModal day={adding} onClose={() => setAdding(null)} /> : null}
    </div>
  );
}
window.DashCalendar = DashCalendar;
