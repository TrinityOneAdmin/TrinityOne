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
const CARE_TYPE_LABEL = { meals: 'Meals', rides: 'Rides', moving: 'Moving', errands: 'Errands', diy: 'DIY', visits: 'Visits', childcare: 'Childcare', other: 'Other' };
const CARE_TYPE_ICON = { meals: 'gift', rides: 'calCheck', moving: 'users', errands: 'check', diy: 'hand', visits: 'heart', childcare: 'child', other: 'sparkle' };
function careDateRange(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '')) return [];
  // Parse AND format in UTC ('…T00:00:00Z' + setUTCDate). Parsing as LOCAL midnight and formatting with
  // toISOString rendered the PREVIOUS calendar day everywhere east of Greenwich (BST included) — which shifted
  // a need's whole day list, so a member's "I'll help Tuesday" was recorded against Monday. (Mirrors the
  // steward console's dayList, which already parsed with 'Z'.)
  const s = new Date(start + 'T00:00:00Z');
  const e = /^\d{4}-\d{2}-\d{2}$/.test(end || '') ? new Date(end + 'T00:00:00Z') : s;
  if (isNaN(s) || isNaN(e) || e < s) return [];
  const out = [];
  for (const d = new Date(s); d <= e && out.length < 90; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
function careFmtDate(iso) { try { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); } catch { return iso; } }
function careName(pub, myPub) {
  if (pub && myPub && pub.toLowerCase() === myPub.toLowerCase()) return 'You';
  try { const d = window.Fellowship && window.Fellowship.displayFor && window.Fellowship.displayFor(pub); if (d && (d.name || d.handle)) return d.name || d.handle; } catch {}
  return 'A member';
}

// THE MEMBER'S HALF OF THE SAME LIE (see mealsCoverLabel in app/stew-meals.jsx). Cover was decided by
// "nothing is open" alone, and a need with NO DAYS has nothing open — so the congregation was shown "all
// covered" in the done colour for a need nobody could sign up to, because there was nothing to sign up to.
// The expanded row underneath already said "No dates set yet", so the summary contradicted the detail one
// tap away. Simulation 2026-08-19, R3-5: a steward published a Meals need with zero days and both screens
// reported it as handled.
//
// This cannot call the console's helper: app/*.jsx are classic scripts and these two files are in DIFFERENT
// bundles (index.html loads screens-today.js, steward.html loads stew-meals.js). Keep the pair in step by
// hand — and never share a top-level name between bundles that are loaded together.
function careCoverLabel(dayCount, openCount) {
  if (!(dayCount > 0)) return { text: 'no days set yet', done: false };
  if (!(openCount > 0)) return { text: 'all covered', done: true };
  return { text: openCount + ' day' + (openCount === 1 ? '' : 's') + ' still open', done: false };
}

