function databaseMode(env = process.env) {
  const mode = env.DB_MODE || 'cluster';
  if (!['standalone', 'cluster'].includes(mode)) throw new Error('DB_MODE phải là standalone hoặc cluster.');
  if (mode === 'standalone' && env.NODE_ENV === 'production') throw new Error('Production yêu cầu DB_MODE=cluster.');
  const clusterSize = Number(env.DB_CLUSTER_SIZE || 3);
  if (mode === 'cluster' && (!Number.isInteger(clusterSize) || clusterSize < 3)) throw new Error('Cluster yêu cầu DB_CLUSTER_SIZE >= 3.');
  return { mode, clusterSize: mode === 'standalone' ? 1 : clusterSize };
}
module.exports = { databaseMode };
