// screens-today.jsx — the home / "Today" dashboard
const { useState: useStateT, useEffect: useEffectT } = React;

function ScreenScroll({ children, top = 56, bottom = 96, style = {} }) {
  const tp = typeof top === 'number' ? top + 'px' : top;   // allow a CSS string (e.g. a safe-area calc)
  return (
    <div className="no-scrollbar" style={{
      position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden',
      padding: `${tp} 18px ${bottom}px`, ...style,
    }}>{children}</div>
  );
}

function ProgressRing({ value, size = 46, stroke = 4, color = 'var(--clay)' }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={c * (1 - value)} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset .6s ease' }} />
    </svg>
  );
}

// ── Care / Meal trains: open needs the member can sign up to help with (Today card) ──
const CARE_TYPE_LABEL = { meals: 'Meals', rides: 'Rides', moving: 'Moving', errands: 'Errands', diy: 'DIY', visits: 'Visits', childcare: 'Childcare' };
const CARE_TYPE_ICON = { meals: 'gift', rides: 'calCheck', moving: 'users', errands: 'check', diy: 'hand', visits: 'heart', childcare: 'child' };
function careDateRange(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '')) return [];
  const s = new Date(start + 'T00:00:00');
  const e = /^\d{4}-\d{2}-\d{2}$/.test(end || '') ? new Date(end + 'T00:00:00') : s;
  if (isNaN(s) || isNaN(e) || e < s) return [];
  const out = [];
  for (const d = new Date(s); d <= e && out.length < 90; d.setDate(d.getDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
function careFmtDate(iso) { try { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); } catch { return iso; } }
function careName(pub, myPub) {
  if (pub && myPub && pub.toLowerCase() === myPub.toLowerCase()) return 'You';
  try { const d = window.Fellowship && window.Fellowship.displayFor && window.Fellowship.displayFor(pub); if (d && (d.name || d.handle)) return d.name || d.handle; } catch {}
  return 'A member';
}

function CareNeedRow({ need, slots, skips, care, canManage, expanded, onToggle }) {
  const myPub = care.myPub || '';
  const dates = (Array.isArray(need.dates) && need.dates.length) ? [...need.dates].sort() : careDateRange(need.startDate, need.endDate);
  const skipSet = new Set(skips.filter(k => k.needId === need.id).map(k => k.isoDate));
  const fillsFor = (iso) => slots.filter(s => s.needId === need.id && s.isoDate === iso);
  const isRecipient = !!need.recipient && need.recipient === myPub.toLowerCase();
  const openDays = dates.filter(d => !skipSet.has(d) && fillsFor(d).length === 0);
  const filledDays = dates.filter(d => fillsFor(d).length > 0).length;
  const accent = 'var(--sage)';
  // per-day meals (meals tasks): the day's override, else the need default
  const MEAL_SHORT = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
  const mealsFor = (iso) => (need.type === 'meals') ? ((need.dayMeals && need.dayMeals[iso] && need.dayMeals[iso].length) ? need.dayMeals[iso] : (Array.isArray(need.meals) ? need.meals : [])) : [];
  // "what I'm bringing" — editable note on the helper's own slot (so two people don't bring the same dish)
  const [noteDraft, setNoteDraft] = React.useState({});
  const [savedFlash, setSavedFlash] = React.useState({});
  const myNoteFor = (iso) => { const f = fillsFor(iso).find(x => x.pubkey && x.pubkey.toLowerCase() === myPub.toLowerCase()); return f ? (f.note || '') : ''; };
  const saveNote = (iso) => { const cur = noteDraft[iso] !== undefined ? noteDraft[iso] : myNoteFor(iso); (care.setNote || care.fill)(need.id, iso, (cur || '').trim()); setSavedFlash(f => ({ ...f, [iso]: true })); };
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', background: 'var(--surface)' }}>
      <button onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 13px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, var(--sage) 15%, var(--surface))', color: accent }}><Icon name={CARE_TYPE_ICON[need.type] || 'heart'} size={19} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--ink)' }}>{need.displayLabel || 'A member in our church'}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 1 }}>{CARE_TYPE_LABEL[need.type] || 'Care'} · {openDays.length > 0 ? openDays.length + ' day' + (openDays.length === 1 ? '' : 's') + ' still open' : 'all covered'}</div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: openDays.length === 0 ? accent : 'var(--ink-3)' }}>{filledDays}/{dates.length}</div>
        <Icon name={expanded ? 'chevD' : 'chevR'} size={16} color="var(--ink-3)" />
      </button>
      {expanded && (
        <div style={{ borderTop: '1px solid var(--line)', padding: '6px 13px 12px' }}>
          {need.notes ? <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, padding: '8px 0 4px', whiteSpace: 'pre-wrap' }}>{need.notes}</div> : null}
          {need.dietary && need.dietary.length ? (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', padding: '6px 0 2px' }}>
              {need.dietary.map(d => <span key={d} style={{ fontSize: 11, fontWeight: 700, color: 'var(--sage)', background: 'color-mix(in oklab, var(--sage) 13%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 30%, transparent)', borderRadius: 999, padding: '3px 9px' }}>{d}</span>)}
            </div>
          ) : null}
          {dates.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)', padding: '8px 0' }}>No dates set yet.</div> : dates.map(iso => {
            const skipped = skipSet.has(iso);
            const fills = fillsFor(iso);
            const mineFilled = fills.some(f => f.pubkey && f.pubkey.toLowerCase() === myPub.toLowerCase());
            const dayMeals = mealsFor(iso);
            return (
              <div key={iso} style={{ borderTop: '1px solid color-mix(in oklab, var(--line) 60%, transparent)', opacity: skipped ? 0.55 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                  <div style={{ minWidth: 96 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', textDecoration: skipped ? 'line-through' : 'none' }}>{careFmtDate(iso)}</div>
                    {dayMeals.length ? <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 600 }}>{dayMeals.map(m => MEAL_SHORT[m]).join(' · ')}</div> : null}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>
                    {skipped ? <span>{mineFilled ? 'They’re covered — no need, thanks 🙏' : 'Not needed this day'}</span>
                      : fills.length ? fills.map((f, i) => <span key={i} style={{ marginRight: 8 }}><Icon name="check" size={11} color="var(--sage)" /> {careName(f.pubkey, myPub)}{f.note ? ' — ' + f.note : ''}</span>)
                      : <span style={{ color: 'var(--ink-3)' }}>Open</span>}
                  </div>
                  {!skipped && !isRecipient && (mineFilled
                    ? <button onClick={() => care.clearFill(need.id, iso)} style={careBtnMine} title="You’re signed up — tap to cancel"><Icon name="check" size={12} color="var(--sage)" stroke={3} /> You’re helping</button>
                    : <button onClick={() => care.fill(need.id, iso)} style={careBtnHelp}>I’ll help</button>)}
                  {(isRecipient || (canManage && fills.length === 0)) && (skipped
                    ? <button onClick={() => care.clearSkip(need.id, iso)} style={careBtnGhost}>Undo</button>
                    : <button onClick={() => care.skip(need.id, iso)} style={isRecipient ? careBtnHelp : careBtnGhost}>{isRecipient ? (fills.length ? 'Thanks — I’m covered' : 'I’m covered') : 'Skip'}</button>)}
                </div>
                {mineFilled && !skipped && need.type === 'meals' ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '0 0 7px' }}>
                    <input value={noteDraft[iso] !== undefined ? noteDraft[iso] : myNoteFor(iso)} onChange={e => { const v = e.target.value; setNoteDraft(nd => ({ ...nd, [iso]: v })); setSavedFlash(f => ({ ...f, [iso]: false })); }} onBlur={() => saveNote(iso)} onKeyDown={e => { if (e.key === 'Enter') { saveNote(iso); e.currentTarget.blur(); } }} placeholder="What are you bringing?" style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '7px 10px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 12.5, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }} />
                    <button onClick={() => saveNote(iso)} style={{ flexShrink: 0, padding: '7px 13px', borderRadius: 9, border: 'none', background: savedFlash[iso] ? 'color-mix(in oklab, var(--sage) 20%, var(--surface))' : 'var(--clay)', color: savedFlash[iso] ? 'var(--sage)' : '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap' }}>{savedFlash[iso] ? '✓ Saved' : 'Save'}</button>
                  </div>
                ) : null}
              </div>
            );
          })}
          {(isRecipient || canManage) ? <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.45 }}>{isRecipient ? <React.Fragment>This is for you. Tap <b>I’m covered</b> on any day you don’t need help</React.Fragment> : <React.Fragment>Care team: tap <b>Skip</b> on any day they’re already covered (e.g. if they’re not on the app)</React.Fragment>} — it comes off the list.</div> : null}
        </div>
      )}
    </div>
  );
}
const careBtnHelp = { flexShrink: 0, padding: '6px 11px', borderRadius: 9, border: 'none', background: 'var(--sage)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-ui)' };
const careBtnGhost = { flexShrink: 0, padding: '6px 10px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-ui)' };
const careBtnMine = { flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 9, border: '1px solid var(--sage)', background: 'color-mix(in oklab, var(--sage) 15%, var(--surface))', color: 'var(--sage)', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-ui)' };

