// stew-phone.jsx — in-app light steward mode (phone). Exports StewPhone.

function PhoneFrame({ children }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(120% 80% at 50% 0%, var(--gold-tint), var(--paper) 60%)' }}>
      <div style={{ width: 318, height: 660, borderRadius: 46, padding: 7, background: 'linear-gradient(155deg,#2b2622,#0d0b09)', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ width: '100%', height: '100%', borderRadius: 40, overflow: 'hidden', background: 'var(--paper)', position: 'relative' }}>
          {/* status bar */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 22px', fontSize: 13, fontWeight: 700, zIndex: 5 }}>
            <span>9:41</span>
            <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <svg width="17" height="11" viewBox="0 0 17 11" fill="var(--ink)"><rect x="0" y="6" width="3" height="5" rx="1" /><rect x="4.5" y="4" width="3" height="7" rx="1" /><rect x="9" y="2" width="3" height="9" rx="1" /><rect x="13.5" y="0" width="3" height="11" rx="1" /></svg>
              <svg width="22" height="11" viewBox="0 0 22 11" fill="none"><rect x="1" y="1" width="18" height="9" rx="2.5" stroke="var(--ink)" strokeOpacity="0.5" /><rect x="2.5" y="2.5" width="13" height="6" rx="1.2" fill="var(--ink)" /><rect x="20" y="3.6" width="1.6" height="3.8" rx="1" fill="var(--ink)" fillOpacity="0.5" /></svg>
            </span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function StewPhone({ initial = 'home' }) {
  const [screen, setScreen] = React.useState(initial);
  return (
    <PhoneFrame>
      {screen === 'home' ? <PhoneHome onInvite={() => setScreen('invite')} /> : <PhoneInvite onBack={() => setScreen('home')} />}
    </PhoneFrame>
  );
}

function PhoneHome({ onInvite }) {
  return (
    <div style={{ position: 'absolute', inset: 0, paddingTop: 50, fontFamily: 'var(--font-ui)', overflow: 'hidden' }}>
      <div style={{ padding: '0 18px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* church pill + steward badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px 5px 5px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-sm)' }}>
            <SkBadge initials="GC" size={26} radius={8} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>Grace Chapel</span>
            <Icon name="chevD" size={14} color="var(--ink-3)" />
          </div>
          <div style={{ marginLeft: 'auto' }}><SkPill tint="clay">Steward</SkPill></div>
        </div>

        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 25, letterSpacing: '-.6px', marginTop: 18 }}>Steward tools</div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="lock" size={13} color="var(--ink-3)" /> Only you see this tab</div>

        {/* quick actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
          <button onClick={onInvite} style={{ gridColumn: '1 / 2', textAlign: 'left', border: 'none', cursor: 'pointer', borderRadius: 18, padding: 16, background: 'linear-gradient(155deg,var(--clay),var(--clay-deep))', color: '#fff', height: 124, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <Icon name="qr" size={26} color="#fff" />
            <div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>Show invite QR</div><div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>Add someone at the door</div></div>
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button style={{ flex: 1, textAlign: 'left', border: '1px solid var(--line)', cursor: 'pointer', borderRadius: 18, padding: '13px 15px', background: 'var(--gold-tint)', display: 'flex', alignItems: 'center', gap: 11 }}>
              <Icon name="send" size={20} color="#8a6717" /><div><div style={{ fontWeight: 700, fontSize: 14 }}>Post notice</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>to Announcements</div></div>
            </button>
            <button style={{ flex: 1, textAlign: 'left', border: '1px solid var(--line)', cursor: 'pointer', borderRadius: 18, padding: '13px 15px', background: 'var(--sage-soft)', display: 'flex', alignItems: 'center', gap: 11 }}>
              <Icon name="gift" size={20} color="#345c41" /><div><div style={{ fontWeight: 700, fontSize: 14 }}>Today’s giving</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>$840 · 12 gifts</div></div>
            </button>
          </div>
        </div>

        {/* today card */}
        <div style={{ marginTop: 12, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Today across 3 funds</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18 }}>$840</span>
          </div>
          <div style={{ marginTop: 12 }}><SkSpark data={SK.week.slice(2)} height={46} accent="var(--clay)" barW={14} /></div>
        </div>

        {/* needs a look */}
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '16px 2px 9px' }}>Needs a look</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--sage-soft)', color: '#345c41', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="pray" size={17} color="currentColor" /></div>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13.5 }}>New prayer request</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Prayer Wall · 14m ago</div></div>
            <Icon name="chevR" size={16} color="var(--ink-3)" />
          </div>
        </div>

        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8, padding: '10px 12px', marginBottom: 14, borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)', alignItems: 'center' }}>
          <Icon name="sliders" size={16} color="var(--ink-3)" />
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.4 }}>Funds, reports & relays live in the <b style={{ color: 'var(--ink)' }}>Steward Console</b> on the web.</div>
        </div>
      </div>
    </div>
  );
}

function PhoneInvite({ onBack }) {
  return (
    <div style={{ position: 'absolute', inset: 0, paddingTop: 50, fontFamily: 'var(--font-ui)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '0 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--ink-2)', fontWeight: 700, fontSize: 14, padding: 0 }}><Icon name="chevL" size={18} color="currentColor" /> Back</button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', textAlign: 'center' }}>
        <SkPill tint="clay">Invite a member</SkPill>
        <div style={{ width: 192, height: 192, borderRadius: 24, background: '#fff', boxShadow: 'var(--shadow-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '20px 0' }}><SkQR size={158} /></div>
        <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 28, letterSpacing: '3px' }}>GRACE-7K2</div>
        <p style={{ fontFamily: 'var(--font-read)', fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.5, margin: '12px 0 0', maxWidth: 240 }}>Have them open TrinityOne → <b style={{ color: 'var(--ink)' }}>Scan invite</b> and point their camera here. They’re in — anonymously.</p>
      </div>
      <div style={{ padding: '0 18px 22px', display: 'flex', gap: 10 }}>
        <button className="sk-btn sk-btn--clay" style={{ flex: 1 }}><Icon name="link" size={16} color="#fff" /> Share link</button>
        <button className="sk-btn sk-btn--ghost" style={{ flex: 1 }}><Icon name="receipt" size={16} color="currentColor" /> Print cards</button>
      </div>
    </div>
  );
}

window.StewPhone = StewPhone;
