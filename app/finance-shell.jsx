// finance-shell.jsx — the last slot of StewardRoot in the TrinityOne Finance app (finance.html only).
//
// T1Finance plan §3.3–3.4, as amended by §11. finance.html is the steward console's own code with ONE screen behind
// its gates: StewardRoot keeps every gate it has (unlock, welcome, forced PIN, removal, waiting for approval, idle
// lock, the removal banner) and, in this app only, renders <FinanceShell/> where the console would render
// <StewDashboard/>. Everything on this screen is an existing component: DashFinance (app/stew-finance.jsx),
// PublishErrorBanner, IdentitySwitcher, StewCapBlocked, DashBecomeStewardPanel, PinModal and StewVersion
// (app/stew-dashboard.jsx). Nothing here grants anything: the relay decides what a helper key may do
// (stewardCan, scripts/gateway.mjs). This file only decides what to SHOW.

// WHICH SCREEN. Pure, so a test can run it (CLAUDE.md rules 1 & 3).
//   'unlinked' — this console is not acting for a church (Steward.isDelegated() is false). M1: the books open ONLY for
//                a delegated identity, so a church key (owner) or a bare helper key shows "not linked" instead. On the
//                WEB a device that also holds a church key has it loaded here — this refuses to act with it, it does
//                not keep it out.
//   'blocked'  — delegated, but the church has not given this key Finance: the existing "isn't yours" panel.
//   'off'      — delegated with Finance, but the church has turned its Finance feature off.
//   'books'    — the church books.
// `rosterGenuine` (audit F3): the church's steward roster has been GENUINELY read for the church and epoch this console
// is on (Steward.listIsFresh on the roster stream's list). Until then myStewardCaps() can be null for a reason that is
// not "unscoped" — an empty end-of-stored-events delivers a list before any roster has been read — so no capability
// verdict is drawn from it: the books screen shows (DashFinance has its own waiting state; writes are the relay's to
// refuse), never the "isn't yours" panel and never the other-permissions line.
function financeShellView(S, church, rosterGenuine) {
  const delegated = !!(S && typeof S.isDelegated === 'function' && S.isDelegated());
  if (!delegated) return 'unlinked';
  if (rosterGenuine && !stewCapState('finance').allowed) return 'blocked';
  if (church && church.features && church.features.finance === false) return 'off';
  return 'books';
}
// Does this key hold anything beyond Finance in the church it is acting for? An unscoped delegate (no list recorded,
// myStewardCaps() null) is a full steward at the relay, so yes. Said in one quiet line — never "use the Steward app":
// on Android that is a different key (plan §3.8, audit F7).
function financeHasOtherCaps(S) {
  const caps = (S && typeof S.myStewardCaps === 'function') ? S.myStewardCaps() : null;
  if (!Array.isArray(caps)) return true;
  return caps.some(c => c !== 'finance');
}
window.financeShellView = financeShellView;
window.financeHasOtherCaps = financeHasOtherCaps;

