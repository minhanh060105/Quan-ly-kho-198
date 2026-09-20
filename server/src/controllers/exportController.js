const { databaseErrorStatus } = require('../utils/databaseErrors');
const { randomUUID } = require('crypto');
const { validItems } = require('../utils/validation');
const { pool } = require('../config/db');

/**
 * Lập Phiếu Xuất Kho
 */
async function createExportTicket(req, res) {
  const { department_name, export_type, items, notes } = req.body;
  const userId = req.user ? req.user.id : 1;
  const idempotencyKey = req.idempotencyKey;

  if (!department_name || !validItems(items, 'quantity', 'batch_id', false)) {
    return res.status(400).json({ success: false, message: 'Thông tin đơn vị nhận và danh sách lô xuất không hợp lệ.' });
  }

  if (export_type && !['XUAT_KHOA','DIEU_CHUYEN','HUY'].includes(export_type)) return res.status(400).json({success:false,message:'Loại xuất không hợp lệ.'});
  const connection = req.connection;
  try {


    // 1. Sinh Mã Phiếu Xuất (PXYYYYMMDDXXX)
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq = randomUUID().replace(/-/g, '').slice(0, 20);
    const ticketCode = `PX${dateStr}${seq}`;

    // 2. Insert phiếu xuất
    const [ticketRes] = await connection.query(
      'INSERT INTO export_tickets (ticket_code, department_name, export_type, status, created_by, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [ticketCode, department_name, export_type || 'XUAT_KHOA', 'COMPLETED', userId, notes || '']
    );
    const ticketId = ticketRes.insertId;

    // 3. Trừ số lượng lô hàng tương ứng
    for (let i = 0; i < items.length; i++) {
      const item = items[i]; // { batch_id, batch_code, quantity }
      const exportQty = parseFloat(item.quantity);

      const [batchRows] = await connection.query(
        'SELECT id, current_quantity, batch_code, expiry_date, status FROM batches WHERE id = ? FOR UPDATE',
        [item.batch_id]
      );

      if (batchRows.length === 0) {
        throw new Error(`Không tìm thấy lô hàng ID: ${item.batch_id}`);
      }

      const batch = batchRows[0];
      if (batch.status === 'LOCKED') throw new Error('Lô hàng đang bị khóa.');
      const currentQty = parseFloat(batch.current_quantity);

      // Quy chế an toàn dược: Chặn xuất nếu lô đã hết hạn
      const expiryDate = new Date(batch.expiry_date);
      if (expiryDate <= new Date()) {
        throw new Error(`🚫 QUY CHẾ AN TOÀN DƯỢC: Lô [${batch.batch_code}] đã HẾT HẠN SỬ DỤNG. Khóa xuất kho khẩn cấp!`);
      }

      if (currentQty < exportQty) {
        throw new Error(`Lô [${batch.batch_code}] không đủ số lượng tồn (Hiện còn: ${currentQty}, Yêu cầu xuất: ${exportQty}).`);
      }

      const newBalance = currentQty - exportQty;

      // Cập nhật số lượng mới trong bảng batches
      await connection.query(
        'UPDATE batches SET current_quantity = ? WHERE id = ?',
        [newBalance, item.batch_id]
      );

      // Ghi chi tiết phiếu xuất
      await connection.query(
        'INSERT INTO export_ticket_details (ticket_id, batch_id, quantity) VALUES (?, ?, ?)',
        [ticketId, item.batch_id, exportQty]
      );

      // Ghi lịch sử giao dịch kho
      await connection.query(
        'INSERT INTO inventory_transactions (idempotency_key, batch_id, type, quantity_change, balance_after, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
        [idempotencyKey + '-' + i, item.batch_id, 'EXPORT', -exportQty, newBalance, userId]
      );
    }

    // Ghi Audit log
    await connection.query(
      'INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [userId, 'EXPORT_TICKET_CREATE', 'EXPORT_TICKET', String(ticketId), JSON.stringify({ ticket_code: ticketCode, department: department_name, items }), req.ip || '127.0.0.1']
    );



    return res.json({
      success: true,
      message: `Xuất kho thành công cho [${department_name}]. Mã phiếu: ${ticketCode}`,
      ticket: {
        id: ticketId,
        ticket_code: ticketCode,
        department_name
      }
    });
  } catch (err) {

    console.error('[Create Export Ticket Error]:', err);
    return res.status(databaseErrorStatus(err, 400)).json({ success: false, message: err.message });
  }
}

/**
 * Hủy Phiếu Xuất Kho & Tạo Phiếu Đảo (Reversal Voucher) trong 24h
 */
