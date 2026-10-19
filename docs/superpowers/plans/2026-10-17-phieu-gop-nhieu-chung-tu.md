# Phiếu chi / phiếu thu gộp nhiều chứng từ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một phiếu chi trả nhiều khoản (cọc, đợt giao, nhiều đơn) của CÙNG một nhà cung cấp; một phiếu thu thu nhiều khoản (hoá đơn, cọc, nhiều đơn) của CÙNG một khách. Mỗi phiếu một số PC/PT, bên trong có bảng phân bổ. Kèm popup chi tiết khoản kiểu B (docs/mockups/chi-tiet-khoan-cho-3-phuong-an.html, phương án B) cho hai hàng chờ.

**Architecture:** Thêm hai bảng phân bổ `payment_voucher_lines` / `payment_receipt_lines` — từ nay là NGUỒN DUY NHẤT cho "tiền của phiếu đi vào chứng từ nào". Phiếu một chứng từ giữ nguyên cột nguồn trên đầu phiếu và được hook `before_flush` tự sinh đúng một dòng (mọi đường lập cũ, seed, test đều nhất quán mà không phải sửa). Phiếu gộp để trống cột nguồn đầu phiếu, chỉ có dòng. Mọi chỗ tính tiền theo đơn/đợt/hoá đơn chuyển sang đọc dòng; chỗ chỉ cần tổng theo NCC/khách (sổ 331/131, báo cáo thu chi, thống kê tài khoản) vẫn đọc đầu phiếu.

**Tech Stack:** FastAPI + SQLAlchemy 2 (Postgres dev/prod, SQLite test), React 18 + TS + Vitest.

**Spec:** cuộc trao đổi 17/10/2026 (chủ: "một phiếu cho cả lượt… để ý mobile, công nợ, báo cáo công nợ, báo cáo thu chi"); mockup B ở trên.

## Global Constraints

- UI tiếng Việt; không chữ đậm cho mã/tên; không nối dữ liệu bằng "·" hay dấu phẩy; mỗi thông tin nói một lần.
- Không Alembic: bảng mới do `create_all` dựng, cột mới + backfill viết ở `backend/app/db_migrations.py` mục `0416_phieu_gop_phan_bo`. Backfill bằng raw SQL đích danh cột, đọc inspector TRƯỚC lệnh ghi đầu tiên.
- Mọi bảng/cột mới ghi vào `docs/DB_SCHEMA.md` (guard test).
- Tiền chỉ VND cho phiếu gộp (`currency = VND`, `exchange_rate = 1`).
- Phiếu gộp: tối đa 50 dòng; mọi dòng cùng NCC (chi) / cùng khách (thu); không hai dòng trùng một khoản.
- Trần từng dòng = trần của khoản đó như phiếu lẻ (đợt: `con_no`; cọc mua: `tran_dat_coc`; hoá đơn: `remaining_amount`); cọc bán không trần (giữ luật phiếu cọc lẻ). Số tiền phiếu = tổng các dòng.
- Thẩm định mọi dòng trước, ghi một lần, một commit.
- Gửi nội bộ real-time: lập/huỷ phiếu gộp đẩy SSE như phiếu lẻ, cho MỌI đơn liên quan.
- Verify: `python -m pytest tests/<file> -q` từ `backend/`, `npx tsc --noEmit -p .` và `npx vitest run <paths>` từ `frontend/`. KHÔNG chạy `./init.ps1` hay pytest cả bộ.
- Bấm thử UI trên BẢN SAO DB (`svn_erp_ui_gop`, Redis riêng, cổng 8010/5174), không lập phiếu thử trên DB dev.

## Review Focus

1. Phiếu gộp bị HUỶ: mọi khoản trong đó phải quay lại hàng chờ, công nợ, cọc đơn — kiểm ở cả chi lẫn thu (test trong Task 3 và Task 5).
2. Hai dòng của cùng một đơn mua (cọc + đợt, hoặc hai đợt) trong một phiếu: trần cọc và trần đợt tính độc lập, không cộng dồn sai (Task 3).
3. Hoá đơn bán bị huỷ sau khi đã thu bằng phiếu gộp: chỉ phần dòng của hoá đơn đó chảy vào quỹ đơn, các dòng khác giữ nguyên (Task 4).
4. Báo cáo/sổ công nợ theo kỳ (`den_ngay`) với phiếu gộp: tổng theo NCC/khách không đổi so với cộng các phiếu lẻ tương đương (Task 2, Task 4).
5. Phiếu gộp không nhận "nộp lại tiền thừa" (phiếu thu hoàn phiếu chi) — báo lỗi rõ thay vì trừ nhầm cọc của một đơn (Task 3).

