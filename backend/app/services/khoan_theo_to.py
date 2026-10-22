"""Màn Lương → Khoán theo tổ (22/10/2026): quỹ tổ, chia cho người, sổ sản lượng từng lần ghi, ngày
dừng máy, người của tổ làm ở tổ khác.

Mockup đã duyệt: `docs/mockups/khoan-theo-to-a-chi-tiet.html`. Mọi con số lấy NGUYÊN từ
`KhoanKyService.tinh(so=True)` — màn này chỉ lọc theo tổ, cộng và gắn nhãn, không tính lại.

Luật đọc số (chủ chốt 22/10/2026):
  - Lương khoán đem so = sản lượng + dừng máy + tổ trưởng + ở tổ khác. Tăng ca khoán có cột riêng,
    nằm trong quỹ tổ nhưng KHÔNG cộng vào lương khoán — bảng lương cộng nó sau.
  - Phân bổ lương bù lỗ đọc ở dòng lương của kỳ; chưa tạo bảng lương thì để trống.
  - Người tổ khác được tick ở lần ghi của tổ này: hiện phần họ ăn từ tổ này, lương chính tính ở tổ
    của họ.
  - Người ăn công nhật (`an_cong_nhat_hieu_luc` — cùng một luật với bảng lương; mốc lương chưa chọn
    thì thử việc = công nhật) vẫn đứng trong tỷ lệ chia nhưng không hưởng tiền khoán lẫn tăng ca
    khoán — phần đó không dồn cho ai; lương của họ theo công + tăng ca giờ ở bảng lương. Thử việc
    HCNS chọn Lương khoán thì so hai lương như người chính thức.
"""
from __future__ import annotations

import calendar as _cal
from collections import defaultdict
from datetime import date

from sqlalchemy.orm import Session

from ..models.payroll import TO_TRUONG_THUONG
from ..repositories.employee_repo import EmployeeRepository
from ..repositories.khoan_ky_repo import KhoanKyRepository
from ..repositories.san_xuat_san_luong_to_repo import SanXuatSanLuongToRepository
from .bien_che import trang_thai_tren_ngay
from .khoan_ky import KhoanKyService
from .payroll_service import an_cong_nhat_hieu_luc, la_thu_viec
from .san_xuat.san_luong_to import _quy_cach_bang
from .san_xuat.snapshot import the_quy_cach


class KhoanTheoToForbidden(Exception):
    pass


def _r(x) -> int:
    return int(round(float(x or 0)))


