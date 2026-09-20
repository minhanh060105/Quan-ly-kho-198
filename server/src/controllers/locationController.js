const { databaseErrorStatus } = require('../utils/databaseErrors');
const { pool } = require('../config/db');

/**
 * Lấy danh sách Vị trí kho (KHO-A1, KHO-B1, KHO-TL...)
 */
async function getLocations(req, res) {
  try {
    const [locations] = await pool.query(
      'SELECT id, code, name, temp_range, description FROM locations ORDER BY code ASC'
    );
    return res.json({ success: true, locations });
  } catch (err) {
    return res.status(databaseErrorStatus(err)).json({ success: false, message: err.message });
  }
}

async function createLocation(req, res) {
  const { code, name, temp_range, description } = req.body;
  if (!code || !name) {
    return res.status(400).json({ success: false, message: 'Mã vị trí và tên vị trí kho không được để trống.' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO locations (code, name, temp_range, description) VALUES (?, ?, ?, ?)',
      [code.toUpperCase(), name, temp_range || '', description || '']
    );
    return res.json({ success: true, id: result.insertId, message: 'Thêm vị trí kho thành công.' });
  } catch (err) {
    return res.status(databaseErrorStatus(err)).json({ success: false, message: err.message });
  }
}

module.exports = {
  getLocations,
  createLocation
};
