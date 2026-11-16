"""Thuê gia công — router (spec docs/superpowers/specs/2026-11-13-module-gia-cong-ngoai-design.md).

Quyền module `thue_gia_cong`: Xem (`read`) · Thao tác (`create` lập đơn/phiếu giao, `update` sửa đơn,
hoàn tất, tách việc) · Huỷ (`cancel`) · Nhận hàng (`handover`). Trọn gói đặt/huỷ từ màn LỆNH nên gác
bằng quyền sửa lệnh (`san_xuat:update`) + phạm vi lệnh. Tiền gia công không gác `view_cost`
(ngoại lệ 27/09). Mọi SSE bắn SAU commit.
"""
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import CurrentUser, get_authorization_service, require_any_permission, require_permission
from ..doi_tuong_nhan import MAN_KHO, MAN_MUA_KE_TOAN, MAN_THEO_LENH
from ..models.user import User
from ..realtime import hub, phat_ban_giao
from ..repositories.san_xuat_repo import SanXuatRepository
from ..repositories.thue_gia_cong_repo import ThueGiaCongRepository
from ..schemas.thue_gia_cong import (
    DonListOut, DonOut, DonSuaIn, DonTaoIn, GoiYDonGiaOut, HangChoOut, HuyIn, HuyTronGoiIn,
    NhaGiaCongIn, NhaGiaCongOut, PhieuGiaoIn, PhieuGiaoListOut, PhieuGiaoMoiOut, PhieuGiaoOut, PhieuNhanIn,
    PhieuNhanListOut, PhieuNhanMoiOut, PhieuNhanOut, TrangThaiViecOut, TronGoiIn, VersionIn,
    HangONgoaiListOut, HoanTatIn, HoanTatOut, ChoTraTienOut, DemOut,
)
from ..services.quyen_kho import kho_duoc
from ..services.rbac_service import AuthorizationService
from ..services.thue_gia_cong import TgcXungDot, hang_cho, tron_goi
from ..services.thue_gia_cong import don as don_svc
from ..services.thue_gia_cong import phieu_giao as pg_svc
from ..services.thue_gia_cong import phieu_nhan as pn_svc
from ..services.thue_gia_cong import hoan_tat as ht_svc
from ..services.thue_gia_cong import so_ngoai
from ..services.thue_gia_cong import cho_tra_tien as ctt_svc
from ..services.thue_gia_cong import viec as viec_svc
from ..services.thue_gia_cong import nha_gia_cong as nha_svc
from ..services.thue_gia_cong.trang_thai_lenh import cua_bai_ghep as trang_thai_cua_bai_ghep
from ..services.thue_gia_cong.trang_thai_lenh import cua_lenh as trang_thai_cua_lenh
from .lsx import _guard_scope

router = APIRouter(prefix="/api/thue-gia-cong", tags=["thue-gia-cong"])
MODULE = "thue_gia_cong"
Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]


def _chay(fn):
    """Lỗi nghiệp vụ → mã HTTP: quyền 403 · người khác vừa đổi 409 · ràng buộc 400."""
    try:
        return fn()
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except TgcXungDot as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


def phat_doi(lsx_ids=None, **them) -> None:
    """Màn Thuê gia công + mọi màn theo lệnh (trạng thái chỉ đọc của bước thuê ngoài) nạp lại."""
    ids = sorted({int(i) for i in (lsx_ids or []) if i})
    hub.gui({"type": "tgc_changed", "lsx_id": ids[0] if ids else None, "lsx_ids": ids, **them},
            quyen=MAN_THEO_LENH + MAN_KHO)


def _gac_lenh(db: Session, authz: AuthorizationService, user: User, lsx_id: int) -> None:
    lsx = SanXuatRepository(db).lsx(lsx_id)
    if lsx is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy lệnh sản xuất")
    _guard_scope(db, lsx, user, authz)


@router.get("/nha-gia-cong", response_model=list[NhaGiaCongOut])
def nha_gia_cong(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(MODULE, "read"))],
    ca_da_bo: bool = Query(False),
) -> list[dict]:
    """Danh sách nhà gia công (bảng riêng, không dính Nhà cung cấp — 16/11/2026). `ca_da_bo` kèm cả nhà
    đã bỏ cho bộ lọc chứng từ cũ."""
    return [{"id": n.id, "ten": n.ten, "active": n.active}
            for n in ThueGiaCongRepository(db).nha_gia_cong_options(ca_da_bo=ca_da_bo)]


