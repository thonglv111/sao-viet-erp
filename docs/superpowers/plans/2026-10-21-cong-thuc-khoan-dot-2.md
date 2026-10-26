# Công thức khoán Đợt 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ô Công thức khoán của công đoạn viết được công thức của MỌI tổ trong sổ lương T08 (in, bế, cán, cắt, dán, gỡ, thành phẩm, theo giờ), tiền mỗi lần ghi chia theo lương ca máy, và tổ trưởng báo được ngày dừng máy.

**Architecture:** Thêm 3 cột + 1 bảng (mg 0430). Công đoạn khai thêm giá cố định chung và "tuỳ chọn khi ghi"; lần ghi chụp giá trị tuỳ chọn. `KhoanKyService.tinh` nhận mức lương ca máy (`MucKhoan`) do `PayrollService` dựng, bơm thêm chip `so_lan_chay` / `tien_gio` / `tu_tro` / tuỳ chọn vào công thức, chia theo trọng số lương ca máy, cộng tiền ngày dừng máy. Frontend: tab Khoán, hộp Ghi / Sửa số, hộp Báo dừng máy, ngăn soi.

**Tech Stack:** FastAPI + SQLAlchemy (không Alembic), pytest SQLite in-memory; React + TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-hai-luong-khoi-san-xuat-design.md` mục "Đợt 2" (dòng 145–249). Mockup: `docs/mockups/khoan-cong-thuc-bo-sung.html`.

## Global Constraints

- Không Alembic: cột mới viết vào `backend/app/db_migrations.py` hàm `_migrate_khoan_dot_2`, đăng ký `("0430_khoan_dot_2", ...)`, raw SQL đích danh cột, idempotent (khuôn `_migrate_hai_luong_khoan` 0429). Bảng mới để `create_all` tạo.
- Mọi bảng/cột mới ghi vào `docs/DB_SCHEMA.md` cùng task (guard test).
- Cột Boolean (nếu có) server_default là Python bool.
- Verify: pytest nhắm đúng file test + `npx tsc --noEmit` trong `frontend/`. KHÔNG chạy `./init.ps1`, không chạy pytest full.
- Lệnh `python` trần trong `backend/` trỏ DB dev thật — test luôn qua pytest.
- Mỗi commit chỉ `git add` file của task (working tree có file dở của phiên khác: deps.py, purchases, BaoGiaPage, DonHangBanPage, ThsxDrawer, client.ts phần mua hàng…). Commit message tiếng Việt kiểu `feat(luong): …`, KHÔNG có dòng Co-Authored-By.
- Chữ trên UI tiếng Việt, đúng chữ mockup: "Giá cố định chung", "Tuỳ chọn khi ghi", "Có / không", "Số", "Báo dừng máy", "Máy hư", "Hết hàng", "Phiếu sửa máy", "Không canh máy". Không chữ đậm cho mã/tên; không nối mẩu dữ liệu bằng dấu `·` hay dấu phẩy.
- `sl_ghi` = `batch.tot` (cột "Số lượng" ở tab Sản lượng bàn tổ; form ghi gửi `tong = tot`, Sửa số chỉ đổi `tot`). Đợt 1 đang gán `sl_ghi = tong` ⇒ sửa.
- Công đoạn bỏ trống công thức: `gia_co_dinh + sl_ghi × don_gia`.
- Lương ca máy = `(luong_vi_tri + luong_trach_nhiem) × probation_ratio` (nếu thử việc) + `phu_cap_thang` (= `salary.allowance` + khoản hồ sơ kind ≠ `tru`), hồ sơ hiệu lực ngày cuối kỳ. Không gồm cơm ca, khoản phát sinh kỳ, chuyên cần.
- `tien_gio` = Σ người được tick `(luong_vi_tri + luong_trach_nhiem) / 26 / 8 × giờ`, giờ = `(ket_thuc − bat_dau)` tính bằng giờ; không × 1,5, không phụ cấp, không × thử việc.
- Người lương ca máy = 0 trong một lần ghi ⇒ lần ghi vào `thieu_gia`, không chia.

## Review Focus

1. Lần ghi cũ (trước đợt 2) không có `tuy_chon_khoan`, công đoạn sau đó mới khai tuỳ chọn ⇒ công thức gọi `trung_khuon` vẫn chạy (mặc định 0), không rơi vào thiếu giá. Test ở Task 4.
2. Công thức gọi `tien_gio` mà lần ghi chưa có giờ kết thúc ⇒ lần ghi vào `thieu_gia` với lý do "chưa có giờ kết thúc", không ra 0đ im lặng. Test ở Task 4.
3. Khai tuỳ chọn có mã trùng chip hệ thống (`sl_ghi`, `so_mau`…) hoặc trùng tên hàm (`if`, `max`) ⇒ lưu công đoạn báo lỗi rõ, không lưu. Test ở Task 2.
4. Báo dừng máy hai lần cùng tổ cùng ngày ⇒ lần hai báo "Tổ đã báo dừng máy ngày dd/mm", không đẻ dòng trùng. Tổ chưa khai chỉ tiêu ngày ⇒ ngày dừng máy vào cảnh báo, không chia 0đ. Test ở Task 5.
5. Lần ghi có người tổ khác sang phụ: trọng số là lương ca máy của chính người đó (không lấy của tổ). Test ở Task 4.

---

## File Structure

| File | Việc |
|---|---|
| `backend/app/db_migrations.py` | mg 0430 |
| `backend/app/models/cong_doan.py` | `CongDoanKhoan.gia_co_dinh`, `.tuy_chon` |
| `backend/app/models/san_xuat_san_luong.py` | `SanXuatBatch.tuy_chon_khoan` |
| `backend/app/models/payroll.py` | model mới `KhoanDungMay` (cạnh `KhoanChiTieuNgay`) |
| `docs/DB_SCHEMA.md` | ghi 3 cột + bảng |
| `backend/app/schemas/cong_doan.py`, `services/cong_doan_service.py`, `repositories/cong_doan_repo.py` | khai + kiểm + lưu tuỳ chọn, giá cố định chung |
| `backend/app/services/bien_cong_thuc.py` | chip khoán mới, gỡ `sl_tot` |
| `backend/app/services/san_xuat/viec_khoan.py`, `san_luong.py`, `board.py`, `schemas/san_xuat.py`, `routers/san_xuat.py` | lần ghi nhận / sửa tuỳ chọn |
| `backend/app/services/khoan_ky.py`, `repositories/khoan_ky_repo.py`, `services/payroll_service.py` | tính tiền đợt 2 |
| `backend/app/services/san_xuat/dung_may.py` (mới), `routers/san_xuat.py` | API báo dừng máy |
| Frontend (Task 6–7) | xem từng task |

---

### Task 1: Migration 0430 + model + DB_SCHEMA

**Files:**
- Modify: `backend/app/db_migrations.py` (cuối file, sau 0429)
- Modify: `backend/app/models/cong_doan.py` (`CongDoanKhoan`, ~dòng 220)
- Modify: `backend/app/models/san_xuat_san_luong.py` (`SanXuatBatch`)
- Modify: `backend/app/models/payroll.py` (thêm `KhoanDungMay` sau `KhoanChiTieuNgay`, dòng 576)
- Modify: `docs/DB_SCHEMA.md` (mục `cong_doan_khoan`, `san_xuat_batch`, thêm `### khoan_dung_may` sau `khoan_chi_tieu_ngay` ~dòng 2893)
- Test: `backend/tests/test_khoan_dot_2_migration.py` (mới)

