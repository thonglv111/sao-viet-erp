"""Router màn "Hồ sơ lệnh sản xuất" — tra cứu lệnh đã phát hành (làm gọn 05/10/2026).

Prefix `/api/lenh-san-xuat`. RBAC MODULE = `lenh_san_xuat`.

PHẠM VI LẤY TỪ TOKEN: `sale_ids` luôn do `pham_vi.sale_ids_theo_pham_vi(db, user, authz, MODULE)`
sinh ra; không tham số nào cho người gọi tự nới phạm vi (bài canh `test_client_khong_tu_noi_pham_vi`).

Đường TĨNH (`/bo-loc`) khai TRƯỚC `/{lsx_id}`: FastAPI khớp theo thứ tự khai, khai ngược thì
`/bo-loc` bị route động nuốt và trả 422.

Router chỉ điều phối; nghiệp vụ ở `services/lenh_sx/danh_sach.py` và `ho_so.py`.
"""
from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_authorization_service, require_permission
from ..models.user import User
from ..schemas.loc_danh_sach import LuaChonLoc
from ..schemas.lenh_san_xuat import LenhSxBoLocOut, LenhSxHoSoOut, LenhSxListOut, LenhSxNganOut
from ..services.lenh_sx import danh_sach, ho_so, pham_vi, phieu_cong_nghe
from ..services.rbac_service import AuthorizationService

router = APIRouter(prefix="/api/lenh-san-xuat", tags=["lenh-san-xuat"])
MODULE = "lenh_san_xuat"
Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]

# `Literal` từ chính hằng của service: giá trị lạ (kể cả tab cũ `canh_bao`) ăn 422 ở cửa thay vì
# lặng lẽ trả tập rỗng.
Tab = Literal[danh_sach.TAB_CHO_PHEP]


@router.get("/bo-loc", response_model=LenhSxBoLocOut)
def bo_loc(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
):
    """Nguồn ô Khách — khách của chính các lệnh trong phạm vi người gọi."""
    sale_ids = pham_vi.sale_ids_theo_pham_vi(db, user, authz, MODULE)
    return danh_sach.bo_loc(db, sale_ids=sale_ids)


@router.get("/khach-loc", response_model=list[LuaChonLoc])
def khach_loc(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
):
    """Ô "Khách hàng" của thanh lọc — khách của các lệnh trong phạm vi, kèm số lệnh."""
    sale_ids = pham_vi.sale_ids_theo_pham_vi(db, user, authz, MODULE)
    return danh_sach.khach_loc(db, sale_ids=sale_ids)


@router.get("/don-loc", response_model=list[LuaChonLoc])
def don_loc(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
):
    """Ô "Đơn hàng" của thanh lọc — đơn của các lệnh trong phạm vi, kèm số lệnh."""
    sale_ids = pham_vi.sale_ids_theo_pham_vi(db, user, authz, MODULE)
    return danh_sach.don_loc(db, sale_ids=sale_ids)


@router.get("/phu-trach-loc", response_model=list[LuaChonLoc])
def phu_trach_loc(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
):
    """Ô "Phụ trách" của thanh lọc — chủ đơn của các lệnh trong phạm vi, kèm số lệnh."""
    sale_ids = pham_vi.sale_ids_theo_pham_vi(db, user, authz, MODULE)
    return danh_sach.phu_trach_loc(db, sale_ids=sale_ids)


@router.get("", response_model=LenhSxListOut)
def danh_sach_lenh(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    tab: Tab | None = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    khach_hang_id: int | None = None,
    order_id: int | None = None,
    phu_trach_id: int | None = None,
    gia_cong: Annotated[
        str | None, Query(pattern="^(cho_mang_di|dang_o_ngoai|tron_goi)$")
    ] = None,
    # Dải kỳ (06/10/2026): khoảng ngày tính theo `moc` — ngày tạo lệnh (mặc định) / hạn SX / hạn
    # giao khách. `moc=han_sx` (hạn SX nội bộ đã gỡ 08/11/2026) hiểu như `han_giao`.
    tu_ngay: date | None = None,
    den_ngay: date | None = None,
    moc: Annotated[str, Query(pattern="^(tao|han_sx|han_giao)$")] = "tao",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[
        int, Query(ge=1, le=danh_sach.PAGE_SIZE_TOI_DA)
    ] = danh_sach.PAGE_SIZE_MAC_DINH,
):
    """Bảng lệnh đã phát hành, đã lọc, đếm theo tab và CẮT TRANG ở máy chủ."""
    sale_ids = pham_vi.sale_ids_theo_pham_vi(db, user, authz, MODULE)
    return danh_sach.danh_sach(
        db,
        sale_ids=sale_ids,
        tab=tab,
        q=q,
        khach_hang_id=khach_hang_id,
        tu_ngay=tu_ngay,
        den_ngay=den_ngay,
        moc=moc,
        order_id=order_id,
        phu_trach_id=phu_trach_id,
        gia_cong=gia_cong,
        page=page,
        page_size=page_size,
    )


