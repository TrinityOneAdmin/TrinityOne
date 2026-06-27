// app.jsx — TrinityOne root: nav, theme, shared state, overlays, tweaks
const { useState: useA, useEffect: useAE, useRef: useAR } = React;

const ACCENTS = {
  clay:   { light: { c: '#C25A38', i: '#A8462A', s: '#F3DECF', d: '#9C4327' }, dark: { c: '#E68A66', i: '#EE9E7E', s: '#43271B', d: '#C2613B' } },
  indigo: { light: { c: '#5360D6', i: '#3E49B8', s: '#E2E3F7', d: '#3A43A0' }, dark: { c: '#8E97EE', i: '#A6ADF2', s: '#262A52', d: '#5A63C0' } },
  teal:   { light: { c: '#1F9488', i: '#147A70', s: '#D2EEEA', d: '#136B62' }, dark: { c: '#52C2B4', i: '#6FD0C3', s: '#16403B', d: '#2E9488' } },
  berry:  { light: { c: '#C24B7A', i: '#A53A65', s: '#F6D8E4', d: '#9C3A60' }, dark: { c: '#E681A8', i: '#EE9BBC', s: '#4A2333', d: '#C25C84' } },
};
const READ_FONTS = {
  Newsreader: "'Newsreader', Georgia, serif",
  Lora: "'Newsreader', Georgia, serif",
};

// ── persisted settings (replaces the design-tool tweaks panel) ──
const SETTINGS_DEFAULTS = { dark: false, accent: 'clay', readScale: 1 };
function lsGet(key, fallback){ try{ const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }catch(e){ return fallback; } }
function lsSet(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }
function useSettings(){
  const [s, setS] = useA(() => Object.assign({}, SETTINGS_DEFAULTS, lsGet('trinityone.settings', {})));
  const set = (k, v) => setS(prev => { const n = { ...prev, [k]: v }; lsSet('trinityone.settings', n); return n; });
  return [s, set];
}
// subscribe a component to the engine (module load / active-version changes)
function useBible(){
  const [, force] = useA(0);
  useAE(() => window.Bible.subscribe(() => force(x => x + 1)), []);
  return window.Bible;
}

// ── share verse card ──
const CARD_STYLES = [
  { id: 'clay', bg: 'linear-gradient(155deg, var(--clay), var(--clay-deep))', fg: '#fff', serif: true },
  { id: 'sage', bg: 'linear-gradient(155deg, #6BA17C, #3C6E57)', fg: '#fff', serif: true },
  { id: 'paper', bg: 'var(--surface)', fg: 'var(--ink)', serif: true, bordered: true },
  { id: 'night', bg: 'linear-gradient(155deg, #2a2218, #16120c)', fg: '#F3ECDC', serif: true },
];
function ShareCard({ verse, open, onClose, ctx }) {
  const [style, setStyle] = useA(0);
  useAE(() => { if (open) setStyle(0); }, [open]);
  if (!verse) return null;
  const s = CARD_STYLES[style];
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px' }}>
          <IconBtn name="chevD" onClick={onClose} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>Share verse</span>
          <IconBtn name="share" onClick={() => { onClose(); ctx.toast('Card ready to share'); }} />
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 26px' }}>
          <div style={{
            width: '100%', aspectRatio: '4/5', borderRadius: 26, background: s.bg, color: s.fg,
            border: s.bordered ? '1px solid var(--line)' : 'none', boxShadow: 'var(--shadow-lg)',
            display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 30, position: 'relative', overflow: 'hidden',
            transition: 'background .3s',
          }}>
            <div style={{ position: 'absolute', right: -20, top: -20, opacity: s.bordered ? .06 : .14 }}>
              <Icon name="sparkle" size={130} stroke={1.3} color={s.fg} /></div>
            <Icon name="sparkle" size={26} stroke={1.8} color={s.id === 'clay' ? '#fff' : 'var(--clay)'} />
            <p style={{ fontFamily: s.serif ? 'var(--font-read)' : 'var(--font-ui)', fontSize: 25, lineHeight: 1.4,
              fontWeight: 500, margin: '18px 0 20px', textWrap: 'pretty' }}>“{verse.text}”</p>
            <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14, letterSpacing: '.5px',
              color: s.bordered ? 'var(--clay)' : s.fg, opacity: s.bordered ? 1 : .9 }}>{verse.ref} · {verse.version || 'WEB'}</div>
            <div style={{ position: 'absolute', bottom: 16, right: 22, fontSize: 11, fontWeight: 700, letterSpacing: '1px', opacity: .5 }}>TRINITYONE</div>
          </div>
        </div>
        <div style={{ padding: '4px 26px 8px' }}>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 18 }}>
            {CARD_STYLES.map((c, i) => (
              <button key={c.id} onClick={() => setStyle(i)} style={{
                width: 46, height: 46, borderRadius: 14, background: c.bg, cursor: 'pointer',
                border: style === i ? '2.5px solid var(--clay)' : '1px solid var(--line)', flexShrink: 0,
              }} />
            ))}
          </div>
          <button onClick={() => { onClose(); ctx.toast('Saved to Photos'); }} style={{
            width: '100%', padding: 15, borderRadius: 16, border: 'none', background: 'var(--clay)', color: '#fff',
            fontWeight: 700, fontSize: 15.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', marginBottom: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}><Icon name="arrowUp" size={18} color="#fff" /> Save image</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── devotional overlay ──
function DevotionalView({ open, onClose, ctx }) {
  const d = window.TrinityData.DEVOTIONAL;
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, background: 'linear-gradient(160deg, #6BA17C, #3C6E57)', color: '#fff', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', right: -24, top: -10, opacity: .18 }}><Icon name="sun" size={150} stroke={1.3} color="#fff" /></div>
        <div style={{ padding: '10px 18px 24px', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button onClick={onClose} style={{ width: 40, height: 40, borderRadius: 13, border: 'none', background: 'rgba(255,255,255,.2)',
              color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="chevD" size={20} color="#fff" /></button>
            <button onClick={() => ctx.openShareSheet({ type: 'devotional', title: d.title, ref: d.ref, series: d.series, excerpt: (d.body && d.body[0]) || '' })}
              style={{ width: 40, height: 40, borderRadius: 13, border: 'none', background: 'rgba(255,255,255,.2)',
              color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="share" size={18} color="#fff" /></button>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', opacity: .9, marginTop: 16 }}>{d.series} · {d.day}</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 29, fontWeight: 700, margin: '6px 0 8px', lineHeight: 1.08 }}>{d.title}</h1>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,.2)', padding: '5px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700 }}>
            <Icon name="read" size={15} color="#fff" /> {d.ref} · {d.read}</div>
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '22px 22px 30px' }}>
        {d.body.map((para, i) => (
          <p key={i} style={{ fontFamily: 'var(--font-read)', fontSize: 18.5, lineHeight: 1.66, color: 'var(--ink)', margin: '0 0 16px', textWrap: 'pretty' }}>{para}</p>
        ))}
        <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 20, padding: 20, marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--clay)', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
            <Icon name="pen" size={16} /> REFLECT</div>
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 18, lineHeight: 1.55, color: 'var(--ink)', margin: '0 0 14px', fontStyle: 'italic' }}>{d.prompt}</p>
          <button onClick={() => { onClose(); ctx.go('library'); ctx.toast('Opening journal'); }} style={{
            border: 'none', background: 'var(--clay)', color: '#fff', padding: '11px 18px', borderRadius: 13,
            fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Write a reflection</button>
        </div>
        <button onClick={() => { onClose(); ctx.toast('Day 4 complete · streak 13'); }} style={{
          width: '100%', marginTop: 16, padding: 15, borderRadius: 16, border: '1.5px solid var(--clay)', background: 'transparent',
          color: 'var(--clay)', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="check" size={18} stroke={2.4} /> Mark complete</button>
      </div>
    </Overlay>
  );
}

// ── empty state: choose / download a Bible module ──
// while the first Bible downloads, sit with a word about waiting (KJV, public domain)
const PATIENCE_VERSES = [
  { t: 'But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary.', r: 'Isaiah 40:31' },
  { t: 'Rest in the LORD, and wait patiently for him.', r: 'Psalm 37:7' },
  { t: 'Be still, and know that I am God.', r: 'Psalm 46:10' },
  { t: 'Wait on the LORD: be of good courage, and he shall strengthen thine heart.', r: 'Psalm 27:14' },
  { t: 'Let us run with patience the race that is set before us.', r: 'Hebrews 12:1' },
  { t: 'In your patience possess ye your souls.', r: 'Luke 21:19' },
];

function EmptyState({ loading, error, onBrowse }) {
  const [verse] = useA(() => PATIENCE_VERSES[Math.floor(Math.random() * PATIENCE_VERSES.length)]);
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 34px', animation: 'trinityFade .5s ease both' }}>
      <div style={{ width: 76, height: 76, borderRadius: 24, background: 'linear-gradient(155deg, var(--clay), var(--clay-deep))',
        display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-lg)', marginBottom: 22 }}>
        <Icon name="read" size={38} color="#fff" />
      </div>
      {loading ? (
        <React.Fragment>
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 20, lineHeight: 1.5, color: 'var(--ink)', margin: '0 0 10px', maxWidth: 460, textWrap: 'pretty' }}>“{verse.t}”</p>
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 700, color: 'var(--clay)', letterSpacing: '.3px', marginBottom: 26 }}>{verse.r}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-3)', fontWeight: 700, fontSize: 14 }}>
            <div style={{ width: 18, height: 18, borderRadius: 999, border: '2.5px solid var(--clay-soft)', borderTopColor: 'var(--clay)', animation: 'trinitySpin .8s linear infinite' }} /> Bringing in your Bible…
          </div>
        </React.Fragment>
      ) : (
        <React.Fragment>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 27, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-.4px' }}>A quiet place to read.</h1>
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 17, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 0 26px', textWrap: 'pretty' }}>
            Add a translation to begin — the Berean Standard Bible downloads in moments, or browse 1,000+ more.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 13 }}>
            <button onClick={onBrowse} style={{
              display: 'inline-flex', alignItems: 'center', gap: 10, border: 'none', cursor: 'pointer',
              background: 'var(--clay)', color: '#fff', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 16,
              padding: '15px 26px', borderRadius: 16, boxShadow: 'var(--shadow-lg)' }}>
              <Icon name="plus" size={20} color="#fff" /> Browse translations
            </button>
            <button onClick={() => window.Bible.pickFile()} style={{
              border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-2)',
              fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 14 }}>
              or open a file from this device
            </button>
          </div>
        </React.Fragment>
      )}
      {error ? <p style={{ color: 'var(--clay-ink)', fontSize: 13, marginTop: 18, fontWeight: 600, lineHeight: 1.5 }}>
        {(typeof navigator !== 'undefined' && navigator.onLine === false)
          ? 'You appear to be offline. Connect to the internet and your Bible will download automatically.'
          : error}
      </p> : null}
      <p style={{ fontFamily: 'var(--font-ui)', fontSize: 12.5, color: 'var(--ink-3)', marginTop: 26 }}>Everything stays on this device — nothing is uploaded.</p>
    </div>
  );
}

