# Máy thuộc tổ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mọi máy khai thuộc (nhiều) tổ; công đoạn lấy máy qua tổ đã tick; bước/công việc chạy máy luôn mang máy thuộc tổ của nó.

**Architecture:** Bảng nối mới `may_to`. Quan hệ ghi được của công đoạn đổi tên `CongDoan.may_khai` (mọi dòng `cong_doan_may`, kể cả dòng "nằm im"); `CongDoan.may_lam_duoc` thành quan hệ CHỈ ĐỌC đã lọc theo tổ — nhờ vậy ~12 file BE và mọi FE đang đọc `may_lam_duoc` tự đúng mà không sửa. Luật cặp tổ×máy gom trong một module service `services/may_to.py`, mọi nơi (tạo lệnh, lưu bước, phát hành cập nhật, Đổi máy) gọi nó.

**Tech Stack:** FastAPI + SQLAlchemy 2 (SQLite test / Postgres dev+prod), migration tay `backend/app/db_migrations.py`; React + TypeScript (Vite, vitest).

**Spec:** `docs/superpowers/specs/2026-10-22-may-thuoc-to-design.md`

## Global Constraints

- Làm trong WORKTREE riêng cắt từ `dev` HEAD (dev đang bẩn bởi phiên song song). Chạy UI worktree: BE cổng 8010, FE 5174, env INLINE (xem memory `run-ui-worktree`).
- Không Alembic: bảng mới phải có migration `0434_may_to` (`MIGRATIONS.append`) trong `backend/app/db_migrations.py`; cập nhật `docs/DB_SCHEMA.md` cùng commit (guard test).
- Migration chỉ TẠO bảng: không điền tổ cho máy, không sửa lệnh/công việc, không xoá `cong_doan_may`.
- Tổ/máy của lệnh và công việc là ẢNH CHỤP: đổi danh mục KHÔNG sửa lệnh/việc đang có, chỉ cảnh báo.
- Công đoạn không tick tổ nào ⇒ giữ hành vi hôm nay (dùng nguyên dòng `cong_doan_may`, không kiểm cặp).
- Chỉ nhận tổ LÁ của Khối Sản xuất (`DepartmentRepository.to_san_xuat()`, `backend/app/repositories/rbac_repo.py:190`).
- UI tiếng Việt, không chữ đậm, KHÔNG nối mẩu dữ liệu bằng "·" hay dấu phẩy — nhiều tổ thì mỗi tổ một chip nhỏ.
- Verify: pytest nhắm file + `npx tsc --noEmit` + vitest nhắm file. KHÔNG chạy `./init.ps1`, không chạy pytest full.
- Commit message không có dòng Co-Authored-By. Push tài khoản thonglv111 (chỉ khi được bảo).
- Sửa route/schema BE ⇒ restart uvicorn tay trước khi bấm thử.

## Review Focus

1. Máy thuộc HAI tổ cùng được tick ở một công đoạn ⇒ chỉ MỘT dòng ở bảng máy và MỘT lựa chọn ở ô máy (Task 1, Task 8).
2. Máy ĐÃ NGỪNG DÙNG vẫn thuộc tổ ⇒ không được mời cho bước mới, nhưng bước đang gán máy đó vẫn hiện máy trong ô chọn (Task 2, Task 9).
3. Lệnh cũ đang lệch (như LSX26-0003) sửa ô KHÁC rồi lưu ⇒ lưu được, không 400; băng "Danh mục đã đổi" hiện câu lệch (Task 5).
4. Bỏ tick tổ ở công đoạn rồi tick lại ⇒ cách đo giờ / cách tính giá của máy còn nguyên (Task 1, Task 4).
5. Tổ không có máy nào chạy công đoạn ⇒ ô máy trống + câu nhắc, thời lượng "—", không lỗi JS (Task 9).

---

### Task 1: Bảng `may_to` + quan hệ lọc theo tổ trên công đoạn

