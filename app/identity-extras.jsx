// identity-extras.jsx — member card, recovery phrase, steward invite, relays sheet
const { useState: useIx, useEffect: useIxE } = React;

// faux QR (visual only) — reused look from giving
function MiniQR({ seed = 'npub', size = 150 }) {
  const n = 19;
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const rnd = (i) => { const x = Math.sin(h + i * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const cells = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const finder = (rr, cc) => rr < 6 && cc < 6;
    const isF = finder(r, c) || finder(r, n - 1 - c) || finder(n - 1 - r, c);
    const on = isF ? (() => { const br = r < 6 ? r : n - 1 - r, bc = (c < 6 ? c : n - 1 - c); return (br === 0 || br === 5 || bc === 0 || bc === 5 || (br >= 2 && br <= 3 && bc >= 2 && bc <= 3)); })() : rnd(r * n + c) > 0.56;
    if (on) cells.push(<rect key={r + '-' + c} x={c} y={r} width="1" height="1" rx="0.18" />);
  }
  return <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} style={{ display: 'block' }}><rect width={n} height={n} fill="#fff" /><g fill="#1a1410">{cells}</g></svg>;
}

// ════════ View a member ════════
function MemberCard({ member, open, onClose, ctx }) {
  if (!member) return null;
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="80%" z={60}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -8 }}>
        <IconBtn name="x" onClick={onClose} />
      </div>
      <div style={{ textAlign: 'center', padding: '0 0 8px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <UserAvatar av={member.avatar} name={member.name} size={92} />
        </div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 25, fontWeight: 700 }}>{member.name}</h1>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, color: 'var(--ink-3)', fontSize: 13, fontWeight: 600 }}>
          <Icon name="shield" size={13} /> Anonymous · TrinityOne member</div>

        {member.bio ? (
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 16, lineHeight: 1.55, color: 'var(--ink)', margin: '16px 10px 0', textWrap: 'pretty' }}>
            “{member.bio}”</p>
        ) : (
          <p style={{ fontSize: 14, color: 'var(--ink-3)', margin: '16px 0 0', fontStyle: 'italic' }}>No bio shared yet.</p>
        )}
      </div>

      {member.verses && member.verses.length ? (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 10 }}>RECENTLY SHARED</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {member.verses.map((v, i) => (
              <button key={i} onClick={() => { onClose(); ctx.openReader(); }} style={{
                display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderRadius: 14, width: '100%',
                background: 'var(--surface-2)', border: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left' }}>
                <Icon name="read" size={18} color="var(--clay)" />
                <span style={{ flex: 1, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14.5, color: 'var(--ink)' }}>{v}</span>
                <Icon name="chevR" size={16} color="var(--ink-3)" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* was: a primary-styled button that only toasted "coming soon" — while ctx.openDM has worked all
          along. A live-looking control that does nothing is worse than no control. */}
      <button onClick={() => { onClose(); if (ctx.openDM && member && member.pubkey) ctx.openDM(member.pubkey); }} style={{
        width: '100%', marginTop: 22, padding: 14, borderRadius: 15, border: '1px solid var(--line)', background: 'var(--surface)',
        color: 'var(--ink)', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Icon name="chat" size={18} /> Message {member.name}</button>
    </BottomSheet>
  );
}
window.MemberCard = MemberCard;

// ════════ Recovery phrase ════════
function RecoverySheet({ open, onClose, ctx }) {
  const [words, setWords] = useIx([]);   // REAL 12 words from the OS secure store / identity layer
  const [shown, setShown] = useIx(false);
  const [bk, setBk] = useIx(null);       // null | 'export' | 'restore'
  const [pass, setPass] = useIx('');
  const [busy, setBusy] = useIx('');
  const [bkErr, setBkErr] = useIx('');
  const [file, setFile] = useIx(null);
  useIxE(() => { if (!open) { setBk(null); setPass(''); setBkErr(''); setFile(null); } }, [open]);
  const markSaved = () => { try { const np = window.TrinityIdentity && window.TrinityIdentity.current && window.TrinityIdentity.current.npub; if (np) localStorage.setItem('trinityone.backedup.' + np, '1'); } catch (e) {} };
  const doExport = async () => {
    // SECURITY-AUDIT-2026-07-18: floor lowered 10 → 6 because the KDF is now memory-hard Argon2id (backup.jsx),
    // which makes a 6-digit PIN genuinely costly to brute-force even against a leaked/cloud-stored file — the
    // GPU-cheapness of PBKDF2 was what forced the old 10-char floor. The UI still nudges toward a longer
    // passphrase, which is meaningfully stronger for anyone who stores the backup somewhere it could be seized.
    try { window.TrinityBackup.checkPass(pass); } catch (e) { setBkErr(e.message); return; }
    setBusy('export'); setBkErr('');
    try {
      const obj = await window.TrinityBackup.collectMember();
      const text = await window.TrinityBackup.encryptObj(obj, pass);
      await window.TrinityBackup.saveFile('trinityone-backup-' + new Date().toISOString().slice(0, 10) + '.json', text);
      // Mark backed-up ONLY here, on the success path. It used to be called by the button after doExport
      // returned — but doExport resolves normally on its short-passphrase early-return AND in its catch, so
      // the durable "backed up" flag was set even when no valid backup was written, silencing the backup
      // nudge and leaving the member one lost device away from losing their identity with no warning.
      markSaved();
      ctx.toast('Backup created — save it somewhere safe'); setBk(null); setPass('');
    } catch (e) { setBkErr(e.message || 'Backup failed.'); } finally { setBusy(''); }
  };
  const doRestore = async () => {
    if (!file) { setBkErr('Choose your backup file first.'); return; }
    setBusy('restore'); setBkErr('');
    try {
      const text = await window.TrinityBackup.readFile(file);
      const obj = await window.TrinityBackup.decryptStr(text, pass);
      // SECURITY-AUDIT-2026-06-24 L6: confirm before overwriting the on-device key. The 06-18 audit
      // listed this as fixed but the confirm was missing from the code path. Without it, a user who
      // picks the wrong file (or whose current identity wasn't itself backed up) silently destroys
      // their on-device key with no way back. Plain `window.confirm` is deliberate — overwriting a
      // self-custodial key is the kind of decision that should look unambiguous and a little ugly,
      // not slick.
      const ID = window.TrinityIdentity;
      const curNpub = (ID && ((ID.current && ID.current.npub) || ID.npub)) || '';
      const msg = 'This will REPLACE your current TrinityOne identity with the backup\'s identity.\n\n'
        + (curNpub ? 'Current: ' + curNpub.slice(0, 18) + '…\n' : '')
        + '\nYour current key will be UNRECOVERABLE unless you saved its 12 words.\n\nContinue?';
      if (!window.confirm(msg)) { setBusy(''); return; }
      await window.TrinityBackup.applyMember(obj);
      ctx.toast('Restored — reloading…'); setTimeout(() => window.location.reload(), 800);
    } catch (e) { setBkErr(e.message || 'Restore failed.'); setBusy(''); }
  };
  useIxE(() => {
    if (!open) return;
    setShown(false);
    const ID = window.TrinityIdentity;
    if (ID && ID.exportMnemonic) ID.exportMnemonic().then(m => setWords(m ? m.split(' ') : [])).catch(() => setWords([]));
    else setWords(window.TrinityData.RECOVERY_PHRASE || []);
  }, [open]);
  const copyPhrase = () => { if (navigator.clipboard) navigator.clipboard.writeText(words.join(' ')).catch(() => {}); ctx.toast('Phrase copied — paste somewhere safe'); };
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="88%" z={60}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="shield" size={20} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700 }}>Secure your account</div>
        </div>
        <IconBtn name="x" onClick={onClose} />
      </div>
      <p style={{ fontFamily: 'var(--font-read)', fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2)', margin: '6px 0 16px', textWrap: 'pretty' }}>
        There’s no password to reset here — so let’s make sure you can always get back in. The <b style={{ color: 'var(--ink)' }}>safest way is to write your words on paper</b> and keep them somewhere safe. Prefer something easier? A backup file works too — just mind where you keep it.</p>

      {/* ── RECOMMENDED: the recovery words on paper — nothing stored anywhere else ──────────── */}
      <div style={{ borderRadius: 16, border: '1.5px solid color-mix(in oklab, var(--sage) 40%, var(--line))', background: 'color-mix(in oklab, var(--sage) 7%, var(--surface))', padding: 15 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>Write down your 12 words</div>
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .3, textTransform: 'uppercase', color: 'var(--sage)', background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', padding: '2px 7px', borderRadius: 999 }}>Safest</span>
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '5px 0 12px' }}>Nothing is stored anywhere else — so nothing can be stolen from a cloud or handed over. Write them on paper and keep it somewhere safe (not a photo). Anyone with these words <i>is</i> you.</p>
        <div style={{ position: 'relative', borderRadius: 18, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: 4, filter: shown ? 'none' : 'blur(7px)', transition: 'filter .25s' }}>
            {words.map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--ink-3)', width: 16 }}>{i + 1}</span>
                <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>{w}</span>
              </div>
            ))}
          </div>
          {!shown ? (
            <button onClick={() => setShown(true)} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
              border: 'none', background: 'rgba(20,14,8,.06)', cursor: 'pointer', color: 'var(--ink)', fontWeight: 700, fontSize: 14.5, fontFamily: 'var(--font-ui)' }}>
              <Icon name="key" size={26} color="var(--ink)" /> Tap to reveal</button>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button onClick={copyPhrase} style={{ flex: 1, padding: 12, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, boxShadow: 'var(--shadow)' }}>
            <Icon name="copy" size={16} /> Copy</button>
          <button disabled={!shown} onClick={() => { if (!shown) return; markSaved(); onClose(); ctx.toast('Saved — your 12 words can restore this identity'); }} title={shown ? '' : 'Reveal your 12 words first'} style={{ flex: 1, padding: 12, borderRadius: 14, border: 'none', background: 'var(--sage)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: shown ? 'pointer' : 'not-allowed', opacity: shown ? 1 : 0.5, fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            {/* SECURITY-AUDIT-2026-07-18: persist a durable, per-npub "backed up" flag (was a cosmetic toast). */}
            <Icon name="check" size={16} stroke={2.4} color="#fff" /> I’ve written them down</button>
        </div>
      </div>

      {/* ── EASIER: encrypted backup file — cloud OR local, with the risk stated plainly ─────── */}
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>Save an encrypted backup</div>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)', background: 'var(--surface-2)', border: '1px solid var(--line)', padding: '2px 7px', borderRadius: 999 }}>Easier</span>
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '4px 0 8px' }}>One file with your account <i>and</i> your notes, journal and plans — locked with a PIN or passphrase you choose. Restore it on any phone.</p>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 12px', padding: '9px 11px', borderRadius: 11, background: 'var(--surface-2)', border: '1px dashed var(--line)' }}>
          <b>Where you keep it matters.</b> Kept on your phone or a USB stick, only someone holding that device can try to open it — a short PIN is fine. Kept in the cloud (Drive, iCloud) it survives a lost phone — but if anyone got into your cloud they’d have the file to try your PIN against, so <b>use a few words, not a short PIN</b>.</div>
        {!bk ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => { setBk('export'); setPass(''); setBkErr(''); }} style={{ flex: 2, padding: 12, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, boxShadow: 'var(--shadow)' }}><Icon name="share" size={15} /> Save a backup</button>
            <button onClick={() => { setBk('restore'); setPass(''); setBkErr(''); setFile(null); }} style={{ flex: 1, padding: 12, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}><Icon name="refresh" size={15} /> Restore</button>
          </div>
        ) : (
          <div style={{ padding: 13, borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            {bk === 'restore' ? (
              <input type="file" accept=".json,application/json" onChange={e => setFile(e.target.files && e.target.files[0])} style={{ width: '100%', fontSize: 13, marginBottom: 10, fontFamily: 'var(--font-ui)' }} />
            ) : null}
            <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder={bk === 'export' ? 'Choose a PIN or passphrase (6+)' : 'Your backup PIN or passphrase'} style={{ width: '100%', boxSizing: 'border-box', height: 44, border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface)', padding: '0 13px', fontSize: 14.5, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
            {bkErr ? <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', fontWeight: 600, marginTop: 7 }}>{bkErr}</div> : null}
            <div style={{ display: 'flex', gap: 9, marginTop: 11 }}>
              <button onClick={() => { setBk(null); setBkErr(''); }} style={{ flex: 1, padding: 11, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Cancel</button>
              <button onClick={bk === 'export' ? doExport : doRestore} disabled={!!busy} style={{ flex: 1, padding: 11, borderRadius: 12, border: 'none', background: bk === 'restore' ? 'var(--clay)' : 'var(--sage)', color: 'var(--on-clay)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', opacity: busy ? 0.6 : 1 }}>{busy ? '…' : (bk === 'export' ? 'Create backup' : 'Restore')}</button>
            </div>
          </div>
        )}
      </div>

      {/* Guardian (2-of-3 social recovery) is DEFERRED to post-pilot — the setup ceremony is too heavy for the
          pilot and needs auto-delivery of a share to a chosen steward to be worth it over paper. The tested Shamir
          core (src/recovery-core.mjs + scripts/recovery.test.mjs, exposed as window.TrinityRecovery.split/combine)
          stays parked on the branch; only the UI is held back. See onboarding-friction memory. */}
    </BottomSheet>
  );
}
window.RecoverySheet = RecoverySheet;

// ════════ Community PIN — optional lock over the church side (OFF by default) ════════
// Three states, derived live from window.TrinityIdentity:
//   • no PIN  → set up (PIN + confirm) — encrypts the identity at rest under the PIN
//   • locked  → enter PIN to unlock the church community for this session
//   • on      → protected: lock now, or turn protection off (needs the PIN)
// The Bible reader, study and library never need this — they run with no identity at all.
function CommunitySecuritySheet({ open, onClose, ctx }) {
  const ID = window.TrinityIdentity || {};
  const hasPin = !!(ID.hasPin && ID.hasPin());
  const locked = !!(ID.isLocked && ID.isLocked());
  const [pin, setPin] = useIx('');
  const [pin2, setPin2] = useIx('');
  const [off, setOff] = useIx('');       // PIN entry when turning protection off
  const [showOff, setShowOff] = useIx(false);
  const [err, setErr] = useIx('');
  const [busy, setBusy] = useIx(false);
  useIxE(() => { if (!open) { setPin(''); setPin2(''); setOff(''); setShowOff(false); setErr(''); setBusy(false); } }, [open]);
  // "Remember me on this device" must be reversible from here, or the only way out is waiting 30 days. Read
  // when the sheet opens (it lives in the secure store, so this is async) and re-read after turning it off.
  const [remUntil, setRemUntil] = useIx(0);
  const readRemembered = () => { try { if (ID.rememberedUntil) ID.rememberedUntil().then(u => setRemUntil(u || 0)).catch(() => {}); } catch (e) {} };
  useIxE(() => { if (open) readRemembered(); }, [open]);

  const done = (msg) => { ctx.toast(msg); onClose(); };
  const doForget = async () => {
    // Clears the seed AND the expiry — they are one record in the secure store, so there is no way to drop
    // one and keep the other. Does not lock the current session: the member is looking at the app, and
    // throwing them out for changing a preference would be its own bug. The next launch asks for the PIN.
    try { if (ID.forgetDevice) await ID.forgetDevice(); } catch (e) {}
    setRemUntil(0);
    ctx.toast('This phone will ask for your PIN next time');
  };
  const doEnable = async () => {
    // The PIN is the ONLY secret protecting the at-rest encrypted seed blob (offline-brute-forceable if the
    // device is imaged), so a 4-digit PIN (~13 bits) is too weak. Require 6+ chars, and 8+ if all-numeric.
    // (audit 2026-07-06 #5)
    if ((pin || '').length < 6) { setErr('Choose a PIN of at least 6 characters. Adding letters makes it much harder to guess.'); return; }
    if (/^\d+$/.test(pin) && pin.length < 8) { setErr('An all-number PIN is easy to guess — use 8+ digits, or add letters.'); return; }
    if (pin !== pin2) { setErr('The two PINs don’t match.'); return; }
    setBusy(true); setErr('');
    const ok = await ID.setPin(pin); setBusy(false);
    if (ok) done('Church community is now protected'); else setErr('Couldn’t turn on protection — your identity isn’t loaded right now.');
  };
  const doUnlock = async () => {
    if (!pin) { setErr('Enter your PIN.'); return; }
    setBusy(true); setErr('');
    const ok = await ID.unlock(pin); setBusy(false);
    if (ok) done('Unlocked'); else setErr('That PIN didn’t work. If you’ve forgotten it, restore your 12-word recovery phrase to get back in.');
  };
  const doDisable = async () => {
    if (!off) { setErr('Enter your PIN to turn protection off.'); return; }
    setBusy(true); setErr('');
    const ok = await ID.removePin(off); setBusy(false);
    if (ok) done('Protection turned off'); else setErr('Couldn’t turn protection off — check your PIN and try again.');
  };
  const doLock = () => { if (ID.lock) ID.lock(); done('Church community locked'); };

  const inp = { width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface)', padding: '0 14px', fontSize: 16, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none', letterSpacing: '2px' };
  const primary = { width: '100%', padding: 14, borderRadius: 14, border: 'none', background: 'var(--sage)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)', opacity: busy ? 0.6 : 1 };
  const ghost = { width: '100%', padding: 13, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)', marginTop: 10 };

  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="86%" z={62}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="lock" size={19} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700 }}>Identity lock</div>
        </div>
        <IconBtn name="x" onClick={onClose} />
      </div>

      {locked ? (
        <React.Fragment>
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2)', margin: '6px 0 16px' }}>
            Enter your PIN to open the church community on this device. Your Bible and study stay open either way.</p>
          <input type="password" autoFocus value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN" style={inp} />
          {err ? <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', fontWeight: 600, marginTop: 8 }}>{err}</div> : null}
          <button onClick={doUnlock} disabled={busy} style={{ ...primary, marginTop: 14 }}>{busy ? '…' : 'Unlock'}</button>
        </React.Fragment>
      ) : !hasPin ? (
        <React.Fragment>
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2)', margin: '6px 0 8px' }}>
            Lock your identity with a PIN. Your key is encrypted on this device, so without the PIN nobody can open your church, read your messages, or post as you — and the screen shows only the Bible.</p>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, margin: '8px 0 0' }}>Be aware of what it does <b>not</b> do: someone who inspects this phone properly can still tell that you use TrinityOne and which church you belong to. The PIN protects what is <i>inside</i> your church, not the fact that you are in one.</p>
          <p style={{ fontFamily: 'var(--font-read)', fontSize: 13, lineHeight: 1.5, color: 'var(--ink-3)', margin: '0 0 16px' }}>
            If you forget the PIN, restore your 12-word recovery phrase to get back in. Keep those words safe.</p>
          <input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="Choose a PIN or passphrase" style={inp} />
          <input type="password" value={pin2} onChange={e => setPin2(e.target.value)} placeholder="Confirm PIN" style={{ ...inp, marginTop: 10 }} />
          {err ? <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', fontWeight: 600, marginTop: 8 }}>{err}</div> : null}
          <button onClick={doEnable} disabled={busy} style={{ ...primary, marginTop: 14 }}>{busy ? '…' : 'Turn on protection'}</button>
        </React.Fragment>
      ) : (
        <React.Fragment>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px', borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 12%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 28%, transparent)', margin: '6px 0 14px' }}>
            <Icon name="check" size={16} stroke={2.4} color="var(--sage)" />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>Church community is protected on this device.</span>
          </div>
          {remUntil > 0 ? (
            <div style={{ padding: '11px 13px', borderRadius: 12, background: 'color-mix(in oklab, var(--gold) 12%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 30%, transparent)', margin: '0 0 12px' }}>
              <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                This phone stays open without your PIN until <b>{new Date(remUntil * 1000).toLocaleDateString()}</b>.
                <br /><span style={{ color: 'var(--ink-3)' }}>Anyone who can unlock this phone can open your church.</span>
              </div>
              <button onClick={doForget} style={{ marginTop: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', borderRadius: 10, padding: '7px 12px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13 }}>Ask for my PIN again</button>
            </div>
          ) : null}
          {/* "Lock now" also clears the remembered seed (TrinityIdentity.lock does it) — otherwise restarting
              the app would undo the one control a member reaches for when someone is about to hold the phone. */}
          <button onClick={doLock} style={{ ...primary, background: 'var(--clay)' }}>Lock now</button>
          {!showOff ? (
            <button onClick={() => { setShowOff(true); setErr(''); }} style={ghost}>Turn off protection…</button>
          ) : (
            <div style={{ marginTop: 12, padding: 13, borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 9 }}>Enter your PIN to turn protection off. Your identity will be stored unencrypted again.</div>
              <input type="password" value={off} onChange={e => setOff(e.target.value)} placeholder="Your PIN" style={inp} />
              {err ? <div style={{ fontSize: 12.5, color: 'var(--clay-ink)', fontWeight: 600, marginTop: 8 }}>{err}</div> : null}
              <div style={{ display: 'flex', gap: 9, marginTop: 11 }}>
                <button onClick={() => { setShowOff(false); setOff(''); setErr(''); }} style={{ flex: 1, padding: 11, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Cancel</button>
                <button onClick={doDisable} disabled={busy} style={{ flex: 1, padding: 11, borderRadius: 12, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', opacity: busy ? 0.6 : 1 }}>{busy ? '…' : 'Turn off'}</button>
              </div>
            </div>
          )}
        </React.Fragment>
      )}
    </BottomSheet>
  );
}
window.CommunitySecuritySheet = CommunitySecuritySheet;

