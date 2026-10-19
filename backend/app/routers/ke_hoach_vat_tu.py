"""Router — Kế hoạch vật tư (bảng cân đối) của Kế hoạch sản xuất.

Prefix `/api/ke-hoach-vat-tu`. MODULE quyền RIÊNG = `ke_hoach_vat_tu` (tách khỏi `san_xuat` ngày
17/08/2026 — một ô quyền cho mỗi màn; migration 0209 sao chép quyền cũ sang nên không ai mất
đường làm việc). Màn này bày GIÁ vật tư và số phải mua, không phải thứ mặc nhiên đi kèm quyền xem
lệnh sản xuất.

Hai cửa, hai mức quyền khác nhau có chủ ý:
* `GET /can-doi` — chỉ cần đọc `ke_hoach_vat_tu`. Bảng này là công cụ NHÌN, ai lo sản xuất đều xem được.
* `POST /de-nghi-mua` — đòi ĐÚNG quyền tạo yêu cầu mua cho bộ phận, kiểm qua chính
  `PurchaseService.can_create_department_request`. Không lách bằng cách tự chèn quyền ở đây: một
  cửa mới mà tự phán quyền là một lỗ mà bảng phân quyền không nhìn thấy.

Dependency dựng INLINE (`get_service`) theo lối `routers/kho_request.py`, không nhét vào `deps.py`.
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import CurrentUser, get_purchase_service, require_permission
from ..services.can_doi_cache import bang_can_doi, lay_hoac_tinh, xoa_cache_can_doi
from ..services import luoi_vat_tu
from ..services.kho_giay import co_don_vi_goc
from ..repositories.bai_ghep_repo import BaiGhepRepository
from ..repositories.don_vi_do_repo import DonViDoRepository
from ..repositories.lsx_repo import LsxRepository
from ..repositories.purchase_repo import PurchaseRequestRepository, SupplierRepository
from ..repositories.stock_lot_repo import StockLotRepository
from ..repositories.stock_request_repo import StockRequestRepository
from ..repositories.vat_lieu_kho_repo import VatLieuKhoRepository
from ..schemas.ke_hoach_vat_tu import (
    CanDoiOut,
    DeNghiMuaIn,
    DeNghiMuaOut,
    DeNghiMuaXemTruocOut,
    GiuChoIn,
    GiuChoNhieuIn,
    GiuChoNhieuOut,
    LuoiHangOut,
    LuoiLenhOut,
    LuoiOut,
    TheoLenhOut,
    TheoLenhRow,
)
from ..services.giu_cho_service import GiuChoError, GiuChoService
from ..services.ke_hoach_vat_tu_service import (
    KeHoachVatTuError,
    KeHoachVatTuService,
)
from ..services.purchase_service import PurchaseError, PurchaseForbidden, PurchaseService
from ..services.vat_lieu_kho_service import VatLieuKhoService

router = APIRouter(prefix="/api/ke-hoach-vat-tu", tags=["ke-hoach-vat-tu"])
MODULE = "ke_hoach_vat_tu"


def get_service(db: Annotated[Session, Depends(get_db)]) -> KeHoachVatTuService:
    return KeHoachVatTuService(
        db,
        lsx_repo=LsxRepository(db),
        bai_ghep_repo=BaiGhepRepository(db),
        hang=VatLieuKhoService(VatLieuKhoRepository(db), DonViDoRepository(db)),
        lots=StockLotRepository(db),
        requests=StockRequestRepository(db),
        purchases=PurchaseRequestRepository(db),
        suppliers=SupplierRepository(db),
        don_vi=DonViDoRepository(db),
    )


def get_giu_cho(svc: Annotated[KeHoachVatTuService, Depends(get_service)],
                db: Annotated[Session, Depends(get_db)]) -> GiuChoService:
    """Giữ chỗ ăn CHUNG bảng cân đối với `/can-doi` trong cùng một request.

    Dùng lại `get_service` chứ không dựng bảng thứ hai: FastAPI cache dependency theo request, nên
    hai cửa của cùng một lần bấm nhìn đúng một bản số. Dựng riêng là mở đường cho hai con số lệch
    nhau ngay trong một màn hình.
    """
    return GiuChoService(db, svc)


Service = Annotated[KeHoachVatTuService, Depends(get_service)]
GiuCho = Annotated[GiuChoService, Depends(get_giu_cho)]
# Service thu mua THẬT (dependency dùng chung với `routers/purchases.py`) — nút "Đề nghị mua" đi
# đúng cửa đang chạy, không đẻ đường tạo yêu cầu mua thứ hai. Hai đường tạo là hai bộ luật, và bộ
# nào cũng sẽ có lúc quên cập nhật.
ThuMua = Annotated[PurchaseService, Depends(get_purchase_service)]


@router.get("/can-doi", response_model=CanDoiOut)
def can_doi(
    svc: Service,
    giu: GiuCho,
    _user: Annotated[object, Depends(require_permission(MODULE, "read"))],
    q: str | None = Query(default=None, description="Mã lệnh / mã hoặc tên mặt hàng"),
    chi_thieu: bool = Query(default=False, description="Chỉ nhóm có dòng đỏ"),
    hang_loai: Literal["giay", "vat_tu"] | None = Query(default=None, description="Loại hàng"),
    tinh_trang: Literal["thieu", "khong_ro", "du"] | None = Query(
        default=None, description="Tab: nhóm đang thiếu / chưa rõ đơn vị / đã đủ"),
) -> CanDoiOut:
    try:
        # Cache 45 giây theo (q, chi_thieu) — kết quả không phụ thuộc người gọi (xem
        # `services/can_doi_cache.py`); xoá sớm khi có `ke_hoach_vat_tu_thay_doi`/`lsx_changed`.
        bang = bang_can_doi(svc, giu, q=q or "", chi_thieu=bool(chi_thieu))
    except KeHoachVatTuError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    # Tab + điều kiện lọc chạy SAU cache: đổi tab không dựng lại bảng toàn xưởng.
    items, dem = KeHoachVatTuService.loc_hien_thi(
        bang["items"], hang_loai=hang_loai, tinh_trang=tinh_trang)
    return CanDoiOut(items=items, so_giu_lau=bang.get("so_giu_lau", 0), dem=dem)


@router.get("/theo-lenh", response_model=TheoLenhOut)
def theo_lenh(
    giu_cho: GiuCho,
    _user: Annotated[object, Depends(require_permission(MODULE, "read"))],
    q: str | None = Query(default=None, description="Mã lệnh / mã hoặc tên mặt hàng"),
    chi_can_lo: bool = Query(default=False, description="Chỉ lệnh còn việc phải lo"),
    chi_giu_lau: bool = Query(default=False, description="Chỉ lệnh giữ lâu mà chưa xếp lịch"),
    giu: Literal["du", "dang", "tat", "giu_lau"] | None = Query(
        default=None, description="Tab: giữ đủ / đang giữ dở / chưa giữ / giữ lâu"),
) -> TheoLenhOut:
    """CÙNG bảng cân đối, xoay theo LỆNH. Quyền y hệt `/can-doi` — vẫn chỉ là công cụ NHÌN."""
    try:
        return TheoLenhOut(**giu_cho.theo_chu_the(q=q, chi_can_lo=chi_can_lo,
                                                  chi_giu_lau=chi_giu_lau, giu=giu))
    except KeHoachVatTuError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None


def _luoi(giu: GiuChoService) -> dict:
    """Bản đầy đủ của lưới qua cache 45 giây chung với `/can-doi` (cùng chỗ xoá sớm)."""
    try:
        return lay_hoac_tinh(lambda: luoi_vat_tu.dung_luoi(giu), luoi=1)
    except KeHoachVatTuError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None


@router.get("/luoi", response_model=LuoiOut)
def luoi(
    giu: GiuCho,
    _user: Annotated[object, Depends(require_permission(MODULE, "read"))],
    xem: Literal["lenh", "hang"] = Query(default="lenh", description="Nhóm theo lệnh / mặt hàng"),
    q: str | None = Query(default=None, description="Mã lệnh, sản phẩm, mặt hàng, mã phiếu"),
    tinh_trang: Literal["chua_tinh", "can_mua", "nen_nha", "dang_mua", "chua_giu", "cho_ve", "co_kho",
                        "da_xuat", "co_ghi_chu"] | None = Query(default=None),
    hang_loai: Literal["giay", "vat_tu"] | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
) -> LuoiOut:
    """Lưới Kế hoạch vật tư — mỗi dòng một ô (lệnh × mặt hàng), cắt trang theo NHÓM ở máy chủ."""
    return LuoiOut(**luoi_vat_tu.chon_trang(_luoi(giu), xem=xem, q=q, tinh_trang=tinh_trang,
                                            hang_loai=hang_loai, page=page, size=size))


@router.get("/luoi/xuat.xlsx")
def luoi_xuat(
    giu: GiuCho,
    _user: Annotated[object, Depends(require_permission(MODULE, "read"))],
    xem: Literal["lenh", "hang"] = Query(default="lenh"),
    q: str | None = Query(default=None),
    tinh_trang: Literal["chua_tinh", "can_mua", "nen_nha", "dang_mua", "chua_giu", "cho_ve", "co_kho",
                        "da_xuat", "co_ghi_chu"] | None = Query(default=None),
    hang_loai: Literal["giay", "vat_tu"] | None = Query(default=None),
) -> Response:
    """Xuất Excel đúng các dòng đang lọc trên lưới (mọi trang)."""
    data = luoi_vat_tu.xuat_xlsx(_luoi(giu), xem=xem, q=q, tinh_trang=tinh_trang,
                                 hang_loai=hang_loai)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="ke-hoach-vat-tu.xlsx"'},
    )


@router.get("/luoi/lenh", response_model=LuoiLenhOut)
def luoi_lenh(
    giu: GiuCho,
    _user: Annotated[object, Depends(require_permission(MODULE, "read"))],
    lsx_id: int | None = Query(default=None),
    bai_ghep_id: int | None = Query(default=None),
) -> LuoiLenhOut:
    """Ngăn lệnh: mọi ô của lệnh (kể cả ngoài trang đang xem) + lịch sử."""
    if (lsx_id is None) == (bai_ghep_id is None):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="Chọn đúng một lệnh hoặc một bài ghép.")
    ra = luoi_vat_tu.mot_lenh(_luoi(giu), luoi_vat_tu.khoa_chu(lsx_id, bai_ghep_id))
    if ra is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            detail="Lệnh này không còn trong kế hoạch vật tư.")
    return LuoiLenhOut(**ra)


@router.get("/luoi/hang", response_model=LuoiHangOut)
def luoi_hang(
    giu: GiuCho,
    _user: Annotated[object, Depends(require_permission(MODULE, "read"))],
    hang_loai: Literal["giay", "vat_tu"] = Query(),
    hang_id: int = Query(gt=0),
    kho_rong: int = Query(default=0, ge=0),
    kho_dai: int = Query(default=0, ge=0),
    don_vi_goc: str = Query(default="", max_length=16),
) -> LuoiHangOut:
    """Ngăn mặt hàng: đơn mua (đặt cho ai, dư bao nhiêu), phiếu nên huỷ, lệnh dùng, lịch sử.

    `don_vi_goc` = đơn vị gốc của khoá (giấy cùng khổ đếm tờ / đếm kg là hai mặt hàng, 10/10/2026;
    vật tư kg / thùng cũng vậy). Giấy / vật tư gửi rỗng mà không có khoá rỗng thì khớp khoá có nhu cầu đúng mã +
    khổ (`mot_hang`) — không 404 khi lệnh vẫn cần."""
    goc = don_vi_goc.strip().lower() if co_don_vi_goc(hang_loai) else ""
    ra = luoi_vat_tu.mot_hang(_luoi(giu), f"{hang_loai}:{hang_id}:{kho_rong}:{kho_dai}:{goc}",
                              mo_goc=co_don_vi_goc(hang_loai) and not goc)
    if ra is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            detail="Mặt hàng này không còn lệnh nào cần.")
    return LuoiHangOut(**ra)


def _mot_chu_the(payload: GiuChoIn) -> tuple[int | None, int | None]:
    """Đúng MỘT chủ thể — cùng luật với `CheckConstraint` của bảng, chặn sớm ở biên API.

    Cả hai cùng có thì không biết giữ cho ai; cả hai cùng trống thì đẻ dòng mồ côi trừ vào tồn tự
    do của mọi người mà không tra ngược ra được ai giữ.
    """
    if (payload.lsx_id is None) == (payload.bai_ghep_id is None):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Cần đúng một trong hai: lsx_id hoặc bai_ghep_id.")
    return payload.lsx_id, payload.bai_ghep_id


@router.post("/giu-cho/bat", response_model=TheoLenhRow)
def giu_cho_bat(
    payload: GiuChoIn,
    giu: GiuCho,
    _user: Annotated[object, Depends(require_permission(MODULE, "update"))],
) -> TheoLenhRow:
    """BẬT giữ chỗ = ĐĂNG KÝ, không phải chụp một lần: giữ được bao nhiêu hay bấy nhiêu, hàng về
    sau thì tự nhặt bù. Đòi quyền `update` vì nó lấy tồn ra khỏi tay người khác."""
    lsx_id, bg_id = _mot_chu_the(payload)
    try:
        giu.bat(lsx_id=lsx_id, bai_ghep_id=bg_id)
    except GiuChoError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    return _tra_dong(giu, lsx_id, bg_id)


@router.post("/giu-cho/bat-nhieu", response_model=GiuChoNhieuOut)
def giu_cho_bat_nhieu(
    payload: GiuChoNhieuIn,
    giu: GiuCho,
    _user: Annotated[object, Depends(require_permission(MODULE, "update"))],
) -> GiuChoNhieuOut:
    """Bật giữ chỗ cho các lệnh/bài đã tick — MỘT lượt nhặt, thứ tự ăn tồn theo hạn sản xuất.

    Không có bản "tắt nhiều": nhả là không hoàn tác được, mỗi lệnh phải hỏi riêng.
    """
    chon = [_mot_chu_the(c) for c in payload.chu_the]
    try:
        return GiuChoNhieuOut(items=giu.bat_nhieu(chon))
    except GiuChoError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None


@router.post("/giu-cho/tat", response_model=TheoLenhRow)
def giu_cho_tat(
    payload: GiuChoIn,
    giu: GiuCho,
    _user: Annotated[object, Depends(require_permission(MODULE, "update"))],
) -> TheoLenhRow:
    """NHẢ HẾT — không phải hoàn tác. Bật lại có thể chẳng còn gì (lệnh khác đã nhặt mất), nên FE
    phải hỏi trước khi gọi."""
    lsx_id, bg_id = _mot_chu_the(payload)
    try:
        giu.tat(lsx_id=lsx_id, bai_ghep_id=bg_id)
    except GiuChoError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    return _tra_dong(giu, lsx_id, bg_id)


def _tra_dong(giu: GiuChoService, lsx_id: int | None, bg_id: int | None) -> TheoLenhRow:
    """Thẻ đã cập nhật của chính chủ thể vừa bấm.

    Chủ thể có thể KHÔNG còn trên bảng (tắt giữ chỗ cho một lệnh đã rơi khỏi phạm vi) — lúc đó trả
    thẻ rỗng đúng nghĩa "hết việc ở đây" thay vì 404: bấm tắt đã thành công, ném lỗi là nói ngược.
    """
    dong = giu.mot_dong(lsx_id=lsx_id, bai_ghep_id=bg_id)
    if dong is None:
        return TheoLenhRow(lsx_id=lsx_id, bai_ghep_id=bg_id, ma="")
    return TheoLenhRow(**dong)


def _noi_dung_de_nghi(gom: dict, ghi_chu: str | None) -> str:
    """Ô "Nội dung / mục đích" của yêu cầu mua — soạn ở MỘT chỗ cho cả hai cửa.

    Cửa xem-trước và cửa tạo thật phải ra CÙNG một câu chữ. Lệch nhau thì người dùng đọc một đằng
    trên form, hệ ghi một nẻo vào phiếu, mà không ai kiểm được vì hai câu nằm ở hai chỗ.
    """
    return (ghi_chu or "").strip() or (
        f"Mua vật tư còn thiếu để chạy lệnh {gom['related_document_code']}."
    )


@router.post("/de-nghi-mua/xem-truoc", response_model=DeNghiMuaXemTruocOut)
def xem_truoc_de_nghi_mua(
    payload: DeNghiMuaIn,
    svc: Service,
    thu_mua: ThuMua,
    user: CurrentUser,
    _quyen_doc: Annotated[object, Depends(require_permission(MODULE, "read"))] = None,
) -> DeNghiMuaXemTruocOut:
    """Tính BẢN NHÁP của yêu cầu mua — không ghi gì vào cơ sở dữ liệu.

    FE đổ kết quả vào chính form "Tạo yêu cầu mua hàng" (nội dung · từng dòng vật tư đã gộp · lệnh
    nguồn) để người dùng nhìn, gõ NGÀY CẦN HÀNG, rồi tự bấm Lưu. Đường tạo thật vẫn là cửa cũ của thu mua
    `POST /api/department-purchase-requests` — ở đây KHÔNG đẻ thêm đường tạo thứ hai.

    Vẫn hỏi bit TẠO yêu cầu mua ngay tại cửa chỉ-đọc này: dẫn người không có quyền tới một form mà
    bấm Lưu là 403 thì họ gõ xong mới biết công cốc, rồi đọc thành "phần mềm hỏng".
    """
    if not thu_mua.can_create_department_request(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền tạo yêu cầu mua hàng cho bộ phận.",
        )
    try:
        gom = svc.gom_de_nghi([d.model_dump() for d in payload.dong])
    except KeHoachVatTuError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    return DeNghiMuaXemTruocOut(
        related_document_type="lsx",
        related_document_code=gom["related_document_code"],
        needed_date=None,
        noi_dung=_noi_dung_de_nghi(gom, payload.ghi_chu),
        lines=gom["lines"],
        nguon=gom["nguon"],
    )


@router.post("/de-nghi-mua", response_model=DeNghiMuaOut, status_code=status.HTTP_201_CREATED)
def de_nghi_mua(
    payload: DeNghiMuaIn,
    svc: Service,
    thu_mua: ThuMua,
    user: CurrentUser,
    # Gác CẢ HAI cửa: `san_xuat:read` để đọc bảng (số lượng mua suy ra từ chính bảng đó — cho phép
    # lập yêu cầu từ một bảng mình không được xem là một cửa mà bảng phân quyền không mô tả), rồi
    # `create_department_request` tự kiểm bit tạo yêu cầu mua bên trong.
    _quyen_doc: Annotated[object, Depends(require_permission(MODULE, "read"))] = None,
) -> DeNghiMuaOut:
    """Gộp các dòng đỏ đã tick thành MỘT yêu cầu mua bộ phận.

    Trả mã yêu cầu để FE mở lên xem — **không tự gửi đi**. Máy ghi nhận, người quyết.
    """
    try:
        gom = svc.gom_de_nghi([d.model_dump() for d in payload.dong])
    except KeHoachVatTuError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None

    noi_dung = _noi_dung_de_nghi(gom, payload.ghi_chu)
    try:
        row = thu_mua.create_department_request(
            source_type="san_xuat",
            related_document_type="lsx",
            related_document_code=gom["related_document_code"],
            content=noi_dung,
            # Ngày cần do NGƯỜI gửi lên, không suy — thiếu thì thu mua báo lỗi "bắt buộc".
            needed_date=payload.needed_date,
            lines=gom["lines"],
            nguon_lenh=gom["nguon"],
            actor=user,
        )
    except PurchaseForbidden as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=str(exc)) from None
    except PurchaseError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    # Bảng vừa đổi (dòng đã đề nghị mua) — bỏ cache để lượt tải lại ngay sau không thấy số cũ rồi
    # bấm đề nghị mua lần hai.
    xoa_cache_can_doi()
    return DeNghiMuaOut(id=row["id"], code=row["code"])
