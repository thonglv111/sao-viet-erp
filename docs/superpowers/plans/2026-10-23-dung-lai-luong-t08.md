# Dựng lại lương T08/2026 trên máy — kế hoạch

Mục tiêu: chạy tháng 8/2026 qua phần mềm (lệnh → ghi sản lượng → chấm công → kỳ lương) cho ra bảng
lương giống sổ `D:\BẢNG LƯƠNG T08.2026 ( 12.09).xls`; chỗ máy không tính được thì kế toán điều chỉnh
tay bằng tính năng của phiên "Kế toán điều chỉnh khoán" (`2026-10-23-ke-toan-dieu-chinh-khoan.md`).

## Bước 0 — dọn chứng từ (ĐÃ LÀM 23/10)

DB dev `svn_erp_trong`: xoá sạch tính giá, báo giá, đơn hàng, lệnh SX + mọi bảng sản xuất, kho (yêu
cầu / phiếu / lô), mua hàng, giao hàng, hoá đơn, phiếu thu/chi. Giữ danh mục (khách, NCC, giấy, vật
tư, máy, công đoạn khoán, tổ, nhân viên + hồ sơ lương), chấm công, kỳ lương T09/T10.
Bản lưu: `svn_erp_trong-truoc-xoa-chung-tu-23102026.dump` ở gốc repo (`pg_restore` lại được).

## Bước 1 — lệnh T08

Một lệnh cho mỗi số lệnh xuất hiện ở các sheet tổ (In 5 máy, CM, Bồi, Bế, Gỡ, Dán, TP, Cột dây,
Cắt). Quy cách chỉ điền đủ cho công thức khoán: số kẽm + màu pha (suy từ mã bài A/B/C/F/G/H), khổ
tờ nguyên + định lượng (sheet cắt), khổ in (CM/bồi), số con (bế/gỡ). Khách lấy từ cột Khách hàng.

## Bước 2 — lần ghi sản lượng

Mỗi dòng sổ có tiền = một lần ghi ở tổ của nhóm, đúng ngày, người làm = người của nhóm, mã sổ →
công đoạn + tick như các test bao quát (`backend/tests/test_khoan_*_bao_quat.py`).

## Bước 3 — chấm công T08

Từ sheet `CÔNG T8` / `TỎNG CÔNG`: ngày công, Chủ nhật, giờ tăng ca từng người.

## Bước 4 — kỳ lương T08 + so

Tạo kỳ T08, Tính lại, so từng người: tiền khoán (sheet tổ "Lương SP"), lương thời gian, bên cao
hơn, với BL CT. Lệch nào ra danh sách: lỗi máy ⇒ sửa; ca đã chốt "kế toán sửa tay" (thử việc làm
loãng canh, lệnh vắt kỳ, việc theo giờ TP / dọn kho, dòng sổ không trả) ⇒ để phiên kế toán điều
chỉnh làm thử trên chính kỳ này.

## Còn hỏi

Nhập bước 1–3 (vài nghìn dòng) bằng script qua API, chỉ bấm UI ở màn xem kết quả (Khoán theo tổ,
kỳ lương) — lệch quy tắc "bấm luồng thật" của CLAUDE.md, cần chủ đồng ý.
