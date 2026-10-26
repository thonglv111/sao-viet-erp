# Loại Giấy / Sóng — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mã giấy có loại Giấy/Sóng; mỗi sản phẩm tối đa 1 Giấy + 1 Sóng; các màn sau hiện Giấy và Sóng tách ô.

**Architecture:** Cột `giay_nguyen.loai`. Luật trần đặt ở `services/ptg_giay_buoc.py` (hàm thuần + một hàm tra DB), router PTG và `LsxService` gọi chung. Màn sau đọc loại qua join `giay_nguyen` theo `vat_tu_id` (repo) hoặc trường `giay_loai` của dòng vật tư bước lệnh.

**Tech Stack:** FastAPI, SQLAlchemy, Postgres/SQLite test, React + TS, vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-loai-giay-song-design.md`

## Global Constraints

- Giá trị loại: đúng `"giay"` | `"song"`; mặc định `"giay"`. Nhãn UI: "Giấy" / "Sóng".
- Mã giấy KHÁC NHAU mới tính; cùng mã ở nhiều bước = một mã.
- Thiếu giấy KHÔNG chặn. Chỉ có Sóng ⇒ giấy chính = Sóng.
- Đường đọc (nạp cấu hình tái bản) không chặn.
- Migration raw SQL, idempotent, không ORM full-select; ghi `docs/DB_SCHEMA.md` cùng commit.
- Verify: `python -m pytest tests/<file> -q` từ `backend/`, `npx tsc --noEmit` + `npx vitest run <file>` từ `frontend/`. KHÔNG chạy `init.ps1` / pytest full.
- Commit không có dòng Co-Authored-By (quy ước dự án).

## Review Focus

1. Phiếu mà sóng đứng ở bước TRƯỚC In (Cắt tờ) — giấy chính vẫn phải là mã Giấy (test Task 2).
2. Payload cũ chỉ gửi `giay_id`, không dòng giấy — `chuan_hoa_giay` vẫn chèn dòng như cũ (test sẵn có `test_giay_vat_tu_buoc.py` phải còn xanh).
3. Lệnh phát hành TRƯỚC thay đổi có `giay` dạng mảng — thẻ quy cách vẫn vẽ được (test Task 6 `dongQuyCach` với mảng).
4. Mã giấy id không còn trong danh mục (đã xoá cứng) — `bang_giay` thiếu khoá ⇒ coi là `"giay"`, không nổ (test Task 2).
5. Lưu lệnh không gửi `vat_tus` cho bước (giữ nguyên dòng cũ) — luật trần đếm theo dòng THẬT sau khi gán, không theo payload (test Task 3).

---

### Task 1: Cột `loai` + danh mục Giấy (backend)

**Files:**
- Modify: `backend/app/models/vat_lieu_kho.py` (GiayNguyen), `backend/app/db_migrations.py` (cuối file), `docs/DB_SCHEMA.md` (mục giay_nguyen ~3375), `backend/app/schemas/vat_lieu_kho.py` (GiayIn/GiayRow), `backend/app/repositories/vat_lieu_kho_repo.py` (repo giấy: `fields`, `nhan_cot`, `extra_conds`), `backend/app/routers/vat_lieu_kho.py:126-128`, `backend/app/services/catalog_excel_specs.py:351` (GIAY)
- Test: `backend/tests/test_loai_giay_song.py` (mới)

**Interfaces:**
- Produces: `GiayNguyen.loai: str` (`"giay"|"song"`), hằng `LOAI_GIAY = "giay"`, `LOAI_SONG = "song"` trong `models/vat_lieu_kho.py`. API `/api/vat-lieu-kho/giay` nhận/trả `loai`, lọc `?loai=song`, đếm thanh lọc theo `loai` với nhãn "Giấy"/"Sóng".

- [ ] Step 1: test `test_tao_giay_mac_dinh_loai_giay` (POST không gửi loai ⇒ row `loai == "giay"`), `test_tao_giay_loai_song` (gửi `"song"` ⇒ `"song"`), `test_loai_la_gia_tri_la_bi_422` (`"decal"` ⇒ 422), `test_loc_theo_loai` (2 mã, `?loai=song` ⇒ 1 dòng).
- [ ] Step 2: chạy — FAIL.
- [ ] Step 3: cột `loai = mapped_column(String(8), nullable=False, server_default="giay", default="giay")`; migration `0426_giay_loai` (`ALTER TABLE giay_nguyen ADD COLUMN loai VARCHAR(8) NOT NULL DEFAULT 'giay'` nếu chưa có); `GiayIn.loai: Literal["giay","song"] = "giay"`, `GiayRow.loai: str = "giay"`; repo thêm `"loai"` vào `fields`, `nhan_cot = {"loai": {"giay": "Giấy", "song": "Sóng"}}`, `extra_conds(loai=...)`; router `loc_them {"don_vi_gia": str, "loai": str}`, `dem_them {..., "loai": "loai"}` (chỉ cho giấy); Excel GIAY thêm cột "Loại" (nhận "Giấy"/"Sóng", trống = Giấy). DB_SCHEMA thêm cột.
- [ ] Step 4: chạy test mới + `tests/test_db_schema*.py` + test excel danh mục giấy — PASS.
- [ ] Step 5: commit `feat(giay): loại Giấy/Sóng cho mã giấy`.

### Task 2: Luật trần + giấy chính theo loại (Tính giá)

**Files:**
- Modify: `backend/app/services/ptg_giay_buoc.py`, `backend/app/routers/phieu_tinh_gia.py` (create ~553, update ~709, `_du_lieu_thanh_phan`), `backend/app/services/san_pham_tai_ban_service.py:130-143`
- Test: `backend/tests/test_loai_giay_song.py`, giữ xanh `backend/tests/test_giay_vat_tu_buoc.py`

**Interfaces:**
- Produces trong `ptg_giay_buoc.py`:
  - `class ThongTinGiay(NamedTuple): loai: str; ten: str`
  - `BangGiay = dict[int, ThongTinGiay]`
  - `bang_giay(db: Session, ids: Iterable[int]) -> BangGiay` — MỘT truy vấn.
  - `loai_cua(bang: BangGiay, gid: int) -> str` — vắng ⇒ `"giay"`.
  - `giay_chinh(rows, nhom_cua, bang: BangGiay | None = None) -> int | None` — áp luật cũ (In trước, rồi bước đầu) trên ứng viên loại Giấy; không có ⇒ trên ứng viên loại Sóng. `bang=None` ⇒ mọi mã coi là Giấy (giữ hành vi cũ cho nơi gọi chưa có bảng).
  - `chuan_hoa_giay(data, nhom_cua, bang: BangGiay | None = None) -> dict`
  - `loi_tran_giay(ten_sp: str, ids: Iterable[int], bang: BangGiay) -> str | None` — ids lặp được; trả câu lỗi hoặc None. Câu: `f'Sản phẩm «{ten_sp}» đang có {n} giấy: {", ".join(tên)}. Mỗi sản phẩm chỉ một giấy.'`; sóng: `… đang có {n} sóng: … Mỗi sản phẩm chỉ một sóng.`
  - `id_giay_cua_rows(rows) -> list[int]` — id các dòng `hang_loai == "giay"` theo thứ tự.

- [ ] Step 1: test thuần: `test_giay_chinh_la_ma_loai_giay_du_song_dung_truoc` (bước Cắt tờ có SONG, bước In có COUCHE ⇒ COUCHE; và Cắt tờ có [SONG, COUCHE] ⇒ COUCHE), `test_chi_song_thi_song_la_giay_chinh`, `test_bang_thieu_ma_coi_la_giay`, `test_loi_tran_hai_giay`, `test_loi_tran_hai_song`, `test_cung_ma_hai_buoc_khong_loi`, `test_mot_giay_mot_song_khong_loi`. Test API: `test_luu_phieu_hai_giay_422` (POST phiếu, 1 sản phẩm, 2 mã loại giấy ở 2 bước ⇒ 422, detail chứa "chỉ một giấy"), `test_luu_phieu_giay_va_song_duoc` (⇒ 200/201, `giay_id` = mã Giấy), `test_nap_tai_ban_hai_giay_khong_chan` (gọi `lay_chi_tiet` trên cấu hình 2 giấy ⇒ không ném).
- [ ] Step 2: chạy — FAIL.
- [ ] Step 3: cài các hàm trên; router: dựng `bang = bang_giay(db, …mọi vat_tu_id giấy trong payload…)`, với mỗi `ThanhPhanIn` gọi `loi_tran_giay` ⇒ `HTTPException(422, detail=câu)` trước `_ghi_thanh_phans`; truyền `bang` xuống `chuan_hoa_giay`. Tái bản: dựng `bang` rồi truyền vào `chuan_hoa_giay`, không kiểm trần.
- [ ] Step 4: chạy `tests/test_loai_giay_song.py tests/test_giay_vat_tu_buoc.py tests/test_phieu_tinh_gia*.py -q` — PASS.
- [ ] Step 5: commit `feat(tinh-gia): mỗi sản phẩm tối đa một giấy và một sóng, giấy chính theo loại`.

### Task 3: Lệnh sản xuất — luật trần khi lưu + `giay_loai` ở dòng vật tư bước

**Files:**
- Modify: `backend/app/services/lsx_service.py` (vòng gán vật tư bước ~3343-3410; dựng dict bước ~2653), `backend/app/schemas/lsx.py:142` (`LsxBuocVatTuOut`), `frontend/src/api/client.ts` (type tương ứng `BuocVatTuOut`/LSX bước vật tư)
- Test: `backend/tests/test_loai_giay_song.py`

**Interfaces:**
- Consumes: `bang_giay`, `loi_tran_giay`, `id_giay_cua_rows` (Task 2).
- Produces: `LsxBuocVatTuOut.giay_loai: str = ""` (`"giay"|"song"` cho dòng giấy, `""` cho vật tư); TS `giay_loai?: "giay" | "song" | ""`.

- [ ] Step 1: test `test_luu_lenh_hai_giay_bi_chan` (lệnh nháp, PUT routing với 2 mã loại Giấy ở 2 bước ⇒ `LsxValidationError`/422 chứa "chỉ một giấy"), `test_luu_lenh_khong_gui_vat_tus_van_dem_dong_cu` (bước A đã có COUCHE; PUT chỉ gửi bước B có IVORY, bước A không có khoá `vat_tus` ⇒ bị chặn), `test_dong_vat_tu_buoc_co_giay_loai` (GET lệnh ⇒ dòng sóng có `giay_loai == "song"`).
- [ ] Step 2: FAIL.
- [ ] Step 3: sau vòng gán vật tư (khi mọi `row.vat_tus` đã là trạng thái mới), gom id giấy toàn lệnh, `loi_tran_giay(lsx.ma hoặc tên sản phẩm, ids, bang)` ⇒ `raise LsxValidationError(câu)`. Dict bước: thêm `"giay_loai"` tra từ một `bang_giay` dựng một lần cho cả lệnh.
- [ ] Step 4: `pytest tests/test_loai_giay_song.py tests/test_lsx*.py -q` — PASS.
- [ ] Step 5: commit `feat(lenh-sx): lệnh chặn quá một giấy hoặc một sóng, dòng giấy mang loại`.

### Task 4: Hiển thị phía máy chủ — ảnh chụp quy cách, phiếu công nghệ, xếp lịch, báo giá

**Files:**
- Modify: `backend/app/repositories/lsx_repo.py:63` (thay `ten_giay_cac_buoc`), `backend/app/services/san_xuat/snapshot.py:66-79,166-173`, `backend/app/services/lenh_sx/phieu_cong_nghe.py:400-409`, `backend/app/repositories/xep_lich_lenh_repo.py:273`, `backend/app/services/xep_lich/service.py:837`, `backend/app/services/quotation_service.py:103-162`
- Test: test sẵn có của snapshot/phiếu công nghệ/quotation (tìm bằng `grep -l "ten_giay_cac_buoc\|giays\|SÓNG" tests`), thêm ca vào `test_loai_giay_song.py`

**Interfaces:**
- Produces: `LsxRepository.giay_song_cac_buoc(lsx_id) -> tuple[list[str], list[str]]` (tên Giấy, tên Sóng; thứ tự bước rồi thứ tự dòng; không lặp; join `giay_nguyen` theo `vat_tu_id`, vắng ⇒ Giấy). Xoá `ten_giay_cac_buoc`. Thẻ quy cách: `giay: str | list[str]` (list chỉ khi >1 mã Giấy), `dinh_luong` bỏ chỉ khi >1 mã Giấy, khoá mới `song: str | list[str]` (vắng khi không có).

- [ ] Step 1: test `test_the_quy_cach_giay_va_song` (qc có `giays=["COUCHE 150GSM"]`, `songs=["SÓNG E"]`, gsm 150 ⇒ `giay == "COUCHE 150GSM"`, `dinh_luong == 150`, `song == "SÓNG E"`), `test_the_quy_cach_khong_song_khong_khoa`, `test_giay_song_cac_buoc_tach_loai`, `test_dien_giai_bao_gia_giay_truoc_song` (sóng ở bước trước In ⇒ dòng giấy đứng trước dòng sóng). Sửa test cũ mong `giay` là mảng cho hộp 2 giấy.
- [ ] Step 2: FAIL.
- [ ] Step 3: `_SoPhatHanh._quy_cach_lsx` gắn `giays`, `songs`; `the_quy_cach` như Interfaces; phiếu công nghệ: ô Giấy = tên giấy (nhiều ⇒ xuống dòng), Định lượng chỉ bỏ khi >1 giấy, thêm ô `("Sóng", …)` ngay sau Định lượng khi có; xếp lịch `giays` = giấy rồi sóng; báo giá: sắp id loại Giấy trước loại Sóng.
- [ ] Step 4: pytest các file trên — PASS.
- [ ] Step 5: commit `feat(lenh-sx): quy cách tách ô Giấy và Sóng`.

### Task 5: Danh mục Giấy (frontend)

**Files:**
- Modify: `frontend/src/pages/rebuildCatalogConfigs.tsx` (CFG_GIAY 607-650), `frontend/src/api/client.ts` (type dòng Giấy nếu có)

- [ ] Step 1: CFG_GIAY: field đầu tiên `{ key: "loai", label: "Loại", type: "select", required: true, group: "Thông số", options: [{value:"giay",label:"Giấy"},{value:"song",label:"Sóng"}] }` (form mới mặc định `"giay"` — dùng cơ chế mặc định sẵn có của drawer, ví dụ `macDinhTheo`); cột `{ key: "loai", label: "Loại", w: 90, render: r => r.loai === "song" ? "Sóng" : "Giấy" }` đứng đầu; `dieuKien` thêm `{ key: "loai", nhan: "Loại" }`.
- [ ] Step 2: `npx tsc --noEmit` — sạch.
- [ ] Step 3: commit `feat(giay): ô Loại ở danh mục Giấy`.

### Task 6: Tính giá + hiển thị (frontend)

**Files:**
- Modify: `frontend/src/pages/BuocVatTu.tsx`, `frontend/src/pages/PhieuTinhGiaDetailView.tsx` (~3625), `frontend/src/pages/ThsxQuyCach.tsx`, `frontend/src/api/client.ts` (`SxQuyCachThe.song?: string | string[]`), `frontend/src/pages/lsxVatTu.ts`, `frontend/src/pages/LsxDetailView.tsx` (~736, ~1428-1441)
- Test: `frontend/src/pages/ThsxQuyCach.test.ts`, `frontend/src/pages/lsxVatTu.test.ts`, `frontend/src/pages/ThsxDanhSach.test.tsx`

**Interfaces:**
- Produces: `BuocVatTu` prop `giayDangDung?: { giay: number[]; song: number[] }` (id mã đang có ở MỌI bước của sản phẩm). `giayVaVatTuQuyCach(...) -> { giays: string[]; songs: string[]; vatTuKhac: T[] }`; `DongKe.loai_giay?: "giay" | "song"`.

- [ ] Step 1: test vitest: `dongQuyCach` với `{giay:"COUCHE", dinh_luong:150, song:"SÓNG E"}` ⇒ thứ tự dòng Giấy, Định lượng, Sóng; không `song` ⇒ không dòng Sóng; `giay` mảng cũ vẫn ra một dòng nhiều tên. `giayVaVatTuQuyCach` với dòng `giay_loai:"song"` ⇒ vào `songs`, không vào `giays`, không vào `vatTuKhac`.
- [ ] Step 2: FAIL.
- [ ] Step 3: `QUY_CACH_DONG` thêm `["song","Sóng",""]` sau Định lượng, xử lý như `giay`. `bangKeVatTu` mang `v.giay_loai`; LsxDetailView: ô Giấy (giays), Định lượng khi `giays.length <= 1`, ô Sóng khi `songs.length > 0`. BuocVatTu: nhóm "Giấy" và "Sóng" theo `g.loai`; mã Giấy khác mã đang dùng (khi `giayDangDung.giay` khác rỗng) ⇒ `disabled: true, sub: "Sản phẩm đã có giấy <tên>"`; Sóng tương tự. Cha tính `giayDangDung` từ mọi bước của sản phẩm đang mở.
- [ ] Step 4: `npx vitest run src/pages/ThsxQuyCach.test.ts src/pages/lsxVatTu.test.ts src/pages/ThsxDanhSach.test.tsx` + `npx tsc --noEmit` — PASS.
- [ ] Step 5: commit `feat(tinh-gia): chọn tối đa một giấy một sóng, màn lệnh tách ô Sóng`.

### Task 7: Bấm thử trọn luồng trên dev-browser

DB thử: clone `svn_erp_trong` sang DB riêng + Redis riêng (memory `ui-test-worktree-db-sao-redis-rieng`), backend worktree :8010, frontend :5174.

- [ ] Danh mục Giấy: sửa SONG-E ⇒ Sóng, thấy cột Loại + lọc Loại.
- [ ] Tính giá PTG hộp bồi: giấy COUCHE + sóng SONG-E; mở ô thêm vật tư ở bước khác thấy mã giấy khác bị mờ kèm dòng phụ; lưu được.
- [ ] Đi tiếp báo giá → đơn → lệnh → phát hành (hoặc thu hồi + phát hành lại LSX26-0023): quy cách lệnh, thẻ bàn tổ, KCS tab Quy cách, phiếu công nghệ in ra Giấy + Định lượng + Sóng tách ô.
- [ ] Báo cáo liệt kê từng bước đã bấm/gõ/thấy.
