"""Router — Yêu cầu kho (spec-kho-de-nghi §2–§4, §7–§8).

Phục vụ CẢ HAI màn, khác nhau ở scope + quyền hiển thị cột (không nhân đôi dữ liệu):
* **Yêu cầu kho** — người yêu cầu, scope `own`, không thấy tồn/giá
* **Hộp yêu cầu kho** — thủ kho/quản lý kho, scope `all`, thấy tồn (+ giá nếu có quyền)

Dependency INLINE theo pattern các router kho hiện có. MODULE quyền = "kho".
"""
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import CurrentUser, get_authorization_service, require_permission
from ..models.role import SCOPE_ALL, SCOPE_DEPARTMENT, SCOPE_OWN
from ..models.stock_request import REQ_APPROVED, REQ_NHAP
from ..models.user import User
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.document_sequence_repo import DocumentSequenceRepository
from ..repositories.kho_gia_goc_repo import KhoGiaGocRepository
from ..repositories.kho_hang_repo import KhoHangRepository
from ..repositories.nguon_phieu_kho_repo import NguonPhieuKhoRepository
from ..repositories.org_scope import dept_subtree_ids
from ..repositories.purchase_repo import PurchaseRequestRepository
from ..repositories.rbac_repo import DepartmentRepository
from ..repositories.san_xuat_vat_tu_repo import SanXuatVatTuRepository
from ..repositories.stock_lot_repo import StockLotRepository, StockThresholdRepository
from ..repositories.stock_request_repo import NGUON_YEU_CAU, StockRequestRepository
from ..repositories.stock_voucher_repo import StockVoucherRepository
from ..repositories.don_vi_do_repo import DonViDoRepository
from ..repositories.user_repo import UserRepository
from ..repositories.vat_lieu_kho_repo import VatLieuKhoRepository
from ..schemas.stock import (
    StockRequestCreate,
    StockRequestLineOut,
    StockRequestOut,
    StockRequestPage,
    StockRequestReject,
    StockRequestUpdate,
)
from ..services.delivery_notify import kho_huy_hang_giao
from ..services.kho_giay import DON_VI_TO_KHO, co_don_vi_goc, khoa_ton_cua, la_kho_to, to_tu_kg
from ..services.kho_thanh_pham import hang_thanh_pham, id_kho_thanh_pham
from ..services.mua_cho import mua_cho_cua_dong, mua_cho_theo_dot
from ..services.quyen_kho import xem_ton_kho
from ..services.rbac_service import AuthorizationService
from ..services.san_xuat.kho import phat_su_kien_kho
from ..services.san_xuat.vat_tu_de_nghi import _can_luc_luu, _ngay_vn, can_luc_hien_thi
from ..services.sequence_service import SequenceService
from ..services.stock_request_service import (
    StockRequestConflict, StockRequestError, StockRequestService,
)
from ..services.vat_lieu_kho_service import HANG_NHAN, VatLieuKhoError, VatLieuKhoService

router = APIRouter(prefix="/api/kho/de-nghi", tags=["kho-de-nghi"])
MODULE = "kho"
#: Mốc ngày của kỳ: Ngày yêu cầu / Ngày cần / Ngày duyệt.
_MOC = "^(tao|can|duyet)$"
# Màn TỒN KHO — mỗi kho một dòng quyền `ton_kho_<id>` từ 05/10/2026 (`services/quyen_kho.py`).
# Ở router này nó CHỈ là cửa DỮ LIỆU: cột "tồn khả dụng" trên dòng yêu cầu chỉ điền cho người được
# xem số tồn của ĐÚNG KHO của yêu cầu (`xem_ton_kho`; yêu cầu chưa chọn kho thì số là gộp mọi kho
# nên phải xem được mọi kho). Một màn hỏi quyền của màn khác để hiện một CỘT là hợp lệ; cái không
# được phép là một MÀN phải nấp sau ô chi tiết của màn khác mới mở ra được.


def _la_nguoi_kho(authz, user: User) -> bool:
    """Người đứng PHÍA KHO của màn Yêu cầu nhập xuất (tab "Phiếu từ yêu cầu"), đối lại với người
    ĐI XIN (tab "Yêu cầu").

    Luật 24/09/2026, chỉ dùng hai ô của CHÍNH màn này:
      • có Thao tác (`create`) ⇒ người kho, lập được phiếu;
      • chỉ có Xem mà KHÔNG có ô chi tiết "Tạo yêu cầu" ⇒ người kho ở chế độ đọc — đúng hình vai
        **Kế toán kho** (đối chiếu sổ, không cầm hàng nên không có `create`).

    Trước đó vế thứ hai là `kho:view_stock`. Ô đó đã sang module `ton_kho` (mg `0334`), mà hộp việc
    của màn Kho thì không được đi hỏi quyền của màn Tồn kho — hỏi vậy là lại ăn ké, chỉ đổi chiều.
    """
    return authz.can(user, MODULE, "create") or (
        authz.can(user, MODULE, "read") and not authz.can(user, MODULE, "request")
    )


def _hang_service(db: Session) -> VatLieuKhoService:
    """Danh mục gốc (Giấy + Vật tư khác) — nguồn mặt hàng và nguồn quy đổi đơn vị của kho."""
    return VatLieuKhoService(VatLieuKhoRepository(db), DonViDoRepository(db))


def get_service(db: Annotated[Session, Depends(get_db)]) -> StockRequestService:
    return StockRequestService(
        StockRequestRepository(db),
        StockLotRepository(db),
        StockThresholdRepository(db),
        SequenceService(DocumentSequenceRepository(db)),
        hang=_hang_service(db),
    )


Service = Annotated[StockRequestService, Depends(get_service)]
Db = Annotated[Session, Depends(get_db)]
Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]


def _err(e: StockRequestError) -> HTTPException:
    if isinstance(e, StockRequestConflict):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


