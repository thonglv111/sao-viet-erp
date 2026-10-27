# Kho: kịch bản bấm thử (28/10/2026)

Chạy trên SQLite sao từ seed demo (Postgres/Docker đang hỏng). BE worktree :8021, FE :5185.
Dữ liệu nền có sẵn: đơn vị (1 ram = 500 tờ, 1 tấn = 1000 kg), giấy COUCHE-150-79x109 (150 gsm), COUCHE-300-65x86,
vật tư KEO-GAY (kg), MANG-BONG (m²), kho KHO-TP.

## A. Dựng
1. Khai báo kho: thêm "Kho giấy test" (KGT), khai hai vị trí K1, K2.
2. Phân quyền vai của admin: dòng Kho giấy test bật Xem, bật ô chi tiết "Thêm, xoá, import, export hàng" ⇒ ô Xem giá thành
   tự bật và bị khoá. Lưu.

## B. Thêm / Sửa tồn (form)
1. Thêm COUCHE-150-79x109, khổ 790 × 1090, 2 ram, đơn giá 1.500.000 ⇒ xem trước "Thêm dòng mới"; Lưu ⇒ dòng 1.000 tờ, giá trị 3.000.000.
2. Thêm lại cùng mã, khổ 1090 × 790 (đảo cạnh), 1.000 tờ ⇒ "Không đổi", nút Lưu tắt.
3. Chọn dòng ⇒ Sửa tồn ⇒ 1.500 tờ, đơn giá 3.300 ⇒ xem trước "Số lượng 1.000 tờ → 1.500 tờ"; Lưu ⇒ 1.500, 2 lô.
4. Sửa tồn ⇒ 700 tờ ⇒ trừ lô nhập trước, giá trị = 700 × 3.300... (lô 1 còn 0, lô 2 còn 500 + ...). Đúng FEFO/FIFO.
5. Giấy khổ chỉ rộng (cuộn) ghi ĐVT tờ ⇒ lỗi "không đếm theo tờ"; ghi kg ⇒ được.
6. Giấy khổ hai cạnh ghi kg ⇒ quy ra tờ làm tròn xuống.
7. Vật tư KEO-GAY 18 kg; MANG-BONG khổ 320 ⇒ dòng riêng theo khổ.
8. Lỗi: mã không có; ĐVT "ream"; số âm; hàng mới không đơn giá; vị trí không có trong kho (kho đã khai vị trí).
9. Ngày nhập trước kỳ ⇒ vào Đầu kỳ của báo cáo kho; trong kỳ ⇒ vào Nhập.

## C. Xem theo ĐVT
1. Dòng giấy tờ: ô ĐVT có tờ / ram / kg. Chọn ram ⇒ Đang có, Sắp xuất, Dự kiến, Mức tồn chia 500; Giá trị giữ nguyên.
2. Tải lại trang ⇒ vẫn ram. Đổi về tờ ⇒ số gốc.
3. Không còn cột Quy kg.

## D. Excel
1. Xuất Excel ⇒ file `ton-kho-KGT.xlsx`, đủ dòng, giá theo gốc.
2. Nhập lại file vừa xuất ⇒ xem trước toàn "không đổi".
3. Sửa file: tăng một dòng, thêm một dòng mới, một dòng ĐVT sai ⇒ xem trước báo lỗi đúng dòng/cột, chưa ghi gì.
4. Sửa dòng lỗi ⇒ xem trước cũ → mới ⇒ Nhập ⇒ số đổi đúng.
5. Nhập file của kho khác ⇒ báo cả file sai kho.
6. Tải file mẫu.

## E. Xoá
1. Chọn hai dòng ⇒ Xoá khỏi kho ⇒ hộp xác nhận liệt kê đúng ⇒ Xoá ⇒ biến mất; phiếu nhập tay rỗng biến khỏi tab Phiếu nhập.

## F. Quyền
1. Tắt ô chi tiết ⇒ màn tồn không còn nút Thêm/Nhập/Xuất/Xoá/Sửa tồn.

## G. Kho liên quan (hồi quy)
1. Tab Phiếu nhập / Phiếu xuất hiện phiếu nhập tay, mở được.
2. Báo cáo kho: Nhập-xuất-tồn có tiền khớp màn tồn.
3. Đặt mức tồn một dòng ⇒ chip Tình trạng đổi; xem theo ram thì thước mức tồn cũng theo ram.
4. Yêu cầu nhập kho thường ⇒ lập phiếu ⇒ ghi sổ ⇒ tồn tăng trên cùng dòng.
5. Ngăn chi tiết mặt hàng (bấm dòng): lô, lịch sử nhập xuất có phiếu nhập tay.
