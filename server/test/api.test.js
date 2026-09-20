const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function load(file, mocks = {}, globals = {}) {
  const absolute = path.resolve(__dirname, '..', file);
  const context = { module: { exports: {} }, console, ...globals, require: name => name in mocks ? mocks[name] : require(name.startsWith('.') ? path.resolve(path.dirname(absolute), name) : name) };
  vm.runInNewContext(fs.readFileSync(absolute, 'utf8'), context);
  return context.module.exports;
}
function response() { return { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } }; }
test('negative export is rejected before any write', async () => {
  const ctrl = load('src/controllers/exportController.js', { '../config/db': {} });
  const res = response();
  await ctrl.createExportTicket({ body: { department_name: 'A', items: [{ batch_id: 1, quantity: -5 }] }, user: { id: 1 } }, res);
  assert.equal(res.code, 400);
});
test('stale stocktake is rejected before balance update', async () => {
  let writes = 0;
  const connection = { query: async sql => {
    if (sql.includes('FROM stocktakes')) return [[{ id: 1, status: 'DRAFT' }]];
    if (sql.includes('FROM stocktake_details')) return [[{ batch_id: 1, book_quantity: 10, actual_quantity: 8, difference: -2 }]];
    if (sql.includes('FROM batches')) return [[{ current_quantity: 5 }]];
    writes++; return [{}];
  }};
  const ctrl = load('src/controllers/stocktakeController.js', { '../config/db': {} });
  const res = response();
  await ctrl.adjustStocktake({ params: { id: 1 }, user: { id: 1 }, connection }, res);
  assert.equal(res.code, 409); assert.equal(writes, 0);
});
test('client keeps the same key after lost response', async () => {
  const keys = [];
  const context = { AbortController, clearTimeout: () => {}, window: { location: { hostname: 'localhost' } }, localStorage: { getItem: () => null }, setTimeout: fn => fn(), fetch: async (url, opts) => {
    keys.push(opts.headers['X-Idempotency-Key']);
    if (keys.length === 1) throw new TypeError('Failed to fetch');
    return { status: 200, ok: true, text: async () => JSON.stringify({ success: true }) };
  }};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../client/src/services/api.js'), 'utf8') + ';globalThis.api = api;', context);
  context.api.showReconnectToast = context.api.hideReconnectToast = () => {};
  await context.api.createExportTicket({ items: [] });
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
});
test('idempotent replay skips writes; changed body conflicts; failure rolls back', async () => {
  let stored, calls = 0, commits = 0, rollbacks = 0;
  const connection = { beginTransaction: async () => {}, release() {}, commit: async () => { commits++; }, rollback: async () => { rollbacks++; }, query: async (sql, params) => {
    if (sql.startsWith('INSERT')) {
      if (stored) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      stored = { fingerprint: params[1] }; return [{}];
    }
    if (sql.startsWith('UPDATE')) { stored.response_json = params[0]; return [{}]; }
    return [[stored]];
  }};
  const { transactional } = load('src/middleware/idempotency.js', { '../config/db': { pool: { getConnection: async () => connection } } });
  const handler = transactional(async (req, res) => { calls++; res.json({ success: true, ticket: 7 }); });
  const req = { headers: { 'x-idempotency-key': 'test' }, user: { id: 1 }, method: 'POST', path: '/api/exports', body: { quantity: 1 } };
  const next = err => { throw err; };
  await handler(req, response(), next);
  const replay = response(); await handler(req, replay, next);
  assert.equal(calls, 1); assert.equal(commits, 1); assert.equal(replay.body.ticket, 7);
  const conflict = response(); await handler({ ...req, body: { quantity: 2 } }, conflict, next); assert.equal(conflict.code, 409);
  stored = null;
  await transactional(async (req, res) => res.status(400).json({ success: false }))(req, response(), next);
  assert.equal(commits, 1); assert.equal(rollbacks, 3);
});
test('locked users and expired tokens are rejected', async () => {
  const auth = load('src/middleware/auth.js', { jsonwebtoken: { verify: token => { if (!token) throw Error(); return { id: 1 }; } }, '../config/db': { pool: { query: async () => [[{ id: 1, status: 'LOCKED' }]] } } }, { process: { env: { JWT_SECRET: 'a'.repeat(32) } } });
  const res = response(); await auth.verifyToken({ headers: { authorization: 'Bearer test' } }, res, () => assert.fail()); assert.equal(res.code, 401);
  const missing = response(); await auth.verifyToken({ headers: {} }, missing, () => assert.fail()); assert.equal(missing.code, 401);
  const denied = response(); auth.requirePermission('can_export')({ user: { role: 'STAFF', permissions: { can_export: false } } }, denied, () => assert.fail()); assert.equal(denied.code, 403);
});
test('reports reject invalid dates and pass period/category/location to query', async () => {
  let captured;
  const ctrl = load('src/controllers/reportController.js', { '../config/db': { pool: { query: async (sql, args) => { captured = { sql, args }; return [[]]; } } }, '../utils/excel': {} });
  const invalid = response(); await ctrl.getInventoryReportData({ query: { from_date: '2026-02-30' } }, invalid); assert.equal(invalid.code, 400);
  await ctrl.getInventoryReportData({ query: { from_date: '2026-01-01', to_date: '2026-01-31', category_id: '2', location_id: '3' } }, response());
  assert.ok(captured.args.includes('2026-01-01')); assert.ok(captured.args.includes('2026-01-31')); assert.ok(captured.args.includes('2')); assert.ok(captured.args.includes('3'));
  assert.ok(!captured.sql.includes('WHERE b.current_quantity > 0'));
});
test('valid import writes quantity and location through the supplied transaction', async () => {
  let batch;
  const connection = { query: async (sql, values) => {
    if (sql.includes('INSERT INTO batches')) batch = { sql, values };
    return [{ insertId: 1 }];
  }};
  const ctrl = load('src/controllers/importController.js', { '../config/db': {}, '../utils/barcode': { generateCode128Base64: async () => 'image' } });
  const res = response();
  await ctrl.createImportTicket({ body: { items: [{ item_id: 1, location_id: 2, quantity: 5, unit_price: 10, expiry_date: '2099-01-01' }] }, user: { id: 1 }, connection, idempotencyKey: 'test' }, res);
  assert.equal(res.body.success, true);
  assert.equal(batch.values[2], 2); assert.equal(batch.values[4], 5);
  assert.equal((batch.sql.match(/\?/g) || []).length, batch.values.length);
});
