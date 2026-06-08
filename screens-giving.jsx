// screens-giving.jsx — Lightning "Giving" tab inside Chat: wallet + Strike load + give to funds
const { useState: useG, useEffect: useGE } = React;

const fmtSats = (n) => n.toLocaleString('en-US');
const usdOf = (sats) => (sats / window.TrinityData.SATS_PER_USD);

// deterministic faux-QR (visual only)
function FauxQR({ seed = 'lnbc', size = 168 }) {
  const n = 21;
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const rnd = (i) => { const x = Math.sin(h + i * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const cells = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const finder = (rr, cc) => rr < 7 && cc < 7;
    const isFinder = finder(r, c) || finder(r, n - 1 - c) || finder(n - 1 - r, c);
    const on = isFinder ? (() => { const lr = Math.min(r, n-1-r), lc = Math.min(c, n-1-c); const br = r < 7 ? r : n-1-r, bc = c < 7 ? c : (c > n-8 ? n-1-c : c); return (br === 0 || br === 6 || bc === 0 || bc === 6 || (br >= 2 && br <= 4 && bc >= 2 && bc <= 4)); })() : rnd(r * n + c) > 0.55;
    if (on) cells.push(<rect key={r+'-'+c} x={c} y={r} width="1" height="1" rx="0.15" />);
  }
  return (
    <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} style={{ display: 'block' }}>
      <rect x="0" y="0" width={n} height={n} fill="#fff" />
      <g fill="#1a1410">{cells}</g>
    </svg>
  );
}

