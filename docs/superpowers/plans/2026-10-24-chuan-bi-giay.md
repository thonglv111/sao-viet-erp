# Khâu chuẩn bị giấy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Giấy/sóng chọn một lần ở sản phẩm khi tính giá; lập lệnh thì máy chọn nguồn giấy theo tồn, tự chèn khâu chuẩn bị giấy (Cắt giấy cuộn / Tề giấy in / Tề sóng) và gắn giấy/sóng vào bước đầu, số tờ là gốc, kg quy theo định lượng danh mục.

**Architecture:** Bảy công đoạn hệ thống khoá theo khuôn `KHO-TP`. Logic chọn nguồn + dựng bước nằm trong service mới `services/chuan_bi_giay.py` (hàm thuần trên dữ liệu đã nạp), `LsxService.tao` và `BaiGhepService` gọi nó. Kế hoạch vật tư, giữ chỗ, tự lập yêu cầu xuất KHÔNG đổi logic — chúng đã cân đối theo "bước đầu mang giấy".

**Tech Stack:** FastAPI + SQLAlchemy (không Alembic — migration viết tay trong `backend/app/db_migrations.py`), PostgreSQL (dev/prod), SQLite in-memory (test), React + TypeScript + Vite, pytest, vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-chuan-bi-giay-design.md`

## Global Constraints

- Tầng: `routers → services → repositories → DB`; logic ở services, truy vấn DB chỉ ở repositories.
- Thêm/đổi cột ⇒ migration trong `backend/app/db_migrations.py` (số tiếp theo: `0443`…`0447`) + ghi vào `docs/DB_SCHEMA.md` (guard test).
- Cột Boolean: `server_default` là `sa_false()`/`sa_true()`, không phải `"0"`/`"1"`.
- Migration backfill dùng raw SQL đích danh cột, cấm ORM full-select; đọc inspector TRƯỚC lệnh ghi đầu tiên.
- Mã công đoạn hệ thống: `CGC`, `TGI`, `TS`, `BCT3LEB`, `BCT5LBEC`, `BTĐ`, `BBTĐ` (spec §3, tên/nhóm/đơn vị đúng bảng).
- `kg = to × rong_mm/1000 × dai_mm/1000 × gsm/1000`; kg→tờ làm tròn XUỐNG.
- `CUON_DU_TOI_DA_MM = 30`.
- `lsx.nguon_giay`, `bai_ghep.nguon_giay` ∈ `("to_in", "to_nguyen", "cuon", "mua")`.
- UI tiếng Việt; không nối mẩu dữ liệu bằng `·` hay dấu phẩy; Định lượng và Khổ là CỘT riêng; không chữ đậm cho mã/tên.
- Xác minh: pytest nhắm file + `npx tsc --noEmit` + vitest nhắm file. KHÔNG chạy `./init.ps1`, KHÔNG chạy pytest toàn bộ. `python -c` trong `backend/` đụng Postgres dev — đừng dùng.
- Commit chỉ khi chủ dự án cho phép; message không có dòng Co-Authored-By.
- Sửa route/schema backend ⇒ restart uvicorn tay (WMI `Win32_Process.Create`, `--host localhost`, không `--reload`).

## Review Focus

- Người kế hoạch xoá bước bồi khỏi routing của lệnh có `TS` ⇒ `replace_routing` phải chặn (422 "Tề sóng cần bước bồi") thay vì để `TS` treo. Test ở Task 8.
- Phiếu chưa khai khổ nguyên, hoặc khổ in không xếp vừa khổ nguyên (`so_manh_xa` 0/None) ⇒ không chia 0, không chèn `TGI`/`CGC`, `kiem_thieu` báo "thiếu khổ nguyên". Test ở Task 7 và Task 8.
- Dòng nhập kho giấy tờ tính kg quá nhỏ (quy ra 0 tờ) ⇒ 422 "quy ra 0 tờ", không tạo lô 0. Test ở Task 2.
- Đổi nguồn khi lệnh đang giữ chỗ / đã lập kế hoạch ⇒ 409 giống sửa routing, không đụng bước. Test ở Task 9.
- Lệnh đã tạo trước bản này (`nguon_giay IS NULL`, giấy nằm ở bước In) ⇒ mọi màn vẫn đọc được, KHVT vẫn cân đối như cũ. Test ở Task 11.

---

### Task 1: Bảy công đoạn hệ thống khoá

**Files:**
- Modify: `backend/app/models/cong_doan.py` (thêm hằng)
- Modify: `backend/app/services/cong_doan_service.py` (`_validate`, thêm `_blockers`, `dat_active`)
- Modify: `backend/app/schemas/cong_doan.py` (trường `co_dinh`)
- Modify: `backend/app/db_migrations.py` (`0443_cong_doan_he_thong`)
- Modify: `frontend/src/pages/rebuildCatalogConfigs.tsx` (`CFG_CONG_DOAN`: `dongKhoa`, `dongKhoaMoDuoc`)
- Modify: `frontend/src/pages/danh-muc/CatalogDrawer.tsx`, `frontend/src/pages/danh-muc/types.ts` (khoá ô theo `co_dinh`)
- Test: `backend/tests/test_cong_doan_he_thong.py`, `frontend/src/pages/rebuildCatalogConfigs.test.tsx`

**Interfaces:**
- Produces:
  - `CD_CAT_CUON = "CGC"`, `CD_TE_GIAY_IN = "TGI"`, `CD_TE_SONG = "TS"`, `CD_BOI = ("BCT3LEB", "BCT5LBEC", "BTĐ", "BBTĐ")`
  - `CD_HE_THONG: dict[str, dict]` (ma → `{ten, nhom, don_vi_vao, don_vi_ra}`)
  - `la_cong_doan_he_thong(ma: str | None) -> bool` (`models/cong_doan.py`)
  - `id_cong_doan_he_thong(db, ma: str) -> int | None` (repo `cong_doan_repo.py`, cache theo session)
  - Schema `CongDoanOut.co_dinh: bool`

- [ ] **Step 1: Write the failing tests** — `test_cong_doan_he_thong.py`:
  - `test_migration_tao_du_bay_cong_doan_he_thong`: chạy `0443` trên DB test ⇒ đủ 7 mã, đúng bảng spec §3, `active=True`.
  - `test_migration_ep_lai_o_khoa_dong_da_co`: tạo trước `CGC` với `don_vi_vao=None` ⇒ sau migration `("to_nguyen","to_nguyen")`, các ô khác (tổ, năng suất) giữ nguyên.
  - `test_khong_doi_ten_ma_nhom_don_vi`: `update` đổi `ten`/`ma`/`nhom`/`don_vi_vao` của `TGI` ⇒ `CongDoanValidationError`.
  - `test_sua_duoc_to_nang_suat_khoan`: `update` đổi `nang_suat`, `cong_thuc_gia` của `BTĐ` ⇒ lưu được.
  - `test_khong_ngung_khong_xoa`: `dat_active(False)` ⇒ lỗi; `delete` ⇒ `E_IN_USE`.
  - `test_cong_doan_thuong_van_xoa_duoc`.
- [ ] **Step 2: Run** `pytest backend/tests/test_cong_doan_he_thong.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** hằng + `la_cong_doan_he_thong`; `CongDoanService._validate(data, obj)` chặn đổi bốn ô khoá khi `obj.ma` là hệ thống (câu lỗi: "Công đoạn hệ thống «{ten}»: không đổi {ô}."); `_blockers` trả "công đoạn của hệ thống"; `dat_active` chặn tắt. Migration `0443`: raw SQL, INSERT dòng thiếu (cột NOT NULL khác lấy default của model), UPDATE ép bốn ô khoá + `active=true` cho dòng đã có. Schema `co_dinh` bằng validator như `schemas/kho_hang.py:31-37`.
- [ ] **Step 4: Run** lệnh Step 2 + `pytest backend/tests/test_cong_doan.py backend/tests/test_kho_thanh_pham_khoa.py -q` — Expected: PASS.
- [ ] **Step 5: FE** — `CFG_CONG_DOAN`: `dongKhoa: r => !!r.co_dinh`, `dongKhoaMoDuoc: true`; drawer: khi `form.co_dinh` thì ô `ma`, `ten`, `nhom`, `don_vi_vao`, `don_vi_ra` `disabled` (thêm `CatalogConfig.oKhoaKhiCoDinh?: string[]`). Test vitest: "công đoạn hệ thống khoá ô mã/tên/nhóm/đơn vị, mở được để sửa tổ".
- [ ] **Step 6: Run** `cd frontend && npx tsc --noEmit && npx vitest run src/pages/rebuildCatalogConfigs.test.tsx` — Expected: PASS.
- [ ] **Step 7: Commit** (khi được phép) `feat(cong-doan): bảy công đoạn hệ thống khoá cho khâu chuẩn bị giấy và bồi`

