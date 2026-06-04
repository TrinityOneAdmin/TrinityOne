// screens-library.jsx — modules home (Bibles, Commentaries, Dictionaries, Devotionals, Books, Journals) + collections + journal
function ModuleTile({ m, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18,
      background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', boxShadow: 'var(--shadow)',
    }}>
      <div style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0,
        background: `color-mix(in oklab, ${m.accent} 16%, var(--surface))`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: m.accent }}>
        <Icon name={m.icon} size={23} stroke={1.8} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>{m.name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{m.count}</div>
      </div>
      <Icon name="chevR" size={18} color="var(--ink-3)" />
    </div>
  );
}

function LibraryScreen({ ctx }) {
  const D = window.LumenData;
  const libParam = new URLSearchParams(location.search).get('lib');
  const [view, setView] = React.useState(libParam === 'watch' ? 'watch' : 'library');
  return (
    <ScreenScroll>
      <h1 style={{ margin: '0 0 14px', fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, letterSpacing: '-.5px', animation: 'lumenFade .5s ease both' }}>Library</h1>

      {/* segmented: Library / Watch */}
      <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 15, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 20 }}>
        {[['library', 'Library', 'library'], ['watch', 'Watch', 'play']].map(([id, label, ic]) => {
          const on = view === id;
          return (
            <button key={id} onClick={() => setView(id)} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px',
              borderRadius: 11, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14,
              background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--clay)' : 'var(--ink-2)',
              boxShadow: on ? 'var(--shadow)' : 'none', transition: 'all .2s',
            }}><Icon name={ic} size={17} stroke={on ? 2.1 : 1.8} />{label}</button>
          );
        })}
      </div>

      {view === 'watch' ? <WatchView ctx={ctx} /> : <LibraryHome ctx={ctx} />}
    </ScreenScroll>
  );
}

// icon + accent per module category
const CAT_STYLE = {
  bibles:       { icon: 'book',    accent: 'var(--clay)' },
  dictionaries: { icon: 'lex',     accent: 'var(--gold)' },
  commentaries: { icon: 'comment', accent: 'var(--sage)' },
  devotionals:  { icon: 'sun',     accent: 'var(--clay)' },
};

function LibraryHome({ ctx }) {
  const D = window.LumenData;
  const [, force] = React.useState(0);
  React.useEffect(() => window.Bible.subscribe(() => force(x => x + 1)), []);

  // what the user has actually installed
  const versions = window.Bible.versions();                       // loaded bibles (+ any module sources)
  const installed = Object.values(window.Bible.installedMap());   // all registered downloads
  const dictCount = installed.filter(m => (m.category || '') === 'dictionaries').length;

  return (
    <React.Fragment>
      {/* collections strip */}
      <div className="no-scrollbar" style={{ display: 'flex', gap: 10, overflowX: 'auto', margin: '0 -18px 22px', padding: '0 18px', animation: 'lumenFade .5s ease .05s both' }}>
        {D.COLLECTIONS.map(c => (
          <button key={c.id} onClick={() => ctx.toast(`${c.name}: ${c.count}`)} style={{
            flexShrink: 0, width: 110, padding: '14px 14px', borderRadius: 18, border: '1px solid var(--line)',
            background: 'var(--surface)', cursor: 'pointer', textAlign: 'left', color: 'var(--ink)', boxShadow: 'var(--shadow)',
          }}>
            <Icon name={c.icon} size={22} color="var(--clay)" />
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, marginTop: 8, lineHeight: 1 }}>{c.count}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600, marginTop: 2 }}>{c.name}</div>
          </button>
        ))}
      </div>

      <SectionLabel action="Get modules" onAction={() => ctx.openStore()}>Installed</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 24, animation: 'lumenFade .5s ease .1s both' }}>
        {versions.map(v => {
          const active = window.Bible.activeVersion === v.abbr;
          return (
            <ModuleTile key={v.abbr} m={{
              name: v.name, count: active ? `${v.abbr} · reading now` : v.abbr,
              icon: (CAT_STYLE[v.kind === 'mysword' || v.kind === 'usfm' ? 'bibles' : v.kind] || CAT_STYLE.bibles).icon,
              accent: 'var(--clay)',
            }} onClick={() => { window.Bible.setActive(v.abbr); ctx.go('read'); }} />
          );
        })}
        {dictCount > 0 && (
          <ModuleTile m={{ name: 'Dictionaries & Lexicons', count: `${dictCount} installed`, icon: 'lex', accent: 'var(--gold)' }}
            onClick={() => ctx.toast(`${dictCount} dictionary module${dictCount > 1 ? 's' : ''} active`)} />
        )}
        <button onClick={() => ctx.openStore()} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: 14, borderRadius: 18,
          background: 'transparent', border: '1.5px dashed var(--line)', cursor: 'pointer', color: 'var(--clay)',
          fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14.5,
        }}>
          <Icon name="plus" size={19} stroke={2.2} /> Get more modules
        </button>
      </div>

      <SectionLabel action="New" onAction={() => ctx.toast('New journal entry')}>Recent journal</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11, animation: 'lumenFade .5s ease .15s both' }}>
        {D.JOURNAL.map(j => (
          <div key={j.id} onClick={() => ctx.openJournal(j)} style={{
            padding: 15, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)',
            cursor: 'pointer', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow)',
          }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: j.color }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--clay)' }}>{j.ref}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{j.date}</span>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 3 }}>{j.title}</div>
            <p style={{ margin: 0, fontFamily: 'var(--font-read)', fontSize: 15, lineHeight: 1.5, color: 'var(--ink-2)',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{j.body}</p>
          </div>
        ))}
      </div>
    </React.Fragment>
  );
}

