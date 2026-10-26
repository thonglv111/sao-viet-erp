"""Đợt 2 — tính tiền khoán kỳ: chia theo LƯƠNG CA MÁY, chip `so_lan_chay` / `tien_gio` / `tu_tro`
và tuỳ chọn khi ghi (21/10/2026).

Spec: `docs/superpowers/specs/2026-10-20-hai-luong-khoi-san-xuat-design.md` mục "Đợt 2". Công thức
In / Bế / Dán lấy đúng bảng của spec."""
from __future__ import annotations

import itertools
from datetime import date, datetime, timedelta, timezone

import pytest

from app.db import SessionLocal
from app.models.san_xuat import SanXuatCongViec
from app.models.san_xuat_san_luong import SanXuatBatch, SanXuatBatchNguoi
from app.services.khoan_ky import KhoanKyService, MucKhoan
from app.services.san_xuat import viec_khoan
from tests.test_khoan_ky import CT_THANG, NAM, THANG, _Nen

CT_IN = ("((1 - chay_tiep) * gia_co_dinh + max(0, sl_ghi * (1 + tu_tro) - (1 - chay_tiep) * 3000)"
         " * don_gia_khoan) * if(so_mau_pha > 0, 1.1, 1)")
CT_BE = ("(1 - kem_be_noi) * gia_co_dinh + sl_ghi * (1 + xa_doi) * (don_gia_khoan"
         " + if(so_lo >= 7, 50, if(so_lo >= 1, 20, 0)))")
CT_DAN = "(1 - khong_canh) * gia_co_dinh / so_lan_chay + sl_ghi * don_gia_khoan"


def _tc(*cap) -> list[dict]:
    return [{"ma": ma, "ten": ten, "kieu": kieu, "goi_y": None} for ma, ten, kieu in cap]


class _Nen2(_Nen):
    """`_Nen` + lần ghi chọn được công việc (cùng lệnh), giờ, tuỳ chọn và số tốt khác tổng."""

    def cv(self, to) -> SanXuatCongViec:
        cv = SanXuatCongViec(goi_id=self.goi.id, department_id=to.id, ten_cong_doan="Bước")
        self.db.add(cv)
        self.db.flush()
        return cv

    def ghi2(self, to, khoan, ngay: date, sl: float, nguoi, *, cv=None, tuy_chon=None,
             gio=(10, 10), tong=None, phat_sinh: dict | None = None) -> SanXuatBatch:
        cv = cv or self.cv(to)
        o, ps_rows = viec_khoan.chuan_hoa_khi_ghi(
            self.db, khoan=khoan, ten_cong_doan="Bước", department_id=to.id, tuy_chon=tuy_chon,
            phat_sinh=[{"phat_sinh_id": ps.id, "so_luong": (phat_sinh or {})[ps.ten]}
                       for ps in khoan.viec_phat_sinh if ps.ten in (phat_sinh or {})])
        # Giờ xưởng VN − 7 ⇒ UTC; cùng ngày ở cả máy giờ VN lẫn máy CI giờ UTC khi giờ ≥ 7.
        bd = datetime(ngay.year, ngay.month, ngay.day, gio[0] - 7, 0, tzinfo=timezone.utc)
        kt = datetime(ngay.year, ngay.month, ngay.day, gio[1] - 7, 0, tzinfo=timezone.utc)
        b = SanXuatBatch(cong_viec_id=cv.id, bat_dau=bd, ket_thuc=kt, tong=tong if tong is not None else sl,
                         tot=sl, hong=(tong - sl) if tong is not None else 0, don_vi="to", **o)
        self.db.add(b)
        self.db.flush()
        for r in ps_rows:
            r.batch_id = b.id
            self.db.add(r)
        for e in nguoi:
            self.db.add(SanXuatBatchNguoi(batch_id=b.id, employee_id=e.id, department_id=e.department_id))
        self.db.flush()
        return b

    def khoan2(self, cong_thuc, *, gia_co_dinh=0, don_gia=0, tuy_chon=None):
        k = self.khoan(cong_thuc=cong_thuc, unit_price=don_gia)
        k.gia_co_dinh = gia_co_dinh
        k.tuy_chon = tuy_chon
        self.db.flush()
        return k


def _muc(*cap, nen=None) -> MucKhoan:
    return MucKhoan(luong_ca_may={e.id: v for e, v in cap},
                    nen_gio={e.id: v for e, v in (nen or [])})


