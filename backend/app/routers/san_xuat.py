"""Router Thực hiện sản xuất — bàn của TỔ (Giai đoạn 2 mặt đọc + Giai đoạn 1 navbar node lá).

Prefix `/api/san-xuat`. Quyền theo DÒNG QUYỀN THEO TỔ `to_sx_<id phòng ban>` (spec 2026-09-14):
Xem + phạm vi + ba quyền chi tiết (Thực hiện lệnh · Xác nhận sản lượng · Kho). KCS KHÔNG theo tổ:
dòng `kcs` của ma trận vai, kiểm được mọi tổ (cổng ở `services/san_xuat/kcs.py`). Router chỉ
gác THÔ bằng `require_quyen_to(việc)` (có việc đó ở ÍT NHẤT một tổ); cổng theo đúng tổ + mức "Của
tôi" nằm ở service (`quyen_to.gate_to`). Module `san_xuat` giữ cho Kế hoạch SX, không gác Bàn tổ.

Lát này CHỈ ĐỌC:
  · GET /teams        — danh sách tổ sản xuất (node lá) + badge số việc chờ, cho navbar + màn.
  · GET /work-items   — công việc ĐÃ PHÁT HÀNH của MỘT tổ (timeline), chặn nếu ngoài phạm vi.

Phân công / phiên chạy / sản lượng (ghi) là các lát sau, thêm bảng riêng.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import (
    get_authorization_service, get_current_user, require_permission, require_quyen_to,
)
from ..models.user import User
from ..doi_tuong_nhan import MAN_KHO, MAN_THEO_LENH, hop, kem_ban_to
from ..realtime import hub, phat_ban_giao, phat_dong_lenh
from ..services.thong_bao_man import bao, kenh_to
from ..repositories.san_xuat_repo import SanXuatRepository
from ..storage import get_storage, make_key, url_from_key
from ..tai_len import doc_gioi_han
from ..schemas.loc_danh_sach import LuaChonLoc
from ..schemas.san_xuat import (
    DungMayIn,
    DungMaySuaIn,
    DungMayListOut,
    DungMayOut,
    BanGiaoDeXuatIn,
    BanGiaoKetQuaOut,
    BanGiaoSuaIn,
    BanGiaoXacNhanIn,
    BatchIn,
    BatDauIn,
    DoiMayIn,
    DongLenhIn,
    DongLenhKetQuaOut,
    DongLenhTinhTrangOut,
    GoPhanCongIn,
    KcsBaoCaoOut,
    KcsChuoiCongDoanOut,
    KcsCongDoanLocListOut,
    KcsCongViecOut,
    KcsDaXemKetQuaOut,
    KcsGiaTriLocOut,
    KcsKiemKetQuaOut,
    KcsLenhListOut,
    KcsSoDoNhomOut,
    KetThucIn,
    MayDoiOut,
    MayHuIn,
    MayHuOut,
    LenhKetQuaOut,
    HoTroUngVienListOut,
    ChoXacNhanOut,
    NhanVienChonListOut,
    NhapKhoYcKetQuaOut,
    PhanCongIn,
    SanLuongToOut,
    SanLuongKetQuaOut,
    SuCoIn,
    SuCoKetQuaOut,
    TamDungIn,
    TeamsOut,
    SuaSoMeIn,
    ThemLotIn,
    VatTuDeNghiIn,
    VatTuNhapLaiIn,
    TepLenhOut,
    WorkItemChiTietOut,
    LichSuViecOut,
    WorkItemsLocDemOut,
    WorkItemsOut,
)
from ..services.rbac_service import AuthorizationService
from ..services.san_xuat import (
    ban_giao,
    board,
    dong_lenh,
    dung_may,
    kcs,
    kcs_bao_cao,
    kho,
    lich_su_viec,
    san_luong,
    su_co,
    tep_lenh,
    thuc_thi,
    vat_tu_de_nghi,
    vat_tu_nhap_lai,
    viec_khoan,
)
from ..services.san_xuat import san_luong_to as san_luong_to_svc
from ..services.san_xuat.vat_tu_de_nghi import VatTuDeNghiError
from ..services.san_xuat.vat_tu_nhap_lai import VatTuNhapLaiError
from ..services.stock_request_service import StockRequestError

router = APIRouter(prefix="/api/san-xuat", tags=["san-xuat"])
MODULE = "san_xuat"
Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]

# Ảnh bằng chứng lỗi KCS — subdir khai kèm ở `routers/files.py::_PREFIX_PERMISSION["san-xuat"]` để
# chỉ người có quyền đọc module này mới xem được. Giới hạn 15MB như ky_thuat_may.
SUBDIR = "san-xuat"
_MAX_ANH_BYTES = 15 * 1024 * 1024
# Trần số ảnh MỘT lượt kiểm — 10 ảnh × 15MB đã là 150MB một request; không có trần thì một form
# gửi 100 ảnh là cả trăm MB đi qua RAM máy chủ trong một lượt.
_MAX_ANH_MOT_LUOT = 10


def _phat_sse(res: dict) -> None:
    """SSE SAU commit (§18): báo bàn tổ đổi + đẩy thông báo tới người vừa được giao (nếu có tài khoản).

    Người nhận: bàn của ĐÚNG tổ giữ việc (số tổ khác nhận được đi qua bàn giao — tin riêng mang cả
    hai tổ) + màn theo lệnh nghe nhóm `san_xuat` (Kế hoạch SX, Hồ sơ lệnh, Theo dõi SX, KCS…)."""
    hub.gui({
        "type": "san_xuat_cong_viec_changed",
        "team_id": res.get("department_id"),
        "cong_viec_id": res.get("cong_viec_id"),
        "trang_thai": res.get("trang_thai"),
    }, **kem_ban_to(MAN_THEO_LENH, [res.get("department_id")]))
    uid = res.get("notify_user_id")
    if uid:
        hub.publish(uid, {"type": "san_xuat_duoc_giao_viec",
                          "cong_viec_id": res.get("cong_viec_id")})



def _cham_to(db: Session, to_id: int | None, loai: str, actor_id: int) -> None:
    """Chấm đỏ trên mục bàn của tổ `to_id` (kênh `to_sx_<id>`)."""
    if to_id:
        bao(db, kenh=kenh_to(to_id), loai=loai, actor_id=actor_id)


def _cham_kcs(db: Session, res: dict, actor_id: int) -> None:
    """KCS bắt lỗi quy về tổ (tổ công đoạn vừa kiểm, hoặc tổ công đoạn TRƯỚC) ⇒ chấm bàn tổ đó."""
    to_loi = {m.get("department_id") for m in res.get("bao_loi_nguon") or []}
    if (res.get("so_loi_cua_to", res.get("so_loi")) or 0) > 0:
        to_loi.add(res.get("department_id"))
    for to in sorted(t for t in to_loi if t):
        _cham_to(db, to, "kcs_bao_loi", actor_id)


def _phat_sse_kcs(res: dict) -> None:
    """KCS đổi → refresh màn KCS + bàn tổ của công đoạn; kiểm có kết quả thì ĐẨY tới người Xác nhận
    sản lượng trọn tổ đó (§18) — kết quả kiểm là tương tác GIỮA KCS và tổ nên phải tới NGAY.

    Tin "đã đổi" tới bàn + badge của ĐÚNG tổ công đoạn và màn theo lệnh (gồm màn KCS)."""
    hub.gui({
        "type": "san_xuat_kcs_changed",
        "cong_viec_id": res.get("cong_viec_id"),
        "kcs_batch_id": res.get("kcs_batch_id"),
        "loi_id": res.get("loi_id"),
        "team_id": res.get("department_id"),
        "lsx_id": res.get("lsx_id"),
    }, **kem_ban_to(MAN_THEO_LENH, [res.get("department_id")]))
    for uid in res.get("notify_user_ids") or []:
        if uid:
            hub.publish(uid, {
                "type": "san_xuat_kcs_ket_qua",
                "team_id": res.get("department_id"),
                "cong_viec_id": res.get("cong_viec_id"),
                "loi_id": res.get("loi_id"),
                "lsx_ma": res.get("lsx_ma"),
                "ten_cong_doan": res.get("ten_cong_doan"),
                # Công đoạn giữa chỉ ghi lỗi (không có "đạt") — toast nói "ghi lỗi", không nói "đạt 0".
                "la_kcs_cuoi": res.get("la_kcs_cuoi"),
                "don_vi": res.get("don_vi"),
                "so_dat": res.get("so_dat"),
                "so_loi": res.get("so_loi_cua_to", res.get("so_loi")),
                "nguoi_kiem": res.get("nguoi_kiem"),
            })
    # Lỗi KCS quy về công đoạn TRƯỚC (bắt ở bước sau) — tổ đó cũng phải biết NGAY.
    for m in res.get("bao_loi_nguon") or []:
        hub.gui({
            "type": "san_xuat_kcs_changed",
            "cong_viec_id": m.get("cong_viec_id"),
            "kcs_batch_id": res.get("kcs_batch_id"),
            "loi_id": m.get("loi_id"),
            "team_id": m.get("department_id"),
            "lsx_id": res.get("lsx_id"),
        }, **kem_ban_to(MAN_THEO_LENH, [m.get("department_id")]))
        for uid in m.get("notify_user_ids") or []:
            if uid:
                hub.publish(uid, {
                    "type": "san_xuat_kcs_ket_qua",
                    "team_id": m.get("department_id"),
                    "cong_viec_id": m.get("cong_viec_id"),
                    "loi_id": m.get("loi_id"),
                    "lsx_ma": res.get("lsx_ma"),
                    "ten_cong_doan": m.get("ten_cong_doan"),
                    "phat_hien_o": res.get("ten_cong_doan"),
                    "so_loi": m.get("so_loi"),
                    "don_vi": res.get("don_vi"),
                    "nguoi_kiem": res.get("nguoi_kiem"),
                })


def _luu_anh_kcs(owner_id: int, files: list[UploadFile]) -> tuple[list[dict], list[str]]:
    """Lưu ảnh bằng chứng lỗi KCS vào storage, trả (mô-tả-ảnh, keys). Kiểm rỗng/kích-thước/loại-ảnh
    như ky_thuat_may. Nếu bất kỳ file nào lỗi → xoá hết key đã ghi rồi ném (đừng để rác mồ côi)."""
    if len(files) > _MAX_ANH_MOT_LUOT:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Mỗi lượt kiểm gửi tối đa {_MAX_ANH_MOT_LUOT} ảnh.",
        )
    anh: list[dict] = []
    keys: list[str] = []
    try:
        for f in files:
            data = doc_gioi_han(
                f, _MAX_ANH_BYTES, ten="Ảnh",
                ma_rong=status.HTTP_400_BAD_REQUEST, loi_rong="Tệp rỗng.",
            )
            if not (f.content_type or "").lower().startswith("image/"):
                raise HTTPException(
                    status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                    f"Chỉ nhận tệp ảnh (JPG, PNG, HEIC…) — tệp này là "
                    f"{f.content_type or 'không rõ loại'}.",
                )
            key, safe = make_key(f"{SUBDIR}/kcs-loi", owner_id, f.filename)
            get_storage().save(key, data, f.content_type)
            keys.append(key)
            anh.append({"file_name": safe, "file_url": url_from_key(key),
                        "file_type": f.content_type})
        return anh, keys
    except HTTPException:
        for k in keys:
            get_storage().delete(k)
        raise


def _don_anh(keys: list[str]) -> None:
    for k in keys:
        get_storage().delete(k)


@router.get("/teams", response_model=TeamsOut)
def teams(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_quyen_to("read"))],
) -> TeamsOut:
    """Tổ sản xuất user được thấy + badge số việc chưa xong (navbar §2.1, màn bàn tổ §11)."""
    return TeamsOut(teams=board.teams(db, user, authz))


@router.get("/teams/{team_id}/nhan-vien", response_model=NhanVienChonListOut)
def nhan_vien_cua_to(
    team_id: int,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_quyen_to("read"))],
) -> NhanVienChonListOut:
    """Danh nhân viên chọn được để giao vào việc của tổ (ô "Giao người" §7.1). 403 nếu ngoài phạm vi.

    Gác bằng Xem của dòng tổ (KHÔNG mượn `nhan_su`): người điều hành tổ đổ được danh chọn mà không
    cần quyền nhân sự. Ghi thật vẫn do `phan-cong` gác quyền Thực hiện lệnh đúng tổ ở service.
    """
    try:
        return NhanVienChonListOut.model_validate(
            board.nhan_vien_chon(db, user, authz, team_id=team_id)
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


# --- Báo dừng máy (Đợt 2, 21/10/2026) — ngày dừng máy tổ ăn chỉ tiêu ngày ----------------------
# Người chỉ có ô Báo hỏng của Sửa chữa máy vẫn mở hộp và gửi máy hư được (chủ 23/10/2026); ĐÚNG tổ
# nào, phần lương hay không — service tự kiểm (`dung_may._quyen`).
BAO_HONG = ("ky_thuat_may", "request")
@router.get("/teams/{department_id}/dung-may", response_model=DungMayListOut)
def dung_may_ds(
    department_id: int,
    nam: int,
    thang: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("confirm_output", BAO_HONG))],
) -> dict:
    """Ngày đã báo trong tháng + người của tổ + phiếu sửa máy báo trong tháng (hộp Báo dừng máy)."""
    return _chay(lambda: dung_may.danh_sach(db, user=user, department_id=department_id,
                                            year=nam, month=thang))


@router.post("/teams/{department_id}/dung-may", response_model=DungMayOut)
def bao_dung_may(
    department_id: int,
    body: DungMayIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("confirm_output"))],
) -> dict:
    """Tổ trưởng báo một ngày máy hư / hết hàng. Một tổ một ngày một lần."""
    return _chay(lambda: dung_may.bao(db, user=user, department_id=department_id, ngay=body.ngay,
                                      ly_do=body.ly_do, sua_chua_id=body.sua_chua_id,
                                      ghi_chu=body.ghi_chu, nguoi_ids=body.nguoi_ids))


@router.post("/teams/{department_id}/may-hu", response_model=MayHuOut)
def bao_may_hu(
    department_id: int,
    body: MayHuIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("confirm_output", BAO_HONG))],
) -> dict:
    """Máy hư hôm nay (23/10/2026, gộp Báo sự cố): báo tổ sửa chữa, tuỳ chọn tạm dừng việc trên máy,
    tuỳ chọn ghi ngày dừng cho lương — một giao dịch. Service tự bắn SSE sau commit."""
    return _chay(lambda: dung_may.bao_may_hu(
        db, user=user, department_id=department_id, may_id=body.may_id, muc_do=body.muc_do,
        mo_ta=body.mo_ta, dung_san_xuat=body.dung_san_xuat, tinh_luong=body.tinh_luong,
        ghi_chu=body.ghi_chu, nguoi_ids=body.nguoi_ids))


@router.put("/dung-may/{dung_may_id}", response_model=DungMayOut)
def sua_dung_may(
    dung_may_id: int,
    body: DungMaySuaIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("confirm_output"))],
) -> dict:
    """Sửa ngày đã báo (người hưởng, lý do, phiếu sửa, ghi chú) — cùng quyền với báo."""
    try:
        return _chay(lambda: dung_may.sua(db, user=user, dung_may_id=dung_may_id, ly_do=body.ly_do,
                                          sua_chua_id=body.sua_chua_id, ghi_chu=body.ghi_chu,
                                          nguoi_ids=body.nguoi_ids))
    except dung_may.KhongThayDungMay as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.delete("/dung-may/{dung_may_id}", status_code=status.HTTP_204_NO_CONTENT,
               response_class=Response)
def xoa_dung_may(
    dung_may_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("confirm_output"))],
) -> Response:
    try:
        _chay(lambda: dung_may.xoa(db, user=user, dung_may_id=dung_may_id))
    except dung_may.KhongThayDungMay as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/teams/{team_id}/ho-tro-ung-vien", response_model=HoTroUngVienListOut)
def ho_tro_ung_vien_cua_to(
    team_id: int,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_quyen_to("read"))],
) -> HoTroUngVienListOut:
    """Người TỔ KHÁC thêm được vào lần ghi sản lượng của tổ (10/10/2026: không còn thỏa thuận hỗ
    trợ hai bên xác nhận — tổ ghi thêm thẳng). Thợ ở các tổ SX khác. 403 nếu tổ ngoài phạm vi.

    Cùng gác Xem như ô "Giao người". Ghi thật do route ghi sản lượng gác quyền ở service.
    """
    try:
        return HoTroUngVienListOut.model_validate(
            board.ho_tro_ung_vien(db, user, authz, team_id=team_id)
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.get("/work-items", response_model=WorkItemsOut)
def work_items(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_quyen_to("read"))],
    team_id: int = Query(..., ge=1),
    nhom: Literal["lenh", "phang"] = Query("lenh"),
    tim: str | None = Query(None, max_length=200),
    trang: int = Query(1, ge=1),
    co_trang: int = Query(20, ge=1, le=100),
    tu_ngay: date | None = Query(None),
    den_ngay: date | None = Query(None),
    cho_xac_nhan: bool = Query(False),
    trang_thai: list[Literal["released", "running", "paused", "completed"]] | None = Query(None),
    moc: Literal["nhan", "tao", "du_kien"] = Query("nhan"),
    sap_xep: Literal["moi_nhan", "cu_nhan", "du_kien"] = Query("moi_nhan"),
    cho_loai: list[Literal["ban_giao", "kcs"]] | None = Query(None),
    toi: Literal["toi", "con_1", "con_2_3", "con_4", "qua"] | None = Query(None),
    vuong: list[Literal["chua_giao_tho", "chua_nhan_khuon", "chua_nhan_buoc_truoc", "chua_san_sang_vat_tu"]]
    | None = Query(None),
    may: list[int] | None = Query(None),
    khach: list[int] | None = Query(None),
    nguoi: list[int] | None = Query(None),
    gap: Literal["gap", "thuong"] | None = Query(None),
) -> WorkItemsOut:
    """Việc đã phát hành của MỘT tổ (§18 /work-items).

    `nhom="lenh"` (mặc định) trả ĐẦU MỤC LỆNH SX / BÀI GHÉP, mỗi lệnh bọc các công đoạn của tổ —
    đơn vị việc vẫn là CÔNG ĐOẠN, lệnh chỉ là tầng nhãn để tổ trưởng biết công đoạn này của lệnh
    nào. Cắt trang Ở MÁY CHỦ và đếm trang bằng LỆNH nên một lệnh không bao giờ bị xé đôi;
    `co_trang` chặn trần ngay tại đây (`le=100`) chứ không bóp im lặng trong service.

    `tim` là ô tìm kiếm của bàn — lọc Ở SQL trước khi cắt trang, chứ không lọc bằng JS sau khi
    trang đã về (lọc sau thì ô tìm kiếm chỉ soi được đúng 20 lệnh đang hiện).

    `nhom="phang"` giữ nguyên mảng bước phẳng cho Gantt, thêm cửa sổ `tu_ngay`/`den_ngay`.

    `cho_xac_nhan=true` (ô "chờ xác nhận" của bàn): chỉ lệnh có công đoạn đang chờ tổ bấm.

    Lọc nâng cao (view Bảng): `trang_thai` (lặp tham số), kỳ `tu_ngay`/`den_ngay` (ngày xưởng,
    gồm cả hai đầu) theo mốc `moc` — `nhan` lúc tổ nhận lệnh (mặc định), `tao` ngày tạo lệnh,
    `du_kien` dự kiến bắt đầu; `sap_xep` (mặc định `moi_nhan`: lệnh phát hành sau nằm trên).

    403 nếu tổ ngoài phạm vi quyền."""
    try:
        return WorkItemsOut.model_validate(
            board.work_items(db, user, authz, team_id=team_id, nhom=nhom, tim=tim,
                             trang=trang, co_trang=co_trang, tu_ngay=tu_ngay, den_ngay=den_ngay,
                             cho_xac_nhan=cho_xac_nhan, trang_thai=set(trang_thai or ()) or None,
                             moc=moc, sap_xep=sap_xep, cho_loai=set(cho_loai or ()) or None,
                             toi=toi, vuong=set(vuong or ()) or None,
                             may={m for m in (may or ()) if m > 0} or None,
                             khach={k for k in (khach or ()) if k > 0} or None,
                             nguoi={n for n in (nguoi or ()) if n > 0} or None, gap=gap)
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.get("/work-items/loc-dem", response_model=WorkItemsLocDemOut)
def work_items_loc_dem(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_quyen_to("read"))],
    team_id: int = Query(..., ge=1),
    tim: str | None = Query(None, max_length=200),
    tu_ngay: date | None = Query(None),
    den_ngay: date | None = Query(None),
    moc: Literal["nhan", "tao", "du_kien"] = Query("nhan"),
) -> WorkItemsLocDemOut:
    """Số đếm cho menu Lọc của bàn tổ (09/10/2026) — theo công việc, sau ô tìm + kỳ, trước các
    điều kiện khác. Đặt TRƯỚC `/work-items/{cong_viec_id}`. 403 nếu tổ ngoài phạm vi quyền."""
    try:
        return WorkItemsLocDemOut.model_validate(
            board.loc_dem(db, user, authz, team_id=team_id, tim=tim, tu_ngay=tu_ngay,
                          den_ngay=den_ngay, moc=moc)
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.get("/san-luong", response_model=SanLuongToOut)
def san_luong_to(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("read"))],
    team_id: int = Query(...),
    tu: date | None = Query(None),
    den: date | None = Query(None),
    to_id: int | None = Query(None),
    tim: str | None = Query(None, max_length=100),
    trang: int = Query(1, ge=1),
    co_trang: int = Query(20, ge=1, le=100),
    cong_doan: list[str] = Query([]),
    nguoi: list[int] = Query([]),
    phat_sinh: str | None = Query(None, max_length=10),
    loai: str | None = Query(None, max_length=10),
    gap: str | None = Query(None, max_length=10),
) -> SanLuongToOut:
    """Tab Sản lượng của bàn tổ: lệnh → công đoạn → người, lọc theo ngày bắt đầu mẻ (giờ xưởng),
    đơn vị trong vùng và mã/tên lệnh. Phạm vi theo dòng quyền tổ; 403 nếu tổ ngoài phạm vi xem."""
    try:
        return SanLuongToOut.model_validate(san_luong_to_svc.san_luong(
            db, user, team_id=team_id, tu=tu, den=den, to_id=to_id, tim=tim,
            trang=trang, co_trang=co_trang, cong_doan=cong_doan, nguoi=nguoi,
            phat_sinh=phat_sinh, loai=loai, gap=gap,
        ))
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("/work-items/{cong_viec_id}", response_model=WorkItemChiTietOut)
def work_item_detail(
    cong_viec_id: int,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_quyen_to("read"))],
) -> WorkItemChiTietOut:
    """Drawer một công việc (§5.1): thanh kế hoạch + roster + phiên chạy + khoảng tham gia."""
    try:
        return WorkItemChiTietOut.model_validate(
            board.chi_tiet_cong_viec(db, user, authz, cong_viec_id=cong_viec_id)
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/work-items/{cong_viec_id}/lich-su", response_model=LichSuViecOut)
def work_item_lich_su(
    cong_viec_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("read"))],
) -> LichSuViecOut:
    """Tab Lịch sử của ngăn công việc: mọi việc đã xảy ra với công việc, mới nhất trên cùng."""
    try:
        return LichSuViecOut.model_validate(lich_su_viec.lich_su(db, user, cong_viec_id=cong_viec_id))
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/work-items/{cong_viec_id}/tep-lenh", response_model=TepLenhOut)
def work_item_tep_lenh(
    cong_viec_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("read"))],
) -> TepLenhOut:
    """Tệp Kế hoạch SX đính kèm vào lệnh của công việc — tổ xem/tải sau khi phát hành, không sửa."""
    try:
        return TepLenhOut(nhom=tep_lenh.tep_cua_cong_viec(db, user, cong_viec_id=cong_viec_id))
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


# --- Mặt GHI (§7.1–§7.2) --------------------------------------------------------------------
# Gác THÔ bằng `require_quyen_to(việc)`; ranh giới an ninh THỰC là `_gate` → `quyen_to.gate_to` ở
# service (đúng tổ của công việc, mức "Của tôi" chỉ qua khi việc đang giao cho mình).
def _chay(fn):
    """Chạy lệnh ghi, dịch lỗi nghiệp vụ: quyền → 403, ràng buộc → 400."""
    try:
        return fn()
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/work-items/{cong_viec_id}/phan-cong", response_model=LenhKetQuaOut)
def phan_cong(
    cong_viec_id: int,
    body: PhanCongIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("run_order"))],
) -> dict:
    """Giao MỘT người vào công việc (§7.1). Lần giao đầu = tổ tiếp nhận (§5.2)."""
    res = _chay(lambda: thuc_thi.phan_cong(
        db, user=user, cong_viec_id=cong_viec_id,
        employee_id=body.employee_id, expected_version=body.expected_version,
    ))
    _phat_sse(res)
    return res


@router.post("/phan-cong/{phan_cong_id}/rut", response_model=LenhKetQuaOut)
def go_phan_cong(
    phan_cong_id: int,
    body: GoPhanCongIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("run_order"))],
) -> dict:
    """Rút một người khỏi công việc (§7.2), đóng khoảng tham gia đang mở của họ."""
    res = _chay(lambda: thuc_thi.go_phan_cong(
        db, user=user, phan_cong_id=phan_cong_id,
        ly_do=body.ly_do, expected_version=body.expected_version,
    ))
    _phat_sse(res)
    return res


@router.post("/work-items/{cong_viec_id}/material-requests",
             status_code=status.HTTP_201_CREATED, response_model=None)
def tao_de_nghi_vat_tu(
    cong_viec_id: int,
    body: VatTuDeNghiIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("warehouse"))],
) -> dict:
    """Tổ đề nghị cấp vật tư cho công đoạn (spec-de-nghi-cap-vat-tu-cong-doan §6).

    Quyền Kho ở router chỉ là cổng THÔ — ranh giới thật (Kho ở đúng tổ của công việc) nằm trong
    service, giống hệt `phan-cong`. KHÔNG đòi `kho:request`: kho không duyệt yêu cầu này.
    """
    try:
        return vat_tu_de_nghi.tao(
            db, user=user, cong_viec_id=cong_viec_id, can_luc=body.can_luc,
            lines=[l.model_dump() for l in body.lines], ghi_chu=body.ghi_chu,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except (VatTuDeNghiError, StockRequestError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post("/work-items/{cong_viec_id}/material-returns",
             status_code=status.HTTP_201_CREATED, response_model=None)
def tao_nhap_lai_vat_tu(
    cong_viec_id: int,
    body: VatTuNhapLaiIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("warehouse"))],
) -> dict:
    """Tổ yêu cầu NHẬP LẠI vật tư thừa vào kho (spec 2026-10-01 §3.5). Cùng cổng quyền Kho theo tổ
    với đề nghị cấp; kho lập phiếu nhập như mọi yêu cầu NHẬP."""
    try:
        return vat_tu_nhap_lai.tao(
            db, user=user, cong_viec_id=cong_viec_id, ghi_chu=body.ghi_chu,
            can_luc=body.can_luc, lines=[l.model_dump() for l in body.lines],
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except VatTuNhapLaiError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.put("/work-items/{cong_viec_id}/material-requests/{de_nghi_id}", response_model=None)
def sua_de_nghi_vat_tu(
    cong_viec_id: int,
    de_nghi_id: int,
    body: VatTuDeNghiIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("warehouse"))],
) -> dict:
    """`de_nghi_id` là id ĐỀ NGHỊ SẢN XUẤT, không phải id yêu cầu kho — đừng nhầm hai không gian id."""
    try:
        return vat_tu_de_nghi.sua(
            db, user=user, cong_viec_id=cong_viec_id, de_nghi_id=de_nghi_id,
            can_luc=body.can_luc, lines=[l.model_dump() for l in body.lines],
            ghi_chu=body.ghi_chu,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except (VatTuDeNghiError, StockRequestError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post("/work-items/{cong_viec_id}/bat-dau", response_model=LenhKetQuaOut)
def bat_dau(
    cong_viec_id: int,
    body: BatDauIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("run_order"))],
) -> dict:
    """Bắt đầu / tiếp tục chạy (§7.2): mở phiên mới + khoảng tham gia cho cả tổ."""
    res = _chay(lambda: thuc_thi.bat_dau(
        db, user=user, cong_viec_id=cong_viec_id,
        expected_version=body.expected_version,
    ))
    _phat_sse(res)
    return res


@router.post("/work-items/{cong_viec_id}/nhan-khuon", response_model=LenhKetQuaOut)
def nhan_khuon(
    cong_viec_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("run_order"))],
) -> dict:
    """Tổ xác nhận đã cầm con dao trong tay (chốt 04/09/2026) — thứ DUY NHẤT mở cổng Bắt đầu cho
    bước cần dụng cụ. Cùng cửa quyền với Bắt đầu: nói "dao đã ở đây" là quyết định điều hành."""
    res = _chay(lambda: thuc_thi.nhan_khuon(db, user=user, cong_viec_id=cong_viec_id))
    _phat_sse(res)
    return res


@router.post("/work-items/{cong_viec_id}/tra-khuon", response_model=LenhKetQuaOut)
def tra_khuon(
    cong_viec_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("run_order"))],
) -> dict:
    """Trả dao về kệ — KHÔNG chặn gì, chỉ để hệ thống khỏi mất dấu con dao sau khi nó rời kệ."""
    res = _chay(lambda: thuc_thi.tra_khuon(db, user=user, cong_viec_id=cong_viec_id))
    _phat_sse(res)
    return res


@router.post("/work-items/{cong_viec_id}/doi-may", response_model=LenhKetQuaOut)
def doi_may(
    cong_viec_id: int,
    body: DoiMayIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("run_order"))],
) -> dict:
    """Đổi máy giữa chừng (§7.2 mở rộng 31/08/2026). CÙNG cửa quyền với Bắt đầu
    (quyền Thực hiện lệnh ở CHÍNH tổ, siết ở `_gate`) — đổi máy là quyết định điều
    hành, không phải ghi nhận. Dùng `_chay` (như mọi route ghi khác ở đây) để `_gate` ném
    `PermissionError` cũng dịch ra 403 — không thì lệch đường dây so với `bat-dau`."""
    res = _chay(lambda: thuc_thi.doi_may(
        db, user=user, cong_viec_id=cong_viec_id,
        may_id_moi=body.may_id, ly_do=body.ly_do,
        expected_version=body.expected_version,
    ))
    _phat_sse(res)
    return res


@router.get("/work-items/{cong_viec_id}/may-doi", response_model=MayDoiOut)
def may_doi(
    cong_viec_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("run_order"))],
) -> dict:
    """Ô "Đổi máy": máy làm được công đoạn của việc + tình trạng lúc này. CÙNG cửa quyền với
    `doi-may` — ai không đổi được máy thì cũng không cần danh sách này."""
    return _chay(lambda: thuc_thi.may_doi_duoc(db, user=user, cong_viec_id=cong_viec_id))


@router.post("/work-items/{cong_viec_id}/tam-dung", response_model=LenhKetQuaOut)
def tam_dung(
    cong_viec_id: int,
    body: TamDungIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("run_order"))],
) -> dict:
    """Tạm dừng (§7.2): đóng phiên + khoảng tham gia. Bắt buộc lý do."""
    res = _chay(lambda: thuc_thi.tam_dung(
        db, user=user, cong_viec_id=cong_viec_id,
        ly_do=body.ly_do, expected_version=body.expected_version,
    ))
    _phat_sse(res)
    return res


@router.post("/work-items/{cong_viec_id}/su-co", response_model=SuCoKetQuaOut)
def bao_su_co(
    cong_viec_id: int,
    body: SuCoIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("run_order"))],
) -> dict:
    """Báo sự cố máy ngay tại tổ (31/08/2026) → ghi vào hộp thư "Báo máy hỏng" của tổ sửa chữa.

    CÙNG cửa quyền với `tam-dung` (Thực hiện lệnh ở CHÍNH tổ, siết ở `_gate`): nhánh
    "Dừng sản xuất" chính là một cú tạm dừng, không thể dễ hơn.

    KHÔNG gọi `_phat_sse` ở đây — khác mọi route ghi bên trên: đường này phải đẩy HAI tin (bàn tổ
    + hàng chờ tổ sửa chữa) và cả hai chỉ hợp lệ SAU khi giao dịch chốt, nên `su_co.bao_su_co` tự
    bắn ngay sau `commit` của chính nó. Gọi thêm `_phat_sse` ở đây là bắn trùng tin bàn tổ.
    """
    return _chay(lambda: su_co.bao_su_co(
        db, user=user, cong_viec_id=cong_viec_id,
        mo_ta=body.mo_ta, muc_do=body.muc_do,
        dung_san_xuat=body.dung_san_xuat, expected_version=body.expected_version,
    ))


@router.post("/work-items/{cong_viec_id}/ket-thuc", response_model=LenhKetQuaOut)
def ket_thuc(
    cong_viec_id: int,
    body: KetThucIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("run_order"))],
) -> dict:
    """Kết thúc (§7.2): đóng phiên + khoảng tham gia, đánh dấu hoàn thành."""
    res = _chay(lambda: thuc_thi.ket_thuc(
        db, user=user, cong_viec_id=cong_viec_id,
        expected_version=body.expected_version,
    ))
    _phat_sse(res)
    return res


# --- Sản lượng (§11.1) + lot đầu vào (§10.3) -------------------------------------------------
@router.post("/work-items/{cong_viec_id}/outputs", response_model=SanLuongKetQuaOut)
def tao_batch(
    cong_viec_id: int,
    body: BatchIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("run_order"))],
) -> dict:
    """Ghi một mẻ sản lượng + lot đầu vào (§11.1) + việc khoán & việc phát sinh (§7.1).

    Ràng buộc tổng = tốt + hỏng. Cấu hình Khoán tự lấy từ công đoạn; việc phát sinh KHÔNG cộng
    vào sản lượng nên không đụng gì tới ba con số trên."""
    res = _chay(lambda: san_luong.tao_batch(
        db, user=user, cong_viec_id=cong_viec_id,
        bat_dau=body.bat_dau, ket_thuc=body.ket_thuc,
        tong=body.tong, tot=body.tot, hong=body.hong, don_vi=body.don_vi,
        mo_ta_loi=body.mo_ta_loi, ghi_chu=body.ghi_chu,
        lot_vao=[lot.model_dump() for lot in body.lot_vao],
        phat_sinh=[ps.model_dump() for ps in body.phat_sinh],
        nguoi_ids=body.nguoi_ids, tuy_chon=body.tuy_chon, mat_in=body.mat_in,
    ))
    _phat_sse(res)
    # Ghi xong tự đề xuất giao sang chặng sau — báo bên nhận như bấm Đề xuất giao.
    bg = res.get("ban_giao")
    if bg:
        phat_ban_giao(bg)
        _cham_to(db, bg.get("dich_department_id"), "ban_giao_den", user.id)
    return res


@router.post("/outputs/{batch_id}/cap-nhat-danh-muc", response_model=SanLuongKetQuaOut)
def cap_nhat_danh_muc_me(
    batch_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("run_order"))],
) -> dict:
    """Bấm "Cập nhật theo danh mục" trên băng của mẻ (§7.2b): ảnh chụp lấy số MỚI.

    Không có cửa ngược lại ("Giữ số cũ" là KHÔNG bấm gì) — hệ chưa bao giờ tự đổi số dưới chân mẻ
    đã ghi, nên không cần lệnh để giữ."""
    res = _chay(lambda: viec_khoan.cap_nhat_theo_danh_muc(db, user=user, batch_id=batch_id))
    _phat_sse(res)
    return res


@router.post("/outputs/{batch_id}/sua-so", response_model=SanLuongKetQuaOut)
def sua_so_me(
    batch_id: int,
    body: SuaSoMeIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("confirm_output"))],
) -> dict:
    """Sửa số làm được của một mẻ (10/10/2026, thay điều chỉnh bàn giao). Mẻ đã giao thì lần giao
    đổi theo; khác tổ thì bên nhận xác nhận lại."""
    res = _chay(lambda: san_luong.sua_so_me(
        db, user=user, batch_id=batch_id, tot=body.tot, ly_do=body.ly_do,
        expected_version=body.expected_version, nguoi_ids=body.nguoi_ids, tuy_chon=body.tuy_chon,
    ))
    _phat_sse(res)
    bg = res.get("ban_giao")
    if bg:
        phat_ban_giao(bg)
        if bg.get("notify_user_ids"):
            _cham_to(db, bg.get("dich_department_id"), "ban_giao_den", user.id)
    return res


@router.post("/outputs/{batch_id}/inputs", response_model=SanLuongKetQuaOut)
def them_lot(
    batch_id: int,
    body: ThemLotIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("run_order"))],
) -> dict:
    """Bổ sung một lot đầu vào cho batch đã tạo (§10.3 truy vết mẻ công đoạn trước)."""
    res = _chay(lambda: san_luong.them_lot(
        db, user=user, batch_id=batch_id,
        nguon_batch_id=body.nguon_batch_id, so_luong=body.so_luong, don_vi=body.don_vi,
    ))
    _phat_sse(res)
    return res


# --- Bàn giao công đoạn (§11.2–§11.3) --------------------------------------------------------
@router.post("/work-items/{cong_viec_id}/handovers", response_model=BanGiaoKetQuaOut)
def de_xuat_ban_giao(
    cong_viec_id: int,
    body: BanGiaoDeXuatIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("confirm_output"))],
) -> dict:
    """Bên NGUỒN đề xuất giao sản lượng tốt sang công đoạn sau (§11.2). Cùng tổ+LSX ⇒ xác nhận luôn."""
    res = _chay(lambda: ban_giao.de_xuat(
        db, user=user, nguon_cong_viec_id=cong_viec_id,
        dich_cong_viec_id=body.dich_cong_viec_id, don_vi=body.don_vi, batch_ids=body.batch_ids,
    ))
    phat_ban_giao(res)
    _cham_to(db, res.get("dich_department_id"), "ban_giao_den", user.id)
    return res


@router.post("/handovers/{ban_giao_id}/sua", response_model=BanGiaoKetQuaOut)
def sua_ban_giao(
    ban_giao_id: int,
    body: BanGiaoSuaIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("confirm_output"))],
) -> dict:
    """Bên NGUỒN sửa lại mẻ đi theo lần giao khi còn chờ xác nhận (§11.2); số lượng tính lại."""
    res = _chay(lambda: ban_giao.sua_de_xuat(
        db, user=user, ban_giao_id=ban_giao_id,
        batch_ids=body.batch_ids, expected_version=body.expected_version,
    ))
    phat_ban_giao(res)
    _cham_to(db, res.get("dich_department_id"), "ban_giao_den", user.id)
    return res


@router.post("/handovers/{ban_giao_id}/xac-nhan", response_model=BanGiaoKetQuaOut)
def xac_nhan_ban_giao(
    ban_giao_id: int,
    body: BanGiaoXacNhanIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("confirm_output"))],
) -> dict:
    """Bên ĐÍCH xác nhận đúng con số cuối (§11.2)."""
    res = _chay(lambda: ban_giao.xac_nhan(
        db, user=user, ban_giao_id=ban_giao_id, expected_version=body.expected_version,
    ))
    phat_ban_giao(res)
    return res


@router.get("/teams/{team_id}/cho-xac-nhan", response_model=ChoXacNhanOut)
def cho_xac_nhan_cua_to(
    team_id: int,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_quyen_to("read"))],
) -> ChoXacNhanOut:
    """Việc chờ tổ bấm trên bàn `team_id`: bàn giao đến chờ nhận + lỗi KCS chưa xem. Mỗi dòng mang `tren_ban` — bàn vẽ chấm đỏ trên dòng công đoạn hay liệt kê riêng.
    Chỉ tính tổ trong vùng mà user giữ Xác nhận sản lượng trọn tổ. 403 nếu bàn ngoài phạm vi xem."""
    try:
        return ChoXacNhanOut.model_validate(board.cho_xac_nhan(db, user, team_id=team_id))
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

# ⚠️ Ba endpoint HỖ TRỢ CHÉO (`/work-items/{id}/ho-tro` · `/ho-tro/{id}/xac-nhan` · `/huy`) GỠ
#    10/10/2026 (mg 0389): người tổ khác sang giúp được tổ thêm thẳng vào lần ghi sản lượng, không
#    còn thỏa thuận chờ hai tổ xác nhận.

# ⚠️ SÁU endpoint PHÂN BỔ (`/outputs/{id}/phan-bo` · `/phan-bo/{id}/chot` · `/mo-lai` ·
#    `/bu-tru` · `/loai-tru` · `/go-loai-tru`) GỠ 18/09/2026 cùng tầng chia sản lượng (mg
#    `0322`). Sản xuất CHỈ GHI NHẬN số lượng — chia và ra tiền là màn của kế toán lương.

# --- KCS theo LỆNH (mg 0306, docs/design-kcs-theo-lenh.md) -----------------------------------
# Người KCS = vai có dòng `kcs` (Xem / Thao tác / Đóng lệnh thiếu), kiểm được MỌI tổ — cổng nằm ở
# service (`kcs.gate_xem_kcs` / `kcs.gate_kcs`),
# router chỉ đòi đăng nhập. "Đã xem" lỗi gác Xác nhận sản lượng TRỌN tổ bị báo lỗi.
@router.get("/kcs/lenh", response_model=KcsLenhListOut)
def danh_sach_lenh_kcs(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    tim: str | None = Query(None, max_length=200),
    trang: int = Query(1, ge=1),
    # Nút lọc nhanh (09/10/2026) — thay điều kiện "Trạng thái" nhóm của thanh lọc.
    nhanh: str = Query("tat_ca", pattern="^(tat_ca|cho_kiem|chua_gui_kho|cho_dong|da_dong)$"),
    khach_id: int | None = Query(None),
    tu_ngay: date | None = Query(None),
    den_ngay: date | None = Query(None),
    moc: str = Query("tao", pattern="^(tao|kcs)$"),
    co_trang: int = Query(30, ge=1, le=100),
    # Thanh lọc thêm 11/10/2026 — xem `SanXuatKcsRepository.trang_lenh`.
    to_id: int | None = Query(None),
    cong_doan: str | None = Query(None, max_length=200),
    co_loi: str | None = Query(None, pattern="^(co|khong)$"),
    loai: str | None = Query(None, pattern="^(chinh|phu)$"),
    nguoi_kiem_id: int | None = Query(None),
) -> dict:
    """Danh sách lệnh cho màn KCS — lệnh đã vào nhóm thành phẩm. Tìm + lọc + cắt trang ở máy
    chủ, kèm số trên các nút lọc nhanh."""
    return _chay(lambda: kcs.danh_sach_lenh_kcs(
        db, user, tim=tim, trang=trang, nhanh=nhanh, co_trang=co_trang, khach_id=khach_id,
        tu_ngay=tu_ngay, den_ngay=den_ngay, moc=moc, to_id=to_id, cong_doan=cong_doan,
        co_loi=co_loi, loai=loai, nguoi_kiem_id=nguoi_kiem_id,
    ))


@router.get("/kcs/lenh/khach-loc", response_model=list[LuaChonLoc])
def khach_loc_kcs(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[dict]:
    """Ô "Khách hàng" của thanh lọc màn KCS. Đường TĨNH — phải đứng trước `/kcs/lenh/{lsx_id}`."""
    return _chay(lambda: kcs.khach_loc_kcs(db, user))


@router.get("/kcs/lenh/gia-tri-loc", response_model=KcsGiaTriLocOut)
def gia_tri_loc_kcs(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Ô Tổ gây lỗi / Công đoạn gây lỗi / Người kiểm của thanh lọc màn KCS. Đường TĨNH."""
    return _chay(lambda: kcs.gia_tri_loc_kcs(db, user))


