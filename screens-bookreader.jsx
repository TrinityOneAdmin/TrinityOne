// screens-bookreader.jsx — full-text reader for the Books module
function BookReader({ book, open, onClose, ctx }) {
  const D = window.TrinityData;
  const scrollRef = React.useRef(null);
  const [progress, setProgress] = React.useState(0);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => { if (open && scrollRef.current) { scrollRef.current.scrollTop = 0; setProgress(0); setSaved(false); } }, [open, book && book.id]);
  if (!book) return null;

  const t = D.BOOK_TEXT[book.id];
  const author = book.sub || '';
  const rs = ctx.readScale || 1;

  const onScroll = (e) => {
    const el = e.target;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
  };

  return (
    <Overlay open={open} onClose={onClose}>
      {/* sticky header */}
      <div style={{ paddingTop: 50, flexShrink: 0, background: 'color-mix(in oklab, var(--paper) 92%, transparent)',
        borderBottom: '1px solid var(--line-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px 10px' }}>
          <IconBtn name="chevL" onClick={onClose} />
          <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14.5, color: 'var(--ink)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{book.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{author}</div>
          </div>
          <IconBtn name="bookmark" stroke={saved ? 2.2 : 1.9}
            onClick={() => { setSaved(s => !s); ctx.toast(saved ? 'Bookmark removed' : 'Bookmarked'); }}
            style={saved ? { color: 'var(--clay)', borderColor: 'color-mix(in oklab, var(--clay) 40%, var(--line))', background: 'var(--clay-soft)' } : {}} />
        </div>
        {/* progress */}
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
          {t ? (
            <React.Fragment>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' }}>
                <span>{t.year}</span>
                <span style={{ width: 3, height: 3, borderRadius: 999, background: 'var(--ink-3)' }} />
                <span>{t.pages} pages</span>
                <span style={{ width: 3, height: 3, borderRadius: 999, background: 'var(--ink-3)' }} />
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--sage)' }}><Icon name="cloudCheck" size={14} color="var(--sage)" /> Downloaded</span>
              </div>
              <p style={{ margin: '14px 0 0', fontFamily: 'var(--font-ui)', fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-2)', textWrap: 'pretty' }}>{t.blurb}</p>
            </React.Fragment>
          ) : null}
        </div>

        {/* reading text */}
        <div style={{ padding: '26px 26px 60px' }}>
          {t ? (
            <React.Fragment>
              <div style={{ textAlign: 'center', marginBottom: 26 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Chapter One</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 21, marginTop: 6, color: 'var(--ink)' }}>{t.chapter}</div>
                <div style={{ width: 38, height: 2, background: 'var(--clay)', margin: '14px auto 0', borderRadius: 2 }} />
              </div>
              {t.body.map((para, i) => (
                <p key={i} style={{
                  margin: i === 0 ? '0 0 18px' : '0 0 18px',
                  fontFamily: 'var(--font-read)', fontSize: (t.verse ? 17.5 : 18.5) * rs, lineHeight: t.verse ? 1.85 : 1.72,
                  color: 'var(--ink)', textWrap: 'pretty', whiteSpace: t.verse ? 'pre-wrap' : 'normal',
                }}>
                  {i === 0 && !t.verse ? (
                    <span style={{ float: 'left', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 58 * rs, lineHeight: .82,
                      padding: '4px 10px 0 0', color: 'var(--clay)' }}>{para.charAt(0)}</span>
                  ) : null}
                  {i === 0 && !t.verse ? para.slice(1) : para}
                </p>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 30, color: 'var(--ink-3)' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                <Icon name="sparkle" size={15} color="var(--ink-3)" />
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              </div>
              <p style={{ textAlign: 'center', marginTop: 16, fontSize: 12.5, color: 'var(--ink-3)', fontFamily: 'var(--font-ui)' }}>
                End of preview · {t.pages} pages in this edition
              </p>
            </React.Fragment>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--ink-3)' }}>
              <Icon name="books" size={32} color="var(--ink-3)" />
              <p style={{ margin: '14px 0 0', fontFamily: 'var(--font-read)', fontSize: 16, color: 'var(--ink-2)' }}>This title isn’t downloaded yet.</p>
              <button onClick={() => ctx.toast('Downloading ' + book.name + '…')} style={{ marginTop: 16, border: 'none', background: 'var(--clay)', color: '#fff',
                padding: '11px 20px', borderRadius: 13, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Download to read</button>
            </div>
          )}
        </div>
      </div>
    </Overlay>);
}

Object.assign(window, { BookReader });