**Files:**
- Modify: `backend/app/models/may_thiet_bi.py` (thêm `MayTo`, quan hệ `MayThietBi.to_dung_may`, property `to_ids`)
- Modify: `backend/app/models/cong_doan.py:158` (đổi tên quan hệ ghi được → `may_khai`; `may_lam_duoc` viewonly), `:349`
- Modify: `backend/app/repositories/cong_doan_repo.py:40,128,170-178` (ghi qua `may_khai`; selectinload cả hai)
- Modify: `backend/app/db_migrations.py` (cuối file, `0434_may_to`)
- Modify: `docs/DB_SCHEMA.md` (mục mới `may_to`, ghi chú `cong_doan.nhom_may_cho_phep` "không còn đọc")
- Test: `backend/tests/test_may_to.py` (mới)

**Interfaces:**
- Produces: `MayTo(may_id: int, department_id: int)` — `__tablename__ = "may_to"`, PK kép, FK `may_thiet_bi.id` CASCADE, FK `departments.id` CASCADE.
- Produces: `MayThietBi.to_ids: list[int]` (property đọc/ghi, cùng kiểu setter giữ dòng cũ như `CongDoan.department_ids`).
- Produces: `CongDoan.may_khai: list[CongDoanMay]` (ghi được, cascade delete-orphan, order `thu_tu`) và `CongDoan.may_lam_duoc: list[CongDoanMay]` (viewonly, order `thu_tu`) = dòng `may_khai` thỏa: công đoạn không có dòng `cong_doan_to` nào, HOẶC tồn tại `may_to` với `may_id` của dòng và `department_id` thuộc `cong_doan_to` của công đoạn. `CongDoanMay.cong_doan` back_populates `may_khai`.

- [ ] **Step 1: Viết test hỏng** — `test_may_to.py`, dựng bằng fixture `db`:
```python
def test_may_lam_duoc_loc_theo_to(db):
    # cd tick tổ A; máy M1 thuộc A, M2 thuộc B; cả hai có dòng cong_doan_may
    assert [r.may_id for r in cd.may_lam_duoc] == [m1.id]
    assert {r.may_id for r in cd.may_khai} == {m1.id, m2.id}

def test_may_hai_to_cung_tick_mot_dong(db):   # M thuộc A và B, cd tick A+B
    assert [r.may_id for r in cd.may_lam_duoc] == [m.id]

def test_cong_doan_khong_tick_to_giu_hanh_vi_cu(db):
    assert {r.may_id for r in cd.may_lam_duoc} == {m1.id, m2.id}

def test_bo_tick_roi_tick_lai_giu_cong_thuc(db):
    # dòng M1 có cong_thuc_gio="sl_vao"; cd.department_ids=[B] → M1 rơi; =[A] → M1 về, công thức còn
    assert cd.may_lam_duoc[0].cong_thuc_gio == "sl_vao"

def test_selectinload_may_lam_duoc(db):  # nạp nhiều cd bằng selectinload không lỗi, kết quả đúng như trên
```
- [ ] **Step 2:** `cd backend && python -m pytest tests/test_may_to.py -q` → FAIL (ImportError `MayTo`).
- [ ] **Step 3: Cài model + quan hệ + migration `0434_may_to` (CREATE TABLE IF NOT EXISTS, cả SQLite lẫn Postgres) + DB_SCHEMA.** `may_lam_duoc` viết bằng `relationship(..., viewonly=True, primaryjoin=and_(CongDoan.id == CongDoanMay.cong_doan_id, or_(~exists(cong_doan_to của cd), exists(may_to ⨝ cong_doan_to))))` — nếu selectinload không chạy với primaryjoin có EXISTS thì đổi sang `lazy="selectin"` cùng primaryjoin, hoặc chú thích rõ và dùng `secondary`; giữ nguyên tên/kiểu trả.
- [ ] **Step 4:** Chạy lại test mới → PASS. Chạy các file test đang dựng máy cho công đoạn: `python -m pytest tests/test_cong_doan.py tests/test_cong_doan_may.py tests/test_cong_doan_bon_cong_thuc_http.py tests/test_cong_thuc_ve_cong_doan.py tests/test_danh_muc_so_truy_van.py tests/test_import_excel.py tests/test_lsx_service.py tests/test_nhat_ky_cong_doan_bang_con.py tests/test_san_xuat_doi_may.py tests/test_xep_lich_lenh_service.py tests/test_bai_ghep_2_service.py tests/test_schema_documented.py -q`. Test hỏng vì ghi qua `cd.may_lam_duoc.append(...)` ⇒ đổi sang `may_khai`; test có tick tổ mà máy không thuộc tổ ⇒ thêm `MayTo` vào dữ liệu test (không sửa kỳ vọng).
- [ ] **Step 5: Commit** `feat(may-to): bảng máy thuộc tổ, máy của công đoạn lọc theo tổ đã tick (mg 0434)`

