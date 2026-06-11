// screens-help-main.jsx — HelpCenter overlay (index + article + backup walkthrough)
const { useState: useHm, useEffect: useHmE, useRef: useHmR } = React;

// ════ Backup walkthrough: intro → write → confirm → verify → done ════
function BackupWalkthrough({ onClose, onComplete, ctx, fs = 1 }) {
  const [words, setWords] = useHm(null);            // real recovery phrase (loaded from secure store)
  const [step, setStep] = useHm(0); // 0 intro, 1 words, 2 confirm, 3 verify, 4 done
  const [checkN, setCheckN] = useHm(0);
  const [picked, setPicked] = useHm(null);
  const options = useHmR(null);

  useHmE(() => {
    let live = true;
    const set = (arr) => { if (!live) return; setWords(arr); if (arr.length) setCheckN(1 + Math.floor(Math.random() * arr.length)); };
    const ID = window.TrinityIdentity;
    if (ID && ID.exportMnemonic) ID.exportMnemonic().then(m => set(m ? m.split(' ') : [])); else set([]);
    return () => { live = false; };
  }, []);

  if (!words || !checkN) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper)' }}>
        <div style={{ width: 26, height: 26, borderRadius: 999, border: '3px solid var(--clay-soft)', borderTopColor: 'var(--clay)', animation: 'trinitySpin .8s linear infinite' }} />
      </div>
    );
  }
  if (!options.current) {
    const correct = words[checkN - 1];
    const pool = words.filter(w => w !== correct);
    const decoys = [];
    while (decoys.length < 2 && pool.length) { const k = Math.floor(Math.random() * pool.length); decoys.push(pool.splice(k, 1)[0]); }
    options.current = [correct, ...decoys].sort(() => Math.random() - 0.5);
  }

  const big = { fontFamily: 'var(--font-read)', fontSize: 19 * fs, lineHeight: 1.55, color: 'var(--ink-2)', textWrap: 'pretty' };
  const H = ({ children }) => <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 27 * fs, fontWeight: 700, letterSpacing: '-.4px', margin: '0 0 10px', lineHeight: 1.12 }}>{children}</h1>;

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
      <div style={{ paddingTop: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '50px 16px 6px' }}>
        <IconBtn name={step === 0 ? 'x' : 'chevL'} onClick={() => step === 0 ? onClose() : setStep(s => Math.max(0, s - 1))} />
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 1, 2, 3].map(i => <div key={i} style={{ width: step > i ? 22 : 8, height: 8, borderRadius: 999, background: step > i ? 'var(--clay)' : 'var(--line)', transition: 'all .3s' }} />)}
        </div>
        <div style={{ width: 40 }} />
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '10px 24px 16px' }}>
        {step === 0 && (
          <div style={{ textAlign: 'center', animation: 'lumenFade .4s ease both' }}>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '18px 0 18px' }}><HelpIllo name="paper" size={150} tone="var(--clay)" /></div>
            <H>Let’s back up your 12 words</H>
            <p style={{ ...big, margin: '0 auto', maxWidth: 320 }}>This takes two minutes and only needs doing once. You’ll need a pen and a piece of paper.</p>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, marginTop: 22, background: 'var(--gold-tint)', color: '#7a5c14', padding: '12px 18px', borderRadius: 999, fontWeight: 700, fontSize: 15 * fs }}>
              <Icon name="check" size={18} stroke={2.4} /> Got a pen and paper? Let’s go.</div>
          </div>
        )}

        {step === 1 && (
          <div style={{ animation: 'lumenFade .4s ease both' }}>
            <H>Write these down, in order</H>
            <p style={{ ...big, margin: '0 0 16px' }}>Copy all 12 onto your paper, top to bottom. Take your time.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              {words.map((w, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px', borderRadius: 13, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 13 * fs, color: 'var(--clay)', fontWeight: 700, width: 18 }}>{i + 1}</span>
                  <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 17 * fs, color: 'var(--ink)' }}>{w}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 16, color: 'var(--ink-3)', fontSize: 14 * fs, justifyContent: 'center' }}>
              <Icon name="x" size={16} color="var(--clay)" stroke={2.4} /> Don’t screenshot — write on paper.
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ textAlign: 'center', animation: 'lumenFade .4s ease both' }}>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '18px 0 18px' }}><HelpIllo name="safe" size={150} tone="var(--sage)" soft="var(--sage-soft)" /></div>
            <H>Have you written<br/>them all down?</H>
            <p style={{ ...big, margin: '0 auto', maxWidth: 320 }}>Check your paper has all 12 words, spelled correctly and in order, before you carry on.</p>
          </div>
        )}

        {step === 3 && (
          <div style={{ animation: 'lumenFade .4s ease both' }}>
            <H>One quick check</H>
            <p style={{ ...big, margin: '0 0 22px' }}>Look at your paper. Which word did you write as number <b style={{ color: 'var(--clay)' }}>{checkN}</b>?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {options.current.map(w => {
                const correct = w === words[checkN - 1];
                const chosen = picked === w;
                const show = picked != null;
                return (
                  <button key={w} disabled={show} onClick={() => { setPicked(w); if (correct) setTimeout(() => setStep(4), 700); }} style={{
                    padding: '16px 18px', borderRadius: 16, cursor: show ? 'default' : 'pointer', textAlign: 'left',
                    fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 18 * fs,
                    border: chosen ? `2px solid ${correct ? 'var(--sage)' : 'var(--clay)'}` : '1px solid var(--line)',
                    background: chosen ? (correct ? 'color-mix(in oklab, var(--sage) 14%, var(--surface))' : 'color-mix(in oklab, var(--clay) 12%, var(--surface))') : 'var(--surface)',
                    color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: 'var(--shadow)',
                  }}>{w}{chosen ? <Icon name={correct ? 'check' : 'x'} size={20} stroke={2.6} color={correct ? 'var(--sage)' : 'var(--clay)'} /> : null}</button>
                );
              })}
            </div>
            {picked != null && picked !== words[checkN - 1] ? (
              <p style={{ textAlign: 'center', color: 'var(--clay-ink)', fontWeight: 600, fontSize: 15 * fs, marginTop: 16 }}>Not quite — check your paper and tap the right word.</p>
            ) : null}
          </div>
        )}

        {step === 4 && (
          <div style={{ textAlign: 'center', animation: 'lumenScale .4s ease both' }}>
            <div style={{ width: 92, height: 92, borderRadius: 999, background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '30px auto 22px' }}>
              <Icon name="check" size={50} stroke={2.6} color="var(--sage)" /></div>
            <H>That’s the most<br/>important bit done</H>
            <p style={{ ...big, margin: '0 auto', maxWidth: 320 }}>Your 12 words are safely on paper. Keep it somewhere safe at home — and you’re protected, even if you lose your phone.</p>
          </div>
        )}
      </div>

      {/* footer */}
      <div style={{ padding: '12px 24px 26px', borderTop: '1px solid var(--line-2)' }}>
        {step < 3 ? (
          <button onClick={() => setStep(s => s + 1)} style={helpPrimaryBtn(fs)}>{step === 0 ? 'Start' : step === 1 ? 'I’ve written them down' : 'Yes, all 12 are on paper'}</button>
        ) : step === 4 ? (
          <button onClick={() => { onComplete && onComplete(); onClose(); }} style={helpPrimaryBtn(fs)}>Done</button>
        ) : <div style={{ height: 4 }} />}
      </div>
    </div>
  );
}
function helpPrimaryBtn(fs) {
  return { width: '100%', padding: 17, borderRadius: 16, border: 'none', cursor: 'pointer', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 17 * fs, fontFamily: 'var(--font-ui)' };
}