@router.get("/{lsx_id}", response_model=LenhSxHoSoOut)
def ho_so_lenh(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    lsx_id: int,
):
    """Hồ sơ đầy đủ MỘT lệnh: 13 khối cho màn chi tiết, thuần đọc, không ghi gì.

    Khai SAU `/bo-loc` là bắt buộc (xem docstring đầu file). `lsx_id` chỉ là ĐỊA CHỈ, không phải
    quyền: `sale_ids` vẫn sinh từ token, và `ho_so` sẽ trả 404 nếu lệnh không tồn tại / chưa phát
    hành, 403 nếu lệnh có thật nhưng nằm ngoài phạm vi người gọi — thân lỗi không kèm nội dung
    lệnh, để người ngoài phạm vi không dò được thông tin qua thông báo lỗi.
    """
    sale_ids = pham_vi.sale_ids_theo_pham_vi(db, user, authz, MODULE)
    return ho_so.ho_so(db, lsx_id, sale_ids=sale_ids)


@router.get("/{lsx_id}/ngan", response_model=LenhSxNganOut)
def ngan_lenh(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    lsx_id: int,
):
    """Ngăn hồ sơ gọn của MỘT lệnh (12/10/2026) — cùng cửa 404/403 với `ho_so_lenh`."""
    sale_ids = pham_vi.sale_ids_theo_pham_vi(db, user, authz, MODULE)
    return ho_so.ngan(db, lsx_id, sale_ids=sale_ids)


@router.get(
    "/{lsx_id}/phieu-cong-nghe.pdf",
    response_class=Response,
    # KHAI CHO ĐÚNG SỰ THẬT: không có `response_model` thì OpenAPI mặc định ghi 200 là
    # `application/json` — mọi client sinh từ schema (kể cả Swagger UI) sẽ đọc sai kiểu trả về của
    # một endpoint chỉ trả bytes PDF.
    responses={200: {"content": {"application/pdf": {}}, "description": "Phiếu công nghệ A4"}},
)
def phieu_cong_nghe_pdf(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    lsx_id: int,
):
    """Phiếu công nghệ A4 (Task 13) — bản in cho TỔ SẢN XUẤT, không một số tiền nào.

    ĐÚNG một cửa quyền với `ho_so_lenh` ở trên: `sale_ids` sinh từ token y hệt, và
    `phieu_cong_nghe.render_pdf` gọi thẳng `ho_so.ho_so()` bên trong nên 404/403 nổ ra từ CHÍNH
    phép kiểm đó — router không tự viết lại lượt kiểm quyền thứ hai. Route có thêm một đoạn
    đường dẫn (`/phieu-cong-nghe.pdf`) so với `/{lsx_id}` nên không tranh chấp thứ tự khai với
    đường tĩnh `/bo-loc` phía trên.

    `Content-Disposition` mang MÃ LỆNH: không có nó thì mọi phiếu tải về đều tên
    `phieu-cong-nghe.pdf`, và thư mục Downloads của người điều độ thành `(1)`, `(2)`, `(3)` không
    biết tờ nào của lệnh nào. `inline` chứ không `attachment` — bấm In là muốn XEM trước rồi mới
    in, không phải tải file về.
    """
    sale_ids = pham_vi.sale_ids_theo_pham_vi(db, user, authz, MODULE)
    phieu = phieu_cong_nghe.render_pdf(
        db, lsx_id, sale_ids=sale_ids, nguoi_in=user.name or user.username
    )
    return Response(
        content=phieu.noi_dung,
        media_type="application/pdf",
        # Tên file do SERVICE đặt (nó mới có mã lệnh trong tay): router đọc lại `lsx.ma` là mở
        # đường đọc DB thứ hai cho đúng một chuỗi, và là đường KHÔNG đi qua cửa phạm vi.
        headers={"Content-Disposition": f'inline; filename="{phieu.ten_file}"'},
    )
