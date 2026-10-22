"""Thực hiện sản xuất — VIỆC KHOÁN của mẻ (§7.1 · §7.2 · §7.2b, 18/09/2026).

Thợ ghi mẻ theo CÔNG VIỆC KHOÁN, không theo công đoạn nữa. Chủ xưởng 18/09/2026: *"dưới sản xuất
sẽ xuất hiện tất cả các công việc khoán ở tổ đó, chỉ chọn được một trong đó… nhớ là phải hiển thị
cả đơn giá, đơn vị tính, ghi chú và danh sách việc phát sinh của việc đó"*.

Ba việc ở đây:
  1. `danh_sach_cua_to` — rổ việc cho form ghi mẻ, kèm việc phát sinh của từng việc. Ô tìm TƯƠNG
     ĐỐI (bỏ dấu, khớp một phần) và HIỆN CHO MỌI TỔ, kể cả tổ chỉ có một việc.
  2. `chuan_hoa_khi_ghi` — kiểm + CHỤP ảnh (tên · đơn vị · đơn giá) của việc khoán và của từng
     việc phát sinh, lúc thợ bấm Ghi mẻ.
  3. `danh_muc_doi` + `cap_nhat_theo_danh_muc` — băng "Danh mục đã đổi so với lúc ghi mẻ": so NỘI
     DUNG với danh mục sống, và chỉ đổi ảnh chụp KHI NGƯỜI BẤM.

**KHÔNG có phép nhân nào ở đây.** Ảnh chụp đơn giá chỉ trả lời "lúc ghi mẻ việc này treo giá bao
nhiêu" — giá CỦA TỔ ghi (bảng giá theo tổ, 21/10/2026); tiền tính ở `services/khoan_ky.py` lúc
tính lương kỳ. Việc phát sinh KHÔNG BAO GIỜ cộng vào sản
lượng — không tiến độ, không KCS, không bàn giao, không nhập kho (*"chỗ việc phát sinh như lên
khuôn không cộng vào sản lượng"*).
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.san_xuat_san_luong import SanXuatBatchPhatSinh
from ...repositories.cong_viec_khoan_repo import CongViecKhoanRepository
from ...repositories.don_vi_do_repo import DonViDoRepository, nhan_don_vi
from ...repositories.tim_khong_dau import bo_dau
from ..lsx_danh_muc_doi import o_lech

#: Ba ô đem so của VIỆC KHOÁN và của MỖI việc phát sinh (§7.2b). Nhãn là câu người đọc trên băng.
_O_SO = (("ten", "tên việc"), ("don_vi", "đơn vị"), ("don_gia", "đơn giá"))
#: Cấu hình Khoán của công đoạn còn so thêm GIÁ CỐ ĐỊNH của tổ và CÔNG THỨC (21/10/2026), BẬC GIÁ
#: (22/10/2026).
_O_SO_KHOAN = (*_O_SO, ("gia_co_dinh", "giá cố định"), ("cong_thuc", "công thức"), ("bac", "bậc giá"))


def _anh_chup(ten, don_vi, don_gia, gia_co_dinh=None) -> dict:
    """Ảnh chụp chuẩn hoá của một dòng — CÙNG hình dạng cho việc khoán và việc phát sinh, để `o_lech`
    so được cả hai bằng một bộ ô."""
    return {
        "ten": (ten or "").strip() or None,
        "don_vi": (don_vi or "").strip() or None,
        "don_gia": None if don_gia is None else float(don_gia),
        "gia_co_dinh": None if gia_co_dinh is None else float(gia_co_dinh),
    }


def gia_cua_to(khoan, department_id: int | None,
               bac: str | None = None) -> tuple[float | None, float | None]:
    """(giá cố định, đơn giá) của MỘT tổ cho cấu hình Khoán của công đoạn.

    Bảng giá theo tổ rỗng ⇒ mọi tổ dùng cả hai giá chung (giá cố định chung, Đợt 2). Đã khai dòng
    nào thì tổ vắng mặt là THIẾU GIÁ ⇒ `(None, None)` — không lấy giá chung đoán thay.

    Công đoạn CHIA BẬC (22/10/2026): giá là ô (tổ, `bac`). Không có bậc (lệnh không khớp bậc nào)
    hoặc ô trống ⇒ thiếu giá; giá chung không dùng."""
    bang = khoan.gia_theo_to or []
    if khoan.bac_gia:
        if not bac:
            return None, None
        bang = [r for r in bang if r.get("bac") == bac]
    elif not bang:
        return float(khoan.gia_co_dinh or 0), float(khoan.unit_price)
    for r in bang:
        if department_id is not None and int(r.get("department_id") or 0) == int(department_id):
            don_gia = r.get("don_gia")
            return float(r.get("gia_co_dinh") or 0), (None if don_gia is None else float(don_gia))
    return None, None


def _mau_lenh(qc: dict | None) -> tuple[float, float]:
    """(số màu, số màu pha) của quy cách lệnh / bài để chọn bậc.

    Số màu = SỐ KẼM MỘT TAY, đúng chip `so_mau` bên Tính giá (chủ chốt 22/10/2026: "phải giống số
    kẽm như tính giá, sau này sai sửa cho dễ") — cùng hàm `dem_mau_cong_thuc` qua `ngu_canh_lenh`:
    1 mặt và tự trở / trở nhíp đếm hợp mực, AB đếm hai mặt cộng lại (AB 4/4 ra 8)."""
    from ..bien_cong_thuc import ngu_canh_lenh

    ctx = ngu_canh_lenh(qc or {})
    return float(ctx.get("so_mau") or 0), float(ctx.get("so_mau_pha") or 0)


def _khop_bac(b: dict, so_mau: float, pha: float, tuy_chon: dict) -> bool:
    if so_mau <= 0:
        return False
    if b.get("mau_tu") is not None and so_mau < float(b["mau_tu"]):
        return False
    if b.get("mau_den") is not None and so_mau > float(b["mau_den"]):
        return False
    if b.get("pha") and (pha > 0) != (b["pha"] == "co"):
        return False
    if b.get("tuy_chon_ma") and b.get("tuy_chon_co"):
        bat = float(tuy_chon.get(b["tuy_chon_ma"]) or 0) != 0
        if bat != (b["tuy_chon_co"] == "co"):
            return False
    return True


def anh_bac(khoan, qc: dict | None, tuy_chon: dict | None) -> dict | None:
    """Bậc giá của một lần ghi — ảnh chụp `{ma, ten, gom_uv, so_mau, so_mau_pha}`.

    Bậc xét từ trên xuống, bậc khớp ĐẦU TIÊN thắng. Không bậc nào khớp (8 màu, việc không neo lệnh)
    ⇒ `ma`/`ten` None: vẫn ghi được sản lượng, lương báo thiếu giá kèm số màu. Công đoạn không chia
    bậc ⇒ None."""
    if khoan is None or not khoan.bac_gia:
        return None
    so_mau, pha = _mau_lenh(qc)
    tc = dict(tuy_chon or {})
    for b in khoan.bac_gia:
        if _khop_bac(b, so_mau, pha, tc):
            return {"ma": b["ma"], "ten": b.get("ten"), "gom_uv": bool(b.get("gom_uv")),
                    "so_mau": so_mau, "so_mau_pha": pha}
    return {"ma": None, "ten": None, "gom_uv": False, "so_mau": so_mau, "so_mau_pha": pha}


def bac_theo_chon(khoan, qc: dict | None, department_id: int | None) -> list[dict]:
    """Giá của tổ ứng với MỌI tổ hợp bật/tắt của các tuỳ chọn mà bậc giá xét tới — hộp ghi đổi giá
    ngay khi thợ tick (Mực UV ⇒ bậc Pantone UV), khỏi gọi lại máy chủ. Phần tử đầu = mọi tuỳ chọn
    tắt. Công đoạn không chia bậc ⇒ []."""
    if khoan is None or not khoan.bac_gia:
        return []
    mas = list(dict.fromkeys(b["tuy_chon_ma"] for b in khoan.bac_gia if b.get("tuy_chon_ma")))
    ra = []
    for n in range(2 ** len(mas)):
        chon = {ma: float((n >> i) & 1) for i, ma in enumerate(mas)}
        bac = anh_bac(khoan, qc, chon)
        gia_cd, don_gia = gia_cua_to(khoan, department_id, bac["ma"])
        ra.append({"chon": chon, "bac_ma": bac["ma"], "bac_ten": bac["ten"],
                   "so_mau": bac["so_mau"], "so_mau_pha": bac["so_mau_pha"],
                   "gia_co_dinh": float(gia_cd or 0), "don_gia": float(don_gia or 0),
                   "thieu_gia": don_gia is None})
    return ra


def mo_ta_mau(bac: dict | None) -> str:
    """"lệnh 4 màu, 1 màu pha" — câu cho thợ / kế toán, số màu là màu MỘT lượt máy."""
    if not bac:
        return ""
    so_mau, pha = float(bac.get("so_mau") or 0), float(bac.get("so_mau_pha") or 0)
    if so_mau <= 0:
        return "lệnh chưa có số màu in"
    return f"lệnh {so_mau:g} màu" + (f", {pha:g} màu pha" if pha > 0 else "")


def quy_cach_cua_viec(db: Session, cv) -> dict:
    """Bộ biến quy cách của lệnh / bài ghép mà công việc chạy — đúng đường tính lương dùng
    (`KhoanKyService._quy_cach`), để bậc chọn lúc ghi và lúc tính là một."""
    from ...repositories.khoan_ky_repo import KhoanKyRepository
    from ..khoan_ky import KhoanKyService

    lenh = KhoanKyRepository(db).lenh_theo_id({int(cv.lsx_id)} if cv.lsx_id else set())
    return KhoanKyService(db)._quy_cach(cv, lenh, {})


def gia_ps_cua_to(ps, department_id: int | None) -> float | None:
    """Đơn giá việc phát sinh của MỘT tổ — cùng luật với `gia_cua_to`."""
    bang = ps.gia_theo_to or []
    if not bang:
        return float(ps.don_gia)
    for r in bang:
        if department_id is not None and int(r.get("department_id") or 0) == int(department_id):
            return None if r.get("don_gia") is None else float(r["don_gia"])
    return None


def _anh_khoan_cd_song(khoan, department_id: int | None, bac: dict | None = None) -> dict:
    gia_cd, don_gia = gia_cua_to(khoan, department_id, (bac or {}).get("ma"))
    return {**_anh_chup(khoan.cong_doan.ten, khoan.unit, don_gia, gia_cd),
            "cong_thuc": (khoan.cong_thuc_khoan or "").strip(),
            "bac": (bac or {}).get("ten")}


def _tuy_chon_cua_me(b) -> dict[str, float]:
    return {t["ma"]: t.get("gia_tri") or 0 for t in (b.tuy_chon_khoan or []) if t.get("ma")}


def _bac_song(db: Session, khoan, b, cv=None) -> dict | None:
    """Bậc "nếu ghi bây giờ" của một lần ghi: quy cách hiện tại của lệnh + tuỳ chọn đã chọn."""
    if not khoan.bac_gia:
        return None
    if cv is None:
        from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository

        cv = SanXuatSanLuongRepository(db).cong_viec(b.cong_viec_id)
    qc = quy_cach_cua_viec(db, cv) if cv is not None else {}
    return anh_bac(khoan, qc, _tuy_chon_cua_me(b))


def _anh_ps_cd_song(ps, department_id: int | None) -> dict:
    return _anh_chup(ps.ten, ps.don_vi, gia_ps_cua_to(ps, department_id))


def _anh_khoan_song(rate) -> dict:
    """Ảnh "nếu ghi bây giờ" của một công việc khoán — đọc danh mục SỐNG."""
    return _anh_chup(rate.ten, rate.unit, rate.unit_price)


def _anh_ps_song(ps) -> dict:
    return _anh_chup(ps.ten, ps.don_vi, ps.don_gia)


def _dong_phat_sinh(ps, dv_ten: dict[str, str]) -> dict:
    """Một dòng việc phát sinh cho form: TÊN · ĐƠN GIÁ · ĐVT — đúng ba thứ chủ xưởng dặn phải hiện."""
    return {
        "id": ps.id,
        "ten": ps.ten,
        "don_gia": float(ps.don_gia),
        "don_vi": ps.don_vi,
        "don_vi_ten": nhan_don_vi(dv_ten, ps.don_vi),
    }


def danh_sach_cua_to(db: Session, *, department_id: int | None, tim: str | None = None) -> list[dict]:
    """Việc khoán của một tổ cho form Ghi mẻ — mỗi dòng kèm việc phát sinh của chính nó.

    Ô tìm lọc TRONG BỘ NHỚ bằng `bo_dau`: danh sách một tổ đo trên DB dev là 1–17 dòng, đi thêm một
    vòng SQL chỉ để lọc 17 dòng thì đắt hơn phép lọc. Khớp cả MÃ và TÊN — xưởng gọi việc bằng mã
    (`KH-0013`) nhiều như gọi bằng tên.

    Đường này chỉ giữ để đọc dữ liệu mẻ cũ; form ghi mẻ mới dùng cấu hình Khoán của Công đoạn.
    """
    rates = CongViecKhoanRepository(db).theo_to(department_id)
    if not rates:
        return []
    dv_ten = DonViDoRepository(db).ten_theo_ma()
    kim = bo_dau(tim)
    ra: list[dict] = []
    for r in rates:
        if kim and kim not in bo_dau(f"{r.ma or ''} {r.ten}"):
            continue
        ra.append({
            "id": r.id,
            "ma": r.ma,
            "ten": r.ten,
            "don_gia": float(r.unit_price),
            "don_vi": r.unit,
            # Cột giữ MÃ đơn vị (`to`, `kem`); tổ đọc câu này nên bày TÊN ("tờ", "bản kẽm").
            "don_vi_ten": nhan_don_vi(dv_ten, r.unit),
            "ghi_chu": r.note,
            "phat_sinh": [_dong_phat_sinh(ps, dv_ten) for ps in r.viec_phat_sinh],
        })
    return ra


def chuan_hoa_khi_ghi(
    db: Session, *, khoan, ten_cong_doan: str | None, phat_sinh: list[dict] | None,
    department_id: int | None = None, tuy_chon: dict[str, float] | None = None,
    qc: dict | None = None,
) -> tuple[dict, list[SanXuatBatchPhatSinh]]:
    """Chụp cấu hình Khoán của công đoạn vào mẻ đang ghi — giá CỦA TỔ `department_id`.

    Không có cấu hình vẫn ghi sản lượng bình thường. Chỉ khi gửi việc phát sinh mà công đoạn chưa
    cấu hình Khoán mới từ chối, vì không có danh mục nguồn để kiểm và chụp giá. Tổ chưa có dòng
    trong bảng giá theo tổ thì VẪN ghi được (sản xuất chỉ ghi số lượng) — giá chụp None, kỳ lương
    báo thiếu giá.

    `tuy_chon` = giá trị thợ chọn cho các "tuỳ chọn khi ghi" của công đoạn (Đợt 2), chụp thành
    `tuy_chon_khoan` — xem `anh_chup_tuy_chon`.

    `qc` = quy cách của lệnh / bài (`quy_cach_cua_viec`) — công đoạn chia bậc chọn bậc từ đây cộng
    tuỳ chọn, chụp vào `bac_khoan_snapshot`, giá là ô (tổ, bậc).
    """
    if khoan is None:
        if tuy_chon:
            raise ValueError("Công đoạn chưa cấu hình Khoán nên không có tuỳ chọn khi ghi.")
        if any(r.get("phat_sinh_id") for r in (phat_sinh or [])):
            raise ValueError("Công đoạn chưa cấu hình Khoán nên không thể ghi việc phát sinh.")
        return ({
            "piece_rate_id": None,
            "khoan_cong_doan_id": None,
            "ten_khoan_snapshot": None,
            "don_vi_khoan_snapshot": None,
            "don_gia_khoan_snapshot": None,
            "gia_co_dinh_khoan_snapshot": None,
            "tuy_chon_khoan": None,
            "cong_thuc_khoan_snapshot": None,
            "bac_khoan_snapshot": None,
        }, [])

    tc_anh = anh_chup_tuy_chon(khoan, tuy_chon)
    bac = anh_bac(khoan, qc, {t["ma"]: t["gia_tri"] for t in (tc_anh or [])})
    gia_cd, don_gia = gia_cua_to(khoan, department_id, (bac or {}).get("ma"))
    o_snapshot = {
        "piece_rate_id": None,
        "khoan_cong_doan_id": khoan.id,
        "ten_khoan_snapshot": (ten_cong_doan or "").strip() or None,
        "don_vi_khoan_snapshot": khoan.unit,
        "don_gia_khoan_snapshot": don_gia,
        "gia_co_dinh_khoan_snapshot": gia_cd,
        "tuy_chon_khoan": tc_anh,
        # Công thức chụp như giá (chủ chốt 21/10/2026). Bỏ trống ⇒ "" (khác NULL của lần ghi cũ).
        "cong_thuc_khoan_snapshot": (khoan.cong_thuc_khoan or "").strip(),
        "bac_khoan_snapshot": bac,
    }

    hop_le = {ps.id: ps for ps in khoan.viec_phat_sinh}
    rows: list[SanXuatBatchPhatSinh] = []
    da_co: set[int] = set()
    for r in (phat_sinh or []):
        psid = r.get("phat_sinh_id")
        if not psid:
            continue
        ps = hop_le.get(int(psid))
        if ps is None:
            raise ValueError("Việc phát sinh không thuộc cấu hình Khoán của công đoạn này.")
        if int(psid) in da_co:
            raise ValueError(f'Việc phát sinh "{ps.ten}" bị chọn hai lần.')
        try:
            sl = float(r.get("so_luong"))
        except (TypeError, ValueError):
            raise ValueError(f'Số lượng của "{ps.ten}" không hợp lệ.')
        if sl <= 0:
            raise ValueError(f'Số lượng của "{ps.ten}" phải lớn hơn 0.')
        da_co.add(int(psid))
        anh_ps = _anh_ps_cd_song(ps, department_id)
        rows.append(SanXuatBatchPhatSinh(
            phat_sinh_id=ps.id, so_luong=sl,
            ten_snapshot=anh_ps["ten"], don_vi_snapshot=anh_ps["don_vi"],
            don_gia_snapshot=anh_ps["don_gia"],
        ))
    return o_snapshot, rows


def anh_chup_tuy_chon(khoan, tuy_chon: dict[str, float] | None) -> list[dict] | None:
    """Ảnh chụp tuỳ chọn khi ghi: mỗi tuỳ chọn KHAI ở công đoạn một phần tử `{ma, ten, kieu,
    gia_tri}` — thiếu ⇒ 0, "Có / không" ép 0/1. Công đoạn không khai tuỳ chọn ⇒ None.

    Mã gửi lên không có trong khai là lỗi: tuỳ chọn đó công thức không dùng, tiền ra khác điều thợ
    tưởng."""
    khai = list(khoan.tuy_chon or []) if khoan is not None else []
    gui = dict(tuy_chon or {})
    la = sorted(set(gui) - {t["ma"] for t in khai})
    if la:
        raise ValueError(f"Tuỳ chọn không có ở công đoạn: {', '.join(la)}")
    if not khai:
        return None
    ra = []
    for t in khai:
        try:
            v = float(gui.get(t["ma"]) or 0)
        except (TypeError, ValueError):
            raise ValueError(f'Giá trị của "{t["ten"]}" không hợp lệ.')
        if t.get("kieu") == "co_khong":
            v = 1.0 if v else 0.0
        elif v < 0:
            raise ValueError(f'"{t["ten"]}" không được âm.')
        ra.append({"ma": t["ma"], "ten": t["ten"], "kieu": t.get("kieu") or "co_khong", "gia_tri": v})
    return ra


def _anh_khoan_cua_me(b, song: dict | None = None) -> dict:
    """Ảnh chụp của lần ghi. `song` = ảnh danh mục đang so: lần ghi trước mg 0431 chưa chụp công
    thức (NULL) vốn tính bằng công thức hiện tại, nên coi như khớp — không báo lệch giả."""
    anh = _anh_chup(b.ten_khoan_snapshot, b.don_vi_khoan_snapshot, b.don_gia_khoan_snapshot,
                    getattr(b, "gia_co_dinh_khoan_snapshot", None))
    ct = getattr(b, "cong_thuc_khoan_snapshot", None)
    anh["cong_thuc"] = (song or {}).get("cong_thuc") if ct is None else ct.strip()
    anh["bac"] = (getattr(b, "bac_khoan_snapshot", None) or {}).get("ten")
    return anh


def chup_lai_bac(db: Session, b, khoan, cv) -> bool:
    """Tuỳ chọn của lần ghi vừa đổi (Sửa số) ⇒ chọn lại bậc. Bậc đổi thì giá lấy ô (tổ, bậc MỚI)
    ở danh mục hiện tại — bậc cũ không còn đúng việc thợ đã làm. Trả True nếu bậc đổi."""
    if khoan is None or not khoan.bac_gia:
        return False
    moi = _bac_song(db, khoan, b, cv)
    if (moi or {}).get("ma") == (b.bac_khoan_snapshot or {}).get("ma"):
        return False
    b.bac_khoan_snapshot = moi
    b.gia_co_dinh_khoan_snapshot, b.don_gia_khoan_snapshot = gia_cua_to(
        khoan, cv.department_id, (moi or {}).get("ma"))
    return True


def _anh_ps_cua_me(r) -> dict:
    return _anh_chup(r.ten_snapshot, r.don_vi_snapshot, r.don_gia_snapshot)


def nap_doi_chieu(
    db: Session, *, department_id: int | None, ps_rows: list[SanXuatBatchPhatSinh],
) -> tuple[dict, dict]:
    """Nạp MỘT lần cho cả drawer: việc khoán của tổ (kể cả đã ngừng) + việc phát sinh sống mà các
    mẻ trỏ tới. Không nạp sẵn thì `danh_muc_doi` hỏi DB hai lần cho MỖI mẻ — việc chạy vài chục mẻ
    là vài chục truy vấn chỉ để vẽ một băng thường rỗng."""
    repo = CongViecKhoanRepository(db)
    return (
        {int(r.id): r for r in repo.theo_to(department_id, chi_active=False)},
        repo.phat_sinh_theo_id([r.phat_sinh_id for r in ps_rows]),
    )


def _nhan_o(ten: str | None, o: dict) -> str:
    """Nhãn một ô lệch trong băng: "Đơn giá của Bế máy nhỏ" — câu, không nối bằng dấu "·"."""
    muc = o["nhan"]
    return f"{muc[:1].upper()}{muc[1:]} của {ten}" if ten else muc[:1].upper() + muc[1:]


def danh_muc_doi(
    db: Session, b, ps_rows: list[SanXuatBatchPhatSinh], *, department_id: int | None,
    nap: tuple[dict, dict] | None = None,
) -> list[dict]:
    """Băng "Danh mục đã đổi so với lúc ghi mẻ" (§7.2b) — `[]` = ảnh chụp còn khớp danh mục.

    So NỘI DUNG (`o_lech` → `_chuan` + sai số `1e-9`), KHÔNG so `updated_at`: cùng lý do đã ghi ở
    `lsx_danh_muc_doi` — `piece_rates` có `updated_at` nhưng `cong_viec_khoan_phat_sinh` thì không,
    nên so mốc là im lặng đúng lúc cần nói nhất.

    Đọc việc khoán bằng `chi_active=False`: việc đã NGỪNG DÙNG vẫn phải đọc được tên/giá mới của
    nó, không thì mẻ cũ báo "đã xoá" oan. Việc phát sinh vắng hẳn trong danh mục thì báo *"đã xoá
    khỏi danh mục"* — KHÔNG tự gỡ khỏi mẻ. `nap` = kết quả `nap_doi_chieu` khi gọi cho nhiều mẻ.
    """
    if b.khoan_cong_doan_id:
        from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository

        khoan = SanXuatSanLuongRepository(db).khoan_cong_doan(b.khoan_cong_doan_id)
        if khoan is None:
            return [{
                "nhan": f'{b.ten_khoan_snapshot or "Cấu hình Khoán"} — đã xoá khỏi công đoạn',
                "truong": "khoan_cong_doan", "cu": None, "moi": None, "mat": True,
            }]
        ra: list[dict] = []
        anh_song = _anh_khoan_cd_song(khoan, department_id, _bac_song(db, khoan, b))
        for o in o_lech(_anh_khoan_cua_me(b, anh_song), anh_song, _O_SO_KHOAN):
            ra.append({**o, "nhan": _nhan_o(khoan.cong_doan.ten, o), "mat": False})
        song = {int(ps.id): ps for ps in khoan.viec_phat_sinh}
        for r in ps_rows:
            ps = song.get(int(r.phat_sinh_id))
            if ps is None:
                ra.append({
                    "nhan": f'{r.ten_snapshot or "Việc phát sinh"} — đã xoá khỏi cấu hình Khoán',
                    "truong": "phat_sinh", "cu": None, "moi": None, "mat": True,
                })
                continue
            for o in o_lech(_anh_ps_cua_me(r), _anh_ps_cd_song(ps, department_id), _O_SO):
                ra.append({**o, "nhan": _nhan_o(ps.ten, o), "mat": False})
        return ra
    if not b.piece_rate_id:
        return []
    rates, song = nap or nap_doi_chieu(db, department_id=department_id, ps_rows=ps_rows)
    rate = rates.get(int(b.piece_rate_id))
    ra: list[dict] = []
    if rate is None:
        ra.append({"nhan": f'{b.ten_khoan_snapshot or "Công việc khoán"} — đã xoá khỏi danh mục',
                   "truong": "piece_rate", "cu": None, "moi": None, "mat": True})
    else:
        for o in o_lech(_anh_khoan_cua_me(b), _anh_khoan_song(rate), _O_SO):
            ra.append({**o, "nhan": _nhan_o(rate.ten, o), "mat": False})

    for r in ps_rows:
        ps = song.get(int(r.phat_sinh_id))
        if ps is None:
            ra.append({"nhan": f'{r.ten_snapshot or "Việc phát sinh"} — đã xoá khỏi danh mục',
                       "truong": "phat_sinh", "cu": None, "moi": None, "mat": True})
            continue
        for o in o_lech(_anh_ps_cua_me(r), _anh_ps_song(ps), _O_SO):
            ra.append({**o, "nhan": _nhan_o(ps.ten, o), "mat": False})
    return ra


def cap_nhat_theo_danh_muc(db: Session, *, user, batch_id: int) -> dict:
    """Bấm "Cập nhật theo danh mục": ảnh chụp của mẻ lấy số MỚI, ghi vết vào nhật ký.

    Không bấm thì mẻ giữ số cũ VÔ HẠN và băng treo đó — *hệ không bao giờ tự đổi số dưới chân mẻ
    đã ghi*. Dòng đã bị xoá khỏi danh mục thì giữ nguyên ảnh chụp (không có số mới để lấy) — nó
    vẫn là vết của việc thợ đã làm thật.
    """
    from ...repositories.audit_repo import AuditLogRepository
    from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
    from .thuc_thi import _gate

    sl = SanXuatSanLuongRepository(db)
    b = sl.batch(batch_id)
    if b is None:
        raise ValueError("Không tìm thấy lần ghi sản lượng.")
    cv = sl.cong_viec(b.cong_viec_id)
    if cv is None:
        raise ValueError("Không tìm thấy công việc của lần ghi sản lượng.")
    _gate(db, user, cv)
    if b.khoan_cong_doan_id:
        khoan = sl.khoan_cong_doan(b.khoan_cong_doan_id)
        if khoan is None:
            raise ValueError("Cấu hình Khoán của công đoạn không còn tồn tại.")
        doi: list[str] = []
        bac = _bac_song(db, khoan, b, cv)
        moi = _anh_khoan_cd_song(khoan, cv.department_id, bac)
        if o_lech(_anh_khoan_cua_me(b, moi), moi, _O_SO_KHOAN):
            b.bac_khoan_snapshot = bac
            b.ten_khoan_snapshot = moi["ten"]
            b.don_vi_khoan_snapshot = moi["don_vi"]
            b.don_gia_khoan_snapshot = moi["don_gia"]
            b.gia_co_dinh_khoan_snapshot = moi["gia_co_dinh"]
            b.cong_thuc_khoan_snapshot = moi["cong_thuc"]
            # Công thức mới đọc bộ tuỳ chọn KHAI mới: giữ giá trị thợ đã chọn ở mã còn khai, mã mới = 0.
            da_chon = {t["ma"]: t.get("gia_tri") for t in (b.tuy_chon_khoan or []) if t.get("ma")}
            con_khai = {t["ma"] for t in (khoan.tuy_chon or []) if t.get("ma")}
            b.tuy_chon_khoan = anh_chup_tuy_chon(
                khoan, {ma: v for ma, v in da_chon.items() if ma in con_khai})
            doi.append(f"khoan_cong_doan={khoan.id}")
        ps_rows = sl.phat_sinh_cua_batch(b.id)
        song = {int(ps.id): ps for ps in khoan.viec_phat_sinh}
        for r in ps_rows:
            ps = song.get(int(r.phat_sinh_id))
            if ps is None:
                continue
            anh_ps = _anh_ps_cd_song(ps, cv.department_id)
            if o_lech(_anh_ps_cua_me(r), anh_ps, _O_SO):
                r.ten_snapshot = anh_ps["ten"]
                r.don_vi_snapshot = anh_ps["don_vi"]
                r.don_gia_snapshot = anh_ps["don_gia"]
                doi.append(f"phat_sinh={ps.id}")
        AuditLogRepository(db).create(
            actor_user_id=getattr(user, "id", None),
            action="san_xuat_me_cap_nhat_danh_muc",
            target=f"san_xuat_batch:{b.id}",
            detail=f"cong_viec={cv.id} " + (" ".join(doi) if doi else "khong_co_gi_lech"),
        )
        db.commit()
        return {
            "cong_viec_id": cv.id, "department_id": cv.department_id,
            "trang_thai": cv.trang_thai, "version": cv.version,
            "batch_id": b.id, "ket_qua_lsx": [],
        }
    if not b.piece_rate_id:
        raise ValueError("Lần ghi này chưa khai công việc khoán — không có gì để cập nhật.")

    repo = CongViecKhoanRepository(db)
    rate = next(
        (r for r in repo.theo_to(cv.department_id, chi_active=False)
         if r.id == int(b.piece_rate_id)), None,
    )
    doi: list[str] = []
    if rate is not None:
        moi = _anh_khoan_song(rate)
        if o_lech(_anh_khoan_cua_me(b), moi, _O_SO):
            b.ten_khoan_snapshot = moi["ten"]
            b.don_vi_khoan_snapshot = moi["don_vi"]
            b.don_gia_khoan_snapshot = moi["don_gia"]
            doi.append(f"khoan={rate.id}")

    ps_rows = sl.phat_sinh_cua_batch(b.id)
    song = repo.phat_sinh_theo_id([r.phat_sinh_id for r in ps_rows])
    for r in ps_rows:
        ps = song.get(int(r.phat_sinh_id))
        if ps is None:
            continue
        moi = _anh_ps_song(ps)
        if o_lech(_anh_ps_cua_me(r), moi, _O_SO):
            r.ten_snapshot = moi["ten"]
            r.don_vi_snapshot = moi["don_vi"]
            r.don_gia_snapshot = moi["don_gia"]
            doi.append(f"phat_sinh={ps.id}")

    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None),
        action="san_xuat_me_cap_nhat_danh_muc",
        target=f"san_xuat_batch:{b.id}",
        detail=f"cong_viec={cv.id} " + (" ".join(doi) if doi else "khong_co_gi_lech"),
    )
    db.commit()
    return {
        "cong_viec_id": cv.id,
        "department_id": cv.department_id,
        "trang_thai": cv.trang_thai,
        "version": cv.version,
        "batch_id": b.id,
        "ket_qua_lsx": [],
    }
