"""Router **Xếp lịch** — bàn xếp lịch cấp LỆNH SẢN XUẤT.

Prefix `/api/xep-lich`. RBAC MODULE = "xep_lich".

Tên cũ là "Xếp lịch 3" (`/api/xep-lich-3`, quyền `xep_lich_3`); 18/09/2026 chủ dự án chốt bỏ đánh
số — bàn theo công đoạn (`xep_lich_2`) xoá hẳn, bàn này về đúng tên `xep_lich`. Quyền chép sang ở
mg `0314`, dấu trang cũ `/xep-lich-3` không còn dùng được.

Bàn HẸN ĐẨY (08/11/2026, thay Gantt kéo thả): `/ban` đọc bốn tab, `POST /hen` hẹn giờ đẩy, tới giờ
vòng nền `hen_day.run_tu_day_loop` tự đẩy bằng quyền người hẹn; `POST /day-ngay` đẩy liền. Thu hồi /
đẩy cập nhật lệnh đã đẩy giữ đường `/phat-hanh*` cũ.

Router CHỈ điều phối + kiểm quyền + đẩy SSE. Mọi luật nằm ở `services/xep_lich`.
"""
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_permission
from ..models.user import User
from ..doi_tuong_nhan import MAN_KHVT, MAN_THEO_LENH, hop
from ..realtime import hub
from ..services.can_doi_cache import xoa_cache_can_doi
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.xep_lich_lenh_repo import XepLichLenhRepository
from ..schemas.xep_lich import (
    BanOut,
    ChiTietOut,
    DayNgayIn,
    DayNgayOut,
    HenIn,
    HenKqOut,
    HenTheoLocIn,
    LichSuHenOut,
    NganOut,
    PhatHanhCapNhatIn,
    VatTuLenhOut,
    MayGonOut,
    VungKhoaIn,
    VungKhoaOut,
)
from ..services.xep_lich import sau_phat_hanh
from ..services.xep_lich.hen_day import HenDayError, HenDayNotFound, HenDayService
from ..services.xep_lich import (
    XepLichLenhConflict,
    XepLichLenhError,
    XepLichLenhNotFound,
    XepLichLenhService,
)
from ..services.xep_lich_service import (
    XepLichConflict,
    XepLichNotFound,
    XepLichService,
    XepLichValidationError,
)

router = APIRouter(prefix="/api/xep-lich", tags=["xep-lich"])
MODULE = "xep_lich"


def _svc(db: Session) -> XepLichLenhService:
    return XepLichLenhService(db, XepLichLenhRepository(db), AuditLogRepository(db))


def _map(exc: Exception) -> HTTPException:
    """Ánh xạ lỗi nghiệp vụ sang HTTP. KHÔNG nuốt lỗi lạ — re-raise để 500 nổi lên đúng chỗ.

    Ba lớp lỗi của `xep_lich` (màn 2) cũng vào đây: `thu_hoi` đi đường chung `go_phat_hanh_lsx`,
    nó ném kiểu của nó. Bỏ sót là "thiếu lý do thu hồi" hiện thành 500 câm.
    """
    if isinstance(exc, XepLichNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, XepLichConflict):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, XepLichValidationError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if isinstance(exc, XepLichLenhConflict):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, XepLichLenhNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, XepLichLenhError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    raise exc


# Báo sau phát hành dùng chung với vòng nền tự đẩy — thân hàm ở `services/xep_lich/sau_phat_hanh`.
_phat_lich_doi = sau_phat_hanh.phat_lich_doi
_phat_goi_xuong_xuong = sau_phat_hanh.phat_goi_xuong_xuong
_cham_cho_xep = sau_phat_hanh.cham_cho_xep
_cham_viec_moi = sau_phat_hanh.cham_viec_moi


def _phat_lich_doi_may(may_id: int) -> None:
    """Khai / bỏ khoá máy: thanh lệnh trên máy đó đổi cảnh báo ⇒ nhích cùng tập người như dời mốc."""
    hub.gui({"type": "xep_lich_changed", "may_id": may_id}, quyen=hop(MAN_THEO_LENH, MAN_KHVT))


