# Hai lương khối Sản xuất + tiền khoán từ lần ghi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps dùng checkbox (`- [ ]`).

**Goal:** Người khối Sản xuất / Giao hàng tính 2 lương ăn bên lớn; vế khoán có tiền thật từ lần ghi
sản lượng (giá theo tổ, công thức khoán chạy thật, luật theo ngày, tổ trưởng chia / thưởng).

**Architecture:** Định nghĩa "tính 2 lương" một chỗ (khối SX kế thừa cây ∪ tổ Giao hàng). Tiền khoán
tính ở service mới `khoan_ky.py` (đọc lần ghi của kỳ → tiền từng người, tăng ca khoán, danh sách thiếu
giá), `PayrollService.generate` gọi nó qua `self.components.db` như `KhoanKmService` — không đụng
`deps.py` (đang có thay đổi chưa commit của phiên khác).

**Tech Stack:** FastAPI + SQLAlchemy (không Alembic — cột mới viết vào `db_migrations.py`), React/TS.

**Spec:** `docs/superpowers/specs/2026-10-20-hai-luong-khoi-san-xuat-design.md`

## Global Constraints

- Không chạy `./init.ps1`, không pytest full; verify bằng pytest nhắm file + `npx tsc --noEmit`.
- Cột mới ⇒ migration trong `backend/app/db_migrations.py` + ghi `docs/DB_SCHEMA.md` cùng lúc.
- Không sửa / stage các file đang dở của phiên khác (`deps.py`, `purchase*`, `client.ts`, …). `client.ts`
  bắt buộc phải thêm field thì chỉ THÊM dòng, không đụng hunk của người khác. Không commit (chủ chưa bảo).
- Hai chữ tăng ca luôn tách: "Tăng ca khoán" / "Tăng ca theo giờ", không dùng "Tăng ca" trơn trên lương.
- Tổ chưa khai giá ⇒ báo thiếu giá, KHÔNG đoán giá.

## Giả định tự chốt (ghi lại cho chủ duyệt)

1. Tiền một lần ghi chia ĐỀU cho những người được tick ở lần ghi đó (spec để "giờ chia tính sau").
2. Ngày của lần ghi = ngày `bat_dau` theo giờ xưởng (VN, +7).
3. Chỉ tiêu ngày so với tiền sản lượng GỐC của tổ trong ngày (trước khi nhân đôi CN trùng lễ); 50%
   phần vượt chia theo tỷ lệ phần mỗi người trong ngày đó.
4. Tổ trưởng: mốc hiệu lực tại NGÀY CUỐI kỳ; quỹ của tổ = tiền sản lượng (đã áp luật ngày, chưa gồm
   tăng ca khoán) của tổ đó + mọi tổ con. Ăn chia: mọi phần của tổ × (1 − tỷ lệ), tổ trưởng +tỷ lệ ×
   quỹ. Ăn thưởng: tổ trưởng +tỷ lệ × quỹ, không ai bị trừ. Tổ trưởng = `departments.head_user_id`.
5. Công thức khoán có biến mới `sl_ghi` (tổng ghi = tốt + hỏng), `sl_tot` (số tốt), `gia_co_dinh`
   (giá cố định của tổ). Không khai công thức ⇒ tiền = `gia_co_dinh + sl_tot × don_gia`. Công thức
   không gọi chip `don_gia_khoan` ⇒ ra LƯỢNG, tiền = kết quả × đơn giá (luật cũ `cong_thuc_ra_tien`).
6. Bảng giá theo tổ rỗng ⇒ mọi tổ dùng giá chung của công đoạn; đã có dòng tổ nào thì tổ vắng mặt là
   thiếu giá. Giá chụp vào lần ghi lúc ghi (như ảnh chụp hiện có); thiếu lúc ghi thì băng "Danh mục
   đã đổi" cho cập nhật sau.

## Review Focus

- Người công nhật thuộc khối SX (vế khoán 0) phải ra ĐÚNG số như trước + đủ tiền tăng ca theo giờ.
- Người ngoài khối SX / Giao hàng: số không đổi một đồng.
- Thử việc khối SX: luôn vế thời gian, có tăng ca theo giờ, khoán và tăng ca khoán = 0.
- "Sửa 1 ô" ra cùng gross với "Tính lại" khi có tăng ca khoán.
- Công thức khoán lỗi / thiếu biến ⇒ lần ghi vào danh sách thiếu giá (kèm lý do), không 500.

---

### Task 1: Một định nghĩa "tính 2 lương", bỏ hai công tắc (backend)

**Files:** `app/repositories/rbac_repo.py`, `app/services/payroll_service.py`, `app/models/payroll.py`
(`SALARY_COMPONENT_KEYS`), `app/services/san_xuat/board.py`, `app/services/san_xuat/thuc_thi.py`,
tests `test_luong_cau_hinh.py`, `test_chi_tieu_ngay_khoan.py`, `test_to_truong_khoan.py`,
`test_san_xuat_thuc_thi.py` (sửa theo luật mới).