### Task 2: Module luật tổ × máy

**Files:**
- Create: `backend/app/services/may_to.py`
- Test: `backend/tests/test_may_to.py` (thêm)

**Interfaces:**
- Consumes: Task 1.
- Produces (mọi hàm nhận `db: Session`):
  - `to_cua_may(db, may_ids: Iterable[int]) -> dict[int, list[int]]`
  - `ten_to(db, department_ids: Iterable[int]) -> dict[int, str]`
  - `rang_buoc_to(cd: CongDoan | None) -> bool` — True khi công đoạn có tick tổ.
  - `may_chon_duoc(db, cd: CongDoan | None, department_id: int | None) -> list[int]` — `may_lam_duoc` của cd (thứ tự `thu_tu`), máy còn dùng, thuộc `department_id`; không ràng buộc tổ hoặc `department_id` None ⇒ mọi máy còn dùng của `may_lam_duoc` (cd None ⇒ []).
  - `may_mac_dinh(db, cd, department_id) -> int | None` — phần tử đầu của `may_chon_duoc`.
  - `to_cho_may(db, cd, may_id: int, uu_tien: int | None) -> int | None` — `uu_tien` nếu máy thuộc nó và nó nằm trong `cd.department_ids`; không thì tổ đầu theo `cd.department_ids` có máy; không có ⇒ None.
  - `loi_cap(db, cd, department_id, may_id) -> str | None` — None = hợp lệ (máy trống, tổ trống, hoặc không ràng buộc tổ cũng hợp lệ). Câu lỗi: `f"Máy {ma} không thuộc {ten_to}. Chọn máy của {ten_to} hoặc đổi tổ."`
  - `dong_bo_cong_doan_may(db, *, cong_doan_ids: Iterable[int] | None = None, may_ids: Iterable[int] | None = None) -> int` — tạo dòng `cong_doan_may` còn thiếu cho mọi cặp (cd, máy) mà máy thuộc một tổ cd tick; `thu_tu` = max hiện có + 1, theo mã máy; công thức trống; trả số dòng tạo. Không xoá dòng nào.

- [ ] **Step 1: Test hỏng** cho từng hàm, tối thiểu:
```python
assert may_chon_duoc(db, cd, to_A) == [m1.id]            # m2 thuộc B
assert may_chon_duoc(db, cd, to_A) == [m1.id]            # m3 thuộc A nhưng active=False → bị loại
assert may_mac_dinh(db, cd, to_B) == m2.id
assert to_cho_may(db, cd, m2.id, uu_tien=to_A) == to_B
assert to_cho_may(db, cd, m_chung.id, uu_tien=to_B) == to_B   # máy thuộc A+B, ưu tiên B
assert loi_cap(db, cd, to_A, m2.id) == "Máy M2 không thuộc Tổ A. Chọn máy của Tổ A hoặc đổi tổ."
assert loi_cap(db, cd_khong_to, to_A, m2.id) is None
assert dong_bo_cong_doan_may(db, may_ids=[m_moi.id]) == 1 and dong_bo_cong_doan_may(db, may_ids=[m_moi.id]) == 0
```
- [ ] **Step 2:** `python -m pytest tests/test_may_to.py -q` → FAIL.
- [ ] **Step 3:** Cài các hàm trong `services/may_to.py`; mọi truy vấn DB đặt ở `backend/app/repositories/may_to_repo.py` (mới), service gọi repo — đúng tầng routers → services → repositories.
- [ ] **Step 4:** Chạy lại → PASS.
- [ ] **Step 5: Commit** `feat(may-to): luật cặp tổ × máy dùng chung`