# --- Bàn hẹn đẩy (08/11/2026, docs/design-go-toc-do-may-va-xep-lich.md) -----------------------
def _hen_svc(db: Session) -> HenDayService:
    return HenDayService(db, AuditLogRepository(db))


def _map_hen(exc: Exception) -> HTTPException:
    if isinstance(exc, HenDayNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, HenDayError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return _map(exc)


@router.get("/ban", response_model=BanOut)
def ban(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    tab: str = Query(..., pattern="^(ket|chua_hen|da_hen|da_day)$"),
    tu: date = Query(...),
    den: date = Query(...),
    tim: str | None = Query(None, max_length=100),
    gap: bool = False,
    thieu_vat_tu: bool = False,
    sat_han: bool = False,
    trang: int = Query(1, ge=1),
    moi_trang: int = Query(25, ge=1, le=100),
    day_tu: date | None = Query(None),
    day_den: date | None = Query(None),
) -> dict:
    """Bốn tab + đếm + dải ngày. `ket`/`chua_hen` không lọc theo khoảng ngày; `da_hen` theo giờ
    hẹn trong `tu`/`den`, `da_day` theo lúc đẩy trong `day_tu`/`day_den` (thiếu thì dùng
    `tu`/`den`). Lọc, sắp xếp, phân trang đều ở máy chủ."""
    try:
        return _hen_svc(db).ban(tab=tab, tu=tu, den=den, tim=tim, gap=gap,
                                thieu_vat_tu=thieu_vat_tu, sat_han=sat_han, trang=trang,
                                moi_trang=moi_trang, day_tu=day_tu, day_den=day_den)
    except Exception as exc:
        raise _map_hen(exc)


@router.post("/hen", response_model=HenKqOut)
def hen(
    payload: HenIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "approve"))],
) -> dict:
    """Hẹn hoặc đổi giờ đẩy cho các lệnh đã chọn. Tới giờ máy chủ tự đẩy bằng quyền người hẹn."""
    try:
        so = _hen_svc(db).hen(payload.lsx_ids, payload.hen_luc, actor=user)
    except Exception as exc:
        raise _map_hen(exc)
    _phat_lich_doi(None, hen=True)
    return {"ok": True, "so_lenh": so}


@router.post("/hen-theo-loc", response_model=HenKqOut)
def hen_theo_loc(
    payload: HenTheoLocIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "approve"))],
) -> dict:
    """"Chọn cả N lệnh theo bộ lọc": máy chủ tự tìm lại tập lệnh theo đúng bộ lọc đang xem."""
    svc = _hen_svc(db)
    try:
        ids = svc.ids_theo_loc(tab=payload.tab, tu=payload.tu, den=payload.den, tim=payload.tim,
                               gap=payload.gap, thieu_vat_tu=payload.thieu_vat_tu,
                               sat_han=payload.sat_han)
        if len(ids) > 500:
            raise HenDayError("Mỗi lần hẹn tối đa 500 lệnh, lọc hẹp lại rồi hẹn tiếp.")
        so = svc.hen(ids, payload.hen_luc, actor=user)
    except Exception as exc:
        raise _map_hen(exc)
    _phat_lich_doi(None, hen=True)
    return {"ok": True, "so_lenh": so}


@router.delete("/hen/{lsx_id}", response_model=None)
def bo_hen(
    lsx_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "approve"))],
) -> dict:
    try:
        _hen_svc(db).bo_hen(lsx_id, actor=user)
    except Exception as exc:
        raise _map_hen(exc)
    _phat_lich_doi(lsx_id)
    return {"ok": True}


@router.post("/day-ngay", response_model=DayNgayOut)
def day_ngay(
    payload: DayNgayIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "approve"))],
) -> dict:
    """Đẩy ngay các lệnh đã chọn. Lệnh lỗi không chặn lệnh khác; báo sau phát hành chạy cho từng
    lệnh đẩy được (`sau_phat_hanh.bao(` trong service)."""
    try:
        kq = _hen_svc(db).day_ngay(payload.lsx_ids, actor=user)
    except Exception as exc:
        raise _map_hen(exc)
    _phat_lich_doi(None, hen=True)
    return kq


