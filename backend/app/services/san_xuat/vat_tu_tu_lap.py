"""Phát hành lệnh thì hệ thống tự lập yêu cầu xuất vật tư cho từng bước (spec
`docs/superpowers/specs/2026-10-18-tu-lap-yeu-cau-xuat-khi-phat-hanh-design.md` §4).

Đi ĐÚNG đường tổ tự bấm (`vat_tu_de_nghi._chuan_hoa` → `_lap_lan`), chỉ khác ba chỗ: số xin là số
kế hoạch, bộ phận là tổ của công việc (không phải tổ của người bấm phát hành), và cờ `tu_lap`.

`lap_khi_phat_hanh` chạy TRONG giao dịch phát hành, không commit. Lỗi nghiệp vụ của TỪNG DÒNG
(mã thiếu đơn vị, số về 0,00 ở đơn vị kho, không quy được về gốc…) không chặn phát hành: dòng đó
vào `bo_qua`, các dòng khác vẫn lập, tổ xin tay món còn thiếu. Lỗi hệ thống thì nổ, phát hành
rollback cả hai — không có lệnh xuống xưởng mà yêu cầu kho mất một nửa.
"""
from __future__ import annotations

from datetime import datetime
from typing import TypedDict

from sqlalchemy.orm import Session

from ...models.stock_request import StockRequest
from ...realtime import hub
from ...repositories.ke_hoach_vat_tu_repo import KeHoachVatTuRepository
from ...repositories.notification_repo import NotificationRepository
from ...repositories.rbac_repo import RoleRepository
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.san_xuat_vat_tu_repo import SanXuatVatTuRepository
from ..ke_hoach_vat_tu_service import KeHoachVatTuError
from ..kho_giay import khoa_dong
from ..stock_request_service import StockRequestError
from ..thong_bao_man import bao
from . import vat_tu_de_nghi as vtdn
from .buoc_giay_bai import buoc_lay_giay_bai_lo

_EPS = 0.0005
_LOI_DONG = (vtdn.VatTuDeNghiError, KeHoachVatTuError, StockRequestError)


class KetQuaTuLap(TypedDict):
    request_ids: list[int]
    cv_ids: list[int]
    bo_qua: list[dict]


class _NhuCauCo:
    """`KeHoachVatTuService` với nhu cầu của MỘT công việc tính sẵn. `_chuan_hoa` gọi
    `nhu_cau_cua_cong_viec` mỗi lượt; kiểm từng dòng mà tính lại MRP mỗi dòng là N lần cân đối."""

    def __init__(self, kh_svc, nhu_cau: list[dict]):
        self._kh = kh_svc
        self._nhu_cau = nhu_cau

    def nhu_cau_cua_cong_viec(self, _cv) -> list[dict]:
        return self._nhu_cau

    def __getattr__(self, ten):
        return getattr(self._kh, ten)


def _gio_can(cv) -> datetime:
    """Giờ cần = giờ dự kiến bắt đầu của bước. Cột lưu wall-clock gắn nhãn UTC (`_aware`), nên gỡ
    nhãn trước khi đưa vào `_lap_lan` — để nguyên là `_can_luc_luu` dịch thêm +7h."""
    if cv.du_kien_bat_dau is not None:
        return cv.du_kien_bat_dau.replace(tzinfo=None)
    return datetime.now(vtdn._VN_TZ).replace(tzinfo=None)


def _neo_giay_bai(db: Session, cvs: list) -> dict[int, int | None]:
    """bai_ghep_id → id bước chung nhận giấy của bài (None = không bước nào nhận, không đoán)."""
    from ...repositories.bai_ghep_repo import BaiGhepRepository

    bai_ids = sorted({cv.bai_ghep_id for cv in cvs if cv.bai_ghep_id and cv.bai_ghep_cong_doan_id})
    if not bai_ids:
        return {}
    neo = buoc_lay_giay_bai_lo(db, BaiGhepRepository(db).buoc_chung_theo_bai(bai_ids))
    return {b: (getattr(neo.get(b), "id", None)) for b in bai_ids}


