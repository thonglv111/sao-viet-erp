# Vật liệu đầu vào của lệnh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay ô "Nguồn giấy" bằng khối "Vật liệu đầu vào": mỗi vật liệu (giấy in, sóng) máy chấm điểm các khổ đang có trong kho, chọn sẵn phương án điểm cao nhất, người đổi được; bước chuẩn bị (Cắt cuộn, Tề) suy từ khổ lấy so với khổ cần; bảng Các bước vẽ lại cho gọn.

**Architecture:** Hàm thuần mới trong `chuan_bi_giay.py` dựng và chấm điểm phương án từ danh sách khổ tồn. Lệnh lưu khổ đang lấy của từng vật liệu (cột mới trên `lsx`), `nguon_giay` thành giá trị dẫn xuất để các chỗ đang đọc nó (bài ghép, dòng giấy, chặn bỏ khâu) chạy tiếp. Luật "bước nào là bồi" và "Tề sóng trừ lề bao nhiêu" chuyển thành cột trên danh mục công đoạn. FE: component mới `KhoiVatLieu` thay `ONguonGiay`; `LsxRoutingTable` đổi cột theo mockup.

**Tech Stack:** FastAPI + SQLAlchemy 2 (Postgres dev, SQLite trong pytest), React + Vite + TypeScript, Vitest.

> **Điều chỉnh khi làm (12/11/2026, đè lên các mục dưới nếu vênh):** không thêm cột khổ đang lấy trên `lsx`. Khổ giấy lấy lưu vào `quy_cach_json` (`kho_nguyen_rong/dai`, `so_manh_xa`) cùng `lsx.nguon_giay`; khổ sóng lấy lưu `quy_cach_json.song_kho_rong/dai`, lề ở `quy_cach_json.song_tru_le_mm`. Thay đổi DB duy nhất là `cong_doan.tru_le_mm` (migration 0474, Tề sóng mặc định 5). Giữ `CD_BOI`, không thêm cờ "bước bồi". Bài ghép giữ luật cũ. Lệnh cũ chưa có khoá sóng: lề lấy theo danh mục nếu chuỗi có Tề sóng, không thì 0; đổi sóng lần đầu thì ghi lề đó vào lệnh trước khi dựng lại chuỗi.

**Spec:** `docs/mockups/chuan-bi-vat-lieu.html` (bản chốt 12/11/2026) cùng các quyết định ghi ở mục "Luật đã chốt" dưới đây. Code nền: `backend/app/services/chuan_bi_giay.py`, `lsx_service.py` từ dòng ~2542 (KHÂU CHUẨN BỊ GIẤY).

## Luật đã chốt (đọc trước mọi task)

1. **Khổ cần.** Giấy in: khổ in của quy cách (`kho_in_rong`, `kho_in_dai`). Sóng: khổ in trừ `lsx.song_tru_le_mm` ở MỖI chiều (720 × 1020, lề 5 ⇒ 715 × 1015). Khổ so sánh qua `chuan_kho` (cạnh ngắn, cạnh dài).
2. **Ứng viên.** Lấy từ `StockLotRepository.ton_giay_theo_kho(hang_id)` (tờ hai cạnh, cuộn rộng-0), tồn = tồn tự do (`GiuChoService.ton_tu_do`). Luôn thêm ứng viên "tờ đúng khổ cần" kể cả tồn 0 (thay cho "Mua mới": thiếu thì Kế hoạch vật tư đề nghị mua). Sóng chỉ xét tờ, không xét cuộn. Bỏ ứng viên không chứa nổi một mảnh khổ cần.
3. **Số mảnh.** Tờ W × H chứa khổ cần w × h: `max(floor(W/w)·floor(H/h), floor(W/h)·floor(H/w))`. Cuộn rộng r: cắt ra tờ r × h (mảnh `floor(r/w)`) hoặc r × w (mảnh `floor(r/h)`), lấy cách nhiều mảnh hơn, hoà thì cách thừa ít hơn.
4. **Bước chuẩn bị.** Tờ đúng khổ cần ⇒ không bước. Tờ to hơn ⇒ Tề (giấy `TGI`, sóng `TS`), `so_manh_xa` của bước Tề = số mảnh của phương án. Cuộn (chỉ giấy) ⇒ `CGC` rồi `TGI` (giữ luật L-SX-21: cuộn luôn qua Tề vì chuỗi đơn vị).
5. **Lượng cần ở kho.** Tờ: `ceil(số tờ vào bước sau khâu / số mảnh)`. Cuộn: `kg_tu_to(số tờ cắt, r, cạnh cắt, gsm)` làm tròn lên 0,01. Khi chấm điểm (trước chuỗi ngược) dùng `so_luong_vao` của In (giấy) hoặc của bước bồi (sóng); dòng vật tư thật vẫn do `_dong_bo_dong_giay` ghi sau chuỗi ngược.
6. **Điểm 100** = tồn 50 (đủ thì 50, thiếu thì `50 × tồn/cần`) + bước 30 (`max(0, 30 − 10 × số bước)`) + thừa 20 (`max(0, 20 × (1 − tỉ lệ thừa / 0,5))`, tỉ lệ thừa = `(diện tích lấy − mảnh × w × h) / (mảnh × w × h)`, cuộn tính trên tờ r × cạnh cắt). Làm tròn số nguyên. Xếp điểm giảm dần, hoà thì ít bước trước, rồi thừa ít trước. Trả tối đa 8.
7. **Chọn sẵn.** Lúc tạo lệnh (chỗ đang gọi `_chon_nguon_giay`) lấy phương án đứng đầu. Sau đó KHÔNG tự chọn lại khi tồn đổi; chỉ chọn lại khi người bấm "Về phương án tốt nhất", khi đổi lề làm khổ đang lấy nhỏ hơn khổ cần, hoặc khi quy cách đổi khổ in/giấy/sóng (đường dựng lại lệnh hiện có).
8. **`nguon_giay` dẫn xuất.** Tờ đúng khổ ⇒ `to_in`, tờ to hơn ⇒ `to_nguyen`, cuộn ⇒ `cuon`. Không còn giá trị `mua` cho lệnh mới.
9. **Khoá đổi.** Đúng các cửa của `doi_nguon_giay` hiện nay: không quyền, đã phát hành, đã đóng, trọn gói, đang giữ chỗ, đang sửa chuỗi chưa lưu, đang trong bài ghép.
10. **Sóng đúng khổ** ⇒ không có Tề sóng; dòng sóng gắn vào bước bồi đầu tiên với khổ cần.

