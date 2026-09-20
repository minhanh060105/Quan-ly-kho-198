const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET phải được cấu hình ít nhất 32 ký tự.');

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      token_version: user.token_version || 0,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      permissions: typeof user.permissions === 'string' ? JSON.parse(user.permissions || '{}') : user.permissions
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

async function verifyToken(req, res, next) {
  const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
  let decoded;
  try { decoded = jwt.verify(token || '', JWT_SECRET); }
  catch { return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập lại.' }); }
  try {
    const [users] = await require('../config/db').pool.query('SELECT id, username, full_name, role, permissions, status, deleted_at, token_version FROM users WHERE id = ?', [decoded.id]);
    if (!users.length || users[0].status !== 'ACTIVE' || users[0].deleted_at || (decoded.token_version || 0) !== (users[0].token_version || 0)) return res.status(401).json({ success: false, message: 'Tài khoản không còn hoạt động.' });
    req.user = users[0];
    req.user.permissions = typeof req.user.permissions === 'string' ? JSON.parse(req.user.permissions) : (req.user.permissions || {});
    next();
  } catch (err) { next(err); }
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (req.user.role === 'ADMIN' || req.user.permissions?.[permission] === true) return next();
    return res.status(403).json({ success: false, message: 'Tài khoản không có quyền thực hiện thao tác này.' });
  };
}

function requireRole(roles = []) {
  return (req, res, next) => {
    if (!req.user || (!roles.includes(req.user.role) && req.user.role !== 'ADMIN')) {
      return res.status(403).json({ success: false, message: 'Tài khoản không có quyền thực hiện thao tác này.' });
    }
    next();
  };
}

module.exports = {
  JWT_SECRET,
  generateToken,
  verifyToken,
  requireRole,
  requirePermission
};
