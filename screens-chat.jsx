// screens-chat.jsx — "Chat" tab: anonymous church + life-group messaging over Nostr.
// UI is wired; transport is mock for now. Identity is REAL when lib/identity.js has
// derived a key (window.TrinityIdentity), otherwise falls back to the mock identity.
const { useState: useC, useEffect: useCE, useRef: useCR } = React;

// Giving is controlled PER CHURCH by the steward (they enable it + bring their own payment gateway).
// The member app shows the Giving tab only when the active church has turned it on (church.giving),
// published on the church profile over the relay. TrinityOne is the platform; the church operates giving.

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
        {relayList !== null && !(relayList || []).length ? (
          <div style={{ display: 'flex', gap: 9, padding: '12px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 8 }}>
            <Icon name="globe" size={17} color="var(--ink-3)" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>No relay yet — join a church (scan its invite) and you’ll connect to its relay automatically.</span>
          </div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          {(relayList || []).map(r => (
            <div key={r.url} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <Icon name="globe" size={17} color={r.status === 'on' ? 'var(--sage)' : 'var(--ink-3)'} />
              <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: r.status === 'on' ? 'var(--sage)' : 'var(--ink-3)' }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: r.status === 'on' ? 'var(--sage)' : 'var(--ink-3)' }} />{r.status === 'on' ? 'Connected' : 'Off'}</span>
            </div>
          ))}
        </div>
        {(relayList || []).length ? <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45, padding: '0 2px 8px' }}>Relays are managed by the churches you’ve joined.</div> : null}
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
  const givingOn = !!(ctx.church && ctx.church.giving) && !(ctx.safeguard && ctx.safeguard.isMinor);   // steward toggle, published on the church profile; always off for a child account (safeguarding)
  const idParam = new URLSearchParams(location.search).get('identity'); // main|recovery|restore|invite
  const [nostr, setNostr] = useC(!!idParam);
  const chatParam = new URLSearchParams(location.search).get('chat'); // 'groups' | 'giving'
  const [view, setView] = useC(givingOn && chatParam === 'giving' ? 'giving' : 'groups');
  const id = useIdentity();
  const live = !!(window.Fellowship && window.Fellowship.subscribeGroups);
  const relayCount = live ? window.Fellowship.relays.length : D.RELAYS.filter(r => r.status === 'on').length;
  const [activity, setActivity] = useC({});   // gid -> { text, ts }
  const [unread, setUnread] = useC({});        // gid -> count
  const [q, setQ] = useC('');                  // chat search query
  const [realGroups, setRealGroups] = useC([]); // the active church's REAL groups (steward console)
  const [cats, setCats] = useC([]);             // the church's group categories (named containers)
  const msgBuf = useCR([]);                     // recent messages buffer (for search)

  // read the active church's real group definitions (kind-30078) when it has an npub
  useCE(() => {
    if (!ctx.church || !ctx.church.npub || !(window.Fellowship && window.Fellowship.subscribeChurchGroups)) { setRealGroups([]); return; }
    return window.Fellowship.subscribeChurchGroups(ctx.church.npub, setRealGroups);
  }, [ctx.church && ctx.church.npub]);

  // read the church's group categories so we can section the list by them
  useCE(() => {
    if (!ctx.church || !ctx.church.npub || !(window.Fellowship && window.Fellowship.subscribeChurchCategories)) { setCats([]); return; }
    return window.Fellowship.subscribeChurchCategories(ctx.church.npub, setCats);
  }, [ctx.church && ctx.church.npub]);

  const accentFor = (s) => { const cs = ['var(--clay)', 'var(--sage)', 'var(--gold)', '#5360D6', '#C24B7A']; let h = 0; for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return cs[h % cs.length]; };
  // real, steward-defined groups when the church has them; otherwise the sample set for this church.
  // invite-only groups are hidden unless I'm on their member list (the relay also enforces posting).
  const myPub = window.Fellowship && window.Fellowship.myPubkey;
  const iAmMinor = !!(ctx.safeguard && ctx.safeguard.isMinor);   // safeguarding: a child sees only child-safe groups
  const churchGroups = realGroups.length
    ? realGroups
        .filter(g => g.visibility !== 'invite' || (Array.isArray(g.members) && myPub && g.members.includes(myPub)))
        .filter(g => !iAmMinor || g.childsafe)
        .map(g => ({ id: g.id, name: g.name, kind: g.kind === 'broadcast' ? 'Broadcast' : g.kind === 'team' ? 'Team' : 'Group', team: g.kind === 'team', sub: g.sub, accent: accentFor(g.id), prayer: g.kind === 'prayer' || /prayer/i.test(g.name || ''), invite: g.visibility === 'invite', encrypted: !!g.encrypted, category: g.category }))
    : D.GROUPS.filter(g => g.church === (ctx.church && ctx.church.id));
  const notJoined = !(ctx.church && ctx.church.npub);   // hasn't joined a real church yet
  const teamGroups = churchGroups.filter(g => g.team);
  const plainGroups = churchGroups.filter(g => !g.team);
  const groupIdsKey = churchGroups.map(g => g.id).join(',');

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
  }, [groupIdsKey]);   // re-subscribe when the group set changes (church switch or real groups load)

  const openGroup = (g) => {
    const seen = lsGet('trinityone.chatSeen', {});
    seen[g.id] = Math.floor(Date.now() / 1000); lsSet('trinityone.chatSeen', seen);
    setUnread(prev => ({ ...prev, [g.id]: 0 }));
    ctx.openGroup(g);
  };
  const groupCard = (g) => (
    <div key={g.id} onClick={() => openGroup(g)} style={{
      display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18,
      background: ctx.openGroupId === g.id ? 'color-mix(in oklab, var(--clay) 9%, var(--surface))' : 'var(--surface)',
      border: '1px solid ' + (ctx.openGroupId === g.id ? 'var(--clay)' : 'var(--line)'), cursor: 'pointer', boxShadow: 'var(--shadow)',
    }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{ width: 50, height: 50, borderRadius: 16, background: `color-mix(in oklab, ${g.accent} 16%, var(--surface))`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: g.accent }}>
          <Icon name={g.team ? 'shield' : g.prayer ? 'pray' : 'chat'} size={25} stroke={1.8} />
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
          {g.members != null ? ` · ${g.members} members` : (g.sub ? ` · ${g.sub}` : '')}
        </div>
      </div>
    </div>
  );

  const ql = q.trim().toLowerCase();
  const groupHits = ql ? churchGroups.filter(g => g.name.toLowerCase().includes(ql) || g.kind.toLowerCase().includes(ql)) : [];
  const msgHits = ql ? msgBuf.current
    .filter(({ e }) => searchableText(e).toLowerCase().includes(ql))
    .slice(0, 40)
    .map(({ gid, e }) => ({ e, group: churchGroups.find(g => g.id === gid) }))
    .filter(x => x.group) : [];
  const hi = (txt) => {
    const i = (txt || '').toLowerCase().indexOf(ql);
    if (i < 0 || !ql) return txt;
    return (<React.Fragment>{txt.slice(0, i)}<mark style={{ background: 'var(--hl-yellow)', color: 'inherit', borderRadius: 3, padding: '0 2px' }}>{txt.slice(i, i + ql.length)}</mark>{txt.slice(i + ql.length)}</React.Fragment>);
  };

  return (
    <ScreenScroll>
      <div style={{ marginBottom: 14, animation: 'trinityFade .5s ease both' }}>
        <ChurchPill ctx={ctx} />
      </div>
      {(ctx.requireFullName && !(ctx.joinState && ctx.joinState.isPending) && (myName(id) || '').trim().split(/\s+/).filter(Boolean).length < 2) ? (
        <div onClick={() => ctx.openProfile()} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: 14, borderRadius: 16, background: 'color-mix(in oklab, var(--clay) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, transparent)', marginBottom: 14, cursor: 'pointer', animation: 'trinityFade .5s ease both' }}>
          <Icon name="pen" size={18} color="var(--clay)" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}><b style={{ color: 'var(--ink)' }}>Add your full name.</b> {(ctx.church && ctx.church.name) || 'Your church'} asks members to use a real first and last name so people can recognise you.</div>
          <Icon name="chevR" size={17} color="var(--clay)" />
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: (ctx.churchNetworks || []).length ? 12 : (givingOn ? 16 : 20), animation: 'trinityFade .5s ease .04s both' }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, letterSpacing: '-.5px' }}>Chat</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <IconBtn name="send" onClick={() => ctx.openDMInbox()} title="Direct messages" />
            {ctx.dmUnread ? <span style={{ position: 'absolute', top: 4, right: 4, width: 10, height: 10, borderRadius: 999, background: 'var(--clay)', border: '2px solid var(--surface)', pointerEvents: 'none' }} /> : null}
          </span>
          <button onClick={() => ctx.openProfile()} title="Your anonymous identity" style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', borderRadius: 999, lineHeight: 0, position: 'relative' }}>
            <UserAvatar av={myAvatar(id)} name={myName(id)} size={38} />
            <span style={{ position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 999, background: 'var(--sage)', border: '2px solid var(--surface)' }} />
          </button>
        </div>
      </div>

      {/* the wider network(s) this church belongs to — a small line right under the church it's part of */}
      {(ctx.churchNetworks || []).length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: givingOn ? 16 : 20, animation: 'trinityFade .5s ease .05s both' }}>
          {ctx.churchNetworks.map(n => (
            <button key={n.networkPub} onClick={() => { ctx.setActiveChurch(n.npub); ctx.toast('Viewing ' + (n.name || 'the network')); }} title="Tap to see its announcements & events" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px 5px 8px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
              <Icon name="globe" size={14} color="var(--clay)" />
              <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600 }}>Part of</span>
              <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>{n.name || 'a network'}</span>
              <Icon name="chevR" size={14} color="var(--ink-3)" />
            </button>
          ))}
        </div>
      ) : null}

      {/* segmented: Groups / Giving (giving parked for the pilot) */}
      {givingOn ? (
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

      {givingOn && view === 'giving' ? (
        <GivingView ctx={ctx} history={ctx.giving} setHistory={ctx.setGiving} />
      ) : notJoined ? (
        <div style={{ textAlign: 'center', padding: '44px 22px', animation: 'trinityFade .4s ease both' }}>
          <div style={{ width: 66, height: 66, borderRadius: 20, margin: '0 auto 16px', background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--clay)' }}><Icon name="chat" size={32} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 23, marginBottom: 8 }}>Join your church</div>
          <p style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.55, maxWidth: 320, margin: '0 auto 22px' }}>Community is where your church gathers — groups, prayer requests and notices. Scan the invite your church shares, or paste its code, to join in.</p>
          <button onClick={() => ctx.openChurchSwitcher && ctx.openChurchSwitcher('follow')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 22px', borderRadius: 14, border: 'none', cursor: 'pointer', background: 'var(--clay)', color: '#fff', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15 }}><Icon name="qr" size={18} color="#fff" /> Join a church</button>
        </div>
      ) : (ctx.joinState && ctx.joinState.isPending) ? (
        <div style={{ textAlign: 'center', padding: '40px 24px', animation: 'trinityFade .4s ease both' }}>
          <div style={{ width: 76, height: 76, borderRadius: 22, margin: '0 auto 18px', background: 'color-mix(in oklab, var(--gold) 16%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a6717' }}><Icon name="shield" size={38} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, marginBottom: 10 }}>Waiting for approval</div>
          <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 340, margin: '0 auto' }}>Your request to join <b>{(ctx.church && ctx.church.name) || 'this church'}</b> has been sent. A steward will let you in shortly — you'll be able to see groups and join the conversation once you're approved.</p>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 20, padding: '10px 16px', borderRadius: 999, background: 'color-mix(in oklab, var(--gold) 12%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 30%, transparent)', color: '#8a6717', fontWeight: 700, fontSize: 13.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: '#c2913a' }} /> Pending steward approval
          </div>
        </div>
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
      <ServingEntry ctx={ctx} />

      <button onClick={() => ctx.openPeople()} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '13px 14px', marginBottom: 22, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', cursor: 'pointer', fontFamily: 'var(--font-ui)', textAlign: 'left' }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0, background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="users" size={20} color="currentColor" /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>People</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Find someone in your church and message them</div>
        </div>
        <Icon name="chevR" size={18} color="var(--ink-3)" />
      </button>

      {teamGroups.length ? (
        <React.Fragment>
          <SectionLabel>Teams</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22, animation: 'trinityFade .5s ease .08s both' }}>
            {teamGroups.map(groupCard)}
          </div>
        </React.Fragment>
      ) : null}

      {plainGroups.length === 0 ? (
        <React.Fragment>
          <SectionLabel>Your groups</SectionLabel>
          <div style={{ textAlign: 'center', padding: '38px 24px', color: 'var(--ink-3)', animation: 'trinityFade .4s ease both' }}>
            <div style={{ width: 56, height: 56, borderRadius: 18, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}><Icon name="chat" size={28} color="var(--ink-3)" /></div>
            <p style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink-2)', margin: '0 0 4px' }}>No groups yet</p>
            <p style={{ fontFamily: 'var(--font-read)', fontSize: 14.5, lineHeight: 1.5, margin: 0, maxWidth: 280, marginLeft: 'auto', marginRight: 'auto' }}>{ctx.church && ctx.church.name ? `${ctx.church.name} hasn’t opened any chat rooms yet — they’ll appear here when it does.` : 'Chat rooms will appear here once your church opens them.'}</p>
          </div>
        </React.Fragment>
      ) : (() => {
        // section the groups under the steward's named categories; anything uncategorised (or in a
        // since-deleted category) falls into a final "Other groups" / "Your groups" section.
        const catIds = new Set(cats.map(c => c.id));
        const known = cats.filter(c => plainGroups.some(g => g.category === c.id));
        const uncategorised = plainGroups.filter(g => !g.category || !catIds.has(g.category));
        const listStyle = { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22, animation: 'trinityFade .5s ease .1s both' };
        return (
          <React.Fragment>
            {known.map(c => (
              <React.Fragment key={c.id}>
                <SectionLabel>{c.name}</SectionLabel>
                <div style={listStyle}>{plainGroups.filter(g => g.category === c.id).map(groupCard)}</div>
              </React.Fragment>
            ))}
            {uncategorised.length ? (
              <React.Fragment>
                <SectionLabel>{known.length ? 'Other groups' : 'Your groups'}</SectionLabel>
                <div style={listStyle}>{uncategorised.map(groupCard)}</div>
              </React.Fragment>
            ) : null}
          </React.Fragment>
        );
      })()}
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
function ReactionsRow({ summary, onReact, pickerOpen, onOpenPicker, live, me }) {
  if (!live) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap', justifyContent: me ? 'flex-end' : 'flex-start' }}>
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
          <div style={{ position: 'absolute', bottom: 28, [me ? 'right' : 'left']: 0, zIndex: 5, display: 'flex', gap: 2, padding: '6px 8px', borderRadius: 14,
            background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)' }}>
            {REACT_EMOJIS.map(e => <button key={e} onClick={() => onReact(e)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, padding: '2px 4px', lineHeight: 1 }}>{e}</button>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Bubble({ m, ctx, summary, onReact, pickerOpen, onOpenPicker, live, canModerate, isPinned, menuOpen, onOpenMenu, onPin, onUnpin, onRemove }) {
  const me = m.me;
  const bg = me ? 'var(--clay)' : 'var(--surface)';
  const fg = me ? '#fff' : 'var(--ink)';
  const mod = { canModerate, isPinned, menuOpen, onOpenMenu, onPin, onUnpin, onRemove };
  const react = <ReactionsRow me={me} summary={summary} onReact={onReact} pickerOpen={pickerOpen} onOpenPicker={onOpenPicker} live={live} />;

  if (m.kind === 'verse') {
    return (
      <Row me={me} m={m} ctx={ctx} mod={mod}>
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
      <Row me={me} m={m} ctx={ctx} mod={mod}>
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
      <Row me={me} m={m} ctx={ctx} mod={mod}>
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
      <Row me={me} m={m} ctx={ctx} mod={mod}>
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

  if (m.kind === 'poll') {
    const p = m.poll || {}; const opts = Array.isArray(p.options) ? p.options : [];
    const counts = opts.map((_, i) => ((summary || []).find(s => s.emoji === String(i)) || {}).count || 0);
    const total = counts.reduce((a, b) => a + b, 0);
    const mine = ((summary || []).find(s => s.mine) || {}).emoji;
    return (
      <Row me={me} m={m} ctx={ctx} mod={mod}>
        <div style={{ maxWidth: 290, borderRadius: 18, padding: '13px 15px', background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: '.5px', color: 'var(--clay)', marginBottom: 7 }}><Icon name="sliders" size={13} color="var(--clay)" /> POLL</div>
          <p style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15, lineHeight: 1.3, margin: '0 0 10px' }}>{p.question}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {opts.map((o, i) => {
              const c = counts[i]; const pct = total ? Math.round((c / total) * 100) : 0; const voted = mine === String(i);
              return (
                <button key={i} onClick={() => onReact && onReact(String(i))} style={{ position: 'relative', overflow: 'hidden', textAlign: 'left', padding: '9px 12px', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', border: voted ? '1.5px solid var(--clay)' : '1px solid var(--line)', background: 'var(--surface-2)' }}>
                  <div style={{ position: 'absolute', inset: 0, width: pct + '%', background: voted ? 'color-mix(in oklab, var(--clay) 16%, transparent)' : 'color-mix(in oklab, var(--ink) 7%, transparent)', transition: 'width .3s' }} />
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: voted ? 700 : 600, color: 'var(--ink)' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{o}{voted ? ' ✓' : ''}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 700 }}>{pct}%</span>
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 8 }}>{total} vote{total === 1 ? '' : 's'} · tap to vote</div>
        </div>
        {react}
      </Row>
    );
  }

  return (
    <Row me={me} m={m} ctx={ctx} mod={mod}>
      <div style={{ maxWidth: 270, borderRadius: 18, padding: '10px 14px', background: bg, color: fg,
        border: me ? 'none' : '1px solid var(--line)', boxShadow: 'var(--shadow)',
        borderBottomRightRadius: me ? 5 : 18, borderBottomLeftRadius: me ? 18 : 5 }}>
        <p style={{ fontFamily: 'var(--font-ui)', fontSize: 14.5, lineHeight: 1.45, margin: 0, textWrap: 'pretty' }}>{m.text}</p>
      </div>
      {react}
    </Row>
  );
}

// shareable text for any message kind (plain text, verse, or a shared card)
function shareTextOf(m) {
  if (!m) return '';
  if (m.text) return m.text;
  if (m.kind === 'verse' && m.verse) return '“' + m.verse.text + '” — ' + m.verse.ref + (m.verse.version ? ' (' + m.verse.version + ')' : '');
  if (m.card) return [m.card.title, m.card.ref, m.card.text].filter(Boolean).join('\n');
  return '';
}
function Row({ me, m, children, ctx, mod }) {
  const d = (m.pubkey && window.Fellowship && window.Fellowship.displayFor) ? window.Fellowship.displayFor(m.pubkey) : { handle: m.handle, color: m.color };
  const canDM = !!(m.pubkey && ctx && ctx.openDM && (!ctx.canDMPeer || ctx.canDMPeer(m.pubkey)));   // safeguarding gate
  // press-and-hold a message to share it (OS share sheet). Touch-move cancels so scrolling is unaffected.
  const lp = React.useRef(null);
  const doShare = () => { const t = shareTextOf(m); if (t && ctx && ctx.shareText) ctx.shareText(t); };
  const startLP = () => { clearTimeout(lp.current); lp.current = setTimeout(doShare, 480); };
  const cancelLP = () => { clearTimeout(lp.current); lp.current = null; };
  const M = mod || {};
  return (
    <div onTouchStart={startLP} onTouchEnd={cancelLP} onTouchMove={cancelLP} onContextMenu={(e) => { e.preventDefault(); doShare(); }}
      style={{ display: 'flex', flexDirection: 'column', alignItems: me ? 'flex-end' : 'flex-start', animation: 'trinityFade .3s ease both' }}>
      {!me ? <div onClick={() => canDM && ctx.openDM(m.pubkey)} title={canDM ? 'Message ' + d.handle : ''} style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '0 0 4px 4px', cursor: canDM ? 'pointer' : 'default' }}>
        <UserAvatar av={avOf(d)} name={d.handle} size={22} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)' }}>{d.handle}</span>
        {d.nip05 ? (() => {
          const h = String(d.nip05).split('@')[0];                                           // the @nicename (NIP-05 local part)
          const dup = d.handle && d.handle.toLowerCase().replace(/[^a-z0-9]+/g, '') === h.toLowerCase();   // name already IS the handle — don't repeat it
          return <React.Fragment>
            {!dup ? <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--sage)' }}>@{h}</span> : null}
            <Icon name="check" size={11} stroke={3} color="var(--sage)" />
          </React.Fragment>;
        })() : null}
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.when}</span>
      </div> : null}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: me ? 'flex-end' : 'flex-start' }}>
        {children}
        {M.canModerate ? (
          <React.Fragment>
            <button onClick={M.onOpenMenu} title="Moderate" style={{ position: 'absolute', top: -6, [me ? 'left' : 'right']: -26, border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 999, width: 22, height: 22, cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow)' }}><Icon name="dots" size={14} /></button>
            {M.menuOpen ? (
              <div style={{ position: 'absolute', top: 18, [me ? 'left' : 'right']: -26, zIndex: 5, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: 5, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button onClick={M.isPinned ? M.onUnpin : M.onPin} style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'none', cursor: 'pointer', padding: '8px 10px', borderRadius: 8, fontFamily: 'var(--font-ui)', fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', textAlign: 'left' }}><Icon name="pin" size={15} color="var(--gold)" /> {M.isPinned ? 'Unpin message' : 'Pin message'}</button>
                <button onClick={M.onRemove} style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'none', cursor: 'pointer', padding: '8px 10px', borderRadius: 8, fontFamily: 'var(--font-ui)', fontSize: 13.5, fontWeight: 600, color: 'var(--clay)', textAlign: 'left' }}><Icon name="trash" size={15} color="var(--clay)" /> Remove message</button>
              </div>
            ) : null}
          </React.Fragment>
        ) : null}
      </div>
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
  if (kTag === 'poll') { try { return { ...base, kind: 'poll', poll: JSON.parse(e.content) }; } catch {} }
  return { ...base, text: e.content };
}

// ── a Community entry into the Serving overlay (shown above the groups list) ──
function ServingEntry({ ctx }) {
  const next = ctx.servNext; const pending = (ctx.servPending || []).length;
  if (!next && !pending) {
    // not rostered — still offer a way into Serving & events
    return (
      <button onClick={() => ctx.openServing && ctx.openServing()} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18, marginBottom: 14, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)', background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: 'var(--sage)' }}><Icon name="calCheck" size={22} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>Serving &amp; events</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)' }}>See what’s on · RSVP · your rota</div>
        </div>
        <Icon name="chevR" size={18} color="var(--ink-3)" />
      </button>
    );
  }
  return (
    <button onClick={() => ctx.openServing && ctx.openServing()} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18, marginBottom: 14, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', boxShadow: 'var(--shadow)',
      background: pending ? 'color-mix(in oklab, var(--gold) 9%, var(--surface))' : 'color-mix(in oklab, var(--sage) 9%, var(--surface))', border: pending ? '1px solid color-mix(in oklab, var(--gold) 32%, var(--line))' : '1px solid color-mix(in oklab, var(--sage) 30%, var(--line))' }}>
      <div style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: pending ? 'color-mix(in oklab, var(--gold) 18%, var(--surface))' : 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: pending ? '#8a6717' : 'var(--sage)' }}><Icon name={pending ? 'sparkle' : 'calCheck'} size={22} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>{pending ? 'Can you serve?' : 'You’re serving'}</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: pending ? '#8a6717' : 'var(--sage)' }}>{pending ? `${pending} request${pending > 1 ? 's' : ''} waiting` : `${next.teamName} · ${next.role}`}</div>
      </div>
      <Icon name="chevR" size={18} color="var(--ink-3)" />
    </button>
  );
}

