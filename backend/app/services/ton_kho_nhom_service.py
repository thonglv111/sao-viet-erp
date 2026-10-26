"""Tồn kho theo MẶT HÀNG của MỘT kho — lọc, đếm và cắt trang ở MÁY CHỦ (08/10/2026).

Màn Tồn kho gom lô theo khoá tồn (`kho_giay.khoa_ton_cua`: giấy tách theo khổ + đơn vị gốc, vật tư theo
đơn vị gốc, hàng khác theo mã) rồi lọc, đếm, cắt trang. Trước đây việc đó chạy trong trình duyệt trên MỌI lô
của kho. Giờ:

  1. Repo cộng sẵn mỗi khoá thô MỘT dòng (tồn khả dụng, giá trị, hạn sớm nhất) — vài nghìn dòng.
  2. Service gộp về khoá tồn, gắn mức tồn so với ngưỡng + dự báo, lọc, đếm 5 nhóm, sắp theo tên,
     cắt trang.
  3. Chỉ lô của ĐÚNG trang được nạp, để màn dựng dòng và ngăn chi tiết như cũ.

MỘT nguồn cho phán quyết "Cần mua" và chip Tình trạng: máy chủ tính (bản Python của
`ton-kho/duBao.ts`, chỉ phần màn danh sách cần) và trả cho từng dòng của trang — màn không tự tính lại.
`duBao.ts` còn lo phần trải dòng thời gian và số "Đề nghị mua" trong ngăn chi tiết.

Dự báo (lệnh sắp lĩnh + hàng đang về, toàn xưởng) là phần đắt nhất nên cất cache ngắn theo
(kho, tập khoá tồn) qua `can_doi_cache` — cùng cơ chế, cùng chỗ xoá với bảng cân đối (đổi lệnh, giữ
chỗ, phiếu mua, xếp lịch). Dự báo KHÔNG phụ thuộc số tồn hay ngưỡng nên ghi sổ phiếu / sửa ngưỡng không
cần xoá nó: tồn và ngưỡng luôn đọc tươi, chỉ phép trải lệnh/đơn về là dùng lại.
Hai cache 45 giây xếp chồng (dự báo ngoài + `bang_can_doi` trong): khi một thay đổi không phát tín hiệu
xoá cache (vd tới hạn SX của lệnh), dự báo có thể cũ tới khoảng 90 giây.
"""
from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from typing import Callable

from ..models.stock_lot import STOCK_CRITICAL, STOCK_OUT, STOCK_OVER
from ..van_ban import bo_dau
from .can_doi_cache import NGAN_PHU, lay_hoac_tinh
from .kho_giay import dinh_luong_va_quy_kg, khoa_ton_cua
from .stock_request_service import stock_level

NHOM_TON = ("all", "can_mua", "du_ton", "chuakhai", "sap_het_han")
#: Ngày tới hạn của nhóm "Sắp hết hạn" tính từ hôm nay.
SO_NGAY_SAP_HET_HAN = 30

#: `du_bao(khoas)` → các dòng dự báo như `DuBaoTonService.du_bao`.
DuBaoFn = Callable[[list[tuple]], list[dict]]
#: `cho_xuat(kho_id)` → `{khoá 5 phần: [việc xuất]}` như `DuBaoTonService.cho_xuat` — đề nghị xuất còn
#: treo của kho, tính TƯƠI (ngoài cache dự báo) rồi ghép vào dòng qua `gop_cho_xuat`.
ChoXuatFn = Callable[[int], dict[tuple, list[dict]]]


def _khoa5(k: tuple) -> tuple[str, int, int, int, str]:
    """Khoá tồn 5 phần `(loai, id, rộng, dài, đơn vị gốc)`; cặp `(loai, id)` ⇒ `(loai, id, 0, 0, "")`."""
    if len(k) == 5:
        return (k[0], int(k[1]), int(k[2]), int(k[3]), str(k[4] or ""))
    return (k[0], int(k[1]), 0, 0, "")


def _lam_tron(n: float) -> float:
    return math.floor(n * 1000 + 0.5) / 1000


