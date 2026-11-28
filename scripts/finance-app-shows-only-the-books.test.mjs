// THE FINANCE APP (finance.html) IS THE CONSOLE'S OWN GATES WITH ONE SCREEN BEHIND THEM: THE BOOKS, AND ONLY FOR A HELPER.
//   Run: node --test scripts/finance-app-shows-only-the-books.test.mjs
//
// T1Finance plan §3 as amended by §11 (M1, M3, M5). finance.html loads finance-mode.js first (window.TRINITY_APP =
// 'finance') and a SHORTER script list than steward.html. StewardRoot keeps its one gate chain and, in this app only,
// renders FinanceShell where the console renders StewDashboard. FinanceShell opens DashFinance only for a DELEGATED
// identity (Steward.isDelegated()) — a church key or a bare helper key sees "not linked" instead.
//
// POINT OF USE (CLAUDE.md rules 1 & 3). Every test here loads finance.html's OWN script list, in its own order, into
// one shared scope through console-screens.mjs (the way the page runs them), with finance-mode.js run first exactly
// as the page runs it, and then RENDERS the real StewardRoot / FinanceShell / StewardWelcome / PublishErrorBanner.
// Nothing is matched in app/*.jsx. Delete StewardRoot's finance slot, or FinanceShell's DashFinance / banner mount,
// or the isDelegated guard, and these fail.
//
// THE LIMIT OF THIS HARNESS (console-screens.mjs): child components are NOT called, so "renders DashFinance" means
// DashFinance is the element FinanceShell put on screen — DashFinance's own body is covered by its own tests. That
// finance.html boots in a real browser is scripts/app-boots.test.mjs's job (its finance case).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, consoleScripts, pagePlainScripts, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';
import { rosterEngine, rosterEvent } from './steward-roster-engine.mjs';

const CHURCH = 'cc'.repeat(32);
const ME = 'dd'.repeat(32);
const say = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ');

// finance.html's plain scripts that are safe in node: the app flag. (The vendor bundles need a DOM or sockets; the
// fake window.Steward stands in for vendor/steward.js, as in every console-screens test.)
function financePlain() {
  const plain = pagePlainScripts('finance.html');
  assert.equal(plain[0], 'finance-mode.js', 'finance.html must load finance-mode.js FIRST, before React and every app script');
  return ['finance-mode.js'];
}

function load({ app = 'finance', steward = {}, search = '', expr, beforeLoad } = {}) {
  const fr = fakeReact();
  const Steward = fakeSteward({ hasKey: true, locked: false, needsPin: false, pendingStewardRequest: () => null, removedNotices: () => [], selfRegister: () => Promise.resolve(true), ...steward });
  const { window } = fakeBrowser({ Steward });
  window.location.search = search;
  if (beforeLoad) beforeLoad(window);
  const files = app === 'finance' ? consoleScripts('finance.html') : consoleScripts();
  const vendor = app === 'finance' ? financePlain() : [];
  const mods = loadConsole({ React: fr.React, window, expr, files, vendor });
  return { fr, window, mods, Steward };
}

// a delegated finance helper, acting for CHURCH
const helper = (caps = ['finance']) => ({ actingChurch: CHURCH, pubkey: CHURCH, isDelegated: () => true, myStewardCaps: () => caps });

test('finance.html: its own script list loads in one scope and sets the app flag before anything reads it', () => {
  const { window, mods } = load({ expr: '{ StewardRoot, FinanceShell: window.FinanceShell, flag: window.TRINITY_APP }' });
  assert.equal(mods.flag, 'finance', 'finance-mode.js did not set window.TRINITY_APP');
  assert.equal(typeof mods.FinanceShell, 'function', 'finance.html does not load app/finance-shell.jsx');
  // the trimmed list really is trimmed — and steward.html still loads everything it did
  const fin = consoleScripts('finance.html'), stw = consoleScripts();
  for (const gone of ['app/stew-manna.jsx', 'app/stew-meals.jsx', 'app/stew-relay.jsx', 'app/stew-schedule.jsx']) {
    assert.ok(!fin.includes(gone), gone + ' is still loaded by finance.html');
    assert.ok(stw.includes(gone), gone + ' was removed from steward.html too');
  }
  assert.ok(!stw.includes('app/finance-shell.jsx'), 'steward.html must not load the finance shell');
  assert.equal(window.TRINITY_APP, 'finance');
});

