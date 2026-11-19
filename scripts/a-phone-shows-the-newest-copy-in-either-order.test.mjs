// A PHONE SHOWS THE NEWEST COPY OF A CARRIED SETTING, IN EITHER ARRIVAL ORDER (plan PLAN-removed-steward-fixes-F1-F4 §0b R-M1).
//   Run: node --test scripts/a-phone-shows-the-newest-copy-in-either-order.test.mjs
//
// Since the F1 round a removed helper's setting is carried under the church dated EXACTLY one second after theirs (owner
// answer k). Its safety rests on every reader picking the NEWEST copy: a later change by someone else (dated S+2 or later)
// must win whichever of the two reaches a phone first. Each reader here is the SHIPPED one, lifted out of
// vendor/fellowship.js and fed the two copies in BOTH orders, as the docs hub would hand them over:
//   C1  the church's carried copy, at S+1
//   C2  a NEWER copy at S+2 by another author the phone trusts (a helper still on the roster)
//   verse-prompt            (fixed in this round: a withdrawal cleared the prompt whatever its date)
//   joinpolicy `approval`   (fixed in this round: last arrival won)
//   care needs' meals-settings and care-team roster (subscribeCareNeeds: found by this sweep — last arrival won)
//   the shared document store (_absorbById) every list reader goes through: groups, categories, plans, devotionals,
//     services, runsheets, rotas, rosters, events, sermons, the featured sermon, care needs
// The other carried types' readers were READ, not run, and are listed in the commit that adds this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const F = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const CP = 'c'.repeat(64), HELPER = 'e'.repeat(64), MEMBER = 'a'.repeat(64);
const S = 1_790_000_000;
let n = 0;
const ev = (by, d, content, at, tags = []) => ({ id: (++n).toString(16).padStart(64, '0'), pubkey: by, created_at: at, kind: 30078, tags: [['d', d], ['t', 'trinityone'], ...(by === CP ? [] : [['church', CP]]), ...tags], content: typeof content === 'string' ? content : JSON.stringify(content) });
const orders = (a, b) => [['carried copy first', [a, b]], ['newer copy first', [b, a]]];
const roster = () => new Map([[CP, new Set([HELPER])]]);
const B = (sig, name) => fnBody(F, sig, name);

// ── verse-prompt ────────────────────────────────────────────────────────────────────────────────────────────────────
function versePrompt(events) {
  let h = null, card;
  const stubs = { toPub: () => CP, _churchRoster: roster(), _onChurchDocs: (_cp, x) => { h = x; return () => {}; } };
  const built = new Function(...Object.keys(stubs), `${B('function _churchVoice(cp, doc) {', '_churchVoice')}\nreturn ({ ${B('subscribeChurchVersePrompt(churchNpub, cb) {', 'subscribeChurchVersePrompt')} });`)(...Object.values(stubs));
  built.subscribeChurchVersePrompt('npub', (v) => { card = v; });
  for (const e of events) h.onevent(e, 'trinityone/verse-prompt');
  return card;
}
for (const [label, list] of orders(ev(CP, 'trinityone/verse-prompt', { ref: 'John 3:16' }, S + 1), ev(HELPER, 'trinityone/verse-prompt', { ref: 'Psalm 23' }, S + 2))) {
  test('verse-prompt — live copies, ' + label + ': the newer shows', () => assert.equal((versePrompt(list) || {}).ref, 'Psalm 23'));
}
for (const [label, list] of orders(ev(CP, 'trinityone/verse-prompt', '', S + 1, [['deleted', '1'], ['for', '*']]), ev(HELPER, 'trinityone/verse-prompt', { ref: 'Psalm 23' }, S + 2))) {
  test('verse-prompt — the church’s carried WITHDRAWAL (S+1) vs a newer live copy, ' + label + ': the newer live copy shows', () => {
    assert.equal((versePrompt(list) || {}).ref, 'Psalm 23', 'A WITHDRAWAL CLEARED A NEWER PROMPT');
  });
}
for (const [label, list] of orders(ev(HELPER, 'trinityone/verse-prompt', { ref: 'Psalm 23' }, S + 1), ev(CP, 'trinityone/verse-prompt', '', S + 2, [['deleted', '1'], ['for', '*']]))) {
  test('verse-prompt — a NEWER withdrawal vs an older live copy, ' + label + ': nothing shows (the older copy does not come back)', () => {
    assert.equal(versePrompt(list) == null ? null : versePrompt(list), null);
  });
}

