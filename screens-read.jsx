// screens-read.jsx — the Bible reader, wired to the live module engine (window.Bible)
const { useState: useS, useEffect: useE, useRef: useR } = React;

const HL_COLORS = [
  { id: 'yellow', v: 'var(--hl-yellow)' },
  { id: 'green', v: 'var(--hl-green)' },
  { id: 'pink', v: 'var(--hl-pink)' },
  { id: 'blue', v: 'var(--hl-blue)' },
  { id: 'clay', v: 'var(--hl-clay)' },
];

// ── one verse: real markup HTML, tappable Strong's superscripts, highlight + selection ──
function VerseRow({ n, html, hl, note, bookmarked, selected, reading, onSelect, onWord }) {
  return (
    <span id={'rv-' + n} style={{ position: 'relative' }}>
      <span
        onClick={(e) => {
          const sup = e.target.closest && e.target.closest('sup.st');
          if (sup) { e.stopPropagation(); onWord((sup.dataset.s || '').split(',')[0]); }
          else { onSelect(n); }
        }}
        style={{
          cursor: 'pointer', borderRadius: 4,
          // selection/reading is a highlight, NOT an outline — an inline verse wraps across lines, and an
          // outline fragments into a separate oval per line. box-decoration-break: clone keeps the tint
          // continuous across the wrap so it reads as one highlighted verse.
          background: selected ? 'color-mix(in oklab, var(--clay) 30%, transparent)' : (reading ? 'color-mix(in oklab, var(--clay) 16%, transparent)' : 'transparent'),
          WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone',
          transition: 'background .2s',
        }}>
        <sup style={{
          fontFamily: 'var(--font-ui)', fontSize: '.58em', fontWeight: 700,
          color: bookmarked ? 'var(--clay)' : 'var(--ink-3)', marginRight: 3, verticalAlign: 'super',
          position: 'relative', top: '-.1em',
        }}>{n}</sup>
        <span style={hl ? {
          background: hl, borderRadius: 3, padding: '1px 1px',
          WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone',
        } : null} dangerouslySetInnerHTML={{ __html: window.sanitizeHtml(html) }} />
        {note ? <Icon name="note" size={14} color="var(--gold)" style={{ verticalAlign: 'middle', marginLeft: 4 }} /> : null}
      </span>{' '}
    </span>
  );
}

// ── header ──
function ReadHeader({ ctx, loc, version, onBook, onChapter, onVersion, onSettings, compare, onCompare, onListen, narrating, canListen }) {
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, paddingTop: 50,
      background: 'color-mix(in oklab, var(--paper) 88%, transparent)',
      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      borderBottom: '1px solid var(--line-2)',
    }}>
      {/* row 1 — Bible/Plans tabs share the line with the action icons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px 0' }}>
        <div style={{ flex: 1, minWidth: 0 }}><ReadPlansTabs ctx={ctx} /></div>
        <IconBtn name="search" size={18} onClick={() => ctx.openSearch()} style={{ width: 36, height: 36 }} />
        {canListen ? <IconBtn name="headphones" size={18} onClick={onListen} style={narrating ? { width: 36, height: 36, background: 'var(--clay)', color: '#fff', borderColor: 'var(--clay)' } : { width: 36, height: 36 }} /> : null}
        <IconBtn name="compare" size={18} onClick={onCompare} style={compare ? { width: 36, height: 36, background: 'var(--clay)', color: '#fff', borderColor: 'var(--clay)' } : { width: 36, height: 36 }} />
        <IconBtn name="sliders" size={18} onClick={onSettings} style={{ width: 36, height: 36 }} />
      </div>
      {/* row 2 — book / chapter / version selectors get the full width to breathe */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 11px' }}>
        <button onClick={onBook} style={{
          display: 'flex', alignItems: 'center', gap: 5, border: 'none', cursor: 'pointer', flexShrink: 1, minWidth: 0,
          background: 'var(--surface)', boxShadow: 'var(--shadow)', borderRadius: 12, padding: '9px 13px',
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5, color: 'var(--ink)', whiteSpace: 'nowrap',
        }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{loc.book}</span><Icon name="chevD" size={14} stroke={2.2} color="var(--ink-3)" style={{ flexShrink: 0 }} /></button>
        <button onClick={(ev) => onChapter(ev.currentTarget.getBoundingClientRect())} style={{
          display: 'flex', alignItems: 'center', gap: 4, border: 'none', cursor: 'pointer', flexShrink: 0,
          background: 'var(--surface)', boxShadow: 'var(--shadow)', borderRadius: 12, padding: '9px 13px',
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5, color: 'var(--ink)', whiteSpace: 'nowrap',
        }}>{loc.ch}<Icon name="chevD" size={14} stroke={2.2} color="var(--ink-3)" /></button>
        <button onClick={onVersion} style={{
          display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--line)', cursor: 'pointer', background: 'var(--surface)', flexShrink: 1, minWidth: 0,
          borderRadius: 12, padding: '9px 12px', fontWeight: 700, fontSize: 13, color: 'var(--clay)',
          boxShadow: 'var(--shadow)', maxWidth: 150, whiteSpace: 'nowrap',
        }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{version}</span><Icon name="chevD" size={13} stroke={2.2} color="var(--clay)" style={{ flexShrink: 0 }} /></button>
        <div style={{ flex: 1, minWidth: 4 }} />
      </div>
    </div>
  );
}

