// Readiness is a routing signal, not a write lock. Group Replication enforces quorum.
const STATUS_SQL = `SELECT @@server_uuid AS server_uuid,
  @@global.read_only AS read_only, @@global.super_read_only AS super_read_only,
  @@global.group_replication_single_primary_mode AS single_primary,
  (SELECT MEMBER_STATE FROM performance_schema.replication_group_members WHERE MEMBER_ID = @@server_uuid) AS member_state,
  (SELECT MEMBER_ROLE FROM performance_schema.replication_group_members WHERE MEMBER_ID = @@server_uuid) AS member_role,
  (SELECT COUNT(*) FROM performance_schema.replication_group_members WHERE MEMBER_STATE = 'ONLINE') AS online_members,
  (SELECT COUNT(*) FROM performance_schema.replication_group_members WHERE MEMBER_STATE = 'ONLINE' AND MEMBER_ROLE = 'PRIMARY') AS primary_count`;

function createReadinessProbe({ connect, clusterSize = 3, timeoutMs = 1200 }) {
  if (!Number.isInteger(clusterSize) || clusterSize < 1) throw new Error('DB_CLUSTER_SIZE phải >= 1.');
  let pending;
  return function readiness() {
    // Share simultaneous probes, but never cache a successful result across checks.
    if (pending) return pending;
    pending = (async () => {
      let connection, expired = false, timer;
      const work = (async () => {
        connection = await connect();
        if (expired) { connection.destroy(); return { ready: false }; }
        const standalone = clusterSize === 1;
        const sql = standalone
          ? 'SELECT @@server_uuid AS server_uuid, @@global.read_only AS read_only, @@global.super_read_only AS super_read_only'
          : STATUS_SQL;
        const [[row]] = await connection.query({ sql, timeout: timeoutMs });
        const ready = !!row && Number(row.read_only) === 0 && Number(row.super_read_only) === 0 &&
          (standalone || (Number(row.single_primary) === 1 && row.member_state === 'ONLINE' && row.member_role === 'PRIMARY' &&
          Number(row.primary_count) === 1 && Number(row.online_members) >= Math.floor(clusterSize / 2) + 1));
        // Missing migration must not leave a node advertising transaction readiness.
        if (ready) await connection.query({ sql: 'SELECT request_key FROM api_requests LIMIT 0', timeout: timeoutMs });
        return { ready, primary_id: row?.server_uuid || null, online_members: Number(row?.online_members || 0) };
      })();
      try {
        return await Promise.race([work, new Promise(resolve => {
          timer = setTimeout(() => { expired = true; resolve({ ready: false }); }, timeoutMs);
        })]);
      } catch { return { ready: false }; }
      finally {
        clearTimeout(timer);
        if (connection) connection.destroy();
      }
    })().finally(() => { pending = null; });
    return pending;
  };
}
module.exports = { createReadinessProbe, STATUS_SQL };
