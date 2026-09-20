# Vận hành HA: InnoDB Cluster + MySQL Router + Keepalived

## Kiến trúc và giới hạn

Cần **3 MySQL node** để tiếp tục ghi khi mất 1 node. Cả ba dùng MySQL 8.4 LTS, MySQL Shell và Router cùng dòng 8.4. Ví dụ A/B/C: 192.168.1.101/102/103, VIP 192.168.1.200. Thay địa chỉ và interface trong cấu hình theo mạng thực tế.

Client → VIP → backend tại node giữ VIP → Router local:6446 → MySQL primary.

- **MySQL Group Replication single-primary** bầu primary, đồng bộ và kiểm soát quorum. Backend không có Raft riêng và không có API bầu cử.
- Mỗi backend có Router local với metadata cache; kết nối mới đi đến primary hiện tại. Router không di chuyển một transaction đang chạy sang primary khác.
- Cả ba backend có thể phục vụ qua cùng primary. Node giữ VIP không nhất thiết là node có MySQL primary.
- Keepalived chọn backend sẵn sàng; `weight 0`, `init_fail` đưa node lỗi vào FAULT. `nopreempt` tránh chuyển VIP về node ưu tiên cao chỉ vì nó vừa hồi phục.
- `/api/live`: tiến trình còn sống. `/api/ready` và `/api/health`: Router kết nối tới primary ONLINE, writable, đủ đa số theo DB_CLUSTER_SIZE và bảng api_requests tồn tại. Probe bị giới hạn 1,2 giây; kết quả không cache giữa các lần kiểm tra. Đây là tín hiệu định tuyến, không phải khóa ghi: MySQL bảo đảm quorum khi commit.
- Mất đa số thì dừng ghi; không tự force quorum/khởi tạo nhóm mới. VRRP có thể xuất hiện hai VIP khi riêng đường VRRP bị chia cắt. Các backend vẫn dùng cùng cơ chế quorum MySQL, nhưng tính khả dụng mạng phải được kiểm thử riêng. Không cam kết RTO <5 giây hay RPO=0 khi chưa đo và nghiệm thu.

## 1. Chuẩn bị và tạo cụm

Sao lưu dữ liệu và ghi nhận primary hiện tại trước khi thay đổi cụm có dữ liệu. Không chạy seed_data.sql trên dữ liệu sản xuất. Cho phép 3306 giữa Router/các node, và cổng giao tiếp group phù hợp với communication stack; cấu hình dưới dùng MYSQL stack (3306). Chỉ mở backend cho mạng client và IP protocol 112 giữa các peer Keepalived.

Dùng `infra/mysql/my.cnf.example`, đổi server_id thành 1/2/3 và report_host tương ứng. Bật super_read_only khi khởi động để node chưa vào group không nhận ghi. Trên instance mới, quản trị viên có thể cần tạm tắt super_read_only để tạo tài khoản/configureInstance trong lúc backend chưa chạy; bật lại trước khi đưa vào phục vụ. Giữ secret ngoài Git.

Trong MySQL Shell, cấu hình từng instance bằng tài khoản quản trị (Shell hỏi mật khẩu):

```javascript
dba.configureInstance('root@192.168.1.101:3306', {clusterAdmin: 'icadmin'});
dba.configureInstance('root@192.168.1.102:3306', {clusterAdmin: 'icadmin'});
dba.configureInstance('root@192.168.1.103:3306', {clusterAdmin: 'icadmin'});
```

Dùng cùng thông tin icadmin trên ba node; thực hiện restart nếu Shell yêu cầu. Kết nối Shell vào node A bằng icadmin rồi tạo **cụm mới**:

```javascript
var cluster = dba.createCluster('visinh', {
  communicationStack: 'MYSQL',
  consistency: 'BEFORE_ON_PRIMARY_FAILOVER',
  exitStateAction: 'ABORT_SERVER',
  expelTimeout: 5,
  autoRejoinTries: 3,
  memberWeight: 80
});
cluster.addInstance('icadmin@192.168.1.102:3306', {memberWeight: 60});
cluster.addInstance('icadmin@192.168.1.103:3306', {memberWeight: 40});
cluster.setOption('consistency', 'BEFORE_ON_PRIMARY_FAILOVER');
cluster.setOption('exitStateAction', 'ABORT_SERVER');
cluster.setOption('autoRejoinTries', 3);
cluster.setOption('expelTimeout', 5);
cluster.status({extended: 1});
```

