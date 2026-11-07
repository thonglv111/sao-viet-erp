"""Xếp lịch 3 — lớp API: RBAC, mã lỗi, và cam kết "không chặn gì hết" ở tầng HTTP.

Luật nghiệp vụ đã có bộ riêng (`test_xep_lich_lenh_service.py`) chạy trên luồng thật. File này soi
đúng phần router: ai vào được, tham số thiếu thì 4xx nào, lỗi nghiệp vụ ra đúng mã, và mọi đường
GHI đều đẩy SSE (thiếu một cái là badge người khác đứng im — nguyên tắc real-time của dự án).

Lệnh trong file này dựng THẲNG bằng ORM chứ không chạy lại luồng đơn→SX: ở đây không kiểm con số,
chỉ kiểm cửa vào, nên dựng nguồn đầy đủ chỉ làm test chậm mà không thêm bằng chứng nào.
"""
from __future__ import annotations

import ast
import inspect as _inspect
from datetime import date, datetime

import pytest

from app.db import SessionLocal
from app.models.lsx import TT_SAN_SANG, Lsx

ADMIN = {"username": "admin", "password": "admin123"}
GOC = "/api/xep-lich"


def _hd(client) -> dict[str, str]:
    tok = client.post("/api/auth/login", json=ADMIN).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def _lenh(ma: str = "LSX-XL3-01", **kw) -> int:
    db = SessionLocal()
    try:
        kw.setdefault("order_id", 1)
        l = Lsx(ma=ma, ten="Lệnh thử Xếp lịch 3", order_line_id=1,
                trang_thai=TT_SAN_SANG, so_luong_dat=1000, so_to_ke_hoach=120, **kw)
        db.add(l)
        db.commit()
        return l.id
    finally:
        db.close()


# ============================================================== cửa vào
def test_chua_dang_nhap_thi_401(client):
    assert client.get(f"{GOC}/hang-cho").status_code == 401


def test_admin_doc_duoc_hang_cho(client):
    lid = _lenh()
    r = client.get(f"{GOC}/hang-cho", headers=_hd(client))
    assert r.status_code == 200
    body = r.json()
    assert lid in [d["lsx_id"] for d in body["dong"]]
    assert body["tong"] >= 1


def test_hang_cho_tim_va_phan_trang_di_qua_may_chu(client):
    _lenh("LSX-XL3-A")
    _lenh("LSX-XL3-B")
    h = _hd(client)
    assert len(client.get(f"{GOC}/hang-cho?moi_trang=1", headers=h).json()["dong"]) == 1
    r = client.get(f"{GOC}/hang-cho?tim=LSX-XL3-B", headers=h).json()
    assert [d["ma"] for d in r["dong"]] == ["LSX-XL3-B"]


def test_lich_thieu_cua_so_thi_422(client):
    """`tu`/`den` BẮT BUỘC — không mở đường trải cả lịch sử (spec §4.1)."""
    assert client.get(f"{GOC}/lich", headers=_hd(client)).status_code == 422


def test_lich_cua_so_nguoc_thi_400(client):
    r = client.get(f"{GOC}/lich?tu=2026-09-20&den=2026-09-10", headers=_hd(client))
    assert r.status_code == 400


def test_lich_tra_ngay_dac_biet_ca_va_cum(client):
    """Mục 6 mockup: trục ghi TÊN lễ và tô làm bù — ba khoá mới phải đi qua `response_model`."""
    from app.models.work_calendar import SpecialDay

    db = SessionLocal()
    try:
        db.query(SpecialDay).filter(SpecialDay.day.in_([date(2027, 3, 3), date(2027, 3, 6)])).delete()
        db.add(SpecialDay(day=date(2027, 3, 3), kind="off", name="Lễ thử"))
        db.add(SpecialDay(day=date(2027, 3, 6), kind="work", name="Làm bù thử"))
        db.commit()
    finally:
        db.close()
    body = client.get(f"{GOC}/lich?tu=2027-03-01&den=2027-03-07", headers=_hd(client)).json()
    assert {"ngay": "2027-03-03", "loai": "off", "ten": "Lễ thử"} in body["ngay_dac_biet"]
    assert {"ngay": "2027-03-06", "loai": "work", "ten": "Làm bù thử"} in body["ngay_dac_biet"]
    assert "cac_ca" in body and body["cum"] == []


def test_vat_tu_tra_den_theo_lo(client):
    lid = _lenh("LSX-XL3-VT")
    r = client.get(f"{GOC}/vat-tu?lsx_ids={lid}", headers=_hd(client))
    assert r.status_code == 200
    assert [d["lsx_id"] for d in r.json()] == [lid]
    assert r.json()[0]["muc"] in ("ok", "vang", "do")
    assert client.get(f"{GOC}/vat-tu?lsx_ids=a,b", headers=_hd(client)).status_code == 400