// ── verse action sheet ──
function ActionSheet({ label, ctx, open, onClose, onColor, curColor, onNote, onCross, onCommentary, bookmarked, hasNote, multi }) {
  const isMulti = (multi || 1) > 1;   // several verses selected → only Copy + Share apply (the rest are per-verse)
  const acts = isMulti ? [
    { ic: 'copy', label: 'Copy', fn: ctx._copy },
    { ic: 'share', label: 'Share', fn: ctx._share },
  ] : [
    { ic: 'pen', label: 'Note', fn: onNote },
    { ic: 'bookmark', label: bookmarked ? 'Saved' : 'Bookmark', fn: ctx._bm, active: bookmarked },
    { ic: 'copy', label: 'Copy', fn: ctx._copy },
    { ic: 'share', label: 'Share', fn: ctx._share },
    ...(hasNote ? [{ ic: 'pen', label: 'Share note', fn: ctx._shareNote }] : []),
    { ic: 'link', label: 'Cross-refs', fn: onCross },
    { ic: 'comment', label: 'Commentary', fn: onCommentary },
  ];
  return (
    <BottomSheet open={open} onClose={onClose} passthrough>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>{isMulti ? multi + ' verses selected' : 'Verse selected'}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>{label}</div>
        </div>
        <IconBtn name="x" onClick={onClose} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
        <button onClick={ctx._shrink} disabled={!isMulti} title="Remove the last verse" style={{ width: 38, height: 38, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 22, fontWeight: 700, lineHeight: 1, cursor: isMulti ? 'pointer' : 'default', opacity: isMulti ? 1 : 0.4, fontFamily: 'var(--font-ui)' }}>−</button>
        <button onClick={ctx._extendUp} title="Add the verse before" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 38, padding: '0 14px', borderRadius: 999, border: '1px solid var(--clay)', background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', color: 'var(--clay)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>＋ before</button>
        <button onClick={ctx._extend} title="Add the verse after" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 38, padding: '0 14px', borderRadius: 999, border: '1px solid var(--clay)', background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', color: 'var(--clay)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>＋ after</button>
      </div>
      {!isMulti ? <React.Fragment>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-2)', marginBottom: 9 }}>Highlight</div>
      <div style={{ display: 'flex', gap: 11, marginBottom: 20 }}>
        {HL_COLORS.map(c => (
          <button key={c.id} onClick={() => onColor(curColor === c.v ? null : c.v)} style={{
            width: 44, height: 44, borderRadius: 999, background: c.v, cursor: 'pointer',
            border: curColor === c.v ? '2.5px solid var(--ink)' : '2px solid var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{curColor === c.v ? <Icon name="check" size={18} stroke={2.6} color="var(--ink)" /> : null}</button>
        ))}
        <button onClick={() => onColor(null)} style={{
          width: 44, height: 44, borderRadius: 999, background: 'var(--surface-2)', cursor: 'pointer',
          border: '2px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)',
        }}><Icon name="x" size={18} /></button>
      </div>
      </React.Fragment> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
        {acts.map(a => (
          <button key={a.label} onClick={a.fn} style={{
            border: '1px solid var(--line)', background: a.active ? 'var(--clay-soft)' : 'var(--surface-2)',
            borderRadius: 16, padding: '14px 6px', cursor: 'pointer', display: 'flex',
            flexDirection: 'column', alignItems: 'center', gap: 7, color: a.active ? 'var(--clay-ink)' : 'var(--ink)',
          }}>
            <Icon name={a.ic} size={21} fill={a.active} /><span style={{ fontSize: 12, fontWeight: 600 }}>{a.label}</span>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

// ── word study (real lexicon via window.Bible.lex) ──
function WordStudySheet({ id, open, onClose, docked, onWord, canBack, onBack }) {
  const e = id ? window.Bible.lex(id) : null;
  return (
    <BottomSheet open={open} onClose={onClose} docked={docked}>
      {e ? <div style={{ paddingBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
            {canBack ? <IconBtn name="chevL" onClick={onBack} title="Back to the previous definition" /> : null}
            <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--clay)', fontWeight: 700, letterSpacing: '.5px' }}>STRONG'S {e.id} · {e.lang}</div>
            {e.missing
              ? <div style={{ fontFamily: 'var(--font-read)', fontSize: 30, fontWeight: 500, lineHeight: 1.1, marginTop: 6 }}>{e.id}</div>
              : <React.Fragment>
                  <div style={{ fontFamily: 'var(--font-read)', fontSize: 38, fontWeight: 500, lineHeight: 1.1, marginTop: 4 }}>{e.lemma}</div>
                  <div style={{ fontSize: 16, color: 'var(--ink-2)', fontStyle: 'italic', fontFamily: 'var(--font-read)' }}>{e.translit} · <span style={{ fontStyle: 'normal', fontFamily: 'var(--font-ui)', fontSize: 13 }}>{e.pos}</span></div>
                </React.Fragment>}
            </div>
          </div>
          <IconBtn name="x" onClick={onClose} />
        </div>
        {e.missing ? (
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 17, lineHeight: 1.6, color: 'var(--ink-2)', margin: '18px 0 6px', textWrap: 'pretty' }}>
            No entry in the built-in lexicon for this number. A dictionary module (<span style={{ fontFamily: 'var(--font-ui)', fontSize: 13 }}>.dct.mybible</span>) would supply the full definition.
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
                {/* turn each Strong's cross-reference (G3956 / H1234) into a tappable link to that entry */}
                {e.deriv.split(/([GH]\d{1,5})/).map((part, i) => (
                  /^[GH]\d{1,5}$/.test(part) && onWord && !window.Bible.lex(part).missing
                    ? <span key={i} onClick={() => onWord(part)} style={{ color: 'var(--clay)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'color-mix(in oklab, var(--clay) 45%, transparent)', textUnderlineOffset: 2 }}>{part}</span>
                    : part
                ))}
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
            <div style={{ flex: 1, background: 'var(--ink)', color: 'var(--paper)', borderRadius: 16,
              fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-ui)', display: 'flex',
              flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', padding: '13px 15px', gap: 2 }}>
              <Icon name="study" size={18} color="var(--paper)" /> {e.lang === 'HEBREW' ? 'Hebrew' : 'Greek'} root
            </div>
          </div>
        </React.Fragment>}
      </div> : null}
    </BottomSheet>
  );
}

// ── cross refs (built-in study notes; shown for John 1 where seeded) ──
function CrossRefSheet({ loc, v, label, open, onClose, ctx }) {
  const seeded = loc && loc.book === 43 && loc.chap === 1;
  const refs = (seeded && v != null && window.TrinityData.CROSSREFS[v]) || [];
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div><div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>Cross references</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>{label}</div></div>
        <IconBtn name="x" onClick={onClose} />
      </div>
      {refs.length ? refs.map((r, i) => (
        <div key={i} onClick={() => ctx.toast('Opening ' + r.ref)} style={{
          padding: '14px 0', borderTop: i ? '1px solid var(--line)' : 'none', cursor: 'pointer',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, color: 'var(--clay)', fontSize: 14 }}>{r.ref}</span>
            <Icon name="chevR" size={16} color="var(--ink-3)" />
          </div>
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 16, lineHeight: 1.5, color: 'var(--ink)', margin: '5px 0 0' }}>{r.text}</p>
        </div>
      )) : <p style={{ color: 'var(--ink-2)', fontFamily: 'var(--font-read)', fontSize: 16, padding: '8px 0 16px' }}>No cross references for this verse yet.</p>}
    </BottomSheet>
  );
}

// ── commentary (built-in study notes; seeded for John 1) ──
function CommentarySheet({ loc, label, open, onClose }) {
  const C = window.TrinityData.COMMENTARY;
  const seeded = false;   // no seeded sample commentary — a real .cmt.mybible module would populate this
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="82%">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div><div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>{C.source}</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>{label} · Commentary</div></div>
        <IconBtn name="x" onClick={onClose} />
      </div>
      {seeded ? C.blocks.map((b, i) => (
        <div key={i} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 5 }}>
            <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: '#fff', background: 'var(--clay)', padding: '3px 9px', borderRadius: 8 }}>v{b.v}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{b.title}</span>
          </div>
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 16.5, lineHeight: 1.62, color: 'var(--ink)', margin: 0, textWrap: 'pretty' }}>{b.text}</p>
        </div>
      )) : <p style={{ color: 'var(--ink-2)', fontFamily: 'var(--font-read)', fontSize: 16, padding: '8px 0 16px' }}>No commentary module is loaded for this passage. A MySword commentary (<span style={{ fontFamily: 'var(--font-ui)', fontSize: 13 }}>.cmt.mybible</span>) would appear here.</p>}
    </BottomSheet>
  );
}

