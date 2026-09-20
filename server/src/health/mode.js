function databaseMode(env = process.env) {
  const rawMode = (env.DB_MODE || 'cluster').toLowerCase();
  const mode = (rawMode === 'single' || rawMode === 'standalone') ? 'standalone' : rawMode;
  if (!['standalone', 'cluster'].includes(mode)) throw new Error('DB_MODE phải là standalone hoặc cluster.');
  if (mode === 'standalone' && env.NODE_ENV === 'production' && !env.ALLOW_STANDALONE && !env.ALLOW_SINGLE_DB && !env.RENDER) {
    throw new Error('Production yêu cầu DB_MODE=cluster.');
  }
  const clusterSize = Number(env.DB_CLUSTER_SIZE || 3);
  if (mode === 'cluster' && (!Number.isInteger(clusterSize) || clusterSize < 3)) throw new Error('Cluster yêu cầu DB_CLUSTER_SIZE >= 3.');
  return { mode, clusterSize: mode === 'standalone' ? 1 : clusterSize };
}
module.exports = { databaseMode };


