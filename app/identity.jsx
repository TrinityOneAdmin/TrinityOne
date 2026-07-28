// identity.jsx — onboarding, profile sheet, member card
const { useState: useId, useEffect: useIdE } = React;

// ════════ First-run identity moment ════════
function IdentityOnboarding({ open, identity, onSave, onSkip }) {
  const D = window.TrinityData;
  const [step, setStep] = useId(0);   // 0 name, 1 back up the 12 words, 2 confirm a couple
  const [name, setName] = useId('');
  const [av, setAv] = useId({ kind: 'symbol', color: '#5E8C6A', symbol: 'olive' });
  const [words, setWords] = useId([]);
  const [ack, setAck] = useId(false);
  const [copied, setCopied] = useId(false);
  const [checkIdx, setCheckIdx] = useId([]);   // the three word positions we quiz
  const [answers, setAnswers] = useId(['', '', '']);
  const [checkErr, setCheckErr] = useId('');
  // PIN (step 3): optional but strongly urged — encrypts the identity at rest so a lost/borrowed/taken phone
  // is just a locked box. TrinityIdentity.setPin does the crypto; here we collect + confirm it.
  const [pin, setPinVal] = useId('');
  const [pin2, setPin2] = useId('');
  const [pinErr, setPinErr] = useId('');
  const [pinBusy, setPinBusy] = useId(false);
  // RESTORE ON A NEW PHONE. The steward console has had this since the start (steward-root.jsx:357 — a 12-word
  // textarea and a "Restore church" button on its welcome screen); the MEMBER app never did. The pane existed
  // in NostrSheet but only mounted from `?identity=restore`, a URL the APK's WebView can never carry, so a
  // member who changed phones had no way in at all — while the wizard told them the 12 words were the only way
  // back. AUDIT 2026-07-26. Same shape as the console's: paste the phrase, validate, re-derive, then ask the
  // relay what this identity already is.
  const [restoring, setRestoring] = useId(false);
  const [rPhrase, setRPhrase] = useId('');
  const [rBusy, setRBusy] = useId('');
  const [rErr, setRErr] = useId('');
  const [rNoChurch, setRNoChurch] = useId(false);   // restored the account, but found no church to rejoin
  // WELCOME FORK. Onboarding used to open straight into "choose your name" — i.e. it ASSUMED every launch was
  // a new person, and offered "I already have an account — restore it" as a faint link under the Continue
  // button. A member on a new phone therefore started creating a SECOND identity by default, and the one
  // action they actually wanted was the least visible thing on screen. Ask instead of assuming.
  const [intro, setIntro] = useId(true);
  // How they are coming back: pick a route, then type words or run a phone-to-phone transfer.
  const [rMode, setRMode] = useId('choose');       // choose | words | xfer
  const [xfer, setXfer] = useId(null);             // { qr } this phone is showing (a throwaway PUBLIC key)
  const [xferStage, setXferStage] = useId('show'); // show (our QR) | scan (their reply) | check (compare codes) | busy
  const [xferSeen, setXferSeen] = useId(null);     // { sas, npub } decrypted from their reply, NOT yet adopted
  // Did they get back in by TYPING their 12 words? A ref, not state: finishRestore is awaited from inside
  // the same handler that sets it, so a state update would not be visible to it.
  const rTypedWords = React.useRef(false);
  // This phone's own public name-tag, shown to a steward when the 12 words are gone. The secure store can
  // answer empty for a moment right after boot, so poll rather than render an empty QR.
  const [myNpub, setMyNpub] = useId('');
  useIdE(() => {
    if (rMode !== 'lost') return;
    let stop = false, tries = 0;
    const grab = () => {
      if (stop) return;
      const np = (window.TrinityIdentity && window.TrinityIdentity.current && window.TrinityIdentity.current.npub) || '';
      if (np) { setMyNpub(np); return; }
      if (tries++ < 20) setTimeout(grab, 300);
    };
    grab();
    return () => { stop = true; };
  }, [rMode]);
  // "My church runs its own relay" — type its name, adopt that relay, then look again. This is the only route
  // back for a member with no old phone and nobody nearby to show them a QR code.
  const [cname, setCname] = useId('');
  const tryChurchName = async () => {
    const n = (cname || '').trim();
    if (!n) return;
    setRBusy('Looking up ' + n + '…'); setRErr('');
    let hit = null;
    try { hit = await window.Fellowship.resolveRelayName(n); } catch (e) { hit = null; }
    if (!hit) { setRBusy(''); setRErr('No church relay by that name. Check the spelling with your church — or use their invite link.'); return; }
    try { window.Fellowship.addRelay(hit.url); } catch (e) {}
    setRBusy('Found it — looking for your church…');
    // Do NOT clear rNoChurch here. This runs FROM the no-church screen, so clearing it mid-search dropped the
    // member back to whichever screen they arrived from (the 12-word textarea) for the length of the lookup and
    // then forward again — a flash that reads as the app losing their place. finishRestore reloads on success
    // and leaves rNoChurch set on failure, so the screen simply stays put with its progress text. AUDIT #17.
    await finishRestore();   // same tail as every other way back; leaves us on the no-church screen if it still finds nothing
  };
  const startTransfer = () => {
    setRErr(''); rTypedWords.current = false;
    try { setXfer(window.TrinityIdentity.beginTransfer()); setXferStage('show'); setRMode('xfer'); }
    catch (e) { setRErr('This phone couldn’t start a transfer. Use your 12 words instead.'); }
  };
  const leaveTransfer = (mode) => {
    try { window.TrinityIdentity.endTransfer(); } catch (e) {}   // drop the throwaway key, don't just hide the screen
    setXfer(null); setXferStage('show'); setXferSeen(null); setRErr(''); setRMode(mode || 'choose');
  };
  // Scanning the old phone's reply DECRYPTS but does not adopt — it hands back the check code and the account
  // it opened, and we stop there. The previous version became that account the instant a payload decrypted, so
  // the check code the member was told to compare arrived after the only decision it could have affected.
  // AUDIT-2026-07-26 S5.
  const onTransferScan = async (text) => {
    setXferStage('busy'); setRErr('');
    let seen = null;
    try { seen = await window.TrinityIdentity.acceptTransfer(text); }
    catch (e) { setXferStage('scan'); setRErr((e && e.message) || 'That code didn’t work.'); return; }
    setXferSeen(seen); setXferStage('check');
  };
  // Saying "they're different" must leave a WORKING screen. My first version called endTransfer() — which nulls
  // the throwaway private key — and then re-showed `xfer`, the QR for that now-dead key. The member did exactly
  // what the screen told them, and acceptTransfer threw "Start the transfer on this phone first." on every
  // retry, forever. That is the one path that has to work, because it is the path someone takes when they think
  // they are being attacked. Mint a fresh key instead of re-displaying a spent one. AUDIT-2026-07-27.
  const rejectTransfer = () => {
    setXferSeen(null);
    startTransfer();   // endTransfer() + a brand-new throwaway key, and back to the 'show' stage
    setRErr('Stopped — nothing was moved. This is a fresh code: try again with your own old phone in front of you, and if the codes still differ, tell a steward.');
  };
  const confirmTransfer = async () => {
    setXferStage('busy'); setRErr('');
    try { await window.TrinityIdentity.confirmTransfer(); }
    // Same trap on the failure path: confirmTransfer nulls both the held words and the throwaway key, so
    // dropping back to 'scan' left the camera live over a key that could no longer decrypt anything.
    catch (e) { setXferSeen(null); startTransfer(); setRErr((e && e.message) || 'Couldn’t finish — here is a fresh code, please try again.'); return; }
    setRBusy('Bringing your account across…');
    // finishRestore swallows its own failures, but if it ever threw, `busy` would be terminal and Back was the
    // only control on the screen. Belt and braces: a transfer that got the account across but could not finish
    // the church lookup says so, on a screen the member can leave.
    try { await finishRestore(); }
    catch (e) { setXferStage('scan'); setRBusy(''); setRErr('Your account came across, but we couldn’t finish looking for your church. Go back and use your church’s invite link or QR code.'); }
  };
  const doRestore = async () => {
    const words = (rPhrase || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (words.split(' ').length < 12) { setRErr('Enter all 12 words, separated by spaces.'); return; }
    setRBusy('Checking your words…'); setRErr(''); rTypedWords.current = true;
    try {
      await window.TrinityIdentity.importMnemonic(words);   // validates the checksum; throws on a bad phrase
    } catch (e) { setRBusy(''); setRErr((e && e.message) || 'That phrase isn’t valid — check the words and their order.'); return; }
    await finishRestore();
  };
  // Shared tail of EVERY way back in — typed words, a transfer from the old phone, or (later) a steward
  // re-seat. By this point the key is already in place; all that remains is to find out what it belongs to.
  const finishRestore = async () => {
    // Ask the relay what this identity already IS.
    //
    // This lookup used to be deliberately skipped here, on the theory that a seconds-old key on an unsettled
    // connection could not read its own (gated) documents — and three attempts to fix it by retrying and by
    // deferring to the running app all failed, which seemed to confirm it. The real cause was neither: the
    // constant naming the membership document was declared inside another function, so every church document
    // the relay delivered threw a swallowed ReferenceError and was discarded. Fixed 2026-07-26 and confirmed
    // on a real phone against the live relay. The query works from right here, in under a second — so ask now,
    // and let the member watch it happen, instead of dropping them into an empty app that fills in later.
    setRBusy('Finding your church…');
    let found = { churches: [], name: '' };
    try {
      const F = window.Fellowship;
      // Two passes: the first can land before the connection has authenticated, and authentication is what
      // unlocks the member's own documents. Cheap, and it costs nothing when the first pass already worked.
      found = F && F.recoverIdentityRetry ? await F.recoverIdentityRetry(2, 1500) : await F.recoverIdentity(7000);
    } catch (e) { found = { churches: [], name: '' }; }
    // saveIdentity IS NOT IN SCOPE HERE. It is a local inside a component in app.jsx; this file only receives
    // { open, identity, onSave, onSkip }. So this line threw ReferenceError on every restore that recovered a
    // NAME — and the empty catch below swallowed it, taking the church list and the onboarded flag with it.
    // The member ended up with a working identity, no churches, and no record of having onboarded, so the app
    // bounced straight back to "Welcome to TrinityOne" seconds after finding their church.
    // It only ever bit when a name came back, which is why it survived: earlier restores had no name to find,
    // so the line never executed. A child account is the first identity that always has one waiting.
    // Reported from a child's phone 2026-07-28. Same shape as the bug that opened this whole audit — a throw
    // inside a handler, swallowed, leaving a feature that silently does nothing.
    // Each step now stands alone: one failure must not take the other two with it.
    try {
      if (found.name) { const FS = window.Fellowship; if (FS && FS.setProfile && FS.ready) FS.ready.then(() => FS.setProfile({ name: found.name })).catch(() => {}); }
    } catch (e) {}
    try {
      if (found.churches.length) {
        const list = found.churches.map(cp => { const np = window.Fellowship.toNpub ? window.Fellowship.toNpub(cp) : cp; return { id: np, npub: np, name: '', initials: '', sub: 'Followed' }; });
        localStorage.setItem('trinityone.followedChurches', JSON.stringify(list));
        localStorage.setItem('trinityone.activeChurch', JSON.stringify(list[0].id));
      }
    } catch (e) {}
    try {
      localStorage.setItem('trinityone.onboarded', 'true');
      // Only the TYPED-WORDS route proves the member has their recovery phrase. This used to be written for
      // every route, including the transfer — whose whole selling point is "nothing to type" — so a member
      // landed on a new phone with the backup nudge permanently dismissed having never seen a recovery phrase
      // in their life. The one warning that matters, silenced for exactly the people who need it.
      // AUDIT-2026-07-26 #6.
      if (rTypedWords.current) localStorage.setItem('trinityone.backedup.' + ((window.TrinityIdentity.current || {}).npub || ''), '1');
    } catch (e) {}
    if (!found.churches.length) {
      // NOTHING FOUND — and this is a legitimate outcome, not only a failure. A church that runs its OWN relay
      // is invisible to a fresh install, which only knows the shared ones; so is a member whose join predates
      // the membership document. Leave restorePending set so a later boot retries automatically, but do NOT
      // pretend it worked: say so plainly and hand them the one action that always works — their church's QR
      // code or invite link. Dropping them into an app with no church and no explanation is what made this
      // look broken even when the identity had come back perfectly.
      try { localStorage.setItem('trinityone.restorePending', '1'); } catch (e) {}
      // Leave whatever route we came in on. The no-church screen is a terminal state shared by ALL of them, and
      // it is rendered ABOVE the route branches (see below) precisely so this cannot be forgotten again: the
      // first version left rMode === 'xfer', so the transfer screen kept winning and the member sat on
      // "Bringing your account across…" forever with a disabled Back button and no progress text. Force-quitting
      // was the only way out — and relaunching DID work, but nothing on screen said so. AUDIT-2026-07-26
      // CRITICAL 1. This is exactly the case the no-church screen was built for (a church on its own relay).
      setXferStage('show');
      setRBusy(''); setRNoChurch(found.name || true);
      return;
    }
    try { localStorage.removeItem('trinityone.restorePending'); } catch (e) {}
    // Reload rather than thread all of this through React state: the church list, the active church and the
    // identity are all read at mount, and a restore is a deliberate, one-off act.
    setRBusy('Found your church — reopening…');
    setTimeout(() => { try { location.reload(); } catch (e) {} }, 700);
  };
  // Restored, but no church came back — offer the QR / invite-link route rather than a dead end.
  //
  // `onboarded` MUST be written here. It used to be set only inside finishRestore, and the "I've lost my 12
  // words" route never calls that — so tapping "Done — take me to my church" reloaded into a device that still
  // looked brand new: the welcome wizard rendered over everything and asked "Have you used TrinityOne before?"
  // seconds after their steward had reconnected them. Answering "I'm new here" walked them through creating the
  // account they already had. The openFollow one-shot was consumed underneath it too, so the scanner they asked
  // for never appeared either. AUDIT-2026-07-26 CRITICAL 2.
  const goFollowChurch = () => {
    try { localStorage.setItem('trinityone.onboarded', 'true'); } catch (e) {}
    try { localStorage.setItem('trinityone.openFollow', '1'); } catch (e) {}
    try { location.reload(); } catch (e) {}
  };
  useIdE(() => { if (open) { setIntro(true); setRMode('choose'); setXfer(null); setXferStage('show'); setXferSeen(null); setStep(0); setName(''); setAv({ kind: 'symbol', color: '#5E8C6A', symbol: 'olive' }); setWords([]); setAck(false); setCheckIdx([]); setAnswers(['', '', '']); setCheckErr(''); setPinVal(''); setPin2(''); setPinErr(''); setPinBusy(false); } }, [open]);
  // fetch the member's own 12 words when we reach the back-up step. The secure store can answer empty for a
  // moment right after boot, so retry until we get a full phrase rather than getting stuck on "Preparing…".
  useIdE(() => {
    if (step !== 1 || words.length) return;
    let cancelled = false, tries = 0;
    const grab = () => {
      if (cancelled || !window.TrinityIdentity || !window.TrinityIdentity.exportMnemonic) return;
      window.TrinityIdentity.exportMnemonic().then(m => {
        if (cancelled) return;
        const w = String(m || '').trim().split(/\s+/).filter(Boolean);
        if (w.length >= 12) setWords(w);
        else if (tries++ < 12) setTimeout(grab, 300);
      }).catch(() => { if (!cancelled && tries++ < 12) setTimeout(grab, 300); });
    };
    grab();
    return () => { cancelled = true; };
  }, [step]);
  // pick two distinct positions to confirm when we reach the check step
  // Re-draw the three positions EVERY time the check is entered. They used to be drawn once, and step 2 offers
  // "← Show my words again" — so you could read the same three, come back and type them without ever having
  // written anything down. Re-reading now costs you a different three words, which is the point of the check.
  useIdE(() => { if (step === 2 && words.length >= 6) { const n = words.length; const idx = []; let g = 0; while (idx.length < 3 && g++ < 200) { const r = Math.floor(Math.random() * n); if (!idx.includes(r)) idx.push(r); } setCheckIdx(idx.sort((x, y) => x - y)); setAnswers(['', '', '']); setCheckErr(''); } }, [step, words]);
  if (!open) return null;
  // ── Welcome: new person, or someone coming back? Asked BEFORE the create-an-account wizard, because the
  // wrong answer here is expensive: a returning member who is walked into making a new identity ends up as a
  // stranger to their own church, with a second entry on the roster and no way back to the first.
  if (intro && !restoring) return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 71, background: 'var(--paper)', display: 'flex', flexDirection: 'column', animation: 'trinityFade .3s ease both' }}>
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', alignItems: 'center', padding: '32px 22px 18px' }}>
        <div style={{ maxWidth: 440, margin: '0 auto', width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><div style={{ width: 62, height: 62, borderRadius: 18, background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--clay)' }}><Icon name="hand" size={28} /></div></div>
          <h1 style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, margin: '0 0 10px', letterSpacing: '-.4px' }}>Welcome to TrinityOne</h1>
          <p style={{ textAlign: 'center', fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 auto 22px', maxWidth: 380, fontFamily: 'var(--font-read)', textWrap: 'pretty' }}>
            Have you used TrinityOne before, on this phone or another one?
          </p>
          {/* Deliberately EQUAL weight. Colouring one of these as the primary action is a nudge, and both wrong
              answers cost something: a returning member who misses this ends up as a stranger to their own
              church with a duplicate entry on the roster, while at a church rollout almost everyone is new.
              So ask plainly and say what each choice leads to, rather than steering. */}
          <button onClick={() => setIntro(false)} style={{ width: '100%', textAlign: 'left', padding: '15px 17px', borderRadius: 16, border: '1px solid var(--line)', cursor: 'pointer', background: 'var(--surface)', marginBottom: 10, fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>I’m new here</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.45 }}>Set up an account and follow your church</div>
          </button>
          <button onClick={() => { setRestoring(true); setRErr(''); }} style={{ width: '100%', textAlign: 'left', padding: '15px 17px', borderRadius: 16, border: '1px solid var(--line)', cursor: 'pointer', background: 'var(--surface)', fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>I’ve used it before</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.45 }}>Bring my account back — new phone, or reinstalled</div>
          </button>
        </div>
      </div>
      <div style={{ flexShrink: 0, padding: '10px 22px 26px', background: 'var(--paper)' }}>
        <div style={{ maxWidth: 440, margin: '0 auto' }}>
          <button onClick={onSkip} style={{ width: '100%', padding: 12, borderRadius: 14, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--font-ui)' }}>Skip setup for now</button>
        </div>
      </div>
    </div>
  );
  // TERMINAL STATE, CHECKED FIRST. "Your account is back, we couldn't find your church" is the end of
  // EVERY route in here — typed words, a phone-to-phone transfer, a relay-name lookup — so it is tested
  // ahead of the route branches rather than after them. It used to sit below `xfer`, which still matched
  // because finishRestore never left transfer mode, so the transfer route could never reach this screen
  // and dead-ended on "Bringing your account across…" instead. AUDIT-2026-07-26 CRITICAL 1.
  // Account back, church not found. A real and recoverable outcome — a church on its OWN relay is invisible to
  // a fresh install — so name what happened and give the action that always works, rather than a silent empty app.
  if (restoring && rNoChurch) return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 71, background: 'var(--paper)', display: 'flex', flexDirection: 'column', animation: 'trinityFade .3s ease both' }}>
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '64px 22px 18px' }}>
        <div style={{ maxWidth: 440, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><div style={{ width: 62, height: 62, borderRadius: 18, background: 'color-mix(in oklab, var(--sage) 15%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sage)' }}><Icon name="check" size={28} /></div></div>
          <h1 style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 25, fontWeight: 700, margin: '0 0 10px', letterSpacing: '-.4px' }}>
            {typeof rNoChurch === 'string' ? 'Welcome back, ' + rNoChurch : 'Your account is back'}
          </h1>
          <p style={{ textAlign: 'center', fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 auto 18px', maxWidth: 380, fontFamily: 'var(--font-read)', textWrap: 'pretty' }}>
            Your account is restored — but we couldn’t find your church from here. That’s normal if your church
            runs its own relay: this phone has no way to know it exists yet.
          </p>
          <p style={{ textAlign: 'center', fontSize: 14.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 auto 18px', maxWidth: 380, fontFamily: 'var(--font-read)', textWrap: 'pretty' }}>
            You only need to do this once — your church will recognise you straight away, because you’re the
            same person you were before.
          </p>
          {/* The name route, offered HERE because this is the moment it matters: no old phone, nobody nearby
              with a QR code. If the church told its members a name, this alone brings them all the way back. */}
          <div style={{ border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surface)', padding: '13px 15px' }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Know your church’s name?</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.45, marginBottom: 9 }}>If your church gave you a name for their relay, type it here.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={cname} onChange={e => { setCname(e.target.value); setRErr(''); }} onKeyDown={e => { if (e.key === 'Enter') tryChurchName(); }}
                autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="e.g. trinityla"
                style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--paper)', padding: '10px 12px', fontSize: 15, fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--ink)', outline: 'none' }} />
              <button onClick={tryChurchName} disabled={!cname.trim() || !!rBusy} style={{ padding: '10px 16px', borderRadius: 12, border: 'none', cursor: (!cname.trim() || rBusy) ? 'not-allowed' : 'pointer', background: 'var(--clay)', color: 'var(--on-clay)', fontFamily: 'var(--font-ui)', fontSize: 14.5, fontWeight: 700, opacity: (!cname.trim() || rBusy) ? .5 : 1 }}>Find</button>
            </div>
            {rErr ? <div style={{ fontSize: 13, color: 'var(--clay-ink)', fontWeight: 700, marginTop: 9, lineHeight: 1.45 }}>{rErr}</div> : null}
            {rBusy ? <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 600, marginTop: 9 }}>{rBusy}</div> : null}
          </div>
        </div>
      </div>
      <div style={{ flexShrink: 0, padding: '10px 22px 26px', borderTop: '1px solid var(--line)', background: 'var(--paper)' }}>
        <div style={{ maxWidth: 440, margin: '0 auto' }}>
          <button onClick={goFollowChurch} style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: 'pointer', background: 'var(--clay)', color: 'var(--on-clay)', fontFamily: 'var(--font-ui)', fontSize: 16, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Icon name="qr" size={18} color="var(--on-clay)" /> Scan my church’s code
          </button>
          <button onClick={() => { try { location.reload(); } catch (e) {} }} style={{ width: '100%', padding: 12, borderRadius: 14, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700, color: 'var(--ink-3)', marginTop: 4 }}>I’ll do this later</button>
        </div>
      </div>
    </div>
  );
  // ── Coming back: which route? Typing 12 words is the fallback, not the default — most phone changes happen
  // with the old phone still in hand, and a transfer needs nothing written down.
  if (restoring && rMode === 'choose') return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 71, background: 'var(--paper)', display: 'flex', flexDirection: 'column', animation: 'trinityFade .3s ease both' }}>
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', alignItems: 'center', padding: '32px 22px 18px' }}>
        <div style={{ maxWidth: 440, margin: '0 auto', width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><div style={{ width: 62, height: 62, borderRadius: 18, background: 'color-mix(in oklab, var(--sage) 15%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sage)' }}><Icon name="key" size={28} /></div></div>
          <h1 style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 25, fontWeight: 700, margin: '0 0 10px', letterSpacing: '-.4px' }}>Bring your account back</h1>
          <p style={{ textAlign: 'center', fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 auto 22px', maxWidth: 380, fontFamily: 'var(--font-read)', textWrap: 'pretty' }}>
            However you do this, you come back as the same person — your church will know you.
          </p>
          <button onClick={startTransfer} style={{ width: '100%', textAlign: 'left', padding: '15px 17px', borderRadius: 16, border: '1px solid var(--line)', cursor: 'pointer', background: 'var(--surface)', marginBottom: 10, fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>I still have my old phone</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.45 }}>Move it across by scanning — nothing to type</div>
          </button>
          <button onClick={() => setRMode('words')} style={{ width: '100%', textAlign: 'left', padding: '15px 17px', borderRadius: 16, border: '1px solid var(--line)', cursor: 'pointer', background: 'var(--surface)', marginBottom: 10, fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>I have my 12 words</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.45 }}>Type the phrase you wrote down</div>
          </button>
          {/* The common case, and the one that used to be a dead end: no old phone, no words written down.
              A church can vouch for its own — so this is a real way back, not an apology. */}
          <button onClick={() => setRMode('lost')} style={{ width: '100%', textAlign: 'left', padding: '15px 17px', borderRadius: 16, border: '1px solid var(--line)', cursor: 'pointer', background: 'var(--surface)', fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>I’ve lost my 12 words</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.45 }}>Ask your church to put you back — they know you</div>
          </button>
          {rErr ? <div style={{ fontSize: 13, color: 'var(--clay-ink)', fontWeight: 700, marginTop: 12, textAlign: 'center' }}>{rErr}</div> : null}
        </div>
      </div>
      <div style={{ flexShrink: 0, padding: '10px 22px 26px', background: 'var(--paper)' }}>
        <div style={{ maxWidth: 440, margin: '0 auto' }}>
          <button onClick={() => { setRestoring(false); setRPhrase(''); setRErr(''); setRBusy(''); }} style={{ width: '100%', padding: 12, borderRadius: 14, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700, color: 'var(--ink-3)' }}>Back</button>
        </div>
      </div>
    </div>
  );
  // ── Lost the words entirely. Nothing can bring the old key back — so instead the church vouches that this
  // NEW key is the same person, and moves their name and place onto it. Be plain about the limits: pretending
  // old private messages will reappear would be a lie the member discovers later, at a bad moment.
  if (restoring && rMode === 'lost') return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 71, background: 'var(--paper)', display: 'flex', flexDirection: 'column', animation: 'trinityFade .3s ease both' }}>
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '48px 22px 18px' }}>
        <div style={{ maxWidth: 440, margin: '0 auto' }}>
          <h1 style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-.4px' }}>Ask your church</h1>
          <p style={{ textAlign: 'center', fontSize: 14.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 auto 16px', maxWidth: 380, fontFamily: 'var(--font-read)', textWrap: 'pretty' }}>
            Show this to a steward. They’ll put you back in your place on this phone, under your own name.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <div style={{ width: 230, height: 230, background: '#fff', borderRadius: 18, padding: 12, boxShadow: 'var(--shadow)', boxSizing: 'border-box' }}
              dangerouslySetInnerHTML={{ __html: (window.TrinityIdentity && window.TrinityIdentity.qrSVG && myNpub) ? window.TrinityIdentity.qrSVG('trinityone-reseat:' + myNpub) : '' }} />
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.5, color: 'var(--ink-3)', wordBreak: 'break-all', textAlign: 'center', margin: '0 0 6px' }}>{myNpub}</div>
          <button onClick={() => { try { if (navigator.clipboard) navigator.clipboard.writeText('trinityone-reseat:' + myNpub); } catch (e) {} setRBusy('Copied — send it to your steward'); setTimeout(() => setRBusy(''), 2500); }}
            style={{ width: '100%', padding: 11, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 14 }}>Copy it instead</button>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-3)', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px', background: 'var(--surface)' }}>
            {/* Say exactly what comes back and no more. "your groups" used to be printed flat, and it was not
                true of invite-only groups: those carry a list of keys on the group itself, and a re-seat does
                not rewrite it — so a member was promised their small group and arrived without it, finding out
                days later. The steward is told the same thing at the same moment, on their side of this.
                AUDIT-2026-07-26 CRITICAL 3. */}
            <b style={{ color: 'var(--ink-2)' }}>What comes back:</b> your name, your church, and your church’s
            usual groups.<br />
            <b style={{ color: 'var(--ink-2)' }}>What needs a hand:</b> any invite-only group — ask your steward
            to add you back to those.<br />
            <b style={{ color: 'var(--ink-2)' }}>What doesn’t:</b> your old private messages and anything sealed to you. Those were locked with the key you lost, and nobody — not your church, not us — can open them. That is why they were private.
          </div>
          {rBusy ? <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 600, marginTop: 10, textAlign: 'center' }}>{rBusy}</div> : null}
        </div>
      </div>
      <div style={{ flexShrink: 0, padding: '10px 22px 26px', borderTop: '1px solid var(--line)', background: 'var(--paper)' }}>
        <div style={{ maxWidth: 440, margin: '0 auto' }}>
          <button onClick={goFollowChurch} style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: 'pointer', background: 'var(--clay)', color: 'var(--on-clay)', fontFamily: 'var(--font-ui)', fontSize: 16, fontWeight: 700 }}>Done — take me to my church</button>
          <button onClick={() => { setRErr(''); setRBusy(''); setRMode('choose'); }} style={{ width: '100%', padding: 12, borderRadius: 14, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700, color: 'var(--ink-3)', marginTop: 4 }}>Back</button>
        </div>
      </div>
    </div>
  );
  // ── Phone to phone. THIS phone shows a throwaway public key; the old phone encrypts the words to it. The
  // secret is never on screen, so the QR codes are safe to hold up in a room full of people.
  if (restoring && rMode === 'xfer') return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 71, background: 'var(--paper)', display: 'flex', flexDirection: 'column', animation: 'trinityFade .3s ease both' }}>
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '48px 22px 18px' }}>
        <div style={{ maxWidth: 440, margin: '0 auto' }}>
          <h1 style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-.4px' }}>
            {xferStage === 'check' ? 'One last check' : xferStage === 'scan' ? 'Now scan your old phone' : 'Show this to your old phone'}
          </h1>
          {xferStage === 'show' ? (<React.Fragment>
            {/* The path here has to be exactly right — it is the instruction the NEW phone gives for the OLD
                one, so if it names a screen that doesn't exist the transfer never starts. There is no
                "Settings" in the member app (AUDIT-2026-07-26 #9); it is the You sheet, reached from the
                picture in the bottom bar. */}
            <p style={{ textAlign: 'center', fontSize: 14.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 auto 16px', maxWidth: 380, fontFamily: 'var(--font-read)', textWrap: 'pretty' }}>
              On your old phone, tap <b>your picture</b> at the bottom of the screen, then <b>Move to a new phone</b>. Point it at this code.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <div style={{ width: 240, height: 240, background: '#fff', borderRadius: 18, padding: 12, boxShadow: 'var(--shadow)', boxSizing: 'border-box' }}
                dangerouslySetInnerHTML={{ __html: (xfer && window.TrinityIdentity.qrSVG) ? window.TrinityIdentity.qrSVG(xfer.qr) : '' }} />
            </div>
            {/* No check code here. There is nothing to check yet: nothing has been exchanged, so any code shown
                at this point could only be a function of what is already on screen — which is what made the old
                one forgeable (AUDIT-2026-07-26 S5). The check comes after both phones have swapped codes. */}
            <button onClick={() => { try { if (navigator.clipboard && xfer) navigator.clipboard.writeText(xfer.qr); } catch (e) {} setRBusy('Copied — paste it into your old phone'); setTimeout(() => setRBusy(''), 2500); }}
              disabled={!xfer}
              style={{ width: '100%', padding: 11, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--surface)', cursor: xfer ? 'pointer' : 'not-allowed', fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700, color: 'var(--ink)', opacity: xfer ? 1 : .5 }}>Can’t scan? Copy the code instead</button>
          </React.Fragment>) : xferStage === 'scan' ? (<React.Fragment>
            <p style={{ textAlign: 'center', fontSize: 14.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 auto 16px', maxWidth: 380, fontFamily: 'var(--font-read)', textWrap: 'pretty' }}>
              Your old phone is now showing a second code. Point this phone at it.
            </p>
            <QRScanner onResult={onTransferScan} onCancel={() => setXferStage('show')} prompt="Point at your old phone’s code"
              onManual={onTransferScan} manualPrompt="Paste the code from your old phone" />
          </React.Fragment>) : xferStage === 'check' ? (<React.Fragment>
            {/* THE moment of the whole flow. Both phones can now show a code derived from everything that
                actually passed between them, so a matching pair means the account came from the phone in the
                member's other hand and nowhere else. Nothing is adopted until they say so. */}
            <p style={{ textAlign: 'center', fontSize: 14.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 auto 14px', maxWidth: 380, fontFamily: 'var(--font-read)', textWrap: 'pretty' }}>
              Your old phone is showing a check code. Does it match this one?
            </p>
            <div style={{ textAlign: 'center', border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surface)', padding: '16px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '.5px' }}>CHECK CODE</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 27, fontWeight: 700, letterSpacing: '3px', color: 'var(--ink)', margin: '4px 0 2px' }}>{(xferSeen || {}).sas || ''}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)', wordBreak: 'break-all', marginTop: 8 }}>{((xferSeen || {}).npub || '').slice(0, 20)}…</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>the account you’re about to become</div>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-3)', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px', background: 'var(--surface)' }}>
              If the two codes are different, tap <b>They’re different</b>. Nothing has been moved yet, and it
              means the code you scanned came from another phone — not yours.
            </div>
          </React.Fragment>) : (
            <p style={{ textAlign: 'center', fontSize: 15, color: 'var(--ink-2)', fontWeight: 600, margin: '20px 0' }}>Bringing your account across…</p>
          )}
          {rErr ? <div style={{ fontSize: 13, color: 'var(--clay-ink)', fontWeight: 700, marginTop: 10, textAlign: 'center' }}>{rErr}</div> : null}
          {rBusy ? <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 600, marginTop: 10, textAlign: 'center' }}>{rBusy}</div> : null}
        </div>
      </div>
      <div style={{ flexShrink: 0, padding: '10px 22px 26px', borderTop: '1px solid var(--line)', background: 'var(--paper)' }}>
        <div style={{ maxWidth: 440, margin: '0 auto' }}>
          {xferStage === 'show' ? (
            <button onClick={() => { setRErr(''); setXferStage('scan'); }} style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: 'pointer', background: 'var(--clay)', color: 'var(--on-clay)', fontFamily: 'var(--font-ui)', fontSize: 16, fontWeight: 700 }}>My old phone has scanned it</button>
          ) : xferStage === 'check' ? (<React.Fragment>
            <button onClick={confirmTransfer} style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: 'pointer', background: 'var(--clay)', color: 'var(--on-clay)', fontFamily: 'var(--font-ui)', fontSize: 16, fontWeight: 700 }}>They match — bring my account across</button>
            <button onClick={rejectTransfer} style={{ width: '100%', padding: 13, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginTop: 8 }}>They’re different — stop</button>
          </React.Fragment>) : null}
          {/* Never disabled. This was the ONLY control on the screen and it was greyed out for the whole of
              `busy` — so any stall in there (a slow relay, a hung secure store) was a permanent trap with no
              text on screen to explain it. Leaving mid-transfer costs nothing: the throwaway key is dropped and
              the member can start again. AUDIT-2026-07-26 CRITICAL 1. */}
          <button onClick={() => leaveTransfer('choose')} style={{ width: '100%', padding: 12, borderRadius: 14, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700, color: 'var(--ink-3)', marginTop: 4 }}>{xferStage === 'busy' ? 'Cancel' : 'Back'}</button>
        </div>
      </div>
    </div>
  );
  // The restore pane replaces the whole wizard while it is open: a member restoring an existing account should
  // not also be walked through creating one. Mirrors the console's welcome-screen restore.
  if (restoring) return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 71, background: 'var(--paper)', display: 'flex', flexDirection: 'column', animation: 'trinityFade .3s ease both' }}>
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '64px 22px 18px' }}>
        <div style={{ maxWidth: 440, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><div style={{ width: 62, height: 62, borderRadius: 18, background: 'color-mix(in oklab, var(--sage) 15%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sage)' }}><Icon name="key" size={28} /></div></div>
          <h1 style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 25, fontWeight: 700, margin: '0 0 10px', letterSpacing: '-.4px' }}>Restore your account</h1>
          <p style={{ textAlign: 'center', fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 auto 18px', maxWidth: 380, fontFamily: 'var(--font-read)', textWrap: 'pretty' }}>
            Type the 12 words you wrote down. They bring back the same account, so your church knows you’re you.
          </p>
          <textarea value={rPhrase} onChange={e => { setRPhrase(e.target.value); setRErr(''); }} rows={4} autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder="word one  word two  word three …"
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)', padding: '13px 15px', fontSize: 14.5, fontFamily: 'var(--mono)', color: 'var(--ink)', outline: 'none', resize: 'vertical', lineHeight: 1.7 }} />
          {rErr ? <div style={{ fontSize: 13, color: 'var(--clay-ink)', fontWeight: 700, marginTop: 10 }}>{rErr}</div> : null}
          {rBusy ? <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 600, marginTop: 10 }}>{rBusy}</div> : null}
          <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5, margin: '14px 0 0' }}>
            Your notes, journal and highlights are kept only on your old phone — restore your backup file in Settings afterwards to bring those across too.
          </p>
        </div>
      </div>
      <div style={{ flexShrink: 0, padding: '10px 22px 26px', borderTop: '1px solid var(--line)', background: 'var(--paper)' }}>
        <div style={{ maxWidth: 440, margin: '0 auto' }}>
          <button onClick={doRestore} disabled={!!rBusy || !rPhrase.trim()} style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: (rBusy || !rPhrase.trim()) ? 'not-allowed' : 'pointer', background: 'var(--clay)', color: 'var(--on-clay)', fontFamily: 'var(--font-ui)', fontSize: 16, fontWeight: 700, opacity: (rBusy || !rPhrase.trim()) ? .5 : 1 }}>{rBusy || 'Restore my account'}</button>
          <button onClick={() => { setRPhrase(''); setRErr(''); setRBusy(''); setRMode('choose'); }} disabled={!!rBusy} style={{ width: '100%', padding: 12, borderRadius: 14, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700, color: 'var(--ink-3)', marginTop: 4 }}>Back</button>
        </div>
      </div>
    </div>
  );
  const finish = () => onSave({ name: name.trim(), avatar: av });
  const canConfirm = checkIdx.length === 3 && checkIdx.every((_, i) => (answers[i] || '').trim());
  // Record that this member really did back up their recovery phrase. Nothing wrote this flag, so the Today
  // nudge ("Secure your account — set up recovery so you never lose access") kept firing at exactly the people
  // who HAD written the words down and passed the check — training them to dismiss the one warning that
  // matters, so it can no longer reach the people who skipped. Only set on the confirmed path: skipping past
  // the check must still nag. (Same key + shape as RecoverySheet.markSaved, which is the other writer.)
  const markBackedUp = () => { try { const np = window.TrinityIdentity && window.TrinityIdentity.current && window.TrinityIdentity.current.npub; if (np) localStorage.setItem('trinityone.backedup.' + np, '1'); } catch (e) {} };
  const confirmWords = () => { const ok = checkIdx.length === 3 && checkIdx.every((idx, i) => (answers[i] || '').trim().toLowerCase() === (words[idx] || '').toLowerCase()); if (ok) { markBackedUp(); setStep(3); } else setCheckErr('That’s not quite right — check your written copy and try again.'); };
  const savePin = async () => {
    if (pin.length < 6) { setPinErr('Use at least 6 digits.'); return; }
    if (pin !== pin2) { setPinErr('The two PINs don’t match.'); return; }
    setPinBusy(true); setPinErr('');
    try {
      const ID = window.TrinityIdentity;
      const ok = ID && ID.setPin ? await ID.setPin(pin) : false;
      if (ok) finish();
      else setPinErr('Couldn’t set the PIN right now — you can add one later in Settings.');
    } catch (e) { setPinErr('Couldn’t set the PIN — you can add one later in Settings.'); }
    setPinBusy(false);
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 70, background: 'var(--paper)', display: 'flex', flexDirection: 'column',
      animation: 'trinityFade .4s ease both' }}>
      {/* header + fields scroll together so the keyboard never traps the input; footer stays pinned */}
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {step === 0 ? (<React.Fragment>
      {/* warm header */}
      <div style={{ paddingTop: 64, paddingBottom: 22, textAlign: 'center', position: 'relative', overflow: 'hidden',
        background: 'radial-gradient(120% 80% at 50% -20%, var(--gold-tint), transparent 55%)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <UserAvatar av={av} name={name} size={84} />
        </div>
        <div style={{ maxWidth: 440, margin: '0 auto' }}>
        <h1 style={{ margin: '0 14px', fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, letterSpacing: '-.5px', lineHeight: 1.1 }}>
          What should your<br/>church call you?</h1>
        <p style={{ margin: '10px 26px 0', fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.5, color: 'var(--ink-2)', textWrap: 'pretty' }}>
          A name helps your church family recognise you and makes the chat feel like community. No email, no phone — you can stay private if you’d rather.</p>
        </div>
      </div>

      <div style={{ padding: '6px 22px 12px', maxWidth: 480, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* name field */}
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '8px 0 8px' }}>DISPLAY NAME</label>
        <input value={name} onChange={e => setName(e.target.value.slice(0, 24))} autoFocus placeholder="e.g. Maria"
          onFocus={e => { const t = e.target; setTimeout(() => { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {} }, 350); }} style={{
          width: '100%', height: 54, border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surface)',
          padding: '0 18px', fontSize: 18, fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--ink)', outline: 'none',
          boxShadow: 'var(--shadow)',
        }} />

        {/* avatar */}
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '22px 0 12px' }}>CHOOSE YOUR MARK</label>
        <AvatarPicker value={av} name={name} onChange={setAv} />
      </div>
      </React.Fragment>) : step === 1 ? (<React.Fragment>
      {/* STEP 1 — back up the 12 words */}
      <div style={{ padding: '60px 22px 12px', maxWidth: 480, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><div style={{ width: 62, height: 62, borderRadius: 18, background: 'color-mix(in oklab, var(--sage) 15%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sage)' }}><Icon name="key" size={28} /></div></div>
        <h1 style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 25, fontWeight: 700, margin: '0 0 10px', letterSpacing: '-.4px' }}>Back up your 12 words</h1>
        <p style={{ textAlign: 'center', fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 auto 18px', maxWidth: 380, fontFamily: 'var(--font-read)', textWrap: 'pretty' }}>These 12 words are your account’s root secret — no one can reset it for you. Write them on paper and keep them somewhere safe: typing them into a new phone is what brings your account back. Never photograph or share the words.</p>
        {words.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            {words.map((w, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 11, background: 'var(--surface)', border: '1px solid var(--line)' }}><span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', minWidth: 15 }}>{i + 1}</span><span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-ui)' }}>{w}</span></div>)}
          </div>
        ) : <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24 }}>Preparing your words…</div>}
        {/* Give feedback (a silent copy left users unsure it worked) AND — key for a shared/monitored phone — overwrite
            the clipboard after 60s so the recovery phrase doesn't linger there for a keyboard app / clipboard sync to lift. */}
        <button onClick={() => { if (navigator.clipboard && words.length) { navigator.clipboard.writeText(words.join(' ')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 8000); setTimeout(() => { try { navigator.clipboard.writeText(' '); } catch (e) {} }, 60000); }).catch(() => {}); } }} style={{ width: '100%', border: '1px solid var(--line)', background: 'var(--surface)', color: copied ? 'var(--sage)' : 'var(--ink-2)', padding: '10px', borderRadius: 12, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', marginBottom: 16 }}>{copied ? 'Copied ✓ — paste it somewhere safe now (clears in 1 min)' : 'Copy the 12 words'}</button>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 11, cursor: 'pointer', padding: '2px 2px' }}>
          <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ width: 20, height: 20, marginTop: 1, accentColor: 'var(--clay)', flexShrink: 0 }} />
          <span style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>I’ve written down my 12 words and stored them somewhere safe.</span>
        </label>
      </div>
      </React.Fragment>) : step === 2 ? (<React.Fragment>
      {/* STEP 2 — confirm a couple of words */}
      <div style={{ padding: '60px 22px 12px', maxWidth: 480, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><div style={{ width: 62, height: 62, borderRadius: 18, background: 'color-mix(in oklab, var(--sage) 15%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sage)' }}><Icon name="shield" size={28} /></div></div>
        <h1 style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 25, fontWeight: 700, margin: '0 0 10px', letterSpacing: '-.4px' }}>Quick check</h1>
        <p style={{ textAlign: 'center', fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 auto 20px', maxWidth: 360, fontFamily: 'var(--font-read)', textWrap: 'pretty' }}>Just to be sure you’ve got them — type these three words from your written copy.</p>
        {checkIdx.map((idx, i) => (
          <div key={idx} style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 7px' }}>WORD #{idx + 1}</label>
            <input value={answers[i] || ''} onChange={e => { const a = [...answers]; a[i] = e.target.value; setAnswers(a); setCheckErr(''); }} autoFocus={i === 0} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="type it here" style={{ width: '100%', height: 50, boxSizing: 'border-box', border: '1px solid ' + (checkErr ? 'var(--clay)' : 'var(--line)'), borderRadius: 14, background: 'var(--surface)', padding: '0 16px', fontSize: 16, fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--ink)', outline: 'none' }} />
          </div>
        ))}
        {checkErr ? <div style={{ fontSize: 13, color: 'var(--clay-ink)', margin: '2px 2px 8px', lineHeight: 1.4 }}>{checkErr}</div> : null}
        <button onClick={() => setStep(1)} style={{ background: 'none', border: 'none', color: 'var(--ink-3)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 2px', fontFamily: 'var(--font-ui)' }}>← Show my words again</button>
      </div>
      </React.Fragment>) : (<React.Fragment>
      {/* STEP 3 — lock the phone with a PIN (optional, strongly urged) */}
      <div style={{ padding: '60px 22px 12px', maxWidth: 480, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><div style={{ width: 62, height: 62, borderRadius: 18, background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--clay)' }}><Icon name="shield" size={28} /></div></div>
        <h1 style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 25, fontWeight: 700, margin: '0 0 10px', letterSpacing: '-.4px' }}>Lock this phone with a PIN</h1>
        <p style={{ textAlign: 'center', fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 auto 18px', maxWidth: 380, fontFamily: 'var(--font-read)', textWrap: 'pretty' }}>Without a PIN, <b>anyone who picks up your phone can read your messages and act as you</b>. With one, a lost, borrowed, or taken phone is just a locked box — your account can’t be opened without it. <b>We strongly recommend setting one.</b></p>
        <input type="password" inputMode="numeric" value={pin} onChange={e => { setPinVal(e.target.value); setPinErr(''); }} autoFocus placeholder="Choose a PIN (6+ digits)"
          style={{ width: '100%', boxSizing: 'border-box', height: 52, marginBottom: 12, border: '1px solid ' + (pinErr ? 'var(--clay)' : 'var(--line)'), borderRadius: 14, background: 'var(--surface)', padding: '0 16px', fontSize: 17, fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--ink)', outline: 'none' }} />
        <input type="password" inputMode="numeric" value={pin2} onChange={e => { setPin2(e.target.value); setPinErr(''); }} placeholder="Type it again to confirm"
          style={{ width: '100%', boxSizing: 'border-box', height: 52, border: '1px solid ' + (pinErr ? 'var(--clay)' : 'var(--line)'), borderRadius: 14, background: 'var(--surface)', padding: '0 16px', fontSize: 17, fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--ink)', outline: 'none' }} />
        {pinErr ? <div style={{ fontSize: 13, color: 'var(--clay-ink)', margin: '10px 2px 0', lineHeight: 1.4 }}>{pinErr}</div> : null}
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5, margin: '12px 2px 0' }}>You’ll enter this each time you open the app. It never leaves your phone, and no one — not even us — can reset it.</div>
      </div>
      </React.Fragment>)}
      </div>

      {/* actions */}
      <div style={{ padding: '12px 22px 26px', borderTop: '1px solid var(--line-2)', background: 'var(--paper)' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
        {step === 0 ? (<React.Fragment>
          <button onClick={() => setStep(1)} style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: 'pointer', marginBottom: 10, background: name.trim() ? 'var(--clay)' : 'var(--surface-2)', color: name.trim() ? '#fff' : 'var(--ink-3)', boxShadow: name.trim() ? 'var(--shadow)' : 'none', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)' }}>{name.trim() ? `Continue as ${name.trim()}` : 'Continue without a name'}</button>
          <button onClick={() => { setRestoring(true); setRErr(''); }} style={{ width: '100%', padding: 12, borderRadius: 14, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700, color: 'var(--clay)' }}>I already have an account — restore it</button>
          <button onClick={onSkip} style={{ width: '100%', padding: 12, borderRadius: 14, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--font-ui)' }}>Skip setup for now</button>
        </React.Fragment>) : step === 1 ? (<React.Fragment>
          <button onClick={() => setStep(2)} disabled={!ack} style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: ack ? 'pointer' : 'default', marginBottom: 10, background: ack ? 'var(--clay)' : 'var(--surface-2)', color: ack ? '#fff' : 'var(--ink-3)', boxShadow: ack ? 'var(--shadow)' : 'none', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)' }}>Continue</button>
          <button onClick={() => setStep(3)} style={{ width: '100%', padding: 12, borderRadius: 14, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--font-ui)' }}>I’ll back these up later</button>
        </React.Fragment>) : step === 2 ? (<React.Fragment>
          <button onClick={confirmWords} disabled={!canConfirm} style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: canConfirm ? 'pointer' : 'default', marginBottom: 10, background: canConfirm ? 'var(--clay)' : 'var(--surface-2)', color: canConfirm ? '#fff' : 'var(--ink-3)', boxShadow: canConfirm ? 'var(--shadow)' : 'none', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)' }}>Continue</button>
          <button onClick={() => setStep(3)} style={{ width: '100%', padding: 12, borderRadius: 14, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--font-ui)' }}>Skip for now</button>
        </React.Fragment>) : (<React.Fragment>
          <button onClick={savePin} disabled={pinBusy || pin.length < 6 || !pin2} style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: (pinBusy || pin.length < 6 || !pin2) ? 'default' : 'pointer', marginBottom: 10, background: (pinBusy || pin.length < 6 || !pin2) ? 'var(--surface-2)' : 'var(--clay)', color: (pinBusy || pin.length < 6 || !pin2) ? 'var(--ink-3)' : '#fff', boxShadow: (pinBusy || pin.length < 6 || !pin2) ? 'none' : 'var(--shadow)', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)' }}>{pinBusy ? 'Setting…' : 'Set a PIN'}</button>
          <button onClick={finish} style={{ width: '100%', padding: 12, borderRadius: 14, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--font-ui)' }}>Skip for now</button>
        </React.Fragment>)}
        </div>
      </div>
    </div>
  );
}
window.IdentityOnboarding = IdentityOnboarding;

// Front-door unlock gate: shown over the whole app on open when a PIN is set and this session isn't unlocked
// yet. The identity is encrypted at rest (setPin dropped the plaintext), so a lost/borrowed/taken phone is
// inert here. "Read the Bible" is an escape that needs no identity (so a forgotten PIN never bricks the phone
// — the church, messages and identity stay locked, only the offline Bible opens).
function PinUnlockGate({ onUnlocked, onReadBible }) {
  const [pin, setPin] = useId('');
  const [err, setErr] = useId('');
  const [busy, setBusy] = useId(false);
  const [forgot, setForgot] = useId(false);
  const tryUnlock = async () => {
    if (!pin || busy) return;
    setBusy(true); setErr('');
    const ID = window.TrinityIdentity;
    let ok = false; try { ok = ID && ID.unlock ? await ID.unlock(pin) : false; } catch (e) { ok = false; }
    setBusy(false);
    if (ok) { try { window.dispatchEvent(new CustomEvent('trinity-identity-lock')); } catch (e) {} onUnlocked && onUnlocked(); }
    else { setErr('Wrong PIN. Try again.'); setPin(''); }
  };
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'var(--paper)', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '24px', animation: 'trinityFade .3s ease both' }}>
      <div style={{ width: 62, height: 62, borderRadius: 18, background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--clay)', marginBottom: 18 }}><Icon name="lock" size={28} /></div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, margin: '0 0 8px', textAlign: 'center' }}>Enter your PIN</h1>
      <p style={{ fontSize: 14.5, color: 'var(--ink-2)', textAlign: 'center', margin: '0 0 22px', maxWidth: 300, lineHeight: 1.5 }}>Your account is locked on this phone. Enter your PIN to open it.</p>
      <input type="password" inputMode="numeric" value={pin} autoFocus onChange={e => { setPin(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') tryUnlock(); }}
        placeholder="PIN" style={{ width: 'min(320px, 100%)', boxSizing: 'border-box', height: 54, textAlign: 'center', letterSpacing: '.3em', border: '1px solid ' + (err ? 'var(--clay)' : 'var(--line)'), borderRadius: 14, background: 'var(--surface)', fontSize: 20, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
      {err ? <div style={{ fontSize: 13.5, color: 'var(--clay-ink)', fontWeight: 600, marginTop: 12 }}>{err}</div> : null}
      <button onClick={tryUnlock} disabled={!pin || busy} style={{ width: 'min(320px, 100%)', marginTop: 18, padding: 15, borderRadius: 14, border: 'none', cursor: (!pin || busy) ? 'default' : 'pointer', background: (!pin || busy) ? 'var(--surface-2)' : 'var(--clay)', color: (!pin || busy) ? 'var(--ink-3)' : '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)' }}>{busy ? 'Unlocking…' : 'Unlock'}</button>
      <button onClick={() => onReadBible && onReadBible()} style={{ marginTop: 16, background: 'none', border: 'none', color: 'var(--ink-2)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Read the Bible without unlocking →</button>
      <button onClick={() => setForgot(f => !f)} style={{ marginTop: 6, background: 'none', border: 'none', color: 'var(--ink-3)', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Forgot your PIN?</button>
      {forgot ? <div style={{ fontSize: 13, color: 'var(--ink-3)', textAlign: 'center', margin: '10px auto 0', maxWidth: 300, lineHeight: 1.5 }}>Your PIN can’t be reset — not even by us. If you’ve forgotten it, reinstall the app and restore your account with your 12 words.</div> : null}
    </div>
  );
}
window.PinUnlockGate = PinUnlockGate;

// ════════ Start a new identity (destructive — gated by a safety step) ════════
// Reuses the warm name+avatar moment from onboarding, but FIRST makes the member
// reckon with what they're leaving behind: a new key can't see the old one's groups.
function genNpub() {
  const cs = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  return 'npub1' + Array.from({ length: 42 }, () => cs[Math.floor(Math.random() * cs.length)]).join('');
}

function NewIdentitySheet({ open, identity, onCreate, onClose, ctx }) {
  const D = window.TrinityData;
  const [step, setStep] = useId('warn'); // warn | create | done
  const [name, setName] = useId('');
  const [av, setAv] = useId({ kind: 'symbol', color: '#46708C', symbol: 'dove' });
  const [fresh, setFresh] = useId(null); // the created identity (for the done screen)
  // SECURITY-AUDIT-2026-07-18: trust the durable per-npub "backed up" flag written when the member confirmed in
  // RecoverySheet — the in-memory identity.backedUp was never set true, so this warning fired even after backup.
  const backedUp = !!(identity && identity.backedUp) || (() => { try {
    const np = identity && identity.npub;
    if (np && localStorage.getItem('trinityone.backedup.' + np) === '1') return true;
    if (np && localStorage.getItem('trinityone.backedup') === 'true') { localStorage.setItem('trinityone.backedup.' + np, '1'); return true; }   // migrate the legacy global flag
    return false;
  } catch (e) { return false; } })();

  useIdE(() => { if (open) { setStep('warn'); setName(''); setAv({ kind: 'symbol', color: '#46708C', symbol: 'dove' }); setFresh(null); } }, [open]);
  if (!open) return null;

  const curName = (identity && identity.name && identity.name.trim()) || identity?.handle || 'your current identity';

  const create = async () => {
    const pool = D.HANDLE_POOL;
    // REAL: mint a fresh key on the device, then publish the chosen name/mark to it
    const ID = window.TrinityIdentity, FS = window.Fellowship;
    let npub = genNpub(), handle = 'Anonymous ' + pool[Math.floor(Math.random() * pool.length)];
    try {
      if (ID && ID.regenerate) { await ID.regenerate(); if (ID.current) { npub = ID.current.npub || npub; handle = ID.current.handle || handle; } }
      if (FS && FS.setProfile && (name.trim() || av)) { await FS.ready; await FS.setProfile({ name: name.trim(), av }); }
    } catch (e) { console.warn('[identity] new-key failed', e); }
    const patch = { name: name.trim(), avatar: av, npub, handle, backedUp: false };
    setFresh(patch);
    onCreate(patch);
    setStep('done');
  };

  const wrap = { position: 'absolute', inset: 0, zIndex: 78, background: 'var(--paper)', display: 'flex', flexDirection: 'column', animation: 'trinityFade .3s ease both' };

  // ── STEP 1 · safety gate ──
  if (step === 'warn') {
    return (
      <div style={wrap}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '52px 16px 10px' }}>
          <IconBtn name="x" onClick={onClose} />
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>New identity</div>
        </div>

        <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '8px 22px 12px' }}>
          <div style={{ width: 60, height: 60, borderRadius: 18, background: 'color-mix(in oklab, var(--clay) 13%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '6px 0 16px' }}>
            <Icon name="refresh" size={28} color="var(--clay)" />
          </div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 25, fontWeight: 700, letterSpacing: '-.5px', lineHeight: 1.12 }}>Start fresh with a<br/>new identity?</h1>
          <p style={{ margin: '12px 0 20px', fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.55, color: 'var(--ink-2)', textWrap: 'pretty' }}>
            This creates a brand-new key — a clean slate. Useful if you’re handing this phone on, or want to separate yourself from a group.</p>

          {/* what you're leaving */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 14 }}>
            <UserAvatar av={identity?.avatar} name={identity?.name} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{curName}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{identity?.npub}</div>
            </div>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)' }}>current</span>
          </div>

          {/* the consequence */}
          <div style={{ display: 'flex', gap: 11, padding: '14px 15px', borderRadius: 16, background: 'color-mix(in oklab, var(--clay) 8%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 28%, transparent)', marginBottom: 16 }}>
            <Icon name="shield" size={19} color="var(--clay)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
              <b style={{ color: 'var(--ink)' }}>{curName} stays on the old key.</b> A new identity won’t carry over its groups, giving history, or name.
              {backedUp
                ? <> You’ve saved its 12 words, so you can always restore it later.</>
                : <> You haven’t saved its 12 words yet — without them, <b style={{ color: 'var(--clay-ink)' }}>it’s gone for good.</b></>}
            </div>
          </div>

          {!backedUp ? (
            <button onClick={() => ctx.openRecovery()} style={{ width: '100%', padding: 15, borderRadius: 15, border: 'none', cursor: 'pointer', marginBottom: 10,
              background: 'var(--ink)', color: 'var(--paper)', fontWeight: 700, fontSize: 15.5, fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
              <Icon name="key" size={18} color="var(--paper)" /> Back up {curName} first</button>
          ) : null}
        </div>

        <div style={{ padding: '12px 22px 26px', borderTop: '1px solid var(--line-2)' }}>
          <button onClick={() => setStep('create')} style={{
            width: '100%', padding: 15, borderRadius: 15, border: '1px solid color-mix(in oklab, var(--clay) 40%, var(--line))', cursor: 'pointer', marginBottom: 8,
            background: backedUp ? 'var(--clay)' : 'var(--surface)', color: backedUp ? '#fff' : 'var(--clay-ink)', fontWeight: 700, fontSize: 15.5, fontFamily: 'var(--font-ui)' }}>
            {backedUp ? 'Continue — create new identity' : 'I understand, continue anyway'}</button>
          <button onClick={onClose} style={{ width: '100%', padding: 11, borderRadius: 13, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-2)', fontWeight: 600, fontSize: 14.5, fontFamily: 'var(--font-ui)' }}>Keep {curName}</button>
        </div>
      </div>
    );
  }

  // ── STEP 2 · the warm create moment (mirrors first-run signup) ──
  if (step === 'create') {
    return (
      <div style={wrap}>
        <div style={{ paddingTop: 56, paddingBottom: 20, textAlign: 'center', position: 'relative', overflow: 'hidden',
          background: 'radial-gradient(120% 80% at 50% -20%, var(--gold-tint), transparent 55%)' }}>
          <button onClick={() => setStep('warn')} aria-label="Back" style={{ position: 'absolute', left: 16, top: 50, width: 40, height: 40, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)' }}>
            <Icon name="chevL" size={20} /></button>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <UserAvatar av={av} name={name} size={84} />
          </div>
          <h1 style={{ margin: '0 14px', fontFamily: 'var(--font-display)', fontSize: 25, fontWeight: 700, letterSpacing: '-.5px', lineHeight: 1.1 }}>Your new start</h1>
          <p style={{ margin: '9px 26px 0', fontFamily: 'var(--font-read)', fontSize: 15, lineHeight: 1.5, color: 'var(--ink-2)', textWrap: 'pretty' }}>
            Pick a name and a mark for the fresh identity. You can keep it private if you’d rather.</p>
        </div>

        <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '6px 22px 12px' }}>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '8px 0 8px' }}>DISPLAY NAME</label>
          <input value={name} onChange={e => setName(e.target.value.slice(0, 24))} autoFocus placeholder="e.g. Maria" style={{
            width: '100%', height: 54, border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surface)',
            padding: '0 18px', fontSize: 18, fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--ink)', outline: 'none', boxShadow: 'var(--shadow)' }} />
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '22px 0 12px' }}>CHOOSE YOUR MARK</label>
          <AvatarPicker value={av} name={name} onChange={setAv} />
        </div>

        <div style={{ padding: '12px 22px 26px', borderTop: '1px solid var(--line-2)' }}>
          <button onClick={create} style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: 'pointer',
            background: 'var(--clay)', color: 'var(--on-clay)', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)' }}>
            {name.trim() ? `Create ${name.trim()}` : 'Create new identity'}</button>
        </div>
      </div>
    );
  }

  // ── STEP 3 · done, nudge to back up the NEW key ──
  return (
    <div style={wrap}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 30px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18, animation: 'trinityScale .4s cubic-bezier(.2,.9,.3,1.3) both' }}>
          <UserAvatar av={fresh?.avatar} name={fresh?.name} size={92} />
        </div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, letterSpacing: '-.5px', lineHeight: 1.15 }}>
          {fresh?.name ? `Hello, ${fresh.name}` : 'Fresh start ready'}</h1>
        <p style={{ margin: '14px 0 0', fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.55, color: 'var(--ink-2)', textWrap: 'pretty' }}>
          You’re running on a brand-new key. It comes with its own <b style={{ color: 'var(--ink)' }}>12 recovery words</b> — save them now so this identity is never lost.</p>
        <div style={{ marginTop: 14, padding: '8px 14px', borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--line)', fontFamily: 'monospace', fontSize: 12.5, color: 'var(--ink-3)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fresh?.npub}</div>
      </div>
      <div style={{ padding: '12px 22px 26px', borderTop: '1px solid var(--line-2)' }}>
        <button onClick={() => { onClose(); ctx.openRecovery(); }} style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: 'pointer', marginBottom: 9,
          background: 'var(--clay)', color: 'var(--on-clay)', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
          <Icon name="key" size={18} color="#fff" /> Save my 12 words</button>
        <button onClick={onClose} style={{ width: '100%', padding: 12, borderRadius: 14, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-2)', fontWeight: 600, fontSize: 14.5, fontFamily: 'var(--font-ui)' }}>I’ll do it later</button>
      </div>
    </div>
  );
}
window.NewIdentitySheet = NewIdentitySheet;

