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
  document.getElementById('openConsole').onclick = () => window.open(reachInfo().consoleUrl, '_blank');
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

  function renderCfg() {
    const list = document.getElementById('cfgList');
    list.innerHTML = cfgChurches.length ? cfgChurches.map((c, i) =>
      '<div class="ch">' +
        '<div class="badge">'+initials(c.name)+'</div>' +
        '<div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:6px">' +
          '<input data-i="'+i+'" data-f="name" value="'+esc(c.name)+'" placeholder="Church name" />' +
          '<input data-i="'+i+'" data-f="npub" value="'+esc(c.npub)+'" placeholder="npub1…" spellcheck="false" autocapitalize="none" style="font-family:ui-monospace,monospace; font-size:12px" />' +
        '</div>' +
        '<button class="btn-ghost" data-rm="'+i+'" style="align-self:flex-start">Remove</button>' +
      '</div>').join('') : '<div class="muted" style="margin-bottom:8px">No churches yet — add one below.</div>';
    list.querySelectorAll('input').forEach(inp => inp.oninput = () => { cfgChurches[+inp.dataset.i][inp.dataset.f] = inp.value; });
    list.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { cfgChurches.splice(+b.dataset.rm, 1); renderCfg(); });
  }

  async function loadConfig() {
    const gate = document.getElementById('cfgGate'), body = document.getElementById('cfgBody'), st = document.getElementById('cfgStatus');
    try {
      const r = await fetch('/config', { headers: authHeaders(), cache: 'no-store' });
      if (r.status === 401) { gate.style.display = 'block'; body.style.display = 'none'; document.getElementById('cfgList').innerHTML = ''; st.textContent = '· locked'; document.getElementById('servesCard').style.display = 'none'; document.getElementById('updateCard').style.display = 'none'; return; }
      const s = await r.json();
      gate.style.display = 'none'; body.style.display = 'block';
      st.textContent = s.configured ? '' : '· not set up yet';
      cfgChurches = (s.churches || []).map(c => ({ npub: c.npub, name: c.name }));
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

  async function saveConfig() {
    const msg = document.getElementById('cfgMsg'); msg.style.color = 'var(--ink-3)'; msg.textContent = 'Saving…';
    const churches = cfgChurches.map(c => ({ npub: (c.npub||'').trim(), name: (c.name||'').trim() })).filter(c => c.npub);
    try {
      const r = await fetch('/config', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ churches }) });
      const s = await r.json();
      if (!r.ok) { msg.style.color = 'var(--clay)'; msg.textContent = '✗ ' + (s.error || 'save failed'); return; }
      cfgChurches = s.churches.map(c => ({ npub: c.npub, name: c.name })); renderCfg();
      document.getElementById('cfgStatus').textContent = '';
      msg.style.color = 'var(--sage)'; msg.textContent = '✓ Saved — members can join now';
      setTimeout(() => { msg.textContent = ''; }, 2600);
    } catch (e) { msg.style.color = 'var(--clay)'; msg.textContent = '✗ ' + e.message; }
  }

  // ── what this relay serves (audio / modules / web-app mirror + church URL) via /settings ──
  async function loadServes() {
    const card = document.getElementById('servesCard');
    try {
      const r = await fetch('/settings', { headers: authHeaders(), cache: 'no-store' });
      if (r.status === 401) { card.style.display = 'none'; return; }   // shown only when unlocked with the admin token
      const s = (await r.json()).settings || {};
      card.style.display = 'block';
      document.getElementById('t-app').checked = s.serveApp !== false;
      document.getElementById('t-modules').checked = s.serveModules !== false;
      document.getElementById('t-audio').checked = s.serveAudio !== false;
      document.getElementById('t-appurl').value = s.appUrl || '';
    } catch (e) { /* relay down — the hero card shows it */ }
  }
  async function saveServes() {
    const msg = document.getElementById('servesMsg'); msg.style.color = 'var(--ink-3)'; msg.textContent = '· saving…';
    const body = { serveApp: document.getElementById('t-app').checked, serveModules: document.getElementById('t-modules').checked, serveAudio: document.getElementById('t-audio').checked, appUrl: document.getElementById('t-appurl').value.trim() };
    try {
      const r = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
      const s = await r.json();
      if (!r.ok) { msg.style.color = 'var(--clay)'; msg.textContent = '· ✗ ' + (s.error || 'save failed'); return; }
      msg.style.color = 'var(--sage)'; msg.textContent = '· ✓ saved'; setTimeout(() => { msg.textContent = ''; }, 2400);
    } catch (e) { msg.style.color = 'var(--clay)'; msg.textContent = '· ✗ ' + e.message; }
  }
  document.getElementById('saveServes').onclick = saveServes;

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
        html += '<div style="display:flex; gap:8px; margin-top:6px"><input id="relayNameIn" placeholder="' + (m.handle ? 'change name' : 'choose a name, e.g. grace-city') + '" autocomplete="off" /><button class="btn-clay" id="relayNameGo" style="white-space:nowrap">' + (m.handle ? 'Update' : 'Claim') + '</button></div><div class="muted" id="relayNameMsg" style="margin-top:6px"></div>';
      }
      body.innerHTML = html;
      const go = document.getElementById('relayNameGo'); if (go) go.onclick = claimRelayName;
      const inp = document.getElementById('relayNameIn'); if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') claimRelayName(); });
    } catch (e) { body.innerHTML = '<div class="muted">Couldn’t load the relay name.</div>'; }
  }
  // Cloudflare quick tunnel "go public" — lives in the Reach-members card (see renderGoPublic). One click, no account.
  const cfGoHtml = '<div class="muted" style="margin-bottom:11px">Make this relay reachable from anywhere — <b>free, no account</b>, no fixed IP. One click.</div>'
    + '<button class="btn-clay" id="cfGo">Go public — no account →</button> <span class="muted" id="cfMsg"></span>';
  function wireCfGo() { const cf = document.getElementById('cfGo'); if (cf) cf.onclick = goPublicCloudflare; }
  async function goPublicCloudflare() {
    const btn = document.getElementById('cfGo'), msg = document.getElementById('cfMsg');
    if (btn) btn.disabled = true;
    if (msg) { msg.style.color = 'var(--ink-3)'; msg.textContent = '· opening a tunnel… (~15s)'; }
    try {
      const r = await fetch('/tunnel/up', { method: 'POST', headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) { if (msg) { msg.style.color = 'var(--clay)'; msg.textContent = '· ✗ ' + (j.error || 'failed'); } if (btn) btn.disabled = false; return; }
      if (msg) { msg.style.color = 'var(--sage)'; msg.textContent = '· ✓ public!'; }
      setTimeout(() => { gpTick(); loadRelayName(); }, 900);
    } catch (e) { if (msg) { msg.style.color = 'var(--clay)'; msg.textContent = '· ✗ ' + e.message; } if (btn) btn.disabled = false; }
  }
  function renderCfPublic(cf) {
    const body = document.getElementById('gpBody'), st = document.getElementById('gpStatus');
    publicBase = cf.url; try { refreshReach(); } catch (e) {}
    st.textContent = '';
    body.innerHTML =
      '<div class="row" style="background:color-mix(in oklab,var(--sage) 9%,var(--surface));border-color:color-mix(in oklab,var(--sage) 28%,transparent)"><span style="color:var(--sage);font-weight:700;font-size:13px">✓ Public via Cloudflare — reachable from anywhere</span></div>' +
      '<div class="row"><span class="k">Public URL</span><span class="v">' + esc(cf.url) + '</span><button class="btn-ghost" onclick="gpCopy(\'' + esc(cf.url) + '\',this)">Copy</button></div>' +
      '<div class="muted" style="margin-top:6px">Members connect by the <b>name</b> you claim below — it stays the same even if this URL changes. Test from your phone on <b>mobile data</b>: <a href="' + esc(cf.url) + '/status" target="_blank">' + esc(cf.url) + '/status</a>.</div>';
  }
  async function claimRelayName() {
    const inp = document.getElementById('relayNameIn'); const msg = document.getElementById('relayNameMsg');
    const handle = (inp.value || '').trim().toLowerCase(); if (!handle) return;
    msg.style.color = 'var(--ink-3)'; msg.textContent = '· claiming…';
    try {
      const r = await fetch('/relay-names/mine', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ handle }) });
      const j = await r.json();
      if (!r.ok) { msg.style.color = 'var(--clay)'; msg.textContent = '· ✗ ' + (j.error || 'failed'); return; }
      msg.style.color = 'var(--sage)'; msg.textContent = '· ✓ claimed “' + j.handle + '”'; setTimeout(loadRelayName, 1200);
    } catch (e) { msg.style.color = 'var(--clay)'; msg.textContent = '· ✗ ' + e.message; }
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
    if (!confirm('Update this relay now? It will briefly restart — members reconnect automatically.')) return;
    const msg = document.getElementById('updateMsg'); msg.style.color = 'var(--ink-3)'; msg.textContent = '· starting…';
    try {
      const r = await fetch('/update', { method: 'POST', headers: authHeaders() });
      const s = await r.json();
      if (!r.ok) { msg.style.color = 'var(--clay)'; msg.textContent = '· ✗ ' + (s.error || 'failed'); return; }
      document.getElementById('u-body').innerHTML = '⏳ Updating — the relay restarts shortly…';
      pollUpdate();
    } catch (e) { msg.style.color = 'var(--clay)'; msg.textContent = '· ✗ ' + e.message; }
  }
  function pollUpdate() {
    const msg = document.getElementById('updateMsg'); let n = 0;
    const iv = setInterval(async () => {
      n++;
      try {
        const s = await (await fetch('/status', { cache: 'no-store' })).json();
        if (s.version && relayVersion && s.version !== relayVersion) { clearInterval(iv); msg.style.color = 'var(--sage)'; msg.textContent = '· ✓ updated'; setTimeout(loadUpdate, 800); }
      } catch (e) { /* restarting — keep polling */ }
      if (n > 40) { clearInterval(iv); msg.textContent = '· taking a while — check: journalctl -u trinityone-update'; }
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
      m.style.color = 'var(--sage)'; m.textContent = s.imported ? '✓ pulled ' + s.imported + ' new' : '✓ already up to date';
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
  document.getElementById('addCh').onclick = () => { cfgChurches.push({ npub: '', name: '' }); renderCfg(); document.querySelector('#cfgList .ch:last-child input')?.focus(); };
  document.getElementById('saveCfg').onclick = saveConfig;
  document.getElementById('tokGo').onclick = () => { adminToken = document.getElementById('tok').value.trim(); if (adminToken) localStorage.setItem(TOKEN_KEY, adminToken); loadConfig(); gpTick(); loadRelayName(); };
  document.getElementById('tok').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('tokGo').click(); });
  // When this panel is opened ON the relay machine (e.g. the desktop Relay app's own window), the relay hands
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
  let lastAuthUrl = '';     // the login link from `tailscale up`, until the node reports connected
  const gpWarn = (h) => '<div class="warn">'+h+'</div>';
  const gpCopy = (t, b) => { navigator.clipboard.writeText(t).then(()=>{ b.textContent='Copied'; setTimeout(()=>b.textContent='Copy',1400); }).catch(()=>{}); };
  window.gpTick = gpTick; window.gpCopy = gpCopy;

  function renderGoPublic(s) {
    const body = document.getElementById('gpBody'), st = document.getElementById('gpStatus');
    if (s.locked)         { st.textContent='· locked';   body.innerHTML = gpWarn('🔒 Enter the <b>admin token</b> in the Churches card below — it unlocks one-click public access too.'); return; }
    if (s.installed === false) { st.textContent='· not public yet'; body.innerHTML = cfGoHtml; wireCfGo(); return; }   // no Tailscale (e.g. desktop app) → the bundled Cloudflare tunnel is the path
    if (s.needsOperator)  { st.textContent='· needs a nudge'; body.innerHTML = gpWarn('The relay can’t manage Tailscale yet. On the relay box, run once:<br><br><code>sudo tailscale set --operator=trinityone</code><br><br>then <button class="btn-ghost" onclick="gpTick()">refresh</button>.'); return; }
    if (s.funnelOn && s.publicUrl) {
      st.textContent=''; publicBase = s.publicUrl; refreshReach();
      body.innerHTML =
        '<div class="row" style="background:color-mix(in oklab,var(--sage) 9%,var(--surface));border-color:color-mix(in oklab,var(--sage) 28%,transparent)"><span style="color:var(--sage);font-weight:700;font-size:13px">✓ Reachable from anywhere — no terminal needed</span></div>' +
        '<div class="row"><span class="k">Public URL</span><span class="v">'+esc(s.publicUrl)+'</span><button class="btn-ghost" onclick="gpCopy(\''+esc(s.publicUrl)+'\',this)">Copy</button></div>' +
        '<div class="muted" style="margin-top:6px">Test it from your phone on <b>mobile data</b> (Wi-Fi off): <a href="'+esc(s.publicUrl)+'/status" target="_blank">'+esc(s.publicUrl)+'/status</a> — JSON means it’s live worldwide.</div>';
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
    if (tsBusy) return;
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