function CareNeedRow({ need, slots, skips, care, canManage, expanded, onToggle }) {
  const myPub = care.myPub || '';
  const dates = (Array.isArray(need.dates) && need.dates.length) ? [...need.dates].sort() : careDateRange(need.startDate, need.endDate);
  const skipSet = new Set(skips.filter(k => k.needId === need.id).map(k => k.isoDate));
  const fillsFor = (iso) => slots.filter(s => s.needId === need.id && s.isoDate === iso);
  const isRecipient = !!need.recipient && need.recipient === myPub.toLowerCase();
  const openDays = dates.filter(d => !skipSet.has(d) && fillsFor(d).length === 0);
  const cover = careCoverLabel(dates.length, openDays.length);
  const filledDays = dates.filter(d => fillsFor(d).length > 0).length;
  const accent = 'var(--sage)';
  // per-day meals (meals tasks): the day's override, else the need default
  const MEAL_SHORT = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
  const mealsFor = (iso) => (need.type === 'meals') ? ((need.dayMeals && need.dayMeals[iso] && need.dayMeals[iso].length) ? need.dayMeals[iso] : (Array.isArray(need.meals) ? need.meals : [])) : [];
  // "what I'm bringing" — editable note on the helper's own slot (so two people don't bring the same dish)
  const [noteDraft, setNoteDraft] = React.useState({});
  const [savedFlash, setSavedFlash] = React.useState({});
  const myNoteFor = (iso) => { const f = fillsFor(iso).find(x => x.pubkey && x.pubkey.toLowerCase() === myPub.toLowerCase()); return f ? (f.note || '') : ''; };
  // "✓ Saved" WAS DRAWN BEFORE THE ANSWER CAME BACK. The note ("bringing a lasagne, no nuts") is the one
  // field here that other people act on, and the flash fired synchronously whatever happened — so the batch
  // that added a failure toast on 2026-09-04 put a green tick beside its own error message. Audit same day.
  const saveNote = (iso) => {
    const cur = noteDraft[iso] !== undefined ? noteDraft[iso] : myNoteFor(iso);
    Promise.resolve((care.setNote || care.fill)(need.id, iso, (cur || '').trim()))
      .then(ok => { if (ok) setSavedFlash(f => ({ ...f, [iso]: true })); })
      .catch(() => {});
  };
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', background: 'var(--surface)' }}>
      <button onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 13px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, var(--sage) 15%, var(--surface))', color: accent }}><Icon name={CARE_TYPE_ICON[need.type] || 'heart'} size={19} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--ink)' }}>{need.displayLabel || 'A member in our church'}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 1 }}>{careTypeLabel(need)} · {cover.text}</div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: cover.done ? accent : 'var(--ink-3)' }}>{filledDays}/{dates.length}</div>
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
                  {/* ONE HELPER PER DAY. The middle column already names who is bringing what; offering "I'll
                      help" on a day someone ELSE has taken let two people sign up for the same slot and turn up
                      with the same meal — the exact thing the help page promises the app prevents ("it shows as
                      covered so two people don't turn up for the same slot"), and a simulated member did it by
                      accident. So: my own signup stays cancellable; a day taken by someone else reads as
                      covered and does not offer a second signup; only a genuinely Open day offers "I'll help". */}
                  {!skipped && !isRecipient && (mineFilled
                    ? <button onClick={() => care.clearFill(need.id, iso)} style={careBtnMine} title="You’re signed up — tap to cancel"><Icon name="check" size={12} color="var(--sage)" stroke={3} /> You’re helping</button>
                    : fills.length
                    ? <span style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={12} color="var(--sage)" /> Covered</span>
                    : <button onClick={() => care.fill(need.id, iso)} style={careBtnHelp}>I’ll help</button>)}
                  {(isRecipient || (canManage && fills.length === 0)) && (skipped
                    ? <button onClick={() => care.clearSkip(need.id, iso)} style={careBtnGhost}>Undo</button>
                    : <button onClick={() => care.skip(need.id, iso, '', need._skipEnc, need._by)} style={isRecipient ? careBtnHelp : careBtnGhost}>{isRecipient ? (fills.length ? 'Thanks — I’m covered' : 'I’m covered') : 'Skip'}</button>)}
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
          {isRecipient ? <CloseMyNeedButton need={need} /> : null}
        </div>
      )}
    </div>
  );
}
// The person a need is FOR can close the whole thing ("I'm sorted") — not just skip day by day. Without this
// they must ask a steward to stop the church organising around them, which is the opposite of dignified.
function CloseMyNeedButton({ need }) {
  const [state, setState] = React.useState('');   // '' | 'confirm' | 'busy' | 'failed'
  const close = async () => {
    setState('busy');
    let ok = false;
    try { ok = await window.Fellowship.closeMyCareNeed(need); } catch (e) {}
    setState(ok ? '' : 'failed');
  };
  if (state === 'failed') return <div style={{ fontSize: 11.5, color: 'var(--clay-deep, #b4462f)', marginTop: 8, lineHeight: 1.45 }}>Couldn’t close it from here — your church keeps that with the care team. Message them and they’ll close it.</div>;
  if (state === 'confirm' || state === 'busy') return (
    <div style={{ marginTop: 9, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45, marginBottom: 9 }}>Close this? Your church will stop signing up to help — you can always ask again.</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={close} disabled={state === 'busy'} style={{ ...careBtnHelp, background: 'var(--clay)' }}>{state === 'busy' ? 'Closing…' : 'Yes, close it'}</button>
        <button onClick={() => setState('')} disabled={state === 'busy'} style={careBtnGhost}>Keep it open</button>
      </div>
    </div>
  );
  return <button onClick={() => setState('confirm')} style={{ ...careBtnGhost, marginTop: 9 }}>I’m sorted — close this</button>;
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

// ── "Ask for help": a member privately asks the care team, via a short form that mirrors the need categories.
// It publishes a sealed request (care-team only) — not a public need. The care team approves it into a need or
// opens a chat. Lives at the top of the Care tab.
// A request can name several kinds of help — one situation, one request. Older requests carry only `type`,
// so read `types` and fall back; never show the first kind alone when the asker chose three.
// The kinds a request named that the need being opened will NOT cover — approve mints one need, from the first.
function careExtraKinds(r) {
  const ts = (Array.isArray(r && r.types) ? r.types : []).filter(Boolean);
  return ts.slice(1).map(t => CARE_TYPE_LABEL[t]).filter(Boolean);
}
// WHO SEES WHICH NEEDS. Pulled out as a plain function on purpose: the previous version of this decision was
// one line reading `if (!amCareTeam)`, and `amCareTeam` does not mean "is on the care team" — it means
// `visibility !== 'team' || onCareRoster`, i.e. "can see everything". So on the DEFAULT whole-church setting
// it was true for every member and the line never ran; and on the team-only setting it combined with the line
// above to leave a recipient with an EMPTY screen, taking away the one place they mark days as covered while
// a banner still told them to go there. A test that asserted the line passed, because the line was exactly
// what I wrote — source text cannot catch a predicate whose name lies. This one is executed by its test.
//
// Two lists, because they are two different jobs:
//   mine   — needs raised FOR me. I must see these: the skip-day controls ("I'm covered on Tuesday") live
//            on them, and the Today banner deep-links here. Never hidden from me.
//   others — needs I could volunteer for. Never includes my own, which is what invited Verity to help herself.
// The care team sees everyone's under `others` for triage; that is `onCareRoster`, the real roster test.
function splitCareNeeds({ needs, today, visibility, onCareRoster, myPub }) {
  const me = String(myPub || '').toLowerCase();
  const recipOf = (n) => String((n && n.recipient) || '').toLowerCase();
  let visible = (needs || []).filter(n => !n.endDate || n.endDate >= today);
  // team-only churches: a member who is not on the roster sees only what concerns them (pre-existing rule)
  if (visibility === 'team' && !onCareRoster) visible = visible.filter(n => !!recipOf(n) && recipOf(n) === me);
  const mine = me ? visible.filter(n => recipOf(n) === me) : [];
  const others = visible.filter(n => !me || recipOf(n) !== me);
  return { mine, others };
}
function careTypeLabel(r) {
  const ts = (Array.isArray(r && r.types) && r.types.length ? r.types : [r && r.type]).filter(Boolean);
  const names = ts.map(t => CARE_TYPE_LABEL[t]).filter(Boolean);
  return names.length ? names.join(' \u00b7 ') : 'Help';
}
const CARE_WHEN = [['once', 'Just once'], ['ongoing', 'For a while'], ['unsure', 'Not sure yet']];
// Same list the console offers when the care team opens a need, so a need reads the same whoever opened it.
const CARE_DIET = ['Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-free', 'Dairy-free', 'Nut-free'];
const CARE_MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner']];
const CARE_URGENCY = [['soon', 'This week'], ['month', 'Soon'], ['norush', 'No rush']];

// The row wraps. On a 360px phone the icon (38) plus "Message" and "Withdraw" (neither shrinks, ~200 together)
// plus padding and gaps leave about 45px for the text, so "You asked for help · Visits" rendered one word per
// line down a column while the buttons kept full width. Seen on the OPPO, 2026-08-27. flex-basis 150px means
// the actions drop to their own line rather than crushing the text; on a wider screen nothing changes.
// `isMinor` is passed in rather than read from a context this component does not receive. For a young person
// none of these lines is true: their request never went to the care rota, it went to the adults their church
// cleared. Naming the care team tells them their words reached a group they did not choose to tell.
function MyRequestRow({ r, onCancel, onMessage, isMinor }) {
  const [busy, setBusy] = React.useState(false);
  // A WITHDRAWAL THAT DID NOT LAND MUST NOT LOOK LIKE ONE. The dialog closed either way and the row stayed
  // put, which reads as "the app is slow" — so the member believes they have withdrawn, stops expecting
  // anyone, and the care team still has an open request they will act on. 2026-09-04 sweep.
  const [failed, setFailed] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);   // Withdraw deletes the request AND its care-team thread — ask first
  const label = careTypeLabel(r);
  const st = r.status || 'open';
  // "Declined" must not read like help is coming. Someone who worked up the courage to ask, and is told the
  // team "has this in hand", waits — and loses the chance to ask someone else. Say it's closed, and make the
  // row a doorway (the Message button sits right beside this) rather than a wall.
  const who = isMinor ? 'Someone at your church' : 'Your care team';
  const sub = st === 'approved' ? who + ' set it up — see Open needs below.'
    : st === 'declined' ? who + ' has closed this one. If you still need help, message them or ask again.'
    : st === 'handled' ? who + ' is on it.'
    // A REQUEST IS READ BY WHOEVER HOLDS A KEY TO IT, AND NOBODY ELSE. Measured on a phone, 2026-08-19: a
    // church with no care team roster sealed this to two people — the church key and the asker — and the row
    // still read "your care team will be in touch". The toast beside it had already been fixed to say who it
    // reached; this line, which stays on screen afterwards, had not. r.recipients counts the envelope's own
    // key list, so two means the leader and you.
    : (r.recipients && r.recipients <= 2) ? 'Sent privately — only your church leader can open this.'
    : (isMinor ? 'Sent privately — someone at your church who can help will be in touch.' : 'Sent privately — your care team will be in touch.');
  const tint = st === 'open' ? 'var(--sage)' : st === 'declined' ? 'var(--ink-3)' : 'var(--sage)';
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 16, background: 'color-mix(in oklab, ' + tint + ' 8%, var(--surface))', border: '1px solid color-mix(in oklab, ' + tint + ' 24%, transparent)', marginBottom: 9 }}>
      <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, ' + tint + ' 16%, var(--surface))', color: tint }}><Icon name={st === 'open' ? (CARE_TYPE_ICON[r.type] || 'heart') : 'check'} size={19} /></div>
      <div style={{ flex: '1 1 150px', minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>You asked for help{r.type ? ' · ' + label : ''}{!r.forSelf && r.forName ? ' · for ' + r.forName : ''}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 1 }}>{sub}</div>
        {failed ? <div role="alert" style={{ fontSize: 12, color: 'var(--clay-deep, #b4462f)', marginTop: 3, lineHeight: 1.45 }}>That didn’t reach your church — this request is still open. Try again in a moment.</div> : null}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 'auto' }}>
        {onMessage ? <button onClick={onMessage} title={isMinor ? 'Message the person helping you about this' : 'Message the care team about this'} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '7px 9px', cursor: 'pointer', color: 'var(--ink-2)', fontSize: 12, fontFamily: 'var(--font-ui)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="chat" size={13} color="currentColor" /> Message</button> : null}
        {st === 'open' ? <button onClick={() => setConfirming(true)} disabled={busy} title="Withdraw this request" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '7px 10px', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 12, fontFamily: 'var(--font-ui)', fontWeight: 700 }}>{busy ? '…' : 'Withdraw'}</button> : null}
      </div>
      {/* WITHDRAW IS DESTRUCTIVE AND SILENT. It deletes the whole request and the care-team conversation
          attached to it — a simulated 81-year-old lost his appointment details and his thank-you to a one-tap
          Withdraw with no confirm, no undo and no toast. A real dialog, away from the finger that tapped
          Withdraw (not a same-spot second tap — that is the trap the Leave-church change had to avoid), naming
          what goes, with the safe choice first. */}
      {confirming ? (
        <div onClick={() => setConfirming(false)} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(20,15,10,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <div role="dialog" aria-modal="true" aria-label="Withdraw your request for help" onClick={e => e.stopPropagation()}
            style={{ width: 380, maxWidth: '100%', background: 'var(--surface)', borderRadius: 20, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 22 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, marginBottom: 10 }}>Withdraw this request?</div>
            <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 8px' }}>Your ask for help, and the private conversation about it, will be removed. This can’t be undone — you’d start a fresh request.</p>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 18px' }}>If you just don’t need help right now, that’s fine — nobody is troubled by a request you close.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirming(false)} style={{ flex: 1.2, padding: 12, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Keep it</button>
              <button onClick={async () => { setConfirming(false); setBusy(true); setFailed(false); let ok = null; try { ok = await onCancel(); } catch (e) {} setFailed(!ok); setBusy(false); }} style={{ flex: 1, padding: 12, borderRadius: 12, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Withdraw</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Care-team Requests (care-admins only): incoming ask-for-help requests to triage → Approve into a need,
// Message the person, or Decline. Visible only to a member on the care-team roster.
function CareRequestCard({ r, ctx, child, onApprove, onDecline, canMessage, onMessage }) {
  const [busy, setBusy] = React.useState('');
  // Closing somebody's request for help is the one action here that cannot be seen to have worked: the card
  // stays until the relay echoes the change back. Silence therefore reads as success. The console's copy of
  // this card was given the same line on 2026-09-02; this one — the member-app care team — had not been.
  const [failed, setFailed] = React.useState(false);
  const who = r.forSelf ? (careName(r.from, '') || 'a member') : (r.forName || 'someone');
  const when = ({ once: 'Just once', ongoing: 'For a while', unsure: 'Not sure yet' })[r.when] || '';
  const urg = ({ soon: 'This week', month: 'Soon', norush: 'No rush' })[r.urgency] || '';
  return (
    <div style={{ padding: 15, borderRadius: 18, background: 'var(--surface)', border: '1.5px solid color-mix(in oklab, var(--clay) 34%, var(--line))', boxShadow: 'var(--shadow)', marginBottom: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', color: 'var(--clay)' }}><Icon name={CARE_TYPE_ICON[r.type] || 'heart'} size={19} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5, color: 'var(--ink)' }}>{careTypeLabel(r)} · for {who}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{[when, urg].filter(Boolean).join(' · ') || 'Asked for help'}</div>
        </div>
      </div>
      {r.sealed ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)', fontStyle: 'italic' }}>Details hidden — this device isn’t on the care team’s key list.</div>
        : r.note ? <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap', padding: '2px 0 4px' }}>{r.note}</div> : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {/* NOT FOR A CHILD. "Set up help" publishes a NEED — which the whole congregation reads, signs up to,
            and which carries the person's name. That is the route by which a private disclosure becomes a
            notice-board item, so the control is absent rather than disabled: a greyed button invites a tap and
            reads as a fault. `child` is passed from the caller, and `onApprove` is null there as well, so a
            future edit that forgets one of the two still does not publish a child's words. */}
        {!r.sealed && !child ? <button onClick={onApprove} className="care-btn" style={{ flex: 1, minWidth: 120, padding: '10px', borderRadius: 12, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Icon name="check" size={15} color="var(--on-clay)" stroke={2.6} /> Set up help</button> : null}
        {canMessage ? <button onClick={onMessage} style={{ padding: '10px 14px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="chat" size={14} color="currentColor" /> Message</button> : null}
        <button onClick={async () => { setBusy('d'); setFailed(false); let ok = null; try { ok = await onDecline(); } catch (e) {} setFailed(!ok); setBusy(''); }} disabled={busy === 'd'} style={{ padding: '10px 14px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-3)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>{busy === 'd' ? '…' : 'Close — not needed'}</button>
      </div>
      {failed ? <div role="alert" style={{ fontSize: 12.5, color: 'var(--clay-deep, #b4462f)', marginTop: 9, lineHeight: 1.45 }}>That didn’t reach the church — this request is still open, and the person who asked has not been told anything.</div> : null}
    </div>
  );
}

function ApproveNeedSheet({ req, ctx, onClose, onDone }) {
  // Dates are CALENDAR days, so never round-trip them through UTC: `new Date('YYYY-MM-DDT00:00:00')` parses as
  // LOCAL midnight and `.toISOString()` then renders the UTC day — which is the PREVIOUS day everywhere east of
  // Greenwich (BST included). That shipped needs dated yesterday, i.e. already expired and invisible. Build the
  // day list from the date parts in UTC (Date.UTC + toISOString agree), and default from the LOCAL calendar day.
  const _pad = (n) => String(n).padStart(2, '0');
  const localToday = () => { const x = new Date(); return x.getFullYear() + '-' + _pad(x.getMonth() + 1) + '-' + _pad(x.getDate()); };
  const dayRange = (a, b) => { const out = []; try { const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number); let t = Date.UTC(y1, m1 - 1, d1); const end = Date.UTC(y2, m2 - 1, d2); for (let i = 0; i < 90 && t <= end; i++) { out.push(new Date(t).toISOString().slice(0, 10)); t += 86400000; } } catch (e) {} return out; };
  const today = localToday();
  // DO NOT GUESS THE DAY. These started on today, so a request whose own words say "Hospital appointment
  // Thursday" was set up for today, the steward left the box alone, and the volunteer was booked to drive her
  // on the Sunday. She could not correct it afterwards either.
  // Nothing here can know which day she means — the day is in her sentence, in English. So it must not
  // pretend to know. Empty makes the steward look at it, which is the whole of the fix.
  const [start, setStart] = React.useState('');
  const [end, setEnd] = React.useState('');
  const [notes, setNotes] = React.useState(req.note || '');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const submit = async () => {
    if (!start) { setErr('Pick the day this is needed — check what they asked for.'); return; }
    setBusy(true); setErr('');
    const dates = dayRange(start, (!end || end < start) ? start : end);
    let ok = null;
    try { ok = await window.Fellowship.approveCareRequest(req, { dates, notes }); } catch (e2) { setErr((e2 && e2.message) || 'Couldn’t set up the need.'); setBusy(false); return; }
    setBusy(false);
    if (!ok) { setErr('Couldn’t set up the need — try again.'); return; }
    // Two publishes; the second can fail alone. Saying only "Opened as a need" would leave the asker still
    // reading "your care team will be in touch" with no idea it had been set up.
    onDone(ok);
  };
  const fld = { width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 14.5, fontFamily: 'var(--font-ui)', outline: 'none' };
  const lbl = { fontSize: 11.5, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '16px 0 8px' };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(34,28,22,.44)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      {/* ⚠ `maxHeight` + `overflowY` ARE LOAD-BEARING, same as AskForHelpForm below. This sheet is hand-rolled
          rather than a <BottomSheet>, so nothing caps it: uncapped on a phone HELD SIDEWAYS (730x360) it
          measured 373px in a 360px space and started at y=-12, with the "Set up help" heading off the top and
          nothing to scroll back up with (scripts/the-hand-rolled-sheets-can-be-answered.test.mjs).
          ⚠ AND THE KEYBOARD CASE IS NOT PROVED BY THAT TEST. This form has date fields and a notes box, so
          the on-screen keyboard WILL be open in normal use, which leaves roughly 400px of height on an
          upright phone — where the sheet measured 398px. A headless browser has no keyboard; that case needs
          the handset. */}
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Set up help" style={{ width: '100%', maxWidth: 460, maxHeight: '88%', overflowY: 'auto', background: 'var(--surface)', borderRadius: '22px 22px 0 0', border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: '22px 20px calc(24px + env(safe-area-inset-bottom))' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21 }}>Set up help</div>
        {/* SAY WHAT THIS ACTUALLY OPENS. approveCareRequest mints ONE need, from the FIRST kind
            (`type: req.type` — fellowship.src.js). When requests could only name one kind, naming the request
            and naming the need were the same sentence. They stopped being the same the moment a request could
            say "Rides · Errands", and this line was changed to the full list — promising a need for both and
            opening one. The approval also drops the request out of the open queue, so the second kind would
            have vanished silently while the asker's own row read "approved". */}
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '4px 0 0' }}>Opens a need for <b style={{ color: 'var(--ink)' }}>{CARE_TYPE_LABEL[req.type] || 'help'}</b> the church can sign up for. Pick the dates — you can refine it later in the console.</p>
        {careExtraKinds(req).length ? (
          <p style={{ fontSize: 13, color: 'var(--clay-deep, #b4462f)', lineHeight: 1.5, margin: '8px 0 0', fontWeight: 600 }}>
            They also asked about <b>{careExtraKinds(req).join(' and ')}</b>. That isn’t covered by this need — set it up separately, or message them.
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><div style={lbl}>From</div><input type="date" value={start} onChange={e => setStart(e.target.value)} style={fld} /></div>
          <div style={{ flex: 1 }}><div style={lbl}>To</div><input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} style={fld} /></div>
        </div>
        <div style={lbl}>Notes for the team (optional)</div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ ...fld, minHeight: 70, resize: 'vertical', lineHeight: 1.45 }} />
        {err ? <div style={{ fontSize: 13, color: 'var(--clay-deep, #b4462f)', fontWeight: 700, marginTop: 12 }}>{err}</div> : null}
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 13, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Cancel</button>
          <button onClick={submit} disabled={busy} style={{ flex: 2, padding: 13, borderRadius: 14, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', fontWeight: 800, fontSize: 15, cursor: busy ? 'wait' : 'pointer', fontFamily: 'var(--font-ui)', opacity: busy ? .7 : 1 }}>{busy ? 'Setting up…' : 'Open the need'}</button>
        </div>
      </div>
    </div>
  );
}

// A request's shared care-team↔asker thread. Live (fixes the original "doesn't update till reload"): messages
// come from Fellowship.subscribeCareChat and re-render as they arrive; sending goes through sendCareChat.
function CareChatSheet({ reqId, requesterPub, title, onClose }) {
  const [msgs, setMsgs] = React.useState([]);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // A FAILED SEND USED TO BE INVISIBLE. The text was restored to the box and nothing else happened, which
  // reads as "I mistyped" rather than "that did not send". sendCareChat now refuses rather than falling back
  // to the care rota when it cannot establish who the thread reaches, so silence here would hide exactly the
  // case this round exists to fix.
  const [err, setErr] = React.useState('');
  const endRef = React.useRef(null);
  React.useEffect(() => {
    if (!(window.Fellowship && window.Fellowship.subscribeCareChat)) return;
    let unsub = null;
    try { unsub = window.Fellowship.subscribeCareChat(reqId, list => setMsgs(list || [])); } catch (e) {}
    return () => { try { unsub && unsub(); } catch (e) {} };
  }, [reqId]);
  React.useEffect(() => { try { endRef.current && endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' }); } catch (e) {} }, [msgs.length]);
  const send = async () => {
    const t = text.trim(); if (!t || busy) return;
    setText(''); setBusy(true); setErr('');
    let ok = null;
    try { ok = await window.Fellowship.sendCareChat(reqId, requesterPub, t); } catch (e) {}
    setBusy(false);
    // truthy = sent, falsy = not sent. Deliberately NOT an {error} object: a truthy error would read as
    // success to every `if (!ok)` caller, and there is more than one.
    if (!ok) { setText(t); setErr('Couldn’t send — we couldn’t confirm who this conversation reaches. Check your connection and try again.'); }
  };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 65, background: 'rgba(34,28,22,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Care conversation" style={{ width: '100%', maxWidth: 500, height: '82%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: '22px 22px 0 0', border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 18px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <Icon name="heart" size={19} color="var(--clay)" />
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || 'Care conversation'}</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Private — only the people helping you</div></div>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 4, display: 'flex' }}><Icon name="x" size={20} color="currentColor" /></button>
        </div>
        <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {msgs.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)', textAlign: 'center', margin: 'auto', maxWidth: 250, lineHeight: 1.5 }}>No messages yet. Anything here stays between you and the people helping you.</div> : null}
          {msgs.map(m => (
            <div key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
              {!m.mine ? <div style={{ fontSize: 11, color: 'var(--ink-3)', margin: '0 0 2px 11px' }}>{careName(m.from, '')}</div> : null}
              <div style={{ padding: '9px 13px', borderRadius: 15, background: m.mine ? 'var(--clay)' : 'var(--surface-2)', color: m.mine ? '#fff' : 'var(--ink)', fontSize: 14.5, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        {err ? <div role="alert" style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink)', background: 'color-mix(in oklab, var(--clay) 10%, var(--surface))', borderTop: '1px solid color-mix(in oklab, var(--clay) 26%, var(--line))', padding: '10px 14px', flexShrink: 0 }}>{err}</div> : null}
        <div style={{ display: 'flex', gap: 8, padding: '12px 14px calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--line)', flexShrink: 0 }}>
          <input value={text} maxLength={4000} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(); } }} placeholder="Write a message…" style={{ flex: 1, minWidth: 0, padding: '11px 14px', borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 14.5, fontFamily: 'var(--font-ui)', outline: 'none' }} />
          <button onClick={send} disabled={busy || !text.trim()} aria-label="Send" style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 999, border: 'none', background: text.trim() ? 'var(--clay)' : 'var(--surface-2)', color: text.trim() ? '#fff' : 'var(--ink-3)', cursor: text.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="send" size={18} color="currentColor" /></button>
        </div>
      </div>
    </div>
  );
}

function CareRequests({ ctx }) {
  const care = ctx.care || {};
  const myPub = (care.myPub || '').toLowerCase();
  const s = care.settings || {};
  const isCareAdmin = (() => { const roster = (ctx.churchRosters || []).find(r => r.team === s.adminGroupId); return !!(roster && (roster.people || []).some(p => (p.pub || '').toLowerCase() === myPub)); })();
  // A CLEARED ADULT MUST HAVE SOMEWHERE TO SEE THIS. The console had a children's queue and this screen — the
  // OTHER copy of the same triage, the one on a phone — did not; and this screen only ever opened for a care
  // admin. After the relay was corrected so that clearance GRANTS access, a cleared youth worker who is not on
  // the care rota began receiving children's requests with no screen anywhere that would show them one. That
  // is the same "sent and nobody comes" failure, moved up a layer.
  const isCleared = !!(ctx.safeguard && ctx.safeguard.cleared);
  const [reqs, setReqs] = React.useState([]);
  const [approving, setApproving] = React.useState(null);
  const [chatting, setChatting] = React.useState(null);
  React.useEffect(() => {
    if (!(isCareAdmin || isCleared) || !(window.Fellowship && window.Fellowship.subscribeCareRequests)) return;
    let unsub = null;
    // NOT MY OWN REQUEST. This is the queue of requests I am handling FOR OTHER PEOPLE; the one I made for
    // myself already has its own row, from AskForHelp, a few lines down the same screen. Leaving it here put
    // it through fromChild() below, which answers "yes" for anyone who is not a care admin — so a cleared
    // youth worker who asked for help himself found his own ordinary request filed under "FROM A YOUNG
    // PERSON · CONFIDENTIAL", with the safeguarding explainer above it. Measured on the OPPO, 2026-08-27.
    // Worse than the label: row() passes onApprove = null for anything marked as a child, so it could not be
    // actioned from that screen at all.
    // …but only the one I raised FOR MYSELF. A care admin often files a request on behalf of somebody
    // housebound who is not on the app: that request is authored by the admin, so excluding everything they
    // wrote hid it from the only screen where it can be approved into a need. In a church with a single admin
    // nobody could action it at all. Audit, 2026-08-28. `forSelf` is false only when they picked "Someone
    // else" on the form, and they can always open their own request, so the flag is readable here.
    try { unsub = window.Fellowship.subscribeCareRequests(list => setReqs((list || []).filter(r => r.status === 'open' && !(String(r.from || '').toLowerCase() === myPub && r.forSelf !== false))), ctx.church && ctx.church.npub); } catch (e) {}
    return () => { try { unsub && unsub(); } catch (e) {} };
    // …and on ctx.connTick. Without it a socket that dropped and returned left this list frozen: the console's
    // twin showed a care request as still needing "Set up help" while the need made from it already existed
    // (measured 2026-09-04), and a care admin reading that sets the same help up twice. screens-chat.jsx
    // carries the same dep for the same reason.
  }, [isCareAdmin, isCleared, myPub, ctx.church && ctx.church.npub, ctx.connTick]);
  if (!(isCareAdmin || isCleared) || !reqs.length) return null;
  // WHICH OF THESE CAME FROM A YOUNG PERSON. A care admin is served the church's list of children and can
  // simply look. A cleared adult who is NOT a care admin is not served that list — and does not need it: the
  // relay serves them a child's request and nothing else, so everything they are holding is one. Reading the
  // absence of the list as "no children here" is what would put a child's disclosure in the ordinary queue,
  // beside the button that publishes it to the whole congregation.
  const _kids = new Set(((ctx.safeguard && ctx.safeguard.minors) || []).map(x => String(x || '').toLowerCase()));
  // Anyone who is not a care admin is served ONLY children's requests by the relay (their clearance is what
  // grants it), so "assume confidential" is the right default for what remains here — but it is a default, not
  // knowledge. My own request is excluded upstream, which is the case it used to get wrong.
  // MY OWN REQUEST IS NEVER FROM A CHILD — I know who I am, whatever list I am or am not served.
  // 78531b1 excluded all of my own requests from this queue; 744e459 rightly narrowed that, because a care
  // admin filing on behalf of somebody housebound must still see it to approve it. But the narrowing only
  // kept back requests I raised FOR MYSELF, and `fromChild` answers "yes" unconditionally for anyone who is
  // not a care admin. So a cleared youth worker asking for help for a neighbour found their own request
  // under "FROM A YOUNG PERSON · CONFIDENTIAL" with the safeguarding explainer — and row() passes
  // onApprove = null for anything marked as a child, so it could not be actioned from the only screen that
  // shows it. Audit, 2026-08-29.
  // FAIL CLOSED WHILE WE DO NOT YET KNOW WHO THE CHILDREN ARE. Audit 2026-09-04.
  //
  // This asked `_kids` a question it could not yet answer. The lists arrive over a subscription, so for the
  // first moments of every launch `_kids` is EMPTY — and an empty set answers "no, not a child" exactly as
  // confidently as a loaded one does. A request arriving in that window was filed with the adults, under
  // "Set up help", and that button publishes a NEED the whole congregation reads and signs up to. That is a
  // young person's private disclosure turned into a notice-board item with their name on it, and nothing on
  // the screen looked wrong.
  //
  // The console's copy of this triage was fixed on 2026-09-03 and this one — the same job, done by a care
  // admin on their PHONE — was left. `minorsKnown` and not "is the list non-empty": a church that has never
  // marked a child never publishes the document, so gating on the list itself would hold every request in the
  // confidential queue for ever in exactly those churches, which is the care module silently switched off.
  // See subscribeChurchSafeguard.
  const _minorsKnown = !!(ctx.safeguard && ctx.safeguard.minorsKnown);
  const fromChild = (r) => {
    if (String(r.from || '').toLowerCase() === myPub) return false;
    if (!isCareAdmin) return true;
    return _minorsKnown ? _kids.has(String(r.from || '').toLowerCase()) : true;
  };
  const childReqs = reqs.filter(fromChild), adultReqs = reqs.filter(r => !fromChild(r));
  const row = (r, child) => <CareRequestCard key={r.id} r={r} ctx={ctx} child={child} onApprove={child ? null : () => setApproving(r)} onDecline={() => window.Fellowship.declineCareRequest(r)} canMessage={!!(!ctx.canDMPeer || ctx.canDMPeer(r.from))} onMessage={() => setChatting({ reqId: r.id, requesterPub: r.from, title: 'Help · ' + (r.forSelf ? (careName(r.from, '') || 'a member') : (r.forName || 'someone')) })} />;
  return (
    <div style={{ marginBottom: 18 }}>
      {childReqs.length ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.5px', color: 'var(--clay-deep, #b4462f)', margin: '2px 0 8px', display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="shield" size={15} color="var(--clay)" /> {_minorsKnown ? 'FROM A YOUNG PERSON · ' + childReqs.length + ' · CONFIDENTIAL' : 'CHECKING WHO THESE ARE FROM · ' + childReqs.length + ' · HELD CONFIDENTIAL'}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 10px', padding: '9px 12px', borderRadius: 13, background: 'color-mix(in oklab, var(--clay) 7%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 22%, var(--line))' }}>
            {_minorsKnown
              ? 'You are seeing this because your church has cleared you to work with young people. Reply privately below. There is no “set up help” here on purpose — that publishes a need the whole church reads and signs up to. Follow your church’s safeguarding policy.'
              : 'Still checking which of these came from a young person, so all of them are being held here for now. Reply privately below. “Set up help” is not offered until we know — it publishes a need the whole church reads.'}
          </div>
          {childReqs.map(r => row(r, true))}
        </div>
      ) : null}
      {adultReqs.length ? (
        <React.Fragment>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.5px', color: 'var(--clay-deep, #b4462f)', margin: '2px 0 10px', display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="heart" size={15} color="var(--clay)" /> REQUESTS FOR HELP · {adultReqs.length}</div>
      {adultReqs.map(r => row(r, false))}
        </React.Fragment>
      ) : null}
      {approving ? <ApproveNeedSheet req={approving} ctx={ctx} onClose={() => setApproving(null)} onDone={(res) => { setApproving(null); ctx.toast && (res && res.stillOpen
        ? ctx.toast('Opened as a need — but we couldn’t close the request, so it still shows as open. Close it once you’re back online.', { error: true })
        : ctx.toast('Opened as a need')); }} /> : null}
      {chatting ? <CareChatSheet reqId={chatting.reqId} requesterPub={chatting.requesterPub} title={chatting.title} onClose={() => setChatting(null)} /> : null}
    </div>
  );
}

// ── ONE ASK IS ONE ASK, EVEN WHEN THE SEND HAS TO BE REPEATED ────────────────────────────────────────────
//
// A family tapped Send, the relay TOOK the request but did not acknowledge it in time, the sheet said
// "Couldn't send — check your connection and try again", and they tapped Send again. That minted a SECOND
// request, because publishCareRequest used to choose the id's random tail on every call. The care team saw
// two families' worth of need where there was one and organised two meal trains. Measured against a live
// gateway, 2026-09-16.
//
// So the tail is chosen HERE, once, when the sheet OPENS — a care request is an addressable document, and
// two writes at one id leave one document, so a retry REPLACES rather than adds. It is handed to the engine
// as `draftId`; the engine still builds the id (`<asker>-<tail>`) and still refuses anything that is not
// plain hex of the right length, so the relay's ownership rule is untouched.
//
// WHY IT IS WRITTEN DOWN AND NOT JUST HELD IN STATE: a low-memory Android will kill this app while the
// member is staring at a failed send, and a nonce that died with the process would duplicate on the retry
// after the restart — the exact case the fix exists for.
//
// WHY IT IS THROWN AWAY ON CLOSE: closing and reopening the sheet is a person deciding to ask again, and a
// family that genuinely needs to ask twice must be able to — even in identical words. So a deliberate close
// (Cancel, or tapping the backdrop) drops it, and so does a confirmed send. Being killed does neither,
// which is exactly the distinction wanted.
//
// ⚠ RANDOM, NEVER DERIVED FROM WHAT THEY WROTE. The d-tag is in the CLEAR on the relay even though the body
// is sealed, so an id hashed from a short note plus a known member key is guessable — it would let a relay
// operator confirm what somebody asked for help about.
const CARE_DRAFT_KEY = 'trinityone.carereq.draft';
// Per church: the same member may belong to two, and an addressable id belongs to (author, kind, d-tag)
// with no church in it — so one nonce carried across a church switch would overwrite the other church's
// request. The suffix is never read back for anything but this.
const _careDraftKey = () => CARE_DRAFT_KEY + '.' + ((window.Fellowship && window.Fellowship.churchPub) || '');
// ⚠ AND IT EXPIRES. An independent review measured the hole this closes: the tail was dropped only by Cancel,
// by the backdrop, or by a confirmed send — and Android's BACK button closes the Serving page UNDERNEATH this
// sheet, so the sheet's own close never runs and the tail survived for ever. Weeks later the member's next,
// unrelated ask would land at the SAME address and quietly REPLACE a request the care team may already have
// acted on, with neither side told. The unmount cleanup below is the real fix; this age limit is the
// belt-and-braces for every other way out nobody has thought of yet — a church switch with the sheet open,
// the care feature being turned off, a restore. A retry a member makes in the moment is seconds later, never
// hours, so nothing legitimate is lost by forgetting a stale one.
const CARE_DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
function _careDraftId() {
  let k = '', raw = '';
  try { raw = localStorage.getItem(_careDraftKey()) || ''; } catch (e) {}
  const dot = raw.lastIndexOf('.');
  if (dot > 0) {
    const at = Number(raw.slice(dot + 1));
    // A clock that has stepped BACKWARDS must not make a stale tail look fresh, so an age that is not a
    // sane positive number is treated as expired rather than trusted.
    if (Number.isFinite(at) && Date.now() - at >= 0 && Date.now() - at < CARE_DRAFT_MAX_AGE_MS) k = raw.slice(0, dot);
  }
  if (/^[0-9a-f]{16}$/.test(k)) return k;
  const b = new Uint8Array(8);
  try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256); }
  k = Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(_careDraftKey(), k + '.' + Date.now()); } catch (e) {}
  return k;
}
function _clearCareDraft() { try { localStorage.removeItem(_careDraftKey()); } catch (e) {} }

// WHAT WE MAY HONESTLY TELL SOMEONE WHO HAS JUST ASKED FOR HELP.
// publishCareRequest seals a copy of the request to each recipient it can name, and it names them at send
// time from the church's published care-team roster. When that roster cannot be established — a relay still
// connecting, or one that has not answered the auth challenge, both of which answer EMPTY rather than
// failing — the only key holders are the church leader and the asker. "Sent to your care team" is then a
// false sentence about the one message where being wrong matters most: the person believes several people
// know, and nobody comes. Simulation 2026-08-19, R3-7.
// WHY A CHILD'S REQUEST WAS NOT SENT, in words a worried young person can act on. Never "error", never a
// code, and never anything that reads as their fault. Each one ends with something they can actually do.
const CARE_SEND_REFUSAL = {
  'no-one-cleared': 'Your church hasn’t set up who can help young people yet. Please speak to a leader in person — they can sort this out for you.',
  'unknown-audience': 'We couldn’t check who can help you right now. Try again in a moment, or speak to a leader in person.',
  'unknown-clearance': 'We couldn’t check your account with your church yet. Try again in a moment, or speak to a leader in person.',
  // The relay refuses a request from a build that predates self-naming request ids. Without this the member is
  // told to check their connection, which sends them looking in the wrong place on the one screen where that
  // matters most. This build cannot itself produce that refusal — it always mints a naming id — so it is
  // insurance for the NEXT time the relay has to refuse an old app, not for this change.
  'stale-app': 'Please update the app to ask for help — this version can’t send a request. If you can’t update right now, speak to a leader in person.',
  // NOT SENT, and not the member's connection. Under the closed relay network nothing is published to an
  // address that has not shown it is one of this church's relays, so the request can fail with a perfectly
  // good signal — and "check your connection" would send someone asking for help to stare at their wifi.
  // Say plainly that it did not go, and point them at a person, because that is the route that still works.
  'no-network-relay': 'Your request was NOT sent — we couldn’t reach a relay your church runs. Please speak to a leader in person, and try again later.',
  // ── the three honest outcomes of a publish (_pubReason in src/fellowship.src.js) ────────────────────────
  // NOT a verdict, and the reason this whole change exists. Nobody answered in time; the request is signed,
  // on the wire, and often already stored. "Couldn't send — check your connection" was a false sentence over
  // a perfectly good connection, and it made Send the obvious next tap — which is how one family's ask
  // became two requests and two meal trains. Say what we actually know, and ask them not to re-send yet.
  'unconfirmed': 'We couldn’t confirm that reached your church — it may well have. Don’t send it again yet; check your requests in a moment, or speak to a leader.',
  // SETTLED: nothing left this phone at all.
  'not-sent': 'Your request was NOT sent — it never left this phone. Please speak to a leader in person, and try again when you have a signal.',
  // SETTLED: a relay read it and said no. Retrying the same words will get the same answer, so point at a person.
  'refused': 'Your church’s relay would not accept this request, so it was NOT sent. Please speak to a leader in person — they can sort this out.',
};
// TRUE ONLY OF THE ONE ANSWER THAT IS NOT A VERDICT. Used to decide whether the sheet may fall back to a
// second, different publish, and whether Send is still the obvious next tap.
const careSendUnconfirmed = (res) => !!(res && res.error === 'unconfirmed');
function careSentWording(res) {
  // A YOUNG PERSON DID NOT WRITE TO THE CARE TEAM. Their request goes to the adults their church has cleared,
  // and telling them otherwise names a group of people they did not choose to tell — unsettling in itself, and
  // untrue. Kept deliberately vague about WHO: a child does not need a roster, they need to know it arrived.
  // An OPENED need is not a message to anybody — it is a public thing people sign up to, and how public
  // depends on the church's own visibility setting. Checked first: a need result carries no teamCount, so the
  // "no care team is set up yet" line below would otherwise claim it went to a church leader.
  if (res && res.need) return res.teamOnly ? 'Opened \u2014 your care team is shown it and can sign up' : 'Opened \u2014 your church can see it and sign up to help';
  if (res && res.toChildAudience) return 'Sent \u2014 someone at your church who can help will see this';
  if (res && res.narrowed) return 'Sent to your church leader \u2014 we couldn\u2019t reach the care team list';
  if (res && !res.teamCount) return 'Sent to your church leader \u2014 no care team is set up yet';
  return 'Sent to your care team';
}
function AskForHelpForm({ ctx, onClose, onSent }) {
  // WHO THIS ACTUALLY REACHES DEPENDS ON WHO IS ASKING, so the sheet must not promise otherwise. A young
  // person's request does not go to the care rota — it goes to the adults their church has cleared to work
  // with young people. Found on a real phone, 2026-08-27: the CARD above this sheet had been made
  // child-aware and the sheet had not, so one screen said "Tell someone at your church" and the sheet
  // directly beneath it said "This goes privately to your care team". Both were mine; I changed one.
  const _isMinor = !!(ctx.safeguard && ctx.safeguard.isMinor);
  // WHEN THE CHURCH HAS SAID MEMBERS MAY OPEN NEEDS, this sheet opens one instead of asking for one. Same
  // button in the same place: a second control to go hunting for is exactly how the care page got lost before.
  // A child never opens a need — the relay says so too — so they keep the private request they always had.
  const _care = ctx.care || {};
  // The church's setting is NECESSARY and never SUFFICIENT. `isMinor` has no cache, defaults to false, and
  // waits on a 1.2s timer plus a relay round-trip, while `openedBy` beside it is restored from localStorage
  // instantly — so restating the rule as `!_isMinor && openedBy === 'member'` showed a CHILD the public-need
  // wording for the first seconds of every cold start. Ask the engine, which distinguishes "not a child" from
  // "we have not heard yet", and start from the private wording until it answers. Never over-promise, then
  // settle; the reverse is the harm.
  const _churchAllowsNeeds = !_isMinor && ((_care.settings && _care.settings.openedBy) === 'member');
  const [_engineAllows, setEngineAllows] = React.useState(false);
  React.useEffect(() => {
    if (!_churchAllowsNeeds) { setEngineAllows(false); return; }
    let live = true;
    Promise.resolve(window.Fellowship && window.Fellowship.canOpenCareNeed ? window.Fellowship.canOpenCareNeed() : false)
      .then(ok => { if (live) setEngineAllows(!!ok); })
      .catch(() => { if (live) setEngineAllows(false); });
    return () => { live = false; };
  }, [_churchAllowsNeeds]);
  const _opensNeed = _churchAllowsNeeds && _engineAllows;
  const _teamOnly = (_care.settings && _care.settings.visibility) === 'team';
  const [dates, setDates] = React.useState([]);
  const [pick, setPick] = React.useState('');
  const addDate = () => { if (pick && !dates.includes(pick)) setDates(d => [...d, pick].sort()); setPick(''); };
  const [more, setMore] = React.useState(false);
  const [meals, setMeals] = React.useState(['dinner']);
  const [diet, setDiet] = React.useState([]);
  const toggleMeal = (m) => setMeals(ms => ms.includes(m) ? (ms.length > 1 ? ms.filter(x => x !== m) : ms) : [...ms, m]);
  const [forSelf, setForSelf] = React.useState(true);
  const [forName, setForName] = React.useState('');
  const [types, setTypes] = React.useState([]);
  const [when, setWhen] = React.useState('');
  const [urgency, setUrgency] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  // ⚠ LAZY useState, NOT an effect: the tail has to exist before the first Send, and an effect runs after
  // the draw. One mint per mount, kept for every retry inside this open sheet — see _careDraftId above.
  const [_draftId] = React.useState(_careDraftId);
  // A DELIBERATE CLOSE ENDS THIS ASK. Cancel and the backdrop both come through here so that reopening the
  // sheet is a genuinely new request; only being killed by the system keeps the tail alive.
  const _cancel = () => { _clearCareDraft(); onClose(); };
  // …AND BACK COUNTS AS ONE. Cancel and the backdrop call _cancel; Android's back button does not — it closes
  // the Serving page this sheet lives inside (window.trinityGoBack in app/app.jsx has no entry for this
  // sheet), so onClose never fires and the tail used to survive. Unmounting IS the deliberate close, and it
  // cannot fire when the system kills the app, so the one property worth keeping — a retry after a kill still
  // replaces rather than duplicates — is untouched. A confirmed send clears the tail before this runs.
  React.useEffect(() => () => { _clearCareDraft(); }, []);
  // "We couldn't confirm it" is not "it failed". Once we are in that state Send stops being the obvious next
  // tap — the primary action becomes closing the sheet, and re-sending stays reachable but quiet.
  const [held, setHeld] = React.useState(false);
  const TYPES = Object.keys(CARE_TYPE_LABEL);
  const chip = (active) => ({ padding: '8px 13px', borderRadius: 999, border: '1px solid ' + (active ? 'var(--clay)' : 'var(--line)'), background: active ? 'color-mix(in oklab, var(--clay) 12%, var(--surface))' : 'var(--surface)', color: active ? 'var(--clay-deep, #b4462f)' : 'var(--ink-2)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'inline-flex', alignItems: 'center', gap: 6 });
  const lbl = { fontSize: 11.5, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '18px 0 9px' };
  const submit = async () => {
    if (!types.length) { setErr('Pick what would help.'); return; }
    if (_opensNeed && !dates.length) { setErr('Pick at least one day people can help on.'); return; }
    setBusy(true); setErr('');
    let ok = null;
    try {
      // A NEED IS PUBLIC AND A REQUEST IS NOT. publishCareNeed refuses for a child, and refuses when this
      // church uses safeguarding and has not yet told this phone which this member is. Either way we fall
      // back to the private request — the behaviour that already existed — rather than pressing on or
      // stopping the member from asking at all.
      if (_opensNeed) {
        const r = await window.Fellowship.publishCareNeed({ types, forSelf, forName: forSelf ? '' : forName, note, dates, meals, dietary: diet });
        if (r && !r.error) ok = { ...r, teamOnly: _teamOnly };
        // ⚠ A FALLBACK IS A SECOND PUBLISH, AND A NEED IS PUBLIC. publishCareNeed returned a bare `null` for
        // every failure, including "nobody acknowledged it in time" — and the line below reads falsy as
        // "that did not happen, send the private one instead". Measured 2026-09-16: ONE tap left a PUBLIC
        // need on the relay AND a private care request AND a success toast. The family asked once,
        // privately, and got a public notice as well. That is a privacy failure, not untidiness.
        //
        // So the fallback is allowed only where the need SETTLED as not-happened — every policy refusal
        // ('minor-cannot-open', 'unknown-clearance', 'no-care-key', 'no-dates'), plus 'refused' (a relay
        // read it and said no) and 'not-sent' (nothing left the phone). Never on 'unconfirmed'.
        if (careSendUnconfirmed(r)) {
          setBusy(false); setHeld(true);
          setErr(CARE_SEND_REFUSAL[r.error]);
          return;
        }
      }
      if (!ok) ok = await window.Fellowship.publishCareRequest({ types, forSelf, forName: forSelf ? '' : forName, when, urgency, note, draftId: _draftId });
    } catch (e) {}
    setBusy(false);
    // A REFUSAL IS AN OBJECT TOO. publishCareRequest answers with a reason when it will not send a child's
    // request — it could not tell whether the sender is a child, could not establish who may receive it, or
    // the church has cleared nobody. `if (ok)` read every one of those as success and thanked them for it.
    // …and since 2026-09-16 it also answers with the publish outcome itself ('unconfirmed' | 'not-sent' |
    // 'refused') instead of a bare null, so the sentence below is no longer said over a good connection.
    if (ok && ok.error) { setHeld(careSendUnconfirmed(ok)); setErr(CARE_SEND_REFUSAL[ok.error] || 'Couldn’t send — please try again.'); return; }
    // CONFIRMED. The draft tail has done its job; the next time this sheet opens it is a new ask.
    if (ok) { _clearCareDraft(); onSent(ok); } else setErr('Couldn’t send — check your connection and try again.');
  };
  return (
    <div onClick={_cancel} style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(34,28,22,.44)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Ask for help" style={{ width: '100%', maxWidth: 460, maxHeight: '88%', overflowY: 'auto', background: 'var(--surface)', borderRadius: '22px 22px 0 0', border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: '22px 20px calc(24px + env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Icon name="heart" size={20} color="var(--clay)" />
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21 }}>Ask for help</div>
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 4px' }}>{_isMinor
          ? 'This goes privately to the people at your church who can help young people — no one else sees it. Tell them what would help.'
          : _opensNeed
            ? (_teamOnly
              ? 'Your church lets anyone open a need. Your care team is shown this and can sign up to help — but it is not sealed to them, and anyone at your church could read it. Say only what you are happy for the church to read.'
              : 'Your church lets anyone open a need. Everyone at your church will see this and can sign up to help — so say only what you are happy for the church to read.')
            : 'This goes privately to your care team — no one else sees it. Tell them what would help.'}</p>

        <div style={lbl}>Who's this for?</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setForSelf(true)} style={chip(forSelf)}>Me</button>
          <button onClick={() => setForSelf(false)} style={chip(!forSelf)}>Someone else</button>
        </div>
        {!forSelf ? <input value={forName} onChange={e => setForName(e.target.value)} placeholder="Their name (optional)" style={{ width: '100%', boxSizing: 'border-box', marginTop: 10, padding: '11px 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 14.5, fontFamily: 'var(--font-ui)', outline: 'none' }} /> : null}

        <div style={lbl}>What would help? <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: 'var(--ink-3)' }}>Pick as many as you need</span></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {TYPES.map(t => {
            const on = types.indexOf(t) >= 0;
            return <button key={t} role="checkbox" aria-checked={on} onClick={() => setTypes(on ? types.filter(x => x !== t) : [...types, t])} style={chip(on)}><Icon name={on ? 'check' : CARE_TYPE_ICON[t]} size={14} color="currentColor" /> {CARE_TYPE_LABEL[t]}</button>;
          })}
        </div>

        {_opensNeed ? (
          <React.Fragment>
            <div style={lbl}>Which days? <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: 'var(--ink-3)' }}>People sign up per day</span></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="date" value={pick} min={todayISO()} onChange={e => setPick(e.target.value)} aria-label="Pick a day people can help on" style={{ flex: 1, boxSizing: 'border-box', padding: '11px 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 14.5, fontFamily: 'var(--font-ui)', outline: 'none' }} />
              <button onClick={addDate} disabled={!pick} style={{ ...chip(false), opacity: pick ? 1 : .5, cursor: pick ? 'pointer' : 'default' }}>Add day</button>
            </div>
            {dates.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {dates.map(d => <button key={d} onClick={() => setDates(ds => ds.filter(x => x !== d))} aria-label={'Remove ' + d} style={chip(true)}>{d} <Icon name="x" size={12} color="currentColor" /></button>)}
              </div>
            ) : null}

            {/* EXPANDABLE, not a second screen. Everything below is optional detail the care team can fill in
                afterwards; the need is already usable without it. Dietary sits here rather than in the short
                form only because it is meals-only — it is the one field where an omission actually matters. */}
            <button onClick={() => setMore(v => !v)} aria-expanded={more} style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 7, border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 13, color: 'var(--clay)' }}>
              <Icon name={more ? 'chevD' : 'chevR'} size={14} color="currentColor" /> {more ? 'Fewer details' : 'Add details (optional)'}
            </button>
            {more ? (
              <React.Fragment>
                {types.indexOf('meals') >= 0 ? (
                  <React.Fragment>
                    <div style={lbl}>Which meals?</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {CARE_MEALS.map(([k, l]) => <button key={k} role="checkbox" aria-checked={meals.indexOf(k) >= 0} onClick={() => toggleMeal(k)} style={chip(meals.indexOf(k) >= 0)}>{l}</button>)}
                    </div>
                    <div style={lbl}>Anything they can't eat?</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {CARE_DIET.map(dd => <button key={dd} role="checkbox" aria-checked={diet.indexOf(dd) >= 0} onClick={() => setDiet(ds => ds.indexOf(dd) >= 0 ? ds.filter(x => x !== dd) : [...ds, dd])} style={chip(diet.indexOf(dd) >= 0)}>{dd}</button>)}
                    </div>
                  </React.Fragment>
                ) : <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 12, lineHeight: 1.5 }}>Nothing else to add for this kind of help — your care team can fill in the rest.</div>}
              </React.Fragment>
            ) : null}
          </React.Fragment>
        ) : null}

        <div style={lbl}>When?</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {CARE_WHEN.map(([k, l]) => <button key={k} onClick={() => setWhen(when === k ? '' : k)} style={chip(when === k)}>{l}</button>)}
        </div>

        <div style={lbl}>How urgent?</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {CARE_URGENCY.map(([k, l]) => <button key={k} onClick={() => setUrgency(urgency === k ? '' : k)} style={chip(urgency === k)}>{l}</button>)}
        </div>

        <div style={lbl}>Anything they should know?</div>
        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="A sentence or two — as much or as little as you like." style={{ width: '100%', boxSizing: 'border-box', minHeight: 84, resize: 'vertical', padding: 12, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 14.5, fontFamily: 'var(--font-ui)', outline: 'none', lineHeight: 1.45 }} />

        {err ? <div style={{ fontSize: 13, color: 'var(--clay-deep, #b4462f)', fontWeight: 700, marginTop: 12 }}>{err}</div> : null}
        {/* ONCE WE CANNOT CONFIRM IT, SEND IS NO LONGER THE OBVIOUS NEXT TAP. The request is probably already
            with the church, so the two controls swap weight: closing becomes the primary action and sending
            again stays reachable but quiet. A re-send from here writes to the SAME id and replaces, so even
            a member who taps it anyway still leaves one request — this is belt as well as braces. */}
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={_cancel} style={held
            ? { flex: 2, padding: 13, borderRadius: 14, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', fontWeight: 800, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)' }
            : { flex: 1, padding: 13, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>{held ? 'Close' : 'Cancel'}</button>
          <button onClick={submit} disabled={busy} style={held
            ? { flex: 1, padding: 13, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', fontWeight: 700, fontSize: 14, cursor: busy ? 'wait' : 'pointer', fontFamily: 'var(--font-ui)', opacity: busy ? .7 : 1 }
            : { flex: 2, padding: 13, borderRadius: 14, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', fontWeight: 800, fontSize: 15, cursor: busy ? 'wait' : 'pointer', fontFamily: 'var(--font-ui)', opacity: busy ? .7 : 1 }}>{busy ? (_opensNeed ? 'Opening…' : 'Sending…') : held ? 'Send it again' : (_isMinor ? 'Send' : _opensNeed ? 'Open this need' : 'Send to care team')}</button>
        </div>
      </div>
    </div>
  );
}

// linkOnly = the Today screen. Today shows the ask as a LINK to the Care page and opens no sheet of its own.
// Not a style preference: Today wraps this section in `animation: trinityFade … both`, and the identity
// transform an animation leaves behind becomes the containing block for `position: absolute`. Both sheets
// below are absolute+inset:0 backdrops — the house pattern, correct in 48 other places — so on Today they were
// trapped inside the card's own 122px box, drawn over the "Practical care" heading with their content cut off
// mid-word. Measured on the OPPO, 2026-08-27: overlay 324x107 at top 429 instead of full screen.
// The card only moved to Today in af7824b, because three members hunted for care inside "Serving & events"
// and never found it. Keep that discoverability; open the form where its backdrop still works.
function AskForHelp({ ctx, linkOnly }) {
  const care = ctx.care || {};
  const myPub = (care.myPub || '').toLowerCase();
  const careOn = !!(care.settings && care.settings.enabled);
  const [mine, setMine] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const [chatting, setChatting] = React.useState(null);
  // A CHILD IS ASKED A DIFFERENT QUESTION, AND ASKED IT BEFORE THEY TYPE ANYTHING. Their request does not go
  // to the care rota — it goes to the adults the church has cleared to be near young people — so the first
  // thing to find out is whether that church has cleared anybody at all. undefined = still asking, null = we
  // could not find out, [] = nobody, a list = these people.
  //
  // The alternative is what this replaces: a form, a send, a thank-you, and not one person who can read it.
  // For a child working up to telling someone something difficult, that is the worst thing the app can do.
  const isMinor = !!(ctx.safeguard && ctx.safeguard.isMinor);
  const [audience, setAudience] = React.useState(undefined);
  // WHO IS CLEARED CHANGES WHILE A CHILD IS LOOKING AT THIS SCREEN, and this used to be fetched once.
  // Measured on the OPPO, 2026-08-27: with nobody cleared, a young person is correctly told "your church
  // hasn't set up who can help young people yet — please speak to a leader". They do. The leader clears
  // somebody. The card keeps saying it, and keeps the ask control hidden, until the app is restarted. That is
  // the worst possible moment for a stale screen: the child did the one thing it asked of them and the app
  // still says there is nobody. A joined string, not the array, because subscribeChurchSafeguard emits a
  // fresh identity on every tick and depending on that would refetch forever.
  const _clearedKey = (((ctx.safeguard && ctx.safeguard.approved) || []).join(','));
  React.useEffect(() => {
    if (!isMinor || !ctx.church || !(window.Fellowship && window.Fellowship.childCareAudience)) { setAudience(undefined); return; }
    let live = true;
    window.Fellowship.childCareAudience(ctx.church.npub)
      .then(a => { if (live) setAudience(a); })
      .catch(() => { if (live) setAudience(null); });
    return () => { live = false; };
  }, [isMinor, ctx.church && ctx.church.npub, _clearedKey]);
  React.useEffect(() => {
    if (!ctx.church || !(window.Fellowship && window.Fellowship.subscribeCareRequests)) return;
    let unsub = null;
    try { unsub = window.Fellowship.subscribeCareRequests(list => setMine((list || []).filter(r => (r.from || '').toLowerCase() === myPub)), ctx.church && ctx.church.npub); } catch (e) {}
    return () => { try { unsub && unsub(); } catch (e) {} };
  }, [ctx.church && ctx.church.npub, myPub, ctx.connTick]);   // re-subscribe after a reconnect — see the note above
  if (!careOn) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      {mine.map(r => <MyRequestRow key={r.id} r={r} isMinor={isMinor} onCancel={() => window.Fellowship.cancelCareRequest(r.id)} onMessage={() => { if (linkOnly) { ctx.openServing && ctx.openServing('care'); return; } setChatting({ reqId: r.id, requesterPub: (care.myPub || ''), title: (isMinor ? 'Your church' : 'Your care team') }); }} />)}
      {!linkOnly && chatting ? <CareChatSheet reqId={chatting.reqId} requesterPub={chatting.requesterPub} title={chatting.title} onClose={() => setChatting(null)} /> : null}
      {isMinor && (audience !== undefined) && (!audience || !audience.length) ? (
        // NO FORM. Not a disabled button either — a greyed-out control invites tapping it and reads as a fault
        // with their phone. A plain, calm sentence, and the one thing they can actually do.
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13, padding: '14px 16px', borderRadius: 18, border: '1px solid var(--line)', background: 'var(--surface)', fontFamily: 'var(--font-ui)' }}>
          <div style={{ width: 42, height: 42, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, var(--clay) 10%, var(--surface))', color: 'var(--clay)' }}><Icon name="heart" size={22} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>Need a hand?</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 3, lineHeight: 1.5 }}>
              {audience === null
                ? 'We couldn’t check who can help you right now. Please speak to a leader at your church — or try again in a moment.'
                : 'Your church hasn’t set up who can help young people yet. Please speak to a leader at your church — they can sort this out for you.'}
            </div>
          </div>
        </div>
      ) : (
      <button onClick={() => { if (linkOnly) { ctx.openServing && ctx.openServing('care'); return; } setOpen(true); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '14px 16px', borderRadius: 18, border: '1px solid color-mix(in oklab, var(--clay) 28%, var(--line))', background: 'color-mix(in oklab, var(--clay) 7%, var(--surface))', cursor: 'pointer', fontFamily: 'var(--font-ui)', textAlign: 'left' }}>
        <div style={{ width: 42, height: 42, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)' }}><Icon name="heart" size={22} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>Ask for help</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1, lineHeight: 1.4 }}>{isMinor ? 'Tell someone at your church what would help — privately.'
              : (care.settings && care.settings.openedBy) === 'member' ? 'Tell your church what would help.'
              : 'Tell your care team what would help — privately.'}</div>
        </div>
        <Icon name="chevR" size={18} color="var(--ink-3)" />
      </button>
      )}
      {!linkOnly && open ? <AskForHelpForm ctx={ctx} onClose={() => setOpen(false)} onSent={(res) => { setOpen(false); ctx.toast && ctx.toast(careSentWording(res)); }} /> : null}
    </div>
  );
}

// Collapsible heading for the Care tab. Asking for help and offering help are different frames of mind, and
// interleaving them made the tab read as one undifferentiated list — so each lives under its own heading that
// remembers whether you left it open.
function CareSection({ id, title, sub, icon, count, defaultOpen = true, children }) {
  const KEY = 'trinityone.care.sec.' + id;
  const [open, setOpen] = React.useState(() => { try { const v = localStorage.getItem(KEY); return v === null ? defaultOpen : v === '1'; } catch (e) { return defaultOpen; } });
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) {} };
  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={toggle} aria-expanded={open} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 4px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', borderBottom: '1px solid var(--line)' }}>
        <Icon name={icon} size={18} color="var(--clay)" />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>{title}{typeof count === 'number' && count > 0 ? <span style={{ color: 'var(--ink-3)', fontWeight: 600 }}> · {count}</span> : null}</span>
          {sub ? <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)', marginTop: 1, lineHeight: 1.35 }}>{sub}</span> : null}
        </span>
        <Icon name={open ? 'chevU' : 'chevD'} size={17} color="var(--ink-3)" />
      </button>
      {open ? <div style={{ paddingTop: 14 }}>{children}</div> : null}
    </div>
  );
}

// `part` splits this into its two halves so the Care tab can file them under different headings:
//   'others' — the people who've said they're glad to help (you reach out to THEM when you need a hand)
//   'mine'   — your own "I'm here to help" listing (what you offer the church)
// No prop = both, as before.
function CareAvailability({ ctx, part }) {
  const care = ctx.care || {};
  const myPub = (care.myPub || '').toLowerCase();
  const avail = care.avail || [];
  const mine = avail.find(a => (a.pubkey || '').toLowerCase() === myPub) || null;
  // A child must never be advertised as an available helper (they can't be DM'd anyway, and it's a safeguarding
  // line) — filter minors out of the list even if a stale availability doc survived a later "mark as child".
  const _minors = new Set(((ctx.safeguard && ctx.safeguard.minors) || []).map(x => String(x || '').toLowerCase()));
  const others = avail.filter(a => (a.pubkey || '').toLowerCase() !== myPub && !_minors.has((a.pubkey || '').toLowerCase()));
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
  // DO NOT LIST SOMEBODY WHO WAS NEVER LISTED. Audit 2026-09-02 #18. This flipped the card to "you're
  // listed" before knowing, so a member who volunteered to help and was never recorded believes their
  // church can call on them. `setAvail` already returns the engine's answer (app.jsx:1795).
  const save = () => {
    setEditing(false);
    Promise.resolve(care.setAvail ? care.setAvail(tags, note) : null)
      .then((ok) => { if (ok) setOpt(true); else { setOpt(null); ctx.toast('Couldn’t list you — the church hasn’t been told. Try again when you have signal.', { error: true }); } })
      .catch(() => { setOpt(null); ctx.toast('Couldn’t list you — the church hasn’t been told.', { error: true }); });
  };
  // COMING OFF THE LIST IS THE SAME PROMISE IN REVERSE, and only the "on" direction was fixed. A member who
  // believes they withdrew, and did not, is still being counted on by everyone reading the list — and this
  // is the control someone uses when they can no longer help. Audit 2026-09-04.
  const turnOff = () => {
    setEditing(false);
    Promise.resolve(care.clearAvail ? care.clearAvail() : null)
      .then((ok) => { if (ok) { setOpt(false); setTags([]); setNote(''); } else { setOpt(null); ctx.toast('Couldn’t take you off the list — the church hasn’t been told, so people can still see you as ready to help. Try again when you have signal.', { error: true }); } })
      .catch(() => { setOpt(null); ctx.toast('Couldn’t take you off the list — the church hasn’t been told.', { error: true }); });
  };
  const showTags = (mine && mine.tags && mine.tags.length) ? mine.tags : tags;
  const box = { padding: 14, borderRadius: 18, background: 'color-mix(in oklab, var(--gold) 8%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 26%, var(--line))', marginBottom: 14 };
  const chipStyle = (on) => ({ padding: '6px 12px', borderRadius: 999, border: '1px solid ' + (on ? 'var(--sage)' : 'var(--line)'), background: on ? 'color-mix(in oklab, var(--sage) 16%, var(--surface))' : 'var(--surface)', color: on ? 'var(--sage)' : 'var(--ink-2)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' });
  const showOthers = part !== 'mine';
  const showMine = part !== 'others';
  return (
    <div>
      {showOthers && others.length ? (
        <div style={{ padding: 14, borderRadius: 18, background: 'color-mix(in oklab, var(--sage) 7%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 26%, var(--line))', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><Icon name="heart" size={16} color="var(--sage)" /><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5, color: 'var(--ink)' }}>Ready to help</div></div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>You don’t have to carry things alone. These friends have said they’re glad to help — reach out to one of them, or use “Ask for help” above.</div>
          {others.map(a => <CareAvailRow key={a.pubkey} a={a} ctx={ctx} myPub={myPub} />)}
        </div>
      ) : null}
      {showMine && !isMinor ? (
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
  // The Care tab's own framing is read by children too, and for them "your care team" is not who receives it.
  const _minorHere = !!(ctx.safeguard && ctx.safeguard.isMinor);
  // The church-level setting only. Enough to stop the section promising privacy it may not deliver; the
  // sheet below asks the engine whether THIS person may actually open one.
  const _needsOpenToMembers = !_minorHere && ((ctx.care && ctx.care.settings && ctx.care.settings.openedBy) === 'member');
  const s = care.settings || {};
  const [openId, setOpenId] = React.useState(() => (embedded && ctx.careFocus) || null);   // deep-link: auto-open the focused need
  if (!s.enabled) return null;
  const today = todayISO();
  const myPub = (care.myPub || '').toLowerCase();
  // visibility 'team' → only the care team (roster of the configured admin group) sees the list;
  // a recipient always sees their own need so they can mark skip-days.
  // on the care team (roster of the configured admin group) → can block out dates for a recipient who isn't on the app
  const onCareRoster = (() => {
    const roster = (ctx.churchRosters || []).find(r => r.team === s.adminGroupId);
    return !!(roster && (roster.people || []).some(p => p && (p.pub || '').toLowerCase() === myPub));
  })();
  // See splitCareNeeds. `mine` is what the church has arranged FOR me — I keep that whatever the setting,
  // because the skip-day controls live on it and the Today banner points here. `live` is what I could
  // volunteer for, which is everyone else's.
  const _split = splitCareNeeds({ needs: care.needs, today, visibility: s.visibility, onCareRoster, myPub });
  const mineNeeds = _split.mine;
  let live = _split.others;
  // AND NEVER OFFER SOMEONE THEIR OWN NEED. Verity found her own name, twice, under "Someone in the church
  // could use a hand — sign up for a day". The list was filtered by date alone; the recipient was consulted
  // only on the team-only setting, so on the default whole-church setting the person who asked was invited to
  // help herself. Same shape as the availability list that said "Nobody has listed themselves" to somebody who
  // just had. A list that means "who needs YOUR help" must exclude the person reading it.
  //
  // Only for the volunteer view — the care team still sees everything, including their own, because triage is
  // a different job from signing up.
  // the open-needs block — or, in the embedded Care tab, a gentle empty state (availability still shows above it)
  // WHAT THE CHURCH HAS ARRANGED FOR YOU. Its own block, above the volunteering one — the complaint was never
  // that Verity could see her need, it was that it sat under "Someone in the church could use a hand. Sign up
  // for a day", with her own name on it, inviting her to help herself.
  const mineBlock = mineNeeds.length ? (
    <div style={{ padding: 14, borderRadius: 18, background: 'color-mix(in oklab, var(--clay) 7%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, var(--line))', boxShadow: 'var(--shadow)', marginBottom: 12 }}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 11 }}>Your church is arranging this for you. Tick off any day you’re already covered, so nobody turns up twice.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {mineNeeds.map(n => <CareNeedRow key={n.id} need={n} slots={care.slots || []} skips={care.skips || []} care={care} canManage={onCareRoster} expanded={openId === n.id} onToggle={() => setOpenId(openId === n.id ? null : n.id)} />)}
      </div>
    </div>
  ) : null;
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
      {/* THIS IS WHAT CALLUM READ WHILE VERITY WAS WAITING. He had listed himself as ready for DIY, Moving and
          Rides; she had asked for a lift and a shop. He saw "No open needs right now — when someone in the
          church needs a hand it'll show up here" three times over fifteen minutes and reasonably concluded
          that nobody did. The request was on the relay the whole time.
          He cannot be told it exists — a care request is sealed to the care team, and who has asked for what
          is not a volunteer's business. But the app can stop asserting the opposite of the truth, and it can
          name the step nobody knew was there: a request reaches the care team first, and only becomes
          something to sign up for once they open it. */}
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--ink)', marginBottom: 6 }}>Nothing to sign up for yet</div>
      <div style={{ fontSize: 14, lineHeight: 1.5, maxWidth: 300, margin: '0 auto' }}>When someone asks for help it goes to the care team first. Once they set it up — a meal, a ride, an errand — it appears here for you to take a day.</div>
    </div>
  );
  // embedded = the Serving "Care" tab: availability module first (offer help + who's ready), then the needs.
  // The Care tab under two headings: asking for help and offering it are different frames of mind, and mixing
  // them read as one long list. (Care-team triage stays above both — it's neither.)
  if (embedded) {
    const readyCount = ((care.avail || []).filter(a => (a.pubkey || '').toLowerCase() !== (care.myPub || '').toLowerCase())).length;
    return (
      <React.Fragment>
        <CareRequests ctx={ctx} />
        <CareSection id="need" icon="heart" title="If you need help" sub={_minorHere ? "Tell someone at your church, or reach someone who’s offered" : _needsOpenToMembers ? "Tell your church, or reach someone who’s offered" : "Ask your care team, or reach someone who’s offered"}>
          <AskForHelp ctx={ctx} />
          <CareAvailability ctx={ctx} part="others" />
          {readyCount === 0 ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5, padding: '0 2px 4px' }}>{_minorHere ? 'Nobody else has listed themselves as available yet — asking above reaches the people at your church who can help.' : 'Nobody else has listed themselves as available yet — asking your care team above reaches them directly.'}</div> : null}
        </CareSection>
        <CareSection id="give" icon="hand" title="If you can help" sub="Tell your church you’re available, and sign up for what’s open" count={live.length}>
          <CareAvailability ctx={ctx} part="mine" />
          {mineBlock}
          {needsBlock}
        </CareSection>
      </React.Fragment>
    );
  }
  // TODAY VARIANT. It used to return null on `!live.length`, which hid it in exactly the moment somebody
  // needs it: nobody has asked yet, and the person reading is the one who wants to ask. Verity, 71, with a
  // broken wrist, hunted through Community and the You page and found Care only inside "Serving & events" —
  // "Serving to me means ME doing something for the church, not the church doing something for me. If I'd
  // needed help badly I'd have telephoned Miriam." Two more members never found it at all.
  //
  // So the card shows the ask first and any open needs under it. Still hidden entirely for a church that has
  // not switched care on (the `!s.enabled` guard above) — owner's decision, 2026-08-23.
  return (
    <div style={{ marginBottom: 22, animation: 'trinityFade .5s ease both' }}>
      <SectionLabel>Practical care</SectionLabel>
      <AskForHelp ctx={ctx} linkOnly />
      {mineBlock}
      {live.length ? needsBlock : null}
    </div>
  );
}

// Emergency "mark as safe" banner — shown at the very top of Today when the church has an active safety
// check. One tap tells the church you're safe (or that you need help); the response is encrypted to the
// leader who started the check. Deliberately the most prominent thing on the screen while a check is open.
// Shared answered-state for a safety check, so the Today banner and the app-wide dock agree: answering in one
// settles both, and it survives a tab switch / app reopen. Get: safetyAck(id) → 'safe'|'help'|''. Set: safetyAck(id, s).
function safetyAck(id, set) {
  const k = 'trinityone.safetyack.' + id;
  try { if (set === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, set); } catch (e) {}
  return set || '';
}

// App-wide safety dock: a slim card that grows out of the bottom nav on ANY tab (the full banner with a note field
// lives on Today). Stays until the member answers or dismisses it. Docks in the same slot the MiniPlayer uses.
function SafetyDock({ ctx, onOpenToday }) {
  const [check, setCheck] = React.useState(null);
  const [answered, setAnswered] = React.useState('');
  const [narrow, setNarrow] = React.useState(false);   // delivered, but not to the audience the check named
  const [dismissed, setDismissed] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [err, setErr] = React.useState('');
  React.useEffect(() => {
    if (!ctx.church || !(window.Fellowship && window.Fellowship.subscribeSafetyCheck)) return;
    let unsub = null;
    try {
      unsub = window.Fellowship.subscribeSafetyCheck(c => {
        setCheck(c); setErr('');
        setAnswered(c ? (safetyAck(c.id) || '') : '');
        try { setDismissed(!!c && localStorage.getItem('trinityone.safetydockx.' + c.id) === '1'); } catch (e) { setDismissed(false); }
      }, ctx.church && ctx.church.npub);
    } catch (e) {}
    return () => { try { unsub && unsub(); } catch (e) {} };
  }, [ctx.church && ctx.church.npub]);   // eslint-disable-line react-hooks/exhaustive-deps
  // The safety check rides on the practical-care toggle: a church with Care off doesn't run check-ins either.
  // (Care is also where the persistent "I'm safe / I need help" lives, so the two can't be separated.)
  if (!(ctx.care && ctx.care.settings && ctx.care.settings.enabled)) return null;
  if (!check || dismissed) return null;
  // Answered cleanly: the dock has done its job and goes. Answered with a CAVEAT: it has to stay, because
  // the caveat is the whole point — the reply reached the church leader but not yet the team the steward
  // addressed it to, and a member who is told nothing will assume it arrived where they were promised.
  // Setting an error string here used to be the fix; nothing rendered it, because this early return had
  // already fired on `answered`.
  if (answered && !narrow) return null;
  // The safety surfaces deliberately say "your church", never the church's NAME: it keeps the line short
  // enough not to truncate on a narrow screen, and it keeps the congregation unnamed on a lock screen or
  // over someone's shoulder — which matters most to exactly the churches this feature exists for.
  const dismiss = () => { setDismissed(true); try { localStorage.setItem('trinityone.safetydockx.' + check.id, '1'); } catch (e) {} };
  const respond = async (s) => {
    if (sending) return; setSending(true); setErr('');
    // ⚠ markSafe ANSWERS FOUR WAYS NOW, AND `if (res)` WOULD BE WRONG — an object is truthy, so truth-testing
    // it marks a member safe over a send that failed. Read `res.ok`. (A truthy STRING would invert the same
    // way, which is why this is an object: it cannot be got wrong quietly.)
    let res = null;
    try { res = await window.Fellowship.markSafe(check, s, ''); } catch (e) {}
    setSending(false);
    if (res && res.ok) { safetyAck(check.id, s); setAnswered(s); if (res.narrowed) setNarrow(true); }
    // NOBODY ANSWERED IN TIME IS NOT A FAILURE TO SEND. The reply is signed and on the wire and may already
    // be with the church. Telling someone in an emergency that nobody knows — when they do — is the worst
    // version of this screen being wrong, and it does NOT clear `answered`, so they can send again if they want.
    else if (res && res.reason === 'unconfirmed') setErr('We couldn’t confirm that reached your church — it may well have. You can send it again.');
    else setErr('Couldn’t send — try again.');
  };
  const btn = (extra) => ({ flex: 1, height: 40, border: 'none', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 14, color: '#fff', ...extra });
  return (
    <div role="alert" style={{
      position: 'absolute', left: 12, right: 12, zIndex: 27,
      bottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 68px)',   // hug the 66px nav pill (2px gap) so it reads as an extension of it
      background: 'color-mix(in oklab, var(--clay-soft) 92%, transparent)',
      backdropFilter: 'blur(20px) saturate(160%)', WebkitBackdropFilter: 'blur(20px) saturate(160%)',
      border: '1.5px solid var(--clay)', borderRadius: 22, boxShadow: 'var(--shadow-lg)',
      padding: '12px 14px 13px', animation: 'trinityFade .35s ease both',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
        <div style={{ marginTop: 1, flexShrink: 0, color: 'var(--clay-deep, #b4462f)' }}><Icon name="shield" size={17} color="currentColor" /></div>
        <div style={{ flex: 1, minWidth: 0 }} onClick={onOpenToday} role="button" title="Open to add a note">
          <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--clay-deep, #b4462f)', fontFamily: 'var(--font-display, var(--font-ui))' }}>Your church is checking you’re safe</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{check.message || 'Are you safe?'}</div>
        </div>
        <button onClick={dismiss} aria-label="Dismiss" style={{ flexShrink: 0, width: 28, height: 28, border: 'none', background: 'none', color: 'var(--ink-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, marginTop: -2, marginRight: -4 }}><Icon name="x" size={17} color="currentColor" /></button>
      </div>
      {narrow ? (
        // Delivered, but not to everyone the steward chose. Name who DID get it and who has not, in that
        // order: a member who has just said "I need help" needs to know someone has it before they need to
        // know who is still missing.
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 10, lineHeight: 1.45 }}>
          <b style={{ color: 'var(--clay-deep, #b4462f)' }}>Your church leader has this.</b> Your church’s team list
          hasn’t loaded on this phone yet, so the rest of the team may not see it straight away. Nothing else to do —
          it will reach them when your phone next connects.
        </div>
      ) : (
      <div style={{ display: 'flex', gap: 9, marginTop: 11 }}>
        <button disabled={sending} onClick={() => respond('safe')} style={btn({ background: 'var(--sage, #4f7a5e)' })}>{sending ? 'Sending…' : 'I’m safe'}</button>
        <button disabled={sending} onClick={() => respond('help')} style={btn({ background: 'var(--clay)' })}>{sending ? 'Sending…' : 'I need help'}</button>
      </div>
      )}
      {err ? <div style={{ fontSize: 12.5, color: 'var(--clay-deep, #b4462f)', fontWeight: 700, marginTop: 8 }}>{err}</div> : null}
    </div>
  );
}

// `persistent` = this copy is the permanent home (the Care tab), so it ignores the Today dismissal. That's what
// makes the X on Today safe to offer: clearing it there tidies the day's screen without ever costing the member
// their route to say "actually, I need help".
function SafetyBanner({ ctx, persistent }) {
  const [check, setCheck] = React.useState(null);
  const [status, setStatus] = React.useState('');   // '' | 'safe' | 'help' (what I've told them)
  const [note, setNote] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [err, setErr] = React.useState('');   // delivery failed → retry prompt, never a false confirmation
  // The answered state is a MOMENT of confirmation, not a fixture: it used to sit at full height on Today for as
  // long as the check stayed open, pushing the day's content down long after it had said all it had to say. Show
  // the full card briefly, then collapse to a slim line. Escalation stays one tap away in both — someone who
  // marked themselves safe and then isn't must always be able to say so.
  const [collapsed, setCollapsed] = React.useState(false);
  const [narrow, setNarrow] = React.useState(false);   // delivered, but not to the audience the check named
  // The member can clear the collapsed line outright (X), remembered per check like the dock's own dismiss.
  // Note this is the last IN-APP one-tap route to escalate, so it's offered only as a deliberate choice and
  // never applied for them — the ordinary ways to reach the church (DM a steward, Community) are unaffected.
  const [hidden, setHidden] = React.useState(false);
  // Someone who asked for help must never watch their request simply VANISH when the leader closes the
  // check — silent removal reads as "it was dismissed", which is the worst thing to tell a frightened
  // person. So we remember the check we were answering and, if the answer was 'help', keep a closing
  // card until they acknowledge it. (Answering 'safe' needs no send-off: nothing is outstanding.)
  const closedRef = React.useRef('');
  const [closedHelp, setClosedHelp] = React.useState('');
  React.useEffect(() => {
    if (!ctx.church || !(window.Fellowship && window.Fellowship.subscribeSafetyCheck)) return;
    let unsub = null;
    // seed the answered state from storage so the Today banner + the app-wide dock agree (answer once, both settle)
    try {
      unsub = window.Fellowship.subscribeSafetyCheck(c => {
        setCheck(c);
        const ack = c ? (safetyAck(c.id) || '') : '';
        setStatus(ack);
        // already answered before this session (tab switch / reopen) → start collapsed; don't re-confirm
        // something they told us minutes or hours ago.
        setCollapsed(!!ack);
        try { setHidden(!!c && localStorage.getItem('trinityone.safetytodayx.' + c.id) === '1'); } catch (e) { setHidden(false); }
        if (c) { closedRef.current = c.id; setClosedHelp(''); return; }
        // the check just closed (or none is open) — was the last thing we said "I need help"?
        const id = closedRef.current;
        let seen = false;
        try { seen = !!id && localStorage.getItem('trinityone.safetyclosed.' + id) === '1'; } catch (e) {}
        setClosedHelp(id && safetyAck(id) === 'help' && !seen ? id : '');
      }, ctx.church && ctx.church.npub);
    } catch (e) {}
    return () => { try { unsub && unsub(); } catch (e) {} };
  }, [ctx.church && ctx.church.npub]);   // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!status || collapsed) return;
    const t = setTimeout(() => setCollapsed(true), 5000);
    return () => clearTimeout(t);
  }, [status, collapsed]);
  if (!(ctx.care && ctx.care.settings && ctx.care.settings.enabled)) return null;   // care off → no check-ins (see SafetyDock)
  if (!check) {
    if (!closedHelp) return null;
    const ackClosed = () => { setClosedHelp(''); try { localStorage.setItem('trinityone.safetyclosed.' + closedHelp, '1'); } catch (e) {} };
    return (
      <div role="status" style={{
        borderRadius: 16, padding: 16, marginBottom: 18, animation: 'trinityFade .4s ease both',
        background: 'var(--sage-soft, #dbe7dd)', border: '1px solid var(--sage, #4f7a5e)',
      }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--ink)' }}>Your message has been passed on</div>
        <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 3, lineHeight: 1.45 }}>Your church family knows you asked for help, and will be in touch as soon as they can.</div>
        <button onClick={ackClosed} style={{ marginTop: 11, height: 40, padding: '0 15px', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5, color: 'var(--ink)' }}>Got it</button>
      </div>
    );
  }
  const respond = async (s) => {
    if (sending) return; setSending(true); setErr('');
    // See the note on the dock's respond(): `res.ok`, never `if (res)`.
    let res = null;
    try { res = await window.Fellowship.markSafe(check, s, note); } catch (e) {}
    setSending(false);
    // 'narrow' means delivered, but we could not resolve the audience the steward chose — so it reached
    // the church leader and not (yet) the team it was addressed to. Saying so is the whole point: what
    // this replaces reported a full delivery that never happened.
    const NARROW = 'Sent to your church leader. Your church’s team list hasn’t loaded yet, so they may not see it straight away.';
    if (res && res.ok) { setStatus(s); safetyAck(check.id, s); setCollapsed(false); if (res.narrowed) setNarrow(true); }
    else if (res && res.reason === 'unconfirmed') setErr('We couldn’t confirm that reached your church — it may well have. You can send it again.');
    else setErr('Couldn’t send — check your connection and try again.');
  };
  const wrap = { borderRadius: 16, padding: 16, marginBottom: 18, animation: 'trinityFade .4s ease both' };
  const btn = (extra) => ({ flex: 1, height: 46, border: 'none', borderRadius: 12, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 15, ...extra });
  if (status) {
    const help = status === 'help';
    const tone = help ? 'var(--clay)' : 'var(--sage, #4f7a5e)';
    if (collapsed) {
      if (hidden && !persistent) return null;                    // cleared on Today — but Care always keeps it
      const hide = () => { setHidden(true); try { localStorage.setItem('trinityone.safetytodayx.' + check.id, '1'); } catch (e) {} };
      return (
        <div role="status" style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderRadius: 12, padding: '7px 6px 7px 11px', marginBottom: 14,
          background: help ? 'var(--clay-soft)' : 'var(--sage-soft, #dbe7dd)', border: '1px solid ' + tone,
          animation: 'trinityFade .35s ease both',
        }}>
          <span style={{ flexShrink: 0, display: 'flex', color: tone }}><Icon name={help ? 'shield' : 'check'} size={15} color="currentColor" /></span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {help ? 'You asked for help' : 'You told your church you’re safe'}
          </span>
          <button onClick={() => respond(help ? 'safe' : 'help')} disabled={sending} style={{
            flexShrink: 0, border: 'none', background: 'none', padding: '5px 4px', cursor: 'pointer',
            fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, color: tone, textDecoration: 'underline',
          }}>{sending ? 'Sending…' : (help ? 'I’m safe' : 'I need help')}</button>
          {/* ⚠ THE ANSWERED ARM MUST SHOW A FAILURE TOO, AND FOR TWO COMMITS IT DID NOT. `respond` calls
              setErr() on every failure, and `err` was rendered ONLY in the un-answered return below — so a
              member who had already said "I'm safe" and then tapped "I need help instead" over a send that
              failed got NOTHING, and the screen went on reading "You told your church you're safe." The
              escalation is the single most important tap on this screen and it was the silent one.
              THIS IS THE THIRD TIME THIS EXACT TRAP HAS BEEN SET HERE — safety-audience.test.mjs records the
              first two in its own words ("the second survived a commit whose own message criticised the
              first"). Audit of bcf1b67, 2026-09-15. */}
          {err ? <span role="alert" style={{ flexBasis: '100%', fontSize: 12, lineHeight: 1.4, fontWeight: 700, color: 'var(--clay-deep, #b4462f)', marginTop: 6 }}>{err}</span> : null}
          {persistent ? null : <button onClick={hide} aria-label="Dismiss" title="Dismiss" style={{
            flexShrink: 0, width: 30, height: 30, border: 'none', background: 'none', cursor: 'pointer',
            color: 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8,
          }}><Icon name="x" size={15} color="currentColor" /></button>}
        </div>
      );
    }
    return (
      <div role="status" style={{ ...wrap, background: help ? 'var(--clay-soft)' : 'var(--sage-soft, #dbe7dd)', border: '1px solid ' + tone }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--ink)' }}>{help ? 'You asked your church for help' : 'You told your church you’re safe'}</div>
        <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 3 }}>{help ? 'Someone will reach out. You can change this if things change.' : 'Thank you. You can change this if things change.'}</div>
        {narrow ? (
          // The reply went, but not to everyone the steward chose — the team list had not reached this phone.
          // This banner is the surface a member actually sees on Today and in Care (the small dock only appears
          // on other tabs), so the caveat has to live here or it is never read. Who DID get it first: someone
          // who has just asked for help needs to know it landed before they need to know who is still missing.
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 7, lineHeight: 1.45 }}>
            <b style={{ color: 'var(--clay-deep, #b4462f)' }}>Your church leader has this.</b> Your church’s team list
            hasn’t loaded on this phone yet, so the rest of the team may not see it straight away.
          </div>
        ) : null}
        {err ? <div role="alert" style={{ fontSize: 13.5, color: 'var(--clay-deep, #b4462f)', fontWeight: 700, marginTop: 9 }}>{err}</div> : null}
        <button onClick={() => respond(help ? 'safe' : 'help')} disabled={sending} style={{ marginTop: 11, height: 40, padding: '0 15px', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5, color: 'var(--ink)' }}>{help ? 'Actually, I’m safe' : 'I need help instead'}</button>
      </div>
    );
  }
  return (
    <div role="alert" style={{ ...wrap, background: 'var(--clay-soft)', border: '2px solid var(--clay)' }}>
      <div style={{ fontWeight: 800, fontSize: 16.5, color: 'var(--clay-deep, #b4462f)', fontFamily: 'var(--font-display, var(--font-ui))' }}>Your church is checking everyone is safe</div>
      <div style={{ fontSize: 14.5, color: 'var(--ink)', marginTop: 5, lineHeight: 1.45 }}>{check.message || 'Are you safe?'}</div>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note (optional)" maxLength={240} style={{ width: '100%', boxSizing: 'border-box', height: 42, padding: '0 13px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 14, color: 'var(--ink)', fontFamily: 'var(--font-ui)', margin: '12px 0 0' }} />
      <div style={{ display: 'flex', gap: 10, marginTop: 11 }}>
        <button disabled={sending} onClick={() => respond('safe')} style={btn({ background: 'var(--sage, #4f7a5e)', color: '#fff' })}>{sending ? 'Sending…' : 'I’m safe'}</button>
        <button disabled={sending} onClick={() => respond('help')} style={btn({ background: 'var(--clay)', color: 'var(--on-clay)' })}>{sending ? 'Sending…' : 'I need help'}</button>
      </div>
      {err ? <div style={{ fontSize: 13.5, color: 'var(--clay-deep, #b4462f)', fontWeight: 700, marginTop: 9 }}>{err}</div> : null}
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 9, lineHeight: 1.4 }}>Only the people your church chose for this check can open your reply — not other members. The relay can see that you replied and when, but not what you said.</div>
    </div>
  );
}