**Interfaces — Produces:**
- `CongDoanKhoan.gia_co_dinh: Mapped[float]` — `Numeric(14,2)`, not null, default 0, server_default `"0"`.
- `CongDoanKhoan.tuy_chon: Mapped[list | None]` — JSON `[{"ma": str, "ten": str, "kieu": "co_khong"|"so", "goi_y": str|None}]`, NULL = không có.
- `SanXuatBatch.tuy_chon_khoan: Mapped[list | None]` — JSON `[{"ma", "ten", "kieu", "gia_tri": float}]`, ảnh chụp lúc ghi.
- `KhoanDungMay` bảng `khoan_dung_may`: `id`, `department_id` (FK departments, index), `ngay: Date`, `ly_do: String(16)` ∈ `{"may_hu", "het_hang"}`, `sua_chua_id: Integer | None` (FK `ky_thuat_sua_chua.id`, ON DELETE SET NULL), `ghi_chu: Text | None`, `nguoi_ids: JSON` (list employee id), `created_by: Integer | None`, `created_at: DateTime(timezone=True)`. Unique `(department_id, ngay)` tên `uq_khoan_dung_may_to_ngay`. Hằng `LY_DO_DUNG_MAY = {"may_hu": "Máy hư", "het_hang": "Hết hàng"}` cùng file.

- [ ] **Step 1: Viết test hỏng** — `test_mg_0430_them_cot_tren_db_cu`: dựng engine SQLite tạm, tạo bảng `cong_doan_khoan` / `san_xuat_batch` THIẾU 3 cột (raw SQL tối giản đủ cột id), chạy `_migrate_khoan_dot_2`, assert `inspect` thấy `gia_co_dinh`, `tuy_chon`, `tuy_chon_khoan`; chạy lần hai không lỗi. `test_khoan_dung_may_unique_to_ngay`: fixture `db`, thêm hai `KhoanDungMay` cùng tổ cùng ngày ⇒ `IntegrityError`.
- [ ] **Step 2:** `cd backend && pytest tests/test_khoan_dot_2_migration.py -v` ⇒ FAIL (import lỗi).
- [ ] **Step 3:** Thêm cột model, model mới, migration (`("cong_doan_khoan","gia_co_dinh","NUMERIC(14, 2) NOT NULL DEFAULT 0")`, `("cong_doan_khoan","tuy_chon","JSON")`, `("san_xuat_batch","tuy_chon_khoan","JSON")`), DB_SCHEMA.
- [ ] **Step 4:** `pytest tests/test_khoan_dot_2_migration.py tests/test_db_schema_doc.py -v` ⇒ PASS (tên file guard: `grep -l DB_SCHEMA backend/tests/*.py`).
- [ ] **Step 5: Commit** `feat(luong): mg 0430 giá cố định chung, tuỳ chọn khi ghi, bảng dừng máy`.

---

### Task 2: Cấu hình công đoạn — giá cố định chung + tuỳ chọn khi ghi + chip mới

