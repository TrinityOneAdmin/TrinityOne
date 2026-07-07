// UI smoke check — evaluated inside the running app's WebView (via CDP on Chromium/Android, or the
// WebKit inspector on iOS). Detects whether it's the member app or the steward console and verifies the
// NEW features shipped this cycle are PRESENT and the app booted clean. Returns a JSON string:
//   { app, booted, features:{...bool}, pass }
// `pass` = booted AND every core feature present. Pair with a separate "0 uncaught exceptions" check.
(() => {
  const fn = (o, m) => !!o && typeof o[m] === 'function';
  const F = window.Fellowship, S = window.Steward;
  // booted = the app actually rendered a DOM (count body elements — robust to a text-light splash/
  // onboarding screen, and to the app mounting outside #root).
  const out = { app: F ? 'member' : (S ? 'steward' : 'unknown'), booted: !!(document.body && document.body.querySelectorAll('*').length > 15), features: {} };
  if (F) {
    out.features.federation_read_adopt   = fn(F, 'subscribeChurchRelays');           // Phase 2
    out.features.federation_discovery     = fn(F, 'discoverRelayOffers') && fn(F, 'pickRelays'); // Phase 3b
    out.features.child_onboarding         = fn(F, 'createChildAccount');              // guardian/child fix
    out.features.audit_html_guards        = typeof window.safeCssColor === 'function' && typeof window.safeImgUrl === 'function';
    out.info_member_key = !!F.myPubkey;                                               // informational (may be pre-onboarding)
  }
  if (S) {
    out.features.federation_autopick      = fn(S, 'autoPickRelays');                  // Phase 3c
    out.features.federation_discovery     = fn(S, 'discoverRelayOffers') && fn(S, 'setDiscoverySeed');
    out.features.relay_list_publish       = fn(S, 'publishRelayList');                // Phase 1b (NIP-65)
    out.features.church_hook              = typeof window.useStewardChurch === 'function'; // banner-fade fix lives here
  }
  out.pass = out.booted && Object.keys(out.features).length > 0 && Object.values(out.features).every(Boolean);
  return JSON.stringify(out);
})()
