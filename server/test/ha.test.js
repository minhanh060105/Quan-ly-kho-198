const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
const { createReadinessProbe } = require('../src/health/readiness');
const { databaseErrorStatus } = require('../src/utils/databaseErrors');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const healthy = { server_uuid: 'primary-A', read_only: 0, super_read_only: 0, single_primary: 1, member_state: 'ONLINE', member_role: 'PRIMARY', primary_count: 1, online_members: 3 };
function fakeConnection(row, missingSchema = false) {
  return { closed: false, async query({ sql }) {
    if (sql.includes('api_requests')) { if (missingSchema) throw Error('missing migration'); return [[]]; }
    return [[row]];
  }, destroy() { this.closed = true; } };
}
test('readiness follows primary change and does not cache old healthy status', async () => {
  let row = healthy;
  const connections = [];
  const probe = createReadinessProbe({ connect: async () => { const c = fakeConnection(row); connections.push(c); return c; } });
  assert.equal((await probe()).primary_id, 'primary-A');
  row = { ...healthy, server_uuid: 'primary-B', online_members: 2 };
  const recovered = await probe(); assert.equal(recovered.ready, true); assert.equal(recovered.primary_id, 'primary-B');
  row = { ...healthy, online_members: 1 };
  assert.equal((await probe()).ready, false);
  assert.ok(connections.every(c => c.closed));
});
for (const [label, change] of Object.entries({ secondary: { member_role: 'SECONDARY' }, readonly: { read_only: 1 }, superReadonly: { super_read_only: 1 }, minority: { online_members: 1 }, recovering: { member_state: 'RECOVERING' }, multiplePrimaries: { primary_count: 2 }, multiPrimaryMode: { single_primary: 0 } })) {
  test(`readiness rejects ${label}`, async () => {
    const probe = createReadinessProbe({ connect: async () => fakeConnection({ ...healthy, ...change }) });
    assert.equal((await probe()).ready, false);
  });
}
test('readiness rejects missing migration and refused Router connection', async () => {
  assert.equal((await createReadinessProbe({ connect: async () => fakeConnection(healthy, true) })()).ready, false);
  assert.equal((await createReadinessProbe({ connect: async () => { throw Error('ECONNREFUSED'); } })()).ready, false);
});
test('hung queries fail by deadline and destroy their connection', async () => {
  let destroyed = false;
  const probe = createReadinessProbe({ timeoutMs: 15, connect: async () => ({ query: () => new Promise(() => {}), destroy: () => { destroyed = true; } }) });
  assert.equal((await probe()).ready, false); assert.equal(destroyed, true);
});
test('late connections are destroyed after readiness times out', async () => {
  let resolve;
  const probe = createReadinessProbe({ timeoutMs: 15, connect: () => new Promise(r => { resolve = r; }) });
  assert.equal((await probe()).ready, false);
  const c = fakeConnection(healthy); resolve(c);
  await new Promise(r => setImmediate(r)); assert.equal(c.closed, true);
});
test('simultaneous health requests share one probe', async () => {
  let connections = 0;
  const probe = createReadinessProbe({ connect: async () => { connections++; return fakeConnection(healthy); } });
  await Promise.all([probe(), probe(), probe()]); assert.equal(connections, 1);
});
test('transient DB errors map to 503; invalid input is not marked retryable', () => {
  for (const code of ['ECONNRESET', 'ER_OPTION_PREVENTS_STATEMENT', 'ER_LOCK_DEADLOCK']) assert.equal(databaseErrorStatus({ code }), 503);
  assert.equal(databaseErrorStatus({ code: 'ER_BAD_FIELD_ERROR' }), 500);
  assert.equal(databaseErrorStatus({ message: 'not enough stock' }, 400), 400);
});
function client(fetch) {
  const ctx = { AbortController, clearTimeout: () => {}, setTimeout: (fn, ms) => { if (ms !== 15000) fn(); return 1; }, window: { location: { hostname: 'localhost' } }, localStorage: { getItem: () => null }, fetch };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../client/src/services/api.js'), 'utf8') + ';globalThis.api = api;', ctx);
  ctx.api.showReconnectToast = ctx.api.hideReconnectToast = () => {};
  return ctx.api;
}
test('client retries 503 from failover with same idempotency key and payload', async () => {
  const requests = [];
  const api = client(async (url, options) => {
    requests.push(options);
    if (requests.length === 1) return { status: 503, ok: false };
    return { status: 200, ok: true, text: async () => JSON.stringify({ success: true, ticket: 1 }) };
  });
  await api.createExportTicket({ items: [{ batch_id: 1, quantity: 1 }] });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers['X-Idempotency-Key'], requests[1].headers['X-Idempotency-Key']);
  assert.equal(requests[0].body, requests[1].body);
});
test('non-idempotent user toggle is never retried on ambiguous connection failure', async () => {
  let calls = 0;
  const api = client(async () => { calls++; throw new TypeError('Failed to fetch'); });
  await assert.rejects(api.toggleLockUser(1)); assert.equal(calls, 1);
});
test('validation errors do not trigger retries', async () => {
  let calls = 0;
  const api = client(async () => { calls++; return { status: 400, ok: false, text: async () => JSON.stringify({ message: 'invalid quantity' }) }; });
  await assert.rejects(api.createExportTicket({}), /invalid quantity/); assert.equal(calls, 1);
});
test('health script propagates failure and uses one bounded readiness request', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visinh-health-'));
  const log = path.join(dir, 'args');
  fs.writeFileSync(path.join(dir, 'curl'), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$HEALTH_TEST_LOG"\nexit "$HEALTH_TEST_EXIT"\n', { mode: 0o755 });
  const script = path.resolve(__dirname, '../../infra/keepalived/check_health.sh');
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, HEALTH_TEST_LOG: log, HEALTH_TEST_EXIT: '0' };
  execFileSync('/bin/sh', [script], { env });
  const args = fs.readFileSync(log, 'utf8');
  assert.equal(args.split('http://127.0.0.1:3000/api/ready').length - 1, 1);
  assert.match(args, /--max-time\n2/);
  assert.throws(() => execFileSync('/bin/sh', [script], { env: { ...env, HEALTH_TEST_EXIT: '22' } }));
});
test('API readiness and mutation preflight fail closed; no backend election routes remain', async () => {
  const routes = [], middleware = [];
  const app = { use: (...args) => middleware.push(args), get: (...args) => routes.push(args), post: (...args) => routes.push(args), put: (...args) => routes.push(args), delete: (...args) => routes.push(args) };
  const express = () => app; express.json = () => () => {}; express.static = () => () => {};
  let ready = false;
  const noop = () => {};
  const mocks = {
    express, http: { createServer: () => ({ listen: noop }) },
    ws: { Server: class { constructor() { this.clients = []; } on() {} } },
    cors: () => noop, dotenv: { config: noop },
    './config/db': { checkReadiness: async () => ({ ready }) },
    './utils/databaseErrors': { databaseErrorStatus },
    './middleware/auth': { verifyToken: noop, requireRole: () => noop, requirePermission: () => noop },
    './middleware/idempotency': { transactional: () => noop }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/app.js'), 'utf8'), {
    __dirname: path.resolve(__dirname, '../src'),
    require: name => {
      if (name in mocks) return mocks[name];
      if (name === 'path') return require('node:path');
      if (name.startsWith('./controllers/')) return {};
      throw Error(`Unexpected import ${name}`);
    }, process: { env: {} }, console
  });
  assert.ok(!routes.some(([route]) => route.includes('/raft')));
  const response = () => ({ code: 200, setHeader: noop, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } });
  const health = response();
  await routes.find(([route]) => route === '/api/ready')[1]({}, health);
  assert.equal(health.code, 503); assert.equal(health.body.ready, false);
  const gate = middleware.find(args => args[0] === '/api')[1];
  let passed = 0;
  const denied = response(); await gate({ method: 'POST' }, denied, () => { passed++; });
  assert.equal(denied.code, 503); assert.equal(passed, 0);
  ready = true; await gate({ method: 'POST' }, response(), () => { passed++; });
  assert.equal(passed, 1);
});

test('standalone readiness does not require Group Replication', async () => {
  for (const read_only of [0, 1]) {
    const probe = createReadinessProbe({ clusterSize: 1, connect: async () => ({
      async query({ sql }) {
        assert.equal(sql.includes('group_replication'), false);
        return [[{ server_uuid: 'local', read_only, super_read_only: 0 }]];
      }, destroy() {}
    }) });
    assert.equal((await probe()).ready, read_only === 0);
  }
});
test('login preserves invalid credentials message', async () => {
  const api = client(async () => ({ status: 401, ok: false, text: async () => JSON.stringify({ message: 'Sai tài khoản hoặc mật khẩu' }) }));
  await assert.rejects(api.request('/auth/login', { method: 'POST' }), /Sai tài khoản hoặc mật khẩu/);
});