def _dong_xin(dong: dict) -> dict:
    return {
        "hang_loai": dong["hang_loai"], "hang_id": dong["hang_id"], "dvt": dong.get("dvt") or "",
        "sl_yeu_cau": float(dong.get("sl") or 0),
        "kho_rong": dong.get("kho_rong") or 0, "kho_dai": dong.get("kho_dai") or 0,
    }


def lap_khi_phat_hanh(db: Session, *, goi_id: int, nguoi) -> KetQuaTuLap:
    """Lập lần đề nghị `lan_dau` cho mọi công việc có vật tư của gói. KHÔNG commit."""
    kq: KetQuaTuLap = {"request_ids": [], "cv_ids": [], "bo_qua": []}
    if nguoi is None:
        return kq
    cvs = [cv for cv in SanXuatRepository(db).cong_viec_cua_goi(goi_id)
           if cv.gia_cong_ngoai_id is None]
    if not cvs:
        return kq
    hang = vtdn._hang_service(db)
    kh_svc = vtdn._kh_service(db, hang)
    req_svc = vtdn._req_service(db, hang)
    vt_repo = SanXuatVatTuRepository(db)
    neo_bai = _neo_giay_bai(db, cvs)

    # Nhu cầu của mọi bước cùng lệnh tính MỘT lượt cân đối (cụm lớn là hàng chục bước).
    with kh_svc.nho_nhu_cau():
        for cv in cvs:
            _lap_cho_viec(db, cv, kq=kq, nguoi=nguoi, hang=hang, kh_svc=kh_svc, req_svc=req_svc,
                          vt_repo=vt_repo, neo_bai=neo_bai)
    return kq


def _co_vat_tu_dinh_muc_0(db: Session, cv) -> bool:
    """Bước có dòng vật tư (không phải giấy) khai số ≤ 0."""
    repo = KeHoachVatTuRepository(db)
    if cv.bai_ghep_cong_doan_id:
        dongs = repo.vat_tu_theo_buoc_chung([cv.bai_ghep_cong_doan_id])
    elif cv.lsx_cong_doan_id:
        dongs = repo.vat_tu_theo_buoc_lenh([cv.lsx_cong_doan_id])
    else:
        return False
    # Bước chung bài ghép không có cột `hang_loai` (chỉ khai vật tư).
    return any(getattr(d, "hang_loai", "vat_tu") != "giay" and float(d.so_luong or 0) <= _EPS
               for d in dongs)


def _lap_cho_viec(db: Session, cv, *, kq: KetQuaTuLap, nguoi, hang, kh_svc, req_svc, vt_repo,
                  neo_bai) -> None:
    # Đã có đề nghị (gói cũ đã xuất chuyển sang, hay tổ đã xin) thì không lập thêm.
    if chuyen_de_nghi_cu(db, cv) or vt_repo.cac_de_nghi(cv.id):
        cv.can_vat_tu = True
        return
    nhu_cau = kh_svc.nhu_cau_cua_cong_viec(cv)
    if cv.bai_ghep_cong_doan_id and neo_bai.get(cv.bai_ghep_id) != cv.bai_ghep_cong_doan_id:
        nhu_cau = [d for d in nhu_cau if d["hang_loai"] != "giay"]
    if not nhu_cau:
        # Engine bỏ dòng định mức 0 nên tới đây không còn dòng nào — nhưng bước CÓ khai vật tư thì
        # tổ phải tự xin, bước vẫn chờ vật tư như nhánh `to_tu_xin` dưới (L-SX-15).
        if _co_vat_tu_dinh_muc_0(db, cv):
            cv.can_vat_tu = True
        return
    kh = _NhuCauCo(kh_svc, nhu_cau)

    nhan: list[dict] = []
    to_tu_xin = False
    for dong in nhu_cau:
        # Kế hoạch ra 0 (chưa khai công thức lượng) thì không có số để xin — tổ tự xin, nên bước
        # vẫn phải chờ vật tư. Có số mà không quy được về đơn vị gốc (mã thiếu đơn vị…) thì cứ
        # thử: lỗi vào `bo_qua`.
        if float(dong.get("sl") or 0) <= _EPS:
            to_tu_xin = True
            continue
        ln = _dong_xin(dong)
        try:
            k = khoa_dong(dong["hang_loai"], dong["hang_id"], dong.get("don_vi_goc"),
                          dong.get("kho_rong"), dong.get("kho_dai"))
            mot = [d for d in vtdn._chuan_hoa(kh, cv, [ln])
                   if khoa_dong(d["hang_loai"], d["hang_id"], d.get("don_vi_goc"),
                                d.get("kho_rong"), d.get("kho_dai")) == k]
            req_svc._validate_lines(vtdn._lines_kho(hang, cv, mot))
        except _LOI_DONG as e:
            kq["bo_qua"].append({
                "cong_viec_id": cv.id, "ten_cong_doan": cv.ten_cong_doan,
                "ten_hang": dong.get("ten") or f"#{dong['hang_id']}", "ly_do": str(e),
            })
            continue
        nhan.append(ln)
    # Mọi dòng đều lỗi (mã thiếu đơn vị…) thì KHÔNG khoá bước ở "Chưa yêu cầu": tổ xin tay cũng
    # vấp đúng lỗi đó, khoá lại là bước kẹt tới khi có người sửa danh mục. Toast phát hành đã kể
    # tên từng món bị bỏ qua.
    if nhan or to_tu_xin:
        cv.can_vat_tu = True
    if not nhan:
        return

    dongs = vtdn._chuan_hoa(kh, cv, nhan)
    _dn, req = vtdn._lap_lan(
        db, cv=cv, nguoi=nguoi, bo_phan_id=cv.department_id, can_luc=_gio_can(cv),
        dongs=dongs, ghi_chu=f"Tự lập khi phát hành «{cv.ten_cong_doan}».", tu_lap=True,
        req_svc=req_svc, hang=hang,
    )
    kq["cv_ids"].append(cv.id)
    if req is not None:
        kq["request_ids"].append(req.id)


