// screens-search.jsx — full-text search across the loaded module (+ Strong's lookup)
const { useState: useSrch } = React;

function SearchScreen({ ctx, onBack }) {
  const Bible = window.Bible;
  const qParam = new URLSearchParams(location.search).get('q') || '';
  const [q, setQ] = useSrch(qParam);
  const [active, setActive] = useSrch(qParam.trim());
  const versions = Bible.versions();
  const [ver, setVer] = useSrch(Bible.activeVersion);
  const run = (term) => { const t = term.trim(); setQ(t); setActive(t); };

  const isStrong = /^[GH]\d+$/i.test(active);
  const lexEntry = isStrong ? Bible.lex(active) : null;
  const hits = active && !isStrong ? Bible.search(active, 250, ver) : [];
  const seeds = ['light', 'love', 'God', 'beginning', 'life'];

  const hl = (text) => {
    if (!active) return text;
    try { return text.replace(new RegExp('(' + active.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'),
      '<mark style="background:var(--hl-yellow);color:inherit;border-radius:3px;padding:0 2px;">$1</mark>'); }
    catch (e) { return text; }
  };

  return (
    <ScreenScroll top={56}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 14px' }}>
        {onBack ? <IconBtn name="chevL" onClick={onBack} /> : null}
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, letterSpacing: '-.5px' }}>Search</h1>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 15px', height: 50, borderRadius: 16,
        background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', marginBottom: 18 }}>
        <Icon name="study" size={20} color="var(--ink-3)" />
        <input value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') run(q); }}
          placeholder="Search this translation, or a Strong's no…" style={{
            flex: 1, border: 'none', background: 'none', outline: 'none', fontSize: 16,
            fontFamily: 'var(--font-ui)', color: 'var(--ink)',
          }} />
        {q ? <button onClick={() => { setQ(''); setActive(''); }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="x" size={18} /></button> : null}
      </div>

      {versions.length > 1 ? (
        <div className="no-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '-6px -18px 16px', padding: '0 18px' }}>
          {versions.map(v => <Chip key={v.abbr} active={v.abbr === ver} onClick={() => setVer(v.abbr)}>{v.abbr}</Chip>)}
        </div>
      ) : null}

      {!active ? (
        <div style={{ animation: 'trinityFade .4s ease both' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 11 }}>TRY SEARCHING</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginBottom: 28 }}>
            {seeds.map(s => <Chip key={s} onClick={() => run(s)}>{s}</Chip>)}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 11 }}>SEARCHING IN</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 13, borderRadius: 16,
            background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <Icon name="read" size={20} color="var(--clay)" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{(versions.find(v => v.abbr === ver) || {}).name || 'Current translation'}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{Bible.books(ver).length} books · type a word or a Strong's number (e.g. G3056)</div>
            </div>
          </div>

          {/* reach the full eBible catalogue — search 1,000+ translations to install */}
          <button onClick={() => ctx.openStore('language', 'bibles')} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, marginTop: 12,
            padding: 13, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: 'color-mix(in oklab, var(--gold) 16%, var(--surface))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)' }}><Icon name="globe" size={20} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--ink)' }}>Search the catalogue</div>
              <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Find &amp; install from 1,000+ translations &amp; languages</div>
            </div>
            <Icon name="chevR" size={18} color="var(--ink-3)" />
          </button>
        </div>
      ) : (
        <div style={{ animation: 'trinityFade .4s ease both' }}>
          {lexEntry ? (
            <div onClick={() => ctx.openWord(active)} style={{
              borderRadius: 18, padding: 16, marginBottom: 18, cursor: 'pointer',
              background: 'var(--clay-soft)', border: '1px solid color-mix(in oklab, var(--clay) 25%, transparent)' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--clay-ink)', letterSpacing: '.5px' }}>LEXICON · STRONG'S {lexEntry.id}</div>
              {lexEntry.missing ? (
                <div style={{ fontSize: 14, color: 'var(--ink)', marginTop: 6, fontWeight: 500 }}>Tap for details — supplied by a dictionary module.</div>
              ) : (
                <React.Fragment>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
                    <span style={{ fontFamily: 'var(--font-read)', fontSize: 26, fontWeight: 500, color: 'var(--ink)' }}>{lexEntry.lemma}</span>
                    <span style={{ fontFamily: 'var(--font-read)', fontStyle: 'italic', color: 'var(--ink-2)' }}>{lexEntry.translit}</span>
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--ink)', marginTop: 4, fontWeight: 500 }}>{lexEntry.short}</div>
                </React.Fragment>
              )}
            </div>
          ) : (
            <React.Fragment>
              <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 18 }}>
                <b style={{ color: 'var(--ink)' }}>{hits.length}{hits.length >= 250 ? '+' : ''}</b> result{hits.length === 1 ? '' : 's'} for “<b style={{ color: 'var(--clay)' }}>{active}</b>”
              </div>
              {hits.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {hits.map((r, i) => (
                    <div key={i} onClick={() => ctx.gotoRef(r.book, r.chap, r.verse)} style={{
                      padding: 15, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', boxShadow: 'var(--shadow)' }}>
                      <div style={{ fontWeight: 700, color: 'var(--clay)', fontSize: 13.5, marginBottom: 4 }}>{r.ref}</div>
                      <p style={{ margin: 0, fontFamily: 'var(--font-read)', fontSize: 16.5, lineHeight: 1.5, color: 'var(--ink)', textWrap: 'pretty' }}
                        dangerouslySetInnerHTML={{ __html: window.sanitizeHtml(hl(r.text)) }} />
                    </div>
                  ))}
                </div>
              ) : (
                <React.Fragment>
                  <p style={{ color: 'var(--ink-2)', fontFamily: 'var(--font-read)', fontSize: 16.5, lineHeight: 1.55, marginBottom: 14 }}>
                    No verses in this translation match “{active}”. Try another word, switch translations in the reader, or add another from the catalogue.
                  </p>
                  <button onClick={() => ctx.openStore('language', 'bibles')} style={{ display: 'inline-flex', alignItems: 'center', gap: 9,
                    padding: '12px 16px', borderRadius: 14, border: 'none', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 14.5,
                    fontFamily: 'var(--font-ui)', cursor: 'pointer' }}>
                    <Icon name="globe" size={17} color="#fff" /> Search 1,000+ translations</button>
                </React.Fragment>
              )}
            </React.Fragment>
          )}
        </div>
      )}
    </ScreenScroll>
  );
}

window.SearchScreen = SearchScreen;
