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

function PlanCard({ p, ctx, onClick }) {
  const done = doneDays(ctx, p.id).length;
  const pct = p.len ? done / p.len : 0;
  return (
    <div onClick={onClick} style={{
      borderRadius: 22, overflow: 'hidden', cursor: 'pointer', position: 'relative',
      background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)',
    }}>
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
  const [discoverOpen, setDiscoverOpen] = useP(false);   // expand the full "Discover plans" grid
  const churchPlans = ctx.churchPlans || [];           // plans the church's steward shared
  const churchName = (ctx.church && ctx.church.name) || 'your church';
  const allPlans = [...churchPlans, ...D.PLANS];
  // active = most-progressed started plan, else the first
  const started = allPlans.filter(p => doneDays(ctx, p.id).length > 0);
  const active = (started.sort((a, b) => doneDays(ctx, b.id).length - doneDays(ctx, a.id).length)[0]) || allPlans[0];
  const aDone = doneDays(ctx, active.id).length;
  const aPct = active.len ? aDone / active.len : 0;
  const aNext = nextDay(active, new Set(doneDays(ctx, active.id)));

  return (
    <ScreenScroll>
      <ReadPlansTabs ctx={ctx} style={{ marginBottom: 18 }} />
      <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, letterSpacing: '-.5px', animation: 'trinityFade .5s ease both' }}>Reading Plans</h1>
      <p style={{ margin: '0 0 20px', color: 'var(--ink-2)', fontSize: 14.5, lineHeight: 1.4 }}>A little every day. Pick a path and let it carry you.</p>

      {/* active plan */}
      <div onClick={() => ctx.openPlan(active)} style={{
        borderRadius: 24, padding: 20, cursor: 'pointer', marginBottom: 24, position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(150deg, var(--clay), var(--clay-deep))', color: '#fff', boxShadow: 'var(--shadow-lg)',
        animation: 'trinityFade .5s ease .05s both',
      }}>
        <div style={{ position: 'absolute', right: -30, top: -30, opacity: .16 }}><Icon name="read" size={170} stroke={1.2} color="#fff" /></div>
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', opacity: .9 }}>{aDone ? 'Currently reading' : 'Start a plan'}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, margin: '6px 0 2px' }}>{active.title}</div>
          <div style={{ fontSize: 13.5, opacity: .92 }}>Day {aNext.d} · {aNext.label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'rgba(255,255,255,.25)', overflow: 'hidden' }}>
              <div style={{ width: `${aPct * 100}%`, height: '100%', background: '#fff', borderRadius: 4 }} />
            </div>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{Math.round(aPct * 100)}%</span>
          </div>
          <button onClick={(e) => { e.stopPropagation(); ctx.openPlanDay(active, aNext); }} style={{ marginTop: 16, width: '100%', padding: '12px', borderRadius: 14, border: 'none',
            background: '#fff', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
            {aDone ? `Continue · Day ${aNext.d}` : `Begin · Day ${aNext.d}`}
          </button>
        </div>
      </div>

      {churchPlans.length ? (
        <React.Fragment>
          <SectionLabel>Plans from {churchName}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 22, animation: 'trinityFade .5s ease .08s both' }}>
            {churchPlans.map(p => <PlanCard key={p.id} p={p} ctx={ctx} onClick={() => ctx.openPlan(p)} />)}
          </div>
        </React.Fragment>
      ) : null}

      {(ctx.churchDevos || []).length ? (
        <React.Fragment>
          <SectionLabel>Devotionals from {churchName}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 22, animation: 'trinityFade .5s ease .1s both' }}>
            {ctx.churchDevos.map(d => <DevoCard key={d.id} d={d} onClick={() => ctx.openChurchDevo(d)} />)}
          </div>
        </React.Fragment>
      ) : null}

      <SectionLabel>Discover plans</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, animation: 'trinityFade .5s ease .1s both' }}>
        {(discoverOpen ? D.PLANS : D.PLANS.slice(0, 4)).map(p => <PlanCard key={p.id} p={p} ctx={ctx} onClick={() => ctx.openPlan(p)} />)}
      </div>
      {D.PLANS.length > 4 ? (
        <button onClick={() => setDiscoverOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', marginTop: 12, padding: '12px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
          {discoverOpen ? 'Show fewer' : `Show all ${D.PLANS.length} plans`} <Icon name={discoverOpen ? 'chevU' : 'chevD'} size={17} color="var(--clay)" />
        </button>
      ) : null}
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
  const parsed = React.useMemo(() => (devo && devo.type === 'md' ? parseDevoDays(devo.text) : null), [devo]);
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
    const isMd = devo.type === 'md';
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
