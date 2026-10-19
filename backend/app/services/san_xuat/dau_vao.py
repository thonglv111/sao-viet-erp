"""Thực hiện sản xuất — ĐẦU VÀO từ công đoạn trước theo routing lệnh (19/09/2026).

Lệnh có routing: công đoạn sau làm trên đầu ra của công đoạn trước. Chủ xưởng chốt ba luật, cùng
đọc một nguồn số (bàn giao ĐÃ XÁC NHẬN về công đoạn này — `proposed` chưa chốt thì không tính):

  1. CỔNG BẮT ĐẦU — công đoạn có công đoạn trước chỉ bắt đầu/tiếp tục được khi đã nhận (số dương)
     từ MỖI công đoạn trước. Công đoạn đầu lệnh không có ai trước ⇒ không cổng.
  2. TRẦN GHI MẺ — Σ số làm được của các mẻ ≤ số đã nhận × HỆ SỐ QUY ĐỔI của công đoạn: *"giao
     sang bao nhiêu thì ghi mẻ tối đa bằng bấy nhiêu"*, còn công đoạn đổi đơn vị trên dòng giấy
     thì nhân hệ số (*"1 tờ → 2 con thì chặn 2 × số tờ nhận"*). Hệ số là `he_so_quy_doi` ảnh chụp
     lúc phát hành — engine tính ra từ bình bài (Bế 2 con/tờ), cùng việc giữ trên bảng Kế hoạch.
     Hệ số 0/trống (bước gõ tay số vào/ra, vd Cắt tờ cuộn → tờ in) ⇒ máy không suy được ⇒ không trần.
     10/10/2026: trần TRỪ lỗi KCS bắt tại công đoạn (nhận 1000, KCS lỗi 200 ⇒ mẻ tối đa 800), và
     công đoạn ĐẦU chuỗi lấy số vào kế hoạch làm số nhận.
  3. CHIỀU NGƯỢC — sửa GIẢM số một mẻ (10/10/2026, thay "điều chỉnh bàn giao") mà kéo trần của bước
     sau xuống dưới số bước đó đã ghi mẻ ⇒ chặn.

Chỉ bàn giao ĐÚNG đơn vị đầu vào của công đoạn mới tính vào trần (cùng luật `board._thuc_nhan`):
Ghi kẽm CTP đứng trước In theo thứ tự bảng thì In nhận "bản kẽm" — đem số bản kẽm làm trần số tờ in
là vô nghĩa. Nhiều công đoạn trước (bước ghép) ⇒ trần theo nguồn nhận ÍT nhất.
"""
from __future__ import annotations

import math

from sqlalchemy.orm import Session

from ...models.san_xuat_san_luong import BG_DE_XUAT, BG_XAC_NHAN
from ...repositories.don_vi_do_repo import DonViDoRepository, nhan_don_vi
from ...repositories.san_xuat_kcs_repo import SanXuatKcsRepository
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository

_EPS = 0.0005
_DA_CHOT = (BG_XAC_NHAN,)


def _so(x: float) -> str:
    """Số kiểu Việt cho câu báo tổ đọc: 10.200 · 2,5."""
    s = f"{float(x):,.3f}".rstrip("0").rstrip(".")
    return s.replace(",", "_").replace(".", ",").replace("_", ".")


def cung_to_cung_lsx(nguon_cv, dich_cv) -> bool:
    """Hai bước NỐI NHAU mà cùng tổ VÀ cùng lệnh — hàng chưa rời tổ (23/09/2026).

    Cờ này lái cả ba chỗ, phải đọc cùng một luật ở cả ba (trước đây `ban_giao._la_cung_to` giữ
    riêng một bản, rồi cổng/trần lại không biết tới nó):

      · `ban_giao.de_xuat` — bàn giao nội bộ tự `confirmed`, không bắt ai xác nhận;
      · `thieu_dau_vao` / `kiem_bat_dau` — KHÔNG cổng: bắt tổ tự "giao cho chính mình" rồi mới
        được bắt đầu là thao tác rỗng, không mang tin gì mới;
      · `tran_ghi` — trần bám thẳng SẢN LƯỢNG bước trước thay vì số đã bàn giao.

    Bước ghép bài (`bai_ghep_cong_doan_id`) gộp nhiều lệnh nên `lsx_id` trống ⇒ luôn FALSE: hàng
    của lệnh khác vẫn phải giao và xác nhận đàng hoàng (khớp cổng §10.2).
    """
    if nguon_cv is None or dich_cv is None:
        return False
    return (
        nguon_cv.department_id is not None
        and nguon_cv.department_id == dich_cv.department_id
        and nguon_cv.lsx_id is not None
        and nguon_cv.lsx_id == dich_cv.lsx_id
    )


