# Hoa hồng theo tiền thu + chiết khấu theo giá bán — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kỳ lương tháng 8/2026 trên dev ra đúng số sổ T08 (Sơn 23.387.255, Kim Dung 14.928.934, Ngọc Sơn 19.633.062, sale 0), và tiền chiết khấu báo giá ra đúng cột T của sổ.

**Architecture:** Chiết khấu % đổi gốc từ giá vốn sang giá bán trước kê trong `calculate_pricing` (máy chủ) và `calcItem` (màn báo giá). Hoa hồng đổi mốc từ hoá đơn sang dòng phiếu thu; % tra theo số ngày thu trên biểu bậc chụp vào đơn lúc chốt; đơn có % riêng thì thắng biểu. Bảng lương có ngăn soi hoa hồng từng lần thu, kiêm chỗ đặt % riêng.

**Tech Stack:** FastAPI + SQLAlchemy (Postgres dev / SQLite test), React + TS + vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-hoa-hong-theo-tien-thu-design.md`

## Global Constraints

- Không Alembic: cột mới viết vào `backend/app/db_migrations.py` (raw SQL, idempotent, backfill đích danh cột, không ORM full-select) + `docs/DB_SCHEMA.md` cùng lúc (có guard test). Số migration: lấy số kế tiếp còn trống lúc làm (hiện cao nhất `0438`).
- % là PHÂN SỐ (`0.03` = 3%), cùng quy ước `commission_pct` cũ.
- Biểu bậc: `[{"den_ngay": int | null, "pct": float}]`, `den_ngay` tăng dần, bậc cuối `null` (vô hạn). NULL hoặc `[]` = không hưởng hoa hồng.
- Sale KHÔNG được gõ % trên đơn của mình: % riêng chỉ người có ô `luong:update` đặt được, qua API `/api/luong/...`; `OrderUpdate`/`OrderDetailOut` không thêm trường hoa hồng nào (test `test_KHONG_CO_DUONG_NAO_de_sale_tu_dat_pct_cho_don` phải còn xanh).
- Không dựng phương án HTML (chủ chốt 23/10). Bảng bậc giống hệt ô bù hao `danh-muc/fields/Bands.tsx`.
- UI tiếng Việt, không chữ đậm cho mã/tên, không nối thông tin bằng dấu `·`.
- Verify: `python -m pytest <file> -q` trong `backend/`, `npx tsc --noEmit` và `npx vitest run <file>` trong `frontend/`. KHÔNG chạy `./init.ps1`, KHÔNG chạy pytest full.
- Sửa route/schema backend ⇒ restart uvicorn (WMI, xem memory). KHÔNG commit khi chủ chưa bảo.
- Báo cáo bấm thử: liệt kê cụ thể bấm gì, gõ gì, thấy gì. Dữ liệu nạp bằng script (Task 7) phải nói rõ khi báo cáo.

## Review Focus

1. Một phiếu thu có nhiều dòng của nhiều đơn khác người phụ trách: mỗi dòng về đúng người của đơn đó.
2. Tiền thu TRƯỚC ngày hoá đơn (số ngày âm): tính 0 ngày, ăn bậc đầu, không văng lỗi.
3. Hoá đơn `amount_vnd = 0` hoặc đơn không dòng hàng: không chia cho 0, gốc = 0.
4. `hh_rieng_pct = 0` (khác NULL): đơn đó ra 0 dù biểu có % — dùng để loại tay khoản KARTA.
5. Lưu mốc lương mới mà không đụng bảng bậc: modal phải điền sẵn biểu của mốc trước, không xoá mất.

---

### Task 1: Tiền chiết khấu = % × giá bán trước kê

**Files:**
- Modify: `backend/app/services/quotation_service.py` (`calculate_pricing` ~488–565, `_gia_dong` 346–365)
- Modify: `frontend/src/pages/BaoGiaPage.tsx` (`calcItem` ~853–875, nhãn ~1125)
- Test: `backend/tests/test_chiet_khau_bao_gia.py`

**Interfaces:**
- Produces: `calculate_pricing(...)` cùng chữ ký, cùng khoá trả về; chỉ đổi số khi `discount_percent > 0` và `discount_amount == 0`. Ném `QuotationValidationError("Chiết khấu quá lớn so với lợi nhuận")` khi mẫu số ≤ 0.

- [ ] **Step 1: Sửa docstring module test + các test hiện có, thêm test mới**

```python
def test_theo_phan_tram():
    p = tinh(total_cost=11_985_790, margin_percent=20, discount_percent=5, vat_percent=10, quantity=1000)
    assert p["selling_price"] == 15_301_009
    assert p["discount_amount"] == 765_050                       # 5% × giá bán
    assert p["profit_amount"] == 2_550_169
    assert p["margin_percent"] == 20.0

