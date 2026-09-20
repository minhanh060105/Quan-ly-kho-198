# Tiến độ nghiệm thu ngày 20/09/2026

## Đã xác minh với MySQL thật

- Đăng nhập admin, API xác thực và giao diện tổng quan.
- Backup bằng mysqldump, nén gzip; restore thành công vào database riêng `visinh_restore_acceptance`.
- Chạy API riêng cổng 3100 với DB phục hồi: nhập 10, gửi lại cùng key không nhập trùng, xuất 3 còn 7, hủy phiếu trở lại 10; mã vạch PNG, số tem, xuất Excel đều đạt.
- 29 bài kiểm thử tự động đạt, bao gồm quorum, read-only, idempotency, chế độ standalone và tạo trang tem.

## Các sửa đổi

- DB_MODE phân biệt standalone và cluster; cluster yêu cầu ít nhất 3 node. Health trả mode và ha_enabled, không báo có leader election ở local.
- Migration chạy lại được, không còn lỗi deleted_at đã tồn tại. Mặc định hạn 7 ngày; nạp seed không ghi đè tồn kho hiện hữu.
- Electron in danh sách tem đúng số bản, escape nội dung, tắt Node trong cửa sổ in và nhận kết quả từ trình điều khiển in.
- Script backup đọc cấu hình thật, không chứa mật khẩu hardcode; chỉ công bố file khi dump hoàn tất. Restore bắt buộc vào DB kiểm tra mới.
- npm run dev không tự giết tiến trình cổng 3000.

## Chưa được coi là nghiệm thu

- Thiết bị in/quét vật lý, tính tương thích và kích thước nhãn thực tế.
- Đối chiếu chi tiết mọi màn hình với Stitch; hiện mới điều chỉnh hệ thống màu/bố cục chung và tổng quan.
- Kiểm thử đầy đủ quyền từng vai trò, realtime nhiều máy, tải dài hạn, mất mạng và mất điện.
- HA trên nhiều máy vật lý: cluster Docker trên một Mac chỉ là môi trường thử nghiệm.

Báo cáo này thay thế phần trạng thái cũ trong DOI_CHIEU_YEU_CAU.md; không dùng báo cáo cũ để kết luận phiên bản hiện tại.

## Kết quả dựng HA lab

Docker Desktop đã chạy. Đã tải MySQL 8.4, MySQL Shell và Router; tạo cluster `visinhLab`, node db2 gia nhập được. Node db3 lỗi clone `Error writing file './undo_001' (errno: 5)`. Kiểm tra ổ đĩa host: chỉ còn 328 MiB trống. Dừng lab để tránh tiếp tục ghi đĩa. Chưa chạy thử dừng primary hoặc mất quorum, chưa chứng nhận failover. MySQL local và frontend đang dùng không chuyển sang cluster chưa hoàn chỉnh.