---

### Task 1: Bảng phân bổ + migration + dòng mặc định

**Files:**
- Modify: `backend/app/models/accounting.py` (thêm `PaymentVoucherLine`, `PaymentReceiptLine`, `PaymentReceipt.customer_id`, quan hệ `lines`)
- Modify: `backend/app/models/purchase.py:284` (thêm `PurchaseRequest.khoan_chi`)
- Modify: `backend/app/db_migrations.py` (mục `0416_phieu_gop_phan_bo`)
- Modify: `docs/DB_SCHEMA.md`
- Test: `backend/tests/test_phieu_gop_phan_bo.py` (mới)

**Interfaces — Produces:**
- `PaymentVoucherLine` (`payment_voucher_lines`): `id`, `payment_voucher_id` FK CASCADE, `purchase_request_id` FK RESTRICT, `delivery_id: int|None` (NULL = cọc), `amount_vnd: int`. Quan hệ `voucher`, `purchase_request`. Thuộc tính đọc qua phiếu: `status`, `voucher_date`, `paid_at`, `code`, `doc_no`, `voucher_id`; `payment_stage` = `advance` nếu `delivery_id is None` ngược lại `final`; `receipts` = `voucher.receipts` khi phiếu có đúng một dòng, ngược lại `[]`.
- `PaymentReceiptLine` (`payment_receipt_lines`): `id`, `payment_receipt_id` FK CASCADE, `order_id` FK RESTRICT NOT NULL, `sales_invoice_id` FK RESTRICT NULL (NULL = dòng cọc), `amount_vnd`. Quan hệ `receipt`, `order`, `sales_invoice`.
- `PaymentReceipt.customer_id` FK customers SET NULL.
- Hook `before_flush` `_dong_phan_bo_mac_dinh(session)`: phiếu chi `source_type == purchase_request` có `purchase_request_id` và ≤ 1 dòng ⇒ đúng một dòng `(purchase_request_id, delivery_id, amount_vnd)`; phiếu thu có `sales_invoice_id` ⇒ một dòng hoá đơn (order_id lấy từ hoá đơn); `source_type == order_deposit` có `order_id` ⇒ một dòng cọc; điền `customer_id` nếu trống.

- [ ] Viết test: lập phiếu chi cọc lẻ và phiếu chi đợt lẻ qua service cũ ⇒ mỗi phiếu đúng một dòng khớp số; phiếu thu hoá đơn lẻ ⇒ dòng có `order_id` của hoá đơn và `customer_id` trên phiếu; phiếu thu cọc lẻ ⇒ dòng cọc; migration chạy hai lần không nhân dòng.
- [ ] Chạy test, thấy FAIL.
- [ ] Viết model, hook, migration (backfill: phiếu chi `purchase_request_id IS NOT NULL` ⇒ một dòng; phiếu thu `sales_invoice_id` ⇒ dòng hoá đơn, `source_type='order_deposit' AND order_id` ⇒ dòng cọc; `customer_id` từ hoá đơn hoặc đơn), DB_SCHEMA.
- [ ] Chạy `python -m pytest tests/test_phieu_gop_phan_bo.py tests/test_db_schema_doc.py -q` ⇒ PASS.

### Task 2: Phía chi đọc tiền từ dòng phân bổ

**Files:**
- Modify: `backend/app/services/purchase_service.py` (`phan_bo_tien_dot` :391, `coc_chua_bu` :485, `purchase_money` :539, `_chan_neu_dot_da_co_phieu_chi` :3267, `undo_received` :3860, `cancel` :3906, `_to_request_out` :4067)
- Modify: `backend/app/repositories/purchase_repo.py` (`_quan_he_tien` :49, `_dieu_kien_loc` deposit_status :1543, `list_for_payables` :1646)
- Modify: `backend/app/services/accounting_service.py` (`payables_summary` :1039-1053, `payables_detail` :1355-1401, `_doi_chieu_phieu_chi` :1464, `_voucher_out` :3974)
- Modify: `backend/app/repositories/accounting_repo.py` (`tong_chi_dot_truoc_phieu` :190, `_dieu_kien_phieu_chi` :302-326, `_voucher_stmt` :1381)
- Modify: `backend/app/schemas/accounting.py` (`PaymentVoucherOut.lines`, `PayablePaidOut`), `backend/app/schemas/purchase.py` (đợt: `phieu_chi[]`)
- Test: `backend/tests/test_phieu_gop_phan_bo.py`