def test_gia_go_tay_ck_tren_gia_go():
    p = tinh(total_cost=1_000_000, margin_percent=20, discount_percent=10, manual_selling_price=1_500_000)
    assert (p["discount_amount"], p["profit_amount"]) == (150_000, 350_000)
    assert p["margin_percent"] == round(350_000 / 1_150_000 * 100, 2)

def test_ck_pct_va_so_tien_loi_nhuan():
    p = tinh(total_cost=1_000_000, margin_percent=0, discount_percent=10, profit_amount=250_000)
    assert (p["selling_price"], p["discount_amount"], p["profit_amount"]) == (1_388_889, 138_889, 250_000)

def test_khop_so_T08_dong_706_KI_WORKS():
    p = tinh(total_cost=30_000_000, margin_percent=0, discount_percent=3, manual_selling_price=36_668_200)
    assert p["discount_amount"] == 1_100_046

def test_khop_so_T08_dong_718_Powertech():
    p = tinh(total_cost=10_000_000, margin_percent=0, discount_percent=5, manual_selling_price=16_848_000)
    assert p["discount_amount"] == 842_400

def test_vi_du_100tr():
    p = tinh(total_cost=100_000_000, margin_percent=20, discount_percent=3)
    assert (p["selling_price"], p["discount_amount"], p["profit_amount"]) == (124_481_328, 3_734_440, 20_746_888)

def test_lam_tron_thi_ck_tinh_tren_gia_da_tron():
    p = tinh(total_cost=100_000_000, margin_percent=20, discount_percent=3, rounding="round_up_1000")
    assert p["selling_price"] == 124_482_000 and p["discount_amount"] == round(124_482_000 * 0.03)

def test_chan_ck_qua_lon():
    import pytest
    from app.services.quotation_service import QuotationValidationError
    with pytest.raises(QuotationValidationError):
        tinh(total_cost=100, margin_percent=100, discount_percent=50)
