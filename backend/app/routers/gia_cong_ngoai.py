"""Gia công ngoài — một cửa ghi DUY NHẤT cho mang đi / chốt / mở lại / trọn gói (spec 2026-09-26).

Quyền: ai sửa được lệnh (`san_xuat:update`) — không thêm vai, không thêm bit (spec §6). Tiền của
lần chỉ trả cho người có `kho:view_cost`. Mọi SSE bắn SAU commit.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_authorization_service, require_permission
from ..models.user import User
from ..services.thong_bao_man import bao
from ..doi_tuong_nhan import MAN_MUA_KE_TOAN, MAN_THEO_LENH, kem_ban_to
from ..realtime import hub, phat_ban_giao
from ..repositories.gia_cong_ngoai_repo import GiaCongNgoaiRepository
from ..repositories.san_xuat_repo import SanXuatRepository
from ..schemas.gia_cong_ngoai import (
    ChotIn, GiaCongNgoaiOut, HuyTronGoiIn, MangDiIn, MoLaiIn, NhaGiaCongOut, TronGoiIn, XuatGiayIn,
)
from ..services.gia_cong_ngoai import chot as chot_svc
from ..services.gia_cong_ngoai import mot_phan, tron_goi
from ..services.gia_cong_ngoai.lan import lan_cua_bai_ghep, lan_cua_lenh, lan_dict, nguon_lan
from ..services.rbac_service import AuthorizationService
from .lsx import _guard_scope, _phu_trach_ids, lenh_trong_pham_vi

router = APIRouter(prefix="/api/gia-cong-ngoai", tags=["gia-cong-ngoai"])
MODULE = "san_xuat"
Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]


def _chay(fn):
    """Lỗi nghiệp vụ → mã HTTP: quyền 403 · người khác vừa đổi 409 · ràng buộc 400."""
    from ..services.gia_cong_ngoai import GiaCongXungDot

    try:
        return fn()
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except GiaCongXungDot as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("/nha-gia-cong", response_model=list[NhaGiaCongOut])
def nha_gia_cong(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> list[dict]:
    """Ô chọn Nhà gia công của Kế hoạch SX — người kế hoạch không cần quyền Mua hàng."""
    return [{"id": s.id, "ten": s.name} for s in GiaCongNgoaiRepository(db).nha_gia_cong_options()]


def _gac_lenh(db: Session, authz: AuthorizationService, user: User, lsx_id: int) -> None:
    """Gác PHẠM VI lệnh y như `routers/lsx.py` — người scope "của mình" không đụng lệnh người khác
    (ngoài phạm vi trả 404 như chính màn lệnh, không lộ lệnh có tồn tại)."""
    lsx = SanXuatRepository(db).lsx(lsx_id)
    if lsx is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy lệnh sản xuất")
    _guard_scope(db, lsx, user, authz)


_KHONG_THAY_BG = "Không tìm thấy bài ghép"
_CHI_XEM_BG = ("Bài ghép có lệnh ngoài phạm vi của bạn — chỉ xem được lần gia công này. Nhờ người "
               "phụ trách các lệnh còn lại thao tác.")


def _pham_vi_bai_ghep(db: Session, authz: AuthorizationService, user: User,
                      bai_ghep_id: int) -> tuple[int, int]:
    """(số lệnh thành viên trong phạm vi, tổng số lệnh) — spec 2026-09-27 §5."""
    sx = SanXuatRepository(db)
    lenh = [sx.lsx(i) for i in sx.thanh_vien_so_con({bai_ghep_id})]
    lenh = [l for l in lenh if l is not None]
    owner_ids = _phu_trach_ids(db, user, authz)
    if owner_ids is None:
        return len(lenh), len(lenh)
    trong = sum(1 for l in lenh if lenh_trong_pham_vi(db, l, owner_ids))
    return trong, len(lenh)


def _gac_bai_ghep(db: Session, authz: AuthorizationService, user: User, bai_ghep_id: int, *,
                  ghi: bool) -> bool:
    """Đọc: cần phạm vi trên ÍT NHẤT một lệnh thành viên (không thì 404 như màn lệnh). Ghi: cần
    phạm vi trên MỌI lệnh (thiếu ⇒ 403 chỉ xem). Trả `chi_xem` cho người đọc."""
    if GiaCongNgoaiRepository(db).bai_ghep(bai_ghep_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_KHONG_THAY_BG)
    trong, tong = _pham_vi_bai_ghep(db, authz, user, bai_ghep_id)
    if trong == 0 and tong > 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_KHONG_THAY_BG)
    chi_xem = trong < tong
    if ghi and chi_xem:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_CHI_XEM_BG)
    return chi_xem


def _gac_lan(db: Session, authz: AuthorizationService, user: User, gcn_id: int) -> None:
    """Gác phạm vi theo LỆNH của lần gia công — lần của bài ghép: phạm vi trên mọi lệnh."""
    gcn = GiaCongNgoaiRepository(db).get(gcn_id)
    if gcn is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Không tìm thấy lần gia công ngoài")
    if gcn.bai_ghep_id is not None:
        _gac_bai_ghep(db, authz, user, gcn.bai_ghep_id, ghi=True)
        return
    _gac_lenh(db, authz, user, gcn.lsx_id)


@router.get("/lenh/{lsx_id}", response_model=list[GiaCongNgoaiOut])
def cua_lenh(
    lsx_id: int,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> list[dict]:
    _gac_lenh(db, authz, user, lsx_id)
    return lan_cua_lenh(db, lsx_id)


@router.get("/bai-ghep/{bai_ghep_id}", response_model=list[GiaCongNgoaiOut])
def cua_bai_ghep(
    bai_ghep_id: int,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> list[dict]:
    """Lần gia công của bước CHUNG bài ghép — khối ở màn Bài ghép (spec 2026-09-27 §4)."""
    chi_xem = _gac_bai_ghep(db, authz, user, bai_ghep_id, ghi=False)
    return [{**d, "chi_xem": chi_xem} for d in lan_cua_bai_ghep(db, bai_ghep_id)]


def _phat_doi(lsx_ids, bai_ghep_id: int | None = None) -> None:
    """Khối Gia công ngoài trên lệnh / bài ghép + danh sách Kế hoạch SX tự nạp lại (sau commit).
    Lần của bài ghép đụng MỌI lệnh thành viên — một gói mang cả danh sách, không mỗi lệnh một gói."""
    ids = [lsx_ids] if isinstance(lsx_ids, int) else [i for i in (lsx_ids or []) if i]
    # Nhóm `san_xuat`, màn theo lệnh (khối Gia công ngoài nằm ở Kế hoạch SX / Bài ghép). Phần bàn tổ
    # đổi theo (bàn giao, bước riêng toả số) đi bằng tin riêng của nó ngay trong cùng cửa ghi.
    hub.gui({"type": "gia_cong_ngoai_changed", "lsx_id": ids[0] if ids else None,
             "lsx_ids": ids, "bai_ghep_id": bai_ghep_id}, quyen=MAN_THEO_LENH)


def _phat_doi_lan(db: Session, gcn_id: int) -> None:
    gcn = GiaCongNgoaiRepository(db).get(gcn_id)
    if gcn is None:
        return
    lenh = [l["id"] for l in nguon_lan(db, gcn)["lenh"]]
    _phat_doi(lenh or [gcn.lsx_id], gcn.bai_ghep_id)


def _ra(db: Session, authz: AuthorizationService, user: User, gcn_id: int) -> dict:
    gcn = GiaCongNgoaiRepository(db).get(gcn_id)
    return lan_dict(db, gcn)


@router.post("/{gcn_id}/mang-di", response_model=GiaCongNgoaiOut)
def mang_di(
    gcn_id: int,
    body: MangDiIn,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> dict:
    _gac_lan(db, authz, user, gcn_id)
    kq = _chay(lambda: mot_phan.mang_di(
        db, user=user, gcn_id=gcn_id, expected_version=body.version, sl_gui=body.sl_gui))
    for res in kq["ban_giao"]:
        phat_ban_giao(res)
    _phat_doi(kq["lsx_ids"], kq.get("bai_ghep_id"))
    return _ra(db, authz, user, gcn_id)


def _phat_cho_chi(res: dict, user: User, db: Session) -> None:
    """Lần vừa chốt ⇒ kế toán có việc "chờ chi" (spec §6): toast đích danh + badge mọi người."""
    nhan = [u for u in GiaCongNgoaiRepository(db).nguoi_lap_phieu_chi() if u != user.id]
    bao(db, kenh="phieu_chi", loai="gia_cong_cho_chi", actor_id=user.id, nguoi_nhan=nhan,
        ma=str(res["gia_cong_ngoai_id"]))
    for uid in nhan:
        hub.publish(uid, {
            "type": "gia_cong_cho_chi", "gia_cong_ngoai_id": res["gia_cong_ngoai_id"],
            # Nhãn nguồn: mã lệnh, hoặc "BG-.. (LSX-A, LSX-B)" cho lần của bài ghép.
            "lsx_ma": res.get("nhan_nguon") or res.get("lsx_ma"), "nha_cung_cap_ten": res.get("nha_cung_cap_ten"),
            "ten_viec": res.get("ten_viec"),
        })
    # Badge Phiếu chi + hàng "Gia công chờ chi" — nhóm `mua_ke_toan`.
    hub.gui({"type": "gia_cong_cho_chi_changed"}, quyen=MAN_MUA_KE_TOAN)


@router.post("/{gcn_id}/chot", response_model=GiaCongNgoaiOut)
def chot(
    gcn_id: int,
    body: ChotIn,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> dict:
    _gac_lan(db, authz, user, gcn_id)
    res = _chay(lambda: chot_svc.chot(
        db, user=user, gcn_id=gcn_id, expected_version=body.version, sl_cuoi=body.sl_cuoi,
        noi_ve=body.noi_ve, dich_cong_viec_id=body.dich_cong_viec_id,
        ngay_khach_nhan=body.ngay_khach_nhan))
    if res["ban_giao"]:
        phat_ban_giao(res["ban_giao"])
    if res.get("toa"):
        # Số toả sang bước riêng từng lệnh (bàn giao đã xác nhận) — bàn tổ nhận tự nạp lại. Gói
        # không nói tổ nào ⇒ mọi người có Bàn tổ, cộng các màn theo lệnh (nhóm `san_xuat`).
        hub.gui({"type": "san_xuat_cong_viec_changed", "lsx_id": res["lsx_ids"][0],
                 "lsx_ids": res["lsx_ids"]}, **kem_ban_to(MAN_THEO_LENH, ()))
    _phat_cho_chi(res, user, db)
    _phat_doi(res["lsx_ids"], res.get("bai_ghep_id"))
    return _ra(db, authz, user, gcn_id)


@router.post("/{gcn_id}/mo-lai", response_model=GiaCongNgoaiOut)
def mo_lai(
    gcn_id: int,
    body: MoLaiIn,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> dict:
    _gac_lan(db, authz, user, gcn_id)
    res = _chay(lambda: chot_svc.mo_lai(db, user=user, gcn_id=gcn_id,
                                         expected_version=body.version))
    hub.gui({"type": "gia_cong_cho_chi_changed"}, quyen=MAN_MUA_KE_TOAN)
    # Bàn tổ của bước sau / màn KCS / kho vừa mất một bàn giao hoặc đề nghị. Không biết tổ nào ⇒
    # mọi người có Bàn tổ + màn theo lệnh (nhóm `san_xuat`).
    hub.gui({"type": "san_xuat_cong_viec_changed",
             "lsx_id": (res["lsx_ids"] or [None])[0], "lsx_ids": res["lsx_ids"]},
            **kem_ban_to(MAN_THEO_LENH, ()))
    _phat_doi(res["lsx_ids"], res.get("bai_ghep_id"))
    return _ra(db, authz, user, gcn_id)


@router.post("/lenh/{lsx_id}/tron-goi", response_model=GiaCongNgoaiOut)
def dat_tron_goi(
    lsx_id: int,
    body: TronGoiIn,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> dict:
    _gac_lenh(db, authz, user, lsx_id)
    kq = _chay(lambda: tron_goi.dat_tron_goi(
        db, user=user, lsx_id=lsx_id, nha_cung_cap_id=body.nha_cung_cap_id, sl_dat=body.sl_dat,
        xuong_cap_giay=body.xuong_cap_giay))
    _phat_doi(lsx_id)
    return _ra(db, authz, user, kq["gia_cong_ngoai_id"])


@router.post("/{gcn_id}/huy-tron-goi", response_model=GiaCongNgoaiOut)
def huy_tron_goi(
    gcn_id: int,
    body: HuyTronGoiIn,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> dict:
    _gac_lan(db, authz, user, gcn_id)
    kq = _chay(lambda: tron_goi.huy_tron_goi(db, user=user, gcn_id=gcn_id,
                                              expected_version=body.version, ly_do=body.ly_do))
    _phat_doi_lan(db, gcn_id)
    return _ra(db, authz, user, gcn_id)


@router.post("/{gcn_id}/xuat-giay", response_model=GiaCongNgoaiOut)
def xuat_giay(
    gcn_id: int,
    body: XuatGiayIn,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> dict:
    _gac_lan(db, authz, user, gcn_id)
    _chay(lambda: tron_goi.de_nghi_xuat_giay(
        db, user=user, gcn_id=gcn_id, expected_version=body.version,
        kho_rong=body.kho_rong, kho_dai=body.kho_dai, so_to=body.so_to))
    _phat_doi_lan(db, gcn_id)
    return _ra(db, authz, user, gcn_id)