def _khoa(c) -> tuple:
    """Gom các LẦN CHẠY của cùng một bước vào một nguồn — luật "đã nhận từ công đoạn trước" hỏi
    theo BƯỚC, không theo từng lần chạy."""
    if c.bai_ghep_cong_doan_id is not None:
        return ("bg", c.bai_ghep_cong_doan_id)
    if c.step_key:
        return ("buoc", c.step_key)
    return ("cv", c.id)


def nhom_truoc(repo: SanXuatSanLuongRepository, cv) -> list[list]:
    """Các công đoạn trước, mỗi phần tử là MỘT bước (các lần chạy của nó). Nguồn: routing lệnh
    (`cong_viec_chang_truoc`) + cạnh phụ thuộc chéo đổ vào (bước ghép / nhánh toả bài ghép)."""
    cac = list(repo.cong_viec_chang_truoc(cv))
    da_co = {c.id for c in cac}
    them = [c.nguon_cong_viec_id for c in repo.canh_phu_thuoc_toi(cv.id)
            if c.nguon_cong_viec_id not in da_co]
    if them:
        cac += [c for c in repo.cong_viec_nhieu(them).values() if c.id != cv.id]
    nhom: dict[tuple, list] = {}
    for c in cac:
        nhom.setdefault(_khoa(c), []).append(c)
    return list(nhom.values())


def quy_ra(cv, nhan: float | None) -> float | None:
    """Quy số nhận (đơn vị vào) về đơn vị RA để so thẳng với số tốt: hệ số của bước nếu có (Bế 2
    con/tờ), cùng đơn vị thì giữ, còn lại theo tỉ lệ kế hoạch ra/vào. Làm tròn XUỐNG."""
    if nhan is None:
        return None
    he_so = float(cv.he_so_quy_doi or 0)
    if he_so > 0:
        ra = nhan * he_so
    elif (cv.don_vi_vao or "").strip() == (cv.don_vi_ra or "").strip():
        ra = nhan
    elif cv.so_luong_vao and cv.so_luong_ra is not None:
        ra = float(cv.so_luong_ra) * nhan / float(cv.so_luong_vao)
    else:
        return None
    return float(math.floor(ra + 1e-6))


def _tran_dau_chuoi(cv) -> dict | None:
    """Công đoạn ĐẦU chuỗi (10/10/2026): không ai giao sang, vật tư kho cấp theo kế hoạch ⇒ số nhận
    là số VÀO kế hoạch quy ra đơn vị ra — đúng số "Nhận vào" khối Tiến độ đang bày (175 tờ nguyên
    → 350 tờ in). Kế hoạch không khai số vào ⇒ không trần."""
    vao = float(cv.so_luong_vao or 0)
    if vao <= _EPS:
        return None
    toi_da = quy_ra(cv, vao)
    if toi_da is None:
        return None
    return {
        "toi_da": toi_da, "da_nhan": vao, "he_so": round(toi_da / vao, 4),
        "don_vi_nhan": (cv.don_vi_vao or "").strip() or None, "nguon_ten": None,
        "cung_to": False, "dau_chuoi": True,
    }


