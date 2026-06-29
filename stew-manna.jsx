// stew-manna.jsx — the optional Manna module UI (money-OUT / disbursement governance). Exports
// DashManna (the console section) + DashMannaPanel (the enable card in Settings). All data is held
// encrypted to the church key via window.StewardManna — the relay only ever sees ciphertext.
//
// This is the IMPLEMENTATION of the Manna UI kit (reference/manna-design) for the Steward Console:
// the three console screens — Overview/Treasury, Nomination/Vouch, and Steward Approval (with the
// witness "N present" row) — rebuilt with the live Halo tokens from brand.css (which match the design
// 1:1) and the real <Icon>/<Halo> components, wired to the StewardManna engine. The member-app phone
// screens (Mercy draw, Covenant journey, Giver testimony) are a separate surface (screens-manna.jsx).
//
// The one feeling to hold: receiving help must feel like being known and loved by a community —
// never assessed, never watched. Plain nouns (help, give, walk with); amounts shown plainly; no
// verdict language aimed at a person; security shown gently as "more than one hand on the purse".
// Real payout (NWC) stays disabled until wired on testnet — see window.StewardManna.pay().

/* ---- small helpers ---- */
const mFmtSats = (n) => (Number(n) || 0).toLocaleString('en-GB') + ' sats';
const mFirst = (n) => ((n || '').trim().split(/\s+/)[0] || 'them');
function mHash(s){ let h=0; for(let i=0;i<(s||'').length;i++) h=(h*31+s.charCodeAt(i))>>>0; return h; }
function mInitials(n){ const p=(n||'').trim().split(/\s+/); return ((p[0]&&p[0][0]||'')+(p.length>1?p[p.length-1][0]:'')).toUpperCase()||'?'; }
const MN_AV = ['var(--clay)','var(--sage)','var(--gold)','var(--clay-deep)','#6B6052'];