def _lenh_map(db: Session, reqs) -> dict[tuple[str, int], str]:
    """`{("lsx"|"bai_ghep", id): mã}` cho CẢ TRANG trong 2 query (mg 0175).

    Tra từng dòng là N+1 ngay trên màn Hộp yêu cầu — nơi đúng ra phải mở nhanh nhất.
    """
    from ..models.bai_ghep import BaiGhep
    from ..models.lsx import Lsx

    lsx_ids = {ln.lsx_id for r in reqs for ln in r.lines if ln.lsx_id}
    bg_ids = {ln.bai_ghep_id for r in reqs for ln in r.lines if ln.bai_ghep_id}
    ra: dict[tuple[str, int], str] = {}
    if lsx_ids:
        for i, ma in db.query(Lsx.id, Lsx.ma).filter(Lsx.id.in_(lsx_ids)):
            ra[("lsx", i)] = ma
    if bg_ids:
        for i, ma in db.query(BaiGhep.id, BaiGhep.ma).filter(BaiGhep.id.in_(bg_ids)):
            ra[("bai_ghep", i)] = ma
    return ra


def _ten_map(db: Session, reqs) -> dict[str, dict[int, str]]:
    """Tên người tạo/duyệt, bộ phận, kho (đích + nguồn) của CẢ TRANG trong 3 query.

    Tra `get_by_id` từng yêu cầu là N+1 dù cùng một người/kho: identity map của Session chỉ giữ
    tham chiếu YẾU nên object vòng trước bị dọn là vòng sau SELECT lại (đo 28/09/2026: 2 câu mỗi
    yêu cầu trên màn Hộp yêu cầu)."""
    users = UserRepository(db).map_by_ids(
        {i for r in reqs for i in (r.nguoi_tao_id, r.nguoi_duyet_id) if i})
    return {
        "user": {i: u.name for i, u in users.items()},
        "dept": DepartmentRepository(db).names_by_ids({r.bo_phan_id for r in reqs if r.bo_phan_id}),
        "kho": KhoHangRepository(db).ten_theo_ids(
            {i for r in reqs for i in (r.kho_id, getattr(r, "kho_nguon_id", None)) if i}),
        # Đợt giao mua → (id phiếu mua, mã, số đợt): ô "Nguồn" của yêu cầu nhập từ Mua hàng.
        "dot": PurchaseRequestRepository(db).ma_dot_theo_ids(
            {getattr(r, "purchase_delivery_id", None) for r in reqs}),
        # Chuyến giao → (mã lượt, mã yêu cầu giao, số đơn, khách, xe, tài xế): ô "Nguồn" + khối
        # "Giao hàng" của phiếu do Giao hàng lập.
        "giao": NguonPhieuKhoRepository(db).giao_theo_chuyen(
            {getattr(r, "delivery_trip_id", None) for r in reqs}),
        # Mặt hàng thành phẩm trên trang + id Kho thành phẩm: đề nghị có thành phẩm thì phiếu chỉ
        # lập ở kho đó (`kho_thanh_pham`) ⇒ `kho_bat_buoc_id`.
        "tp": hang_thanh_pham(db, {(ln.hang_loai, ln.hang_id) for r in reqs for ln in r.lines}),
        "kho_tp": id_kho_thanh_pham(db),
    }


def _tu_kcs(req) -> bool:
    """Yêu cầu NHẬP thành phẩm do KCS gửi — cùng dấu hiệu `nguon_lo()` dùng để gọi là lô "từ KCS"."""
    return req.loai == REQ_NHAP and getattr(req, "san_xuat_cong_viec_id", None) is not None


def _gia_kcs(db: Session, reqs) -> tuple[dict, dict]:
    """Giá gốc (đọc từ lô) + số đơn của mọi dòng KCS trong tập — 2 query cho cả trang."""
    dong = [ln for r in reqs if _tu_kcs(r) for ln in r.lines]
    if not dong:
        return {}, {}
    repo = KhoGiaGocRepository(db)
    return (repo.gia_goc_theo_dong_yc([ln.id for ln in dong]),
            repo.ma_don_theo_lsx([ln.lsx_id for ln in dong]))


