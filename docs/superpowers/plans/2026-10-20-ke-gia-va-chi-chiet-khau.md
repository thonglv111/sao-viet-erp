# Kê giá + chi chiết khấu theo hóa đơn — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm kê giá sau giá bán, chi chiết khấu + kê theo từng hóa đơn đã hết nợ bằng phiếu chi, cọc nhập % | Số, gỡ hóa đơn điều chỉnh giảm.

**Architecture:** Kê là tiền nguyên đồng ở dòng báo giá (`quote_items.ke_gia`) chảy sang dòng đơn (`order_lines.ke_gia`, nằm TRONG `line_total`). Lúc ghi hóa đơn, máy chia CK/kê của đơn vào hóa đơn theo hàng của lượt giao và chụp % thuế TNDN trên kê. Hàng chờ chi đọc hóa đơn đã hết nợ (`receivable_rows(hoan=False)`), phiếu chi nguồn mới `chi_chiet_khau` / `chi_ke_gia` gắn hóa đơn qua bảng dòng riêng `phieu_chi_ck_ke`.

**Tech Stack:** FastAPI + SQLAlchemy (Postgres/SQLite test), React + TS (Vite), pytest, vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-ke-gia-va-chi-chiet-khau-design.md`

## Global Constraints

- Không Alembic: cột mới qua `backend/app/db_migrations.py` (id `0427_ke_gia_chi_ck`, idempotent, gọi 2 lần trong test) + `docs/DB_SCHEMA.md` (guard `tests/test_schema_documented.py`).
- Tiền lưu số nguyên đồng; CK/kê/thuế TNDN là số TRƯỚC VAT.
- `giá bán sau kê = giá bán + kê`; markup KHÔNG nhân lên kê; VAT tính trên giá bán sau kê.
- `ke_thue_tndn_pct` mặc định 20, khoảng 0–100. Tên hiển thị: "Thuế TNDN trên kê (%)".
- Mục thu chi cố định: `-8 HT-08 chi_chiet_khau "Chi chiết khấu trả khách"`, `-9 HT-09 chi_ke_gia "Chi kê trả khách"`.
- Phiếu chi CK/kê KHÔNG đặt `order_id`, `customer_id` trên đầu phiếu (repo `coc_da_tra_lai*`, `phieu_chi_hoan_khach` đếm mọi phiếu có hai cột đó ⇒ làm sai quỹ đơn và sổ 131).
- Verify: `python -m pytest tests/<file> -q` từ `backend/`, `npx tsc --noEmit` + `npx vitest run <file>` từ `frontend/`. KHÔNG chạy `init.ps1` / pytest cả bộ.
- Commit tiếng Việt, kiểu `feat(...)`, không trailer.
- UI chỉ thêm cột/ô/hàng chờ theo khuôn sẵn có; chữ thường, không nối thông tin bằng dấu `·`.

## Review Focus

1. Hóa đơn hết nợ nhờ CỌC ngay lúc ghi (không có phiếu thu) ⇒ vẫn vào hàng chờ chi và có thông báo. Test ở Task 6.
2. Huỷ phiếu chi CK/kê ⇒ khoản quay lại hàng chờ; huỷ hóa đơn khi còn phiếu chi hiệu lực ⇒ bị chặn. Test ở Task 6.
3. Đơn giao 2 lượt: tổng CK/kê của các hóa đơn khớp đúng tổng của đơn (hóa đơn ghi đủ nhận phần dư). Test ở Task 5.
4. Báo giá sửa markup sau khi đã gõ kê ⇒ kê giữ nguyên SỐ TIỀN, giá bán sau kê đổi theo. Test ở Task 3.
5. Cọc gõ số tiền rồi đơn bị sửa làm tổng < cọc ⇒ máy chủ chặn. Test ở Task 2.

---

### Task 1: Gỡ hóa đơn điều chỉnh giảm

**Files:**
- Modify: `backend/app/models/accounting.py` (bỏ `SalesInvoice.dieu_chinh`, class `SalesInvoiceAdjustment`), `backend/app/models/__init__.py`
- Modify: `backend/app/repositories/accounting_repo.py` (bỏ `dieu_chinh_*`, `thua_dieu_chinh_theo_don`, `get/save_dieu_chinh`, `don_co_dieu_chinh`, selectinload)
- Modify: `backend/app/services/accounting_service.py` (`quy_tien_don` bỏ `thua`; `receivable_rows` bỏ `giam`, bỏ key `dieu_chinh_amount`; `_phan_bo_hoan`; `_sales_invoice_out`; `list_order_sales_invoices` bỏ `dieu_chinh`/`ck_goi_y`; xoá `_ty_le_chiet_khau`, `_ck_goi_y`, `_dieu_chinh_out`, `create_dieu_chinh`, `cancel_dieu_chinh`)
- Modify: `ban_hang_cho_thu_chi.py` (`tien_cua_don` bỏ `thua_dieu_chinh_theo_don`, bỏ `hoa_don_dieu_chinh`), `bao_cao_cong_no.py` (sổ 131 bỏ `dieu_chinh_giam`, `_khoan_phai_thu`, `ban_ky`), `cong_no_khoa_ky.py`, `cong_no_khoa_so_service.py`, `hoa_hong_service.py` (bỏ phần âm), `bao_cao_kinh_doanh.py` + `_excel.py` (bỏ `dieu_chinh`, cột T dời), `routers/accounting.py` (2 endpoint + `_thong_bao_dieu_chinh`), `schemas/accounting.py`, `audit_registry.py`
- Modify: `db_migrations.py` — `_migrate_sales_invoice_adjustments` thành no-op (giữ id 0418); thêm `0427a_bo_hoa_don_dieu_chinh`: `DROP TABLE IF EXISTS sales_invoice_adjustments`
- Modify: `docs/DB_SCHEMA.md` (xoá mục `sales_invoice_adjustments`)
- Frontend: `api/client.ts` (types + 2 api + 2 SSE type), `lib/suKienNhom.ts`, `DonHangBanPage.tsx` InvoicePanel (state, nút, form, dòng tóm tắt), `SoChiTietDrawer.tsx`, `LichSuCongNo.tsx`, `HangChoTraLai.tsx`, `BaoCaoKinhDoanhPage.tsx` (cột `dc`)
- Tests: xoá `tests/test_hoa_don_dieu_chinh.py`; sửa `test_bao_cao_kinh_doanh.py` (bỏ test `:357`, cột Excel), `test_hoa_hong_kinh_doanh.py` (bỏ `_dieu_chinh` + test `:107`)

- [ ] **Step 1:** Xoá/sửa theo danh sách trên; `grep -rn "SalesInvoiceAdjustment\|dieu_chinh_amount\|ck_goi_y\|thua_dieu_chinh\|dieu_chinh_giam\|createDieuChinh" backend/app frontend/src` ra rỗng.
- [ ] **Step 2:** Test migration: `test_migration_0427a_bo_bang_dieu_chinh` — tạo bảng bằng SQL thô, chạy `_migrate_bo_hoa_don_dieu_chinh` 2 lần, bảng không còn.
- [ ] **Step 3:** Run `python -m pytest tests/test_bao_cao_kinh_doanh.py tests/test_hoa_hong_kinh_doanh.py tests/test_ban_hang_cho_thu_chi.py tests/test_bao_cao_cong_no.py tests/test_sales_invoices_api.py tests/test_schema_documented.py -q` → PASS; `npx tsc --noEmit` → 0 lỗi.
- [ ] **Step 4:** Commit `refactor(ke-toan): gỡ hóa đơn điều chỉnh giảm`.

### Task 2: Cột mới + cọc hai tab % | Số

**Files:**
- Modify: `models/customer.py` (`ke_thue_tndn_pct` Float NOT NULL default 20 server_default "20", `ke_min_pct`, `ke_max_pct` Float null), `models/quotation.py` (`QuoteItem.ke_gia` Numeric(15,2) default 0; `QuoteVersion.ke_gia_amount` Numeric(15,2) default 0), `models/order.py` (`OrderLine.ke_gia` BigInteger null; `Order.deposit_amount` BigInteger null), `models/accounting.py` (`SalesInvoice.chiet_khau`, `ke_gia`, `ke_thue_tndn` BigInteger NOT NULL default 0, `ke_thue_tndn_pct` Float null; class mới `PhieuChiCkKe` bảng `phieu_chi_ck_ke`: `id`, `payment_voucher_id` FK CASCADE, `sales_invoice_id` FK RESTRICT, `loai` String(16) (`chiet_khau`|`ke_gia`), `amount_vnd` BigInteger; relationship `voucher`)
- Modify: `db_migrations.py` (`0427_ke_gia_chi_ck`: ALTER thêm mọi cột trên, tạo bảng `phieu_chi_ck_ke` nếu thiếu, backfill `sales_invoices.chiet_khau = round(amount_vnd × Σ order_lines.chiet_khau×(100+vat)/100 ÷ tổng đơn gồm VAT)` bằng SQL thô cho hóa đơn issued)
- Create: `backend/app/services/coc.py` — `coc_phai_thu(deposit_pct: float|None, deposit_amount: int|None, total_with_vat: int) -> int` (số tiền thắng nếu có; không thì `round(pct×total/100)`; 0 nếu cả hai trống)
- Modify readers: `order_service.py` `_money` + stats `:516`, `ban_hang_cho_thu_chi.py` `:22/:35/:43`, `bao_cao_kinh_doanh.py:136-138`, `accounting_repo.py:1271` (lọc `deposit_pct>0 OR deposit_amount>0`), `routers/orders.py:312`, `schemas/accounting.py CocChoThu` (+ `deposit_amount`)
- Modify: `schemas/order.py` (`deposit_amount: int|None` ở Create/Update/Row), `order_service.update/create`: gửi `deposit_amount` ⇒ `deposit_pct=None` và ngược lại; `deposit_amount > total_with_vat` ⇒ `OrderValidationError("Tiền cọc không được vượt giá trị đơn hàng (... đ).")`; mọi chỗ sửa dòng đơn kiểm lại
- Frontend: `DonHangBanPage.tsx EditDialog` — hai tab % | Số (nút kiểu `.o2tab__tab` của `OHaiTab`) + `OGoDinhDang`; hiển thị "Cọc quy định" theo số tiền khi có; `client.ts` types
- Test: `tests/test_coc_hai_tab.py`

- [ ] **Step 1: Test**
```python
def test_coc_phai_thu_uu_tien_so_tien():
    assert coc_phai_thu(30, None, 16_500_000) == 4_950_000
    assert coc_phai_thu(None, 5_000_000, 16_500_000) == 5_000_000
    assert coc_phai_thu(None, None, 16_500_000) == 0

