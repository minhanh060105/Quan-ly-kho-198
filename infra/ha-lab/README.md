# InnoDB Cluster thử nghiệm trên Mac

Cần Docker Desktop đang chạy và tối thiểu 10 GB dung lượng trống để có khoảng dự phòng khi clone. Ba container trên cùng Mac chỉ dùng kiểm thử, không chống được lỗi toàn máy.

`compose.yaml` dùng project riêng `visinh-ha-lab`, volume riêng, Router chỉ xuất cổng 16446 trên loopback. Không dùng port 3306 hoặc DB local hiện tại.

Mật khẩu sinh ngẫu nhiên tại `.env` (gitignored). Không chia sẻ file này.

```sh
docker compose -f infra/ha-lab/compose.yaml --env-file infra/ha-lab/.env up -d --wait db1 db2 db3
python3 infra/ha-lab/bootstrap.py
docker compose -f infra/ha-lab/compose.yaml --env-file infra/ha-lab/.env --profile router up -d router
```

Sau lỗi clone phải kiểm tra cluster.status(), loại bỏ thành viên lỗi và addInstance lại; không tự bootstrap một nhóm mới khi mất quorum. Chỉ thử dừng primary sau khi cả 3 thành viên ONLINE. Cấu hình server thử nghiệm dùng DB_MODE=cluster, DB_CLUSTER_SIZE=3, DB_PORT=16446 và database riêng đã được nạp schema.

Tiêu chí nghiệm thu: primary đổi tự động khi dừng primary; Router chuyển sang primary mới; API hồi phục; gửi lại cùng idempotency key không nhân đôi giao dịch; mất 2/3 node phải từ chối ghi; node cũ trở lại làm secondary và dữ liệu hội tụ.

Tài liệu chính thức: https://dev.mysql.com/doc/mysql-shell/8.4/en/admin-api-deploy-router.html