def _ngay(v) -> date | None:
    """Ngày từ cột Date (SQLite trả chuỗi ISO khi qua `min()` không giữ kiểu)."""
    if v is None or isinstance(v, date):
        return v
    return date.fromisoformat(str(v)[:10])


def tinh_du_bao_gon(ton: float, du: dict | None, nguong, hom_nay: date | None = None) -> dict:
    """Phần của `tinhDuBao()` (ton-kho/duBao.ts) mà màn danh sách cần: số Sắp xuất / Sắp về / Dự kiến
    còn, có LÚC NÀO chạm Tối thiểu (chưa khai ngưỡng: âm), có LÚC NÀO vượt Tối đa và đã là "ngay bây
    giờ" hay chưa. Đổi luật bên TS thì đổi cả bên này.

    `du` = dòng của `DuBaoTonService.du_bao` (`lenh`, `ve`) hoặc None khi mặt hàng không có việc nào."""
    hom_nay_s = (hom_nay or date.today()).isoformat()
    mn = float(nguong.nguong_ton) if nguong is not None else None
    mx = float(nguong.nguong_toi_da) if (nguong is not None and nguong.nguong_toi_da is not None) else None

    def duoi(n: float) -> bool:
        return n <= mn if mn is not None else n < 0

    def tren(n: float) -> bool:
        return mx is not None and n > mx

    lenh = (du or {}).get("lenh") or []
    ve = (du or {}).get("ve") or []
    # Cùng ngày thì LĨNH trước, VỀ sau; lệnh chưa có hạn đứng đầu (coi như lĩnh ngay).
    tho = [(str(l.get("han_sx") or ""), 0, j, -float(l["can"])) for j, l in enumerate(lenh)]
    tho += [(str(v.get("ngay_ve") or ""), 1, j, float(v["sl"])) for j, v in enumerate(ve)]
    tho.sort(key=lambda t: t[:3])
    con_lai = float(ton)
    thap = con_lai
    moc_vuot: str | None = "nay" if tren(con_lai) else None
    for ngay, _thu, _j, delta in tho:
        con_lai = _lam_tron(con_lai + delta)
        thap = min(thap, con_lai)
        if moc_vuot is None and tren(con_lai):
            # Việc đã quá hẹn (hoặc chưa có hạn) coi như xảy ra hôm nay.
            moc_vuot = "nay" if (not ngay or ngay < hom_nay_s) else ngay
    can_lenh = _lam_tron(sum(float(l["can"]) for l in lenh))
    dang_ve = _lam_tron(sum(float(v["sl"]) for v in ve))
    du_kien = _lam_tron(float(ton) - can_lenh + dang_ve)
    return {
        "can_lenh": can_lenh, "dang_ve": dang_ve, "du_kien": du_kien,
        "duoi_cuoi": duoi(du_kien),
        "can_mua": duoi(thap),
        "vuot": moc_vuot,          # None | "nay" | ngày (ISO) sẽ vượt
    }


def can_mua_theo_du_bao(ton: float, du: dict | None, nguong) -> bool:
    """Có lúc nào số còn lại chạm/dưới Tối thiểu (chưa khai ngưỡng: âm) — `tinhDuBao().canMua`."""
    return tinh_du_bao_gon(ton, du, nguong)["can_mua"]


def tinh_trang_dong(ton: float, muc: str | None, co_nguong: bool, d: dict | None) -> str | None:
    """Chip Tình trạng của dòng — `tinhTrangDong` của duBao.ts, nay chỉ tính ở đây.

    `het` · `can_mua` · `vuot` (đang vượt) · `se_vuot` · `chua` (chưa đặt mức) · None (trong mức, không
    gắn chip). `d` = kết quả `tinh_du_bao_gon` khi dự báo dùng được; None thì lùi về mức của tồn hiện có."""
    if d is not None:
        if d["can_mua"]:
            return "het" if ton <= 0 else "can_mua"
        if d["vuot"] is not None:
            return "vuot" if d["vuot"] == "nay" else "se_vuot"
        return None if co_nguong else "chua"
    if muc == STOCK_OUT:
        return "het"
    if muc == STOCK_CRITICAL:
        return "can_mua"
    if muc == STOCK_OVER:
        return "vuot"
    return None if co_nguong else "chua"