## Global Constraints

- Không Alembic: cột mới viết migration `0474_vat_lieu_dau_vao` trong `backend/app/db_migrations.py`; mọi cột mới thêm vào `docs/DB_SCHEMA.md`.
- `SEED_DEMO=false` thì không seed gì; migration chỉ được backfill dòng đã có.
- Mọi chữ trên UI tiếng Việt; không dùng chữ "Máy chọn"; không nối mẩu dữ liệu bằng dấu `·` hay dấu phẩy; không chữ đậm.
- Tên người, quyền và số do máy chủ quyết; FE không tự tính điểm hay bước.
- Backend kiểm bằng `python -m pytest tests/<file> -q` từ `backend/`; frontend `npx tsc --noEmit` và `npx vitest run <file>` từ `frontend/`. Không chạy cả bộ pytest, không chạy `./init.ps1`.
- Commit tiếng Việt, tiền tố `feat`/`fix`, chỉ `git add` đúng file của task, không `Co-Authored-By`.
- Sửa route/schema backend thì khởi động lại uvicorn (WMI, kiểm uvicorn trùng trước).

## Review Focus

1. Kho chưa có khổ nào của mã: vẫn có đúng một phương án "tờ đúng khổ cần" tồn 0, lệnh lưu được, dòng giấy vẫn sinh nhu cầu cho Kế hoạch vật tư. Test ở Task 1 và Task 3.
2. Tờ khổ nguyên chứa 2 mảnh trở lên: lượng cần chia đúng số mảnh, bước Tề có `so_manh_xa` đúng, chuỗi ngược ra đúng số tờ in. Test ở Task 1 và Task 3.
3. Đổi lề sóng tới mức khổ đang lấy thành nhỏ hơn khổ cần (lề âm hoặc rất lớn bị chặn 0–50 mm): máy chọn lại phương án đầu, không lưu tuyến hỏng. Test ở Task 3.
4. Lệnh kiểu cũ (`nguon_giay` NULL, tự khai bước cắt trước In) mở ra không vỡ: khối vật liệu hiện "Lệnh tự khai bước chuẩn bị, không đổi ở đây". Test ở Task 3 và Task 7.
5. Lệnh không có sóng hoặc không có bước bồi: khối chỉ có dòng giấy, không chèn Tề sóng. Test ở Task 3.

---

### Task 1: Hàm thuần dựng và chấm điểm phương án

**Files:**
- Modify: `backend/app/services/chuan_bi_giay.py`
- Test: `backend/tests/test_chuan_bi_giay.py`

