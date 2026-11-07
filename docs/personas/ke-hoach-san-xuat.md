---
slug: ke-hoach-san-xuat
name: Kế hoạch sản xuất
locked: 05/11/2026
---

# Kế hoạch sản xuất

## Họ là ai
Người lên kế hoạch của xưởng in offset. Trên DB dev hiện là tài khoản vai "kế hoạch", một người duy nhất,
thuộc Phòng kỹ thuật. Biết nghề in như sale tính giá biết: tay sách, bài in, khổ tờ, bù hao, máy nào chạy
khổ nào, công đoạn nào đi trước công đoạn nào, nhà gia công nào nhận cán màng, ép kim. Không cần giải
nghĩa thuật ngữ. Không biết gì về phần mềm bên dưới.

Cũng là người mang hàng đi gia công ngoài và ghi số nhận về.

## Việc hằng ngày
- Nhận đơn mới ở Hàng chờ tiếp nhận (đơn tự rơi xuống khi đã chốt và đủ cọc, có thông báo ngay), tạo lệnh
  từ các dòng lệnh dự kiến.
- Rà từng lệnh: quy cách, nguồn giấy, chuỗi công đoạn, tổ và máy, vật tư từng bước, bước nào thuê ngoài.
  Đủ dữ liệu thì bấm Sẵn sàng lập kế hoạch.
- Lo vật tư ở Kế hoạch vật tư: giữ hàng có sẵn cho lệnh, thiếu thì đề nghị mua cho lệnh.
- Xếp lịch: kéo lệnh từ khay Chờ xếp lịch vào ngày bắt đầu, dời khi máy hỏng hay có đơn gấp, rồi Phát
  hành xuống xưởng. Lịch đổi sau khi đã phát hành thì Phát hành cập nhật hoặc Thu hồi.
- Gia công ngoài: đặt trọn gói hoặc một bước thuê ngoài, cấp giấy cho nhà gia công, ghi Đã mang đi, Nhận
  hàng về và chốt số.
- Trả lời Kinh doanh hàng tới đâu, soi đơn cần để ý ở Theo dõi sản xuất.

Không làm: đóng lệnh (KCS đóng), tạm dừng việc (tổ bấm ở bàn tổ), lập đơn mua (Thu mua), xuất nhập kho
(thủ kho).

## Quyền của vai "kế hoạch" (chốt 05/11/2026)
Chủ dự án chốt viết theo bộ quyền của vai "Kế hoạch SX". Vai "kế hoạch" của Phòng kỹ thuật (người kế hoạch
là trưởng phòng đó nên không chuyển phòng) đã được bật cho bằng, qua ma trận quyền:
- Kế hoạch sản xuất: Xem, Thao tác, phạm vi Tất cả.
- Xếp lịch: Xem, Thao tác, Phát hành lịch, phạm vi Tất cả.
- Kế hoạch vật tư: Xem, Thao tác, phạm vi Tất cả.
- Hồ sơ lệnh sản xuất, Theo dõi sản xuất: Xem, phạm vi Tất cả.
- Yêu cầu mua hàng: Xem, Thao tác, phạm vi Tất cả.
- Xem danh mục Công đoạn, Thiết bị & Máy móc, Khuôn.
- KHÔNG có Mua hàng, Kho, KCS.

## Ràng buộc
- Máy tính văn phòng, màn 1366–1920 px, chuột và bàn phím. Quen bảng Excel và bảng kế hoạch giấy.
- Cùng lúc giữ nhiều đơn, nhiều máy. Đơn gấp chen vào là phải dời lịch ngay.
- Xưởng và Kinh doanh hỏi liên tục "lệnh này tới đâu", phải trả lời trong vài giây.

## Điều làm họ bực
- Lệnh tạo ra thiếu số, thiếu máy, không biết thiếu chỗ nào.
- Phát hành rồi mới thấy sai, không rút về được vì tổ đã bắt đầu.
- Hàng gửi gia công đi đâu, ai mang, về bao nhiêu không ai ghi.
- Vật tư báo đủ trên giấy mà kho không có.

## Thế nào là thắng
- Đơn rơi xuống là lên lệnh và xếp lịch được trong ngày.
- Nhìn lịch là biết máy nào trống, lệnh nào trễ.
- Hàng ở nhà gia công lúc nào cũng biết đang ở đâu và về bao nhiêu.
