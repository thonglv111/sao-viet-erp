"""Đơn thương mại — chỉ In Hà Phương (phân hệ `thuong_mai`, docs/design-hang-thuong-mai-ha-phuong.md §6).

Dùng chung quyền màn Đơn hàng bán (`don_hang_ban`), không thêm mục thanh bên. Bản cài không bật phân hệ
thì mọi đường ở đây trả 404. Chốt / huỷ / cọc của đơn thương mại đi đường `/api/orders` như đơn sản xuất.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_authorization_service, get_order_service, require_permission
from ..models.user import User
from ..phan_he import GIAO_HANG_HP, THUONG_MAI, chan_khi_tat, tat
from ..schemas.giao_hang_hp import PhuongThucGiaoIn
from ..schemas.order import OrderDetailOut
from ..services.order_service import OrderService
from ..services.rbac_service import AuthorizationService
from ..services.quyen_kho import kho_duoc
from ..services.thuong_mai.don_thuong_mai import (
    DonThuongMaiError, DonThuongMaiNotFound, DonThuongMaiService, la_don_thuong_mai,
)
from ..services.thuong_mai.luot_xuat import LuotXuatService, da_dung_theo_dong

router = APIRouter(prefix="/api/thuong-mai", tags=["thuong-mai"],
                   dependencies=[Depends(chan_khi_tat(THUONG_MAI))])

MODULE = "don_hang_ban"
Service = Annotated[OrderService, Depends(get_order_service)]
Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]
Db = Annotated[Session, Depends(get_db)]


class DongThuongMaiIn(BaseModel):
    hang_id: int
    dvt: str | None = Field(None, max_length=24)
    qty: float = Field(gt=0)
    # Đơn giá trước VAT. Vắng = lấy giá bán khai theo ĐVT ở danh mục.
    don_gia: float | None = Field(None, ge=0)
    vat_pct: int = Field(0, ge=0, le=100)


class DuKienIn(BaseModel):
    """Lựa chọn Xuất hàng + Thanh toán của đơn nháp, giữ lại để mở Sửa thấy đúng (14/11/2026)."""
    xuat_ngay: bool = True
    kho_id: int | None = None
    phuong_thuc: PhuongThucGiaoIn | None = None
    tra_ngay: bool = False
    cach_nhan: str | None = Field(None, max_length=16)
    company_bank_account_id: int | None = None


class DonThuongMaiIn(BaseModel):
    customer_id: int
    lines: list[DongThuongMaiIn] = Field(min_length=1)
    deposit_pct: float | None = None
    deposit_amount: int | None = Field(None, ge=0)
    ghi_chu: str | None = Field(None, max_length=1000)
    # Vắng ⇒ giữ dự kiến cũ (nếu có).
    du_kien: DuKienIn | None = None


class DongDonThuongMaiIn(BaseModel):
    lines: list[DongThuongMaiIn] = Field(min_length=1)


def _scope(authz: AuthorizationService, user: User) -> str:
    return authz.scope_for(user, MODULE) or "own"


def _loi(e: Exception) -> HTTPException:
    if isinstance(e, DonThuongMaiNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


def _don_cua(svc: OrderService, authz: AuthorizationService, user: User, order_id: int):
    order = svc.repo.get_with_lines(order_id)
    if (order is None or not la_don_thuong_mai(order)
            or not svc.repo.can_access(order=order, scope=_scope(authz, user), actor=user)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy đơn thương mại")
    return order


@router.post("/don", response_model=OrderDetailOut, status_code=status.HTTP_201_CREATED)
def tao_don(
    body: DonThuongMaiIn, svc: Service, db: Db,
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> OrderDetailOut:
    from .orders import _order_changed

    tm = DonThuongMaiService(db, svc.repo, svc.audit)
    try:
        order = tm.tao(actor=user, customer_id=body.customer_id,
                       lines=[ln.model_dump() for ln in body.lines],
                       deposit_pct=body.deposit_pct, deposit_amount=body.deposit_amount,
                       ghi_chu=body.ghi_chu, du_kien=body.du_kien.model_dump() if body.du_kien else None)
    except (DonThuongMaiError, DonThuongMaiNotFound) as e:
        db.rollback()
        raise _loi(e) from None
    _order_changed(order.order_no)
    return svc._detail(svc.repo.get_with_lines(order.id))


@router.put("/don/{order_id}/dong", response_model=OrderDetailOut)
def sua_dong(
    order_id: int, body: DongDonThuongMaiIn, svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> OrderDetailOut:
    order = _don_cua(svc, authz, user, order_id)
    tm = DonThuongMaiService(db, svc.repo, svc.audit)
    try:
        tm.sua_dong(order=order, actor=user, lines=[ln.model_dump() for ln in body.lines])
    except (DonThuongMaiError, DonThuongMaiNotFound) as e:
        db.rollback()
        raise _loi(e) from None
    return svc._detail(svc.repo.get_with_lines(order_id))


@router.put("/don/{order_id}", response_model=OrderDetailOut)
def sua_don(
    order_id: int, body: DonThuongMaiIn, svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> OrderDetailOut:
    """Lưu nháp từ trang Sửa đơn (14/11/2026): sửa trọn khách, dòng, cọc, ghi chú của đơn còn nháp."""
    from .orders import _order_changed

    order = _don_cua(svc, authz, user, order_id)
    tm = DonThuongMaiService(db, svc.repo, svc.audit)
    try:
        tm.sua_don(order=order, actor=user, customer_id=body.customer_id,
                   lines=[ln.model_dump() for ln in body.lines],
                   deposit_pct=body.deposit_pct, deposit_amount=body.deposit_amount, ghi_chu=body.ghi_chu,
                   du_kien=body.du_kien.model_dump() if body.du_kien else None)
    except (DonThuongMaiError, DonThuongMaiNotFound) as e:
        db.rollback()
        raise _loi(e) from None
    _order_changed(order.order_no)
    return svc._detail(svc.repo.get_with_lines(order_id))


# --- Lượt xuất ---------------------------------------------------------------------------------

class DongXuatIn(BaseModel):
    order_line_id: int
    qty: float = Field(ge=0)


class XuatHangIn(BaseModel):
    kho_id: int
    lines: list[DongXuatIn] = Field(min_length=1)
    ghi_chu: str | None = Field(None, max_length=500)
    # Người bán có quyền ghi sổ kho đó ⇒ lập phiếu + ghi sổ luôn trong một lần bấm.
    ghi_so: bool = False
    # Cách giao của lượt — chỉ đọc khi bản cài bật `giao_hang_hp` (docs/design-giao-hang-ha-phuong.md §3).
    phuong_thuc: PhuongThucGiaoIn | None = None


class DongLuotOut(BaseModel):
    order_line_id: int
    ten: str
    don_vi_tinh: str | None = None
    qty: int
    qty_thuc: int | None = None
    gia_von: int | None = None  # tiền: None khi không có ô Xem giá thành của Kho


class LuotXuatOut(BaseModel):
    id: int
    ma: str
    kho_id: int
    kho_ten: str | None = None
    trang_thai: str
    stock_request_id: int | None = None
    stock_request_ma: str | None = None
    nguoi_lap: str | None = None
    created_at: str
    xuat_luc: str | None = None
    ghi_chu: str | None = None
    dong: list[DongLuotOut]


class KhoXuatOut(BaseModel):
    id: int
    ma: str
    ten: str
    ghi_so_duoc: bool


class XuatHangState(BaseModel):
    luot: list[LuotXuatOut]
    # SL còn xuất được của từng dòng đơn (đã trừ lượt chờ + lượt đã xuất).
    con_lai: dict[int, int]
    kho: list[KhoXuatOut]


def _ghi_so_duoc(authz: AuthorizationService, user: User, kho_id: int) -> bool:
    """Cùng luật ghi sổ ở màn Kho (`kho_voucher.post_voucher`): ô Lập phiếu của Kho. Dòng quyền từng kho
    chỉ gác đọc số tồn, không gác ghi sổ — ở đây cũng vậy."""
    return authz.can(user, "kho", "create")


def _luot_out(db: Session, luots, order, xem_gia: bool) -> list[LuotXuatOut]:
    from ..models.kho_hang import KhoHang
    from ..models.stock_request import StockRequest

    ten_dong = {ln.id: (ln.description, ln.don_vi_tinh) for ln in order.lines}
    ra = []
    for l in luots:
        kho = db.get(KhoHang, l.kho_id)
        req = db.get(StockRequest, l.stock_request_id) if l.stock_request_id else None
        nguoi = db.get(User, l.nguoi_lap_id) if l.nguoi_lap_id else None
        ra.append(LuotXuatOut(
            id=l.id, ma=l.ma, kho_id=l.kho_id, kho_ten=(kho.ten if kho else None),
            trang_thai=l.trang_thai, stock_request_id=l.stock_request_id,
            stock_request_ma=(req.ma if req else None),
            nguoi_lap=(nguoi.name or nguoi.username) if nguoi else None,
            created_at=l.created_at.isoformat(), xuat_luc=(l.xuat_luc.isoformat() if l.xuat_luc else None),
            ghi_chu=l.ghi_chu,
            dong=[DongLuotOut(order_line_id=d.order_line_id, ten=ten_dong.get(d.order_line_id, ("", None))[0],
                              don_vi_tinh=ten_dong.get(d.order_line_id, ("", None))[1], qty=d.qty,
                              qty_thuc=d.qty_thuc, gia_von=(d.gia_von if xem_gia else None))
                  for d in l.dong],
        ))
    return ra


def _state(db: Session, authz: AuthorizationService, user: User, order) -> XuatHangState:
    from ..models.kho_hang import KhoHang

    svc = LuotXuatService(db, request_service=None)
    da = da_dung_theo_dong(db, order.id)
    duoc = kho_duoc(authz, user, "read")
    # Chỉ kho có cờ kho hàng thương mại (13/11/2026) — tick ở danh mục Kho hàng.
    khos = db.query(KhoHang).filter(KhoHang.active.is_(True), KhoHang.la_kho_thuong_mai.is_(True)).order_by(
        KhoHang.ten).all()
    return XuatHangState(
        luot=_luot_out(db, svc.danh_sach(order.id), order, authz.can(user, "kho", "view_cost")),
        con_lai={ln.id: max(int(ln.qty or 0) - da.get(ln.id, 0), 0) for ln in order.lines},
        # Kho người bán xuất được: mọi kho hàng thương mại đang dùng (yêu cầu xuất ai cũng gửi được).
        # Kho người đó có dòng quyền xếp trước — mặc định chọn kho đầu.
        kho=sorted([KhoXuatOut(id=k.id, ma=k.ma, ten=k.ten, ghi_so_duoc=_ghi_so_duoc(authz, user, k.id))
                    for k in khos], key=lambda k: (k.id not in duoc, k.ten)),
    )


@router.get("/kho-xuat", response_model=list[KhoXuatOut])
def kho_xuat(
    db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> list[KhoXuatOut]:
    """Kho chọn được ở trang Tạo đơn (khối Xuất hàng) — cùng danh sách, cùng thứ tự hộp Xuất hàng."""
    from ..models.kho_hang import KhoHang

    duoc = kho_duoc(authz, user, "read")
    # Chỉ kho có cờ kho hàng thương mại (13/11/2026) — tick ở danh mục Kho hàng.
    khos = db.query(KhoHang).filter(KhoHang.active.is_(True), KhoHang.la_kho_thuong_mai.is_(True)).order_by(
        KhoHang.ten).all()
    return sorted([KhoXuatOut(id=k.id, ma=k.ma, ten=k.ten, ghi_so_duoc=_ghi_so_duoc(authz, user, k.id))
                   for k in khos], key=lambda k: (k.id not in duoc, k.ten))


class TonHoiIn(BaseModel):
    kho_id: int | None = None
    lines: list[DongThuongMaiIn] = Field(min_length=1, max_length=200)


class TonDongOut(BaseModel):
    hang_id: int
    dvt: str
    ton: float


@router.post("/ton", response_model=list[TonDongOut])
def ton_dong(
    body: TonHoiIn, db: Db,
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> list[TonDongOut]:
    """Tồn từng dòng của trang Tạo đơn, tính theo ĐVT của dòng: ở kho xuất đang chọn, hoặc cộng mọi
    kho khi chưa chọn. Không có tiền."""
    from ..services.thuong_mai.ban_nhanh import ton_theo_dvt
    from .kho_voucher import _hang_service

    hang = _hang_service(db)
    ra: list[TonDongOut] = []
    for ln in body.lines:
        dvt = (ln.dvt or "").strip().lower()
        if not dvt:
            continue
        ra.append(TonDongOut(hang_id=ln.hang_id, dvt=dvt,
                             ton=ton_theo_dvt(db, hang, body.kho_id, ln.hang_id, dvt)))
    return ra


class ThuNgayIn(BaseModel):
    receipt_method: str
    amount: int = Field(gt=0)
    company_bank_account_id: int | None = None
    bank_reference: str | None = Field(None, max_length=64)


class XuatNgayIn(BaseModel):
    kho_id: int
    ghi_so: bool = False
    phuong_thuc: PhuongThucGiaoIn | None = None


class BanNhanhIn(DonThuongMaiIn):
    """Trang Tạo đơn thương mại: `thu` có ⇒ khách trả ngay (phiếu thu theo đơn), `xuat` có ⇒ xuất hết
    hàng ngay. Cả hai vắng ⇒ tạo và chốt đơn."""
    thu: ThuNgayIn | None = None
    xuat: XuatNgayIn | None = None


@router.post("/ban-nhanh", response_model=OrderDetailOut, status_code=status.HTTP_201_CREATED)
def ban_nhanh(
    body: BanNhanhIn, svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> OrderDetailOut:
    return _ban_nhanh(body, svc, db, authz, user)


@router.post("/don/{order_id}/ban-nhanh", response_model=OrderDetailOut)
def ban_nhanh_don_nhap(
    order_id: int, body: BanNhanhIn, svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> OrderDetailOut:
    """Trang Sửa đơn (14/11/2026): đơn nháp có sẵn đi đúng đường của trang Tạo — lưu trọn đơn, chốt, xuất
    hết hàng và/hoặc thu tiền trong một lần bấm."""
    return _ban_nhanh(body, svc, db, authz, user, order=_don_cua(svc, authz, user, order_id))


def _ban_nhanh(body: BanNhanhIn, svc: OrderService, db: Session, authz: AuthorizationService, user: User,
               order=None) -> OrderDetailOut:
    from ..models.customer import Customer
    from ..services.ban_hang_cho_thu_chi import bao_hang_cho
    from ..services.order_service import OrderError
    from ..services.stock_voucher_service import StockVoucherError
    from ..services.thanh_pham_khai_bao import ma_don_vi
    from ..services.thuong_mai import ban_nhanh as bn
    from ..services.thuong_mai.luot_xuat import kho_ghi_so_luot_xuat
    from .kho_request import get_service as yeu_cau_service
    from .kho_voucher import get_service as phieu_service
    from .orders import _order_changed

    # Quyền gác ở máy chủ, trước mọi thứ: thu tiền = lập phiếu thu; ghi sổ = ô Lập phiếu của Kho.
    if body.thu is not None and not authz.can(user, "phieu_thu", "create"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Bạn chưa có quyền lập phiếu thu — chọn Thanh toán sau.")
    if body.xuat is not None and body.xuat.ghi_so and not _ghi_so_duoc(authz, user, body.xuat.kho_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Bạn chưa có quyền ghi sổ kho này — bỏ chọn ghi sổ để gửi yêu cầu cho kho.")

    # 1) Kiểm hết trước khi ghi dòng đầu tiên.
    pt_cot = None
    phieu = phieu_service(db)
    try:
        if not body.customer_id or db.get(Customer, int(body.customer_id)) is None:
            raise DonThuongMaiError("Chọn khách hàng cho đơn.")
        dong = bn.chuan_dong(db, [ln.model_dump() for ln in body.lines])
        tong = bn.tong_gom_vat(dong)
        if body.thu is not None:
            bn.kiem_thu(bn.ThuNgay(**body.thu.model_dump()), tong)
        if body.xuat is not None:
            bn.kiem_kho(db, body.xuat.kho_id)
            if not tat(GIAO_HANG_HP):
                from ..services.giao_hang_hp import phuong_thuc as pt_svc

                try:
                    pt_cot = pt_svc.kiem(db, body.xuat.phuong_thuc.model_dump() if body.xuat.phuong_thuc else None)
                except pt_svc.PhuongThucLoi as e:
                    raise DonThuongMaiError(str(e)) from None
            if body.xuat.ghi_so:
                bn.kiem_ton(phieu.hang, phieu, body.xuat.kho_id, dong,
                            [ma_don_vi(db, d["don_vi_tinh"]) or "" for d in dong],
                            bn.bang_ten_dvt(db))
    except (DonThuongMaiError, DonThuongMaiNotFound) as e:
        db.rollback()
        raise _loi(e) from None

    # 2) Tạo (hoặc lưu trọn đơn nháp có sẵn) + chốt.
    tm = DonThuongMaiService(db, svc.repo, svc.audit)
    co_san = order is not None
    try:
        kw = dict(actor=user, customer_id=body.customer_id, lines=[ln.model_dump() for ln in body.lines],
                  deposit_pct=(None if body.thu else body.deposit_pct),
                  deposit_amount=(None if body.thu else body.deposit_amount), ghi_chu=body.ghi_chu)
        order = tm.sua_don(order=order, **kw) if co_san else tm.tao(**kw)
    except (DonThuongMaiError, DonThuongMaiNotFound) as e:
        db.rollback()
        raise _loi(e) from None
    scope = _scope(authz, user)

    def _do_dang(buoc: str, e: Exception) -> HTTPException:
        db.rollback()
        _order_changed(order.order_no)
        return HTTPException(status_code=status.HTTP_409_CONFLICT,
                             detail=f"Đã {'lưu' if co_san else 'tạo'} đơn {order.order_no} nhưng chưa {buoc}: {e}")

    try:
        svc.confirm(order_id=order.id, actor=user, scope=scope)
    except OrderError as e:
        raise _do_dang("chốt được", e) from None
    bao_hang_cho(db, svc.accounting_repo, actor_id=user.id, order_id=order.id,
                 order_code=order.order_no, coc_moi=body.thu is None)

    # 3) Xuất hết hàng.
    if body.xuat is not None:
        yc = yeu_cau_service(db)
        lx = LuotXuatService(db, request_service=yc, voucher_service=phieu)
        o = svc.repo.get_with_lines(order.id)
        pt_row = None
        try:
            luot, req = lx.tao(order=o, actor=user, kho_id=body.xuat.kho_id,
                               lines=[{"order_line_id": ln.id, "qty": ln.qty} for ln in o.lines])
            if pt_cot is not None:
                pt_row = pt_svc.ghi(db, order_id=o.id, actor=user, cot=pt_cot,
                                    luot_xuat_tm_id=luot.id, ma_lan_xuat=luot.ma)
            db.commit()
        except (DonThuongMaiError, DonThuongMaiNotFound) as e:
            raise _do_dang("xuất hàng", e) from None
        loi_ghi_so = None
        if body.xuat.ghi_so:
            try:
                lx.ghi_so_ngay(req=req, actor=user)
                kho_ghi_so_luot_xuat(db, req.id)
            except (DonThuongMaiError, StockVoucherError) as e:
                db.rollback()
                loi_ghi_so = str(e)
        if loi_ghi_so or not body.xuat.ghi_so:
            yc.thong_bao_yeu_cau_moi(db.get(type(req), req.id))
        if pt_row is not None:
            pt_svc.bao_nguoi_giao(db, pt_row, o)
        if loi_ghi_so:
            raise _do_dang(f"ghi sổ kho (yêu cầu xuất {req.ma} đã gửi kho)", Exception(loi_ghi_so))

    # 4) Thu tiền.
    if body.thu is not None:
        from ..schemas.order import OrderDepositReceiptIn

        try:
            svc.add_deposit_receipt(order_id=order.id, actor=user, scope=scope, payload=OrderDepositReceiptIn(
                receipt_method=body.thu.receipt_method, amount=body.thu.amount,
                company_bank_account_id=body.thu.company_bank_account_id,
                bank_reference=body.thu.bank_reference))
        except OrderError as e:
            raise _do_dang("lập phiếu thu", e) from None

    _order_changed(order.order_no)
    db.expire_all()
    return svc._detail(svc.repo.get_with_lines(order.id))


@router.get("/don/{order_id}/xuat", response_model=XuatHangState)
def xem_xuat(
    order_id: int, svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> XuatHangState:
    return _state(db, authz, user, _don_cua(svc, authz, user, order_id))


@router.post("/don/{order_id}/xuat", response_model=XuatHangState, status_code=status.HTTP_201_CREATED)
def xuat_hang(
    order_id: int, body: XuatHangIn, svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> XuatHangState:
    from .kho_request import get_service as yeu_cau_service
    from .kho_voucher import get_service as phieu_service

    order = _don_cua(svc, authz, user, order_id)
    if body.ghi_so and not _ghi_so_duoc(authz, user, body.kho_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Bạn chưa có quyền ghi sổ kho này — bỏ chọn ghi sổ để gửi yêu cầu cho kho.")
    # Bản cài bật giao hàng kiểu Hà Phương: bắt chọn cách giao, kiểm TRƯỚC khi lập lượt.
    pt_cot = None
    if not tat(GIAO_HANG_HP):
        from ..services.giao_hang_hp import phuong_thuc as pt_svc

        try:
            pt_cot = pt_svc.kiem(db, body.phuong_thuc.model_dump() if body.phuong_thuc else None)
        except pt_svc.PhuongThucLoi as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None
    yc = yeu_cau_service(db)
    lx = LuotXuatService(db, request_service=yc, voucher_service=phieu_service(db))
    pt_row = None
    try:
        luot, req = lx.tao(order=order, actor=user, kho_id=body.kho_id,
                           lines=[d.model_dump() for d in body.lines], ghi_chu=body.ghi_chu)
        if pt_cot is not None:
            pt_row = pt_svc.ghi(db, order_id=order.id, actor=user, cot=pt_cot,
                                luot_xuat_tm_id=luot.id, ma_lan_xuat=luot.ma)
        db.commit()
    except (DonThuongMaiError, DonThuongMaiNotFound) as e:
        db.rollback()
        raise _loi(e) from None
    loi_ghi_so = None
    if body.ghi_so:
        from ..services.stock_voucher_service import StockVoucherError
        from ..services.thuong_mai.luot_xuat import kho_ghi_so_luot_xuat

        try:
            lx.ghi_so_ngay(req=req, actor=user)
            kho_ghi_so_luot_xuat(db, req.id)
        except (DonThuongMaiError, StockVoucherError) as e:
            db.rollback()
            loi_ghi_so = str(e)
    if loi_ghi_so or not body.ghi_so:
        # Yêu cầu nằm ở kho chờ lập phiếu ⇒ báo người giữ kho (badge + chuông), SAU commit.
        yc.thong_bao_yeu_cau_moi(db.get(type(req), req.id))
    if pt_row is not None:
        pt_svc.bao_nguoi_giao(db, pt_row, order)
    from .orders import _order_changed

    _order_changed(order.order_no)
    if loi_ghi_so:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"Đã gửi yêu cầu xuất {req.ma} cho kho, nhưng chưa ghi sổ được: {loi_ghi_so}")
    db.expire_all()
    return _state(db, authz, user, svc.repo.get_with_lines(order_id))