**Files:**
- Modify: `backend/app/schemas/cong_doan.py` (`CongDoanKhoanIn`, `CongDoanKhoanRow`)
- Modify: `backend/app/services/cong_doan_service.py` (`_chuan_hoa` 61–89, `_anh_chup_nhan_ban` 91–106, `_kiem_khoan` 291–329)
- Modify: `backend/app/repositories/cong_doan_repo.py` (`_replace_khoan` 132–158)
- Modify: `backend/app/services/bien_cong_thuc.py` (`_RIENG_KHOAN` dòng 193)
- Modify: `backend/app/services/san_xuat/viec_khoan.py` (`gia_cua_to`)
- Test: `backend/tests/test_khoan_dot_2_cau_hinh.py` (mới)

**Interfaces — Produces:**
- Schema `TuyChonKhoanIn(ma: str, ten: str, kieu: Literal["co_khong","so"] = "co_khong", goi_y: str | None = None)`; `CongDoanKhoanIn.gia_co_dinh: float = 0`, `.tuy_chon: list[TuyChonKhoanIn] = []`; `CongDoanKhoanRow` trả cùng hai field.
- `_RIENG_KHOAN` sau task: `sl_ghi` (mô tả "Số lượng thợ ghi ở lần ghi — cột Số lượng của bàn tổ"), `gia_co_dinh` (nguồn: "Giá cố định chung hoặc bảng Giá theo tổ — ảnh chụp lúc ghi"), `so_lan_chay` ("Số lần ghi của cùng lệnh ở cùng công đoạn tính tới cuối kỳ lương, tối thiểu 1", đơn vị "lần"), `tien_gio` ("Σ người làm (lương vị trí + trách nhiệm) ÷ 26 ÷ 8 × số giờ lần ghi", "đ"), `tu_tro` ("1 khi quy cách in là tự trở hoặc trở nhíp, ngược lại 0", "0/1"). `sl_tot` GỠ.
- `gia_cua_to(khoan, department_id) -> tuple[float|None, float|None]`: bảng giá theo tổ rỗng ⇒ `(float(khoan.gia_co_dinh or 0), float(khoan.unit_price))`; còn lại như cũ.
- Kiểm tuỳ chọn trong `_kiem_khoan`: `ma` qua `bien_cong_thuc.ma_hop_le`; không trùng mã trong `BIEN`, không thuộc `TEN_HAM_CAM`, không trùng nhau trong cùng công đoạn; `ten` không rỗng. Rồi `self._kiem_o(..., loai=LOAI_KHOAN, bien_them=[t["ma"] for t in tuy_chon])` (thêm tham số `bien_them` vào `_kiem_o`, chuyển xuống `kiem_cong_thuc`).

- [ ] **Step 1: Viết test hỏng** trong `test_khoan_dot_2_cau_hinh.py` (dựng công đoạn bằng service như `tests/test_khoan_ky.py::_Nen.khoan`):
  - `test_luu_gia_co_dinh_chung_va_tuy_chon`: lưu `gia_co_dinh=150000`, `tuy_chon=[{"ma":"trung_khuon","ten":"Trùng khuôn","kieu":"co_khong"}]`, công thức `(1 - trung_khuon) * gia_co_dinh + sl_ghi * don_gia_khoan` ⇒ đọc lại đủ hai field, không lỗi.
  - `test_cong_thuc_goi_tuy_chon_chua_khai_bao_loi`: cùng công thức nhưng `tuy_chon=[]` ⇒ `ValueError` có chữ `trung_khuon`.
  - `test_tuy_chon_trung_chip_he_thong_bi_chan`: `ma="sl_ghi"` ⇒ `ValueError` "trùng"; `ma="max"` ⇒ `ValueError`; hai tuỳ chọn cùng `ma` ⇒ `ValueError`.
  - `test_chip_sl_tot_da_go`: công thức `sl_tot * don_gia_khoan` ⇒ `ValueError`; `so_lan_chay`, `tien_gio`, `tu_tro` qua kiểm.
  - `test_gia_cua_to_bang_rong_lay_gia_co_dinh_chung`: `gia_cua_to(khoan(gia_co_dinh=150000, unit_price=180), 7) == (150000.0, 180.0)`.
- [ ] **Step 2:** `pytest tests/test_khoan_dot_2_cau_hinh.py -v` ⇒ FAIL.
- [ ] **Step 3:** Code theo Interfaces. `_anh_chup_nhan_ban` chép cả hai field.
- [ ] **Step 4:** `pytest tests/test_khoan_dot_2_cau_hinh.py tests/test_khoan_ky.py tests/test_bien_cong_thuc*.py -v` ⇒ PASS. Test cũ nào gọi `sl_tot` thì đổi sang `sl_ghi` (đọc kỹ ý test trước khi sửa).
- [ ] **Step 5: Commit** `feat(cong-doan): giá cố định chung, tuỳ chọn khi ghi, chip so_lan_chay tien_gio tu_tro`.

---

### Task 3: Lần ghi nhận và sửa tuỳ chọn

**Files:**
- Modify: `backend/app/services/san_xuat/viec_khoan.py` (`chuan_hoa_khi_ghi`)
- Modify: `backend/app/services/san_xuat/san_luong.py` (`tao_batch`, `sua_so_me`)
- Modify: `backend/app/schemas/san_xuat.py` (`BatchIn` ~1045, `SuaSoMeIn`, `BatchOut` ~691, `KhoanCongDoanThucThiOut` ~1081)
- Modify: `backend/app/services/san_xuat/board.py` (dict `"khoan"` ~1393–1411; dict lần ghi gửi ra)
- Modify: `backend/app/routers/san_xuat.py` (`tao_batch` 705, `sua_so_me` 744: chuyển `tuy_chon=body.tuy_chon`)
- Test: `backend/tests/test_khoan_dot_2_lan_ghi.py` (mới)

