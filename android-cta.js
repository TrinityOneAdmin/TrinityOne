// android-cta.js — on an Android phone, point a Steward link at the Steward APK rather than the web console.
//
// ⚠ IT NO LONGER TOUCHES THE HERO "Start a church" BUTTON, and that is the 2026-09-01 decision, not a tidy-up
// (reference/DOMAIN.md, "The Suite is the path we push"). That button used to carry data-steward-cta, so on
// Android this script rewrote it into a Steward APK download — the one route the owner asked to make HARDER
// to reach, reached in one tap from the top of the page, before the reader had seen the Suite at all. The
// button now goes to #get on every device, where the Suite is the card that answers first.
// The attribute stays on the demoted Steward link below that section, where an Android visitor genuinely
// does want the app: the Suite is a desktop installer and cannot serve them.
//
// Carried over from welcome-churches.2.js when that page was folded into the single scroll (2026-08-06). Its
// two siblings, welcome.js and welcome.4.js, are NOT carried over: they were orphaned — no page loaded either
// of them, on any commit checked. (The 2026-08-05 marketing audit's D6 named all three as live CTA rewriters;
// only this one actually ran.)
//
// Separate file, not inlined, because the served pages run under a strict CSP: no inline <script>, no on*=.
//
// The APK path stays RELATIVE so it resolves on whichever host served the page — Cloudflare Pages, the
// gateway, or a church's own relay — rather than being pinned to one domain. Verified live: both
// trinityone.church and app.trinityone.church serve trinityone-steward.apk with the correct
// application/vnd.android.package-archive content type.
(function () {
  if (!/Android/i.test(navigator.userAgent || '')) return;
  var ctas = document.querySelectorAll('[data-steward-cta]');
  for (var i = 0; i < ctas.length; i++) {
    var a = ctas[i];
    a.href = './trinityone-steward.apk';
    a.setAttribute('download', '');
    if (/start a church/i.test(a.textContent || '')) a.textContent = 'Get the Steward app (Android)';
  }
})();