// ════ Help Center (index ↔ article ↔ backup) ════
function HelpCenter({ open, onClose, initial, ctx }) {
  const D = window.HelpData;
  const [view, setView] = useHm('index'); // 'index' | articleId | 'backup'
  const [scale, setScale] = useHm(() => { try { return parseFloat(localStorage.getItem('to_help_scale')) || 1; } catch (e) { return 1; } });
  const ra = useReadAloud();
  const scrollRef = useHmR(null);

  useHmE(() => { if (open) { setView(initial || 'index'); } else { ra.stop(); } }, [open, initial]);
  useHmE(() => { try { localStorage.setItem('to_help_scale', String(scale)); } catch (e) {} }, [scale]);
  useHmE(() => { ra.stop(); if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [view]);

  const setScaleP = (s) => setScale(s);
  const article = D.articles.find(a => a.id === view);

  return (
    <Overlay open={open} onClose={onClose}>
      {view === 'backup' ? (
        <BackupWalkthrough fs={scale} ctx={ctx} onClose={() => setView('index')} onComplete={() => ctx.toast('Recovery phrase backed up')} />
      ) : (
        <React.Fragment>
          {/* header */}
          <div style={{ paddingTop: 50, background: 'color-mix(in oklab, var(--paper) 90%, transparent)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--line-2)', position: 'relative', zIndex: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 14px 11px' }}>
              {view === 'index'
                ? <IconBtn name="chevD" onClick={onClose} />
                : <button onClick={() => setView('index')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 13, padding: '9px 14px 9px 11px', cursor: 'pointer', color: 'var(--ink)', fontWeight: 700, fontSize: 14.5, fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)' }}><Icon name="chevL" size={18} /> Help</button>}
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap' }}>{view === 'index' ? 'Help & Guides' : ''}</span>
              <TextSizeStepper scale={scale} setScale={setScaleP} />
            </div>
          </div>

          <div ref={scrollRef} className="no-scrollbar" style={{ flex: 1, overflowY: 'auto' }}>
            {view === 'index' ? <HelpIndex D={D} fs={scale} onOpen={setView} onBackup={() => setView('backup')} ctx={ctx} />
              : <HelpArticleView a={article} fs={scale} ra={ra} onBackup={() => setView('backup')} ctx={ctx} />}
          </div>
        </React.Fragment>
      )}
    </Overlay>
  );
}

// ── index ──
function HelpIndex({ D, fs, onOpen, onBackup, ctx }) {
  const hero = D.articles.find(a => a.id === 'words');
  const rest = D.articles.filter(a => a.id !== 'words');
  return (
    <div style={{ padding: '18px 18px 36px' }}>
      <p style={{ fontFamily: 'var(--font-read)', fontSize: 17 * fs, lineHeight: 1.5, color: 'var(--ink-2)', margin: '0 0 20px', textWrap: 'pretty' }}>{D.intro}</p>

      {/* recovery hero */}
      <div onClick={onBackup} style={{ position: 'relative', overflow: 'hidden', borderRadius: 24, cursor: 'pointer', marginBottom: 14, background: 'linear-gradient(155deg, var(--clay), var(--clay-deep))', color: '#fff', boxShadow: 'var(--shadow-lg)', padding: '22px 22px 20px' }}>
        <div style={{ position: 'absolute', right: -10, bottom: -16, opacity: .9 }}><HelpIllo name="paper" size={150} tone="rgba(255,255,255,.5)" soft="rgba(255,255,255,.16)" /></div>
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,.2)', padding: '5px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase' }}>
            <Icon name="sparkle" size={14} stroke={2} color="#fff" /> Start here</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26 * fs, fontWeight: 700, margin: '12px 0 6px', letterSpacing: '-.4px', maxWidth: 210 }}>Back up your 12 words</h2>
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 16 * fs, lineHeight: 1.45, margin: '0 0 16px', maxWidth: 220, opacity: .95 }}>The one thing that must not be missed. We’ll walk you through it.</p>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', color: 'var(--clay-ink)', padding: '11px 18px', borderRadius: 13, fontWeight: 800, fontSize: 15 * fs }}>
            Begin backup <Icon name="chevR" size={17} stroke={2.4} color="var(--clay-ink)" /></span>
        </div>
      </div>

      {/* read the full guide */}
      <button onClick={() => onOpen('words')} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', padding: '13px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 14.5 * fs, fontFamily: 'var(--font-ui)', cursor: 'pointer', boxShadow: 'var(--shadow)', marginBottom: 26 }}>
        <Icon name="book" size={18} color="var(--clay)" /> Read the full guide first</button>

      {/* topics */}
      <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 12.5, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 4px 12px' }}>All topics</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rest.map(a => (
          <button key={a.id} onClick={() => onOpen(a.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 18, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', textAlign: 'left', boxShadow: 'var(--shadow)' }}>
            <div style={{ width: 56, height: 56, borderRadius: 15, background: 'var(--surface-2)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <HelpIllo name={a.illo} size={42} tone="var(--clay)" /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16.5 * fs, color: 'var(--ink)' }}>{a.title}</span>
                {a.soon ? <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.4px', color: 'var(--gold)', background: 'var(--gold-tint)', padding: '2px 7px', borderRadius: 999 }}>SOON</span> : null}
              </div>
              <div style={{ fontFamily: 'var(--font-read)', fontSize: 14.5 * fs, color: 'var(--ink-2)', marginTop: 2, lineHeight: 1.4 }}>{a.summary}</div>
            </div>
            <Icon name="chevR" size={20} color="var(--ink-3)" />
          </button>
        ))}
      </div>

      {/* printable card */}
      <div style={{ marginTop: 24, borderRadius: 18, border: '1px dashed var(--line)', background: 'var(--surface-2)', padding: 16, display: 'flex', alignItems: 'center', gap: 13 }}>
        <Icon name="receipt" size={26} color="var(--ink-2)" />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 * fs }}>Printable card</div>
          <div style={{ fontSize: 13 * fs, color: 'var(--ink-2)' }}>A one-page reminder to keep at home.</div>
        </div>
        <button onClick={() => ctx.toast('Opening printable card…')} style={{ border: 'none', background: 'var(--ink)', color: 'var(--paper)', padding: '10px 15px', borderRadius: 12, fontWeight: 700, fontSize: 13.5 * fs, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Print</button>
      </div>
    </div>
  );
}

