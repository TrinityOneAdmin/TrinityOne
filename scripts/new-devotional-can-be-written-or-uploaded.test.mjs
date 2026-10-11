// A STEWARD CAN WRITE A DEVOTIONAL IN THE CONSOLE, NOT ONLY UPLOAD ONE.
//   Run: node --test scripts/new-devotional-can-be-written-or-uploaded.test.mjs
//
// Owner request 2026-10-11: a "write devotionals" as well as the upload, in the style of the reading-plan
// dialog, with a large text box for long contemplative text. NewDevotionalModal had only a file picker.
//
// HOW THIS REACHES IT. The REAL console scripts are loaded (scripts/console-screens.mjs) and the REAL
// NewDevotionalModal and DashDevotionals are drawn; the test types into the text box and presses the buttons
// a steward would press, through the handlers the rendered tree carries. window.Steward.publishDevotional is
// a recorder, so what is asserted is the document the dialog hands the engine. Nothing reads app/*.jsx text.
//
// Callers of the code changed (CLAUDE.md rule 2).
//   NewDevotionalModal: DashDevotionals (adding -> no `editing`; editing -> `editing={devo}`), plus
//     scripts/every-console-dialog-mounts.test.mjs, which mounts it once with no `editing`.
//   window.Steward.publishDevotional: NewDevotionalModal.create (changed here), DashDevotionals.republish
//     (reorder/series/schedule/draft; passes d.text through untouched, unchanged), BulkUploadModal's devotional
//     path (unchanged). The engine (src/steward.src.js) is not touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const LONG = 'Be still, and know.\n\nThe first paragraph rests here,\nwith a hard line break inside it.\n\n\n## A heading\n\n- one\n- two\n\nTrailing paragraph — with “curly” quotes and calm.';

function open(props = {}, devos = [], answer = () => Promise.resolve({ id: 'saved' })) {
  const { React, reset, flush, unmount, fresh } = fakeReact();
  const published = [];
  const Steward = fakeSteward({ publishDevotional: (d) => { published.push(d); return answer(); }, subscribeProfile: () => () => {} });
  const { window } = fakeBrowser({ Steward });
  window.useStewardDevotionals = () => devos;
  // a FileReader that actually reads: the dialog's file pick goes through it
  window.FileReader = class { readAsText(f) { this.result = f.content; Promise.resolve().then(() => this.onload && this.onload()); } };
  const { NewDevotionalModal, DashDevotionals } = loadConsole({ React, window, expr: '{ NewDevotionalModal, DashDevotionals }' });
  let tree, closed = 0;
  const draw = (Comp = NewDevotionalModal, p = { ...props, onClose: () => closed++, seriesOptions: [] }) => { reset(); tree = Comp(p); flush(); return tree; };
  const redraw = () => { draw(); draw(); };
  const find = (pred) => nodes(tree).find(pred);
  const btn = (re) => find(n => n.type === 'button' && re.test(texts(n).join('')));
  const area = () => find(n => n.type === 'textarea');
  const input = (ph) => find(n => n.type === 'input' && n.props.placeholder && ph.test(n.props.placeholder));
  const type = (n, v) => { n.props.onChange({ target: { value: v } }); redraw(); };
  const click = (n) => { n.props.onClick(); redraw(); };
  return { fresh, draw, redraw, find, btn, area, input, type, click, published, closed: () => closed, unmount, DashDevotionals };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('a new devotional opens in Write mode, with a text box and both mode buttons', () => {
  const h = open(); h.redraw();
  assert.ok(h.area(), 'no text box in the new-devotional dialog');
  assert.ok(h.btn(/Write/) && h.btn(/Upload file/), 'the Write / Upload file mode buttons are missing');
  assert.equal(h.find(n => n.type === 'input' && n.props.type === 'file'), undefined, 'the file picker is showing in Write mode');
  h.unmount();
});

test('write a title and several paragraphs, Publish now: publishDevotional gets that exact text, line breaks kept', async () => {
  const h = open(); h.redraw();
  h.type(h.input(/Resting in Psalm/), '  Be still  ');
  h.type(h.area(), LONG);
  h.click(h.btn(/Publish now/));
  await tick();
  assert.equal(h.published.length, 1);
  const d = h.published[0];
  assert.equal(d.text, LONG, 'the published text is not the typed text byte for byte');
  assert.equal(d.type, 'txt');
  assert.equal(d.title, 'Be still');
  assert.equal(d.draft, false);
  assert.equal(h.closed(), 1, 'the dialog did not close after publishing');
  h.unmount();
});

test('Save as draft publishes the same text held back', async () => {
  const h = open(); h.redraw();
  h.type(h.input(/Resting in Psalm/), 'T'); h.type(h.area(), LONG);
  h.click(h.btn(/Save as draft/)); await tick();
  assert.equal(h.published[0].text, LONG); assert.equal(h.published[0].draft, true);
  h.unmount();
});

test('an empty (or whitespace-only) body cannot be published, from either button', async () => {
  const h = open(); h.redraw();
  h.type(h.input(/Resting in Psalm/), 'Titled');
  assert.equal(h.btn(/Publish now/).props.disabled, true, 'Publish now is enabled with no text');
  h.type(h.area(), ' \n\n  ');
  assert.equal(h.btn(/Publish now/).props.disabled, true, 'Publish now is enabled with whitespace only');
  assert.equal(h.btn(/Save as draft/).props.disabled, true);
  h.click(h.btn(/Publish now/)); await tick();
  assert.equal(h.published.length, 0, 'an empty devotional was published');
  h.type(h.area(), 'x');
  assert.ok(!h.btn(/Publish now/).props.disabled, 'Publish stays disabled once there is text');
  h.unmount();
});

test('Upload mode still works: a chosen file is what gets published (typed text is not)', async () => {
  const h = open(); h.redraw();
  h.type(h.area(), 'typed words');
  h.click(h.btn(/Upload file/));
  assert.equal(h.area(), undefined, 'the text box is showing in Upload mode');
  assert.ok(h.btn(/Publish now/).props.disabled, 'Publish is enabled in Upload mode with no file chosen');
  const picker = h.find(n => n.type === 'input' && n.props.type === 'file');
  picker.props.onChange({ target: { files: [{ name: 'week-one.md', type: 'text/markdown', size: 20, content: '# From a file\n\nBody.' }] } });
  await tick(); h.redraw();
  assert.equal(h.input(/Resting in Psalm/).props.value, 'week-one', 'the title is not taken from the file name as before');
  h.click(h.btn(/Publish now/)); await tick();
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0].text, '# From a file\n\nBody.');
  assert.equal(h.published[0].type, 'md');
  h.unmount();
});

