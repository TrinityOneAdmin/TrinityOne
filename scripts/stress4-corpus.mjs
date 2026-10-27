// Builds (and caches on disk) a signed six-month church corpus for the stress4 size tests: ~300 members, 50 groups,
// 30k group messages, 5k DMs, 400 care requests, all signed for real so a syncing box's verifyEvent accepts them.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

export const SPEC = { members: 300, groups: 50, msgs: 30000, dms: 5000, care: 400 };
const FILE = join(tmpdir(), `stress4-corpus-${SPEC.members}-${SPEC.msgs}-${SPEC.dms}.json`);
const hex = (u) => Buffer.from(u).toString('hex');

// church secret + member secrets are stored in the cache so a later run signs nothing new
export function loadOrBuild(now = Math.floor(Date.now() / 1000)) {
  if (existsSync(FILE)) { const c = JSON.parse(readFileSync(FILE, 'utf8')); if (c.builtAt > now - 10 * 86400) return c; }
  const t0 = Date.now();
  const csk = generateSecretKey(), church = { sk: hex(csk), pub: getPublicKey(csk) };
  const members = Array.from({ length: SPEC.members }, () => { const sk = generateSecretKey(); return { sk: hex(sk), pub: getPublicKey(sk) }; });
  const skOf = (m) => Uint8Array.from(Buffer.from(m.sk, 'hex'));
  const six = 180 * 86400, t = (i, n) => now - 3600 - Math.floor((i / n) * six);   // oldest first when i is large
  const events = [];
  let rng = 12345; const rnd = (n) => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };
  members.forEach((m, i) => events.push(finalizeEvent({ kind: 30078, created_at: now - six + i * 3600, tags: [['d', 'trinityone/member:' + church.pub], ['t', 'trinityone'], ['p', church.pub]], content: JSON.stringify({ joined: now - six + i * 3600, seen: now - 7200, hb: 1 }) }, skOf(m))));
  const gids = Array.from({ length: SPEC.groups }, (_, i) => 'grp' + i);
  gids.forEach((g, i) => events.push(finalizeEvent({ kind: 30078, created_at: now - six + i, tags: [['d', 'trinityone/group:' + g], ['t', 'trinityone']], content: JSON.stringify({ name: 'Group ' + i }) }, Uint8Array.from(Buffer.from(church.sk, 'hex')))));
  for (let i = 0; i < SPEC.msgs; i++) {
    const m = members[rnd(members.length)], g = gids[rnd(gids.length)];
    events.push(finalizeEvent({ kind: 1, created_at: t(i, SPEC.msgs), tags: [['t', 'trinityone'], ['t', g]], content: 'message ' + i + ' ' + 'lorem ipsum dolor sit amet '.repeat(3) }, skOf(m)));
  }
  for (let i = 0; i < SPEC.dms; i++) {
    const a = members[rnd(members.length)], b = members[rnd(members.length)];
    events.push(finalizeEvent({ kind: 4, created_at: t(i, SPEC.dms), tags: [['p', b.pub]], content: 'sealed?iv=AAAAAAAAAAAAAAAA' + 'x'.repeat(120) + i }, skOf(a)));
  }
  for (let i = 0; i < SPEC.care; i++) {
    const m = members[rnd(members.length)];
    events.push(finalizeEvent({ kind: 30078, created_at: t(i, SPEC.care), tags: [['d', 'trinityone/carereq:' + m.pub.slice(0, 16) + '-' + i], ['t', 'trinityone'], ['church', church.pub]], content: 'sealed?iv=BBBB' + 'y'.repeat(200) }, skOf(m)));
  }
  const c = { builtAt: now, church, members, events, buildMs: Date.now() - t0 };
  writeFileSync(FILE, JSON.stringify(c));
  return c;
}