def _serialize(req, *, db: Session, can_view_stock: bool, can_view_cost: bool,
               levels: dict | None,
               on_hand: dict | None,
               open_voucher_id: int | None = None,
               hang_map: dict | None = None,
               hang_svc: VatLieuKhoService | None = None,
               lenh_map: dict | None = None,
               boi_canh: dict | None = None,
               gia_kcs: tuple[dict, dict] | None = None,
               don_vi_map: dict | None = None,
               don_vi_goc_map: dict | None = None,
               ten_map: dict | None = None,
               mua_cho_map: dict | None = None) -> StockRequestOut:
    """Dựng payload + ÁP quyền hiển thị.

    `muc_ton` (đèn 5 màu) trả cho mọi vai vì không kèm con số; `ton_kha_dung` chỉ set khi
    có `can_view_stock` (từ 24/09/2026 là `ton_kho:read` — tham số giữ tên cũ vì nó chỉ là cờ
    đã tính sẵn). Mọi con số TIỀN chỉ set khi có `can_view_cost` — kể cả với người tạo
    yêu cầu (chủ 18/09/2026). Ẩn ở đây chứ không chỉ ẩn trên UI — ẩn cột ở FE thì số vẫn nằm
    trong response.

    `hang_map` ((loai,id) → bản ghi danh mục) dựng SẴN theo cả trang để tránh N+1 khi list;
    gọi lẻ 1 đề nghị thì để None, hàm tự nạp. `boi_canh` (request_id → tổ/công đoạn/giờ cần từ
    đề nghị cấp vật tư công đoạn — task-8-ruling-man-kho) và `gia_kcs` theo ĐÚNG khuôn đó.
    """
    tu_kcs = _tu_kcs(req)
    gia_goc_map, don_map = {}, {}
    if can_view_cost and tu_kcs:
        gia_goc_map, don_map = gia_kcs if gia_kcs is not None else _gia_kcs(db, [req])
    hang_svc = hang_svc or _hang_service(db)
    cap = [(ln.hang_loai, ln.hang_id) for ln in req.lines]
    if hang_map is None:
        hang_map = hang_svc.map_theo_cap(cap)
    if don_vi_map is None:
        # Bảng đơn vị + bảng cặp quy đổi đọc MỘT lần cho mọi dòng — `quy_ve_goc` từng dòng đọc lại
        # cả hai bảng mỗi dòng (N+1, khoảng 3 câu SQL/dòng trên màn Hộp yêu cầu).
        don_vi_map = hang_svc.don_vi_nhieu_mat_hang(cap, san=hang_map)
    if don_vi_goc_map is None:
        don_vi_goc_map = _don_vi_goc_map(hang_svc, [req])
    if lenh_map is None:
        lenh_map = _lenh_map(db, [req])
    if boi_canh is None:
        boi_canh = SanXuatVatTuRepository(db).boi_canh_san_xuat([req.id])
    bc = boi_canh.get(req.id) or {}
    dot_id = getattr(req, "purchase_delivery_id", None)
    if mua_cho_map is None:
        mua_cho_map = mua_cho_theo_dot(db, [dot_id])
    mc_hang = mua_cho_map.get(dot_id) if dot_id else None
    lines: list[StockRequestLineOut] = []
    for ln in req.lines:
        key = (ln.hang_loai, ln.hang_id)
        m = hang_map.get(key)
        # Quy đổi để FE hiện "10 ram ≈ 419,25 kg" ngay dưới ô SL — người khai thấy TRƯỚC con số
        # sẽ vào tồn, thay vì bấm Lưu rồi mới biết. Không đổi được thì trả `canh_bao_dv` nguyên
        # văn lý do chứ không im lặng.
        qd, canh_bao, quy_to = None, None, {}
        try:
            dv = don_vi_map.get(key)
            # Món vắng trong map (không tồn tại / loại sai) đi đường lẻ cũ để giữ ĐÚNG câu lỗi.
            # Giấy / vật tư: gốc theo ĐƠN VỊ GỐC của dòng (đơn vị đã khai), không phải ĐVT chính.
            if (ln.hang_loai == "giay" and ln.don_vi_goc == DON_VI_TO_KHO and dv is not None
                    and la_kho_to(ln.kho_rong, ln.kho_dai)
                    and (hang_svc.quy_tu_don_vi(dv, ln.dvt, 1)["don_vi_goc"] or "").lower() == "kg"):
                # Giấy khổ hai cạnh khai kg: gốc tờ, quy theo khổ + gsm (spec 2026-10-24 §5) — cùng
                # số với lúc ghi sổ (`quy_ve_goc`), không thêm lượt đọc danh mục.
                kg = hang_svc.quy_tu_don_vi(dv, ln.dvt, float(ln.sl_de_nghi))
                so_to = to_tu_kg(kg["sl_goc"], ln.kho_rong, ln.kho_dai, getattr(m, "gsm", 0))
                qd = {**kg, "sl_goc": float(so_to), "don_vi_goc": DON_VI_TO_KHO, "don_vi_goc_ten": "tờ",
                      "he_so_ve_goc": so_to / float(ln.sl_de_nghi)}
                quy_to = {"kg_moi_dvt": kg["sl_goc"] / float(ln.sl_de_nghi), "gsm": int(m.gsm)}
            elif co_don_vi_goc(ln.hang_loai) and ln.don_vi_goc:
                dvg = don_vi_goc_map.get((ln.hang_loai, ln.hang_id, ln.don_vi_goc))
                qd = (hang_svc.quy_tu_don_vi(dvg, ln.dvt, float(ln.sl_de_nghi)) if dvg is not None
                      else hang_svc.quy_ve_goc(ln.hang_loai, ln.hang_id, ln.dvt,
                                               float(ln.sl_de_nghi), goc=ln.don_vi_goc))
            else:
                qd = (hang_svc.quy_tu_don_vi(dv, ln.dvt, float(ln.sl_de_nghi)) if dv is not None
                      else hang_svc.quy_ve_goc(ln.hang_loai, ln.hang_id, ln.dvt,
                                               float(ln.sl_de_nghi)))
        except (VatLieuKhoError, ValueError) as e:
            canh_bao = str(e)
        mc = mua_cho_cua_dong(mc_hang, ln.hang_loai, ln.hang_id, ln.kho_rong, ln.kho_dai)
        lines.append(StockRequestLineOut(
            id=ln.id,
            hang_loai=ln.hang_loai,
            hang_id=ln.hang_id,
            hang_ma=getattr(m, "ma", None),
            hang_ten=getattr(m, "ten", None),
            hang_anh=getattr(m, "anh_url", None),
            hang_nhom=HANG_NHAN.get(ln.hang_loai),
            lsx_id=ln.lsx_id,
            bai_ghep_id=ln.bai_ghep_id,
            lsx_ma=lenh_map.get(("lsx", ln.lsx_id)),
            bai_ghep_ma=lenh_map.get(("bai_ghep", ln.bai_ghep_id)),
            dvt=ln.dvt,
            kho_rong=int(ln.kho_rong or 0), kho_dai=int(ln.kho_dai or 0),
            # MÃ đơn vị gốc (FE đổi ra tên bằng danh mục đơn vị; khoá tồn giấy / vật tư đọc mã này).
            don_vi_goc=((ln.don_vi_goc or None) if co_don_vi_goc(ln.hang_loai) else None)
            or (qd or {}).get("don_vi_goc"),
            # Tên để bày; quy đổi hỏng thì lùi về chính mã (giấy cũ chưa có tên trong danh mục).
            don_vi_goc_ten=(qd or {}).get("don_vi_goc_ten")
            or (((ln.don_vi_goc or None) if co_don_vi_goc(ln.hang_loai) else None)),
            sl_quy_doi=(qd or {}).get("sl_goc"),
            quy_doi_dien_giai=(qd or {}).get("dien_giai"),
            **quy_to,
            canh_bao_dv=canh_bao,
            sl_de_nghi=float(ln.sl_de_nghi),
            sl_duyet=float(ln.sl_duyet),
            sl_da_ung=float(ln.sl_da_ung),
            sl_con_lai=StockRequestService.con_lai(ln),
            sl_chot_thuc_xuat=(float(ln.sl_chot_thuc_xuat)
                               if ln.sl_chot_thuc_xuat is not None else None),
            don_gia=ln.don_gia if can_view_cost else None,
            tu_kcs=tu_kcs,
            gia_goc=(gia_goc_map.get(ln.id) or (None, None))[0],
            tien_goc=(gia_goc_map.get(ln.id) or (None, None))[1],
            don_gia_ban=(int(ln.don_gia_ban)
                         if can_view_cost and ln.don_gia_ban is not None else None),
            don_ban_ma=don_map.get(ln.lsx_id) if ln.lsx_id else None,
            mua_cho=mc["lenh"], loai_mua_cac=mc["loai_mua_cac"],
            ly_do_thieu=ln.ly_do_thieu,
            ghi_chu=ln.ghi_chu,
            muc_ton=(levels or {}).get(khoa_ton_cua(ln)),
            ton_kha_dung=(on_hand or {}).get(khoa_ton_cua(ln)) if can_view_stock else None,
        ))
    if ten_map is None:
        ten_map = _ten_map(db, [req])
    # ĐIỀU CHUYỂN: yêu cầu NHẬP đích có `kho_nguon_id` → hiện "Điều chuyển từ «kho nguồn»".
    kho_nguon_id = getattr(req, "kho_nguon_id", None)
    dot = ten_map.get("dot", {}).get(getattr(req, "purchase_delivery_id", None))
    trip_id = getattr(req, "delivery_trip_id", None)
    giao = ten_map.get("giao", {}).get(trip_id) if trip_id else None
    return StockRequestOut(
        id=req.id, ma=req.ma, loai=req.loai,
        nguoi_tao_id=req.nguoi_tao_id,
        nguoi_tao_ten=ten_map["user"].get(req.nguoi_tao_id),
        bo_phan_id=req.bo_phan_id, bo_phan_ten=ten_map["dept"].get(req.bo_phan_id),
        kho_id=req.kho_id, kho_ten=ten_map["kho"].get(req.kho_id),
        ngay_can=req.ngay_can, uu_tien=req.uu_tien,
        ghi_chu=req.ghi_chu, loai_kho=req.loai_kho, trang_thai=req.trang_thai,
        nguoi_duyet_id=req.nguoi_duyet_id,
        nguoi_duyet_ten=ten_map["user"].get(req.nguoi_duyet_id),
        duyet_luc=req.duyet_luc, ly_do_tu_choi=req.ly_do_tu_choi,
        ly_do_huy=req.ly_do_huy,
        open_voucher_id=open_voucher_id,
        dieu_chuyen=bool(getattr(req, "dieu_chuyen", False)),
        nhap_tay=bool(getattr(req, "nhap_tay", False)),
        kho_nguon_id=kho_nguon_id,
        kho_nguon_ten=ten_map["kho"].get(kho_nguon_id),
        xuat_voucher_id=getattr(req, "xuat_voucher_id", None),
        purchase_delivery_id=getattr(req, "purchase_delivery_id", None),
        don_mua_id=dot[0] if dot else None, don_mua_ma=dot[1] if dot else None,
        dot_so=dot[2] if dot else None,
        delivery_trip_id=trip_id,
        giao_luot_ma=giao[0] if giao else None,
        giao_yeu_cau_ma=giao[1] if giao else None,
        giao_don_ma=giao[2] if giao else None,
        giao_khach_ten=giao[3] if giao else None,
        giao_xe_bien_so=giao[4] if giao else None,
        giao_tai_xe_ten=giao[5] if giao else None,
        kho_bat_buoc_id=(ten_map.get("kho_tp") if not getattr(req, "dieu_chuyen", False) and any(
            (ln.hang_loai, ln.hang_id) in ten_map.get("tp", ()) for ln in req.lines) else None),
        # Gỡ nhãn UTC trước khi ra JSON: Postgres trả `can_luc` AWARE, còn FE (`fmtGioCan`,
        # `isOverdue`) đọc naive = giờ NHÀ MÁY — để nguyên là thủ kho thấy giờ cần lệch +7h.
        can_luc=can_luc_hien_thi(getattr(req, "can_luc", None) or bc.get("can_luc")),
        san_xuat_cong_viec_id=bc.get("cong_viec_id"),
        san_xuat_cong_doan_ten=bc.get("cong_doan_ten"),
        san_xuat_tu_lap=bool(bc.get("tu_lap")),
        san_xuat_lenh_thu_hoi=bool(bc.get("lenh_thu_hoi")),
        gia_cong_ngoai_id=getattr(req, "gia_cong_ngoai_id", None),
        created_at=req.created_at, updated_at=req.updated_at, lines=lines,
    )