```

Giữ nguyên `test_gom_so_tien_chiet_khau_va_loi_nhuan`, `test_so_tien_chiet_khau_thang_phan_tram`, `test_khong_chiet_khau_giong_markup_cu`. Thêm test `_gia_dong`: dòng có `total_cost_snapshot=100_000_000, selling_price=124_481_328, discount_amount=3_734_440, margin_percent=20`, gọi `_gia_dong(it, cost=200_000_000, qty=...)` ⇒ `discount_amount == round(0.03 × selling_price mới)` (dựng như `test_ke_gia_bao_gia.py`).

- [ ] **Step 2:** `python -m pytest tests/test_chiet_khau_bao_gia.py -q` ⇒ FAIL ở các test mới.
- [ ] **Step 3: Sửa `calculate_pricing`** theo thứ tự: (a) `discount_amount > 0` ⇒ đường cũ; (b) giá gõ tay ⇒ `G = giá gõ`; (c) có `profit_amount` ⇒ `G = round((vốn + LN) / (1 − p))`; (d) còn lại ⇒ `G = round(vốn × (1 + m) / (1 − p × (1 + m)))`. Áp làm tròn lên `G`, rồi `CK = round(p × G)` cho (b)(c)(d); lợi nhuận = `G − vốn − CK`. Mẫu số ≤ 0 ⇒ ném lỗi. Sửa docstring (bỏ câu "% × giá vốn").
- [ ] **Step 4: Sửa `_gia_dong`:** `pct_ck = discount_amount / selling_price_cũ × 100` (giá bán cũ > 0), docstring "trên giá bán trước kê".
- [ ] **Step 5:** pytest file trên + `tests/test_ke_gia_bao_gia.py tests/test_tong_bao_gia_khop_don.py tests/test_bao_gia_theo_phieu.py` ⇒ PASS (đỏ do số cũ dựa CK-trên-vốn thì sửa số mong đợi, ghi lý do trong docstring test).
- [ ] **Step 6: Frontend `calcItem`** cùng 4 nhánh như Step 3 (giá gõ tay `n.gia`; LN số tiền `n.ln.k !== "pct"`; còn lại công thức đóng); comment 853 và `titlePct` 1125 đổi thành "Chiết khấu (%) trên giá bán trước kê — nằm trong giá bán, chi lại cho khách khi hóa đơn thu đủ". `npx tsc --noEmit` ⇒ sạch.

### Task 2: Biểu bậc — hàm tra + cột hồ sơ lương + chụp vào đơn

**Files:**
- Create: `backend/app/services/bac_hoa_hong.py`
- Modify: `backend/app/models/payroll.py` (EmployeeSalary ~296), `backend/app/models/order.py` (~141), `backend/app/schemas/payroll.py` (SalaryIn ~268, SalaryOut ~295), `backend/app/routers/payroll.py` (`set_salary` ~693), `backend/app/services/payroll_service.py` (`set_salary` ~977), `backend/app/repositories/payroll_repo.py` (`create_salary`), `backend/app/services/order_service.py` (135–160, 937–942), `backend/app/db_migrations.py`, `docs/DB_SCHEMA.md`
- Test: `backend/tests/test_bac_hoa_hong.py` (mới), `backend/tests/test_hoa_hong_kinh_doanh.py` (3 test chụp %)

**Interfaces:**
- Produces:
  - `pct_theo_bac(bac: list[dict] | None, so_ngay: int) -> float` — bậc đầu có `den_ngay is None or so_ngay <= den_ngay`; rỗng/None ⇒ 0.0; `so_ngay < 0` coi như 0.
  - `chuan_hoa_bac(bac: list[dict] | None) -> list[dict] | None` — ném `ValueError` (tiếng Việt) khi mốc không tăng dần, bậc cuối không vô hạn, `pct` ngoài [0, 1]; `[]` ⇒ None.
  - `EmployeeSalary.bac_hoa_hong: JSON | None`; `Order.bac_hoa_hong: JSON | None`; `Order.hh_rieng_pct: Numeric(6,4) | None`; `Order.hh_rieng_ly_do: String(255) | None`.
  - `SalaryIn.bac_hoa_hong: list[BacHoaHongIn] | None = None` (`BacHoaHongIn{den_ngay: int | None = Field(None, ge=0), pct: float = Field(ge=0, le=1)}`), `SalaryOut.bac_hoa_hong: list[dict] | None = None`. `commission_pct` giữ trong schema (dormant).
  - `order_service._bac_hoa_hong_cua_sale(db, sale_user_id, *, on=None) -> list[dict] | None` thay `_pct_hoa_hong_cua_sale` (cùng luật `effective_from <= on`, hoà ngày id lớn thắng).

- [ ] **Step 1: Test**

```python
CTV = [{"den_ngay": 45, "pct": 0.03}, {"den_ngay": 60, "pct": 0.02},
       {"den_ngay": 75, "pct": 0.01}, {"den_ngay": None, "pct": 0}]
LANH_DAO = [{"den_ngay": None, "pct": 0.005}]

def test_bac_ctv_moc_bien():
    assert [pct_theo_bac(CTV, n) for n in (0, 45, 46, 60, 61, 75, 76, 400)] == \
        [0.03, 0.03, 0.02, 0.02, 0.01, 0.01, 0, 0]

def test_lanh_dao_khong_gioi_han_ngay():
    assert pct_theo_bac(LANH_DAO, 383) == 0.005

def test_so_ngay_am_coi_nhu_0():
    assert pct_theo_bac(CTV, -12) == 0.03

def test_rong_la_khong_huong():
    assert pct_theo_bac(None, 10) == 0.0 and pct_theo_bac([], 10) == 0.0

def test_chuan_hoa_chan_moc_khong_tang():
    with pytest.raises(ValueError):
        chuan_hoa_bac([{"den_ngay": 60, "pct": 0.02}, {"den_ngay": 45, "pct": 0.03}, {"den_ngay": None, "pct": 0}])
    with pytest.raises(ValueError):
        chuan_hoa_bac([{"den_ngay": 45, "pct": 0.03}])          # thiếu bậc vô hạn