### Task 2: Quy đổi tờ ↔ kg và nhập kho giấy tờ quy ra tờ

**Files:**
- Modify: `backend/app/services/kho_giay.py` (helper mới)
- Modify: `backend/app/services/stock_request_service.py:323-406` (`_validate_lines`, `quy_ve_goc`)
- Modify: `backend/app/db_migrations.py` (`0444_lo_giay_to_kg_ve_to`)
- Test: `backend/tests/test_quy_doi_to_kg.py`

**Interfaces:**
- Produces (`kho_giay.py`):
  - `kg_tu_to(so_to: float, rong_mm: float, dai_mm: float, gsm: float) -> float`
  - `to_tu_kg(kg: float, rong_mm: float, dai_mm: float, gsm: float) -> int` (floor; khổ/gsm ≤ 0 ⇒ `ValueError`)
  - `la_kho_to(rong_mm, dai_mm) -> bool` (đủ hai cạnh > 0)

- [ ] **Step 1: Write the failing tests**:
  - `test_kg_tu_to_duplex_350`: `kg_tu_to(1530, 650, 860, 350) == pytest.approx(299.35, abs=0.01)`.
  - `test_to_tu_kg_lam_tron_xuong`: `to_tu_kg(299.35, 650, 860, 350) == math.floor(299.35 / (0.65*0.86*0.35))`.
  - `test_nhap_giay_to_tinh_kg_luu_lo_to`: yêu cầu nhập giấy `kho 650×860`, dòng `500 kg` ⇒ lô `don_vi_goc == "to"`, `sl_ban_dau == floor(500/(0.65*0.86*gsm/1000))`.
  - `test_nhap_cuon_kg_giu_kg`: khổ `(860, 0)`, `300 kg` ⇒ lô `kg`, `300`.
  - `test_nhap_kg_qua_nho_ra_0_to_bi_chan`: `0.01 kg` khổ 650×860 ⇒ lỗi chứa "quy ra 0 tờ".
  - `test_migration_0444_quy_lo_kg_hai_canh_ve_to`: lô giấy `kg` khổ 650×860 `sl_con_lai=100` ⇒ `to`, `floor(100/…)`; lô cuộn `(860,0)` không đổi; `vat_tu_giu_cho` cùng khoá cũng quy.
