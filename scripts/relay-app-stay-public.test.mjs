// Point-of-use test for the relay panel's "Stay public" switch (control.js, STAY-PUBLIC markers).
// It lifts the REAL stayPublicRequest / stayPublicChecked source out of relay-app/control.js and runs it with a
// stubbed fetch. Deleting the OFF->/tunnel/down branch, the ON->/tunnel/up branch, or the error mapping in
// control.js turns the matching test red. Port-free; no relay started; no DOM (the switch wiring itself is not run here).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'relay-app', 'control.js'), 'utf8');
const m = SRC.match(/\/\/ STAY-PUBLIC-BEGIN[^\n]*\n([\s\S]*?)\/\/ STAY-PUBLIC-END/);
assert.ok(m, 'STAY-PUBLIC markers are gone from control.js — re-anchor this test');
const api = new Function(m[1] + '\nreturn { stayPublicRequest, stayPublicChecked };')();

function stubFetch(spec) {
  const calls = [];
  const fn = async (url, o = {}) => {
    calls.push({ url, method: o.method, auth: (o.headers || {}).Authorization || '' });
    if (spec instanceof Error) throw spec;
    return { ok: spec.status >= 200 && spec.status < 300, status: spec.status, json: async () => { if (spec.bad) throw new SyntaxError('x'); return spec.body; } };
  };
  return { fn, calls };
}

test('ON posts /tunnel/up (never /tunnel/down) and returns the public url', async () => {
  const s = stubFetch({ status: 200, body: { ok: true, url: 'https://a.trycloudflare.com' } });
  const res = await api.stayPublicRequest(true, { Authorization: 'Bearer T' }, s.fn);
  assert.deepEqual(s.calls.map(c => [c.method, c.url]), [['POST', '/tunnel/up']]);
  assert.equal(s.calls[0].auth, 'Bearer T', 'the admin bearer must be sent');
  assert.deepEqual(res, { ok: true, url: 'https://a.trycloudflare.com' });
});

test('OFF posts /tunnel/down (never /tunnel/up) and reports ok', async () => {
  const s = stubFetch({ status: 200, body: { ok: true } });
  const res = await api.stayPublicRequest(false, {}, s.fn);
  assert.deepEqual(s.calls.map(c => [c.method, c.url]), [['POST', '/tunnel/down']]);
  assert.deepEqual(res, { ok: true, url: '' });
});

test('a 502 from /tunnel/up surfaces the server error (switch must revert)', async () => {
  const s = stubFetch({ status: 502, body: { error: 'cloudflared isn’t bundled' } });
  const res = await api.stayPublicRequest(true, {}, s.fn);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'cloudflared isn’t bundled');
});

test('a non-JSON error body falls back to the HTTP status', async () => {
  const s = stubFetch({ status: 500, bad: true });
  const res = await api.stayPublicRequest(false, {}, s.fn);
  assert.deepEqual(res, { ok: false, error: 'HTTP 500' });
});

test('a network failure is reported as not-ok, not thrown', async () => {
  const s = stubFetch(new TypeError('Failed to fetch'));
  const res = await api.stayPublicRequest(true, {}, s.fn);
  assert.deepEqual(res, { ok: false, error: 'Failed to fetch' });
});

test('switch state follows /tunnel/state: ON only when running AND a url exists', () => {
  assert.equal(api.stayPublicChecked({ running: true, url: 'https://x.trycloudflare.com' }), true);
  assert.equal(api.stayPublicChecked({ running: false, url: '' }), false);
  assert.equal(api.stayPublicChecked({ running: true, url: '' }), false, 'running without a url is not public yet');
  assert.equal(api.stayPublicChecked(null), null, 'unreachable relay leaves the switch alone');
});
