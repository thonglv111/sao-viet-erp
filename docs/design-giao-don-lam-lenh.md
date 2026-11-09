# Giao đơn cho người phụ trách

Thiết kế chốt với chủ dự án ngày 08/11/2026, đã code cùng ngày. Bản đầu gọi người nhận đơn là "người làm lệnh" và cho người được giao tạo lệnh ngay ở Hàng chờ tiếp nhận. Chủ dự án thấy chỗ nhận đơn mà bấm vào được để tạo lệnh là không đúng, nên tách thành ba tab và đổi tên thành **người phụ trách**.

## 1. Mục tiêu

Có một người đứng ra hứng mọi đơn sale gửi về, rồi chia từng đơn cho một người trong phòng mình phụ trách. Người phụ trách tạo lệnh ở một chỗ riêng. Ai thấy đơn nào, lệnh nào là theo người phụ trách.

## 2. Hai vai

- **Người giao**: người giữ ô quyền chi tiết "Giao đơn" ở dòng Lệnh sản xuất của ma trận quyền (cột `can_reassign` của khoá `san_xuat`). Admin cũng là người giao.
- **Người phụ trách**: người có quyền Thao tác ở Lệnh sản xuất, được giao đơn. Người giao có thể tự giao cho mình.

## 3. Ba tab của màn Lệnh sản xuất

| Tab | Ai thấy | Làm gì |
| --- | --- | --- |
| Hàng chờ tiếp nhận | Chỉ người có ô Giao đơn | Tick đơn, bấm Giao. Bấm dòng chỉ tick đơn, KHÔNG mở tạo lệnh |
| Tạo lệnh | Mọi người có quyền Xem | Đơn đã giao mà còn dòng chưa lên lệnh. Bấm dòng mở ngăn Lệnh dự kiến để tạo lệnh |
| Lệnh sản xuất | Mọi người có quyền Xem | Danh sách lệnh như cũ |

Hai tab đầu dùng chung một bảng đơn: cột Trạng thái chỉ có Chưa giao và Đã giao (theo đơn đã có người phụ trách hay chưa), cột Lệnh ghi "Đã tạo x/y lệnh" (y là số dòng đơn, mỗi dòng một lệnh; chủ dự án chốt 08/11/2026 bỏ trạng thái "Đang làm"), cột Người phụ trách, ô lọc Khách hàng và Người phụ trách trong nút Lọc. Chip lọc trạng thái chỉ có ở tab Hàng chờ tiếp nhận; tab Tạo lệnh không có vì đơn nào ở đó cũng đã giao.

## 4. Phạm vi theo người phụ trách

Áp cho tab Tạo lệnh và tab Lệnh sản xuất, đọc từ phạm vi của dòng Lệnh sản xuất trong ma trận quyền:

- **Của tôi**: đơn mình phụ trách, lệnh mình phụ trách.
- **Cả phòng**: đơn và lệnh của người trong phòng mình, kể cả phòng con trên cây Phòng ban.
- **Tất cả**: mọi đơn đã giao, mọi lệnh.

Lệnh cũ chưa ghi người phụ trách thì tính người tạo. Tab Hàng chờ tiếp nhận vẫn khoanh theo chủ đơn như Đơn hàng bán, vì đơn chưa giao chưa có người phụ trách.

Trước ngày 08/11/2026 bảng lệnh khoanh theo chủ đơn, nên người phụ trách có phạm vi Của tôi không thấy lệnh mình vừa tạo khi đơn là của sale khác.

## 5. Luồng

1. Sale chốt đơn (đủ cọc nếu đơn cần cọc). Đơn vào Hàng chờ tiếp nhận ở trạng thái **Chưa giao**. Chỉ người giao nhận thông báo đơn mới.
2. Người giao tick một hoặc nhiều đơn. Cụm "Đã chọn N đơn, Bỏ chọn, Giao" nằm ngay sau chip lọc.
3. Bấm Giao, chọn **một** người. Ô chọn gõ tìm được. Danh sách là người cùng phòng với người giao, kể cả phòng con, có quyền Thao tác ở Lệnh sản xuất, kể cả bản thân người giao.
4. Người nhận có toast ngay qua SSE, tab Tạo lệnh có chấm, đơn mới có chấm đỏ cạnh mã cho tới khi họ mở.
5. Người phụ trách mở tab Tạo lệnh, bấm vào đơn, ngăn **Lệnh dự kiến** mở ra, bấm "Xác nhận tạo N lệnh". Lệnh tạo ra có người phụ trách là người phụ trách đơn, kể cả khi người khác trong phạm vi bấm tạo hộ.

## 6. Luật

**Tạo lệnh.** Chỉ đơn đã giao. Người bấm phải thấy đơn theo phạm vi ở mục 4. Chặn ở máy chủ (`POST /api/lsx/tao/{order_id}` và `GET /api/lsx/preview/{order_id}`), không chỉ ẩn nút. Đơn chưa giao thì kể cả người giao cũng không tạo được, phải giao trước (có thể giao cho chính mình).

**Tạo hộ.** Người trong phạm vi tạo lệnh cho đơn người khác phụ trách: người phụ trách lệnh vẫn là người phụ trách đơn, nhật ký ghi tạo hộ, người phụ trách nhận thông báo.

**Giao lại.** Tick đơn đã giao rồi giao cho người khác; phần mềm hỏi "N đơn đang giao cho X sẽ chuyển sang Y". Lệnh đã tạo giữ người phụ trách cũ, các dòng còn lại thuộc người mới. Mỗi lần giao, giao lại, tạo hộ đều ghi nhật ký. Tên người do máy chủ lấy từ tài khoản.

**Đơn đang chờ lúc tính năng lên** ở trạng thái Chưa giao, giao như đơn mới.

## 7. Chỗ trong code

| Chỗ | Nội dung |
| --- | --- |
| Dữ liệu | Bốn cột trên `orders`: `nguoi_lam_lenh_id` (người phụ trách, tên cột giữ từ bản đầu), `giao_lam_lenh_at`, `nguoi_giao_lam_lenh_id`, `nguoi_lam_lenh_mo_at`. Migration 0456, 0457 |
| Quyền | Ô "Giao đơn" của `san_xuat` trong `PermissionMatrix.tsx`, cột `can_reassign` |
| Phạm vi | `services/lenh_sx/pham_vi.py::phu_trach_ids_theo_pham_vi`, `routers/lsx.py::_phu_trach_ids`, `lsx_repo.dk_lenh_trong_pham_vi` |
| Hai tab đơn | `GET /api/lsx/hang-cho?che_do=giao|tao` cùng `trang_thai`, `nguoi_phu_trach_id`; `/hang-cho/khach-loc`, `/hang-cho/phu-trach-loc`, `/hang-cho/cham` |
| Giao | `POST /api/lsx/hang-cho/giao`, danh sách người `GET /api/lsx/hang-cho/nguoi-lam-lenh` |
| Thông báo | Đơn mới chỉ báo người giao; giao đơn báo người nhận; tạo hộ báo người phụ trách. Đẩy qua SSE |
| Nhật ký | `giao_don_lam_lenh`, `giao_lai_don_lam_lenh`, `tao_lsx_ho` ở `audit_registry.py` |
| Tài liệu | Cuốn Kế hoạch sản xuất, chương "Nhận đơn và tạo lệnh" và mục quyền |
