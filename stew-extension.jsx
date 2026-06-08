// stew-extension.jsx — browser-toolbar extension signer popup.
// Exports StewExtensionRequest, StewExtensionHome.

// faux browser toolbar with the extension icon highlighted, popup hanging below
function ExtFrame({ children, site = 'console.trinityone.app' }) {
  return (
    <div style={{ width: '100%', height: '100%', background: '#cdc7bb', position: 'relative', fontFamily: 'var(--font-ui)', overflow: 'hidden' }}>
      {/* toolbar */}
      <div style={{ height: 50, background: 'var(--surface-2)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px' }}>
        <Icon name="chevL" size={18} color="var(--ink-3)" />
        <Icon name="chevR" size={18} color="var(--ink-3)" />
        <Icon name="refresh" size={16} color="var(--ink-3)" />
        <div style={{ flex: 1, height: 30, borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px' }}>
          <Icon name="lock" size={13} color="var(--sage)" /><span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 600 }}>{site}</span>
        </div>
        {/* extension icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}><Icon name="bookmark" size={17} color="currentColor" /></div>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--surface)', border: '1.5px solid var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', boxShadow: 'var(--shadow-sm)' }}>
            <Halo size={20} color="var(--ink)" spark="var(--clay)" />
            <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: 'var(--clay)', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>1</span>
          </div>
        </div>
      </div>
      {/* page hint behind popup */}
      <div style={{ position: 'absolute', inset: '50px 0 0', padding: 24, opacity: .5 }}>
        <div style={{ height: 14, width: '40%', borderRadius: 7, background: 'rgba(0,0,0,.08)' }} />
        <div style={{ height: 10, width: '70%', borderRadius: 6, background: 'rgba(0,0,0,.06)', marginTop: 14 }} />
        <div style={{ height: 10, width: '60%', borderRadius: 6, background: 'rgba(0,0,0,.06)', marginTop: 10 }} />
      </div>
      {/* connector */}
      <div style={{ position: 'absolute', top: 44, right: 28, width: 12, height: 12, background: 'var(--surface)', border: '1px solid var(--line)', borderRight: 'none', borderBottom: 'none', transform: 'rotate(45deg)', zIndex: 11 }} />
      {/* popup */}
      <div style={{ position: 'absolute', top: 56, right: 14, width: 340, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: '0 18px 50px rgba(34,28,16,.28)', overflow: 'hidden', zIndex: 10 }}>
        {children}
      </div>
    </div>
  );
}

function ExtHeader({ locked = true }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
      <Halo size={24} color="var(--ink)" spark="var(--clay)" />
      <div style={{ flex: 1 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14.5 }}>Keykeeper</div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>TrinityOne signer</div></div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <SkBadge initials="GC" size={18} radius={6} /><span style={{ fontSize: 12, fontWeight: 700 }}>Grace Chapel</span>
        <Icon name={locked ? 'lock' : 'check'} size={13} color={locked ? 'var(--ink-3)' : 'var(--sage)'} />
      </div>
    </div>
  );
}

