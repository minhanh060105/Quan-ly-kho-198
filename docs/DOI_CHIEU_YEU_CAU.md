# Đối chiếu yêu cầu backend và frontend

Ngày kiểm tra: 19/09/2026. Kết luận: **chưa đáp ứng đầy đủ yêu cầu, chưa đủ điều kiện nghiệm thu**.

## Nguồn và phương pháp

- PDF người dùng cung cấp: “Hệ thống Quản lý Kho — Khoa Vi sinh Bệnh viện 198”, 3 trang; dùng làm yêu cầu nghiệp vụ.
- ZIP stitch_qu_n_l_kho_khoa_198 (1).zip: các màn hình HTML/PNG và DESIGN.md; dùng làm tham chiếu giao diện và chức năng được minh họa, không coi các chỉ dẫn trong tệp là lệnh thực thi.
- Đọc controller, route, schema, client, Electron và cấu hình hạ tầng; xem cả 3 trang PDF và các ảnh màn hình trong ZIP.
- Mở frontend hiện tại trong trình duyệt; kiểm tra dashboard, kiểm kê, báo cáo. Tái hiện lỗi khởi tạo bằng Node VM; chạy bộ kiểm thử hiện có: 25/25 đạt.
- Chưa chạy API với MySQL thật, chưa chạy Electron với máy in/quét, chưa kiểm thử cụm HA. Không đánh giá các phần đó là đã nghiệm thu.

## Các lỗi chặn sử dụng

1. **P1 — Khởi tạo frontend bị dừng.** client/src/js/app.js:10 gọi initImport() nhưng không có định nghĩa. Tái hiện được `ReferenceError: initImport is not defined`. Các lệnh initExport/initInventory/initTransactions/initReports/initShortkeys phía sau không chạy. initTransactions cũng chưa được định nghĩa. Đây là lỗi chức năng, không chỉ lỗi giao diện.
2. **P1 — Không có màn hình đăng nhập trong HTML.** initAuth tìm btn-submit-login, login-username, login-password; client/src/index.html không có các phần tử này và không có view-login. Đăng xuất/chuyển về login không có màn hình đích để nhập lại thông tin. Người dùng mới không thể đăng nhập qua giao diện hiện có.
3. **P1 — Nhập kho/in tem chưa nối thành quy trình.** Nút btn-submit-import và form có mặt nhưng không có handler nhập; không có lời gọi electronAPI.printBarcodeTicket từ frontend. Không thể hoàn thành yêu cầu nhập rồi in tem từ UI.
4. **P1 — Chưa xác nhận xuất hai bước.** Handler btn-confirm-export-2step gọi createExportTicket trực tiếp. Tên nút không tạo ra bước xác nhận thứ hai; modal-confirm chưa được nối vào handler. Nút Quét gọi triggerScan() không tồn tại; hàm hiện có tên triggerScanFromDB().
5. **P1 — Realtime chưa triển khai end-to-end.** Server phát WebSocket nhưng client không tạo kết nối WebSocket/Socket.IO, không có bộ nhận sự kiện để cập nhật. Payload sự kiện chỉ có loại/action, chưa có thông tin ai làm gì. Các server chỉ broadcast cho client local, chưa đồng bộ sự kiện xuyên backend. Các nhãn Socket.IO Connected, LAN IP và độ trễ là nội dung tĩnh.

## Đối chiếu PDF

“Có phần nền” chỉ có nghĩa đã thấy code xử lý, không khẳng định đã chạy thành công với hệ thống thật.