def _don_vi_goc_map(hang_svc: VatLieuKhoService, reqs) -> dict:
    """Đơn vị của mọi dòng giấy / vật tư CÓ đơn vị gốc, theo `(loại, mã, gốc)`, một lượt cho cả
    trang. Quy đổi từng dòng đọc lại bảng đơn vị + cặp quy đổi mỗi dòng (N+1, ~3 câu SQL/dòng).
    Bộ không dựng được thì vắng mặt ⇒ dòng đó đi `quy_ve_goc` lẻ để giữ ĐÚNG câu lỗi."""
    khoa = {(ln.hang_loai, ln.hang_id, ln.don_vi_goc) for r in reqs for ln in r.lines
            if co_don_vi_goc(ln.hang_loai) and ln.don_vi_goc}
    if not khoa:
        return {}
    return {k: v for k, v in hang_svc.don_vi_nhieu_theo_goc(khoa).items() if v is not None}


def _levels(svc: StockRequestService, req):
    """TỒN KHẢ DỤNG + đèn (`muc_ton`) cho các dòng của yêu cầu. Yêu cầu KHÔNG gắn kho (kho quyết ở
    bước lập phiếu) → `req.kho_id` thường None → `on_hand_map` cộng tồn khả dụng TRÊN MỌI KHO.
    `levels_and_on_hand` tính CẢ đèn lẫn tồn trong 1 lượt: đèn theo ngưỡng của kho (kho_id None thì
    chưa có ngưỡng → chỉ phân biệt hết/còn). UI đã bỏ cột đèn nên không nhiễu, nhưng GIỮ `muc_ton`
    cho API/test (bỏ hẳn làm vỡ test đèn + mất tín hiệu cho ai còn dùng)."""
    # Giấy đọc tồn ĐÚNG khổ + đơn vị gốc của dòng — khoá của chính dòng.
    return svc.levels_and_on_hand([khoa_ton_cua(ln) for ln in req.lines], req.kho_id)


def _scoped_filters(db: Session, user: User, authz: AuthorizationService) -> dict:
    """Dịch scope của vai trò thành bộ lọc list (16/09/2026).

    Yêu cầu do CHÍNH MÌNH tạo luôn hiện, bất kể scope — bộ phận của yêu cầu không phải lúc nào
    cũng là phòng người tạo (Bàn tổ gắn TỔ của công đoạn). `department` = phòng mình + TOÀN BỘ cây
    con, đúng nghĩa `org_scope` các module khác đang dùng. `own` vẫn là cách người yêu cầu bị chặn
    khỏi kho: không có đường nào nhìn thấy yêu cầu/tồn của người khác.
    """
    scope = authz.scope_for(user, MODULE) or SCOPE_OWN
    if scope == SCOPE_ALL:
        return {}
    if scope == SCOPE_DEPARTMENT:
        return {"pham_vi_nguoi_tao_id": user.id,
                "pham_vi_bo_phan_ids": dept_subtree_ids(db, user.department_id)}
    return {"pham_vi_nguoi_tao_id": user.id}


