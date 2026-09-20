-- ==============================================================================
-- DATABASE SCHEMA: Hệ thống Quản lý Kho - Khoa Vi sinh, Bệnh viện 198
-- Hỗ trợ lưu trữ 10 năm với Range Partitioning theo NĂM (YEAR(created_at))
-- Cập nhật: Vị trí kho, Kiểm kê kho & Xử lý xung đột, Phiếu đảo (Reversal Voucher)
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS `visinh_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `visinh_db`;

-- 1. Bảng Tài khoản Người dùng
CREATE TABLE IF NOT EXISTS `users` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `username` VARCHAR(50) NOT NULL UNIQUE,
    `password_hash` VARCHAR(255) NOT NULL,
    `full_name` VARCHAR(100) NOT NULL,
    `role` ENUM('ADMIN', 'MANAGER', 'STAFF') NOT NULL DEFAULT 'STAFF',
    `status` ENUM('ACTIVE', 'LOCKED') NOT NULL DEFAULT 'ACTIVE',
    `deleted_at` DATETIME NULL,
    `token_version` INT NOT NULL DEFAULT 0,
    `permissions` JSON NULL COMMENT 'Quyền chi tiết: {can_import: true, can_export: true}',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Bảng Vị trí Kho (Locations: KHO-A1, KHO-B1, KHO-TL...)
CREATE TABLE IF NOT EXISTS `locations` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(30) NOT NULL UNIQUE COMMENT 'VD: KHO-A1, KHO-B1, KHO-TL',
    `name` VARCHAR(100) NOT NULL COMMENT 'Tên vị trí tủ/kệ',
    `temp_range` VARCHAR(50) NULL COMMENT 'Dải nhiệt độ bảo quản, e.g. 2-8 C, -20 C',
    `description` VARCHAR(255) NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Bảng Danh mục Hóa chất / Vật tư
CREATE TABLE IF NOT EXISTS `categories` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(20) NOT NULL UNIQUE,
    `name` VARCHAR(100) NOT NULL,
    `type` ENUM('HOA_CHAT', 'VAT_TU', 'DUNG_CU') NOT NULL DEFAULT 'HOA_CHAT',
    `description` TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Bảng Mặt hàng (Vật tư/Hóa chất)
CREATE TABLE IF NOT EXISTS `items` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `category_id` INT NOT NULL,
    `code` VARCHAR(50) NOT NULL UNIQUE,
    `name` VARCHAR(200) NOT NULL,
    `unit` VARCHAR(20) NOT NULL COMMENT 'Hộp, Lọ, Chai, Test, Bộ...',
    `min_stock` DECIMAL(12,3) NOT NULL DEFAULT 10 COMMENT 'Ngưỡng tồn tối thiểu cảnh báo',
    `expire_alert_days` INT NULL DEFAULT NULL COMMENT 'NULL dùng ngưỡng hệ thống mặc định 7 ngày',
    `storage_condition` VARCHAR(100) NULL COMMENT 'Độ C, bảo quản lạnh...',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_items_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Bảng Lô hàng (Batches - Quản lý theo mã lô Code 128 & Vị trí kho)
CREATE TABLE IF NOT EXISTS `batches` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `batch_code` VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã lô duy nhất in ra tem Code 128 (VD: LO20260904001)',
    `item_id` INT NOT NULL,
    `location_id` INT NULL COMMENT 'Vị trí lưu kho (KHO-A1, KHO-B1...)',
    `expiry_date` DATE NOT NULL,
    `initial_quantity` DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
    `current_quantity` DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
    `import_price` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `supplier_name` VARCHAR(150) NULL,
    `status` ENUM('ACTIVE', 'EXPIRED', 'LOCKED') NOT NULL DEFAULT 'ACTIVE',
    `created_by` INT NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_batch_code` (`batch_code`),
    INDEX `idx_expiry_date` (`expiry_date`),
    CONSTRAINT `fk_batches_item` FOREIGN KEY (`item_id`) REFERENCES `items` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_batches_location` FOREIGN KEY (`location_id`) REFERENCES `locations` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_batches_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Bảng Phiếu nhập kho
CREATE TABLE IF NOT EXISTS `import_tickets` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `ticket_code` VARCHAR(50) NOT NULL UNIQUE COMMENT 'VD: PN20260915001',
    `supplier_name` VARCHAR(150) NULL,
    `import_type` ENUM('PHAT_SINH', 'DAU_KY') NOT NULL DEFAULT 'PHAT_SINH',
    `import_date` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `total_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `created_by` INT NOT NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_import_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Chi tiết Phiếu nhập (hỗ trợ phân biệt số lượng nhập & số tem in Code 128)
