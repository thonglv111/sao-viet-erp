"""Tiền khoán từ LẦN GHI sản lượng + giá theo tổ (21/10/2026).

Spec: `docs/superpowers/specs/2026-10-20-hai-luong-khoi-san-xuat-design.md` — công thức khoán thợ in,
giá theo máy, ba luật theo ngày, tổ trưởng ăn chia / ăn thưởng. Số lấy theo ví dụ của chủ: máy 2 màu
CMYK `150000 + max(0, sl − 3000) × 30`.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from itertools import count

from app.db import SessionLocal
from app.models.cong_doan import CongDoan, CongDoanKhoan, CongDoanKhoanPhatSinh
from app.models.department import Department
from app.models.employee import Employee
from app.models.payroll import KhoanChiTieuNgay, KhoanToTruong
from app.models.san_xuat import SanXuatCongViec, SanXuatGoiPhatHanh
from app.models.san_xuat_san_luong import SanXuatBatch, SanXuatBatchNguoi, SanXuatBatchPhatSinh
from app.models.user import User
from app.models.work_calendar import SpecialDay
from app.services.khoan_ky import KhoanKyService, MucKhoan
from app.services.san_xuat import viec_khoan

NAM, THANG = 2026, 10
CONG_THUC = "gia_co_dinh + max(0, sl_ghi - 3000) * don_gia_khoan"
_dem = count(1)


def _h(client) -> dict:
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


class _Nen:
    """Dựng thẳng bằng ORM: tổ · công đoạn có Khoán · công việc · lần ghi. Bài test soi phép tính
    tiền, không soi luồng ghi ở bàn tổ (đã có test riêng)."""

    def __init__(self, db) -> None:
        self.db = db
        i = next(_dem)
        self.goi = SanXuatGoiPhatHanh(ma=f"GOI-KK-{i}")
        db.add(self.goi)
        db.flush()

    def to(self, ten: str, *, to_in: bool = False, cha: int | None = None) -> Department:
        i = next(_dem)
        d = Department(name=f"{ten} {i}", code=f"TO-KK-{i}", la_san_xuat=True, la_to_in=to_in,
                       parent_id=cha)
        self.db.add(d)
        self.db.flush()
        return d

    def nv(self, to: Department, ten: str, *, user: bool = False) -> Employee:
        uid = None
        if user:
            u = User(username=f"u_kk_{next(_dem)}", name=ten, password_hash="x")
            self.db.add(u)
            self.db.flush()
            uid = u.id
        e = Employee(code=f"NV-KK-{next(_dem)}", full_name=ten, department_id=to.id, user_id=uid)
        self.db.add(e)
        self.db.flush()
        return e

    def khoan(self, *, gia_theo_to=None, cong_thuc=CONG_THUC, unit_price=30,
              phat_sinh=()) -> CongDoanKhoan:
        cd = CongDoan(ma=f"CD-KK-{next(_dem)}", ten="Bài in 1 màu hoặc 2 màu", nhom="print")
        self.db.add(cd)
        self.db.flush()
        k = CongDoanKhoan(cong_doan_id=cd.id, unit="to", unit_price=unit_price,
                          cong_thuc_khoan=cong_thuc, gia_theo_to=gia_theo_to)
        for j, (ten, don_gia, gtt) in enumerate(phat_sinh):
            k.viec_phat_sinh.append(CongDoanKhoanPhatSinh(ten=ten, don_gia=don_gia, don_vi="lan",
                                                          thu_tu=j, gia_theo_to=gtt))
        self.db.add(k)
        self.db.flush()
        return k

    def ghi(self, to: Department, khoan: CongDoanKhoan, ngay: date, sl: float, nguoi,
            *, phat_sinh: dict | None = None) -> SanXuatBatch:
        cv = SanXuatCongViec(goi_id=self.goi.id, department_id=to.id, ten_cong_doan="In")
        self.db.add(cv)
        self.db.flush()
        o, ps_rows = viec_khoan.chuan_hoa_khi_ghi(
            self.db, khoan=khoan, ten_cong_doan=khoan.cong_doan.ten,
            phat_sinh=[{"phat_sinh_id": ps.id, "so_luong": n}
                       for ps in khoan.viec_phat_sinh for t, n in (phat_sinh or {}).items()
                       if ps.ten == t],
            department_id=to.id)
        # 03:00 UTC = 10:00 giờ xưởng VN — cùng ngày ở cả máy giờ VN lẫn máy CI giờ UTC.
        luc = datetime(ngay.year, ngay.month, ngay.day, 3, 0, tzinfo=timezone.utc)
        b = SanXuatBatch(cong_viec_id=cv.id, bat_dau=luc, ket_thuc=luc, tong=sl, tot=sl, hong=0,
                         don_vi="to", **o)
        self.db.add(b)
        self.db.flush()
        for r in ps_rows:
            r.batch_id = b.id
            self.db.add(r)
        for e in nguoi:
            self.db.add(SanXuatBatchNguoi(batch_id=b.id, employee_id=e.id, department_id=to.id))
        self.db.flush()
        return b


def _muc_bang_nhau(db) -> MucKhoan:
    """Mọi người cùng lương ca máy ⇒ tỷ lệ chia của Đợt 2 ra đúng chia đều — số của Đợt 1 giữ nguyên."""
    return MucKhoan(luong_ca_may={int(i): 1.0 for (i,) in db.query(Employee.id)})


GIA_IN = lambda *to_gia: [{"department_id": t.id, "gia_co_dinh": cd, "don_gia": dg}  # noqa: E731
                          for t, cd, dg in to_gia]


def test_LAN_GHI_may_2_mau_ra_dung_so_cung_luong_ca_may_chia_bang_nhau(client):
    """6.340 tờ ở máy 2 màu (150.000 / 30) ⇒ 150.000 + 3.340 × 30 = 250.200, chia 2 người 125.100.
    Ghi 2 lần ⇒ ăn 2 lần giá bài. Tổ 5 màu cùng công đoạn ăn giá của tổ đó (144.000 / 20)."""
    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        m2, m5 = n.to("Máy 2 màu"), n.to("Máy 5 màu")
        a, b, c = n.nv(m2, "A"), n.nv(m2, "B"), n.nv(m5, "C")
        k = n.khoan(gia_theo_to=GIA_IN((m2, 150_000, 30), (m5, 144_000, 20)))
        lg = n.ghi(m2, k, date(NAM, THANG, 5), 6_340, [a, b])
        assert (lg.gia_co_dinh_khoan_snapshot, lg.don_gia_khoan_snapshot) == (150_000, 30)
        n.ghi(m2, k, date(NAM, THANG, 6), 2_000, [a])
        n.ghi(m5, k, date(NAM, THANG, 6), 4_000, [c])
        db.commit()
        kq = KhoanKyService(db).tinh(NAM, THANG, _muc_bang_nhau(db))
        assert kq["khoan"][a.id] == 125_100 + 150_000
        assert kq["khoan"][b.id] == 125_100
        assert kq["khoan"][c.id] == 144_000 + 1_000 * 20
        assert kq["thieu_gia"] == [] and kq["tang_ca_khoan"] == {}
    finally:
        db.close()


def test_TO_VANG_bang_gia_la_THIEU_GIA_khong_doan(client):
    """Bảng giá theo tổ đã khai mà tổ ghi vắng mặt ⇒ snapshot None, lần ghi vào `thieu_gia`, 0đ."""
    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        m2, m4 = n.to("Máy 2 màu"), n.to("Máy 4 màu")
        a = n.nv(m4, "A")
        k = n.khoan(gia_theo_to=GIA_IN((m2, 150_000, 30)))
        lg = n.ghi(m4, k, date(NAM, THANG, 5), 5_000, [a])
        assert lg.don_gia_khoan_snapshot is None and lg.gia_co_dinh_khoan_snapshot is None
        db.commit()
        kq = KhoanKyService(db).tinh(NAM, THANG, _muc_bang_nhau(db))
        assert a.id not in kq["khoan"]
        assert [t["ly_do"] for t in kq["thieu_gia"]] == ["tổ chưa có giá ở bảng giá theo tổ"]
        assert kq["thieu_gia"][0]["ngay"] == "05/10"
    finally:
        db.close()


def test_PHAT_SINH_gia_theo_to_va_khong_cong_thuc(client):
    """Không khai công thức ⇒ giá cố định + SL tốt × đơn giá. Thay kẽm 2 × 100.000 cộng thêm; xuống
    bài theo tổ (2M 187.500)."""
    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        m2 = n.to("Máy 2 màu")
        a = n.nv(m2, "A")
        k = n.khoan(gia_theo_to=GIA_IN((m2, 0, 30)), cong_thuc=None, phat_sinh=[
            ("Thay kẽm", 100_000, None),
            ("Xuống bài", 0, [{"department_id": m2.id, "don_gia": 187_500}]),
        ])
        n.ghi(m2, k, date(NAM, THANG, 5), 1_000, [a], phat_sinh={"Thay kẽm": 2, "Xuống bài": 1})
        db.commit()
        kq = KhoanKyService(db).tinh(NAM, THANG, _muc_bang_nhau(db))
        assert kq["khoan"][a.id] == 1_000 * 30 + 2 * 100_000 + 187_500
    finally:
        db.close()


def test_LUAT_NGAY_to_in_CN_bo_to_thuong_CN_trung_le_gap_doi(client):
    client
    db = SessionLocal()
    try:
        cn = date(NAM, THANG, 4)                     # Chủ nhật
        db.add(SpecialDay(day=cn, kind="off", name="Lễ thử trùng CN", is_paid=True))
        n = _Nen(db)
        to_in, dan = n.to("Máy 2 màu", to_in=True), n.to("Dán")
        a, b = n.nv(to_in, "A"), n.nv(dan, "B")
        k = n.khoan(gia_theo_to=GIA_IN((to_in, 150_000, 30), (dan, 100_000, 0)))
        n.ghi(to_in, k, cn, 3_000, [a])
        n.ghi(dan, k, cn, 3_000, [b])
        db.commit()
        kq = KhoanKyService(db).tinh(NAM, THANG, _muc_bang_nhau(db))
        assert a.id not in kq["khoan"], "tổ in ngày CN / lễ: sản lượng không vào vế khoán"
        assert kq["khoan"][b.id] == 200_000, "tổ thường CN trùng lễ: ×2"
    finally:
        db.close()


def test_CHI_TIEU_NGAY_50_phan_tram_vuot_la_tang_ca_khoan(client):
    """Chỉ tiêu 300.000/ngày (khai ở tổ CHA khối SX), tổ làm 400.000 ⇒ tăng ca khoán 50.000 chia theo
    phần mỗi người hôm đó (3 : 1)."""
    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        cha = n.to("Xưởng in")
        m2 = n.to("Máy 2 màu", cha=cha.id)
        a, b = n.nv(m2, "A"), n.nv(m2, "B")
        db.add(KhoanChiTieuNgay(department_id=cha.id, ap_dung_tu=date(NAM, 1, 1), so_tien=300_000))
        k = n.khoan(gia_theo_to=GIA_IN((m2, 0, 100)), cong_thuc=None)
        n.ghi(m2, k, date(NAM, THANG, 5), 2_000, [a, b])       # 200.000 → 100k mỗi người
        n.ghi(m2, k, date(NAM, THANG, 5), 2_000, [a])          # 200.000 → A
        n.ghi(m2, k, date(NAM, THANG, 6), 2_000, [a])          # ngày khác, dưới chỉ tiêu
        db.commit()
        kq = KhoanKyService(db).tinh(NAM, THANG, _muc_bang_nhau(db))
        assert kq["khoan"][a.id] == 500_000 and kq["khoan"][b.id] == 100_000
        assert kq["tang_ca_khoan"] == {a.id: 37_500, b.id: 12_500}
    finally:
        db.close()


def test_TO_TRUONG_an_chia_va_an_thuong(client):
    """Ăn chia 5%: quỹ 1.000.000 ⇒ tổ trưởng +50.000, mọi phần × 0,95. Ăn thưởng: không ai bị trừ."""
    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        chia, thuong = n.to("Cán màng"), n.to("Bế")
        tt1, t1 = n.nv(chia, "Phú", user=True), n.nv(chia, "Thợ")
        tt2, t2 = n.nv(thuong, "Nhất", user=True), n.nv(thuong, "Thợ 2")
        chia.head_user_id, thuong.head_user_id = tt1.user_id, tt2.user_id
        for to, cd in ((chia, "chia"), (thuong, "thuong")):
            db.add(KhoanToTruong(department_id=to.id, ap_dung_tu=date(NAM, 1, 1), che_do=cd, ty_le=5))
        k = n.khoan(gia_theo_to=GIA_IN((chia, 0, 100), (thuong, 0, 100)), cong_thuc=None)
        n.ghi(chia, k, date(NAM, THANG, 5), 10_000, [tt1, t1])
        n.ghi(thuong, k, date(NAM, THANG, 5), 10_000, [tt2, t2])
        db.commit()
        kq = KhoanKyService(db).tinh(NAM, THANG, _muc_bang_nhau(db))["khoan"]
        assert kq[tt1.id] == 475_000 + 50_000 and kq[t1.id] == 475_000
        assert kq[tt1.id] + kq[t1.id] == 1_000_000, "ăn chia: quỹ chia hết, công ty không bù"
        assert kq[tt2.id] == 500_000 + 50_000 and kq[t2.id] == 500_000
    finally:
        db.close()


def test_CONG_THUC_LOI_vao_thieu_gia_khong_500(client):
    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        m2 = n.to("Máy 2 màu")
        a = n.nv(m2, "A")
        k = n.khoan(gia_theo_to=GIA_IN((m2, 150_000, 30)), cong_thuc="gia_co_dinh / (sl_ghi - 3000)")
        n.ghi(m2, k, date(NAM, THANG, 5), 3_000, [a])
        db.commit()
        kq = KhoanKyService(db).tinh(NAM, THANG, _muc_bang_nhau(db))
        assert a.id not in kq["khoan"]
        assert kq["thieu_gia"][0]["ly_do"].startswith("công thức khoán lỗi")
    finally:
        db.close()


def test_DANH_MUC_DOI_so_gia_cua_to(client):
    """Đổi giá của TỔ ghi sau khi ghi ⇒ băng "Danh mục đã đổi" nêu giá cố định; đổi giá tổ khác ⇒ im."""
    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        m2, m4 = n.to("Máy 2 màu"), n.to("Máy 4 màu")
        a = n.nv(m2, "A")
        k = n.khoan(gia_theo_to=GIA_IN((m2, 150_000, 30), (m4, 250_000, 30)))
        lg = n.ghi(m2, k, date(NAM, THANG, 5), 3_000, [a])
        k.gia_theo_to = GIA_IN((m2, 150_000, 30), (m4, 260_000, 30))
        db.flush()
        assert viec_khoan.danh_muc_doi(db, lg, [], department_id=m2.id) == []
        k.gia_theo_to = GIA_IN((m2, 160_000, 30), (m4, 260_000, 30))
        db.flush()
        doi = viec_khoan.danh_muc_doi(db, lg, [], department_id=m2.id)
        assert [o["truong"] for o in doi] == ["gia_co_dinh"]
    finally:
        db.close()


def test_LUU_CONG_DOAN_gia_theo_to_va_cong_thuc_bien_lan_ghi(client):
    """Danh mục Công đoạn: lưu bảng giá theo tổ + công thức dùng `sl_ghi`; tổ trùng / số âm ⇒ 422."""
    h = _h(client)
    db = SessionLocal()
    try:
        m2 = Department(name="Máy 2 màu API", code="TO-KK-API", la_san_xuat=True)
        db.add(m2)
        db.commit()
        to_id = m2.id
    finally:
        db.close()
    body = {"ma": "CD-KK-API", "ten": "Bài in API", "nhom": "print", "department_ids": [to_id],
            "che_do_tinh": "theo_san_luong", "pricing_basis": "per_other",
            "khoan": {"unit": "to", "unit_price": 30, "cong_thuc_khoan": CONG_THUC,
                      "gia_theo_to": [{"department_id": to_id, "gia_co_dinh": 150_000, "don_gia": 30}],
                      "viec_phat_sinh": []}}
    r = client.post("/api/cong-doan", json=body, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["khoan"]["gia_theo_to"] == [
        {"department_id": to_id, "gia_co_dinh": 150_000, "don_gia": 30}]
    trung = {**body, "ma": "CD-KK-API2", "khoan": {**body["khoan"], "gia_theo_to": [
        {"department_id": to_id, "gia_co_dinh": 1, "don_gia": 1},
        {"department_id": to_id, "gia_co_dinh": 2, "don_gia": 2}]}}
    r = client.post("/api/cong-doan", json=trung, headers=h)
    assert r.status_code == 422 and "hai lần" in r.text, r.text
    am = {**body, "ma": "CD-KK-API3", "khoan": {**body["khoan"], "gia_theo_to": [
        {"department_id": to_id, "gia_co_dinh": -1, "don_gia": 30}]}}
    r = client.post("/api/cong-doan", json=am, headers=h)
    assert r.status_code == 422 and "không được âm" in r.text, r.text