// Gentle "secure your account" nudge — shown on Today while the CURRENT identity has no backup recorded (the
// durable per-npub flag RecoverySheet writes). Tapping opens the recovery hub; dismiss snoozes ~3 days so it
// reminds without nagging. This is what makes a skipped backup recoverable-not-fatal (SECURITY-AUDIT-2026-07-18).
function RecoveryNudge({ ctx }) {
  const np = (window.TrinityIdentity && window.TrinityIdentity.current && window.TrinityIdentity.current.npub) || '';
  const SNOOZE_KEY = 'trinityone.backupnudge.snooze';
  // Accept the legacy GLOBAL flag too: the onboarding wizard historically recorded a saved backup under
  // `trinityone.backedup`='true', not the per-npub key this reads — so members who backed up in the wizard
  // were still nagged. Migrate it to the per-npub key on read so it's a one-time fallback.
  const backedUp = (() => { try {
    if (np && localStorage.getItem('trinityone.backedup.' + np)) return true;   // truthy = backed up; the value is now an ISO date (legacy '1' still counts)
    if (np && localStorage.getItem('trinityone.backedup') === 'true') { localStorage.setItem('trinityone.backedup.' + np, '1'); return true; }
    return false;
  } catch (e) { return false; } })();
  const [snoozed, setSnoozed] = React.useState(() => { try { return Date.now() < parseInt(localStorage.getItem(SNOOZE_KEY) || '0', 10); } catch (e) { return false; } });
  if (!np || backedUp || !ctx.openRecovery || snoozed) return null;
  const snooze = (e) => { if (e) e.stopPropagation(); try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + 3 * 24 * 3600 * 1000)); } catch (e2) {} setSnoozed(true); };
  return (
    <div onClick={() => ctx.openRecovery()} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', marginBottom: 14, cursor: 'pointer', borderRadius: 15, border: '1px solid color-mix(in oklab, var(--gold) 34%, var(--line))', background: 'color-mix(in oklab, var(--gold) 10%, var(--surface))', boxShadow: 'var(--shadow)', animation: 'trinityFade .5s ease both' }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: 'color-mix(in oklab, var(--gold) 22%, var(--surface))', color: 'var(--clay-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="shield" size={18} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--ink)' }}>Secure your account</div>
        <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.4 }}>Set up recovery so you never lose access if you change phones.</div>
      </div>
      <button onClick={snooze} aria-label="Not now" style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 9, border: 'none', background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={16} /></button>
    </div>
  );
}
window.RecoveryNudge = RecoveryNudge;

