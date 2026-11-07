# Tài liệu PDF đi kèm code

Đọc file này trước khi báo xong một thay đổi logic hoặc UI (màn, nhãn, nút, cột, quyền, luồng, công thức, thứ tự khai) mà tài liệu có mô tả. Đây là luật cứng: sửa luôn tài liệu trong cùng lượt việc, chưa sửa thì chưa được báo xong.

## Bốn cuốn

| File | Nội dung |
| --- | --- |
| `docs/huong-dan-cau-hinh/cau-hinh-he-thong.tex` | Khai báo, danh mục, phân quyền, nhân sự, lương |
| `docs/huong-dan-kinh-doanh/huong-dan-su-dung-kinh-doanh.tex` | Tính giá, báo giá, đơn bán, khách hàng |
| `docs/huong-dan-ke-hoach-sx/huong-dan-ke-hoach-san-xuat.tex` | Hàng chờ, lệnh SX, kế hoạch vật tư, xếp lịch, phát hành, gia công ngoài, theo dõi sản xuất, hồ sơ lệnh |
| `docs/huong-dan-viec-cua-to/huong-dan-viec-cua-to-va-kcs.tex` | Việc của tổ (giao người, bắt đầu, ghi sản lượng, giao nhận, vật tư của việc, tạm dừng, đổi máy, báo dừng máy), KCS, gửi nhập kho, đóng lệnh |

## Các bước

1. Grep tên màn, nhãn, nút vừa đổi trong cả bốn file `.tex`.
2. UI đổi thì chụp lại ảnh liên quan trong `hinh/` của cuốn đó; hai cuốn Kế hoạch SX và Việc của tổ có kịch bản chụp ở `kich-ban/`. Sơ đồ archify sai thì vẽ lại.
3. Biên dịch XeLaTeX 2 lần, 0 tham chiếu treo, dọn `*.aux *.log *.out *.toc`.
4. Đổi `\label` thì kiểm lại liên kết chéo: từ PDF Kinh doanh, Kế hoạch SX, Việc của tổ sang PDF Cấu hình; từ PDF Kế hoạch SX sang PDF Kinh doanh; từ PDF Việc của tổ sang PDF Kế hoạch SX. Đích là tên `\label`, cả bốn file bật `destlabel=true`, `kich-ban/kiem-lien-ket.py` của hai cuốn trên kiểm.
5. Commit `.tex`, `.pdf` và ảnh cùng commit với code.

Thay đổi không đụng nội dung tài liệu nào thì nói rõ một câu "không ảnh hưởng tài liệu" trong báo cáo.
