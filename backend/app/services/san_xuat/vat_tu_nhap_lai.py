"""Tổ yêu cầu NHẬP LẠI vật tư thừa vào kho (spec 2026-10-01 §3.5).

Logic CHUNG mọi vật tư, mọi tổ (giấy chỉ thêm khổ; đơn vị gốc máy chủ suy từ ĐVT). Đây là yêu cầu
NHẬP bình thường của kho: thủ kho lập phiếu nhập → ghi sổ → lô mới (mang khổ + đơn vị gốc của dòng). Bảng đối chiếu của công đoạn đọc
phiếu nhập đã ghi sổ qua `stock_requests.vat_tu_tra_cong_viec_id` để ra "thực dùng = thực xuất −
nhập lại".

KHÔNG dùng cột `san_xuat_cong_viec_id` — cột đó là nhập THÀNH PHẨM từ KCS, `dong_nhap_tu_cong_viec`
đếm mọi NHẬP mang nó; gán nhầm là số thành phẩm "đã gửi kho" phình lên.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from ...models.lsx import Lsx
from ...models.stock_request import REQ_NHAP
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from ...repositories.san_xuat_vat_tu_repo import SanXuatVatTuRepository
from ..kho_giay import DON_VI_TO_KHO, chuan_kho, co_don_vi_goc, co_kho, khoa_dong
from ..ke_hoach_vat_tu_service import KeHoachVatTuError
from ..quyen_to import VIEC_KHO
from ..stock_request_service import StockRequestError
from .thuc_thi import _gate
from .vat_tu_de_nghi import (
    _bao_de_nghi_doi, _can_luc_luu, _hang_service, _kh_service, _ngay_vn, _req_service,
)


class VatTuNhapLaiError(ValueError):
    """Lỗi NGHIỆP VỤ (400) — khác `ValueError` thường "không thấy công việc" (404)."""


def _gia_theo_dien_tich(k: tuple, nguon: dict) -> float:
    """Giá / tờ của khổ `k` suy từ phần đã xuất cùng (mã, đơn vị gốc tờ) theo DIỆN TÍCH: tổng tiền ÷ tổng
    (tờ × mm²) × mm² của khổ trả. Bước "nhận từ" (In nhận tờ in 545×790 từ Cắt tờ) trả thừa tờ in,
    còn kho chỉ xuất tờ nguyên 790×1090 cho Cắt tờ — lấy thẳng giá / tờ nguyên là gấp đôi."""
    dt = (k[3] or 0) * (k[4] or 0)
    cung = [(kk, sl, g) for kk, (sl, g) in nguon.items()
            if kk[:3] == k[:3] and (kk[3] or 0) * (kk[4] or 0) > 0]
    tong_dt = sum(sl * kk[3] * kk[4] for kk, sl, _ in cung)
    if dt <= 0 or tong_dt <= 0:
        return 0.0
    return sum(sl * g for _, sl, g in cung) / tong_dt * dt


def _gia_binh_quan(k: tuple, nguon: dict) -> float:
    """Bình quân gia quyền `sl_goc` phần đã xuất cùng (mã, đơn vị gốc)."""
    cung = [v for kk, v in nguon.items() if kk[:3] == k[:3]]
    tong = sum(sl for sl, _ in cung)
    return sum(sl * g for sl, g in cung) / tong if tong > 0 else 0.0


def _chuan_dong(kh_svc, hang, ln: dict, don_gia_goc: dict,
                don_gia_lenh: dict | None = None) -> dict:
    """Một dòng người gõ → dòng yêu cầu kho. Ném `VatTuNhapLaiError` tiếng Việt nêu đích danh mặt hàng."""
    loai, hid = ln.get("hang_loai"), ln.get("hang_id")
    if not loai or not hid:
        raise VatTuNhapLaiError("Mỗi dòng phải chọn một mặt hàng trong danh mục.")
    try:
        ten = hang.get(loai, int(hid)).ten
    except Exception:  # noqa: BLE001 - mặt hàng không có: để câu lỗi bên dưới nói
        raise VatTuNhapLaiError("Mặt hàng không có trong danh mục — chọn lại.") from None
    try:
        so = float(ln.get("so_luong") or 0)
    except (TypeError, ValueError):
        so = 0.0
    if so <= 0 or round(so, 2) <= 0:
        raise VatTuNhapLaiError(f"«{ten}» phải nhập số lượng lớn hơn 0.")
    dvt = (ln.get("dvt") or "").strip()
    if not dvt:
        raise VatTuNhapLaiError(f"«{ten}» chưa chọn đơn vị.")

    goc = kr = kd = None
    if co_don_vi_goc(loai):
        # Giấy bỏ dạng cuộn/tờ (10/10/2026), vật tư khai nhiều đơn vị (mg 0390): đơn vị gốc SUY từ
        # ĐVT người gõ — nhóm đơn vị đã khai chứa nó (tờ/ram ⇒ "tờ"; kg/tấn ⇒ kg; thùng ⇒ thùng).
        goc = kh_svc.goc_cua_dvt(loai, int(hid), dvt)
    if co_kho(loai):
        # Giấy đếm tờ cần đủ hai cạnh khổ; đơn vị khác (và vật tư, 27/10/2026) khổ tuỳ chọn.
        kr, kd = chuan_kho(ln.get("kho_rong"), ln.get("kho_dai"))
        if loai == "giay" and goc == DON_VI_TO_KHO and not (kr and kd):
            raise VatTuNhapLaiError(f"«{ten}» đếm theo tờ — khai đủ hai cạnh khổ (mm).")
    try:
        sl_goc, _ = kh_svc.ve_don_vi_goc(loai, int(hid), dvt, so, goc=goc)
    except KeHoachVatTuError as e:
        raise VatTuNhapLaiError(f"«{ten}»: {e}") from None
    if sl_goc <= 0:
        raise VatTuNhapLaiError(f"«{ten}» quy ra số lượng không hợp lệ.")

    k = khoa_dong(loai, int(hid), goc, kr or 0, kd or 0)
    # Giá vốn: đúng khoá (mã+gốc+khổ) trước; trả khác khổ thì bình quân gia quyền phần đã xuất
    # cùng (mã, gốc) cho công việc này. Công việc không có phiếu xuất nào của (mã, gốc) — bước
    # "nhận từ bước trước" (In nhận giấy qua bàn giao) — thì lấy phần đã xuất cho cả LỆNH (bước lấy
    # giấy): đúng khoá, hoặc giấy tờ quy theo diện tích, hoặc bình quân (mã, gốc). Không có ⇒ 0.
    if k in don_gia_goc:
        gia_goc = don_gia_goc[k][1]
    else:
        gia_goc = _gia_binh_quan(k, don_gia_goc)
    if gia_goc <= 0 and don_gia_lenh:
        if k in don_gia_lenh:
            gia_goc = don_gia_lenh[k][1]
        elif goc == DON_VI_TO_KHO:
            gia_goc = _gia_theo_dien_tich(k, don_gia_lenh)
        else:
            gia_goc = _gia_binh_quan(k, don_gia_lenh)
    # Giá khai theo ĐƠN VỊ NGƯỜI GÕ (đ/ram nếu gõ ram): quy từ giá đ/đơn vị gốc theo đúng tỉ lệ của dòng.
    don_gia = int(round(gia_goc * sl_goc / so)) if gia_goc > 0 else 0
    return {
        # Đơn vị gốc dòng kho máy chủ kho tự suy lại từ `dvt` — không gửi.
        "hang_loai": loai, "hang_id": int(hid), "dvt": dvt, "sl_de_nghi": so,
        "kho_rong": kr or 0, "kho_dai": kd or 0,
        "don_gia": don_gia,
    }


def tao(db: Session, *, user, cong_viec_id: int, lines: list[dict],
        ghi_chu: str | None = None, can_luc: datetime | None = None,
        req_svc=None, kh_svc=None) -> dict:
    """Tạo yêu cầu NHẬP LẠI vật tư thừa của một công việc. Commit bên trong; báo kho SAU commit.

    Trả `{id, ma, trang_thai}`. Server lấy người tạo từ `user` (token), `bo_phan_id` = phòng của người
    tạo (11/10/2026 — trước là tổ của công việc); `don_gia` = giá vốn bình quân của phần đã xuất cho chính công việc này (không có = 0).
    """
    repo = SanXuatRepository(db)
    cv = repo.cong_viec(cong_viec_id)
    if cv is None:
        raise ValueError("Không tìm thấy công việc.")   # ValueError thường ⇒ router trả 404
    # KHÔNG chặn khi lệnh đã đóng: trả vật tư thừa về kho là việc SAU khi chạy xong, đóng lệnh rồi
    # tổ vẫn phải trả được.
    repo.khoa_cong_viec(cong_viec_id)       # bấm đúp không đẻ hai yêu cầu: lượt sau chờ khoá
    _gate(db, user, cv, VIEC_KHO)
    if not lines:
        raise VatTuNhapLaiError("Chưa chọn vật tư nào để nhập lại.")

    hang = _hang_service(db)
    kh_svc = kh_svc or _kh_service(db, hang)
    req_xuat = [d.stock_request_id for d in SanXuatVatTuRepository(db).cac_de_nghi(cong_viec_id)
                if d.stock_request_id]
    sl_repo = SanXuatSanLuongRepository(db)
    gia = sl_repo.gia_von_xuat_theo_hang(req_xuat)
    req_lenh = SanXuatVatTuRepository(db).stock_request_ids_cung_lenh(
        lsx_id=cv.lsx_id, bai_ghep_id=getattr(cv, "bai_ghep_id", None))
    gia_lenh = sl_repo.gia_von_xuat_theo_hang(req_lenh)
    kho_lines = [_chuan_dong(kh_svc, hang, ln, gia, gia_lenh) for ln in lines]

    lsx = db.get(Lsx, cv.lsx_id) if cv.lsx_id else None
    ma_lenh = lsx.ma if lsx is not None else ""
    ghi = f"Nhập lại vật tư từ {ma_lenh} · {cv.ten_cong_doan}" if ma_lenh \
        else f"Nhập lại vật tư từ bước «{cv.ten_cong_doan}»"
    if (ghi_chu or "").strip():
        ghi = f"{ghi} — {ghi_chu.strip()}"

    req_svc = req_svc or _req_service(db, hang)
    # Giờ trả hàng (mg 0384): tổ nhập thì ngày cần là ngày của giờ đó; không nhập thì để trống như cũ.
    gio = {"ngay_can": _ngay_vn(can_luc), "can_luc": _can_luc_luu(can_luc)} if can_luc else {}
    # Nhập về đúng kho đã xuất hàng cho việc (xuất nhiều kho thì kho nhiều nhất; bước "nhận từ" thì
    # kho đã xuất cho cả lệnh) — 11/10/2026: không gắn thì phiếu nhập lấy kho đang lọc ở màn Kho,
    # màng cán trả về rơi vào Kho thành phẩm. Thủ kho vẫn đổi tay được trên phiếu.
    kho_id = sl_repo.kho_xuat_nhieu_nhat(req_xuat) or sl_repo.kho_xuat_nhieu_nhat(req_lenh)
    if kho_id:
        gio["kho_id"] = kho_id
    try:
        req = req_svc.create(
            user=user, loai=REQ_NHAP, lines=kho_lines, commit=False,
            bo_phan_id=user.department_id, **gio,
            vat_tu_tra_cong_viec_id=cv.id,      # KHÔNG phải san_xuat_cong_viec_id (nhập thành phẩm)
            ghi_chu=ghi[:1000],
        )
    except StockRequestError as e:
        db.rollback()
        raise VatTuNhapLaiError(str(e)) from None

    # ⚠️ `audit_repo.create` tự commit — mọi lệnh ghi phải đứng TRƯỚC nó.
    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None), action="san_xuat_nhap_lai_vat_tu",
        target=f"san_xuat_cong_viec:{cong_viec_id}",
        detail=f"stock_request={req.id} ma={req.ma} · {len(kho_lines)} dòng",
    )
    db.commit()
    req_svc.thong_bao_yeu_cau_moi(req)
    _bao_de_nghi_doi(cv)
    return {"id": req.id, "ma": req.ma, "trang_thai": req.trang_thai}
