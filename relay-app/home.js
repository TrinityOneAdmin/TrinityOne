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
    var h = String(location.hostname || '').replace(/^\[|\]$/g, '');
    if (!/^(localhost|127\.0\.0\.1|::1|0\.0\.0\.0)$/i.test(h)) return;
    location.replace('/relay-app/control.html');
  } catch (e) { /* no storage → leave the launcher alone */ }
})();