/* ---- module-local primitives (port of the Halo kit; real tokens, real <Icon>/<Halo>) ---- */
const MN_SZ = { sm:{padding:'8px 14px',fontSize:13,gap:7,ic:16}, md:{padding:'12px 18px',fontSize:14.5,gap:8,ic:18}, lg:{padding:'15px 24px',fontSize:15.5,gap:9,ic:19} };
const MN_VAR = {
  clay:{background:'var(--clay)',color:'#fff',boxShadow:'0 1px 2px rgba(34,28,22,.14)'},
  sage:{background:'var(--sage)',color:'#fff'},
  gold:{background:'var(--gold)',color:'var(--midnight)'},
  dark:{background:'var(--midnight)',color:'var(--paper)'},
  soft:{background:'var(--clay-soft)',color:'var(--clay-ink)'},
  ghost:{background:'var(--surface)',color:'var(--ink)',border:'1px solid var(--line)'},
};
function MnBtn({ variant='clay', size='md', icon, full, disabled, children, onClick, style, title }) {
  const s = MN_SZ[size], v = MN_VAR[variant];
  return <button onClick={disabled?undefined:onClick} disabled={disabled} title={title||''}
    onMouseDown={e=>{ if(!disabled) e.currentTarget.style.transform='scale(.97)'; }}
    onMouseUp={e=>e.currentTarget.style.transform='scale(1)'} onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}
    style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', gap:s.gap, fontWeight:600, fontSize:s.fontSize, letterSpacing:'.01em', padding:s.padding, borderRadius:999, border:'1px solid transparent', cursor:disabled?'not-allowed':'pointer', width:full?'100%':'auto', opacity:disabled?.5:1, lineHeight:1, fontFamily:'var(--font-ui)', transition:'transform .16s var(--ease),filter .16s', ...v, ...style }}>
    {icon && <Icon name={icon} size={s.ic} />}{children}
  </button>;
}
function MnPill({ tint='ink', dot, children, style }) {
  const T = { sage:{background:'var(--sage-soft)',color:'#3F6B4C'}, clay:{background:'var(--clay-soft)',color:'var(--clay-ink)'}, gold:{background:'var(--gold-tint)',color:'#8A6418'}, ink:{background:'rgba(34,28,22,.06)',color:'var(--ink-2)'} }[tint];
  return <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontWeight:700, fontSize:11.5, textTransform:'uppercase', letterSpacing:'1.2px', padding:'4px 9px', borderRadius:999, lineHeight:1, ...T, ...style }}>
    {dot && <span style={{ width:6, height:6, borderRadius:999, background:'currentColor' }}/>}{children}</span>;
}
function MnBadge({ name='', size=40, signed, pending, tone, style }) {
  const bg = tone || MN_AV[mHash(name)%MN_AV.length];
  return <span style={{ position:'relative', display:'inline-flex', flex:'none', ...style }}>
    <span style={{ width:size, height:size, borderRadius:999, background:bg, color:'#fff', display:'grid', placeItems:'center', fontFamily:'var(--font-display)', fontWeight:700, fontSize:size*0.38, boxShadow:'inset 0 0 0 1px rgba(255,255,255,.12)', opacity:pending?.5:1 }}>{mInitials(name)}</span>
    {signed && <span style={{ position:'absolute', right:-2, bottom:-2, width:size*0.46, height:size*0.46, borderRadius:999, background:'var(--sage)', color:'#fff', display:'grid', placeItems:'center', border:'2px solid var(--surface)' }}><Icon name="check" size={size*0.26} stroke={2.6}/></span>}
  </span>;
}
function MnPanel({ children, pad=20, tone='surface', style }) {
  const T = { surface:{background:'var(--surface)',border:'1px solid var(--line)',color:'var(--ink)'}, soft:{background:'var(--paper-soft)',border:'1px solid var(--line)',color:'var(--ink)'}, clay:{background:'var(--clay-soft)',border:'1px solid transparent',color:'var(--clay-ink)'}, dark:{background:'var(--midnight)',border:'1px solid var(--midnight-2)',color:'var(--paper)'} }[tone];
  return <div style={{ borderRadius:'var(--r-lg)', padding:pad, boxShadow:tone==='dark'?'none':'var(--shadow-sm)', ...T, ...style }}>{children}</div>;
}
function MnStat({ icon, label, value, sub, tint='ink' }) {
  const T = { clay:{box:'var(--clay-soft)',ic:'var(--clay-ink)'}, sage:{box:'var(--sage-soft)',ic:'#3F6B4C'}, gold:{box:'var(--gold-tint)',ic:'#8A6418'}, ink:{box:'rgba(34,28,22,.06)',ic:'var(--ink-2)'} }[tint];
  return <div style={{ background:'var(--surface)', border:'1px solid var(--line)', borderRadius:'var(--r-md)', padding:18, boxShadow:'var(--shadow-sm)', display:'flex', flexDirection:'column', gap:12 }}>
    {icon && <span style={{ width:38, height:38, borderRadius:12, background:T.box, color:T.ic, display:'grid', placeItems:'center' }}><Icon name={icon} size={20}/></span>}
    <div><div style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:26, letterSpacing:'-.02em', lineHeight:1.05 }}>{value}</div>
    <div style={{ marginTop:4, fontSize:13, fontWeight:600, color:'var(--ink-2)' }}>{label}</div>
    {sub && <div style={{ marginTop:2, fontSize:12, color:'var(--ink-3)' }}>{sub}</div>}</div>
  </div>;
}
function MnLabel({ children, action, onAction }) {
  return <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', margin:'0 0 12px' }}>
    <span style={{ fontWeight:700, fontSize:19, letterSpacing:'-.01em' }}>{children}</span>
    {action && <span onClick={onAction} style={{ fontSize:13, fontWeight:600, color:'var(--clay)', cursor:'pointer' }}>{action}</span>}</div>;
}

