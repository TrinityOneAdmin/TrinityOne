// screens-onboarding.jsx — first-run setup wizard (Welcome → Name → Back up 12 words → Done).
// Working basis; wired to the real identity layer. Elderly-first: large type, one idea per step,
// clear buttons. Claude Design will re-skin (see reference/brief-help-docs.md).
const { useState: useO, useEffect: useOE } = React;

// Halo mark (matches the boot splash)
function HaloMark({ size = 72 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <g fill="none" stroke="var(--ink)" strokeWidth="7" strokeLinecap="round">
        <path d="M81.2 67.9 A36 36 0 0 1 31.3 80.7" />
        <path d="M18.8 68.0 A36 36 0 0 1 32.7 18.4" />
        <path d="M49.9 14.0 A36 36 0 0 1 86.0 50.8" />
      </g>
      <circle cx="50" cy="50" r="6.5" fill="var(--gold)" />
    </svg>
  );
}
function Mono({ name, color, size = 88 }) {
  const word = (name || 'Anonymous').trim().split(' ').slice(-1)[0];
  return (
    <div style={{ width: size, height: size, borderRadius: 999, flexShrink: 0,
      background: `linear-gradient(150deg, ${color}, color-mix(in oklab, ${color} 60%, #16120c))`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
      fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: size * 0.42 }}>{(word[0] || '?').toUpperCase()}</div>
  );
}
function bigBtn(primary) {
  return { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
    padding: '16px', borderRadius: 16, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)',
    fontWeight: 700, fontSize: 16.5, background: primary ? 'var(--clay)' : 'var(--surface-2)',
    color: primary ? '#fff' : 'var(--ink)', boxShadow: primary ? 'var(--shadow)' : 'none' };
}
function textBtn() {
  return { width: '100%', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-2)',
    fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 14.5, padding: '12px' };
}