# Ai lập được đơn thì thêm, bỏ nhà gia công ngay ở ô Nhà gia công của hộp Lập đơn.
@router.post("/nha-gia-cong", response_model=NhaGiaCongOut, status_code=status.HTTP_201_CREATED)
def nha_gia_cong_them(
    body: NhaGiaCongIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> dict:
    try:
        n = nha_svc.them(db, ten=body.ten, actor=user)
    except nha_svc.NhaGiaCongLoi as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None
    return {"id": n.id, "ten": n.ten, "active": n.active}


@router.delete("/nha-gia-cong/{nha_id}", status_code=status.HTTP_204_NO_CONTENT)
def nha_gia_cong_bo(
    nha_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> Response:
    try:
        nha_svc.bo(db, nha_id=nha_id, actor=user)
    except nha_svc.NhaGiaCongLoi as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/hang-cho", response_model=HangChoOut)
def hang_cho_ds(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(MODULE, "read"))],
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=200),
    q: str | None = Query(None, max_length=200),
    tinh_trang: str | None = Query(None, pattern="^(san_sang_giao|cho_buoc_truoc|chua_dat)$"),
) -> dict:
    return hang_cho.danh_sach(db, q=q, tinh_trang=tinh_trang, page=page, size=size)


@router.post("/viec/{viec_id}/tach-theo-buoc", response_model=list[int])
def tach_theo_buoc(
    viec_id: int,
    body: VersionIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> list[int]:
    v = ThueGiaCongRepository(db).viec(viec_id)
    lsx_ids = [v.lsx_id] if v is not None and v.lsx_id else []
    moi = _chay(lambda: viec_svc.tach_theo_buoc(db, user=user, viec_id=viec_id,
                                                expected_version=body.version))
    ids = [x.id for x in moi]
    phat_doi(lsx_ids)
    return ids


@router.get("/lenh/{lsx_id}", response_model=list[TrangThaiViecOut])
def cua_lenh(
    lsx_id: int,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission("san_xuat", "read"))],
) -> list[dict]:
    """Trạng thái chỉ đọc từng việc thuê gia công của lệnh — người xem lệnh không cần quyền module."""
    _gac_lenh(db, authz, user, lsx_id)
    return trang_thai_cua_lenh(db, lsx_id)


@router.get("/bai-ghep/{bai_ghep_id}", response_model=list[TrangThaiViecOut])
def cua_bai_ghep(
    bai_ghep_id: int,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission("bai_ghep_2", "read"))],
) -> list[dict]:
    """Trạng thái chỉ đọc việc thuê gia công của bước chung bài ghép."""
    return trang_thai_cua_bai_ghep(db, bai_ghep_id)


@router.post("/lenh/{lsx_id}/tron-goi", response_model=TrangThaiViecOut)
def dat_tron_goi(
    lsx_id: int,
    body: TronGoiIn,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission("san_xuat", "update"))],
) -> dict:
    _gac_lenh(db, authz, user, lsx_id)
    v = _chay(lambda: tron_goi.dat(db, user=user, lsx_id=lsx_id, sl_can=body.sl_can,
                                   xuong_cap_giay=body.xuong_cap_giay))
    vid = v.id
    phat_doi([lsx_id])
    hub.gui({"type": "lsx_changed", "lsx_id": lsx_id}, quyen=MAN_THEO_LENH)
    return next(x for x in trang_thai_cua_lenh(db, lsx_id) if x["viec_id"] == vid)


@router.post("/viec/{viec_id}/huy-tron-goi", status_code=status.HTTP_204_NO_CONTENT)
def huy_tron_goi(
    viec_id: int,
    body: HuyTronGoiIn,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission("san_xuat", "update"))],
) -> Response:
    v = ThueGiaCongRepository(db).viec(viec_id)
    if v is None or v.lsx_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Không tìm thấy việc gia công trọn gói")
    _gac_lenh(db, authz, user, v.lsx_id)
    lsx_id = _chay(lambda: tron_goi.huy(db, user=user, viec_id=viec_id,
                                        expected_version=body.version, ly_do=body.ly_do))
    phat_doi([lsx_id])
    hub.gui({"type": "lsx_changed", "lsx_id": lsx_id}, quyen=MAN_THEO_LENH)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Đơn gia công ---------------------------------------------------------------------------
def _don_hoac_404(db: Session, don_id: int):
    d = ThueGiaCongRepository(db).don(don_id)
    if d is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy đơn gia công")
    return d


def _phat_don(db: Session, don) -> None:
    lsx_ids = don_svc.lsx_ids_cua_dong(db, ThueGiaCongRepository(db).dong_cua_don(don.id, ca_huy=True))
    phat_doi(lsx_ids, don_id=don.id)