/* ============================== Settings: opt-in enable card ============================== */
function DashMannaPanel({ church }) {
  const s = window.useMannaSettings ? window.useMannaSettings() : { enabled: false };
  const on = !!s.enabled;
  const toggleBtn = (active, onClick, label, disabled) => (
    <button onClick={disabled ? undefined : onClick} disabled={!!disabled} aria-label={label} title={label} style={{ width: 48, height: 28, borderRadius: 999, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .4 : 1, flexShrink: 0, background: active ? 'var(--sage)' : 'var(--line)', position: 'relative', transition: 'background .2s' }}>
      <span style={{ position: 'absolute', top: 3, left: active ? 23 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
    </button>
  );
  return (
    <Panel title="Manna — looking after our own">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, transparent)', marginBottom: 14 }}>
        <Icon name="lock" size={16} color="var(--clay-ink)" style={{ flexShrink: 0 }} />
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45 }}><b>Locked during the pilot.</b> This opens up once testing is finished.</div>
      </div>
      <div style={{ display: 'flex', gap: 10, padding: '11px 13px', borderRadius: 12, background: 'color-mix(in oklab, var(--gold) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 26%, transparent)', marginBottom: 14 }}>
        <Icon name="lock" size={17} color="#8a6717" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>Manna is the <b>money-out</b> counterpart to Finance: how your church gives to its own in need. Like Finance, it keeps <b>named, identified</b> records (it names the people you help) — so every record is <b>encrypted to your church key</b>, minimised, and never a watch-list. Payments themselves stay <b>off</b> until you wire a wallet. Use it only under your church’s safeguarding &amp; privacy policy.</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderRadius: 13, border: '1px solid var(--line)', background: on ? 'color-mix(in oklab, var(--sage) 10%, var(--surface))' : 'var(--surface-2)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>Disbursements (Manna)</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1, lineHeight: 1.45 }}>{on ? 'On — a “Manna” tab is in your sidebar: open a need, vouch, approve, and keep the trustee’s record. Two tiers — mercy (open draw) and covenant (walked-alongside).' : 'Off — turn on to disburse from your church’s purse to people in need, with dignity and a trustee-ready record.'}</div>
        </div>
        {toggleBtn(on, () => window.StewardManna.setEnabled(!on, s), 'Manna is locked during the pilot', true)}
      </div>
    </Panel>
  );
}
window.DashMannaPanel = DashMannaPanel;

/* ============================== the Manna console section ============================== */
function DashManna() {
  const settings = window.useMannaSettings ? window.useMannaSettings() : {};
  const funds = window.useMannaFunds ? window.useMannaFunds() : [];
  const requests = window.useMannaRequests ? window.useMannaRequests() : [];
  const vouches = window.useMannaVouches ? window.useMannaVouches() : [];
  const records = window.useMannaRecords ? window.useMannaRecords() : [];
  const M = window.StewardManna;
  const payoutReady = !!(M && M.payoutReady && M.payoutReady());

  const [view, setView] = React.useState('overview');   // overview | nominate | approve
  const [opening, setOpening] = React.useState(false);

  const reqById = React.useMemo(() => Object.fromEntries(requests.map(r => [r.id, r])), [requests]);
  const vsOf = (req) => (M && M.vouchStatus ? M.vouchStatus(req, vouches, settings) : { ok: true, need: 0, have: 0, missingNominator: false });

  const NAV = [['overview', 'The fund', 'bank'], ['nominate', 'Stand with', 'users'], ['approve', 'Approve', 'key']];

  return (
    <div style={{ maxWidth: 900 }}>
      {/* sub-nav: a quiet segment control + the single human action */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Halo size={26} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19, letterSpacing: '-.02em' }}>Manna</span>
          <span style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 600, letterSpacing: '.06em', marginTop: 3 }}>looking after our own</span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 18 }}>
          {NAV.map(([k, lbl, ic]) => {
            const on = view === k;
            return <button key={k} onClick={() => setView(k)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 600, padding: '8px 13px', borderRadius: 999, cursor: 'pointer', color: on ? '#fff' : 'var(--ink-2)', background: on ? 'var(--clay)' : 'transparent', border: on ? '1px solid transparent' : '1px solid var(--line)' }}><Icon name={ic} size={16} />{lbl}</button>;
          })}
        </div>
        <MnBtn size="sm" icon="plus" style={{ marginLeft: 'auto' }} onClick={() => setOpening(true)}>Open a need</MnBtn>
      </div>

      {opening ? <MannaOpenForm funds={funds} M={M} onClose={() => setOpening(false)} /> : null}

      {view === 'overview' && <MannaOverview requests={requests} records={records} reqById={reqById} payoutReady={payoutReady} onOpen={() => setOpening(true)} />}
      {view === 'nominate' && <MannaNominate requests={requests} vouches={vouches} vsOf={vsOf} M={M} />}
      {view === 'approve' && <MannaApprove requests={requests} vouches={vouches} vsOf={vsOf} M={M} payoutReady={payoutReady} />}
    </div>
  );
}
window.DashManna = DashManna;