@pytest.fixture()
def nen(client):
    db = SessionLocal()
    try:
        yield _Nen2(db)
    finally:
        db.rollback()
        db.close()


NGAY = date(NAM, THANG, 5)
_dem_lenh = itertools.count(1)


def test_chia_theo_luong_ca_may(nen):
    to = nen.to("Tổ in")
    nhat, linh = nen.nv(to, "Nhất"), nen.nv(to, "Linh")
    k = nen.khoan2(CT_THANG, gia_co_dinh=1_000_000)
    nen.ghi2(to, k, NGAY, 0, [nhat, linh])
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((nhat, 14_000_000), (linh, 9_000_000)))
    assert kq["khoan"] == {nhat.id: 608_696, linh.id: 391_304}


def test_thieu_luong_ca_may_bao_thieu(nen):
    to = nen.to("Tổ in")
    nhat, linh = nen.nv(to, "Nhất"), nen.nv(to, "Linh")
    k = nen.khoan2(CT_THANG, gia_co_dinh=1_000_000)
    nen.ghi2(to, k, NGAY, 0, [nhat, linh])
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((nhat, 14_000_000), (linh, 0)))
    assert kq["khoan"] == {}
    assert len(kq["thieu_gia"]) == 1 and "lương ca máy" in kq["thieu_gia"][0]["ly_do"]
    assert "Linh" in kq["thieu_gia"][0]["ly_do"]


def test_canh_bao_chot_chi_dung_cho_sua_theo_ly_do(nen):
    """Câu cảnh báo trước chốt: thiếu lương ca máy chỉ sang hồ sơ lương, lần ghi chưa tick người
    chỉ sang bàn tổ — không gom hết vào "khai giá ở tab Khoán"."""
    from app.routers.payroll import _canh_bao_chot

    to = nen.to("Tổ in")
    nhat, linh = nen.nv(to, "Nhất"), nen.nv(to, "Linh")
    k = nen.khoan2(CT_THANG, gia_co_dinh=1_000_000)
    nen.ghi2(to, k, NGAY, 0, [nhat, linh])
    nen.ghi2(to, k, NGAY, 0, [])
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((nhat, 14_000_000), (linh, 0)))
    cb = _canh_bao_chot([], thieu_gia=kq["thieu_gia"])
    assert "tab Khoán" not in cb
    assert "Linh chưa có lương ca máy" in cb and "Lương nhân viên" in cb
    assert "chưa tick người làm" in cb and "bàn tổ" in cb


def test_nguoi_to_khac_dung_muc_cua_ho(nen):
    a, b = nen.to("Tổ A"), nen.to("Tổ B")
    x, y = nen.nv(a, "X"), nen.nv(b, "Y")
    k = nen.khoan2(CT_THANG, gia_co_dinh=900_000)
    nen.ghi2(a, k, NGAY, 0, [x, y])
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((x, 12_000_000), (y, 6_000_000)))
    assert kq["khoan"] == {x.id: 600_000, y.id: 300_000}


def test_be_kem_be_noi_xa_doi_so_lo(nen):
    to = nen.to("Tổ bế")
    e = nen.nv(to, "E")
    k = nen.khoan2(CT_BE, gia_co_dinh=150_000, don_gia=120,
                   tuy_chon=_tc(("kem_be_noi", "Kèm bế nổi", "co_khong"),
                                ("xa_doi", "Xả đôi", "co_khong"), ("so_lo", "Số lỗ đục", "so")))
    nen.ghi2(to, k, NGAY, 1000, [e], tuy_chon={"kem_be_noi": 1, "xa_doi": 1, "so_lo": 3})
    nen.ghi2(to, k, NGAY, 1000, [e], tuy_chon={"so_lo": 7})
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((e, 10_000_000)))
    tien = [d["tien_lan_ghi"] for d in kq["theo_nguoi"][e.id] if d["loai"] == "lan_ghi"]
    assert tien == [280_000, 320_000]