def bao_sau_phat_hanh(db: Session, kq: KetQuaTuLap, *, ma_lenh: str, actor_id: int | None) -> None:
    """Báo SAU commit: MỘT tin cho mỗi thủ kho (không phải N tin cho N bước), và bàn của từng tổ
    có yêu cầu nhảy ngay."""
    if kq["request_ids"]:
        reqs = db.query(StockRequest).filter(StockRequest.id.in_(kq["request_ids"])).all()
        roles = RoleRepository(db)
        nhan: set[int] = set()
        for bo_phan_id in {r.bo_phan_id for r in reqs}:
            nhan |= set(roles.kho_notify_user_ids(bo_phan_id=bo_phan_id, creator_id=actor_id))
        # Tín hiệu đổi danh sách chờ: màn kho refetch, số chờ tăng thì FE tự toast "việc mới".
        for uid in nhan:
            hub.publish(uid, {"type": "stock_request_pending_changed", "code": ma_lenh, "loai": "XUAT"})
        chuong = sorted(u for u in nhan if u != actor_id)
        if chuong:
            n = len(reqs)
            bao(db, kenh="kho", loai="kho_yeu_cau_phat_hanh", actor_id=actor_id,
                nguoi_nhan=chuong, ma=f"{ma_lenh}: {n} yêu cầu xuất mới", commit=False)
            NotificationRepository(db).add_many(
                chuong, loai="kho_moi", tieu_de="Yêu cầu xuất mới chờ cấp",
                noi_dung=f"Lệnh {ma_lenh} vừa phát hành, {n} yêu cầu xuất vật tư",
                link_loai="kho_inbox", link_id=reqs[0].id if n == 1 else None,
            )
            for uid in chuong:
                hub.publish(uid, {"type": "notification_new"})
    repo = SanXuatRepository(db)
    for cv_id in kq["cv_ids"]:
        cv = repo.cong_viec(cv_id)
        if cv is not None:
            vtdn._bao_de_nghi_doi(cv)


# --- Thu hồi / phát hành lại / phát hành cập nhật (spec §4.5) -------------------------------
LY_DO_HUY_THU_HOI = "Lệnh bị thu hồi phát hành"
# Khoá `db.info` mang id yêu cầu vừa huỷ từ `thu_hoi_goi` (sâu dưới đường gỡ phát hành, trả `int`)
# lên tới tầng gọi để báo kho SAU commit — khỏi đổi kiểu trả của cả chuỗi chỉ để chở danh sách id.
KHOA_YC_HUY = "vat_tu_tu_lap.yeu_cau_da_huy"