// ── "something new" on the Serving & events card ────────────────────────────────────────────────────────────
// NEVER BADGE SOMETHING THE MEMBER CANNOT THEN OPEN. This counts `ctx.churchEvents` and nothing else, because
// that is the EXACT list the Serving overlay's Events tab renders (app/screens-serving.jsx, `const events =
// ctx.churchEvents || []`) — what the relay served THIS member, not what the church published. Counting from
// the church's corpus instead would put a dot on a rota or a run sheet this member is deliberately not shown
// (rotaVis 'team'/'stewards', enforced by the relay): the dot would open onto nothing, and it would also leak
// that SOMETHING EXISTS to exactly the person the church chose not to show it to.
//
// A `_locked` entry is dropped for the same reason. It is an event sealed under a church name key that has not
// reached this phone: the Events tab can only say "1 event you can't open yet", so it is not something new to
// go and read. (When the key does arrive the whole calendar opens at once, which is a bigger moment than a dot;
// this does not promise a badge for it.)
//
// The member's own actions are structurally absent: an RSVP is a separate document (subscribeMyRsvps) and
// never rewrites the church's event, so `ts` cannot move because of something this member did.
//
// `ts` is the event document's created_at, one document per event (`trinityone/event:<id>`), so a steward
// EDITING an event republishes it with a newer ts and it counts again — "or a change to one". Occurrences of
// a recurring event are expanded from one document and share its id, so they are counted once.
const SERV_NEW_CAP = 9;
// ════════════════ MY OWN CHILDREN, AT TODAY'S SESSION — THE PARENT'S WHOLE SURFACE ══════════════
// STEP 2 of reference/DESIGN-CHECKIN-IN-THE-MEMBER-APP-2026-09-09.md. §4: "the parent shows the code from
// their phone; the worker checks it matches before releasing the child." Data comes from
// Fellowship.subscribeMyChildrenCheckins via ctx.myChildren — see that function for the whole chain and what
// each field is allowed to mean.
//
// ── IT DOES NOT EXIST FOR ANYBODY ELSE, AND THAT IS THE DESIGN ────────────────────────────────────────────
// Renders NULL unless this phone either opened a record of its own or was served one naming it. A parent
// persona hunted this whole app on 2026-09-10 and found no check-in anywhere, and the finding was that the
// absence is CORRECT and, critically, that there were no dead ends: no menu item leading nowhere, no empty
// "No check-ins today" state, nothing implying check-in should be there. A card that greeted the whole
// congregation with "no children checked in" would be exactly that dead end.
//
// ── IT IS NOT A REGISTER ──────────────────────────────────────────────────────────────────────────────────
// The owner, 2026-09-11: *"parents don't have any records surfaced to them… the code must still be shown as
// we designed."* So: their own children, their own codes, and nothing else — no room list, no other family,
// no roll. Every row here came out of a ciphertext sealed to THIS PHONE'S key; there is no list to widen.
//
// ── AND THERE IS NO WAY TO CHECK A CHILD OUT FROM HERE, EVER ──────────────────────────────────────────────
// Not an omission — the point. The pickup code exists so that the person handing a child over is the person
// who brought them; a control on the parent's own phone that released a child would route straight round it.
// The parent SHOWS; the worker MATCHES and writes. Asserted as an absence at the point of use in
// scripts/a-parent-sees-their-own-childs-pickup-code.test.mjs, because an absence is exactly the kind of
// thing a later "helpful" addition undoes.
//
// ── THE CODE IS SHOWN OPENLY, UNLIKE THE WORKER'S SCREEN ──────────────────────────────────────────────────
// KidsRegister covers each code until it is asked for: a worker holds a whole room's codes and her phone can
// be read over a shoulder. A parent holds their OWN child's code and has to hold it up to a volunteer at a
// door. Covering it there would be ceremony that costs a tap at the one moment it is needed.
//
// ⚠ AND IT IS LABELLED IN VISIBLE TEXT, not by `title`. Device finding, 2026-09-11: a pickup code labelled
// by a tooltip alone read as "I couldn't tell which one is 'the' pickup code — I'd have read 9079 to a
// parent, but I was guessing." A `title` is invisible on a touch screen and to a screen reader.
function tdyClock(ts) {
  if (!Number.isFinite(ts)) return '';
  try { return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
}
const MYKIDS_OPEN_KEY = 'trinityone.kids.open';
function MyChildrenCard({ ctx }) {
  // ⚠ BOTH HOOKS SIT ABOVE THE `return null` BELOW, and must stay there. This card returns null for every
  // member who has nothing to do with check-in — which is most of the congregation, every Sunday — so a hook
  // placed after that early return would run on some renders and not others and React would throw on the
  // first child checked in. scripts/no-hook-after-an-early-return.test.mjs is the guard.
  const [open, setOpen] = React.useState(() => { try { const v = localStorage.getItem(MYKIDS_OPEN_KEY); return v === null ? true : v === '1'; } catch (e) { return true; } });
  const [, setTick] = React.useState(0);
  // ⚠ THE ARRIVAL IS HELD HERE, NOT IN THE SECTION THAT DRAWS IT, AND THAT IS NOT TIDINESS.
  // WereHereSection is rendered as `{open ? <WereHereSection/> : null}`, so collapsing this card UNMOUNTS it
  // and React throws its state away. Held down there, the tap that puts the code away — which is the entire
  // point of the fold — was also the tap that erased the record of the arrival. Re-opening then drew the
  // untouched "We're here" button, and a second tap on a relay that happened to be unreachable told a parent
  // "that was turned away, take them to the desk" about an arrival ALREADY ON THE WORKER'S SCREEN. That is
  // device finding F1's harm, reintroduced through a different door; found by audit of 23f7200.
  // This card survives the fold, so the arrival does.
  // ⚠ THE STATE IS THE TRUTH AND THE STORE IS A MIRROR. Reading FROM the store instead would mean a full or
  // refused localStorage leaves a parent with no square AT THE MOMENT OF THE TAP — strictly worse than the
  // bug. `setArrivalOutcome` returns false rather than throwing, and this card carries on regardless.
  // ⚠ `forChurch` AND `forMe` TRAVEL WITH THE ANSWER, and the guard below is why. Without them the card
  // could only ask "is there an answer?", never "whose, and for which church?" — so once anything had been
  // tapped the re-read was dead for the life of the card. Found by audit 2026-09-14.
  const [arr, setArr] = React.useState({ busy: false, res: null, forSession: '', forChurch: '', forMe: '' });
  // ⚠ RE-READ WHENEVER IT BECOMES READABLE, NOT ONCE AT MOUNT — and the difference is the door a parent
  // actually uses. A `useState` initialiser fixed the TAB SWITCH and not the RESTART: reading the store
  // needs both the church npub AND `_mePub()`, and at a cold start neither exists yet. `createRoot().render()`
  // is synchronous, while `deriveFromIdentity` sets `Fellowship.myPubkey` after two awaits — on native a
  // dynamic import of secure storage plus a bridge round trip, which memory records deferred for MINUTES on
  // a sleeping screen. That is exactly the parent's case: phone in a pocket, opened at the door. And
  // `ctx.church` is null while `lockNow()` holds, which it does whenever a PIN is set and the pubkey has not
  // landed. So the initialiser read an empty store and nothing ever looked again. Found by audit 2026-09-13.
  //
  // ⚠ KEYED ON THE TWO VALUES THAT ARRIVE LATE, so this runs the moment either turns up — and again on a
  // CHURCH SWITCH, which does not remount this card (`screens.today` carries no `key`), so a mount-time read
  // would never see the new church's record.
  const npForArr = (ctx && ctx.church && ctx.church.npub) || '';
  const meForArr = (window.Fellowship && window.Fellowship.myPubkey) || '';
  React.useEffect(() => {
    // ⚠ `meForArr` EARNS ITS PLACE IN THE DEPS, NOT IN THIS LINE. Measured: removing it from the guard
    // changes nothing — `arrivalOutcome` goes through `_kidSlot`, which returns '' without a member, so the
    // read already answers null and the state is left alone. Removing it from the DEPS below is what breaks
    // the restart, because nothing then re-runs when identity lands. Kept here as belt-and-braces; if you
    // are looking for the load-bearing half, it is the dependency array.
    if (!npForArr || !meForArr) return;
    let o = null;
    try { const F = window.Fellowship; o = (F && F.arrivalOutcome) ? F.arrivalOutcome(npForArr) : null; } catch (e) { o = null; }
    // ⚠ NEVER CLOBBER THIS PERSON'S OWN LIVE ANSWER — AND NEVER KEEP SOMEBODY ELSE'S.
    // The first half is why the guard exists: a tap in flight is newer than anything on disk, and a late
    // identity event must not overwrite an answer the parent has just given.
    // The second half is what it was missing. It asked only "is there an answer?", so after ANY tap the
    // re-read was dead for the life of the card — and this card is not remounted when the church changes
    // (`screens.today` carries no `key`) or when a second member signs in on the same phone. Measured: the
    // new person was shown a square built from THEIR key for an arrival they never made, with no button
    // left to tap, and the worker scanning it got "nobody with that code has said they're at this door".
    // Now the answer carries whose it is, so "keep" means "keep MINE, for THIS church".
    setArr(cur => {
      // ⚠ THE PERSON HALF IS THE LOAD-BEARING ONE; THE CHURCH HALF IS DEFENSIVE. Measured by sabotage:
      // dropping `forMe` fails the second-person test, dropping `forChurch` fails nothing. That is not
      // because the church case is fine — it is because `landed` already requires the answer's session to
      // be the session in window, and two churches never share a session id, so a kept foreign answer
      // cannot paint a square. It only costs this person their OWN stored answer at the second church, so
      // they tap again and the worker sees a duplicate line. Mild, and worth closing anyway: the guard
      // should mean what it says, and a future change to `landed` must not silently make this load-bearing.
      const mine = cur.forChurch === npForArr && cur.forMe === meForArr;
      if (mine && (cur.busy || cur.res || cur.forSession)) return cur;
      return o ? { busy: false, res: { ok: o.ok, reason: o.reason }, forSession: o.session, forChurch: npForArr, forMe: meForArr }
               : { busy: false, res: null, forSession: '', forChurch: npForArr, forMe: meForArr };
    });
  }, [npForArr, meForArr]);
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem(MYKIDS_OPEN_KEY, v ? '1' : '0'); } catch (e) {} };
  const offers = wereHereOffers(ctx);
  // TWO REASONS TO LOOK AGAIN, AND ONLY ONE OF THEM COSTS ANYTHING. Both moved up from WereHereSection when
  // that became a fold inside this card: a timer INSIDE the fold cannot redraw a card that has already
  // returned null.
  //
  // The LISTENER is always armed and is free: the settings sheet and this card are two React trees over one
  // localStorage, so without it a member could tick "I bring children to church" and find nothing here until
  // the next cold start — the silent-blank shape this codebase keeps paying for.
  //
  // ⚠ THE TIMER IS ARMED ONLY FOR A MEMBER WHO ACTUALLY BRINGS CHILDREN, and that condition is the whole
  // point. This card is mounted on Today for EVERY member of every church — it returns null for almost all
  // of them — so an unconditional interval is a sixty-second wakeup, for ever, on the phone of everybody who
  // has nothing to do with children's work. That is a battery cost for the audience this product is built
  // for, and it also hangs `node --test`: miniReact runs no cleanups, so one live interval keeps the event
  // loop alive and every existing test that renders TodayScreen never exits.
  //
  // ⚠ AND IT IS ARMED ON THE NAMES, NOT ON `offers` — `offers` is already false out of window, so gating the
  // timer on it would be a timer that can only ever run once it is no longer needed, and a service coming
  // into window while the app is open would never appear. `brings` is the honest condition.
  const brings = wereHereNames(ctx).length > 0;
  React.useEffect(() => {
    const h = () => setTick(n => n + 1);
    window.addEventListener('trinity-mykids', h);
    const t = brings ? setInterval(h, WEREHERE_WINDOW_TICK) : 0;
    return () => { window.removeEventListener('trinity-mykids', h); if (t) clearInterval(t); };
  }, [brings]);
  const mine = (ctx && ctx.myChildren) || {};
  const kids = Array.isArray(mine.children) ? mine.children : [];
  const askAtDesk = Number(mine.askAtDesk) || 0;
  // ⚠ WHAT IS LEFT TO ANNOUNCE. `offers` knows only "this member brings children and a service is in window";
  // it does not know that those children are already in a room. Shut, that put "Open this to check Milo and
  // Ivy in" directly under "Your children at church · 2", with both pickup codes behind the fold — one line
  // contradicting the next. Found by audit of 23f7200.
  //
  // MATCHED ON THE NAME, WHICH IS THE ONLY LINK THERE IS: the phone's list is what the member typed and the
  // record's is what a worker confirmed, and nothing joins them but the word. So it is deliberately the SAFE
  // direction — a name that does not match leaves the child listed as still to announce, and the worst case
  // is the offer this already made. A wrongly SUPPRESSED name would be a parent at a door who cannot say
  // they are there, which is worse, and needs an identical name to happen. Rows written by a worker's own
  // phone carry no child name at all (a known gap), so they simply do not match, and fall the safe way.
  // `mine.children` is already time-boxed to MYKIDS_WINDOW around now, so last Sunday cannot suppress this one.
  // ⚠ SCOPED TO THE SESSION IN WINDOW, and the first version was not. `myChildren` spans MYKIDS_WINDOW
  // (26h, chosen to cover a morning and an afternoon off one session), so an unscoped filter counted the
  // NINE O'CLOCK check-in at the ELEVEN O'CLOCK door: measured, 0 arrival buttons at the second service,
  // with the shut-header line gone too, so nothing on screen said check-in was live at all. That is the
  // "parent at a door who cannot say they are there" direction, which DOMAIN.md forbids outright ("do not
  // block"). `landed` three lines below is session-pinned for exactly this reason; this now matches it.
  //
  // ⚠ A ROW WITH NO SESSION NEVER SUPPRESSES. Unknown is not "present". `checkinSessionOf` returns '' when
  // the tag is absent, and `_encCleartextTags` deliberately publishes a sessionless record when a church
  // has more than one service today and the worker picked none.
  //
  // ⚠ LATENT TRAP, recorded because this fix now DEPENDS on it: service documents project only
  // {id,date,time,name}, so the envelope's `svc.session || svc.id` is always `svc.id`, and
  // `arrivalSessionNow` returns `String(s.id)`. The two id spaces agree TODAY. The day a service gains a
  // `session` field they diverge silently — and the symptom is this exact defect coming back.
  const sid = (offers && offers.now && offers.now.session) || '';
  const inARoom = new Set(kids.filter(k => k && !k.out && k.session && k.session === sid).map(k => String(k.childName || '').trim().toLowerCase()).filter(Boolean));
  const stillToBring = offers ? offers.names.filter(n => !inARoom.has(String(n || '').trim().toLowerCase())) : [];
  // NOTHING TO SAY, SO NOTHING IS SAID. Not "no children checked in" — see the dead-end note above. This is
  // also the state of every member of the congregation who has nothing to do with check-in, which is most of
  // them, on every Sunday.
  //
  // ⚠ `offers` IS THE THIRD CONDITION AND IT IS NOT OPTIONAL. A parent walking up to a door has no children
  // checked in yet and nothing at the desk — 0 and 0 — so without it this card is absent at exactly the
  // moment the arrival button inside it is the only thing they want. That is what it was a separate card for
  // until 2026-09-12.
  if (!kids.length && !askAtDesk && !offers) return null;
  return (
    <div style={{ borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', overflow: 'hidden', marginBottom: 22, animation: 'trinityFade .5s ease both' }}>
      {/* COLLAPSIBLE, AND IT OPENS BY DEFAULT — owner request 2026-09-11. Same shape as CareSection above:
          a header button, a chevron, and the choice remembered. The default is the load-bearing part: this
          card exists so a parent can hold a pickup code up at a door, and a code behind one more tap is a
          parent fumbling at the one moment it is needed. So `true` when nothing is stored, and only a member
          who has deliberately closed it gets it closed.
          THE COUNT IS IN THE HEADER FOR THE SAME REASON. Collapsed, this card would otherwise be a title
          with nothing behind it, and a child checked in while it is shut would change nothing a parent could
          see — the silent-blank shape this codebase keeps paying for. The number moves whether it is open or
          not. */}
      <button onClick={toggle} aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '13px 15px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="child" size={18} /></div>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5, lineHeight: 1.1, color: 'var(--ink)' }}>
            Your children at church{kids.length ? <span style={{ color: 'var(--ink-3)', fontWeight: 600 }}> · {kids.length}</span> : null}
          </span>
          {/* Shut, with a child the desk holds no copy of, this is the only thing that would tell a parent to
              go and ask. It says so in the header rather than only inside the fold. */}
          {!open && askAtDesk > 0 ? <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.35 }}>Ask the worker for {askAtDesk === 1 ? 'a pickup code' : askAtDesk + ' pickup codes'}</span> : null}
          {/* SHUT, WITH A SERVICE IN WINDOW, THIS IS THE ONLY THING ON SCREEN THAT SAYS CHECK-IN IS LIVE — and
              the code is now BEHIND this fold, so a parent who shut it last Sunday would otherwise stand at a
              door looking at a title. Same rule as the line above it: what is behind the fold is said in the
              header, whether the fold is open or not. */}
          {!open && stillToBring.length ? <span style={{ display: 'block', fontSize: 12, color: 'var(--sage)', fontWeight: 700, marginTop: 2, lineHeight: 1.35 }}>Open this to check {stillToBring.join(' and ')} in</span> : null}
        </span>
        <Icon name={open ? 'chevU' : 'chevD'} size={17} color="var(--ink-3)" />
      </button>
      {/* FIRST IN THE FOLD, AND THAT ORDER IS THE WALK: a parent opens this at the door, with nobody checked
          in yet, and the arrival button is what they came for. Once the children are in, the rows below it
          are what they come back to — and by then this section has gone (the arrival window closes) or is
          showing the square the worker asked for. */}
      {/* ⚠ `stillToBring` IS NOT PASSED DOWN, AND THAT IS THE FIX. It was, and an empty list then emptied the
          door control itself — the section returned null and a parent had nothing to tap. The filter exists
          for ONE thing: the shut header must not say "check them in" over their own pickup codes. That is a
          WORDING problem, and it must never be traded against a safety one. The section always offers every
          child this phone knows, so its heading, its aria-label and the square's payload agree by
          construction rather than by three rules that can drift apart. */}
      {open ? <WereHereSection ctx={ctx} arr={arr} setArr={setArr} /> : null}
      {open ? kids.map(k => (
        <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 15px', borderTop: '1px solid var(--line)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.childName || 'Name not in this copy'}</div>
            {/* COLLECTED — and it arrives as a document a parent can read, never as a record going away. A
                guardian is never served a tombstone, so without the release this row could never change. */}
            {k.out ? <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600, marginTop: 2 }}>Checked out{tdyClock(k.out) ? ' · ' + tdyClock(k.out) : ''}{k.manual ? ' · by hand' : ''}</div> : null}
          </div>
          {k.out ? null : k.code ? (
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Pickup code</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, letterSpacing: '2px', color: 'var(--ink)' }}>{k.code}</div>
            </div>
          ) : (
            /* A COPY WITH NO CODE IN IT IS NOT A CHILD WITH NO CODE. The same words the worker's row uses. */
            <span style={{ flexShrink: 0, fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>No pickup code for this child</span>
          )}
        </div>
      )) : null}
      {/* SERVED, AND THIS PHONE HOLDS NO COPY OF IT. The walk-up at the desk, the dead phone, the record
          written before the guardian copy shipped. It says so AT ONCE — subscribeMyChildrenCheckins counts
          this from the first event rather than at EOSE — because a parent standing at a door is the person
          least able to wait on a spinner that never resolves, and a blank screen is the worst of the three
          things this card can be. */}
      {open && askAtDesk > 0 ? (
        <div style={{ borderTop: '1px solid var(--line)', padding: '12px 15px', fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Checked in at the desk? Ask the worker for the pickup code.
        </div>
      ) : null}
    </div>
  );
}

