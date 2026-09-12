// Suite launcher update check. The local relay does the actual GitHub fetch server-side (/suite-update)
// so this stays same-origin — no cross-origin CORS fetch from the webview. If a newer build is published,
// show the banner. The app is an installer (it can't self-patch), so "update" = download + reinstall;
// the relay's data dir is separate, so reinstalling keeps the church's data.
(function () {
  var upd = document.getElementById('upd');
  var dl = document.getElementById('updDl');
  var x = document.getElementById('updX');
  if (!upd) return;

  if (x) x.addEventListener('click', function () {
    upd.classList.remove('show');
    // remember the version we dismissed so we don't nag on every launch for the same release
    try { if (upd.dataset.latest) localStorage.setItem('suite.updDismissed', upd.dataset.latest); } catch (e) {}
  });

  // target="_blank" is a no-op in the desktop webview, so route the click through the local relay, which CAN
  // open the host's browser. Fall back to copying the link if that ever fails (e.g. run in a plain browser).
  function copyFallback(url) {
    // It used to say "✓ Link copied" whether or not anything was copied — navigator.clipboard is UNDEFINED
    // outside a secure context, which is exactly where this panel runs, so the operator was told the link was
    // on their clipboard when it was not. Claiming a thing happened when it did not is worse than silence.
    // RelayCopy falls back to execCommand, and if that fails too it shows the URL for manual copying.
    window.RelayCopy.copyWithFeedback(url, dl, 'Download link').then(function (ok) {
      if (dl) dl.textContent = ok ? '✓ Link copied' : 'Copy the link above';
      var t = upd.querySelector('.txt');
      if (t) t.innerHTML = ok
        ? '<b>Link copied.</b> Open your web browser (e.g. Brave) and paste it to download the update.'
        : '<b>Copy the link shown.</b> Open your web browser (e.g. Brave) and paste it to download the update.';
    });
  }
  if (dl) dl.addEventListener('click', function (e) {
    e.preventDefault();
    var url = dl.dataset.url || dl.href;
    if (!url) return;
    // /open-external now requires the admin token (anti-CSRF). Fetch it from the loopback-fenced /local-token
    // first (only genuine same-machine requests get it), then hand it to the opener.
    fetch('/local-token', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var h = { 'Content-Type': 'application/json' };
        if (j && j.token) h.Authorization = 'Bearer ' + j.token;
        return fetch('/open-external', { method: 'POST', headers: h, body: JSON.stringify({ url: url }) });
      })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (res) { if (res && res.ok) { dl.textContent = 'Opening browser…'; } else { copyFallback(url); } })
      .catch(function () { copyFallback(url); });
  });

  fetch('/suite-update', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.updateAvailable || !d.latest) return;
      var dismissed = null;
      try { dismissed = localStorage.getItem('suite.updDismissed'); } catch (e) {}
      if (dismissed === d.latest) return;            // already dismissed this exact release
      upd.dataset.latest = d.latest;
      if (dl && d.url) { dl.dataset.url = d.url; dl.href = d.url; }
      upd.classList.add('show');
    })
    .catch(function () {});
})();

// ── FIRST LAUNCH GOES THROUGH RELAY SETUP ─────────────────────────────────────────────────────────────
// Owner, 2026-09-12: the Suite should "have a wizard that goes through the relay setup first? Then,
// automatically on completion, shows the relay dashboard, then a popup asks, 'time to set up a church'".
//
// THE WIZARD ALREADY EXISTED AND ALMOST NOBODY REACHED IT. `maybeFirstRun()` lives in control.js, and
// control.js is loaded by control.html and by nothing else (measured) — so it fires only for someone who
// picks "Manage a relay". A steward who picks "Run your church" goes to /steward.html and never loads it,
// which is most stewards. That, not a missing wizard, was the gap.
//
// ⚠ THIS DOES NOT SEND FIRST RUN TO THE CONSOLE, and must never be changed to. `6966c4f` (2026-09-08)
// fixed exactly that: first run used to open steward.html, so somebody installing the Suite purely to run
// a relay was walked into church setup with no way past it. This lands on the RELAY PANEL, where both
// doors stay one click away.
//
// ⚠ LOOPBACK ONLY, and that is not caution — it is what stops a redirect loop. control.js's
// `maybeFirstRun()` returns early when it has no admin token, BEFORE it sets the seen-marker, and
// localAdminToken() is loopback-gated. Over a tunnel the marker would therefore never be set and this
// would bounce the launcher to the panel on every single launch, forever.
//
// The marker is control.js's own `to_relay_setup_seen`, and it is set on EVERY exit from that wizard —
// finished, skipped, or "this relay is already established, do not nag". So this redirects at most once.
(function () {
  try {
    if (localStorage.getItem('to_relay_setup_seen')) return;
    // ⚠ ONCE PER APP RUN, INDEPENDENTLY OF THE MARKER. The marker is written by control.js when its wizard
    // exits — but an audit found several loopback paths where the wizard cannot even OPEN and so never
    // writes it: a stale admin token surviving a relay data reset, a relay not yet serving /config, and
    // quitting mid-wizard. Every one of those would otherwise land the launcher on the panel on EVERY
    // launch, for ever. A loop that needs the relay to be healthy in order to stop is not safely prevented.
    // sessionStorage is per-origin and per-window and dies with the app, so a genuine next launch still
    // gets the wizard. home.html and control.html share an origin, so it survives the navigation below.
    if (sessionStorage.getItem('to_relay_setup_tried')) return;
    // ⚠ `0.0.0.0` IS DELIBERATELY NOT IN THIS LIST, and it used to be. The gateway's /local-token gate
    // accepts only 127.0.0.1, localhost and ::1 — so a webview at 0.0.0.0 passed THIS check, was refused
    // the admin token, and control.js returned before writing its marker. That box then landed on the
    // panel on every launch with no way to reach the wizard. Admitting an address the server refuses is
    // strictly worse than not admitting it.
    var h = String(location.hostname || '').replace(/^\[|\]$/g, '');
    if (!/^(localhost|127\.0\.0\.1|::1)$/i.test(h)) return;
    sessionStorage.setItem('to_relay_setup_tried', '1');
    // ⚠ `href`, NOT `replace`. `replace` CONSUMES this page's history entry, and the relay panel's only way
    // out is `openConsole`, whose rule is `history.length > 1 ? history.back() : go to the launcher`. With
    // the entry consumed, Back landed on the bundled "Starting your relay…" splash — no links, no address
    // bar, nothing but quitting the app. Pushing restores the one assumption that exit depends on.
    location.href = '/relay-app/control.html';
  } catch (e) { /* no storage, or a browser refusing it → leave the launcher alone, never trap the user */ }
})();
