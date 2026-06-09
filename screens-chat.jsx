// screens-chat.jsx — "Chat" tab: anonymous church + life-group messaging over Nostr.
// UI is wired; transport is mock for now. Identity is REAL when lib/identity.js has
// derived a key (window.TrinityIdentity), otherwise falls back to the mock identity.
const { useState: useC, useEffect: useCE, useRef: useCR } = React;

// Giving is PARKED for the pilot's first months (focus on chat first). Flip to true to bring it
// back -- the whole Lightning giving flow stays built behind this flag.
const GIVING_ON = false;

// reflect the live (real-or-mock) anonymous identity; re-render on regeneration
function useIdentity() {
  const [, force] = useC(0);
  useCE(() => {
    const h = () => force(x => x + 1);
    window.addEventListener('trinity-identity', h);
    window.addEventListener('trinity-profiles', h);
    return () => { window.removeEventListener('trinity-identity', h); window.removeEventListener('trinity-profiles', h); };
  }, []);
  return (window.TrinityIdentity && window.TrinityIdentity.current) || window.TrinityData.CHAT_IDENTITY;
}
// the current user's chosen display name (kind-0) or the anonymous handle
function myName(id) { return (window.Fellowship && window.Fellowship.myProfile && window.Fellowship.myProfile.name) || id.handle; }
// the current user's avatar (chosen symbol/monogram, or a deterministic default)
function myAvatar(id) {
  const FS = window.Fellowship;
  if (FS && FS.myPubkey && FS.displayFor) { const d = FS.displayFor(FS.myPubkey); if (d.av) return d.av; }
  return { kind: 'monogram', color: (id && id.color) || '#5E8C6A' };
}
function avOf(d) { return d.av || { kind: 'monogram', color: d.color || '#5E8C6A' }; }

// avatar = profile picture if set, else a colored circle with the name's initial
function Avatar({ handle, color, size = 38, src }) {
  const [err, setErr] = useC(false);
  if (src && !err) {
    return <img src={src} alt="" onError={() => setErr(true)}
      style={{ width: size, height: size, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }} />;
  }
  const word = (handle || 'Anonymous').split(' ').slice(-1)[0];
  return (
    <div style={{
      width: size, height: size, borderRadius: 999, flexShrink: 0,
      background: `linear-gradient(150deg, ${color}, color-mix(in oklab, ${color} 60%, #16120c))`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: size * 0.4,
    }}>{(word[0] || '?').toUpperCase()}</div>
  );
}

