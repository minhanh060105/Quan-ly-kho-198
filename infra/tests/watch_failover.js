// Read-only observer; does not stop services, change membership, or mutate inventory.
const base = process.argv[2];
const seconds = Number(process.argv[3] || 180);
if (!base || !/^https?:\/\//.test(base) || !Number.isFinite(seconds) || seconds <= 0) {
  console.error('Usage: node infra/tests/watch_failover.js http://VIP:3000 [seconds]');
  process.exit(1);
}
(async () => {
  const stop = Date.now() + seconds * 1000;
  let previous, downSince, outages = [], readyCount = 0;
  while (Date.now() < stop) {
    let state;
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/api/ready`, { signal: AbortSignal.timeout(2000) });
      const body = await response.json();
      state = response.ok && body.ready ? `READY primary=${body.primary_id} backend=${body.node_id}` : 'DOWN';
    } catch { state = 'DOWN'; }
    if (state !== previous) console.log(new Date().toISOString(), state);
    if (state === 'DOWN') downSince ??= Date.now();
    else {
      readyCount++;
      if (downSince) { outages.push(Date.now() - downSince); downSince = undefined; }
    }
    previous = state;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.log(JSON.stringify({ readySamples: readyCount, observedOutagesMs: outages, stillDown: !!downSince }));
  if (!readyCount || downSince) process.exitCode = 1;
})().catch(err => { console.error(err.message); process.exitCode = 1; });
