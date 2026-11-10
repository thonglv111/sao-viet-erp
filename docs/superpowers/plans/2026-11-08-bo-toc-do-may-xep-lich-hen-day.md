# Bỏ tốc độ máy, Dự kiến xong, Hạn hoàn thành SX; làm lại Xếp lịch thành bàn hẹn đẩy lệnh

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lệnh sản xuất thôi tính giờ chạy theo tốc độ máy, bỏ "Dự kiến xong" và "Hạn hoàn thành sản xuất", và bàn Xếp lịch thành nơi hẹn giờ đẩy lệnh (tới giờ tự đẩy), xem vật tư và hạn giao.

**Architecture:** Cột DB cũ giữ nguyên, chỉ thôi đọc/ghi. Bàn mới dựa trên `xep_lich_lenh.bat_dau_at` (= giờ hẹn đẩy), thêm ba cột cho người hẹn và lần kẹt. Một service mới `services/xep_lich/hen_day.py` lo danh sách theo tab (phân trang máy chủ), hẹn, bỏ hẹn, đẩy ngay, và hàm quét tự đẩy chạy trong vòng lặp nền ở `main.py`. Đẩy thật vẫn gọi `XepLichLenhService.phat_hanh` có sẵn.

**Tech Stack:** FastAPI, SQLAlchemy, Postgres (migration tay trong `db_migrations.py`), React + Vite + TS.

**Spec:** `docs/design-go-toc-do-may-va-xep-lich.md`. **Mockup đã chốt:** `docs/mockups/xep-lich-hen-day-B-day-du.html` (mở bằng trình duyệt; bố trí, chữ, màu và ngăn 3 tab lấy đúng từ đây).

## Global Constraints

- UI tiếng Việt dễ hiểu; không nối mẩu dữ liệu bằng "·" hay dấu phẩy; chip trạng thái dùng bộ `--tt-*`; không chữ đậm cho mã/tên; không viền một cạnh. Đọc `.agents/rules/ui.md` và `docs/UI_DESIGN.md` trước khi viết CSS.
- Kiến trúc `routers → services → repositories`; truy vấn DB chỉ trong repositories.
- Không Alembic: cột mới viết migration trong `backend/app/db_migrations.py`, số `0470_xep_lich_hen_day` (để cách các phiên song song đang dùng 046x); cập nhật `docs/DB_SCHEMA.md` (guard `test_schema_documented`).
- Hành động ghi nhật ký mới phải đăng ký trong `backend/app/audit_registry.py` (guard `test_audit_registry.py`).
- Thông báo nội bộ real-time qua SSE (`backend/app/realtime.py`, `services/thong_bao_man.bao`).
- Phân trang + lọc ở máy chủ, chân bảng `PhanTrangDayDu` 25 dòng.
- Tài liệu PDF: **KHÔNG sửa** trong đợt này (chủ dự án dặn chờ nghiệm thu). Báo cáo ghi "tài liệu chờ nghiệm thu".
- Xác minh: `python -m pytest tests/<file> -q` từ `backend/`, `npx tsc --noEmit` từ `frontend/`; không chạy cả bộ pytest, không `./init.ps1`.
- Thư mục dùng chung với phiên khác (Giao đơn, in-hp đang có thay đổi chưa commit ở `lsx_service.py`, `routers/lsx.py`, `client.ts`, `rebuildCatalogConfigs.tsx`...). **Không commit** trong đợt này (chủ dự án chưa yêu cầu); không `git stash`, không `git checkout --` file nào; chỉ sửa bằng Edit, không ghi đè cả file người khác đang sửa.

## Review Focus

- Hai tiến trình cùng quét tự đẩy: một lệnh chỉ được đẩy một lần (khoá `giu_vai_chinh` + kiểm lại trạng thái trong transaction).
- Hẹn giờ ở quá khứ hoặc cho lệnh còn Nháp/đã đẩy: phải bị chặn với câu báo dễ hiểu.
- Người hẹn bị khoá tài khoản/mất quyền duyệt trước giờ hẹn: lệnh vào Kẹt với lý do, không đẩy bằng quyền của người khác.
- Lệnh trong cụm (bài ghép, cùng nhóm đơn): đẩy một lệnh kéo cả cụm; lệnh khác trong cụm đã có hẹn riêng thì sau khi đẩy không còn ở tab Đã hẹn.
- Màn và API cũ dùng thời lượng bước (Kế hoạch bộ phận, Thực hiện SX, bài ghép) không vỡ khi bước máy không còn thời lượng: hiện trống, không hiện "0 phút" hay cảnh báo "máy chưa khai tốc độ".

---