test('Upload mode rejects a non-text file and will not publish it', () => {
  const h = open(); h.redraw();
  h.click(h.btn(/Upload file/));
  h.type(h.input(/Resting in Psalm/), 'T');
  h.find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [{ name: 'a.pdf', type: 'application/pdf', size: 5, content: '' }] } });
  h.redraw();
  assert.ok(h.btn(/Publish now/).props.disabled);
  h.unmount();
});

test('switching Write -> Upload file -> Write keeps what was typed', () => {
  const h = open(); h.redraw();
  h.type(h.area(), LONG);
  h.click(h.btn(/Upload file/));
  h.click(h.btn(/Write/));
  assert.equal(h.area().props.value, LONG, 'typed text was lost on a mode switch');
  h.unmount();
});

test('editing opens in Write mode with the existing text loaded, and saving re-publishes the edited wording under the same id', async () => {
  const devo = { id: 'd1', title: 'Old title', ref: 'Psalm 23', series: 'Weekly', type: 'txt', text: 'Old words.\n\nSecond.', order: 3, draft: false, public: true, publishAt: 0 };
  const h = open({ editing: devo }); h.redraw();
  assert.equal(h.area().props.value, 'Old words.\n\nSecond.', 'the existing text is not loaded into the text box');
  h.type(h.area(), 'Old words, reworded.\n\nSecond.');
  h.click(h.btn(/Save changes/)); await tick();
  const d = h.published[0];
  assert.equal(d.id, 'd1'); assert.equal(d.text, 'Old words, reworded.\n\nSecond.');
  assert.equal(d.title, 'Old title'); assert.equal(d.ref, 'Psalm 23'); assert.equal(d.series, 'Weekly');
  assert.equal(d.order, 3); assert.equal(d.public, true); assert.equal(d.draft, false);
  h.unmount();
});

test('editing: clearing the text disables Save changes', () => {
  const h = open({ editing: { id: 'd1', title: 'T', type: 'txt', text: 'abc', draft: false } }); h.redraw();
  h.type(h.area(), '');
  assert.ok(h.btn(/Save changes/).props.disabled);
  h.unmount();
});

test('editing in Upload mode with no new file keeps the old text and type', async () => {
  const h = open({ editing: { id: 'd1', title: 'T', type: 'md', text: 'kept', draft: false } }); h.redraw();
  h.click(h.btn(/Upload file/));
  h.click(h.btn(/Save changes/)); await tick();
  assert.equal(h.published[0].text, 'kept'); assert.equal(h.published[0].type, 'md');
  h.unmount();
});

