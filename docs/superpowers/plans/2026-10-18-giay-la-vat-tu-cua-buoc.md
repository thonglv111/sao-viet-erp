# Giấy là vật tư của bước — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phiếu tính giá thôi chọn giấy ở mục "Giấy nguyên"; giấy được thêm vào bất kỳ công đoạn nào qua ô "+ Thêm vật tư", engine tính tiền từng dòng giấy theo đầu vào của bước, và dòng giấy chảy thẳng xuống bước tương ứng của lệnh sản xuất.

**Architecture:** `phieu_buoc_vat_tu` thêm cột `hang_loai` (`vat_tu` | `giay`) — cùng khoá cặp lệnh SX đã dùng. `phieu_thanh_phan.giay_id` không còn là ô nhập mà là DẪN XUẤT ("giấy chính") do máy chủ chốt lúc lưu, nên mọi nơi đang đọc nó (bài ghép, quy cách lệnh, báo giá, `_may_fit`, `dinh_luong`) giữ nguyên. Engine tính một dòng tiền giấy cho MỖI dòng giấy ở bước; lệnh SX nhận dòng giấy theo vị trí bước rồi để `_dong_bo_dong_giay` dẫn xuất số lượng.

**Tech Stack:** FastAPI + SQLAlchemy (không Alembic — migration tay ở `db_migrations.py`), React + TS.

**Spec (chốt trong chat 18/10/2026):**
1. Mục 2 bỏ ô "Loại giấy" + dòng giá đ/kg; còn Dài/Rộng nguyên.
2. Ô "+ Thêm vật tư" của MỌI công đoạn liệt kê thêm danh mục Giấy (nhóm "Giấy" và "Vật tư khác").
3. Lượng giấy ở bước suy từ ĐẦU VÀO của bước: nhận tờ in ⇒ tờ in vào ÷ số mảnh xả = tờ nguyên; nhận tờ nguyên ⇒ số tờ vào; đầu vào khác (con/cái…) ⇒ không tính được, hiện "—" + lý do, 0đ, không bịa số.
4. Tiền giấy = tổng các dòng giấy, mỗi dòng chạy công thức giá của chính mã giấy đó.
5. Giấy chính = giấy đầu tiên ở bước In (nhóm `print`); không có thì giấy đầu tiên ở công đoạn đầu tiên có giấy. Nuôi `dinh_luong`, quy cách báo giá, kiểm gsm máy.
6. "Thiếu giấy" (phiếu + lệnh) = KHÔNG công đoạn nào có dòng giấy.
7. Phát lệnh: dòng giấy của từng bước đi xuống đúng bước đó.
8. Phiếu cũ có `giay_id`: migration chuyển thành dòng giấy ở bước In (không có thì bước đầu).

## Global Constraints

- Cột Boolean server_default `false`/`true`; cột mới phải ghi vào `docs/DB_SCHEMA.md` (guard test).
- Migration: raw SQL đích danh cột, idempotent, đặt tên `0418_phieu_buoc_vat_tu_hang_loai` (0416/0417 đang dở ở cây chính).
- Verify: `python -m pytest tests/<file> -q` từ `backend/`, `npx tsc --noEmit` + `npx vitest run <file>` từ `frontend/`. KHÔNG chạy `./init.ps1`, KHÔNG pytest cả bộ.
- Commit tiếng Việt, không trailer Co-Authored-By.

## Review Focus

1. Payload cũ (test, API, cấu hình tái bản lưu JSON trước đổi) gửi `giay_id` mà không có dòng giấy ⇒ phải tự thành dòng giấy ở bước In, không mất giấy. — test ở Task 2.
2. Người dùng xoá dòng giấy duy nhất ⇒ `giay_id` về NULL, không còn dòng tiền giấy ma từ `don_gia_giay` cũ trong cột. — test ở Task 2 + Task 3.
3. Giấy #7 và Vật tư #7 trùng id ⇒ không lẫn tên/định mức/tiền (FE khoá theo cặp, BE `nap_danh_muc_phieu` tách hai bộ id). — test ở Task 3 + Task 6.
4. Giấy ở bước có đầu vào là con/cái ⇒ 0đ + lý do, không nổ. — test ở Task 3.
5. Lệnh tạo từ phiếu có giấy ở bước In ⇒ dòng giấy có số lượng thật, `thieu_giay` không bật. — test ở Task 4.

---

### Task 1: Cột `hang_loai` + schema + migration

**Files:** `backend/app/models/phieu_tinh_gia.py` (PhieuBuocVatTu), `backend/app/schemas/phieu_tinh_gia.py`, `backend/app/db_migrations.py`, `docs/DB_SCHEMA.md`, test mới `backend/tests/test_giay_vat_tu_buoc.py`

