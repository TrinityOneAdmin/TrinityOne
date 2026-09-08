// stew-help.jsx — in-app Help for the STEWARD CONSOLE (steward.html).
//
// Until 2026-09-07 the console shipped no help at all: index.html loads help-data / help-illustrations /
// screens-help / screens-help-main, steward.html loaded none of them, and the only guidance a steward could
// reach was two links out to STEWARD-GUIDE.md on GitHub. This is the smallest useful version: article copy
// from the one shared source (app/help-data.jsx — so a sentence fixed there is fixed everywhere), the same
// block renderer, text-size stepper and read-aloud (app/screens-help.jsx), shown in a console dialog.
// The articles it asks for are now mostly the console's OWN — see the note over STEW_HELP_IDS below.
//
// Deliberately NOT loaded: app/screens-help-main.jsx. Its BackupWalkthrough reads window.TrinityIdentity,
// which the console does not have.
//
// The file MUST be named stew-*.jsx: scripts/sync-web.sh strips app/stew-*.js out of the member web build,
// and scripts/build-steward-apk.sh derives the steward APK's file list from steward.html, so the name is
// what makes packaging work without a list to maintain.
//
// Globals this file takes from elsewhere (all loaded before it in steward.html):
//   React, Icon (icons.jsx), useStewDialog (stew-modal.jsx),
//   window.HelpData (help-data.jsx), window.HelpIllo (help-illustrations.jsx),
//   window.HelpBlock / window.useReadAloud / window.TextSizeStepper / window.articleToSpeech (screens-help.jsx).
// Top-level names DECLARED here — kept unique across the console's single global scope on purpose (a
// duplicate top-level name in classic scripts blanks the whole app): STEW_HELP_IDS, stewHelpArticles,
// StewardHelp, StewHelpButton.

// The console-relevant articles, in reading order, by id. An id that is not in HelpData is skipped rather
// than rendered blank — and scripts/steward-help.test.mjs asserts every one of these resolves.
//
// SIX OF THESE ARE THE CONSOLE'S OWN (2026-09-08). The first version of this file listed the MEMBER articles
// verbatim — 'words', 'restore', 'steward', 'scams', 'family-safety', 'giving-records' — under a line
// promising "the same words your members can read in their app". Sharing the words is worth having and two
// still do it: 'console' and 'how-it-works' are the same subject whoever is reading. The other six are
// addressed to a member and a steward reads them as being about the CHURCH, which is a different object with
// different consequences. 'words' is the clearest: a member who loses theirs loses one account; a steward who
// loses the church's has no church to go back to, and no way to move it onto a new key. 'restore' also named
// a member Help button that does not exist in this console, and 'steward' ("Help from a steward") is written
// to the person being helped — who, here, is the reader's member, not the reader.
const STEW_HELP_IDS = ['console', 'console-giving-records', 'console-family-safety', 'console-steward', 'console-words', 'console-restore', 'console-scams', 'how-it-works'];

function stewHelpArticles() {
  const all = (window.HelpData && Array.isArray(window.HelpData.articles)) ? window.HelpData.articles : [];
  return STEW_HELP_IDS.map(id => all.find(a => a && a.id === id)).filter(a => a && Array.isArray(a.blocks));
}

