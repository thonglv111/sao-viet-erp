"""Dự báo tồn cho màn Tồn kho: tồn hôm nay − lệnh sắp lĩnh + hàng đang về.

CHỈ ĐỌC và KHÔNG có luật riêng: "lệnh cần bao nhiêu, theo thứ tự nào" lấy nguyên từ bảng cân đối
vật tư (`bang_can_doi` — chung bản cache 45 giây với màn Kế hoạch vật tư), "đang về" và "phiếu mua
đang chạy" lấy từ đúng hai hàm bảng cân đối dùng (`dang_ve_va_vet_mua`). Hai màn nhìn một bộ số.

Mặt hàng chưa lệnh nào cần thì bảng cân đối không có nhóm của nó — vẫn trả dòng (cần 0) để màn
Tồn kho bày được hàng đang về và phiếu mua đã có, khỏi lập yêu cầu mua chồng.
"""
from __future__ import annotations

from .can_doi_cache import bang_can_doi
from .kho_giay import co_don_vi_goc
from .mua_cho import gop_mua_cho, mua_cho_theo_dong_don


def _khoa5(hang: tuple) -> tuple[str, int, int, int, str]:
    """Khoá tồn 5 phần `kho_giay.Khoa`; cặp `(loai, id)` ⇒ `(loai, id, 0, 0, "")`."""
    h = tuple(hang)
    if len(h) == 5:
        return (h[0], int(h[1]), int(h[2]), int(h[3]), str(h[4] or ""))
    return (h[0], int(h[1]), 0, 0, "")


