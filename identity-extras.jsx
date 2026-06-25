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

      <button onClick={() => { onClose(); ctx.toast('Direct messages coming soon'); }} style={{
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
  const doExport = async () => {
    // SECURITY-AUDIT-2026-06-24 L5: raised the floor from 6 → 10. PBKDF2-600k is already strong;
    // the bottleneck is the user's passphrase choice. 6 alnum chars ≈ 36 bits keyspace —
    // GPU-crackable in hours against a leaked encrypted blob. 10 chars (~60 bits) is meaningfully
    // harder. The user-facing hint says so plainly.
    if (pass.length < 10) { setBkErr('Use a passphrase of at least 10 characters — your backup is only as strong as this.'); return; }
    setBusy('export'); setBkErr('');
    try {
      const obj = await window.TrinityBackup.collectMember();
      const text = await window.TrinityBackup.encryptObj(obj, pass);
      await window.TrinityBackup.saveFile('trinityone-backup-' + new Date().toISOString().slice(0, 10) + '.json', text);
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
    <BottomSheet open={open} onClose={onClose} maxHeight="86%" z={60}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, background: 'color-mix(in oklab, var(--sage) 16%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="shield" size={20} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700 }}>Recovery phrase</div>
        </div>
        <IconBtn name="x" onClick={onClose} />
      </div>
      <p style={{ fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '6px 0 16px', textWrap: 'pretty' }}>
        These 12 words are the <b style={{ color: 'var(--ink)' }}>only</b> way to restore your identity if you lose this device. Write them down and keep them somewhere safe — never share them.</p>

      <div style={{ position: 'relative', borderRadius: 18, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: 4, filter: shown ? 'none' : 'blur(7px)', transition: 'filter .25s' }}>
          {words.map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--ink-3)', width: 16 }}>{i + 1}</span>
              <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>{w}</span>
            </div>
          ))}
        </div>
        {!shown ? (
          <button onClick={() => setShown(true)} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            border: 'none', background: 'rgba(20,14,8,.04)', cursor: 'pointer', color: 'var(--ink)', fontWeight: 700, fontSize: 14.5, fontFamily: 'var(--font-ui)' }}>
            <Icon name="key" size={26} color="var(--ink)" /> Tap to reveal</button>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button onClick={copyPhrase} style={{ flex: 1, padding: 13, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, boxShadow: 'var(--shadow)' }}>
          <Icon name="copy" size={16} /> Copy</button>
        <button onClick={() => { onClose(); ctx.toast('Backed up'); }} style={{ flex: 1, padding: 13, borderRadius: 14, border: 'none', background: 'var(--sage)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
          <Icon name="check" size={16} stroke={2.4} color="#fff" /> I’ve saved it</button>
      </div>

      {/* full encrypted backup file (key + your highlights, notes, journal, plans) */}
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>Encrypted backup file</div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '4px 0 12px' }}>One file with your identity <i>and</i> your highlights, notes, journal and plans — protected by a passphrase. Save it to Drive, OneDrive or Files; restore it on a new phone.</p>
        {!bk ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => { setBk('export'); setPass(''); setBkErr(''); }} style={{ flex: 1, padding: 12, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, boxShadow: 'var(--shadow)' }}><Icon name="share" size={15} /> Back up</button>
            <button onClick={() => { setBk('restore'); setPass(''); setBkErr(''); setFile(null); }} style={{ flex: 1, padding: 12, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, boxShadow: 'var(--shadow)' }}><Icon name="refresh" size={15} /> Restore</button>
          </div>
        ) : (
          <div style={{ padding: 13, borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            {bk === 'restore' ? (
              <input type="file" accept=".json,application/json" onChange={e => setFile(e.target.files && e.target.files[0])} style={{ width: '100%', fontSize: 13, marginBottom: 10, fontFamily: 'var(--font-ui)' }} />
            ) : null}
            <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder={bk === 'export' ? 'Choose a passphrase' : 'Your backup passphrase'} style={{ width: '100%', boxSizing: 'border-box', height: 44, border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface)', padding: '0 13px', fontSize: 14.5, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' }} />
            {bkErr ? <div style={{ fontSize: 12.5, color: 'var(--clay)', fontWeight: 600, marginTop: 7 }}>{bkErr}</div> : null}
            <div style={{ display: 'flex', gap: 9, marginTop: 11 }}>
              <button onClick={() => { setBk(null); setBkErr(''); }} style={{ flex: 1, padding: 11, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Cancel</button>
              <button onClick={bk === 'export' ? doExport : doRestore} disabled={!!busy} style={{ flex: 1, padding: 11, borderRadius: 12, border: 'none', background: bk === 'restore' ? 'var(--clay)' : 'var(--sage)', color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', opacity: busy ? 0.6 : 1 }}>{busy ? '…' : (bk === 'export' ? 'Create backup' : 'Restore')}</button>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
window.RecoverySheet = RecoverySheet;

// ════════ Steward invite ════════
// Builds a real, scannable invite: <base>/?invite=<fresh-identity>&follow=<church>&relay=<relay>.
// Scanning it (any camera or the in-app scanner) opens TrinityOne, adopts the ready-made anonymous
// identity, and joins the church — one scan, no email/phone.
function inviteUrlFor(mnemonic, ctx) {
  const o = (typeof location !== 'undefined' && location.origin) || '';
  // the APK / local dev run on a localhost origin (capacitor://localhost, http://localhost) that no one
  // else can reach — so invite links must use the public app URL, not this device's origin.
  const usable = /^https:\/\//i.test(o) && !/localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\./i.test(o);
  const base = usable ? o : 'https://app.trinityone.church';
  // carry the church's real relay (a TrinityOne community node), not one derived from this origin
  const F = window.Fellowship;
  const relay = (F && F.CANONICAL_RELAY) || 'wss://app.trinityone.church/relay';
  const np = (ctx.church && /^npub1[0-9a-z]+$/.test(ctx.church.npub || '')) ? ctx.church.npub : '';
  return base + '/?invite=' + encodeURIComponent(mnemonic) + (np ? '&follow=' + np : '') + '&relay=' + encodeURIComponent(relay);
}

function InviteSheet({ open, onClose, identity, ctx }) {
  // generate a REAL invite (a fresh anonymous key for someone to import) when the sheet opens
  const [invite, setInvite] = useIx(null);
  useIxE(() => {
    const ID = window.TrinityIdentity;
    if (open && ID && ID.makeInvite) setInvite(ID.makeInvite()); else if (open) setInvite(null);
  }, [open]);
  const url = invite ? inviteUrlFor(invite.mnemonic, ctx) : '';
  const qrSvg = (invite && window.TrinityIdentity && window.TrinityIdentity.qrSVG) ? window.TrinityIdentity.qrSVG(url) : '';
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
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700 }}>Steward invite</div>
        <IconBtn name="x" onClick={onClose} />
      </div>
      <p style={{ fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '4px 0 18px', textWrap: 'pretty' }}>
        Have a new member scan this to join {(ctx.church && ctx.church.name) || 'your church'} — no email or phone needed.</p>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
        <div style={{ padding: 16, borderRadius: 22, background: '#fff', boxShadow: 'var(--shadow-lg)', width: 196, height: 196, boxSizing: 'border-box', display: 'flex' }}
          dangerouslySetInnerHTML={{ __html: qrSvg }} />
      </div>
      {invite ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, justifyContent: 'center', marginBottom: 16 }}>
          <Avatar handle={invite.profile.handle} color={invite.profile.color} size={26} />
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>They’ll join as <b style={{ color: 'var(--ink-2)' }}>{invite.profile.handle}</b></span>
        </div>
      ) : null}
      <button onClick={shareInvite} style={{ width: '100%', padding: 15, borderRadius: 15, border: 'none', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
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
