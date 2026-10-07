// A CHURCH'S PUBLIC SERMON FEED IS SERVED ONLY WHEN THE CHURCH ASKED, AND THE MEDIA ONLY FOR SHARED SERMONS.
//   Run: node --test scripts/a-churchs-public-sermons-are-served-only-when-asked.test.mjs
//
// reference/DESIGN-embeddable-church-info.md, phase 2. A church wants its sermons on a podcast feed its website
// or a podcast app can subscribe to. The relay answers `GET /public/<npub>/sermons.xml` with an RSS 2.0 file
// and `GET /public/<npub>/media/<sha256>` with the audio blob — with no authentication. So the whole of this
// file is about the NO: nothing is served unless the church's `share:` document says sermons:true, no other
// document type is reachable, the media route only serves blobs referenced by a sermon, and the WebSocket read
// gate is untouched.
//
// A real scripts/gateway.mjs on its own port and data directory, real WebSockets, real HTTP fetches, a real
// blob on disk. No mirror of any rule.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 8856;
const HTTP = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const MEMBER_D = D.MEMBER, SERMON_D = D.SERMON, SHARE_D = D.SHARE;
const now = () => Math.floor(Date.now() / 1000);
let _tick = now();
const next = () => (_tick = Math.max(_tick + 1, now()));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const grace = K();
const stmarks = K();
const ann = K();
const ap = grace.pub, bp = stmarks.pub;
const NPUB = npubEncode(ap), NPUB_B = npubEncode(bp), NPUB_UNKNOWN = npubEncode(K().pub);

// A fake audio blob: 1KB of zeros, sha256'd.
const AUDIO_BYTES = Buffer.alloc(1024);
const AUDIO_SHA = createHash('sha256').update(AUDIO_BYTES).digest('hex');
// A second blob that is NOT referenced by any sermon — must never be served publicly.
const SECRET_BYTES = Buffer.from('secret-church-data');
const SECRET_SHA = createHash('sha256').update(SECRET_BYTES).digest('hex');

const SERMON_A = { id: 'ser-john3', title: 'The God Who Gives', who: 'Rev. Thomas', ref: 'John 3:16', mins: 28, sha256: AUDIO_SHA, mime: 'audio/mpeg', ts: now() - 86400 };
const SERMON_B = { id: 'ser-rom8', title: 'Nothing Can Separate Us', who: 'Rev. Thomas', ref: 'Romans 8:38-39', mins: 35, sha256: AUDIO_SHA, mime: 'audio/mpeg', ts: now() - 172800 };

let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${HTTP}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
function startRelay() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: NPUB + ',' + NPUB_B, RELAY_MAX_EVENTS: '5000', TRINITY_TAILSCALE_BIN: '/nonexistent' },
      stdio: 'ignore' });
  return waitReady();
}
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, tags = [], at = 0) => finalizeEvent({ kind: 30078, created_at: at || next(), tags: [['d', d], ['t', NET], ...tags], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const tomb = (who, d) => finalizeEvent({ kind: 30078, created_at: next(), tags: [['d', d], ['t', NET], ['deleted', '1']], content: '' }, who.sk);
const shareDoc = (who, cp, body) => doc(who, SHARE_D + cp, body);
const sermonDoc = (who, s, tags = []) => doc(who, SERMON_D + s.id, s, tags);

const get = (path) => fetch(HTTP + path, { redirect: 'manual' });

function parseRss(text) {
  assert.ok(text.includes('<rss'), 'not an RSS document');
  assert.ok(text.includes('</rss>'), 'the RSS document is not closed');
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(text)) !== null) {
    const body = m[1];
    const unxml = (s) => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
    const tag = (name) => { const r = new RegExp(`<${name}[^>]*>([^<]*)</${name}>`); const mm = r.exec(body); return mm ? unxml(mm[1]) : ''; };
    const encRe = /<enclosure\s+([^>]+)\/?>/;
    const enc = encRe.exec(body);
    items.push({
      title: tag('title'),
      guid: tag('guid'),
      pubDate: tag('pubDate'),
      description: tag('description'),
      enclosure: enc ? { url: (enc[1].match(/url="([^"]*)"/) || [])[1] || '', type: (enc[1].match(/type="([^"]*)"/) || [])[1] || '' } : null,
      duration: tag('itunes:duration'),
      author: tag('itunes:author'),
    });
  }
  const channelTitle = (text.match(/<channel>[\s\S]*?<title>([^<]*)<\/title>/) || [])[1] || '';
  return { title: channelTitle, items };
}