function Onboarding({ onDone, ctx }) {
  const stepParam = Math.min(3, Math.max(0, parseInt(new URLSearchParams(location.search).get('onbstep') || '0', 10) || 0));
  const [step, setStep] = useO(stepParam);  // 0 welcome · 1 name · 2 backup · 3 done
  const [name, setName] = useO('');
  const [av, setAv] = useO({ kind: 'symbol', color: '#5E8C6A', symbol: 'olive' });
  const [touchedAv, setTouchedAv] = useO(false);
  const [words, setWords] = useO(null);
  const [saved, setSaved] = useO(false);
  const [color, setColor] = useO('#5E8C6A');
  const [anonHandle, setAnonHandle] = useO('Anonymous');
  const steps = 4;

  useOE(() => {
    const ID = window.TrinityIdentity;
    if (ID && ID.ready) ID.ready.then(() => {
      const c = ID.current; if (c) { setColor(c.color || '#5E8C6A'); setAnonHandle(c.handle || 'Anonymous'); }
      if (stepParam === 2 && ID.exportMnemonic) ID.exportMnemonic().then(m => setWords(m ? m.split(' ') : []));
    });
  }, []);

  const reveal = async () => {
    const ID = window.TrinityIdentity;
    if (ID && ID.exportMnemonic) { const m = await ID.exportMnemonic(); setWords(m ? m.split(' ') : []); }
  };
  const finish = async () => {
    // publish a profile if they chose a name or deliberately picked a mark; pure-anonymous
    // users (no name, untouched avatar) get a deterministic symbol with no kind-0 broadcast.
    try {
      if ((name.trim() || touchedAv) && window.Fellowship) {
        await window.Fellowship.ready;
        await window.Fellowship.setProfile({ name: name.trim(), av });
      }
    } catch (e) {}
    try { localStorage.setItem('trinityone.onboarded', 'true'); if (saved) localStorage.setItem('trinityone.backedup', 'true'); } catch (e) {}
    onDone();
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 58, background: 'var(--paper)', color: 'var(--ink)',
      display: 'flex', flexDirection: 'column', padding: '54px 24px 26px', animation: 'trinityFade .4s ease both' }}>
      {/* progress dots */}
      <div style={{ display: 'flex', gap: 7, justifyContent: 'center', marginBottom: 18 }}>
        {Array.from({ length: steps }).map((_, i) => (
          <div key={i} style={{ width: i === step ? 22 : 7, height: 7, borderRadius: 999, transition: 'all .25s',
            background: i <= step ? 'var(--clay)' : 'var(--line)' }} />
        ))}
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto' }}>
        {step === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}><HaloMark size={92} /></div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, margin: '0 0 12px', letterSpacing: '-.5px' }}>Welcome to TrinityOne</h1>
            <p style={{ fontFamily: 'var(--font-read)', fontSize: 18, lineHeight: 1.6, color: 'var(--ink-2)', margin: '0 auto', maxWidth: 320, textWrap: 'pretty' }}>
              Read the Bible, gather with your church, and share — privately. There's <b style={{ color: 'var(--ink)' }}>no account and no password</b> to remember. Just a couple of quick steps.
            </p>
          </div>
        )}

        {step === 1 && (
          <div style={{ paddingTop: 8 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, margin: '0 0 8px' }}>What should your church call you?</h1>
            <p style={{ fontSize: 16, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 0 22px' }}>Use your name so your church family recognises you. It’s all anyone sees — <b style={{ color: 'var(--ink)' }}>never</b> your phone number or email. You can change it any time.</p>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="e.g. Maria" autoFocus
              style={{ width: '100%', boxSizing: 'border-box', height: 56, padding: '0 18px', borderRadius: 16, textAlign: 'center', marginBottom: 22,
                border: '1.5px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 19, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }} />
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 14px' }}>CHOOSE YOUR MARK</div>
            <AvatarPicker value={av} name={name} onChange={(next) => { setAv(next); setTouchedAv(true); }} />
          </div>
        )}

        {step === 2 && (
          <div style={{ paddingTop: 4 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, margin: '0 0 10px' }}>Back up your 12 words</h1>
            <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', background: 'color-mix(in oklab, var(--clay) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 28%, transparent)', borderRadius: 16, padding: '14px 16px', marginBottom: 18 }}>
              <Icon name="lock" size={22} color="var(--clay-ink)" />
              <div style={{ fontSize: 15, color: 'var(--clay-ink)', lineHeight: 1.5, fontWeight: 600 }}>
                These 12 words are the <b>only</b> way to get your account back if you lose your phone. No one can reset it for you. Write them on paper and keep them safe — never photograph or share them.
              </div>
            </div>
            {!words ? (
              <button onClick={reveal} style={bigBtn(true)}><Icon name="key" size={19} color="#fff" /> Show my 12 words</button>
            ) : words.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 15, padding: 20 }}>No phrase on this device yet (web preview uses a temporary key — on a phone these are real).</div>
            ) : (
              <React.Fragment>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginBottom: 16 }}>
                  {words.map((w, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', width: 18 }}>{i + 1}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 15.5, color: 'var(--ink)' }}>{w}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => setSaved(s => !s)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px', borderRadius: 14,
                  border: saved ? '1.5px solid var(--sage)' : '1.5px solid var(--line)', background: saved ? 'color-mix(in oklab, var(--sage) 12%, var(--surface))' : 'var(--surface)', cursor: 'pointer', color: 'var(--ink)', textAlign: 'left' }}>
                  <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, background: saved ? 'var(--sage)' : 'transparent', border: saved ? 'none' : '2px solid var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {saved ? <Icon name="check" size={16} stroke={2.6} color="#fff" /> : null}</div>
                  <span style={{ fontWeight: 700, fontSize: 15.5 }}>I've written them down on paper</span>
                </button>
              </React.Fragment>
            )}
          </div>
        )}

        {step === 3 && (
          <div style={{ textAlign: 'center', paddingTop: 28 }}>
            <div style={{ width: 84, height: 84, borderRadius: 999, background: 'color-mix(in oklab, var(--sage) 18%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <Icon name="check" size={44} stroke={2.6} color="var(--sage)" />
            </div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, margin: '0 0 10px' }}>You're all set{name.trim() ? ', ' + name.trim() : ''}</h1>
            <p style={{ fontSize: 17, lineHeight: 1.6, color: 'var(--ink-2)', margin: '0 auto', maxWidth: 320 }}>
              You can start reading right away. Find help and your recovery words any time under your profile.
            </p>
          </div>
        )}
      </div>

      {/* footer actions */}
      <div style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {step === 0 && <button onClick={() => setStep(1)} style={bigBtn(true)}>Get started</button>}
        {step === 1 && <React.Fragment>
          <button onClick={() => setStep(2)} style={bigBtn(true)}>Continue</button>
          <button onClick={() => { setName(''); setStep(2); }} style={textBtn()}>Skip — stay private for now</button>
        </React.Fragment>}
        {step === 2 && <React.Fragment>
          <button onClick={() => setStep(3)} disabled={!saved} style={{ ...bigBtn(true), opacity: saved ? 1 : .5 }}>Continue</button>
          <button onClick={() => setStep(3)} style={textBtn()}>I'll do this later</button>
        </React.Fragment>}
        {step === 3 && <button onClick={finish} style={bigBtn(true)}>Start</button>}
      </div>
    </div>
  );
}

window.Onboarding = Onboarding;
