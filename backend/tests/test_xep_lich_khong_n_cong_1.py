"""Xếp lịch không hỏi báo hỏng TỪNG máy (quét SQL lặp 26/10/2026: 8 lần ky_thuat_yeu_cau_sua).

Bàn xếp lịch hiện bao nhiêu máy thì `_gan_canh_bao_may` hỏi bấy nhiêu lượt yêu cầu sửa + phiếu sửa.
Số câu SQL của `/lich` phải không đổi theo số máy có lệnh.
"""
from __future__ import annotations

from sqlalchemy import event

from app.db import SessionLocal, engine
from app.models.ky_thuat_may import TT_YC_CHO_TIEP_NHAN, YeuCauSuaChua
from app.models.lsx import TT_SAN_SANG, Lsx, LsxCongDoan
from app.models.may_thiet_bi import MayThietBi
from tests.test_xep_lich_lenh_api import GOC, _hd


def _may_co_lenh(client, h, n: int, dau: int, *, don_rieng: bool = False) -> list[int]:
    db = SessionLocal()
    ids = []
    try:
        for i in range(dau, dau + n):
            m = MayThietBi(ma=f"MAY-N1-{i}", ten=f"Máy {i}", loai_may="press_offset_sheet",
                           toc_do=5_000, don_vi_toc_do="to_gio")
            db.add(m)
            db.flush()
            oid = 1
            if don_rieng:
                from app.models.customer import Customer
                from app.models.order import Order

                kh = Customer(code=f"KH-N1-{i}", name=f"Khách {i}")
                db.add(kh)
                db.flush()
                don = Order(order_no=f"DH-N1-{i}", customer_id=kh.id)
                db.add(don)
                db.flush()
                oid = don.id
            l = Lsx(ma=f"LSX-N1-{i}", ten="Lệnh đo", order_id=oid, order_line_id=1,
                    trang_thai=TT_SAN_SANG, so_luong_dat=1000, so_to_ke_hoach=2500)
            db.add(l)
            db.flush()
            db.add(LsxCongDoan(lsx_id=l.id, thu_tu=1, ten="In", nhom="print", loai_buoc="may",
                               may_id=m.id, so_luong_vao=2500, don_vi_vao="to", don_vi_ra="to"))
            db.add(YeuCauSuaChua(ma=f"YC-N1-{i}", may_id=m.id, bo_phan_hong="Cụm cấp giấy",
                                 muc_do="cao", may_dung=True, trang_thai=TT_YC_CHO_TIEP_NHAN))
            ids.append(l.id)
        db.commit()
    finally:
        db.close()
    for lid in ids:
        assert client.put(f"{GOC}/lenh/{lid}", json={"bat_dau_at": "2026-09-11T08:00:00"},
                          headers=h).status_code == 200
    return ids


def _dem(client, h) -> int:
    n = [0]

    def nghe(*_a):
        n[0] += 1

    event.listen(engine, "before_cursor_execute", nghe)
    try:
        r = client.get(f"{GOC}/lich?tu=2026-09-07&den=2026-09-20", headers=h)
    finally:
        event.remove(engine, "before_cursor_execute", nghe)
    assert r.status_code == 200
    return n[0]


def test_lich_khong_hoi_bao_hong_tung_may(client):
    h = _hd(client)
    _may_co_lenh(client, h, 1, 1)
    it = _dem(client, h)
    _may_co_lenh(client, h, 6, 2)
    nhieu = _dem(client, h)
    assert nhieu <= it + 2, (it, nhieu)


def test_lich_khong_hoi_don_khach_tung_lenh(client):
    """Mỗi lệnh một đơn một khách: tên khách nạp một lượt cho cả bàn (DB đo tải 26/10: 124 + 93 câu)."""
    h = _hd(client)
    _may_co_lenh(client, h, 1, 101, don_rieng=True)
    it = _dem(client, h)
    _may_co_lenh(client, h, 6, 102, don_rieng=True)
    nhieu = _dem(client, h)
    assert nhieu <= it + 2, (it, nhieu)
    body = client.get(f"{GOC}/lich?tu=2026-09-07&den=2026-09-20", headers=h).json()
    ten = {d["ma"]: d["customer_name"] for d in body["dong"]}
    assert ten["LSX-N1-104"] == "Khách 104"


def test_ban_lo_khop_ban_le(client):
    from app.services.may_trang_thai import bao_hong_dang_mo, bao_hong_dang_mo_nhieu

    _hd(client)
    db = SessionLocal()
    try:
        m = MayThietBi(ma="MAY-N1-L", ten="Máy lẻ", loai_may="press_offset_sheet",
                       toc_do=5_000, don_vi_toc_do="to_gio")
        db.add(m)
        db.flush()
        db.add(YeuCauSuaChua(ma="YC-N1-L1", may_id=m.id, bo_phan_hong="A", muc_do="cao",
                             may_dung=False, trang_thai=TT_YC_CHO_TIEP_NHAN))
        db.add(YeuCauSuaChua(ma="YC-N1-L2", may_id=m.id, bo_phan_hong="B", muc_do="cao",
                             may_dung=True, trang_thai=TT_YC_CHO_TIEP_NHAN))
        db.commit()
        lo = bao_hong_dang_mo_nhieu(db, [m.id, 99999])
        assert lo[m.id] == bao_hong_dang_mo(db, m.id)
        assert [b["ma"] for b in lo[m.id]] == ["YC-N1-L2", "YC-N1-L1"]
        assert lo.get(99999, []) == []
    finally:
        db.close()
