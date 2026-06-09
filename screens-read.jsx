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
function VerseRow({ n, html, hl, note, bookmarked, selected, onSelect, onWord }) {
  return (
    <span style={{ position: 'relative' }}>
      <span
        onClick={(e) => {
          const sup = e.target.closest && e.target.closest('sup.st');
          if (sup) { e.stopPropagation(); onWord((sup.dataset.s || '').split(',')[0]); }
          else { onSelect(n); }
        }}
        style={{
          cursor: 'pointer', borderRadius: 6,
          outline: selected ? '2px solid var(--clay)' : 'none', outlineOffset: 3,
          background: selected ? 'color-mix(in oklab, var(--clay) 8%, transparent)' : 'transparent',
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
        } : null} dangerouslySetInnerHTML={{ __html: html }} />
        {note ? <Icon name="note" size={14} color="var(--gold)" style={{ verticalAlign: 'middle', marginLeft: 4 }} /> : null}
      </span>{' '}
    </span>
  );
}

// ── header ──
function ReadHeader({ ctx, loc, version, onBook, onVersion, onSettings, compare, onCompare }) {
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, paddingTop: 50,
      background: 'color-mix(in oklab, var(--paper) 88%, transparent)',
      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      borderBottom: '1px solid var(--line-2)',
    }}>
      <div style={{ padding: '8px 14px 0' }}>
        <ReadPlansTabs ctx={ctx} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 11px' }}>
        <button onClick={onBook} style={{
          display: 'flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer',
          background: 'var(--surface)', boxShadow: 'var(--shadow)', borderRadius: 13, padding: '9px 13px',
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink)',
        }}>{loc.book} {loc.ch}<Icon name="chevD" size={15} stroke={2.2} color="var(--ink-3)" /></button>
        <button onClick={onVersion} style={{
          display: 'flex', alignItems: 'center', gap: 5, border: '1px solid var(--line)', cursor: 'pointer', background: 'var(--surface)',
          borderRadius: 13, padding: '9px 11px', fontWeight: 700, fontSize: 13, color: 'var(--clay)',
          boxShadow: 'var(--shadow)', maxWidth: 130, whiteSpace: 'nowrap',
        }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{version}</span><Icon name="chevD" size={14} stroke={2.2} color="var(--clay)" style={{ flexShrink: 0 }} /></button>
        <div style={{ flex: 1 }} />
        <IconBtn name="study" onClick={() => ctx.openSearch()} />
        <IconBtn name="compare" onClick={onCompare} style={compare ? { background: 'var(--clay)', color: '#fff', borderColor: 'var(--clay)' } : {}} />
        <IconBtn name="sliders" onClick={onSettings} />
      </div>
    </div>
  );
}

