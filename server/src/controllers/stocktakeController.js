const { databaseErrorStatus } = require('../utils/databaseErrors');
const { randomUUID } = require('crypto');
const { validItems } = require('../utils/validation');
const { pool } = require('../config/db');

/**
 * Lập Phiếu Kiểm Kê Kho & Xử lý Xung đột Số đếm
 */
async function createStocktake(req, res) {
  const { location_id, items, notes } = req.body;
  const userId = req.user ? req.user.id : 1;

  if (!validItems(items, 'actual_quantity', 'batch_id', true)) {
    return res.status(400).json({ success: false, message: 'Danh sách lô hàng kiểm kê không được để trống.' });
  }

  const connection = req.connection;
  try {


    // 1. Sinh Mã Phiếu Kiểm Kê (KKYYYYMMDDXXX)
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq = randomUUID().replace(/-/g, '').slice(0, 20);
    const ticketCode = `KK${dateStr}${seq}`;

    // 2. Insert phiếu kiểm kê (Trạng thái DRAFT)
    const [ticketRes] = await connection.query(
      'INSERT INTO stocktakes (ticket_code, location_id, status, created_by, notes, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [ticketCode, location_id || null, 'DRAFT', userId, notes || '']
    );
    const stocktakeId = ticketRes.insertId;

    // 3. Duyệt qua từng chi tiết kiểm kê
    for (let i = 0; i < items.length; i++) {
      const item = items[i]; // { batch_id, actual_quantity, reason }

      const [batchRows] = await connection.query(
        'SELECT id, current_quantity FROM batches WHERE id = ? FOR UPDATE',
        [item.batch_id]
      );

      if (batchRows.length === 0) throw new Error('Không tìm thấy lô kiểm kê.');

      const bookQty = parseFloat(batchRows[0].current_quantity);
      const actualQty = parseFloat(item.actual_quantity);
      const diff = actualQty - bookQty;

      await connection.query(
        'INSERT INTO stocktake_details (stocktake_id, batch_id, book_quantity, actual_quantity, difference, reason) VALUES (?, ?, ?, ?, ?, ?)',
        [stocktakeId, item.batch_id, bookQty, actualQty, diff, item.reason || '']
      );
    }

    // Ghi Audit log
    await connection.query(
      'INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [userId, 'STOCKTAKE_CREATE', 'STOCKTAKE', String(stocktakeId), JSON.stringify({ ticket_code: ticketCode }), req.ip || '127.0.0.1']
    );



    return res.json({
      success: true,
      message: `Đã khởi tạo Phiếu kiểm kê [${ticketCode}]. Vui lòng kiểm tra chênh lệch và bấm Xác nhận điều chỉnh số liệu.`,
      stocktake_id: stocktakeId,
      ticket_code: ticketCode
    });

  } catch (err) {

    console.error('[Create Stocktake Error]:', err);
    return res.status(databaseErrorStatus(err)).json({ success: false, message: err.message });
  }
}

/**
 * Xác nhận Xử lý Xung đột Số đếm & Cân bằng Tồn kho
 */
async function adjustStocktake(req, res) {
  const { id } = req.params;
  const userId = req.user ? req.user.id : 1;
  const idempotencyKey = req.idempotencyKey;

  const connection = req.connection;
  try {


    const [stocktakeRows] = await connection.query(
      'SELECT id, ticket_code, status FROM stocktakes WHERE id = ? FOR UPDATE',
      [id]
    );

    if (stocktakeRows.length === 0) {
      throw new Error('Không tìm thấy phiếu kiểm kê.');
    }

    const stocktake = stocktakeRows[0];
    if (stocktake.status === 'ADJUSTED') {
      throw new Error('Phiếu kiểm kê này đã được xử lý cân bằng số liệu trước đó.');
    }

    const [details] = await connection.query(
      'SELECT batch_id, book_quantity, actual_quantity, difference, reason FROM stocktake_details WHERE stocktake_id = ?',
      [id]
    );

    // Cập nhật tồn kho thực tế cho từng Lô và ghi log giao dịch ADJUSTMENT
    for (let i = 0; i < details.length; i++) {
      const det = details[i];
      const [current] = await connection.query('SELECT current_quantity FROM batches WHERE id = ? FOR UPDATE', [det.batch_id]);
      if (!current.length || Number(current[0].current_quantity) !== Number(det.book_quantity)) {
        return res.status(409).json({ success: false, message: 'Tồn kho đã thay đổi sau khi lập phiếu. Vui lòng kiểm kê lại.' });
      }
      const diff = parseFloat(det.difference);

      if (diff !== 0) {
        await connection.query(
          'UPDATE batches SET current_quantity = ? WHERE id = ?',
          [det.actual_quantity, det.batch_id]
        );

        await connection.query(
          'INSERT INTO inventory_transactions (idempotency_key, batch_id, type, quantity_change, balance_after, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
          [idempotencyKey + '-adj-' + i, det.batch_id, 'ADJUST', diff, det.actual_quantity, userId]
        );
      }
    }

    await connection.query(
      'UPDATE stocktakes SET status = "ADJUSTED", adjusted_by = ?, adjusted_at = NOW() WHERE id = ?',
      [userId, id]
    );

    await connection.query(
      'INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [userId, 'STOCKTAKE_ADJUST', 'STOCKTAKE', String(id), JSON.stringify({ ticket_code: stocktake.ticket_code }), req.ip || '127.0.0.1']
    );



    return res.json({
      success: true,
      message: `Đã xử lý xung đột số đếm và phát hành Phiếu điều chỉnh cân bằng tồn kho cho [${stocktake.ticket_code}].`
    });

  } catch (err) {

    return res.status(databaseErrorStatus(err, 400)).json({ success: false, message: err.message });
  }
}

/**
 * Lấy danh sách phiếu kiểm kê
 */
async function getStocktakes(req, res) {
  try {
    const [stocktakes] = await pool.query(`
      SELECT 
        s.id,
        s.ticket_code,
        l.name AS location_name,
        s.status,
        s.created_at,
        u.full_name AS creator_name
      FROM stocktakes s
      LEFT JOIN locations l ON s.location_id = l.id
      JOIN users u ON s.created_by = u.id
      ORDER BY s.id DESC
      LIMIT 100
    `);

    return res.json({ success: true, stocktakes });
  } catch (err) {
    return res.status(databaseErrorStatus(err)).json({ success: false, message: err.message });
  }
}

module.exports = {
  createStocktake,
  adjustStocktake,
  getStocktakes
};
