// app.jsx — TrinityOne root: nav, theme, shared state, overlays, tweaks
const { useState: useA, useEffect: useAE, useRef: useAR } = React;

// `on` = the text colour that sits ON the accent fill. a11y (audit 2026-07-24): white on every DARK-mode
// accent measured 2.16-2.69:1 — below even the 3:1 large-text floor — and dark mode is disproportionately
// chosen by low-vision users. A dark ink on those same accents measures 6.18-7.70:1.
// WCAG relative luminance → pick dark ink or white for text sitting on this colour.
// AUDIT-2026-07-30 P3. A congregation reconnecting in one instant is a self-inflicted denial of service.
//
// Measured against a real relay with a 12k-message corpus, twelve groups, twelve subscriptions per member:
//
//     idle                                median  25ms   max     29ms
//     5 members reconnect  (60 REQs)      median  26ms   max  1,926ms
//     20 members reconnect (240 REQs)     median  26ms   max  7,096ms
//
// (The audit reported 10,157ms as the five-member figure. My reproduction says the MEDIAN is flat and it is the
// WORST CASE that blows out — the relay is not stalled for everyone, but any write arriving mid-burst waits
// behind the whole queue. Same mechanism, different shape from the one written down.)
//
// The relay is single-threaded, so 240 REQs are simply served in turn, ~30ms each. Nothing is broken; the queue
// is just long. The cheapest real fix is not to make the queue faster but to stop it forming.
//
// `visibilitychange` was already gated to once per 2.5s. `online` and `trinity-reconnect` were NOT — they fired
// immediately, with no debounce and no spread. Fifty phones on one church WiFi that blips would therefore all
// reconnect on the same tick. This schedules those over a random window instead.
//
// Deliberately NOT applied to foregrounding: someone who has just opened the app is watching the screen, and
// delaying their refresh to protect the relay would trade a real annoyance for a hypothetical one. Those are
// naturally spread anyway — people open their phones at different moments; a WiFi router does not.
function makeReconnectScheduler(bump, opts) {
  const o = opts || {};
  const debounceMs = o.debounceMs == null ? 2500 : o.debounceMs;
  const jitterMs = o.jitterMs == null ? 3000 : o.jitterMs;
  const rand = o.rand || Math.random;
  const timer = o.setTimeout || ((f, ms) => setTimeout(f, ms));
  const clear = o.clearTimeout || ((t) => clearTimeout(t));
  const now = o.now || (() => Date.now());
  // -Infinity, not 0: the first reconnect after start-up must never be swallowed as "a moment ago".
  let last = -Infinity, pending = null;
  const drop = () => { if (pending) { clear(pending); pending = null; } };
  const run = () => { drop(); last = now(); bump(); };
  return {
    // ADVISORY signals: "it might be worth refreshing". Safe to collapse, safe to delay.
    //   immediate=true  — the member foregrounded the app and is watching the screen.
    //   immediate=false — a radio or router event, spread across the congregation.
    fire(immediate) {
      const t = now();
      if (t - last < debounceMs) return false;      // already reconnected a moment ago
      // A foreground refresh SUPERSEDES a pending jittered one rather than queueing behind it. The debounce
      // check above still applies; what must not happen is the member waiting out someone else's jitter
      // window, which is what the "foregrounding is immediate" comment always claimed and did not do.
      if (immediate || jitterMs <= 0) { run(); return true; }
      if (pending) return false;                     // one already scheduled — never queue a second
      // `last` is set when the bump actually RUNS, not here. Recording it at scheduling time made the
      // guaranteed gap `debounceMs - jitter`, which is zero at the top of the window — two complete
      // teardown-and-re-subscribe cycles in the same millisecond, the storm this exists to prevent.
      pending = timer(run, Math.floor(rand() * jitterMs));
      return true;
    },
    // MANDATORY rebuild. Never debounced, never jittered, never swallowed.
    //
    // src/fellowship.src.js reconnectAll() fires `trinity-reconnect` as the LAST step of a teardown it has
    // ALREADY performed — every church-doc hub closed, the shared-subscription registry emptied, pool.close()
    // on every relay socket. This is the only thing that rebuilds them. Putting it behind the same debounce as
    // an advisory refresh meant a member who unlocked within 2.5s of foregrounding was left on an app that
    // never updated again, with no error anywhere.
    //
    // The rule: a signal that REPAIRS state must not share a gate with signals that merely REFRESH it.
    force() { run(); return true; },
    cancel() { drop(); },
  };
}

function _readableOn(hex) {
  try {
    const h = String(hex).replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
    const c = (full.match(/../g) || []).map(x => parseInt(x, 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return L > 0.42 ? '#2A1B12' : '#fff';
  } catch (e) { return '#fff'; }
}
const ACCENTS = {
  clay:   { light: { c: '#C25A38', i: '#A8462A', s: '#F3DECF', d: '#9C4327', on: '#fff' }, dark: { c: '#E68A66', i: '#EE9E7E', s: '#43271B', d: '#C2613B', on: '#2A1B12' } },
  indigo: { light: { c: '#5360D6', i: '#3E49B8', s: '#E2E3F7', d: '#3A43A0' , on: '#fff' }, dark: { c: '#8E97EE', i: '#A6ADF2', s: '#262A52', d: '#5A63C0' , on: '#2A1B12' } },
  teal:   { light: { c: '#1F9488', i: '#147A70', s: '#D2EEEA', d: '#136B62' , on: '#fff' }, dark: { c: '#52C2B4', i: '#6FD0C3', s: '#16403B', d: '#2E9488' , on: '#2A1B12' } },
  berry:  { light: { c: '#C24B7A', i: '#A53A65', s: '#F6D8E4', d: '#9C3A60' , on: '#fff' }, dark: { c: '#E681A8', i: '#EE9BBC', s: '#4A2333', d: '#C25C84' , on: '#2A1B12' } },
};
const READ_FONTS = {
  Newsreader: "'Newsreader', Georgia, serif",
  Lora: "'Newsreader', Georgia, serif",
};

// ── persisted settings (replaces the design-tool tweaks panel) ──
const SETTINGS_DEFAULTS = { dark: false, accent: 'clay', readScale: 1 };
const WALLET_ENABLED = false;   // pilot: the in-app self-custodial wallet (balance/add/withdraw) is parked — members give from their own external wallet. Flip to true when the wallet is intentionally in scope.
function lsGet(key, fallback){ try{ const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }catch(e){ return fallback; } }
// A LOCKED PHONE MUST NOT WRITE THE CHURCH BACK TO DISK. AUDIT-2026-07-29, found on a device: the
// locked-boot wipe ran correctly and the caches reappeared within seconds, because the subscriptions behind
// these callbacks keep running while locked and re-persist through here. The engine's own caches are guarded
// at their six write points; this is the same rule for the app's, at the one place they all pass through.
// Any key naming a church or a member is refused while there is no signing key on the phone — everything
// else (reader settings, the church list, the member's own data) writes exactly as before.
const _IDENT_KEY = /(npub1[02-9ac-hj-np-z]{20,}|[0-9a-f]{64})/i;
function lsCanWrite(key){ try{ return !_IDENT_KEY.test(String(key)) || !!(window.Fellowship && window.Fellowship.myPubkey); }catch(e){ return true; } }
function lsSet(key, val){ if(!lsCanWrite(key)) return; try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }
// perf #10: merge a delivered kind-0 church profile into the church list, returning the SAME array reference when
// nothing actually changed. The old callbacks did `cs.map(...)` unconditionally → a fresh array on every profile
// re-delivery (incl. per-relay + reconnect), which re-ran the ~9 church-doc subscription effects keyed on `churches`
// — a teardown/reopen storm at startup. Compares scalars by === and object fields (features/rules) by value.
function _mergeChurchProfile(cs, id, p){
  const i = cs.findIndex(x => x.id === id); if (i < 0) return cs;
  const x = cs[i];
  const next = { ...x, name: p.name || x.name,
    channel: p.channel != null ? p.channel : x.channel, audioFeed: p.audioFeed != null ? p.audioFeed : x.audioFeed,
    lnaddr: p.lud16 != null ? p.lud16 : x.lnaddr, giving: p.giving != null ? p.giving : x.giving,
    picture: p.picture != null ? p.picture : x.picture, banner: p.banner != null ? p.banner : x.banner,
    bannerFade: p.bannerFade != null ? p.bannerFade : x.bannerFade, accent: p.accent != null ? p.accent : x.accent,
    features: p.features != null ? p.features : x.features, rules: p.rules != null ? p.rules : x.rules,
    initials: (p.name || x.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() };
  const same = (a, b) => a === b || (a && b && typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b));
  let changed = false; for (const k in next) if (!same(next[k], x[k])) { changed = true; break; }
  if (!changed) return cs;
  const out = cs.slice(); out[i] = next; return out;
}
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
// The verse as shareable text. The share/save buttons on this card used to be decorative — they toasted
// "Saved to Photos" / "Card ready to share" and did nothing at all. Sharing the words is what a member
// actually wants, and unlike rendering the card to an image it needs no extra library.
function verseShareText(v) { if (!v) return ''; const t = String(v.text || '').trim(); const r = String(v.ref || '').trim(); return r ? (t + '\n\n' + r) : t; }
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
          <IconBtn name="chevL" onClick={onClose} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>Share verse</span>
          {/* These two used to be theatre: one toasted "Card ready to share" and the other "Saved to Photos",
              and neither rendered, saved or shared anything. ctx.shareText is the real thing (native share
              sheet, then Web Share, then clipboard), so share the verse itself rather than lie about a file. */}
          <IconBtn name="share" title="Share this verse" onClick={() => { ctx.shareText(verseShareText(verse), 'A verse for you'); }} />
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
          <button onClick={() => { ctx.shareText(verseShareText(verse), 'A verse for you'); }} style={{
            width: '100%', padding: 15, borderRadius: 16, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)',
            fontWeight: 700, fontSize: 15.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', marginBottom: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}><Icon name="share" size={18} color="#fff" /> Share this verse</button>
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
              color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="chevL" size={20} color="#fff" /></button>
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
            border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', padding: '11px 18px', borderRadius: 13,
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

// Is this failure really "no connection"? Don't ask navigator.onLine: in the Capacitor WebView it stays TRUE
// with the radio physically off (verified on-device 2026-07-19, airplane mode), which made the offline hint
// below unreachable in the APK — a member with no signal got a raw technical error instead of being told to
// connect. Treat a network-SHAPED failure as the signal instead. That's also truer on the web, where onLine is
// `true` behind a captive portal or against a dead host while nothing can actually load.
const NETWORK_ERROR_RE = /failed to fetch|load failed|networkerror|net::|err_(internet|network|name|connection|address|timed)|timed? ?out|connection (refused|reset|closed)|unable to resolve/i;
const looksOffline = (error) =>
  (typeof navigator !== 'undefined' && navigator.onLine === false) || NETWORK_ERROR_RE.test(String(error || ''));

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
              background: 'var(--clay)', color: 'var(--on-clay)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 16,
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
        {looksOffline(error)
          ? 'You appear to be offline. Connect to the internet and your Bible will download automatically.'
          : error}
      </p> : null}
      <p style={{ fontFamily: 'var(--font-ui)', fontSize: 12.5, color: 'var(--ink-3)', marginTop: 26 }}>Everything stays on this device — nothing is uploaded.</p>
    </div>
  );
}