// ── note editor ──
function NoteEditor({ label, open, onClose, value, onSave }) {
  const [text, setText] = useS(value || '');
  useE(() => { setText(value || ''); }, [value, open]);
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div><div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>Note on</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>{label}</div></div>
        <button onClick={() => onSave(text)} style={{ border: 'none', background: 'var(--clay)', color: '#fff',
          padding: '10px 18px', borderRadius: 13, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Save</button>
      </div>
      <textarea autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="What is God showing you here?" style={{
        width: '100%', minHeight: 150, border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surface-2)',
        padding: 15, fontFamily: 'var(--font-read)', fontSize: 17, lineHeight: 1.5, color: 'var(--ink)', resize: 'none', outline: 'none',
      }} />
    </BottomSheet>
  );
}

// ── version / translation sheet (loaded modules + add another) ──
// ── translations manager: switch · remove · add (Read owns "what loads") ──
function AbbrTile({ abbr, on }) {
  return (
    <div style={{ width: 46, height: 46, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `color-mix(in oklab, var(--clay) ${on ? 22 : 12}%, var(--surface))`, color: 'var(--clay)' }}>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: (abbr || '').length > 3 ? 12 : 13.5, letterSpacing: '-.3px' }}>{abbr}</span>
    </div>
  );
}
function VersionSheet({ open, onClose, version, onPick, onAdd, ctx }) {
  const [, force] = React.useState(0);
  const [cat, setCat] = React.useState(null);
  React.useEffect(() => window.Bible.subscribe(() => force(x => x + 1)), []);
  React.useEffect(() => { if (open && !cat) window.Bible.getCatalog().then(setCat); }, [open, cat]);

  const installed = window.Bible.versions();   // [{abbr,name,kind}] — what's loaded now
  const owned = new Set(installed.map(v => v.abbr));
  const bibles = cat ? (((cat.categories || []).find(c => c.id === 'bibles') || {}).items || []) : [];
  const available = bibles.filter(b => !owned.has(b.abbr) && !window.Bible.isInstalled(b.url));

  const remove = (e, abbr) => { e.stopPropagation(); ctx.removeTranslation(abbr); ctx.toast('Removed ' + abbr); };
  const add = (item) => {
    ctx.toast('Adding ' + item.abbr + '…');
    window.Bible.installModule(item).then((res) => {
      const abbr = (res && res.abbr) || item.abbr;
      if (res && res.kind === 'bible') ctx.setVersion(abbr);   // jump the reader straight to the new translation
      ctx.toast(abbr + ' — now reading');
    }).catch(() => ctx.toast("Couldn't add " + item.abbr));
  };

  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="84%">
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 700 }}>Translations</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>What loads when you read · tap to switch</div>
      </div>

      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.4px', color: 'var(--ink-3)', textTransform: 'uppercase', margin: '18px 0 9px' }}>In your reader</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {installed.map(m => {
          const on = m.abbr === version;
          return (
            <div key={m.abbr} onClick={() => onPick(m.abbr)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: 11, borderRadius: 15, cursor: 'pointer',
              background: on ? 'color-mix(in oklab, var(--clay) 9%, var(--surface))' : 'var(--surface)',
              border: on ? '1.5px solid color-mix(in oklab, var(--clay) 40%, var(--line))' : '1px solid var(--line)', boxShadow: 'var(--shadow)' }}>
              <AbbrTile abbr={m.abbr} on={on} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>{m.name}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.abbr}{m.kind && m.kind !== 'bible' ? ' · ' + m.kind : ''}</div>
              </div>
              {on ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, fontSize: 11, fontWeight: 800, letterSpacing: '.3px', color: '#fff', background: 'var(--clay)', padding: '5px 11px', borderRadius: 999 }}>
                  <Icon name="check" size={13} stroke={2.6} color="#fff" /> READING</span>
              ) : (
                <button onClick={(e) => remove(e, m.abbr)} aria-label={'Remove ' + m.name} style={{
                  flexShrink: 0, width: 36, height: 36, borderRadius: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink-3)', cursor: 'pointer' }}>
                  <Icon name="trash" size={17} color="var(--ink-3)" /></button>
              )}
            </div>
          );
        })}
      </div>

      {available.length ? (
        <React.Fragment>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.4px', color: 'var(--ink-3)', textTransform: 'uppercase', margin: '22px 0 9px' }}>Add a translation</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {available.map(item => {
              const busy = window.Bible.isInstalling(item.url);
              return (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 11, borderRadius: 15, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }}>
                  <AbbrTile abbr={item.abbr} on={false} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>{item.name}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[item.lang, item.size].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button onClick={() => add(item)} disabled={busy} style={{
                    flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 13px', borderRadius: 11,
                    border: 'none', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-ui)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
                    {busy ? 'Adding…' : <React.Fragment><Icon name="plus" size={15} stroke={2.4} color="#fff" /> Add</React.Fragment>}</button>
                </div>
              );
            })}
          </div>
        </React.Fragment>
      ) : null}

      <button onClick={() => { onClose(); ctx.openStore('language'); }} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 16,
        padding: '13px 14px', borderRadius: 14, border: 'none', background: 'var(--clay)',
        cursor: 'pointer', color: '#fff', fontWeight: 700, fontSize: 14.5, fontFamily: 'var(--font-ui)' }}>
        <Icon name="globe" size={18} color="#fff" /> Browse all translations (1,000+)
      </button>
      <button onClick={onAdd} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 10,
        padding: '13px 14px', borderRadius: 14, border: '1px dashed var(--line)', background: 'var(--surface-2)',
        cursor: 'pointer', color: 'var(--clay)', fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-ui)' }}>
        <Icon name="plus" size={18} /> Load from a file (MySword · USFM)
      </button>
    </BottomSheet>
  );
}