@dataclass
class LocTon:
    """Điều kiện của màn Tồn kho. Rỗng/None = không chặn phía đó."""

    nhom: str = "all"
    q: str = ""
    ngay_tu: date | None = None
    ngay_den: date | None = None
    ton_tu: float | None = None
    ton_den: float | None = None
    gt_tu: float | None = None
    gt_den: float | None = None
    #: Chỉ lấy các dòng của MỘT mặt hàng (nạp lại đúng mặt hàng đang mở ngoài trang). Không tính vào `dem`.
    hang: tuple[str, int] | None = None


@dataclass
class _Nhom:
    khoa: tuple                      # khoá tồn 5 phần (`_khoa5(khoa_ton_cua(...))`)
    hang_loai: str
    hang_id: int
    tong: float = 0.0
    gia_tri: float = 0.0
    hsd_som: date | None = None
    khoa_tho: set = field(default_factory=set)   # các khoá thô `(loai, id, gốc, rộng, dài)` của nhóm
    ma: str = ""
    ten: str = ""
    muc: str | None = None           # `stock_level` nhưng None khi chưa khai ngưỡng (và còn hàng)
    co_nguong: bool = False
    la_thanh_pham: bool = False
    can_mua: bool = False
    tinh_trang: str | None = None
    dinh_luong: int | None = None    # gsm của danh mục (chỉ giấy)
    quy_kg: float | None = None      # giấy tờ: tồn quy kg; cuộn / hàng khác None
    d: dict | None = None            # kết quả `tinh_du_bao_gon` khi dự báo dùng được
    du_bao_row: dict | None = None   # dòng dự báo thô (lệnh/đơn về) cho ngăn chi tiết

    @property
    def khoa_chuoi(self) -> str:
        """Cùng dạng khoá dòng tồn của màn (`khoaTon` bên TS), luôn 5 phần: `giay:12:780:905:to` ·
        `giay:12:1000:0:kg` · `vat_tu:5:0:0:kg` · `vat_tu:5:0:0:thung`."""
        return ":".join(str(x) for x in self.khoa)


