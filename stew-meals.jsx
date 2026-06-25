// stew-meals.jsx — Steward console surface for the Meal trains / practical-care module.
// Two top-level components (mirrors Finance):
//   • DashMeals       — the console tab (need list, slot grid, signups)
//   • DashMealsPanel  — the enable card in Settings → Care
// Copy is care-framed deliberately (warm, calls into pastoral care, NOT slot-management).
// Read-only here on the steward side for slot fills + skips — members fill from their app.

const MEALS_TYPES = [
  ['meals',     'Meals',     'gift'],
  ['rides',     'Rides',     'globe'],
  ['errands',   'Errands',   'check'],
  ['visits',    'Visits',    'heart'],
  ['childcare', 'Childcare', 'shield'],
];
const MEALS_TYPE_LABEL = Object.fromEntries(MEALS_TYPES.map(t => [t[0], t[1]]));
const MEALS_TYPE_ICON  = Object.fromEntries(MEALS_TYPES.map(t => [t[0], t[2]]));

const mealsFld = { width: '100%', boxSizing: 'border-box', height: 44, padding: '0 13px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 14.5, color: 'var(--ink)', fontFamily: 'var(--font-ui)' };
const mealsLbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 6px' };

// enumerate ISO dates start..end (inclusive); guards against bad input
function mealsDateRange(startISO, endISO) {
  const out = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startISO || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endISO || '')) return out;
  const s = new Date(startISO + 'T00:00:00Z'), e = new Date(endISO + 'T00:00:00Z');
  if (isNaN(s) || isNaN(e) || e < s) return out;
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out.length > 90 ? out.slice(0, 90) : out;   // cap at ~3 months so a typo doesn't render 5000 rows
}
function mealsFmtDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || '';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// ────────────────────────────────────────────────────────────────────────────────
// Settings → Care enable card
// ────────────────────────────────────────────────────────────────────────────────
function DashMealsPanel({ church }) {
  const s = window.useMealsSettings ? window.useMealsSettings() : { enabled: false, visibility: 'all', openedBy: 'steward', adminGroupId: '' };
  const groups = window.useStewardGroups ? window.useStewardGroups() : [];
  const teamGroups = (groups || []).filter(g => g && (g.kind === 'team' || g.kind === 'group'));
  const on = !!s.enabled;
  const setAll = (next) => window.StewardMeals.setEnabled(next.enabled !== undefined ? next.enabled : on, {
    visibility:   next.visibility   !== undefined ? next.visibility   : s.visibility,
    openedBy:     next.openedBy     !== undefined ? next.openedBy     : s.openedBy,
    adminGroupId: next.adminGroupId !== undefined ? next.adminGroupId : s.adminGroupId,
  });
  const toggleBtn = (active, onClick, label) => (
    <button onClick={onClick} aria-label={label} title={label} style={{ width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, background: active ? 'var(--sage)' : 'var(--line)', position: 'relative', transition: 'background .2s' }}>
      <span style={{ position: 'absolute', top: 3, left: active ? 23 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
    </button>
  );
  return (
    <Panel title="Practical care">
      <div style={{ display: 'flex', gap: 10, padding: '11px 13px', borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 26%, transparent)', marginBottom: 14 }}>
        <Icon name="heart" size={17} color="var(--sage)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>Meals, rides, errands and visits — when someone in the church is unwell, grieving, or has a new baby. You open a need; members fill the dates. <b>Practical</b> showing-up is the kind of care a phone push can't do.</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderRadius: 13, border: '1px solid var(--line)', background: on ? 'color-mix(in oklab, var(--sage) 10%, var(--surface))' : 'var(--surface-2)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>Practical care (Meal trains)</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1, lineHeight: 1.45 }}>{on ? 'On — a “Care” tab is in your sidebar, and members see open needs in their app.' : 'Off — turn on to start opening needs and let the church sign up to help.'}</div>
        </div>
        {toggleBtn(on, () => setAll({ enabled: !on }), 'Toggle practical care')}
      </div>
      {on ? <React.Fragment>
        <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 13, border: '1px solid var(--line)' }}>
          <div style={mealsLbl}>WHO SEES OPEN NEEDS?</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['all', 'The whole church'], ['team', 'Only the care team']].map(([k, lbl]) => (
              <button key={k} onClick={() => setAll({ visibility: k })} style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line)', background: s.visibility === k ? 'var(--clay)' : 'var(--surface)', color: s.visibility === k ? '#fff' : 'var(--ink)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>{lbl}</button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.45 }}>{s.visibility === 'team' ? 'Open needs are visible only to members of the care-team group below — kinder for congregations where guilt-pressure to help is the bigger concern.' : 'Open needs are visible to every member — best for turnout when the church has the bandwidth to carry it.'}</div>
        </div>
        <div style={{ marginTop: 10, padding: '12px 14px', borderRadius: 13, border: '1px solid var(--line)' }}>
          <div style={mealsLbl}>WHO CAN OPEN A NEED?</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['steward', 'Stewards + care team'], ['member', 'Any member']].map(([k, lbl]) => (
              <button key={k} onClick={() => setAll({ openedBy: k })} style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line)', background: s.openedBy === k ? 'var(--clay)' : 'var(--surface)', color: s.openedBy === k ? '#fff' : 'var(--ink)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>{lbl}</button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.45 }}>{s.openedBy === 'member' ? 'Members can open a need for themselves or for someone else — useful where pride is the bigger obstacle than triage.' : 'Stewards (and the care-team group below) open needs — keeps dignity + triage in pastoral hands.'}</div>
        </div>
        <div style={{ marginTop: 10, padding: '12px 14px', borderRadius: 13, border: '1px solid var(--line)' }}>
          <div style={mealsLbl}>CARE-TEAM GROUP</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 8 }}>Members of this group can also open and manage needs (not just stewards). Make a group called <b>Care team</b> first under Groups, then pick it here.</div>
          <select value={s.adminGroupId || ''} onChange={e => setAll({ adminGroupId: e.target.value })} style={mealsFld}>
            <option value="">— None (stewards only) —</option>
            {teamGroups.map(g => <option key={g.id} value={g.id}>{g.name || g.id}</option>)}
          </select>
        </div>
      </React.Fragment> : null}
    </Panel>
  );
}
window.DashMealsPanel = DashMealsPanel;

