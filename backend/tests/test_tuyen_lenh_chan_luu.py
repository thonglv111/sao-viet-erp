"""Tuyến công đoạn của lệnh — chặn lúc LƯU (lỗi #15, #29 bấm thử E2E 18/10/2026).

  · #15: ▲▼ đổi chỗ làm chuỗi ĐỨT ĐƠN VỊ hoặc để bước phụ thuộc bước đứng SAU nó — máy chủ nhận
    ngay, tính lại số theo thứ tự mới và ra số sai (1.400 → 413 tờ in cho 5.000 hộp). Nay từ chối.
  · #29: cạnh BẮC CẦU (Bế phụ thuộc cả In lẫn Cán, trong khi Cán đã phụ thuộc In) — ra xưởng
    thì Bế đòi nhận hàng từ In, mà In giao hết cho Cán, Bế kẹt vĩnh viễn. Nay lưu là từ chối;
    lệnh CŨ đang chạy có sẵn cạnh thừa thì cổng bắt đầu chỉ xét tiền nhiệm TRỰC TIẾP.
  · Lệnh cũ có tuyến hỏng vẫn đọc được: chặn chỉ nằm ở lần LƯU.
"""
from __future__ import annotations

import pytest

from app.models.lsx import LsxCongDoanPhuThuoc
from app.repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from app.schemas.lsx import LsxCongDoanIn
from app.services.lsx_service import LsxValidationError
from app.services.san_xuat import dau_vao

from tests.test_lsx_service import (  # noqa: F401
    _don_da_chuyen_sx,
    _ptg_2_san_pham,
    _to_san_xuat,
)
from tests.test_san_xuat_ban_giao import _buoc, _to_dich, _viec  # noqa: F401
from tests.test_san_xuat_thuc_thi import (  # noqa: F401
    _phat_hanh_vao_to,
    _to_khoan,
    admin,
    customer,
    db,
    lsx_svc,
    orders,
)


def _lenh_hop(db, orders, lsx_svc, admin, customer):
    """Lệnh Hộp: In (tờ→tờ) → Bế (tờ→cái) → Dán hộp (cái→cái)."""
    ptg = _ptg_2_san_pham(db)
    d = _don_da_chuyen_sx(db, orders, admin, customer, ptg)
    ids = [l["order_line_id"] for l in lsx_svc.preview(d.id)["lines"]]
    hop = lsx_svc.tao(order_id=d.id, order_line_ids=ids[:1], actor=admin)[0]
    buoc = {c.ten: c for c in hop.cong_doans}
    return hop, buoc


def _in(c, **k) -> LsxCongDoanIn:
    return LsxCongDoanIn(step_key=c.step_key, ten=c.ten, nhom=c.nhom, department_id=c.department_id,
                         cong_doan_id=c.cong_doan_id, **k)


def test_luu_routing_dut_don_vi_bi_chan(db, orders, lsx_svc, admin, customer):
    hop, b = _lenh_hop(db, orders, lsx_svc, admin, customer)
    # ▲ Dán hộp lên trên Bế: In ra tờ, Dán hộp nhận cái → đứt.
    with pytest.raises(LsxValidationError, match="Dán hộp"):
        lsx_svc.replace_routing(lsx_id=hop.id, actor=admin, ly_do="thử", rows_in=[
            _in(b["In offset"], phu_thuoc_step_keys=[]),
            _in(b["Dán hộp"], phu_thuoc_step_keys=[b["In offset"].step_key]),
            _in(b["Bế"], phu_thuoc_step_keys=[b["Dán hộp"].step_key]),
        ])
    db.rollback()
    # Không lưu gì: thứ tự cũ còn nguyên.
    assert [c.ten for c in sorted(lsx_svc.get(hop.id).cong_doans, key=lambda c: c.thu_tu)] == [
        "In offset", "Bế", "Dán hộp"]


def test_luu_routing_phu_thuoc_nguoc_bi_chan(db, orders, lsx_svc, admin, customer):
    hop, b = _lenh_hop(db, orders, lsx_svc, admin, customer)
    with pytest.raises(LsxValidationError, match="đứng sau"):
        lsx_svc.replace_routing(lsx_id=hop.id, actor=admin, rows_in=[
            _in(b["In offset"], phu_thuoc_step_keys=[]),
            _in(b["Bế"], phu_thuoc_step_keys=[b["Dán hộp"].step_key]),
            _in(b["Dán hộp"], phu_thuoc_step_keys=[b["In offset"].step_key]),
        ])