@router.get("/lenh/{lsx_id}/lich-su-hen", response_model=list[LichSuHenOut])
def lich_su_hen(
    lsx_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> list[dict]:
    try:
        return _hen_svc(db).lich_su_hen(lsx_id)
    except Exception as exc:
        raise _map_hen(exc)


@router.get("/lenh/{lsx_id}/ngan", response_model=NganOut)
def ngan_hen(
    lsx_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> dict:
    """Ngăn chi tiết: đầu ngăn + tab Vật tư + tab Công đoạn (Lịch sử hẹn gọi đường riêng)."""
    try:
        return _hen_svc(db).ngan(lsx_id)
    except Exception as exc:
        raise _map_hen(exc)


# --- Đọc ---------------------------------------------------------------------
@router.get("/vat-tu", response_model=list[VatTuLenhOut])
def vat_tu(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    lsx_ids: str = Query("", description="Id lệnh, cách nhau dấu phẩy (tối đa 300)"),
) -> list[dict]:
    """Đèn vật tư của các lệnh đang hiện — màn gọi SAU khi lưới đã vẽ (bảng cân đối đắt)."""
    try:
        ids = [int(x) for x in lsx_ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="Danh sách lệnh không hợp lệ.") from None
    return _svc(db).vat_tu(ids)


@router.get("/lenh/{lsx_id}", response_model=ChiTietOut)
def chi_tiet(
    lsx_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> dict:
    try:
        return _svc(db).chi_tiet(lsx_id)
    except Exception as exc:
        raise _map(exc)


@router.get("/lenh/{lsx_id}/so-sanh", response_model=None)
def so_sanh_phien_ban(
    lsx_id: int,
    a: int,
    b: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> dict:
    """So hai phiên bản lịch đã phát hành, từng bước một. Chỉ đọc.

    `response_model=None` cùng lý do với `/phat-hanh/{lsx_id}/goi`: dict đi thẳng, khỏi cảnh
    Pydantic nuốt im lặng khoá chưa khai ở schema.
    """
    try:
        return _svc(db).so_sanh_phien_ban(lsx_id, a, b)
    except Exception as exc:
        raise _map(exc)


# --- Ghi ---------------------------------------------------------------------
@router.post("/phat-hanh/{lsx_id}", response_model=None)
def phat_hanh(
    lsx_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "approve"))],
) -> dict:
    """Phát hành xuống xưởng — BẤM LÀ ĐI, không hộp thoại, không cửa gác (spec §1).

    Trả kèm `vat_tu` = số yêu cầu xuất vừa tự lập + các món chưa tự lập được (spec 2026-10-18 §4)
    để toast nói cho người phát hành biết."""
    try:
        kq = _svc(db).phat_hanh(lsx_id, actor=user)
    except Exception as exc:
        raise _map(exc)
    from ..services.san_xuat.vat_tu_tu_lap import bao_sau_phat_hanh

    # Cùng trình tự `sau_phat_hanh.bao` (vòng tự đẩy gọi bản đó) — viết rời để bài soi nguồn SSE
    # của router thấy `_phat_goi_xuong_xuong(` ngay trong route.
    xoa_cache_can_doi()
    _phat_goi_xuong_xuong(lsx_id)
    _cham_viec_moi(db, lsx_id, user.id)
    bao_sau_phat_hanh(db, kq["_tu_lap"], ma_lenh=kq["ma"], actor_id=user.id)
    return {"ok": True, "vat_tu": kq["vat_tu"]}


@router.get("/phat-hanh/{lsx_id}/goi", response_model=None)
def goi_phat_hanh(
    lsx_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> dict:
    """Trạng thái gói đã thả xuống xưởng (số việc đã/chưa bắt đầu + phiên bản) — panel hỏi câu này
    để biết còn thu hồi được không, hay chỉ còn đường phát hành cập nhật. Chỉ đọc.

    `response_model=None` CỐ Ý: dict đi thẳng ra, khỏi cảnh Pydantic nuốt im lặng khoá nào chưa
    khai ở schema.
    """
    try:
        return _svc(db).goi_phat_hanh(lsx_id)
    except Exception as exc:
        raise _map(exc)


@router.post("/phat-hanh-cap-nhat/{lsx_id}", response_model=None)
def phat_hanh_cap_nhat(
    lsx_id: int,
    payload: PhatHanhCapNhatIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "approve"))],
) -> dict:
    """Đẩy lịch mới xuống xưởng cho phần CHƯA bắt đầu (§4.3), giữ nguyên việc đã chạy."""
    try:
        kq = _svc(db).phat_hanh_cap_nhat(lsx_id, actor=user, ly_do=payload.ly_do)
    except Exception as exc:
        raise _map(exc)
    from ..services.san_xuat.vat_tu_tu_lap import bao_doi_gio

    xoa_cache_can_doi()
    bao_doi_gio(db, kq.get("yeu_cau_doi_gio") or [])
    _cham_viec_moi(db, lsx_id, user.id)
    # (Từng bắn thêm `san_xuat_changed` — FE không có nhánh riêng, chỉ nhích nhóm `san_xuat` mà
    # `lsx_changed` ngay trong `_phat_goi_xuong_xuong` đã nhích cho cùng tập người. Bỏ 28/09/2026.)
    _phat_goi_xuong_xuong(lsx_id)
    return kq


