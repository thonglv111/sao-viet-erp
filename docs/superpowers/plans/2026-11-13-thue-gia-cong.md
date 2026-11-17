# Thuê gia công — Plan triển khai

> **Cho agent làm việc:** làm theo từng đợt, mỗi đợt xong thì dừng lượt và báo phiên giám sát. Bước dùng ô `- [ ]` để đánh dấu. Sub-skill: superpowers:executing-plans (làm tại chỗ, một người, không subagent viết code).

**Mục tiêu:** tách gia công ngoài khỏi Lệnh sản xuất thành module **Thuê gia công** (`thue_gia_cong`, `/thue-gia-cong`): lệnh chỉ còn cờ Thuê ngoài, ô "Nhà gia công tự lo" trên dòng vật tư và trạng thái chỉ đọc; mọi việc đặt, giao, nhận, trả tiền nằm ở module mới, bám khung Subcontracting của ERPNext v17, bỏ hạch toán.

**Kiến trúc:** bảng mới tiền tố `tgc_`. Backend theo tầng `routers/thue_gia_cong.py → services/thue_gia_cong/* → repositories/thue_gia_cong_repo.py`. Lệnh nối sang module qua đúng ba điểm (phát hành, bàn giao của bước trước, phiếu nhận). Trạng thái chứng từ dẫn xuất từ mốc thời gian và số liệu dòng, không lưu cột trạng thái (giữ cách của module cũ).

**Tech:** FastAPI + SQLAlchemy (không Alembic, migration ở `backend/app/db_migrations.py`), Postgres dev / SQLite test, React + Vite + TS, SSE `backend/app/realtime.py`.

