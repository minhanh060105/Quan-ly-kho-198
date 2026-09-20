const { databaseErrorStatus } = require('../utils/databaseErrors');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { generateToken } = require('../middleware/auth');

async function login(req, res) {
  const { username, password } = req.body;

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password || username.length>50 || password.length>200) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập tài khoản và mật khẩu.' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ? AND deleted_at IS NULL', [username]);

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Tài khoản hoặc mật khẩu không chính xác.' });
    }

    const user = rows[0];

    if (user.status === 'LOCKED') {
      return res.status(403).json({ success: false, message: 'Tài khoản của bạn đã bị khóa bởi Quản trị viên.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Tài khoản hoặc mật khẩu không chính xác.' });
    }

    const token = generateToken(user);

    // Ghi Audit log
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [user.id, 'LOGIN', 'USER', String(user.id), JSON.stringify({ username: user.username }), req.ip || '127.0.0.1']
    );

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        permissions: typeof user.permissions === 'string' ? JSON.parse(user.permissions || '{}') : user.permissions
      }
    });
  } catch (err) {
    console.error('[Login Error]:', err);
    return res.status(databaseErrorStatus(err)).json({ success: false, message: 'Lỗi máy chủ nội bộ.' });
  }
}

async function getUsers(req, res) {
  try {
    const [users] = await pool.query(
      'SELECT id, username, full_name, role, status, permissions, created_at FROM users ORDER BY id DESC'
    );
    return res.json({ success: true, users });
  } catch (err) {
    return res.status(databaseErrorStatus(err)).json({ success: false, message: err.message });
  }
}

async function toggleLockUser(req, res) {
  const { id } = req.params;
  try {
    const [rows] = await pool.query('SELECT status FROM users WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản.' });

    const newStatus = rows[0].status === 'ACTIVE' ? 'LOCKED' : 'ACTIVE';
    await pool.query('UPDATE users SET status = ? WHERE id = ?', [newStatus, id]);

    return res.json({ success: true, message: `Đã ${newStatus === 'LOCKED' ? 'khóa' : 'mở khóa'} tài khoản thành công.`, status: newStatus });
  } catch (err) {
    return res.status(databaseErrorStatus(err)).json({ success: false, message: err.message });
  }
}

module.exports = {
  login,
  getUsers,
  toggleLockUser
};
