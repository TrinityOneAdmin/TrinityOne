// "✓ SAVED" MUST NOT APPEAR OVER A DOCUMENT NO RELAY TOOK — and three siblings of the same shape.
// Run: node --test scripts/a-saved-message-tag-nobody-took-is-not-saved.test.mjs
//
// AUDIT-undeclared-doc-types-2026-09-22, the second half of finding H1. Closing the relay's member catch-all
// took six document types away from the delegated console in one commit, and the console did not notice
// ANY of them, because the code that publishes them threw away what the relay said:
//
//     publishMessageTags(tags) { … return publish(feChurch({…})).then(() => clean); }     src/steward.src.js
//     …                                                        setMsg('✓ Saved — members see these…')   app/stew-dashboard.jsx
//
// So the editor showed a tick over a refusal, every time, for every delegated steward. That is
// [[fix-the-control-not-the-label]] exactly, and it is the same defect syncEnable was given a fix for on
// 2026-09-02 while its neighbours were not.
//
// FOUR CALL SITES ARE CHECKED HERE, which is every one in the H1 blast radius that discarded its result
// (CLAUDE.md rule 2). `publishSermon` already threw on a refusal and is asserted to still do so, so that the
// one that was right cannot quietly join the others. `pinSermon`/`unpinSermon` are deliberately NOT in this
// list and the reason is in a test at the bottom: they show no success label at all — the star is driven by
// subscribePinnedSermon, i.e. by what the relay served back — so there is nothing there that can lie.
//
//   publishMessageTags   discarded the result       -> now rejects
//   removeSermon         discarded it AND THEN DELETED THE BLOB BYTES from every host: a refused tombstone
//                        left the sermon live in every member's app pointing at bytes that no longer exist
//   mediaEncryptor       discarded it and returned a working encryptor: the console then encrypted the
//                        sermon with a key whose envelope never landed and uploaded the ciphertext —
//                        permanently unplayable, by anyone, including the church
//   setBackupMeta        fire-and-forget: this console showed "backed up" while every other steward's
//                        console went on showing the church overdue
//
// CLAUDE.md rule 3: app/*.jsx ships UNBUNDLED, so a text match on the panel source would survive `false && `
// in front of the whole handler. The panel is COMPILED AND RENDERED below and the assertions read the tree
// it produced. The engine half is lifted out of vendor/steward.js — the SHIPPED bundle, where esbuild has
// already removed anything dead — and run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, texts, button, find, loadScreen, reads } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const BUNDLE = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));

