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
  {
    name: 'guardians: unknown map read as "no parents"',
    file: 'src/steward.src.js',
    // the pre-fix behaviour: an absent map becomes an empty list for every child
    find: `  if (!Array.isArray(wantG)) return false;`,
    replace: `  if (!Array.isArray(wantG)) wantG = [];`,
    test: 'scripts/guardians-unknown.test.mjs',
  },
  {
    name: 'guardians: a removed parent stops reaching the child',
    file: 'src/steward.src.js',
    // over-correcting the other way — never write guardians at all, so unlinkParent goes nowhere
    find: `  if (!Array.isArray(gotG)) return !!wantG.length;`,
    replace: `  if (!Array.isArray(gotG)) return false;`,
    test: 'scripts/guardians-unknown.test.mjs',
  },
  {
    name: 'guardians: order treated as a change (churn on every pass)',
    file: 'src/steward.src.js',
    find: `  const a = gotG.slice().sort(), b = wantG.slice().sort();`,
    replace: `  const a = gotG.slice(), b = wantG.slice();`,
    test: 'scripts/guardians-unknown.test.mjs',
  },
  {
    name: 'safety: a failed audience lookup reported as a full send',
    file: 'src/fellowship.src.js',
    // the pre-fix behaviour: "could not read the team" and "there is no team" collapse into one answer
    find: `  return { readers: clean, narrowed: !Array.isArray(group) };`,
    replace: `  return { readers: clean, narrowed: false };`,
    test: 'scripts/safety-audience-narrowing.test.mjs',
  },
  {
    name: 'safety: every church without a care team warned needlessly',
    file: 'src/fellowship.src.js',
    // the over-correction: a church that genuinely has no team is told the send was degraded
    find: `  return { readers: clean, narrowed: !Array.isArray(group) };`,
    replace: `  return { readers: clean, narrowed: !(Array.isArray(group) && group.length) };`,
    test: 'scripts/safety-audience-narrowing.test.mjs',
  },
  {
    name: 'safety: the church key stops being an unconditional reader',
    file: 'src/fellowship.src.js',
    find: `  const readers = [cp];`,
    replace: `  const readers = [];`,
    test: 'scripts/safety-audience-narrowing.test.mjs',
  },
  {
    name: 'safety: an unreadable care roster reads as an empty one',
    file: 'src/fellowship.src.js',
    find: `    } catch (e) { return null; }   // could not READ the roster — not the same as a church with nobody on it`,
    replace: `    } catch (e) { return []; }`,
    test: 'scripts/safety-audience-narrowing.test.mjs',
  },
  {
    name: 'recovery: a locked device loses its only reference',
    file: 'src/identity.src.js',
    // the pre-fix behaviour: only the reference apply() writes, which a locked boot never runs
    find: `  if (!have) { try { have = encOwnerPub() || ''; } catch (e) {} }`,
    replace: ``,
    test: 'scripts/recovery-reference.test.mjs',
  },
  {
    name: 'recovery: no reference is treated as "must be fine"',
    file: 'src/identity.src.js',
    // the dangerous over-correction: answer something so the comparison always runs
    find: `  return have;
}`,
    replace: `  return have || 'unknown';
}`,
    test: 'scripts/recovery-reference.test.mjs',
  },
  {
    name: 'guardians: loaded stops waiting for a complete answer',
    file: 'src/steward.src.js',
    // the pre-fix semantics: the minors doc alone licenses the back-fill, so it can run against a guardian
    // map that has not arrived — which is what emptied children's parent lists
    find: `    const isLoaded = () => sawMinors && sawEose;`,
    replace: `    const isLoaded = () => sawMinors;`,
    test: 'scripts/relay-clearance.test.mjs',
  },
  {
    name: 'guardians: the map stops riding the safeguard subscription',
    file: 'src/steward.src.js',
    // drop the whole branch — that is what a revert would look like, and it is what the document-count and
    // owner-only assertions in steward-newest-wins actually measure
    find: `        else if (d === GUARDIANS_D + pub) { if (!_byChurch(e)) return; if (e.created_at < tGuardians) return; tGuardians = e.created_at; try { guardians = (JSON.parse(e.content).links) || {}; } catch { guardians = {}; } onLists({ minors, approved, nophoto, guardians, loaded: isLoaded() }); }`,
    replace: ``,
    test: 'scripts/steward-newest-wins.test.mjs',
  },
  {
    name: 'console: only the write path announces (the removal dead end)',
    file: 'src/steward.src.js',
    // the pre-fix shape: the announce sits inside the adopt path instead of wrapping every exit
    find: `      window.dispatchEvent(new CustomEvent('steward-key'));`,
    replace: ``,
    test: 'scripts/console-legacy-breadcrumb.test.mjs',
  },
  {
    name: 'console: an unreadable keystore silently clears the lock',
    file: 'src/steward.src.js',
    // the dangerous over-correction: treat "could not read" as "there is no key", which offers to create one
    // over a church key that may still be present
    find: `      if (_encResumeStuck) {`,
    replace: `      if (false) {`,
    test: 'scripts/console-legacy-breadcrumb.test.mjs',
  },
  {
    name: 'safety: silence from an unproven relay read as "no team"',
    file: 'src/fellowship.src.js',
    // the pre-fix behaviour: only a THROW counted as failure, and the real pool resolves with [] instead
    find: `    if (!_relayAuthedAt) return null;`,
    replace: ``,
    test: 'scripts/safety-audience-narrowing.test.mjs',
  },
];
