"""Nhật ký của MỘT dòng tồn — tab "Lịch sử sửa" ở ngăn mặt hàng màn Tồn kho (03/11/2026).

Dòng tồn = mặt hàng × kho (giấy, vật tư thêm đơn vị gốc + khổ) — đúng khoá một dòng màn Tồn. Trước
ngày này nhật ký sửa tồn ghi theo KHO ("Nhập tay tồn kho Kho giấy: 2 cập nhật — A, B"), không lọc ra
được "ai đã sửa Couche 100". Từ đây mỗi dòng tồn đổi gì là một dòng nhật ký `target = ton:…`.

Tab gom bốn nguồn:
  · `ton:<khoá dòng>`  — sửa tồn / vị trí (nhập tay), đặt mức tồn.
  · `stock_lot:<id>`   — sửa giá gốc lô, bổ sung khổ cho lô cũ (đã ghi theo lô từ trước).
  · `<hang_loai>:<id>` — sửa mặt hàng ở danh mục (tên, mã, đơn vị…), chung mọi kho.
Chuyển kho có tab riêng nên không lặp ở đây.
"""
from __future__ import annotations

import re

from .kho_giay import chuan_kho
from .nhat_ky_danh_muc import PHAN_CACH, _gom_dong

#: Hành động đọc ở tab — nhãn ngắn cho cột "Việc".
VIEC: dict[str, str] = {
    "kho_ton_sua": "Sửa tồn",
    "kho_muc_ton": "Đặt mức tồn",
    "kho_sua_gia_goc": "Sửa giá gốc",
    "kho_bo_sung_kho_lo": "Bổ sung khổ",
    "dm_tao": "Tạo ở danh mục",
    "dm_sua": "Sửa ở danh mục",
}


def target_dong_ton(kho_id: int, hang_loai: str, hang_id: int, goc: str | None = None,
                    kho_rong: int = 0, kho_dai: int = 0) -> str:
    """Khoá nhật ký của một dòng tồn. Đơn vị gốc chữ thường, khổ chuẩn hoá — cùng luật `_loc_kho`,
    để nhập tay, đặt mức và ngăn mặt hàng ra cùng một chuỗi."""
    kr, kd = chuan_kho(kho_rong, kho_dai)
    return f"ton:{int(kho_id)}:{hang_loai}:{int(hang_id)}:{(goc or '').strip().lower()}:{kr}x{kd}"


def gom(dong: list[str]) -> str:
    return _gom_dong([d for d in dong if d])


def tach(detail: str) -> list[str]:
    """Chi tiết → từng thay đổi một dòng (cùng dấu nối với nhật ký danh mục)."""
    return [p for p in (detail or "").split(PHAN_CACH) if p.strip()]


# ======================= đọc ra tab (phương án B, 03/11/2026) =======================

#: Nhãn thông tin biết trước — tách đúng "Nhãn cũ → mới" khi nhãn nhiều chữ ("Công thức tính giá").
_NHAN_RIENG = ("Tồn", "Vị trí", "Tối thiểu", "Tối đa", "giá gốc")
#: Thông tin có số ⇒ tính cột Chênh.
_CO_CHENH = ("Tồn", "Tối thiểu", "Tối đa", "Giá gốc", "Đơn giá")
_SO = re.compile(r"^(-?[\d.]+(?:,\d+)?)\s*(.*)$")


def _so(chu: str) -> tuple[float, str] | None:
    """"38.710 tờ" → (38710.0, "tờ"); không phải số ⇒ None. Số in kiểu Việt: chấm nghìn, phẩy lẻ."""
    m = _SO.match((chu or "").strip())
    if not m:
        return None
    try:
        return float(m.group(1).replace(".", "").replace(",", ".")), m.group(2).strip()
    except ValueError:
        return None


def _nhan_biet() -> list[str]:
    from .nhat_ky_danh_muc import NHAN
    return sorted({*NHAN.values(), *_NHAN_RIENG}, key=len, reverse=True)


def _mot_doi(chu: str, nhan_biet: list[str], nhan_mac_dinh: str) -> dict | None:
    """"Tồn 38.710 tờ → 30.000 tờ" → {thong_tin, truoc, sau, chenh, don_vi}; không có "→" ⇒ None."""
    if " → " not in chu:
        return None
    trai, sau = (x.strip() for x in chu.split(" → ", 1))
    ma_lo = None
    if ": " in trai:
        ma_lo, trai = trai.split(": ", 1)
    nhan = next((n for n in nhan_biet if trai.lower().startswith(n.lower())
                 and (len(trai) == len(n) or trai[len(n)] == " ")), None)
    truoc = trai[len(nhan):].strip() if nhan else trai
    nhan = nhan or nhan_mac_dinh or "Thông tin"
    nhan = nhan[:1].upper() + nhan[1:]
    a, b = _so(truoc), _so(sau)
    if a and b and not a[1] and b[1]:
        truoc = f"{truoc} {b[1]}"   # dòng cũ chỉ ghi đơn vị ở vế sau
    chenh = None
    if a and b and nhan in _CO_CHENH:
        chenh = b[0] - a[0]
    return {
        "thong_tin": nhan + (f" lô {ma_lo}" if ma_lo else ""),
        "truoc": truoc or "–", "sau": sau or "–",
        "chenh": chenh, "don_vi": b[1] if b else "",
        "truoc_so": a[0] if a else None, "sau_so": b[0] if b else None,
    }


def doc_lan_sua(log, *, can_view_cost: bool) -> dict:
    """Một dòng nhật ký → {viec, ghi_chu, dong[]} cho tab Lịch sử sửa. `ghi_chu` chỉ là chữ NGƯỜI
    DÙNG gõ lúc sửa (máy không tự điền "sửa ở đâu"); sửa lại sau thì đọc từ `audit_ghi_chu`. Không
    thấy giá thì vẫn biết CÓ lần sửa giá, chỉ giấu số."""
    phan = tach(log.detail)
    loai = (log.target or "").split(":", 1)[0]
    viec = VIEC.get(log.action, log.action)
    if loai == "ton":
        phan = phan[1:]          # mẩu đầu "mặt hàng tại kho" cho màn Nhật ký chung
    if log.action == "dm_tao":
        ten = (log.detail or "").strip()
        return {"viec": viec, "ghi_chu": "",
                "dong": [{"thong_tin": "Mặt hàng", "truoc": "chưa có", "sau": ten or "–",
                          "chenh": None, "don_vi": ""}]}
    nhan_biet = _nhan_biet()
    mac_dinh = "Khổ" if log.action == "kho_bo_sung_kho_lo" else ""
    dong, ghi = [], []
    for p in phan:
        d = _mot_doi(p, nhan_biet, mac_dinh)
        if d is not None:
            if not can_view_cost and d["thong_tin"].lower().startswith(("đơn giá", "giá")):
                d.update(truoc="có", sau="đã sửa", chenh=None, truoc_so=None, sau_so=None)
            dong.append(d)
        elif p.startswith("Ghi chú: "):
            ghi.append(p[len("Ghi chú: "):])
        elif p.endswith("trên màn Tồn kho"):
            if p.startswith("Thêm hàng"):
                viec = "Thêm hàng"
        elif dong:
            dong[-1]["thong_tin"] += f" ({p})"   # chú thích của máy cho dòng ngay trước, vd "3 lô"
        else:
            dong.append({"thong_tin": p, "truoc": "", "sau": "", "chenh": None, "don_vi": ""})
    return {"viec": viec, "ghi_chu": "; ".join(ghi), "dong": dong}