// a group leader creates an event for their group, right from the chat. Publishes via the member's
// own key (the relay only accepts it because the steward named them a leader of this group).
function GroupEventComposer({ group, ctx, onClose }) {
  const [title, setTitle] = useC('');
  const [date, setDate] = useC('');
  const [time, setTime] = useC('19:30');
  const [where, setWhere] = useC('');
  const [blurb, setBlurb] = useC('');
  const [busy, setBusy] = useC(false);
  const accent = group.accent || 'var(--clay)';
  const save = async () => {
    if (!title.trim() || !date) return;
    setBusy(true);
    const r = await ctx.publishGroupEvent(group.id, { title: title.trim(), date, time, where: where.trim(), blurb: blurb.trim(), accent });
    setBusy(false);
    if (r) { ctx.toast('Event posted to ' + group.name); onClose(); }
    else ctx.toast('Couldn’t post the event — you may not be a leader of this group.');
  };
  const fld = { width: '100%', boxSizing: 'border-box', height: 46, padding: '0 13px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' };
  const lbl = { fontSize: 11, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '14px 2px 6px' };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 120, background: 'rgba(20,15,10,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '92%', overflowY: 'auto', background: 'var(--surface)', borderRadius: '22px 22px 0 0', border: '1px solid var(--line)', borderBottom: 'none', boxShadow: 'var(--shadow-lg)', padding: '20px 18px 26px', animation: 'trinityRise .24s cubic-bezier(.2,.8,.3,1) both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: `color-mix(in oklab, ${accent} 16%, var(--surface))`, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="calPlus" size={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19 }}>New event</div><div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>for {group.name}</div></div>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--surface-2)', borderRadius: 999, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}><Icon name="x" size={17} /></button>
        </div>
        <div style={lbl}>Title</div>
        <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="e.g. Prayer breakfast" style={fld} />
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><div style={lbl}>Date</div><input type="date" value={date} onChange={e => setDate(e.target.value)} style={fld} /></div>
          <div style={{ width: 130 }}><div style={lbl}>Time</div><input type="time" value={time} onChange={e => setTime(e.target.value)} style={fld} /></div>
        </div>
        <div style={lbl}>Where</div>
        <input value={where} onChange={e => setWhere(e.target.value)} placeholder="e.g. Church café" style={fld} />
        <div style={lbl}>Note (optional)</div>
        <textarea value={blurb} onChange={e => setBlurb(e.target.value)} rows={3} placeholder="A short description members will read." style={{ ...fld, height: 'auto', padding: '11px 13px', lineHeight: 1.5, resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 13, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Cancel</button>
          <button onClick={save} disabled={busy || !title.trim() || !date} style={{ flex: 1.4, padding: 13, borderRadius: 13, border: 'none', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', opacity: (busy || !title.trim() || !date) ? 0.55 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}><Icon name="calPlus" size={16} color="#fff" /> {busy ? 'Posting…' : 'Post event'}</button>
        </div>
      </div>
    </div>
  );
}

function ChatRoom({ group, open, onClose, ctx, docked }) {
  const [msgs, setMsgs] = useC([]);
  const [draft, setDraft] = useC('');
  const [prayerOn, setPrayerOn] = useC(false);   // flag this message as a prayer request (always available)
  const [pollOpen, setPollOpen] = useC(false);   // compact poll composer open?
  const [pollQ, setPollQ] = useC('');
  const [pollOpts, setPollOpts] = useC(['', '']);
  const [reactions, setReactions] = useC({});    // targetId -> { reactorPubkey: {content, ts} }
  const [pickerFor, setPickerFor] = useC(null);  // message id whose emoji picker is open
  const [composeEvt, setComposeEvt] = useC(false); // group-leader event composer open?
  const [pin, setPin] = useC(null);              // the group's pinned message { msgId, text, by, ts } or null
  const [hidden, setHidden] = useC(null);        // Set of removed message ids (null until first load)
  const [menuFor, setMenuFor] = useC(null);      // message id whose leader actions menu is open
  const isLeader = !!group && (ctx.myLeaderGroups || []).some(g => g.id === group.id);
  const churchNpub = ctx.church && ctx.church.npub;
  const isBroadcast = !!group && group.kind === 'Broadcast';   // one-to-many: members read, only church/leaders post
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
      setPin(null); setHidden(null); setMenuFor(null);
      const unsub = window.Fellowship.subscribeGroup(group.id, add);
      const unsubR = window.Fellowship.subscribeReactions(group.id, (r) => {
        setReactions(prev => {
          const t = prev[r.targetId] ? { ...prev[r.targetId] } : {};
          if (t[r.pubkey] && t[r.pubkey].ts >= r.ts) return prev;
          t[r.pubkey] = { content: r.content, ts: r.ts };
          return { ...prev, [r.targetId]: t };
        });
      });
      const unsubP = window.Fellowship.subscribeGroupPin ? window.Fellowship.subscribeGroupPin(group.id, setPin) : null;
      const unsubH = window.Fellowship.subscribeHidden ? window.Fellowship.subscribeHidden(setHidden) : null;
      return () => { unsub(); unsubR(); if (unsubP) unsubP(); if (unsubH) unsubH(); };
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
      else if (extra.kind === 'poll') window.Fellowship.publishMessage(group.id, JSON.stringify({ question: extra.question, options: extra.options }), [['k', 'poll']]);
      else window.Fellowship.publishMessage(group.id, extra.text);
      return;
    }
    const base = { id: 'me-' + Date.now(), me: true, handle: id.handle, color: id.color, when: 'now' };
    setMsgs(prev => [...prev, { ...base, ...extra }]);
  };
  const sendText = () => { if (!draft.trim()) return; send(prayerOn ? { text: draft.trim(), kind: 'prayer' } : { text: draft.trim() }); setDraft(''); setPrayerOn(false); };
  const sendPoll = () => {
    const q = pollQ.trim(); const opts = pollOpts.map(o => o.trim()).filter(Boolean);
    if (!q || opts.length < 2) return;
    send({ kind: 'poll', question: q, options: opts.slice(0, 5) });
    setPollQ(''); setPollOpts(['', '']); setPollOpen(false);
  };
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
  // ── moderation (group leaders): pin a message, or remove (hide) it. Steward console can do both too. ──
  const canModerate = isLeader && !!churchNpub && !!(window.Fellowship && window.Fellowship.pinPost);
  const doPin = (m) => { window.Fellowship.pinPost(churchNpub, group.id, m); setMenuFor(null); ctx.toast('Pinned'); };
  const doUnpin = () => { window.Fellowship.unpin(churchNpub, group.id); ctx.toast('Unpinned'); };
  const doRemove = (m) => { window.Fellowship.hideMessage(churchNpub, group.id, m.id); setMenuFor(null); ctx.toast('Message removed'); };
  const hideSet = hidden || new Set();
  const visibleMsgs = msgs.filter(m => !hideSet.has(m.id));

  // events the church tagged to THIS group — surfaced here and on everyone's calendar
  const todayIso = new Date().toISOString().slice(0, 10);
  const groupEvents = (ctx.churchEvents || [])
    .filter(e => e.groupId && e.groupId === group.id && (e.date || '') >= todayIso)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '')).slice(0, 3);

  return (
    <Overlay open={open} onClose={onClose} docked={docked}>
      <div style={{ paddingTop: docked ? 12 : 50, background: 'color-mix(in oklab, var(--surface) 92%, transparent)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 14px 11px' }}>
          {!docked ? <button onClick={onClose} style={{ width: 38, height: 38, borderRadius: 12, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="chevL" size={22} /></button> : null}
          <div style={{ width: 40, height: 40, borderRadius: 13, background: `color-mix(in oklab, ${group.accent} 16%, var(--surface))`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: group.accent, flexShrink: 0 }}>
            <Icon name={group.prayer ? 'pray' : 'chat'} size={22} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, lineHeight: 1.1 }}>{group.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--sage)' }} /> {group.members ? `${group.members} anonymous` : 'Anonymous'} · Nostr</div>
          </div>
          {isLeader ? <button onClick={() => setComposeEvt(true)} title="Create an event for this group" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 38, padding: '0 12px', borderRadius: 12, border: 'none', cursor: 'pointer', background: 'var(--clay)', color: '#fff', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, flexShrink: 0 }}><Icon name="calPlus" size={16} color="#fff" /> Event</button> : null}
          <IconBtn name="shield" onClick={() => ctx.toast('Everyone here is anonymous')} />
        </div>
      </div>
      {composeEvt ? <GroupEventComposer group={group} ctx={ctx} onClose={() => setComposeEvt(false)} /> : null}

      {pin && pin.msgId ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 14px', background: 'color-mix(in oklab, var(--gold) 11%, var(--surface))', borderBottom: '1px solid color-mix(in oklab, var(--gold) 30%, var(--line))' }}>
          <Icon name="pin" size={15} color="var(--gold)" style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.5px', color: 'var(--gold)', marginBottom: 1 }}>PINNED</div>
            <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{pin.text || '(message)'}</div>
          </div>
          {canModerate ? <button onClick={doUnpin} title="Unpin" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 2, flexShrink: 0 }}><Icon name="x" size={16} /></button> : null}
        </div>
      ) : null}

      <div ref={scRef} className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ textAlign: 'center', margin: '2px 0 4px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--ink-3)', padding: '6px 13px', borderRadius: 999, fontSize: 11.5, fontWeight: 600 }}>
            <Icon name="lock" size={13} /> {group && group.encrypted ? 'End-to-end encrypted · not even the relay can read this' : 'Private to your church · no account needed'}</span>
        </div>
        {groupEvents.length ? (
          <div style={{ borderRadius: 16, background: 'color-mix(in oklab, var(--clay) 6%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 22%, var(--line))', padding: '12px 13px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9, fontSize: 11, fontWeight: 800, letterSpacing: '.5px', color: 'var(--clay-ink)' }}><Icon name="calendar" size={14} color="var(--clay)" /> UPCOMING IN THIS GROUP</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {groupEvents.map(e => {
                const p = (window.svParts ? window.svParts(e.date) : null) || {};
                const d = new Date(e.date + 'T00:00');
                const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] || '';
                const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] || '';
                return (
                  <button key={e.id} onClick={() => ctx.openEvent ? ctx.openEvent(e) : (ctx.openServing && ctx.openServing())} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: 8, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
                    <div style={{ width: 42, flexShrink: 0, textAlign: 'center', borderRadius: 10, padding: '5px 0', background: `color-mix(in oklab, ${e.accent || 'var(--clay)'} 13%, var(--surface))` }}>
                      <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: e.accent || 'var(--clay)' }}>{dow}</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, lineHeight: 1 }}>{d.getDate()}</div>
                      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase' }}>{mon}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{[e.time, e.where].filter(Boolean).join(' · ')}</div>
                    </div>
                    <Icon name="chevR" size={16} color="var(--ink-3)" />
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {visibleMsgs.map(m => <Bubble key={m.id} m={m} ctx={ctx}
          summary={summaryFor(m.id)} onReact={(emoji) => toggleReact(m.id, m.pubkey, emoji)}
          pickerOpen={pickerFor === m.id} onOpenPicker={() => setPickerFor(pickerFor === m.id ? null : m.id)}
          live={!!window.Fellowship}
          canModerate={canModerate} isPinned={!!(pin && pin.msgId === m.id)}
          menuOpen={menuFor === m.id} onOpenMenu={() => setMenuFor(menuFor === m.id ? null : m.id)}
          onPin={() => doPin(m)} onUnpin={doUnpin} onRemove={() => doRemove(m)} />)}
      </div>

      <div style={{ padding: '8px 12px 14px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
        {(ctx.joinState && ctx.joinState.isPending) ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 14px', color: 'var(--ink-3)', fontSize: 13, fontWeight: 600, textAlign: 'center', lineHeight: 1.45 }}>
            <Icon name="shield" size={16} color="var(--ink-3)" style={{ flexShrink: 0 }} /> Waiting for a steward to approve you — you’ll be able to post once you’re in.
          </div>
        ) : (isBroadcast && !isLeader) ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 14px', color: 'var(--ink-3)', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
            <Icon name="send" size={16} color="var(--ink-3)" /> Announcements only — your church posts here.
          </div>
        ) : (<React.Fragment>
        {prayerOn ? (
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'color-mix(in oklab, var(--gold) 15%, var(--surface))', color: 'var(--gold)', border: '1px solid color-mix(in oklab, var(--gold) 35%, transparent)', padding: '5px 8px 5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
              <Icon name="pray" size={13} color="var(--gold)" /> Prayer request
              <button onClick={() => setPrayerOn(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--gold)', display: 'flex', padding: 0 }}><Icon name="x" size={14} /></button>
            </span>
          </div>
        ) : null}
        {pollOpen ? (
          <div style={{ marginBottom: 8, padding: 11, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: '.5px', color: 'var(--clay)', marginBottom: 8 }}><Icon name="sliders" size={13} color="var(--clay)" /> NEW POLL<button onClick={() => setPollOpen(false)} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 0 }}><Icon name="x" size={15} /></button></div>
            <input value={pollQ} onChange={e => setPollQ(e.target.value)} placeholder="Ask a question…" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 10, padding: '9px 11px', fontSize: 14, fontFamily: 'var(--font-ui)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', marginBottom: 7 }} />
            {pollOpts.map((o, i) => (
              <input key={i} value={o} onChange={e => setPollOpts(prev => prev.map((x, j) => j === i ? e.target.value : x))} placeholder={'Option ' + (i + 1)} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 11px', fontSize: 13.5, fontFamily: 'var(--font-ui)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', marginBottom: 6 }} />
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              {pollOpts.length < 5 ? <button onClick={() => setPollOpts(prev => [...prev, ''])} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--clay)', fontWeight: 700, fontSize: 12.5, fontFamily: 'var(--font-ui)', padding: 0 }}>+ Add option</button> : null}
              <button onClick={sendPoll} disabled={!pollQ.trim() || pollOpts.filter(o => o.trim()).length < 2} style={{ marginLeft: 'auto', border: 'none', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-ui)', opacity: (pollQ.trim() && pollOpts.filter(o => o.trim()).length >= 2) ? 1 : 0.5 }}>Post poll</button>
            </div>
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <button onClick={shareVerse} title="Share a verse" style={{ width: 44, height: 44, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface-2)', cursor: 'pointer', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="sparkle" size={20} /></button>
          <button onClick={() => setPollOpen(v => !v)} title="Create a poll" style={{ width: 44, height: 44, borderRadius: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: pollOpen ? '1px solid var(--clay)' : '1px solid var(--line)', background: pollOpen ? 'color-mix(in oklab, var(--clay) 14%, var(--surface))' : 'var(--surface-2)', color: 'var(--clay)' }}>
            <Icon name="sliders" size={20} /></button>
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
        </React.Fragment>)}
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
  const FS = window.Fellowship;
  const churchNpub = ctx.church && ctx.church.npub;
  const [groups, setGroups] = useC([]);
  const [members, setMembers] = useC([]);
  // live church groups + member directory (the old code listed mock D.GROUPS, so a real church showed nothing)
  useCE(() => {
    setGroups([]); setMembers([]);
    if (!open || !churchNpub || !FS) return;
    const offs = [];
    if (FS.subscribeChurchGroups) offs.push(FS.subscribeChurchGroups(churchNpub, setGroups));
    if (FS.subscribeChurchMembers) offs.push(FS.subscribeChurchMembers(churchNpub, (list) => setMembers(list || [])));
    return () => offs.forEach(o => { try { o && o(); } catch {} });
  }, [open, churchNpub]);
  if (!payload) return null;
  const type = payload.type || 'verse';
  const live = !!(FS && FS.publishMessage);
  const heading = type === 'devotional' ? 'Share devotional' : type === 'note' ? 'Share note' : 'Share verse';
  const myPub = FS && FS.myPubkey;
  // groups I can post to — hide invite-only groups I'm not a member of (the relay enforces posting too)
  const postable = (groups || []).filter(g => g && g.id && (g.visibility !== 'invite' || (Array.isArray(g.members) && myPub && g.members.includes(myPub))));
  // people I'm allowed to message — ctx.canDMPeer already excludes children unless I'm cleared ("if set that way")
  const people = (members || []).filter(m => m && m.pubkey && m.pubkey !== myPub && (!ctx.canDMPeer || ctx.canDMPeer(m.pubkey)));
  // a verse/devotional/note sent to a person goes as a readable DM (DMs don't render the card payload)
  const asText = payload.text ? ('“' + payload.text + '” — ' + payload.ref + (payload.version ? ' · ' + payload.version : ''))
    : payload.title ? (payload.title + (payload.ref ? ' — ' + payload.ref : '') + (payload.excerpt ? '\n' + payload.excerpt : '')) : '';
  const sendToGroup = (g) => {
    if (!live) { ctx.toast('Chat isn’t available'); return; }
    FS.publishMessage(g.id, JSON.stringify(payload), [['k', type]]);
    ctx.toast('Shared to ' + g.name); onClose();
  };
  const sendToPerson = (m) => {
    if (!FS || !FS.sendDM) { ctx.toast('Messaging isn’t available'); return; }
    FS.sendDM(m.pubkey, asText);
    ctx.toast('Sent to ' + (m.name || 'them')); onClose();
  };
  const lblStyle = { fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '4px 0 10px' };
  const rowStyle = { width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--ink)', textAlign: 'left', boxShadow: 'var(--shadow)' };
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

      {postable.length ? (
        <React.Fragment>
          <div style={lblStyle}>SEND TO A GROUP</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: people.length ? 18 : 0 }}>
            {postable.map(g => (
              <button key={g.id} onClick={() => sendToGroup(g)} style={rowStyle}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: `color-mix(in oklab, ${g.accent || 'var(--clay)'} 16%, var(--surface))`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: g.accent || 'var(--clay)', flexShrink: 0 }}>
                  <Icon name={g.prayer ? 'pray' : 'chat'} size={20} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{g.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{g.kind || 'Group'}</div></div>
                <Icon name="send" size={17} color="var(--clay)" />
              </button>
            ))}
          </div>
        </React.Fragment>
      ) : null}

      {people.length ? (
        <React.Fragment>
          <div style={lblStyle}>SEND TO SOMEONE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {people.map(m => {
              const d = (FS && FS.displayFor) ? FS.displayFor(m.pubkey) : { handle: m.name || 'Member', av: { kind: 'symbol', color: '#5E8C6A', symbol: 'halo' } };
              return (
                <button key={m.pubkey} onClick={() => sendToPerson(m)} style={rowStyle}>
                  <UserAvatar av={avOf(d)} name={m.name || d.handle} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || d.handle}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Direct message</div></div>
                  <Icon name="send" size={17} color="var(--clay)" />
                </button>
              );
            })}
          </div>
        </React.Fragment>
      ) : null}

      {!postable.length && !people.length ? (
        <div style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 14, padding: '20px 10px', lineHeight: 1.55 }}>
          No groups or people to send to yet — join a group or wait for others to join your church.
        </div>
      ) : null}
    </BottomSheet>
  );
}

