// EVERY CONTROL SAYS WHAT IT IS, AND EVERY SWITCH SAYS WHETHER IT IS ON.
// Run: node --test scripts/controls-have-accessible-names.test.mjs
//
// Found while driving the app and console over CDP, 2026-08-27. Three gaps, all measured by reading the live
// DOM rather than the source:
//   - the member app's DM and group-chat send buttons had aria-label null — the care conversation's had one,
//     so this was an inconsistency, not a house style
//   - "Toggle practical care" and "Toggle giving" had no aria-checked, while eight sibling toggles did: a
//     screen-reader user could not tell whether care or giving was switched on
//   - the console's care conversation was not a dialog at all (no role, no aria-modal) and Escape did nothing,
//     so a keyboard user's only way out was a mouse click on the backdrop
//
// These are small, and they are the difference between a church member being able to use this and not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const CHAT = read('app/screens-chat.jsx');
const MEALS = read('app/stew-meals.jsx');
const DASH = read('app/stew-dashboard.jsx');
const SCHED = read('app/stew-schedule.jsx');
// Comments are stripped before any of the Groups/Rota assertions below: this repo has already shipped an
// assertion that was satisfied by the comment explaining the rule.
const stripC = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const SCHED_CODE = stripC(SCHED), DASH_CODE = stripC(DASH);
const lineWith = (src, needle) => {
  const l = src.split('\n').find(x => x.includes(needle));
  assert.ok(l, 're-anchor this test: could not find ' + needle);
  return l;
};