def test_luu_coc_so_tien_vuot_gia_tri_don_bi_chan(client): ...  # PUT /api/orders/{id} deposit_amount > total_with_vat → 422/400, message chứa "vượt giá trị đơn"
def test_luu_coc_so_tien_xoa_pct(client): ...                  # PUT deposit_amount=1_000_000 → row.deposit_pct is None, deposit_required == 1_000_000
def test_migration_0427_idempotent(): ...                       # chạy _migrate_ke_gia_chi_ck 2 lần, cột customers.ke_thue_tndn_pct tồn tại, khách cũ = 20
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Code. **Step 4:** Run `tests/test_coc_hai_tab.py tests/test_orders_api.py tests/test_ban_hang_cho_thu_chi.py tests/test_bao_cao_kinh_doanh.py tests/test_schema_documented.py` → PASS; tsc.
- [ ] **Step 5:** Commit `feat(don-hang): cọc nhập % hoặc số tiền, cột kê giá + phiếu chi CK/kê (mg 0427)`.

### Task 3: Khách hàng — thuế TNDN trên kê + rào kê

**Files:** `schemas/customer.py` (`CustomerFinancialIn`: `ke_thue_tndn_pct: float = Field(20, ge=0, le=100)`, `ke_min_pct`, `ke_max_pct` `Field(None, ge=0, le=100)`; `CustomerRow` 3 trường), `customer_service.update_financial` + `_validate_bounds` (min ≤ max cho kê), `routers/customers.py:~1103`; FE `KhachHangPage.tsx FinancialPolicyCard` (view: "Kê cho phép" `rangeText`, "Thuế TNDN trên kê" `20 %`; form trong fieldset "Rào giá khi báo giá": Kê cho phép min–max; fieldset mới không cần — đặt "Thuế TNDN trên kê (%)" cùng fieldset), `client.ts`.
- Test `tests/test_khach_ke_gia.py`: tạo khách mới → `ke_thue_tndn_pct == 20`; PUT financial `ke_min_pct=10, ke_max_pct=5` → 422; PUT `ke_thue_tndn_pct=25` → row trả 25.
- [ ] Steps: test → fail → code → pass (+ `tests/test_customers_api.py`) → tsc → commit `feat(khach-hang): thuế TNDN trên kê (mặc định 20%) và rào kê cho phép`.

