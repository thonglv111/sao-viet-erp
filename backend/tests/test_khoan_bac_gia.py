"""Bậc giá khoán theo số màu — gộp 8 công đoạn in thành một "Bài in" (22/10/2026).

Spec: `docs/superpowers/specs/2026-10-22-gop-bai-in-khoan-design.md`. Bậc tự chọn lúc ghi từ quy cách
in của lệnh (số màu = số kẽm một tay như Tính giá, màu pha) + tuỳ chọn Mực UV; giá lấy ở ô (tổ, bậc)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.db import SessionLocal
from app.models.cong_doan import CongDoanKhoan
from app.models.department import Department
from app.models.lsx import Lsx
from app.models.san_xuat_san_luong import SanXuatBatch, SanXuatBatchNguoi
from app.services.khoan_ky import KhoanKyService
from app.services.san_xuat import san_luong, viec_khoan
from tests.san_xuat_me_fixtures import T0
from tests.test_khoan_dot_2_tinh import _muc, _Nen2, _tc
from tests.test_khoan_ky import NAM, THANG, _h
from tests.test_san_xuat_cong_doan_khoan import _cong_doan, _cv_chay
from tests.test_san_xuat_thuc_thi import (  # noqa: F401
    admin,
    customer,
    db,
    lsx_svc,
    orders,
)

CMYK = ["C", "M", "Y", "K"]
CT_IN = ("((1 - chay_tiep) * gia_co_dinh + max(0, sl_ghi * (1 + tu_tro) - (1 - chay_tiep) * 3000)"
         " * don_gia_khoan) * if(metaline > 0, 3, if(muc_uv > 0, if(gia_gom_uv > 0, 1, 2), 1))")
TC_IN = _tc(("chay_tiep", "Chạy tiếp", "co_khong"), ("muc_uv", "Mực UV", "co_khong"),
            ("metaline", "Metaline", "co_khong"))
BAC = [
    {"ma": "b1", "ten": "1–2 màu thường", "mau_tu": 1, "mau_den": 2, "pha": "khong"},
    {"ma": "b2", "ten": "1–2 màu Pantone", "mau_tu": 1, "mau_den": 2, "pha": "co",
     "tuy_chon_ma": "muc_uv", "tuy_chon_co": "khong"},
    {"ma": "b3", "ten": "1–2 màu Pantone UV", "mau_tu": 1, "mau_den": 2, "pha": "co",
     "tuy_chon_ma": "muc_uv", "tuy_chon_co": "co", "gom_uv": True},
    {"ma": "b4", "ten": "3–4 màu thường", "mau_tu": 3, "mau_den": 4, "pha": "khong"},
    {"ma": "b5", "ten": "3–4 màu có pha", "mau_tu": 3, "mau_den": 4, "pha": "co"},
    {"ma": "b6", "ten": "5 màu", "mau_tu": 5, "mau_den": 5},
    {"ma": "b7", "ten": "6 màu", "mau_tu": 6, "mau_den": 6},
    {"ma": "b8", "ten": "7 màu", "mau_tu": 7, "mau_den": 7},
]


def _gia(to_id: int) -> list[dict]:
    return [{"department_id": to_id, "bac": "b1", "gia_co_dinh": 150_000, "don_gia": 30},
            {"department_id": to_id, "bac": "b2", "gia_co_dinh": 225_000, "don_gia": 30},
            {"department_id": to_id, "bac": "b3", "gia_co_dinh": 450_000, "don_gia": 40},
            {"department_id": to_id, "bac": "b4", "gia_co_dinh": 300_000, "don_gia": 40}]


def _khoan(**kw) -> CongDoanKhoan:
    return CongDoanKhoan(unit="to", unit_price=0, bac_gia=BAC, tuy_chon=TC_IN, **kw)


# --------------------------------------------------------------------------- chọn bậc
@pytest.mark.parametrize(("qc", "tuy_chon", "ma", "so_mau", "pha"), [
    ({"muc_a": CMYK, "quy_cach_in": "mot_mat"}, {}, "b4", 4, 0),
    # AB 4/4: số màu = số kẽm một tay như Tính giá ⇒ 8, không bậc nào khớp.
    ({"muc_a": CMYK, "muc_b": CMYK, "quy_cach_in": "hai_mat"}, {}, None, 8, 0),
    # Tự trở CMYK / Pantone: kẽm hợp hai mặt ⇒ 5.
    ({"muc_a": CMYK, "muc_b": ["185C"], "quy_cach_in": "tu_tro"}, {}, "b6", 5, 1),
    ({"muc_a": ["K", "185C"], "quy_cach_in": "mot_mat"}, {}, "b2", 2, 1),
    ({"muc_a": ["K", "185C"], "quy_cach_in": "mot_mat"}, {"muc_uv": 1}, "b3", 2, 1),
    ({"muc_a": ["C", "M", "185C"], "quy_cach_in": "mot_mat"}, {}, "b5", 3, 1),
    # Ảnh chụp cũ chỉ có `so_mau`.
    ({"so_mau": 4}, {}, "b4", 4, 0),
    ({"muc_a": [*CMYK, "P1", "P2", "P3", "P4"], "quy_cach_in": "mot_mat"}, {}, None, 8, 4),
    ({}, {}, None, 0, 0),
])
def test_chon_bac_theo_so_kem_pha_va_uv(qc, tuy_chon, ma, so_mau, pha):
    bac = viec_khoan.anh_bac(_khoan(), qc, tuy_chon)
    assert (bac["ma"], bac["so_mau"], bac["so_mau_pha"]) == (ma, so_mau, pha)
    assert bac["gom_uv"] is (ma == "b3")


def test_cong_doan_khong_chia_bac_khong_co_anh_bac():
    k = CongDoanKhoan(unit="to", unit_price=30, bac_gia=None)
    assert viec_khoan.anh_bac(k, {"muc_a": CMYK}, {}) is None


def test_gia_cua_to_theo_bac():
    k = _khoan(gia_theo_to=_gia(11))
    assert viec_khoan.gia_cua_to(k, 11, "b3") == (450_000.0, 40.0)
    assert viec_khoan.gia_cua_to(k, 11, "b5") == (None, None)      # tổ chưa có giá bậc này
    assert viec_khoan.gia_cua_to(k, 11, None) == (None, None)      # lệnh không khớp bậc nào
    assert viec_khoan.gia_cua_to(k, 12, "b1") == (None, None)
    # Công đoạn không chia bậc: tham số bậc không đổi gì.
    k2 = CongDoanKhoan(unit="to", unit_price=30, gia_co_dinh=5, gia_theo_to=None)
    assert viec_khoan.gia_cua_to(k2, 11, None) == (5.0, 30.0)


# --------------------------------------------------------------------------- lưu danh mục
@pytest.fixture()
def to_in(client) -> int:
    db = SessionLocal()
    try:
        d = Department(name="Máy 2 màu bậc", code="TO-BAC-API", la_san_xuat=True)
        db.add(d)
        db.commit()
        return d.id
    finally:
        db.close()


def _body(to_id: int, ma: str, **khoan) -> dict:
    return {"ma": ma, "ten": "Bài in", "nhom": "print", "department_ids": [to_id],
            "che_do_tinh": "theo_san_luong", "pricing_basis": "per_other",
            "khoan": {"unit": "to", "unit_price": 0, "cong_thuc_khoan": CT_IN, "tuy_chon": TC_IN,
                      "bac_gia": BAC, "gia_theo_to": _gia(to_id), "viec_phat_sinh": [], **khoan}}


def test_luu_bac_gia_va_gia_theo_to_bac(client, to_in):
    r = client.post("/api/cong-doan", json=_body(to_in, "CD-BAC-1"), headers=_h(client))
    assert r.status_code == 201, r.text
    k = r.json()["khoan"]
    assert [b["ma"] for b in k["bac_gia"]] == [b["ma"] for b in BAC]
    assert k["bac_gia"][2]["gom_uv"] is True and k["bac_gia"][0]["gom_uv"] is False
    assert k["bac_gia"][5]["pha"] is None and k["bac_gia"][1]["tuy_chon_ma"] == "muc_uv"
    assert {(g["bac"], g["don_gia"]) for g in k["gia_theo_to"]} >= {("b3", 40), ("b1", 30)}


@pytest.mark.parametrize(("sua", "chu"), [
    ({"gia_theo_to": [{"bac": "b9", "gia_co_dinh": 1, "don_gia": 1}]}, "b9"),
    ({"gia_theo_to": [{"gia_co_dinh": 1, "don_gia": 1}]}, "bậc"),
    ({"gia_theo_to": [{"bac": "b1", "gia_co_dinh": 1, "don_gia": 1},
                      {"bac": "b1", "gia_co_dinh": 2, "don_gia": 2}]}, "hai lần"),
    ({"bac_gia": [BAC[0], {**BAC[1], "ma": "b1"}]}, "trùng"),
    ({"bac_gia": [{**BAC[0], "mau_tu": 3, "mau_den": 2}]}, "Màu từ"),
    ({"bac_gia": [{**BAC[0], "ten": " "}]}, "Tên bậc"),
    ({"bac_gia": [{**BAC[1], "tuy_chon_ma": "khong_co"}]}, "khong_co"),
])
def test_bac_gia_sai_bi_chan(client, to_in, sua, chu):
    khoan = {}
    if "gia_theo_to" in sua:
        khoan["gia_theo_to"] = [{"department_id": to_in, **g} for g in sua["gia_theo_to"]]
    if "bac_gia" in sua:
        khoan["bac_gia"] = sua["bac_gia"]
        khoan["gia_theo_to"] = None
    r = client.post("/api/cong-doan", json=_body(to_in, f"CD-BAC-X{len(chu)}{id(sua)}", **khoan),
                    headers=_h(client))
    assert r.status_code == 422 and chu in r.text, r.text


def test_khong_chia_bac_thi_dong_gia_khong_duoc_mang_bac(client, to_in):
    r = client.post("/api/cong-doan", json=_body(
        to_in, "CD-BAC-KB", bac_gia=None,
        gia_theo_to=[{"department_id": to_in, "bac": "b1", "gia_co_dinh": 1, "don_gia": 1}]),
        headers=_h(client))
    assert r.status_code == 422 and "bậc" in r.text, r.text


# --------------------------------------------------------------------------- tiền kỳ lương
@pytest.fixture()
def nen(client):
    db = SessionLocal()
    try:
        yield _Nen2(db)
    finally:
        db.rollback()
        db.close()


def _ghi_qc(nen, to, k, sl, nguoi, qc, tuy_chon=None) -> SanXuatBatch:
    cv = nen.cv(to)
    o, _ = viec_khoan.chuan_hoa_khi_ghi(nen.db, khoan=k, ten_cong_doan="Bài in", phat_sinh=[],
                                        department_id=to.id, tuy_chon=tuy_chon, qc=qc)
    bd = datetime(NAM, THANG, 5, 3, 0, tzinfo=timezone.utc)
    b = SanXuatBatch(cong_viec_id=cv.id, bat_dau=bd, ket_thuc=bd + timedelta(hours=1), tong=sl,
                     tot=sl, hong=0, don_vi="to", **o)
    nen.db.add(b)
    nen.db.flush()
    for e in nguoi:
        nen.db.add(SanXuatBatchNguoi(batch_id=b.id, employee_id=e.id, department_id=e.department_id))
    nen.db.flush()
    return b


def _bai_in(nen, to):
    k = nen.khoan2(CT_IN, tuy_chon=TC_IN)
    k.bac_gia = BAC
    k.gia_theo_to = _gia(to.id)
    nen.db.flush()
    return k


def test_ghi_chup_bac_va_gia_cua_o_to_bac(nen):
    to = nen.to("Máy 2 màu")
    k = _bai_in(nen, to)
    b = _ghi_qc(nen, to, k, 5000, [], {"muc_a": ["K", "185C"], "quy_cach_in": "mot_mat"},
                {"muc_uv": 1})
    assert b.bac_khoan_snapshot == {"ma": "b3", "ten": "1–2 màu Pantone UV", "gom_uv": True,
                                    "so_mau": 2, "so_mau_pha": 1}
    assert (float(b.gia_co_dinh_khoan_snapshot), float(b.don_gia_khoan_snapshot)) == (450_000, 40)


def test_tien_pantone_uv_khong_nhan_doi_bac_thuong_uv_nhan_doi(nen):
    to = nen.to("Máy 2 màu")
    e = nen.nv(to, "E")
    k = _bai_in(nen, to)
    pantone = {"muc_a": ["K", "185C"], "quy_cach_in": "mot_mat"}
    _ghi_qc(nen, to, k, 5000, [e], pantone, {"muc_uv": 1})
    _ghi_qc(nen, to, k, 5000, [e], {"muc_a": CMYK, "quy_cach_in": "mot_mat"}, {"muc_uv": 1})
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((e, 10_000_000)))
    tien = [d["tien_lan_ghi"] for d in kq["theo_nguoi"][e.id] if d["loai"] == "lan_ghi"]
    # Pantone UV: 450.000 + 2.000 × 40 (giá đã gồm UV). 3–4 màu thường + UV: (300.000 + 2.000 × 40) × 2.
    assert tien == [530_000, 760_000]


def test_thieu_gia_noi_ro_bac(nen):
    to = nen.to("Máy 2 màu")
    e = nen.nv(to, "E")
    k = _bai_in(nen, to)
    _ghi_qc(nen, to, k, 5000, [e], {"muc_a": ["C", "M", "185C"], "quy_cach_in": "mot_mat"})
    _ghi_qc(nen, to, k, 5000, [e], {"muc_a": [*CMYK, "P1", "P2", "P3", "P4"]})
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, _muc((e, 10_000_000)))
    ly_do = [t["ly_do"] for t in kq["thieu_gia"]]
    assert any("3–4 màu có pha" in x for x in ly_do), ly_do
    assert any("8 màu" in x and "chưa khớp bậc" in x for x in ly_do), ly_do


# --------------------------------------------------------------------------- luồng ghi ở bàn tổ
def _canh(db, orders, lsx_svc, admin, customer, ma, qc):
    cv = _cv_chay(db, orders, lsx_svc, admin, customer, ma=ma)
    lsx = db.get(Lsx, cv.lsx_id)
    lsx.quy_cach_json = {**(lsx.quy_cach_json or {}), **qc}
    k = CongDoanKhoan(cong_doan_id=_cong_doan(db, cv).id, unit="to", unit_price=0,
                      cong_thuc_khoan=CT_IN, tuy_chon=TC_IN, bac_gia=BAC,
                      gia_theo_to=_gia(cv.department_id))
    db.add(k)
    db.commit()
    return cv, k


def _ghi(db, admin, cv, **kw) -> SanXuatBatch:
    r = san_luong.tao_batch(db, user=admin, cong_viec_id=cv.id, bat_dau=T0,
                            ket_thuc=T0 + timedelta(hours=1), tong=100, tot=100, **kw)
    return db.get(SanXuatBatch, r["batch_id"])


def test_ghi_o_ban_to_doc_quy_cach_lenh_sua_uv_doi_bac(db, orders, lsx_svc, admin, customer):
    cv, _k = _canh(db, orders, lsx_svc, admin, customer, "TO-BAC-1",
                   {"muc_a": ["K", "185C"], "muc_b": [], "quy_cach_in": "mot_mat"})
    b = _ghi(db, admin, cv, tuy_chon={"muc_uv": 1})
    assert b.bac_khoan_snapshot["ma"] == "b3" and float(b.don_gia_khoan_snapshot) == 40
    # Sửa lần ghi bỏ tick UV ⇒ về bậc Pantone thường, giá của bậc đó.
    san_luong.sua_so_me(db, user=admin, batch_id=b.id, tot=100, tuy_chon={"muc_uv": 0})
    db.refresh(b)
    assert b.bac_khoan_snapshot["ma"] == "b2"
    assert (float(b.gia_co_dinh_khoan_snapshot), float(b.don_gia_khoan_snapshot)) == (225_000, 30)


def test_ngan_chi_tiet_tra_gia_theo_tung_trang_thai_tuy_chon(db, orders, lsx_svc, admin, customer):
    from app.repositories.rbac_repo import RoleRepository
    from app.schemas.san_xuat import WorkItemChiTietOut
    from app.services.rbac_service import AuthorizationService
    from app.services.san_xuat import board

    cv, _k = _canh(db, orders, lsx_svc, admin, customer, "TO-BAC-2",
                   {"muc_a": ["K", "185C"], "muc_b": [], "quy_cach_in": "mot_mat"})
    d = WorkItemChiTietOut.model_validate(
        board.chi_tiet_cong_viec(db, admin, AuthorizationService(RoleRepository(db)), cong_viec_id=cv.id))
    bac = {tuple(sorted(x.chon.items())): x for x in d.khoan.bac_theo_chon}
    assert bac[(("muc_uv", 0.0),)].bac_ten == "1–2 màu Pantone"
    assert bac[(("muc_uv", 0.0),)].don_gia == 30
    assert bac[(("muc_uv", 1.0),)].bac_ten == "1–2 màu Pantone UV"
    assert bac[(("muc_uv", 1.0),)].gia_co_dinh == 450_000
    assert d.khoan.so_mau == 2 and d.khoan.so_mau_pha == 1
    # Giá đầu khối = trạng thái mọi tuỳ chọn tắt.
    assert d.khoan.don_gia == 30 and d.khoan.thieu_gia is False


def test_danh_muc_doi_gia_bac_bao_lech_va_cap_nhat(db, orders, lsx_svc, admin, customer):
    cv, k = _canh(db, orders, lsx_svc, admin, customer, "TO-BAC-3",
                  {"muc_a": CMYK, "muc_b": [], "quy_cach_in": "mot_mat"})
    b = _ghi(db, admin, cv)
    assert b.bac_khoan_snapshot["ma"] == "b4"
    k.gia_theo_to = [{**g, "don_gia": 45} if g["bac"] == "b4" else g for g in k.gia_theo_to]
    db.commit()
    lech = viec_khoan.danh_muc_doi(db, b, [], department_id=cv.department_id)
    assert [o["truong"] for o in lech] == ["don_gia"], lech
    viec_khoan.cap_nhat_theo_danh_muc(db, user=admin, batch_id=b.id)
    db.refresh(b)
    assert float(b.don_gia_khoan_snapshot) == 45
    assert viec_khoan.danh_muc_doi(db, b, [], department_id=cv.department_id) == []
