"""Sự kiện SSE gửi THEO ĐỐI TƯỢNG thay vì broadcast (sức chịu tải A3, 28/09/2026).

Mỗi `hub.broadcast` làm mọi màn đang mở của cả công ty nạp lại theo từng cú bấm của bất kỳ ai. Nay
mỗi nơi gửi dùng `hub.gui(quyen=…, to=…, nguoi=…)` với tập màn nghe chép từ FE (`doi_tuong_nhan`).

(a) Guard nguồn: trong `backend/app` không còn `hub.broadcast(` ngoài danh sách cho phép.
(b) Vài luồng điển hình: dựng hub THẬT với vài kết nối mang bộ quyền, gọi đúng hàm phát của
    router/service, xem ai nhận / ai không.
"""
from __future__ import annotations

import ast
import asyncio
import warnings
from pathlib import Path

from app.doi_tuong_nhan import (
    BAN_TO,
    KCS,
    MAN_BAN_HANG,
    MAN_GIAO_HANG,
    MAN_KHO,
    MAN_KHVT,
    MAN_MUA_KE_TOAN,
    MAN_NHAN_SU,
    MAN_NHAT_KY,
    MAN_THEO_LENH,
    kem_ban_to,
)
from app.realtime import EventHub

APP = Path(__file__).resolve().parents[1] / "app"

# (file tương đối trong app/, hàm chứa lời gọi) được phép còn `hub.broadcast(`.
CHO_PHEP: set[tuple[str, str]] = set()


def _cho_broadcast() -> set[tuple[str, str]]:
    """Mọi lời gọi `<…>hub.broadcast(` trong app/, kèm hàm (trong cùng) chứa nó."""
    ra: set[tuple[str, str]] = set()
    for p in APP.rglob("*.py"):
        with warnings.catch_warnings():   # vài docstring cũ có "\m" — việc của file đó, không phải guard này
            warnings.simplefilter("ignore", SyntaxWarning)
            warnings.simplefilter("ignore", DeprecationWarning)
            cay = ast.parse(p.read_text(encoding="utf-8"))
        cha: dict[ast.AST, ast.AST] = {}
        for n in ast.walk(cay):
            for con in ast.iter_child_nodes(n):
                cha[con] = n
        for n in ast.walk(cay):
            if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                    and n.func.attr == "broadcast"
                    and ast.unparse(n.func.value).split(".")[-1] == "hub"):
                continue
            ham, x = "<module>", n
            while x in cha:
                x = cha[x]
                if isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    ham = x.name
                    break
            ra.add((p.relative_to(APP).as_posix(), ham))
    return ra


def test_khong_con_broadcast_ngoai_danh_sach_cho_phep():
    thua = _cho_broadcast() - CHO_PHEP
    assert not thua, (
        "Còn `hub.broadcast` — đổi sang `hub.gui(quyen=…, to=…, nguoi=…)` theo màn FE nghe sự kiện "
        f"(xem app/doi_tuong_nhan.py): {sorted(thua)}"
    )


def test_su_kien_da_bo_khong_con_ai_phat():
    """`order_deposit_needed` (không màn nào mount nơi nghe, mang số tiền cọc) và `san_xuat_changed`
    (trùng `lsx_changed` cùng cửa ghi) đã bỏ."""
    for p in APP.rglob("*.py"):
        nguon = p.read_text(encoding="utf-8")
        for loai in ('"order_deposit_needed"', '"san_xuat_changed"'):
            assert loai not in nguon, f"{p.relative_to(APP)} còn phát {loai}"