/* ---- Overview / Treasury: quiet solidity, real aggregates (no fabricated balances) ---- */
function MannaOverview({ requests, records, reqById, payoutReady, onOpen }) {
  const openNeeds = requests.filter(r => r.status === 'open').length;
  const walking = requests.filter(r => r.tier === 'covenant' && r.status !== 'closed').length;
  const givenOut = records.reduce((a, r) => a + (Number(r.amountSats) || 0), 0);
  const mercyPaid = records.filter(r => (reqById[r.requestId] || {}).tier !== 'covenant').reduce((a, r) => a + (Number(r.amountSats) || 0), 0);
  const covPaid = records.filter(r => (reqById[r.requestId] || {}).tier === 'covenant').reduce((a, r) => a + (Number(r.amountSats) || 0), 0);
  const split = mercyPaid + covPaid;
  const recent = requests.slice(0, 6);
  const statusTint = { open: 'ink', approved: 'sage', paid: 'sage', closed: 'ink' };

  if (!requests.length && !records.length) {
    return <MnPanel style={{ textAlign: 'center', padding: '44px 22px' }}>
      <span style={{ display: 'inline-grid', placeItems: 'center', width: 52, height: 52, borderRadius: 16, background: 'var(--clay-soft)', color: 'var(--clay-ink)', marginBottom: 14 }}><Icon name="hand" size={26} /></span>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, letterSpacing: '-.01em' }}>Nothing opened yet</div>
      <p style={{ margin: '6px auto 16px', fontSize: 14, color: 'var(--ink-2)', maxWidth: 360, lineHeight: 1.5 }}>When the body carries one of its own, it begins here — quietly, with dignity, kept only to the church.</p>
      <MnBtn icon="plus" onClick={onOpen}>Open the first need</MnBtn>
    </MnPanel>;
  }

  return <div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 18 }}>
      <MnStat icon="hand" tint="clay" value={openNeeds} label="Open needs" sub="Awaiting a steward" />
      <MnStat icon="users" tint="sage" value={walking} label="Walked alongside" sub="Covenant relationships" />
      <MnStat icon="heart" tint="gold" value={mFmtSats(givenOut)} label="Given out" sub={`${records.length} disbursement${records.length === 1 ? '' : 's'} recorded`} />
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
      <MnPanel pad={22}>
        <MnLabel>The fund, quietly</MnLabel>
        {split > 0 ? <React.Fragment>
          <div style={{ height: 12, borderRadius: 999, background: 'var(--paper-soft)', overflow: 'hidden', display: 'flex', border: '1px solid var(--line)' }}>
            <div style={{ width: (mercyPaid / split * 100) + '%', background: 'var(--clay)' }} />
            <div style={{ width: (covPaid / split * 100) + '%', background: 'var(--sage)' }} />
          </div>
          <div style={{ display: 'flex', gap: 18, marginTop: 12, fontSize: 12.5, color: 'var(--ink-2)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--clay)' }} />Mercy {mFmtSats(mercyPaid)}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--sage)' }} />Covenant {mFmtSats(covPaid)}</span>
          </div>
          <div style={{ height: 1, background: 'var(--line)', margin: '20px 0' }} />
        </React.Fragment> : null}
        <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-3)', marginBottom: 12 }}>Recently</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {recent.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <MnBadge name={r.recipient && r.recipient.name} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(r.recipient && r.recipient.name) || 'Someone in need'}</div></div>
              <MnPill tint={r.tier === 'covenant' ? 'gold' : 'sage'}>{r.tier}</MnPill>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', minWidth: 96, textAlign: 'right' }}>{mFmtSats(r.amountSats)}</div>
              <MnPill tint={statusTint[r.status] || 'ink'}>{r.status}</MnPill>
            </div>
          ))}
        </div>
      </MnPanel>
      <MnPanel tone="dark" pad={22} style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(200,150,46,.18)', color: 'var(--gold-soft)', display: 'grid', placeItems: 'center', marginBottom: 14 }}><Icon name="shield" size={24} /></span>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, letterSpacing: '-.01em', marginBottom: 8 }}>Safe by shared control</div>
        <p style={{ margin: 0, fontSize: 13.5, color: 'rgba(244,238,226,.72)', lineHeight: 1.55, flex: 1 }}>There’s no state backstop here — and there doesn’t need to be. No single person moves money. Larger covenant gifts wait for more than one guardian, each signing on their own device.</p>
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: payoutReady ? 'var(--sage-soft)' : 'rgba(244,238,226,.6)' }}>
          <Icon name={payoutReady ? 'wallet' : 'lock'} size={15} />{payoutReady ? 'Wallet connected' : 'Payments off until a wallet is wired'}
        </div>
      </MnPanel>
    </div>
  </div>;
}