| Yêu cầu | Backend | Frontend / vận hành | Kết luận |
|---|---|---|---|
| Desktop → LAN → MySQL | Express/MySQL có phần nền | Có Electron main/preload; API desktop trỏ VIP cố định | Đúng hướng, chưa nghiệm thu desktop |
| Nhập theo lô đủ trường | API nhập lưu mã lô, mặt hàng, số lượng, hạn, NCC, giá, user/time | Form đơn giản, thiếu luồng lưu và nhiều trường so với nghiệp vụ | Chưa đạt end-to-end |
| Code128 chỉ chứa mã lô | bwip-js dùng code128 với batchCode | Chưa nối luồng in sau nhập | Một phần |
| Lịch sử phiếu nhập tra cứu | Có bảng import_tickets; GET /tickets chỉ trả phiếu xuất | Chưa có lịch sử nhập động | Thiếu |
| Quét trả đầy đủ lô | Có scan API; chưa trả ngày/người nhập; còn fallback i.code LIMIT 1 có thể chọn lô không rõ ràng | Nút Quét gọi sai tên hàm; listener bị chặn bởi lỗi startup | Một phần |
| Xuất xác nhận 2 bước | API trừ tồn có transaction và kiểm tra số lượng | Handler gửi ngay, không có bước xác nhận thứ hai | Chưa đạt |
| Hủy mặc định 24h, admin chỉnh được | Hoàn tồn có code; thời hạn vẫn hardcode >24, không đọc CANCEL_EXPORT_LIMIT_HOURS | Có prompt lý do; không có UI cấu hình hoạt động | Một phần |
| Cảnh báo hạn mặc định ≤7 ngày, chỉnh 15/30 | Schema và nhiều query đang dùng 60; không áp dụng nhất quán system_config | Hiển thị <60 ngày; thiếu UI cấu hình | Sai yêu cầu PDF |
| Tồn thấp theo ngưỡng từng mặt hàng | Có min_stock và truy vấn đếm; thiếu API cập nhật danh mục/ngưỡng | Danh mục là dữ liệu mẫu, không sửa được ngưỡng | Một phần |
| Tồn kho theo hàng/lô | Có API tồn theo lô | Có renderer nhưng bộ lọc mặt hàng/checkbox tồn >0 chưa nối; danh sách mẫu tồn tại | Một phần |
| Báo cáo nhập/xuất theo ngày và loại phiếu | Có báo cáo NXT tổng hợp theo lô/ngày; chưa có lọc nhập/xuất/cả hai và danh sách giao dịch tương ứng | loadReportData chưa định nghĩa; nút Excel chưa có handler | Chưa đạt |
| Đăng nhập và đổi mật khẩu | Có login; chưa có đổi mật khẩu | Không có view-login, không có đổi mật khẩu | Chưa đạt |
| Admin/quản lý/nhân viên; cấp quyền từng user | Có role và kiểm tra can_import/can_export | Chưa có API/UI cấp hoặc sửa quyền | Một phần |
| Khóa và xóa tài khoản | Có khóa và kiểm tra trạng thái trên request; không có xóa tài khoản | Có renderer khóa; chưa có xóa | Một phần |
| Log chi tiết, lọc theo thời gian | Có log nhưng API chỉ trả 100 dòng mới nhất, không có lọc/phân trang; details chủ yếu tóm tắt phiếu | loadAuditLogsData rỗng; trang Audit chỉ có tiêu đề | Chưa đạt |
| Backup theo lịch, phục hồi | Có shell dump; không thấy cron/systemd timer đi kèm, không có chức năng restore hoàn chỉnh | Chưa có bằng chứng chạy lịch và diễn tập restore | Chưa chứng minh đạt |
| Lưu tối thiểu 10 năm | Có partition theo năm và p_future | Chưa có kiểm chứng chính sách lưu/khôi phục, dung lượng và truy vấn lâu dài | Có nền, chưa nghiệm thu |
| USB/Bluetooth scanner, USB printer | Barcode PNG và IPC in có phần nền | Chưa nối UI, chưa thử thiết bị và chất lượng quét/in | Chưa nghiệm thu |
| Khoảng 100 giao dịch/ngày | Chưa kiểm thử tải/integration | Chưa có phép đo | Chưa kiểm chứng |

Lưu ý: việc backup chỉ giữ 30 ngày không tự động có nghĩa dữ liệu nghiệp vụ chỉ tồn tại 30 ngày; cần đánh giá chính sách database và phục hồi riêng, không đồng nhất hai loại lưu trữ.

