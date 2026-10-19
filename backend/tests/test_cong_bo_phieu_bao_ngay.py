"""Công bố phiếu lương phải tới người lao động NGAY (lỗi #39 bấm thử 18/10/2026).

Màn "Phiếu lương của tôi" đang mở ghi "Phiếu sẽ hiện ngay khi HCNS công bố" mà HCNS công bố xong vẫn
đứng yên: `cong_bo_phieu` chỉ ghi nhật ký, không đẩy gì. Hẹn giờ công bố càng không có gì báo.

Luật (gửi nội bộ = real-time): công bố mở ngay ⇒ đẩy `phieu_luong_cong_bo` đích danh từng người có
dòng lương trong kỳ, kèm câu toast. Hẹn giờ ⇒ lúc công bố không đẩy; vòng quét nền đẩy đúng một
lần khi giờ mở trôi qua.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.db import SessionLocal
from app.realtime import hub
from app.repositories.user_repo import UserRepository
from tests.test_cong_bo_phieu_va_de_khoan import NAM, THANG, _chot_luong, _h, _nv_gan_admin


@pytest.fixture
def da_day(monkeypatch):
    ds: list[tuple[dict, dict]] = []
    monkeypatch.setattr(hub, "gui", lambda ev, **kw: ds.append((ev, kw)))
    return lambda: [(ev, kw) for ev, kw in ds if ev.get("type") == "phieu_luong_cong_bo"]


def _uid_admin() -> int:
    db = SessionLocal()
    try:
        return UserRepository(db).get_by_username("admin").id
    finally:
        db.close()


def test_cong_bo_ngay_day_dich_danh_nguoi_co_phieu(client, da_day):
    h = _h(client)
    _nv_gan_admin(client, h)
    _chot_luong(client, h)
    assert client.post("/api/luong/cong-bo", json={"year": NAM, "month": THANG},
                       headers=h).status_code == 200

    ds = da_day()
    assert len(ds) == 1
    ev, kw = ds[0]
    assert kw["nguoi"] == [_uid_admin()]
    assert (ev["year"], ev["month"]) == (NAM, THANG)
    assert f"{THANG:02d}/{NAM}" in ev["message"]


def test_hen_gio_chi_day_khi_toi_gio_mo(client, da_day):
    from app.services.phieu_luong_mo import quet_phieu_luong_mo

    h = _h(client)
    _nv_gan_admin(client, h)
    _chot_luong(client, h)
    luc = datetime.now(timezone.utc) + timedelta(hours=1)
    assert client.post("/api/luong/cong-bo", json={"year": NAM, "month": THANG, "luc": luc.isoformat()},
                       headers=h).status_code == 200
    assert da_day() == [], "hẹn giờ mà đã báo trước giờ mở"

    # Chưa tới giờ mở ⇒ im.
    assert quet_phieu_luong_mo(luc - timedelta(minutes=1)) == 0
    assert da_day() == []
    # Qua giờ mở ⇒ đẩy một lần; lượt quét sau không đẩy lại.
    assert quet_phieu_luong_mo(luc + timedelta(seconds=30)) == 1
    assert quet_phieu_luong_mo(luc + timedelta(minutes=1)) == 0
    ds = da_day()
    assert len(ds) == 1 and ds[0][1]["nguoi"] == [_uid_admin()]


def test_may_chu_tat_luc_toi_gio_mo_van_bao_bu(client, da_day):
    """Rà cuối 19/10/2026: vòng quét cũ nhớ mốc "lần trước" trong bộ nhớ, khởi động lại từ bây giờ ⇒
    kỳ tới giờ mở lúc máy chủ tắt không bao giờ được báo."""
    from app.services.phieu_luong_mo import quet_phieu_luong_mo

    h = _h(client)
    _nv_gan_admin(client, h)
    _chot_luong(client, h)
    luc = datetime.now(timezone.utc) + timedelta(hours=1)
    client.post("/api/luong/cong-bo", json={"year": NAM, "month": THANG, "luc": luc.isoformat()}, headers=h)
    # Lượt quét đầu tiên sau khi bật lại máy là 3 giờ sau giờ mở.
    assert quet_phieu_luong_mo(luc + timedelta(hours=3)) == 1
    assert quet_phieu_luong_mo(luc + timedelta(hours=4)) == 0
    assert len(da_day()) == 1


def test_thu_hoi_day_toi_nguoi_co_phieu(client, monkeypatch):
    """#59 bấm lại 19/10/2026: thu hồi phiếu lương thì màn "Phiếu lương của tôi" đang mở vẫn hiện
    phiếu cho tới khi người đó tự nạp lại. Chiều công bố thì đẩy ngay."""
    ds: list[tuple[dict, dict]] = []
    monkeypatch.setattr(hub, "gui", lambda ev, **kw: ds.append((ev, kw)))
    h = _h(client)
    _nv_gan_admin(client, h)
    _chot_luong(client, h)
    client.post("/api/luong/cong-bo", json={"year": NAM, "month": THANG}, headers=h)
    r = client.post("/api/luong/thu-hoi", json={"year": NAM, "month": THANG}, headers=h)
    assert r.status_code == 200, r.text
    thu = [(ev, kw) for ev, kw in ds if ev.get("type") == "phieu_luong_thu_hoi"]
    assert len(thu) == 1
    assert thu[0][1]["nguoi"] == [_uid_admin()]
    assert f"{THANG:02d}/{NAM}" in thu[0][0]["message"]