test('StewardRoot in finance.html: a delegated helper gets FinanceShell in the last slot — never the full console', () => {
  const { fr, mods } = load({ steward: helper(), expr: '{ StewardRoot, FinanceShell: window.FinanceShell, StewDashboard, UpdateBanner }' });
  fr.reset(); const tree = mods.StewardRoot(); fr.flush();
  const all = nodes(tree);
  assert.ok(all.some(n => n.type === mods.FinanceShell), 'StewardRoot did not render FinanceShell in the finance app');
  assert.ok(!all.some(n => n.type === mods.StewDashboard), 'the finance app rendered the FULL steward console');
  const ub = all.find(n => n.type === mods.UpdateBanner);
  assert.ok(ub, 'the finance app has no update check');
  assert.equal(ub.props.variant, 'finance', 'the finance app would offer the STEWARD apk (a different app)');
});

test('CONTROL — StewardRoot in steward.html is unchanged: StewDashboard, variant="steward", no FinanceShell', () => {
  const { fr, mods, window } = load({ app: 'steward', steward: helper(), expr: '{ StewardRoot, StewDashboard, UpdateBanner }' });
  assert.equal(window.TRINITY_APP, undefined);
  fr.reset(); const tree = mods.StewardRoot(); fr.flush();
  const all = nodes(tree);
  assert.ok(all.some(n => n.type === mods.StewDashboard), 'steward.html stopped rendering the console');
  assert.ok(!all.some(n => typeof n.type === 'function' && n.type.name === 'FinanceShell'), 'steward.html rendered the finance shell');
  assert.equal(all.find(n => n.type === mods.UpdateBanner).props.variant, 'steward');
});

test('StewardRoot in the DESKTOP finance program (packaged origin AND the desktop build stamp) runs the "finance-desktop" update check — and only there', () => {
  const STAMP = { app: 'finance-desktop', version: '0.1.0', sha: '8c30bf1c097e' };
  const variantFor = ({ packaged, stamp, app = 'finance' }) => {
    const { fr, mods } = load({ app, steward: { ...helper(), packagedOrigin: () => packaged }, beforeLoad: (w) => { if (stamp) w.TRINITY_BUILD = stamp; }, expr: '{ StewardRoot, UpdateBanner }' });
    fr.reset(); const tree = mods.StewardRoot(); fr.flush();
    const ub = nodes(tree).find(n => n.type === mods.UpdateBanner);
    assert.ok(ub, 'no update check mounted');
    return ub.props.variant;
  };
  assert.equal(variantFor({ packaged: true, stamp: STAMP }), 'finance-desktop', 'the desktop program would run the finance APK\'s update check (Capacitor-only: it would never offer an update)');
  assert.equal(variantFor({ packaged: false, stamp: STAMP }), 'finance', 'a web page carrying the stamp got the desktop update check — the stamp is a plain global, not proof');
  assert.equal(variantFor({ packaged: true, stamp: null }), 'finance', 'the Android finance APK (packaged, no desktop stamp) lost its APK update check');
  assert.equal(variantFor({ packaged: true, stamp: { ...STAMP, app: 'other' } }), 'finance');
  assert.equal(variantFor({ packaged: false, stamp: null, app: 'steward' }), 'steward', 'CONTROL: steward.html changed');
});

test('StewVersion: in the desktop program it shows the build stamp — version and short commit — and FinanceSettings puts it on screen', () => {
  const { fr, mods } = load({ steward: helper(), beforeLoad: (w) => { w.TRINITY_BUILD = { app: 'finance-desktop', version: '0.1.0', sha: '8c30bf1c097e' }; }, expr: '{ StewVersion, FinanceSettings }' });
  fr.fresh(); mods.StewVersion({ name: 'TrinityOne Finance' }); fr.flush(); fr.reset();
  assert.equal(say(mods.StewVersion({ name: 'TrinityOne Finance' })).trim(), 'TrinityOne Finance · v0.1.0 (8c30bf1)');
  fr.fresh(); const st = mods.FinanceSettings({ onClose() {} }); fr.flush();
  const v = nodes(st).find(n => n.type === mods.StewVersion);
  assert.ok(v, 'FinanceSettings does not show the version line');
  assert.equal(v.props.name, 'TrinityOne Finance');
  // CONTROL: no stamp (web / APK) — the line is the name alone until Capacitor or the SW cache answers, as before
  const L = load({ steward: helper(), expr: '{ StewVersion }' });
  L.fr.fresh(); L.mods.StewVersion({}); L.fr.flush(); L.fr.reset();
  assert.equal(say(L.mods.StewVersion({})).trim(), 'TrinityOne Steward');
});

