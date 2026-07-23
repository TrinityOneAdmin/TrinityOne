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
  const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"></rect><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path></svg>';
  // counts a row can be judged by BEFORE it is removed — "2,180 messages · 340 MB" vs "nothing stored"
  function rowCounts(c) {
    const bits = [];
    if (typeof c.events === 'number') bits.push(c.events ? c.events.toLocaleString() + (c.events === 1 ? ' message' : ' messages') : 'nothing stored');
    const b = fmtBytes(c.bytes); if (b) bits.push(b + ' of files');
    return bits.join(' · ');
  }
  function renderCfg() {
    const list = document.getElementById('cfgList');
    const count = document.getElementById('cfgCount');
    if (count) count.textContent = cfgChurches.length === 1 ? '1 church' : cfgChurches.length + ' churches';
    list.innerHTML = cfgChurches.length ? cfgChurches.map((c, i) => {
      // provenance — "you added this" vs "it registered itself" is the most useful thing on the row
      const src = c.by === 'self' ? '<span class="src src-self">Registered itself' + (c.at ? ' ' + esc(ago(c.at)) : '') + '</span>'
                : c.by === 'operator' ? '<span class="src src-you">You added this' + (c.at ? ' ' + esc(ago(c.at)) : '') + '</span>' : '';
      return '<div class="crow">' +
        '<div class="cr-badge">' + esc(c.name ? initials(c.name) : '—') + '</div>' +
        '<div class="cr-main">' +
          '<div class="cr-top">' + (c.name ? '<span class="cr-name">' + esc(c.name) + '</span>' : '<span class="cr-name unnamed">Unnamed church</span>') + src + '</div>' +
          '<div class="cr-npub"><span class="mono cr-key">' + esc(c.npub) + '</span>' +
            '<button class="iconbtn" data-copyurl="' + esc(c.npub) + '" aria-label="Copy this church’s key" title="Copy key">' + COPY_SVG + '</button></div>' +
          (rowCounts(c) ? '<div class="cr-counts">' + esc(rowCounts(c)) + '</div>' : '') +
        '</div>' +
        '<div class="cr-action"><button class="btn btn-ghost btn-sm cr-remove" data-rm="' + i + '">Remove…</button></div>' +
      '</div>';
    }).join('')
      : '<div class="warn"><span>⚠</span><span><b>No churches yet.</b> Until you add one, this relay accepts messages from anyone on the internet. Add your church above.</span></div>';
    list.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => removeChurch(cfgChurches[+b.dataset.rm]));
    wireCopyUrls(list);
  }

  // Themed dialog to replace window.confirm — same surface/buttons as the Steward console, and reliable in
  // a webview. Resolves to the chosen action's id, or null if dismissed. Esc cancels; focus lands on the
  // safe choice, never the destructive one.
  function askDialog({ title, body, actions }) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
        '<h3>' + esc(title) + '</h3><div class="body">' + body + '</div>' +
        '<div class="acts">' + actions.map((a2, i) =>
          '<button class="' + (a2.danger ? 'btn-clay' : 'btn-ghost') + '" data-i="' + i + '">' + esc(a2.label) + '</button>').join('') +
        '</div></div>';
      const done = (v) => { try { document.removeEventListener('keydown', onKey); back.remove(); } catch (e) {} resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') done(null); };
      back.onclick = (e) => { if (e.target === back) done(null); };
      document.addEventListener('keydown', onKey);
      document.body.appendChild(back);
      back.querySelectorAll('[data-i]').forEach(b2 => { b2.onclick = () => done(actions[+b2.dataset.i].id); });
      const safe = back.querySelector('.btn-ghost') || back.querySelector('button');
      if (safe) safe.focus();
    });
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
    const hasData = !!(w.events || w.blobs);
    const held = hasData
      ? `<b>${w.events.toLocaleString()} message${w.events === 1 ? '' : 's'}</b>${w.bytes ? ' and <b>' + fmtBytes(w.bytes) + '</b> of files' : ''}`
      : '<b>nothing</b>';
    // One dialog, three outcomes — rather than two chained yes/no prompts where "Cancel" meant something
    // different each time. Erasing is the only clay (destructive) button; it is never the default focus.
    const choice = await askDialog({
      title: 'Remove ' + who + '?',
      body: `<p style="margin:0 0 10px">They currently have ${held} stored on this relay.</p>` +
            `<p style="margin:0">Removing them stops them posting here. It does <b>not</b> delete what they have already stored — choose <b>Remove and erase</b> if you want that space back.</p>`,
      actions: hasData
        ? [{ id: null, label: 'Cancel' }, { id: 'keep', label: 'Remove, keep their data' }, { id: 'purge', label: 'Remove and erase', danger: true }]
        : [{ id: null, label: 'Cancel' }, { id: 'keep', label: 'Remove', danger: true }],
    });
    if (!choice) return;
    const purge = choice === 'purge';
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

  // The lock now replaces the WHOLE Settings tab rather than hiding cards one by one — a locked operator
  // used to get a tab of invisible cards plus a warning buried inside the churches card.
  function setLocked(locked) {
    const g = document.getElementById('setGate'), b = document.getElementById('setBody');
    if (g) g.style.display = locked ? 'block' : 'none';
    if (b) b.style.display = locked ? 'none' : 'block';
    syncSettingsLock(locked);   // the Dashboard's activity cards are gated by the same token
  }

  async function loadConfig() {
    const st = document.getElementById('cfgStatus');
    try {
      const r = await fetch('/config?stats=1', { headers: authHeaders(), cache: 'no-store' });   // stats so each row shows what it holds
      if (r.status === 401) { setLocked(true); document.getElementById('cfgList').innerHTML = ''; return; }
      const s = await r.json();
      setLocked(false);
      st.textContent = s.configured ? '' : '— not set up yet';
      cfgChurches = (s.churches || []).map(c => ({ npub: c.npub, name: c.name, by: c.by, at: c.at, events: c.events, blobs: c.blobs, bytes: c.bytes }));
      renderCfg();
      loadServes();
      loadUpdate();
      loadSubs();
      loadStats();
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
      document.getElementById('subsCount').textContent = (s.count || 0).toLocaleString();
      document.getElementById('subsLabel').textContent = s.count === 1 ? 'subscriber' : 'subscribers';
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
      servesBaseline = servesSnapshot();   // what's on the server right now — the thing "unsaved" is measured against
      renderServesDirty();
    } catch (e) { /* relay down — the hero card shows it */ }
  }

  // ── staged save ────────────────────────────────────────────────────────────────────────────────
  // This is the ONE card where a change waits, so it has to say so unmistakably. The card previously
  // carried a bare Save button with no indication of whether anything was pending, next to toggles
  // elsewhere on the page that applied instantly.
  const SERVES_FIELDS = ['t-app', 't-modules', 't-audio', 't-appurl', 't-mediacap', 't-churchcap'];
  let servesBaseline = null;
  const servesSnapshot = () => SERVES_FIELDS.map(id => { const el = document.getElementById(id);
    return !el ? '' : (el.type === 'checkbox' ? (el.checked ? '1' : '0') : String(el.value || '').trim()); });
  function servesChanged() {
    if (!servesBaseline) return [];
    const now = servesSnapshot();
    return SERVES_FIELDS.filter((id, i) => now[i] !== servesBaseline[i]);
  }
  function renderServesDirty() {
    const n = servesChanged().length;
    const note = document.getElementById('servesDirtyNote'), foot = document.getElementById('servesFooter'), cnt = document.getElementById('servesCount');
    if (note) note.style.display = n ? 'flex' : 'none';
    if (foot) foot.style.display = n ? 'flex' : 'none';
    if (cnt) cnt.textContent = n === 1 ? '1 change waiting' : n + ' changes waiting';
  }
  SERVES_FIELDS.forEach(id => { const el = document.getElementById(id); if (!el) return;
    el.addEventListener('change', renderServesDirty); el.addEventListener('input', renderServesDirty); });
  document.getElementById('discardServes').onclick = () => { loadServes(); };   // re-read the server, never a local undo
  async function saveServes() {
    const msg = document.getElementById('servesMsg'); msg.style.color = 'var(--ink-3)'; msg.textContent = '· saving…';
    const capBytes = (id) => Math.round((parseFloat(document.getElementById(id).value) || 0) * 1e9);
    const body = { serveApp: document.getElementById('t-app').checked, serveModules: document.getElementById('t-modules').checked, serveAudio: document.getElementById('t-audio').checked, appUrl: document.getElementById('t-appurl').value.trim(), mediaCap: capBytes('t-mediacap'), churchCap: capBytes('t-churchcap') };
    try {
      const r = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
      const s = await r.json();
      if (!r.ok) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + (s.error || 'save failed'); return; }
      msg.style.color = 'var(--sage-ink)'; msg.textContent = '· ✓ saved'; setTimeout(() => { msg.textContent = ''; }, 2400);
      await loadServes();   // re-read: the success state must reflect the server, never the write's own echo
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
  let restoreArmed = false, _restoreCleanup = null;
  // The armed state promises "click anywhere else, press Esc, or wait to cancel" — so it must actually do
  // that. Without it, an operator who armed the button, read the warning, and clicked away believing they
  // cancelled left it live: the next single click overwrote every church's data. These are the real escape
  // hatches, plus a 10s auto-disarm (the same self-protecting pattern the Update button uses).
  const disarmRestore = () => {
    restoreArmed = false;
    const btn = document.getElementById('doRestore'), msg = document.getElementById('restoreMsg');
    if (btn) btn.textContent = 'Restore…';
    if (msg && /^Click again/.test(msg.textContent)) { msg.textContent = ''; }
    if (_restoreCleanup) { _restoreCleanup(); _restoreCleanup = null; }
  };
  document.getElementById('doRestore').onclick = async () => {
    const btn = document.getElementById('doRestore'), msg = document.getElementById('restoreMsg');
    const f = (document.getElementById('restoreFile').files || [])[0];
    if (!f) { msg.style.color = 'var(--clay-ink)'; msg.textContent = 'Choose a backup file first.'; return; }
    if (!restoreArmed) {
      restoreArmed = true; btn.textContent = 'Confirm — replace everything';
      msg.style.color = 'var(--clay-ink)'; msg.textContent = 'Click again to overwrite every church’s data on this relay. Click anywhere else, press Esc, or wait to cancel.';
      const onDocClick = (ev) => { if (ev.target !== btn && !btn.contains(ev.target)) disarmRestore(); };
      const onKey = (ev) => { if (ev.key === 'Escape') disarmRestore(); };
      const t = setTimeout(disarmRestore, 10000);
      setTimeout(() => document.addEventListener('click', onDocClick), 0);   // attach AFTER this click stops bubbling, or it disarms itself
      document.addEventListener('keydown', onKey);
      _restoreCleanup = () => { clearTimeout(t); document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); };
      return;
    }
    if (_restoreCleanup) { _restoreCleanup(); _restoreCleanup = null; }
    restoreArmed = false; btn.textContent = 'Restore…';
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
  const cfGoHtml = '<div class="wzcard tone-clay"><div class="wz-badge">Not public yet</div>'
    + '<div class="wz-title">Only reachable on this network</div>'
    + '<p class="wz-p">Members outside your building can’t connect. Turn on a secure tunnel — <b>free, no account</b>, no router or port setup.</p>'
    + '<div class="wz-actions"><button class="btn btn-clay" id="cfGo">Make it public</button> <span class="wz-meta" id="cfMsg"></span></div></div>'
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
    const body = document.getElementById('gpBody');
    publicBase = cf.url; try { refreshReach(); } catch (e) {}
    gpTag(true, 'On · public');
    body.innerHTML = wz('sage', 'On · public', 'Reachable from anywhere',
      '<div class="urlbox"><span class="mono">' + esc(cf.url) + '</span>' +
      '<button class="btn btn-ghost btn-sm" data-copyurl="' + esc(cf.url) + '">Copy</button></div>' +
      '<div class="wz-meta">Members connect by the <b>name</b> you claim, so it keeps working even if this URL changes. Test from your phone on <b>mobile data</b>: <a href="' + esc(cf.url) + '/status" target="_blank">' + esc(cf.url) + '/status</a>.</div>');
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
  let updatePolling = false;
  function pollUpdate() {
    if (updatePolling) return;   // loadUpdate re-fires on a timer now; don't stack a second watcher
    updatePolling = true;
    const msg = document.getElementById('updateMsg'); let n = 0;
    const stop = (iv) => { clearInterval(iv); updatePolling = false; };
    const iv = setInterval(async () => {
      n++;
      try {
        const s = await (await fetch('/status', { cache: 'no-store' })).json();
        if (s.version && relayVersion && s.version !== relayVersion) { stop(iv); msg.style.color = 'var(--sage-ink)'; msg.textContent = '· ✓ updated'; setTimeout(loadUpdate, 800); }
      } catch (e) { /* restarting — keep polling */ }
      if (n > 40) { stop(iv); loadUpdate(); }   // stop guessing — re-read, which now carries the real outcome
    }, 3000);
  }

  // The update card was only ever read once, inside loadConfig() on page load. So a relay that published a
  // new build while this console sat open showed "Up to date" until someone thought to refresh — which is
  // exactly the moment an operator is least likely to refresh, because the page looks fine. Re-check on a
  // timer, and again whenever the tab is brought back to the foreground.
  // Never mid-flight: not while an update is running (pollUpdate owns the card then), and not while the
  // button is armed for its second confirming click — re-rendering would silently disarm it.
  function updateBusy() {
    if (updatePolling) return true;
    const b = document.getElementById('doUpdate');
    return !!(b && b.dataset.armed === '1');
  }
  setInterval(() => { if (!updateBusy() && !document.hidden) loadUpdate(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !updateBusy()) loadUpdate(); });

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
    // Feedback goes to #syncNowMsg, which sits under THIS button in the Settings card. It used to write to
    // #syncMsg — the Relay-health row on the DASHBOARD tab, hidden while Settings is open — so a click (and
    // its errors) produced no visible result on the tab the operator was looking at.
    const m = document.getElementById('syncNowMsg'); m.style.color = 'var(--ink-3)'; m.textContent = 'syncing…';
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
    const inp = document.getElementById('addNpub');
    const npub = (inp.value || '').trim();
    // inline field, not window.prompt: prompt() is unreliable in the desktop webview (the same reason
    // Restore and Update use armed buttons), and it gave no way to see or correct a mistyped key.
    if (!npub) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '\u2717 paste the church\u2019s npub first'; inp.focus(); return; }
    const name = '';   // the label resolves from the church's own profile once it publishes one
    msg.style.color = 'var(--ink-3)'; msg.textContent = 'Adding\u2026';
    try {
      const r = await fetch('/config', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ addChurch: { npub, name } }) });
      const s2 = await r.json();
      if (!r.ok) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '\u2717 ' + (s2.error || 'could not add that church'); return; }
      msg.style.color = 'var(--sage-ink)'; msg.textContent = '\u2713 added \u2014 this church can now post to the relay';
      document.getElementById('addNpub').value = '';
      setTimeout(() => { msg.textContent = ''; }, 5000);
    } catch (e) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '\u2717 ' + e.message; }
    await loadConfig();   // re-read: never render the write's own echo
  };
  document.getElementById('addNpub').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('addCh').click(); });
  document.getElementById('tokGo').onclick = async () => {
    const gm = document.getElementById('gateMsg');
    const t = document.getElementById('tok').value.trim();
    if (!t) { if (gm) { gm.style.color = 'var(--clay-ink)'; gm.textContent = 'Enter the token to unlock.'; } return; }
    if (gm) { gm.style.color = 'var(--ink-3)'; gm.textContent = 'Checking\u2026'; }
    // verify BEFORE storing, so a wrong token says so here instead of silently leaving the tab locked
    try {
      const r = await fetch('/config', { headers: { 'Authorization': 'Bearer ' + t }, cache: 'no-store' });
      if (r.status === 401) { if (gm) { gm.style.color = 'var(--clay-ink)'; gm.textContent = '\u2717 That token wasn\u2019t accepted.'; } return; }
    } catch (e) { if (gm) { gm.style.color = 'var(--clay-ink)'; gm.textContent = '\u2717 Couldn\u2019t reach the relay.'; } return; }
    adminToken = t; localStorage.setItem(TOKEN_KEY, adminToken);
    if (gm) gm.textContent = '';
    loadConfig(); gpTick(); loadRelayName();
  };
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
  const gpCopy = (t, b) => { navigator.clipboard.writeText(t).then(()=>{ b.textContent='Copied'; setTimeout(()=>b.textContent='Copy',1400); }).catch(()=>{}); };
  window.gpTick = gpTick; window.gpCopy = gpCopy;

  // The tunnel card is one card with many states. Each renders as a tone card (a coloured left rule +
  // a state badge) so "checking", "needs you", "on" and "failed" are distinguishable at a glance instead
  // of all arriving as the same block of grey prose.
  const SPIN = '<span class="ic-spin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9" opacity="0.9"></path></svg></span>';
  const wz = (tone, badge, title, inner) => '<div class="wzcard tone-' + tone + '">' +
    '<div class="wz-badge">' + badge + '</div><div class="wz-title">' + title + '</div>' + (inner || '') + '</div>';
  function gpTag(on, text) {
    const st = document.getElementById('gpStatus'); if (!st) return;
    st.innerHTML = text ? (on ? '<span class="d"></span>' : '') + esc(text) : '';
    st.style.color = on ? 'var(--sage-ink)' : 'var(--ink-3)';
  }
  function renderGoPublic(s) {
    const body = document.getElementById('gpBody');
    if (s.locked) { gpTag(false, 'Locked'); body.innerHTML = wz('ink', 'Locked', 'Unlock settings first',
      '<p class="wz-p">Enter the admin token above — it unlocks one-click public access too.</p>'); return; }
    if (s.installed === false) { gpTag(false, 'Not public yet'); body.innerHTML = cfGoHtml; wireCfGo(); return; }   // no Tailscale (e.g. desktop app) → the bundled Cloudflare tunnel is the path
    if (s.needsOperator) { gpTag(false, 'Needs a nudge');
      body.innerHTML = wz('gold', 'One step on the relay box', 'The relay can’t manage Tailscale yet',
        '<p class="wz-p">On the relay box, run this once, then refresh:</p><p class="wz-p"><code>sudo tailscale set --operator=trinityone</code></p>' +
        '<div class="wz-actions"><button class="btn btn-ghost" id="gpRefreshOp">Refresh</button></div>');
      var _rb = document.getElementById('gpRefreshOp'); if (_rb) _rb.onclick = gpTick; return; }
    if (s.funnelOn && s.publicUrl) {
      gpTag(true, 'On · public'); publicBase = s.publicUrl; refreshReach();
      body.innerHTML = wz('sage', 'On · public', 'Reachable from anywhere',
        '<div class="urlbox"><span class="mono">' + esc(s.publicUrl) + '</span>' +
        '<button class="btn btn-ghost btn-sm" data-copyurl="' + esc(s.publicUrl) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"></rect><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path></svg> Copy</button></div>' +
        '<div class="wz-meta">Test it from your phone on <b>mobile data</b> (Wi-Fi off): <a href="' + esc(s.publicUrl) + '/status" target="_blank">' + esc(s.publicUrl) + '/status</a> — JSON means it’s live worldwide.</div>');
      wireCopyUrls(body);
      return;
    }
    if (s.loggedIn) {
      gpTag(false, 'On your network');
      body.innerHTML = wz('gold', 'Almost there', 'On your network, but not public yet',
        '<p class="wz-p">This relay is on your Tailscale network' + (s.dnsName ? ' as <code>' + esc(s.dnsName) + '</code>' : '') + '. One more click lets members reach it over the internet.</p>' +
        '<div class="wz-actions"><button class="btn btn-clay" id="gpFunnel">Make it public (HTTPS)</button> <span class="wz-meta" id="gpMsg"></span></div>');
      document.getElementById('gpFunnel').onclick = doFunnel;
      return;
    }
    if (lastAuthUrl) {
      gpTag(false, 'Action needed');
      body.innerHTML = wz('gold', 'Action needed', 'Finish in the browser tab we opened',
        '<p class="wz-p">Sign in to Tailscale (same account as your other devices) and approve this machine — this updates on its own.</p>' +
        '<div class="wz-actions"><a class="btn btn-ghost" href="' + esc(lastAuthUrl) + '" target="_blank" style="text-decoration:none">Reopen that tab ↗</a>' +
        '<span class="wz-line" style="font-size:12px">' + SPIN + ' Waiting for you to authorise…</span></div>');
      return;
    }
    gpTag(false, 'Not public yet');
    body.innerHTML = cfGoHtml +
      '<div class="hint" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line-2)">Prefer a stable address on your own Tailscale? <button class="btn btn-ghost btn-sm" id="gpUp">Use Tailscale instead</button> <span class="wz-meta" id="gpMsg"></span></div>';
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

  // ── Dashboard / Settings tabs ──────────────────────────────────────────────────────────────────
  // Toggles [hidden] on the PANELS only. Per-CARD display belongs to the auth gate (loadConfig /
  // loadServes / loadSubs set .style.display on servesCard, updateCard, backupCard, subsCard); if the
  // tabs wrote card display too, switching tabs would re-reveal cards a locked operator can't use.
  const TAB_KEY = 'trinityone.relay.tab';
  const TABS = [
    { tab: 'tab-dash', panel: 'panel-dash', name: 'dash' },
    { tab: 'tab-set',  panel: 'panel-set',  name: 'set'  },
  ];
  function selectTab(name, moveFocus) {
    const want = TABS.some(t => t.name === name) ? name : 'dash';
    for (const t of TABS) {
      const tabEl = document.getElementById(t.tab), panelEl = document.getElementById(t.panel);
      if (!tabEl || !panelEl) continue;
      const on = t.name === want;
      tabEl.setAttribute('aria-selected', on ? 'true' : 'false');
      tabEl.tabIndex = on ? 0 : -1;          // roving tabindex: one stop for the whole tablist
      panelEl.hidden = !on;
      if (on && moveFocus) tabEl.focus();
    }
    try { localStorage.setItem(TAB_KEY, want); } catch (e) { /* private mode — the tab just won't persist */ }
  }
  // /stats is admin-only, so the Dashboard's activity cards are auth-gated. The token gate lives in the
  // churches card over in Settings, so when locked we say so HERE and send the operator across, rather
  // than leaving three cards spinning on "Loading…" with no explanation.
  const STAT_CARDS = ['actCard', 'kindCard', 'topCard'];
  function syncSettingsLock(locked) {
    const el = document.getElementById('dashLocked');
    if (el) el.style.display = locked ? 'block' : 'none';
    for (const id of STAT_CARDS) { const c = document.getElementById(id); if (c) c.style.display = locked ? 'none' : 'block'; }
    if (locked) for (const id of ['s-today', 's-media']) { const t = document.getElementById(id); if (t) t.textContent = '—'; }
    // the storage figures come from the same admin-only /stats, so they go with it rather than sitting
    // there as a stale reading from before the token was cleared
    if (locked) { const sr = document.getElementById('storeRow'); if (sr) sr.style.display = 'none'; }
  }
  function wireTabs() {
    TABS.forEach((t, i) => {
      const el = document.getElementById(t.tab); if (!el) return;
      el.onclick = () => selectTab(t.name, false);
      el.onkeydown = (e) => {
        const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
        if (!keys.includes(e.key)) return;
        e.preventDefault();
        const n = e.key === 'Home' ? 0
                : e.key === 'End' ? TABS.length - 1
                : (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
        selectTab(TABS[n].name, true);
      };
    });
    const unlock = document.getElementById('goUnlock');
    if (unlock) unlock.onclick = () => {
      selectTab('set', false);                 // the token gate lives in the churches card, on Settings
      const tok = document.getElementById('tok');
      if (tok) { tok.scrollIntoView({ behavior: 'smooth', block: 'center' }); tok.focus(); }
    };
    let saved = 'dash';
    try { saved = localStorage.getItem(TAB_KEY) || 'dash'; } catch (e) { /* ignore */ }
    selectTab(saved, false);
  }
  wireTabs();

  // ── Dashboard activity (/stats — admin-only) ───────────────────────────────────────────────────
  // Nostr kind numbers mean nothing to a church operator, so name the ones this app actually writes and
  // fall back to the raw number rather than inventing a label for something we don't recognise.
  const KIND_NAMES = {
    0: 'Profiles', 1: 'Posts', 3: 'Contact lists', 4: 'Direct messages', 5: 'Deletions',
    7: 'Reactions', 1059: 'Sealed messages', 1063: 'Media', 9735: 'Giving receipts',
    10002: 'Relay lists', 22242: 'Sign-ins', 30078: 'Church records',
  };
  const kindName = (k) => KIND_NAMES[k] || ('Kind ' + k);
  const fmtStore = (b) => { b = Number(b) || 0; if (b <= 0) return '0'; const u = ['B','KB','MB','GB','TB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
    const n = b / Math.pow(1024, i); return (n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i]; };
  const dayLabel = (sec) => new Date(sec * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  function barRows(items, total, into) {
    const el = document.getElementById(into); if (!el) return;
    if (!items.length) { el.innerHTML = '<div class="muted">Nothing stored yet.</div>'; return; }
    const max = Math.max(...items.map(i => i.n), 1);
    el.innerHTML = items.map(i => {
      const pct = Math.round((i.n / total) * 100);
      return '<div class="bar-row"><div class="bar-top"><b>' + esc(i.label) + '</b><span>' +
        i.n.toLocaleString() + (total ? ' · ' + pct + '%' : '') + '</span></div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(2, Math.round((i.n / max) * 100)) + '%"></div></div></div>';
    }).join('');
  }

  function renderActivity(s) {
    const bars = document.getElementById('actBars'); if (!bars) return;
    const daily = s.daily || [];
    const max = Math.max(...daily.map(d => d.n), 1);
    const total = daily.reduce((a, d) => a + d.n, 0);
    // height is scaled to the busiest day, so the shape is relative — the peak is labelled underneath so
    // nobody reads a tall bar on a quiet relay as a lot of traffic.
    bars.innerHTML = daily.map(d => {
      const h = d.n ? Math.max(4, Math.round((d.n / max) * 100)) : 0;
      const cls = d.n === 0 ? 'zero' : (d.n === max ? 'hot' : '');
      return '<i class="' + cls + '" style="height:' + (d.n ? h + '%' : '2px') + '" title="' +
        esc(dayLabel(d.day)) + ': ' + d.n + (d.n === 1 ? ' event' : ' events') + '"></i>';
    }).join('');
    const from = document.getElementById('actFrom'), to = document.getElementById('actTo');
    if (from && daily.length) from.textContent = dayLabel(daily[0].day);
    if (to && daily.length) to.textContent = 'today';
    const range = document.getElementById('actRange');
    if (range) range.textContent = '· last ' + (s.days || 10) + ' days';
    const note = document.getElementById('actNote');
    if (note) note.textContent = total === 0
      ? 'Nothing published in this window.'
      : total.toLocaleString() + ' events · busiest day ' + max.toLocaleString() + '.';
    const today = document.getElementById('s-today');
    if (today && daily.length) today.textContent = daily[daily.length - 1].n.toLocaleString();
  }

  // How much room this box has, and how much of it is gone. A cap of 0 means unlimited — there is no
  // proportion to draw then, so we say so in words rather than showing an empty bar that would read as
  // "plenty of room" on a relay that actually has no ceiling at all. Thresholds are named, not just
  // coloured, because an operator has to be able to act on this from a glance on a phone.
  function renderStorage(m) {
    const row = document.getElementById('storeRow'); if (!row) return;
    const used = Number(m.bytes) || 0, cap = Number(m.capBytes) || 0;
    const text = document.getElementById('storeText'), fill = document.getElementById('storeFill'),
          note = document.getElementById('storeNote'), track = fill && fill.parentElement;
    row.style.display = 'block';
    if (cap <= 0) {
      if (text) text.textContent = fmtStore(used) + ' used';
      if (track) track.style.display = 'none';
      if (note) { note.className = 'meter-note'; note.textContent = 'No limit set — this box will keep accepting media until the disk is full.'; }
      return;
    }
    if (track) track.style.display = '';
    const pct = (used / cap) * 100, left = Math.max(0, cap - used);
    if (text) text.textContent = fmtStore(used) + ' of ' + fmtStore(cap);
    // a hair of fill for a non-zero-but-tiny amount, so "something is stored" is visible at 0.4%
    if (fill) {
      fill.style.width = (used > 0 ? Math.max(2, Math.min(100, Math.round(pct))) : 0) + '%';
      fill.className = 'bar-fill' + (pct >= 90 ? ' meter--crit' : pct >= 75 ? ' meter--warn' : '');
    }
    if (note) {
      note.className = 'meter-note' + (pct >= 90 ? ' meter--crit' : pct >= 75 ? ' meter--warn' : '');
      note.textContent = used >= cap ? 'Full — new uploads are being refused.'
        : pct >= 90 ? 'Nearly full — only ' + fmtStore(left) + ' left. Raise the limit in Settings or remove some media.'
        : pct >= 75 ? fmtStore(left) + ' left.'
        : (pct < 1 ? 'Under 1% used' : Math.round(pct) + '% used') + ' · ' + fmtStore(left) + ' free.';
    }
  }

  async function loadStats() {
    try {
      const r = await fetch('/stats?days=10', { headers: authHeaders(), cache: 'no-store' });
      if (r.status === 401) { syncSettingsLock(true); return; }
      const s = await r.json();
      syncSettingsLock(false);
      renderActivity(s);
      const kinds = (s.kinds || []).map(k => ({ label: kindName(k.kind), n: k.n }));
      barRows(kinds.slice(0, 7), kinds.reduce((a, k) => a + k.n, 0), 'kindBody');
      // Match the churches list's language rather than printing a raw key at anyone — but two different
      // churches CAN carry the same name (and on this relay three of them do). Identical rows would be
      // indistinguishable, so a repeated name earns a key fragment to tell them apart.
      const raw = (s.churches || []).map(c => ({ name: c.name || 'Unnamed church', church: c.church || '', n: c.n }));
      const seen = raw.reduce((m, c) => m.set(c.name, (m.get(c.name) || 0) + 1), new Map());
      const chs = raw.map(c => ({ label: seen.get(c.name) > 1 ? c.name + ' · ' + c.church.slice(0, 6) : c.name, n: c.n }));
      barRows(chs.slice(0, 6), chs.reduce((a, c) => a + c.n, 0), 'topBody');
      const media = document.getElementById('s-media');
      if (media) media.textContent = fmtStore((s.media || {}).bytes);
      renderStorage(s.media || {});
    } catch (e) { /* relay down — the hero already says so */ }
  }
  // the activity window moves slowly; a minute is plenty and keeps "Sent today" honest without polling
  // the aggregates as hard as /status.
  setInterval(loadStats, 60000);