// ════════ "WE'RE HERE" — THE PARENT'S HALF OF THE NO-TYPING DESIGN ═════════════════════════════════════
// §3b of reference/PLAN-CHECKIN-NO-TYPING-2026-09-11.md, the accepted design. Two taps at a door: say you
// are here, then hold up the square. The square carries `{ v:1, g:<your pubkey>, c:[names] }` — NO KEY
// MATERIAL AND NO SECRET — and the worker's phone matches `g` against the SIGNED arrivals for her own
// session, so the name she confirms the pairing against is rendered from that signature and never from this
// QR. That is the one rule that makes a photographed or forged square safe, and it lives on HER screen.
//
// ── IT IS NEVER REQUIRED, AND THAT IS DOMAIN.md, NOT A HEDGE ─────────────────────────────────────────────
// "Do not block." A family with no app, a flat battery, a grandparent, a refused arrival, a phone with no
// camera at the other end — every one of those still reaches a worker who types a name, exactly as she did
// yesterday. Nothing on this card is a gate on a child getting into a room.
//
// ── WHY IT IS ABSENT FOR ALMOST EVERYBODY, ALMOST ALWAYS ─────────────────────────────────────────────────
// THREE conditions, all of them: the member ticked "I bring children to church" on their own phone, they
// typed at least one name, and `now` is inside the window of one of their church's own services. On six days
// out of seven, and for most of a congregation on the seventh, this renders NOTHING — the "no dead ends"
// finding from the parent persona of 2026-09-10, which established that the ABSENCE of check-in for people
// with nothing to do with it is correct.
//
// ⚠ WHAT IS DELIBERATELY NOT HERE: the steward's "children's work runs at this service" tick. It would
// decide WHEN this card appears, and it needs a console service editor that DOES NOT EXIST (services can be
// created and deleted, not edited). Without it the card shows for any service in window — and the relay
// still refuses an arrival when that session has no envelope, which the card reports in words. That is the
// honest fallback rather than a button that pretends.
const WEREHERE_WINDOW_TICK = 60000;   // re-ask "are we in window" once a minute; a service starts while the app is open
function WereHereSection({ ctx, arr, setArr }) {
  // ⚠ EVERY HOOK ABOVE THE `return null`, and they must stay there: this section renders nothing for most of
  // the congregation on most days, so a hook below the early return would run on some draws and not others
  // and React would throw the moment a service came into window. scripts/no-hook-after-an-early-return.
  // test.mjs is the guard.
  //
  // ⚠ THE MINUTE TICK IS NOT HERE ANY MORE — it moved to MyChildrenCard when these two became one card
  // (owner, 2026-09-12). It has to live in the component that decides whether there is a card on the screen
  // at all: a timer inside the fold cannot redraw a parent that has already returned null, so a service
  // coming into window while the app is open would have changed nothing a parent could see.
  // ⚠ NO STATE OF ITS OWN, AND THAT IS THE FIX FOR THE WORST THING THE FOLD DID. See the note on `arr` in
  // MyChildrenCard: this component is unmounted by the collapse, so anything it held was thrown away, and
  // a landed arrival came back as an untouched button that could then report itself refused. The card above
  // holds it and hands it down.
  const busy = !!(arr && arr.busy), res = (arr && arr.res) || null, arrivedFor = (arr && arr.forSession) || '';
  const F = window.Fellowship;
  const np = (ctx && ctx.church && ctx.church.npub) || '';
  // THE SAME ARITHMETIC THE CONSOLE MINTS THE KEY WITH AND THE RELAY ADMITS ON — imported, not re-derived,
  // and asked through the one predicate MyChildrenCard opened the card on. A session id IS a service id, and
  // every member is already served every service, so this is computed on this phone from documents it
  // already holds. Nothing is published to make the button appear.
  const offers = wereHereOffers(ctx);
  if (!offers) return null;
  // ⚠ THE NAMES DRAWN HERE ARE WHAT IS LEFT TO ANNOUNCE, not everyone this phone has ever listed. The card
  // computes it (see `stillToBring` there) because it needs the same answer for its shut header, and one
  // predicate with two callers is why `wereHereOffers` exists at all. Falls back to the full list rather
  // than to nothing: a missing prop must never be able to empty a door control.
  const names = offers.names;
  const now = offers.now;
  const landed = res && res.ok && arrivedFor === now.session;
  // "WE COULD NOT CONFIRM" IS NOT "THAT DID NOT SEND", and the difference is the whole of device finding F1
  // (reference/DEVICE-VERIFICATION-two-phone-2026-09-11.md): writeArrival reported {ok:false} TWICE on writes
  // that had SUCCEEDED, because _publishAny throws when nobody answers as well as when a relay refuses. So
  // `unconfirmed` keeps the square on screen and says it may well have arrived. Sending a parent to the desk
  // to report a failure that did not happen is its own harm.
  const unsure = res && !res.ok && res.reason === 'unconfirmed' && arrivedFor === now.session;
  // DRAWN ONLY ONCE THERE IS SOMETHING FOR IT TO MATCH. The worker's phone looks this code up among the live
  // arrivals for her session, so a square shown BEFORE the arrival is written is one she can only ever report
  // as unknown — and rendering the QR every draw is a few hundred modules of work for a picture nobody is
  // looking at. Both reasons point the same way: build it when it is wanted.
  //
  // ⚠ AND IT IS BUILT ONLY WHEN THE FOLD IS OPEN, because the fold is now the only thing between a parent and
  // this square: MyChildrenCard renders nothing of this section while it is shut. That is the whole of the
  // owner's ask — the code no longer sits open on Today for the rest of the morning.
  const qr = (landed || unsure) && F && F.arrivalQR ? F.arrivalQR(np) : '';
  // ⚠ GUARDED, AND NOT BECAUSE IT CAN OVERFLOW TODAY. qrcode-generator throws when a payload will not fit
  // any symbol version, measured at about 2331 bytes at this error-correction level; twelve names of forty
  // characters caps this payload at roughly 1118 even at four bytes a character, so it cannot reach that
  // now. The try/catch makes the safety independent of those two caps rather than conditional on them —
  // the app root is the only error boundary above Today, so a throw here blanks the whole screen, and a cap
  // somebody widens later must not be able to do that. No square is already a state this card words.
  let svg = '';
  try { svg = (qr && window.TrinityIdentity && window.TrinityIdentity.qrSVG) ? window.TrinityIdentity.qrSVG(qr) : ''; }
  catch (e) { svg = ''; }
  const say = async () => {
    if (busy) return;
    setArr({ busy: true, res: null, forSession: '', forChurch: np, forMe: (F && F.myPubkey) || '' });
    let r;
    // A BUTTON THAT DOES NOTHING AND SAYS NOTHING IS THE WORST OF THE THREE THINGS THIS CARD CAN BE. An
    // earlier version returned early when `ctx.checkinArrive` was missing, which on a shell that had not
    // finished loading is a parent tapping at a door with no response at all — "fix the control, not the
    // label", the other way round. A missing transport is a REFUSAL with a reason, worded like any other.
    try { r = (ctx && ctx.checkinArrive) ? await ctx.checkinArrive({ session: now.session }) : { ok: false, reason: 'unavailable' }; }
    catch (e) { r = { ok: false, reason: 'threw' }; }
    const out = r || { ok: false, reason: 'unavailable' };
    setArr({ busy: false, forSession: now.session, res: out, forChurch: np, forMe: (F && F.myPubkey) || '' });
    // WRITTEN ALONGSIDE, NEVER INSTEAD. A refusal is recorded too: "we tried and were turned away" is an
    // answer a parent coming back to this screen needs as much as a success, and re-tapping after a refusal
    // is exactly how the duplicate-arrival confusion starts.
    try { if (F && F.setArrivalOutcome) F.setArrivalOutcome(np, now.session, out); } catch (e) {}
  };
  return (
    <div style={{ borderTop: '1px solid var(--line)' }}>
      {/* THE SECTION STILL NAMES THE CHILDREN, and that is not a duplicate of the header above it. The header
          counts who is ALREADY IN A ROOM; this line names who this phone is about to bring, and on the walk
          up to the door those two lists are different — usually 0 and 2. */}
      <div style={{ padding: '12px 15px 0' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14.5, lineHeight: 1.2, color: 'var(--ink)' }}>Bringing {names.join(' and ')} in?</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.35 }}>Tell the children’s room you’re at the door.</div>
      </div>
      {!landed && !unsure ? (
        <div style={{ padding: '11px 15px 13px', display: 'flex', alignItems: 'center', gap: 11 }}>
          <button onClick={say} disabled={busy}
            style={{ padding: '10px 18px', borderRadius: 12, border: 'none', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, background: 'var(--sage)', color: 'var(--on-accent, #fff)', fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 14 }}>
            {busy ? 'Telling them…' : 'We’re here'}</button>
          {/* …AND IT IS ABOUT THE ROOM IN FRONT OF THEM. `arrivedFor` pins every one of these three states to
              the session they were answered for, so a refusal at nine o'clock is not still on screen over the
              eleven o'clock button. A church with two services is the case that makes it visible.
              ⚠ AND IT NAMES THE CLOCK ONLY FOR THE ONE REFUSAL A CLOCK CAN CAUSE. This branch was unreachable
              for as long as `err.refused` was dead code (fixed 2026-09-14), and the moment it started firing
              it began accusing the clock over EVERY refusal vocabulary. `ctx.clockIsWrong` is a MEASURED
              verdict — clockLooksWrong(), five minutes — and it is entirely independent of why the relay
              said no, so a member the church has deliberately BLOCKED, on a phone a few minutes out, read
              "your clock … is why that was turned away". A causal claim we had not established, about the
              one case where the truth is a person, not a setting.
              The comment below justified it with "the relay's refusals are byte-identical from here". That
              was true when it was written and is not now: `res.message` carries the relay's own words, so
              `auth-required` (which IS what a skewed clock produces — NIP-42 fails on it) is distinguishable
              from `blocked`, `invalid`, `restricted`, `error` and `rate-limited`. Named for auth-required,
              no cause named for the rest. Audit of the refusal fix, 2026-09-14.
              ⚠ A REHYDRATED OUTCOME CARRIES NO MESSAGE (setArrivalOutcome keeps ok + reason only), so a
              parent returning to this screen after a restart gets the no-cause wording. That is the right
              way round: it under-claims rather than accusing the wrong thing.

              ⚠ THE THIRD OUTCOME NAMES NO CAUSE IT HAS NOT MEASURED, and this sentence used to. It read
              "Your church hasn't opened a children's room for this service", which is only ONE of at least
              four things `refused` covers: _PUB_REFUSED matches /^(error|blocked|invalid|restricted|
              rate-limited|auth-required)/, so a phone whose clock is more than ten minutes out fails NIP-42
              and gets `auth-required`, an unauthenticated or PIN-locked socket gets `restricted`, and a
              member the church has BLOCKED gets `blocked`. All three rendered as the church's fault.
              That is the mistake scripts/a-refused-proof-does-not-accuse-the-clock-or-the-member.test.mjs
              exists for, one document over: the relay's refusals are byte-identical from here, so the
              MEASURED skew is the only honest discriminator the client has. Same rule, same shape — name
              the clock when it is measured wrong, and otherwise name no cause and point at a person. */}
          {res && !res.ok && arrivedFor === now.session ? (
            <span style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.35, color: 'var(--ink-2)' }}>
              {res.reason !== 'refused'
                ? 'That didn’t reach your church. Take them to the desk — they’ll be checked in there.'
                : (ctx && ctx.clockIsWrong && /^auth-required/i.test(String((res && res.message) || '')))
                  ? 'This phone’s clock is about ' + (ctx.clockSkewMins || 'a few') + ' minutes ' + (ctx.clockSkewAhead ? 'ahead of' : 'behind') + ' your church’s, which is why that was turned away. Take them to the desk — they’ll be checked in there.'
                  : 'That was turned away and we can’t tell why. Take them to the desk — they’ll be checked in there, and whoever runs the room can look into it afterwards.'}
            </span>
          ) : null}
        </div>
      ) : null}
      {landed || unsure ? (
        <div style={{ padding: '11px 15px 13px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.4, textAlign: 'center' }}>
            {unsure
              ? 'We couldn’t confirm that reached your church — it may well have. Show this to the children’s worker; if they can’t see you, the desk will check them in.'
              : 'Show this to the children’s worker.'}
          </div>
          {svg ? (
            <div role="img" aria-label={'Check-in code for ' + names.join(' and ')}
              style={{ width: 196, height: 196, background: '#fff', borderRadius: 14, padding: 9, boxSizing: 'border-box' }}
              dangerouslySetInnerHTML={{ __html: svg }} />
          ) : null}
          {/* NO SQUARE IS NOT A DEAD END. A phone with no QR renderer still has a parent standing at a door. */}
          {!svg ? <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45, textAlign: 'center' }}>This phone can’t draw the code. Give the worker their names and they’ll check them in.</div> : null}
          <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.4, textAlign: 'center' }}>It carries their names and nothing else — no password, and nothing that opens anything.</div>
        </div>
      ) : null}
    </div>
  );
}
// The engine's answer, asked through one helper so the card has one thing to stub in a test and one thing to
// delete in a sabotage. Returns { session, name, from, until } or null.
function arrivalNow(F, services) {
  try { return (F && F.arrivalSessionNow) ? F.arrivalSessionNow(services) : null; } catch (e) { return null; }
}