**Interfaces:**
- Produces:
  - `class KhoLay(NamedTuple): dang: str  # "to" | "cuon"; rong: int; dai: int  # cuộn: dai = 0`
  - `class PhuongAn(NamedTuple): kho: KhoLay; so_manh: int; canh_cat: int | None; ma_buoc: list[str]; can: float; don_vi: str  # "to" | "kg"; ton: float; diem: int; thua: float`
  - `def so_manh(kho: KhoLay, kho_can: tuple[int, int]) -> tuple[int, int | None]` trả `(mảnh, cạnh cắt của cuộn hoặc None)`
  - `def ma_buoc_lay(vat_lieu: str, kho: KhoLay, kho_can: tuple[int, int]) -> list[str]` (`vat_lieu` là `"giay"` | `"song"`)
  - `def phuong_an_lay(vat_lieu: str, kho_can: tuple[int, int], so_to_can: int, gsm: float, ton: list[tuple[int, int, str, float]]) -> list[PhuongAn]` — `ton` là `[(rộng, dài, đơn vị gốc, tồn tự do)]`, trả tối đa 8 theo luật 2–6.
  - `def nguon_dan_xuat(kho: KhoLay, kho_can: tuple[int, int]) -> str`

- [ ] **Step 1: Viết test thất bại** — thêm vào `test_chuan_bi_giay.py`:

```python
def test_so_manh_to_mot_va_hai_manh():
    assert so_manh(KhoLay("to", 790, 1090), (720, 1020)) == (1, None)
    assert so_manh(KhoLay("to", 1040, 1440), (720, 1020)) == (2, None)  # xoay: 1040/1020 * 1440/720

def test_so_manh_cuon_chon_cach_nhieu_manh():
    assert so_manh(KhoLay("cuon", 1450, 0), (720, 1020)) == (2, 1020)

def test_phuong_an_xep_theo_diem_va_chon_dau():
    ton = [(720, 1020, "to", 800), (760, 1060, "to", 1800), (790, 1090, "to", 2400), (750, 0, "kg", 3200)]
    ds = phuong_an_lay("giay", (720, 1020), 1560, 300, ton)
    assert [p.diem for p in ds] == sorted((p.diem for p in ds), reverse=True)
    assert ds[0].kho == KhoLay("to", 760, 1060) and ds[0].ma_buoc == [CD_TE_GIAY_IN]
    dung_kho = next(p for p in ds if p.kho == KhoLay("to", 720, 1020))
    assert dung_kho.ma_buoc == [] and dung_kho.ton == 800 and dung_kho.can == 1560
    cuon = next(p for p in ds if p.kho.dang == "cuon")
    assert cuon.ma_buoc == [CD_CAT_CUON, CD_TE_GIAY_IN] and cuon.don_vi == "kg"

def test_kho_trong_van_co_to_dung_kho_ton_0():
    ds = phuong_an_lay("giay", (720, 1020), 1560, 300, [])
    assert len(ds) == 1 and ds[0].kho == KhoLay("to", 720, 1020) and ds[0].ton == 0

def test_song_bo_cuon_va_kho_nho():
    ton = [(715, 1015, "to", 1800), (700, 1000, "to", 3000), (900, 0, "kg", 999)]
    ds = phuong_an_lay("song", (715, 1015), 1500, 560, ton)
    assert [p.kho for p in ds] == [KhoLay("to", 715, 1015)] and ds[0].diem == 100

def test_toi_da_8_phuong_an():
    ton = [(720 + i * 10, 1020 + i * 10, "to", 5000) for i in range(12)]
    assert len(phuong_an_lay("giay", (720, 1020), 1000, 300, ton)) == 8

def test_nguon_dan_xuat():
    assert nguon_dan_xuat(KhoLay("to", 1020, 720), (720, 1020)) == "to_in"
    assert nguon_dan_xuat(KhoLay("to", 790, 1090), (720, 1020)) == "to_nguyen"
    assert nguon_dan_xuat(KhoLay("cuon", 750, 0), (720, 1020)) == "cuon"
```

- [ ] **Step 2: Chạy, thấy FAIL** — `python -m pytest tests/test_chuan_bi_giay.py -q` từ `backend/`. Expected: ImportError `KhoLay`.
- [ ] **Step 3: Viết code** trong `chuan_bi_giay.py` theo luật 2–6 và 8. Giữ nguyên `chon_nguon`, `NguonChon`, `dong_giay_buoc_dau` cho bài ghép (Task 5). Docstring đầu file ghi thêm luật chấm điểm.
- [ ] **Step 4: Chạy, thấy PASS** — cùng lệnh, cả test cũ trong file vẫn xanh.
- [ ] **Step 5: Commit** — `git add backend/app/services/chuan_bi_giay.py backend/tests/test_chuan_bi_giay.py`; `feat(lenh-sx): chấm điểm phương án khổ trong kho cho giấy in và sóng`.

### Task 2: Cột mới và cờ trên danh mục công đoạn

**Files:**
- Modify: `backend/app/models/lsx.py`, `backend/app/models/cong_doan.py`, `backend/app/db_migrations.py`, `docs/DB_SCHEMA.md`, `backend/app/schemas/cong_doan.py` (In/Out của danh mục, tìm đúng file khai `so_to_bu_hao`), `backend/app/services/lsx_service.py` (`_id_boi`)
- Test: `backend/tests/test_vat_lieu_dau_vao_migration.py` (mới)