**Interfaces:**
- Consumes: `CongDoanKhoan.tuy_chon`, `SanXuatBatch.tuy_chon_khoan` (Task 1).
- Produces:
  - Body: `BatchIn.tuy_chon: dict[str, float] = {}`; `SuaSoMeIn.tuy_chon: dict[str, float] | None = None` (None = không đổi).
  - `chuan_hoa_khi_ghi(db, *, khoan, ten_cong_doan, phat_sinh, department_id=None, tuy_chon: dict[str, float] | None = None)` — o_snapshot thêm key `tuy_chon_khoan`: mỗi tuỳ chọn KHAI ở công đoạn một phần tử `{ma, ten, kieu, gia_tri}`; `co_khong` ép về 0/1; thiếu ⇒ 0; mã gửi lên không có trong khai ⇒ `ValueError("Tuỳ chọn không có ở công đoạn: <ma>")`; `so` âm ⇒ `ValueError`.
  - `tao_batch(..., tuy_chon: dict[str, float] | None = None)`; `sua_so_me(..., tuy_chon: dict[str, float] | None = None)` — đổi tuỳ chọn cũng là một lần sửa hợp lệ (số trùng nhưng tuỳ chọn khác thì KHÔNG báo "Số mới trùng số đang ghi."), ghi nhật ký như sửa số.
  - `KhoanCongDoanThucThiOut.tuy_chon: list[{ma, ten, kieu, goi_y}]`; `BatchOut.tuy_chon_khoan: list[{ma, ten, kieu, gia_tri}] | None`.

- [ ] **Step 1: Viết test hỏng** (khuôn dựng lệnh/công việc như `tests/test_khoan_ky.py::_Nen.ghi`):
  - `test_ghi_luu_anh_chup_tuy_chon`: công đoạn khai `trung_khuon` (co_khong) + `so_lo` (so); `tao_batch(tuy_chon={"trung_khuon": 1, "so_lo": 3})` ⇒ `batch.tuy_chon_khoan == [{"ma":"trung_khuon","ten":"Trùng khuôn","kieu":"co_khong","gia_tri":1.0}, {"ma":"so_lo","ten":"Số lỗ đục","kieu":"so","gia_tri":3.0}]`.
  - `test_ghi_khong_gui_tuy_chon_mac_dinh_0`: ⇒ mọi `gia_tri == 0`.
  - `test_ghi_tuy_chon_la_bi_chan`: `tuy_chon={"xa_doi": 1}` khi không khai ⇒ `ValueError`.
  - `test_sua_so_chi_doi_tuy_chon`: `sua_so_me(tot=<số cũ>, tuy_chon={"trung_khuon": 0})` ⇒ không lỗi, ảnh chụp đổi, `version` tăng.
- [ ] **Step 2:** `pytest tests/test_khoan_dot_2_lan_ghi.py -v` ⇒ FAIL.
- [ ] **Step 3:** Code theo Interfaces.
- [ ] **Step 4:** `pytest tests/test_khoan_dot_2_lan_ghi.py tests/test_khoan_ky.py tests/test_san_luong*.py -v` ⇒ PASS.
- [ ] **Step 5: Commit** `feat(san-xuat): lần ghi chụp tuỳ chọn khoán, sửa số đổi được tuỳ chọn`.

---

### Task 4: Tính tiền kỳ — chia theo lương ca máy + chip mới

**Files:**
- Modify: `backend/app/services/khoan_ky.py` (docstring giả định 1 → chia theo lương ca máy; `_tien_chinh`; `tinh`)
- Modify: `backend/app/repositories/khoan_ky_repo.py` (thêm `dem_lan_chay`)
- Modify: `backend/app/services/payroll_service.py` (`khoan_ky` dòng 2508 + hàm mới `muc_khoan`)
- Modify: `backend/tests/test_khoan_ky.py` (gọi `tinh` với `MucKhoan`; đổi tên/kỳ vọng test chia đều)
- Test: `backend/tests/test_khoan_dot_2_tinh.py` (mới)

**Interfaces:**
- Consumes: Task 1–3.
- Produces:
  ```python
  @dataclass(frozen=True)
  class MucKhoan:                      # trong khoan_ky.py
      luong_ca_may: dict[int, float]   # employee_id → trọng số chia (Global Constraints)
      nen_gio: dict[int, float]        # employee_id → luong_vi_tri + luong_trach_nhiem
  ```
  - `KhoanKyService.tinh(year: int, month: int, muc: MucKhoan) -> dict` — cùng khoá trả về như đợt 1.
  - `KhoanKyService._tien_chinh(khoan, b, qc: dict, them: dict[str, float]) -> float` — ctx như đợt 1 nhưng `sl_ghi = tot`, bỏ `sl_tot`, cộng `them` (= `so_lan_chay`, `tien_gio`, `tu_tro` + mọi mã tuỳ chọn KHAI ở `khoan.tuy_chon` mặc định 0, đè bằng `b.tuy_chon_khoan`). Công thức rỗng ⇒ `gia_cd + tot * don_gia`.
  - `KhoanKyRepository.dem_lan_chay(den: datetime, khoa: set[tuple[int|None, int|None, int]]) -> dict[tuple, int]` — khoá `(cv.lsx_id, cv.bai_ghep_id, b.khoan_cong_doan_id)`, đếm lần ghi có `bat_dau < den`, cùng bộ lọc lần ghi hợp lệ với `lan_ghi_trong_khoang`. Một query gộp.
  - `PayrollService.muc_khoan(year: int, month: int) -> MucKhoan` — dùng `latest_salaries_map(pay_on)`, `_components_map`, `_resolve_monthly`, trạng thái thử việc qua `trang_thai_tren_ngay` tại `pay_on` (nạp sự kiện gộp một lần như vòng generate, không mỗi người một query); `PayrollService.khoan_ky` gọi `KhoanKyService(db).tinh(year, month, self.muc_khoan(year, month))`.