// ── joinpolicy: `approval` ──────────────────────────────────────────────────────────────────────────────────────────
function joinApproval(events) {
  let h = null, state = null;
  const stubs = { toPub: () => CP, pub: MEMBER, _churchRoster: roster(), window: { Fellowship: { myPubkey: MEMBER } }, authState: () => ({ failed: false }),
    _onChurchDocs: (_cp, x) => { h = x; return () => {}; } };
  const built = new Function(...Object.keys(stubs), `return ({ ${B('subscribeChurchJoin(churchNpub, onState) {', 'subscribeChurchJoin')} });`)(...Object.values(stubs));
  built.subscribeChurchJoin('npub', (s) => { state = s; });
  for (const e of events) h.onevent(e, (e.tags.find(t => t[0] === 'd') || [])[1]);
  return state && state.approval;
}
for (const [label, list] of orders(ev(CP, 'trinityone/joinpolicy:' + CP, { approval: true }, S + 1), ev(HELPER, 'trinityone/joinpolicy:' + CP, { approval: false }, S + 2))) {
  test('joinpolicy — ' + label + ': the newer (no approval needed) governs `approval`', () => {
    assert.equal(joinApproval(list), false, 'THE OLDER CARRIED COPY ARRIVING LAST DECIDED approval (last arrival wins)');
  });
}

// ── subscribeCareNeeds: meals-settings decides who may open a need; the care-team roster decides admins ────────────────
function careNeeds(events) {
  let h = null, out = [];
  const store = ['function _pickWinner(', 'function _reduceVersions(', 'function _absorbById(', 'function _reduceAll(', 'function _tombstoneTargets(', 'function _forgetById(']
    .map(sig => B(sig, sig)).join('\n');
  const stubs = { toPub: (x) => (/^[0-9a-f]{64}$/.test(String(x || '')) ? x : CP), _churchRoster: roster(), _coalesce: (fn) => fn, _careOpen: () => null,
    _onChurchDocs: (_cp, x) => { h = x; return () => {}; }, ROSTER_PFX: 'trinityone/roster:', CARE_D: 'trinityone/care:', MEALS_SETTINGS_D: 'trinityone/meals-settings',
    CAREREQ_D: 'trinityone/carereq:', CAREREQSTATUS_D: 'trinityone/carereqstatus:' };
  const built = new Function(...Object.keys(stubs), `${store}\n${B('function _churchVoice(cp, doc) {', '_churchVoice')}\nreturn ({ ${B('subscribeCareNeeds(churchNpub, cb) {', 'subscribeCareNeeds')} });`)(...Object.values(stubs));
  built.subscribeCareNeeds('npub', (v) => { out = v; });
  for (const e of events) h.onevent(e, (e.tags.find(t => t[0] === 'd') || [])[1]);
  h.oneose();
  return out;
}
const memberNeed = () => ev(MEMBER, 'trinityone/care:need1', { type: 'meals', displayLabel: 'Meals for the Okafors', dates: ['2026-12-01'] }, S - 100);
for (const [label, list] of orders(ev(CP, 'trinityone/meals-settings', { enabled: true, openedBy: 'steward' }, S + 1), ev(HELPER, 'trinityone/meals-settings', { enabled: true, openedBy: 'member' }, S + 2))) {
  test('care needs — meals-settings, ' + label + ': the newer setting (members may open needs) governs which needs show', () => {
    const v = careNeeds([...list, memberNeed()]);
    assert.equal(v.length, 1, 'A MEMBER’S NEED IS HIDDEN BY THE OLDER CARRIED SETTING ARRIVING LAST: ' + JSON.stringify(v));
  });
}
for (const [label, list] of orders(ev(CP, 'trinityone/roster:careteam', { people: [] }, S + 1), ev(HELPER, 'trinityone/roster:careteam', { people: [{ pub: MEMBER }] }, S + 2))) {
  test('care needs — the care team roster, ' + label + ': the newer roster (naming the member as a care admin) governs', () => {
    const v = careNeeds([ev(CP, 'trinityone/meals-settings', { enabled: true, openedBy: 'steward', adminGroupId: 'careteam' }, S - 200), ...list, memberNeed()]);
    assert.equal(v.length, 1, 'THE OLDER CARRIED ROSTER ARRIVING LAST DECIDED WHO IS A CARE ADMIN: ' + JSON.stringify(v));
  });
}

