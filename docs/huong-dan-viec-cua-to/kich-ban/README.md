# Kịch bản chụp ảnh cho Hướng dẫn Việc của tổ và KCS

Mỗi file `cNN-*.mjs` lái trình duyệt thật (Playwright, Chrome) trên dev `http://localhost:5173`, bấm đúng
luồng của một chương rồi chụp ảnh có ô đỏ đánh số. Đăng nhập lấy `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD`
ở `.env.example`, tức mọi ảnh chụp bằng tài khoản quản trị. Dữ liệu mẫu là lệnh LSX26-0007 (Folder A4, 1.000
cái, Café Katinat) trên DB dev, chạy đủ bảy bước từ In tới đóng lệnh nhóm NTP26-1465.

Chạy trong thư mục này, ảnh ghi thẳng vào `../hinh`:

    node chup-ui.mjs c08-kcs.mjs ../hinh

`DT=1` mở khung điện thoại 390x844. Biến `BUOC` chọn đoạn của kịch bản (đọc chú thích đầu từng file).
Nhiều đoạn GHI dữ liệu thật, chạy lại sẽ ghi thêm vào DB, nên chỉ chạy lại các đoạn "chỉ chụp" trên DB
đã có sẵn lệnh ở đúng trạng thái.

| File | Chương | Ảnh |
|---|---|---|
| c02-man.mjs, `DT=1` c02b-dien-thoai.mjs | 2 Màn Việc của tổ (chỉ chụp) | vtt-10 đến 15 |
| c03-bat-dau.mjs (`BUOC=1` chụp, `2` Bắt đầu), c03b-tra-khuon.mjs | 3 Giao người và bắt đầu | vtt-21 đến 26 |
| c04-san-luong.mjs (`BUOC=1` hộp, `2` ghi 150 và 100, `3` hộp Sửa số) | 4 Ghi sản lượng | vtt-30 đến 32 |
| c05-giao-nhan.mjs (`BUOC=1`, `2`, `4` chụp, `3` Xác nhận) | 5 Giao và nhận | vtt-24, 40 đến 43 |
| c06-vat-tu.mjs | 6 Vật tư (chỉ chụp) | vtt-50 đến 52 |
| c07-dung-ket-thuc.mjs (`BUOC=1` chụp, `2` Kết thúc) | 7 Tạm dừng, kết thúc, đổi máy, báo dừng máy | vtt-60 đến 63 |
| c08-kcs.mjs (`BUOC=1` đến `8`), c08b-to-xem-loi.mjs, c09-kho-nhan.mjs | 8, 9 KCS, gửi kho, đóng lệnh | vtt-70 đến 84 |

Thứ tự đã chạy để dựng dữ liệu: c03 (1, 2), c04 (1, 2, 3), c05 (1), c06, c07 (1, 2), rồi `chay-buoc.mjs` cho
từng bước còn lại của lệnh, xen c05 (2, 4, 3) ở bước Ép kim và c03b ở bước Khuôn hộp. Sau đó c08 (1, 2, 3),
c08b, c08 (5, 6), `GHI=1` c09, c08 (7, 8). c02 và c02b chụp lúc lệnh đang chạy dở.

`chay-buoc.mjs` chạy trọn một việc của LSX26-0007 ở một tổ (xác nhận nhận hàng, nhận khuôn, Bắt đầu, ghi
sản lượng, Kết thúc): `TO=<id tổ> THU=<thứ tự việc> SL="150,100" KET=0 KHUON=<tên ảnh>`. `xem.mjs` mở một
màn rồi in chữ ra để dò. `c08-kcs.mjs` tự vẽ `anh-loi-mau.png` làm ảnh lỗi để tải lên.

`xuat-so-do.mjs <html> <png>` xuất sơ đồ archify (`.archify/workflow-luong-viec-cua-to-*/`) ra
`vtt-00-luong.png`. `kiem-lien-ket.py <thư mục docs>` kiểm mọi liên kết sang PDF Cấu hình và Kế hoạch SX trỏ
tới mục có thật (cần `pip install pypdf`).