// ════════ Profile sheet (reorganised) ════════
// in-place switch: whether this member appears in their church's People directory. Default visible; turning
// it off publishes `hidden` on the profile so other members' apps drop them from the list.
function DirectoryToggle({ identity, onSave, ctx }) {
  const [hidden, setHidden] = useId(!!identity.hidden);
  useIdE(() => { setHidden(!!identity.hidden); }, [identity]);
  const visible = !hidden;
  const flip = () => { const nv = !hidden; setHidden(nv); onSave({ hidden: nv }); ctx.toast(nv ? 'Hidden from the church directory' : 'Visible in the church directory'); };
  return (
    <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '14px 16px', borderTop: '1px solid var(--line-2)', textAlign: 'left' }}>
      <div style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
        <Icon name="users" size={19} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>Show me in the directory</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>{visible ? 'Your church can find you in People' : 'Hidden — you can still message and be messaged'}</div>
      </div>
      <button onClick={flip} role="switch" aria-checked={visible} style={{ flexShrink: 0, width: 46, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', padding: 3, background: visible ? 'var(--sage)' : 'var(--line)', transition: 'background .15s' }}>
        <div style={{ width: 22, height: 22, borderRadius: 999, background: '#fff', boxShadow: 'var(--shadow)', transform: visible ? 'translateX(18px)' : 'translateX(0)', transition: 'transform .15s' }} /></button>
    </div>
  );
}

