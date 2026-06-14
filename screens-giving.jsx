// screens-giving.jsx — Lightning "Giving" tab inside Chat.
// Non-custodial: the app holds no balance and no funds. A gift resolves the church's
// Lightning Address, fetches a real invoice, and the member pays it from THEIR OWN
// wallet (WebLN / the `lightning:` deep link / a scannable QR). Self-custody — nobody
// tops anything up; the sats move peer-to-peer from the giver to the church.
const { useState: useG, useEffect: useGE } = React;

const fmtSats = (n) => Number(n || 0).toLocaleString('en-US');
const usdOf = (sats) => (sats / window.TrinityData.SATS_PER_USD);

// small inline spinner (uses the trinitySpin keyframe from index.html)
function GiveSpinner({ size = 18, color = 'var(--clay)' }) {
  return <span style={{ display: 'inline-block', width: size, height: size, borderRadius: 999,
    border: `${Math.max(2, Math.round(size / 9))}px solid color-mix(in oklab, ${color} 28%, transparent)`,
    borderTopColor: color, animation: 'trinitySpin .7s linear infinite' }} />;
}

// ════ Give sheet: pick fund + amount → real invoice → pay from your own wallet ════
function GiveSheet({ fund, open, onClose, ctx, onGive, onPickFund, funds }) {
  const D = window.TrinityData;
  const LN = window.TrinityLN;
  const FUNDS = funds || D.FUNDS;
  const [stage, setStage] = useG('amount');      // amount | pay | sending | done
  const [usd, setUsd] = useG(10);
  const [custom, setCustom] = useG('');
  const [anon, setAnon] = useG(true);
  const [picking, setPicking] = useG(false);
  const [bolt11, setBolt11] = useG('');
  const [err, setErr] = useG('');
  const [busy, setBusy] = useG(false);

  useGE(() => { if (open) { setStage('amount'); setUsd(10); setCustom(''); setAnon(true); setPicking(false); setBolt11(''); setErr(''); setBusy(false); } }, [open, fund]);
  if (!fund) return null;

  const amtUsd = custom ? (parseFloat(custom) || 0) : usd;
  const sats = LN.usdToSats(amtUsd);
  const addr = LN.payAddress(fund, ctx);

  // amount → fetch a real invoice from the church's Lightning address
  const toInvoice = async () => {
    if (!addr) { setErr('This church hasn’t set up giving yet — ask a steward to add a Lightning address.'); return; }
    if (sats <= 0) return;
    setBusy(true); setErr('');
    try {
      const me = (window.TrinityIdentity && window.TrinityIdentity.current) || {};
      const comment = anon ? `Gift · ${fund.name}` : `Gift · ${fund.name} · ${me.name || ''}`.replace(/ · $/, '');
      const { bolt11 } = await LN.invoiceFor(addr, sats, comment);
      setBolt11(bolt11);
      setStage('pay');
      // if the member has a WebLN wallet, offer to pay straight away
    } catch (e) { setErr(e.message || 'Could not create an invoice'); }
    finally { setBusy(false); }
  };

  const openWallet = () => { try { window.location.href = LN.walletURI(bolt11); } catch {} };
  const copyInv = () => { try { navigator.clipboard.writeText(bolt11); ctx.toast('Invoice copied'); } catch { ctx.toast('Copy failed'); } };

  const payWebLN = async () => {
    setStage('sending'); setErr('');
    try { await LN.payViaWebLN(bolt11); settle(); }
    catch (e) { setStage('pay'); if (!/cancel|reject|user/i.test(e.message || '')) setErr(e.message || 'Wallet payment failed'); }
  };

  const settle = () => { onGive(fund, sats, amtUsd, anon); setStage('done'); };

  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="90%">
      {/* tappable fund header — switch which fund you give to */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button onClick={() => stage === 'amount' && setPicking(p => !p)} style={{ display: 'flex', alignItems: 'center', gap: 11, border: 'none', background: 'none', cursor: stage === 'amount' ? 'pointer' : 'default', textAlign: 'left', padding: 0, flex: 1, minWidth: 0 }}>
          <div style={{ width: 42, height: 42, borderRadius: 13, background: `color-mix(in oklab, ${fund.accent} 16%, var(--surface))`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: fund.accent, flexShrink: 0 }}><Icon name={fund.icon} size={22} /></div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, lineHeight: 1.05 }}>Give to {fund.name}</span>
              {stage === 'amount' ? <Icon name={picking ? 'chevU' : 'chevD'} size={16} stroke={2.2} color="var(--ink-3)" /> : null}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{picking ? 'Choose a fund' : fund.desc}</div>
          </div>
        </button>
        <IconBtn name="x" onClick={onClose} />
      </div>

      {picking ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 6, animation: 'trinityFade .2s ease both' }}>
          {FUNDS.map(f => {
            const on = f.id === fund.id;
            return (
              <button key={f.id} onClick={() => { onPickFund && onPickFund(f); setPicking(false); }} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                border: on ? `2px solid ${f.accent}` : '1px solid var(--line)', background: on ? `color-mix(in oklab, ${f.accent} 12%, var(--surface))` : 'var(--surface-2)' }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: `color-mix(in oklab, ${f.accent} 16%, var(--surface))`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: f.accent, flexShrink: 0 }}><Icon name={f.icon} size={20} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>{f.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.desc}</div>
                </div>
                {on ? <Icon name="check" size={18} stroke={2.6} color={f.accent} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* STAGE: amount */}
      {!picking && stage === 'amount' ? (
        <React.Fragment>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
            {[5, 10, 25, 50].map(p => {
              const on = !custom && usd === p;
              return <button key={p} onClick={() => { setUsd(p); setCustom(''); }} style={{ padding: '13px 0', borderRadius: 13, cursor: 'pointer',
                border: on ? '2px solid var(--clay)' : '1px solid var(--line)', background: on ? 'var(--clay-soft)' : 'var(--surface-2)',
                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: on ? 'var(--clay-ink)' : 'var(--ink)' }}>${p}</button>;
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 52, borderRadius: 14,
            border: custom ? '2px solid var(--clay)' : '1px solid var(--line)', background: 'var(--surface-2)', marginBottom: 6 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--ink-2)' }}>$</span>
            <input value={custom} onChange={e => setCustom(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="Other amount"
              style={{ flex: 1, border: 'none', background: 'none', outline: 'none', fontSize: 16, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }} />
          </div>

          <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Icon name="bolt" size={25} color="var(--gold)" fill /> {fmtSats(sats)}<span style={{ fontSize: 17, color: 'var(--ink-3)' }}>sats</span></div>
            <div style={{ fontSize: 13.5, color: 'var(--ink-2)', fontWeight: 600, marginTop: 4 }}>≈ ${amtUsd.toFixed(2)} · paid from your own wallet</div>
          </div>

          <button onClick={() => setAnon(a => !a)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '13px 15px',
            borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface-2)', cursor: 'pointer', color: 'var(--ink)', margin: '14px 0' }}>
            <Icon name="shield" size={20} color={anon ? 'var(--clay)' : 'var(--ink-3)'} />
            <div style={{ flex: 1, textAlign: 'left' }}><div style={{ fontWeight: 700, fontSize: 14.5 }}>Give anonymously</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Your church sees the gift, never your name</div></div>
            <div style={{ width: 46, height: 28, borderRadius: 999, background: anon ? 'var(--clay)' : 'var(--line)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
              <div style={{ position: 'absolute', top: 3, left: anon ? 21 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} /></div>
          </button>

          {err ? <div style={{ background: 'color-mix(in oklab, var(--clay) 10%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 30%, transparent)',
            borderRadius: 13, padding: '11px 14px', fontSize: 13, color: 'var(--clay-ink)', fontWeight: 600, marginBottom: 12, textAlign: 'center', lineHeight: 1.45 }}>{err}</div> : null}

          <button disabled={!sats || busy} onClick={toInvoice} style={{
            width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: sats && !busy ? 'pointer' : 'default',
            background: sats ? 'var(--clay)' : 'var(--line)', color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
          }}>{busy ? <GiveSpinner size={18} color="#fff" /> : <Icon name="bolt" size={19} color="#fff" fill />} {busy ? 'Creating invoice…' : `Continue · ${fmtSats(sats)} sats`}</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center', marginTop: 13, color: 'var(--ink-3)', fontSize: 12, textAlign: 'center', lineHeight: 1.4 }}>
            <Icon name="key" size={13} /> You pay from your own Bitcoin wallet — nothing is held here.
          </div>
        </React.Fragment>
      ) : null}

      {/* STAGE: pay (real invoice + member's own wallet) */}
      {!picking && stage === 'pay' ? (
        <div style={{ textAlign: 'center', animation: 'trinityFade .25s ease both' }}>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', fontWeight: 600 }}>Scan with any Lightning wallet to give</div>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0' }}>
            <div style={{ padding: 14, borderRadius: 20, background: '#fff', boxShadow: 'var(--shadow)', width: 196, height: 196, boxSizing: 'border-box', display: 'flex' }}
              dangerouslySetInnerHTML={{ __html: LN.qrSVG(bolt11) }} />
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{fmtSats(sats)} <span style={{ fontSize: 16, color: 'var(--ink-3)' }}>sats</span></div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 600, marginTop: 3 }}>≈ ${amtUsd.toFixed(2)} → {addr}</div>

          {LN.hasWebLN() ? (
            <button onClick={payWebLN} style={{ width: '100%', padding: 15, borderRadius: 16, border: 'none', cursor: 'pointer', marginTop: 16,
              background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 15.5, fontFamily: 'var(--font-ui)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
              <Icon name="bolt" size={19} color="#fff" fill /> Pay with my wallet</button>
          ) : null}

          <button onClick={openWallet} style={{ width: '100%', padding: 15, borderRadius: 16, cursor: 'pointer', marginTop: LN.hasWebLN() ? 9 : 16,
            background: LN.hasWebLN() ? 'var(--surface-2)' : 'var(--clay)', border: LN.hasWebLN() ? '1px solid var(--line)' : 'none',
            color: LN.hasWebLN() ? 'var(--ink)' : '#fff', fontWeight: 700, fontSize: 15.5, fontFamily: 'var(--font-ui)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
            <Icon name="bolt" size={18} color={LN.hasWebLN() ? 'var(--clay)' : '#fff'} fill /> Open in wallet (Strike, Phoenix…)</button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', background: 'var(--surface-2)', border: '1px solid var(--line)',
            borderRadius: 12, padding: '10px 14px', margin: '12px 0', fontFamily: 'monospace', fontSize: 12, color: 'var(--ink-2)' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bolt11}</span>
            <button onClick={copyInv} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--gold)', display: 'flex', flexShrink: 0 }}><Icon name="copy" size={16} /></button>
          </div>

          {err ? <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', fontWeight: 600, marginBottom: 10 }}>{err}</div> : null}

          <button onClick={settle} style={{ width: '100%', padding: 13, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)',
            color: 'var(--ink-2)', fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-ui)', cursor: 'pointer' }}>I’ve sent it →</button>
          <button onClick={() => { setStage('amount'); setBolt11(''); setErr(''); }} style={{ marginTop: 8, border: 'none', background: 'none', color: 'var(--ink-3)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>← Change amount</button>
        </div>
      ) : null}

      {/* STAGE: sending (WebLN in flight) */}
      {!picking && stage === 'sending' ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <GiveSpinner size={34} color="var(--clay)" />
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginTop: 16 }}>Paying from your wallet…</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 4 }}>{fmtSats(sats)} sats to {fund.name}</div>
        </div>
      ) : null}

      {/* STAGE: done */}
      {!picking && stage === 'done' ? (
        <div style={{ textAlign: 'center', padding: '12px 0 8px' }}>
          <div style={{ width: 74, height: 74, borderRadius: 999, background: 'color-mix(in oklab, var(--sage) 18%, var(--surface))',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', animation: 'trinityScale .4s ease both' }}>
            <Icon name="check" size={40} stroke={2.6} color="var(--sage)" />
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700 }}>Thank you</div>
          <p style={{ fontSize: 14.5, color: 'var(--ink-2)', margin: '6px 0 22px', lineHeight: 1.5 }}>{fmtSats(sats)} sats on its way to {fund.name}, straight from your wallet over Lightning.</p>
          <button onClick={onClose} style={{ width: '100%', padding: 15, borderRadius: 16, border: 'none', cursor: 'pointer',
            background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 15.5, fontFamily: 'var(--font-ui)' }}>Done</button>
        </div>
      ) : null}
    </BottomSheet>
  );
}

// ════ Fund detail: more about a fund (tap the card) ════
function FundDetailSheet({ fund, open, onClose, ctx, onGive }) {
  const D = window.TrinityData;
  if (!fund) return null;
  const church = (ctx.churches || D.CHURCHES || []).find(c => c.id === (fund.church || ctx.activeChurch)) || {};
  const fmtUsd = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const raised = fund.raised || 0;
  const pct = fund.goal ? Math.min(100, Math.round(raised / fund.goal * 100)) : 0;
  const rows = [
    { ic: 'key', accent: 'var(--gold)', title: 'You keep custody', body: 'You pay from your own Bitcoin wallet — the app never holds your money or asks you to top up a balance.' },
    { ic: 'bolt', fill: true, accent: 'var(--clay)', title: 'Instant over Lightning', body: 'Gifts settle in seconds, peer-to-peer, with near-zero fees.' },
    { ic: 'shield', accent: 'var(--sage)', title: church.name ? `Goes straight to ${church.name}` : 'Goes straight to your church', body: 'This fund is published and signed by the church’s key on Nostr, and gifts pay its own Lightning address — no middleman.' },
  ];
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="90%">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 2 }}>
        <IconBtn name="x" onClick={onClose} />
      </div>

      {/* identity */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: `color-mix(in oklab, ${fund.accent} 16%, var(--surface))`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: fund.accent, flexShrink: 0 }}><Icon name={fund.icon} size={28} fill={fund.icon === 'bolt'} /></div>
        <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{fund.name}</div>
          <div style={{ fontFamily: 'var(--font-read)', fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.45, marginTop: 4, textWrap: 'pretty' }}>{fund.desc}</div>
          {church.name ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '5px 11px 5px 6px', borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <ChurchBadge church={church} size={22} radius={7} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>{church.name}</span>
              {church.verified ? <Icon name="check" size={13} stroke={3} color="var(--sage)" /> : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* progress toward a steward-set goal */}
      {fund.goal ? (
        <div style={{ marginBottom: 18, padding: 16, borderRadius: 18, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--ink)' }}>{fmtUsd(raised)}</span>
            <span style={{ fontSize: 13.5, color: 'var(--ink-2)', fontWeight: 600 }}>of {fmtUsd(fund.goal)}</span>
            <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 800, color: fund.accent, background: `color-mix(in oklab, ${fund.accent} 14%, var(--surface))`, padding: '3px 10px', borderRadius: 999 }}>{pct}%</span>
          </div>
          <div style={{ position: 'relative', height: 10, borderRadius: 999, background: 'var(--line)', margin: '12px 0 0', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct + '%', borderRadius: 999, background: fund.accent }} />
          </div>
          {raised === 0 ? <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>Just getting started — be the first to give.</div> : null}
          {fund.milestones && fund.milestones.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
              {fund.milestones.map((m, i) => {
                const reached = raised >= m.amount;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: '1px solid var(--line-2)' }}>
                    <div style={{ width: 22, height: 22, borderRadius: 999, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: reached ? fund.accent : 'transparent', border: reached ? 'none' : '2px solid var(--line)' }}>
                      {reached ? <Icon name="check" size={13} stroke={2.8} color="#fff" /> : null}</div>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: reached ? 'var(--ink)' : 'var(--ink-2)' }}>{m.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: reached ? fund.accent : 'var(--ink-3)' }}>{fmtUsd(m.amount)}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* give */}
      <button onClick={() => onGive(fund)} style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: 'pointer',
        background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
        <Icon name="bolt" size={19} color="#fff" fill /> Give to {fund.name}</button>

      {/* about — steward-written */}
      {fund.about ? (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 8 }}>ABOUT THIS FUND</div>
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0, textWrap: 'pretty' }}>{fund.about}</p>
        </div>
      ) : null}

      {/* how it works */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '22px 2px 12px' }}>HOW YOUR GIFT WORKS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: `color-mix(in oklab, ${r.accent} 14%, var(--surface))`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: r.accent }}><Icon name={r.ic} size={19} fill={r.fill} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.title}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 1, textWrap: 'pretty' }}>{r.body}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center', margin: '20px 0 2px', color: 'var(--ink-3)', fontSize: 11.5, textAlign: 'center' }}>
        <Icon name="receipt" size={13} color="var(--ink-3)" /> Need a year-end statement? Attach your name on any gift.
      </div>
    </BottomSheet>
  );
}

