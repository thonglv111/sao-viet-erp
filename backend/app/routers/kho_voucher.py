"""Router — Phiếu nhập/xuất kho + lô + ngưỡng tồn (spec-kho-de-nghi §5–§7, §9).

Điểm phân quyền quan trọng: mọi số TIỀN (`don_gia`, `thanh_tien`, `gia_von`,
`don_gia_nhap`) chỉ được điền khi người gọi có `can_view_cost`. Thiếu quyền thì không
những ẩn cột mà còn KHÔNG TÍNH — số không lọt ra qua response, kể cả khi mở DevTools.
Bản in 01-VT/02-VT dùng chính response này nên tự động bỏ 2 cột tiền.
"""
from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session

from ..db import SessionLocal, get_db
from ..deps import (
    get_authorization_service,
    get_current_user,
    require_permission,
    require_xem_kho_nao,
)
from ..services.quyen_kho import gia_lo_theo_man, kho_duoc, khoa_kho, xem_ton_kho
from ..models.stock_voucher import VOUCHER_NHAP
from ..models.user import User
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.document_sequence_repo import DocumentSequenceRepository
from ..repositories.kho_hang_repo import KhoHangRepository
from ..repositories.stock_lot_repo import StockLotRepository, StockThresholdRepository
from ..repositories.don_vi_do_repo import DonViDoRepository
from ..repositories.stock_request_repo import StockRequestRepository
from ..repositories.vat_lieu_kho_repo import VatLieuKhoRepository
from ..repositories.stock_voucher_repo import StockVoucherRepository
from ..repositories.rbac_repo import DepartmentRepository
from ..repositories.user_repo import UserRepository
from ..schemas.stock import (
    AllocationLineOut,
    AllocationOut,
    DieuChinhLichSuRow,
    DieuChinhXuatIn,
    DieuChuyenIn,
    DieuChuyenOut,
    DuBaoTonRow,
    TonKhoaRow,
    TonNhomDem,
    TonNhomMuc,
    TonNhomPage,
    GiaGocIn,
    GiaGocOut,
    MaterialChuyenRow,
    MaterialHistoryOut,
    MaterialHistoryPage,
    MaterialXuatRow,
    StockLotOut,
    StockLotKhoIn,
    StockLotViTriIn,
    StockThresholdIn,
    StockThresholdOut,
    StockVoucherAttachmentListOut,
    StockVoucherAttachmentOut,
    StockVoucherCancel,
    StockVoucherViTriIn,
    StockVoucherCreate,
    StockVoucherLineOut,
    StockVoucherOut,
    StockVoucherPage,
)
from ..services import kho_gia_goc_service
from ..services.kho_giay import co_don_vi_goc, don_vi_khai, khoa_ton, khoa_ton_cua
from ..services.qr_token import sign_scan
from ..services.vat_lieu_kho_service import HANG_NHAN, VatLieuKhoService
from ..services.rbac_service import AuthorizationService
from ..services.sequence_service import SequenceService
from ..services.stock_request_service import StockRequestService
from ..services.stock_voucher_service import (
    MAX_ATTACHMENT_BYTES,
    StockVoucherError,
    StockVoucherService,
)
from ..tai_len import doc_gioi_han

from ..services.delivery_notify import bao_tai_xe_kho_lap_phieu, kho_ghi_so_hang_giao
from ..services.san_xuat.kho import phat_su_kien_kho

router = APIRouter(prefix="/api/kho/phieu", tags=["kho-phieu"])
# Ngưỡng tồn để PREFIX RIÊNG, không nhét dưới /phieu: `/phieu/nguong` là path 1 đoạn nên sẽ
# bị `/phieu/{voucher_id}` nuốt trước (FastAPI khớp theo thứ tự khai báo) → 422.
threshold_router = APIRouter(prefix="/api/kho/nguong-ton", tags=["kho-nguong"])
# Điều chuyển kho — prefix RIÊNG (không nhét dưới /phieu) để không bị `/phieu/{voucher_id}` nuốt.
dieu_chuyen_router = APIRouter(prefix="/api/kho/dieu-chuyen", tags=["kho-dieu-chuyen"])
MODULE = "kho"
# Màn TỒN KHO của từng kho (mục menu động dưới khối "Kho hàng"): MỖI KHO MỘT DÒNG QUYỀN
# `ton_kho_<id kho>` từ 05/10/2026 (`services/quyen_kho.py`) — Xem = đọc SỐ tồn + lô của kho đó;
# việc GHI duy nhất là khai ngưỡng, ô chi tiết `set_threshold` của chính dòng kho đó. Trước đó là
# MỘT khoá `ton_kho` chung (mg `0334`) mở cùng lúc mọi kho.
# Action nhật ký khi ĐIỀU CHỈNH phiếu xuất (SX dùng ít hơn) — đọc lại cho "Lịch sử điều chỉnh".
_ACTION_DIEU_CHINH_XUAT = "kho_xuat_dieu_chinh"


def _goc_q(hang_loai: str | None, goc: str | None) -> str | None:
    """Query `goc` (đơn vị gốc của dòng tồn giấy / vật tư — "to", "kg", "thung"…) đã chuẩn hoá; hàng
    khác / bỏ trống ⇒ None (không lọc theo đơn vị). Dòng tồn giấy = mã + khổ + đơn vị gốc; vật tư =
    mã + đơn vị gốc (mg 0390)."""
    g = (goc or "").strip().lower()
    return g if (co_don_vi_goc(hang_loai) and g) else None


def _hang_service(db: Session) -> VatLieuKhoService:
    return VatLieuKhoService(VatLieuKhoRepository(db), DonViDoRepository(db))


_log = logging.getLogger(__name__)


def get_service(db: Annotated[Session, Depends(get_db)],
                nen: BackgroundTasks = None) -> StockVoucherService:  # type: ignore[assignment]
    # `nen` vắng khi test/service khác gọi thẳng `get_service(db)` ⇒ nhặt thêm chạy ngay sau commit.
    sequence = SequenceService(DocumentSequenceRepository(db))
    requests = StockRequestRepository(db)
    lots = StockLotRepository(db)
    hang = _hang_service(db)
    request_service = StockRequestService(
        requests, lots, StockThresholdRepository(db), sequence, hang=hang)
    return StockVoucherService(
        StockVoucherRepository(db), requests, lots, sequence, request_service, hang,
        giu_cho=_giu_cho_service(db),
        hen_nhat_them=(lambda: nen.add_task(_nhat_them_nen)) if nen is not None else None,
    )


def _nhat_them_nen() -> None:
    """Nhặt thêm giữ chỗ SAU khi đã trả phản hồi ghi sổ: dựng cả bảng cân đối toàn xưởng, thủ kho
    không phải đứng chờ. Session MỚI — session của request đã đóng trước khi việc nền chạy."""
    db = SessionLocal()
    try:
        _giu_cho_service(db).nhat_them()
    except Exception:  # noqa: BLE001 — việc nền, không còn ai để báo lỗi
        db.rollback()
        _log.exception("Nhặt thêm giữ chỗ sau ghi sổ lỗi")
    finally:
        db.close()


def _giu_cho_service(db: Session):
    """`GiuChoService` cho đường GHI SỔ — kho phải biết phần nào đã có chủ.

    Dựng TẠI ĐÂY chứ không nhét vào `deps.py`: cùng lối `get_service` của router này, và giữ cho
    `StockVoucherService` không phải biết cách lắp cả bảng cân đối (nó nhận sẵn qua tham số, vắng
    thì chạy như cũ).
    """
    from ..repositories.bai_ghep_repo import BaiGhepRepository
    from ..repositories.don_vi_do_repo import DonViDoRepository
    from ..repositories.lsx_repo import LsxRepository
    from ..repositories.purchase_repo import PurchaseRequestRepository, SupplierRepository
    from ..services.giu_cho_service import GiuChoService
    from ..services.ke_hoach_vat_tu_service import KeHoachVatTuService

    kh = KeHoachVatTuService(
        db, lsx_repo=LsxRepository(db), bai_ghep_repo=BaiGhepRepository(db),
        hang=_hang_service(db), lots=StockLotRepository(db),
        requests=StockRequestRepository(db), purchases=PurchaseRequestRepository(db),
        suppliers=SupplierRepository(db), don_vi=DonViDoRepository(db),
    )
    return GiuChoService(db, kh)


Service = Annotated[StockVoucherService, Depends(get_service)]
Db = Annotated[Session, Depends(get_db)]
Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]