**Spec:** `docs/superpowers/specs/2026-11-13-module-gia-cong-ngoai-design.md` (đã đổi tên sang Thuê gia công, §11 là quyết định đã chốt). Mockup: `docs/mockups/gia-cong-ngoai-module-moi.html`. Đối chiếu ERPNext: `D:\jobs\erpnext\erpnext\subcontracting\`, `manufacturing\doctype\job_card\`, `manufacturing\doctype\bom_item\`.

## Ràng buộc chung

- Làm thẳng trên `dev` ở `D:\jobs\SVN`. Không commit, không push khi chưa được bảo. Chỉ `git add` file của mình.
- Thư mục có thay đổi chưa commit của phiên khác. File chung mà plan buộc phải sửa: `backend/app/db_migrations.py` (chỉ nối migration mới vào cuối), `backend/app/models/san_xuat.py`, `backend/app/schemas/san_xuat.py`, `backend/app/services/san_xuat/board.py` (nếu cần), `docs/DB_SCHEMA.md`, `docs/huong-dan-ke-hoach-sx/huong-dan-ke-hoach-san-xuat.tex`, `docs/huong-dan-viec-cua-to/huong-dan-viec-cua-to-va-kcs.tex`, `frontend/src/api/client.ts`, `frontend/src/pages/ThsxDrawer.tsx`. Sửa đúng chỗ của mình, không đụng hunk của họ. Lúc được bảo commit: nếu phiên kia chưa commit file chung thì tách hunk của mình bằng `git diff <file>` → sửa patch → `git apply --cached`, không `git add` cả file.
- Migration: id dạng `NNNN_tgc_<việc>`, NNNN lấy số kế tiếp lúc làm (hiện cao nhất `0476_song_don_vi_m2`). Boolean `server_default` là `true`/`false`. Backfill bằng `text()` nêu đích danh cột, không `db.query(Model)`. Đọc `_existing_columns`/`get_table_names` trước lệnh ghi đầu tiên.
- Mọi bảng/cột mới vào `docs/DB_SCHEMA.md` cùng lượt (guard `test_schema_documented`).
- Mọi mã audit mới khai ở `backend/app/audit_registry.py`; mã `gia_cong_ngoai_*` cũ GIỮ nhãn (dữ liệu cũ còn trong `audit_logs`).
- Tên người (người giao, người nhận, người hoàn tất, người huỷ) do server gán từ actor, không có trong schema nhập.
- Tiền gia công không gác `view_cost` (ngoại lệ 27/09, giữ nguyên).
- Mọi bản ghi gắn với lệnh trên API và UI có đủ: mã lệnh, khách hàng, mã đơn hàng, mặt hàng (`lsx.ten`), hạn giao (`lsx.han_giao_khach`). Bài ghép: liệt kê từng lệnh thành viên.
- UI tiếng Việt; không nối thông tin bằng `·` hay dấu phẩy; danh sách chứng từ dùng `ThanhLoc` + `PhanTrangDayDu` + lọc/phân trang ở máy chủ + cột Ngày tạo; ngày dùng `ChonNgay`; tiền/số gõ dùng `OGoDinhDang`; chip trạng thái lấy `--tt-*`; ngăn chi tiết có tab + kéo rộng mép trái.
- Real-time: mọi thay đổi bắn SSE sau commit (`tgc_changed`, `tgc_san_sang_giao`, `tgc_cho_tra_tien_changed`), badge và toast tự nhảy.
- Xác minh mỗi đợt: `python -m pytest tests/<file liên quan> -q` từ `backend/`, `npx tsc --noEmit` từ `frontend/`; luồng có UI phải bấm thật trên dev-browser, báo cáo liệt kê bấm gì, gõ gì, thấy gì. Không chạy `./init.ps1`, không chạy cả bộ pytest.
- Tài liệu PDF: đợt nào đổi UI/luồng mà tài liệu mô tả thì sửa `.tex`, chụp lại ảnh, biên dịch XeLaTeX 2 lần ngay trong đợt đó.
- **Không commit, không push cho tới khi xong đợt 5** (góp ý giám sát 13/11): từ đợt 2 tới hết đợt 5 lệnh có bước thuê ngoài chưa nhận hàng về được, mà push `dev` tự deploy staging. Ai bảo commit sớm thì nêu rủi ro này trước.
- Báo cáo cuối mỗi đợt ghi: lệnh test đã chạy kèm số xanh/đỏ; danh sách file đã sửa, tách riêng file chung với phiên khác; phần nào chưa bấm thử được.

## Dữ liệu cũ trên DB dev (đã kiểm 13/11/2026, `svn_erp_trong`)

`gia_cong_ngoai` có 5 dòng: 2 trọn gói chưa chốt (LSX26-0004 xưởng cấp giấy, có đề nghị xuất DNX00012 `approved`; LSX26-0008 xưởng cấp giấy, chưa có đề nghị), 1 một phần LSX26-0007 đã mang đi 250 và chốt 250 về xưởng (lệnh đã đóng), 2 một phần đã huỷ. `san_xuat_cong_viec` có 5 công việc trỏ lần; `payment_vouchers` 0; `delivery_trips` 0; `lsx_cong_doan` loại `thue_ngoai` 1 dòng. Production DB trắng; staging chưa kiểm được từ máy này nên migration chuyển dữ liệu viết tổng quát, không gắn với 5 dòng trên.

## Mô hình dữ liệu (đợt 1 tạo, các đợt sau dùng)

File `backend/app/models/thue_gia_cong.py`. Người ghi là tham chiếu MỀM tới `users` (Integer không FK) như model cũ, vì FK tới `users` bắt buộc CASCADE.

| Bảng | Cột | Ghi chú |
|---|---|---|
| `tgc_viec` | `id`, `lsx_id` FK lsx CASCADE null, `bai_ghep_id` FK bai_ghep RESTRICT null, `kieu` (`mot_phan`/`tron_goi`), `ten_viec`, `sl_can` Numeric(18,3), `don_vi` (đơn vị ra bước cuối; trọn gói = `lsx.don_vi_tinh`), `xuong_cap_giay` Bool default false (chỉ trọn gói), `created_by`, `created_at`, `updated_at`, `version` | CHECK đúng một nguồn `ck_tgc_viec_mot_nguon`. Không có cột huỷ: việc chưa đặt bị xoá khi thu hồi (spec §3 điểm nối 1). |
| `san_xuat_cong_viec.tgc_viec_id` | FK tgc_viec SET NULL, index | Thay `gia_cong_ngoai_id`. |
| `tgc_don` | `id`, `ma` unique (`GC26-0001`), `nha_cung_cap_id` FK suppliers, `nha_cung_cap_ten` (ảnh chụp), `ngay_dat` Date, `ngay_hen_ve` Date null, `ghi_chu`, `dat_luc`/`dat_boi_id` (null = Nháp), `huy_luc`/`huy_boi_id`/`ly_do_huy`, `created_by`, `created_at`, `updated_at`, `version` | |
| `tgc_don_dong` | `id`, `don_id` FK CASCADE, `viec_id` FK tgc_viec RESTRICT, `sl_dat` Numeric(18,3), `don_gia` Numeric(18,2), `don_vi`, `hoan_tat_luc`/`hoan_tat_boi_id`, `hao_hut` Numeric(18,3) null (chụp lúc hoàn tất), `huy_luc` (chép từ đơn khi huỷ), `thu_tu` | Index unique một phần `uq_tgc_don_dong_viec_song (viec_id) WHERE huy_luc IS NULL`: một việc chỉ một dòng đơn sống. |
| `tgc_phieu_giao` | `id`, `ma` unique (`GG26-0001`), `don_id` FK, `giao_luc`, `nguoi_giao_id`, `ghi_chu`, `huy_luc`/`huy_boi_id`/`ly_do_huy`, `created_at`, `version` | |
| `tgc_phieu_giao_dong` | `id`, `phieu_id` FK CASCADE, `don_dong_id` FK, `loai` (`ban_thanh_pham`/`vat_tu`), `so_luong`, `don_vi`, `ban_giao_id` FK san_xuat_ban_giao SET NULL (dòng bán thành phẩm, mỗi bàn giao một dòng), `hang_loai`/`hang_id`/`kho_rong`/`kho_dai` (dòng vật tư), `lsx_cong_doan_vat_tu_id` null (dòng định mức nguồn) | |
| `tgc_phieu_nhan` | `id`, `ma` unique (`GN26-0001`), `don_id` FK, `nhan_luc`, `nguoi_nhan_id`, `ghi_chu`, `huy_luc`/`huy_boi_id`/`ly_do_huy`, `created_at`, `version` | |
| `tgc_phieu_nhan_dong` | `id`, `phieu_id` FK CASCADE, `don_dong_id` FK, `sl_dat`, `sl_hong` Numeric(18,3), `don_gia` (chụp từ dòng đơn lúc nhận), `noi_ve` (`xuong`/`kho`/`khach`), `dich_cong_viec_id` null, `ngay_khach_nhan` Date null, `batch_id` FK san_xuat_batches SET NULL | Tiền tạm tính = `sl_dat × don_gia`, không lưu. |
| `tgc_phieu_chi_nhan` | `id`, `payment_voucher_id` FK CASCADE, `phieu_nhan_id` FK RESTRICT, `amount_vnd` BigInteger | Khuôn `phieu_chi_cuoc_giao`. Một phiếu nhận chỉ một phiếu chi còn hiệu lực (kiểm ở service dưới khoá dòng phiếu nhận). |
| `lsx_cong_doan_vat_tu.ncc_tu_lo` | Bool `server_default=true` | Chỉ có nghĩa khi bước `loai_buoc = thue_ngoai`. Dòng bị loại khỏi kế hoạch vật tư khi bước thuê ngoài VÀ `ncc_tu_lo`. |
| `stock_requests.tgc_phieu_giao_id` / `tgc_phieu_nhan_id` / `tgc_don_dong_id` | Integer null, index, tham chiếu mềm (như cột cũ) | Xuất vật tư theo phiếu giao / nhập thành phẩm theo phiếu nhận / nhập trả vật tư dư lúc hoàn tất. |
| `delivery_trips.tgc_phieu_nhan_id` | Integer null, index, mềm | Giao thẳng khách. |

Mã chứng từ: thêm `"tgc_don": "GC"`, `"tgc_phieu_giao": "GG"`, `"tgc_phieu_nhan": "GN"` vào `PREFIX_MAP` (`services/sequence_service.py`); không trùng tiền tố hiện có (`GB` là bài ghép).

Phiếu chi giữ `source_type = "gia_cong_ngoai"` (hằng `VOUCHER_SOURCE_GIA_CONG`, mục cố định HT-02 và migration 0396 đang dựa vào mã này) — chỉ đổi nhãn hiển thị sang "Thuê gia công". Không `supplier_id`, loại khỏi 331 như cũ. Lý do lệch giữa tiền chi và tạm tính ghi vào `content` (Lý do chi) do server ghép, không thêm cột.

Cấu hình tách vai (Q2): `TGC_CHAN_NGUOI_GIAO_TU_NHAN: bool = True` trong `backend/app/config.py` (repo không có bảng cấu hình chung; biến môi trường là cách "cấu hình" sẵn có, giống `PHAN_HE_BAT`).

Quyền (**dời sang Task 2.3**, ghi 13/11/2026 lúc làm đợt 1: guard `test_ma_tran_quyen_khop_thanh_ben.py` bắt mỗi module trong `MODULE_GROUPS` phải có mục sidebar trỏ tới màn có thật, mà màn Thuê gia công tới Task 2.3 mới có): module `thue_gia_cong` vào `seed.MODULES` (nhãn "Thuê gia công") và `MODULE_GROUPS` nhóm Sản xuất; mục sidebar "Thuê gia công" trong nhóm Sản xuất ngay sau "Lệnh sản xuất". Ô: Xem (`read`), Thao tác (`create`: tạo đơn, phiếu giao; `update`: sửa đơn, hoàn tất, tách việc), Huỷ (`cancel`), **Nhận hàng** dùng lại action `handover` (cột `can_handover` sẵn có) với nhãn "Nhận hàng" trên dòng này — dùng lại action theo luật repo, kiểm cách `PermissionMatrix` đặt nhãn cột theo module ở Task 1.1. Phạm vi `all` (noScope). Vai Kế hoạch SX được cấp đủ năm ô (Q7) — cấp qua seed vai mặc định chỉ khi `seed_demo`; DB dev cấp tay qua ma trận lúc bấm thử.

---

## Đợt 1 — Nền dữ liệu và "Nhà gia công tự lo"

**ERPNext tương ứng:** `bom_item.sourced_by_supplier` — `subcontracting_controller._get_materials_from_bom` lọc `sourced_by_supplier = 0` (`controllers/subcontracting_controller.py:801`), dòng tick không vào bảng vật tư cấp, không chuyển, không tiêu hao (`test_bom.py:498-528`).
**Cố ý khác:** định mức nằm ở dòng vật tư của bước lệnh, không có BOM gia công; mặc định **tick** (ERPNext mặc định 0) theo Q6 vì xưởng quen để nhà gia công lo; bước thuê ngoài giờ được bung vật tư như bước thường (trước đây bỏ qua hẳn).

### Task 1.1 — Bảng, cột, quyền, mã chứng từ

**Files:**
- Create: `backend/app/models/thue_gia_cong.py`; Modify: `backend/app/models/__init__.py`, `models/san_xuat.py` (thêm `tgc_viec_id`, chưa gỡ cột cũ), `models/lsx.py` (`LsxCongDoanVatTu.ncc_tu_lo`), `models/stock_request.py`, `models/delivery.py`
- Modify: `backend/app/db_migrations.py` (migration `NNNN_tgc_nen`: ADD COLUMN cho DB cũ — `lsx_cong_doan_vat_tu.ncc_tu_lo`, `san_xuat_cong_viec.tgc_viec_id`, ba cột `stock_requests`, `delivery_trips.tgc_phieu_nhan_id`, index unique một phần; bảng mới do `create_all` tạo)
- Modify: `services/sequence_service.py`, `config.py`, `audit_registry.py` (nhãn đích `tgc_don`, `tgc_phieu_giao`, `tgc_phieu_nhan`, `tgc_viec`), `docs/DB_SCHEMA.md` (phần `seed.py` MODULES và `PermissionMatrix.tsx` dời sang Task 2.3)
- Test: `backend/tests/test_tgc_nen.py`

- [ ] Viết test: `test_tao_bang_va_cot` (sau `create_all` có đủ 9 bảng `tgc_*`, cột `ncc_tu_lo` mặc định True), `test_mot_viec_mot_dong_song` (thêm hai `TgcDonDong` sống cùng `viec_id` ⇒ IntegrityError; dòng thứ nhất `huy_luc` có giá trị thì thêm được), `test_viec_dung_mot_nguon` (cả `lsx_id` lẫn `bai_ghep_id` ⇒ lỗi CHECK), `test_ma_chung_tu` (`generate_code("tgc_don")` bắt đầu `GC`), `test_ncc_tu_lo_mac_dinh_true`. (`test_module_quyen` dời sang Task 2.3.)
- [ ] Chạy `python -m pytest tests/test_tgc_nen.py -q` ⇒ đỏ.
- [ ] Viết model, migration, khai quyền, mã, DB_SCHEMA.
- [ ] Chạy lại test trên + `tests/test_schema_documented.py tests/test_audit_registry.py` ⇒ xanh. Khởi động lại uvicorn, xem log áp migration trên Postgres dev không lỗi.

### Task 1.2 — Bung vật tư cho bước thuê ngoài, kế hoạch vật tư bỏ dòng tự lo

**Files:**
- Modify: `backend/app/services/lsx_service.py` (`_bung_vat_tu_cong_doan` ~1811 và `_bung_lai_vat_tu` ~1766: bỏ `continue` của bước thuê ngoài; dòng sinh ra mang `ncc_tu_lo=True`; `:3888` và đường lưu bước nhận/ghi `ncc_tu_lo` từ payload dòng vật tư)
- Modify: `backend/app/services/ke_hoach_vat_tu_service.py` (`_gom_nhu_cau` ~1243: bỏ dòng của bước `thue_ngoai` có `ncc_tu_lo`; `buoc_nhan_tu` ~1405 cùng luật), `repositories/ke_hoach_vat_tu_repo.py` nếu truy vấn cần thêm cột; giữ chỗ (`giu_cho_service`) đi theo nhu cầu KHVT nên không sửa riêng — test kiểm
- Modify: `backend/app/schemas/lsx.py` (dòng vật tư của bước có `ncc_tu_lo`)
- Modify: `frontend/src/pages/LsxBuocDrawer.tsx` (khối vật tư của bước thuê ngoài thêm cột ô tick "Nhà gia công tự lo"; bước không thuê ngoài không hiện cột), `frontend/src/api/client.ts`
- Test: `backend/tests/test_tgc_vat_tu_tu_lo.py`

- [ ] Viết test: `test_buoc_thue_ngoai_van_bung_vat_tu` (lệnh có bước Cán màng thuê ngoài ⇒ bước có dòng màng, `ncc_tu_lo is True`), `test_khvt_bo_dong_tu_lo` (nhu cầu không có màng), `test_khvt_tinh_dong_xuong_cap` (đặt `ncc_tu_lo=False` qua PUT bước ⇒ nhu cầu có màng đúng số định mức), `test_giu_cho_nha_khi_tick_lai` (giữ chỗ đang bật, tick lại tự lo ⇒ dòng giữ chỗ của màng mất), `test_buoc_thuong_khong_doc_co` (bước máy có dòng `ncc_tu_lo=True` vẫn vào nhu cầu).
- [ ] Chạy test ⇒ đỏ; sửa code; chạy lại cùng `tests/test_ke_hoach_vat_tu_buoc_dau.py tests/test_lenh_vat_lieu_dau_vao.py tests/test_lsx_service.py -q` ⇒ xanh. `npx tsc --noEmit` xanh.
- [ ] Bấm thử: mở một lệnh nháp, tick Thuê ngoài một bước có công đoạn có vật tư, mở ngăn bước ⇒ thấy dòng vật tư và ô "Nhà gia công tự lo" đã tick; bỏ tick một dòng, lưu; mở Kế hoạch vật tư ⇒ dòng đó xuất hiện, dòng còn tick thì không.
- [ ] Tài liệu: cuốn Kế hoạch SX, mục vật tư của bước (grep "Thuê ngoài" trong `.tex`), thêm một đoạn về ô "Nhà gia công tự lo"; chụp lại ảnh ngăn bước nếu cuốn có ảnh đó.

Ghi lúc làm (13/11/2026), khác bản duyệt:
- `test_giu_cho_nha_khi_tick_lai` đổi thành `test_giu_cho_bo_dong_tu_lo`: lệnh đang giữ chỗ bị `_chan_dang_giu_cho` khoá sửa routing, nên "tick lại khi đang giữ chỗ" không xảy ra được; test kiểm hai lượt bật giữ chỗ trên hai trạng thái của dòng, nhả chỗ ở giữa.
- Thêm ngoài plan: `_soi_danh_muc` thôi miễn soi bước thuê ngoài (bước có dòng vật tư thật); `san_xuat/vat_tu_tu_lap.lap_khi_phat_hanh` bỏ qua công việc `loai_buoc = 'thue_ngoai'` (vật tư xưởng cấp đi theo phiếu giao đợt 4, không tự lập đề nghị lúc phát hành); `lsxBuoc.patchLoaiBuoc("thue_ngoai")` thôi xoá vật tư; `toBody` chỉ gửi `ncc_tu_lo` cho bước thuê ngoài.
- Dòng GIẤY ở bước thuê ngoài cũng mặc định tự lo (đúng Q6), nên giấy nằm ở bước thuê ngoài thì rời kế hoạch vật tư cho tới khi bỏ tick.
- Test cũ `test_gia_cong_buoc_lenh.py::test_buoc_thue_ngoai_lay_ten_tu_danh_muc_va_bo_to_may` sửa câu khẳng định "bước thuê ngoài không có vật tư" theo luật mới (file bị gỡ ở đợt 2).

**Dừng đợt 1, báo.**

---

## Đợt 2 — Cắt sang Việc gia công, gỡ module cũ, lệnh chỉ còn cờ, màn Hàng chờ

**ERPNext tương ứng:** cờ `is_subcontracted` trên BOM Operation đi xuống Work Order Operation rồi Job Card (`work_order/mapper.py:398,578`); thẻ thuê ngoài không có nút bắt đầu, hẹn giờ, ghi sản lượng (`job_card.js:215-218`); nút "Make Subcontracting PO" trên thẻ (`job_card/mapper.py:17-54`).
**Cố ý khác:** (a) SVN gom dải bước thuê ngoài liền nhau thành **một việc** (ERPNext mỗi thẻ một PO) — giữ luật đúng của bản cũ, nay gom theo "liền nhau cùng tick" vì lệnh không còn biết nhà gia công; (b) thay nút trên từng thẻ bằng **Hàng chờ** để gộp nhiều lệnh vào một đơn; (c) trọn gói không có tương đương trực tiếp (ERPNext mua cả thành phẩm qua Subcontracting BOM) — SVN giữ cơ chế gói một công việc không tổ để nhóm thành phẩm, nhập kho, giao hàng chạy nguyên đường; (d) không kho WIP của nhà gia công.

Vì sao gỡ module cũ ngay đợt này: nếu để song song thì phát hành, kế hoạch vật tư, KCS, kho, giao hàng phải đọc cả hai nguồn tới đợt cuối. Chuyển dữ liệu cũ sang bảng mới (đã có từ đợt 1) rồi gỡ một lần; dự án chưa có người dùng thật nên khoảng đợt 2–5 chưa nhận hàng được trên UI là chấp nhận được.

### Task 2.1 — Dịch vụ Việc gia công và ba cửa của Lệnh

**Files:**
- Create: `backend/app/services/thue_gia_cong/__init__.py` (`la_thue_ngoai(cv) -> bool` = `cv.tgc_viec_id is not None`; câu chặn `CHAN_XUONG` mới: "Công việc thuê gia công — giao nhận ở màn Thuê gia công, không làm ở Việc của tổ hay KCS."; `TgcXungDot`; `so_vi` chuyển từ module cũ), `services/thue_gia_cong/viec.py`, `services/thue_gia_cong/tron_goi.py`, `services/thue_gia_cong/thong_tin_lenh.py`
- Create: `backend/app/repositories/thue_gia_cong_repo.py`
- Modify: `services/san_xuat/release.py:104-106`, `release_update.py:390-489`, `thuc_thi.py:71-74,139`, `san_luong.py:264-267,471-474,537,579`, `kcs.py:211,353-356,769,1097-1100`, `ban_giao.py:123-135,305`, `routing_dai.py:177-210`, `repositories/ke_hoach_bo_phan_repo.py:48,75,132` (chỉ dòng điều kiện gia công; file của phiên khác), `kcs_checklist.py`, `kcs_bao_cao.py`, `vat_tu_tu_lap.py`, `repositories/san_xuat_kcs_repo.py:132-144`
- Test: `backend/tests/test_tgc_viec.py`, `backend/tests/test_tgc_tron_goi.py`

**Interfaces (đợt sau dùng):**
- `viec.sinh_khi_phat_hanh(db, *, lsx_ids: set[int], bai_ghep_ids: set[int], cv_by_step: dict, actor) -> list[TgcViec]` — không commit; quét dải bằng `_quet_dai_thue_ngoai` chuyển từ `gia_cong_ngoai/lan.py` (bỏ điều kiện cùng nhà gia công và lỗi "chưa chọn nhà gia công"), cùng `_canh_ke_tiep`, `_cap_ke_tiep_bai_ghep`; công việc của dải gắn `tgc_viec_id`, gỡ tổ + máy; `sl_can` = `so_luong_vao` của bước đầu dải, `don_vi` = `don_vi_ra` bước cuối.
- `viec.dong_bo_khi_cap_nhat(db, *, lsx_ids, bai_ghep_ids, actor) -> None` — việc chưa có dòng đơn sống: dải không đổi thì giữ, đổi thì xoá rồi sinh lại, trả công việc mồ côi về tổ/máy (`_phuc_hoi_cv_mo_coi`); việc có dòng đơn sống mà routing làm mất/đổi dải ⇒ `ValueError("Bước “X” đang nằm trong đơn GC-… — huỷ dòng đơn trước rồi phát hành lại.")`.
- `viec.xoa_viec_cua_goi(db, *, goi_id, actor) -> int` — gọi khi thu hồi gói; có việc thuộc dòng đơn sống ⇒ `ValueError` nêu mã đơn.
- `viec.tach_theo_buoc(db, *, user, viec_id, expected_version) -> list[TgcViec]` (Q5) — chỉ việc chưa vào dòng đơn sống và có ≥ 2 bước; mỗi bước một việc.
- `tron_goi.dat(db, *, user, lsx_id, sl_can: float, xuong_cap_giay: bool) -> TgcViec` — như `gia_cong_ngoai/tron_goi.dat_tron_goi` nhưng không nhà gia công; `tron_goi.huy(db, *, user, viec_id, expected_version, ly_do) -> None` — có dòng đơn sống thì chặn; `tron_goi.chan_tron_goi` chuyển nguyên.
- `thong_tin_lenh.cua_nhieu(db, lsx_ids: set[int]) -> dict[int, dict]` khoá `lsx_id, lsx_ma, khach_hang, don_hang_ma, mat_hang, han_giao`; `thong_tin_lenh.cua_viec(db, viecs) -> dict[int, list[dict]]` (bài ghép trả nhiều lệnh).

- [ ] Viết test: `test_phat_hanh_sinh_mot_viec_cho_dai_lien_nhau` (In máy → Cán màng ngoài → Bế ngoài → Dán máy ⇒ đúng 1 việc "Cán màng + Bế", `sl_can` = số vào của Cán màng, `don_vi` = đơn vị ra của Bế), `test_buoc_thuong_chen_giua_tach_viec` (Cán ngoài → Bế máy → Dán ngoài ⇒ 2 việc), `test_hai_nhanh_song_song_khong_gop` (hai bước thuê ngoài thuộc hai nhánh DAG ⇒ 2 việc), `test_cap_nhat_giu_viec_da_dat` (việc có dòng đơn sống, cập nhật routing đổi bước khác ⇒ việc giữ nguyên), `test_cap_nhat_chan_khi_mat_buoc_da_dat` (bỏ tick bước đã vào đơn ⇒ lỗi nêu mã đơn), `test_thu_hoi_xoa_viec_chua_dat` / `test_thu_hoi_chan_viec_da_dat`, `test_tach_theo_buoc`, `test_xuong_chan_cong_viec_thue_ngoai` (bắt đầu/ghi mẻ/KCS trên công việc có `tgc_viec_id` ⇒ lỗi `CHAN_XUONG`), `test_ban_giao_sang_viec_thue_ngoai_khong_xac_nhan_tay` (`ban_giao.xac_nhan` ⇒ lỗi "nhận bằng Phiếu giao ở màn Thuê gia công"); `test_tron_goi.py`: `test_dat_tron_goi_sinh_goi_va_viec`, `test_huy_tron_goi_chua_dat_ve_nhap`, `test_huy_tron_goi_da_dat_bi_chan`, `test_tron_goi_khong_vao_xep_lich`, `test_lenh_bai_ghep_khong_tron_goi`.
- [ ] Chạy ⇒ đỏ; viết code; chạy lại cùng `tests/test_phat_hanh_cap_nhat_to_may.py tests/test_san_xuat_dai_duoi.py tests/test_xep_lich_lenh_trai_lich.py tests/test_tuyen_lenh_chan_luu.py -q` ⇒ xanh.

### Task 2.2 — Chuyển dữ liệu cũ và gỡ module cũ ở backend

**Files:**
- Modify: `backend/app/db_migrations.py` — migration `NNNN_tgc_chuyen_du_lieu_cu` rồi `NNNN_tgc_go_gia_cong_ngoai`
- Delete: `models/gia_cong_ngoai.py`, `services/gia_cong_ngoai/` (cả thư mục), `repositories/gia_cong_ngoai_repo.py`, `routers/gia_cong_ngoai.py`, `schemas/gia_cong_ngoai.py`; bỏ include ở `main.py:83,252`
- Modify (đổi chỗ đọc sang bảng mới; danh sách đủ ở báo cáo kiểm kê, các dòng chính): `models/san_xuat.py` (gỡ `gia_cong_ngoai_id`), `models/accounting.py` (gỡ cột + index `uq_payment_voucher_gia_cong_ngoai`), `models/stock_request.py`, `models/delivery.py`, `services/accounting_service.py` (nhánh gia công tạm trả lỗi "Lập phiếu chi ở màn Thuê gia công" tới đợt 6), `repositories/accounting_repo.py:1510`, `services/cong_no_khoa_ky.py:48`, `services/lsx_service.py` (`_co_tron_goi`, `tom_tat_theo_lenh`, kiểm `thieu_nha_gia_cong` ~2049 bỏ, PUT routing ~4122 bỏ nhận `nha_cung_cap_id`), `lsx_tong_quan.py:261`, `lsx_nhat_ky.py` + `repositories/lsx_nhat_ky_repo.py` (đọc đích `tgc_*`), `ke_hoach_vat_tu_service.py:1230-1299,1399` (trọn gói đọc `tgc_viec`, đề nghị xuất giấy theo `stock_requests.tgc_phieu_giao_id`), `don_hang_san_xuat.py`, `delivery_service.py:2346`, `repositories/delivery_repo.py:317,333`, `lenh_sx/danh_sach.py`, `lenh_sx/theo_doi.py`, `lenh_sx/theo_doi_don.py`, `lenh_sx/ho_so.py`, `san_xuat/kho.py:310,356,400` (tham số `tgc_phieu_nhan_id`), `bai_ghep_service.py:1083-1102,2153-2160`, `repositories/{lsx_repo,order_repo,nguon_phieu_kho_repo,stock_request_repo}.py`, `routers/{lsx,lenh_san_xuat,orders,delivery,kho_request,kho_baocao,accounting}.py` + schemas tương ứng, `realtime.py`
- Move: `ghi_kcs_ngoai_phan_mem` xoá hẳn (Q4: không KCS tổng hợp nữa)
- Test: `backend/tests/test_tgc_chuyen_du_lieu.py`; Delete: 16 file test thuần module cũ (`test_gia_cong_{bai_ghep_api,bai_ghep_chot,bai_ghep_du_lieu,bai_ghep_phat_hanh,chot_cuoi,chot_xuong,goi_y_chot,hien_thi,loc_khsx,mang_di,ngoai_du_lieu,phat_hanh,phieu_chi,tron_goi}.py`, `test_nguon_yeu_cau_gia_cong.py`, `test_san_xuat_dong_lenh_bai_ghep_gcn.py`); sửa các test hỗn hợp theo bảng mới

Luật chuyển dữ liệu (SQL `text()`, chạy khi bảng `gia_cong_ngoai` còn; DB trắng là no-op):
1. Lần đã huỷ: bỏ, công việc (nếu còn trỏ) giữ nguyên như hiện có. Audit `gia_cong_ngoai:<id>` giữ trong `audit_logs`.
2. Mỗi lần sống ⇒ một `tgc_viec` (nguồn, kiểu, `ten_viec`, `sl_can` = `sl_dat` hoặc `so_luong_vao` công việc đầu, `don_vi`, `xuong_cap_giay`); `san_xuat_cong_viec.tgc_viec_id` chép từ `gia_cong_ngoai_id`.
3. Mỗi lần sống ⇒ một `tgc_don` (mã sinh qua bảng đếm `document_sequences` cùng năm của `created_at`, nhà gia công + tên chụp, `ngay_dat` = `created_at`, `dat_luc` = `created_at`) + một `tgc_don_dong` (`sl_dat` = `sl_dat` hoặc `sl_gui` hoặc `sl_can`, `don_gia` = 0).
4. `mang_di_luc` có ⇒ `tgc_phieu_giao` (`giao_luc` = `mang_di_luc`, người = `mang_di_boi_id`) + dòng bán thành phẩm: mỗi bàn giao đã xác nhận vào công việc đầu một dòng (`ban_giao_id`), không có bàn giao thì một dòng `sl_gui`.
5. Trọn gói có `stock_requests.gia_cong_ngoai_id` loại XUAT ⇒ `tgc_phieu_giao` + dòng vật tư giấy theo dòng đề nghị; `stock_requests.tgc_phieu_giao_id` chép.
6. `chot_luc` có ⇒ `tgc_phieu_nhan` (`nhan_luc` = `chot_luc`, người = `chot_boi_id`) + dòng (`sl_dat` = `sl_cuoi`, `sl_hong` = 0, `noi_ve`, `don_gia` 0, `batch_id` = mẻ duy nhất trên công việc cuối); dòng đơn `hoan_tat_luc` = `chot_luc`, `hao_hut` = giao quy đổi − `sl_cuoi` (trọn gói null). Đề nghị nhập (`stock_requests.gia_cong_ngoai_id` loại NHAP) ⇒ `tgc_phieu_nhan_id`; `delivery_trips` ⇒ `tgc_phieu_nhan_id`.
7. `payment_vouchers.gia_cong_ngoai_id` có ⇒ `tgc_phieu_chi_nhan` (`amount_vnd` = `amount_vnd` của phiếu).
Migration gỡ: DROP index `uq_payment_voucher_gia_cong_ngoai` (cả `DROP INDEX IF EXISTS` lẫn `DROP CONSTRAINT IF EXISTS`), DROP COLUMN `gia_cong_ngoai_id` ở bốn bảng, DROP TABLE `gia_cong_ngoai`. SQLite test: bỏ qua DROP COLUMN nếu phiên bản không hỗ trợ, như các migration gỡ cột cũ trong file.

- [ ] Viết test `test_tgc_chuyen_du_lieu.py`: dựng bảng `gia_cong_ngoai` bằng DDL thô trong SQLite (model đã gỡ) với 4 lần mẫu khớp DB dev (trọn gói có đề nghị xuất, trọn gói chưa đề nghị, một phần đã chốt về xưởng, một phần huỷ), gọi hàm migration, assert: 3 việc, 3 đơn `don_gia` 0, phiếu giao giấy trỏ đúng đề nghị, phiếu nhận 250 về xưởng, dòng đơn LSX26-0007 hoàn tất `hao_hut` 0, không còn bảng/cột cũ.
- [ ] Gỡ code, đổi chỗ đọc; `python -c` KHÔNG dùng để thử migration — chỉ khởi động lại uvicorn trên dev sau khi đã `pg_dump` (`svn_erp_trong-truoc-tgc-<ngày>.dump`, ngoài repo) rồi đếm lại: `tgc_viec` 3, `tgc_don` 3, `tgc_phieu_nhan` 1, `gia_cong_ngoai` không còn.
- [ ] **Điểm dừng (góp ý giám sát):** sau khi `pg_dump`, chạy migration và đếm lại, dừng lượt, báo số đếm + đường dẫn file dump. Giám sát kiểm xong mới làm Task 2.3. DB `svn_erp_trong` dùng chung với phiên khác.
- [ ] Chạy: các test đợt 2 + test hỗn hợp đã sửa (`test_don_hang_san_xuat test_giao_hang_ngan_luot test_ke_hoach_vat_tu_buoc_dau test_lenh_vat_lieu_dau_vao test_lenh_sx_api test_theo_doi_theo_may test_broadcast_theo_doi_tuong test_cham_do_sua_chua_phieu_chi test_bao_cao_thu_chi test_phieu_muc_thu_chi test_loc_danh_sach_bao_cao test_loc_danh_sach_kho test_loc_danh_sach_san_xuat test_xep_lich_trai_cum test_kho_sx_e2e2510 test_lsx_service test_schema_documented test_audit_registry`) ⇒ xanh.

**Lệch so với plan khi làm Task 2.1 + 2.2 (13/11/2026):**
- Task 2.1 và 2.2 làm gộp một lượt: conftest import `chot.py` cũ (dùng `ghi_kcs_ngoai_phan_mem` đã xoá) nên không chạy được test nào khi module cũ còn nửa vời.
- Migration mang số `0480_tgc_chuyen_du_lieu_cu` và `0481_tgc_go_gia_cong_ngoai`. mg `0339` vá: DB trắng (không có bảng `gia_cong_ngoai`) thì thêm cột INTEGER trơn, để mg 0372/0373 vẫn chạy, rồi 0481 gỡ.
- Mã audit mới: `tgc_viec_sinh`, `tgc_viec_xoa`, `tgc_viec_tach`, `tgc_tron_goi_dat`, `tgc_tron_goi_huy` (đã khai nhãn ở Task 2.2, không chờ Task 3.1).
- Lệnh và bài ghép thôi chọn nhà gia công: `nha_cung_cap_id` gửi lên bị bỏ qua, gộp bài không chép nhà, bỏ "thiếu nhà gia công"/"Chưa chọn nhà gia công". Cột `nha_cung_cap*` để lại tới đợt 7.
- Tóm tắt trên danh sách lệnh (`LsxListGiaCong`): trạng thái `chua_dat | da_dat | da_xong`, thêm `ma_don`, `so_lan*` đổi thành `so_viec*`, bỏ `cho_cap_giay` (chip cấp giấy làm lại theo phiếu giao ở đợt 4). Ô lọc lệnh `gia_cong` nhận `chua_dat | da_dat | tron_goi`.
- Theo dõi theo máy: nhóm "Thuê gia công", dòng theo nhà của đơn đang mở, việc chưa đặt gom dưới "Chưa đặt nhà gia công"; trạng thái `cho_giao` (thay `cho_mang_di`) và `o_nha_gia_cong` khi đơn có phiếu giao sống.
- Test chuyển sang đợt sau vì phụ thuộc phiếu nhận/hàng chờ trả tiền: 5 bài giao thẳng của `test_giao_hang_ngan_luot.py` (bản gốc lưu ở ghi chú chung `tgc-test-giao-thang-cho-dot-5.py`) và phần giao thẳng của `test_don_hang_san_xuat::test_tron_goi_dang_o_nha_gia_cong` ⇒ đợt 5; `test_cham_do_sua_chua_phieu_chi::test_gia_cong_chot_bao_nguoi_lap_phieu_chi` ⇒ đợt 6.
- Migration test bắt hai lỗi SQL thô trước khi chạy trên dev: `stock_requests` không có `created_by` (là `nguoi_tao_id`), `loai` lưu `XUAT`/`NHAP` hoa; bảng mẻ là `san_xuat_batch`.

### Task 2.3 — Frontend: lệnh chỉ còn cờ, màn Thuê gia công khung + Hàng chờ

**Files:**
- Delete: `frontend/src/pages/gia-cong/` sau khi chuyển `ChungTuKhoNoi.tsx` sang `frontend/src/components/ChungTuKhoNoi.tsx` (đang được `giao-hang/.../NganLuot.tsx:64` và `ThsxExecPanels.tsx:30` dùng)
- Modify: `seed.py` (MODULES `thue_gia_cong`), `PermissionMatrix.tsx` (`MODULE_GROUPS`), test `test_module_quyen` — dời từ Task 1.1; `LsxDetailView.tsx` (gỡ `GiaCongNgoaiPanel`, nút trọn gói mở `TronGoiDialog` mới), `LsxBuocDrawer.tsx` (gỡ `NhaGiaCongCard`/`ChonNhaGiaCong`), `LsxRoutingTable.tsx` (cột trạng thái chỉ đọc cho bước thuê ngoài), `BaiGhep2Page.tsx`, `BaiGhepBuocChungForm.tsx`, `KeHoachSXPage.tsx`, `LenhSxNgan.tsx`, `LenhSanXuatPage.tsx`, `TdsxNganDon.tsx`, `lsxRoutingDoc.tsx`, `tdsxDon.ts`, `giao-hang/tien-do-don/monSanXuat.ts`, `kcs/{KcsGhiLoiGiua,KcsKiemForm,KcsSoDoNhom}.tsx`, `khoNganA.tsx`, `ke-toan/phieu-chi/*` (gỡ hàng chờ cũ tới đợt 6), `loc-san-xuat/*`, `loc-kinh-doanh/dieu-kien-don-hang.ts`, `lib/suKienNhom.ts`, `components/AppShell.tsx`, `api/client.ts` (gỡ `api.giaCongNgoai`, thêm `api.thueGiaCong`), `components/Sidebar.tsx`, router app
- Create: `frontend/src/pages/thue-gia-cong/ThueGiaCongPage.tsx` (6 tab: Hàng chờ, Đơn gia công, Phiếu giao, Phiếu nhận, Hàng đang ở ngoài, Chờ trả tiền — tab chưa làm hiện trống tới đợt của nó), `HangChoTab.tsx`, `TronGoiDialog.tsx` (ô "Xưởng cấp giấy" + số lượng, mặc định SL lệnh; chọn khổ giấy chuyển sang phiếu giao), `TrangThaiBuocNgoai.tsx` (chip chỉ đọc dùng ở lệnh), `tgc.ts` (+ `tgc.test.ts`), `thue-gia-cong.css`
- Backend: `routers/thue_gia_cong.py` + `schemas/thue_gia_cong.py`: `GET /api/thue-gia-cong/hang-cho` (page, size, q, tinh_trang ∈ `san_sang_giao|cho_buoc_truoc|chua_dat`; trả `facets`), `POST /viec/{id}/tach-theo-buoc`, `GET /nha-gia-cong`, `GET /lenh/{lsx_id}` (trạng thái từng bước thuê ngoài: "Chưa đặt" / "Đã đặt GC-…, hẹn …" / "Đang ở <NCC> x/y" / "Xong x (hụt z)" + `don_id`), `POST /lenh/{lsx_id}/tron-goi`, `POST /viec/{id}/huy-tron-goi`
- Test: `backend/tests/test_tgc_hang_cho_api.py`

- [ ] Viết test API: `test_hang_cho_chi_hien_viec_chua_dat` (việc đã vào dòng đơn sống rụng khỏi hàng chờ), `test_hang_cho_tinh_trang` (bước trước đã đề xuất bàn giao ⇒ `san_sang_giao`; dải đầu lệnh ⇒ `san_sang_giao`; trọn gói ⇒ `chua_dat`), `test_hang_cho_co_thong_tin_lenh` (mỗi dòng có khách hàng, mã đơn, mặt hàng, hạn giao; bài ghép có danh sách lệnh), `test_quyen_hang_cho` (không có `thue_gia_cong:read` ⇒ 403), `test_trang_thai_buoc_tren_lenh`.
- [ ] Chạy ⇒ đỏ; viết; chạy lại ⇒ xanh; `npx tsc --noEmit` và `npx vitest run src/pages/thue-gia-cong` xanh.
- [ ] Bấm thử: lệnh có bước thuê ngoài — ngăn bước không còn ô nhà gia công; Phát hành; mở Thuê gia công › Hàng chờ thấy việc với đủ khách, đơn, mặt hàng, hạn giao, tình trạng "Chờ bước trước"; ở Việc của tổ, tổ bước trước ghi sản lượng và bàn giao ⇒ hàng chờ tự đổi "Sẵn sàng giao" không cần F5 và người có quyền nhận toast; lệnh nháp khác bấm "Thuê gia công trọn gói", tick Xưởng cấp giấy, xác nhận ⇒ lệnh "Đã phát hành", hàng chờ có việc trọn gói "Chưa đặt"; huỷ trọn gói ⇒ lệnh về Nháp, việc rụng. Kiểm dữ liệu chuyển: LSX26-0007 hiện "Xong 250".
- [ ] Tài liệu: viết lại `\section{Gia công ngoài}` (cuốn Kế hoạch SX, dòng ~776) thành "Thuê gia công" phần Lệnh (cờ, trọn gói, trạng thái chỉ đọc) + Hàng chờ; giữ `\label{gia-cong}` và các label con nếu còn đích (kiểm `kich-ban/kiem-lien-ket.py`); viết lại kịch bản `kich-ban/c06-gia-cong.mjs`, chụp lại `khsx-50/51/52`; cuốn Việc của tổ: câu chặn mới; biên dịch 2 lần.

**Dừng đợt 2, báo.**

---

## Đợt 3 — Đơn gia công

**ERPNext tương ứng:** Purchase Order (gia công) + Subcontracting Order (`subcontracting_order.py:53-101`): đầu đơn `supplier`, `schedule_date`; dòng mang `job_card`, `qty`, `rate`; một đơn nhiều thẻ/nhiều lệnh (`:338-346`); trạng thái tính lại mỗi lần giao/nhận (`update_status :416-452`); huỷ bị chặn khi còn phiếu kho/phiếu nhận đã gửi (linked-doc check).
**Cố ý khác:** gộp PO + SCO thành một chứng từ; không `supplier_warehouse`; đơn giá gõ trên dòng (thay service item + Subcontracting BOM), gợi ý đơn giá lần trước cùng NCC + tên việc; trạng thái **dẫn xuất**, không lưu (Nháp → Đã đặt → Đã giao một phần/đủ → Đã về một phần → Hoàn tất; Huỷ); "Close" của ERPNext đóng cả đơn, SVN **Hoàn tất từng dòng** (đợt 5) vì một đơn gộp nhiều lệnh về khác ngày; sửa đơn giá sau khi đặt được (ghi nhật ký) và chỉ ảnh hưởng phiếu nhận lập sau (phiếu nhận chụp đơn giá như `rate` của receipt item).

### Task 3.1 — Backend đơn

**Files:** Create `services/thue_gia_cong/don.py`; Modify `routers/thue_gia_cong.py`, `schemas/thue_gia_cong.py`, `repositories/thue_gia_cong_repo.py`, `audit_registry.py` (`tgc_don_tao`, `tgc_don_dat`, `tgc_don_sua`, `tgc_don_sua_don_gia`, `tgc_don_huy`, `tgc_viec_tach`, `tgc_tron_goi_dat`, `tgc_tron_goi_huy`); Test `backend/tests/test_tgc_don.py`

**Interfaces:**
- `don.tao(db, *, user, nha_cung_cap_id, ngay_dat: date, ngay_hen_ve: date | None, ghi_chu, dong: list[{viec_id, sl_dat, don_gia}], dat: bool) -> TgcDon` — NCC phải `nhan_gia_cong` và đang hoạt động; khoá dòng các việc; việc đã có dòng sống ⇒ `TgcXungDot`.
- `don.sua(db, *, user, don_id, expected_version, ...) -> TgcDon` — Nháp sửa mọi thứ; đã đặt chỉ sửa `ngay_hen_ve`, `ghi_chu`, `don_gia`, `sl_dat`, thêm/bớt dòng chưa có phiếu giao/nhận.
- `don.dat(...)`, `don.huy(db, *, user, don_id, expected_version, ly_do)` — có phiếu giao hoặc phiếu nhận còn sống ⇒ chặn, nêu mã phiếu; huỷ chép `huy_luc` xuống dòng (việc về hàng chờ).
- `don.trang_thai(don, dongs, so_lieu) -> str`, `don.don_dict(db, don) -> dict` (dòng kèm thông tin lệnh, đã giao, đã nhận đạt/hỏng, còn ngoài, tạm tính đã nhận, lịch sử audit).
- `don.goi_y_don_gia(db, nha_cung_cap_id, ten_viec) -> float | None`.
- Router: `GET /don` (ThanhLoc: `tu_ngay`, `den_ngay`, `moc`, `q`, `trang_thai`, `nha_cung_cap_id`, page/size, `facets`), `POST /don`, `GET /don/{id}`, `PUT /don/{id}`, `POST /don/{id}/dat`, `POST /don/{id}/huy`, `GET /goi-y-don-gia`. Ghi: `create`; sửa: `update`; huỷ: `cancel`. SSE `tgc_changed {don_id, lsx_ids}` sau commit.

- [ ] Test: `test_tao_don_gop_hai_lenh`, `test_khong_dat_viec_hai_lan`, `test_ncc_khong_nhan_gia_cong_bi_chan`, `test_sua_don_gia_sau_dat_ghi_nhat_ky`, `test_huy_don_tra_viec_ve_hang_cho`, `test_huy_don_co_phieu_giao_bi_chan` (dựng phiếu giao bằng model), `test_trang_thai_dan_xuat` (bảng tham số các tổ hợp), `test_goi_y_don_gia_lan_truoc`, `test_trang_thai_buoc_lenh_da_dat` ("Đã đặt GC-…, hẹn dd/mm").
- [ ] Đỏ → viết → xanh (cùng `test_tgc_hang_cho_api.py`).

### Task 3.2 — Frontend đơn

**Files:** Create `pages/thue-gia-cong/TaoDonDialog.tsx` (từ Hàng chờ tick nhiều việc → chọn NCC, ngày đặt, hẹn về, số đặt điền sẵn, đơn giá kèm gợi ý, tạm tính; Lưu nháp / Đặt hàng), `DonTab.tsx` (lưới ThanhLoc), `DonNgan.tsx` (ngăn: đầu ngăn mã, NCC, trạng thái; tab Dòng đơn / Phiếu giao / Phiếu nhận / Lịch sử; nút Giao hàng, Nhận hàng để trống tới đợt 4–5); Modify `HangChoTab.tsx` (tick + "Tạo đơn gia công (n việc)", nút "Tách theo bước"), `TrangThaiBuocNgoai.tsx` (link mở đơn)

- [ ] `npx tsc --noEmit` + vitest `tgc.test.ts` (hàm tạm tính, nhãn trạng thái) xanh.
- [ ] Bấm thử: Hàng chờ tick hai việc của hai lệnh → Tạo đơn → chọn Minh Phát, gõ đơn giá 600, hẹn về → Đặt hàng ⇒ thấy GC26-xxxx, hai việc rụng khỏi hàng chờ, lệnh hiện "Đã đặt GC26-xxxx, hẹn …" (mở lệnh ở tab khác, tự đổi); sửa đơn giá trong ngăn ⇒ tab Lịch sử có dòng; huỷ đơn có lý do ⇒ việc quay lại hàng chờ; tách một việc hai bước ⇒ hai dòng.
- [ ] Tài liệu: thêm mục "Đơn gia công"; chụp ảnh tạo đơn và ngăn đơn.

**Dừng đợt 3, báo.**

---

## Đợt 4 — Phiếu giao

**ERPNext tương ứng:** `make_rm_stock_entry` / Stock Entry "Send to Subcontractor" (`subcontracting_controller.py:1627-1750`): điền sẵn theo bảng vật tư cấp (`required_qty − total_supplied`), cộng ngược `supplied_qty` lên đơn (`stock_entry/services/subcontracting.py:183-266`); nhiều lần gửi.
**Cố ý khác:** không chuyển kho sang kho nhà gia công — vật tư đi qua **đề nghị xuất kho** thường mang `tgc_phieu_giao_id`, kho lập phiếu xuất như mọi đề nghị; bán thành phẩm **không qua kho** (SVN không theo dõi tồn bán thành phẩm từ 17/09, mg 0308) — số lấy đúng bàn giao của tổ bước trước, không gõ tay, lưu phiếu = xác nhận các bàn giao đó (thay nút "Đã mang đi"); dải đứng đầu lệnh thì gõ số; không chặn vượt định mức vật tư (ERPNext chặn theo over-transfer allowance) — chỉ cảnh báo, vì bù hao thực tế do người giao quyết; huỷ phiếu giao được khi kho chưa lập phiếu xuất và chưa có phiếu nhận sau nó (ERPNext huỷ Stock Entry tương tự).

### Task 4.1 — Backend phiếu giao

**Files:** Create `services/thue_gia_cong/phieu_giao.py`; Modify router/schemas/repo, `services/san_xuat/ban_giao.py` (`ket_qua_cho_ben_nhan` khi đích là công việc thuê ngoài: sự kiện `tgc_san_sang_giao`, báo người có `thue_gia_cong:create`), `audit_registry.py` (`tgc_phieu_giao_tao`, `tgc_phieu_giao_huy`); chọn khổ giấy C1 chuyển từ `gia_cong_ngoai/tron_goi.py` (`_de_xuat_giay`, `de_xuat_tu_quy_cach`, `goi_y_cap_giay`) sang `services/thue_gia_cong/giay.py`; Test `backend/tests/test_tgc_phieu_giao.py`

**Interfaces:**
- `phieu_giao.du_lieu_moi(db, don_id) -> dict` — mỗi dòng đơn chưa hoàn tất: dòng bán thành phẩm (mỗi bàn giao đang chờ vào công việc đầu việc một dòng, số khoá; dải đầu lệnh: ô gõ), dòng vật tư = dòng `lsx_cong_doan_vat_tu` có `ncc_tu_lo = False` của các bước trong dải (số điền sẵn = định mức − đã giao trước đó, kèm "đã giữ chỗ"), trọn gói xưởng cấp giấy: khối chọn khổ C1.
- `phieu_giao.lap(db, *, user, don_id, expected_version, dong: list[...], ghi_chu) -> TgcPhieuGiao` — đơn phải Đã đặt; `ban_giao.ghi_xac_nhan` cho từng bàn giao; một đề nghị XUẤT cho mọi dòng vật tư (dòng mang `lsx_id`), `stock_requests.tgc_phieu_giao_id`; báo kho sau commit; giữ chỗ nhả/giữ lại như `de_nghi_xuat_giay` cũ.
- `phieu_giao.huy(db, *, user, phieu_id, expected_version, ly_do)` — chặn khi đề nghị xuất đã có phiếu kho, hoặc đơn đã có phiếu nhận sống lập sau phiếu giao này; huỷ được thì huỷ đề nghị xuất và trả các bàn giao về `BG_DE_XUAT` (việc lại "Sẵn sàng giao").
- Router: `GET /don/{id}/phieu-giao/moi`, `POST /don/{id}/phieu-giao`, `GET /phieu-giao` (ThanhLoc), `GET /phieu-giao/{id}` (kèm trạng thái kho từng dòng, mã phiếu xuất), `POST /phieu-giao/{id}/huy`.
- Đổi ý tự lo sau khi đã xuất: PUT bước lệnh tick lại `ncc_tu_lo` trên dòng đã có phiếu giao dòng vật tư còn sống ⇒ chặn "Đã giao vật tư này cho nhà gia công — trả kho lúc Hoàn tất" (thêm vào đường lưu bước ở `lsx_service`).

- [ ] Test: `test_dien_san_ban_thanh_pham_theo_ban_giao`, `test_khong_go_tay_khi_co_ban_giao`, `test_dai_dau_lenh_go_so`, `test_vat_tu_xuong_cap_thanh_de_nghi_xuat` (đề nghị có dòng màng, mang `tgc_phieu_giao_id` và `lsx_id`), `test_vat_tu_tu_lo_khong_co_dong`, `test_giay_tron_goi_chon_kho`, `test_don_nhap_khong_giao_duoc`, `test_huy_phieu_giao_tra_ban_giao_ve_cho`, `test_huy_phieu_giao_kho_da_xuat_bi_chan`, `test_chan_doi_y_tu_lo_sau_khi_giao`, `test_toast_san_sang_giao` (kết quả bàn giao có `notify_user_ids` là người có quyền tạo).
- [ ] Đỏ → viết → xanh (cùng `test_tgc_don.py`, `test_ke_hoach_vat_tu_buoc_dau.py`).

### Task 4.2 — Frontend phiếu giao

**Files:** Create `PhieuGiaoForm.tsx` (mở từ nút "Giao hàng" của ngăn đơn; hai khối Bán thành phẩm / Vật tư từ kho; khối giấy C1), `PhieuGiaoTab.tsx` (lưới), ngăn phiếu giao (dòng, trạng thái kho, Huỷ); Modify `DonNgan.tsx`

- [ ] tsc + vitest xanh.
- [ ] Bấm thử: tổ in bàn giao 1.660 sang bước thuê ngoài → toast "Sẵn sàng giao" ở người phụ trách → mở đơn → Giao hàng ⇒ số 1.660 khoá, dòng màng 66 điền sẵn, sửa 70 → Lưu ⇒ GG26-xxxx; Yêu cầu nhập xuất có đề nghị xuất màng mang mã phiếu giao; thủ kho lập phiếu xuất ⇒ ngăn phiếu giao đổi trạng thái kho tự động; lệnh hiện "Đang ở Minh Phát …". Trọn gói xưởng cấp giấy: chọn khổ, số tờ ⇒ đề nghị xuất giấy.
- [ ] Tài liệu: mục "Phiếu giao"; ảnh form; cuốn Việc của tổ: bàn giao sang bước thuê ngoài do màn Thuê gia công nhận.

**Dừng đợt 4, báo.**

---

## Đợt 5 — Phiếu nhận, Hoàn tất, Hàng đang ở ngoài

**ERPNext tương ứng:** Subcontracting Receipt (`subcontracting_receipt_item.json`: `received_qty`, `qty`, `rejected_qty`, `rate`), nhiều phiếu một đơn, chặn nhận vượt (`status_updater.py:537-586`); `update_job_card` → `JobCard.set_manufactured_qty` → bước sau được làm khi đã có số (`job_card.py:312-331, 1942-1990`); trả vật tư dư `make_return_stock_entry_for_subcontract` (`controller:1775-1843`); Close (`subcontracting_order.py:720-733`).
**Cố ý khác:** hàng hỏng không vào kho hỏng (không tồn bán thành phẩm) — chỉ ghi số; **không tự trừ vật tư theo định mức** (ERPNext backflush) — đối chiếu đưa đi / trả về / dùng hết lúc Hoàn tất; thêm nơi về **khách** (giao thẳng) và chia bài ghép theo số con/tờ; công việc trên lệnh chỉ **Hoàn thành khi bấm Hoàn tất dòng**, không tự theo số (hao hụt luôn có, cấm so số kế hoạch); bàn giao cho bước sau theo từng phiếu nhận để tổ sau làm dần; chặn người đã giao tự nhận (ERPNext không có, Q2); về kho không KCS phần mềm (Q4).

### Task 5.1 — Backend phiếu nhận

**Files:** Create `services/thue_gia_cong/phieu_nhan.py`, `services/thue_gia_cong/noi_ve.py` (chuyển `noi_ve_hop_le`, `nhanh_bai_ghep`, `chia_theo_lenh`, các nhánh `_ve_xuong`/`_ve_kho`/`_ve_khach`/`_ve_toa`/`_ve_kho_tung_lenh` và hàm gỡ tương ứng từ `gia_cong_ngoai/chot.py` của git HEAD, bỏ mọi `ghi_kcs_ngoai_phan_mem`), `services/thue_gia_cong/giao_thang.py` (từ `gia_cong_ngoai/giao_thang.py` HEAD, khoá `tgc_phieu_nhan_id`); Modify router/schemas/repo, `config.py`, `audit_registry.py` (`tgc_phieu_nhan_tao`, `tgc_phieu_nhan_huy`); Test `backend/tests/test_tgc_phieu_nhan.py`, `backend/tests/test_tgc_phieu_nhan_bai_ghep.py`

Code cũ đã xoá ở đợt 2; lấy lại bằng `git show HEAD:backend/app/services/gia_cong_ngoai/chot.py` (HEAD lúc đó vẫn là bản trước đợt 2 nếu chưa commit; nếu đã commit thì dùng commit trước đợt 2).

**Interfaces:**
- `phieu_nhan.du_lieu_moi(db, don_id) -> dict` — dòng đơn chưa hoàn tất: còn ngoài (đơn vị nhận), nơi về hợp lệ, bước sau (nhiều nhánh thì danh sách), bảng chia theo lệnh (bài ghép).
- `phieu_nhan.lap(db, *, user, don_id, expected_version, dong: list[{don_dong_id, sl_dat, sl_hong, noi_ve, dich_cong_viec_id?, ngay_khach_nhan?}], ghi_chu) -> TgcPhieuNhan` — quyền: `thue_gia_cong:handover`, hoặc dòng về xưởng và người lập có quyền Xác nhận sản lượng ở tổ bước nhận; `TGC_CHAN_NGUOI_GIAO_TU_NHAN` bật thì người đã lập phiếu giao sống của đơn bị chặn; một phần: Σ(đạt+hỏng) quy đổi không vượt còn ngoài (giao × `so_luong_ra` bước cuối ÷ `so_luong_vao` bước đầu, làm tròn lên); trọn gói không chặn theo giao, nhưng Σ(đạt+hỏng) các phiếu nhận vượt `sl_dat` của dòng đơn thì **cảnh báo, không chặn** (bám `over_delivery_receipt_allowance` của ERPNext nhưng mềm vì ngành in hay in dư) — câu cảnh báo trả trong `du_lieu_moi`/kết quả lập và hiện trên form nhận; mỗi dòng một `SanXuatBatch` (tot = đạt, hong = hỏng) trên công việc cuối rồi rẽ nhánh nơi về; về xưởng: người nhận có quyền xác nhận ở tổ đích thì bàn giao tạo ở trạng thái đã xác nhận, không thì đề xuất chờ tổ; về kho: `sx_kho.lap_yeu_cau_nhap_tp(..., tgc_phieu_nhan_id=...)`; khách: giao thẳng; chụp `don_gia`.
- `phieu_nhan.huy(db, *, user, phieu_id, expected_version, ly_do)` — chặn khi: có phiếu chi còn hiệu lực, dòng đơn đã hoàn tất, tổ đích đã xác nhận bàn giao / đã ghi mẻ trên số toả, kho đã lập phiếu cho đề nghị nhập, nhóm đã đóng; gỡ đúng những gì phiếu đẻ ra.
- Router: `GET /don/{id}/phieu-nhan/moi`, `POST /don/{id}/phieu-nhan`, `GET /phieu-nhan` (ThanhLoc), `GET /phieu-nhan/{id}`, `POST /phieu-nhan/{id}/huy`. SSE: `tgc_changed`, bàn giao (`phat_ban_giao`), kho, `tgc_cho_tra_tien_changed`.

- [ ] Test: `test_nhan_hai_dot_ve_buoc_sau` (800 rồi 850 ⇒ hai bàn giao, công việc thuê ngoài vẫn chưa hoàn thành), `test_nhan_vuot_con_ngoai_bi_chan`, `test_tron_goi_nhan_vuot_sl_dat_canh_bao` (lưu được, kết quả có câu cảnh báo), `test_nguoi_giao_khong_tu_nhan` + `test_tat_chan_bang_cau_hinh` (monkeypatch settings), `test_to_sau_nhan_duoc_khong_can_quyen_module`, `test_ve_kho_tao_de_nghi_nhap_khong_kcs` (không có `SanXuatKcsBatch` mới; đề nghị mang `tgc_phieu_nhan_id`; "giao được" của giao hàng cộng), `test_giao_thang_khach_chi_khi_dong_rieng`, `test_tam_tinh_chup_don_gia`, `test_huy_phieu_nhan_go_ban_giao`, `test_huy_phieu_nhan_to_da_xac_nhan_bi_chan`; bài ghép: `test_nhan_to_ghep_chia_so_con`, `test_ve_kho_tung_lenh`, `test_bai_ghep_khong_co_noi_ve_khach`.
- [ ] Đỏ → viết → xanh (cùng `test_tgc_phieu_giao.py`, `test_giao_hang_ngan_luot.py`, `test_don_hang_san_xuat.py`).

### Task 5.2 — Backend hoàn tất và sổ hàng ở ngoài

**Files:** Create `services/thue_gia_cong/hoan_tat.py`, `services/thue_gia_cong/so_ngoai.py`; Modify router/schemas/repo, `audit_registry.py` (`tgc_hoan_tat`, `tgc_mo_hoan_tat`); Test `backend/tests/test_tgc_hoan_tat.py`

**Interfaces:**
- `so_ngoai.cua_dong(db, don_dong_ids) -> dict[int, dict]` — bán thành phẩm: giao (đơn vị giao) và quy đổi, đạt, hỏng, còn ngoài; vật tư theo `(hang_loai, hang_id, khổ)`: đã xuất thực (số kho đã xuất của dòng đề nghị — tên cột đọc ở `stock_request` lúc làm), đã nhập trả, còn ngoài = xuất − trả (sau hoàn tất = 0, phần còn coi là dùng hết).
- `so_ngoai.danh_sach(db, *, nha_cung_cap_id=None, page, size, q) -> dict` — theo nhà gia công × hàng, chỉ dòng còn > 0 (việc sống).
- `hoan_tat.hoan_tat(db, *, user, don_dong_id, expected_version, tra_ve: list[{hang_loai, hang_id, kho_rong, kho_dai, so_luong}]) -> dict` — chụp `hao_hut` = giao quy đổi − đạt − hỏng (trọn gói null); số trả về > 0 ⇒ một đề nghị NHẬP trả kho mang `tgc_don_dong_id`; mọi công việc của việc `CV_HOAN_THANH`; dòng đơn cuối cùng hoàn tất ⇒ đơn "Hoàn tất".
- `hoan_tat.mo_lai(...)` — chặn khi đề nghị nhập trả đã có phiếu kho hoặc nhóm đã đóng; trả công việc về `CV_PHAT_HANH`.
- Router: `POST /don-dong/{id}/hoan-tat`, `POST /don-dong/{id}/mo-hoan-tat`, `GET /hang-o-ngoai`.

- [ ] Test: `test_hoan_tat_ra_hao_hut` (1.660 giao, 1.650 đạt ⇒ hụt 10), `test_hoan_tat_tra_vat_tu_tao_de_nghi_nhap`, `test_hoan_tat_dung_het_khong_de_nghi`, `test_hoan_tat_cong_viec_xong_lenh_doc_xong` (trạng thái bước "Xong 1.650 (hụt 10)"), `test_so_ngoai_tru_dan` (sau giao, sau nhận một phần, sau hoàn tất về 0), `test_mo_lai_hoan_tat`.
- [ ] Đỏ → viết → xanh.

### Task 5.3 — Frontend nhận, hoàn tất, hàng ở ngoài, nhắc ở Việc của tổ

**Files:** Create `PhieuNhanForm.tsx`, `PhieuNhanTab.tsx`, `HoanTatDialog.tsx`, `HangONgoaiTab.tsx`; Modify `DonNgan.tsx`; Modify `ThsxDrawer.tsx` hoặc thẻ việc của tổ bước sau (file phiên khác — sửa đúng khối) để hiện "Hàng <việc> hẹn về dd/mm" và nút "Nhận hàng gia công" mở `PhieuNhanForm` cho đúng dòng (spec §5.1 bước 5, §7)

- [ ] tsc + vitest xanh.
- [ ] Bấm thử (đủ luồng 5.1 của spec): tài khoản tổ bế mở Việc của tổ thấy "hàng cán màng hẹn về …" → Nhận hàng 800 đạt 0 hỏng về Bế → tổ bế thấy 800 sẵn để làm; người đã giao thử mở Nhận hàng ⇒ thông báo bị chặn; đợt 2 nhận 850 → Hoàn tất, nhập trả 4 m² màng ⇒ hụt 10 tờ, đề nghị nhập trả màng; lệnh "Xong 1.650 (hụt 10)"; Hàng đang ở ngoài từ 860 về 0. Trọn gói: nhận về kho ⇒ đề nghị nhập thành phẩm, không có KCS; lệnh khác giao thẳng khách ⇒ đơn bán cộng đã giao. Bài ghép: nhận tờ ghép ⇒ bảng chia hiện trước khi lưu.
- [ ] Tài liệu: mục "Phiếu nhận", "Hoàn tất", "Hàng đang ở ngoài"; cuốn Việc của tổ: nhắc hẹn về + nút Nhận hàng gia công; ảnh.

**Dừng đợt 5, báo.**

---

## Đợt 6 — Chờ trả tiền và phiếu chi gộp

**ERPNext tương ứng:** Purchase Receipt lập từ Subcontracting Receipt (`receipt/mapper.py:31-160`), Purchase Invoice gộp nhiều Purchase Receipt (`purchase_receipt/mapper.py:76-77`), trả tiền theo dòng dịch vụ.
**Cố ý khác:** bỏ PR, PI, bút toán và công nợ 331; phiếu chi gắn thẳng **nhiều phiếu nhận cùng nhà gia công** qua `tgc_phieu_chi_nhan`; số tiền điền sẵn = Σ tạm tính, sửa được theo hoá đơn thật, lệch thì bắt lý do (Q3: không tự trừ hỏng/hụt, hiện số cạnh tiền); "Còn phải trả" chỉ là danh sách chờ.

### Task 6.1 — Backend

**Files:** Create `services/thue_gia_cong/cho_tra_tien.py`; Modify `services/accounting_service.py` (nhánh `create_voucher` nguồn gia công nhận `tgc_phieu_nhan_ids: list[int]` + `amount` + `ly_do_lech`; khoá các phiếu nhận, cùng một NCC, chưa có phiếu chi sống, phiếu nhận chưa huỷ; ghi `tgc_phieu_chi_nhan` chia tiền theo tỷ lệ tạm tính, phần lẻ dồn dòng cuối; `content` = "Trả tiền thuê gia công GN-…, GN-…" + "Lệch tạm tính: <lý do>" khi lệch; người nhận tiền mặc định tên NCC), `schemas/accounting.py`, `routers/accounting.py` (SSE `tgc_cho_tra_tien_changed` khi lập/huỷ), router thue_gia_cong (`GET /cho-tra-tien`, `GET /cho-tra-tien/dem`), `lsx_nhat_ky` (phiếu chi qua bảng nối); Test `backend/tests/test_tgc_phieu_chi.py`

- [ ] Test: `test_cho_tra_tien_liet_ke_phieu_nhan_chua_chi` (kèm đạt, hỏng, hụt, tạm tính, thông tin lệnh), `test_lap_phieu_chi_gop_hai_phieu_nhan`, `test_khac_ncc_bi_chan`, `test_lech_khong_ly_do_bi_chan`, `test_huy_phieu_chi_tra_ve_cho`, `test_khong_vao_331`, `test_mot_phieu_nhan_mot_phieu_chi_song`.
- [ ] Đỏ → viết → xanh (cùng `test_cham_do_sua_chua_phieu_chi.py test_bao_cao_thu_chi.py test_phieu_muc_thu_chi.py`).

### Task 6.2 — Frontend

**Files:** Create `ChoTraTienTab.tsx` (lưới theo NCC, tick nhiều → "Lập phiếu chi" — nút chỉ hiện với quyền lập phiếu chi); Modify `ke-toan/phieu-chi/modals/LapPhieuChiGiaCongModal.tsx` (+test) nhận nhiều phiếu nhận, ô tiền `OGoDinhDang`, ô lý do hiện khi lệch; `components/HangChoGiaCong.tsx` đọc API mới; `AppShell.tsx` badge.

- [ ] tsc + vitest (`LapPhieuChiGiaCongModal.test.tsx`, `PaymentVouchersPage.test.tsx`) xanh.
- [ ] Bấm thử: tài khoản kế toán mở Chờ trả tiền tick GN đợt 1 + đợt 2 → Lập phiếu chi ⇒ 990.000 điền sẵn → sửa 980.000 ⇒ bắt lý do → gõ lý do → lưu ⇒ hai phiếu nhận rời danh sách ngay (tab khác tự cập nhật); huỷ phiếu chi ⇒ quay lại.
- [ ] Tài liệu: mục "Chờ trả tiền"; nếu cuốn Cấu hình mô tả nguồn phiếu chi thì sửa tên.

**Dừng đợt 6, báo.**

---

## Đợt 7 — Dọn và kiểm cuối

### Task 7.1 — Gỡ nhà gia công ở bước lệnh / bước chung

Lệnh không còn chọn nhà gia công từ đợt 2; đợt này bỏ hẳn cột. **Files:** `models/lsx.py` (`lsx_cong_doan.nha_cung_cap_id`, `nha_cung_cap`), `models/bai_ghep_cong_doan.py` (cùng hai cột), `san_xuat_cong_viec.nha_cung_cap` (chỉ gỡ nếu grep không còn chỗ đọc ngoài hiển thị cũ; còn thì đổi chỗ đọc sang đơn gia công), `services/san_xuat/snapshot.py:455`, `bai_ghep_service.py`, `schemas/lsx.py:257,333`, frontend tương ứng; migration `NNNN_tgc_go_ncc_buoc` (DROP COLUMN); `docs/DB_SCHEMA.md`. Routing tạo từ phiếu tính giá vẫn đặt `loai_buoc = thue_ngoai` khi dòng phiếu có nhà cung cấp (không đổi cách báo giá).
- [ ] grep `nha_cung_cap` trong `backend/app` và `frontend/src` ở các chỗ bước lệnh/bước chung, gỡ; chạy `test_lsx_service test_bai_ghep_service test_khsx_ui_contract test_lenh_sx_ho_so test_lenh_sx_pdf test_xep_lich_lenh_service test_schema_documented` ⇒ xanh; tsc xanh.

### Task 7.2 — Kiểm cuối

- [ ] `grep -rn "gia_cong_ngoai\|GiaCongNgoai\|giaCongNgoai" backend/app frontend/src` chỉ còn: nhãn audit cũ trong `audit_registry.py`, hằng `VOUCHER_SOURCE_GIA_CONG`/mã nguồn `gia_cong_ngoai`, `SOURCE_GIA_CONG_NGOAI` của mua hàng (không liên quan), migration cũ.
- [ ] Chạy mọi file `tests/test_tgc_*.py` + danh sách test hỗn hợp của đợt 2 ⇒ xanh; `npx tsc --noEmit`; `npx vitest run src/pages/thue-gia-cong src/pages/ke-toan/phieu-chi`.
- [ ] Bấm lại một lượt trọn luồng 5.1 và 5.2 của spec trên dev-browser từ đầu tới phiếu chi.
- [ ] Tài liệu: rà cả bốn cuốn (`grep -n "Gia công ngoài\|mang đi\|Chốt số"`), cuốn Kinh doanh còn 2 chỗ nhắc; biên dịch, `kiem-lien-ket.py` hai cuốn; ghi chú thay thế ở đầu spec 26/09 và 27/09 ("Đã thay bằng 2026-11-13-module-gia-cong-ngoai-design.md").

**Dừng đợt 7, báo xong toàn bộ.**

---

## Không làm (theo spec §9 và giới hạn plan)

Công nợ 331, tuổi nợ, cọc; hạch toán, giá trị kho hàng ở ngoài; kho nhà gia công thật; KCS phần mềm cho hàng gia công; cảnh báo trễ hẹn; bảng giá gia công theo NCC (chỉ gợi ý lần trước); đổi cách báo giá tính bước thuê ngoài; Xếp lịch không đổi. Bước chung thuê ngoài của bài ghép không có ô "Nhà gia công tự lo" (spec chỉ nêu `lsx_cong_doan_vat_tu`): phiếu giao của bài ghép chỉ có bán thành phẩm, vật tư bước chung giữ cách tính hiện hành.

## Điểm dễ hỏng cần soi khi duyệt

1. **Đơn vị giao ≠ đơn vị nhận** (giao tờ, nhận con/hộp): còn ngoài và hao hụt phải quy qua tỷ lệ ra/vào của dải, làm tròn lên khi chặn để không chặn oan đúng số. Test: `test_nhan_vuot_con_ngoai_bi_chan` dùng dải tờ → con.
2. **Hai người cùng thao tác** (hai phiếu nhận cùng lúc, đặt cùng một việc vào hai đơn, lập phiếu chi trùng phiếu nhận): khoá dòng (`with_for_update`) + `version` + index unique một phần. Test: `test_khong_dat_viec_hai_lan`, `test_mot_phieu_nhan_mot_phieu_chi_song`.
3. **Thu hồi hoặc cập nhật lệnh sau khi đã đặt/giao**: phải chặn với câu nêu mã đơn thay vì làm mồ côi chứng từ. Test: `test_cap_nhat_chan_khi_mat_buoc_da_dat`, `test_thu_hoi_chan_viec_da_dat`, `test_huy_tron_goi_da_dat_bi_chan`.
4. **Huỷ chứng từ giữa chuỗi** (huỷ phiếu giao khi đã có phiếu nhận, huỷ phiếu nhận khi tổ sau đã làm, huỷ đơn khi đã giao): mỗi cửa huỷ có câu chặn cụ thể. Test: các `test_huy_*_bi_chan` ở đợt 3–5.
5. **Dữ liệu chuyển từ module cũ** hiển thị đúng trên lệnh và đơn (đơn giá 0, phiếu nhận không có người giao): lệnh LSX26-0007 phải đọc "Xong 250", không lỗi khi mở đơn có `don_gia` 0. Test: `test_tgc_chuyen_du_lieu.py` + bấm thử đợt 2.