### Task 3: Danh mục Máy — ô "Tổ đứng máy" (BE)

**Files:**
- Modify: `backend/app/schemas/may_thiet_bi.py` (`MayThietBiIn.to_ids: list[int] | None = None` — None = giữ nguyên; `MayThietBiRow.to_ids: list[int] = []`)
- Modify: `backend/app/services/may_thiet_bi_service.py:54-125` (chuẩn hoá + kiểm tổ lá; sau lưu gọi `dong_bo_cong_doan_may(may_ids=[id])`)
- Modify: `backend/app/repositories/may_thiet_bi_repo.py` (ghi `to_ids`, selectinload `to_dung_may`)
- Modify: `backend/app/services/catalog_excel_specs.py` (máy: cột "Tổ đứng máy" nhập/xuất theo tên tổ, cùng cách tách danh sách các cột nhiều giá trị đang có)
- Modify: `backend/app/audit_registry.py` + `backend/app/services/nhat_ky_danh_muc.py` (nhãn `to_ids` của máy = "Tổ đứng máy"; đổi nhãn `nhom_may_cho_phep` không cần — field không còn ghi)
- Test: `backend/tests/test_may_thiet_bi_to.py` (mới)

**Interfaces:** Consumes Task 1, 2. Produces: `GET/POST/PUT /api/may-thiet-bi` mang `to_ids`.

- [ ] **Step 1: Test hỏng** (HTTP qua client test như các test danh mục khác):
```python
r = client.put(f"/api/may-thiet-bi/{m.id}", json={..., "to_ids": [to_A, to_B]}); assert r.json()["to_ids"] == [to_A, to_B]
assert client.put(..., json={..., "to_ids": [to_cha]}).status_code == 400          # không phải tổ lá
# cd tick A, chưa có dòng cho m ⇒ sau PUT có dòng cong_doan_may (cd, m)
# PUT không gửi to_ids ⇒ giữ nguyên
```
- [ ] **Step 2:** chạy → FAIL. **Step 3:** cài. **Step 4:** `python -m pytest tests/test_may_thiet_bi_to.py tests/test_import_excel.py -q` → PASS.
- [ ] **Step 5: Commit** `feat(may-to): khai tổ đứng máy ở danh mục máy`

### Task 4: Công đoạn (BE) — bỏ chọn máy tay, bỏ lọc nhóm máy

**Files:**
- Modify: `backend/app/repositories/cong_doan_repo.py:170-178` — `_replace_may` → `_ghi_may(cd, rows)`: UPSERT theo `may_id` vào `may_khai`, không xoá dòng; bỏ qua dòng mà máy không nằm trong phạm vi tổ khi cd có tick tổ.
- Modify: `backend/app/services/cong_doan_service.py:236-269` — bỏ kiểm theo `nhom_may_cho_phep`; giữ kiểm máy tồn tại + công thức hợp lệ; sau lưu gọi `dong_bo_cong_doan_may(cong_doan_ids=[cd.id])`.
- Modify: `backend/app/schemas/cong_doan.py:223` — `CongDoanRow` thêm `may_khai: list[CongDoanMayRow] = []` (form cần số của dòng nằm im để hiện ngay khi tick tổ).
- Modify: `backend/app/services/bai_ghep_service.py:1774-1810` (`may_ngoai_cong_doan`: bỏ nhánh ② nhóm máy), `:1634` (trả `[]`), `backend/app/services/san_xuat/thuc_thi.py:500` (`theo_cong_doan` = `bool(cd.may_lam_duoc)`)
- Modify: `backend/app/services/catalog_excel_specs.py:443,477-481,507` — bỏ cột "Nhóm máy cho phép"; "Máy của công đoạn" chỉ xuất, nhập bỏ qua.
- Test: `backend/tests/test_cong_doan_may.py` (thêm)
- Không sửa: `seed_rebuild.py`, `import_danh_muc_prod.py` vẫn ghi `nhom_may_cho_phep` — cột còn, không ai đọc, vô hại. Seed demo chưa khai `may_to` ⇒ trên DB trắng công đoạn có tổ sẽ chưa có máy cho tới khi người dùng khai; chấp nhận (spec §4.10).

