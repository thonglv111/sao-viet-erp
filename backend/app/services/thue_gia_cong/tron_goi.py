"""Thuê gia công TRỌN GÓI cả lệnh (spec 2026-11-13 §3).

Đặt = phát hành lệnh thành một gói có ĐÚNG MỘT công việc thuê ngoài, không tổ, là công đoạn cuối
của nhóm thành phẩm, gắn một VIỆC trọn gói vào Hàng chờ. Nhà gia công chọn lúc lập đơn; giấy xưởng
cấp đi theo Phiếu giao. Không bước nào xuống Việc của tổ; lệnh vẫn "Đã phát hành" để nhóm thành
phẩm, nhập kho, giao hàng chạy nguyên đường.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.lsx import TT_CHO_BO_SUNG, TT_DA_LAP_KE_HOACH, TT_NHAP, TT_SAN_SANG
from ...models.lsx import TT_DA_PHAT_HANH as LSX_DA_PHAT_HANH
from ...models.san_xuat import (
    BUOC_THUE_NGOAI, CV_PHAT_HANH, PB_PHAT_HANH, SanXuatCongViec, SanXuatGoiPhatHanh,
    SanXuatPhienBan,
)
from ...models.thue_gia_cong import KIEU_TRON_GOI, TgcViec
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.document_sequence_repo import DocumentSequenceRepository
from ...repositories.don_vi_do_repo import DonViDoRepository
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository
from ...repositories.xep_lich_lenh_repo import XepLichLenhRepository
from ...repositories.xep_lich_repo import XepLichRepository
from ..bien_cong_thuc import quy_cach_bien
from ..kho_giay import chuan_kho, don_vi_goc_to, goi_y_dong_giay, la_ma_to_giay
from ..san_xuat.component import thanh_phan_lien_thong
from ..san_xuat.nhom import dam_bao_nhom
from ..sequence_service import SequenceService
from . import kiem_version, nhan_dv_chang, so_vi

_DAT_DUOC = (TT_NHAP, TT_CHO_BO_SUNG, TT_SAN_SANG, TT_DA_LAP_KE_HOACH)
TEN_VIEC_TRON_GOI = "Gia công trọn gói"


def chan_tron_goi(db: Session, lsx_id: int) -> tuple[str, str] | None:
    """Lệnh đi chung với lệnh khác (cùng làm ra một thành phẩm, nối công đoạn chéo, hoặc in ghép
    trong bài ghép) thì không giao trọn gói riêng được. Trả `(câu ngắn, câu đầy đủ)` nêu ĐÍCH DANH
    lệnh / bài ghép đang dính. None = lệnh đứng riêng."""
    repo = SanXuatRepository(db)
    tp = thanh_phan_lien_thong(repo, {lsx_id})
    khac = sorted(tp.lsx_ids - {lsx_id})
    if not khac and not tp.bai_ghep_ids:
        return None
    if tp.bai_ghep_ids:
        from ...models.bai_ghep import BaiGhep
        ma_bg = ", ".join(sorted(bg.ma for i in tp.bai_ghep_ids if (bg := db.get(BaiGhep, i))))
        return (f"Trong bài ghép {ma_bg} — chưa giao trọn gói được",
                f"Lệnh này in ghép tờ trong bài ghép {ma_bg} — không giao trọn gói riêng một lệnh "
                "được. Gỡ lệnh khỏi bài ghép trước nếu muốn giao trọn gói.")
    lenh = [x for i in khac if (x := repo.lsx(i)) is not None]
    ten = ", ".join(f"{x.ma} ({x.ten})" if x.ten else x.ma for x in lenh)
    return (f"Đi chung {', '.join(x.ma for x in lenh)} — chưa giao trọn gói được",
            f"Lệnh này đi chung với {ten} — các lệnh cùng làm ra một thành phẩm nên không giao "
            "trọn gói riêng một lệnh được.")


def ly_do_khong_tron_goi(db: Session, lsx_id: int) -> str | None:
    chan = chan_tron_goi(db, lsx_id)
    return chan[1] if chan else None


def _giu_cho(db: Session):
    from ..xep_lich.release import _giu_cho_service

    return _giu_cho_service(db)


def _bao_nhu_cau_doi() -> None:
    """Nhu cầu vật tư của lệnh vừa đổi mà lệnh không bật giữ chỗ: bỏ cache bảng cân đối + báo Kế
    hoạch vật tư / đèn vật tư nạp lại ngay."""
    from ..can_doi_cache import xoa_cache_can_doi
    from ..giu_cho_service import _bao_ke_hoach_vat_tu_doi

    xoa_cache_can_doi()
    _bao_ke_hoach_vat_tu_doi()


def dat(db: Session, *, user, lsx_id: int, sl_can: float | None = None,
        xuong_cap_giay: bool | None = None) -> TgcViec:
    """Lệnh chỉ GẮN CỜ trọn gói (13/11/2026: "việc duy nhất bên lệnh là gán cờ gia công") — màn lệnh
    không hỏi gì thêm. Bỏ trống ⇒ số cần = số lượng lệnh (đơn gia công sửa được số đặt), giấy mặc
    định NHÀ GIA CÔNG TỰ LO (chủ dự án 16/11/2026) — hộp lập đơn đổi sang xưởng cấp được."""
    repo = SanXuatRepository(db)
    # Khoá dòng lệnh TRƯỚC mọi kiểm tra — hai lượt đặt bấm gần như đồng thời phải xếp hàng.
    lsx = repo.khoa_lsx(lsx_id)
    if lsx is None:
        raise ValueError("Không tìm thấy lệnh sản xuất.")
    if lsx.trang_thai == LSX_DA_PHAT_HANH:
        raise ValueError("Lệnh đã phát hành xuống xưởng — thu hồi phát hành trước rồi mới thuê "
                         "gia công trọn gói.")
    if lsx.trang_thai not in _DAT_DUOC:
        raise ValueError("Trạng thái lệnh không cho thuê gia công trọn gói.")
    if sl_can is None:
        sl_can = float(lsx.so_luong_dat or 0)
    if xuong_cap_giay is None:
        xuong_cap_giay = False
    if float(sl_can or 0) <= 0:
        raise ValueError("Lệnh chưa có số lượng — sửa số lượng lệnh trước khi thuê gia công trọn gói.")
    chan = ly_do_khong_tron_goi(db, lsx_id)
    if chan:
        raise ValueError(chan)
    if repo.goi_hien_tai_cua({lsx_id}, set()) is not None:
        raise ValueError("Lệnh đang có gói phát hành — thu hồi trước.")
    # Xếp lịch không còn nghĩa với trọn gói: tự gỡ nháp xếp lịch + mốc giờ của lệnh.
    xl_repo = XepLichRepository(db)
    if xl_repo.exists_lsx(lsx_id):
        xl_repo.delete_rows(xl_repo.by_lsx(lsx_id))
    moc = XepLichLenhRepository(db).theo_lsx(lsx_id)
    if moc is not None:
        XepLichLenhRepository(db).xoa(moc)

    uid = getattr(user, "id", None)
    # Số theo ĐƠN VỊ LỆNH — đúng thứ người dùng gõ ở hộp thoại.
    dv = (lsx.don_vi_tinh or "").strip()
    viec = TgcViec(lsx_id=lsx_id, kieu=KIEU_TRON_GOI, ten_viec=TEN_VIEC_TRON_GOI,
                   sl_can=float(sl_can), don_vi=dv, xuong_cap_giay=bool(xuong_cap_giay),
                   created_by=uid)
    db.add(viec)
    db.flush()

    goi = SanXuatGoiPhatHanh(
        ma=SequenceService(DocumentSequenceRepository(db)).generate_code("san_xuat_goi"),
        version_hien_tai=1)
    repo.add(goi)
    repo.flush()
    repo.add(SanXuatPhienBan(goi_id=goi.id, so=1, loai=PB_PHAT_HANH, phat_hanh_by_id=uid))
    nhom = dam_bao_nhom(repo, {lsx_id}).get(lsx_id)
    repo.add(SanXuatCongViec(
        goi_id=goi.id, phien_ban_so=1, nhom_id=nhom.id if nhom is not None else None,
        lsx_id=lsx_id, ten_cong_doan=TEN_VIEC_TRON_GOI,
        loai_buoc=BUOC_THUE_NGOAI, department_id=None, la_kcs_cuoi=True,
        so_luong_vao=float(sl_can), so_luong_ra=float(sl_can), don_vi_vao=dv, don_vi_ra=dv,
        trang_thai=CV_PHAT_HANH, tgc_viec_id=viec.id,
    ))
    if nhom is not None:
        nhom.than_chinh_lsx_id = lsx_id
    member = repo.member_of_lsx(lsx_id)
    if member is not None:
        member.la_than_chinh = True
    lsx.trang_thai = LSX_DA_PHAT_HANH

    dv_ten = nhan_dv_chang(DonViDoRepository(db).ten_theo_ma(), dv)
    AuditLogRepository(db).create(
        actor_user_id=uid, action="tgc_tron_goi_dat", target=f"tgc_viec:{viec.id}",
        detail=(f"Thuê gia công trọn gói lệnh {lsx.ma}, {so_vi(sl_can)} {dv_ten}, "
                f"{'xưởng cấp giấy' if xuong_cap_giay else 'nhà gia công tự lo giấy'}"),
        commit=False,
    )
    db.commit()

    # Giữ chỗ đi theo NHU CẦU mới (KHVT bỏ nhu cầu lệnh trọn gói trừ giấy xưởng cấp).
    if lsx.giu_cho_bat:
        giu = _giu_cho(db)
        giu.tat(lsx_id=lsx_id)
        if xuong_cap_giay:
            giu.bat(lsx_id=lsx_id)
    else:
        _bao_nhu_cau_doi()
    return viec


def huy(db: Session, *, user, viec_id: int, expected_version: int | None, ly_do: str) -> int:
    """Huỷ trọn gói chưa đặt: thu hồi gói, xoá việc, lệnh về Nháp. Việc đã vào dòng đơn sống ⇒
    chặn (huỷ dòng đơn trước). Trả `lsx_id`."""
    from ..san_xuat.release_update import thu_hoi_goi

    ly_do = (ly_do or "").strip()
    if len(ly_do) < 3:
        raise ValueError("Ghi lý do huỷ (ít nhất 3 ký tự).")
    tgc = ThueGiaCongRepository(db)
    viec = tgc.khoa_viec(viec_id)
    if viec is None or viec.kieu != KIEU_TRON_GOI:
        raise ValueError("Không tìm thấy việc gia công trọn gói.")
    kiem_version(viec, expected_version, "Việc gia công")
    da_dat = tgc.dong_song_cua_viec([viec.id])
    if viec.id in da_dat:
        raise ValueError(f"Việc trọn gói đang nằm trong đơn gia công {da_dat[viec.id]} — huỷ dòng "
                         "đơn trước rồi huỷ trọn gói.")
    uid = getattr(user, "id", None)
    lsx_id, xuong_cap_giay = viec.lsx_id, bool(viec.xuong_cap_giay)
    lsx = SanXuatRepository(db).lsx(lsx_id)
    AuditLogRepository(db).create(
        actor_user_id=uid, action="tgc_tron_goi_huy", target=f"tgc_viec:{viec.id}",
        detail=f"Huỷ trọn gói — lệnh {lsx.ma} về Nháp. Lý do: {ly_do}"[:500], commit=False,
    )
    # Thu hồi gói tự xoá việc trọn gói (`viec.xoa_viec_cua_goi`).
    thu_hoi_goi(db, nguon="lsx", id=lsx_id, actor=user, ly_do=f"Huỷ trọn gói: {ly_do}")
    lsx.trang_thai = TT_NHAP
    # Nhà gia công tự lo giấy ⇒ lúc đặt đã TẮT giữ chỗ; về Nháp thì bật lại cho lệnh cân đối vật tư
    # như mọi lệnh khác (`bat()` không nhặt gì nếu không có nhu cầu).
    if not xuong_cap_giay:
        lsx.giu_cho_bat = True
    db.commit()
    if lsx.giu_cho_bat:
        _giu_cho(db).bat(lsx_id=lsx_id)
    else:
        _bao_nhu_cau_doi()
    return lsx_id


def de_xuat_giay(db: Session, lsx) -> dict:
    """Giấy nên cấp cho nhà gia công trọn gói: mã + khổ + số lượng. Dòng giấy khai ở bước của lệnh
    thắng (tờ đủ hai cạnh, hoặc cuộn `(rộng, 0)` đếm kg); không có thì đọc quy cách lệnh."""
    for vt in ThueGiaCongRepository(db).giay_cua_lenh(lsx.id):
        kr, kd = chuan_kho(vt.kho_rong, vt.kho_dai)
        goc = vt.don_vi_goc or ""
        dem_to = goc == don_vi_goc_to() or (not goc and la_ma_to_giay(vt.don_vi_snapshot))
        if dem_to and kr and kd:
            so = float(vt.so_luong) if la_ma_to_giay(vt.don_vi_snapshot) else None
            return {"giay_id": int(vt.vat_tu_id), "kho_rong": kr, "kho_dai": kd, "so_to": so,
                    "don_vi": don_vi_goc_to(), "nguon": "lệnh"}
        if goc == "kg" and kr and not kd:
            return {"giay_id": int(vt.vat_tu_id), "kho_rong": kr, "kho_dai": 0,
                    "so_to": float(vt.so_luong), "don_vi": "kg", "nguon": "lệnh"}
    return de_xuat_tu_quy_cach(lsx)


def de_xuat_tu_quy_cach(lsx) -> dict:
    """Giấy theo quy cách lệnh (ảnh chụp phiếu tính giá). Thuần — không query."""
    qc = quy_cach_bien(lsx)
    try:
        giay_id = int(qc.get("giay_id") or 0) or None
    except (TypeError, ValueError):
        giay_id = None
    gy = goi_y_dong_giay(qc)
    return {"giay_id": giay_id, "kho_rong": gy["kho_rong"], "kho_dai": gy["kho_dai"],
            "so_to": gy["so_luong"], "don_vi": don_vi_goc_to(), "nguon": "phiếu tính giá"}