### Task 4: Báo giá + đơn — kê giá (backend)

**Files:** `services/quotation_service.py`, `schemas/quotation.py`, `routers/quotations.py`, `services/exception_gate.py`, `models/order.py` (hằng `EXC_KE_OUT = "ke_out"`), `services/order_service.py:_create_from_quotation`
**Interfaces (Produces):**
- `calculate_pricing(..., ke_gia: float = 0.0)` → thêm khoá `ke_gia`, `gia_sau_ke`; `unit_price = gia_sau_ke/qty`; `vat_amount = gia_sau_ke×vat%`; `final_amount = gia_sau_ke + vat`. `selling_price` KHÔNG gồm kê.
- `QuoteItemUpdate`: `ke_gia: float|None = None`, `ke_percent: float|None = None` (None cả hai ⇒ giữ kê cũ; `ke_percent` ⇒ tiền = round(giá bán mới × %/100)).
- `QuoteItemOut`: `ke_gia: float`, `gia_sau_ke: float`. `QuotationDetailOut`/`VersionRow`: `ke_gia_amount`.
- `_cong_tong`: `ban = round(selling + ke_gia)`; `version.ke_gia_amount = Σ ke_gia` (cùng tập dòng được cộng). `update_quotation` gọi `self._cong_tong(version)` thay cộng thô.
- `_chep_dong`, `_gia_dong` (truyền `ke_gia=it.ke_gia`), `_ap_so_tu_phieu` (dòng mới kê 0) giữ kê.
- `exception_eval`: `subtotal_net = subtotal − ke_gia_amount` cho markup; truyền `ke_amount`, `ke_lines=[{ten, ban, ke}]`, `ke_min_pct/ke_max_pct` của khách. `evaluate_quote(..., ke_amount=0, ke_lines=None, ke_min_pct=None, ke_max_pct=None)`: high_value so `subtotal + ke_amount`; trigger `{"key": "ke_out", "label": "Kê ngoài rào: <tên>"}` khi `ke×100 < min×ban` hoặc `> max×ban`.
- Đơn: `lines.append(... ke_gia=int(round(it.ke_gia or 0)))`; `line_total = round(final − vat)` (đã gồm kê).
- Test `tests/test_ke_gia_bao_gia.py`:
```python
def test_calculate_pricing_ke_sau_gia_ban():
    p = QuotationService.calculate_pricing(total_cost=800, margin_percent=25, ke_gia=500, vat_percent=10, quantity=10)
    assert p["selling_price"] == 1000 and p["gia_sau_ke"] == 1500 and p["unit_price"] == 150 and p["vat_amount"] == 150
def test_sua_markup_giu_so_tien_ke(client): ...      # PUT item ke_gia=500 rồi PUT margin 30 → ke_gia vẫn 500, gia_sau_ke = selling+500
def test_ke_theo_phan_tram_tinh_tren_gia_ban(client): ...  # ke_percent=50 → ke_gia == round(selling/2)
def test_tong_phien_ban_gom_ke(client): ...           # subtotal_amount == round(selling+ke), ke_gia_amount == ke
def test_ke_ngoai_rao_phai_trinh_duyet(client): ...   # khách ke_max_pct=10, kê 50% → quote_gate exception_required, trigger key "ke_out"
def test_ke_khong_lam_dep_markup(client): ...          # markup_pct của cổng không đổi khi thêm kê
def test_don_chep_ke_tu_bao_gia(client): ...           # order line ke_gia == quote ke, line_total gồm kê
```
- [ ] Steps: test → fail → code → pass (+ `test_quotation_approval.py test_tong_bao_gia_khop_don.py test_orders_api.py test_quotations_api.py`) → commit `feat(bao-gia): kê giá sau giá bán, rào kê, đơn chép kê`.