// ────────────────────────────────────────────────────────────────────────────────
// Main console tab
// ────────────────────────────────────────────────────────────────────────────────
function DashMeals() {
  const needs = window.useMealsNeeds ? window.useMealsNeeds() : [];
  const slots = window.useMealsSlots ? window.useMealsSlots() : [];
  const skips = window.useMealsSkips ? window.useMealsSkips() : [];
  const [editing, setEditing] = React.useState(null);   // null | 'new' | <need>
  const [openId, setOpenId]   = React.useState(null);
  const today = new Date().toISOString().slice(0, 10);
  const live    = (needs || []).filter(n => !n.endDate || n.endDate >= today);
  const pastNeeds = (needs || []).filter(n => n.endDate && n.endDate < today);
  const detail = openId ? (needs || []).find(n => n.id === openId) : null;
  return (
    <div className="stew-tab">
      <div className="stew-head">
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800 }}>Care</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--ink-2)', fontSize: 13.5 }}>Open a need; the church signs up to help. Meals, rides, errands, visits, childcare.</p>
        </div>
        <button onClick={() => setEditing('new')} className="sk-btn sk-btn--clay" style={{ padding: '10px 14px', fontSize: 14 }}><Icon name="plus" size={15} color="#fff" /> Start care</button>
      </div>

      {detail ? (
        <MealsNeedDetail need={detail} slots={slots.filter(s => s.needId === detail.id)} skips={skips.filter(s => s.needId === detail.id)} onClose={() => setOpenId(null)} onEdit={() => setEditing(detail)} />
      ) : (live.length === 0 && pastNeeds.length === 0) ? (
        <MealsEmpty />
      ) : (
        <React.Fragment>
          {live.length > 0 && <div style={{ marginTop: 16 }}>
            <div style={mealsLbl}>OPEN NEEDS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {live.map(n => <MealsNeedCard key={n.id} need={n} slots={slots.filter(s => s.needId === n.id)} skips={skips.filter(s => s.needId === n.id)} onOpen={() => setOpenId(n.id)} />)}
            </div>
          </div>}
          {pastNeeds.length > 0 && <div style={{ marginTop: 22 }}>
            <div style={mealsLbl}>RECENTLY CLOSED</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: 0.7 }}>
              {pastNeeds.slice(0, 5).map(n => <MealsNeedCard key={n.id} need={n} slots={slots.filter(s => s.needId === n.id)} skips={skips.filter(s => s.needId === n.id)} onOpen={() => setOpenId(n.id)} />)}
            </div>
          </div>}
        </React.Fragment>
      )}

      {editing ? <MealsNeedModal need={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(saved) => { setEditing(null); if (saved && saved.id) setOpenId(saved.id); }} onDeleted={() => { setEditing(null); setOpenId(null); }} /> : null}
    </div>
  );
}
window.DashMeals = DashMeals;

