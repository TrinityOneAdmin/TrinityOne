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

  fetch('/suite-update', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.updateAvailable || !d.latest) return;
      var dismissed = null;
      try { dismissed = localStorage.getItem('suite.updDismissed'); } catch (e) {}
      if (dismissed === d.latest) return;            // already dismissed this exact release
      upd.dataset.latest = d.latest;
      if (dl && d.url) dl.href = d.url;
      upd.classList.add('show');
    })
    .catch(function () {});
})();