// A button is "named" if it carries a NON-EMPTY aria-label or title. Merely CONTAINING the word aria-label is
// not enough: `aria-label=""` passed the first version of this test while a screen reader announced nothing
// but "button". An audit defeated it exactly that way, 2026-08-28.
const namedBy = (line, attr) => {
  const m = new RegExp(attr + '=(?:"([^"]*)"|\\{([^}]*)\\})').exec(line);
  if (!m) return false;
  const v = (m[1] !== undefined ? m[1] : m[2]) || '';
  const t = v.trim();
  // …and a label of nothing but quotes or whitespace is not a label. `aria-label={' '}` passed the first
  // hardening: non-empty by length, silent to a screen reader.
  return t.length > 0 && t !== '""' && t !== "''" && t !== "' '" && t !== '" "' && /[^\s'"{}]/.test(t);
};
// VISIBLE TEXT IS AN ACCESSIBLE NAME TOO. The first version of this only looked at aria-label/title, so it
// reported two buttons reading "Not now" and "Post to the church" as unnamed — they sit near a send icon and
// are perfectly well named by their own words. A scanner that cries wolf gets its findings dismissed, which
// is worse than not having one. Only genuinely icon-only controls count.
function hasVisibleText(line) {
  const open = line.indexOf('<button');
  const body = line.slice(line.indexOf('>', open) + 1);
  const withoutTags = body.replace(/<[^>]*>/g, ' ');
  // a bare word, or a string inside a JSX expression like {busy ? 'Posting…' : 'Post to the church'}
  return /[A-Za-z]{2,}/.test(withoutTags.replace(/\{[^}]*\}/g, m => (m.match(/'[^']*'|"[^"]*"/g) || []).join(' ')));
}
function unnamedIconButtons(src, iconName) {
  const lines = src.split('\n');
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.includes('<button')) continue;
    if (namedBy(l, 'aria-label') || namedBy(l, 'title')) continue;
    if (hasVisibleText(l)) continue;
    if (!lines.slice(i, i + 4).join('\n').includes(`name="${iconName}"`)) continue;
    bad.push(i + 1);
  }
  return bad;
}

test('every send button in the member app has an accessible name', () => {
  const bad = unnamedIconButtons(CHAT, 'send');
  assert.deepEqual(bad, [],
    `send buttons with no accessible name at app/screens-chat.jsx:${bad.join(', ')} — a screen reader ` +
    'announces "button" and nothing else, so there is no way to know it sends the message');
});

test('the practical-care switch reports whether it is on', () => {
  const helper = MEALS.slice(MEALS.indexOf('const toggleBtn = '), MEALS.indexOf('const toggleBtn = ') + 700);
  assert.match(helper, /role="switch"/, 'the toggle is not announced as a switch');
  assert.match(helper, /aria-checked=\{!!active\}/,
    'the toggle does not report its state, so a screen-reader user cannot tell whether practical care is on');
});

test('the giving switch reports whether it is on', () => {
  const at = DASH.indexOf('aria-label="Toggle giving"');
  assert.ok(at > 0, 're-anchor: the giving toggle has moved');
  const btn = DASH.slice(at - 200, at + 200);
  assert.match(btn, /role="switch"/, 'the giving toggle is not announced as a switch');
  // …and reports the REAL state. `aria-checked={false}` satisfied the old assertion while announcing "off"
  // whatever the setting was — the audit's exact defeat.
  // Pinned to the exact expression on purpose. A looser check accepted `aria-checked={!giving}` and
  // `{giving && false}` — both mention the state and both announce the wrong one. This is a one-line control
  // that has no reason to change shape; if it does, read this and decide deliberately.
  assert.match(btn, /aria-checked=\{!!church\.giving\}/,
    'the giving toggle no longer announces the real setting — check it is not negated or ANDed to a constant');
});

test('the console’s care conversation is a real dialog, and Escape closes it', () => {
  const at = MEALS.indexOf("width: 440, maxWidth: '92%', height: '70vh'");
  assert.ok(at > 0, 're-anchor: the care conversation panel has moved');
  const panel = MEALS.slice(at - 300, at + 100);
  assert.match(panel, /role="dialog"/, 'the panel is an anonymous div to a screen reader');
  assert.match(panel, /aria-modal="true"/, 'nothing tells assistive tech the rest of the page is inert');
  // …and the handler must actually CLOSE it. `if (e.key === 'Escape') {}` satisfied the old assertion while
  // Escape did nothing at all — the audit's exact defeat.
  // Comments stripped first: this repo has shipped an assertion that was satisfied by the comment explaining
  // the rule, and the raw-source anchor would find the FIRST mention rather than the handler.
  const MEALS_CODE = MEALS.replace(/\/\/.*$/gm, '');
  const keyAt = MEALS_CODE.indexOf("e.key === 'Escape'");
  assert.ok(keyAt > 0,
    'Escape does not close the care conversation — a keyboard user’s only way out is a mouse click on the ' +
    'backdrop, which is not a way out at all');
  assert.match(MEALS_CODE.slice(keyAt, keyAt + 120), /onClose\(\)/,
    'the Escape handler exists but does not close anything');
});


// ── SWEEP DEFECT 4, and the audit of it, 2026-08-29 ──────────────────────────────────────────────────────
// The first version of this section asserted that an IDENTIFIER appeared on a line — `l.includes('r.name')`.
// An auditor changed `'Remove the role ' + (r.name || '')` to `(r.name && '')`, which announces nothing at
// all, and every one of these passed. Four realistic regressions shipped green, including a brand-new
// unnamed button, because nothing here scanned for one.
//
// So these no longer look at the source shape. They pull the aria-label EXPRESSION out of the shipped file
// and EVALUATE it, and assert the sentence a screen reader is actually handed. A comment cannot satisfy
// that, and neither can dead code that merely mentions the right variable.
function ariaExpr(src, marker) {
  const line = src.split('\n').find(l => l.includes(marker) && l.includes('aria-label='));
  assert.ok(line, `no aria-label on the line carrying ${marker} — re-anchor this test, do not delete it`);
  const at = line.indexOf('aria-label={');
  assert.notEqual(at, -1, `${marker}: aria-label is a static string; these controls must describe live state`);
  let depth = 0, i = at + 'aria-label='.length, start = i;
  for (; i < line.length; i++) {
    if (line[i] === '{') depth++;
    else if (line[i] === '}' && --depth === 0) return line.slice(start + 1, i);
  }
  assert.fail(`could not read the aria-label expression for ${marker}`);
}
// Evaluate it with the values the console would really have.
const announce = (expr, vars) => new Function(...Object.keys(vars), `return (${expr});`)(...Object.values(vars));

test('an empty rota slot says what it will assign, instead of running the role into the word Assign', () => {
  const said = announce(ariaExpr(SCHED_CODE, "'Assign someone to '"), { role: { name: 'Door' } });
  assert.equal(said, 'Assign someone to Door',
    'the empty rota slot announced "' + said + '" — it used to run the role name into the word Assign');
  assert.equal(announce(ariaExpr(SCHED_CODE, "'Assign someone to '"), { role: {} }), 'Assign someone to this role',
    'a role document with no name makes the button announce the literal word "undefined"');
});

test('a filled rota slot names the role, the person and their reply', () => {
  const e = ariaExpr(SCHED_CODE, 'Change who’s on this slot" aria-label=');
  assert.equal(announce(e, { role: { name: 'Door' }, a: { name: 'Sam Reed' }, vm: { label: 'Declined' } }),
    'Door: Sam Reed — Declined. Change who’s on this slot');
  assert.equal(announce(e, { role: { name: 'Door' }, a: { name: 'Jo Ash' }, vm: { label: '' } }),
    'Door: Jo Ash. Change who’s on this slot', 'a slot with no reply announces a dangling em-dash');
  assert.equal(announce(e, { role: {}, a: { name: 'Jo Ash' }, vm: { label: '' } }),
    'This role: Jo Ash. Change who’s on this slot');
});

test('every roster remove button says WHICH role, person or pod it removes', () => {
  assert.equal(announce(ariaExpr(SCHED_CODE, "'Remove the role '"), { r: { name: 'Door' } }), 'Remove the role Door');
  assert.equal(announce(ariaExpr(SCHED_CODE, "'Remove ' + (pp.name"), { pp: { name: 'Sam Reed' } }), 'Remove Sam Reed from the team');
  assert.equal(announce(ariaExpr(SCHED_CODE, "'Remove the pod '"), { pod: { name: 'Pod A' } }), 'Remove the pod Pod A');
  // …and a blank name must not produce a button that announces a bare verb. A steward can clear a pod's
  // name through the shipped UI, and then the delete control said only "Remove the pod".
  for (const [marker, vars, empty] of [
    ["'Remove the role '", { r: { name: '' } }, 'Remove the role '],
    ["'Remove the pod '", { pod: { name: '' } }, 'Remove the pod '],
  ]) {
    const said = announce(ariaExpr(SCHED_CODE, marker), vars);
    assert.notEqual(said, empty, `a nameless item announces "${empty}" — no cue at all as to what goes`);
  }
});

test('the pods editor is not a column of blank comboboxes', () => {
  assert.equal(announce(ariaExpr(SCHED_CODE, 'setPodFill(pod.id, r.id'), { r: { name: 'Door' }, pod: { name: 'Pod A' } }),
    'Who fills Door in Pod A',
    'a steward building a six-role pod tabs through six identical "combo box, blank"');
  for (const marker of ['setPodName(pod.id', 'setLinkPub(e.target.value)']) {
    const line = SCHED_CODE.split('\n').find(l => l.includes(marker));
    assert.match(line, /aria-label="[^"]+"/, `${marker} has no accessible name`);
  }
});

test('the rota-visibility button announces what it governs, and is not announced as a menu', () => {
  const said = announce(ariaExpr(SCHED_CODE, 'aria-expanded={!!visMenu}'),
    { ROTA_VIS_LABEL: { church: 'Everyone' }, rotaVis: 'church' });
  assert.match(said, /^Who can see the rota: Everyone/,
    'the visibility button announced "' + said + '" — its value, with nothing saying what it sets');
  // It is two plain buttons, not a menu. Announcing one promises arrow-key navigation that does not exist.
  assert.doesNotMatch(SCHED_CODE, /aria-haspopup="menu"/,
    'a popup is announced as a menu again, but has no menu roles and no arrow-key handling');
  // …and Escape must close it, or a keyboard steward is trapped.
  assert.match(SCHED_CODE, /e\.key === 'Escape' && visMenu/, 'Escape no longer closes the visibility popup');
  assert.match(SCHED_CODE, /visBtnRef\.current\.focus\(\)/, 'focus is not returned to the control that opened it');
});

// Pinned to the exact expressions, as the giving toggle above is: `aria-pressed={false}` and
// `aria-pressed={!it.childsafe}` both mention the state and both announce the wrong one.
test('the Child-safe and Encrypt toggles report their REAL state and name their group', () => {
  const cs = lineWith(DASH_CODE, 'childsafe: !it.childsafe');
  assert.match(cs, /aria-pressed=\{!!it\.childsafe\}/,
    'Child-safe does not announce whether it is on — check it is not negated or pinned to a constant');
  assert.equal(announce(ariaExpr(DASH_CODE, 'childsafe: !it.childsafe'), { it: { name: 'Youth', childsafe: true } }),
    'Youth — child-safe is on. Press to restrict it to adults');
  assert.equal(announce(ariaExpr(DASH_CODE, 'childsafe: !it.childsafe'), { it: { name: '', childsafe: false } }),
    'This group — child-safe is off. Press to let members marked as a child join');

  const en = lineWith(DASH_CODE, 'onClick={() => toggleEncrypt(it)}');
  assert.match(en, /aria-pressed=\{!!it\.encrypted\}/,
    'Encrypt does not announce whether it is on — check it is not negated or pinned to a constant');
  assert.equal(announce(ariaExpr(DASH_CODE, 'onClick={() => toggleEncrypt(it)}'), { it: { name: 'Youth', encrypted: false } }),
    'Youth — encryption is off. Press to seal it end-to-end');
});

test('selection in a row of chips is never carried by colour alone', () => {
  // Three separate controls where the only cue was a coloured fill. The Repeat selector decides whether
  // "Add a service" creates one service or thirteen; the Groups filter decides which rooms you are about to
  // flip a child-safe switch on.
  assert.match(lineWith(SCHED_CODE, 'onClick={() => setRepeat(v)}'), /aria-pressed=\{repeat === v\}/,
    'the Repeat selector does not say which option is chosen');
  assert.match(lineWith(DASH_CODE, 'onClick={() => setKindF(f.key)}'), /aria-pressed=\{on\}/,
    'the Groups filter chips do not say which is selected');
  assert.match(lineWith(SCHED_CODE, 'setFillMenu(v => !v)'), /aria-expanded=\{!!fillMenu\}/,
    'Auto-fill opens a popup and reports nothing');
});

test('the console’s care conversation can be sent and closed by a screen reader', () => {
  // The header of this file records the defect it was written for: the member app's send buttons had no
  // accessible name. The console's own — on the screen where a steward answers somebody asking for help —
  // had none either, and nothing here scanned that file for one.
  const send = lineWith(MEALS, 'onClick={send}');
  assert.match(send, /aria-label="[^"]+"/, 'a steward replying to a request for help hears only "button"');
  const bad = unnamedIconButtons(MEALS, 'send');
  assert.deepEqual(bad, [], `unnamed send buttons at app/stew-meals.jsx:${bad.join(', ')}`);
});

test('a roster save failure is announced, not just drawn', () => {
  // Its text includes "anyone you removed CAN STILL READ IT until this succeeds".
  assert.match(lineWith(SCHED_CODE, '{saveErr ? <div'), /role="alert"/,
    'a security-relevant failure is never read out to a steward using a screen reader');
});