// ── the shared document store every list reader goes through ───────────────────────────────────────────────────────
function store(events) {
  const src = ['function _pickWinner(', 'function _reduceVersions(', 'function _absorbById(', 'function _reduceAll(', 'function _tombstoneTargets(', 'function _forgetById(']
    .map(sig => B(sig, sig)).join('\n');
  const api = new Function(`${src}\nreturn { _absorbById, _forgetById, _tombstoneTargets };`)();
  const versions = new Map(), byId = new Map(), trusted = (r) => r && (r._by === CP || r._by === HELPER);
  for (const e of events) {
    if (e.tags.some(t => t[0] === 'deleted')) api._forgetById(versions, byId, 'g1', e.pubkey, e.created_at, trusted, { churchPub: CP, targets: api._tombstoneTargets(e) });
    else api._absorbById(versions, byId, 'g1', { id: 'g1', ...JSON.parse(e.content), ts: e.created_at, _by: e.pubkey }, trusted);
  }
  return byId.get('g1') || null;
}
for (const [label, list] of orders(ev(CP, 'trinityone/group:g1', { name: 'Youth (carried)' }, S + 1), ev(HELPER, 'trinityone/group:g1', { name: 'Youth (newer)' }, S + 2))) {
  test('the shared store (groups, plans, services, rotas, events, sermons, …) — ' + label + ': the newer shows', () => {
    assert.equal((store(list) || {}).name, 'Youth (newer)');
  });
}
for (const [label, list] of orders(ev(CP, 'trinityone/group:g1', '', S + 1, [['deleted', '1'], ['for', '*']]), ev(HELPER, 'trinityone/group:g1', { name: 'Youth (newer)' }, S + 2))) {
  test('the shared store — the church’s carried WITHDRAWAL (S+1, for:*) vs a newer live copy, ' + label + ': the newer stays', () => {
    assert.equal((store(list) || {}).name, 'Youth (newer)', 'A CARRIED WITHDRAWAL WITHDREW A NEWER COPY');
  });
}
for (const [label, list] of orders(ev(HELPER, 'trinityone/group:g1', { name: 'Youth (helper, older)' }, S + 1), ev(CP, 'trinityone/group:g1', '', S + 2, [['deleted', '1'], ['for', '*']]))) {
  test('the shared store — CONTROL: a NEWER church withdrawal (for:*) does withdraw an older copy, ' + label, () => {
    const g = store(list);
    assert.ok(!g || g._gone || g.deleted, 'the control is vacuous: the church’s newer withdrawal withdrew nothing: ' + JSON.stringify(g));
  });
}

// ── MED-3 (Fable audit of the F1 round): the OWNER CONSOLE's verse-prompt reader keeps the newest too ─────────────────
const ST = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
function consoleVersePrompt(events) {
  let card;
  const stubs = { pub: CP, VERSE_PROMPT_D: 'trinityone/verse-prompt', relays: () => ['wss://x'],
    lsGet: () => null, lsSet() {}, localStorage: { removeItem() {} },
    pool: { subscribeMany: (_u, _f, h) => { for (const e of events) h.onevent(e); h.oneose(); return { close() {} }; } } };
  const built = new Function(...Object.keys(stubs), `return ({ ${fnBody(ST, '  subscribeVersePrompt(cb) {', 'subscribeVersePrompt').trim()} });`)(...Object.values(stubs));
  built.subscribeVersePrompt((v) => { card = v; });
  return card;
}
for (const [label, list] of orders(ev(CP, 'trinityone/verse-prompt', '', S + 1, [['deleted', '1'], ['for', '*']]), ev(HELPER, 'trinityone/verse-prompt', { ref: 'Psalm 23' }, S + 2))) {
  test('MED-3 console verse-prompt — the church’s carried WITHDRAWAL (S+1) vs a newer live copy, ' + label + ': the newer shows', () => {
    assert.equal((consoleVersePrompt(list) || {}).ref, 'Psalm 23', 'A WITHDRAWAL CLEARED A NEWER PROMPT ON THE CONSOLE');
  });
}
for (const [label, list] of orders(ev(HELPER, 'trinityone/verse-prompt', { ref: 'Psalm 23' }, S + 1), ev(CP, 'trinityone/verse-prompt', '', S + 2, [['deleted', '1'], ['for', '*']]))) {
  test('MED-3 console verse-prompt — a NEWER withdrawal vs an older live copy, ' + label + ': nothing shows', () => {
    assert.equal(consoleVersePrompt(list) || null, null, 'an older prompt came back after a newer withdrawal');
  });
}