def test_khoa_trong_tap_man_nghe_la_module_that():
    """Gõ sai một khoá là cả nhóm người mất tin real-time mà không test nghiệp vụ nào đỏ."""
    from app.seed import MODULES

    that = {k for k, _ in MODULES}
    # KCS nay là module THẬT `kcs` (mg 0383) — chỉ còn `BAN_TO` là khoá giả.
    assert KCS in that
    assert BAN_TO not in that, "khoá giả trùng một module thật"
    from app.services.quyen_ke_hoach import NGHE_KE_HOACH

    # `ke_hoach_bp`: khoá giả của người có Xem ở ít nhất một dòng Kế hoạch bộ phận (08/11/2026).
    assert NGHE_KE_HOACH not in that, "khoá giả trùng một module thật"
    gia = {BAN_TO, NGHE_KE_HOACH}
    for tap in (MAN_BAN_HANG, MAN_MUA_KE_TOAN, MAN_NHAN_SU, MAN_THEO_LENH, MAN_KHO,
                MAN_GIAO_HANG, MAN_KHVT, MAN_NHAT_KY):
        assert set(tap) - gia <= that, sorted(set(tap) - gia - that)


def test_kem_ban_to_biet_to_thi_nham_to_khong_thi_moi_ban_to():
    assert kem_ban_to(("san_xuat",), [7, None, 3]) == {"quyen": ["san_xuat"], "to": [3, 7]}
    assert kem_ban_to(("san_xuat",), [None]) == {"quyen": [BAN_TO, "san_xuat"], "to": []}


# --- (b) luồng điển hình qua hub thật ---------------------------------------------------------
def _chay(monkeypatch, cac_module, kich_ban):
    """Hub thật trên loop của test; thay `hub` của các module phát bằng hub này."""
    async def main():
        hub = EventHub()
        hub.set_loop(asyncio.get_running_loop())
        for m in cac_module:
            monkeypatch.setattr(m, "hub", hub)
        return await kich_ban(hub)
    return asyncio.run(main())


async def _nhan(q: asyncio.Queue) -> list[str]:
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    ra = []
    while not q.empty():
        ra.append(q.get_nowait()["type"])
    return ra


def test_nghi_phep_chi_toi_nguoi_xem_man_nhan_su(monkeypatch):
    from app.routers import leaves

    async def kb(hub):
        duyet = hub.subscribe(1, quyen=frozenset({"nghi_phep"}))
        luong = hub.subscribe(2, quyen=frozenset({"luong"}))       # màn Lương nghe cùng nhóm
        ke_toan = hub.subscribe(3, quyen=frozenset({"ke_toan", "phieu_chi"}))
        tho = hub.subscribe(4, quyen=frozenset({"to:5", BAN_TO}))
        leaves._notify_pending_changed()
        return [await _nhan(q) for q in (duyet, luong, ke_toan, tho)]

    duyet, luong, ke_toan, tho = _chay(monkeypatch, [leaves], kb)
    assert duyet == luong == ["leave_pending_changed"]
    assert ke_toan == tho == []


def test_viec_ban_to_toi_dung_to_va_man_theo_lenh(monkeypatch):
    from app.routers import san_xuat

    async def kb(hub):
        to_5 = hub.subscribe(1, quyen=frozenset({"to:5", BAN_TO}))
        to_6 = hub.subscribe(2, quyen=frozenset({"to:6", BAN_TO}))
        ke_hoach = hub.subscribe(3, quyen=frozenset({"san_xuat"}))
        kcs = hub.subscribe(4, quyen=frozenset({KCS}))
        nhan_su = hub.subscribe(5, quyen=frozenset({"nghi_phep"}))
        san_xuat._phat_sse({"department_id": 5, "cong_viec_id": 9, "trang_thai": "dang_chay"})
        return [await _nhan(q) for q in (to_5, to_6, ke_hoach, kcs, nhan_su)]

    to_5, to_6, ke_hoach, kcs, nhan_su = _chay(monkeypatch, [san_xuat], kb)
    assert to_5 == ke_hoach == kcs == ["san_xuat_cong_viec_changed"]
    assert to_6 == nhan_su == []