**Interfaces:**
- Produces:
  - `Lsx.giay_lay_rong: int | None`, `Lsx.giay_lay_dai: int | None`, `Lsx.song_lay_rong: int | None`, `Lsx.song_lay_dai: int | None`, `Lsx.song_tru_le_mm: int | None` (cuộn ghi `dai = 0`)
  - `CongDoan.la_buoc_boi: bool` (mặc định False), `CongDoan.tru_le_mm: int | None`
  - `LsxService._id_boi()` đọc `CongDoan.la_buoc_boi = True` thay cho `CD_BOI`

- [ ] **Step 1: Viết test thất bại**:

```python
def test_migration_dat_co_boi_va_le_te_song(db_seeded):
    run_migration(db_seeded, "0474_vat_lieu_dau_vao")
    assert {c.ma for c in db_seeded.query(CongDoan).filter_by(la_buoc_boi=True)} >= set(CD_BOI) & ma_co_san
    assert db_seeded.query(CongDoan).filter_by(ma=CD_TE_SONG).one().tru_le_mm == 5

def test_migration_backfill_kho_lay_tu_nguon_cu(db_seeded, lenh_to_nguyen, lenh_cuon_750, lenh_to_in, lenh_co_te_song):
    # quy cách khổ in 720 × 1020, khổ nguyên 790 × 1090
    run_migration(db_seeded, "0474_vat_lieu_dau_vao")
    assert (lenh_to_in.giay_lay_rong, lenh_to_in.giay_lay_dai) == (720, 1020)
    assert (lenh_to_nguyen.giay_lay_rong, lenh_to_nguyen.giay_lay_dai) == (790, 1090)
    assert (lenh_cuon_750.giay_lay_rong, lenh_cuon_750.giay_lay_dai) == (750, 0)
    assert (lenh_co_te_song.song_lay_rong, lenh_co_te_song.song_lay_dai, lenh_co_te_song.song_tru_le_mm) == (720, 1020, 0)
```

Dùng fixture và helper chạy migration theo khuôn của test migration gần nhất trong `backend/tests` (tìm `run_migration`/`_m04` đang có, đừng tự chế).

- [ ] **Step 2: Chạy, thấy FAIL.**
- [ ] **Step 3: Viết code.** Migration `0474_vat_lieu_dau_vao`: ALTER thêm 5 cột `lsx` + 2 cột `cong_doans`; UPDATE `la_buoc_boi = true` cho mã trong `CD_BOI`; UPDATE `tru_le_mm = 5` cho mã `TS`; backfill `giay_lay_*` theo `nguon_giay` (`to_in` ⇒ khổ in, `to_nguyen`/`mua` ⇒ khổ nguyên quy cách, `cuon` ⇒ rộng từ dòng giấy ở bước CGC, 0); lệnh có bước TS ⇒ `song_lay_* = khổ in`, `song_tru_le_mm = 0` (giữ đúng hành vi cũ, không tự đổi lệnh đang chạy). Raw SQL đích danh cột, đọc inspector trước lệnh ghi đầu tiên (bẫy SQLite). Số migration: nếu `0473` của phiên khác chưa commit lúc làm thì vẫn lấy `0474`, không đổi số của họ. `CD_BOI` giữ lại làm dữ liệu migration, code chạy không đọc nó nữa. DB_SCHEMA thêm 7 dòng cột.
- [ ] **Step 4: Chạy PASS** — file mới + `tests/test_schema_documented.py`.
- [ ] **Step 5: Commit** — `feat(danh-muc): cờ bước bồi và lề trừ của Tề sóng, cột khổ đang lấy của lệnh`.

### Task 3: Lệnh dựng khâu theo khổ đang lấy

**Files:**
- Modify: `backend/app/services/lsx_service.py` (khối KHÂU CHUẨN BỊ GIẤY, `_dong_giay_khau_chuan_bi`, chỗ tạo lệnh gọi `_chon_nguon_giay`)
- Test: `backend/tests/test_lenh_vat_lieu_dau_vao.py` (mới), chạy lại `test_lenh_chuan_bi_giay.py`, `test_khvt_chuan_bi_giay.py`, `test_vat_tu_chip_so_truy_van.py`