def _co_phieu_ghi_so(db: Session, request_id: int) -> bool:
    from ...models.stock_voucher import VOUCHER_POSTED, StockVoucher

    return db.query(StockVoucher.id).filter(
        StockVoucher.request_id == request_id, StockVoucher.trang_thai == VOUCHER_POSTED,
    ).first() is not None


def huy_khi_thu_hoi(db: Session, *, goi_id: int, actor_id: int | None = None) -> list[int]:
    """Huỷ mọi yêu cầu xuất (tự lập lẫn tổ bấm) của công việc trong gói mà kho CHƯA ghi sổ phiếu
    nào: phiếu nháp chuyển `cancelled` (ghi nhật ký như kho tự huỷ), yêu cầu `cancelled`. Yêu cầu
    đã có phiếu ghi sổ giữ nguyên — vật tư đã về tổ, phát hành lại thì `chuyen_de_nghi_cu` nối nó
    sang công việc mới. KHÔNG commit (nằm trong giao dịch gỡ phát hành); báo kho bằng `bao_da_huy`
    sau commit.

    Thứ tự khoá PHIẾU trước, YÊU CẦU sau — cùng chiều với kho ghi sổ (`StockVoucherService.post`
    khoá phiếu rồi mới cập nhật yêu cầu). Ngược chiều là hai lượt chờ nhau. Quyết định "đã ghi sổ
    chưa" đọc từ chính các dòng phiếu vừa khoá (`populate_existing`): kho ghi sổ xong trước thì
    lượt này thấy `posted` và để yên; một lượt đọc trước khoá thì có thể huỷ nhầm phiếu đã ghi."""
    from ...models.stock_request import REQ_CANCELLED, REQ_REJECTED
    from ...models.stock_voucher import (
        VOUCHER_CANCELLED, VOUCHER_DRAFT, VOUCHER_POSTED, StockVoucher,
    )
    from ...repositories.audit_repo import AuditLogRepository
    from ...repositories.stock_request_repo import StockRequestRepository

    req_repo = StockRequestRepository(db)
    vt_repo = SanXuatVatTuRepository(db)
    audit = AuditLogRepository(db)
    da_huy: list[int] = []
    for cv in SanXuatRepository(db).cong_viec_cua_goi(goi_id):
        for dn in vt_repo.cac_de_nghi(cv.id):
            if not dn.stock_request_id:
                continue
            phieus = (db.query(StockVoucher)
                      .filter(StockVoucher.request_id == dn.stock_request_id)
                      .order_by(StockVoucher.id)
                      .with_for_update().populate_existing().all())
            req_repo.lock_for_update(dn.stock_request_id)
            req = db.get(StockRequest, dn.stock_request_id, populate_existing=True)
            if req is None or req.trang_thai in (REQ_CANCELLED, REQ_REJECTED):
                continue
            if any(v.trang_thai == VOUCHER_POSTED for v in phieus):
                continue
            for v in phieus:
                if v.trang_thai != VOUCHER_DRAFT:
                    continue
                v.trang_thai = VOUCHER_CANCELLED
                audit.create(
                    actor_user_id=actor_id, action="kho_phieu_huy", target=f"voucher:{v.id}",
                    detail=f"Phiếu {v.ma} huỷ theo yêu cầu {req.ma}: lệnh bị thu hồi phát hành",
                    commit=False,
                )
            req.trang_thai, req.ly_do_huy = REQ_CANCELLED, LY_DO_HUY_THU_HOI
            da_huy.append(req.id)
    db.flush()
    return da_huy


def bao_da_huy(db: Session, request_ids: list[int]) -> None:
    """Sau commit: badge "chờ cấp" của thủ kho tụt ngay, bàn tổ thôi hiện yêu cầu cũ."""
    from .kho import bao_yeu_cau_da_huy

    for rid in request_ids:
        req = db.get(StockRequest, rid)
        if req is not None:
            bao_yeu_cau_da_huy(db, req)