@router.delete("/phat-hanh/{lsx_id}", response_model=None)
def thu_hoi(
    lsx_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "approve"))],
    ly_do: str | None = Query(None, max_length=500),
) -> dict:
    """Thu hồi CẢ CỤM đã phát hành chung một gói — mọi lệnh trong cụm quay lại khay chờ xếp."""
    try:
        kq = _svc(db).thu_hoi(lsx_id, actor=user, ly_do=ly_do)
    except Exception as exc:
        raise _map(exc)
    from ..services.san_xuat.vat_tu_tu_lap import bao_da_huy

    xoa_cache_can_doi()
    bao_da_huy(db, kq.get("yeu_cau_da_huy") or [])
    _phat_goi_xuong_xuong(lsx_id)
    for i in kq["cum_lsx"]:
        _cham_cho_xep(db, i, user.id)
    return {"ok": True, "cum_lsx": kq["cum_lsx"]}

# --- Vùng khoá máy (bảo trì / hỏng / nghỉ) — lỗi #50 bấm thử 18/10/2026 ---------------------------
# Route cũ mất cùng bàn theo công đoạn (0001d386, 20/08/2026) nên `tao_vung_khoa` chỉ còn test gọi:
# nhãn "Đang bảo trì" ở màn Máy và cảnh báo đè lịch bảo trì không bao giờ có dữ liệu để hiện.
def _khoa_svc(db: Session) -> XepLichService:
    from ..repositories.xep_lich_repo import XepLichRepository

    return XepLichService(db, XepLichRepository(db), AuditLogRepository(db))


@router.get("/may", response_model=list[MayGonOut])
def danh_sach_may(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> list[dict]:
    """Máy còn dùng cho ô chọn của hộp Khoá máy — gác bằng quyền Xếp lịch, không mượn khoá màn Máy."""
    from ..services.xep_lich_service import may_cho_hop_khoa

    return may_cho_hop_khoa(db)


@router.get("/may/{may_id}/vung-khoa", response_model=list[VungKhoaOut])
def list_vung_khoa(
    may_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> list[dict]:
    return _khoa_svc(db).list_vung_khoa(may_id=may_id)


@router.post("/may/{may_id}/vung-khoa", response_model=VungKhoaOut)
def tao_vung_khoa(
    may_id: int,
    body: VungKhoaIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> dict:
    try:
        kq = _khoa_svc(db).tao_vung_khoa(may_id=may_id, tu=body.tu, den=body.den, ly_do=body.ly_do,
                                         note=(body.note or "").strip() or None, actor=user)
    except Exception as exc:
        raise _map(exc)
    _phat_lich_doi_may(may_id)
    return kq


@router.delete("/vung-khoa/{pid}", response_model=None)
def xoa_vung_khoa(
    pid: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> dict:
    try:
        may_id = _khoa_svc(db).xoa_vung_khoa(pid=pid, actor=user)
    except Exception as exc:
        raise _map(exc)
    _phat_lich_doi_may(may_id)
    return {"ok": True}
