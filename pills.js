// pills.js — the hero's feature pills swap the phone screenshot.
//
// Separate file because the served pages run a strict CSP: no inline <script>, no on*= attributes.
//
// TAP, not hover-only. Hover has no touch equivalent and phones are the main audience, so the pills are real
// buttons: click/tap selects, and hover is a bonus preview on pointers that have one. A pill with no
// data-shot is left alone entirely — there is no screen behind it yet, and showing an unrelated one would be
// a small lie in the exact place the page is claiming to show you the product.
//
// The images are real screens from a real phone (a seeded church, not a mock), all cropped to one aspect so
// the frame never jumps.
(function () {
  var wrap = document.querySelector('[data-pills]');
  var img = document.getElementById('appShot');
  if (!wrap || !img) return;
  var pills = [].slice.call(wrap.querySelectorAll('[data-shot]'));
  if (!pills.length) return;

  var base = img.getAttribute('src');
  var baseAlt = img.getAttribute('alt');
  var current = null;

  // Decode ahead of the first interaction so the swap is instant rather than a flash of nothing. Sequential,
  // not parallel: this is a thin-pipe product and eight images at once is exactly the burst we tell churches
  // we avoid.
  var queue = pills.map(function (p) { return p.getAttribute('data-shot'); });
  (function warm() {
    var src = queue.shift();
    if (!src) return;
    var i = new Image();
    i.onload = i.onerror = warm;
    i.src = src;
  })();

  function show(pill) {
    var src = pill.getAttribute('data-shot');
    if (!src || current === src) return;
    current = src;
    img.setAttribute('src', src);
    img.setAttribute('alt', 'The TrinityOne app — ' + (pill.getAttribute('data-label') || pill.textContent.trim()));
    pills.forEach(function (p) {
      var on = p === pill;
      p.classList.toggle('is-on', on);
      p.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    // "The Bible" carries a permanent emphasis (is-heart) as the resting state. Once something IS selected,
    // two highlighted pills read as two selections — so the resting emphasis stands down while a choice is
    // active, and comes back on reset.
    wrap.classList.add('has-selection');
    // On a narrow screen the hero stacks text-first, so the phone is BELOW the pills and off-screen — tap a
    // pill there and the only feedback is the pill itself while the thing it changed is out of sight. Bring
    // it into view when it isn't, and leave it alone when it is (no jumping on desktop, where both are
    // visible side by side).
    try {
      var r = img.getBoundingClientRect();
      var offscreen = r.bottom < 60 || r.top > (window.innerHeight || 0) - 60;
      if (offscreen && img.scrollIntoView) {
        var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        img.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
      }
    } catch (e) {}
  }
  function reset() {
    if (current === null) return;
    current = null;
    img.setAttribute('src', base);
    img.setAttribute('alt', baseAlt);
    pills.forEach(function (p) { p.classList.remove('is-on'); p.setAttribute('aria-pressed', 'false'); });
    wrap.classList.remove('has-selection');
  }

  pills.forEach(function (p) {
    p.setAttribute('role', 'button');
    p.setAttribute('tabindex', '0');
    p.setAttribute('aria-pressed', 'false');
    p.addEventListener('click', function () { current === p.getAttribute('data-shot') ? reset() : show(p); });
    p.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); current === p.getAttribute('data-shot') ? reset() : show(p); }
    });
    p.addEventListener('focus', function () { show(p); });
  });

  // Hover preview only where hovering is a real thing — on touch, `mouseenter` fires on tap and would fight
  // the click handler.
  if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    pills.forEach(function (p) { p.addEventListener('mouseenter', function () { show(p); }); });
  }
})();