### Task 1: Danh mục máy, công đoạn, Excel bỏ tốc độ

**Files:**
- Modify: `frontend/src/pages/rebuildCatalogConfigs.tsx` (CFG máy ~240-423: cột lưới "Tốc độ & Chuẩn bị", tab "Thông số kỹ thuật"/group "Tốc độ & Vận hành", fields `toc_do`, `toc_do_min`, `toc_do_max`, `don_vi_toc_do`, `_chuan_bi_kieu`, `makeready_time_default`, `chuan_bi_khoan`, phần tương ứng trong `deriveInitial`/`transformSubmit`). Ô Ghi chú chuyển sang group của tab Thông tin chung.
- Modify: `frontend/src/pages/danh-muc/fields/MayCuaCongDoan.tsx` (bỏ cột Tốc độ chạy, Canh máy, Cách đo giờ chạy và bộ sửa `cong_thuc_gio`; giữ cột Cách tính giá).
- Modify: `backend/app/services/catalog_excel_specs.py` (MAY_THIET_BI: bỏ cột Tốc độ TB/min/max, Đơn vị tốc độ, Thời gian canh máy, sheet "Khoản chuẩn bị"; spec công đoạn–máy bỏ cột "Công thức giờ chạy").
- Modify: `backend/app/services/may_thiet_bi_service.py:136-155` (thôi bắt buộc/kiểm tốc độ khi lưu; giá trị cũ để nguyên).
- Test: `backend/tests/test_import_excel.py`, `backend/tests/test_may_thiet_bi.py`, `frontend/src/pages/danh-muc/fields/MayCuaCongDoan.test.tsx`.

**Interfaces:** Produces: không có gì cho task khác. Cột DB không đổi.

- [ ] Step 1: Sửa test Excel: xuất mẫu máy không còn tiêu đề "Tốc độ", "Đơn vị tốc độ", "Thời gian canh máy", không còn sheet "Khoản chuẩn bị"; nhập file cũ còn các cột đó vẫn chạy (cột lạ bị bỏ qua) và không ghi đè `toc_do`.
- [ ] Step 2: Sửa test `MayCuaCongDoan.test.tsx`: bảng không còn chữ "Tốc độ chạy", "Canh máy", "Cách đo giờ chạy".
- [ ] Step 3: Chạy hai test, thấy đỏ.
- [ ] Step 4: Sửa code theo danh sách Files.
- [ ] Step 5: `python -m pytest tests/test_import_excel.py tests/test_may_thiet_bi.py tests/test_danh_muc_http_contract.py -q` xanh; `npx vitest run src/pages/danh-muc` xanh; `npx tsc --noEmit` sạch.

### Task 2: Lệnh thôi tính giờ chạy theo tốc độ

**Files:**
- Modify: `backend/app/services/lsx_service.py:292-465` `thoi_luong_buoc`: nhánh MAY trả `chiem_may_phut=None`, `_min/_max=None`, `phuong_phap="khong_tinh"`, không cảnh báo; `sl_tinh_cua_buoc` (1059-1077) thôi phụ thuộc `ma_don_vi_toc_do`. Bước TO (giờ kế hoạch) và THUE_NGOAI giữ nguyên. `lead_time` (2873-2905) bỏ `ngay_du_kien_xong`.
- Modify: `backend/app/services/xep_lich_service.py` (`_thoi_luong_in_ghep` 459-480, 1096-1097, 1146-1178: thôi sinh `may_chua_toc_do`; `chiem` None coi như 0 ở các chỗ cộng dồn, không ném lỗi).
- Modify: `backend/app/services/san_xuat/snapshot.py:122-145` (ghi `chay_phut=None` cho bước máy), `backend/app/services/bai_ghep_service.py` (`_node_chungs`, `_node`: thời lượng máy None).
- Modify FE: `frontend/src/pages/lsxBuoc.ts` (`thoiLuongLive`, `thoiLuong`: bước máy trả không thời lượng, bỏ cảnh báo thiếu tốc độ), `BaiGhepBuocChungForm.tsx` (bỏ dòng "Tốc độ …/Máy chưa khai tốc độ" và dải nhanh–chậm), `LsxDetailView.tsx:450-465` (bỏ map tốc độ vào `mayRefs`). Các màn hiện thời lượng (`KeHoachBoPhanPage.tsx`, `ThsxDanhSach.tsx`, `thsxShared.tsx`, `ThsxLichNgay.tsx`, `ThucHienSxPage.tsx`) hiện trống khi null, không "0 phút".
- Test: `backend/tests/test_lsx_service.py` (các ca 1987-2044, 2789-2834, 2973-3047, 3617-3669 về tốc độ: đổi kỳ vọng), `test_xep_lich_service.py`, `test_xep_lich_dot2.py`, `test_xep_lich_phan_doan.py`, `test_gia_cong_buoc_lenh.py`, `test_khsx_ui_contract.py`, `test_ke_hoach_bo_phan.py`; FE `BuocChungForm.test.tsx`.

