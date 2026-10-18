"""Router Phiếu tính giá — LƯU/liệt kê/mở lại/sửa bản tính giá THEO THÀNH PHẦN.

Prefix `/api/phieu-tinh-gia`. RBAC MODULE = "tinh_gia_thanh". 1 phiếu = header + nhiều thành phần
(mỗi thành phần = 1 tờ giấy) → mỗi thành phần có nhiều dòng gia công sau in.

SAVE (POST/PUT) = dựng lại cây con + `services.tinh_gia_service.compute_phieu_snapshot` tính lại
giá vốn từng thành phần + Σ toàn phiếu + ảnh chụp. PUT ghi ĐÈ TẠI CHỖ từng thành phần (giữ
`PhieuThanhPhan.id` cho pin ấn phẩm của báo giá/đơn/lệnh — xem `_ghi_thanh_phans`); riêng dòng
gia công + vật tư bên trong mỗi thành phần vẫn dựng lại từ đầu.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..deps import get_authorization_service, require_permission
from ..models.phieu_tinh_gia import (
    PhieuChiPhiKhac, PhieuThanhPham, PhieuThanhPhan, PhieuTinhGia, PhieuBuocVatTu,
)
from ..models.role import SCOPE_ALL, SCOPE_DEPARTMENT, SCOPE_OWN
from ..models.user import User
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.document_sequence_repo import DocumentSequenceRepository
from ..repositories.org_scope import (
    chu_cua, chu_theo_khach, dept_subtree_ids, nhom_dung_chung_user_ids,
)
from ..schemas.customer import SaleOption
from ..services.nguoi_phu_trach_service import lua_chon_nguoi
from ..repositories.tim_khong_dau import like_khong_dau
from ..models.customer import Customer
from ..models.quotation import Quote
from ..repositories.loc_danh_sach import dk_khoang_ngay
from ..schemas.loc_danh_sach import LuaChonLoc
from ..services.actor_display import actor_labels
from ..services.ptg_giay_buoc import NhomCua, chuan_hoa_giay, nhom_cong_doan
from ..schemas.phieu_tinh_gia import (
    DanhMucDoi,
    DanhMucDoiOut,
    NhomTongOut,
    PhieuTinhGiaCreate,
    PhieuTinhGiaKhachHangPatch,
    PhieuTinhGiaListItem,
    PhieuTinhGiaListOut,
    PhieuTinhGiaOut,
    PhieuTinhGiaOutRutGon,
    PhieuTinhGiaStatsOut,
    PhieuTinhGiaUpdate,
    PtgActivityItem,
    PtgActivityOut,
    SanPhamTaiBanChiTiet,
    SanPhamTaiBanGoiY,
    ThanhPhanIn,
)
from ..services import ptg_khach_hang_service, ptg_nhan_ban_service, san_pham_tai_ban_service
from ..services.rbac_service import AuthorizationService
from ..services.thanh_phan_engine import chuan_hoa_cot, cum_san_pham
from ..services.tinh_gia_service import compute_phieu_snapshot, danh_muc_doi_sau_khi_tinh

router = APIRouter(prefix="/api/phieu-tinh-gia", tags=["phieu-tinh-gia"])
MODULE = "tinh_gia_thanh"
Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]
#: Quyền chi tiết "Xem chi tiết giá vốn" — gác RUỘT GIÁ (cấu hình giấy/khổ/công đoạn + diễn
#: giải từng dòng). Đi KÈM dependency CRUD chứ không thay: `create`/`update` vẫn phải có, ô này
#: chỉ nói thêm "được nhìn vào trong". Lập hay sửa phiếu đều là mở thẻ sản phẩm ra khai nên hai
#: đường ghi buộc có cả hai. Xoá phiếu KHÔNG cần — xoá không lộ gì.
RuotGia = Annotated[User, Depends(require_permission(MODULE, "view_cost"))]


#: Chủ phiếu = sale phụ trách KHÁCH của phiếu, chưa chọn khách thì người lập (05/10/2026) — cùng
#: luật với màn Khách hàng, xem `org_scope.chu_theo_khach`. Hộp lọc "người lập" vẫn lọc theo người
#: lập thật (`created_by`), chỉ PHẠM VI xem là theo khách.
_CHU_PHIEU = chu_theo_khach(PhieuTinhGia.customer_id, PhieuTinhGia.created_by)


def _owner_ids_for_scope(db: Session, user: User, authz: AuthorizationService) -> set[int] | None:
    """Tập user-id chủ sở hữu phiếu mà `user` được thấy theo scope module. None = thấy TẤT CẢ.
    - Tất cả (all) → None (không lọc).
    - Của tôi (own) → mình + người CÙNG NHÓM DÙNG CHUNG (khối KD). Không thuộc nhóm nào thì
      đúng bằng {mình} ⇒ y như trước khi có nhóm.
    - Phòng (department) → mọi người trong phòng mình + cây con (GĐ/TP thấy cả team)."""
    scope = authz.scope_for(user, MODULE) or SCOPE_OWN
    if scope == SCOPE_ALL:
        return None
    if scope == SCOPE_DEPARTMENT:
        dept_ids = dept_subtree_ids(db, user.department_id)
        if dept_ids:
            ids = db.execute(select(User.id).where(User.department_id.in_(dept_ids))).scalars().all()
            return set(ids) | {user.id}
    return nhom_dung_chung_user_ids(db, user.id)


# Cây con của phiếu nạp MỘT lượt mỗi tầng (04/10/2026). Để lười thì mỗi sản phẩm tự hỏi lại bước,
# vật tư của bước, chi phí khác — mở phiếu 10 sản phẩm là 30 câu SQL thừa.
_CAY_PHIEU = (
    selectinload(PhieuTinhGia.thanh_phans)
    .selectinload(PhieuThanhPhan.thanh_phams)
    .selectinload(PhieuThanhPham.vat_tus),
    selectinload(PhieuTinhGia.thanh_phans).selectinload(PhieuThanhPhan.chi_phi_khacs),
)


def _fetch_in_scope(db: Session, p_id: int, user: User, authz: AuthorizationService) -> PhieuTinhGia:
    """Lấy 1 phiếu + chặn nếu ngoài phạm vi của người xem (ẩn = 404, không lộ tồn tại)."""
    p = db.get(PhieuTinhGia, p_id, options=_CAY_PHIEU)
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiếu tính giá")
    owner_ids = _owner_ids_for_scope(db, user, authz)
    if owner_ids is not None and chu_cua(db, p.customer_id, p.created_by) not in owner_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiếu tính giá")
    return p


def _nap_lai(db: Session, p_id: int) -> PhieuTinhGia:
    """Đọc lại phiếu SAU commit (mọi thuộc tính đã hết hạn) — kèm cả cây trong vài câu SELECT;
    để `model_validate` tự lazy-load thì mỗi sản phẩm, mỗi bước thêm một câu."""
    return db.execute(
        select(PhieuTinhGia).options(*_CAY_PHIEU).where(PhieuTinhGia.id == p_id)
        .execution_options(populate_existing=True)
    ).scalar_one()


def _ten_nguoi_lap(db: Session, user_ids: set[int | None]) -> dict[int, str]:
    """Tên người lập tra từ TÀI KHOẢN `created_by` lúc đọc (05/10/2026). Cột chữ `ktv` chỉ là ảnh
    chụp lúc tạo: chuyển người lập (đổi `created_by`) mà quên `ktv` là dòng ghi "Admin" trong khi
    phạm vi "Của tôi" và hộp lọc người lập đều tính theo `created_by` — màn tự mâu thuẫn."""
    ids = {i for i in user_ids if i is not None}
    if not ids:
        return {}
    rows = db.execute(select(User.id, User.name, User.username).where(User.id.in_(ids))).all()
    return {uid: (name or username) for uid, name, username in rows}


def _gan_nguoi_lap(db: Session, p: PhieuTinhGia, out) -> None:
    """Đè `ktv` của bản trả về bằng tên tài khoản `created_by`; phiếu cũ không có `created_by`
    thì giữ ảnh chụp `ktv`."""
    out.ktv = _ten_nguoi_lap(db, {p.created_by}).get(p.created_by, p.ktv)


def _out_day_du(db: Session, p: PhieuTinhGia) -> PhieuTinhGiaOut:
    """`PhieuTinhGiaOut` + tên khách (tên không lưu ở phiếu — tra từ `customers`)."""
    out = PhieuTinhGiaOut.model_validate(p)
    ptg_khach_hang_service.gan_khach_out(db, p, out)
    _gan_nguoi_lap(db, p, out)
    return out


def _next_ma(db: Session) -> str:
    """PTG-{year}-{seq:04d} qua bộ đếm. Trước là (số phiếu năm nay) + 1: xoá một phiếu là mã kế
    trùng mã đang có, và hai người lưu cùng lúc cùng nhận một mã."""
    year = datetime.now().year
    return DocumentSequenceRepository(db).cap_ma(
        "phieu_tinh_gia", year, PhieuTinhGia.ma, f"PTG-{year}-",
    )


def _con_cua_thanh_phan(tp: PhieuThanhPhan, rows_in: list[dict],
                        cpk_in: list[dict] | None = None) -> None:
    """Dựng lại TOÀN BỘ dòng gia công (kèm vật tư của từng bước) + chi phí khác của một thành phần.

    Con sâu vẫn REPLACE-ALL (delete-orphan lo xoá): không nơi nào ghim `phieu_thanh_pham.id`,
    `phieu_buoc_vat_tu.id` hay `phieu_chi_phi_khac.id`, nên id của chúng đổi cũng không gãy gì —
    khác hẳn `phieu_thanh_phan.id`. `vat_tus` của bước bị `pop` khỏi dict TRƯỚC khi dựng
    `PhieuThanhPham(**rd)` — để nguyên thì SQLAlchemy nổ vì list-dict không phải ORM."""
    tp.thanh_phams.clear()
    for j, row in enumerate(rows_in):
        rd = dict(row)
        vt_in = rd.pop("vat_tus", None) or []
        rd.setdefault("thu_tu", j)
        # `vat_tus` gán NGAY lúc dựng (kể cả rỗng): collection đã khởi tạo thì engine đọc sau flush
        # không lazy-load — để trống là mỗi bước thêm một câu SELECT vật tư.
        tp.thanh_phams.append(PhieuThanhPham(**rd, vat_tus=[
            PhieuBuocVatTu(**{"thu_tu": k, **dict(vt)}) for k, vt in enumerate(vt_in)
        ]))
    tp.chi_phi_khacs.clear()
    for m, cp in enumerate(cpk_in or []):
        cd = dict(cp)
        cd.setdefault("thu_tu", m)
        tp.chi_phi_khacs.append(PhieuChiPhiKhac(**cd))


def nhom_cua_payload(db: Session, thanh_phans: list[ThanhPhanIn] | None) -> NhomCua:
    """Bản tra nhóm công đoạn cho mọi bước trong payload — để chốt giấy chính (`chuan_hoa_giay`)."""
    return nhom_cong_doan(db, (r.cong_doan_id for t in (thanh_phans or [])
                               for r in (t.thanh_phams or [])))


def _du_lieu_thanh_phan(tp_in: ThanhPhanIn, nhom_cua: NhomCua | None) -> dict:
    """Payload → dict để ghi; giấy chính (`giay_id`) do máy chủ chốt từ dòng giấy của các bước."""
    data = tp_in.model_dump(exclude_unset=True)
    return chuan_hoa_giay(data, nhom_cua) if nhom_cua is not None else data


def _build_thanh_phan(tp_in: ThanhPhanIn, thu_tu: int,
                      nhom_cua: NhomCua | None = None) -> PhieuThanhPhan:
    """Dựng ORM thành phần MỚI + con finishing từ payload (chỉ set field được gửi → giữ default model)."""
    data = _du_lieu_thanh_phan(tp_in, nhom_cua)
    rows_in = data.pop("thanh_phams", None) or []
    cpk_in = data.pop("chi_phi_khacs", None) or []
    data.setdefault("thu_tu", thu_tu)
    tp = PhieuThanhPhan(**data)
    _con_cua_thanh_phan(tp, rows_in, cpk_in)
    return tp


# Cột DỮ LIỆU của thành phần (bỏ khoá + dấu thời gian) — danh sách để ghi đè tại chỗ.
_COT_THANH_PHAN = tuple(
    c.key for c in PhieuThanhPhan.__table__.columns
    if c.key not in {"id", "phieu_id", "created_at", "updated_at"}
)


def _mac_dinh_cot(ten_cot: str):
    """Default Python của cột. Dựng hàng MỚI thì SQLAlchemy tự đắp default lúc INSERT; ghi đè hàng
    CŨ thì không ai đắp hộ, nên field payload bỏ trống phải tự trả về default — không thì nó giữ
    nguyên số của lần lưu trước, khác hành vi xoá-tạo-lại trước đây."""
    d = PhieuThanhPhan.__table__.columns[ten_cot].default
    if d is None:
        return None
    return d.arg(None) if d.is_callable else d.arg


def _ghi_de_thanh_phan(tp: PhieuThanhPhan, tp_in: ThanhPhanIn, thu_tu: int,
                       nhom_cua: NhomCua | None = None) -> None:
    """Ghi payload lên thành phần CÓ SẴN, GIỮ NGUYÊN `id` (đây là chỗ cứu pin ấn phẩm)."""
    data = _du_lieu_thanh_phan(tp_in, nhom_cua)
    rows_in = data.pop("thanh_phams", None) or []
    cpk_in = data.pop("chi_phi_khacs", None) or []
    data.setdefault("thu_tu", thu_tu)
    for cot in _COT_THANH_PHAN:
        gia_tri = data.get(cot)
        setattr(tp, cot, _mac_dinh_cot(cot) if gia_tri is None else gia_tri)
    _con_cua_thanh_phan(tp, rows_in, cpk_in)


def _khoa_ten(ten: str | None) -> str:
    return (ten or "").strip().lower()


def _ghi_thanh_phans(p: PhieuTinhGia, thanh_phans: list[ThanhPhanIn] | None,
                    nhom_cua: NhomCua | None = None) -> None:
    """Ghi lại danh sách thành phần, DÙNG LẠI hàng cũ để `PhieuThanhPhan.id` KHÔNG đổi.

    Trước 07/09/2026 hàm này xoá sạch rồi chèn lại, nên mỗi lần bấm Lưu/Tính giá là id thành phần
    mới toanh (Postgres không tái dùng id). Ba nơi ghim mềm id đó — `quote_items` / `order_lines` /
    `lsx.phieu_thanh_phan_id` — hoá "pin chết": drawer Lệnh dự kiến hiện "—" ở mọi ô kỹ thuật, và
    `OrderService.confirm` chặn thẳng đơn với lời "trỏ tới sản phẩm tính giá đã bị xoá".

    Ghép cặp cũ↔mới: khớp theo TÊN trước (chỉ nhận khi tên đó có ĐÚNG một hàng cũ và một dòng
    payload), phần còn lại ghép theo VỊ TRÍ. Nhờ vòng tên, xoá bớt một sản phẩm giữa chừng không
    làm pin các sản phẩm khác trượt sang hàng bên cạnh. Hàng cũ không ai nhận thì xoá — pin của nó
    chết như cũ, thà mất số còn hơn trỏ nhầm sang ấn phẩm khác."""
    moi = list(thanh_phans or [])
    con_lai = list(p.thanh_phans)
    dem_moi = Counter(_khoa_ten(t.ten) for t in moi)
    cu_theo_ten: dict[str, list[PhieuThanhPhan]] = {}
    for tp in con_lai:
        cu_theo_ten.setdefault(_khoa_ten(tp.ten), []).append(tp)

    ghep: list[PhieuThanhPhan | None] = [None] * len(moi)
    for i, tp_in in enumerate(moi):
        ten = _khoa_ten(tp_in.ten)
        cu = cu_theo_ten.get(ten) or []
        if ten and dem_moi[ten] == 1 and len(cu) == 1 and cu[0] in con_lai:
            ghep[i] = cu[0]
            con_lai.remove(cu[0])
    for i in range(len(moi)):
        if ghep[i] is None and con_lai:
            ghep[i] = con_lai.pop(0)

    for thua in con_lai:
        p.thanh_phans.remove(thua)
    for i, tp_in in enumerate(moi):
        cu_tp = ghep[i]
        if cu_tp is None:
            p.thanh_phans.append(_build_thanh_phan(tp_in, i, nhom_cua))
        else:
            _ghi_de_thanh_phan(cu_tp, tp_in, i, nhom_cua)


# SL hiển thị ngoài bảng = Σ SL các sản phẩm bên trong phiếu, sản phẩm bỏ trống SL rơi về SL mặc
# định đầu phiếu (in lại đúng công thức Python trong vòng lặp bên dưới, để sort server-side khớp
# với số hiển thị). Không có sản phẩm nào (phiếu nháp) → SL mặc định đầu phiếu.
_SO_LUONG_EXPR = (
    select(
        func.coalesce(
            func.sum(
                case(
                    (PhieuThanhPhan.so_luong != 0, PhieuThanhPhan.so_luong),
                    else_=PhieuTinhGia.so_luong,
                )
            ),
            PhieuTinhGia.so_luong,
        )
    )
    .where(PhieuThanhPhan.phieu_id == PhieuTinhGia.id)
    .correlate(PhieuTinhGia)
    .scalar_subquery()
)

_SORT_COLUMNS = {
    "ma": PhieuTinhGia.ma,
    "so_luong": _SO_LUONG_EXPR,
    "gia_von_don": PhieuTinhGia.gia_von_don,
    "tong_gia_von": PhieuTinhGia.tong_gia_von,
    "ngay": PhieuTinhGia.created_at,
}


def _co_thanh_phan():
    return select(PhieuThanhPhan.id).where(PhieuThanhPhan.phieu_id == PhieuTinhGia.id).exists()


# Trạng thái không phải cột DB — khớp đúng badge ngoài bảng (FE `PhieuTinhGiaListView`):
# - Nháp: phiếu chưa có sản phẩm nào bên trong.
# - Đang tính: có sản phẩm nhưng chưa ra giá (tổng giá vốn 0).
# - Đã tính giá: có sản phẩm và đã ra giá. Trước 07/10/2026 tab này đếm cả phiếu 0 đ.
_DK_TRANG_THAI = {
    "draft": lambda: ~_co_thanh_phan(),
    "dang_tinh": lambda: _co_thanh_phan() & (func.coalesce(PhieuTinhGia.tong_gia_von, 0) <= 0),
    "calculated": lambda: _co_thanh_phan() & (PhieuTinhGia.tong_gia_von > 0),
}


def _loc_danh_sach(
    stmt,
    *,
    db: Session,
    user: User,
    authz: AuthorizationService,
    q: str | None,
    nguoi: int | None,
    tu_ngay: date | None,
    den_ngay: date | None,
    khach: int | None,
    gv_tu: int | None,
    gv_den: int | None,
    bao_gia: str | None,
):
    """Mọi điều kiện lọc CHUNG của bảng và thanh tab (trừ chính tab trạng thái) — tab đếm đúng số
    dòng bảng sẽ hiện khi bấm vào nó."""
    owner_ids = _owner_ids_for_scope(db, user, authz)
    if owner_ids is not None:
        stmt = stmt.where(_CHU_PHIEU.in_(owner_ids))
    if nguoi is not None:   # hộp lọc người lập — AND với phạm vi, không vượt được tầm nhìn
        stmt = stmt.where(PhieuTinhGia.created_by == nguoi)
    if q and q.strip():
        # Tìm TƯƠNG ĐỐI (không dấu, không phân biệt hoa thường) — gõ "hop qua" ra "Hộp quà".
        # Gõ tên hàng phải ra phiếu, kể cả khi tên đó chỉ nằm ở SẢN PHẨM BÊN TRONG. Cột "Sản phẩm"
        # ngoài bảng rơi về tên hàng bên trong khi ô đầu phiếu bỏ trống (xem `ten_thanh_phans`) —
        # nhìn thấy chữ mà gõ đúng chữ đó lại không tìm ra thì người dùng tưởng mất phiếu.
        stmt = stmt.where(or_(
            like_khong_dau(PhieuTinhGia.ma, q),
            like_khong_dau(PhieuTinhGia.ten_san_pham, q),
            like_khong_dau(PhieuTinhGia.ghi_chu, q),   # cột "Ghi chú" ngoài bảng
            PhieuTinhGia.id.in_(
                select(PhieuThanhPhan.phieu_id).where(like_khong_dau(PhieuThanhPhan.ten, q))
            ),
            # Cột "Khách hàng" ngoài bảng — gõ tên khách cũng phải ra phiếu.
            PhieuTinhGia.customer_id.in_(select(Customer.id).where(like_khong_dau(Customer.name, q))),
        ))
    # Dải kỳ + bảng "Bộ lọc nâng cao" (06/10/2026).
    for dk in dk_khoang_ngay(PhieuTinhGia.created_at, tu_ngay, den_ngay):
        stmt = stmt.where(dk)
    if khach is not None:
        stmt = stmt.where(PhieuTinhGia.customer_id == khach)
    if gv_tu is not None:
        stmt = stmt.where(PhieuTinhGia.tong_gia_von >= gv_tu)
    if gv_den is not None:
        stmt = stmt.where(PhieuTinhGia.tong_gia_von <= gv_den)
    if bao_gia in ("co", "chua"):
        # Một phiếu một báo giá (UNIQUE `quotes.phieu_tinh_gia_id`, mọi trạng thái).
        co_bg = select(Quote.id).where(Quote.phieu_tinh_gia_id == PhieuTinhGia.id).exists()
        stmt = stmt.where(co_bg if bao_gia == "co" else ~co_bg)
    return stmt


@router.get("", response_model=PhieuTinhGiaListOut)
def list_items(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    q: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    sort: str = Query(default="-ngay"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
    nguoi: int | None = Query(default=None),
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    khach: int | None = Query(default=None),
    gv_tu: int | None = Query(default=None, ge=0),
    gv_den: int | None = Query(default=None, ge=0),
    bao_gia: str | None = Query(default=None, pattern="^(co|chua)$"),
) -> PhieuTinhGiaListOut:
    stmt = _loc_danh_sach(
        select(PhieuTinhGia), db=db, user=user, authz=authz, q=q, nguoi=nguoi,
        tu_ngay=tu_ngay, den_ngay=den_ngay, khach=khach, gv_tu=gv_tu, gv_den=gv_den, bao_gia=bao_gia,
    )
    dk = _DK_TRANG_THAI.get(status_filter or "")
    if dk is not None:
        stmt = stmt.where(dk())
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    # Dòng "Cộng" cuối bảng: Σ tổng giá vốn của MỌI dòng khớp bộ lọc (không chỉ trang đang xem).
    tong_gia_von = db.scalar(
        select(func.coalesce(func.sum(PhieuTinhGia.tong_gia_von), 0)).where(
            PhieuTinhGia.id.in_(stmt.with_only_columns(PhieuTinhGia.id).order_by(None))
        )
    ) or 0

    sort_key = sort.lstrip("-") if sort else "ngay"
    sort_col = _SORT_COLUMNS.get(sort_key, PhieuTinhGia.created_at)
    is_desc = not sort or sort.startswith("-")
    rows = db.execute(
        stmt.options(selectinload(PhieuTinhGia.thanh_phans))
        .order_by(sort_col.desc() if is_desc else sort_col.asc())
        .offset((page - 1) * size)
        .limit(size)
    ).scalars().all()
    ten_khach = ptg_khach_hang_service.ten_khach(db, {r.customer_id for r in rows})
    ten_lap = _ten_nguoi_lap(db, {r.created_by for r in rows})
    # Cột "Báo giá": một phiếu một báo giá (UNIQUE `quotes.phieu_tinh_gia_id`) — một truy vấn cho cả trang.
    bao_gia = {
        pid: (qid, so)
        for qid, so, pid in db.execute(
            select(Quote.id, Quote.quote_number, Quote.phieu_tinh_gia_id).where(
                Quote.phieu_tinh_gia_id.in_([r.id for r in rows])
            )
        ).all()
    } if rows else {}
    items = []
    for r in rows:
        it = PhieuTinhGiaListItem.model_validate(r)
        it.customer_name = ten_khach.get(r.customer_id)
        it.ktv = ten_lap.get(r.created_by, r.ktv)
        it.so_thanh_phan = len(r.thanh_phans)
        # Cột "SL" ngoài bảng phải là ĐÚNG SỐ MÀ ĐƠN GIÁ ĐANG CHIA: Σ SL các SẢN PHẨM bên trong
        # phiếu (engine: `compute_phieu.tong_sl`), sản phẩm bỏ trống SL thì rơi về SL mặc định ở
        # đầu phiếu (engine: `_compute_one`). Lấy thẳng `phieu.so_luong` như trước là bày ra hai
        # số không nhân lại được với nhau — PTG-2026-0009 hiện SL 20.000 trong khi 44.856.157đ
        # đang chia cho 60.000 sản phẩm ra 748đ/sp.
        # Sản phẩm = cụm báo giá (`cum_san_pham`, 13/10/2026): ruột + bìa cùng nhóm là MỘT cuốn, nên
        # cột Sản phẩm hiện tên nhóm và SL không cộng hai lần.
        cum = cum_san_pham([
            ((tp.ten or "").strip(), tp.nhom_bao_gia, int(tp.so_luong or 0) or int(r.so_luong or 0))
            for tp in sorted(r.thanh_phans, key=lambda x: (x.thu_tu or 0, x.id or 0))
        ])
        if cum:
            it.so_luong = sum(k["so_luong"] for k in cum)
        it.ten_thanh_phans = [k["ten"] for k in cum if k["ten"]]
        if r.id in bao_gia:
            it.bao_gia_id, it.bao_gia_ma = bao_gia[r.id]
        items.append(it)
    return PhieuTinhGiaListOut(items=items, total=total, tong_gia_von=float(tong_gia_von))


@router.get("/stats", response_model=PhieuTinhGiaStatsOut)
def stats(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    q: str | None = Query(default=None),
    nguoi: int | None = Query(default=None),
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    khach: int | None = Query(default=None),
    gv_tu: int | None = Query(default=None, ge=0),
    gv_den: int | None = Query(default=None, ge=0),
    bao_gia: str | None = Query(default=None, pattern="^(co|chua)$"),
) -> PhieuTinhGiaStatsOut:
    """Đếm cho thanh tab, theo ĐÚNG bộ lọc đang áp trên bảng — phải đặt TRƯỚC route `/{p_id}` (int)
    trong file, không thì FastAPI thử ép "stats" thành int và 422 trước khi kịp rơi xuống route này."""
    stmt = _loc_danh_sach(
        select(PhieuTinhGia.id), db=db, user=user, authz=authz, q=q, nguoi=nguoi,
        tu_ngay=tu_ngay, den_ngay=den_ngay, khach=khach, gv_tu=gv_tu, gv_den=gv_den, bao_gia=bao_gia,
    )
    dem = lambda k: db.scalar(  # noqa: E731
        select(func.count()).select_from(stmt.where(_DK_TRANG_THAI[k]()).subquery())
    ) or 0
    return PhieuTinhGiaStatsOut(
        all=db.scalar(select(func.count()).select_from(stmt.subquery())) or 0,
        draft=dem("draft"), dang_tinh=dem("dang_tinh"), calculated=dem("calculated"),
    )


@router.get("/khach-loc", response_model=list[LuaChonLoc])
def list_khach_loc(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> list[LuaChonLoc]:
    """Ô "Khách hàng" của bảng lọc: khách đang có phiếu TRONG tầm nhìn, kèm số phiếu. Không mượn
    danh sách của màn Khách hàng — người chỉ có quyền Tính giá vẫn lọc được."""
    stmt = (
        select(Customer.id, Customer.name, func.count(PhieuTinhGia.id))
        .join(Customer, Customer.id == PhieuTinhGia.customer_id)
        .group_by(Customer.id, Customer.name)
        .order_by(Customer.name)
    )
    owner_ids = _owner_ids_for_scope(db, user, authz)
    if owner_ids is not None:
        stmt = stmt.where(_CHU_PHIEU.in_(owner_ids))
    return [LuaChonLoc(id=i, ten=t, so=int(n)) for i, t, n in db.execute(stmt)]


@router.get("/nguoi-lap", response_model=list[SaleOption])
def list_nguoi_lap(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> list[SaleOption]:
    """Hộp lọc người lập: ai đang có phiếu TRONG tầm nhìn (phạm vi + nhóm dùng chung). Đặt TRƯỚC
    `/{p_id}` cùng lý do với `/stats`."""
    stmt = (
        select(PhieuTinhGia.created_by, func.count())
        .where(PhieuTinhGia.created_by.is_not(None))
        .group_by(PhieuTinhGia.created_by)
    )
    owner_ids = _owner_ids_for_scope(db, user, authz)
    if owner_ids is not None:
        stmt = stmt.where(_CHU_PHIEU.in_(owner_ids))
    dem = {int(uid): int(c) for uid, c in db.execute(stmt)}
    return lua_chon_nguoi(db, dem, user)


@router.post("", response_model=PhieuTinhGiaOut, status_code=status.HTTP_201_CREATED)
def create_item(
    payload: PhieuTinhGiaCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
    _ruot: RuotGia,
    authz: Authz,
) -> PhieuTinhGiaOut:
    p = PhieuTinhGia(
        ma=_next_ma(db),
        ten_san_pham=payload.ten_san_pham or "",
        kho_thanh_pham=payload.kho_thanh_pham,
        so_luong=payload.so_luong or 0,
        ghi_chu=payload.ghi_chu,
        ktv=(user.name or user.username),
        created_by=user.id,
    )
    # Khách chọn ngay lúc lập phiếu (phiếu chưa lưu mà đã chọn khách ở dải đầu phiếu).
    ptg_khach_hang_service.ap_khach(
        db, p, payload.model_dump(exclude_unset=True, include=set(ptg_khach_hang_service.O_KHACH)),
        actor=user, scope_khach=authz.scope_for(user, "khach_hang"),
    )
    _ghi_thanh_phans(p, payload.thanh_phans, nhom_cua_payload(db, payload.thanh_phans))
    db.add(p)
    db.flush()
    compute_phieu_snapshot(db, p)
    # Nhật ký hoạt động: ai LẬP phiếu, khi nào — cùng một commit với phiếu.
    AuditLogRepository(db).create(
        actor_user_id=user.id,
        action="create_ptg",
        target=f"phieu_tinh_gia:{p.id}",
        detail=f"Lập phiếu tính giá {p.ma}",
        commit=False,
    )
    db.commit()
    return _out_day_du(db, _nap_lai(db, p.id))


@router.post("/{p_id}/nhan-ban", response_model=PhieuTinhGiaOut, status_code=status.HTTP_201_CREATED)
def nhan_ban_phieu(
    p_id: int,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
    _ruot: RuotGia,
) -> PhieuTinhGiaOut:
    """Nhân bản phiếu — bản sao mang mã mới, người lập là người bấm, giá vốn tính lại theo danh
    mục hôm nay. Một phiếu chỉ một báo giá, nên đây là đường lập báo giá thứ hai từ cùng cấu hình.
    Cần quyền Tạo + "Xem chi tiết giá vốn" (bản sao chép nguyên ruột giá), phiếu gốc phải trong
    phạm vi xem (ngoài phạm vi = 404)."""
    nguon = _fetch_in_scope(db, p_id, user, authz)
    p = ptg_nhan_ban_service.nhan_ban(nguon, ma=_next_ma(db), actor=user)
    db.add(p)
    db.flush()
    compute_phieu_snapshot(db, p)
    AuditLogRepository(db).create(
        actor_user_id=user.id,
        action="create_ptg",
        target=f"phieu_tinh_gia:{p.id}",
        detail=f"Nhân bản phiếu tính giá {p.ma} từ {nguon.ma}",
        commit=False,
    )
    db.commit()
    return _out_day_du(db, _nap_lai(db, p.id))


@router.get("/san-pham-tai-ban", response_model=list[SanPhamTaiBanGoiY])
def san_pham_tai_ban_goi_y(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    _ruot: RuotGia,
    customer_id: int = Query(...),
    q: str = Query(default=""),
    size: int = Query(default=20, ge=1, le=50),
) -> list[dict]:
    """Thành phẩm CỦA KHÁCH đầu phiếu để chọn tái bản (11/10/2026 — trước đó chung mọi khách, khoá
    theo tên). Đặt TRƯỚC route `/{p_id}` (int) — lý do như `/stats`."""
    return san_pham_tai_ban_service.tim_kiem(db, customer_id, q, size)


@router.get("/san-pham-tai-ban/{id}", response_model=SanPhamTaiBanChiTiet)
def san_pham_tai_ban_chi_tiet(
    id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    _ruot: RuotGia,
    customer_id: int = Query(...),
) -> dict:
    row = san_pham_tai_ban_service.lay_chi_tiet(db, customer_id, id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Không tìm thấy sản phẩm tái bản của khách này")
    return row


@router.get("/{p_id}", response_model=None)
def get_item(
    p_id: int,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> PhieuTinhGiaOut | PhieuTinhGiaOutRutGon:
    return _out_theo_quyen(db, _fetch_in_scope(db, p_id, user, authz), user, authz)


def _out_theo_quyen(
    db: Session, p: PhieuTinhGia, user: User, authz: AuthorizationService,
) -> PhieuTinhGiaOut | PhieuTinhGiaOutRutGon:
    """Phiếu như GET trả: đủ ruột giá nếu có "Xem chi tiết giá vốn", không thì bản rút gọn."""
    # Thiếu "Xem chi tiết giá vốn" → KHÔNG dựng `PhieuTinhGiaOut` rồi cắt: dựng rồi cắt là để
    # ngỏ đường quên cắt một chỗ. Trả thẳng model rút gọn — nó không có field ruột giá để mà lọt.
    if not authz.can(user, MODULE, "view_cost"):
        rut_gon = PhieuTinhGiaOutRutGon.model_validate(p)
        ptg_khach_hang_service.gan_khach_out(db, p, rut_gon)
        _gan_nguoi_lap(db, p, rut_gon)
        # Ba rổ (Nguyên vật liệu · Công đoạn · Giao hàng) chỉ lấy TÊN + TỔNG. `rows`/`columns`
        # của mỗi rổ mới là diễn giải — không đi kèm.
        groups = (p.result_json or {}).get("groups") or []
        rut_gon.nhom_tong = [
            NhomTongOut(ten=str(g.get("name") or ""), tong=float(g.get("subtotal") or 0))
            for g in groups
            if isinstance(g, dict)
        ]
        return rut_gon
    out = _out_day_du(db, p)
    # Ảnh chụp giữ SỐ, không giữ CÁCH BÀY: đắp lại danh sách cột theo khai báo hiện tại của engine
    # để phiếu cũ không còn gánh cột đã bỏ (cột "Ghi chú" rỗng, 25/08/2026).
    out.result = chuan_hoa_cot(out.result)
    # Mở phiếu = ĐỌC LẠI ẢNH CHỤP, không tính lại (chủ ý — xem docstring service). Chỉ kèm thêm
    # lời nhắc nếu danh mục đã đổi sau lần tính; bấm hay không là quyền người lập phiếu.
    # POST/PUT không cần: hai đường đó vừa tính lại xong nên luôn còn khớp.
    doi = danh_muc_doi_sau_khi_tinh(db, p)
    if doi is not None:
        out.danh_muc_doi = DanhMucDoi(**doi)
    return out


@router.get("/{p_id}/danh-muc-doi", response_model=DanhMucDoiOut)
def danh_muc_doi(
    p_id: int,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> DanhMucDoiOut:
    """CHỈ lời nhắc "danh mục đã đổi sau lần tính" của một phiếu — màn phiếu đang mở hỏi lại khi
    nhận tín hiệu danh mục đổi (SSE `danh_muc_doi`). Trước đây nó gọi lại cả `GET /{p_id}` (ảnh
    chụp kết quả, 16 KB) chỉ để đọc đúng trường này."""
    p = _fetch_in_scope(db, p_id, user, authz)
    doi = danh_muc_doi_sau_khi_tinh(db, p)
    return DanhMucDoiOut(danh_muc_doi=DanhMucDoi(**doi) if doi is not None else None)


@router.put("/{p_id}", response_model=PhieuTinhGiaOut)
def update_item(
    p_id: int,
    payload: PhieuTinhGiaUpdate,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    _ruot: RuotGia,
) -> PhieuTinhGiaOut:
    p = _fetch_in_scope(db, p_id, user, authz)
    data = payload.model_dump(exclude_unset=True)
    for field in ("ten_san_pham", "kho_thanh_pham", "so_luong", "ghi_chu"):
        if field in data:
            setattr(p, field, data[field])
    if "thanh_phans" in data:
        _ghi_thanh_phans(p, payload.thanh_phans, nhom_cua_payload(db, payload.thanh_phans))
    db.flush()
    compute_phieu_snapshot(db, p)
    # Báo giá NHÁP của phiếu theo ngay số lượng / giá vốn mới (dòng gõ tay giữ giá gõ tay);
    # báo giá đã gửi giữ nguyên, màn báo giá hiện băng "phiếu đã đổi".
    ptg_khach_hang_service.dong_bo_bao_gia_nhap(db, p, actor=user)
    AuditLogRepository(db).create(
        actor_user_id=user.id,
        action="update_ptg",
        target=f"phieu_tinh_gia:{p.id}",
        detail=f"Cập nhật phiếu tính giá {p.ma}",
        commit=False,
    )
    db.commit()  # MỘT lần: phiếu + báo giá nháp + nhật ký
    return _out_day_du(db, _nap_lai(db, p.id))


@router.patch("/{p_id}/khach-hang", response_model=None)
def chon_khach_hang(
    p_id: int,
    payload: PhieuTinhGiaKhachHangPatch,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> PhieuTinhGiaOut | PhieuTinhGiaOutRutGon:
    """Khách, điểm giao, người nhận, ghi chú của phiếu — dải đầu màn phiếu.

    KHÔNG cần "Xem chi tiết giá vốn" (khách hàng không phải ruột giá) và KHÔNG tính lại giá.
    Khách phải nằm trong phạm vi Khách hàng của người chọn (403). Xong thì mọi báo giá NHÁP của
    phiếu theo ngay; báo giá đã gửi khách giữ nguyên."""
    p = _fetch_in_scope(db, p_id, user, authz)
    data = payload.model_dump(exclude_unset=True)
    ptg_khach_hang_service.ap_khach(
        db, p, data, actor=user, scope_khach=authz.scope_for(user, "khach_hang"),
    )
    if "ghi_chu" in data:
        p.ghi_chu = data["ghi_chu"]
    db.flush()
    ptg_khach_hang_service.dong_bo_bao_gia_nhap(db, p, actor=user)
    AuditLogRepository(db).create(
        actor_user_id=user.id,
        action="update_ptg",
        target=f"phieu_tinh_gia:{p.id}",
        detail=f"Cập nhật khách hàng / ghi chú phiếu tính giá {p.ma}",
        commit=False,
    )
    db.commit()
    return _out_theo_quyen(db, _nap_lai(db, p.id), user, authz)


@router.delete("/{p_id}")
def delete_item(
    p_id: int,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "delete"))],
) -> dict:
    p = _fetch_in_scope(db, p_id, user, authz)
    ma = p.ma
    pid = p.id
    db.delete(p)
    db.commit()
    # Nhật ký hoạt động: ai XOÁ phiếu, khi nào (ghi sau khi đã xoá; giữ target theo id cũ).
    AuditLogRepository(db).create(
        actor_user_id=user.id,
        action="delete_ptg",
        target=f"phieu_tinh_gia:{pid}",
        detail=f"Xoá phiếu tính giá {ma}",
    )
    return {"ok": True}


@router.get("/{p_id}/activity", response_model=PtgActivityOut)
def phieu_activity(
    p_id: int,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> PtgActivityOut:
    """Nhật ký hoạt động THẬT của 1 phiếu tính giá (ai làm gì · khi nào) — nhiều vai trò
    (KTV/sale/TP) có thể cùng sửa 1 phiếu nên mỗi thao tác để lại dấu vết. Đọc audit theo
    target `phieu_tinh_gia:{id}`, mới→cũ, kèm NGƯỜI thao tác ghi theo HỒ SƠ ("Phòng ban · Chức vụ
    · Tên" — `actor_display`, dùng chung với feed Báo giá). RBAC + phạm vi qua `_fetch_in_scope`
    (ngoài phạm vi = 404, không lộ tồn tại)."""
    _fetch_in_scope(db, p_id, user, authz)
    rows = AuditLogRepository(db).list_by_target(f"phieu_tinh_gia:{p_id}")
    names = actor_labels(db, {r.actor_user_id for r in rows if r.actor_user_id is not None})
    items = [
        PtgActivityItem(
            action=r.action,
            actor_name=names.get(r.actor_user_id) if r.actor_user_id else None,
            detail=r.detail,
            at=r.created_at,
        )
        for r in rows
    ]
    return PtgActivityOut(items=items)
