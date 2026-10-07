// screens-search.jsx — full-text search across the loaded module + installed dictionary definitions (+ Strong's lookup)
const { useState: useSrch } = React;

function SearchScreen({ ctx, onBack }) {
  const Bible = window.Bible;
  const qParam = new URLSearchParams(location.search).get('q') || '';
  const [q, setQ] = useSrch(qParam || (window.__lastSearch || ''));
  const [active, setActive] = useSrch(qParam.trim() || (window.__lastSearch || ''));
  const versions = Bible.versions();
  const [ver, setVer] = useSrch(Bible.activeVersion);
  const run = (term) => { const t = term.trim(); setQ(t); setActive(t); setTab('all'); window.__lastSearch = t; };

  const isStrong = /^[GH]\d+$/i.test(active);
  const lexEntry = isStrong ? Bible.lex(active) : null;
  // perf #7: memoize the full-corpus LIKE scan (~31k verses) — it re-ran on every keystroke of the box AND every
  // background App re-render once a term was active. Now it runs only when the term or the version changes,
  // or when a module is installed or removed (modTick, below) — which is rare and has to invalidate it.
  // A MODULE UNINSTALLED WHILE RESULTS ARE ON SCREEN HAS TO TAKE ITS RESULTS WITH IT. Both memos below hold
  // a COPY of what the engine returned, and neither dependency list mentions the module store — so a
  // dictionary removed from the Library went on showing definitions read out of bytes that had just been
  // deleted, and verses kept coming from a translation that is no longer on the phone. Same stale-copy shape
  // as the reader's notes panel. engine.js notify()s on every install and every removal; a tick in the deps
  // is what makes these two recompute then, and only then.
  const [modTick, setModTick] = useSrch(0);
  React.useEffect(() => Bible.subscribe(() => setModTick(t => t + 1)), []);
  const hits = React.useMemo(() => active && !isStrong ? Bible.search(active, 250, ver) : [], [active, ver, modTick]);
  // free-text search also scans installed dictionary/lexicon DEFINITIONS (guard in case an older cached engine has no searchDict)
  const dictHits = React.useMemo(() => active && !isStrong && Bible.searchDict ? Bible.searchDict(active, 24) : [], [active, modTick]);
  const [tab, setTab] = useSrch('all');
  const [wordId, setWordId] = useSrch(null);
  const seeds = ['light', 'love', 'God', 'beginning', 'life'];

  const hl = (text) => {
    if (!active) return text;
    try { return text.replace(new RegExp('(' + active.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'),
      '<mark style="background:var(--hl-yellow);color:inherit;border-radius:3px;padding:0 2px;">$1</mark>'); }
    catch (e) { return text; }
  };

  return (
    <React.Fragment>
    <ScreenScroll top="calc(env(safe-area-inset-top, 0px) + 8px)">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 14px' }}>
        {onBack ? <IconBtn name="chevL" onClick={onBack} /> : null}
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, letterSpacing: '-.5px' }}>Search</h1>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 15px', height: 50, borderRadius: 16,
        background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', marginBottom: 18 }}>
        <Icon name="search" size={20} color="var(--ink-3)" />
        <input value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') run(q); }}
          placeholder="Search verses &amp; definitions, or a Strong's no…" style={{
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
            <div onClick={() => setWordId(active)} style={{
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
              {dictHits.length && hits.length ? (
                <div className="no-scrollbar" style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: 12, border: '1px solid var(--line)', overflow: 'hidden' }}>
                  {[['words', 'Words · ' + dictHits.length], ['verses', 'Verses · ' + hits.length + (hits.length >= 250 ? '+' : '')]].map(([k, label]) => (
                    <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                      fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5,
                      background: tab === k ? 'var(--clay)' : 'var(--surface)', color: tab === k ? 'var(--on-clay)' : 'var(--ink-2)' }}>{label}</button>
                  ))}
                </div>
              ) : null}
              {(tab !== 'verses' && dictHits.length) ? (
                <div style={{ marginBottom: 22 }}>
                  {!(dictHits.length && hits.length) ? <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--clay-ink)', letterSpacing: '.5px', marginBottom: 10 }}>DICTIONARY · {dictHits.length}{dictHits.length >= 24 ? '+' : ''} match{dictHits.length === 1 ? '' : 'es'}</div> : null}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {dictHits.map(d => {
                      const strong = /^[GH]\d+$/i.test(d.id);
                      return (
                        <div key={d.id} onClick={() => { if (strong) setWordId(d.id); else run(d.lemma || d.id); }} style={{
                          padding: '13px 15px', borderRadius: 15, background: 'var(--surface)', border: '1px solid var(--line)',
                          boxShadow: 'var(--shadow)', cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'var(--font-read)', fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>{d.lemma || d.id}</span>
                            {d.translit ? <span style={{ fontFamily: 'var(--font-read)', fontStyle: 'italic', fontSize: 14, color: 'var(--ink-2)' }}>{d.translit}</span> : null}
                            {strong ? <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--clay-ink)', background: 'var(--clay-soft)', padding: '2px 8px', borderRadius: 999 }}>{d.id}</span> : null}
                          </div>
                          {(d.short || d.gloss) ? <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 4, lineHeight: 1.45 }}>{d.short || d.gloss}</div> : null}
                          <div style={{ fontSize: 12, color: 'var(--clay)', fontWeight: 600, marginTop: 6 }}>{strong ? 'Tap for full definition' : 'Tap to search verses'} →</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {tab !== 'words' ? (
                <React.Fragment>
                  <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 18 }}>
                    <b style={{ color: 'var(--ink)' }}>{hits.length}{hits.length >= 250 ? '+' : ''}</b> result{hits.length === 1 ? '' : 's'} for "<b style={{ color: 'var(--clay)' }}>{active}</b>"
                  </div>
                  {hits.length ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                      {hits.map((r, i) => (
                        <div key={i} onClick={() => { if (onBack) onBack(); ctx.gotoRef(r.book, r.chap, r.verse); }} style={{
                          padding: 15, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', boxShadow: 'var(--shadow)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ fontWeight: 700, color: 'var(--clay)', fontSize: 13.5 }}>{r.ref}</div>
                            <Icon name="chevR" size={14} color="var(--clay)" style={{ marginLeft: 'auto', flexShrink: 0 }} />
                          </div>
                          <p style={{ margin: '4px 0 0', fontFamily: 'var(--font-read)', fontSize: 16.5, lineHeight: 1.5, color: 'var(--ink)', textWrap: 'pretty' }}
                            dangerouslySetInnerHTML={{ __html: window.sanitizeHtml(hl(r.text)) }} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <React.Fragment>
                      <p style={{ color: 'var(--ink-2)', fontFamily: 'var(--font-read)', fontSize: 16.5, lineHeight: 1.55, marginBottom: 14 }}>
                        No verses in this translation match "{active}". Try another word, switch translations in the reader, or add another from the catalogue.
                      </p>
                      <button onClick={() => ctx.openStore('language', 'bibles')} style={{ display: 'inline-flex', alignItems: 'center', gap: 9,
                        padding: '12px 16px', borderRadius: 14, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', fontWeight: 700, fontSize: 14.5,
                        fontFamily: 'var(--font-ui)', cursor: 'pointer' }}>
                        <Icon name="globe" size={17} color="#fff" /> Search 1,000+ translations</button>
                    </React.Fragment>
                  )}
                </React.Fragment>
              ) : null}
            </React.Fragment>
          )}
        </div>
      )}
    </ScreenScroll>
      {wordId ? (function() {
        var e = window.Bible.lex(wordId);
        if (!e) return null;
        var closeWord = function() { setWordId(null); };
        var followWord = function(wid) { setWordId(wid); };
        return (
          <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column' }}>
            <div onClick={closeWord} style={{ flex: '0 0 auto', minHeight: 60, background: 'rgba(20,15,10,.25)' }} />
            <div className="search-word-panel" style={{ flex: 1, minHeight: 0, background: 'var(--surface)', borderRadius: '18px 18px 0 0',
              boxShadow: '0 -10px 40px rgba(20,14,8,.22)', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}
              onTouchStart={function(ev) { var t = ev.currentTarget; t._sy = ev.touches[0].clientY; var sc = t.querySelector('.search-word-scroll'); t._st = sc ? sc.scrollTop : 0; }}
              onTouchMove={function(ev) { var t = ev.currentTarget; var dy = ev.touches[0].clientY - (t._sy || 0); var sc = t.querySelector('.search-word-scroll'); var st = sc ? sc.scrollTop : 0; if (dy > 0 && st <= 0) { ev.preventDefault(); t.style.transform = 'translateY(' + dy + 'px)'; t.style.transition = 'none'; } }}
              onTouchEnd={function(ev) { var t = ev.currentTarget; var raw = t.style.transform.match(/translateY\((\d+)/); var dy = raw ? parseInt(raw[1]) : 0; if (dy > 80) { t.style.transition = 'transform .25s ease'; t.style.transform = 'translateY(100%)'; setTimeout(closeWord, 260); } else { t.style.transform = ''; t.style.transition = 'transform .25s ease'; } }}>
              <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 2px', flexShrink: 0, cursor: 'grab' }}>
                <div style={{ width: 38, height: 5, borderRadius: 3, background: 'var(--ink-3)', opacity: 0.4 }} />
              </div>
              <div className="search-word-scroll no-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '4px 20px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--clay)', fontWeight: 700, letterSpacing: '.5px' }}>{"STRONG’S " + e.id + " · " + (e.lang || '')}</div>
                    {e.missing
                      ? <div style={{ fontFamily: 'var(--font-read)', fontSize: 30, fontWeight: 500, lineHeight: 1.1, marginTop: 6 }}>{e.id}</div>
                      : <React.Fragment>
                          <div style={{ fontFamily: 'var(--font-read)', fontSize: 38, fontWeight: 500, lineHeight: 1.1, marginTop: 4 }}>{e.lemma}</div>
                          <div style={{ fontSize: 16, color: 'var(--ink-2)', fontStyle: 'italic', fontFamily: 'var(--font-read)' }}>{e.translit} {e.pos ? <span style={{ fontStyle: 'normal', fontFamily: 'var(--font-ui)', fontSize: 13 }}>{"· " + e.pos}</span> : null}</div>
                        </React.Fragment>}
                  </div>
                  <IconBtn name="x" onClick={closeWord} />
                </div>
                {e.missing ? (
                  <p style={{ fontFamily: 'var(--font-read)', fontSize: 17, lineHeight: 1.6, color: 'var(--ink-2)', margin: '18px 0 6px', textWrap: 'pretty' }}>
                    No entry in the built-in lexicon for this number. A dictionary module would supply the full definition.
                  </p>
                ) : <React.Fragment>
                  {e.short ? (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--clay-soft)', color: 'var(--clay-ink)',
                      padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, margin: '16px 0 14px' }}>
                      <Icon name="sparkle" size={15} stroke={2} /> {e.short}
                    </div>
                  ) : <div style={{ height: 16 }} />}
                  <p style={{ fontFamily: 'var(--font-read)', fontSize: 18, lineHeight: 1.6, color: 'var(--ink)', margin: '0 0 16px', textWrap: 'pretty' }}>{e.def || e.gloss}</p>
                  {e.deriv ? (
                    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 14, padding: '11px 14px', marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 3 }}>Derivation</div>
                      <div style={{ fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                        {e.deriv.split(/([GH]\d{1,5})/).map(function(part, i) {
                          return /^[GH]\d{1,5}$/.test(part) && !window.Bible.lex(part).missing
                            ? <span key={i} onClick={function() { followWord(part); }} style={{ color: 'var(--clay)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'color-mix(in oklab, var(--clay) 45%, transparent)', textUnderlineOffset: 2 }}>{part}</span>
                            : part;
                        })}
                      </div>
                    </div>
                  ) : null}
                  {e.kjv ? (
                    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 14, padding: '11px 14px', marginBottom: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 3 }}>KJV translates it</div>
                      <div style={{ fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>{e.kjv}</div>
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', gap: 10 }}>
                    {e.occ ? (
                      <div style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 16, padding: '13px 15px' }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--clay)' }}>{e.occ}</div>
                        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 600 }}>occurrences in scripture</div>
                      </div>
                    ) : null}
                  </div>
                </React.Fragment>}
              </div>
            </div>
          </div>
        );
      })() : null}
    </React.Fragment>
  );
}

window.SearchScreen = SearchScreen;
