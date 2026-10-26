"""Router **Xếp lịch** — bàn xếp lịch cấp LỆNH SẢN XUẤT.

Prefix `/api/xep-lich`. RBAC MODULE = "xep_lich".

Tên cũ là "Xếp lịch 3" (`/api/xep-lich-3`, quyền `xep_lich_3`); 18/09/2026 chủ dự án chốt bỏ đánh
số — bàn theo công đoạn (`xep_lich_2`) xoá hẳn, bàn này về đúng tên `xep_lich`. Quyền chép sang ở
mg `0314`, dấu trang cũ `/xep-lich-3` không còn dùng được.

Luồng gọn hơn bàn theo công đoạn cũ đúng một bậc: thẻ ở `/hang-cho` → `PUT /lenh/{id}` đặt hoặc dời mốc bắt đầu
(khóa lạc quan theo `updated_at` → 409) → `POST /phat-hanh/{id}`. KHÔNG có bước "đưa vào nháp",
KHÔNG có `xem-truoc`, KHÔNG có `kiem-phat-hanh`: màn này không chặn gì hết, xem trước chính là
thanh trên lưới, và phát hành bấm là đi.

Router CHỈ điều phối + kiểm quyền + đẩy SSE. Mọi luật nằm ở `services/xep_lich`.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_permission
from ..models.lsx import Lsx
from ..models.user import User
from ..repositories.san_xuat_repo import SanXuatRepository
from ..services.thong_bao_man import bao, kenh_to
from ..doi_tuong_nhan import BAN_TO, MAN_KHVT, MAN_THEO_LENH, NGHE_LENH, hop, kem_ban_to
from ..realtime import hub
from ..services.can_doi_cache import xoa_cache_can_doi
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.xep_lich_lenh_repo import XepLichLenhRepository
from ..schemas.loc_danh_sach import LuaChonLoc
from ..schemas.xep_lich import (
    ChiTietOut,
    DatMocIn,
    DongLichOut,
    HangChoOut,
    LichOut,
    PhatHanhCapNhatIn,
    ThuMocOut,
    VatTuLenhOut,
    MayGonOut,
    VungKhoaIn,
    VungKhoaOut,
)
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


def _phat_lich_doi(lsx_id: int) -> None:
    """Đặt / dời / bỏ mốc: nhóm `san_xuat` + `khvt` (màn theo lệnh) và badge Xếp lịch. Bàn tổ cầm
    gói ĐÃ phát hành — lịch mới chỉ xuống tổ qua "phát hành cập nhật" — nên không nhận."""
    hub.gui({"type": "xep_lich_changed", "lsx_id": lsx_id}, quyen=hop(MAN_THEO_LENH, MAN_KHVT))


def _phat_goi_xuong_xuong(lsx_id: int) -> None:
    """Phát hành / phát hành cập nhật / thu hồi: gói việc ở xưởng đổi ⇒ thêm MỌI người có Bàn tổ
    (bàn nào có việc của lệnh thì phải tự nạp; tra tổ cần đọc lại gói, còn cửa này thưa)."""
    _phat_lich_doi(lsx_id)
    hub.gui({"type": "lsx_changed"}, quyen=hop(NGHE_LENH, (BAN_TO,)))


def _phat_lich_doi_may(may_id: int) -> None:
    """Khai / bỏ khoá máy: thanh lệnh trên máy đó đổi cảnh báo ⇒ nhích cùng tập người như dời mốc."""
    hub.gui({"type": "xep_lich_changed", "may_id": may_id}, quyen=hop(MAN_THEO_LENH, MAN_KHVT))


# --- Đọc ---------------------------------------------------------------------
@router.get("/hang-cho", response_model=HangChoOut)
def hang_cho(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    tim: str | None = Query(None, description="Tìm theo mã / tên lệnh — lọc Ở MÁY CHỦ"),
    trang: int = Query(1, ge=1),
    moi_trang: int = Query(20, ge=1, le=200),
    tu_ngay: date | None = Query(None),
    den_ngay: date | None = Query(None),
    moc: str = Query("tao", pattern="^(tao|han_sx)$", description="Kỳ theo Ngày tạo / Hạn SX"),
    khach_id: int | None = Query(None),
) -> dict:
    return _svc(db).hang_cho(tim=tim, trang=trang, cd_trang=moi_trang, tu_ngay=tu_ngay,
                             den_ngay=den_ngay, moc=moc, khach_id=khach_id)


@router.get("/hang-cho/khach-loc", response_model=list[LuaChonLoc])
def hang_cho_khach_loc(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    tim: str | None = Query(None),
    tu_ngay: date | None = Query(None),
    den_ngay: date | None = Query(None),
    moc: str = Query("tao", pattern="^(tao|han_sx)$"),
) -> list[dict]:
    """Ô "Khách hàng" của thanh lọc hàng chờ: khách đang có lệnh chờ xếp, kèm số lệnh."""
    return _svc(db).khach_hang_cho(tim=tim, tu_ngay=tu_ngay, den_ngay=den_ngay, moc=moc)


@router.get("/lich", response_model=LichOut)
def lich(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    tu: date = Query(..., description="Ngày ĐẦU cửa sổ"),
    den: date = Query(..., description="Ngày CUỐI cửa sổ"),
    tim: str | None = Query(None, description="Mã / tên lệnh / khách — lọc Ở MÁY CHỦ"),
    trang_thai: str | None = Query(None, description="Trạng thái lệnh, cách nhau dấu phẩy"),
    khach_id: int | None = Query(None),
    gap: bool | None = Query(None),
    nhanh: str | None = Query(None, pattern="^(tre|muon|chua)$", description="Nút lọc nhanh"),
) -> dict:
    """Các lệnh CHẠM cửa sổ. `tu`/`den` BẮT BUỘC — không mở đường trải cả lịch sử (spec §4.1)."""
    if den < tu:
        raise HTTPException(status_code=400, detail="Cửa sổ không hợp lệ: ngày cuối trước ngày đầu.")
    tt = [x.strip() for x in (trang_thai or "").split(",") if x.strip()] or None
    return _svc(db).lich(tu=tu, den=den, tim=tim, trang_thai=tt, khach_id=khach_id, gap=gap,
                         nhanh=nhanh)


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


@router.get("/lenh/{lsx_id}/thu", response_model=ThuMocOut)
def thu_moc(
    lsx_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    bat_dau: datetime = Query(..., description="Mốc thử — chưa lưu"),
) -> dict:
    """Xem trước lúc kéo: thả ở `bat_dau` thì lệnh bắt đầu / xong lúc nào. CHỈ ĐỌC."""
    try:
        return _svc(db).thu_moc(lsx_id, bat_dau)
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
@router.put("/lenh/{lsx_id}", response_model=DongLichOut)
def dat_moc(
    lsx_id: int,
    payload: DatMocIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> dict:
    """Đặt / dời giờ bắt đầu. Mốc ngoài giờ chạy thì TRƯỢT + báo, không chặn."""
    try:
        ra = _svc(db).dat_moc(
            lsx_id, payload.bat_dau_at, payload.expected_updated_at, nguoi_id=user.id,
        )
    except Exception as exc:
        raise _map(exc)
    _phat_lich_doi(lsx_id)
    return ra


@router.delete("/lenh/{lsx_id}", response_model=None)
def xoa_moc(
    lsx_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> dict:
    """Bỏ lịch — thẻ quay lại hàng chờ."""
    try:
        _svc(db).xoa_moc(lsx_id, nguoi_id=user.id)
    except Exception as exc:
        raise _map(exc)
    _phat_lich_doi(lsx_id)
    _cham_cho_xep(db, lsx_id, user.id)
    return {"ok": True}


def _cham_cho_xep(db: Session, lsx_id: int, actor_id: int) -> None:
    """Thẻ quay lại hàng chờ ⇒ chấm đỏ Xếp lịch."""
    lsx = db.get(Lsx, lsx_id)
    if lsx is not None:
        bao(db, kenh="xep_lich", loai="lenh_cho_xep", actor_id=actor_id, ma=lsx.ma)


def _cham_viec_moi(db: Session, lsx_id: int, actor_id: int) -> None:
    """Phát hành ⇒ chấm đỏ bàn của từng tổ nhận việc."""
    for to_id in sorted(SanXuatRepository(db).to_cua_lenh([lsx_id])):
        bao(db, kenh=kenh_to(to_id), loai="viec_moi", actor_id=actor_id)


@router.post("/phat-hanh/{lsx_id}", response_model=None)
def phat_hanh(
    lsx_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "approve"))],
) -> dict:
    """Phát hành xuống xưởng — BẤM LÀ ĐI, không hộp thoại, không cửa gác (spec §1).

    Trả kèm `vat_tu` = số yêu cầu xuất vừa tự lập + các món chưa tự lập được (spec 2026-10-18 §4)
    để toast nói cho người phát hành biết."""
    from ..services.san_xuat.vat_tu_tu_lap import bao_sau_phat_hanh

    try:
        kq = _svc(db).phat_hanh(lsx_id, actor=user)
    except Exception as exc:
        raise _map(exc)
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