// ── "Halo" boot splash: logo reveal, auto-dismiss (tap to skip) ──
function Splash({ onDone, ready }) {
  const [minDone, setMinDone] = useA(false);
  const [fading, setFading] = useA(false);
  useAE(() => {
    const a = setTimeout(() => setMinDone(true), 1900);   // let the logo animation finish before we allow dismissal
    const b = setTimeout(() => setFading(true), 4500);    // hard cap — never hang the splash even if data is slow
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  useAE(() => { if (ready && minDone) setFading(true); }, [ready, minDone]);   // dismiss once the church's cards are loaded
  useAE(() => { if (fading) { const t = setTimeout(onDone, 450); return () => clearTimeout(t); } }, [fading]);   // play the fade, then remove
  return (
    <div className={"to-splash" + (fading ? " sp-fade" : "")} onClick={() => setFading(true)}>
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
  const inviteParam = new URLSearchParams(location.search).get('invite')     // a steward/guardian invite: adopt a ready-made identity + join
    || (() => { try { return new URLSearchParams((location.hash || '').replace(/^#/, '')).get('invite'); } catch (e) { return null; } })();   // SECURITY-AUDIT-2026-07-18: also accept the seed from the URL fragment (#invite=), which never hits the server; ?invite= still accepted for old links
  const churchParam = new URLSearchParams(location.search).get('church');   // '1' / 'follow' opens the switcher
  const dmParam = new URLSearchParams(location.search).get('dm');   // inbox | <peer pubkey> (verification deep-link)
  const servingParam = new URLSearchParams(location.search).get('serving');   // '1' opens the Serving overlay
  const deepLinked = storeParam || tabParam || helpParam || concordParam || bookParam || moduleParam || collParam || churchParam || extraParam || idParam || followParam || inviteParam || dmParam || servingParam;   // any deep-link skips splash/onboarding
  const [showSplash, setShowSplash] = useA(!deepLinked);
  const [bootReady, setBootReady] = useA(false);   // true once the church's core data has arrived — holds the splash until the cards are ready
  const onboardParam = new URLSearchParams(location.search).get('onboard');
  const [showOnboarding, setShowOnboarding] = useA(
    onboardParam === '1' || (!lsGet('trinityone.onboarded', false) && (!deepLinked || !!followParam))   // a FOLLOW link is the moment a NEW member sets up → show the wizard. An INVITE link (guardian→child) adopts a parent-owned, already-named identity, so it must NOT re-onboard. An already-onboarded profile always skips it.
  );
  // identity surfaces (ProfileSheet hub + the focused sheets)
  const [profile, setProfile] = useA(idParam === 'profile');
  const [member, setMember] = useA(idParam === 'member' ? window.TrinityData.MEMBERS.River : null);
  const [idSheet, setIdSheet] = useA(['recovery', 'invite', 'relays'].includes(idParam) ? idParam : null);
  const [newId, setNewId] = useA(idParam === 'newid');
  const [walletSheet, setWalletSheet] = useA(false);   // member wallet hub (balance + add + withdraw)
  const [confirmExit, setConfirmExit] = useA(false);   // hardware-back on Today -> confirm before close
  const [idTick, forceId] = useA(0);           // bumps on identity / profile changes (also re-runs subs that need myPubkey)
  // Optional community PIN: when a PIN is set and not entered this session the identity is locked, the
  // church side is hidden, and the app presents as a plain Bible reader. Tracked live off the identity.
  // LOCKED-NESS IS NOT A ONE-SHOT READING. This sampled TrinityIdentity.isLocked() once, synchronously, at
  // first render — and on native the identity module can still be loading then, so the guard fell through to
  // FALSE, the front-door gate never rendered, and the app opened as if unlocked while holding no identity at
  // all. It then read the relay anonymously. For months that was invisible, because kind-0 was public and
  // every name still resolved; closing that hole (AUDIT-2026-07-27) turned a silent failure into a
  // congregation of nameless people on a screen that looked completely normal. Found on a real phone
  // 2026-07-28. The second clause is the load-bearing one: a PIN blob exists and yet no identity has
  // materialised means we ARE locked, whatever a half-initialised module reports.
  const lockNow = () => {
    const ID = window.TrinityIdentity;
    if (!ID) return false;                                   // module not ready — the poll below re-checks
    if (ID.isLocked && ID.isLocked()) return true;
    if (ID.hasPin && ID.hasPin() && !(window.Fellowship && window.Fellowship.myPubkey)) return true;
    return false;
  };
  const [commLocked, setCommLocked] = useA(lockNow);
  const [commSec, setCommSec] = useA(false);   // the Community-lock sheet (set up / unlock / turn off)
  const [gateEscaped, setGateEscaped] = useA(false);   // "read the Bible without unlocking" — hides the front-door gate for this session (identity stays locked)
  useAE(() => {
    const refreshLock = () => setCommLocked(lockNow());
    const h = () => { forceId(x => x + 1); refreshLock(); };
    window.addEventListener('trinity-identity', h);
    window.addEventListener('trinity-identity-lock', h);
    window.addEventListener('trinity-profiles', h);
    // …and re-check for the first few seconds regardless of whether any of those events fire. The events are
    // the fast path; this is the one that catches a module that finished loading after we first looked, which
    // is exactly the case that shipped the app open with no identity. Bounded, then it stops.
    let n = 0;
    const t = setInterval(() => { refreshLock(); if (++n >= 20) clearInterval(t); }, 400);
    return () => { clearInterval(t); window.removeEventListener('trinity-identity', h); window.removeEventListener('trinity-identity-lock', h); window.removeEventListener('trinity-profiles', h); };
  }, []);
  // forensic hygiene: at a locked boot, wipe any community caches left on disk from a previous session.
  //
  // AUDIT-2026-07-28 F7. This ran ONCE on mount with an empty dependency list, so it read the FIRST-RENDER
  // value of commLocked — the very sample the effect above exists because it is unreliable ("this is the one
  // that catches a module that finished loading after we first looked, which is exactly the case that shipped
  // the app open with no identity"). The lock GATE was fixed to re-check for eight seconds; the wipe beside it
  // was left reading the initial guess, so on the one boot it was written for it did not run at all.
  //
  // Confirmed on a real locked boot (Pixel, 2026-07-29): trinityone.memhub / .members / .membercount /
  // .docshub for the church were all still on disk after the app had settled at the PIN screen.
  //
  // Keyed on commLocked now, and re-armed when it clears, so a mid-session lock wipes too — that is the same
  // path clearCommunityCache's own _k0Seen.clear() was added for.
  const wipedForLock = useAR(false);
  useAE(() => {
    if (!commLocked) { wipedForLock.current = false; return; }   // unlocked → arm again for the next lock
    if (wipedForLock.current) return;
    // RETRY UNTIL THE ENGINE IS THERE, and mark it done only when it actually ran. My first version set the
    // flag before checking window.Fellowship, so a run that arrived before vendor/fellowship.js finished
    // loading recorded itself as "wiped" and never tried again — and keying on commLocked makes that EARLIER
    // render more likely, not less. The device caught it: 11 church-keyed caches still on disk at a locked
    // boot. Returning without the flag is not enough either, because commLocked does not change again, so
    // this effect would never re-fire. Hence a bounded poll.
    let stopped = false;
    const attempt = () => {
      if (stopped || wipedForLock.current) return true;
      if (!(window.Fellowship && window.Fellowship.clearCommunityCache)) return false;
      wipedForLock.current = true;
      try { window.Fellowship.clearCommunityCache(); } catch (e) {}
      return true;
    };
    if (attempt()) return;
    const t = setInterval(() => { if (attempt()) clearInterval(t); }, 300);
    const give = setTimeout(() => clearInterval(t), 20000);
    return () => { stopped = true; clearInterval(t); clearTimeout(give); };
  }, [commLocked]);
  // the in-app wallet is the member's, always-on (rides on their key) — boot it once so the balance is
  // ready everywhere (profile hub, Giving tab), independent of any church's giving switch.
  useAE(() => { if (WALLET_ENABLED && window.TrinityWallet) window.TrinityWallet.init().catch(() => {}); }, []);
  // App links (AUDIT-2026-07-24). The manifest now claims https://app.trinityone.church/join, so tapping an
  // invite opens the APP rather than the browser — but Android hands us the URL as an intent, and every join
  // param in this file is read from location.search at mount. Without this the app would open on a blank
  // first-run and silently drop the invite, which is worse than the browser path it replaced.
  //
  // We re-enter the app with just the join params in the query, which reloads the local page and lets the
  // EXISTING follow/invite/name/relay handling run unchanged — no second implementation to keep in sync.
  useAE(() => {
    // AUDIT 2026-07-25. `invite` is NOT here, deliberately: it carries a 12-word seed and `?invite=` triggers
    // importMnemonic(), i.e. it REPLACES the device identity. Nothing in the product ever builds /join?invite= —
    // inviteUrlFor() puts the seed in the URL FRAGMENT at the root path precisely so it never persists — so the
    // only party who could produce one is an attacker, and the app-link made it a single tap into the native app
    // rather than a browser tab. `relayname` IS here: a self-hosted church behind a free tunnel gets a new URL
    // each restart, so a printed invite's ?relay= goes stale and the stable name is the only recovery. Dropping
    // it made the app path strictly worse than the browser path it replaced (member joins, sees nothing, ever).
    const JOIN_KEYS = ['follow', 'name', 'relay', 'relayname', 'c'];
    const APP_HOST = 'app.trinityone.church';
    const safeQuery = (url) => {
      let u; try { u = new URL(url); } catch (e) { return null; }
      // Scheme + host, not just path. MainActivity is exported and Capacitor hands us getData() from ANY launch
      // intent with no host check, so without this any installed app could fire a crafted intent at us with zero
      // permissions and no user interaction, and have it treated as a real invite.
      if (u.protocol !== 'https:' || u.host !== APP_HOST) return null;
      // The manifest claims pathPrefix="/join", which also matches the real assets /join.html and /join.js.
      // Accept those too, or tapping a /join.html invite opens the app and silently discards the invite —
      // the exact failure this feature exists to remove.
      if (!/^\/join(\.html|\.js)?\/?$/.test(u.pathname)) return null;
      const out = new URLSearchParams();
      for (const k of JOIN_KEYS) {
        const v = u.searchParams.get(k);
        if (!v) continue;
        if (k === 'relay' && !/^wss:\/\//i.test(v)) continue;   // encrypted transport only (NOT a trust check)
        out.set(k, v);
      }
      return out.get('follow') ? out.toString() : null;
    };
    // `replay` = this URL came from getLaunchUrl(), which keeps returning the SAME url after we navigate, so it
    // must be de-duplicated or the app reload-loops on a cold start. An appUrlOpen event is the opposite: it
    // fires because the member just tapped a link THIS INSTANT, so it must always be honoured.
    // Found by testing on hardware: tap an invite, skip setup (which discards the deferred join), tap the same
    // invite again — and nothing happened at all, because the dedupe had already consumed it. No message, no
    // wizard, no church. The member's only escape was to force-quit the app.
    const apply = (url, replay) => {
      const q = safeQuery(url);
      if (!q) return;
      // getLaunchUrl keeps returning the same URL after we reload, so remember what we've handled or the app
      // reload-loops forever on a cold start from a link. Store a HASH, never the URL: a link can carry
      // credential-grade material, and this slot is never cleared (SECURITY-AUDIT-2026-07-06 L3 moved the seed
      // out of persisted storage for exactly this reason). Keep the last few so tapping link A then link B
      // doesn't re-apply A on the next load.
      const h = (() => { let x = 5381; for (let i = 0; i < url.length; i++) x = ((x << 5) + x + url.charCodeAt(i)) | 0; return String(x); })();
      try {
        const seen = (sessionStorage.getItem('trinityone.handledLinks') || '').split(',').filter(Boolean);
        if (replay && seen.includes(h)) return;   // only the launch-URL replay is de-duplicated
        if (!seen.includes(h)) sessionStorage.setItem('trinityone.handledLinks', [...seen, h].slice(-5).join(','));
      } catch (e) {}
      if (location.search.replace(/^\?/, '') === q) return;   // already showing this invite
      location.search = '?' + q;
    };
    let remove = null;
    try {
      const AppP = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (AppP) {
        if (AppP.getLaunchUrl) Promise.resolve(AppP.getLaunchUrl()).then(r => { if (r && r.url) apply(r.url, true); }).catch(() => {});
        if (AppP.addListener) Promise.resolve(AppP.addListener('appUrlOpen', (e) => { if (e && e.url) apply(e.url, false); }))
          .then(h => { remove = (h && h.remove) ? () => h.remove() : null; }).catch(() => {});
      }
    } catch (e) {}
    return () => { if (remove) { try { remove(); } catch (e) {} } };
  }, []);
  // connTick bumps when the app returns to the foreground or the network reconnects. Relay WebSockets
  // drop while a phone is backgrounded, and a dropped socket silently misses live pushes — so we tear
  // down and re-establish the church subscriptions on resume, which re-queries and catches up anything
  // published while we were away (fixes "new devotionals/events don't appear until I reload").
  const [connTick, bumpConn] = useA(0);
  useAE(() => {
    let last = Date.now();
    // force the church-doc hubs to re-fetch too (bumpConn alone can't reopen a hub the chat/care screens hold open)
    const refetch = () => { try { const F = window.Fellowship; if (F && F.refetchChurchDocs) F.refetchChurchDocs(); } catch (e) {} };
    // P3: one scheduler for every reconnect signal, so the debounce is shared. A phone that foregrounds AND
    // fires `online` in the same second must reconnect once, not twice.
    const sched = makeReconnectScheduler(() => { bumpConn(x => x + 1); refetch(); });
    const onVis = () => { if (document.visibilityState === 'visible') sched.fire(true); };   // user is watching → no delay
    const onOnline = () => { sched.fire(false); };   // radio/router event → spread across the congregation
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onVis);
    // Fellowship fires this after a PIN unlock: it has dropped the stale (anonymous) relay sockets, so we
    // must re-run the church subscriptions to reopen them — now authenticated with the just-derived key.
    // NOT onOnline: a PIN unlock has already torn every socket down, so this must never be debounced away.
    // force() already runs the bump callback, which refetches. Calling refetch() again here doubled the
    // church-doc fetch at the exact moment every subscription is being rebuilt — measured on device (a single
    // unlock produced two refetches). Harmless but backwards, on the one path that is already the most
    // expensive thing the app does.
    const onReconnectNeeded = () => { sched.force(); };
    window.addEventListener('trinity-reconnect', onReconnectNeeded);
    // Native resume: web visibilitychange/focus are unreliable in the Android WebView, so RETURNING to a
    // backgrounded app often didn't re-subscribe — a steward's change (chat tags, groups, care) then never
    // appeared until a force-close+reopen. The App plugin's appStateChange is the reliable native foreground
    // signal; on resume we re-run the church subscriptions (a cheap since-cursor re-fetch) so updates land.
    let appRemove = null;
    try {
      const AppP = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (AppP && AppP.addListener) {
        Promise.resolve(AppP.addListener('appStateChange', (s) => { if (s && s.isActive) sched.fire(true); }))
          .then(h => { appRemove = (h && h.remove) ? () => h.remove() : null; }).catch(() => {});
      }
    } catch (e) {}
    // perf #2: the 90s tick used to bump connTick UNCONDITIONALLY, tearing down + reopening ~15 subscription
    // effects every 90s (several with no `since` → full-backlog re-download over the funnel) even on a healthy
    // socket. Now it only bumps when a relay we opened has actually DROPPED (relaysHealthy() === false) — the same
    // gate the steward console already uses. A real drop (e.g. a deploy restart) still re-subscribes to recover;
    // the foreground/online events above still fire immediately (those are real reconnect signals, not a blind timer).
    const beat = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const F = window.Fellowship;
      if (F && F.relaysHealthy && F.relaysHealthy()) return;   // healthy → skip the storm
      sched.fire(false);   // P3: a relay restart drops EVERY member at once — jitter this one especially
    }, 90000);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', onOnline); window.removeEventListener('focus', onVis); window.removeEventListener('trinity-reconnect', onReconnectNeeded); if (appRemove) { try { appRemove(); } catch (e) {} } clearInterval(beat); sched.cancel(); };
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
        setChurches(cs => _mergeChurchProfile(cs, c.id, p));
      }));
    return () => offs.forEach(o => { try { o && o(); } catch (e) {} });
  }, []);
  const [churchSwitcher, setChurchSwitcher] = useA(churchParam === '1' || churchParam === 'follow');
  const [churchSwitcherMode, setChurchSwitcherMode] = useA(churchParam === 'follow' ? 'follow' : 'list');
  // A 12-word restore that recovered the account but found NO church sets this flag and reloads (a church on
  // its own relay is invisible to a fresh install). Open the scanner straight away so "scan your church's code"
  // is the very next thing they see, rather than an app with no church and no explanation.
  // Second half of AUDIT-2026-07-26 CRITICAL 2: do not BURN the one-shot while the wizard is covering the
  // screen. This effect ran at mount regardless, so on a device that still looked un-onboarded it deleted the
  // flag under the wizard and the scanner the member had just asked for never opened — on any launch, not only
  // the lost-words one. Wait until the wizard is out of the way, then spend it.
  useAE(() => {
    if (showOnboarding) return;
    let want = false;
    try { want = localStorage.getItem('trinityone.openFollow') === '1'; } catch (e) {}
    if (!want) return;
    try { localStorage.removeItem('trinityone.openFollow'); } catch (e) {}   // one-shot: never trap them in it
    setChurchSwitcherMode('follow'); setChurchSwitcher(true);
  }, [showOnboarding]);
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
    // UX #1: validate the bech32 CHECKSUM before following. The regex matches shape only, so a mistyped code (one
    // wrong char) previously passed and we'd follow a phantom church stuck showing the placeholder name "Church".
    // toPub returns null on a bad checksum → reject here so the Follow sheet shows its "couldn't find that church" error.
    if (window.Fellowship && window.Fellowship.toPub && !window.Fellowship.toPub(npub)) return false;
    const F = window.Fellowship;
    if (F && F.addRelay) {
      // always connect to the whole shared pool (the church publishes across all of it), so a member
      // gets every community node for redundancy — not just the single relay carried in their link.
      const pool = F.CANONICAL_RELAYS || (F.CANONICAL_RELAY ? [F.CANONICAL_RELAY] : []);
      pool.forEach(r => F.addRelay(r));
      // plus any church-specific relay carried in the invite/QR (?relay=wss://…) — e.g. a self-hosted one
      const rm = String(raw || '').match(/[?&]relay=([^&\s]+)/);
      // SECURITY-AUDIT-2026-07-06 L5: require wss:// (encrypted). A crafted invite carrying ?relay=ws://attacker
      // would otherwise add a cleartext relay to the member's set → a network MITM reads/injects fellowship traffic.
      if (rm) { try { const relay = decodeURIComponent(rm[1]); if (/^wss:\/\//i.test(relay)) F.addRelay(relay); } catch (e) {} }
      // A self-hosted relay behind a free tunnel gets a NEW url each restart, so a printed invite's ?relay= can
      // go dead. The invite also carries the relay's STABLE directory name — resolve it against the shared
      // directory to the relay's CURRENT url so an old QR still works after a restart. Best-effort + additive;
      // L5 still enforced (must resolve to wss://).
      // AUDIT-2026-07-29 S3. This asked app.trinityone.church, hardcoded, and nothing else. For a SELF-HOSTED
      // congregation that is the one request that undoes self-hosting: joining from a printed slip told the
      // central host that this device exists, that it is joining now, and which relay it is looking for — at
      // the single most sensitive moment there is. The whole point of a church running its own box is that no
      // central party sees its people.
      //
      // /relay-names/resolve/ is public on EVERY relay and the directory is gossiped between them, so the
      // church's own relay can answer this perfectly well. Ask the relay the invite already names FIRST, and
      // fall back to the shared directory only if that fails (an invite may carry a name and no URL, or the
      // self-hosted box may be down at that moment).
      //
      // No new trust: the invite's ?relay= is added directly two lines above, so preferring it as a resolver
      // grants it nothing it did not already have, and L5 (must resolve to wss://) still applies to whatever
      // comes back.
      const nmm = String(raw || '').match(/[?&]relayname=([^&\s]+)/);
      if (nmm && F && F.addRelay) { try {
        const name = decodeURIComponent(nmm[1]).toLowerCase().replace(/[^a-z0-9-]/g, '');
        const hosts = [];
        try { const v = rm && decodeURIComponent(rm[1]); if (v && /^wss:\/\//i.test(v)) hosts.push(v.replace(/^wss:\/\//i, 'https://').replace(/\/relay\/?$/i, '')); } catch (e) {}
        hosts.push('https://app.trinityone.church');   // last resort, not first choice
        if (name) (async () => {
          for (const h of hosts) {
            try {
              const r = await fetch(h + '/relay-names/resolve/' + encodeURIComponent(name), { cache: 'no-store' });
              if (!r.ok) continue;
              const j = await r.json();
              const u = j && j.url;
              if (u && /^wss:\/\//i.test(u)) { F.addRelay(u); return; }   // resolved — ask nobody else
            } catch (e) {}
          }
        })();
      } catch (e) {} }
    }
    setChurches(cs => cs.find(c => c.id === npub) ? cs : [...cs, { id: npub, npub, name: 'Church', initials: 'CH', accent: 'var(--clay)', tagline: '', sub: 'Followed', verified: false, members: 0 }]);
    setActiveChurch(npub); lsSet('trinityone.activeChurch', npub);
    // announce membership so the steward sees this person joined, even if they never post
    if (window.Fellowship && window.Fellowship.announceMembership) window.Fellowship.announceMembership(npub);
    if (!(window.Fellowship && window.Fellowship.subscribeChurchProfile)) return () => {};
    const _stopProfile = window.Fellowship.subscribeChurchProfile(npub, (p) => {
      if (!p) return;
      setChurches(cs => _mergeChurchProfile(cs, npub, p));
    });
    // FEDERATION Phase 2: also read the church's signed NIP-65 relay-list and adopt the (enforcing) relays it
    // declares — so relay moves/additions are followed without a new invite link. Additive + fail-closed.
    const _stopRelays = window.Fellowship.subscribeChurchRelays ? window.Fellowship.subscribeChurchRelays(npub) : () => {};
    return () => { try { _stopProfile && _stopProfile(); } catch (e) {} try { _stopRelays && _stopRelays(); } catch (e) {} };
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
    // MARK DONE ON SUCCESS, NOT ON ATTEMPT. announceMembership is async and used to be called un-awaited, with
    // the 12-hour heartbeat stamp written regardless — so a failed announce set the clock anyway and the member
    // stayed invisible to their church for half a day. It is now queued in the outbox as well, so a failure is
    // retried rather than lost, but the stamp must still only mean "this landed". UX audit 2026-08-04.
    const beat = () => { Promise.resolve(F.announceMembership(np)).then(ok => { if (ok && lsCanWrite('trinityone.hb:' + np)) { try { localStorage.setItem('trinityone.hb:' + np, String(Date.now())); } catch {} } }).catch(() => {}); };
    if (F.ready && F.ready.then) F.ready.then(beat).catch(() => {}); else beat();
  }, [activeChurch]);
  const pendingFollowRef = React.useRef(null);   // S2: a follow link opened before onboarding — defer the join+announce until the wizard completes (consent-first)
  useAE(() => {
    if (!inviteParam && !followParam) return;
    let cleanup;
    (async () => {
      // SECURITY-AUDIT-2026-07-06 L3: capture the invite context, then scrub the URL IMMEDIATELY — before the
      // confirm dialog and the multi-second awaits below. Previously the scrub ran only at the very END and was
      // skipped entirely if the user cancelled the overwrite confirm, so the cleartext BIP-39 seed lingered in
      // the address bar / history / bookmarks (and could leak via Referer on the next request).
      const _search = (typeof location !== 'undefined' && location.search) || '';
      const _inviteSeed = inviteParam ? decodeURIComponent(inviteParam) : '';
      let _nameP = ''; try { _nameP = new URLSearchParams(_search).get('name') || ''; } catch (e) {}
      try { const u = new URL(location.href); ['invite', 'follow', 'relay', 'name'].forEach(k => u.searchParams.delete(k)); let hash = u.hash; try { if (/[#&]invite=/.test(hash)) { const hp = new URLSearchParams(hash.replace(/^#/, '')); hp.delete('invite'); const hs = hp.toString(); hash = hs ? '#' + hs : ''; } } catch (e) {} const q = u.searchParams.toString(); history.replaceState(null, '', u.pathname + (q ? '?' + q : '') + hash); } catch (e) {}   // SECURITY-AUDIT-2026-07-18: also strip #invite= from the fragment
      // a steward invite hands the recipient a ready-made anonymous identity — adopt it first, then join
      if (inviteParam && window.TrinityIdentity && window.TrinityIdentity.importMnemonic) {
        // SECURITY-AUDIT-2026-07-06 L4: a seed-carrying `?invite=` is now ONLY the guardian→child handoff — a
        // parent setting up an account they OWN on the child's device. (Friend invites are follow-only join links
        // that mint the joiner's own key.) Adopting a handed key is deliberate, so CONFIRM in BOTH cases — so a
        // crafted link can never silently take over a device, whether replacing an existing identity OR seeding a
        // fresh phone. This closes the old gap where a fresh device adopted an invite seed with no prompt.
        const _ID = window.TrinityIdentity;
        const _curNpub = (_ID && ((_ID.current && _ID.current.npub) || _ID.npub)) || '';
        const _msg = _curNpub
          ? ('This link will REPLACE your current TrinityOne identity with a different one.\n\nCurrent: ' + _curNpub.slice(0, 18) + '…\n\nOnly continue if someone you trust gave you this link to set up a specific account (e.g. a parent setting up a child’s account). Otherwise cancel.\n\nContinue?')
          : ('This link sets up a TrinityOne account that someone ELSE created — its key is known to whoever made the link (this is how a parent sets up a child’s account). Only continue if you were handed this link directly and trust them.\n\nIf you just want to join a church, cancel and use a normal join link instead.\n\nContinue?');
        if (!window.confirm(_msg)) { return; }   // bail the entire follow+name flow too
        const before = (window.Fellowship && window.Fellowship.myPubkey) || '';
        try {
          await window.TrinityIdentity.importMnemonic(_inviteSeed);
          try { lsSet('trinityone.onboarded', true); } catch (e) {}
          // wait for the fellowship transport to re-derive its signing key from the new identity,
          // so membership is announced (and chat is signed) as the invited identity, not the old one
          for (let i = 0; i < 25; i++) { await new Promise(r => setTimeout(r, 100)); const now = window.Fellowship && window.Fellowship.myPubkey; if (now && now !== before) break; }
        } catch (e) {}
      }
      const src = (followParam || '') + _search;   // captured before the scrub — still carries ?relay= etc. for followChurch
      if (/npub1[0-9a-z]{20,}/.test(src)) {
        // S2: on a not-yet-onboarded device a PLAIN follow link defers its join+announce until the wizard
        // completes — so opening a link never publishes a membership doc before the person consents/names.
        // (An invite link already adopted a consented, parent-owned identity above, so it joins now.)
        if (followParam && !inviteParam && !lsGet('trinityone.onboarded', false)) pendingFollowRef.current = src;
        else { const off = followChurch(src); if (typeof off === 'function') cleanup = off; }
      }
      // a bulk-invite slip carries the person's name (?name=) so the steward's directory shows it without
      // anyone typing. Set it ONLY for a fresh scanner with no name yet — never overwrite an existing name.
      if (_nameP) {
        const want = _nameP.slice(0, 40).trim();   // _nameP came from URLSearchParams.get() — already decoded; decoding again broke names with a literal '%'
        for (let i = 0; i < 20 && want; i++) {
          await new Promise(r => setTimeout(r, 150));
          const cur = window.Fellowship && window.Fellowship.myProfile;
          if (!cur) continue;
          if (cur.name) break;                                   // existing/named user — leave them alone
          try { saveIdentity({ name: want }); } catch (e) {}
          break;
        }
      }
      // (the URL was already scrubbed at the top of this effect — L3)
    })();
    return () => { if (cleanup) cleanup(); };
  }, []);
  // SELF-HEAL a dangling active church. Every church subscription resolves the active church by
  // `churches.find(c => c.id === activeChurch)`, and when that finds nothing it quietly passes null — so the
  // app subscribes to NOTHING while the header still shows a church name and every list renders empty with no
  // error anywhere. leaveChurch() re-points it on the in-app path, but nothing repaired it when the stored id
  // went stale by any other route (a restored backup, a church dropped from the list, hand-edited storage), and
  // it never recovered on its own — the member just had a permanently empty app that looked fine.
  // Found on the test phone: the stored id named a church no longer followed and every subscription read 0.
  useAE(() => {
    if (!activeChurch || churches.find(c => c.id === activeChurch)) return;   // resolves fine — nothing to do
    const next = (churches.find(c => c.npub) || churches[0] || {}).id || null;
    if (next === activeChurch) return;                                        // no better option; don't loop
    console.warn('[trinity] active church', activeChurch, 'is not in the followed list — falling back to', next);
    setActiveChurch(next); lsSet('trinityone.activeChurch', next);
  }, [activeChurch, churches]);
  // RESTORE, SECOND HALF. The restore pane cannot look up the member's churches itself — at that moment the
  // key is seconds old, no relay connection has settled and nothing has authenticated, so the member's own
  // (gated) docs come back empty. It leaves `restorePending` instead and we finish the job HERE, from the
  // running app, once there is a healthy connection — the state in which the same lookup measurably works.
  // Symptom this fixes: a restored member whose phone received a church's message notification while the app
  // insisted they belonged to no church. The relay knew; the app had asked before it could prove who it was.
  //
  // AUDIT-2026-07-26 CRITICAL 4 — how the first version of this became a broadcast station, measured at 12
  // profile republishes a minute to every member of the church, forever, on the phone that had just come back
  // from nothing and on the worst connection it will ever have. Four compounding mistakes, all fixed here:
  //   • it read `restorePending` ONCE at mount and never again, so clearing the flag on success stopped nothing;
  //   • setInterval does not await an async callback, so up to ~6 recoveries ran concurrently, each holding a
  //     live 2-filter REQ for the member's entire authored corpus;
  //   • it called saveIdentity() on every pass with no comparison, and setProfile published a fresh kind-0
  //     each time — self-sustaining, because recoverIdentity subscribes to the member's own kind-0 and so
  //     re-found the name it had just written. It could never converge to "nothing to do";
  //   • its one guard, relaysHealthy(), answered true when nothing was connected (fixed in fellowship.src.js).
  // Now: a bounded, backing-off chain of single-flight attempts (a recursive timeout cannot overlap itself),
  // stopping the moment the job is done. If it runs out of attempts the FLAG STAYS SET, so the next launch —
  // or the next real reconnect, which re-runs this effect via connTick — picks the job up again.
  useAE(() => {
    const readPending = () => { try { return localStorage.getItem('trinityone.restorePending') === '1'; } catch (e) { return false; } };
    if (!readPending()) return;
    const F = window.Fellowship;
    if (!F || !F.recoverIdentityRetry) return;
    let stop = false, t = null, tries = 0, waits = 0;
    const DELAYS = [0, 4000, 8000, 15000, 30000, 60000, 120000];   // ~4 minutes of trying, then leave it for next launch
    const clear = () => { if (t) { clearTimeout(t); t = null; } };
    const halt = () => { stop = true; clear(); };
    const schedule = (ms) => { if (stop) return; clear(); t = setTimeout(run, ms); };
    // EXHAUSTED, ON A CONNECTION THAT WORKED, IS AN ANSWER. The flag used to be left armed whenever nothing
    // came back, so the whole four-minute chain re-ran on every launch for ever. That was survivable while the
    // name lived in kind-0 (almost every restore found something), but Stage 2 removed it: a member who
    // belonged to no church has nothing to recover, by definition, and would have re-run this for the life of
    // the install. The dead-connection case that the flag exists for is handled separately below — we only get
    // here after relaysHealthy() said yes and we asked seven times over four minutes. AUDIT-2026-07-27.
    const next = () => {
      if (tries >= DELAYS.length) { try { localStorage.removeItem('trinityone.restorePending'); } catch (e) {} halt(); return; }
      schedule(DELAYS[tries++]);
    };
    const run = async () => {
      if (stop) return;
      if (!readPending()) return halt();      // another route (the restore pane, an earlier pass) already finished
      if (!F.myPubkey || !(F.relaysHealthy && F.relaysHealthy())) {
        // not connected yet — that is not a failed attempt, so don't spend one; just look again shortly.
        if (waits++ < 30) schedule(4000); else halt();
        return;
      }
      let found = { churches: [], name: '' };
      try { found = await F.recoverIdentityRetry(3, 3000); } catch (e) { found = { churches: [], name: '' }; }
      if (stop) return;
      // Adopt a recovered name ONLY when it isn't already ours. saveIdentity → setProfile publishes a kind-0 to
      // every relay and it reaches the whole church, so an unconditional call here is the storm above.
      const mine = ((F.myProfile || {}).name || '').trim();
      if (found.name && found.name.trim() && found.name.trim() !== mine) { try { saveIdentity({ name: found.name }); } catch (e) {} }
      if (found.churches.length) {
        const list = found.churches.map(cp => { const np = F.toNpub ? F.toNpub(cp) : cp; return { id: np, npub: np, name: '', initials: '', sub: 'Followed' }; });
        setChurches(prev => [...prev, ...list.filter(l => !prev.find(p => p.id === l.id))]);
        setActiveChurch(list[0].id);
        try { lsSet('trinityone.activeChurch', list[0].id); } catch (e) {}
      }
      // Done once we recovered something. Otherwise leave the flag set — a member who restored on a dead
      // connection is retried on the next launch rather than silently left church-less forever.
      if (found.churches.length || found.name) { try { localStorage.removeItem('trinityone.restorePending'); } catch (e) {} return halt(); }
      next();
    };
    next();
    return () => { halt(); };
  }, [connTick]);
  // scope outgoing chat to the active church, so its steward sees who's participating (Members)
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    if (window.Fellowship && window.Fellowship.setChurch) window.Fellowship.setChurch(np || null);
  }, [activeChurch, churches, connTick]);
  // reading plans the active church shares (steward console publishes them) -> shown in Plans
  const [churchPlans, setChurchPlans] = useA([]);
  // ── lazy load: paint Today + community essentials first, then fire heavier non-essential subscriptions
  // (member directory, plans, events, safeguarding, networks) ~1.2s later so they don't contend with first
  // paint for the single relay connection — the measured first-load cost is the connect + initial fetch.
  const [lazyReady, setLazyReady] = useA(false);
  useAE(() => { const t = setTimeout(() => setLazyReady(true), 1200); return () => clearTimeout(t); }, []);
  useAE(() => {
    if (!lazyReady) return;
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    if (!np || !(window.Fellowship && window.Fellowship.subscribeChurchPlans)) { setChurchPlans([]); return; }
    return window.Fellowship.subscribeChurchPlans(np, setChurchPlans);
  }, [activeChurch, churches, connTick, lazyReady]);
  // live member count for the active church (so the switcher doesn't read "0 members")
  useAE(() => {
    if (!lazyReady) return;
    const c = churches.find(x => x.id === activeChurch);
    if (!c || !c.npub || !(window.Fellowship && window.Fellowship.subscribeChurchMemberCount)) return;
    // Only bump `churches` when the count ACTUALLY changed — returning a fresh array on every roster tick
    // re-ran all ~9 church-doc effects keyed on `churches` (a teardown/reopen storm). On the slower web build
    // that churn raced the Care-settings delivery and lost, so the Care tab never appeared there (fine on APK).
    return window.Fellowship.subscribeChurchMemberCount(c.npub, (n) => setChurches(cs => {
      const cur = cs.find(x => x.id === activeChurch);
      if (!cur || cur.members === n) return cs;   // unchanged → same reference → no effect churn
      return cs.map(x => x.id === activeChurch ? { ...x, members: n } : x);
    }));
  }, [activeChurch, connTick, lazyReady]);
  // prefetch the People directory at app load (not when the screen opens) so it's ready before the
  // member taps "People" — the roster streams in the background while they read elsewhere.
  const [churchPeople, setChurchPeople] = useA([]);
  const [churchPeopleLoading, setChurchPeopleLoading] = useA(false);
  useAE(() => {
    if (!lazyReady) return;
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    if (!np || !(window.Fellowship && window.Fellowship.subscribeChurchMembers)) { setChurchPeople([]); setChurchPeopleLoading(false); return; }
    setChurchPeopleLoading(true);
    const t = setTimeout(() => setChurchPeopleLoading(false), 9000);   // safety: stop "loading" even on a slow relay
    const off = window.Fellowship.subscribeChurchMembers(np, (m, done) => { setChurchPeople(m); if (done) { setChurchPeopleLoading(false); clearTimeout(t); } });
    return () => { clearTimeout(t); if (off) off(); };
  }, [activeChurch, connTick, lazyReady]);
  // devotionals the active church shares (text/Markdown reflections)
  const [churchDevos, setChurchDevos] = useA([]);
  const [openDevo, setOpenDevo] = useA(null);   // a church devotional opened for reading
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    if (!np || !(window.Fellowship && window.Fellowship.subscribeChurchDevotionals)) { setChurchDevos([]); return; }
    setChurchDevos(lsGet('trinityone.devos.' + np, []));   // paint instantly from cache so the devotional card doesn't pop in mid-load
    return window.Fellowship.subscribeChurchDevotionals(np, d => { setChurchDevos(d); lsSet('trinityone.devos.' + np, d); });
  }, [activeChurch, churches, connTick]);
  // the church's featured/pinned sermon (a steward pushes it) → a Today card + a notification
  const [pinnedSermon, setPinnedSermon] = useA(null);
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    if (!np || !(window.Fellowship && window.Fellowship.subscribePinnedSermon)) { setPinnedSermon(null); return; }
    return window.Fellowship.subscribePinnedSermon(np, setPinnedSermon);
  }, [activeChurch, churches, connTick]);
  // ── Care / Meal trains: open needs the church shared that a member can sign up to help with ──
  const [careSettings, setCareSettings] = useA({ enabled: false, visibility: 'all', openedBy: 'steward', adminGroupId: '' });
  const [careNeeds, setCareNeeds] = useA([]);
  const [careSlots, setCareSlots] = useA([]);
  const [careSkips, setCareSkips] = useA([]);
  const [careAvail, setCareAvail] = useA([]);   // members who've flipped "I'm here to help"
  const [optCare, setOptCare] = useA({});   // optimistic care fill/clear ('needId|iso' -> 'fill'|'clear') so "I'll help" flips instantly
  const careNpRef = React.useRef(null);
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    const F = window.Fellowship;
    if (!np || !F || !F.subscribeMealsSettings) { setCareSettings({ enabled: false, visibility: 'all', openedBy: 'steward', adminGroupId: '' }); setCareNeeds([]); setCareSlots([]); setCareSkips([]); setCareAvail([]); setBootReady(true); careNpRef.current = null; return; }
    const churchChanged = careNpRef.current !== np;
    careNpRef.current = np;
    // On a CHURCH CHANGE, paint from this church's cache (or empty). On a mere RECONNECT (same church), do NOT
    // reset to empty defaults — that reset, on a cold cache, is what made the care banner/card flash off-then-on.
    // On reconnect, refresh from cache only when it actually holds data; otherwise leave the sticky-sub state be.
    if (churchChanged) {
      setCareSettings(lsGet('trinityone.care.s.' + np, { enabled: false, visibility: 'all', openedBy: 'steward', adminGroupId: '' }));
      setCareNeeds(lsGet('trinityone.care.n.' + np, []));
      setCareSlots(lsGet('trinityone.care.sl.' + np, []));
      setCareSkips(lsGet('trinityone.care.sk.' + np, []));
      setCareAvail(lsGet('trinityone.care.av.' + np, []));
    } else {
      const cs = lsGet('trinityone.care.s.' + np, null); if (cs) setCareSettings(cs);
      const cn = lsGet('trinityone.care.n.' + np, null); if (cn) setCareNeeds(cn);
      const csl = lsGet('trinityone.care.sl.' + np, null); if (csl) setCareSlots(csl);
      const csk = lsGet('trinityone.care.sk.' + np, null); if (csk) setCareSkips(csk);
      const cav = lsGet('trinityone.care.av.' + np, null); if (cav) setCareAvail(cav);
    }
    setBootReady(true);   // reveal the app off the cache paint — don't gate first paint on the relay round-trip (cards still refresh when the subs deliver)
    const subs = [
      F.subscribeMealsSettings(np, s => { setCareSettings(s); lsSet('trinityone.care.s.' + np, s); setBootReady(true); }),
      // SECURITY-AUDIT-2026-07-20 S-7: this cached the DECRYPTED needs — recipient name, free-text notes,
      // the address the UI asks for — straight back into cleartext localStorage. That took the data off the
      // wire and put it on the device, where a seized or shared phone reads it, and where the community-PIN
      // lock does not wipe it. Cache only the half that is public anyway, so the slot grid still paints
      // offline; the identifying fields come back when the care key does.
      F.subscribeCareNeeds(np, n => {
        setCareNeeds(n);
        const safe = (n || []).map(x => ({ id: x.id, _by: x._by, type: x.type, dates: x.dates, meals: x.meals, dayMeals: x.dayMeals, startDate: x.startDate, endDate: x.endDate, ts: x.ts, _sealed: true }));
        lsSet('trinityone.care.n.' + np, safe);
      }),
      F.subscribeCareSlots(np, x => { setCareSlots(x); lsSet('trinityone.care.sl.' + np, x); }),
      F.subscribeCareSkips(np, x => { setCareSkips(x); lsSet('trinityone.care.sk.' + np, x); }),
      F.subscribeCareAvail && F.subscribeCareAvail(np, x => { setCareAvail(x); lsSet('trinityone.care.av.' + np, x); }),
    ];
    return () => subs.forEach(u => { try { u && u(); } catch {} });
  }, [activeChurch, churches, connTick]);
  // ── serving & events: the member is driven by the requests the church p-tags to them ──
  const [servReqs, setServReqs] = useA([]);     // serving requests addressed to me ("can you serve?")
  const [servReplies, setServReplies] = useA({}); // my replies: { requestId: 'accept'|'decline'|'swap' }
  const [churchEvents, setChurchEvents] = useA([]);
  const [myRsvps, setMyRsvps] = useA({});       // { eventId: 'going'|'maybe'|'no' }
  const [openServing, setOpenServing] = useA(servingParam === '1');
  const [servingTab, setServingTab] = useA('serving');   // which Serving tab to land on (e.g. 'care' from the cared-for banner)
  const [careFocus, setCareFocus] = useA(null);          // a care need id to auto-open when Serving → Care opens (deep-link from the banner)
  const [eventOv, setEventOv] = useA(null);   // focused event-detail sheet
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub || '';
    const F = window.Fellowship; if (!F) return;
    // cache-first: paint my serving requests / replies / RSVPs so the "You're serving" card + RSVP state
    // don't flash blank while the network subs catch up.
    setServReqs(lsGet('trinityone.serv.reqs.' + np, []));
    setServReplies(lsGet('trinityone.serv.replies.' + np, {}));
    setMyRsvps(lsGet('trinityone.serv.rsvps.' + np, {}));
    const subs = [];
    if (F.subscribeMyServingRequests) subs.push(F.subscribeMyServingRequests(x => { setServReqs(x); lsSet('trinityone.serv.reqs.' + np, x); }));
    if (F.subscribeMyReqReplies) subs.push(F.subscribeMyReqReplies(x => { setServReplies(x); lsSet('trinityone.serv.replies.' + np, x); }));
    if (F.subscribeMyRsvps) subs.push(F.subscribeMyRsvps(x => { setMyRsvps(x); lsSet('trinityone.serv.rsvps.' + np, x); }));
    return () => subs.forEach(u => { try { u && u(); } catch {} });
  }, [activeChurch, idTick, connTick]);
  // paint events from cache IMMEDIATELY (not behind the lazy gate), then lazy-subscribe for fresh
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    setChurchEvents(np ? lsGet('trinityone.serv.events.' + np, []) : []);
  }, [activeChurch, churches]);
  useAE(() => {
    if (!lazyReady) return;
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    if (!np || !(window.Fellowship && window.Fellowship.subscribeChurchEvents)) return;
    return window.Fellowship.subscribeChurchEvents(np, x => { setChurchEvents(x); lsSet('trinityone.serv.events.' + np, x); });
  }, [activeChurch, churches, connTick, lazyReady]);
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
    // paint from cache first so the serving cards (rota / services / run sheets / teams) don't flash blank
    // while the network sub catches up — the same cache-first trick the Care cards already use.
    setChurchRotas(lsGet('trinityone.serv.rotas.' + np, []));
    setChurchRosters(lsGet('trinityone.serv.rosters.' + np, []));
    setChurchServices(lsGet('trinityone.serv.services.' + np, []));
    setChurchRunsheets(lsGet('trinityone.serv.runsheets.' + np, []));
    { const cg = lsGet('trinityone.serv.groups.' + np, []); setChurchGroups(cg); setChurchTeams(cg.filter(g => g && g.kind === 'team')); }
    const F = window.Fellowship, subs = [];
    if (F.subscribeChurchRotas) subs.push(F.subscribeChurchRotas(np, x => { setChurchRotas(x); lsSet('trinityone.serv.rotas.' + np, x); }));
    if (F.subscribeChurchRosters) subs.push(F.subscribeChurchRosters(np, x => { setChurchRosters(x); lsSet('trinityone.serv.rosters.' + np, x); }));
    if (F.subscribeChurchServices) subs.push(F.subscribeChurchServices(np, x => { setChurchServices(x); lsSet('trinityone.serv.services.' + np, x); }));
    if (F.subscribeChurchRunsheets) subs.push(F.subscribeChurchRunsheets(np, x => { setChurchRunsheets(x); lsSet('trinityone.serv.runsheets.' + np, x); }));
    if (F.subscribeChurchGroups) subs.push(F.subscribeChurchGroups(np, (gs) => { const g = gs || []; setChurchGroups(g); setChurchTeams(g.filter(x => x && x.kind === 'team')); lsSet('trinityone.serv.groups.' + np, g); }));
    return () => subs.forEach(u => { try { u && u(); } catch {} });
  }, [activeChurch, churches, connTick]);
  // safeguarding: is THIS member a child for the active church, and who's cleared to contact youth.
  // Used to show a child only child-safe groups and to gate DMs (the relay enforces both regardless).
  const [safeguard, setSafeguard] = useA({ minors: [], approved: [], guardians: {}, isMinor: false });
  useAE(() => {
    if (!lazyReady) return;
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    const F = window.Fellowship;
    if (!np || !F || !F.subscribeChurchSafeguard) { setSafeguard({ minors: [], approved: [], guardians: {}, isMinor: false }); return; }
    return F.subscribeChurchSafeguard(np, setSafeguard);
  }, [activeChurch, churches, connTick, lazyReady]);
  // safeguarding: pick up STEWARD-INITIATED guardian links addressed to me (a church-signed, encrypted notice)
  // so a child a steward linked me to appears in my family view even though I never set it up on this device.
  useAE(() => {
    if (!lazyReady) return;
    const F = window.Fellowship;
    if (!F || !F.subscribeGuardianNotices) return;
    return F.subscribeGuardianNotices();
  }, [connTick, lazyReady]);
  // joining: whether the active church gates joining behind steward approval, and whether I'm still pending
  const [joinState, setJoinState] = useA({ approval: false, isAdmitted: true, isPending: false });
  const joinChurchRef = React.useRef(null);
  useAE(() => {
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    const F = window.Fellowship;
    if (!np || !F || !F.subscribeChurchJoin) { setJoinState({ approval: false, isAdmitted: true, isPending: false, loaded: true }); joinChurchRef.current = null; return; }
    // show a neutral loading until the sub resolves — stops the community flashing before a pending join resolves.
    // reset only on an actual church change, not a mere reconnect (connTick), else the tab would blink each reconnect.
    if (joinChurchRef.current !== activeChurch) { setJoinState({ approval: false, isAdmitted: true, isPending: false, loaded: false }); joinChurchRef.current = activeChurch; }
    const unsub = F.subscribeChurchJoin(np, (s) => {
      setJoinState({ ...s, loaded: true });
      // Cache this church's LAST-KNOWN real join state, so an offline reopen can show the TRUTH (pending stays
      // pending, admitted stays admitted) instead of a hardcoded "you're in".
      lsSet('trinityone.joinstate.' + activeChurch, { approval: !!s.approval, isAdmitted: !!s.isAdmitted, isPending: !!s.isPending });
    });
    // OFFLINE FALLBACK: if the relay never answers (offline / hostile network / relay down), don't spin forever —
    // and DON'T pretend the member is admitted (the old fallback hardcoded isAdmitted:true, so a brand-new member
    // on a dead relay was shown the full community as if they'd joined). Restore this church's last-known state if
    // we have one (+ offline flag); otherwise mark it `unknown` so Chat shows an honest "can't reach — still
    // trying", not a fake community. connTick (foreground/online) re-runs this effect; ctx.retryConnection forces it.
    const offlineT = setTimeout(() => setJoinState(js => {
      if (js && js.loaded) return js;
      let cached = null; try { cached = JSON.parse(localStorage.getItem('trinityone.joinstate.' + activeChurch) || 'null'); } catch (e) {}
      return cached ? { ...cached, loaded: true, offline: true } : { approval: false, isAdmitted: false, isPending: false, loaded: true, offline: true, unknown: true };
    }), 6000);
    return () => { clearTimeout(offlineT); if (typeof unsub === 'function') unsub(); };
  }, [activeChurch, churches, connTick]);
  // tell the member the moment they're approved (pending → admitted), within the same church session
  const wasPendingRef = React.useRef(false);
  const approvedToastedRef = React.useRef(false);   // once per church — the join sub flickers isPending on reconnect, which was re-toasting
  useAE(() => {
    // persist the "already welcomed" flag per church — the in-memory ref reset every launch, and the join sub
    // flickers pending→admitted on each reconnect, which re-fired the toast. localStorage = once, ever.
    const key = activeChurch ? 'trinityone.approvedToast.' + activeChurch : null;
    let already = approvedToastedRef.current;
    if (!already && key) { try { already = localStorage.getItem(key) === '1'; } catch (e) {} }
    if (wasPendingRef.current && joinState.approval && joinState.isAdmitted && !joinState.isPending && !already) {
      const nm = (churches.find(c => c.id === activeChurch) || {}).name || 'your church';
      toast('You’re approved — welcome to ' + nm + '!');
      approvedToastedRef.current = true;
      try { if (key) localStorage.setItem(key, '1'); } catch (e) {}
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
    if (!lazyReady) return;
    const F = window.Fellowship; const gids = _geGidsKey ? _geGidsKey.split(',') : [];
    if (!_geNp || !F || !F.subscribeGroupEvents || !gids.length) { setGroupEvents([]); return; }
    return F.subscribeGroupEvents(_geNp, gids, setGroupEvents);
  }, [_geNp, _geGidsKey, connTick, lazyReady]);
  // the wider networks the active church belongs to (+ resolve their names) — members can follow them
  const [churchNetworks, setChurchNetworks] = useA([]);
  const [networkNames, setNetworkNames] = useA({});
  useAE(() => {
    if (!lazyReady) return;
    const np = (churches.find(c => c.id === activeChurch) || {}).npub;
    if (!np || !(window.Fellowship && window.Fellowship.subscribeChurchNetworks)) { setChurchNetworks([]); return; }
    return window.Fellowship.subscribeChurchNetworks(np, setChurchNetworks);
  }, [activeChurch, churches, connTick, lazyReady]);
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
  const notifications = React.useMemo(() => {   // P8: recompute only when a notification source changes, not every render
    const out = [];
    netAnnouncements.forEach(a => out.push({ id: 'net:' + a.id, kind: 'network', group: a._network || 'Network', text: a.text, ts: a.ts, detail: true }));
    broadcastMsgs.forEach(m => out.push({ id: 'bc:' + m.id, kind: 'notice', group: _churchNameFor, text: m.text, ts: m.ts, groupObj: churchGroups.find(g => g.id === m.gid) || null }));
    churchDevos.forEach(d => out.push({ id: 'devo:' + d.id, kind: 'devotional', group: _churchNameFor, text: 'Shared a devotional · ' + (d.title || ''), ts: d.ts, devo: d }));
    if (pinnedSermon && pinnedSermon.sha256) out.push({ id: 'sermon:' + pinnedSermon.id, kind: 'sermon', group: _churchNameFor, text: (String(pinnedSermon.mime || '').startsWith('video') ? 'New video · ' : 'New audio clip · ') + (pinnedSermon.title || ''), ts: pinnedSermon.ts || pinnedSermon.at, sermon: pinnedSermon });
    churchPlans.forEach(p => out.push({ id: 'plan:' + p.id, kind: 'plan', group: _churchNameFor, text: 'Shared a reading plan · ' + (p.title || ''), ts: p.ts, go: 'plans' }));
    churchEvents.forEach(e => out.push({ id: 'evt:' + e.id, kind: 'event', group: _churchNameFor, text: 'New event · ' + (e.title || ''), ts: e.ts, go: 'event', event: e }));
    return out.filter(n => n.ts && (_nowSec - n.ts) < NOTIF_WINDOW).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 40);
  }, [netAnnouncements, broadcastMsgs, churchDevos, pinnedSermon, churchPlans, churchEvents, churchGroups, _churchNameFor]);   // eslint-disable-line
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
    // handle '' = the member has chosen NO name (2026-07-30). It used to fall back to 'Anonymous', which
    // handed them a name they never picked; displayFor() now supplies 'Member' at the display layer.
    return { name, avatar, npub: cur.npub || '', handle: cur.handle || '', nip05: (FS && FS.myProfile && FS.myProfile.nip05) || '', hidden: !!(FS && FS.myProfile && FS.myProfile.hidden), steward: false };
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
    openGroup: (g) => { setOpenServing(false); setPeople(false); setDmInbox(false); setDmPeer(null); setGroup(g); },
    desktop, openGroupId: group && group.id,
    openDM: (peer) => { setGroup(null); setOpenServing(false); setPeople(false); setDmInbox(false); setDmPeer(peer); }, openDMInbox: () => { setGroup(null); setOpenServing(false); setPeople(false); setDmPeer(null); setDmInbox(true); markDmSeen(); }, openPeople: () => { setGroup(null); setOpenServing(false); setDmInbox(false); setDmPeer(null); setPeople(true); },
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
    pinnedSermon,   // the church's featured sermon (or null) → Today card
    playSermon: async (s) => {   // play a self-hosted sermon from a Today card / notification (audio → mini-player, video → player)
      const FS = window.Fellowship;
      const hosts = (s.hosts && s.hosts.length) ? s.hosts : (s.host ? [s.host] : []);
      const cname = (churches.find(c => c.id === activeChurch) || {}).name || 'Your church';
      if (!hosts.length || !s.sha256 || !FS) { toast('This sermon is unavailable'); return; }
      if (String(s.mime || '').startsWith('video')) { setVideo({ id: s.id, title: s.title, _sermon: true, sha256: s.sha256, hosts, mime: s.mime, enc: s.enc }); return; }
      try {
        const np = (churches.find(c => c.id === activeChurch) || {}).npub;
        const dec = s.enc && FS.mediaDecryptor ? await FS.mediaDecryptor(np) : null;
        if (s.enc && !dec) { toast('This encrypted sermon needs the church media key'); return; }
        const src = await FS.fetchSermon({ sha256: s.sha256, hosts, mime: s.mime, enc: s.enc }, { mime: s.mime || 'audio/mpeg', decrypt: dec });
        window.TrinityAudio.play({ id: s.id, title: s.title, subtitle: cname, src, album: cname });
      } catch (e) { toast('Couldn’t load: ' + (e.message || 'error')); }
    },
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
    // optional community PIN
    openCommunitySecurity: () => setCommSec(true),
    commLocked, hasCommunityPin: !!(window.TrinityIdentity && window.TrinityIdentity.hasPin && window.TrinityIdentity.hasPin()),
    openInvite: () => setIdSheet('invite'),
    openShareApp: () => setIdSheet('shareapp'),
    openRelays: () => setIdSheet('relays'),
    openMovePhone: () => setIdSheet('movephone'),
    // U1: restore has a permanent home now. It used to live ONLY inside the first-run wizard, which
    // "Skip setup for now" hides for ever by writing trinityone.onboarded.
    openRestore: () => setIdSheet('restore'),
    openWallet: () => { if (WALLET_ENABLED) setWalletSheet(true); },
    openNewIdentity: () => setNewId(true),
    // library drill-ins
    openModule: (m) => setModule(m),
    openCollection: (c) => setCollection(c),
    openBook: (b) => setBook(b),
    // multi-church
    churches, activeChurch,
    // LOCKED ⇒ NO CHURCH ON SCREEN. With a PIN set and not yet entered, the app is supposed to present as a
    // plain Bible reader. It did not: Today still drew the church's name and its serving cards, so a seized or
    // borrowed phone announced which congregation its owner belongs to before anyone typed anything — verified
    // in a browser, on a cold boot, with the gate up AND after "read the Bible without unlocking".
    // Nulling here is the single point every church-derived screen reads, so the header, the serving cards and
    // the care/safety subscriptions all fall away together rather than one string at a time.
    //
    // What this does NOT do: the phone still STORES the church list and its cached documents in the clear, so
    // anyone examining the device finds the church regardless. This defeats a glance — a checkpoint, someone
    // picking the phone up — and nothing more. The claim that a locked app reveals no church belongs to the
    // encrypt-at-rest work, not to this. AUDIT-2026-07-27.
    church: commLocked ? null : (churches.find(c => c.id === activeChurch) || churches[0] || null),
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
    churchEvents: (() => { const seen = new Set(churchEvents.map(e => e.id).filter(Boolean)); const all = [...churchEvents, ...groupEvents.filter(e => !seen.has(e.id)), ...netEvents]; return window.expandEvents ? window.expandEvents(all, new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10), 180) : all; })(),   // expand recurring church meetings into occurrences
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
      skip: (careId, iso, reason, skipEnc, author) => window.Fellowship.markCareSkip(careId, iso, reason, skipEnc, author),
      clearSkip: (careId, iso) => window.Fellowship.clearCareSkip(careId, iso),
      // "I'm here to help": the list of members who are available, plus this member's own signal actions
      avail: careAvail,
      setAvail: (tags, note) => window.Fellowship.setCareAvail(tags, note).then(r => { if (r) toast('You’re listed — thank you for being ready to help'); return r; }),
      clearAvail: () => window.Fellowship.clearCareAvail().then(r => { if (r) toast('You’re off the list'); return r; }),
    },
    // safeguarding: this member's child status + whether a DM with a given peer is permitted (relay-enforced too)
    safeguard,
    joinState,   // { approval, isAdmitted, isPending, offline, unknown } for the active church
    // RE-ANNOUNCE, not just re-subscribe. "Check again" used to re-run the READ subscription only, so a member
    // whose join announce never landed could tap it for ever and remain invisible — the one action offered on
    // the one screen where they are stuck. Now it re-sends the thing that makes them visible, then re-reads.
    // Is the join announce still sitting in the outbox? The pending screen must not claim "sent" while it is.
    joinQueued: (() => { try { const np = (churches.find(c => c.id === activeChurch) || {}).npub; return !!(np && window.Fellowship.joinQueued && window.Fellowship.joinQueued(np)); } catch (e) { return false; } })(),
    // …and whether we stopped trying. Distinct from joinQueued: "still trying" is patience, "we gave up" is
    // an action the member has to take. Both used to render as "has been sent, sit tight".
    joinFailed: (() => { try { const np = (churches.find(c => c.id === activeChurch) || {}).npub; return !!(np && window.Fellowship.joinFailed && window.Fellowship.joinFailed(np)); } catch (e) { return false; } })(),
    retryConnection: () => { try { const np = (churches.find(c => c.id === activeChurch) || {}).npub; if (np) { if (window.Fellowship.retryJoin) window.Fellowship.retryJoin(np); if (window.Fellowship.announceMembership) window.Fellowship.announceMembership(np); } } catch (e) {} bumpConn(x => x + 1); },
    // steward rule: this church asks members to use a real first + last name (two words)
    requireFullName: !!(((churches.find(c => c.id === activeChurch) || {}).rules) || {}).fullName,
    // AUDIT-2026-07-27. This used to read the church's list of children to decide whether to offer a DM. That
    // list is no longer served to ordinary members — it was a cleartext roll of a congregation's minors, one
    // self-signed publish away from any stranger — so `safeguard.minors` is empty for everyone but stewards.
    //
    // What survives, and why it is enough: the RELAY enforces safeguarding on both read and write
    // (safeguardAllows), so nothing here is load-bearing for safety. This is a UI courtesy, and it still works
    // in the direction that matters most — a CHILD's own app knows it is a child (from its sealed clearance)
    // and knows which adults are cleared, so it never offers a child an unsafe conversation.
    //
    // The direction we deliberately gave up is an ordinary adult locally knowing that a peer is a child: that
    // knowledge IS the list, and no design lets an unapproved adult have it without leaking it. Those DMs are
    // refused by the relay, and the send path reports that honestly rather than failing silently.
    canDMPeer: (peer) => {
      const approved = safeguard.approved || [], guardians = safeguard.guardians || {};
      const me = (window.Fellowship && window.Fellowship.myPubkey) || null;
      const churchPub = (window.Fellowship && window.Fellowship.churchPub) || null;
      if (peer && peer === churchPub) return true;   // anyone may message the church/steward
      // A child's device is never served the church's guardians map (it names every child in the congregation),
      // so `guardians[me]` was permanently empty here and a child could not message their own parent — while
      // the parent, not being a minor, could message them. Asymmetric, and it routed the child to "church
      // leaders" in exactly the case where they most need their family. The church now seals the child's OWN
      // confirmed parents into their clearance doc; myGuardians carries it. UX audit 2026-08-04.
      //
      // It must come from the CHURCH. A guardreq: doc is authored by the claimed parent and proves only
      // authorship, so trusting one would let any adult declare themselves a child's parent.
      const mine = safeguard.myGuardians || [];
      const linked = !!(peer && me && (mine.includes(peer)
        || ((guardians[peer] || []).includes(me)) || ((guardians[me] || []).includes(peer))));
      if (linked) return true;   // v2: a parent may always message their own child (and vice versa)
      if (safeguard.isMinor && !(peer && approved.includes(peer))) return false;   // a child may only DM a cleared adult
      // A steward still holds the list, so keep the old check for them — it costs nothing and keeps the
      // console-side experience unchanged.
      const minors = safeguard.minors || [];
      if (minors.length && peer && minors.includes(peer) && !(me && approved.includes(me))) return false;
      return true;
    },
    // groups this member may post events for (the steward named them a leader)
    myLeaderGroups: churchGroups.filter(g => (g.leaders || []).includes((window.Fellowship && window.Fellowship.myPubkey) || '')),
    publishGroupEvent: (groupId, ev) => { const np = (churches.find(c => c.id === activeChurch) || {}).npub; return window.Fellowship.publishGroupEvent(np, groupId, ev); },
    churchNetworks: churchNetworks.map(n => ({ ...n, name: networkNames[n.networkPub] || '', following: !!churches.find(c => c.id === n.npub) })),
    openServing: (tab, focus) => { setGroup(null); setPeople(false); setDmInbox(false); setDmPeer(null); setServingTab(typeof tab === 'string' ? tab : 'serving'); setCareFocus(focus || null); setOpenServing(true); if (desktop) setTab('chat'); },
    servingTab, careFocus,
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
      [commSec, () => setCommSec(false)],
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
    // A church picks an arbitrary hex, so the readable text colour on it has to be computed, not assumed —
    // white on a pale brand colour is exactly the failure this audit found in dark mode.
    '--on-clay': _readableOn(ca),
    '--clay-ink': `color-mix(in oklab, ${ca} 86%, #000)`,
    '--clay-soft': t.dark ? `color-mix(in oklab, ${ca} 30%, #16120c)` : `color-mix(in oklab, ${ca} 16%, #fff)`,
    '--clay-deep': `color-mix(in oklab, ${ca} 74%, #000)`,
  } : null;
  const rootStyle = {
    '--clay': ap.c, '--clay-ink': ap.i, '--clay-soft': ap.s, '--clay-deep': ap.d, '--on-clay': ap.on || '#fff',
    ...(brand || {}),
    '--read-scale': t.readScale,
  };

  const screens = {
    today: <TodayScreen ctx={ctx} />,
    // A missing Bible now costs you the READER, not the whole app. Until 2026-07-27 the entire product was
    // wrapped in `Bible.loaded ? … : <EmptyState/>`, so a module download that failed or had not finished took
    // Today, Community, groups, Care and the emergency safety check with it. The empty state belongs here.
    read: !Bible.loaded ? <EmptyState loading={Bible.loading} error={Bible._error} onBrowse={() => setStore(true)} />
      : readView === 'plans' ? <PlansScreen ctx={ctx} /> : <ReadScreen ctx={ctx} />,
    chat: <ChatScreen ctx={ctx} />,
    library: <LibraryScreen ctx={ctx} />,
  };

  // per-church feature toggles: the active church can hide whole tabs (steward → Congregation features).
  // Unset = on. Today always shows. Maps: read→Bible, chat→Community, library→Library.
  const cf = (ctx.church && ctx.church.features) || {};
  // community PIN: while locked, the Community tab is hidden — the app is just a Bible reader until the PIN is entered
  const tabOn = { today: true, read: cf.read !== false, chat: cf.community !== false && !commLocked, library: cf.library !== false };
  const visibleTabs = TABS.filter(t => tabOn[t.id]);
  // if the steward turned off the tab you're on (or it's PIN-locked), fall back to Today. When the reason
  // is the lock, surface the unlock sheet so a deep-link into Community still leads somewhere.
  useAE(() => { if (!tabOn[tab]) { if (tab === 'chat' && commLocked) setCommSec(true); setTab('today'); } }, [tabOn.read, tabOn.chat, tabOn.library, tab, commLocked]);

  return (
    <div ref={wrapRef} className={cx('trinity', t.dark && 'dark')} style={{ ...rootStyle, ...(fullscreen ? { position: 'fixed', inset: 0 } : { transformOrigin: 'center center' }) }}>
      <PhoneFrame bare={fullscreen}>
        {/* The app no longer waits for a Bible to exist. This was `Bible.loaded ? <the entire app> :
            <EmptyState/>`, so a failed or not-yet-finished module download cost the member Today, Community,
            their groups, Care AND the emergency safety check — everything — and left a reader empty state as
            the whole product. For a congregation that uses this to ask for help, losing the app because a
            3 MB download failed is disproportionate. The Read tab still shows EmptyState on its own (see
            screens-read), which is where a missing Bible actually belongs. AUDIT-2026-07-27. */}
        {(
          <React.Fragment>
            <UpdateBanner ctx={ctx} />
            {desktop ? (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', overflow: 'hidden' }}>
                <DesktopNav active={tab} onChange={(t) => { setOpenServing(false); setTab(t); }} tabs={visibleTabs} unread={{ chat: chatUnread || dmUnread }} onProfile={commLocked ? undefined : () => ctx.openProfile()} profileAv={identity.avatar} profileName={identity.name} />
                {tab === 'chat' && ctx.church && ctx.church.npub ? (
                  <div style={{ flex: 1, display: 'flex', minWidth: 0, background: 'var(--paper)' }}>
                    <div style={{ width: 372, flexShrink: 0, position: 'relative', borderRight: '1px solid var(--line)' }}>{screens.chat}</div>
                    <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
                      {group ? <ChatRoom group={group} open={true} onClose={() => setGroup(null)} ctx={ctx} docked />
                       : openServing ? <ServingScreen open={true} docked onClose={() => setOpenServing(false)} ctx={ctx} />
                       : people ? <PeopleScreen open={true} docked onClose={() => setPeople(false)} ctx={ctx} />
                       : dmPeer ? <DMThread peer={dmPeer} open={true} docked onClose={() => setDmPeer(null)} ctx={ctx} />
                       : dmInbox ? <DMInbox open={true} docked onClose={() => setDmInbox(false)} ctx={ctx} />
                       : (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--ink-3)', textAlign: 'center', padding: 24 }}>
                          <Icon name="chat" size={46} stroke={1.4} color="var(--ink-3)" />
                          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--ink-2)' }}>Pick a conversation</div>
                          <div style={{ fontSize: 13.5, maxWidth: 260, lineHeight: 1.5 }}>Choose a group, room, Serving, People or messages on the left to open it here.</div>
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
                {/* app-wide safety dock: on any tab but Today (Today shows the full banner with a note field) */}
                {tab !== 'today' && <SafetyDock ctx={ctx} onOpenToday={() => setTab('today')} />}
                <TabBar active={tab} onChange={setTab} tabs={visibleTabs} unread={{ chat: chatUnread || dmUnread }} onProfile={commLocked ? undefined : () => ctx.openProfile()} profileAv={identity.avatar} profileName={identity.name} />
              </React.Fragment>
            )}

            {/* overlays */}
            <ShareCard verse={share} open={!!share} onClose={() => setShare(null)} ctx={ctx} />
            <VerseShareSheet payload={shareSheet} open={!!shareSheet} onClose={() => setShareSheet(null)} ctx={ctx} />
            <DevotionalView open={devo} onClose={() => setDevo(false)} ctx={ctx} />
            <PlanDetail plan={plan} open={!!plan} onClose={() => setPlan(null)} ctx={ctx} />
            <ChurchDevoView devo={openDevo} open={!!openDevo} onClose={() => setOpenDevo(null)} ctx={ctx} />
            <ServingScreen open={openServing && !desktop} onClose={() => setOpenServing(false)} ctx={ctx} />
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
            <CommunitySecuritySheet open={commSec} onClose={() => setCommSec(false)} ctx={ctx} />
            <InviteSheet open={idSheet === 'invite'} onClose={() => setIdSheet(null)} identity={identity} ctx={ctx} />
            <ShareAppSheet open={idSheet === 'shareapp'} onClose={() => setIdSheet(null)} ctx={ctx} />
            <RelaysSheet open={idSheet === 'relays'} onClose={() => setIdSheet(null)} ctx={ctx} />
            <MovePhoneSheet open={idSheet === 'movephone'} onClose={() => setIdSheet(null)} ctx={ctx} />
            <NewIdentitySheet open={newId} identity={identity} onClose={() => setNewId(false)} onCreate={saveIdentity} ctx={ctx} />
            {WALLET_ENABLED && window.WalletSheet ? <WalletSheet open={walletSheet} onClose={() => setWalletSheet(false)} ctx={ctx} /> : null}
            <ChatRoom group={group} open={!!group && !desktop} onClose={() => setGroup(null)} ctx={ctx} />
            <DMInbox open={dmInbox && !desktop} onClose={() => setDmInbox(false)} ctx={ctx} />
            <DMThread peer={dmPeer} open={!!dmPeer && !desktop} onClose={() => setDmPeer(null)} ctx={ctx} />
            <PeopleScreen open={people && !desktop} onClose={() => setPeople(false)} ctx={ctx} />
            <ChurchSwitcher open={churchSwitcher} onClose={() => setChurchSwitcher(false)} ctx={ctx} initialMode={churchSwitcherMode}
              churches={churches} activeId={activeChurch}
              onPick={(id) => { ctx.setActiveChurch(id); setChurchSwitcher(false); }}
              onFollowed={() => { setChurchSwitcher(false); toast('Now following — loading church…'); }} />

            <Toast msg={toastMsg} />
            {/* A2: the member app's only "that didn't work" surface. Self-contained — it listens for
                trinity-feature-failed itself, so nothing else here has to know about it. */}
            <FeatureTrouble />
          </React.Fragment>
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
                <button onClick={() => { const C = window.Capacitor; if (C && C.Plugins && C.Plugins.App) C.Plugins.App.exitApp(); else setConfirmExit(false); }} style={{ flex: 1, padding: 13, borderRadius: 14, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Close</button>
              </div>
            </div>
          </div>
        ) : null}

        {showSplash ? <Splash onDone={() => setShowSplash(false)} ready={bootReady} /> : null}
        {/* Front-door PIN gate: over the whole app on open when a PIN is set and this session isn't unlocked.
            Not during the splash or first-run onboarding (there's no PIN yet then). */}
        {!showSplash && !showOnboarding && commLocked && !gateEscaped
          ? <PinUnlockGate onUnlocked={() => { setCommLocked(false); setGateEscaped(false); }} onReadBible={() => setGateEscaped(true)} /> : null}
        {/* "Read the Bible without unlocking" leaves the app running with NO identity — which is the state
            that looked completely normal and made the missing gate invisible for months. Say so, permanently,
            and keep the way back one tap away. An empty church and a broken one must never look the same. */}
        {!showSplash && !showOnboarding && commLocked && gateEscaped ? (
          <div onClick={() => setGateEscaped(false)} role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setGateEscaped(false); }}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 88, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '10px 14px', background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))',
              borderTop: '1px solid color-mix(in oklab, var(--clay) 35%, transparent)', cursor: 'pointer' }}>
            <Icon name="lock" size={14} color="var(--clay)" />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Your account is locked — Bible only.</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--clay)' }}>Unlock</span>
          </div>
        ) : null}
        {!showSplash && showOnboarding ? <IdentityOnboarding open={true} identity={identity}
          onSave={(p) => { saveIdentity(p); try { lsSet('trinityone.onboarded', true); } catch (e) {} setShowOnboarding(false); const pf = pendingFollowRef.current; pendingFollowRef.current = null; if (pf) followChurch(pf); else promptFollowChurch(); }}
          onSkip={() => { try { lsSet('trinityone.onboarded', true); } catch (e) {} setShowOnboarding(false); const pf = pendingFollowRef.current; pendingFollowRef.current = null; if (pf) followChurch(pf); else promptFollowChurch(); }} /> : null}
        {/* U1: the SAME restore flow, opened from settings rather than only from first-run. Deliberately its
            OWN handlers: this member is already set up, so it must not re-write trinityone.onboarded or
            re-prompt them to follow a church — it just closes when they are done. */}
        {idSheet === 'restore' ? <IdentityOnboarding open={true} identity={identity} initialRestore
          onSave={(p) => { saveIdentity(p); setIdSheet(null); }}
          onSkip={() => setIdSheet(null)} /> : null}
      </PhoneFrame>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
