const mysql = require('mysql2/promise');
const { createReadinessProbe } = require('../health/readiness');

// Cluster uses Router; explicit standalone mode is for local development.
const { mode, clusterSize } = require('../health/mode').databaseMode();
if (process.env.NODE_ENV !== 'test' && (!process.env.DB_USER || !process.env.DB_PASSWORD)) {
  throw new Error('Cần cấu hình DB_USER và DB_PASSWORD.');
}
const connectionOptions = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 6446),
  user: process.env.DB_USER || 'test',
  password: process.env.DB_PASSWORD || 'test',
  database: process.env.DB_NAME || 'visinh_db',
  connectTimeout: 1000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};
const pool = mysql.createPool({
  ...connectionOptions,
  // Fail promptly on saturation rather than leaving requests in an unbounded queue.
  waitForConnections: false,
  connectionLimit: 20
});
const checkReadiness = createReadinessProbe({
  connect: () => mysql.createConnection(connectionOptions),
  clusterSize
});
module.exports = { pool, checkReadiness, mode };
