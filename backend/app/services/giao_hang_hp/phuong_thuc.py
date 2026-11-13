"""Cách giao của mỗi lần xuất hàng (docs/design-giao-hang-ha-phuong.md §3, §7, §8).

Gọi từ router của phân hệ mới, SAU khi đường xuất cũ đã lập yêu cầu kho (đơn sản xuất) hoặc lượt xuất
(đơn thương mại). Không đụng file nào của module Giao hàng cũ.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.customer import Customer
from ...models.giao_hang_hp import PT_DICH_VU, PT_KHONG_GIAO, PT_LOAI, PT_NOI_BO, PhuongThucGiaoHp
from ...realtime import hub
from ...repositories.giao_hang_hp_repo import GiaoHangHpRepository
from ...repositories.notification_repo import NotificationRepository

TEN_LOAI = {
    PT_KHONG_GIAO: "Không cần giao",
    PT_NOI_BO: "Giao hàng nội bộ",
    PT_DICH_VU: "Giao hàng dịch vụ",
}


class PhuongThucLoi(ValueError):
    """Lỗi người dùng sửa được — router trả 400."""


def kiem(db: Session, pt: dict | None) -> dict:
    """Chuẩn hoá + kiểm cách giao. Trả dict cột để ghi. Trường không thuộc cách đã chọn bị bỏ."""
    pt = dict(pt or {})
    loai = (pt.get("loai") or "").strip()
    if loai not in PT_LOAI:
        raise PhuongThucLoi("Chọn cách giao hàng cho lần xuất này.")
    repo = GiaoHangHpRepository(db)
    ra: dict = {"loai": loai, "nguoi_giao_id": None, "xe_id": None, "don_vi_vc_id": None,
                "tien_cuoc": None, "ma_van_don": None}
    if loai == PT_NOI_BO:
        nguoi = pt.get("nguoi_giao_id")
        if not nguoi:
            raise PhuongThucLoi("Chọn người giao.")
        if not repo.la_nguoi_giao(int(nguoi)):
            raise PhuongThucLoi("Người giao phải là nhân viên bộ phận giao hàng đang làm việc.")
        ra["nguoi_giao_id"] = int(nguoi)
        xe_id = pt.get("xe_id")
        if xe_id:
            xe = repo.get_xe(int(xe_id))
            if xe is None or not xe.active:
                raise PhuongThucLoi("Xe đã chọn không còn dùng.")
            ra["xe_id"] = xe.id
    elif loai == PT_DICH_VU:
        dv = pt.get("don_vi_vc_id")
        if not dv:
            raise PhuongThucLoi("Chọn đơn vị vận chuyển.")
        dvvc = repo.get_dvvc(int(dv))
        if dvvc is None or not dvvc.active:
            raise PhuongThucLoi("Đơn vị vận chuyển đã chọn không còn trong danh sách.")
        ra["don_vi_vc_id"] = dvvc.id
        cuoc = pt.get("tien_cuoc")
        if cuoc is None:
            raise PhuongThucLoi("Gõ tiền cước.")
        if int(cuoc) < 0:
            raise PhuongThucLoi("Tiền cước không được âm.")
        ra["tien_cuoc"] = int(cuoc)
        ma = (pt.get("ma_van_don") or "").strip()
        ra["ma_van_don"] = ma[:64] or None
    return ra


def ghi(db: Session, *, order_id: int, actor, cot: dict, stock_request_id: int | None = None,
        luot_xuat_tm_id: int | None = None, ma_lan_xuat: str | None = None) -> PhuongThucGiaoHp:
    """Ghi một dòng cách giao (chưa commit). Người chọn lấy từ tài khoản."""
    return GiaoHangHpRepository(db).them(
        order_id=int(order_id), stock_request_id=stock_request_id, luot_xuat_tm_id=luot_xuat_tm_id,
        ma_lan_xuat=(ma_lan_xuat or None), nguoi_chon_id=getattr(actor, "id", None), **cot)


def bao_nguoi_giao(db: Session, row: PhuongThucGiaoHp, order) -> None:
    """Giao nội bộ ⇒ báo NGAY người giao (toast + một dòng thông báo). Gọi SAU commit, nuốt lỗi:
    đây là thông báo, hỏng thì lần xuất vẫn đúng."""
    try:
        if row.loai != PT_NOI_BO or not row.nguoi_giao_id or row.nguoi_giao_id == row.nguoi_chon_id:
            return
        repo = GiaoHangHpRepository(db)
        xe = repo.get_xe(row.xe_id) if row.xe_id else None
        khach = db.get(Customer, order.customer_id) if order.customer_id else None
        ma = row.ma_lan_xuat or order.order_no
        cau = f"Bạn giao lần xuất {ma} của đơn {order.order_no}"
        if khach is not None:
            cau += f" cho {khach.name}"
        if xe is not None:
            cau += f", xe {xe.ten} ({xe.ma})"
        cau += "."
        NotificationRepository(db).add_many(
            [row.nguoi_giao_id], loai="giao_hang_hp", tieu_de="Bạn có hàng cần giao", noi_dung=cau[:500])
        hub.publish(int(row.nguoi_giao_id), {"type": "notification_new"})
        # Sự kiện có sẵn của người giao — giao diện hiện toast ngay, không cần sửa màn nào.
        hub.publish(int(row.nguoi_giao_id), {
            "type": "giao_hang_chuyen", "viec": "giao_hp", "order_id": order.id, "message": cau})
    except Exception:
        return


def ra_dict(db: Session, rows: list[PhuongThucGiaoHp], *, xem_tien: bool) -> list[dict]:
    """Dòng trả ra API, đã tra tên. Tiền cước xoá khi người xem không có quyền xem tiền."""
    repo = GiaoHangHpRepository(db)
    ten = repo.ten_nguoi([r.nguoi_giao_id for r in rows] + [r.nguoi_chon_id for r in rows])
    xe = repo.xe_theo_ids(r.xe_id for r in rows)
    dvvc = repo.dvvc_theo_ids(r.don_vi_vc_id for r in rows)
    ra = []
    for r in rows:
        x = xe.get(r.xe_id) if r.xe_id else None
        n = dvvc.get(r.don_vi_vc_id) if r.don_vi_vc_id else None
        ra.append({
            "id": r.id, "order_id": r.order_id, "stock_request_id": r.stock_request_id,
            "luot_xuat_tm_id": r.luot_xuat_tm_id, "ma_lan_xuat": r.ma_lan_xuat, "loai": r.loai,
            "nguoi_giao_id": r.nguoi_giao_id, "nguoi_giao_ten": ten.get(r.nguoi_giao_id),
            "xe_id": r.xe_id, "xe_ten": x.ten if x else None, "xe_bien_so": x.ma if x else None,
            "don_vi_vc_id": r.don_vi_vc_id, "don_vi_vc_ten": n.ten if n else None,
            "tien_cuoc": r.tien_cuoc if xem_tien else None, "ma_van_don": r.ma_van_don,
            "nguoi_chon_ten": ten.get(r.nguoi_chon_id), "created_at": r.created_at,
        })
    return ra
