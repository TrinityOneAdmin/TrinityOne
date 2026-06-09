// stew-console.jsx — desktop Steward Console: StewWizard + StewDashboard
// Exports to window: StewWizard, StewDashboard

// ── console container (real app -- the fake browser chrome only shows in ?showcase mode) ──
function ConsoleChrome({ children, bg = 'var(--paper)', showcase = false, url = 'console.trinityone.app' }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: bg, fontFamily: 'var(--font-ui)' }}>
      {showcase ? (
        <div style={{ height: 46, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: 999, background: '#E06C5B' }} />
            <span style={{ width: 12, height: 12, borderRadius: 999, background: '#E0B860' }} />
            <span style={{ width: 12, height: 12, borderRadius: 999, background: '#5E8C6A' }} />
          </div>
          <div style={{ flex: 1, maxWidth: 520, margin: '0 auto', height: 28, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
            <Icon name="lock" size={13} color="var(--sage)" />
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 600 }}>{url}</span>
          </div>
          <div style={{ width: 52 }} />
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>{children}</div>
    </div>
  );
}

// ════════════════════════════ WIZARD ════════════════════════════
const WIZ_STEPS = [
  { key: 'key', t: 'Create your church key', ic: 'key' },
  { key: 'identity', t: 'Name & verify', ic: 'shield' },
  { key: 'fund', t: 'Your first fund', ic: 'gift' },
  { key: 'relays', t: 'Choose your relays', ic: 'globe' },
  { key: 'invite', t: 'Invite your people', ic: 'qr' },
];

function StewWizard() {
  const [step, setStep] = React.useState(0);
  const [custody, setCustody] = React.useState('extension');
  const [verified, setVerified] = React.useState(false);
  const [fundCustody, setFundCustody] = React.useState('strike');
  const [ownRelay, setOwnRelay] = React.useState(false);
  const last = step === WIZ_STEPS.length - 1;

  return (
    <ConsoleChrome>
      <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
        {/* rail */}
        <div style={{ width: 296, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--surface)', padding: '34px 28px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 30 }}>
            <Halo size={30} color="var(--ink)" spark="var(--clay)" />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19, letterSpacing: '-.3px' }}>Trinity<span style={{ color: 'var(--clay)' }}>One</span></span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.7px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 18 }}>Start a church</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {WIZ_STEPS.map((s, i) => {
              const done = i < step, active = i === step;
              return (
                <button key={s.key} onClick={() => setStep(i)} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '11px 12px', borderRadius: 12, border: 'none', cursor: 'pointer', textAlign: 'left', background: active ? 'color-mix(in oklab, var(--clay) 9%, var(--surface))' : 'transparent' }}>
                  <div style={{ width: 30, height: 30, borderRadius: 999, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13.5, fontFamily: 'var(--font-display)',
                    background: done ? 'var(--sage)' : active ? 'var(--clay)' : 'var(--surface-2)', color: done || active ? '#fff' : 'var(--ink-3)', border: done || active ? 'none' : '1px solid var(--line)' }}>
                    {done ? <Icon name="check" size={16} stroke={2.6} color="#fff" /> : i + 1}
                  </div>
                  <span style={{ fontSize: 14.5, fontWeight: active ? 700 : 600, color: active ? 'var(--ink)' : done ? 'var(--ink-2)' : 'var(--ink-3)' }}>{s.t}</span>
                </button>
              );
            })}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            <Icon name="shield" size={15} color="var(--sage)" /> Takes about 10 minutes. Nothing is published until you’re ready.
          </div>
        </div>

        {/* body */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: '40px 48px' }}>
            <div style={{ maxWidth: 560 }}>
              <SkPill tint={last ? 'sage' : 'clay'}>Step {step + 1} of {WIZ_STEPS.length}</SkPill>
              <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 34, letterSpacing: '-1px', margin: '16px 0 0', lineHeight: 1.05 }}>{WIZ_STEPS[step].t}</h1>
              {step === 0 && <WizKey custody={custody} setCustody={setCustody} />}
              {step === 1 && <WizIdentity verified={verified} setVerified={setVerified} />}
              {step === 2 && <WizFund fundCustody={fundCustody} setFundCustody={setFundCustody} />}
              {step === 3 && <WizRelays ownRelay={ownRelay} setOwnRelay={setOwnRelay} />}
              {step === 4 && <WizInvite />}
            </div>
          </div>
          {/* footer */}
          <div style={{ flexShrink: 0, height: 78, borderTop: '1px solid var(--line)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 48px' }}>
            <button className="sk-btn sk-btn--ghost" onClick={() => setStep(s => Math.max(0, s - 1))} style={{ visibility: step === 0 ? 'hidden' : 'visible' }}>
              <Icon name="chevL" size={16} color="currentColor" /> Back
            </button>
            {last ? (
              <button className="sk-btn sk-btn--clay" onClick={() => setStep(0)}>Open Steward Console <Icon name="chevR" size={16} color="#fff" /></button>
            ) : (
              <button className="sk-btn sk-btn--clay" onClick={() => setStep(s => s + 1)}>Continue <Icon name="chevR" size={16} color="#fff" /></button>
            )}
          </div>
        </div>
      </div>
    </ConsoleChrome>
  );
}

