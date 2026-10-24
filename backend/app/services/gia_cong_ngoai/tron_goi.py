"""Gia công TRỌN GÓI (spec 2026-09-26 §4).

Đặt = phát hành lệnh thành một gói có ĐÚNG MỘT công việc thuê ngoài, không tổ, là công đoạn cuối
của nhóm thành phẩm. Không bước nào xuống bàn tổ; lệnh vẫn "Đã phát hành" để mọi màn đọc đúng.
Số cuối chốt bằng `chot.py` (nhánh kho / khách) như dải cuối của gia công một phần.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.gia_cong_ngoai import KIEU_TRON_GOI, GiaCongNgoai, _utcnow
from ...models.lsx import TT_CHO_BO_SUNG, TT_DA_LAP_KE_HOACH, TT_NHAP, TT_SAN_SANG
from ...models.lsx import TT_DA_PHAT_HANH as LSX_DA_PHAT_HANH
from ...models.san_xuat import (
    BUOC_THUE_NGOAI, CV_PHAT_HANH, PB_PHAT_HANH, SanXuatCongViec, SanXuatGoiPhatHanh,
    SanXuatPhienBan,
)
from ...models.stock_request import REQ_CANCELLED, REQ_DONE, REQ_PARTIAL, REQ_XUAT
from ...models.vat_lieu_kho import GiayNguyen
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.document_sequence_repo import DocumentSequenceRepository
from ...repositories.don_vi_do_repo import DonViDoRepository, nhan_don_vi
from ...repositories.gia_cong_ngoai_repo import GiaCongNgoaiRepository
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.stock_lot_repo import StockLotRepository
from ...repositories.stock_request_repo import StockRequestRepository
from ...repositories.xep_lich_lenh_repo import XepLichLenhRepository
from ...repositories.xep_lich_repo import XepLichRepository
from ..bien_cong_thuc import quy_cach_bien
from ..kho_giay import chuan_kho, don_vi_goc_to, goi_y_dong_giay, la_ma_to_giay, nhan_kho
from ..san_xuat.component import thanh_phan_lien_thong
from ..san_xuat.nhom import dam_bao_nhom
from ..san_xuat.release_update import thu_hoi_goi
from ..san_xuat.vat_tu_de_nghi import _hang_service, _req_service
from ..sequence_service import SequenceService
from ..stock_request_service import StockRequestError
from . import GiaCongXungDot, kiem_version, so_vi

_DAT_DUOC = (TT_NHAP, TT_CHO_BO_SUNG, TT_SAN_SANG, TT_DA_LAP_KE_HOACH)


def chan_tron_goi(db: Session, lsx_id: int) -> tuple[str, str] | None:
    """Lệnh đi chung với lệnh khác (cùng làm ra một thành phẩm, nối công đoạn chéo, hoặc in ghép
    tờ trong bài ghép) thì không giao trọn gói riêng được — nhà gia công làm trọn một lệnh trong khi
    lệnh kia còn chạy trong xưởng là đứt chỗ ghép. Trả `(câu ngắn, câu đầy đủ)`, cả hai nêu ĐÍCH
    DANH lệnh / bài ghép đang dính để người kế hoạch biết vì sao, khỏi đoán "nhóm thành phẩm" là
    gì. Câu ngắn để chip trên thanh đầu màn lệnh. None = lệnh đứng riêng."""
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
    """Nhu cầu vật tư của lệnh vừa đổi mà lệnh không bật giữ chỗ (nhánh `tat`/`bat` đã tự làm hai
    việc này): bỏ cache bảng cân đối + báo Kế hoạch vật tư / đèn vật tư nạp lại ngay."""
    from ..can_doi_cache import xoa_cache_can_doi
    from ..giu_cho_service import _bao_ke_hoach_vat_tu_doi

    xoa_cache_can_doi()
    _bao_ke_hoach_vat_tu_doi()


def dat_tron_goi(db: Session, *, user, lsx_id: int, nha_cung_cap_id: int, sl_dat: float,
                 xuong_cap_giay: bool) -> dict:
    repo = SanXuatRepository(db)
    gc_repo = GiaCongNgoaiRepository(db)
    # Khoá dòng lệnh TRƯỚC mọi kiểm tra — hai lượt đặt trọn gói bấm gần như đồng thời phải xếp
    # hàng, không cùng đọc trạng thái cũ rồi cùng ghi đè nhau.
    lsx = repo.khoa_lsx(lsx_id)
    if lsx is None:
        raise ValueError("Không tìm thấy lệnh sản xuất.")
    if lsx.trang_thai == LSX_DA_PHAT_HANH:
        raise ValueError("Lệnh đã phát hành xuống xưởng — thu hồi phát hành trước rồi mới đặt "
                         "gia công trọn gói.")
    if lsx.trang_thai not in _DAT_DUOC:
        raise ValueError("Trạng thái lệnh không cho đặt gia công trọn gói.")
    nha = gc_repo.nha_gia_cong(nha_cung_cap_id)
    if nha is None:
        raise ValueError("Nhà cung cấp này chưa bật “Nhận gia công” hoặc đã ngừng giao dịch.")
    if float(sl_dat or 0) <= 0:
        raise ValueError("Số lượng đặt gia công phải lớn hơn 0.")
    chan = ly_do_khong_tron_goi(db, lsx_id)
    if chan:
        raise ValueError(chan)
    if repo.goi_hien_tai_cua({lsx_id}, set()) is not None:
        raise ValueError("Lệnh đang có gói phát hành — thu hồi trước.")
    # Kiểm xong hết mới xoá. Lệnh đã xếp lịch theo công đoạn (spec §4 bước 1): xếp lịch không còn
    # nghĩa với trọn gói — tự gỡ nháp xếp lịch của lệnh thay vì bắt người dùng sang màn Xếp lịch.
    xl_repo = XepLichRepository(db)
    if xl_repo.exists_lsx(lsx_id):
        xl_repo.delete_rows(xl_repo.by_lsx(lsx_id))

    # Mốc giờ của bàn Xếp lịch không còn nghĩa: lệnh không chạy trong xưởng.
    moc = XepLichLenhRepository(db).theo_lsx(lsx_id)
    if moc is not None:
        XepLichLenhRepository(db).xoa(moc)

    uid = getattr(user, "id", None)
    # Số đặt / số cuối theo ĐƠN VỊ LỆNH — đúng thứ người dùng gõ ở hộp thoại (nhãn `don_vi_tinh`).
    # Không gắn nhãn đơn vị món Thành phẩm: số không quy mà đổi nhãn là lệch hệ số. Lúc nhập kho /
    # giao thẳng mới quy sang đơn vị món / dòng đơn (`_he_so_cho_nhap`), y như gia công một phần.
    dv = (lsx.don_vi_tinh or "").strip()
    gcn = GiaCongNgoai(
        lsx_id=lsx_id, kieu=KIEU_TRON_GOI, nha_cung_cap_id=nha.id, nha_cung_cap_ten=nha.name,
        ten_viec="Trọn gói cả lệnh", don_vi=dv, sl_dat=float(sl_dat),
        xuong_cap_giay=bool(xuong_cap_giay), created_by=uid,
    )
    db.add(gcn)
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
        lsx_id=lsx_id, ten_cong_doan=f"Gia công trọn gói — {nha.name}"[:255],
        loai_buoc=BUOC_THUE_NGOAI, department_id=None, la_kcs_cuoi=True,
        so_luong_vao=float(sl_dat), so_luong_ra=float(sl_dat), don_vi_vao=dv, don_vi_ra=dv,
        nha_cung_cap=nha.name, trang_thai=CV_PHAT_HANH, gia_cong_ngoai_id=gcn.id,
    ))
    if nhom is not None:
        nhom.than_chinh_lsx_id = lsx_id
    member = repo.member_of_lsx(lsx_id)
    if member is not None:
        member.la_than_chinh = True
    lsx.trang_thai = LSX_DA_PHAT_HANH

    dv_ten = nhan_don_vi(DonViDoRepository(db).ten_theo_ma(), dv)
    AuditLogRepository(db).create(
        actor_user_id=uid, action="gia_cong_ngoai_dat", target=f"gia_cong_ngoai:{gcn.id}",
        detail=(f"Giao trọn gói lệnh {lsx.ma} cho {nha.name}, đặt {so_vi(sl_dat)} {dv_ten}, "
                f"{'xưởng cấp giấy' if xuong_cap_giay else 'nhà gia công tự lo giấy'}"),
        commit=False,
    )
    db.commit()

    # Giữ chỗ vật tư đi theo NHU CẦU mới (KHVT bỏ nhu cầu lệnh trọn gói): nhả hết rồi giữ lại
    # đúng phần còn cần — giấy khi xưởng cấp, không gì khi nhà gia công lo. `tat`/`bat` tự commit.
    # Xưởng cấp giấy: nhu cầu giấy theo quy cách lệnh nếu bước chưa khai giấy (KHVT `_giay_tron_goi`).
    if lsx.giu_cho_bat:
        giu = _giu_cho(db)
        giu.tat(lsx_id=lsx_id)
        if xuong_cap_giay:
            giu.bat(lsx_id=lsx_id)
    else:
        _bao_nhu_cau_doi()
    return {"gia_cong_ngoai_id": gcn.id, "lsx_id": lsx_id}


def _lay_tron_goi(gc_repo: GiaCongNgoaiRepository, gcn_id: int, expected_version):
    gcn = gc_repo.khoa(gcn_id)
    if gcn is None or gcn.kieu != KIEU_TRON_GOI:
        raise ValueError("Không tìm thấy lần gia công trọn gói.")
    kiem_version(gcn, expected_version)
    if gcn.huy_luc is not None:
        raise ValueError("Lần gia công đã huỷ.")
    if gcn.chot_luc is not None:
        raise GiaCongXungDot("Lần gia công đã chốt số — mở lại trước.")
    return gcn


def huy_tron_goi(db: Session, *, user, gcn_id: int, expected_version: int | None,
                 ly_do: str) -> dict:
    ly_do = (ly_do or "").strip()
    if len(ly_do) < 3:
        raise ValueError("Ghi lý do huỷ (ít nhất 3 ký tự).")
    gc_repo = GiaCongNgoaiRepository(db)
    gcn = _lay_tron_goi(gc_repo, gcn_id, expected_version)
    req_repo = StockRequestRepository(db)
    yc_huy = []
    for req in gc_repo.yeu_cau_xuat_cua(gcn.id):
        req_repo.lock_for_update(req.id)
        if req_repo.co_voucher(req.id):
            raise ValueError(f"Kho đã lập phiếu xuất giấy {req.ma} cho nhà gia công — không huỷ "
                             "được. Nhập trả giấy về kho trước.")
        if req.trang_thai != REQ_CANCELLED:
            req.trang_thai, req.ly_do_huy = REQ_CANCELLED, "Huỷ gia công trọn gói"
            yc_huy.append(req)

    uid = getattr(user, "id", None)
    # Đánh huỷ TRƯỚC khi thu hồi gói: `thu_hoi_goi` → `huy_lan_cua_goi` bỏ qua lần đã huỷ, nên
    # lý do người dùng gõ không bị câu "Thu hồi gói…" đè.
    gcn.huy_luc, gcn.huy_boi_id, gcn.ly_do_huy = _utcnow(), uid, ly_do[:500]
    gcn.version += 1
    thu_hoi_goi(db, nguon="lsx", id=gcn.lsx_id, actor=user)
    lsx = SanXuatRepository(db).lsx(gcn.lsx_id)
    lsx.trang_thai = TT_NHAP
    # Nhà gia công tự lo giấy (`xuong_cap_giay=False`) ⇒ lúc đặt `dat_tron_goi` đã TẮT hẳn
    # `giu_cho_bat` (không có nhánh bật lại vì không giữ gì cho lệnh này). Huỷ thì lệnh về Nháp,
    # cần giữ chỗ ĐẦY ĐỦ như một lệnh bình thường — không có cột nào nhớ lại cờ lúc TRƯỚC khi đặt
    # trọn gói (`dat_tron_goi` chỉ tắt khi đang bật, nhưng giá trị "đang bật" đó không được lưu
    # riêng), nên ở đây BẬT LẠI vô điều kiện cho trường hợp NCC lo giấy — chấp nhận bật cả khi lệnh
    # trước đó chưa từng bật giữ chỗ (an toàn hơn bỏ sót: `bat()` không nhặt được gì nếu không có
    # nhu cầu, chỉ đơn thuần bật cờ + cân đối).
    if not gcn.xuong_cap_giay:
        lsx.giu_cho_bat = True
    AuditLogRepository(db).create(
        actor_user_id=uid, action="gia_cong_ngoai_huy", target=f"gia_cong_ngoai:{gcn.id}",
        detail=f"Huỷ trọn gói — lệnh {lsx.ma} về Nháp. Lý do: {ly_do}"[:500], commit=False,
    )
    db.commit()
    # Badge "chờ cấp" của thủ kho tụt ngay khi đề nghị xuất giấy bị huỷ (không đợi F5).
    for req in yc_huy:
        _req_service(db, _hang_service(db)).thong_bao_da_huy(req)

    # Đặt trọn gói đã TẮT giữ chỗ (hoặc tắt rồi chỉ giữ giấy) — huỷ thì bật lại đúng như lúc chưa
    # đặt, cho lệnh về Nháp cân đối vật tư bình thường như mọi lệnh khác. `bat` tự commit.
    if lsx.giu_cho_bat:
        _giu_cho(db).bat(lsx_id=gcn.lsx_id)
    else:
        _bao_nhu_cau_doi()
    return {"gia_cong_ngoai_id": gcn.id, "lsx_id": gcn.lsx_id}


def _de_xuat_giay(db: Session, lsx) -> dict:
    """Giấy nên cấp cho nhà gia công: mã giấy + khổ + số lượng (`so_to`, theo `don_vi`). Dòng giấy
    khai ở bước đầu tiên của lệnh thắng (người kế hoạch đã sửa tay): tờ đủ hai cạnh, hoặc CUỘN của
    Cắt giấy cuộn — khổ `(rộng cuộn, 0)`, đếm kg (24/10/2026). Không có thì đọc quy cách lệnh — ảnh
    chụp từ phiếu tính giá (`goi_y_dong_giay`, cùng luật điền sẵn dòng giấy của bước). Mã giấy luôn
    lấy ở máy chủ."""
    for vt in GiaCongNgoaiRepository(db).giay_cua_lenh(lsx.id):
        kr, kd = chuan_kho(vt.kho_rong, vt.kho_dai)
        goc = vt.don_vi_goc or ""
        # Dòng đếm tờ (đơn vị gốc `to`; dòng cũ chưa ghi gốc thì nhìn mã chặng của ĐVT).
        dem_to = goc == don_vi_goc_to() or (not goc and la_ma_to_giay(vt.don_vi_snapshot))
        if dem_to and kr and kd:
            # Dòng giấy lệnh mang MÃ CHẶNG (`to_nguyen` / `to`); qua cửa kho mọi mã tờ là một "tờ".
            so = float(vt.so_luong) if la_ma_to_giay(vt.don_vi_snapshot) else None
            return {"giay_id": int(vt.vat_tu_id), "kho_rong": kr, "kho_dai": kd, "so_to": so,
                    "don_vi": don_vi_goc_to(), "nguon": "lệnh"}
        if goc == "kg" and kr and not kd:
            return {"giay_id": int(vt.vat_tu_id), "kho_rong": kr, "kho_dai": 0,
                    "so_to": float(vt.so_luong), "don_vi": "kg", "nguon": "lệnh"}
    return de_xuat_tu_quy_cach(lsx)


def de_xuat_tu_quy_cach(lsx) -> dict:
    """Giấy theo quy cách lệnh (ảnh chụp phiếu tính giá): mã + khổ nguyên + số tờ nguyên. Thuần —
    không query; bảng cân đối vật tư gọi cho lệnh trọn gói chưa khai giấy ở bước."""
    qc = quy_cach_bien(lsx)
    try:
        giay_id = int(qc.get("giay_id") or 0) or None
    except (TypeError, ValueError):
        giay_id = None
    gy = goi_y_dong_giay(qc)
    return {"giay_id": giay_id, "kho_rong": gy["kho_rong"], "kho_dai": gy["kho_dai"],
            "so_to": gy["so_luong"], "don_vi": don_vi_goc_to(), "nguon": "phiếu tính giá"}


def cho_cap_giay(gcn, *, co_xuat: bool) -> bool:
    """Lần trọn gói xưởng cấp giấy, còn chạy, chưa có đề nghị xuất giấy còn sống."""
    return (gcn.kieu == KIEU_TRON_GOI and bool(gcn.xuong_cap_giay) and gcn.huy_luc is None
            and gcn.chot_luc is None and not co_xuat)


def ly_do_khong_nhan_ve(repo: GiaCongNgoaiRepository, gcn, xuat: list | None = None) -> str | None:
    """Trọn gói xưởng cấp giấy: kho chưa ghi sổ phiếu xuất giấy nào cho nhà gia công thì CHƯA cho
    nhận hàng về (07/10/2026, chặn cứng). Hàng đã về mà giấy chưa rời kho trên sổ là tồn khai
    khống, còn đề nghị xuất treo lại cho một lệnh đã xong. Xuất một phần là đủ — giấy đã đi.
    `xuat` = đề nghị xuất còn sống nếu nơi gọi đã đọc sẵn. None = nhận về được."""
    if gcn.kieu != KIEU_TRON_GOI or not gcn.xuong_cap_giay or gcn.chot_luc is not None \
            or gcn.huy_luc is not None:
        return None
    if xuat is None:
        xuat = repo.yeu_cau_xuat_cua(gcn.id)
    if not xuat:
        return ("Chưa cấp giấy cho nhà gia công — chọn giấy, gửi đề nghị xuất và chờ kho xuất "
                "giấy rồi mới nhận hàng về.")
    if not any(r.trang_thai in (REQ_PARTIAL, REQ_DONE) for r in xuat):
        return f"Kho chưa xuất giấy theo đề nghị {xuat[0].ma} — chờ kho xuất giấy rồi mới nhận hàng về."
    return None


def goi_y_cap_giay(db: Session, gcn, *, co_xuat: bool) -> dict | None:
    """Phần "Chọn giấy" của khối Gia công ngoài (C1, mockup tron-goi-cap-giay-C): mã giấy, đề xuất
    khổ + số lượng, và tồn của mã đó chia theo khổ — tờ theo khổ, cuộn theo rộng (kg); mỗi dòng
    mang đơn vị của nó. Nằm sẵn trong dict lần — bấm "Chọn giấy" mở ngay, khỏi gọi thêm API. None
    khi lần không chờ cấp giấy."""
    if not cho_cap_giay(gcn, co_xuat=co_xuat):
        return None
    lsx = SanXuatRepository(db).lsx(gcn.lsx_id)
    dx = _de_xuat_giay(db, lsx)
    out = {"giay_id": dx["giay_id"], "giay_ma": None, "giay_ten": None, "don_vi": dx["don_vi"],
           "nguon": dx["nguon"], "de_xuat": None, "kho": [], "ly_do": None}
    if dx["giay_id"] is None:
        out["ly_do"] = "Lệnh chưa chọn loại giấy — chọn giấy ở Quy cách của lệnh rồi quay lại."
        return out
    g = db.get(GiayNguyen, dx["giay_id"])
    out["giay_ma"], out["giay_ten"] = getattr(g, "ma", None), getattr(g, "ten", None)
    khoa_dx = (dx["kho_rong"], dx["kho_dai"], dx["don_vi"])
    co_kho = bool(dx["kho_rong"] and (dx["kho_dai"] or dx["don_vi"] == "kg"))
    if co_kho:
        out["de_xuat"] = {"kho_rong": dx["kho_rong"], "kho_dai": dx["kho_dai"],
                          "so_to": dx["so_to"], "don_vi": dx["don_vi"]}
    ton = {(r, d, g): t for r, d, g, t in StockLotRepository(db).ton_giay_theo_kho(dx["giay_id"])}
    if co_kho:
        # Khổ đề xuất luôn có mặt, kể cả kho hết — người kế hoạch thấy "hết" thay vì mất dòng.
        ton.setdefault(khoa_dx, 0.0)
    out["kho"] = [
        {"kho_rong": r, "kho_dai": d, "ton": t, "don_vi": g,
         "dung_de_xuat": co_kho and (r, d, g) == khoa_dx}
        for (r, d, g), t in sorted(ton.items(), key=lambda x: (
            not (co_kho and x[0] == khoa_dx), -x[1], x[0]))
    ]
    return out


def de_nghi_xuat_giay(db: Session, *, user, gcn_id: int, expected_version: int | None,
                      kho_rong: int, kho_dai: int, so_to: float):
    """Xưởng cấp giấy cho nhà gia công: MỘT đề nghị XUẤT, MỘT dòng giấy đúng khổ người kế hoạch chọn
    (kho soạn + lập phiếu xuất như mọi đề nghị khác) — tờ đủ hai cạnh, hoặc cuộn `(rộng, 0)` xin
    theo kg (`so_to` là số kg). Mã giấy lấy ở máy chủ theo lệnh; dòng mang `lsx_id` nên KHVT tự trừ
    "đã cấp". Kho thiếu vẫn cho gửi — kho tự báo thiếu / mua thêm."""
    kr, kd = chuan_kho(kho_rong, kho_dai)
    if not kr:
        raise ValueError("Chọn khổ giấy cần xuất.")
    dvt = don_vi_goc_to() if kd else "kg"
    so_to = round(float(so_to or 0), 2)
    if so_to <= 0:
        raise ValueError("Số lượng xin xuất phải lớn hơn 0.")
    gc_repo = GiaCongNgoaiRepository(db)
    gcn = _lay_tron_goi(gc_repo, gcn_id, expected_version)
    if not gcn.xuong_cap_giay:
        raise ValueError("Lần này nhà gia công tự lo giấy — không có giấy để xuất.")
    if gc_repo.yeu_cau_xuat_cua(gcn.id):
        raise ValueError("Lần này đã có đề nghị xuất giấy — xem ở Yêu cầu nhập xuất.")
    lsx = SanXuatRepository(db).lsx(gcn.lsx_id)
    giay_id = _de_xuat_giay(db, lsx)["giay_id"]
    if giay_id is None:
        raise ValueError("Lệnh chưa chọn loại giấy — chọn giấy ở Quy cách của lệnh rồi quay lại.")

    # Đơn vị gốc của dòng máy chủ kho tự suy từ `dvt` (tờ ⇒ `to`) — không gửi.
    lines = [{"hang_loai": "giay", "hang_id": giay_id, "dvt": dvt,
              "kho_rong": kr, "kho_dai": kd,
              "sl_de_nghi": so_to, "lsx_id": gcn.lsx_id}]
    req_svc = _req_service(db, _hang_service(db))
    try:
        req = req_svc.create(
            user=user, loai=REQ_XUAT, lines=lines, commit=False,
            bo_phan_id=user.department_id, gia_cong_ngoai_id=gcn.id,
            ghi_chu=f"Cấp giấy gia công trọn gói — {gcn.nha_cung_cap_ten} — lệnh {lsx.ma}"[:1000],
        )
    except StockRequestError as e:
        db.rollback()
        raise ValueError(str(e)) from None
    gcn.version += 1
    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None), action="gia_cong_ngoai_xuat_giay",
        target=f"gia_cong_ngoai:{gcn.id}",
        detail=(f"Đề nghị xuất giấy {req.ma}: {so_vi(so_to)} "
                f"{nhan_don_vi(DonViDoRepository(db).ten_theo_ma(), dvt)} "
                f"khổ {nhan_kho(kr, kd)}"), commit=False,
    )
    db.commit()
    req_svc.thong_bao_yeu_cau_moi(req)
    # Nhu cầu giấy của lệnh nay theo ĐÚNG dòng đề nghị (khổ / số tờ có thể khác quy cách) — giữ chỗ
    # đang bật thì nhả rồi giữ lại theo khổ mới, không thì chỗ cũ treo trên khổ không ai xin.
    if lsx.giu_cho_bat:
        giu = _giu_cho(db)
        giu.tat(lsx_id=lsx.id)
        giu.bat(lsx_id=lsx.id)
    else:
        _bao_nhu_cau_doi()
    return req
