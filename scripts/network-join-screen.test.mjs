// THE HONEST JOIN SCREEN, AND A NETWORK PANEL THAT TELLS THE TRUTH (Networks MVP, N2 + N3 -- the screen).
// Run: node --test scripts/network-join-screen.test.mjs
//
// The REAL DashNetworksPanel from app/stew-dashboard.jsx, loaded with every script steward.html lists (the way
// the phone loads them), drawn with the fake React hook store of console-screens.mjs and driven through its own
// onClick / onChange handlers. Nothing here matches source text (CLAUDE.md rule 3): each claim is made by
// pressing the control and looking at what the panel then does and says.
//
//  (a) Pressing Join does NOT join: it shows the screen. Joining needs the box ticked -- remove the confirm step
//      (join() calling joinNetwork, or confirmJoin ignoring `agreed`) and (a) fails.
//  (b) A join the console reports as failed shows the relay's own words and keeps the typed code.
//  (c) The scopes handed to joinNetwork are the consent the screen listed.
//  (d) create / leave failures are shown, not swallowed; a partial create says so and offers a retry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const NPUB = 'npub1' + 'q'.repeat(58);
const NETPUB = 'cd'.repeat(32);
const RELAY_WORDS = 'blocked: not a member or not permitted for this group';

function boot({ join = async () => ({ ok: true }), create = async () => ({ ok: true }), leave = async () => ({ ok: true }), nets = [], retry = async () => ({ ok: true }) } = {}) {
  const calls = { join: [], create: [], leave: [], retry: [] };
  const Steward = fakeSteward({
    actingChurch: '',
    resolveNetwork: async (x) => (String(x).startsWith('npub1') ? { networkPub: NETPUB, npub: x } : null),
    subscribeNetworkProfile: (p, cb) => { cb({ name: 'Sussex Gospel Partnership' }); return () => {}; },
    joinNetwork: async (...a) => { calls.join.push(a); return join(...a); },
    createNetwork: async (...a) => { calls.create.push(a); return create(...a); },
    leaveNetwork: async (...a) => { calls.leave.push(a); return leave(...a); },
    retryNetworkProfile: async (...a) => { calls.retry.push(a); return retry(...a); },
  });
  const r = fakeReact();
  const { window } = fakeBrowser({ Steward });
  window.confirm = () => true;
  const Panel = loadConsole({ React: r.React, window, expr: 'DashNetworksPanel' });
  window.useStewardNetworks = () => nets;
  const draw = () => { r.reset(); Panel(); r.flush(); r.reset(); const t = Panel(); r.flush(); return t; };   // twice: an effect's setState lands on the next draw
  const say = () => texts(draw()).join(' ');
  const btn = (label) => nodes(draw()).find(n => n.props && typeof n.props.onClick === 'function' && texts(n).join('').trim() === label);
  const box = () => nodes(draw()).find(n => n.props && n.props.type === 'checkbox');
  const codeInput = () => nodes(draw()).find(n => n.props && n.props['aria-label'] === 'Network code (npub) to join');
  const type = (v) => codeInput().props.onChange({ target: { value: v } });
  return { calls, draw, say, btn, box, codeInput, type, window };
}
const settle = () => new Promise(r => setTimeout(r, 0));

async function toTheJoinScreen(p) {
  p.draw(); p.type(NPUB);
  await p.btn('Join').props.onClick(); await settle();
}

test('(a) pressing Join shows the screen and does NOT join', async () => {
  const p = boot();
  await toTheJoinScreen(p);
  assert.equal(p.calls.join.length, 0, 'Join joined straight away -- the confirm step is gone');
  const said = p.say();
  assert.match(said, /Join\s+Sussex Gospel Partnership\s*\?/, 'the screen does not name the network by its profile name');
  assert.doesNotMatch(said, /Join\s+npub1/, 'the screen shows the npub instead of the name');
});