- Thuật toán chia một lần ghi (thay `moi = tien / len(ds)`):
  ```
  w = {e: muc.luong_ca_may.get(e, 0) for e in ds}
  thiếu = [e for e in ds if w[e] <= 0]  ⇒ bao("… <tên> chưa có lương ca máy"), bỏ lần ghi
  phần[e] = tien * w[e] / Σw
  ```
  Người thử việc vẫn có trọng số và có phần trong `khoan`; `_compute` đã ép khoán thử việc về 0 (luật 16/09) nên phần đó tự bỏ, không dồn cho ai — KHÔNG thêm luật thử việc vào `khoan_ky`.
  `tien_gio` của lần ghi = `Σ muc.nen_gio[e] for e in ds / 26 / 8 × giờ`; công thức có chữ `tien_gio` mà `b.ket_thuc` rỗng ⇒ bao "chưa có giờ kết thúc", bỏ lần ghi. `tu_tro = 1.0 if qc.get("quy_cach_in") in ("tu_tro", "tro_nhip") else 0.0`. `so_lan_chay = max(1, dem[khoá])`, `den` = mốc cuối kỳ đã dùng cho `lan_ghi_trong_khoang`.
  Dòng `chi_tiet` loại `lan_ghi` thêm `tuy_chon: list[str]` — nhãn của tuỳ chọn khác 0: `co_khong` ⇒ `ten` viết thường ("trùng khuôn"), `so` ⇒ `"<giá trị> <ten viết thường>"` ("3 số lỗ đục"); và `ty_le: float` (w[e]/Σw, 3 số lẻ).

- [ ] **Step 1: Viết test hỏng** trong `test_khoan_dot_2_tinh.py` (dùng `_Nen` của `test_khoan_ky.py` — import hoặc chép fixture), mọi test truyền `MucKhoan` tự dựng:
  - `test_chia_theo_luong_ca_may`: lần ghi 1.000.000đ, Nhất 14.000.000, Linh 9.000.000 ⇒ phần Nhất 608.696, Linh 391.304 (`round`).
  - `test_thieu_luong_ca_may_bao_thieu`: Linh mức 0 ⇒ lần ghi trong `thieu_gia` có chữ "lương ca máy", không ai có tiền lần đó.
  - `test_nguoi_to_khac_dung_muc_cua_ho`: lần ghi tổ A có người tổ B mức 6.000.000, người tổ A 12.000.000 ⇒ 1/3 – 2/3.
  - `test_be_trung_khuon_xa_doi_so_lo` (công thức Bế ở spec, `gia_co_dinh=150000`, `don_gia=120`): `sl_ghi=1000, trung_khuon=1, xa_doi=1, so_lo=3` ⇒ `1000*2*(120+20) = 280000`; `trung_khuon=0, xa_doi=0, so_lo=7` ⇒ `150000 + 1000*170 = 320000`.
  - `test_in_chay_tiep_tu_tro_mau_pha` (công thức In ở spec, `gia_co_dinh=200000`, `don_gia=60`): lệnh tự trở, `sl_ghi=2000`, `chay_tiep=0`, không màu pha ⇒ `200000 + (4000-3000)*60 = 260000`; `chay_tiep=1` ⇒ `4000*60 = 240000`; lệnh `mot_mat` có `so_mau_pha=1`, `sl_ghi=5000`, `chay_tiep=0` ⇒ `(200000 + 2000*60) * 1.1 = 352000`.
  - `test_dan_canh_may_chia_so_lan_chay`: công thức Dán, `gia_co_dinh=50000`, `don_gia=100`; cùng lệnh cùng công đoạn ghi 2 lần trong kỳ, mỗi lần `sl_ghi=100` ⇒ mỗi lần `25000 + 10000 = 35000`; có thêm lần thứ 3 ở KỲ SAU ⇒ tính kỳ này vẫn 35000/lần.
  - `test_dan_khong_canh`: `khong_canh=1` ⇒ lần đó chỉ `sl_ghi * don_gia`.
  - `test_tien_gio`: công thức `tien_gio`, hai người nền 7.800.000 và 5.200.000, lần ghi 8:00–12:00 ⇒ `(7800000+5200000)/26/8*4 = 250000`.
  - `test_tien_gio_thieu_gio_ket_thuc_bao_thieu` (Review Focus 2).
  - `test_lan_ghi_cu_chua_co_tuy_chon_mac_dinh_0` (Review Focus 1): batch `tuy_chon_khoan=None`, công đoạn khai `trung_khuon` ⇒ tính như `trung_khuon=0`.
  - `test_cong_thuc_rong_dung_sl_ghi_la_tot`: batch `tong=120, tot=100`, không công thức, `gia_co_dinh=0`, `don_gia=10` ⇒ 1000.
  - `test_chi_tiet_co_the_tuy_chon_va_ty_le`: dòng `lan_ghi` có `tuy_chon == ["trùng khuôn", "3 số lỗ đục"]` và `ty_le`.
  - `test_muc_khoan_tu_ho_so` (payroll): NV chính thức vị trí 6.600.000, TN 3.300.000, allowance 0, khoản hồ sơ thu 5.400.000 + 400.000×3 + 0, một khoản `tru` 200.000 ⇒ `luong_ca_may == 16_500_000`, `nen_gio == 9_900_000`; NV thử việc (ratio 0.85) vị trí 3.600.000 TN 2.700.000 phụ cấp 2.700.000 ⇒ `luong_ca_may == 6_300_000*0.85 + 2_700_000`.