before(async () => {
  await requireFreePort(PORT, 'a-churchs-public-sermons-are-served-only-when-asked.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-pubser-'));
  // Plant the fake audio blob and a non-sermon blob in the blob store.
  const blobDir = join(dataDir, 'blobs');
  mkdirSync(blobDir, { recursive: true });
  writeFileSync(join(blobDir, AUDIO_SHA), AUDIO_BYTES);
  writeFileSync(join(blobDir, AUDIO_SHA + '.type'), 'audio/mpeg');
  writeFileSync(join(blobDir, AUDIO_SHA + '.church'), ap);
  writeFileSync(join(blobDir, SECRET_SHA), SECRET_BYTES);
  writeFileSync(join(blobDir, SECRET_SHA + '.type'), 'application/octet-stream');
  writeFileSync(join(blobDir, SECRET_SHA + '.church'), ap);
  await startRelay();
  pub = await connect();
  assert.equal((await publish(pub, doc(ann, MEMBER_D + ap, { joined: now() })))[0], true, 'Ann joins Grace');
  assert.equal((await publish(pub, finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: 'Grace Church, Milltown' }) }, grace.sk)))[0], true, 'church profile');
  // Publish two sermons as the church key.
  assert.equal((await publish(pub, sermonDoc(grace, SERMON_A)))[0], true, 'sermon A');
  assert.equal((await publish(pub, sermonDoc(grace, SERMON_B)))[0], true, 'sermon B');
  await sleep(300);
});
after(async () => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: with no share: document the sermon feed is a 404, and so is the media route', async () => {
  assert.equal((await get(`/public/${NPUB}/sermons.xml`)).status, 404, 'sermon feed served without a share: document');
  assert.equal((await get(`/public/${NPUB}/media/${AUDIO_SHA}`)).status, 404, 'media served without a share: document');
  assert.equal((await get(`/public/${NPUB_UNKNOWN}/sermons.xml`)).status, 404, 'sermon feed for unknown church');
});

test('switching calendar on but NOT sermons — the sermon feed and media are still 404', async () => {
  assert.equal((await publish(pub, shareDoc(grace, ap, { calendar: true, sermons: false, plans: false })))[0], true, 'share doc with calendar only');
  await sleep(200);
  assert.equal((await get(`/public/${NPUB}/sermons.xml`)).status, 404, 'sermon feed served when only calendar is on');
  assert.equal((await get(`/public/${NPUB}/media/${AUDIO_SHA}`)).status, 404, 'media served when only calendar is on');
});

