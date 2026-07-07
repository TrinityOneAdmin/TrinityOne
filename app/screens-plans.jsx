// screens-plans.jsx — reading plans gallery + active plan detail (real progress)
const { useState: useP } = React;

function doneDays(ctx, id) { return ctx.planProgress[id] || []; }
function nextDay(plan, doneSet) { return plan.days.find(d => !doneSet.has(d.d)) || plan.days[plan.days.length - 1]; }

// a church devotional rendered with the SAME card dimensions as a PlanCard (for the 2-col grid)
function DevoCard({ d, onClick }) {
  const accent = d.accent || 'var(--sage)';
  return (
    <div onClick={onClick} style={{
      borderRadius: 22, overflow: 'hidden', cursor: 'pointer', position: 'relative',
      background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)',
    }}>
      <div style={{ height: 80, background: accent, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 80% 0%, rgba(255,255,255,.3), transparent 55%)' }} />
        <div style={{ position: 'absolute', right: -16, bottom: -22, opacity: .2 }}><Icon name="read" size={120} stroke={1.3} color="#fff" /></div>
        <span style={{ position: 'absolute', top: 12, left: 14, background: 'rgba(255,255,255,.22)', color: '#fff',
          padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, backdropFilter: 'blur(4px)' }}>Devotional</span>
      </div>
      <div style={{ padding: '13px 15px 15px' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{d.title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 3 }}>{d.ref || 'A reflection'}</div>
        <div style={{ marginTop: 11, fontSize: 12.5, color: 'var(--clay)', fontWeight: 700 }}>Read →</div>
      </div>
    </div>
  );
}

// a church devotional SERIES as a 2-col card (same dimensions as a plan/devotional card) — opens the series
function DevoSeriesCard({ group, ctx }) {
  const prog = ctx.devoProgress || {};
  const read = (d) => !!(prog[d.id] && prog[d.id].length);
  const next = group.items.find(d => !read(d)) || group.items[0];
  const started = group.items.some(read);
  return (
    <div onClick={() => ctx.openChurchDevo(next)} style={{
      borderRadius: 22, overflow: 'hidden', cursor: 'pointer', position: 'relative',
      background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)',
    }}>
      <div style={{ height: 80, background: 'var(--sage)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 80% 0%, rgba(255,255,255,.3), transparent 55%)' }} />
        <div style={{ position: 'absolute', right: -16, bottom: -22, opacity: .2 }}><Icon name="read" size={120} stroke={1.3} color="#fff" /></div>
        <span style={{ position: 'absolute', top: 12, left: 14, background: 'rgba(255,255,255,.22)', color: '#fff',
          padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, backdropFilter: 'blur(4px)' }}>Series</span>
      </div>
      <div style={{ padding: '13px 15px 15px' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{group.name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 3 }}>{group.items.length} devotionals</div>
        <div style={{ marginTop: 11, fontSize: 12.5, color: 'var(--clay)', fontWeight: 700 }}>{started ? 'Continue →' : 'Begin →'}</div>
      </div>
    </div>
  );
}

// group church devotionals by the steward's explicit Series field (mirrors the steward console). Devotionals
// with no series, or a series of one, stay as standalone cards. Members' grouping == whatever the steward named.
function groupDevosBySeries(devos) {
  const groups = new Map(); const singles = [];
  devos.forEach(d => { const s = (d.series || '').trim(); if (!s) { singles.push(d); return; } if (!groups.has(s)) groups.set(s, { name: s, items: [] }); groups.get(s).items.push(d); });
  const out = [];
  for (const g of groups.values()) { if (g.items.length < 2) singles.push(...g.items); else out.push(g); }
  return { groups: out, singles };
}

// a church devotional series as a featured hero (like the plan hero): Begin/Continue opens the next
// unread devotional; "See all" expands the full list with read-ticks.
function DevoSeriesHero({ group, ctx }) {
  const [open, setOpen] = React.useState(false);
  const prog = ctx.devoProgress || {};
  const read = (d) => !!(prog[d.id] && prog[d.id].length);
  const next = group.items.find(d => !read(d)) || group.items[0];
  const started = group.items.some(read);
  return (
    <div style={{ marginBottom: 16, animation: 'trinityFade .5s ease .06s both' }}>
      <div onClick={() => ctx.openChurchDevo(next)} style={{
        borderRadius: 24, padding: 20, cursor: 'pointer', position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(150deg, var(--sage), #2f5640)', color: '#fff', boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ position: 'absolute', right: -30, top: -30, opacity: .16 }}><Icon name="read" size={170} stroke={1.2} color="#fff" /></div>
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', opacity: .9 }}>Devotional series</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700, margin: '6px 0 2px', lineHeight: 1.1 }}>{group.name}</div>
          <div style={{ fontSize: 13.5, opacity: .92, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.items.length} devotionals · {next.title}</div>
          <button onClick={(e) => { e.stopPropagation(); ctx.openChurchDevo(next); }} style={{ marginTop: 16, width: '100%', padding: '12px', borderRadius: 14, border: 'none',
            background: '#fff', color: '#2f5640', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {started ? 'Continue' : 'Begin'} · {next.title}
          </button>
        </div>
      </div>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', marginTop: 8, padding: '9px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
        {open ? 'Hide list' : `See all ${group.items.length}`} <Icon name={open ? 'chevU' : 'chevD'} size={15} color="var(--clay)" />
      </button>
      {open ? (
        <div style={{ marginTop: 8, border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surface)', overflow: 'hidden' }}>
          {group.items.map((d, i) => (
            <div key={d.id} onClick={() => ctx.openChurchDevo(d)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderTop: i ? '1px solid var(--line)' : 'none', cursor: 'pointer' }}>
              <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, background: read(d) ? 'var(--sage)' : 'var(--surface-2)', color: read(d) ? '#fff' : 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12 }}>{read(d) ? <Icon name="check" size={14} stroke={2.6} color="#fff" /> : i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{d.ref || 'A reflection'}</div>
              </div>
              <Icon name="chevR" size={15} color="var(--ink-3)" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PlanCard({ p, ctx, onClick, corner }) {
  const done = doneDays(ctx, p.id).length;
  const pct = p.len ? done / p.len : 0;
  return (
    <div onClick={onClick} style={{
      borderRadius: 22, overflow: 'hidden', cursor: 'pointer', position: 'relative',
      background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)',
    }}>
      {corner ? <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}>{corner}</div> : null}
      <div style={{ height: 80, background: p.accent, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 80% 0%, rgba(255,255,255,.3), transparent 55%)' }} />
        <div style={{ position: 'absolute', right: -16, bottom: -22, opacity: .2 }}><Icon name="read" size={120} stroke={1.3} color="#fff" /></div>
        <span style={{ position: 'absolute', top: 12, left: 14, background: 'rgba(255,255,255,.22)', color: '#fff',
          padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, backdropFilter: 'blur(4px)' }}>{p.tag}</span>
      </div>
      <div style={{ padding: '13px 15px 15px' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, lineHeight: 1.1 }}>{p.title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 3 }}>{p.sub}</div>
        {done > 0 ? (
          <div style={{ marginTop: 11 }}>
            <div style={{ height: 5, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
              <div style={{ width: `${pct * 100}%`, height: '100%', background: p.accent, borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', marginTop: 5 }}>{done} of {p.len} days</div>
          </div>
        ) : (
          <div style={{ marginTop: 11, fontSize: 12.5, color: 'var(--clay)', fontWeight: 700 }}>Start plan →</div>
        )}
      </div>
    </div>
  );
}

function PlansScreen({ ctx }) {
  const D = window.TrinityData;
  const [tab, setTab] = useP('mine');                  // 'mine' | 'browse'
  const [discoverOpen, setDiscoverOpen] = useP(false);   // collapse the Discover-plans grid in Browse
  const churchPlans = ctx.churchPlans || [];           // plans the church's steward shared
  const churchName = (ctx.church && ctx.church.name) || 'your church';
  const allPlans = [...churchPlans, ...D.PLANS];
  const isChurch = (p) => churchPlans.some(c => c.id === p.id);
  const followed = ctx.plansFollowed || [], hidden = ctx.plansHidden || [];
  // My Plans = church plans (unless the member removed one) + discover plans the member added
  const inMine = (p) => isChurch(p) ? !hidden.includes(p.id) : followed.includes(p.id);
  const myPlans = allPlans.filter(inMine);
  // featured = the steward's NEXT plan — the first church plan in My Plans that isn't finished; failing
  // that, the most-progressed plan I'm in, else the first available.
  const fin = (p) => p.len && doneDays(ctx, p.id).length >= p.len;
  const startedMine = myPlans.filter(p => doneDays(ctx, p.id).length > 0).sort((a, b) => doneDays(ctx, b.id).length - doneDays(ctx, a.id).length);
  const featured = churchPlans.filter(inMine).find(p => !fin(p)) || startedMine[0] || myPlans[0] || allPlans[0];
  const fDone = featured ? doneDays(ctx, featured.id).length : 0;
  const fPct = featured && featured.len ? fDone / featured.len : 0;
  const fNext = featured ? nextDay(featured, new Set(doneDays(ctx, featured.id))) : null;
  const rest = myPlans.filter(p => !featured || p.id !== featured.id);

  // a small corner button on a card: remove (✕) in My Plans, add/added (＋/✓) in Browse
  const cornerBtn = (p, added) => (
    <button onClick={(e) => { e.stopPropagation(); ctx.setPlanInMine(p.id, !added, isChurch(p)); }}
      title={added ? 'Remove from My Plans' : 'Add to My Plans'} aria-label={added ? 'Remove from My Plans' : 'Add to My Plans'}
      style={{ width: 30, height: 30, borderRadius: 999, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: added ? 'var(--sage)' : 'rgba(0,0,0,.4)', color: '#fff', backdropFilter: 'blur(3px)' }}>
      <Icon name={added ? 'check' : 'plus'} size={15} stroke={added ? 3 : 2.4} color="#fff" />
    </button>
  );
  const grid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 22, animation: 'trinityFade .5s ease .08s both' };
  const seg = { display: 'flex', gap: 4, padding: 4, borderRadius: 15, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 22 };
  const segBtn = (k, label) => (
    <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: '10px', borderRadius: 11, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5,
      background: tab === k ? 'var(--surface)' : 'transparent', color: tab === k ? 'var(--ink)' : 'var(--ink-3)', boxShadow: tab === k ? 'var(--shadow)' : 'none' }}>{label}</button>
  );

  return (
    <ScreenScroll>
      <ReadPlansTabs ctx={ctx} style={{ marginBottom: 18 }} />
      <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, letterSpacing: '-.5px', animation: 'trinityFade .5s ease both' }}>Reading Plans</h1>
      <p style={{ margin: '0 0 20px', color: 'var(--ink-2)', fontSize: 14.5, lineHeight: 1.4 }}>A little every day. Pick a path and let it carry you.</p>

      <div style={seg}>{segBtn('mine', 'My Plans')}{segBtn('browse', 'Browse')}</div>

      {tab === 'mine' ? (() => {
        const devo = (ctx.churchDevos || []).length ? groupDevosBySeries(ctx.churchDevos) : { groups: [], singles: [] };
        return (
        <React.Fragment>
          {/* church devotional series — always pinned to the top */}
          {devo.groups.length ? <div style={{ marginBottom: 8 }}>{devo.groups.map(g => <DevoSeriesHero key={g.name} group={g} ctx={ctx} />)}</div> : null}

          {featured ? (
            <div onClick={() => ctx.openPlan(featured)} style={{
              borderRadius: 24, padding: 20, cursor: 'pointer', marginBottom: 24, position: 'relative', overflow: 'hidden',
              background: 'linear-gradient(150deg, var(--clay), var(--clay-deep))', color: '#fff', boxShadow: 'var(--shadow-lg)',
              animation: 'trinityFade .5s ease .05s both',
            }}>
              <div style={{ position: 'absolute', right: -30, top: -30, opacity: .16 }}><Icon name="read" size={170} stroke={1.2} color="#fff" /></div>
              <div style={{ position: 'relative' }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', opacity: .9 }}>{isChurch(featured) ? `Next from ${churchName}` : (fDone ? 'Currently reading' : 'Start a plan')}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, margin: '6px 0 2px' }}>{featured.title}</div>
                <div style={{ fontSize: 13.5, opacity: .92 }}>Day {fNext.d} · {fNext.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
                  <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'rgba(255,255,255,.25)', overflow: 'hidden' }}>
                    <div style={{ width: `${fPct * 100}%`, height: '100%', background: '#fff', borderRadius: 4 }} />
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{Math.round(fPct * 100)}%</span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); ctx.openPlanDay(featured, fNext); }} style={{ marginTop: 16, width: '100%', padding: '12px', borderRadius: 14, border: 'none',
                  background: '#fff', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
                  {fDone ? `Continue · Day ${fNext.d}` : `Begin · Day ${fNext.d}`}
                </button>
              </div>
            </div>
          ) : null}

          {rest.length ? (
            <React.Fragment>
              <SectionLabel>My plans</SectionLabel>
              <div style={grid}>
                {rest.map(p => <PlanCard key={p.id} p={p} ctx={ctx} onClick={() => ctx.openPlan(p)} corner={cornerBtn(p, true)} />)}
              </div>
            </React.Fragment>
          ) : null}

          {!featured ? (
            <div style={{ textAlign: 'center', padding: '20px 16px 28px', color: 'var(--ink-2)' }}>
              <Icon name="read" size={40} stroke={1.4} color="var(--ink-3)" />
              <p style={{ fontSize: 14, lineHeight: 1.5, maxWidth: 260, margin: '8px auto 14px' }}>No plans yet. Browse and add one to start reading a little every day.</p>
              <button onClick={() => setTab('browse')} style={{ padding: '11px 18px', borderRadius: 13, border: 'none', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Browse plans</button>
            </div>
          ) : null}

          {devo.singles.length ? (
            <React.Fragment>
              <SectionLabel>Devotionals from {churchName}</SectionLabel>
              <div style={{ ...grid, animationDelay: '.1s' }}>
                {devo.singles.map(d => <DevoCard key={d.id} d={d} onClick={() => ctx.openChurchDevo(d)} />)}
              </div>
            </React.Fragment>
          ) : null}
        </React.Fragment>
        );
      })() : (
        <React.Fragment>
          {(ctx.churchDevos || []).length ? (() => {
            const { groups, singles } = groupDevosBySeries(ctx.churchDevos);
            return (
              <React.Fragment>
                <SectionLabel>{churchName} devotionals</SectionLabel>
                <div style={grid}>
                  {groups.map(g => <DevoSeriesCard key={g.name} group={g} ctx={ctx} />)}
                  {singles.map(d => <DevoCard key={d.id} d={d} onClick={() => ctx.openChurchDevo(d)} />)}
                </div>
              </React.Fragment>
            );
          })() : null}
          {churchPlans.length ? (
            <React.Fragment>
              <SectionLabel>Plans from {churchName}</SectionLabel>
              <div style={grid}>
                {churchPlans.map(p => <PlanCard key={p.id} p={p} ctx={ctx} onClick={() => ctx.openPlan(p)} corner={cornerBtn(p, inMine(p))} />)}
              </div>
            </React.Fragment>
          ) : null}
          <SectionLabel>Discover plans</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, animation: 'trinityFade .5s ease .1s both' }}>
            {(discoverOpen ? D.PLANS : D.PLANS.slice(0, 4)).map(p => <PlanCard key={p.id} p={p} ctx={ctx} onClick={() => ctx.openPlan(p)} corner={cornerBtn(p, inMine(p))} />)}
          </div>
          {D.PLANS.length > 4 ? (
            <button onClick={() => setDiscoverOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', marginTop: 12, padding: '12px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
              {discoverOpen ? 'Show fewer' : `Show all ${D.PLANS.length} plans`} <Icon name={discoverOpen ? 'chevU' : 'chevD'} size={17} color="var(--clay)" />
            </button>
          ) : null}
        </React.Fragment>
      )}
    </ScreenScroll>
  );
}

// ── plan detail overlay ──
function PlanDetail({ plan, open, onClose, ctx }) {
  if (!plan) return null;
  const doneSet = new Set(doneDays(ctx, plan.id));
  const today = plan.days.find(d => !doneSet.has(d.d));
  const pct = plan.len ? doneSet.size / plan.len : 0;

  const openDay = (d) => {
    const loc = window.Bible.parseRef(d.ref);
    if (!loc) { ctx.toast('Could not open ' + d.ref); return; }
    if (!window.Bible.books().includes(loc.book)) { ctx.toast(d.ref + ' isn’t in this translation'); return; }
    onClose(); ctx.gotoRef(loc.book, loc.chap, loc.verse);
  };

  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, background: 'linear-gradient(160deg, var(--clay), var(--clay-deep))', color: '#fff', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', right: -30, top: 0, opacity: .15 }}><Icon name="read" size={180} stroke={1.2} color="#fff" /></div>
        <div style={{ padding: '10px 16px 22px', position: 'relative' }}>
          <button onClick={onClose} style={{ width: 40, height: 40, borderRadius: 13, border: 'none', background: 'rgba(255,255,255,.2)',
            color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
            <Icon name="chevD" size={20} color="#fff" /></button>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, margin: '16px 0 4px' }}>{plan.title}</h1>
          <p style={{ margin: '0 0 14px', opacity: .92, fontSize: 14 }}>{plan.sub}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'rgba(255,255,255,.25)', overflow: 'hidden' }}>
              <div style={{ width: `${pct * 100}%`, height: '100%', background: '#fff', borderRadius: 4 }} /></div>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{doneSet.size} / {plan.len}</span>
          </div>
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '18px 16px 30px' }}>
        {plan.days.map((d) => {
          const isDone = doneSet.has(d.d);
          const isToday = today && d.d === today.d;
          return (
            <div key={d.d} onClick={() => openDay(d)} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '13px 14px', marginBottom: 9,
              borderRadius: 18, background: isToday ? 'var(--clay-soft)' : 'var(--surface)',
              border: isToday ? '1.5px solid var(--clay)' : '1px solid var(--line)', cursor: 'pointer',
              boxShadow: isToday ? 'var(--shadow)' : 'none',
            }}>
              <button onClick={(e) => { e.stopPropagation(); ctx.togglePlanDay(plan.id, d.d); }} title={isDone ? 'Mark not done' : 'Mark done'}
                style={{ width: 38, height: 38, borderRadius: 999, flexShrink: 0, cursor: 'pointer',
                  background: isDone ? 'var(--clay)' : isToday ? 'var(--gold)' : 'var(--surface-2)',
                  border: isDone || isToday ? 'none' : '1px solid var(--line)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: isDone || isToday ? '#fff' : 'var(--ink-3)', fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: 15 }}>
                {isDone ? <Icon name="check" size={18} stroke={2.4} color="#fff" /> : d.d}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>Day {d.d}{isToday ? ' · Today' : isDone ? ' · Done' : ''}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</div>
                <div style={{ fontSize: 13, color: 'var(--clay)', fontWeight: 600 }}>{d.ref}</div>
              </div>
              <Icon name="chevR" size={18} color="var(--ink-3)" />
            </div>
          );
        })}
      </div>
    </Overlay>
  );
}

// minimal Markdown → React for .md devotionals (headings, bold/italic, lists, blockquote, paragraphs).
function renderMarkdown(src) {
  const inline = (t, key) => {
    // split on **bold** and *italic* / _italic_, keep delimiters
    const parts = t.split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g).filter(Boolean);
    return parts.map((p, i) => {
      if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
      if (/^\*[^*]+\*$/.test(p) || /^_[^_]+_$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
      return <React.Fragment key={i}>{p}</React.Fragment>;
    });
  };
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  const out = []; let list = null;
  const flush = () => { if (list) { out.push(<ul key={'ul' + out.length} style={{ margin: '8px 0 8px 4px', paddingLeft: 22 }}>{list}</ul>); list = null; } };
  lines.forEach((ln, i) => {
    const h = ln.match(/^(#{1,3})\s+(.*)$/);
    const li = ln.match(/^\s*[-*+]\s+(.*)$/);
    if (h) { flush(); const lv = h[1].length; const sz = lv === 1 ? 24 : lv === 2 ? 20 : 17;
      out.push(<div key={i} style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: sz, lineHeight: 1.25, margin: '18px 0 6px' }}>{inline(h[2])}</div>); return; }
    if (li) { (list = list || []).push(<li key={i} style={{ fontFamily: 'var(--font-read)', fontSize: 18, lineHeight: 1.6, color: 'var(--ink)', marginBottom: 4 }}>{inline(li[1])}</li>); return; }
    if (!ln.trim()) { flush(); return; }
    const bq = ln.match(/^>\s?(.*)$/);
    flush();
    if (bq) { out.push(<blockquote key={i} style={{ borderLeft: '3px solid var(--clay)', margin: '10px 0', padding: '2px 0 2px 14px', color: 'var(--ink-2)', fontStyle: 'italic', fontFamily: 'var(--font-read)', fontSize: 18, lineHeight: 1.6 }}>{inline(bq[1])}</blockquote>); return; }
    out.push(<p key={i} style={{ fontFamily: 'var(--font-read)', fontSize: 18, lineHeight: 1.65, color: 'var(--ink)', margin: '0 0 12px', textWrap: 'pretty' }}>{inline(ln)}</p>);
  });
  flush();
  return out;
}

// ── parse a multi-day devotional template into weeks → days ──
// Template shape: weeks fenced by "═══ WEEK n — COPY FROM HERE/TO HERE ═══" (with optional
// Title:/Summary:/Tags: lines), days marked "### Day n — title", each day's first **bold** line
// is its scripture ref, the rest is prose. Returns { weeks, days, count } or null if no day markers.
function parseDevoDays(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  const reWeekStart = /═+\s*WEEK\s+(\d+)\s*[—\-–]\s*COPY FROM HERE/i;
  const reWeekEnd = /═+\s*WEEK\s+\d+\s*[—\-–]\s*COPY TO HERE/i;
  const reDay = /^###\s+Day\s+(\d+)\s*[—\-–]\s*(.*)$/;
  const weeks = []; let cur = null; let day = null;
  const ensureWeek = () => { if (!cur) { cur = { n: weeks.length + 1, title: '', summary: '', days: [] }; weeks.push(cur); } };
  for (const ln of lines) {
    let m;
    if ((m = ln.match(reWeekStart))) { cur = { n: +m[1], title: '', summary: '', days: [] }; weeks.push(cur); day = null; continue; }
    if (reWeekEnd.test(ln)) { day = null; continue; }
    if ((m = ln.match(reDay))) { ensureWeek(); day = { d: +m[1], title: m[2].trim(), ref: '', body: [] }; cur.days.push(day); continue; }
    if ((m = ln.match(/^Title:\s*(.*)$/))) { ensureWeek(); if (!cur.title) cur.title = m[1].trim(); continue; }
    if ((m = ln.match(/^Summary:\s*(.*)$/))) { ensureWeek(); if (!cur.summary) cur.summary = m[1].trim(); continue; }
    if (/^Tags:/i.test(ln)) continue;
    if (day) { if (!day.ref && (m = ln.match(/^\*\*(.+?)\*\*\s*$/))) { day.ref = m[1].trim(); continue; } day.body.push(ln); }
  }
  const days = [];
  for (const w of weeks) {
    const mm = w.title.match(/Week\s+\d+\s*[:—\-–]\s*(.*)$/i);
    w.label = (mm ? mm[1] : w.title).trim() || ('Week ' + w.n);
    for (const d of w.days) { d.week = w.n; d.body = d.body.join('\n').trim(); days.push(d); }
  }
  if (!days.length) return null;
  return { weeks: weeks.filter(w => w.days.length), days, count: days.length, multiWeek: weeks.filter(w => w.days.length).length > 1 };
}

// open a devotional's "read:" passage in the Bible reader, landing on the verse. Closes the devotional
// overlays first so the reader is in front. Returns false if the ref can't be resolved.
function openDevoPassage(ctx, rawRef) {
  const ref = String(rawRef || '').replace(/^\s*read\s*:?\s*/i, '').trim();
  if (!ref) return false;
  const loc = window.Bible.parseRef(ref);
  if (!loc) { ctx.toast('Couldn’t open ' + ref); return false; }
  if (!window.Bible.books().includes(loc.book)) { ctx.toast(ref + ' isn’t in this translation'); return false; }
  if (ctx.openChurchDevo) ctx.openChurchDevo(null);   // close the devotional reader/index
  ctx.gotoRef(loc.book, loc.chap, loc.verse || 1);
  return true;
}
// a tappable scripture chip: opens the passage in the reader
function DevoRefChip({ refText, ctx, style }) {
  if (!refText) return null;
  return (
    <button onClick={() => openDevoPassage(ctx, refText)} title={'Open ' + refText + ' in the Bible'} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
      border: '1px solid color-mix(in oklab, var(--clay) 32%, var(--line))', background: 'color-mix(in oklab, var(--clay) 8%, var(--surface))',
      color: 'var(--clay-ink)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, ...(style || {}) }}>
      <Icon name="read" size={14} color="var(--clay)" /> {refText} <Icon name="chevR" size={14} color="var(--clay)" />
    </button>
  );
}

// ── one day of a multi-day devotional (prose + ref + mark-read), opened over the index ──
function DevoDayReader({ devo, day, parsed, open, onClose, ctx }) {
  if (!day) return null;
  const doneSet = new Set((ctx.devoProgress && ctx.devoProgress[devo.id]) || []);
  const isDone = doneSet.has(day.d);
  const idx = parsed.days.findIndex(x => x.d === day.d);
  const prev = idx > 0 ? parsed.days[idx - 1] : null;
  const next = idx < parsed.days.length - 1 ? parsed.days[idx + 1] : null;
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, flexShrink: 0, background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 12px' }}>
          <IconBtn name="chevL" onClick={onClose} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--clay)' }}>Day {day.d}</div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 700, lineHeight: 1.15 }}>{day.title}</h1>
          </div>
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--paper)' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '22px 22px 40px' }}>
          {day.ref ? <div style={{ marginBottom: 16 }}><DevoRefChip refText={day.ref} ctx={ctx} /></div> : null}
          {renderMarkdown(day.body)}
        </div>
      </div>
      <div style={{ flexShrink: 0, background: 'var(--surface)', borderTop: '1px solid var(--line)', padding: '12px 16px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => prev && ctx.openChurchDevoDay(prev)} disabled={!prev} title="Previous day"
          style={{ width: 46, height: 46, borderRadius: 14, flexShrink: 0, border: '1px solid var(--line)', background: 'var(--surface)', color: prev ? 'var(--ink)' : 'var(--ink-3)', opacity: prev ? 1 : .4, cursor: prev ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevL" size={20} /></button>
        <button onClick={() => { ctx.toggleDevoDay(devo.id, day.d); if (!isDone && next) ctx.openChurchDevoDay(next); }}
          style={{ flex: 1, height: 46, borderRadius: 14, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15,
            background: isDone ? 'var(--surface-2)' : 'var(--clay)', color: isDone ? 'var(--ink-2)' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {isDone ? <React.Fragment><Icon name="check" size={18} stroke={2.4} color="var(--ink-2)" /> Read</React.Fragment> : (next ? 'Mark read · next' : 'Mark read')}
        </button>
        <button onClick={() => next && ctx.openChurchDevoDay(next)} disabled={!next} title="Next day"
          style={{ width: 46, height: 46, borderRadius: 14, flexShrink: 0, border: '1px solid var(--line)', background: 'var(--surface)', color: next ? 'var(--ink)' : 'var(--ink-3)', opacity: next ? 1 : .4, cursor: next ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevR" size={20} /></button>
      </div>
    </Overlay>
  );
}

// ── church devotional reader ──
// Multi-day templates (### Day n markers) render as a Psalms-of-Comfort-style day index
// grouped by week, with progress + a per-day prose reader. Plain .txt/.md falls back to a scroll.
function ChurchDevoView({ devo, open, onClose, ctx }) {
  // parse the multi-week/day template from the content itself — bulk-uploaded devotionals are type 'txt'
  // even when they're Markdown templates, so don't gate on type. parseDevoDays returns null for plain ones.
  const parsed = React.useMemo(() => (devo ? parseDevoDays(devo.text) : null), [devo]);
  const [openDay, setOpenDay] = React.useState(null);
  const [collapsed, setCollapsed] = React.useState({});
  // expand the week holding the next-undone day on open; collapse the rest
  React.useEffect(() => {
    if (!parsed || !devo) { setOpenDay(null); return; }
    const doneSet = new Set((ctx.devoProgress && ctx.devoProgress[devo.id]) || []);
    const nextDay = parsed.days.find(d => !doneSet.has(d.d)) || parsed.days[0];
    const c = {}; parsed.weeks.forEach(w => { c[w.n] = parsed.multiWeek && w.n !== nextDay.week; });
    setCollapsed(c); setOpenDay(null);
  }, [devo && devo.id]);
  if (!devo) return null;

  // expose a day-opener on ctx so the per-day reader's prev/next can drive it
  ctx.openChurchDevoDay = (d) => setOpenDay(d);

  if (!parsed) {  // plain devotional — original single-scroll
    // render as Markdown if flagged 'md' OR the text clearly is Markdown (bulk uploads are all 'txt')
    const isMd = devo.type === 'md' || /(^|\n)#{1,3}\s|\*\*[^*]+\*\*/.test(devo.text || '');
    return (
      <Overlay open={open} onClose={onClose}>
        <div style={{ paddingTop: 50, flexShrink: 0, background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 12px' }}>
            <IconBtn name="chevL" onClick={onClose} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 700, lineHeight: 1.15 }}>{devo.title}</h1>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{[devo.ref, 'Devotional'].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
        </div>
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--paper)' }}>
          <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 22px 60px' }}>
            {devo.ref ? <div style={{ marginBottom: 16 }}><DevoRefChip refText={devo.ref} ctx={ctx} /></div> : null}
            {devo.text
              ? (isMd
                ? renderMarkdown(devo.text)
                : <p style={{ fontFamily: 'var(--font-read)', fontSize: 18, lineHeight: 1.65, color: 'var(--ink)', whiteSpace: 'pre-wrap', margin: 0, textWrap: 'pretty' }}>{devo.text}</p>)
              : <p style={{ fontFamily: 'var(--font-read)', fontSize: 18, lineHeight: 1.65, color: 'var(--ink)', margin: 0 }}>This devotional has no text.</p>}
          </div>
        </div>
      </Overlay>
    );
  }

  // multi-day index — grouped by week, Psalms-of-Comfort day rows
  const doneSet = new Set((ctx.devoProgress && ctx.devoProgress[devo.id]) || []);
  const todayDay = parsed.days.find(d => !doneSet.has(d.d));
  const pct = parsed.count ? doneSet.size / parsed.count : 0;
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, background: 'linear-gradient(160deg, var(--clay), var(--clay-deep))', color: '#fff', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ position: 'absolute', right: -30, top: 0, opacity: .15 }}><Icon name="read" size={180} stroke={1.2} color="#fff" /></div>
        <div style={{ padding: '10px 16px 22px', position: 'relative' }}>
          <button onClick={onClose} style={{ width: 40, height: 40, borderRadius: 13, border: 'none', background: 'rgba(255,255,255,.2)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
            <Icon name="chevD" size={20} color="#fff" /></button>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, margin: '16px 0 4px' }}>{devo.title}</h1>
          <p style={{ margin: '0 0 14px', opacity: .92, fontSize: 14 }}>{parsed.count} days · Devotional</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'rgba(255,255,255,.25)', overflow: 'hidden' }}>
              <div style={{ width: `${pct * 100}%`, height: '100%', background: '#fff', borderRadius: 4 }} /></div>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{doneSet.size} / {parsed.count}</span>
          </div>
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '18px 16px 30px' }}>
        {parsed.weeks.map((w) => {
          const isCol = !!collapsed[w.n];
          return (
            <div key={w.n} style={{ marginBottom: 14 }}>
              {parsed.multiWeek ? (
                <button onClick={() => setCollapsed(c => ({ ...c, [w.n]: !c[w.n] }))}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
                  <Icon name={isCol ? 'chevR' : 'chevD'} size={16} color="var(--ink-3)" />
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5, color: 'var(--ink)' }}>Week {w.n}</span>
                  <span style={{ fontSize: 13.5, color: 'var(--ink-3)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>· {w.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600, flexShrink: 0 }}>{w.days.filter(d => doneSet.has(d.d)).length}/{w.days.length}</span>
                </button>
              ) : null}
              {isCol ? null : w.days.map((d) => {
                const isDone = doneSet.has(d.d);
                const isToday = todayDay && d.d === todayDay.d;
                return (
                  <div key={d.d} onClick={() => setOpenDay(d)} style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '13px 14px', marginBottom: 9,
                    borderRadius: 18, background: isToday ? 'var(--clay-soft)' : 'var(--surface)',
                    border: isToday ? '1.5px solid var(--clay)' : '1px solid var(--line)', cursor: 'pointer',
                    boxShadow: isToday ? 'var(--shadow)' : 'none' }}>
                    <button onClick={(e) => { e.stopPropagation(); ctx.toggleDevoDay(devo.id, d.d); }} title={isDone ? 'Mark not read' : 'Mark read'}
                      style={{ width: 38, height: 38, borderRadius: 999, flexShrink: 0, cursor: 'pointer',
                        background: isDone ? 'var(--clay)' : isToday ? 'var(--gold)' : 'var(--surface-2)',
                        border: isDone || isToday ? 'none' : '1px solid var(--line)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: isDone || isToday ? '#fff' : 'var(--ink-3)', fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: 15 }}>
                      {isDone ? <Icon name="check" size={18} stroke={2.4} color="#fff" /> : d.d}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>Day {d.d}{isToday ? ' · Today' : isDone ? ' · Read' : ''}</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</div>
                      {d.ref ? <div style={{ fontSize: 13, color: 'var(--clay)', fontWeight: 600 }}>{d.ref}</div> : null}
                    </div>
                    <Icon name="chevR" size={18} color="var(--ink-3)" />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <DevoDayReader devo={devo} day={openDay} parsed={parsed} open={!!openDay} onClose={() => setOpenDay(null)} ctx={ctx} />
    </Overlay>
  );
}

Object.assign(window, { PlansScreen, PlanDetail, ChurchDevoView, parseDevoDays });