**Interfaces — Produces:**
- Mọi vòng tiền dùng `row.khoan_chi` (dòng) thay `row.payment_vouchers`; `payment_voucher_count` = số phiếu khác nhau trong `khoan_chi`.
- `PaymentVoucherOut.lines: list[{purchase_request_id, purchase_code, delivery_id, delivery_seq_no, amount}]`; `purchase_request_id/code`, `delivery_id` đầu phiếu = NULL với phiếu gộp; `purchase_paid_amount` chỉ có nghĩa với phiếu lẻ.
- `PayablePaidOut` thêm `voucher_amount: int`, `so_dong: int` — một dòng kết quả cho mỗi dòng phân bổ, `amount` = tiền của dòng.
- Đợt trong `_to_request_out` thêm `phieu_chi: list[{voucher_id, code, doc_no, ngay, amount, gop: bool}]`; `coc_phieu` lấy số của dòng.
- `GET /payment-vouchers?purchase_request_id=` lọc bằng EXISTS trên dòng; tìm `q` theo mã đơn cũng qua dòng.
- `_doi_chieu_phieu_chi` trả `doi_chieu: list[{purchase_code, seq_no, truoc_do, con_no_sau}]` cho phiếu gộp (phiếu lẻ giữ `truoc_do`, `con_no_sau`).

- [ ] Viết test: dựng một phiếu chi gộp bằng ORM (đầu phiếu không nguồn, 3 dòng: cọc đơn A, đợt 1 đơn A, đợt 1 đơn B) ⇒ `purchase_money(A).net_paid` = cọc + đợt của A, `phan_bo_tien_dot(B)` đợt 1 `paid` = số dòng B; `payables_detail` ra 3 dòng đã trả, tổng = số phiếu; lọc phiếu chi theo đơn B thấy phiếu này; huỷ phiếu ⇒ cả hai đơn về nợ cũ; `_chan_neu_dot_da_co_phieu_chi` chặn sửa đợt có dòng.
- [ ] Chạy, thấy FAIL.
- [ ] Sửa các chỗ ở Files; dòng phải lọc theo `status` của PHIẾU (dòng không có trạng thái riêng).
- [ ] Chạy `python -m pytest tests/test_phieu_gop_phan_bo.py tests/test_payables_api.py tests/test_mua_hang_cho_chi.py tests/test_purchases_api.py tests/test_bao_cao_cong_no.py tests/test_cong_no_bang_du_cot.py -q` ⇒ PASS.

### Task 3: Lập phiếu chi gộp

**Files:**
- Modify: `backend/app/services/accounting_service.py` (thêm `create_voucher_gop`; GỠ `create_vouchers_batch`; `create_receipt` chặn phiếu gộp; `_prepare_voucher` bỏ câu "mỗi phiếu một đợt")
- Modify: `backend/app/routers/accounting.py` (POST `/api/accounting/payment-vouchers/gop` thay `/batch`; thông báo cho từng người lập đơn liên quan khi lập và huỷ)
- Modify: `backend/app/schemas/accounting.py` (`PhieuChiGopIn`, gỡ `VoucherBatch*`)
- Test: `backend/tests/test_phieu_gop_phan_bo.py`, sửa `backend/tests/test_payables_gia_file_batch.py`

