// control.js — extracted from control.html so it runs under the strict CSP (script-src 'self',
// no 'unsafe-inline'). The member app + steward console are already external-script-only; this file
// brings the relay control panel in line. See gateway CSP (_strictWeb).
  const qs = new URLSearchParams(location.search);
  // public base: the Funnel URL once it's up (set by the wizard), else ?public=…, else this origin
  let publicBase = qs.get('public') || location.origin;
  const copyMap = { wss: '', console: '' };
  function reachInfo() {
    const wssUrl = publicBase.replace(/^https:/i,'wss:').replace(/^http:/i,'ws:') + '/relay';
    const consoleUrl = publicBase + '/steward.html';
    const isPublic = /^https:|\.ts\.net|trycloudflare|\.app/i.test(publicBase) && !/localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\./.test(publicBase);
    return { wssUrl, consoleUrl, isPublic };
  }
  function refreshReach() {
    const { wssUrl, consoleUrl, isPublic } = reachInfo();
    document.getElementById('wss').textContent = wssUrl;
    document.getElementById('console').textContent = consoleUrl;
    copyMap.wss = wssUrl; copyMap.console = consoleUrl;
    document.getElementById('reach').innerHTML = isPublic
      ? '<div class="row" style="background:color-mix(in oklab, var(--sage) 9%, var(--surface)); border-color:color-mix(in oklab, var(--sage) 28%, transparent)"><span style="color:var(--sage); font-weight:700; font-size:13px">✓ Reachable from anywhere</span><span class="muted" style="margin-left:auto">'+publicBase.replace(/^https?:\/\//,'')+'</span></div>'
      : '<div class="warn">⚠ This relay is only reachable on your computer / local network. Turn on public access below — one click, no terminal.</div>';
  }
  // Return to the Steward console IN THIS WINDOW — window.open('_blank') doesn't work in the desktop app's
  // webview. Prefer going back (preserves the console's state); fall back to navigating there fresh.
  document.getElementById('openConsole').onclick = () => { if (history.length > 1) { history.back(); } else { location.href = '/relay-app/home.html'; } };   // fall back to the launcher (neutral) — not the full-suite console, which contradicts a "Relay only" choice
  document.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(copyMap[b.dataset.copy]); b.textContent = 'Copied'; setTimeout(()=>b.textContent='Copy', 1400); } catch(e){}
  });
  refreshReach();

  const initials = (n) => (n||'?').split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  async function poll() {
    try {
      const r = await fetch('/status', { cache:'no-store' });
      const s = await r.json();
      document.getElementById('dot').className = 'dot on';
      document.getElementById('title').textContent = 'Your relay is running';
      const up = Math.floor(s.uptimeMs/1000); const h=Math.floor(up/3600), m=Math.floor((up%3600)/60);
      document.getElementById('sub').textContent = 'Up ' + (h?h+'h ':'') + m + 'm · port ' + s.port;
      document.getElementById('s-churches').textContent = s.counts.churches;
      document.getElementById('s-members').textContent = s.counts.members;
      document.getElementById('s-events').textContent = s.counts.events;
      document.getElementById('s-conns').textContent = s.counts.connections;
      // sync health — the point of the card is 'is this working?', not a button
      const sw = document.getElementById('syncWhen');
      if (sw && s.sync) {
        if (s.sync.running) { sw.textContent = 'checking now\u2026'; }
        else if (!s.sync.at) { sw.textContent = s.sync.peers ? 'not yet \u2014 first check runs shortly' : 'no other relays to check'; }
        else {
          const mins = Math.floor((Date.now() / 1000 - s.sync.at) / 60);
          const when = mins < 1 ? 'just now' : mins === 1 ? '1 minute ago' : mins < 60 ? mins + ' minutes ago' : Math.floor(mins / 60) + 'h ago';
          sw.textContent = s.sync.ok === false ? when + ' \u2014 failed' : when + (s.sync.imported ? ' \u00b7 pulled ' + s.sync.imported : ' \u00b7 nothing new');
          sw.style.color = s.sync.ok === false ? 'var(--clay-ink)' : '';
        }
      }
    } catch (e) {
      document.getElementById('dot').className = 'dot off';
      document.getElementById('title').textContent = 'Relay not reachable';
      document.getElementById('sub').textContent = 'Is the relay running? Restart the app.';
    }
  }
  poll(); setInterval(poll, 5000);

  // ── setup wizard: read/write the relay's write policy (church.json) via /config ──
  const TOKEN_KEY = 'to_relay_admin_token';
  let adminToken = localStorage.getItem(TOKEN_KEY) || '';
  let cfgChurches = [];
  const esc = (s) => String(s||'').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const authHeaders = () => adminToken ? { 'Authorization': 'Bearer ' + adminToken } : {};

  // RELAY-UX-2026-07-20: the church list is a LIVE view of the server, not a form.
  // It used to be an editable array with a Save button, and that shape caused the incident this rewrite
  // exists for: Remove spliced a local array, Save posted the whole list, the server echoed the request
  // back, and the UI painted "✓ Saved" over a list the server had never agreed to. Refresh silently
  // discarded edits; the headline stat and the list below it could disagree; and a row gave the operator
  // nothing to judge by — no idea how it got there or what it held — which is what made a bulk delete
  // look reasonable. Now: each row acts on its own, immediately, and every action re-reads the server.
  const fmtBytes = (n) => !n ? '' : n > 1048576 ? (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const ago = (t) => { if (!t) return ''; const d = Math.floor((Date.now() / 1000 - t) / 86400);
    return d < 1 ? 'today' : d === 1 ? 'yesterday' : d < 31 ? d + ' days ago' : d < 365 ? Math.round(d / 30) + ' months ago' : Math.round(d / 365) + ' years ago'; };
  function rowMeta(c) {
    const bits = [];
    // provenance: "you added this" vs "it registered itself" is the single most useful thing on the row
    if (c.by === 'self') bits.push('registered itself' + (c.at ? ' ' + ago(c.at) : ''));
    else if (c.by === 'operator') bits.push('you added this' + (c.at ? ' ' + ago(c.at) : ''));
    if (typeof c.events === 'number') bits.push(c.events ? c.events.toLocaleString() + (c.events === 1 ? ' message' : ' messages') : 'nothing stored');
    const b = fmtBytes(c.bytes); if (b) bits.push(b + ' of files');
    return bits.join(' · ');
  }
  function renderCfg() {
    const list = document.getElementById('cfgList');
    list.innerHTML = cfgChurches.length ? cfgChurches.map((c, i) =>
      '<div class="ch" style="align-items:flex-start">' +
        '<div class="badge">'+initials(c.name)+'</div>' +
        '<div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:4px">' +
          '<div style="font-weight:700; font-size:14px">'+(c.name ? esc(c.name) : '<span class="muted">Unnamed church</span>')+'</div>' +
          '<div class="muted" style="font-family:var(--mono); font-size:11px; word-break:break-all">'+esc(c.npub)+'</div>' +
          (rowMeta(c) ? '<div class="muted" style="font-size:11.5px">'+esc(rowMeta(c))+'</div>' : '') +
        '</div>' +
        '<button class="btn-ghost" data-rm="'+i+'">Remove…</button>' +
      '</div>').join('')
      : '<div class="warn" style="margin-bottom:8px"><span>⚠</span><span><b>No churches yet.</b> Until you add one, this relay accepts messages from anyone on the internet. Add your church below.</span></div>';
    list.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => removeChurch(cfgChurches[+b.dataset.rm]));
  }

  // Remove is now a real, immediate, two-stage action. Stage one asks the relay what this church actually
  // HOLDS (a dry run that changes nothing) so the operator is never guessing; stage two offers the two
  // genuinely different outcomes, because "remove" meant only "stop accepting their posts" and nothing on
  // the old screen said so — their messages, care records and files stayed on the disk, unreadable and
  // unreclaimable, and an operator who removed a church to PROTECT it was simply wrong.
  async function removeChurch(c) {
    if (!c) return;
    const msg = document.getElementById('cfgMsg');
    const who = c.name || 'this church';
    let d;
    try {
      const r = await fetch('/config', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ removeChurch: { npub: c.npub } }) });
      d = await r.json();
      if (!r.ok) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '✗ ' + (d.error || 'could not check that church'); return; }
    } catch (e) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '✗ could not reach the relay'; return; }

    const w = d.wouldDelete || { events: 0, blobs: 0, bytes: 0 };
    const held = w.events ? `${w.events.toLocaleString()} stored message${w.events === 1 ? '' : 's'}${w.bytes ? ' and ' + fmtBytes(w.bytes) + ' of files' : ''}` : 'nothing stored';
    if (!window.confirm(`Stop ${who} posting to this relay?\n\nThey have ${held} here.\n\nOK = stop them posting, KEEP their data.\nCancel = change nothing.`)) return;

    let purge = false;
    if (w.events || w.blobs) {
      purge = window.confirm(`Also ERASE ${who}'s ${held}?\n\nOK = erase it permanently. This cannot be undone and it frees the space.\nCancel = keep the data on this relay (they just can't post).`);
    }
    msg.style.color = 'var(--ink-3)'; msg.textContent = purge ? 'Erasing…' : 'Removing…';
    try {
      const r = await fetch('/config', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ removeChurch: { npub: c.npub, confirm: true, purge } }) });
      const s = await r.json();
      if (!r.ok) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '✗ ' + (s.error || 'could not remove that church'); await loadConfig(); return; }
      msg.style.color = 'var(--sage-ink)';
      msg.textContent = purge && s.purged ? `✓ ${who} removed — ${(s.purged.events || 0).toLocaleString()} messages and ${fmtBytes(s.purged.bytes) || '0 KB'} erased` : `✓ ${who} can no longer post here — their data is still stored`;
      setTimeout(() => { msg.textContent = ''; }, 5000);
    } catch (e) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '✗ ' + e.message; }
    await loadConfig();   // never trust the write's own echo — re-read the server
  }

  async function loadConfig() {
    const gate = document.getElementById('cfgGate'), body = document.getElementById('cfgBody'), st = document.getElementById('cfgStatus');
    try {
      const r = await fetch('/config?stats=1', { headers: authHeaders(), cache: 'no-store' });   // stats so each row shows what it holds
      if (r.status === 401) { gate.style.display = 'block'; body.style.display = 'none'; document.getElementById('cfgList').innerHTML = ''; st.textContent = '· locked'; document.getElementById('servesCard').style.display = 'none'; document.getElementById('updateCard').style.display = 'none'; return; }
      const s = await r.json();
      gate.style.display = 'none'; body.style.display = 'block';
      st.textContent = s.configured ? '' : '· not set up yet';
      cfgChurches = (s.churches || []).map(c => ({ npub: c.npub, name: c.name, by: c.by, at: c.at, events: c.events, blobs: c.blobs, bytes: c.bytes }));
      renderCfg();
      loadServes();
      loadUpdate();
      loadSubs();
    } catch (e) { /* relay down — the hero card shows it */ }
  }
  let subsCache = [];
  async function loadSubs() {
    const card = document.getElementById('subsCard');
    try {
      const r = await fetch('/subscribe', { headers: authHeaders(), cache: 'no-store' });
      if (r.status === 401) { card.style.display = 'none'; return; }
      const s = await r.json();
      subsCache = s.subscribers || [];
      document.getElementById('subsCount').textContent = (s.count || 0) + (s.count === 1 ? ' email' : ' emails');
      card.style.display = (s.count > 0) ? 'block' : 'none';   // only surface once someone has signed up
    } catch (e) { card.style.display = 'none'; }
  }

  // (saveConfig removed — the list has no Save step now; each row acts immediately and re-reads.)

  // ── what this relay serves (audio / modules / web-app mirror + church URL) via /settings ──
  async function loadServes() {
    const card = document.getElementById('servesCard');
    try {
      const r = await fetch('/settings', { headers: authHeaders(), cache: 'no-store' });
      if (r.status === 401) { card.style.display = 'none'; return; }   // shown only when unlocked with the admin token
      const j = await r.json(); const s = j.settings || {};
      card.style.display = 'block';
      document.getElementById('t-app').checked = s.serveApp !== false;
      document.getElementById('t-modules').checked = s.serveModules !== false;
      document.getElementById('t-audio').checked = s.serveAudio !== false;
      document.getElementById('t-appurl').value = s.appUrl || '';
      const gb = (b) => b ? String(Math.round(b / 1e9 * 100) / 100) : '';
      document.getElementById('t-mediacap').value = gb(s.mediaCap);
      document.getElementById('t-churchcap').value = gb(s.churchCap);
      const io = document.getElementById('t-inviteonly'); if (io) io.checked = s.inviteOnly === true;   // access mode lives with the church list card
      const of = document.getElementById('t-offer'); if (of) of.checked = s.offerHosting === true;
      // backup/restore card (unlocked with the admin token, same as this settings fetch). The download streams a
      // big file, so it's a plain <a download> with the token in the query rather than a fetch-into-memory blob.
      const bc = document.getElementById('backupCard'); if (bc) bc.style.display = 'block';
      const dlb = document.getElementById('dlBackup'); if (dlb) dlb.href = '/relay-backup?token=' + encodeURIComponent(adminToken);
      const used = j.mediaUsed || 0;
      document.getElementById('mediaUsed').textContent = used ? '· ' + (Math.round(used / 1e9 * 100) / 100) + ' GB used' : '';
    } catch (e) { /* relay down — the hero card shows it */ }
  }
  async function saveServes() {
    const msg = document.getElementById('servesMsg'); msg.style.color = 'var(--ink-3)'; msg.textContent = '· saving…';
    const capBytes = (id) => Math.round((parseFloat(document.getElementById(id).value) || 0) * 1e9);
    const body = { serveApp: document.getElementById('t-app').checked, serveModules: document.getElementById('t-modules').checked, serveAudio: document.getElementById('t-audio').checked, appUrl: document.getElementById('t-appurl').value.trim(), mediaCap: capBytes('t-mediacap'), churchCap: capBytes('t-churchcap') };
    try {
      const r = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
      const s = await r.json();
      if (!r.ok) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + (s.error || 'save failed'); return; }
      msg.style.color = 'var(--sage-ink)'; msg.textContent = '· ✓ saved'; setTimeout(() => { msg.textContent = ''; }, 2400);
    } catch (e) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + e.message; }
  }
  document.getElementById('saveServes').onclick = saveServes;
  // access mode: invite-only saves live (its own switch, not tied to the church-list Save button)
  document.getElementById('t-inviteonly').onchange = async (e) => {
    const on = e.target.checked, msg = document.getElementById('cfgMsg');
    if (msg) { msg.style.color = 'var(--ink-3)'; msg.textContent = '· saving…'; }
    try {
      const r = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ inviteOnly: on }) });
      if (!r.ok) throw new Error('save failed');
      if (msg) { msg.style.color = 'var(--sage-ink)'; msg.textContent = on ? '· ✓ invite-only — only churches you add can join' : '· ✓ open — churches can self-register'; setTimeout(() => { msg.textContent = ''; }, 3000); }
    } catch (err) { e.target.checked = !on; if (msg) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + (err.message || 'failed'); } }
  };
  document.getElementById('refreshCh').onclick = loadConfig;   // pull the latest church list (self-registered churches included)
  document.getElementById('t-offer').onchange = async (e) => {
    const on = e.target.checked, msg = document.getElementById('cfgMsg');
    if (msg) { msg.style.color = 'var(--ink-3)'; msg.textContent = '· saving…'; }
    try {
      const r = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ offerHosting: on }) });
      if (!r.ok) throw new Error('save failed');
      if (msg) { msg.style.color = 'var(--sage-ink)'; msg.textContent = on ? '· ✓ discoverable — other churches can auto-find this relay' : '· ✓ private — not advertised'; setTimeout(() => { msg.textContent = ''; }, 3000); }
    } catch (err) { e.target.checked = !on; if (msg) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + (err.message || 'failed'); } }
  };
  // restore: two-click confirm (webview confirm() is unreliable), then stream the file to /relay-restore.
  let restoreArmed = false;
  document.getElementById('doRestore').onclick = async () => {
    const btn = document.getElementById('doRestore'), msg = document.getElementById('restoreMsg');
    const f = (document.getElementById('restoreFile').files || [])[0];
    if (!f) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· choose a backup file first'; return; }
    if (!restoreArmed) { restoreArmed = true; btn.textContent = 'Confirm — replace everything'; msg.style.color = 'var(--clay-ink)'; msg.textContent = '· this REPLACES all data on this relay'; return; }
    restoreArmed = false; btn.textContent = 'Restore';
    msg.style.color = 'var(--ink-3)'; msg.textContent = '· uploading…';
    try {
      const r = await fetch('/relay-restore', { method: 'POST', headers: authHeaders(), body: f });
      const s = await r.json();
      if (!r.ok || !s.ok) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + (s.error || 'restore failed'); return; }
      msg.style.color = 'var(--sage-ink)'; msg.textContent = '· ✓ staged — now fully close and reopen the app to apply';
    } catch (e) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + e.message; }
  };

  // ── relay's memorable name: a pet-name from its key (recognition) + a claimable directory handle stewards type ──
  const _PET_ADJ = ['Quiet', 'Bright', 'Gentle', 'Steady', 'Faithful', 'Humble', 'Joyful', 'Kind', 'Patient', 'Bold', 'Gracious', 'Calm', 'Glad', 'Warm', 'True', 'Sure'];
  const _PET_NOUN = ['Olive', 'Cedar', 'Dove', 'Anchor', 'Lamp', 'Vine', 'Shepherd', 'Harbor', 'Beacon', 'Reed', 'Sparrow', 'Willow', 'Spring', 'Haven', 'Ember', 'Brook'];
  function petName(hexPub) { if (!/^[0-9a-f]{64}$/i.test(hexPub || '')) return ''; let h = 0; for (let i = 0; i < hexPub.length; i++) h = (h * 31 + hexPub.charCodeAt(i)) >>> 0; return _PET_ADJ[h % 16] + ' ' + _PET_NOUN[(h >>> 4) % 16] + ' ' + (10 + (h >>> 9) % 90); }
  async function loadRelayName() {
    const body = document.getElementById('relayNameBody'); if (!body) return;
    try {
      const r = await fetch('/relay-names/mine', { headers: authHeaders(), cache: 'no-store' });
      if (r.status === 401) { body.innerHTML = '<div class="muted">Enter the admin token (Churches card below) to manage your relay’s name.</div>'; return; }
      const m = await r.json();
      const pet = petName(m.pub);
      let html = pet ? '<div style="margin-bottom:10px">Known as <b>' + esc(pet) + '</b> <span class="muted">— a name from this relay’s key, so people can recognise it.</span></div>' : '';
      if (m.handle) html += '<div style="margin-bottom:8px">Public name: <b>' + esc(m.handle) + '</b> <span class="muted">— stewards connect their church by typing this in the console.</span></div>';
      if (!m.relayWss) {
        html += '<div class="muted">Turn on public access in <b>Reach members from anywhere</b> above, then a name others can type appears here.</div>';
      } else {
        html += '<div style="display:flex; gap:8px; margin-top:6px"><input id="relayNameIn" placeholder="' + (m.handle ? 'change name' : 'choose a name, e.g. grace-city') + '" autocomplete="off" aria-label="Relay name to claim" title="A short, memorable handle (letters, numbers, hyphens) that stewards type in Settings → Relays → Connect by name. It always points at this relay&#39;s current address, so it keeps working even after the tunnel URL changes on restart." /><button class="btn-clay" id="relayNameGo" style="white-space:nowrap" title="' + (m.handle ? 'Change the public name this relay is reachable by.' : 'Claim this name in the relay directory so stewards can connect to your church by name.') + '">' + (m.handle ? 'Update' : 'Claim') + '</button></div><div class="muted" id="relayNameMsg" style="margin-top:6px"></div>';
      }
      body.innerHTML = html;
      const go = document.getElementById('relayNameGo'); if (go) go.onclick = claimRelayName;
      const inp = document.getElementById('relayNameIn'); if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') claimRelayName(); });
    } catch (e) { body.innerHTML = '<div class="muted">Couldn’t load the relay name.</div>'; }
  }
  // Cloudflare quick tunnel "go public" — lives in the Reach-members card (see renderGoPublic). One click, no account.
  const cfGoHtml = '<div class="muted" style="margin-bottom:11px">Make this relay reachable from anywhere — <b>free, no account</b>, no fixed IP. One click.</div>'
    + '<button class="btn-clay" id="cfGo">Go public — no account →</button> <span class="muted" id="cfMsg"></span>'
    + '<pre id="cfDetail" style="display:none;margin-top:10px;padding:10px 12px;background:var(--surface-2,#f2efe8);border:1px solid var(--line);border-radius:8px;font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-word;color:var(--ink-3);max-height:180px;overflow:auto"></pre>';
  function wireCfGo() { const cf = document.getElementById('cfGo'); if (cf) cf.onclick = goPublicCloudflare; }
  async function goPublicCloudflare() {
    const btn = document.getElementById('cfGo'), msg = document.getElementById('cfMsg');
    cfHold = true;   // freeze the 4s auto-refresh so it can't wipe the status / error / log while we work
    const det0 = document.getElementById('cfDetail'); if (det0) { det0.style.display = 'none'; det0.textContent = ''; }   // clear any prior attempt's log
    if (btn) btn.disabled = true;
    if (msg) { msg.style.color = 'var(--ink-3)'; msg.textContent = '· opening a tunnel… (up to 30s)'; }
    try {
      const r = await fetch('/tunnel/up', { method: 'POST', headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) {
        if (msg) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + (j.error || 'failed'); }
        if (btn) btn.disabled = false;
        // pull cloudflared's own last lines so a stubborn failure is diagnosable without hunting for a log file
        try {
          const lg = await (await fetch('/tunnel/log', { headers: authHeaders(), cache: 'no-store' })).json();
          const det = document.getElementById('cfDetail');
          if (det && lg && lg.tail && lg.tail.length) { det.style.display = 'block'; det.textContent = lg.tail.join('\n'); }
        } catch (e) {}
        return;   // keep cfHold=true: the error+log stay put until the user clicks Go public again
      }
      if (msg) { msg.style.color = 'var(--sage-ink)'; msg.textContent = '· ✓ public!'; }
      cfHold = false;   // success — let the refresh render the public card
      setTimeout(() => { gpTick(); loadRelayName(); }, 900);
    } catch (e) { if (msg) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + e.message; } if (btn) btn.disabled = false; }
  }
  function renderCfPublic(cf) {
    const body = document.getElementById('gpBody'), st = document.getElementById('gpStatus');
    publicBase = cf.url; try { refreshReach(); } catch (e) {}
    st.textContent = '';
    body.innerHTML =
      '<div class="row" style="background:color-mix(in oklab,var(--sage) 9%,var(--surface));border-color:color-mix(in oklab,var(--sage) 28%,transparent)"><span style="color:var(--sage);font-weight:700;font-size:13px">✓ Public via Cloudflare — reachable from anywhere</span></div>' +
      '<div class="row"><span class="k">Public URL</span><span class="v">' + esc(cf.url) + '</span><button class="btn-ghost" data-copyurl="' + esc(cf.url) + '">Copy</button></div>' +
      '<div class="muted" style="margin-top:6px">Members connect by the <b>name</b> you claim below — it stays the same even if this URL changes. Test from your phone on <b>mobile data</b>: <a href="' + esc(cf.url) + '/status" target="_blank">' + esc(cf.url) + '/status</a>.</div>' +
      '<div class="row" style="margin-top:12px;background:color-mix(in oklab,var(--clay) 7%,var(--surface));border-color:color-mix(in oklab,var(--clay) 22%,transparent)"><span style="font-size:13px;line-height:1.5"><b>Serve the wider church.</b> Your relay can also <b>host other churches that can’t self-host</b> — add their <code>npub</code> in “Churches on this relay” below, and they get a home on your infrastructure. One box can carry many congregations.</span></div>';
    wireCopyUrls(body);   // strict-CSP: no inline onclick — wire the Copy button here
  }
  // wire any [data-copyurl] Copy button inside a freshly-rendered container (used instead of inline onclick,
  // which the strict CSP blocks). Mirrors gpCopy's behaviour (copy + "Copied" flash).
  function wireCopyUrls(root) {
    (root || document).querySelectorAll('[data-copyurl]').forEach(b => { b.onclick = () => gpCopy(b.dataset.copyurl, b); });
  }
  async function claimRelayName() {
    const inp = document.getElementById('relayNameIn'); const msg = document.getElementById('relayNameMsg');
    const handle = (inp.value || '').trim().toLowerCase(); if (!handle) return;
    msg.style.color = 'var(--ink-3)'; msg.textContent = '· claiming…';
    try {
      const r = await fetch('/relay-names/mine', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ handle }) });
      const j = await r.json();
      if (!r.ok) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + (j.error || 'failed'); return; }
      msg.style.color = 'var(--sage-ink)'; msg.textContent = '· ✓ claimed “' + j.handle + '”'; setTimeout(loadRelayName, 1200);
    } catch (e) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + e.message; }
  }

  // ── relay software updates (version check + one-click "Update now") via /update + /status ──
  let relayVersion = '';
  async function loadUpdate() {
    const card = document.getElementById('updateCard');
    try {
      const r = await fetch('/update', { headers: authHeaders(), cache: 'no-store' });
      if (r.status === 401) { card.style.display = 'none'; return; }
      const cur = await r.json(); relayVersion = cur.version || '';
      card.style.display = 'block';
      document.getElementById('u-current').textContent = (cur.versionShort || '—') + (cur.builtAt ? ' · ' + cur.builtAt.slice(0, 10) : '');
      const body = document.getElementById('u-body');
      // report the LAST OUTCOME whenever we look, not only if we happened to be watching (H2/H7)
      const lastMsg = document.getElementById('updateMsg');
      if (lastMsg && cur.last && !cur.pending) {
        const mins = cur.last.at ? Math.floor((Date.now() / 1000 - cur.last.at) / 60) : null;
        const when = mins === null ? '' : mins < 1 ? ' just now' : mins < 60 ? ' ' + mins + 'm ago' : ' ' + Math.floor(mins / 60) + 'h ago';
        if (cur.last.state === 'ok') { lastMsg.style.color = 'var(--sage-ink)'; lastMsg.textContent = '· ✓ updated' + when; }
        else if (cur.last.state === 'failed') { lastMsg.style.color = 'var(--clay-ink)'; lastMsg.textContent = '· ✗ last update failed' + when + ' — ' + (cur.last.reason || ''); }
        else if (cur.last.state === 'rolledback') { lastMsg.style.color = 'var(--clay-ink)'; lastMsg.textContent = '· ⟲ rolled back' + when + ' — ' + (cur.last.reason || ''); }
      }
      if (cur.stalled) { body.innerHTML = '<b>The update didn\u2019t start.</b> This relay asked for one but nothing picked it up \u2014 the update helper isn\u2019t installed on this box, so updates have to be applied by re-running the installer.'; return; }
      if (cur.pending) { body.innerHTML = '⏳ An update is in progress…'; pollUpdate(); return; }
      if (!cur.origin) { body.innerHTML = 'This is the release source — nothing to pull here.'; return; }
      // The relay checks its update source server-side (cur.latest) — the browser can't be relied on to reach
      // the release host's ts.net funnel. If the server couldn't reach it either, cur.latest is null.
      const latest = cur.latest;
      if (!latest || !latest.version) { body.innerHTML = 'Couldn’t reach the update source (' + esc(cur.origin) + ') to check. You can still force an update with the button below.'
        + '<button class="btn-clay" id="doUpdate" style="margin-top:8px;display:block">Update now</button>'; document.getElementById('doUpdate').onclick = doUpdate; return; }
      if (latest.version === cur.version) { body.innerHTML = '<span style="color:var(--sage)">✓ Up to date.</span>'; return; }
      body.innerHTML = 'A new build is available (' + esc((latest.versionShort || '') + (latest.builtAt ? ' · ' + latest.builtAt.slice(0, 10) : '')) + '). '
        + '<button class="btn-clay" id="doUpdate" style="margin-top:8px">Update now</button>';
      document.getElementById('doUpdate').onclick = doUpdate;
    } catch (e) { /* relay down — hero card shows it */ }
  }
  async function doUpdate() {
    const btn = document.getElementById('doUpdate'), msg = document.getElementById('updateMsg');
    // two-click armed confirm — webview confirm() is unreliable (same reason Restore uses this pattern)
    if (btn && btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.dataset.orig = btn.textContent; btn.textContent = 'Confirm — restart the relay'; if (msg) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· click again — the relay briefly restarts'; } return; }
    if (btn) { btn.dataset.armed = ''; if (btn.dataset.orig) btn.textContent = btn.dataset.orig; }
    msg.style.color = 'var(--ink-3)'; msg.textContent = '· starting…';
    try {
      const r = await fetch('/update', { method: 'POST', headers: authHeaders() });
      const s = await r.json();
      if (!r.ok) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + (s.error || 'failed'); return; }
      document.getElementById('u-body').innerHTML = '⏳ Updating — the relay restarts shortly…';
      pollUpdate();
    } catch (e) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + e.message; }
  }
  function pollUpdate() {
    const msg = document.getElementById('updateMsg'); let n = 0;
    const iv = setInterval(async () => {
      n++;
      try {
        const s = await (await fetch('/status', { cache: 'no-store' })).json();
        if (s.version && relayVersion && s.version !== relayVersion) { clearInterval(iv); msg.style.color = 'var(--sage-ink)'; msg.textContent = '· ✓ updated'; setTimeout(loadUpdate, 800); }
      } catch (e) { /* restarting — keep polling */ }
      if (n > 40) { clearInterval(iv); loadUpdate(); }   // stop guessing — re-read, which now carries the real outcome
    }, 3000);
  }

  document.getElementById('fetchApk')?.addEventListener('click', async () => {
    const m = document.getElementById('apkMsg'); m.style.color = 'var(--ink-3)'; m.textContent = 'fetching…';
    try {
      const r = await fetch('/relay-app/fetch-apk', { method: 'POST', headers: authHeaders() });
      const s = await r.json();
      const files = s.files || {};
      const ok = Object.entries(files).filter(([, v]) => v.ok).map(([k, v]) => k.replace('.apk', '') + ' (' + Math.round(v.bytes / 1048576) + 'M)');
      const bad = Object.entries(files).filter(([, v]) => !v.ok).map(([k, v]) => k + ' — ' + v.error);
      if (!ok.length) { m.style.color = 'var(--clay)'; m.textContent = '✗ ' + (bad.join('; ') || s.error || 'failed'); return; }
      m.style.color = bad.length ? 'var(--clay)' : 'var(--sage)';
      m.textContent = '✓ ' + ok.join(', ') + (bad.length ? ' · ✗ ' + bad.join('; ') : '');
    } catch (e) { m.style.color = 'var(--clay)'; m.textContent = '✗ ' + e.message; }
  });
  document.getElementById('syncNow')?.addEventListener('click', async () => {
    const m = document.getElementById('syncMsg'); m.style.color = 'var(--ink-3)'; m.textContent = 'syncing…';
    try {
      const r = await fetch('/sync-now', { method: 'POST', headers: authHeaders() });
      const s = await r.json();
      if (!r.ok || !s.ok) { m.style.color = 'var(--clay)'; m.textContent = '✗ ' + (s.error || 'failed'); return; }
      if (s.busy) { m.style.color = 'var(--ink-3)'; m.textContent = 'a sync is already running \u2014 give it a moment'; return; }
      m.style.color = 'var(--sage-ink)';
      const across = s.churches > 1 ? ' across ' + s.churches + ' churches' : '';
      m.textContent = s.imported ? '\u2713 pulled ' + s.imported + ' new' + across : '\u2713 nothing new' + across;
    } catch (e) { m.style.color = 'var(--clay)'; m.textContent = '✗ ' + e.message; }
  });
  // on load, show the latest available APK version in the fetch area (so you can see which build is current)
  fetch('/apk-latest.json?t=' + Date.now()).then(r => r.json()).then(m => { const el = document.getElementById('apkMsg'); if (el && m && m.versionName) el.textContent = 'latest: ' + m.versionName + ' (' + m.versionCode + ')'; }).catch(() => {});
  document.getElementById('dlSubs')?.addEventListener('click', () => {
    const csvCell = (v) => { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = [['email', 'signed_up', 'source']].concat(subsCache.map(s => [csvCell(s.email), csvCell(s.at ? new Date(s.at).toISOString() : ''), csvCell(s.src || '')]));
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'trinityone-subscribers.csv'; a.click(); URL.revokeObjectURL(a.href);
  });
  // Adding acts immediately too — prompt, POST, re-read. The old flow pushed a blank row into a local
  // array and relied on a Save that silently dropped any row still missing an npub.
  document.getElementById('addCh').onclick = async () => {
    const msg = document.getElementById('cfgMsg');
    const npub = (window.prompt('Paste the church\u2019s public key.\n\nIt starts with npub1\u2026 and is on the Settings screen of their Steward console.') || '').trim();
    if (!npub) return;
    const name = (window.prompt('What is this church called?\n\nThis is just a label so you can recognise it here.') || '').trim();
    msg.style.color = 'var(--ink-3)'; msg.textContent = 'Adding\u2026';
    try {
      const r = await fetch('/config', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ addChurch: { npub, name } }) });
      const s2 = await r.json();
      if (!r.ok) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '\u2717 ' + (s2.error || 'could not add that church'); return; }
      msg.style.color = 'var(--sage-ink)'; msg.textContent = '\u2713 ' + (name || 'Church') + ' can now post to this relay';
      setTimeout(() => { msg.textContent = ''; }, 5000);
    } catch (e) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '\u2717 ' + e.message; }
    await loadConfig();   // re-read: never render the write's own echo
  };
  document.getElementById('tokGo').onclick = () => { adminToken = document.getElementById('tok').value.trim(); if (adminToken) localStorage.setItem(TOKEN_KEY, adminToken); loadConfig(); gpTick(); loadRelayName(); };
  document.getElementById('tok').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('tokGo').click(); });
  // When this panel is opened ON the relay machine (e.g. the TrinityOne Suite's own window), the relay hands
  // us its admin token automatically — no hunting in logs. /local-token only answers genuine same-machine
  // requests, so this is a no-op when the dashboard is opened remotely over a tunnel.
  (async () => {
    if (!adminToken) {
      try { const r = await fetch('/local-token', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (j && j.token) { adminToken = j.token; localStorage.setItem(TOKEN_KEY, adminToken); } } } catch (e) {}
    }
    loadConfig();
    loadRelayName();
  })();

  // ── "Go public" wizard: bring the node onto Tailscale + turn on Funnel (public HTTPS/WSS) ──
  let tsBusy = false;       // pause polling while an action is mid-flight (so it can't clobber the view)
  let cfHold = false;       // freeze the 4s refresh while a Go-public attempt runs OR its error+log is on screen
  let lastAuthUrl = '';     // the login link from `tailscale up`, until the node reports connected
  const gpWarn = (h) => '<div class="warn">'+h+'</div>';
  const gpCopy = (t, b) => { navigator.clipboard.writeText(t).then(()=>{ b.textContent='Copied'; setTimeout(()=>b.textContent='Copy',1400); }).catch(()=>{}); };
  window.gpTick = gpTick; window.gpCopy = gpCopy;

  function renderGoPublic(s) {
    const body = document.getElementById('gpBody'), st = document.getElementById('gpStatus');
    if (s.locked)         { st.textContent='· locked';   body.innerHTML = gpWarn('🔒 Enter the <b>admin token</b> in the Churches card below — it unlocks one-click public access too.'); return; }
    if (s.installed === false) { st.textContent='· not public yet'; body.innerHTML = cfGoHtml; wireCfGo(); return; }   // no Tailscale (e.g. desktop app) → the bundled Cloudflare tunnel is the path
    if (s.needsOperator)  { st.textContent='· needs a nudge'; body.innerHTML = gpWarn('The relay can’t manage Tailscale yet. On the relay box, run once:<br><br><code>sudo tailscale set --operator=trinityone</code><br><br>then <button class="btn-ghost" id="gpRefreshOp">refresh</button>.'); var _rb = document.getElementById('gpRefreshOp'); if (_rb) _rb.onclick = gpTick; return; }
    if (s.funnelOn && s.publicUrl) {
      st.textContent=''; publicBase = s.publicUrl; refreshReach();
      body.innerHTML =
        '<div class="row" style="background:color-mix(in oklab,var(--sage) 9%,var(--surface));border-color:color-mix(in oklab,var(--sage) 28%,transparent)"><span style="color:var(--sage);font-weight:700;font-size:13px">✓ Reachable from anywhere — no terminal needed</span></div>' +
        '<div class="row"><span class="k">Public URL</span><span class="v">'+esc(s.publicUrl)+'</span><button class="btn-ghost" data-copyurl="'+esc(s.publicUrl)+'">Copy</button></div>' +
        '<div class="muted" style="margin-top:6px">Test it from your phone on <b>mobile data</b> (Wi-Fi off): <a href="'+esc(s.publicUrl)+'/status" target="_blank">'+esc(s.publicUrl)+'/status</a> — JSON means it’s live worldwide.</div>';
      wireCopyUrls(body);
      return;
    }
    if (s.loggedIn) {
      st.textContent='· on your network';
      body.innerHTML =
        '<div class="muted" style="margin-bottom:11px">✓ This relay is on your Tailscale network'+(s.dnsName?' as <code>'+esc(s.dnsName)+'</code>':'')+'. One more click to let members reach it over the internet.</div>' +
        '<button class="btn-clay" id="gpFunnel">Make it public (HTTPS) →</button> <span class="muted" id="gpMsg"></span>';
      document.getElementById('gpFunnel').onclick = doFunnel;
      return;
    }
    if (lastAuthUrl) {
      st.textContent='· waiting for sign-in';
      body.innerHTML =
        '<a class="btn-clay" href="'+esc(lastAuthUrl)+'" target="_blank" style="display:inline-block;text-decoration:none">Authorize this machine ↗</a>' +
        '<div class="muted" style="margin-top:11px">A Tailscale tab opened — sign in (same account as your other devices) and approve this machine. This updates on its own once it’s connected… ⏳</div>';
      return;
    }
    st.textContent='· not public yet';
    body.innerHTML = cfGoHtml +
      '<div class="muted" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">Prefer a stable address on your own Tailscale? <button class="btn-ghost" id="gpUp">Use Tailscale instead →</button> <span class="muted" id="gpMsg"></span></div>';
    wireCfGo();
    document.getElementById('gpUp').onclick = doUp;
  }

  async function gpTick() {
    if (tsBusy || cfHold) return;
    try {
      // Cloudflare quick tunnel is the no-account default — if it's up, show that and skip the Tailscale flow.
      let cf = null; try { cf = await (await fetch('/tunnel/state', { headers: authHeaders(), cache: 'no-store' })).json(); } catch (e) {}
      if (cf && cf.running && cf.url) { renderCfPublic(cf); return; }
      const r = await fetch('/tailscale/state', { headers: authHeaders(), cache:'no-store' });
      if (r.status === 401) { renderGoPublic({ locked:true }); return; }
      const s = await r.json();
      if (s.loggedIn) lastAuthUrl = '';
      renderGoPublic(s);
    } catch (e) { /* relay unreachable — the hero card already says so */ }
  }

  async function doUp() {
    const msg = document.getElementById('gpMsg'); if (msg) msg.textContent = 'Connecting…';
    tsBusy = true;
    try {
      const r = await fetch('/tailscale/up', { method:'POST', headers:{'Content-Type':'application/json', ...authHeaders()}, body:'{}' });
      const s = await r.json(); tsBusy = false;
      if (s.authUrl) { lastAuthUrl = s.authUrl; window.open(s.authUrl, '_blank'); renderGoPublic({}); }
      else if (s.running) { lastAuthUrl=''; }
      else if (s.error && msg) { msg.style.color='var(--clay)'; msg.textContent='✗ '+s.error; }
      gpTick();
    } catch (e) { tsBusy = false; if (msg) { msg.style.color='var(--clay)'; msg.textContent='✗ '+e.message; } }
  }

  async function doFunnel() {
    const msg = document.getElementById('gpMsg'); if (msg) msg.textContent = 'Turning on HTTPS…';
    tsBusy = true;
    try {
      const r = await fetch('/tailscale/funnel', { method:'POST', headers:{'Content-Type':'application/json', ...authHeaders()}, body:'{}' });
      const s = await r.json(); tsBusy = false;
      if (s.ok) gpTick();
      else if (s.needsPolicy && msg) { msg.style.color='var(--clay)'; msg.innerHTML='✗ Funnel isn’t enabled for your tailnet yet. <a href="https://login.tailscale.com/admin/settings/features" target="_blank">Enable it here</a>, then click again.'; }
      else if (msg) { msg.style.color='var(--clay)'; msg.textContent='✗ '+(s.error||'failed'); }
    } catch (e) { tsBusy = false; if (msg) { msg.style.color='var(--clay)'; msg.textContent='✗ '+e.message; } }
  }

  gpTick(); setInterval(gpTick, 4000);