**Interfaces:** Produces: `thoi_luong_buoc(...)` vẫn trả dict cùng khoá, nhưng bước MAY có `chiem_may_phut is None` và `phuong_phap == "khong_tinh"`.

- [ ] Step 1: Viết test `test_buoc_may_khong_tinh_gio` trong `test_lsx_service.py`: máy có `toc_do=5000`, bước MAY → `chiem_may_phut is None`, `phuong_phap == "khong_tinh"`, không có cảnh báo; bước TO `so_gio_ke_hoach=2` → `chiem_may_phut == 120`.
- [ ] Step 2: Chạy, đỏ. Sửa engine. Chạy lại xanh.
- [ ] Step 3: Chạy lần lượt các file test ở danh sách; sửa kỳ vọng nào còn dựa vào tốc độ (không xoá test về bước TO/thuê ngoài).
- [ ] Step 4: Sửa FE; `npx tsc --noEmit` và `npx vitest run src/pages` (chỉ thư mục liên quan) xanh.

### Task 3: Gỡ "Dự kiến xong"

**Files:**
- Modify: `backend/app/services/lenh_sx/tien_do.py` (bỏ `du_kien_xong`; `tre_han` đổi nghĩa: lệnh chưa xong và hôm nay đã qua `han_giao_khach`), `lenh_sx/danh_sach.py:159-180`, `lenh_sx/ho_so.py:156-175` + `:1015-1023`, `lenh_sx/theo_doi.py` (bỏ `du_kien_xong`; `tre_ngay` = số ngày đã qua hạn giao khi chưa xong), `lenh_sx/theo_doi_don.py:155-159, 223-283` (bỏ nhánh "dự kiến xong sau hạn giao", giữ nhánh đã qua hạn giao), `services/don_hang_tien_do.py` (bỏ `du_kien_xong`, `tre_ngay`, `chua_du_du_lieu` theo dự kiến).
- Modify schemas: `schemas/lenh_san_xuat.py` (`TienDoOut.du_kien_xong`), `schemas/theo_doi_san_xuat.py`, `schemas/lsx.py` (`LeadTimeOut.ngay_du_kien_xong`).
- Modify FE: `client.ts` (`LenhSxTienDo`, `TdsxDonDong`, `DonTienDoLenh`, `DonTienDo` bỏ trường), `LenhSxNgan.tsx:326`, `DonHangBanPage.tsx:996-1001` (bỏ ô Dự kiến xong và dòng trễ/kịp), `giao-hang/tien-do-don/TienDoDon.tsx` (bỏ `CanhBaoTre` và ô dự kiến), `TdsxNganDon.tsx:352`, `tdsxDon.ts:76-86` (bỏ lý do "Dự kiến xong sau hạn giao").
- Test: `test_lenh_sx_tien_do.py`, `test_lenh_sx_trang_thai.py`, `test_lenh_sx_api.py`, `test_theo_doi_theo_lenh.py`, `test_theo_doi_theo_don.py`, `test_gia_cong_tron_goi.py`; FE `TienDoDon.test.tsx`, `LenhSanXuatPage.test.tsx`, `LenhSxNganTabs.test.tsx`, `TheoDoiSanXuatPage.test.tsx`.

**Interfaces:** Produces: `tre_han(lsx, hom_nay: date) -> bool` (chưa xong và `hom_nay > han_giao_khach`; `han_giao_khach` None → False).

- [ ] Step 1: Test `test_tre_han_theo_han_giao`: lệnh chưa xong, `han_giao_khach = hôm nay - 1` → `tre_han` True; `= hôm nay` → False; đã xong → False. Đỏ.
- [ ] Step 2: Sửa BE. Test API: payload tiến độ lệnh, tiến độ đơn, theo dõi theo đơn không còn khoá `du_kien_xong`. Xanh.
- [ ] Step 3: Sửa FE và test FE; `npx tsc --noEmit` sạch.

### Task 4: Bỏ "Hạn hoàn thành sản xuất"

