// Publish a weekly devotional plan to the throwaway church, from the markdown the author wrote.
//
//   node scripts/seed-devotional.mjs <plan.md> [relay-url]
//
// The source file is laid out for a Nostr long-form editor: each week is a block between `══════` markers,
// opening with `Title: / Summary: / Tags:` lines and then the body. TrinityOne's own devotional document is
// { id, title, ref, type, text, order, series } on trinityone/devotional:<id>, so this maps one week to one
// devotional and uses `series` to hold them together as a plan — which is what makes them group in the
// Library rather than arriving as eight loose posts.
//
// One week per devotional, NOT one day. The author wrote it as "8 weekly long-form posts (7 days each)" and
// the days are headings inside a week's body; splitting them into 56 documents would be re-editing someone
// else's work, not importing it.
import { readFileSync, existsSync } from 'node:fs';
import { WebSocket } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';

const [, , FILE, RELAY_ARG] = process.argv;
if (!FILE || !existsSync(FILE)) { console.error('usage: node scripts/seed-devotional.mjs <plan.md> [relay-url]'); process.exit(2); }
const RELAY = RELAY_ARG || 'ws://127.0.0.1:8000/relay';
const NET = 'trinityone';
const CH = new URL('./.seed-church.json', import.meta.url);
if (!existsSync(CH)) { console.error('run seed-church.mjs first'); process.exit(2); }
const church = JSON.parse(readFileSync(CH, 'utf8'));
const CSK = Uint8Array.from(Buffer.from(church.sk, 'hex'));
const now = () => Math.floor(Date.now() / 1000);

const src = readFileSync(FILE, 'utf8');

// ── parse the weeks ───────────────────────────────────────────────────────────────────────────────────────
const blocks = [];
const re = /═+\s*WEEK\s+(\d+)\s*—\s*COPY FROM HERE\s*═+([\s\S]*?)═+\s*WEEK\s+\1\s*—\s*COPY TO HERE\s*═+/g;
let m;
while ((m = re.exec(src)) !== null) blocks.push({ week: Number(m[1]), raw: m[2] });
if (!blocks.length) { console.error('no WEEK blocks found — is this the right file?'); process.exit(1); }

const devos = blocks.map(({ week, raw }) => {
  const title = (raw.match(/^\s*Title:\s*(.+)$/m) || [])[1] || `Week ${week}`;
  const summary = (raw.match(/^\s*Summary:\s*(.+)$/m) || [])[1] || '';
  // body = everything after the Tags: line, minus the duplicated H1 the editor wants at the top of the post
  let body = raw.split(/^\s*Tags:.*$/m).slice(1).join('').trim();
  body = body.replace(/^#\s+.*\n+/, '').trim();
  // a scripture range for the card, derived from the refs the week actually cites
  const chapters = [...body.matchAll(/Revelation\s+(\d+)/g)].map(x => Number(x[1]));
  const ref = chapters.length
    ? (Math.min(...chapters) === Math.max(...chapters)
        ? `Revelation ${chapters[0]}`
        : `Revelation ${Math.min(...chapters)}–${Math.max(...chapters)}`)
    : 'Revelation';
  return {
    id: 'unveiling-w' + String(week).padStart(2, '0'),
    title: title.trim(),
    ref,
    type: 'txt',
    // the summary leads the body so the card and the page agree about what this week is
    text: (summary ? summary.trim() + '\n\n' : '') + body,
    order: week,
    series: 'The Unveiling — a journey through Revelation',
  };
});

// ── publish ───────────────────────────────────────────────────────────────────────────────────────────────
const w = await new Promise((res, rej) => { const s = new WebSocket(RELAY); s.on('open', () => res(s)); s.on('error', rej); });
const publish = (e) => new Promise((res) => {
  const on = (d) => {
    const msg = JSON.parse(d);
    if (msg[0] === 'AUTH') {
      w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', RELAY], ['challenge', msg[1]]], content: '' }, CSK)]));
      w.send(JSON.stringify(['EVENT', e]));
      return;
    }
    if (msg[0] === 'OK' && msg[1] === e.id) { w.off('message', on); res([msg[2], msg[3] || '']); }
  };
  w.on('message', on);
  w.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => { w.off('message', on); res([false, 'timed out']); }, 15000);
});

let ok = 0; const bad = [];
for (const d of devos) {
  const evt = finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', NET + '/devotional:' + d.id], ['t', NET]], content: JSON.stringify(d) }, CSK);
  const [good, why] = await publish(evt);
  if (good) ok++; else bad.push(`${d.id}: ${why}`);
  process.stdout.write(good ? '.' : 'x');
}
w.close();

console.log('\n');
console.log(`series    : ${devos[0].series}`);
console.log(`published : ${ok}/${devos.length}`);
devos.forEach(d => console.log(`  ${String(d.order).padStart(2)} ${d.ref.padEnd(18)} ${d.title.slice(0, 58)}  (${d.text.length} chars)`));
if (bad.length) { console.log('\nrefused:'); bad.forEach(b => console.log('  ' + b)); }