### Task 5: Báo giá — giao diện

**Files:** `frontend/src/pages/BaoGiaPage.tsx`, `bao-gia-tong.ts` (+ test), `api/client.ts`
- `NhapDong` thêm `ke?: {k: Kieu; v: number}`; `calcItem` trả thêm `ke`, `sauKe = selling + ke`; VAT trên `sauKe`; `congTongBaoGia` nhận `ke` (`DongTien.ke`), `gomX100 += round(selling+ke)×(100+vat)`, trả thêm `ke`, `sauKe`.
- `oKe(dong, ten)`: `OHaiTab` % = ke/Σban×100, Số = Σke; `commitKe(dong, kieu, v)`: % ⇒ `ke_percent` từng dòng, Số ⇒ `chiaTheoTyLe(dong, v, it => calcItem(it).selling)` → `ke_gia`. `persistItems` echo `ke_gia: it.ke_gia` khi không đụng.
- Bảng: cột "Kê" sau "Giá bán", cột "Giá bán sau kê" cuối (dòng con: số tiền, dải nhóm: ô kê + tổng). Khối tổng: thêm dòng "Kê" và "Giá bán sau kê (chưa VAT)"; số to = tổng gồm VAT.
- Bản in: `thanhTien = selling_price + ke_gia`.
- Test vitest `bao-gia-tong.test.ts`: `congTongBaoGia([{cost:800, ck:0, selling:1000, ke:500, vatPct:10}])` → `{sauKe:1500, vat:150, grand:1650}`.
- [ ] Steps: test → fail → code → `npx vitest run src/pages/bao-gia-tong.test.ts src/pages/BaoGiaPage.chiTiet.test.tsx` + tsc → commit `feat(bao-gia): cột Kê và Giá bán sau kê, bản in theo giá sau kê`.