**Files:**
- Modify FE (ô nhập và hiển thị): `LsxDetailView.tsx:1234-1239` + state/submit (97, 135, 560) + `tinhNgayDem`/badge "Đệm N ngày" (166-180, 692); `BaiGhep2Page.tsx` (478, 563, 582, 781, 818, 832, 945); `BaiGhepDagCanvas.tsx:1112-1114`; `KeHoachSXPage.tsx:902` (đổi sang hạn giao); bộ lọc `loc-san-xuat/dieu-kien-hang-cho.ts`, `dieu-kien-ke-hoach-sx.ts`, `dieu-kien-lenh-san-xuat.ts`: mốc lọc `han_sx` đổi thành `han_giao` nhãn "Hạn giao".
- Modify BE (mốc logic → `han_giao_khach`): `lenh_sx/theo_doi.py:161-165` sắp xếp; `lenh_sx/danh_sach.py:113, 377, 383` + `repositories/lenh_sx_doc_repo.py`; `repositories/lsx_repo.py:25` `MOC_LENH`; routers nhận `moc=han_giao` (`lenh_san_xuat.py:99`, `lsx.py:359`) — `han_sx` cũ vẫn nhận và hiểu như `han_giao` để link cũ không vỡ; `xep_lich_service.py:1403-1406` `_han` chỉ còn hạn giao; `ke_hoach_vat_tu_service.py:1478-1509, 1588` thứ tự chia tồn = giờ hẹn đẩy (`xep_lich_lenh.bat_dau_at`) tăng dần, rồi hạn giao, rồi mã; `du_bao_ton_service.py:153-159`, `ton_kho_nhom_service.py:86` và FE `ton-kho/duBao.ts:106`: đổi sang hạn giao; `bai_ghep_service.py:365-369` thôi tự đặt, `:1415-1432` `han_in_muon_nhat` = min hạn giao các lệnh con, `:2097-2099` `lech_han` so hạn giao; `phieu_cong_nghe.py:385` bỏ dòng "Hạn SX".
- Modify write paths: `lsx_service.py:3429` và `bai_ghep_2_service.py:15` bỏ khỏi trường sửa được; schemas `LsxUpdateIn`, bài ghép update bỏ trường (field đọc ra có thể giữ trong schema đọc tới Task 7 dọn).
- Test: các file liệt kê ở mục C(6) của bản đồ: `test_lenh_sx_tien_do.py`, `test_bai_ghep_2_service.py`, `test_theo_doi_theo_lenh.py`, `test_lenh_sx_api.py`, `test_ke_hoach_vat_tu.py`, `test_lenh_sx_con_song.py`, `test_lenh_sx_trang_thai.py`, `test_giu_cho_vat_tu.py`, `test_loc_danh_sach_dieu_phoi.py`, `test_loc_danh_sach_san_xuat.py`, `test_kho_ton_nhom.py`; FE `LenhSanXuatPage.test.tsx`, `dieu-kien-ke-hoach-sx.test.ts`, `ton-kho/duBao.test.ts`.

**Interfaces:** Consumes: `tre_han` của Task 3. Produces: mốc lọc `moc="han_giao"` ở mọi API danh sách lệnh.

- [ ] Step 1: Test `test_chia_ton_theo_gio_hen_roi_han_giao` (`test_ke_hoach_vat_tu.py`): hai lệnh thiếu cùng một vật tư, lệnh A hẹn đẩy sớm hơn nhưng hạn giao muộn hơn → A được chia tồn trước; lệnh không hẹn xếp sau lệnh có hẹn. Đỏ.
- [ ] Step 2: Test API: `PUT /api/lsx/{id}` gửi `han_hoan_thanh_sx` thì giá trị DB không đổi; `GET` danh sách với `moc=han_giao` lọc theo `han_giao_khach`.
- [ ] Step 3: Sửa BE; chạy các test liệt kê, sửa kỳ vọng. Xanh.
- [ ] Step 4: Sửa FE; `npx tsc --noEmit` và test FE liên quan xanh. `grep -rn "Hạn hoàn thành\|Hạn xong SX\|Hạn SX" frontend/src` không còn chỗ hiển thị (trừ màn Xếp lịch cũ, Task 6/7 thay).

### Task 5: Xếp lịch mới — máy chủ và tự đẩy

**Files:**
- Modify: `backend/app/models/xep_lich_lenh.py`: thêm `nguoi_hen_id` (Integer, soft FK users.id, null), `ket_ly_do` (Text, null), `ket_luc` (DateTime tz, null).
- Modify: `backend/app/db_migrations.py` (`0470_xep_lich_hen_day`: ADD COLUMN IF NOT EXISTS ba cột; backfill `nguoi_hen_id = created_by`), `docs/DB_SCHEMA.md` mục `xep_lich_lenh`.
- Create: `backend/app/repositories/xep_lich_hen_repo.py` (truy vấn theo tab, đếm tab, đếm theo ngày, chọn lệnh tới giờ).
- Create: `backend/app/services/xep_lich/hen_day.py`.
- Create: `backend/app/services/xep_lich/sau_phat_hanh.py`: chuyển các hàm báo sau phát hành đang nằm trong router (`_phat_goi_xuong_xuong`, `_cham_viec_moi`, `bao_sau_phat_hanh`, `_cham_cho_xep`) thành hàm service dùng chung cho router và vòng lặp nền; router gọi lại hàm mới.
- Modify: `backend/app/routers/xep_lich.py` (endpoint mới), `backend/app/schemas/xep_lich.py`, `backend/app/main.py` (vòng lặp), `backend/app/audit_registry.py`.
- Test: Create `backend/tests/test_xep_lich_hen_day.py`.