def test_in_chay_tiep_tu_tro_mau_pha(nen, monkeypatch):
    """`chay_tiep` là chip MÁY tự dò (24/10/2026): lần ghi liền trước trên cùng máy — việc không gắn
    máy thì cùng tổ — là chính dòng công việc này ⇒ 1. Không ai tick."""
    to = nen.to("Máy 4 màu")
    e = nen.nv(to, "E")
    k = nen.khoan2(CT_IN, gia_co_dinh=200_000, don_gia=60)
    tu_tro, mot_mat = nen.cv(to), nen.cv(to)
    qc = {tu_tro.id: {"quy_cach_in": "tu_tro", "bien_so_mau": 4},
          mot_mat.id: {"quy_cach_in": "mot_mat", "bien_so_mau": 4, "bien_so_mau_pha": 1}}
    monkeypatch.setattr(KhoanKyService, "_quy_cach", lambda self, cv, lenh, bai: qc[cv.id])
    nen.ghi2(to, k, NGAY, 2000, [e], cv=tu_tro, gio=(8, 9))
    nen.ghi2(to, k, NGAY, 2000, [e], cv=tu_tro, gio=(9, 10))
    nen.ghi2(to, k, NGAY, 5000, [e], cv=mot_mat, gio=(10, 11))
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((e, 10_000_000)))
    tien = [d["tien_lan_ghi"] for d in kq["theo_nguoi"][e.id] if d["loai"] == "lan_ghi"]
    assert tien == [260_000, 240_000, 352_000]


def test_in_chay_tiep_theo_may_khong_theo_to(nen, monkeypatch):
    """Cùng tổ, hai máy: lần ghi liền trước TRÊN CÙNG MÁY quyết định. In lại lệnh sau một lệnh khác
    ⇒ lên bài lại (sổ T08: 36/37 dòng). Lần trước ở NGÀY khác (kể cả kỳ trước) ⇒ lên bài lại."""
    to = nen.to("Máy 4 màu")
    e = nen.nv(to, "E")
    k = nen.khoan2(CT_IN, gia_co_dinh=200_000, don_gia=60)
    a, b, c = nen.cv(to), nen.cv(to), nen.cv(to)
    a.may_id, b.may_id, c.may_id = 901, 902, 901
    nen.db.flush()
    monkeypatch.setattr(KhoanKyService, "_quy_cach", lambda self, cv, lenh, bai: {"quy_cach_in": "mot_mat"})
    nen.ghi2(to, k, date(NAM, THANG - 1, 28), 1000, [e], cv=a, gio=(8, 9))   # kỳ trước
    nen.ghi2(to, k, NGAY, 4000, [e], cv=a, gio=(8, 9))       # liền sau lần kỳ trước nhưng khác ngày ⇒ 0
    nen.ghi2(to, k, NGAY, 1000, [e], cv=b, gio=(9, 10))      # máy khác chen giữa không tính
    nen.ghi2(to, k, NGAY, 4000, [e], cv=a, gio=(10, 11))     # vẫn liền sau a trên máy 901 ⇒ 1
    nen.ghi2(to, k, NGAY, 1000, [e], cv=c, gio=(11, 12))     # lệnh khác trên 901 ⇒ 0
    nen.ghi2(to, k, NGAY, 4000, [e], cv=a, gio=(12, 13))     # in lại a sau c ⇒ lên bài lại
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((e, 10_000_000)))
    tien = [d["tien_lan_ghi"] for d in kq["theo_nguoi"][e.id] if d["loai"] == "lan_ghi"]
    assert tien == [260_000, 200_000, 240_000, 200_000, 260_000]


def test_in_chay_tiep_qua_dem_la_len_bai_lai(nen, monkeypatch):
    """Sổ T08 (24/10/2026): in tiếp cùng lệnh sang NGÀY hôm sau vẫn trả lên bài — qua đêm máy rửa
    mực, sáng canh lại. Chạy tiếp chỉ khi lần liền trước trên máy là chính việc này và CÙNG ngày."""
    to = nen.to("Máy 4 màu")
    e = nen.nv(to, "E")
    k = nen.khoan2(CT_IN, gia_co_dinh=200_000, don_gia=60)
    a = nen.cv(to)
    a.may_id = 901
    nen.db.flush()
    monkeypatch.setattr(KhoanKyService, "_quy_cach", lambda self, cv, lenh, bai: {"quy_cach_in": "mot_mat"})
    nen.ghi2(to, k, NGAY, 4000, [e], cv=a, gio=(8, 9))
    nen.ghi2(to, k, NGAY, 4000, [e], cv=a, gio=(14, 15))                      # cùng ngày ⇒ 1
    nen.ghi2(to, k, date(NAM, THANG, 6), 4000, [e], cv=a, gio=(8, 9))         # sáng hôm sau ⇒ 0
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((e, 10_000_000)))
    tien = [d["tien_lan_ghi"] for d in kq["theo_nguoi"][e.id] if d["loai"] == "lan_ghi"]
    assert tien == [260_000, 240_000, 260_000]