**Produces:** `PhieuBuocVatTu.hang_loai: str` (String(10), NOT NULL, default/server_default `"vat_tu"`); `BuocVatTuIn.hang_loai: Literal["vat_tu","giay"] = "vat_tu"`; `BuocVatTuOut.hang_loai: str = "vat_tu"`; migration `_migrate_phieu_buoc_vat_tu_hang_loai(db)`.

- [ ] Test `test_mg_0418_chuyen_giay_id_thanh_dong_buoc_in`: dựng bảng cũ (thiếu cột) trên SQLite, một thành phần có `giay_id=5`, hai bước (Cắt nhóm `finishing` thu_tu 0, In nhóm `print` thu_tu 1) ⇒ sau migration bước In có đúng một dòng `hang_loai='giay', vat_tu_id=5`; chạy lần hai không nhân dòng; thành phần không bước nào thì không thêm gì.
- [ ] Migration: ADD COLUMN nếu thiếu, rồi INSERT dòng giấy cho thành phần có `giay_id` mà chưa bước nào có dòng giấy; bước đích = bước nhóm `print` đầu tiên theo (thu_tu, id), không có thì bước đầu; `thu_tu` = max+1 của bước đó.
- [ ] Ghi cột vào DB_SCHEMA.md; chạy test mới + `tests/test_db_schema*.py` xanh; commit.

### Task 2: Máy chủ chốt giấy chính lúc lưu

**Files:** Create `backend/app/services/ptg_giay_buoc.py`; Modify `backend/app/routers/phieu_tinh_gia.py` (`_build_thanh_phan`, `_ghi_de_thanh_phan`), `backend/app/services/san_pham_tai_ban_service.py` (snapshot mang `hang_loai`; cấu hình đọc ra đi qua chuẩn hoá), `backend/app/services/ptg_nhan_ban_service.py` (kiểm cột mới được chép).

**Produces:**
- `giay_chinh(rows: list[dict], nhom_cua: Callable[[int | None], str | None]) -> int | None`
- `chuan_hoa_giay(data: dict, nhom_cua) -> dict` — `data` là `ThanhPhanIn.model_dump()`: có `giay_id` mà không dòng giấy nào ⇒ chèn dòng giấy vào bước In (không có thì bước đầu; không bước nào thì giữ `giay_id`); sau đó `data["giay_id"] = giay_chinh(...)` khi có bước.
- `nhom_cong_doan(db, rows) -> Callable` tra nhóm công đoạn một câu.

- [ ] Tests (API `POST /api/phieu-tinh-gia`): (a) payload cũ `giay_id` + chuỗi [In, Cán] ⇒ đọc lại thấy dòng giấy ở bước In, `giay_id` giữ nguyên; (b) giấy chỉ ở bước Cán ⇒ `giay_id` = giấy đó; (c) giấy ở In là A, ở Bồi là B ⇒ `giay_id = A`; (d) PUT bỏ dòng giấy, không gửi `giay_id` ⇒ `giay_id` NULL.
- [ ] Cài; chạy `tests/test_giay_vat_tu_buoc.py tests/test_phieu_tinh_gia.py tests/test_san_pham_tai_ban.py` xanh; commit.

### Task 3: Engine — tiền giấy theo bước

**Files:** `backend/app/services/tinh_gia_service.py` (`nap_danh_muc_phieu`, `_vat_tus_cua_buoc`, `_resolve_thanh_phan`, `danh_muc_doi_sau_khi_tinh`, thêm `goc_gia_giay`), `backend/app/services/thanh_phan_engine.py` (`_compute_one`), `backend/app/services/danh_muc_tham_chieu.py`.

**Interfaces:** dòng vật tư của bước gửi engine nay có `hang_loai`. Dòng giấy: `{hang_loai:"giay", vat_tu_id, ten, gsm, don_gia, don_vi_gia, he_so, goc ("to"|"kg"|None), cong_thuc_gia}`. Dòng NVL engine trả cho giấy: `loai:"giay"`, `hang_loai:"giay"`, `vat_tu_id`, `buoc_idx`, `so_to`, `thanh_tien`, `dinh_muc`, `dinh_muc_don_vi`, `dinh_muc_ly_do`, `dinh_muc_cong_thuc_goc`, `dinh_muc_cong_thuc`. Dòng vật tư thêm `hang_loai:"vat_tu"`.

