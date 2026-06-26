// screens-library.jsx — modules home (Bibles, Commentaries, Dictionaries, Devotionals, Books, Journals) + collections + journal
function ModuleTile({ m, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18,
      background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', boxShadow: 'var(--shadow)'
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
    </div>);

}

function LibraryScreen({ ctx }) {
  const D = window.TrinityData;
  const [view, setView] = React.useState('library');
  return (
    <ScreenScroll>
      <h1 style={{ margin: '0 0 14px', fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, letterSpacing: '-.5px', animation: 'lumenFade .5s ease both' }}>Library</h1>

      {/* segmented: Library / Watch */}
      <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 15, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 20 }} data-comment-anchor="dd2234f87c-div-30-7">
        {[['library', 'Library', 'library'], ['watch', 'Watch', 'play']].map(([id, label, ic]) => {
          const on = view === id;
          return (
            <button key={id} onClick={() => setView(id)} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px',
              borderRadius: 11, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14,
              background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--clay)' : 'var(--ink-2)',
              boxShadow: on ? 'var(--shadow)' : 'none', transition: 'all .2s'
            }}><Icon name={ic} size={17} stroke={on ? 2.1 : 1.8} />{label}</button>);

        })}
      </div>

      {view === 'watch' ? <WatchView ctx={ctx} /> : <LibraryHome ctx={ctx} />}
    </ScreenScroll>);

}