// ────────────────────────────────────────────────────────────────────────────────
function MealsEmpty() {
  return (
    <div style={{ marginTop: 30, padding: 28, borderRadius: 18, border: '1px dashed var(--line)', background: 'var(--surface-2)', textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: 'color-mix(in oklab, var(--sage) 14%, var(--surface))', color: 'var(--sage)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <Icon name="heart" size={26} color="var(--sage)" />
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>Nobody on the care list yet.</div>
      <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 6, maxWidth: 380, margin: '6px auto 0' }}>When someone's unwell or has a new baby, start a care need — the church will see it and sign up.</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
function MealsNeedCard({ need, slots, skips, onOpen }) {
  const dates = mealsDateRange(need.startDate, need.endDate);
  const filledDates = new Set(slots.map(s => s.isoDate));
  const skippedDates = new Set(skips.map(s => s.isoDate));
  const open = dates.filter(d => !filledDates.has(d) && !skippedDates.has(d));
  const filledCount = dates.filter(d => filledDates.has(d)).length;
  return (
    <button onClick={onOpen} className="sk-card" style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 16px', textAlign: 'left', cursor: 'pointer', width: '100%', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)', fontFamily: 'var(--font-ui)' }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 14%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name={MEALS_TYPE_ICON[need.type] || 'heart'} size={20} color="var(--sage)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>{need.displayLabel || 'A member in our church'}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 2 }}>{MEALS_TYPE_LABEL[need.type] || 'Care'} · {mealsFmtDate(need.startDate)} → {mealsFmtDate(need.endDate)}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: open.length === 0 ? 'var(--sage)' : 'var(--ink)' }}>{filledCount}/{dates.length}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{open.length === 0 ? 'covered' : open.length + ' open'}</div>
      </div>
      <Icon name="chevR" size={16} color="var(--ink-3)" />
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
function MealsNeedDetail({ need, slots, skips, onClose, onEdit }) {
  const dates = mealsDateRange(need.startDate, need.endDate);
  const skipByDate = Object.fromEntries(skips.map(s => [s.isoDate, s]));
  const slotsByDate = {};
  for (const s of slots) { (slotsByDate[s.isoDate] = slotsByDate[s.isoDate] || []).push(s); }
  const directory = window.useStewardDirectory ? window.useStewardDirectory() : {};
  const nameOf = (pub) => (directory && directory[pub] && directory[pub].name) || (pub ? (pub.slice(0, 6) + '…' + pub.slice(-4)) : 'A member');
  return (
    <div style={{ marginTop: 14 }}>
      <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 13 }}><Icon name="chevL" size={14} color="currentColor" /> All needs</button>
      <div style={{ marginTop: 12, padding: '18px 18px 14px', borderRadius: 18, border: '1px solid var(--line)', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ width: 54, height: 54, borderRadius: 14, background: 'color-mix(in oklab, var(--sage) 14%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name={MEALS_TYPE_ICON[need.type] || 'heart'} size={24} color="var(--sage)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 21 }}>{need.displayLabel || 'A member in our church'}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 3 }}>{MEALS_TYPE_LABEL[need.type] || 'Care'} · {mealsFmtDate(need.startDate)} → {mealsFmtDate(need.endDate)}</div>
          </div>
          <button onClick={onEdit} className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 13 }}><Icon name="edit" size={14} color="currentColor" /> Edit</button>
        </div>
        {need.notes ? <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{need.notes}</div> : null}
      </div>

      <div style={{ marginTop: 14, ...mealsLbl }}>SCHEDULE</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {dates.length === 0 ? (
          <div style={{ padding: 18, borderRadius: 12, border: '1px dashed var(--line)', color: 'var(--ink-2)', textAlign: 'center', fontSize: 13.5 }}>Add a start and end date to lay out the schedule.</div>
        ) : dates.map(iso => {
          const skipped = !!skipByDate[iso];
          const fills = slotsByDate[iso] || [];
          return (
            <div key={iso} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 13px', borderRadius: 11, border: '1px solid var(--line)', background: skipped ? 'var(--surface-2)' : 'var(--surface)', opacity: skipped ? 0.55 : 1 }}>
              <div style={{ minWidth: 110, fontSize: 13, fontWeight: 700, color: 'var(--ink)', textDecoration: skipped ? 'line-through' : 'none' }}>{mealsFmtDate(iso)}</div>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink-2)' }}>
                {skipped ? <span><Icon name="x" size={12} color="var(--ink-3)" /> Recipient skipped{skipByDate[iso].reason ? ' — ' + skipByDate[iso].reason : ''}</span>
                  : fills.length === 0 ? <span style={{ color: 'var(--ink-3)' }}>Open</span>
                  : fills.map((f, i) => <span key={i} style={{ marginRight: 10 }}><Icon name="check" size={12} color="var(--sage)" /> {nameOf(f.pubkey)}{f.note ? ' (' + f.note + ')' : ''}</span>)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
function MealsNeedModal({ need, onClose, onSaved, onDeleted }) {
  const isEdit = !!need;
  const today = new Date().toISOString().slice(0, 10);
  const [label, setLabel]   = React.useState(need ? need.displayLabel : '');
  const [type, setType]     = React.useState(need ? need.type : 'meals');
  const [start, setStart]   = React.useState(need ? need.startDate : today);
  const [end, setEnd]       = React.useState(need ? need.endDate : '');
  const [notes, setNotes]   = React.useState(need ? need.notes : '');
  const [recipient, setRecipient] = React.useState(need ? need.recipient : '');
  const members = window.useStewardMembers ? window.useStewardMembers() : [];
  const [busy, setBusy]     = React.useState(false);
  const [err, setErr]       = React.useState('');
  const dates = mealsDateRange(start, end);
  const canSave = label.trim().length > 0 && dates.length > 0 && !busy;
  const save = async () => {
    if (!canSave) return;
    setBusy(true); setErr('');
    try {
      const saved = await window.StewardMeals.publishNeed({
        id: need ? need.id : undefined,
        displayLabel: label.trim(), type, startDate: start, endDate: end, notes: notes.trim(),
        recipient: (recipient || '').trim(),
      });
      onSaved && onSaved(saved);
    } catch (e) { setErr((e && e.message) || 'Save failed.'); setBusy(false); }
  };
  const remove = async () => {
    if (!isEdit) return;
    if (!window.confirm('Close this care need? Members will no longer see it.')) return;
    setBusy(true);
    try { await window.StewardMeals.removeNeed(need.id); onDeleted && onDeleted(); }
    catch (e) { setErr((e && e.message) || 'Could not close.'); setBusy(false); }
  };
  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(20,15,8,.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', zIndex: 70 }}>
      <div style={{ width: 'min(540px, 100%)', maxHeight: '90vh', overflow: 'auto', background: 'var(--surface)', borderRadius: 18, boxShadow: 'var(--shadow-lg)', padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, background: 'color-mix(in oklab, var(--sage) 14%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="heart" size={18} color="var(--sage)" /></div>
          <div style={{ flex: 1, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19 }}>{isEdit ? 'Edit care need' : 'Start care'}</div>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 13 }} aria-label="Close"><Icon name="x" size={14} color="currentColor" /></button>
        </div>

        <div style={mealsLbl}>WHO IS THIS FOR?</div>
        <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Sarah Jones, or “a family in our church”" autoFocus style={{ ...mealsFld, marginBottom: 6 }} />
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45, marginBottom: 14 }}>You decide what reads right. A real name brings the church closer; a discreet label protects dignity. Up to you.</div>

        <div style={mealsLbl}>LINK THEIR ACCOUNT (OPTIONAL)</div>
        <select value={recipient} onChange={e => setRecipient(e.target.value)} style={{ ...mealsFld, marginBottom: 6 }}>
          <option value="">Not linked — just a label above</option>
          {(members || []).filter(m => m && m.pubkey).map(m => <option key={m.pubkey} value={m.pubkey}>{m.name || (m.pubkey.slice(0, 8) + '…')}</option>)}
        </select>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45, marginBottom: 14 }}>If the person uses the app, link them — then <b>they alone</b> can tick off days they’re already covered, so the church doesn’t double up. Leave unlinked if they’re not on the app.</div>

        <div style={mealsLbl}>WHAT KIND OF CARE?</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {MEALS_TYPES.map(([k, lbl, ic]) => (
            <button key={k} onClick={() => setType(k)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 13px', borderRadius: 10, border: '1px solid var(--line)', background: type === k ? 'var(--clay)' : 'var(--surface)', color: type === k ? '#fff' : 'var(--ink)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
              <Icon name={ic} size={13} color={type === k ? '#fff' : 'var(--ink-2)'} /> {lbl}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={mealsLbl}>FROM</div>
            <input type="date" value={start} onChange={e => setStart(e.target.value)} style={mealsFld} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={mealsLbl}>UNTIL</div>
            <input type="date" value={end} onChange={e => setEnd(e.target.value)} min={start} style={mealsFld} />
          </div>
        </div>
        {dates.length === 0 ? <div style={{ fontSize: 12, color: 'var(--clay)', marginTop: -8, marginBottom: 14 }}>Pick valid dates — end on or after the start.</div> : <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: -8, marginBottom: 14 }}>{dates.length} day{dates.length === 1 ? '' : 's'} of care.</div>}

        <div style={mealsLbl}>NOTES (OPTIONAL)</div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Any context the church needs to help well — allergies, drop-off times, the address, who not to ring after 9pm…" style={{ ...mealsFld, height: 'auto', minHeight: 88, padding: '11px 13px', resize: 'vertical' }} />

        {err ? <div style={{ fontSize: 13, color: 'var(--clay)', fontWeight: 600, marginTop: 12 }}>{err}</div> : null}

        <div style={{ display: 'flex', gap: 9, marginTop: 18, justifyContent: 'flex-end' }}>
          {isEdit ? <button onClick={remove} disabled={busy} className="sk-btn sk-btn--ghost" style={{ padding: '10px 14px', fontSize: 13.5, color: 'var(--clay)' }}><Icon name="trash" size={14} color="var(--clay)" /> Close need</button> : null}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ padding: '10px 14px', fontSize: 13.5 }}>Cancel</button>
          <button onClick={save} disabled={!canSave} className="sk-btn sk-btn--clay" style={{ padding: '10px 16px', fontSize: 14, opacity: canSave ? 1 : 0.5 }}><Icon name="check" size={14} color="#fff" /> {isEdit ? 'Save changes' : 'Open this need'}</button>
        </div>
      </div>
    </div>
  );
}