// ── "I'm here to help" availability — a member signals they're glad to help, so anyone who needs
// something is encouraged to ask. Shown only inside the Care tab (embedded).
const CARE_OFFER_TAGS = [['meals', 'Meals'], ['rides', 'Rides'], ['moving', 'Moving'], ['childcare', 'Childcare'], ['diy', 'DIY'], ['visits', 'Visits'], ['prayer', 'Prayer'], ['errands', 'Errands']];
function careOfferLabel(id) { const t = CARE_OFFER_TAGS.find(x => x[0] === id); return t ? t[1] : id; }

function CareAvailRow({ a, ctx, myPub }) {
  const nm = careName(a.pubkey, myPub);
  const canDM = !!(a.pubkey && ctx.openDM && (!ctx.canDMPeer || ctx.canDMPeer(a.pubkey)));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderTop: '1px solid color-mix(in oklab, var(--line) 60%, transparent)' }}>
      <div style={{ width: 34, height: 34, borderRadius: 999, flexShrink: 0, background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>{(nm[0] || '?').toUpperCase()}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{nm}</div>
        {a.tags && a.tags.length ? <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>{a.tags.map(t => <span key={t} style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--sage)', background: 'color-mix(in oklab, var(--sage) 13%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 28%, transparent)', borderRadius: 999, padding: '2px 8px' }}>{careOfferLabel(t)}</span>)}</div> : null}
        {a.note ? <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45, marginTop: 4, whiteSpace: 'pre-wrap' }}>{a.note}</div> : null}
      </div>
      {canDM ? <button onClick={() => ctx.openDM(a.pubkey)} style={careBtnHelp}>Message</button> : null}
    </div>
  );
}