- [ ] **Step 1: Test hỏng:**
```python
# lưu form chỉ gửi dòng M1 (trong phạm vi) ⇒ dòng M2 (nằm im, có cong_thuc_gio) vẫn còn trong may_khai
# tick thêm tổ B (có máy M3 chưa có dòng) ⇒ sau lưu có dòng (cd, M3)
# gửi nhom_may_cho_phep=["Bế"] ⇒ không ảnh hưởng máy chọn được của bài ghép / đổi máy
```
- [ ] **Step 2:** FAIL. **Step 3:** cài. **Step 4:** `python -m pytest tests/test_cong_doan_may.py tests/test_cong_doan.py tests/test_bai_ghep_2_service.py tests/test_san_xuat_doi_may.py tests/test_import_excel.py -q` → PASS.
- [ ] **Step 5: Commit** `feat(may-to): công đoạn lấy máy theo tổ, gỡ lọc nhóm máy`

### Task 5: Lệnh — tổ & máy mặc định, chặn cặp lệch, cảnh báo

**Files:**
- Modify: `backend/app/services/lsx_service.py` — `_may_mac_dinh` (`:623`) + `_default_buoc` (`:1488-1545`) + nơi dựng bước (`:1348-1368`, `:1694-1714`); `mac_dinh_buoc` (`:1865`); `replace_routing` (`:3189-3290`); `_soi_danh_muc` (`:3110-3120`)
- Modify: `backend/app/services/bai_ghep_service.py:784-840` (gộp: tổ chung theo máy điền sẵn), `:881-910` (`lap_ke_hoach_buoc_chung` kiểm cặp)
- Test: `backend/tests/test_lsx_may_to.py` (mới)

**Interfaces:** Consumes Task 2 (`may_chon_duoc`, `may_mac_dinh`, `to_cho_may`, `loi_cap`). Produces: `_to_va_may_mac_dinh(self, cd_obj, may_phieu: int | None, nhom: str | None) -> tuple[int | None, int | None]` trong `LsxService`; `_default_buoc` trả thêm khoá `department_id` cho bước máy, nơi gọi dùng giá trị này thay `to_mac_dinh_id`.

Luật (spec §4.6): bước `nhom=="print"` có máy phiếu nằm trong `may_lam_duoc` ⇒ máy = máy phiếu, tổ = `to_cho_may(cd, may_phieu, uu_tien=cd.to_mac_dinh_id)`; còn lại ⇒ tổ = `cd.to_mac_dinh_id`, máy = `may_mac_dinh(cd, tổ)`. Công đoạn không ràng buộc tổ ⇒ luật `_may_mac_dinh` hôm nay.

- [ ] **Step 1: Test hỏng:**
```python
# phiếu chọn IN-02 (thuộc 4 màu; cd In tick [2 màu, 4 màu]) ⇒ bước In: department=4 màu, may=IN-02
# phiếu không chọn máy ⇒ tổ 2 màu, máy = máy đầu thu_tu thuộc 2 màu
# mac_dinh_buoc trả cùng cặp
# replace_routing đổi may của bước In sang máy tổ khác ⇒ ValueError/400 với câu loi_cap
# bước lệch sẵn (dữ liệu chèn thẳng) + chỉ sửa ghi_chu ⇒ lưu được
# bước có công việc trang_thai đang chạy, đổi tổ ⇒ 400 "Việc đã bắt đầu ở bàn tổ — đổi máy ở bàn tổ"
# _soi_danh_muc trên bước lệch ⇒ muc["may_canh_bao"] == "Máy IN-02 không thuộc Nhóm thợ in máy 2 màu"
# gộp bài ghép bước In có máy điền sẵn thuộc 4 màu ⇒ bước chung department=4 màu
# lap_ke_hoach_buoc_chung cặp lệch ⇒ lỗi
```
- [ ] **Step 2:** FAIL. **Step 3:** cài (kiểm cặp chỉ khi bước mới hoặc tổ/máy/công đoạn đổi so với bản lưu, cùng chỗ kiểm tổ `:3236-3242`). **Step 4:** `python -m pytest tests/test_lsx_may_to.py tests/test_lsx_service.py tests/test_bai_ghep_2_service.py -q` → PASS.
- [ ] **Step 5: Commit** `feat(may-to): lệnh lấy tổ theo máy, chặn cặp tổ máy lệch`