def test_luu_routing_canh_bac_cau_bi_chan(db, orders, lsx_svc, admin, customer):
    hop, b = _lenh_hop(db, orders, lsx_svc, admin, customer)
    ki, kb = b["In offset"].step_key, b["Bế"].step_key
    with pytest.raises(LsxValidationError) as e:
        lsx_svc.replace_routing(lsx_id=hop.id, actor=admin, rows_in=[
            _in(b["In offset"], phu_thuoc_step_keys=[]),
            _in(b["Bế"], phu_thuoc_step_keys=[ki]),
            _in(b["Dán hộp"], phu_thuoc_step_keys=[kb, ki]),
        ])
    msg = str(e.value)
    assert "In offset" in msg and "Dán hộp" in msg and "Bế" in msg


def test_luu_routing_hop_le_van_qua(db, orders, lsx_svc, admin, customer):
    hop, b = _lenh_hop(db, orders, lsx_svc, admin, customer)
    ki, kb = b["In offset"].step_key, b["Bế"].step_key
    lsx = lsx_svc.replace_routing(lsx_id=hop.id, actor=admin, rows_in=[
        _in(b["In offset"], phu_thuoc_step_keys=[]),
        _in(b["Bế"], phu_thuoc_step_keys=[ki]),
        _in(b["Dán hộp"], phu_thuoc_step_keys=[kb]),
    ])
    assert len(lsx.cong_doans) == 3


def test_lenh_cu_dut_chuoi_van_doc_duoc(db, orders, lsx_svc, admin, customer):
    """Tuyến hỏng có sẵn trong DB (lưu trước luật mới): đọc lệnh vẫn được."""
    hop, b = _lenh_hop(db, orders, lsx_svc, admin, customer)
    b["Dán hộp"].thu_tu, b["Bế"].thu_tu = 1, 2
    db.commit()
    assert lsx_svc.get(hop.id).ma == hop.ma
    assert lsx_svc.thieu_cua(lsx_svc.get(hop.id)) is not None


def test_lenh_cu_co_canh_bac_cau_van_bat_dau_duoc(db, orders, lsx_svc, admin, customer):
    """X → Y → Z và cạnh thừa X → Z có sẵn. Z chỉ phải nhận từ Y (tiền nhiệm trực tiếp)."""
    to = _to_khoan(db, admin, ma="TO-BC")
    a, _b, goi = _phat_hanh_vao_to(db, orders, lsx_svc, admin, customer, to.id)
    x, y, z = (_buoc(db, a.id, 900 + i, t) for i, t in enumerate(("X", "Y", "Z")))
    db.add_all([LsxCongDoanPhuThuoc(buoc_truoc_id=x.id, buoc_sau_id=y.id),
                LsxCongDoanPhuThuoc(buoc_truoc_id=x.id, buoc_sau_id=z.id)])
    cvx, cvy, cvz = (_viec(db, goi.id, a.id, s) for s in (x, y, z))
    to_b, _u = _to_dich(db, ma="TO-BC-D")
    cvz.department_id = to_b.id
    db.commit()
    repo = SanXuatSanLuongRepository(db)

    assert dau_vao.thieu_dau_vao(repo, cvz) == [cvy.ten_cong_doan]   # X không bị đòi


# ---------------------------------------------------------------- #16 trọn gói miễn khuôn
from tests.gia_cong_fixtures import lenh_chua_phat, ncc  # noqa: E402
from tests.lenh_sx_fixtures import sess  # noqa: E402,F401
from app.models.cong_doan import CongDoan  # noqa: E402
from app.services.gia_cong_ngoai.tron_goi import dat_tron_goi  # noqa: E402


def test_tron_goi_mien_khuon_moi_buoc(sess, orders, lsx_svc, admin, customer):  # noqa: F811
    """Trọn gói thì nhà gia công lo khuôn cho MỌI bước — lệnh không còn "Còn thiếu khuôn"."""
    lsx = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    buoc = lsx.cong_doans[0]
    cd = sess.get(CongDoan, buoc.cong_doan_id)
    cd.requires_tooling, cd.tooling_type = True, "khuon_be"
    buoc.khuon_be_id = None
    sess.commit()
    assert "thieu_khuon" in lsx_svc.thieu_cua(lsx_svc.get(lsx.id))
    dat_tron_goi(sess, user=admin, lsx_id=lsx.id, nha_cung_cap_id=ncc(sess, "GC TG").id,
                 sl_dat=1000, xuong_cap_giay=False)
    assert "thieu_khuon" not in lsx_svc.thieu_cua(lsx_svc.get(lsx.id))