**Interfaces — Produces:**
- `create_voucher_gop(*, actor, lines: list[{purchase_request_id:int, delivery_id:int|None, amount:int}], shared: dict) -> dict` (`_voucher_out`).
- Body `PhieuChiGopIn`: `lines` (1..50) + các ô chung như `VoucherBatchIn` cũ + `contract_number`, `invoice_number`, `invoice_date`, `debit_account`, `credit_account`, `note`.
- Một dòng ⇒ phiếu lẻ bình thường (đầu phiếu có nguồn). Nhiều dòng ⇒ đầu phiếu: `purchase_request_id=None`, `delivery_id=None`, `payment_stage` = `final` nếu có dòng đợt ngược lại `advance`, `source_code_snapshot` = `"{mã đầu} +{n-1}"` (≤ 32 ký tự), `supplier_id` + snapshot NCC từ đơn đầu, `content` mặc định "Thanh toán {mã} đợt {n} và …" cắt 500.
- Trần: dòng cọc ≤ `tran_dat_coc` của đơn; dòng đợt ≤ `con_no` của đợt; hai dòng trùng khoản ⇒ lỗi.
- Lỗi phiếu thu hoàn phiếu chi gộp: "Phiếu chi gộp nhiều chứng từ không nhận nộp lại. Huỷ phiếu rồi lập lại."

- [ ] Viết test: gộp cọc A + đợt A + đợt B ⇒ một phiếu, một `doc_no`, 3 dòng, tổng đúng; khác NCC ⇒ 422; dòng đợt vượt `con_no` ⇒ 422 và KHÔNG ghi gì; trả một phần đợt ⇒ đợt còn nợ phần còn lại; huỷ phiếu ⇒ hàng chờ có lại cả 3 khoản; nộp lại vào phiếu gộp ⇒ 422.
- [ ] Chạy, thấy FAIL.
- [ ] Viết service + router + schema; gỡ batch cũ và test cũ của nó.
- [ ] Chạy `python -m pytest tests/test_phieu_gop_phan_bo.py tests/test_payables_gia_file_batch.py -q` ⇒ PASS.

### Task 4: Phía thu đọc tiền từ dòng phân bổ

**Files:**
- Modify: `backend/app/repositories/accounting_repo.py` (`tong_thu_hoa_don_truoc_phieu` :203, `_dieu_kien_phieu_thu` :564, `received_deposit_sum(s)` :722/:732, `tong_coc_da_thu` :748, `list_order_receipts` :757, `lan_thu_cuoi_cong_no` :805, `hoa_don_va_da_thu_toi_ngay` :874, `received_invoice_receipt_sums` :946, `received_invoice_receipts` :962, `list_receipts_for_receivables` :977, `phieu_thu_cho_bao_cao` :1012, `thu_hoa_don_huy_theo_don` :1086, `don_co_coc_da_thu` :1114, `hoa_don_huy_da_thu` :1140)
- Modify: `backend/app/services/accounting_service.py` (`_receipts_for_receivable_rows` :1905, `receivables_summary` :2014-2127, `receivables_detail`, `_doi_chieu_phieu_thu` :2414, `list_order_sales_invoices` :1741, `_receipt_out` :2956)
- Modify: `backend/app/services/bao_cao_cong_no.py` (`_chung_tu_phai_thu` :264 khách lấy `p.customer_id`; `_nap_phai_thu` :392; `_khoan_phai_thu` :492 phân loại theo dòng)
- Modify: `backend/app/services/order_service.py` (`_detail.deposits` :325 số của dòng)
- Modify: `backend/app/services/bao_cao_thu_chi.py` (`_phieu_thu` tách theo mục khi phiếu có cả dòng cọc và dòng hoá đơn)
- Modify: `backend/app/schemas/accounting.py` (`PaymentReceiptOut.lines`, `customer_id`; `ReceivableReceiptOut` thêm `receipt_amount`, `so_dong`; `PhieuThuHoaDonOut` thêm `gop`)
- Test: `backend/tests/test_phieu_gop_phan_bo.py`

**Interfaces — Produces:**
- Luật cọc thống nhất một chỗ: tiền cọc của đơn = Σ dòng `sales_invoice_id IS NULL` của phiếu `received`. Tiền thu hoá đơn = Σ dòng theo `sales_invoice_id`.
- `PaymentReceiptOut.lines: list[{order_id, order_code, sales_invoice_id, invoice_number, amount}]`; `sales_invoice_id`/`order_id` đầu phiếu NULL với phiếu gộp.
- `ReceivableReceiptOut`: một dòng kết quả cho mỗi dòng phân bổ.
- `_phieu_thu(p) -> list[dict]` (trước trả một dict): phiếu có dòng cọc và dòng hoá đơn ⇒ hai dòng báo cáo cùng số phiếu, mục HT-05 và HT-04, tiền tách theo dòng.