- [ ] **Step 2:** `pytest tests/test_khoan_dot_2_tinh.py -v` ⇒ FAIL.
- [ ] **Step 3:** Code theo Interfaces. Sửa `test_khoan_ky.py` cho chữ ký mới; test "chia_deu" đổi tên + đổi kỳ vọng sang tỷ lệ (cho hai người cùng mức thì vẫn ra đều — giữ được số cũ nếu dựng mức bằng nhau).
- [ ] **Step 4:** `pytest tests/test_khoan_dot_2_tinh.py tests/test_khoan_ky.py tests/test_payroll*.py -v` ⇒ PASS.
- [ ] **Step 5: Commit** `feat(luong): khoán chia theo lương ca máy, chip so_lan_chay tien_gio tu_tro và tuỳ chọn khi ghi`.

---

### Task 5: Báo dừng máy — API + tính tiền

**Files:**
- Create: `backend/app/services/san_xuat/dung_may.py`
- Modify: `backend/app/repositories/khoan_ky_repo.py` (`dung_may_trong_khoang`)
- Modify: `backend/app/services/khoan_ky.py` (cộng tiền dừng máy)
- Modify: `backend/app/schemas/san_xuat.py` (`DungMayIn`, `DungMayOut`)
- Modify: `backend/app/routers/san_xuat.py`
- Test: `backend/tests/test_khoan_dot_2_dung_may.py` (mới)

**Interfaces:**
- Consumes: `KhoanDungMay`, `LY_DO_DUNG_MAY` (Task 1), `MucKhoan` (Task 4).
- Produces:
  - Service `dung_may.py`: `danh_sach(db, *, user, department_id: int, year: int, month: int) -> dict` trả `{"ds": [DungMayOut], "nguoi": [{"employee_id", "ho_ten"}]}` (nguoi = NV đang thuộc tổ); `bao(db, *, user, department_id, ngay: date, ly_do: str, sua_chua_id: int|None, ghi_chu: str|None, nguoi_ids: list[int]) -> dict`; `xoa(db, *, user, dung_may_id: int) -> None`. Mọi hàm gọi `quyen_to.gate_to_tron(db, user.id, department_id, VIEC_XAC_NHAN)`. Trùng tổ+ngày ⇒ `ValueError("Tổ đã báo dừng máy ngày dd/mm")`. `nguoi_ids` rỗng ⇒ `ValueError("Chọn người hưởng ngày dừng máy")`. `ly_do` ngoài `LY_DO_DUNG_MAY` ⇒ `ValueError`. `sua_chua_id` phải tồn tại.
  - Route: `GET /api/san-xuat/teams/{department_id}/dung-may?nam=&thang=`, `POST /api/san-xuat/teams/{department_id}/dung-may` (body `DungMayIn{ngay, ly_do, sua_chua_id, ghi_chu, nguoi_ids}`), `DELETE /api/san-xuat/dung-may/{id}`; dependency `require_quyen_to("confirm_output")`, lỗi qua `_chay`.
  - `DungMayOut{id, department_id, ngay, ly_do, ly_do_ten, sua_chua_id, sua_chua_ma, ghi_chu, nguoi: [{employee_id, ho_ten}]}`.
  - Trong `tinh`: mỗi ngày dừng máy của kỳ: `muc_ngay = chi_tieu(department_id, ngay)` (cùng hàm lần ngược tổ cha của đợt 1); không có ⇒ `canh_bao` "Tổ <tên> chưa khai chỉ tiêu ngày — ngày dừng máy dd/mm chưa tính". Có ⇒ chia `muc_ngay` theo trọng số lương ca máy giữa `nguoi_ids` (mức 0 ⇒ `thieu_gia` như lần ghi). Cộng vào `khoan[e]`; KHÔNG vào quỹ ngày so chỉ tiêu (tăng ca khoán), KHÔNG vào quỹ tổ trưởng. `chi_tiet` thêm dòng `{"loai": "dung_may", "ngay", "to", "ly_do": <tên>, "sua_chua": <mã>|None, "ghi_chu", "tien_ngay", "so_nguoi", "ty_le", "tien"}`. Ngày dừng máy có lần ghi ⇒ cộng cả hai.
  - Giả định tự chốt (nói với chủ khi báo cáo): người hưởng ngày dừng máy do tổ trưởng tick trong hộp (sẵn mọi người của tổ), không đọc chấm công.

