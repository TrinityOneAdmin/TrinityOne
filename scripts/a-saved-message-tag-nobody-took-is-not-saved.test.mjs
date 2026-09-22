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
import { miniReact, texts, button } from './render-jsx-screen.mjs';

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
    now: () => 1700000000,
    sk: 'SK', pub: 'CP', NET: 'trinityone',
    MSGTAGS_D: 'trinityone/msgtags', SERMON_D: 'trinityone/sermon:', MEDIAKEY_D: 'trinityone/mediakey:',
    BACKUPMETA_D: 'trinityone/backup-meta:',
    _sanitizeMsgTags: (t) => t,
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
  const no = await runLifted('publishSermon(s)', 'publishSermon', false, {}, [{ title: 'Sunday', sha256: 'aa', host: 'h' }]);
  await assert.rejects(no.call(), /every relay rejected it/, 'publishSermon has lost its refusal check');
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