/* ---- Nomination / Vouch: "I'll walk with this person" — not "Approve" ---- */
function MannaNominate({ requests, vouches, vsOf, M }) {
  const candidates = requests.filter(r => r.status === 'open');
  const [picked, setPicked] = React.useState(0);
  const [done, setDone] = React.useState('');   // '' | 'nominator' | 'witness'
  React.useEffect(() => { setDone(''); }, [picked]);

  if (!candidates.length) {
    return <MnPanel style={{ textAlign: 'center', padding: '40px 22px' }}>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink-2)' }}>No open needs to stand with right now.</div>
      <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>Finding the friendless and becoming their Barnabas is itself the work.</div>
    </MnPanel>;
  }
  const sel = candidates[Math.min(picked, candidates.length - 1)];
  const vs = vsOf(sel);
  const addVouch = (role) => M.addVouch({ requestId: sel.id, role }).then(() => setDone(role));

  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: 22, alignItems: 'start' }}>
    <MnPanel pad={18}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-3)', margin: '2px 2px 12px' }}>Someone in the family</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {candidates.map((r, i) => {
          const on = i === Math.min(picked, candidates.length - 1);
          return <div key={r.id} onClick={() => setPicked(i)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px', borderRadius: 14, cursor: 'pointer', background: on ? 'color-mix(in srgb, var(--sage-soft) 70%, var(--surface))' : 'transparent', border: on ? '1px solid var(--sage)' : '1px solid transparent' }}>
            <MnBadge name={r.recipient && r.recipient.name} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(r.recipient && r.recipient.name) || 'Someone in need'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{r.tier === 'covenant' ? 'Covenant' : 'Mercy'} · {mFmtSats(r.amountSats)}</div>
            </div>
            {on && <Icon name="check" size={18} color="var(--sage)" stroke={2.4} />}
          </div>;
        })}
      </div>
    </MnPanel>

    <MnPanel tone="clay" pad={24}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16 }}>
        <MnBadge name={sel.recipient && sel.recipient.name} size={52} />
        <div><div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.4px', color: 'var(--clay-ink)' }}>Stand with</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, letterSpacing: '-.01em', color: 'var(--ink)' }}>{(sel.recipient && sel.recipient.name) || 'them'}</div></div>
      </div>
      <p className="scripture" style={{ fontSize: 16, color: 'var(--clay-ink)', margin: '0 0 14px' }}>“Carry each other’s burdens.”</p>
      <div style={{ background: 'var(--surface)', borderRadius: 16, padding: '15px 16px', marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}><span style={{ color: 'var(--clay)', marginTop: 1 }}><Icon name="hand" size={20} /></span>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55 }}>By vouching, you’re not approving a request — you’re saying <b style={{ color: 'var(--ink)' }}>“I’ll walk with this person.”</b> You’ll be the steady hand they can reach, and the one who quietly checks in.{sel.tier === 'covenant' && vs.missingNominator ? ' This covenant gift still needs a sponsor.' : ''}</p></div>
      </div>
      {done ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderRadius: 16, background: 'var(--sage-soft)', color: '#3F6B4C' }}>
          <Icon name="check" size={20} stroke={2.4} /><span style={{ fontSize: 14, fontWeight: 600 }}>You’re {done === 'witness' ? 'standing witness for' : 'walking with'} {mFirst(sel.recipient && sel.recipient.name)}. The stewards have been gently notified.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <MnBtn size="lg" icon="users" onClick={() => addVouch('nominator')}>I’ll walk with {mFirst(sel.recipient && sel.recipient.name)}</MnBtn>
          <MnBtn size="lg" variant="ghost" onClick={() => addVouch('witness')}>Stand as a witness</MnBtn>
        </div>
      )}
    </MnPanel>
  </div>;
}