**Interfaces (Produces, Task 6 dùng):**

```
GET  /api/xep-lich/ban            perm read
     tab: "ket"|"chua_hen"|"da_hen"|"da_day"; tu, den: date (bắt buộc, den>=tu, <=92 ngày)
     tim?: str; gap?: bool; thieu_vat_tu?: bool; sat_han?: bool; trang=1; moi_trang=25 (1..100)
  -> BanOut { dong: list[DongBanOut], tong: int,
              dem_tab: {ket, chua_hen, da_hen, da_day: int},
              dem_loc: {gap, thieu_vat_tu, sat_han: int},       # trong tab hiện tại, trước khi áp 3 lọc này
              dem_ngay: dict[str(YYYY-MM-DD), int] }            # số lệnh hẹn đẩy mỗi ngày trong [tu,den], theo bộ lọc
DongBanOut { lsx_id, ma, ten (sản phẩm), customer_name, is_rush, so_luong_dat, don_vi_tinh,
             han_giao_khach: date|None, hen_luc: datetime|None, nguoi_hen: str|None,
             da_day_luc: datetime|None, ket_ly_do: str|None, ket_luc: datetime|None,
             vat_tu: {muc: "ok"|"vang"|"do", chu: str}|None, vat_tu_ve: date|None, cum_id: int|None, updated_at }
POST   /api/xep-lich/hen          perm approve   HenIn{lsx_ids: list[int] (1..500), hen_luc: datetime}  -> {ok, so_lenh}
POST   /api/xep-lich/hen-theo-loc perm approve   HenTheoLocIn{tab, tu, den, tim?, gap?, thieu_vat_tu?, sat_han?, hen_luc} -> {ok, so_lenh}
DELETE /api/xep-lich/hen/{lsx_id} perm approve   -> {ok}
POST   /api/xep-lich/day-ngay     perm approve   DayNgayIn{lsx_ids: list[int] (1..100)} -> {da_day: list[str ma], loi: list[{ma, ly_do}]}
GET    /api/xep-lich/lenh/{lsx_id}/lich-su-hen perm read -> list[{luc, nguoi, viec, chi_tiet|None}]
GET    /api/xep-lich/lenh/{lsx_id}/ngan perm read -> NganOut{ dau: DongBanOut, vat_tu: list[{ten, can, da_giu, don_vi, muc, chu, don_mua|None}], cong_doan: list[{buoc, ten, bo_phan, so_luong, don_vi}] }
```

