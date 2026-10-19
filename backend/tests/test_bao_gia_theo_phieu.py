"""Báo giá theo SỐ của phiếu tính giá (chốt 05/10/2026).

  - Lưu phiếu (PUT) ⇒ báo giá NHÁP của phiếu theo ngay SL / giá vốn; GIỮ markup, giá bán gõ tay,
    % chiết khấu, diễn giải đã sửa; thêm / bỏ dòng theo sản phẩm thêm / xoá ở phiếu.
  - Báo giá đã gửi giữ nguyên; chi tiết báo `phieu_doi`; đồng bộ ⇒ phiên bản mới chép nguyên ý
    người soạn rồi áp số mới.
  - Số câu SQL khi lập báo giá / lưu phiếu không tăng theo số sản phẩm.
"""
from __future__ import annotations

from sqlalchemy import event

from app.db import engine
from tests.khach_phieu_fixtures import khach_mac_dinh
from tests.test_phieu_tinh_gia import _component, _seed_catalog
from tests.test_quotation_from_ptg import _h, _token, _version_count


def _phieu(client, t, *, so_luong=2000, comps=None) -> int:
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        cid = khach_mac_dinh(db)
        db.commit()
    finally:
        db.close()
    r = client.post("/api/phieu-tinh-gia", json={
        "ten_san_pham": "Tờ rơi", "so_luong": so_luong, "customer_id": cid, "thanh_phans": comps,
    }, headers=_h(t))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _sua_phieu(client, t, pid, **body):
    r = client.put(f"/api/phieu-tinh-gia/{pid}", json=body, headers=_h(t))
    assert r.status_code == 200, r.text
    return r.json()


def _bg(client, t, qid):
    return client.get(f"/api/quotations/{qid}", headers=_h(t)).json()


def test_luu_phieu_thi_bao_gia_nhap_theo_sl_va_gia_von(client):
    t = _token(client)
    giay, cd = _seed_catalog()
    pid = _phieu(client, t, comps=[_component(giay, cd)])
    q = client.post("/api/quotations", json={"phieu_tinh_gia_id": pid}, headers=_h(t)).json()
    it0 = q["items"][0]
    assert it0["quantity"] == 2000
    _sua_phieu(client, t, pid, so_luong=20000, thanh_phans=[_component(giay, cd)])
    d = _bg(client, t, q["id"])
    it = d["items"][0]
    assert it["id"] == it0["id"]                         # sửa tại chỗ, không đẻ dòng
    assert it["quantity"] == 20000
    assert it["total_cost_snapshot"] > it0["total_cost_snapshot"]
    assert round(it["margin_percent"]) == 20
    assert round(it["selling_price"]) == round(it["total_cost_snapshot"] * 1.2)
    assert round(d["total"]) == round(it["final_amount"])
    assert d["phieu_doi"] is False
    assert _version_count(q["id"]) == 1


def test_dong_go_tay_giu_gia_go_tay_va_chiet_khau(client):
    t = _token(client)
    giay, cd = _seed_catalog()
    pid = _phieu(client, t, comps=[_component(giay, cd)])
    q = client.post("/api/quotations", json={"phieu_tinh_gia_id": pid}, headers=_h(t)).json()
    iid = q["items"][0]["id"]
    von_cu = q["items"][0]["total_cost_snapshot"]
    r = client.put(f"/api/quotations/{q['id']}", json={"items": [{
        "id": iid, "manual_selling_price": 9_000_000, "discount_amount": 450_000, "dien_giai": "Sửa tay",
    }]}, headers=_h(t))
    assert r.status_code == 200, r.text
    _sua_phieu(client, t, pid, so_luong=20000, thanh_phans=[_component(giay, cd)])
    it = _bg(client, t, q["id"])["items"][0]
    assert it["quantity"] == 20000
    assert it["gia_go_tay"] is True
    assert round(it["selling_price"]) == 9_000_000       # giữ giá gõ tay
    # % chiết khấu TRÊN GIÁ VỐN giữ nguyên khi giá vốn đổi (chiết khấu cộng vào giá bán).
    assert abs(it["discount_amount"] - 450_000 / von_cu * it["total_cost_snapshot"]) <= 1
    assert it["dien_giai"] == "Sửa tay"                  # giữ diễn giải đã sửa
    goc = it["total_cost_snapshot"] + it["discount_amount"]
    expect = round((9_000_000 / goc - 1) * 100, 2)
    assert abs(it["margin_percent"] - expect) < 0.01     # lợi nhuận % trên (vốn + chiết khấu) suy lại