function CareAvailability({ ctx }) {
  const care = ctx.care || {};
  const myPub = (care.myPub || '').toLowerCase();
  const avail = care.avail || [];
  const mine = avail.find(a => (a.pubkey || '').toLowerCase() === myPub) || null;
  const others = avail.filter(a => (a.pubkey || '').toLowerCase() !== myPub);
  const isMinor = !!(ctx.safeguard && ctx.safeguard.isMinor);
  const churchPub = (window.Fellowship && window.Fellowship.churchPub) || '';
  const [editing, setEditing] = React.useState(false);
  const [tags, setTags] = React.useState(() => (mine && mine.tags) || []);
  const [note, setNote] = React.useState(() => (mine && mine.note) || '');
  const [opt, setOpt] = React.useState(null);   // optimistic listed-state; null = follow the relay
  const listed = opt === null ? !!mine : opt;
  // keep the draft in step with my published availability when I'm not editing; drop the optimistic override once the relay agrees
  React.useEffect(() => { if (!editing) { setTags((mine && mine.tags) || []); setNote((mine && mine.note) || ''); } if (opt !== null && !!mine === opt) setOpt(null); }, [mine ? mine.ts : 0, editing]);
  const toggleTag = (id) => setTags(t => t.includes(id) ? t.filter(x => x !== id) : [...t, id]);
  const [custom, setCustom] = React.useState('');
  const addCustom = () => { const v = custom.trim().slice(0, 24); if (v && !tags.includes(v)) setTags(t => [...t, v]); setCustom(''); };
  const save = () => { if (care.setAvail) care.setAvail(tags, note); setOpt(true); setEditing(false); };
  const turnOff = () => { if (care.clearAvail) care.clearAvail(); setOpt(false); setEditing(false); setTags([]); setNote(''); };
  const showTags = (mine && mine.tags && mine.tags.length) ? mine.tags : tags;
  const box = { padding: 14, borderRadius: 18, background: 'color-mix(in oklab, var(--gold) 8%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 26%, var(--line))', marginBottom: 14 };
  const chipStyle = (on) => ({ padding: '6px 12px', borderRadius: 999, border: '1px solid ' + (on ? 'var(--sage)' : 'var(--line)'), background: on ? 'color-mix(in oklab, var(--sage) 16%, var(--surface))' : 'var(--surface)', color: on ? 'var(--sage)' : 'var(--ink-2)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' });
  return (
    <div>
      {others.length ? (
        <div style={{ padding: 14, borderRadius: 18, background: 'color-mix(in oklab, var(--sage) 7%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 26%, var(--line))', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><Icon name="heart" size={16} color="var(--sage)" /><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5, color: 'var(--ink)' }}>Ready to help</div></div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>You don’t have to carry things alone. These friends have said they’re glad to help — reach out to one of them, or ask the care team.</div>
          {others.map(a => <CareAvailRow key={a.pubkey} a={a} ctx={ctx} myPub={myPub} />)}
        </div>
      ) : null}
      {churchPub ? (
        <div style={{ marginBottom: 14 }}>
          {others.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 8 }}>Need a hand with something? Your care team is here — just ask.</div> : null}
          <button onClick={() => ctx.openDM(churchPub)} style={{ ...careBtnGhost, width: '100%', justifyContent: 'center', padding: '10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="chat" size={13} /> Ask the care team</button>
        </div>
      ) : null}
      {!isMinor ? (
        <div style={box}>
          {listed && !editing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 150 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="check" size={14} color="var(--sage)" stroke={3} /> You’re ready to help</div>
                {showTags && showTags.length ? <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2 }}>{showTags.map(careOfferLabel).join(' · ')}</div> : null}
              </div>
              <button onClick={() => setEditing(true)} style={careBtnGhost}>Edit</button>
              <button onClick={turnOff} style={careBtnGhost}>Take a break</button>
            </div>
          ) : editing ? (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>What can you help with?</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>{CARE_OFFER_TAGS.map(([id, label]) => <button key={id} onClick={() => toggleTag(id)} style={chipStyle(tags.includes(id))}>{label}</button>)}</div>
              {tags.filter(t => !CARE_OFFER_TAGS.some(([id]) => id === t)).length ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>{tags.filter(t => !CARE_OFFER_TAGS.some(([id]) => id === t)).map(t => <button key={t} onClick={() => toggleTag(t)} style={chipStyle(true)} title="Remove">{t} ✕</button>)}</div>
              ) : null}
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <input value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} placeholder="Add your own…" maxLength={24} style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '7px 12px', borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 12.5, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }} />
                <button onClick={addCustom} disabled={!custom.trim()} style={{ ...chipStyle(false), opacity: custom.trim() ? 1 : 0.5 }}>Add</button>
              </div>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Anything to add? e.g. “Weekday evenings are easiest for me”" style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--font-ui)', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={save} style={{ ...careBtnHelp, padding: '9px 16px', fontSize: 13 }}>{listed ? 'Save' : 'I’m available'}</button>
                <button onClick={() => { setEditing(false); setTags((mine && mine.tags) || []); setNote((mine && mine.note) || ''); }} style={{ ...careBtnGhost, padding: '9px 14px', fontSize: 13 }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Willing to lend a hand?</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 2, lineHeight: 1.45 }}>Let your church know you’re here — it makes it easier for someone to ask.</div>
              </div>
              <button onClick={() => setEditing(true)} style={{ ...careBtnHelp, padding: '9px 15px', fontSize: 13 }}>I’m here to help</button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CareCard({ ctx, embedded }) {
  const care = ctx.care || {};
  const s = care.settings || {};
  const [openId, setOpenId] = React.useState(() => (embedded && ctx.careFocus) || null);   // deep-link: auto-open the focused need
  if (!s.enabled) return null;
  const today = new Date().toISOString().slice(0, 10);
  const myPub = (care.myPub || '').toLowerCase();
  // visibility 'team' → only the care team (roster of the configured admin group) sees the list;
  // a recipient always sees their own need so they can mark skip-days.
  // on the care team (roster of the configured admin group) → can block out dates for a recipient who isn't on the app
  const onCareRoster = (() => {
    const roster = (ctx.churchRosters || []).find(r => r.team === s.adminGroupId);
    return !!(roster && (roster.people || []).some(p => p && (p.pub || '').toLowerCase() === myPub));
  })();
  const amCareTeam = s.visibility !== 'team' || onCareRoster;
  let live = (care.needs || []).filter(n => !n.endDate || n.endDate >= today);
  if (s.visibility === 'team' && !amCareTeam) live = live.filter(n => n.recipient && (n.recipient || '').toLowerCase() === myPub);
  // the open-needs block — or, in the embedded Care tab, a gentle empty state (availability still shows above it)
  const needsBlock = live.length ? (
    <div style={{ padding: 14, borderRadius: 18, background: 'color-mix(in oklab, var(--sage) 7%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 26%, var(--line))', boxShadow: 'var(--shadow)' }}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 11 }}>Someone in the church could use a hand. Sign up for a day — a meal, a ride, an errand.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {live.map(n => <CareNeedRow key={n.id} need={n} slots={care.slots || []} skips={care.skips || []} care={care} canManage={onCareRoster} expanded={openId === n.id} onToggle={() => setOpenId(openId === n.id ? null : n.id)} />)}
      </div>
    </div>
  ) : (
    <div style={{ textAlign: 'center', padding: '36px 24px 8px', color: 'var(--ink-3)' }}>
      <div style={{ width: 56, height: 56, borderRadius: 18, margin: '0 auto 14px', background: 'color-mix(in oklab, var(--sage) 12%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="heart" size={26} stroke={1.5} color="var(--sage)" /></div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--ink)', marginBottom: 6 }}>No open needs right now</div>
      <div style={{ fontSize: 14, lineHeight: 1.5, maxWidth: 280, margin: '0 auto' }}>When someone in the church needs a hand — a meal, a ride, an errand — it’ll show up here for you to help.</div>
    </div>
  );
  // embedded = the Serving "Care" tab: availability module first (offer help + who's ready), then the needs.
  if (embedded) return (<React.Fragment><CareAvailability ctx={ctx} />{needsBlock}</React.Fragment>);
  if (!live.length) return null;   // Today-card variant (currently unused): nothing to show with no needs
  return (
    <div style={{ marginBottom: 22, animation: 'trinityFade .5s ease both' }}>
      <SectionLabel>Practical care</SectionLabel>
      {needsBlock}
    </div>
  );
}