def _require_visible(db: Session, req, user: User, authz: AuthorizationService) -> None:
    """404 (không phải 403) khi yêu cầu nằm ngoài scope — không tiết lộ là nó có tồn tại.
    Cùng luật với `_scoped_filters`: thấy trong danh sách thì mở được."""
    scope = authz.scope_for(user, MODULE) or SCOPE_OWN
    if scope == SCOPE_ALL or req.nguoi_tao_id == user.id:
        return
    if scope == SCOPE_DEPARTMENT and req.bo_phan_id in dept_subtree_ids(db, user.department_id):
        return
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy yêu cầu")


@router.get("", response_model=StockRequestPage)
def list_requests(
    svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    loai: str | None = Query(default=None),
    trang_thai: list[str] | None = Query(default=None),
    kho_id: int | None = Query(default=None, description="Lọc yêu cầu theo kho đích"),
    dieu_chuyen: bool | None = Query(
        default=None, description="True = chỉ yêu cầu điều chuyển · False = nhập/xuất thường"),
    q: str | None = Query(default=None),
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query(default="tao", pattern=_MOC),
    bo_phan: int | None = Query(default=None, description="Điều kiện Phòng ban yêu cầu"),
    to: int | None = Query(
        default=None, description="Điều kiện Tổ: tổ của công việc gắn yêu cầu, hoặc phòng đứng tên"),
    nguoi_yeu_cau: list[int] | None = Query(default=None),
    kho: int | None = Query(default=None, description="Điều kiện Kho: gắn kho hoặc có phiếu ở kho"),
    nguon: list[str] | None = Query(default=None, description="Điều kiện Nguồn (NGUON_YEU_CAU)"),
    lenh: int | None = Query(default=None, description="Điều kiện Lệnh: dòng gắn lệnh hoặc bài chứa lệnh"),
    vat_tu: list[str] | None = Query(default=None, description='Điều kiện Vật tư: "giay:12", "vat_tu:5"'),
    order: str = Query(default="id", pattern="^(id|updated)$"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
) -> StockRequestPage:
    rows, total = svc.requests.list(
        loai=loai, trang_thai=trang_thai, q=q, kho_id=kho_id, dieu_chuyen=dieu_chuyen,
        tu_ngay=tu_ngay, den_ngay=den_ngay, moc=moc, bo_phan_id=bo_phan, to_loc=to,
        nguoi_tao_ids=nguoi_yeu_cau, kho_loc=kho, nguon=nguon, lenh_loc=lenh, vat_tu_loc=vat_tu,
        order=order, page=page, size=size,
        **_scoped_filters(db, user, authz),
    )
    can_view_cost = authz.can(user, MODULE, "view_cost")
    draft_map = StockVoucherRepository(db).draft_ids_by_request([r.id for r in rows])
    # Nạp SẴN mọi mã hàng của cả trang trong 1 query (tránh N+1 trong _serialize).
    hang_svc = _hang_service(db)
    cap_trang = [(ln.hang_loai, ln.hang_id) for r in rows for ln in r.lines]
    hang_map = hang_svc.map_theo_cap(cap_trang)
    don_vi_map = hang_svc.don_vi_nhieu_mat_hang(cap_trang, san=hang_map)
    don_vi_goc_map = _don_vi_goc_map(hang_svc, rows)
    lenh_map = _lenh_map(db, rows)
    ten_map = _ten_map(db, rows)
    # Tổ/công đoạn/giờ cần (đề nghị cấp vật tư công đoạn) của CẢ TRANG trong 1 query — tránh N+1
    # trên đường mở màn chính của thủ kho (task-8-ruling-man-kho, Ruling 32/34).
    boi_canh = SanXuatVatTuRepository(db).boi_canh_san_xuat([r.id for r in rows])
    gia_kcs = _gia_kcs(db, rows) if can_view_cost else ({}, {})
    mua_cho_map = mua_cho_theo_dot(db, [getattr(r, "purchase_delivery_id", None) for r in rows])
    items = []
    xem_ton: dict[int | None, bool] = {}  # theo kho — cả trang chỉ vài kho, khỏi hỏi lại từng dòng
    for r in rows:
        if r.kho_id not in xem_ton:
            xem_ton[r.kho_id] = xem_ton_kho(db, authz, user, r.kho_id)
        # List KHÔNG hiện tồn khả dụng/đèn (chỉ drawer chi tiết hiện) → khỏi tính, tránh N+1 query.
        levels, on_hand = None, None
        items.append(_serialize(r, db=db, can_view_stock=xem_ton[r.kho_id],
                                can_view_cost=can_view_cost,
                                levels=levels, on_hand=on_hand, lenh_map=lenh_map,
                                open_voucher_id=draft_map.get(r.id), hang_map=hang_map,
                                hang_svc=hang_svc, boi_canh=boi_canh, gia_kcs=gia_kcs,
                                don_vi_map=don_vi_map, don_vi_goc_map=don_vi_goc_map,
                                ten_map=ten_map, mua_cho_map=mua_cho_map))
    return StockRequestPage(items=items, total=total)


@router.get("/counts")
def request_counts(
    svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> dict[str, int]:
    """Số yêu cầu ĐÃ DUYỆT chờ kho lập phiếu, theo chiều. Badge "chờ cấp" là VIỆC CỦA KHO nên CHỈ
    hiện cho NGƯỜI KHO (`_la_nguoi_kho`) — khớp đúng người nhận thông báo;
    người chỉ TẠO yêu cầu (vd tổ trưởng SX) KHÔNG thấy badge. Trong tầm thì lọc theo SCOPE như list:
    kho trung tâm (all) thấy tổng; phòng ban thấy của phòng; scope own thấy của mình."""
    # `done_unseen` / `fail_unseen` = phản hồi kho (yêu cầu HOÀN TẤT / KHÔNG THÀNH) của CHÍNH user mà
    # user chưa mở xem — KHÔNG lọc theo scope xử-lý (việc của NGƯỜI TẠO, không phải workload kho).
    # Người chỉ tạo yêu cầu vẫn nhận số này dù nhap/xuat = 0. Badge người tạo = done + fail.
    resp = svc.requests.unseen_response_counts(user.id)
    is_kho_worker = _la_nguoi_kho(authz, user)
    if not is_kho_worker:
        return {"nhap": 0, "xuat": 0, "dieu_chuyen": 0,
                "done_unseen": resp["done"], "fail_unseen": resp["fail"]}
    counts = svc.requests.count_by_loai([REQ_APPROVED], **_scoped_filters(db, user, authz))
    return {
        "nhap": counts["nhap"],
        "xuat": counts["xuat"],
        "dieu_chuyen": counts["dieu_chuyen"],
        "done_unseen": resp["done"],
        "fail_unseen": resp["fail"],
    }


@router.get("/counts-by-status")
def request_counts_by_status(
    svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    loai: str | None = Query(default=None),
    trang_thai: list[str] | None = Query(default=None, description="Tập nền trạng thái (vd INBOX)"),
    kho_id: int | None = Query(default=None),
    dieu_chuyen: bool | None = Query(default=None),
    q: str | None = Query(default=None),
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query(default="tao", pattern=_MOC),
    bo_phan: int | None = Query(default=None),
    to: int | None = Query(default=None),
    nguoi_yeu_cau: list[int] | None = Query(default=None),
    kho: int | None = Query(default=None),
    nguon: list[str] | None = Query(default=None),
    lenh: int | None = Query(default=None),
    vat_tu: list[str] | None = Query(default=None),
) -> dict[str, int]:
    """Đếm yêu cầu theo TỪNG trạng thái (áp cùng bộ lọc list, TRỪ tab) → FE cộng theo tab cho badge.
    Trả {trang_thai: số}. Áp SCOPE như list để badge khớp đúng danh sách người dùng thấy."""
    return svc.requests.count_by_status(
        loai=loai, base_trang_thai=trang_thai, kho_id=kho_id, dieu_chuyen=dieu_chuyen, q=q,
        tu_ngay=tu_ngay, den_ngay=den_ngay, moc=moc, bo_phan_id=bo_phan, to_loc=to,
        nguoi_tao_ids=nguoi_yeu_cau, kho_loc=kho, nguon=nguon, lenh_loc=lenh, vat_tu_loc=vat_tu,
        **_scoped_filters(db, user, authz),
    )


def _loc_nen(db: Session, user: User, authz: AuthorizationService, loai: str | None,
             dieu_chuyen: bool | None) -> dict:
    """Tầm của các danh sách giá trị lọc: đúng phạm vi + chiều + nhóm điều chuyển của màn gọi."""
    return {"loai": loai, "dieu_chuyen": dieu_chuyen, **_scoped_filters(db, user, authz)}


@router.get("/loc-bo-phan")
def loc_bo_phan(
    svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    loai: str | None = Query(default=None),
    dieu_chuyen: bool | None = Query(default=None),
) -> list[dict]:
    """Giá trị điều kiện "Phòng ban yêu cầu": phòng ban có yêu cầu trong tầm nhìn, kèm số."""
    dem = svc.requests.dem_theo_cot("bo_phan_id", **_loc_nen(db, user, authz, loai, dieu_chuyen))
    ten = DepartmentRepository(db).names_by_ids(i for i, _ in dem)   # một câu cho cả ô lọc
    ra = [{"id": i, "ten": ten.get(i) or f"#{i}", "so": n} for i, n in dem]
    return sorted(ra, key=lambda d: d["ten"])


@router.get("/loc-to")
def loc_to(
    svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    loai: str | None = Query(default=None),
    dieu_chuyen: bool | None = Query(default=None),
) -> list[dict]:
    """Giá trị điều kiện "Tổ": CHỈ tổ sản xuất (spec 2026-10-18 §5.4), số đếm theo tổ của công
    việc gắn yêu cầu cộng phòng đứng tên — cùng luật với lọc `to`."""
    to = {d.id: d.name for d in DepartmentRepository(db).to_san_xuat()}
    dem = svc.requests.dem_theo_to(**_loc_nen(db, user, authz, loai, dieu_chuyen))
    ra = [{"id": i, "ten": to[i], "so": n} for i, n in dem if i in to]
    return sorted(ra, key=lambda d: d["ten"])


@router.get("/loc-nguoi-yeu-cau")
def loc_nguoi_yeu_cau(
    svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    loai: str | None = Query(default=None),
    dieu_chuyen: bool | None = Query(default=None),
) -> list[dict]:
    """Giá trị điều kiện "Người yêu cầu": người đã tạo yêu cầu trong tầm nhìn, kèm số."""
    dem = svc.requests.dem_theo_cot("nguoi_tao_id", **_loc_nen(db, user, authz, loai, dieu_chuyen))
    nguoi = UserRepository(db).get_many(i for i, _ in dem)   # một câu cho cả ô lọc
    ra = [{"id": i, "ten": getattr(nguoi.get(i), "name", None) or f"#{i}", "so": n}
          for i, n in dem]
    return sorted(ra, key=lambda d: d["ten"])


@router.get("/loc-kho")
def loc_kho(
    svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    loai: str | None = Query(default=None),
    dieu_chuyen: bool | None = Query(default=None),
) -> list[dict]:
    """Giá trị điều kiện "Kho": mọi kho đang dùng, kèm số yêu cầu gắn kho đó hoặc có phiếu ở đó.
    Kho không có yêu cầu nào thì bỏ (chọn vào chỉ ra danh sách trống)."""
    # Đếm GỘP mọi kho một câu (trước 26/10/2026: mỗi kho một câu COUNT).
    dem = svc.requests.dem_theo_kho(**_loc_nen(db, user, authz, loai, dieu_chuyen))
    ra = []
    for kid, ten in KhoHangRepository(db).dang_dung():
        n = dem.get(kid, 0)
        if n:
            ra.append({"id": kid, "ten": ten, "so": n})
    return ra


@router.get("/loc-lenh")
def loc_lenh(
    svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    loai: str | None = Query(default=None),
    dieu_chuyen: bool | None = Query(default=None),
) -> list[dict]:
    """Giá trị điều kiện "Lệnh": lệnh có yêu cầu trong tầm nhìn (dòng gắn lệnh, hay gắn bài ghép
    chứa lệnh), kèm số. Mới nhất lên đầu — kho thường tìm lệnh đang chạy."""
    from ..models.lsx import Lsx

    dem = dict(svc.requests.dem_theo_lenh(**_loc_nen(db, user, authz, loai, dieu_chuyen)))
    if not dem:
        return []
    rows = db.execute(select(Lsx.id, Lsx.ma, Lsx.ten).where(Lsx.id.in_(dem))).all()
    ra = [{"id": i, "ten": ma or f"#{i}", "phu": ten or None, "so": dem[i]} for i, ma, ten in rows]
    return sorted(ra, key=lambda d: -d["id"])


@router.get("/loc-vat-tu")
def loc_vat_tu(
    svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    loai: str | None = Query(default=None),
    dieu_chuyen: bool | None = Query(default=None),
) -> list[dict]:
    """Giá trị điều kiện "Vật tư": mã hàng xuất hiện ở dòng yêu cầu trong tầm nhìn, kèm số. Khoá
    `"<hang_loai>:<hang_id>"` — hai danh mục có hai dãy id riêng."""
    dem = svc.requests.dem_theo_vat_tu(**_loc_nen(db, user, authz, loai, dieu_chuyen))
    hang_map = _hang_service(db).map_theo_cap([cap for cap, _n in dem])
    ra = []
    for (l, i), n in dem:
        m = hang_map.get((l, i))
        ra.append({"id": f"{l}:{i}", "ten": getattr(m, "ten", None) or f"#{i}",
                   "phu": getattr(m, "ma", None), "so": n})
    return sorted(ra, key=lambda d: d["ten"])


#: Nhãn điều kiện "Nguồn" — trùng chữ ô Nguồn trên danh sách.
_NHAN_NGUON = {
    "mua_hang": "Mua hàng", "dieu_chuyen": "Điều chuyển", "giao_hang": "Giao hàng", "kcs": "KCS",
    "gia_cong": "Gia công ngoài", "san_xuat": "Lệnh sản xuất", "khong": "Không nguồn",
}


@router.get("/loc-nguon")
def loc_nguon(
    svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    loai: str | None = Query(default=None),
    dieu_chuyen: bool | None = Query(default=None),
) -> list[dict]:
    """Giá trị điều kiện "Nguồn": nguồn có yêu cầu trong tầm nhìn, kèm số; nguồn trống thì bỏ."""
    nen = _loc_nen(db, user, authz, loai, dieu_chuyen)
    ra = []
    for n in NGUON_YEU_CAU:
        so = svc.requests.dem(nguon=[n], **nen)
        if so:
            ra.append({"id": n, "ten": _NHAN_NGUON[n], "so": so})
    return ra


@router.post("/seen-all", status_code=204)
def mark_all_requests_seen(
    svc: Service,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
):
    """NGƯỜI TẠO mở màn danh sách yêu cầu → mọi phản hồi kho (Hoàn tất / Không thành) của họ thành
    đã xem: nhìn thấy bản ghi là mất dấu, không bắt mở từng yêu cầu."""
    svc.requests.mark_seen_all(user.id)


@router.post("/{request_id}/seen", status_code=204)
def mark_request_seen(
    request_id: int,
    svc: Service,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
):
    """NGƯỜI TẠO mở xem 1 yêu cầu của mình → đánh dấu đã xem → hạ badge/số đỏ đúng yêu cầu đó.
    Chỉ tác dụng lên yêu cầu do chính user tạo (repo lọc theo nguoi_tao_id)."""
    svc.requests.mark_seen_one(request_id, user.id)


# GỠ 2026-08-08 — ba cửa cũ: `GET /vat-tu` (tìm trong bảng `materials`), `POST /vat-tu` (kho tự
# tạo mã hàng), `PUT /vat-tu/{id}/quy-doi` (khai hệ số riêng cho kho). Picker mặt hàng giờ dùng
# `GET /api/vat-lieu-kho/mat-hang`, đơn vị dùng `.../mat-hang/{loai}/{id}/don-vi`.


@router.get("/{request_id}", response_model=StockRequestOut)
def get_request(
    request_id: int, svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> StockRequestOut:
    req = svc.requests.get_with_lines(request_id)
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy yêu cầu")
    _require_visible(db, req, user, authz)
    levels, on_hand = _levels(svc, req)
    draft_map = StockVoucherRepository(db).draft_ids_by_request([req.id])
    return _serialize(req, db=db, can_view_stock=xem_ton_kho(db, authz, user, req.kho_id),
                      can_view_cost=authz.can(user, MODULE, "view_cost"),
                      levels=levels, on_hand=on_hand,
                      open_voucher_id=draft_map.get(req.id))


@router.get("/{request_id}/goi-y-kho")
def suggest_kho(
    request_id: int, svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> dict:
    """Gợi ý 'Kho (xuất từ)' cho phiếu XUẤT: kho có nhiều hàng nhất theo thứ tự dòng yêu cầu.
    `kho_id=None` = không kho nào còn hàng → FE giữ nguyên kho đang chọn."""
    req = svc.requests.get_with_lines(request_id)
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy yêu cầu")
    _require_visible(db, req, user, authz)
    return {"kho_id": svc.goi_y_kho_xuat(req)}


@router.post("", response_model=StockRequestOut, status_code=status.HTTP_201_CREATED)
def create_request(
    payload: StockRequestCreate, svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "request"))],
) -> StockRequestOut:
    # Có GIỜ cần thì ngày cần là ngày của chính giờ đó (cùng khuôn đề nghị của tổ sản xuất).
    can_luc = _can_luc_luu(payload.can_luc) if payload.can_luc else None
    ngay_can = _ngay_vn(payload.can_luc) if payload.can_luc else payload.ngay_can
    try:
        req = svc.create(
            user=user, loai=payload.loai, kho_id=payload.kho_id, ma=payload.ma,
            lines=[ln.model_dump() for ln in payload.lines],
            ngay_can=ngay_can, can_luc=can_luc, uu_tien=payload.uu_tien, ghi_chu=payload.ghi_chu,
            loai_kho=payload.loai_kho, purchase_delivery_id=payload.purchase_delivery_id,
            chong_gui_lai=True, kho_to_bat_buoc=True,
        )
    except StockRequestError as e:
        raise _err(e) from None
    levels, on_hand = _levels(svc, req)
    return _serialize(req, db=db, can_view_stock=xem_ton_kho(db, authz, user, req.kho_id),
                      can_view_cost=authz.can(user, MODULE, "view_cost"),
                      levels=levels, on_hand=on_hand)


@router.put("/{request_id}", response_model=StockRequestOut)
def update_request(
    request_id: int, payload: StockRequestUpdate, svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "request"))],
) -> StockRequestOut:
    req = svc.requests.get_with_lines(request_id)
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy yêu cầu")
    if req.nguoi_tao_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Chỉ người tạo mới sửa được yêu cầu")
    data = payload.model_dump(exclude_unset=True, exclude={"lines"})
    if "can_luc" in data:
        # Đổi/xoá giờ cần: ngày cần đi theo giờ; xoá giờ (null) thì chỉ xoá giờ, ngày giữ nguyên.
        gio = data["can_luc"]
        data["can_luc"] = _can_luc_luu(gio) if gio else None
        if gio:
            data["ngay_can"] = _ngay_vn(gio)
    lines = [ln.model_dump() for ln in payload.lines] if payload.lines is not None else None
    if lines is not None and not authz.can(user, MODULE, "view_cost"):
        # Không thấy giá thì form gửi lên không có giá — ghi thẳng là xoá mất giá đang có.
        cu = {(ln.hang_loai, ln.hang_id, ln.lsx_id, ln.bai_ghep_id): ln.don_gia for ln in req.lines}
        for ln in lines:
            ln["don_gia"] = cu.get((ln["hang_loai"], ln["hang_id"], ln.get("lsx_id"),
                                    ln.get("bai_ghep_id")))
    try:
        req = svc.update(req, lines=lines, kho_to_bat_buoc=True, **data)
    except StockRequestError as e:
        raise _err(e) from None
    return _serialize(req, db=db, can_view_stock=xem_ton_kho(db, authz, user, req.kho_id),
                      can_view_cost=authz.can(user, MODULE, "view_cost"),
                      levels=None, on_hand=None)


