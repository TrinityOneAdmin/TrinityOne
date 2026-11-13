// control.js — extracted from control.html so it runs under the strict CSP (script-src 'self',
// no 'unsafe-inline'). The member app + steward console are already external-script-only; this file
// brings the relay control panel in line. See gateway CSP (_strictWeb).
  const qs = new URLSearchParams(location.search);
  // public base: the Funnel URL once it's up (set by the wizard), else ?public=…, else this origin
  let publicBase = qs.get('public') || location.origin;
  const copyMap = { wss: '', console: '' };

  // Clipboard handling lives in copy.js so control.js and home.js cannot drift apart.
  const { copyText, flashCopied, showCopyFallback, copyWithFeedback } = window.RelayCopy;

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
      : '<div class="warn">⚠ Only reachable on this computer or your local network. Turn on public access in Settings.</div>';
  }
  // Return to the Steward console IN THIS WINDOW — window.open('_blank') doesn't work in the desktop app's
  // webview. Prefer going back (preserves the console's state); fall back to navigating there fresh.
  document.getElementById('openConsole').onclick = () => { if (window.RelayPanelClose) { window.RelayPanelClose(); return; } if (history.length > 1) { history.back(); } else { location.href = '/relay-app/home.html'; } };   // fall back to the launcher (neutral) — not the full-suite console, which contradicts a "Relay only" choice
  document.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    await copyWithFeedback(copyMap[b.dataset.copy], b, b.dataset.copy === 'wss' ? 'Relay address' : 'Console link');
  });
  refreshReach();

  // ── THE NEXT STEP WHILE THIS RELAY HOSTS NO CHURCH ────────────────────────────────────────────────────
  // Owner, 2026-09-22, first run of the real app: after the relay wizard "no church existed on the relay" and
  // nothing said why. Correct — a church is CREATED IN THE CONSOLE (naming it there registers it here, the
  // 2026-09-04 decision) — but the panel had to say so. ONE caller: poll(), every 5 s, with /status's public
  // `writePolicy` (true iff the relay has a church; no token needed, so a locked panel still gets it). A
  // second call from loadConfig() was tried and removed: sabotaging it changed nothing the test could see.
  // `undefined` (a relay that does not say) hides the card: a claim this panel cannot back is worse than none.
  function renderNextStep(hasChurch) {
    const el = document.getElementById('nextStep');
    if (!el) return;
    el.style.display = hasChurch === false ? 'block' : 'none';
  }

  const initials = (n) => (n||'?').split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  // The headline "Churches" figure = churches REGISTERED on this relay (`/status` counts.churches, authed), not
  // churches with >=1 stored event (`/stats` churches, capped at 8 by qByChurch LIMIT 8). Falls back to the old
  // active count when the relay (older, or unauthed) sends no counts.
  function registeredChurches(s, st) {
    return (s && s.counts && typeof s.counts.churches === 'number') ? s.counts.churches : ((st && st.churches) || []).length;
  }
  async function poll() {
    // REACHABILITY IS DECIDED BY THE FETCH, NOTHING ELSE. This try used to wrap the fetch AND every DOM
    // update after it, so any rendering error landed in the catch below and told a volunteer their relay
    // was down. It did, continuously: `/status` stopped returning `counts` (it is still in the
    // open-source snapshot at fcbf20a, "carries only non-sensitive counts"), so `s.counts.churches` threw
    // on every poll — five seconds apart, for ever — on a perfectly healthy box.
    //
    // What that looked like, measured 2026-09-07: the first line of every tab read "Relay not reachable —
    // Is the relay running? Restart the app." while the same page showed 294 events, two churches and
    // "✓ Reachable from anywhere", and /status answered ok:true. The one instruction on screen was to
    // restart the thing that was working. Four of the six headline cards were dashes at the same time —
    // the four assignments after the throw — sitting beside the very numbers they claimed not to know.
    // One defect, two findings (round 4, #2 and #3).
    let s;
    try {
      // the admin token makes /status add `counts` (REGISTERED churches); without it the field is simply absent.
      // adminFetch (not a bare fetch) so a stale token self-heals here too — otherwise /status would keep
      // coming back without `counts` and the headline would silently fall back to the active count for ever.
      const r = await adminFetch('/status');
      s = await r.json();
    } catch (e) {
      document.getElementById('dot').className = 'dot off';
      document.getElementById('title').textContent = 'Relay not reachable';
      document.getElementById('sub').textContent = 'Is the relay running? Restart the app.';
      return;
    }
    try {
      document.getElementById('dot').className = 'dot on';
      document.getElementById('title').textContent = 'Your relay is running';
      const up = Math.floor(s.uptimeMs/1000); const h=Math.floor(up/3600), m=Math.floor((up%3600)/60);
      document.getElementById('sub').textContent = 'Up ' + (h?h+'h ':'') + m + 'm · port ' + s.port;
      // no church yet → the next-step card (the church is created in the console, not here)
      renderNextStep(typeof s.writePolicy === 'boolean' ? s.writePolicy : undefined);
      // COUNTS COME FROM THE ADMIN-GATED /stats, NOT FROM /status. They were read from `s.counts` on the
      // public, unauthenticated /status — and they are church-identifying, which is the standard the rest
      // of that handler holds itself to (the clock was justified there as "says nothing about the
      // church"). So they are not being restored to /status; the panel already holds an admin token and
      // already calls /stats for the activity chart. `—` stays put when a number is genuinely unknown.
      const st = await adminFetch('/stats?days=1')
        .then(r2 => { noteStatsStatus(r2.status); return r2.ok ? r2.json() : null; }).catch(() => null);
      if (st) {
        const kinds = st.kinds || [];
        const total = kinds.reduce((a, k) => a + (k.n || 0), 0);
        document.getElementById('s-churches').textContent = registeredChurches(s, st);
        // APPROVED members across every hosted church (a person in two churches counts twice) — `st.members`,
        // computed by the relay from each church's roster. NOT the kind-0 count it used to be: that counted
        // profile events, so pending joiners and blocked people were "members". An older relay sends no
        // `members`, and then the tile stays `—` rather than showing a number that means something else.
        if (typeof st.members === 'number') document.getElementById('s-members').textContent = st.members;
        document.getElementById('s-events').textContent = total.toLocaleString();
        if (st.connections != null) document.getElementById('s-conns').textContent = st.connections;
      }
      renderDisk(s.storage);
    } catch (e) {
      // THE RELAY ANSWERED. Whatever went wrong here is ours — a field that changed shape, a missing
      // element — and it must never be reported as the relay being down, which is what sent a volunteer
      // to restart a healthy box for weeks. Leave the "running" headline alone (the fetch above earned
      // it), leave whatever rendered before this, and say plainly that the panel is the broken part.
      try {
        document.getElementById('sub').textContent = 'Your relay is answering, but this page couldn’t read part of its reply.';
      } catch (e2) {}
      try { console.error('[relay panel] render failed after a successful /status', e); } catch (e2) {}
    }
  }

  // ── setup wizard: read/write the relay's write policy (church.json) via /config ──
  const TOKEN_KEY = 'to_relay_admin_token';
  // Blocked/throwing storage (private mode, hardened webview) must not stop the script: poll() is started
  // below this line, so an unguarded throw here would leave the hero card frozen and never polling.
  let adminToken = '';
  try { adminToken = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  // THE OLD COPY ON DISK. Until 3e3c8f7 the token was kept in localStorage; that commit moved the writes to
  // sessionStorage and never removed what was already there, so a box that had opened this panel before kept
  // its admin bearer token on disk for ever. Remove it on every load. Nothing reads this key from localStorage
  // any more — not this file, and not the console that shares this origin on a Suite box.
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  let cfgChurches = [];
  const esc = (s) => String(s||'').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const authHeaders = () => adminToken ? { 'Authorization': 'Bearer ' + adminToken } : {};
  // ADMIN-FETCH-BEGIN (lifted and run by scripts/relay-app-admin-token.test.mjs — keep the markers)
  // Self-healing admin token. A cached token can go stale (admin.json lost, or a remote view with no token).
  // reauth(): ONE in-flight attempt shared by every caller, at most one /local-token try per 30s after a try,
  // and adminToken/sessionStorage are only touched when /local-token actually returns a token — a 403 (remote
  // view) must never wipe a valid token.
  let _reauthP = null, _lastReauth = 0;
  function reauth() {
    if (_reauthP) return _reauthP;
    if (Date.now() - _lastReauth < 30000) return Promise.resolve(!!adminToken);
    _lastReauth = Date.now();
    _reauthP = (async () => {
      try {
        const r = await fetch('/local-token', { cache: 'no-store' });
        if (r.ok) { const j = await r.json(); if (j && j.token) { adminToken = j.token; try { sessionStorage.setItem(TOKEN_KEY, adminToken); } catch (e) {} } }
      } catch (e) {}
      finally { _reauthP = null; }
      return !!adminToken;
    })();
    return _reauthP;
  }
  // adminFetch(): for admin GET reads only. Sends the token, hands the caller the real Response (so r.status is
  // visible), and after a 401 re-acquires the token once and retries once. Never use it for a mutation.
  async function adminFetch(url, opts = {}) {
    const go = () => fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...authHeaders() }, cache: 'no-store' });
    let r = await go();
    if (r.status === 401) { await reauth(); r = await go(); }
    return r;
  }
  // ADMIN-FETCH-END
  // ONE lock flag for the Dashboard's admin-gated numbers, read by poll() (5s) and loadStats() (60s) so the two
  // timers never flicker the cards against each other.
  let statsLocked = false;
  function noteStatsStatus(status) {
    const want = status === 401;
    if (want === statsLocked) return;
    statsLocked = want;
    syncSettingsLock(want);
  }
  // Started HERE, not where poll() is declared: poll() now calls adminFetch() (which uses authHeaders) before
  // its first await, and adminFetch/reauth/noteStatsStatus/authHeaders are all declared above this line, so
  // starting earlier would hit the temporal dead zone.
  poll(); setInterval(poll, 5000);

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
            '<button class="iconbtn" data-copyurl="' + esc(c.npub) + '" data-copylabel="This church’s key" aria-label="Copy this church’s key" title="Copy key">' + COPY_SVG + '</button></div>' +
          (rowCounts(c) ? '<div class="cr-counts">' + esc(rowCounts(c)) + '</div>' : '') +
        '</div>' +
        '<div class="cr-action"><button class="btn btn-ghost btn-sm cr-remove" data-rm="' + i + '">Remove…</button></div>' +
      '</div>';
    }).join('')
      // ⚠ NOT "accepts messages from anyone on the internet" — it said that long after gateway.mjs accept()
      // started refusing every write from a box with no churches. And the first church is not "added above":
      // it is created in the console (naming it there registers it here). The paste field is for a church
      // that already exists somewhere else.
      : '<div class="warn"><span>⚠</span><span><b>No churches yet.</b> This relay stores nothing until it has one. Your own church is created in the console — <a href="/steward.html" id="cfgNoneConsole">open the console</a>. A church run from another device is added by its npub above.</span></div>';
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
      const r = await adminFetch('/config?stats=1');   // stats so each row shows what it holds
      if (r.status === 401) { setLocked(true); document.getElementById('cfgList').innerHTML = ''; return; }
      const s = await r.json();
      setLocked(false);
      st.textContent = s.configured ? '' : '— none yet';
      cfgChurches = (s.churches || []).map(c => ({ npub: c.npub, name: c.name, by: c.by, at: c.at, events: c.events, blobs: c.blobs, bytes: c.bytes }));
      renderCfg();
      loadServes();
      loadUpdate();
      loadSubs();
      stLoad();   // the storage card + its Dashboard reminder (hidden unless this box opted in)
      loadStats();
    } catch (e) { /* relay down — the hero card shows it */ }
  }
  let subsCache = [];
  async function loadSubs() {
    const card = document.getElementById('subsCard');
    try {
      const r = await adminFetch('/subscribe');
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
      const r = await adminFetch('/settings');
      if (r.status === 401) { card.style.display = 'none'; return; }   // shown only when unlocked with the admin token
      const j = await r.json(); const s = j.settings || {};
      card.style.display = 'block';
      document.getElementById('t-app').checked = s.serveApp !== false;
      document.getElementById('t-modules').checked = s.serveModules !== false;
      document.getElementById('t-audio').checked = s.serveAudio !== false;
      document.getElementById('t-appurl').value = s.appUrl || '';
      if (typeof updateDnsWizard === 'function') { _dnsTs = ''; updateDnsWizard(); }
      const gb = (b) => b ? String(Math.round(b / 1e9 * 100) / 100) : '';
      document.getElementById('t-mediacap').value = gb(s.mediaCap);
      document.getElementById('t-churchcap').value = gb(s.churchCap);
      const io = document.getElementById('t-inviteonly'); if (io) io.checked = s.inviteOnly === true;   // access mode lives with the church list card
      const lan = document.getElementById('t-lan'); if (lan) lan.checked = s.lanAccess === true;   // desktop app only; read at launch from the lan-access marker
      const ka = document.getElementById('t-keepawake'); if (ka) ka.checked = keepAwakeChecked(s);   // default ON; the Tauri controller reads the keep-awake-off marker, not this value
      const of = document.getElementById('t-offer'); if (of) of.checked = s.offerHosting === true;
      const sn = document.getElementById('t-shownames'); if (sn) sn.checked = s.showChurchNames === true;
      const krc = document.getElementById('keepRelayCurrent'); if (krc) krc.checked = s.keepRelayCurrent === true;
      // backup/restore card (unlocked with the admin token, same as this settings fetch). The download streams a
      // big file, so it's a plain <a download> with the token in the query rather than a fetch-into-memory blob.
      const bc = document.getElementById('backupCard'); if (bc) bc.style.display = 'block';
      // Download via a one-time ticket so the admin secret never sits in a URL (history/logs/referrers).
      const dlb = document.getElementById('dlBackup');
      if (dlb) dlb.onclick = async (e) => {
        e.preventDefault();
        try {
          const r = await fetch('/relay-backup-ticket', { method: 'POST', headers: authHeaders() });
          if (!r.ok) return;
          const j = await r.json();
          const a = document.createElement('a'); a.href = '/relay-backup?ticket=' + encodeURIComponent(j.ticket); a.download = ''; document.body.appendChild(a); a.click(); a.remove();
        } catch (err) {}
      };
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
    const _lan = document.getElementById('t-lan');
    const body = { serveApp: document.getElementById('t-app').checked, serveModules: document.getElementById('t-modules').checked, serveAudio: document.getElementById('t-audio').checked, ...(_lan ? { lanAccess: _lan.checked } : {}), appUrl: document.getElementById('t-appurl').value.trim(), mediaCap: capBytes('t-mediacap'), churchCap: capBytes('t-churchcap') };
    try {
      const r = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
      const s = await r.json();
      if (!r.ok) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + (s.error || 'save failed'); return; }
      msg.style.color = 'var(--sage-ink)'; msg.textContent = '· ✓ saved'; setTimeout(() => { msg.textContent = ''; }, 2400);
      await loadServes();   // re-read: the success state must reflect the server, never the write's own echo
    } catch (e) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + e.message; }
  }
  document.getElementById('saveServes').onclick = saveServes;

  // ── DNS wizard: show setup instructions when a domain is entered ──────────
  var _dnsTs = '';
  function updateDnsWizard() {
    const raw = (document.getElementById('t-appurl').value || '').trim();
    const domain = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
    const wiz = document.getElementById('dnsWizard');
    if (!domain || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(domain)) { wiz.style.display = 'none'; return; }
    if (domain === _dnsTs) return;
    _dnsTs = domain;
    wiz.style.display = 'block';
    const steps = document.getElementById('dnsSteps');
    steps.innerHTML =
      '<div style="margin-bottom:6px">Go to your domain registrar (where you bought <code>' + esc(domain) + '</code>) and create a DNS record:</div>' +
      '<table style="width:100%; border-collapse:collapse; font-size:12px; font-family:var(--mono)">' +
      '<tr style="border-bottom:1px solid var(--line)"><td style="padding:5px 8px; font-weight:700; color:var(--ink-3)">Type</td><td style="padding:5px 8px"><b>A</b> (or <b>CNAME</b>)</td></tr>' +
      '<tr style="border-bottom:1px solid var(--line)"><td style="padding:5px 8px; font-weight:700; color:var(--ink-3)">Name</td><td style="padding:5px 8px">' + esc(domain) + '</td></tr>' +
      '<tr><td style="padding:5px 8px; font-weight:700; color:var(--ink-3)">Points to</td><td style="padding:5px 8px" id="dnsTarget"><span style="color:var(--ink-3)">loading…</span></td></tr>' +
      '</table>' +
      '<div style="font-size:11.5px; color:var(--ink-3); margin-top:8px">If using a CNAME, point it at your Tailscale hostname. If using an A record, point it at this relay’s IP address. Changes can take a few minutes to propagate.</div>';
    adminFetch('/dns-check?domain=' + encodeURIComponent(domain))
      .then(r => r.json()).then(j => {
        const tgt = document.getElementById('dnsTarget');
        if (!tgt) return;
        if (j.tsDns) tgt.innerHTML = '<b>' + esc(j.tsDns) + '</b> <span style="color:var(--ink-3)">(CNAME)</span> or <b>' + esc((j.ownAddrs || [])[0] || '?') + '</b> <span style="color:var(--ink-3)">(A record)</span>';
        else if (j.ownAddrs && j.ownAddrs.length) tgt.innerHTML = '<b>' + esc(j.ownAddrs[0]) + '</b>';
        else tgt.textContent = '(could not detect — check your network)';
      }).catch(() => {});
  }
  document.getElementById('t-appurl').addEventListener('input', updateDnsWizard);
  document.getElementById('t-appurl').addEventListener('change', updateDnsWizard);
  document.getElementById('dnsCheck').onclick = async () => {
    const raw = (document.getElementById('t-appurl').value || '').trim();
    const domain = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
    const res = document.getElementById('dnsResult');
    if (!domain) { res.textContent = ''; return; }
    res.style.color = 'var(--ink-3)'; res.textContent = 'Checking…';
    try {
      const r = await adminFetch('/dns-check?domain=' + encodeURIComponent(domain));
      const j = await r.json();
      if (!j.ok) { res.style.color = 'var(--clay-ink)'; res.textContent = '✗ ' + (j.error || 'lookup failed'); return; }
      if (j.pointsHere) { res.style.color = 'var(--sage-ink)'; res.textContent = '✓ ' + domain + ' points to this relay'; }
      else { res.style.color = 'var(--clay-ink)'; res.textContent = '✗ ' + domain + ' resolves to ' + (j.resolved || []).join(', ') + ' — not this relay' + ((j.ownAddrs || []).length ? ' (' + j.ownAddrs.join(', ') + ')' : ''); }
    } catch (e) { res.style.color = 'var(--clay-ink)'; res.textContent = '✗ ' + e.message; }
  };
  // show the wizard if a domain is already saved
  setTimeout(updateDnsWizard, 500);

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
  document.getElementById('t-shownames').onchange = async (e) => {
    const on = e.target.checked, msg = document.getElementById('cfgMsg');
    if (msg) { msg.style.color = 'var(--ink-3)'; msg.textContent = '· saving…'; }
    try {
      const r = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ showChurchNames: on }) });
      if (!r.ok) throw new Error('save failed');
      if (msg) { msg.style.color = 'var(--sage-ink)'; msg.textContent = on ? '· ✓ showing real church names' : '· ✓ using generated names'; setTimeout(() => { msg.textContent = ''; }, 3000); }
      loadConfig();
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
      const r = await adminFetch('/relay-names/mine');
      if (r.status === 401) { body.innerHTML = '<div class="muted">Enter the admin token (Churches card below) to manage your relay’s name.</div>'; return; }
      const m = await r.json();
      const pet = petName(m.pub);
      // A name CAN be reserved before the relay is public — public access is the last setup step, so hiding the
      // input until then threw the typed name away. Pre-public a handle is RESERVED (held on this computer, goes
      // live at go-public); once public it is the live directory name. The input renders in both states.
      const isPublic = !!m.relayWss;
      let html = pet ? '<div style="margin-bottom:10px">Known as <b>' + esc(pet) + '</b> <span class="muted">— a name from this relay’s key, so people can recognise it.</span></div>' : '';
      if (m.handle) html += isPublic
        ? '<div style="margin-bottom:8px">Public name: <b>' + esc(m.handle) + '</b> <span class="muted">— stewards connect their church by typing this in the console.</span></div>'
        : '<div style="margin-bottom:8px">Reserved: <b>' + esc(m.handle) + '</b> <span class="muted">— held on this computer; goes live when you turn on public access.</span></div>';
      const ph = m.handle ? (isPublic ? 'change name' : 'change reserved name') : 'choose a name, e.g. grace-city';
      const btn = m.handle ? (isPublic ? 'Update' : 'Update reservation') : (isPublic ? 'Claim' : 'Reserve');
      const btnTitle = isPublic
        ? (m.handle ? 'Change the public name this relay is reachable by.' : 'Claim this name in the relay directory so stewards can connect to your church by name.')
        : 'Reserve this name now; it is held on this computer and registered in the relay directory the moment you turn on public access.';
      html += '<div style="display:flex; gap:8px; margin-top:6px"><input id="relayNameIn" placeholder="' + ph + '" autocomplete="off" aria-label="Relay name to ' + (isPublic ? 'claim' : 'reserve') + '" title="A short, memorable handle (letters, numbers, hyphens) that stewards type in Settings → Relays → Connect by name. It always points at this relay&#39;s current address, so it keeps working even after the tunnel URL changes on restart." /><button class="btn-clay" id="relayNameGo" style="white-space:nowrap" title="' + btnTitle + '">' + btn + '</button></div><div class="muted" id="relayNameMsg" style="margin-top:6px"></div>';
      if (!isPublic) html += '<div class="muted" style="margin-top:4px">It goes live — others can type it to connect — the moment you turn on public access above.</div>';
      body.innerHTML = html;
      const go = document.getElementById('relayNameGo'); if (go) go.onclick = claimRelayName;
      const inp = document.getElementById('relayNameIn'); if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') claimRelayName(); });
    } catch (e) { body.innerHTML = '<div class="muted">Couldn’t load the relay name.</div>'; }
  }
  // Cloudflare quick tunnel "go public" — lives in the Reach-members card (see renderGoPublic). One click, no account.
  const cfGoHtml = '<div class="wzcard tone-clay"><div class="wz-badge">Not public yet</div>'
    + '<div class="wz-title">Only reachable on this network</div>'
    + '<p class="wz-p">Members outside your building can’t connect. Turn on a secure tunnel — <b>free, no account</b>, no router or port setup.</p>'
    + '<div class="wz-actions"><button class="btn btn-clay" id="cfGo" title="Give your relay a secure public web address so members can reach it from anywhere">Make it public</button> <span class="wz-meta" id="cfMsg"></span></div></div>'
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
      verifyReservationRegistered();   // a name reserved before now is published by reclaimRelayName at go-public; confirm it took before crying "taken"
    } catch (e) { if (msg) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + e.message; } if (btn) btn.disabled = false; }
  }
  // After go-public, confirm a RESERVED name actually registered before we tell the operator it was taken.
  // reclaimRelayName() is fire-and-forget with up to an 8s per-peer timeout, so the ordinary ~900ms dashboard
  // reload races AHEAD of propagation and would false-flag a name that is registering fine. So resolve the name
  // a few times over ~12s. Only a directory that ANSWERS and still does NOT resolve the name to our pub after the
  // whole window is a real conflict; a directory we cannot reach at all is inconclusive and stays silent (mirrors
  // the server's fail-open reserve), so an offline box is never told its name was taken.
  async function verifyReservationRegistered() {
    let m; try { m = await (await adminFetch('/relay-names/mine')).json(); } catch (e) { return; }
    if (!m || !m.handle || !m.relayWss || !m.directory || !m.pub) return;   // nothing reserved, or not public yet
    const url = String(m.directory).replace(/\/+$/, '') + '/relay-names/resolve/' + encodeURIComponent(m.handle);
    let answered = false, ours = false;
    for (let i = 0; i < 6 && !ours; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (r.status === 404) { answered = true; continue; }   // not propagated yet — keep waiting
        if (r.ok) { answered = true; let rec = null; try { rec = await r.json(); } catch {} ours = !!(rec && rec.pub && rec.pub === m.pub); }
      } catch (e) {}   // directory unreachable — inconclusive, try again
    }
    if (answered && !ours) {
      const msg = document.getElementById('relayNameMsg'), inp = document.getElementById('relayNameIn');
      if (inp && !inp.value) inp.value = m.handle;
      if (msg) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ couldn’t register “' + m.handle + '” — it was taken. Choose another.'; }
    }
  }
  // STAY-PUBLIC-BEGIN (lifted and run by scripts/relay-app-stay-public.test.mjs — keep the markers)
  // The "Stay public" switch governs the cloudflared quick tunnel only. ON = POST /tunnel/up (opens the tunnel AND
  // writes the stay-public flag, so the watchdog keeps it up). OFF = POST /tunnel/down (kills it AND clears the flag,
  // so the watchdog leaves it alone). Pure: returns a result and never touches the DOM.
  async function stayPublicRequest(on, headers, fetchFn) {
    const url = on ? '/tunnel/up' : '/tunnel/down';
    try {
      const r = await fetchFn(url, { method: 'POST', headers: headers || {} });
      let j = {}; try { j = await r.json(); } catch (e) {}
      if (!r.ok) return { ok: false, error: (j && j.error) || ('HTTP ' + r.status) };
      return { ok: true, url: on ? (j.url || '') : '' };
    } catch (e) { return { ok: false, error: e.message || 'network error' }; }
  }
  // What the switch should show for a /tunnel/state reply. null (relay unreachable) = leave the switch as it is.
  function stayPublicChecked(cf) { return cf ? !!(cf.running && cf.url) : null; }
  // Disable the switch when the Tailscale funnel is the active public path: this switch governs only the cloudflared
  // quick tunnel, so toggling it there would mislead (the box stays reachable via Tailscale regardless). Owner
  // direction 2026-11-03: lean on Tailscale, not a single provider. cf (tunnel state) + ts (tailscale state).
  function stayPublicDisabled(cf, ts) {
    const cfUp = !!(cf && cf.running && cf.url);
    const tsFunnel = !!(ts && ts.funnelOn && ts.publicUrl);
    return !cfUp && tsFunnel;
  }
  // STAY-PUBLIC-END
  // KEEP-AWAKE-BEGIN (lifted and run by scripts/keep-awake-switch.test.mjs — keep the markers)
  // Keep-awake stops this computer sleeping while the relay is public, so members can reach the church at any
  // hour. DEFAULT ON (owner decision): the toggle reflects SETTINGS.keepAwake, treating ONLY an explicit false
  // as off and an unreachable relay (null settings) as on. Pure: no DOM, no fetch.
  function keepAwakeChecked(settings) { return settings ? settings.keepAwake !== false : true; }
  // The /settings POST body the toggle sends on change. keepAwake:true => the gateway REMOVES the
  // keep-awake-off marker (sleep inhibited); keepAwake:false => it WRITES the marker (sleep allowed). The
  // marker sense is inverted on disk — see the keepAwake block in scripts/gateway.mjs.
  function keepAwakeBody(on) { return { keepAwake: !!on }; }
  // KEEP-AWAKE-END
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
    (root || document).querySelectorAll('[data-copyurl]').forEach(b => {
      b.onclick = () => copyWithFeedback(b.dataset.copyurl, b, b.getAttribute('data-copylabel') || 'Copy');
    });
  }
  async function claimRelayName() {
    const inp = document.getElementById('relayNameIn'); const msg = document.getElementById('relayNameMsg');
    const handle = (inp.value || '').trim().toLowerCase(); if (!handle) return;
    msg.style.color = 'var(--ink-3)'; msg.textContent = '· claiming…';
    try {
      const r = await fetch('/relay-names/mine', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ handle }) });
      const j = await r.json();
      if (!r.ok) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + (j.error || 'failed'); return; }
      msg.style.color = 'var(--sage-ink)'; msg.textContent = j.reserved ? '· ✓ reserved “' + j.handle + '” — goes live when public' : '· ✓ claimed “' + j.handle + '”'; setTimeout(loadRelayName, 1200);
    } catch (e) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + e.message; }
  }

  // ── relay software updates (version check + one-click "Update now") via /update + /status ──
  let relayVersion = '';
  async function loadUpdate() {
    const card = document.getElementById('updateCard');
    try {
      const r = await adminFetch('/update');
      if (r.status === 401) { card.style.display = 'none'; return; }
      const cur = await r.json(); relayVersion = cur.version || '';
      card.style.display = 'block';
      document.getElementById('u-current').textContent = (cur.versionShort || '—') + (cur.builtAt ? ' · ' + cur.builtAt.slice(0, 10) : '');
      // The update-source field mirrors the file on the box, never the value somebody last typed — except
      // while the operator is typing in it, when a 60-second re-read must not wipe their edit.
      const oIn = document.getElementById('originIn');
      if (oIn && document.activeElement !== oIn) oIn.value = cur.origin || '';
      const oFold = document.getElementById('originFold'); if (oFold && !cur.origin) oFold.open = true;
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
      // THREE STATES THAT USED TO BE ONE FALSE SENTENCE. With no origin this card said "This is the release
      // source — nothing to pull here" — true of exactly one machine, and shown on every Suite and every
      // fresh box. A Suite's code is read-only inside the installed app and nothing there consumes the
      // update flag, so its software moves with the Suite itself; a box with no source is told so and given
      // the field above rather than a button that would fail underneath.
      if (cur.packaged) { body.innerHTML = 'This relay is part of the <b>TrinityOne Suite</b>: it updates when you install a newer Suite. The launcher (Back) says when one is out.'; return; }
      // WHERE THE CODE COMES FROM is its own answer (cur.codeSource, relay/code-source — a GitHub release on
      // a box installed since 2026-09-21) and is what "Update now" pulls; the update source above is where
      // the installers come from. A box without a code source pulls from its update source, as before.
      const codeSrc = cur.codeSource || cur.origin;
      const from = cur.codeSource && cur.codeSource !== cur.origin ? '<div class="hint" style="margin-bottom:6px">Software comes from ' + esc(cur.codeSource) + '. The update source below is only for the app installer.</div>' : '';
      if (!codeSrc) {
        if (cur.releaseHost) { body.innerHTML = 'This is the release source — nothing to pull here.'; return; }
        body.innerHTML = '<b>This box was never told where to get things from</b>. Set an update source below; until then it cannot check for or pull a newer build.'
          + '<button class="btn-clay" id="doUpdate" title="Install the newer relay version now" disabled aria-disabled="true" style="margin-top:8px;display:block;opacity:.55;cursor:not-allowed">Update now</button>';
        return;
      }
      // The relay checks its code source server-side (cur.latest) — the browser can't be relied on to reach
      // the release host's ts.net funnel. If the server couldn't reach it either, cur.latest is null.
      const latest = cur.latest;
      if (!latest || !latest.version) { body.innerHTML = from + 'Couldn’t reach the code source (' + esc(codeSrc) + ') to check. You can still force an update with the button below.'
        + '<button class="btn-clay" id="doUpdate" title="Install the newer relay version now" style="margin-top:8px;display:block">Update now</button>'; document.getElementById('doUpdate').onclick = doUpdate; return; }
      if (latest.version === cur.version) { body.innerHTML = from + '<span style="color:var(--sage)">✓ Up to date.</span>'; return; }
      body.innerHTML = from + 'A new build is available (' + esc((latest.tag ? latest.tag + ' · ' : '') + (latest.versionShort || '') + (latest.builtAt ? ' · ' + latest.builtAt.slice(0, 10) : '')) + '). '
        + '<button class="btn-clay" id="doUpdate" title="Install the newer relay version now" style="margin-top:8px">Update now</button>';
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

  // ── ONE "Updates" card, two halves (Settings C, 2026-11-12) ─────────────────────────────────────────────
  // #updateCard (relay software) and #installerCard (the phone app installer) used to be two cards; they are now
  // the halves of #updatesCard. Their own loaders still decide each half's display on every return path, so the
  // outer card simply follows: shown while either half is. An observer rather than a call in each loader, so a
  // future early return cannot forget it.
  function updatesCardShown(a, b) {
    return [a, b].some(e => !!e && e.style.display !== 'none');
  }
  function syncUpdatesCard() {
    const box = document.getElementById('updatesCard'); if (!box) return;
    box.style.display = updatesCardShown(document.getElementById('updateCard'), document.getElementById('installerCard')) ? 'block' : 'none';
  }
  if (typeof MutationObserver === 'function') {
    const mo = new MutationObserver(syncUpdatesCard);
    for (const id of ['updateCard', 'installerCard']) { const e = document.getElementById(id); if (e) mo.observe(e, { attributes: true, attributeFilter: ['style'] }); }
  }

  // ── the installer this box hands out ─────────────────────────────────────────────────────────────────
  // WHY THIS READS AN ENDPOINT INSTEAD OF /apk-latest.json, WHICH IS WHAT IT USED TO DO.
  // The old line fetched THIS RELAY'S OWN apk-latest.json and printed "latest: 0.9.71 (206)". That file
  // describes the build the relay's CODE was released alongside; it says nothing whatever about the APK
  // sitting in relay/apks/, which is the file members actually download. The two drift apart by design —
  // relay-update.sh unpacks with --exclude='relay/*' — so the panel confidently printed a version number
  // for a file it had not looked at. Measured on a8 on 2026-09-09: the box handed out 206 while 207 had
  // been built the day before, and this line was the only thing on screen claiming to know.
  // /relay-app/apk-status reads the bytes on disk and compares them with what the update source would
  // actually serve.
  async function loadApkStatus() {
    const box = document.getElementById('apkHeld');
    const card = document.getElementById('installerCard');
    if (!box) return;
    let s = null;
    try {
      const r = await adminFetch('/relay-app/apk-status');
      if (r.status === 401) { if (card) card.style.display = 'none'; return; }
      if (!r.ok) throw new Error('the relay could not answer (' + r.status + ')');
      s = await r.json();
    } catch (e) {
      if (card) card.style.display = 'block';
      box.textContent = 'Couldn’t check the installer — ' + (e.message || 'no answer from the relay');
      return;
    }
    if (card) card.style.display = 'block';
    const rows = (s.files || []).map((f) => {
      const held = !f.present ? 'nothing yet'
        : (f.versionName ? esc(f.versionName) + (f.versionCode ? ' (build ' + esc(f.versionCode) + ')' : '')
                         : 'a copy with no version recorded');
      const age = f.present ? (f.ageDays === 0 ? ', added today' : f.ageDays === 1 ? ', added yesterday' : ', added ' + esc(f.ageDays) + ' days ago') : '';
      return '<div class="apk-row"><b>' + esc(f.title || f.name) + '</b> — this box hands out ' + held + age + '. ' + esc(f.say || '') + '</div>';
    }).join('');
    // THE HEADLINE IS THE POINT OF THE WHOLE CARD. An operator must not have to read three rows of version
    // numbers to find out that the thing they are handing to their congregation is out of date.
    //
    // AND THE PRECONDITION COMES FIRST. With no update source the old headline still said "Press 'Update the
    // installer now'", the button was live, and pressing it printed "✗ this relay has no origin to fetch
    // from" underneath — the owner's screenshot of 2026-09-19. The button is disabled with the reason until
    // a source exists; the reason names where to set it.
    const noSource = !s.origin;
    const head = noSource
      ? '<div class="apk-note warn">This box was never told where to get things from, so it cannot fetch an installer. Set an update source below.' + (s.holding ? ' Members can still install the copy it already holds.' : '') + '</div>'
      : s.behind
        ? '<div class="apk-note warn">This box is handing out an installer that is behind. Press “Update the installer now”.</div>'
        : s.holding
          ? '<div class="apk-note ok">Members can install from this box.</div>'
          : '<div class="apk-note warn">This box holds no installer yet, so there is nothing for members to install. Press “Update the installer now”.</div>';
    box.innerHTML = head + rows;
    const fetchBtn = document.getElementById('fetchApk');
    if (fetchBtn) { fetchBtn.disabled = noSource; fetchBtn.title = noSource ? 'Set an update source first' : ''; }
    const keep = document.getElementById('keepApkCurrent'); if (keep) keep.checked = s.keepCurrent === true;
    const open = document.getElementById('openInstall'); if (open && s.shareUrl) open.href = s.shareUrl;
    // "GIVE PEOPLE THIS" ONLY WHEN THERE IS SOMETHING PEOPLE CAN USE. The box answers with the address the
    // ASKER used, and this panel asks from 127.0.0.1 — so on a Suite box that is not yet public the card
    // printed http://127.0.0.1:8787/install under "share the address" and a QR encoding the same (owner's
    // screenshot, 2026-09-19). That address resolves, on a member's phone, to the member's phone. Same rule
    // as the console's installPageUrl(): loopback is refused; a private (LAN) address works on the church's
    // own wifi and is carried and LABELLED; anything else is printed as it is. The gateway now folds this
    // box's own tunnel into shareUrl, so once "Make it public" has been pressed the address here follows.
    const share = String(s.shareUrl || '');
    let host = '';
    try { host = new URL(share).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch (e) { host = ''; }
    const LOOP = /^(localhost|::1|0\.0\.0\.0|127\.)/, LAN = /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/;
    const kind = !share ? 'none' : LOOP.test(host) ? 'local' : LAN.test(host) ? 'lan' : 'public';
    const url = document.getElementById('installUrl');
    const h2 = document.getElementById('installShareH'), p2 = document.getElementById('installShareP'), qr = document.getElementById('installQr');
    if (url) { url.textContent = kind === 'local' || kind === 'none' ? '' : share; url.style.display = kind === 'local' || kind === 'none' ? 'none' : ''; }
    if (qr) qr.style.display = kind === 'local' || kind === 'none' ? 'none' : 'block';
    if (h2) h2.textContent = kind === 'local' ? 'Not shareable yet' : kind === 'none' ? 'No address yet' : 'Give people this';
    if (p2) p2.textContent = kind === 'local'
      ? 'This works only on this computer — press “Make it public” in Reach members from anywhere, above, to get an address you can share.'
      : kind === 'lan'
        ? 'This works on your own wifi only. Point a phone camera at the code, or share the address — for one that works anywhere, press “Make it public” above.'
        : kind === 'none'
          ? 'The relay did not say where it can be reached.'
          : 'Point a phone camera at the code, or share the address. It opens the install page — no password, nothing to sign into.';
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
    // NEVER RENDER THE WRITE'S OWN ECHO. Re-read what is on disk, so the card reports the file that landed
    // rather than the request we made — including a fetch that half worked.
    loadApkStatus();
  });
  // Saving the update source re-reads BOTH cards that depend on it, so "✓ saved" and a still-disabled
  // button can never sit on the same screen.
  document.getElementById('originSave')?.addEventListener('click', async () => {
    const inp = document.getElementById('originIn'), m = document.getElementById('originMsg');
    if (!inp || !m) return;
    m.style.color = 'var(--ink-3)'; m.textContent = 'saving…';
    try {
      const r = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ origin: (inp.value || '').trim() }) });
      const s = await r.json();
      if (!r.ok) { m.style.color = 'var(--clay-ink)'; m.textContent = '✗ ' + (s.error || 'could not save the update source'); return; }
      inp.value = s.origin || '';   // what the box now holds, not the echo of what was typed
      m.style.color = 'var(--sage-ink)';
      m.textContent = s.origin ? '✓ saved — in use now, no restart needed' : '✓ cleared — this box has no update source';
    } catch (e) { m.style.color = 'var(--clay-ink)'; m.textContent = '✗ ' + e.message; return; }
    loadUpdate(); loadApkStatus();
  });
  document.getElementById('originIn')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('originSave').click(); });
  document.getElementById('keepApkCurrent')?.addEventListener('change', async (e) => {
    const on = e.target.checked, m = document.getElementById('apkMsg');
    m.style.color = 'var(--ink-3)'; m.textContent = 'saving…';
    try {
      const r = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ keepApkCurrent: on }) });
      if (!r.ok) throw new Error('save failed');
      m.style.color = 'var(--sage-ink)';
      m.textContent = on ? '✓ this box will fetch a new installer on its own' : '✓ off — update the installer by hand when it suits you';
      setTimeout(() => { m.textContent = ''; }, 4000);
      if (on) setTimeout(loadApkStatus, 2500);   // it starts fetching immediately; show the result
    } catch (err) { e.target.checked = !on; m.style.color = 'var(--clay-ink)'; m.textContent = '✗ ' + (err.message || 'failed'); }
  });
  document.getElementById('keepRelayCurrent')?.addEventListener('change', async (e) => {
    const on = e.target.checked, m = document.getElementById('updateMsg');
    m.style.color = 'var(--ink-3)'; m.textContent = '· saving…';
    try {
      const r = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ keepRelayCurrent: on }) });
      if (!r.ok) throw new Error('save failed');
      m.style.color = 'var(--sage-ink)';
      m.textContent = on ? '· ✓ auto-update on — checks hourly' : '· ✓ off — update by hand with the button above';
      setTimeout(() => { m.textContent = ''; }, 4000);
    } catch (err) { e.target.checked = !on; m.style.color = 'var(--clay-ink)'; m.textContent = '· ✗ ' + (err.message || 'failed'); }
  });
  // Re-ask on a timer, because an installer goes stale exactly while nobody is looking at the panel.
  // The FIRST read is deliberately not here: it belongs after the admin token has been settled (the
  // /local-token block below, and the unlock handler). A bare call at this point races that block, gets a
  // 401, hides the card — and if it lands after the authenticated read, the card an operator needs stays
  // hidden with nothing on screen to say why.
  setInterval(() => { if (!document.hidden) loadApkStatus(); }, 300000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadApkStatus(); });
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
    adminToken = t; sessionStorage.setItem(TOKEN_KEY, adminToken);
    if (gm) gm.textContent = '';
    loadConfig(); gpTick(); loadRelayName(); maybeFirstRun(); loadApkStatus();
  };
  document.getElementById('tok').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('tokGo').click(); });
  // When this panel is opened ON the relay machine (e.g. the TrinityOne Suite's own window), the relay hands
  // us its admin token automatically — no hunting in logs. /local-token only answers genuine same-machine
  // requests, so this is a no-op when the dashboard is opened remotely over a tunnel.
  (async () => {
    if (!adminToken) {
      try { const r = await fetch('/local-token', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (j && j.token) { adminToken = j.token; sessionStorage.setItem(TOKEN_KEY, adminToken); } } } catch (e) {}
    }
    // YIELD ONCE, ALWAYS. With the token already stored this ran synchronously — before the wizard's own
    // `let rswOpen` / `const RSW_SEEN` (further down this file) existed — so maybeFirstRun() threw a
    // ReferenceError that this async function turned into a silent rejection, and loadApkStatus() below
    // never ran. The /local-token await above hid it: the wizard opened on the FIRST visit to this page in a
    // webview and never on a second visit with the wizard still unseen. Measured 2026-09-22 (scripts/
    // the-suite-first-run-is-one-guided-path.test.mjs, "a second visit"). One microtask puts every call
    // below after the whole script has run, on both paths.
    await undefined;
    loadConfig();
    loadRelayName();
    maybeFirstRun();
    loadApkStatus();
  })();

  // ── "Go public" wizard: bring the node onto Tailscale + turn on Funnel (public HTTPS/WSS) ──
  let tsBusy = false;       // pause polling while an action is mid-flight (so it can't clobber the view)
  let cfHold = false;       // freeze the 4s refresh while a Go-public attempt runs OR its error+log is on screen
  let lastAuthUrl = '';     // the login link from `tailscale up`, until the node reports connected
  // kept as a thin alias: several call sites and window.gpCopy already refer to it. All copying now goes
  // through copyWithFeedback, so a failure is visible instead of silent.
  const gpCopy = (t, b) => { copyWithFeedback(t, b); };
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
        '<div class="wz-actions"><button class="btn btn-ghost" id="gpRefreshOp" title="Check again whether your relay can be reached">Refresh</button></div>');
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
        '<div class="wz-actions"><button class="btn btn-clay" id="gpFunnel" title="Give your relay a secure public web address">Make it public (HTTPS)</button> <span class="wz-meta" id="gpMsg"></span></div>');
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
      '<div class="hint" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line-2)">Prefer a stable address on your own Tailscale? <button class="btn btn-ghost btn-sm" id="gpUp" title="Use your own Tailscale account for a steadier address">Use Tailscale instead</button> <span class="wz-meta" id="gpMsg"></span></div>';
    wireCfGo();
    document.getElementById('gpUp').onclick = doUp;
  }

  // The installer card's "Give people this" address follows the tunnel (loadApkStatus), and that card
  // re-reads itself every five minutes. Pressing "Make it public" must not leave "Not shareable yet" on
  // screen for five minutes beside a card that says "On · public", so a change of public state re-reads
  // it at once. `null` until the first tick has answered, so the first read is not counted as a change.
  let _gpWasPublic = null;
  function gpNotePublic(pubNow) {
    if (_gpWasPublic === null) { _gpWasPublic = pubNow; return; }
    if (pubNow !== _gpWasPublic) { _gpWasPublic = pubNow; loadApkStatus(); }
  }
  // The prominent keep-awake / stay-on callout only matters once the box is actually public, so show it then.
  function setSleepWarn(pub) { const w = document.getElementById('gpSleepWarn'); if (w) w.style.display = pub ? 'block' : 'none'; }
  async function gpTick() {
    if (tsBusy || cfHold) return;
    try {
      // Cloudflare quick tunnel is the no-account default — if it's up, show that and skip the Tailscale flow.
      let cf = null; try { cf = await (await fetch('/tunnel/state', { headers: authHeaders(), cache: 'no-store' })).json(); } catch (e) {}
      const _sp = stayPublicChecked(cf), _spEl = document.getElementById('t-stay');
      if (_spEl && _sp !== null) _spEl.checked = _sp;   // the switch mirrors the real tunnel state (skipped while cfHold freezes us)
      if (cf && cf.running && cf.url) { if (_spEl) _spEl.disabled = false; renderCfPublic(cf); gpNotePublic(true); setSleepWarn(true); return; }
      const r = await fetch('/tailscale/state', { headers: authHeaders(), cache:'no-store' });
      if (r.status === 401) { renderGoPublic({ locked:true }); return; }
      const s = await r.json();
      if (s.loggedIn) lastAuthUrl = '';
      renderGoPublic(s);
      const _pub = !!(s.funnelOn && s.publicUrl);
      gpNotePublic(_pub); setSleepWarn(_pub);
      // Tailscale funnel is the public path here → this cloudflared switch doesn't govern it; disable + say so.
      if (_spEl) { const _dis = stayPublicDisabled(cf, s); _spEl.disabled = _dis; const _sm = document.getElementById('stayMsg'); if (_sm) _sm.textContent = _dis ? '· public via Tailscale — managed there' : ''; }
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

  // "Stay public" switch: a thin DOM wrapper around stayPublicRequest(). cfHold freezes the 4s refresh (so it can't
  // flip the switch back mid-request) and is released on every path.
  function wireStayPublic() {
    const t = document.getElementById('t-stay'); if (!t || t._wired) return; t._wired = true;
    t.onchange = async () => {
      const on = t.checked, msg = document.getElementById('stayMsg');
      cfHold = true; t.disabled = true;
      if (msg) { msg.style.color = 'var(--ink-3)'; msg.textContent = on ? '· opening… (up to 30s)' : '· closing…'; }
      const res = await stayPublicRequest(on, authHeaders(), (u, o) => fetch(u, o));
      t.disabled = false; cfHold = false;
      if (!res.ok) { t.checked = !on; if (msg) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + res.error; } return; }
      if (msg) msg.textContent = '';
      gpTick();
      if (on) { setTimeout(() => { loadRelayName(); }, 900); verifyReservationRegistered(); }
    };
  }
  wireStayPublic();
  // "Keep this computer awake" switch + "Open sleep settings" button (public card). Instant-apply like the
  // other access toggles. The switch POSTs keepAwakeBody() to /settings; the button asks the gateway to open
  // this OS's power settings (no url from the client) and, if that OS can't be deep-linked, shows a text hint.
  function wireKeepAwake() {
    const t = document.getElementById('t-keepawake');
    if (t && !t._wired) { t._wired = true;
      t.onchange = async () => {
        const on = t.checked, msg = document.getElementById('keepAwakeMsg');
        if (msg) { msg.style.color = 'var(--ink-3)'; msg.textContent = '· saving…'; }
        try {
          const r = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(keepAwakeBody(on)) });
          if (!r.ok) throw new Error('save failed');
          if (msg) { msg.style.color = 'var(--sage-ink)'; msg.textContent = on ? '· ✓ staying awake while public' : '· ✓ allowed to sleep'; setTimeout(() => { msg.textContent = ''; }, 3000); }
        } catch (err) { t.checked = !on; if (msg) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '· ✗ ' + (err.message || 'failed'); } }
      };
    }
    wireOpenSleepButton(document, (...a) => fetch(...a), authHeaders);
  }
  // Wire the "Open sleep settings" button. On a failed/unsupported open we show a text hint beside the button,
  // but we NEVER hide the button — hiding it was the bug that made a second press impossible (Linux returns
  // {ok:false,unsupported:true} on a box whose desktop has no settings binary, which fired the old hide every
  // single time, so the button vanished and could not be retried). Deps (document/fetch/authHeaders) are
  // injected so the exact behaviour runs headless in scripts/open-sleep-button.test.mjs with a fake DOM.
  // OPEN-SLEEP-BTN-BEGIN — lifted & run by scripts/open-sleep-button.test.mjs (CLAUDE.md rule 1/3)
  function wireOpenSleepButton(doc, fetchFn, authFn) {
    const b = doc.getElementById('openSleepBtn');
    if (!b || b._wired) return;
    b._wired = true;
    const react = (ok) => {
      const h = doc.getElementById('sleepHint');
      if (h) {
        h.style.display = ok ? 'none' : 'inline';
        h.textContent = ok ? '' : 'Couldn’t open it automatically — open your system power settings to stop this computer sleeping.';
      }
      // The button is intentionally left visible either way, so the operator can press it again.
    };
    b.onclick = async () => {
      try {
        const r = await fetchFn('/open-sleep-settings', { method: 'POST', headers: authFn() });
        let j = {}; try { j = await r.json(); } catch (e) {}
        react(!!(r.ok && j.ok));
      } catch (e) { react(false); }
    };
  }
  // OPEN-SLEEP-BTN-END
  wireKeepAwake();
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
    // Keep the lock flag in step with the UI. loadConfig()'s setLocked(false) and a /stats 200 both unlock
    // through here; if statsLocked were only ever written by noteStatsStatus() it would desync after a
    // setLocked(false) and then swallow the next real /stats 401 (want === statsLocked, so it returns early).
    statsLocked = locked;
    const el = document.getElementById('dashLocked');
    if (el) el.style.display = locked ? 'block' : 'none';
    for (const id of STAT_CARDS) { const c = document.getElementById(id); if (c) c.style.display = locked ? 'none' : 'block'; }
    if (locked) for (const id of ['s-today', 's-media', 's-churches', 's-members', 's-events', 's-conns', 's-traffic']) { const t = document.getElementById(id); if (t) t.textContent = '—'; }
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

  function renderDisk(d) {
    const row = document.getElementById('diskRow'); if (!row || !d) return;
    const total = Number(d.totalBytes) || 0, free = Number(d.freeBytes) || 0;
    if (!total) return;
    const used = total - free, pct = (used / total) * 100, left = free;
    row.style.display = 'block';
    const text = document.getElementById('diskText'), fill = document.getElementById('diskFill'), note = document.getElementById('diskNote');
    if (text) text.textContent = fmtStore(used) + ' of ' + fmtStore(total);
    if (fill) {
      fill.style.width = (used > 0 ? Math.max(2, Math.min(100, Math.round(pct))) : 0) + '%';
      fill.className = 'bar-fill' + (pct >= 90 ? ' meter--crit' : pct >= 75 ? ' meter--warn' : '');
    }
    if (note) {
      note.className = 'meter-note' + (pct >= 90 ? ' meter--crit' : pct >= 75 ? ' meter--warn' : '');
      note.textContent = pct >= 95 ? 'Disk nearly full — ' + fmtStore(left) + ' left. Free space or the relay will stop accepting data.'
        : pct >= 75 ? fmtStore(left) + ' free on this drive.'
        : Math.round(pct) + '% used · ' + fmtStore(left) + ' free.';
    }
  }

  async function loadStats() {
    try {
      const r = await adminFetch('/stats?days=10');
      noteStatsStatus(r.status);
      if (r.status === 401) return;
      const s = await r.json();
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
      const tf = s.traffic; const tEl = document.getElementById('s-traffic');
      if (tf && tEl) tEl.textContent = fmtBytes((tf.bytesIn || 0) + (tf.bytesOut || 0)) || '0 B';
    } catch (e) { /* relay down — the hero already says so */ }
  }
  // the activity window moves slowly; a minute is plenty and keeps "Sent today" honest without polling
  // the aggregates as hard as /status.
  setInterval(loadStats, 60000);

  // ── First-run setup wizard ──────────────────────────────────────────────────
  // A fresh relay otherwise drops the operator straight onto the dashboard with the
  // setup scattered across Settings cards. This walks a brand-new relay through the
  // two things it actually needs — a name and its first church — BEFORE the console,
  // then points at the tunnel as the next step. Shown only when the relay genuinely looks
  // new (no name claimed AND no church added), so an established relay is never nagged —
  // and dismissed for the visit, not for ever, whenever it is closed with nothing done.
  // ── THE MARKER MEANS "THIS BOX HAS SOMETHING ON IT", NEVER "A WIZARD WAS WALKED" ───────────────
  // AUDIT-suite-B4 N2 and AUDIT-round-c C3. Owner, 2026-09-22: "It should come back until its setup", and
  // on the audit of the first attempt at it: "I agree with your recommendation, it definitely shouldn't
  // count as complete."
  //
  // RSW_SEEN is the marker the LAUNCHER reads to retire its first-run card, and every exit from this wizard
  // used to write it. Measured by the auditor on the real pages: "Just a relay" → Get started → "Skip for
  // now" → "Skip for now" → "Yes, it stays on" → the done step's PRIMARY button retired the card for ever
  // on a box still reporting writePolicy=false and handle="" — five clicks, two of them labelled "Skip for
  // now" by this wizard, ending on the button a first-time person presses.
  //
  // SO THE STATE OF THE BOX DECIDES, NEVER WHICH BUTTON WAS PRESSED. This file now has exactly ONE writer of
  // RSW_SEEN — maybeFirstRun() below — and it writes it only when the box's own answers say something is
  // here: a relay name (/relay-names/mine.handle) or a church (/config.churches, the same set
  // /status.writePolicy reports to the launcher). Closing this wizard writes RSW_SKIPPED instead — a
  // per-visit dismissal in sessionStorage, which a relaunch of the Suite clears — so reloading this
  // dashboard in the same sitting is not a nag, the next launch asks again, and nothing this wizard does can
  // claim a setup that did not happen.
  const RSW_SEEN = 'to_relay_setup_seen';
  const RSW_SKIPPED = 'to_relay_setup_skipped';
  let rswOpen = false, rswStep = 0, rswHandle = '', rswAdded = false;
  // Does this box already carry a church? Set from the same /config read that decides whether the wizard
  // opens at all, so the church step can tell "a brand-new box" from "adding a second church".
  let rswHasChurches = false;
  let rswManual = false;        // the steward asked for the paste field on a fresh box (a church made elsewhere)
  // ── THE GUIDED PATH the launcher sent this person down (owner, 2026-09-22): `?setup=everything` means the
  // relay wizard is the first half and the CONSOLE's wizard is the second, so the done step's primary is the
  // console and "Back to the Suite" is how the church is skipped; `?setup=relay` means the relay is the whole
  // job, so the primary is "Back to the Suite" (the launcher — its two doors are the lesson, and once this
  // wizard has closed it shows them). No `?setup=` — the person came through the "Manage a relay" door — and
  // the done step is what it was. Skipping the wizard on a guided path also lands on the launcher: skipping
  // is always allowed, and the path still ends where the owner said it ends. Read once; a real reload keeps it.
  const RSW_PATH = (() => { try { const p = new URLSearchParams(location.search).get('setup'); return p === 'everything' || p === 'relay' ? p : ''; } catch (e) { return ''; } })();
  const RSW_HOME = '/relay-app/home.html';
  const RSW_IC = {
    wave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0 1 16 0"/><path d="M2 20h20"/><circle cx="12" cy="8" r="1.4" fill="currentColor" stroke="none"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v5.6a2 2 0 0 0 .6 1.4l7 7a2 2 0 0 0 2.8 0l5.6-5.6a2 2 0 0 0 0-2.8l-7-7A2 2 0 0 0 12.6 5H7a4 4 0 0 0-4 4Z"/><circle cx="8" cy="10" r="1.3" fill="currentColor" stroke="none"/></svg>',
    church: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6M9 5h6"/><path d="M12 8 5 12v9h14v-9L12 8Z"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 6.5"/></svg>',
  };

  function rswSkippedThisVisit() { try { return !!sessionStorage.getItem(RSW_SKIPPED); } catch (e) { return false; } }

  async function maybeFirstRun() {
    if (rswOpen || !adminToken || localStorage.getItem(RSW_SEEN)) return;
    // A skip earlier in this visit keeps it shut — EXCEPT when the person arrived on a guided path
    // (`?setup=`), which is them asking for this wizard again from the launcher's card. A card whose choices
    // do nothing is worse than no card.
    if (!RSW_PATH && rswSkippedThisVisit()) return;
    let nm = null, cf = null;
    try {
      [nm, cf] = await Promise.all([
        adminFetch('/relay-names/mine').then(r => r.ok ? r.json() : null).catch(() => null),
        adminFetch('/config?stats=1').then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
    } catch (e) { return; }
    if (!nm || !cf) return;                                   // couldn't read (401 / relay down) — don't guess
    rswHasChurches = (cf.churches || []).length > 0;
    const fresh = !nm.handle && !rswHasChurches;
    if (fresh) openRelaySetup();
    // THE ONLY WRITER OF RSW_SEEN IN THIS FILE, and it writes it from the two answers just read off the box:
    // a name it claimed, or a church it carries. An established relay must never be nagged — and a box that
    // carries nothing must never be called established (RSW_SEEN above).
    else localStorage.setItem(RSW_SEEN, '1');
  }
  window.maybeFirstRun = maybeFirstRun;

  function openRelaySetup() { rswOpen = true; rswStep = 0; rswHandle = ''; rswAdded = false; rswManual = false; document.getElementById('relaySetup').classList.add('show'); renderRSW(); }
  // ── THE WAY OUT OF THE WIZARD — ALL FIVE OF THEM LAND HERE (AUDIT-round-c C3 + C4) ──────────────
  // "Skip setup" on step 0, "Go to dashboard" and the tunnel step on the done step, and the two links out
  // ("Back to the Suite", "Next: open the console"). It dismisses the wizard for THIS VISIT and claims
  // nothing — see RSW_SEEN above for why none of them may say the box is set up.
  //
  // AND IT STRIPS `?setup=` FROM THE ADDRESS BAR. A guided arrival deliberately reopens this wizard on every
  // load — that is how the launcher's card keeps the promise its choices make. Without this strip that also
  // meant a person who closed the wizard and then reloaded the panel, or pressed Back to it, got it straight
  // back: the auditor measured the card → wizard → skip → card loop three rounds running, with the only
  // non-looping exit being the dishonest one above. Stripping it leaves them on the dashboard they asked
  // for, while the card's own door still reopens the wizard — that is a fresh navigation, carrying
  // `?setup=` again.
  function closeRSW() {
    try { sessionStorage.setItem(RSW_SKIPPED, '1'); } catch (e) {}
    rswOpen = false;
    document.getElementById('relaySetup').classList.remove('show');
    try {
      if (RSW_PATH && window.history && history.replaceState) {
        const u = new URL(location.href);
        u.searchParams.delete('setup');
        history.replaceState(null, '', u.pathname + u.search + u.hash);
      }
    } catch (e) {}
  }
  // ── THE CHURCH STEP, AS TWO PURE FUNCTIONS SO THEY CAN BE RUN IN A TEST ─────────────────────────────
  // relay-app/*.js ships unbundled exactly like app/*.jsx, so a test that MATCHED this markup would still
  // pass with the whole branch disabled (CLAUDE.md rule 3, same hazard, different directory). Returning a
  // string lets scripts/a-fresh-relay-never-asks-for-an-npub.test.mjs execute the real thing.
  function rswChurchAsksById(hasChurches, manual) { return !!(hasChurches || manual); }
  function rswChurchCard(askById, dots) {
    if (!askById) {
      return dots
        + '<div class="rsw-ic">' + RSW_IC.church + '</div>'
        + '<h2 class="rsw-h">Your church goes on next</h2>'
        + '<p class="rsw-sub">Nothing to copy or paste. Open the Steward console on this computer, create your church and give it a name — it will be added to this relay automatically, and its records will live here.</p>'
        + '<div class="rsw-msg" id="rswNpubMsg"></div>'
        + '<div class="rsw-foot"><button class="btn btn-ghost" id="rswBack" title="Go back one step">Back</button><div style="flex:1"></div><button class="btn btn-ghost" id="rswById" title="Use a church you already created">I already have a church</button><button class="btn btn-clay" id="rswSkip" title="Skip this step; you can do it later from Settings">Continue</button></div>';
    }
    return dots
      + '<div class="rsw-ic">' + RSW_IC.church + '</div>'
      + '<h2 class="rsw-h">Add your church</h2>'
      + '<p class="rsw-sub">Paste your church\u2019s ID (its npub) so it\u2019s allowed to publish to and read from this relay. You\u2019ll find it in the steward console. You can add more churches later.</p>'
      + '<div class="rsw-lbl">Church npub</div>'
      + '<input class="rsw-in" id="rswNpub" placeholder="npub1\u2026" autocomplete="off" spellcheck="false" />'
      + '<div class="rsw-msg" id="rswNpubMsg"></div>'
      + '<div class="rsw-foot"><button class="btn btn-ghost" id="rswBack" title="Go back one step">Back</button><div style="flex:1"></div><button class="btn btn-ghost" id="rswSkip" title="Skip this step; you can do it later from Settings">Skip for now</button><button class="btn btn-clay" id="rswAdd">Add &amp; continue</button></div>';
  }
  function rswDots() { let s = ''; for (let i = 0; i < 5; i++) s += '<span class="' + (i <= rswStep ? 'on' : '') + '"></span>'; return '<div class="rsw-dots">' + s + '</div>'; }

  function renderRSW() {
    const card = document.getElementById('rswCard');
    if (rswStep === 0) {
      card.innerHTML = rswDots()
        + '<div class="rsw-ic">' + RSW_IC.wave + '</div>'
        + '<h2 class="rsw-h">Welcome — let’s set up your relay</h2>'
        // ⚠ NOT "give it a name, and add your church". A fresh box's church is created in the console, not here —
        // this wizard's church step only says so. Promising an "add your church" step that the wizard cannot
        // deliver is how the owner's first run (2026-09-22) ended with no church and no idea why.
        + '<p class="rsw-sub">A relay is the private server that stores your church’s messages, records and media — running right here, on this machine. Two quick things: give it a name, and say whether this computer stays on. Your church is created in the console afterwards. About a minute.</p>'
        + '<div class="rsw-foot"><button class="btn btn-ghost" id="rswSkip" title="Skip this step; you can do it later from Settings">Skip setup</button><div style="flex:1"></div><button class="btn btn-clay" id="rswGo" title="Begin setting up your relay">Get started</button></div>';
      document.getElementById('rswGo').onclick = () => { rswStep = 1; renderRSW(); };
      // It used to send a guided path back to the launcher, which is where the person had just come from —
      // so the launcher showed its card again (nothing was set up) and the only way past the wizard was to
      // walk it and press a button that lied (AUDIT-round-c C4). "Skip setup" now means what it says: the
      // wizard closes onto the dashboard behind it and stays closed for this visit. The way back to the
      // launcher is the panel's own "← Back", which is on screen the moment the overlay goes.
      document.getElementById('rswSkip').onclick = () => closeRSW();
      return;
    }
    if (rswStep === 1) {
      card.innerHTML = rswDots()
        + '<div class="rsw-ic">' + RSW_IC.tag + '</div>'
        + '<h2 class="rsw-h">Name your relay</h2>'
        + '<p class="rsw-sub">Pick a short, memorable name. Stewards type it in their console to connect their church — and it keeps pointing here even when the tunnel address changes on restart.</p>'
        + '<div class="rsw-lbl">Relay name</div>'
        + '<input class="rsw-in" id="rswName" placeholder="e.g. grace-city" autocomplete="off" spellcheck="false" />'
        + '<div class="rsw-msg" id="rswNameMsg"></div>'
        + '<div class="rsw-note">Letters, numbers and hyphens. Others can type this to connect once public access is on — that’s the last step, on the dashboard.</div>'
        + '<div class="rsw-foot"><button class="btn btn-ghost" id="rswBack" title="Go back one step">Back</button><div style="flex:1"></div><button class="btn btn-ghost" id="rswSkip" title="Skip this step; you can do it later from Settings">Skip for now</button><button class="btn btn-clay" id="rswClaim">Claim &amp; continue</button></div>';
      const inp = document.getElementById('rswName');
      if (rswHandle) inp.value = rswHandle;
      inp.focus();
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('rswClaim').click(); });
      document.getElementById('rswBack').onclick = () => { rswStep = 0; renderRSW(); };
      document.getElementById('rswSkip').onclick = () => { rswStep = 2; renderRSW(); };
      document.getElementById('rswClaim').onclick = async () => {
        const handle = (inp.value || '').trim().toLowerCase();
        const msg = document.getElementById('rswNameMsg');
        if (!handle) { msg.style.color = 'var(--clay-ink)'; msg.textContent = 'Type a name first, or skip.'; inp.focus(); return; }
        msg.style.color = 'var(--ink-3)'; msg.textContent = 'Claiming…';
        try {
          const r = await fetch('/relay-names/mine', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ handle }) });
          const j = await r.json();
          if (!r.ok) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '✗ ' + (j.error || 'that name didn’t work — try another'); return; }
          rswHandle = j.handle || handle;
          // j.reserved: the box is not public yet, so the name is held on this computer and goes live when
          // public access is turned on (the last step). A live claim (already public) has no `reserved` flag
          // and advances straight away, as before. The 409 "already taken" lands on the !r.ok path above.
          if (j.reserved) { msg.style.color = 'var(--sage-ink)'; msg.textContent = '✓ reserved — goes live when you turn on public access'; setTimeout(() => { rswStep = 2; renderRSW(); }, 1000); }
          else { rswStep = 2; renderRSW(); }
        } catch (e) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '✗ ' + (e.message || 'couldn’t reach the relay'); }
      };
      return;
    }
    if (rswStep === 2) {
      // ⚠ A FRESH BOX IS NEVER ASKED FOR AN NPUB, AND THE OLD STEP COULD NOT BE ANSWERED.
      // It read: "Paste your church's ID (its npub)… You'll find it in the steward console." On a brand-new
      // box there IS no church yet, so there is nothing in the console to find — and this wizard's own gate
      // (no relay handle AND no churches) fires it for precisely those people. Owner, 2026-09-12: "I really
      // want to make sure the 'adding a church' isn't something that a steward has to do manually."
      // Naming a church in a console served BY this box registers it here on its own — `selfRegister(name,
      // {createHere:true})` from the setup wizard's name step, the owner's 2026-09-04 decision. So the
      // honest thing to show a fresh box is what is about to happen, not a field it cannot fill.
      // ⚠ THIS COMMENT USED TO CREDIT `_registerOnOwnBox` (2cb1582). That function was a duplicate of the
      // above and was reverted the same day; relay-app/*.js ships UNBUNDLED, so a stale name here would be
      // a false claim in shipped source.
      // ⚠ AND THE PASTE FIELD BELOW IS NOT DEAD CODE. A church RESTORED from its twelve words skips the
      // setup wizard entirely (steward-root.jsx `adopt` sets wizard.done), so `createHere` never runs for
      // it — the by-ID route is that church's only way onto this box. Reachable via `rswManual`.
      // ⚠ THE FIELD IS NOT DELETED. A church created somewhere else — restored from its words, or run from
      // another machine — still has to be added by ID, and so does a SECOND church. That is `rswManual`,
      // and it is the default whenever the box already carries a church.
      const askById = rswChurchAsksById(rswHasChurches, rswManual);
      card.innerHTML = rswChurchCard(askById, rswDots());
      if (!askById) {
        document.getElementById('rswBack').onclick = () => { rswStep = 1; renderRSW(); };
        document.getElementById('rswById').onclick = () => { rswManual = true; renderRSW(); };
        document.getElementById('rswSkip').onclick = () => { rswStep = 3; renderRSW(); };
        return;
      }
      // Back out of the by-ID detour returns to the automatic card, not to the relay-name step — otherwise
      // a steward who tapped "I already have a church" by mistake is thrown two screens backwards.
      const backToAuto = rswManual && !rswHasChurches;
      const inp = document.getElementById('rswNpub');
      inp.focus();
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('rswAdd').click(); });
      document.getElementById('rswBack').onclick = () => { if (backToAuto) { rswManual = false; } else { rswStep = 1; } renderRSW(); };
      document.getElementById('rswSkip').onclick = () => { rswStep = 3; renderRSW(); };
      document.getElementById('rswAdd').onclick = async () => {
        const npub = (inp.value || '').trim();
        const msg = document.getElementById('rswNpubMsg');
        if (!npub) { msg.style.color = 'var(--clay-ink)'; msg.textContent = 'Paste the church’s npub first, or skip.'; inp.focus(); return; }
        msg.style.color = 'var(--ink-3)'; msg.textContent = 'Adding…';
        try {
          const r = await fetch('/config', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ addChurch: { npub, name: '' } }) });
          const j = await r.json();
          if (!r.ok) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '✗ ' + (j.error || 'that didn’t look like a valid npub'); return; }
          rswAdded = true; if (typeof loadConfig === 'function') loadConfig(); rswStep = 3; renderRSW();
        } catch (e) { msg.style.color = 'var(--clay-ink)'; msg.textContent = '✗ ' + (e.message || 'couldn’t reach the relay'); }
      };
      return;
    }
    // ── STEP 3 — CAN THIS COMPUTER STAY ON? ──────────────────────────────────────────────────────────
    // Owner, 2026-09-04: "being asked if it's an 'always on' machine is already part of that setup
    // process" — it was not, and this is it. And 2026-09-12, on what the answer must DO: "if the can't
    // leave it on, their relay mustn't be the primary one, their church should default to a public relay."
    //
    // ⚠ IT IS ASKED HERE, IN THE RELAY'S OWN SETUP, AND NOT AT CHURCH CREATION. Owner, same day, ruling out
    // my first proposal: "the church naming isn't part of the relay setup, so to me it feels an odd place
    // to put it." Whether a computer can stay on is a fact about the MACHINE — true for every church on it,
    // and true for someone running a relay for a church managed elsewhere, whom a church-creation prompt
    // would miss entirely. Asked once per machine, in the machine's own flow.
    //
    // ⚠ IT IS NOT A YES/NO QUIZ ABOUT HABITS. Both answers are a real choice with its cost on screen, so a
    // steward is choosing a HOME for their church rather than predicting their own behaviour.
    //
    // WHAT IT WRITES, AND WHAT STILL HAS TO READ IT: `to_relay_always_on` = '1' | '0'. Chunk 4 of
    // reference/SCOPE-SUITE-AUTOREGISTER-2026-09-12.md is what must act on a '0' — keeping this box off
    // primary and leaving the church on the public relays. UNTIL CHUNK 4 LANDS THIS ANSWER CHANGES
    // NOTHING, which is why the copy promises nothing it cannot yet keep.
    // ⚠ localStorage is per-origin, which on a Suite box is shared with the console — deliberate, that is
    // how chunk 4 will read it. But it is also per-browser-profile and clearable. If chunk 4 needs it to be
    // durable, move it to a relay setting via /config rather than trusting this.
    if (rswStep === 3) {
      card.innerHTML = rswDots()
        + '<div class="rsw-ic">' + RSW_IC.globe + '</div>'
        + '<h2 class="rsw-h">Can you leave this computer on?</h2>'
        + '<div class="sleepwarn"><b>Your church is only reachable while this computer is awake.</b> A machine that sleeps at night, or a laptop you close, means members can\u2019t open your church until it wakes.</div>'
        // ⚠ RECORD-ONLY, AND IT SAYS SO, because today the answer changes nothing. Its only consumer was
        // `_registerOnOwnBox`, reverted 2026-09-12 — and an audit had already shown that guard was inert
        // anyway (written at 127.0.0.1, read at localhost: separate storage partitions). A screen that
        // offers a consequential-sounding "No" and then does nothing has asked a question the app ignores,
        // which is worse than not asking. When chunk 4 gives the answer somewhere to act, delete this line.
        + '<p class="rsw-sub" style="opacity:.8">While you stay public, this computer is kept awake automatically so members can always reach you. You can change that on the Settings page.</p>'
        + '<div class="rsw-msg" id="rswOnMsg"></div>'
        + '<div class="rsw-foot"><button class="btn btn-ghost" id="rswBack" title="Go back one step">Back</button><div style="flex:1"></div><button class="btn btn-ghost" id="rswOnNo" title="Leave this switched off">No \u2014 it gets switched off</button><button class="btn btn-clay" id="rswOnYes">Yes, it stays on</button></div>';
      const answer = (on) => {
        try { localStorage.setItem('to_relay_always_on', on ? '1' : '0'); } catch (e) {}
        rswStep = 4; renderRSW();
      };
      document.getElementById('rswBack').onclick = () => { rswStep = 2; renderRSW(); };
      document.getElementById('rswOnYes').onclick = () => answer(true);
      document.getElementById('rswOnNo').onclick = () => answer(false);
      return;
    }
    // step 4 — done + the next steps (the tunnel lives on Settings; the CHURCH lives in the console)
    // ⚠ THE CONSOLE STEP COMES FIRST WHEN THE BOX HAS NO CHURCH. The owner's first run of the real app
    // (2026-09-22) reached this card, pressed "Go to dashboard", and found a relay with no church and nothing
    // saying the church is created in the console. The dashboard's own next-step card says it too; this is
    // the moment the person is actually reading.
    const needsChurch = !rswHasChurches && !rswAdded;
    // On the launcher's "Set up everything" path the church IS the next step: the primary is the console and
    // the step list does not repeat it. On "Just a relay" (or "everything" on a box that already has one) the
    // primary is the launcher. Without a path: the step list carries the console, the primary is the dashboard.
    const nextIsChurch = RSW_PATH === 'everything' && needsChurch;
    const suiteLink = (cls) => '<a class="btn ' + cls + '" id="rswSuite" href="' + RSW_HOME + '" style="text-decoration:none">Back to the Suite</a>';
    const foot = nextIsChurch
      ? suiteLink('btn-ghost') + '<div style="flex:1"></div><a class="btn btn-clay" id="rswConsole" href="/steward.html" style="text-decoration:none">Next: open the console</a>'
      : RSW_PATH
        ? '<button class="btn btn-ghost" id="rswDone" title="Finish setup and open the dashboard">Go to dashboard</button><div style="flex:1"></div>' + suiteLink('btn-clay')
        : '<div style="flex:1"></div><button class="btn btn-clay" id="rswDone" title="Finish setup and open the dashboard">Go to dashboard</button>';
    card.innerHTML = rswDots()
      + '<div class="rsw-ic">' + RSW_IC.check + '</div>'
      + '<h2 class="rsw-h">Your relay is ready</h2>'
      + '<p class="rsw-sub">' + (rswHandle ? 'Named <b>' + esc(rswHandle) + '</b>. ' : '') + (rswAdded ? 'Your church can use it now. ' : '')
      +   (nextIsChurch ? 'Next: your church. It is created in the console, not here — naming it there registers it on this relay.'
          // "Just a relay": the church is run from another device, so it is not the next step — say how it gets on
          : RSW_PATH === 'relay' && needsChurch ? 'A church run from another device is added by its ID under Settings → Churches; one created in the console here registers itself.'
          : needsChurch ? 'Now set up your church — it is created in the console, not here.' : 'One more thing worth doing, so members outside your building can connect:') + '</p>'
      + '<div class="rsw-next">'
      +   (needsChurch && !nextIsChurch ? '<a class="rsw-step" id="rswConsole" href="/steward.html" style="text-decoration:none"><span class="si">' + RSW_IC.church + '</span><span style="flex:1"><span class="st">Open the console</span><span class="sd">Create your church there — naming it registers it on this relay.</span></span></a>' : '')
      +   '<button class="rsw-step" id="rswTunnel" title="Give your relay a secure public web address"><span class="si">' + RSW_IC.globe + '</span><span style="flex:1"><span class="st">Reach members from anywhere</span><span class="sd">Turn on a secure tunnel — free, no router setup.</span></span></button>'
      + '</div>'
      + '<div class="rsw-foot">' + foot + '</div>';
    const rd = document.getElementById('rswDone'); if (rd) rd.onclick = closeRSW;
    // The console and Suite links are real <a>s (they navigate), so they close the wizard on their way out:
    // it must not be sitting there when the person comes back to the panel in this visit. They do NOT mark
    // the box set up — on the "everything" path the church is created in the console AFTER this link is
    // taken, so at the moment of the click this box may still hold nothing. What the launcher shows next is
    // read from the box (AUDIT-round-c C3).
    for (const id of ['rswConsole', 'rswSuite']) { const a = document.getElementById(id); if (a) a.addEventListener('click', () => closeRSW()); }
    document.getElementById('rswTunnel').onclick = () => {
      closeRSW();
      const t = document.getElementById('tab-set'); if (t) t.click();
      setTimeout(() => { const gp = document.getElementById('goPublic'); if (gp) gp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 140);
    };
  }

  // STORAGE-BEGIN — "Where this relay keeps its data" (relay storage plan step 4; owner-approved mockup
  // TrinityOne-internal/reference/MOCKUP-relay-storage-card-2026-11-13.html, decisions §8a/§8b). Driven by
  // scripts/the-storage-card-moves-the-relay-and-keeps-its-identity.test.mjs in a real browser — keep the markers.
  // The card exists only when GET /storage answers (the launcher set TRINITY_STORAGE_MODE); on every other box it
  // answers like a path that does not exist and the card and the Dashboard reminder stay hidden.
  const ST_ACTIVE = ['renaming', 'copying', 'verifying', 'switching', 'switched', 'checking', 'rolling-back'];
  const ST_RECENT_MS = 7 * 86400000;   // how long a finished move's outcome stays on the card
  const ST_WARN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3Z"></path><path d="M12 10v4M12 17.5v.5"></path></svg>';
  const ST_OK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>';
  const ST_BAD_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7.5v5.5M12 16.5v.5"></path></svg>';
  const ST_INFO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v6M12 7.5v.5"></path></svg>';
  const ST_SPIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6"></path></svg>';
  const ST_DOT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"></circle></svg>';
  const ST_TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"></path></svg>';
  const stGB = (b) => fmtStore(b);
  // one line per code, worded as the approved mockup's table (section 3)
  function stReason(code, d) {
    switch (code) {
      case 'not-enough-space': return 'Not enough space (needs ' + stGB(d && d.needBytes) + ')';
      case 'network': return 'Network drive — not supported';
      case 'sync-folder': return 'Synced by ' + ((d && /onedrive/i.test(d.mountpoint)) ? 'OneDrive' : (d && /dropbox/i.test(d.mountpoint)) ? 'Dropbox' : (d && /google/i.test(d.mountpoint)) ? 'Google Drive' : (d && /icloud|mobile documents/i.test(d.mountpoint)) ? 'iCloud' : 'a cloud service') + ' — not supported';
      case 'system-folder': case 'inside-app': return 'Used by the computer itself — not allowed';
      case 'path-has-symlink': return 'Reached through a shortcut — not supported';
      case 'target-not-empty': return 'Already has a "trinityone-relay" folder with something in it';
      case 'already-here': case 'target-overlaps-source': return 'Your relay\'s data is already here';
      case 'drive-missing': case 'not-mounted': return 'Not connected';
      case 'not-in-fstab': return 'Not set up to mount at start-up — add it to /etc/fstab first';
      case 'filesystem-not-supported': return 'This kind of drive can\'t hold a server relay\'s data';
      case 'old-copy-awaiting-removal': return 'Remove the old copy from your last move first.';
      case 'restore-pending': return 'A restore is waiting. Close and reopen the app to finish it, then move.';
      case 'relay-running': return 'Another copy of the relay is using this folder. Close it, then try again.';
      case 'move-in-progress': case 'move-already-requested': return 'A move is already under way.';
      case 'source-has-symlink': return 'This folder links to somewhere else, so it can\'t be moved safely.';
      case 'drives-unknown': return 'Couldn\'t list this computer\'s drives. Try again in a moment.';
      case 'storage-state-unknown': case 'storage-state-unreadable': return 'This relay can\'t move its data. Reinstall the app, or ask for help.';
      case 'no-permissions-not-acknowledged': return 'Tick the box to say you understand this drive has no file permissions.';
      case 'removable-not-acknowledged': return 'Tick the box to say you understand this drive can wear out and fail.';
      case 'local-only': return 'Change this on the relay\'s own computer.';
      default: return 'This can\'t be used (' + code + ')';
    }
  }
  const stInside = (p, root) => !!p && !!root && (p === root || p.startsWith(root.endsWith('/') || root.endsWith('\\') ? root : root + (root.includes('\\') && !root.includes('/') ? '\\' : '/')));
  // the friendly name of the place a path is on: a listed drive if one holds it, else "this computer"
  function stPlace(r, p, mountpoint) {
    let best = null;
    for (const d of r.drives || []) if (stInside(p, d.mountpoint) && (!best || d.mountpoint.length > best.mountpoint.length)) best = d;
    if (best) return best;
    if (mountpoint && mountpoint !== '/') return { label: mountpoint.split(/[\\/]/).filter(Boolean).pop() || mountpoint, mountpoint };
    return { label: 'this computer', mountpoint: mountpoint || '/' };
  }
  function stPathParts(r) {
    const p = (r.current.realPath || r.current.path || '');
    const place = stPlace(r, p, r.current.drive && r.current.drive.mountpoint);
    const rest = p.slice((place.mountpoint || '').length).split(/[\\/]+/).filter(Boolean);
    const shown = rest.length > 2 ? ['…', ...rest.slice(-2)] : rest;
    return [place.label.charAt(0).toUpperCase() + place.label.slice(1), ...shown];
  }
  let stState = { r: null, sel: '', ack: false, open: false, armed: false, msg: '', stopped: false, removeArmed: '', removeMsg: '', removeMsgFor: '' };
  let stDisarmT = null;
  function stDriveRow(d) {
    const sel = stState.sel === d.mountpoint, off = !d.eligible;
    const meta = d.sameDrive ? 'This drive · ' + stGB(d.freeBytes) + ' free' : (d.fsType ? esc(d.fsType) : 'Drive') + (d.freeBytes != null ? ' · ' + stGB(d.freeBytes) + ' free' : '');
    let extra = '';
    if (!off && d.sameDrive) extra += '<span class="chip chip-fast">Moves instantly — same drive</span>';
    // the warnings a steward must tick to accept (owner §8b): no file permissions, and USB wear on any removable
    // drive — both in ONE box with ONE tick
    if (!off && stNeedsAck(d)) extra += stAckBox(d, sel);
    if (!off && d.warn.includes('removable')) extra += '<div class="st-soft">' + ST_WARN_SVG + '<span>Removable drive. If it is unplugged, the relay stops until it is plugged back in.</span></div>';
    if (!off && d.warn.includes('filesystem-unknown')) extra += '<div class="st-soft">' + ST_WARN_SVG + '<span>We couldn\'t tell what kind of drive this is.</span></div>';
    return '<label class="st-drive' + (sel ? ' sel' : '') + (off ? ' off' : '') + '"><input type="radio" name="stDrive" value="' + esc(d.mountpoint) + '"' + (sel ? ' checked' : '') + (off ? ' disabled' : '') + '>'
      + '<div class="st-dmain"><div class="st-dname">' + esc(d.label) + '</div><div class="st-dmeta">' + meta + '</div>'
      + (off ? '<div class="st-why">' + esc(stReason(d.refuse[0], d)) + '</div>' : '') + extra + '</div></label>';
  }
  // Move is enabled only for an eligible drive, on a box that can change it, with nothing refusing the folder —
  // and for a drive with no file permissions, only once the steward has ticked the box (owner §8b).
  const ST_ACK_WARNS = ['no-permissions', 'removable'];
  const stNeedsAck = (d) => !!d && ST_ACK_WARNS.some(w => d.warn.includes(w));
  const ST_PERMS_LINE = 'This drive has no file permissions. Anyone who plugs it in can read your church\'s records.';
  const ST_WEAR_LINE = 'Running your church\'s relay from a USB stick wears it out faster than normal use, because it writes all day, every day. A USB stick can fail without warning. Keep regular backups.';
  function stAckBox(d, withTick) {
    const perms = d.warn.includes('no-permissions'), wear = d.warn.includes('removable');
    let h = '<div class="st-ackbox">';
    if (perms) h += '<div class="st-strong">' + ST_WARN_SVG + '<span>' + ST_PERMS_LINE + '</span></div>';
    if (wear) h += '<div class="st-strong st-wear">' + ST_WARN_SVG + '<span>' + ST_WEAR_LINE + '</span></div>';
    if (withTick) h += '<label class="st-ack"><input type="checkbox" id="stAck"' + (stState.ack ? ' checked' : '') + '> '
      + (perms && wear ? 'I understand anyone with this drive can read it, and that it can wear out and fail'
        : perms ? 'I understand anyone with this drive can read it' : 'I understand this drive can wear out and fail') + '</label>';
    return h + '</div>';
  }
  function stCanMove() {
    const r = stState.r; if (!r || !r.canChange || r.refuse.length) return false;
    const d = (r.drives || []).find(x => x.mountpoint === stState.sel);
    if (!d || !d.eligible) return false;
    if (stNeedsAck(d) && !stState.ack) return false;
    return true;
  }
  function stResult(kind, html) { return '<div class="st-result ' + kind + '" id="stResult">' + (kind === 'ok' ? ST_OK_SVG : kind === 'bad' ? ST_BAD_SVG : ST_INFO_SVG) + '<span>' + html + '</span></div>'; }
  function stMoveControls(r) {
    const d = (r.drives || []).find(x => x.mountpoint === stState.sel);
    const pick = '<div class="st-move"><button type="button" class="st-select" id="stPick" aria-haspopup="listbox" aria-expanded="' + (stState.open ? 'true' : 'false') + '"><span>Move to: <b>' + (d ? esc(d.label) : 'Choose a drive…') + '</b></span><span class="chev">▾</span></button>'
      + '<button type="button" class="btn ' + (stState.armed ? 'btn-danger' : 'btn-clay') + '" id="stMove"' + (stCanMove() ? '' : ' disabled') + '>' + (stState.armed ? 'Confirm — stop the relay and move' : 'Move…') + '</button></div>';
    const list = stState.open ? '<div class="st-list" role="listbox" aria-label="Drives" id="stList">' + (r.drives.length ? r.drives.map(stDriveRow).join('') : '<div class="st-drive off"><div class="st-dmain">No drives found.</div></div>') + '</div>' : '';
    let h = stState.open ? list + pick : pick;
    if (stState.armed && d) {
      if (stNeedsAck(d)) h += stAckBox(d, false);
      h += '<div class="st-msg err-text" id="stMsg">Click again to stop the relay and move its data to <b>' + esc(d.label) + '</b>. Click anywhere else, press Esc, or wait to cancel.</div>'
        + '<div class="hint">If the app doesn\'t reopen by itself, open it again.</div>';
    } else if (r.refuse.length) {
      h += '<div style="margin-top:12px">' + stResult('bad', '<b>Can\'t move right now.</b> ' + esc(stReason(r.refuse[0]))) + '</div>';
    } else if (stState.msg) {
      h += '<div style="margin-top:12px">' + stState.msg + '</div>';
    }
    h += d && d.sameDrive
      ? '<div class="st-explain" id="stExplain">Same drive, so the move is instant and there is no old copy. The relay restarts once.</div>'
      : '<div class="st-explain" id="stExplain">The relay stops for a few minutes while it copies. Members carry on through your church\'s other relays. Your old copy is kept until you remove it.</div>';
    return h;
  }
  function stRecent(m) { const t = Date.parse(m.endedAt || m.checkedAt || m.switchedAt || m.startedAt || 0); return t && Date.now() - t < ST_RECENT_MS; }
  function stOutcome(r) {
    const m = r.move; if (!m) return '';
    const events = m.counts && typeof m.counts.events === 'number' ? ' Same relay, same records — ' + m.counts.events.toLocaleString('en-GB') + ' events checked.' : ' Same relay, same records.';
    const here = stPlace(r, r.current.realPath || r.current.path, r.current.drive && r.current.drive.mountpoint);
    const onHere = here.kind === 'home' ? 'in your Home folder' : 'on ' + esc(here.label);
    if (m.state === 'awaiting-confirm') {
      const cur = (r.drives || []).find(x => x.target === r.current.realPath);
      return stResult('ok', '<b>Your relay now keeps its data ' + onHere + '.</b>' + events)
        + (cur && cur.warn.includes('no-permissions') ? '<div class="st-strong">' + ST_WARN_SVG + '<span>This drive has no file permissions. Anyone who plugs it in can read your church\'s records.</span></div>' : '');
    }
    if (!stRecent(m)) return '';
    if (m.state === 'done') return stResult('ok', '<b>Your relay now keeps its data ' + onHere + '.</b>' + events + (m.mode === 'rename' ? '<span class="st-sub">Same drive, so it moved instantly. There is no old copy to remove.</span>' : ''));
    if (m.state === 'rolled-back') return stResult('bad', '<b>The relay didn\'t start from the new drive, so it went back to the old folder.</b> Nothing was lost.');
    if (m.state === 'failed') {
      if (m.code === 'verify-failed') return stResult('bad', '<b>The copy didn\'t match, so nothing was changed.</b> Your relay is running from the old folder.');
      if (m.code === 'interrupted') return stResult('bad', '<b>The move didn\'t finish.</b> Your relay is still using the old folder. Nothing was lost.');
      if (m.code === 'target-permission-denied') return stResult('bad', '<b>Your Mac blocked access to that drive.</b> Allow TrinityOne Suite in System Settings → Privacy &amp; Security → Files and Folders, then try again.');
      return stResult('bad', '<b>The move didn\'t work, so nothing was changed.</b> Your relay is running from the old folder.');
    }
    return '';
  }
  function stOldCopy(r) {
    const o = r.oldCopy; if (!o) return '';
    const place = stPlace(r, o.path, o.mountpoint);
    const size = o.sizeBytes != null ? ' (' + stGB(o.sizeBytes) + ')' : '';
    const pending = r.requests && r.requests.removeOld && r.requests.removeOld.path === o.path;
    let h = '';
    if (o.remind) h += '<div class="sleepwarn st-remind" id="stRemind"><b>Your old copy has been on ' + esc(place.label) + ' for ' + o.ageDays + ' days.</b><span class="sw-sub">It still holds your church\'s records. Remove it once you\'re happy the move worked.</span></div>';
    const since = o.since ? new Date(o.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    const txt = o.remind ? 'Old copy: <b>' + esc(place.label) + '</b>' + size + (since ? ', kept since ' + since : '') + '.' : 'The old copy is still on <b>' + esc(place.label) + '</b>' + size + '.';
    let act;
    if (pending) act = '<span class="muted" id="stRemovePending">Removal requested. This card updates once the old copy is gone.</span>';
    else if (!o.exists) act = '<span class="muted">Plug in ' + esc(place.label) + ' to remove the old copy.</span>';
    else if (!r.canChange) act = '';
    else act = stState.removeArmed === o.path ? '<button type="button" class="btn btn-danger" id="stRemoveOld">Remove the old copy?</button>' : '<button type="button" class="btn btn-ghost btn-caution" id="stRemoveOld">' + ST_TRASH_SVG + 'Remove old copy</button>';
    h += '<div class="st-old"><div class="txt">' + txt + '</div>' + act + '</div>';
    if (stState.removeArmed === o.path) h += '<div class="st-msg err-text">This can\'t be undone. Click again to remove it, or click anywhere else to keep it.</div>';
    return h;
  }
  function stLeftovers(r) {
    const pend = r.requests && r.requests.removeOld && r.requests.removeOld.path;
    return (r.leftovers || []).filter(l => l.exists).map(l => {
      const place = stPlace(r, l.path, null);
      const when = l.since ? ' on ' + new Date(l.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
      const txt = l.kind === 'set-aside'
        ? '<b>Left over from a move that was undone</b>' + when + ': a full copy of your relay\'s records on <b>' + esc(place.label) + '</b>. Nothing uses it.'
        : '<b>Left over from an earlier move</b>' + when + ': an empty marker folder on <b>' + esc(place.label) + '</b>. Nothing uses it.';
      const act = pend === l.path ? '<span class="muted">Removal requested.</span>'
        : !r.canChange ? '' : stState.removeArmed === l.path ? '<button type="button" class="btn btn-danger" data-st-remove="' + esc(l.path) + '">Remove?</button>'
        : '<button type="button" class="btn btn-ghost btn-caution" data-st-remove="' + esc(l.path) + '">' + ST_TRASH_SVG + 'Remove</button>';
      return '<div class="st-old st-leftover"><div class="txt">' + txt + '</div>' + act + '</div>';
    }).join('');
  }
  function stProgress(m) {
    const step = m.state === 'copying' || m.state === 'renaming' ? 1 : m.state === 'verifying' ? 2 : 3;
    const amount = m.totalBytes ? ' ' + stGB(m.copiedBytes || 0) + ' of ' + stGB(m.totalBytes) : '';
    const rows = [['Relay stopped'], ['Moving your relay\'s data…' + amount], ['Checking the copy…'], ['Starting the relay…']];
    return '<ul class="st-steps" id="stSteps">' + rows.map((t, i) => '<li class="' + (i < step ? 'done' : i === step ? 'now' : '') + '"><span class="ic' + (i === step ? ' ic-spin' : '') + '">' + (i < step ? ST_OK_SVG : i === step ? ST_SPIN_SVG : ST_DOT_SVG) + '</span>' + esc(t[0]) + '</li>').join('') + '</ul>'
      + '<div class="hint">Members carry on through your church\'s other relays.</div>';
  }
  function stRender() {
    const card = document.getElementById('storageCard'), r = stState.r;
    if (!card) return;
    if (!r) { card.hidden = true; stRenderDash(null); return; }
    card.hidden = false;
    const parts = stPathParts(r);
    document.getElementById('stNow').innerHTML = '<span class="k">Now</span><span class="st-path">' + parts.map(esc).join('<span class="sep">›</span>') + '</span><span class="st-size">' + stGB(r.current.sizeBytes) + (r.current.freeBytes != null ? ' · ' + stGB(r.current.freeBytes) + ' free' : '') + '</span>';
    const desc = document.getElementById('stDesc');
    let body;
    if (stState.stopped) {
      body = '<div class="wz-line" id="stStopped"><span class="ic-spin">' + ST_SPIN_SVG + '</span><b>Your relay is stopped for the move. This page reconnects when it\'s back.</b></div>'
        + '<div class="hint">If the app doesn\'t reopen by itself, open it again.</div>';
      if (desc) desc.textContent = 'Moving';
    } else if (r.move && ST_ACTIVE.includes(r.move.state)) {
      body = stProgress(r.move); if (desc) desc.textContent = 'Moving';
    } else {
      if (desc) desc.textContent = '';
      body = stOutcome(r) + stOldCopy(r);
      if (r.mode === 'suite' && !r.local) body += stResult('info', '<b>Change this on the relay\'s own computer.</b><span class="st-sub">You can see where the data is from here, but moving it only works in the TrinityOne Suite window on that computer.</span>');
      else if (!(r.move && r.move.state === 'awaiting-confirm')) body += (body ? '<div style="margin-top:12px">' : '<div>') + stMoveControls(r) + '</div>';
      body += stLeftovers(r);
      // a failed Remove is shown whatever the card now holds — the folder it named may no longer be on record
      if (stState.removeMsg) body += '<div style="margin-top:10px" id="stRemoveMsg">' + stState.removeMsg + '</div>';
    }
    document.getElementById('stBody').innerHTML = body;
    stWire();
    stRenderDash(r);
  }
  // The 7-day reminder also goes on the Dashboard (owner §8b) — as a full-width card in its own row, so the
  // fixed grid's rows below keep their equal heights.
  function stRenderDash(r) {
    const el = document.getElementById('storageRemindDash'); if (!el) return;
    const o = r && r.oldCopy;
    const removing = !!(o && r.requests && r.requests.removeOld && r.requests.removeOld.path === o.path);   // audit B N-1
    if (!o || !o.remind || removing) { el.hidden = true; return; }
    const place = stPlace(r, o.path, o.mountpoint);
    document.getElementById('stDashT').textContent = 'Your old copy has been on ' + place.label + ' for ' + o.ageDays + ' days.';
    el.hidden = false;
  }
  function stDisarm() {
    if (stDisarmT) { clearTimeout(stDisarmT); stDisarmT = null; }
    document.removeEventListener('click', stOutside, true); document.removeEventListener('keydown', stEsc);
    if (stState.armed || stState.removeArmed) { stState.armed = false; stState.removeArmed = ''; stRender(); }
  }
  function stOutside(ev) { const b = ev.target && ev.target.closest && ev.target.closest('#stMove, #stRemoveOld, [data-st-remove]'); if (!b) stDisarm(); }
  function stEsc(ev) { if (ev.key === 'Escape') stDisarm(); }
  function stArm() {
    stDisarmT = setTimeout(stDisarm, 10000);
    setTimeout(() => document.addEventListener('click', stOutside, true), 0);
    document.addEventListener('keydown', stEsc);
  }
  async function stPost(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
    let j = {}; try { j = await r.json(); } catch (e) {}
    return { status: r.status, j };
  }
  function stFailText(res) {
    if (res.status === 403) return stResult('info', '<b>' + esc(stReason('local-only')) + '</b>');
    if (res.status === 400 && res.j.error === 'drive-not-offered') return stResult('bad', '<b>That drive isn\'t offered any more.</b> Pick again.');
    const codes = (res.j && res.j.refuse) || [];
    return stResult('bad', '<b>Can\'t move right now.</b> ' + esc(codes.length ? stReason(codes[0]) : (res.j.error || 'Something went wrong.')));
  }
  // a failed Remove says what failed — never "Can't move right now" (audit B L-1)
  function stRemoveFailText(res, path) {
    const isOld = !!(stState.r && stState.r.oldCopy && stState.r.oldCopy.path === path);
    const what = isOld ? 'Couldn\'t remove the old copy.' : 'Couldn\'t remove that leftover folder.';
    const why = res.status === 403 ? stReason('local-only')
      : res.status === 400 && res.j && res.j.error === 'not-recorded' ? 'It is no longer on record, so it was left alone. Reload the page.'
      : res.status === 409 ? 'It is the folder your relay is using now, so it was left alone.'
      : res.status === 0 ? 'Couldn\'t reach the relay. Try again.'
      : 'Something went wrong. Try again.';
    return stResult('bad', '<b>' + what + '</b> ' + esc(why));
  }
  async function stWaitForRelay() {
    // the relay serves this page and is off during the move: wait for it, then show what happened
    for (;;) {
      await new Promise(res => setTimeout(res, 3000));
      try { const s = await fetch('/status', { cache: 'no-store' }); if (s.ok) { location.reload(); return; } } catch (e) {}
    }
  }
  function stWire() {
    const pick = document.getElementById('stPick');
    if (pick) pick.onclick = () => { stState.open = !stState.open; stDisarm(); stRender(); };
    document.querySelectorAll('#stList input[name="stDrive"]').forEach(inp => {
      inp.onchange = () => { stState.sel = inp.value; stState.ack = false; stState.msg = ''; stDisarm(); stRender(); };
    });
    const ack = document.getElementById('stAck');
    if (ack) ack.onchange = () => { stState.ack = ack.checked; stDisarm(); stRender(); };
    const mv = document.getElementById('stMove');
    if (mv) mv.onclick = async () => {
      if (!stCanMove()) return;
      if (!stState.armed) { stState.armed = true; stRender(); stArm(); return; }
      stDisarm();
      const d = stState.r.drives.find(x => x.mountpoint === stState.sel);
      mv.disabled = true;
      let res; try { res = await stPost('/storage/move', { drive: d.mountpoint, acknowledge: stState.ack ? ST_ACK_WARNS.filter(w => d.warn.includes(w)) : [] }); }
      catch (e) { stState.msg = stResult('bad', '<b>Couldn\'t reach the relay.</b> ' + esc(e.message)); stRender(); return; }
      if (res.status === 200 && res.j.ok) { stState.stopped = true; stRender(); stWaitForRelay(); return; }
      stState.msg = stFailText(res); await stLoad();
    };
    const ro = document.getElementById('stRemoveOld');
    if (ro) ro.onclick = () => stRemove(stState.r.oldCopy.path);
    document.querySelectorAll('[data-st-remove]').forEach(b => { b.onclick = () => stRemove(b.getAttribute('data-st-remove')); });
  }
  async function stRemove(path) {
    if (stState.removeArmed !== path) { stState.removeArmed = path; stRender(); stArm(); return; }
    stDisarm();
    let res; try { res = await stPost('/storage/remove-old', { path }); } catch (e) { res = { status: 0, j: { error: e.message } }; }
    stState.removeMsg = ''; stState.removeMsgFor = '';
    if (res.status !== 200) { stState.removeMsg = stRemoveFailText(res, path); stState.removeMsgFor = path; }
    await stLoad();
  }
  async function stLoad() {
    try {
      const r = await adminFetch('/storage');
      if (r.status !== 200) { stState.r = null; stRender(); return; }
      const j = await r.json();
      if (!j || !j.ok || !j.current) { stState.r = null; stRender(); return; }
      stState.r = j;
      if (stState.sel && !(j.drives || []).some(d => d.mountpoint === stState.sel)) { stState.sel = ''; stState.ack = false; }
    } catch (e) { stState.r = null; }
    stRender();
  }
  { const go = document.getElementById('stDashGo');
    if (go) go.onclick = () => { selectTab('set', false); setTimeout(() => { const c = document.getElementById('storageCard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 140); }; }
  // STORAGE-END
