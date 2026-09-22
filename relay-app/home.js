// ── FIRST RUN: ONE CARD, NOT TWO DOORS ──────────────────────────────────────────────────────────────────
// Owner, 2026-09-22, after his own first run of the real AppImage: a first-time person still cannot tell which
// door to take. So while NOTHING has been set up the launcher shows one card — "Set up everything" / "Just a
// relay" / "Just the console" — and the two doors otherwise. This block DECIDES; it never navigates (the
// card's three choices are plain links, and scripts/suite-two-doors.test.mjs pins that this file has no
// location.href).
//
// "SET UP" IS READ FROM WHAT EXISTS, NOT ONLY FROM A MARKER. Two markers other pages already write mean "a
// wizard finished or was skipped": `to_relay_setup_seen` (control.js closeRSW, the panel's own wizard) and
// `trinityone.steward.wizard.done` (stew-dashboard.jsx finishWizard, and the restore/adopt paths). Either one
// → the doors, at once and without a fetch. Without a marker (a fresh webview profile, or cleared site data)
// the box itself is asked: /status.writePolicy is true iff this relay holds a church (public, no token), and
// /relay-names/mine.handle is the relay's name (via /local-token, which only a same-machine request gets — the
// Suite always is one). A church or a name → the doors: something was set up here, whatever storage says. Both
// absent AND no marker → the card. If /status cannot be read at all the doors are shown — "first time here"
// is a claim, and a claim this page cannot back is worse than the two doors that were always here.
//
// The doors are visible in the HTML and this hides them while it asks, so a script that never runs leaves
// the launcher with its doors, never blank (the splash lesson: this page must not be a dead end).
(function () {
  var card = document.getElementById('firstRun');
  var doors = document.getElementById('doors');
  var sub = document.getElementById('sub');
  if (!card || !doors) return;
  var decided = false, fallback = null;
  function show(which) {
    if (decided) return;
    decided = true; clearTimeout(fallback);
    card.hidden = which !== 'card';
    doors.hidden = which !== 'doors';
    if (sub) sub.hidden = which !== 'doors';
    document.body.setAttribute('data-first-run', which);
  }
  var marked = false;
  try { marked = !!(localStorage.getItem('to_relay_setup_seen') || localStorage.getItem('trinityone.steward.wizard.done')); } catch (e) {}
  if (marked) { show('doors'); return; }
  doors.hidden = true; if (sub) sub.hidden = true;          // while asking; the fallback below undoes it
  fallback = setTimeout(function () { show('doors'); }, 2500);
  var status = fetch('/status', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  var named = fetch('/local-token', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j || !j.token) return null;
      return fetch('/relay-names/mine', { headers: { Authorization: 'Bearer ' + j.token }, cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; });
    })
    .catch(function () { return null; });
  Promise.all([status, named]).then(function (res) {
    var s = res[0], nm = res[1];
    if (!s) { show('doors'); return; }                        // cannot tell → the doors, never a claim
    var hasChurch = s.writePolicy === true;
    var hasName = !!(nm && nm.handle);
    show(hasChurch || hasName ? 'doors' : 'card');
  }).catch(function () { show('doors'); });
})();

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


// ── A FIRST LAUNCH STAYS HERE. There is deliberately no redirect in this file. ────────────────────────
// From 2026-09-12 to 2026-09-22 a first launch was sent from this page to the relay panel, so that the
// panel's setup wizard ran for everyone. The owner's own first run of the real AppImage (2026-09-22)
// showed what that did: the app opened on the relay panel, nothing said the two doors were one page
// back, and after the relay wizard nothing said the church is created in the CONSOLE — so the relay had
// no church and the person did not know why. The launcher's two doors are the first thing a person sees
// now; the panel points at the console while the relay has no church (control.js, the next-step card).
//
// The `to_relay_setup_seen` marker is control.js's own — written by closeRSW(), read by maybeFirstRun() —
// and nothing in this file reads or writes it any more. The once-per-run `to_relay_setup_tried` marker
// existed only for the redirect and is gone with it.
