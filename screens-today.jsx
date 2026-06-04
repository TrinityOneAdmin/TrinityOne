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

  return (
    <ScreenScroll>
      {/* greeting */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, animation: 'trinityFade .5s ease both' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '.3px', textTransform: 'uppercase' }}>{dateStr}</div>
          <h1 style={{ margin: '4px 0 0', fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, letterSpacing: '-.6px', lineHeight: 1.05 }}>{greet}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={ctx.toggleDark} style={{
            width: 40, height: 40, borderRadius: 14, border: '1px solid var(--line)',
            background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', boxShadow: 'var(--shadow)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Icon name={ctx.dark ? 'sun' : 'moon'} size={19} /></button>
          <div title={`${streak}-day streak`} style={{
            height: 40, padding: '0 12px', borderRadius: 14, background: 'var(--clay-soft)',
            color: 'var(--clay-ink)', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700, fontSize: 14,
            boxShadow: 'var(--shadow)',
          }}><Icon name="flame" size={18} stroke={2} />{streak}</div>
        </div>
      </div>

      {/* Verse of the day — hero */}
      <div onClick={() => ctx.openShare(votd)} style={{
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

      {/* Plan + devotional cards */}
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
        <div onClick={ctx.openDevotional} style={{
          flex: 1, padding: 16, borderRadius: 20, background: 'var(--sage)', cursor: 'pointer',
          color: '#fff', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow)',
        }}>
          <div style={{ position: 'absolute', right: -20, top: -16, opacity: .18 }}><Icon name="sun" size={110} stroke={1.4} color="#fff" /></div>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sun" size={22} stroke={2} color="#fff" />
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 10, opacity: .9 }}>Devotional · {D.DEVOTIONAL.read}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, lineHeight: 1.15, marginTop: 2, position: 'relative' }}>{D.DEVOTIONAL.title}</div>
        </div>
      </div>

      {/* Quick row */}
      <div style={{ display: 'flex', gap: 10, animation: 'trinityFade .5s ease .2s both' }}>
        {[
          { ic: 'study', label: 'Search', go: () => ctx.go('search') },
          { ic: 'pen', label: 'Journal', go: () => ctx.go('library') },
          { ic: 'headphones', label: 'Listen', go: () => ctx.toast('Audio coming soon') },
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
    </ScreenScroll>
  );
}

Object.assign(window, { TodayScreen, ScreenScroll, ProgressRing });