// ── reader settings (size, serif, Strong's, theme) ──
function SettingsSheet({ open, onClose, scale, setScale, serif, setSerif, showStrongs, setShowStrongs, ctx }) {
  const aOpts = window.AUDIO_BIBLE_OPTIONS || { translations: [], readers: [] };
  const [voice, setVoice] = React.useState(() => { const c = window.getAudioChoice ? window.getAudioChoice() : { translation: 'BSB', reader: 'david' }; return c.translation + '/' + c.reader; });
  const [vt, vr] = voice.split('/');
  const pickAudio = (t, r) => {
    const v = t + '/' + r; lsSet('trinityone.audioVoice', v); setVoice(v);
    // if a chapter is loaded, reload it in the newly-chosen voice/translation so the change is audible now
    const cur = window.TrinityAudio && window.TrinityAudio.current;
    const m = cur && /^bible:(\d+):(\d+)$/.exec(cur.id || '');
    if (m && window.playBibleChapter) window.playBibleChapter(+m[1], +m[2]);
  };
  const aBtn = (on) => ({ flex: 1, padding: '11px', borderRadius: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5, border: on ? '2px solid var(--clay)' : '1px solid var(--line)', background: on ? 'var(--clay-soft)' : 'var(--surface-2)', color: on ? 'var(--clay-ink)' : 'var(--ink-2)' });
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Reading</div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 9 }}>Text size</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: 'var(--font-read)', fontSize: 15 }}>A</span>
          <input type="range" min="0.85" max="1.45" step="0.05" value={scale} onChange={e => setScale(parseFloat(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--clay)' }} />
          <span style={{ fontFamily: 'var(--font-read)', fontSize: 26 }}>A</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        {[['Serif', true], ['Sans', false]].map(([lbl, val]) => (
          <button key={lbl} onClick={() => setSerif(val)} style={{
            flex: 1, padding: '13px', borderRadius: 14, cursor: 'pointer',
            border: serif === val ? '2px solid var(--clay)' : '1px solid var(--line)',
            background: serif === val ? 'var(--clay-soft)' : 'var(--surface-2)',
            color: serif === val ? 'var(--clay-ink)' : 'var(--ink-2)', fontWeight: 700, fontSize: 15,
            fontFamily: val ? 'var(--font-read)' : 'var(--font-ui)',
          }}>{lbl}</button>
        ))}
      </div>
      <button onClick={() => setShowStrongs(!showStrongs)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface-2)',
        cursor: 'pointer', color: 'var(--ink)', marginBottom: 18,
      }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Show Strong's numbers</span>
        <div style={{ width: 46, height: 28, borderRadius: 999, background: showStrongs ? 'var(--clay)' : 'var(--line)', position: 'relative', transition: 'background .2s' }}>
          <div style={{ position: 'absolute', top: 3, left: showStrongs ? 21 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
        </div>
      </button>

      {aOpts.readers.length ? (
        <div style={{ marginBottom: 18 }}>
          {aOpts.translations.length > 1 ? (
            <React.Fragment>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 9 }}>Audio Bible — translation</div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 13 }}>
                {aOpts.translations.map(t => <button key={t.id} onClick={() => pickAudio(t.id, vr)} style={aBtn(vt === t.id)}>{t.name}</button>)}
              </div>
            </React.Fragment>
          ) : null}
          {(aOpts.translations.find(t => t.id === vt) || {}).local ? (
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>Offline, matches the WEB text. Download books from the Library; until then, Listen plays Berean Standard.</div>
          ) : (
            <React.Fragment>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 9 }}>Voice</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {aOpts.readers.map(r => <button key={r.id} onClick={() => pickAudio(vt, r.id)} style={{ ...aBtn(vr === r.id), padding: '10px' }}>{r.name}</button>)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 9, lineHeight: 1.45 }}>Streams · public-domain narration. Applies the next time you tap Listen.</div>
            </React.Fragment>
          )}
        </div>
      ) : null}

      <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, margin: '4px 0 14px' }}>Theme</div>
      <button onClick={ctx.toggleDark} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface-2)',
        cursor: 'pointer', color: 'var(--ink)', marginBottom: 14,
      }}>
        <span style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 9 }}><Icon name={ctx.dark ? 'moon' : 'sun'} size={18} /> Dark mode</span>
        <div style={{ width: 46, height: 28, borderRadius: 999, background: ctx.dark ? 'var(--clay)' : 'var(--line)', position: 'relative', transition: 'background .2s' }}>
          <div style={{ position: 'absolute', top: 3, left: ctx.dark ? 21 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
        </div>
      </button>
      <div style={{ display: 'flex', gap: 12, paddingBottom: 4 }}>
        {[['clay', '#C25A38'], ['indigo', '#5360D6'], ['teal', '#1F9488'], ['berry', '#C24B7A']].map(([id, col]) => (
          <button key={id} onClick={() => ctx.setAccent(id)} style={{
            width: 46, height: 46, borderRadius: 999, background: col, cursor: 'pointer',
            border: ctx.accent === id ? '3px solid var(--ink)' : '2px solid var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{ctx.accent === id ? <Icon name="check" size={18} stroke={2.6} color="#fff" /> : null}</button>
        ))}
      </div>
    </BottomSheet>
  );
}

// ── book + chapter picker (live across the loaded module) ──
function BookPicker({ open, onClose, onPick, version }) {
  const B = window.Bible.bookMeta();
  const [book, setBook] = useS(null);   // selected book (showing chapters)
  const [chap, setChap] = useS(null);   // selected chapter (showing verses)
  useE(() => { if (!open) { setBook(null); setChap(null); } }, [open]);
  const groups = [['ot', 'OLD TESTAMENT'], ['nt', 'NEW TESTAMENT']].filter(([g]) => B.some(b => b.group === g));
  const back = () => { if (chap) setChap(null); else if (book) setBook(null); else onClose(); };
  const title = chap ? `${book.name} ${chap}` : book ? book.name : 'Books';
  const cellBtn = { aspectRatio: '1', borderRadius: 13, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', fontWeight: 700, fontSize: 15, color: 'var(--ink)', fontFamily: 'var(--font-display)' };
  // verse count for the chosen book+chapter (from the active version)
  const verseCount = (book && chap) ? ((window.Bible.getVerses(book.num, chap, version) || []).length || 1) : 0;
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 52 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px 12px' }}>
          <IconBtn name={book || chap ? 'chevL' : 'x'} onClick={back} />
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700 }}>{title}</h1>
          {chap ? <div style={{ marginLeft: 'auto' }}><button onClick={() => onPick(book.num, chap, 1)} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 12, padding: '8px 13px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, color: 'var(--clay)' }}>Whole chapter</button></div> : null}
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '0 16px 24px' }}>
        {!book ? groups.map(([g, title]) => (
          <div key={g} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '4px 0 10px' }}>{title}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {B.filter(b => b.group === g).map(b => (
                <button key={b.num} onClick={() => { setBook(b); if (b.ch === 1) setChap(1); }} style={{
                  padding: '12px 16px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)',
                  cursor: 'pointer', fontWeight: 600, fontSize: 15, color: 'var(--ink)', fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)',
                }}>{b.name}</button>
              ))}
            </div>
          </div>
        )) : !chap ? (
          <React.Fragment>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '4px 0 10px' }}>CHAPTER</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 9 }}>
              {Array.from({ length: book.ch }, (_, i) => i + 1).map(c => (
                <button key={c} onClick={() => setChap(c)} style={cellBtn}>{c}</button>
              ))}
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '4px 0 10px' }}>VERSE</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 9 }}>
              {Array.from({ length: verseCount }, (_, i) => i + 1).map(v => (
                <button key={v} onClick={() => onPick(book.num, chap, v)} style={cellBtn}>{v}</button>
              ))}
            </div>
          </React.Fragment>
        )}
      </div>
    </Overlay>
  );
}

