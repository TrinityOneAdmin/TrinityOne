// UNDO MUST BRING BACK THE ROOM THAT WAS DELETED, NOT A ROOM WITH THE SAME NAME.
// Run: node --test scripts/undo-brings-the-room-back-whole.test.mjs
//
// AUDIT 2026-09-02 #2. `doUndo` rebuilt the group from seven named fields — id, name, kind, sub, icon,
// accent, category — and `publishGroup` fills every field it is NOT given with that field's default. So a
// room that was invite-only, encrypted and child-safe came back OPEN, UNENCRYPTED and not child-safe, with
// its member list emptied, under its own name. A churchwarden who deleted "Safeguarding leads" by mistake
// and pressed the Undo offered to her got a room the whole congregation could read, and nothing on screen
// said anything had changed.
//
// The second half of this file is the other half of the same audit finding (#4): the row controls threw
// away publishGroup's result. It returns null when NO relay accepted, and false-y on a PARTIAL write — the
// case that matters, because a child-safe flag that reached one relay of three is enforced on one of three.
// Each control painted the new state regardless.
//
// Point of use (rule 1): this drives the real DashGroups component out of app/stew-dashboard.jsx, presses
// the controls a steward presses, and asserts on what reaches publishGroup and what is on the screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

async function loadConsoleComponent(name, anchor, globals) {
  const src = fnBody(STEW, anchor, name);
  const tmp = join(tmpdir(), 'undo-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__undo_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// The room the finding is about: everything that protects it lives in fields doUndo used to drop.
const SAFEGUARDING_ROOM = {
  id: 'g-sg', name: 'Safeguarding leads', kind: 'group', sub: 'Weekly prayer for the sick and grieving',
  icon: '', accent: '', category: 'staff',
  visibility: 'invite', members: ['aa11', 'bb22'], encrypted: true, childsafe: false,
  leaders: ['aa11'], order: 3,
};

async function groupsTab({ publishResult = (g) => Promise.resolve({ ...g, ts: 1 }), removeResult = () => Promise.resolve({ ok: 1 }) } = {}) {
  const { React, draw } = miniReact();
  const published = [];
  let captured = null;
  const win = {
    Steward: {
      publishGroup: (g) => { published.push(g); return publishResult(g); },
      removeGroup: (id) => removeResult(id),
    },
    useStewardGroups: () => [SAFEGUARDING_ROOM], useStewardRosters: () => [], useStewardMembers: () => [],
    useStewardCategories: () => [], dispatchEvent: () => true,
    addEventListener() {}, removeEventListener() {},
  };
  const Comp = await loadConsoleComponent('DashGroups', 'function DashGroups()', {
    React, window: win, CustomEvent, setTimeout, clearTimeout,
    location: { search: '', hostname: 'x' }, document: { addEventListener() {}, removeEventListener() {} },
    ListPanel: function ListPanel(p) { captured = p; return null; },
    Icon: Stub('Icon'), SkPill: Stub('SkPill'), SkConfirm: Stub('SkConfirm'),
    NewGroupModal: Stub('NewGroupModal'), CategoriesModal: Stub('CategoriesModal'),
    GroupChatModal: Stub('GroupChatModal'), GroupLeadersModal: Stub('GroupLeadersModal'),
    EditGroupMembersModal: Stub('EditGroupMembersModal'), KeyDistributor: Stub('KeyDistributor'),
    useRealMemberCount: () => 5, useStewDialog: () => ({}), // the REAL one computes a display string ("2 members · invite-only") that replaces the group's own
    // subtitle in the row. Stub it to do the same, so a control that republishes the ROW instead of the
    // DOCUMENT is caught here rather than on a church's relay.
    groupLiveSub: () => '2 members · invite-only',
  });
  let tree = draw(Comp, {});
  // miniReact keeps each component's hook store across draws, so a redraw is how a state change becomes
  // visible — the same way a real render does.
  const redraw = () => { tree = draw(Comp, {}); return tree; };
  const btnByText = (re) => find(tree, n => n.type === 'button' && re.test(texts(n).join(' ')));
  // The row's controls are split across TWO ListPanel props — the toggles in renderRight, the delete in
  // renderAside — so search both. Looking in one is how a test concludes a control does not exist.
  // HAND THE ROW WHAT THE LIST ACTUALLY HANDS IT. This used to call renderRight/renderAside with the RAW
  // group constant, which bypassed the decoration the component applies in `items` — so a control that
  // republished the decorated row looked identical to one that republished the document, and the subtitle
  // test below passed on the unfixed code. Take the item out of the props the component built.
  const rowItem = () => {
    assert.ok(captured && Array.isArray(captured.items) && captured.items.length,
      'ListPanel was not given an items array — re-anchor this test');
    const it = captured.items.find(x => x.id === SAFEGUARDING_ROOM.id);
    assert.ok(it, 'the room under test is not in the rendered list');
    assert.notEqual(it.sub, SAFEGUARDING_ROOM.sub,
      'the list is no longer decorating `sub` for display, so this test can no longer tell a row from a ' +
      'document — re-anchor it rather than deleting it');
    return it;
  };
  const btnByTitle = (re) => {
    assert.ok(captured && typeof captured.renderRight === 'function' && typeof captured.renderAside === 'function',
      'the Groups tab no longer renders rows through ListPanel’s renderRight/renderAside — re-anchor this test');
    const it = rowItem();
    return [captured.renderRight(it), captured.renderAside(it)]
      .flatMap(node => find(node, n => n.type === 'button' && re.test(String((n.props || {}).title || ''))));
  };
  return { published, redraw, btnByText, btnByTitle, tree: () => tree, captured: () => captured };
}

test('CONTROL: the room’s row offers a delete, and deleting offers an Undo', async () => {
  const g = await groupsTab();
  const del = g.btnByTitle(/Remove group/);
  assert.equal(del.length, 1, `expected exactly one delete control on the row, found ${del.length} — re-anchor`);
  del[0].props.onClick();
  const confirm = g.redraw() && g.btnByText(/Delete/);
  assert.ok(confirm.length, 'no confirm button appeared after pressing delete — re-anchor this test');
  confirm[confirm.length - 1].props.onClick();
  const undo = g.redraw() && g.btnByText(/^Undo$/);
  assert.equal(undo.length, 1, 'no Undo was offered after deleting — the rest of this file tests Undo');
});

test('UNDO RESTORES THE ROOM’S PROTECTIONS, NOT JUST ITS NAME', async () => {
  const g = await groupsTab();
  g.btnByTitle(/Remove group/)[0].props.onClick();
  g.redraw();
  const confirm = g.btnByText(/Delete/); confirm[confirm.length - 1].props.onClick();
  g.redraw();
  g.btnByText(/^Undo$/)[0].props.onClick();

  assert.equal(g.published.length, 1, 'Undo published nothing — the room is simply gone');
  const back = g.published[0];
  // Each of these was dropped before the fix, and each one is a protection someone chose deliberately.
  assert.equal(back.visibility, 'invite',
    'the room came back OPEN. It was invite-only: everyone in the church can now see and post in a room ' +
    'that existed to be private, and nothing told the steward that pressing Undo changed it');
  assert.deepEqual(back.members, ['aa11', 'bb22'],
    'the room came back with its member list emptied — invite-only with no members is a room nobody can ' +
    'reach, or, once visibility is lost too, a room everybody can');
  assert.equal(back.encrypted, true,
    'the room came back UNENCRYPTED. Its messages were sealed end-to-end before it was deleted');
  assert.equal(back.childsafe, SAFEGUARDING_ROOM.childsafe,
    'the child-safe flag did not survive Undo — the relay reads it before serving a room to a minor');
  assert.deepEqual(back.leaders, ['aa11'], 'the room came back with nobody able to run it');
  // and the things it always did keep must still be kept
  assert.equal(back.id, SAFEGUARDING_ROOM.id);
  assert.equal(back.name, 'Safeguarding leads');
  assert.equal(back.category, 'staff');
});

test('A ROW CONTROL THAT DID NOT SAVE SAYS SO INSTEAD OF PAINTING THE NEW STATE', async () => {
  // publishGroup resolves null when no relay accepted, and false-y on a partial write. Before the fix every
  // one of these controls discarded that and left the row looking as though it had worked.
  const g = await groupsTab({ publishResult: () => Promise.resolve(null) });
  const toggle = g.btnByTitle(/child-safe|Child-safe|Hidden from children/);
  assert.ok(toggle.length, 'no child-safe control on the row — re-anchor this test');
  await toggle[0].props.onClick();
  await new Promise(r => setTimeout(r, 5));
  const onScreen = texts(g.redraw()).join(' ');
  assert.match(onScreen, /didn’t accept|couldn’t|could not/i,
    'the relay refused the change and the console said nothing. A steward who presses "Child-safe" and is ' +
    'shown no error believes a safeguarding setting is in force when it is not');
  assert.match(onScreen, /Safeguarding leads/,
    'the failure message does not name the room it is about');
});

test('UNDO THAT THE RELAY REFUSED DOES NOT CLAIM THE ROOM IS BACK', async () => {
  const g = await groupsTab({ publishResult: () => Promise.resolve(null) });
  g.btnByTitle(/Remove group/)[0].props.onClick();
  g.redraw();
  const confirm = g.btnByText(/Delete/); confirm[confirm.length - 1].props.onClick();
  g.redraw();
  await g.btnByText(/^Undo$/)[0].props.onClick();
  await new Promise(r => setTimeout(r, 5));
  assert.match(texts(g.redraw()).join(' '), /didn’t accept|couldn’t|could not/i,
    'Undo failed and the console said nothing, so the steward believes the room is back when it is gone');
});

// ── FOUND BY THE BATCH 3-7 AUDIT, 2026-09-03 ───────────────────────────────────────────────────────────────
// The row list decorates each group for display — `sub` is replaced with a live string, and `ic`/`fg` are
// added. Batch 3 changed these controls to republish "the whole row", which meant writing that DISPLAY
// string over the group's real subtitle on the relay. The tests above never looked at `sub`, so they were
// green over it. "Publish every field" and "publish the object on screen" are not the same fix.
test('UNDO DOES NOT OVERWRITE THE ROOM’S OWN SUBTITLE WITH A DISPLAY STRING', async () => {
  const g = await groupsTab();
  g.btnByTitle(/Remove group/)[0].props.onClick();
  g.redraw();
  const confirm = g.btnByText(/Delete/); confirm[confirm.length - 1].props.onClick();
  g.redraw();
  g.btnByText(/^Undo$/)[0].props.onClick();
  assert.equal(g.published[0].sub, 'Weekly prayer for the sick and grieving',
    'Undo republished the row\'s DISPLAY subtitle ("2 members · invite-only") over the group\'s real one. ' +
    'The church wrote that sentence; pressing Undo must not replace it with a count');
  assert.equal(g.published[0].ic, undefined, 'a display-only field (ic) was written into the document');
  assert.equal(g.published[0].fg, undefined, 'a display-only field (fg) was written into the document');
});

test('…and neither does the child-safe toggle', async () => {
  const g = await groupsTab();
  const toggle = g.btnByTitle(/child-safe|Child-safe|Hidden from children/);
  toggle[0].props.onClick();
  await new Promise(r => setTimeout(r, 5));
  assert.equal(g.published[0].sub, 'Weekly prayer for the sick and grieving',
    'toggling child-safe rewrote the group’s subtitle as a member count');
  assert.equal(g.published[0].childsafe, true, 'the toggle stopped doing its own job');
});
