// The mutations scripts/sabotage.mjs applies. Each one REMOVES a fix; the named test must go red.
//
// A case here is a claim of the form "if someone deleted this fix, THIS test would catch it". If the test
// stays green under the mutation, the runner reports BLIND GUARD — the fix may be perfectly correct, but
// nothing is watching it, which is the state that let ten defects ship green on 2026-08-07.
//
// Keep the mutation MINIMAL and REALISTIC: it should look like a plausible careless edit or revert, not like
// deliberate vandalism. `find` must be unique in the file unless `count` says otherwise.
export const CASES = [
  {
    name: 'remember-me: ownership check removed',
    file: 'src/identity.src.js',
    // the exact shape of the pre-fix code: trust any live record
    find: `  const owner = encOwnerPub();
  if (!owner || !rec.pub || String(rec.pub).toLowerCase() !== String(owner).toLowerCase()) {
    await rememberClear();
    return null;
  }
  return rec.m;`,
    replace: `  return rec.m;`,
    test: 'scripts/remember-account-binding.test.mjs',
  },
  {
    name: 'remember-me: fails OPEN when the owner is unknown',
    file: 'src/identity.src.js',
    // the subtle version — still checks, but treats "cannot prove it" as "fine", which is how every device
    // whose PIN predates the binding would behave
    find: `  if (!owner || !rec.pub || String(rec.pub).toLowerCase() !== String(owner).toLowerCase()) {`,
    replace: `  if (owner && rec.pub && String(rec.pub).toLowerCase() !== String(owner).toLowerCase()) {`,
    test: 'scripts/remember-account-binding.test.mjs',
  },
  {
    name: 'remember-me: record stops carrying its account',
    file: 'src/identity.src.js',
    find: `  const payload = JSON.stringify({ m, until, pub: deriveProfile(m).pubkey });`,
    replace: `  const payload = JSON.stringify({ m, until });`,
    test: 'scripts/remember-account-binding.test.mjs',
  },
  {
    name: 'remember-me: expiry no longer enforced on read',
    file: 'src/identity.src.js',
    find: `    if (o.until <= nowSec()) { await rememberClear(); return null; }`,
    replace: `    if (false) { await rememberClear(); return null; }`,
    test: 'scripts/remember-account-binding.test.mjs',
  },
  {
    name: 'boot-key: interrupted write reported as "no key"',
    file: 'src/steward.src.js',
    // the pre-fix behaviour: nothing consults the breadcrumb, so the console offers "Set up a new church"
    find: `  if (lsGet(ENC_PENDING_LS)) return 'interrupted';   // a key may be in the store with its marker unwritten`,
    replace: ``,
    test: 'scripts/console-boot-key-state.test.mjs',
  },
  {
    name: 'boot-key: a stale crumb outranks a settled key',
    file: 'src/steward.src.js',
    // the plausible careless ordering — checking the unsettled case before the settled one, which would put a
    // device that demonstrably HAS a key onto the interrupted path
    find: `  if (lsGet(ENC_LS)) return 'locked';                // settled: a key is here, PIN-locked
  if (lsGet(ENC_PENDING_LS)) return 'interrupted';   // a key may be in the store with its marker unwritten`,
    replace: `  if (lsGet(ENC_PENDING_LS)) return 'interrupted';
  if (lsGet(ENC_LS)) return 'locked';`,
    test: 'scripts/console-boot-key-state.test.mjs',
  },
  {
    name: 'boot-key: the plaintext migration path is skipped',
    file: 'src/steward.src.js',
    find: `  if (lsGet(KEY_LS)) return 'plaintext';             // legacy seed on disk — load it and force a PIN`,
    replace: ``,
    test: 'scripts/console-boot-key-state.test.mjs',
  },
];