// ── compact chapter + verse dropdown, anchored under the header's chapter pill ──
// Lets you swap chapter/verse within the current book without opening the full book picker.
function ChapterVerseMenu({ open, onClose, anchor, loc, version, onPick }) {
  const Bible = window.Bible;
  const [pick, setPick] = useS(loc.chap);   // chapter whose verses are listed below
  useE(() => { if (open) setPick(loc.chap); }, [open, loc.chap]);
  if (!open || !anchor) return null;
  const nCh = Bible.maxChapter(loc.book, version) || 1;
  const nV = ((Bible.getVerses(loc.book, pick, version) || []).length) || 1;
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 360;
  const left = Math.max(8, Math.min(anchor.left, vw - 296));
  const cell = (active) => ({ aspectRatio: '1', borderRadius: 10, border: '1px solid var(--line)', background: active ? 'var(--clay)' : 'var(--surface-2)', color: active ? '#fff' : 'var(--ink)', cursor: 'pointer', fontWeight: 700, fontSize: 13.5, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 });
  const hd = { fontSize: 11, fontWeight: 700, letterSpacing: '.5px', color: 'var(--ink-3)' };
  return (
    <React.Fragment>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div className="no-scrollbar" style={{ position: 'fixed', top: anchor.bottom + 6, left, width: 288, maxHeight: '62vh', overflowY: 'auto', zIndex: 41,
        background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', padding: 13, animation: 'trinityRise .16s ease both' }}>
        <div style={{ ...hd, margin: '2px 0 8px' }}>CHAPTER</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6 }}>
          {Array.from({ length: nCh }, (_, i) => i + 1).map(c => (
            <button key={c} onClick={() => { setPick(c); onPick(c); }} style={cell(c === pick)}>{c}</button>
          ))}
        </div>
        <div style={{ ...hd, margin: '15px 0 8px' }}>VERSE</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6 }}>
          {Array.from({ length: nV }, (_, i) => i + 1).map(v => (
            <button key={v} onClick={() => { onPick(pick, v); onClose(); }} style={cell(false)}>{v}</button>
          ))}
        </div>
      </div>
    </React.Fragment>
  );
}