**Interfaces:**
- Consumes: Task 1 (`KhoLay`, `phuong_an_lay`, `ma_buoc_lay`, `nguon_dan_xuat`), Task 2 (cột).
- Produces:
  - `LsxService.kho_can(lsx, vat_lieu: str) -> tuple[int, int] | None`
  - `LsxService.phuong_an_vat_lieu(lsx) -> dict` dạng `{"giay": {...} | None, "song": {...} | None, "khoa": str | None}`; mỗi vật liệu: `{"ten_hang": str, "kho_can": [w, h], "so_to_can": int, "vao_buoc": str, "tru_le_mm": int | None, "dang_lay": KhoLay-dict, "ds": [PhuongAn-dict], "tot_nhat": bool, "tu_khai": bool}`
  - `LsxService.doi_vat_lieu(*, lsx_id: int, vat_lieu: str, rong: int | None, dai: int | None, tru_le_mm: int | None, ve_tot_nhat: bool, actor) -> Lsx`
  - `_dung_khau_chuan_bi(lsx, lay_giay: KhoLay | None, lay_song: KhoLay | None)` (đổi chữ ký; bài ghép gọi qua adapter Task 5)

- [ ] **Step 1: Viết test thất bại** (dựng lệnh qua fixture tạo lệnh có sẵn trong `test_lenh_chuan_bi_giay.py`, tồn qua lô kho thật):

```python
def test_tao_lenh_chon_san_phuong_an_diem_cao_nhat(...):  # tồn 760×1060 đủ, 720×1020 thiếu
    assert (lsx.giay_lay_rong, lsx.giay_lay_dai) == (760, 1060) and lsx.nguon_giay == "to_nguyen"
    assert ten_cac_buoc(lsx)[:2] == ["Tề giấy in", "In"]

def test_song_dung_kho_khong_chen_te_song_dong_song_o_buoc_boi(...):  # lề 5, kho có 715×1015
    assert "Tề sóng" not in ten_cac_buoc(lsx)
    assert dong_song(lsx).cong_doan == buoc_boi(lsx) and (dong_song.kho_rong, dong_song.kho_dai) == (715, 1015)

def test_doi_sang_cuon_dung_lai_cgc_tgi_va_kg(...):
    svc.doi_vat_lieu(lsx_id=lsx.id, vat_lieu="giay", rong=750, dai=0, tru_le_mm=None, ve_tot_nhat=False, actor=u)
    assert ten_cac_buoc(lsx)[:3] == ["Cắt giấy cuộn", "Tề giấy in", "In"] and dong_giay(lsx).don_vi_goc == "kg"

def test_to_hai_manh_chia_luong_can(...):  # chỉ có 1040×1440
    assert dong_giay(lsx).so_luong == ceil(so_to_vao_te / 2) and buoc_te(lsx).so_manh_xa == 2

def test_doi_le_lam_kho_dang_lay_nho_hon_thi_chon_lai(...):
    svc.doi_vat_lieu(..., vat_lieu="song", rong=None, dai=None, tru_le_mm=0, ...)  # 715×1015 không còn chứa 720×1020
    assert (lsx.song_lay_rong, lsx.song_lay_dai) != (715, 1015)

def test_le_ngoai_0_50_bi_chan(...):  # 51 ⇒ LsxValidationError "Lề trừ từ 0 đến 50 mm"

def test_ve_tot_nhat_chon_lai_theo_ton_hien_tai(...)

def test_khoa_khi_giu_cho_phat_hanh_bai_ghep(...):  # mỗi cửa một LsxConflict, câu đổi "đổi nguồn giấy" thành "đổi vật liệu đầu vào"

def test_lenh_tu_khai_khong_doi_duoc(...):  # phuong_an_vat_lieu(...)["giay"]["tu_khai"] is True; doi_vat_lieu ⇒ LsxConflict

def test_khong_song_hoac_khong_boi_chi_co_giay(...):  # phuong_an_vat_lieu(...)["song"] is None, không có Tề sóng

def test_kho_trong_lenh_van_luu_va_co_nhu_cau(...):  # kho rỗng ⇒ giay_lay = khổ in, dòng giấy so_luong > 0
```