/* ---- Steward Approval / Keykeeper: sober stewardship + "more than one hand" ---- */
function MannaApprove({ requests, vouches, vsOf, M, payoutReady }) {
  const queue = requests.filter(r => r.status === 'open').concat(requests.filter(r => r.status === 'approved'));
  const [pick, setPick] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');

  if (!queue.length) {
    return <MnPanel style={{ textAlign: 'center', padding: '40px 22px' }}>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink-2)' }}>Nothing awaiting approval.</div>
      <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>When a need is opened and vouched, it waits here for a steward.</div>
    </MnPanel>;
  }
  const sel = queue[Math.min(pick, queue.length - 1)];
  const vs = vsOf(sel);
  const reqVouches = vouches.filter(v => v.requestId === sel.id);
  const isCov = sel.tier === 'covenant';
  const blocked = isCov && !vs.ok;
  const released = sel.status === 'approved';

  const doApprove = () => {
    setErr(''); setBusy(true);
    M.approve(sel, { vouchStatus: vs }).then(res => { setBusy(false); if (res && !res.ok) setErr(res.error || 'Could not approve'); });
  };

  return <div>
    {queue.length > 1 ? (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {queue.map((r, i) => {
          const on = i === Math.min(pick, queue.length - 1);
          return <button key={r.id} onClick={() => { setPick(i); setErr(''); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 600, border: on ? '1px solid transparent' : '1px solid var(--line)', background: on ? 'var(--midnight)' : 'var(--surface)', color: on ? 'var(--paper)' : 'var(--ink-2)' }}>
            <MnBadge name={r.recipient && r.recipient.name} size={22} />{(r.recipient && r.recipient.name) || 'Someone'}<span style={{ opacity: .7 }}>· {mFmtSats(r.amountSats)}</span>
          </button>;
        })}
      </div>
    ) : null}

    <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 22, alignItems: 'start' }}>
      {/* the request, with gravity */}
      <MnPanel tone="dark" pad={26}>
        <MnPill tint={isCov ? 'gold' : 'sage'}>{isCov ? 'Covenant · larger gift' : 'Mercy · open draw'}</MnPill>
        <div style={{ margin: '16px 0 6px', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 32, letterSpacing: '-.02em' }}>{mFmtSats(sel.amountSats)}</div>
        <p style={{ margin: '0 0 18px', fontSize: 14, color: 'rgba(244,238,226,.7)', lineHeight: 1.5 }}>{sel.reason ? sel.reason : 'For ' + (mFirst(sel.recipient && sel.recipient.name)) + ', from the church’s purse.'}{reqVouches.some(v => v.role === 'nominator') ? ' Vouched by a sponsor who knows them.' : ''}</p>
        <div style={{ height: 1, background: 'rgba(244,238,226,.12)', margin: '4px 0 16px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(200,150,46,.18)', color: 'var(--gold-soft)', display: 'grid', placeItems: 'center' }}><Icon name="shield" size={22} /></span>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(244,238,226,.78)', lineHeight: 1.45 }}>No one person controls this. The console asks, each guardian approves, and the secret stays on their own device.</p>
        </div>
      </MnPanel>

      {/* the signing moment + witness presence */}
      <MnPanel pad={22}>
        <MnLabel>{isCov ? 'More than one hand' : 'A quiet release'}</MnLabel>
        <p style={{ margin: '-4px 0 16px', fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          {isCov
            ? <React.Fragment>A covenant gift like this needs a sponsor and <b style={{ color: 'var(--ink)' }}>{vs.need} witness{vs.need === 1 ? '' : 'es'}</b> present. This is comfort, not security theatre.</React.Fragment>
            : 'A mercy draw — gateless and unremarkable. A single steward may release it.'}
        </p>

        {isCov ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
            {reqVouches.map((v, i) => (
              <div key={v.id || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 14, background: 'var(--sage-soft)', border: '1px solid transparent' }}>
                <MnBadge name={v.name || v.pub} size={38} signed />
                <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{v.name || (v.role === 'nominator' ? 'Sponsor' : 'Witness')}</div><div style={{ fontSize: 12.5, color: '#3F6B4C', textTransform: 'capitalize' }}>{v.role} · stood with them</div></div>
                <Icon name="check" size={18} color="var(--sage)" stroke={2.4} />
              </div>
            ))}
            {vs.missingNominator ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 14, background: 'var(--paper-soft)', border: '1px solid var(--line)' }}>
                <MnBadge name="?" size={38} pending />
                <div style={{ flex: 1, fontSize: 13.5, color: 'var(--ink-3)' }}>Awaiting a sponsor — someone to walk with them. Add one under <b style={{ color: 'var(--ink-2)' }}>Stand with</b>.</div>
              </div>
            ) : null}
          </div>
        ) : null}

        {isCov ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 12.5, fontWeight: 700, letterSpacing: '.04em', color: vs.ok ? '#3F6B4C' : 'var(--ink-3)', textTransform: 'uppercase' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: vs.ok ? 'var(--sage)' : 'var(--ink-3)' }} />{vs.have} of {vs.need} witnesses present{vs.ok ? ' · threshold met' : ''}
          </div>
        ) : null}

        {err ? <div style={{ fontSize: 12.5, color: 'var(--clay-deep)', marginBottom: 12 }}>{err}</div> : null}

        {released ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderRadius: 16, background: 'var(--sage)', color: '#fff' }}>
              <Icon name="check" size={22} stroke={2.4} /><span style={{ fontSize: 14.5, fontWeight: 700 }}>Approved &amp; signed.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12.5, color: 'var(--ink-3)' }}>
              <Icon name={payoutReady ? 'wallet' : 'lock'} size={15} />{payoutReady ? 'Ready to pay the recipient’s Lightning Address.' : 'Payment runs once a wallet is wired (testnet first). Meanwhile, release it manually.'}
            </div>
          </div>
        ) : (
          <MnBtn full size="lg" variant="dark" icon="key" disabled={busy || blocked} onClick={doApprove} title={blocked ? (vs.missingNominator ? 'Needs a sponsor first' : 'Needs more witnesses') : ''}>
            {busy ? 'Signing on your device…' : 'Approve & sign with your key'}
          </MnBtn>
        )}
      </MnPanel>
    </div>
  </div>;
}