- [ ] **Step 2: Run** `pytest backend/tests/test_quy_doi_to_kg.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** helper; trong `_validate_lines` khi `hang_loai == "giay"` và `la_kho_to` và đơn vị dòng là `kg` ⇒ đổi dòng thành `to` với `to_tu_kg` (gsm từ `GiayNguyen.gsm`), giữ `so_luong` gốc của dòng cho chứng từ, `sl_goc` là số tờ. Migration `0444`: raw SQL trên `stock_lots`, `vat_tu_giu_cho`, `stock_thresholds` cho `hang_loai='giay' AND don_vi_goc='kg' AND kho_rong>0 AND kho_dai>0`.
- [ ] **Step 4: Run** Step 2 + `pytest backend/tests/test_kho_giay.py backend/tests/test_kho_lo_giay.py backend/tests/test_dot_giao_tu_nhap_kho.py backend/tests/test_giay_luon_co_to_kg.py -q` — Expected: PASS (test cũ khẳng định "kg là nhóm riêng" cho giấy HAI cạnh phải sửa theo spec §5; cuộn giữ nguyên).
- [ ] **Step 5: Commit** (khi được phép) `feat(kho): giấy tờ nhập theo kg quy ra tờ, số tờ là gốc`

### Task 3: Kho hiện tồn giấy theo tờ + Quy kg + Định lượng

**Files:**
- Modify: `backend/app/schemas/stock.py` (`StockLotOut` :812, `TonNhomMuc` :1128, `TonKhoaRow` :1096)
- Modify: `backend/app/routers/kho_voucher.py:967` (`_dong_lo_danh_sach`), `backend/app/services/ton_kho_nhom_service.py`
- Modify: `frontend/src/pages/KhoTonKhoPage.tsx` (`COT_TON` :158-175, tab lô :1625-1634), `frontend/src/api/client.ts`
- Test: `backend/tests/test_kho_ton_quy_kg.py`, `frontend/src/pages/khoNganA.test.tsx`

**Interfaces:**
- Consumes: `kg_tu_to`, `la_kho_to` (Task 2).
- Produces: trường `dinh_luong: int | None` và `quy_kg: float | None` trên ba schema trên (giấy tờ: `quy_kg = kg_tu_to(ton, …)`; cuộn/vật tư: `None`; `dinh_luong` = `giay_nguyen.gsm` chỉ cho giấy).

- [ ] **Step 1: Failing tests** — `test_ton_nhom_giay_to_co_quy_kg_va_dinh_luong` (lô 1.530 tờ 650×860 gsm 350 ⇒ `quy_kg ≈ 299.35`, `dinh_luong == 350`); `test_cuon_khong_quy_kg` (`quy_kg is None`, `dinh_luong == gsm`); `test_vat_tu_khong_co_dinh_luong`.
- [ ] **Step 2: Run** `pytest backend/tests/test_kho_ton_quy_kg.py -v` — FAIL.
- [ ] **Step 3: Implement** — gsm nạp MỘT truy vấn cho cả trang (`GiayNguyen.id IN …`), không N+1.
- [ ] **Step 4: Run** Step 2 + `pytest backend/tests/test_kho_ton_nhom.py backend/tests/test_kho_ton_theo_kho.py -q` — PASS.
- [ ] **Step 5: FE** — thêm cột "Định lượng" (sau Khổ) và "Quy kg" (sau Đang có) vào `COT_TON` và bảng lô; ô trống khi `null`; số kg 2 chữ số thập phân, định dạng `vi-VN`. Vitest: "giấy tờ hiện Quy kg và Định lượng, cuộn để trống Quy kg".
- [ ] **Step 6: Run** `cd frontend && npx tsc --noEmit && npx vitest run src/pages/khoNganA.test.tsx` — PASS.
- [ ] **Step 7: Commit** (khi được phép) `feat(kho): tồn giấy hiện số tờ, quy kg và định lượng`

### Task 4: Mua hàng — cột Định lượng và Khổ riêng

**Files:**
- Modify: `backend/app/schemas/purchase.py` (`PurchaseRequestLineOut` :416, `DepartmentPurchaseRequestLineOut` :463, `PurchaseDeliveryLineOut` :622), service tương ứng nạp gsm một truy vấn
- Modify FE: `frontend/src/pages/mua-hang/yeu-cau-mua-hang/components/RequestFormDrawer.tsx` (:284-291), `RequestDetailDrawer.tsx` (:191-216), `yeu-cau-chung/BangMonYeuCau.tsx` (:21-31), `phieu-mua-hang/components/PurchaseFormDrawer.tsx` (:554-562), `don-mua-chung/NganDonMua.tsx` (:589, :806), `phieu-mua-hang/modals/DeliveryDialog.tsx` (:438-475)
- Test: `backend/tests/test_mua_dinh_luong_giay.py`, `frontend/src/pages/mua-hang/luoi-mua-hang.test.tsx`

**Interfaces:**
- Produces: `dinh_luong: int | None` trên ba schema Out (chỉ dòng `hang_loai == "giay"`). Input schema KHÔNG có trường này.

- [ ] **Step 1: Failing tests** — `test_dong_ycmh_giay_co_dinh_luong_tu_danh_muc`, `test_dong_don_mua_vat_tu_khong_dinh_luong`, `test_gui_dinh_luong_trong_payload_bi_bo_qua` (payload có `dinh_luong: 999` ⇒ Out vẫn trả gsm danh mục).
- [ ] **Step 2: Run** `pytest backend/tests/test_mua_dinh_luong_giay.py -v` — FAIL.
- [ ] **Step 3: Implement** backend.
- [ ] **Step 4: Run** Step 2 + `pytest backend/tests/test_purchases_api.py backend/tests/test_yeu_cau_mua_tung_mon.py -q` — PASS.
- [ ] **Step 5: FE** — mỗi bảng dòng: cột "Định lượng" chỉ đọc ngay sau "Khổ"; bảng nào đang để khổ thành thẻ trong ô tên (`RequestDetailDrawer`, `PurchaseFormDrawer`, `DeliveryDialog`) chuyển khổ ra cột riêng (ô nhập khổ nhận ở `DeliveryDialog` chuyển sang cột "Khổ nhận"). Vitest: "dòng giấy có cột Định lượng và Khổ riêng, tên hàng không chứa khổ".
- [ ] **Step 6: Run** `cd frontend && npx tsc --noEmit && npx vitest run src/pages/mua-hang` — PASS.
- [ ] **Step 7: Commit** (khi được phép) `feat(mua-hang): cột định lượng và khổ riêng cho dòng giấy`

### Task 5: Phiếu tính giá — giấy và sóng cấp sản phẩm (backend)

**Files:**
- Modify: `backend/app/models/phieu_tinh_gia.py` (`PhieuThanhPhan.song_id`)
- Modify: `backend/app/db_migrations.py` (`0445_ptg_song_id_giay_len_san_pham`), `docs/DB_SCHEMA.md`
- Modify: `backend/app/schemas/phieu_tinh_gia.py` (`ThanhPhanIn` :133 + Out, `BuocVatTuIn` :16 bỏ `"giay"` khỏi Literal)
- Modify: `backend/app/services/ptg_giay_buoc.py` (viết lại), `backend/app/routers/phieu_tinh_gia.py:191-246`, `backend/app/routers/tinh_gia.py:88-91`
- Modify: `backend/app/services/tinh_gia_service.py` (`nap_danh_muc_phieu` :75, `_resolve_thanh_phan` :224-261), `backend/app/services/thanh_phan_engine.py` (:1250-1301 dòng giấy, thêm dòng sóng; gỡ nhánh giấy-theo-bước :876-966, :1327-1342)
- Modify: `backend/app/services/san_pham_tai_ban_service.py:31-145`, `backend/app/services/quotation_service.py:103-113`
- Test: `backend/tests/test_giay_song_cap_san_pham.py`; sửa `test_giay_vat_tu_buoc.py`, `test_loai_giay_song.py`, `test_bao_gia_theo_phieu.py`

**Interfaces:**
- Consumes: `CD_BOI`, `la_cong_doan_he_thong` (Task 1).
- Produces:
  - `ptg_giay_buoc.kiem_giay_song(db, tp: dict, nhom_va_ma_cua: Callable[[int|None], tuple[str|None, str|None]]) -> str | None` — câu lỗi hoặc None: `giay_id` phải loại `giay`, `song_id` phải loại `song`, có `song_id` thì chuỗi phải có bước mã thuộc `CD_BOI`, bước không mang `hang_loai='giay'`.
  - `ptg_giay_buoc.chuyen_giay_buoc_len_san_pham(data: dict, bang: BangGiay) -> dict` — payload/cấu hình cũ: dòng giấy của bước ⇒ `giay_id`/`song_id` theo loại, xoá khỏi bước.
  - Engine: dòng `rows["nvl"]` mới `{"loai": "song", "so_to": …, …}`; biến `so_to_song` trong `ctx_vars`.

- [ ] **Step 1: Failing tests** — `test_giay_song_cap_san_pham.py`:
  - `test_luu_phieu_giay_va_song_cap_san_pham` (giay_id loại giấy, song_id loại sóng, chuỗi In → Bồi `BTĐ` ⇒ 201, không dòng giấy ở bước).
  - `test_song_khong_co_buoc_boi_422` (câu "Sản phẩm có sóng nhưng chuỗi chưa có bước bồi.").
  - `test_giay_id_la_ma_song_422`, `test_song_id_la_ma_giay_422`.
  - `test_vat_tu_buoc_hang_loai_giay_422`.
  - `test_tien_song_theo_so_to_vao_buoc_boi` (sóng giá tờ 2.000đ, SL vào bước bồi 1.020 ⇒ dòng sóng 2.040.000đ).
  - `test_tien_song_gia_kg_theo_kho_in` (giá kg: `gsm/1000 × dai_in × rong_in × don_gia × so_to`).
  - `test_tien_giay_cap_san_pham_khi_co_chuoi` (chuỗi có In mà giấy cấp sản phẩm vẫn ra tiền giấy theo tờ nguyên).
  - `test_migration_0445_dua_giay_buoc_len_san_pham` (dòng giấy bước In + dòng sóng bước Bồi ⇒ `giay_id`, `song_id`, hết dòng `hang_loai='giay'`).
  - `test_cau_hinh_tai_ban_cu_doi_luc_nap`.
- [ ] **Step 2: Run** `pytest backend/tests/test_giay_song_cap_san_pham.py -v` — FAIL.
- [ ] **Step 3: Implement** theo Interfaces; engine luôn chạy dòng giấy cấp sản phẩm khi có `giay_id` (bỏ điều kiện `co_giay_buoc`); số tờ sóng = `so_luong_vao` của bước đầu tiên trong `chain` có `ma ∈ CD_BOI` (chain cần mang `ma` — thêm vào dict bước ở `_resolve_thanh_phan`). Báo giá: `_giay_cac_buoc` đọc `giay_id` + `song_id`.
- [ ] **Step 4: Run** Step 2 + `pytest backend/tests/test_giay_vat_tu_buoc.py backend/tests/test_loai_giay_song.py backend/tests/test_bao_gia_theo_phieu.py backend/tests/test_phieu_tinh_gia.py -q` — PASS (test cũ khẳng định giấy ở bước: sửa theo spec §4, ghi rõ trong commit).
- [ ] **Step 5: Commit** (khi được phép) `feat(tinh-gia): giấy và sóng chọn ở sản phẩm, bước không mang giấy`

### Task 6: Phiếu tính giá — giao diện chọn Giấy + Sóng

**Files:**
- Modify: `frontend/src/pages/PhieuTinhGiaDetailView.tsx` (mục "2 Giấy nguyên" :3243-3274; `coGiay` :819, `giayGuiLen` :827, `toThanhPhanIn` :834, `fromThanhPhanIn` :903)
- Modify: `frontend/src/pages/BuocVatTu.tsx` (:188-318 bỏ nhóm Giấy/Sóng, bỏ `giayCuaSanPham`)
- Modify: `frontend/src/api/client.ts` (`ThanhPhanIn` :4892 thêm `song_id`; `BuocVatTuIn` :4748 bỏ `"giay"`)
- Test: `frontend/src/pages/BuocVatTu.test.tsx`, `frontend/src/pages/PhieuTinhGiaDetailView.test.tsx` (tạo nếu chưa có)

**Interfaces:**
- Consumes: payload Task 5 (`giay_id`, `song_id`).

- [ ] **Step 1: Failing tests** — "mục Giấy nguyên có ô Giấy (chỉ giấy loại Giấy) và ô Sóng (chỉ loại Sóng, bỏ trống được)", "ô Thêm vật tư của bước không còn nhóm Giấy/Sóng", "gửi lên giay_id và song_id, vat_tus không có hang_loai giay".
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/pages/BuocVatTu.test.tsx src/pages/PhieuTinhGiaDetailView.test.tsx` — FAIL.
- [ ] **Step 3: Implement** — hai `Select` tìm theo TÊN giấy (mã ẩn), cùng hàng với Dài nguyên/Rộng nguyên; giá giấy hiện như hình cũ ("29.700 đ / tờ") dưới ô Giấy.
- [ ] **Step 4: Run** Step 2 + `npx tsc --noEmit` — PASS.
- [ ] **Step 5: Commit** (khi được phép) `feat(tinh-gia): mục Giấy nguyên chọn giấy và sóng`