function LibraryHome({ ctx }) {
  const D = window.TrinityData;
  // honest module counts from what's actually installed (was hardcoded "12 versions / 8 sets / 3 entries" fakes)
  const inst = (window.Bible && window.Bible.installedMap && window.Bible.installedMap()) || {};
  const byCat = {}; for (const v of Object.values(inst)) { const c = (v && v.category) || 'bibles'; byCat[c] = (byCat[c] || 0) + 1; }
  const nBibles = (window.Bible && window.Bible.versions ? window.Bible.versions().length : 0) || byCat.bibles || 0;
  const nJournals = (ctx.journalEntries || []).length;
  const nDevos = (ctx.churchDevos || []).length;   // devotionals are steward-published, not installed modules
  const countFor = (id) => {
    if (id === 'journals') return nJournals === 0 ? 'None yet' : nJournals + (nJournals === 1 ? ' entry' : ' entries');
    if (id === 'devotionals') return nDevos === 0 ? 'From your church' : nDevos + (nDevos === 1 ? ' devotional' : ' devotionals');
    const n = id === 'bibles' ? nBibles : (byCat[id] || 0);
    if (n === 0) return 'None yet';
    const noun = id === 'bibles' ? 'version' : id === 'commentaries' ? 'set' : id === 'dictionaries' ? 'reference' : 'item';
    return n + ' ' + noun + (n === 1 ? '' : 's');
  };
  return (
    <React.Fragment>
      {/* collections strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 22, animation: 'lumenFade .5s ease .05s both' }}>
        {D.COLLECTIONS.map((c) =>
        <button key={c.id} onClick={() => ctx.openCollection(c)} style={{
          flex: 1, minWidth: 0, padding: '13px 10px', borderRadius: 16, border: '1px solid var(--line)',
          background: 'var(--surface)', cursor: 'pointer', textAlign: 'left', color: 'var(--ink)', boxShadow: 'var(--shadow)'
        }}>
            <Icon name={c.icon} size={20} color="var(--clay)" />
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 700, marginTop: 7, lineHeight: 1 }}>{window.MyData.count(c.id)}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-2)', fontWeight: 600, marginTop: 3, lineHeight: 1.15 }}>{c.name}</div>
          </button>
        )}
      </div>

      <SectionLabel>Modules</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 24, animation: 'lumenFade .5s ease .1s both' }}>
        {D.MODULES.map((m) => <ModuleTile key={m.id} m={{ ...m, count: countFor(m.id) }} onClick={() =>
          m.id === 'bibles' ? ctx.openStore('language', 'bibles')
          : m.id === 'dictionaries' ? ctx.openStore('featured', 'dictionaries')
          : m.id === 'commentaries' ? ctx.openStore('featured', 'commentaries')
          : m.id === 'devotionals' ? ctx.go('plans')   // devotionals are steward-published — live in Plans/Today, not a download catalog
          : ctx.openModule(m)
        } />)}
      </div>

      <SectionLabel>Listen</SectionLabel>
      <div style={{ marginBottom: 24, animation: 'lumenFade .5s ease .12s both' }}>
        <button onClick={() => ctx.openAudioBibles()} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18, border: '1px solid var(--line)', background: 'var(--surface)', boxShadow: 'var(--shadow)', cursor: 'pointer', fontFamily: 'var(--font-ui)', textAlign: 'left' }}>
          <div style={{ width: 46, height: 46, borderRadius: 13, flexShrink: 0, background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="headphones" size={22} color="currentColor" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>Audio Bibles</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Download the World English Bible to listen offline</div>
          </div>
          <Icon name="chevR" size={18} color="var(--ink-3)" />
        </button>
      </div>

      <SectionLabel action="+ New" onAction={() => ctx.newJournal()}>Recent journal</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11, animation: 'lumenFade .5s ease .15s both' }}>
        {(ctx.journalEntries || D.JOURNAL).length === 0 ? (
          <button onClick={() => ctx.newJournal()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '30px 20px', borderRadius: 18,
            border: '1px dashed var(--line)', background: 'var(--surface-2)', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--font-ui)' }}>
            <Icon name="pen" size={24} color="var(--clay)" />
            <span style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--ink-2)' }}>Start your first reflection</span>
          </button>
        ) : null}
        {(ctx.journalEntries || D.JOURNAL).map((j) =>
        <div key={j.id} onClick={() => ctx.openJournal(j)} style={{
          padding: 15, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)',
          cursor: 'pointer', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow)'
        }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: j.color }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--clay)' }}>{j.ref || 'Reflection'}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{j.date}</span>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 3 }}>{j.title}</div>
            <p style={{ margin: 0, fontFamily: 'var(--font-read)', fontSize: 15, lineHeight: 1.5, color: 'var(--ink-2)',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{j.body}</p>
          </div>
        )}
      </div>
    </React.Fragment>);

}

// ── encrypted full backup (keys, journals, notes, highlights, books) ──
function BackupCard({ ctx }) {
  const [picking, setPicking] = React.useState(false);
  const [pass, setPass] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState('');     // '' | 'local' | 'cloud'
  const [done, setDone] = React.useState(null);   // null | 'device' | 'downloads' | 'cloud'
  const fileRef = React.useRef(null);
  const secure = (typeof window !== 'undefined') && window.isSecureContext && (typeof crypto !== 'undefined') && crypto.subtle;

  const INCLUDED = [
  { ic: 'key', label: 'Recovery key', sealed: true },
  { ic: 'pen', label: 'Journals & notes' },
  { ic: 'marker', label: 'Highlights' },
  { ic: 'bookmark', label: 'Bookmarks' },
  { ic: 'books', label: 'Downloaded books' }];

  const strength = pass.length === 0 ? null
    : pass.length < 4 ? { t: 'Too short', c: 'var(--ink-3)' }
    : /^\d+$/.test(pass) && pass.length < 6 ? { t: 'PIN — easy to use, easier to guess', c: 'var(--clay)' }
    : pass.length < 8 ? { t: 'OK', c: 'var(--gold)' }
    : { t: 'Strong', c: 'var(--sage)' };

  const run = async (mode) => {
    if (!secure) { ctx.toast('Open the app over https to make a backup'); return; }
    if (pass.length < 4) { ctx.toast('Use at least 4 characters (a PIN is fine)'); return; }
    setBusy(mode);
    try {
      const obj = window.TrinityBackup.collectMember();
      const text = await window.TrinityBackup.encryptObj(obj, pass);
      const name = 'trinityone-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      const res = await window.TrinityBackup.saveFile(name, text, mode);
      setBusy(''); setDone((res && res.where) || mode);
      ctx.toast(mode === 'local' ? 'Saved to your device' : 'Backup ready to store');
      setTimeout(() => { setDone(null); setPicking(false); setPass(''); }, 2200);
    } catch (e) { setBusy(''); ctx.toast('Backup failed: ' + (e.message || e)); }
  };

  const onRestoreFile = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    const p = window.prompt('Enter the passphrase or PIN for this backup file:'); if (p == null) return;
    try {
      const text = await window.TrinityBackup.readFile(f);
      const obj = await window.TrinityBackup.decryptStr(text, p);
      await window.TrinityBackup.applyMember(obj);
      ctx.toast('Backup restored');
    } catch (err) { ctx.toast(err.message || 'Couldn’t restore that file'); }
  };

  return (
    <div style={{ marginBottom: 13, borderRadius: 18, background: 'var(--surface-2)', border: '1px solid var(--line)', overflow: 'hidden' }}>
      <input ref={fileRef} type="file" accept="application/json,.json" onChange={onRestoreFile} style={{ display: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px 11px' }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0, background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="cloud" size={21} stroke={1.9} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Back up your data</div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.35 }}>An encrypted copy of your notes, journals, highlights & books — restore on a new phone in seconds.</div>
        </div>
        {!picking ? <button onClick={() => setPicking(true)} style={{ border: 'none', background: 'var(--clay)', color: '#fff',
          fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)', padding: '9px 14px', borderRadius: 11, flexShrink: 0 }}>Back up</button> : null}
      </div>

      {/* what's included */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 15px 11px' }}>
        {INCLUDED.map((it) =>
        <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999,
          background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)' }}>
            <Icon name={it.ic} size={13} color={it.sealed ? 'var(--clay)' : 'var(--ink-3)'} />{it.label}
            {it.sealed ? <Icon name="lock" size={11} color="var(--clay)" /> : null}
          </span>
        )}
      </div>

      {/* security note — always visible */}
      <div style={{ display: 'flex', gap: 8, padding: '0 15px 13px', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>
        <Icon name="shield" size={14} color="var(--sage)" style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Sealed on this phone with a passphrase only you know — restore it later from a file on your device or cloud drive. If you lose the passphrase, no one can open it. <b style={{ color: 'var(--ink-2)' }}>Your paper recovery key still matters</b> — it restores your account even without this file.</span>
      </div>

      {picking ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '0 12px 13px', animation: 'lumenFade .2s ease both' }}>
        {!secure ? (
          <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, transparent)', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}>
            <Icon name="lock" size={15} color="var(--clay)" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>You’re on an <b>http</b> address — the browser disables encryption here. Open the app over <b>https</b> to create a backup.</span>
          </div>
        ) : null}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.4px', color: 'var(--ink-3)', padding: '2px 3px 0', textTransform: 'uppercase' }}>Passphrase or PIN</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={pass} onChange={e => setPass(e.target.value)} type={show ? 'text' : 'password'} placeholder="a memorable passphrase, or a PIN"
            style={{ flex: 1, height: 44, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 14.5, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
          <button onClick={() => setShow(s => !s)} style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', borderRadius: 12, padding: '0 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>{show ? 'Hide' : 'Show'}</button>
        </div>
        {strength ? <div style={{ fontSize: 11.5, color: strength.c, fontWeight: 600, padding: '0 3px' }}>{strength.t}</div> : null}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => run('local')} disabled={!!busy || pass.length < 4 || !secure} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '12px', borderRadius: 12,
            border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', opacity: (busy || pass.length < 4 || !secure) ? 0.55 : 1 }}>
            <Icon name={done === 'device' || done === 'downloads' ? 'check' : 'arrowUp'} size={16} color="var(--clay)" style={done === 'device' || done === 'downloads' ? null : { transform: 'rotate(180deg)' }} /> {busy === 'local' ? 'Saving…' : (done === 'device' || done === 'downloads') ? 'Saved' : 'Save to device'}</button>
          <button onClick={() => run('cloud')} disabled={!!busy || pass.length < 4 || !secure} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '12px', borderRadius: 12,
            border: 'none', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)', opacity: (busy || pass.length < 4 || !secure) ? 0.55 : 1 }}>
            <Icon name={done === 'cloud' ? 'check' : 'cloud'} size={16} color="#fff" /> {busy === 'cloud' ? 'Sealing…' : done === 'cloud' ? 'Ready' : 'Save to cloud'}</button>
        </div>
        <button onClick={() => fileRef.current && fileRef.current.click()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px', borderRadius: 12,
          border: 'none', background: 'transparent', color: 'var(--ink-2)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
          <Icon name="refresh" size={15} color="var(--ink-3)" /> Restore from a backup file</button>
      </div>
      ) : null}
    </div>);

}