// ════ Create a giving fund (steward) ════
const FUND_ICONS = ['heart', 'globe', 'library', 'pray', 'sun', 'bolt'];
const FUND_ACCENTS = ['var(--clay)', 'var(--sage)', 'var(--gold)', '#5360D6', '#C24B7A', '#2A8C82'];
function NewFundSheet({ open, onClose, onCreate, ctx }) {
  const [name, setName] = useG('');
  const [desc, setDesc] = useG('');
  const [icon, setIcon] = useG('heart');
  const [accent, setAccent] = useG('var(--clay)');
  const [about, setAbout] = useG('');
  const [lnaddr, setLnaddr] = useG('');
  const [goalOn, setGoalOn] = useG(false);
  const [goal, setGoal] = useG('');
  const [milestones, setMilestones] = useG([]);
  useGE(() => { if (open) { setName(''); setDesc(''); setIcon('heart'); setAccent('var(--clay)'); setAbout(''); setLnaddr(''); setGoalOn(false); setGoal(''); setMilestones([]); } }, [open]);

  const setMs = (i, key, val) => setMilestones(ms => ms.map((m, j) => j === i ? { ...m, [key]: val } : m));
  const addMs = () => setMilestones(ms => ms.length >= 4 ? ms : [...ms, { label: '', amount: '' }]);
  const rmMs = (i) => setMilestones(ms => ms.filter((_, j) => j !== i));

  const make = () => onCreate({
    id: 'fund' + Date.now(), name: name.trim() || 'New Fund',
    desc: desc.trim() || 'A new giving fund', icon, accent,
    about: about.trim(),
    lnaddr: lnaddr.trim(),
    goal: goalOn && Number(goal) > 0 ? Number(goal) : null,
    raised: 0,
    milestones: goalOn ? milestones.filter(m => m.label.trim() && Number(m.amount) > 0).map(m => ({ label: m.label.trim(), amount: Number(m.amount) })) : [],
  });

  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="88%">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>New giving fund</div>
        <IconBtn name="x" onClick={onClose} />
      </div>
      <div style={{ display: 'flex', gap: 9, padding: 13, borderRadius: 14, background: 'color-mix(in oklab, var(--gold) 12%, var(--surface))',
        border: '1px solid color-mix(in oklab, var(--gold) 30%, transparent)', marginBottom: 18 }}>
        <Icon name="shield" size={19} color="var(--gold)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>Funds are usually set up by a church <b style={{ color: 'var(--ink)' }}>steward</b>. Gifts pay straight to the church’s own Lightning address — the app never holds them.</div>
      </div>

      {/* live preview */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18, background: 'var(--surface)',
        border: '1px solid var(--line)', boxShadow: 'var(--shadow)', marginBottom: 18 }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: `color-mix(in oklab, ${accent} 16%, var(--surface))`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent, flexShrink: 0 }}><Icon name={icon} size={23} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>{name.trim() || 'Fund name'}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{desc.trim() || 'Short description'}</div>
        </div>
      </div>

      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 8 }}>FUND NAME</label>
      <input value={name} onChange={e => setName(e.target.value.slice(0, 32))} autoFocus placeholder="e.g. Youth Camp" style={{
        width: '100%', height: 50, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)', padding: '0 16px',
        fontSize: 16, fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--ink)', outline: 'none', boxShadow: 'var(--shadow)', marginBottom: 14 }} />

      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 8 }}>SHORT DESCRIPTION</label>
      <input value={desc} onChange={e => setDesc(e.target.value.slice(0, 60))} placeholder="What it supports" style={{
        width: '100%', height: 50, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)', padding: '0 16px',
        fontSize: 15, fontFamily: 'var(--font-ui)', fontWeight: 500, color: 'var(--ink)', outline: 'none', boxShadow: 'var(--shadow)', marginBottom: 18 }} />

      <label style={{ display: 'flex', alignItems: 'baseline', gap: 7, fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 8 }}>LIGHTNING ADDRESS <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none', color: 'var(--ink-3)' }}>· where gifts land</span></label>
      <input value={lnaddr} onChange={e => setLnaddr(e.target.value.trim())} inputMode="email" autoCapitalize="none" placeholder="giving@yourchurch.org" style={{
        width: '100%', height: 50, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)', padding: '0 16px',
        fontSize: 15, fontFamily: 'monospace', fontWeight: 600, color: 'var(--ink)', outline: 'none', boxShadow: 'var(--shadow)', marginBottom: 6 }} />
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 18, lineHeight: 1.45 }}>Leave blank to use the church’s default address. This is the church’s own wallet — Strike, Phoenix, Alby, a node, anywhere that gives a Lightning address.</div>

      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 10 }}>ICON</label>
      <div style={{ display: 'flex', gap: 9, marginBottom: 18, flexWrap: 'wrap' }}>
        {FUND_ICONS.map(ic => {
          const on = icon === ic;
          return <button key={ic} onClick={() => setIcon(ic)} style={{ width: 46, height: 46, borderRadius: 13, cursor: 'pointer',
            border: on ? `2px solid ${accent}` : '1px solid var(--line)', background: on ? `color-mix(in oklab, ${accent} 14%, var(--surface))` : 'var(--surface-2)',
            color: on ? accent : 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={ic} size={22} fill={ic === 'bolt' && on} /></button>;
        })}
      </div>

      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 10 }}>COLOUR</label>
      <div style={{ display: 'flex', gap: 11, marginBottom: 22 }}>
        {FUND_ACCENTS.map(c => {
          const on = accent === c;
          return <button key={c} onClick={() => setAccent(c)} style={{ width: 36, height: 36, borderRadius: 999, background: c, cursor: 'pointer',
            border: on ? '2.5px solid var(--ink)' : '2px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {on ? <Icon name="check" size={16} stroke={2.8} color="#fff" /> : null}</button>;
        })}
      </div>

      <label style={{ display: 'flex', alignItems: 'baseline', gap: 7, fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 8 }}>ABOUT THIS FUND <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none', color: 'var(--ink-3)' }}>· optional, members will read this</span></label>
      <textarea value={about} onChange={e => setAbout(e.target.value.slice(0, 240))} placeholder="A sentence or two on the story behind this fund — why it matters and what gifts make possible." rows={3} style={{
        width: '100%', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)', padding: '12px 16px', resize: 'none',
        fontSize: 14.5, fontFamily: 'var(--font-read)', fontWeight: 400, lineHeight: 1.5, color: 'var(--ink)', outline: 'none', boxShadow: 'var(--shadow)', marginBottom: 18 }} />

      {/* goal & milestones */}
      <button onClick={() => setGoalOn(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '13px 15px',
        borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface-2)', cursor: 'pointer', color: 'var(--ink)', marginBottom: goalOn ? 14 : 22 }}>
        <Icon name="flame" size={20} color={goalOn ? accent : 'var(--ink-3)'} />
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>Show a goal &amp; milestones</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>A progress bar members can rally behind</div>
        </div>
        <div style={{ width: 46, height: 28, borderRadius: 999, background: goalOn ? accent : 'var(--line)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 3, left: goalOn ? 21 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} /></div>
      </button>

      {goalOn ? (
        <div style={{ animation: 'trinityFade .2s ease both', marginBottom: 22 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 8 }}>GOAL AMOUNT</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 50, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', boxShadow: 'var(--shadow)', marginBottom: 16 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--ink-2)' }}>$</span>
            <input value={goal} onChange={e => setGoal(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))} inputMode="numeric" placeholder="50,000" style={{
              flex: 1, border: 'none', background: 'none', outline: 'none', fontSize: 17, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }} />
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 600 }}>target</span>
          </div>

          <label style={{ display: 'flex', alignItems: 'baseline', gap: 7, fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 10 }}>MILESTONES <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none' }}>· optional steps along the way</span></label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {milestones.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 24, height: 24, borderRadius: 999, flexShrink: 0, background: `color-mix(in oklab, ${accent} 16%, var(--surface))`, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 12 }}>{i + 1}</div>
                <input value={m.label} onChange={e => setMs(i, 'label', e.target.value.slice(0, 28))} placeholder="Milestone name" style={{
                  flex: 1, minWidth: 0, height: 44, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface)', padding: '0 13px',
                  fontSize: 14, fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--ink)', outline: 'none' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: 96, flexShrink: 0, height: 44, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface)', padding: '0 11px' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-3)' }}>$</span>
                  <input value={m.amount} onChange={e => setMs(i, 'amount', e.target.value.replace(/[^0-9]/g, '').slice(0, 8))} inputMode="numeric" placeholder="10,000" style={{
                    flex: 1, minWidth: 0, border: 'none', background: 'none', outline: 'none', fontSize: 14, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }} />
                </div>
                <button onClick={() => rmMs(i)} aria-label="Remove milestone" style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 9, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={17} /></button>
              </div>
            ))}
          </div>
          {milestones.length < 4 ? (
            <button onClick={addMs} style={{ marginTop: milestones.length ? 10 : 0, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 11, border: '1px dashed var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
              <Icon name="plus" size={16} stroke={2.2} color={accent} /> Add milestone</button>
          ) : null}
        </div>
      ) : null}

      <button onClick={make} style={{ width: '100%', padding: 16, borderRadius: 15, border: 'none', cursor: 'pointer', background: 'var(--clay)',
        color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
        <Icon name="plus" size={19} stroke={2.4} color="#fff" /> Create fund</button>
    </BottomSheet>
  );
}