### Task 6: Phát hành cập nhật đưa tổ + máy xuống việc chưa bắt đầu

**Files:**
- Modify: `backend/app/services/san_xuat/release_update.py:360-395`
- Test: `backend/tests/test_phat_hanh_cap_nhat_to_may.py` (mới)

**Interfaces:** Consumes `_cd_nguon(db, cv)` (`release_update.py:130`).

Luật: với mỗi công việc CHƯA bắt đầu, bước máy, không gia công ngoài: `cv.department_id = cd.department_id`, `cv.may_id = cd.may_id` (lấy từ bước kế hoạch qua `_cd_nguon`, KHÔNG từ `_lich_nguon`). Việc đổi tổ ⇒ đẩy SSE cho bàn tổ cũ lẫn mới (dùng đúng hàm đẩy SSE mà file đang dùng cho việc đổi giờ). Lịch sử `SanXuatCongViecLichSu` chụp trước như hiện có.

- [ ] **Step 1: Test hỏng:**
```python
# phát hành, đổi bước In sang (tổ 4 màu, IN-02), phát hành cập nhật ⇒ cv.department_id == to_4, cv.may_id == in02
# bước Bế đổi máy ⇒ việc Bế chưa bắt đầu cũng nhận máy mới
# việc gia công ngoài ⇒ may_id vẫn None
```
- [ ] **Step 2:** FAIL. **Step 3:** cài. **Step 4:** `python -m pytest tests/test_phat_hanh_cap_nhat_to_may.py tests/test_san_xuat_release_update.py tests/test_san_xuat_release.py tests/test_gia_cong_phat_hanh.py -q` → PASS.
- [ ] **Step 5: Commit** `fix(san-xuat): phát hành cập nhật đưa tổ và máy xuống việc chưa bắt đầu`

### Task 7: Bàn tổ — Đổi máy chỉ trong tổ (BE)

**Files:**
- Modify: `backend/app/services/san_xuat/thuc_thi.py:469-501` (`may_doi_duoc`), `:504-548` (`doi_may`)
- Modify: `backend/app/schemas/san_xuat.py` (item đổi máy thêm `to_khac: list[str] = []`)
- Test: `backend/tests/test_san_xuat_doi_may.py` (thêm)

Luật: ứng viên = `may_chon_duoc(db, cd, cv.department_id)` trừ máy đang gán; mỗi máy kèm `to_khac` = tên các tổ khác (ngoài `cv.department_id`) máy thuộc. `doi_may`: `loi_cap(...)` khác None ⇒ ValueError với câu đó.

- [ ] **Step 1: Test hỏng:**
```python
assert [i["id"] for i in may_doi_duoc(...)["items"]] == [in01b.id]   # chỉ máy cùng tổ 2 màu
assert item["to_khac"] == ["Nhóm thợ in máy 5 màu"]                  # máy chung hai tổ
with pytest.raises(ValueError, match="không thuộc"): doi_may(..., may_id_moi=in02.id)
```
- [ ] **Step 2:** FAIL. **Step 3:** cài. **Step 4:** `python -m pytest tests/test_san_xuat_doi_may.py -q` → PASS.
- [ ] **Step 5: Commit** `feat(san-xuat): đổi máy ở bàn tổ chỉ trong máy của tổ`

### Task 8: FE danh mục — ô "Tổ đứng máy" + bảng máy công đoạn theo tổ