def tran_nhan(
    db: Session, cv, *, repo: SanXuatSanLuongRepository | None = None,
) -> dict | None:
    """Trần theo SỐ NHẬN (đơn vị đầu RA), chưa trừ lỗi KCS. None = không trần: hệ số 0/trống, chưa
    khai đơn vị vào, không nguồn nào giao đúng đơn vị vào, hoặc bước đầu chuỗi không có số vào.

    Nguồn CÙNG TỔ + CÙNG LỆNH không có bàn giao để đếm (cổng đã bỏ) nên trần bám thẳng SẢN LƯỢNG
    bước trước — vẫn là "làm ra bao nhiêu mới ghi được bấy nhiêu", chỉ đổi chỗ đọc số."""
    repo = repo or SanXuatSanLuongRepository(db)
    nhom = nhom_truoc(repo, cv)
    if not nhom:
        return _tran_dau_chuoi(cv)
    he_so = float(cv.he_so_quy_doi or 0)
    dv_vao = (cv.don_vi_vao or "").strip()
    if he_so <= 0 or not dv_vao:
        return None
    bgs = [b for b in repo.ban_giao_toi_dich(cv.id) if b.trang_thai in _DA_CHOT]
    noi_bo = [g for g in nhom if cung_to_cung_lsx(g[0], cv)]
    tot = repo.tong_tot_nhieu({c.id for g in noi_bo for c in g}) if noi_bo else {}
    muc: list[tuple[float, list, bool]] = []
    for g in nhom:
        ids = {c.id for c in g}
        dung_dv = any((c.don_vi_ra or "").strip() == dv_vao for c in g)
        if cung_to_cung_lsx(g[0], cv):
            # Hàng chưa rời tổ: không có dòng bàn giao nào để cộng. Số bước trước LÀM RA chính là
            # số đang nằm trong tổ. Khác đơn vị vào thì máy không suy được ⇒ bỏ qua nguồn này,
            # đúng như luật cũ bỏ qua nguồn giao sai đơn vị (bản kẽm vào bước in tờ).
            if dung_dv:
                muc.append((sum(tot.get(i, 0.0) for i in ids), g, True))
            continue
        nhan = sum(float(b.so_luong or 0) for b in bgs
                   if b.nguon_cong_viec_id in ids and (b.don_vi or "").strip() == dv_vao)
        if nhan > _EPS or dung_dv:
            muc.append((nhan, g, False))
    if not muc:
        return None
    da_nhan, g, cung_to = min(muc, key=lambda t: t[0])
    return {
        "toi_da": round(da_nhan * he_so, 3),
        "da_nhan": da_nhan,
        "he_so": he_so,
        "don_vi_nhan": dv_vao,
        "nguon_ten": g[0].ten_cong_doan,
        # Lái CÂU BÁO: cùng tổ thì "đã nhận" là sai chữ, hàng có đi đâu đâu mà nhận.
        "cung_to": cung_to,
        "dau_chuoi": False,
    }


def tran_ghi(
    db: Session, cv, *, repo: SanXuatSanLuongRepository | None = None,
) -> dict | None:
    """Trần Σ số làm được của công đoạn = số nhận (`tran_nhan`) − lỗi KCS bắt tại công đoạn
    (10/10/2026: *"tổng nhận 1000 tờ in, KCS ghi lỗi 200 thì tổng các mẻ tối đa 800"*). `toi_da` là
    trần đã trừ; `toi_da_nhan` + `loi_kcs` để hộp Ghi mẻ nói rõ số đó từ đâu ra."""
    t = tran_nhan(db, cv, repo=repo)
    if t is None:
        return None
    loi = SanXuatKcsRepository(db).tong_loi(cv.id)
    return {**t, "toi_da_nhan": t["toi_da"], "loi_kcs": loi,
            "toi_da": round(max(0.0, t["toi_da"] - loi), 3)}


def _cau_tran(dv_ten: dict[str, str], cv, t: dict) -> str:
    dv_ra = nhan_don_vi(dv_ten, cv.don_vi_ra) if cv.don_vi_ra else ""
    dv_nhan = nhan_don_vi(dv_ten, t["don_vi_nhan"]) if t.get("don_vi_nhan") else ""
    if t.get("dau_chuoi"):
        dau = "kế hoạch nhận"
    else:
        dau = f"{'đã làm được ở' if t.get('cung_to') else 'đã nhận từ'} {t['nguon_ten']}"
    nhan = f"{dau} {_so(t['da_nhan'])} {dv_nhan}".rstrip()
    toi_da_nhan = t.get("toi_da_nhan", t["toi_da"])
    co_loi = t.get("loi_kcs", 0) > _EPS
    if abs(t["he_so"] - 1) > _EPS:
        nhan += f" × {_so(t['he_so'])} = {'' if co_loi else 'tối đa '}{_so(toi_da_nhan)} {dv_ra}"
    if co_loi:
        nhan += f", KCS bắt lỗi {_so(t['loi_kcs'])} {dv_ra}, còn tối đa {_so(t['toi_da'])} {dv_ra}"
    return nhan