### Task 7: Service chọn nguồn và dựng khâu chuẩn bị giấy

**Files:**
- Create: `backend/app/services/chuan_bi_giay.py`
- Test: `backend/tests/test_chuan_bi_giay.py`

**Interfaces:**
- Consumes: `kg_tu_to`, `la_kho_to` (Task 2), `CD_*` (Task 1), `kho_giay.khoa_ton`, `GiuChoService.ton_tu_do`.
- Produces:
  ```python
  NGUON_GIAY = ("to_in", "to_nguyen", "cuon", "mua")
  CUON_DU_TOI_DA_MM = 30

  class DauVaoGiay(NamedTuple):
      giay_id: int; gsm: float
      kho_in: tuple[int, int]; kho_nguyen: tuple[int, int] | None
      so_to_in: int; so_manh_xa: int | None

  class NguonChon(NamedTuple):
      nguon: str
      rong_cuon: int | None          # chỉ khi nguon == "cuon"
      ly_do: str | None              # vd "thiếu khổ nguyên"

  class BuocChuanBi(NamedTuple):
      ma: str                         # CGC | TGI | TS
      dong_giay: dict | None          # {hang_loai, vat_tu_id, so_luong, don_vi_goc, kho_rong, kho_dai}

  def chon_nguon(dv: DauVaoGiay, ton_tu_do: Callable[[tuple], float]) -> NguonChon
  def can_tgi(dv: DauVaoGiay) -> bool                       # kho_nguyen có, so_manh_xa > 1
  def ma_buoc_giay(nguon: str, dv: DauVaoGiay) -> list[str] # thứ tự trước In
  def dong_giay_buoc_dau(nguon: NguonChon, dv: DauVaoGiay, so_to_vao_buoc_dau: int) -> dict
  def dong_song(song_id: int, kho_in: tuple[int,int], so_to_vao_ts: int) -> dict
  ```