- [ ] **Step 2: Chạy, thấy FAIL.**
- [ ] **Step 3: Viết code.**
  - Tồn cho chấm điểm: một lượt `ton_giay_theo_kho` mỗi mã + một lượt `ton_tu_do` cho mọi khoá (khuôn `_chon_nguon_theo_ton`).
  - Tạo lệnh: thay `_chon_nguon_giay` bằng chọn `phuong_an_lay(...)[0]` cho giấy và (nếu có `song_id` và bước bồi) cho sóng; ghi cột `*_lay_*`; `song_tru_le_mm` mặc định `CongDoan(TS).tru_le_mm or 0`.
  - `_dung_khau_chuan_bi`: chèn bước theo `ma_buoc_lay`; Tề lấy `so_manh_xa` = số mảnh qua `_them_buoc_he_thong(lsx, ma, so_manh=...)`; sóng có bước ⇒ TS trước bồi như cũ, không bước ⇒ gắn dòng sóng vào bước bồi đầu; ghi `lsx.nguon_giay = nguon_dan_xuat(...)`.
  - `_dong_giay_khau_chuan_bi`: khổ và đơn vị lấy từ cột `*_lay_*` (tờ ⇒ khổ lấy, số `ceil(vào / mảnh)`; cuộn ⇒ kg theo luật 5); sóng ở bước bồi khi không có TS ⇒ tờ khổ cần.
  - `doi_vat_lieu`: các cửa khoá như `doi_nguon_giay` (luật 9) + kiểm phương án gửi lên nằm trong danh sách hiện tại; gỡ khâu (giấy: CGC/TGI; sóng: TS) rồi dựng lại, `_ap_chuoi_nguoc`, `_kiem_tuyen_luu`, `_bung_lai_vat_tu`, cập nhật trạng thái thiếu, nhật ký `action="doi_vat_lieu_dau_vao"` với câu "Đổi giấy in lệnh X: Tờ 790 × 1090 → Cuộn rộng 750" hoặc "Đổi lề sóng lệnh X: 5 → 3 mm". Xoá `doi_nguon_giay` và `_NHAN_NGUON` khi không còn ai gọi.
  - `phuong_an_vat_lieu`: `tot_nhat` = phương án đang lấy trùng `ds[0]`; `khoa` = câu khoá đầu tiên trúng (luật 9) hoặc None.
- [ ] **Step 4: Chạy PASS** file mới và ba file chạy lại; `test_vat_tu_chip_so_truy_van.py` nếu tăng số câu thì tìm chỗ hỏi lặp, không nới ngưỡng.
- [ ] **Step 5: Commit** — `feat(lenh-sx): lệnh dựng khâu chuẩn bị theo khổ đang lấy ở kho, sóng có lề trừ, bỏ chọn nguồn giấy`.

### Task 4: API khối vật liệu

**Files:**
- Modify: `backend/app/routers/lsx.py` (thay `PUT /{lsx_id}/nguon-giay`), `backend/app/schemas/lsx.py`
- Test: `backend/tests/test_lenh_vat_lieu_dau_vao_api.py` (mới); xoá hoặc chuyển `test_lenh_doi_nguon_giay.py` sang API mới

**Interfaces:**
- Produces:
  - `GET /api/lsx/{lsx_id}/vat-lieu-dau-vao` → `VatLieuDauVaoOut` (khuôn dict Task 3; quyền đọc như `GET /api/lsx/{id}`)
  - `PUT /api/lsx/{lsx_id}/vat-lieu-dau-vao` body `DoiVatLieuIn{vat_lieu: Literal["giay","song"], rong: int|None, dai: int|None, tru_le_mm: int|None, ve_tot_nhat: bool = False}` → `LsxOut` (quyền như PUT nguon-giay cũ; `LsxConflict` ⇒ 409, `LsxValidationError` ⇒ 400)
- [ ] **Step 1: Test thất bại**: GET trả `giay.ds[0].diem` lớn nhất và `dang_lay`; PUT đổi sang cuộn trả `LsxOut` có bước "Cắt giấy cuộn"; PUT khi giữ chỗ ⇒ 409; người không quyền sửa ⇒ 403; `PUT /nguon-giay` ⇒ 404 (đã gỡ).
- [ ] **Step 2: FAIL.** **Step 3: Code.** **Step 4: PASS** (kèm `tests/test_lsx_router*.py` nào đang import schema cũ). Khởi động lại uvicorn.
- [ ] **Step 5: Commit** — `feat(lenh-sx): API xem và đổi vật liệu đầu vào của lệnh`.

### Task 5: Bài ghép đi qua adapter

**Files:**
- Modify: `backend/app/services/bai_ghep_service.py` (`_dung_lai_khau_lenh`, `_dung_khau_chuan_bi_bai`, `_tra_khau_rieng`), `backend/app/services/chuan_bi_giay.py`
- Test: chạy lại `backend/tests/test_bai_ghep_chuan_bi_giay.py`

**Interfaces:**
- Produces: `def kho_lay_tu_nguon(nguon: NguonChon, dv: DauVaoGiay) -> KhoLay` (`to_in` ⇒ khổ in, `to_nguyen`/`mua` ⇒ khổ nguyên, `cuon` ⇒ `KhoLay("cuon", rong, 0)`).
- [ ] **Step 1:** thêm test `test_kho_lay_tu_nguon` vào `test_chuan_bi_giay.py` cho bốn nguồn. **Step 2:** FAIL.
- [ ] **Step 3:** bài ghép giữ luật chọn nguồn cũ (bài đang ẩn bằng `BAI_GHEP_ENABLED`), chỉ đổi chỗ gọi `_dung_khau_chuan_bi` sang `KhoLay` qua adapter; `_tra_khau_rieng` dùng chọn sẵn Task 3 cho lệnh rời bài.
- [ ] **Step 4:** PASS cả `test_bai_ghep_chuan_bi_giay.py`. **Step 5:** Commit `refactor(bai-ghep): dựng khâu chuẩn bị qua khổ lấy của lệnh`.