// ════════ Invite links ════════
// The APK / local dev run on a localhost origin (capacitor://localhost, http://localhost) that no one else
// can reach — so invite links must use the public app URL, not this device's origin.
function _inviteBase() {
  const o = (typeof location !== 'undefined' && location.origin) || '';
  const usable = /^https:\/\//i.test(o) && !/localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\./i.test(o);
  return usable ? o : 'https://app.trinityone.church';
}
function _inviteRelay() { const F = window.Fellowship; return (F && F.CANONICAL_RELAY) || 'wss://app.trinityone.church/relay'; }
function _inviteChurchNp(ctx) { return (ctx.church && /^npub1[0-9a-z]+$/.test(ctx.church.npub || '')) ? ctx.church.npub : ''; }

// SECURITY-AUDIT-2026-07-06 L4: a FRIEND invite is just a "join my church" link — it carries NO identity.
// The person who opens it mints their OWN key on-device and follows the church (and, if the church requires
// approval, is held pending until a steward admits them — like any other member). This removes the old flow
// where the inviter minted the invitee's seed and therefore knew their key.
function joinLinkFor(ctx) {
  const np = _inviteChurchNp(ctx);
  return _inviteBase() + '/?follow=' + np + '&relay=' + encodeURIComponent(_inviteRelay());
}
// The seed-carrying invite is now used ONLY for the guardian→child handoff (safeguarding v2): the parent OWNS
// the child account they set up and hands its key to the child's device. Kept for that path; the receiving
// device confirms before adopting (app.jsx), so a crafted link can't silently take over a fresh phone.
function inviteUrlFor(mnemonic, ctx) {
  const np = _inviteChurchNp(ctx);
  // SECURITY-AUDIT-2026-07-18: carry the BIP-39 seed in the URL FRAGMENT (#invite=), not the query (?invite=).
  // The fragment is never sent over the wire, so the cleartext seed no longer reaches the server / Cloudflare
  // tunnel / access logs on the initial GET (the client-side scrub only ran AFTER that request). follow/relay
  // stay in the query — they're not secret and the join flow reads them from location.search. app.jsx accepts
  // BOTH forms so previously-shared ?invite= links still work.
  const q = (np ? 'follow=' + np + '&' : '') + 'relay=' + encodeURIComponent(_inviteRelay());
  return _inviteBase() + '/?' + q + '#invite=' + encodeURIComponent(mnemonic);
}