**Files:**
- Modify: `frontend/src/pages/rebuildCatalogConfigs.tsx:238-370` (`CFG_MAY`: field `{ key: "to_ids", label: "Tổ đứng máy", type: "to-multi", group: "Thông tin chung" }` dùng cùng nguồn tổ với `department_ids` của công đoạn; cột lưới "Tổ đứng máy" mỗi tổ một chip, rỗng "—"), `:418-520` (`CFG_CONG_DOAN`: gỡ field `nhom_may_cho_phep` `:515`)
- Modify: `frontend/src/pages/danh-muc/fields/MayCuaCongDoan.tsx` — props mới `{ value, options, toDangTick: number[], mayKhai: MayCongDoanRow[], tenTo: Record<number,string>, congThucChung, onChange }`; bỏ `nhomChoPhep`, ô "＋ Chọn máy cho công đoạn", nút 🗑. Dòng hiển thị = máy (options, có `to_ids`) thuộc ít nhất một tổ trong `toDangTick` (không tick tổ nào ⇒ dòng `value` như cũ), số lấy từ `value` rồi `mayKhai` rồi mặc định; thứ tự theo `thu_tu`; mỗi dòng hiện chip tên tổ (tổ đang tick mà máy thuộc). Câu dưới bảng: "Máy hiện theo tổ đã tick. Thêm máy vào tổ ở danh mục Thiết bị & Máy móc." `onChange` trả đúng các dòng đang hiện.
- Modify: `frontend/src/pages/danh-muc/CatalogDrawer.tsx:337-343` (truyền props mới từ `form.department_ids`, `form.may_khai`)
- Modify: `frontend/src/api/client.ts` (kiểu máy `to_ids: number[]`, công đoạn `may_khai`)
- Test: `frontend/src/pages/danh-muc/fields/MayCuaCongDoan.test.tsx` (đang có — sửa test cũ về ô chọn máy/nút xoá, thêm test mới)

- [ ] **Step 1: Test hỏng (vitest + RTL):** tick [A] ⇒ thấy IN-01, không thấy IN-02; tick thêm B ⇒ IN-02 hiện với `cong_thuc_gio` lấy từ `mayKhai`; máy thuộc A+B tick cả hai ⇒ một dòng, hai chip tổ; không còn text "Chọn máy cho công đoạn".
- [ ] **Step 2:** `cd frontend && npx vitest run src/pages/danh-muc/fields/MayCuaCongDoan.test.tsx` → FAIL.
- [ ] **Step 3:** cài. **Step 4:** vitest file đó → PASS; `npx tsc --noEmit` sạch.
- [ ] **Step 5: Commit** `feat(may-to): form máy chọn tổ đứng máy, bảng máy công đoạn theo tổ`

### Task 9: FE lệnh & bài ghép — chọn tổ thì máy theo tổ

**Files:**
- Modify: `frontend/src/pages/lsxBuoc.ts:250-290` — `mayChonDuoc(mayRefs, cd: { mayChoPhep?: number[] | null; coRangBuocTo?: boolean } | null, toId: number | null, mayDangGan: number | null)`: bỏ nhánh nhóm máy; có ràng buộc tổ và `toId` ⇒ chỉ máy có `to_ids` chứa `toId` (thứ tự `mayChoPhep`); luôn giữ `mayDangGan`. Thêm `mayMacDinhCuaTo(mayRefs, cd, toId): number | null` (phần tử đầu, bỏ máy ngừng dùng).
- Modify: `frontend/src/pages/LsxDetailView.tsx:430-454` (refs máy mang `to_ids`; refs công đoạn mang `coRangBuocTo = toChoPhep.length > 0`)
- Modify: `frontend/src/pages/LsxBuocDrawer.tsx:264-293,801-858` (ô máy lọc theo tổ; mỗi lựa chọn có dòng phụ "cũng thuộc" + chip tổ khác; tổ không máy ⇒ câu "Tổ này chưa có máy chạy công đoạn này")
- Modify: `frontend/src/pages/LsxRoutingTable.tsx:308-354` (`doiCongDoan`), `:387` (`doiTo`: máy không thuộc tổ mới ⇒ `mayMacDinhCuaTo`, null nếu không có), `:397`
- Modify: `frontend/src/pages/BaiGhepBuocChungForm.tsx:194,521-535`
- Test: `frontend/src/pages/lsxBuoc.test.ts` (thêm; sửa test cũ của nhánh nhóm máy)