- [ ] Viết test: phiếu thu gộp (ORM) gồm HĐ1 đơn X, HĐ2 đơn Y, cọc đơn Z của cùng khách ⇒ `receivable_rows` đúng từng hoá đơn; `received_deposit_sums[Z]` = dòng cọc; công nợ phải thu của khách giảm đúng tổng; sổ 131 có một dòng Có bằng tổng phiếu; huỷ HĐ1 ⇒ chỉ dòng HĐ1 vào quỹ đơn X; báo cáo thu chi ra hai dòng HT-04/HT-05 cộng bằng tổng phiếu; tìm phiếu thu theo số HĐ2 thấy phiếu.
- [ ] Chạy, thấy FAIL.
- [ ] Sửa các chỗ ở Files.
- [ ] Chạy `python -m pytest tests/test_phieu_gop_phan_bo.py tests/test_ban_hang_cho_thu_chi.py tests/test_sales_invoices_api.py tests/test_phieu_truoc_do.py tests/test_tra_lai_tien_hai_chieu.py tests/test_cong_no_bang_du_cot.py tests/test_ke_toan_cong_no_theo_ky.py tests/test_bao_cao_thu_chi.py -q` ⇒ PASS.

### Task 5: Lập phiếu thu gộp + dữ liệu popup chi tiết khoản

**Files:**
- Modify: `backend/app/services/accounting_service.py` (thêm `create_receipt_gop`, `chi_tiet_khoan_thu`)
- Modify: `backend/app/routers/accounting.py` (POST `/api/accounting/payment-receipts/gop`; GET `/api/accounting/chi-tiet-khoan-thu`; huỷ phiếu có dòng cọc ⇒ đẩy `order_pending_changed`)
- Modify: `backend/app/schemas/accounting.py` (`PhieuThuGopIn`, `ChiTietKhoanThuOut`)
- Test: `backend/tests/test_phieu_gop_phan_bo.py`

**Interfaces — Produces:**
- `create_receipt_gop(*, actor, lines: list[{sales_invoice_id:int|None, order_id:int|None, amount:int}], shared: dict) -> dict`. Dòng hoá đơn: hoá đơn `issued`, ≤ `remaining_amount`, `receipt_date ≥ invoice_date`. Dòng cọc: đơn của khách, > 0. Mọi dòng cùng khách. Đầu phiếu nhiều dòng: `source_type` = `sales_invoice` nếu có dòng hoá đơn ngược lại `order_deposit`, `sales_invoice_id=None`, `order_id=None`, `customer_id`, `order_no_snapshot` = `"{mã đầu} +{n-1}"`.
- `GET /api/accounting/chi-tiet-khoan-thu?invoice_id=` hoặc `?order_id=` ⇒ `{hang: [{ten, so_luong, dvt, don_gia, vat, thanh_tien}], phieu: [{receipt_id, code, doc_no, ngay, amount, gop}]}`. Hoá đơn gắn lượt giao ⇒ hàng theo lượt (`qty_giao`, thành tiền = `line_total × qty_giao / qty` làm tròn); không gắn ⇒ dòng đơn. `order_id` ⇒ hàng của đơn, phiếu cọc.

- [ ] Viết test: gộp HĐ1 + HĐ2 + cọc Z ⇒ một `doc_no`, 3 dòng; khác khách ⇒ 422; HĐ vượt còn nợ ⇒ 422 không ghi; huỷ ⇒ hàng chờ thu có lại đủ; `chi-tiet-khoan-thu?invoice_id=` trả hàng và phiếu gộp với số của dòng.
- [ ] Chạy, thấy FAIL.
- [ ] Viết service + router + schema.
- [ ] Chạy `python -m pytest tests/test_phieu_gop_phan_bo.py -q` ⇒ PASS.

### Task 6: Giao diện lập phiếu chi gộp

**Files:**
- Modify: `frontend/src/api/client.ts` (kiểu `PaymentVoucherLineRow`, `PaymentVoucherRow.lines`, `PhieuChiGopInput`, `api.accounting.createVoucherGop`; gỡ batch)
- Create: `frontend/src/pages/ke-toan/phieu-chi/components/LapPhieuChiGop.tsx` (thay `cong-no-phai-tra/components/BatchPaymentDialog.tsx`, xoá file cũ)
- Modify: `frontend/src/pages/ke-toan/cong-no-phai-tra/components/PayablesDrawer.tsx`, `phieu-chi/components/HangChoMuaHang.tsx`, `phieu-chi/PaymentVouchersPage.tsx`
- Modify: `frontend/src/pages/ke-toan/ke-toan.css`, `frontend/src/styles/mobile/ke-toan.css`
- Test: `LapPhieuChiGop.test.tsx` (mới), `PayablesDrawer.test.tsx`, `PaymentVouchersPage.test.tsx`

