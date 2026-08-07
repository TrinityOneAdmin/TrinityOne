// Upload a term's worth of sermons to the throwaway church, so the Watch screen shows a real sermon list.
//
//   node scripts/seed-sermons.mjs [relay-url] [--host https://public.host]
//
// A sermon is NOT just a document: `_openSermons` drops any doc without a `sha256`, and the row renders a size
// read straight off the doc. So each one here is a genuine upload — an MP3 built at the length the title
// claims, PUT to /blob, and only then described by a `trinityone/sermon:<id>` document pointing at the hash
// the relay returned. Nothing is asserted about a blob that isn't there.
//
// The audio is silence. That is the one thing about this church that is not real, and it is deliberate: these
// are screenshots of the shelf, not of the sound. The lengths and byte sizes ARE real, because those are what
// the screen actually shows.
//
// Upload auth is a kind-24242 signed by the church key (gateway `_blobUploader`): t=upload, an expiration, and
// an `x` tag naming the hash we expect — the relay rejects the body if it hashes to anything else.
import { existsSync, readFileSync, statSync, createReadStream, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';

const argv = process.argv.slice(2);
const RELAY = argv.find(a => a.startsWith('ws')) || 'ws://127.0.0.1:8000/relay';
const HOST_ARG = (argv.find(a => a.startsWith('--host=')) || '').slice(7);
// Where a PHONE will fetch the blob from. The relay is uploaded to over localhost, but the member downloading
// it is on a handset — so the host recorded in the document has to be the address that handset can reach.
const PUB_HOST = HOST_ARG || 'https://trinityone.tailbeaac0.ts.net';
const UP_HOST = 'http://127.0.0.1:8000';

const NET = 'trinityone';
const CH = new URL('./.seed-church.json', import.meta.url);
if (!existsSync(CH)) { console.error('run seed-church.mjs first'); process.exit(2); }
const church = JSON.parse(readFileSync(CH, 'utf8'));
const CSK = Uint8Array.from(Buffer.from(church.sk, 'hex'));
const now = () => Math.floor(Date.now() / 1000);

// ── the series ────────────────────────────────────────────────────────────────────────────────────────────
// The same Revelation series the church is reading in its devotional plan, preached on the Sundays behind us.
// A church whose sermons and reading plan are about different books looks like two seeded datasets, not one
// congregation.
const SUNDAY = (weeksAgo) => {
  const d = new Date();
  d.setUTCHours(10, 30, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 7) % 7) - weeksAgo * 7);
  return Math.floor(d.getTime() / 1000);
};
const SERMONS = [
  { id: 'unveiling-01', title: 'Behold, He Is Coming', ref: 'Revelation 1',    who: 'Rev. Daniel Okonkwo',  mins: 36, ago: 4 },
  { id: 'unveiling-02', title: 'Letters to Seven Churches', ref: 'Revelation 2–3', who: 'Rev. Daniel Okonkwo', mins: 41, ago: 3 },
  { id: 'unveiling-03', title: 'The Throne and the Sea of Glass', ref: 'Revelation 4', who: 'Margaret Whitfield', mins: 29, ago: 2 },
  { id: 'unveiling-04', title: 'Worthy Is the Lamb', ref: 'Revelation 5',      who: 'Rev. Daniel Okonkwo',  mins: 38, ago: 1 },
  { id: 'unveiling-05', title: 'A Great Multitude That No One Could Count', ref: 'Revelation 7', who: 'Rev. Daniel Okonkwo', mins: 34, ago: 0 },
];
const SERIES = 'The Unveiling — a journey through Revelation';

// ── build the audio ───────────────────────────────────────────────────────────────────────────────────────
// 32 kbps mono is what a sermon actually ships at on a thin pipe, and it makes the on-screen megabytes match
// the on-screen minutes. CBR, so the size is a function of the length rather than of the (silent) content.
const DIR = join(tmpdir(), 'trinityone-sermons');
mkdirSync(DIR, { recursive: true });
const sha256File = (p) => new Promise((res, rej) => {
  const h = createHash('sha256');
  createReadStream(p).on('data', c => h.update(c)).on('end', () => res(h.digest('hex'))).on('error', rej);
});

