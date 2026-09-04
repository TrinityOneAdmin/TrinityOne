// A SUITE BOX MUST REGISTER THE CHURCH WITH ITSELF — NOBODY SHOULD HAVE TO ASK IT TWICE.
// Run: node --test scripts/a-new-church-registers-itself-with-its-own-box.test.mjs
//
// Owner's decision, 2026-09-04: "a suite box should auto register". Measured on a clean relay the same day,
// BEFORE this fix: create a church, type its name, and the box ends with no church.json, no selfreg record,
// and two refused writes. Calling Steward.selfRegister(name) by hand registered it instantly — so the
// mechanism was fine and only the trigger was missing.
//
// THE DEADLOCK it removes. The console's other self-registration is an effect keyed on `church.name`, and
// `church.name` is read back FROM THE RELAY. A relay refuses every write for a church it does not know, so
// the name can never come back, so the effect never fires, so the church is never registered. On a
// self-hosted box, with no second relay to break the tie, nothing the steward does in the whole wizard is
// ever stored. Registration is deliberately deferred until a NAME exists (a nameless one is refused on
// purpose — gateway H4), and saveName is the first moment one does.
//
// POINT OF USE (rule 1): this EXECUTES the real `saveName` out of app/stew-dashboard.jsx — the file the
// console ships unbundled — rather than matching text in it, which rule 3 forbids because `false && ` in
// front of a condition would leave every word of it in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const STEW = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

// Take `saveName`'s arrow function, from its `async (` to the brace that closes it.
function sliceSaveName(src) {
  const at = src.indexOf('const saveName = async () => {');
  assert.notEqual(at, -1, 'saveName is missing — re-anchor this test rather than widening the window');
  const arrow = src.indexOf('async () => {', at);
  const open = src.indexOf('{', arrow);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(i < src.length, 'saveName never closes — the brace walk ran off the end');
  const body = src.slice(arrow, i + 1);
  assert.ok(body.length > 200, 'saveName sliced to a stub — re-anchor rather than widening');
  return body;
}

// Run it with a scope it cannot escape, recording the ORDER of everything it asks Steward to do.
async function runSaveName({ typed, existingName = '', selfRegister }) {
  const calls = [];
  const Steward = {
    selfRegister: selfRegister || (async (n) => { calls.push(['selfRegister', n]); return { ok: true }; }),
    publishProfile: async (p) => { calls.push(['publishProfile', p.name]); return { ok: true }; },
    ensureJoinPolicy: async () => { calls.push(['ensureJoinPolicy']); return true; },
  };
  if (selfRegister) {
    const inner = selfRegister;
    Steward.selfRegister = async (n) => { calls.push(['selfRegister', n]); return inner(n); };
  }
  const scope = {
    name: typed,
    church: { name: existingName, nip05: 'x@y' },
    setBusy: () => {},
    next: () => calls.push(['next']),
    window: { Steward },
  };
  const fn = new Function('scope', `with (scope) { return (${sliceSaveName(STEW)}); }`)(scope);
  await fn();
  return calls;
}

test('THE FIX: naming a new church registers it with the relay, and does so BEFORE publishing', async () => {
  const calls = await runSaveName({ typed: "Saint Brendan's, Clean Box" });
  const names = calls.map(c => c[0]);

  assert.ok(names.includes('selfRegister'),
    'the wizard published the church profile without ever registering the church. A relay refuses every ' +
    'write for a church it does not know, and the only other self-registration waits for the name to come ' +
    'back FROM the relay — which it never can, because that write is the one being refused. On a ' +
    'self-hosted box nothing the steward sets up is stored.');

  assert.deepEqual(calls.find(c => c[0] === 'selfRegister'), ['selfRegister', "Saint Brendan's, Clean Box"],
    'registered under the wrong name — the relay refuses a nameless registration on purpose (gateway H4), ' +
    'so it must carry the name the steward just typed');

  assert.ok(names.indexOf('selfRegister') < names.indexOf('publishProfile'),
    'registered AFTER publishing the profile, so the profile write is still the one the relay refuses — ' +
    'the order is the whole fix');
});

test('a refused registration does not stop the wizard or lose the name', async () => {
  const calls = await runSaveName({
    typed: 'Refused Church',
    selfRegister: async () => { throw new Error('this relay is invite-only'); },
  });
  const names = calls.map(c => c[0]);
  assert.ok(names.includes('publishProfile'),
    'a relay that refuses registration (invite-only, or the operator adds churches by hand) must not ' +
    'prevent the profile being published — the church may live on another relay entirely');
  assert.ok(names.includes('next'),
    'the steward was trapped on the naming step by a relay that was never going to accept them');
});

test('renaming to the SAME name does not re-register', async () => {
  const calls = await runSaveName({ typed: 'Same Name', existingName: 'Same Name' });
  assert.ok(!calls.map(c => c[0]).includes('selfRegister'),
    're-registers on every render when nothing changed — selfRegister is an HTTP round trip per relay');
});
