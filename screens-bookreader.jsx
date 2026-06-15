// screens-bookreader.jsx -- full-text reader for the Books module.
// Real public-domain content: previews come from window.TrinityLibrary (built by
// scripts/build-library-catalog.py); the full book is fetched + gunzipped on demand from
// vendor/library/<id>.json.gz. Falls back to data.jsx BOOK_TEXT for titles not yet fetched.
const LIB_CACHE = {};   // in-session full-book cache (id -> book)

// Books are NOT bundled in the APK — they download on demand (like Bibles) and cache in IndexedDB for
// offline re-reads. window.Bible.loadAsset resolves to the gateway on native and uses the shared cache;
// on the web the file is same-origin in the deploy. Falls back to a plain fetch if the engine is absent.
async function loadFullBook(id) {
  if (LIB_CACHE[id]) return LIB_CACHE[id];
  const url = 'vendor/library/' + id + '.json.gz';
  let buf;
  if (window.Bible && window.Bible.loadAsset) {
    buf = await window.Bible.loadAsset(url);
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error('not found');
    buf = new Uint8Array(await res.arrayBuffer());
  }
  const json = window.fflate.strFromU8(window.fflate.gunzipSync(buf));
  const book = JSON.parse(json);
  LIB_CACHE[id] = book;
  try { const d = JSON.parse(localStorage.getItem('trinityone.downloaded') || '[]'); if (!d.includes(id)) { d.push(id); localStorage.setItem('trinityone.downloaded', JSON.stringify(d)); } } catch (e) {}
  return book;
}
function isDownloaded(id) { try { return JSON.parse(localStorage.getItem('trinityone.downloaded') || '[]').includes(id); } catch (e) { return false; } }

function Para({ text, verse, drop, rs }) {
  return (
    <p style={{ margin: '0 0 18px', fontFamily: 'var(--font-read)', fontSize: (verse ? 17.5 : 18.5) * rs,
      lineHeight: verse ? 1.85 : 1.72, color: 'var(--ink)', textWrap: 'pretty', whiteSpace: verse ? 'pre-wrap' : 'normal' }}>
      {drop && !verse ? (
        <span style={{ float: 'left', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 58 * rs, lineHeight: .82,
          padding: '4px 10px 0 0', color: 'var(--clay)' }}>{text.charAt(0)}</span>
      ) : null}
      {drop && !verse ? text.slice(1) : text}
    </p>
  );
}