// ── journal entry overlay ──
function JournalView({ entry, open, onClose }) {
  if (!entry) return null;
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px 6px' }}>
          <IconBtn name="chevD" onClick={onClose} />
          <IconBtn name="pen" onClick={() => {}} />
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '12px 22px 30px' }}>
        <span style={{ display: 'inline-block', background: entry.color, color: 'var(--ink)', padding: '5px 12px',
          borderRadius: 999, fontSize: 12.5, fontWeight: 700, marginBottom: 14 }}>{entry.ref}</span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, margin: '0 0 6px', lineHeight: 1.1 }}>{entry.title}</h1>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 22 }}>{entry.date}</div>
        <p style={{ fontFamily: 'var(--font-read)', fontSize: 19, lineHeight: 1.65, color: 'var(--ink)', textWrap: 'pretty' }}>{entry.body}</p>
      </div>
    </Overlay>
  );
}

// ── Module Store: download catalog entries (download-once → cached on device) ──
function Spinner({ size = 18 }) {
  return <div style={{ width: size, height: size, borderRadius: 999, border: '2.5px solid var(--clay-soft)',
    borderTopColor: 'var(--clay)', animation: 'lumenSpin .8s linear infinite' }} />;
}

function StoreRow({ item, catIcon, ctx }) {
  const isImport = item.kind === 'import';
  const installing = !isImport && window.Bible.isInstalling(item.url);
  const installed = !isImport && window.Bible.isInstalled(item.url);

  const onGet = () => {
    if (isImport) { window.Bible.pickFile(); return; }
    window.Bible.installModule(item)
      .then(() => ctx.toast(`Installed ${item.abbr || item.name}`))
      .catch(() => ctx.toast(`Couldn't install ${item.name}`));
  };
  const onOpen = () => {
    // an installed bible: make it active and jump to the reader
    if (item.kind !== 'dict') { const v = window.Bible.versions().find(x => x.name === item.name); if (v) window.Bible.setActive(v.abbr); ctx.go('read'); ctx.closeStore(); }
    else ctx.toast(`${item.abbr || item.name} is active`);
  };

  return (
    <div style={{ display: 'flex', gap: 12, padding: '13px 4px', borderBottom: '1px solid var(--line-2)' }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, marginTop: 2,
        background: 'color-mix(in oklab, var(--clay) 13%, var(--surface))',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--clay)' }}>
        <Icon name={isImport ? 'plus' : catIcon} size={21} stroke={1.8} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>{item.name}</div>
        {!isImport && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 600, margin: '2px 0 3px' }}>
            {[item.lang, item.size, item.license].filter(Boolean).join('  ·  ')}
          </div>
        )}
        {item.desc && <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.4 }}>{item.desc}</div>}
      </div>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-start', paddingTop: 2 }}>
        {installing ? (
          <div style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>
        ) : installed ? (
          <button onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid var(--line)',
            background: 'var(--surface)', color: 'var(--sage)', borderRadius: 11, padding: '7px 11px', cursor: 'pointer',
            fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5 }}>
            <Icon name="check" size={15} stroke={2.4} /> Installed
          </button>
        ) : (
          <button onClick={onGet} style={{ display: 'flex', alignItems: 'center', gap: 5, border: 'none',
            background: 'var(--clay)', color: '#fff', borderRadius: 11, padding: '8px 13px', cursor: 'pointer',
            fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, boxShadow: 'var(--shadow)' }}>
            <Icon name={isImport ? 'plus' : 'arrowUp'} size={15} stroke={2.2} style={{ transform: isImport ? 'none' : 'rotate(180deg)' }} />
            {isImport ? 'Import' : 'Get'}
          </button>
        )}
      </div>
    </div>
  );
}

