# Giao diện

Đọc file này trước khi làm hoặc sửa màn, bảng, form, ngăn hay mockup. Giá trị thị giác và luật CSS nằm ở [docs/UI_DESIGN.md](../../docs/UI_DESIGN.md); đổi luật ở đó thì đổi cả `tokens.css` và `global.css`.

## Trước khi vẽ

"ui/ux lại" một màn hoặc một khối nhập liệu lớn thì chưa sửa code. Nhắc lại logic bằng 3–5 câu thường và chờ gật, đọc đủ code FE và BE của chỗ đó, mở trang thật của sản phẩm tham khảo (ghi tên theo trí nhớ không tính là tham khảo), rồi dựng 3 phương án HTML ở `docs/mockups/` bằng token và phông thật của app. Khối hoặc bảng nhỏ trong một tab thì tả 2–3 hướng bằng lời là đủ; chủ dự án nói bỏ mockup thì làm thẳng. Vá nhỏ như đổi chữ không cần các bước này.

Khoanh chỗ nào sửa chỗ đó, giữ chiều cao và khung đang có; thứ phụ đưa vào `title` hoặc bong bóng, không thêm dòng.

Màn đi theo logic công việc của người dùng, chữ là chữ xưởng nói, nhãn ô nói rõ có bắt buộc không. Gọi màn của tổ là "Việc của tổ", không gọi "bàn tổ". Màn thao tác tại xưởng dùng nút to, số lớn, luồng bấm cố định vì tay bận và nhìn lướt.

## Trình bày

- Mỗi thông tin nói một lần trên màn, kể cả băng KPI phía trên. "Gọn" là bớt thông tin trùng và giữ khoảng trắng, không phải bóp đệm.
- Không nối thông tin bằng `·` hay dấu phẩy, kể cả chuỗi máy chủ trả rồi frontend in thẳng. Tách bằng hình: thẻ nhỏ nền `--rule-hair`, cách bằng khoảng trống.
- Giấy có cột định lượng và khổ riêng, lấy từ danh mục giấy và chỉ hiển thị, không nhét vào tên hàng.
- Không in đậm biển số, tên người, mã chứng từ; dùng weight 400–500 và độ mờ để phân cấp.
- Hover nền `--rule-hair`, không tô hồng hay đào. Phần tử đang chọn là viền đủ bốn cạnh, nền trắng, chữ đậm; không dùng viền một cạnh.
- Chip trạng thái lấy màu từ `--tt-<sắc>-bg/-fg/-dot` trong `tokens.css`, không cắm hex mới; hai trạng thái khác nhau trong một bảng không trùng màu. Quy ước: chờ duyệt vàng, mới tạo xanh dương, đang làm cyan hoặc chàm, tạm dừng cam, xong lá, từ chối đỏ, huỷ xám, nháp slate.
- Màn tổng quan và danh sách mặc định là lưới đặc kiểu Excel, ô cao khoảng 34px, chữ 13px; thông tin lệch đưa vào cột Ghi chú. Kiểm cắt chữ bằng so `scrollWidth > clientWidth`.
- Màn tổng hợp chỉ bày việc còn sống: chưa khai thì vắng mặt im lặng, làm xong thì rụng. Câu nhắc đặt ở đúng cửa chặn nghiệp vụ.
- Dấu "chưa xem" là chấm, không hiện số; nhìn thấy bản ghi trên danh sách là đã xem. Nạp lại phải đi tới đúng nguồn số của dấu đó.

## Danh sách và bảng

- Phân trang và lọc ở máy chủ: gửi `page`, `size`, `q`, bộ lọc lên API. Khi chuyển một màn sang, rà những thứ ngầm dựa vào "đã có toàn bộ dòng": số đếm trên tab (backend trả `facets`), gợi ý mã kế tiếp, cảnh báo trùng mã, effect nạp dữ liệu phụ.
- Danh sách chứng từ dùng `pages/thanh-loc/ThanhLoc`, kỳ gửi máy chủ theo `tu_ngay`/`den_ngay`/`moc`, ghi bộ lọc lên URL, bảng có cột Ngày tạo. Khuôn mẫu: `pages/loc-kinh-doanh/dieu-kien-bao-gia.ts`.
- Chân bảng dùng `components/PhanTrangDayDu.tsx`, mặc định 25 dòng. Khung bảng chỉ `overflow-x: auto`, không `max-height`.
- Lưới mới dùng `useCauHinhLuoi` để có kéo rộng và ghim cột.

## Form và ngăn

- Ô ngày giờ dùng `components/ChonNgay.tsx`, không dùng `<input type="date">` và các kiểu tương tự của trình duyệt. Ô trống và ô sai là hai trạng thái khác nhau; kiểm bằng `gioNhapHopLe` và `gioNhapSai` trong `lib/gioNhap.ts`.
- Ô tự định dạng theo từng phím (chấm nghìn, lọc chữ số) dùng `components/OGoDinhDang.tsx`, vì bộ gõ tiếng Việt của Windows làm lệch số trên `<input>` trần. Kiểm bằng CDP `Input.imeSetComposition`.
- Ngăn chi tiết có đầu ngăn cố định và tab bên dưới, mép trái kéo được để nới rộng. Không gộp tab thành trang cuộn.
- Màn ngoài Kế toán dùng `NganPhai` phải tự import `pages/ke-toan/ke-toan.css`; kiểm bằng cách tải thẳng URL màn đó trên tab mới.
- Form sửa rộng giữ nhãn trái, giá trị phải; không xếp lưới ba ô nhãn trên giá trị dưới.

## Chữ và mã

Mã `cong_doan.don_vi_vao/ra` và các cột kế thừa là mã chặng dòng giấy, không phải mã đơn vị kho. Frontend dịch bằng `nhanChang` trong `pages/lsxBuoc.ts`, đừng in thẳng mã ra màn.

## Điện thoại

Lỗi hiển thị ở 375px thường theo khuôn, sửa theo khuôn nhanh hơn dò từng màn. Hai khuôn hay gặp: hàng flex `justify-content: space-between` làm tiêu đề rơi dọc thì thêm `flex-wrap: wrap` và cho khối chữ `flex: 1 1 <basis>`; bảng `width: 100%` trong khung `overflow-x: auto` không nở cột thì đặt `min-width` cho bảng.