def kiem_tran_ghi(db: Session, repo: SanXuatSanLuongRepository, cv, them: float, *,
                  bo_qua: float = 0.0) -> None:
    """Chặn mẻ làm Σ số làm được vượt trần (luật 2). `bo_qua` = số cũ của mẻ đang SỬA — trừ khỏi
    số đã ghi để "tối đa" là số mẻ đó được sửa lên."""
    t = tran_ghi(db, cv, repo=repo)
    if t is None:
        return
    da_ghi = repo.tong_tot(cv.id) - bo_qua
    if da_ghi + them <= t["toi_da"] + _EPS:
        return
    dv_ten = DonViDoRepository(db).ten_theo_ma()
    dv_ra = nhan_don_vi(dv_ten, cv.don_vi_ra) if cv.don_vi_ra else ""
    con = max(0.0, t["toi_da"] - da_ghi)
    if con > _EPS:
        duoi = f"lần này ghi tối đa {_so(con)} {dv_ra}."
    elif t.get("dau_chuoi"):
        duoi = "đã ghi đủ số kế hoạch, không ghi thêm được."
    else:
        duoi = f"chờ công đoạn trước {'làm thêm' if t.get('cung_to') else 'giao thêm'} rồi mới ghi tiếp được."
    if t.get("dau_chuoi"):
        dau = "Vượt số nhận theo kế hoạch"
    elif t.get("cung_to"):
        dau = "Vượt sản lượng công đoạn trước"
    else:
        dau = "Vượt số nhận từ công đoạn trước"
    raise ValueError(
        f"{dau}: {_cau_tran(dv_ten, cv, t)}, "
        f"{'các lần khác đã ghi' if bo_qua > _EPS else 'đã ghi'} {_so(da_ghi)} {dv_ra} — {duoi}"
    )


def buoc_sau(repo: SanXuatSanLuongRepository, cv) -> list:
    """Các công đoạn nhận hàng từ `cv`: chặng sau theo routing + cạnh phụ thuộc chéo đi ra."""
    cac = {c.id: c for c in repo.cong_viec_chang_sau(cv)}
    them = [c.dich_cong_viec_id for c in repo.canh_toa_di_tu(cv.id)
            if c.dich_cong_viec_id and c.dich_cong_viec_id not in cac]
    if them:
        cac.update({i: c for i, c in repo.cong_viec_nhieu(them).items() if i != cv.id})
    return list(cac.values())


def tran_buoc_sau(db: Session, repo: SanXuatSanLuongRepository, cv) -> dict[int, float | None]:
    """Trần ghi mẻ HIỆN TẠI của các bước sau — chụp TRƯỚC khi giảm số, đưa cho `kiem_giam_buoc_sau`."""
    return {d.id: (tran_ghi(db, d, repo=repo) or {}).get("toi_da") for d in buoc_sau(repo, cv)}


def kiem_giam_buoc_sau(db: Session, repo: SanXuatSanLuongRepository, cv,
                       truoc: dict[int, float | None]) -> None:
    """Sau khi giảm số mẻ (đã flush, chưa commit): chặn nếu trần của bước sau tụt xuống dưới số nó
    đã ghi mẻ (luật 3). Trần vốn đã thấp hơn số ghi từ trước (KCS bắt lỗi sau khi ghi) mà lần này
    không kéo thấp thêm thì cho qua — lỗi đó không phải do lần sửa này."""
    for d in buoc_sau(repo, cv):
        t = tran_ghi(db, d, repo=repo)
        if t is None:
            continue
        da_ghi = repo.tong_tot(d.id)
        cu = truoc.get(d.id)
        if t["toi_da"] + _EPS >= da_ghi or (cu is not None and t["toi_da"] >= cu - _EPS):
            continue
        dv_ten = DonViDoRepository(db).ten_theo_ma()
        dv_ra = nhan_don_vi(dv_ten, d.don_vi_ra) if d.don_vi_ra else ""
        raise ValueError(
            f"Không giảm được: {d.ten_cong_doan} đã ghi {_so(da_ghi)} {dv_ra}, "
            f"giảm thế thì số nhận chỉ đủ cho {_so(t['toi_da'])} {dv_ra}."
        )


def _to_tien(repo: SanXuatSanLuongRepository, cv, da: set) -> set:
    """Khoá (`_khoa`) của MỌI bước đứng trước `cv` theo routing, đi ngược hết chuỗi."""
    for g in nhom_truoc(repo, cv):
        k = _khoa(g[0])
        if k in da:
            continue
        da.add(k)
        _to_tien(repo, g[0], da)
    return da


def _nhom_truoc_truc_tiep(repo: SanXuatSanLuongRepository, cv) -> list[list]:
    """`nhom_truoc` bỏ các bước chỉ là cạnh BẮC CẦU (18/10/2026, lỗi #29): Z phụ thuộc cả X lẫn
    Y mà Y đã đứng sau X thì hàng của X tới Z QUA Y — đòi Z nhận thẳng từ X là kẹt vĩnh viễn, vì
    X giao hết số cho Y. Lưu tuyến mới đã bị chặn cạnh thừa (`LsxService._kiem_tuyen_luu`); hàm
    này gỡ cho lệnh CŨ đang chạy có sẵn cạnh đó."""
    nhom = nhom_truoc(repo, cv)
    if len(nhom) < 2:
        return nhom
    tien = {_khoa(g[0]): _to_tien(repo, g[0], set()) for g in nhom}
    return [g for g in nhom
            if not any(_khoa(g[0]) in tien[_khoa(h[0])] for h in nhom if h is not g)]