class TonKhoNhomService:
    def __init__(self, lots, thresholds, hang, du_bao: DuBaoFn | None = None,
                 cho_xuat: ChoXuatFn | None = None) -> None:
        self.lots = lots
        self.thresholds = thresholds
        self.hang = hang
        self.du_bao = du_bao
        self.cho_xuat = cho_xuat

    def _du_bao_co_cache(self, kho_id: int, khoas: list[tuple]) -> tuple[dict[tuple, dict], bool]:
        """`({khoá 5 phần: dòng dự báo}, dùng_được)`. Cache theo (kho, tập khoá); lỗi dự báo KHÔNG bị cache và
        không làm sập danh sách — nhóm "Cần mua" lùi về mức tồn so với ngưỡng như màn trước đây."""
        if self.du_bao is None or not khoas:
            return {}, self.du_bao is not None
        from .ke_hoach_vat_tu_service import KeHoachVatTuError  # import trễ: service nặng, chỉ cần khi có dự báo

        khoas = sorted({_khoa5(k) for k in khoas})
        dau_van_tay = hashlib.sha1(json.dumps(khoas).encode("utf-8")).hexdigest()

        def tinh() -> dict:
            try:
                return {"rows": self.du_bao(khoas)}
            except KeHoachVatTuError:
                return {"rows": [], "loi": True, "_khong_cache": True}

        ket = lay_hoac_tinh(tinh, ngan=NGAN_PHU, loai="ton_nhom_du_bao", kho_id=kho_id, khoas=dau_van_tay)
        if ket.get("loi"):
            return {}, False
        return ({_khoa5((d["hang_loai"], d["hang_id"], d["kho_rong"], d["kho_dai"],
                         d.get("don_vi_goc") or "")): d
                 for d in ket["rows"]}, True)

    def _dung_nhom(self, kho_id: int, hom_nay: date) -> tuple[list[_Nhom], bool]:
        theo: dict[tuple, _Nhom] = {}
        for r in self.lots.tong_hop_ton_theo_khoa(kho_id):
            khoa = _khoa5(khoa_ton_cua(r))
            n = theo.get(khoa)
            if n is None:
                n = theo[khoa] = _Nhom(khoa=khoa, hang_loai=r.hang_loai, hang_id=int(r.hang_id))
            n.khoa_tho.add((r.hang_loai, int(r.hang_id), r.don_vi_goc or "", int(r.kho_rong or 0),
                            int(r.kho_dai or 0)))
            n.tong += float(r.tong or 0)
            n.gia_tri += float(r.gia_tri or 0)
            h = _ngay(r.hsd_som)
            if h is not None and (n.hsd_som is None or h < n.hsd_som):
                n.hsd_som = h
        nhom = list(theo.values())

        hang = self.hang.map_theo_cap([(n.hang_loai, n.hang_id) for n in nhom])
        nguong = {_khoa5((t.hang_loai, t.hang_id, t.kho_rong, t.kho_dai, t.don_vi_goc)): t
                  for t in self.thresholds.list_active(kho_id)}
        du_bao, du_bao_ok = self._du_bao_co_cache(kho_id, [n.khoa for n in nhom])
        if du_bao_ok and self.cho_xuat is not None:
            from .du_bao_ton_service import DuBaoTonService

            for k, viec in self.cho_xuat(kho_id).items():
                du_bao[k] = DuBaoTonService.gop_cho_xuat(du_bao.get(k), k, viec)
        for n in nhom:
            m = hang.get((n.hang_loai, n.hang_id))
            n.ma, n.ten = getattr(m, "ma", None) or "", getattr(m, "ten", None) or ""
            n.la_thanh_pham = bool(getattr(m, "la_thanh_pham", False))
            n.dinh_luong, n.quy_kg = dinh_luong_va_quy_kg(
                n.hang_loai, m, n.tong, n.khoa[2], n.khoa[3], n.khoa[4])
            th = nguong.get(n.khoa)
            n.co_nguong = th is not None
            muc = stock_level(n.tong, th)
            # Chưa khai ngưỡng thì chỉ biết "hết"; mức còn lại là "chưa biết" chứ không phải "đủ".
            n.muc = muc if (th is not None or muc == STOCK_OUT) else None
            n.du_bao_row = du_bao.get(n.khoa)
            # Luôn tính (dòng không có lệnh/đơn về vẫn có luật: chạm Tối thiểu, hoặc âm khi chưa khai ngưỡng).
            d = tinh_du_bao_gon(n.tong, n.du_bao_row, th, hom_nay)
            n.d = d if du_bao_ok else None
            n.can_mua = (
                n.muc == STOCK_CRITICAL
                or (n.muc == STOCK_OUT and th is not None)
                or d["can_mua"]
            )
            n.tinh_trang = tinh_trang_dong(n.tong, n.muc, n.co_nguong, n.d)
        nhom.sort(key=lambda n: (bo_dau(n.ten), n.ten, n.khoa[2], n.khoa[3], n.khoa[4], n.khoa[1]))
        return nhom, du_bao_ok

    @staticmethod
    def _khop(n: _Nhom, loc: LocTon, han: date, khoa_ngay: set[tuple] | None) -> bool:
        if loc.hang is not None and (n.hang_loai, n.hang_id) != loc.hang:
            return False
        if loc.q:
            kim = bo_dau(loc.q)
            if kim not in bo_dau(n.ten) and kim not in bo_dau(n.ma):
                return False
        if loc.nhom == "can_mua" and not n.can_mua:
            return False
        if loc.nhom == "du_ton" and n.muc != STOCK_OVER:
            return False
        if loc.nhom == "chuakhai" and n.co_nguong:
            return False
        if loc.nhom == "sap_het_han" and not (n.hsd_som is not None and n.hsd_som <= han):
            return False
        if khoa_ngay is not None and not (n.khoa_tho & khoa_ngay):
            return False
        if loc.ton_tu is not None and n.tong < loc.ton_tu:
            return False
        if loc.ton_den is not None and n.tong > loc.ton_den:
            return False
        if loc.gt_tu is not None and n.gia_tri < loc.gt_tu:
            return False
        if loc.gt_den is not None and n.gia_tri > loc.gt_den:
            return False
        return True

    def trang(self, kho_id: int, loc: LocTon, page: int, size: int, *, hom_nay: date | None = None) -> dict:
        """Một trang nhóm tồn: `{lots, nhom, total, dem, co_hsd, du_bao_ok}`.

        `lots` = lô của các nhóm TRONG TRANG (còn hàng + một lô đại diện cho nhóm đã hết), xếp theo thứ
        tự nhóm rồi ngày nhập — màn dựng nhóm từ đó và giữ nguyên thứ tự. `nhom` = phán quyết + số dự
        báo của từng nhóm trong trang. `total` = số nhóm khớp lọc.
        `dem` = số nhóm theo 5 nhóm lọc, tính trên tập đã lọc bởi ô tìm / kỳ Nhập gần nhất / các khoảng —
        chỉ BỎ chính bộ lọc nhóm (đếm chính nó thì mọi nhóm khác đều về 0 hoặc đều bằng tổng)."""
        hom_nay = hom_nay or date.today()
        han = hom_nay + timedelta(days=SO_NGAY_SAP_HET_HAN)
        nhom, du_bao_ok = self._dung_nhom(kho_id, hom_nay)
        khoa_ngay = (self.lots.khoa_co_lo_nhap_trong(kho_id, loc.ngay_tu, loc.ngay_den)
                     if (loc.ngay_tu or loc.ngay_den) else None)
        loc_dem = replace(loc, nhom="all", hang=None)
        co_so = [n for n in nhom if self._khop(n, loc_dem, han, khoa_ngay)]
        dem = {
            "all": len(co_so),
            "can_mua": sum(1 for n in co_so if n.can_mua),
            "du_ton": sum(1 for n in co_so if n.muc == STOCK_OVER),
            "chuakhai": sum(1 for n in co_so if not n.co_nguong),
            "sap_het_han": sum(1 for n in co_so if n.hsd_som is not None and n.hsd_som <= han),
        }
        khop = [n for n in nhom if self._khop(n, loc, han, khoa_ngay)]
        size = max(1, size)
        trang = khop[(max(1, page) - 1) * size: max(1, page) * size]
        thu_tu = {n.khoa: i for i, n in enumerate(trang)}
        lots = []
        if trang:
            for lot in self.lots.list_lots_gon(
                    kho_id=kho_id, hangs=[(n.hang_loai, n.hang_id) for n in trang]):
                if _khoa5(khoa_ton_cua(lot)) in thu_tu:
                    lots.append(lot)
            lots.sort(key=lambda lo: (thu_tu[_khoa5(khoa_ton_cua(lo))], lo.ngay_nhap, lo.id))
        return {
            "lots": lots, "total": len(khop), "dem": dem, "du_bao_ok": du_bao_ok,
            "co_hsd": any(n.hsd_som is not None for n in nhom),
            "chi_thanh_pham": bool(nhom) and all(n.la_thanh_pham for n in nhom),
            "nhom": [
                {
                    "khoa": n.khoa_chuoi, "hang_loai": n.hang_loai, "hang_id": n.hang_id,
                    "kho_rong": n.khoa[2], "kho_dai": n.khoa[3], "don_vi_goc": n.khoa[4],
                    "can_mua": n.can_mua, "co_nguong": n.co_nguong, "tinh_trang": n.tinh_trang,
                    "la_thanh_pham": n.la_thanh_pham,
                    "dinh_luong": n.dinh_luong, "quy_kg": n.quy_kg,
                    "can_lenh": n.d["can_lenh"] if n.d else None,
                    "dang_ve": n.d["dang_ve"] if n.d else None,
                    "du_kien": n.d["du_kien"] if n.d else None,
                    "duoi_cuoi": bool(n.d and n.d["duoi_cuoi"]),
                    "du_bao": n.du_bao_row if du_bao_ok else None,
                }
                for n in trang
            ],
        }
