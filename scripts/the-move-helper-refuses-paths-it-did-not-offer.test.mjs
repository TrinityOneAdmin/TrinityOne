// THE ROOT MOVE HELPER ONLY ACCEPTS A DRIVE ITS OWN LIST OFFERS. Run: node --test scripts/the-move-helper-refuses-paths-it-did-not-offer.test.mjs
// Relay storage plan step 6 (plan section 6 test "the-move-helper-refuses-paths-it-did-not-offer"): runs the REAL
// validateMoveRequest from relay-move-server.mjs, and the real `take-request` CLI, on fixtures. The request is hostile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMoveRequest, fstabMountpoints } from './relay-move-server.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const uid = process.getuid();
function rig() {
  const base = mkdtempSync(join(tmpdir(), 'trin-validate-')); chmodSync(base, 0o755);
  const drive = join(base, 'usb'); mkdirSync(drive); chmodSync(drive, 0o755);
  const mi = (mp, fs = 'ext4') => `361 29 8:33 / ${mp} rw - ${fs} /dev/sdz1 rw\n`;
  const ok = { request: { drive }, fstabText: `/dev/sdz1 ${drive} ext4 defaults 0 2\n`, mountinfoText: mi(drive), dataDir: join(base, 'data'), codeDir: ROOT, rootUid: uid, checkFrom: base };
  return { base, drive, ok, mi, done: () => rmSync(base, { recursive: true, force: true }) };
}
const code = r => (r.ok ? 'ACCEPTED' : r.code);

test('a drive that is in fstab, mounted, ext4, root-owned and empty is accepted, and the target is the fixed leaf', () => {
  const t = rig(); try { const r = validateMoveRequest(t.ok); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.target, join(t.drive, 'trinityone-relay')); } finally { t.done(); }
});
test('paths and mounts the helper did not offer are refused', () => {
  const t = rig();
  try {
    const bad = (req, extra, want) => assert.equal(code(validateMoveRequest({ ...t.ok, ...extra, request: req })), want, JSON.stringify(req));
    bad({ drive: t.drive + '/../usb' }, {}, 'drive-not-offered');                       // ..
    bad({ drive: 'usb' }, {}, 'drive-not-offered');                                      // relative
    bad({ drive: t.drive + '/' }, {}, 'drive-not-offered');
    bad({ drive: '/' }, {}, 'drive-not-offered');
    bad({}, {}, 'drive-not-offered');
    bad({ drive: '/etc' }, {}, 'not-in-fstab');                                          // a system folder
    bad({ drive: t.drive }, { fstabText: '# none\n' }, 'not-in-fstab');                  // mounted by hand, not fstab
    bad({ drive: t.drive }, { mountinfoText: '' }, 'not-mounted');
    for (const fs of ['nfs4', 'cifs', 'exfat', 'vfat', 'ntfs3']) bad({ drive: t.drive }, { mountinfoText: t.mi(t.drive, fs) }, 'filesystem-not-supported');
    bad({ drive: t.drive }, { dataDir: join(t.drive, 'trinityone-relay') }, 'target-overlaps-source');
    bad({ drive: t.drive }, { codeDir: t.base }, 'target-ineligible');                   // under the app
    bad({ drive: t.drive + ' x' }, {}, 'path-unsupported');
    // a mountpoint under /home or /etc is refused by the mover's own rules even if fstab lists it
    bad({ drive: '/home/x' }, { fstabText: '/dev/a /home/x ext4 d 0 0\n', mountinfoText: t.mi('/home/x') }, 'target-ineligible');
    bad({ drive: '/etc/mnt' }, { fstabText: '/dev/a /etc/mnt ext4 d 0 0\n', mountinfoText: t.mi('/etc/mnt') }, 'target-ineligible');
  } finally { t.done(); }
});
test('a symlinked component, a group-writable parent, a foreign owner, and a non-empty target are refused', () => {
  const t = rig();
  try {
    const link = join(t.base, 'link'); symlinkSync(t.drive, link);
    const fs = `/dev/sdz1 ${link} ext4 d 0 0\n`;
    assert.equal(code(validateMoveRequest({ ...t.ok, request: { drive: link }, fstabText: fs, mountinfoText: t.mi(link) })), 'path-has-symlink');
    chmodSync(t.drive, 0o775);
    assert.equal(code(validateMoveRequest(t.ok)), 'path-not-root-owned');                // writable by the service user's group
    chmodSync(t.drive, 0o755);
    assert.equal(code(validateMoveRequest({ ...t.ok, rootUid: uid + 1 })), 'path-not-root-owned');   // not owned by root
    mkdirSync(join(t.drive, 'trinityone-relay')); writeFileSync(join(t.drive, 'trinityone-relay', 'x'), '1');
    assert.equal(code(validateMoveRequest(t.ok)), 'target-not-empty');
    rmSync(join(t.drive, 'trinityone-relay'), { recursive: true }); symlinkSync('/etc', join(t.drive, 'trinityone-relay'));
    assert.equal(code(validateMoveRequest(t.ok)), 'target-not-empty');
  } finally { t.done(); }
});
test('fstab parsing: swap, root and comments are not drives', () => {
  assert.deepEqual(fstabMountpoints('UUID=1 / ext4 d 0 1\n/dev/s none swap sw 0 0\n# /x\n/dev/b /mnt/a\\040b ext4 d 0 2\n'), ['/mnt/a b']);
});
test('take-request refuses a request that is a symlink, consumes it either way, and never reads past a size cap', () => {
  const t = rig();
  try {
    const out = join(t.base, 'out.json'), run = f => spawnSync(process.execPath, [join(ROOT, 'scripts/relay-move-server.mjs'), 'take-request', '--file', f, '--out', out], { encoding: 'utf8' });
    const secret = join(t.base, 'secret.json'); writeFileSync(secret, '{"drive":"/x"}');
    const req = join(t.base, '.move-request'); symlinkSync(secret, req);
    let r = run(req); assert.equal(r.status, 2); assert.equal(JSON.parse(r.stdout).code, 'request-is-a-link');
    assert.equal(existsSync(req), false, 'a refused request was left in place (the path unit would loop)'); assert.equal(existsSync(out), false);
    writeFileSync(req, JSON.stringify({ drive: t.drive, pad: 'x'.repeat(9000) })); r = run(req);
    assert.equal(r.status, 2); assert.equal(existsSync(req), false);
    writeFileSync(req, JSON.stringify({ drive: t.drive })); r = run(req);
    assert.equal(r.status, 0); assert.equal(existsSync(req), false); assert.equal(existsSync(out), true);
  } finally { t.done(); }
});