// ── journal entry overlay ──
function JournalView({ entry, open, onClose, ctx }) {
  if (!entry) return null;
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px 6px' }}>
          <IconBtn name="chevD" onClick={onClose} />
          <IconBtn name="pen" onClick={() => { onClose(); setTimeout(() => ctx && ctx.editJournal(entry), 220); }} />
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '12px 22px 30px' }}>
        <span style={{ display: 'inline-block', background: entry.color, color: 'var(--ink)', padding: '5px 12px',
          borderRadius: 999, fontSize: 12.5, fontWeight: 700, marginBottom: 14 }}>{entry.ref || 'Reflection'}</span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, margin: '0 0 6px', lineHeight: 1.1 }}>{entry.title}</h1>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 22 }}>{entry.date}</div>
        <p style={{ fontFamily: 'var(--font-read)', fontSize: 19, lineHeight: 1.65, color: 'var(--ink)', textWrap: 'pretty', whiteSpace: 'pre-wrap' }}>{entry.body}</p>
      </div>
    </Overlay>);

}

// ── journal editor (create / edit / delete) ──
const JOURNAL_COLORS = ['var(--hl-yellow)', 'var(--hl-green)', 'var(--hl-pink)', 'var(--hl-blue)', 'var(--hl-clay)'];

function JournalEditor({ entry, open, onClose, ctx }) {
  const editing = !!(entry && entry.id);
  const [ref, setRef] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [color, setColor] = React.useState('var(--hl-yellow)');
  React.useEffect(() => {
    if (open) {
      setRef((entry && entry.ref) || '');
      setTitle((entry && entry.title) || '');
      setBody((entry && entry.body) || '');
      setColor((entry && entry.color) || 'var(--hl-yellow)');
    }
  }, [open, entry && entry.id]);

  const canSave = !!(title.trim() || body.trim());
  const save = () => {
    if (!canSave) return;
    ctx.saveJournal({
      id: (entry && entry.id) || ('j' + Date.now()),
      date: (entry && entry.date) || 'Today',
      ref: ref.trim(), color,
      title: title.trim() || 'Untitled',
      body: body.trim(),
    });
    onClose();
    ctx.toast(editing ? 'Journal updated' : 'Journal saved');
  };
  const del = () => { ctx.deleteJournal(entry.id); onClose(); ctx.toast('Entry deleted'); };

  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, flexShrink: 0, borderBottom: '1px solid var(--line-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 14px 11px' }}>
          <button onClick={onClose} style={{ border: 'none', background: 'none', color: 'var(--ink-2)', fontWeight: 600, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Cancel</button>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{editing ? 'Edit entry' : 'New entry'}</div>
          <button onClick={save} disabled={!canSave} style={{ border: 'none', borderRadius: 11, padding: '8px 17px', background: 'var(--clay)', color: '#fff',
            fontWeight: 700, fontSize: 14, cursor: canSave ? 'pointer' : 'default', fontFamily: 'var(--font-ui)', opacity: canSave ? 1 : .4 }}>Save</button>
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 42, padding: '0 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 16 }}>
          <Icon name="link" size={16} color="var(--clay)" />
          <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Link a verse — e.g. John 1:4 (optional)" style={{
            flex: 1, minWidth: 0, border: 'none', background: 'none', outline: 'none', fontSize: 14, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 18 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)' }}>Marker</span>
          <div style={{ display: 'flex', gap: 9 }}>
            {JOURNAL_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} aria-label="marker color" style={{ width: 28, height: 28, borderRadius: 999, background: c, cursor: 'pointer',
                border: color === c ? '2.5px solid var(--ink)' : '2px solid var(--line)' }} />
            ))}
          </div>
        </div>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" style={{ width: '100%', border: 'none', background: 'none', outline: 'none',
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 25, letterSpacing: '-.4px', color: 'var(--ink)', marginBottom: 10, padding: 0 }} />
        <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Write your reflection…" rows={11} style={{ width: '100%', border: 'none', background: 'none', outline: 'none', resize: 'none',
          fontFamily: 'var(--font-read)', fontSize: 18, lineHeight: 1.65, color: 'var(--ink)', minHeight: 230 }} />
        {editing ? (
          <button onClick={del} style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderRadius: 12,
            border: '1px solid color-mix(in oklab, var(--clay) 30%, var(--line))', background: 'var(--surface)', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
            <Icon name="trash" size={16} color="var(--clay)" /> Delete entry</button>
        ) : null}
      </div>
    </Overlay>);

}