```

API test: `POST /api/luong/salaries/{eid}` với `bac_hoa_hong=CTV` ⇒ 201, `GET` trả lại đúng; gửi biểu mốc lùi ⇒ 400. Sửa 3 test chụp % trong `test_hoa_hong_kinh_doanh.py` sang `_bac_hoa_hong_cua_sale` (mức tương lai không được chụp; chưa khai ⇒ None); chốt đơn ⇒ `order.bac_hoa_hong == biểu của sale`.

- [ ] **Step 2:** pytest hai file ⇒ FAIL.
- [ ] **Step 3:** Viết `bac_hoa_hong.py`; thêm cột model; schema; router/service/repo truyền `bac_hoa_hong` (service gọi `chuan_hoa_bac`, `ValueError` ⇒ `PayrollValidationError`); `confirm` ghi `order.bac_hoa_hong = _bac_hoa_hong_cua_sale(...)` khi đơn chưa có biểu, thôi ghi `commission_pct`.
- [ ] **Step 4: Migration** `<số>_bac_hoa_hong`: `ALTER TABLE employee_salaries ADD COLUMN bac_hoa_hong JSON`; `ALTER TABLE orders ADD COLUMN bac_hoa_hong JSON, hh_rieng_pct NUMERIC(6,4), hh_rieng_ly_do VARCHAR(255)` (mỗi cột kiểm `_existing_columns` riêng). Backfill raw SQL: dòng `commission_pct > 0` và `bac_hoa_hong IS NULL` ⇒ `[{"den_ngay": null, "pct": commission_pct}]` (dựng JSON trong Python từ `SELECT id, commission_pct`, `UPDATE ... WHERE id = :id`). `DB_SCHEMA.md`: thêm 4 cột; đánh dấu hai `commission_pct` là DORMANT.
- [ ] **Step 5:** pytest `tests/test_bac_hoa_hong.py tests/test_hoa_hong_kinh_doanh.py tests/test_hoa_hong_sale.py` + test guard DB_SCHEMA (`grep -l DB_SCHEMA backend/tests`) ⇒ PASS.

### Task 3: Engine hoa hồng theo dòng phiếu thu

**Files:**
- Modify: `backend/app/services/hoa_hong_service.py` (viết lại thân, giữ hai hàm API)
- Test: `backend/tests/test_hoa_hong_kinh_doanh.py`

**Interfaces:**
- Consumes: `pct_theo_bac`, `Order.bac_hoa_hong`, `Order.hh_rieng_pct` (Task 2).
- Produces:
  - `HoaHongService.cac_khoan(tu_ngay, den_ngay, *, user_ids: set[int] | None = None) -> list[dict]` — mỗi dòng phiếu thu `received`, `receipt_date` trong kỳ, đơn có `sale_user_id`: khoá `employee_id, receipt_id, so_phieu (doc_no or code), order_id, order_no, invoice_no (str | None), ngay_hoa_don (date | None), ngay_thu, so_ngay, tien_thu, goc, pct, pct_rieng (bool), tien` (`tien` chưa làm tròn).
  - `hoa_hong_ky_map(...)` và `hoa_hong_ky(...)` giữ chữ ký, đọc từ `cac_khoan`, làm tròn tổng từng người.

Công thức (spec §1):

```
dòng có hoá đơn: goc = amount × tỷ_lệ_trước_VAT(đơn) − (hđ.chiet_khau + hđ.ke_gia) × amount / hđ.amount_vnd
                 so_ngay = max(0, receipt_date − hđ.invoice_date)
dòng cọc:        goc = amount × (Σ line_total − Σ chiet_khau − Σ ke_gia) / Σ (line_total × (100 + vat) / 100)
                 so_ngay = 0
