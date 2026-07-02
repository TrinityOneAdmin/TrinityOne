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
function RosterModal({ team, roster, members, onClose, onCreate }) {
  const [roles, setRoles] = useSch(() => (roster && roster.roles ? roster.roles.map(r => ({ ...r })) : []));
  const [people, setPeople] = useSch(() => (roster && roster.people ? roster.people.map(p => ({ ...p })) : []));
  const [pods, setPods] = useSch(() => (roster && roster.pods ? roster.pods.map(p => ({ ...p, fills: { ...(p.fills || {}) } })) : []));
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
    // don't add the same person twice — dedupe a linked member by pubkey, an unlinked one by name
    const dup = pub ? people.some(p => p.pub && p.pub === pub) : people.some(p => !p.pub && (p.name || '').trim().toLowerCase() === name.toLowerCase());
    if (dup) { setNewPerson(''); setLinkPub(''); return; }
    setPeople(p => [...p, { id: pid(), name, pub }]); setNewPerson(''); setLinkPub('');
  };
  const addPod = () => setPods(ps => [...ps, { id: 'pod' + Math.random().toString(36).slice(2, 7), name: 'Pod ' + String.fromCharCode(65 + ps.length), fills: {} }]);
  const setPodName = (id, name) => setPods(ps => ps.map(p => p.id === id ? { ...p, name } : p));
  const setPodFill = (id, roleId, pid) => setPods(ps => ps.map(p => p.id === id ? { ...p, fills: { ...p.fills, [roleId]: pid } } : p));
  const delPod = (id) => setPods(ps => ps.filter(p => p.id !== id));
  const save = async () => {
    let t = team;
    if (!t.id && onCreate) { t = await onCreate(); if (!t || !t.id) { onClose(); return; } }   // new team: create it only now, on Save
    window.Steward.publishRoster(t.id, { roles, people, pods }); onClose();
  };
  const m = teamMeta(team);
  return (
    <SchModal title={`${team.name} · roster`} onClose={onClose} width={520}>
      <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '6px 0 2px' }}>The roles this team fills each service, and the people who can be put on. Linking a person to a member lets them get reminders and accept on their phone.</p>
      <div style={schLbl}>Roles</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 9 }}>
        {roles.map(r => (
          <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 11px', borderRadius: 999, background: `color-mix(in oklab, ${m.accent} 12%, var(--surface))`, border: `1px solid color-mix(in oklab, ${m.accent} 26%, transparent)`, fontSize: 13, fontWeight: 700 }}>
            {r.name}<button onClick={() => setRoles(x => x.filter(y => y.id !== r.id))} title="Remove this role" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 0 }}><Icon name="x" size={13} /></button></span>
        ))}
        {roles.length === 0 ? <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>No roles yet.</span> : null}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={newRole} onChange={e => setNewRole(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addRole(); }} placeholder="Add a role — e.g. Sound" style={schFld} />
        <button onClick={addRole} title="Add this role to the team" className="sk-btn sk-btn--ghost" style={{ padding: '0 16px', flexShrink: 0 }}><Icon name="plus" size={15} color="currentColor" /></button>
      </div>
      <div style={schLbl}>People who can serve</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 9 }}>
        {people.map(pp => (
          <div key={pp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <div style={{ width: 30, height: 30, borderRadius: 999, flexShrink: 0, background: `linear-gradient(150deg, ${m.accent}, color-mix(in oklab, ${m.accent} 60%, #16120c))`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 11 }}>{(pp.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{pp.name}</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{pp.pub ? 'On the app · gets reminders' : 'Off-app'}</div></div>
            <button onClick={() => setPeople(x => x.filter(y => y.id !== pp.id))} title="Remove this person from the team" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 7px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="trash" size={14} /></button>
          </div>
        ))}
        {people.length === 0 ? <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>No one added yet.</span> : null}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
        <input value={newPerson} onChange={e => setNewPerson(e.target.value)} placeholder="Name" style={schFld} disabled={!!linkPub} />
        <select value={linkPub} onChange={e => setLinkPub(e.target.value)} style={schFld}>
          <option value="">…or link a member</option>
          {(members || []).filter(mm => !people.some(p => p.pub && p.pub === mm.pubkey)).map(mm => <option key={mm.pubkey} value={mm.pubkey}>{memDisplay(mm)}</option>)}
        </select>
        <button onClick={addPerson} title="Add this person to the team" className="sk-btn sk-btn--ghost" style={{ padding: '0 16px' }}><Icon name="plus" size={15} color="currentColor" /></button>
      </div>
      <div style={schLbl}>Serving pods <span style={{ fontWeight: 500, color: 'var(--ink-3)' }}>— a set of people who serve together; apply one to a service in a tap</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 9 }}>
        {pods.map(pod => (
          <div key={pod.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 11, background: 'var(--surface-2)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: roles.length ? 9 : 0 }}>
              <input value={pod.name} onChange={e => setPodName(pod.id, e.target.value)} style={{ ...schFld, fontWeight: 700 }} />
              <button onClick={() => delPod(pod.id)} title="Remove this pod" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '7px 9px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}><Icon name="trash" size={14} /></button>
            </div>
            {roles.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Add roles above first, then pick who fills each.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {roles.map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--ink-2)', width: 96, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                    <select value={pod.fills[r.id] || ''} onChange={e => setPodFill(pod.id, r.id, e.target.value)} style={{ ...schFld, flex: 1 }}>
                      <option value="">— unassigned —</option>
                      {people.map(pp => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {pods.length === 0 ? <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>No pods yet — make one to roster a group of people together.</span> : null}
      </div>
      <button onClick={addPod} className="sk-btn sk-btn--ghost" style={{ padding: '9px 14px', fontSize: 13 }}><Icon name="plus" size={15} color="currentColor" /> Add a pod</button>

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
            <button key={p.id} onClick={() => onAssign(p)} disabled={p.away} title={p.away ? 'Away — can’t be assigned right now' : 'Assign this person to the slot'} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: 11, borderRadius: 13, cursor: p.away ? 'not-allowed' : 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', opacity: p.away ? 0.6 : 1,
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
const rsFld = { boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 9, padding: '8px 10px', fontSize: 13.5, fontFamily: 'var(--font-ui)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none' };
function RunsheetModal({ service, sheet, onClose }) {
  const [items, setItems] = useSch(Array.isArray(sheet) && sheet.length ? sheet.map(x => ({ ...x })) : [{ title: '', time: '', who: '', ccli: '' }]);
  const set = (i, k, v) => setItems(prev => prev.map((it, j) => j === i ? { ...it, [k]: v } : it));
  const add = () => setItems(prev => [...prev, { title: '', time: '', who: '', ccli: '' }]);
  const del = (i) => setItems(prev => prev.filter((_, j) => j !== i));
  const move = (i, dir) => setItems(prev => { const a = prev.slice(); const j = i + dir; if (j < 0 || j >= a.length) return prev; const t = a[i]; a[i] = a[j]; a[j] = t; return a; });
  const save = () => { window.Steward.publishRunsheet(service.id, items.filter(it => (it.title || '').trim())); onClose(); };
  return (
    <SchModal title={'Run sheet · ' + (service.name || 'Service')} onClose={onClose} width={560}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 12px', lineHeight: 1.45 }}>The order of service — items, who's leading each, and songs (add a CCLI #). Anyone serving sees it from their “you’re serving” card.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: 9, borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 2 }}>
              <button onClick={() => move(i, -1)} disabled={i === 0} title="Move this item up" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 0, opacity: i === 0 ? 0.3 : 1 }}><Icon name="chevU" size={14} /></button>
              <button onClick={() => move(i, 1)} disabled={i === items.length - 1} title="Move this item down" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 0, opacity: i === items.length - 1 ? 0.3 : 1 }}><Icon name="chevD" size={14} /></button>
            </div>
            <input value={it.time || ''} onChange={e => set(i, 'time', e.target.value)} placeholder="time" style={{ ...rsFld, width: 64, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <input value={it.title || ''} onChange={e => set(i, 'title', e.target.value)} placeholder="Item (e.g. Welcome, Song, Sermon)" style={rsFld} />
              <div style={{ display: 'flex', gap: 5 }}>
                <input value={it.who || ''} onChange={e => set(i, 'who', e.target.value)} placeholder="Who's leading" style={{ ...rsFld, flex: 1, minWidth: 0 }} />
                <input value={it.ccli || ''} onChange={e => set(i, 'ccli', e.target.value)} placeholder="CCLI # (songs)" style={{ ...rsFld, width: 108, flexShrink: 0 }} />
              </div>
            </div>
            <button onClick={() => del(i)} title="Remove" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 4, flexShrink: 0 }}><Icon name="trash" size={15} /></button>
          </div>
        ))}
      </div>
      <button onClick={add} className="sk-btn sk-btn--ghost" style={{ marginTop: 10, padding: '8px 13px', fontSize: 13 }}><Icon name="plus" size={14} color="currentColor" /> Add item</button>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 11 }}>Cancel</button>
        <button onClick={save} className="sk-btn sk-btn--clay" style={{ flex: 2, padding: 11 }}>Save run sheet</button>
      </div>
    </SchModal>
  );
}
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
  const runsheets = (typeof window.useStewardRunsheets === 'function') ? window.useStewardRunsheets() : [];
  const [runsheetOpen, setRunsheetOpen] = useSch(false);

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
  // apply a serving pod: fill this team's role slots from the pod's saved role->person map, in one tap
  const applyPod = (team, pod) => {
    const r = rosterFor(team.id); const next = { ...assign };
    (r.roles || []).forEach(role => {
      const pid = pod.fills && pod.fills[role.id];
      const person = pid ? (r.people || []).find(p => p.id === pid) : null;
      if (person) next[team.id + '::' + role.id] = { id: person.id, name: person.name, pub: person.pub || '' };
    });
    setAssign(next); setFlash('Applied ' + pod.name); setTimeout(() => setFlash(''), 2000);
  };
  // rotate a team's pods round-robin across UPCOMING services (Pod A,B,C,A…) and publish each, so each
  // pod serves every Nth week automatically. Preserves other teams' assignments on those services.
  const rotatePods = (team) => {
    const r = rosterFor(team.id); const pods = r.pods || []; if (!pods.length) return 0;
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = (services || []).filter(s => (s.date || '') >= today).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    upcoming.forEach((s, i) => {
      const pod = pods[i % pods.length];
      const next = { ...(assignFor(s.id) || {}) };   // keep other teams' people
      (r.roles || []).forEach(role => {
        const pid = pod.fills && pod.fills[role.id];
        const person = pid ? (r.people || []).find(p => p.id === pid) : null;
        if (person) next[team.id + '::' + role.id] = { id: person.id, name: person.name, pub: person.pub || '' };
      });
      if (s.id === svcId) setAssign(next);
      window.Steward.publishRota({ service: s.id, published: true, assign: next });
      sendRequestsFor(s.id, s.date, s.time, s.name, next);
    });
    setFlash('Rotated ' + pods.length + ' pods across ' + upcoming.length + ' service' + (upcoming.length === 1 ? '' : 's'));
    setTimeout(() => setFlash(''), 2600);
    return upcoming.length;
  };
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
            <button key={s.id} onClick={() => setSel(s.id)} title="Show this service’s rota" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)', textAlign: 'left',
              border: on ? '2px solid var(--clay)' : '1px solid var(--line)', background: on ? 'color-mix(in oklab, var(--clay) 8%, var(--surface))' : 'var(--surface)' }}>
              <div style={{ textAlign: 'center', lineHeight: 1 }}><div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--clay)', textTransform: 'uppercase' }}>{p.dow}</div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17 }}>{p.day}</div></div>
              <div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.name}</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{p.mon} · {s.time}</div></div>
            </button>
          );
        })}
        <button onClick={() => setAdding(true)} title="Add a service to put people on" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 14, cursor: 'pointer', border: '1px dashed var(--line)', background: 'transparent', color: 'var(--ink-2)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13 }}><Icon name="plus" size={15} color="currentColor" /> Service</button>
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
              <button onClick={() => setFillMenu(v => !v)} title="Let the app suggest people to fill the empty roles" className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="sparkle" size={15} color="currentColor" /> Auto-fill <Icon name="chevD" size={13} color="currentColor" /></button>
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
            <button onClick={() => setRunsheetOpen(true)} title="Plan the order of service — items, who leads each, and songs" className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="note" size={15} color="currentColor" /> Run sheet</button>
            <button onClick={publish} className={isPublished ? 'sk-btn' : 'sk-btn sk-btn--clay'} style={{ padding: '9px 15px', fontSize: 13, background: isPublished ? 'var(--sage)' : undefined, color: '#fff' }}>
              <Icon name={isPublished ? 'check' : 'send'} size={15} color="#fff" /> {isPublished ? 'Published' : (pers && pers.published ? 'Publish changes' : 'Publish rota')}</button>
            </div>
          </div>
          {runsheetOpen ? <RunsheetModal service={svc} sheet={(runsheets.find(r => r.id === svc.id) || {}).items || []} onClose={() => setRunsheetOpen(false)} /> : null}

          {/* team cards */}
          <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflow: 'auto', marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, alignContent: 'start' }}>
            {teams.map(t => {
              const m = teamMeta(t); const r = rosterFor(t.id);
              const tFilled = r.roles.filter(role => assign[t.id + '::' + role.id] && assign[t.id + '::' + role.id].name).length;
              return (
                <div key={t.id} style={{ borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                  <div style={{ padding: '13px 15px', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 11, background: `color-mix(in oklab, ${m.accent} 16%, var(--surface))`, color: m.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={m.icon} size={19} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div><div style={{ fontSize: 11.5, color: r.roles.length && tFilled === r.roles.length ? 'var(--sage)' : 'var(--ink-3)', fontWeight: 600 }}>{tFilled}/{r.roles.length} filled</div></div>
                      <button onClick={() => setRosterTeam(t)} title="Manage roster" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 10px', cursor: 'pointer', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, flexShrink: 0 }}><Icon name="users" size={14} /> Roster</button>
                    </div>
                    {(r.pods && r.pods.length) ? (
                      <select value="" onChange={e => {
                        const v = e.target.value; e.target.value = '';
                        if (v === '__rotate__') { if (window.confirm('Rotate ' + r.pods.length + ' pods across all upcoming services for ' + m.name + '?\n\nEach pod serves every ' + r.pods.length + ' weeks. This publishes them and asks everyone assigned.')) rotatePods(t); }
                        else { const pod = (r.pods || []).find(p => p.id === v); if (pod) applyPod(t, pod); }
                      }} title="Apply a serving pod" style={{ width: '100%', boxSizing: 'border-box', marginTop: 10, border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '7px 9px', cursor: 'pointer', color: 'var(--clay)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, appearance: 'auto' }}>
                        <option value="">Apply a serving pod…</option>
                        {r.pods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        {r.pods.length > 1 ? <option value="__rotate__">↻ Rotate across upcoming weeks</option> : null}
                      </select>
                    ) : null}
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
                          <button key={role.id} onClick={() => setAssignSlot(slot)} title="Change who’s on this slot" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', border: `1px solid color-mix(in oklab, ${vm.bg} ${vm.line}%, var(--line))`, background: `color-mix(in oklab, ${vm.bg} ${vm.soft}%, var(--surface))` }}>
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
            {/* always-visible add-team card (the topbar button can scroll out of view) */}
            <button onClick={onNewTeam} style={{ minHeight: 96, borderRadius: 18, border: '1.5px dashed color-mix(in oklab, var(--clay) 45%, var(--line))', background: 'color-mix(in oklab, var(--clay) 5%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14 }}><Icon name="plus" size={17} color="currentColor" /> New team</button>
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
  const existingEvents = window.useStewardEvents ? window.useStewardEvents() : [];   // to gently warn on a same-time clash
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
  // gentle clash check (task 19): any existing event already at this exact date + time — informational, never blocks Save
  const clashes = React.useMemo(() => (date && time) ? (existingEvents || []).filter(e => e && e.date === date && e.time === time && (e.title || '').trim()) : [], [existingEvents, date, time]);
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
      {clashes.length ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9, padding: '9px 12px', borderRadius: 11, background: 'color-mix(in oklab, var(--gold) 12%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 30%, var(--line))', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.4 }}>
          <Icon name="bell" size={15} color="#8a6717" style={{ flexShrink: 0 }} />
          <span>This is at the same time as <b>{clashes[0].title}</b>{clashes.length > 1 ? ' and ' + (clashes.length - 1) + ' more' : ''} — just so you know.</span>
        </div>
      ) : null}
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
          <button onClick={() => setImage('')} title="Remove this photo" style={{ position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 999, border: 'none', background: 'rgba(20,15,10,.6)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={16} color="#fff" /></button>
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
  const bookings = (typeof window.useStewardBookings === 'function') ? window.useStewardBookings() : [];
  const rooms = (typeof window.useStewardRooms === 'function') ? window.useStewardRooms() : [];
  const roomName = (id) => { const r = rooms.find(x => x.id === id); return (r && r.name) || 'Room'; };
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
  const [showBookings, setShowBookings] = useSch(true);   // room bookings layer on the calendar
  const [evDetail, setEvDetail] = useSch(null);   // a tapped event → full details (with all RSVP names)

  const coverageFor = (svcId) => {
    const rota = rotas.find(r => r.service === svcId); const assign = rota ? rota.assign : {};
    let total = 0, filled = 0;
    teams.forEach(t => { const r = rosters.find(x => x.team === t.id) || { roles: [] }; total += r.roles.length; r.roles.forEach(role => { if (assign[t.id + '::' + role.id] && assign[t.id + '::' + role.id].name) filled++; }); });
    return { total, filled, published: rota && rota.published };
  };
  const dayItems = (key) => ({
    services: services.filter(s => s.date === key),
    events: events.filter(e => e.date === key),
    bookings: showBookings ? bookings.filter(b => b.date === key).sort((a, b) => (a.start || '').localeCompare(b.start || '')) : [],
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
          <button onClick={() => setView(v => ({ y: v.m === 0 ? v.y - 1 : v.y, m: v.m === 0 ? 11 : v.m - 1 }))} title="Previous month" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', display: 'flex' }}><Icon name="chevL" size={16} /></button>
          <button onClick={() => setView(v => ({ y: v.m === 11 ? v.y + 1 : v.y, m: v.m === 11 ? 0 : v.m + 1 }))} title="Next month" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', display: 'flex' }}><Icon name="chevR" size={16} /></button>
          <div style={{ flex: 1 }} />
          {rooms.length ? <button onClick={() => setShowBookings(v => !v)} title="Show room bookings on the calendar" className="sk-btn sk-btn--ghost" style={{ padding: '8px 11px', fontSize: 12.5, opacity: showBookings ? 1 : 0.55 }}><Icon name="marker" size={14} color="currentColor" /> {showBookings ? 'Rooms on' : 'Rooms off'}</button> : null}
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
              <button key={i} onClick={() => setPickedDay(key)} title="See what’s on this day" style={{ textAlign: 'left', padding: 7, borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden',
                border: pickedDay === key ? '2px solid var(--clay)' : '1px solid var(--line)', background: isToday ? 'color-mix(in oklab, var(--clay) 7%, var(--surface))' : 'var(--surface)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: isToday ? 'var(--clay)' : 'var(--ink-2)' }}>{d}</div>
                {it.services.map(s => { const c = coverageFor(s.id); return <div key={s.id} style={{ fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 6, background: 'color-mix(in oklab, var(--clay) 13%, var(--surface))', color: 'var(--clay-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 5, height: 5, borderRadius: 999, background: c.total && c.filled === c.total ? 'var(--sage)' : 'var(--gold)' }} />{s.name}</div>; })}
                {it.events.map(e => <div key={e.id} style={{ fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 6, background: `color-mix(in oklab, ${e.accent} 13%, var(--surface))`, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>)}
                {it.bookings.map(b => <div key={b.id} title={(b.title || 'Booking') + ' · ' + roomName(b.roomId) + (b.start ? ' · ' + b.start + (b.end ? '–' + b.end : '') : '')} style={{ fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 6, background: 'color-mix(in oklab, var(--sage) 14%, var(--surface))', color: '#345c41', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="marker" size={9} color="#345c41" />{b.start ? b.start + ' ' : ''}{roomName(b.roomId)}</div>)}
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
                <div style={{ flex: 1 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{p.dow} {p.day} {p.mon}</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{it.services.length + it.events.length + it.bookings.length} on this day</div></div>
                <button onClick={() => setPickedDay(null)} title="Close this day" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 7px', cursor: 'pointer', display: 'flex' }}><Icon name="x" size={14} /></button>
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
                  <div onClick={() => setEvDetail(e)} title="Full details & all RSVPs" style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}><span style={{ width: 8, height: 8, borderRadius: 999, background: e.accent }} /><div style={{ fontWeight: 700, fontSize: 14 }}>{e.title}</div><Icon name="chevR" size={14} color="var(--ink-3)" style={{ marginLeft: 'auto' }} /></div>
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
              {it.bookings.map(b => (
                <div key={b.id} style={{ padding: 12, borderRadius: 13, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', marginBottom: 9 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="marker" size={14} color="var(--sage)" /><div style={{ fontWeight: 700, fontSize: 14 }}>{b.title || 'Room booking'}</div></div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{roomName(b.roomId)}{(b.start || b.end) ? ' · ' + (b.start || '') + (b.end ? '–' + b.end : '') : ''}{b.note ? ' · ' + b.note : ''}</div>
                </div>
              ))}
              {it.services.length + it.events.length + it.bookings.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 12 }}>Nothing on this day yet.</div> : null}
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
      {evDetail ? <SchEventDetail event={evDetail} onClose={() => setEvDetail(null)} /> : null}
    </div>
  );
}
window.DashCalendar = DashCalendar;

// Full event details, openable from anywhere an event is tapped in the console (calendar, group chat).
// Shows the date/time/place/blurb plus the RSVP breakdown (with names) and a Remove action.
function SchEventDetail({ event, onClose }) {
  const e = event || {};
  const rsvps = window.useStewardRsvps ? window.useStewardRsvps() : {};
  const members = window.useStewardMembers ? window.useStewardMembers() : [];
  const nameFor = (pub) => { const m = members.find(x => x.pubkey === pub); return (m && m.name) || 'Anonymous'; };
  const map = rsvps[e.id] || {}; const rs = { going: [], maybe: [], no: [] };
  for (const pub in map) { if (rs[map[pub]]) rs[map[pub]].push(nameFor(pub)); }
  const total = rs.going.length + rs.maybe.length + rs.no.length;
  const seg = (list, label, color) => list.length ? (
    <div style={{ marginTop: 9 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color }}>{list.length} {label}</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 3, lineHeight: 1.5 }}>{list.join(', ')}</div>
    </div>
  ) : null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 26, background: 'color-mix(in oklab, var(--ink) 34%, transparent)', backdropFilter: 'blur(3px)', animation: 'lumenFade .18s ease both' }}>
      <div onClick={ev => ev.stopPropagation()} style={{ width: 440, maxWidth: '100%', maxHeight: '90%', display: 'flex', flexDirection: 'column', borderRadius: 22, background: 'var(--paper)', border: '1px solid var(--line)', boxShadow: '0 24px 70px rgba(0,0,0,.28)', overflow: 'hidden', animation: 'lumenScale .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 4px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink-3)' }}>Event</div>
          <button onClick={onClose} title="Close" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '5px 7px', cursor: 'pointer', display: 'flex' }}><Icon name="x" size={14} /></button>
        </div>
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 22px 20px' }}>
          {e.image ? <img src={e.image} alt="" style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 14, display: 'block', marginBottom: 14 }} /> : null}
          <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
            <SchDateBlock dateStr={e.date} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>{e.accent ? <span style={{ width: 8, height: 8, borderRadius: 999, background: e.accent, flexShrink: 0 }} /> : null}<div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, lineHeight: 1.12 }}>{e.title || 'Event'}</div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-3)', fontWeight: 600, marginTop: 5, flexWrap: 'wrap' }}>
                {e.time ? <React.Fragment><Icon name="clock" size={13} color="var(--ink-3)" /> {e.time}</React.Fragment> : null}
                {e.where ? <React.Fragment>{e.time ? <span style={{ opacity: .5 }}>·</span> : null}<Icon name="marker" size={13} color="var(--ink-3)" /> {e.where}</React.Fragment> : null}
              </div>
            </div>
          </div>
          {e.blurb ? <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--ink-2)', margin: '14px 0 0' }}>{e.blurb}</p> : null}
          <div style={{ marginTop: 16, borderTop: '1px solid var(--line-2)', paddingTop: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Who’s coming</div>
            {total ? <React.Fragment>{seg(rs.going, 'going', 'var(--sage)')}{seg(rs.maybe, 'maybe', '#8a6717')}{seg(rs.no, 'can’t make it', 'var(--ink-3)')}</React.Fragment> : <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 6 }}>No RSVPs yet.</div>}
          </div>
        </div>
        <div style={{ padding: '12px 22px 18px', borderTop: '1px solid var(--line)' }}>
          <button onClick={() => { if (window.confirm('Remove this event for everyone?')) { window.Steward.removeEvent(e.id); onClose(); } }} className="sk-btn sk-btn--ghost" style={{ width: '100%', padding: 11, fontSize: 13.5, color: 'var(--clay-ink)' }}><Icon name="trash" size={15} color="currentColor" /> Remove event</button>
        </div>
      </div>
    </div>
  );
}
window.SchEventDetail = SchEventDetail;

// ════ Rooms: a shared room calendar (steward-booked, with double-booking detection) ════
const roomFld = { width: '100%', boxSizing: 'border-box', height: 44, padding: '0 13px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 14.5, color: 'var(--ink)', fontFamily: 'var(--font-ui)' };
const roomLbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 6px' };
const bkOverlap = (a, b) => a.roomId === b.roomId && a.date === b.date && a.start && a.end && b.start && b.end && a.start < b.end && b.start < a.end;
const prettyDate = (iso) => { try { return new Date(iso + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return iso; } };

function DashRooms() {
  const rooms = window.useStewardRooms ? window.useStewardRooms() : [];
  const bookings = window.useStewardBookings ? window.useStewardBookings() : [];
  const [newRoom, setNewRoom] = React.useState('');
  const [bkModal, setBkModal] = React.useState(null);
  const [showPast, setShowPast] = React.useState(false);
  const roomById = Object.fromEntries(rooms.map(r => [r.id, r]));
  const today = new Date().toISOString().slice(0, 10);
  const addRoom = () => { const n = newRoom.trim(); if (n) { window.Steward.publishRoom({ name: n }); setNewRoom(''); } };
  const sorted = [...bookings].filter(b => b.roomId && b.date).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.start || '').localeCompare(b.start || ''));
  const upcoming = sorted.filter(b => b.date >= today);
  const past = sorted.filter(b => b.date < today);
  const list = showPast ? sorted : upcoming;
  // group by date
  const byDate = {}; list.forEach(b => { (byDate[b.date] = byDate[b.date] || []).push(b); });

  return (
    <Panel title="Rooms" action={
      <button onClick={() => setBkModal({})} disabled={!rooms.length} className="sk-btn sk-btn--clay" style={{ padding: '7px 12px', fontSize: 12.5, opacity: rooms.length ? 1 : 0.5 }}><Icon name="plus" size={14} color="#fff" /> Book a room</button>
    } style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      <div style={{ display: 'flex', gap: 9, padding: '10px 12px', borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 8%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 22%, var(--line))', marginBottom: 14 }}>
        <Icon name="marker" size={16} color="var(--sage)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>Your church's bookable spaces and who's using them when. Booking warns you of a <b>clash</b> so the hall is never double-booked.</div>
      </div>

      <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--ink-3)', marginBottom: 8 }}>Spaces</div>
      <div style={{ display: 'flex', gap: 9, marginBottom: 10 }}>
        <input value={newRoom} onChange={e => setNewRoom(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addRoom(); }} placeholder="Add a room — e.g. Main Hall, Room 2, Kitchen" style={roomFld} />
        <button onClick={addRoom} className="sk-btn sk-btn--clay" style={{ padding: '0 15px', fontSize: 13 }}>Add</button>
      </div>
      {rooms.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>
          {rooms.map(r => (
            <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--line)', fontSize: 13, fontWeight: 700 }}>
              <Icon name="marker" size={13} color="var(--sage)" /> {r.name}
              <button onClick={() => { if (confirm('Remove “' + r.name + '”? Its bookings stay but show as an unknown room.')) window.Steward.removeRoom(r.id); }} title="Remove room" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 0, marginLeft: 2 }}><Icon name="x" size={13} color="currentColor" /></button>
            </span>
          ))}
        </div>
      ) : <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 16 }}>No rooms yet — add your spaces, then book them.</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--ink-3)' }}>Bookings</div>
        {past.length ? <button onClick={() => setShowPast(s => !s)} className="sk-btn sk-btn--ghost" style={{ padding: '4px 9px', fontSize: 11.5, marginLeft: 'auto' }}>{showPast ? 'Hide past' : 'Show past · ' + past.length}</button> : null}
      </div>
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Object.keys(byDate).length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '36px 24px' }}>
            <Icon name="calendar" size={26} color="var(--ink-3)" />
            <p style={{ fontSize: 13.5, margin: '10px 0 0' }}>{rooms.length ? 'No bookings yet — tap “Book a room”.' : 'Add a room first, then book it.'}</p>
          </div>
        ) : Object.keys(byDate).map(d => (
          <div key={d}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: d < today ? 'var(--ink-3)' : 'var(--ink)', marginBottom: 7 }}>{prettyDate(d)}{d === today ? ' · today' : ''}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {byDate[d].map(b => (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                  <div style={{ width: 96, flexShrink: 0, fontWeight: 700, fontSize: 13.5 }}>{b.start || '—'}{b.end ? '–' + b.end : ''}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title || 'Booking'}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}><Icon name="marker" size={11} color="var(--ink-3)" /> {(roomById[b.roomId] && roomById[b.roomId].name) || 'Unknown room'}{b.note ? ' · ' + b.note : ''}</div>
                  </div>
                  <button onClick={() => setBkModal(b)} title="Edit" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}><Icon name="pen" size={14} color="currentColor" /></button>
                  <button onClick={() => window.Steward.removeBooking(b.id)} title="Delete" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}><Icon name="trash" size={14} color="currentColor" /></button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {bkModal ? <RoomBookingModal bk={bkModal} rooms={rooms} bookings={bookings} onClose={() => setBkModal(null)} /> : null}
    </Panel>
  );
}
window.DashRooms = DashRooms;

function RoomBookingModal({ bk, rooms, bookings, onClose }) {
  const [roomId, setRoomId] = React.useState(bk.roomId || (rooms[0] && rooms[0].id) || '');
  const [date, setDate] = React.useState(bk.date || new Date().toISOString().slice(0, 10));
  const [start, setStart] = React.useState(bk.start || '10:00');
  const [end, setEnd] = React.useState(bk.end || '11:00');
  const [title, setTitle] = React.useState(bk.title || '');
  const [note, setNote] = React.useState(bk.note || '');
  const roomById = Object.fromEntries(rooms.map(r => [r.id, r]));
  const cand = { roomId, date, start, end };
  const clashes = (bookings || []).filter(x => x.id !== bk.id && bkOverlap(cand, x));
  const badTime = !!(start && end && end <= start);
  const canSave = roomId && date && start && end && !badTime && !clashes.length && title.trim();
  const save = () => { if (!canSave) return; window.Steward.publishBooking({ id: bk.id, roomId, date, start, end, title, note }); onClose(); };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 26, background: 'color-mix(in oklab, var(--ink) 32%, transparent)', backdropFilter: 'blur(3px)', animation: 'lumenFade .18s ease both' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: '100%', maxHeight: '90%', display: 'flex', flexDirection: 'column', borderRadius: 22, background: 'var(--paper)', border: '1px solid var(--line)', boxShadow: '0 24px 70px rgba(0,0,0,.28)', overflow: 'hidden', animation: 'lumenScale .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div style={{ padding: '20px 24px 6px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19 }}>{bk.id ? 'Edit booking' : 'Book a room'}</div>
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 24px' }}>
          <div style={roomLbl}>ROOM</div>
          <select value={roomId} onChange={e => setRoomId(e.target.value)} style={{ ...roomFld, appearance: 'auto', marginBottom: 12 }}>{rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          <div style={roomLbl}>WHAT FOR</div>
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Youth group, Wedding rehearsal" style={{ ...roomFld, marginBottom: 12 }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1.2 }}><div style={roomLbl}>DATE</div><input type="date" value={date} onChange={e => setDate(e.target.value)} style={roomFld} /></div>
            <div style={{ flex: 1 }}><div style={roomLbl}>FROM</div><input type="time" value={start} onChange={e => setStart(e.target.value)} style={roomFld} /></div>
            <div style={{ flex: 1 }}><div style={roomLbl}>TO</div><input type="time" value={end} onChange={e => setEnd(e.target.value)} style={roomFld} /></div>
          </div>
          {badTime ? <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', marginTop: 10 }}>The end time needs to be after the start time.</div> : null}
          {clashes.length ? (
            <div style={{ display: 'flex', gap: 9, padding: '11px 12px', borderRadius: 11, background: 'color-mix(in oklab, var(--clay) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 28%, var(--line))', marginTop: 12 }}>
              <Icon name="shield" size={15} color="var(--clay)" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45 }}><b>{(roomById[roomId] || {}).name || 'That room'} is already booked then</b> — {clashes.map(c => (c.title || 'a booking') + ' ' + c.start + '–' + c.end).join('; ')}. Pick another time or room.</div>
            </div>
          ) : null}
          <div style={{ marginTop: 12 }}><div style={roomLbl}>NOTE (OPTIONAL)</div><input value={note} onChange={e => setNote(e.target.value)} placeholder="optional" style={roomFld} /></div>
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '14px 24px 20px' }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12 }}>Cancel</button>
          <button onClick={save} disabled={!canSave} className="sk-btn sk-btn--clay" style={{ flex: 2, padding: 12, opacity: canSave ? 1 : 0.5 }}>{bk.id ? 'Save' : 'Book it'}</button>
        </div>
      </div>
    </div>
  );
}
