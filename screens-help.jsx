// screens-help.jsx — in-app Help: index, article template, backup walkthrough.
// Accessibility-first: larger-text stepper, read-aloud, big targets, linear nav.
const { useState: useH, useEffect: useHE, useRef: useHR } = React;

// ── read-aloud hook (browser speech; gracefully no-ops if unavailable) ──
function useReadAloud() {
  const [speaking, setSpeaking] = useH(false);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const stop = () => { if (supported) window.speechSynthesis.cancel(); setSpeaking(false); };
  const speak = (text) => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92; u.pitch = 1; u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false);
    setSpeaking(true); window.speechSynthesis.speak(u);
  };
  useHE(() => () => { if (supported) window.speechSynthesis.cancel(); }, []);
  return { speaking, speak, stop, supported };
}

// ── larger-text stepper ──
function TextSizeStepper({ scale, setScale }) {
  const steps = [1, 1.16, 1.34];
  const i = steps.indexOf(scale) < 0 ? 0 : steps.indexOf(scale);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, padding: 3, boxShadow: 'var(--shadow)' }}>
      {steps.map((st, k) => (
        <button key={k} onClick={() => setScale(st)} aria-label={`Text size ${k + 1}`} style={{
          width: 32, height: 30, borderRadius: 999, border: 'none', cursor: 'pointer',
          background: i === k ? 'var(--clay)' : 'transparent', color: i === k ? '#fff' : 'var(--ink-2)',
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11 + k * 3, lineHeight: 1,
        }}>A</button>
      ))}
    </div>
  );
}

// ── article block renderer ──
function Block({ b, fs }) {
  const body = { fontFamily: 'var(--font-read)', fontSize: 18 * fs, lineHeight: 1.62, color: 'var(--ink)', textWrap: 'pretty' };
  if (b.type === 'p') return <p style={{ ...body, margin: '0 0 16px' }}>{b.text}</p>;

  if (b.type === 'list') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, margin: '4px 0 18px' }}>
      {b.items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 12 }}>
          <div style={{ width: 12, height: 12, borderRadius: 999, background: 'var(--clay-soft)', border: '2px solid var(--clay)', flexShrink: 0, marginTop: 8 * fs }} />
          <div><span style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 16.5 * fs, color: 'var(--ink)' }}>{it.lead} </span>
            <span style={{ ...body, fontSize: 16.5 * fs }}>{it.text}</span></div>
        </div>
      ))}
    </div>
  );

  if (b.type === 'steps') return (
    <div style={{ margin: '6px 0 20px' }}>
      {b.label ? <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 13 * fs, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--clay)', marginBottom: 12 }}>{b.label}</div> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {b.items.map((it, i) => (
          <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: '14px 16px', boxShadow: 'var(--shadow)' }}>
            <div style={{ width: 32 * fs, height: 32 * fs, borderRadius: 999, background: 'var(--clay)', color: '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 * fs }}>{i + 1}</div>
            <div style={{ ...body, fontSize: 17 * fs, paddingTop: 3 }}>{it}</div>
          </div>
        ))}
      </div>
    </div>
  );

  if (b.type === 'dont' || b.type === 'do') {
    const isDont = b.type === 'dont';
    return (
      <div style={{ margin: '6px 0 20px', borderRadius: 18, padding: '16px 18px',
        background: isDont ? 'color-mix(in oklab, var(--clay) 8%, var(--surface))' : 'color-mix(in oklab, var(--sage) 10%, var(--surface))',
        border: `1px solid ${isDont ? 'color-mix(in oklab, var(--clay) 28%, transparent)' : 'color-mix(in oklab, var(--sage) 30%, transparent)'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 * fs, color: isDont ? 'var(--clay-ink)' : 'var(--sage)', marginBottom: 12 }}>
          <Icon name={isDont ? 'x' : 'check'} size={20 * fs} stroke={2.6} /> {isDont ? 'Please don’t' : 'Do'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {b.items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <Icon name={isDont ? 'x' : 'check'} size={17 * fs} stroke={2.6} color={isDont ? 'var(--clay)' : 'var(--sage)'} style={{ flexShrink: 0, marginTop: 4 }} />
              <span style={{ ...body, fontSize: 16.5 * fs }}>{it}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (b.type === 'callout' || b.type === 'note') {
    const toneMap = { clay: 'var(--clay)', gold: 'var(--gold)', sage: 'var(--sage)' };
    const c = toneMap[b.tone] || 'var(--ink-3)';
    return (
      <div style={{ margin: '6px 0 18px', borderRadius: 18, padding: '16px 18px', display: 'flex', gap: 13,
        background: b.type === 'note' ? 'var(--surface-2)' : `color-mix(in oklab, ${c} 11%, var(--surface))`,
        border: `1px solid ${b.type === 'note' ? 'var(--line)' : `color-mix(in oklab, ${c} 28%, transparent)`}` }}>
        <Icon name={b.type === 'note' ? 'note' : 'sparkle'} size={20 * fs} color={b.type === 'note' ? 'var(--ink-3)' : c} style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ ...body, fontSize: 16.5 * fs, margin: 0 }}>{b.text}</p>
      </div>
    );
  }

  if (b.type === 'rule') return (
    <div style={{ margin: '8px 0 18px', borderRadius: 18, padding: '18px 20px', background: 'var(--ink)', color: 'var(--paper)', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -16, bottom: -20, opacity: .12 }}><Halo size={92} color="var(--paper)" spark="var(--gold)" /></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 12 * fs, letterSpacing: '1px', textTransform: 'uppercase', opacity: .7, marginBottom: 8 }}>
        <Halo size={16 * fs} color="var(--paper)" spark="var(--gold)" /> Simple rule</div>
      <p style={{ fontFamily: 'var(--font-read)', fontSize: 19 * fs, lineHeight: 1.5, margin: 0, fontWeight: 500, position: 'relative' }}>{b.text}</p>
    </div>
  );
  return null;
}

// flatten an article into a read-aloud string
function articleToSpeech(a) {
  let parts = [a.title + '. ' + a.summary + '. '];
  a.blocks.forEach(b => {
    if (b.type === 'p' || b.type === 'rule' || b.type === 'callout' || b.type === 'note') parts.push(b.text);
    if (b.type === 'list') b.items.forEach(it => parts.push(it.lead + '. ' + it.text));
    if (b.type === 'steps') { if (b.label) parts.push(b.label); b.items.forEach((it, i) => parts.push((i + 1) + '. ' + it)); }
    if (b.type === 'dont') { parts.push('Please don’t.'); b.items.forEach(it => parts.push(it)); }
    if (b.type === 'do') { parts.push('Do.'); b.items.forEach(it => parts.push(it)); }
  });
  return parts.join(' ');
}

window.HelpBlock = Block;
window.useReadAloud = useReadAloud;
window.TextSizeStepper = TextSizeStepper;
window.articleToSpeech = articleToSpeech;