- [ ] **Step 1: Failing tests** (ví dụ chuẩn: gsm 350, khổ in 650×430, khổ nguyên 650×860, `so_manh_xa=2`, 3.000 tờ in):
  - `test_co_to_kho_in_du_lay_thang` ⇒ `to_in`, `ma_buoc_giay == []`.
  - `test_co_to_nguyen_du_them_te` ⇒ `to_nguyen`, `["TGI"]`.
  - `test_co_cuon_rong_bang_canh_them_cat_cuon_va_te` (cuộn `(860,0)` 400 kg) ⇒ `cuon`, `rong_cuon=860`, `["CGC","TGI"]`.
  - `test_cuon_rong_hon_trong_30mm_duoc_chon_cuon_hep_nhat` (cuộn 880 và 870 ⇒ 870).
  - `test_cuon_rong_hon_qua_30mm_bo_qua` (cuộn 900 ⇒ không chọn).
  - `test_khong_du_nguon_nao_la_mua` ⇒ `mua`, `["TGI"]`.
  - `test_kho_nguyen_bang_kho_in_khong_them_te` (`so_manh_xa=1`: `cuon` ⇒ `["CGC"]`).
  - `test_thieu_kho_nguyen_khong_chia_0` (`kho_nguyen=None`) ⇒ `to_in` nếu đủ, ngược lại `mua` + `ly_do == "thiếu khổ nguyên"`, `ma_buoc_giay == []`.
  - `test_dong_giay_cat_cuon_tinh_kg_theo_rong_cuon` (1.530 tờ, cuộn 870 ⇒ `kg_tu_to(1530, 870, 650, 350)`, khổ `(870, 0)`, `don_vi_goc="kg"`).
  - `test_dong_giay_te_tinh_to_nguyen` (1.530 tờ, khổ 650×860, `to`).
  - `test_dong_song_tinh_to_kho_in`.