// ════ Strike load sheet: amount → connect → invoice ════
function StrikeLoadSheet({ open, onClose, ctx, onLoaded }) {
  const D = window.TrinityData;
  const [stage, setStage] = useG('amount'); // amount | invoice | done
  const [amt, setAmt] = useG(25);
  const [custom, setCustom] = useG('');
  useGE(() => { if (open) { setStage('amount'); setAmt(25); setCustom(''); } }, [open]);

  const usd = custom ? parseFloat(custom) || 0 : amt;
  const sats = Math.round(usd * D.SATS_PER_USD);

  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="88%">
      {/* Strike header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bolt" size={22} color="#fff" fill />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700, lineHeight: 1 }}>Load with Strike</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>Lightning Network · instant</div>
          </div>
        </div>
        <IconBtn name="x" onClick={onClose} />
      </div>

      {stage === 'amount' ? (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 10 }}>Choose an amount</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            {D.STRIKE_PRESETS.map(p => {
              const on = !custom && amt === p;
              return (
                <button key={p} onClick={() => { setAmt(p); setCustom(''); }} style={{
                  padding: '16px', borderRadius: 16, cursor: 'pointer', textAlign: 'left',
                  border: on ? '2px solid var(--gold)' : '1px solid var(--line)',
                  background: on ? 'color-mix(in oklab, var(--gold) 14%, var(--surface))' : 'var(--surface-2)',
                }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700, color: 'var(--ink)' }}>${p}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600, marginTop: 1 }}>{fmtSats(Math.round(p * D.SATS_PER_USD))} sats</div>
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 16px', height: 56, borderRadius: 16,
            border: custom ? '2px solid var(--gold)' : '1px solid var(--line)', background: 'var(--surface-2)', marginBottom: 20 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--ink-2)' }}>$</span>
            <input value={custom} onChange={e => setCustom(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="Custom amount"
              style={{ flex: 1, border: 'none', background: 'none', outline: 'none', fontSize: 18, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }} />
            {sats > 0 ? <span style={{ fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 600 }}>{fmtSats(sats)} sats</span> : null}
          </div>
          <button disabled={!usd} onClick={() => setStage('invoice')} style={{
            width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: usd ? 'pointer' : 'default',
            background: usd ? '#000' : 'var(--line)', color: '#fff', fontWeight: 700, fontSize: 15.5, fontFamily: 'var(--font-ui)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
          }}><Icon name="bolt" size={19} color="#fff" fill /> Continue with Strike</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center', marginTop: 14, color: 'var(--ink-3)', fontSize: 12 }}>
            <Icon name="lock" size={13} /> You’ll confirm securely in Strike. No card details stored.
          </div>
        </div>
      ) : null}

      {stage === 'invoice' ? (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 600 }}>Scan in Strike or any Lightning wallet</div>
          <div style={{ display: 'inline-block', padding: 14, borderRadius: 20, background: '#fff', boxShadow: 'var(--shadow)', margin: '14px 0' }}>
            <FauxQR seed={'lnbc' + sats} size={172} />
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{fmtSats(sats)} <span style={{ fontSize: 17, color: 'var(--ink-3)' }}>sats</span></div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', fontWeight: 600, marginTop: 3 }}>≈ ${usd.toFixed(2)} USD</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', background: 'var(--surface-2)', border: '1px solid var(--line)',
            borderRadius: 12, padding: '10px 14px', margin: '16px 0', fontFamily: 'monospace', fontSize: 12.5, color: 'var(--ink-2)' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>lnbc{sats}1p3k7h9...q8s7v3x2k9</span>
            <button onClick={() => ctx.toast('Invoice copied')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--gold)', display: 'flex', flexShrink: 0 }}><Icon name="copy" size={16} /></button>
          </div>
          <button onClick={() => { onLoaded(sats); setStage('done'); }} style={{
            width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: 'pointer',
            background: '#000', color: '#fff', fontWeight: 700, fontSize: 15.5, fontFamily: 'var(--font-ui)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
          }}><Icon name="bolt" size={19} color="#fff" fill /> Open Strike to pay</button>
          <button onClick={() => setStage('amount')} style={{ marginTop: 10, border: 'none', background: 'none', color: 'var(--ink-3)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>← Change amount</button>
        </div>
      ) : null}

      {stage === 'done' ? (
        <div style={{ textAlign: 'center', padding: '12px 0 8px' }}>
          <div style={{ width: 74, height: 74, borderRadius: 999, background: 'color-mix(in oklab, var(--sage) 18%, var(--surface))',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', animation: 'trinityScale .4s ease both' }}>
            <Icon name="check" size={40} stroke={2.6} color="var(--sage)" />
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700 }}>Funds loaded</div>
          <p style={{ fontSize: 14.5, color: 'var(--ink-2)', margin: '6px 0 22px', lineHeight: 1.5 }}>{fmtSats(sats)} sats added to your wallet, instantly over Lightning.</p>
          <button onClick={onClose} style={{ width: '100%', padding: 15, borderRadius: 16, border: 'none', cursor: 'pointer',
            background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 15.5, fontFamily: 'var(--font-ui)' }}>Done</button>
        </div>
      ) : null}
    </BottomSheet>
  );
}

// ════ Give sheet: pick fund + amount, pay from wallet ════
function GiveSheet({ fund, open, onClose, ctx, balance, onGive }) {
  const D = window.TrinityData;
  const [usd, setUsd] = useG(10);
  const [anon, setAnon] = useG(true);
  useGE(() => { if (open) { setUsd(10); setAnon(true); } }, [open, fund]);
  if (!fund) return null;
  const sats = Math.round(usd * D.SATS_PER_USD);
  const enough = sats <= balance;

  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="86%">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div style={{ width: 42, height: 42, borderRadius: 13, background: `color-mix(in oklab, ${fund.accent} 16%, var(--surface))`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: fund.accent }}><Icon name={fund.icon} size={22} /></div>
          <div><div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, lineHeight: 1.05 }}>Give to {fund.name}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{fund.desc}</div></div>
        </div>
        <IconBtn name="x" onClick={onClose} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
        {[5, 10, 25, 50].map(p => {
          const on = usd === p;
          return <button key={p} onClick={() => setUsd(p)} style={{ padding: '13px 0', borderRadius: 13, cursor: 'pointer',
            border: on ? '2px solid var(--clay)' : '1px solid var(--line)', background: on ? 'var(--clay-soft)' : 'var(--surface-2)',
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: on ? 'var(--clay-ink)' : 'var(--ink)' }}>${p}</button>;
        })}
      </div>

      <div style={{ textAlign: 'center', padding: '14px 0 6px' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 700, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="bolt" size={26} color="var(--gold)" fill /> {fmtSats(sats)}<span style={{ fontSize: 18, color: 'var(--ink-3)' }}>sats</span></div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', fontWeight: 600, marginTop: 4 }}>≈ ${usd.toFixed(2)} · from your wallet</div>
      </div>

      <button onClick={() => setAnon(a => !a)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '13px 15px',
        borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface-2)', cursor: 'pointer', color: 'var(--ink)', margin: '14px 0' }}>
        <Icon name="shield" size={20} color={anon ? 'var(--clay)' : 'var(--ink-3)'} />
        <div style={{ flex: 1, textAlign: 'left' }}><div style={{ fontWeight: 700, fontSize: 14.5 }}>Give anonymously</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Your church sees the gift, never your name</div></div>
        <div style={{ width: 46, height: 28, borderRadius: 999, background: anon ? 'var(--clay)' : 'var(--line)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 3, left: anon ? 21 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} /></div>
      </button>

      {!enough ? (
        <div style={{ background: 'color-mix(in oklab, var(--clay) 10%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 30%, transparent)',
          borderRadius: 13, padding: '11px 14px', fontSize: 13, color: 'var(--clay-ink)', fontWeight: 600, marginBottom: 12, textAlign: 'center' }}>
          Not enough sats — load your wallet first.
        </div>
      ) : null}
      <button disabled={!enough} onClick={() => onGive(fund, sats, usd, anon)} style={{
        width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: enough ? 'pointer' : 'default',
        background: enough ? 'var(--clay)' : 'var(--line)', color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
      }}><Icon name="bolt" size={19} color="#fff" fill /> Send {fmtSats(sats)} sats</button>
    </BottomSheet>
  );
}

// ════ Giving view (the tab body) ════
function GivingView({ ctx, balance, setBalance, history, setHistory }) {
  const D = window.TrinityData;
  const [load, setLoad] = useG(false);
  const [fund, setFund] = useG(null);

  const give = (f, sats, usd, anon) => {
    setBalance(b => b - sats);
    setHistory(h => [{ id: 'g' + Date.now(), fund: f.name, sats, usd, when: 'Just now', anon, status: 'settled' }, ...h]);
    setFund(null);
    ctx.toast(`${fmtSats(sats)} sats sent to ${f.name}`);
  };

  return (
    <div style={{ animation: 'trinityFade .4s ease both' }}>
      {/* wallet hero */}
      <div style={{ position: 'relative', borderRadius: 24, overflow: 'hidden', marginBottom: 16,
        background: 'linear-gradient(150deg, #2a2218 0%, #16120c 100%)', color: '#F3ECDC', padding: '20px 22px', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: .9, background: 'radial-gradient(circle at 88% 8%, color-mix(in oklab, var(--gold) 45%, transparent), transparent 46%)' }} />
        <div style={{ position: 'absolute', right: -18, bottom: -28, opacity: .12 }}><Icon name="bolt" size={150} color="var(--gold)" fill /></div>
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, letterSpacing: '.5px', opacity: .85 }}>
            <Icon name="bolt" size={15} color="var(--gold)" fill /> LIGHTNING WALLET</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9, margin: '12px 0 2px' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 700, lineHeight: .9 }}>{fmtSats(balance)}</span>
            <span style={{ fontSize: 18, fontWeight: 600, opacity: .7, marginBottom: 3 }}>sats</span>
          </div>
          <div style={{ fontSize: 13.5, opacity: .75, fontWeight: 600 }}>≈ ${usdOf(balance).toFixed(2)} USD</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button onClick={() => setLoad(true)} style={{ flex: 1, padding: '13px', borderRadius: 14, border: 'none', cursor: 'pointer',
              background: 'var(--gold)', color: '#1a1410', fontWeight: 800, fontSize: 14.5, fontFamily: 'var(--font-ui)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
              <Icon name="plus" size={18} stroke={2.6} color="#1a1410" /> Load funds</button>
            <button onClick={() => ctx.toast('Lightning address copied')} style={{ padding: '13px 16px', borderRadius: 14, cursor: 'pointer',
              background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.2)', color: '#F3ECDC', fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-ui)',
              display: 'flex', alignItems: 'center', gap: 7 }}>
              <Icon name="qr" size={18} color="#F3ECDC" /> Receive</button>
          </div>
        </div>
      </div>

      {/* Strike load promo */}
      <button onClick={() => setLoad(true)} style={{ width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 24,
        display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="bolt" size={24} color="#fff" fill /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>Load with Strike</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Add money instantly over the Lightning Network</div>
        </div>
        <Icon name="chevR" size={18} color="var(--ink-3)" />
      </button>

      {/* funds */}
      <SectionLabel>Give to</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {D.FUNDS.filter(f => f.church === ctx.church.id).map(f => (
          <div key={f.id} onClick={() => setFund(f)} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18,
            background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', boxShadow: 'var(--shadow)' }}>
            <div style={{ width: 44, height: 44, borderRadius: 13, background: `color-mix(in oklab, ${f.accent} 16%, var(--surface))`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: f.accent, flexShrink: 0 }}><Icon name={f.icon} size={23} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>{f.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{f.desc}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: f.accent, fontWeight: 700, fontSize: 13.5 }}>Give<Icon name="chevR" size={16} color={f.accent} /></div>
          </div>
        ))}
      </div>

      {/* history */}
      <SectionLabel action="Statements" onAction={() => ctx.toast('Annual giving statement')}>Recent giving</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {history.map(h => (
          <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 16,
            background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: 'color-mix(in oklab, var(--gold) 16%, var(--surface))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)', flexShrink: 0 }}>
              <Icon name={h.zap ? 'bolt' : 'gift'} size={19} fill={h.zap} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 7 }}>
                {h.zap ? h.to : h.fund}
                {h.anon ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'var(--clay-soft)', color: 'var(--clay-ink)', padding: '1px 7px', borderRadius: 999, fontSize: 9.5, fontWeight: 800, letterSpacing: '.3px' }}><Icon name="shield" size={9} />ANON</span> : null}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{h.when}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14.5, color: 'var(--ink)' }}>{fmtSats(h.sats)}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600 }}>${h.usd.toFixed(2)}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center', margin: '20px 0 4px', color: 'var(--ink-3)', fontSize: 11.5, textAlign: 'center' }}>
        <Icon name="bolt" size={13} color="var(--gold)" fill /> Gifts settle instantly on the Lightning Network · self-custodial
      </div>

      <StrikeLoadSheet open={load} onClose={() => setLoad(false)} ctx={ctx} onLoaded={(sats) => setBalance(b => b + sats)} />
      <GiveSheet fund={fund} open={!!fund} onClose={() => setFund(null)} ctx={ctx} balance={balance} onGive={give} />
    </div>
  );
}

Object.assign(window, { GivingView });
