// stew-console.jsx — desktop Steward Console: StewWizard + StewDashboard
// Exports to window: StewWizard, StewDashboard

// ── console container (real app -- the fake browser chrome only shows in ?showcase mode) ──
function ConsoleChrome({ children, bg = 'var(--paper)', showcase = false, url = 'console.trinityone.app', accentStyle }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: bg, fontFamily: 'var(--font-ui)', ...(accentStyle || {}) }}>
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
  { key: 'identity', t: 'Name your church', ic: 'shield' },
  { key: 'relays', t: 'Choose your relays', ic: 'globe' },
  { key: 'invite', t: 'Invite your people', ic: 'qr' },
];   // giving/funds parked until after the pilot — payments aren't surfaced yet

// editable text field for the wizard (the design-mock SkField is read-only)
function WizInput({ label, value, onChange, placeholder, hint, mono, autoFocus }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        spellCheck={mono ? false : undefined} autoCapitalize={mono ? 'none' : undefined}
        style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontFamily: mono ? 'var(--mono)' : 'var(--font-ui)', fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
      {hint ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 7, lineHeight: 1.5 }}>{hint}</div> : null}
    </label>
  );
}

function StewWizard({ onDone }) {
  const church = window.useStewardChurch ? window.useStewardChurch() : { name: '', npub: '' };
  const [step, setStep] = React.useState(0);
  const [name, setName] = React.useState(church.name || '');
  const [nip05, setNip05] = React.useState('');
  const [ownRelay, setOwnRelay] = React.useState(false);
  const last = step === WIZ_STEPS.length - 1;
  // responsive: a phone/narrow window swaps the 296px step-rail for a compact top progress bar
  const [vw, setVw] = React.useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  React.useEffect(() => { const f = () => setVw(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const narrow = vw < 760;
  // publish the church's profile when leaving the identity step, so its name resolves for members
  const publishIdentity = () => {
    if (window.Steward && window.Steward.publishProfile) {
      window.Steward.publishProfile({ name: (name || '').trim() || 'Our Church', nip05: (nip05 || '').trim() });
    }
  };
  const goNext = () => { if (WIZ_STEPS[step].key === 'identity') publishIdentity(); setStep(s => s + 1); };
  const finish = () => { if (onDone) onDone(); else setStep(0); };

  return (
    <ConsoleChrome>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: narrow ? 'column' : 'row' }}>
        {/* mobile: compact top bar with a step-progress indicator (replaces the rail) */}
        {narrow ? (
          <div style={{ flexShrink: 0, borderBottom: '1px solid var(--line)', background: 'var(--surface)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Halo size={22} color="var(--ink)" spark="var(--clay)" />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15 }}>Trinity<span style={{ color: 'var(--clay)' }}>One</span></span>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {WIZ_STEPS.map((s, i) => <div key={s.key} style={{ width: i === step ? 18 : 7, height: 7, borderRadius: 999, background: i < step ? 'var(--sage)' : i === step ? 'var(--clay)' : 'var(--surface-2)', border: i > step ? '1px solid var(--line)' : 'none', transition: 'width .2s' }} />)}
            </div>
          </div>
        ) : null}
        {/* rail (desktop) */}
        {!narrow ? (
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
        ) : null}

        {/* body */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: narrow ? '22px 18px 28px' : '40px 48px' }}>
            <div style={{ maxWidth: 560 }}>
              <SkPill tint={last ? 'sage' : 'clay'}>Step {step + 1} of {WIZ_STEPS.length}</SkPill>
              <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: narrow ? 25 : 34, letterSpacing: '-1px', margin: '14px 0 0', lineHeight: 1.06 }}>{WIZ_STEPS[step].t}</h1>
              {step === 0 && <WizKey />}
              {step === 1 && <WizIdentity name={name} setName={setName} nip05={nip05} setNip05={setNip05} />}
              {step === 2 && <WizRelays ownRelay={ownRelay} setOwnRelay={setOwnRelay} />}
              {step === 3 && <WizInvite />}
            </div>
          </div>
          {/* footer */}
          <div style={{ flexShrink: 0, height: 72, borderTop: '1px solid var(--line)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: narrow ? '0 18px' : '0 48px' }}>
            <button className="sk-btn sk-btn--ghost" onClick={() => setStep(s => Math.max(0, s - 1))} style={{ visibility: step === 0 ? 'hidden' : 'visible' }}>
              <Icon name="chevL" size={16} color="currentColor" /> Back
            </button>
            {last ? (
              <button className="sk-btn sk-btn--clay" onClick={finish}>Open Steward Console <Icon name="chevR" size={16} color="#fff" /></button>
            ) : (
              <button className="sk-btn sk-btn--clay" onClick={goNext}>Continue <Icon name="chevR" size={16} color="#fff" /></button>
            )}
          </div>
        </div>
      </div>
    </ConsoleChrome>
  );
}

function WizBackup() {
  const [shown, setShown] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const phrase = (window.Steward && window.Steward.exportMnemonic && window.Steward.exportMnemonic()) || '';
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 12 }}>Back up your recovery phrase</div>
      <div style={{ display: 'flex', gap: 10, padding: 14, borderRadius: 13, background: 'color-mix(in oklab, var(--gold) 10%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 30%, transparent)' }}>
        <Icon name="key" size={18} color="#8a6717" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>These 12 words <b style={{ color: 'var(--ink)' }}>are</b> your church — the only way to recover this identity on another device. Write them down and keep them safe. There’s no reset.</div>
      </div>
      {!shown ? (
        <button onClick={() => setShown(true)} className="sk-btn sk-btn--ghost" style={{ marginTop: 12, padding: '10px 14px', fontSize: 13.5 }}><Icon name="lock" size={15} color="currentColor" /> Reveal recovery phrase</button>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {words.map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 11px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 700, width: 16 }}>{i + 1}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13.5, fontWeight: 600 }}>{w}</span>
              </div>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, cursor: 'pointer', fontSize: 13.5, color: 'var(--ink-2)', fontWeight: 600 }}>
            <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} /> I’ve written these down somewhere safe
          </label>
        </div>
      )}
    </div>
  );
}