test('switching sermons on — the RSS feed appears with both sermons', async () => {
  assert.equal((await publish(pub, shareDoc(grace, ap, { calendar: true, sermons: true, plans: false })))[0], true, 'sermons on');
  await sleep(200);
  const r = await get(`/public/${NPUB}/sermons.xml`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/rss+xml; charset=utf-8');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
  assert.match(r.headers.get('content-security-policy') || '', /default-src 'none'/);
  assert.equal(r.headers.get('set-cookie'), null, 'a cookie was set on a public feed');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const text = await r.text();
  const rss = parseRss(text);
  assert.equal(rss.title, 'Grace Church, Milltown');
  assert.equal(rss.items.length, 2, 'expected 2 sermons in the feed');
  const a = rss.items.find(i => i.title === 'The God Who Gives');
  const b = rss.items.find(i => i.title === 'Nothing Can Separate Us');
  assert.ok(a, 'sermon A not in the feed');
  assert.ok(b, 'sermon B not in the feed');
  assert.ok(a.enclosure, 'sermon A has no enclosure');
  assert.ok(a.enclosure.url.includes('/public/' + NPUB + '/media/' + AUDIO_SHA), 'enclosure URL does not point to the public media route');
  assert.equal(a.enclosure.type, 'audio/mpeg');
  assert.equal(a.author, 'Rev. Thomas');
  assert.ok(a.description.includes('John 3:16'), 'scripture ref not in description');
  assert.ok(a.duration, 'no duration on the sermon');
  // The feed must not name the relay or carry any member key.
  assert.equal(text.includes(ann.pub), false, 'a member key is in the sermon feed');
  assert.equal(text.includes(ap), false, 'the church hex key is in the sermon feed');
});

test('the public media route serves the audio when sermons are shared', async () => {
  const r = await get(`/public/${NPUB}/media/${AUDIO_SHA}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/mpeg');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('accept-ranges'), 'bytes');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.length, AUDIO_BYTES.length, 'blob size mismatch');
  assert.deepEqual(buf, AUDIO_BYTES);
});

test('the public media route does NOT serve a blob that is not referenced by a sermon', async () => {
  const r = await get(`/public/${NPUB}/media/${SECRET_SHA}`);
  assert.equal(r.status, 404, 'A NON-SERMON BLOB WAS SERVED PUBLICLY — only sermon media may be public');
});

test('range requests work on public media', async () => {
  const r = await fetch(`${HTTP}/public/${NPUB}/media/${AUDIO_SHA}`, { headers: { 'Range': 'bytes=0-9' } });
  assert.equal(r.status, 206);
  assert.match(r.headers.get('content-range') || '', /^bytes 0-9\/1024$/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.length, 10);
});

test('HEAD on the sermon feed and media works', async () => {
  const feedHead = await fetch(`${HTTP}/public/${NPUB}/sermons.xml`, { method: 'HEAD' });
  assert.equal(feedHead.status, 200);
  assert.equal(feedHead.headers.get('content-type'), 'application/rss+xml; charset=utf-8');
  const mediaHead = await fetch(`${HTTP}/public/${NPUB}/media/${AUDIO_SHA}`, { method: 'HEAD' });
  assert.equal(mediaHead.status, 200);
  assert.equal(mediaHead.headers.get('content-type'), 'audio/mpeg');
});

test('POST to the sermon feed is refused', async () => {
  const r = await fetch(`${HTTP}/public/${NPUB}/sermons.xml`, { method: 'POST', body: 'x' });
  assert.equal(r.status, 405);
});

test('tombstoning a sermon removes it from the feed', async () => {
  assert.equal((await publish(pub, tomb(grace, SERMON_D + SERMON_A.id)))[0], true, 'tombstone sermon A');
  await sleep(200);
  const rss = parseRss(await (await get(`/public/${NPUB}/sermons.xml`)).text());
  assert.equal(rss.items.length, 1, 'tombstoned sermon is still in the feed');
  assert.equal(rss.items[0].title, 'Nothing Can Separate Us');
});

test('switching sermons off is a 404 everywhere, at once', async () => {
  assert.equal((await publish(pub, shareDoc(grace, ap, { calendar: true, sermons: false, plans: false })))[0], true, 'sermons off');
  await sleep(200);
  assert.equal((await get(`/public/${NPUB}/sermons.xml`)).status, 404, 'sermon feed still served after switch off');
  assert.equal((await get(`/public/${NPUB}/media/${AUDIO_SHA}`)).status, 404, 'media still served after sermons switch off');
});

test('the switches survive a restart', async () => {
  assert.equal((await publish(pub, shareDoc(grace, ap, { calendar: true, sermons: true, plans: false })))[0], true, 'sermons back on');
  await sleep(200);
  assert.equal((await get(`/public/${NPUB}/sermons.xml`)).status, 200, 're-anchor');
  try { pub.close(); } catch {}
  relay.kill('SIGKILL'); await sleep(400);
  await startRelay();
  pub = await connect();
  const r = await get(`/public/${NPUB}/sermons.xml`);
  assert.equal(r.status, 200, 'after a restart the sermon feed is gone — PUBSERMONS not rebuilt from store');
  const rss = parseRss(await r.text());
  assert.equal(rss.items.length, 1, 'the sermon count changed after restart');
  assert.equal((await get(`/public/${NPUB}/media/${AUDIO_SHA}`)).status, 200, 'media route broken after restart');
});

test('a co-tenant church\'s sermons never appear on Grace\'s feed', async () => {
  const sB = { id: 'ser-stmarks', title: 'St Mark\'s sermon', who: 'Vicar', ref: 'Luke 1', mins: 20, sha256: AUDIO_SHA, mime: 'audio/mpeg', ts: now() };
  assert.equal((await publish(pub, sermonDoc(stmarks, sB)))[0], true, 'St Mark\'s sermon');
  assert.equal((await publish(pub, shareDoc(stmarks, bp, { sermons: true })))[0], true, 'St Mark\'s share');
  await sleep(200);
  const graceRss = parseRss(await (await get(`/public/${NPUB}/sermons.xml`)).text());
  assert.equal(graceRss.items.some(i => i.title === 'St Mark\'s sermon'), false, 'co-tenant sermon leaked into Grace\'s feed');
  const stmarksRss = parseRss(await (await get(`/public/${NPUB_B}/sermons.xml`)).text());
  assert.ok(stmarksRss.items.some(i => i.title === 'St Mark\'s sermon'), 'St Mark\'s own feed missing its sermon');
  assert.equal(stmarksRss.items.some(i => i.title.includes('Separate')), false, 'Grace\'s sermon leaked into St Mark\'s feed');
});

test('deleting the share: document takes the sermon feed down', async () => {
  assert.equal((await publish(pub, tomb(grace, SHARE_D + ap)))[0], true, 'delete share doc');
  await sleep(200);
  assert.equal((await get(`/public/${NPUB}/sermons.xml`)).status, 404, 'sermon feed still up after share: doc deleted');
  assert.equal((await get(`/public/${NPUB}/media/${AUDIO_SHA}`)).status, 404, 'media still up after share: doc deleted');
});
