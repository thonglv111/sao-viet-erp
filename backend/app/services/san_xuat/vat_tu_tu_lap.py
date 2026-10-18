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
        # Đã có đề nghị (gói cũ chuyển sang, hay tổ đã xin) thì không lập thêm.
        if vt_repo.cac_de_nghi(cv.id):
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