- [ ] **Step 2: Run** `pytest backend/tests/test_chuan_bi_giay.py -v` — FAIL.
- [ ] **Step 3: Implement** — hàm thuần; `chon_nguon` thử theo thứ tự spec §7; số tờ nguyên cần = `ceil(so_to_in / so_manh_xa)` (hao của TGI cộng ở Task 8 qua tính ngược, ở đây chỉ dùng để so tồn).
- [ ] **Step 4: Run** Step 2 — PASS.
- [ ] **Step 5: Commit** (khi được phép) `feat(lenh): service chọn nguồn giấy và dựng khâu chuẩn bị`

### Task 8: Lập lệnh chèn khâu chuẩn bị giấy

**Files:**
- Modify: `backend/app/models/lsx.py` (`Lsx.nguon_giay` String(12) nullable)
- Modify: `backend/app/db_migrations.py` (`0446_lsx_nguon_giay`), `docs/DB_SCHEMA.md`
- Modify: `backend/app/services/lsx_service.py`:
  - `tao` :1681-1790 (chèn bước, cạnh phụ thuộc thay vòng tuyến tính :1767-1769)
  - `tinh_nguoc_routing` :2037-2120 (`TS` tính riêng)
  - `_dong_bo_dong_giay` :2420, `_dong_giay_cho_ma` :2371-2418 (thay bằng `chuan_bi_giay`), `_sl_ra_buoc_giay` :2333 (gỡ nếu hết người gọi)
  - `_bung_vat_tu_cong_doan` :1628 (không chép dòng giấy từ bước phiếu nữa)
  - `kiem_thieu` :1834 (thiếu giấy / thiếu khổ nguyên)
  - `replace_routing` :3236 (`_kiem_tuyen_luu`: `TS` phải có cạnh tới một bước `CD_BOI`)
- Modify: `backend/app/services/kho_giay.py:200-268` (gỡ nhánh con/cái/tay/"—" của `dong_giay_theo_dau_vao`; giữ tờ/tờ nguyên nếu còn người gọi)
- Test: `backend/tests/test_lenh_chuan_bi_giay.py`; sửa `test_giay_vat_tu_buoc_lsx.py`, `test_dong_giay_dau_vao.py`, `test_lsx_service.py`

**Interfaces:**
- Consumes: Task 1 (`id_cong_doan_he_thong`), Task 5 (`giay_id`, `song_id` trong `quy_cach`), Task 7 (toàn bộ).
- Produces:
  - `LsxService._dung_khau_chuan_bi(lsx: Lsx, nguon: NguonChon) -> None` — chèn bước `CGC`/`TGI` (thứ tự ngay trước In), `TS` (đầu thứ tự, cạnh `TS → bước bồi đầu`), dựng cạnh nhánh giấy tuyến tính, gắn dòng giấy/sóng, ghi `lsx.nguon_giay`.
  - `LsxService._go_khau_chuan_bi_giay(lsx: Lsx) -> None` — gỡ bước có `cong_doan_id` của `CGC`/`TGI` và cạnh của chúng, nối lại bước trước ↔ In.

- [ ] **Step 1: Failing tests** — `test_lenh_chuan_bi_giay.py` (dựng phiếu → đơn → `tao`):
  - `test_kho_co_cuon_lenh_co_cat_cuon_te_in` (thứ tự `CGC, TGI, In, …`; `nguon_giay == "cuon"`; dòng giấy CHỈ ở `CGC`, `don_vi_goc="kg"`, khổ `(rộng cuộn, 0)`).
  - `test_kho_co_to_kho_in_khong_them_buoc_giay_o_in`.
  - `test_kho_trong_nguon_mua_co_te_giay_in`.
  - `test_co_song_them_te_song_noi_vao_boi` (bước `TS` có đúng một cạnh ra tới bước `BTĐ`; không bước nào phụ thuộc `TS` ngoài bồi; dòng sóng ở `TS`).
  - `test_tinh_nguoc_te_song_ra_bang_vao_boi_cong_hao` (bồi vào 1.020, hao TS 2% ⇒ TS ra 1.020, vào 1.041).
  - `test_nhanh_giay_tinh_nguoc_qua_te_va_cat_cuon` (In vào 3.000, `so_manh_xa=2` ⇒ TGI ra 3.000 tờ in, vào ≈ 1.500 tờ nguyên + hao; CGC ra = TGI vào).
  - `test_xoa_buoc_boi_khi_co_te_song_bi_chan` (`replace_routing` bỏ `BTĐ` ⇒ `LsxValidationError` "Tề sóng cần bước bồi").
  - `test_thieu_kho_nguyen_kiem_thieu_bao` (`"thiếu khổ nguyên"` trong `kiem_thieu`).
  - `test_lenh_cu_nguon_null_giu_nguyen_khi_ap_chuoi_nguoc` (lệnh dựng tay giấy ở In, `nguon_giay=None` ⇒ `_ap_chuoi_nguoc` không chèn gì, dòng giấy In vẫn tính).
