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
      : '<div class="warn">⚠ This relay is only reachable on your computer / local network. Turn on public access below — one click, no terminal.</div>';
  }
  // Return to the Steward console IN THIS WINDOW — window.open('_blank') doesn't work in the desktop app's
  // webview. Prefer going back (preserves the console's state); fall back to navigating there fresh.
  document.getElementById('openConsole').onclick = () => { if (history.length > 1) { history.back(); } else { location.href = '/relay-app/home.html'; } };   // fall back to the launcher (neutral) — not the full-suite console, which contradicts a "Relay only" choice
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
      const r = await fetch('/status', { cache: 'no-store' });
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
      const st = await fetch('/stats?days=1', { headers: authHeaders(), cache: 'no-store' })
        .then(r2 => (r2.ok ? r2.json() : null)).catch(() => null);
      if (st) {
        const kinds = st.kinds || [];
        const total = kinds.reduce((a, k) => a + (k.n || 0), 0);
        const profiles = (kinds.find(k => k.kind === 0) || {}).n;
        document.getElementById('s-churches').textContent = (st.churches || []).length;
        if (profiles != null) document.getElementById('s-members').textContent = profiles;
        document.getElementById('s-events').textContent = total.toLocaleString();
        if (st.connections != null) document.getElementById('s-conns').textContent = st.connections;
      }
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
      const r = await fetch('/config?stats=1', { headers: authHeaders(), cache: 'no-store' });   // stats so each row shows what it holds
      if (r.status === 401) { setLocked(true); document.getElementById('cfgList').innerHTML = ''; return; }
      const s = await r.json();
      setLocked(false);
      st.textContent = s.configured ? '' : '— none yet';
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
      const lan = document.getElementById('t-lan'); if (lan) lan.checked = s.lanAccess === true;   // desktop app only; read at launch from the lan-access marker
      const of = document.getElementById('t-offer'); if (of) of.checked = s.offerHosting === true;
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
      // The update-source field mirrors the file on the box, never the value somebody last typed — except
      // while the operator is typing in it, when a 60-second re-read must not wipe their edit.
      const oIn = document.getElementById('originIn');
      if (oIn && document.activeElement !== oIn) oIn.value = cur.origin || '';
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
      if (cur.packaged) { body.innerHTML = 'This relay is part of the <b>TrinityOne Suite</b>: its software updates when you install a newer Suite — the launcher (Back) says when one is out. The update source above is still what the installer card below fetches from.'; return; }
      // WHERE THE CODE COMES FROM is its own answer (cur.codeSource, relay/code-source — a GitHub release on
      // a box installed since 2026-09-21) and is what "Update now" pulls; the update source above is where
      // the installers come from. A box without a code source pulls from its update source, as before.
      const codeSrc = cur.codeSource || cur.origin;
      const from = cur.codeSource && cur.codeSource !== cur.origin ? '<div class="hint" style="margin-bottom:6px">Software comes from ' + esc(cur.codeSource) + '. The update source above is where the installers come from.</div>' : '';
      if (!codeSrc) {
        if (cur.releaseHost) { body.innerHTML = 'This is the release source — nothing to pull here.'; return; }
        body.innerHTML = '<b>This box was never told where to get things from</b> — set an update source above. Until then there is nowhere to check for a newer build or pull one from.'
          + '<button class="btn-clay" id="doUpdate" disabled aria-disabled="true" style="margin-top:8px;display:block;opacity:.55;cursor:not-allowed">Update now</button>';
        return;
      }
      // The relay checks its code source server-side (cur.latest) — the browser can't be relied on to reach
      // the release host's ts.net funnel. If the server couldn't reach it either, cur.latest is null.
      const latest = cur.latest;
      if (!latest || !latest.version) { body.innerHTML = from + 'Couldn’t reach the code source (' + esc(codeSrc) + ') to check. You can still force an update with the button below.'
        + '<button class="btn-clay" id="doUpdate" style="margin-top:8px;display:block">Update now</button>'; document.getElementById('doUpdate').onclick = doUpdate; return; }
      if (latest.version === cur.version) { body.innerHTML = from + '<span style="color:var(--sage)">✓ Up to date.</span>'; return; }
      body.innerHTML = from + 'A new build is available (' + esc((latest.tag ? latest.tag + ' · ' : '') + (latest.versionShort || '') + (latest.builtAt ? ' · ' + latest.builtAt.slice(0, 10) : '')) + '). '
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
      const r = await fetch('/relay-app/apk-status', { headers: authHeaders(), cache: 'no-store' });
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
      ? '<div class="apk-note warn">This box was never told where to get things from, so it cannot fetch an installer — set an update source under “Relay software” above.' + (s.holding ? ' Members can still install the copy it already holds.' : '') + '</div>'
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
    adminToken = t; localStorage.setItem(TOKEN_KEY, adminToken);
    if (gm) gm.textContent = '';
    loadConfig(); gpTick(); loadRelayName(); maybeFirstRun(); loadApkStatus();
  };
  document.getElementById('tok').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('tokGo').click(); });
  // When this panel is opened ON the relay machine (e.g. the TrinityOne Suite's own window), the relay hands
  // us its admin token automatically — no hunting in logs. /local-token only answers genuine same-machine
  // requests, so this is a no-op when the dashboard is opened remotely over a tunnel.
  (async () => {
    if (!adminToken) {
      try { const r = await fetch('/local-token', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (j && j.token) { adminToken = j.token; localStorage.setItem(TOKEN_KEY, adminToken); } } } catch (e) {}
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

  // The installer card's "Give people this" address follows the tunnel (loadApkStatus), and that card
  // re-reads itself every five minutes. Pressing "Make it public" must not leave "Not shareable yet" on
  // screen for five minutes beside a card that says "On · public", so a change of public state re-reads
  // it at once. `null` until the first tick has answered, so the first read is not counted as a change.
  let _gpWasPublic = null;
  function gpNotePublic(pubNow) {
    if (_gpWasPublic === null) { _gpWasPublic = pubNow; return; }
    if (pubNow !== _gpWasPublic) { _gpWasPublic = pubNow; loadApkStatus(); }
  }
  async function gpTick() {
    if (tsBusy || cfHold) return;
    try {
      // Cloudflare quick tunnel is the no-account default — if it's up, show that and skip the Tailscale flow.
      let cf = null; try { cf = await (await fetch('/tunnel/state', { headers: authHeaders(), cache: 'no-store' })).json(); } catch (e) {}
      if (cf && cf.running && cf.url) { renderCfPublic(cf); gpNotePublic(true); return; }
      const r = await fetch('/tailscale/state', { headers: authHeaders(), cache:'no-store' });
      if (r.status === 401) { renderGoPublic({ locked:true }); return; }
      const s = await r.json();
      if (s.loggedIn) lastAuthUrl = '';
      renderGoPublic(s);
      gpNotePublic(!!(s.funnelOn && s.publicUrl));
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

  // ── First-run setup wizard ──────────────────────────────────────────────────
  // A fresh relay otherwise drops the operator straight onto the dashboard with the
  // setup scattered across Settings cards. This walks a brand-new relay through the
  // two things it actually needs — a name and its first church — BEFORE the console,
  // then points at the tunnel as the next step. Shown once (a localStorage flag), and
  // only when the relay genuinely looks new (no name claimed AND no church added), so
  // an established relay is never nagged.
  const RSW_SEEN = 'to_relay_setup_seen';
  // ── "SKIP SETUP" IS NOT "SET UP" (AUDIT-suite-B4 N2; owner, 2026-09-22: "It should come back until its
  // setup"). The step-0 escape hatch used to call closeRSW(), which writes RSW_SEEN — the marker that means "a
  // wizard finished", and the one the LAUNCHER reads to retire its first-run card. So one click on a box with
  // no name and no church declared it established for ever: the card never came back and this wizard never
  // reopened (openRelaySetup has exactly one caller, maybeFirstRun, which RSW_SEEN short-circuits).
  // A skip now dismisses it for THIS VISIT only — sessionStorage, which a relaunch of the Suite clears — so
  // reloading this dashboard in the same sitting is not a nag, and the next launch asks again. What retires
  // the card permanently is the two live facts the launcher reads from the box itself: a church
  // (/status.writePolicy) or a relay name (/relay-names/mine.handle).
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
        fetch('/relay-names/mine', { headers: authHeaders(), cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/config?stats=1', { headers: authHeaders(), cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
    } catch (e) { return; }
    if (!nm || !cf) return;                                   // couldn't read (401 / relay down) — don't guess
    rswHasChurches = (cf.churches || []).length > 0;
    const fresh = !nm.handle && !rswHasChurches;
    if (fresh) openRelaySetup();
    else localStorage.setItem(RSW_SEEN, '1');                 // an established relay must never be nagged
  }
  window.maybeFirstRun = maybeFirstRun;

  function openRelaySetup() { rswOpen = true; rswStep = 0; rswHandle = ''; rswAdded = false; rswManual = false; document.getElementById('relaySetup').classList.add('show'); renderRSW(); }
  function closeRSW() { localStorage.setItem(RSW_SEEN, '1'); rswOpen = false; document.getElementById('relaySetup').classList.remove('show'); }
  // The same close WITHOUT the "a wizard finished" marker — see RSW_SKIPPED above. Only step 0's "Skip setup"
  // uses it; every other way out of this wizard (Go to dashboard, the tunnel step, Back to the Suite, Next:
  // open the console) is reached by walking it, and keeps writing RSW_SEEN.
  function skipRSW() { try { sessionStorage.setItem(RSW_SKIPPED, '1'); } catch (e) {} rswOpen = false; document.getElementById('relaySetup').classList.remove('show'); }
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
        + '<div class="rsw-foot"><button class="btn btn-ghost" id="rswBack">Back</button><div style="flex:1"></div><button class="btn btn-ghost" id="rswById">I already have a church</button><button class="btn btn-clay" id="rswSkip">Continue</button></div>';
    }
    return dots
      + '<div class="rsw-ic">' + RSW_IC.church + '</div>'
      + '<h2 class="rsw-h">Add your church</h2>'
      + '<p class="rsw-sub">Paste your church\u2019s ID (its npub) so it\u2019s allowed to publish to and read from this relay. You\u2019ll find it in the steward console. You can add more churches later.</p>'
      + '<div class="rsw-lbl">Church npub</div>'
      + '<input class="rsw-in" id="rswNpub" placeholder="npub1\u2026" autocomplete="off" spellcheck="false" />'
      + '<div class="rsw-msg" id="rswNpubMsg"></div>'
      + '<div class="rsw-foot"><button class="btn btn-ghost" id="rswBack">Back</button><div style="flex:1"></div><button class="btn btn-ghost" id="rswSkip">Skip for now</button><button class="btn btn-clay" id="rswAdd">Add &amp; continue</button></div>';
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
        + '<div class="rsw-foot"><button class="btn btn-ghost" id="rswSkip">Skip setup</button><div style="flex:1"></div><button class="btn btn-clay" id="rswGo">Get started</button></div>';
      document.getElementById('rswGo').onclick = () => { rswStep = 1; renderRSW(); };
      // on a guided path a skip still ends on the launcher (RSW_PATH's note above); otherwise on this dashboard.
      // skipRSW, not closeRSW: a skip sets nothing up, so it must not say a wizard finished (RSW_SKIPPED above).
      document.getElementById('rswSkip').onclick = () => { skipRSW(); if (RSW_PATH) location.href = RSW_HOME; };
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
        + '<div class="rsw-foot"><button class="btn btn-ghost" id="rswBack">Back</button><div style="flex:1"></div><button class="btn btn-ghost" id="rswSkip">Skip for now</button><button class="btn btn-clay" id="rswClaim">Claim &amp; continue</button></div>';
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
          rswHandle = j.handle || handle; rswStep = 2; renderRSW();
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
        + '<p class="rsw-sub">Your church is only reachable while this computer is running. A machine that sleeps at night, or a laptop you close, means members can\u2019t open your church until it wakes.</p>'
        // ⚠ RECORD-ONLY, AND IT SAYS SO, because today the answer changes nothing. Its only consumer was
        // `_registerOnOwnBox`, reverted 2026-09-12 — and an audit had already shown that guard was inert
        // anyway (written at 127.0.0.1, read at localhost: separate storage partitions). A screen that
        // offers a consequential-sounding "No" and then does nothing has asked a question the app ignores,
        // which is worse than not asking. When chunk 4 gives the answer somewhere to act, delete this line.
        + '<p class="rsw-sub" style="opacity:.8">We\u2019re noting this for later — it doesn\u2019t change anything yet.</p>'
        + '<div class="rsw-msg" id="rswOnMsg"></div>'
        + '<div class="rsw-foot"><button class="btn btn-ghost" id="rswBack">Back</button><div style="flex:1"></div><button class="btn btn-ghost" id="rswOnNo">No \u2014 it gets switched off</button><button class="btn btn-clay" id="rswOnYes">Yes, it stays on</button></div>';
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
        ? '<button class="btn btn-ghost" id="rswDone">Go to dashboard</button><div style="flex:1"></div>' + suiteLink('btn-clay')
        : '<div style="flex:1"></div><button class="btn btn-clay" id="rswDone">Go to dashboard</button>';
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
      +   '<button class="rsw-step" id="rswTunnel"><span class="si">' + RSW_IC.globe + '</span><span style="flex:1"><span class="st">Reach members from anywhere</span><span class="sd">Turn on a secure tunnel — free, no router setup.</span></span></button>'
      + '</div>'
      + '<div class="rsw-foot">' + foot + '</div>';
    const rd = document.getElementById('rswDone'); if (rd) rd.onclick = closeRSW;
    // the console and Suite links are real <a>s (they navigate); mark the wizard seen on the way out so it
    // never re-opens — and so the launcher, which reads the same marker, shows its doors from now on
    for (const id of ['rswConsole', 'rswSuite']) { const a = document.getElementById(id); if (a) a.addEventListener('click', () => { try { localStorage.setItem(RSW_SEEN, '1'); } catch (e) {} }); }
    document.getElementById('rswTunnel').onclick = () => {
      closeRSW();
      const t = document.getElementById('tab-set'); if (t) t.click();
      setTimeout(() => { const gp = document.getElementById('goPublic'); if (gp) gp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 140);
    };
  }