Luật (service `hen_day.py`):
- Tab: `ket` = có hàng `xep_lich_lenh` với `ket_ly_do` khác null, lệnh chưa đẩy. `chua_hen` = `Lsx.trang_thai in TT_XEP_DUOC` và không có hàng. `da_hen` = có hàng, `ket_ly_do` null, `trang_thai in TT_XEP_DUOC`, `bat_dau_at` trong `[tu, den]`. `da_day` = `trang_thai in (da_phat_hanh, da_dong)` và lúc đẩy (`SanXuatGoiPhatHanh.created_at` của gói đang chạy) trong `[tu, den]`. `ket` và `chua_hen` không lọc theo khoảng ngày.
- Sắp xếp: gấp trước; `da_hen` rồi giờ hẹn tăng; `chua_hen`/`ket` rồi hạn giao tăng (null cuối); `da_day` lúc đẩy giảm; cuối cùng `id`.
- `sat_han` = `han_giao_khach - hôm nay <= 2` ngày. `thieu_vat_tu` = đèn vật tư khác `ok`. Đèn chỉ tính cho tab chưa đẩy, gọi `lsx_tong_quan.den_vat_tu_va_bang` một lượt cho cả tập lệnh của tab (cần cho lọc/đếm), giữ đệm theo tiến trình 60 giây khoá theo tập id; tab `da_day` trả `vat_tu=None`.
- `vat_tu_ve`: ngày về sớm nhất của phiếu mua đang chạy cho món còn thiếu, lấy từ dữ liệu `ngay_ve` mà `KeHoachVatTuService` đã có (`ke_hoach_vat_tu_service.py:613-707`); không có thì None (UI không vẽ tam giác).
- `hen(lsx_ids, hen_luc, actor)`: chặn nếu `hen_luc <= now` ("Giờ hẹn phải sau bây giờ"), lệnh không ở `TT_XEP_DUOC` ("LSX… chưa sẵn sàng hoặc đã đẩy"). Upsert hàng, đặt `bat_dau_at=hen_luc` (giữ đúng giờ người chọn, KHÔNG qua `trai_lich`), `nguoi_hen_id=actor.id`, xoá `ket_ly_do/ket_luc`. Nhật ký `xep_lich_hen_day` (mới) hoặc `xep_lich_doi_gio_hen` (đã có hẹn), target `lsx:{id}`, detail "từ … sang …". SSE `xep_lich_changed`.
- `bo_hen`: xoá hàng, nhật ký `xep_lich_bo_hen`.
- `day_ngay(lsx_ids, actor)`: lần lượt gọi `XepLichLenhService.phat_hanh(lsx_id, actor=actor)`; lệnh đã được đẩy theo cụm ở lượt trước thì bỏ qua; lỗi `XepLichLenhConflict/Error` gom vào `loi`. Sau mỗi lệnh đẩy được gọi `sau_phat_hanh.bao(...)`.
- `quet_tu_day(now) -> int`: mở `SessionLocal()`; chọn hàng `bat_dau_at <= now`, `ket_ly_do is null`, lệnh `TT_XEP_DUOC`; với từng hàng: khoá dòng (`with_for_update(skip_locked=True)` trên Postgres), kiểm lại trạng thái; người hẹn không còn hoạt động hoặc không còn quyền `xep_lich:approve` → kẹt "Người hẹn không còn quyền đẩy lệnh"; gọi `phat_hanh(actor=người hẹn)`; thành công → nhật ký `xep_lich_tu_day` + `sau_phat_hanh.bao`; lỗi → `ket_ly_do` = câu lỗi, `ket_luc=now`, nhật ký `xep_lich_tu_day_ket`, `thong_bao_man.bao(kenh="xep_lich", loai="tu_day_ket", nguoi_nhan=[nguoi_hen_id])`. Trả số lệnh đã đẩy.
- Vòng lặp `run_tu_day_loop(interval=60)` trong `hen_day.py` theo khuôn `phieu_luong_mo.py` (`giu_vai_chinh("xep_lich_tu_day", ttl_ms=interval*3000)`), đăng ký trong `main.py` lifespan cạnh các vòng hiện có (chỉ khi `care_reminder_seconds > 0`).
- Nhãn nhật ký mới trong `audit_registry.py` khối xep_lich: `xep_lich_hen_day` "Hẹn đẩy", `xep_lich_doi_gio_hen` "Đổi giờ hẹn", `xep_lich_bo_hen` "Bỏ hẹn", `xep_lich_tu_day` "Tự đẩy", `xep_lich_tu_day_ket` "Tới giờ chưa đẩy được". `lich-su-hen` đọc `list_by_targets([f"lsx:{id}"], actions=[5 mã trên, "xep_lich_phat_hanh", "xep_lich_go_phat_hanh"])`, mới nhất trước; `nguoi` là tên người ghi (tự đẩy ghi tên người hẹn).

- [ ] Step 1: Migration + model + DB_SCHEMA; `test_migration_0470` chạy hai lần không lỗi, ba cột tồn tại.
- [ ] Step 2: Test service trong `test_xep_lich_hen_day.py`: `test_hen_chan_gio_qua_khu`, `test_hen_chan_lenh_nhap`, `test_hen_ghi_dung_gio_khong_trai_lich`, `test_doi_gio_xoa_ket`, `test_tab_dem_dung` (4 tab), `test_da_hen_loc_theo_khoang`, `test_dem_ngay`, `test_sap_xep_gap_truoc`, `test_quet_tu_day_day_lenh_toi_gio` (trạng thái → da_phat_hanh, nhật ký `xep_lich_tu_day` với actor là người hẹn), `test_quet_khong_day_lenh_chua_toi_gio`, `test_quet_ket_khi_phat_hanh_loi` (ví dụ lệnh khác cùng cụm còn Nháp → `ket_ly_do` có chữ, có thông báo), `test_quet_ket_khi_nguoi_hen_mat_quyen`, `test_quet_hai_lan_khong_day_lai`, `test_day_ngay_gom_loi`. Đỏ.
- [ ] Step 3: Viết repo + service; xanh.
- [ ] Step 4: Test API: `test_moi_route_moi_co_cua_quyen` (read cho GET, approve cho ghi), `test_ban_phan_trang_25`, `test_hen_theo_loc`, `test_lich_su_hen_moi_nhat_truoc`, `test_ngan_co_vat_tu_va_cong_doan`, SSE `xep_lich_changed` sau hen/bo_hen/day_ngay. Viết router + schemas; xanh. Chạy thêm `tests/test_audit_registry.py tests/test_xep_lich_lenh_api.py` xanh.
- [ ] Step 5: Đăng ký vòng lặp trong `main.py`; khởi động lại uvicorn, `GET /api/health` 200, log không lỗi.