- [ ] **Step 1: Viết test hỏng:**
  - `test_bao_dung_may_va_tinh_chi_tieu`: tổ chỉ tiêu ngày 1.150.000, báo dừng máy ngày 05 (Máy hư) cho Nhất 14tr + Linh 9tr ⇒ `khoan` Nhất 700.000, Linh 450.000; `tang_ca_khoan` không đổi; `chi_tiet` Nhất có dòng `dung_may` `ly_do == "Máy hư"`.
  - `test_dung_may_cong_ca_lan_ghi`: cùng ngày có lần ghi 1.000.000 (vượt chỉ tiêu 0 vì tiền dừng máy không vào quỹ so) ⇒ tổng = phần lần ghi + phần dừng máy.
  - `test_bao_trung_ngay_bi_chan` (Review Focus 4).
  - `test_to_chua_khai_chi_tieu_canh_bao` (Review Focus 4).
  - `test_khong_quyen_xac_nhan_bi_chan`: user chỉ có `run_order` ⇒ `PermissionError`/403 theo cách `gate_to_tron` ném.
  - `test_xoa_dung_may`.
- [ ] **Step 2:** `pytest tests/test_khoan_dot_2_dung_may.py -v` ⇒ FAIL.
- [ ] **Step 3:** Code theo Interfaces.
- [ ] **Step 4:** `pytest tests/test_khoan_dot_2_dung_may.py tests/test_khoan_dot_2_tinh.py tests/test_khoan_ky.py -v` ⇒ PASS. Restart uvicorn dev (bật lại qua WMI như memory `bat-dev-server-uvicorn-tach-roi`).
- [ ] **Step 5: Commit** `feat(san-xuat): báo dừng máy ở bàn tổ, ngày dừng máy ăn chỉ tiêu ngày`.

---

### Task 6: Frontend — tab Khoán + hộp Ghi / Sửa số

**Files:**
- Modify: `frontend/src/pages/danh-muc/types.ts` (`KhoanCongDoanValue` thêm `gia_co_dinh: number`, `tuy_chon: TuyChonKhoanRow[]`; type `TuyChonKhoanRow{ma, ten, kieu: "co_khong"|"so", goi_y: string|null}`)
- Modify: `frontend/src/pages/danh-muc/fields/KhoanCongDoan.tsx`
- Modify: `frontend/src/api/client.ts` — CHỈ các type sản xuất: `SxKhoanCongDoan.tuy_chon`, `SxBatch.tuy_chon_khoan`, body ghi/sửa `tuy_chon` (file có hunk dở của phiên khác: `git add -p` chỉ hunk của mình)
- Modify: `frontend/src/pages/ThsxExecPanels.tsx` (`BatchForm` 334, khối khoán 476–516; `SuaSoMeForm` 1308; `BatchRow` 751)
- Test: `frontend/src/pages/danh-muc/fields/KhoanCongDoan.test.tsx` (mới hoặc thêm), `frontend/src/pages/ThsxExecPanels.test.tsx` (nếu có; không thì tạo)

**Interfaces — Consumes:** Task 2–3 field names.

UI (theo mockup màn 2–3):
- Tab Khoán: ô "Giá cố định chung" cạnh "Đơn giá chung" (ô tiền dùng `OGoDinhDang`). Khối "Tuỳ chọn khi ghi" ngay trên "Công thức khoán": bảng dòng `Tên hiện cho thợ | Mã biến | Kiểu (Có / không, Số) | Gợi ý | xoá`, nút "+ Thêm tuỳ chọn"; mã tự gợi từ tên (bỏ dấu, viết thường, khoảng trắng → `_`; "Trùng khuôn" → `trung_khuon`), người khai sửa được. `FormulaField` nhận `bienThem` dựng từ tuỳ chọn (`{ma, nhan: ten, mo_ta: "Tuỳ chọn khi ghi", don_vi: kieu === "so" ? "" : "0/1", nguon: "thợ chọn ở lần ghi", loai: ["khoan"]}`).
- Hộp Ghi sản lượng và Sửa số: khối tuỳ chọn đặt trên việc phát sinh — `co_khong` là checkbox nhãn `ten`, `so` là ô số nhãn `ten` placeholder `goi_y`. Gửi `tuy_chon: {ma: số}`. Sửa số mở sẵn giá trị từ `tuy_chon_khoan`.
- `BatchRow`: thẻ nhỏ cho tuỳ chọn khác 0 (cùng nhãn backend: "trùng khuôn", "3 số lỗ đục").

- [ ] **Step 1: Viết test hỏng** (vitest + Testing Library): `KhoanCongDoan` — thêm tuỳ chọn "Trùng khuôn" ⇒ `onChange` nhận `tuy_chon[0].ma === "trung_khuon"`; gõ "Giá cố định chung" 150000 ⇒ `gia_co_dinh === 150000`. `BatchForm` — khoan có tuỳ chọn `trung_khuon` + `so_lo` ⇒ tick + gõ 3 rồi Lưu ⇒ `exec` nhận body `tuy_chon: {trung_khuon: 1, so_lo: 3}`.
- [ ] **Step 2:** `cd frontend && npx vitest run src/pages/danh-muc/fields/KhoanCongDoan.test.tsx src/pages/ThsxExecPanels.test.tsx` ⇒ FAIL.
- [ ] **Step 3:** Code.
- [ ] **Step 4:** Lệnh vitest trên ⇒ PASS; `npx tsc --noEmit` ⇒ 0 lỗi.
- [ ] **Step 5: Commit** `feat(san-xuat): khai tuỳ chọn khi ghi ở tab Khoán, tick tuỳ chọn ở hộp ghi sản lượng`.

