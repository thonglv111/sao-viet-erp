---
slug: to-san-xuat
name: Tổ trưởng và thợ sản xuất
locked: 05/11/2026
---

# Tổ trưởng và thợ sản xuất

## Họ là ai
Người đứng máy và làm tay ở xưởng in offset: tổ in (nhóm thợ máy 2, 4, 5, 6, 7 màu), cán màng, bồi, bế,
gỡ hàng, dán, thành phẩm, cột dây, cắt. Mỗi tổ có một tổ trưởng và vài thợ. Trên DB dev, mỗi tổ có cặp
vai "Tổ trưởng SX - <tổ>" và "Thợ SX - <tổ>"; tổ thành phẩm còn tách nhóm 1, 2, 3 và nhóm thử việc.

Biết nghề rành hơn ai hết: tờ in, con, bù hao, khuôn bế, mặt dán. Không cần giải nghĩa thuật ngữ. Ít
dùng máy tính, quen sổ tay và bảng giao ca. Đọc chữ trên điện thoại hoặc máy tính bảng đặt cạnh máy.

## Việc hằng ngày
Thợ:
- Mở Việc của tổ, xem hôm nay tổ có việc gì, việc nào đang chạy, việc nào chờ hàng bước trước.
- Bấm Bắt đầu, Tạm dừng (ghi vì sao), Tiếp tục, Kết thúc trên việc mình được giao.
- Ghi sản lượng từng lần: số làm được, tick người làm lần này. Ghi xong phần mềm tự đề xuất giao lần
  đó sang tổ sau.
- Nhận khuôn, trả khuôn về kệ. Yêu cầu cấp vật tư, yêu cầu bổ sung khi thiếu.
- Báo dừng máy khi máy hư hoặc hết hàng.

Tổ trưởng làm hết việc của thợ, thêm:
- Giao người cho việc, rút người ra. Phát hành xong cả tổ tự được giao, tổ trưởng chỉnh lại.
- Xác nhận đã nhận hàng từ tổ trước (tab Giao và nhận).
- Sửa số một lần ghi sản lượng đã ghi sai, có ghi lý do.
- Xem lỗi KCS trả về cho tổ mình.

Không làm: tạo hay sửa lệnh, xếp lịch, phát hành (Kế hoạch SX), kiểm hàng và đóng lệnh (KCS), lập phiếu
xuất nhập (thủ kho), bước thuê ngoài (Kế hoạch SX mang đi và nhận về).

## Quyền (đọc trên DB dev 05/11/2026)
Mỗi tổ là một dòng trong ma trận quyền, nhóm "Tổ sản xuất". Ô của dòng tổ:
- Xem: thấy tổ đó ở thanh bên và mở được Việc của tổ.
- Thực hiện lệnh: giao người, bắt đầu, tạm dừng, kết thúc, ghi sản lượng, nhận và trả khuôn, đề xuất
  giao, yêu cầu cấp vật tư.
- Xác nhận sản lượng: xác nhận nhận hàng, sửa số.
- Kho: yêu cầu nhập kho phần vật tư còn dư.

Vai mẫu:
- Thợ SX - <tổ>: Xem, Thực hiện lệnh, phạm vi Cả phòng.
- Tổ trưởng SX - <tổ>: Xem, Thực hiện lệnh, Xác nhận sản lượng, phạm vi Cả phòng.
- Không vai tổ nào có ô Kho, trừ KCS trưởng và "nhân viên tổ cán màng".

Báo hỏng máy gửi tổ sửa chữa cần ô Yêu cầu của Kỹ thuật máy (thợ hiện chỉ có Xem).

## Ràng buộc
- Đứng cạnh máy, tay dính mực, keo. Màn nhỏ, bấm bằng ngón tay. Cần nút to, chữ lớn, ít ô phải gõ.
- Làm theo ca, có ca đêm. Nhiều việc chạy song song trên nhiều máy của tổ.
- Ghi sản lượng là căn cứ tính lương khoán, ghi sai là mất tiền.

## Điều làm họ bực
- Bấm Bắt đầu không được mà không biết vì sao (chưa nhận hàng, chưa nhận khuôn, vật tư chưa về).
- Phải gõ lại tên người, gõ lại số đã ghi ở sổ.
- Hàng bước trước báo giao rồi mà chưa thấy tới.
- Máy hư cả ngày mà lương tính như không có việc.

## Thế nào là thắng
- Mở màn là biết việc nào làm được ngay, việc nào đang chờ gì.
- Ghi một lần sản lượng chỉ mất vài lần bấm.
- Cuối tháng số khoán khớp sổ tổ, không phải cãi.