// ── module collection (drill-in from Library) with scoped search ──
function ModuleView({ module, open, onClose, ctx }) {
  const D = window.TrinityData;
  const [q, setQ] = React.useState('');
  const [cat, setCat] = React.useState('All');
  React.useEffect(() => { if (open) { setQ(''); setCat('All'); } }, [open, module && module.id]);
  if (!module) return null;

  const raw = module.id === 'journals'
    ? (ctx.journalEntries || D.JOURNAL).map(j => ({ id: j.id, name: j.title, sub: (j.ref || 'Reflection') + ' · ' + j.date, journal: j, downloaded: true }))
    : module.id === 'books'
    // books: reflect the REAL per-device download state (set by the reader), not a hard-coded flag
    ? (D.MODULE_ITEMS.books || []).map(it => ({ ...it, downloaded: (typeof isDownloaded === 'function' && isDownloaded(it.id)) }))
    : (D.MODULE_ITEMS[module.id] || []);
  const cats = ['All', ...Array.from(new Set(raw.map(it => it.cat).filter(Boolean)))];
  const catFiltered = cat === 'All' ? raw : raw.filter(it => it.cat === cat);
  const ql = q.trim().toLowerCase();
  const items = ql ? catFiltered.filter(it => (it.name + ' ' + (it.sub || '')).toLowerCase().includes(ql)) : catFiltered;
  const accent = module.accent;

  const openItem = (it) => {
    if (it.journal) { onClose(); setTimeout(() => ctx.openJournal(it.journal), 200); return; }
    if (module.id === 'dictionaries' && it.id === 'strongs') { onClose(); setTimeout(() => ctx.openConcordance(), 200); return; }
    if (module.id === 'bibles') { ctx.toast(it.current ? it.abbr + ' is your reading version' : it.abbr + ' set as your reading version'); return; }
    if (module.id === 'books') { ctx.openBook(it); return; }
    ctx.toast('Opening ' + it.name);
  };

  return (
    <Overlay open={open} onClose={onClose}>
      {/* header */}
      <div style={{ paddingTop: 50, flexShrink: 0, background: 'color-mix(in oklab, var(--paper) 92%, transparent)', borderBottom: '1px solid var(--line-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 12px' }}>
          <IconBtn name="chevL" onClick={onClose} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700, letterSpacing: '-.4px', lineHeight: 1.1 }}>{module.name}</h1>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 1 }}>{raw.length} in your library</div>
          </div>
          <div style={{ width: 40, height: 40, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `color-mix(in oklab, ${accent} 16%, var(--surface))`, color: accent }}>
            <Icon name={module.icon} size={22} stroke={1.8} /></div>
        </div>
        {/* scoped search */}
        <div style={{ padding: '0 16px 13px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 42, padding: '0 14px', borderRadius: 13,
            background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <Icon name="study" size={17} color="var(--ink-3)" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${module.name}`} style={{
              flex: 1, minWidth: 0, border: 'none', background: 'none', outline: 'none', fontSize: 14.5,
              color: 'var(--ink)', fontFamily: 'var(--font-ui)' }} />
            {q ? <button onClick={() => setQ('')} aria-label="Clear" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 2 }}><Icon name="x" size={16} /></button> : null}
          </div>
        </div>
        {cats.length > 1 ? (
          <div className="no-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0 16px 12px' }}>
            {cats.map(c => <Chip key={c} active={cat === c} onClick={() => setCat(c)} accent={accent}>{c}</Chip>)}
          </div>
        ) : null}
      </div>

      {/* list */}
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 30px' }}>
        {items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--ink-3)' }}>
            <Icon name="study" size={30} color="var(--ink-3)" />
            <p style={{ margin: '12px 0 0', fontSize: 14.5 }}>No matches in {module.name}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {items.map(it => (
              <div key={it.id} onClick={() => openItem(it)} style={{
                display: 'flex', alignItems: 'center', gap: 13, padding: 13, borderRadius: 16,
                background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', boxShadow: 'var(--shadow)' }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `color-mix(in oklab, ${accent} ${it.current ? 22 : 13}%, var(--surface))`, color: accent }}>
                  {it.abbr ? <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: it.abbr.length > 3 ? 12 : 13.5, letterSpacing: '-.3px' }}>{it.abbr}</span>
                    : <Icon name={module.icon} size={21} stroke={1.8} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14.5, color: 'var(--ink)', lineHeight: 1.18,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{it.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.sub}</div>
                </div>
                {it.current ? (
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.3px', color: '#fff', background: accent, padding: '4px 10px', borderRadius: 999, flexShrink: 0 }}>CURRENT</span>
                ) : it.downloaded ? (
                  <Icon name="cloudCheck" size={20} color="var(--sage)" style={{ flexShrink: 0 }} />
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); if (module.id === 'books') { ctx.openBook(it); } else { ctx.toast('Downloading ' + it.name + '…'); } }} style={{
                    flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 10,
                    border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink-2)', fontWeight: 700, fontSize: 12.5,
                    cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
                    <Icon name={module.id === 'books' ? 'book' : 'cloud'} size={15} color="var(--ink-3)" /> {module.id === 'books' ? 'Read' : 'Get'}</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Overlay>);

}

// small private/public chip — surfaces (and toggles) the MyData visibility flag
function VisChip({ visibility, onClick }) {
  const priv = visibility === 'private';
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick && onClick(); }} title={priv ? 'Private — only you' : 'Public'} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 999, cursor: onClick ? 'pointer' : 'default',
      border: '1px solid var(--line)', background: priv ? 'var(--surface-2)' : 'color-mix(in oklab, var(--sage) 12%, var(--surface))',
      color: priv ? 'var(--ink-3)' : 'var(--sage)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 10.5, letterSpacing: '.3px' }}>
      <Icon name={priv ? 'lock' : 'globe'} size={11} color="currentColor" />{priv ? 'Private' : 'Public'}</button>
  );
}

// ── collection drill-in (Highlights / Bookmarks / Notes / Prayer list / Cross refs) ──
// User-owned types read + manage through window.MyData; cross-refs stay reference data.
function CollectionView({ coll, open, onClose, ctx }) {
  const D = window.TrinityData;
  const MD = window.MyData;
  const [q, setQ] = React.useState('');
  const [, force] = React.useState(0);
  const [adding, setAdding] = React.useState(false);
  const [pWho, setPWho] = React.useState('');
  const [pText, setPText] = React.useState('');
  React.useEffect(() => { if (open) { setQ(''); setAdding(false); setPWho(''); setPText(''); } }, [open, coll && coll.id]);
  React.useEffect(() => MD.on(() => force(x => x + 1)), []);
  if (!coll) return null;

  const isXref = coll.id === 'crossrefs';
  const isNotes = coll.id === 'notes';
  const isPrayer = coll.id === 'prayer';
  const owned = !isXref;   // user-owned types are managed; cross-refs are read-only reference data

  const raw = isXref ? (D.COLLECTION_ITEMS.crossrefs || []) : MD.list(coll.id);
  const ql = q.trim().toLowerCase();
  const items = ql ? raw.filter(it => ((it.ref || '') + ' ' + (it.text || '') + ' ' + (it.who || '')).toLowerCase().includes(ql)) : raw;
  const blurb = { highlights: 'Verses you’ve marked', bookmarks: 'Saved for later', notes: 'Your reflections in the margin',
    prayer: 'People and things you’re praying for', crossrefs: 'Where scripture echoes scripture' }[coll.id];

  const jump = (it) => { if (!it.ref) return; onClose(); setTimeout(() => ctx.openReader(), 200); ctx.toast('Jumping to ' + it.ref); };
  const del = (it) => { MD.remove(coll.id, it.id); ctx.toast('Removed'); };
  const toggleVis = (it) => MD.setVisibility(coll.id, it.id, it.visibility === 'private' ? 'public' : 'private');
  const savePrayer = () => {
    if (!pText.trim() && !pWho.trim()) return;
    MD.put('prayer', { who: pWho.trim() || 'A request', text: pText.trim(), answered: false, date: 'Today' });
    setPWho(''); setPText(''); setAdding(false); ctx.toast('Added to your prayer list');
  };

  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, flexShrink: 0, background: 'color-mix(in oklab, var(--paper) 92%, transparent)', borderBottom: '1px solid var(--line-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 12px' }}>
          <IconBtn name="chevL" onClick={onClose} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700, letterSpacing: '-.4px', lineHeight: 1.1 }}>{coll.name}</h1>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 1 }}>{raw.length} · {blurb}</div>
          </div>
          {isPrayer ? <IconBtn name="plus" onClick={() => setAdding(a => !a)} /> :
            <div style={{ width: 40, height: 40, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)' }}><Icon name={coll.icon} size={21} stroke={1.8} /></div>}
        </div>
        <div style={{ padding: '0 16px 13px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 42, padding: '0 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <Icon name="study" size={17} color="var(--ink-3)" />
            <input value={q} onChange={ev => setQ(ev.target.value)} placeholder={`Search ${coll.name}`} style={{
              flex: 1, minWidth: 0, border: 'none', background: 'none', outline: 'none', fontSize: 14.5, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }} />
            {q ? <button onClick={() => setQ('')} aria-label="Clear" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 2 }}><Icon name="x" size={16} /></button> : null}
          </div>
        </div>
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 30px' }}>
        {/* prayer add form */}
        {isPrayer && adding ? (
          <div style={{ marginBottom: 14, padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', animation: 'trinityFade .2s ease both' }}>
            <input value={pWho} onChange={e => setPWho(e.target.value)} placeholder="Who or what? (e.g. Mum)" style={{
              width: '100%', boxSizing: 'border-box', height: 42, padding: '0 12px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface-2)', outline: 'none', fontSize: 14.5, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-ui)', marginBottom: 9 }} />
            <textarea value={pText} onChange={e => setPText(e.target.value)} rows={2} placeholder="What are you praying for?" style={{
              width: '100%', boxSizing: 'border-box', resize: 'none', padding: '10px 12px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface-2)', outline: 'none', fontFamily: 'var(--font-read)', fontSize: 15, lineHeight: 1.5, color: 'var(--ink)' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={() => { setAdding(false); setPWho(''); setPText(''); }} style={{ flex: 1, padding: 10, borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Cancel</button>
              <button onClick={savePrayer} style={{ flex: 1, padding: 10, borderRadius: 11, border: 'none', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Add</button>
            </div>
          </div>
        ) : null}

        {items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--ink-3)' }}>
            <Icon name={coll.icon} size={30} color="var(--ink-3)" />
            <p style={{ margin: '12px 0 0', fontSize: 14.5 }}>{q ? `No matches in ${coll.name}` : (isPrayer ? 'Add someone or something to pray for.' : `Nothing in ${coll.name} yet.`)}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {items.map((it) => (
              <div key={it.id || it.ref} onClick={() => !isPrayer && jump(it)} style={{
                padding: 15, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', cursor: it.ref && !isPrayer ? 'pointer' : 'default', boxShadow: 'var(--shadow)',
                position: 'relative', overflow: 'hidden', paddingLeft: it.color ? 18 : 15, opacity: it.answered ? .62 : 1 }}>
                {it.color ? <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: it.color }} /> : null}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5, gap: 8 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 700, color: 'var(--clay)', fontSize: 13.5, minWidth: 0 }}>
                    {isXref ? <Icon name="link" size={14} color="var(--clay)" /> : null}
                    {coll.id === 'bookmarks' ? <Icon name="bookmark" size={13} color="var(--clay)" fill /> : null}
                    {isPrayer ? <Icon name="pray" size={14} color="var(--clay)" /> : null}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isPrayer ? it.who : it.ref}{isPrayer && it.answered ? ' · answered 🙏' : ''}</span>
                  </span>
                  {isNotes || isPrayer ? <span style={{ fontSize: 12, color: 'var(--ink-3)', flexShrink: 0 }}>{it.date}</span> : (!owned ? <Icon name="chevR" size={16} color="var(--ink-3)" /> : null)}
                </div>
                <p style={{ margin: 0, fontFamily: isXref ? 'var(--font-ui)' : 'var(--font-read)', fontSize: isXref ? 13.5 : 16, fontWeight: isXref ? 600 : 400,
                  lineHeight: 1.5, color: isXref ? 'var(--ink-2)' : 'var(--ink)', textWrap: 'pretty',
                  display: '-webkit-box', WebkitLineClamp: isNotes || isPrayer ? 3 : 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{it.text}</p>

                {/* management footer (user-owned only) */}
                {owned ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11 }} onClick={e => e.stopPropagation()}>
                    <VisChip visibility={it.visibility} onClick={() => toggleVis(it)} />
                    {isPrayer ? (
                      <button onClick={() => MD.put('prayer', { ...it, answered: !it.answered })} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
                        border: '1px solid var(--line)', background: it.answered ? 'color-mix(in oklab, var(--sage) 14%, var(--surface))' : 'var(--surface-2)', color: it.answered ? 'var(--sage)' : 'var(--ink-2)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 10.5 }}>
                        <Icon name="check" size={11} stroke={2.6} color="currentColor" />{it.answered ? 'Answered' : 'Mark answered'}</button>
                    ) : null}
                    <div style={{ flex: 1 }} />
                    <button onClick={() => del(it)} aria-label="Delete" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 3 }}><Icon name="trash" size={16} /></button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </Overlay>);

}

// ── real module download store (preserved from the live app; not in the design mock) ──
const CAT_STYLE = {
  bibles:       { icon: 'book',    accent: 'var(--clay)' },
  dictionaries: { icon: 'lex',     accent: 'var(--gold)' },
  commentaries: { icon: 'comment', accent: 'var(--sage)' },
  devotionals:  { icon: 'sun',     accent: 'var(--clay)' },
};

function Spinner({ size = 18 }) {
  return <div style={{ width: size, height: size, borderRadius: 999, border: '2.5px solid var(--clay-soft)',
    borderTopColor: 'var(--clay)', animation: 'trinitySpin .8s linear infinite' }} />;
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

// "Installed" tier — everything downloaded onto this device, removable (except the active Bible)
function InstalledBrowser({ ctx, category, force }) {
  const map = window.Bible.installedMap();
  const active = window.Bible.activeVersion;
  let rows = Object.values(map);
  if (category) rows = rows.filter(r => (r.category || 'bibles') === category);
  rows.sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || ''));

  const CAT_LABEL = { bibles: 'Bible', dictionaries: 'Dictionary', commentaries: 'Commentary', devotionals: 'Devotional' };
  const remove = (r) => {
    if (r.abbr === active) { ctx.toast('Switch to another Bible before removing this one'); return; }
    if (window.Bible.removeModule(r.abbr)) { ctx.toast(`Removed ${r.abbr || r.name}`); force(x => x + 1); }
    else ctx.toast(`Couldn't remove ${r.name}`);
  };

  if (!rows.length) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>
      <div style={{ width: 52, height: 52, borderRadius: 15, background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}><Icon name="library" size={24} /></div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink)', marginBottom: 6 }}>Nothing installed yet</div>
      <p style={{ fontSize: 13.5, lineHeight: 1.55, maxWidth: 260, margin: '0 auto' }}>Modules you download appear here, ready to read offline.</p>
    </div>
  );

  return (
    <React.Fragment>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '2px 0 12px', display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name="check" size={15} color="var(--sage)" stroke={2.4} />
        {rows.length} module{rows.length === 1 ? '' : 's'} on this device
      </div>
      {rows.map(r => {
        const isActive = r.abbr === active;
        return (
          <div key={r.url} style={{ display: 'flex', gap: 12, padding: '13px 4px', borderBottom: '1px solid var(--line-2)', alignItems: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0,
              background: 'color-mix(in oklab, var(--clay) 13%, var(--surface))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--clay)' }}>
              <Icon name={(CAT_STYLE[r.category] || CAT_STYLE.bibles).icon} size={21} stroke={1.8} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>{r.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 600, margin: '2px 0 0' }}>
                {[CAT_LABEL[r.category] || 'Module', r.abbr, isActive ? 'Active' : null].filter(Boolean).join('  ·  ')}
              </div>
            </div>
            <button onClick={() => remove(r)} disabled={isActive} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
              border: '1px solid var(--line)', background: 'var(--surface)', color: isActive ? 'var(--ink-3)' : 'var(--danger, #c0392b)',
              borderRadius: 11, padding: '7px 11px', cursor: isActive ? 'default' : 'pointer', opacity: isActive ? 0.5 : 1,
              fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5 }}>
              <Icon name="trash" size={14} stroke={2.2} /> Remove
            </button>
          </div>
        );
      })}
    </React.Fragment>
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

