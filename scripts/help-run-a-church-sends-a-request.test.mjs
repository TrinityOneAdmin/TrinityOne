// THE "HELP RUN A CHURCH" WIZARD SENDS A HELPER REQUEST FROM THE INVITE — one path, like joining a church.
// Run: node --test scripts/help-run-a-church-sends-a-request.test.mjs
//
// The delegate (helper) no longer has to leave the wizard, show a code, and hunt for a Settings page. The
// wizard's "Help run a church" leads to a single step — scan or ENTER the church's invite — which calls
// requestSteward(), then shows a calm waiting state. (Owner-initiated invites are THE path; the reciprocal
// "give the owner your code" is a de-emphasised fallback.)
//
// POINT OF USE (CLAUDE.md rules 1 & 3). This MOUNTS the real StewardWelcome out of app/steward-root.jsx
// through console-screens.mjs and PRESSES its real controls; no text is matched in the .jsx. Delete the
// invite step (or stop calling requestSteward) and this fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const INVITE = 'trinityone-stewardinvite:npub1church';

function setup() {
  const fr = fakeReact();
  const reqs = [];                 // every requestSteward(payload) the wizard would publish
  const Steward = fakeSteward({
    createKeyQuiet: () => ({ code: 'trinityone-steward:npub1me', npub: 'npub1me' }),
    stewardName: () => 'Gentle Cedar',
    requestSteward: (payload, name) => { reqs.push([payload, name]); return Promise.resolve({ ok: true, church: 'cc', npub: 'npub1church' }); },
    setPin: async () => {}, enterConsole: () => {}, qrSVG: () => '<svg/>',
  });
  const { window } = fakeBrowser({ Steward });
  const mods = loadConsole({ React: fr.React, window, expr: '{ StewardWelcome }' });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.StewardWelcome(); fr.flush(); return tree; };
  const all = () => nodes(tree);
  const press = (label) => {
    const b = all().find(n => n.type === 'button' && texts(n).join(' ').includes(label));
    assert.ok(b, 're-anchor: no button says "' + label + '"');
    b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw();
  };
  const typeInto = (aria, value) => {
    const i = all().find(n => (n.type === 'input' || n.type === 'textarea') && n.props && n.props['aria-label'] === aria);
    assert.ok(i, 're-anchor: no field "' + aria + '"');
    i.props.onChange({ target: { value }, stopPropagation() {}, preventDefault() {} }); draw();
  };
  draw();
  return { fr, draw, all, press, typeInto, get reqs() { return reqs; }, get tree() { return tree; } };
}

test('Help run a church -> enter the invite -> Send calls requestSteward with the invite', async () => {
  const h = setup();
  h.press('Help run a church');                 // mint a quiet key, go to the invite step
  assert.ok(h.all().some(n => (n.type === 'input') && n.props && n.props['aria-label'] === 'Church invite code'),
    'the wizard does not offer an invite box after "Help run a church"');
  h.typeInto('Your name', 'Ruth Bellamy');   // the name the owner will see (2026-11-12: it used to send the church profile's)
  h.typeInto('Church invite code', INVITE);
  h.press('Send');
  await new Promise(r => setImmediate(r));
  h.draw();

  assert.deepEqual(h.reqs, [[INVITE, 'Ruth Bellamy']], 'requestSteward was not called with the pasted invite and the name typed');
  assert.ok(/Waiting for the church to approve you/.test(texts(h.tree).join(' ')),
    'the calm waiting state did not render after the request was sent');
});

test('the invite step is the primary path; "give the owner your code" is a de-emphasised fallback', () => {
  const h = setup();
  h.press('Help run a church');
  // the code block (headed "Your steward name") is NOT shown up front; it hides behind a fallback toggle
  assert.ok(!/Your steward name/i.test(texts(h.tree).join(' ')), 'the steward code block is shown up front — it must sit behind the fallback');
  assert.ok(h.all().some(n => n.type === 'button' && /Give the owner your code/i.test(texts(n).join(' '))),
    'the de-emphasised code fallback toggle is missing');
  // opening the fallback reveals the code block
  h.press('Give the owner your code');
  assert.ok(/Your steward name/i.test(texts(h.tree).join(' ')), 'the fallback did not reveal the steward code block');
});