pct = hh_rieng_pct nếu không NULL, ngược lại pct_theo_bac(order.bac_hoa_hong, so_ngay)
tien = max(0, goc) × pct
```

- [ ] **Step 1: Viết lại test phần "Công thức"** — helper `_thu(order_id, so_tien, *, ngay, hoa_don_id=None, huy=False)` tạo `PaymentReceipt` (`source_type=RECEIPT_SOURCE_SALES_INVOICE`, `status` received/cancelled) + `PaymentReceiptLine`; `_sales(..., bac=...)`, `_don(..., bac=...)`, `_hoa_don(...)` trả id. Test bắt buộc (số lấy từ sổ):
  - `test_K_DUNG_GOODY_124_ngay_ra_259445`: lãnh đạo, HĐ 25/04 VAT 8% 56.040.120, thu 27/08 đủ ⇒ `_tinh == 259_445`.
  - `test_CTV_PINACO_30_ngay_tru_CK_ra_1423464`: biểu CTV, HĐ 23/07 53.620.704 có `chiet_khau=2_200_000`, thu 22/08 đủ ⇒ `1_423_464`.
  - `test_moc_la_THANG_THU_khong_phai_thang_hoa_don`: HĐ tháng 7, thu tháng 8 ⇒ kỳ 7 ra 0, kỳ 8 ra tiền.
  - `test_bac_46_ngay_ra_2pct`, `test_76_ngay_ra_0`.
  - `test_thu_TRUOC_hoa_don_tinh_0_ngay` (Review Focus 2).
  - `test_thu_TUNG_PHAN_hai_ky_chia_CK_ke_theo_ty_le`: HĐ 108tr có CK 5tr, thu 54tr tháng 8 + 54tr tháng 9 ⇒ mỗi kỳ gốc 47.500.000.
  - `test_coc_tru_CK_ke_theo_ty_le_don_va_0_ngay`.
  - `test_phieu_thu_HUY_khong_tinh`.
  - `test_hh_rieng_thang_bieu` (1% thắng biểu 3%) và `test_hh_rieng_bang_0_la_loai_tay` (Review Focus 4).
  - `test_doi_bieu_sau_khi_chot_don_cu_giu_bieu_da_chup`.
  - `test_mot_phieu_nhieu_don_khac_nguoi` (Review Focus 1).
  - `test_hoa_don_so_tien_0_khong_chia_0` (Review Focus 3).
  - Giữ (đổi helper sang phiếu thu): người khác, chưa tài khoản, nghỉ việc, lên phiếu lương + gross, tính lại không cộng đôi, chịu TNCN, cột riêng, file xuất.
- [ ] **Step 2:** pytest file ⇒ FAIL.
- [ ] **Step 3:** Viết lại `hoa_hong_service.py`: docstring module ghi mốc mới (chủ 23/10, đảo quyết định 21/08) + công thức trên; `cac_khoan` gom ≤ 4 truy vấn (dòng thu join phiếu; đơn + dòng đơn `selectinload`; hoá đơn theo id; nhân viên theo user_id). Sửa docstring `_hoa_hong_map` trong `payroll_service.py` ("theo hoá đơn bán" ⇒ "theo tiền thu về").
- [ ] **Step 4:** pytest `tests/test_hoa_hong_kinh_doanh.py tests/test_luong_nap_theo_me.py tests/test_luong_api.py` ⇒ PASS.

### Task 4: API soi hoa hồng + đặt % riêng

**Files:**
- Modify: `backend/app/schemas/payroll.py`, `backend/app/routers/payroll.py` (cạnh `chi_tiet_khoan_km` ~1499), `backend/app/services/payroll_service.py` (cạnh `chi_tiet_khoan_km` ~2554), `backend/app/audit_registry.py`
- Test: `backend/tests/test_hoa_hong_kinh_doanh.py`

**Interfaces:**
- Consumes: `HoaHongService.cac_khoan` (Task 3).
- Produces:
  - `GET /api/luong/lines/{line_id}/hoa-hong` (ô `ConfigViewer`, rào phạm vi như khoán km) ⇒ `HoaHongChiTietOut{items: list[HoaHongKhoanOut], tong: float}`; `HoaHongKhoanOut` mang đúng các khoá của `cac_khoan` trừ `employee_id`; `tong = round(Σ tien)`.
  - `PUT /api/luong/don/{order_id}/hoa-hong-rieng` (ô `luong:update`) body `HoaHongRiengIn{pct: float | None = Field(None, ge=0, le=1), ly_do: str | None = Field(None, max_length=255)}` ⇒ 200 `{order_id, pct, ly_do}`. `pct` khác None mà `ly_do` trống ⇒ 400 "Phải nêu lý do". Ghi nhật ký `payroll_set_hh_rieng` (nhãn "Đặt % hoa hồng riêng của đơn"), detail `"<order_no>: <pct cũ> → <pct mới>, <lý do>"`.
  - `PayrollService.chi_tiet_hoa_hong(*, line_id, scope=None, actor=None) -> list[dict]`, `PayrollService.dat_hoa_hong_rieng(*, order_id, pct, ly_do, actor) -> dict`.

- [ ] **Step 1: Test:** `test_SOI_hoa_hong_tong_khop_cot_dong_luong` (tong == dòng lương `hoa_hong`, mỗi item có `so_ngay`, `pct`); `test_SALE_khong_dat_duoc_hh_rieng` (user chỉ có quyền đơn hàng ⇒ 403); `test_dat_hh_rieng_ghi_nhat_ky_va_doi_tien`; `test_hh_rieng_thieu_ly_do_400`; `test_bo_hh_rieng_ve_None_thi_quay_lai_bieu`.
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt. **Step 4:** pytest file + `tests/test_audit_registry*.py` (nếu có) ⇒ PASS. Restart uvicorn.

### Task 5: Giao diện — bảng bậc ở hồ sơ lương

**Files:**
- Create: `frontend/src/pages/nhan-su-luong/luong/components/BacHoaHongField.tsx`, `BacHoaHongField.test.tsx`
- Modify: `frontend/src/pages/nhan-su-luong/luong/modals/SalaryModal.tsx` (78, 128, 305, 940–958), `frontend/src/api/client.ts` (kiểu SalaryIn/SalaryOut)

**Interfaces:**
- Produces: `BacHoaHongField({ value: BacHoaHong[]; onChange: (v: BacHoaHong[]) => void })`, `type BacHoaHong = { den_ngay: number | null; pct: number }` (pct hiển thị dạng %, lưu phân số — đổi ở modal lúc nạp/lưu).

- [ ] **Step 1: Test vitest** (khuôn `danh-muc/fields/Bands.test.tsx`): nhãn "Đến … ngày" / "Trên 45 đến" / "Trên 75"; "＋ Thêm bậc" chèn trước bậc vô hạn; bậc vô hạn không có nút xoá; mốc lùi tô `rc-bands__row--invalid`; chưa có bậc ⇒ câu "Không hưởng hoa hồng — bấm “＋ Thêm bậc”.".
- [ ] **Step 2: Viết component** dùng `RowEditor` (`../../../danh-muc/fields/RowEditor`) + import `rebuild-catalog.css`; cột `["Khi số ngày thu tiền", "Thì hoa hồng"]`; ô giá trị một ô số + chữ "%" (không nút Tờ); bậc vô hạn duy nhất nhãn "Mọi số ngày".
- [ ] **Step 3: SalaryModal:** thay ô "% hoa hồng (NV kinh doanh)" bằng nhãn "Hoa hồng kinh doanh theo số ngày thu tiền" + `BacHoaHongField`; nạp từ `latest.bac_hoa_hong` (Review Focus 5: mốc mới điền sẵn biểu mốc trước); gửi `bac_hoa_hong` (rỗng ⇒ `null`), thôi gửi `commission_pct`. Lỗi 400 hiện như lỗi lưu hiện có.
- [ ] **Step 4:** `npx vitest run src/pages/nhan-su-luong/luong/components/BacHoaHongField.test.tsx` + `npx tsc --noEmit` ⇒ sạch.

### Task 6: Giao diện — ngăn soi hoa hồng trong bảng lương

**Files:**
- Create: `frontend/src/pages/nhan-su-luong/luong/components/SoiHoaHong.tsx`, `SoiHoaHong.test.tsx`
- Modify: `frontend/src/pages/nhan-su-luong/luong/tabs/BangLuongTab.tsx` (ô Hoa hồng ~1186–1193, mount cạnh `SoiKhoanKm` ~1478), `frontend/src/api/client.ts` (`api.luong.chiTietHoaHong`, `api.luong.datHoaHongRieng`)

**Interfaces:**
- Consumes: hai API Task 4.
- Produces: `SoiHoaHong({ token, line, period, coQuyenSua, onClose, onDaDoi })`.

- [ ] **Step 1: Test vitest:** bảng hiện cột Phiếu thu | Đơn | Hoá đơn | Ngày HĐ | Ngày thu | Số ngày | Tiền thu | Gốc | % | Hoa hồng; tổng lệch cột dòng lương > 1 ⇒ hiện cảnh báo như `SoiKhoanKm`; `coQuyenSua=false` ⇒ không có nút "% riêng".
- [ ] **Step 2: Component** khuôn `SoiKhoanKm` (ns-modal wide). Dòng có `pct_rieng` ghi "% riêng" cạnh %. `coQuyenSua` ⇒ mỗi đơn có nút "Đặt % riêng" mở ô % + ô lý do + Lưu/Bỏ % riêng; lưu xong gọi `onDaDoi` (bảng lương tự Tính lại dòng/kỳ như nút hiện có, rồi tải lại ngăn).
- [ ] **Step 3: BangLuongTab:** ô Hoa hồng có số ⇒ bấm mở ngăn (giống ô Khoán km); `title` đổi "theo tiền thu về trong kỳ". `coQuyenSua` = quyền `luong:update` theo cách màn đang kiểm quyền.
- [ ] **Step 4:** vitest file + `npx tsc --noEmit` ⇒ sạch.

### Task 7: Nạp dữ liệu tháng 8 + khai người + đối chiếu

**Files:**
- Create: `<scratchpad>/nap_hoa_hong_t08.py` (script dev, không commit)

- [ ] **Step 1: Đọc header** sheet `DOANH THU T8` và `Lương KD CTV` từ `<scratchpad>/bl_t08.xlsx` (cột NV KD, khách, số HĐ, ngày bán, ngày thu, G=HĐ, H=tiền thu, L=CK+kê, I=thực). Bỏ 12 dòng cột I trống (kế toán loại tay). Dòng N SƠN lấy từ `Lương KD CTV` (sheet DOANH THU quên trừ kê).
- [ ] **Step 2: Khai người qua UI dev-browser** (bấm thật): tài khoản cho Sơn, Kim Dung, Ngọc Sơn nối hồ sơ; hồ sơ lương: Sơn và Kim Dung biểu "Mọi số ngày 0,5%", Ngọc Sơn biểu CTV; Thịnh xoá biểu về rỗng.
- [ ] **Step 3: Script nạp** vào `svn_erp_trong` (127.0.0.1:5433): mỗi dòng thu ⇒ khách (theo tên), đơn đã chốt `sale_user_id` theo NV KD (`S SƠN Đ`, `S SƠN L` ⇒ Sơn; `K DUNG` ⇒ Kim Dung; `N SƠN` ⇒ Ngọc Sơn; `<SALE>-<TRỢ LÝ>` ⇒ sale), `bac_hoa_hong` chụp biểu hiện hành của người đó, một dòng đơn `line_total = H/1.08` VAT 8 (HĐ) hoặc `H` VAT 0; hoá đơn issued `invoice_date = ngày bán`, `amount_vnd = H`, `chiet_khau = L`; phiếu thu received `receipt_date = ngày thu` + một dòng. Mã đơn/phiếu tiền tố `T08-` để nhận ra và xoá được.
- [ ] **Step 4: UI:** Bảng lương tháng 8 bấm "Tính lại"; đọc ô Hoa hồng: Sơn 23.387.255, Kim Dung 14.928.934, Ngọc Sơn 19.633.062, sale 0. Lệch thì mở ngăn soi, so từng dòng với sheet, sửa gốc nguyên nhân.
- [ ] **Step 5: UI:** khoản phát sinh "Lương kinh doanh" cho trợ lý (Trang Đài 3.921.464, Kim Luyến 3.593.850, Thanh Thanh 2.908.533, Hải Yến 595.470, Mai 124.500) qua "Sửa dòng lương" → "Khoản phát sinh tháng này"; chưa có khoản danh mục thì tạo ở Cấu hình lương (bấm thật).

### Task 8: Bấm thử các luồng đã sửa

- [ ] Báo giá: mở báo giá nháp, nhập chiết khấu 3% ⇒ đọc tiền CK = 3% giá bán trước kê; gõ tay giá bán ⇒ CK theo giá gõ; đổi số lượng/giá vốn ⇒ % giữ nguyên.
- [ ] Hồ sơ lương: thêm/xoá bậc, nhập mốc lùi thấy tô đỏ, lưu, mở lại thấy đúng biểu.
- [ ] Bảng lương: bấm ô Hoa hồng mở ngăn soi; đặt % riêng 1% kèm lý do cho một đơn, thấy tiền đổi; bỏ % riêng thấy quay lại.
- [ ] Báo cáo liệt kê từng bước bấm/gõ/thấy; ghi rõ dữ liệu tháng 8 nạp bằng script.