test('FinanceShell: a delegated finance helper sees DashFinance, the error banner, and a switcher with no "Set church name"', () => {
  const { fr, mods } = load({ steward: helper(), expr: '{ FinanceShell: window.FinanceShell, DashFinance, PublishErrorBanner, IdentitySwitcher, FinanceUnlinked }' });
  fr.reset(); const tree = mods.FinanceShell(); fr.flush();
  const all = nodes(tree);
  assert.ok(all.some(n => n.type === mods.DashFinance), 'FinanceShell did not put the books (DashFinance) on screen');
  assert.ok(all.some(n => n.type === mods.PublishErrorBanner), 'FinanceShell does not mount PublishErrorBanner — a refused finance write would be invisible');
  assert.ok(!all.some(n => n.type === mods.FinanceUnlinked), 'a linked helper was told they are not linked');
  const sw = all.find(n => n.type === mods.IdentitySwitcher);
  assert.ok(sw, 'no identity switcher in the finance header');
  assert.equal(sw.props.noNameEdit, true, 'the finance switcher offers "Set church name" — an owner action (M5)');
  assert.ok(!all.some(n => n.props && n.props['data-finance-other-caps']), 'a finance-only key was told it has other permissions');
});

test('FinanceShell: NOT delegated (a church key, or a helper key with no church open) → "not linked", NOT the books (M1)', () => {
  for (const steward of [{ actingChurch: '', pubkey: ME, isDelegated: () => false, myStewardCaps: () => null }, { actingChurch: '', isDelegated: () => false }]) {
    const { fr, mods } = load({ steward, expr: '{ FinanceShell: window.FinanceShell, DashFinance, FinanceUnlinked, DashBecomeStewardPanel }' });
    fr.reset(); const tree = mods.FinanceShell(); fr.flush();
    const all = nodes(tree);
    assert.ok(!all.some(n => n.type === mods.DashFinance), 'the books opened for a console that is not acting for a church');
    assert.ok(all.some(n => n.type === mods.FinanceUnlinked), 'no "not linked" screen');
    fr.fresh(); const un = mods.FinanceUnlinked(); fr.flush();
    assert.match(say(un), /Not linked to a church yet/);
    assert.ok(nodes(un).some(n => n.type === mods.DashBecomeStewardPanel), 'the not-linked screen does not offer the request flow');
  }
});

test('FinanceShell: a helper who already helps a church but has not opened it is offered that church', () => {
  let opened = '';
  const { fr, mods } = load({ steward: { actingChurch: '', isDelegated: () => false, identities: () => [{ pub: ME, kind: 'church', name: '' }, { pub: CHURCH, kind: 'steward', name: 'St Aidan' }], setActiveIdentity: (p) => { opened = p; } },
    expr: '{ FinanceUnlinked }' });
  fr.reset(); const tree = mods.FinanceUnlinked(); fr.flush();
  const b = nodes(tree).find(n => n.type === 'button' && /Open St Aidan/.test(say(n)));
  assert.ok(b, 'the church this key helps is not offered');
  b.props.onClick();
  assert.equal(opened, CHURCH);
});

// A delegated helper whose capabilities come from the REAL roster read (scripts/steward-roster-engine.mjs — subscribeStewards,
// myStewardCaps and listIsFresh lifted from vendor/steward.js); only the relay is played by the test. `caps` is what the
// church's roster grants this console (null = no capabilities recorded: a full steward at the relay).
function rosterHelper(caps) {
  const eng = rosterEngine({ actingChurch: CHURCH, pub: CHURCH, churchPub: ME });
  let opened = 0;
  const steward = { actingChurch: CHURCH, pubkey: CHURCH, isDelegated: () => true, myStewardCaps: () => eng.myStewardCaps(),
    subscribeStewards: (cb) => { opened++; return eng.subscribeStewards(cb); }, listIsFresh: (l, t) => eng.listIsFresh(l, t) };
  const arrive = () => { eng.relay.event(rosterEvent(CHURCH, [ME], caps === null ? null : { [ME]: caps })); eng.relay.eose(); eng.relay.settle(); };
  return { steward, eng, arrive, get opened() { return opened; } };
}
const shell = (mods, fr) => { fr.reset(); const t = mods.FinanceShell(); fr.flush(); return t; };