### Task 6: Hóa đơn chia CK/kê + hàng chờ + phiếu chi (backend)

**Files:**
- Create: `backend/app/services/chi_ck_ke.py`:
  - `ck_ke_luot(order, trips) -> dict[int, tuple[int, int]]` — CK và kê của hàng từng lượt (cộng dồn theo dòng như `hoa_don_theo_giao.gia_tri_luot_giao`, phần = tiền dòng × SL giao cộng dồn ÷ SL đặt, lấy hiệu).
  - `chia_ck_ke(order, *, trip_id, amount, gia_tri_luot, hoa_don_cu: list[SalesInvoice], ghi_du: bool) -> tuple[int, int]` — phần lượt × `amount/gia_tri_luot` (gia_tri_luot 0 ⇒ theo `amount/tổng đơn`); `ghi_du` ⇒ tổng đơn − Σ hóa đơn cũ còn hiệu lực; kẹp ≥ 0 và ≤ phần còn lại.
  - `phai_chi(inv) -> dict[str, int]` = `{"chiet_khau": inv.chiet_khau, "ke_gia": inv.ke_gia − inv.ke_thue_tndn}`.
  - `ck_ke_cho_chi(repo) -> list[dict]` — hóa đơn issued có CK/kê > 0, `receivable_rows(repo, invoices=..., hoan=False)` lấy `remaining_amount == 0`, trừ đã chi (Σ `PhieuChiCkKe.amount_vnd` của phiếu không `cancelled`), trả dòng `{sales_invoice_id, so_hoa_don, ngay_hoa_don, order_id, order_code, customer_id, customer_name, loai, phai_chi, da_chi, con}` với `con > 0`.
  - `bao_ck_ke(db, repo, *, actor_id, invoice_ids)` — nếu hóa đơn nào trong `invoice_ids` có ở hàng chờ ⇒ `thong_bao_man.bao(kenh="phieu_chi", loai="ck_ke_cho_chi", quyen="create", ma=<số HĐ>)`.