// THE SMALL SETTINGS SHEET: this device's PIN, its own 12 words (only in the narrow case below), how to stop, the version.
//
// WHAT IS NOT HERE, ON PURPOSE (T1Finance audit F1, 2026-11-17). On the WEB finance.html shares localStorage with
// steward.html, so an owner who opens /finance.html has the CHURCH key loaded here; on Android "Restore my helper words"
// will take a church's phrase too. So nothing on this sheet may destroy or expose a key it cannot prove is only a helper
// key:
//   • NO "Remove from this device" — Steward.removeKey() deletes the device's own key, which on the web is the
//     church key the Steward console uses. To stop helping, the church removes you; to clear a phone, uninstall.
//   • NO "Remove lock" — it would leave that key in plaintext at rest. Setting or changing the PIN stays.
//   • "Show my 12 words" only while acting for a church (Steward.isDelegated()) AND with no sign on this device that
//     its own key runs a church (Steward.ownKeyBlank() — a remembered own church name or a self-registration is such a
//     sign). That signal is one-directional (a church restored on a new device can look blank), so the words are
//     described honestly rather than promised to be "not the church's key".
//
// NO "Copy" FOR THE WORDS IN THE DESKTOP PROGRAM (T1Finance desktop plan §8 MED): a desktop clipboard is kept in history
// (Windows Win+V) and can sync to the cloud, so the words are SHOWN there, to be written down, never copied. The desktop
// program is a packaged origin that is not the Capacitor APK — read off location by window.Steward.packagedOrigin, never
// a flag a page could set; it fails closed (no Copy) if that export is ever missing. The web page and the APK keep Copy.
function financeIsDesktopProgram() {
  const S = window.Steward;
  const packaged = !S || typeof S.packagedOrigin !== 'function' || !!S.packagedOrigin();
  const capacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  return packaged && !capacitor;
}
function FinanceSettings({ onClose }) {
  const S = window.Steward;
  const mayCopyWords = !financeIsDesktopProgram();
  const [hasPin, setHasPin] = React.useState(() => !!(S.hasPinLock && S.hasPinLock()));
  const [pinAction, setPinAction] = React.useState(null);
  const [phrase, setPhrase] = React.useState('');
  const [revealed, setRevealed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const dlgRef = useStewDialog(() => { if (!pinAction) onClose(); });
  const mayShowWords = !!(S.isDelegated && S.isDelegated()) && !!(S.ownKeyBlank && S.ownKeyBlank());
  const reveal = () => { if (!mayShowWords) return; try { setPhrase(S.exportMnemonic() || ''); } catch (e) {} setRevealed(true); };
  const row = { padding: '13px 14px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 12 };
  const h = { fontWeight: 700, fontSize: 14, margin: '0 0 4px', fontFamily: 'inherit' };
  const note = { fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.45, marginBottom: 10 };
  return (
    <div onClick={() => { if (!pinAction) onClose(); }} style={{ position: 'fixed', overflowY: 'auto', inset: 0, zIndex: 90, display: 'flex', alignItems: 'safe center', justifyContent: 'center', padding: 20, background: 'color-mix(in oklab, var(--ink) 32%, transparent)' }}>
      {pinAction ? <PinModal action={pinAction} onClose={(ok) => { setPinAction(null); if (ok) setHasPin(true); }} /> : null}
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Finance settings" tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', background: 'var(--surface)', borderRadius: 20, border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ flex: 1, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19 }}>Settings</div>
          <button onClick={onClose} aria-label="Close settings" style={{ minWidth: 44, minHeight: 44, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-2)' }}><Icon name="x" size={18} color="currentColor" /></button>
        </div>
        <div style={row}>
          <h3 style={h}>Lock</h3>
          <div style={note}>{hasPin ? 'Locked with a PIN — the key on this device is encrypted and locks itself after 10 minutes idle.' : 'Not locked. Set a PIN so a lost or shared device cannot open the books.'}</div>
          {hasPin ? (
            <button onClick={() => setPinAction('change')} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="key" size={15} color="currentColor" /> Change PIN</button>
          ) : (
            <button onClick={() => setPinAction('set')} className="sk-btn sk-btn--clay" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="lock" size={15} color="var(--on-clay)" /> Lock with a PIN</button>
          )}
        </div>
        {mayShowWords ? (
          <div style={row} data-finance-words="1">
            <h3 style={h}>This device’s 12 words</h3>
            <div style={note}>With these words you can restore this app on a new device (“Restore my helper words”). If this device also runs a church, these are that church’s key: never share them with anyone.</div>
            {!revealed ? (
              <button onClick={reveal} className="sk-btn sk-btn--ghost" style={{ padding: '9px 13px', fontSize: 13 }}><Icon name="key" size={15} color="currentColor" /> Show my 12 words</button>
            ) : (
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 14, lineHeight: 1.7, wordSpacing: 3, color: 'var(--ink)' }}>{phrase || 'No words are available for this key.'}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {phrase && mayCopyWords ? <button onClick={() => { copyText(phrase); setCopied(true); setTimeout(() => setCopied(false), 1400); }} className="sk-btn sk-btn--clay" style={{ padding: '7px 11px', fontSize: 12 }}><Icon name={copied ? 'check' : 'receipt'} size={14} color="var(--on-clay)" /> {copied ? 'Copied' : 'Copy'}</button> : null}
                  <button onClick={() => { setRevealed(false); setPhrase(''); }} className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 12 }}>Hide</button>
                </div>
              </div>
            )}
          </div>
        ) : null}
        <div style={row}>
          <h3 style={h}>Stopping</h3>
          <div style={note}>To stop helping, ask the church to remove you. To clear this device, uninstall the app.</div>
        </div>
        <StewVersion name="TrinityOne Finance" />
      </div>
    </div>
  );
}