// ════ Giving view (the tab body) ════
function GivingView({ ctx, history, setHistory, giveSignal }) {
  const D = window.TrinityData;
  const FUNDS = (ctx.funds || D.FUNDS).filter(f => !f.church || f.church === ctx.activeChurch);
  const [fund, setFund] = useG(null);
  const [newFund, setNewFund] = useG(false);
  const [detail, setDetail] = useG(null);
  useGE(() => { if (giveSignal && FUNDS.length) setFund(FUNDS[0]); }, [giveSignal]);

  const give = (f, sats, usd, anon) => {
    setHistory(h => [{ id: 'g' + Date.now(), fund: f.name, sats, usd, when: 'Just now', anon, status: 'sent' }, ...h]);
    setFund(null);
    ctx.toast(`${fmtSats(sats)} sats sent to ${f.name}`);
  };

  return (
    <div style={{ animation: 'trinityFade .4s ease both' }}>
      {/* self-custody banner — replaces the old top-up wallet */}
      <div style={{ position: 'relative', borderRadius: 20, overflow: 'hidden', marginBottom: 16,
        background: 'linear-gradient(150deg, #2a2218 0%, #16120c 100%)', color: '#F3ECDC', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: .9, background: 'radial-gradient(circle at 92% 0%, color-mix(in oklab, var(--gold) 42%, transparent), transparent 42%)' }} />
        <div style={{ position: 'absolute', right: -22, bottom: -30, opacity: .1 }}><Icon name="bolt" size={130} color="var(--gold)" fill /></div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 13, padding: '15px 16px' }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="key" size={20} color="var(--gold)" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16.5, fontWeight: 700, lineHeight: 1.1 }}>Give from your own wallet</div>
            <div style={{ fontSize: 12.5, opacity: .72, marginTop: 2, lineHeight: 1.4 }}>Self-custody — no balance to top up. Pay any fund straight from your Bitcoin wallet over Lightning.</div>
          </div>
        </div>
      </div>

      {/* funds */}
      <SectionLabel action="+ New fund" onAction={() => setNewFund(true)}>Give to</SectionLabel>
      {FUNDS.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {FUNDS.map(f => (
            <div key={f.id} onClick={() => setDetail(f)} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18,
              background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', boxShadow: 'var(--shadow)' }}>
              <div style={{ width: 44, height: 44, borderRadius: 13, background: `color-mix(in oklab, ${f.accent} 16%, var(--surface))`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: f.accent, flexShrink: 0 }}><Icon name={f.icon} size={23} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>{f.name}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{f.desc}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setFund(f); }} aria-label={`Give to ${f.name}`} style={{
                display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5,
                color: f.accent, background: `color-mix(in oklab, ${f.accent} 14%, var(--surface))`, border: `1px solid color-mix(in oklab, ${f.accent} 30%, transparent)`,
                padding: '8px 13px', borderRadius: 999 }}>Give<Icon name="chevR" size={15} color={f.accent} /></button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '26px 20px 30px', color: 'var(--ink-3)' }}>
          <Icon name="heart" size={30} color="var(--ink-3)" />
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink-2)', marginTop: 10 }}>No funds yet</div>
          <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>A church steward sets up giving funds and the Lightning address gifts go to.</div>
        </div>
      )}

      {/* history */}
      {history.length ? (
        <React.Fragment>
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
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600 }}>${(h.usd || 0).toFixed(2)}</div>
                </div>
              </div>
            ))}
          </div>
        </React.Fragment>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center', margin: '20px 0 4px', color: 'var(--ink-3)', fontSize: 11.5, textAlign: 'center' }}>
        <Icon name="bolt" size={13} color="var(--gold)" fill /> Gifts settle instantly on the Lightning Network · self-custodial
      </div>

      <FundDetailSheet fund={detail} open={!!detail} onClose={() => setDetail(null)} ctx={ctx}
        onGive={(f) => { setDetail(null); setTimeout(() => setFund(f), 180); }} />
      <GiveSheet fund={fund} open={!!fund} onClose={() => setFund(null)} ctx={ctx} onGive={give} onPickFund={setFund} funds={FUNDS} />
      <NewFundSheet open={newFund} onClose={() => setNewFund(false)} ctx={ctx}
        onCreate={(f) => { ctx.addFund(f); setNewFund(false); ctx.toast('Giving fund created'); setTimeout(() => setFund(f), 250); }} />
    </div>
  );
}

Object.assign(window, { GivingView });