CT_BE_KHUON = "(1 - trung_khuon) * if(khuon_moi > 0, 80000, gia_co_dinh) + sl_ghi * don_gia_khoan"


def _viec_dao(nen, to, may_id, khuon_be_id):
    """Công việc của một bước lệnh trỏ dao `khuon_be_id` (None = bước không có dao)."""
    from app.models.lsx import Lsx, LsxCongDoan

    i = next(_dem_lenh)
    l = Lsx(ma=f"LSX-KHUON-{i}", ten="Hộp", order_id=1, order_line_id=1, so_luong_dat=1000)
    nen.db.add(l)
    nen.db.flush()
    buoc = LsxCongDoan(lsx_id=l.id, ten="Bế", khuon_be_id=khuon_be_id)
    nen.db.add(buoc)
    nen.db.flush()
    cv = nen.cv(to)
    cv.may_id, cv.lsx_cong_doan_id = may_id, buoc.id
    nen.db.flush()
    return cv


def test_be_trung_khuon_khuon_moi_la_chip_may_tu_do(nen, monkeypatch):
    """26/10/2026 chủ: "Trùng khuôn" / "Khuôn mới" là CHIP máy tự dò từ dao của bước lệnh (danh mục
    Khuôn), không còn tuỳ chọn bắt thợ tick. Trùng khuôn = lần ghi liền trước trên cùng máy dùng
    cùng dao (dao còn trên máy, kể cả qua đêm). Khuôn mới = lần ghi ĐẦU TIÊN từng dùng con dao đó."""
    to = nen.to("Tổ bế")
    e = nen.nv(to, "E")
    k = nen.khoan2(CT_BE_KHUON, gia_co_dinh=50_000, don_gia=10)
    monkeypatch.setattr(KhoanKyService, "_quy_cach", lambda self, cv, lenh, bai: {})
    x = _viec_dao(nen, to, 901, 501)
    a, b, c, d = (_viec_dao(nen, to, 901, 501), _viec_dao(nen, to, 901, 502),
                  _viec_dao(nen, to, 901, None), _viec_dao(nen, to, 901, 502))
    nen.ghi2(to, k, date(NAM, THANG - 1, 28), 1000, [e], cv=x, gio=(8, 9))   # kỳ trước, dao 501
    nen.ghi2(to, k, NGAY, 1000, [e], cv=a, gio=(8, 9))     # dao 501 còn trên máy từ hôm trước ⇒ trùng
    nen.ghi2(to, k, NGAY, 1000, [e], cv=b, gio=(9, 10))    # dao 502 lần đầu ⇒ khuôn mới
    nen.ghi2(to, k, NGAY, 1000, [e], cv=c, gio=(10, 11))   # bước không dao ⇒ lên khuôn thường
    nen.ghi2(to, k, NGAY, 1000, [e], cv=a, gio=(11, 12))   # 501 sau bước không dao ⇒ lên lại
    nen.ghi2(to, k, NGAY, 1000, [e], cv=d, gio=(12, 13))   # 502 lệnh khác, đã dùng trước ⇒ thường
    nen.ghi2(to, k, NGAY, 1000, [e], cv=d, gio=(13, 14))   # 502 ngay sau 502 ⇒ trùng
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((e, 10_000_000)))
    tien = [d["tien_lan_ghi"] for d in kq["theo_nguoi"][e.id] if d["loai"] == "lan_ghi"]
    assert tien == [10_000, 90_000, 60_000, 60_000, 60_000, 10_000]