---

### Task 7: Frontend — Báo dừng máy, ngăn soi, gỡ ô Lương khoán

**Files:**
- Create: `frontend/src/pages/BaoDungMayModal.tsx`
- Modify: `frontend/src/pages/ThucHienSxPage.tsx` (nút "Báo dừng máy" trên thanh công cụ bàn tổ, chỉ hiện khi bàn đang mở một tổ lá và người dùng có `confirm_output` ở tổ đó — dùng cờ quyền bàn tổ đang có ở trang)
- Modify: `frontend/src/api/client.ts` (hàm `dungMayDs`, `baoDungMay`, `xoaDungMay`; `KhoanKyDong.loai` thêm `"dung_may"`, field `tuy_chon?: string[]`, `ty_le?: number`, `ly_do?`, `sua_chua?`, `ghi_chu?`, `tien_ngay?`) — `git add -p`
- Modify: `frontend/src/pages/nhan-su-luong/luong/components/SoiKhoanKy.tsx` (`NHAN` thêm `dung_may: "Dừng máy"`; thẻ tuỳ chọn dưới tên công đoạn; cột Số người hiện thêm tỷ lệ `0,609`; dòng dừng máy: Khoản = "Dừng máy", Công đoạn/tổ = tổ + lý do + mã phiếu sửa)
- Modify: `frontend/src/pages/nhan-su-luong/phong-ban/DepartmentsPage.tsx` (gỡ ô "Lương khoán" dòng 2221–2226; giữ field trong payload nếu backend còn đọc — chỉ gỡ khỏi màn)
- Test: `frontend/src/pages/BaoDungMayModal.test.tsx` (mới)

UI hộp Báo dừng máy (mockup màn 4): Ngày (ô ngày của dự án, cấm ô ngày gốc trình duyệt), Lý do (hai nút chọn Máy hư / Hết hàng), Phiếu sửa máy (chọn từ phiếu sửa chữa của tổ, tuỳ chọn, chỉ hiện khi Máy hư), Ghi chú, Người hưởng (`NguoiLamChon` export lại từ `ThsxExecPanels.tsx`, tick sẵn mọi người của tổ), danh sách các ngày đã báo trong tháng có nút xoá. Lưu xong toast + danh sách tự cập nhật.

- [ ] **Step 1: Viết test hỏng:** `BaoDungMayModal` — chọn Hết hàng, bỏ tick 1 người, Lưu ⇒ hàm gửi nhận `{ly_do: "het_hang", nguoi_ids: [còn lại]}`; Máy hư mới hiện ô Phiếu sửa máy. `SoiKhoanKy` — dòng `dung_may` hiện chữ "Dừng máy" và lý do; dòng `lan_ghi` có `tuy_chon: ["trùng khuôn"]` hiện thẻ "trùng khuôn".
- [ ] **Step 2:** `npx vitest run src/pages/BaoDungMayModal.test.tsx src/pages/nhan-su-luong/luong/components/SoiKhoanKy.test.tsx` ⇒ FAIL.
- [ ] **Step 3:** Code.
- [ ] **Step 4:** vitest ⇒ PASS; `npx tsc --noEmit` ⇒ 0 lỗi.
- [ ] **Step 5: Commit** `feat(luong): hộp báo dừng máy, ngăn soi hiện tuỳ chọn và ngày dừng máy, gỡ ô Lương khoán`.

---

### Task 8: Bấm thử luồng thật trên dev-browser

Không code. Restart uvicorn + Vite dev; đăng nhập admin/admin123 (DB dev `svn_erp_trong`, KHÔNG bật SEED_DEMO). Mọi bước bằng chuột/bàn phím, không curl:

- [ ] Danh mục Công đoạn → một công đoạn Bế → tab Khoán: gõ Giá cố định chung 150.000, Đơn giá 120; thêm tuỳ chọn "Trùng khuôn" (Có / không), "Xả đôi" (Có / không), "Số lỗ đục" (Số, mã `so_lo`); dán công thức Bế của spec; Lưu ⇒ không lỗi, mở lại thấy đủ.
- [ ] Bàn tổ Bế → một lệnh có công đoạn đó → Ghi sản lượng: SL 1.000, tick Trùng khuôn + Xả đôi, Số lỗ đục 3, tick hai người → Lưu ⇒ dòng lần ghi hiện thẻ "trùng khuôn", "xả đôi", "3 số lỗ đục".
- [ ] Sửa số lần ghi đó: bỏ Trùng khuôn, giữ số ⇒ lưu được, thẻ đổi.
- [ ] Bàn tổ → Báo dừng máy: ngày hôm qua, Máy hư, bỏ tick một người → Lưu ⇒ ngày hiện trong danh sách; báo lại cùng ngày ⇒ thấy lỗi "Tổ đã báo dừng máy ngày …".
- [ ] Lương → kỳ tháng này → Tính lại → mở ngăn soi Khoán SP của một người tổ đó ⇒ thấy dòng lần ghi có thẻ tuỳ chọn + tỷ lệ, dòng "Dừng máy" có lý do; số khớp tính tay (ghi lại phép tính trong báo cáo).
- [ ] Phòng ban → mở một tổ ⇒ không còn ô "Lương khoán".
- [ ] Báo cáo: liệt kê từng bước đã bấm/gõ/thấy; nói rõ giả định người hưởng ngày dừng máy do tổ trưởng tick.