class DuBaoTonService:
    def __init__(self, kh, giu) -> None:
        self.kh = kh
        self.giu = giu

    def du_bao(self, hangs: list[tuple]) -> list[dict]:
        """`hangs` = khoá tồn của các dòng trên màn (cặp `(loai, id)` hoặc khoá 5 phần)."""
        khoas = sorted({_khoa5(h) for h in hangs})
        if not khoas:
            return []
        # Một bản nhớ phiếu mua cho cả lượt: bảng cân đối (nếu cache nguội) và phần đang về bên dưới
        # cùng đọc một danh sách phiếu thay vì mỗi chỗ tự nạp lại.
        with self.kh.nho_phieu_mua():
            return self._du_bao(khoas)

    def _du_bao(self, khoas: list[tuple]) -> list[dict]:
        bang = bang_can_doi(self.kh, self.giu)
        # Nhóm bảng cân đối của giấy / vật tư mang đơn vị gốc (đơn vị đã khai) — cùng khổ khác gốc là
        # hai nhóm.
        nhom_theo_khoa = {
            _khoa5((n["hang_loai"], n["hang_id"], n.get("kho_rong") or 0, n.get("kho_dai") or 0,
                    (n.get("don_vi_goc") or "") if co_don_vi_goc(n["hang_loai"]) else "")): n
            for n in bang.get("items", [])
            if n.get("loai_nhom") == "vat_tu"
        }
        dang_ve, vet = self.kh.dang_ve_va_vet_mua(khoas)
        # "Mua cho" của mọi dòng đơn đang về — một lượt cho cả màn.
        mc = mua_cho_theo_dong_don(
            self.kh.db, [d for k in khoas for *_x, d in dang_ve.get(k, [])])

        out: list[dict] = []
        for k in khoas:
            nhom = nhom_theo_khoa.get(k)
            lenh = self._lenh_cua(nhom) if nhom else []
            ve: dict[tuple, float] = {}
            ve_mc: dict[tuple, list] = {}
            for ngay, sl, ma, dong_id in dang_ve.get(k, []):
                ve[(ngay, ma)] = ve.get((ngay, ma), 0.0) + float(sl)
                ve_mc.setdefault((ngay, ma), []).append(mc.get(dong_id))
            out.append({
                "hang_loai": k[0], "hang_id": k[1], "kho_rong": k[2], "kho_dai": k[3],
                "don_vi_goc": k[4],
                "ton_toan_xuong": (nhom.get("ton") if nhom else None),
                "can_lenh": sum(x["can"] for x in lenh),
                "dang_ve": sum(ve.values()),
                "lenh": lenh,
                "ve": [self._ve_json(ngay, ma, sl, ve_mc.get((ngay, ma), []))
                       for (ngay, ma), sl in sorted(ve.items(), key=lambda x: (x[0][0], x[0][1] or ""))],
                "phieu_mua": list(vet.get(k, [])),
            })
        return out

    def cho_xuat(self, kho_id: int) -> dict[tuple, list[dict]]:
        """`{khoá 5 phần: [việc xuất]}` — đề nghị XUẤT còn treo ở KHO NÀY không gắn lệnh/bài (giao hàng
        đã lên đơn, gia công ngoài, xuất lẻ), cùng dạng phần tử `lenh` để màn trải chung một chuỗi.

        Tính TƯƠI mỗi lượt (một câu theo kho), không qua cache 45 giây của bảng cân đối: kho ghi sổ
        xong thì số Sắp xuất phải rụng ngay (12/10/2026)."""
        from ..repositories.nguon_phieu_kho_repo import NguonPhieuKhoRepository
        from .ke_hoach_vat_tu_service import KeHoachVatTuError
        from .stock_request_service import StockRequestService

        dong = self.kh.requests.dong_xuat_cho_cua_kho(kho_id)
        giao = NguonPhieuKhoRepository(self.kh.db).giao_theo_chuyen(
            {req.delivery_trip_id for _ln, req in dong if req.delivery_trip_id})
        out: dict[tuple, dict[int, dict]] = {}
        for ln, req in dong:
            con = StockRequestService.con_lai(ln)
            if con <= 0:
                continue
            goc = ln.don_vi_goc or None
            try:
                if co_don_vi_goc(ln.hang_loai):
                    sl, _ten = self.kh.ve_don_vi_goc(ln.hang_loai, ln.hang_id, ln.dvt, con, goc=goc)
                    goc = goc or self.kh.don_vi_goc_cua(ln.hang_loai, ln.hang_id, ln.dvt)
                else:
                    sl = con
            except KeHoachVatTuError:
                continue   # đơn vị không quy được về gốc — kho cũng không ghi sổ được dòng này
            khoa = _khoa5((ln.hang_loai, ln.hang_id, ln.kho_rong or 0, ln.kho_dai or 0,
                           (goc or "") if co_don_vi_goc(ln.hang_loai) else ""))
            g = giao.get(req.delivery_trip_id) if req.delivery_trip_id else None
            # Một đề nghị là một việc xuất dù có hai dòng cùng mặt hàng.
            x = out.setdefault(khoa, {}).get(req.id)
            if x is None:
                out[khoa][req.id] = {
                    "ma": req.ma, "lsx_id": None, "bai_ghep_id": None, "de_nghi_id": req.id,
                    "ten_viec": (f"Giao đơn {g[2]}" if g and g[2] else "Giao hàng") if g else None,
                    "khach_ten": None,
                    "han_giao": req.ngay_can.isoformat() if req.ngay_can else None,
                    "can": float(sl), "da_giu": 0.0,
                }
            else:
                x["can"] += float(sl)
        return {k: list(v.values()) for k, v in out.items()}

    @staticmethod
    def gop_cho_xuat(row: dict | None, khoa: tuple, viec: list[dict]) -> dict:
        """Dòng dự báo + các việc xuất của `cho_xuat` (đứng sau lệnh; chuỗi tự sắp lại theo ngày)."""
        if row is None:
            row = {"hang_loai": khoa[0], "hang_id": khoa[1], "kho_rong": khoa[2], "kho_dai": khoa[3],
                   "don_vi_goc": khoa[4], "ton_toan_xuong": None, "can_lenh": 0.0, "dang_ve": 0.0,
                   "lenh": [], "ve": [], "phieu_mua": []}
        lenh = list(row.get("lenh") or []) + viec
        return {**row, "lenh": lenh, "can_lenh": sum(float(x["can"]) for x in lenh)}

    @staticmethod
    def _ve_json(ngay, ma, sl, muc) -> dict:
        loai, lenh = gop_mua_cho(muc)
        return {"ma": ma, "ngay_ve": ngay, "sl": sl, "mua_cho": lenh, "loai_mua_cac": loai}

    @staticmethod
    def _lenh_cua(nhom: dict) -> list[dict]:
        """Gộp dòng của bảng theo CHỦ THỂ (lệnh / bài): một lệnh ăn cùng món ở hai bước vẫn là một
        lệnh phải lĩnh. Giữ thứ tự xuất hiện = thứ tự ăn tồn của engine."""
        theo: dict[tuple, dict] = {}
        for d in nhom.get("dong", []):
            can = d.get("con_phai_co")
            if d.get("loai") != "vat_tu" or not can or can <= 0:
                continue
            chu = (d.get("lsx_id"), d.get("bai_ghep_id"))
            x = theo.get(chu)
            # Giữ chỗ gộp sẵn theo (chủ thể, mặt hàng) trên MỖI dòng — lấy một lần, không cộng.
            giu = float(d.get("da_giu_kho") or 0) + float(d.get("da_giu_dang_ve") or 0)
            if x is None:
                theo[chu] = {
                    "ma": d["ma"], "lsx_id": d.get("lsx_id"), "bai_ghep_id": d.get("bai_ghep_id"),
                    "ten_viec": d.get("ten_viec"), "khach_ten": d.get("khach_ten"),
                    "han_giao": d.get("han_giao_khach"), "can": float(can), "da_giu": giu,
                }
            else:
                x["can"] += float(can)
                x["da_giu"] = max(x["da_giu"], giu)
                h = d.get("han_giao_khach")
                if h and (x["han_giao"] is None or str(h) < str(x["han_giao"])):
                    x["han_giao"] = h
        return list(theo.values())
