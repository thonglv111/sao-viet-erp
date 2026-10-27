"""Thêm / Xoá / Import / Export hàng NGAY TRÊN MÀN TỒN KHO của một kho (28/10/2026).

Cả bốn việc là MỘT ô quyền chi tiết của dòng kho: `ton_kho_<id>:adjust` (cột `can_adjust` dùng lại —
cột quyền đi theo từng module). Bật ô này thì ô Xem giá thành của kho đó bật kèm (ma trận ép), nên ai
tới được đây cũng thấy tiền. Luật nằm ở `services/kho_nhap_tay.py`.
"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..db import SessionLocal, get_db
from ..deps import get_authorization_service, get_current_user
from ..models.user import User
from ..schemas.kho_nhap_tay import HangThemIn, HangXoaIn, HangXoaOut, NhapTayOut
from ..services.catalog_excel import ExcelSaiMan
from ..services.kho_giay import chuan_kho
from ..services.kho_nhap_tay import DongVao, KetQua, KhoNhapTayError, KhoNhapTayService
from ..services.quyen_kho import khoa_kho
from ..services.rbac_service import AuthorizationService
from ..tai_len import TRAN_EXCEL, doc_gioi_han

router = APIRouter(prefix="/api/kho/ton/{kho_id}/hang", tags=["kho-nhap-tay"])

Db = Annotated[Session, Depends(get_db)]
Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]
_log = logging.getLogger(__name__)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _svc(db: Session) -> KhoNhapTayService:
    # Dựng service kho KHÔNG kèm giữ chỗ: giảm tồn ở đây là đặt lại số đếm được, không phải xuất cho
    # lệnh — không chặn vì phần lệnh đang giữ; giữ chỗ tính lại sau commit (`_sau_ghi`).
    from .delivery import _stock_voucher_service

    return KhoNhapTayService(db, _stock_voucher_service(db))


def _quyen(authz: AuthorizationService, user: User, kho_id: int) -> None:
    khoa = khoa_kho(kho_id)
    if not (authz.can(user, khoa, "read") and authz.can(user, khoa, "adjust")):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            detail="Cần quyền chi tiết “Thêm, xoá, import, export hàng” của kho này.")


def _sau_ghi_nen() -> None:
    """Bảng cân đối vật tư cache theo tồn ⇒ xoá cache + báo màn Kế hoạch vật tư, rồi nhặt thêm giữ
    chỗ cho lệnh đang chờ (hàng vừa tăng). Session mới — session của request đã đóng."""
    from .kho_voucher import _giu_cho_service

    db = SessionLocal()
    try:
        g = _giu_cho_service(db)
        g.sau_ghi_so()
        g.nhat_them()
    except Exception:  # noqa: BLE001 — việc nền, không còn ai để báo lỗi
        db.rollback()
        _log.exception("Tính lại giữ chỗ sau nhập tay kho lỗi")
    finally:
        db.close()


def _out(kq: KetQua) -> NhapTayOut:
    return NhapTayOut(
        hop_le=kq.hop_le, tong_dong=kq.tong_dong, tao_moi=kq.tao_moi, cap_nhat=kq.cap_nhat,
        khong_doi=kq.khong_doi, da_ghi=kq.da_ghi,
        loi=[{"sheet": "Tồn kho", "dong": x.dong, "cot": x.cot, "ly_do": x.ly_do} for x in kq.loi],
        thay_doi=[vars(x) for x in kq.thay_doi], canh_bao=[vars(x) for x in kq.canh_bao],
    )


@router.post("/them", response_model=NhapTayOut)
def them_hang(kho_id: int, payload: HangThemIn, db: Db, authz: Authz, nen: BackgroundTasks,
              user: Annotated[User, Depends(get_current_user)]) -> NhapTayOut:
    """Form Thêm hàng — một dòng, cùng luật với một dòng file. `xem_truoc=true` chạy thật rồi
    rollback: form dùng để biết dòng là THÊM MỚI hay CẬP NHẬT (cũ → mới) trước khi bấm Lưu."""
    _quyen(authz, user, kho_id)
    d = payload.model_dump()
    xem = d.pop("xem_truoc")
    try:
        kq = _svc(db).chay(kho_id, [DongVao(dong=0, **d)], user, ghi=not xem)
    except KhoNhapTayError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from None
    if kq.da_ghi:
        nen.add_task(_sau_ghi_nen)
    return _out(kq)


@router.post("/xoa", response_model=HangXoaOut)
def xoa_hang(kho_id: int, payload: HangXoaIn, db: Db, authz: Authz, nen: BackgroundTasks,
             user: Annotated[User, Depends(get_current_user)]) -> HangXoaOut:
    _quyen(authz, user, kho_id)
    khoas = []
    for x in payload.dong:
        kr, kd = chuan_kho(x.kho_rong, x.kho_dai)
        khoas.append((x.hang_loai, x.hang_id, kr, kd, (x.don_vi_goc or "").strip().lower()))
    try:
        so = _svc(db).xoa(kho_id, khoas, user)
    except KhoNhapTayError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    nen.add_task(_sau_ghi_nen)
    return HangXoaOut(so_lo=so)


@router.get("/mau-excel")
def mau_excel(kho_id: int, db: Db, authz: Authz,
              user: Annotated[User, Depends(get_current_user)]) -> Response:
    _quyen(authz, user, kho_id)
    svc = _svc(db)
    kho = svc.kho(kho_id)
    return Response(content=svc.tao_file(kho_id, None), media_type=XLSX, headers={
        "Content-Disposition": f'attachment; filename="mau-nhap-ton-{kho.ma}.xlsx"'})


@router.get("/xuat-excel")
def xuat_excel(kho_id: int, db: Db, authz: Authz,
               user: Annotated[User, Depends(get_current_user)]) -> Response:
    _quyen(authz, user, kho_id)
    svc = _svc(db)
    kho = svc.kho(kho_id)
    return Response(content=svc.tao_file(kho_id, svc.dong_ton(kho_id)), media_type=XLSX, headers={
        "Content-Disposition": f'attachment; filename="ton-kho-{kho.ma}.xlsx"'})


@router.post("/import-excel", response_model=NhapTayOut)
def import_excel(kho_id: int, db: Db, authz: Authz, nen: BackgroundTasks,
                 user: Annotated[User, Depends(get_current_user)],
                 file: UploadFile = File(...),
                 mode: str = Query(default="preview", pattern="^(preview|commit)$")) -> NhapTayOut:
    """CẢ FILE một giao dịch. `preview` chạy y hệt `commit` rồi rollback — số xem trước là số thật
    (như import khách hàng)."""
    _quyen(authz, user, kho_id)
    svc = _svc(db)
    try:
        dong = svc.doc_file(kho_id, doc_gioi_han(file, TRAN_EXCEL, cho_rong=True))
        kq = svc.chay(kho_id, dong, user, ghi=(mode == "commit"))
    except ExcelSaiMan as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from None
    except KhoNhapTayError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from None
    if kq.da_ghi:
        nen.add_task(_sau_ghi_nen)
    return _out(kq)