def _err(e: StockVoucherError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


def _can_see_cost(v, user, authz, db) -> bool:
    """Ai thấy GIÁ VỐN của phiếu: CHỈ người có quyền `view_cost`. Chủ 18/09/2026 "liên quan đến tiền
    thì chỉ có quyền mới xem được" — thay luật 10/08/2026 cho người tạo yêu cầu gốc thấy giá phiếu."""
    return authz.can(user, MODULE, "view_cost")


def _lo_cua_dong(ln) -> int | None:
    """Lô để truy nguồn của một dòng phiếu: lô của dòng, hoặc lô gốc mà dòng nhập điều chuyển còn nháp
    đã ghi sẵn (chưa ghi sổ nên chưa có lô)."""
    return ln.lot_id or getattr(ln, "lo_goc_id", None)


def _dong_nhap_chua_lo(v) -> list[int]:
    """Dòng yêu cầu của các dòng phiếu NHẬP chưa có lô để truy nguồn (phiếu nhập còn nháp)."""
    if v.loai != VOUCHER_NHAP:
        return []
    return [ln.request_line_id for ln in v.lines if not _lo_cua_dong(ln)]


def _nguon_dong(ns: list[dict], can_view_cost: bool) -> dict:
    """Nguồn hiện trên một dòng phiếu, gộp từ nguồn của các lô dưới nó: mã khác nhau nối ", ", giá
    bán chỉ khi các lô cùng MỘT giá (và có quyền xem giá)."""
    def noi(k: str) -> str | None:
        return ", ".join(dict.fromkeys(str(n[k]) for n in ns if n.get(k))) or None
    gia = {n["don_gia_ban"] for n in ns if n.get("don_gia_ban") is not None}
    return {"lsx_ma": noi("lsx_ma"), "order_ma": noi("order_ma"), "khach_hang": noi("khach_hang"),
            "don_gia_ban": gia.pop() if can_view_cost and len(gia) == 1 else None}


def _serialize(v, *, svc: StockVoucherService, db: Session, can_view_cost: bool,
               hang_map: dict | None = None, lot_map: dict | None = None,
               req_map: dict | None = None, nguon_map: dict | None = None,
               nguon_yc: dict | None = None) -> StockVoucherOut:
    """`hang_map`/`lot_map`/`req_map`/`nguon_map`/`nguon_yc` dựng SẴN theo cả trang (list) để tránh
    N+1; gọi lẻ 1 phiếu thì để None, hàm tự nạp mỗi map 1 query cho các dòng của phiếu đó."""
    users = UserRepository(db)
    khos = KhoHangRepository(db)
    requests = StockRequestRepository(db)
    if req_map is None:
        req_map = requests.by_ids_with_lines([v.request_id])
    if hang_map is None:
        hang_map = svc.hang.map_theo_cap([(ln.hang_loai, ln.hang_id) for ln in v.lines])
    if lot_map is None:
        lot_map = svc.lots.by_ids([_lo_cua_dong(ln) for ln in v.lines])
    # Nguồn (lệnh / đơn / khách / giá bán) đọc ở lô gốc; dòng nhập còn nháp thì đọc dòng yêu cầu.
    if nguon_map is None:
        nguon_map = svc.lots.nguon_lo([_lo_cua_dong(ln) for ln in v.lines])
    if nguon_yc is None:
        nguon_yc = svc.lots.nguon_dong_yeu_cau(_dong_nhap_chua_lo(v))

    def _lo_chua_gia(lot_id) -> bool:
        lot = lot_map.get(lot_id) if lot_id else None
        return (lot is not None and bool(nguon_map.get(lot_id, {}).get("tu_kcs"))
                and not int(lot.don_gia_nhap or 0))

    req = req_map.get(v.request_id)
    req_lines = req.lines if req is not None else []
    line_dvt = {ln.id: ln.dvt for ln in req_lines}
    # SL yêu cầu theo dòng yêu cầu (request_line_id) — nối vào mỗi dòng phiếu để đối chiếu
    # "yêu cầu vs thực nhận/xuất". Đọc-nối, không lưu cột.
    line_sl_de_nghi = {ln.id: float(ln.sl_de_nghi) for ln in req_lines}
    goc_map = svc.hang.don_vi_goc_map([(ln.hang_loai, ln.hang_id) for ln in v.lines])

    def goc_cua_dong(ln):
        """Đơn vị gốc của dòng: giấy / vật tư theo cột `don_vi_goc` của dòng (đơn vị đã khai), còn lại
        theo mã."""
        if co_don_vi_goc(ln.hang_loai) and ln.don_vi_goc:
            return ln.don_vi_goc
        return goc_map.get((ln.hang_loai, ln.hang_id))
    # Phiếu NHẬP ứng theo yêu cầu KCS: lúc còn nháp chưa có lô để truy nguồn, nên dựa vào yêu cầu gốc.
    nhap_tu_kcs = getattr(req, "san_xuat_cong_viec_id", None) is not None

    lines: list[StockVoucherLineOut] = []
    gia_von_total = 0
    if v.loai == VOUCHER_NHAP:
        # NHẬP: mỗi dòng = 1 lô sắp tạo, giá lấy TRÊN DÒNG → giữ nguyên 1 dòng/lô. Đơn giá và
        # `so_luong` cùng ở đơn vị NGƯỜI KHAI nên nhân thẳng với nhau.
        for ln in v.lines:
            key = (ln.hang_loai, ln.hang_id)
            m = hang_map.get(key)
            lot = lot_map.get(ln.lot_id) if ln.lot_id else None
            unit = int(ln.don_gia or 0)
            thanh_tien = int(round(unit * float(ln.so_luong)))
            gia_von_total += thanh_tien
            lines.append(StockVoucherLineOut(
                id=ln.id,
                request_line_id=ln.request_line_id,
                hang_loai=ln.hang_loai,
                hang_id=ln.hang_id,
                hang_ma=getattr(m, "ma", None),
                hang_ten=getattr(m, "ten", None),
                dvt=line_dvt.get(ln.request_line_id),
                kho_rong=int(ln.kho_rong or 0), kho_dai=int(ln.kho_dai or 0),
                lot_id=ln.lot_id,
                ma_lo=getattr(lot, "ma_lo", None),
                sl_de_nghi=line_sl_de_nghi.get(ln.request_line_id),
                so_luong=float(ln.so_luong),
                sl_goc=float(ln.sl_goc),
                don_vi_goc=goc_cua_dong(ln),
                ghi_chu=ln.ghi_chu,
                hsd=ln.hsd,   # HSD đích danh theo lô (phiếu điều chuyển hiện được); không phải tiền → không ẩn
                vi_tri=ln.vi_tri,   # vị trí cất lô — phiếu điều chuyển khai/hiện per-lô
                don_gia=unit if can_view_cost else None,
                thanh_tien=thanh_tien if can_view_cost else None,
                chua_gia_goc=(can_view_cost and unit == 0
                              and (nhap_tu_kcs or _lo_chua_gia(_lo_cua_dong(ln)))),
                **_nguon_dong([nguon_map.get(_lo_cua_dong(ln))
                               or nguon_yc.get(ln.request_line_id) or {}], can_view_cost),
            ))
    else:
        # XUẤT: đích danh trừ lô per-lô GIỮ NGUYÊN ở DB; chỉ ở tầng ĐỌC gộp các dòng lô lẻ theo
        # `request_line_id` (giữ thứ tự xuất hiện) → 1 dòng/mặt hàng với ĐƠN GIÁ BÌNH QUÂN gia
        # quyền. `lot_id`/`ma_lo` = None vì đã gộp nhiều lô.
        #
        # TIỀN TÍNH THEO `sl_goc`, KHÔNG theo `so_luong`: giá lô (`don_gia_nhap`) là giá trên ĐƠN
        # VỊ GỐC, còn `so_luong` là đơn vị người khai. Nhân nhầm thì lệch đúng bằng hệ số quy đổi
        # (khai 10 ram sẽ ra tiền của 10 kg) mà không có gì báo.
        groups: dict[int, list] = {}
        order: list[int] = []
        for ln in v.lines:
            k = ln.request_line_id
            if k not in groups:
                groups[k] = []
                order.append(k)
            groups[k].append(ln)
        for k in order:
            grp = groups[k]
            first = grp[0]
            key = (first.hang_loai, first.hang_id)
            m = hang_map.get(key)
            qty = sum(float(ln.so_luong) for ln in grp)          # hiển thị: đơn vị người khai
            qty_goc = sum(float(ln.sl_goc) for ln in grp)        # tiền: đơn vị gốc
            raw_cost = sum(
                int(round(
                    int(getattr(lot_map.get(ln.lot_id), "don_gia_nhap", 0) or 0) * float(ln.sl_goc)
                ))
                for ln in grp
            )
            blended = int(round(raw_cost / qty_goc)) if qty_goc > 0 else 0
            thanh_tien = int(round(blended * qty_goc))  # tổng thành tiền QUA đơn giá bình quân
            gia_von_total += thanh_tien
            ghi_chu = next((ln.ghi_chu for ln in grp if (ln.ghi_chu or "").strip()), None)
            lines.append(StockVoucherLineOut(
                id=first.id,
                request_line_id=k,
                hang_loai=first.hang_loai,
                hang_id=first.hang_id,
                hang_ma=getattr(m, "ma", None),
                hang_ten=getattr(m, "ten", None),
                dvt=line_dvt.get(k),
                kho_rong=int(first.kho_rong or 0), kho_dai=int(first.kho_dai or 0),
                lot_id=None,
                ma_lo=None,
                sl_de_nghi=line_sl_de_nghi.get(k),
                so_luong=qty,
                sl_goc=qty_goc,
                don_vi_goc=goc_cua_dong(first),
                ghi_chu=ghi_chu,
                don_gia=blended if can_view_cost else None,
                thanh_tien=thanh_tien if can_view_cost else None,
                chua_gia_goc=can_view_cost and any(_lo_chua_gia(ln.lot_id) for ln in grp),
                **_nguon_dong([nguon_map.get(ln.lot_id) or {} for ln in grp], can_view_cost),
            ))
    kho = khos.get(v.kho_id)
    lap = users.get_by_id(v.nguoi_lap_id) if v.nguoi_lap_id else None
    ghi_so_u = users.get_by_id(v.nguoi_ghi_so_id) if getattr(v, "nguoi_ghi_so_id", None) else None
    # Ai yêu cầu / ai duyệt lấy từ yêu cầu gốc (phiếu ứng theo yêu cầu đã duyệt).
    de_nghi_u = users.get_by_id(req.nguoi_tao_id) if req and req.nguoi_tao_id else None
    duyet_u = (
        users.get_by_id(req.nguoi_duyet_id)
        if req and getattr(req, "nguoi_duyet_id", None)
        else None
    )
    return StockVoucherOut(
        id=v.id, ma=v.ma, loai=v.loai,
        request_id=v.request_id, request_ma=getattr(req, "ma", None),
        loai_kho=getattr(req, "loai_kho", None),
        kho_id=v.kho_id, kho_ten=getattr(kho, "ten", None),
        ngay=v.ngay, nguoi_lap_id=v.nguoi_lap_id, nguoi_lap_ten=getattr(lap, "name", None),
        nguoi_de_nghi_ten=getattr(de_nghi_u, "name", None),
        nguoi_duyet_ten=getattr(duyet_u, "name", None),
        nguoi_ghi_so_ten=getattr(ghi_so_u, "name", None),
        nguoi_giao_nhan=v.nguoi_giao_nhan, ghi_chu=v.ghi_chu,
        trang_thai=v.trang_thai, ghi_so_luc=v.ghi_so_luc, created_at=v.created_at,
        dieu_chuyen=bool(getattr(v, "dieu_chuyen", False)),
        lines=lines,
        gia_von=gia_von_total if can_view_cost else None,
    )


def _xem_gia_man(authz, user: User, man: str, kho_id: int | None) -> bool:
    """Ô "Xem giá thành" của ĐÚNG màn đang gọi danh sách phiếu (05/10/2026): màn tồn của từng kho
    (`man=ton`) hỏi dòng `ton_kho_<kho_id>` — không chọn kho thì không có dòng nào để hỏi ⇒ không
    giá; màn Yêu cầu nhập xuất (`man=yeu_cau`, mặc định) hỏi `kho.view_cost`."""
    if man == "ton":
        return kho_id is not None and gia_lo_theo_man(authz, user, "ton")(kho_id)
    return authz.can(user, MODULE, "view_cost")


@router.get("", response_model=StockVoucherPage)
def list_vouchers(
    svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    loai: str | None = Query(default=None),
    trang_thai: str | None = Query(default=None),
    request_id: int | None = Query(default=None),
    kho_id: int | None = Query(default=None),
    q: str | None = Query(default=None),
    nhom: str | None = Query(default=None, pattern="^(nhap|xuat|dc)$",
                             description="Tab màn tồn từng kho: phiếu nhập / phiếu xuất / điều chuyển"),
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query(default="tao", pattern="^(tao|ngay|ghi_so)$"),
    nguoi_lap: list[int] | None = Query(default=None),
    gia_tu: int | None = Query(default=None, ge=0),
    gia_den: int | None = Query(default=None, ge=0),
    man: str = Query(default="yeu_cau", pattern="^(ton|yeu_cau)$",
                     description="Màn đang gọi — chọn ô Xem giá thành để gác tiền"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
) -> StockVoucherPage:
    can_view_cost = _xem_gia_man(authz, user, man, kho_id)
    hang_khop = None
    if q and q.strip():
        # Ô tìm bắt cả tên / mã vật tư đi trong phiếu: tra sẵn các mặt hàng khớp chữ.
        hang_khop = [(d["hang_loai"], d["hang_id"])
                     for d in _hang_service(db).tim_mat_hang(q.strip(), size=500)]
    loc = dict(
        loai=loai, trang_thai=trang_thai, request_id=request_id, kho_id=kho_id, q=q,
        hang_khop=hang_khop, nhom=nhom, tu_ngay=tu_ngay, den_ngay=den_ngay, moc=moc,
        nguoi_lap=nguoi_lap,
        # Lọc theo TIỀN chỉ khi người xem thấy tiền ở màn này — không quyền thì bỏ qua tham số
        # (lọc được theo khoảng là dò ra được giá vốn từng phiếu).
        gia_tu=gia_tu if can_view_cost else None,
        gia_den=gia_den if can_view_cost else None,
    )
    rows, total = svc.vouchers.list(page=page, size=size, **loc)
    dem_theo_tab = svc.vouchers.dem_theo_nhom(**loc)
    # Nạp SẴN mã hàng / lô / đề nghị của cả trang trong vài query (tránh N+1 trong _serialize).
    hang_map = _hang_service(db).map_theo_cap(
        [(ln.hang_loai, ln.hang_id) for v in rows for ln in v.lines])
    lo_ids = [_lo_cua_dong(ln) for v in rows for ln in v.lines]
    lot_map = svc.lots.by_ids(lo_ids)
    req_map = StockRequestRepository(db).by_ids_with_lines([v.request_id for v in rows])
    nguon_map = svc.lots.nguon_lo(lo_ids)
    nguon_yc = svc.lots.nguon_dong_yeu_cau([k for v in rows for k in _dong_nhap_chua_lo(v)])
    return StockVoucherPage(
        items=[
            _serialize(v, svc=svc, db=db, can_view_cost=can_view_cost,
                       hang_map=hang_map, lot_map=lot_map, req_map=req_map, nguon_map=nguon_map,
                       nguon_yc=nguon_yc)
            for v in rows
        ],
        total=total,
        dem_theo_tab=dem_theo_tab,
    )


@router.get("/loc-nguoi-lap")
def loc_nguoi_lap(
    svc: Service, db: Db,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    kho_id: int | None = Query(default=None),
) -> list[dict]:
    """Giá trị của điều kiện "Người lập": ai đã lập phiếu (ở kho `kho_id`), kèm số phiếu."""
    dem = dict(svc.vouchers.nguoi_lap_loc(kho_id=kho_id))
    users = UserRepository(db)
    ra = []
    for uid, n in dem.items():
        u = users.get_by_id(uid)
        ra.append({"id": uid, "ten": getattr(u, "name", None) or f"#{uid}", "so": n})
    return sorted(ra, key=lambda d: d["ten"])


@router.get("/{voucher_id}", response_model=StockVoucherOut)
def get_voucher(
    voucher_id: int, svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> StockVoucherOut:
    v = svc.vouchers.get_with_lines(voucher_id)
    if v is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiếu")
    return _serialize(v, svc=svc, db=db, can_view_cost=_can_see_cost(v, user, authz, db))


@router.post("", response_model=StockVoucherOut, status_code=status.HTTP_201_CREATED)
def create_voucher(
    payload: StockVoucherCreate, svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> StockVoucherOut:
    try:
        v = svc.create(
            user=user, request_id=payload.request_id, kho_id=payload.kho_id, ma=payload.ma,
            lines=[ln.model_dump() for ln in payload.lines],
            ngay=payload.ngay, ghi_chu=payload.ghi_chu,
        )
    except StockVoucherError as e:
        raise _err(e) from None
    # Yêu cầu của GIAO HÀNG thì báo tài xế "kho soạn xong, tới lấy được" — mốc đó chỉ kho biết.
    # Toàn bộ logic ở `services/delivery_notify`; hàm đó tự nuốt lỗi nên không cần `try` ở đây và
    # không đường nào làm hỏng việc lập phiếu.
    bao_tai_xe_kho_lap_phieu(db, payload.request_id, getattr(v, "ma", None))
    return _serialize(v, svc=svc, db=db, can_view_cost=authz.can(user, MODULE, "view_cost"))


def _bao_san_xuat(db: Session, v) -> None:
    """Phiếu thuộc yêu cầu nhập thành phẩm từ KCS ⇒ báo người KCS + refresh màn sản xuất NGAY (sau commit)."""
    req = StockRequestRepository(db).get(v.request_id) if getattr(v, "request_id", None) else None
    if req is not None:
        phat_su_kien_kho(req, bao_nguoi_tao=True)


@router.post("/{voucher_id}/ghi-so", response_model=StockVoucherOut)
def post_voucher(
    voucher_id: int, svc: Service, db: Db, authz: Authz,
    # ĐÃ GỘP quyền (bỏ SoD): người có quyền lập phiếu (create) tự ghi sổ luôn — không tách "thủ kho
    # lập" & "QL/kế toán chốt sổ" nữa (yêu cầu vận hành: tạo phiếu + ghi sổ cùng 1 quyền).
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> StockVoucherOut:
    """Ghi sổ — điểm DUY NHẤT tồn kho thay đổi."""
    try:
        v = svc.post(voucher_id, user)
    except StockVoucherError as e:
        raise _err(e) from None
    _bao_san_xuat(db, v)
    kho_ghi_so_hang_giao(db, getattr(v, "request_id", None), actor=user)
    return _serialize(v, svc=svc, db=db, can_view_cost=authz.can(user, MODULE, "view_cost"))


@router.post("/{voucher_id}/huy", response_model=StockVoucherOut)
def cancel_voucher(
    voucher_id: int, payload: StockVoucherCancel, svc: Service, db: Db, authz: Authz,
    # ĐÃ GỘP quyền: hủy phiếu = cùng quyền lập phiếu (create), không tách người lập & người chốt sổ.
    # Chỉ hủy được phiếu CHƯA ghi sổ. BẮT BUỘC lý do → yêu cầu chuyển 'Đã hủy' kèm lý do (kết thúc).
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> StockVoucherOut:
    try:
        v = svc.cancel(voucher_id, ly_do=payload.ly_do, user=user)
    except StockVoucherError as e:
        raise _err(e) from None
    _bao_san_xuat(db, v)
    return _serialize(v, svc=svc, db=db, can_view_cost=authz.can(user, MODULE, "view_cost"))


@router.post("/{voucher_id}/dieu-chinh-xuat", response_model=StockVoucherOut)
def dieu_chinh_xuat(
    voucher_id: int, payload: DieuChinhXuatIn, svc: Service, db: Db, authz: Authz,
    # Điều chỉnh phiếu XUẤT đã ghi sổ khi SX dùng ÍT hơn (xuất 10 → 7): trả dư về lô, giảm 'đã cấp'
    # của yêu cầu. Cùng quyền vận hành phiếu (create) — thủ kho là người biết SX dùng bao nhiêu.
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> StockVoucherOut:
    """Sửa giảm số đã xuất của phiếu XUẤT đã ghi sổ (SX dùng không hết) — trả phần dư về lô nguồn."""
    try:
        v, changes = svc.dieu_chinh_xuat(
            voucher_id, {ln.line_id: ln.so_luong_moi for ln in payload.lines}, user)
    except StockVoucherError as e:
        raise _err(e) from None
    # Điều chỉnh phiếu ĐÃ ghi sổ = thao tác nhạy cảm (đụng sổ) → ghi nhật ký để truy vết (ai · lúc nào
    # · đổi gì · VÌ SAO). detail = JSON {noi_dung, ly_do} để lịch sử tách 2 cột.
    AuditLogRepository(db).create(
        actor_user_id=user.id, action=_ACTION_DIEU_CHINH_XUAT,
        target=f"voucher:{voucher_id}",
        detail=json.dumps({"noi_dung": "; ".join(changes), "ly_do": payload.ly_do},
                          ensure_ascii=False),
    )
    return _serialize(v, svc=svc, db=db, can_view_cost=authz.can(user, MODULE, "view_cost"))


@router.get("/{voucher_id}/lich-su-dieu-chinh", response_model=list[DieuChinhLichSuRow])
def lich_su_dieu_chinh(
    voucher_id: int, db: Db,
    _: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> list[DieuChinhLichSuRow]:
    """Lịch sử ĐIỀU CHỈNH của 1 phiếu xuất (ai · bộ phận · lúc nào · đổi gì) — mới nhất trước."""
    users = UserRepository(db)
    depts = DepartmentRepository(db)
    out: list[DieuChinhLichSuRow] = []
    for r in AuditLogRepository(db).list_by_target(f"voucher:{voucher_id}"):
        if r.action != _ACTION_DIEU_CHINH_XUAT:
            continue
        # detail = JSON {noi_dung, ly_do}; bản ghi CŨ (trước khi bắt lý do) là chuỗi thường → về noi_dung.
        try:
            d = json.loads(r.detail or "{}")
            noi_dung, ly_do = d.get("noi_dung"), d.get("ly_do")
        except (ValueError, TypeError):
            noi_dung, ly_do = r.detail or None, None
        u = users.get_by_id(r.actor_user_id) if r.actor_user_id else None
        dept = depts.get_by_id(u.department_id) if (u and u.department_id) else None
        out.append(DieuChinhLichSuRow(
            thoi_diem=r.created_at,
            nguoi_ten=getattr(u, "name", None),
            bo_phan_ten=getattr(dept, "name", None),
            chi_tiet=noi_dung,
            ly_do=ly_do,
        ))
    return out


@router.patch("/lo/{lot_id}/vi-tri")
def update_lot_vi_tri(
    lot_id: int, payload: StockLotViTriIn, svc: Service,
    # Vị trí VẬT LÝ (kệ/ô) do người CẦM HÀNG (thủ kho) quản → gate `create`.
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
):
    """Sửa VỊ TRÍ cất lô trong kho (sửa từ drawer Lịch sử của sản phẩm)."""
    try:
        lot = svc.set_lot_vi_tri(lot_id, payload.vi_tri)
    except StockVoucherError as e:
        raise _err(e) from None
    return {"id": lot.id, "vi_tri": lot.vi_tri}


@router.patch("/lo/{lot_id}/kho")
def bo_sung_kho_lo(
    lot_id: int, payload: StockLotKhoIn, svc: Service,
    # Cùng quyền với sửa vị trí lô: người CẦM HÀNG biết khổ thật.
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
):
    """Kho bổ sung KHỔ cho lô giấy cũ chưa có khổ — giữ nguyên số lượng, đơn vị, đơn giá."""
    try:
        lot = svc.bo_sung_kho_lo(lot_id, user=user, kho_rong=payload.kho_rong,
                                 kho_dai=payload.kho_dai)
    except StockVoucherError as e:
        raise _err(e) from None
    return {"id": lot.id, "don_vi_goc": lot.don_vi_goc or "", "kho_rong": lot.kho_rong,
            "kho_dai": lot.kho_dai, "sl_ban_dau": float(lot.sl_ban_dau),
            "sl_con_lai": float(lot.sl_con_lai)}


@router.patch("/lo/{lot_id}/gia-goc", response_model=GiaGocOut)
def sua_gia_goc(
    lot_id: int, payload: GiaGocIn, db: Annotated[Session, Depends(get_db)],
    # Người không thấy giá thì cũng không sửa giá. Màn gõ giá gốc là tab "Giá gốc thành phẩm" của
    # BÁO CÁO KHO ⇒ ô "Xem giá thành" của Báo cáo kho (05/10/2026 — mỗi màn kho một ô xem giá).
    user: Annotated[User, Depends(require_permission("bao_cao_kho", "view_cost"))],
) -> GiaGocOut:
    """Kế toán kho gõ giá gốc cho lô thành phẩm nhập từ KCS — ghi lô gốc + mọi lô sinh ra từ nó qua
    điều chuyển, một giao dịch (design nhập kho thành phẩm §5)."""
    try:
        return GiaGocOut(**kho_gia_goc_service.sua_gia_goc(
            db, user=user, lot_id=lot_id, don_gia=payload.don_gia))
    except kho_gia_goc_service.GiaGocKhongThay as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from None
    except kho_gia_goc_service.GiaGocError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None


@router.patch("/{voucher_id}/vi-tri")
def set_voucher_vi_tri(
    voucher_id: int, payload: StockVoucherViTriIn, svc: Service,
    # Khai VỊ TRÍ cất lô cho DÒNG phiếu NHẬP còn NHÁP — dùng cho phiếu ĐIỀU CHUYỂN đích dựng sẵn
    # (không có form nhập vị trí). Ghi sổ chép sang lô. Đã ghi sổ → sửa ở lô (`/lo/{id}/vi-tri`).
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
):
    """Khai vị trí cất lô cho dòng phiếu nhập còn nháp (trước khi ghi sổ)."""
    try:
        svc.set_draft_line_vi_tri(voucher_id, [ln.model_dump() for ln in payload.lines])
    except StockVoucherError as e:
        raise _err(e) from None
    return {"ok": True}


# --- Lô & gợi ý phân bổ ------------------------------------------------------

@router.get("/lo/goi-y", response_model=AllocationOut)
def suggest_allocation(
    svc: Service, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
    hang_loai: str = Query(...),
    hang_id: int = Query(..., gt=0),
    kho_id: int = Query(...),
    so_luong: float = Query(..., gt=0, description="Số theo ĐƠN VỊ GỐC của mặt hàng"),
    request_id: int | None = Query(default=None, gt=0, description="Yêu cầu xuất — xuất cho Giao hàng thì ưu tiên lô của đúng đơn"),
    goc: str | None = Query(default=None, max_length=16,
                            description="Giấy / vật tư: chỉ lấy lô đếm đúng đơn vị gốc này (to / kg…)"),
    kho_rong: int = Query(default=0, ge=0, description="Giấy: khổ mm — có khổ thì chỉ lấy lô đúng khổ"),
    kho_dai: int = Query(default=0, ge=0),
) -> AllocationOut:
    """Gợi ý lấy hàng từ lô nào (FEFO → FIFO). Thủ kho sửa được — giá xuất là ĐÍCH DANH."""
    rows, thieu = svc.suggest_allocation(
        (hang_loai, hang_id), kho_id, so_luong, request_id=request_id,
        goc=_goc_q(hang_loai, goc), kho_rong=kho_rong, kho_dai=kho_dai)
    can_view_cost = authz.can(user, MODULE, "view_cost")
    return AllocationOut(
        lines=[
            AllocationLineOut(
                lot_id=r["lot_id"], ma_lo=r["ma_lo"], ngay_nhap=r["ngay_nhap"],
                hsd=r["hsd"], sl_con_lai=r["sl_con_lai"], so_luong=r["so_luong"],
                don_vi_goc=r["don_vi_goc"], kho_rong=r["kho_rong"] or 0, kho_dai=r["kho_dai"] or 0,
                don_gia_nhap=r["don_gia_nhap"] if can_view_cost else None,
                order_ma=r["order_ma"], khach_hang=r["khach_hang"], canh_bao=r["canh_bao"],
                chua_gia_goc=can_view_cost and r["chua_gia_goc"],
            )
            for r in rows
        ],
        thieu=thieu,
    )

# --- Điều chuyển kho -----------------------------------------------------------

@dieu_chuyen_router.post("", response_model=DieuChuyenOut, status_code=status.HTTP_201_CREATED)
def dieu_chuyen(
    payload: DieuChuyenIn, svc: Service, authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> DieuChuyenOut:
    """Ấn điều chuyển 1 HAY NHIỀU mặt hàng kho nguồn → kho đích (gộp vào MỘT yêu cầu). Server tự tạo
    phiếu XUẤT nguồn NHÁP + YÊU CẦU ĐIỀU CHUYỂN (NHẬP) ở đích + phiếu NHẬP đích DỰNG SẴN (khoá giá
    vốn + HSD đích danh theo TỪNG LÔ). Kho đích chỉ ghi sổ phiếu nhập → trừ nguồn + cộng đích cùng nhịp."""
    try:
        res = svc.dieu_chuyen(
            user=user, kho_nguon_id=payload.kho_nguon_id, kho_den_id=payload.kho_den_id,
            items=[it.model_dump() for it in payload.items], ghi_chu=payload.ghi_chu,
        )
    except StockVoucherError as e:
        raise _err(e) from None
    yc, px, pn = res["yeu_cau"], res["phieu_xuat"], res["phieu_nhap"]
    return DieuChuyenOut(
        yeu_cau_id=yc.id, yeu_cau_ma=yc.ma,
        phieu_xuat_id=px.id, phieu_xuat_ma=px.ma,
        phieu_nhap_id=pn.id, phieu_nhap_ma=pn.ma,
        kho_nguon_id=payload.kho_nguon_id, kho_den_id=payload.kho_den_id,
        so_dong=len(payload.items),
        gia_von=res["gia_von"] if authz.can(user, MODULE, "view_cost") else None,
    )


@dieu_chuyen_router.post("/{req_id}/huy", status_code=status.HTTP_204_NO_CONTENT)
def huy_dieu_chuyen(
    req_id: int, payload: StockVoucherCancel, svc: Service,
    # Hủy CẢ phiếu điều chuyển khi CHƯA ghi sổ: hủy 2 phiếu con (nháp) + đóng 2 yêu cầu. Cùng quyền
    # lập phiếu (create). Đã ghi sổ → 400 (sửa sai bằng điều chuyển ngược). `req_id` = đầu mối phiếu
    # điều chuyển = yêu cầu NHẬP đích.
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
):
    """Hủy phiếu điều chuyển (spec-phieu-dieu-chuyen §5) — chỉ khi chưa ghi sổ."""
    try:
        svc.huy_dieu_chuyen(req_id, payload.ly_do, user=user)
    except StockVoucherError as e:
        raise _err(e) from None


@dieu_chuyen_router.get("/by-voucher/{voucher_id}")
def dc_request_by_voucher(
    voucher_id: int, svc: Service,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> dict[str, int]:
    """Từ 1 phiếu điều chuyển (nhập-đích hoặc xuất-nguồn) → id yêu cầu điều chuyển ĐÍCH, để FE mở
    mặt tiền PHIẾU ĐIỀU CHUYỂN thay vì mẫu nhập/xuất. 404 nếu không phải phiếu điều chuyển."""
    rid = svc.dc_request_id_for_voucher(voucher_id)
    if rid is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không phải phiếu điều chuyển.")
    return {"request_id": rid}


# --- Xuất Excel Báo cáo Kho ---
_XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx_response(content: bytes, filename: str) -> Response:
    return Response(
        content=content,
        media_type=_XLSX_MEDIA,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


def _build_stock_xlsx(rows) -> bytes:
    from io import BytesIO
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    wb = Workbook()
    ws = wb.active
    ws.title = "Bao cao ton kho"

    headers = [
        "Mã Kho", "Tên Kho", "Mã Vật Tư", "Tên Vật Tư", "Nhóm Vật Tư",
        "Đơn Vị Tính", "Mã Lô", "Ngày Nhập", "Hạn Sử Dụng", "Vị Trí Kệ/Ô",
        "Trạng Thái Lô", "Số Lượng Ban Đầu", "Số Lượng Còn Lại", "Đơn Giá Nhập", "Thành Tiền"
    ]
    ws.append(headers)

    header_font = Font(name="Arial", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4F81BD", end_color="4F81BD", fill_type="solid")
    center_align = Alignment(horizontal="center", vertical="center")
    left_align = Alignment(horizontal="left", vertical="center")
    right_align = Alignment(horizontal="right", vertical="center")

    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align

    thin_border = Border(
        left=Side(style='thin', color='DDDDDD'),
        right=Side(style='thin', color='DDDDDD'),
        top=Side(style='thin', color='DDDDDD'),
        bottom=Side(style='thin', color='DDDDDD')
    )

    group_map = {
        "paper": "Giấy",
        "ink": "Mực",
        "film": "Màng/Film",
        "glue": "Keo",
        "packaging": "Bao bì",
        "auxiliary": "Phụ trợ/Khác"
    }

    status_map = {
        "available": "Sẵn sàng",
        "hold": "Giữ chỗ",
        "qc_wait": "Chờ KCS",
        "defect": "Lỗi",
        "empty": "Hết hàng"
    }

    for r_num, row_data in enumerate(rows, 2):
        lot, mat, kho = row_data

        group_vn = group_map.get(mat.material_group, mat.material_group or "")
        status_vn = status_map.get(lot.trang_thai, lot.trang_thai or "")

        qty_rem = float(lot.sl_con_lai)
        qty_orig = float(lot.sl_ban_dau)
        price = int(lot.don_gia_nhap or 0)
        value = int(round(qty_rem * price))

        hsd_str = lot.hsd.strftime("%d/%m/%Y") if lot.hsd else ""
        ngay_nhap_str = lot.ngay_nhap.strftime("%d/%m/%Y") if lot.ngay_nhap else ""

        values = [
            kho.ma,
            kho.ten,
            mat.code,
            mat.name,
            group_vn,
            mat.unit,
            lot.ma_lo,
            ngay_nhap_str,
            hsd_str,
            lot.vi_tri or "",
            status_vn,
            qty_orig,
            qty_rem,
            price,
            value
        ]

        for col_num, val in enumerate(values, 1):
            cell = ws.cell(row=r_num, column=col_num, value=val)
            cell.border = thin_border

            if col_num in [1, 3, 6, 7, 8, 9, 10, 11]:
                cell.alignment = center_align
            elif col_num in [2, 4, 5]:
                cell.alignment = left_align
            else:
                cell.alignment = right_align

            if col_num in [12, 13]:
                cell.number_format = '#,##0.00'
            elif col_num in [14, 15]:
                cell.number_format = '#,##0'

    for col in ws.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            val_str = str(cell.value or '')
            if len(val_str) > max_len:
                max_len = len(val_str)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 10)

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


@router.get("/lo/export.xlsx")
def export_stock_xlsx(
    db: Db,
    user: Annotated[User, Depends(require_permission(MODULE, "export"))],
    kho_id: int | None = Query(default=None),
    con_hang: bool = Query(default=True),
) -> Response:
    from sqlalchemy import select
    from ..models.kho_hang import KhoHang
    from ..models.material import Material
    from ..models.stock_lot import StockLot

    stmt = (
        select(StockLot, Material, KhoHang)
        .join(Material, StockLot.material_id == Material.id)
        .join(KhoHang, StockLot.kho_id == KhoHang.id)
    )
    if kho_id is not None:
        stmt = stmt.where(StockLot.kho_id == kho_id)
    if con_hang:
        stmt = stmt.where(StockLot.sl_con_lai > 0)

    stmt = stmt.order_by(KhoHang.ten.asc(), Material.name.asc(), StockLot.ngay_nhap.asc())
    rows = db.execute(stmt).all()

    filename = "bao-cao-ton-kho.xlsx"
    if kho_id is not None:
        kho = db.get(KhoHang, kho_id)
        if kho:
            filename = f"bao-cao-ton-kho-{kho.ma}.xlsx"

    return _xlsx_response(_build_stock_xlsx(rows), filename)


def _chan_neu_khong_xem_ton(db, authz, user: User, kho_id: int | None) -> None:
    """Chặn ở MÁY CHỦ người không được đọc SỐ tồn/lô. Được: người xem tồn (`ton_kho:read`), người lập
    phiếu (`create` — lập phiếu xuất phải thấy lô, `/lo/goi-y` vốn đã trả lô) và người vào được
    BÁO CÁO KHO (`bao_cao_kho:read` — popup lịch sử mặt hàng nằm trong màn đó). Vai chỉ `kho:read`
    để tạo đề nghị thì KHÔNG: trước đây chỉ FE ẩn màn Tồn kho, gọi thẳng API vẫn ra đủ lô + số
    lượng — lệch với danh sách đề nghị, nơi `ton_kha_dung` đã cắt ở máy chủ.

    Cửa thứ ba trước 24/09/2026 là `kho:close_book`; ô đó đã dời sang module riêng `bao_cao_kho`
    (mg `0329`) nên phải hỏi đúng khoá mới, không thì kế toán kho được cấp lại vẫn mở không nổi
    popup lịch sử. Cửa thứ nhất cũng đã dời cùng ngày: `kho:view_stock` → `ton_kho:read` (mg
    `0334`), rồi 05/10/2026 thành Xem ở DÒNG CỦA KHO ĐANG HỎI (`ton_kho_<id>`) — không truyền kho
    là gộp mọi kho, phải xem được mọi kho (`quyen_kho.xem_ton_kho`)."""
    if not xem_ton_kho(db, authz, user, kho_id) and not authz.can(
        user, MODULE, "create"
    ) and not authz.can(user, "bao_cao_kho", "read"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Cần quyền Xem tồn kho.")


#: Ba màn cùng gọi danh sách lô / lịch sử mặt hàng — mỗi màn có ô "Xem giá thành" riêng
#: (`quyen_kho.gia_lo_theo_man`).
_MAN_MO_TA = ("Màn đang gọi, quyết định ô 'Xem giá thành' nào được áp: ton = dòng của kho có lô · "
              "yeu_cau = Yêu cầu nhập xuất · bao_cao = Báo cáo kho")


@router.get("/lo/danh-sach", response_model=list[StockLotOut])
def list_lots(
    svc: Service, db: Db, authz: Authz,
    # Cửa NGOÀI chỉ lọc "có phải người của kho không" — ai ĐƯỢC đọc số tồn thật thì
    # `_chan_neu_khong_xem_ton` bên dưới quyết. Phải nhận cả người chỉ có dòng kho (`ton_kho_<id>`):
    # vai chỉ được cấp màn Tồn kho của vài kho thì không có `kho:read` nào cả.
    user: Annotated[User, Depends(require_xem_kho_nao((MODULE, "read")))],
    hang_loai: str | None = Query(default=None),
    hang_id: int | None = Query(default=None),
    kho_id: int | None = Query(default=None),
    con_hang: bool = Query(default=True),
    goc: str | None = Query(default=None, max_length=16),
    kho_rong: int = Query(default=0, ge=0),
    kho_dai: int = Query(default=0, ge=0),
    man: str = Query(default="ton", pattern="^(ton|yeu_cau|bao_cao)$", description=_MAN_MO_TA),
    dai_dien_het: bool = Query(default=False, description=(
        "Cùng kho_id: lô còn hàng + MỘT lô gần nhất cho mặt hàng đã xuất hết (màn Tồn kho) — "
        "thay con_hang=false vốn trả mọi lô từng có")),
) -> list[StockLotOut]:
    _chan_neu_khong_xem_ton(db, authz, user, kho_id)
    gia_kho = gia_lo_theo_man(authz, user, man)
    hang = (hang_loai, hang_id) if (hang_loai and hang_id) else None
    goc_loc = _goc_q(hang_loai or "giay", goc)
    if dai_dien_het and kho_id is not None and hang is None and goc_loc is None:
        lots = svc.lots.list_lots_gon(kho_id=kho_id)
    else:
        lots = svc.lots.list_lots(hang=hang, kho_id=kho_id, con_hang=con_hang,
                                  goc=goc_loc, kho_rong=kho_rong, kho_dai=kho_dai)
    return _dong_lo_danh_sach(svc, lots, gia_kho)


def _dong_lo_danh_sach(svc, lots, gia_kho) -> list[StockLotOut]:
    """Dòng lô của danh sách lô / màn Tồn kho — mọi phụ liệu nạp MỘT lượt cho cả tập."""
    # Nạp SẴN mọi mặt hàng của các lô trong 1 lượt (tránh N+1).
    hang_map = svc.hang.map_theo_cap([(lot.hang_loai, lot.hang_id) for lot in lots])
    # Mã phiếu NHẬP sinh ra từng lô — để hiển thị lô THEO MÃ PHIẾU (đợt hàng vào kho) thay mã lô
    # kỹ thuật. Nạp 1 lượt tránh N+1.
    voucher_ma_map = svc.vouchers.ma_by_ids(
        list({lot.voucher_id for lot in lots if lot.voucher_id is not None})
    )
    # Mã đơn vị (to/cai/kem…) → TÊN có dấu (tờ/cái/bản kẽm) cho HIỂN THỊ — 1 truy vấn cho cả trang.
    dv_ten = {d.ma: d.ten for d in svc.hang.don_vi.all_active()}
    nguon = svc.lots.nguon_lo([lot.id for lot in lots])  # đơn / khách / giá bán đọc ở lô gốc — 2 câu
    out = []
    for lot in lots:
        row = StockLotOut.model_validate(lot)
        m = hang_map.get((lot.hang_loai, lot.hang_id))
        row.hang_ma = getattr(m, "ma", None)
        row.hang_ten = getattr(m, "ten", None)
        row.hang_anh = getattr(m, "anh_url", None)
        # Giấy / vật tư đếm theo ĐƠN VỊ GỐC của lô (đơn vị đã khai); hàng khác theo đơn vị của mã.
        row.dvt = ((lot.don_vi_goc or None) if co_don_vi_goc(lot.hang_loai) else None) \
            or getattr(m, "don_vi_gia", None)
        row.dvt_ten = dv_ten.get(row.dvt, row.dvt)
        row.voucher_ma = voucher_ma_map.get(lot.voucher_id) if lot.voucher_id else None
        # Thủ kho chọn lô nhưng KHÔNG thấy giá (spec §6). Tiền theo ô xem giá của MÀN gọi.
        can_view_cost = gia_kho(lot.kho_id)
        row.don_gia_nhap = int(lot.don_gia_nhap or 0) if can_view_cost else None
        _gan_nguon_lo(row, nguon.get(lot.id), can_view_cost)
        out.append(row)
    return out


@router.get("/lo/ton-nhom", response_model=TonNhomPage)
def ton_nhom_trang(
    svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_xem_kho_nao((MODULE, "read")))],
    kho_id: int = Query(...),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=25, ge=1, le=200),
    q: str | None = Query(default=None, max_length=200, description="Tìm mã / tên vật tư (không phân biệt dấu)"),
    nhom: str = Query(default="all", pattern="^(all|can_mua|du_ton|chuakhai|sap_het_han)$"),
    ngay_tu: date | None = Query(default=None, description="Có lô còn hàng nhập từ ngày này"),
    ngay_den: date | None = Query(default=None, description="…đến ngày này"),
    ton_tu: float | None = Query(default=None), ton_den: float | None = Query(default=None),
    gt_tu: float | None = Query(default=None, description="Giá trị tồn từ — chỉ áp khi thấy giá"),
    gt_den: float | None = Query(default=None, description="Giá trị tồn đến — chỉ áp khi thấy giá"),
    hang_loai: str | None = Query(default=None, pattern="^(giay|vat_tu)$",
                                  description="Chỉ các dòng của MỘT mặt hàng (cùng hang_id)"),
    hang_id: int | None = Query(default=None, gt=0),
) -> TonNhomPage:
    """Màn Tồn kho của MỘT kho (08/10/2026): máy chủ gom lô theo MẶT HÀNG, lọc, đếm 5 nhóm và cắt
    trang — màn không còn kéo mọi lô về. `/lo/danh-sach` giữ nguyên cho nơi cần cả danh sách lô.

    Cùng cửa quyền với danh sách lô; giá trị tồn / giá nhập theo ô "Xem giá thành" của kho."""
    from ..services.du_bao_ton_service import DuBaoTonService
    from ..services.ton_kho_nhom_service import LocTon, TonKhoNhomService

    _chan_neu_khong_xem_ton(db, authz, user, kho_id)
    gia_kho = gia_lo_theo_man(authz, user, "ton")
    xem_gia = gia_kho(kho_id)
    giu = _giu_cho_service(db)
    du_bao_svc = DuBaoTonService(giu.kh, giu)
    ket_qua = TonKhoNhomService(
        svc.lots, StockThresholdRepository(db), svc.hang, du_bao_svc.du_bao, du_bao_svc.cho_xuat,
    ).trang(
        kho_id,
        LocTon(
            nhom=nhom, q=(q or "").strip(), ngay_tu=ngay_tu, ngay_den=ngay_den,
            ton_tu=ton_tu, ton_den=ton_den,
            gt_tu=gt_tu if xem_gia else None, gt_den=gt_den if xem_gia else None,
            hang=(hang_loai, hang_id) if (hang_loai and hang_id) else None,
        ),
        page, size,
    )
    return TonNhomPage(
        items=_dong_lo_danh_sach(svc, ket_qua["lots"], gia_kho),
        total=ket_qua["total"], dem=TonNhomDem(**ket_qua["dem"]), co_hsd=ket_qua["co_hsd"],
        nhom=[TonNhomMuc(**m) for m in ket_qua["nhom"]], du_bao_ok=ket_qua["du_bao_ok"],
        chi_thanh_pham=ket_qua["chi_thanh_pham"],
    )


@router.get("/lo/ton-khoa", response_model=list[TonKhoaRow])
def ton_theo_khoa(
    svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_xem_kho_nao((MODULE, "read")))],
    hang_loai: str = Query(..., pattern="^(giay|vat_tu)$"),
    hang_id: int = Query(..., gt=0),
) -> list[TonKhoaRow]:
    """Tồn TOÀN XƯỞNG của một mặt hàng theo từng khoá đơn vị gốc + khổ — cột Tồn và gợi ý khổ ở form
    yêu cầu. Gộp mọi kho ⇒ cùng cửa với danh sách lô không truyền kho."""
    _chan_neu_khong_xem_ton(db, authz, user, None)
    m = svc.hang.map_theo_cap([(hang_loai, hang_id)]).get((hang_loai, hang_id))
    dv_ten = {d.ma: d.ten for d in svc.hang.don_vi.all_active()}
    out = []
    for goc, kr, kd, sl in svc.lots.ton_theo_khoa((hang_loai, hang_id)):
        dv = (goc or None) if co_don_vi_goc(hang_loai) else None
        dv = dv or getattr(m, "don_vi_gia", None)
        out.append(TonKhoaRow(kho_rong=kr, kho_dai=kd, ton=sl,
                              don_vi_goc=dv, don_vi_goc_ten=dv_ten.get(dv, dv)))
    return out


@router.get("/lo/du-bao", response_model=list[DuBaoTonRow])
def du_bao_ton(
    svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_xem_kho_nao((MODULE, "read")))],
    kho_id: int = Query(...),
) -> list[DuBaoTonRow]:
    """Dự báo tồn cho các dòng màn Tồn kho của MỘT kho: lệnh sắp lĩnh (thứ tự ăn tồn của bảng cân
    đối) + hàng đang về + phiếu mua đang chạy. Cùng cửa quyền với danh sách lô (đây là số tồn)."""
    from ..services.du_bao_ton_service import DuBaoTonService
    from ..services.ke_hoach_vat_tu_service import KeHoachVatTuError

    _chan_neu_khong_xem_ton(db, authz, user, kho_id)
    hangs = [khoa_ton_cua(k) for k in svc.lots.khoa_trong_kho(kho_id)]
    giu = _giu_cho_service(db)
    du_bao_svc = DuBaoTonService(giu.kh, giu)
    try:
        rows = du_bao_svc.du_bao(hangs)
        # Đề nghị xuất còn treo của kho này (giao hàng, gia công ngoài…) — cùng phép với `/lo/ton-nhom`.
        theo = {(r["hang_loai"], r["hang_id"], r["kho_rong"], r["kho_dai"], r.get("don_vi_goc") or ""): r
                for r in rows}
        for k, viec in du_bao_svc.cho_xuat(kho_id).items():
            if k in theo:
                theo[k] = du_bao_svc.gop_cho_xuat(theo[k], k, viec)
        return [DuBaoTonRow(**r) for r in theo.values()]
    except KeHoachVatTuError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None


def _gan_nguon_lo(row: StockLotOut, n: dict | None, can_view_cost: bool) -> None:
    """Nguồn lô (lệnh / đơn / khách, đọc ở lô gốc). Giá bán là tiền ⇒ chỉ khi có `view_cost`."""
    n = n or {}
    row.lo_goc_id = n.get("lo_goc_id")
    row.lsx_ma, row.order_ma, row.khach_hang = n.get("lsx_ma"), n.get("order_ma"), n.get("khach_hang")
    row.tu_kcs = bool(n.get("tu_kcs"))
    row.don_gia_ban = n.get("don_gia_ban") if can_view_cost else None


def _dong_lo_lich_su(svc, lots, m, dvt, can_view_cost: bool) -> list[StockLotOut]:
    """Dòng lô của lịch sử mặt hàng (tab Nhập / Lô tồn / nhận về) — mọi phụ liệu nạp MỘT lượt cho cả tập."""
    # Mã phiếu NHẬP của từng lô (hiển thị lô THEO PHIẾU thay mã lô kỹ thuật) — nạp 1 lượt, tránh N+1.
    voucher_ids = list({lot.voucher_id for lot in lots if lot.voucher_id is not None})
    voucher_ma_map = svc.vouchers.ma_by_ids(voucher_ids)
    # Lô sinh từ phiếu ĐIỀU CHUYỂN → gắn cờ để FE tách tab "Chuyển kho" (nhận về) khỏi Nhập thường.
    dc_voucher_ids = svc.vouchers.dieu_chuyen_by_ids(voucher_ids)
    # SL yêu cầu của từng lô NHẬP (nối lô → dòng phiếu NHẬP → dòng yêu cầu) — nạp 1 lượt, tránh N+1.
    sl_de_nghi_map = svc.vouchers.sl_de_nghi_by_lot(lots)
    nguon = svc.lots.nguon_lo([lot.id for lot in lots])
    out: list[StockLotOut] = []
    for lot in lots:
        row = StockLotOut.model_validate(lot)
        row.hang_ma = getattr(m, "ma", None)
        row.hang_ten = getattr(m, "ten", None)
        row.dvt = ((lot.don_vi_goc or None) if co_don_vi_goc(lot.hang_loai) else None) or dvt
        row.voucher_ma = voucher_ma_map.get(lot.voucher_id) if lot.voucher_id else None
        row.don_gia_nhap = int(lot.don_gia_nhap or 0) if can_view_cost else None
        # SL yêu cầu KHÔNG phải tiền → luôn hiện (không gate theo can_view_cost). Kèm ĐƠN VỊ người
        # xin (có thể khác đơn vị gốc của lô) để lịch sử ghi rõ đơn vị cột "SL yêu cầu".
        sl_dvt = sl_de_nghi_map.get(lot.id)
        row.sl_de_nghi = sl_dvt[0] if sl_dvt else None
        row.dvt_yeu_cau = sl_dvt[1] if sl_dvt else None
        row.dieu_chuyen = lot.voucher_id in dc_voucher_ids if lot.voucher_id else False
        _gan_nguon_lo(row, nguon.get(lot.id), can_view_cost)
        out.append(row)
    return out


def _dong_xuat_lich_su(svc, rows: list[dict], can_view_cost: bool) -> list[MaterialXuatRow]:
    """Dòng xuất của lịch sử mặt hàng. "Chưa có giá gốc" (lô thành phẩm từ KCS chưa định giá) đọc ở
    LÔ GỐC qua `nguon_lo` — một lượt cho cả trang."""
    nguon = svc.lots.nguon_lo([r["lot_id"] for r in rows if r["lot_id"]])
    return [
        MaterialXuatRow(
            ngay=r["ngay"], voucher_id=r["voucher_id"], voucher_ma=r["voucher_ma"],
            lot_id=r["lot_id"], ma_lo=r["ma_lo"], so_luong=r["so_luong"],
            sl_de_nghi=r["sl_de_nghi"], dvt_yeu_cau=r["dvt_yeu_cau"],
            don_gia=r["don_gia"] if can_view_cost else None,
            dieu_chuyen=r["dieu_chuyen"], vi_tri=r["vi_tri"], hsd=r["hsd"],
            chua_gia_goc=bool((nguon.get(r["lot_id"]) or {}).get("tu_kcs")) and not r["don_gia"],
        )
        for r in rows
    ]


@router.get("/mat-hang/{hang_loai}/{hang_id}/lich-su", response_model=MaterialHistoryOut)
def material_history(
    hang_loai: str, hang_id: int, svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_xem_kho_nao((MODULE, "read")))],
    kho_id: int = Query(...),
    goc: str | None = Query(default=None, max_length=16),
    kho_rong: int = Query(default=0, ge=0),
    kho_dai: int = Query(default=0, ge=0),
    man: str = Query(default="ton", pattern="^(ton|yeu_cau|bao_cao)$", description=_MAN_MO_TA),
) -> MaterialHistoryOut:
    """Lịch sử NHẬP (mọi lô, kể cả đã hết) + XUẤT (dòng phiếu xuất đã ghi sổ) của 1 mặt hàng
    tại 1 kho — cho popup màn Tồn kho / Báo cáo kho, tách theo dõi nhập/xuất riêng. Giá vốn ẩn nếu
    thiếu ô xem giá của màn gọi (đường path nhiều đoạn nên không đụng route `/{voucher_id}`)."""
    _chan_neu_khong_xem_ton(db, authz, user, kho_id)
    can_view_cost = gia_lo_theo_man(authz, user, man)(kho_id)
    hang = (hang_loai, hang_id)
    m = svc.hang.map_theo_cap([hang]).get(hang)
    dvt = getattr(m, "don_vi_gia", None)
    # Giấy: một dòng màn Tồn = một (mã, khổ, đơn vị gốc); vật tư = (mã, đơn vị gốc).
    goc = _goc_q(hang_loai, goc)
    loc = {"goc": goc, "kho_rong": kho_rong, "kho_dai": kho_dai}
    khoa = khoa_ton(hang_loai, hang_id, goc=goc, kho_rong=kho_rong, kho_dai=kho_dai) if goc else hang

    # NHẬP = mọi lô của mặt hàng tại kho (con_hang=False để giữ cả lô đã xuất hết), FIFO theo ngày.
    lots = svc.lots.list_lots(hang=hang, kho_id=kho_id, con_hang=False, **loc)
    nhap = _dong_lo_lich_su(svc, lots, m, dvt, can_view_cost)

    # XUẤT = dòng phiếu xuất đã ghi sổ (đích danh lô); giá vốn = giá lô, ẩn nếu thiếu quyền.
    # `sl_de_nghi` nối qua dòng phiếu xuất → dòng yêu cầu (không phải tiền → luôn hiện).
    xuat = _dong_xuat_lich_su(svc, svc.vouchers.xuat_history(hang, kho_id, **loc), can_view_cost)

    return MaterialHistoryOut(
        hang_loai=hang_loai,
        hang_id=hang_id,
        hang_ma=getattr(m, "ma", None),
        hang_ten=getattr(m, "ten", None),
        dvt=goc or dvt,
        on_hand=svc.lots.on_hand(khoa, kho_id),
        nhap=nhap, xuat=xuat,
    )

#: Tab của ngăn mặt hàng. `chuyen` gộp lô nhận về + dòng chuyển đi.
_TAB_LICH_SU = "^(lo_ton|nhap|xuat|chuyen)$"


@router.get("/mat-hang/{hang_loai}/{hang_id}/lich-su-trang", response_model=MaterialHistoryPage)
def material_history_page(
    hang_loai: str, hang_id: int, svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_xem_kho_nao((MODULE, "read")))],
    kho_id: int = Query(...),
    tab: str = Query(default="lo_ton", pattern=_TAB_LICH_SU),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=10, ge=1, le=100),
    goc: str | None = Query(default=None, max_length=16),
    kho_rong: int = Query(default=0, ge=0),
    kho_dai: int = Query(default=0, ge=0),
    man: str = Query(default="ton", pattern="^(ton|yeu_cau|bao_cao)$", description=_MAN_MO_TA),
) -> MaterialHistoryPage:
    """Một trang của MỘT tab ngăn mặt hàng (màn Tồn kho), cắt ở DB, kèm số dòng của mọi tab.

    `/lich-su` (cả lịch sử một lượt) vẫn giữ cho Báo cáo kho; ngăn Tồn kho dùng đường này để mở ngăn
    không kéo theo mọi lô và mọi dòng xuất từng có của mặt hàng."""
    _chan_neu_khong_xem_ton(db, authz, user, kho_id)
    can_view_cost = gia_lo_theo_man(authz, user, man)(kho_id)
    hang = (hang_loai, hang_id)
    m = svc.hang.map_theo_cap([hang]).get(hang)
    dvt = getattr(m, "don_vi_gia", None)
    goc = _goc_q(hang_loai, goc)
    loc = {"goc": goc, "kho_rong": kho_rong, "kho_dai": kho_dai}
    khoa = khoa_ton(hang_loai, hang_id, goc=goc, kho_rong=kho_rong, kho_dai=kho_dai) if goc else hang

    dem_lo = svc.lots.dem_lo_theo_tab(hang, kho_id, **loc)
    dem_xuat = svc.vouchers.dem_xuat_theo_chieu(hang, kho_id, **loc)
    nhan_ve, chuyen_di = dem_lo["nhan_ve"], dem_xuat[True]
    dem = {"lo_ton": dem_lo["lo_ton"], "nhap": dem_lo["nhap"], "xuat": dem_xuat[False],
           "chuyen": nhan_ve + chuyen_di}
    tu = (page - 1) * size
    out = MaterialHistoryPage(
        hang_loai=hang_loai, hang_id=hang_id, hang_ma=getattr(m, "ma", None),
        hang_ten=getattr(m, "ten", None), dvt=goc or dvt,
        on_hand=svc.lots.on_hand(khoa, kho_id), tab=tab, page=page, size=size, dem=dem,
    )
    if tab in ("lo_ton", "nhap"):
        lots = svc.lots.trang_lo_mat_hang(hang, kho_id, tab=tab, offset=tu, limit=size, **loc)
        out.lo = _dong_lo_lich_su(svc, lots, m, dvt, can_view_cost)
    elif tab == "xuat":
        rows = svc.vouchers.xuat_history(hang, kho_id, dieu_chuyen=False, offset=tu, limit=size, **loc)
        out.xuat = _dong_xuat_lich_su(svc, rows, can_view_cost)
    elif nhan_ve or chuyen_di:
        # Hai nguồn, mới nhất trước: lấy (tu + size) dòng đầu mỗi nguồn rồi trộn — trang nào cũng đúng.
        ins = _dong_lo_lich_su(svc, svc.lots.trang_lo_mat_hang(
            hang, kho_id, tab="nhan_ve", offset=0, limit=tu + size, **loc), m, dvt, can_view_cost)
        outs = _dong_xuat_lich_su(svc, svc.vouchers.xuat_history(
            hang, kho_id, dieu_chuyen=True, offset=0, limit=tu + size, **loc), can_view_cost)
        tron = [
            MaterialChuyenRow(key=f"in-{lo.id}", chieu="in", ngay=lo.ngay_nhap, voucher_id=lo.voucher_id,
                              voucher_ma=lo.voucher_ma or lo.ma_lo, so_luong=lo.sl_ban_dau,
                              don_gia=lo.don_gia_nhap, chua_gia_goc=bool(lo.tu_kcs) and not lo.don_gia_nhap,
                              vi_tri=lo.vi_tri, hsd=lo.hsd)
            for lo in ins
        ] + [
            MaterialChuyenRow(key=f"out-{r.voucher_id}-{r.lot_id}-{i}", chieu="out", ngay=r.ngay,
                              voucher_id=r.voucher_id, voucher_ma=r.voucher_ma, so_luong=r.so_luong,
                              don_gia=r.don_gia, chua_gia_goc=r.chua_gia_goc, vi_tri=r.vi_tri, hsd=r.hsd)
            for i, r in enumerate(outs)
        ]
        tron.sort(key=lambda x: x.ngay, reverse=True)
        out.chuyen = tron[tu:tu + size]
    return out


