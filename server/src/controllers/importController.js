const { databaseErrorStatus } = require('../utils/databaseErrors');
const { randomUUID } = require('crypto');
const { quantity } = require('../utils/validation');
const { pool } = require('../config/db');
const { generateCode128Base64 } = require('../utils/barcode');

/**
 * Lập Phiếu Nhập Kho (Import Ticket)
 * Tự động tạo mã Lô Code 128 duy nhất (VD: LO20260915001)
 */
async function createImportTicket(req, res) {
  const { supplier_name, items, notes } = req.body;
  const userId = req.user ? req.user.id : 1;
  const idempotencyKey = req.idempotencyKey;

  if (!Array.isArray(items) || items.length === 0 || items.length > 500 || !items.every(it => it && Number.isInteger(it.item_id) && it.item_id > 0 && quantity(it.quantity) && (it.label_print_count == null || (Number.isInteger(it.label_print_count) && it.label_print_count >= 1 && it.label_print_count <= 200)) && (!it.batch_code || /^[A-Za-z0-9._-]{1,50}$/.test(it.batch_code)) && quantity(it.unit_price ?? 0, true) && /^\d{4}-\d{2}-\d{2}$/.test(it.expiry_date) && !Number.isNaN(Date.parse(it.expiry_date)) && new Date(it.expiry_date).toISOString().slice(0, 10) === it.expiry_date)) {
    return res.status(400).json({ success: false, message: 'Danh sách vật tư nhập kho không được để trống.' });
  }

  const connection = req.connection;
  try {


    // 1. Sinh Mã Phiếu Nhập (PNYYYYMMDDXXX)
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq = randomUUID().replace(/-/g, '').slice(0, 20);
    const ticketCode = `PN${dateStr}${seq}`;

    // 2. Tính tổng tiền
    let totalAmount = 0;
    items.forEach(it => {
      totalAmount += (it.quantity || 0) * (it.unit_price || 0);
    });

    // 3. Insert phiếu nhập
    const [ticketRes] = await connection.query(
      'INSERT INTO import_tickets (ticket_code, supplier_name, total_amount, created_by, notes, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [ticketCode, supplier_name || 'Nhà cung cấp', totalAmount, userId, notes || '']
    );
    const ticketId = ticketRes.insertId;

    const createdBatches = [];

    // 4. Duyệt qua từng mặt hàng nhập để sinh Lô hàng & mã vạch
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      // Mã lô tự sinh nếu không nhập tay: LOYYYYMMDDseq
      const batchSeq = String(i + 1).padStart(3, '0');
      const batchCode = item.batch_code || `LO${dateStr}${seq}${batchSeq}`;

      const [batchRes] = await connection.query(
        'INSERT INTO batches (batch_code, item_id, location_id, expiry_date, initial_quantity, current_quantity, import_price, supplier_name, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [
          batchCode,
          item.item_id,
          item.location_id || null,
          item.expiry_date,
          item.quantity,
          item.quantity, // Ban đầu tồn = initial
          item.unit_price || 0,
          supplier_name || '',
          userId
        ]
      );
      const batchId = batchRes.insertId;

      // Lưu chi tiết phiếu nhập
      await connection.query(
        'INSERT INTO import_ticket_details (ticket_id, batch_id, quantity, unit_price, label_print_count) VALUES (?, ?, ?, ?, ?)',
        [ticketId, batchId, item.quantity, item.unit_price || 0, item.label_print_count || 1]
      );

      // Ghi nhật ký giao dịch kho (Inventory Transaction)
      await connection.query(
        'INSERT INTO inventory_transactions (idempotency_key, batch_id, type, quantity_change, balance_after, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
        [idempotencyKey + '-' + i, batchId, 'IMPORT', item.quantity, item.quantity, userId]
      );

      // Sinh ảnh mã vạch Base64 Code 128
      const barcodeBase64 = await generateCode128Base64(batchCode);

      createdBatches.push({
        batch_id: batchId,
        batch_code: batchCode,
        quantity: item.quantity,
        expiry_date: item.expiry_date,
        label_print_count: item.label_print_count || 1,
        barcode_image: barcodeBase64
      });
    }

    // Ghi Audit log
    await connection.query(
      'INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [userId, 'IMPORT_TICKET_CREATE', 'IMPORT_TICKET', String(ticketId), JSON.stringify({ ticket_code: ticketCode, total_items: items.length, items }), req.ip || '127.0.0.1']
    );



    return res.json({
      success: true,
      message: 'Nhập kho thành công. Đã tự động tạo mã tem Code 128 cho từng lô.',
      ticket: {
        id: ticketId,
        ticket_code: ticketCode,
        total_amount: totalAmount,
        batches: createdBatches
      }
    });

  } catch (err) {

    console.error('[Create Import Ticket Error]:', err);
    return res.status(databaseErrorStatus(err)).json({ success: false, message: 'Lỗi lập phiếu nhập kho: ' + err.message });
  }
}

module.exports = {
  createImportTicket
};