// ── article view ──
function HelpArticleView({ a, fs, ra, onBackup, ctx }) {
  if (!a) return null;
  const isWords = a.id === 'words';
  return (
    <div style={{ padding: '20px 20px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
        <div style={{ width: 92, height: 92, borderRadius: 24, background: a.star ? 'var(--clay-soft)' : 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)' }}>
          <HelpIllo name={a.illo} size={66} tone="var(--clay)" /></div>
      </div>
      {a.star ? <div style={{ textAlign: 'center', marginBottom: 8 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--gold-tint)', color: '#7a5c14', padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 800, letterSpacing: '.4px' }}><Icon name="sparkle" size={13} stroke={2} /> MOST IMPORTANT</span></div> : null}
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 30 * fs, fontWeight: 700, letterSpacing: '-.5px', textAlign: 'center', margin: '4px 0 10px', lineHeight: 1.08 }}>{a.title}</h1>
      <p style={{ fontFamily: 'var(--font-read)', fontSize: 18.5 * fs, lineHeight: 1.5, color: 'var(--ink-2)', textAlign: 'center', margin: '0 auto 18px', maxWidth: 340, textWrap: 'pretty' }}>{a.summary}</p>

      {/* listen */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
        <button onClick={() => ra.speaking ? ra.stop() : ra.speak(articleToSpeech(a))} style={{
          display: 'inline-flex', alignItems: 'center', gap: 9, padding: '11px 20px', borderRadius: 999,
          border: '1px solid var(--line)', background: ra.speaking ? 'var(--clay)' : 'var(--surface)', color: ra.speaking ? '#fff' : 'var(--ink)',
          fontWeight: 700, fontSize: 15 * fs, fontFamily: 'var(--font-ui)', cursor: 'pointer', boxShadow: 'var(--shadow)' }}>
          <Icon name={ra.speaking ? 'x' : 'headphones'} size={19} color={ra.speaking ? '#fff' : 'var(--clay)'} /> {ra.speaking ? 'Stop' : 'Listen to this page'}</button>
      </div>

      <div style={{ height: 1, background: 'var(--line)', margin: '0 0 22px' }} />

      {a.blocks.map((b, i) => <HelpBlock key={i} b={b} fs={fs} />)}

      {isWords ? (
        <button onClick={onBackup} style={{ width: '100%', marginTop: 8, padding: 17, borderRadius: 16, border: 'none', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 17 * fs, fontFamily: 'var(--font-ui)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
          <Halo size={20} color="#fff" spark="var(--gold-soft)" /> Back up my 12 words now</button>
      ) : null}
    </div>
  );
}

window.HelpCenter = HelpCenter;
window.BackupWalkthrough = BackupWalkthrough;

// ════ First-run backup nudge (gentle, skippable) ════
function BackupNudge({ open, onClose, onBackup }) {
  if (!open) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 68, display: 'flex', alignItems: 'flex-end', animation: 'lumenFade .3s ease both' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(20,14,8,.42)' }} />
      <div style={{ position: 'relative', width: '100%', background: 'var(--surface)', borderRadius: '30px 30px 0 0', padding: '12px 24px 26px', boxShadow: '0 -10px 40px rgba(20,14,8,.22)', animation: 'lumenRise .4s cubic-bezier(.32,.72,0,1) both' }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 6px' }}>
          <div style={{ width: 38, height: 5, borderRadius: 3, background: 'var(--ink-3)', opacity: .4 }} />
        </div>
        <div style={{ textAlign: 'center', paddingTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><HelpIllo name="paper" size={120} tone="var(--clay)" /></div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 25, fontWeight: 700, letterSpacing: '-.4px', margin: '0 0 8px', lineHeight: 1.12 }}>One last thing —<br/>let’s keep you safe</h1>
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 17, lineHeight: 1.5, color: 'var(--ink-2)', margin: '0 auto 4px', maxWidth: 320, textWrap: 'pretty' }}>
            Your account has no password. Writing down your <b style={{ color: 'var(--ink)' }}>12 words</b> is the one thing that keeps it yours. It takes two minutes.</p>
        </div>
        <button onClick={onBackup} style={{ width: '100%', marginTop: 20, padding: 17, borderRadius: 16, border: 'none', cursor: 'pointer', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 16.5, fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
          <Halo size={20} color="#fff" spark="var(--gold-soft)" /> Back up my 12 words</button>
        <button onClick={onClose} style={{ width: '100%', marginTop: 10, padding: 13, borderRadius: 14, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-2)', fontWeight: 600, fontSize: 14.5, fontFamily: 'var(--font-ui)' }}>I’ll do this later</button>
        <p style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--ink-3)', margin: '8px 0 0' }}>You can back up any time from Help.</p>
      </div>
    </div>
  );
}
window.BackupNudge = BackupNudge;
