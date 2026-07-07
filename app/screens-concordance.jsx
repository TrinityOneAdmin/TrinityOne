// screens-concordance.jsx — Concordance index + per-word "All uses" page
const { useState: useCon } = React;

function hiText(text, terms) {
  if (!terms || !terms.length) return text;
  const safe = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`\\b(${safe.join('|')})\\b`, 'gi');
  return text.replace(re, '<mark style="background:var(--hl-yellow);color:inherit;border-radius:3px;padding:0 2px;font-weight:600;">$1</mark>');
}

// ── per-word concordance: every use of one lemma ──
function AllUsesView({ id, open, onClose, ctx }) {
  const D = window.TrinityData;
  const [q, setQ] = useCon('');
  React.useEffect(() => { if (open) setQ(''); }, [open, id]);
  const e = id ? D.LEXICON[id] : null;
  const con = id ? D.CONCORDANCE[id] : null;
  if (!e || !con) return null;

  const ql = q.trim().toLowerCase();
  const uses = ql ? con.uses.filter(u => (u.ref + ' ' + u.text).toLowerCase().includes(ql)) : con.uses;

  return (
    <Overlay open={open} onClose={onClose}>
      {/* header */}
      <div style={{ paddingTop: 50, flexShrink: 0, background: 'var(--clay-soft)', borderBottom: '1px solid color-mix(in oklab, var(--clay) 20%, transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 16px 4px' }}>
          <IconBtn name="chevL" onClick={onClose} />
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--clay-ink)', letterSpacing: '.5px' }}>STRONG'S {id} · {e.pos.includes('Greek') || true ? 'GREEK' : ''}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 2 }}>
              <span style={{ fontFamily: 'var(--font-read)', fontSize: 30, fontWeight: 500, color: 'var(--ink)', lineHeight: 1 }}>{e.lemma}</span>
              <span style={{ fontFamily: 'var(--font-read)', fontStyle: 'italic', fontSize: 16, color: 'var(--ink-2)' }}>{e.translit}</span>
            </div>
          </div>
        </div>
        <div style={{ padding: '6px 16px 13px' }}>
          <div style={{ fontSize: 13.5, color: 'var(--ink)', fontWeight: 600, marginBottom: 2 }}>{e.short}</div>
          <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', fontWeight: 700 }}>Showing {con.uses.length} of {e.occ} occurrences</div>
        </div>
      </div>

      {/* search-within */}
      <div style={{ flexShrink: 0, padding: '12px 16px 6px', background: 'var(--paper)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 42, padding: '0 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <Icon name="study" size={17} color="var(--ink-3)" />
          <input value={q} onChange={ev => setQ(ev.target.value)} placeholder="Filter these uses…" style={{
            flex: 1, minWidth: 0, border: 'none', background: 'none', outline: 'none', fontSize: 14.5, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }} />
          {q ? <button onClick={() => setQ('')} aria-label="Clear" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 2 }}><Icon name="x" size={16} /></button> : null}
        </div>
      </div>

      {/* list */}
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 30px', background: 'var(--paper)' }}>
        {uses.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '44px 20px', color: 'var(--ink-3)' }}>
            <Icon name="study" size={28} color="var(--ink-3)" />
            <p style={{ margin: '12px 0 0', fontSize: 14.5 }}>No uses match “{q}”</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {uses.map((u, i) => (
              <div key={i} onClick={() => { onClose(); setTimeout(() => ctx.openReader(), 200); ctx.toast('Jumping to ' + u.ref); }} style={{
                padding: 15, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', boxShadow: 'var(--shadow)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontWeight: 700, color: 'var(--clay)', fontSize: 13.5 }}>{u.ref}</span>
                  <Icon name="chevR" size={16} color="var(--ink-3)" />
                </div>
                <p style={{ margin: 0, fontFamily: 'var(--font-read)', fontSize: 16.5, lineHeight: 1.5, color: 'var(--ink)', textWrap: 'pretty' }}
                  dangerouslySetInnerHTML={{ __html: window.sanitizeHtml(hiText(u.text, con.en)) }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Overlay>
  );
}

// ── concordance index: browse every key word ──
function ConcordanceIndex({ open, onClose, ctx }) {
  const D = window.TrinityData;
  const [q, setQ] = useCon('');
  React.useEffect(() => { if (open) setQ(''); }, [open]);
  const ids = Object.keys(D.LEXICON);
  const ql = q.trim().toLowerCase();
  const shown = ql ? ids.filter(id => {
    const e = D.LEXICON[id];
    return (e.lemma + ' ' + e.translit + ' ' + e.short + ' ' + id).toLowerCase().includes(ql);
  }) : ids;

  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, flexShrink: 0, background: 'color-mix(in oklab, var(--paper) 92%, transparent)', borderBottom: '1px solid var(--line-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 12px' }}>
          <IconBtn name="chevL" onClick={onClose} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700, letterSpacing: '-.4px', lineHeight: 1.1 }}>Concordance</h1>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 1 }}>Strong's · {ids.length} key words</div>
          </div>
          <div style={{ width: 40, height: 40, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'color-mix(in oklab, var(--gold) 16%, var(--surface))', color: '#8a6717' }}><Icon name="lex" size={22} stroke={1.8} /></div>
        </div>
        <div style={{ padding: '0 16px 13px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 42, padding: '0 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <Icon name="study" size={17} color="var(--ink-3)" />
            <input value={q} onChange={ev => setQ(ev.target.value)} placeholder="Search words — light, grace, λόγος…" style={{
              flex: 1, minWidth: 0, border: 'none', background: 'none', outline: 'none', fontSize: 14.5, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }} />
            {q ? <button onClick={() => setQ('')} aria-label="Clear" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 2 }}><Icon name="x" size={16} /></button> : null}
          </div>
        </div>
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 30px' }}>
        {shown.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--ink-3)' }}>
            <Icon name="study" size={30} color="var(--ink-3)" />
            <p style={{ margin: '12px 0 0', fontSize: 14.5 }}>No words match “{q}”</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {shown.map(id => {
              const e = D.LEXICON[id];
              return (
                <div key={id} onClick={() => ctx.openAllUses(id)} style={{
                  display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 16,
                  background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', boxShadow: 'var(--shadow)' }}>
                  <div style={{ width: 48, height: 48, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--clay-soft)' }}>
                    <span style={{ fontFamily: 'var(--font-read)', fontSize: 22, fontWeight: 500, color: 'var(--clay-ink)' }}>{e.lemma}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5, color: 'var(--ink)' }}>{e.translit}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 600 }}>{id}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.short}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--clay)' }}>{e.occ}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 600 }}>uses</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Overlay>
  );
}

Object.assign(window, { AllUsesView, ConcordanceIndex });
