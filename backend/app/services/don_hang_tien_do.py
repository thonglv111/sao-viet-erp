"""Tiến độ MỘT đơn hàng bán cho Kinh doanh — Sản xuất → Nhập kho → Giao hàng (19/09/2026).

Thiết kế: `docs/superpowers/plans/2026-09-19-giao-hang-tien-do-don.md`.

Chỉ ĐỌC, không một cột nào mới. Ba nguồn đã có sẵn, gộp theo CỤM BÁN (một sản phẩm khách mua):
  · Sản xuất — lệnh của đơn (`lsx.order_line_id`), % và dự kiến xong tính bằng đúng hàm bảng lệnh
    dùng (`lenh_sx.danh_sach._soi`, `tien_do.phan_tram`) để hai màn không vênh số;
  · Nhập kho — dòng yêu cầu NHẬP thành phẩm KCS gửi cho lệnh của đơn (đề nghị / kho đã nhận);
  · Giao hàng — `DeliveryService.nguon_giao_theo_cum` (đã giao / đang giữ / giao được).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..models.lsx import TT_DA_DONG, TT_DA_XUONG_XUONG, Lsx
from ..models.san_xuat import CV_HOAN_THANH
from ..repositories.delivery_repo import DeliveryRepository
from ..repositories.employee_repo import EmployeeRepository
from ..repositories.order_repo import OrderRepository
from .delivery_service import DeliveryService


def _ngay(dt: datetime | None):
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).date()


def tien_do_don(db: Session, order) -> dict:
    from .lenh_sx import danh_sach, tien_do

    bay_gio = datetime.now(timezone.utc)
    deliveries = DeliveryRepository(db)
    svc = DeliveryService(deliveries, OrderRepository(db), EmployeeRepository(db), None, None)
    nguon = svc.nguon_giao_theo_cum(order)

    lsx_ids = sorted({s for n in nguon for s in n["lsx_ids"]})
    lenh = {l.id: l for l in db.query(Lsx).filter(Lsx.id.in_(lsx_ids)).all()} if lsx_ids else {}
    chay = [i for i in lsx_ids if lenh[i].trang_thai in TT_DA_XUONG_XUONG]
    bc, tinh = danh_sach._soi(db, chay, bay_gio) if chay else (None, {})

    def mot_lenh(i: int) -> dict:
        l = lenh[i]
        if i not in tinh:
            return {"id": i, "ma": l.ma, "da_xuong_xuong": False, "pct": 0.0, "uoc_tinh": False,
                    "xong": False, "buoc_hien_tai": None, "du_kien_xong": None,
                    "trang_thai": None, "canh_bao": []}
        pct, uoc = tien_do.phan_tram(bc, i)
        if l.trang_thai == TT_DA_DONG:
            pct = 100.0
        cvs = bc.cong_viec_du(i)
        cv = danh_sach.buoc_hien_tai(bc, i)
        return {
            "id": i, "ma": l.ma, "da_xuong_xuong": True,
            "pct": round(float(pct), 1), "uoc_tinh": bool(uoc),
            "xong": (bool(cvs) and all(c.trang_thai == CV_HOAN_THANH for c in cvs))
            or l.trang_thai == TT_DA_DONG,
            "buoc_hien_tai": cv.ten_cong_doan if cv is not None else None,
            "du_kien_xong": tinh[i]["xong"],
            "trang_thai": tinh[i]["trang_thai"],
            "canh_bao": list(tinh[i]["canh_bao"]),
        }

    from .don_hang_san_xuat import tom_tat_nhieu_don

    # Mặt hàng đang ở đâu (xưởng / nhà gia công / chờ kho…) — cùng hàm với cột Sản xuất ngoài danh
    # sách và bộ lọc "Đang chờ", nên ba chỗ không nói khác nhau.
    tom = tom_tat_nhieu_don(db, [order], nguon_san={order.id: nguon}, lenh_san=lenh,
                            bc_san=bc).get(order.id) or {}
    mon_theo_khoa = {m["khoa"]: m for m in tom.get("mon", [])}

    cum_out: list[dict] = []
    moc_xong: list[datetime] = []
    thieu_moc = False
    ly_do: set[str] = set()
    for n in nguon:
        c = n["cum"]
        ls = [mot_lenh(i) for i in n["lsx_ids"]]
        for x in ls:
            if x["xong"]:
                continue
            ly_do.update(x["canh_bao"])
            if not x["da_xuong_xuong"]:
                ly_do.add("chua_xuong_xuong")
                thieu_moc = True
            elif x["du_kien_xong"] is None:
                thieu_moc = True
            else:
                moc_xong.append(x["du_kien_xong"])
        de_nghi, da_nhan = n["kho_de_nghi"], n["kho_da_nhan"]
        cum_out.append({
            "khoa": c.khoa,
            "ten": c.ten,
            "don_vi": getattr(c.dong_dau, "don_vi_tinh", None),
            "order_line_ids": [od.id for od in c.dong],
            "dat": n["dat"],
            "co_lenh": n["co_lenh"],
            "lenh": ls,
            "sx_pct": round(sum(x["pct"] for x in ls) / len(ls), 1) if ls else None,
            "sx_xong": bool(ls) and all(x["xong"] for x in ls),
            "kho_de_nghi": round(de_nghi, 3),
            "kho_da_nhan": round(da_nhan, 3),
            "cho_kho": round(max(0.0, de_nghi - da_nhan), 3),
            "ton_that": round(n["ton_that"], 3),
            "ton_kho": n["ton_kho"],
            "giu_don_khac": n["giu_don_khac"],
            "da_giao": n["da_giao"],
            "giao_thang": n["giao_thang"],
            "dang_giu": n["dang_giu"],
            "con_phai_giao": n["con_phai_giao"],
            "khach_nhan_du": n["khach_nhan_du"],
            "giao_duoc": n["giao_duoc"],
            "o": (mon_theo_khoa.get(c.khoa) or {}).get("o"),
            "lenh_o": (mon_theo_khoa.get(c.khoa) or {}).get("lenh", []),
        })

    han = order.delivery_committed_date
    du_kien = max(moc_xong) if moc_xong and not thieu_moc else None
    tre = None
    if han is not None and du_kien is not None:
        tre = max(0, (_ngay(du_kien) - han).days)
    return {
        "order_id": order.id,
        "han_cam_ket": han,
        "du_kien_xong": du_kien,
        "chua_du_du_lieu": thieu_moc and any(not x["sx_xong"] for x in cum_out if x["co_lenh"]),
        "tre_ngay": tre,
        "ly_do": sorted(ly_do),
        "cum": cum_out,
        "yeu_cau": _yeu_cau(svc, order),
        "noi_nhan": _noi_nhan(db, order),
        "dang_cho": tom.get("dang_cho", []),
    }


def _noi_nhan(db: Session, order) -> dict:
    """Nơi nhận để form yêu cầu giao CHỌN — mặc định của đơn + sổ địa chỉ / người liên hệ của khách.

    Trả kèm ở đây (quyền đọc đơn) chứ không bắt FE gọi `/api/customers/...`: Kinh doanh lập yêu cầu
    giao không nhất thiết có ô xem hồ sơ khách, gọi rồi ăn 403 là form trống oan.
    """
    from ..models.customer import CustomerAddress, CustomerContact

    kid = order.customer_id
    dc = (db.query(CustomerAddress).filter(CustomerAddress.customer_id == kid)
          .order_by(CustomerAddress.is_default.desc(), CustomerAddress.id).all()) if kid else []
    lh = (db.query(CustomerContact).filter(CustomerContact.customer_id == kid)
          .order_by(CustomerContact.is_primary.desc(), CustomerContact.id).all()) if kid else []
    return {
        "khach_id": kid,
        "dia_chi": order.delivery_address,
        "nguoi_nhan": order.delivery_contact_name,
        "sdt": order.delivery_contact_phone,
        "luu_y": order.delivery_note,
        "so_dia_chi": [{"id": a.id, "nhan": a.label, "dia_chi": a.address, "sdt": a.phone,
                        "mac_dinh": bool(a.is_default)} for a in dc],
        "lien_he": [{"id": c.id, "ten": c.name, "chuc_vu": c.title, "sdt": c.phone,
                     "chinh": bool(c.is_primary)} for c in lh],
    }


def _yeu_cau(svc: DeliveryService, order) -> list[dict]:
    """Yêu cầu giao của đơn + chuyến (một yêu cầu một chuyến, mg 0229) cho Kinh doanh theo dõi.

    Nạp GOM cả đơn một lượt (chuyến, đã giao, tài xế, xe, yêu cầu kho, phiếu kho, số ảnh): trước
    06/10/2026 hỏi từng yêu cầu / từng chuyến, ~10 câu SQL mỗi yêu cầu, và trạng thái yêu cầu nạp lại
    chuyến + đã giao lần hai."""
    from ..models.employee import Employee
    from ..models.xe import Xe

    db = svc.deliveries.db
    rp = svc.deliveries
    cum_theo_dong = {}
    from .thanh_pham_khai_bao import cum_ban

    for c in cum_ban(order):
        for od in c.dong:
            cum_theo_dong[od.id] = c
    ra: list[dict] = []
    reqs = sorted(rp.requests_cua_don_ca_huy(order.id), key=lambda r: r.id, reverse=True)
    rids = [r.id for r in reqs]
    trips_theo_yc = rp.trips_cua_nhieu_yeu_cau(rids)
    da_theo_yc = rp.da_giao_cua_nhieu_yeu_cau(rids)
    cuoi = {r.id: trips_theo_yc[r.id][-1] for r in reqs if trips_theo_yc[r.id]}
    tids = [t.id for t in cuoi.values()]
    nv_ids = {t.employee_id for t in cuoi.values() if t.employee_id}
    nv = {e.id: e for e in db.query(Employee).filter(Employee.id.in_(nv_ids))} if nv_ids else {}
    xe_ids = {t.vehicle_id for t in cuoi.values() if t.vehicle_id}
    xes = {x.id: x for x in db.query(Xe).filter(Xe.id.in_(xe_ids))} if xe_ids else {}
    tra_theo = rp.yeu_cau_kho_cua_nhieu_chuyen(tids, "NHAP")
    xuat_theo = rp.yeu_cau_kho_cua_nhieu_chuyen(tids, "XUAT")
    co_phieu = rp.yeu_cau_kho_da_co_phieu([y.id for y in xuat_theo.values()])
    da_ghi_so = rp.yeu_cau_kho_da_ghi_so([y.id for y in xuat_theo.values()])
    ma_phieu = rp.ma_phieu_kho_cua_nhieu_yeu_cau([y.id for y in xuat_theo.values()])
    so_anh = rp.so_dinh_kem_theo_trip(tids)
    for r in reqs:
        trips = trips_theo_yc[r.id]
        t = cuoi.get(r.id)
        da = da_theo_yc[r.id]
        dong: list[dict] = []
        da_co: set[str] = set()
        for ln in r.lines:
            c = cum_theo_dong.get(ln.order_line_id)
            khoa = c.khoa if c is not None else str(ln.order_line_id)
            if khoa in da_co:
                continue
            da_co.add(khoa)
            dong.append({"order_line_id": ln.order_line_id,
                         "ten": c.ten if c is not None else "",
                         "qty": int(ln.qty), "da_giao": int(da.get(ln.order_line_id, 0))})
        chuyen = None
        if t is not None:
            tx = nv.get(t.employee_id) if t.employee_id else None
            tra = tra_theo.get(t.id)
            x = xes.get(t.vehicle_id) if t.vehicle_id else None
            # Chỉ biển số: ghép "biển số · tên xe" thành một mẩu nối bằng dấu chấm (cấm ở UI).
            xe = x.ma if x is not None else None
            xuat = xuat_theo.get(t.id)
            chuyen = {
                "id": t.id,
                "trang_thai": t.trang_thai,
                "tai_xe": getattr(tx, "full_name", None),
                "xe": xe,
                "thoi_gian_ket_thuc": t.thoi_gian_ket_thuc,
                "nguoi_nhan_thuc_te": t.nguoi_nhan_thuc_te,
                "ly_do_that_bai": t.ly_do_that_bai,
                "tra_hang_ma": getattr(tra, "ma", None),
                "tra_hang_xong": tra is not None and tra.trang_thai == "done",
                "kho_da_lap_phieu": xuat is not None and xuat.id in co_phieu,
                # Hàng đã thực ra khỏi kho (có phiếu ghi sổ) ⇒ mở nút in phiếu xuất bán hàng / 02-VT.
                "kho_da_xuat": xuat is not None and xuat.id in da_ghi_so,
                # Số phiếu xuất kho (chưa huỷ) — bản tắt giao hàng hiện số này thay mã yêu cầu giao.
                "phieu_xuat_ma": ma_phieu.get(xuat.id, []) if xuat is not None else [],
                "so_anh": so_anh.get(t.id, 0),
            }
        ra.append({
            "id": r.id,
            "code": r.code,
            "ngay_can_giao": r.ngay_can_giao,
            "trang_thai": svc.trang_thai_yeu_cau(r, trips=trips, da_giao=da),
            "ly_do_huy": r.ly_do_huy,
            "dia_chi": r.dia_chi,
            "nguoi_nhan": r.nguoi_nhan,
            "sdt_nguoi_nhan": r.sdt_nguoi_nhan,
            "ghi_chu": r.ghi_chu,
            "created_at": r.created_at,
            "dong": dong,
            "chuyen": chuyen,
        })
    return ra