def test_lich_tra_kem_ngay_nghi_cua_dung_cua_so(client):
    """`ngay_nghi` phải ĐI QUA được `response_model` — `LichOut` không khai thì Pydantic nuốt im
    lặng và FE lại quay về đoán "T7 + CN" (xưởng này làm thứ 7)."""
    body = client.get(f"{GOC}/lich?tu=2026-09-12&den=2026-09-20", headers=_hd(client)).json()
    assert "2026-09-13" in body["ngay_nghi"]      # chủ nhật
    assert "2026-09-12" not in body["ngay_nghi"]  # thứ 7 vẫn làm
    # Không rò ngày ngoài cửa sổ: bàn tô nền theo đúng danh sách này.
    assert all("2026-09-12" <= n <= "2026-09-20" for n in body["ngay_nghi"])


def test_lenh_khong_ton_tai_thi_404(client):
    assert client.get(f"{GOC}/lenh/999999", headers=_hd(client)).status_code == 404


# ============================================================== ghi
def test_dat_moc_roi_doc_lai_ra_dung_moc(client):
    lid, h = _lenh(), _hd(client)
    r = client.put(f"{GOC}/lenh/{lid}", json={"bat_dau_at": "2026-09-11T08:00:00"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["bat_dau_at"].startswith("2026-09-11T08:00")
    ct = client.get(f"{GOC}/lenh/{lid}", headers=h).json()
    assert ct["bat_dau_at"].startswith("2026-09-11T08:00")
    assert lid not in [d["lsx_id"] for d in client.get(f"{GOC}/hang-cho", headers=h).json()["dong"]]


def test_thu_moc_xem_truoc_khong_ghi(client):
    lid, h = _lenh("LSX-XL3-THU", han_hoan_thanh_sx=date(2026, 9, 1)), _hd(client)
    r = client.get(f"{GOC}/lenh/{lid}/thu?bat_dau=2026-09-11T08:00:00", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["bat_dau"].startswith("2026-09-11T08:00") and r.json()["ket_thuc"]
    assert lid in [d["lsx_id"] for d in client.get(f"{GOC}/hang-cho", headers=h).json()["dong"]]
    assert client.get(f"{GOC}/lenh/999999/thu?bat_dau=2026-09-11T08:00:00", headers=h).status_code == 404
    # Lọc nhanh "trễ hạn" + đếm đi qua response_model.
    client.put(f"{GOC}/lenh/{lid}", json={"bat_dau_at": "2026-09-11T08:00:00"}, headers=h)
    body = client.get(f"{GOC}/lich?tu=2026-09-07&den=2026-09-20&nhanh=tre", headers=h).json()
    assert lid in [d["lsx_id"] for d in body["dong"]] and body["dem"]["tre"] >= 1
    assert "so_buoc_chua_gio" in body["dong"][0]
    assert client.get(f"{GOC}/lich?tu=2026-09-07&den=2026-09-20&nhanh=x", headers=h).status_code == 422


def test_chot_cu_thi_409(client):
    lid, h = _lenh(), _hd(client)
    client.put(f"{GOC}/lenh/{lid}", json={"bat_dau_at": "2026-09-11T08:00:00"}, headers=h)
    r = client.put(f"{GOC}/lenh/{lid}", json={
        "bat_dau_at": "2026-09-12T08:00:00", "expected_updated_at": "2020-01-01T00:00:00",
    }, headers=h)
    assert r.status_code == 409


def test_KHONG_CHAN_du_xep_sau_han_sx(client):
    """§1 ở tầng HTTP: trễ hạn SX vẫn 200. Trễ là chuyện của MÀU trên thanh, không phải cửa gác."""
    lid, h = _lenh(han_hoan_thanh_sx=date(2026, 9, 1)), _hd(client)
    r = client.put(f"{GOC}/lenh/{lid}", json={"bat_dau_at": "2026-09-11T08:00:00"}, headers=h)
    assert r.status_code == 200


def test_xoa_moc_tra_lenh_ve_hang_cho(client):
    lid, h = _lenh(), _hd(client)
    client.put(f"{GOC}/lenh/{lid}", json={"bat_dau_at": "2026-09-11T08:00:00"}, headers=h)
    assert client.delete(f"{GOC}/lenh/{lid}", headers=h).status_code == 200
    assert lid in [d["lsx_id"] for d in client.get(f"{GOC}/hang-cho", headers=h).json()["dong"]]


def test_xoa_moc_lenh_chua_xep_thi_404(client):
    lid, h = _lenh(), _hd(client)
    assert client.delete(f"{GOC}/lenh/{lid}", headers=h).status_code == 404


def test_phat_hanh_khong_can_moc(client):
    """07/11/2026: phát lệnh không còn đòi giờ bắt đầu, bộ phận tự xếp máy ở Kế hoạch bộ phận."""
    lid, h = _lenh(), _hd(client)
    assert client.post(f"{GOC}/phat-hanh/{lid}", headers=h).status_code == 200
    # Phát mà chưa có giờ thì lệnh vẫn nằm khay (gắn "đã phát"), không thì mất đường thu hồi.
    dong = {d["lsx_id"]: d for d in client.get(f"{GOC}/hang-cho", headers=h).json()["dong"]}
    assert dong[lid]["da_phat_hanh"] is True


def test_lenh_tron_goi_da_phat_khong_vao_khay(client):
    """Trọn gói cũng ở trạng thái đã phát nhưng không bao giờ qua Xếp lịch."""
    from app.models.gia_cong_ngoai import KIEU_TRON_GOI, GiaCongNgoai
    from app.models.lsx import TT_DA_PHAT_HANH
    from app.models.purchase import Supplier

    lid, h = _lenh("LSX-XL3-TG"), _hd(client)
    db = SessionLocal()
    try:
        s = Supplier(name="In ngoài thử", nhan_gia_cong=True)
        db.add(s)
        db.flush()
        db.add(GiaCongNgoai(kieu=KIEU_TRON_GOI, nha_cung_cap_id=s.id, lsx_id=lid))
        db.get(Lsx, lid).trang_thai = TT_DA_PHAT_HANH
        db.commit()
    finally:
        db.close()
    assert lid not in [d["lsx_id"] for d in client.get(f"{GOC}/hang-cho", headers=h).json()["dong"]]
    # Lần trọn gói đã huỷ thì lệnh phát thường như mọi lệnh, lại vào khay.
    db = SessionLocal()
    try:
        g = db.query(GiaCongNgoai).filter(GiaCongNgoai.lsx_id == lid).one()
        g.huy_luc = datetime(2026, 11, 7, 8, 0)
        db.commit()
    finally:
        db.close()
    assert lid in [d["lsx_id"] for d in client.get(f"{GOC}/hang-cho", headers=h).json()["dong"]]


def test_phat_hanh_bam_la_di_khong_hoi_gi(client):
    """Lệnh mới `san_sang`, chưa giữ vật tư, chưa khai KCS cuối — màn 2 chặn cả ba, màn 3 cho qua."""
    from app.models.lsx import TT_DA_PHAT_HANH

    lid, h = _lenh(), _hd(client)
    client.put(f"{GOC}/lenh/{lid}", json={"bat_dau_at": "2026-09-11T08:00:00"}, headers=h)
    r = client.post(f"{GOC}/phat-hanh/{lid}", headers=h)
    assert r.status_code == 200, r.text
    db = SessionLocal()
    try:
        assert db.get(Lsx, lid).trang_thai == TT_DA_PHAT_HANH
    finally:
        db.close()
    assert client.post(f"{GOC}/phat-hanh/{lid}", headers=h).status_code == 409   # bấm hai lần


def test_goi_phat_hanh_mo_bang_quyen_READ_va_404_khi_khong_co_lenh(client):
    """Panel hỏi câu này TRƯỚC khi bày nút. Ở đây chỉ soi cửa vào — số liệu thật cần routing nên
    nằm ở `test_xep_lich_lenh_service.py`; lệnh dựng thẳng bằng ORM không có bước nào, phát hành
    không đẻ gói, đúng nghĩa `co_goi=False`."""
    lid, h = _lenh(), _hd(client)
    r = client.get(f"{GOC}/phat-hanh/{lid}/goi", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["co_goi"] is False
    assert client.get(f"{GOC}/phat-hanh/999999/goi", headers=h).status_code == 404


def test_phat_hanh_cap_nhat_thieu_ly_do_thi_400(client):
    lid, h = _lenh(), _hd(client)
    client.put(f"{GOC}/lenh/{lid}", json={"bat_dau_at": "2026-09-11T08:00:00"}, headers=h)
    client.post(f"{GOC}/phat-hanh/{lid}", headers=h)
    r = client.post(f"{GOC}/phat-hanh-cap-nhat/{lid}", json={"ly_do": "ff"}, headers=h)
    assert r.status_code == 400, r.text


def test_thu_hoi_thieu_ly_do_thi_400_chu_khong_phai_500(client):
    """Lý do thu hồi là cái VẾT, không phải cửa gác xếp lịch — nhưng lỗi phải ra 400 đọc được."""
    lid, h = _lenh(), _hd(client)
    client.put(f"{GOC}/lenh/{lid}", json={"bat_dau_at": "2026-09-11T08:00:00"}, headers=h)
    client.post(f"{GOC}/phat-hanh/{lid}", headers=h)
    assert client.delete(f"{GOC}/phat-hanh/{lid}", headers=h).status_code == 400
    r = client.delete(f"{GOC}/phat-hanh/{lid}?ly_do=Khách dời hạn", headers=h)
    assert r.status_code == 200, r.text


# ============================================================== hợp đồng router
def test_moi_duong_GHI_deu_day_SSE():
    """Soi NGUỒN chứ không soi hành vi: quên đẩy SSE thì màn người khác đứng im mà không test
    nghiệp vụ nào đỏ — đúng kiểu lỗi lọt lưới. Đẩy đi qua `_phat_lich_doi` (đặt / bỏ mốc) hoặc
    `_phat_goi_xuong_xuong` (phát hành / cập nhật / thu hồi — thêm bàn tổ)."""
    from app.routers import xep_lich as r

    cay = ast.parse(_inspect.getsource(r))
    ghi = {"dat_moc", "xoa_moc", "phat_hanh", "thu_hoi", "phat_hanh_cap_nhat"}
    thay = {
        n.name for n in ast.walk(cay)
        if isinstance(n, ast.FunctionDef) and n.name in ghi
        and ("_phat_lich_doi(" in ast.unparse(n) or "_phat_goi_xuong_xuong(" in ast.unparse(n))
    }
    assert thay == ghi, f"thiếu SSE ở: {sorted(ghi - thay)}"


def test_moi_route_deu_co_cua_quyen():
    from app.routers import xep_lich as r

    nguon = _inspect.getsource(r)
    for hanh_dong in ("read", "update", "approve"):
        assert f'require_permission(MODULE, "{hanh_dong}")' in nguon
    # Không route nào để trống cửa: đếm số route == số lần gọi require_permission.
    cay = ast.parse(nguon)
    so_route = sum(
        1 for n in ast.walk(cay) if isinstance(n, ast.FunctionDef)
        and any("router." in ast.unparse(d) for d in n.decorator_list)
    )
    assert nguon.count("require_permission(MODULE") == so_route


def test_xep_lich_khong_co_scope():
    """Bàn lịch là bức tranh chung — bày dropdown Phạm vi chỉ khiến người cấp quyền tưởng nhầm."""
    from app.services.role_service import SCOPELESS_MODULES

    assert "xep_lich" in SCOPELESS_MODULES


# ============================================================== payload chi tiết
def test_chi_tiet_chiu_duoc_quy_cach_so_va_tra_ten_khach(client):
    """Hai lỗi ĐÃ GẶP trên dev-browser, khoá lại bằng test.

    1. `quy_cach_json` là ảnh chụp lúc tạo lệnh, `so_kem`/`so_mau` có thể là SỐ. Schema khai
       `str | None` ⇒ FastAPI ném `ResponseValidationError` = 500; mà 500 rơi NGOÀI
       `CORSMiddleware` nên trình duyệt chỉ báo "blocked by CORS policy", không ai thấy 500.
    2. `Lsx` không có relationship `order`, nên `getattr(l, "order")` luôn None và bốn ô đầu panel
       (khách · đơn · PO · sale) im lặng hiện "—".
    """
    from app.models.customer import Customer
    from app.models.order import Order

    db = SessionLocal()
    try:
        kh = Customer(code="KH-XL3", name="Công ty Bánh Ngọt")
        db.add(kh)
        db.flush()
        don = Order(order_no="SO-XL3-9", customer_id=kh.id, customer_po_no="PO-77")
        db.add(don)
        db.commit()
        oid, ten_kh = don.id, kh.name
    finally:
        db.close()

    lid = _lenh("LSX-XL3-QC", order_id=oid, quy_cach_json={"so_kem": 4, "so_mau": 4, "giay_ten": "Giấy C300"})
    r = client.get(f"{GOC}/lenh/{lid}", headers=_hd(client))
    assert r.status_code == 200, r.text
    b = r.json()
    assert (b["so_kem"], b["so_mau"], b["giay"]) == ("4", "4", "Giấy C300")
    assert b["customer_name"] == ten_kh
    assert b["order_no"] == "SO-XL3-9"
    assert b["customer_po_no"] == "PO-77"