@router.get("/mat-hang/{hang_loai}/{hang_id}/tong-xuat")
def material_tong_xuat(
    hang_loai: str, hang_id: int, svc: Service, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_xem_kho_nao((MODULE, "read")))],
    kho_id: int = Query(...),
    so_ngay: int = Query(default=90, ge=1, le=730),
    goc: str | None = Query(default=None, max_length=16),
    kho_rong: int = Query(default=0, ge=0),
    kho_dai: int = Query(default=0, ge=0),
) -> dict:
    """Tổng xuất THƯỜNG của một dòng tồn trong `so_ngay` ngày qua — hộp đặt ngưỡng tính bình quân
    mỗi ngày từ đây, khỏi nạp cả lịch sử xuất về trình duyệt chỉ để cộng."""
    _chan_neu_khong_xem_ton(db, authz, user, kho_id)
    tu_ngay = date.today() - timedelta(days=so_ngay)
    tong = svc.vouchers.tong_xuat((hang_loai, hang_id), kho_id, tu_ngay=tu_ngay,
                                  goc=_goc_q(hang_loai, goc), kho_rong=kho_rong, kho_dai=kho_dai)
    return {"so_ngay": so_ngay, "tong": tong}



@router.get("/mat-hang/{hang_loai}/{hang_id}/qr-token")
def material_qr_token(
    hang_loai: str, hang_id: int,
    _: Annotated[User, Depends(require_permission(MODULE, "read"))],
    kho_id: int = Query(...),
) -> dict[str, str]:
    """Mã QR đã ký cho tem dán kệ (in tem CẦN đăng nhập; trang quét công khai thì KHÔNG).
    FE nhúng vào link `#s=<token>` rồi vẽ QR. Path nhiều đoạn nên không đụng route `/{voucher_id}`."""
    return {"token": sign_scan(kho_id, hang_loai, hang_id)}