def test_in_bai_ghep_that_doc_mau_pha_gop_cua_thanh_vien(nen):
    """Bước chạy chung của bài ghép: quy cách phải gộp mực của MỌI thành viên như lúc phát hành
    (`BaiGhepService.quy_cach_bien_cua_bai`). Thiếu `muc` thì `so_mau_pha` = 0 ⇒ mất ×1,1 Pantone."""
    from app.models.bai_ghep import BaiGhep, BaiGhepThanhVien
    from app.models.lsx import Lsx
    from app.models.order import Order, OrderLine

    to = nen.to("Máy 4 màu")
    e = nen.nv(to, "E")
    k = nen.khoan2(CT_IN, gia_co_dinh=200_000, don_gia=60)
    lenh = []
    for i, muc in enumerate((["C", "M", "Y", "K"], ["K", "185c"])):
        don = Order(order_no=f"DH-BG-KK-{i}")
        don.lines.append(OrderLine(description="Hộp", qty=1000))
        nen.db.add(don)
        nen.db.flush()
        l = Lsx(ma=f"LSX-BG-KK-{i}", ten="Hộp", order_id=don.id, order_line_id=don.lines[0].id,
                trang_thai="da_phat_hanh", so_luong_dat=1000,
                quy_cach_json={"quy_cach_in": "mot_mat", "muc_a": muc, "muc_b": []})
        nen.db.add(l)
        lenh.append(l)
    bg = BaiGhep(ma="GB-KK-1", ten="Bài ghép khoán")
    nen.db.add(bg)
    nen.db.flush()
    for l in lenh:
        nen.db.add(BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=l.id, so_con_tren_to=2))
    cv = nen.cv(to)
    cv.bai_ghep_id = bg.id
    nen.db.flush()
    nen.ghi2(to, k, NGAY, 5000, [e], cv=cv)
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((e, 10_000_000)))
    tien = [d["tien_lan_ghi"] for d in kq["theo_nguoi"][e.id] if d["loai"] == "lan_ghi"]
    assert tien == [352_000]


def test_dan_canh_may_chia_so_lan_chay(nen):
    to = nen.to("Tổ dán")
    e = nen.nv(to, "E")
    k = nen.khoan2(CT_DAN, gia_co_dinh=50_000, don_gia=100,
                   tuy_chon=_tc(("khong_canh", "Không canh máy", "co_khong")))
    cv = nen.cv(to)
    nen.ghi2(to, k, NGAY, 100, [e], cv=cv)
    nen.ghi2(to, k, NGAY + timedelta(days=1), 100, [e], cv=cv)
    nen.ghi2(to, k, date(NAM, THANG + 1, 3), 100, [e], cv=cv)       # kỳ sau — không đếm vào kỳ này
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((e, 10_000_000)))
    tien = [d["tien_lan_ghi"] for d in kq["theo_nguoi"][e.id] if d["loai"] == "lan_ghi"]
    assert tien == [35_000, 35_000]


CT_DAN_TV = ("(1 - khong_canh) * gia_co_dinh / max(1, so_lan_chay - so_lan_thu_viec)"
             " + sl_ghi * don_gia_khoan")


def test_dan_tien_canh_tru_lan_ghi_co_thu_viec(nen):
    """Sổ T08 tổ dán (24/10/2026): tiền canh chia cho số lần ghi TRỪ lần có người thử việc làm —
    thử việc đọc ở hồ sơ tại NGÀY ghi, không tick tay. Lần thử việc tự tick "Không canh máy"."""
    from app.models.employee import EmployeeEvent

    to = nen.to("Tổ dán")
    e, tv = nen.nv(to, "E"), nen.nv(to, "Tùng")
    e.status = "active"               # hồ sơ mới mặc định là thử việc
    tv.status, tv.probation_end_date = "probation", date(NAM, THANG, 28)
    k = nen.khoan2(CT_DAN_TV, gia_co_dinh=50_000, don_gia=100,
                   tuy_chon=_tc(("khong_canh", "Không canh máy", "co_khong")))
    cv = nen.cv(to)
    nen.ghi2(to, k, NGAY, 100, [e], cv=cv)
    nen.ghi2(to, k, NGAY, 100, [tv], cv=cv, tuy_chon={"khong_canh": 1})
    nen.ghi2(to, k, NGAY + timedelta(days=1), 100, [e], cv=cv)
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((e, 10_000_000), (tv, 5_000_000)))
    tien = sorted(d["tien_lan_ghi"] for rs in kq["theo_nguoi"].values() for d in rs
                  if d["loai"] == "lan_ghi")
    assert tien == [10_000, 35_000, 35_000]

    # Hết thử việc TRƯỚC ngày ghi (sự kiện có ngày hiệu lực) ⇒ lần đó không còn là lần thử việc.
    tv.status = "active"
    nen.db.add(EmployeeEvent(employee_id=tv.id, event_type="status_change", field="status",
                             from_value="probation", to_value="active", effective_date=NGAY))
    nen.db.flush()
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((e, 10_000_000), (tv, 5_000_000)))
    tien = sorted(d["tien_lan_ghi"] for rs in kq["theo_nguoi"].values() for d in rs
                  if d["loai"] == "lan_ghi")
    assert tien == [10_000, 26_667, 26_667]


