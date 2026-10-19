"""BÁO CÁO THU CHI theo mục × tháng (11/10/2026) — mockup `docs/mockups/bao-cao-thu-chi-khuon-cong-no.html`.

Trả lời: trong kỳ, công ty thu bao nhiêu, chi bao nhiêu, cho những mục nào, tháng nào. Tính tại
chỗ từ phiếu ĐÃ CHI / ĐÃ THU (phiếu huỷ không tính), theo NGÀY THỰC CHI / THỰC THU — không bảng
lưu, không chốt kỳ.

  • Dòng = một mục (hoặc một người nhận / người nộp khi xem theo người). Phiếu sinh từ nghiệp vụ
    vào mục CỐ ĐỊNH của nguồn (id âm, `MUC_CO_DINH`); phiếu lập tay chưa có mục gom vào dòng
    "Chưa phân loại" — không có khái niệm "thu chi khác".
  • Cột = các tháng của kỳ (kỳ dài hơn 12 tháng thì theo quý; kỳ gọn trong một tháng thì KHÔNG có
    cột kỳ vì nó trùng hệt Cộng kỳ) + Cộng kỳ. Cột "Tiền mặt từ 5 triệu" đã gỡ 12/10/2026.
  • Thẻ lọc nhanh đếm số DÒNG theo ô tìm + Lọc, nhưng không theo chính thẻ đang chọn.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date

from ..models.accounting import RECEIPT_SOURCE_ORDER, RECEIPT_SOURCE_SALES_INVOICE
from ..models.muc_thu_chi import LOAI_CHI, LOAI_THU, muc_co_dinh
from .bao_cao_cong_no import ngay_chi

CHUA_PHAN_LOAI = "Chưa phân loại"
THE = ("all", "thu", "chi", "chua")


class BaoCaoThuChiError(Exception):
    pass


# ── Cột kỳ ──────────────────────────────────────────────────────────────────────────────────

def _dm(d: date) -> str:
    return f"{d.day}/{d.month}"


def cot_ky(tu: date, den: date) -> list[dict]:
    """Các cột kỳ: `[{khoa, nhan, tu, den}]`. Rỗng khi kỳ gọn trong một tháng."""
    if (tu.year, tu.month) == (den.year, den.month):
        return []
    so_thang = (den.year - tu.year) * 12 + den.month - tu.month + 1
    hai_nam = tu.year != den.year
    ra: list[dict] = []
    if so_thang <= 12:
        y, m = tu.year, tu.month
        while (y, m) <= (den.year, den.month):
            dau, cuoi = date(y, m, 1), date(y, m, monthrange(y, m)[1])
            a, b = max(dau, tu), min(cuoi, den)
            nhan = f"Tháng {m}" + (f"/{y}" if hai_nam else "")
            if (a, b) != (dau, cuoi):
                nhan += f" ({a.day} – {_dm(b)})" if a.month == b.month else f" ({_dm(a)} – {_dm(b)})"
            ra.append({"khoa": f"{y}-{m:02d}", "nhan": nhan, "tu": a, "den": b})
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
        return ra
    y, q = tu.year, (tu.month - 1) // 3 + 1
    while (y, q) <= (den.year, (den.month - 1) // 3 + 1):
        dau = date(y, 3 * q - 2, 1)
        cuoi = date(y, 3 * q, monthrange(y, 3 * q)[1])
        a, b = max(dau, tu), min(cuoi, den)
        nhan = f"Quý {q}/{y}"
        if (a, b) != (dau, cuoi):
            nhan += f" ({_dm(a)} – {_dm(b)})"
        ra.append({"khoa": f"{y}-Q{q}", "nhan": nhan, "tu": a, "den": b})
        y, q = (y + 1, 1) if q == 4 else (y, q + 1)
    return ra


def _cot_cua(cot: list[dict], ngay: date) -> str | None:
    for c in cot:
        if c["tu"] <= ngay <= c["den"]:
            return c["khoa"]
    return None


# ── Phiếu → một dạng chung ──────────────────────────────────────────────────────────────────

def _muc_cua(loai: str, nguon: str, muc) -> tuple[int | None, str | None]:
    """`(id, tên)` mục của phiếu — mục cố định của nguồn (id âm) hoặc mục đã chọn, hay (None, None)."""
    cd = muc_co_dinh(loai, nguon)
    if cd is not None:
        return cd["id"], cd["ten"]
    return (muc.id, muc.ten) if muc is not None else (None, None)


def _phieu_chi(v) -> dict:
    muc_id, muc_ten = _muc_cua(LOAI_CHI, v.source_type or "purchase_request", v.muc_thu_chi)
    return {
        "loai": LOAI_CHI, "id": v.id, "so": v.doc_no or v.code, "ngay": ngay_chi(v), "tien": int(v.amount_vnd),
        "nguoi": (v.cash_recipient_name or v.supplier_name_snapshot or "").strip(),
        "ly_do": v.content or "", "hinh_thuc": v.voucher_type,
        "muc_id": muc_id, "muc_ten": muc_ten,
    }


def _phieu_thu(p) -> list[dict]:
    """Một phiếu = một dòng báo cáo; phiếu gộp có CẢ dòng cọc lẫn dòng hoá đơn (17/10/2026) tách
    thành hai dòng cùng số phiếu — cọc vào mục "Thu cọc", hoá đơn vào "Thu tiền hoá đơn"."""
    def _dong(nguon: str, muc, tien: int) -> dict:
        muc_id, muc_ten = _muc_cua(LOAI_THU, nguon, muc)
        return {
            "loai": LOAI_THU, "id": p.id, "so": p.doc_no or p.code, "ngay": p.receipt_date, "tien": tien,
            "nguoi": (p.payer_name or "").strip(), "ly_do": p.content or "",
            "hinh_thuc": p.receipt_method,
            "muc_id": muc_id, "muc_ten": muc_ten,
        }

    dong = getattr(p, "lines", None) or []
    coc = sum(int(l.amount_vnd) for l in dong if l.sales_invoice_id is None)
    hoa_don = sum(int(l.amount_vnd) for l in dong if l.sales_invoice_id is not None)
    if coc and hoa_don:
        return [_dong(RECEIPT_SOURCE_ORDER, None, coc), _dong(RECEIPT_SOURCE_SALES_INVOICE, None, hoa_don)]
    return [_dong(p.source_type or "purchase_refund", p.muc_thu_chi, int(p.amount_vnd))]


def nap_phieu(repo, tu: date, den: date, *, hinh_thuc: str | None = None,
              muc: list[int] | None = None) -> list[dict]:
    ds = [_phieu_chi(v) for v in repo.phieu_chi(tu, den) if tu <= ngay_chi(v) <= den]
    ds += [d for p in repo.phieu_thu(tu, den) for d in _phieu_thu(p)]
    if hinh_thuc:
        ds = [p for p in ds if p["hinh_thuc"] == hinh_thuc]
    if muc:
        chon = set(muc)
        ds = [p for p in ds if (p["muc_id"] or 0) in chon]
    return ds


def _khoa(p: dict, theo: str) -> str:
    if theo == "nguoi":
        return p["nguoi"].lower() or "—"
    return str(p["muc_id"] or 0)


def _ten(p: dict, theo: str) -> str:
    if theo == "nguoi":
        return p["nguoi"] or "(không ghi người)"
    return p["muc_ten"] or CHUA_PHAN_LOAI


def _cong(ds: list[dict], cot: list[dict]) -> dict:
    o: dict[str, int] = {c["khoa"]: 0 for c in cot}
    for p in ds:
        k = _cot_cua(cot, p["ngay"])
        if k is not None:
            o[k] += p["tien"]
    return {"o": o, "cong": sum(p["tien"] for p in ds)}


def _hop_the(d: dict, the: str) -> bool:
    return (the == "all" or (the == "thu" and d["ben"] == LOAI_THU)
            or (the == "chi" and d["ben"] == LOAI_CHI) or (the == "chua" and d["chua"]))


def bao_cao(repo, *, tu_ngay: date, den_ngay: date, theo: str = "muc", hinh_thuc: str | None = None,
            muc: list[int] | None = None, q: str | None = None, the: str = "all",
            page: int = 1, size: int | None = None) -> dict:
    if den_ngay < tu_ngay:
        raise BaoCaoThuChiError("Ngày cuối kỳ phải sau ngày đầu kỳ.")
    cot = cot_ky(tu_ngay, den_ngay)
    ds = nap_phieu(repo, tu_ngay, den_ngay, hinh_thuc=hinh_thuc, muc=muc)

    nhom: dict[tuple[str, str], dict] = {}
    for p in ds:
        k = (p["loai"], _khoa(p, theo))
        g = nhom.setdefault(k, {"ben": p["loai"], "khoa": k[1], "ten": _ten(p, theo),
                                "chua": False, "muc_id": p["muc_id"], "ds": []})
        g["ds"].append(p)
        if p["muc_id"] is None:
            g["chua"] = True
    dong = []
    for g in nhom.values():
        dong.append({k: v for k, v in g.items() if k != "ds"} | _cong(g["ds"], cot))
    tim = (q or "").strip().lower()
    if tim:
        dong = [d for d in dong if tim in d["ten"].lower()]
    dong.sort(key=lambda d: (d["ben"] != LOAI_THU, d["chua"] and theo == "muc", -d["cong"], d["ten"]))

    the_loc = {t: sum(1 for d in dong if _hop_the(d, t)) for t in THE}
    the = the if the in THE else "all"
    loc = [d for d in dong if _hop_the(d, the)]

    def _tong(ben: str) -> dict:
        rr = [d for d in loc if d["ben"] == ben]
        o = {c["khoa"]: sum(d["o"][c["khoa"]] for d in rr) for c in cot}
        return {"o": o, "cong": sum(d["cong"] for d in rr), "so_dong": len(rr)}

    thu, chi = _tong(LOAI_THU), _tong(LOAI_CHI)
    chenh = {"o": {c["khoa"]: thu["o"][c["khoa"]] - chi["o"][c["khoa"]] for c in cot},
             "cong": thu["cong"] - chi["cong"]}
    total = len(loc)
    if size:
        page = max(1, page)
        loc = loc[(page - 1) * size: page * size]
    return {
        "tu_ngay": tu_ngay, "den_ngay": den_ngay, "theo": theo,
        "cot": [{"khoa": c["khoa"], "nhan": c["nhan"]} for c in cot],
        "dong": loc, "nhom": {"thu": thu, "chi": chi}, "chenh_lech": chenh,
        "the_loc": the_loc, "total": total, "page": page, "size": size or total,
    }


def phieu_cua_dong(repo, *, tu_ngay: date, den_ngay: date, ben: str, theo: str, khoa: str,
                   cot: str | None = None, hinh_thuc: str | None = None,
                   muc: list[int] | None = None) -> dict:
    """Phiếu của MỘT dòng báo cáo (ngăn chi tiết). `o` = tiền từng cột kỳ của cả dòng (dải số đầu
    ngăn), `items` = phiếu đã lọc theo cột nếu có."""
    cots = cot_ky(tu_ngay, den_ngay)
    ds = [p for p in nap_phieu(repo, tu_ngay, den_ngay, hinh_thuc=hinh_thuc, muc=muc)
          if p["loai"] == ben and _khoa(p, theo) == khoa]
    tong = _cong(ds, cots)
    if cot:
        c = next((x for x in cots if x["khoa"] == cot), None)
        if c is None:
            raise BaoCaoThuChiError("Cột kỳ không thuộc kỳ đang xem.")
        ds = [p for p in ds if c["tu"] <= p["ngay"] <= c["den"]]
    ds.sort(key=lambda p: (p["ngay"], p["tien"]), reverse=True)
    return {"cot": [{"khoa": c["khoa"], "nhan": c["nhan"]} for c in cots], "o": tong["o"],
            "cong": tong["cong"], "items": ds, "tong": sum(p["tien"] for p in ds)}


def chuyen_muc(repo, muc_svc, *, phieu_chi_ids: list[int], phieu_thu_ids: list[int],
               muc_id: int, audit=None, actor_id: int | None = None) -> int:
    """Chuyển phiếu sang mục khác (dòng "Chưa phân loại" hay mục gán nhầm). Phiếu chi chỉ sang
    mục chi, phiếu thu chỉ sang mục thu.
    Chỉ phiếu LẬP TAY — phiếu sinh từ nghiệp vụ nằm ở mục cố định, repo bỏ qua chúng."""
    if not phieu_chi_ids and not phieu_thu_ids:
        raise BaoCaoThuChiError("Chọn ít nhất một phiếu.")
    if phieu_chi_ids and phieu_thu_ids:
        raise BaoCaoThuChiError("Phiếu thu và phiếu chi không chung một mục — chuyển từng bên.")
    loai = LOAI_CHI if phieu_chi_ids else LOAI_THU
    m = muc_svc.kiem_muc(muc_id, loai)
    n = repo.doi_muc(phieu_chi_ids=phieu_chi_ids, phieu_thu_ids=phieu_thu_ids, muc_id=m.id)
    if audit is not None:
        # Một dòng vết cho TỪNG phiếu: mở nhật ký của phiếu nào cũng thấy nó đổi mục lúc nào.
        audit.create_many([
            {"actor_user_id": actor_id, "action": "chuyen_muc_thu_chi",
             "target": f"{bang}:{i}", "detail": f"Sang mục {m.ten}"}
            for bang, ids in (("payment_voucher", phieu_chi_ids), ("payment_receipt", phieu_thu_ids))
            for i in ids
        ])
    repo.chot()
    return n