# --- Đính kèm hóa đơn/chứng từ gốc --------------------------------------------

@router.get("/{voucher_id}/attachments", response_model=StockVoucherAttachmentListOut)
def list_voucher_attachments(
    voucher_id: int, svc: Service,
    _: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> StockVoucherAttachmentListOut:
    try:
        items = svc.list_attachments(voucher_id)
    except StockVoucherError as e:
        raise _err(e) from None
    return StockVoucherAttachmentListOut(
        items=[StockVoucherAttachmentOut(**it) for it in items]
    )


@router.post(
    "/{voucher_id}/attachments",
    response_model=StockVoucherAttachmentOut,
    status_code=status.HTTP_201_CREATED,
)
def upload_voucher_attachment(
    voucher_id: int, svc: Service,
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
    file: UploadFile = File(...),
) -> StockVoucherAttachmentOut:
    # Tệp rỗng để service báo bằng câu của nó.
    data = doc_gioi_han(file, MAX_ATTACHMENT_BYTES, cho_rong=True)
    try:
        return StockVoucherAttachmentOut(**svc.add_attachment(
            voucher_id, actor=user, file_name=file.filename,
            content_type=file.content_type, data=data,
        ))
    except StockVoucherError as e:
        raise _err(e) from None


@router.delete(
    "/{voucher_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_voucher_attachment(
    voucher_id: int, attachment_id: int, svc: Service,
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> Response:
    try:
        svc.delete_attachment(voucher_id, attachment_id, actor=user)
    except StockVoucherError as e:
        raise _err(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Ngưỡng tồn ---------------------------------------------------------------

@threshold_router.get("", response_model=list[StockThresholdOut])
def list_thresholds(
    db: Db, authz: Authz, user: Annotated[User, Depends(require_xem_kho_nao())],
    kho_id: int | None = Query(default=None, description="Chỉ ngưỡng của một kho (màn Tồn kho của kho đó)"),
) -> list[StockThresholdOut]:
    # Chỉ ngưỡng của những kho người này có Xem ở dòng kho (`ton_kho_<id>`, 05/10/2026).
    duoc = kho_duoc(authz, user, "read")
    return [
        StockThresholdOut.model_validate(t)
        for t in StockThresholdRepository(db).list_active(kho_id) if t.kho_id in duoc
    ]


@threshold_router.put("", response_model=StockThresholdOut)
def upsert_threshold(
    payload: StockThresholdIn, db: Db, authz: Authz,
    user: Annotated[User, Depends(get_current_user)],
) -> StockThresholdOut:
    """Khai ngưỡng. Bỏ trống `nguong_can_ton` thì để NULL — service tự suy ra
    `nguong_ton × 1.3` lúc so sánh, khỏi phải backfill khi đổi hệ số.

    Quyền: ô "Khai ngưỡng tồn" trên DÒNG CỦA KHO được khai (`ton_kho_<kho_id>:set_threshold`,
    05/10/2026) — khai ngưỡng Kho giấy không cần quyền gì ở Kho thành phẩm."""
    if not authz.can(user, khoa_kho(payload.kho_id), "set_threshold"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền khai ngưỡng tồn ở kho này.",
        )
    if payload.nguong_can_ton is not None and payload.nguong_can_ton < payload.nguong_ton:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ngưỡng cận tồn phải lớn hơn hoặc bằng ngưỡng tồn.",
        )
    if payload.nguong_toi_da is not None and payload.nguong_toi_da < payload.nguong_ton:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ngưỡng tối đa phải lớn hơn hoặc bằng ngưỡng tồn.",
        )
    goc = payload.don_vi_goc
    if payload.hang_loai == "vat_tu" and not goc:
        # Vật tư tách tồn theo đơn vị gốc (mg 0390): khai ngưỡng không nói đơn vị ⇒ ĐVT chính.
        m = _hang_service(db).map_theo_cap([("vat_tu", payload.hang_id)]).get(("vat_tu", payload.hang_id))
        goc = (don_vi_khai(m) or [""])[0]
    obj = StockThresholdRepository(db).upsert(
        hang=(payload.hang_loai, payload.hang_id, payload.kho_rong, payload.kho_dai, goc),
        kho_id=payload.kho_id,
        nguong_ton=payload.nguong_ton, nguong_can_ton=payload.nguong_can_ton,
        nguong_toi_da=payload.nguong_toi_da, canh_bao=payload.canh_bao,
    )
    return StockThresholdOut.model_validate(obj)
