const { pool } = require('../config/db');
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function id(value) { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) fail('Mã định danh không hợp lệ.'); return n; }
function text(value, max = 200, required = true) { if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('Thông tin nhập không hợp lệ.'); return value.trim(); }
function dates(query) {
  for (const k of ['from_date', 'to_date']) if (query[k] && (!/^\d{4}-\d{2}-\d{2}$/.test(query[k]) || Number.isNaN(Date.parse(query[k])) || new Date(query[k]).toISOString().slice(0,10) !== query[k])) fail('Ngày phải theo định dạng YYYY-MM-DD.');
  if (query.from_date && query.to_date && query.from_date > query.to_date) fail('Ngày bắt đầu phải trước ngày kết thúc.');
  return [query.from_date || '1000-01-01', query.to_date || '9999-12-30'];
}
async function audit(c, req, action, type, target, details) { await c.query('INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())', [req.user.id, action, type, String(target), JSON.stringify(details), req.ip || '']); }
async function transaction(work) { const c = await pool.getConnection(); try { await c.beginTransaction(); const result = await work(c); await c.commit(); return result; } catch(e) { await c.rollback().catch(()=>{}); throw e; } finally { c.release(); } }
const alertDaysSQL = "COALESCE(i.expire_alert_days, (SELECT CAST(config_value AS UNSIGNED) FROM system_config WHERE config_key = 'DEFAULT_EXPIRE_ALERT_DAYS'), 7)";
module.exports = { fail, id, text, dates, audit, transaction, alertDaysSQL };