/* ---- Open a need: plain-language creation (no "case file") ---- */
function MannaOpenForm({ funds, M, onClose }) {
  const [d, setD] = React.useState({ tier: 'mercy', name: '', ln: '', amountSats: '', reason: '', fundId: '' });
  const fld = { width: '100%', boxSizing: 'border-box', height: 44, padding: '0 13px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 14.5, color: 'var(--ink)', fontFamily: 'var(--font-ui)' };
  const lbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 6px' };
  const submit = () => { if (!M || !(Number(d.amountSats) > 0)) return; M.openRequest(d).then(onClose); };
  return (
    <MnPanel pad={20} style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <MnLabel>Open a need</MnLabel>
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-3)' }}><Icon name="x" size={20} /></button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {['mercy', 'covenant'].map(t => (
          <button key={t} onClick={() => setD(s => ({ ...s, tier: t }))} style={{ flex: 1, padding: '11px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', border: d.tier === t ? '1.5px solid var(--clay)' : '1px solid var(--line)', background: d.tier === t ? 'var(--clay-soft)' : 'var(--surface)' }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t === 'mercy' ? 'Mercy' : 'Covenant'}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2, lineHeight: 1.4 }}>{t === 'mercy' ? 'Essentials, no gate, no nominator.' : 'Larger help, walked alongside a sponsor.'}</div>
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div><div style={lbl}>WHO IS THIS FOR?</div><input style={fld} value={d.name} onChange={e => setD(s => ({ ...s, name: e.target.value }))} placeholder="A name (kept private & encrypted)" /></div>
        <div><div style={lbl}>AMOUNT (SATS)</div><input style={fld} inputMode="numeric" value={d.amountSats} onChange={e => setD(s => ({ ...s, amountSats: e.target.value.replace(/[^0-9]/g, '') }))} placeholder="e.g. 20000" /></div>
        <div><div style={lbl}>THEIR LIGHTNING ADDRESS</div><input style={fld} value={d.ln} onChange={e => setD(s => ({ ...s, ln: e.target.value }))} placeholder="they bring their own wallet" /></div>
        <div><div style={lbl}>PURSE</div>
          <select style={fld} value={d.fundId} onChange={e => setD(s => ({ ...s, fundId: e.target.value }))}>
            <option value="">— any —</option>
            {funds.map(f => <option key={f.id} value={f.id}>{f.name} ({f.tier})</option>)}
          </select>
        </div>
      </div>
      {d.tier === 'covenant' ? <div style={{ marginTop: 12 }}><div style={lbl}>A NOTE FROM THE SPONSOR (OPTIONAL)</div><input style={fld} value={d.reason} onChange={e => setD(s => ({ ...s, reason: e.target.value }))} placeholder="the path forward — not a justification" /></div> : null}
      <div style={{ marginTop: 14 }}><MnBtn size="lg" icon="hand" onClick={submit}>Open this need</MnBtn></div>
    </MnPanel>
  );
}