@router.get("/don", response_model=DonListOut)
def don_ds(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(MODULE, "read"))],
    tu_ngay: date | None = Query(None),
    den_ngay: date | None = Query(None),
    moc: str = Query("dat", pattern="^(dat|tao|hen)$"),
    q: str | None = Query(None, max_length=200),
    trang_thai: str | None = Query(None, pattern="^(" + "|".join(don_svc.TRANG_THAI) + ")$"),
    nha_cung_cap_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=200),
) -> dict:
    return don_svc.danh_sach(db, tu_ngay=tu_ngay, den_ngay=den_ngay, moc=moc, q=q,
                             trang_thai_loc=trang_thai, nha_cung_cap_id=nha_cung_cap_id,
                             page=page, size=size)


@router.post("/don", response_model=DonOut)
def don_tao(
    body: DonTaoIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> dict:
    d = _chay(lambda: don_svc.tao(
        db, user=user, nha_cung_cap_id=body.nha_cung_cap_id, ngay_dat=body.ngay_dat,
        ngay_hen_ve=body.ngay_hen_ve, ghi_chu=body.ghi_chu,
        dong=[x.model_dump() for x in body.dong], dat=body.dat))
    _phat_don(db, d)
    return don_svc.don_dict(db, d)


@router.get("/don/{don_id}", response_model=DonOut)
def don_xem(
    don_id: int,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> dict:
    return don_svc.don_dict(db, _don_hoac_404(db, don_id))


@router.put("/don/{don_id}", response_model=DonOut)
def don_sua(
    don_id: int,
    body: DonSuaIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> dict:
    _don_hoac_404(db, don_id)
    d = _chay(lambda: don_svc.sua(
        db, user=user, don_id=don_id, expected_version=body.version,
        nha_cung_cap_id=body.nha_cung_cap_id, ngay_dat=body.ngay_dat, ngay_hen_ve=body.ngay_hen_ve,
        ghi_chu=body.ghi_chu, dong=[x.model_dump() for x in body.dong]))
    _phat_don(db, d)
    return don_svc.don_dict(db, d)


@router.post("/don/{don_id}/dat", response_model=DonOut)
def don_dat(
    don_id: int,
    body: VersionIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> dict:
    _don_hoac_404(db, don_id)
    d = _chay(lambda: don_svc.dat(db, user=user, don_id=don_id, expected_version=body.version))
    _phat_don(db, d)
    return don_svc.don_dict(db, d)


@router.post("/don/{don_id}/huy", response_model=DonOut)
def don_huy(
    don_id: int,
    body: HuyIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "cancel"))],
) -> dict:
    _don_hoac_404(db, don_id)
    lsx_ids = _chay(lambda: don_svc.huy(db, user=user, don_id=don_id, expected_version=body.version,
                                        ly_do=body.ly_do))
    phat_doi(lsx_ids, don_id=don_id)
    return don_svc.don_dict(db, _don_hoac_404(db, don_id))


@router.get("/goi-y-don-gia", response_model=GoiYDonGiaOut)
def goi_y_don_gia(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(MODULE, "read"))],
    nha_cung_cap_id: int = Query(...),
    ten_viec: str = Query(..., max_length=255),
    bo_don_id: int | None = Query(None),
) -> dict:
    return {"don_gia": don_svc.goi_y_don_gia(db, nha_cung_cap_id, ten_viec, bo_don_id)}


# --- Phiếu giao -------------------------------------------------------------------------------
def _pg_hoac_404(db: Session, phieu_id: int):
    p = ThueGiaCongRepository(db).phieu_giao(phieu_id)
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiếu giao")
    return p


@router.get("/don/{don_id}/phieu-giao/moi", response_model=PhieuGiaoMoiOut)
def phieu_giao_moi(
    don_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
    authz: Authz,
) -> dict:
    """Điền sẵn phiếu giao: bàn giao bước trước đang chờ, vật tư xưởng cấp còn thiếu, giấy trọn gói.
    Số tồn chỉ cộng các kho người gọi được Xem (`kho_duoc`) — kho khoá không lọt vào tổng."""
    _don_hoac_404(db, don_id)
    kho_xem = kho_duoc(authz, user)
    return _chay(lambda: pg_svc.du_lieu_moi(db, don_id, kho_xem=kho_xem))