// ── "Halo" boot splash: logo reveal, auto-dismiss (tap to skip) ──
function Splash({ onDone }) {
  useAE(() => { const t = setTimeout(onDone, 2350); return () => clearTimeout(t); }, []);
  return (
    <div className="to-splash" onClick={onDone}>
      <svg className="sp-mark" viewBox="0 0 100 100" aria-label="TrinityOne">
        <path className="sp-arc a1" d="M81.2 67.9 A36 36 0 0 1 31.3 80.7" />
        <path className="sp-arc a2" d="M18.8 68.0 A36 36 0 0 1 32.7 18.4" />
        <path className="sp-arc a3" d="M49.9 14.0 A36 36 0 0 1 86.0 50.8" />
        <circle className="sp-spark" cx="50" cy="50" r="6.5" />
      </svg>
      <div className="sp-wm">Trinity<span className="one">One</span></div>
      <div className="sp-tag">Read · Gather · Share</div>
    </div>
  );
}

function App() {
  const [t, setTweak] = useSettings();
  const Bible = useBible();
  const tabParam = new URLSearchParams(location.search).get('tab');
  // 4 tabs (today/read/chat/library); Plans is a view inside Read, Search is an overlay
  const [readView, setReadView] = useA(tabParam === 'plans' ? 'plans' : 'bible');  // 'bible' | 'plans'
  const [searchOpen, setSearchOpen] = useA(tabParam === 'search');
  const [tab, setTab] = useA(() => {
    if (tabParam === 'plans') return 'read';
    return ['today', 'read', 'chat', 'library'].includes(tabParam) ? tabParam : 'today';
  });
  const [toastMsg, setToastMsg] = useA('');
  const toastTimer = useAR();

  // reading location + active version (lifted so Today/Search can navigate)
  const [loc, setLoc] = useA(null);
  useAE(() => { if (Bible.loaded && !loc) setLoc(Bible.defaultLoc()); }, [Bible.loaded]);
  // deep-links: ?group=<id> opens a chat room, ?plan=<id> opens a plan
  useAE(() => {
    const sp = new URLSearchParams(location.search);
    if (!Bible.loaded) return;
    const gid = sp.get('group'); if (gid) { const g = window.TrinityData.GROUPS.find(x => x.id === gid) || { id: gid, name: gid, accent: 'var(--clay)', members: 0, prayer: /prayer/i.test(gid) }; setGroup(g); }
    const pid = sp.get('plan'); if (pid) { const p = window.TrinityData.PLANS.find(x => x.id === pid); if (p) setPlan(p); }
    if (sp.get('share')) setShareSheet(window.TrinityData.VOTD);
    const dm = sp.get('dm'); if (dm === 'inbox') setDmInbox(true); else if (dm) setDmPeer(dm);
  }, [Bible.loaded]);
  const version = Bible.activeVersion;

  // shared study state -- now owned by window.MyData (local store, swappable to encrypted Nostr).
  // Seed/migrate once, then re-render whenever the user's data changes.
  const MD = window.MyData;
  const [mdv, setMdv] = useA(0);
  useAE(() => {
    MD.seedIfEmpty(window.TrinityData);
    const off = MD.on(() => setMdv(x => x + 1));
    return off;
  }, []);
  // legacy-shaped projections the reader/screens already consume (keyed by "book.chap.verse")
  const highlights = Object.fromEntries(MD.list('highlights').map(h => [h.ref, h.color]));   // {ref: color}
  const notes = Object.fromEntries(MD.list('notes').map(n => [n.ref, n.text]));               // {ref: text}
  const bookmarks = MD.list('bookmarks').map(b => b.ref);                                      // [ref]
  const planProgress = MD.settings.get('plans', {});                                           // planId -> [done days]
  const devoProgress = MD.settings.get('devos', {});                                            // devoId -> [done days]
  const plansFollowed = MD.settings.get('plansFollowed', []);                                   // discover-plan ids the member added to My Plans
  const plansHidden = MD.settings.get('plansHidden', []);                                       // church-plan ids the member removed from My Plans

  // overlays
  const [share, setShare] = useA(null);
  const [shareSheet, setShareSheet] = useA(null);   // verse share chooser (image / send to group)
  const [devo, setDevo] = useA(false);
  const [plan, setPlan] = useA(null);
  const [journal, setJournal] = useA(null);
  const [wordOv, setWordOv] = useA(null);
  const [video, setVideo] = useA(null);
  const extraParam = new URLSearchParams(location.search).get('extra');  // 'notif' | 'listen'
  const [notif, setNotif] = useA(extraParam === 'notif');   // notifications overlay
  const [notifSettings, setNotifSettings] = useA(extraParam === 'notifsettings'); // notification settings overlay
  const [currencyOpen, setCurrencyOpen] = useA(extraParam === 'currency'); // currency picker overlay
  const [listen, setListen] = useA(extraParam === 'listen'); // audio Listen overlay
  const [audioBibles, setAudioBibles] = useA(false);   // Audio Bibles download library
  const concordParam = new URLSearchParams(location.search).get('concord');  // '1' = index, or a Strong's id (e.g. G5457)
  const [concord, setConcord] = useA(concordParam === '1');   // concordance index overlay
  const [allUses, setAllUses] = useA(/^[GH]\d/.test(concordParam || '') ? concordParam : null);  // per-lemma "all uses" (Strong's id)
  // library drill-ins
  const bookParam = new URLSearchParams(location.search).get('book');     // a BOOK_TEXT id, e.g. pilgrim
  const moduleParam = new URLSearchParams(location.search).get('mod');    // a MODULES id, e.g. books
  const collParam = new URLSearchParams(location.search).get('coll');     // a COLLECTIONS id, e.g. highlights|prayer
  const [module, setModule] = useA(() => window.TrinityData.MODULES.find(m => m.id === moduleParam) || null);
  const [collection, setCollection] = useA(() => window.TrinityData.COLLECTIONS.find(c => c.id === collParam) || null);  // saved-items collection overlay
  const [book, setBook] = useA(() => (window.TrinityData.MODULE_ITEMS.books || []).find(b => b.id === bookParam) || null);
  const [journalEditor, setJournalEditor] = useA(null);  // null | {} (new) | entry (edit)
  const journalEntries = MD.list('journal');
  const storeParam = new URLSearchParams(location.search).get('store'); // 'featured' | 'language'
  const [store, setStore] = useA(!!storeParam);
  const [storeView, setStoreView] = useA(null);   // 'featured' | 'language' when opened programmatically
  const [storeCat, setStoreCat] = useA(null);      // limit the store to one catalog category (e.g. 'dictionaries')
  const helpParam = new URLSearchParams(location.search).get('help');   // index | backup | <articleId>
  const [help, setHelp] = useA(helpParam || null);
  const idParam = new URLSearchParams(location.search).get('id');   // profile|recovery|invite|relays|newid|member
  const followParam = new URLSearchParams(location.search).get('follow');   // follow a church by its npub
  const inviteParam = new URLSearchParams(location.search).get('invite');   // a steward invite: adopt a ready-made identity + join
  const churchParam = new URLSearchParams(location.search).get('church');   // '1' / 'follow' opens the switcher
  const dmParam = new URLSearchParams(location.search).get('dm');   // inbox | <peer pubkey> (verification deep-link)
  const servingParam = new URLSearchParams(location.search).get('serving');   // '1' opens the Serving overlay
  const deepLinked = storeParam || tabParam || helpParam || concordParam || bookParam || moduleParam || collParam || churchParam || extraParam || idParam || followParam || inviteParam || dmParam || servingParam;   // any deep-link skips splash/onboarding
  const [showSplash, setShowSplash] = useA(!deepLinked);
  const onboardParam = new URLSearchParams(location.search).get('onboard');
  const [showOnboarding, setShowOnboarding] = useA(
    onboardParam === '1' || (!deepLinked && !lsGet('trinityone.onboarded', false))
  );
  // identity surfaces (ProfileSheet hub + the focused sheets)
  const [profile, setProfile] = useA(idParam === 'profile');
  const [member, setMember] = useA(idParam === 'member' ? window.TrinityData.MEMBERS.River : null);
  const [idSheet, setIdSheet] = useA(['recovery', 'invite', 'relays'].includes(idParam) ? idParam : null);
  const [newId, setNewId] = useA(idParam === 'newid');
  const [walletSheet, setWalletSheet] = useA(false);   // member wallet hub (balance + add + withdraw)
  const [confirmExit, setConfirmExit] = useA(false);   // hardware-back on Today -> confirm before close
  const [idTick, forceId] = useA(0);           // bumps on identity / profile changes (also re-runs subs that need myPubkey)
  useAE(() => {
    const h = () => forceId(x => x + 1);
    window.addEventListener('trinity-identity', h);
    window.addEventListener('trinity-profiles', h);
    return () => { window.removeEventListener('trinity-identity', h); window.removeEventListener('trinity-profiles', h); };
  }, []);
  // the in-app wallet is the member's, always-on (rides on their key) — boot it once so the balance is
  // ready everywhere (profile hub, Giving tab), independent of any church's giving switch.
  useAE(() => { if (window.TrinityWallet) window.TrinityWallet.init().catch(() => {}); }, []);
  // connTick bumps when the app returns to the foreground or the network reconnects. Relay WebSockets
  // drop while a phone is backgrounded, and a dropped socket silently misses live pushes — so we tear
  // down and re-establish the church subscriptions on resume, which re-queries and catches up anything
  // published while we were away (fixes "new devotionals/events don't appear until I reload").
  const [connTick, bumpConn] = useA(0);
  useAE(() => {
    let last = Date.now();
    const onVis = () => { if (document.visibilityState === 'visible' && Date.now() - last > 2500) { last = Date.now(); bumpConn(x => x + 1); } };
    const onOnline = () => bumpConn(x => x + 1);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onVis);
    // insurance: while foregrounded, refresh subscriptions every 90s so a silently-dropped relay socket
    // can't stall live content (announcements/notifications) for more than ~90s even without a reconnect.
    const beat = setInterval(() => { if (document.visibilityState === 'visible') { last = Date.now(); bumpConn(x => x + 1); } }, 90000);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', onOnline); window.removeEventListener('focus', onVis); clearInterval(beat); };
  }, []);
  // multi-church: groups + giving funds are scoped to the active church
  const [activeChurch, setActiveChurch] = useA(() => lsGet('trinityone.activeChurch', (window.TrinityData.CHURCHES[0] || {}).id || null));
  // churches the member follows persist across reloads (a scanned QR / pasted npub should stick).
  // Stored set = the real followed churches (npub ids); merged with the built-in sample churches.
  const [churches, setChurches] = useA(() => {
    const base = window.TrinityData.CHURCHES;
    const followed = (lsGet('trinityone.followedChurches', []) || []).filter(f => f && f.id && !base.find(b => b.id === f.id));
    return [...base, ...followed];
  });
  // persist the followed (real, npub-id) churches — incl. names resolved from the relay — on any change
  useAE(() => { try { lsSet('trinityone.followedChurches', churches.filter(c => typeof c.id === 'string' && c.id.indexOf('npub1') === 0)); } catch (e) {} }, [churches]);
  // on load, refresh each followed church's name/groups from the relay (names may have changed)
  useAE(() => {
    if (!(window.Fellowship && window.Fellowship.subscribeChurchProfile)) return;
    const followed = churches.filter(c => typeof c.id === 'string' && c.id.indexOf('npub1') === 0);
    // a followed church publishes across the whole shared pool — make sure every community node is in
    // the member's relay set (backfills for people who joined before extra nodes existed). addRelay
    // dedupes, so this is safe to run every load. Relays still only land once a church is/was joined.
    if (followed.length && window.Fellowship.addRelay) {
      const pool = window.Fellowship.CANONICAL_RELAYS || (window.Fellowship.CANONICAL_RELAY ? [window.Fellowship.CANONICAL_RELAY] : []);
      pool.forEach(r => window.Fellowship.addRelay(r));
    }
    const offs = followed.map(c =>
      window.Fellowship.subscribeChurchProfile(c.npub || c.id, (p) => {
        if (!p) return;
        setChurches(cs => cs.map(x => x.id === c.id ? { ...x, name: p.name || x.name, channel: p.channel != null ? p.channel : x.channel, audioFeed: p.audioFeed != null ? p.audioFeed : x.audioFeed, lnaddr: p.lud16 != null ? p.lud16 : x.lnaddr, giving: p.giving != null ? p.giving : x.giving, picture: p.picture != null ? p.picture : x.picture, banner: p.banner != null ? p.banner : x.banner, accent: p.accent != null ? p.accent : x.accent, features: p.features != null ? p.features : x.features, rules: p.rules != null ? p.rules : x.rules, initials: (p.name || x.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() } : x));
      }));
    return () => offs.forEach(o => { try { o && o(); } catch (e) {} });
  }, []);
  const [churchSwitcher, setChurchSwitcher] = useA(churchParam === '1' || churchParam === 'follow');
  const [churchSwitcherMode, setChurchSwitcherMode] = useA(churchParam === 'follow' ? 'follow' : 'list');
  // first-run prompt to follow a church — skippable (closing it lands them in the Bible). Only nudges
  // if they're not already following a real church (deep-linked joiners skip onboarding entirely).
  const promptFollowChurch = () => {
    const followsReal = !!(churches.find(c => c.id === activeChurch) || {}).npub;
    if (!followsReal) { setChurchSwitcherMode('follow'); setChurchSwitcher(true); }
  };
  // follow a real church by its npub (the steward shares it via QR/link/code): add it + make it
  // active, and resolve its name from the relay. The church's real groups (published by its console)
  // then load in chat. Accepts a bare npub OR anything containing one (a ?follow= link). Returns
  // false if no valid npub is found, else an unsubscribe fn.
  const followChurch = (raw) => {
    const m = String(raw || '').match(/npub1[0-9a-z]{20,}/);
    if (!m) return false;
    const npub = m[0];
    const F = window.Fellowship;
    if (F && F.addRelay) {
      // always connect to the whole shared pool (the church publishes across all of it), so a member
      // gets every community node for redundancy — not just the single relay carried in their link.
      const pool = F.CANONICAL_RELAYS || (F.CANONICAL_RELAY ? [F.CANONICAL_RELAY] : []);
      pool.forEach(r => F.addRelay(r));
      // plus any church-specific relay carried in the invite/QR (?relay=wss://…) — e.g. a self-hosted one
      const rm = String(raw || '').match(/[?&]relay=([^&\s]+)/);
      if (rm) { try { const relay = decodeURIComponent(rm[1]); if (/^wss?:\/\//i.test(relay)) F.addRelay(relay); } catch (e) {} }
    }
    setChurches(cs => cs.find(c => c.id === npub) ? cs : [...cs, { id: npub, npub, name: 'Church', initials: 'CH', accent: 'var(--clay)', tagline: '', sub: 'Followed', verified: false, members: 0 }]);
    setActiveChurch(npub); lsSet('trinityone.activeChurch', npub);
    // announce membership so the steward sees this person joined, even if they never post
    if (window.Fellowship && window.Fellowship.announceMembership) window.Fellowship.announceMembership(npub);
    if (!(window.Fellowship && window.Fellowship.subscribeChurchProfile)) return () => {};
    return window.Fellowship.subscribeChurchProfile(npub, (p) => {
      if (!p) return;
      setChurches(cs => cs.map(c => c.id === npub ? { ...c, name: p.name || c.name, channel: p.channel != null ? p.channel : c.channel, audioFeed: p.audioFeed != null ? p.audioFeed : c.audioFeed, lnaddr: p.lud16 != null ? p.lud16 : c.lnaddr, giving: p.giving != null ? p.giving : c.giving, picture: p.picture != null ? p.picture : c.picture, banner: p.banner != null ? p.banner : c.banner, accent: p.accent != null ? p.accent : c.accent, features: p.features != null ? p.features : c.features, rules: p.rules != null ? p.rules : c.rules, initials: (p.name || c.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() } : c));
    });
  };
  // leave a church: tombstone the membership (steward sees them drop) + stop following locally
  const leaveChurch = (npub) => {
    const F = window.Fellowship;
    if (F && F.leaveMembership) { try { F.leaveMembership(npub); } catch (e) {} }
    const remaining = churches.filter(c => c.id !== npub);
    setChurches(remaining);
    if (activeChurch === npub) {
      const next = (remaining.find(c => c.npub) || remaining[0] || {}).id || null;
      setActiveChurch(next); lsSet('trinityone.activeChurch', next);
    }
    toast('You’ve left the church');
  };
  // membership heartbeat: refresh the member event on launch so quiet members (who read but never
  // post) don't look inactive, and so an uninstalled app stops refreshing and ages out. Throttled ~12h.
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    const F = window.Fellowship;
    if (!np || !(F && F.announceMembership)) return;
    let last = 0; try { last = Number(localStorage.getItem('trinityone.hb:' + np) || 0); } catch {}
    if (Date.now() - last < 12 * 3600 * 1000) return;
    const beat = () => { F.announceMembership(np); try { localStorage.setItem('trinityone.hb:' + np, String(Date.now())); } catch {} };
    if (F.ready && F.ready.then) F.ready.then(beat).catch(() => {}); else beat();
  }, [activeChurch]);
  useAE(() => {
    if (!inviteParam && !followParam) return;
    let cleanup;
    (async () => {
      // a steward invite hands the recipient a ready-made anonymous identity — adopt it first, then join
      if (inviteParam && window.TrinityIdentity && window.TrinityIdentity.importMnemonic) {
        // SECURITY-AUDIT-2026-06-24 L8: an `?invite=<seed>` URL carries a BIP-39 mnemonic in cleartext.
        // For a fresh user this is the designed onboarding path. But if the user ALREADY has an identity,
        // following the link silently REPLACES their current key with one whose seed the link's author
        // also knows — total impersonation. Confirm before overwriting an existing identity.
        const _ID = window.TrinityIdentity;
        const _curNpub = (_ID && ((_ID.current && _ID.current.npub) || _ID.npub)) || '';
        if (_curNpub) {
          const _msg = 'This invite link will REPLACE your current TrinityOne identity with a new one.\n\n'
            + 'Current: ' + _curNpub.slice(0, 18) + '…\n\n'
            + 'Only continue if a TRUSTED STEWARD gave you this link. If you don\'t recognise it, cancel — the new identity\'s key may already be known to the link\'s author.\n\nContinue?';
          if (!window.confirm(_msg)) { return; }   // bail the entire follow+name flow too
        }
        const before = (window.Fellowship && window.Fellowship.myPubkey) || '';
        try {
          await window.TrinityIdentity.importMnemonic(decodeURIComponent(inviteParam));
          try { lsSet('trinityone.onboarded', true); } catch (e) {}
          // wait for the fellowship transport to re-derive its signing key from the new identity,
          // so membership is announced (and chat is signed) as the invited identity, not the old one
          for (let i = 0; i < 25; i++) { await new Promise(r => setTimeout(r, 100)); const now = window.Fellowship && window.Fellowship.myPubkey; if (now && now !== before) break; }
        } catch (e) {}
      }
      const src = (followParam || '') + ((typeof location !== 'undefined' && location.search) || '');
      if (/npub1[0-9a-z]{20,}/.test(src)) { const off = followChurch(src); if (typeof off === 'function') cleanup = off; }
      // a bulk-invite slip carries the person's name (?name=) so the steward's directory shows it without
      // anyone typing. Set it ONLY for a fresh scanner with no name yet — never overwrite an existing name.
      let nameP = ''; try { nameP = new URLSearchParams(location.search).get('name') || ''; } catch (e) {}
      if (nameP) {
        const want = decodeURIComponent(nameP).slice(0, 40).trim();
        for (let i = 0; i < 20 && want; i++) {
          await new Promise(r => setTimeout(r, 150));
          const cur = window.Fellowship && window.Fellowship.myProfile;
          if (!cur) continue;
          if (cur.name) break;                                   // existing/named user — leave them alone
          try { saveIdentity({ name: want }); } catch (e) {}
          break;
        }
      }
      // SECURITY: scrub the secret invite seed (and follow/relay/name) from the URL so it doesn't linger in
      // browser history, bookmarks, or leak via the Referer header on the next outbound request.
      try { const u = new URL(location.href); ['invite', 'follow', 'relay', 'name'].forEach(k => u.searchParams.delete(k)); const q = u.searchParams.toString(); history.replaceState(null, '', u.pathname + (q ? '?' + q : '') + u.hash); } catch (e) {}
    })();
    return () => { if (cleanup) cleanup(); };
  }, []);
  // scope outgoing chat to the active church, so its steward sees who's participating (Members)
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    if (window.Fellowship && window.Fellowship.setChurch) window.Fellowship.setChurch(np || null);
  }, [activeChurch, churches, connTick]);
  // reading plans the active church shares (steward console publishes them) -> shown in Plans
  const [churchPlans, setChurchPlans] = useA([]);
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    if (!np || !(window.Fellowship && window.Fellowship.subscribeChurchPlans)) { setChurchPlans([]); return; }
    return window.Fellowship.subscribeChurchPlans(np, setChurchPlans);
  }, [activeChurch, churches, connTick]);
  // live member count for the active church (so the switcher doesn't read "0 members")
  useAE(() => {
    const c = churches.find(x => x.id === activeChurch);
    if (!c || !c.npub || !(window.Fellowship && window.Fellowship.subscribeChurchMemberCount)) return;
    return window.Fellowship.subscribeChurchMemberCount(c.npub, (n) => setChurches(cs => cs.map(x => x.id === activeChurch ? { ...x, members: n } : x)));
  }, [activeChurch, connTick]);
  // prefetch the People directory at app load (not when the screen opens) so it's ready before the
  // member taps "People" — the roster streams in the background while they read elsewhere.
  const [churchPeople, setChurchPeople] = useA([]);
  const [churchPeopleLoading, setChurchPeopleLoading] = useA(false);
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    if (!np || !(window.Fellowship && window.Fellowship.subscribeChurchMembers)) { setChurchPeople([]); setChurchPeopleLoading(false); return; }
    setChurchPeopleLoading(true);
    const t = setTimeout(() => setChurchPeopleLoading(false), 9000);   // safety: stop "loading" even on a slow relay
    const off = window.Fellowship.subscribeChurchMembers(np, (m, done) => { setChurchPeople(m); if (done) { setChurchPeopleLoading(false); clearTimeout(t); } });
    return () => { clearTimeout(t); if (off) off(); };
  }, [activeChurch, connTick]);
  // devotionals the active church shares (text/Markdown reflections)
  const [churchDevos, setChurchDevos] = useA([]);
  const [openDevo, setOpenDevo] = useA(null);   // a church devotional opened for reading
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    if (!np || !(window.Fellowship && window.Fellowship.subscribeChurchDevotionals)) { setChurchDevos([]); return; }
    return window.Fellowship.subscribeChurchDevotionals(np, setChurchDevos);
  }, [activeChurch, churches, connTick]);
  // ── Care / Meal trains: open needs the church shared that a member can sign up to help with ──
  const [careSettings, setCareSettings] = useA({ enabled: false, visibility: 'all', openedBy: 'steward', adminGroupId: '' });
  const [careNeeds, setCareNeeds] = useA([]);
  const [careSlots, setCareSlots] = useA([]);
  const [careSkips, setCareSkips] = useA([]);
  const [optCare, setOptCare] = useA({});   // optimistic care fill/clear ('needId|iso' -> 'fill'|'clear') so "I'll help" flips instantly
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    const F = window.Fellowship;
    if (!np || !F || !F.subscribeMealsSettings) { setCareSettings({ enabled: false, visibility: 'all', openedBy: 'steward', adminGroupId: '' }); setCareNeeds([]); setCareSlots([]); setCareSkips([]); return; }
    const subs = [F.subscribeMealsSettings(np, setCareSettings), F.subscribeCareNeeds(np, setCareNeeds), F.subscribeCareSlots(np, setCareSlots), F.subscribeCareSkips(np, setCareSkips)];
    return () => subs.forEach(u => { try { u && u(); } catch {} });
  }, [activeChurch, churches, connTick]);
  // ── serving & events: the member is driven by the requests the church p-tags to them ──
  const [servReqs, setServReqs] = useA([]);     // serving requests addressed to me ("can you serve?")
  const [servReplies, setServReplies] = useA({}); // my replies: { requestId: 'accept'|'decline'|'swap' }
  const [churchEvents, setChurchEvents] = useA([]);
  const [myRsvps, setMyRsvps] = useA({});       // { eventId: 'going'|'maybe'|'no' }
  const [openServing, setOpenServing] = useA(servingParam === '1');
  const [eventOv, setEventOv] = useA(null);   // focused event-detail sheet
  useAE(() => { if (window.Fellowship && window.Fellowship.subscribeMyServingRequests) return window.Fellowship.subscribeMyServingRequests(setServReqs); }, [activeChurch, idTick, connTick]);
  useAE(() => { if (window.Fellowship && window.Fellowship.subscribeMyReqReplies) return window.Fellowship.subscribeMyReqReplies(setServReplies); }, [activeChurch, idTick, connTick]);
  useAE(() => { if (window.Fellowship && window.Fellowship.subscribeMyRsvps) return window.Fellowship.subscribeMyRsvps(setMyRsvps); }, [activeChurch, idTick, connTick]);
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    if (!np || !(window.Fellowship && window.Fellowship.subscribeChurchEvents)) { setChurchEvents([]); return; }
    return window.Fellowship.subscribeChurchEvents(np, setChurchEvents);
  }, [activeChurch, churches, connTick]);
  // the church's published rota/rosters/services — lets a member see who else is on the team that
  // day, who they can ask to swap, and a month view of services + events.
  const [churchRotas, setChurchRotas] = useA([]);
  const [churchRosters, setChurchRosters] = useA([]);
  const [churchServices, setChurchServices] = useA([]);
  const [churchRunsheets, setChurchRunsheets] = useA([]);   // per-service order-of-service + songs
  const [churchTeams, setChurchTeams] = useA([]);   // team groups (for names/icons in rota-derived serving)
  const [churchGroups, setChurchGroups] = useA([]); // all groups/rooms/teams (for group-leader event posting)
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    if (!np || !window.Fellowship) { setChurchRotas([]); setChurchRosters([]); setChurchServices([]); setChurchRunsheets([]); setChurchTeams([]); setChurchGroups([]); return; }
    const F = window.Fellowship, subs = [];
    if (F.subscribeChurchRotas) subs.push(F.subscribeChurchRotas(np, setChurchRotas));
    if (F.subscribeChurchRosters) subs.push(F.subscribeChurchRosters(np, setChurchRosters));
    if (F.subscribeChurchServices) subs.push(F.subscribeChurchServices(np, setChurchServices));
    if (F.subscribeChurchRunsheets) subs.push(F.subscribeChurchRunsheets(np, setChurchRunsheets));
    if (F.subscribeChurchGroups) subs.push(F.subscribeChurchGroups(np, (gs) => { setChurchGroups(gs || []); setChurchTeams((gs || []).filter(g => g.kind === 'team')); }));
    return () => subs.forEach(u => { try { u && u(); } catch {} });
  }, [activeChurch, churches, connTick]);
  // safeguarding: is THIS member a child for the active church, and who's cleared to contact youth.
  // Used to show a child only child-safe groups and to gate DMs (the relay enforces both regardless).
  const [safeguard, setSafeguard] = useA({ minors: [], approved: [], guardians: {}, isMinor: false });
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    const F = window.Fellowship;
    if (!np || !F || !F.subscribeChurchSafeguard) { setSafeguard({ minors: [], approved: [], guardians: {}, isMinor: false }); return; }
    return F.subscribeChurchSafeguard(np, setSafeguard);
  }, [activeChurch, churches, connTick]);
  // joining: whether the active church gates joining behind steward approval, and whether I'm still pending
  const [joinState, setJoinState] = useA({ approval: false, isAdmitted: true, isPending: false });
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    const F = window.Fellowship;
    if (!np || !F || !F.subscribeChurchJoin) { setJoinState({ approval: false, isAdmitted: true, isPending: false }); return; }
    return F.subscribeChurchJoin(np, setJoinState);
  }, [activeChurch, churches, connTick]);
  // tell the member the moment they're approved (pending → admitted), within the same church session
  const wasPendingRef = React.useRef(false);
  const approvedToastedRef = React.useRef(false);   // once per church — the join sub flickers isPending on reconnect, which was re-toasting
  useAE(() => {
    if (wasPendingRef.current && joinState.approval && joinState.isAdmitted && !joinState.isPending && !approvedToastedRef.current) {
      const nm = (churches.find(c => c.id === activeChurch) || {}).name || 'your church';
      toast('You’re approved — welcome to ' + nm + '!');
      approvedToastedRef.current = true;
    }
    wasPendingRef.current = !!joinState.isPending;
  }, [joinState.isPending, joinState.isAdmitted, joinState.approval]);
  React.useEffect(() => { wasPendingRef.current = false; approvedToastedRef.current = false; }, [activeChurch]);   // reset on church switch
  // events posted by group leaders (members the church empowered) — merged into the church's events
  const [groupEvents, setGroupEvents] = useA([]);
  // depend on STABLE string keys (npub + sorted group-ids), not the array refs — else this re-subscribes on
  // nearly every render and the events list blinks empty→full→empty (the "event keeps reappearing" flicker).
  const _geNp = (churches.find(c => c.id === activeChurch) || {}).npub;
  const _geGidsKey = churchGroups.map(g => g.id).filter(Boolean).sort().join(',');
  useAE(() => {
    const F = window.Fellowship; const gids = _geGidsKey ? _geGidsKey.split(',') : [];
    if (!_geNp || !F || !F.subscribeGroupEvents || !gids.length) { setGroupEvents([]); return; }
    return F.subscribeGroupEvents(_geNp, gids, setGroupEvents);
  }, [_geNp, _geGidsKey, connTick]);
  // the wider networks the active church belongs to (+ resolve their names) — members can follow them
  const [churchNetworks, setChurchNetworks] = useA([]);
  const [networkNames, setNetworkNames] = useA({});
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    if (!np || !(window.Fellowship && window.Fellowship.subscribeChurchNetworks)) { setChurchNetworks([]); return; }
    return window.Fellowship.subscribeChurchNetworks(np, setChurchNetworks);
  }, [activeChurch, churches, connTick]);
  useAE(() => {
    if (!(window.Fellowship && window.Fellowship.subscribeChurchProfile)) return;
    const offs = churchNetworks.map(n => window.Fellowship.subscribeChurchProfile(n.npub, (p) => { if (p && p.name) setNetworkNames(m => ({ ...m, [n.networkPub]: p.name })); }));
    return () => offs.forEach(o => { try { o && o(); } catch {} });
  }, [churchNetworks]);
  // autocascade: a church's network is auto-followed (added to the switcher, tagged as a network) so
  // its content is there without the member hunting for it — they just switch to it to view it.
  useAE(() => {
    if (!churchNetworks.length) return;
    setChurches(cs => {
      let next = cs, changed = false;
      for (const n of churchNetworks) {
        if (!next.find(c => c.id === n.npub)) { next = [...next, { id: n.npub, npub: n.npub, name: networkNames[n.networkPub] || 'Network', initials: 'NW', accent: 'var(--clay)', kind: 'network', sub: 'Network' }]; changed = true; }
      }
      return changed ? next : cs;
    });
  }, [churchNetworks, networkNames]);
  // content aggregation: pull the network's events + plans into the member's own views, tagged with
  // the network name (so a region-wide gathering shows on everyone's calendar without switching).
  const [netEventsBy, setNetEventsBy] = useA({});
  const [netPlansBy, setNetPlansBy] = useA({});
  const [netAnnounceBy, setNetAnnounceBy] = useA({});
  useAE(() => {
    const F = window.Fellowship; if (!F) return;
    const subs = [];
    churchNetworks.forEach(n => {
      const label = networkNames[n.networkPub] || 'Network';
      if (F.subscribeChurchEvents) subs.push(F.subscribeChurchEvents(n.npub, (evs) => setNetEventsBy(m => ({ ...m, [n.networkPub]: evs.map(e => ({ ...e, _network: label, _networkPub: n.networkPub })) }))));
      if (F.subscribeChurchPlans) subs.push(F.subscribeChurchPlans(n.npub, (ps) => setNetPlansBy(m => ({ ...m, [n.networkPub]: ps.map(p => ({ ...p, _network: label })) }))));
      if (F.subscribeNetworkAnnouncements) subs.push(F.subscribeNetworkAnnouncements(n.npub, (ps) => setNetAnnounceBy(m => ({ ...m, [n.networkPub]: ps.map(p => ({ ...p, _network: label, _networkPub: n.networkPub })) }))));
    });
    return () => subs.forEach(o => { try { o && o(); } catch {} });
  }, [churchNetworks, networkNames]);
  const activeNetworkPubs = new Set(churchNetworks.map(n => n.networkPub));
  const netEvents = Object.entries(netEventsBy).filter(([k]) => activeNetworkPubs.has(k)).flatMap(([, v]) => v);
  const netPlans = Object.entries(netPlansBy).filter(([k]) => activeNetworkPubs.has(k)).flatMap(([, v]) => v);
  const netAnnouncements = Object.entries(netAnnounceBy).filter(([k]) => activeNetworkPubs.has(k)).flatMap(([, v]) => v).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  // broadcast-channel posts from the church (kind-1 in its broadcast groups) — surfaced as notifications
  const [broadcastMsgs, setBroadcastMsgs] = useA([]);
  useAE(() => {
    const F = window.Fellowship;
    const bcIds = churchGroups.filter(g => g.kind === 'broadcast').map(g => g.id);
    if (!F || !F.subscribeGroups || !bcIds.length) { setBroadcastMsgs([]); return; }
    const seen = new Set();
    const off = F.subscribeGroups(bcIds, (gid, e) => {
      if (seen.has(e.id)) return; seen.add(e.id);
      let text = e.content || ''; try { const j = JSON.parse(text); if (j && (j.text || j.ref)) text = j.text || j.ref; } catch (err) {}
      setBroadcastMsgs(prev => prev.some(x => x.id === e.id) ? prev : [...prev, { id: e.id, gid, text, ts: e.created_at }]);
    });
    return off;
  }, [activeChurch, churchGroups, connTick]);

  // ── unified notifications feed: church resources + broadcasts + network announcements ──
  const _churchNameFor = (churches.find(c => c.id === activeChurch) || {}).name || 'Your church';
  const NOTIF_WINDOW = 60 * 24 * 3600;   // only surface things from the last ~60 days
  const _nowSec = Math.floor(Date.now() / 1000);
  const notifications = (() => {
    const out = [];
    netAnnouncements.forEach(a => out.push({ id: 'net:' + a.id, kind: 'network', group: a._network || 'Network', text: a.text, ts: a.ts, detail: true }));
    broadcastMsgs.forEach(m => out.push({ id: 'bc:' + m.id, kind: 'notice', group: _churchNameFor, text: m.text, ts: m.ts, groupObj: churchGroups.find(g => g.id === m.gid) || null }));
    churchDevos.forEach(d => out.push({ id: 'devo:' + d.id, kind: 'devotional', group: _churchNameFor, text: 'Shared a devotional · ' + (d.title || ''), ts: d.ts, devo: d }));
    churchPlans.forEach(p => out.push({ id: 'plan:' + p.id, kind: 'plan', group: _churchNameFor, text: 'Shared a reading plan · ' + (p.title || ''), ts: p.ts, go: 'plans' }));
    churchEvents.forEach(e => out.push({ id: 'evt:' + e.id, kind: 'event', group: _churchNameFor, text: 'New event · ' + (e.title || ''), ts: e.ts, go: 'event', event: e }));
    return out.filter(n => n.ts && (_nowSec - n.ts) < NOTIF_WINDOW).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 40);
  })();
  // unread tracking (drives the bell badge); "seen" = newest ts the user has opened the panel at
  const [netSeenTs, setNetSeenTs] = useA(() => { try { return Number(localStorage.getItem('trinityone.net-seen') || 0); } catch { return 0; } });
  const netUnread = notifications.filter(n => (n.ts || 0) > netSeenTs).length;
  const markNetSeen = () => { const top = notifications[0] && notifications[0].ts; if (top && top > netSeenTs) { setNetSeenTs(top); try { localStorage.setItem('trinityone.net-seen', String(top)); } catch {} } };
  // derive serving items from requests + my replies (local date, not UTC)
  const _now = new Date();
  const todayStr = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0') + '-' + String(_now.getDate()).padStart(2, '0');
  const myServPub = (window.Fellowship && window.Fellowship.myPubkey) || '';
  // the church's published ROTAS are the source of truth for "I'm serving" — derive my slots from them,
  // then layer on any "can you serve?" request + my reply. (Before, this was request-only, so a member
  // placed on a published rota saw nothing until a request happened to arrive.)
  const _reqFor = (sid, tid, rid) => servReqs.find(r => r.serviceId === sid && r.teamId === tid && r.roleId === rid);
  const _verdict = (q) => (q ? (servReplies[q.id] || 'pending') : 'none');
  const _teamMeta = (id) => churchTeams.find(g => g.id === id) || {};
  const _roleName = (tid, rid) => { const r = churchRosters.find(x => x.team === tid); const role = r && (r.roles || []).find(ro => ro.id === rid); return role ? role.name : ''; };
  const myRotaSlots = [];
  if (myServPub) for (const rota of churchRotas) {
    if (!rota.published || !rota.assign) continue;
    const svc = churchServices.find(s => s.id === rota.service);
    if (!svc || (svc.date || '') < todayStr) continue;
    for (const key in rota.assign) {
      const who = rota.assign[key]; if (!who || who.pub !== myServPub) continue;
      const [tid, rid] = key.split('::'); const tm = _teamMeta(tid); const q = _reqFor(rota.service, tid, rid);
      myRotaSlots.push({ id: 'rota:' + rota.service + ':' + key, req: q || null, serviceId: rota.service, teamId: tid, roleId: rid, teamName: tm.name || 'Serving', icon: tm.icon || 'hand', accent: tm.accent || 'var(--clay)', role: _roleName(tid, rid), date: svc.date, time: svc.time, service: svc.name, _verdict: _verdict(q) });
    }
  }
  myRotaSlots.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  // teams I'm ON THE ROSTER for (eligible to serve), even if not yet scheduled onto a published rota —
  // so a member who's been added to a team sees it, instead of a bare "you're not on the rota yet".
  const myRosterTeams = myServPub ? churchRosters
    .filter(r => (r.people || []).some(p => p.pub === myServPub))
    .map(r => { const tm = _teamMeta(r.team); return { id: r.team, name: tm.name || 'Serving team', icon: tm.icon || 'hand', accent: tm.accent || 'var(--clay)' }; }) : [];
  // pending "can you serve?" asks not yet answered (these take priority over a plain rota placement)
  const servPending = servReqs.filter(r => !servReplies[r.id] && (r.date || '') >= todayStr);
  const _pendKey = new Set(servPending.map(r => r.serviceId + '|' + r.teamId + '|' + r.roleId));
  const servConfirmed = myRotaSlots.filter(s => s._verdict !== 'decline' && s._verdict !== 'swap' && !_pendKey.has(s.serviceId + '|' + s.teamId + '|' + s.roleId));
  const servDeclined = myRotaSlots.filter(s => s._verdict === 'decline' || s._verdict === 'swap');
  const servNext = servConfirmed[0] || null;
  // schedule local reminders for confirmed slots (the day before) + register web-push (PWA)
  useAE(() => { if (window.TrinityReminders) window.TrinityReminders.sync(servConfirmed); }, [servReqs, servReplies]);
  useAE(() => { const pk = window.Fellowship && window.Fellowship.myPubkey; if (pk && window.TrinityReminders && window.TrinityReminders.registerPush) window.TrinityReminders.registerPush(pk); }, [servReqs, activeChurch]);
  // fellowship (chat + giving)
  const [group, setGroup] = useA(null);
  const [dmPeer, setDmPeer] = useA(null);   // direct-message thread with a pubkey
  const [dmInbox, setDmInbox] = useA(false); // direct-message conversation list
  const [people, setPeople] = useA(false);  // church People directory
  const [walletSats, setWalletSats] = useA(window.TrinityData.WALLET.sats);
  const [giving, setGiving] = useA(window.TrinityData.GIVING_HISTORY);
  const [funds, setFunds] = useA(window.TrinityData.FUNDS);   // giving funds (stewards can add)

  // The app fills the whole browser by default. The scaled phone-frame mockup is opt-in via ?frame=1
  // (for demos / marketing screenshots) and never applies to the native app, an installed PWA, or a
  // phone-sized viewport. (Full-screen also sidesteps the APK blank screen, where a webview booting
  // with innerHeight 0 made the fit() scale go negative.)
  const framePreview = (typeof location !== 'undefined') && /[?&]frame=1(?:&|$)/.test(location.search);
  const fullscreen = (typeof window !== 'undefined') && (!framePreview || (
    !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
    !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    !!(window.navigator && window.navigator.standalone) ||
    window.innerWidth <= 500
  ));
  // wide desktop browser → left-sidebar layout (reactive to resize); phones / native stay phone-first
  const [vw, setVw] = useA(typeof window !== 'undefined' ? window.innerWidth : 1200);
  useAE(() => { const f = () => setVw(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const desktop = fullscreen && vw >= 900;
  // scaling to viewport (desktop preview only)
  const wrapRef = useAR();
  useAE(() => {
    if (fullscreen) { if (wrapRef.current) wrapRef.current.style.transform = 'none'; return; }
    const fit = () => {
      const W = 392, H = 846, m = 24;
      const sc = Math.min(1, (window.innerWidth - m) / W, (window.innerHeight - m) / H);
      if (wrapRef.current) wrapRef.current.style.transform = `scale(${sc})`;
    };
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fullscreen]);

  // Hardware/browser back: dismiss the topmost overlay/sheet, else return to Today, else allow exit.
  // Uses history + popstate (no native plugin) — on Android the webview's default back fires popstate
  // when there's a history entry; we keep a "guard" entry so back has something to pop and stays in-app.
  const tabRef = useAR(); tabRef.current = tab;

  // ── Community unread dot: an app-level watcher (runs on any tab) so a new church message lights a
  // dot on the Community tab even when you're elsewhere. "Seen" = newest message ts when you last
  // opened Community. Group posts only (DMs are a follow-on). ──
  const [chatUnread, setChatUnread] = useA(false);
  const [dmUnread, setDmUnread] = useA(false);
  const chatNewestTs = useAR(0);
  const dmNewestTs = useAR(0);
  const dmInboxRef = useAR(false); dmInboxRef.current = dmInbox;
  const chatSeenKey = activeChurch ? 'trinityone.chatTabSeen.' + activeChurch : null;
  const dmSeenKey = () => { const me = window.Fellowship && window.Fellowship.myPubkey; return me ? 'trinityone.dmSeen.' + me : null; };
  const markChatSeen = () => {
    if (chatSeenKey) { try { localStorage.setItem(chatSeenKey, String(chatNewestTs.current || Math.floor(Date.now() / 1000))); } catch {} }
    setChatUnread(false);
  };
  // DMs clear when you open the DM inbox — NOT when you open Community — so the paper-plane dot survives until read
  const markDmSeen = () => {
    const dk = dmSeenKey(); if (dk) { try { localStorage.setItem(dk, String(dmNewestTs.current || Math.floor(Date.now() / 1000))); } catch {} }
    setDmUnread(false);
  };
  useAE(() => {
    const F = window.Fellowship;
    const ch = churches.find(c => c.id === activeChurch);
    chatNewestTs.current = 0; setChatUnread(false);
    if (!F || !ch || !ch.npub || !F.subscribeChurchGroups || !F.subscribeGroups) return;
    let getSeen = () => { try { return Number(localStorage.getItem('trinityone.chatTabSeen.' + ch.npub) || 0); } catch { return 0; } };
    let groupSub = null;
    const off = F.subscribeChurchGroups(ch.npub, (groups) => {
      const ids = (groups || []).map(g => g.id).filter(Boolean);
      try { groupSub && groupSub(); } catch {}
      if (!ids.length) return;
      groupSub = F.subscribeGroups(ids, (gid, e) => {
        if (!e || e.pubkey === F.myPubkey) return;                 // ignore my own posts
        if (e.created_at > chatNewestTs.current) {
          chatNewestTs.current = e.created_at;
          if (tabRef.current === 'chat') markChatSeen();           // already looking → keep it clear
          else if (e.created_at > getSeen()) setChatUnread(true);  // new since last visit → dot
        }
      });
    });
    return () => { try { off && off(); } catch {} try { groupSub && groupSub(); } catch {} };
  }, [activeChurch, idTick]);   // eslint-disable-line react-hooks/exhaustive-deps
  // ── DM unread dot: incoming direct messages also light the Community tab. "Seen" = newest incoming
  // DM ts when you last opened Community (keyed by my pubkey, since DMs aren't church-scoped). ──
  useAE(() => {
    const F = window.Fellowship;
    dmNewestTs.current = 0; setDmUnread(false);
    if (!F || !F.subscribeDMs) return;
    const getSeen = () => { const dk = dmSeenKey(); if (!dk) return 0; try { return Number(localStorage.getItem(dk) || 0); } catch { return 0; } };
    const off = F.subscribeDMs((convos) => {
      // newest INCOMING message across all conversations (skip ones where I sent last → "You: ")
      let newest = 0;
      for (const c of (convos || [])) {
        if (c && c.lastTs > newest && !(c.preview || '').startsWith('You: ')) newest = c.lastTs;
      }
      if (newest > dmNewestTs.current) {
        dmNewestTs.current = newest;
        if (dmInboxRef.current) markDmSeen();                    // looking at the DM inbox → already seen
        else if (newest > getSeen()) setDmUnread(true);          // unread DM → light the paper-plane dot
      }
    });
    return () => { try { off && off(); } catch {} };
  }, [idTick]);   // eslint-disable-line react-hooks/exhaustive-deps
  // opening Community clears the dot + records what we've now seen
  useAE(() => { if (tab === 'chat') markChatSeen(); }, [tab]);   // eslint-disable-line react-hooks/exhaustive-deps
  useAE(() => {
    const guard = () => { try { history.pushState({ trinity: 1 }, ''); } catch (e) {} };
    guard();   // seed one entry so the first back press is intercepted, not an app exit
    // shared back logic: close a layer, else go to Today, else signal "we're already on Today"
    const goBack = () => {
      if (window.trinityGoBack && window.trinityGoBack()) return true;   // closed an overlay/sheet
      if (tabRef.current !== 'today') { setTab('today'); return true; }  // any other tab -> Today
      return false;                                                     // on Today with nothing open
    };
    const onPop = () => { if (goBack()) guard(); };
    window.addEventListener('popstate', onPop);
    // native hardware back (Capacitor): popstate isn't reliable in the Android webview, so use the
    // App plugin's backButton — Read/Community/Library go to Today; on Today, confirm before exit.
    let nativeSub = null;
    const Cap = window.Capacitor;
    if (Cap && Cap.Plugins && Cap.Plugins.App) {
      try {
        Cap.Plugins.App.addListener('backButton', () => {
          if (goBack()) return;
          setConfirmExit(true);
        }).then(h => { nativeSub = h; }).catch(() => {});
      } catch (e) {}
    }
    return () => { window.removeEventListener('popstate', onPop); if (nativeSub && nativeSub.remove) try { nativeSub.remove(); } catch (e) {} };
  }, []);

  // real identity object for the ProfileSheet/onboarding (derived from the live identity + profile)
  const identity = (() => {
    const cur = (window.TrinityIdentity && window.TrinityIdentity.current) || window.TrinityData.CHAT_IDENTITY || {};
    const FS = window.Fellowship;
    const name = (FS && FS.myProfile && FS.myProfile.name) || '';
    let avatar = { kind: 'monogram', color: cur.color || '#5E8C6A' };
    if (FS && FS.myPubkey && FS.displayFor) { const d = FS.displayFor(FS.myPubkey); if (d && d.av) avatar = d.av; }
    // stewards run their church from the separate Steward console — ordinary members aren't stewards,
    // so the member app hides steward-only tools (e.g. the invite generator).
    return { name, avatar, npub: cur.npub || '', handle: cur.handle || 'Anonymous', nip05: (FS && FS.myProfile && FS.myProfile.nip05) || '', hidden: !!(FS && FS.myProfile && FS.myProfile.hidden), steward: false };
  })();
  // saving a profile publishes name + mark to the user's key (kind-0). Patch only the fields supplied, so
  // a directory-visibility toggle (hidden only) never blanks the name, and vice-versa.
  const saveIdentity = (patch) => {
    const FS = window.Fellowship;
    if (!(FS && FS.setProfile)) return;
    const meta = {};
    if (patch.name != null) meta.name = String(patch.name).trim();
    if (patch.avatar != null) meta.av = patch.avatar;
    if (patch.hidden != null) meta.hidden = !!patch.hidden;
    FS.ready.then(() => FS.setProfile(meta)).catch(() => {});
  };

  const toast = (msg) => {
    setToastMsg(msg); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 1900);
  };
  window.trinityToast = toast;   // a few non-React globals (e.g. the audio engine) surface notices through this

  const ctx = {
    dark: t.dark,
    toggleDark: () => setTweak('dark', !t.dark),
    accent: t.accent, setAccent: (a) => setTweak('accent', a),
    // 'plans'/'bible' aren't top-level tabs — they're the Read tab's two views, so route them there
    go: (t) => { if (t === 'plans') { setReadView('plans'); setTab('read'); } else if (t === 'bible') { setReadView('bible'); setTab('read'); } else setTab(t); },
    toast,
    loc, setLoc, version, setVersion: (v) => Bible.setActive(v),
    gotoRef: (book, chap, verse) => { setLoc({ book, chap, verse }); setReadView('bible'); setTab('read'); },
    addModule: () => Bible.pickFile(),
    removeTranslation: (abbr) => Bible.removeModule(abbr),
    openStore: (view, category) => { setStoreView(view || null); setStoreCat(category || null); setStore(true); }, closeStore: () => setStore(false),
    openGroup: (g) => setGroup(g),
    desktop, openGroupId: group && group.id,
    openDM: (peer) => setDmPeer(peer), openDMInbox: () => { setDmInbox(true); markDmSeen(); }, openPeople: () => setPeople(true),
    dmUnread,   // drives the dot on the Community "Direct messages" (paper-plane) button
    walletSats, setWalletSats, giving, setGiving,
    funds, addFund: (f) => setFunds(fs => [...fs, { ...f, id: f.id || ('fund' + Date.now()), church: activeChurch }]),
    readView, setReadView,
    openReader: () => { setReadView('bible'); setTab('read'); },
    openPlans: () => { setReadView('plans'); setTab('read'); },
    openSearch: () => setSearchOpen(true),
    openShare: (v) => setShare(v),
    openShareSheet: (v) => setShareSheet(v),
    // share arbitrary text via the OS share sheet (native or web), falling back to clipboard
    shareText: async (text, title) => {
      const t = (text || '').trim(); if (!t) return;
      const Cap = window.Capacitor, P = Cap && Cap.Plugins;
      try {
        if (P && P.Share && Cap.isNativePlatform && Cap.isNativePlatform()) { await P.Share.share({ title: title || 'TrinityOne', text: t }); return; }
        if (navigator.share) { await navigator.share({ text: t }); return; }
      } catch (e) { if (e && e.name === 'AbortError') return; }
      try { if (navigator.clipboard) { await navigator.clipboard.writeText(t); toast('Copied — paste it anywhere'); } } catch (e) {}
    },
    openHelp: (initial) => setHelp(initial || 'index'),
    openDevotional: () => setDevo(true),
    openPlan: (p) => setPlan(p),
    openPlanDay: (plan, day) => {
      const loc = Bible.parseRef(day.ref);
      if (!loc || !Bible.books().includes(loc.book)) { toast(day.ref + ' isn’t in this translation'); return; }
      setLoc({ book: loc.book, chap: loc.chap, verse: loc.verse }); setReadView('bible'); setTab('read');
    },
    openJournal: (j) => setJournal(j),
    openVideo: (v) => setVideo(v),
    openWord: (id) => setWordOv(id),
    openConcordance: () => setConcord(true),
    openAllUses: (id) => setAllUses(id),
    openNotifications: () => setNotif(true),
    openNotifSettings: () => setNotifSettings(true),
    openCurrency: () => setCurrencyOpen(true),
    openListen: () => setListen(true),
    openAudioBibles: () => setAudioBibles(true),
    // identity surfaces
    openProfile: () => setProfile(true),
    openMember: (name) => { const m = window.TrinityData.MEMBERS[name]; if (m) setMember(m); else toast('Opening ' + name); },
    openRecovery: () => setIdSheet('recovery'),
    openInvite: () => setIdSheet('invite'),
    openShareApp: () => setIdSheet('shareapp'),
    openRelays: () => setIdSheet('relays'),
    openWallet: () => setWalletSheet(true),
    openNewIdentity: () => setNewId(true),
    // library drill-ins
    openModule: (m) => setModule(m),
    openCollection: (c) => setCollection(c),
    openBook: (b) => setBook(b),
    // multi-church
    churches, activeChurch,
    church: churches.find(c => c.id === activeChurch) || churches[0] || null,
    openChurchSwitcher: (mode) => { setChurchSwitcherMode(mode === 'follow' ? 'follow' : 'list'); setChurchSwitcher(true); },
    setActiveChurch: (id) => { setActiveChurch(id); lsSet('trinityone.activeChurch', id); },
    addChurch: (c) => { setChurches(cs => cs.find(x => x.id === c.id) ? cs : [...cs, c]); setActiveChurch(c.id); lsSet('trinityone.activeChurch', c.id); },
    followChurch,   // follow a real church by npub (from a scanned/pasted invite); false if invalid
    leaveChurch,    // leave a church: tombstone membership + unfollow locally
    activeChurchId: activeChurch,
    // ---- user-owned data: everything routes through window.MyData (local now, Nostr later) ----
    myData: MD,
    journalEntries,
    newJournal: () => setJournalEditor({}),
    editJournal: (entry) => setJournalEditor(entry),
    deleteJournal: (id) => MD.remove('journal', id),
    saveJournal: (entry) => MD.put('journal', entry),
    readScale: t.readScale,
    highlights, setHighlight: (k, c) => { if (c) MD.put('highlights', { id: k, ref: k, color: c }); else MD.remove('highlights', k); },
    notes, setNote: (k, txt) => { if (txt) MD.put('notes', { id: k, ref: k, text: txt }); else MD.remove('notes', k); },
    bookmarks, toggleBookmark: (k) => { if (MD.has('bookmarks', k)) MD.remove('bookmarks', k); else MD.put('bookmarks', { id: k, ref: k }); },
    planProgress,
    devoProgress,
    churchPlans: [...churchPlans, ...netPlans],
    churchDevos,
    churchPeople, churchPeopleLoading,   // prefetched at app load so the People screen is instant
    myPubkey: (window.Fellowship && window.Fellowship.myPubkey) || null,
    openChurchDevo: (d) => setOpenDevo(d),
    // serving & events (church's own + aggregated from its network)
    servPending, servConfirmed, servDeclined, servNext, myRosterTeams,
    churchEvents: (() => { const seen = new Set(churchEvents.map(e => e.id).filter(Boolean)); return [...churchEvents, ...groupEvents.filter(e => !seen.has(e.id)), ...netEvents]; })(),
    myRsvps,
    netAnnouncements, netUnread, markNetSeen, notifications,
    churchRotas, churchRosters, churchServices, churchRunsheets, churchGroups,
    // Care / Meal trains: settings + open needs + everyone's fills/skips, plus this member's sign-up actions.
    // Only meaningful when care.settings.enabled; the Today card and Care screen render off this.
    care: {
      settings: careSettings,
      needs: careNeeds,
      slots: (() => {
        const mp = (window.Fellowship && window.Fellowship.myPubkey || '').toLowerCase();
        let m = (careSlots || []).filter(s => !(optCare[(s.needId || '') + '|' + (s.isoDate || '')] === 'clear' && (s.pubkey || '').toLowerCase() === mp));
        for (const k in optCare) { if (optCare[k] !== 'fill') continue; const p = k.split('|'); if (!m.some(s => s.needId === p[0] && s.isoDate === p[1] && (s.pubkey || '').toLowerCase() === mp)) m.push({ needId: p[0], isoDate: p[1], pubkey: mp }); }
        return m;
      })(),
      skips: careSkips,
      myPub: (window.Fellowship && window.Fellowship.myPubkey) || '',
      fill: (careId, iso, note) => { setOptCare(o => ({ ...o, [careId + '|' + iso]: 'fill' })); return window.Fellowship.fillCareSlot(careId, iso, note).then(r => { if (r) toast('Thank you — you’re signed up'); else setOptCare(o => { const n = { ...o }; delete n[careId + '|' + iso]; return n; }); return r; }); },
      clearFill: (careId, iso) => { setOptCare(o => ({ ...o, [careId + '|' + iso]: 'clear' })); return window.Fellowship.clearCareSlot(careId, iso).then(r => { if (r) toast('Removed'); else setOptCare(o => { const n = { ...o }; delete n[careId + '|' + iso]; return n; }); return r; }); },
      // update the "what I'm bringing" note on an already-filled slot — same fillCareSlot doc, no "signed up" toast
      setNote: (careId, iso, note) => window.Fellowship.fillCareSlot(careId, iso, note),
      skip: (careId, iso, reason) => window.Fellowship.markCareSkip(careId, iso, reason),
      clearSkip: (careId, iso) => window.Fellowship.clearCareSkip(careId, iso),
    },
    // safeguarding: this member's child status + whether a DM with a given peer is permitted (relay-enforced too)
    safeguard,
    joinState,   // { approval, isAdmitted, isPending } for the active church
    // steward rule: this church asks members to use a real first + last name (two words)
    requireFullName: !!(((churches.find(c => c.id === activeChurch) || {}).rules) || {}).fullName,
    canDMPeer: (peer) => {   // peer is a hex pubkey
      const minors = safeguard.minors || [], approved = safeguard.approved || [], guardians = safeguard.guardians || {};
      const me = (window.Fellowship && window.Fellowship.myPubkey) || null;
      const churchPub = (window.Fellowship && window.Fellowship.churchPub) || null;
      if (peer && peer === churchPub) return true;   // anyone may message the church/steward
      const linked = !!(peer && me && (((guardians[peer] || []).includes(me)) || ((guardians[me] || []).includes(peer))));
      if (linked) return true;   // v2: a parent may always message their own child (and vice versa)
      if (safeguard.isMinor && !(peer && approved.includes(peer))) return false;   // a child may only DM a cleared adult
      if (peer && minors.includes(peer) && !(me && approved.includes(me))) return false; // only a cleared adult may DM a child
      return true;
    },
    // groups this member may post events for (the steward named them a leader)
    myLeaderGroups: churchGroups.filter(g => (g.leaders || []).includes((window.Fellowship && window.Fellowship.myPubkey) || '')),
    publishGroupEvent: (groupId, ev) => { const np = (churches.find(c => c.id === activeChurch) || {}).npub; return window.Fellowship.publishGroupEvent(np, groupId, ev); },
    churchNetworks: churchNetworks.map(n => ({ ...n, name: networkNames[n.networkPub] || '', following: !!churches.find(c => c.id === n.npub) })),
    openServing: () => setOpenServing(true),
    openEvent: (e) => setEventOv(e),
    respondServing: (item, verdict, swapTo) => {
      const np = (churches.find(c => c.id === activeChurch) || {}).npub;
      // item may be a request, or a rota-derived slot that carries its matching request in .req
      const reqId = (item.req && item.req.id) || (typeof item.id === 'string' && item.id.indexOf('rota:') !== 0 ? item.id : null);
      if (!reqId) { toast('Your leader hasn’t sent a request for this yet — ask them to re-publish the rota.'); return; }
      if (window.Fellowship && window.Fellowship.respondToServingRequest) window.Fellowship.respondToServingRequest(np, reqId, verdict, swapTo);
      setServReplies(m => ({ ...m, [reqId]: verdict }));
    },
    setRsvp: (eventId, verdict) => {
      const np = (churches.find(c => c.id === activeChurch) || {}).npub;
      const next = myRsvps[eventId] === verdict ? null : verdict;
      if (window.Fellowship && window.Fellowship.setEventRsvp) window.Fellowship.setEventRsvp(np, eventId, next || 'none');
      setMyRsvps(m => ({ ...m, [eventId]: next }));
    },
    setUnavailableDates: (dates) => {
      const np = (churches.find(c => c.id === activeChurch) || {}).npub;
      if (window.Fellowship && window.Fellowship.setUnavailable) window.Fellowship.setUnavailable(np, dates);
    },
    togglePlanDay: (pid, day) => {
      const prev = MD.settings.get('plans', {});
      const set = new Set(prev[pid] || []); set.has(day) ? set.delete(day) : set.add(day);
      MD.settings.set('plans', { ...prev, [pid]: [...set].sort((a, b) => a - b) });
    },
    toggleDevoDay: (did, day) => {
      const prev = MD.settings.get('devos', {});
      const set = new Set(prev[did] || []); set.has(day) ? set.delete(day) : set.add(day);
      MD.settings.set('devos', { ...prev, [did]: [...set].sort((a, b) => a - b) });
    },
    plansFollowed,
    plansHidden,
    // add/remove a plan from "My Plans". Church plans are followed by default, so removing one hides it
    // (recorded in plansHidden); discover plans are opt-in (recorded in plansFollowed). Re-addable either way.
    setPlanInMine: (id, inMine, isChurch) => {
      const key = isChurch ? 'plansHidden' : 'plansFollowed';
      const prev = MD.settings.get(key, []);
      // plansHidden stores the REMOVED church plans, so its membership is inverted vs. plansFollowed
      const present = isChurch ? !inMine : inMine;
      const next = present ? [...new Set([...prev, id])] : prev.filter(x => x !== id);
      MD.settings.set(key, next);
    },
  };

  // back button: close the topmost open overlay/sheet (returns true if it closed one). Kept current
  // each render so the popstate handler always sees live state. Order ~ visual z (most modal first).
  window.trinityGoBack = () => {
    const layers = [
      [wordOv, () => setWordOv(null)], [member, () => setMember(null)], [profile, () => setProfile(false)],
      [idSheet, () => setIdSheet(null)], [searchOpen, () => setSearchOpen(false)], [listen, () => setListen(false)], [audioBibles, () => setAudioBibles(false)],
      [notif, () => setNotif(false)], [allUses, () => setAllUses(null)], [concord, () => setConcord(false)],
      [video, () => setVideo(null)], [book, () => setBook(null)], [collection, () => setCollection(null)],
      [module, () => setModule(null)], [journalEditor, () => setJournalEditor(null)], [journal, () => setJournal(null)],
      [eventOv, () => setEventOv(null)], [openServing, () => setOpenServing(false)], [openDevo, () => setOpenDevo(null)], [plan, () => setPlan(null)],
      [devo, () => setDevo(false)], [shareSheet, () => setShareSheet(null)], [share, () => setShare(null)],
      [dmPeer, () => setDmPeer(null)], [dmInbox, () => setDmInbox(false)], [people, () => setPeople(false)], [group, () => setGroup(null)],
    ];
    for (const [open, close] of layers) { if (open) { close(); return true; } }
    return false;
  };

  // apply accent vars
  const acc = ACCENTS[t.accent] || ACCENTS.clay;
  const ap = t.dark ? acc.dark : acc.light;
  // a church's brand accent (a hex the steward set) overrides the personal accent theme so the
  // member's app takes on the church's colour. The clay family is derived from the one hex.
  const ca = (ctx.church && typeof ctx.church.accent === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(ctx.church.accent.trim())) ? ctx.church.accent.trim() : null;
  const brand = ca ? {
    '--clay': ca,
    '--clay-ink': `color-mix(in oklab, ${ca} 86%, #000)`,
    '--clay-soft': t.dark ? `color-mix(in oklab, ${ca} 30%, #16120c)` : `color-mix(in oklab, ${ca} 16%, #fff)`,
    '--clay-deep': `color-mix(in oklab, ${ca} 74%, #000)`,
  } : null;
  const rootStyle = {
    '--clay': ap.c, '--clay-ink': ap.i, '--clay-soft': ap.s, '--clay-deep': ap.d,
    ...(brand || {}),
    '--read-scale': t.readScale,
  };

  const screens = {
    today: <TodayScreen ctx={ctx} />,
    read: readView === 'plans' ? <PlansScreen ctx={ctx} /> : <ReadScreen ctx={ctx} />,
    chat: <ChatScreen ctx={ctx} />,
    library: <LibraryScreen ctx={ctx} />,
  };

  // per-church feature toggles: the active church can hide whole tabs (steward → Congregation features).
  // Unset = on. Today always shows. Maps: read→Bible, chat→Community, library→Library.
  const cf = (ctx.church && ctx.church.features) || {};
  const tabOn = { today: true, read: cf.read !== false, chat: cf.community !== false, library: cf.library !== false };
  const visibleTabs = TABS.filter(t => tabOn[t.id]);
  // if the steward turned off the tab you're on, fall back to Today
  useAE(() => { if (!tabOn[tab]) setTab('today'); }, [tabOn.read, tabOn.chat, tabOn.library, tab]);

  return (
    <div ref={wrapRef} className={cx('trinity', t.dark && 'dark')} style={{ ...rootStyle, ...(fullscreen ? { position: 'fixed', inset: 0 } : { transformOrigin: 'center center' }) }}>
      <PhoneFrame bare={fullscreen}>
        {Bible.loaded ? (
          <React.Fragment>
            <UpdateBanner ctx={ctx} />
            {desktop ? (
              <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
                <DesktopNav active={tab} onChange={setTab} tabs={visibleTabs} unread={{ chat: chatUnread || dmUnread }} />
                {tab === 'chat' && ctx.church && ctx.church.npub ? (
                  <div style={{ flex: 1, display: 'flex', minWidth: 0, background: 'var(--paper)' }}>
                    <div style={{ width: 372, flexShrink: 0, position: 'relative', borderRight: '1px solid var(--line)' }}>{screens.chat}</div>
                    <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
                      {group ? <ChatRoom group={group} open={true} onClose={() => setGroup(null)} ctx={ctx} docked /> : (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--ink-3)', textAlign: 'center', padding: 24 }}>
                          <Icon name="chat" size={46} stroke={1.4} color="var(--ink-3)" />
                          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--ink-2)' }}>Pick a conversation</div>
                          <div style={{ fontSize: 13.5, maxWidth: 260, lineHeight: 1.5 }}>Choose a group or prayer room on the left to open it here.</div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : tab === 'read' && readView === 'bible' ? (
                  <div style={{ flex: 1, display: 'flex', minWidth: 0, background: 'var(--paper)' }}>
                    <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0, borderRight: '1px solid var(--line)' }}>
                      <div style={{ position: 'relative', width: '100%', maxWidth: 760 }}>{screens.read}</div>
                    </div>
                    <div style={{ width: 380, flexShrink: 0, position: 'relative', background: 'var(--surface)' }}>
                      {wordOv ? <WordStudySheet id={wordOv} open={true} onClose={() => setWordOv(null)} docked />
                        : loc ? <CommentaryPanel loc={loc} label={Bible.bookName(loc.book) + ' ' + loc.chap} open={true} onClose={() => {}} ctx={ctx} docked />
                        : null}
                    </div>
                  </div>
                ) : (
                  <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-start', minWidth: 0, background: 'var(--paper)' }}>
                    <div style={{ position: 'relative', width: '100%', maxWidth: 920, borderRight: '1px solid var(--line)' }}>{screens[tab]}</div>
                  </div>
                )}
              </div>
            ) : (
              <React.Fragment>
                <div style={{ position: 'absolute', inset: 0 }}>{screens[tab]}</div>
                <MiniPlayer ctx={ctx} />
                <TabBar active={tab} onChange={setTab} tabs={visibleTabs} unread={{ chat: chatUnread || dmUnread }} />
              </React.Fragment>
            )}

            {/* overlays */}
            <ShareCard verse={share} open={!!share} onClose={() => setShare(null)} ctx={ctx} />
            <VerseShareSheet payload={shareSheet} open={!!shareSheet} onClose={() => setShareSheet(null)} ctx={ctx} />
            <DevotionalView open={devo} onClose={() => setDevo(false)} ctx={ctx} />
            <PlanDetail plan={plan} open={!!plan} onClose={() => setPlan(null)} ctx={ctx} />
            <ChurchDevoView devo={openDevo} open={!!openDevo} onClose={() => setOpenDevo(null)} ctx={ctx} />
            <ServingScreen open={openServing} onClose={() => setOpenServing(false)} ctx={ctx} />
            <EventDetail event={eventOv} open={!!eventOv} onClose={() => setEventOv(null)} ctx={ctx} />
            <JournalView entry={journal} open={!!journal} onClose={() => setJournal(null)} ctx={ctx} />
            <JournalEditor entry={journalEditor} open={!!journalEditor} onClose={() => setJournalEditor(null)} ctx={ctx} />
            <ModuleView module={module} open={!!module} onClose={() => setModule(null)} ctx={ctx} />
            <CollectionView coll={collection} open={!!collection} onClose={() => setCollection(null)} ctx={ctx} />
            <BookReader book={book} open={!!book} onClose={() => setBook(null)} ctx={ctx} />
            <VideoPlayer video={video} open={!!video} onClose={() => setVideo(null)} ctx={ctx} />
            <WordStudySheet id={wordOv} open={!!wordOv && !(desktop && tab === 'read' && readView === 'bible')} onClose={() => setWordOv(null)} />
            <ConcordanceIndex open={concord} onClose={() => setConcord(false)} ctx={ctx} />
            <AllUsesView id={allUses} open={!!allUses} onClose={() => setAllUses(null)} ctx={ctx} />
            <NotificationsScreen open={notif} onClose={() => setNotif(false)} ctx={ctx} />
            <NotifSettingsScreen open={notifSettings} onClose={() => setNotifSettings(false)} ctx={ctx} />
            <CurrencyScreen open={currencyOpen} onClose={() => setCurrencyOpen(false)} ctx={ctx} />
            <ListenScreen open={listen} onClose={() => setListen(false)} ctx={ctx} />
            <AudioBiblesScreen open={audioBibles} onClose={() => setAudioBibles(false)} ctx={ctx} />
            <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} ctx={ctx} />
            {/* identity: hub + focused sheets (designer layout, real backend) */}
            <ProfileSheet open={profile} onClose={() => setProfile(false)} identity={identity} onSave={saveIdentity} ctx={ctx} />
            <MemberCard member={member} open={!!member} onClose={() => setMember(null)} ctx={ctx} />
            <RecoverySheet open={idSheet === 'recovery'} onClose={() => setIdSheet(null)} ctx={ctx} />
            <InviteSheet open={idSheet === 'invite'} onClose={() => setIdSheet(null)} identity={identity} ctx={ctx} />
            <ShareAppSheet open={idSheet === 'shareapp'} onClose={() => setIdSheet(null)} ctx={ctx} />
            <RelaysSheet open={idSheet === 'relays'} onClose={() => setIdSheet(null)} ctx={ctx} />
            <NewIdentitySheet open={newId} identity={identity} onClose={() => setNewId(false)} onCreate={saveIdentity} ctx={ctx} />
            {window.WalletSheet ? <WalletSheet open={walletSheet} onClose={() => setWalletSheet(false)} ctx={ctx} /> : null}
            <ChatRoom group={group} open={!!group && !(desktop && tab === 'chat')} onClose={() => setGroup(null)} ctx={ctx} />
            <DMInbox open={dmInbox} onClose={() => setDmInbox(false)} ctx={ctx} />
            <DMThread peer={dmPeer} open={!!dmPeer} onClose={() => setDmPeer(null)} ctx={ctx} />
            <PeopleScreen open={people} onClose={() => setPeople(false)} ctx={ctx} />
            <ChurchSwitcher open={churchSwitcher} onClose={() => setChurchSwitcher(false)} ctx={ctx} initialMode={churchSwitcherMode}
              churches={churches} activeId={activeChurch}
              onPick={(id) => { ctx.setActiveChurch(id); setChurchSwitcher(false); }}
              onFollowed={() => { setChurchSwitcher(false); toast('Now following — loading church…'); }} />

            <Toast msg={toastMsg} />
          </React.Fragment>
        ) : (

          <EmptyState loading={Bible.loading} error={Bible._error} onBrowse={() => setStore(true)} />
        )}

        {/* module store — available in both the loaded and first-run states */}
        <ModuleStore open={store} onClose={() => setStore(false)} ctx={ctx} category={storeCat}
          initialView={storeView || (storeParam === 'language' ? 'language' : 'featured')} />

        <HelpCenter open={!!help} onClose={() => setHelp(null)} initial={help} ctx={ctx} />

        {confirmExit ? (
          <div onClick={() => setConfirmExit(false)} style={{ position: 'absolute', inset: 0, zIndex: 120, background: 'rgba(20,15,10,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 320, background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 24, textAlign: 'center', animation: 'trinityScale .2s ease both' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, marginBottom: 6 }}>Close TrinityOne?</div>
              <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 20px' }}>You can reopen it any time — you’ll pick up right where you left off.</p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setConfirmExit(false)} style={{ flex: 1, padding: 13, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Stay</button>
                <button onClick={() => { const C = window.Capacitor; if (C && C.Plugins && C.Plugins.App) C.Plugins.App.exitApp(); else setConfirmExit(false); }} style={{ flex: 1, padding: 13, borderRadius: 14, border: 'none', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Close</button>
              </div>
            </div>
          </div>
        ) : null}

        {showSplash ? <Splash onDone={() => setShowSplash(false)} /> : null}
        {!showSplash && showOnboarding ? <IdentityOnboarding open={true} identity={identity}
          onSave={(p) => { saveIdentity(p); try { lsSet('trinityone.onboarded', true); } catch (e) {} setShowOnboarding(false); promptFollowChurch(); }}
          onSkip={() => { try { lsSet('trinityone.onboarded', true); } catch (e) {} setShowOnboarding(false); promptFollowChurch(); }} /> : null}
      </PhoneFrame>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