// "Browse by language" tier — the deep eBible.org mirror (1,290 translations)
function MirrorBrowser({ mirror, ctx }) {
  const [lang, setLang] = React.useState('eng');
  const [q, setQ] = React.useState('');
  const query = q.trim().toLowerCase();

  // top languages as quick chips; the rest are reachable via search
  const topLangs = mirror.languages.slice(0, 12);
  const curLang = mirror.languages.find(l => l.code === lang);

  let items;
  if (query) {
    items = mirror.items.filter(i =>
      i.name.toLowerCase().includes(query) || i.abbr.toLowerCase().includes(query) ||
      i.langName.toLowerCase().includes(query)).slice(0, 80);
  } else {
    items = mirror.items.filter(i => i.lang === lang);
  }

  return (
    <React.Fragment>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '2px 0 12px', display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name="library" size={15} color="var(--ink-3)" />
        {mirror.items.length.toLocaleString()} translations · {mirror.languages.length.toLocaleString()} languages · downloads in the app
      </div>

      {/* search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 42, marginBottom: 12,
        background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 13 }}>
        <Icon name="study" size={17} color="var(--ink-3)" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search all translations & languages"
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--ink)',
            fontFamily: 'var(--font-ui)', fontSize: 14 }} />
        {q && <button onClick={() => setQ('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="x" size={16} /></button>}
      </div>

      {/* language chips (hidden while searching) */}
      {!query && (
        <div className="no-scrollbar" style={{ display: 'flex', gap: 7, overflowX: 'auto', margin: '0 -18px 14px', padding: '0 18px' }}>
          {topLangs.map(l => (
            <Chip key={l.code} active={l.code === lang} onClick={() => setLang(l.code)}>{l.name} · {l.count}</Chip>
          ))}
          {curLang && !topLangs.some(l => l.code === lang) && <Chip active onClick={() => {}}>{curLang.name} · {curLang.count}</Chip>}
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600, margin: '0 0 4px' }}>
        {query ? `${items.length}${items.length === 80 ? '+' : ''} match${items.length === 1 ? '' : 'es'}`
               : `${curLang ? curLang.name : ''} · ${items.length} translation${items.length === 1 ? '' : 's'}`}
      </div>
      <div>{items.map(item => <StoreRow key={item.id} item={{ ...item, lang: item.langName, size: item.scope }} catIcon="book" ctx={ctx} />)}</div>
      {!items.length && <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5 }}>No translations found.</div>}
    </React.Fragment>
  );
}

function ModuleStore({ open, onClose, ctx, initialView }) {
  const [, force] = React.useState(0);
  const [cat, setCat] = React.useState(null);
  const [mirror, setMirror] = React.useState(null);
  const [view, setView] = React.useState(initialView || 'featured');
  React.useEffect(() => window.Bible.subscribe(() => force(x => x + 1)), []);
  React.useEffect(() => { if (open && !cat) window.Bible.getCatalog().then(setCat); }, [open]);
  React.useEffect(() => { if (open && view === 'language' && !mirror) window.Bible.getMirror().then(setMirror); }, [open, view]);

  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 18px 10px' }}>
          <IconBtn name="chevD" onClick={onClose} />
          <div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700, lineHeight: 1.1 }}>Get Modules</h1>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Download once — stays on your device</div>
          </div>
        </div>
        {/* segmented: Featured / By language */}
        <div style={{ display: 'flex', gap: 4, padding: 4, margin: '0 18px', borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          {[['featured', 'Featured'], ['language', 'By language']].map(([id, label]) => {
            const on = view === id;
            return (
              <button key={id} onClick={() => setView(id)} style={{
                flex: 1, padding: '9px', borderRadius: 11, border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5,
                background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--clay)' : 'var(--ink-2)',
                boxShadow: on ? 'var(--shadow)' : 'none', transition: 'all .2s',
              }}>{label}</button>
            );
          })}
        </div>
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 30px' }}>
        {view === 'featured' ? (
          !cat ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner size={26} /></div>
          : (cat.categories || []).map(c => {
            const ic = (CAT_STYLE[c.id] || CAT_STYLE.bibles).icon;
            return (
              <div key={c.id} style={{ marginBottom: 22 }}>
                <SectionLabel>{c.name}</SectionLabel>
                <div>{(c.items || []).map(item => <StoreRow key={item.id} item={item} catIcon={ic} ctx={ctx} />)}</div>
              </div>
            );
          })
        ) : (
          !mirror ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner size={26} /></div>
          : <MirrorBrowser mirror={mirror} ctx={ctx} />
        )}
      </div>
    </Overlay>
  );
}

Object.assign(window, { LibraryScreen, JournalView, ModuleStore });