def test_dan_moi_lan_deu_thu_viec_mau_so_toi_thieu_1(nen):
    to = nen.to("Tổ dán")
    tv = nen.nv(to, "Tùng")
    tv.status, tv.probation_end_date = "probation", date(NAM, THANG, 28)
    k = nen.khoan2(CT_DAN_TV, gia_co_dinh=50_000, don_gia=100,
                   tuy_chon=_tc(("khong_canh", "Không canh máy", "co_khong")))
    nen.ghi2(to, k, NGAY, 100, [tv])
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((tv, 5_000_000)))
    assert kq["khoan"] == {tv.id: 60_000}


def test_viec_phat_sinh_tinh_gia_theo_cong_thuc(nen):
    """Xuống bài do lỗi = 50% bài in (24/10/2026): việc phát sinh có "Cách tính giá" thì đơn giá là
    công thức trên chính lần ghi (giá cố định của bậc / tổ); bỏ trống thì vẫn đơn giá. Công thức chụp
    vào lần ghi như công thức khoán."""
    from app.models.cong_doan import CongDoanKhoanPhatSinh

    to = nen.to("Máy 5 màu")
    e = nen.nv(to, "E")
    k = nen.khoan2("gia_co_dinh", gia_co_dinh=180_000)
    k.viec_phat_sinh.append(CongDoanKhoanPhatSinh(ten="Xuống bài", don_gia=0, don_vi="bai", thu_tu=0,
                                                  cong_thuc="0.5 * gia_co_dinh"))
    k.viec_phat_sinh.append(CongDoanKhoanPhatSinh(ten="Thay kẽm", don_gia=100_000, don_vi="kem", thu_tu=1))
    nen.db.flush()
    b = nen.ghi2(to, k, NGAY, 0, [e], phat_sinh={"Xuống bài": 1, "Thay kẽm": 2})
    k.viec_phat_sinh[0].cong_thuc = "gia_co_dinh"            # sửa danh mục sau khi ghi
    nen.db.flush()
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((e, 10_000_000)), so=True)
    assert kq["khoan"] == {e.id: 180_000 + 90_000 + 200_000}
    ps = {p["ten"]: p for p in kq["so"]["lan_ghi"][0]["phat_sinh"]}
    assert ps["Xuống bài"]["don_gia"] == 90_000 and ps["Thay kẽm"]["don_gia"] == 100_000
    assert kq["so"]["lan_ghi"][0]["batch_id"] == b.id


def test_dan_khong_canh(nen):
    to = nen.to("Tổ dán")
    e = nen.nv(to, "E")
    k = nen.khoan2(CT_DAN, gia_co_dinh=50_000, don_gia=100,
                   tuy_chon=_tc(("khong_canh", "Không canh máy", "co_khong")))
    nen.ghi2(to, k, NGAY, 100, [e], tuy_chon={"khong_canh": 1})
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((e, 10_000_000)))
    assert kq["khoan"] == {e.id: 10_000}


def test_tien_gio(nen):
    to = nen.to("Tổ thành phẩm")
    a, b = nen.nv(to, "A"), nen.nv(to, "B")
    k = nen.khoan2("tien_gio")
    nen.ghi2(to, k, NGAY, 0, [a, b], gio=(8, 12))
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((a, 7_800_000), (b, 5_200_000),
                                                      nen=[(a, 7_800_000), (b, 5_200_000)]))
    lg = [d for d in kq["theo_nguoi"][a.id] if d["loai"] == "lan_ghi"]
    assert lg[0]["tien_lan_ghi"] == 250_000
    assert kq["khoan"] == {a.id: 150_000, b.id: 100_000}


def test_tien_gio_thieu_gio_ket_thuc_bao_thieu(nen):
    to = nen.to("Tổ thành phẩm")
    a = nen.nv(to, "A")
    k = nen.khoan2("tien_gio")
    nen.ghi2(to, k, NGAY, 0, [a], gio=(8, 8))
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((a, 7_800_000), nen=[(a, 7_800_000)]))
    assert kq["khoan"] == {}
    assert "giờ kết thúc" in kq["thieu_gia"][0]["ly_do"]


def test_lan_ghi_cu_chua_co_tuy_chon_mac_dinh_0(nen):
    to = nen.to("Tổ bế")
    e = nen.nv(to, "E")
    k = nen.khoan2(CT_BE, gia_co_dinh=150_000, don_gia=120)
    b = nen.ghi2(to, k, NGAY, 1000, [e])
    assert b.tuy_chon_khoan is None
    k.tuy_chon = _tc(("kem_be_noi", "Kèm bế nổi", "co_khong"), ("xa_doi", "Xả đôi", "co_khong"),
                     ("so_lo", "Số lỗ đục", "so"))
    nen.db.flush()
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((e, 10_000_000)))
    assert kq["thieu_gia"] == [] and kq["khoan"] == {e.id: 150_000 + 120_000}