// "NOT LINKED TO A CHURCH YET" — what a church key, or a helper key with no church open, sees instead of any books.
// A key that already helps a church gets that church to open; anyone else gets the existing request panel.
function FinanceUnlinked() {
  const S = window.Steward;
  const ids = ((S.identities && S.identities()) || []).filter(i => i && i.kind === 'steward');
  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ padding: '6px 4px 16px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, margin: '0 0 6px' }}>Not linked to a church yet</h2>
        <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55 }}>The books open here once a church’s owner has approved you as a helper with <b>Finance</b>. Ask them for a helper invite, enter it below, and they approve you from their own device.</div>
      </div>
      {ids.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {ids.map(i => (
            <button key={i.pub} onClick={() => { try { S.setActiveIdentity(i.pub); } catch (e) {} }} className="sk-btn sk-btn--clay" style={{ padding: '12px 14px', fontSize: 14, justifyContent: 'center' }}><Icon name="shield" size={15} color="var(--on-clay)" /> Open {i.name || 'the church you help'}</button>
          ))}
        </div>
      ) : null}
      <DashBecomeStewardPanel />
    </div>
  );
}

function FinanceShell() {
  const S = window.Steward;
  const church = window.useStewardChurch();
  // THE ROSTER, READ HERE BECAUSE NOTHING ELSE IN THIS APP READS IT. Steward.myStewardCaps() — and so stewCapState and
  // financeHasOtherCaps — answers from the church's steward roster, which only a subscription to it loads. In the
  // steward console StewDashboard holds that subscription; without this one, a helper's capabilities would stay
  // "unknown" (null, which reads as unscoped) for the whole session: no "isn't yours" panel for a helper without
  // Finance, and the other-permissions line for everyone. Until it lands the books still render (DashFinance shows
  // its own waiting state, and its writes are the relay's to refuse), so an offline cold start keeps its cached paint.
  const _roster = window.useStewardStewards ? window.useStewardStewards() : [];
  // GENUINE, not merely delivered (audit F3): stewardStreamLoaded flipped on the empty end-of-stored-events delivery
  // too, while myStewardCaps() was still null. Steward.listIsFresh is the engine's own "this list came from a settled
  // read of this church, this epoch" — the stamp subscribeStewards puts on the list it hands over.
  const rosterGenuine = !!(S.listIsFresh && S.listIsFresh(_roster));
  const [settings, setSettings] = React.useState(false);
  const [finTab, setFinTab] = React.useState('transactions');
  const [finMoreOpen, setFinMoreOpen] = React.useState(false);
  const view = financeShellView(S, church, rosterGenuine);
  const churchName = view === 'unlinked' ? 'Not linked yet' : (church.name || 'Your church');
  const initials = (church.name ? church.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2) : 'TO').toUpperCase();
  const hasPin = !!(S.hasPinLock && S.hasPinLock());
  const tap = { minWidth: 44, minHeight: 44, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'none', borderRadius: 11, cursor: 'pointer', color: 'var(--ink)', padding: 0 };
  return (
    <div data-finance-shell="1" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--paper)', fontFamily: 'var(--font-ui)' }}>
      {settings ? <FinanceSettings onClose={() => setSettings(false)} /> : null}
      <div style={{ flexShrink: 0, background: 'var(--surface)', borderBottom: '1px solid var(--line)', padding: 'calc(6px + env(safe-area-inset-top, 0px)) calc(8px + env(safe-area-inset-right, 0px)) 6px calc(8px + env(safe-area-inset-left, 0px))', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ ...tap, cursor: 'default' }}><Halo size={24} color="var(--ink)" spark="var(--clay)" /></div>
        <div style={{ flex: 1, minWidth: 0, position: 'relative', height: 44 }}>
          <h1 style={{ position: 'absolute', left: 0, right: 0, top: 3, margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15.5, lineHeight: '20px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none' }}>Finance</h1>
          <IdentitySwitcher compact noNameEdit church={church} churchName={churchName} initials={initials} onEditName={() => {}} />
        </div>
        {hasPin ? <button onClick={() => { try { S.lock('manual'); } catch (e) {} }} aria-label="Lock" title="Lock now" style={tap}><Icon name="lock" size={20} color="currentColor" /></button> : null}
        <button onClick={() => setSettings(true)} aria-label="Settings" title="Settings" style={tap}><Icon name="sliders" size={20} color="currentColor" /></button>
      </div>
      {/* A REFUSED WRITE MUST BE SEEN (plan §3.4, audit F2). DashFinance reports every refusal through
          steward-write-blocked / steward-publish-error, and this banner is the only thing that listens. */}
      <PublishErrorBanner />
      <main className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px calc(12px + env(safe-area-inset-right, 0px)) calc(24px + env(safe-area-inset-bottom, 0px)) calc(12px + env(safe-area-inset-left, 0px))', background: 'var(--paper)' }}>
        {view === 'books' && rosterGenuine && financeHasOtherCaps(S) ? (
          <div data-finance-other-caps="1" style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 10px', lineHeight: 1.45 }}>This key has other permissions in this church too. This app shows only the books.</div>
        ) : null}
        {view === 'books' ? <DashFinance finTab={finTab} setFinTab={setFinTab} finMoreOpen={finMoreOpen} setFinMoreOpen={setFinMoreOpen} />
          : view === 'blocked' ? <StewCapBlocked cap="finance" />
          : view === 'off' ? <div style={{ padding: 28, maxWidth: 520, color: 'var(--ink-2)', lineHeight: 1.5 }}><div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Finance is turned off</div>This church has turned its Finance section off. Its owner can turn it back on from their own device.</div>
          : <FinanceUnlinked />}
      </main>
      {view === 'books' ? <>
        <button onClick={() => { const ev = new CustomEvent('finance-record'); window.dispatchEvent(ev); }} aria-label="Record a transaction" style={{ position: 'fixed', right: 'calc(16px + env(safe-area-inset-right, 0px))', bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))', width: 56, height: 56, borderRadius: 16, border: 'none', background: 'var(--clay)', color: 'var(--on-clay, #fff)', cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}><Icon name="plus" size={24} color="currentColor" /></button>
        <nav style={{ flexShrink: 0, background: 'var(--surface)', borderTop: '1px solid var(--line)', padding: '6px calc(8px + env(safe-area-inset-right, 0px)) calc(6px + env(safe-area-inset-bottom, 0px)) calc(8px + env(safe-area-inset-left, 0px))' }}>
          <FinTabStrip tab={finTab} setTab={setFinTab} moreOpen={finMoreOpen} setMoreOpen={setFinMoreOpen} />
        </nav>
      </> : null}
    </div>
  );
}
window.FinanceShell = FinanceShell;