Shell có thể yêu cầu chọn recovery method. Clone sẽ thay thế dữ liệu node nhận; chỉ chọn cho node mới/rỗng đã xác nhận. Không tự động ép clone.

**Nếu đã có Group Replication:** không chạy tạo cụm mới ở từng node. Kết nối primary của nhóm hiện có và dùng `dba.createCluster('visinh', {adoptFromGR: true})` nếu chưa có metadata InnoDB Cluster; nếu đã có thì `dba.getCluster()`. Sau đó áp dụng các setOption ở trên và xác minh đủ 3 thành viên. Xử lý node lệch dữ liệu bằng quy trình recovery của MySQL, không tự bootstrap một nhóm khác.

Trên **từng** MySQL node, kết nối bằng tài khoản quản trị và đặt thời hạn rời nhóm khi không còn đa số (biến này không phải option của Cluster.setOption):

```sql
SET PERSIST group_replication_unreachable_majority_timeout = 10;
```

Áp dụng schema cho cài mới hoặc `infra/mysql/migrations/001_api_requests.sql` cho database hiện có. Tạo user ứng dụng theo `infra/mysql/app_user.sql.example` với mật khẩu riêng. Tài khoản ứng dụng không có quyền tắt read-only hoặc quản lý replication.

## 2. Router và backend trên từng node

Cài MySQL Router và tài khoản hệ điều hành mysqlrouter. Bootstrap một lần trên từng backend host (mật khẩu được hỏi tương tác):

```sh
sudo env CLUSTER_ADMIN_URI=icadmin@192.168.1.101:3306 sh infra/mysql-router/bootstrap.sh
sudo systemctl enable --now mysqlrouter
```

Bootstrap tạo cấu hình metadata-cache; không tự viết danh sách primary tĩnh. Kiểm tra endpoint classic read/write trong file sinh ra là 127.0.0.1:6446 và đích PRIMARY. Sau một failover, kết nối mới phải tới server_uuid mới. Không dùng cổng read-only 6447 cho backend.

Sao chép server/.env.example sang server/.env trên từng máy. Điền DB_USER, DB_PASSWORD; DB_PORT=6446; DB_CLUSTER_SIZE=3; NODE_ID riêng cho từng backend. JWT_SECRET phải giống nhau trên các backend. Bỏ RAFT_SECRET/RAFT_PEERS cũ. Chạy backend bằng service manager tự restart và working directory là server để dotenv đọc đúng file.

Client retry GET và các POST kho được bảo vệ bằng idempotency khi gặp mất mạng, timeout hoặc 502/503/504. Mỗi lần gọi giữ nguyên key; tối đa 8 retry, timeout request 15 giây. Không tự retry các thao tác khác như toggle khóa user. Nếu hết retry và chưa biết kết quả commit, không tạo giao dịch mới một cách mù quáng: đối soát hoặc gửi lại cùng key/nội dung. Idempotency bảo đảm trong cùng cụm, không thay thế recovery dữ liệu khi force quorum sai.

## 3. Keepalived

Cài check_health.sh bằng root, không cho user thường sửa. Trên từng node:

```sh
sudo install -o root -g root -m 0755 infra/keepalived/check_health.sh /usr/local/bin/check_health.sh
# Chọn đúng nodeA/nodeB/nodeC, sửa interface và IP trước khi cài.
sudo install -o root -g root -m 0600 infra/keepalived/keepalived.conf.nodeA /etc/keepalived/keepalived.conf
sudo keepalived --config-test -f /etc/keepalived/keepalived.conf
sudo systemctl enable --now keepalived
```

Probe chỉ gọi một URL, tổng thời gian tối đa 2 giây, thấp hơn timeout script 3 giây. Node không sẵn sàng liên tiếp sẽ FAULT và nhả VIP. Nếu tất cả node không có đường tới primary hợp lệ thì tất cả phải nhả VIP.