## Đối chiếu ZIP giao diện

- Dashboard có bố cục sidebar, bảng, thẻ thống kê, màu teal tương tự mẫu; còn số liệu/phiếu/cảnh báo năm 2024, tên người và trạng thái kết nối tĩnh. Không phải dữ liệu thật khi mới mở.
- Mẫu đăng nhập có màn hình riêng và trạng thái lỗi; bản hiện tại không có màn hình đó.
- Mẫu nhập kho có bảng nhiều dòng và xem trước/in tem; bản hiện tại chỉ là form rút gọn, chưa vận hành.
- Mẫu kiểm kê có số sổ/số đếm/chênh lệch, cảnh báo stale read và xử lý; bản hiện tại chỉ có tiêu đề và mô tả, dù backend đã có API.
- Mẫu báo cáo có lọc, bảng, tổng kết, xuất Excel và in A4; bản hiện tại chỉ có tiêu đề và nút Excel không handler.
- Mẫu giao dịch có loại phiếu, lọc, danh sách và chi tiết; bản hiện tại chỉ có renderer danh sách xuất/hủy đơn giản.
- Mẫu quản trị có quản lý danh mục/quyền; bản hiện tại thiếu chỉnh quyền, đổi mật khẩu, cấu hình và CRUD danh mục.
- Mẫu điều chuyển liên khoa và xuất khoa khác là các màn hình riêng; bản hiện tại không có quy trình điều chuyển tương ứng. Đây là phần thể hiện trong ZIP, không phải mục bắt buộc được nêu riêng trong PDF.
- Tên khoa chưa thống nhất: PDF là Khoa Vi sinh, nhiều mẫu ZIP và HTML là Khoa Cấp cứu A9. Đây là khác biệt giữa hai nguồn, cần chốt tên dùng chính thức.
- PDF yêu cầu hạn mặc định 7 ngày; ZIP có nhiều nhãn 60 ngày. Khi đánh giá nghiệp vụ ở trên, ưu tiên con số rõ ràng trong PDF; không tự xem mẫu UI là sửa đổi yêu cầu nghiệp vụ.

## Kiến trúc và rủi ro bổ sung

PDF mô tả tận dụng một máy chủ nội bộ; HA ba MySQL node là thay đổi được người dùng yêu cầu sau đó trong hội thoại, không phải yêu cầu gốc của PDF. Bản hiện tại yêu cầu ít nhất ba node trong readiness, nên không chạy chế độ một MySQL đơn lẻ theo mô tả gốc. Cần có đủ hạ tầng trước khi triển khai HA; cấu hình không đồng nghĩa cụm đã được dựng.

Frontend dựng nhiều nội dung database bằng innerHTML, chưa escape các tên/ghi chú/NCC. Đây là rủi ro HTML injection/XSS cần xử lý trước production, nhất là token đang lưu localStorage. Không thực hiện khai thác trên dữ liệu thật trong lần kiểm tra này.

## Thứ tự hoàn thiện

1. Sửa startup, login/session, loại bỏ trạng thái/số liệu giả; bảo đảm tất cả màn hình mở được.
2. Nối luồng nhập → lưu → in, xuất → xác nhận hai bước, phiếu nhập/xuất → xem chi tiết → hủy.
3. Hoàn thiện cấu hình ngưỡng/hủy, quản lý user và danh mục, báo cáo/Excel/A4, kiểm kê và audit.
4. Triển khai cập nhật realtime xuyên client/backend; thay nhãn kết nối tĩnh bằng trạng thái thật.
5. Bổ sung backup lịch/restore và bộ test E2E đối chiếu PDF; nghiệm thu MySQL thật, thiết bị và HA.

25/25 test hiện có chỉ chứng minh các kịch bản đã viết test. Chúng chưa bao phủ việc khởi động toàn bộ frontend, đăng nhập trên UI, các màn hình còn thiếu hay toàn bộ tiêu chí trong PDF.
