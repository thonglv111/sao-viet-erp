# Kịch bản chụp ảnh cho Hướng dẫn Kế hoạch sản xuất

Mỗi file `cNN-*.mjs` lái trình duyệt thật (Playwright, Chrome) trên dev `http://localhost:5173` (đổi bằng biến
`BASE`, ví dụ `BASE=http://localhost:5174` khi chạy dev thứ hai), bấm đúng
luồng của một chương rồi chụp ảnh có ô đỏ đánh số. Đăng nhập lấy `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD`
ở `.env.example`. Dữ liệu mẫu là đơn DH003 (Café Katinat), lệnh LSX26-0007, 0008, 0009 trên DB dev.

Chạy trong thư mục này, ảnh ghi thẳng vào `../hinh`:

    node chup-ui.mjs c05-xep-lich.mjs ../hinh

Biến `BUOC` chọn đoạn của kịch bản (đọc chú thích đầu từng file). Nhiều đoạn có thao tác ghi dữ liệu thật
(tạo lệnh, giữ hàng, gửi đề nghị mua, phát hành, thu hồi, đặt gia công trọn gói), chạy lại sẽ ghi thêm vào DB:

| File | Chương | Ảnh |
|---|---|---|
| c02-nhan-don.mjs | 2 Nhận đơn và tạo lệnh | khsx-10, 11 |
| c03a-ra-lenh.mjs, c03b-san-sang.mjs | 3 Rà lệnh | khsx-20 đến 24 |
| c03c-cong-doan.mjs | 3 Rà lệnh, tab Công đoạn và ngăn bước (Loại, Bộ phận nhận) | khsx-22, 23 |
| c04-vat-tu.mjs | 4 Vật tư (`BUOC=1` giữ hàng, `BUOC=2 GUI=1` đề nghị mua) | khsx-30 đến 34 |
| c05-xep-lich.mjs | 5 Xếp lịch (`BUOC=1` kéo thả, `2` ngăn, `3` thu hồi rồi phát hành, `4` chỉ chụp, `5` lệnh LSX26-0011 chưa có giờ: thu hồi, phát lại, khay chip Đã phát) | khsx-40 đến 47, 40b |
| c08-ke-hoach-bo-phan.mjs | Kế hoạch bộ phận (Tổ in: trả về khay, hộp lý do rồi Huỷ, xếp IN-02, chọn nhóm, ngăn Quy cách in; không bấm Giao) | khsx-48, 48b, 49 |
| c06-gia-cong.mjs | 6 Gia công ngoài (`BUOC=1` một phần, `2` đặt trọn gói, `3` chọn giấy) | khsx-50 đến 54 |
| c07-theo-doi.mjs | 7 Theo dõi (`BUOC=1` theo đơn, `2` hồ sơ lệnh) | khsx-60 đến 64 |

`xuat-so-do.mjs <html> <png>` xuất sơ đồ archify ra `khsx-00-luong.png`. `kiem-lien-ket.py <thư mục docs>`
kiểm mọi liên kết sang PDF Cấu hình và Kinh doanh trỏ tới mục có thật (cần `pip install pypdf`).
