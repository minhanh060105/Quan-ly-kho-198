# Cập nhật API

Trước khi khởi động bản mới:

1. Áp dụng `infra/mysql/migrations/001_api_requests.sql` vào database hiện có. Bản cài mới dùng schema.sql đã bao gồm bảng này.
2. Cấu hình JWT_SECRET ngẫu nhiên ít nhất 32 ký tự, giống nhau trên các node. Thay secret sẽ yêu cầu người dùng đăng nhập lại. Tham khảo server/.env.example.
3. Triển khai InnoDB Cluster và Router theo HUONG_DAN_VAN_HANH_IT.md; backend dùng DB_PORT=6446. Không còn Raft backend.
4. Cập nhật Keepalived và health check: node chỉ giữ VIP khi có đường tới primary writable đủ quorum.

API nhập, xuất, hủy, tạo và xác nhận kiểm kê yêu cầu header X-Idempotency-Key (1–48 ký tự chữ, số, dấu _ hoặc -). Dùng cùng key và cùng nội dung khi retry. Dùng key mới cho giao dịch mới. Kết quả thành công được lưu và trả lại khi retry; nội dung khác với cùng key trả 409. Các lỗi không commit dữ liệu kho. Không tự ý xóa bảng api_requests vì sẽ mất lịch sử chống lặp.

Số lượng phải là JSON number, tối đa 3 chữ số thập phân. Nhập/xuất phải > 0; số đếm kiểm kê cho phép 0. Dòng xuất/kiểm kê không được trùng batch_id. Kiểm kê và xác nhận yêu cầu ADMIN hoặc MANAGER. Nhập/xuất/hủy yêu cầu quyền can_import/can_export tương ứng (ADMIN được phép). Token hết hạn hoặc tài khoản khóa trả 401; thiếu quyền trả 403. Excel cần Authorization Bearer như API khác.

Báo cáo nhận from_date/to_date dạng YYYY-MM-DD, tính cả ngày kết thúc theo giờ MySQL. Trả opening_quantity, import_quantity, export_quantity, adjustment_quantity (gồm hoàn trả phiếu hủy), closing_quantity. current_quantity giữ làm bí danh tồn cuối kỳ để tương thích. Báo cáo không loại lô đã hết tồn. Các số lịch sử chỉ chính xác nếu nhật ký giao dịch đầy đủ; dữ liệu cũ tạo trực tiếp/seed thiếu nhật ký cần được đối soát trước khi dùng báo cáo lịch sử.

Kiểm thử: chạy npm test trong server. Các test hiện dùng database giả lập; chưa thay thế kiểm thử MySQL thực với đồng thời nhiều request, migration, xuất Excel và failover. Leader election/quorum do MySQL Group Replication quản lý; cần nghiệm thu trên cụm ba node.
