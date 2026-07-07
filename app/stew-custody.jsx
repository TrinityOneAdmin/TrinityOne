// stew-custody.jsx — extension vs phone-bunker custody explainer. Exports CustodyExplainer.

function FlowNode({ ic, title, sub, accent = 'var(--clay)', big = false, badge }) {
  return (
    <div style={{ position: 'relative', flex: 1, borderRadius: 16, padding: '18px 16px', background: big ? 'linear-gradient(160deg,var(--midnight-2),var(--midnight))' : 'var(--surface)', border: big ? 'none' : '1px solid var(--line)', color: big ? 'var(--paper)' : 'var(--ink)', boxShadow: big ? 'var(--shadow-md)' : 'none', textAlign: 'center' }}>
      {badge ? <span style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: 10, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', color: '#fff', background: accent, padding: '3px 9px', borderRadius: 999 }}>{badge}</span> : null}
      <div style={{ width: 42, height: 42, borderRadius: 12, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: big ? 'rgba(224,184,96,.16)' : 'var(--surface-2)', color: big ? 'var(--gold-soft)' : accent }}><Icon name={ic} size={22} color="currentColor" /></div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14.5, marginTop: 10 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: big ? 'rgba(243,236,220,.6)' : 'var(--ink-3)', marginTop: 2, lineHeight: 1.35 }}>{sub}</div>
    </div>
  );
}

function FlowArrows({ topLabel, botLabel, note, accent = 'var(--clay)' }) {
  return (
    <div style={{ width: 132, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '0 6px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: accent, textAlign: 'center' }}>{topLabel}</div>
      <svg width="120" height="14" viewBox="0 0 120 14"><path d="M2 7 H110" stroke={accent} strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" /><path d="M104 2 L112 7 L104 12" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <svg width="120" height="14" viewBox="0 0 120 14"><path d="M118 7 H10" stroke="var(--sage)" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" /><path d="M16 2 L8 7 L16 12" fill="none" stroke="var(--sage)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--sage)', textAlign: 'center' }}>{botLabel}</div>
      {note ? <div style={{ fontSize: 10, color: 'var(--ink-3)', textAlign: 'center', marginTop: 4, lineHeight: 1.3 }}>{note}</div> : null}
    </div>
  );
}

function CustodyCard({ pick, title, sub, signerNode, arrows, keyLine, bullets }) {
  return (
    <div style={{ flex: 1, borderRadius: 22, background: 'var(--surface)', border: pick ? '2px solid var(--clay)' : '1px solid var(--line)', padding: 26, boxShadow: pick ? 'var(--shadow-md)' : 'var(--shadow-sm)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 21, letterSpacing: '-.4px' }}>{title}</div>
        {pick ? <SkPill tint="clay">Your pick</SkPill> : <SkPill tint="ink">Alternative</SkPill>}
      </div>
      <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 6 }}>{sub}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 22, marginBottom: 6 }}>
        <FlowNode ic="sliders" title="Steward Console" sub="in a web browser" accent="var(--clay)" />
        {arrows}
        {signerNode}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 16, padding: '11px 14px', borderRadius: 12, background: 'color-mix(in oklab, var(--gold) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 26%, transparent)' }}>
        <Icon name="key" size={17} color="#8a6717" style={{ flexShrink: 0 }} />
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>{keyLine}</div>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {bullets.map((b, i) => (
          <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>
            <span style={{ width: 20, height: 20, borderRadius: 999, background: 'var(--sage-soft)', color: '#345c41', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}><Icon name="check" size={12} stroke={2.8} color="currentColor" /></span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CustodyExplainer() {
  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--paper)', padding: 36, fontFamily: 'var(--font-ui)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ textAlign: 'center' }}>
        <SkPill tint="sage">Key custody</SkPill>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 30, letterSpacing: '-.8px', margin: '12px 0 0' }}>Two ways to guard the church key</h1>
        <p style={{ fontSize: 15, color: 'var(--ink-2)', maxWidth: 640, margin: '8px auto 0', lineHeight: 1.5 }}>Both feel the same — the console asks, you approve, it signs. The only difference is <b style={{ color: 'var(--ink)' }}>which device holds the secret</b>. Like a 2-factor prompt for your church.</p>
      </div>

      <div style={{ display: 'flex', gap: 22, marginTop: 26, flex: 1 }}>
        <CustodyCard
          pick
          title="Browser extension"
          sub="Keykeeper add-on holds the key on one computer."
          arrows={<FlowArrows topLabel="1 · sign this" botLabel="2 · signature" note="same computer · instant" accent="var(--clay)" />}
          signerNode={<FlowNode ic="lock" title="Keykeeper" sub="extension · holds key" accent="var(--clay)" big badge="Approve" />}
          keyLine={<>The secret key lives <b style={{ color: 'var(--ink)' }}>inside the browser add-on</b> on the computer where you installed it.</>}
          bullets={['Fast — approve with one click, right where you work', 'Nothing to set up beyond installing the add-on', 'Best when one person manages from one computer', 'Back up the key (12 words) in case that computer is lost']}
        />
        <CustodyCard
          title="Phone as bunker"
          sub="The key stays on your phone (NIP-46 “Nostr Connect”)."
          arrows={<FlowArrows topLabel="1 · sign request" botLabel="2 · signature" note="over a relay · like a push" accent="var(--clay)" />}
          signerNode={<FlowNode ic="qr" title="Your phone" sub="holds key · taps Approve" accent="var(--clay)" big badge="Approve" />}
          keyLine={<>The secret key <b style={{ color: 'var(--ink)' }}>never leaves your phone</b>. The console sends a request, your phone signs, and only the signature comes back.</>}
          bullets={['Log in to the console from ANY computer — no install', 'Approve on your phone like a 2-factor notification', 'Great when several staff share one console', 'The key is in exactly one place you carry with you']}
        />
      </div>

      <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
        <Icon name="shield" size={16} color="var(--sage)" /> Either way, TrinityOne’s servers never see the secret key — and you can switch methods later without re-minting the church.
      </div>
    </div>
  );
}

window.CustodyExplainer = CustodyExplainer;