// ── the panel, compiled with the real esbuild ────────────────────────────────────────────────────────────
async function loadComponent(name, anchor, globals) {
  const src = fnBody(STEW, anchor, name);
  const tmp = join(tmpdir(), 'msgtags-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__msgtags_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}

// `publishMessageTags` decides what the engine hands back for the press.
async function panel(publishMessageTags) {
  const { React, draw } = miniReact();
  const calls = [];
  const Comp = await loadComponent('DashChatTagsPanel', 'function DashChatTagsPanel({ church }) {', {
    React,
    window: {
      Steward: {
        // The church has one tag already, so the panel renders a real list rather than the seed path.
        subscribeMessageTags: (cb) => { cb([{ id: 'prayer', label: 'Prayer request', icon: 'pray', accent: 'gold' }]); return () => {}; },
        publishMessageTags: async (list) => { calls.push(list); return publishMessageTags(list); },
      },
    },
    Panel: ({ children }) => React.createElement('div', null, children),
    Icon: () => null,
    chatTagCss: () => 'var(--clay)',
    CHATTAG_ICONS: ['pray'],
    CHATTAG_ACCENTS: [['gold', 'var(--gold)']],
    CHATTAG_PRAYER: { id: 'prayer', label: 'Prayer request', icon: 'pray', accent: 'gold' },
  });
  const render = () => draw(Comp, { church: { pubkey: 'cp' } });
  let tree = render();
  const press = async () => {
    const b = button(tree, 'Save tags')[0];
    assert.ok(b, 'the Save button is gone from the chat-tags panel — re-anchor this test');
    b.props.onClick();
    for (let i = 0; i < 6; i++) await tick();
    tree = render();
  };
  return { press, calls, said: () => texts(tree).join(' ') };
}

test('a refused save shows the refusal, and never the tick', async () => {
  // The exact failure: the engine rejects (it used to resolve on a refusal), and the panel must print that
  // rather than "✓ Saved". If publishMessageTags ever goes back to discarding publish()'s result, this
  // resolves and the tick comes back — which is the assertion.
  const p = await panel(() => { throw new Error('Couldn’t save the message tags — no relay accepted them.'); });
  await p.press();
  assert.equal(p.calls.length, 1, 'Save did not reach the engine at all');
  assert.doesNotMatch(p.said(), /✓ Saved/,
    'THE TICK WENT UP OVER A REFUSED DOCUMENT. The steward closes the panel believing the congregation will ' +
    'see the new tags; nothing was stored and nothing will. Screen read: ' + p.said());
  assert.match(p.said(), /no relay accepted them/,
    'the panel swallowed the reason and said nothing useful. Screen read: ' + p.said());
});

test('a save that landed still shows the tick', async () => {
  // The other direction, and it is not decoration: a "fix" that showed the error unconditionally would pass
  // the test above while telling every steward their working save had failed.
  const p = await panel((list) => list);
  await p.press();
  assert.match(p.said(), /✓ Saved/, 'a save every relay accepted is now reported as a failure. Screen read: ' + p.said());
  assert.doesNotMatch(p.said(), /Couldn’t save/, 'both messages at once. Screen read: ' + p.said());
});

// ── the engine half, lifted out of the SHIPPED bundle and run ────────────────────────────────────────────
// Brace-match a method out of vendor/steward.js. A fixed-width slice stops covering the function the moment
// esbuild reflows the file, and then tests nothing while staying green (AUDIT-2026-07-28 F15).
function grab(sig) {
  let at = BUNDLE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped console bundle — re-anchor this test, or rebuild: bash scripts/build-steward.sh');
  if (BUNDLE.slice(Math.max(0, at - 6), at) === 'async ') at -= 6;
  let depth = 0, q = '';
  for (let i = BUNDLE.indexOf('{', at); i < BUNDLE.length; i++) {
    const c = BUNDLE[i], prev = BUNDLE[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return BUNDLE.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}

// Run one lifted method with a `publish` that answers `answer`. Everything else it needs is the smallest
// thing that lets it reach the publish — never a stand-in for the decision under test, which is what the
// method does with publish()'s ANSWER.
async function runLifted(sig, name, answer, scope = {}, args = [], decls = '') {
  const src = grab(sig);
  const published = [];
  const env = {
    publish: async (evt) => { published.push(evt); return answer; },
    feChurch: (t) => t,
    // _credNow(): the corrected clock used for SHORT-LIVED CREDENTIALS only (the kind-24242 / kind-27235
    // auth events a relay checks for freshness and discards). With no skew measured it returns exactly
    // what now() returns, which is this harness's case — src/steward.src.js, above _blobBase().
    now: () => 1700000000, _credNow: () => 1700000000,
    sk: 'SK', pub: 'CP', NET: 'trinityone',
    // '' = the OWNER's console, which is what every test written before 2026-09-22 assumes. The three
    // delegated-console tests below pass 'CHURCHPUB' explicitly, because on that console it is the decision
    // under test and not scenery.
    actingChurch: '',
    MSGTAGS_D: 'trinityone/msgtags', SERMON_D: 'trinityone/sermon:', MEDIAKEY_D: 'trinityone/mediakey:',
    BACKUPMETA_D: 'trinityone/backup-meta:',
    _sanitizeMsgTags: (t) => t,
    // The blob auth sites call this now (option A, H1). The REAL one, lifted out of the bundle rather than
    // stubbed: a stub returning `tags` unchanged would let every delegated-console test go green over an
    // upload that never names the church, which is the defect itself.
    _blobAuthTags: new Function('actingChurch', fnBody(BUNDLE, 'function _blobAuthTags(tags) {', '_blobAuthTags') + '\nreturn _blobAuthTags;')(scope.actingChurch || ''),
    fetch: async () => ({ ok: true }),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    ...scope,
  };
  // esbuild RENAMES imported bindings — `finalizeEvent` is emitted as `finalizeEvent2` in today's bundle.
  // Bind whatever name it actually used, and fail loudly if the method stops calling it: binding the wrong
  // name throws ReferenceError from inside the lifted code, which a `rejects()` assertion would happily
  // accept as the refusal it was looking for. (It did, while this file was being written.)
  const emitted = [...src.matchAll(/\b(finalizeEvent\d*)\(/g)].map(m => m[1]);
  for (const n of new Set(emitted)) env[n] = () => ({ id: 'signed', created_at: 1700000000, tags: [] });
  const key = '__lift_' + Math.random().toString(36).slice(2);
  globalThis[key] = env;
  const preamble = Object.keys(env).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(
    preamble + '\n' + decls + '\nconst __o = { ' + src + ' };\nexport const fn = __o.' + name + '.bind(__o);\n').toString('base64'));
  return { fn: mod.fn, published, call: () => mod.fn(...args) };
}

test('publishMessageTags REJECTS when every relay refused', async () => {
  const no = await runLifted('publishMessageTags(tags)', 'publishMessageTags', false, {}, [[{ id: 'a', label: 'A' }]]);
  await assert.rejects(no.call(), /relay accepted/,
    'the shipped publishMessageTags still resolves over a refusal — every caller above it reports a save that did not happen');
  assert.equal(no.published.length, 1, 'it did not even try to publish');
  const yes = await runLifted('publishMessageTags(tags)', 'publishMessageTags', { id: 'evt' }, {}, [[{ id: 'a', label: 'A' }]]);
  assert.deepEqual(await yes.call(), [{ id: 'a', label: 'A' }], 'a save the relay accepted no longer returns the tags');
});

test('removeSermon REFUSES TO DELETE THE BYTES when the tombstone was refused', async () => {
  // The worst ordering available, and it was the shipped one: tombstone discarded, blobs deleted regardless.
  // The sermon stays listed in every member's app and its file is gone from every host — a broken player
  // rather than a removed sermon, and nothing can put the bytes back.
  const deletes = [];
  const sermon = { id: 's1', sha256: 'abc123', hosts: ['https://one.example', 'https://two.example'] };
  const no = await runLifted('async removeSermon(s)', 'removeSermon', false,
    { fetch: async (u, o) => { deletes.push(u + ' ' + (o && o.method)); return { ok: true }; } }, [sermon]);
  await assert.rejects(no.call(), /nothing was deleted/,
    'removeSermon still swallows a refused tombstone');
  assert.deepEqual(deletes, [],
    'THE BLOB BYTES WERE DELETED AFTER A REFUSED TOMBSTONE. The sermon is still in every member\'s app and ' +
    'the file it points at no longer exists. Deletes attempted: ' + JSON.stringify(deletes));
  // and the accepted case still reclaims the space, or this "fix" has quietly disabled removal
  const yes = await runLifted('async removeSermon(s)', 'removeSermon', { id: 'evt' },
    { fetch: async (u, o) => { deletes.push(u + ' ' + (o && o.method)); return { ok: true }; } }, [sermon]);
  assert.equal(await yes.call(), true);
  assert.equal(deletes.length, 2, 'an ACCEPTED tombstone no longer reclaims the stored bytes: ' + JSON.stringify(deletes));
});

test('publishSermon still rejects on a refusal — the one that was already right', async () => {
  // It threw before this round and must go on throwing. Named here so that "the four that were wrong" can
  // never be tidied into "all of them behave the same" by making this one match the others.
  const no = await runLifted('publishSermon(s)', 'publishSermon', false, { actingChurch: '' }, [{ title: 'Sunday', sha256: 'aa', host: 'h' }]);
  await assert.rejects(no.call(), /every relay rejected it/, 'publishSermon has lost its refusal check');
});

// ── THE TWO GRANTS THAT WERE WITHDRAWN, AND ARE RE-GRANTED (option A, PLAN-delegated-steward-publishing.md) ─
// AUDIT-steward-doc-rules-2026-09-22, F1 + F2, owner's decision "go with B", withdrew `trinityone/sermon:`
// and `trinityone/backup-meta:` to church-key-only because EVERY shipped reader of both filtered
// `authors:[churchpub]` — a delegated steward's copy was stored, served to nobody, and reported as a
// success. Option A fixed the readers (2026-09-25) and these two guards — added the SAME day as the
// withdrawal, to stop a delegated console asking at all — came out again: `publishSermon`/`removeSermon` now
// really ask the relay on every console, and report whatever it answers, exactly like every other write in
// this file. WHICH stewards the relay actually grants this to (a content steward, not a finance-only one)
// is the relay's own decision and is proven in scripts/six-steward-doc-types-have-rules.test.mjs; this
// harness has no roster or capability concept, so `answer` stands in for whatever the relay decided.
test('publishSermon now really asks the relay on a DELEGATED console too, and reports the answer', async () => {
  const yes = await runLifted('publishSermon(s)', 'publishSermon', { id: 'evt' }, { actingChurch: 'CHURCHPUB' }, [{ title: 'Sunday', sha256: 'aa', host: 'h' }]);
  const out = await yes.call();
  assert.ok(out && out.sha256 === 'aa',
    'A DELEGATED CONSOLE CAN NO LONGER PUBLISH A SERMON AT ALL — the 2026-09-22 short-circuit is still here, ' +
    'and the relay/reader re-grant this commit makes is inert without this half. Got: ' + JSON.stringify(out));
  assert.equal(yes.published.length, 1, 'a delegated console did not even try to publish');
  // …and a genuine relay refusal (a steward the church has not given the content capability) still throws,
  // exactly as it always has for the owner's own console.
  const no = await runLifted('publishSermon(s)', 'publishSermon', false, { actingChurch: 'CHURCHPUB' }, [{ title: 'Sunday', sha256: 'aa', host: 'h' }]);
  await assert.rejects(no.call(), /every relay rejected it/,
    'a genuine refusal on a delegated console is no longer reported honestly');
});

test('removeSermon now really asks the relay on a DELEGATED console too, and only deletes bytes when the tombstone lands', async () => {
  const sermon = { id: 's1', sha256: 'abc123', hosts: ['https://one.example', 'https://two.example'] };
  const deletes = [];
  const yes = await runLifted('async removeSermon(s)', 'removeSermon', { id: 'evt' },
    { actingChurch: 'CHURCHPUB', fetch: async (u, o) => { deletes.push(u + ' ' + (o && o.method)); return { ok: true }; } }, [sermon]);
  assert.equal(await yes.call(), true,
    'A DELEGATED CONSOLE CAN NO LONGER REMOVE A SERMON AT ALL — the 2026-09-22 short-circuit is still here');
  assert.equal(deletes.length, 2, 'an accepted tombstone on a delegated console no longer reclaims the stored bytes: ' + JSON.stringify(deletes));
  // …and a genuine refusal still deletes NOTHING — the ordering guard above this line (tombstone first,
  // bytes only if it landed) must still hold now that a delegated console reaches it at all.
  const deletes2 = [];
  const no = await runLifted('async removeSermon(s)', 'removeSermon', false,
    { actingChurch: 'CHURCHPUB', fetch: async (u, o) => { deletes2.push(u + ' ' + (o && o.method)); return { ok: true }; } }, [sermon]);
  await assert.rejects(no.call(), /nothing was deleted/, 'a refused tombstone on a delegated console is no longer reported honestly');
  assert.deepEqual(deletes2, [],
    'THE BLOB BYTES WERE DELETED ON A DELEGATED CONSOLE OVER A REFUSED TOMBSTONE: ' + JSON.stringify(deletes2));
});

// ⚠ THIS TEST WAS INVERTED FOR HALF A DAY ON 2026-09-25 AND IS BACK. Option A phase 1 taught
// subscribeBackupMeta to read a rostered steward's church-tagged copy and re-granted the write at the
// relay, so this was renamed "setBackupMeta now really asks the relay on a DELEGATED console too" and
// asserted the opposite. The owner withdrew the grant the same day on measured evidence: a delegate cannot
// export a backup at all, so the only press they could land was the cadence segment — which publishes this
// console's LOCAL last-backup time (0 on a device that never exported) as "backed up just now", clearing
// every steward's overdue nudge over a backup nobody took. Full note on setBackupMeta in src/steward.src.js.
test('setBackupMeta answers false on a DELEGATED console, without asking', async () => {
  const no = await runLifted('setBackupMeta(at, remind)', 'setBackupMeta', { id: 'evt' }, { actingChurch: 'CHURCHPUB' }, [1700000000, 'monthly']);
  assert.equal(await no.call(), false,
    'setBackupMeta reports success on a delegated console. subscribeBackupMeta filters authors:[churchpub], ' +
    'so a steward-authored record resets NOBODY\'s overdue nudge — the screen must say so.');
  assert.equal(no.published.length, 0, 'it published a record the relay refuses and no console reads');
  // …and the owner console is untouched: it still asks, and still reports what it got.
  const yes = await runLifted('setBackupMeta(at, remind)', 'setBackupMeta', { id: 'evt' }, { actingChurch: '' }, [1700000000, 'monthly']);
  assert.notEqual(await yes.call(), false, 'the owner console now believes it cannot save the shared backup record either');
  assert.equal(yes.published.length, 1, 'the owner console stopped publishing the shared backup record');
});


test('mediaEncryptor REFUSES TO ENCRYPT when the key envelope was refused', async () => {
  // THE ONE WHOSE CONSEQUENCE IS PERMANENT. This awaited the envelope publish, threw the answer away, and
  // returned a working encryptor regardless — so the sermon upload in app/stew-dashboard.jsx encrypted the
  // file with a key whose envelope never reached a relay and pushed the ciphertext to every host. Nobody,
  // the church included, can ever decrypt it. The mint gate a few lines above this one exists to prevent
  // exactly that loss; this is the same loss reached through the other door.
  const decls = 'let _mediaKeyHex = "aa".repeat(32); let _mediaKeyRing = [_mediaKeyHex]; let _mediaKeyChecked = true;';
  const env = {
    _isRelayAuthed: () => true,
    _sealEach: async (payload, targets) => Object.fromEntries(targets.map(t => [t, 'WRAPPED'])),
    nip44e: () => 'WRAPPED', nip44ck: () => new Uint8Array(32),
    _unhex: (h) => new Uint8Array(h.length / 2), _hex: () => 'bb'.repeat(32),
  };
  const no = await runLifted('async mediaEncryptor(memberPubs)', 'mediaEncryptor', false, env, [['m1', 'm2']], decls);
  await assert.rejects(no.call(), /media key could not be saved/,
    'THE CONSOLE STILL HANDS BACK AN ENCRYPTOR OVER A REFUSED ENVELOPE. Everything encrypted with it is ' +
    'unplayable for ever, and the upload proceeds and succeeds.');
  const yes = await runLifted('async mediaEncryptor(memberPubs)', 'mediaEncryptor', { id: 'evt' }, env, [['m1', 'm2']], decls);
  const fn = await yes.call();
  assert.equal(typeof fn, 'function', 'an ACCEPTED envelope no longer yields an encryptor — encryption is now off for everyone');
  assert.equal(yes.published.length, 1, 'the envelope was not published at all');
});

const MEDIA_ENV = (extra = '') => `
  let _mediaKeyRing = [];
  let _mediaKeyChecked = true;
  const _isRelayAuthed = () => true;
  const _unhex = (h) => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
  const _hex = (b) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  const _sealEach = async () => ({});
  const nip44e = () => 'sealed'; const nip44ck = () => 'ck';
  ${extra}`;

test('ENCRYPTION: a delegated console recovers the key from ITS OWN entry in the church’s envelope', async () => {
  // THE HALF THAT ACTUALLY LETS A DELEGATE ENCRYPT, and the one the tests above cannot see: they hand the
  // engine a key that is already in hand. This drives the code that PUTS it there. subscribeMediaKey read
  // `o.keys[pub]` — and on a delegated console `pub` is the CHURCH, so it tried to open the entry sealed to
  // the church with the steward's key, failed silently inside the handler's own catch, left _mediaKeyHex
  // null, and mediaEncryptor then tried to mint. Reverting that one lookup leaves every other test in this
  // file green, which is why this one exists (the same shape as the hub-wiring gap on 2026-09-25).
  const CHURCH = 'CP', STEWARD = 'STEWARD_PUB';
  const [, DEC, CK] = BUNDLE.match(/const plain = (\w+)\(mine, (\w+)\(sk, e\.pubkey\)\)/) || [];
  assert.ok(DEC && CK, 're-anchor this test: could not find the media-key unseal call in the bundle');
  const [, GP] = BUNDLE.match(/function _myOwnPub\(\) \{\s*try \{\s*return (\w+)\(sk\)/) || [];
  assert.ok(GP, 're-anchor this test: _myOwnPub no longer derives our pubkey from sk');
  let handlers = null;
  const peek = '__peek' + Math.random().toString(36).slice(2);
  const r = await runLifted('subscribeMediaKey()', 'subscribeMediaKey', { id: 'evt' }, {
    actingChurch: 'CHURCHPUB', pub: CHURCH, sk: 'STEWARD_SK',
    [GP]: () => STEWARD,   // ← the emitted name too: _myOwnPub calls `getPublicKey2` in today's bundle
    relays: () => ['wss://r'],
    pool: { subscribeMany: (_r, _f, h) => { handlers = h; return { close() {} }; } },
    // identity "decrypt" that records WHICH conversation key was used, so the test can prove it opened the
    // entry addressed to us rather than one it could never have opened.
    // ⚠ BIND THE NAMES THE BUNDLE ACTUALLY USES. esbuild renames these imports — `nip44d` is emitted as
    // `decrypt3` and `nip44ck` as `getConversationKey` — and the handler swallows a ReferenceError in its
    // own try/catch, so stubbing the SOURCE names leaves _mediaKeyHex null and looks exactly like the bug.
    // Read them out of the bundle instead of hard-coding, because the numeric suffixes move on every build.
    [DEC]: (payload, ck) => (payload.startsWith(ck.replace('ck:', '') + '/') ? payload.split('/')[1] : (() => { throw new Error('wrong recipient'); })()),
    [CK]: (_sk, other) => 'ck:' + other,
  }, [], `let _mediaKeyHex = null; let _mediaKeyRing = []; let _mediaKeyDocKeys = null; let _mediaKeyPushRefused = 'x'; let _mediaKeyChecked = false;
     ${fnBody(BUNDLE, 'function _myOwnPub() {', '_myOwnPub')}
     globalThis['${peek}'] = () => _mediaKeyHex;`);
  r.fn();
  assert.ok(handlers, 're-anchor this test: subscribeMediaKey did not open a subscription');
  // The church's envelope: a ring sealed to the CHURCH, and another sealed to US. Only ours is openable.
  handlers.onevent({ pubkey: CHURCH, content: JSON.stringify({ keys: {
    [CHURCH]:  CHURCH  + '/' + JSON.stringify(['cc'.repeat(32)]),
    [STEWARD]: CHURCH  + '/' + JSON.stringify(['ab'.repeat(32)]),
  }, rev: 1 }) });
  assert.equal(globalThis[peek](), 'ab'.repeat(32),
    'A DELEGATED CONSOLE DID NOT RECOVER THE CHURCH’S MEDIA KEY from the copy sealed to it. mediaEncryptor ' +
    'then has nothing to encrypt with, so an encrypted sermon is refused — or, before this fix, it minted a ' +
    'fresh key and tried to republish the envelope. Got: ' + globalThis[peek]());
  delete globalThis[peek];
});

test('ENCRYPTION: a delegated console USES the church’s key and never rewrites the envelope', async () => {
  // The obvious reading of "let a delegate encrypt" — give them `trinityone/mediakey:` — is the dangerous
  // one. mediaEncryptor MINTS a fresh key when it cannot read one, and replacing the envelope makes every
  // sermon the church encrypted before now undecryptable, for ever. They do not need to write it: the
  // church seals the key ring to [church, ...members] and a delegated steward is normally also a member, so
  // a copy addressed to them already exists. Members then play a delegate's sermon with the same key they
  // already hold, which is why this half needs no member-app change.
  const r = await runLifted('async mediaEncryptor(memberPubs)', 'mediaEncryptor', { id: 'evt' },
    { actingChurch: 'CHURCHPUB' }, [[]], MEDIA_ENV(`let _mediaKeyHex = '${'ab'.repeat(32)}';`));
  const enc = await r.call();
  assert.equal(typeof enc, 'function', 'a delegated console got no encryptor even though it holds the key');
  assert.equal(r.published.length, 0,
    'A DELEGATED CONSOLE REPUBLISHED THE MEDIA-KEY ENVELOPE. The relay refuses it (church-key-only, ' +
    'deliberately), so the upload fails — and if it ever stopped refusing, the envelope would be sealed ' +
    'with the STEWARD\'s key and no member could open it. Published: ' + JSON.stringify(r.published));
  const out = await enc(new Uint8Array([1, 2, 3]));
  assert.ok(out instanceof Uint8Array && out.length === 12 + 3 + 16,
    'the delegated encryptor does not produce iv||ciphertext like the church\'s — a sermon encrypted with ' +
    'it would not play. Got ' + (out && out.length) + ' bytes');
});

test('ENCRYPTION: …and says so plainly when the church has shared no key with this account', async () => {
  const r = await runLifted('async mediaEncryptor(memberPubs)', 'mediaEncryptor', { id: 'evt' },
    { actingChurch: 'CHURCHPUB' }, [[]], MEDIA_ENV('let _mediaKeyHex = null;'));
  await assert.rejects(r.call(), /hasn’t shared its media key with this account/,
    'a delegate with no key is told the mint or the save failed — neither is true and neither is something ' +
    'they can act on. The accurate answer names what is missing and who can fix it.');
  assert.equal(r.published.length, 0, 'it tried to mint and publish a key anyway');
});

test('ENCRYPTION: the OWNER console still mints and publishes the envelope — unchanged', async () => {
  const r = await runLifted('async mediaEncryptor(memberPubs)', 'mediaEncryptor', { id: 'evt' },
    { actingChurch: '' }, [[]], MEDIA_ENV('let _mediaKeyHex = null;'));
  assert.equal(typeof await r.call(), 'function', 'the owner console can no longer encrypt at all');
  assert.equal(r.published.length, 1,
    'THE CHURCH STOPPED PUBLISHING ITS MEDIA-KEY ENVELOPE — no member would ever receive the key. ' +
    'Published: ' + r.published.length);
});

test('THE OWNER’S DELETE NAMES EVERY COPY, and a delegate’s still names only the church’s', () => {
  // AUDIT-delegated-publishing-2026-09-25 H2/M1, the writer half. feChurch has stamped `['for', <church>]`
  // on a DELEGATED console's tombstones since 2026-08-28, so a steward can withdraw the church's copy. The
  // reverse never existed, and option A made it matter: a steward editing a sermon creates a second version
  // under their own key, so the owner pressing Remove withdrew only half of it.
  const body = fnBody(BUNDLE, 'function feChurch(tmpl, signer) {', 'feChurch');
  // esbuild renames the import (`finalizeEvent2` in today's bundle) — bind whatever name the lifted code
  // actually calls, or this throws a ReferenceError that looks nothing like the assertion it breaks.
  const [, FE] = body.match(/return (\w+)\(_monotonic/) || [];
  assert.ok(FE, 're-anchor this test: feChurch no longer signs through _monotonic');
  const lift = (acting) => new Function('actingChurch', '_monotonic', FE, 'sk',
    body + '\nreturn feChurch;')(acting, (t) => t, (t) => t, 'SK');
  const forsOf = (e) => (e.tags || []).filter(t => t[0] === 'for').map(t => t[1]);

  const ownerDel = lift('')({ tags: [['d', 'trinityone/sermon:s9'], ['deleted', '1']] });
  assert.deepEqual(forsOf(ownerDel), ['*'],
    'THE OWNER’S TOMBSTONE STILL NAMES ONLY ITS OWN COPY. A steward’s edited version survives it on every ' +
    'screen, and the blob delete runs anyway. Tags: ' + JSON.stringify(ownerDel.tags));

  const delegateDel = lift('CHURCHPUB')({ tags: [['d', 'trinityone/sermon:s9'], ['deleted', '1']] });
  assert.deepEqual(forsOf(delegateDel), ['CHURCHPUB'],
    'a DELEGATE’s tombstone now asks for every copy — that is round 9, reopened: one steward’s tidy-up ' +
    'would take a colleague’s document with it. Tags: ' + JSON.stringify(delegateDel.tags));

  const ownerWrite = lift('')({ tags: [['d', 'trinityone/sermon:s9']] });
  assert.deepEqual(forsOf(ownerWrite), [], 'an ordinary write is being tagged as a withdrawal');

  const already = lift('')({ tags: [['d', 'x'], ['deleted', '1'], ['for', 'SOMEONE']] });
  assert.deepEqual(forsOf(already), ['SOMEONE'], 'it overrode a `for` the caller had already chosen');
});

test('THE BYTES: the blob auth names the church on a delegated console, and only there', async () => {
  // AUDIT-delegated-publishing-2026-09-25 H1. A sermon is a FILE plus a document. The document goes through
  // feChurch, which stamps `['church', actingChurch]`; the FILE goes to a host as a kind-24242 Authorization
  // header that never did — so the relay's `_blobUploader`, which has always accepted
  // `stewardCan(ev.pubkey, tag('church'), 'any')`, had nothing to match on and answered 401. Every reader
  // option A widened then had nothing to read. The relay half of this contract is measured against a live
  // gateway in scripts/a-delegated-stewards-sermons-reach-a-member-phone.test.mjs; this is the client half.
  const body = fnBody(BUNDLE, 'function _blobAuthTags(tags) {', '_blobAuthTags');
  const lift = (acting) => new Function('actingChurch', body + '\nreturn _blobAuthTags;')(acting);
  const base = [['t', 'upload'], ['x', 'abc'], ['expiration', '123']];

  const delegated = lift('CHURCHPUB')(base);
  assert.deepEqual(delegated.find(t => t[0] === 'church'), ['church', 'CHURCHPUB'],
    'A DELEGATED CONSOLE STILL SENDS AN UNATTRIBUTED UPLOAD — the host answers 401 and the steward is told ' +
    'to check a connection that is working. Tags: ' + JSON.stringify(delegated));

  const owner = lift('')(base);
  assert.deepEqual(owner, base,
    'the OWNER console now tags its own uploads too. Harmless at this relay, but it is a behaviour change ' +
    'nobody asked for and _blobUploader takes the church-key branch anyway: ' + JSON.stringify(owner));

  const already = lift('CHURCHPUB')([...base, ['church', 'SOMEONE_ELSE']]);
  assert.equal(already.filter(t => t[0] === 'church').length, 1,
    'it appended a second church tag; _blobUploader reads the FIRST, so the two would disagree silently');
});

test('THE BYTES: both blob doors actually go through it — upload AND delete', () => {
  // Against the BUNDLE, where esbuild removes dead code: a call site that stopped using the helper stops
  // appearing here (CLAUDE.md rule 3's parenthetical). Two doors, and the delete one is the half that was
  // still promising "the stored file is deleted" over a 401.
  const uses = (BUNDLE.match(/_blobAuthTags\(\[\[/g) || []).length;
  assert.equal(uses, 2,
    'expected BOTH the upload and the delete auth to name the church, found ' + uses + '. If it is 1, the ' +
    'likely survivor is the upload and a delegate\'s Remove is silently orphaning the bytes again.');
  // esbuild normalises string quotes, so match either spelling rather than the one src/ happens to use.
  assert.match(BUNDLE, /tags: _blobAuthTags\(\[\[["']t["'], ["']upload["']\]/, 'the UPLOAD auth no longer names the church');
  assert.match(BUNDLE, /tags: _blobAuthTags\(\[\[["']t["'], ["']delete["']\]/, 'the DELETE auth no longer names the church');
});

test('setBackupMeta NEVER INVENTS A BACKUP TIME — an unknown `at` publishes 0, not now()', async () => {
  // It published `at: at || now()` until 2026-09-25. `setFrequency` (the cadence segment) passes this
  // console's LOCAL `trinityone.lastBackupAt`, which is 0 on any device that has not itself exported — a
  // second steward's laptop, a reinstall, a church that has never backed up at all. So changing the
  // reminder from Monthly to Weekly published "backed up just now"; every console takes max(prev, at); and
  // every steward's overdue nudge cleared over a backup nobody had taken. Found by
  // AUDIT-delegated-publishing-2026-09-25 (M2) as a delegate hazard, and it was never only that: the
  // church's OWN console does it too, which is why withdrawing that grant did not close it.
  const unknown = await runLifted('setBackupMeta(at, remind)', 'setBackupMeta', { id: 'evt' }, { actingChurch: '' }, [0, 'weekly']);
  await unknown.call();
  assert.equal(unknown.published.length, 1, 're-anchor this test: the owner console did not publish at all');
  const sent = JSON.parse(unknown.published[0].content);
  assert.equal(sent.at, 0,
    'A BACKUP TIME WAS INVENTED. The caller knew of no backup and this published `' + sent.at + '`, which ' +
    'every other steward\'s console will read as "the church is backed up" and stop nudging over. 0 is the ' +
    'honest answer and the screen already renders it as "Last backup: never".');
  assert.equal(sent.remind, 'weekly', 'the cadence the steward actually chose was lost');

  // …and a REAL backup time is still carried through untouched — the fix must not blank what is known.
  const known = await runLifted('setBackupMeta(at, remind)', 'setBackupMeta', { id: 'evt' }, { actingChurch: '' }, [1700000000, 'monthly']);
  await known.call();
  assert.equal(JSON.parse(known.published[0].content).at, 1700000000,
    'a genuine backup time was discarded — the church would be told it has never backed up');
});

test('setBackupMeta hands its caller the refusal instead of swallowing it', async () => {
  const no = await runLifted('setBackupMeta(at, remind)', 'setBackupMeta', false, {}, [1700000000, 'monthly']);
  assert.equal(await no.call(), false,
    'setBackupMeta no longer reports a refusal, so the console that took the backup is the only one that ' +
    'believes the church is backed up while every other steward still sees it overdue');
  const yes = await runLifted('setBackupMeta(at, remind)', 'setBackupMeta', { id: 'evt' }, {}, [1700000000, 'monthly']);
  assert.notEqual(await yes.call(), false, 'an accepted write is reported as a failure');
});

// ── the one where there is nothing to lie about, said out loud ───────────────────────────────────────────
test('pinSermon has no success label to put over a refusal', () => {
  // Rule 4: this is a claim, so it is checked rather than asserted in prose. The featured-sermon star is
  // rendered from `pinnedId`, and `pinnedId` is set ONLY by subscribePinnedSermon — i.e. by what the relay
  // served back. A refused pin therefore leaves the star unlit on its own, with no toast to contradict it,
  // which is why pinSermon is not in the list above.
  const panelSrc = fnBody(STEW, 'function DashSermons(', 'DashSermons');
  assert.match(panelSrc, /setPinnedId\(p && p\.id\)/,
    'the featured-sermon state is no longer fed from subscribePinnedSermon. If it is now set optimistically ' +
    'from the click, a refused pin lights the star anyway and pinSermon needs the same treatment as the four above.');
  const sets = panelSrc.match(/setPinnedId\(/g) || [];
  assert.equal(sets.length, 1,
    'setPinnedId is called in ' + sets.length + ' places — it used to be exactly one, the relay subscription. ' +
    'A second writer is an optimistic update, which is a success label by another name.');
});

// ── THE OTHER TWO SCREENS, AT THE POINT OF USE (CLAUDE.md rule 1) ────────────────────────────────────────
// AUDIT-steward-doc-rules-2026-09-22, finding F5. Of the three console screen changes in `2ff0f43`, only the
// chat-tags panel above had a test that failed when the feature was deleted FROM THE SCREEN. Reverting the
// other two to their pre-fix form left this file 8 pass / 0 fail:
//
//   · DashSermons' Remove confirm, back to `window.Steward.removeSermon(pendingDelete); setPendingDelete(null);`
//     — and that revert is now WORSE than the code it came from, because removeSermon THROWS: the sheet
//     closes, nothing is shown, and the steward believes the sermon was removed.
//   · DashBackup, back to fire-and-forget with no "still overdue" sentence.
//
// Both are driven below through the REAL components, compiled with the real esbuild from app/*.jsx and
// rendered — rule 3, because those files ship unbundled and a text match on them survives `false && `.
const STUB = () => function Stub(p) { return { type: 'div', props: {}, kids: [p && p.children].flat().filter(Boolean) }; };
const BASE_GLOBALS = (React, win) => ({
  React, window: win,
  Icon: () => null, SkBadge: STUB(), SkPill: STUB(), SkToggle: STUB(),
  Panel: ({ children }) => children, DismissibleNote: ({ children }) => children,
  useStewDialog: () => ({ current: null }), useStewModalOpen: () => {},
  location: { search: '' },
  setTimeout, clearTimeout, URL, URLSearchParams, Blob,
  Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, console, Promise, RegExp,
});
const ticks = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };

test('THE SCREEN: a refused sermon removal shows the reason, and does not close in silence', async () => {
  const { React, draw } = miniReact();
  const calls = [];
  const win = {
    Steward: {
      subscribeSermons: (cb) => { cb([{ id: 's1', title: 'Sunday morning', sha256: 'aa', size: 10, mime: 'audio/mp4' }]); return () => {}; },
      subscribePinnedSermon: (cb) => { cb(null); return () => {}; },
      subscribeMediaKey: () => () => {},
      mediaHosts: () => [],
      // THE ENGINE'S REAL ANSWER FOR A DELEGATED CONSOLE, verbatim from src/steward.src.js — not a stand-in
      // for the decision under test, which is what the SCREEN does with a rejection.
      removeSermon: async (s) => { calls.push(s && s.id); throw new Error('Only the church’s own console can remove a sermon. Nothing was deleted.'); },
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {},
  };
  const mod = loadScreen('app/stew-dashboard.jsx', ['DashSermons'], BASE_GLOBALS(React, win));
  const render = () => draw(mod.DashSermons, {});
  // TWO DRAWS BEFORE READING. The subscription that fills the list runs in an EFFECT, and this harness runs
  // effects after the draw — so the first tree is the empty-list one every real console shows for a moment.
  let tree = render(); tree = render();
  const press = async (pred, what) => {
    const hits = find(tree, n => n.type === 'button' && pred(n));
    assert.equal(hits.length, 1, `re-anchor this test: expected exactly one ${what}, found ${hits.length}`);
    hits[0].props.onClick();
    await ticks();
    tree = render();
  };
  await press(n => (n.props && n.props['aria-label']) === 'Remove sermon', 'Remove (trash) button on the sermon row');
  // reads(), not texts(): texts() also collects string PROPS, so the confirm button reads 'sk-btn Remove'
  // and the row's trash button reads 'Remove Remove sermon' from its title and aria-label. reads() is what a
  // human sees, which makes the dialog's button the only one whose visible text IS 'Remove'.
  await press(n => reads(n).trim() === 'Remove', 'Remove button in the confirmation dialog');
  await ticks();
  tree = render();
  const said = reads(tree);
  assert.deepEqual(calls, ['s1'], 'the confirmation did not reach removeSermon at all — re-anchor this test');
  assert.match(said, /Only the church’s own console can remove a sermon/,
    'THE SHEET CLOSED AND SAID NOTHING. removeSermon rejects; if the confirm handler drops that rejection ' +
    'the steward watches the dialog close exactly as it does on success and believes the sermon is gone — ' +
    'it is still there, and so is its file. Screen read: ' + said);
});

test('THE SCREEN: a backup whose church-wide record was refused says so, and names WHICH refusal', async () => {
  // Three directions, because a fix that printed the sentence unconditionally would pass a one-sided test
  // while telling every owner console its working backup record had failed.
  const run = async ({ metaAnswer, delegated, onExport }) => {
    const { React, draw } = miniReact();
    const doc = { createElement: () => ({ href: '', download: '', click() {}, remove() {} }), body: { appendChild() {} } };
    const win = {
      Steward: {
        actingChurch: delegated ? 'CHURCHPUB' : '',
        exportChurchData: async () => { if (onExport) onExport(); return { data: 'x', binary: false, mime: 'application/json', count: 42, filename: 'b.json', encrypted: true, media: 0 }; },
        setBackupMeta: async () => metaAnswer,
        subscribeBackupMeta: () => () => {},
        mediaSize: async () => ({ count: 0, bytes: 0 }),
      },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      addEventListener() {}, removeEventListener() {},
      document: doc,
    };
    const mod = loadScreen('app/stew-dashboard.jsx', ['DashBackup'], { ...BASE_GLOBALS(React, win), document: doc });
    const render = () => draw(mod.DashBackup, {});
    let tree = render();
    const press = async (label) => {
      const hits = find(tree, n => n.type === 'button' && reads(n).trim() === label);
      assert.equal(hits.length, 1, `re-anchor this test: expected exactly one "${label}" button, found ${hits.length}`);
      hits[0].props.onClick();
      await ticks(12);
      tree = render();
    };
    return { press, said: () => reads(tree) };
  };

  // 1. the owner console, record accepted: the plain success and NOTHING else.
  const ok = await run({ metaAnswer: { id: 'evt' }, delegated: false });
  await ok.press('Back up church data');
  assert.match(ok.said(), /Saved 42 records/, 'the backup success message is gone — re-anchor this test. Screen read: ' + ok.said());
  assert.doesNotMatch(ok.said(), /overdue/,
    'a backup record that SAVED is being reported as not saved. Screen read: ' + ok.said());

  // 2. the owner console, record refused by every relay: the success AND the consequence.
  const no = await run({ metaAnswer: false, delegated: false });
  await no.press('Back up church data');
  assert.match(no.said(), /Saved 42 records/, 'the file really did save and the screen must still say so. Screen read: ' + no.said());
  assert.match(no.said(), /the shared backup record could not be saved/,
    'THE CONSEQUENCE IS BACK TO BEING INVISIBLE. This console is then the only one that believes the church ' +
    'is backed up, while every other steward goes on seeing "overdue". Screen read: ' + no.said());

  // 3. THE DELEGATED CONSOLE NEVER REACHES THE RELAY AT ALL — AUDIT-steward-doc-rules-round5-2026-09-23
  // finding 3. This test used to mock exportChurchData to succeed even when delegated, and asserted "the
  // file saves on a delegated console too" — which is not true against the real relay: /export is
  // NIP-98-authed to the church key only (_exportAuth, scripts/gateway.mjs), the same gate as
  // backup-meta:, so a delegate's export was ALWAYS going to be refused. The mock's convenient success
  // hid the defect the round-5 audit measured: the button rendered with no padlock and no warning, and
  // only answered "Backup failed — the relay returned 401" after a real round trip. The fix asks BEFORE
  // the press, not after the relay answers — so exportChurchData must not even be attempted.
  let exportCalls = 0;
  const dele = await run({ metaAnswer: false, delegated: true, onExport: () => exportCalls++ });
  await dele.press('Back up church data');
  assert.equal(exportCalls, 0,
    'THE DELEGATE\'S PRESS REACHED THE RELAY. exportChurchData was called ' + exportCalls + ' time(s) — the ' +
    'church key gate on /export refuses every delegate, so attempting it buys nothing but a slower false hope.');
  assert.doesNotMatch(dele.said(), /Saved 42 records/,
    'A DELEGATED CONSOLE WAS TOLD THE BACKUP SAVED, which it never can. Screen read: ' + dele.said());
  assert.match(dele.said(), /Only the church’s own console can back up or restore this church’s data/,
    'the delegate’s press did not show the owner-only message before ever touching the relay. Screen read: ' + dele.said());
});

test('THE SCREEN: "Restore this backup" is locked on a delegated console too, before any file is even read', async () => {
  // AUDIT-steward-doc-rules-round5-2026-09-23 finding 3, the other control gated by this fix.
  // restoreChurchData -> POST /import goes through the same church-key-only _exportAuth as /export.
  class FakeFileReader {
    set onload(fn) { this._onload = fn; }
    set onerror(fn) { this._onerror = fn; }
    readAsArrayBuffer() { this.result = new Uint8Array([1]).buffer; setTimeout(() => this._onload && this._onload(), 0); }
  }
  const run = async ({ delegated, onRestore }) => {
    const { React, draw } = miniReact();
    const win = {
      Steward: {
        actingChurch: delegated ? 'CHURCHPUB' : '',
        restoreChurchData: async () => { if (onRestore) onRestore(); return { imported: 1 }; },
        subscribeBackupMeta: () => () => {},
        mediaSize: async () => ({ count: 0, bytes: 0 }),
      },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      addEventListener() {}, removeEventListener() {},
      FileReader: FakeFileReader,
    };
    const mod = loadScreen('app/stew-dashboard.jsx', ['DashBackup'], { ...BASE_GLOBALS(React, win), FileReader: FakeFileReader });
    const render = () => draw(mod.DashBackup, {});
    let tree = render();
    const opener = find(tree, n => n.type === 'div' && typeof n.props.onClick === 'function' && reads(n).includes('Restore or clone from a backup'));
    assert.equal(opener.length, 1, `re-anchor this test: expected exactly one restore-section opener, found ${opener.length}`);
    opener[0].props.onClick();
    await ticks();
    tree = render();
    const picker = find(tree, n => n.type === 'input' && n.props.type === 'file');
    assert.equal(picker.length, 1, 're-anchor this test: no file input found after opening the restore section');
    picker[0].props.onChange({ target: { files: [{ name: 'b.json' }], value: '' } });
    await ticks(4);
    tree = render();
    const press = async (label) => {
      const hits = find(tree, n => n.type === 'button' && reads(n).trim() === label);
      assert.equal(hits.length, 1, `re-anchor this test: expected exactly one "${label}" button, found ${hits.length}`);
      hits[0].props.onClick();
      await ticks(12);
      tree = render();
    };
    return { press, said: () => reads(tree) };
  };

  // control: the owner console really does reach restoreChurchData.
  let ownerCalls = 0;
  const ok = await run({ delegated: false, onRestore: () => ownerCalls++ });
  await ok.press('Restore this backup');
  assert.equal(ownerCalls, 1, 're-anchor: the owner console never reached restoreChurchData — the harness is broken');

  // the finding: a delegated console must not reach it at all.
  let deleCalls = 0;
  const dele = await run({ delegated: true, onRestore: () => deleCalls++ });
  await dele.press('Restore this backup');
  assert.equal(deleCalls, 0,
    'THE DELEGATE\'S PRESS REACHED THE RELAY. restoreChurchData was called ' + deleCalls + ' time(s) — /import ' +
    'is church-key-only, so a delegate can never restore and must be told before picking a file, not after.');
  assert.match(dele.said(), /Only the church’s own console can back up or restore this church’s data/,
    'the delegate’s press did not show the owner-only message. Screen read: ' + dele.said());
});

test('THE SCREEN: changing the backup REMINDER says so too — the second caller of setBackupMeta', async () => {
  // AUDIT-steward-doc-rules-2026-09-22, finding F3. setBackupMeta has TWO callers in DashBackup, and the
  // commit that fixed the first one said in its permanent record that it had fixed both. This one — the
  // weekly / monthly / off segment — was still fire-and-forget inside a try/catch, so a steward picked
  // "Weekly", watched the segment move to Weekly, and every other console went on nudging monthly with
  // nothing on any screen saying so.
  const run = async ({ metaAnswer, delegated }) => {
    const { React, draw } = miniReact();
    const win = {
      Steward: {
        actingChurch: delegated ? 'CHURCHPUB' : '',
        setBackupMeta: async () => metaAnswer,
        subscribeBackupMeta: () => () => {},
        mediaSize: async () => ({ count: 0, bytes: 0 }),
      },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      addEventListener() {}, removeEventListener() {},
    };
    const mod = loadScreen('app/stew-dashboard.jsx', ['DashBackup'], BASE_GLOBALS(React, win));
    const render = () => draw(mod.DashBackup, {});
    let tree = render();
    const press = async (label) => {
      const hits = find(tree, n => n.type === 'button' && reads(n).trim() === label);
      assert.equal(hits.length, 1, `re-anchor this test: expected exactly one "${label}" button, found ${hits.length}`);
      hits[0].props.onClick();
      await ticks(12);
      tree = render();
    };
    return { press, said: () => reads(tree) };
  };

  const ok = await run({ metaAnswer: { id: 'evt' }, delegated: false });
  await ok.press('Weekly');
  assert.doesNotMatch(ok.said(), /could not be saved|Only the church/,
    'a cadence change every relay accepted is being reported as a failure. Screen read: ' + ok.said());

  const no = await run({ metaAnswer: false, delegated: false });
  await no.press('Weekly');
  assert.match(no.said(), /the shared backup record could not be saved/,
    'THE CADENCE CONTROL IS STILL FIRE-AND-FORGET. The segment moves to Weekly on this console while every ' +
    'other steward goes on being nudged monthly, and nothing on any screen says so. Screen read: ' + no.said());

  const dele = await run({ metaAnswer: false, delegated: true });
  await dele.press('Weekly');
  assert.match(dele.said(), /Only the church’s own console can save the shared backup record/,
    'a delegated console is told to check its connection over a refusal that is permanent. Screen read: ' + dele.said());
});

// ── THE CONTROL, NOT THE LABEL: NOT ONE BYTE GOES UP ON A CONSOLE THAT MAY NOT PUBLISH ───────────────────
// AUDIT-steward-doc-rules-round2-2026-09-22, finding R1. `publishSermon` refuses on a delegated console
// (the three engine tests above) — but `doUpload` called `uploadBlob` FIRST and `publishSermon` after, so
// the whole file went to the host and nothing then referenced it. Measured on the branch tip before this
// fix, driving the real panel:
//
//     ###ORDER###  ["uploadBlob","publishSermon"]        (Encrypt OFF)
//
// A sermon video is routinely hundreds of MB and orphan-blob GC is on the backlog, not built. Encrypt ON
// happened to be safe only because `mediaEncryptor` refuses one step earlier — luck, not a gate, so BOTH
// settings are driven below. The three controls that write `trinityone/sermon:` — Upload, Edit and Remove
// — are asserted to be MARKED as well, because a live control on a console that can never use it is the
// [[fix-the-control-not-the-label]] shape whatever the engine says afterwards.
// `caps` says which steward this is, when `delegated` — default ['content'] (a fully-granted delegate),
// matching every caller written before option A, Phase 2 (2026-09-25) existed. Pass `caps: ['finance']` (or
// `[]`) for the one case that is still real: a steward this church has NOT given the content capability.
async function sermonsPanel({ delegated, caps, encOn, list = [], mediaKey = true }) {
  const { React, draw } = miniReact();
  const order = [];
  const hasContent = !delegated || (caps || ['content']).includes('content');
  const win = {
    Steward: {
      actingChurch: delegated ? 'CHURCHPUB' : '',
      myStewardCaps: () => (delegated ? (caps || ['content']) : null),
      subscribeSermons: (cb) => { cb(list); return () => {}; },
      subscribePinnedSermon: (cb) => { cb(null); return () => {}; },
      subscribeMediaKey: () => () => {},
      mediaHosts: () => [],
      // THE ENGINE'S REAL ANSWERS, from src/steward.src.js — never a stand-in for the decision under test,
      // which is whether the SCREEN reaches them at all.
      //
      // mediaEncryptor IS UNCHANGED BY OPTION A: the media-key envelope (mediakey:) stays church-key-only
      // regardless of any capability a church can tick, so it refuses on ANY delegated console whatever
      // `caps` says — src/steward.src.js's mediaEncryptor asks the relay directly and mediakey: has no
      // steward branch at all.
      // THE ENGINE'S REAL RULE SINCE OPTION A (2026-09-25), not "is this console delegated". A delegate no
      // longer republishes the envelope — it reads the copy the church sealed to it as a member — so the
      // only thing that can refuse an encrypted upload now is having NO key to read. `mediaKey: false` is
      // the steward whose church never shared one (the non-member steward, owner's decision the same day).
      mediaEncryptor: async () => {
        order.push('mediaEncryptor');
        if (!mediaKey) throw new Error('Can’t encrypt this upload — your church hasn’t shared its media key with this account yet. Ask whoever holds the church key to add you as a member of the church, or to upload this one themselves. Nothing has been uploaded.');
        return async (b) => b;
      },
      uploadBlob: async () => { order.push('uploadBlob'); return { sha256: 'deadbeef', host: 'h', hosts: ['h'], mime: 'audio/mp4', size: 10, enc: false }; },
      // publishSermon/removeSermon ask the relay on EVERY console now (option A, Phase 2) and the relay
      // grants a CONTENT steward the same write as the church key — so a call that reaches this stub at all
      // is expected to SUCCEED; the panel's OWN pre-press gate (`_churchOnly`, tested via `marked`/`said`
      // below) is what must stop the press from ever reaching here for a steward without content.
      publishSermon: async (d) => { order.push('publishSermon'); return { id: 's9', ...d }; },
      pinSermon: async () => { order.push('pinSermon'); return { id: 'x' }; },
      removeSermon: async () => { order.push('removeSermon'); return true; },
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {},
    useStewardMembers: () => [],
    useStewardChurch: () => ({ features: { encryptComms: encOn } }),
    useStewardConn: () => 0,
  };
  const mod = loadScreen('app/stew-dashboard.jsx', ['DashSermons'], BASE_GLOBALS(React, win));
  const render = () => draw(mod.DashSermons, {});
  // TWO DRAWS: the sermon list arrives through an effect, and this harness runs effects after the draw.
  let tree = render(); tree = render();
  const btn = (pred, what) => {
    const hits = find(tree, n => n.type === 'button' && pred(n));
    assert.equal(hits.length, 1, `re-anchor this test: expected exactly one ${what}, found ${hits.length}`);
    return hits[0];
  };
  return {
    order,
    btn,
    press: async (pred, what) => { btn(pred, what).props.onClick(); await ticks(20); tree = render(); },
    marked: (pred, what) => !!(btn(pred, what).props || {})['aria-disabled'],
    // THE OTHER TWO MARKERS, added for AUDIT-steward-doc-rules-round3-2026-09-22 finding F3, which measured
    // that deleting either of them left this file 21/0. The padlock is read off the TREE, not off the
    // source: Icon is stubbed to render nothing, but the harness keeps the component node with its props,
    // so the glyph is visible as `props.name === 'lock'` and rule 3 is not touched.
    padlocked: (pred, what) => find(btn(pred, what), n => n && n.props && n.props.name === 'lock').length,
    tip: (pred, what) => String((btn(pred, what).props || {}).title || ''),
    labelled: (label) => find(tree, n => n.type === 'button' && reads(n).trim() === label).length,
    said: () => reads(tree),
    // the real <input type=file>, answering as the OS file picker does — the funnel the Upload button opens
    // and the one the HEVC / large-encrypted-video "upload anyway" sheets re-enter.
    pickFile: async () => {
      const hits = find(tree, n => n.type === 'input' && n.props && n.props.type === 'file' && n.props.accept);
      assert.equal(hits.length, 1, 're-anchor this test: the sermon file input is gone');
      await hits[0].props.onChange({ target: { files: [{ name: 'sunday.m4a', size: 5 * 1048576, type: 'audio/mp4', lastModified: 1 }], value: '' } });
      await ticks(20); tree = render();
    },
  };
}
const UPLOAD_BTN = (n) => reads(n).trim() === 'Upload audio or video';
const TRASH_BTN = (n) => (n.props && n.props['aria-label']) === 'Remove sermon';
const PEN_BTN = (n) => (n.props && n.props['aria-label']) === 'Edit sermon';
const SERMON1 = [{ id: 's1', title: 'Sunday morning', sha256: 'aa', size: 10, mime: 'audio/mp4' }];

// ⚠ UPDATED 2026-09-25 (option A, Phase 2). Until this date `sermon:` was church-key-only, so EVERY
// delegated console — any capability, any roster — was refused, and the loop below covered that with one
// fixture. It is now a CONTENT steward's write, so the loop splits in two: a steward WITHOUT content is
// still refused exactly as before (never reaching the engine at all); a steward WITH it now behaves like
// the owner for an UNENCRYPTED upload, and is STILL refused for an ENCRYPTED one — not by sermon:'s own
// rule, but because the media-key envelope (mediakey:) stays church-key-only regardless of any capability
// (see mediaEncryptor's note in sermonsPanel above). Encrypt ON is therefore the one case where a
// content-capable delegate's Upload button is UNLOCKED and the press still ends in a refusal, just a
// different one — proof that the two gates are independent and neither one is standing in for the other.
for (const encOn of [false, true]) {
  test('THE SCREEN: a steward WITHOUT content sends NO BYTES for a sermon — Encrypt ' + (encOn ? 'ON' : 'OFF'), async () => {
    const p = await sermonsPanel({ delegated: true, caps: ['finance'], encOn, list: SERMON1 });
    assert.equal(p.marked(UPLOAD_BTN, 'Upload button'), true,
      'THE UPLOAD CONTROL IS STILL OFFERED on a console that cannot publish a sermon. (It is aria-disabled ' +
      'rather than disabled on purpose — the press must still be able to answer on a phone, where there is ' +
      'no hover and so no tooltip — but it must be MARKED.)');
    await p.press(UPLOAD_BTN, 'Upload button');
    assert.deepEqual(p.order, [],
      'PRESSING UPLOAD STARTED WORK ON A STEWARD WITHOUT CONTENT: ' + JSON.stringify(p.order));
    assert.match(p.said(), /Your church hasn’t given you Groups & rotas/,
      'the locked Upload button said nothing when it was pressed. Screen read: ' + p.said());
    // …and the funnel behind the control, which is the path that actually spent the bytes.
    await p.pickFile();
    await p.press(n => reads(n).trim() === 'Upload', 'Upload button in the naming modal');
    assert.deepEqual(p.order, [],
      'THE BLOB WENT UP BEFORE THE REFUSAL. uploadBlob ran and nothing then referenced those bytes — an ' +
      'orphan on the host, for a file that is routinely hundreds of MB, and orphan-blob GC is not built. ' +
      'Order: ' + JSON.stringify(p.order));
    assert.match(p.said(), /Your church hasn’t given you Groups & rotas/,
      'the naming modal closed or said nothing over the refusal. Screen read: ' + p.said());
  });
}

test('THE SCREEN: a CONTENT steward uploads an UNENCRYPTED sermon just like the owner', async () => {
  const p = await sermonsPanel({ delegated: true, caps: ['content'], encOn: false, list: SERMON1 });
  assert.equal(p.marked(UPLOAD_BTN, 'Upload button'), false,
    'A CONTENT STEWARD IS STILL LOCKED OUT of publishing a sermon — the re-grant did not reach the screen');
  await p.pickFile();
  await p.press(n => reads(n).trim() === 'Upload', 'Upload button in the naming modal');
  assert.deepEqual(p.order, ['uploadBlob', 'publishSermon', 'pinSermon'],
    'a content steward no longer uploads and publishes a sermon: ' + JSON.stringify(p.order));
  assert.match(p.said(), /✓ Uploaded/, 'a content steward’s successful upload is not reported. Screen read: ' + p.said());
});

test('THE SCREEN: a CONTENT steward’s ENCRYPTED upload now goes through, on the church’s own key', async () => {
  // INVERTED 2026-09-25 (option A, H1b). It asserted the refusal — `['mediaEncryptor']` then "media key
  // could not be saved" — which was the honest report of a real dead end: a delegated console tried to MINT
  // a key and republish the envelope, and the relay refuses that document to anything but the church key.
  // It no longer mints. It reads the copy the church already sealed to it as a member and encrypts with the
  // church's own key, so the file plays for every member exactly as the church's own sermons do.
  const p = await sermonsPanel({ delegated: true, caps: ['content'], encOn: true, list: SERMON1 });
  assert.equal(p.marked(UPLOAD_BTN, 'Upload button'), false, 'a content steward’s Upload button is locked');
  await p.pickFile();
  await p.press(n => reads(n).trim() === 'Upload', 'Upload button in the naming modal');
  assert.deepEqual(p.order, ['mediaEncryptor', 'uploadBlob', 'publishSermon', 'pinSermon'],
    'A CONTENT STEWARD STILL CANNOT PUBLISH AN ENCRYPTED SERMON. Order: ' + JSON.stringify(p.order));
  assert.match(p.said(), /✓ Uploaded/, 'the successful encrypted upload is not reported. Screen read: ' + p.said());
});

test('THE SCREEN: …and a steward whose church shared no key is told THAT, before any bytes move', async () => {
  // The non-member steward (owner's decision, 2026-09-25: refuse honestly rather than widen the seal).
  // The message must name what is missing and who can fix it — "could not be saved" described a mint that
  // no longer happens, and "check your connection" would send them to look at a working one.
  const p = await sermonsPanel({ delegated: true, caps: ['content'], encOn: true, list: SERMON1, mediaKey: false });
  await p.pickFile();
  await p.press(n => reads(n).trim() === 'Upload', 'Upload button in the naming modal');
  assert.deepEqual(p.order, ['mediaEncryptor'],
    'THE BLOB WENT UP OVER A REFUSAL: expected only mediaEncryptor to run. Order: ' + JSON.stringify(p.order));
  assert.match(p.said(), /hasn’t shared its media key with this account/,
    'the refusal does not say what is actually missing. Screen read: ' + p.said());
});

test('THE SCREEN: a steward WITHOUT content opens no “can’t be undone” sheet over a removal it cannot do', async () => {
  const p = await sermonsPanel({ delegated: true, caps: ['finance'], encOn: false, list: SERMON1 });
  assert.equal(p.marked(TRASH_BTN, 'Remove (trash) button'), true, 'the Remove control is still offered unmarked');
  assert.equal(p.marked(PEN_BTN, 'Edit (pen) button'), true, 'the Edit control is still offered unmarked — editing re-publishes the same sermon: document');
  await p.press(TRASH_BTN, 'Remove (trash) button');
  assert.equal(p.labelled('Remove'), 0,
    'THE CONFIRMATION SHEET OPENED. A steward without content cannot tombstone a sermon, so "It disappears ' +
    'from members’ apps and the stored file is deleted … This can’t be undone" is put in front of somebody ' +
    'over something that cannot happen, and the refusal arrives only after they commit to it.');
  assert.deepEqual(p.order, [], 'the engine was reached anyway: ' + JSON.stringify(p.order));
  assert.match(p.said(), /Your church hasn’t given you Groups & rotas/,
    'the locked Remove button said nothing when it was pressed. Screen read: ' + p.said());
});

test('THE SCREEN: a CONTENT steward’s removal opens the sheet and really removes the sermon', async () => {
  const p = await sermonsPanel({ delegated: true, caps: ['content'], encOn: false, list: SERMON1 });
  assert.equal(p.marked(TRASH_BTN, 'Remove (trash) button'), false, 'a content steward’s Remove button is still locked');
  await p.press(TRASH_BTN, 'Remove (trash) button');
  assert.equal(p.labelled('Remove'), 1, 'a content steward never sees the removal confirmation at all');
  await p.press(n => reads(n).trim() === 'Remove', 'Remove button in the confirmation dialog');
  assert.deepEqual(p.order, ['removeSermon'], 'a content steward’s removal did not reach the engine: ' + JSON.stringify(p.order));
});

test('THE SCREEN: the OWNER console still uploads, publishes and removes — the other direction', async () => {
  // Without this, a "fix" that locked the panel for everybody would pass every assertion above while taking
  // sermons away from every church that has one. OWN-3/4/5 in the round-2 audit are the same idea.
  const p = await sermonsPanel({ delegated: false, encOn: false, list: SERMON1 });
  assert.equal(p.marked(UPLOAD_BTN, 'Upload button'), false, 'the OWNER console has had its Upload button locked');
  assert.equal(p.marked(TRASH_BTN, 'Remove (trash) button'), false, 'the OWNER console has had its Remove button locked');
  assert.equal(p.marked(PEN_BTN, 'Edit (pen) button'), false, 'the OWNER console has had its Edit button locked');
  await p.pickFile();
  await p.press(n => reads(n).trim() === 'Upload', 'Upload button in the naming modal');
  assert.deepEqual(p.order, ['uploadBlob', 'publishSermon', 'pinSermon'],
    'the owner console no longer uploads and publishes a sermon: ' + JSON.stringify(p.order));
  assert.match(p.said(), /✓ Uploaded/, 'the owner console no longer reports a successful upload. Screen read: ' + p.said());
  await p.press(TRASH_BTN, 'Remove (trash) button');
  assert.equal(p.labelled('Remove'), 1, 'the owner console no longer opens the removal confirmation at all');
});

// ── THE BACKUP CADENCE IS THE CHURCH'S, AND A PRESS THAT CHANGED NOTHING MUST NOT LOOK LIKE ONE ──────────
// AUDIT-steward-doc-rules-round2-2026-09-22, finding R2. `057b09d` said, in its message and in the comment
// it added, that "`freq` is this device's own reminder preference with its own localStorage key — it is not
// only a view of the church document". Measured on the branch tip, driving the real DashBackup with a real
// localStorage stub, delegated:
//
//     ###AFTER PRESS###       localStorage.backupRemind = weekly
//     ###AFTER CHURCH DOC###  localStorage.backupRemind = monthly
//
// subscribeBackupMeta's handler writes that same key from the church document, four lines below the press.
// So there is no per-device preference: on a delegated console the press stuck NOWHERE — not church-wide
// and not locally — while the sentence beside it named only the church-wide half.
//
// THESE TESTS SUPPLY `localStorage` EXPLICITLY. BASE_GLOBALS above does not, and the panels call it bare,
// so every such call lands in its own `catch {}` (round-2 audit R9) — an assertion about the key would be
// vacuous and green without this.
async function cadencePanel({ delegated, metaAnswer, start = 'monthly' }) {
  const { React, draw } = miniReact();
  const store = { 'trinityone.backupRemind': start };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const asked = [];
  const sentAt = [];   // the `at` the SCREEN hands the engine — see the "never invents" test below
  let churchDoc = null;
  const win = {
    Steward: {
      actingChurch: delegated ? 'CHURCHPUB' : '',
      myStewardCaps: () => ['content'],
      setBackupMeta: async (at, remind) => { asked.push(remind); sentAt.push(at); return metaAnswer; },
      subscribeBackupMeta: (cb) => { churchDoc = cb; return () => {}; },
      mediaSize: async () => ({ count: 0, bytes: 0 }),
    },
    localStorage,
    addEventListener() {}, removeEventListener() {},
  };
  const mod = loadScreen('app/stew-dashboard.jsx', ['DashBackup'], { ...BASE_GLOBALS(React, win), localStorage });
  const render = () => draw(mod.DashBackup, {});
  let tree = render(); tree = render();
  const btn = (label) => {
    const hits = find(tree, n => n.type === 'button' && reads(n).trim() === label);
    assert.equal(hits.length, 1, `re-anchor this test: expected exactly one "${label}" button, found ${hits.length}`);
    return hits[0];
  };
  return {
    asked,
    sentAt,
    press: async (label) => { btn(label).props.onClick(); await ticks(14); tree = render(); },
    marked: (label) => !!(btn(label).props || {})['aria-disabled'],
    // the segment paints the chosen cadence with the clay fill — which button is lit IS the answer on screen
    lit: () => ['Off', 'Weekly', 'Monthly'].filter(l => (btn(l).props.style || {}).background === 'var(--clay)').join(','),
    stored: () => store['trinityone.backupRemind'],
    arrive: async (remind) => { churchDoc({ at: 1700000000, remind }); await ticks(); tree = render(); },
    said: () => reads(tree),
  };
}

test('THE SCREEN: a cadence change on a console that knows of NO backup sends 0, not a time', async () => {
  // THE POINT OF USE for setBackupMeta's `at: at || 0` (CLAUDE.md rule 1). The engine can only be honest
  // about a time it was given; this is the half that decides what it is given. `trinityone.lastBackupAt` is
  // absent from this panel's store — a device that has never exported — and the press must carry that
  // ignorance through rather than substituting a moment. If this ever passes `Date.now()`-anything, every
  // steward's overdue nudge clears church-wide over a backup nobody took, and the engine cannot tell.
  const p = await cadencePanel({ delegated: false, metaAnswer: { id: 'evt' } });
  await p.press('Weekly');
  assert.deepEqual(p.asked, ['weekly'], 're-anchor this test: the press did not reach setBackupMeta at all');
  assert.equal(p.sentAt[0] || 0, 0,
    'THE SCREEN INVENTED A BACKUP TIME: it handed the engine `' + p.sentAt[0] + '` on a console whose ' +
    'trinityone.lastBackupAt has never been set. The engine publishes what it is given.');

  // …and when this device DOES know one, the press must carry it, or changing the cadence would tell the
  // church it has never backed up.
  const q = await cadencePanel({ delegated: false, metaAnswer: { id: 'evt' } });
  await q.arrive('monthly');            // the church record lands: at = 1700000000
  await q.press('Weekly');
  assert.equal(q.sentAt[0], 1700000000,
    'the screen discarded the backup time it had just been told about: ' + JSON.stringify(q.sentAt));
});

test('THE SCREEN: the cadence segment is locked on a delegated console, and the press changes nothing anywhere', async () => {
  const p = await cadencePanel({ delegated: true, metaAnswer: false });
  assert.equal(p.marked('Weekly'), true,
    'the cadence control is still offered on a console that cannot change it — the relay gates ' +
    'trinityone/backup-meta: to the church key, so this press can reach nothing');
  await p.press('Weekly');
  assert.deepEqual(p.asked, [],
    'it asked the relay anyway, so the steward waits on a write that is always refused: ' + JSON.stringify(p.asked));
  assert.equal(p.stored(), 'monthly',
    'THE PRESS STILL ADOPTED A CADENCE LOCALLY. That key is a cache of the church document — the ' +
    'subscription handler writes it too — so the press sticks nowhere and the screen disagrees with every ' +
    'other console until the next document arrives. Stored: ' + p.stored());
  assert.equal(p.lit(), 'Monthly',
    'the segment moved to a cadence nothing will ever nudge at. Lit: ' + p.lit());
  assert.match(p.said(), /Only the church’s own console can save the shared backup record/,
    'the locked cadence control said nothing when it was pressed. Screen read: ' + p.said());
});

test('THE SCREEN: a cadence no relay took does not stay on the owner’s screen either', async () => {
  // The same rule, on the console that IS allowed to write: the segment must show what the church will
  // actually nudge at, not what this device tried to set.
  const p = await cadencePanel({ delegated: false, metaAnswer: false });
  assert.equal(p.marked('Weekly'), false, 'the OWNER console has had its cadence control locked');
  await p.press('Weekly');
  assert.deepEqual(p.asked, ['weekly'], 'the owner console stopped publishing the cadence at all: ' + JSON.stringify(p.asked));
  assert.equal(p.lit(), 'Monthly',
    'the segment is left on Weekly over a document no relay took, so this console nudges weekly and every ' +
    'other console monthly, for ever. Lit: ' + p.lit());
  assert.equal(p.stored(), 'monthly', 'the refused cadence was left in the cache and survives a reload. Stored: ' + p.stored());
  assert.match(p.said(), /the shared backup record could not be saved/,
    'the refusal is unreported. Screen read: ' + p.said());
});

test('THE SCREEN: a cadence the relay accepted is adopted, and the church document still wins', async () => {
  // The other direction twice over: a working press must work, and the church document — which is what
  // every other steward sees — must go on overwriting this screen when it arrives.
  const p = await cadencePanel({ delegated: false, metaAnswer: { id: 'evt' } });
  await p.press('Weekly');
  assert.deepEqual(p.asked, ['weekly'], 'the owner console no longer publishes the cadence: ' + JSON.stringify(p.asked));
  assert.equal(p.lit(), 'Weekly', 'a cadence every relay accepted was put back anyway. Lit: ' + p.lit());
  assert.equal(p.stored(), 'weekly', 'the accepted cadence was not cached. Stored: ' + p.stored());
  assert.doesNotMatch(p.said(), /could not be saved|Only the church/, 'an accepted cadence is reported as a failure. Screen read: ' + p.said());
  await p.arrive('off');
  assert.equal(p.lit(), 'Off',
    'the church document no longer wins. It is the one thing every steward sees, and this screen must ' +
    'follow it rather than a local preference — there is no local preference. Lit: ' + p.lit());
});

// ── THE TYPE THE SWEEP MISSED: `trinityone/relays`, ON THE SCREEN THAT WRITES IT ─────────────────────────
// AUDIT-steward-doc-rules-round3-2026-09-22, finding F1. `a4002f5`'s commit message lists eight paths under
// "CLAUDE.md RULE 2 — THE SWEEP" and `trinityone/relays` is not one of them, although it is one of the six
// types this branch made church-key-only. Measured on the branch tip before this fix, driving the real
// DashRelayHistoryCard compiled from app/stew-dashboard.jsx with `actingChurch: 'CHURCHPUB'`:
//
//     DELEGATED BUTTONS [label, aria-disabled, disabled] =
//       [["Copy across",false,true],["Turn on sync",false,false],["Turn off",false,false]]
//     DELEGATED after "Turn on sync": engine calls = ["syncEnable"]
//     DELEGATED screen: … Sync could not be switched on — no relay accepted the setting. Nothing is
//                         mirroring yet; try again.
//     DELEGATED after "Turn off":     engine calls = ["syncEnable","syncDisable"]
//     DELEGATED screen: … Sync could not be switched off — no relay accepted the change, so your relays are
//                         STILL mirroring each other. Try again.
//
// Two live, unmarked buttons, and two refusals that tell a steward to retry something that can never
// succeed — the "Turn off" one in the direction that matters, because that is the button a church presses
// while decommissioning a box. The engine sentences are right for an OUTAGE on the owner's console and are
// deliberately unchanged; what was wrong is that a delegated console reached them at all.
//
// CLAUDE.md rule 1: THREE markers are asserted here — `aria-disabled`, the padlock glyph and the tooltip —
// because F3 in the same audit showed that a marker no test can see is a marker that can be deleted with
// the suite green. Rule 3: the panel is compiled and RENDERED; nothing matches text in app/*.jsx.
async function syncPanel({ delegated, boxes = 2, syncOn = false }) {
  const { React, draw } = miniReact();
  const order = [];
  const win = {
    Steward: {
      actingChurch: delegated ? 'CHURCHPUB' : '',
      myStewardCaps: () => ['content'],   // a fully-granted delegate: no capability is what refuses here
      backupState: async () => ({ boxes, online: boxes, entries: boxes, syncOn }),
      ownRelay: () => 'wss://relay.example.com/relay',
      // THE ENGINE'S REAL ANSWERS, verbatim from src/steward.src.js — never a stand-in for the decision
      // under test, which is whether the SCREEN reaches them at all.
      syncEnable: async () => {
        order.push('syncEnable');
        if (delegated) throw new Error('Sync could not be switched on — no relay accepted the setting. Nothing is mirroring yet; try again.');
        return { relays: boxes };
      },
      syncDisable: async () => {
        order.push('syncDisable');
        if (delegated) throw new Error('Sync could not be switched off — no relay accepted the change, so your relays are STILL mirroring each other. Try again.');
        return { relays: 0 };
      },
      cloneFromRelay: async () => { order.push('cloneFromRelay'); return { imported: 7 }; },
      resolveRelayName: async () => ({ url: 'wss://x/relay' }),
    },
    useStewardRelays: () => [{ url: 'wss://a/relay', status: 'on' }, { url: 'wss://b/relay', status: 'on' }],
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {},
  };
  const mod = loadScreen('app/stew-dashboard.jsx', ['DashRelayHistoryCard'],
    { ...BASE_GLOBALS(React, win), location: { search: '', host: 'x' } });
  const render = () => draw(mod.DashRelayHistoryCard, {});
  // THREE DRAWS AND A TICK: `backup` arrives through an async effect (useRelayBackupState → backupState),
  // and the two sync buttons do not exist at all until it says the church has two boxes.
  let tree = render(); tree = render(); await ticks(10); tree = render();
  const btn = (label) => {
    const hits = find(tree, n => n.type === 'button' && reads(n).trim() === label);
    assert.equal(hits.length, 1, `re-anchor this test: expected exactly one "${label}" button, found ${hits.length}`);
    return hits[0];
  };
  return {
    order,
    press: async (label) => { btn(label).props.onClick(); await ticks(20); tree = render(); },
    marked: (label) => !!(btn(label).props || {})['aria-disabled'],
    // THE PADLOCK, read off the tree rather than off the source. Icon is stubbed to render nothing, but the
    // harness keeps the component node with its props, so the glyph is visible as `name: 'lock'`.
    padlocked: (label) => find(btn(label), n => n && n.props && n.props.name === 'lock').length,
    tip: (label) => String((btn(label).props || {}).title || ''),
    said: () => reads(tree),
  };
}

test('THE SCREEN: a delegated console cannot turn relay sync on or off, and reaches the engine zero times', async () => {
  const p = await syncPanel({ delegated: true });
  for (const label of ['Turn on sync', 'Turn off']) {
    assert.equal(p.marked(label), true,
      `"${label}" IS STILL OFFERED UNMARKED on a console that can never write trinityone/relays. That ` +
      'document decides which relay boxes exchange this congregation’s whole corpus (CLAUDE.md rule 10), ' +
      'so it is church-key-only and this press can reach nothing.');
    assert.equal(p.padlocked(label), 1,
      `"${label}" carries no padlock. On a phone there is no hover, so the glyph is the only marking a ` +
      'steward sees before they press.');
    assert.match(p.tip(label), /Only the church’s own console can turn relay sync on or off/,
      `"${label}" lost its tooltip, so on a desktop console nothing says why it is locked. Tooltip: ` + p.tip(label));
  }
  await p.press('Turn on sync');
  assert.deepEqual(p.order, [],
    'PRESSING "Turn on sync" REACHED THE ENGINE on a delegated console: ' + JSON.stringify(p.order));
  assert.match(p.said(), /Only the church’s own console can turn relay sync on or off/,
    'the locked "Turn on sync" button said nothing when it was pressed. Screen read: ' + p.said());
  assert.doesNotMatch(p.said(), /try again/i,
    'THE STEWARD IS BEING TOLD TO TRY AGAIN at something that can never succeed. Screen read: ' + p.said());
  await p.press('Turn off');
  assert.deepEqual(p.order, [],
    'PRESSING "Turn off" REACHED THE ENGINE on a delegated console: ' + JSON.stringify(p.order));
  assert.doesNotMatch(p.said(), /STILL mirroring each other/,
    'THE WORST SENTENCE ON THIS SCREEN WAS SHOWN TO SOMEBODY WHO CANNOT ACT ON IT. "Turn off" is pressed ' +
    'while a church is decommissioning a relay or reacting to a seizure; telling a delegated steward their ' +
    'relays are still mirroring, and to try again, is a dead end. Screen read: ' + p.said());
});

test('THE SCREEN: the OWNER console still turns relay sync on and off — the other direction', async () => {
  // Without this, a "fix" that locked the panel for everybody would pass every assertion above while taking
  // cross-relay sync away from every church that runs two boxes.
  const p = await syncPanel({ delegated: false });
  assert.equal(p.marked('Turn on sync'), false, 'the OWNER console has had "Turn on sync" locked');
  assert.equal(p.marked('Turn off'), false, 'the OWNER console has had "Turn off" locked');
  assert.equal(p.padlocked('Turn on sync'), 0, 'the OWNER console shows a padlock on a control it may use');
  await p.press('Turn on sync');
  assert.deepEqual(p.order, ['syncEnable'], 'the owner console no longer switches sync on: ' + JSON.stringify(p.order));
  assert.match(p.said(), /✓ Sync on/, 'the owner console no longer reports a successful switch-on. Screen read: ' + p.said());
  await p.press('Turn off');
  assert.deepEqual(p.order, ['syncEnable', 'syncDisable'], 'the owner console no longer switches sync off: ' + JSON.stringify(p.order));
  assert.match(p.said(), /Sync turned off/, 'the owner console no longer reports a successful switch-off. Screen read: ' + p.said());
});

// ── A REFUSED BACKGROUND WRITE MUST NOT REPEAT FOR EVER ──────────────────────────────────────────────────
// AUDIT-steward-doc-rules-round3-2026-09-22, finding F2. `ensureMediaKeyForMembers` is the console's
// background re-wrap of the church media key; the key-distributor effect calls it on every roster emit
// (app/stew-dashboard.jsx, two call sites). It publishes `trinityone/mediakey:`, which this branch makes
// church-key-only. It recorded what it published only on SUCCESS —
//
//     if (ok !== false) _mediaKeyDocKeys = keys;
//
// — so a refusal left the "who is already keyed" map empty and the idempotence guard
// `want.every(p => have[p])` could never become true. MEASURED on the shipped bundle before this fix:
//
//     REFUSED:  returns [false,false,false] | publish attempts = 3 | background flag = [false,false,false]
//               | recorded keys = null | banner events = []
//     ACCEPTED: returns [true,false,false]  | publish attempts = 1 | recorded keys = {"CP":…,"m1":…,"m2":…}
//
// Three seals and three publishes for three calls, none of them able to succeed, and the console's STANDING
// alarm ("That change wasn't saved") raised by every one of them — which is the defect ensureCareKeyForMembers
// was given `{ background: true }` for on 2026-09-17.
//
// The function is lifted out of vendor/steward.js — the SHIPPED bundle — and run, not read.
// `saidNo` — WHAT publish() ANSWERED, NOT JUST THAT IT FAILED. publish() returns `false` for a relay that
// read the event and refused it AND for a socket that never opened, and since
// AUDIT-steward-doc-rules-round4-2026-09-22 finding F2 this function is required to tell them apart: it
// reads `opts.refused`, which publish() stamps. Default `true` because every test written before that
// finding is about the church-key-only refusal of `trinityone/mediakey:` on a delegated console.
// ⚠ THIS STUB SUPPLIES THE VERY DECISION UNDER TEST ([[a-stub-answers-the-question]]), so the rows below it
// that matter most drive the REAL publish() out of the same bundle — see runMediaKeyForReal.
async function runMediaKey(answer, calls = 3, memberPubs = ['m1', 'm2'], saidNo = true) {
  const peek = '__mk_' + Math.random().toString(36).slice(2);
  const published = [];
  const events = [];
  // MUTABLE MODULE STATE MUST BE `let`. runLifted's preamble emits `const` for everything in `scope`, and
  // this function ASSIGNS to _mediaKeyDocKeys and _mediaKeyPushRefused — a const would throw TypeError from
  // inside the lifted code, which an assertion about "it stopped publishing" would happily accept.
  const decls = 'let _mediaKeyHex = "aa"; let _mediaKeyRing = ["aa"]; let _mediaKeyDocKeys = null; '
    + 'let _mediaKeyPushRefused = null;\n'
    + `globalThis.${peek} = () => ({ docKeys: _mediaKeyDocKeys, refused: _mediaKeyPushRefused });\n`;
  const lifted = await runLifted('ensureMediaKeyForMembers(memberPubs, stewardPubs)', 'ensureMediaKeyForMembers', answer, {
    publish: async (evt, opts) => {
      published.push({ evt, background: !!(opts && opts.background) });
      if (answer === false && opts && typeof opts === 'object') {
        opts.refused = saidNo;
        opts.reason = saidNo ? 'blocked: not a member or not permitted for this group' : 'connection failure: connection timed out';
      }
      return answer;
    },
    _localBlocked: new Set(),
    _sealEach: async (pl, want) => Object.fromEntries(want.map(p => [p, 'sealed-for-' + p])),
    nip44e: (a) => a, nip44ck: () => 'ck',
    window: { dispatchEvent: (e) => { events.push({ type: e.type, detail: e.detail }); } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
  }, [memberPubs], decls);
  const out = [];
  for (let i = 0; i < calls; i++) out.push(await lifted.fn(memberPubs));
  const state = globalThis[peek]();
  delete globalThis[peek];
  return { out, published, events, state };
}

test('a refused media key is remembered, so the console stops republishing it', async () => {
  const p = await runMediaKey(false);
  assert.equal(p.published.length, 1,
    'THE CONSOLE IS STILL HAMMERING. Three calls to ensureMediaKeyForMembers with the same roster produced ' +
    p.published.length + ' publishes of a document the relay refuses every time. The key-distributor effect ' +
    'runs on every roster emit, so this is unbounded — it re-seals for every member each time as well.');
  assert.deepEqual(p.out, [false, false, false],
    'the later calls no longer report the refusal to their caller: ' + JSON.stringify(p.out));
  assert.equal(p.state.docKeys, null,
    'a REFUSED document was recorded as published. That would tell the next call everyone is keyed when ' +
    'nobody is, which is the opposite mistake and hides a real gap for ever.');
  assert.ok(p.state.refused,
    'nothing was remembered about the refusal, so only luck is stopping the republish.');
});

test('a refused media key is said ONCE, quietly, and names what it costs', async () => {
  // CLAUDE.md rule 1 in the engine's half: bounded is not enough if it is also silent. A member whose app
  // says a sermon "needs the unlock key" is the only symptom, and nobody would connect the two.
  const p = await runMediaKey(false);
  assert.deepEqual(p.published.map(x => x.background), [true],
    'the media-key publish still raises the console’s STANDING alarm ("That change wasn’t saved"). Nobody ' +
    'asked for this write and no steward made a change — the same reasoning ensureCareKeyForMembers was ' +
    'given { background: true } for on 2026-09-17.');
  const blocked = p.events.filter(e => e.type === 'steward-write-blocked');
  assert.equal(blocked.length, 1,
    'the refusal was announced ' + blocked.length + ' times over three calls. Once is the whole point: a ' +
    'banner on every roster emit is the defect, not the fix.');
  assert.equal(blocked[0].detail.what, 'sermon key', 'the banner is unlabelled: ' + JSON.stringify(blocked[0].detail));
  assert.match(blocked[0].detail.message, /will not play for them/,
    'the banner does not say what it costs the congregation. Message: ' + blocked[0].detail.message);
  assert.match(blocked[0].detail.message, /2 member\(s\)/,
    'the count is wrong or absent — the church’s own copy is in the recipient set and is not a member, so ' +
    'two unkeyed members must not be reported as three. Message: ' + blocked[0].detail.message);
});

test('a media key the relay accepted still goes out, and is not blocked by the memo', async () => {
  // The other direction: a "fix" that simply stopped publishing would pass both tests above while leaving
  // every member who joins after an encrypted sermon unable to play it.
  const p = await runMediaKey({ id: 'evt' });
  assert.equal(p.published.length, 1,
    'the accepted path no longer publishes at all, or publishes more than once: ' + p.published.length);
  assert.deepEqual(Object.keys(p.state.docKeys || {}).sort(), ['CP', 'm1', 'm2'],
    'an accepted publish was not recorded, so the next roster emit re-seals and re-publishes it: ' +
    JSON.stringify(p.state.docKeys));
  assert.equal(p.state.refused, null, 'an accepted publish left a refusal memo behind, which would block the next real one');
  assert.deepEqual(p.events.filter(e => e.type === 'steward-write-blocked'), [],
    'a media key every relay accepted raised a refusal banner: ' + JSON.stringify(p.events));
});

// ── …AND A BLIP IS NOT A RULE ────────────────────────────────────────────────────────────────────────────
// AUDIT-steward-doc-rules-round4-2026-09-22, finding F2. The memo above promised in as many words that it
// "IS NOT A PERMANENT GIVING-UP … a refusal may be an outage rather than a rule", and then remembered every
// `false` alike — and publish() answers `false` for a relay that refused the event, for a socket that never
// opened, and for "no relay could be proved ours". MEASURED on the shipped bundle before this fix, one blip
// then healthy, roster unchanged, on an OWNER's console:
//
//     ATTEMPTS = [{"bg":true,"ans":"UNREACHABLE"}]   RETURNS = [false,false,false]
//     STATE    = {"docKeys":null,"refused":"CP,m1,m2"}
//     BANNERS  = ["2 member(s) could not be given the key … Only the console that holds the church key can
//                 publish it. This console will not keep retrying."]
//
// Calls 2 and 3 were never attempted, two members were never given the key — their apps say a sermon "needs
// the unlock key" — and the church was told the cause was its church key, on the one console that holds it.
//
// ⚠ THE WHOLE POINT IS WHICH SIGNAL IS READ, so these rows may not let a stub decide it
// ([[a-stub-answers-the-question]]). They lift the REAL publish() out of vendor/steward.js and join it to
// the REAL ensureMediaKeyForMembers. The only stub is `pool.publish` — the vendored nostr-tools call — and
// it answers as the library does on the wire: an unopenable socket RESOLVES with "connection failure: …",
// while a relay's own OK=false REJECTS with the relay's reason.
async function runMediaKeyForReal(answers, calls = 3, memberPubs = ['m1', 'm2']) {
  const banners = [], errors = [], attempts = [], subs = [];
  let n = 0;
  const scope = {
    sk: 'SK', pub: 'CP', actingChurch: '',
    _localBlocked: new Set(), _lastOk: new Map(),
    MEDIAKEY_D: 'trinityone/mediakey:', NET: 'trinityone', NO_NETWORK_RELAY: 'no-network-relay',
    now: () => 1700000000 + n,
    feChurch: (t) => t,
    _sealEach: async (pl, want) => Object.fromEntries(want.map(p => [p, 'sealed-for-' + p])),
    encrypt3: (a) => a, getConversationKey: () => 'ck',
    _waitForRegistration: async () => {},
    relays: () => ['wss://one.example/relay'], relaysRaw: () => ['wss://one.example/relay'],
    console: { warn() {}, log() {}, error() {} },
    JSON, Set, Map, Array, Object, String, Number, Boolean, Promise, Error, RegExp,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
    _isRelayAuthed: () => true,
    _hex: () => 'bb',
    crypto: { getRandomValues: (a) => a },
    decrypt3: (a) => a,
    pool: {
      publish: (targets) => {
        const a = answers[Math.min(n, answers.length - 1)];
        n++;
        attempts.push(a.kind === 'ok' ? 'OK' : (a.kind === 'refused' ? 'REFUSED' : 'UNREACHABLE'));
        if (a.kind === 'unreachable') return targets.map(() => Promise.resolve('connection failure: connection timed out'));
        if (a.kind === 'refused') return targets.map(() => Promise.reject(new Error(a.reason)));
        return targets.map(() => Promise.resolve(''));
      },
      // subscribeMediaKey's socket: hand the handlers back so a test can deliver a real envelope.
      subscribeMany: (_r, _f, handlers) => { subs.push(handlers); return { close() {} }; },
    },
  };
  scope.window = { dispatchEvent: (e) => {
    if (e.type === 'steward-write-blocked') banners.push(e.detail.message);
    if (e.type === 'steward-publish-error') errors.push(e.detail.reason);
  } };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      throw new ReferenceError('the lifted publish/ensureMediaKeyForMembers chain needs `' + String(k) + '` — add a stub');
    },
  });
  // Mutable module state the lifted function ASSIGNS to must be `let`, or a const throws TypeError from
  // inside the lifted code and "it stopped publishing" would read as a pass.
  const decls = 'let _mediaKeyHex = "aa"; let _mediaKeyRing = ["aa"]; let _mediaKeyDocKeys = null; '
    + 'let _mediaKeyPushRefused = null; let _mediaKeyChecked = false;';
  const pubSrc = fnBody(BUNDLE, '  async function publish(evt, opts) {', 'publish in the shipped bundle');
  const family = [
    fnBody(BUNDLE, '    async ensureMediaKeyForMembers(memberPubs, stewardPubs) {', 'ensureMediaKeyForMembers in the shipped bundle'),
    fnBody(BUNDLE, '    async rotateMediaKey(memberPubs, stewardPubs) {', 'rotateMediaKey in the shipped bundle'),
    fnBody(BUNDLE, '    subscribeMediaKey() {', 'subscribeMediaKey in the shipped bundle'),
  ].join(',\n');
  const api = new Function('scope', `with (scope) { ${decls}
    ${pubSrc};
    const _o = { ${family} };
    return { fn: _o.ensureMediaKeyForMembers.bind(_o), rotate: _o.rotateMediaKey.bind(_o),
             subscribe: _o.subscribeMediaKey.bind(_o),
             forget: (fp) => { _mediaKeyPushRefused = fp; },
             peek: () => ({ docKeys: _mediaKeyDocKeys, refused: _mediaKeyPushRefused }) }; }`)(proxy);
  const out = [];
  for (let i = 0; i < calls; i++) out.push(await api.fn(memberPubs));
  return { out, attempts, banners, errors, subs, api, state: api.peek() };
}

test('A BLIP IS NOT A RULE: a media key nobody could deliver is tried again, and lands', async () => {
  const p = await runMediaKeyForReal([{ kind: 'unreachable' }, { kind: 'ok' }]);
  assert.deepEqual(p.attempts, ['UNREACHABLE', 'OK'],
    'THE MEMO IS A PERMANENT GIVING-UP AGAIN. One unopenable socket and this console never tries to give ' +
    'the church’s media key to those members again — their apps say a sermon "needs the unlock key" for ' +
    'ever. Attempts: ' + JSON.stringify(p.attempts));
  assert.deepEqual(Object.keys(p.state.docKeys || {}).sort(), ['CP', 'm1', 'm2'],
    'the retry did not land, so nothing was recorded: ' + JSON.stringify(p.state.docKeys));
  assert.equal(p.state.refused, null, 'a transient failure was remembered as a rule');
  assert.deepEqual(p.banners, [],
    'A BLIP RAISED THE CHURCH-KEY BANNER. On an OWNER’s console that sentence is simply false, and the ' +
    'failure is already reported by publish()’s own steward-publish-error: ' + JSON.stringify(p.banners));
  assert.deepEqual(p.errors, ['connection failure: connection timed out'],
    're-anchor: the failure reached no screen at all, so the silence asserted above is the wrong kind');
});

test('…AND NEITHER IS THE SHIPPED RELAY’S OWN "error:" — full disk, or a skewed clock', async () => {
  // AUDIT-steward-doc-rules-round5-2026-09-23, finding 1. NIP-01 reserves `error:` for its one
  // unstructured, TRANSIENT catch-all, and the shipped relay uses it for exactly that: a full disk /
  // read-only volume (scripts/gateway.mjs:7691) and a skewed device clock (:7726). The relay DID speak —
  // this goes through the REJECTED half of publish(), same as a genuine refusal — but it is not a rule
  // that will refuse the same event again, so it must not stick any better than an unopenable socket does.
  const p = await runMediaKeyForReal([
    { kind: 'refused', reason: 'error: relay storage unavailable — nothing was saved' },
    { kind: 'ok' },
  ]);
  assert.deepEqual(p.attempts, ['REFUSED', 'OK'],
    'A FULL DISK IS NOW A PERMANENT RULE. Freeing the disk (or fixing the clock) never asks again — this ' +
    'church’s media key stays unwrapped for those members for ever. Attempts: ' + JSON.stringify(p.attempts));
  assert.deepEqual(Object.keys(p.state.docKeys || {}).sort(), ['CP', 'm1', 'm2'],
    'the retry did not land, so nothing was recorded: ' + JSON.stringify(p.state.docKeys));
  assert.equal(p.state.refused, null, 'a transient relay error was remembered as a rule');
  assert.deepEqual(p.banners, [],
    'A FULL DISK RAISED THE CHURCH-KEY BANNER, blaming the one console that holds the key for a box with ' +
    'no free space: ' + JSON.stringify(p.banners));
});

test('…and a GENUINE refusal is still remembered, said once, through the real publish()', async () => {
  // The control. Without this row, a "fix" that simply never remembered anything would pass everything
  // above while restoring the unbounded re-seal-and-republish that 177cfb9 was written to stop.
  const p = await runMediaKeyForReal([{ kind: 'refused', reason: 'blocked: not a member or not permitted for this group' }]);
  assert.deepEqual(p.attempts, ['REFUSED'],
    'THE CONSOLE IS HAMMERING AGAIN: ' + JSON.stringify(p.attempts));
  assert.ok(p.state.refused, 'a rule the relay stated was not remembered');
  assert.equal(p.banners.length, 1, 'the refusal was announced ' + p.banners.length + ' times over three calls');
  assert.match(p.banners[0], /Only the console that holds the church key can publish it\./,
    'the membership refusal of mediakey: no longer names who can fix it: ' + p.banners[0]);
});

test('…and when the relay gives a reason nobody wrote a sentence for, the banner QUOTES it', async () => {
  // rule 4, applied to a screen: "Only the console that holds the church key can publish it" is true of the
  // membership refusal and a guess about every other one. The house rule is to quote the relay verbatim
  // rather than invent an explanation (publishErrorMessage, app/stew-dashboard.jsx).
  const p = await runMediaKeyForReal([{ kind: 'refused', reason: 'restricted: this relay is read-only right now' }]);
  assert.match(p.banners[0] || '', /The relay refused it: restricted: this relay is read-only right now\./,
    'the console invented a cause it cannot know: ' + JSON.stringify(p.banners));
  assert.doesNotMatch(p.banners[0] || '', /holds the church key/,
    'a relay that is merely read-only is still being blamed on the church key');
});

// ── THE TWO CLEARS NOBODY WAS TESTING ────────────────────────────────────────────────────────────────────
// AUDIT-steward-doc-rules-round4-2026-09-22, finding F5. 177cfb9 names four places the memo is cleared and
// calls that the reason it "IS NOT A PERMANENT GIVING-UP". Two of the four were deletable with the suite
// green — MEASURED, each scoped to its own function, the anchor asserted exactly once inside the slice:
//
//   G — rotateMediaKey's `_mediaKeyPushRefused = null` made inert (`= _mediaKeyPushRefused`)
//       → 31/0 · 15/0 · 6/0 · 13/0 · 10/0 · 8/0 — INERT across all six files that name the media key
//   H — subscribeMediaKey's onevent `_mediaKeyPushRefused = null` made inert, same way
//       → 31/0 · 15/0 · 6/0 · 13/0 · 10/0 · 8/0 — INERT
//
// ⚠ The onevent clear's own EXPLANATORY COMMENT contains the literal text `_mediaKeyPushRefused = null`, so
// a plain string-replace patches the prose and reports exactly what a blind test reports
// ([[comments-can-satisfy-assertions]], [[sabotage-must-be-scoped]]). Both rows below are point-of-USE: the
// assertion is not "the line is there" but "the next roster emit asks again", driven through the shipped
// ensureMediaKeyForMembers in the same module scope.

test('THE CLEARS: a rotation that landed makes the console ask again for a set it had been refused', async () => {
  // The first answer refuses, so the memo is set for real by the real code; the rest are healthy.
  const p = await runMediaKeyForReal([{ kind: 'refused', reason: 'blocked: not a member or not permitted for this group' },
                                      { kind: 'ok' }]);
  assert.ok(p.state.refused, 're-anchor: no memo was ever set, so nothing below is testing a clear');
  assert.equal(await p.api.fn(['m1', 'm2']), false, 're-anchor: the memo is not actually blocking the republish');

  // Rotate to a SMALLER set on purpose: rotateMediaKey records what IT published, so rotating to the same
  // roster would satisfy the idempotence guard on the next call and the row would pass with the clear
  // deleted. m2 is left unkeyed, so the next call must get past that guard and reach the memo — and the
  // fingerprint it computes is the very one that was refused.
  assert.equal(await p.api.rotate(['m1']), true, 'the rotation itself failed, so this row proves nothing');
  assert.equal(p.api.peek().refused, null,
    'ROTATION NO LONGER CLEARS THE MEMO. A rotation that landed PROVES this console can write the envelope, ' +
    'so the reason ensureMediaKeyForMembers stopped asking has gone.');
  const before = p.attempts.length;
  await p.api.fn(['m1', 'm2']);
  assert.equal(p.attempts.length, before + 1,
    'THE POINT OF USE: after a successful rotation the console still refuses to re-wrap the key for a ' +
    'member who is missing it. Attempts: ' + JSON.stringify(p.attempts));
});

test('THE CLEARS: an envelope ARRIVING makes the console ask again too', async () => {
  const p = await runMediaKeyForReal([{ kind: 'refused', reason: 'blocked: not a member or not permitted for this group' },
                                      { kind: 'ok' }]);
  assert.ok(p.state.refused, 're-anchor: no memo was ever set, so nothing below is testing a clear');
  const stop = p.api.subscribe();
  assert.equal(p.subs.length, 1, 're-anchor: subscribeMediaKey opened no subscription, so no envelope can arrive');
  // A real envelope lands: somebody else's console re-keyed the church. The recipient map has changed under
  // us, so whatever this console last had refused is worth asking again.
  p.subs[0].onevent({ pubkey: 'CP', content: JSON.stringify({ keys: { CP: 'x', m1: 'y' }, rev: 1 }) });
  assert.equal(p.api.peek().refused, null,
    'AN ARRIVING ENVELOPE NO LONGER CLEARS THE MEMO. The recipient map has changed underneath this console ' +
    'and it goes on skipping until the roster itself changes.');
  const before = p.attempts.length;
  await p.api.fn(['m1', 'm2']);
  assert.equal(p.attempts.length, before + 1,
    'THE POINT OF USE: an envelope arrived that does not key m2, and the console still will not re-wrap ' +
    'for them. Attempts: ' + JSON.stringify(p.attempts));
  stop();
});

// ── THE TWO MARKERS NO TEST COULD SEE (CLAUDE.md rule 1, the hole in this file's own headline fix) ────────
// AUDIT-steward-doc-rules-round3-2026-09-22, finding F3. `aria-disabled` does not stop a click in a browser
// — a4002f5 says so itself and relies on each press handler to answer — but the four tests it added
// asserted only `aria-disabled`. Two scoped sabotages were therefore INERT at 21 / 0:
//
//   D — delete ONLY the Edit (pen) button's `if (_churchOnly) { … return; }`, keep everything else.
//       Measured with and without: WITH the sabotage the edit modal OPENS ("Edit audio details · Rename it
//       and add details · Title · Details · optional · Cancel · Save"); shipped, it does not. That is
//       exactly the flow a4002f5 says it prevents — "a steward should not retype a title to be refused
//       at Save" — restored by deleting one clause, with the whole file green.
//   E — delete the Upload button's padlock glyph AND its `title` tooltip, keep `aria-disabled`.
//       21 / 0, and console-settings-a11y 37 / 0 as well. On a phone there is no hover, so the glyph is
//       the ONLY marking a steward sees before they press.
//
// The two tests below are those rows, at the point of use. Nothing here matches text in app/*.jsx.
test('THE SCREEN: the pen opens no edit form for a steward WITHOUT content — the refusal is not at Save', async () => {
  // `caps: ['finance']`, not the default — sermon: is a CONTENT grant now (option A, Phase 2), so this is
  // the one steward shape still refused. See the companion test just below for the one that is not.
  const p = await sermonsPanel({ delegated: true, caps: ['finance'], encOn: false, list: SERMON1 });
  assert.equal(p.labelled('Save'), 0, 'fixture: something is already offering Save before the pen is pressed');
  await p.press(PEN_BTN, 'Edit (pen) button');
  assert.equal(p.labelled('Save'), 0,
    'THE EDIT MODAL OPENED FOR A STEWARD WITHOUT CONTENT. The steward types a title and a description and ' +
    'meets the refusal only when they press Save — which is the exact flow this panel’s fix says it ' +
    'prevents. `aria-disabled` does not stop a click; the press handler has to.');
  assert.deepEqual(p.order, [], 'the engine was reached by the pen: ' + JSON.stringify(p.order));
  assert.match(p.said(), /Your church hasn’t given you Groups & rotas/,
    'the locked pen said nothing when it was pressed. Screen read: ' + p.said());
});

test('THE SCREEN: the pen opens the edit form for a CONTENT steward, and Save reaches the engine', async () => {
  const p = await sermonsPanel({ delegated: true, caps: ['content'], encOn: false, list: SERMON1 });
  await p.press(PEN_BTN, 'Edit (pen) button');
  assert.equal(p.labelled('Save'), 1, 'A CONTENT STEWARD IS STILL LOCKED OUT of editing a sermon’s title/description');
  await p.press(n => reads(n).trim() === 'Save', 'Save button in the edit modal');
  assert.deepEqual(p.order, ['publishSermon'], 'a content steward’s edit did not reach the engine: ' + JSON.stringify(p.order));
});

test('THE SCREEN: all three sermon controls carry a padlock for a steward WITHOUT content, and say why', async () => {
  const p = await sermonsPanel({ delegated: true, caps: ['finance'], encOn: false, list: SERMON1 });
  for (const [pred, what] of [[UPLOAD_BTN, 'Upload button'], [PEN_BTN, 'Edit (pen) button'], [TRASH_BTN, 'Remove (trash) button']]) {
    assert.equal(p.padlocked(pred, what), 1,
      `the ${what} carries no padlock on a steward without content. On a phone there is no hover and so no ` +
      'tooltip, which makes the glyph the only thing that says "locked" before the press.');
    assert.match(p.tip(pred, what), /Your church hasn’t given you Groups & rotas/,
      `the ${what} lost its tooltip, so on a desktop console nothing says why it is locked. Tooltip: ` + p.tip(pred, what));
  }
  // The other two directions, so a "fix" that padlocks everyone cannot pass: neither the OWNER console nor
  // a rostered CONTENT steward — the whole point of option A, Phase 2 — shows a padlock on any of the three.
  const o = await sermonsPanel({ delegated: false, encOn: false, list: SERMON1 });
  const c = await sermonsPanel({ delegated: true, caps: ['content'], encOn: false, list: SERMON1 });
  for (const [pred, what] of [[UPLOAD_BTN, 'Upload button'], [PEN_BTN, 'Edit (pen) button'], [TRASH_BTN, 'Remove (trash) button']]) {
    assert.equal(o.padlocked(pred, what), 0, `the OWNER console shows a padlock on the ${what}, which it may use`);
    assert.equal(c.padlocked(pred, what), 0, `a CONTENT steward’s console shows a padlock on the ${what}, which it may now use`);
  }
});