// ── Identity manager sheet (anonymous Nostr key: recovery / restore / steward invite) ──
function NostrSheet({ open, onClose, ctx, initialPane }) {
  const id = useIdentity();
  const [relayList, setRelayList] = useC(null);   // live relay status from the transport
  const [pane, setPane] = useC('main');      // main | recovery | restore | invite
  const [words, setWords] = useC(null);      // revealed recovery phrase
  const [restoreText, setRestoreText] = useC('');
  const [invite, setInvite] = useC(null);    // {mnemonic, profile}
  const [nameInput, setNameInput] = useC('');
  const [avInput, setAvInput] = useC(null);   // editable mark in the profile pane
  const [relayInput, setRelayInput] = useC('');
  const ID = window.TrinityIdentity;
  const FS = window.Fellowship;

  useCE(() => {
    if (!open) return;
    setPane(initialPane || 'main'); setWords(null); setRestoreText('');
    setInvite(initialPane === 'invite' && ID && ID.makeInvite ? ID.makeInvite() : null);
    setNameInput((FS && FS.myProfile && FS.myProfile.name) || '');
    setAvInput(myAvatar(id));
  }, [open]);

  const saveProfile = async () => {
    if (!(FS && FS.setProfile)) { ctx.toast('Chat transport not ready'); return; }
    await FS.setProfile({ name: nameInput, av: avInput || undefined });
    ctx.toast(nameInput.trim() ? 'Profile saved' : 'Name cleared'); setPane('main');
  };

  // poll real relay connection status while the sheet is open
  useCE(() => {
    if (!open) return;
    if (!(window.Fellowship && window.Fellowship.relayStatus)) { setRelayList(window.TrinityData.RELAYS); return; }
    let live = true;
    const load = () => window.Fellowship.relayStatus().then(r => { if (live) setRelayList(r); }).catch(() => {});
    load(); const iv = setInterval(load, 4000);
    window.addEventListener('trinity-relays', load);
    return () => { live = false; clearInterval(iv); window.removeEventListener('trinity-relays', load); };
  }, [open]);
  const addRelay = () => { const u = relayInput.trim(); if (!/^wss?:\/\//i.test(u)) { ctx.toast('Use a ws:// or wss:// URL'); return; } FS.addRelay(u); setRelayInput(''); ctx.toast('Relay added'); };

  const copyNpub = () => { if (ID && ID.copyNpub) ID.copyNpub(); else if (navigator.clipboard) navigator.clipboard.writeText(id.npub).catch(() => {}); ctx.toast('Public key copied'); };
  const regen = async () => { if (ID && ID.regenerate) { await ID.regenerate(); ctx.toast('New anonymous identity created'); } };
  const reveal = async () => { if (ID && ID.exportMnemonic) { const m = await ID.exportMnemonic(); setWords(m ? m.split(' ') : []); } };
  const doRestore = async () => {
    try { await ID.importMnemonic(restoreText); ctx.toast('Identity restored'); setPane('main'); }
    catch (e) { ctx.toast(e.message || 'Invalid recovery phrase'); }
  };
  const startInvite = () => { if (ID && ID.makeInvite) setInvite(ID.makeInvite()); setPane('invite'); };
  const copyText = (t, msg) => { if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {}); ctx.toast(msg); };

  const Header = ({ title, back }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        {back ? <button onClick={() => setPane('main')} style={{ width: 34, height: 34, borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="chevL" size={19} /></button>
          : <div style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--clay-soft)', color: 'var(--clay-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="shield" size={21} /></div>}
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700 }}>{title}</div>
      </div>
      <IconBtn name="x" onClick={onClose} />
    </div>
  );
  const rowBtn = (icon, label, sub, onClick, tone) => (
    <button onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 14,
      border: '1px solid var(--line)', background: 'var(--surface-2)', cursor: 'pointer', color: tone || 'var(--ink)', textAlign: 'left' }}>
      <Icon name={icon} size={20} color={tone || 'var(--ink-2)'} />
      <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14.5 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{sub}</div></div>
      <Icon name="chevR" size={17} color="var(--ink-3)" />
    </button>
  );

  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="90%">
      {pane === 'main' && <React.Fragment>
        <Header title="You’re anonymous" />
        <p style={{ fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '4px 0 16px', textWrap: 'pretty' }}>
          Chat runs on <b style={{ color: 'var(--ink)' }}>Nostr</b> — no email, no phone, no account. Just a key on your device. Your church sees a friendly handle, never you.
        </p>
        <div style={{ borderRadius: 18, padding: 16, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <UserAvatar av={myAvatar(id)} name={myName(id)} size={52} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>{myName(id)}</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 4, background: 'var(--clay-soft)', color: 'var(--clay-ink)', padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700 }}>
                <Icon name="shield" size={12} /> {myName(id) === id.handle ? 'Anonymous member' : 'TrinityOne member'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 9, marginTop: 14 }}>
            <button onClick={copyNpub} style={miniBtn()}><Icon name="copy" size={15} /> Copy npub</button>
            <button onClick={regen} style={miniBtn()}><Icon name="refresh" size={15} /> New identity</button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 16 }}>
          {rowBtn('book', 'Help & guides', 'Simple guides — read aloud if you like', () => { onClose(); ctx.openHelp('index'); }, 'var(--clay)')}
          {rowBtn('pen', 'Display name', myName(id) === id.handle ? 'Choose a name your church sees' : myName(id), () => setPane('profile'))}
          {rowBtn('key', 'Recovery phrase', 'Back up your 12 words — your only way to restore', () => setPane('recovery'))}
          {rowBtn('refresh', 'Restore an identity', 'Paste a 12-word phrase from another device', () => setPane('restore'))}
          {rowBtn('qr', 'Invite a member', 'Hand someone a ready-made anonymous identity', startInvite, 'var(--clay)')}
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '4px 0 9px' }}>RELAYS</div>
        {relayList === null ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '4px 2px 8px' }}>Checking…</div> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          {(relayList || []).map(r => (
            <div key={r.url} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <Icon name="globe" size={17} color={r.status === 'on' ? 'var(--sage)' : 'var(--ink-3)'} />
              <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: r.status === 'on' ? 'var(--sage)' : 'var(--ink-3)' }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: r.status === 'on' ? 'var(--sage)' : 'var(--ink-3)' }} />{r.status === 'on' ? 'Connected' : 'Off'}</span>
              {FS && FS.removeRelay && (relayList || []).length > 1 ? <button onClick={() => FS.removeRelay(r.url)} title="Remove relay" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 0 }}><Icon name="x" size={15} /></button> : null}
            </div>
          ))}
        </div>
        {FS && FS.addRelay ? (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input value={relayInput} onChange={e => setRelayInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addRelay(); }}
              placeholder="wss://relay.yourchurch.org" style={{ flex: 1, minWidth: 0, height: 40, padding: '0 12px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', outline: 'none', fontFamily: 'monospace', fontSize: 13, color: 'var(--ink)' }} />
            <button onClick={addRelay} style={{ border: 'none', background: 'var(--clay)', color: '#fff', padding: '0 14px', borderRadius: 12, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', flexShrink: 0 }}>Add</button>
          </div>
        ) : null}
      </React.Fragment>}

      {pane === 'profile' && <React.Fragment>
        <Header title="Name & mark" back />
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, margin: '2px 0 16px' }}>
          Pick a name and a mark your church sees instead of an anonymous handle. You stay anonymous — no email or phone, just a name on your key. Leave the name blank to go back to <b style={{ color: 'var(--ink)' }}>{id.handle}</b>.
        </p>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 8px' }}>DISPLAY NAME</div>
        <input value={nameInput} onChange={e => setNameInput(e.target.value)} maxLength={40} placeholder="e.g. Maria from Tuesday group"
          style={{ width: '100%', boxSizing: 'border-box', height: 50, padding: '0 14px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface-2)', outline: 'none', fontSize: 16, color: 'var(--ink)', fontFamily: 'var(--font-ui)', marginBottom: 20 }} />
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 12px' }}>YOUR MARK</div>
        <AvatarPicker value={avInput || { kind: 'monogram', color: id.color }} name={nameInput} onChange={setAvInput} />
        <button onClick={saveProfile} style={{ ...primaryBtn(), marginTop: 18 }}><Icon name="check" size={18} stroke={2.4} color="#fff" /> Save profile</button>
      </React.Fragment>}

      {pane === 'recovery' && <React.Fragment>
        <Header title="Recovery phrase" back />
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'color-mix(in oklab, var(--clay) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 28%, transparent)', borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
          <Icon name="lock" size={18} color="var(--clay-ink)" />
          <div style={{ fontSize: 13, color: 'var(--clay-ink)', lineHeight: 1.45, fontWeight: 600 }}>These 12 words <b>are</b> your identity & wallet. Anyone with them controls it. Write them down offline — never share or screenshot them.</div>
        </div>
        {!words ? (
          <button onClick={reveal} style={primaryBtn()}><Icon name="key" size={18} color="#fff" /> Reveal my 12 words</button>
        ) : words.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5, padding: 20 }}>No phrase stored on this device (web preview uses a temporary key).</div>
        ) : (
          <React.Fragment>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
              {words.map((w, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', width: 16 }}>{i + 1}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--ink)' }}>{w}</span>
                </div>
              ))}
            </div>
            <button onClick={() => copyText(words.join(' '), 'Phrase copied — store it safely')} style={miniBtn()}><Icon name="copy" size={15} /> Copy phrase</button>
            <button onClick={() => setPane('main')} style={{ ...primaryBtn(), marginTop: 10 }}><Icon name="check" size={18} stroke={2.4} color="#fff" /> I’ve saved it</button>
          </React.Fragment>
        )}
      </React.Fragment>}

      {pane === 'restore' && <React.Fragment>
        <Header title="Restore an identity" back />
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, margin: '2px 0 12px' }}>Paste the 12-word recovery phrase. This replaces the identity on this device.</p>
        <textarea value={restoreText} onChange={e => setRestoreText(e.target.value)} rows={3} placeholder="word1 word2 word3 …"
          style={{ width: '100%', boxSizing: 'border-box', resize: 'none', padding: '12px 14px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface-2)', outline: 'none', fontFamily: 'monospace', fontSize: 14, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 12 }} />
        <button disabled={!restoreText.trim()} onClick={doRestore} style={{ ...primaryBtn(), opacity: restoreText.trim() ? 1 : .5 }}><Icon name="refresh" size={18} color="#fff" /> Restore identity</button>
      </React.Fragment>}

      {pane === 'invite' && invite && <React.Fragment>
        <Header title="Invite a member" back />
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, margin: '2px 0 14px' }}>A fresh anonymous identity for someone to import. They scan this (or paste the phrase) under <b style={{ color: 'var(--ink)' }}>Restore an identity</b>. This is <b>not</b> your own key.</p>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <div style={{ background: '#fff', padding: 12, borderRadius: 18, boxShadow: 'var(--shadow)', width: 196, height: 196 }}
            dangerouslySetInnerHTML={{ __html: ID.qrSVG(invite.mnemonic) }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, justifyContent: 'center', marginBottom: 14 }}>
          <Avatar handle={invite.profile.handle} color={invite.profile.color} size={28} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>{invite.profile.handle}</span>
        </div>
        <button onClick={() => copyText(invite.mnemonic, 'Invite phrase copied')} style={miniBtn()}><Icon name="copy" size={15} /> Copy phrase to share</button>
        <button onClick={startInvite} style={{ ...miniBtn(), marginTop: 9 }}><Icon name="refresh" size={15} /> Generate another</button>
      </React.Fragment>}
    </BottomSheet>
  );
}
function primaryBtn() {
  return { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: 15,
    borderRadius: 15, border: 'none', cursor: 'pointer', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 15, fontFamily: 'var(--font-ui)' };
}
function miniBtn() {
  return { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px',
    borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer',
    color: 'var(--ink)', fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-ui)' };
}