def thieu_dau_vao(repo: SanXuatSanLuongRepository, cv) -> list[str]:
    """Tên các công đoạn trước CHƯA giao được gì (bàn giao đã xác nhận, số dương) sang đây —
    rỗng thì bắt đầu được (luật 1). Không xét đơn vị: nhận bản kẽm cũng là đã nhận đầu vào.

    Bước trước CÙNG TỔ + CÙNG LỆNH không tính vào cổng (23/09/2026): hàng chưa rời tổ, bắt tổ tự
    giao cho chính mình rồi mới được bắt đầu là thao tác rỗng. Trần ghi mẻ vẫn giữ, chỉ đổi sang
    bám sản lượng bước trước (`tran_ghi`)."""
    nhom = [g for g in _nhom_truoc_truc_tiep(repo, cv) if not cung_to_cung_lsx(g[0], cv)]
    if not nhom:
        return []
    co_nhan = {
        b.nguon_cong_viec_id for b in repo.ban_giao_toi_dich(cv.id)
        if b.trang_thai in _DA_CHOT and float(b.so_luong or 0) > _EPS
    }
    return [g[0].ten_cong_doan for g in nhom if not any(c.id in co_nhan for c in g)]


def kiem_bat_dau(repo: SanXuatSanLuongRepository, cv) -> None:
    # Cổng "chờ tổ Cắt" (spec giấy theo khổ §4.7) đứng TRƯỚC cổng đầu vào: chưa chốt thì chưa biết
    # bước này còn chặng trước là Cắt hay không.
    from .chot_giay import ly_do_cho_chot

    ly_do = ly_do_cho_chot(repo.db, cv)
    if ly_do:
        raise ValueError(ly_do)
    thieu = thieu_dau_vao(repo, cv)
    if thieu:
        raise ValueError(
            f"Chưa nhận hàng từ công đoạn trước ({', '.join(thieu)}) — tổ trước giao sang và tổ "
            f"mình xác nhận nhận rồi mới bắt đầu được."
        )


def cong_doan_truoc(db: Session, repo: SanXuatSanLuongRepository, cv) -> list[dict]:
    """Khối "Công đoạn trước" của tab Nhận: mỗi công đoạn trước (từng lần chạy) một dòng — kế
    hoạch, thực tế (Σ mẻ), đã giao sang đây, trong đó đã xác nhận / đang chờ xác nhận."""
    cac = [c for g in nhom_truoc(repo, cv) for c in g]
    if not cac:
        return []
    tot = repo.tong_tot_nhieu({c.id for c in cac})
    bgs = repo.ban_giao_toi_dich(cv.id)
    to_ten = SanXuatRepository(db).to_ten_nhan({c.department_id for c in cac if c.department_id})
    ra = []
    for c in cac:
        cua_no = [b for b in bgs if b.nguon_cong_viec_id == c.id]
        ra.append({
            "cong_viec_id": c.id,
            "ten_cong_doan": c.ten_cong_doan,
            "phan_doan_so": c.phan_doan_so,
            "phan_doan_tong": c.phan_doan_tong,
            "to_ten": to_ten.get(c.department_id) if c.department_id else None,
            # Cùng tổ + cùng lệnh: không có cổng, không cần bàn giao — drawer bày "Giao sang" /
            # "Đã nhận" ở dòng này là bày hai ô 0 mãi mãi rồi tổ đi tìm nút không tồn tại.
            "cung_to": cung_to_cung_lsx(c, cv),
            "trang_thai": c.trang_thai,
            "ke_hoach": None if c.so_luong_ra is None else float(c.so_luong_ra),
            "don_vi": c.don_vi_ra,
            "thuc_te": tot.get(c.id, 0.0),
            "da_giao": sum(float(b.so_luong or 0) for b in cua_no),
            "da_xac_nhan": sum(float(b.so_luong or 0) for b in cua_no if b.trang_thai in _DA_CHOT),
            "cho_xac_nhan": sum(float(b.so_luong or 0) for b in cua_no if b.trang_thai == BG_DE_XUAT),
            # Bàn giao ghi đơn vị riêng (nhánh toả bài ghép giao theo đơn vị của bên nhận).
            "don_vi_giao": next((b.don_vi for b in cua_no if b.don_vi), None) or c.don_vi_ra,
        })
    return ra