// ─── Signing request flow ───
function StewExtensionRequest() {
  const [signed, setSigned] = React.useState(false);
  const [showRaw, setShowRaw] = React.useState(false);
  return (
    <ExtFrame>
      <ExtHeader locked={false} />
      {!signed ? (
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: 'var(--clay)' }} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--clay-ink)' }}>Signature requested</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: '8px 0 0' }}><b style={{ color: 'var(--ink)' }}>{SK.request.site}</b> wants to sign an event as <b style={{ color: 'var(--ink)' }}>Grace Chapel</b>.</p>

          <div style={{ marginTop: 14, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 14px' }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--gold-tint)', color: '#8a6717', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="gift" size={19} color="currentColor" /></div>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{SK.request.action}</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{SK.request.target}</div></div>
            </div>
            <button onClick={() => setShowRaw(s => !s)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderTop: '1px solid var(--line)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-2)', fontWeight: 600, fontSize: 12 }}>
              <Icon name={showRaw ? 'chevD' : 'chevR'} size={14} color="var(--ink-3)" /> {showRaw ? 'Hide' : 'View'} event · kind {SK.request.kind}
            </button>
            {showRaw ? (
              <pre style={{ margin: 0, padding: '0 14px 13px', fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.7, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{`{
  "kind": ${SK.request.kind},
  "pubkey": "grace_npub…",
  "tags": [["d","${SK.request.d}"]],
  "content": "{…fund…}"
}`}</pre>
            ) : null}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 11.5, color: 'var(--ink-3)' }}>
            <Icon name="globe" size={14} color="var(--ink-3)" /> Will publish to {SK.request.relays} relays after signing
          </div>

          <div style={{ display: 'flex', gap: 9, marginTop: 14 }}>
            <button className="sk-btn sk-btn--ghost" style={{ flex: 1 }} onClick={() => {}}>Reject</button>
            <button className="sk-btn sk-btn--clay" style={{ flex: 1.4 }} onClick={() => setSigned(true)}><Icon name="key" size={16} color="#fff" /> Approve & sign</button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 13, fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer' }}>
            <span style={{ width: 34, height: 20, borderRadius: 999, background: 'var(--line)', position: 'relative', flexShrink: 0 }}><span style={{ position: 'absolute', top: 2, left: 2, width: 16, height: 16, borderRadius: 999, background: '#fff', boxShadow: 'var(--shadow-sm)' }} /></span>
            Auto-approve fund updates from this site
          </label>
        </div>
      ) : (
        <div style={{ padding: '28px 18px 22px', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--sage-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}><Icon name="check" size={28} stroke={2.6} color="var(--sage)" /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, marginTop: 14 }}>Signed & published</div>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: '6px 0 0' }}>Building Fund was signed by Grace Chapel and sent to {SK.request.relays} relays.</p>
          <button className="sk-btn sk-btn--ghost" style={{ marginTop: 16, width: '100%' }} onClick={() => setSigned(false)}>Done</button>
        </div>
      )}
    </ExtFrame>
  );
}

// ─── Unlock + key home ───
function StewExtensionHome() {
  const [unlocked, setUnlocked] = React.useState(false);
  return (
    <ExtFrame site="grace.org">
      <ExtHeader locked={!unlocked} />
      {!unlocked ? (
        <div style={{ padding: '26px 18px 22px', textAlign: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: 999, background: 'var(--clay-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}><Icon name="lock" size={24} color="var(--clay)" /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, marginTop: 12 }}>Unlock Keykeeper</div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '4px 0 0' }}>Enter your PIN to use the church key</p>
          <div style={{ display: 'flex', gap: 9, justifyContent: 'center', margin: '18px 0' }}>
            {[0, 1, 2, 3].map(i => <span key={i} style={{ width: 13, height: 13, borderRadius: 999, background: i < 4 ? 'var(--clay)' : 'var(--line)' }} />)}
          </div>
          <button className="sk-btn sk-btn--clay" style={{ width: '100%' }} onClick={() => setUnlocked(true)}>Unlock</button>
        </div>
      ) : (
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 9 }}>Church key</div>
          <SkKey value={SK.church.npub} label="npub" />
          <div style={{ marginTop: 8, display: 'flex', gap: 9, padding: '11px 13px', borderRadius: 11, background: 'color-mix(in oklab, var(--sage) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 24%, transparent)' }}>
            <Icon name="shield" size={16} color="var(--sage)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>Secret key stays in this add-on. Never typed into a website.</div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '16px 0 9px' }}>Connected</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="sliders" size={16} color="var(--clay)" /></div>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13 }}>Steward Console</div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>console.trinityone.app</div></div>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--sage)' }} />
          </div>

          <button className="sk-btn sk-btn--ghost" style={{ width: '100%', marginTop: 14 }} onClick={() => setUnlocked(false)}><Icon name="lock" size={15} color="currentColor" /> Lock</button>
        </div>
      )}
    </ExtFrame>
  );
}

window.StewExtensionRequest = StewExtensionRequest;
window.StewExtensionHome = StewExtensionHome;