// ── group list (the Chat tab body) ──
function ChatScreen({ ctx }) {
  const D = window.TrinityData;
  const idParam = new URLSearchParams(location.search).get('identity'); // main|recovery|restore|invite
  const [nostr, setNostr] = useC(!!idParam);
  const chatParam = new URLSearchParams(location.search).get('chat'); // 'groups' | 'giving'
  const [view, setView] = useC(GIVING_ON && chatParam === 'giving' ? 'giving' : 'groups');
  const id = useIdentity();
  const churchGroups = D.GROUPS.filter(g => g.church === ctx.church.id);   // groups for the active church
  const live = !!(window.Fellowship && window.Fellowship.subscribeGroups);
  const relayCount = live ? window.Fellowship.relays.length : D.RELAYS.filter(r => r.status === 'on').length;
  const [activity, setActivity] = useC({});   // gid -> { text, ts }
  const [unread, setUnread] = useC({});        // gid -> count
  const [q, setQ] = useC('');                  // chat search query
  const msgBuf = useCR([]);                     // recent messages buffer (for search)

  // watch every group for last-message previews + unread badges
  useCE(() => {
    if (!live) return;
    const ids = churchGroups.map(g => g.id);
    const seen = lsGet('trinityone.chatSeen', {});
    const unsub = window.Fellowship.subscribeGroups(ids, (gid, e) => {
      msgBuf.current.unshift({ gid, e });        // buffer for search
      if (msgBuf.current.length > 400) msgBuf.current.length = 400;
      setActivity(prev => {
        if (prev[gid] && prev[gid].ts >= e.created_at) return prev;
        const k = (e.tags.find(t => t[0] === 'k') || [])[1];
        const preview = k === 'verse' ? '📖 Shared a verse' : k === 'devotional' ? '🌅 Shared a devotional'
          : k === 'note' ? '📝 Shared a note' : k === 'prayer' ? '🙏 ' + e.content : e.content;
        return { ...prev, [gid]: { text: preview, ts: e.created_at } };
      });
      if (e.created_at > (seen[gid] || 0) && e.pubkey !== window.Fellowship.myPubkey)
        setUnread(prev => ({ ...prev, [gid]: (prev[gid] || 0) + 1 }));
    });
    return () => unsub();
  }, [ctx.church.id]);   // re-subscribe when the active church changes

  const openGroup = (g) => {
    const seen = lsGet('trinityone.chatSeen', {});
    seen[g.id] = Math.floor(Date.now() / 1000); lsSet('trinityone.chatSeen', seen);
    setUnread(prev => ({ ...prev, [g.id]: 0 }));
    ctx.openGroup(g);
  };

  const ql = q.trim().toLowerCase();
  const groupHits = ql ? churchGroups.filter(g => g.name.toLowerCase().includes(ql) || g.kind.toLowerCase().includes(ql)) : [];
  const msgHits = ql ? msgBuf.current
    .filter(({ e }) => searchableText(e).toLowerCase().includes(ql))
    .slice(0, 40)
    .map(({ gid, e }) => ({ e, group: D.GROUPS.find(g => g.id === gid) }))
    .filter(x => x.group) : [];
  const hi = (txt) => {
    const i = (txt || '').toLowerCase().indexOf(ql);
    if (i < 0 || !ql) return txt;
    return (<React.Fragment>{txt.slice(0, i)}<mark style={{ background: 'var(--hl-yellow)', color: 'inherit', borderRadius: 3, padding: '0 2px' }}>{txt.slice(i, i + ql.length)}</mark>{txt.slice(i + ql.length)}</React.Fragment>);
  };

  return (
    <ScreenScroll>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, animation: 'trinityFade .5s ease both' }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, letterSpacing: '-.5px' }}>Chat</h1>
        <IconBtn name="plus" onClick={() => ctx.toast(view === 'giving' ? 'Load funds or give' : 'Create or join a group')} />
      </div>
      <div style={{ marginBottom: GIVING_ON ? 16 : 20, animation: 'trinityFade .5s ease .04s both' }}>
        <ChurchPill ctx={ctx} />
      </div>

      {/* segmented: Groups / Giving (giving parked for the pilot) */}
      {GIVING_ON ? (
      <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 15, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 20 }}>
        {[['groups', 'Groups', 'chat'], ['giving', 'Giving', 'bolt']].map(([gid, label, ic]) => {
          const on = view === gid;
          return (
            <button key={gid} onClick={() => setView(gid)} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px',
              borderRadius: 11, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14,
              background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--clay)' : 'var(--ink-2)',
              boxShadow: on ? 'var(--shadow)' : 'none', transition: 'all .2s',
            }}><Icon name={ic} size={17} stroke={on ? 2.1 : 1.8} fill={ic === 'bolt' && on} />{label}</button>
          );
        })}
      </div>
      ) : null}

      {GIVING_ON && view === 'giving' ? (
        <GivingView ctx={ctx} balance={ctx.walletSats} setBalance={ctx.setWalletSats} history={ctx.giving} setHistory={ctx.setGiving} />
      ) : (
      <React.Fragment>
      {/* search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', height: 46, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', marginBottom: 18 }}>
        <Icon name="study" size={19} color="var(--ink-3)" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search messages & groups…" style={{ flex: 1, border: 'none', background: 'none', outline: 'none', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)' }} />
        {q ? <button onClick={() => setQ('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="x" size={17} /></button> : null}
      </div>

      {ql ? (
      <div style={{ animation: 'trinityFade .3s ease both' }}>
        {groupHits.length === 0 && msgHits.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ink-3)' }}>
            <Icon name="study" size={34} color="var(--ink-3)" />
            <p style={{ fontFamily: 'var(--font-read)', fontSize: 16, marginTop: 10 }}>No matches for “{q}”</p>
          </div>
        ) : null}
        {groupHits.length ? <SectionLabel>Groups</SectionLabel> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: groupHits.length ? 22 : 0 }}>
          {groupHits.map(g => (
            <div key={g.id} onClick={() => openGroup(g)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 13, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', boxShadow: 'var(--shadow)' }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, background: `color-mix(in oklab, ${g.accent} 16%, var(--surface))`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: g.accent, flexShrink: 0 }}><Icon name={g.prayer ? 'pray' : 'chat'} size={22} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>{hi(g.name)}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{g.kind} · {g.members} members</div>
              </div>
              <Icon name="chevR" size={17} color="var(--ink-3)" />
            </div>
          ))}
        </div>
        {msgHits.length ? <SectionLabel>Messages</SectionLabel> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {msgHits.map(({ e, group }, i) => {
            const d = window.Fellowship.displayFor(e.pubkey);
            const me = e.pubkey === window.Fellowship.myPubkey;
            return (
              <div key={i} onClick={() => openGroup(group)} style={{ padding: 13, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--line)', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <UserAvatar av={avOf(d)} name={d.handle} size={20} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-2)' }}>{me ? 'You' : d.handle}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>· {group.name}</span>
                </div>
                <p style={{ margin: 0, fontFamily: 'var(--font-read)', fontSize: 15, lineHeight: 1.45, color: 'var(--ink)' }}>{hi(searchableText(e))}</p>
              </div>
            );
          })}
        </div>
      </div>
      ) : (
      <React.Fragment>
      {/* anonymous identity banner — opens the ProfileSheet hub */}
      <button onClick={() => ctx.openProfile()} style={{
        width: '100%', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--line)',
        background: 'var(--surface)', borderRadius: 20, padding: 14, marginBottom: 22, boxShadow: 'var(--shadow)',
        display: 'flex', alignItems: 'center', gap: 13, animation: 'trinityFade .5s ease .05s both',
      }}>
        <UserAvatar av={myAvatar(id)} name={myName(id)} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{myName(id)}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--clay-soft)', color: 'var(--clay-ink)', padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 800, letterSpacing: '.3px' }}>
              <Icon name="shield" size={11} /> ANON</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--ink-3)', fontSize: 12, marginTop: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--sage)' }} />
            {relayCount} relay{relayCount === 1 ? '' : 's'} · Nostr · tap to manage
          </div>
        </div>
        <Icon name="chevR" size={18} color="var(--ink-3)" />
      </button>

      <SectionLabel>Your groups</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, animation: 'trinityFade .5s ease .1s both' }}>
        {churchGroups.map(g => (
          <div key={g.id} onClick={() => openGroup(g)} style={{
            display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18,
            background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', boxShadow: 'var(--shadow)',
          }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{ width: 50, height: 50, borderRadius: 16, background: `color-mix(in oklab, ${g.accent} 16%, var(--surface))`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: g.accent }}>
                <Icon name={g.prayer ? 'pray' : 'chat'} size={25} stroke={1.8} />
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--ink-3)', flexShrink: 0 }}>{live ? (activity[g.id] ? relTime(activity[g.id].ts) : '') : g.when}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
                <span style={{ fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{live ? (activity[g.id] ? activity[g.id].text : 'No messages yet') : g.last}</span>
                {(live ? unread[g.id] : g.unread) ? <span style={{ flexShrink: 0, minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: 'var(--clay)', color: '#fff', fontSize: 11.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{live ? unread[g.id] : g.unread}</span> : null}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', padding: '1px 7px', borderRadius: 999, fontWeight: 600 }}>{g.kind}</span>
                · {g.members} members
              </div>
            </div>
          </div>
        ))}
      </div>
      </React.Fragment>
      )}
      </React.Fragment>
      )}

      <NostrSheet open={nostr} onClose={() => setNostr(false)} ctx={ctx} initialPane={idParam} />
    </ScreenScroll>
  );
}

