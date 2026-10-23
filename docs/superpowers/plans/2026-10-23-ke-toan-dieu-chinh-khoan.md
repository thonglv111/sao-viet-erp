# Kế toán lương sửa tay khoán kiểu Excel — kế hoạch

Ngày lập: 23/10/2026. Chủ chốt mockup `docs/mockups/ke-toan-dieu-chinh-khoan-excel.html` ("ok chốt, viết lại plan
rồi làm đi"). Bản cũ (ngăn bên phải, sửa từng số trong công thức, người hưởng, khoản bù kỳ trước…) chủ BÁC vì
"sửa được nhiều quá, nhét rối" — đừng dựng lại.

## Mục tiêu

Khi máy tính khoán không đáp ứng, kế toán lương gõ tay ở màn Lương → Khoán theo tổ như gõ Excel. Chỉ ba chỗ
gõ được, mọi chỗ khác chỉ đọc:

1. **Ô Tiền của một lần ghi** (Sổ sản lượng). Gõ số mới thay số máy; máy vẫn chia số đó như mọi lần ghi
   (luật ngày, trích tổ trưởng, tăng ca khoán). Xoá trắng / Delete ⇒ trả về số máy. Lần ghi máy chưa tính
   được (thiếu giá, công thức lỗi) vẫn hiện trong sổ với tiền 0 để kế toán gõ.
   Ca dùng: thử việc ghi riêng lượt máy chạy chung với nhóm (canh bị chia đôi), lệnh vắt hai kỳ lương.
2. **Dòng tay** — dòng trống cuối Sổ sản lượng, gõ vào là thành một dòng: ngày, nội dung, tiền, người tham gia
   (mặc định cả tổ, tick bớt), không gắn lệnh. Vào quỹ tổ và chia như lần ghi (trích tổ trưởng). KHÔNG áp hệ
   số ngày CN/lễ và KHÔNG vào quỹ so chỉ tiêu ngày (tiền kế toán gõ là tiền chốt). Xoá bằng chuột phải.
   Ca dùng: việc trả theo giờ tổ Thành phẩm (lao bột, gấp hộp, kiểm lựa — chủ chốt KHÔNG tạo công đoạn
   "việc theo giờ", xem spec hai lương dòng Thành phẩm).
3. **Cột Cộng thêm** ở Chia cho người — ± tiền từng người, cộng THẲNG vào lương ngoài phép so 2 lương, không
   trích tổ trưởng, không vào quỹ tổ. Như cột "Cộng bổ sung tiền canh máy" sổ T08 (sheet DÁN).

Mọi dòng (lần ghi, dòng tay, người ở Chia cho người) có cột **Ghi chú** cuối dòng, gõ như ô khác. Ghi chú
không bắt buộc.

Ô gõ tay có tam giác đỏ ở góc; ô Tiền lần ghi đã đè hiện số máy gạch ngang bên dưới. Rê chuột: số máy, ai gõ,
lúc nào. Kỳ lương đã chốt/đã chi ⇒ không gõ được gì. Xưởng (`san_xuat_batch`) không bị đụng.

Thao tác: bấm ô để chọn, gõ luôn hoặc bấm đúp/Enter/F2; Enter lưu và xuống ô dưới cùng cột, Tab sang phải,
Esc bỏ, mũi tên lên/xuống đi lại.

## Lưu trữ (bảng mới do `create_all` tạo; cột mới qua `db_migrations.py`)

- `khoan_lan_ghi_tay` — một lần ghi tối đa một dòng: `batch_id` (FK `san_xuat_batch` CASCADE, UNIQUE),
  `tien` (Numeric, null = không đè), `ghi_chu`, `sua_boi_id` (soft → users, KHÔNG FK để xoá tài khoản không
  cuốn mất tiền đã sửa), `sua_luc`. Cả `tien` lẫn `ghi_chu` rỗng ⇒ xoá dòng.
- `khoan_dong_tay` — `nam`, `thang`, `department_id` (FK CASCADE), `ngay`, `noi_dung`, `tien`, `nguoi_ids`
  (JSON), `ghi_chu`, `sua_boi_id`, `sua_luc`.
- `khoan_cong_them` — `nam`, `thang`, `department_id`, `employee_id` (FK CASCADE), `tien`, `ghi_chu`,
  `sua_boi_id`, `sua_luc`; UNIQUE(nam, thang, department_id, employee_id).
- `payroll_lines.khoan_cong_them` (mg 0438) — tổng Cộng thêm của người trong kỳ, cộng vào gross sau phép so.

`docs/DB_SCHEMA.md` cập nhật cùng lúc.

## Tính (một nguồn: `KhoanKyService.tinh`)

- Lần ghi có `khoan_lan_ghi_tay.tien` ⇒ `tien` (gồm phát sinh) = số đè, rồi chạy tiếp luật như cũ. Cảnh báo
  "thiếu giá…" của lần đó rụng. `so=True` trả thêm `tien_may`, `tay`, `ghi_chu_tay`, `sua_boi`, `sua_luc`.
- Dòng tay: chia theo lương ca máy của `nguoi_ids`, vào `phan` (để tổ trưởng trích), hệ số 1, không vào
  `quy_ngay`. Ngăn soi khoán ở bảng lương thấy dòng đó như một lần ghi (nội dung thay tên công đoạn).
- Trả thêm `cong_them: {emp: tiền}`; `payroll_service.generate` đưa vào `_compute(khoan_cong_them=…)`,
  cộng gross ngoài phép so, lưu `payroll_lines.khoan_cong_them`; `update_line` cộng lại cùng cách. Phiếu
  lương hiện dòng "Cộng thêm khoán". Bảng lương tháng chỉ nhận số mới sau Tính lại (như mọi thay đổi khoán).

## API (`routers/payroll.py`, ghi cần quyền `update` của Lương, xem cần `view_payroll_table`)

- `GET /khoan-theo-to` thêm: mỗi dòng sổ `loai` (`lan_ghi`/`dong_tay`), `dong_tay_id`, `noi_dung`, `tien_may`,
  `tay`, `ghi_chu_tay`, `sua_boi`, `sua_luc`; `nguoi[].cong_them*`; `thanh_vien` (người của tổ cho ô chọn);
  `khoa` (kỳ đã chốt), `sua_duoc` (có quyền ghi và kỳ chưa chốt).
- `PUT /khoan-theo-to/lan-ghi/{batch_id}` `{tien?, ghi_chu?}`.
- `POST /khoan-theo-to/dong-tay`, `PATCH /khoan-theo-to/dong-tay/{id}`, `DELETE /khoan-theo-to/dong-tay/{id}`.
- `PUT /khoan-theo-to/cong-them` `{year, month, to_id, emp_id, tien?, ghi_chu?}`.
- Kỳ đã chốt ⇒ 409 (`PayrollLocked`). Người ngoài phạm vi nhân sự ⇒ 403.

## FE (`KhoanTheoToTab.tsx`)

Ô gõ kiểu Excel theo mockup; sau mỗi lần lưu tải lại payload màn (số do máy chủ tính, không tự tính ở JS).
Khối "Người của tổ làm ở tổ khác" chỉ đọc.

## Kiểm

- pytest nhắm file: `tests/test_khoan_ky_tay.py` (đè tiền, trả về, thiếu giá có đè, dòng tay chia + tổ trưởng
  + không tăng ca, cộng thêm vào lương ngoài phép so, kỳ chốt chặn, phạm vi), `test_schema_documented.py`.
- vitest `KhoanTheoToTab.test.tsx` + `npx tsc --noEmit`.
- Bấm thật trên dev-browser: tổ Dán - nhóm 1 tháng 10/2026, lần ghi LSX26-0003 1.000 cái 45.000 → 70.000,
  dòng tay, Cộng thêm, ghi chú, trả về số máy; báo cáo từng bước.

## Ngoài phạm vi

Sửa số đưa vào công thức (số lần ghi, tick, đơn giá), tiền cố định từng người, thêm/bớt người hưởng lần ghi,
khoản bù kỳ trước riêng, chip/bộ lọc vắt kỳ, đẩy real-time. Tổ chưa có lần ghi nào trong kỳ chưa hiện trong ô
chọn tổ nên chưa thêm dòng tay được.