function ModuleStore({ open, onClose, ctx, initialView, category }) {
  const [, force] = React.useState(0);
  const [cat, setCat] = React.useState(null);
  const [mirror, setMirror] = React.useState(null);
  const [view, setView] = React.useState(initialView || 'featured');
  const showLang = !category || category === 'bibles';   // "By language" (eBible mirror) is bibles-only
  const titleFor = category ? ({ bibles: 'Bibles', dictionaries: 'Dictionaries & Lexicons', commentaries: 'Commentaries', devotionals: 'Devotionals' }[category] || 'Get Modules') : 'Get Modules';
  React.useEffect(() => window.Bible.subscribe(() => force(x => x + 1)), []);
  React.useEffect(() => { if (open) setView(initialView || 'featured'); }, [open, initialView]);
  React.useEffect(() => { if (open && !cat) window.Bible.getCatalog().then(setCat); }, [open]);
  React.useEffect(() => { if (open && view === 'language' && !mirror) window.Bible.getMirror().then(setMirror); }, [open, view]);

  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 18px 10px' }}>
          <IconBtn name="chevD" onClick={onClose} />
          <div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700, lineHeight: 1.1 }}>{titleFor}</h1>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Download once — stays on your device</div>
          </div>
        </div>
        {/* segmented: Featured / All bibles (full eBible mirror, bibles only) / Installed */}
        <div style={{ display: 'flex', gap: 4, padding: 4, margin: '0 18px', borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          {[['featured', 'Featured'], ...(showLang ? [['language', 'All bibles']] : []), ['installed', 'Installed']].map(([id, label]) => {
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
          : (cat.categories || []).filter(c => !category || c.id === category).map(c => {
            const ic = (CAT_STYLE[c.id] || CAT_STYLE.bibles).icon;
            return (
              <div key={c.id} style={{ marginBottom: 22 }}>
                <SectionLabel>{c.name}</SectionLabel>
                <div>{(c.items || []).map(item => <StoreRow key={item.id} item={item} catIcon={ic} ctx={ctx} />)}</div>
              </div>
            );
          })
        ) : view === 'installed' ? (
          <InstalledBrowser ctx={ctx} category={category} force={force} />
        ) : (
          !mirror ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner size={26} /></div>
          : <MirrorBrowser mirror={mirror} ctx={ctx} />
        )}
      </div>
    </Overlay>
  );
}

Object.assign(window, { LibraryScreen, LibraryHome, BackupCard, JournalView, JournalEditor,
  ModuleView, CollectionView, ModuleTile, ModuleStore });