// ── OLD PHONE: hand this account to a new one ─────────────────────────────────────────────────────────
// The counterpart to the restore screen's "I still have my old phone". This phone scans the NEW phone's
// throwaway public key, encrypts its 12 words to that key, and shows the result as a second QR.
//
// Nothing secret is ever drawn on screen: the first code is a public key, the second is a ciphertext only the
// new phone can open. That is why this can be done in a room full of people without care — the older idea of
// showing the 12 words (or a QR of them) put the whole account on screen for any camera in the room.
//
// This does NOT log this phone out. Both phones then hold the same account, which is what a member moving to
// a new phone actually expects; wiping the old one is a separate, deliberate act.
function MovePhoneSheet({ open, onClose, ctx }) {
  const [stage, setStage] = useIx('intro');   // intro | scan | show
  const [out, setOut] = useIx(null);          // { qr, code } sealed for the new phone
  const [err, setErr] = useIx('');
  const [copied, setCopied] = useIx(false);
  useIxE(() => { if (!open) { setStage('intro'); setOut(null); setErr(''); setCopied(false); } }, [open]);
  const onScan = async (text) => {
    setErr('');
    try { setOut(await window.TrinityIdentity.sealTransfer(text)); setStage('show'); }
    catch (e) { setErr((e && e.message) || 'That code wasn’t a TrinityOne transfer.'); setStage('intro'); }
  };
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="88%" z={60}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700 }}>Move to a new phone</div>
        <IconBtn name="x" onClick={onClose} />
      </div>
      {stage === 'intro' ? (<React.Fragment>
        <p style={{ fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '4px 0 16px', textWrap: 'pretty' }}>
          On the new phone, open TrinityOne and choose <b>“I’ve used it before” → “I still have my old phone”</b>. It will show a code. Scan it with this phone.
        </p>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 16px' }}>
          Afterwards both phones show a check code. Compare them before you finish — they must be identical.
        </p>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 16px' }}>
          Your 12 words are never shown or sent in the clear — they’re sealed so only that one phone can open them. You’ll stay signed in here too.
        </p>
        {err ? <div style={{ fontSize: 13.5, color: 'var(--clay-ink)', fontWeight: 700, marginBottom: 12 }}>{err}</div> : null}
        <button onClick={() => setStage('scan')} style={{ width: '100%', padding: 15, borderRadius: 15, border: 'none', cursor: 'pointer', background: 'var(--clay)', color: 'var(--on-clay)', fontFamily: 'var(--font-ui)', fontSize: 15.5, fontWeight: 700 }}>Scan the new phone</button>
      </React.Fragment>) : stage === 'scan' ? (
        <QRScanner onResult={onScan} onCancel={() => setStage('intro')} prompt="Point at the new phone’s code"
          onManual={onScan} manualPrompt="Paste the code from the new phone" />
      ) : (<React.Fragment>
        <p style={{ fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '4px 0 14px', textWrap: 'pretty' }}>
          Now point the <b>new</b> phone at this code.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <div style={{ width: 250, height: 250, background: '#fff', borderRadius: 20, padding: 12, boxShadow: 'var(--shadow-lg)', boxSizing: 'border-box' }}
            dangerouslySetInnerHTML={{ __html: (out && window.TrinityIdentity.qrSVG) ? window.TrinityIdentity.qrSVG(out.qr) : '' }} />
        </div>
        <button onClick={() => { try { if (navigator.clipboard && out) navigator.clipboard.writeText(out.qr); } catch (e) {} setCopied(true); setTimeout(() => setCopied(false), 2500); }}
          style={{ width: '100%', padding: 11, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700, color: copied ? 'var(--sage)' : 'var(--ink)', marginBottom: 12 }}>{copied ? 'Copied — paste it into the new phone' : 'Can’t scan? Copy the code instead'}</button>
        {/* This code now covers the WHOLE exchange — both keys and the sealed payload — so it cannot exist
            until the two phones have actually swapped codes, and it cannot be ground out in advance. The
            four-character version it replaced was derived from the new phone's public key alone (2^20, and
            public), which meant an attacker could hold up a QR that displayed the member's own code back at
            them while the words were sealed to the attacker. AUDIT-2026-07-26 S5. */}
        <div style={{ textAlign: 'center', marginBottom: 14, border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surface)', padding: '14px 12px' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '.5px' }}>CHECK CODE</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 25, fontWeight: 700, letterSpacing: '3px', color: 'var(--ink)', margin: '4px 0 2px' }}>{out ? out.code : ''}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5, marginTop: 4 }}>
            The new phone will show a check code once it has read this. It must be exactly the same as this one —
            all eight characters. If it isn’t, tap <b>They’re different</b> on the new phone: your account went
            somewhere else, and a steward should hear about it.
          </div>
        </div>
        <button onClick={onClose} style={{ width: '100%', padding: 13, borderRadius: 14, border: '1px solid var(--line)', cursor: 'pointer', background: 'var(--surface)', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>Done</button>
      </React.Fragment>)}
    </BottomSheet>
  );
}

function InviteSheet({ open, onClose, identity, ctx }) {
  // L4: a friend invite is a JOIN LINK — no identity handed over. They open it, their app mints its own key,
  // and they follow the church (held pending until a steward admits them if approval is required).
  const url = joinLinkFor(ctx);
  const qrSvg = (window.TrinityIdentity && window.TrinityIdentity.qrSVG) ? window.TrinityIdentity.qrSVG(url) : '';
  const shareInvite = async () => {
    if (!url) return;
    const Cap = window.Capacitor, P = Cap && Cap.Plugins;
    try {
      if (P && P.Share && Cap.isNativePlatform && Cap.isNativePlatform()) { await P.Share.share({ title: 'Join ' + ((ctx.church && ctx.church.name) || 'our church') + ' on TrinityOne', text: 'Tap to join — no email or phone needed:', url }); return; }
      if (navigator.share) { await navigator.share({ title: 'TrinityOne invite', text: 'Tap to join our church:', url }); return; }
    } catch (e) {}
    try { if (navigator.clipboard) await navigator.clipboard.writeText(url); } catch (e) {}
    ctx.toast('Invite link copied');
  };
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="84%" z={60}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700 }}>Invite a member</div>
        <IconBtn name="x" onClick={onClose} />
      </div>
      <p style={{ fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '4px 0 18px', textWrap: 'pretty' }}>
        Have them scan this (or share the link) to join {(ctx.church && ctx.church.name) || 'your church'}. They set up their own private key on their phone — no email or phone number needed.</p>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
        <div style={{ padding: 16, borderRadius: 22, background: '#fff', boxShadow: 'var(--shadow-lg)', width: 196, height: 196, boxSizing: 'border-box', display: 'flex' }}
          dangerouslySetInnerHTML={{ __html: qrSvg }} />
      </div>
      <button onClick={shareInvite} style={{ width: '100%', padding: 15, borderRadius: 15, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Icon name="share" size={17} color="#fff" /> Share invite link</button>
    </BottomSheet>
  );
}
window.InviteSheet = InviteSheet;

