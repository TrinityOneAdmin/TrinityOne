// Register the offline service worker (caches the app shell; modules live in IndexedDB).
// Externalised from index.html/steward.html so the page needs no inline <script> — that lets the
// deployed CSP drop 'unsafe-inline' from script-src. Web PWA only: inside the Capacitor APK the
// native layer serves offline + routes module downloads through native HTTP, so a service worker is
// redundant and could interfere.
(function () {
  var _native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if ('serviceWorker' in navigator && !_native) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
