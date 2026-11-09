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
    assert client.get(f"{GOC}/ban?tab=chua_hen&tu=2026-11-01&den=2026-11-14").status_code == 401


def test_vat_tu_tra_den_theo_lo(client):
    lid = _lenh("LSX-XL3-VT")
    r = client.get(f"{GOC}/vat-tu?lsx_ids={lid}", headers=_hd(client))
    assert r.status_code == 200
    assert [d["lsx_id"] for d in r.json()] == [lid]
    assert r.json()[0]["muc"] in ("ok", "vang", "do")
    assert client.get(f"{GOC}/vat-tu?lsx_ids=a,b", headers=_hd(client)).status_code == 400


def test_lenh_khong_ton_tai_thi_404(client):
    assert client.get(f"{GOC}/lenh/999999", headers=_hd(client)).status_code == 404


# ============================================================== ghi


def test_phat_hanh_khong_can_moc(client):
    """07/11/2026: phát lệnh không còn đòi giờ bắt đầu, bộ phận tự xếp máy ở Kế hoạch bộ phận."""
    lid, h = _lenh(), _hd(client)
    assert client.post(f"{GOC}/phat-hanh/{lid}", headers=h).status_code == 200


def test_phat_hanh_bam_la_di_khong_hoi_gi(client):
    """Lệnh mới `san_sang`, chưa giữ vật tư, chưa khai KCS cuối — màn 2 chặn cả ba, màn 3 cho qua."""
    from app.models.lsx import TT_DA_PHAT_HANH

    lid, h = _lenh(), _hd(client)
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
    client.post(f"{GOC}/phat-hanh/{lid}", headers=h)
    r = client.post(f"{GOC}/phat-hanh-cap-nhat/{lid}", json={"ly_do": "ff"}, headers=h)
    assert r.status_code == 400, r.text


def test_thu_hoi_thieu_ly_do_thi_400_chu_khong_phai_500(client):
    """Lý do thu hồi là cái VẾT, không phải cửa gác xếp lịch — nhưng lỗi phải ra 400 đọc được."""
    lid, h = _lenh(), _hd(client)
    client.post(f"{GOC}/phat-hanh/{lid}", headers=h)
    assert client.delete(f"{GOC}/phat-hanh/{lid}", headers=h).status_code == 400
    r = client.delete(f"{GOC}/phat-hanh/{lid}?ly_do=Khách dời hạn", headers=h)
    assert r.status_code == 200, r.text


# ============================================================== hợp đồng router
def test_moi_duong_GHI_deu_day_SSE():
    """Soi NGUỒN chứ không soi hành vi: quên đẩy SSE thì màn người khác đứng im mà không test
    nghiệp vụ nào đỏ — đúng kiểu lỗi lọt lưới. Đẩy đi qua `_phat_lich_doi` (hẹn / bỏ hẹn / đẩy ngay) hoặc
    `_phat_goi_xuong_xuong` (phát hành / cập nhật / thu hồi — thêm bàn tổ)."""
    from app.routers import xep_lich as r

    cay = ast.parse(_inspect.getsource(r))
    ghi = {"hen", "hen_theo_loc", "bo_hen", "day_ngay", "phat_hanh", "thu_hoi", "phat_hanh_cap_nhat"}
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
