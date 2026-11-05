---
slug: kcs
name: KCS
locked: 05/11/2026
---

# KCS

## Họ là ai
Người kiểm chất lượng của xưởng, ngồi ở tổ Thành phẩm / KCS. Trên DB dev có vai "KCS trưởng" (một
người), "Tổ trưởng SX - Thành phẩm / KCS" và "Thợ SX - Thành phẩm / KCS" (mỗi vai một người). Biết nghề:
lỗi lem màu, lệch bế, bong keo, ép kim không ăn, xước màng. Nhìn hàng là biết lỗi do công đoạn nào gây ra.

## Việc hằng ngày
- Mở màn KCS, lọc lệnh Chờ kiểm, Chưa gửi kho, Chờ đóng lệnh.
- Ở bước cuối của lệnh: Kiểm hàng, tick tiêu chí không đạt, ghi số lỗi theo công đoạn gây lỗi, chụp ảnh.
  Hàng đạt là số chưa kiểm trừ số lỗi.
- Ở bước giữa: Ghi lỗi khi phát hiện lỗi của công đoạn trước, tổ đó thấy ngay ở tab KCS.
- Gửi nhập kho phần hàng đạt, kho thành phẩm nhận.
- Đóng lệnh khi đã đủ. Đóng lệnh thiếu khi phải dừng dù chưa đủ số.
- Xem Báo cáo lỗi theo công đoạn, theo tổ, theo tiêu chí. Xuất Excel gửi lãnh đạo.

Không làm: ghi sản lượng, bắt đầu hay kết thúc việc (tổ làm), sửa lệnh, xếp lịch, kiểm bước thuê ngoài
(Kế hoạch SX chỉ ghi số cuối khi nhận về).

## Quyền
Màn KCS có ba ô: Xem; Thao tác (kiểm hàng, ghi lỗi, gửi nhập kho, đóng lệnh); Đóng lệnh thiếu.
Danh mục Tiêu chí KCS là dòng riêng trong ma trận.

Trước 05/11/2026 chỉ Giám đốc có ô KCS trên DB dev. Vai KCS trưởng có Việc của tổ Thành phẩm / KCS (Xem,
Thực hiện lệnh, Xác nhận sản lượng, Kho, phạm vi Tất cả) nhưng chưa có màn KCS.

Chủ dự án duyệt 05/11/2026 viết theo vai KCS trưởng, đã bật qua ma trận quyền: KCS Xem, Thao tác, Đóng
lệnh thiếu, phạm vi Tất cả; danh mục Tiêu chí KCS Xem.

## Ràng buộc
- Ngồi bàn kiểm cạnh khu thành phẩm, dùng máy tính hoặc máy tính bảng, chụp ảnh lỗi bằng điện thoại.
- Một lệnh có thể kiểm nhiều lần, mỗi lần một phần hàng. Số đã lưu không sửa được.
- Lỗi phải quy đúng công đoạn gây lỗi, vì tổ đó bị trừ lương.

## Điều làm họ bực
- Kiểm xong mà kho không biết để nhận.
- Tổ cãi lỗi không phải của mình vì không có ảnh.
- Lệnh còn thiếu vài cái mà phải chờ mãi mới đóng được.

## Thế nào là thắng
- Mở màn là thấy lệnh nào đang chờ mình.
- Lỗi ghi một lần, tổ gây lỗi thấy ngay, có ảnh.
- Cuối tháng có bảng lỗi theo tổ, theo tiêu chí, khỏi tổng hợp tay.