function TodayScreen({ ctx }) {
  const D = window.TrinityData;
  const Bible = window.Bible;

  // real date + time-of-day greeting
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' });
  const hr = now.getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';

  // day-streak: +1 per consecutive calendar day the app is opened
  const [streak, setStreak] = useStateT(() => (lsGet('trinityone.streak', { count: 0 }).count) || 0);
  useEffectT(() => {
    const today = now.toISOString().slice(0, 10);
    const s = lsGet('trinityone.streak', { count: 0, last: null });
    if (s.last === today) { setStreak(s.count); return; }
    const yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const count = s.last === yest ? (s.count || 0) + 1 : 1;
    lsSet('trinityone.streak', { count, last: today });
    setStreak(count);
  }, []);

  // verse of the day — rotate by day-of-year; render from the active translation when possible
  const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 864e5);
  const pick = D.VOTD_POOL[doy % D.VOTD_POOL.length];
  let votd = { ref: pick.ref, text: pick.text, version: 'WEB' };
  const vloc = Bible.parseRef(pick.ref);
  if (vloc && Bible.loaded && Bible.books().includes(vloc.book)) {
    const row = Bible.getVerses(vloc.book, vloc.chap).find(v => v.v === vloc.verse);
    if (row) votd = { ref: pick.ref, text: row.text, version: Bible.activeVersion };
  }

  // continue reading — from the live reading location
  const loc = ctx.loc;
  const contName = loc ? Bible.bookName(loc.book) : 'Genesis';
  const contAbbr = loc ? Bible.bookAbbr(loc.book) : 'Gen';
  const contChap = loc ? loc.chap : 1;
  const contMax = loc ? Bible.maxChapter(loc.book) : 1;
  const contPct = contMax ? contChap / contMax : 0;

  // active reading plan — from real persisted progress
  const started = D.PLANS.filter(p => (ctx.planProgress[p.id] || []).length > 0);
  const plan = started.sort((a, b) => (ctx.planProgress[b.id] || []).length - (ctx.planProgress[a.id] || []).length)[0] || D.PLANS[0];
  const pDone = (ctx.planProgress[plan.id] || []).length;
  const pDoneSet = new Set(ctx.planProgress[plan.id] || []);

  // am I being cared for right now? (a live care need names me as the recipient) → gentle banner near the top
  const _care = ctx.care || {};
  const _myPub = (_care.myPub || '').toLowerCase();
  const _careToday = new Date().toISOString().slice(0, 10);
  const myCareNeed = (_care.settings && _care.settings.enabled) ? (_care.needs || []).find(n => n.recipient && n.recipient.toLowerCase() === _myPub && (!n.endDate || n.endDate >= _careToday)) : null;
  const beingCaredFor = !!myCareNeed;
  // the recipient can dismiss the care banner with ✕; it snoozes until the need changes (new id or edited ts)
  const [careDismissTick, setCareDismissTick] = React.useState(0);
  const careBannerDismissed = React.useMemo(() => {
    if (!myCareNeed) return false;
    try { const d = JSON.parse(localStorage.getItem('trinityone.care.bannerDismiss') || 'null'); return !!(d && d.id === myCareNeed.id && d.ts === myCareNeed.ts); } catch { return false; }
  }, [myCareNeed && myCareNeed.id, myCareNeed && myCareNeed.ts, careDismissTick]);
  const dismissCareBanner = (e) => { if (e) e.stopPropagation(); try { if (myCareNeed) localStorage.setItem('trinityone.care.bannerDismiss', JSON.stringify({ id: myCareNeed.id, ts: myCareNeed.ts })); } catch {} if (ctx.toast) ctx.toast('Okay — this comes back if anything about your care changes.'); setCareDismissTick(t => t + 1); };
  const pNext = plan.days.find(d => !pDoneSet.has(d.d)) || plan.days[plan.days.length - 1];

  const churchDevo = (ctx.churchDevos || [])[0];   // latest real devotional the church shared (else hide the card)
  // serving: the member's next confirmed slot + any pending "can you serve?" asks
  const servNext = ctx.servNext;
  // (top bar sits just below the status bar; care + serving cards, then the verse — see the ScreenScroll top below)
  const servPendingN = (ctx.servPending || []).length;
  const fmtServe = (d) => { try { return new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }); } catch { return d; } };

  return (
    <ScreenScroll top="calc(env(safe-area-inset-top, 0px) + 8px)">
      {/* greeting */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, animation: 'trinityFade .5s ease both' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '.3px', textTransform: 'uppercase' }}>{dateStr}</div>
          <h1 style={{ margin: '4px 0 0', fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, letterSpacing: '-.3px', lineHeight: 1.05 }}>{greet}</h1>
          {ctx.church ? <button onClick={ctx.openChurchSwitcher} title="Your church" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 7, padding: '3px 10px', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 999, cursor: 'pointer', maxWidth: 220, boxShadow: 'var(--shadow)' }}><span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--clay)', flexShrink: 0 }} /><span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ctx.church.name}</span></button> : null}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(() => {
            const hdrBtn = { width: 40, height: 40, borderRadius: 14, border: '1px solid var(--line)',
              background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', boxShadow: 'var(--shadow)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' };
            const unread = (D.NOTIFICATIONS || []).some(n => n.unread) || (ctx.netUnread > 0);
            return (
              <React.Fragment>
                <button onClick={ctx.openSearch} aria-label="Search" style={hdrBtn}><Icon name="search" size={19} /></button>
                {ctx.church && ctx.church.audioFeed ? <button onClick={ctx.openListen} aria-label="Listen" style={hdrBtn}><Icon name="headphones" size={19} /></button> : null}
                <button onClick={ctx.openNotifications} aria-label="Notifications" style={hdrBtn}>
                  <Icon name="bell" size={19} />
                  {unread ? <span style={{ position: 'absolute', top: 9, right: 10, width: 7, height: 7, borderRadius: 999, background: 'var(--clay)', border: '1.5px solid var(--surface)' }} /> : null}
                </button>
              </React.Fragment>
            );
          })()}
          <button onClick={ctx.toggleDark} style={{
            width: 40, height: 40, borderRadius: 14, border: '1px solid var(--line)',
            background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', boxShadow: 'var(--shadow)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Icon name={ctx.dark ? 'sun' : 'moon'} size={19} /></button>
          <button title={`${streak}-day reading streak`}
            onClick={() => ctx.toast(streak > 0 ? `🔥 ${streak}-day reading streak — open the app each day to keep it going` : 'Open the app each day to build a reading streak')}
            style={{
            height: 40, padding: '0 12px', borderRadius: 14, background: 'var(--clay-soft)', border: 'none', cursor: 'pointer',
            color: 'var(--clay-ink)', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700, fontSize: 14,
            boxShadow: 'var(--shadow)', fontFamily: 'var(--font-ui)',
          }}><Icon name="flame" size={18} stroke={2} />{streak}</button>
        </div>
      </div>

      {/* cared-for: someone in the church has a care need open for me — surface it warmly, link to the Care tab */}
      {beingCaredFor && !careBannerDismissed ? (
        <div onClick={() => ctx.openServing('care', myCareNeed && myCareNeed.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 18, marginBottom: 22, cursor: 'pointer', background: 'color-mix(in oklab, var(--sage) 12%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 30%, var(--line))', boxShadow: 'var(--shadow)', animation: 'trinityFade .5s ease both' }}>
          <div style={{ width: 40, height: 40, borderRadius: 13, flexShrink: 0, background: 'color-mix(in oklab, var(--sage) 18%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="heart" size={20} color="var(--sage)" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>Your church is caring for you</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 600 }}>Tap to see what’s arranged — and tick off any day you’re covered.</div>
          </div>
          <button onClick={dismissCareBanner} aria-label="Dismiss" title="Dismiss — it comes back if the care changes" style={{ flexShrink: 0, width: 40, height: 40, marginRight: -6, borderRadius: 999, border: 'none', background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, lineHeight: 1 }}>✕</button>
          <Icon name="chevR" size={18} color="var(--ink-3)" />
        </div>
      ) : null}

      {/* Serving (next slot / pending ask) -> opens the Serving overlay */}
      {(servNext || servPendingN) ? (
        <div onClick={() => ctx.openServing && ctx.openServing()} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18, marginBottom: 22, cursor: 'pointer', boxShadow: 'var(--shadow)', animation: 'trinityFade .5s ease both',
          background: servPendingN ? 'color-mix(in oklab, var(--gold) 9%, var(--surface))' : 'color-mix(in oklab, var(--sage) 9%, var(--surface))',
          border: servPendingN ? '1px solid color-mix(in oklab, var(--gold) 32%, var(--line))' : '1px solid color-mix(in oklab, var(--sage) 30%, var(--line))' }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: servPendingN ? 'color-mix(in oklab, var(--gold) 18%, var(--surface))' : 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: servPendingN ? '#8a6717' : 'var(--sage)' }}><Icon name={servPendingN ? 'sparkle' : 'calCheck'} size={22} stroke={1.8} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {servPendingN ? (
              <React.Fragment>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>Can you serve?</div>
                <div style={{ fontSize: 12.5, color: '#8a6717', fontWeight: 600 }}>{servPendingN} request{servPendingN > 1 ? 's' : ''} waiting for your reply</div>
              </React.Fragment>
            ) : (
              <React.Fragment>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>You’re serving · {servNext.teamName}</div>
                <div style={{ fontSize: 12.5, color: 'var(--sage)', fontWeight: 600 }}>{servNext.role} · {fmtServe(servNext.date)}</div>
              </React.Fragment>
            )}
          </div>
          <Icon name="chevR" size={18} color="var(--ink-3)" />
        </div>
      ) : (
        /* not rostered yet — still surface Serving & events so it's always reachable */
        <div onClick={() => ctx.openServing && ctx.openServing()} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18, marginBottom: 22, cursor: 'pointer', boxShadow: 'var(--shadow)', animation: 'trinityFade .5s ease both', background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: 'var(--sage)' }}><Icon name="calCheck" size={22} stroke={1.8} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>Serving &amp; events</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 600 }}>See what’s on · RSVP · your rota</div>
          </div>
          <Icon name="chevR" size={18} color="var(--ink-3)" />
        </div>
      )}

      {/* Verse of the day — hero (below the care + serving cards) */}
      <div onClick={() => ctx.openShareSheet(votd)} style={{
        position: 'relative', borderRadius: 26, overflow: 'hidden', cursor: 'pointer',
        background: 'linear-gradient(155deg, var(--clay) 0%, var(--clay-deep) 100%)',
        padding: '22px 22px 18px', color: '#fff', marginBottom: 22, boxShadow: 'var(--shadow-lg)',
        animation: 'trinityFade .5s ease .05s both',
      }}>
        <div style={{ position: 'absolute', inset: 0, opacity: .5,
          background: 'radial-gradient(circle at 85% 12%, rgba(255,255,255,.28), transparent 42%)' }} />
        <div style={{ position: 'absolute', right: -28, bottom: -34, opacity: .14 }}>
          <Icon name="sun" size={180} stroke={1.2} color="#fff" />
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', opacity: .92 }}>
            <Icon name="sparkle" size={15} stroke={2} /> Verse of the day
          </div>
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 23, lineHeight: 1.38, margin: '14px 0 14px', fontWeight: 500, textWrap: 'pretty' }}>
            “{votd.text}”
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '.2px' }}>{votd.ref} · {votd.version}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {['heart', 'share'].map(n => (
                <div key={n} style={{ width: 36, height: 36, borderRadius: 12, background: 'rgba(255,255,255,.18)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
                  <Icon name={n} size={17} stroke={2} color="#fff" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Practical care / meal trains now lives in its own tab inside Serving & events (not on Today) */}

      {/* Continue reading */}
      <SectionLabel>Continue reading</SectionLabel>
      <div onClick={() => ctx.openReader()} style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 20,
        background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)',
        cursor: 'pointer', marginBottom: 22, animation: 'trinityFade .5s ease .1s both',
      }}>
        <div style={{ width: 52, height: 60, borderRadius: 12, background: 'linear-gradient(160deg,#3c6e57,#2c5141)',
          display: 'flex', alignItems: 'flex-end', padding: 7, flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--font-display)', color: '#fff', fontWeight: 700, fontSize: 12, lineHeight: 1 }}>{contAbbr}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>Where you left off</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginTop: 1 }}>{contName} {contChap}</div>
          <div style={{ height: 5, borderRadius: 3, background: 'var(--line)', marginTop: 8, overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(6, contPct * 100)}%`, height: '100%', background: 'var(--clay)', borderRadius: 3 }} />
          </div>
        </div>
        <div style={{ width: 38, height: 38, borderRadius: 999, background: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="play" size={16} color="#fff" />
        </div>
      </div>

      {/* Plan + (real) devotional cards */}
      <SectionLabel action="All plans" onAction={() => ctx.go('plans')}>Keep it going</SectionLabel>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, animation: 'trinityFade .5s ease .15s both' }}>
        <div onClick={() => ctx.openPlan(plan)} style={{
          flex: 1, padding: 16, borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--line)',
          boxShadow: 'var(--shadow)', cursor: 'pointer',
        }}>
          <ProgressRing value={plan.len ? pDone / plan.len : 0} />
          <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600, marginTop: 10 }}>Reading plan</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, lineHeight: 1.15, marginTop: 2 }}>{plan.title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--clay)', fontWeight: 600, marginTop: 4 }}>Day {pNext.d} of {plan.len}</div>
        </div>
        {churchDevo ? (
          <div onClick={() => ctx.openChurchDevo(churchDevo)} style={{
            flex: 1, padding: 16, borderRadius: 20, background: 'var(--sage)', cursor: 'pointer',
            color: '#fff', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow)',
          }}>
            <div style={{ position: 'absolute', right: -20, top: -16, opacity: .18 }}><Icon name="sun" size={110} stroke={1.4} color="#fff" /></div>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sun" size={22} stroke={2} color="#fff" />
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 10, opacity: .9 }}>Devotional{churchDevo.ref ? ' · ' + churchDevo.ref : ''}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, lineHeight: 1.15, marginTop: 2, position: 'relative' }}>{churchDevo.title}</div>
          </div>
        ) : null}
      </div>

      {/* Quick row */}
      <div style={{ display: 'flex', gap: 10, animation: 'trinityFade .5s ease .2s both' }}>
        {[
          { ic: 'study', label: 'Search', go: () => ctx.openSearch() },
          { ic: 'pen', label: 'Journal', go: () => ctx.newJournal() },
        ].map(q => (
          <button key={q.label} onClick={q.go} style={{
            flex: 1, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer',
            borderRadius: 16, padding: '13px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            color: 'var(--ink)', boxShadow: 'var(--shadow)',
          }}>
            <Icon name={q.ic} size={20} /><span style={{ fontSize: 12, fontWeight: 600 }}>{q.label}</span>
          </button>
        ))}
      </div>

      {/* Network announcements — a quiet teaser at the bottom; full list lives in Notifications */}
      {(ctx.netAnnouncements || []).length ? (
        <div style={{ marginTop: 24, animation: 'trinityFade .5s ease .24s both' }}>
          <SectionLabel action="See all" onAction={() => ctx.openNotifications()}>From your network</SectionLabel>
          <button onClick={() => ctx.openNotifications()} style={{ display: 'flex', gap: 12, padding: 14, borderRadius: 18, width: '100%', textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="globe" size={19} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 12, color: 'var(--clay)', fontWeight: 700 }}>{(ctx.netAnnouncements[0] || {})._network || 'Network'}</span>
                {ctx.netUnread > 0 ? <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: 'var(--clay)', borderRadius: 999, padding: '1px 7px' }}>{ctx.netUnread} new</span> : null}
              </div>
              <div style={{ fontFamily: 'var(--font-read)', fontSize: 14.5, lineHeight: 1.45, color: 'var(--ink-2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{(ctx.netAnnouncements[0] || {}).text}</div>
            </div>
            <Icon name="chevR" size={18} color="var(--ink-3)" style={{ alignSelf: 'center' }} />
          </button>
        </div>
      ) : null}
    </ScreenScroll>
  );
}

Object.assign(window, { TodayScreen, ScreenScroll, ProgressRing });