**Interfaces — Produces:**
- `DepartmentRepository.dept_ids_khoi_san_xuat() -> set[int]` (tự bật hoặc tổ tiên bật `la_san_xuat`).
- `PayrollService._tinh_hai_luong(department_id) -> bool` = khối SX ∪ Giao hàng; `che_do_khoan()`
  công khai trả đúng hàm này. `_che_do_khoan` giữ tên, gọi hàm mới.
- `services/san_xuat/thuc_thi.thuoc_khoi_san_xuat(db, department_id) -> bool` dùng cho `la_luong_khoan`.

- [ ] Test: tổ con của phòng `la_san_xuat` (không công tắc nào) ⇒ `che_do_khoan` True; phòng ngoài
  khối ⇒ False; `dept_components` chỉ còn `chuyen_can`; `khai_chi_tieu_ngay` / `khai_to_truong` nhận
  tổ cha khối SX, từ chối phòng ngoài khối với câu "Chỉ tổ thuộc khối Sản xuất…".
- [ ] Code: thay mọi `_component_enabled(COMP_LUONG_KHOAN…)` bằng `_tinh_hai_luong`; `tang_ca_bat = True`
  (bỏ đọc `COMP_TANG_CA`); bỏ chặn Giao hàng ở `set_dept_components` (khoá không còn).
- [ ] pytest các file trên xanh.

### Task 2: Engine 2 lương — tăng ca theo giờ vào vế thời gian, tăng ca khoán, phép có lương

**Files:** `payroll_service.py` (`_compute`, `generate`, `update_line`), `leave_service.py`,
`models/payroll.py` (`PayrollLine.tang_ca_khoan`), `db_migrations.py`, `docs/DB_SCHEMA.md`,
`schemas/payroll.py`, `routers/payroll.py`, `services/luong_excel.py`;
tests `test_khoan_khong_tien_tang_ca.py`, `test_luong_bu_lo_khoan.py`, mới `test_hai_luong_khoi_sx.py`.

**Interfaces — Produces:** `_compute(..., tang_ca_khoan: float = 0.0)` trả thêm `"tang_ca_khoan"`;
cột `payroll_lines.tang_ca_khoan` Numeric NOT NULL default 0.

- [ ] Test (`test_hai_luong_khoi_sx.py`), số trong spec: Quí 26 công, mức 10tr, 10 giờ TC ×1,5 ⇒ vế
  thời gian 10.432.692; khoán 15.974.665 ⇒ gross gồm khoán, `tien_gio_tang_ca`=0; khoán 8tr ⇒
  `tien_gio_tang_ca`=432.692, `luong_cong + khoan + tien_gio_tang_ca` = 10.432.692; khoán 8tr +
  tăng ca khoán 3tr ⇒ ăn khoán 11tr, `tang_ca_khoan`=3tr; ăn thời gian ⇒ `tang_ca_khoan`=0;
  phép: 24 công làm + 2 phép, khoán 8tr ⇒ ăn 10tr; thử việc ⇒ khoán 0, có tăng ca theo giờ.
- [ ] Code: vế thời gian = bù lỗ theo công (bỏ trừ `cong_phep_tra`) + tiền giờ TC + phụ cấp TC đêm
  (3 rổ `ot_night_*`); vế khoán = khoán + km + tăng ca khoán. Ăn thời gian ⇒ trả đủ TC giờ + TC đêm
  trước, phần thiếu vào `luong_cong`, `tang_ca_khoan`=0. Ăn khoán ⇒ TC giờ + TC đêm = 0.
- [ ] Gỡ `_chan_phep_co_luong_khoan` (giữ hàm công khai `chan_phep_khoan` thành no-op để phiếu đi
  muộn không vỡ); `update_line` cộng `tang_ca_khoan` vào gross_pre; migration + DB_SCHEMA; schema /
  router / Excel thêm cột "Tăng ca khoán", đổi nhãn cột tiền giờ thành "Tăng ca theo giờ".
- [ ] pytest các file trên + `test_luong_api.py`, `test_luong_excel.py`, `test_xin_huy_don_da_duyet.py`.

### Task 3: Giá theo tổ + biến công thức khoán + ảnh chụp theo tổ

**Files:** `models/cong_doan.py` (`CongDoanKhoan.gia_theo_to`, `CongDoanKhoanPhatSinh.gia_theo_to`
JSON), `models/san_xuat_san_luong.py` (`SanXuatBatch.gia_co_dinh_khoan_snapshot`), `db_migrations.py`,
`DB_SCHEMA.md`, `schemas/cong_doan.py`, `repositories/cong_doan_repo.py`, `services/cong_doan_service.py`,
`services/bien_cong_thuc.py` (loại ô mới `LOAI_KHOAN = "khoan"` = bộ `quy_doi` + `sl_ghi`, `sl_tot`,
`gia_co_dinh`), `services/san_xuat/viec_khoan.py`, `services/san_xuat/san_luong.py`;
test mới `test_khoan_gia_theo_to.py`.

**Interfaces — Produces:**
- `gia_theo_to`: `list[{"department_id": int, "gia_co_dinh": float, "don_gia": float}]` (phát sinh:
  không có `gia_co_dinh`).
