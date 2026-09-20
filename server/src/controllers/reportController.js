const { alertDaysSQL } = require('../utils/business');
const { databaseErrorStatus } = require('../utils/databaseErrors');
const { pool } = require('../config/db');
const { generateInventoryReportExcel } = require('../utils/excel');

/**
 * Lấy dữ liệu Tổng quan Dashboard (4 thẻ chỉ số chuẩn xác API)
 */
async function getDashboardStats(req, res) {
  try {
    // 1. Tổng số mặt hàng đang quản lý (phân tách Thuốc/Hóa chất & Vật tư)
    const [itemRows] = await pool.query(`
      SELECT 
        COUNT(*) as total_items,
        SUM(CASE WHEN c.type = 'HOA_CHAT' THEN 1 ELSE 0 END) as total_medicines,
        SUM(CASE WHEN c.type = 'VAT_TU' THEN 1 ELSE 0 END) as total_supplies
      FROM items i
      JOIN categories c ON i.category_id = c.id
    `);

    // 2. Số mặt hàng tồn thấp (dưới ngưỡng min_stock)
    const [lowStockRows] = await pool.query(`
      SELECT COUNT(DISTINCT i.id) as count
      FROM items i
      LEFT JOIN batches b ON i.id = b.item_id
      GROUP BY i.id, i.min_stock
      HAVING COALESCE(SUM(b.current_quantity), 0) < i.min_stock
    `);

    // 3. Số đầu mục Sắp hết hạn (<60 ngày)
    const [nearExpireRows] = await pool.query(`
      SELECT COUNT(DISTINCT b.item_id) as count FROM batches b JOIN items i ON i.id=b.item_id 
      WHERE current_quantity > 0 AND DATEDIFF(expiry_date, CURDATE()) BETWEEN 1 AND ${alertDaysSQL}
    `);

    // 4. Số đầu mục Đã hết hạn (Khóa xuất)
    const [expiredRows] = await pool.query(`
      SELECT COUNT(DISTINCT b.item_id) as count FROM batches b JOIN items i ON i.id=b.item_id 
      WHERE current_quantity > 0 AND expiry_date <= CURDATE()
    `);

    // 5. Thống kê Nhập / Xuất hôm nay
    const [todayImportRows] = await pool.query(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount 
      FROM import_tickets WHERE DATE(created_at) = CURDATE()
    `);

    const [todayExportRows] = await pool.query(`
      SELECT COUNT(*) as count FROM export_tickets 
      WHERE DATE(created_at) = CURDATE() AND status = 'COMPLETED'
    `);

    // 6. Hoạt động nhật ký gần đây
    const [recentLogs] = await pool.query(`
      SELECT a.id, a.action, a.created_at, u.full_name, a.details
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.id DESC LIMIT 6
    `);

    return res.json({
      success: true,
      stats: {
        total_items: itemRows[0].total_items || 0,
        total_medicines: itemRows[0].total_medicines || 0,
        total_supplies: itemRows[0].total_supplies || 0,
        low_stock_count: lowStockRows.length || 0,
        near_expire_count: nearExpireRows[0].count || 0,
        expired_count: expiredRows[0].count || 0,
        today_imports: todayImportRows[0].count || 0,
        today_exports: todayExportRows[0].count || 0,
        recent_logs: recentLogs
      }
    });

  } catch (err) {
    console.error('[Dashboard Stats Error]:', err);
    return res.status(databaseErrorStatus(err)).json({ success: false, message: err.message });
  }
}

/**
 * Lấy dữ liệu Báo cáo Nhập-Xuất-Tồn (hỗ trợ lọc theo vị trí kho)
 */
async function reportRows(query) {
  const { from_date, to_date, category_id, location_id } = query;
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if ((from_date && !validDate(from_date)) || (to_date && !validDate(to_date)) || (from_date && to_date && from_date > to_date)) {
    const error = new Error('Khoảng ngày không hợp lệ (YYYY-MM-DD).'); error.status = 400; throw error;
  }
  const start = from_date || '1000-01-01';
  const end = to_date || '9999-12-30';
  // Reconstruct balances from current stock and all subsequent signed movements.
  // Opening stock without a transaction (legacy seed data) remains in the baseline.
  const [rows] = await pool.query(`
    SELECT b.batch_code, i.code AS item_code, i.name AS item_name, i.unit,
      l.code AS location_code, l.name AS location_name,
      DATE_FORMAT(b.expiry_date, '%d/%m/%Y') AS expiry_date, b.status, ${alertDaysSQL} AS expire_alert_days,
      DATEDIFF(b.expiry_date, CURDATE()) AS days_remaining,
      CASE WHEN b.created_at < ? THEN b.current_quantity - COALESCE(t.since_start, 0) ELSE 0 END AS opening_quantity,
      COALESCE(t.import_quantity, 0) AS import_quantity,
      COALESCE(t.export_quantity, 0) AS export_quantity,
      COALESCE(t.adjustment_quantity, 0) AS adjustment_quantity,
      b.current_quantity - COALESCE(t.after_end, 0) AS closing_quantity,
      b.current_quantity - COALESCE(t.after_end, 0) AS current_quantity
    FROM batches b
    JOIN items i ON i.id = b.item_id
    LEFT JOIN locations l ON l.id = b.location_id
    LEFT JOIN (
      SELECT batch_id,
        SUM(CASE WHEN created_at >= ? THEN quantity_change ELSE 0 END) AS since_start,
        SUM(CASE WHEN created_at >= DATE_ADD(?, INTERVAL 1 DAY) THEN quantity_change ELSE 0 END) AS after_end,
        SUM(CASE WHEN created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) AND type = 'IMPORT' THEN quantity_change ELSE 0 END) AS import_quantity,
        SUM(CASE WHEN created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) AND type = 'EXPORT' THEN -quantity_change ELSE 0 END) AS export_quantity,
        SUM(CASE WHEN created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) AND type IN ('ADJUST', 'CANCEL_EXPORT') THEN quantity_change ELSE 0 END) AS adjustment_quantity
      FROM inventory_transactions GROUP BY batch_id
    ) t ON t.batch_id = b.id
    WHERE b.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      AND (? IS NULL OR i.category_id = ?) AND (? IS NULL OR b.location_id = ?)
    ORDER BY i.name, b.expiry_date
  `, [start, start, end, start, end, start, end, start, end, end, category_id || null, category_id || null, location_id || null, location_id || null]);
  return rows.map(row => ({ ...row, is_expired: row.days_remaining <= 0, is_near_expire: row.days_remaining > 0 && row.days_remaining <= row.expire_alert_days }));
}

async function getInventoryReportData(req, res) {
  try { return res.json({ success: true, data: await reportRows(req.query) }); }
  catch (err) { return res.status(err.status || databaseErrorStatus(err)).json({ success: false, message: err.status ? err.message : 'Không thể tạo báo cáo.' }); }
}

async function exportExcelReport(req, res) {
  try {
    const data = await reportRows(req.query);
    const buffer = await generateInventoryReportExcel(data, req.query.from_date, req.query.to_date);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Bao_Cao_NXT.xlsx');
    return res.send(buffer);
  } catch (err) { return res.status(err.status || databaseErrorStatus(err)).json({ success: false, message: err.status ? err.message : 'Không thể xuất báo cáo.' }); }
}
module.exports = { getDashboardStats, getInventoryReportData, exportExcelReport };