**Interfaces — Produces:**
- `LapPhieuChiGop({ supplierId, supplierName, khoan: KhoanGop[], conNoNcc?, hanMuc?, onClose, onSaved(voucher), onMoTaiKhoan? })`, `KhoanGop = { purchase_request_id, ma_don, delivery_id: number|null, nhan: string, han: string|null, con: number }`.
- Bảng "Các khoản trong phiếu": Đơn | Khoản | Hạn | Còn | ô "Chi lần này" (mặc định = Còn, `OGoDinhDang`, đỏ khi vượt). Đối chiếu: Số khoản | Số đơn | Tổng phiếu. Nút "Lập phiếu chi". Chứng từ đính MỘT lần vào phiếu.
- Hàng chờ Mua hàng: cột ô tick đầu dòng; tick dòng đầu ⇒ dòng khác NCC khoá ô (title "Khác nhà cung cấp"); dải chân "Đã chọn {n} khoản của {NCC}" + tổng + "Bỏ chọn" + "Lập một phiếu chi". Ngăn Công nợ phải trả giữ ô tick đợt hiện có, mở form mới.

- [ ] Viết test vitest: chọn 2 dòng cùng NCC ở hàng chờ ⇒ dòng NCC khác bị khoá; mở form thấy 2 khoản, sửa ô của khoản 2 nhỏ hơn ⇒ tổng đổi; bấm lập ⇒ `createVoucherGop` nhận `lines` đúng số; ô vượt còn ⇒ báo lỗi, không gọi API.
- [ ] Chạy, thấy FAIL.
- [ ] Viết code + CSS (điện thoại: dải chân dính đáy, bảng khoản cuộn ngang trong khung, ô tiền đủ chạm).
- [ ] Chạy `npx tsc --noEmit -p .` và `npx vitest run src/pages/ke-toan/phieu-chi src/pages/ke-toan/cong-no-phai-tra` ⇒ PASS.

### Task 7: Giao diện lập phiếu thu gộp

**Files:**
- Modify: `frontend/src/api/client.ts` (`PaymentReceiptRow.lines`, `customer_id`, `PhieuThuGopInput`, `createReceiptGop`)
- Create: `frontend/src/pages/ke-toan/phieu-thu/components/LapPhieuThuGop.tsx`
- Modify: `phieu-thu/components/HangChoThuDon.tsx`, `phieu-thu/PaymentReceiptsPage.tsx`, `cong-no-phai-thu/components/HoaDonConNoBlock.tsx`, `cong-no-phai-thu/components/ReceivablesDrawer.tsx`, hai file CSS
- Test: `LapPhieuThuGop.test.tsx` (mới), `PaymentReceiptsPage.test.tsx`, `ReceivablesDrawer.test.tsx`

**Interfaces — Produces:**
- `LapPhieuThuGop({ customerId, customerName, khoan: KhoanThuGop[], onClose, onSaved(receipt), onMoTaiKhoan? })`, `KhoanThuGop = { sales_invoice_id: number|null, order_id, ma_don, nhan, han: string|null, con: number }`.
- Cùng khuôn với Task 6 (bảng khoản + ô "Thu lần này", nhận bằng, người nộp, chứng từ). Hàng chờ thu: ô tick cho cả dòng cọc và dòng hoá đơn, khoá khác khách. Ngăn Công nợ phải thu: ô tick ở bảng Còn nợ + dải "Lập một phiếu thu".

- [ ] Viết test vitest tương ứng Task 6 cho phía thu (gồm một dòng cọc và một dòng hoá đơn).
- [ ] Chạy, thấy FAIL.
- [ ] Viết code + CSS.
- [ ] Chạy `npx tsc --noEmit -p .` và `npx vitest run src/pages/ke-toan/phieu-thu src/pages/ke-toan/cong-no-phai-thu` ⇒ PASS.

### Task 8: Hiện phiếu gộp ở mọi màn đọc