- `viec_khoan.gia_cua_to(khoan, department_id) -> tuple[float | None, float | None]` (gia_co_dinh,
  don_gia); `gia_ps_cua_to(ps, department_id) -> float | None`.
- `chuan_hoa_khi_ghi(..., department_id)` chụp giá CỦA TỔ.

- [ ] Test: lưu công đoạn có bảng giá 2 tổ; tổ trùng / tổ không có thật / số âm ⇒ 422; ghi lần ghi ở tổ
  có giá ⇒ snapshot `don_gia`, `gia_co_dinh` của tổ; tổ vắng ⇒ snapshot None; băng danh mục đổi so
  giá của tổ; công thức `gia_co_dinh + max(0, sl_ghi - 3000) * don_gia_khoan` lưu được (loại `khoan`).
- [ ] Code + migration (JSON nullable, cột Numeric nullable). pytest xanh.

### Task 4: Tính tiền khoán của kỳ và nối vào bảng lương

**Files:** mới `app/services/khoan_ky.py`, `payroll_service.generate` + `routers/payroll.py` (cảnh báo
thiếu giá); test mới `test_khoan_ky.py`.

**Interfaces — Produces:** `KhoanKyService(db).tinh(year, month) -> dict` với khoá `khoan: dict[int,float]`,
`tang_ca_khoan: dict[int,float]`, `thieu_gia: list[{"batch_id", "cong_doan", "to", "ngay", "ly_do"}]`,
`theo_nguoi: dict[int, list[dict]]` (chi tiết từng lần ghi cho ngăn lương).

- [ ] Test, số từ spec: lần ghi in 2M 6.340 tờ, giá 150.000/30 ⇒ 250.200 chia 2 người 125.100; ghi 2
  lần ⇒ ăn 2 lần giá bài; phát sinh thay kẽm 2 × 100.000; tổ in ngày CN ⇒ 0; tổ thường CN trùng lễ ⇒
  ×2; chỉ tiêu 300.000/ngày, tổ làm 400.000 ⇒ tăng ca khoán 50.000; tổ trưởng chia 5% quỹ 105.491.142
  ⇒ +5.274.557 và phần chia cả tổ × 0,95; ăn thưởng ⇒ không trừ ai; tổ thiếu giá ⇒ `thieu_gia`.
- [ ] Code; `generate` thay `khoan_map` bằng kết quả này (vẫn cộng `piece.khoan_map` cũ nếu có),
  truyền `tang_ca_khoan`; `ly_do`/cảnh báo trước chốt nêu số lần ghi thiếu giá. pytest xanh.

### Task 5: Màn Cơ chế lương

**Files:** `cau-hinh/shared/constants.ts`, `cau-hinh/tabs/CoCheTab.tsx`, `CauHinhLuongTab.tsx`,
`components/ChiTieuNgayEditor.tsx`, `components/ToTruongEditor.tsx`, `api/client.ts` (type key).
- [ ] Bỏ hai dòng công tắc; khối Chỉ tiêu ngày + Tổ trưởng hiện cho mọi tổ thuộc khối SX (suy từ cây
  `parent_id` + `la_san_xuat`), có dòng nói "Khối Sản xuất: tính 2 lương, ăn bên lớn"; chỉ tiêu "đ/ngày".
- [ ] `npx tsc --noEmit` xanh.

### Task 6: Tab Khoán của Công đoạn

**Files:** `danh-muc/fields/KhoanCongDoan.tsx`, `danh-muc/fields/ViecPhatSinh.tsx`, `danh-muc/types.ts`,
`CatalogDrawer.tsx` (truyền danh sách tổ phụ trách + tên), CSS nếu cần.
- [ ] Bảng "Giá theo tổ" (mỗi tổ phụ trách một dòng: Giá cố định, Đơn giá); việc phát sinh có cột giá
  theo tổ khi công đoạn đã khai giá theo tổ; ô công thức dùng loại `khoan`, bỏ câu "chưa áp dụng".
- [ ] `npx tsc --noEmit` xanh.

### Task 7: Bảng lương / phiếu lương

**Files:** `luong/tabs/BangLuongTab.tsx`, `luong/components/PayslipCard.tsx`, `luong/shared/helpers.ts`.
- [ ] Hai dòng "Tăng ca khoán" / "Tăng ca theo giờ"; ngăn so 2 lương hiện vế khoán (khoán + tăng ca
  khoán) và vế thời gian (theo công + tăng ca theo giờ), ghi ăn bên nào.
- [ ] `npx tsc --noEmit` + vitest file liên quan.

### Task 8: Bấm thử trọn luồng trên dev-browser

Restart uvicorn. Luồng: Cơ chế lương (tổ máy 2 màu: chỉ tiêu ngày, tổ trưởng) → Danh mục Công đoạn
"Bài in 1 màu hoặc 2 màu" (giá theo tổ 2M/4M/5M/6M/7M, công thức) → Bàn tổ máy 2 ghi một lần ghi có
tick người + việc phát sinh → Lương: Tính lại tháng → thấy tiền khoán, tăng ca khoán, so 2 lương.
Báo cáo từng bước đã bấm / gõ / thấy.