function WizKey({ custody, setCustody }) {
  const church = window.useStewardChurch ? window.useStewardChurch() : { name: '', npub: '' };
  const name = church.name || 'Your church';
  const initials = (church.name ? church.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'TO').toUpperCase();
  return (
    <div style={{ marginTop: 18 }}>
      <p style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>This mints your church’s identity on Nostr. Every group and notice gets <b style={{ color: 'var(--ink)' }}>signed</b> by it — so members can trust a message is really from you.</p>
      <div style={{ marginTop: 22, borderRadius: 18, padding: 24, background: 'linear-gradient(160deg, var(--midnight-2), var(--midnight))', color: 'var(--paper)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SkBadge initials={initials} size={42} />
          <div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>{name}</div><div style={{ fontSize: 12.5, opacity: .6 }}>Public church key</div></div>
          <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--sage-soft)' }}><span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--sage)' }} /> Generated</div>
        </div>
        <div onClick={() => { try { navigator.clipboard.writeText(church.npub || ''); } catch {} }} style={{ cursor: 'pointer', marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 11, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)' }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.5px', color: 'var(--gold-soft)', background: 'rgba(224,184,96,.16)', padding: '3px 7px', borderRadius: 6 }}>NPUB</span>
          <span style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 13, opacity: .85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{church.npub || '—'}</span>
          <Icon name="copy" size={16} color="rgba(255,255,255,.5)" />
        </div>
      </div>
      <div style={{ marginTop: 24, fontSize: 12.5, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 12 }}>Where should the secret key live?</div>
      <SkToggle value={custody} onChange={setCustody} options={[{ value: 'extension', label: 'Browser extension', icon: 'lock' }, { value: 'phone', label: 'This phone (NIP-46)', icon: 'qr' }]} />
      <div style={{ display: 'flex', gap: 10, marginTop: 14, padding: 14, borderRadius: 13, background: 'color-mix(in oklab, var(--sage) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 26%, transparent)' }}>
        <Icon name="shield" size={18} color="var(--sage)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>{custody === 'extension'
          ? <>The <b style={{ color: 'var(--ink)' }}>TrinityOne Keykeeper</b> add-on holds your secret key on this computer and signs when you click Approve. The key never reaches our servers.</>
          : <>Your secret key stays on your <b style={{ color: 'var(--ink)' }}>phone</b>. The console asks it to sign and you approve on the phone — like a 2-factor prompt. Sign in from any computer.</>}</div>
      </div>
    </div>
  );
}