**Files:**
- Modify: `phieu-chi/components/VouchersTable.tsx`, `VouchersDrawer.tsx`, `ThanPhieuChiRoi.tsx`, `phieu-chi/print.ts`; `phieu-thu/components/ReceiptsTable.tsx`, `ReceiptsDrawer.tsx`, `phieuMau.ts`; `cong-no-phai-tra` + `cong-no-phai-thu` tab đã trả/đã thu; `mua-hang/don-mua-chung/NganDonMua.tsx`; khối Hoá đơn và cọc ở ngăn Đơn hàng bán
- Test: test hiện có của các file trên

**Interfaces — Produces:**
- Cột Nguồn: phiếu gộp hiện "{n} chứng từ" và title liệt kê từng mã.
- Ngăn phiếu: khối "Các khoản trong phiếu" (Chứng từ | Số tiền) khi có > 1 dòng.
- Bản in 02-TT/01-TT: "Lý do" giữ `content`; "Kèm theo … chứng từ gốc" liệt kê số HĐ của các dòng.
- Màn đơn (mua/bán) và tab đã trả/đã thu: số tiền = phần của dòng, ghi chú "phiếu gộp {tổng}".

- [ ] Viết test cho từng chỗ hiện (một phiếu 2 dòng).
- [ ] Chạy, thấy FAIL; sửa; chạy `npx vitest run src/pages/ke-toan src/pages/mua-hang src/pages/ban-hang` và `npx tsc` ⇒ PASS.

### Task 9: Popup chi tiết khoản kiểu B

**Files:**
- Create: `frontend/src/pages/ke-toan/shared/ChiTietKhoan.tsx`
- Modify: `phieu-chi/components/HangChoMuaHang.tsx` (thay `ChiTietKhoan` cũ), `phieu-thu/components/HangChoThuDon.tsx` (bấm dòng mở popup), `client.ts` (`chiTietKhoanThu`), hai file CSS
- Test: `PaymentVouchersPage.test.tsx`, `PaymentReceiptsPage.test.tsx`

**Interfaces — Produces:**
- `ChiTietKhoan({ tieuDe, phuDe, nhan, hang: DongHang[], tong: {nhan, tien}[], lichSu: {ngay, noiDung, tien}[], thongTin: {nhan, giaTri}[], con: {nhan, tien}, nut: ReactNode, lienKetDon, onClose })` — popup 1000px: trái thẻ Hàng (bảng + tổng) và thẻ Lịch sử; phải thẻ Còn phải thu/chi + nút và thẻ Thông tin. Dưới 820px hai cột xếp chồng.
- Mua: lịch sử từ `delivery.phieu_chi` / `coc_phieu`; bán: từ `chiTietKhoanThu` + dòng "Trả lại khách ngoài đơn" khi `hoan_khong_don > 0`.

- [ ] Viết test: bấm dòng HĐ ở hàng chờ thu ⇒ popup có hàng, phiếu, Còn phải thu, nút "Lập phiếu thu"; bấm dòng đợt mua ⇒ popup có lịch sử phiếu chi.
- [ ] Chạy, thấy FAIL; viết; chạy `npx tsc` + vitest hai trang ⇒ PASS.

### Task 10: Bấm thử luồng thật + điện thoại

- [ ] Dựng bản sao `svn_erp_ui_gop` + Redis riêng, BE 8010 / FE 5174 (memory run-ui-worktree, ui-test-worktree-db-sao-redis-rieng).
- [ ] Phiếu chi gộp: hàng chờ Mua hàng tick 2 khoản cùng NCC → lập → kiểm mã phiếu, hàng chờ, Công nợ phải trả, báo cáo công nợ, báo cáo thu chi, ngăn đơn mua; huỷ phiếu → kiểm lại.
- [ ] Phiếu chi gộp từ ngăn Công nợ phải trả.
- [ ] Phiếu thu gộp: hàng chờ thu tick cọc + hoá đơn cùng khách → lập → kiểm Công nợ phải thu, báo cáo công nợ, báo cáo thu chi (hai mục), ngăn đơn bán; huỷ → kiểm lại; lập từ ngăn Công nợ phải thu.
- [ ] Popup B ở hai hàng chờ.
- [ ] Lặp các bước chính ở khổ 375px.
- [ ] Dọn: tắt server, xoá DB sao + Redis riêng.