function ProfileSheet({ open, onClose, identity, onSave, ctx }) {
  const D = window.TrinityData;
  const [edit, setEdit] = useId(false);
  const [family, setFamily] = useId(false);
  const [name, setName] = useId(identity.name || '');
  const [av, setAv] = useId(identity.avatar);
  // seed the form when the sheet OPENS, and refresh it if the profile changes while NOT editing — but never
  // re-seed mid-edit: an identity update echoing back (relay round-trip / another device / a parent re-render)
  // would otherwise wipe the name/mark you're in the middle of picking and bounce you back to the profile view.
  useIdE(() => { if (open) setEdit(false); }, [open]);
  useIdE(() => { if (open && !edit) { setName(identity.name || ''); setAv(identity.avatar); } }, [open, identity, edit]);

  const named = !!(identity.name && identity.name.trim());
  // steward rule: this church asks for a real first + last name (two words)
  const twoWords = (s) => (s || '').trim().split(/\s+/).filter(Boolean).length >= 2;
  const needFull = !!(ctx && ctx.requireFullName);
  // member photos: ON by default — a church opts out via features.memberPhotos === false. Children are
  // excluded unless the church opts kids in (features.childPhotos). A steward can also reset one account's
  // photo (photoBlocked, persistent until re-allowed).
  const _cf = ctx && ctx.church && ctx.church.features;
  const allowPhoto = !!(ctx && ctx.church)
    && !(_cf && _cf.memberPhotos === false)
    && (!(ctx && ctx.safeguard && ctx.safeguard.isMinor) || !!(_cf && _cf.childPhotos))
    && !(ctx && ctx.safeguard && ctx.safeguard.photoBlocked);

  // member wallet balance (always the member's, rides on their key) — live for the wallet row
  const [wbal, setWbal] = useId(() => (window.TrinityWallet ? window.TrinityWallet.balance() : 0));
  useIdE(() => { const W = window.TrinityWallet; if (!W || !W.onChange) return; if (W.init) W.init().catch(() => {}); return W.onChange(setWbal); }, []);

  // ── edit mode ──
  if (edit) {
    return (
      <Overlay open={open} onClose={onClose}>
        <div style={{ paddingTop: 50 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px 6px' }}>
            <button onClick={() => setEdit(false)} style={{ border: 'none', background: 'none', color: 'var(--ink-2)', fontWeight: 600, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Cancel</button>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>Edit profile</span>
            <button onClick={() => { if (needFull && !twoWords(name)) return; onSave({ name: name.trim(), avatar: av }); setEdit(false); ctx.toast('Profile saved'); }} disabled={needFull && !twoWords(name)} style={{
              border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', padding: '9px 16px', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)', opacity: (needFull && !twoWords(name)) ? 0.5 : 1 }}>Save</button>
          </div>
        </div>
        <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '14px 22px 30px' }}>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 8px' }}>DISPLAY NAME</label>
          <input value={name} onChange={e => setName(e.target.value.slice(0, 32))} placeholder={needFull ? 'First and last name (e.g. Jane Smith)' : 'Your name (optional)'} style={{
            width: '100%', height: 52, border: '1px solid ' + (needFull && name.trim() && !twoWords(name) ? 'var(--clay)' : 'var(--line)'), borderRadius: 16, background: 'var(--surface)',
            padding: '0 16px', fontSize: 17, fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--ink)', outline: 'none', boxShadow: 'var(--shadow)' }} />
          {needFull ? <div style={{ fontSize: 12.5, color: name.trim() && !twoWords(name) ? 'var(--clay-ink)' : 'var(--ink-3)', margin: '8px 2px 0', lineHeight: 1.45 }}>{(ctx.church && ctx.church.name) || 'Your church'} asks members to use a real <b>first and last name</b> so people can recognise you.</div> : null}
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '22px 0 12px' }}>YOUR MARK</label>
          {ctx && ctx.safeguard && ctx.safeguard.photoBlocked && ctx.church && !(ctx.church.features && ctx.church.features.memberPhotos === false) ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 12px', lineHeight: 1.45 }}>A steward has turned off photos for your account. You can still choose a symbol or your initial.</div> : null}
          <AvatarPicker value={av} name={name} onChange={setAv} allowPhoto={allowPhoto} />
        </div>
      </Overlay>
    );
  }

  // ── view mode ──
  const Group = ({ children }) => (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 18, overflow: 'hidden', boxShadow: 'var(--shadow)', marginBottom: 14 }}>{children}</div>
  );
  const Row = ({ icon, label, sub, onClick, danger, accent }) => (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '14px 16px', border: 'none',
      borderTop: '1px solid var(--line-2)', background: 'none', cursor: 'pointer', textAlign: 'left',
      color: danger ? 'var(--clay-ink)' : 'var(--ink)', fontFamily: 'var(--font-ui)',
    }}>
      <div style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: danger ? 'var(--clay-soft)' : 'var(--surface-2)', color: danger ? 'var(--clay-ink)' : (accent || 'var(--ink-2)') }}>
        <Icon name={icon} size={19} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{label}</div>
        {sub ? <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div> : null}
      </div>
      <Icon name="chevR" size={17} color="var(--ink-3)" />
    </button>
  );

  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px 6px' }}>
          <IconBtn name="chevL" onClick={onClose} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>You</span>
          <IconBtn name="pen" onClick={() => setEdit(true)} />
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 30px' }}>
        {/* identity hero */}
        <div style={{ textAlign: 'center', padding: '14px 0 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <UserAvatar av={identity.avatar} name={identity.name} size={104} />
          </div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 27, fontWeight: 700, letterSpacing: '-.5px' }}>
            {named ? identity.name : 'Anonymous'}</h1>
          {named && identity.nip05 ? <div style={{ marginTop: 5, display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--sage)', fontWeight: 700, fontSize: 14 }} title={identity.nip05}>@{String(identity.nip05).split('@')[0]} <Icon name="check" size={14} stroke={3} color="var(--sage)" /></div> : null}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, background: 'var(--clay-soft)', color: 'var(--clay-ink)',
            padding: '5px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 700 }}>
            <Icon name="shield" size={13} /> {named ? 'TrinityOne member' : 'Anonymous member'}</div>
          {!named ? (
            <div style={{ marginTop: 16 }}>
              <button onClick={() => setEdit(true)} style={{ border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', padding: '12px 22px',
                borderRadius: 14, fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Add a name</button>
              <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '12px 22px 0', lineHeight: 1.5 }}>Optional. A name helps your church recognise you — you’ll still share no personal data.</p>
            </div>
          ) : (
            <button onClick={() => setEdit(true)} style={{ marginTop: 14, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)',
              padding: '10px 20px', borderRadius: 13, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)' }}>Edit name & mark</button>
          )}
        </div>

        {/* privacy reassurance */}
        <div style={{ display: 'flex', gap: 11, padding: 14, borderRadius: 16, background: 'color-mix(in oklab, var(--sage) 12%, var(--surface))',
          border: '1px solid color-mix(in oklab, var(--sage) 30%, transparent)', marginBottom: 18 }}>
          <Icon name="shield" size={20} color="var(--sage)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            <b style={{ color: 'var(--ink)' }}>No account, no tracking.</b> Your identity lives only on this device as a private key.</div>
        </div>

        {/* my church */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '4px 4px 9px' }}>MY CHURCH</div>
        <Group>
          <Row icon="qr" label="Follow a church" sub="Scan a code or paste a church’s link" accent="var(--clay)" onClick={() => { onClose && onClose(); ctx.openChurchSwitcher('follow'); }} />
          <DirectoryToggle identity={identity} onSave={onSave} ctx={ctx} />
        </Group>

        {/* My family — a parent sets up & oversees a child's account (safeguarding v2) */}
        {ctx.church && ctx.church.npub && window.Fellowship && window.Fellowship.createChildAccount ? (
          <React.Fragment>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '16px 4px 9px' }}>MY FAMILY</div>
            <Group>
              <Row icon="pray" label="Children’s accounts" sub="Set up and look after a child’s account in your church" accent="var(--sage)" onClick={() => setFamily(true)} />
            </Group>
          </React.Fragment>
        ) : null}

        {/* Your wallet — the member's own (add / give / withdraw). Parked for the pilot (WALLET_ENABLED); hidden for child accounts (safeguarding). */}
        {WALLET_ENABLED && !(ctx.safeguard && ctx.safeguard.isMinor) ? (
          <React.Fragment>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '16px 4px 9px' }}>YOUR WALLET</div>
            <Group>
              <Row icon="bolt" label="Lightning wallet" sub={`${Number(wbal || 0).toLocaleString('en-US')} sats · add funds or withdraw any time`} accent="var(--gold)" onClick={() => { onClose && onClose(); ctx.openWallet(); }} />
            </Group>
          </React.Fragment>
        ) : null}

        {/* settings */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '16px 4px 9px' }}>SETTINGS</div>
        <Group>
          <Row icon="bell" label="Notifications" sub="Choose what you’re alerted about" accent="var(--clay)" onClick={() => { onClose && onClose(); ctx.openNotifSettings(); }} />
          <Row icon="bolt" label="Currency" sub={(() => { const c = window.TrinityLN && window.TrinityLN.currency && window.TrinityLN.currency(); return c ? `Show giving amounts in ${c.label} (${c.symbol})` : 'Currency for giving amounts'; })()} accent="var(--gold)" onClick={() => { onClose && onClose(); ctx.openCurrency(); }} />
        </Group>

        {/* share the app — pass it on hand to hand (Quick Share / Bluetooth), no internet needed */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '16px 4px 9px' }}>SHARE</div>
        <Group>
          <Row icon="share" label="Share the app" sub="Pass TrinityOne to someone nearby — Quick Share or Bluetooth, no internet needed" accent="var(--sage)" onClick={() => { onClose && onClose(); ctx.openShareApp(); }} />
        </Group>

        {/* help & guides */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '16px 4px 9px' }}>HELP &amp; SETUP</div>
        <Group>
          <Row icon="book" label="Help & guides" sub="Simple guides, read aloud if you like" accent="var(--clay)" onClick={() => ctx.openHelp('index')} />
        </Group>

        {/* YOUR KEY — backs up *access* (your account). Paper is the root of trust. */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '16px 4px 9px' }}>YOUR RECOVERY KEY</div>
        <Group>
          <Row icon="shield" label="Recovery key — your 12 words" sub="Your account’s master key. Restores you on any phone — write it on paper, keep it safe." accent="var(--sage)" onClick={() => ctx.openRecovery()} />
          <Row icon="swap" label="Move to a new phone" sub="Carry this account across by scanning — nothing to write down or type." accent="var(--clay)" onClick={() => ctx.openMovePhone()} />
          <Row icon="key" label="Your account ID" sub={identity.npub.slice(0, 24) + '…'} accent="var(--gold)" onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(identity.npub).catch(() => {}); ctx.toast('Your account ID copied'); }} />
        </Group>

        {/* optional community PIN — encrypts the identity so ONLY the church side needs a PIN; the Bible stays open */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '16px 4px 9px' }}>PRIVACY</div>
        <Group>
          <Row icon="lock" label={ctx.hasCommunityPin ? 'Identity lock — on' : 'Lock identity with a PIN'} sub={ctx.hasCommunityPin ? 'A PIN protects the church side of the app on this phone. Your Bible always stays open.' : 'PIN-lock your identity so the church side needs the PIN — without it nobody can open your church or read your messages, and the screen shows only the Bible.'} accent="var(--sage)" onClick={() => { onClose && onClose(); ctx.openCommunitySecurity(); }} />
        </Group>

        {/* steward-only tools — hidden for ordinary members */}
        {identity.steward ? (
          <React.Fragment>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '16px 4px 9px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px' }}>STEWARD</div>
              {ctx.church && ctx.church.name ? <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.3px', color: 'var(--clay-ink)', background: 'var(--clay-soft)', padding: '2px 8px', borderRadius: 999 }}>{ctx.church.name}</span> : null}
            </div>
            <Group>
              <Row icon="qr" label="Steward invite" sub="Add someone to your church" accent="var(--clay)" onClick={() => ctx.openInvite()} />
            </Group>
          </React.Fragment>
        ) : null}

        {/* YOUR DATA — backs up *content* (notes/journals/highlights/books). A different job. */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '16px 4px 9px' }}>YOUR DATA</div>
        <BackupCard ctx={ctx} />

        {/* relays + danger */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '16px 4px 9px' }}>NETWORK</div>
        <Group>
          <Row icon="globe" label="Relays" sub={`${(window.Fellowship && window.Fellowship.relays || D.RELAYS).length} connected`} onClick={() => ctx.openRelays()} />
        </Group>
        {/* "Start a new identity" hidden for the pilot — too easy to wipe a key by accident */}
        <AppVersion />
      </div>
      {family ? <FamilySheet open={family} onClose={() => setFamily(false)} ctx={ctx} /> : null}
    </Overlay>
  );
}
window.ProfileSheet = ProfileSheet;