- [ ] **Step 1: Test hỏng:**
```ts
expect(mayChonDuoc(refs, cd, TO_2MAU, null).map(m => m.id)).toEqual([IN01])
expect(mayChonDuoc(refs, cd, TO_2MAU, IN02).map(m => m.id)).toEqual([IN01, IN02]) // giữ máy đang gán
expect(mayChonDuoc(refs, { mayChoPhep: [IN01, IN02], coRangBuocTo: false }, TO_2MAU, null).length).toBe(2)
expect(mayMacDinhCuaTo(refs, cd, TO_4MAU)).toBe(IN02)
expect(mayMacDinhCuaTo(refs, cd, TO_KHONG_MAY)).toBeNull()
```
- [ ] **Step 2:** vitest → FAIL. **Step 3:** cài. **Step 4:** vitest các file trên → PASS; `npx tsc --noEmit` sạch.
- [ ] **Step 5: Commit** `feat(may-to): bước lệnh và bài ghép chọn máy theo tổ`

### Task 10: FE bàn tổ — hộp Đổi máy

**Files:**
- Modify: `frontend/src/pages/ThsxDoiMay.tsx` (mỗi máy hiện chip `to_khac` dưới tên; danh sách rỗng ⇒ câu "Tổ không còn máy khác chạy công đoạn này. Việc chờ máy sửa xong." và khoá nút Đổi máy)
- Modify: `frontend/src/api/client.ts:2483` (kiểu item thêm `to_khac: string[]`)
- Test: `frontend/src/pages/ThsxDoiMay.test.tsx` (mới)

- [ ] **Step 1:** test hỏng: render với item `to_khac: ["Nhóm thợ in máy 5 màu"]` ⇒ thấy chip; `items: []` ⇒ thấy câu chờ sửa, nút Đổi máy disabled.
- [ ] **Step 2:** FAIL. **Step 3:** cài. **Step 4:** PASS + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(san-xuat): hộp đổi máy hiện tổ khác và báo khi tổ hết máy`

### Task 11: Bấm thử trọn luồng trên dev-browser

Worktree, BE 8010 (restart sau mọi sửa BE), FE 5174, DB clone riêng (memory `ui-test-worktree-db-sao-redis-rieng`), đăng nhập admin. KHÔNG dùng API/curl thay bước nào.

- [ ] Màn Thiết bị & Máy móc: IN-01 → tick "Nhóm thợ in máy 2 màu"; IN-02 → tick 4 màu và 5 màu; lưu; lưới hiện cột Tổ đứng máy đúng chip.
- [ ] Công đoạn In: không còn dải "Máy làm được công đoạn này" và nút "Chọn máy cho công đoạn"; bảng có IN-01, IN-02 (IN-02 hai chip tổ); bỏ tick 4 màu ⇒ IN-02 còn; bỏ thêm 5 màu ⇒ IN-02 rụng; tick lại ⇒ cách đo giờ "sl_vao" còn.
- [ ] Tạo lệnh từ phiếu tính giá chọn IN-02 ⇒ bước In ở tổ 4 màu, máy IN-02.
- [ ] Drawer bước In: đổi tổ sang 2 màu ⇒ máy nhảy IN-01, ô máy chỉ còn máy của 2 màu; lưu.
- [ ] Phát hành ⇒ bàn tổ 2 màu thấy việc, bàn tổ 4 màu không thấy.
- [ ] Bàn tổ 2 màu: Bắt đầu ⇒ ⋯ ⇒ Đổi máy: chỉ máy của 2 màu (hoặc câu "Tổ không còn máy khác…").
- [ ] Mở LSX26-0003 (lệnh cũ lệch trong DB clone) ⇒ băng "Danh mục đã đổi" có câu lệch; sửa ghi chú, lưu được.
- [ ] Báo cáo: liệt kê từng bước đã bấm / gõ / thấy.
