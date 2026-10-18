"""Vật tư chip + công thức: số câu SQL KHÔNG được tăng theo số bước × vật tư.

Đo bằng `before_cursor_execute` như `test_lenh_sx_boi_canh.py`. Mỗi luồng chạy với phiếu 2 bước và 10
bước — mỗi bước một vật tư KHÁC nhau (có chip) — rồi so: số câu phải bằng nhau (cho phép lệch nhỏ
do SQLite/lazy-load một lần). Phiếu mới `expire_all()` trước khi đo để mô phỏng một request mới.
"""
from __future__ import annotations

import os

import pytest
from sqlalchemy import event

from tests.test_lsx_service import (  # noqa: F401 — fixture + helper dùng chung
    _don_da_chuyen_sx,
    admin,
    customer,
    db,
    lsx_svc,
    orders,
    _to_san_xuat,
    _may_in,
)

from app.models.cong_doan import CongDoan
from app.models.lsx import LsxCongDoan
from app.schemas.lsx import LsxCongDoanIn
from app.models.may_thiet_bi import MayThietBi
from app.models.don_vi_do import DonViDo
from app.models.phieu_tinh_gia import PhieuBuocVatTu, PhieuThanhPham, PhieuThanhPhan, PhieuTinhGia
from app.models.vat_lieu_kho import GiayNguyen, VatTuChip, VatTuInAn
from app.services.tinh_gia_service import compute_phieu_snapshot, danh_muc_doi_sau_khi_tinh


def _dem_sql(db, fn, nhan=""):
    n = 0
    if os.environ.get("IN_SQL"):
        print("SQL> ====", nhan)

    def _bat(conn, cur, stmt, *a, **k):
        nonlocal n
        n += 1
        if os.environ.get("IN_SQL"):
            print("SQL>", " ".join(stmt.split())[-90:])

    event.listen(db.get_bind(), "before_cursor_execute", _bat)
    try:
        ket_qua = fn()
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", _bat)
    return n, ket_qua


def _dung_phieu(db, so_buoc: int, nhan: str = "a") -> PhieuTinhGia:
    """Phiếu 1 thành phần: In + `so_buoc` bước sau in, MỖI bước một vật tư khác nhau có 2 chip."""
    giay = db.query(GiayNguyen).filter(GiayNguyen.ma == "G-IV350").first()
    if giay is None:
        giay = GiayNguyen(don_vi_them=["to"], ma="G-IV350", ten="Ivory 350", gsm=350, don_gia=25_000, don_vi_gia="tan",
                          cong_thuc_gia="to_nguyen * dai_nguyen * rong_nguyen * dinh_luong * don_gia / 1000")
        db.add(giay)
        db.add(DonViDo(ma="m2_sup", ten="m² support"))
        db.flush()
    to_id = _to_san_xuat(db).id
    may = db.query(MayThietBi).first() or _may_in(db)
    cd_in = db.query(CongDoan).filter(CongDoan.nhom == "print").first()
    if cd_in is None:
        cd_in = CongDoan(ma="CD-IN-T", ten="In offset", nhom="print", cong_thuc_gia="so_luong * don_gia")
        db.add(cd_in)
    if not cd_in.department_ids:
        cd_in.department_ids = [to_id]
    cd_in.don_vi_vao = cd_in.don_vi_ra = "to"
    db.flush()
    p = PhieuTinhGia(ma=f"PTG-PERF-{nhan}", ten_san_pham="Perf", so_luong=10_000)
    tp = PhieuThanhPhan(
        thu_tu=0, ten="Hộp", so_luong=10_000, don_vi_tinh="cái", dai_thanh_pham=200, rong_thanh_pham=150,
        giay_id=giay.id, kho_nguyen_dai=790, kho_nguyen_rong=1090, kho_in_dai=650, kho_in_rong=900,
        so_mau_a=4, so_mau_b=0, quy_cach_in="mot_mat", may_id=may.id,
    )
    tp.thanh_phams.append(PhieuThanhPham(thu_tu=0, cong_doan_id=cd_in.id, ten="In offset", don_gia=200))
    for i in range(so_buoc):
        cd = CongDoan(ma=f"CD-S{nhan}{i}", ten=f"Sau in {i}", nhom="finishing", cong_thuc_gia="so_luong * don_gia",
                      department_ids=[to_id], nang_suat=4000,
                      # Bước đầu nhận tờ in của bước In (chuỗi liền đơn vị — lưu tuyến đứt bị chặn từ 18/10/2026).
                      don_vi_vao="to" if i == 0 else "cai", don_vi_ra="cai")
        db.add(cd)
        db.flush()
        vt = VatTuInAn(ma=f"VT-{nhan}{i}", ten=f"Vật tư {i}", don_vi_gia="m2_sup", don_gia=1_000,
                       cong_thuc_gia="dai_x * rong_x * don_gia_vat_tu / 1000000",
                       cong_thuc_dinh_muc="dai_x * rong_x / 1000000")
        vt.chips = [VatTuChip(ma="dai_x", ten="Dài", don_vi="mm", thu_tu=0),
                    VatTuChip(ma="rong_x", ten="Rộng", don_vi="mm", thu_tu=1)]
        db.add(vt)
        db.flush()
        buoc = PhieuThanhPham(thu_tu=i + 1, cong_doan_id=cd.id, ten=f"Sau in {i}", don_gia=10)
        buoc.vat_tus.append(PhieuBuocVatTu(vat_tu_id=vt.id, thu_tu=0, gia_tri_chip={"dai_x": 500, "rong_x": 400}))
        tp.thanh_phams.append(buoc)
    p.thanh_phans.append(tp)
    db.add(p)
    db.commit()
    return p


