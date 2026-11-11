// RIG for the "console reads ask only for their own church" tests. Not a test: imported by them.
//
// A real gateway on a free port + the real console in headless chromium with church A made the real way
// (scripts/new-church-session.mjs), plus a SECOND church B registered on the same relay with a pile of
// unrelated documents. A test then calls a real bundled `window.Steward.subscribeX(...)` in the page as A and
// reads, off the CDP socket frames, (a) the REQ the bundle really sent and (b) how many EVENT frames the relay
// really answered with on that subscription. Nothing is mocked: the bundle is vendor/steward.js, served by the
// gateway, and the frames are the ones that crossed the wire.
import { nip19 } from 'nostr-tools';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { openNewChurch, CHROME, sleep } from './new-church-session.mjs';
export { CHROME, sleep };
import * as H from './relay-network-harness.mjs';
export { H };

export const NET = 'trinityone';
const at = () => Math.floor(Date.now() / 1000);
export const doc = (who, d, content, extraTags = [], ts) =>
  finalizeEvent({ kind: 30078, created_at: ts || at(), tags: [['d', d], ['t', NET], ...extraTags], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);

// A: the console's own church. B: another church on the SAME relay.
export async function openRig(name) {
  const A = await openNewChurch({ name, wizard: 'skip', logger: false });
  const sk = privateKeyFromSeedWords(A.mnemonic);
  if (getPublicKey(sk) !== A.churchPub) throw new Error('recovery words do not give church A');
  A.church = { sk, pub: A.churchPub };
  A.other = H.key();
  const r = await fetch(A.relay.base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + A.relay.adminToken },
    body: JSON.stringify({ addChurch: { npub: nip19.npubEncode(A.other.pub), name: 'Church B' } }) });
  if (!r.ok) throw new Error('could not register church B on the relay: HTTP ' + r.status);
  A.put = (events) => H.publishAll(A.relay, events);
  return A;
}

// ~n documents of church B that are NOT any of A's — what an unfiltered '#t' read drags in. Several d-families so the
// pile looks like a real church, not one repeated doc.
export function otherChurchPile(A, n = 50) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const fam = ['trinityone/event:', 'trinityone/post:', 'trinityone/note:'][i % 3];
    out.push(doc(A.other, fam + 'b' + i, { n: i, text: 'church B filler ' + i }, [['church', A.other.pub]]));
  }
  return out;
}

// What the wire did while `run` ran: { reqs: [{sid, filters}], events: {sid: [{k, d}]} } for frames after `since`.
function parseFrames(frames, since) {
  const reqs = [], events = {};
  for (const fr of frames) {
    if (fr.t < since) continue;
    if (fr.dir === '>' && fr.f.startsWith('REQ ')) {
      const m = /^REQ (\S+) ([\s\S]*)$/.exec(fr.f);
      let filters = []; try { filters = JSON.parse(m[2]).flat(); } catch {}
      reqs.push({ sid: m[1], filters });
    } else if (fr.dir === '<') {
      const m = /^EVENT<(\S+)> k(\d+) d=(.*)$/.exec(fr.f);
      if (m) (events[m[1]] ||= []).push({ k: +m[2], d: m[3] });
    }
  }
  return { reqs, events };
}

// Let the console go quiet, then run `startExpr` (in the page; must return a stop function or nothing), wait for the
// subscription to settle, and report the one REQ it sent. `since` is measured on the same clock the frames use.
export async function probe(A, startExpr, { settleMs = 4000 } = {}) {
  let n = -1, stable = 0;
  for (let i = 0; i < 40 && stable < 3; i++) { await sleep(800); if (A.frames.length === n) stable++; else { stable = 0; n = A.frames.length; } }
  const since = Date.now() - A.t0;
  await A.ev(`(() => { window.__probe = { stop: null, out: [] }; window.__probe.stop = (${startExpr}); return 1; })()`);
  await sleep(settleMs);
  const seen = parseFrames(A.frames, since);
  const out = await A.ev(`JSON.stringify(window.__probe.out)`);
  await A.ev(`(() => { try { typeof window.__probe.stop === 'function' && window.__probe.stop(); } catch (e) {} return 1; })()`);
  if (seen.reqs.length !== 1) throw new Error('expected exactly ONE REQ from the probed subscription, saw ' + seen.reqs.length + ': ' + JSON.stringify(seen.reqs));
  const req = seen.reqs[0];
  return { req, filters: req.filters, events: seen.events[req.sid] || [], out: JSON.parse(out || '[]') };
}