test('(a) the screen says what the network CAN and CANNOT do, and that you can leave', async () => {
  const p = boot();
  await toTheJoinScreen(p);
  const said = p.say().replace(/\s+/g, ' ');
  // PORTED 2026-11-19 (B2a): no feed (owner: announcements and events only), and the screen now says what other churches will see.
  assert.match(said, /THE NETWORK CAN Post announcements and events to your members\./);
  assert.doesNotMatch(said, /feed/i, 'the join screen still promises a feed');
  // B2a audit: there is no town field -- the screen says only what is true
  assert.match(said, /WHAT THE NETWORK’S CHURCHES WILL SEE The network and its other churches will see that your church has joined, and can see your church’s public profile \(its name and picture\)\./);
  assert.doesNotMatch(said, /town/i, 'the join screen promises a town the app does not have');
  assert.match(said, /THE NETWORK CANNOT See or change anything of your church’s own: your children’s records, guardians, check-in, care and pastoral conversations, your rotas, plans and groups, your members, or your finance\./);
  assert.match(said, /You can leave at any time\./);
});

test('(a) the join does not go ahead until the box is ticked; ticked, it does, with the scopes the screen listed', async () => {
  const p = boot();
  await toTheJoinScreen(p);
  await p.btn('Join network').props.onClick(); await settle();
  assert.equal(p.calls.join.length, 0, 'the confirm button joined without the box ticked');
  assert.equal(p.btn('Join network').props.disabled, true, 'the confirm button looks live while unticked');
  p.box().props.onChange({ target: { checked: true } });
  p.draw();
  await p.btn('Join network').props.onClick(); await settle();
  assert.equal(p.calls.join.length, 1);
  assert.equal(p.calls.join[0][0], NPUB);
  assert.equal(JSON.stringify(p.calls.join[0][1]), JSON.stringify({ scopes: ['announcements', 'events'] }), 'the consent record is not what the screen listed');
  assert.equal(p.codeInput().props.value, '', 'a successful join left the code in the box');
  assert.doesNotMatch(p.say(), /Before you join|THE NETWORK CAN/, 'the screen is still up after a successful join');
});

test('(b) a failed join shows the relay\'s words, keeps the typed code, and reports no success', async () => {
  const p = boot({ join: async () => ({ ok: false, stage: 'join', reason: RELAY_WORDS }) });
  await toTheJoinScreen(p);
  p.box().props.onChange({ target: { checked: true } }); p.draw();
  await p.btn('Join network').props.onClick(); await settle();
  assert.equal(p.calls.join.length, 1);
  const said = p.say().replace(/\s+/g, ' ');
  assert.match(said, /Changes weren’t saved — your relays aren’t carrying this church/, 'the failure is not shown at all: ' + said.slice(0, 200));
  assert.equal(p.codeInput().props.value, NPUB, 'the draft was cleared by a failed join');
  assert.match(said, /Join\s+Sussex Gospel Partnership\s*\?/, 'the screen vanished as if the join had worked');
});

test('(b) B2a: a join refused because a relay lacks the WALL names that relay in plain words and reports no success', async () => {
  const p = boot({ join: async () => ({ ok: false, stage: 'relay', missing: ['wss://old.example/relay'], reason: 'Not joined. …' }) });
  await toTheJoinScreen(p);
  p.box().props.onChange({ target: { checked: true } }); p.draw();
  await p.btn('Join network').props.onClick(); await settle();
  const said = p.say().replace(/\s+/g, ' ');
  assert.match(said, /Not joined: wss:\/\/old\.example\/relay hasn’t confirmed the network safety update\./, 'the steward is not told which relay blocks the join: ' + said.slice(0, 300));
  assert.equal(p.codeInput().props.value, NPUB, 'the draft was cleared by a refused join');
  assert.match(said, /Join\s+Sussex Gospel Partnership\s*\?/, 'the screen vanished as if the join had worked');
});

test('(b) B2a audit: a join refused because a relay could not be REACHED says "couldn\'t reach … try again later", not "update it"', async () => {
  const p = boot({ join: async () => ({ ok: false, stage: 'relay', missing: ['wss://down.example/relay'], lacking: [], unreachable: ['wss://down.example/relay'], reason: 'x' }) });
  await toTheJoinScreen(p);
  p.box().props.onChange({ target: { checked: true } }); p.draw();
  await p.btn('Join network').props.onClick(); await settle();
  const said = p.say().replace(/\s+/g, ' ');
  assert.match(said, /Not joined: couldn’t reach wss:\/\/down\.example\/relay to check it is up to date\. Try again later\./, said.slice(0, 300));
  assert.doesNotMatch(said, /safety update|remove/i);
});