### Task 6: Xếp lịch mới — giao diện theo mockup B

**Files:**
- Modify: `frontend/src/api/client.ts` (types `XlBan`, `XlDongBan`, `XlNganHen`, `XlLichSuHen`; `api.xepLich.ban`, `hen`, `henTheoLoc`, `boHen`, `dayNgay`, `lichSuHen`, `ngan`).
- Rewrite: `frontend/src/pages/XepLichPage.tsx` (vỏ màn: đầu màn, tab, lọc, bảng, thanh chọn, chân bảng, ngăn).
- Create: `frontend/src/pages/XlBan.tsx` (bảng một `<table>`: cột chọn, Lệnh, Khách hàng, Vật tư, dải ngày), `frontend/src/pages/XlNganHen.tsx` (ngăn 3 tab Vật tư / Lịch sử hẹn / Công đoạn, chân Bỏ hẹn / Đổi giờ / Đẩy ngay; tab Đã đẩy thì chân là Thu hồi / Đẩy cập nhật dùng lại API có sẵn), `frontend/src/pages/XlHenGio.tsx` (hộp chọn ngày giờ dùng `ChonNgay` + ô giờ có sẵn, chặn giờ quá khứ), `frontend/src/pages/xep-lich-hen.css`.
- Reuse: `XlKhoangNgay.tsx` (nút khoảng ngày), `PhanTrangDayDu`, `XlKhoaMay.tsx` (nút "Khoá máy" ở đầu màn như hiện nay).
- Test: Create `frontend/src/pages/XlBan.test.tsx`, `frontend/src/pages/XlNganHen.test.tsx`.

**Interfaces:** Consumes API của Task 5.

Hành vi (đối chiếu mockup):
- Mở màn: tab Kẹt nếu `dem_tab.ket > 0`, không thì Chưa hẹn giờ. Khoảng ngày mặc định hôm nay → +13 ngày; tab Đã đẩy khi mở lần đầu dùng hôm nay −13 → hôm nay.
- Lưới trái 3 cột: Lệnh 165px (mã + chip Gấp cam `--tt-cam-*` + dòng sản phẩm nhỏ), Khách hàng 180px, Vật tư 96px (chip ngắn: "Đủ" lá, "Về d/m" vàng, "Về d/m" đỏ khi về sau giờ hẹn, "Thiếu" đỏ khi không có ngày về). Dải ngày chiếm phần còn lại; cột ngày tối thiểu 40px, thiếu chỗ thì cuộn ngang.
- Dải ngày: chấm xanh giờ hẹn kèm nhãn "hh:mm" bên phải; vạch nối tới hình thoi hạn giao; hình thoi và vạch đỏ khi còn ≤ 2 ngày; "›" khi hạn giao ngoài khoảng; tam giác vàng ngày vật tư về; tab Kẹt chấm đỏ; tab Đã đẩy chấm lá ở lúc đẩy. Đầu cột ngày: thứ, ngày, và "N lệnh" từ `dem_ngay`; hôm nay nền cam nhạt, Chủ nhật nền xám.
- Chọn: tick dòng/tick cả trang; khi tick cả trang và `tong > số dòng` hiện link "Chọn cả N lệnh theo bộ lọc". Thanh chọn: Hẹn giờ, Đẩy ngay, Bỏ chọn. Chọn theo bộ lọc + Hẹn giờ gọi `henTheoLoc`.
- Không có quyền `xep_lich:approve` thì ẩn ô chọn, Hẹn giờ, Đẩy ngay, Bỏ hẹn.
- SSE `xep_lich_changed` (`eventTick`) tải lại trang hiện tại, không reset trang/lọc.
- Tab Kẹt: dưới mã hiện lý do kẹt (chữ đỏ nhỏ).
- Mobile (<768px): dải ngày ẩn, lưới còn Lệnh / Vật tư / Hẹn đẩy dạng chữ.