def _act(svc: StockRequestService, request_id: int, user: User, authz: AuthorizationService,
         db: Session, fn, *, bao_nguoi_tao: bool = False) -> StockRequestOut:
    req = svc.requests.get_with_lines(request_id)
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy yêu cầu")
    try:
        req = fn(req)
    except StockRequestError as e:
        raise _err(e) from None
    # Yêu cầu nhập thành phẩm từ KCS: màn KCS / hồ sơ lệnh đọc ngược yêu cầu này ⇒ đẩy ngay.
    phat_su_kien_kho(req, bao_nguoi_tao=bao_nguoi_tao)
    return _serialize(req, db=db, can_view_stock=xem_ton_kho(db, authz, user, req.kho_id),
                      can_view_cost=authz.can(user, MODULE, "view_cost"),
                      levels=None, on_hand=None)


@router.post("/{request_id}/trinh-duyet", response_model=StockRequestOut)
def submit(request_id: int, svc: Service, db: Db, authz: Authz,
           user: Annotated[User, Depends(require_permission(MODULE, "request"))]):
    return _act(svc, request_id, user, authz, db, svc.submit)


# Yêu cầu BỎ BƯỚC DUYỆT (chủ 06/08/2026): tạo là 'approved' luôn (xem service.create). Không còn
# ai duyệt/từ chối → gỡ 2 endpoint `/duyet` và `/tu-choi`. Service `approve`/`reject` GIỮ lại (không
# gọi từ đâu nữa) để khỏi đụng thêm; nhưng KHÔNG để endpoint mồ côi require `approve`.