// ⚠ ONE PREDICATE, TWO CALLERS, AND THAT IS WHY IT EXISTS. MyChildrenCard decides whether to render a card at
// all, and WereHereSection decides whether to put an arrival button inside it. Before the two were merged
// (owner, 2026-09-12: the QR "is open, and stays open" — put it inside the fold) they were two cards and
// could not disagree. Now they can: a fold that opens on a condition the section does not share is a parent
// tapping a header to find nothing behind it, which is this codebase's silent-blank shape.
//
// Three conditions, all of them — see the WereHereSection header for why each one is there.
// Returns { names, now } or null. Reads localStorage and the clock; writes nothing.
//
// Split in two because the MINUTE TIMER needs the first half WITHOUT the clock: a timer gated on "is a
// service in window" can only ever start once it is no longer needed. `wereHereNames` is the member's own
// answer — the two conditions they typed — and is what the timer is armed on.
function wereHereNames(ctx) {
  const F = window.Fellowship;
  const np = (ctx && ctx.church && ctx.church.npub) || '';
  const brings = !!(F && F.bringsChildren && np && F.bringsChildren(np));
  const names = (brings && F && F.myChildNames) ? F.myChildNames(np) : [];
  return Array.isArray(names) ? names : [];
}
function wereHereOffers(ctx) {
  const names = wereHereNames(ctx);
  if (!names.length) return null;
  const now = (ctx && ctx.churchServices) ? arrivalNow(window.Fellowship, ctx.churchServices) : null;
  return now ? { names, now } : null;
}