@router.post("/don/{don_id}/phieu-giao", response_model=PhieuGiaoOut)
def phieu_giao_lap(
    don_id: int,
    body: PhieuGiaoIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> dict:
    _don_hoac_404(db, don_id)
    pg, ket_qua = _chay(lambda: pg_svc.lap(
        db, user=user, don_id=don_id, expected_version=body.version, ghi_chu=body.ghi_chu,
        dong=[x.model_dump() for x in body.dong]))
    for res in ket_qua:
        phat_ban_giao(res)
    phat_doi(pg_svc.lsx_ids_cua_phieu(db, pg), don_id=don_id, phieu_giao_id=pg.id)
    return pg_svc.nhieu_dict(db, [pg])[0]


@router.get("/phieu-giao", response_model=PhieuGiaoListOut)
def phieu_giao_ds(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(MODULE, "read"))],
    tu_ngay: date | None = Query(None),
    den_ngay: date | None = Query(None),
    q: str | None = Query(None, max_length=200),
    nha_cung_cap_id: int | None = Query(None),
    con_hieu_luc: bool | None = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=200),
) -> dict:
    return pg_svc.danh_sach(db, tu_ngay=tu_ngay, den_ngay=den_ngay, q=q, nha_cung_cap_id=nha_cung_cap_id,
                            con_hieu_luc=con_hieu_luc, page=page, size=size)


@router.get("/phieu-giao/{phieu_id}", response_model=PhieuGiaoOut)
def phieu_giao_xem(
    phieu_id: int,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> dict:
    return pg_svc.nhieu_dict(db, [_pg_hoac_404(db, phieu_id)])[0]


@router.post("/phieu-giao/{phieu_id}/huy", response_model=PhieuGiaoOut)
def phieu_giao_huy(
    phieu_id: int,
    body: HuyIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "cancel"))],
) -> dict:
    _pg_hoac_404(db, phieu_id)
    pg = _chay(lambda: pg_svc.huy(db, user=user, phieu_id=phieu_id, expected_version=body.version,
                                  ly_do=body.ly_do))
    phat_doi(pg_svc.lsx_ids_cua_phieu(db, pg), don_id=pg.don_id, phieu_giao_id=pg.id)
    return pg_svc.nhieu_dict(db, [pg])[0]


# --- Phiếu nhận -------------------------------------------------------------------------------
# Nhận hàng mở cho người có ô `handover` HOẶC người Xác nhận sản lượng ở tổ bước nhận (tổ bế nhận
# hàng cán màng về) — nên endpoint lập chỉ đòi đăng nhập, service gác từng dòng.
def _pn_hoac_404(db: Session, phieu_id: int):
    p = ThueGiaCongRepository(db).phieu_nhan(phieu_id)
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiếu nhận")
    return p


def phat_cho_tra_tien(**them) -> None:
    """Danh sách Chờ trả tiền (kế toán, màn Thuê gia công) + badge nạp lại."""
    hub.gui({"type": "tgc_cho_tra_tien_changed", **them}, quyen=MAN_MUA_KE_TOAN + (MODULE,))


@router.get("/don/{don_id}/phieu-nhan/moi", response_model=PhieuNhanMoiOut)
def phieu_nhan_moi(
    don_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: CurrentUser,
    authz: Authz,
) -> dict:
    """Điền sẵn phiếu nhận: còn ngoài, nơi về hợp lệ, bước nhận, bảng chia bài ghép."""
    _don_hoac_404(db, don_id)
    return _chay(lambda: pn_svc.du_lieu_moi(db, don_id, user=user,
                                            co_quyen_module=authz.can(user, MODULE, "handover")))


@router.post("/don/{don_id}/phieu-nhan", response_model=PhieuNhanOut)
def phieu_nhan_lap(
    don_id: int,
    body: PhieuNhanIn,
    db: Annotated[Session, Depends(get_db)],
    user: CurrentUser,
    authz: Authz,
) -> dict:
    _don_hoac_404(db, don_id)
    pn, ket_qua, canh_bao = _chay(lambda: pn_svc.lap(
        db, user=user, co_quyen_module=authz.can(user, MODULE, "handover"), don_id=don_id,
        expected_version=body.version, ghi_chu=body.ghi_chu, dong=[x.model_dump() for x in body.dong]))
    for res in ket_qua:
        phat_ban_giao(res)
    phat_doi(pn_svc.lsx_ids_cua_phieu(db, pn), don_id=don_id, phieu_nhan_id=pn.id)
    phat_cho_tra_tien(phieu_nhan_id=pn.id)
    return {**pn_svc.nhieu_dict(db, [pn])[0], "canh_bao": canh_bao}