// ── verse action sheet ──
function ActionSheet({ label, ctx, open, onClose, onColor, curColor, onNote, onCross, onCommentary, bookmarked, hasNote }) {
  const acts = [
    { ic: 'pen', label: 'Note', fn: onNote },
    { ic: 'bookmark', label: bookmarked ? 'Saved' : 'Bookmark', fn: ctx._bm, active: bookmarked },
    { ic: 'copy', label: 'Copy', fn: ctx._copy },
    { ic: 'share', label: 'Share', fn: ctx._share },
    ...(hasNote ? [{ ic: 'pen', label: 'Share note', fn: ctx._shareNote }] : []),
    { ic: 'link', label: 'Cross-refs', fn: onCross },
    { ic: 'comment', label: 'Commentary', fn: onCommentary },
  ];
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>Verse selected</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>{label}</div>
        </div>
        <IconBtn name="x" onClick={onClose} />
      </div>
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
function WordStudySheet({ id, open, onClose }) {
  const e = id ? window.Bible.lex(id) : null;
  return (
    <BottomSheet open={open} onClose={onClose}>
      {e ? <div style={{ paddingBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--clay)', fontWeight: 700, letterSpacing: '.5px' }}>STRONG'S {e.id} · {e.lang}</div>
            {e.missing
              ? <div style={{ fontFamily: 'var(--font-read)', fontSize: 30, fontWeight: 500, lineHeight: 1.1, marginTop: 6 }}>{e.id}</div>
              : <React.Fragment>
                  <div style={{ fontFamily: 'var(--font-read)', fontSize: 38, fontWeight: 500, lineHeight: 1.1, marginTop: 4 }}>{e.lemma}</div>
                  <div style={{ fontSize: 16, color: 'var(--ink-2)', fontStyle: 'italic', fontFamily: 'var(--font-read)' }}>{e.translit} · <span style={{ fontStyle: 'normal', fontFamily: 'var(--font-ui)', fontSize: 13 }}>{e.pos}</span></div>
                </React.Fragment>}
          </div>
          <IconBtn name="x" onClick={onClose} />
        </div>
        {e.missing ? (
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 17, lineHeight: 1.6, color: 'var(--ink-2)', margin: '18px 0 6px', textWrap: 'pretty' }}>
            No entry in the built-in lexicon for this number. A dictionary module (<span style={{ fontFamily: 'var(--font-ui)', fontSize: 13 }}>.dct.mybible</span>) would supply the full definition.
          </p>
        ) : <React.Fragment>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--clay-soft)', color: 'var(--clay-ink)',
            padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, margin: '16px 0 14px' }}>
            <Icon name="sparkle" size={15} stroke={2} /> {e.short}
          </div>
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 18, lineHeight: 1.6, color: 'var(--ink)', margin: '0 0 18px', textWrap: 'pretty' }}>{e.gloss}</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 16, padding: '13px 15px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--clay)' }}>{e.occ}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 600 }}>occurrences in scripture</div>
            </div>
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
  const seeded = loc && loc.book === 43 && loc.chap === 1;
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
  const add = (item) => { ctx.toast('Adding ' + item.abbr + '…'); window.Bible.installModule(item).then(() => ctx.toast(item.abbr + ' added')).catch(() => ctx.toast("Couldn't add " + item.abbr)); };

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
function BookPicker({ open, onClose, onPick }) {
  const B = window.Bible.bookMeta();
  const [sel, setSel] = useS(null);
  useE(() => { if (!open) setSel(null); }, [open]);
  const groups = [['ot', 'OLD TESTAMENT'], ['nt', 'NEW TESTAMENT']].filter(([g]) => B.some(b => b.group === g));
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 52 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px 12px' }}>
          <IconBtn name={sel ? 'chevL' : 'x'} onClick={() => sel ? setSel(null) : onClose()} />
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700 }}>{sel ? sel.name : 'Books'}</h1>
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '0 16px 24px' }}>
        {!sel ? groups.map(([g, title]) => (
          <div key={g} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '4px 0 10px' }}>{title}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {B.filter(b => b.group === g).map(b => (
                <button key={b.num} onClick={() => (b.ch > 1 ? setSel(b) : onPick(b.num, 1))} style={{
                  padding: '12px 16px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)',
                  cursor: 'pointer', fontWeight: 600, fontSize: 15, color: 'var(--ink)', fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)',
                }}>{b.name}</button>
              ))}
            </div>
          </div>
        )) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 9 }}>
            {Array.from({ length: sel.ch }, (_, i) => i + 1).map(c => (
              <button key={c} onClick={() => onPick(sel.num, c)} style={{
                aspectRatio: '1', borderRadius: 13, border: '1px solid var(--line)',
                background: 'var(--surface)', cursor: 'pointer',
                fontWeight: 700, fontSize: 15, color: 'var(--ink)', fontFamily: 'var(--font-display)',
              }}>{c}</button>
            ))}
          </div>
        )}
      </div>
    </Overlay>
  );
}

