"""MẠCH PHIẾU MUA của từng Ô — spec `docs/spec-ke-hoach-vat-tu-mot-o-mot-phieu.md` (07/10/2026).

Ô = (khoá tồn của mặt hàng, lsx_id, bai_ghep_id). Mạch = MỘT dòng yêu cầu mua → các dòng đơn mua
lập từ nó (`department_request_line_id`) → hàng về nhập kho. Màn chỉ hiện MỘT chip cho cả mạch, đi
theo bước hiện tại; mỗi ô có tối đa một mạch còn sống, các mạch sống khác của ô là "trùng".

Thuần hàm trên các object đã nạp sẵn — không tự truy vấn. Quy đổi đơn vị mượn `_ve_goc` của
`KeHoachVatTuService` (nơi gọi truyền vào), để số trên mạch cùng một engine với bảng cân đối.

Phần ĐẶT CHO LỆNH: đơn mua đã đặt (có ngày về) lập từ dòng yêu cầu của ô thì số đặt chia cho các ô
của dòng yêu cầu đó, mỗi ô tối đa đúng số nó đã đề nghị (`yeu_cau_mua_nguon_lenh.so_luong`, liên kết
cũ thì số cần hiện tại của ô). Phần này chỉ giữ cho đúng ô; phần còn lại của đơn là hàng chung.
"""
from __future__ import annotations

from datetime import date, datetime

from ..models.purchase import (
    DPR_CANCELLED,
    PR_APPROVED,
    PR_CANCELLED,
    PR_DRAFT,
    PR_PARTIALLY_RECEIVED,
    PR_PENDING,
    PR_PURCHASED,
    PR_RECEIVED,
    PR_REJECTED,
)
from .kho_giay import khoa_ton

#: Bước của mạch — hợp đồng với FE (`client.ts` `BuocPhieu`). Thứ tự = đi xa tới đâu.
BUOC_MOI = "moi_de_nghi"
BUOC_TRA = "don_bi_tra"
BUOC_LAP = "dang_lap_don"
BUOC_DUYET = "cho_duyet"
BUOC_DAT = "da_dat_hang"
BUOC_NHAP = "da_nhap_kho"
_BAC = {BUOC_MOI: 0, BUOC_TRA: 1, BUOC_LAP: 2, BUOC_DUYET: 3, BUOC_DAT: 4, BUOC_NHAP: 5}

#: Dưới ngưỡng này coi như 0 — cùng biên `EPS_GIU` của giữ chỗ (Numeric(14,2)).
EPS = 0.004

OKey = tuple  # ((loai, id, rộng, dài, đơn vị gốc), lsx_id, bai_ghep_id)


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def khoa_dong_mua(ln) -> tuple:
    """Khoá tồn của một dòng yêu cầu / đơn mua KHÔNG mang đơn vị gốc (giấy: mã + khổ, gốc ""; hàng
    khác: khổ 0 · 0). Nơi cần tách tờ/kg truyền `khoa=` vào `dung_mach` (Kế hoạch vật tư suy gốc từ
    `unit` dòng qua `KeHoachVatTuService._khoa_mua`)."""
    return khoa_ton(ln.hang_loai, int(ln.hang_id), kho_rong=getattr(ln, "kho_rong", 0) or 0,
                    kho_dai=getattr(ln, "kho_dai", 0) or 0)


def _buoc_don(pr, con_ve: float) -> str:
    st = pr.status
    if st in (PR_REJECTED, PR_CANCELLED):
        return BUOC_TRA
    if st == PR_DRAFT:
        return BUOC_LAP
    if st == PR_PENDING:
        return BUOC_DUYET
    if st in (PR_RECEIVED, PR_APPROVED, PR_PURCHASED, PR_PARTIALLY_RECEIVED):
        return BUOC_DAT if con_ve > EPS else BUOC_NHAP
    return BUOC_DUYET