// small version line at the foot of the You sheet — so test builds are easy to tell apart.
// Native only (reads the installed APK's versionName + versionCode via @capacitor/app).
function AppVersion() {
  const [v, setV] = useId('');
  useIdE(() => {
    const P = window.Capacitor && window.Capacitor.Plugins;
    if (!(P && P.App && P.App.getInfo)) return;
    let alive = true;
    P.App.getInfo().then(i => { if (alive && i) setV('v' + i.version + ' (' + i.build + ')'); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!v) return null;
  return <div style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '.3px', margin: '20px 0 4px' }}>TrinityOne {v}</div>;
}
window.AppVersion = AppVersion;

// ── My family (safeguarding v2): a parent creates and oversees a child's account ──
// Minting the child's key, joining them to the church, and asking the steward to confirm the link all
// happen in Fellowship.createChildAccount. Here we collect the child's name, then reveal their 12-word
// recovery phrase + a one-scan login QR so the parent can hand the account to the child's device.
function FamilySheet({ open, onClose, ctx }) {
  const F = window.Fellowship;
  const me = (F && F.myPubkey) || null;
  const [kids, setKids] = useId(() => (F && F.myChildren ? F.myChildren(ctx.church && ctx.church.npub) : []));
  const [stage, setStage] = useId('list');     // 'list' | 'name' | 'reveal'
  const [name, setName] = useId('');
  const [busy, setBusy] = useId(false);
  const [err, setErr] = useId('');
  const [made, setMade] = useId(null);          // { childPub, mnemonic, npub, name }
  const guardians = (ctx.safeguard && ctx.safeguard.guardians) || {};
  // a link is "done" if the steward initiated it (viaSteward — the notice IS the confirmation) OR the church's
  // guardians map lists me (my own self-request was confirmed). Only a still-pending SELF-request shows "waiting".
  const confirmed = (k) => !!(k && (k.viaSteward || (guardians[k.child] || []).includes(me)));
  const refreshKids = () => setKids(F && F.myChildren ? F.myChildren(ctx.church && ctx.church.npub) : []);
  // a steward-initiated guardian link arrives as an encrypted notice → the engine records the child, then
  // fires this so it appears here without a reload.
  useIdE(() => { const f = () => refreshKids(); window.addEventListener('trinity-guardian-added', f); return () => window.removeEventListener('trinity-guardian-added', f); }, []);
  const create = async () => {
    const n = name.trim(); if (!n) { setErr('Enter the child’s name.'); return; }
    setBusy(true); setErr('');
    try { const r = await F.createChildAccount(ctx.church.npub, n); setMade(r); setStage('reveal'); refreshKids(); }
    catch (e) { setErr((e && e.message) || 'Couldn’t set up the account — please try again.'); }
    setBusy(false);
  };
  const inviteUrl = made ? inviteUrlFor(made.mnemonic, ctx) : '';
  const qrSvg = (made && window.TrinityIdentity && window.TrinityIdentity.qrSVG) ? window.TrinityIdentity.qrSVG(inviteUrl) : '';
  const words = made ? made.mnemonic.split(/\s+/) : [];
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px 6px' }}>
          <IconBtn name="chevL" onClick={() => { if (stage === 'list') onClose(); else { setStage('list'); setMade(null); setName(''); setErr(''); } }} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>{stage === 'reveal' ? 'Set up the child’s device' : stage === 'name' ? 'Add a child' : 'Children’s accounts'}</span>
          <div style={{ width: 38 }} />
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 30px' }}>
        {stage === 'list' ? (
          <React.Fragment>
            <div style={{ display: 'flex', gap: 11, padding: 14, borderRadius: 16, background: 'color-mix(in oklab, var(--sage) 12%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 30%, transparent)', marginBottom: 16 }}>
              <Icon name="shield" size={20} color="var(--sage)" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>{(kids.length === 0 || kids.some(k => !k.viaSteward))
                ? 'You set up the account and keep its recovery words. Once your steward confirms the link, the account is marked as a child — they’ll only see child-safe groups, and only you and cleared leaders can message them privately.'
                : 'Your steward linked you as this child’s parent. You can message them privately and collect them at check-in — they only see child-safe groups, protected by the church.'}</div>
            </div>
            {kids.length ? kids.map(k => (
              <div key={k.child} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', marginBottom: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="pray" size={20} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{k.name}</div>
                  <div style={{ fontSize: 12.5, color: confirmed(k) ? 'var(--sage)' : 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Icon name={confirmed(k) ? 'check' : 'shield'} size={12} color="currentColor" /> {k.viaSteward ? 'Linked by your steward' : confirmed(k) ? 'Linked & protected' : 'Waiting for steward to confirm'}</div>
                </div>
              </div>
            )) : <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 16px', fontSize: 14, lineHeight: 1.5 }}>No children set up yet.</div>}
            <button onClick={() => { setStage('name'); setName(''); setErr(''); }} style={{ marginTop: 8, width: '100%', border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', padding: '13px', borderRadius: 14, fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Icon name="plus" size={17} color="var(--on-clay)" /> Add a child</button>
          </React.Fragment>
        ) : stage === 'name' ? (
          <React.Fragment>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '6px 0 8px' }}>CHILD’S NAME</label>
            <input value={name} autoFocus onChange={e => { setName(e.target.value.slice(0, 24)); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') create(); }} placeholder="e.g. Sam Carter" style={{ width: '100%', boxSizing: 'border-box', height: 52, border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surface)', padding: '0 16px', fontSize: 17, fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--ink)', outline: 'none', boxShadow: 'var(--shadow)' }} />
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '12px 2px 0', lineHeight: 1.5 }}>This creates a brand-new account for your child in <b>{(ctx.church && ctx.church.name) || 'your church'}</b>. You’ll get its recovery words on the next screen — keep them safe; they’re the only way to restore the account.</p>
            {err ? <div style={{ fontSize: 13, color: 'var(--clay-ink)', marginTop: 10 }}>{err}</div> : null}
            <button onClick={create} disabled={busy || !name.trim()} style={{ marginTop: 20, width: '100%', border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', padding: '13px', borderRadius: 14, fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)', opacity: (busy || !name.trim()) ? 0.6 : 1 }}>{busy ? 'Setting up…' : 'Create the account'}</button>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div style={{ display: 'flex', gap: 11, padding: 14, borderRadius: 16, background: 'color-mix(in oklab, var(--gold) 11%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 30%, transparent)', marginBottom: 18 }}>
              <Icon name="shield" size={20} color="#8a6717" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}><b style={{ color: 'var(--ink)' }}>Save these 12 words.</b> They’re the only way to restore <b>{made && made.name}</b>’s account. Write them on paper and keep them safe — they’re shown once.</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 18 }}>
              {words.map((w, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 10px', borderRadius: 11, background: 'var(--surface)', border: '1px solid var(--line)' }}>
                  <span style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--mono, monospace)', minWidth: 14 }}>{i + 1}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{w}</span>
                </div>
              ))}
            </div>
            <button onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(made.mnemonic).catch(() => {}); ctx.toast('Recovery words copied — store them safely'); }} style={{ width: '100%', border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', padding: '11px', borderRadius: 13, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)', marginBottom: 22 }}>Copy the 12 words</button>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '0 4px 10px' }}>HAND IT TO THE CHILD’S DEVICE</div>
            {/* "TrinityOne's camera" sent a parent hunting for an in-app scanner that does not exist and was
                never meant to: a fresh install offers only the device-TRANSFER scanner, which expects a live
                mutually-verified exchange with another running phone, so the child's phone sat showing its own
                code waiting for a partner that never came. The intended route is the phone's OWN camera — the
                code is a link, and the app reads the seed from its fragment. Reported 2026-07-28.
                Still imperfect, and recorded on the roadmap: the link lives at "/" while the app only claims
                "/join", so the camera opens it in the BROWSER rather than the installed app. Routing it through
                /join is not the fix — that path deliberately refuses an invite, because an invite REPLACES the
                device identity. A child with the app installed should use the 12 words instead, which is why
                they are offered here as an equal route rather than a footnote. */}
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 2px 14px' }}>On your child’s phone, open its <b>normal camera app</b> and point it at this code — it signs them in as <b>{made && made.name}</b> and joins them to {(ctx.church && ctx.church.name) || 'your church'}. That opens TrinityOne in the browser.</p>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 2px 14px' }}>If they already have the TrinityOne app installed, open it there instead and choose <b>“I’ve used it before” → “I have my 12 words”</b>, then type the phrase above.</p>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
              <div style={{ width: 220, height: 220, background: '#fff', borderRadius: 18, padding: 12, boxShadow: 'var(--shadow)', boxSizing: 'border-box' }} dangerouslySetInnerHTML={{ __html: qrSvg }} />
            </div>
            <button onClick={() => { setStage('list'); setMade(null); setName(''); }} style={{ width: '100%', border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', padding: '13px', borderRadius: 14, fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Done</button>
          </React.Fragment>
        )}
      </div>
    </Overlay>
  );
}
window.FamilySheet = FamilySheet;
