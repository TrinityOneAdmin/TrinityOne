// screens-today.jsx — the home / "Today" dashboard
const { useState: useStateT, useEffect: useEffectT } = React;

function ScreenScroll({ children, top = 56, bottom = 96, style = {} }) {
  return (
    <div className="no-scrollbar" style={{
      position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden',
      padding: `${top}px 18px ${bottom}px`, ...style,
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
const CARE_TYPE_LABEL = { meals: 'Meals', rides: 'Rides', errands: 'Errands', visits: 'Visits', childcare: 'Childcare' };
const CARE_TYPE_ICON = { meals: 'heart', rides: 'calCheck', errands: 'check', visits: 'users', childcare: 'child' };
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

function CareNeedRow({ need, slots, skips, care, expanded, onToggle }) {
  const myPub = care.myPub || '';
  const dates = careDateRange(need.startDate, need.endDate);
  const skipSet = new Set(skips.filter(k => k.needId === need.id).map(k => k.isoDate));
  const fillsFor = (iso) => slots.filter(s => s.needId === need.id && s.isoDate === iso);
  const isRecipient = !!need.recipient && need.recipient === myPub.toLowerCase();
  const openDays = dates.filter(d => !skipSet.has(d) && fillsFor(d).length === 0);
  const filledDays = dates.filter(d => fillsFor(d).length > 0).length;
  const accent = 'var(--sage)';
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
            return (
              <div key={iso} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid color-mix(in oklab, var(--line) 60%, transparent)', opacity: skipped ? 0.55 : 1 }}>
                <div style={{ minWidth: 96, fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', textDecoration: skipped ? 'line-through' : 'none' }}>{careFmtDate(iso)}</div>
                <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>
                  {skipped ? <span>Not needed this day</span>
                    : fills.length ? fills.map((f, i) => <span key={i} style={{ marginRight: 8 }}><Icon name="check" size={11} color="var(--sage)" /> {careName(f.pubkey, myPub)}</span>)
                    : <span style={{ color: 'var(--ink-3)' }}>Open</span>}
                </div>
                {!skipped && (mineFilled
                  ? <button onClick={() => care.clearFill(need.id, iso)} style={careBtnMine} title="You’re signed up — tap to cancel"><Icon name="check" size={12} color="var(--sage)" stroke={3} /> You’re helping</button>
                  : <button onClick={() => care.fill(need.id, iso)} style={careBtnHelp}>I’ll help</button>)}
                {isRecipient && fills.length === 0 && (skipped
                  ? <button onClick={() => care.clearSkip(need.id, iso)} style={careBtnGhost}>Undo</button>
                  : <button onClick={() => care.skip(need.id, iso)} style={careBtnGhost}>Skip</button>)}
              </div>
            );
          })}
          {isRecipient ? <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.45 }}>This is for you. Tap <b>Skip</b> on any day you’re covered — it’ll come off the list.</div> : null}
        </div>
      )}
    </div>
  );
}
const careBtnHelp = { flexShrink: 0, padding: '6px 11px', borderRadius: 9, border: 'none', background: 'var(--sage)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-ui)' };
const careBtnGhost = { flexShrink: 0, padding: '6px 10px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-ui)' };
const careBtnMine = { flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 9, border: '1px solid var(--sage)', background: 'color-mix(in oklab, var(--sage) 15%, var(--surface))', color: 'var(--sage)', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-ui)' };

function CareCard({ ctx }) {
  const care = ctx.care || {};
  const s = care.settings || {};
  const [openId, setOpenId] = React.useState(null);
  if (!s.enabled) return null;
  const today = new Date().toISOString().slice(0, 10);
  const myPub = (care.myPub || '').toLowerCase();
  // visibility 'team' → only the care team (roster of the configured admin group) sees the list;
  // a recipient always sees their own need so they can mark skip-days.
  const amCareTeam = s.visibility !== 'team' || (() => {
    const roster = (ctx.churchRosters || []).find(r => r.team === s.adminGroupId);
    return !!(roster && (roster.people || []).some(p => p && (p.pub || '').toLowerCase() === myPub));
  })();
  let live = (care.needs || []).filter(n => !n.endDate || n.endDate >= today);
  if (s.visibility === 'team' && !amCareTeam) live = live.filter(n => n.recipient && n.recipient === myPub);
  if (!live.length) return null;
  return (
    <div style={{ marginBottom: 22, animation: 'trinityFade .5s ease both' }}>
      <SectionLabel>Practical care</SectionLabel>
      <div style={{ padding: 14, borderRadius: 18, background: 'color-mix(in oklab, var(--sage) 7%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 26%, var(--line))', boxShadow: 'var(--shadow)' }}>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 11 }}>Someone in the church could use a hand. Sign up for a day — a meal, a ride, an errand.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {live.map(n => <CareNeedRow key={n.id} need={n} slots={care.slots || []} skips={care.skips || []} care={care} expanded={openId === n.id} onToggle={() => setOpenId(openId === n.id ? null : n.id)} />)}
        </div>
      </div>
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
  const pNext = plan.days.find(d => !pDoneSet.has(d.d)) || plan.days[plan.days.length - 1];

  const churchDevo = (ctx.churchDevos || [])[0];   // latest real devotional the church shared (else hide the card)
  // serving: the member's next confirmed slot + any pending "can you serve?" asks
  const servNext = ctx.servNext;
  const servPendingN = (ctx.servPending || []).length;
  const fmtServe = (d) => { try { return new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }); } catch { return d; } };

  return (
    <ScreenScroll>
      {/* greeting */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, animation: 'trinityFade .5s ease both' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '.3px', textTransform: 'uppercase' }}>{dateStr}</div>
          <h1 style={{ margin: '4px 0 0', fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, letterSpacing: '-.6px', lineHeight: 1.05 }}>{greet}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(() => {
            const hdrBtn = { width: 40, height: 40, borderRadius: 14, border: '1px solid var(--line)',
              background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', boxShadow: 'var(--shadow)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' };
            const unread = (D.NOTIFICATIONS || []).some(n => n.unread) || (ctx.netUnread > 0);
            return (
              <React.Fragment>
                <button onClick={ctx.openSearch} aria-label="Search" style={hdrBtn}><Icon name="study" size={19} /></button>
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

      {/* Verse of the day — hero */}
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

      {/* Practical care / meal trains — only when the church enabled it and has an open need */}
      <CareCard ctx={ctx} />

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