- Modify `accounting_service.create_sales_invoice`: tính `chiet_khau, ke_gia` bằng `chia_ck_ke`, `ke_thue_tndn_pct = customer.ke_thue_tndn_pct`, `ke_thue_tndn = round(ke_gia × pct / 100)`. `cancel_sales_invoice`: còn `PhieuChiCkKe` của phiếu không huỷ ⇒ `AccountingConflict("Hóa đơn đã có phiếu chi chiết khấu/kê — huỷ phiếu chi trước.")`. `_sales_invoice_out`: thêm `chiet_khau, ke_gia, ke_thue_tndn_pct, ke_thue_tndn, ck_da_chi, ke_da_chi`.
- Modify: `models/accounting.py` (`VOUCHER_SOURCE_CHI_CK = "chi_chiet_khau"`, `VOUCHER_SOURCE_CHI_KE = "chi_ke_gia"` vào `VOUCHER_SOURCES`), `models/muc_thu_chi.py` (HT-08, HT-09), `_prepare_standalone_voucher` cho phép 2 nguồn + `source_labels`.
- New service method `create_voucher_ck_ke(self, *, actor, loai: str, dong: list[dict], **shared) -> dict`: ≥1 dòng, ≤50; mọi hóa đơn cùng khách; `amount` mỗi dòng 0 < x ≤ `con` của (hóa đơn, loại) ở `ck_ke_cho_chi`; tổng = Σ; CK ⇒ `recipient_name` = tên khách; dựng phiếu qua `_prepare_standalone_voucher` + `_new_voucher`, thêm `PhieuChiCkKe` mỗi dòng; audit `create_payment_voucher`.
- Router: `GET /api/accounting/ck-ke-cho-chi` (đọc `MODULE_PC`), `POST /api/accounting/payment-vouchers/ck-ke` (payload `PhieuChiCkKeIn{loai, dong:[{sales_invoice_id, amount}], voucher_type, voucher_date, content, recipient_name, ... như PaymentVoucherBaseIn}`). Gọi `bao_ck_ke` sau: ghi hóa đơn (`:879`), 3 endpoint phiếu thu (`:1526, :1564, :1590`).
- Frontend thông báo: `lib/thongBaoMan.ts LOI_NHAC.ck_ke_cho_chi = "Có hóa đơn đã thu đủ, chờ chi chiết khấu/kê"`.
- Test `tests/test_chi_ck_ke.py` (dựng đơn bằng `_don_tu_bao_gia` / `_sales_order` + sửa dòng thêm `chiet_khau`, `ke_gia`):
```python
def test_ghi_hoa_don_chup_ck_ke_va_thue(): ...         # đơn CK 1_000_000 kê 5_000_000 VAT 10%, khách 20%; HĐ cả đơn → chiet_khau 1_000_000, ke_gia 5_000_000, ke_thue_tndn 1_000_000
def test_hai_luot_tong_khop_don(): ...                  # 2 HĐ nửa đơn → mỗi HĐ 500_000 / 2_500_000, tổng khớp
def test_chua_het_no_chua_vao_hang_cho(): ...
def test_coc_phu_tron_hoa_don_vao_hang_cho_ngay(): ...   # cọc ≥ giá trị HĐ1 → HĐ1 có trong ck-ke-cho-chi ngay sau ghi
def test_thu_du_sinh_hai_dong_cho_chi(): ...             # loai chiet_khau con 500_000, ke_gia con 2_000_000
def test_lap_phieu_chi_ke_rung_hang_cho(): ...           # POST ck-ke loai ke_gia → dòng biến; voucher muc HT-09, order_id None
def test_chi_vuot_con_bi_chan(): ...
def test_tron_ck_va_ke_hoac_hai_khach_bi_chan(): ...
def test_huy_phieu_chi_khoan_quay_lai(): ...
def test_huy_hoa_don_con_phieu_chi_bi_chan(): ...
def test_thu_du_bao_phieu_chi(): ...                     # tom_tat kênh phieu_chi có loai ck_ke_cho_chi
```
- [ ] Steps: test → fail → code → pass (+ `test_sales_invoices_api.py test_ban_hang_cho_thu_chi.py test_muc_thu_chi.py test_payment_vouchers*.py`) → commit `feat(ke-toan): chia CK/kê vào hóa đơn, hàng chờ và phiếu chi CK/kê`.

### Task 7: Phiếu chi + ngăn đơn — giao diện

