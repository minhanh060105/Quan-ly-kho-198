const { alertDaysSQL } = require('../utils/business');
const { databaseErrorStatus } = require('../utils/databaseErrors');
const { pool } = require('../config/db');
const { generateCode128Base64 } = require('../utils/barcode');

/**
 * Tra cứu thông tin Lô hàng theo Mã lô Code 128 khi người dùng quét máy vạch
 */
async function scanBatchBarcode(req, res) {
  const { code } = req.params; // Mã lô ví dụ: PA2401 hoặc BC-THPARA-01B

  if (!code) {
    return res.status(400).json({ success: false, message: 'Vui lòng cung cấp mã lô cần tra cứu.' });
  }

  // Chuẩn hóa mã quét (bỏ tiền tố BC- nếu có)
  const cleanCode = code.trim();

  try {
    const [rows] = await pool.query(`
      SELECT 
        b.id AS batch_id,
        b.batch_code,
        b.expiry_date,
        b.current_quantity,
        b.initial_quantity,
        b.import_price,
        b.supplier_name,
        b.status AS batch_status,
        b.created_at, (SELECT full_name FROM users WHERE id=b.created_by) AS creator_name,
        i.id AS item_id,
        i.code AS item_code,
        i.name AS item_name,
        i.unit,
        i.min_stock,
        ${alertDaysSQL} AS expire_alert_days,
        c.name AS category_name,
        l.code AS location_code,
        l.name AS location_name,
        DATEDIFF(b.expiry_date, CURDATE()) AS days_remaining
      FROM batches b
      JOIN items i ON b.item_id = i.id
      JOIN categories c ON i.category_id = c.id
      LEFT JOIN locations l ON b.location_id = l.id
      WHERE b.batch_code = ?
      LIMIT 1
    `, [cleanCode]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Không tìm thấy lô hàng nào có mã vạch [${code}]. Vui lòng kiểm tra lại.`
      });
    }

    const batch = rows[0];
    const barcodeImage = await generateCode128Base64(batch.batch_code);

    return res.json({
      success: true,
      batch: {
        ...batch,
        barcode_image: barcodeImage,
        is_expired: batch.days_remaining <= 0,
        is_near_expire: batch.days_remaining > 0 && batch.days_remaining <= (batch.expire_alert_days || 7)
      }
    });
  } catch (err) {
    console.error('[Scan Barcode Error]:', err);
    return res.status(databaseErrorStatus(err)).json({ success: false, message: 'Lỗi tra cứu mã vạch.' });
  }
}

/**
 * Tra cứu danh sách tồn kho theo bộ lọc (Vị trí, trạng thái hạn dùng, tìm kiếm)
 */
async function getInventory(req, res) {
  const { category_id, location_id, search, status } = req.query;

  try {
    let query = `
      SELECT 
        b.id AS batch_id,
        b.batch_code,
        b.expiry_date,
        b.current_quantity,
        b.import_price,
        b.supplier_name,
        b.status AS batch_status,
        b.created_at, (SELECT full_name FROM users WHERE id=b.created_by) AS creator_name,
        i.code AS item_code,
        i.name AS item_name,
        i.unit,
        i.min_stock,
        ${alertDaysSQL} AS expire_alert_days,
        c.name AS category_name,
        l.code AS location_code,
        l.name AS location_name,
        DATEDIFF(b.expiry_date, CURDATE()) AS days_remaining
      FROM batches b
      JOIN items i ON b.item_id = i.id
      JOIN categories c ON i.category_id = c.id
      LEFT JOIN locations l ON b.location_id = l.id
      WHERE 1=1 ${req.query.include_zero === 'true' ? '' : 'AND b.current_quantity > 0'}
    `;

    const params = [];

    if (category_id) {
      query += ` AND i.category_id = ?`;
      params.push(category_id);
    }

    if (location_id) {
      query += ` AND b.location_id = ?`;
      params.push(location_id);
    }

    if (search) {
      query += ` AND (b.batch_code LIKE ? OR i.name LIKE ? OR i.code LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (status === 'EXPIRED') {
      query += ` AND b.expiry_date <= CURDATE()`;
    } else if (status === 'NEAR') {
      query += ` AND DATEDIFF(b.expiry_date, CURDATE()) BETWEEN 1 AND ${alertDaysSQL}`;
    } else if (status === 'ACTIVE') {
      query += ` AND DATEDIFF(b.expiry_date, CURDATE()) > ${alertDaysSQL}`;
    }

    query += ` ORDER BY b.expiry_date ASC`;

    const [rows] = await pool.query(query, params);

    const items = rows.map(r => ({
      ...r,
      is_expired: r.days_remaining <= 0,
      is_near_expire: r.days_remaining > 0 && r.days_remaining <= (r.expire_alert_days || 7)
    }));

    return res.json({ success: true, count: items.length, inventory: items });
  } catch (err) {
    return res.status(databaseErrorStatus(err)).json({ success: false, message: err.message });
  }
}

module.exports = {
  scanBatchBarcode,
  getInventory
};