def test_khong_ro_to_thi_moi_ban_to(monkeypatch):
    from app.routers import gia_cong_ngoai, san_xuat

    async def kb(hub):
        to_5 = hub.subscribe(1, quyen=frozenset({"to:5", BAN_TO}))
        to_6 = hub.subscribe(2, quyen=frozenset({"to:6", BAN_TO}))
        to_7 = hub.subscribe(3, quyen=frozenset({"to:7", BAN_TO}))
        ke_toan = hub.subscribe(4, quyen=frozenset({"ke_toan"}))
        # Gia công ngoài mở lại: gói không nói tổ nào ⇒ mọi người có Bàn tổ.
        hub.gui({"type": "san_xuat_cong_viec_changed"},
                **kem_ban_to(MAN_THEO_LENH, ()))
        return [await _nhan(q) for q in (to_5, to_6, to_7, ke_toan)]

    dot = _chay(monkeypatch, [san_xuat, gia_cong_ngoai], kb)
    assert dot == [["san_xuat_cong_viec_changed"]] * 3 + [[]]


def test_mua_hang_toi_thu_mua_ke_toan_va_nguoi_dung_ten(monkeypatch):
    from app.routers import purchases

    async def kb(hub):
        thu_mua = hub.subscribe(1, quyen=frozenset({"thu_mua"}))
        khvt = hub.subscribe(2, quyen=frozenset({"ke_hoach_vat_tu"}))
        nguoi_lap = hub.subscribe(9, quyen=frozenset())               # không module nào
        nhan_su = hub.subscribe(4, quyen=frozenset({"nghi_phep"}))
        purchases._notify_purchase_changed("PMH-1", event_type="purchase_decision",
                                           decision="approved", actor_user_id=1,
                                           recipient_user_id=9)
        # Từ 07/10/2026 nhóm `khvt` nhận MỌI sự kiện mua (lưới Kế hoạch vật tư bày bước của phiếu
        # mua từng ô), trừ hoá đơn mua.
        dot1 = [await _nhan(q) for q in (thu_mua, khvt, nguoi_lap, nhan_su)]
        # Đợt giao đổi ⇒ còn nhích nhóm `khvt` (hàng đang về của Kế hoạch vật tư).
        purchases._notify_purchase_changed("PMH-1", event_type="purchase_delivery_created",
                                           seq_no=2, actor_user_id=1)
        dot2 = [await _nhan(q) for q in (thu_mua, khvt, nguoi_lap, nhan_su)]
        return dot1, dot2

    dot1, dot2 = _chay(monkeypatch, [purchases], kb)
    assert dot1 == [["purchase_decision"], ["purchase_decision"], ["purchase_decision"], []]
    assert dot2 == [["purchase_delivery_created"], ["purchase_delivery_created"], [], []]


def test_ke_toan_hoa_don_ban_toi_ca_nhom_ban_hang(monkeypatch):
    from app.routers import accounting

    async def kb(hub):
        phieu_thu = hub.subscribe(1, quyen=frozenset({"phieu_thu"}))
        sale = hub.subscribe(2, quyen=frozenset({"don_hang_ban"}))
        tho = hub.subscribe(3, quyen=frozenset({"to:5", BAN_TO}))
        accounting._notify_accounting_changed("DH-1", event_type="sales_invoice_created",
                                              invoice_id=4, actor_user_id=1)
        # Tạm ứng: nhóm nhân sự, không tới Sale.
        luong = hub.subscribe(4, quyen=frozenset({"luong"}))
        accounting.hub.gui({"type": "advance_pending_changed"}, quyen=MAN_NHAN_SU)
        return [await _nhan(q) for q in (phieu_thu, sale, tho, luong)]

    phieu_thu, sale, tho, luong = _chay(monkeypatch, [accounting], kb)
    assert phieu_thu == sale == ["sales_invoice_created"]
    assert tho == []
    assert luong == ["advance_pending_changed"]


def test_nhat_ky_chi_toi_nguoi_xem_nhat_ky(monkeypatch):
    from app.repositories import audit_repo
    from app import realtime

    async def kb(hub):
        nk = hub.subscribe(1, quyen=frozenset({"activity_log"}))
        khac = hub.subscribe(2, quyen=frozenset({"san_xuat", "ke_toan"}))
        monkeypatch.setattr(audit_repo, "_lan_bao_cuoi", -1e9)
        audit_repo._bao_co_dong_moi()
        return await _nhan(nk), await _nhan(khac)

    nk, khac = _chay(monkeypatch, [realtime], kb)
    assert nk == ["nhat_ky_moi"] and khac == []
