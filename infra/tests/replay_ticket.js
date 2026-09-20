// Staging-only write check: creates ONE import ticket and replays it on another backend.
// API_TOKEN and TEST_IMPORT_FILE are required. Use a staging database with disposable data.
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const [first, second] = process.argv.slice(2);
if (!first || !second || process.env.ALLOW_STAGING_WRITE !== 'yes' || !process.env.API_TOKEN || !process.env.TEST_IMPORT_FILE) {
  console.error('Set ALLOW_STAGING_WRITE=yes, API_TOKEN, TEST_IMPORT_FILE; run node infra/tests/replay_ticket.js http://VIP:3000 http://BACKEND:3000');
  process.exit(1);
}
(async () => {
  const body = fs.readFileSync(process.env.TEST_IMPORT_FILE, 'utf8');
  JSON.parse(body);
  const key = process.env.TEST_IDEMPOTENCY_KEY || `test-${randomUUID()}`;
  // Log before sending, so the operator can reuse this exact key after a lost response.
  console.log(`idempotency_key=${key}`);
  const send = async base => {
    const response = await fetch(`${base.replace(/\/$/, '')}/api/imports`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.API_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': key },
      body, signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw Error(`HTTP ${response.status}; keep this key to reconcile/retry, do not generate a new one.`);
    return response.json();
  };
  // Concurrent requests exercise the database reservation, including across backends.
  const [a, b] = await Promise.all([send(first), send(second)]);
  if (!a.success || !a.ticket?.id || a.ticket.id !== b.ticket?.id) throw Error('Replay mismatch');
  assert.deepStrictEqual(a, b);
  console.log(JSON.stringify({ ticket_id: a.ticket.id, replay_match: true }));
})().catch(err => { console.error(err.message); process.exitCode = 1; });