// ── direct message thread (1:1, encrypted) ──
function DMThread({ peer, open, onClose, ctx }) {
  const [msgs, setMsgs] = useC([]);
  const [draft, setDraft] = useC('');
  const [rxFor, setRxFor] = useC('');
  const scRef = useCR();
  const FS = window.Fellowship;
  const DM_EMOJI = ['❤️', '🙏', '👍', '😂', '😮', '😢'];
  const d = (FS && FS.displayFor && peer) ? FS.displayFor(peer) : { handle: 'Member', av: { kind: 'symbol', color: '#5E8C6A', symbol: 'halo' } };
  useCE(() => {
    setMsgs([]); setDraft('');
    if (!peer || !FS || !FS.subscribeThread) return;
    if (FS.requestProfiles) FS.requestProfiles([peer]);
    return FS.subscribeThread(peer, (m) => setMsgs(prev => {
      const i = prev.findIndex(x => x.id === m.id);
      if (i === -1) return [...prev, m].sort((a, b) => (a.ts || 0) - (b.ts || 0));
      const next = prev.slice(); next[i] = m; return next;
    }));
  }, [peer]);
  useCE(() => { if (open && scRef.current) scRef.current.scrollTop = scRef.current.scrollHeight; }, [msgs, open]);
  if (!peer) return null;
  const allowDM = !ctx || !ctx.canDMPeer || ctx.canDMPeer(peer);   // safeguarding: a child↔non-cleared-adult DM is blocked (the relay rejects it too)
  const send = () => { if (!draft.trim() || !FS || !allowDM) return; FS.sendDM(peer, draft.trim()); setDraft(''); };
  const react = (m, emoji) => { if (FS && FS.reactDM) FS.reactDM(peer, m.id, m.myReaction === emoji ? '-' : emoji); setRxFor(''); };
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 14px 11px' }}>
          <button onClick={onClose} style={{ width: 38, height: 38, borderRadius: 12, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="chevL" size={22} /></button>
          <UserAvatar av={avOf(d)} name={d.handle} size={38} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, lineHeight: 1.1 }}>{d.handle}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="lock" size={12} color="var(--sage)" /> Direct message · encrypted</div>
          </div>
        </div>
      </div>
      <div ref={scRef} className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ textAlign: 'center', margin: '2px 0 6px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--ink-3)', padding: '6px 13px', borderRadius: 999, fontSize: 11.5, fontWeight: 600 }}>
            <Icon name="lock" size={13} /> Only you two can read these messages</span>
        </div>
        {msgs.map(m => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: m.mine ? 'flex-end' : 'flex-start' }}>
            <div onClick={() => setRxFor(v => v === m.id ? '' : m.id)} style={{ maxWidth: 274, borderRadius: 18, padding: '10px 14px', boxShadow: 'var(--shadow)', cursor: 'pointer',
              background: m.mine ? 'var(--clay)' : 'var(--surface)', color: m.mine ? '#fff' : 'var(--ink)',
              border: m.mine ? 'none' : '1px solid var(--line)', borderBottomRightRadius: m.mine ? 5 : 18, borderBottomLeftRadius: m.mine ? 18 : 5 }}>
              <p style={{ fontFamily: 'var(--font-ui)', fontSize: 14.5, lineHeight: 1.45, margin: 0, textWrap: 'pretty', wordBreak: 'break-word' }}>{m.content}</p>
            </div>
            {m.reactions && m.reactions.length ? (
              <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                {Object.entries(m.reactions.reduce((a, e) => (a[e] = (a[e] || 0) + 1, a), {})).map(([emo, n]) => (
                  <button key={emo} onClick={() => react(m, emo)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 999, fontSize: 12.5, border: '1px solid var(--line)', background: m.myReaction === emo ? 'color-mix(in oklab, var(--clay) 16%, var(--surface))' : 'var(--surface)', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>{emo}{n > 1 ? <span style={{ color: 'var(--ink-3)', fontWeight: 700 }}>{n}</span> : null}</button>
                ))}
              </div>
            ) : null}
            {rxFor === m.id ? (
              <div style={{ display: 'flex', gap: 3, marginTop: 5, padding: '5px 8px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, boxShadow: 'var(--shadow)' }}>
                {DM_EMOJI.map(emo => (
                  <button key={emo} onClick={() => react(m, emo)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '2px 4px', borderRadius: 8, opacity: m.myReaction === emo ? 1 : 0.9 }}>{emo}</button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {allowDM ? (
        <div style={{ padding: '8px 12px 14px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9 }}>
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={1}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Message privately…" style={{ flex: 1, resize: 'none', minHeight: 44, maxHeight: 96, padding: '12px 15px', borderRadius: 16,
                border: '1px solid var(--line)', background: 'var(--surface-2)', outline: 'none', fontSize: 14.5, fontFamily: 'var(--font-ui)', color: 'var(--ink)', lineHeight: 1.35 }} />
            <button onClick={send} style={{ width: 44, height: 44, borderRadius: 14, border: 'none', flexShrink: 0,
              background: draft.trim() ? 'var(--clay)' : 'var(--line)', cursor: draft.trim() ? 'pointer' : 'default',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .2s' }}>
              <Icon name="send" size={20} color="#fff" /></button>
          </div>
        </div>
      ) : (
        <div style={{ padding: '14px 16px 18px', borderTop: '1px solid var(--line)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-2)' }}>
          <Icon name="lock" size={17} color="var(--ink-3)" style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>For safeguarding, private messaging is limited here. Speak with your church leaders if you need to get in touch.</div>
        </div>
      )}
    </Overlay>
  );
}

// ── direct-message inbox (conversation list) ──
function DMInbox({ open, onClose, ctx }) {
  const [convos, setConvos] = useC([]);
  const FS = window.Fellowship;
  useCE(() => { if (!open || !FS || !FS.subscribeDMs) return; return FS.subscribeDMs(setConvos); }, [open]);
  useCE(() => { if (convos.length && FS && FS.requestProfiles) FS.requestProfiles(convos.map(c => c.peer)); }, [convos]);
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 18px 12px' }}>
          <IconBtn name="chevL" onClick={onClose} />
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700 }}>Messages</h1>
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '6px 16px 30px' }}>
        {convos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '54px 24px', color: 'var(--ink-3)' }}>
            <Icon name="chat" size={30} color="var(--ink-3)" />
            <p style={{ margin: '12px 0 0', fontFamily: 'var(--font-read)', fontSize: 16, lineHeight: 1.5 }}>No messages yet. Open a group, tap someone’s name, and message them privately.</p>
          </div>
        ) : convos.map(c => {
          const d = FS.displayFor(c.peer);
          return (
            <div key={c.peer} onClick={() => ctx.openDM(c.peer)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 6px', borderBottom: '1px solid var(--line-2)', cursor: 'pointer' }}>
              <UserAvatar av={avOf(d)} name={d.handle} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>{d.handle}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-3)', flexShrink: 0 }}>{relTime(c.lastTs)}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.preview}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Overlay>
  );
}

// ── People: the church directory — find a member and message them ──
function PeopleScreen({ open, onClose, ctx }) {
  const FS = window.Fellowship;
  const [q, setQ] = React.useState('');
  // the roster is prefetched at app load (ctx.churchPeople), so it's already warm when this opens
  const members = ctx.churchPeople || [];
  const loading = !!ctx.churchPeopleLoading;
  const me = FS && FS.myPubkey;
  // a member's display: their chosen name, else their @handle (nip05 local part), else the anonymous handle
  const nameOf = (m) => (m.name && m.name.trim()) || (m.nip05 ? String(m.nip05).split('@')[0] : '') || FS.displayFor(m.pubkey).handle;
  const ql = q.trim().toLowerCase();
  const people = members.filter(m => m.pubkey !== me);
  // name-clash count: a name shared by 2+ people needs a discriminator so they're tellable apart
  const nameCounts = {}; people.forEach(m => { const n = nameOf(m).trim().toLowerCase(); if (n) nameCounts[n] = (nameCounts[n] || 0) + 1; });
  const list = people.filter(m => !ql || nameOf(m).toLowerCase().includes(ql) || (m.nip05 || '').toLowerCase().includes(ql));
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, flexShrink: 0, background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 6px' }}>
          <IconBtn name="chevL" onClick={onClose} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700 }}>People</h1>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{(ctx.church && ctx.church.name) || 'Your church'} · {people.length} {people.length === 1 ? 'person' : 'people'}</div>
          </div>
        </div>
        <div style={{ padding: '6px 16px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 13px', height: 44, borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <Icon name="study" size={17} color="var(--ink-3)" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search people…" style={{ flex: 1, border: 'none', background: 'none', outline: 'none', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)' }} />
          </div>
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 16px 30px' }}>
        {(!FS.myProfile || !(FS.myProfile.name && FS.myProfile.name.trim())) ? (
          <div onClick={() => { onClose(); ctx.openProfile(); }} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 13px', margin: '4px 0 12px', borderRadius: 14, cursor: 'pointer', background: 'color-mix(in oklab, var(--clay) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, transparent)' }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, background: 'var(--clay)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="pen" size={17} color="#fff" /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink)' }}>Add your name</div>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.4 }}>You’re showing as “{me ? FS.displayFor(me).handle : 'Anonymous'}”. A name helps your church know you.</div>
            </div>
            <Icon name="chevR" size={17} color="var(--clay)" />
          </div>
        ) : null}
        {loading && people.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '54px 24px', color: 'var(--ink-3)' }}>
            <div style={{ width: 26, height: 26, margin: '0 auto', borderRadius: 999, border: '2.5px solid var(--line)', borderTopColor: 'var(--clay)', animation: 'trinitySpin .8s linear infinite' }} />
            <p style={{ marginTop: 14, fontSize: 14 }}>Loading people…</p>
          </div>
        ) : list.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '54px 24px', color: 'var(--ink-3)' }}>
            <Icon name="users" size={30} color="var(--ink-3)" />
            <p style={{ margin: '12px 0 0', fontFamily: 'var(--font-read)', fontSize: 16, lineHeight: 1.5, maxWidth: 260, marginLeft: 'auto', marginRight: 'auto' }}>{q ? 'No one matches that.' : 'No one else has joined yet. As your church follows along, they’ll show up here to chat with.'}</p>
          </div>
        ) : list.map(m => {
          const d = FS.displayFor(m.pubkey);
          const name = nameOf(m);
          const local = m.nip05 ? String(m.nip05).split('@')[0] : '';
          const dup = local && name.toLowerCase().replace(/[^a-z0-9]+/g, '') === local.toLowerCase();   // name already is the handle
          // same name as someone else here, and no verified @handle to tell them apart → show a short key tag
          const clashNoHandle = !local && (nameCounts[name.trim().toLowerCase()] || 0) > 1;
          const keyTag = m.npub ? (m.npub.slice(0, 9) + '…' + m.npub.slice(-4)) : '';
          const allowDM = !ctx.canDMPeer || ctx.canDMPeer(m.pubkey);   // safeguarding: a child↔non-cleared-adult DM is blocked
          return (
            <div key={m.pubkey} onClick={() => { if (!allowDM) return; onClose(); ctx.openDM(m.pubkey); }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 6px', borderBottom: '1px solid var(--line-2)', cursor: allowDM ? 'pointer' : 'default', opacity: allowDM ? 1 : 0.65 }}>
              <UserAvatar av={avOf(d)} name={name} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                {local && !dup ? <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-3)' }}>@{local}<Icon name="check" size={11} stroke={3} color="var(--sage)" /></div>
                  : clashNoHandle && keyTag ? <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontFamily: 'var(--mono, monospace)', color: 'var(--ink-3)' }} title="Shares a name with someone else — this is their unique key">· {keyTag}</div> : null}
              </div>
              {allowDM
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--line)', borderRadius: 999, padding: '7px 12px', color: 'var(--clay)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, flexShrink: 0 }}><Icon name="chat" size={14} color="currentColor" /> Message</span>
                : <span title="Private messages are limited for safeguarding" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--line)', borderRadius: 999, padding: '7px 12px', color: 'var(--ink-3)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, flexShrink: 0 }}><Icon name="lock" size={13} color="currentColor" /> Restricted</span>}
            </div>
          );
        })}
      </div>
    </Overlay>
  );
}

Object.assign(window, { ChatScreen, ChatRoom, VerseShareSheet, DMThread, DMInbox, PeopleScreen });