- [ ] **Step 2: Run** `pytest backend/tests/test_lenh_chuan_bi_giay.py -v` — FAIL.
- [ ] **Step 3: Implement** — nguồn chọn SAU `_ap_chuoi_nguoc` lần đầu (cần SL vào In), rồi chèn bước và chạy `_ap_chuoi_nguoc` lại; `tinh_nguoc_routing` loại `TS` khỏi danh sách dòng giấy và thêm dòng riêng cho nó.
- [ ] **Step 4: Run** Step 2 + `pytest backend/tests/test_lsx_service.py backend/tests/test_giay_vat_tu_buoc_lsx.py backend/tests/test_dong_giay_dau_vao.py backend/tests/test_dong_giay.py backend/tests/test_tuyen_lenh_chan_luu.py -q` — PASS.
- [ ] **Step 5: Commit** (khi được phép) `feat(lenh): lập lệnh tự chèn khâu chuẩn bị giấy và gắn giấy vào bước đầu`

### Task 9: Đổi nguồn giấy của lệnh

**Files:**
- Modify: `backend/app/routers/lsx.py` (route mới), `backend/app/schemas/lsx.py` (`DoiNguonGiayIn`), `backend/app/services/lsx_service.py`
- Modify: `frontend/src/pages/LsxDetailView.tsx` (ô "Nguồn giấy" cạnh bảng routing), `frontend/src/api/client.ts`
- Test: `backend/tests/test_lenh_doi_nguon_giay.py`, `frontend/src/pages/LsxDetailView.test.tsx` (tạo nếu chưa có)

**Interfaces:**
- Consumes: `_go_khau_chuan_bi_giay`, `_dung_khau_chuan_bi` (Task 8).
- Produces: `PUT /api/lsx/{id}/nguon-giay` body `{nguon: "to_in"|"to_nguyen"|"cuon"|"mua", rong_cuon?: int}` ⇒ `LsxOut`; `LsxService.doi_nguon_giay(lsx_id, nguon, rong_cuon, actor) -> Lsx`; audit `doi_nguon_giay`; gọi `xoa_cache_can_doi()`.

- [ ] **Step 1: Failing tests** — `test_doi_cuon_sang_to_nguyen_go_cat_cuon` (còn `TGI`, dòng giấy chuyển sang `TGI`, tờ); `test_doi_khi_dang_giu_cho_409`; `test_doi_khi_da_lap_ke_hoach_409`; `test_doi_cuon_thieu_rong_cuon_422`; `test_doi_khong_dung_buoc_khac` (step_key các bước sau in giữ nguyên).
- [ ] **Step 2: Run** `pytest backend/tests/test_lenh_doi_nguon_giay.py -v` — FAIL.
- [ ] **Step 3: Implement** — guard dùng `_ly_do_khong_cap_nhat` (:3085).
- [ ] **Step 4: Run** Step 2 — PASS.
- [ ] **Step 5: FE** — `Select` "Nguồn giấy" với bốn lựa chọn chữ thường ("Tờ đúng khổ in", "Tờ khổ nguyên", "Cuộn", "Mua mới"); chọn Cuộn thì hiện ô "Rộng cuộn" (mm); khoá khi lệnh đang giữ chỗ (lý do trong tooltip). Vitest: "đổi nguồn gọi PUT nguon-giay rồi nạp lại routing".
- [ ] **Step 6: Run** `cd frontend && npx tsc --noEmit && npx vitest run src/pages/LsxDetailView.test.tsx` — PASS.
- [ ] **Step 7: Commit** (khi được phép) `feat(lenh): người kế hoạch đổi nguồn giấy của lệnh`

### Task 10: Bài ghép — khâu chuẩn bị giấy chung

**Files:**
- Modify: `backend/app/models/bai_ghep.py` (`BaiGhep.nguon_giay`), `backend/app/db_migrations.py` (`0447_bai_ghep_nguon_giay`), `docs/DB_SCHEMA.md`
- Modify: `backend/app/services/bai_ghep_service.py` (`tao` :352, `them_thanh_vien` :409, chỗ rút thành viên/phá bài, dựng bước chung)
- Modify: `backend/app/services/san_xuat/buoc_giay_bai.py` (nếu bước chung đầu đổi)
- Test: `backend/tests/test_bai_ghep_chuan_bi_giay.py`