CREATE TABLE IF NOT EXISTS `import_ticket_details` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `ticket_id` INT NOT NULL,
    `batch_id` INT NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL COMMENT 'Số lượng nhập thực tế',
    `label_print_count` INT NOT NULL DEFAULT 1 COMMENT 'Số tem nhãn Code 128 cần in',
    `unit_price` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    CONSTRAINT `fk_import_detail_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `import_tickets` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_import_detail_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Bảng Phiếu xuất kho & Phiếu đảo (Reversal Voucher)
CREATE TABLE IF NOT EXISTS `export_tickets` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `ticket_code` VARCHAR(50) NOT NULL UNIQUE COMMENT 'VD: PX20260915001',
    `reversal_ticket_code` VARCHAR(50) NULL COMMENT 'Mã phiếu đảo khi hủy (VD: REV-PX20260915001)',
    `department_name` VARCHAR(150) NOT NULL COMMENT 'Tên khoa nhận (e.g. Khoa Cấp cứu A9, Phòng XN1...)',
    `export_type` ENUM('XUAT_KHOA', 'DIEU_CHUYEN', 'HUY') NOT NULL DEFAULT 'XUAT_KHOA',
    `status` ENUM('COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'COMPLETED',
    `created_by` INT NOT NULL,
    `cancelled_by` INT NULL,
    `cancelled_at` DATETIME NULL,
    `cancel_reason` TEXT NULL COMMENT 'Bắt buộc nhập lý do khi hủy phiếu',
    `notes` TEXT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_export_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
    CONSTRAINT `fk_export_cancel_user` FOREIGN KEY (`cancelled_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Chi tiết Phiếu xuất
CREATE TABLE IF NOT EXISTS `export_ticket_details` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `ticket_id` INT NOT NULL,
    `batch_id` INT NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL,
    CONSTRAINT `fk_export_detail_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `export_tickets` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_export_detail_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Bảng Phiếu kiểm kê & Xử lý xung đột số đếm (`stocktakes`)
CREATE TABLE IF NOT EXISTS `stocktakes` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `ticket_code` VARCHAR(50) NOT NULL UNIQUE COMMENT 'VD: KK20260919001',
    `location_id` INT NULL COMMENT 'Lọc theo vị trí kho kiểm kê',
    `status` ENUM('DRAFT', 'ADJUSTED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `created_by` INT NOT NULL,
    `adjusted_by` INT NULL,
    `adjusted_at` DATETIME NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_stocktake_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
    CONSTRAINT `fk_stocktake_location` FOREIGN KEY (`location_id`) REFERENCES `locations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Chi tiết Phiếu kiểm kê & Xử lý xung đột
