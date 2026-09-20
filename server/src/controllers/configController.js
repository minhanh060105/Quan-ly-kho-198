const { databaseErrorStatus } = require('../utils/databaseErrors');
const { pool } = require('../config/db');

async function getConfigs(req, res) {
  try {
    const [configs] = await pool.query('SELECT config_key, config_value, description FROM system_config');
    return res.json({ success: true, configs });
  } catch (err) {
    return res.status(databaseErrorStatus(err)).json({ success: false, message: err.message });
  }
}

async function updateConfig(req, res) {
  const { config_key, config_value } = req.body;
  try {
    await pool.query(
      'INSERT INTO system_config (config_key, config_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)',
      [config_key, config_value]
    );
    return res.json({ success: true, message: 'Cập nhật cấu hình thành công.' });
  } catch (err) {
    return res.status(databaseErrorStatus(err)).json({ success: false, message: err.message });
  }
}

module.exports = {
  getConfigs,
  updateConfig
};
