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

    for cv in cvs:
        # Đã có đề nghị (gói cũ đã xuất chuyển sang, hay tổ đã xin) thì không lập thêm.
        if chuyen_de_nghi_cu(db, cv) or vt_repo.cac_de_nghi(cv.id):
            cv.can_vat_tu = True
            continue
        nhu_cau = kh_svc.nhu_cau_cua_cong_viec(cv)
        if cv.bai_ghep_cong_doan_id and neo_bai.get(cv.bai_ghep_id) != cv.bai_ghep_cong_doan_id:
            nhu_cau = [d for d in nhu_cau if d["hang_loai"] != "giay"]
        if not nhu_cau:
            continue
        cv.can_vat_tu = True
        kh = _NhuCauCo(kh_svc, nhu_cau)

        nhan: list[dict] = []
        for dong in nhu_cau:
            # Kế hoạch ra 0 (chưa khai công thức lượng) thì không có số để xin — tổ tự xin. Có số
            # mà không quy được về đơn vị gốc (mã thiếu đơn vị…) thì cứ thử: lỗi vào `bo_qua`.
            if float(dong.get("sl") or 0) <= _EPS:
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
        if not nhan:
            continue

        dongs = vtdn._chuan_hoa(kh, cv, nhan)
        dn, req = vtdn._lap_lan(
            db, cv=cv, nguoi=nguoi, bo_phan_id=cv.department_id, can_luc=_gio_can(cv),
            dongs=dongs, ghi_chu=f"Tự lập khi phát hành «{cv.ten_cong_doan}».", tu_lap=True,
            req_svc=req_svc, hang=hang,
        )
        kq["cv_ids"].append(cv.id)
        if req is not None:
            kq["request_ids"].append(req.id)
    return kq


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
            bao(db, kenh="kho", loai="kho_yeu_cau_moi", actor_id=actor_id, nguoi_nhan=chuong,
                commit=False)
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


def huy_khi_thu_hoi(db: Session, *, goi_id: int) -> list[int]:
    """Huỷ mọi yêu cầu xuất (tự lập lẫn tổ bấm) của công việc trong gói mà kho CHƯA ghi sổ phiếu
    nào: phiếu nháp chuyển `cancelled`, yêu cầu `cancelled`. Yêu cầu đã có phiếu ghi sổ giữ nguyên
    — vật tư đã về tổ, phát hành lại thì `chuyen_de_nghi_cu` nối nó sang công việc mới. KHÔNG
    commit (nằm trong giao dịch gỡ phát hành); báo kho bằng `bao_da_huy` sau commit."""
    from ...models.stock_request import REQ_CANCELLED, REQ_REJECTED
    from ...models.stock_voucher import VOUCHER_CANCELLED, VOUCHER_DRAFT, StockVoucher
    from ...repositories.stock_request_repo import StockRequestRepository

    req_repo = StockRequestRepository(db)
    vt_repo = SanXuatVatTuRepository(db)
    da_huy: list[int] = []
    for cv in SanXuatRepository(db).cong_viec_cua_goi(goi_id):
        for dn in vt_repo.cac_de_nghi(cv.id):
            if not dn.stock_request_id:
                continue
            req_repo.lock_for_update(dn.stock_request_id)
            req = db.get(StockRequest, dn.stock_request_id)
            if req is None or req.trang_thai in (REQ_CANCELLED, REQ_REJECTED):
                continue
            if _co_phieu_ghi_so(db, req.id):
                continue
            for v in db.query(StockVoucher).filter(
                    StockVoucher.request_id == req.id, StockVoucher.trang_thai == VOUCHER_DRAFT):
                v.trang_thai = VOUCHER_CANCELLED
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
    so = int(cv.phan_doan_so or 1)
    tong = int(cv.phan_doan_tong or 1)
    nhan = [dn for dn, pd in rows if int(pd or 1) == so or (so == 1 and int(pd or 1) > tong)]
    if not nhan:
        return False
    for i, dn in enumerate(nhan, start=1):
        dn.cong_viec_id, dn.lan_so = cv.id, i
    db.flush()
    return True


def doi_can_luc_theo_lich(db: Session, *, goi_id: int) -> list[int]:
    """Phát hành cập nhật dời giờ: lần đề nghị TỰ LẬP mà tổ chưa sửa (`updated_by_id` NULL) và kho
    chưa ghi sổ phiếu nào thì giờ cần đi theo giờ dự kiến bắt đầu mới. Tổ đã sửa thì giữ giờ của
    tổ. Trả id yêu cầu đã đổi (báo kho sau commit). KHÔNG commit."""
    from ...models.san_xuat_vat_tu import SanXuatVatTuDeNghi
    from ...models.stock_request import REQ_CANCELLED, REQ_REJECTED

    doi: list[int] = []
    for cv in SanXuatRepository(db).cong_viec_cua_goi(goi_id):
        if cv.du_kien_bat_dau is None:
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
            dn.can_luc = req.can_luc = vtdn._can_luc_luu(gio)
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