def test_them_bot_san_pham_o_phieu(client):
    t = _token(client)
    giay, cd = _seed_catalog()
    a = {**_component(giay, cd), "ten": "Bìa"}
    b = {**_component(giay), "ten": "Ruột"}
    pid = _phieu(client, t, comps=[a])
    q = client.post("/api/quotations", json={"phieu_tinh_gia_id": pid}, headers=_h(t)).json()
    _sua_phieu(client, t, pid, thanh_phans=[a, b])
    assert [i["product_name"] for i in _bg(client, t, q["id"])["items"]] == ["Bìa", "Ruột"]
    _sua_phieu(client, t, pid, thanh_phans=[b])
    assert [i["product_name"] for i in _bg(client, t, q["id"])["items"]] == ["Ruột"]


def test_bao_gia_da_gui_giu_nguyen_roi_dong_bo_ra_phien_ban_moi(client):
    t = _token(client)
    giay, cd = _seed_catalog()
    pid = _phieu(client, t, comps=[_component(giay, cd)])
    q = client.post("/api/quotations", json={"phieu_tinh_gia_id": pid}, headers=_h(t)).json()
    iid = q["items"][0]["id"]
    client.put(f"/api/quotations/{q['id']}", json={"items": [{
        "id": iid, "manual_selling_price": 9_000_000, "dien_giai": "Sửa tay"}]}, headers=_h(t))
    sent = client.post(f"/api/quotations/{q['id']}/transition", json={"to_status": "sent"}, headers=_h(t))
    assert sent.status_code == 200, sent.text
    _sua_phieu(client, t, pid, so_luong=20000, thanh_phans=[_component(giay, cd)])
    d = _bg(client, t, q["id"])
    assert d["items"][0]["quantity"] == 2000             # đã gửi khách: giữ nguyên
    assert d["phieu_doi"] is True
    r = client.post(f"/api/quotations/resync-from-ptg/{pid}", headers=_h(t))
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "new_version"
    d = _bg(client, t, q["id"])
    assert d["status"] == "draft" and d["version"] == 2
    it = d["items"][0]
    assert it["quantity"] == 20000
    assert round(it["selling_price"]) == 9_000_000 and it["gia_go_tay"] is True
    assert it["dien_giai"] == "Sửa tay"
    assert d["phieu_doi"] is False


def test_dong_bo_bao_gia_da_huy_bi_chan(client):
    from app.db import SessionLocal
    from app.models.quotation import Quote

    t = _token(client)
    giay, cd = _seed_catalog()
    pid = _phieu(client, t, comps=[_component(giay, cd)])
    q = client.post("/api/quotations", json={"phieu_tinh_gia_id": pid}, headers=_h(t)).json()
    db = SessionLocal()
    try:
        db.get(Quote, q["id"]).status = "cancelled"
        db.commit()
    finally:
        db.close()
    assert client.post(f"/api/quotations/resync-from-ptg/{pid}", headers=_h(t)).status_code == 409


def _dem_sql(fn) -> int:
    """Đếm câu ĐỌC/SỬA (bỏ INSERT: ghi một dòng mới là việc thật; Postgres còn gộp lô)."""
    n = [0]

    def dem(_c, _cur, sql, *_a):
        if not sql.lstrip().upper().startswith("INSERT"):
            n[0] += 1
    event.listen(engine, "before_cursor_execute", dem)
    try:
        fn()
    finally:
        event.remove(engine, "before_cursor_execute", dem)
    return n[0]


def test_so_cau_sql_khong_tang_theo_so_san_pham(client):
    t = _token(client)
    giay, cd = _seed_catalog()

    def do(k: int) -> tuple[int, int]:
        comps = [{**_component(giay, cd), "ten": f"SP {i}"} for i in range(k)]
        pid = _phieu(client, t, comps=comps)
        lap = _dem_sql(lambda: client.post("/api/quotations", json={"phieu_tinh_gia_id": pid}, headers=_h(t)))
        luu = _dem_sql(lambda: _sua_phieu(client, t, pid, so_luong=9000, thanh_phans=comps))
        return lap, luu

    lap1, luu1 = do(1)
    lap5, luu5 = do(5)
    # 5 sản phẩm hơn 1 sản phẩm đúng 4 món: một câu theo từng món là dư ít nhất 4. Không đòi bằng
    # khít — CI từng ra 37 với 40 ở một lượt (rồi xanh lại) mà không có cache hay nhánh nào theo số món.
    assert lap5 - lap1 < 4, (lap1, lap5)
    assert luu5 - luu1 < 4, (luu1, luu5)