def chuyen_de_nghi_cu(db: Session, cv) -> bool:
    """Phát hành lại sau thu hồi: đề nghị của CÙNG bước ở gói đã thu hồi mà yêu cầu còn sống (kho
    đã xuất) chuyển sang công việc mới, đánh lại `lan_so` từ 1. Cùng phân đoạn thì nhận; phân đoạn
    cũ không còn ở lịch mới thì phân đoạn 1 nhận. Trả True nếu có chuyển. KHÔNG commit."""
    from ...models.san_xuat import GOI_DA_THU_HOI, SanXuatCongViec, SanXuatGoiPhatHanh
    from ...models.san_xuat_vat_tu import SanXuatVatTuDeNghi
    from ...models.stock_request import REQ_CANCELLED, REQ_REJECTED

    if cv.lsx_cong_doan_id:
        cung_buoc = SanXuatCongViec.lsx_cong_doan_id == cv.lsx_cong_doan_id
    elif cv.bai_ghep_cong_doan_id:
        cung_buoc = SanXuatCongViec.bai_ghep_cong_doan_id == cv.bai_ghep_cong_doan_id
    else:
        return False
    rows = (
        db.query(SanXuatVatTuDeNghi, SanXuatCongViec.phan_doan_so)
        .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatVatTuDeNghi.cong_viec_id)
        .join(SanXuatGoiPhatHanh, SanXuatGoiPhatHanh.id == SanXuatCongViec.goi_id)
        .join(StockRequest, StockRequest.id == SanXuatVatTuDeNghi.stock_request_id)
        .filter(cung_buoc, SanXuatCongViec.id != cv.id,
                SanXuatGoiPhatHanh.trang_thai == GOI_DA_THU_HOI,
                StockRequest.trang_thai.notin_((REQ_CANCELLED, REQ_REJECTED)))
        .order_by(SanXuatVatTuDeNghi.created_at, SanXuatVatTuDeNghi.id)
        .all()
    )
    if not rows:
        rows = _de_nghi_cua_buoc_da_xoa(db, cv)
    so = int(cv.phan_doan_so or 1)
    tong = int(cv.phan_doan_tong or 1)
    nhan = [dn for dn, pd in rows if int(pd or 1) == so or (so == 1 and int(pd or 1) > tong)]
    if not nhan:
        return False
    for i, dn in enumerate(nhan, start=1):
        dn.cong_viec_id, dn.lan_so = cv.id, i
    db.flush()
    return True


def _de_nghi_cua_buoc_da_xoa(db: Session, cv) -> list[tuple]:
    """L-PH-01: bước bị xoá rồi tạo lại khi sửa routing (id mới) ⇒ đề nghị CÒN SỐNG (chưa huỷ, chưa
    xuất đủ) của việc cũ mà gói mới không còn việc cùng bước thì dò theo `step_key`, rồi cùng nhóm +
    loại bước + tên bước (việc không chụp `cong_doan_id`, nhóm + loại đứng thay). Chỉ nhận khi đề
    nghị khớp đúng MỘT bước của gói mới và việc mới chưa có đề nghị riêng cho cùng món."""
    from ...models.san_xuat import GOI_DA_THU_HOI, SanXuatCongViec, SanXuatGoiPhatHanh
    from ...models.san_xuat_vat_tu import SanXuatVatTuDeNghi
    from ...models.stock_request import REQ_CANCELLED, REQ_DONE, REQ_REJECTED

    if cv.lsx_cong_doan_id:
        cot_buoc, cot_lenh, lenh_id = (SanXuatCongViec.lsx_cong_doan_id, SanXuatCongViec.lsx_id,
                                       cv.lsx_id)
    else:
        cot_buoc, cot_lenh, lenh_id = (SanXuatCongViec.bai_ghep_cong_doan_id,
                                       SanXuatCongViec.bai_ghep_id, cv.bai_ghep_id)
    if lenh_id is None:
        return []
    buoc_cua = (lambda v: v.lsx_cong_doan_id) if cv.lsx_cong_doan_id else (
        lambda v: v.bai_ghep_cong_doan_id)
    moi = [v for v in SanXuatRepository(db).cong_viec_cua_goi(cv.goi_id)
           if getattr(v, cot_lenh.key) == lenh_id and buoc_cua(v)]
    buoc_moi = {buoc_cua(v) for v in moi}
    rows = (
        db.query(SanXuatVatTuDeNghi, SanXuatCongViec)
        .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatVatTuDeNghi.cong_viec_id)
        .join(SanXuatGoiPhatHanh, SanXuatGoiPhatHanh.id == SanXuatCongViec.goi_id)
        .join(StockRequest, StockRequest.id == SanXuatVatTuDeNghi.stock_request_id)
        .filter(cot_lenh == lenh_id, cot_buoc.notin_(buoc_moi),
                SanXuatGoiPhatHanh.trang_thai == GOI_DA_THU_HOI,
                StockRequest.trang_thai.notin_((REQ_CANCELLED, REQ_REJECTED, REQ_DONE)))
        .order_by(SanXuatVatTuDeNghi.created_at, SanXuatVatTuDeNghi.id)
        .all()
    )
    if not rows:
        return []

    def _ten(s):
        return " ".join((s or "").split()).casefold()

    def _khop(cu) -> set:
        theo_key = {buoc_cua(v) for v in moi if cu.step_key and v.step_key == cu.step_key}
        return theo_key or {buoc_cua(v) for v in moi
                            if v.nhom_cong_doan == cu.nhom_cong_doan and v.loai_buoc == cu.loai_buoc
                            and _ten(v.ten_cong_doan) == _ten(cu.ten_cong_doan)}

    mon_rieng = {(d.hang_loai, d.hang_id) for dn in SanXuatVatTuRepository(db).cac_de_nghi(cv.id)
                 for d in dn.dongs}
    return [(dn, cu.phan_doan_so) for dn, cu in rows
            if _khop(cu) == {buoc_cua(cv)}
            and not mon_rieng & {(d.hang_loai, d.hang_id) for d in dn.dongs}]