// ── message bubble ──
const REACT_EMOJIS = ['🙏', '❤️', '🔥', '🙌', '✨'];

// reaction pills + a small react button (with emoji picker), shown under each bubble
function ReactionsRow({ summary, onReact, pickerOpen, onOpenPicker, live }) {
  if (!live) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
      {summary.map(r => (
        <button key={r.emoji} onClick={() => onReact(r.emoji)} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, cursor: 'pointer',
          border: r.mine ? '1px solid var(--clay)' : '1px solid var(--line)',
          background: r.mine ? 'var(--clay-soft)' : 'var(--surface-2)', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-2)' }}>
          <span style={{ fontSize: 13 }}>{r.emoji}</span> {r.count}
        </button>
      ))}
      <div style={{ position: 'relative' }}>
        <button onClick={onOpenPicker} title="React" style={{
          width: 28, height: 22, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface-2)',
          cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: .8 }}>
          <Icon name="heart" size={13} /></button>
        {pickerOpen ? (
          <div style={{ position: 'absolute', bottom: 28, left: 0, zIndex: 5, display: 'flex', gap: 2, padding: '6px 8px', borderRadius: 14,
            background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)' }}>
            {REACT_EMOJIS.map(e => <button key={e} onClick={() => onReact(e)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, padding: '2px 4px', lineHeight: 1 }}>{e}</button>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Bubble({ m, ctx, summary, onReact, pickerOpen, onOpenPicker, live }) {
  const me = m.me;
  const bg = me ? 'var(--clay)' : 'var(--surface)';
  const fg = me ? '#fff' : 'var(--ink)';
  const react = <ReactionsRow summary={summary} onReact={onReact} pickerOpen={pickerOpen} onOpenPicker={onOpenPicker} live={live} />;

  if (m.kind === 'verse') {
    return (
      <Row me={me} m={m}>
        <div onClick={() => ctx.openShare(m.verse)} style={{
          maxWidth: 270, borderRadius: 18, padding: 0, overflow: 'hidden', cursor: 'pointer',
          background: 'linear-gradient(155deg, var(--clay), var(--clay-deep))', color: '#fff', boxShadow: 'var(--shadow)',
        }}>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: '.6px', opacity: .9, marginBottom: 7 }}>
              <Icon name="sparkle" size={13} stroke={2} color="#fff" /> SHARED A VERSE</div>
            <p style={{ fontFamily: 'var(--font-read)', fontSize: 17, lineHeight: 1.42, margin: '0 0 9px', fontWeight: 500, textWrap: 'pretty' }}>“{m.verse.text}”</p>
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>{m.verse.ref} · {m.verse.version}</div>
          </div>
        </div>
        {react}
      </Row>
    );
  }

  if (m.kind === 'prayer') {
    return (
      <Row me={me} m={m}>
        <div style={{ maxWidth: 280 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 800, letterSpacing: '.5px', color: 'var(--gold)', margin: '0 0 4px 2px' }}>
            <Icon name="pray" size={12} color="var(--gold)" /> PRAYER REQUEST</div>
          <div style={{ borderRadius: 18, padding: '10px 14px', background: bg, color: fg,
            border: me ? 'none' : '1.5px solid color-mix(in oklab, var(--gold) 38%, var(--line))', boxShadow: 'var(--shadow)',
            borderBottomRightRadius: me ? 5 : 18, borderBottomLeftRadius: me ? 18 : 5 }}>
            <p style={{ fontFamily: 'var(--font-ui)', fontSize: 14.5, lineHeight: 1.45, margin: 0, textWrap: 'pretty' }}>{m.text}</p>
          </div>
        </div>
        {react}
      </Row>
    );
  }

  if (m.kind === 'devotional') {
    const c = m.card || {};
    return (
      <Row me={me} m={m}>
        <div onClick={() => ctx.openDevotional && ctx.openDevotional()} style={{ maxWidth: 280, borderRadius: 18, overflow: 'hidden', cursor: 'pointer',
          background: 'linear-gradient(155deg, #6BA17C, #3C6E57)', color: '#fff', boxShadow: 'var(--shadow)' }}>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: '.6px', opacity: .9, marginBottom: 7 }}>
              <Icon name="sun" size={13} stroke={2} color="#fff" /> DEVOTIONAL</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 5 }}>{c.title}</div>
            {c.excerpt ? <p style={{ fontFamily: 'var(--font-read)', fontSize: 14.5, lineHeight: 1.45, margin: '0 0 8px', opacity: .95, textWrap: 'pretty' }}>{c.excerpt}</p> : null}
            <div style={{ fontWeight: 700, fontSize: 12 }}>{c.series ? c.series + ' · ' : ''}{c.ref}</div>
          </div>
        </div>
        {react}
      </Row>
    );
  }

  if (m.kind === 'note') {
    const c = m.card || {};
    return (
      <Row me={me} m={m}>
        <div style={{ maxWidth: 280, borderRadius: 18, padding: '13px 15px', background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: '.5px', color: 'var(--clay)', marginBottom: 6 }}>
            <Icon name="pen" size={13} color="var(--clay)" /> NOTE · {c.ref}</div>
          {c.text ? <p style={{ fontFamily: 'var(--font-read)', fontSize: 14, lineHeight: 1.4, margin: '0 0 8px', color: 'var(--ink-2)', fontStyle: 'italic', textWrap: 'pretty' }}>“{c.text}”</p> : null}
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: 14.5, lineHeight: 1.45, margin: 0, color: 'var(--ink)', textWrap: 'pretty' }}>{c.note}</p>
        </div>
        {react}
      </Row>
    );
  }

  return (
    <Row me={me} m={m}>
      <div style={{ maxWidth: 270, borderRadius: 18, padding: '10px 14px', background: bg, color: fg,
        border: me ? 'none' : '1px solid var(--line)', boxShadow: 'var(--shadow)',
        borderBottomRightRadius: me ? 5 : 18, borderBottomLeftRadius: me ? 18 : 5 }}>
        <p style={{ fontFamily: 'var(--font-ui)', fontSize: 14.5, lineHeight: 1.45, margin: 0, textWrap: 'pretty' }}>{m.text}</p>
      </div>
      {react}
    </Row>
  );
}