**Files:** `pages/ke-toan/phieu-chi/shared/loc.ts` (thẻ `"ck"` "Chờ chi CK / kê"), `PaymentVouchersPage.tsx` (tải `api.accounting.ckKeChoChi`, tab, ẩn khi rỗng, `onSuKien` nạp lại), Create `components/HangChoCkKe.tsx` (lưới `lds-g`: Đơn, Hóa đơn, Khách, Loại, Phải chi, Đã chi, Còn; tick nhiều dòng; nút "Lập phiếu chi" chỉ bật khi các dòng tick cùng khách + cùng loại), Create `modals/LapPhieuChiCkKeModal.tsx` (bám `TraLaiTienKhachModal`: `KhungFormPhieu` + `ThanPhieuChiRoi`; mục `mucCoDinh(ds, "chi_chiet_khau"|"chi_ke_gia")`; lý do chi "Chi chiết khấu HĐ <số>, <số>"; người nhận: CK khoá tên khách, kê bắt buộc gõ; số tiền mỗi dòng sửa nhỏ hơn được), `client.ts` (`PaymentVoucherSource` + 2 api + types), `DonHangBanPage.tsx InvoicePanel` (dưới giá trị HĐ: "Chiết khấu", "Kê", "Thuế TNDN trên kê", "Đã chi" khi > 0).
- [ ] Steps: code → `npx tsc --noEmit` → `npx vitest run src/lib/thongBaoMan.test.ts` → commit `feat(phieu-chi): hàng chờ chi CK/kê và lập phiếu`.

### Task 8: Báo cáo kinh doanh + hoa hồng

**Files:** `bao_cao_kinh_doanh.py` (khoá mới mỗi đơn: `ck_phai_chi`, `ck_da_chi`, `ke_tien`, `ke_thue_tndn`, `ke_phai_chi`, `ke_da_chi` — phải chi chỉ hóa đơn hết nợ; thêm vào `_cot`), `bao_cao_kinh_doanh_excel.py` (6 cột mới sau "Còn phải thu", sửa chữ cái, merge, docstring), `BaoCaoKinhDoanhPage.tsx` (`COT` + `tienCot` + đổi `MAN` → `"bao-cao-kinh-doanh-d"`), `client.ts BaoCaoKinhDoanhTien`; `hoa_hong_service.py` (`_moc_phat_sinh` trả `(order_id, tien_co_vat, tru_truoc_vat)` với `tru = chiet_khau + ke_gia`; hoa hồng = `(tien_co_vat × tỷ lệ − tru) × pct`, cả hai hàm).
- Tests: `test_bao_cao_kinh_doanh.py::test_cot_ck_ke_theo_hoa_don_het_no` (ví dụ spec §7: sau thu đủ + chi xong → 1_000_000/1_000_000, 5_000_000, 1_000_000, 4_000_000/4_000_000), sửa assert chữ cái Excel; `test_hoa_hong_kinh_doanh.py::test_hoa_hong_tru_ck_va_toan_bo_ke` (HĐ 16_500_000 gồm VAT, CK 1_000_000, kê 5_000_000, pct 0.05 → (15_000_000 − 6_000_000) × 0.05 = 450_000).
- [ ] Steps: test → fail → code → pass (+ `test_luong_nap_theo_me.py`) → tsc → commit `feat(bao-cao): cột chiết khấu và kê theo đơn, hoa hồng trừ CK và kê`.

### Task 9: Bấm thử trọn luồng

Trong worktree, DB clone + Redis riêng (memory `ui-test-worktree-db-sao-redis-rieng`), backend :8021 / frontend :5185. Bằng chuột/bàn phím:
1. Khách hàng → Chính sách tài chính → Sửa: thấy Thuế TNDN trên kê 20, đặt Kê cho phép 0–60, Lưu.
2. Báo giá nháp: gõ Kê 50% ở một sản phẩm → Giá bán sau kê, VAT, tổng đổi đúng; sửa Markup → kê giữ số tiền; Xem bản in → đơn giá = giá sau kê / SL.
3. Gửi khách → khách chốt → lên đơn → sửa cọc tab Số vượt tổng (thấy lỗi) rồi số hợp lệ → chốt.
4. Giao hàng → ghi hóa đơn → ngăn đơn hiện CK/kê/thuế TNDN của HĐ.
5. Phiếu thu đủ HĐ → Phiếu chi có chấm đỏ + tab "Chờ chi CK / kê" 2 dòng → lập phiếu kê (gõ người nhận) → dòng rụng; huỷ phiếu → dòng quay lại.
6. Báo cáo kinh doanh: các cột CK / kê khớp.
Báo cáo từng bước đã bấm/gõ/thấy.