def test_sl_ghi_la_tot_cong_thuc_rong_ra_0(nen):
    """`sl_ghi` = số tốt (100), không phải số vào (120). Công đoạn để trống công thức ⇒ 0 đồng (chủ
    22/10: tiền phải tường minh trên công thức)."""
    to = nen.to("Tổ gỡ")
    e = nen.nv(to, "E")
    k = nen.khoan2(CT_THANG, don_gia=10)
    nen.ghi2(to, k, NGAY, 100, [e], tong=120)
    trong = nen.khoan2("", gia_co_dinh=500, don_gia=10)
    nen.ghi2(to, trong, NGAY, 100, [e])
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((e, 10_000_000)))
    assert kq["khoan"] == {e.id: 1000}


def test_chi_tiet_co_the_tuy_chon_va_ty_le(nen):
    to = nen.to("Tổ bế")
    a, b = nen.nv(to, "A"), nen.nv(to, "B")
    k = nen.khoan2(CT_BE, gia_co_dinh=150_000, don_gia=120,
                   tuy_chon=_tc(("kem_be_noi", "Kèm bế nổi", "co_khong"),
                                ("xa_doi", "Xả đôi", "co_khong"), ("so_lo", "Số lỗ đục", "so")))
    nen.ghi2(to, k, NGAY, 1000, [a, b], tuy_chon={"kem_be_noi": 1, "so_lo": 3})
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((a, 3_000_000), (b, 1_000_000)))
    d = next(x for x in kq["theo_nguoi"][a.id] if x["loai"] == "lan_ghi")
    assert d["tuy_chon"] == ["kèm bế nổi", "3 số lỗ đục"]
    assert d["ty_le"] == 0.75 and d["so_luong"] == 1000


def test_ngan_soi_cong_dong_bang_dung_cot_luong(nen):
    """Hai lần ghi 1.001đ chia đôi ⇒ mỗi dòng 500,5đ. Làm tròn từng dòng ra 500 + 500 nhưng cột
    lương là 1.001 — dòng lớn nhất gánh phần lệch để ngăn soi cộng ra đúng số cột."""
    to = nen.to("Tổ dán")
    a, b = nen.nv(to, "A"), nen.nv(to, "B")
    k = nen.khoan2("gia_co_dinh", gia_co_dinh=1001)
    nen.ghi2(to, k, NGAY, 10, [a, b])
    nen.ghi2(to, k, NGAY, 10, [a, b])
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((a, 5_000_000), (b, 5_000_000)))
    for e in (a, b):
        assert sum(d["tien"] for d in kq["theo_nguoi"][e.id]) == kq["khoan"][e.id] == 1001


def test_chip_tien_ma_san_luong_khong_nhan_don_gia_canh_bao(nen):
    """`gia_co_dinh + sl_ghi`: kết quả công thức là tiền ⇒ 1 tờ thành 1đ. Vẫn tính
    đúng công thức người khai (không đoán), nhưng nói ra trước chốt."""
    to = nen.to("Tổ dán")
    a = nen.nv(to, "A")
    k = nen.khoan2("gia_co_dinh + sl_ghi", gia_co_dinh=100_000, don_gia=50)
    nen.ghi2(to, k, NGAY, 1000, [a])
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((a, 5_000_000)))
    assert kq["khoan"][a.id] == 101_000
    assert any("Đơn giá khoán" in c and k.cong_doan.ten in c for c in kq["canh_bao"])

    k2 = nen.khoan2("gia_co_dinh + sl_ghi * don_gia_khoan", gia_co_dinh=100_000, don_gia=50)
    nen.ghi2(to, k2, NGAY, 1000, [a])
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((a, 5_000_000)))
    assert sum("Đơn giá khoán" in c for c in kq["canh_bao"]) == 1