test('FinanceShell: a delegated helper WITHOUT Finance gets the "isn\'t yours" panel, never an empty ledger', () => {
  const r = rosterHelper(['care', 'members']);
  const { fr, mods } = load({ steward: r.steward, expr: '{ FinanceShell: window.FinanceShell, DashFinance, StewCapBlocked }' });
  shell(mods, fr); r.arrive();
  const tree = shell(mods, fr);
  const all = nodes(tree);
  assert.ok(!all.some(n => n.type === mods.DashFinance), 'a helper without Finance was shown the ledger');
  const blk = all.find(n => n.type === mods.StewCapBlocked);
  assert.ok(blk && blk.props.cap === 'finance', 'no "Finance isn\'t yours" panel');
});

test('FinanceShell: a helper with MORE than Finance sees only the books plus one quiet line — and no "use the Steward app"', () => {
  for (const caps of [['finance', 'care'], null]) {   // null = unscoped: a full steward at the relay
    const r = rosterHelper(caps);
    const { fr, mods } = load({ steward: r.steward, expr: '{ FinanceShell: window.FinanceShell, DashFinance }' });
    shell(mods, fr); r.arrive();                          // first draw opens the roster read; the relay answers
    const tree = shell(mods, fr);
    const all = nodes(tree);
    assert.ok(all.some(n => n.type === mods.DashFinance), 'caps ' + JSON.stringify(caps) + ': no books');
    const line = all.find(n => n.props && n.props['data-finance-other-caps']);
    assert.ok(line, 'caps ' + JSON.stringify(caps) + ': no line saying this key has other permissions');
    assert.doesNotMatch(say(tree), /Steward app/i, 'it told the helper to use the Steward app — on Android that is a different key');
  }
});

test('FinanceShell reads the steward roster itself — myStewardCaps() answers from it — and says nothing about other permissions until it has', () => {
  const r = rosterHelper(null);
  const { fr, mods } = load({ steward: r.steward, expr: '{ FinanceShell: window.FinanceShell }' });
  let tree = shell(mods, fr);
  assert.equal(r.opened, 1, 'FinanceShell does not subscribe to the steward roster — a helper\'s capabilities would never be known in this app');
  tree = shell(mods, fr);
  assert.ok(!nodes(tree).some(n => n.props && n.props['data-finance-other-caps']), 'the other-permissions line showed before the roster (and so the capabilities) had arrived');
  r.arrive();
  tree = shell(mods, fr);
  assert.ok(nodes(tree).some(n => n.props && n.props['data-finance-other-caps']), 'the roster arrived (unscoped helper) and the line did not show');
});

test('F3: an EMPTY end-of-stored-events is not a roster — no other-permissions line and no "isn\'t yours" verdict until the read settles', () => {
  for (const caps of [['care'], null]) {
    const r = rosterHelper(caps);
    const { fr, mods } = load({ steward: r.steward, expr: '{ FinanceShell: window.FinanceShell, DashFinance, StewCapBlocked }' });
    shell(mods, fr);
    r.eng.relay.eose();   // the relay ends its stored events with no roster: the stream delivers [] and myStewardCaps() is null
    let tree = shell(mods, fr);
    assert.ok(!nodes(tree).some(n => n.props && n.props['data-finance-other-caps']), 'caps ' + JSON.stringify(caps) + ': the empty end-of-stored-events was read as a roster ("other permissions")');
    assert.ok(!nodes(tree).some(n => n.type === mods.StewCapBlocked), 'caps ' + JSON.stringify(caps) + ': a capability verdict was drawn before the roster was read');
    // the roster event itself arrives, but the fresh read has not settled yet: still no verdict (the panel needs a GENUINE read)
    r.eng.relay.event(rosterEvent(CHURCH, [ME], caps === null ? null : { [ME]: caps }));
    tree = shell(mods, fr);
    assert.ok(!nodes(tree).some(n => n.type === mods.StewCapBlocked), 'caps ' + JSON.stringify(caps) + ': the "isn\'t yours" verdict was drawn from an unsettled read');
    assert.ok(!nodes(tree).some(n => n.props && n.props['data-finance-other-caps']), 'caps ' + JSON.stringify(caps) + ': the other-permissions line came from an unsettled read');
    r.eng.relay.settle();
    tree = shell(mods, fr);
    const settled = caps === null ? nodes(tree).some(n => n.props && n.props['data-finance-other-caps']) : nodes(tree).some(n => n.type === mods.StewCapBlocked);
    assert.ok(settled, 'caps ' + JSON.stringify(caps) + ': the settled roster did not produce its verdict');
  }
});

