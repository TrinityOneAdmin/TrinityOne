// identity.jsx — onboarding, profile sheet, member card
const { useState: useId, useEffect: useIdE } = React;

// ════════ First-run identity moment ════════
function IdentityOnboarding({ open, identity, onSave, onSkip }) {
  const D = window.TrinityData;
  const [name, setName] = useId('');
  const [av, setAv] = useId({ kind: 'symbol', color: '#5E8C6A', symbol: 'olive' });
  useIdE(() => { if (open) { setName(''); setAv({ kind: 'symbol', color: '#5E8C6A', symbol: 'olive' }); } }, [open]);
  if (!open) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 70, background: 'var(--paper)', display: 'flex', flexDirection: 'column',
      animation: 'trinityFade .4s ease both' }}>
      {/* warm header */}
      <div style={{ paddingTop: 64, paddingBottom: 22, textAlign: 'center', position: 'relative', overflow: 'hidden',
        background: 'radial-gradient(120% 80% at 50% -20%, var(--gold-tint), transparent 55%)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <UserAvatar av={av} name={name} size={84} />
        </div>
        <h1 style={{ margin: '0 14px', fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, letterSpacing: '-.5px', lineHeight: 1.1 }}>
          What should your<br/>church call you?</h1>
        <p style={{ margin: '10px 26px 0', fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.5, color: 'var(--ink-2)', textWrap: 'pretty' }}>
          A name helps your church family recognise you and makes the chat feel like community. No email, no phone — you can stay private if you’d rather.</p>
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '6px 22px 12px' }}>
        {/* name field */}
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '8px 0 8px' }}>DISPLAY NAME</label>
        <input value={name} onChange={e => setName(e.target.value.slice(0, 24))} autoFocus placeholder="e.g. Maria" style={{
          width: '100%', height: 54, border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surface)',
          padding: '0 18px', fontSize: 18, fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--ink)', outline: 'none',
          boxShadow: 'var(--shadow)',
        }} />

        {/* avatar */}
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '22px 0 12px' }}>CHOOSE YOUR MARK</label>
        <AvatarPicker value={av} name={name} onChange={setAv} />
      </div>

      {/* actions */}
      <div style={{ padding: '12px 22px 26px', borderTop: '1px solid var(--line-2)', background: 'var(--paper)' }}>
        <button onClick={() => onSave({ name: name.trim(), avatar: av })} style={{
          width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: 'pointer', marginBottom: 10,
          background: name.trim() ? 'var(--clay)' : 'var(--surface-2)', color: name.trim() ? '#fff' : 'var(--ink-3)',
          boxShadow: name.trim() ? 'var(--shadow)' : 'none', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)',
        }}>{name.trim() ? `Continue as ${name.trim()}` : 'Continue without a name'}</button>
        <button onClick={onSkip} style={{
          width: '100%', padding: 12, borderRadius: 14, border: 'none', background: 'none', cursor: 'pointer',
          color: 'var(--ink-3)', fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--font-ui)',
        }}>Skip setup for now</button>
      </div>
    </div>
  );
}
window.IdentityOnboarding = IdentityOnboarding;

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
  const backedUp = !!(identity && identity.backedUp);

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
            background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)' }}>
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
          background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
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
  const [name, setName] = useId(identity.name || '');
  const [av, setAv] = useId(identity.avatar);
  useIdE(() => { if (open) { setEdit(false); setName(identity.name || ''); setAv(identity.avatar); } }, [open, identity]);

  const named = !!(identity.name && identity.name.trim());

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
            <button onClick={() => { onSave({ name: name.trim(), avatar: av }); setEdit(false); ctx.toast('Profile saved'); }} style={{
              border: 'none', background: 'var(--clay)', color: '#fff', padding: '9px 16px', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Save</button>
          </div>
        </div>
        <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '14px 22px 30px' }}>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 8px' }}>DISPLAY NAME</label>
          <input value={name} onChange={e => setName(e.target.value.slice(0, 24))} placeholder="Your name (optional)" style={{
            width: '100%', height: 52, border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surface)',
            padding: '0 16px', fontSize: 17, fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--ink)', outline: 'none', boxShadow: 'var(--shadow)' }} />
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '22px 0 12px' }}>YOUR MARK</label>
          <AvatarPicker value={av} name={name} onChange={setAv} />
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
          <IconBtn name="chevD" onClick={onClose} />
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
              <button onClick={() => setEdit(true)} style={{ border: 'none', background: 'var(--clay)', color: '#fff', padding: '12px 22px',
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

        {/* Your wallet — the member's own, always reachable (add / give / withdraw), church-independent */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '16px 4px 9px' }}>YOUR WALLET</div>
        <Group>
          <Row icon="bolt" label="Lightning wallet" sub={`${Number(wbal || 0).toLocaleString('en-US')} sats · add funds or withdraw any time`} accent="var(--gold)" onClick={() => { onClose && onClose(); ctx.openWallet(); }} />
        </Group>

        {/* settings */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.6px', margin: '16px 4px 9px' }}>SETTINGS</div>
        <Group>
          <Row icon="bell" label="Notifications" sub="Choose what you’re alerted about" accent="var(--clay)" onClick={() => { onClose && onClose(); ctx.openNotifSettings(); }} />
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
          <Row icon="key" label="Public key" sub={identity.npub.slice(0, 24) + '…'} accent="var(--gold)" onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(identity.npub).catch(() => {}); ctx.toast('Public key (npub) copied'); }} />
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
          <Row icon="globe" label="Relays" sub={`${(window.Fellowship && window.Fellowship.relays || D.RELAYS).length} connected · Nostr`} onClick={() => ctx.openRelays()} />
        </Group>
        {/* "Start a new identity" hidden for the pilot — too easy to wipe a key by accident */}
      </div>
    </Overlay>
  );
}
window.ProfileSheet = ProfileSheet;
