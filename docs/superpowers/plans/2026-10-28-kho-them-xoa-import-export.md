# Kho: thêm, xoá, import, export, xem theo ĐVT — plan

Spec: `docs/superpowers/specs/2026-10-28-kho-them-xoa-import-export.md`. Mẫu Excel: `docs/mockups/kho-ton-kho-file-*.xlsx`.

## Task 1 — Dữ liệu + quyền
- mg `0451_nhap_tay_kho`: `stock_requests.nhap_tay` Boolean server_default false. Model + `docs/DB_SCHEMA.md`.
- Ô chi tiết `can_adjust` trên dòng `ton_kho_<id>` (dùng lại cột, không migration). Bật nó ⇒ `can_view_cost` bật kèm.

## Task 2 — Service `services/kho_nhap_tay.py`
- `doc_dong(kho_id, dong) -> KeHoach | lỗi`: tra mã (giấy + vật tư, không thành phẩm), khổ chuẩn hoá, ĐVT → gốc
  qua `VatLieuKhoService.quy_ve_goc`, luật cuộn không đếm tờ, vị trí phải có trong `kho_vi_tri` của kho (kho chưa
  khai vị trí nào thì nhận chữ tự do), ngày nhập không rơi vào kỳ khoá / đã tính giá.
- `ap(kho_id, ke_hoach, user)`: SL mới > hiện có ⇒ yêu cầu NHAP `nhap_tay` + phiếu nhập + `_apply_post`;
  SL mới < hiện có ⇒ yêu cầu XUAT `nhap_tay` + phiếu xuất trừ lô FEFO/FIFO; vị trí áp mọi lô còn tồn.
- `them(...)`, `nhap_excel(..., ghi)` (xem trước = chạy thật rồi rollback), `xuat_excel`, `mau_excel`, `xoa(kho_id, khoas)`.

## Task 3 — Router `/api/kho/{kho_id}/hang` + quyền `ton_kho_<id>:adjust`
- `POST /them`, `POST /xoa`, `GET /mau-excel`, `GET /xuat-excel`, `POST /import-excel?mode=`, `GET /don-vi` (hệ số).
- Sau ghi: `sau_ghi_so` (giữ chỗ tính lại + SSE) + `phat_su_kien_kho`.

## Task 4 — Xem theo ĐVT khác
- `/lo/ton-nhom` trả `don_vi_xem` (đơn vị → hệ số so với gốc) cho từng dòng; FE ô ĐVT thành ô chọn, nhớ theo mặt hàng; bỏ cột Quy kg.

## Task 5 — Frontend
- `PermissionMatrix`: ô chi tiết "Thêm, xoá, import, export hàng" cho dòng kho, bật kèm Xem giá thành.
- `KhoTonKhoPage`: nút Thêm hàng / Import / Export / Xoá theo quyền; ngăn Thêm–Cập nhật; `ImportExcelDialog` có bảng "cũ → mới".

## Task 6 — Kiểm
- pytest `tests/test_kho_nhap_tay.py` cho từng luật spec mục 3–7b; vitest form; bấm thử trên SQLite (Postgres đang hỏng).
- Kịch bản bấm thử mọi luồng kho (spec + khổ + ĐVT), lỗi thì sửa.
