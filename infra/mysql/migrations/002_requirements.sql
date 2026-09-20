USE visinh_db;
-- Run once, before starting the new backend. Preserve users and historical links.
ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL, ADD COLUMN token_version INT NOT NULL DEFAULT 0;
ALTER TABLE items MODIFY min_stock DECIMAL(12,3) NOT NULL DEFAULT 10,
                  MODIFY expire_alert_days INT NULL DEFAULT NULL;
-- The old default 60 becomes inherited configuration; other explicit values remain.
UPDATE items SET expire_alert_days=NULL WHERE expire_alert_days=60;
INSERT INTO system_config(config_key,config_value,description) VALUES
 ('DEFAULT_EXPIRE_ALERT_DAYS','7','Ngưỡng cảnh báo hạn dùng mặc định'),
 ('CANCEL_EXPORT_LIMIT_HOURS','24','Thời hạn hủy phiếu xuất (giờ)')
ON DUPLICATE KEY UPDATE config_value=IF(config_key='DEFAULT_EXPIRE_ALERT_DAYS' AND config_value='60','7',config_value);