- [ ] Tests engine: (1) chuỗi [In] + giấy kg ở In ⇒ đúng một dòng giấy, tiền bằng công thức cũ `dinh_luong*dai*rong*don_gia*to_nguyen`; (2) giấy A ở In + giấy B ở Bồi (vào tờ in) ⇒ hai dòng, B dùng tờ vào bước Bồi ÷ xả và gsm của B; (3) giấy ở bước vào `cai` ⇒ dòng 0đ, `dinh_muc=None`, có lý do + warning; (4) chuỗi có bước nhưng không giấy ⇒ không dòng giấy, warning "chưa chọn giấy"; (5) dict cũ không bước, có `don_gia_giay` ⇒ vẫn dòng giấy cấp sản phẩm.
- [ ] Test service: Giấy id 1 và Vật tư id 1 cùng ở một bước ⇒ hai dòng đúng tên.
- [ ] Cài: `_resolve_thanh_phan` chỉ bơm giấy cấp sản phẩm (`don_gia_giay`/công thức) khi chuỗi rỗng; `gsm`/`giay_ten` vẫn theo giấy chính. Engine: dòng giấy cấp sản phẩm CHỈ khi không bước nào có giấy và dict có giá giấy; còn lại tính trong vòng vật tư theo bước. `danh_muc_tham_chieu` đếm `PhieuBuocVatTu` theo `hang_loai`.
- [ ] Chạy `tests/test_thanh_phan_engine.py tests/test_giay_vat_tu_buoc.py tests/test_bien_cong_thuc.py tests/test_quyen_xem_chi_tiet_gia_von.py tests/test_tinh_gia_khong_n_cong_1.py` xanh; commit.

### Task 4: Lệnh sản xuất nhận dòng giấy + kiểm thiếu giấy

**Files:** `backend/app/services/lsx_service.py` (`_tinh_dong` routing mang `hang_loai`; `_bung_vat_tu_cong_doan` tách giấy; `tao` gọi `_dong_bo_dong_giay` sau bung; `thieu_cua`).

- [ ] Tests: (1) phiếu giấy ở In ⇒ lệnh tạo xong bước In có dòng `hang_loai='giay'`, `so_luong > 0`, `tu_dong=False`, `thieu` không có `thieu_giay`; (2) giấy chỉ ở bước Cán ⇒ không `thieu_giay`; (3) phiếu không giấy ⇒ có `thieu_giay`.
- [ ] Cài: dòng giấy dựng `LsxCongDoanVatTu(hang_loai=HANG_GIAY, …)` với số từ `_dong_giay_cho_ma` (chưa tính được ⇒ 0, `_dong_bo_dong_giay` ghi lại sau). `thieu_giay` = không `cd.vat_tus` nào `hang_loai == HANG_GIAY`.
- [ ] Chạy `tests/test_lsx_service.py tests/test_ke_hoach_vat_tu.py tests/test_giu_cho_vat_tu.py tests/test_ke_hoach_vat_tu_buoc_dau.py tests/test_sx_vat_tu_de_nghi.py tests/test_san_xuat_chot_giay_tuyen.py tests/test_giay_vat_tu_buoc.py`; test đỏ vì lệnh nay CÓ dòng giấy đúng thiết kế thì sửa kỳ vọng, đỏ vì hỏng thì sửa code; commit.

### Task 5: Frontend — ô Thêm vật tư nhận giấy, bỏ ô Loại giấy

**Files:** `frontend/src/api/client.ts` (BuocVatTuIn/Out `hang_loai`), `frontend/src/pages/BuocVatTu.tsx`, `frontend/src/pages/BuocVatTu.test.tsx`, `frontend/src/pages/PhieuTinhGiaDetailView.tsx`.

**Interfaces:** `BuocVatTuDong { uid; hang_loai: "giay" | "vat_tu"; vat_tu_id; gia_tri_chip }`; `BuocVatTu` thêm prop `giayDm: Row[]`; `dinhMuc?: Map<string, DinhMuc>` khoá `"<hang_loai>:<id>"`.

- [ ] Test vitest: ô chọn có nhóm "Giấy" và "Vật tư khác"; chọn giấy ⇒ `onChange` nhận dòng `hang_loai:"giay"`; Giấy #1 và Vật tư #1 cùng có mặt ⇒ hai tên đúng.
- [ ] Cài BuocVatTu; ở DetailView: `dinhMucTheoBuoc` khoá cặp, `fromFinishing`/`toThanhPhamIn` mang `hang_loai`, bỏ ô Loại giấy + dòng giá + `onPickGiay` + `giayOpts`, `toThanhPhanIn` thôi gửi `giay_id`, cảnh báo dòng thiếu = không bước nào có giấy.
- [ ] `npx tsc --noEmit` sạch, `npx vitest run src/pages/BuocVatTu.test.tsx` xanh; commit.

### Task 6: Bấm thử trọn luồng trên trình duyệt

Worktree + DB clone `svn_erp_trong` + Redis riêng, BE/FE cổng riêng. Luồng: mở phiếu cũ (đã migrate) thấy giấy nằm ở bước In, mục 2 không còn ô Loại giấy → thêm giấy vào bước sau in → Tính giá thấy hai dòng tiền giấy → xoá giấy ở In xem giấy chính đổi → báo giá → đơn → chốt → chuyển SX → tạo lệnh → bước của lệnh có dòng giấy kèm số tờ. Báo cáo liệt kê từng bước đã bấm/gõ/thấy.