### Task 6: Danh mục công đoạn khai cờ bồi và lề trừ

**Files:**
- Modify: `frontend/src/pages/rebuildCatalogConfigs.tsx` (form công đoạn), `frontend/src/api/client.ts` (kiểu công đoạn)
- Test: test form công đoạn đang có cạnh file (tìm `rebuildCatalogConfigs.test.tsx` hoặc test danh mục công đoạn), `npx tsc --noEmit`

- [ ] **Step 1:** test: form có ô tick "Là bước bồi (cần sóng)" và ô số "Trừ lề mỗi chiều (mm)" (0–50, để trống là không trừ), lưu gửi `la_buoc_boi`, `tru_le_mm`. **Step 2:** FAIL.
- [ ] **Step 3:** thêm hai ô vào nhóm thông tin công đoạn, chữ giải thích: "Lệnh có sóng sẽ cần một bước bồi để nhận sóng" và "Tề sóng dùng số này làm lề mặc định cho lệnh mới".
- [ ] **Step 4:** PASS + tsc. **Step 5:** Commit `feat(danh-muc): khai bước bồi và lề trừ ở danh mục công đoạn`.

### Task 7: Khối Vật liệu đầu vào trên tab Công đoạn

**Files:**
- Create: `frontend/src/pages/KhoiVatLieu.tsx`, `frontend/src/pages/KhoiVatLieu.test.tsx`
- Modify: `frontend/src/pages/LsxDetailView.tsx` (bỏ `ONguonGiay`, truyền `KhoiVatLieu` vào `dauChuoi`), `frontend/src/api/client.ts` (`api.lsx.vatLieuDauVao`, `api.lsx.doiVatLieu`, kiểu `VatLieuDauVao`), `frontend/src/pages/ke-hoach-sx.css`
- Delete: `frontend/src/pages/ONguonGiay.tsx`, `frontend/src/pages/ONguonGiay.test.tsx`

**Interfaces:**
- Consumes: API Task 4.
- Produces: `KhoiVatLieu({ lsxId: number, token: string, khoaNgoai: string | null, phienBan: number, onDoi: (lsx: LsxDetail) => void })` — `khoaNgoai` là câu khoá phía FE (đang sửa chuỗi chưa lưu, không quyền); `phienBan` đổi thì tải lại.

- [ ] **Step 1: Test thất bại** (mock API):
  - hiện bảng 5 cột "Vật liệu, Lấy ở kho, Chuẩn bị, Vào bước, Tồn / cần"; dòng giấy ghi "Tờ 760 × 1060", chip "Tề giấy in", "1.800 / 1.560 tờ";
  - không có chữ "Máy chọn" ở đâu;
  - bấm ô mở hộp 8 phương án, cột "Khổ trong kho, Chuẩn bị, Tồn kho, Điểm", dòng đang lấy có dấu chọn;
  - chọn phương án khác gọi `doiVatLieu` đúng `rong`, `dai`; khi `tot_nhat` false có nút "Về phương án tốt nhất" gửi `ve_tot_nhat: true`;
  - thiếu ⇒ số đỏ và dòng "thiếu 760";
  - sóng đúng khổ ⇒ "Không cần, đúng khổ"; ô "trừ lề" gửi `tru_le_mm` khi rời ô;
  - có `khoa` ⇒ ô chọn tắt và câu khoá hiện ngay dưới bảng;
  - `tu_khai` ⇒ dòng ghi "Lệnh tự khai bước chuẩn bị, không đổi ở đây".