function Row({ me, m, children }) {
  const d = (m.pubkey && window.Fellowship && window.Fellowship.displayFor) ? window.Fellowship.displayFor(m.pubkey) : { handle: m.handle, color: m.color };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: me ? 'flex-end' : 'flex-start', animation: 'trinityFade .3s ease both' }}>
      {!me ? <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '0 0 4px 4px' }}>
        <UserAvatar av={avOf(d)} name={d.handle} size={22} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)' }}>{d.handle}</span>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.when}</span>
      </div> : null}
      {children}
      {me ? <span style={{ fontSize: 11, color: 'var(--ink-3)', margin: '3px 4px 0' }}>{m.when}</span> : null}
    </div>
  );
}

// map a Nostr event → a chat bubble
function fmtClock(ts) { try { return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } }
function relTime(ts) {
  const d = new Date(ts * 1000), now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtClock(ts);
  return Math.round((now - d) / 864e5) === 1 ? 'Yesterday' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
// plain text of a message event (text, or the words inside a shared card) for search
function searchableText(e) {
  const k = (e.tags.find(t => t[0] === 'k') || [])[1];
  if (k === 'verse' || k === 'note' || k === 'devotional') {
    try { const c = JSON.parse(e.content); return [c.text, c.note, c.title, c.excerpt, c.ref].filter(Boolean).join(' '); } catch { return e.content; }
  }
  return e.content;
}
function evtToMsg(e) {
  const me = e.pubkey === window.Fellowship.myPubkey;
  const kTag = (e.tags.find(t => t[0] === 'k') || [])[1];
  const base = { id: e.id, me, pubkey: e.pubkey, when: fmtClock(e.created_at), _ts: e.created_at };
  if (kTag === 'verse') { try { return { ...base, kind: 'verse', verse: JSON.parse(e.content) }; } catch {} }
  if (kTag === 'devotional') { try { return { ...base, kind: 'devotional', card: JSON.parse(e.content) }; } catch {} }
  if (kTag === 'note') { try { return { ...base, kind: 'note', card: JSON.parse(e.content) }; } catch {} }
  if (kTag === 'prayer') return { ...base, kind: 'prayer', text: e.content };
  return { ...base, text: e.content };
}

// ── conversation room (overlay) ──
function ChatRoom({ group, open, onClose, ctx }) {
  const [msgs, setMsgs] = useC([]);
  const [draft, setDraft] = useC('');
  const [prayerOn, setPrayerOn] = useC(false);   // attach a "prayer request" flag to this message
  const [reactions, setReactions] = useC({});    // targetId -> { reactorPubkey: {content, ts} }
  const [pickerFor, setPickerFor] = useC(null);  // message id whose emoji picker is open
  const id = useIdentity();
  const scRef = useCR();
  useCE(() => {
    setDraft('');
    if (!group) return;
    if (window.Fellowship) {                       // live: subscribe to the group over Nostr
      setMsgs([]); setReactions({}); setPickerFor(null);
      const seen = new Set();
      const add = (e) => {
        if (window.Fellowship.requestProfiles) window.Fellowship.requestProfiles([e.pubkey]);
        setMsgs(prev => {
          if (seen.has(e.id)) return prev; seen.add(e.id);
          return [...prev, evtToMsg(e)].sort((a, b) => (a._ts || 0) - (b._ts || 0));
        });
      };
      const unsub = window.Fellowship.subscribeGroup(group.id, add);
      const unsubR = window.Fellowship.subscribeReactions(group.id, (r) => {
        setReactions(prev => {
          const t = prev[r.targetId] ? { ...prev[r.targetId] } : {};
          if (t[r.pubkey] && t[r.pubkey].ts >= r.ts) return prev;
          t[r.pubkey] = { content: r.content, ts: r.ts };
          return { ...prev, [r.targetId]: t };
        });
      });
      return () => { unsub(); unsubR(); };
    }
    setMsgs((window.TrinityData.GROUP_MESSAGES[group.id] || []).map(m => ({ ...m }))); // fallback: mock seed
  }, [group]);
  useCE(() => {
    if (open && scRef.current) scRef.current.scrollTop = scRef.current.scrollHeight;
  }, [msgs, open]);

  if (!group) return null;

  const send = (extra) => {
    if (window.Fellowship) {                        // publish over Nostr; relay echoes it back to our sub
      if (extra.kind === 'verse') window.Fellowship.publishMessage(group.id, JSON.stringify(extra.verse), [['k', 'verse']]);
      else if (extra.kind === 'prayer') window.Fellowship.publishMessage(group.id, extra.text, [['k', 'prayer']]);
      else window.Fellowship.publishMessage(group.id, extra.text);
      return;
    }
    const base = { id: 'me-' + Date.now(), me: true, handle: id.handle, color: id.color, when: 'now' };
    setMsgs(prev => [...prev, { ...base, ...extra }]);
  };
  const sendText = () => { if (!draft.trim()) return; send(prayerOn ? { text: draft.trim(), kind: 'prayer' } : { text: draft.trim() }); setDraft(''); setPrayerOn(false); };
  const shareVerse = () => { send({ kind: 'verse', verse: { ...window.TrinityData.VOTD } }); ctx.toast('Verse shared'); };
  const myPub = window.Fellowship && window.Fellowship.myPubkey;
  const summaryFor = (tid) => {
    const reactors = reactions[tid]; if (!reactors) return [];
    const counts = {}; let myEmoji = null;
    for (const pk in reactors) { const c = reactors[pk].content; if (!c || c === '-') continue; counts[c] = (counts[c] || 0) + 1; if (pk === myPub) myEmoji = c; }
    return Object.keys(counts).map(emoji => ({ emoji, count: counts[emoji], mine: emoji === myEmoji }));
  };
  const toggleReact = (tid, pubkey, emoji) => {
    const reactors = reactions[tid] || {}; const cur = reactors[myPub] && reactors[myPub].content;
    if (window.Fellowship) window.Fellowship.react(group.id, tid, pubkey, cur === emoji ? '-' : emoji);
    setPickerFor(null);
  };

  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, background: 'color-mix(in oklab, var(--surface) 92%, transparent)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 14px 11px' }}>
          <button onClick={onClose} style={{ width: 38, height: 38, borderRadius: 12, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="chevL" size={22} /></button>
          <div style={{ width: 40, height: 40, borderRadius: 13, background: `color-mix(in oklab, ${group.accent} 16%, var(--surface))`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: group.accent, flexShrink: 0 }}>
            <Icon name={group.prayer ? 'pray' : 'chat'} size={22} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, lineHeight: 1.1 }}>{group.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--sage)' }} /> {group.members} anonymous · Nostr</div>
          </div>
          <IconBtn name="shield" onClick={() => ctx.toast('Everyone here is anonymous')} />
        </div>
      </div>

      <div ref={scRef} className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ textAlign: 'center', margin: '2px 0 4px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--ink-3)', padding: '6px 13px', borderRadius: 999, fontSize: 11.5, fontWeight: 600 }}>
            <Icon name="lock" size={13} /> Messages are anonymous & relayed over Nostr</span>
        </div>
        {msgs.map(m => <Bubble key={m.id} m={m} ctx={ctx}
          summary={summaryFor(m.id)} onReact={(emoji) => toggleReact(m.id, m.pubkey, emoji)}
          pickerOpen={pickerFor === m.id} onOpenPicker={() => setPickerFor(pickerFor === m.id ? null : m.id)}
          live={!!window.Fellowship} />)}
      </div>

      <div style={{ padding: '8px 12px 14px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
        {prayerOn ? (
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'color-mix(in oklab, var(--gold) 15%, var(--surface))', color: 'var(--gold)', border: '1px solid color-mix(in oklab, var(--gold) 35%, transparent)', padding: '5px 8px 5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
              <Icon name="pray" size={13} color="var(--gold)" /> Prayer request
              <button onClick={() => setPrayerOn(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--gold)', display: 'flex', padding: 0 }}><Icon name="x" size={14} /></button>
            </span>
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <button onClick={shareVerse} title="Share a verse" style={{ width: 44, height: 44, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface-2)', cursor: 'pointer', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="sparkle" size={20} /></button>
          <button onClick={() => setPrayerOn(v => !v)} title="Mark as a prayer request" style={{ width: 44, height: 44, borderRadius: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            border: prayerOn ? '1px solid var(--gold)' : '1px solid var(--line)',
            background: prayerOn ? 'color-mix(in oklab, var(--gold) 18%, var(--surface))' : 'var(--surface-2)',
            color: 'var(--gold)' }}>
            <Icon name="pray" size={20} fill={prayerOn} /></button>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={1}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }}
            placeholder={prayerOn ? 'Share a prayer request…' : 'Message anonymously…'} style={{
              flex: 1, resize: 'none', minHeight: 44, maxHeight: 96, padding: '12px 15px', borderRadius: 16,
              border: '1px solid var(--line)', background: 'var(--surface-2)', outline: 'none', fontSize: 14.5,
              fontFamily: 'var(--font-ui)', color: 'var(--ink)', lineHeight: 1.35 }} />
          <button onClick={sendText} style={{ width: 44, height: 44, borderRadius: 14, border: 'none',
            background: draft.trim() ? 'var(--clay)' : 'var(--line)', cursor: draft.trim() ? 'pointer' : 'default',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background .2s' }}>
            <Icon name="send" size={20} color="#fff" /></button>
        </div>
      </div>
    </Overlay>
  );
}

// ── share sheet: a verse / devotional / note — as an image (verse) or into a group ──
function SharePreview({ p, type }) {
  if (type === 'devotional') {
    return (
      <div style={{ borderRadius: 18, padding: '16px 18px', background: 'linear-gradient(155deg, #6BA17C, #3C6E57)', color: '#fff', boxShadow: 'var(--shadow)', marginBottom: 18 }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.6px', opacity: .9, marginBottom: 6 }}>DEVOTIONAL</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, marginBottom: 5 }}>{p.title}</div>
        {p.excerpt ? <p style={{ fontFamily: 'var(--font-read)', fontSize: 15, lineHeight: 1.45, margin: '0 0 8px', opacity: .95, textWrap: 'pretty' }}>{p.excerpt}</p> : null}
        <div style={{ fontWeight: 700, fontSize: 12.5 }}>{p.series ? p.series + ' · ' : ''}{p.ref}</div>
      </div>
    );
  }
  if (type === 'note') {
    return (
      <div style={{ borderRadius: 18, padding: '16px 18px', background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 18 }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.5px', color: 'var(--clay)', marginBottom: 7 }}>NOTE · {p.ref}</div>
        {p.text ? <p style={{ fontFamily: 'var(--font-read)', fontSize: 15, lineHeight: 1.4, margin: '0 0 8px', color: 'var(--ink-2)', fontStyle: 'italic', textWrap: 'pretty' }}>“{p.text}”</p> : null}
        <p style={{ fontFamily: 'var(--font-ui)', fontSize: 15, lineHeight: 1.45, margin: 0, color: 'var(--ink)', textWrap: 'pretty' }}>{p.note}</p>
      </div>
    );
  }
  return (
    <div style={{ borderRadius: 18, padding: '16px 18px', background: 'linear-gradient(155deg, var(--clay), var(--clay-deep))', color: '#fff', boxShadow: 'var(--shadow)', marginBottom: 18 }}>
      <p style={{ fontFamily: 'var(--font-read)', fontSize: 18, lineHeight: 1.45, margin: '0 0 8px', fontWeight: 500, textWrap: 'pretty' }}>“{p.text}”</p>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{p.ref}{p.version ? ' · ' + p.version : ''}</div>
    </div>
  );
}

function VerseShareSheet({ payload, open, onClose, ctx }) {
  if (!payload) return null;
  const D = window.TrinityData;
  const type = payload.type || 'verse';
  const live = !!(window.Fellowship && window.Fellowship.publishMessage);
  const heading = type === 'devotional' ? 'Share devotional' : type === 'note' ? 'Share note' : 'Share verse';
  const sendToGroup = (g) => {
    if (!live) { ctx.toast('Chat isn’t available'); return; }
    window.Fellowship.publishMessage(g.id, JSON.stringify(payload), [['k', type]]);
    ctx.toast('Shared to ' + g.name); onClose();
  };
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="86%">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>{heading}</div>
        <IconBtn name="x" onClick={onClose} />
      </div>

      <SharePreview p={payload} type={type} />

      {type === 'verse' ? (
        <button onClick={() => { onClose(); ctx.openShare(payload); }} style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 14,
          border: '1px solid var(--line)', background: 'var(--surface-2)', cursor: 'pointer', color: 'var(--ink)', textAlign: 'left', marginBottom: 18 }}>
          <Icon name="share" size={20} color="var(--clay)" />
          <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14.5 }}>Share as image</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>A card for your camera roll or socials</div></div>
          <Icon name="chevR" size={17} color="var(--ink-3)" />
        </button>
      ) : null}

      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 10px' }}>SEND TO A GROUP</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {D.GROUPS.filter(g => g.church === ctx.church.id).map(g => (
          <button key={g.id} onClick={() => sendToGroup(g)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 14,
            border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--ink)', textAlign: 'left', boxShadow: 'var(--shadow)' }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: `color-mix(in oklab, ${g.accent} 16%, var(--surface))`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: g.accent, flexShrink: 0 }}>
              <Icon name={g.prayer ? 'pray' : 'chat'} size={20} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{g.name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{g.kind}</div></div>
            <Icon name="send" size={17} color="var(--clay)" />
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

Object.assign(window, { ChatScreen, ChatRoom, VerseShareSheet });
