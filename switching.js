// switching.js — the "moving over" overlay on welcome.html.
//
// Extracted to its own file because the served pages run under a strict CSP: no inline <script>, no on*=
// attributes. Anything added here must stay in this file for the same reason.
//
// The move-over guide used to be a whole page (migrate.html), then an inline block on the leader section.
// Neither was right: it is reference material a leader reads ONCE, while deciding — so it interrupts the
// scroll for everyone who is not at that moment. An overlay you can read and dismiss keeps it one tap away
// without making every other reader scroll past it. Owner's call, 2026-08-06.
(function () {
  var openers = document.querySelectorAll('[data-switching-open]');
  var ov = document.getElementById('switching');
  if (!ov || !openers.length) return;
  var panel = ov.querySelector('.sw-panel');
  var closers = ov.querySelectorAll('[data-switching-close]');
  var lastFocus = null;

  function open(e) {
    if (e) e.preventDefault();
    lastFocus = document.activeElement;
    ov.classList.add('is-open');
    ov.setAttribute('aria-hidden', 'false');
    // Lock the page behind it, or the overlay scrolls the body underneath on iOS.
    document.body.style.overflow = 'hidden';
    var first = ov.querySelector('[data-switching-close]');
    if (first) first.focus();
  }
  function close(e) {
    if (e) e.preventDefault();
    ov.classList.remove('is-open');
    ov.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  for (var i = 0; i < openers.length; i++) openers[i].addEventListener('click', open);
  for (var j = 0; j < closers.length; j++) closers[j].addEventListener('click', close);
  // Click the backdrop to dismiss, but not a click inside the panel itself.
  ov.addEventListener('click', function (ev) { if (!panel.contains(ev.target)) close(ev); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && ov.classList.contains('is-open')) close(ev); });
})();
