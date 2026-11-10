"""BỘ PHẬN sản xuất — nơi nhận bước Nội bộ của lệnh (thiết kế 07/11/2026,
`docs/design-lenh-san-xuat-ke-hoach-bo-phan.md` §4).

Bộ phận = phòng trực thuộc NGAY dưới phòng gốc của khối Sản xuất (phòng tự bật `la_san_xuat`).
Không viết cứng mã phòng: cây đọc qua `quyen_to.doc_cay`. Nhóm thợ là phòng con của bộ phận; bộ
phận không có phòng con thì tự là nhóm của chính nó.

Bước đi về bộ phận nào: lấy các nhóm tick ở danh mục công đoạn (`cong_doan_to`), đi ngược lên bộ
phận chứa từng nhóm. Nhiều bộ phận thì chọn sẵn bộ phận có NHIỀU NHÓM ĐƯỢC TICK NHẤT; bằng nhau thì
bộ phận chứa tổ tick đầu tiên (tổ mặc định cũ).
"""
from __future__ import annotations

from dataclasses import dataclass

from ..quyen_to import CayKhoi


@dataclass(frozen=True)
class UngVien:
    id: int
    ten: str
    so_nhom: int


def danh_sach_bo_phan(cay: CayKhoi) -> list[int]:
    """Mọi bộ phận theo thứ tự cây (con trực tiếp của từng phòng gốc)."""
    return [c for g in cay.goc for c in cay.con.get(g, [])]


def bo_phan_cua(cay: CayKhoi, dept_id: int | None) -> int | None:
    """Bộ phận chứa phòng `dept_id` (chính nó nếu nó là bộ phận). Phòng gốc hoặc ngoài khối ⇒ None."""
    if not cay.co(dept_id):
        return None
    cur, seen = dept_id, set()
    while cur is not None and cur not in seen:
        seen.add(cur)
        cha = cay.cha.get(cur)
        if cha is None:
            return None  # chính là phòng gốc
        if cay.cha.get(cha) is None:
            return cur  # cha là gốc ⇒ cur là bộ phận
        cur = cha
    return None


def ung_vien_cua(cay: CayKhoi, to_tick: list[int]) -> list[UngVien]:
    """Bộ phận làm được công đoạn có danh sách nhóm tick `to_tick` (đúng thứ tự tick), xếp theo
    luật chọn sẵn: nhiều nhóm nhất trước; bằng nhau thì bộ phận chứa tổ tick đầu tiên trước."""
    dem: dict[int, int] = {}
    dau: dict[int, int] = {}
    for i, t in enumerate(to_tick):
        bp = bo_phan_cua(cay, t)
        if bp is None:
            continue
        dem[bp] = dem.get(bp, 0) + 1
        dau.setdefault(bp, i)
    ds = sorted(dem, key=lambda b: (-dem[b], dau[b]))
    return [UngVien(id=b, ten=cay.ten.get(b, f"#{b}"), so_nhom=dem[b]) for b in ds]


def bo_phan_mac_dinh(cay: CayKhoi, to_tick: list[int]) -> int | None:
    ds = ung_vien_cua(cay, to_tick)
    return ds[0].id if ds else None


def nhom_cua_bo_phan(cay: CayKhoi, bo_phan_id: int, to_tick: list[int]) -> list[int]:
    """Nhóm thợ của bộ phận nhận được việc của công đoạn: phòng LÁ trong bộ phận mà công đoạn có
    tick. Bộ phận không có phòng con ⇒ chính nó. Công đoạn không tick nhóm nào trong bộ phận (dữ
    liệu cũ) ⇒ mọi phòng lá của bộ phận."""
    vung = cay.vung(bo_phan_id)
    la = [d for d, _cap in cay.thu_tu() if d in vung and cay.la(d)]
    if not la:
        return [bo_phan_id]
    tick = [t for t in to_tick if t in vung]
    if not tick:
        return la
    # Tick ở một phòng gom (không phải lá) ⇒ mọi lá dưới nó.
    ra: list[int] = []
    for t in tick:
        for d in (la if t == bo_phan_id else [x for x in la if x in cay.vung(t)]):
            if d not in ra:
                ra.append(d)
    return ra