def _da_nhan(pr, ln, nhap_dot=None) -> float:
    """Số đã nhận của MỘT dòng đơn, đơn vị của dòng — cùng luật `_hang_dang_ve` (đợt giao nếu có,
    không thì `received_quantity`); đơn đã nhận đủ mà chưa ai khai số ⇒ nhận đủ. Có `nhap_dot` thì
    chỉ đếm đợt ĐÃ VÀO TỒN (#57): nhận rồi mà kho chưa nhập vẫn là "đang về"."""
    from .purchase_service import da_giao_theo_dong, da_vao_ton_theo_dong

    da_giao = da_giao_theo_dong(pr) if nhap_dot is None else da_vao_ton_theo_dong(pr, nhap_dot)
    if da_giao is not None:
        return float(da_giao.get(ln.id, 0.0))
    if ln.received_quantity is not None:
        return _f(ln.received_quantity)
    return _f(ln.quantity) if pr.status == PR_RECEIVED else 0.0


def dung_mach(ycs, dong_don, *, ve_goc, can_o, khoa=None, nhap_dot=None) -> dict:
    """Dựng mọi mạch từ các YCMH còn mở (`dang_de_nghi`, đã nạp `lines` + `nguon_lenh`) và các dòng
    đơn lập từ chúng (`dong_tu_yeu_cau`).

    `ve_goc(hang, dvt, sl) -> float | None` quy về đơn vị gốc của mặt hàng. `can_o(okey) -> float`
    là số cần hiện tại của ô — dùng khi liên kết cũ không ghi số. `khoa(ln) -> khoá tồn` của dòng
    yêu cầu / đơn (mặc định `khoa_dong_mua`, không tách đơn vị gốc). `nhap_dot` = `{id đợt giao:
    trạng thái yêu cầu nhập}` — có thì "đã nhận" chỉ đếm đợt đã vào tồn.

    Trả `{"mach": [...], "theo_o": {okey: {"phieu": mach|None, "trung": [mach]}},
    "dat_cho": {pr_line_id: {okey: so}}, "peg": {pr_line_id: {okey: con_ve}},
    "khac": {(hang_loai, hang_id, lsx_id, bai_ghep_id): [{ma, so_luong, don_vi, kho_rong, kho_dai}]}}`:
    `dat_cho` = phần đặt cho ô trên dòng đơn (cả phần đã về), `peg` = phần đặt cho ô CÒN ĐANG VỀ,
    `khac` = yêu cầu/đơn "Mua cho" lệnh mà KHÁC khổ hoặc đơn vị gốc với nhu cầu (lỗi #23) — không
    bù số, chỉ để dòng của lệnh nói được "đã có người mua, khác quy cách".
    """
    from .purchase_service import ngay_ve_cua_phieu

    khoa = khoa or khoa_dong_mua
    don_theo_dong: dict[int, list] = {}
    for d in dong_don:
        if d.department_request_line_id is not None:
            don_theo_dong.setdefault(int(d.department_request_line_id), []).append(d)

    mach: list[dict] = []
    for yc in ycs:
        if yc.status == DPR_CANCELLED:
            continue
        for ln in yc.lines:
            if getattr(ln, "cancelled_at", None) is not None:
                continue
            if not ln.hang_loai or not ln.hang_id:
                continue
            hang = khoa(ln)
            o_list = []
            lech: list[tuple] = []
            for n in getattr(yc, "nguon_lenh", None) or []:
                if (n.hang_loai, int(n.hang_id)) != (hang[0], hang[1]):
                    continue
                kr, kd = int(n.kho_rong or 0), int(n.kho_dai or 0)
                if (kr or kd) and (kr, kd) != (hang[2], hang[3]):
                    lech.append((hang[0], hang[1], n.lsx_id, n.bai_ghep_id))
                    continue
                # Ô mang đơn vị gốc (mg 0391): keo kg và keo thùng cùng một yêu cầu thì liên kết
                # "cho lệnh" chỉ nối vào dòng cùng gốc. Rỗng (liên kết cũ) ⇒ khớp như trước.
                goc = (getattr(n, "don_vi_goc", "") or "").strip().lower()
                if goc and len(hang) >= 5 and goc != hang[4]:
                    lech.append((hang[0], hang[1], n.lsx_id, n.bai_ghep_id))
                    continue
                okey = (hang, n.lsx_id, n.bai_ghep_id)
                sl = None if n.so_luong is None else _f(n.so_luong)
                cu = next((o for o in o_list if o["okey"] == okey), None)
                if cu is not None:
                    # Hai liên kết cùng ô (dữ liệu cũ): cộng số; một bên thiếu số thì cả ô thiếu.
                    cu["so_luong"] = (None if sl is None or cu["so_luong"] is None
                                      else cu["so_luong"] + sl)
                    continue
                o_list.append({"okey": okey, "so_luong": sl})
            don = []
            for d in don_theo_dong.get(int(ln.id), []):
                pr = d.request
                hang_d = khoa(d) if d.hang_loai and d.hang_id else None
                so_dat = ve_goc(hang_d, d.unit, _f(d.quantity)) if hang_d else None
                nhan_dv = _da_nhan(pr, d, nhap_dot)
                nhan = ve_goc(hang_d, d.unit, nhan_dv) if hang_d else None
                con_ve_dv = max(0.0, _f(d.quantity) - nhan_dv)
                buoc = _buoc_don(pr, con_ve_dv)
                don.append({
                    "line_id": int(d.id), "pr_id": int(pr.id), "ma": pr.code, "status": pr.status,
                    "buoc": buoc, "hang": hang_d,
                    "ngay_ve": (pr.expected_receipt_date if nhap_dot is None
                                else ngay_ve_cua_phieu(pr, nhap_dot)),
                    "so_dat": so_dat, "da_nhan": nhan,
                    "con_ve": (max(0.0, (so_dat or 0.0) - (nhan or 0.0)) if so_dat is not None
                               else None),
                    "tao_luc": getattr(pr, "created_at", None),
                    # Số/ĐVT/khổ NGUYÊN trên dòng đơn — chỉ để nói lại cho người đọc (`khac`).
                    "sl_dv": _f(d.quantity), "dvt": d.unit,
                    "kho": (int(d.kho_rong or 0), int(d.kho_dai or 0)),
                })
            song = [x for x in don if x["buoc"] != BUOC_TRA]
            if song:
                chua_xong = [x for x in song if x["buoc"] != BUOC_NHAP]
                if chua_xong:
                    chinh = max(chua_xong, key=lambda x: (_BAC[x["buoc"]], x["ngay_ve"] or date.min))
                    buoc = chinh["buoc"]
                else:
                    chinh = max(song, key=lambda x: x["line_id"])
                    buoc = BUOC_NHAP
            elif don:
                chinh = max(don, key=lambda x: x["line_id"])
                buoc = BUOC_TRA
            else:
                chinh, buoc = None, BUOC_MOI
            so_yc = ve_goc(hang, ln.unit, _f(ln.quantity))
            mach.append({
                "yc_line_id": int(ln.id), "yc_id": int(yc.id), "yc_ma": yc.code,
                "yc_tao_luc": getattr(yc, "created_at", None), "ngay_can": yc.needed_date,
                "loai_mua": getattr(yc, "loai_mua", None),
                "hang": hang, "so_yc": so_yc, "o": o_list, "don": don,
                "buoc": buoc, "song": buoc != BUOC_NHAP,
                "ma": chinh["ma"] if chinh and buoc != BUOC_TRA else yc.code,
                "loai": "pmh" if chinh and buoc != BUOC_TRA else "ycmh",
                "pr_id": chinh["pr_id"] if chinh and buoc != BUOC_TRA else None,
                "ngay_ve": chinh["ngay_ve"] if chinh and buoc not in (BUOC_TRA,) else None,
                "lech": lech,
                "mo_ta": ({"so_luong": chinh["sl_dv"], "don_vi": chinh["dvt"],
                           "kho_rong": chinh["kho"][0], "kho_dai": chinh["kho"][1]}
                          if chinh and buoc != BUOC_TRA else
                          {"so_luong": _f(ln.quantity), "don_vi": ln.unit,
                           "kho_rong": int(ln.kho_rong or 0), "kho_dai": int(ln.kho_dai or 0)}),
            })

    # ---- phần đặt cho từng ô trên từng dòng đơn ----
    dat_cho: dict[int, dict] = {}
    peg: dict[int, dict] = {}
    for m in mach:
        if not m["song"] or not m["o"]:
            continue
        # Số của ô: liên kết ghi số thì theo số đó, không thì số cần hiện tại.
        con_can = {o["okey"]: (o["so_luong"] if o["so_luong"] is not None
                               else max(0.0, _f(can_o(o["okey"])))) for o in m["o"]}
        m["phan_o"] = dict(con_can)
        for d in sorted(m["don"], key=lambda x: (x["ngay_ve"] or date.max, x["line_id"])):
            if d["buoc"] not in (BUOC_DAT, BUOC_NHAP) or d["so_dat"] is None:
                continue
            if d["hang"] != m["hang"]:
                # Thu mua đổi khổ mua: hàng về không bù được cho khổ của ô ⇒ không chia.
                continue
            con_dat = d["so_dat"]
            con_nhan = d["da_nhan"] or 0.0
            for o in m["o"]:
                k = o["okey"]
                lay = min(con_can[k], con_dat)
                if lay <= EPS:
                    continue
                con_can[k] -= lay
                con_dat -= lay
                ve = min(lay, con_nhan)
                con_nhan -= ve
                dat_cho.setdefault(d["line_id"], {})[k] = round(lay, 4)
                if d["buoc"] == BUOC_DAT and d["ngay_ve"] is not None and lay - ve > EPS:
                    peg.setdefault(d["line_id"], {})[k] = round(lay - ve, 4)

    theo_o: dict[OKey, dict] = {}
    for m in mach:
        if not m["song"]:
            continue
        for o in m["o"]:
            theo_o.setdefault(o["okey"], {"phieu": None, "trung": [], "_ds": []})["_ds"].append(m)
    for o in theo_o.values():
        ds = sorted(o.pop("_ds"), key=lambda m: (-_BAC[m["buoc"]],
                                                 m["yc_tao_luc"] or datetime.min, m["yc_line_id"]))
        o["phieu"] = ds[0]
        o["trung"] = ds[1:]
    khac: dict[tuple, list[dict]] = {}
    for m in mach:
        # Mạch đã nhận đủ thì không còn ai đang mua cho ô ⇒ không khoá đề nghị mua đúng quy cách.
        if not m["song"]:
            continue
        for k in m["lech"]:
            ds = khac.setdefault(k, [])
            if not any(x["ma"] == m["ma"] for x in ds):
                ds.append({"ma": m["ma"], **m["mo_ta"]})
    return {"mach": mach, "theo_o": theo_o, "dat_cho": dat_cho, "peg": peg, "khac": khac}


def tom_tat(m: dict | None) -> dict | None:
    """Phần FE cần của một mạch — JSON được."""
    if m is None:
        return None
    return {
        "ma": m["ma"], "loai": m["loai"], "buoc": m["buoc"],
        "ngay_ve": m["ngay_ve"].isoformat() if m["ngay_ve"] else None,
        "yc_ma": m["yc_ma"], "yc_id": m["yc_id"], "yc_line_id": m["yc_line_id"],
        "pr_id": m["pr_id"],
        "co_don": any(d["buoc"] != BUOC_TRA for d in m["don"]),
    }