// ── a refused publish must not eat the steward's writing (audit of 38f4aac) ───────────────────────────────
for (const [how, answer] of [['resolves null (no key / refused)', () => Promise.resolve(null)], ['rejects', () => Promise.reject(new Error('relay down'))]]) {
  test('publishDevotional ' + how + ': the dialog stays open, the text is intact, and it says Not saved', async () => {
    const h = open({}, [], answer); h.redraw();
    h.type(h.input(/Resting in Psalm/), 'Title'); h.type(h.area(), LONG);
    h.click(h.btn(/Publish now/)); await tick(); h.redraw();
    assert.equal(h.closed(), 0, 'THE DIALOG CLOSED ON A REFUSED PUBLISH — the typed text is gone');
    assert.equal(h.area().props.value, LONG, 'the typed text was lost');
    assert.match(texts(h.find(n => n.props && n.props.role === 'alert')).join(''), /Not saved/);
    assert.ok(!h.btn(/Publish now/).props.disabled, 'the button stayed stuck on busy, so the steward cannot try again');
    h.unmount();
  });
}

test('after a refused publish a retry that succeeds closes the dialog and clears the message', async () => {
  let n = 0;
  const h = open({}, [], () => Promise.resolve(n++ === 0 ? null : { id: 'ok' })); h.redraw();
  h.type(h.input(/Resting in Psalm/), 'Title'); h.type(h.area(), LONG);
  h.click(h.btn(/Publish now/)); await tick(); h.redraw();
  assert.equal(h.closed(), 0);
  h.click(h.btn(/Publish now/)); await tick(); h.redraw();
  assert.equal(h.closed(), 1);
  assert.equal(h.find(x => x.props && x.props.role === 'alert'), undefined);
  h.unmount();
});

test('editing: a refused Save changes also stays open with the edited text', async () => {
  const h = open({ editing: { id: 'd1', title: 'T', type: 'txt', text: 'abc', draft: false } }, [], () => Promise.resolve(null)); h.redraw();
  h.type(h.area(), 'abc, edited');
  h.click(h.btn(/Save changes/)); await tick(); h.redraw();
  assert.equal(h.closed(), 0); assert.equal(h.area().props.value, 'abc, edited');
  assert.match(texts(h.find(n => n.props && n.props.role === 'alert')).join(''), /Not saved/);
  h.unmount();
});

test('editing an old devotional whose stored text is empty: a title-only change can be saved; a new one still needs text', async () => {
  const h = open({ editing: { id: 'd0', title: 'Old', type: 'txt', text: '', draft: false } }, []); h.redraw();
  h.type(h.input(/Resting in Psalm/), 'Renamed');
  assert.ok(!h.btn(/Save changes/).props.disabled, 'a title-only edit of an empty-bodied devotional is blocked');
  h.click(h.btn(/Save changes/)); await tick();
  assert.equal(h.published[0].title, 'Renamed'); assert.equal(h.published[0].text, '');
  const n = open(); n.redraw(); n.type(n.input(/Resting in Psalm/), 'T');
  assert.ok(n.btn(/Publish now/).props.disabled, 'a NEW devotional can be published empty');
  h.unmount(); n.unmount();
});

test('POINT OF USE: the devotionals screen offers "New devotional", and it opens the dialog with a text box', () => {
  const h = open({}, []);
  h.draw(h.DashDevotionals, {}); h.draw(h.DashDevotionals, {});
  const opener = h.btn(/New devotional/);
  assert.ok(opener, 'the devotionals screen has no "New devotional" button');
  assert.equal(h.btn(/Upload devotional/), undefined, 'the old "Upload devotional" label is still there');
  assert.equal(h.find(n => typeof n.type === 'function' && n.type.name === 'NewDevotionalModal'), undefined, 'the dialog is open before the button is pressed');
  opener.props.onClick();
  h.draw(h.DashDevotionals, {}); h.draw(h.DashDevotionals, {});
  // child components are not called by the harness: call the one the screen mounted, with the props it gave it
  const mounted = h.find(n => typeof n.type === 'function' && n.type.name === 'NewDevotionalModal');
  assert.ok(mounted, 'pressing New devotional did not mount the dialog');
  assert.ok(!mounted.props.editing, 'the New devotional button opened the dialog in edit mode');
  h.fresh(); h.draw(mounted.type, mounted.props); h.draw(mounted.type, mounted.props);
  assert.ok(h.area(), 'the dialog the screen opened has no text box');
  h.unmount();
});