function WizKey() {
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
      <WizBackup />
    </div>
  );
}

function WizIdentity({ name, setName, nip05, setNip05 }) {
  return (
    <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <p style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>This is what members see when they follow you. You can change it later from Settings.</p>
      <WizInput label="Church name" value={name} onChange={setName} placeholder="Your church’s name" autoFocus />
      <WizInput label="Verified name · NIP-05 (optional)" value={nip05} onChange={setNip05} placeholder="yourchurch.org" mono
        hint="Optional — adds a ✓ next to your name if you host a small verification file. Leave blank for now if you’re not sure." />
    </div>
  );
}

function WizRelays({ ownRelay, setOwnRelay }) {
  return (
    <div style={{ marginTop: 18 }}>
      <p style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>Relays store and serve your church’s signed events. Your church runs on the shared <b style={{ color: 'var(--ink)' }}>TrinityOne community nodes</b> by default — nothing to set up, and if one’s down the others carry on.</p>
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(window.Steward && window.Steward.relayList ? window.Steward.relayList() : []).map(url => {
          const own = window.Steward && window.Steward.extraRelays && window.Steward.extraRelays().includes(url);
          return (
          <div key={url} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 13, background: 'var(--surface)', border: '1px solid var(--line)' }}>
            <Icon name="globe" size={18} color="var(--sage)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{own ? 'Your relay · self-hosted' : 'TrinityOne community node'}</div>
            </div>
            <SkPill tint={own ? 'clay' : 'sage'}>{own ? 'Yours' : 'Community'}</SkPill>
            <div style={{ width: 40, height: 24, borderRadius: 999, background: 'var(--sage)', position: 'relative' }}><span style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: 999, background: '#fff' }} /></div>
          </div>
          );
        })}
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
  const church = window.useStewardChurch ? window.useStewardChurch() : { name: '' };
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, color: 'var(--sage)', fontWeight: 700, fontSize: 15 }}><Icon name="check" size={18} stroke={2.6} color="var(--sage)" /> {church.name || 'Your church'} is live on Nostr</div>
      <p style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.6, margin: '8px 0 0' }}>Hand this code or QR to your people. One scan follows your church and pulls in your groups — anonymously.</p>
      <div style={{ marginTop: 22, padding: 24, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-sm)' }}>
        {window.JoinCard ? <JoinCard qrSize={120} /> : <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Your join code appears here once the console finishes loading.</div>}
      </div>
    </div>
  );
}

window.StewWizard = StewWizard;
window.ConsoleChrome = ConsoleChrome;