def _so_cau_tinh_gia(db, so_buoc: int, nhan: str) -> tuple[int, int]:
    p = _dung_phieu(db, so_buoc, nhan)
    pid = p.id
    db.expire_all()
    p = db.get(PhieuTinhGia, pid)
    n_tinh, _ = _dem_sql(db, lambda: compute_phieu_snapshot(db, p))
    db.commit()
    db.expire_all()
    p = db.get(PhieuTinhGia, pid)
    n_doi, _ = _dem_sql(db, lambda: danh_muc_doi_sau_khi_tinh(db, p))
    return n_tinh, n_doi


def test_tinh_gia_so_cau_khong_tang_theo_so_buoc_vat_tu(db):
    a = _so_cau_tinh_gia(db, 2, "a")
    b = _so_cau_tinh_gia(db, 10, "b")
    print("tinh_gia (tinh, danh_muc_doi) N=2:", a, "N=10:", b)
    assert b[0] <= a[0] + 2, f"compute_phieu_snapshot tăng theo số bước: {a} → {b}"
    assert b[1] <= a[1] + 2, f"danh_muc_doi_sau_khi_tinh tăng theo số bước: {a} → {b}"


def _luong_lenh(db, orders, lsx_svc, admin, customer, so_buoc: int, nhan: str) -> dict:
    """Đo các luồng lệnh SX trên phiếu `so_buoc` bước × 1 vật tư khác nhau/bước."""
    ptg = _dung_phieu(db, so_buoc, nhan)
    d = _don_da_chuyen_sx(db, orders, admin, customer, ptg)
    ra: dict[str, int] = {}
    db.expire_all()
    ra["preview"], _ = _dem_sql(db, lambda: lsx_svc.preview(d.id), "preview")
    line = lsx_svc.preview(d.id)["lines"][0]
    db.expire_all()
    ra["tao"], created = _dem_sql(db, lambda: lsx_svc.tao(
        order_id=d.id, order_line_ids=[line["order_line_id"]], actor=admin), "tao")
    lsx_id = created[0].id
    db.commit()
    db.expire_all()
    lsx = lsx_svc.get(lsx_id)
    ra["detail_dict"], _ = _dem_sql(db, lambda: lsx_svc.detail_dict(lsx), "detail")
    # Lưu routing y nguyên (đúng thứ client gửi lại khi bấm Lưu ở màn lệnh) — chỉ đọc + tính lại.
    rows_in = [
        LsxCongDoanIn(
            step_key=c.step_key, cong_doan_id=c.cong_doan_id, ten=c.ten, nhom=c.nhom,
            department_id=c.department_id, so_luong_vao=float(c.so_luong_vao or 0),
            so_luong_ra=float(c.so_luong_ra or 0), don_vi_vao=c.don_vi_vao, don_vi_ra=c.don_vi_ra,
            phu_thuoc_step_keys=[p.step_key for e in c.phu_thuoc
                                 for p in [db.get(LsxCongDoan, e.buoc_truoc_id)] if p],
            vat_tus=[{"vat_tu_id": v.vat_tu_id, "so_luong": float(v.so_luong), "tu_dong": bool(v.tu_dong),
                      "gia_tri_chip": dict(v.gia_tri_chip or {})} for v in c.vat_tus],
        )
        for c in sorted(lsx.cong_doans, key=lambda x: x.thu_tu)
    ]
    db.commit()
    db.expire_all()
    ra["replace_routing"], _ = _dem_sql(db, lambda: lsx_svc.replace_routing(
        lsx_id=lsx_id, actor=admin, rows_in=rows_in), "replace_routing")
    return ra