def xem(db: Session, payroll_svc, year: int, month: int, to_id: int | None,
        duoc_xem: set[int] | None) -> dict:
    """Payload màn Khoán theo tổ. `duoc_xem` = phạm vi nhân sự người gọi (None = tất cả); màn có
    người ngoài phạm vi ⇒ `KhoanTheoToForbidden` — tiền của một người là dữ liệu của người đó."""
    muc = payroll_svc.muc_khoan(year, month)
    so = KhoanKyService(db).tinh(year, month, muc, so=True)["so"]
    repo = KhoanKyRepository(db)
    pb = repo.phong_ban()
    co_to = {r["to_id"] for r in so["lan_ghi"] + so["dung_may"] if r["to_id"] in pb}
    cac_to = sorted(({"id": i, "ten": pb[i].name} for i in co_to), key=lambda x: x["ten"])
    if to_id is None and cac_to:
        to_id = cac_to[0]["id"]
    ra: dict = {"year": year, "month": month, "cac_to": cac_to, "to_id": to_id, "to_ten": None,
                "la_to_in": False, "to_truong": None, "quy": None, "nguoi": [], "doi_chieu": None,
                "so": [], "khac": [], "dung_may": [], "ngay": [], "co_bang_luong": False}
    if to_id is None or to_id not in pb:
        return ra

    lan_to = [r for r in so["lan_ghi"] if r["to_id"] == to_id]
    dm_to = [r for r in so["dung_may"] if r["to_id"] == to_id]
    ngay_to = [r for r in so["ngay"] if r["to_id"] == to_id]
    tt_to = [t for t in so["to_truong"] if t["dep_id"] == to_id]
    tv = repo.nhan_vien_cua_to(to_id)
    lan_khac = [r for r in so["lan_ghi"] if r["to_id"] != to_id and tv & set(r["nguoi"])]
    dm_khac = [r for r in so["dung_may"] if r["to_id"] != to_id and tv & set(r["nguoi"])]
    tt_khac = [t for t in so["to_truong"] if t["dep_id"] != to_id and t["emp"] in tv]

    cot: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for ds, k in ((lan_to, "san_luong"), (dm_to, "dung_may"), (ngay_to, "tang_ca")):
        for r in ds:
            for e, v in r["nguoi"].items():
                cot[e][k] += v
    for t in tt_to:
        cot[t["emp"]]["to_truong"] += t["tien"]
    for r in lan_khac + dm_khac:
        for e, v in r["nguoi"].items():
            if e in tv:
                cot[e]["o_to_khac"] += v
    for t in tt_khac:
        cot[t["emp"]]["o_to_khac"] += t["tien"]

    ky = payroll_svc.payroll.get_period_by_ym(year, month)
    dong = {int(ln.employee_id): ln for ln in payroll_svc.payroll.list_lines(ky.id)} if ky else {}
    thanh_vien = {e for e in tv if e in cot or e in dong}
    ngoai = set(cot) - tv
    nguoi_so = {e for r in lan_to + lan_khac + dm_to for e in r["nguoi"]}
    tat_ca = thanh_vien | ngoai | nguoi_so | {t["emp"] for t in tt_to}
    if duoc_xem is not None and not tat_ca <= duoc_xem:
        raise KhoanTheoToForbidden("Tổ này có người ngoài phạm vi quản lý của bạn.")
    nv = repo.nhan_vien(tat_ca)
    lbl = muc.luong_ca_may
    cuoi = date(year, month, _cal.monthrange(year, month)[1])
    # Thử việc: dòng lương của kỳ chốt sẵn; chưa có dòng thì xét trạng thái cuối kỳ như `_compute`.
    luong = payroll_svc.payroll.latest_salaries_map(cuoi)
    nv_repo = EmployeeRepository(db)
    ho_so, su_kien = nv_repo.get_many(tat_ca), nv_repo.events_map(tat_ca)
    thu_viec = {e for e in tat_ca
                if (bool(dong[e].is_probation) if e in dong else e in ho_so and la_thu_viec(
                    ho_so[e], trang_thai_tren_ngay(ho_so[e], su_kien.get(e, []), cuoi)[0]))}
    cong_nhat = {e for e in tat_ca if an_cong_nhat_hieu_luc(luong.get(e), e in thu_viec)}

    def ten(e: int) -> str:
        return nv.get(e, (f"#{e}", None))[0]

    def to_cua(e: int, to_xem: int) -> str | None:
        """Tên tổ ghi sau tên người không thuộc tổ đang xem."""
        d = nv.get(e, (None, None))[1]
        return pb[d].name if d and d != to_xem and d in pb else None

    # --- Chia cho người -----------------------------------------------------------------------
    hang = []
    for e in sorted(thanh_vien | ngoai, key=lambda e: (e in ngoai, -float(lbl.get(e) or 0), ten(e))):
        c = cot[e]
        k = c["san_luong"] + c["dung_may"] + c["to_truong"] + c["o_to_khac"]
        h = {"emp_id": e, "ten": ten(e), "to_ten": to_cua(e, to_id), "la_thanh_vien": e in tv,
             "luong_bu_lo": _r(lbl.get(e)),
             **{x: _r(c[x]) for x in ("san_luong", "dung_may", "tang_ca", "to_truong", "o_to_khac")},
             "cong_nhat": e in cong_nhat, "luong_khoan": None, "thu_viec": e in thu_viec, "phan_bo_bu_lo": None,
             "cong": None,
             "chuan_cong": None, "an": None, "luong_chinh": None}
        if e in tv:
            ln = dong.get(e)
            h["luong_khoan"] = _r(k)
            if ln is not None and not h["cong_nhat"]:
                h["chuan_cong"] = float(ln.standard_cong or 26)
                if ln.bu_lo_theo_cong is not None:
                    pbl = _r(ln.bu_lo_theo_cong)
                    h["phan_bo_bu_lo"] = pbl
                    if lbl.get(e):
                        h["cong"] = round(pbl * h["chuan_cong"] / float(lbl[e]), 1)
                    h["an"] = "khoan" if h["luong_khoan"] >= pbl else "bu_lo"
                    h["luong_chinh"] = max(h["luong_khoan"], pbl)
        hang.append(h)

    # --- Quỹ + dòng đối chiếu quỹ → lương chính ----------------------------------------------
    q_sl = sum(r["tien"] * r["he_so"] for r in lan_to)
    q_dm = sum(r["tien"] for r in dm_to)
    q_tc = sum(r["tang_ca"] for r in ngay_to)
    ra["quy"] = {"san_luong": _r(q_sl), "dung_may": _r(q_dm), "tang_ca": _r(q_tc),
                 "tong": _r(q_sl + q_dm + q_tc)}
    tvien = [h for h in hang if h["la_thanh_vien"]]
    khoan_nguoi = [h for h in tvien if not h["cong_nhat"]]
    co_du = all(h["luong_chinh"] is not None for h in khoan_nguoi)
    luong_khoan = sum(h["luong_khoan"] for h in khoan_nguoi)
    luong_chinh = sum(h["luong_chinh"] for h in khoan_nguoi) if co_du and khoan_nguoi else None
    ra["doi_chieu"] = {
        "quy": ra["quy"]["tong"], "tang_ca": ra["quy"]["tang_ca"],
        "to_truong_thuong": _r(sum(t["tien"] for t in tt_to if t["che_do"] == TO_TRUONG_THUONG)),
        "cong_nhat": sum(h["san_luong"] + h["dung_may"] + h["to_truong"] for h in tvien if h["cong_nhat"]),
        "nguoi_to_khac": sum(h["san_luong"] + h["dung_may"] + h["to_truong"]
                             for h in hang if not h["la_thanh_vien"]),
        "o_to_khac": sum(h["o_to_khac"] for h in khoan_nguoi),
        "luong_khoan": luong_khoan,
        "bu_lo": luong_chinh - luong_khoan if luong_chinh is not None else None,
        "luong_chinh": luong_chinh,
    }
    ra.update(to_ten=pb[to_id].name, la_to_in=bool(getattr(pb[to_id], "la_to_in", False)),
              nguoi=hang, co_bang_luong=ky is not None)
    if tt_to:
        t = tt_to[0]
        ra["to_truong"] = {"emp_id": t["emp"], "ten": ten(t["emp"]), "che_do": t["che_do"],
                           "ty_le": t["ty_le"], "tien": _r(sum(x["tien"] for x in tt_to))}

    # --- Sổ: nhãn lệnh, khách, quy cách ------------------------------------------------------
    lan_all = lan_to + lan_khac
    lsx_ids = {int(r["lsx_id"]) for r in lan_all if r["lsx_id"]}
    sl_repo = SanXuatSanLuongToRepository(db)
    nhan = sl_repo.nhan_nguon([("bai_ghep", r["bai_ghep_id"]) if r["bai_ghep_id"] else ("lsx", r["lsx_id"])
                               for r in lan_all])
    qc_lenh = sl_repo.quy_cach_lenh(lsx_ids)
    qc_cv = repo.quy_cach_cong_viec({r["cong_viec_id"] for r in lan_all})
    khach = repo.khach_theo_lenh(lsx_ids)

    def nguoi_ra(r: dict) -> list[dict]:
        # Tổ ghi sau tên là so với tổ ĐANG XEM — kể cả ở khối tổ khác (mockup "Văn Hùng máy 4 màu").
        return [{"emp_id": e, "ten": ten(e), "to_ten": to_cua(e, to_id), "luong_bu_lo": _r(lbl.get(e)),
                 "tien": _r(v)} for e, v in sorted(r["nguoi"].items(), key=lambda x: -x[1])]

    def lan_ra(r: dict) -> dict:
        k = ("bai_ghep", r["bai_ghep_id"]) if r["bai_ghep_id"] else ("lsx", r["lsx_id"])
        ma, ten_lenh = nhan.get(k, ("", ""))
        qc = {**(the_quy_cach(qc_lenh.get(r["lsx_id"])) or {}), **qc_cv.get(r["cong_viec_id"], {})}
        return {
            "batch_id": r["batch_id"], "ngay": r["ngay"], "to_id": r["to_id"],
            "to_ten": pb[r["to_id"]].name if r["to_id"] in pb else None,
            "nguon_loai": k[0], "nguon_id": k[1], "lenh_ma": ma, "lenh_ten": ten_lenh,
            "khach": khach.get(r["lsx_id"]) if r["lsx_id"] else None,
            "quy_cach": _quy_cach_bang(qc or None),
            "cong_doan": r["cong_doan"], "bac": r["bac"], "tuy_chon": r["tuy_chon"],
            "phat_sinh": [{**p, "tien": _r(p["tien"])} for p in r["phat_sinh"]],
            "so_luong": r["so_luong"], "don_vi": r["don_vi"],
            "tien_chinh": _r(r["tien_chinh"]), "tien": _r(r["tien"]), "he_so": r["he_so"],
            "ghi_chu": r["ghi_chu"], "cong_thuc": r["cong_thuc"],
            "nguoi": nguoi_ra(r),
            "to_truong": [{"ten": ten(t["emp"]), "che_do": t["che_do"], "ty_le": t["ty_le"],
                           "tien": _r(t["tien"])} for t in r["to_truong"]],
        }

    sap = lambda r: (r["ngay"], r["bat_dau"], r["batch_id"])  # noqa: E731
    ra["so"] = [lan_ra(r) for r in sorted(lan_to, key=sap)]
    ra["khac"] = [lan_ra(r) for r in sorted(lan_khac, key=sap)]
    ra["dung_may"] = [{"ngay": r["ngay"], "ly_do": r["ly_do"], "sua_chua": r["sua_chua"],
                       "ghi_chu": r["ghi_chu"], "tien": _r(r["tien"]), "nguoi": nguoi_ra(r)}
                      for r in sorted(dm_to, key=lambda r: r["ngay"])]
    ra["ngay"] = [{"ngay": r["ngay"], "quy": _r(r["quy"]), "chi_tieu": _r(r["chi_tieu"]),
                   "tang_ca": _r(r["tang_ca"])} for r in sorted(ngay_to, key=lambda r: r["ngay"])]
    return ra