def doi_can_luc_theo_lich(db: Session, *, goi_id: int) -> list[int]:
    """Phát hành cập nhật dời giờ: lần đề nghị TỰ LẬP mà tổ chưa sửa (`updated_by_id` NULL) và kho
    chưa ghi sổ phiếu nào thì giờ cần đi theo giờ dự kiến bắt đầu mới. Tổ đã sửa thì giữ giờ của
    tổ. Việc đã bắt đầu không đụng, giờ không đổi thì không ghi. Trả id yêu cầu đã đổi (báo kho
    sau commit). KHÔNG commit."""
    from ...models.san_xuat import CV_PHAT_HANH
    from ...models.san_xuat_vat_tu import SanXuatVatTuDeNghi
    from ...models.stock_request import REQ_CANCELLED, REQ_REJECTED

    doi: list[int] = []
    for cv in SanXuatRepository(db).cong_viec_cua_goi(goi_id):
        if cv.du_kien_bat_dau is None or cv.trang_thai != CV_PHAT_HANH:
            continue
        for dn in db.query(SanXuatVatTuDeNghi).filter(
                SanXuatVatTuDeNghi.cong_viec_id == cv.id, SanXuatVatTuDeNghi.tu_lap.is_(True),
                SanXuatVatTuDeNghi.updated_by_id.is_(None)):
            req = db.get(StockRequest, dn.stock_request_id) if dn.stock_request_id else None
            if req is None or req.trang_thai in (REQ_CANCELLED, REQ_REJECTED):
                continue
            if _co_phieu_ghi_so(db, req.id):
                continue
            gio = _gio_can(cv)
            moi = vtdn._can_luc_luu(gio)
            cu = req.can_luc
            if cu is not None and cu.replace(tzinfo=None) == moi.replace(tzinfo=None):
                continue
            dn.can_luc = req.can_luc = moi
            req.ngay_can = vtdn._ngay_vn(gio)
            doi.append(req.id)
    db.flush()
    return doi


def bao_doi_gio(db: Session, request_ids: list[int]) -> None:
    """Sau commit: màn kho refetch, cột Cần lúc nhảy giờ mới."""
    if not request_ids:
        return
    svc = vtdn._req_service(db, vtdn._hang_service(db))
    for rid in request_ids:
        req = db.get(StockRequest, rid)
        if req is not None:
            svc.thong_bao_da_doi(req)