// ── main read screen ──
function ReadScreen({ ctx }) {
  const Bible = window.Bible;
  const loc = ctx.loc || Bible.defaultLoc() || { book: 43, chap: 1 };
  const version = ctx.version;
  const [compare, setCompare] = useS(false);
  const [scale, setScale] = useS(() => lsGet('trinityone.readerScale', 1.08));
  const [serif, setSerif] = useS(() => lsGet('trinityone.readerSerif', true));
  const [showStrongs, setShowStrongs] = useS(false);
  const [sel, setSel] = useS(null);
  const [sheet, setSheet] = useS(new URLSearchParams(location.search).get('sheet') || null);
  const [wordId, setWordId] = useS(null);
  const scrollRef = useR();
  useE(() => { lsSet('trinityone.readerScale', scale); }, [scale]);
  useE(() => { lsSet('trinityone.readerSerif', serif); }, [serif]);
  // arriving on a specific verse (from Today / Search): select it, scroll up
  useE(() => { setSel(loc.verse || null); if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [loc.book, loc.chap, loc.verse, version]);

  const verses = Bible.getVerses(loc.book, loc.chap, version);
  const vlist = Bible.versions();
  const cmpAbbr = compare === true ? ((vlist.find(v => v.abbr !== version) || {}).abbr || version) : compare;
  const cmpVerses = cmpAbbr ? Bible.getVerses(loc.book, loc.chap, cmpAbbr) : [];

  const bname = Bible.bookName(loc.book);
  const labelOf = (v) => Bible.refLabel(loc, v);
  const keyOf = (v) => Bible.refKey(loc, v);

  const close = () => setSheet(null);
  const selectVerse = (n) => { setSel(n); setSheet('action'); };
  const openWord = (id) => { setWordId(id); setSheet('word'); };

  const selRow = verses.find(x => String(x.v) === String(sel));
  const sheetCtx = {
    toast: ctx.toast,
    _bm: () => { const k = keyOf(sel); ctx.toggleBookmark(k); ctx.toast(ctx.bookmarks.includes(k) ? 'Bookmark removed' : 'Bookmarked'); },
    _copy: () => { try { navigator.clipboard && navigator.clipboard.writeText(labelOf(sel) + ' — ' + (selRow ? selRow.text : '')); } catch (e) {} close(); ctx.toast('Copied to clipboard'); },
    _share: () => { close(); ctx.openShareSheet({ ref: labelOf(sel), text: selRow ? selRow.text : '', version }); },
    _shareNote: () => { close(); ctx.openShareSheet({ type: 'note', ref: labelOf(sel), text: selRow ? selRow.text : '', version, note: ctx.notes[keyOf(sel)] || '' }); },
  };

  const prev = Bible.step(loc, -1), next = Bible.step(loc, 1);
  const readFont = serif ? 'var(--font-read)' : 'var(--font-ui)';
  const rs = ctx.readScale || 1;
  const baseSize = (serif ? 21 : 18) * scale * rs;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ReadHeader ctx={ctx} loc={{ book: bname, ch: loc.chap }} version={version}
        onBook={() => setSheet('book')} onVersion={() => setSheet('version')}
        onSettings={() => setSheet('settings')} compare={!!compare} onCompare={() => setCompare(c => c ? false : true)} />

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
                    selected={String(sel) === String(row.v)} onSelect={selectVerse} onWord={openWord} />
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

      <ActionSheet label={labelOf(sel)} ctx={sheetCtx} open={sheet === 'action'} onClose={close}
        curColor={ctx.highlights[keyOf(sel)]} onColor={(c) => { ctx.setHighlight(keyOf(sel), c); }}
        bookmarked={ctx.bookmarks.includes(keyOf(sel))} hasNote={!!ctx.notes[keyOf(sel)]}
        onNote={() => setSheet('note')} onCross={() => setSheet('cross')} onCommentary={() => setSheet('commentary')} />
      <WordStudySheet id={wordId} open={sheet === 'word'} onClose={close} />
      <CrossRefSheet loc={loc} v={sel} label={labelOf(sel)} open={sheet === 'cross'} onClose={() => setSheet('action')} ctx={ctx} />
      <CommentarySheet loc={loc} label={bname + ' ' + loc.chap} open={sheet === 'commentary'} onClose={() => setSheet('action')} />
      <NoteEditor label={labelOf(sel)} open={sheet === 'note'} value={ctx.notes[keyOf(sel)]} onClose={() => setSheet('action')}
        onSave={(t) => { ctx.setNote(keyOf(sel), t); setSheet('action'); ctx.toast('Note saved'); }} />
      <VersionSheet open={sheet === 'version'} onClose={close} version={version} ctx={ctx} onPick={(k) => { ctx.setVersion(k); close(); }} onAdd={() => { close(); ctx.addModule(); }} />
      <SettingsSheet open={sheet === 'settings'} onClose={close} scale={scale} setScale={setScale}
        serif={serif} setSerif={setSerif} showStrongs={showStrongs} setShowStrongs={setShowStrongs} ctx={ctx} />
      <BookPicker open={sheet === 'book'} onClose={close}
        onPick={(book, c) => { close(); ctx.setLoc({ book, chap: c }); }} />
    </div>
  );
}

const navBtnStyle = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '13px', borderRadius: 15, border: '1px solid var(--line)', background: 'var(--surface)',
  cursor: 'pointer', color: 'var(--ink-2)', fontWeight: 600, fontSize: 14, fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)',
};

Object.assign(window, { ReadScreen });