CREATE TABLE IF NOT EXISTS `stocktake_details` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `stocktake_id` INT NOT NULL,
    `batch_id` INT NOT NULL,
    `book_quantity` DECIMAL(12, 3) NOT NULL COMMENT 'Số lượng trên sổ sách',
    `actual_quantity` DECIMAL(12, 3) NOT NULL COMMENT 'Số lượng đếm thực tế',
    `difference` DECIMAL(12, 3) NOT NULL COMMENT 'Chênh lệch = Actual - Book',
    `reason` VARCHAR(255) NULL COMMENT 'Lý do chênh lệch (Hao hụt tự nhiên, Đổ vỡ, Nhầm lẫn...)',
    CONSTRAINT `fk_stocktake_detail_ticket` FOREIGN KEY (`stocktake_id`) REFERENCES `stocktakes` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_stocktake_detail_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Bảng Giao dịch Kho (Inventory Transactions) - PARTITIONED theo YEAR(created_at) cho 10 năm
CREATE TABLE IF NOT EXISTS `inventory_transactions` (
    `id` BIGINT AUTO_INCREMENT,
    `idempotency_key` VARCHAR(64) NOT NULL,
    `batch_id` INT NOT NULL,
    `type` ENUM('IMPORT', 'EXPORT', 'CANCEL_EXPORT', 'ADJUST') NOT NULL,
    `quantity_change` DECIMAL(12, 3) NOT NULL,
    `balance_after` DECIMAL(12, 3) NOT NULL,
    `created_by` INT NOT NULL,
    `created_at` DATETIME NOT NULL,
    PRIMARY KEY (`id`, `created_at`),
    UNIQUE KEY `idx_idempotency_created` (`idempotency_key`, `created_at`),
    INDEX `idx_batch_trans` (`batch_id`),
    INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`created_at`)) (
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p2026 VALUES LESS THAN (2027),
    PARTITION p2027 VALUES LESS THAN (2028),
    PARTITION p2028 VALUES LESS THAN (2029),
    PARTITION p2029 VALUES LESS THAN (2030),
    PARTITION p2030 VALUES LESS THAN (2031),
    PARTITION p2031 VALUES LESS THAN (2032),
    PARTITION p2032 VALUES LESS THAN (2033),
    PARTITION p2033 VALUES LESS THAN (2034),
    PARTITION p2034 VALUES LESS THAN (2035),
    PARTITION p2035 VALUES LESS THAN (2036),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- 13. Bảng Nhật ký Hệ thống (Audit Logs) - PARTITIONED theo YEAR(created_at)
CREATE TABLE IF NOT EXISTS `audit_logs` (
    `id` BIGINT AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `action` VARCHAR(100) NOT NULL,
    `target_type` VARCHAR(50) NULL,
    `target_id` VARCHAR(50) NULL,
    `details` JSON NULL,
    `ip_address` VARCHAR(45) NULL,
    `created_at` DATETIME NOT NULL,
    PRIMARY KEY (`id`, `created_at`),
    INDEX `idx_user_audit` (`user_id`),
    INDEX `idx_action_audit` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`created_at`)) (
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p2026 VALUES LESS THAN (2027),
    PARTITION p2027 VALUES LESS THAN (2028),
    PARTITION p2028 VALUES LESS THAN (2029),
    PARTITION p2029 VALUES LESS THAN (2030),
    PARTITION p2030 VALUES LESS THAN (2031),
    PARTITION p2031 VALUES LESS THAN (2032),
    PARTITION p2032 VALUES LESS THAN (2033),
    PARTITION p2033 VALUES LESS THAN (2034),
    PARTITION p2034 VALUES LESS THAN (2035),
    PARTITION p2035 VALUES LESS THAN (2036),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- 14. Bảng Cấu hình Hệ thống
CREATE TABLE IF NOT EXISTS `system_config` (
    `config_key` VARCHAR(50) PRIMARY KEY,
    `config_value` VARCHAR(255) NOT NULL,
    `description` VARCHAR(255) NULL,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_requests (
  request_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  fingerprint CHAR(64) NOT NULL,
  response_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT IGNORE INTO system_config(config_key,config_value) VALUES ('DEFAULT_EXPIRE_ALERT_DAYS','7'),('CANCEL_EXPORT_LIMIT_HOURS','24');