// remove-old TOCTOU (audit L-4 / N-c): the recorded old copy is swapped for a link to the LIVE folder between the first
// check and a deletion. The re-check at the moment of deletion must stop it; the live folder must come through whole.
import { removeRecorded } from './relay-move-server.mjs';
import { readdirSync, renameSync } from 'node:fs';
test('remove-old re-checks at the moment of deletion: a copy swapped for a link to the live folder is not followed', () => {
  const w = mkdtempSync(join(tmpdir(), 'trin-toctou-'));
  try {
    const old = join(w, 'old'), live = join(w, 'live'), away = join(w, 'old-away');
    for (const d of [old, live]) { mkdirSync(d); writeFileSync(join(d, 'relay-key.json'), JSON.stringify({ sk: 'a', pub: 'P' })); writeFileSync(join(d, 'a.dat'), 'x'); writeFileSync(join(d, 'b.dat'), 'y'); }
    writeFileSync(join(old, 'MOVED-TO'), 'moved');
    let swapped = false;
    const r = removeRecorded({ path: old, liveDirs: [live], relayPub: 'P' }, { beforeDelete: () => { if (!swapped) { swapped = true; renameSync(old, away); symlinkSync(live, old); } } });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.deepEqual(readdirSync(live).sort(), ['a.dat', 'b.dat', 'relay-key.json'], 'THE LIVE FOLDER WAS DELETED THROUGH A SWAPPED LINK');
  } finally { rmSync(w, { recursive: true, force: true }); }
});
test('remove-old refuses a folder with no MOVED-TO, one that is the live folder, and a copy that is not this relay\'s', () => {
  const w = mkdtempSync(join(tmpdir(), 'trin-rm-'));
  try {
    const old = join(w, 'old'), live = join(w, 'live'); mkdirSync(old); mkdirSync(live); writeFileSync(join(old, 'a'), '1');
    assert.equal(removeRecorded({ path: old, liveDirs: [live], relayPub: 'P' }).code, 'no-moved-note');
    writeFileSync(join(old, 'MOVED-TO'), 'm');
    assert.equal(removeRecorded({ path: old, liveDirs: [live], relayPub: 'P' }).code, 'not-this-relays-copy');
    assert.equal(removeRecorded({ path: old, liveDirs: [old], relayPub: 'P' }).code, 'current-folder');
    assert.equal(existsSync(join(old, 'a')), true);
  } finally { rmSync(w, { recursive: true, force: true }); }
});
