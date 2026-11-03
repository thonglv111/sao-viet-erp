"""Bốn tab bảng của ngăn mặt hàng màn Tồn kho — Lô tồn, Lịch sử nhập xuất, Lịch sử chuyển kho, Lịch
sử sửa (04/11/2026): mỗi tab có ô tìm, kỳ và nút Lọc như bảng chính.

Một tab chỉ là các dòng của MỘT dòng tồn (mặt hàng × kho, giấy thêm khổ + đơn vị gốc) — vài trăm dòng
cho mặt hàng chạy nhiều năm. Nạp cả tập của dòng tồn đó, lọc, đếm giá trị chọn được cho nút Lọc rồi
cắt trang ở đây (máy chủ); trình duyệt chỉ nhận đúng một trang. Lọc bằng SQL từng tab sẽ phải đếm
giá trị chọn được bằng câu riêng mà không nhanh hơn ở cỡ này.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone

from ..repositories.audit_repo import AuditLogRepository
from ..repositories.kho_hang_repo import KhoHangRepository
from ..repositories.loc_danh_sach import VN_TZ, trong_khoang_ngay
from ..repositories.user_repo import UserRepository
from ..van_ban import bo_dau
from .kho_nhat_ky_ton import VIEC, doc_lan_sua

#: Giá trị lọc "chưa gắn vị trí".
CHUA_GAN = "__trong"


@dataclass
class LocNgan:
    q: str = ""
    tu_ngay: date | None = None
    den_ngay: date | None = None
    viec: list[str] = field(default_factory=list)
    nguoi: list[str] = field(default_factory=list)
    vi_tri: list[str] = field(default_factory=list)
    kho_tu: list[str] = field(default_factory=list)
    kho_den: list[str] = field(default_factory=list)


def _khop(q: str, *chu: str | None) -> bool:
    k = bo_dau(q or "").strip()
    return not k or any(k in bo_dau(c or "") for c in chu)


def _luc_ngay(d: date) -> datetime:
    """Lô đầu kỳ không có phiếu: lấy 00:00 giờ VN của ngày nhập làm mốc xếp."""
    return datetime.combine(d, time.min, tzinfo=VN_TZ).astimezone(timezone.utc)


def _utc(luc: datetime) -> datetime:
    return luc if luc.tzinfo else luc.replace(tzinfo=timezone.utc)


def _chon(dem: Counter, nhan: dict[str, str]) -> list[dict]:
    """Giá trị chọn được của một điều kiện, nhiều dòng nhất trước."""
    return [{"value": v, "nhan": nhan.get(v, v), "so": n}
            for v, n in sorted(dem.items(), key=lambda x: (-x[1], nhan.get(x[0], x[0])))]


# ------------------------------------------------------------------ Lô tồn

def lo_ton(svc, hang, kho_id: int, loc_kho: dict, loc: LocNgan) -> tuple[list, dict]:
    """Lô còn hàng (FIFO, nhập trước đứng trước). Tìm theo số phiếu, mã lô, vị trí, NCC; kỳ theo
    ngày nhập; lọc vị trí."""
    lots = svc.lots.trang_lo_mat_hang(hang, kho_id, tab="lo_ton", offset=0, limit=100_000, **loc_kho)
    ma = svc.vouchers.ma_by_ids(list({lo.voucher_id for lo in lots if lo.voucher_id}))
    vt = lambda lo: lo.vi_tri or CHUA_GAN  # noqa: E731
    dem_vt = Counter(vt(lo) for lo in lots)
    out = [
        lo for lo in lots
        if _khop(loc.q, ma.get(lo.voucher_id), lo.ma_lo, lo.vi_tri, lo.ncc)
        and (loc.tu_ngay is None or lo.ngay_nhap >= loc.tu_ngay)
        and (loc.den_ngay is None or lo.ngay_nhap <= loc.den_ngay)
        and (not loc.vi_tri or vt(lo) in loc.vi_tri)
    ]
    return out, {"vi_tri": _chon(dem_vt, {CHUA_GAN: "Chưa gắn"})}


# ------------------------------------------------------------------ Lịch sử nhập xuất

def nhap_xuat(svc, db, hang, kho_id: int, loc_kho: dict, loc: LocNgan,
              can_view_cost: bool) -> tuple[list[dict], dict]:
    """Lô nhập + dòng phiếu xuất của dòng tồn, mới nhất trước, kèm tồn sau mỗi lần.

    Tồn sau tính LÙI từ tồn hiện tại (Σ còn lại mọi lô của dòng tồn ở kho) qua MỌI lần đổi số — kể cả
    nhận về / chuyển đi, dù hai loại đó không hiện ở tab này — để số dòng trên cùng luôn khớp tồn thật."""
    nhap = svc.lots.trang_lo_mat_hang(hang, kho_id, tab="nhap", offset=0, limit=100_000, **loc_kho)
    nhan_ve = svc.lots.trang_lo_mat_hang(hang, kho_id, tab="nhan_ve", offset=0, limit=100_000, **loc_kho)
    xuat = svc.vouchers.xuat_history(hang, kho_id, dieu_chuyen=None, **loc_kho)
    phieu = svc.vouchers.luc_va_nguoi_by_ids(
        [lo.voucher_id for lo in (*nhap, *nhan_ve)] + [x["voucher_id"] for x in xuat])
    ma = svc.vouchers.ma_by_ids(list({lo.voucher_id for lo in nhap if lo.voucher_id}))
    nguon = svc.lots.nguon_lo([lo.id for lo in nhap] + [x["lot_id"] for x in xuat if x["lot_id"]])

    def luc_nguoi(voucher_id, ngay: date):
        p = phieu.get(voucher_id)
        return (_utc(p[0]), p[1]) if p else (_luc_ngay(ngay), None)

    id_nhap = {lo.id for lo in nhap}
    su_kien: list[dict] = []
    for lo in (*nhap, *nhan_ve):
        luc, nguoi = luc_nguoi(lo.voucher_id, lo.ngay_nhap)
        hien = lo.id in id_nhap
        gia = float(lo.don_gia_nhap or 0)
        su_kien.append({
            "key": f"n{lo.id}", "luc": luc, "ngay": lo.ngay_nhap, "viec": "nhap", "hien": hien,
            "delta": float(lo.sl_ban_dau or 0), "voucher_id": lo.voucher_id,
            "voucher_ma": ma.get(lo.voucher_id), "vi_tri": lo.vi_tri, "hsd": lo.hsd, "don_gia": gia,
            "chua_gia_goc": bool((nguon.get(lo.id) or {}).get("tu_kcs")) and not gia, "nguoi_id": nguoi,
        })
    for i, x in enumerate(xuat):
        luc, nguoi = luc_nguoi(x["voucher_id"], x["ngay"])
        su_kien.append({
            "key": f"x{x['voucher_id']}-{x['lot_id']}-{i}", "luc": luc, "ngay": x["ngay"], "viec": "xuat",
            "hien": not x["dieu_chuyen"], "delta": -float(x["so_luong"]), "voucher_id": x["voucher_id"],
            "voucher_ma": x["voucher_ma"], "vi_tri": x["vi_tri"], "hsd": x["hsd"], "don_gia": x["don_gia"],
            "chua_gia_goc": bool((nguon.get(x["lot_id"]) or {}).get("tu_kcs")) and not x["don_gia"],
            "nguoi_id": nguoi,
        })
    # Mới nhất trước; cùng lúc thì nhập trước xuất trong cùng phiếu không quan trọng — giữ thứ tự ổn định.
    su_kien.sort(key=lambda e: (e["luc"], e["key"]), reverse=True)
    ton = float(sum(float(lo.sl_con_lai or 0) for lo in (*nhap, *nhan_ve)))
    for e in su_kien:
        e["ton_sau"] = ton
        ton -= e["delta"]

    hien = [e for e in su_kien if e["hien"]]
    users = UserRepository(db).get_many({e["nguoi_id"] for e in hien if e["nguoi_id"]})
    ten = {str(i): u.name for i, u in users.items()}
    dem_viec = Counter(e["viec"] for e in hien)
    dem_nguoi = Counter(str(e["nguoi_id"]) for e in hien if e["nguoi_id"])
    out = []
    for e in hien:
        if not (_khop(loc.q, e["voucher_ma"], e["vi_tri"])
                and (loc.tu_ngay is None or e["ngay"] >= loc.tu_ngay)
                and (loc.den_ngay is None or e["ngay"] <= loc.den_ngay)
                and (not loc.viec or e["viec"] in loc.viec)
                and (not loc.nguoi or str(e["nguoi_id"]) in loc.nguoi)):
            continue
        sl = abs(e["delta"])
        out.append({
            "key": e["key"], "luc": e["luc"], "viec": e["viec"], "voucher_id": e["voucher_id"],
            "voucher_ma": e["voucher_ma"], "so_luong": sl, "ton_sau": e["ton_sau"], "vi_tri": e["vi_tri"],
            "hsd": e["hsd"],
            "don_gia": e["don_gia"] if can_view_cost else None,
            "gia_tri": round(sl * (e["don_gia"] or 0)) if can_view_cost and not e["chua_gia_goc"] else None,
            "chua_gia_goc": can_view_cost and e["chua_gia_goc"],
            "nguoi": ten.get(str(e["nguoi_id"])) if e["nguoi_id"] else None,
        })
    return out, {
        "viec": _chon(dem_viec, {"nhap": "Nhập", "xuat": "Xuất"}),
        "nguoi": _chon(dem_nguoi, ten),
    }


# ------------------------------------------------------------------ Lịch sử chuyển kho

def chuyen(svc, db, hang, kho_id: int, loc_kho: dict, loc: LocNgan) -> tuple[list[dict], dict]:
    """Lần chuyển đi / nhận về của dòng tồn. Kỳ theo ngày chuyển; lọc từ kho, sang kho, người chuyển."""
    rows, _ = svc.vouchers.dong_chuyen_kho(kho_id, hang=hang, **loc_kho)
    kho = KhoHangRepository(db).theo_ids([i for r in rows for i in (r["kho_tu_id"], r["kho_den_id"])])
    users = UserRepository(db).get_many({r["nguoi_id"] for r in rows if r["nguoi_id"]})
    ten_kho = {str(i): k.ten for i, k in kho.items()}
    ten_nguoi = {str(i): u.name for i, u in users.items()}
    out = [
        r for r in rows
        if trong_khoang_ngay(r["luc"], loc.tu_ngay, loc.den_ngay)
        and _khop(loc.q, r["lay_o"], r["cat_o"])
        and (not loc.kho_tu or str(r["kho_tu_id"]) in loc.kho_tu)
        and (not loc.kho_den or str(r["kho_den_id"]) in loc.kho_den)
        and (not loc.nguoi or str(r["nguoi_id"]) in loc.nguoi)
    ]
    return out, {
        "kho_tu": _chon(Counter(str(r["kho_tu_id"]) for r in rows), ten_kho),
        "kho_den": _chon(Counter(str(r["kho_den_id"]) for r in rows), ten_kho),
        "nguoi": _chon(Counter(str(r["nguoi_id"]) for r in rows if r["nguoi_id"]), ten_nguoi),
    }


# ------------------------------------------------------------------ Lịch sử sửa

def sua(db, targets: list[str], loc: LocNgan, can_view_cost: bool) -> tuple[list[dict], dict]:
    """Lần sửa của dòng tồn, mới nhất trước. Kỳ theo ngày sửa; lọc việc, người sửa; ô tìm tìm trong
    ghi chú."""
    repo = AuditLogRepository(db)
    logs, _ = repo.trang_theo_targets(targets, VIEC)
    ghi = repo.ghi_chu_theo_log(log.id for log in logs)
    dong = []
    for log in logs:
        d = {"id": log.id, "luc": log.created_at, "nguoi": log.actor_name_luc_do or None,
             "ghi_chu_nguoi": None, **doc_lan_sua(log, can_view_cost=can_view_cost)}
        if (g := ghi.get(log.id)) is not None:
            d["ghi_chu"], d["ghi_chu_nguoi"] = g.noi_dung, g.nguoi_sua_ten or None
        dong.append(d)
    out = [
        d for d in dong
        if trong_khoang_ngay(d["luc"], loc.tu_ngay, loc.den_ngay)
        and _khop(loc.q, d["ghi_chu"])
        and (not loc.viec or d["viec"] in loc.viec)
        and (not loc.nguoi or (d["nguoi"] or "") in loc.nguoi)
    ]
    return out, {
        "viec": _chon(Counter(d["viec"] for d in dong), {}),
        "nguoi": _chon(Counter(d["nguoi"] for d in dong if d["nguoi"]), {}),
    }