**Interfaces:**
- Consumes: Task 7, Task 8 (`_go_khau_chuan_bi_giay`, `_dung_khau_chuan_bi` cho lệnh rời bài).
- Produces: `BaiGhepService._dung_khau_chuan_bi_bai(bg: BaiGhep) -> None` (bước chung `CGC`/`TGI` trước bước In chung, giấy gắn bước chung đầu, số theo `tinh_so_to` của bài).

- [ ] **Step 1: Failing tests** — `test_lenh_vao_bai_go_cat_cuon_te_rieng_giu_te_song`; `test_bai_co_buoc_chung_te_truoc_in_chung`; `test_buoc_lay_giay_bai_la_buoc_chung_dau`; `test_lenh_roi_bai_dung_lai_khau_rieng`; `test_khvt_bai_mot_dong_giay_o_buoc_chung_dau`.
- [ ] **Step 2: Run** `pytest backend/tests/test_bai_ghep_chuan_bi_giay.py -v` — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** Step 2 + `pytest backend/tests/test_buoc_giay_bai.py backend/tests/test_ke_hoach_vat_tu_buoc_dau.py -q` — PASS.
- [ ] **Step 5: Commit** (khi được phép) `feat(bai-ghep): khâu chuẩn bị giấy là bước chung của bài`

### Task 11: Kế hoạch vật tư, giữ chỗ, tự lập xuất kho — ghim hành vi

**Files:**
- Test: `backend/tests/test_khvt_chuan_bi_giay.py`; chạy lại bộ hiện có
- Modify (chỉ khi test đỏ): `backend/app/services/ke_hoach_vat_tu_service.py` (`_buoc_dau_giay` :1300-1313), `backend/app/services/san_xuat/vat_tu_tu_lap.py`

**Interfaces:**
- Consumes: Task 8.

- [ ] **Step 1: Write tests**:
  - `test_khvt_nhu_cau_cuon_kg_o_cat_cuon` (lệnh nguồn cuộn ⇒ một dòng nhu cầu khoá `("giay", id, 870, 0, "kg")`, không dòng ở In).
  - `test_khvt_nhu_cau_to_nguyen_o_te` (khoá `("giay", id, 650, 860, "to")`).
  - `test_khvt_song_o_te_song`.
  - `test_tu_lap_khi_phat_hanh_xin_giay_cho_buoc_dau` (yêu cầu xuất giấy gắn `CGC`, In chỉ có mực).
  - `test_cong_bat_dau_in_chi_cho_muc` (`trang_thai_vat_tu` của In không có dòng giấy).
  - `test_lenh_cu_giay_o_in_khvt_khong_doi` (Review Focus).
- [ ] **Step 2: Run** `pytest backend/tests/test_khvt_chuan_bi_giay.py -v`; đỏ thì sửa đúng chỗ, xanh thì giữ.
- [ ] **Step 3: Run** `pytest backend/tests/test_ke_hoach_vat_tu.py backend/tests/test_ke_hoach_vat_tu_buoc_dau.py backend/tests/test_giu_cho_vat_tu.py backend/tests/test_vat_tu_tu_lap.py backend/tests/test_trang_thai_vat_tu.py backend/tests/test_sx_vat_tu_de_nghi.py -q` — PASS.
- [ ] **Step 4: Commit** (khi được phép) `test(khvt): ghim nhu cầu giấy theo khâu chuẩn bị`

### Task 12: Bấm thử trọn luồng trên dev-browser

Bắt buộc theo `CLAUDE.md`: thao tác chuột/bàn phím thật, KHÔNG dùng API/curl thay bước nào; báo cáo liệt kê đã bấm gì/gõ gì/thấy gì từng bước.

- [ ] **Step 1:** Restart uvicorn (migration `0443`–`0447` chạy), `npm run dev`; đăng nhập `admin/admin123`.
- [ ] **Step 2:** Danh mục công đoạn: thấy 7 dòng có khoá; mở `TGI` ⇒ ô tên/mã/nhóm/đơn vị bị khoá, sửa năng suất lưu được; nút xoá/ngừng không có.
- [ ] **Step 3:** Danh mục giấy: tạo một giấy loại Giấy gsm 350 và một sóng. Kho: nhập 400 kg cuộn rộng 870 của giấy đó (qua phiếu nhập trên UI).
- [ ] **Step 4:** Phiếu tính giá mới: chọn Giấy + Sóng ở mục Giấy nguyên, khổ nguyên 650×860, chuỗi In → Cán màng → Bồi (`BTĐ`) → Bế; thấy dòng tiền giấy và dòng tiền sóng; ô thêm vật tư của bước không có nhóm Giấy.
- [ ] **Step 5:** Báo giá → đơn hàng → tạo lệnh: routing hiện `TS`, `CGC`, `TGI`, In…; "Nguồn giấy: Cuộn"; ngăn vật tư `CGC` thấy kg cuộn 870.
- [ ] **Step 6:** Đổi nguồn sang "Tờ khổ nguyên" ⇒ `CGC` biến mất, giấy chuyển sang `TGI` bằng tờ.
- [ ] **Step 7:** Kế hoạch vật tư: lệnh hiện nhu cầu đúng khoá; bật giữ chỗ; kho tồn hiện số tờ/Quy kg/Định lượng.
- [ ] **Step 8:** Mua hàng: lập yêu cầu mua từ Kế hoạch vật tư ⇒ dòng có cột Định lượng và Khổ riêng.
- [ ] **Step 9:** Ghi báo cáo vào ghi chú bàn giao (thư mục side-session-notes), kèm ảnh chụp các màn chính.