// ════════ Relays sheet (network only) ════════
const SUGGESTED_RELAYS = [
  'relay.trinityone.app',
  'relay.damus.io',
  'nos.lol',
  'relay.snort.social',
  'nostr.wine',
  'relay.primal.net',
];

function normalizeRelay(raw) {
  let v = (raw || '').trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^wss?:\/\//, '').replace(/\/+$/, '');
  // must look like a domain (has a dot, no spaces)
  if (/\s/.test(v) || !/^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/.test(v)) return null;
  return v;
}

function RelaysSheet({ open, onClose, ctx }) {
  const FS = window.Fellowship;
  // REAL source of truth: the live transport's configured relays (full ws/wss URLs)
  const fromReal = () => FS && FS.relays ? FS.relays.map(u => ({ url: u, status: 'on' })) : (window.TrinityData.RELAYS || []);
  const [list, setList] = useIx(null);
  const [adding, setAdding] = useIx(false);
  const [url, setUrl] = useIx('');
  const [err, setErr] = useIx('');

  // (re)seed each time the sheet opens, and follow live relay changes
  useIxE(() => {
    if (!open) return;
    setList(fromReal()); setAdding(false); setUrl(''); setErr('');
    const refresh = () => setList(fromReal());
    window.addEventListener('trinity-relays', refresh);
    return () => window.removeEventListener('trinity-relays', refresh);
  }, [open]);

  const rows = list || fromReal();
  const bare = (u) => (u || '').replace(/^wss?:\/\//, '');

  const toggle = (u) => setList(rows.map(r => r.url === u ? { ...r, status: r.status === 'on' ? 'off' : 'on' } : r));  // visual only
  const remove = (u) => { if (FS && FS.removeRelay) { FS.removeRelay(u); setList(fromReal()); } else setList(rows.filter(r => r.url !== u)); };

  const commitAdd = (raw) => {
    const v = normalizeRelay(raw);
    if (!v) { setErr('Enter a valid relay address, e.g. relay.example.com'); return; }
    if (rows.some(r => bare(r.url) === v)) { setErr('That relay is already in your list.'); return; }
    const full = 'wss://' + v;
    if (FS && FS.addRelay) FS.addRelay(full); else setList([...rows, { url: full, status: 'on' }]);
    setList(fromReal()); setUrl(''); setErr(''); setAdding(false);
    ctx.toast('Connected to ' + v);
  };

  const remaining = SUGGESTED_RELAYS.filter(s => !rows.some(r => bare(r.url) === s));

  return (
    <BottomSheet open={open} onClose={onClose} z={60}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700 }}>Relays</div>
        <IconBtn name="x" onClick={onClose} />
      </div>
      <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, margin: '4px 0 16px' }}>
        Relays carry your church’s messages across Nostr. They’re set up by the churches you join — you connect to a church’s relay automatically when you scan its invite.</p>

      {!rows.length ? (
        <div style={{ display: 'flex', gap: 10, padding: '14px 15px', borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <Icon name="globe" size={18} color="var(--ink-3)" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>No relay yet. Join a church — scan its invite QR — and you’ll connect to its relay here automatically.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => (
            <div key={r.url} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <Icon name="globe" size={17} color={r.status === 'on' ? 'var(--sage)' : 'var(--ink-3)'} />
              <span style={{ flex: 1, minWidth: 0, fontFamily: 'monospace', fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bare(r.url)}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: r.status === 'on' ? 'var(--sage)' : 'var(--ink-3)' }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: r.status === 'on' ? 'var(--sage)' : 'var(--ink-3)' }} />
                {r.status === 'on' ? 'Connected' : 'Off'}</span>
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}
window.RelaysSheet = RelaysSheet;