test('PublishErrorBanner (the one FinanceShell mounts) shows a refused finance write', () => {
  const { fr, mods, window } = load({ steward: helper(), expr: '{ FinanceShell: window.FinanceShell, PublishErrorBanner }' });
  fr.reset(); const shell = mods.FinanceShell(); fr.flush();
  const el = nodes(shell).find(n => n.type === mods.PublishErrorBanner);
  assert.ok(el, 'FinanceShell does not mount PublishErrorBanner');
  fr.fresh();
  let b = el.type(el.props); fr.flush();   // its listeners are registered by its effect
  assert.equal(b, null, 'the banner is up with nothing to say');
  window.dispatch('steward-write-blocked', { detail: { what: 'journal entry', message: 'That entry was NOT recorded — test refusal.' } });
  fr.reset(); b = el.type(el.props); fr.flush();
  assert.match(say(b), /That entry was NOT recorded — test refusal\./, 'a refused finance write did not reach the screen');
});

test('IdentitySwitcher noNameEdit: no "Set church name" and no "Rename church" — the owner keeps that (M5)', () => {
  const { fr, mods } = load({ steward: { actingChurch: '', isDelegated: () => false, identities: () => [{ pub: ME, kind: 'church' }, { pub: CHURCH, kind: 'steward', name: 'St Aidan' }] }, expr: '{ IdentitySwitcher }' });
  const church = { name: 'St Aidan', npub: 'npub1x', features: {} };
  // 1. nothing else to switch to: the control is a label, not the rename button
  fr.reset(); let t = mods.IdentitySwitcher({ church, churchName: 'St Aidan', initials: 'SA', onEditName() { throw new Error('renamed'); }, compact: true, noNameEdit: true }); fr.flush();
  assert.ok(!nodes(t).some(n => n.type === 'button' && (n.props || {}).title === 'Set church name'), 'the compact switcher is still a "Set church name" button');
  assert.match(say(t), /St Aidan/);
  // CONTROL: without the prop it IS that button (the steward console, unchanged)
  fr.fresh(); t = mods.IdentitySwitcher({ church, churchName: 'St Aidan', initials: 'SA', onEditName() {}, compact: true }); fr.flush();
  assert.ok(nodes(t).some(n => n.type === 'button' && (n.props || {}).title === 'Set church name'), 'CONTROL: the console lost its rename button');
});

test('IdentitySwitcher noNameEdit with churches to switch between: the open list has no "Rename church" row', () => {
  const stewarded = [CHURCH];
  const { fr, mods, window } = load({ steward: { actingChurch: '', isDelegated: () => false, activePub: ME, identities: () => [{ pub: ME, kind: 'church' }, { pub: CHURCH, kind: 'steward', name: 'St Aidan' }] }, expr: '{ IdentitySwitcher }' });
  window.useStewardStewardedChurches = () => stewarded;
  const church = { name: 'Own', npub: 'npub1x', features: {} };
  const open = (props) => {
    fr.fresh(); let t = mods.IdentitySwitcher(props); fr.flush();
    const tog = nodes(t).find(n => n.type === 'button' && /Switch between/.test(String((n.props || {}).title || '')));
    assert.ok(tog, 're-anchor: no switcher toggle');
    tog.props.onClick(); fr.reset(); t = mods.IdentitySwitcher(props); fr.flush();
    return say(t);
  };
  assert.doesNotMatch(open({ church, churchName: 'Own', initials: 'OW', onEditName() {}, compact: true, noNameEdit: true }), /Rename church/);
  assert.match(open({ church, churchName: 'Own', initials: 'OW', onEditName() {}, compact: true }), /Rename church/, 'CONTROL: the console lost its rename row');
});