function WizIdentity({ verified, setVerified }) {
  return (
    <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <p style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>This is what members see when they follow you. Claiming a verified name (NIP-05) puts a ✓ next to your church.</p>
      <SkField label="Church name" value="Grace Chapel" />
      <SkField label="Verified name · NIP-05" value="grace.org" hint={verified ? null : 'We’ll check for a small file at grace.org/.well-known/nostr.json'}
        accessory={verified
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--sage)' }}><Icon name="check" size={16} stroke={2.6} color="var(--sage)" /> Verified</span>
          : <button onClick={() => setVerified(true)} style={{ border: 'none', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 13, padding: '8px 14px', borderRadius: 9, cursor: 'pointer' }}>Verify</button>} />
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 9 }}>Accent</div>
        <div style={{ display: 'flex', gap: 10 }}>
          {['var(--clay)', 'var(--sage)', 'var(--gold)', '#5b6ea8', '#8a5ba8'].map((c, i) => (
            <div key={i} style={{ width: 36, height: 36, borderRadius: 11, background: c, cursor: 'pointer', boxShadow: i === 0 ? '0 0 0 2.5px var(--paper), 0 0 0 4.5px var(--clay)' : 'none' }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function WizFund({ fundCustody, setFundCustody }) {
  return (
    <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <p style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>A fund is a signed pointer to where giving lands. Start with your general offering — you can add Building, Missions and more anytime.</p>
      <SkField label="Fund name" value="General Tithes & Offerings" />
      <SkField label="Lightning address" value="grace@strike.me" mono accessory={<Icon name="bolt" size={16} fill color="var(--gold)" />} />
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 9 }}>Custody — where the money settles</div>
        <SkToggle value={fundCustody} onChange={setFundCustody} options={[{ value: 'strike', label: 'Custodial · Strike', icon: 'wallet' }, { value: 'node', label: 'Self-hosted node', icon: 'bank' }]} />
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 10, lineHeight: 1.5 }}>{fundCustody === 'strike' ? 'Easiest to start — Strike holds and converts to your bank. Switch to self-custody later without members noticing.' : 'Full sovereignty — funds land on your own Lightning node (LND, Core Lightning, LNbits).'}</div>
      </div>
    </div>
  );
}

function WizRelays({ ownRelay, setOwnRelay }) {
  return (
    <div style={{ marginTop: 18 }}>
      <p style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>Relays store and serve your church’s signed events. Your church already hosts its own — every message and member lives on infrastructure you control.</p>
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(window.Steward && window.Steward.relayList ? window.Steward.relayList() : []).map(url => (
          <div key={url} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 13, background: 'var(--surface)', border: '1px solid var(--line)' }}>
            <Icon name="globe" size={18} color="var(--sage)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Your relay · self-hosted</div>
            </div>
            <SkPill tint="clay">Yours</SkPill>
            <div style={{ width: 40, height: 24, borderRadius: 999, background: 'var(--sage)', position: 'relative' }}><span style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: 999, background: '#fff' }} /></div>
          </div>
        ))}
      </div>
      {!ownRelay ? (
        <button onClick={() => setOwnRelay(true)} style={{ width: '100%', marginTop: 12, padding: 14, borderRadius: 13, border: '1px dashed var(--line)', background: 'var(--surface-2)', color: 'var(--ink)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, fontFamily: 'var(--font-ui)' }}>
          <Icon name="plus" size={17} color="var(--clay)" /> Run your own relay
        </button>
      ) : (
        <div style={{ marginTop: 12, display: 'flex', gap: 10, padding: 13, borderRadius: 13, background: 'color-mix(in oklab, var(--sage) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 26%, transparent)' }}>
          <Icon name="check" size={18} stroke={2.4} color="var(--sage)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>You’re hosting your own relay. The <b style={{ color: 'var(--ink)' }}>TrinityOne Relay</b> app runs on any Mac, Windows or Linux machine — it does the rest, no command line.</div>
        </div>
      )}
    </div>
  );
}

function WizInvite() {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, color: 'var(--sage)', fontWeight: 700, fontSize: 15 }}><Icon name="check" size={18} stroke={2.6} color="var(--sage)" /> Grace Chapel is live on Nostr</div>
      <p style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.6, margin: '8px 0 0' }}>Hand this code or QR to your people. One scan follows your church and pulls in funds and groups — anonymously.</p>
      <div style={{ marginTop: 22, display: 'flex', gap: 22, alignItems: 'center', padding: 24, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ width: 132, height: 132, borderRadius: 16, background: '#fff', boxShadow: 'var(--shadow-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><SkQR size={108} /></div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Joining code</div>
          <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 32, letterSpacing: '2px', margin: '4px 0 3px' }}>GRACE-7K2</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 600 }}>grace.org · 312 will be invited</div>
          <div style={{ display: 'flex', gap: 9, marginTop: 16 }}>
            <button className="sk-btn sk-btn--clay" style={{ padding: '9px 14px', fontSize: 13 }}><Icon name="link" size={15} color="#fff" /> Copy link</button>
            <button className="sk-btn sk-btn--ghost" style={{ padding: '9px 14px', fontSize: 13 }}><Icon name="receipt" size={15} color="currentColor" /> Print cards</button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.StewWizard = StewWizard;
window.ConsoleChrome = ConsoleChrome;