@router.get("/phieu-nhan", response_model=PhieuNhanListOut)
def phieu_nhan_ds(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(MODULE, "read"))],
    tu_ngay: date | None = Query(None),
    den_ngay: date | None = Query(None),
    q: str | None = Query(None, max_length=200),
    nha_cung_cap_id: int | None = Query(None),
    con_hieu_luc: bool | None = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=200),
) -> dict:
    return pn_svc.danh_sach(db, tu_ngay=tu_ngay, den_ngay=den_ngay, q=q, nha_cung_cap_id=nha_cung_cap_id,
                            con_hieu_luc=con_hieu_luc, page=page, size=size)


@router.get("/phieu-nhan/{phieu_id}", response_model=PhieuNhanOut)
def phieu_nhan_xem(
    phieu_id: int,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> dict:
    return pn_svc.nhieu_dict(db, [_pn_hoac_404(db, phieu_id)])[0]


@router.post("/phieu-nhan/{phieu_id}/huy", response_model=PhieuNhanOut)
def phieu_nhan_huy(
    phieu_id: int,
    body: HuyIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "cancel"))],
) -> dict:
    _pn_hoac_404(db, phieu_id)
    pn = _chay(lambda: pn_svc.huy(db, user=user, phieu_id=phieu_id, expected_version=body.version,
                                  ly_do=body.ly_do))
    phat_doi(pn_svc.lsx_ids_cua_phieu(db, pn), don_id=pn.don_id, phieu_nhan_id=pn.id)
    phat_cho_tra_tien(phieu_nhan_id=pn.id)
    return pn_svc.nhieu_dict(db, [pn])[0]


# --- Hoàn tất dòng đơn, hàng đang ở ngoài -----------------------------------------------------
def _dong_don_hoac_404(db: Session, don_dong_id: int):
    dd = ThueGiaCongRepository(db).dong_don(don_dong_id)
    if dd is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy dòng đơn gia công")
    return dd


def _phat_dong(db: Session, dd) -> None:
    from ..services.thue_gia_cong.don import lsx_ids_cua_dong

    phat_doi(lsx_ids_cua_dong(db, [dd]), don_id=dd.don_id, don_dong_id=dd.id)


@router.post("/don-dong/{don_dong_id}/hoan-tat", response_model=HoanTatOut)
def don_dong_hoan_tat(
    don_dong_id: int,
    body: HoanTatIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> dict:
    dd = _dong_don_hoac_404(db, don_dong_id)
    kq = _chay(lambda: ht_svc.hoan_tat(db, user=user, don_dong_id=don_dong_id, expected_version=body.version,
                                       tra_ve=[x.model_dump() for x in body.tra_ve]))
    _phat_dong(db, dd)
    return kq


@router.post("/don-dong/{don_dong_id}/mo-hoan-tat", response_model=HoanTatOut)
def don_dong_mo_hoan_tat(
    don_dong_id: int,
    body: VersionIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> dict:
    dd = _dong_don_hoac_404(db, don_dong_id)
    kq = _chay(lambda: ht_svc.mo_lai(db, user=user, don_dong_id=don_dong_id, expected_version=body.version))
    _phat_dong(db, dd)
    return kq


@router.get("/hang-o-ngoai", response_model=HangONgoaiListOut)
def hang_o_ngoai(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(MODULE, "read"))],
    nha_cung_cap_id: int | None = Query(None),
    q: str | None = Query(None, max_length=200),
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=200),
) -> dict:
    """Sổ số lượng nhà gia công đang giữ (bán thành phẩm + vật tư kho đã xuất), không phải kho."""
    return so_ngoai.danh_sach(db, nha_cung_cap_id=nha_cung_cap_id, q=q, page=page, size=size)

_DOC_CHO_TRA = require_any_permission(("phieu_chi", "read"), (MODULE, "read"))


@router.get("/cho-tra-tien", response_model=list[ChoTraTienOut])
def cho_tra_tien(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_DOC_CHO_TRA)],
    nha_cung_cap_id: int | None = Query(None),
    q: str | None = Query(None, max_length=200),
) -> list[dict]:
    """Phiếu nhận chưa có phiếu chi còn hiệu lực (spec §4.6) — kế toán lập phiếu chi gộp theo nhà."""
    return ctt_svc.danh_sach(db, q=q, nha_cung_cap_id=nha_cung_cap_id)


@router.get("/cho-tra-tien/dem", response_model=DemOut)
def cho_tra_tien_dem(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_DOC_CHO_TRA)],
) -> dict:
    return {"so": ctt_svc.dem(db)}