// ── THE WELCOME (plan §3.5 + M3) ─────────────────────────────────────────────────────────────────────────────────────
function welcome(app, { native = false } = {}) {
  const adopted = [], reqs = [];
  const r = load({ app, steward: {
    hasKey: false,
    createKeyQuiet: () => ({ code: 'trinityone-steward:npub1me', npub: 'npub1me' }),
    checkStewardInvite: (p) => (p === 'INVITE' ? { ok: true, church: CHURCH } : { ok: false, error: 'bad' }),
    requestSteward: (p, n) => { reqs.push([p, n]); return Promise.resolve({ ok: true, church: CHURCH }); },
    adoptChurch: (p) => { adopted.push(p); },
  }, beforeLoad: (w) => { if (native) w.Capacitor = { isNativePlatform: () => true, Plugins: {} }; }, expr: '{ StewardWelcome }' });
  let tree = null;
  const draw = () => { r.fr.reset(); tree = r.mods.StewardWelcome(); r.fr.flush(); return tree; };
  const buttons = () => nodes(tree).filter(n => n.type === 'button').map(n => texts(n).join(' ').replace(/\s+/g, ' ').trim());
  const press = (label) => { const b = nodes(tree).find(n => n.type === 'button' && texts(n).join(' ').includes(label)); assert.ok(b, 're-anchor: no button "' + label + '" — buttons: ' + buttons().join(' | ')); b.props.onClick({ preventDefault() {}, stopPropagation() {} }); draw(); };
  const typeInto = (aria, value) => { const i = nodes(tree).find(n => (n.type === 'input' || n.type === 'textarea') && (n.props || {})['aria-label'] === aria); assert.ok(i, 're-anchor: no field ' + aria); i.props.onChange({ target: { value } }); draw(); };
  draw();
  return { draw, buttons, press, typeInto, adopted, reqs, get tree() { return tree; } };
}

test('finance welcome: only "Help with a church\'s books" and "Restore my helper words" — no create, no hand-over', async () => {
  for (const native of [false, true]) {
    const w = welcome('finance', { native });
    const b = w.buttons();
    assert.ok(b.some(x => /Help with a church.s books/.test(x)), 'no "Help with a church\'s books"');
    assert.ok(b.some(x => /Restore my helper words/.test(x)), 'no "Restore my helper words" (M3)');
    for (const no of [/Start a new church/, /Restore a church/, /Help run a church/, /another device/]) assert.ok(!b.some(x => no.test(x)), 'the finance welcome offers ' + no + (native ? ' (native)' : ''));
    w.press('Restore my helper words');
    assert.ok(nodes(w.tree).some(n => n.type === 'textarea'), 'the restore step has no box for the 12 words');
    assert.ok(!w.buttons().some(x => /handoff QR/i.test(x)), 'the finance restore step offers the hand-over QR scanner');
    w.typeInto('Your 12 helper words', 'one two three four five six seven eight nine ten eleven twelve');
    w.press('Restore');
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(w.adopted, ['one two three four five six seven eight nine ten eleven twelve'], 'Restore did not restore the words');
  }
});

test('finance welcome: "Help with a church\'s books" is the existing invite → name → request flow', async () => {
  const w = welcome('finance');
  w.press('Help with a church’s books');
  w.typeInto('Church invite code', 'INVITE');
  w.press('Next');
  w.typeInto('Your name', 'Tom Treasurer');
  w.press('Send');
  await new Promise(r => setImmediate(r));
  assert.deepEqual(w.reqs, [['INVITE', 'Tom Treasurer']]);
});

test('CONTROL — the steward welcome is unchanged: create, restore and help-run are all still there', () => {
  const b = welcome('steward', { native: true }).buttons();
  for (const yes of [/Start a new church/, /Restore a church/, /Help run a church/, /My church is on another device/]) assert.ok(b.some(x => yes.test(x)), 'the steward welcome lost ' + yes);
  assert.ok(!b.some(x => /Help with a church.s books|Restore my helper words/.test(x)), 'the steward welcome shows the finance doors');
});

// ── ?adopt= (plan §3.6) ────────────────────────────────────────────────────────────────────────────────────────────
test('?adopt= is ignored in the finance app — and still adopts in the steward console', async () => {
  for (const [app, want] of [['finance', 0], ['steward', 1]]) {
    const adopted = [];
    const replaced = [];
    load({ app, search: '?adopt=word%20word', steward: { hasKey: false, adoptChurch: (p) => { adopted.push(p); }, init() {} },
      beforeLoad: (w) => { w.history.replaceState = (a, b, u) => replaced.push(u); w.location.href = 'https://console.example/' + (app === 'finance' ? 'finance' : 'steward') + '.html?adopt=word%20word'; },
      expr: '1' });
    await new Promise(r => setTimeout(r, 0));
    assert.equal(adopted.length, want, app + ': ?adopt= ' + (want ? 'did not adopt' : 'adopted a church key in the finance app'));
    assert.ok(replaced.length && !/adopt/.test(replaced[0]), app + ': the seed-bearing ?adopt= was not scrubbed from the address');
  }
});
