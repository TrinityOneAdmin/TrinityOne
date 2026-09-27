// ── FIRST RUN: ONE CARD, NOT TWO DOORS ──────────────────────────────────────────────────────────────────
// Owner, 2026-09-22, after his own first run of the real AppImage: a first-time person still cannot tell which
// door to take. So while NOTHING has been set up the launcher shows one card — "Set up everything" / "Just a
// relay" / "Just the console" — and the two doors otherwise. This block DECIDES; it never navigates (the
// card's three choices are plain links, and scripts/suite-two-doors.test.mjs pins that this file has no
// location.href).
//
// "SET UP" IS READ FROM WHAT EXISTS. THE BOX IS ASKED, ALWAYS — NO MARKER IS CONSULTED HERE.
//
// ⚠ CORRECTED 2026-09-27. This said two markers — `to_relay_setup_seen` (control.js maybeFirstRun) and
// `trinityone.steward.wizard.done` (stew-dashboard.jsx finishWizard) — were "READ at the top of this file"
// and gave "the doors, at once and without a fetch". THAT WAS FALSE. `571abbf` removed the marker read on
// the owner's rule, 2026-09-23: *"the state of the box decides whether the card is retired, never which
// button was pressed."* The prose was left behind. MEASURED: the only localStorage this file touches is
// `suite.updDismissed` (two sites); it reads neither marker. Two independent reviewers flagged this comment
// within one session, each having first believed it — which is what a false comment costs.
//
// What actually happens, every time, with no fast path: /status.writePolicy is true iff this relay holds a church (public, no token), and
// /relay-names/mine.handle is the relay's name (via /local-token, which only a same-machine request gets — the
// Suite always is one). A church or a name → the doors: something was set up here, whatever storage says. Both
// absent AND no marker → the card. If either question cannot be answered at all — a network error, or a
// non-2xx on /status, /local-token or /relay-names/mine — the doors are shown: "first time here" is a claim,
// and a claim this page cannot back is worse than the two doors that were always here.
//
// A SLOW ANSWER IS NOT "NO" (AUDIT-suite-B4 N1). This used to give the box 2.5 s and then show the doors, and
// /relay-names/mine spawns the tailscale CLI up to three times (8 s + 6 s + 6 s budgets) before it will say
// what its `handle` is — so on a box where "Go public" was ever tried and tailscaled is now down, a genuine
// first run timed out into the two doors and the card was never seen (measured: 4 s fake tailscale → doors).
// So the page says "Checking this computer…" and waits for the answer, and only a box that cannot answer
// gets the doors.
//
// BUT WAITING IS NOT THE SAME AS NEVER DECIDING (AUDIT-round-a F1). `fetch` has no timeout of its own, so
// "wait for the answer" with nothing above it is a dead end: measured, a box that ACCEPTS /relay-names/mine
// and never answers it left this page on "Checking this computer…" — no card, no doors — still undecided
// after 45 000 ms, and a synchronous throw from the first `fetch` did the same. Neither is "a wedged box
// whose pages do not load either": in both measurements the launcher, its scripts and every other route
// loaded perfectly from the same box. Only one route failed.
//
// Hence the CEILING below, then the doors, whatever is or is not in flight. Not 2.5 s, because the slowest
// HONEST answer is the one N1 is about — /relay-names/mine calls tsState(), which spawns the tailscale CLI
// up to three times, and a ceiling at or under the sum of those budgets would send a box that WILL answer
// back to the doors. So the ceiling is not a number chosen here: it is that sum plus a stated margin, and
// the budgets are named in gateway.mjs (TS_STATE_BUDGETS_MS) so a test can hold the two together — without
// that, raising one budget quietly re-opened N1 with every test still green (AUDIT-round-c C1).
//
// It is armed BEFORE the fetches, as the old 2.5 s timer was, so it covers a throw as well as a stall; and
// the three calls are wrapped so that a synchronous throw from any of them reaches the doors at once rather
// than waiting the ceiling out (nothing is in flight to wait for).
//
// The doors are visible in the HTML and this hides them while it asks, so a script that never runs leaves
// the launcher with its doors; the ceiling is the same promise kept for a script that runs and never
// finishes. Never blank, either way (the splash lesson: this page must not be a dead end).
(function () {
  var card = document.getElementById('firstRun');
  var doors = document.getElementById('doors');
  var sub = document.getElementById('sub');
  var checking = document.getElementById('checking');
  if (!card || !doors) return;
  var decided = false;
  function show(which) {
    if (decided) return;
    decided = true;
    card.hidden = which !== 'card';
    doors.hidden = which !== 'doors';
    if (sub) sub.hidden = which !== 'doors';
    if (checking) checking.hidden = true;
    if (!window.__decidedAt) window.__decidedAt = performance.now() - (window.__t0 || 0);
    document.body.setAttribute('data-first-run', which);
  }
  doors.hidden = true; if (sub) sub.hidden = true;          // while asking; show() undoes it
  if (checking) checking.hidden = false;
  // THE CEILING IS DERIVED FROM tsState()'s OWN BUDGETS, AND A TEST FAILS IF THEY DRIFT APART.
  // FIRST_RUN_TS_BUDGET_MS must equal the sum of TS_STATE_BUDGETS_MS in scripts/gateway.mjs (8 s + 6 s +
  // 6 s): that is the slowest a box that WILL answer can take, so a ceiling at or under it sends that box
  // back to the doors (AUDIT-suite-B4 N1). The margin is what is left over for everything else on the
  // route; measured on the real pages, this page decides ~150 ms after the answer lands, and the true worst
  // case came in at 20 036 ms against a 25 000 ceiling. Raising a budget in gateway.mjs without raising
  // this reddens scripts/the-suite-first-run-is-one-guided-path.test.mjs (AUDIT-round-c C1) — it reads both
  // files, and it also measures the ceiling actually firing, so the numbers below cannot drift from the
  // timer they are here to set.
  var FIRST_RUN_TS_BUDGET_MS = 20000;
  var FIRST_RUN_CEILING_MARGIN_MS = 5000;
  var FIRST_RUN_CEILING_MS = FIRST_RUN_TS_BUDGET_MS + FIRST_RUN_CEILING_MARGIN_MS;
  var ceiling = setTimeout(function () { show('doors'); }, FIRST_RUN_CEILING_MS);   // armed first: it covers a throw too
  // Each question either answers (its JSON) or throws — a non-2xx is a throw, so Promise.all rejects on the
  // first question the box cannot answer and the doors are shown. Nothing here turns a failure into "no".
  try {
    var answered = function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
    var status = fetch('/status', { cache: 'no-store' }).then(answered);
    var named = fetch('/local-token', { cache: 'no-store' })
      .then(answered)
      .then(function (j) {
        if (!j || !j.token) throw new Error('no local token');
        return fetch('/relay-names/mine', { headers: { Authorization: 'Bearer ' + j.token }, cache: 'no-store' }).then(answered);
      });
    Promise.all([status, named]).then(function (res) {
      clearTimeout(ceiling);
      var s = res[0], nm = res[1];
      var hasChurch = !!s && s.writePolicy === true;
      var hasName = !!(nm && nm.handle);
      show(hasChurch || hasName ? 'doors' : 'card');
    }).catch(function () { clearTimeout(ceiling); show('doors'); });   // cannot tell → the doors, never a claim
  } catch (e) {                                              // fetch itself threw: nothing is in flight to wait for
    clearTimeout(ceiling); show('doors');
  }
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
// The `to_relay_setup_seen` marker is control.js's own — written there by maybeFirstRun() alone, from the
// box's own answers. This file neither writes it NOR READS IT (corrected 2026-09-27; it used to say this
// file read it as a fast path, which stopped being true at `571abbf`). The once-per-run `to_relay_setup_tried` marker existed only for the redirect and is gone with
// it.