- [ ] **Step 2: FAIL** — `npx vitest run src/pages/KhoiVatLieu.test.tsx`.
- [ ] **Step 3: Code** theo mockup (CSS lấy token thật của `tokens.css`, không chép màu cứng của mockup). Hộp phương án đóng khi bấm ra ngoài hoặc Esc.
- [ ] **Step 4: PASS** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(lenh-sx): khối Vật liệu đầu vào thay ô Nguồn giấy`.

### Task 8: Bảng Các bước vẽ lại

**Files:**
- Modify: `frontend/src/pages/LsxRoutingTable.tsx` (dòng ~775–1060), `frontend/src/pages/ke-hoach-sx.css`
- Create: `frontend/src/pages/nhanhBuoc.ts`, `frontend/src/pages/nhanhBuoc.test.ts`
- Test: `frontend/src/pages/LsxRoutingTable.test.tsx` (sửa câu hỏi theo cột mới)

**Interfaces:**
- Produces: `nhanhCuaBuoc(rows: {key: string; phu_thuoc_step_keys: string[]; vat_tus: {hang_loai: string; vat_tu_id: number}[]}[], giayId: number | null, songId: number | null): Record<string, "giay" | "song" | "gop" | null>` — bước gốc chứa dòng giấy (hoặc mọi bước con chỉ đi xuống từ nó) là `giay`, tương tự `song`; bước có tổ tiên ở cả hai nhánh là `gop`; lệnh không sóng trả `null` cho mọi bước (không vẽ cột Nhánh).

- [ ] **Step 1: Test thất bại**:
  - `nhanhBuoc.test.ts`: chuỗi Tề giấy in → In → Bồi ← Tề sóng ra `giay, giay, gop, song`; lệnh không sóng ra toàn `null`.
  - `LsxRoutingTable.test.tsx`: đầu cột là "Công đoạn, Nhánh, Bộ phận làm, Số lượng, Làm sau"; không còn chữ "Nội bộ", "Gốc / song song", "+ ghi chú"; bước nội bộ chỉ ghi tên bộ phận, bước gia công ngoài có chip "Gia công ngoài" kèm tên nhà gia công; số lượng vào bằng ra ghi một số; bước đầu nhánh ghi "Bắt đầu", bước nối thẳng dòng trên để trống, bước gộp ghi "In và Tề sóng"; số vật tư hiện "3 vật tư" và bấm mở tab Vật tư; bấm ô Bộ phận làm vẫn đổi được loại và bộ phận (hộp gộp hai lựa chọn cũ "loai" và "to"); nút ghi chú chỉ hiện khi rê chuột hoặc khi bước đã có ghi chú (có ghi chú thì hiện chữ ghi chú).
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Code.** Giữ nguyên kéo thả, Alt+↑↓, menu ⋯, ngăn chi tiết, số "danh mục đã đổi", hệ số quy đổi (dòng phụ nhỏ dưới số lượng). Vạch màu nhánh 3 px ở mép trái ô số thứ tự. Bước chuẩn bị (CGC/TGI/TS) nền cam nhạt và chip "Chuẩn bị". Chân bảng thêm câu "Ô Làm sau để trống là làm ngay sau bước ở dòng trên." Bảng không còn cuộn ngang ở khung 1180 px.
- [ ] **Step 4: PASS** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(lenh-sx): bảng công đoạn gọn lại: vạch nhánh, bỏ chữ Nội bộ, số lượng một dòng, cột Làm sau`.

### Task 9: Tài liệu Kế hoạch sản xuất

**Files:**
- Modify: `docs/huong-dan-ke-hoach-sx/huong-dan-ke-hoach-san-xuat.tex` (đoạn ~346 Nguồn giấy, ~368 ô lý do, mọi chỗ nói "Gốc / song song", "Tiền nhiệm", "Nội bộ"), ảnh tab Công đoạn trong `hinh/` (chụp lại bằng kịch bản `kich-ban/`), PDF biên dịch lại; `docs/huong-dan-kinh-doanh` hoặc tài liệu danh mục nếu có mô tả form công đoạn (grep "Tề sóng", "bồi").
- [ ] **Step 1:** viết lại đoạn: khối Vật liệu đầu vào, cách máy chấm điểm (50/30/20), đổi phương án, Về phương án tốt nhất, lề sóng, thiếu thì Kế hoạch vật tư lo; bảng Các bước theo cột mới.
- [ ] **Step 2:** chụp lại ảnh bằng thao tác thật trên dev, `xelatex` hai lượt, `python kich-ban/kiem-lien-ket.py D:/jobs/SVN/docs` ra "tong 7 hong 0".
- [ ] **Step 3:** Commit `docs(ke-hoach-sx): vật liệu đầu vào và bảng công đoạn mới`.

### Task 10: Bấm thử luồng thật

- [ ] Trên `http://localhost:5173` (admin), mở một lệnh nháp có giấy và sóng: thấy khối vật liệu đúng phương án đứng đầu; đổi giấy sang cuộn, thấy Cắt giấy cuộn và Tề giấy in chèn vào bảng, tab Vật tư có dòng kg; bấm "Về phương án tốt nhất"; sửa lề sóng 5 → 0 và thấy Tề sóng xuất hiện hoặc mất theo khổ; lệnh đang giữ chỗ thì ô chọn tắt kèm câu khoá; mở Kế hoạch vật tư thấy nhu cầu đúng khổ mới. Ghi từng bước đã bấm, đã gõ, đã thấy vào báo cáo.

## Theo dõi

| Task | Trạng thái |
| --- | --- |
| 1 Hàm chấm điểm | chưa |
| 2 Cột và cờ danh mục | chưa |
| 3 Lệnh dựng khâu | chưa |
| 4 API | chưa |
| 5 Bài ghép adapter | chưa |
| 6 Danh mục công đoạn FE | chưa |
| 7 Khối Vật liệu đầu vào | chưa |
| 8 Bảng Các bước | chưa |
| 9 Tài liệu | chưa |
| 10 Bấm thử | chưa |