async function cancelExportTicket(req, res) {
  const { id } = req.params;
  const { cancel_reason } = req.body;
  const userId = req.user ? req.user.id : 1;
  const idempotencyKey = req.idempotencyKey;

  if (typeof cancel_reason !== 'string' || cancel_reason.trim() === '') {
    return res.status(400).json({ success: false, message: 'Bắt buộc nhập lý do hủy phiếu xuất kho.' });
  }

  const connection = req.connection;
  try {


    // 1. Kiểm tra phiếu xuất
    const [ticketRows] = await connection.query(
      'SELECT id, ticket_code, status, created_at, TIMESTAMPDIFF(SECOND, created_at, NOW()) / 3600 as hours_passed FROM export_tickets WHERE id = ? FOR UPDATE',
      [id]
    );

    if (ticketRows.length === 0) {
      throw new Error('Không tìm thấy phiếu xuất kho cần hủy.');
    }

    const ticket = ticketRows[0];

    if (ticket.status === 'CANCELLED') {
      throw new Error('Phiếu xuất này đã được hủy trước đó.');
    }

    // Kiểm tra giới hạn 24h quy định hủy phiếu
    const [[config]] = await connection.query("SELECT config_value FROM system_config WHERE config_key='CANCEL_EXPORT_LIMIT_HOURS'");
    const limitHours = Number(config?.config_value || 24);
    if (ticket.hours_passed > limitHours) {
      throw new Error(`Đã quá thời hạn ${limitHours}h cho phép hủy phiếu xuất (Phiếu lập cách đây ${ticket.hours_passed} giờ).`);
    }

    // Sinh Mã Phiếu Đảo (Reversal Voucher: REV-PX...)
    const reversalCode = `REV-${ticket.ticket_code}`;

    // 2. Lấy danh sách chi tiết lô của phiếu xuất
    const [details] = await connection.query(
      'SELECT batch_id, quantity FROM export_ticket_details WHERE ticket_id = ?',
      [id]
    );

    // 3. Hoàn trả lại số lượng cho từng Lô
    for (let i = 0; i < details.length; i++) {
      const det = details[i];
      const returnQty = parseFloat(det.quantity);

      const [batchRows] = await connection.query(
        'SELECT id, current_quantity FROM batches WHERE id = ? FOR UPDATE',
        [det.batch_id]
      );

      if (batchRows.length > 0) {
        const batch = batchRows[0];
        const newBalance = parseFloat(batch.current_quantity) + returnQty;

        await connection.query(
          'UPDATE batches SET current_quantity = ? WHERE id = ?',
          [newBalance, det.batch_id]
        );

        // Ghi log giao dịch kho đảo
        await connection.query(
          'INSERT INTO inventory_transactions (idempotency_key, batch_id, type, quantity_change, balance_after, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
          [idempotencyKey + '-reversal-' + i, det.batch_id, 'CANCEL_EXPORT', returnQty, newBalance, userId]
        );
      }
    }

    // 4. Cập nhật phiếu xuất gốc với Mã phiếu đảo
    await connection.query(
      'UPDATE export_tickets SET status = "CANCELLED", reversal_ticket_code = ?, cancelled_by = ?, cancelled_at = NOW(), cancel_reason = ? WHERE id = ?',
      [reversalCode, userId, cancel_reason, id]
    );

    // Ghi audit log
    await connection.query(
      'INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [userId, 'EXPORT_TICKET_CANCEL', 'EXPORT_TICKET', String(id), JSON.stringify({ ticket_code: ticket.ticket_code, reversal_code: reversalCode, reason: cancel_reason }), req.ip || '127.0.0.1']
    );



    return res.json({
      success: true,
      message: `Đã hủy thành công phiếu xuất [${ticket.ticket_code}]. Hệ thống đã phát hành Phiếu Đảo [${reversalCode}] và tự động hoàn tồn kho.`,
      reversal_code: reversalCode
    });

  } catch (err) {

    return res.status(databaseErrorStatus(err, 400)).json({ success: false, message: err.message });
  }
}

/**
 * Lấy danh sách phiếu giao dịch
 */
async function getTickets(req, res) {
  try {
    const [exports] = await pool.query(`
      SELECT 
        e.id,
        e.ticket_code,
        e.reversal_ticket_code,
        e.department_name,
        e.export_type,
        e.status,
        e.cancel_reason,
        e.created_at,
        u.full_name AS creator_name,
        TIMESTAMPDIFF(HOUR, e.created_at, NOW()) AS hours_passed
      FROM export_tickets e
      JOIN users u ON e.created_by = u.id
      ORDER BY e.id DESC
      LIMIT 100
    `);

    return res.json({ success: true, exports });
  } catch (err) {
    return res.status(databaseErrorStatus(err)).json({ success: false, message: err.message });
  }
}

module.exports = {
  createExportTicket,
  cancelExportTicket,
  getTickets
};
