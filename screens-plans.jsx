// screens-plans.jsx — reading plans gallery + active plan detail
function PlanCard({ p, onClick, big }) {
  const pct = p.len ? p.done / p.len : 0;
  return (
    <div onClick={onClick} style={{
      borderRadius: 22, overflow: 'hidden', cursor: 'pointer', position: 'relative',
      background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)',
    }}>
      <div style={{ height: big ? 96 : 80, background: p.accent, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 80% 0%, rgba(255,255,255,.3), transparent 55%)' }} />
        <div style={{ position: 'absolute', right: -16, bottom: -22, opacity: .2 }}><Icon name="read" size={120} stroke={1.3} color="#fff" /></div>
        <span style={{ position: 'absolute', top: 12, left: 14, background: 'rgba(255,255,255,.22)', color: '#fff',
          padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, backdropFilter: 'blur(4px)' }}>{p.tag}</span>
      </div>
      <div style={{ padding: '13px 15px 15px' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, lineHeight: 1.1 }}>{p.title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 3 }}>{p.sub}</div>
        {p.done > 0 ? (
          <div style={{ marginTop: 11 }}>
            <div style={{ height: 5, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
              <div style={{ width: `${pct*100}%`, height: '100%', background: p.accent, borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', marginTop: 5 }}>{p.done} of {p.len} days</div>
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
  return (
    <ScreenScroll>
      <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, letterSpacing: '-.5px', animation: 'trinityFade .5s ease both' }}>Reading Plans</h1>
      <p style={{ margin: '0 0 20px', color: 'var(--ink-2)', fontSize: 14.5, lineHeight: 1.4 }}>A little every day. Pick a path and let it carry you.</p>

      {/* active plan */}
      <div onClick={() => ctx.openPlan(D.PLAN_DETAIL)} style={{
        borderRadius: 24, padding: 20, cursor: 'pointer', marginBottom: 24, position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(150deg, var(--clay), var(--clay-deep))', color: '#fff', boxShadow: 'var(--shadow-lg)',
        animation: 'trinityFade .5s ease .05s both',
      }}>
        <div style={{ position: 'absolute', right: -30, top: -30, opacity: .16 }}><Icon name="read" size={170} stroke={1.2} color="#fff" /></div>
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', opacity: .9 }}>Currently reading</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, margin: '6px 0 2px' }}>The Gospel of John</div>
          <div style={{ fontSize: 13.5, opacity: .92 }}>Day 4 · Water into wine</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'rgba(255,255,255,.25)', overflow: 'hidden' }}>
              <div style={{ width: `${4/21*100}%`, height: '100%', background: '#fff', borderRadius: 4 }} />
            </div>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{Math.round(4/21*100)}%</span>
          </div>
          <button style={{ marginTop: 16, width: '100%', padding: '12px', borderRadius: 14, border: 'none',
            background: '#fff', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
            Continue Day 4
          </button>
        </div>
      </div>

      <SectionLabel>Discover plans</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, animation: 'trinityFade .5s ease .1s both' }}>
        {D.PLANS.map(p => <PlanCard key={p.id} p={p} onClick={() => ctx.openPlan({ ...D.PLAN_DETAIL, title: p.title, sub: p.sub })} />)}
      </div>
    </ScreenScroll>
  );
}

// ── plan detail overlay ──
function PlanDetail({ plan, open, onClose, ctx }) {
  if (!plan) return null;
  const statusMap = {
    done: { bg: 'var(--clay)', ic: 'check', label: 'Done' },
    today: { bg: 'var(--gold)', ic: 'play', label: 'Today' },
    todo: { bg: 'var(--surface-2)', ic: null, label: '' },
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
          <p style={{ margin: 0, opacity: .92, fontSize: 14 }}>{plan.sub}</p>
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '18px 16px 30px' }}>
        {plan.days.map((d, i) => {
          const s = statusMap[d.status];
          return (
            <div key={i} onClick={() => { onClose(); ctx.openReader(); }} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '13px 14px', marginBottom: 9,
              borderRadius: 18, background: d.status === 'today' ? 'var(--clay-soft)' : 'var(--surface)',
              border: d.status === 'today' ? '1.5px solid var(--clay)' : '1px solid var(--line)', cursor: 'pointer',
              boxShadow: d.status === 'today' ? 'var(--shadow)' : 'none',
            }}>
              <div style={{ width: 38, height: 38, borderRadius: 999, background: s.bg, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: d.status === 'todo' ? 'var(--ink-3)' : '#fff', fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: 15 }}>
                {s.ic ? <Icon name={s.ic} size={18} stroke={2.4} color="#fff" /> : d.d}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>Day {d.d}{d.status === 'today' ? ' · Today' : ''}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{d.label}</div>
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

Object.assign(window, { PlansScreen, PlanDetail });