@router.post("/{request_id}/huy", response_model=StockRequestOut)
def cancel(request_id: int, svc: Service, db: Db, authz: Authz,
           user: Annotated[User, Depends(require_permission(MODULE, "request"))]):
    req = svc.requests.get(request_id)
    if req is not None and req.nguoi_tao_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Chỉ người tạo mới hủy được yêu cầu")
    return _act(svc, request_id, user, authz, db, svc.cancel)


@router.post("/{request_id}/huy-kho", response_model=StockRequestOut)
def cancel_kho(request_id: int, payload: StockRequestReject, svc: Service, db: Db, authz: Authz,
               user: Annotated[User, Depends(require_permission(MODULE, "create"))]):
    """Kho HỦY yêu cầu (quyết định KHÔNG lập phiếu) — kèm lý do; gate bằng `create` (quyền lập
    phiếu), KHÔNG cần là người tạo. Yêu cầu chuyển 'Đã hủy'; số đã cấp bởi phiếu đã ghi sổ (nếu
    có) vẫn giữ nguyên trong kho."""
    ra = _act(svc, request_id, user, authz, db, lambda r: svc.cancel_by_kho(r, payload.ly_do),
              bao_nguoi_tao=True)
    # Đề nghị xuất của chuyến giao: chuyến rời "Chờ kho xuất", Giao hàng được báo (#32).
    kho_huy_hang_giao(db, request_id, actor=user)
    return ra


