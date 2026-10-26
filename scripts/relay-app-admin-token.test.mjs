// Point-of-use test for the relay dashboard's self-healing admin token (Fix A).
// It lifts the REAL reauth/adminFetch source out of relay-app/control.js (between the ADMIN-FETCH markers) and
// runs it with a stubbed fetch. Nothing here re-implements them: delete the retry, the shared promise, the
// backoff or the no-clobber guard in control.js and the matching test goes red. Port-free; no relay started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'relay-app', 'control.js'), 'utf8');
const m = SRC.match(/\/\/ ADMIN-FETCH-BEGIN[^\n]*\n([\s\S]*?)\/\/ ADMIN-FETCH-END/);
assert.ok(m, 'ADMIN-FETCH markers are gone from control.js — re-anchor this test');

function rig(routes, { token = '', clock = { t: 1e6 } } = {}) {
  const calls = [];
  const store = {};
  const fetchStub = async (url, o = {}) => {
    calls.push({ url, auth: (o.headers || {}).Authorization || '' });
    const q = routes[url]; const spec = typeof q === 'function' ? q(calls) : q.shift();
    await Promise.resolve();
    return { status: spec.status, ok: spec.status >= 200 && spec.status < 300, json: async () => spec.body };
  };
  const D = { now: () => clock.t };
  const fn = new Function('fetch', 'sessionStorage', 'TOKEN_KEY', 'Date', 'init',
    'let adminToken = init; const authHeaders = () => adminToken ? { Authorization: "Bearer " + adminToken } : {};\n' +
    m[1] + '\nreturn { reauth, adminFetch, tok: () => adminToken };');
  const api = fn(fetchStub, { setItem: (k, v) => { store[k] = v; } }, 'K', D, token);
  return { ...api, calls, store, clock };
}
const lt = (c) => c.filter(x => x.url === '/local-token').length;

test('401 -> exactly one /local-token re-fetch -> exactly one retry with the NEW token', async () => {
  const r = rig({ '/stats': [{ status: 401 }, { status: 200, body: { ok: 1 } }], '/local-token': [{ status: 200, body: { token: 'NEW' } }] }, { token: 'OLD' });
  const res = await r.adminFetch('/stats');
  assert.equal(res.status, 200);
  assert.equal(lt(r.calls), 1);
  assert.deepEqual(r.calls.map(c => c.url), ['/stats', '/local-token', '/stats']);
  assert.equal(r.calls[0].auth, 'Bearer OLD');
  assert.equal(r.calls[2].auth, 'Bearer NEW', 'the retry must carry the re-acquired token');
  assert.equal(r.store.K, 'NEW');
});

test('a 200 never touches /local-token', async () => {
  const r = rig({ '/stats': [{ status: 200, body: {} }], '/local-token': [] }, { token: 'T' });
  await r.adminFetch('/stats');
  assert.equal(lt(r.calls), 0);
});

test('concurrent 401s share ONE /local-token attempt', async () => {
  const r = rig({ '/stats': (c) => ({ status: c[c.length - 1].auth === 'Bearer NEW' ? 200 : 401 }), '/local-token': [{ status: 200, body: { token: 'NEW' } }] }, { token: 'OLD' });
  const [a, b] = await Promise.all([r.adminFetch('/stats'), r.adminFetch('/stats')]);
  assert.equal(lt(r.calls), 1, 'two overlapping callers must await one shared re-auth');
  assert.equal(a.status, 200); assert.equal(b.status, 200, 'the second caller must wait for the shared re-auth and retry with the NEW token');
});

test('a 403 from /local-token (remote view) does NOT clear a valid token', async () => {
  const r = rig({ '/stats': [{ status: 401 }, { status: 401 }], '/local-token': [{ status: 403 }] }, { token: 'REMOTE' });
  const res = await r.adminFetch('/stats');
  assert.equal(res.status, 401, 'still locked: the caller sees the 401 and can show the locked card');
  assert.equal(r.tok(), 'REMOTE', 'the token must survive a failed re-auth');
  assert.equal(r.store.K, undefined);
});

test('backoff: a second 401 within 30s does not hit /local-token again; after 30s it does', async () => {
  const r = rig({ '/stats': (c) => ({ status: 401 }), '/local-token': [{ status: 403 }, { status: 403 }] }, { token: 'X' });
  await r.adminFetch('/stats');
  await r.adminFetch('/stats');
  assert.equal(lt(r.calls), 1, 'second attempt inside 30s must be suppressed');
  r.clock.t += 31000;
  await r.adminFetch('/stats');
  assert.equal(lt(r.calls), 2, 'after the backoff a new attempt is allowed');
});
