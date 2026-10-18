# Tự lập yêu cầu xuất khi phát hành — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phát hành lệnh thì hệ thống tự lập yêu cầu xuất vật tư cho từng bước. Bàn tổ thấy trạng thái vật tư của từng bước, và tổ chỉ bắt đầu được khi vật tư Sẵn sàng. Kho lọc được theo lệnh, tổ, vật tư. Bỏ khâu tổ Cắt chốt giấy.

**Architecture:** Đường tự lập là một module mới `services/san_xuat/vat_tu_tu_lap.py`. Nó dùng chung lõi lập-một-lần-đề-nghị tách ra từ `vat_tu_de_nghi.tao`, chạy TRONG giao dịch phát hành, và báo tin sau commit. Trạng thái vật tư của bước là một hàm tính lô `services/san_xuat/trang_thai_vat_tu.py`. Bàn tổ (danh sách, bộ lọc vướng, cổng Bắt đầu, ngăn chi tiết) đọc chung hàm này.

**Tech Stack:** FastAPI + SQLAlchemy (Postgres dev/prod, SQLite :memory: test), React + TS, pytest, vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-tu-lap-yeu-cau-xuat-khi-phat-hanh-design.md`

## Global Constraints

- Không Alembic: cột mới vào `backend/app/db_migrations.py` (số kế tiếp là `0420`) và `docs/DB_SCHEMA.md` cùng lúc (guard `test_schema_documented.py`).
- Boolean `server_default` dùng `false`/`true`, không dùng `"0"`/`"1"`.
- Kiểm tra: pytest NHẮM FILE từ `backend/` và `npx tsc --noEmit` + vitest nhắm file từ `frontend/`. KHÔNG chạy `./init.ps1`, KHÔNG chạy pytest cả bộ.
- Không chạy `python -c` trần trong `backend/` (đụng Postgres dev).
- UI tiếng Việt: không in mã thô, không nối mẩu dữ liệu bằng "·" hay dấu phẩy, không chữ đậm cho mã/tên. Chip trạng thái dùng bộ `--tt-*` ở `tokens.css`.
- Gửi nội bộ phải real-time (SSE). Phát tin SAU commit. Loại sự kiện mới phải khai ở `frontend/src/lib/suKienNhom.ts`.
- Field mới ở response phải khai ở schema Pydantic (`schemas/san_xuat.py`, `schemas/...`) và type TS ở `api/client.ts`, nếu không thì Pydantic nuốt im lặng.
- Lọc ở MÁY CHỦ, không lọc trong JS.
- Commit message tiếng Việt, prefix `feat`/`fix`/`refactor`…, KHÔNG có dòng `Co-Authored-By`.
- Làm trong worktree `D:\jobs\SVN\.claude\worktrees\vat-tu-phat-hanh`, nhánh `vat-tu-tu-lap-khi-phat-hanh`. Luôn `git -C <worktree>`.

## Review Focus

1. Phát hành một cụm có MỘT dòng vật tư khai sai đơn vị: phát hành vẫn thành công, các món khác vẫn lập, toast nói món nào chưa lập (test ở Task 3).
2. Phát hành → thu hồi → phát hành lại khi kho đã xuất cho một bước: không lập yêu cầu trùng, bước vẫn Sẵn sàng ở công việc mới (test ở Task 4).
3. Lệnh có cùng mã giấy ở Cắt tờ và In: chỉ Cắt tờ có yêu cầu giấy, bước In không bị chặn Bắt đầu vì "Chưa yêu cầu" (test ở Task 3 và Task 5).
4. Kho huỷ yêu cầu tự lập: bước về "Chưa yêu cầu", Bắt đầu bị chặn với câu bảo xin lại (test ở Task 5).
5. Bàn tổ có 25 dòng: tính trạng thái vật tư không nổ N+1 (test đếm câu truy vấn ở Task 5).

---

### Task 1: Bỏ khâu tổ Cắt chốt giấy

**Files:**
- Delete: `backend/app/services/san_xuat/chot_giay.py`, `backend/tests/test_san_xuat_chot_giay.py`, `test_san_xuat_chot_giay_so_truy_van.py`, `test_san_xuat_chot_giay_truoc_in.py`, `test_san_xuat_chot_giay_tuyen.py`, `frontend/src/pages/ThsxChotGiay.tsx`, `ThsxChotGiay.test.tsx`
- Create: `backend/app/services/san_xuat/buoc_giay_bai.py`
- Modify: `routers/san_xuat.py` (gỡ 5 endpoint `/chot-giay*`, `_phat_sse_chot_giay`, mục `cho_chot_giay` ở Literal `vuong`), `routers/xep_lich.py` (gỡ `_bao_to_cat` và lời gọi), `services/san_xuat/board.py` (gỡ import, `la_to_cat`, `cho_chot_giay`), `dau_vao.py:318-322`, `loc_ban_to.py` (gỡ `cho_chot_giay`), `lsx_service.py` (gỡ `_chep_giay_sang_buoc_cat` và lời gọi trong `_dong_bo_dong_giay`), `ke_hoach_vat_tu_service.py:1077` (đổi sang `buoc_giay_bai`), `schemas/san_xuat.py` (gỡ `la_to_cat` dòng 22, `cho_chot_giay`, các lớp `ChotGiay*`), `schemas/rbac.py` + `routers/rbac.py` + `department_service.py` + `rbac_repo.py` (gỡ đường đọc/ghi `la_to_cat`; GIỮ cột trong model và DB, đánh chú thích "không còn dùng từ 18/10/2026"); FE `ThucHienSxPage.tsx`, `AppShell.tsx:1240`, `client.ts` (api `chotGiay`, type `ChotGiay*`, `cho_chot_giay`, `la_to_cat`), `lib/thongBaoMan.ts:52`, `loc-san-xuat/dieu-kien-ban-to.ts` (+ test), `ThsxDrawer.tsx` (+ test), `thsx/ThsxCotPhai.tsx`, `nhan-su-luong/phong-ban/DepartmentsPage.tsx`
- Keep: nhãn `san_xuat.chot_giay` / `san_xuat.go_chot_giay` ở `audit_registry.py`, để nhật ký cũ vẫn đọc được.
- Test: `backend/tests/test_buoc_giay_bai.py`, sửa `test_ke_hoach_vat_tu_buoc_dau.py`, `test_san_xuat_board.py`, `test_san_xuat_board_api.py`

**Interfaces:**
- Produces: `buoc_giay_bai.buoc_lay_giay_bai_lo(db, buoc_theo_bai: dict[int, list[BaiGhepCongDoan]], giay_theo_bai: dict[int, int]) -> dict[int, BaiGhepCongDoan | None]`. Luật: bước chung ĐẦU TIÊN theo `thu_tu` mà có bước thành viên (lệnh) mang dòng `hang_loai='giay'` cùng mã `giay_theo_bai[bai_id]`. Không có thì `None`, không đoán.

- [ ] **Step 1:** Viết `test_buoc_giay_bai.py`: `test_bai_lay_giay_o_buoc_chung_co_thanh_vien_mang_dung_ma` (bài có Ghi kẽm rồi In; thành viên mang giấy mã G ở bước In ⇒ trả bước In), `test_bai_khong_buoc_nao_mang_ma_giay_thi_none` (thành viên mang giấy mã khác ⇒ `None`).
- [ ] **Step 2:** Chạy `python -m pytest tests/test_buoc_giay_bai.py -q` → FAIL (module chưa có).
- [ ] **Step 3:** Viết `buoc_giay_bai.py` (nạp lô bước thành viên phủ bởi bước chung; dùng lại cách `chot_giay._buoc_chung_co_giay` đọc quan hệ chung↔thành viên). Ở `ke_hoach_vat_tu_service.py`, đổi lời gọi và giữ fallback `neo or (buoc[0] if buoc else None)` HIỆN CÓ cho bảng cân đối. Riêng đường tự lập (Task 3) dùng thẳng `None` là không lập.
- [ ] **Step 4:** Gỡ mọi chỗ ở danh sách Modify. Xoá file test chuyên chốt giấy. Sửa các test còn tham chiếu (`test_ke_hoach_vat_tu_buoc_dau.py` 145/218-222, `test_san_xuat_board.py:149-153`, `test_san_xuat_board_api.py:51`) theo luật mới: giấy nằm ở đâu thì bước đó lấy.
- [ ] **Step 5:** Chạy `rg -n "chot_giay|cho_chot_giay|ChotGiay|_chep_giay_sang_buoc_cat|laToCat|la_to_cat" backend/app frontend/src`. Chỉ còn model `department.py`, migration 0355/0356 và `audit_registry.py`.
- [ ] **Step 6:** Chạy `python -m pytest tests/test_buoc_giay_bai.py tests/test_ke_hoach_vat_tu_buoc_dau.py tests/test_san_xuat_board.py tests/test_san_xuat_board_api.py tests/test_lsx_service.py tests/test_rbac_departments_api.py -q` → PASS. Chạy `npx tsc --noEmit` và `npx vitest run src/pages/ThsxDrawer.test.tsx src/pages/loc-san-xuat` → PASS.
- [ ] **Step 7:** Commit `refactor(san-xuat): bỏ khâu tổ Cắt chốt giấy, giấy nằm ở bước nào thì bước đó lấy`.

### Task 2: Cột đánh dấu và lõi lập-một-lần-đề-nghị dùng chung

**Files:**
- Modify: `models/san_xuat_vat_tu.py`, `models/san_xuat.py`, `db_migrations.py`, `docs/DB_SCHEMA.md`, `services/san_xuat/vat_tu_de_nghi.py`
- Test: `backend/tests/test_sx_vat_tu_de_nghi.py` (chạy lại, không đổi hành vi)

**Interfaces:**
- Produces:
  - Cột `san_xuat_vat_tu_de_nghi.tu_lap: Boolean NOT NULL server_default false`. True là "Tự lập khi phát hành".
  - Cột `san_xuat_cong_viec.can_vat_tu: Boolean NOT NULL server_default false`. True là bước có nhu cầu vật tư lúc phát hành, dùng cho mức "Chưa yêu cầu". Không backfill lệnh cũ.
  - Migration `0420_vat_tu_tu_lap`.
  - `vat_tu_de_nghi._lap_lan(db, *, cv, nguoi, bo_phan_id: int | None, can_luc: datetime, dongs: list[dict], ghi_chu: str | None, tu_lap: bool, req_svc, hang) -> tuple[SanXuatVatTuDeNghi, StockRequest | None]`. Hàm này KHÔNG commit, KHÔNG gate, KHÔNG báo tin. Audit ghi bằng `commit=False`. `dongs` là output của `_chuan_hoa`.
  - `tao()` giữ nguyên chữ ký và hành vi: khoá, gate, kiểm lần còn mở, `_chuan_hoa`, rồi `_lap_lan(..., bo_phan_id=user.department_id, tu_lap=False)`, commit, báo tin.

- [ ] **Step 1:** Thêm hai cột vào model, viết migration `0420` (ALTER ADD COLUMN cho cả hai bảng, kiểm cột tồn tại trước như `_migrate_department_la_to_cat`), ghi `DB_SCHEMA.md` hai dòng cột đúng khuôn bảng.
- [ ] **Step 2:** Tách `_lap_lan` khỏi `tao()`. Audit trong `_lap_lan` dùng `AuditLogRepository(db).create(..., commit=False)`. Kiểm repo audit có tham số này; không có thì thêm tham số `commit: bool = True`.
- [ ] **Step 3:** Chạy `python -m pytest tests/test_sx_vat_tu_de_nghi.py tests/test_schema_documented.py tests/test_db_migrations.py -q` → PASS (hành vi tổ tự bấm không đổi).
- [ ] **Step 4:** Commit `refactor(san-xuat): tách lõi lập một lần đề nghị vật tư, thêm cột tu_lap và can_vat_tu (mg 0420)`.

### Task 3: Tự lập yêu cầu khi phát hành

**Files:**
- Create: `backend/app/services/san_xuat/vat_tu_tu_lap.py`
- Modify: `services/xep_lich/service.py:981-1035` (`phat_hanh`), `routers/xep_lich.py:270-285`, `schemas` của kết quả phát hành (nếu có response_model), FE chỗ gọi `api.xepLich.phatHanh` ở `XepLichPage.tsx:400` (toast)
- Test: `backend/tests/test_vat_tu_tu_lap.py`

**Interfaces:**
- Consumes: `_lap_lan`, `_chuan_hoa`, `_hang_service`, `_kh_service`, `_req_service` (Task 2); `KeHoachVatTuService.nhu_cau_cua_cong_viec(cv)` (đã áp luật giấy bước đầu và lệnh trọn gói).
- Produces:
  - `vat_tu_tu_lap.lap_khi_phat_hanh(db, *, goi_id: int, nguoi) -> KetQuaTuLap`, KHÔNG commit. `KetQuaTuLap` là `TypedDict{"request_ids": list[int], "cv_ids": list[int], "bo_qua": list[dict]}`; mỗi phần tử `bo_qua` là `{"cong_viec_id", "ten_cong_doan", "ten_hang", "ly_do"}`.
  - `vat_tu_tu_lap.bao_sau_phat_hanh(db, kq: KetQuaTuLap, *, ma_lenh: str, actor_id: int) -> None`.
  - Kết quả `XepLichLenhService.phat_hanh` thêm khoá `"vat_tu": {"so_yeu_cau": int, "bo_qua": list[dict]}`.

Luật trong `lap_khi_phat_hanh`, theo từng công việc của gói (`SanXuatRepository.cong_viec_cua_goi`):
- Bỏ qua công việc thuê ngoài (`gia_cong_ngoai_id` khác None).
- Trước hết gọi `chuyen_de_nghi_cu(db, cv)` (Task 4). Công việc đã có đề nghị chuyển sang thì đặt `can_vat_tu=True` và không lập thêm.
- `nhu_cau = kh_svc.nhu_cau_cua_cong_viec(cv)`. Có ít nhất một dòng thì `cv.can_vat_tu = True`.
- Bài ghép: dòng giấy chỉ giữ khi `buoc_giay_bai.buoc_lay_giay_bai_lo` trả đúng `cv.bai_ghep_cong_doan_id`.
- Dòng có `sl_goc <= 0` thì bỏ, không vào `bo_qua`: tổ tự xin.
- Đổi từng dòng sang input `_chuan_hoa`: `{hang_loai, hang_id, dvt, sl_yeu_cau=sl, kho_rong, kho_dai}`. Gọi `_chuan_hoa` + `_lines_kho` TỪNG DÒNG trong `try/except VatTuDeNghiError`. Lỗi thì vào `bo_qua`.
- Còn dòng thì gọi `_lap_lan(nguoi=nguoi, bo_phan_id=cv.department_id, can_luc=cv.du_kien_bat_dau, tu_lap=True, ghi_chu=f"Tự lập khi phát hành «{cv.ten_cong_doan}».")`. Thiếu `du_kien_bat_dau` thì lấy giờ hiện tại.

`bao_sau_phat_hanh`:
- MỘT tin cho kho: `bao(db, kenh="kho", loai="kho_yeu_cau_moi", actor_id=...)` + một `NotificationRepository.add_many` với tiêu đề `f"{ma_lenh}: {n} yêu cầu xuất mới"` + `hub.gui({"type": "stock_request_pending_changed"}, quyen=MAN_KHO)`.
- Mỗi tổ có yêu cầu: `_bao_de_nghi_doi(cv)`.

- [ ] **Step 1:** Viết test (dựng lệnh bằng helper `_mot_cv` / fixture `svc3`, `lenh` của `test_xep_lich_lenh_service.py`; đặt mốc rồi `svc3.phat_hanh`):
  - `test_phat_hanh_tu_lap_yeu_cau_cho_buoc_co_vat_tu`: mỗi công việc có định mức có đúng 1 `SanXuatVatTuDeNghi(tu_lap=True, lan_so=1)`. `stock_request.trang_thai == "approved"`, `bo_phan_id == cv.department_id`, `can_luc` khớp `cv.du_kien_bat_dau`, `nguoi_tao_id == admin.id`. `cv.can_vat_tu is True`.
  - `test_buoc_khong_dinh_muc_khong_lap`: `can_vat_tu is False`, không đề nghị.
  - `test_giay_cung_ma_o_cat_va_in_chi_cat_lay`: yêu cầu giấy chỉ ở công việc Cắt tờ. Công việc In không có dòng giấy; In chỉ có `can_vat_tu` True khi còn món khác.
  - `test_mot_dong_loi_khong_chan_phat_hanh`: một vật tư thiếu đơn vị tính ⇒ phát hành OK, `kq["vat_tu"]["bo_qua"]` có đúng món đó, các món khác vẫn lập.
  - `test_cum_hai_lenh_lap_cho_ca_cum`: cụm 2 lệnh ⇒ yêu cầu cho công việc của cả hai.
- [ ] **Step 2:** Chạy `python -m pytest tests/test_vat_tu_tu_lap.py -q` → FAIL.
- [ ] **Step 3:** Viết `vat_tu_tu_lap.py`. Gọi `lap_khi_phat_hanh` trong `XepLichLenhService.phat_hanh`, ngay sau `_sx_phat_hanh` (dòng 1021) và TRƯỚC audit (audit tự commit). Router gọi `bao_sau_phat_hanh` sau khi service trả về.
- [ ] **Step 4:** FE toast phát hành: thêm câu "Đã gửi kho N yêu cầu xuất". Khi `bo_qua` không rỗng thì thêm "M món chưa tự lập được, tổ xin tay" (title liệt kê "<công đoạn>: <món> — <lý do>").
- [ ] **Step 5:** Chạy `python -m pytest tests/test_vat_tu_tu_lap.py tests/test_xep_lich_lenh_service.py tests/test_sx_vat_tu_de_nghi.py -q` → PASS; `npx tsc --noEmit` → PASS.
- [ ] **Step 6:** Commit `feat(san-xuat): phát hành lệnh tự lập yêu cầu xuất vật tư cho từng bước`.

### Task 4: Thu hồi, phát hành lại, phát hành cập nhật

**Files:**
- Modify: `services/san_xuat/vat_tu_tu_lap.py`, `services/san_xuat/release_update.py` (`thu_hoi_goi` dòng 429, `phat_hanh_cap_nhat` dòng 307), `routers/xep_lich.py` (DELETE `/phat-hanh` dòng 326, POST `/phat-hanh-cap-nhat` dòng 306: báo tin sau commit)
- Test: `backend/tests/test_vat_tu_tu_lap.py`

**Interfaces:**
- Produces:
  - `vat_tu_tu_lap.huy_khi_thu_hoi(db, *, goi_id: int) -> list[int]`: trả id yêu cầu đã huỷ, KHÔNG commit. Mọi đề nghị (tự lập lẫn tổ bấm) của công việc trong gói mà yêu cầu chưa có phiếu `posted` thì huỷ: `lock_for_update`, phiếu `draft` của yêu cầu chuyển `cancelled`, yêu cầu `REQ_CANCELLED` với `ly_do_huy="Lệnh bị thu hồi phát hành"`. Không gọi `save()` tự commit; theo khuôn `gia_cong_ngoai/tron_goi.py:200-232`.
  - `vat_tu_tu_lap.bao_da_huy(db, request_ids: list[int]) -> None`: sau commit, gọi `san_xuat/kho.py bao_yeu_cau_da_huy` cho từng yêu cầu.
  - `vat_tu_tu_lap.chuyen_de_nghi_cu(db, cv) -> bool`: tìm đề nghị của công việc cùng bước (`lsx_cong_doan_id` hoặc `bai_ghep_cong_doan_id`; ưu tiên cùng `phan_doan_so`, không có thì phân đoạn 1 nhận) thuộc gói `GOI_DA_THU_HOI`, và yêu cầu không `cancelled`. Đổi `cong_viec_id` sang `cv.id`, đánh lại `lan_so` 1..n theo thứ tự cũ. Trả True nếu có chuyển.
  - `vat_tu_tu_lap.doi_can_luc_theo_lich(db, *, goi_id: int) -> list[int]`: với đề nghị `tu_lap=True`, `updated_by_id IS NULL`, yêu cầu chưa có phiếu `posted`, đặt `dn.can_luc`, `req.can_luc`, `req.ngay_can` theo `cv.du_kien_bat_dau` mới. Trả id yêu cầu đã đổi.

- [ ] **Step 1:** Viết test:
  - `test_thu_hoi_huy_yeu_cau_chua_xuat_ca_tu_lap_lan_to_bam`
  - `test_thu_hoi_huy_ca_phieu_nhap_kho_dang_soan`
  - `test_thu_hoi_giu_yeu_cau_da_xuat_va_phat_hanh_lai_chuyen_sang_cong_viec_moi`: kho ghi phiếu xuất đủ cho bước In, rồi thu hồi, rồi phát hành lại. Công việc In mới có đúng các đề nghị cũ (`lan_so` 1), không có đề nghị mới. Các bước khác có đề nghị mới.
  - `test_thu_hoi_van_bi_chan_khi_co_viec_da_bat_dau`: luật cũ giữ nguyên.
  - `test_phat_hanh_cap_nhat_doi_can_luc_tu_lap`
  - `test_phat_hanh_cap_nhat_giu_can_luc_to_da_sua`
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Cài đặt:
  - Gọi `huy_khi_thu_hoi` trong `thu_hoi_goi`, trước `flush`.
  - Gọi `doi_can_luc_theo_lich` trong `phat_hanh_cap_nhat`, trước audit.
  - `chuyen_de_nghi_cu` được `lap_khi_phat_hanh` gọi (Task 3).
  - Router báo tin kho sau commit. Thu hồi trả `request_ids` qua kết quả service, thêm khoá `"yeu_cau_da_huy"`.
- [ ] **Step 4:** Chạy `python -m pytest tests/test_vat_tu_tu_lap.py tests/test_san_xuat_release_update.py tests/test_xep_lich_lenh_service.py -q` → PASS.
- [ ] **Step 5:** Commit `feat(san-xuat): thu hồi huỷ yêu cầu chưa xuất, phát hành lại giữ vật tư đã nhận, cập nhật giờ cần theo lịch`.

### Task 5: Trạng thái vật tư của bước, cổng Bắt đầu, bộ lọc vướng

**Files:**
- Create: `backend/app/services/san_xuat/trang_thai_vat_tu.py`
- Modify:
  - `repositories/san_xuat_vat_tu_repo.py`: thêm `de_nghi_theo_cong_viec(cv_ids) -> dict[int, list[SanXuatVatTuDeNghi]]`.
  - `services/san_xuat/dau_vao.py` `kiem_bat_dau`.
  - `services/san_xuat/loc_ban_to.py`: VUONG thêm `chua_san_sang_vat_tu`.
  - `routers/san_xuat.py:326`: Literal `vuong`.
  - `services/san_xuat/board.py`: `chi_tiet_cong_viec` trả `vat_tu_chua_san_sang`.
  - `schemas/san_xuat.py`: `WorkItemChiTietOut`.
  - FE: `loc-san-xuat/dieu-kien-ban-to.ts` (`ThsxVuongLoc` + nhãn "Chưa sẵn sàng vật tư"), `ThsxDrawer.tsx:228-238` và `thsx/ThsxCotPhai.tsx` (mục vướng `vattu`), `client.ts` (`SxWorkItemChiTiet`).
- Test: `backend/tests/test_trang_thai_vat_tu.py`, `frontend/src/pages/thsx/ThsxCotPhai.test.tsx` (tạo nếu chưa có)

**Interfaces:**
- Produces:
  - `MUC_VT = ("chua_yeu_cau", "cho_kho", "kho_dang_soan", "cap_thieu", "san_sang")`.
  - `trang_thai_vat_tu(db, cvs: list[SanXuatCongViec]) -> dict[int, dict | None]`: `None` nghĩa là bước không cần vật tư. Ngược lại trả `{"muc": str, "mon": [{"ten", "dvt", "sl_xin", "sl_da_xuat", "chot_thieu": bool, "lan_so", "muc"}]}`.
  - Câu chặn: `ly_do_vat_tu(muc: str) -> str`.

Luật tính (spec §5.1). Nạp đúng 3 câu truy vấn cho cả lô: đề nghị theo cv, `yeu_cau_tom_tat`, dòng yêu cầu. Từng yêu cầu được xếp mức như sau:
- `approved`/`received` không có phiếu → `cho_kho`;
- có phiếu `draft` (`preparing`) → `kho_dang_soan`;
- `partial` → `cap_thieu`;
- `done` → `san_sang`;
- `cancelled`/`rejected` → không tính.

Mức của bước là mức nhỏ nhất theo thứ tự `cho_kho < kho_dang_soan < cap_thieu < san_sang` trong các yêu cầu còn tính. Không còn yêu cầu nào thì: `chua_yeu_cau` nếu `cv.can_vat_tu`, ngược lại `None`.

Câu chặn:
- `chua_yeu_cau` → "Chưa yêu cầu vật tư. Bấm Yêu cầu cấp vật tư trước."
- `cho_kho` → "Vật tư chưa sẵn sàng: đang chờ kho. Đợi kho xuất xong mới bắt đầu được."
- `kho_dang_soan` → "Vật tư chưa sẵn sàng: kho đang soạn. Đợi kho xuất xong mới bắt đầu được."
- `cap_thieu` → "Vật tư chưa sẵn sàng: kho mới cấp một phần. Đợi kho xuất nốt mới bắt đầu được."

- [ ] **Step 1:** Viết test:
  - `test_muc_cho_kho_khi_vua_phat_hanh`
  - `test_muc_kho_dang_soan_khi_co_phieu_nhap`
  - `test_muc_cap_thieu_khi_partial`
  - `test_muc_san_sang_khi_done_ke_ca_chot_thieu`: tick `chot_thieu` của món.
  - `test_kho_huy_thi_ve_chua_yeu_cau`
  - `test_lan_bo_sung_dang_cho_keo_buoc_ve_cho_kho`
  - `test_buoc_khong_can_vat_tu_tra_none`
  - `test_bat_dau_bi_chan_khi_chua_san_sang`: `thuc_thi.bat_dau` ném `ValueError` với đúng câu ở trên.
  - `test_bat_dau_duoc_khi_san_sang`
  - `test_buoc_in_nhan_giay_tu_cat_khong_bi_chan`
  - `test_loc_vuong_chua_san_sang_vat_tu`
  - `test_trang_thai_lo_25_cong_viec_so_truy_van_co_dinh`: đếm bằng event `before_cursor_execute`, ≤ 4 câu.
- [ ] **Step 2:** Chạy `python -m pytest tests/test_trang_thai_vat_tu.py -q` → FAIL.
- [ ] **Step 3:** Cài đặt:
  - Viết `trang_thai_vat_tu.py`.
  - `kiem_bat_dau` gọi `trang_thai_vat_tu(db, [cv])`. Mức khác `None` và khác `san_sang` thì `raise ValueError(ly_do_vat_tu(muc))`, đặt TRƯỚC `thieu_dau_vao`.
  - `loc_ban_to.thuoc_tinh` tính lô một lần cho các dòng `released`/`paused`.
  - `chi_tiet_cong_viec` trả `vat_tu_chua_san_sang: str | None`.
  - FE: `ThsxCotPhai` hiện câu này trong "Chưa bắt đầu được vì", `ThsxDrawer` đưa nó vào `canBatDau`.
- [ ] **Step 4:** Chạy `python -m pytest tests/test_trang_thai_vat_tu.py tests/test_san_xuat_thuc_thi.py tests/test_san_xuat_board.py -q` → PASS. Chạy `npx tsc --noEmit` và `npx vitest run src/pages/thsx src/pages/ThsxDrawer.test.tsx src/pages/loc-san-xuat` → PASS. Test cũ của `thuc_thi` hỏng vì bước có vật tư giờ bị chặn thì cho kho xuất đủ trong test (helper `_cap_du_vat_tu(db, cv)` đặt ở `tests/test_trang_thai_vat_tu.py` rồi import), KHÔNG nới luật.
- [ ] **Step 5:** Commit `feat(ban-to): bắt đầu phải có vật tư sẵn sàng, lọc vướng Chưa sẵn sàng vật tư`.

### Task 6: Cột Vật tư trên lưới Bàn tổ, tự đổi khi kho thao tác

**Files:**
- Modify:
  - `services/san_xuat/board.py`: `_dung_items` 364-398 và `_item_dict` 251-343.
  - `schemas/san_xuat.py` `WorkItemOut`: thêm `trang_thai_vat_tu: TrangThaiVatTuOut | None = None`.
  - `client.ts`: `SxWorkItem` + type `SxTrangThaiVatTu`.
  - `pages/ThsxDanhSach.tsx`: cột mới `{ key: "vtt", label: "Vật tư", w: 130 }` đặt ngay sau cột `vt`.
  - Phía kho, phát tin cho tổ: `routers/kho_voucher.py` (tạo phiếu, ghi sổ, huỷ phiếu) và `routers/kho_request.py` (`huy-kho`, `tu-choi` nếu có).
  - `lib/suKienNhom.ts`: `san_xuat_vat_tu_de_nghi_changed: ["san_xuat"]`.
- Test: `frontend/src/pages/ThsxDanhSach.test.tsx`, `backend/tests/test_trang_thai_vat_tu.py`

**Interfaces:**
- Consumes: `trang_thai_vat_tu` (Task 5).
- Produces:
  - `vat_tu_tu_lap.bao_to_theo_yeu_cau(db, request_ids: list[int]) -> None`: tra đề nghị theo `stock_request_id`, rồi gọi `_bao_de_nghi_doi(cv)` cho mỗi công việc.
  - Type TS `SxTrangThaiVatTu = { muc: "chua_yeu_cau" | "cho_kho" | "kho_dang_soan" | "cap_thieu" | "san_sang"; mon: {...}[] }`.

Nhãn chip:
- `chua_yeu_cau` "Chưa yêu cầu";
- `cho_kho` "Chờ kho";
- `kho_dang_soan` "Kho đang soạn";
- `cap_thieu` "Cấp thiếu";
- `san_sang` "Sẵn sàng".

Mỗi mức một sắc `--tt-*` khác nhau. `null` thì ô trống. Title của chip liệt kê từng món theo dạng "<tên> xin <sl> <ĐVT>, đã xuất <sl>", thêm "kho chốt thiếu" khi `chot_thieu`.

- [ ] **Step 1:** Viết test:
  - vitest `"cột Vật tư hiện chip Kho đang soạn"`;
  - vitest `"bước không cần vật tư thì ô Vật tư trống"`;
  - vitest `"rê chuột chip thấy từng món và số đã xuất"`;
  - pytest `test_danh_sach_ban_to_tra_trang_thai_vat_tu`: gọi API `GET /api/san-xuat/work-items?team_id=` và kiểm khoá `trang_thai_vat_tu.muc`;
  - pytest `test_ghi_so_phieu_xuat_bao_ban_to`: patch `hub.gui`, ghi sổ phiếu qua API kho, kiểm có `san_xuat_vat_tu_de_nghi_changed` gửi đúng `to=[cv.department_id]`.
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Cài đặt:
  - `_dung_items` gọi `trang_thai_vat_tu` một lần cho cả trang.
  - Router kho gọi `bao_to_theo_yeu_cau` sau commit.
  - Ngăn chi tiết: `_vat_tu_cap` trả `tu_lap` cho từng lần đề nghị. `VatTuSection` (`ThsxExecPanels.tsx:1453`) ghi "Tự lập khi phát hành" ở lần đó.
  - Chuông phản hồi của kho (`_notif_nguoi_tao` trong `stock_request_service.py:724`): với yêu cầu có đề nghị `tu_lap=True`, gửi `bao(kenh=kenh_to(cv.department_id), loai="kho_phan_hoi")` thay vì gửi người tạo.
  - Test thêm `test_kho_huy_yeu_cau_tu_lap_bao_ve_to_khong_bao_nguoi_phat_hanh`.
- [ ] **Step 4:** Chạy `python -m pytest tests/test_trang_thai_vat_tu.py tests/test_san_xuat_board_api.py -q` → PASS. Chạy `npx tsc --noEmit` và `npx vitest run src/pages/ThsxDanhSach.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(ban-to): cột Vật tư trên lưới, tự đổi khi kho soạn, xuất, huỷ`.

### Task 7: Kho lọc theo lệnh, tổ, vật tư

**Files:**
- Modify:
  - `repositories/stock_request_repo.py`: `_base_conds` dòng 358.
  - `routers/kho_request.py`: `list_requests` 383, `/counts-by-status` 470, endpoint giá trị lọc gần 503-557.
  - FE `pages/loc-kho/dieu-kien-yeu-cau-kho.ts`, `KhoYeuCauPage.tsx` (cột Nguồn hiện "Tự lập khi phát hành").
  - `client.ts`: `StockRequestListParams` 9871, `stockRequestQS` 9887.
  - `boi_canh_san_xuat` (`san_xuat_vat_tu_repo.py:50`): trả thêm `tu_lap`.
- Test: `backend/tests/test_kho_loc_lenh_to_vat_tu.py`, `frontend/src/pages/loc-kho/dieu-kien-yeu-cau-kho.test.ts`

**Interfaces:**
- Produces:
  - Tham số query mới `lenh: int | None` (lsx id), `vat_tu: list[str] | None` (mỗi phần tử dạng `"giay:12"` hoặc `"vat_tu:5"`).
  - `bo_phan` đổi nghĩa thành "Tổ / bộ phận". Khớp khi `stock_requests.bo_phan_id = :id`, HOẶC yêu cầu có đề nghị gắn công việc có `department_id = :id`.
  - Endpoint `/loc-lenh` (lệnh có yêu cầu trong tập nền) và `/loc-vat-tu` (mã hàng xuất hiện ở dòng). Cùng khuôn `/loc-nguon`.
  - FE thêm `lenh` (`kieu:"mot"`, tìm được), `vat_tu` (`kieu:"nhieu"`, tìm được); nhãn `bo_phan` thành "Tổ / bộ phận". Khoá URL `lenh`, `vt`.

Luật lọc:
- `lenh` khớp dòng có `lsx_id = :id`, HOẶC dòng có `bai_ghep_id` thuộc bài chứa lệnh đó (`bai_ghep_thanh_vien`).
- Ba lọc kết hợp AND với nhau và với lọc sẵn có.

- [ ] **Step 1:** Viết test:
  - `test_loc_theo_lenh_gom_ca_bai_ghep_chua_lenh`
  - `test_loc_theo_to_khop_qua_cong_viec_khi_nguoi_bam_khac_phong`
  - `test_loc_theo_vat_tu_nhieu_ma`
  - `test_counts_by_status_ton_trong_bo_loc_moi`
  - vitest `"đọc ghi khoá URL lenh và vt"`
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Cài đặt. Các điều kiện viết bằng `EXISTS`, không join nhân dòng.
- [ ] **Step 4:** Chạy `python -m pytest tests/test_kho_loc_lenh_to_vat_tu.py tests/test_kho_request*.py -q` → PASS. Chạy `npx tsc --noEmit` và `npx vitest run src/pages/loc-kho` → PASS.
- [ ] **Step 5:** Commit `feat(kho): lọc yêu cầu theo lệnh, tổ, vật tư`.

### Task 8: Bấm thử luồng thật trên trình duyệt

Bắt buộc theo CLAUDE.md: thao tác bằng chuột và phím thật, không dùng API thay bất kỳ bước nào.

- [ ] **Step 1:** Dựng môi trường thử:
  - DB sao chép từ `svn_erp_trong` (`createdb` + `pg_dump | psql`);
  - Redis container riêng;
  - `backend/.env` tạm trong worktree;
  - cổng BE/FE còn trống (kiểm `Get-NetTCPConnection`);
  - `frontend/node_modules`: junction.
- [ ] **Step 2:** Đi luồng:
  1. Kế hoạch / Xếp lịch: đặt giờ một lệnh có giấy + kẽm + màng, bấm "Phát hành". Thấy toast "Đã gửi kho N yêu cầu xuất".
  2. Tài khoản kho: thấy chấm đỏ và toast ngay, không tải lại trang. Lọc theo lệnh, theo tổ, theo vật tư.
  3. Bàn tổ In: cột Vật tư "Chờ kho". Bấm Bắt đầu thì thấy câu chặn.
  4. Kho lập phiếu: Bàn tổ tự đổi sang "Kho đang soạn". Kho ghi sổ đủ: Bàn tổ tự đổi sang "Sẵn sàng". Bấm Bắt đầu thì chạy.
  5. Lệnh khác: phát hành → kho ghi sổ một bước → thu hồi (gõ lý do) → phát hành lại. Bước đó vẫn "Sẵn sàng", kho không có yêu cầu trùng.
  6. Xác nhận Bàn tổ Cắt không còn khối "Chờ chốt giấy".
- [ ] **Step 3:** Dọn môi trường thử: tắt server, xoá DB sao chép, Redis riêng, `.env` tạm. Báo cáo liệt kê từng bước đã bấm, đã gõ gì, thấy gì.
- [ ] **Step 4:** Commit các sửa phát sinh lúc bấm thử. Hỏi chủ dự án trước khi gộp vào dev.