@router.get("/kcs/lenh/{lsx_id}", response_model=KcsChuoiCongDoanOut)
def chuoi_cong_doan_kcs(
    lsx_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Chuỗi công đoạn của một lệnh theo thứ tự routing + các lần kiểm đã ghi."""
    try:
        return kcs.chuoi_cong_doan_kcs(db, user, lsx_id)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/kcs/lenh/{lsx_id}/nhom", response_model=KcsSoDoNhomOut)
def so_do_nhom_kcs(
    lsx_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Sơ đồ cả nhóm thành phẩm của lệnh — mỗi lệnh một làn, lệnh phụ trước, lệnh chính cuối."""
    try:
        return kcs.so_do_nhom_kcs(db, user, lsx_id)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/kcs/lenh/{lsx_id}/tep", response_model=TepLenhOut)
def tep_nhom_kcs(
    lsx_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> TepLenhOut:
    """Tệp Kế hoạch SX đính kèm vào các lệnh của nhóm — KCS xem/tải để đối chiếu, không sửa. Gác ô
    Xem của dòng KCS ở service (KCS không giữ quyền tổ nên `/work-items/{id}/tep-lenh` trả 403)."""
    try:
        return TepLenhOut(nhom=tep_lenh.tep_nhom_kcs(db, user, lsx_id=lsx_id))
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/work-items/{cong_viec_id}/kcs", response_model=KcsCongViecOut)
def ket_qua_kcs_cong_viec(
    cong_viec_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Mục "Kết quả KCS" của một công đoạn — người KCS xem mọi công đoạn, người khác theo phạm vi
    Xem của tổ."""
    try:
        return kcs.ket_qua_kcs_cong_viec(db, user, cong_viec_id)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post("/kcs/cong-viec/{cong_viec_id}/kiem", response_model=KcsKiemKetQuaOut,
             status_code=status.HTTP_201_CREATED)
def kiem_cong_doan(
    cong_viec_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    # Bỏ trống = form KCS chỉ gõ số lỗi, máy chủ suy số đạt (`kcs.kiem_cong_doan`).
    so_dat: float | None = Form(default=None),
    so_loi: float = Form(default=0),
    checklist_json: str | None = Form(default=None),
    ghi_chu: str | None = Form(default=None),
    loi_mo_ta: str | None = Form(default=None),
    # Lỗi theo DÒNG: JSON `[{cong_viec_id, so_luong, mo_ta, so_anh, thu_tu}]` — `files` nối theo
    # đúng thứ tự dòng, dòng i lấy `so_anh` tệp kế tiếp. Có trường này thì `loi_mo_ta` bị bỏ qua.
    # `thu_tu` = tiêu chí không đạt của công đoạn chịu (giữa 09/10, bước cuối 11/10/2026), khi đó
    # `mo_ta` là ghi chú.
    loi_json: str | None = Form(default=None),
    lsx_id: int | None = Form(default=None),
    files: list[UploadFile] | None = File(default=None),
) -> dict:
    """Ghi MỘT lần kiểm công đoạn (multipart vì lỗi đi kèm ảnh). Không trừ số, không đổi trạng thái
    công việc. Đẩy SSE tới người Xác nhận sản lượng của tổ bị kiểm và của tổ công đoạn trước bị
    quy lỗi."""
    try:
        checklist = json.loads(checklist_json) if checklist_json else None
        dong_loi = json.loads(loi_json) if loi_json else None
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Kết quả tiêu chí hoặc dòng lỗi không hợp lệ.")
    if dong_loi is not None and (
        not isinstance(dong_loi, list) or not all(isinstance(r, dict) for r in dong_loi)
        or not all(isinstance(r.get("so_anh", 0), int) and r.get("so_anh", 0) >= 0 for r in dong_loi)
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Dòng lỗi không hợp lệ.")
    if dong_loi is not None and sum(int(r.get("so_anh") or 0) for r in dong_loi) != len(files or []):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Số ảnh gửi lên không khớp các dòng lỗi.")
    # Cổng quyền TRƯỚC khi ghi ảnh — người ngoài tổ KCS không được để lại tệp rác trong kho lưu.
    _chay(lambda: kcs.gate_kcs(db, user))
    anh, keys = _luu_anh_kcs(cong_viec_id, files) if files else ([], [])
    cac_loi = None
    if dong_loi is not None:
        cac_loi, i = [], 0
        for r in dong_loi:
            n = int(r.get("so_anh") or 0)
            cac_loi.append({
                "cong_viec_id": r.get("cong_viec_id"), "so_luong": r.get("so_luong"),
                "mo_ta": r.get("mo_ta"), "anh": anh[i:i + n],
                # Công đoạn giữa: tiêu chí tick "không đạt" (bỏ trống = Lỗi khác).
                "thu_tu": r.get("thu_tu"),
            })
            i += n
    try:
        res = kcs.kiem_cong_doan(
            db, user=user, cong_viec_id=cong_viec_id, so_dat=so_dat, so_loi=so_loi,
            checklist_ket_qua=checklist, ghi_chu=ghi_chu, loi_mo_ta=loi_mo_ta, anh=anh,
            cac_loi=cac_loi, lsx_id=lsx_id,
        )
    except PermissionError as exc:
        _don_anh(keys)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ValueError as exc:
        _don_anh(keys)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if res.get("la_gui_lai"):
        # Lượt gửi lại của một lần kiểm đã ghi: ảnh vừa tải là bản sao, không ai trỏ tới.
        _don_anh(keys)
        return res
    _phat_sse_kcs(res)
    _cham_kcs(db, res, user.id)
    return res


@router.post("/kcs/loi/{loi_id}/da-xem", response_model=KcsDaXemKetQuaOut)
def da_xem_loi_kcs(
    loi_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("confirm_output"))],
) -> dict:
    """Tổ bị báo lỗi bấm "Đã xem". Gác Xác nhận sản lượng TRỌN tổ chịu ở service."""
    res = _chay(lambda: kcs.da_xem_loi(db, user=user, loi_id=loi_id))
    _phat_sse_kcs(res)
    return res


_XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx_response(content: bytes, filename: str) -> Response:
    return Response(
        content=content, media_type=_XLSX_MEDIA,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/kcs/cong-doan", response_model=KcsCongDoanLocListOut)
def cong_doan_loc_kcs(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_quyen_to("read", ("kcs", "read")))],
) -> dict:
    """Danh mục công đoạn cho ô lọc dashboard KCS — cùng cổng Xem với `/kcs/bao-cao`, để người chỉ
    giữ quyền tổ không phải có quyền Danh mục công đoạn mới lọc được."""
    return {"items": kcs_bao_cao.cong_doan_loc(db)}


@router.get("/kcs/bao-cao", response_model=KcsBaoCaoOut)
def bao_cao_kcs(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_quyen_to("read", ("kcs", "read")))],
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query("kiem", pattern="^kiem$"),
    lsx_id: int | None = Query(default=None),
    tu_khoa: str | None = Query(default=None, max_length=200),
    cong_doan_id: int | None = Query(default=None),
    khach_id: int | None = Query(default=None),
    cong_doan: str | None = Query(default=None, max_length=200),
    chon_cong_doan: str | None = Query(default=None, max_length=255),
    chon_to: str | None = Query(default=None, max_length=255),
    chon_tieu_chi: str | None = Query(default=None, max_length=255),
    chon_ngay: str | None = Query(default=None, max_length=10),
    trang: int = Query(1, ge=1),
    co_trang: int = Query(25, ge=1, le=200),
) -> dict:
    """Tổng hợp KCS theo filter + scope (§5.7, §6.2 KPI/biểu đồ). Đọc quyền `read` — xem báo cáo
    không cần quyền xuất file. Kỳ theo quy ước chung của thanh lọc (`tu_ngay/den_ngay/moc`); mốc
    duy nhất là `kiem` = ngày kiểm. `chon_*` = bấm-lọc trên tab (công đoạn gây, tổ chịu, tiêu chí,
    khoá mốc trục), `trang`/`co_trang` = trang danh sách "Các lần ghi lỗi"."""
    return kcs_bao_cao.bao_cao_kcs(
        db, user, authz, tu=tu_ngay, den=den_ngay,
        lsx_id=lsx_id, tu_khoa=tu_khoa, cong_doan_id=cong_doan_id, khach_id=khach_id, cong_doan=cong_doan,
        chon={"cong_doan": chon_cong_doan, "to": chon_to, "tieu_chi": chon_tieu_chi, "ngay": chon_ngay},
        trang=trang, co_trang=co_trang,
    )


@router.get("/kcs/bao-cao/export.xlsx")
def export_bao_cao_kcs(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission("kcs", "read"))],
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query("kiem", pattern="^kiem$"),
    lsx_id: int | None = Query(default=None),
    tu_khoa: str | None = Query(default=None, max_length=200),
    cong_doan_id: int | None = Query(default=None),
    khach_id: int | None = Query(default=None),
    cong_doan: str | None = Query(default=None, max_length=200),
    chon_cong_doan: str | None = Query(default=None, max_length=255),
    chon_to: str | None = Query(default=None, max_length=255),
    chon_tieu_chi: str | None = Query(default=None, max_length=255),
    chon_ngay: str | None = Query(default=None, max_length=10),
    xem: str = Query("cong_doan", pattern="^(cong_doan|to|tieu_chi)$"),
) -> Response:
    """Xuất Excel — ô Xem của dòng KCS (nút xuất nằm ở màn KCS, 09/10/2026). KHÁC cổng của endpoint
    JSON ở trên (tổ chịu lỗi cũng xem được báo cáo tổ mình nhưng không có nút xuất). Dùng CHUNG hàm
    lấy dòng với `/kcs/bao-cao` (§9 mục 10: cùng filter phải trả cùng tổng). Nhận cả bấm-lọc `chon_*`
    và cách xem `xem` của tab để file ra đúng cái đang thấy (11/10/2026)."""
    content, filename = kcs_bao_cao.xuat_excel_kcs(
        db, user, authz, tu=tu_ngay, den=den_ngay,
        lsx_id=lsx_id, tu_khoa=tu_khoa, cong_doan_id=cong_doan_id, khach_id=khach_id, cong_doan=cong_doan,
        chon={"cong_doan": chon_cong_doan, "to": chon_to, "tieu_chi": chon_tieu_chi, "ngay": chon_ngay},
        xem=xem,
    )
    return _xlsx_response(content, filename)


# --- NHẬP KHO THÀNH PHẨM (yêu cầu nhập xuất của kho thật) -----------------------------------
# Kho nhận bằng phiếu nhập ở module Kho (`kho_voucher`), không còn endpoint xác nhận riêng ở đây.
KHO_MODULE = "kho"


@router.post("/kcs/cong-viec/{cong_viec_id}/yeu-cau-nhap-kho", response_model=NhapKhoYcKetQuaOut,
             status_code=status.HTTP_201_CREATED)
def tao_yeu_cau_nhap_kho_cong_doan(
    cong_viec_id: int,
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """"Tạo yêu cầu nhập kho" trên công đoạn cuối nhóm — lập MỘT yêu cầu NHẬP của kho thật cho
    thành phẩm của cụm bán; server tự tính phần đạt chưa gửi, không nhận số từ client. Người thuộc
    tổ KCS. 409 nếu không còn số đạt chưa gửi. SSE (kho + màn KCS) phát trong service sau commit."""
    try:
        res = kho.tao_yeu_cau_nhap_kho_cong_doan(db, user=user, cong_viec_id=cong_viec_id)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except kho.KhongConSoDuGuiKho as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    _phat_sse_kcs(res)
    # Giá bán là TIỀN — chỉ người có `kho:view_cost` mới nhận (chủ 18/09/2026); người KCS bấm gửi
    # thì không, dù màn KCS không hiện số này.
    if not authz.can(user, KHO_MODULE, "view_cost"):
        res = {**res, "dong": [{**d, "don_gia_ban": None} for d in res.get("dong", [])]}
    return res


# --- ĐÓNG LỆNH (KCS bấm tay — spec 2026-09-29-dong-lenh-thu-cong-design.md) ------------------
@router.get("/kcs/nhom/{nhom_id}/dong", response_model=DongLenhTinhTrangOut)
def tinh_trang_dong_lenh(
    nhom_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_quyen_to("read", (KHO_MODULE, "read"), ("kcs", "read")))],
) -> dict:
    """Số tóm tắt + cảnh báo cho hộp xác nhận "Đóng lệnh". Không có cổng điều kiện."""
    return _chay(lambda: dong_lenh.tinh_trang_dong(db, nhom_id, user))


@router.post("/kcs/nhom/{nhom_id}/dong", response_model=DongLenhKetQuaOut)
def dong_lenh_nhom(
    nhom_id: int,
    body: DongLenhIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Người KCS đóng mọi lệnh của nhóm. Ranh giới thật là `gate_kcs` ở service (403)."""
    res = _chay(lambda: dong_lenh.dong(
        db, user=user, nhom_id=nhom_id, expected_version=body.expected_version))
    phat_dong_lenh(res)
    return res


@router.post("/kcs/nhom/{nhom_id}/mo-lai", response_model=DongLenhKetQuaOut)
def mo_lai_lenh_nhom(
    nhom_id: int,
    body: DongLenhIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    res = _chay(lambda: dong_lenh.mo_lai(
        db, user=user, nhom_id=nhom_id, expected_version=body.expected_version))
    phat_dong_lenh(res)
    return res