function ChapterHead({ label, title }) {
  return (
    <div style={{ textAlign: 'center', margin: '8px 0 26px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 21, marginTop: 6, color: 'var(--ink)' }}>{title}</div>
      <div style={{ width: 38, height: 2, background: 'var(--clay)', margin: '14px auto 0', borderRadius: 2 }} />
    </div>
  );
}

function BookReader({ book, open, onClose, ctx }) {
  const D = window.TrinityData;
  const TL = window.TrinityLibrary || { available: [], previews: {} };
  const scrollRef = React.useRef(null);
  const [progress, setProgress] = React.useState(0);
  const [saved, setSaved] = React.useState(false);
  const [full, setFull] = React.useState(null);     // loaded full book (chapters) or null = preview
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setProgress(0); setSaved(false); setFull(null); setErr(false); setLoading(false);
    // auto-open the full book if it was downloaded before (or ?full=1 for testing)
    const forceFull = new URLSearchParams(location.search).get('full') === '1';
    if (book && TL.available.indexOf(book.id) >= 0 && (isDownloaded(book.id) || forceFull)) {
      setLoading(true);
      loadFullBook(book.id).then((b) => { setFull(b); setLoading(false); }).catch(() => setLoading(false));
    }
  }, [open, book && book.id]);
  if (!book) return null;

  const meta = D.BOOK_TEXT[book.id] || {};
  const prev = TL.previews[book.id];                 // real preview if we fetched this title
  const hasFull = TL.available.indexOf(book.id) >= 0;
  const author = book.sub || meta.author || '';
  const year = meta.year || (prev && prev.year);
  const pages = (full && full.pages) || meta.pages || (prev && prev.pages);
  const verse = (full && full.verse) || meta.verse || (prev && prev.verse);
  const source = full ? full.source : (prev && prev.source);
  // preview = the curated, pristine opening (data.jsx); the full Gutenberg text is the download
  const previewChapter = meta.chapter || (prev && prev.chapter);
  const previewBody = meta.body || (prev && prev.body) || [];
  const rs = ctx.readScale || 1;
  const downloaded = hasFull && (!!full || isDownloaded(book.id));

  const onScroll = (e) => { const el = e.target; const max = el.scrollHeight - el.clientHeight; setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0); };
  const getFull = () => {
    setLoading(true); setErr(false);
    loadFullBook(book.id).then((b) => { setFull(b); setLoading(false); if (scrollRef.current) scrollRef.current.scrollTop = 0; ctx.toast('Downloaded ' + book.name); })
      .catch(() => { setLoading(false); setErr(true); ctx.toast('Couldn’t download this title'); });
  };

  return (
    <Overlay open={open} onClose={onClose}>
      {/* sticky header */}
      <div style={{ paddingTop: 50, flexShrink: 0, background: 'color-mix(in oklab, var(--paper) 92%, transparent)', borderBottom: '1px solid var(--line-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px 10px' }}>
          <IconBtn name="chevL" onClick={onClose} />
          <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14.5, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{book.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{author}</div>
          </div>
          <IconBtn name="bookmark" stroke={saved ? 2.2 : 1.9}
            onClick={() => { setSaved(s => !s); ctx.toast(saved ? 'Bookmark removed' : 'Bookmarked'); }}
            style={saved ? { color: 'var(--clay)', borderColor: 'color-mix(in oklab, var(--clay) 40%, var(--line))', background: 'var(--clay-soft)' } : {}} />
        </div>
        <div style={{ height: 2.5, background: 'var(--line-2)' }}>
          <div style={{ height: '100%', width: (progress * 100) + '%', background: 'var(--clay)', transition: 'width .12s linear' }} />
        </div>
      </div>

      {/* body */}
      <div ref={scrollRef} onScroll={onScroll} className="no-scrollbar" style={{ flex: 1, overflowY: 'auto' }}>
        {/* title block */}
        <div style={{ padding: '26px 26px 22px', borderBottom: '1px solid var(--line-2)' }}>
          <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase',
            color: 'var(--clay)', background: 'var(--clay-soft)', padding: '5px 11px', borderRadius: 999, marginBottom: 14 }}>{book.cat || 'Classic'}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 30, lineHeight: 1.08, letterSpacing: '-.6px', color: 'var(--ink)' }}>{book.name}</h1>
          <div style={{ marginTop: 8, fontFamily: 'var(--font-read)', fontStyle: 'italic', fontSize: 17, color: 'var(--ink-2)' }}>{author}</div>
          {(year || pages) ? (
            <React.Fragment>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', flexWrap: 'wrap' }}>
                {year ? <span>{year}</span> : null}
                {year && pages ? <span style={{ width: 3, height: 3, borderRadius: 999, background: 'var(--ink-3)' }} /> : null}
                {pages ? <span>{pages} pages</span> : null}
                <span style={{ width: 3, height: 3, borderRadius: 999, background: 'var(--ink-3)' }} />
                {downloaded
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--sage)' }}><Icon name="cloudCheck" size={14} color="var(--sage)" /> Downloaded</span>
                  : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="cloud" size={14} color="var(--ink-3)" /> {hasFull ? 'Preview' : 'Sample'}</span>}
              </div>
              {meta.blurb ? <p style={{ margin: '14px 0 0', fontFamily: 'var(--font-ui)', fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-2)', textWrap: 'pretty' }}>{meta.blurb}</p> : null}
              {source ? <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink-3)' }}>{source} · public domain</div> : null}
            </React.Fragment>
          ) : null}
        </div>

        {/* reading text */}
        <div style={{ padding: '26px 26px 60px' }}>
          {full ? (
            /* full book -- every chapter */
            <React.Fragment>
              {full.chapters.map((ch, ci) => (
                <div key={ci} style={{ marginBottom: 10 }}>
                  <ChapterHead label={ci === 0 ? 'Chapter One' : 'Chapter ' + (ci + 1)} title={ch.title} />
                  {ch.body.map((para, pi) => <Para key={pi} text={para} verse={full.verse} drop={ci === 0 && pi === 0} rs={rs} />)}
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20, color: 'var(--ink-3)' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} /><Icon name="sparkle" size={15} color="var(--ink-3)" /><div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              </div>
              <p style={{ textAlign: 'center', marginTop: 14, fontSize: 12.5, color: 'var(--ink-3)', fontFamily: 'var(--font-ui)' }}>The End · {full.chapters.length} chapters</p>
            </React.Fragment>
          ) : (previewBody.length ? (
            /* preview -- first chapter + a download CTA for the full book */
            <React.Fragment>
              <ChapterHead label="Chapter One" title={previewChapter} />
              {previewBody.map((para, i) => <Para key={i} text={para} verse={verse} drop={i === 0} rs={rs} />)}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 30, color: 'var(--ink-3)' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} /><Icon name="sparkle" size={15} color="var(--ink-3)" /><div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              </div>
              {hasFull ? (
                <div style={{ textAlign: 'center', marginTop: 18 }}>
                  <button onClick={getFull} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none',
                    background: 'var(--clay)', color: '#fff', padding: '12px 22px', borderRadius: 14, fontWeight: 700, fontSize: 14.5,
                    cursor: loading ? 'default' : 'pointer', fontFamily: 'var(--font-ui)', opacity: loading ? .7 : 1 }}>
                    <Icon name="cloud" size={17} color="#fff" /> {loading ? 'Downloading…' : 'Download full book'}</button>
                  <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--ink-3)', fontFamily: 'var(--font-ui)' }}>{pages} pages · reads offline once downloaded</p>
                  {err ? <p style={{ marginTop: 6, fontSize: 12, color: 'var(--clay-ink)' }}>Couldn’t download — try again.</p> : null}
                </div>
              ) : (
                <p style={{ textAlign: 'center', marginTop: 16, fontSize: 12.5, color: 'var(--ink-3)', fontFamily: 'var(--font-ui)' }}>End of sample · {pages} pages in this edition</p>
              )}
            </React.Fragment>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--ink-3)' }}>
              <Icon name="books" size={32} color="var(--ink-3)" />
              <p style={{ margin: '14px 0 0', fontFamily: 'var(--font-read)', fontSize: 16, color: 'var(--ink-2)' }}>This title isn’t available yet.</p>
            </div>
          ))}
        </div>
      </div>
    </Overlay>);
}

Object.assign(window, { BookReader });