def test_lenh_sx_so_cau_khong_tang_theo_so_buoc_vat_tu(db, orders, lsx_svc, admin, customer):
    a = _luong_lenh(db, orders, lsx_svc, admin, customer, 2, "a")
    b = _luong_lenh(db, orders, lsx_svc, admin, customer, 10, "b")
    print("lenh N=2:", a, "N=10:", b)
    for k in a:
        # `tao` còn mỗi bước/vật tư 1 câu INSERT (ghi, không phải đọc) nên cho dư theo số dòng ghi.
        du = 3 + (2 * 8 if k in ("tao", "replace_routing") else 0)
        assert b[k] <= a[k] + du, f"{k} tăng theo số bước: {a[k]} → {b[k]}"


# ---------------------------------------------------------------- HTTP: phiếu tính giá ----
@pytest.fixture
def token(client, seed_credentials) -> str:
    resp = client.post("/api/auth/login", json=seed_credentials)
    assert resp.status_code == 200
    return resp.json()["access_token"]


@pytest.fixture
def auth_headers(token) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _dem_http(fn, nhan=""):
    from app.db import engine

    n = 0

    def _bat(*a, **k):
        nonlocal n
        n += 1

    event.listen(engine, "before_cursor_execute", _bat)
    try:
        kq = fn()
    finally:
        event.remove(engine, "before_cursor_execute", _bat)
    return n, kq


def _seed_phieu_http(so_buoc: int, nhan: str) -> dict:
    """Seed giấy + công đoạn + `so_buoc` vật tư (2 chip) rồi trả payload `thanh_phans` có vật tư/bước."""
    from app.db import SessionLocal

    s = SessionLocal()
    try:
        giay = GiayNguyen(don_vi_them=["to"], ma=f"G-{nhan}", ten="Couche test", gsm=150, kho_dai=1090, kho_rong=790,
                          don_vi_gia="to", don_gia=2000)
        s.add(giay)
        cd = CongDoan(ma=f"CD-{nhan}", ten="Cán màng test", nhom="finishing", che_do_tinh="theo_san_luong",
                      pricing_basis="per_area_sides", run_rate=0.05, setup_cost=50000, kieu_bu_hao="khong")
        s.add(cd)
        s.flush()
        buocs = []
        for i in range(so_buoc):
            vt = VatTuInAn(ma=f"VT-{nhan}{i}", ten=f"Vật tư {nhan}{i}", don_vi_gia="kg", don_gia=1000,
                           cong_thuc_gia="dai_x * rong_x * don_gia_vat_tu / 1000000")
            vt.chips = [VatTuChip(ma="dai_x", ten="Dài", don_vi="mm", thu_tu=0),
                        VatTuChip(ma="rong_x", ten="Rộng", don_vi="mm", thu_tu=1)]
            s.add(vt)
            s.flush()
            buocs.append({"ten": f"Bước {i}", "cong_doan_id": cd.id, "dien_tich": 100, "so_mat": 1,
                          "vat_tus": [{"vat_tu_id": vt.id, "gia_tri_chip": {"dai_x": 500, "rong_x": 400}}]})
        s.commit()
        return {"ten": "Tờ ruột", "giay_id": giay.id, "so_con": 2, "quy_cach_in": "mot_mat",
                "so_mau_a": 4, "che_ban_don_gia": 90000, "don_gia_cong_in": 120, "thanh_phams": buocs}
    finally:
        s.close()