function servingNewCount(ctx, seenTs) {
  const seen = Number(seenTs) || 0;
  if (!seen) return 0;   // no mark yet -> nothing is new. A member who joined a church with fifty events on
                         // its calendar this morning is not fifty things behind.
  const ids = new Set();
  for (const e of ((ctx && ctx.churchEvents) || [])) {
    if (!e || e._locked || !e.id) continue;
    if ((Number(e.ts) || 0) > seen) ids.add(e.id);
  }
  return ids.size;
}
const servingNewLabel = (n) => (n > SERV_NEW_CAP ? SERV_NEW_CAP + '+' : String(n));

// THE OTHER HALF OF THE SAME RULE, kept next to it so the two cannot drift apart: given everything this member
// is served (unexpanded — app/app.jsx holds the three source lists) and the current time in seconds, what does
// opening the card stamp? app/app.jsx's markServingSeen() calls this and writes the result; nothing else does.
//
// `now` on its own would leave a document published by a device whose clock runs fast counted for ever — a dot
// that survives being looked straight at. The newest visible ts on its own would not move at all for a member
// with nothing yet, so the mark would stay 0 and the first arrival would badge them. It is the maximum of the
// two. `_locked` entries are skipped because a sealed document carries the PUBLISHING device's created_at,
// which can sit ahead of this phone's clock: letting one set the mark would stamp past things not yet
// published and swallow them when they are.
function servingSeenStamp(events, nowSec) {
  let top = Number(nowSec) || 0;
  for (const e of (events || [])) {
    if (!e || e._locked) continue;
    const ts = Number(e.ts) || 0;
    if (ts > top) top = ts;
  }
  return top;
}

// A mark, not a demand: clay, not red; no sound, no push, no animation. Sits after the card's title.
function ServingNewDot({ n }) {
  if (!n) return null;
  const label = servingNewLabel(n);
  return (
    <span aria-label={(n === 1 ? 'one thing' : label + ' things') + ' the church has posted since you last looked'}
      title="New since you last opened this"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, marginLeft: 7,
        color: 'var(--clay-ink)', fontSize: 11.5, fontWeight: 800, fontFamily: 'var(--font-ui)',
        verticalAlign: 'middle', lineHeight: 1.4, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--clay)', flexShrink: 0 }} />
      {label}
    </span>
  );
}