## 4. Nghiệm thu trước khi vận hành

Thực hiện trên cụm staging có dữ liệu thử. Chạy `node infra/tests/watch_failover.js http://192.168.1.200:3000 180` để ghi các lần chuyển readiness/primary và khoảng gián đoạn quan sát được. Script chỉ đọc; dừng dịch vụ/ngắt mạng là thao tác riêng của người vận hành.

| Kịch bản | Kết quả phải đạt |
|---|---|
| Dừng backend hoặc Router ở node giữ VIP | VIP chuyển sang backend ready khác; request mới phục hồi |
| Dừng MySQL primary | Hai node còn lại bầu primary; Router chuyển đích; API phục hồi |
| Ngắt một node khỏi hai node còn lại ở đường MySQL | Phía đa số tiếp tục; phía thiểu số không commit giao dịch mới |
| Mất hai MySQL node | Không node nào nhận commit thành công; không tự force quorum |
| Khởi động lại node cũ | Node rejoin/recovery; chỉ một MySQL primary; không giành VIP không cần thiết |
| Cắt riêng VRRP, giữ MySQL thông | Ghi nhận rủi ro VIP trùng/ARP, xác minh một DB primary; khắc phục thiết kế mạng nếu cần |
| Làm mất phản hồi sau commit phiếu kho | Retry cùng key/nội dung trả đúng ticket cũ; không trừ/cộng tồn lần hai |
| Hai backend nhận cùng request/key đồng thời | Chỉ một phiếu và một bộ inventory_transactions; request khác payload trả 409 |

Có thể chạy kiểm tra tạo phiếu nhập một lần qua hai backend bằng script `infra/tests/replay_ticket.js`. Script chỉ dùng trên staging: đặt `ALLOW_STAGING_WRITE=yes`, `API_TOKEN`, `TEST_IMPORT_FILE` (file JSON payload nhập kho hợp lệ), rồi chạy `node infra/tests/replay_ticket.js http://VIP:3000 http://BACKEND:3000`. Nó gửi hai request đồng thời cùng key và so sánh kết quả. Key được in trước khi gửi; nếu mất phản hồi, đặt lại `TEST_IDEMPOTENCY_KEY` bằng key đó khi chạy lại để tránh tạo phiếu mới. Script này tạo dữ liệu thật trong database đích.

Dùng một phiếu thử với key cố định, gọi qua VIP rồi gọi lại qua backend khác, so sánh ticket id. Đối chiếu trực tiếp bảng phiếu, api_requests và inventory_transactions với tồn trước/sau. Ghi thời gian gián đoạn thực tế, không suy từ timer. Theo dõi `cluster.status({extended: 1})`, log Router, Keepalived và backend.

## 5. Mất toàn cụm và bảo trì

Dừng riêng Keepalived không thay đổi DB primary; backend node khác vẫn đi qua Router tới primary đang hoạt động. Muốn chuyển primary chủ động dùng `cluster.setPrimaryInstance(...)` rồi kiểm chứng trước khi bảo trì.

Sau mất toàn bộ cụm, quản trị viên kiểm tra các GTID và dùng `dba.rebootClusterFromCompleteOutage('visinh')` theo hướng dẫn MySQL Shell. Không bật bootstrap_group ở nhiều node, không dùng force để vượt cảnh báo dữ liệu nếu chưa đối soát và cô lập các node cũ. Backup/restore là quy trình riêng, không bảo đảm bằng việc có replication.

## Tài liệu gốc

- [MySQL: cấu hình election](https://dev.mysql.com/doc/mysql-shell/8.4/en/configuring-election-process.html)
- [MySQL: consistency, read-only và exit action](https://dev.mysql.com/doc/refman/8.4/en/group-replication-system-variables.html)
- [MySQL Router với InnoDB Cluster](https://dev.mysql.com/doc/mysql-router/8.4/en/mysql-router-innodb-cluster.html)
- [Keepalived configuration](https://keepalived.org/documentation/keepalived-conf/)