// ── main read screen ──
// ── commentary slide-out: a tab pinned to the right edge of the reader that swipes/taps in ──
function CommentaryEdge({ open, onToggle }) {
  if (open) return null;
  return (
    <button onClick={onToggle} aria-label="Open commentary" style={{
      position: 'absolute', right: 0, top: '40%', zIndex: 18, border: 'none', cursor: 'pointer',
      background: 'var(--clay)', color: '#fff', padding: '13px 5px 13px 7px', borderRadius: '13px 0 0 13px',
      boxShadow: '0 6px 18px rgba(34,28,16,.18)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
    }}>
      <Icon name="comment" size={17} color="#fff" />
      <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 10, fontWeight: 800, letterSpacing: '1px', fontFamily: 'var(--font-ui)' }}>NOTES</span>
    </button>
  );
}
function CommentaryPanel({ loc, label, open, onClose, ctx, docked }) {
  const [view, setView] = useS('commentary');   // 'commentary' | 'notes'
  const [comm, setComm] = useS([]);              // installed commentary modules + active-Bible footnotes
  const [composing, setComposing] = useS(false); const [cText, setCText] = useS(''); const [cVerse, setCVerse] = useS('1');
  const saveNewNote = () => { const v = Math.max(1, parseInt(cVerse, 10) || 1); if (cText.trim()) ctx.setNote(label + ':' + v, cText.trim()); setComposing(false); setCText(''); };
  useE(() => { if (!open) return; try { setComm(window.Bible.getCommentary ? window.Bible.getCommentary(loc.book, loc.chap) : []); } catch (e) { setComm([]); } }, [open, loc.book, loc.chap, ctx.version]);
  const sx = useR(0);
  // the reader's own notes for this chapter (keys look like "John 1:4")
  const prefix = label + ':';
  const myNotes = Object.keys(ctx.notes || {}).filter(k => k.indexOf(prefix) === 0)
    .map(k => ({ ref: k, v: parseInt(k.slice(prefix.length), 10) || 0, text: ctx.notes[k] }))
    .sort((a, b) => a.v - b.v);
  const seg = (k, lbl) => (
    <button onClick={() => setView(k)} style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, background: view === k ? 'var(--clay)' : 'transparent', color: view === k ? '#fff' : 'var(--ink-2)' }}>{lbl}</button>
  );
  return (
    <React.Fragment>
      {open && !docked ? <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 24, background: 'rgba(20,15,10,.32)', animation: 'trinityFade .25s ease both' }} /> : null}
      <div
        onTouchStart={(e) => { sx.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { if (!docked && e.changedTouches[0].clientX - sx.current > 56) onClose(); }}
        style={docked
          ? { position: 'absolute', inset: 0, background: 'var(--surface)', display: 'flex', flexDirection: 'column' }
          : { position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 25, width: 'min(440px, 88%)', background: 'var(--surface)', borderLeft: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', transform: open ? 'translateX(0)' : 'translateX(101%)', transition: 'transform .32s cubic-bezier(.32,.72,0,1)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ paddingTop: docked ? 16 : 50, flexShrink: 0, borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 14px 8px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>Study</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700, lineHeight: 1.1 }}>{label}</div>
            </div>
            {docked ? null : <IconBtn name="chevR" onClick={onClose} />}
          </div>
          <div style={{ display: 'flex', gap: 3, padding: '0 14px 10px' }}>
            <div style={{ display: 'flex', flex: 1, background: 'var(--surface-2)', borderRadius: 12, padding: 3 }}>{seg('commentary', 'Commentary')}{seg('notes', `My notes${myNotes.length ? ' · ' + myNotes.length : ''}`)}</div>
          </div>
        </div>
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 18px 30px', background: 'var(--paper)' }}>
          {view === 'notes' ? (
            <React.Fragment>
              {composing ? (
                <div style={{ marginBottom: 14, padding: 13, borderRadius: 14, background: 'var(--surface)', border: '1.5px solid var(--clay)', boxShadow: 'var(--shadow)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--clay)' }}>{label}:</span>
                    <input value={cVerse} onChange={e => setCVerse(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" style={{ width: 52, height: 34, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface-2)', textAlign: 'center', fontSize: 14, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>verse</span>
                  </div>
                  <textarea value={cText} onChange={e => setCText(e.target.value)} autoFocus placeholder="Your note…" rows={4} style={{ width: '100%', boxSizing: 'border-box', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface-2)', padding: '10px 12px', fontFamily: 'var(--font-read)', fontSize: 16, lineHeight: 1.5, color: 'var(--ink)', outline: 'none', resize: 'vertical' }} />
                  <div style={{ display: 'flex', gap: 9, marginTop: 9 }}>
                    <button onClick={() => { setComposing(false); setCText(''); }} style={{ flex: 1, padding: 10, borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Cancel</button>
                    <button onClick={saveNewNote} disabled={!cText.trim()} style={{ flex: 1, padding: 10, borderRadius: 11, border: 'none', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', opacity: cText.trim() ? 1 : 0.55 }}>Save note</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setComposing(true); setCVerse(String((sel || 1))); }} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px', borderRadius: 12, border: '1px dashed color-mix(in oklab, var(--clay) 45%, var(--line))', background: 'color-mix(in oklab, var(--clay) 5%, var(--surface))', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', marginBottom: 14 }}><Icon name="plus" size={16} color="var(--clay)" /> New note</button>
              )}
            {myNotes.length ? myNotes.map(n => (
              <div key={n.ref} onClick={() => { onClose(); ctx.gotoRef && (() => { const l = window.Bible.parseRef(n.ref); if (l) ctx.gotoRef(l.book, l.chap, l.verse); })(); }} style={{ marginBottom: 12, padding: 13, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', cursor: 'pointer' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--clay)', marginBottom: 4 }}>{n.ref}</div>
                <p style={{ fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.55, color: 'var(--ink)', margin: 0, textWrap: 'pretty' }}>{n.text}</p>
              </div>
            )) : (
              <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--ink-3)' }}>
                <div style={{ width: 52, height: 52, borderRadius: 15, background: 'color-mix(in oklab, var(--gold) 14%, var(--surface))', color: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}><Icon name="note" size={24} /></div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink)', marginBottom: 6 }}>No notes here yet</div>
                <p style={{ fontSize: 14, lineHeight: 1.55, maxWidth: 270, margin: '0 auto' }}>Tap a verse → <b>Note</b> to jot a thought. Your notes for {label} gather here.</p>
              </div>
            )}
            </React.Fragment>
          ) : comm.length ? comm.map((srcBlk, si) => (
            <div key={si} style={{ marginBottom: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--line)' }}>
                <Icon name={srcBlk.kind === 'footnotes' ? 'note' : 'comment'} size={14} color="var(--clay)" />
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--ink-2)' }}>{srcBlk.name}</span>
              </div>
              {srcBlk.rows.map((b, i) => (
                <div key={i} style={{ marginBottom: 14 }}>
                  <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 11.5, color: '#fff', background: 'var(--clay)', padding: '3px 9px', borderRadius: 8, display: 'inline-block', marginBottom: 6 }}>{b.v && b.vTo && b.vTo > b.v ? `v${b.v}–${b.vTo}` : (b.v ? `v${b.v}` : 'Note')}</span>
                  <div className="commentary-body" style={{ fontFamily: 'var(--font-read)', fontSize: 16, lineHeight: 1.6, color: 'var(--ink)' }} dangerouslySetInnerHTML={{ __html: window.sanitizeHtml(b.html) }} />
                </div>
              ))}
            </div>
          )) : (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--ink-3)' }}>
              <div style={{ width: 52, height: 52, borderRadius: 15, background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}><Icon name="comment" size={26} /></div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink)', marginBottom: 6 }}>Nothing here for {label}</div>
              <p style={{ fontSize: 14, lineHeight: 1.55, maxWidth: 280, margin: '0 auto' }}>Install a commentary from the Library, or switch to a Bible with study notes (e.g. Geneva) — its footnotes show up here.</p>
            </div>
          )}
        </div>
      </div>
    </React.Fragment>
  );
}

function ReadScreen({ ctx }) {
  const Bible = window.Bible;
  const loc = ctx.loc || Bible.defaultLoc() || { book: 43, chap: 1 };
  const version = ctx.version;
  const [compare, setCompare] = useS(false);
  const [scale, setScale] = useS(() => lsGet('trinityone.readerScale', 1.08));
  const [serif, setSerif] = useS(() => lsGet('trinityone.readerSerif', true));
  const [showStrongs, setShowStrongs] = useS(false);
  const [sel, setSel] = useS([]);   // selected verse numbers — multi-select to copy/share a passage together
  const [sheet, setSheet] = useS(new URLSearchParams(location.search).get('sheet') || null);
  // word-study history: a stack of Strong's ids so following a cross-reference can be walked back
  const _initWord = new URLSearchParams(location.search).get('word') || null;
  const [wordStack, setWordStack] = useS(_initWord ? [_initWord] : []);
  const wordId = wordStack.length ? wordStack[wordStack.length - 1] : null;
  const [cvAnchor, setCvAnchor] = useS(null);   // header chapter-pill rect for the chapter/verse dropdown
  const [commentaryOpen, setCommentaryOpen] = useS(false);
  // ── narration (Listen): read the chapter aloud with the device's speech engine (offline, no audio files) ──
  const [narrateState, setNarrateState] = useS('idle');   // idle | playing | paused
  const [narrateV, setNarrateV] = useS(null);              // verse number currently being spoken
  const scrollRef = useR();
  const synth = (typeof window !== 'undefined' && window.speechSynthesis) || null;
  const stopNarration = () => { if (synth) try { synth.cancel(); } catch (e) {} setNarrateState('idle'); setNarrateV(null); };
  // stop speaking when the passage changes or the screen unmounts
  useE(() => () => { if (synth) try { synth.cancel(); } catch (e) {} }, []);
  useE(() => { lsSet('trinityone.readerScale', scale); }, [scale]);
  useE(() => { lsSet('trinityone.readerSerif', serif); }, [serif]);
  // arriving on a specific verse (from Today / Search / Book picker): select it + scroll it into view
  useE(() => {
    setSel(loc.verse ? [loc.verse] : []);
    const sc = scrollRef.current; if (!sc) return;
    if (loc.verse) {
      setTimeout(() => { const el = sc.querySelector('#rv-' + loc.verse); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); else sc.scrollTop = 0; }, 60);
    } else { sc.scrollTop = 0; }
  }, [loc.book, loc.chap, loc.verse, version]);

  const verses = Bible.getVerses(loc.book, loc.chap, version);
  const vlist = Bible.versions();
  const cmpAbbr = compare === true ? ((vlist.find(v => v.abbr !== version) || {}).abbr || version) : compare;
  const cmpVerses = cmpAbbr ? Bible.getVerses(loc.book, loc.chap, cmpAbbr) : [];

  const bname = Bible.bookName(loc.book);
  const labelOf = (v) => Bible.refLabel(loc, v);
  // recorded Audio Bible (public-domain narration) for the open chapter — plays through the persistent player
  const audio = useTrinityAudio();
  const audioOnThis = !!(audio.track && audio.track.id === ('bible:' + loc.book + ':' + loc.chap));
  const listenChapter = () => { if (audioOnThis) window.TrinityAudio.toggle(); else if (window.playBibleChapter) window.playBibleChapter(loc.book, loc.chap); };
  const keyOf = (v) => Bible.refKey(loc, v);

  const close = () => setSheet(null);
  // tap a verse to select (opens the action sheet); tap the same verse again to deselect.
  // tap a verse to toggle it in/out of the selection — pick several to copy/share as one passage
  const selectVerse = (n) => {
    const has = sel.some(x => String(x) === String(n));
    const next = has ? sel.filter(x => String(x) !== String(n)) : [...sel, n];
    setSel(next); setSheet(next.length ? 'action' : null);
  };
  const openWord = (id) => { setWordStack([id]); setSheet('word'); };            // fresh lookup (tapping a verse's Strong's number)
  const pushWord = (id) => { setWordStack(s => [...s, id]); };                    // follow a cross-reference, keeping history
  const backWord = () => setWordStack(s => s.length > 1 ? s.slice(0, -1) : s);    // return to the previous definition

  const selSorted = [...new Set((sel || []).map(Number))].filter(Boolean).sort((a, b) => a - b);
  const sel0 = selSorted[0];                       // anchor verse for per-verse actions (note / bookmark / highlight)
  const multi = selSorted.length;
  const selRow = verses.find(x => String(x.v) === String(sel0));
  // compact reference for the whole selection, e.g. "John 3:16-18,20"
  const rangeRef = selSorted.length ? bname + ' ' + loc.chap + ':' + (() => { const r = []; let i = 0; while (i < selSorted.length) { let j = i; while (j + 1 < selSorted.length && selSorted[j + 1] === selSorted[j] + 1) j++; r.push(i === j ? '' + selSorted[i] : selSorted[i] + '-' + selSorted[j]); i = j + 1; } return r.join(','); })() : '';
  const selText = selSorted.map(v => { const r = verses.find(x => String(x.v) === String(v)); return r ? r.text : ''; }).filter(Boolean).join(' ');
  const sheetCtx = {
    toast: ctx.toast,
    _bm: () => { const k = keyOf(sel0); ctx.toggleBookmark(k); ctx.toast(ctx.bookmarks.includes(k) ? 'Bookmark removed' : 'Bookmarked'); },
    _copy: () => { try { navigator.clipboard && navigator.clipboard.writeText(rangeRef + ' — ' + selText); } catch (e) {} close(); ctx.toast(multi > 1 ? 'Passage copied' : 'Copied to clipboard'); },
    _share: () => { close(); ctx.openShareSheet({ ref: rangeRef, text: selText, version }); },
    _shareNote: () => { close(); ctx.openShareSheet({ type: 'note', ref: labelOf(sel0), text: selRow ? selRow.text : '', version, note: ctx.notes[keyOf(sel0)] || '' }); },
    // extend/shrink the selection into a contiguous passage from inside the sheet (the backdrop blocks tapping more verses)
    _extend: () => { const nx = (selSorted[selSorted.length - 1] || 0) + 1; if (verses.some(x => Number(x.v) === nx)) setSel([...sel, nx]); },
    _extendUp: () => { const nx = (selSorted[0] || 0) - 1; if (nx >= 1 && verses.some(x => Number(x.v) === nx)) setSel([...sel, nx]); },
    _shrink: () => { const mx = selSorted[selSorted.length - 1]; if (selSorted.length > 1 && mx != null) setSel(sel.filter(x => Number(x) !== mx)); },
  };

  // speak the whole chapter, verse by verse — highlights + scrolls to each verse as it's read
  const startNarration = () => {
    if (!synth) { ctx.toast('Your device can’t read aloud here'); return; }
    try { synth.cancel(); } catch (e) {}
    const list = verses || [];
    if (!list.length) return;
    setNarrateState('playing');
    list.forEach((row, i) => {
      const u = new SpeechSynthesisUtterance(String(row.text || '').replace(/\s+/g, ' ').trim());
      u.rate = 0.95; u.lang = 'en-US';
      u.onstart = () => {
        setNarrateV(row.v);
        const el = scrollRef.current && scrollRef.current.querySelector('#rv-' + row.v);
        if (el && el.scrollIntoView) try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
      };
      if (i === list.length - 1) u.onend = () => { setNarrateState('idle'); setNarrateV(null); };
      try { synth.speak(u); } catch (e) {}
    });
  };
  const toggleNarration = () => {
    if (!synth) { ctx.toast('Your device can’t read aloud here'); return; }
    if (narrateState === 'idle') startNarration();
    else if (narrateState === 'playing') { try { synth.pause(); } catch (e) {} setNarrateState('paused'); }
    else { try { synth.resume(); } catch (e) {} setNarrateState('playing'); }
  };
  // a fresh passage cancels any in-progress narration
  useE(() => { stopNarration(); }, [loc.book, loc.chap, version]);

  const prev = Bible.step(loc, -1), next = Bible.step(loc, 1);
  const readFont = serif ? 'var(--font-read)' : 'var(--font-ui)';
  const rs = ctx.readScale || 1;
  const baseSize = (serif ? 21 : 18) * scale * rs;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ReadHeader ctx={ctx} loc={{ book: bname, ch: loc.chap }} version={version}
        onBook={() => setSheet('book')} onChapter={(rect) => { setCvAnchor(rect); setSheet('cv'); }} onVersion={() => setSheet('version')}
        onSettings={() => setSheet('settings')} compare={!!compare} onCompare={() => setCompare(c => c ? false : true)}
        onListen={listenChapter} narrating={audioOnThis && audio.playing} canListen={true} />

      <div ref={scrollRef} className="no-scrollbar" style={{ position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden', padding: '164px 18px 116px' }}>
        <div style={{ animation: 'trinityFade .4s ease both' }}>
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--clay)', letterSpacing: '1.5px', textTransform: 'uppercase' }}>{bname}</div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 27, fontWeight: 700, margin: '6px 0 0', letterSpacing: '-.4px' }}>Chapter {loc.chap}</h1>
            <div style={{ width: 40, height: 3, borderRadius: 2, background: 'var(--clay)', margin: '14px auto 0', opacity: .5 }} />
          </div>

          {!compare ? (
            <p className={cx('reader-body', !showStrongs && 'hide-strong')}
              style={{ fontFamily: readFont, fontSize: baseSize, lineHeight: 1.78, color: 'var(--ink)', margin: 0, textWrap: 'pretty' }}>
              {verses.map((row) => {
                const k = keyOf(row.v);
                return (
                  <VerseRow key={row.v} n={row.v} html={row.html}
                    hl={ctx.highlights[k]} note={ctx.notes[k]} bookmarked={ctx.bookmarks.includes(k)}
                    selected={selSorted.some(v => String(v) === String(row.v))} reading={narrateState !== 'idle' && String(narrateV) === String(row.v)} onSelect={selectVerse} onWord={openWord} />
                );
              })}
            </p>
          ) : (
            <div>
              {verses.map((row, i) => (
                <div key={row.v} style={{ display: 'flex', gap: 12, padding: '11px 0', borderBottom: '1px solid var(--line-2)' }}>
                  <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink-3)', width: 18, flexShrink: 0, paddingTop: 5 }}>{row.v}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--clay)', letterSpacing: '.5px', marginBottom: 2 }}>{version}</div>
                    <p style={{ fontFamily: readFont, fontSize: 16 * scale * rs, lineHeight: 1.55, margin: 0, color: 'var(--ink)' }}>{row.text}</p>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--sage)', letterSpacing: '.5px', marginBottom: 2 }}>{cmpAbbr}</div>
                    <p style={{ fontFamily: readFont, fontSize: 16 * scale * rs, lineHeight: 1.55, margin: 0, color: 'var(--ink-2)' }}>{cmpVerses[i] ? cmpVerses[i].text : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* footer nav */}
          <div style={{ display: 'flex', gap: 10, marginTop: 26 }}>
            <button disabled={!prev} onClick={() => prev && ctx.setLoc(prev)} style={{ ...navBtnStyle, opacity: prev ? 1 : .4 }}>
              <Icon name="chevL" size={16} /> {prev ? Bible.refLabel(prev) : 'Start'}
            </button>
            <button disabled={!next} onClick={() => next && ctx.setLoc(next)} style={{ ...navBtnStyle, color: 'var(--clay)', fontWeight: 700, opacity: next ? 1 : .4 }}>
              {next ? Bible.refLabel(next) : 'End'} <Icon name="chevR" size={16} />
            </button>
          </div>
        </div>
      </div>

      <ActionSheet label={rangeRef} multi={multi} ctx={sheetCtx} open={sheet === 'action'} onClose={close}
        curColor={ctx.highlights[keyOf(sel0)]} onColor={(c) => { ctx.setHighlight(keyOf(sel0), c); }}
        bookmarked={ctx.bookmarks.includes(keyOf(sel0))} hasNote={!!ctx.notes[keyOf(sel0)]}
        onNote={() => setSheet('note')} onCross={() => setSheet('cross')} onCommentary={() => { close(); setCommentaryOpen(true); }} />
      <WordStudySheet id={wordId} open={sheet === 'word'} onClose={close} onWord={pushWord} canBack={wordStack.length > 1} onBack={backWord} />
      <CrossRefSheet loc={loc} v={sel0} label={labelOf(sel0)} open={sheet === 'cross'} onClose={() => setSheet('action')} ctx={ctx} />
      {ctx.desktop ? null : <CommentaryEdge open={commentaryOpen} onToggle={() => setCommentaryOpen(o => !o)} />}
      {ctx.desktop ? null : <CommentaryPanel loc={loc} label={bname + ' ' + loc.chap} open={commentaryOpen} onClose={() => setCommentaryOpen(false)} ctx={ctx} />}
      <NoteEditor label={labelOf(sel0)} open={sheet === 'note'} value={ctx.notes[keyOf(sel0)]} onClose={() => setSheet('action')}
        onSave={(t) => { ctx.setNote(keyOf(sel0), t); setSheet('action'); ctx.toast('Note saved'); }} />
      <VersionSheet open={sheet === 'version'} onClose={close} version={version} ctx={ctx} onPick={(k) => { ctx.setVersion(k); close(); }} onAdd={() => { close(); ctx.addModule(); }} />
      <SettingsSheet open={sheet === 'settings'} onClose={close} scale={scale} setScale={setScale}
        serif={serif} setSerif={setSerif} showStrongs={showStrongs} setShowStrongs={setShowStrongs} ctx={ctx} />
      <BookPicker open={sheet === 'book'} onClose={close} version={version}
        onPick={(book, c, v) => { close(); ctx.setLoc({ book, chap: c, verse: v || undefined }); }} />
      <ChapterVerseMenu open={sheet === 'cv'} onClose={close} anchor={cvAnchor} loc={loc} version={version}
        onPick={(c, v) => { ctx.setLoc({ book: loc.book, chap: c, verse: v || undefined }); if (v != null) close(); }} />

      {/* narration control bar — appears while the chapter is being read aloud */}
      {narrateState !== 'idle' ? (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 64, zIndex: 30, display: 'flex', justifyContent: 'center', padding: '0 16px', pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 999, background: 'var(--clay)', color: '#fff', boxShadow: 'var(--shadow-lg)', animation: 'trinityRise .24s ease both', maxWidth: '100%' }}>
            <Icon name="headphones" size={18} color="#fff" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, opacity: .85, fontWeight: 600 }}>Reading aloud</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bname} {loc.chap}{narrateV ? ':' + narrateV : ''}</div>
            </div>
            <button onClick={toggleNarration} aria-label={narrateState === 'playing' ? 'Pause' : 'Resume'} style={{ width: 40, height: 40, borderRadius: 999, border: 'none', background: 'rgba(255,255,255,.22)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={narrateState === 'playing' ? 'pause' : 'play'} size={18} color="#fff" /></button>
            <button onClick={stopNarration} aria-label="Stop" style={{ width: 40, height: 40, borderRadius: 999, border: 'none', background: 'rgba(255,255,255,.22)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="x" size={18} color="#fff" /></button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const navBtnStyle = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '13px', borderRadius: 15, border: '1px solid var(--line)', background: 'var(--surface)',
  cursor: 'pointer', color: 'var(--ink-2)', fontWeight: 600, fontSize: 14, fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)',
};

Object.assign(window, { ReadScreen });