for (const s of SERMONS) {
  s.file = join(DIR, s.id + '.mp3');
  if (!existsSync(s.file)) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(s.mins * 60),
      '-c:a', 'libmp3lame', '-b:a', '32k', '-ac', '1',
      '-metadata', 'title=' + s.title, '-metadata', 'artist=' + s.who, '-metadata', 'album=' + SERIES,
      s.file]);
  }
  s.size = statSync(s.file).size;
  s.sha256 = await sha256File(s.file);
  process.stdout.write('#');
}
console.log('  built ' + SERMONS.length + ' files');

// ── upload ────────────────────────────────────────────────────────────────────────────────────────────────
const uploadAuth = (sha) => Buffer.from(JSON.stringify(finalizeEvent({
  kind: 24242, created_at: now(), content: 'Upload sermon',
  tags: [['t', 'upload'], ['x', sha], ['expiration', String(now() + 600)], ['church', church.pub]],
}, CSK))).toString('base64');

for (const s of SERMONS) {
  const body = readFileSync(s.file);
  const r = await fetch(UP_HOST + '/blob', {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/mpeg', 'Authorization': 'Nostr ' + uploadAuth(s.sha256) },
    body,
  });
  const j = await r.json().catch(() => ({}));
  s.uploaded = r.ok && j.sha256 === s.sha256;
  s.why = s.uploaded ? '' : (j.error || ('HTTP ' + r.status));
  process.stdout.write(s.uploaded ? '.' : 'x');
}
console.log('  uploaded');

// ── publish the documents ─────────────────────────────────────────────────────────────────────────────────
const w = await new Promise((res, rej) => { const s = new WebSocket(RELAY); s.on('open', () => res(s)); s.on('error', rej); });
const publish = (e) => new Promise((res) => {
  const on = (d) => {
    const m = JSON.parse(d);
    if (m[0] === 'AUTH') {
      w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', RELAY], ['challenge', m[1]]], content: '' }, CSK)]));
      w.send(JSON.stringify(['EVENT', e]));
      return;
    }
    if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res([m[2], m[3] || '']); }
  };
  w.on('message', on);
  w.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => { w.off('message', on); res([false, 'timed out']); }, 15000);
});
const doc = (d, content) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET]], content: JSON.stringify(content) }, CSK);

const results = [];
for (const s of SERMONS) {
  if (!s.uploaded) { results.push([s.id, false, 'blob upload failed: ' + s.why]); process.stdout.write('x'); continue; }
  const [ok, why] = await publish(doc(NET + '/sermon:' + s.id, {
    id: s.id,
    title: s.title,
    desc: s.ref + ' · ' + s.who,
    sha256: s.sha256,
    hosts: [PUB_HOST],
    mime: 'audio/mpeg',
    size: s.size,
    ts: SUNDAY(s.ago),
    series: SERIES,
  }));
  results.push([s.id, ok, why]);
  process.stdout.write(ok ? '.' : 'x');
}

// Feature the most recent one — that is what puts a sermon on the member's Today card.
const newest = SERMONS.filter(s => s.uploaded).sort((a, b) => a.ago - b.ago)[0];
if (newest) {
  const [ok, why] = await publish(finalizeEvent({
    kind: 30078, created_at: now(), tags: [['d', NET + '/pinsermon:' + church.pub], ['t', NET]],
    content: JSON.stringify({ id: newest.id, title: newest.title, sha256: newest.sha256, hosts: [PUB_HOST], mime: 'audio/mpeg', ts: now() }),
  }, CSK));
  results.push(['pinned:' + newest.id, ok, why]);
}
w.close();

const bad = results.filter(r => !r[1]);
console.log('\n');
console.log(`series    : ${SERIES}`);
console.log(`published : ${results.length - bad.length}/${results.length}`);
SERMONS.forEach(s => console.log(
  `  ${new Date(SUNDAY(s.ago) * 1000).toISOString().slice(0, 10)}  ${String(s.mins).padStart(2)} min  ${(s.size / 1048576).toFixed(1).padStart(5)} MB  ${s.title}`));
console.log(`hosts     : ${PUB_HOST}`);
if (bad.length) { console.log('\nrefused:'); bad.forEach(([l, , why]) => console.log('  ' + l + ' — ' + why)); }
