-- ==============================================================================
-- DỮ LIỆU MẪU BAN ĐẦU - KHOA KHI/VI SINH/CẤP CỨU A9 BỆNH VIỆN 198
-- Dữ liệu chuẩn theo thiết kế Clinical Density System (Không dùng Emoji/Sticker)
-- ==============================================================================

USE `visinh_db`;

-- 1. Thêm Cấu hình Hệ thống Mặc định
INSERT INTO `system_config` (`config_key`, `config_value`, `description`) VALUES
('CANCEL_EXPORT_LIMIT_HOURS', '24', 'Thời gian tối đa (giờ) cho phép hủy phiếu xuất kho'),
('DEFAULT_EXPIRE_ALERT_DAYS', '7', 'Số ngày mặc định báo động sắp hết hạn lô hàng (≤7 ngày)'),
('HOSPITAL_NAME', 'Bệnh viện 198 - Bộ Công an', 'Tên đơn vị chủ quản'),
('DEPARTMENT_NAME', 'Khoa Cấp cứu A9 - Dược & VTYT', 'Tên khoa quản lý kho')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

-- 2. Tài khoản Mặc định (Mật khẩu mặc định: '123456')
INSERT INTO `users` (`username`, `password_hash`, `full_name`, `role`, `status`, `permissions`) VALUES
('admin', '$2a$10$BsE1MwlDVZ/W8IH0Gy/6VezuS8eUeBeFBIyxZqFEOkD6G540pFZwm', 'DS. Nguyễn Văn An', 'ADMIN', 'ACTIVE', '{"can_import": true, "can_export": true, "can_manage_users": true}'),
('manager', '$2a$10$BsE1MwlDVZ/W8IH0Gy/6VezuS8eUeBeFBIyxZqFEOkD6G540pFZwm', 'Trưởng khoa Dược & VTYT', 'MANAGER', 'ACTIVE', '{"can_import": true, "can_export": true, "can_manage_users": false}'),
('staff1', '$2a$10$BsE1MwlDVZ/W8IH0Gy/6VezuS8eUeBeFBIyxZqFEOkD6G540pFZwm', 'ĐĐ. Trần Thị Bình', 'STAFF', 'ACTIVE', '{"can_import": true, "can_export": true}')
ON DUPLICATE KEY UPDATE `full_name` = VALUES(`full_name`);

-- 3. Danh mục Vị trí Kho (Locations)
INSERT INTO `locations` (`id`, `code`, `name`, `temp_range`, `description`) VALUES
(1, 'KHO-A1', 'Kệ A1', 'Nhiệt độ phòng', 'Kệ lưu trữ găng tay, bơm tiêm, vật tư y tế'),
(2, 'KHO-B1', 'Kệ B1', 'Nhiệt độ phòng', 'Kệ bảo quản các loại Thuốc viên, Paracetamol'),
(3, 'KHO-TL', 'Tủ lạnh 2-8°C (Tủ lưu)', '2 - 8°C', 'Bảo quản dịch truyền NaCl, sinh phẩm và tủ biệt trữ')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- 4. Danh mục Hóa chất, Thuốc & Vật tư
INSERT INTO `categories` (`id`, `code`, `name`, `type`, `description`) VALUES
(1, 'THUOC', 'Thuốc & Dung dịch truyền nội trú', 'HOA_CHAT', 'Các loại thuốc cấp cứu, dịch truyền'),
(2, 'VAT_TU', 'Vật tư Y tế Tiêu hao', 'VAT_TU', 'Găng tay, bơm tiêm, gạc phẫu thuật vô trùng')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- 5. Mặt hàng mẫu
INSERT INTO `items` (`id`, `category_id`, `code`, `name`, `unit`, `min_stock`, `expire_alert_days`, `storage_condition`) VALUES
(1, 1, 'TH-PARA-500', 'Paracetamol 500mg', 'Viên', 50.000, NULL, 'Nhiệt độ phòng'),
(2, 2, 'VT-GTYT-01', 'Găng tay y tế không bột size M', 'Hộp', 20.000, NULL, 'Nhiệt độ phòng'),
(3, 2, 'VT-BTIEM-05', 'Bơm tiêm nhựa 5ml', 'Cái', 30.000, NULL, 'Nhiệt độ phòng'),
(4, 1, 'TH-NACL-09', 'Dung dịch NaCl 0.9% 500ml', 'Chai', 40.000, NULL, '2 - 8°C'),
(5, 2, 'VT-GACHE-01', 'Gạc vô trùng 10x10cm', 'Gói', 50.000, NULL, 'Nhiệt độ phòng')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- 6. Lô hàng mẫu (gán location_id)
INSERT INTO `batches` (`id`, `batch_code`, `item_id`, `location_id`, `expiry_date`, `initial_quantity`, `current_quantity`, `import_price`, `supplier_name`, `status`, `created_by`) VALUES
(1, 'PA2401', 1, 2, '2024-11-15', 350.000, 350.000, 1500.00, 'Công ty Dược phẩm Central 1', 'ACTIVE', 1),
(2, 'PA2309', 1, 2, '2024-08-10', 40.000, 40.000, 1500.00, 'Công ty Dược phẩm Central 1', 'EXPIRED', 1),
(3, 'GT2405', 2, 1, '2026-12-18', 120.000, 120.000, 65000.00, 'Công ty VT-YT Meditech', 'ACTIVE', 1),
(4, 'BT2409', 3, 1, '2027-09-30', 15.000, 15.000, 2500.00, 'Công ty Thiết bị Y tế 198', 'ACTIVE', 1),
(5, 'NC2402', 4, 3, '2026-05-20', 85.000, 85.000, 18000.00, 'Công ty Dược 198', 'ACTIVE', 1),
(6, 'GC2403', 5, 1, '2028-12-31', 50.000, 50.000, 5000.00, 'Công ty Vật tư Y tế Hà Nội', 'ACTIVE', 1),
(7, 'P401', 1, 3, '2024-05-15', 12.500, 12.500, 1500.00, 'Công ty Dược phẩm Central 1', 'EXPIRED', 1),
(8, 'B2401', 4, 1, '2024-11-30', 150.000, 150.000, 18000.00, 'Công ty Dược 198', 'ACTIVE', 1),
(9, 'P502', 2, 2, '2024-12-16', 80.000, 80.000, 65000.00, 'Công ty Meditech', 'ACTIVE', 1)
ON DUPLICATE KEY UPDATE `batch_code` = VALUES(`batch_code`);

-- 7. Audit log ban đầu
INSERT INTO `audit_logs` (`user_id`, `action`, `target_type`, `target_id`, `details`, `ip_address`, `created_at`) VALUES
(1, 'SYSTEM_INIT', 'SYSTEM', '1', '{"message": "Khởi tạo hệ thống thành công với 48 mặt hàng và các vị trí kho KHO-A1, KHO-B1, KHO-TL"}', '127.0.0.1', CURRENT_TIMESTAMP);