def test_khong_tu_nhan_don_gia_cong_thuc_luong_ra_dung_so_do(nen):
    """Chủ 22/10: kết quả công thức LÀ tiền — `sl_ghi * dai_in * rong_in` (không chip tiền nào) ra
    đúng số m², máy không ngầm × đơn giá 150; vẫn nhắc trước chốt."""
    to = nen.to("Tổ cán màng")
    a = nen.nv(to, "A")
    k = nen.khoan2("sl_ghi * 2", don_gia=150)
    nen.ghi2(to, k, NGAY, 1000, [a])
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((a, 5_000_000)))
    assert kq["khoan"][a.id] == 2000
    assert any("Đơn giá khoán" in c and k.cong_doan.ten in c for c in kq["canh_bao"])


def test_the_tuy_chon_so_le_in_kieu_viet():
    """Cùng chữ với thẻ ở bàn tổ (FE `num` = vi-VN): phẩy thập phân, chấm hàng nghìn."""
    from app.services.khoan_ky import _nhan_tuy_chon

    anh = [{"ma": "a", "ten": "Số lỗ", "kieu": "so", "gia_tri": 1.5},
           {"ma": "b", "ten": "Tờ", "kieu": "so", "gia_tri": 1500}]
    assert _nhan_tuy_chon(anh) == ["1,5 số lỗ", "1.500 tờ"]


def test_muc_khoan_tu_ho_so(client):
    from app.models.employee import STATUS_ACTIVE, STATUS_PROBATION, STATUS_RESIGNED
    from app.models.payroll import (
        COMPONENT_KIND_THU as THU, COMPONENT_KIND_TRU as TRU, EmployeeSalary, EmployeeSalaryComponent,
        PayrollComponent,
    )
    from app.repositories.employee_repo import EmployeeRepository
    from app.repositories.payroll_component_repo import PayrollComponentRepository
    from app.repositories.payroll_repo import PayrollRepository
    from app.services.payroll_service import PayrollService

    db = SessionLocal()
    try:
        n = _Nen(db)
        to = n.to("Tổ in")
        ct, tv = n.nv(to, "Chính thức"), n.nv(to, "Thử việc")
        ct.status, tv.status = STATUS_ACTIVE, STATUS_PROBATION
        # Nghỉ việc giữa kỳ khi CÒN trong hạn thử việc ⇒ tháng cuối vẫn là thử việc (luật `_compute`).
        nghi = n.nv(to, "Nghỉ khi thử việc")
        nghi.status, nghi.resign_date = STATUS_RESIGNED, date(NAM, THANG, 20)
        nghi.probation_end_date = date(NAM, THANG, 28)
        tu = date(NAM, 1, 1)
        db.add_all([
            EmployeeSalary(employee_id=nghi.id, effective_from=tu, luong_vi_tri=3_600_000,
                           luong_trach_nhiem=2_700_000, allowance=0),
            EmployeeSalary(employee_id=ct.id, effective_from=tu, luong_vi_tri=6_600_000,
                           luong_trach_nhiem=3_300_000, allowance=0),
            EmployeeSalary(employee_id=tv.id, effective_from=tu, luong_vi_tri=3_600_000,
                           luong_trach_nhiem=2_700_000, allowance=2_700_000),
        ])
        i = id(db)
        comps = [PayrollComponent(code=f"MK-{i}-{j}", name=f"Khoản {j}", kind=kind)
                 for j, kind in enumerate((THU, THU, THU, THU, THU, TRU))]
        db.add_all(comps)
        db.flush()
        for c, so in zip(comps, (5_400_000, 400_000, 400_000, 400_000, 0, 200_000)):
            db.add(EmployeeSalaryComponent(employee_id=ct.id, component_id=c.id, amount=so))
        db.flush()
        svc = PayrollService(PayrollRepository(db), EmployeeRepository(db), attendance=None,
                             components=PayrollComponentRepository(db))
        muc = svc.muc_khoan(NAM, THANG)
        ratio = float(svc.get_params().probation_ratio)
        assert muc.luong_ca_may[ct.id] == 16_500_000
        assert muc.nen_gio[ct.id] == 9_900_000
        assert muc.luong_ca_may[tv.id] == pytest.approx(6_300_000 * ratio + 2_700_000)
        assert muc.luong_ca_may[nghi.id] == pytest.approx(6_300_000 * ratio)
    finally:
        db.rollback()
        db.close()


def test_schema_ngan_soi_giu_ty_le_va_tuy_chon():
    from app.schemas.payroll import KhoanKyDongOut

    d = KhoanKyDongOut.model_validate({"loai": "lan_ghi", "ty_le": 0.75, "tuy_chon": ["trùng khuôn"]})
    assert d.ty_le == 0.75 and d.tuy_chon == ["trùng khuôn"]
