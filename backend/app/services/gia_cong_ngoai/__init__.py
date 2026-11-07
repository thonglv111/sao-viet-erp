"""Gia công ngoài — service (spec docs/superpowers/specs/2026-09-26-gia-cong-ngoai-design.md).

Một cửa ghi DUY NHẤT cho lần gia công: `mot_phan.mang_di`, `chot.chot` / `chot.mo_lai`,
`tron_goi.*`. Bàn tổ / KCS / Xếp lịch chỉ nhìn, không ghi.
"""
from __future__ import annotations

TT_CHO_MANG_DI = "cho_mang_di"
TT_DANG_O_NGOAI = "dang_o_ngoai"
TT_DANG_GIA_CONG = "dang_gia_cong"   # trọn gói, chưa chốt
TT_DA_XONG = "da_xong"
TT_DA_HUY = "da_huy"

# Câu chặn chung cho mọi cửa xưởng (bàn tổ, ghi mẻ, KCS) gặp công việc gia công ngoài.
CHAN_XUONG = (
    "Công việc Gia công ngoài — ghi nhận ở khối Gia công ngoài trên lệnh (Đã mang đi / Chốt số), "
    "không làm ở Việc của tổ hay KCS."
)


class GiaCongXungDot(ValueError):
    """Lần gia công vừa bị người khác đổi (lệch `version`) — router dịch 409."""


def trang_thai(gcn) -> str:
    """Trạng thái DẪN XUẤT từ các mốc — không lưu cột (spec §2)."""
    if gcn.huy_luc is not None:
        return TT_DA_HUY
    if gcn.chot_luc is not None:
        return TT_DA_XONG
    if gcn.kieu == "tron_goi":
        return TT_DANG_GIA_CONG
    if gcn.mang_di_luc is not None:
        return TT_DANG_O_NGOAI
    return TT_CHO_MANG_DI


def so_vi(v) -> str:
    """Số kiểu Việt cho câu nhật ký: 5.000 · 1.250,5 · 1.000.000. Câu nhật ký đông cứng trong
    audit nên phải định dạng LÚC GHI — `:g` cũ in "5000" và từ một triệu là "1e+06"."""
    x = round(float(v), 3)
    nguyen, _, le = f"{abs(x):,.3f}".partition(".")
    le = le.rstrip("0")
    chu = nguyen.replace(",", ".") + ("," + le if le else "")
    return ("-" if x < 0 else "") + chu


def kiem_version(gcn, expected: int | None) -> None:
    if expected is not None and int(expected) != int(gcn.version):
        raise GiaCongXungDot("Lần gia công vừa được người khác cập nhật — tải lại rồi làm tiếp.")


def la_gia_cong(cv) -> bool:
    return getattr(cv, "gia_cong_ngoai_id", None) is not None


# Lần nào ĐẠI DIỆN cho lệnh trên dòng danh sách: lần đang mở trước lần đã xong; trong lần đang
# mở thì cái đang nằm ở nhà gia công (người kế hoạch phải đi lấy về) trước cái còn chờ mang đi.
_UU_TIEN_DONG = {TT_DANG_GIA_CONG: 0, TT_DANG_O_NGOAI: 1, TT_CHO_MANG_DI: 2, TT_DA_XONG: 3}


def lan_can_hoi_xuat_giay(cap: list[tuple[int, object, str | None]]) -> set[int]:
    """Lần trọn gói xưởng cấp giấy còn chạy trong `cap` — chỉ những lần này mới cần hỏi kho xem đã
    có đề nghị xuất giấy chưa (tập thường rỗng ⇒ khỏi tốn câu nào)."""
    from ...models.gia_cong_ngoai import KIEU_TRON_GOI
    return {g.id for _, g, _ in cap
            if g.kieu == KIEU_TRON_GOI and g.xuong_cap_giay and g.chot_luc is None
            and g.huy_luc is None}


def tom_tat_theo_lenh(cap: list[tuple[int, object, str | None]],
                      co_xuat_giay: set[int] | None = None) -> dict[int, dict]:
    """Tóm tắt gia công ngoài cho TỪNG dòng của danh sách Kế hoạch SX, từ kết quả
    `GiaCongNgoaiRepository.cua_nhieu_lenh` (lần đã huỷ đã bị loại ở đó). Thuần — không query.
    `co_xuat_giay` = lần đã có đề nghị xuất giấy còn sống (`co_yeu_cau_xuat`); None ⇒ không tính
    chip "Chờ cấp giấy".

    Bảng lệnh không có cột nào nói lệnh đang ở nhà gia công: lệnh trọn gói hiện "6 bước · Cắt 2"
    như lệnh chạy ở xưởng. Dòng này cho bảng biết đặt chip gì."""
    gom: dict[int, list[tuple[object, str | None]]] = {}
    for lsx_id, gcn, bg_ma in cap:
        gom.setdefault(lsx_id, []).append((gcn, bg_ma))
    can = lan_can_hoi_xuat_giay(cap) if co_xuat_giay is not None else set()
    out: dict[int, dict] = {}
    for lsx_id, ds in gom.items():
        tt = [(trang_thai(g), g, bg) for g, bg in ds]
        so_mo = sum(1 for t, _, _ in tt if t != TT_DA_XONG)
        t, g, bg = min(tt, key=lambda x: (_UU_TIEN_DONG.get(x[0], 9), x[1].id))
        out[lsx_id] = {
            "kieu": g.kieu, "trang_thai": t,
            "nha_cung_cap_ten": g.nha_cung_cap_ten, "ten_viec": g.ten_viec,
            "bai_ghep_ma": bg, "so_lan": len(tt), "so_lan_mo": so_mo,
            "cho_cap_giay": co_xuat_giay is not None and any(
                x.id in can and x.id not in co_xuat_giay for x, _ in ds),
        }
    return out