@router.post("/{request_id}/tiep-nhan", response_model=StockRequestOut)
def receive(request_id: int, svc: Service, db: Db, authz: Authz,
            user: Annotated[User, Depends(require_permission(MODULE, "create"))]):
    """Kho bấm 'Tiếp nhận'. Gate bằng `create` (= quyền lập phiếu) chứ không phải `approve`
    — kho KHÔNG duyệt, chỉ nhận việc (BRD §2.6 b8)."""
    return _act(svc, request_id, user, authz, db, svc.mark_received)


@router.post("/{request_id}/chuan-bi", response_model=StockRequestOut)
def prepare(request_id: int, svc: Service, db: Db, authz: Authz,
            user: Annotated[User, Depends(require_permission(MODULE, "create"))]):
    return _act(svc, request_id, user, authz, db, svc.mark_preparing)


@router.get("/goi-y/so-luong")
def suggest_qty(
    svc: Service, user: CurrentUser,
    _: Annotated[User, Depends(require_permission(MODULE, "request"))],
    hang_loai: str = Query(...),
    hang_id: int = Query(..., gt=0),
):
    """Gợi ý số lượng từ lịch sử đề nghị của bộ phận (spec §8). Không đụng tới tồn nên
    người đề nghị gọi được mà không lộ gì."""
    return {"so_luong": svc.suggest_quantity((hang_loai, hang_id), user.department_id)}
