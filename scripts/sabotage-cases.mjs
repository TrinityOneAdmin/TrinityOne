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
    const content = JSON.stringify({ pubkeys: list });`,
    replace: `    const content = JSON.stringify({ pubkeys: list });
    const _localBlocked = new Set(list.map(p => String(p).toLowerCase()));  // MOVED after the content build, still before publish — but the sabotage is that it is no longer set SYNCHRONOUSLY where the roster effect reads it`,
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
    find: `      try { w = await P.Filesystem.writeFile({ path: filename, data: text, directory: 'DOCUMENTS', encoding: 'utf8' }); }`,
    replace: `      try { w = mode === 'local' ? await P.Filesystem.writeFile({ path: filename, data: text, directory: 'DOCUMENTS', encoding: 'utf8' }) : null; }`,
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
  {
    name: 'restore: the screen promises four words the app never issued',
    file: 'app/identity.jsx',
    // the copy this branch shipped before a simulated member walked into it
    find: `                Whatever you chose when you made this backup. If you wrote down several words, type them with
                spaces between.`,
    replace: `                The four words you wrote down when you made the backup — spaces between them.`,
    test: 'scripts/restore-from-file.test.mjs',
  },
  {
    name: 'backup: an old phone gets no fallback and no warning',
    file: 'app/backup.jsx',
    // the shape before option (a): one DOCUMENTS write, and if the OS refuses it the member simply gets an
    // error — on the file that holds their account, and on the one that holds the church key
    find: `      let w = null;
      try { w = await P.Filesystem.writeFile({ path: filename, data: text, directory: 'DOCUMENTS', encoding: 'utf8' }); }
      catch (e) { w = null; }`,
    replace: `      const w = await P.Filesystem.writeFile({ path: filename, data: text, directory: 'DOCUMENTS', encoding: 'utf8' });`,
    test: 'scripts/backup-saves-somewhere.test.mjs',
  },
  {
    name: 'crash: the member app mounts unprotected again',
    file: 'app/app.jsx',
    find: `  <TrinityErrorBoundary><App /></TrinityErrorBoundary>`,
    replace: `  <App />`,
    test: 'scripts/render-crash-boundary.test.mjs',
  },
  {
    name: 'crash: the console mounts unprotected again',
    file: 'app/steward-root.jsx',
    find: `  <TrinityErrorBoundary><StewardRoot /></TrinityErrorBoundary>`,
    replace: `  <StewardRoot />`,
    test: 'scripts/render-crash-boundary.test.mjs',
  },
  {
    name: 'crash: the detail stops being written down',
    file: 'app/error-boundary.jsx',
    find: `      localStorage.setItem('trinityone.lastcrash', JSON.stringify({`,
    replace: `      ({}).nothing = JSON.stringify({`,
    test: 'scripts/render-crash-boundary.test.mjs',
  },
  {
    name: 'second church: starter groups collide again',
    file: 'app/steward-root.jsx',
    // the fixed-id form — the first church on the relay owns announce/men/women/youth/prayer for ever
    find: `      (window.SK.groups || []).forEach(g => window.Steward.publishGroup({ id: nsp ? (nsp + '-' + g.id) : g.id, name: g.name, kind: g.kind, sub: SEED_SUB[g.id] || '' }));`,
    replace: `      (window.SK.groups || []).forEach(g => window.Steward.publishGroup({ id: g.id, name: g.name, kind: g.kind, sub: SEED_SUB[g.id] || '' }));`,
    test: 'scripts/second-church-on-a-relay.test.mjs',
  },
  {
    name: 'second church: a refused registration goes quiet again',
    file: 'src/steward.src.js',
    find: `    if (ownRefused) {`,
    replace: `    if (false) {`,
    test: 'scripts/second-church-on-a-relay.test.mjs',
  },
  {
    name: 'safeguarding: a child may publish an event again',
    file: 'scripts/gateway.mjs',
    find: `        if (minorOf(e.pubkey, owner)) return false;`,
    replace: `        if (false) return false;`,
    test: 'scripts/event-permission-tiers.test.mjs',
  },
  {
    name: 'safeguarding: an uncleared adult may post into a child-safe group again',
    file: 'scripts/gateway.mjs',
    find: `        if (GROUP_CHILDSAFE.has(g) && !approvedIn(e.pubkey, owner)) return false;`,
    replace: `        if (false) return false;`,
    test: 'scripts/event-permission-tiers.test.mjs',
  },
  {
    name: 'event tiers: an absent policy opens the group to everyone',
    file: 'scripts/gateway.mjs',
    find: `        const policy = GROUP_EVENTPOLICY.get(g) || 'leaders';`,
    replace: `        const policy = GROUP_EVENTPOLICY.get(g) || 'everyone';`,
    test: 'scripts/event-permission-tiers.test.mjs',
  },
  {
    name: 'event tiers: the client hides what the relay accepts',
    file: 'src/fellowship.src.js',
    find: `  return policy === 'everyone';`,
    replace: `  return false;`,
    test: 'scripts/event-permission-tiers.test.mjs',
  },
  {
    name: 'calendar: the name key stops re-opening the calendar',
    file: 'src/fellowship.src.js',
    find: `        _replayChurchCalendar(cp, hub);`,
    replace: `        void 0;`,
    test: 'scripts/calendar-unlocks-on-key.test.mjs',
  },
  {
    name: 'group events: the sheet opens behind the chat again',
    file: 'app/screens-serving.jsx',
    find: `    <BottomSheet open={open} onClose={onClose} z={70}>`,
    replace: `    <BottomSheet open={open} onClose={onClose}>`,
    test: 'scripts/event-sheet-above-chat.test.mjs',
  },
  {
    name: 'event tiers: the chat screen drops the permission fields again',
    file: 'app/screens-chat.jsx',
    find: `          eventPolicy: g.eventPolicy, leaders: g.leaders, memberPubs: Array.isArray(g.members) ? g.members : null,`,
    replace: `          memberPubs: Array.isArray(g.members) ? g.members : null,`,
    test: 'scripts/event-permission-tiers.test.mjs',
  },
  {
    name: 'chat: the 12-word check becomes a dead end again',
    file: 'app/screens-help-main.jsx',
    find: `                const show = solved;`,
    replace: `                const show = picked != null;`,
    test: 'scripts/chat-parity-and-retry.test.mjs',
  },
  {
    name: 'chat: direct messages get their own reaction set again',
    file: 'app/screens-chat.jsx',
    find: `  const DM_EMOJI = REACT_EMOJIS;`,
    replace: `  const DM_EMOJI = ['\u2764\ufe0f', '\ud83d\ude4f'];`,
    test: 'scripts/chat-parity-and-retry.test.mjs',
  },
  {
    name: 'chat: a DM reply leaks into a public tag',
    file: 'src/fellowship.src.js',
    find: `    const body = window.Fellowship._dmWrap(content, replyTo);`,
    replace: `    const body = content;`,
    test: 'scripts/chat-parity-and-retry.test.mjs',
  },
  {
    name: 'jsx: a literal \\uXXXX escape returns to a member-facing string',
    file: 'app/screens-serving.jsx',
    find: `you can\u2019t open yet.</b>`,
    replace: `you can\\u2019t open yet.</b>`,
    test: 'scripts/no-literal-escapes-in-jsx.test.mjs',
  },
  {
    name: 'restore: the display name is dropped from the backup again',
    file: 'app/backup.jsx',
    find: `  const MEMBER_EXACT = ['trinityone.profile'];`,
    replace: `  const MEMBER_EXACT = [];`,
    test: 'scripts/rejoin-name-and-leaving.test.mjs',
  },
  {
    name: 'restore: the exact list becomes a prefix, sweeping in the church directory',
    file: 'app/backup.jsx',
    find: `      if (k && (ex.has(k) || prefixes.some(p => k.startsWith(p)))) out[k] = localStorage.getItem(k);`,
    replace: `      if (k && ([...ex].some(p => k.startsWith(p)) || prefixes.some(p => k.startsWith(p)))) out[k] = localStorage.getItem(k);`,
    test: 'scripts/rejoin-name-and-leaving.test.mjs',
  },
  {
    name: 'join: apostrophes are rejected again, so a church cannot be typed',
    file: 'app/screens-church.jsx',
    find: `  const joinable = hasNpub || /^@?[a-z0-9._,'’&()\\- ]{2,}(@[a-z0-9.-]+)?$/i.test(code.trim());`,
    replace: `  const joinable = hasNpub || /^@?[a-z0-9._\\- ]{2,}(@[a-z0-9.-]+)?$/i.test(code.trim());`,
    test: 'scripts/rejoin-name-and-leaving.test.mjs',
  },
  {
    name: 'console: enrolment stops catching up after an unlock',
    file: 'app/stew-dashboard.jsx',
    find: `    window.addEventListener('steward-key', onKey);`,
    replace: `    void onKey;`,
    test: 'scripts/rejoin-name-and-leaving.test.mjs',
  },
  {
    name: 'relay: a co-tenant can claim another church\'s namespaced id again',
    file: 'scripts/gateway.mjs',
    find: `    const named = idNamesOwner(id);`,
    replace: `    const named = '';`,
    test: 'scripts/relay-divergent-safeguarding.test.mjs',
  },
  {
    name: 'relay: the minor gate stops resolving the church from the id',
    file: 'scripts/gateway.mjs',
    find: `const gcp = GROUP_CHURCH.get(g) || idNamesOwner(g); const m = gcp && MINORS_BY.get(gcp); if (m && m.has(e.pubkey)) return false; }`,
    replace: `const gcp = GROUP_CHURCH.get(g); const m = gcp && MINORS_BY.get(gcp); if (m && m.has(e.pubkey)) return false; }`,
    test: 'scripts/relay-divergent-safeguarding.test.mjs',
  },
  {
    name: 'relay: the READ gate stops resolving the church from the id',
    file: 'scripts/gateway.mjs',
    find: `    const gcp = GROUP_CHURCH.get(g) || idNamesOwner(g);   // …and the same fallback here: see the note in accept()`,
    replace: `    const gcp = GROUP_CHURCH.get(g);`,
    test: 'scripts/relay-divergent-safeguarding.test.mjs',
  },
  {
    name: 'safeguarding: the minors list goes back to single-accept publishing',
    file: 'src/steward.src.js',
    find: `    return _publishToRelays(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MINORS_D + pub], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, sk));`,
    replace: `    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MINORS_D + pub], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, sk));`,
    test: 'scripts/safeguarding-replicates.test.mjs',
  },
  {
    name: 'safeguarding: a partial write reports success again',
    file: 'src/steward.src.js',
    find: `  return accepted === targets.length ? evt : false;`,
    replace: `  return accepted ? evt : false;`,
    test: 'scripts/safeguarding-replicates.test.mjs',
  },
  {
    name: 'privacy: /status leaks the congregation size to strangers again',
    file: 'scripts/gateway.mjs',
    find: `      ...(adminOK(req) ? { counts: { churches: CHURCH_PUBS.size, members: MEMBERS.size, broadcastGroups: BROADCAST.size, events: store.count(), connections: wss ? wss.clients.size : 0 } } : {}),`,
    replace: `      counts: { churches: CHURCH_PUBS.size, members: MEMBERS.size, broadcastGroups: BROADCAST.size, events: store.count(), connections: wss ? wss.clients.size : 0 },`,
    test: 'scripts/status-hides-congregation-size.test.mjs',
  },
  {
    name: 'relays: the console stops publishing to the shared public pool',
    file: 'src/steward.src.js',
    find: `  for (const r of CANONICAL_RELAYS) { if (r && !out.includes(r)) out.push(r); }
  for (const r of extraRelays()) { if (r && r !== own && !out.includes(r)) out.push(r); }`,
    replace: `  if (own === CANONICAL_RELAY) { for (const r of CANONICAL_RELAYS) { if (r && !out.includes(r)) out.push(r); } }
  for (const r of extraRelays()) { if (r && r !== own && !out.includes(r)) out.push(r); }`,
    test: 'scripts/relays-always-canonical.test.mjs',
  },
  {
    name: 'care: a withdrawn request deletes on the tap again',
    file: 'app/screens-today.jsx',
    find: `onClick={() => setConfirming(true)} disabled={busy} title="Withdraw this request"`,
    replace: `onClick={async () => { setBusy(true); try { await onCancel(); } catch (e) {} setBusy(false); }} disabled={busy} title="Withdraw this request"`,
    test: 'scripts/care-withdraw-confirms.test.mjs',
  },
  {
    name: 'care: a filled meal day offers a second signup again',
    file: 'app/screens-today.jsx',
    find: `                    : fills.length
                    ? <span style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={12} color="var(--sage)" /> Covered</span>
                    : <button onClick={() => care.fill(need.id, iso)} style={careBtnHelp}>I’ll help</button>)}`,
    replace: `                    : <button onClick={() => care.fill(need.id, iso)} style={careBtnHelp}>I’ll help</button>)}`,
    test: 'scripts/care-rota-and-rsvp.test.mjs',
  },
  {
    name: 'events: a recurring RSVP no longer says it covers every date',
    file: 'app/screens-serving.jsx',
    find: `  const isSeries = !!(e && (e.recurring || e.seriesDate));`,
    replace: `  const isSeries = false;`,
    test: 'scripts/care-rota-and-rsvp.test.mjs',
  },

  // ── closed-network plan C3: is this relay one of ours? ────────────────────────────────────────────────
  // Each of these is one of the ways the plan says answering this question goes wrong, expressed as the
  // careless edit that would cause it. Each takes exactly ONE test red, which is the reassuring shape: an
  // all-red run means the harness died, not that the guard is sharp.
  {
    name: 'relay-net: membership matched on URL instead of pubkey',
    file: 'src/relay-net.src.js',
    // A church's relay behind a free tunnel gets a new address on every restart, so this drops that church's
    // own box every time it reboots — and only ever shows up on a relay that has actually moved.
    find: `String(e.pubkey || '').toLowerCase() === provenPub`,
    replace: `String(e.url || '') === url`,
    test: 'scripts/is-this-relay-one-of-ours.test.mjs',
  },
  {
    name: 'relay-net: enrolment enumerates the FILTERED relay list',
    file: 'src/steward.src.js',
    // The bootstrap deadlock. relays()/ownRelay() consult the _boxHostsUs cache, so a box recorded as "not
    // hosting us" is invisible to the only code that could ever sign it in — permanently.
    find: `  const o = _ownOrigin();`,
    replace: `  const o = ''; for (const u of relays()) add(u);`,
    test: 'scripts/is-this-relay-one-of-ours.test.mjs',
  },
  {
    name: 'relay-net: the same-origin root skips the possession proof',
    file: 'src/relay-net.src.js',
    // Same-origin is a reason not to ask a SECOND question, never a reason to skip the first: without the
    // proof, any host answering on the page's origin is admitted.
    find: `  let proof = null;`,
    replace: `  if (sameOriginRelay(url, d.origin)) return { root: 'origin', pub: 'f'.repeat(64) };
  let proof = null;`,
    test: 'scripts/is-this-relay-one-of-ours.test.mjs',
  },
  {
    name: 'relay-net: an unfinished MEMBERSHIP read is treated as an empty church',
    file: 'src/steward.src.js',
    // A timed-out read comes back empty, and empty is indistinguishable from "this church has signed
    // nothing" — so the writer would build a document from scratch and un-admit every box already in it.
    find: `  if (!mine && !complete) return { published: false, entries: [], proven: [], unproven: [], seeded: 0, unknown: true };
`,
    replace: ``,
    test: 'scripts/is-this-relay-one-of-ours.test.mjs',
  },
  {
    name: 'relay-net: an unfinished SEED read is treated as no old relay list',
    file: 'src/steward.src.js',
    // The sibling guard, and it needs its own case: the seed runs ONCE, so a timed-out read of the old sync
    // list means those boxes are never carried across and nothing ever tries again.
    find: `    if (!oldComplete) return { published: false, entries: [], proven: [], unproven: [], seeded: 0, unknown: true };
`,
    replace: ``,
    test: 'scripts/is-this-relay-one-of-ours.test.mjs',
  },
  {
    name: 'relay-net: the canonical pin is one value, not a list',
    file: 'src/relay-net.src.js',
    // A single pin makes a planned key rotation a fleet-wide outage; this project has rotated a relay key
    // under incident before.
    find: `if (canonicalPinsFor(url, d.pins).includes(provenPub)) return { root: 'canonical', pub: provenPub };`,
    replace: `if (canonicalPinsFor(url, d.pins)[0] === provenPub) return { root: 'canonical', pub: provenPub };`,
    test: 'scripts/is-this-relay-one-of-ours.test.mjs',
  },

  // ── C4: the gate. Each of these is a careless edit somebody could plausibly make while "tidying" the
  // filter, and each one takes exactly one test red. An all-red run means the harness died.
  {
    name: 'relay-gate: the console publishes over the RAW list',
    file: 'src/steward.src.js',
    // The whole leak, back in one character of difference: the assembled list is the candidate list, and
    // publishing over it sends the church's documents to every address anyone ever typed.
    find: `  const _targets = relays();`,
    replace: `  const _targets = relaysRaw();`,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  {
    name: 'relay-gate: relays() stops filtering and just returns the candidates',
    file: 'src/steward.src.js',
    find: `function relays() { try { return _gate.admit(relaysRaw(), pub); } catch (e) { return []; } }`,
    replace: `function relays() { return relaysRaw(); }`,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  {
    name: 'relay-gate: the member app publishes over the list it was handed',
    file: 'src/fellowship.src.js',
    // _publishAny is the last line of the gate: thirty callers hand it lists they assembled themselves, and
    // without this every one of them is a way round the filter.
    find: `  const targets = _netRelays(candidates);`,
    replace: `  const targets = candidates;`,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  {
    name: 'relay-gate: the filter runs BEFORE the never-empty guard instead of after it',
    file: 'src/steward.src.js',
    // §5-bis's collision, staged: gate the candidate sources and let the guard re-insert the canonical pool
    // afterwards, unverified. It reads like a tightening and is the exact opposite.
    find: `function relays() { try { return _gate.admit(relaysRaw(), pub); } catch (e) { return []; } }`,
    replace: `function relays() {
  try { const out = _gate.admit([ownRelay(), ...extraRelays()], pub); for (const r of CANONICAL_RELAYS) if (r && !out.includes(r)) out.push(r); return out; } catch (e) { return []; }
}`,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  {
    name: 'relay-gate: the membership read goes through the gate it feeds (the read-side deadlock)',
    file: 'src/steward.src.js',
    // A church's own box holds the only copy of the signature that admits it. Read that over the filtered
    // list and the box is excluded, therefore never asked, therefore never admitted — for ever.
    find: `    const sub = pool.subscribeMany(relaysRaw(), filters, {`,
    replace: `    const sub = pool.subscribeMany(relays(), filters, {`,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  {
    name: 'relay-gate: the member\'s membership read goes through the gate it feeds',
    file: 'src/fellowship.src.js',
    find: `    const evs = await pool.querySync(churchRelaysRaw(), [{ kinds: [30078], authors: [cp], '#d': [RELAY_NET_D] }]);`,
    replace: `    const evs = await pool.querySync(churchRelays(), [{ kinds: [30078], authors: [cp], '#d': [RELAY_NET_D] }]);`,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  {
    name: 'relay-gate: a care request that went nowhere is reported as a plain failure',
    file: 'src/fellowship.src.js',
    // The label half. `null` already reads as not-sent — as "check your connection", on a connection that is
    // fine — which sends somebody asking for help to look in the wrong place entirely.
    find: `      if (isNoNetworkRelay(e)) return { error: 'no-network-relay' };
`,
    replace: ``,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  {
    name: 'relay-gate: a gate refusal burns one of the outbox\'s retries',
    file: 'src/fellowship.src.js',
    // Nothing reached a relay, so nothing should be counted. Counting it drops a member's words after ~37
    // minutes of retrying against a set that was empty the whole time.
    find: `const outage = errs.length && errs.every(e => isConnectionFailure(e) || isNoNetworkRelay(e));`,
    replace: `const outage = errs.length && errs.every(isConnectionFailure);`,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  {
    name: 'relay-gate: the cache keeps an address that now answers with a different key',
    file: 'src/relay-net.src.js',
    find: `  return { root: '', pub: provenPub };`,
    replace: `  return no;`,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  {
    name: 'relay-gate: one church\'s signature admits a relay for every church on the device',
    file: 'src/relay-net.src.js',
    find: `  if (!e.cp) return true;                 // canonical / same-origin: church-independent
  return !cp || e.cp === String(cp).toLowerCase();`,
    replace: `  return true;`,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  {
    name: 'relay-gate: the verified set is never persisted',
    file: 'src/relay-net.src.js',
    find: `  const map = readVerified(d.store);`,
    replace: `  const map = new Map();`,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  {
    name: 'relay-gate: the cache is keyed by the raw URL, not the normalised one',
    file: 'src/relay-net.src.js',
    // memory: relay-url-normalisation-trap. The pool keys its connections by normalizeURL(); a raw compare
    // that differs only by a trailing slash misses SILENTLY, and the gate then misses the relay it is about.
    find: `function _relayKey(url) { try { return normalizeURL(String(url || '')); } catch { return String(url || ''); } }`,
    replace: `function _relayKey(url) { return String(url || ''); }`,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  {
    name: 'relay-gate: an empty publish set is reported as health',
    file: 'src/fellowship.src.js',
    // A `true` here DISABLES the app's 90-second safety net, so a church whose relays have not proved
    // themselves would sit quietly for ever with nothing recovering it.
    find: `      if (!want.length) return !churchRelaysRaw().length;`,
    replace: `      if (!want.length) return true;`,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  {
    name: 'relay-gate: the relay panel is fed the publish set, so a dropped address vanishes',
    file: 'src/steward.src.js',
    // Silently changing where a church's data goes is how the ROADMAP-NOTES §6 divergence became invisible.
    find: `    return Promise.all(relaysRaw().map(url => new Promise(res => {`,
    replace: `    return Promise.all(relays().map(url => new Promise(res => {`,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  {
    name: 'relay-gate: the member Relays sheet is told every address is in use',
    file: 'src/fellowship.src.js',
    find: `  relayVerified(url) { try { return _gate.admits(url, window.Fellowship.churchPub); } catch (e) { return false; } },`,
    replace: `  relayVerified(url) { return true; },`,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  {
    name: 'relay-gate: an empty publish set hangs every read instead of answering',
    file: 'src/fellowship.src.js',
    // The gate's own side effect. Until C4 no list reaching the pool could be empty; now one can, and
    // nostr-tools never settles a querySync([]) or delivers an oneose for a subscribeMany([], …).
    find: `  if (u.length) return _poolSubMany(u, filters, handlers);`,
    replace: `  if (true) return _poolSubMany(u, filters, handlers);`,
    test: 'scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs',
  },
  // ── C5: the paths by which an address is PUSHED at a client ──────────────────────────────────────────
  {
    name: 'invite: ?relay= is adopted on sight again',
    file: 'src/fellowship.src.js',
    // The pre-C5 behaviour exactly: a wss:// scheme check and nothing else, so a code taped to a wall adds a
    // relay to a member's set before they have followed anything.
    find: `      try { ok = await isNetworkRelay(cp, url); } catch (e) { ok = false; }`,
    replace: `      ok = true;`,
    test: 'scripts/an-invite-cannot-choose-your-relay.test.mjs',
  },
  {
    name: 'invite: the name is resolved even when the printed address worked (AUDIT-2026-07-29 S3 reopened)',
    file: 'src/fellowship.src.js',
    // The self-hosted congregation's joiner tells the shared directory that this device exists, that it is
    // joining now, and which relay it is looking for — the one request that undoes self-hosting.
    find: `    if (got) return out;
`,
    replace: ``,
    test: 'scripts/an-invite-cannot-choose-your-relay.test.mjs',
  },
  {
    name: 'invite: the screen adopts the relay itself instead of routing it through the gate',
    file: 'app/app.jsx',
    // The one-line deletion CLAUDE.md rule 1 exists for: the engine keeps all eight of its tests and the
    // screen stops consulting it.
    find: `      if (F.adoptInviteRelays) { try { F.adoptInviteRelays(npub, raw); } catch (e) {} }`,
    replace: `      const rm = String(raw || '').match(/[?&]relay=([^&\\s]+)/);
      if (rm) { try { const relay = decodeURIComponent(rm[1]); if (/^wss:\\/\\//i.test(relay)) F.addRelay(relay); } catch (e) {} }`,
    test: 'scripts/an-invite-cannot-choose-your-relay.test.mjs',
  },
  {
    name: 'named relays: the 90-second swap stops re-verifying',
    file: 'src/steward.src.js',
    // The most under-appreciated path in the codebase: it runs on load, then every 90 seconds, then on every
    // window focus, for ever, with no user action after the first connect.
    find: `      if (!(await admitRemoteRelay(newUrl))) continue;
`,
    replace: ``,
    test: 'scripts/an-invite-cannot-choose-your-relay.test.mjs',
  },
  {
    name: 'console resolver: takes whatever scheme the directory answers with',
    file: 'src/steward.src.js',
    // L5, which the member-side twin has had since 2026-07-06 and this one never did.
    find: `      if (!j || typeof j.url !== 'string' || !/^wss:\\/\\//i.test(j.url)) continue;`,
    replace: `      if (!j || typeof j.url !== 'string') continue;`,
    test: 'scripts/an-invite-cannot-choose-your-relay.test.mjs',
  },
  {
    name: 'console resolver: a proof is enough, membership no longer asked',
    file: 'src/steward.src.js',
    // The subtle version — still verifies, but only that SOMETHING TrinityOne-shaped is there, which is the
    // question C2 answers and not the one C3 does.
    find: `      if (memberToo ? !(await admitRemoteRelay(j.url)) : !(await verifyRelayIdentity(j.url))) continue;`,
    replace: `      if (!(await verifyRelayIdentity(j.url))) continue;`,
    test: 'scripts/an-invite-cannot-choose-your-relay.test.mjs',
  },
  {
    name: 'auto-find: offers are no longer filtered to relays the church vouched for',
    file: 'src/steward.src.js',
    // Back to a well-behaved stranger being adopted because it behaved well — the behavioural probe promoted
    // into a membership gate, which is AUDIT-2026-07-27 happening a second time.
    find: `    if (!(await admitRemoteRelay(url))) return null;
`,
    replace: ``,
    test: 'scripts/an-invite-cannot-choose-your-relay.test.mjs',
  },
  {
    name: 'clone: the SOURCE is required to be a member (migration inverted in time)',
    file: 'src/steward.src.js',
    // THE DEFECT THAT MUST NOT SHIP. It reads as a tightening and it breaks the only thing this control is
    // for: a church vouches for the box it is ARRIVING at, never the one it is escaping.
    find: `    if (!(await verifyRelayIdentity(srcRelay)))`,
    replace: `    if (!(await admitRemoteRelay(srcRelay)))`,
    test: 'scripts/an-invite-cannot-choose-your-relay.test.mjs',
  },
  {
    name: 'clone: the SOURCE is not asked to prove anything',
    file: 'src/steward.src.js',
    find: `    if (!(await verifyRelayIdentity(srcRelay)))
      throw new Error('That relay could not prove who it is, so your church’s history was not requested from it. Check the address, or restore from a backup file instead.');`,
    replace: ``,
    test: 'scripts/an-invite-cannot-choose-your-relay.test.mjs',
  },
  {
    name: 'clone: the DESTINATION takes the whole corpus without being in the network',
    file: 'src/steward.src.js',
    find: `    if (!(await admitRemoteRelay(dstRelay)))
      throw new Error('The destination relay isn’t in your church’s network, so nothing was copied to it. Add it to your relay list and enrol it first.');`,
    replace: ``,
    test: 'scripts/an-invite-cannot-choose-your-relay.test.mjs',
  },
  {
    name: 'backup: a restore file carries the member’s relay list again',
    file: 'app/backup.jsx',
    find: `'trinityone.onboarded', 'trinityone.dark'`,
    replace: `'trinityone.onboarded', 'trinityone.relays', 'trinityone.dark'`,
    test: 'scripts/backup-file-safety.test.mjs',
  },
  {
    name: 'backup: the console’s routing keys are exported again',
    file: 'app/backup.jsx',
    find: `      if (k && !ROUTING_KEYS.has(k) && (ex.has(k) || prefixes.some(p => k.startsWith(p)))) out[k] = localStorage.getItem(k);`,
    replace: `      if (k && (ex.has(k) || prefixes.some(p => k.startsWith(p)))) out[k] = localStorage.getItem(k);`,
    test: 'scripts/backup-file-safety.test.mjs',
  },
  {
    name: 'backup: a crafted file can write the console’s routing keys again',
    file: 'app/backup.jsx',
    find: `      && !ROUTING_KEYS.has(String(k))                // never where a church's data goes — see ROUTING_KEYS
`,
    replace: ``,
    test: 'scripts/backup-file-safety.test.mjs',
  },
  {
    name: 'relay-gate: relay-net is served only to members, so a newcomer can never bootstrap',
    file: 'scripts/gateway.mjs',
    find: `    if (d === RELAY_NET_D) return true;
`,
    replace: ``,
    test: 'scripts/doc-registry.test.mjs',
  },
  // C4 F2 — the all-relays writer's empty-target return. SCOPED, because publish() twenty lines above now
  // holds a near-identical block and a plain string-replace would hit IT: `const reason = relaysRaw().length`
  // occurs twice in the file. Every anchor below carries the `all-relay` warn line, which occurs once.
  {
    name: 'no-relay: the all-relays writer goes back to failing in silence',
    file: 'src/steward.src.js',
    // exactly the pre-fix line — the whole surface removed, which is the revert somebody would actually make
    find: `  if (!targets.length) {
    const reason = relaysRaw().length
      ? NO_NETWORK_RELAY + ': none of this church\\'s relays could be proved to be ours, so nothing was published'
      : 'no relay is configured for this church';
    console.warn('[steward] all-relay publish blocked —', reason);
    try { window.dispatchEvent(new CustomEvent('steward-publish-error', { detail: { reason, evt } })); } catch (x) {}
    return false;
  }`,
    replace: `  if (!targets.length) return false;`,
    test: 'scripts/a-console-write-with-no-relay-is-not-silent.test.mjs',
  },
  {
    name: 'no-relay: the reason loses the prefix that tells a bad relay from a bad connection',
    file: 'src/steward.src.js',
    // the subtle version — the banner still appears, so the screen test stays green; only the REASON is gone,
    // which is the whole of degraded-set honesty. A steward is sent to look at broadband that is working.
    find: `    const reason = relaysRaw().length
      ? NO_NETWORK_RELAY + ': none of this church\\'s relays could be proved to be ours, so nothing was published'
      : 'no relay is configured for this church';
    console.warn('[steward] all-relay publish blocked —', reason);`,
    replace: `    const reason = 'nothing was published';
    console.warn('[steward] all-relay publish blocked —', reason);`,
    test: 'scripts/a-console-write-with-no-relay-is-not-silent.test.mjs',
  },
  {
    name: 'no-relay: setBlocked loses the trusted-view guard that stands in front of the silence',
    file: 'src/steward.src.js',
    // The reason the blocklist is NOT the sharpest case here. Drop this and a ban over an empty publish set
    // stops refusing and starts writing into the void — which is what the fix above then has to catch.
    find: `    _requireTrustedView('blocked list');
`,
    replace: ``,
    test: 'scripts/a-console-write-with-no-relay-is-not-silent.test.mjs',
  },
  // ── AUDIT 2026-09-02: a relay must declare where it answers, and the update must check ──
  {
    name: 'declared-addresses: the loopback-only warning never fires',
    file: 'scripts/gateway.mjs',
    // the plausible slip — an inverted condition, so the one box that needs telling is the one box that is not told
    find: `    if (!pub.length && !_loopbackOnlyOptIn()) {`,
    replace: `    if (pub.length && !_loopbackOnlyOptIn()) {`,
    test: 'scripts/a-relay-declares-where-it-answers.test.mjs',
  },
  {
    name: 'declared-addresses: the loopback-only opt-in is ignored',
    file: 'scripts/gateway.mjs',
    // every correct LAN box now prints a fleet-outage warning on every launch, which is how a warning stops being read
    find: `  if (/^(1|true|yes|on)$/i.test(String(process.env.RELAY_LOOPBACK_ONLY || '').trim())) return true;`,
    replace: `  if (false) return true;`,
    test: 'scripts/a-relay-declares-where-it-answers.test.mjs',
  },
  {
    name: 'declared-addresses: loopback counts as a public address',
    file: 'scripts/gateway.mjs',
    // the exact shape of the original defect — a box with no road to the outside world looks configured, because it declares itself
    find: `    if (!k || _loopbackKeys.has(k) || seen.has(k)) continue;`,
    replace: `    if (!k || seen.has(k)) continue;`,
    test: 'scripts/relay-declared-address-probe.test.mjs',
  },
  {
    name: 'relay-update: an address that answers nothing is accepted',
    file: 'scripts/relay-update.sh',
    // the guard runs, dials, and then ignores what came back
    find: `    if [ "$code" != "200" ]; then`,
    replace: `    if [ "$code" = "999" ]; then`,
    test: 'scripts/relay-declared-address-probe.test.mjs',
  },
  {
    name: 'relay-update: a proof naming someone else is accepted',
    file: 'scripts/relay-update.sh',
    // status-code-only checking — the forwarding hole passes, and members refuse the relay after release
    find: `    if [ "$(_norm_addr "$got")" != "$(_norm_addr "$u")" ]; then`,
    replace: `    if false; then`,
    test: 'scripts/relay-declared-address-probe.test.mjs',
  },
  {
    name: 'relay-update: a box that declares no public address passes anyway',
    file: 'scripts/relay-update.sh',
    // the behaviour that shipped: "no public address known — proof checked on loopback only", and every update passed
    find: `    log "THIS RELAY DECLARES NO PUBLIC ADDRESS, so it will refuse every member who is not on this machine"
    log "set RELAY_PUBLIC_URL=wss://your.host/relay in the service environment, or list the addresses in $DIR/relay/relay-addresses.json"
    log "if it really is loopback/LAN-only, set RELAY_LOOPBACK_ONLY=1 and request the update again"
    return 1`,
    replace: `    log "no public address known for this relay — proof checked on loopback only"
    return 0`,
    test: 'scripts/relay-declared-address-probe.test.mjs',
  },
  {
    name: 'relay-update: the credential is lost, so nothing can be asked',
    file: 'scripts/relay-update.sh',
    // TODAY'S BUG ONE LEVEL DOWN — the probe cannot read the token, and must FAIL rather than quietly checking nothing
    find: `"http://localhost:$PORT/local-token"`,
    replace: `"http://localhost:$PORT/local-token-moved"`,
    test: 'scripts/relay-declared-address-probe.test.mjs',
  },
  {
    name: 'relay-update: a degraded relay is called healthy',
    file: 'scripts/relay-update.sh',
    // reads the field and then treats every value as success — the shape the old body-discarding check had
    find: `    *'"ok":true'*)  ok=1; break;;
    *'"ok":false'*) log "relay is answering but reports itself DEGRADED — it is refusing writes, so it is not healthy";;`,
    replace: `    *'"ok":'*)  ok=1; break;;`,
    test: 'scripts/relay-declared-address-probe.test.mjs',
  },
];