// The dialog. CkModal's shape (stew-dashboard.jsx): dimmed backdrop closes on click, the PANEL carries
// role=dialog + the useStewDialog ref (Escape closes the topmost dialog, Tab is trapped, focus returns to
// the trigger). Two views inside: the list of guides, and one guide open.
function StewardHelp({ onClose }) {
  const dlgRef = useStewDialog(onClose);
  const [openId, setOpenId] = React.useState(null);
  const [scale, setScale] = React.useState(1);
  const ra = window.useReadAloud ? window.useReadAloud() : { supported: false, speaking: false, speak() {}, stop() {} };
  const articles = stewHelpArticles();
  const article = openId ? articles.find(a => a.id === openId) : null;
  // Hardware back on the phone closes the dialog (Capacitor App + popstate) — the InvitePosterModal pattern,
  // so a steward in the APK is never trapped behind a guide with no way out but the X.
  React.useEffect(() => {
    try { history.pushState({ stewhelp: 1 }, ''); } catch (e) {}
    const onPop = () => onClose();
    window.addEventListener('popstate', onPop);
    let sub;
    try { const P = window.Capacitor && window.Capacitor.Plugins; if (P && P.App && P.App.addListener) sub = P.App.addListener('backButton', () => onClose()); } catch (e) {}
    return () => { window.removeEventListener('popstate', onPop); try { sub && sub.remove && sub.remove(); } catch (e) {} };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const back = () => { ra.stop(); setOpenId(null); };
  const Illo = window.HelpIllo;
  const HelpBlock = window.HelpBlock;
  const Stepper = window.TextSizeStepper;
  const fs = scale;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, background: 'color-mix(in oklab, var(--ink) 34%, transparent)', backdropFilter: 'blur(3px)', animation: 'lumenFade .18s ease both' }}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Help" tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: 640, maxWidth: '100%', maxHeight: '92%', display: 'flex', flexDirection: 'column', borderRadius: 22, background: 'var(--paper)', border: '1px solid var(--line)', boxShadow: '0 24px 70px rgba(0,0,0,.28)', overflow: 'hidden', animation: 'lumenScale .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px 6px' }}>
          {article ? (
            <button onClick={back} aria-label="Back to all guides" title="Back to all guides" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, minWidth: 40, minHeight: 40, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}><Icon name="chevL" size={16} /></button>
          ) : null}
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, margin: 0, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{article ? article.title : 'Help'}</h2>
          {Stepper ? <Stepper scale={scale} setScale={setScale} /> : null}
          <button onClick={onClose} aria-label="Close help" title="Close" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, minWidth: 40, minHeight: 40, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}><Icon name="x" size={14} /></button>
        </div>
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 18px 22px' }}>
          {article ? (
            <div>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14 }}>
                {Illo ? <Illo name={article.illo} size={72} /> : null}
                <p style={{ fontFamily: 'var(--font-read)', fontSize: 17 * fs, lineHeight: 1.5, color: 'var(--ink-2)', margin: 0 }}>{article.summary}</p>
              </div>
              {ra.supported ? (
                <button onClick={() => ra.speaking ? ra.stop() : ra.speak(window.articleToSpeech ? window.articleToSpeech(article) : article.title)}
                  aria-pressed={ra.speaking} title={ra.speaking ? 'Stop reading aloud' : 'Read this guide aloud'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 16, padding: '8px 13px', borderRadius: 999, border: '1px solid var(--line)', background: ra.speaking ? 'var(--clay)' : 'var(--surface)', color: ra.speaking ? 'var(--on-clay)' : 'var(--ink-2)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  <Icon name={ra.speaking ? 'x' : 'play'} size={15} color="currentColor" /> {ra.speaking ? 'Stop' : 'Read aloud'}</button>
              ) : null}
              {article.blocks.map((b, i) => <HelpBlock key={i} b={b} fs={fs} />)}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontFamily: 'var(--font-read)', fontSize: 16 * fs, lineHeight: 1.5, color: 'var(--ink-2)', margin: '0 0 8px' }}>Short guides to running your church on TrinityOne. Written for the person at this desk: the church key in your hands is not the same thing as a member’s own account, and the two go wrong in very different ways.</p>
              {articles.map(a => (
                <button key={a.id} onClick={() => setOpenId(a.id)} data-help-id={a.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '12px 14px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
                  {Illo ? <Illo name={a.illo} size={44} /> : null}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 * fs, color: 'var(--ink)' }}>{a.title}</div>
                    <div style={{ fontSize: 13 * fs, color: 'var(--ink-3)', lineHeight: 1.4, marginTop: 2 }}>{a.summary}{a.minutes ? ' · ' + a.minutes + ' min' : ''}</div>
                  </div>
                  <Icon name="chevR" size={16} color="var(--ink-3)" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// The ONE entry point: a Help button that sits under the identity switcher in both console layouts
// (desktop sidebar and phone header) and mounts the dialog above.
function StewHelpButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <React.Fragment>
      <button onClick={() => setOpen(true)} aria-label="Help" title="Guides to running your church on TrinityOne" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', cursor: 'pointer', textAlign: 'left', fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--font-ui)', marginBottom: 14 }}>
        <Icon name="book" size={16} color="var(--ink-3)" /> Help
      </button>
      {open ? <StewardHelp onClose={() => setOpen(false)} /> : null}
    </React.Fragment>
  );
}
window.StewardHelp = StewardHelp;
window.StewHelpButton = StewHelpButton;