def _luong_http(client, headers, so_buoc: int, nhan: str) -> dict:
    tp = _seed_phieu_http(so_buoc, nhan)
    body = {"ten_san_pham": "Perf", "so_luong": 3000, "thanh_phans": [tp]}
    ra: dict[str, int] = {}
    ra["post"], r = _dem_http(lambda: client.post("/api/phieu-tinh-gia", json=body, headers=headers))
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    ra["get"], r = _dem_http(lambda: client.get(f"/api/phieu-tinh-gia/{pid}", headers=headers))
    assert r.status_code == 200, r.text
    assert len(r.json()["thanh_phans"][0]["thanh_phams"]) == so_buoc
    ra["put"], r = _dem_http(lambda: client.put(f"/api/phieu-tinh-gia/{pid}", json=body, headers=headers))
    assert r.status_code == 200, r.text
    ra["preview"], r = _dem_http(lambda: client.post("/api/tinh-gia/preview", json=body, headers=headers))
    assert r.status_code == 200, r.text
    return ra


def test_phieu_tinh_gia_http_so_cau_khong_tang_theo_so_buoc_vat_tu(client, auth_headers):
    a = _luong_http(client, auth_headers, 2, "a")
    b = _luong_http(client, auth_headers, 10, "b")
    print("http N=2:", a, "N=10:", b)
    # `post`/`put` còn mỗi bước/vật tư 1 câu INSERT (ghi) — chỉ GET + preview là đọc thuần.
    assert b["get"] <= a["get"] + 3, f"GET phiếu tăng theo số bước: {a['get']} → {b['get']}"
    assert b["preview"] <= a["preview"] + 3, f"preview tăng theo số bước: {a['preview']} → {b['preview']}"
    assert b["post"] <= a["post"] + 2 * 8 + 3, f"POST phiếu tăng theo số bước: {a['post']} → {b['post']}"
    assert b["put"] <= a["put"] + 2 * 8 + 3, f"PUT phiếu tăng theo số bước: {a['put']} → {b['put']}"


def _seed_vat_tu_http(so_vat_tu: int, nhan: str, *, gan_cong_doan: bool = False) -> None:
    from app.db import SessionLocal
    from app.models.cong_doan import CongDoanVatTu

    s = SessionLocal()
    try:
        cds = []
        if gan_cong_doan:
            for i in range(so_vat_tu):
                cd = CongDoan(ma=f"CDL-{nhan}{i}", ten=f"Công đoạn list {nhan}{i}", nhom="finishing")
                s.add(cd)
                cds.append(cd)
            s.flush()
        for i in range(so_vat_tu):
            vt = VatTuInAn(ma=f"VTL-{nhan}{i}", ten=f"Vật tư list {nhan}{i}", don_vi_gia="kg", don_gia=1000,
                           cong_thuc_gia="dai_x * rong_x * don_gia_vat_tu / 1000000")
            vt.chips = [VatTuChip(ma="dai_x", ten="Dài", don_vi="mm", thu_tu=0),
                        VatTuChip(ma="rong_x", ten="Rộng", don_vi="mm", thu_tu=1)]
            s.add(vt)
            s.flush()
            if gan_cong_doan:
                cds[i].vat_tus.append(CongDoanVatTu(vat_tu_id=vt.id, thu_tu=0))
        s.commit()
    finally:
        s.close()


def test_danh_muc_vat_tu_va_cong_doan_list_so_cau_khong_tang(client, auth_headers):
    _seed_vat_tu_http(2, "a", gan_cong_doan=True)
    a_vt, r = _dem_http(lambda: client.get("/api/vat-lieu-kho/vat-tu-in-an?size=200", headers=auth_headers))
    assert r.status_code == 200, r.text
    n_vt_a = r.json()["total"]
    a_cd, r = _dem_http(lambda: client.get("/api/cong-doan?size=200", headers=auth_headers))
    assert r.status_code == 200, r.text
    n_cd_a = r.json()["total"]
    _seed_vat_tu_http(10, "b", gan_cong_doan=True)
    b_vt, r = _dem_http(lambda: client.get("/api/vat-lieu-kho/vat-tu-in-an?size=200", headers=auth_headers))
    assert r.json()["total"] >= n_vt_a + 8
    assert any(it.get("chips") for it in r.json()["items"])
    b_cd, r = _dem_http(lambda: client.get("/api/cong-doan?size=200", headers=auth_headers))
    assert r.json()["total"] >= n_cd_a + 8
    print("list vat_tu", a_vt, b_vt, "cong_doan", a_cd, b_cd)
    assert b_vt <= a_vt + 3, f"list vật tư tăng theo số vật tư: {a_vt} → {b_vt}"
    assert b_cd <= a_cd + 3, f"list công đoạn tăng theo số công đoạn: {a_cd} → {b_cd}"
