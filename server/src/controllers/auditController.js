const { databaseErrorStatus } = require('../utils/databaseErrors');
const { pool } = require('../config/db');

async function getAuditLogs(req, res) {
  try {
    const [logs] = await pool.query(`
      SELECT 
        a.id,
        a.action,
        a.target_type,
        a.target_id,
        a.details,
        a.ip_address,
        a.created_at,
        u.username,
        u.full_name
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.id DESC
      LIMIT 100
    `);

    return res.json({ success: true, logs });
  } catch (err) {
    return res.status(databaseErrorStatus(err)).json({ success: false, message: err.message });
  }
}

module.exports = {
  getAuditLogs
};