- [ ] Step 1: Test `XlBan.test.tsx`: render 2 dòng (một gấp) → có chip "Gấp"; dòng `vat_tu.muc="vang"` có chip vàng; hạn giao còn 1 ngày → hình thoi lớp `thoi--sat`; đầu cột ngày có "12 lệnh" khi `dem_ngay` cho 12.
- [ ] Step 2: Test `XlNganHen.test.tsx`: bấm tab "Lịch sử hẹn" hiện bảng Lúc/Người/Việc; tab "Công đoạn" hiện "Bộ phận nhận"; lệnh đã đẩy thì chân có "Thu hồi", không có "Bỏ hẹn".
- [ ] Step 3: Viết code; `npx vitest run src/pages/XlBan.test.tsx src/pages/XlNganHen.test.tsx` xanh; `npx tsc --noEmit` sạch.

### Task 7: Dọn Gantt cũ

**Files:**
- Delete (FE): `XlLuoi.tsx`, `XlKhay.tsx`, `XlDanhSachDT.tsx`, `XlNgan.tsx`, `xlNganSo.ts` (+ test), các helper chỉ Gantt dùng trong `xlShared.tsx` (`treHan`, `classHan`, `mocHan`, `soNgayTre`, hình học thanh) — giữ `ymd`, `themNgay`, `dauTuan`, `loiKhoangNgay`, `soNgayGiua`, hằng `NGAY_NHAP_*` mà `XlKhoangNgay` dùng; `client.ts` bỏ hàm/type chỉ Gantt dùng (`lich`, `thuMoc`, `hangCho`, `hangChoKhachLoc`, `datMoc`, `xoaMoc`, `XlDong`, `XlThe`, `XlLich`…), giữ `phatHanh`, `thuHoi`, `goiPhatHanh`, `phatHanhCapNhat`, `soSanhPhienBan`, `vatTu`, khoá máy.
- Delete (BE): endpoint `GET /hang-cho`, `GET /hang-cho/khach-loc`, `GET /lich`, `GET /lenh/{id}/thu`, `PUT /lenh/{id}`, `DELETE /lenh/{id}` và test của chúng trong `test_xep_lich_lenh_api.py`; service `hang_cho`, `khach_hang_cho`, `lich`, `thu_moc`, `dat_moc`, `xoa_moc` nếu không còn ai gọi (kiểm bằng grep; `moc_cong_doan`, `phat_hanh`, `thu_hoi`, `phat_hanh_cap_nhat`, `chi_tiet` giữ). Schema đọc bỏ `han_hoan_thanh_sx` còn sót (Task 4).
- Modify: `frontend/src/pages/loc-san-xuat/dieu-kien-hang-cho.ts` (xoá nếu chỉ khay cũ dùng), tests `test_cham_do_ban_to.py`, `test_loc_danh_sach_dieu_phoi.py` nếu gọi endpoint đã xoá.

- [ ] Step 1: `grep` từng hàm/endpoint trước khi xoá; xoá; `npx tsc --noEmit` sạch; `python -m pytest tests/test_xep_lich_lenh_api.py tests/test_xep_lich_lenh_service.py tests/test_xep_lich_hen_day.py tests/test_cham_do_ban_to.py tests/test_loc_danh_sach_dieu_phoi.py -q` xanh.

### Task 8: Xác minh luồng thật trên dev-browser

- [ ] Step 1: Khởi động lại uvicorn (theo memory: tạo tiến trình tách rời qua WMI), FE 5173, đăng nhập admin.
- [ ] Step 2: Thẻ máy: không còn tab Thông số kỹ thuật, Ghi chú ở Thông tin chung; lưu máy được. Công đoạn: bảng máy không còn 3 cột. Xuất Excel máy, mở file: không còn cột tốc độ.
- [ ] Step 3: Lệnh: ô Hạn hoàn thành SX không còn; ngăn lệnh không còn "Dự kiến xong"; đơn hàng bán chặng Sản xuất không còn "Dự kiến xong".
- [ ] Step 4: Xếp lịch: tab Chưa hẹn giờ → tick 2 lệnh → Hẹn giờ 2 phút sau giờ hiện tại → lệnh sang tab Đã hẹn, chấm xanh đúng ngày, nhãn giờ đúng; mở ngăn → Lịch sử hẹn có dòng "Hẹn đẩy". Chờ qua giờ hẹn (vòng lặp 60 giây) → lệnh tự sang Đã đẩy không cần refresh; Kế hoạch bộ phận nhận lệnh. Tạo một ca kẹt (lệnh trong cụm còn Nháp) → tab Kẹt có lý do, chuông thông báo của người hẹn nhảy.
- [ ] Step 5: Báo cáo theo `.agents/rules/testing.md`: bấm gì, gõ gì, thấy gì từng bước; ghi "tài liệu chờ nghiệm thu".
