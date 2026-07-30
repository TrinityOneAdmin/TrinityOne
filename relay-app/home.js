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