test('(b) editing the code after the screen is up withdraws the screen (the yes was for another network)', async () => {
  const p = boot();
  await toTheJoinScreen(p);
  p.type('npub1' + 'z'.repeat(58));
  assert.doesNotMatch(p.say(), /THE NETWORK CAN/);
});

test('a bad code never reaches the screen or joinNetwork', async () => {
  const p = boot();
  p.draw(); p.type('hello');
  await p.btn('Join').props.onClick(); await settle();
  assert.equal(p.calls.join.length, 0);
  assert.match(p.say(), /Paste the network’s code/);
});

test('(d) a create the console reports as failed is shown, makes no "Network created" card, and reopens the dialog with the name', async () => {
  const p = boot({ create: async () => ({ ok: false, stage: 'join', reason: RELAY_WORDS }) });
  p.draw();
  await p.btn('Create a network').props.onClick(); p.draw();
  const input = nodes(p.draw()).find(n => n.props && n.props.placeholder === 'e.g. Regions Beyond');
  input.props.onChange({ target: { value: 'Regions Beyond' } }); p.draw();
  await p.btn('Create').props.onClick(); await settle();
  const said = p.say();
  assert.doesNotMatch(said, /Network created/, 'a refused create was announced as created');
  assert.match(said, /Create a network/);
  assert.equal(nodes(p.draw()).find(n => n.props && n.props.placeholder === 'e.g. Regions Beyond').props.value, 'Regions Beyond', 'the typed name was lost');
});

test('(d) a PARTIAL create says the name is not published and the Publish-the-name button retries it', async () => {
  const p = boot({ create: async () => ({ ok: true, partial: true, failed: ['profile'], reason: 'rate-limited: slow down', networkPub: NETPUB, npub: NPUB, mnemonic: 'one two three' }) });
  p.draw();
  await p.btn('Create a network').props.onClick(); p.draw();
  nodes(p.draw()).find(n => n.props && n.props.placeholder === 'e.g. Regions Beyond').props.onChange({ target: { value: 'Half' } }); p.draw();
  await p.btn('Create').props.onClick(); await settle();
  assert.match(p.say(), /name hasn’t been published yet/);
  assert.match(p.say(), /one two three/, 'the recovery words must still be shown: the church has joined');
  await p.btn('Publish the name').props.onClick(); await settle();
  assert.equal(JSON.stringify(p.calls.retry[0]), JSON.stringify([NETPUB, 'Half']));
  assert.doesNotMatch(p.say(), /name hasn’t been published yet/);
});

test('(d) a leave the console reports as failed is shown, not swallowed', async () => {
  const p = boot({ nets: [{ networkPub: NETPUB, npub: NPUB }], leave: async () => ({ ok: false, stage: 'leave', reason: 'error: relay storage unavailable' }) });
  p.draw();
  const row = nodes(p.draw()).find(n => n.props && typeof n.props.onLeave === 'function');
  await row.props.onLeave({ networkPub: NETPUB }); await settle();
  // MERGE 2026-11-23: leaving asks first (main's SkConfirm replaced the window.confirm). The leave must NOT
  // have fired yet, and the dialog's own Confirm must both fire it and SAY the refusal (B2a kept).
  assert.equal(p.calls.leave.length, 0, 'leave fired before the steward confirmed in the dialog');
  const ask = nodes(p.draw()).find(n => n.props && n.props.title === 'Leave this network?' && typeof n.props.onConfirm === 'function');
  assert.ok(ask, 'no "Leave this network?" confirm appeared after pressing Leave');
  await ask.props.onConfirm(); await settle();
  assert.equal(p.calls.leave.length, 1);
  assert.match(p.say(), /Couldn’t save to the relay/, 'a failed leave said nothing (this is publishErrorMessage\'s own wording for an error: refusal)');
});
