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
  {
    name: 'safety: the main banner loses its narrowing caveat again',
    file: 'app/screens-today.jsx',
    // exactly what happened twice: route a narrowed send into the send-failure error string, which the
    // answered view does not render
    find: `setCollapsed(false); if (ok === 'narrow') setNarrow(true); }`,
    replace: `setCollapsed(false); if (ok === 'narrow') setErr('narrowed'); }`,
    test: 'scripts/safety-audience.test.mjs',
  },
  {
    name: 'relay: the scan budget is minted per request again',
    file: 'scripts/gateway.mjs',
    // the pre-fix shape: a fresh allowance for every REQ, so asking again costs nothing
    find: `      const _scanBudget = scanAllowance(ws);`,
    replace: `      const _scanBudget = { left: 300000 };`,
    test: 'scripts/relay-scan-budget.test.mjs',
  },
  {
    name: 'relay: a stranger gets a member-sized allowance',
    file: 'scripts/gateway.mjs',
    find: `const SCAN_ROWS_PER_SEC_ANON = 25000;`,
    replace: `const SCAN_ROWS_PER_SEC_ANON = 300000;`,
    test: 'scripts/relay-scan-budget.test.mjs',
  },
  {
    name: 'relay: the allowance never refills (a member locked out)',
    file: 'scripts/gateway.mjs',
    find: `  if (elapsed > 0) { rl.left = Math.min(cap, rl.left + Math.floor(elapsed / 1000 * cap)); rl.t = now; }`,
    replace: `  if (elapsed > 0) { rl.t = now; }`,
    test: 'scripts/relay-scan-budget.test.mjs',
  },
  {
    name: 'name key: published without checking it fits the church',
    file: 'src/steward.src.js',
    // the pre-fix shape: build one envelope at the full ring and hope the relay takes it
    find: `    for (let n = ring.length; n >= 1; n -= (n > 4 ? 2 : 1)) {`,
    replace: `    for (let n = ring.length; n >= ring.length; n -= (n > 4 ? 2 : 1)) {`,
    test: 'scripts/key-rotation-size.test.mjs',
  },
  {
    name: 'name key: sealed in one synchronous loop again (frozen console)',
    file: 'src/steward.src.js',
    find: `    const keys = await _sealEach(wrapped, recips, (pl, pk) => nip44e(pl, nip44ck(churchSk, pk)));`,
    replace: `    const keys = {}; for (const pk of recips) { try { keys[pk] = nip44e(wrapped, nip44ck(churchSk, pk)); } catch (e) {} }`,
    test: 'scripts/seal-yields.test.mjs',
  },
  {
    name: 'block: the name key is fired and forgotten again',
    file: 'app/stew-dashboard.jsx',
    find: `      if (!delegated && window.Steward.ensureNameKeyForMembers) rotations.push(Promise.resolve(window.Steward.ensureNameKeyForMembers(remaining, stewardRoster || [], { rotate: true })).then(r => ['the name key', r]));`,
    replace: `      if (!delegated && window.Steward.ensureNameKeyForMembers) window.Steward.ensureNameKeyForMembers(remaining, stewardRoster || [], { rotate: true });`,
    test: 'scripts/key-rotation-size.test.mjs',
  },
  {
    name: 'relay: AUTH carries the drained anonymous budget forward',
    file: 'scripts/gateway.mjs',
    // the pre-fix shape: the raise clamps instead of granting, so the post-AUTH replay starts starved
    find: `  if (rl.cap !== cap) { const raised = cap > rl.cap; rl.cap = cap; rl.left = raised ? cap : Math.min(Math.max(rl.left, 0), cap); }`,
    replace: `  if (rl.cap !== cap) { rl.cap = cap; rl.left = Math.min(Math.max(rl.left, 0), cap); }`,
    test: 'scripts/relay-scan-budget.test.mjs',
  },
  {
    name: 'profiles: a full cache silently loses everything again',
    file: 'src/fellowship.src.js',
    // the pre-fix write: one attempt, and the failure swallowed
    find: `    if (_writeProfiles(profiles)) return;`,
    replace: `    if (_writeProfiles(profiles)) return; return;`,
    test: 'scripts/profile-cache-quota.test.mjs',
  },
  {
    name: 'profiles: names are shed instead of photos',
    file: 'src/fellowship.src.js',
    find: `    for (const k of Object.keys(profiles)) { const v = profiles[k] || {}; lean[k] = { ...v, picture: '' }; }`,
    replace: `    for (const k of Object.keys(profiles)) { const v = profiles[k] || {}; lean[k] = { ...v, name: '' }; }`,
    test: 'scripts/profile-cache-quota.test.mjs',
  },
  {
    name: 'rotation: one envelope, refused silently on a big church',
    file: 'src/steward.src.js',
    find: `      if (per * want.length < 900000) { ring = cand; break; }`,
    replace: `      ring = cand; break;`,
    test: 'scripts/key-rotation-size.test.mjs',
  },
  {
    name: 'rotation: the console forgets to check whether it landed',
    file: 'app/stew-dashboard.jsx',
    // the pre-fix shape: fire it and walk away, so a refused rotation is never noticed
    find: `      if (window.Steward.rotateCareKey) rotations.push(Promise.resolve(window.Steward.rotateCareKey(remaining, stewardRoster || [])).then(r => ['the care key', r]));`,
    replace: `      if (window.Steward.rotateCareKey) window.Steward.rotateCareKey(remaining, stewardRoster || []);`,
    test: 'scripts/key-rotation-size.test.mjs',
  },
  {
    name: 'seal: the loop stops yielding (console freezes again)',
    file: 'src/steward.src.js',
    find: `      await new Promise(r => setTimeout(r, 0));`,
    replace: ``,
    count: 1,
    test: 'scripts/seal-yields.test.mjs',
  },
  {
    name: 'seal: one bad pubkey aborts the whole rotation',
    file: 'src/steward.src.js',
    find: `    try { keys[mp] = sealTo(payload, mp); } catch (e) {}`,
    replace: `    keys[mp] = sealTo(payload, mp);`,
    test: 'scripts/seal-yields.test.mjs',
  },
  {
    name: 'invite: the named slip stops prefilling the wizard',
    file: 'app/identity.jsx',
    find: `  const [name, setName] = useId(suggestedName || '');`,
    replace: `  const [name, setName] = useId('');`,
    test: 'scripts/named-invite.test.mjs',
  },
  {
    name: 'invite: the name is captured too late to be rendered',
    file: 'app/app.jsx',
    find: `  if (pendingNameRef.current === null) {`,
    replace: `  if (false) {`,
    test: 'scripts/named-invite.test.mjs',
  },
  {
    name: 'locked-out: the account code goes back behind the lock',
    file: 'app/identity.jsx',
    find: `          {lockedCode ? (`,
    replace: `          {false ? (`,
    test: 'scripts/locked-out-route.test.mjs',
  },
  {
    name: 'locked-out: lockedNpub reads a reference a locked boot lacks',
    file: 'src/identity.src.js',
    find: `      const hex = _recoveryReference();`,
    replace: `      const hex = (window.TrinityIdentity.current || {}).pubkey || '';`,
    test: 'scripts/locked-out-route.test.mjs',
  },
  {
    name: 'backup: the skip jumps straight past the words again',
    file: 'app/identity.jsx',
    find: `onClick={() => setConfirmSkip(true)}`,
    replace: `onClick={() => setStep(3)}`,
    count: 2,
    test: 'scripts/backup-skip-consent.test.mjs',
  },
  {
    name: 'backup: the PIN screen stops naming the words',
    file: 'app/identity.jsx',
    find: `{skippedWords ? 'If you forget it, your 12 words are the only way back — and you have not written those down yet.' : 'If you forget it, your 12 words will open this account again.'}`,
    replace: ``,
    test: 'scripts/backup-skip-consent.test.mjs',
  },
  {
    name: 'chat: an empty room goes blank again',
    file: 'app/screens-chat.jsx',
    find: `{visibleMsgs.length ? bubbles : (`,
    replace: `{true ? bubbles : (`,
    test: 'scripts/chat-empty-and-offline.test.mjs',
  },
  {
    name: 'chat: offline looks the same as quiet',
    file: 'app/screens-chat.jsx',
    find: `    {connected`,
    replace: `    {true`,
    test: 'scripts/chat-empty-and-offline.test.mjs',
  },
  {
    name: 'chat: group rows stop being operable',
    file: 'app/screens-chat.jsx',
    find: `role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }} `,
    replace: ``,
    count: 3,
    test: 'scripts/chat-empty-and-offline.test.mjs',
  },
  {
    name: 'join: a key-shaped code is shown as the church name',
    file: 'join.js',
    find: `  if (church && NAMEY.test(church) && !/^npub1|^nsec1|^[0-9a-f]{40,}$/i.test(church)) {`,
    replace: `  if (church) {`,
    test: 'scripts/join-page-honesty.test.mjs',
  },
  {
    name: 'join: a visitor with no invite is told they are invited',
    file: 'join.js',
    find: `  if (!follow && !church) {`,
    replace: `  if (false) {`,
    test: 'scripts/join-page-honesty.test.mjs',
  },
  {
    name: 'you-screen: the church you are in is unnamed again',
    file: 'app/identity.jsx',
    find: `{ctx.church && ctx.church.name ? (`,
    replace: `{false ? (`,
    test: 'scripts/church-is-named.test.mjs',
  },
  {
    name: 'join: the name pattern is a literal again (dead page on an old phone)',
    file: 'join.js',
    find: `  try { NAMEY = new RegExp("^[\\\\p{L}\\\\p{N} .,'\u2019&()\\\\-]{2,48}$", 'u'); }`,
    replace: `  try { NAMEY = /^[\\p{L}\\p{N} .,'\u2019&()\\-]{2,48}$/u; }`,
    test: 'scripts/join-page-honesty.test.mjs',
  },
  {
    name: 'chat: an empty room cries offline before it has connected',
    file: 'app/screens-chat.jsx',
    find: `            {connected || !settled`,
    replace: `            {connected`,
    test: 'scripts/chat-empty-and-offline.test.mjs',
  },
  {
    name: 'offline: reachability answers from a memory of a connection',
    file: 'src/fellowship.src.js',
    // the pre-fix shape: authenticated once, therefore "reachable" for ever
    find: `  relayReady() { return !!_relayAuthedAt && window.Fellowship.relaysHealthy(); },`,
    replace: `  relayReady() { return !!_relayAuthedAt; },`,
    test: 'scripts/chat-empty-and-offline.test.mjs',
  },
  {
    name: 'encryption: the room stops stating it is unencrypted',
    file: 'app/screens-chat.jsx',
    find: `: 'Not encrypted'}</span>`,
    replace: `: 'Church room'}</span>`,
    test: 'scripts/no-overclaims.test.mjs',
  },
  {
    name: 'encryption: the Help explanation of a readable room is dropped',
    file: 'app/help-data.jsx',
    // the plausible drift: not a deletion, a SOFTENING — the awkward half of the sentence rewritten into
    // reassurance, which is how an honest disclosure usually dies
    find: `the server that carries your church\u2019s messages can read what is written there`,
    replace: `your church\u2019s messages are carried safely`,
    test: 'scripts/no-overclaims.test.mjs',
  },
  {
    name: 'encryption: the label goes back to the steward\u2019s setting',
    file: 'app/screens-chat.jsx',
    find: `{encState === 'sealed' ? 'End-to-end encrypted' : encState === 'nokey' ? 'Encrypted \u00b7 no key yet' : 'Not encrypted'}`,
    replace: `{group && group.encrypted ? 'End-to-end encrypted' : 'Not encrypted'}`,
    test: 'scripts/group-encryption-honesty.test.mjs',
  },
  {
    name: 'encryption: a member with no key sends in clear again',
    file: 'src/fellowship.src.js',
    find: `    if (wantsEnc && !gkey) return { _refused: 'nokey' };`,
    replace: ``,
    test: 'scripts/group-encryption-honesty.test.mjs',
  },
  {
    name: 'encryption: a failed seal is swallowed and sent unencrypted',
    file: 'src/fellowship.src.js',
    find: `        if (wantsEnc) return { _refused: 'sealfailed' };`,
    replace: ``,
    test: 'scripts/group-encryption-honesty.test.mjs',
  },
  {
    name: 'encryption: the room key rotation is fired and forgotten again',
    file: 'app/stew-dashboard.jsx',
    find: `        if (window.Steward.publishGroupKey) rotations.push(Promise.resolve(window.Steward.publishGroupKey(g.id, recips, { rotate: true })).then(r => ['the key for ' + (g.name || 'a group'), r]));`,
    replace: `        if (window.Steward.publishGroupKey) window.Steward.publishGroupKey(g.id, recips, { rotate: true });`,
    test: 'scripts/group-encryption-honesty.test.mjs',
  },
  {
    name: 'offline: a refused message is promised a fix that cannot come',
    file: 'app/screens-chat.jsx',
    // Anchored on the SHORTEST stable fragment, not the whole sentence: this case went NO-ANCHOR the moment
    // the copy around it was reworded, and a dead case is a guard that quietly stopped guarding.
    find: `send them once you\u2019re back online.`,
    replace: `It should sort itself out shortly.`,
    test: 'scripts/group-encryption-honesty.test.mjs',
  },
  {
    name: 'encryption: the room requirement is decided as "never"',
    file: 'src/fellowship.src.js',
    // The auditor's mutation, verbatim in spirit: reinstate the original defect by making the decision say
    // no. This is a SEMANTIC mutation — the earlier cases each deleted the exact literal their test grepped
    // for, which proves the regex matches and nothing else.
    find: `  if (hint === true) return true;
  const g = _groupDoc(groupId);
  return !!(g && g.encrypted);`,
    replace: `  return false;`,
    test: 'scripts/group-encryption-honesty.test.mjs',
  },
  {
    name: 'encryption: the caller\u2019s knowledge is thrown away (cache only)',
    file: 'src/fellowship.src.js',
    find: `  if (hint === true) return true;
  const g = _groupDoc(groupId);`,
    replace: `  const g = _groupDoc(groupId);`,
    test: 'scripts/group-encryption-honesty.test.mjs',
  },
  {
    name: 'encryption: a caller can talk the send into cleartext',
    file: 'src/fellowship.src.js',
    find: `  if (hint === true) return true;`,
    replace: `  if (hint === true) return true;
  if (hint === false) return false;`,
    test: 'scripts/group-encryption-honesty.test.mjs',
  },
  {
    name: 'share: a refused share is reported as shared',
    file: 'app/screens-chat.jsx',
    find: `        if (evt && evt._refused) { ctx.toast('Not shared \u2014 ' + g.name + ' is encrypted and your key hasn\u2019t arrived yet. Try again shortly.'); return; }`,
    replace: ``,
    test: 'scripts/group-encryption-honesty.test.mjs',
  },
  {
    name: 'relay-url: a trailing slash makes a live church unreachable',
    file: 'src/fellowship.src.js',
    // the pre-fix shape: compare the URL exactly as stored against a map keyed by the normalised form
    find: `        try { if (st.get(normalizeURL(url)) === true) return true; } catch (e) {}`,
    replace: ``,
    test: 'scripts/chat-empty-and-offline.test.mjs',
  },
  {
    name: 'name key: two publishes can overlap again',
    file: 'src/steward.src.js',
    find: `    while (_nameKeyBusy) { try { await _nameKeyBusy; } catch (e) { break; } }`,
    replace: ``,
    test: 'scripts/key-rotation-size.test.mjs',
  },
  {
    name: 'group key: a member we cannot seal to is skipped silently again',
    file: 'src/steward.src.js',
    find: `        catch (e) { missed.push(pk); }`,
    replace: `        catch (e) {}`,
    test: 'scripts/group-key-ring.test.mjs',
  },
  {
    name: 'group key: a room is marked keyed even when nothing was published',
    file: 'app/stew-dashboard.jsx',
    find: `            if (r === null || r === false) return;                       // not keyed \u2014 leave \`last\` alone so we come back`,
    replace: ``,
    test: 'scripts/group-key-ring.test.mjs',
  },
  {
    name: 'encryption: the refusal is disabled while the literal stays put',
    file: 'src/fellowship.src.js',
    // The re-audit's attack, verbatim: keep every grepped string exactly where it is and neuter the decision.
    // Both original leaks come back — a keyless member publishes plaintext under an "End-to-end encrypted"
    // label, and a thrown seal falls through to cleartext — and before the EXECUTED tests were written this
    // left all 19 guards in group-encryption-honesty.test.mjs green.
    find: `    const wantsEnc = _wantsEncrypted(groupId, opts.encrypted);`,
    replace: `    const wantsEnc = _wantsEncrypted(groupId, opts.encrypted) && false;`,
    test: 'scripts/group-encryption-honesty.test.mjs',
  },
  {
    name: 'encryption: the send stops honouring the caller\u2019s knowledge',
    file: 'src/fellowship.src.js',
    find: `    const wantsEnc = _wantsEncrypted(groupId, opts.encrypted);`,
    replace: `    const wantsEnc = _wantsEncrypted(groupId, undefined);`,
    test: 'scripts/group-encryption-honesty.test.mjs',
  },
  {
    name: 'seal: the flag publish moves back above the key publish',
    file: 'src/steward.src.js',
    // the plausible "optimisation": start the doc write first so the UI updates sooner — which recreates the
    // dead room, because a refused key now lands AFTER the room is already flagged encrypted
    find: `    let r = null;
    try { r = await window.Steward.publishGroupKey(group.id, memberPubs); } catch (e) { r = null; }
    // no usable envelope on the relay → the group doc is never touched; the room stays honestly cleartext
    if (r === null || r === false) return { sealed: false, reason: r === null ? 'cannot-key' : 'relay-refused' };
    const ok = await window.Steward.publishGroup({ ...group, encrypted: true });`,
    replace: `    const ok = await window.Steward.publishGroup({ ...group, encrypted: true });
    let r = null;
    try { r = await window.Steward.publishGroupKey(group.id, memberPubs); } catch (e) { r = null; }
    // no usable envelope on the relay → the group doc is never touched; the room stays honestly cleartext
    if (r === null || r === false) return { sealed: false, reason: r === null ? 'cannot-key' : 'relay-refused' };`,
    test: 'scripts/seal-sequencing.test.mjs',
  },
  {
    name: 'seal: the careless boolean that can never refuse',
    file: 'src/steward.src.js',
    // `||` to `&&` — r can't be null AND false, so every key failure sails through to the flag publish
    find: `    if (r === null || r === false) return { sealed: false, reason: r === null ? 'cannot-key' : 'relay-refused' };`,
    replace: `    if (r === null && r === false) return { sealed: false, reason: r === null ? 'cannot-key' : 'relay-refused' };`,
    test: 'scripts/seal-sequencing.test.mjs',
  },
  {
    name: 'seal: doSeal goes back to fire-and-forget',
    file: 'app/stew-dashboard.jsx',
    // the revert: publish flag and key side by side, read neither result, assume success
    find: `    let r = null;
    try { r = await window.Steward.sealGroup(s.g, recipsFor(s.g)); } catch (e) { r = null; }`,
    replace: `    window.Steward.publishGroup({ ...s.g, encrypted: s.on });
    if (window.Steward.publishGroupKey) window.Steward.publishGroupKey(s.g.id, recipsFor(s.g));
    let r = { sealed: true, skipped: [] };`,
    test: 'scripts/seal-sequencing.test.mjs',
  },
  {
    name: 'distributor: the in-flight guard is "simplified" away',
    file: 'app/stew-dashboard.jsx',
    find: `          if (pending.current[g.id]) continue;
`,
    replace: ``,
    test: 'scripts/group-key-ring.test.mjs',
  },
  {
    name: 'distributor: the roster is recorded as done before the publish resolves',
    file: 'app/stew-dashboard.jsx',
    // the exact pre-branch shape: advance `last` optimistically, so a failed publish is never retried and
    // the member who joined in that window has no key, for good
    find: `          pending.current[g.id] = true;
          Promise.resolve(window.Steward.publishGroupKey(g.id, recips, { reuseOnly: true })).then(r => {`,
    replace: `          pending.current[g.id] = true;
          last.current[g.id] = key;
          Promise.resolve(window.Steward.publishGroupKey(g.id, recips, { reuseOnly: true })).then(r => {`,
    test: 'scripts/group-key-ring.test.mjs',
  },
  {
    name: 'distributor: the backoff comparison points the wrong way',
    file: 'app/stew-dashboard.jsx',
    find: `          if (Date.now() < (nextTry.current[g.id] || 0)) continue;`,
    replace: `          if (Date.now() > (nextTry.current[g.id] || 0)) continue;`,
    test: 'scripts/group-key-ring.test.mjs',
  },
  {
    name: 'blocklist: the local set updates only after the relay confirms',
    file: 'src/steward.src.js',
    // semantically "the same code, later" — but the whole point is the window BEFORE the publish resolves,
    // which is exactly when the roster effect re-keys the person just blocked
    find: `    _localBlocked = new Set(list.map(p => String(p).toLowerCase()));
    const content = JSON.stringify({ pubkeys: list });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', BLOCKED_D + pub], ['t', NET]], content }, sk));`,
    replace: `    const content = JSON.stringify({ pubkeys: list });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', BLOCKED_D + pub], ['t', NET]], content }, sk))
      .then(r => { _localBlocked = new Set(list.map(p => String(p).toLowerCase())); return r; });`,
    test: 'scripts/name-key-integrity.test.mjs',
  },
  {
    name: 'blocklist: only `want` is filtered, the grow-path re-add returns',
    file: 'src/steward.src.js',
    // the subtle half-fix: `want` is already clean, so the union "must be fine" — but Object.keys(have) is
    // the OLD envelope's recipient map and still contains the person just blocked
    find: `    const recips = (opts.rotate ? want : [...new Set([...want, ...Object.keys(have)])])
      .filter(p => !_localBlocked.has(String(p).toLowerCase()));`,
    replace: `    const recips = opts.rotate ? want : [...new Set([...want, ...Object.keys(have)])];`,
    test: 'scripts/name-key-integrity.test.mjs',
  },
  {
    name: 'fnBody: a call-shaped anchor silently widens again',
    file: 'scripts/test-slice.mjs',
    // Restores the pre-fix behaviour: nothing checks what sits between the balanced `)` and the chosen `{`,
    // so anchoring on a CALL slices into the next construct \u2014 the overshoot that made the sw.js install
    // slice contain the whole activate handler. The paren walk stays; only the refusal is removed, so every
    // string any other test greps for stays put.
    find: `    const between = stripComments(src.slice(end + 1, open)).trim();
    assert.ok(between === '' || between === '=>',
      \`\${what} looks like a call, not a definition \u2014 anchor the function itself \` +
      \`(found \${JSON.stringify(between.slice(0, 40))} between its ')' and '{')\`);`,
    replace: ``,
    test: 'scripts/test-slice.test.mjs',
  },
  {
    name: 'calendar: an event is written in the clear again',
    file: 'src/steward.src.js',
    // anchored on the inner fragment, not the whole indented block: these helpers were moved to module
    // scope mid-change and the indentation shifted, which is exactly how a case goes NO-ANCHOR
    find: `JSON.stringify({ e: nip44e(body, _unhex(k)) })`,
    replace: `body`,
    test: 'scripts/church-calendar-sealed.test.mjs',
  },
  {
    name: 'calendar: a member drops what it cannot open, so nothing is on',
    file: 'src/fellowship.src.js',
    find: `          if (c === null) { byId.set(id, { id, _locked: true, ts: e.created_at, _by: e.pubkey }); emit(); return; }`,
    replace: `          if (c === null) { return; }`,
    test: 'scripts/church-calendar-sealed.test.mjs',
  },
  {
    name: 'calendar: a rotation hides the church\u2019s own past gatherings',
    file: 'src/steward.src.js',
    find: `for (const k of _nameKeyRing) { try { return JSON.parse(nip44d(ct, _unhex(k))); } catch (e) {} }`,
    replace: `try { return JSON.parse(nip44d(ct, _unhex(_nameKeyRing[0]))); } catch (e) {}`,
    test: 'scripts/church-calendar-sealed.test.mjs',
  },
  {
    name: 'care team: the Groups tab stops writing the roster',
    file: 'app/stew-dashboard.jsx',
    // the pre-fix behaviour exactly: publish the allowlist, leave the team's roster where it was. This is the
    // St Brigid's shape — group members 2, roster people 0, care team empty and nothing said so.
    find: `        Promise.resolve(window.Steward.publishRoster(group.id, { roles: r.roles || [], people, pods: r.pods || [] }))
          .then(() => publishCareTeamFor(group.id, careTeamId, people))
          .catch(() => {});`,
    replace: `        return;`,
    test: 'scripts/care-team-membership.test.mjs',
  },
  {
    name: 'care team: an allowlist edit wipes the off-app volunteers',
    file: 'app/stew-schedule.jsx',
    // the plausible careless version — "the allowlist IS the team", forgetting that a volunteer with no app
    // account is in no allowlist and would be deleted from the rota by an edit that never mentioned them
    find: `  const kept = had.filter(p => p && !(p.pub && gone.has(p.pub)));`,
    replace: `  const kept = had.filter(p => p && p.pub && !gone.has(p.pub));`,
    test: 'scripts/care-team-membership.test.mjs',
  },
  {
    name: 'care team: a reconciled person gets a fresh id, emptying every pod slot',
    file: 'app/stew-schedule.jsx',
    find: `  const have = new Set(kept.map(p => p && p.pub).filter(Boolean));
  const fresh = [...new Set((added || []).filter(Boolean))].filter(pk => !have.has(pk)).map(pk => {`,
    replace: `  const have = new Set();
  const fresh = [...new Set((added || []).filter(Boolean))].filter(pk => !have.has(pk)).map(pk => {`,
    test: 'scripts/care-team-membership.test.mjs',
  },
  {
    name: 'care team: careteam: no longer follows the team it names',
    file: 'app/stew-schedule.jsx',
    find: `    await publishCareTeamFor(t.id, careTeamId, people);`,
    replace: ``,
    test: 'scripts/care-team-membership.test.mjs',
  },
  {
    name: 'care team: the empty-team warning counts names with no key again',
    file: 'app/stew-meals.jsx',
    // the exact pre-fix condition. A care team of three off-app names reads as staffed, while careAdmin and
    // careteam: — both keyed on pubkeys — have nobody.
    find: `  const teamLinked = teamPeople.filter(p => p && p.pub);`,
    replace: `  const teamLinked = teamPeople;`,
    test: 'scripts/care-team-membership.test.mjs',
  },
  {
    name: 'chat: an open room stops re-subscribing after a drop',
    file: 'app/screens-chat.jsx',
    // the pre-fix deps exactly — the room is opened once and never re-opened, so a signal blip leaves it deaf
    find: `  }, [group, ctx.connTick]);`,
    replace: `  }, [group]);`,
    test: 'scripts/chat-reconnect.test.mjs',
  },
  {
    name: 'chat: the Community list stops re-subscribing after a drop',
    file: 'app/screens-chat.jsx',
    find: `  }, [groupIdsKey, ctx.connTick]);`,
    replace: `  }, [groupIdsKey]);`,
    test: 'scripts/chat-reconnect.test.mjs',
  },
  {
    name: 'chat: a reconnect wipes the thread the member is reading',
    file: 'app/screens-chat.jsx',
    // the careless version of the same fix: re-subscribe, but keep the old unconditional reset
    find: `      const sameRoom = seenRef.current && seenRef.current.gid === group.id;`,
    replace: `      const sameRoom = false;`,
    test: 'scripts/chat-reconnect.test.mjs',
  },
  {
    name: 'chat: nothing notices the socket came back',
    file: 'src/fellowship.src.js',
    // removing the whole handler puts the app back where it was: healthy socket, dead subscriptions, and a
    // 90-second safety net that skips because relaysHealthy() is (correctly) true
    find: `    if (prev === undefined || prev === live) return;   // first sight, or the same socket we already knew
    window.dispatchEvent(new CustomEvent('trinity-relay-returned', { detail: { url } }));`,
    replace: ``,
    test: 'scripts/chat-reconnect.test.mjs',
  },
  {
    name: 'chat: every read counts as a reconnect (the url-keyed version)',
    file: 'src/fellowship.src.js',
    // the plausible wrong fix — key on the url instead of the live relay instance. nostr-tools calls this from
    // its subscribe path on EVERY subscription, so this re-subscribes the whole app on every ordinary read.
    find: `    if (prev === undefined || prev === live) return;   // first sight, or the same socket we already knew`,
    replace: `    if (prev === undefined) return;`,
    test: 'scripts/chat-reconnect.test.mjs',
  },
  {
    name: 'restore: Back drops a settled member into new-account setup',
    file: 'app/identity.jsx',
    // the pre-fix behaviour exactly — one exit for both entrances, so the settings one falls into the wizard
    find: `    if (initialRestore) { if (onSkip) onSkip(); return; }   // came from Settings → close, don't fall into setup`,
    replace: ``,
    test: 'scripts/restore-exit-route.test.mjs',
  },
  {
    name: 'restore: Back closes the whole wizard on first run too',
    file: 'app/identity.jsx',
    // over-correcting the other way: always close, which on first run leaves nothing behind the pane
    find: `    if (initialRestore) { if (onSkip) onSkip(); return; }   // came from Settings → close, don't fall into setup
    setRestoring(false);`,
    replace: `    if (onSkip) onSkip();`,
    test: 'scripts/restore-exit-route.test.mjs',
  },
  {
    name: 'backup: the WebView anchor claims success again',
    file: 'app/backup.jsx',
    // the pre-fix behaviour: an <a download> the WebView cannot perform, reported as saved
    find: `      if (isNative) throw new Error('This app can\u2019t write the file here. Update the app, or use \u201cSave to device\u201d.');`,
    replace: ``,
    test: 'scripts/backup-saves-somewhere.test.mjs',
  },
  {
    name: 'backup: the default path goes back to share-sheet-only',
    file: 'app/backup.jsx',
    // the exact shape it had: a CACHE copy Android may delete, and nothing durable
    find: `      const w = await P.Filesystem.writeFile({ path: filename, data: text, directory: 'DOCUMENTS', encoding: 'utf8' });
      if (mode !== 'local' && P.Share) {`,
    replace: `      const w = await P.Filesystem.writeFile({ path: filename, data: text, directory: mode === 'local' ? 'DOCUMENTS' : 'CACHE', encoding: 'utf8' });
      if (mode !== 'local' && P.Share) {`,
    test: 'scripts/backup-saves-somewhere.test.mjs',
  },
  {
    name: 'backup: a dismissed share sheet fails the whole save',
    file: 'app/backup.jsx',
    // dropping the try/catch: closing the sheet then throws away a file that IS already written
    find: `        try {
          const c = await P.Filesystem.writeFile({ path: filename, data: text, directory: 'CACHE', encoding: 'utf8' });
          await P.Share.share({ title: 'TrinityOne backup', text: 'Save this somewhere safe (Drive, OneDrive\u2026)', url: c.uri });
        } catch (e) {}`,
    replace: `        const c = await P.Filesystem.writeFile({ path: filename, data: text, directory: 'CACHE', encoding: 'utf8' });
        await P.Share.share({ title: 'TrinityOne backup', text: 'Save this somewhere safe (Drive, OneDrive\u2026)', url: c.uri });`,
    test: 'scripts/backup-saves-somewhere.test.mjs',
  },
  {
    name: 'review: the roster write blocks the group-key rotation again',
    file: 'app/stew-dashboard.jsx',
    // the shape this branch shipped with before the pre-merge review: reconcile inside the chain, ahead of
    // the rotation, so a throw there leaves a removed member still holding the room's key
    find: `      .then(() => { if (group.encrypted && window.Steward.publishGroupKey) return window.Steward.publishGroupKey(group.id, newM, { rotate: removed }); })`,
    replace: `      .then(() => reconcileRoster())
      .then(() => { if (group.encrypted && window.Steward.publishGroupKey) return window.Steward.publishGroupKey(group.id, newM, { rotate: removed }); })`,
    test: 'scripts/care-team-membership.test.mjs',
  },
  {
    name: 'review: the roster save can be double-clicked again',
    file: 'app/stew-schedule.jsx',
    find: `    if (saving) return;
    setSaving(true);`,
    replace: ``,
    test: 'scripts/care-team-membership.test.mjs',
  },
  {
    name: 'review: a returning socket forces a full rebuild per relay',
    file: 'app/app.jsx',
    // routing an advisory, per-relay signal through the mandatory gate — the storm the scheduler exists to stop
    find: `    const onRelayReturned = () => { sched.fire(false); };`,
    replace: `    const onRelayReturned = () => { sched.force(); };`,
    test: 'scripts/chat-reconnect.test.mjs',
  },
  {
    name: 'restore: the file route disappears from the chooser again',
    file: 'app/identity.jsx',
    find: `          <button onClick={() => { setRErr(''); setRMode('file'); }}`,
    replace: `          <button onClick={() => { setRErr(''); setRMode('words'); }}`,
    test: 'scripts/restore-from-file.test.mjs',
  },
  {
    name: 'restore: the password is asked for before the file is looked at',
    file: 'app/identity.jsx',
    // the shape every other restore path still had: prompt first, read later
    find: `          {rFile ? (
            <React.Fragment>`,
    replace: `          {true ? (
            <React.Fragment>`,
    test: 'scripts/restore-from-file.test.mjs',
  },
  {
    name: 'restore: every new member is warned their account will be replaced',
    file: 'app/identity.jsx',
    // dropping the "has it actually been used?" half — the app mints a key before the welcome fork, so this
    // puts a destructive warning in front of someone who has never opened the app
    find: `    if (used && standing === 'different' && !rReplaceOk && consented !== true) {`,
    replace: `    if (standing === 'different' && !rReplaceOk && consented !== true) {`,
    test: 'scripts/restore-from-file.test.mjs',
  },
];