function TodayScreen({ ctx }) {
  const D = window.TrinityData;
  const Bible = window.Bible;
  // U6: the pinned-sermon card can be dismissed (per sermon id, persisted) and stops saying "New" once it ages,
  // so it doesn't hold the prime Today slot forever. A newly-pinned sermon (different id) reappears.
  const [sermonSeen, setSermonSeen] = React.useState(() => { try { return localStorage.getItem('trinityone.sermon-seen') || ''; } catch { return ''; } });
  // Verse of the day STARTS MINIMISED as a compact bar you tap to open (owner, 2026-09-01); the preference
  // persists, and an explicit choice outranks the default. The stored key tells the three cases apart:
  // ABSENT = never touched it (gets the new default, minimised), '0' = chose expanded, '1' = chose minimised.
  // Only the absent case moves, so no member's existing choice is discarded. `!== '0'` and not `!== '1'` is
  // deliberate: an unreadable or unrecognised value falls to the default, never to the old one.
  const [votdMin, setVotdMin] = React.useState(() => { try { return localStorage.getItem('trinityone.votd-min') !== '0'; } catch { return true; } });
  const toggleVotd = () => setVotdMin(v => { const nv = !v; try { localStorage.setItem('trinityone.votd-min', nv ? '1' : '0'); } catch {} return nv; });

  // ⚠ `now` IS STILL HERE FOR THE VERSE OF THE DAY, WHICH PICKS BY DAY-OF-YEAR. Deleting it with the
  // greeting below blanked the whole Today screen ("now is not defined") — the silent-blank shape, caught by
  // scripts/todays-header-fits-the-phone.test.mjs.
  const now = new Date();
  // ⚠ NO DATE AND NO GREETING. Both were here until 2026-09-12 and the owner asked for them off: a phone
  // already shows the date and the time on its own status bar, an inch above this line, and "Good morning"
  // is two lines of the most valuable space on the screen saying nothing a member did not know. What is left
  // in this column is the one thing only this app can tell them — which church they are looking at.
  // day-streak: +1 per consecutive calendar day the app is opened
  const [streak, setStreak] = useStateT(() => (lsGet('trinityone.streak', { count: 0 }).count) || 0);
  useEffectT(() => {
    // THE LOCAL DAY, not the UTC one. Both lines here read `toISOString()`, which is the UTC calendar day:
    // east of Greenwich it rolls over during the evening and west of it during the night, so a member could
    // open the app two evenings running and be told their streak had broken, or open it twice in one local
    // day and have it counted twice. Found by audit 2026-09-11 alongside the check-in date bug — the same
    // idiom, a smaller consequence. `todayISO()` is app/recur.jsx's shared helper, already used twice in
    // this file, and the "yesterday" half has to move with it or the comparison straddles two calendars.
    const today = todayISO();
    const s = lsGet('trinityone.streak', { count: 0, last: null });
    if (s.last === today) { setStreak(s.count); return; }
    const y = new Date(Date.now() - 864e5);
    const yest = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
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
  const _careToday = todayISO();
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
  // how many things the church has posted, that THIS member is served, since they last opened this card.
  // `ctx.servingSeenTs` is the per-church mark; app/app.jsx stamps it forward from ctx.openServing().
  const servNew = servingNewCount(ctx, ctx.servingSeenTs);
  const fmtServe = (d) => { try { return new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }); } catch { return d; } };

  return (
    <ScreenScroll top="calc(env(safe-area-inset-top, 0px) + 8px)">
      <SafetyBanner ctx={ctx} />
      <RecoveryNudge ctx={ctx} />
      {/* greeting */}
      {/* The greeting column shrinks to a FLOOR; the controls do not shrink at all, and the row wraps rather
          than squeeze past that floor. All numbers below were measured by
          scripts/todays-header-fits-the-phone.test.mjs — nothing here is estimated.

          The original bug: the column was 191px in a 324px row and the control group would not go below 200px,
          so the row's contents needed 391px and the streak pill was drawn from x=353 to x=408 — outside a 360px
          viewport, its digit cut in half; `overflow-x: hidden` on the scroll container clipped it rather than
          scrolling to it. The 191px was the CHURCH-NAME BUTTON's min-content: a `white-space: nowrap` run
          contributes its whole text width to min-content, so the `text-overflow: ellipsis` already on that name
          never got the chance to act, and the column's default `min-width: auto` forbade shrinking below it.

          `minWidth: 0` alone then over-corrected: at 320px with a long church name and a three-digit streak the
          column was squeezed to 56px, and the `overflow-wrap: anywhere` that was there to stop the spill
          inherited into the date and the greeting and broke them MID-WORD ("Wedne/sday", "mornin/g"), while the
          church name collapsed to a bare 14px ellipsis and the row grew from 87px to 169px tall.

          So the column now carries a floor instead of a licence to shrink for ever:
            · flex 1 1 96px  — 96 cleared the DATE line's measured min-content of 90px (the widest unbreakable
                               word, "WEDNESDAY"/"SEPTEMBER" in Sora 13px). ⚠ THAT LINE IS GONE (2026-09-12,
                               owner), and the number is kept rather than re-derived: the column now holds
                               only the church pill, whose ellipsis makes its own minimum zero, so 96 is no
                               longer a floor anything NEEDS — it is the basis flexbox decides the wrap from,
                               and dropping it would let the column collapse and the controls stop wrapping.
                               scripts/todays-header-fits-the-phone.test.mjs measures the result at 320/360/
                               390px, so this is guarded by what it draws rather than by the reasoning above.
            · minWidth 0     — without it the column's automatic minimum size is that same 191px. That was the
                               original overflow; with wrapping on it shows up instead as the header dropping
                               to two lines at 360px and 390px, which have the room to stay on one.
            · flexWrap wrap  — when the floor plus the controls genuinely do not fit (320px, or 360px with a
                               three-digit streak) the controls drop to their own line instead of crushing the
                               greeting. Flexbox decides that from the flex BASIS, which is why the floor is
                               written as a basis and not as a min-width.
            · marginLeft auto on the controls — keeps them against the right edge on a line of their own, which
                               `justify-content: space-between` does not do for a single item.
            · maxWidth min(220px, 100%) on the church button — a `white-space: nowrap` name IS its own
                               min-content and an inline-flex box never shrinks below that, so without the cap
                               the pill lays out at the full width of the name: measured at 334px, running
                               32px off a 320px screen, for "The Cathedral Church of Saint Peter and Saint
                               Paul". The cap is what hands the shortening to the ellipsis instead.
          The church name's ellipsis needs no `min-width: 0` of its own: `overflow: hidden` on that span already
          makes its automatic minimum size zero. That was measured, so it is gone.
          Trimming the pill's padding instead would have come back at 320px, or at a 365-day streak. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 20, animation: 'trinityFade .5s ease both' }}>
        <div style={{ flex: '1 1 96px', minWidth: 0 }}>
          {ctx.church ? <button onClick={ctx.openChurchSwitcher} title="Your church" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '3px 12px 3px 3px', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 999, cursor: 'pointer', maxWidth: 'min(220px, 100%)', boxShadow: 'var(--shadow)' }}>{window.ChurchBadge ? <ChurchBadge church={ctx.church} size={20} radius={999} /> : <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--clay)', flexShrink: 0 }} />}<span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ctx.church.name}</span></button> : null}
        </div>
        {/* marginLeft auto right-aligns this group on a line of its own (space-between does not);
            flexShrink 0 is MEASURED INERT — the buttons' own automatic minimum size already floors the
            group at 200px — and is kept only as a statement of intent. */}
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
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
          <button onClick={ctx.toggleDark} aria-label={ctx.dark ? 'Switch to light mode' : 'Switch to dark mode'} style={{
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

      {/* MY OWN CHILDREN AT TODAY'S SESSION, FIRST AMONG THE CARDS — a pickup code is needed at a door, now,
          and renders NOTHING for everybody else (see MyChildrenCard).
          ⚠ ONE CARD, NOT TWO, SINCE 2026-09-12. "We're here" and the QR that saves the worker typing the
          names (§3b of PLAN-CHECKIN-NO-TYPING-2026-09-11) used to sit here as a second card of their own,
          which meant the square opened at the door and then stayed open on Today for the rest of the
          morning. It is a section inside MyChildrenCard's fold now — WereHereSection — so the card's own
          collapse puts it away, and the whole of a member's children's-work business is in one place. */}
      <MyChildrenCard ctx={ctx} />

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

      {/* Serving (next slot / pending ask) -> opens the Serving overlay.
          Gated on ctx.church, which is null while the app is PIN-locked. The fallback branch below renders
          unconditionally — "Serving & events · RSVP · your rota" — so a locked phone still announced that its
          owner belongs to a church with a rota even after the church's NAME was hidden. Hiding one string is
          not hiding the church. AUDIT-2026-07-27. */}
      {!ctx.church ? null : (servNext || servPendingN) ? (
        <div onClick={() => ctx.openServing && ctx.openServing()} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18, marginBottom: 22, cursor: 'pointer', boxShadow: 'var(--shadow)', animation: 'trinityFade .5s ease both',
          background: servPendingN ? 'color-mix(in oklab, var(--gold) 9%, var(--surface))' : 'color-mix(in oklab, var(--sage) 9%, var(--surface))',
          border: servPendingN ? '1px solid color-mix(in oklab, var(--gold) 32%, var(--line))' : '1px solid color-mix(in oklab, var(--sage) 30%, var(--line))' }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: servPendingN ? 'color-mix(in oklab, var(--gold) 18%, var(--surface))' : 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: servPendingN ? '#8a6717' : 'var(--sage)' }}><Icon name={servPendingN ? 'sparkle' : 'calCheck'} size={22} stroke={1.8} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {servPendingN ? (
              <React.Fragment>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>Can you serve?<ServingNewDot n={servNew} /></div>
                <div style={{ fontSize: 12.5, color: '#8a6717', fontWeight: 600 }}>{servPendingN} request{servPendingN > 1 ? 's' : ''} waiting for your reply</div>
              </React.Fragment>
            ) : (
              <React.Fragment>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>You’re serving · {servNext.teamName}<ServingNewDot n={servNew} /></div>
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
            {/* The title and its dot are ONE line. "What’s happening" plus a "9+" badge is wider than the
                old "Serving & events" was, and at 320px it wrapped and grew the card 79px -> 95px
                (serving-card-says-whats-new.test.mjs catches exactly this). nowrap + ellipsis keeps the
                dot beside the title instead of under it; minWidth:0 lets the ellipsis actually engage. */}
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5, display: 'flex', alignItems: 'center', minWidth: 0 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>What’s happening</span>
              <ServingNewDot n={servNew} />
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 600 }}>See what’s on · RSVP · your rota</div>
          </div>
          <Icon name="chevR" size={18} color="var(--ink-3)" />
        </div>
      )}

      {/* Verse of the day — minimisable hero (below the care + serving cards) */}
      {votdMin ? (
        <button type="button" onClick={toggleVotd} aria-label={'Show the verse of the day \u2014 ' + votd.ref} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', boxSizing: 'border-box', minHeight: 44, textAlign: 'left', border: 'none', fontFamily: 'var(--font-ui)', padding: '11px 15px', borderRadius: 16, marginBottom: 22, cursor: 'pointer', background: 'linear-gradient(150deg, var(--clay), var(--clay-deep))', color: 'var(--on-clay)', boxShadow: 'var(--shadow)', animation: 'trinityFade .4s ease both' }}>
          <Icon name="sparkle" size={15} color="#fff" style={{ flexShrink: 0, opacity: .92 }} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Verse of the day · {votd.ref}</div>
          <Icon name="chevD" size={18} color="#fff" style={{ flexShrink: 0, opacity: .92 }} />
        </button>
      ) : (
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', opacity: .92 }}>
              <Icon name="sparkle" size={15} stroke={2} /> Verse of the day
            </div>
            <button onClick={(e) => { e.stopPropagation(); toggleVotd(); }} aria-label="Minimise" style={{ border: 'none', background: 'rgba(255,255,255,.18)', color: '#fff', width: 28, height: 28, borderRadius: 999, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="chevU" size={16} color="#fff" /></button>
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
      )}

      {/* WAITING FOR APPROVAL, SAID ON THE FIRST SCREEN. The waiting page itself is praised by every member
          who reaches it — the problem is that it lives on one tab out of five, and six people across four
          rounds looked at Today first and saw a normal, working app. Bridget, 74: "On my home screen the
          church's name sits at the top with no sign at all that I'm still waiting, so at a glance I'd have
          believed I was already in." Eunice put the tablet down and assumed she had done it wrong. */}
      {/* THREE GUARDS, NOT ONE — this banner shipped with only `isPending` and that was wrong twice over.
          `isPending` is `approval && !isAdmitted`, and `removed` (app.jsx) is `wasAdmitted && approval &&
          !isAdmitted` — so EVERY REMOVED MEMBER IS ALSO PENDING. The Community tab checks `removed` first,
          deliberately (screens-chat.jsx, commit 66d7807, "do not show them the newcomer's 'a steward usually
          lets people in within a day'"). Gating this on isPending alone undid that on the app's FIRST screen:
          someone removed — including for a safeguarding reason — would open the app and read that they were
          waiting to be let in, while Community told them they had been removed. Two tabs, opposite stories,
          and the home screen was the one that lied.
          The second guard is the same three-state split the chat page carries: a join the relay REFUSED is not
          "sent", and "you don't need to do anything else" is the opposite of the truth for it — retrying is the
          only thing that can help. Rather than restate that here and drift, this banner stays quiet for the
          failed and queued cases and points at the page that handles them properly. */}
      {/* A FOURTH GUARD: we must have been ABLE to ask. `isPending` is `approval && !isAdmitted`, and the
          admitted list is a GATED read — if the relay refused our NIP-42 proof it comes back EMPTY, which is
          identical to "not admitted yet". Measured on a phone 2026-09-04: with the clock 15 minutes out, a
          member the church admitted weeks earlier was told her request had been sent and a steward would let
          her in within a day, with a "Check again" that could never succeed. The card below is for someone
          genuinely waiting; the one above it is for someone we could not check. */}
      {ctx.joinState && ctx.joinState.authFailed && !ctx.joinState.isAdmitted ? (
        <div style={{ marginBottom: 22, padding: '14px 16px', borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <div style={{ fontWeight: 800, fontSize: 14.5, marginBottom: 3 }}>Can’t check with your church right now</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>
            {/* ONLY BLAME THE CLOCK WHEN WE HAVE MEASURED IT. The relay's refusal is identical for a wrong
                clock and for a member the church has BLOCKED, so the confident version of this text was
                telling banned people to check their date settings and promising their posts would send —
                they never will. The measured skew is the only thing that separates the two. */}
            {ctx.clockIsWrong
              ? <React.Fragment>This phone’s clock is about <b>{ctx.clockSkewMins} minutes</b> {ctx.clockSkewAhead ? 'ahead of' : 'behind'} your church’s. Set the date and time to update automatically and this will sort itself out — nothing is lost, and anything you post will send once it reconnects.</React.Fragment>
              : <React.Fragment>Your church’s relay wouldn’t accept this phone. If it doesn’t clear on its own shortly, speak to whoever runs your church.</React.Fragment>}
          </div>
        </div>
      ) : null}
      {ctx.joinState && ctx.joinState.isPending && !ctx.joinState.removed && !ctx.joinFailed && !ctx.joinQueued && !ctx.joinState.authFailed ? (
        <div style={{ marginBottom: 22, padding: '14px 16px', borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <div style={{ fontWeight: 800, fontSize: 14.5, marginBottom: 3 }}>Waiting to be let in</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>
            {/* "Has been sent" only when a relay accepted it (ctx.joinSent) — see the pending screen's note.
                This card is what a PIN-locked phone showed while nothing had been sent at all. 2026-09-06. */}
            {ctx.joinSent
              ? <React.Fragment>Your request has been sent{ctx.church && ctx.church.name ? ' to ' + ctx.church.name : ''}. A steward usually lets people in within a day — you don’t need to do anything else.</React.Fragment>
              : ctx.joinIntent
              ? <React.Fragment>You’ll ask to join {(ctx.church && ctx.church.name) || 'this church'} <b>when you unlock</b> this phone — nobody at the church can see the request until then.</React.Fragment>
              : <React.Fragment>Your request to join{ctx.church && ctx.church.name ? ' ' + ctx.church.name : ''} <b>hasn’t been sent yet</b> — nobody at the church can see it. Tap <b>Check again</b> to send it.</React.Fragment>}
          </div>
          <button onClick={() => ctx.go && ctx.go('chat')} style={{ marginTop: 10, padding: '7px 12px', borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, color: 'var(--ink)' }}>
            Check again
          </button>
        </div>
      ) : null}

      {/* Practical care: back on Today, gated on the church having switched it on. Three members failed to
          find it inside Serving & events and all three read Today first; the full tab still exists. */}
      <CareCard ctx={ctx} />

      {/* Featured sermon — a steward pinned it; tap to play. Dismissable (per id), and "New" softens once it ages. */}
      {ctx.pinnedSermon && ctx.pinnedSermon.sha256 && sermonSeen !== ctx.pinnedSermon.id ? (() => {
        const ps = ctx.pinnedSermon;
        const fresh = (Date.now() / 1000 - (ps.ts || ps.at || 0)) < 7 * 86400;
        const isVid = String(ps.mime || '').startsWith('video');
        const kind = isVid ? 'video' : 'audio clip';
        return (
        <div onClick={() => ctx.playSermon(ps)} style={{
          display: 'flex', alignItems: 'center', gap: 14, padding: 15, borderRadius: 20, cursor: 'pointer', marginBottom: 22,
          background: 'linear-gradient(150deg, var(--clay), var(--clay-deep))', color: 'var(--on-clay)', boxShadow: 'var(--shadow-lg)',
          position: 'relative', overflow: 'hidden', animation: 'trinityFade .5s ease both',
        }}>
          <div style={{ position: 'absolute', right: -18, bottom: -22, opacity: .16 }}><Icon name={String(ps.mime || '').startsWith('video') ? 'play' : 'headphones'} size={100} color="#fff" /></div>
          <div style={{ width: 46, height: 46, borderRadius: 13, background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name={isVid ? 'play' : 'headphones'} size={22} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', opacity: .9 }}>{fresh ? ('New ' + kind) : kind}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, lineHeight: 1.2, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ps.title}</div>
          </div>
          <button onClick={(e) => { e.stopPropagation(); setSermonSeen(ps.id); try { localStorage.setItem('trinityone.sermon-seen', ps.id); } catch {} }} aria-label="Dismiss" style={{ border: 'none', background: 'rgba(255,255,255,.18)', color: '#fff', width: 28, height: 28, borderRadius: 999, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}><Icon name="x" size={15} color="#fff" /></button>
        </div>
        );
      })() : null}

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
                {ctx.netUnread > 0 ? <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--on-clay)', background: 'var(--clay)', borderRadius: 999, padding: '1px 7px' }}>{ctx.netUnread} new</span> : null}
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

Object.assign(window, { TodayScreen, ScreenScroll, ProgressRing, SafetyDock, MyChildrenCard });
