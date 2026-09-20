const { pool } = require('../config/db');
const { createHash } = require('crypto');

// The reservation and all business writes commit atomically on the same connection.
function transactional(handler, broadcast = () => {}) {
  return async (req, res, next) => {
    const key = req.headers['x-idempotency-key'];
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(key)) {
      return res.status(400).json({ success: false, message: 'X-Idempotency-Key phải có 1–48 ký tự chữ, số, _ hoặc -.' });
    }
    const scope = createHash('sha256').update(`${req.user.id}:${req.method}:${req.path}:${key}`).digest('hex');
    const fingerprint = createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      try {
        await connection.query('INSERT INTO api_requests (request_key, fingerprint) VALUES (?, ?)', [scope, fingerprint]);
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
        const [rows] = await connection.query('SELECT fingerprint, response_json FROM api_requests WHERE request_key = ? FOR UPDATE', [scope]);
        await connection.rollback();
        if (rows[0].fingerprint !== fingerprint) return res.status(409).json({ success: false, message: 'Key đã được dùng cho nội dung khác.' });
        return res.json(typeof rows[0].response_json === 'string' ? JSON.parse(rows[0].response_json) : rows[0].response_json);
      }
      req.connection = connection;
      req.idempotencyKey = scope.slice(0, 40);
      let status = 200, body;
      const response = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
      await handler(req, response);
      if (status >= 400 || !body || body.success !== true) {
        await connection.rollback();
        return res.status(status >= 400 ? status : 500).json(body || { success: false, message: 'Giao dịch thất bại.' });
      }
      await connection.query('UPDATE api_requests SET response_json = ? WHERE request_key = ?', [JSON.stringify(body), scope]);
      await connection.commit();
      res.status(status).json(body);
      try { broadcast(); } catch (err) { console.error('[Broadcast Error]', err.message); }
    } catch (err) {
      if (connection) await connection.rollback().catch(() => {});
      next(err);
    } finally {
      if (connection) connection.release();
    }
  };
}
module.exports = { transactional };
