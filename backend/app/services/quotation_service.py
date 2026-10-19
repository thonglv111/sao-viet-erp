"""Báo giá (Quotation / Quote) business logic — Header-Version-Item (H-V-I) pattern.
"""
from __future__ import annotations

import math
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from ..models.quotation import (
    DEFAULT_TERMS,
    Quote,
    QuoteVersion,
    QuoteItem,
    STATUS_DRAFT,
    STATUS_PENDING_APPROVAL,
    STATUS_APPROVED,
    STATUS_SENT,
    STATUS_ACCEPTED,
    STATUS_REJECTED,
    STATUS_EXPIRED,
    STATUS_CONVERTED_TO_ORDER,
    STATUS_CANCELLED,
    VERSION_STATUS_DRAFT,
    VERSION_STATUS_LOCKED,
    VERSION_STATUS_SENT,
    VERSION_STATUS_ACCEPTED,
    VERSION_STATUS_REJECTED,
    VERSION_STATUS_SUPERSEDED,
    VERSION_STATUS_CANCELLED,
)
from ..models.role import SCOPE_ALL, SCOPE_DEPARTMENT
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.quotation_repo import LocBaoGia, QuotationRepository
from ..services import quotation_ports
from ..services.exception_gate import (
    DECISIONS as _EXC_DECISIONS,
    DECISION_APPROVED as _EXC_APPROVED,
    approval_status as _exc_approval_status,
    evaluate as _exc_evaluate,
    evaluate_quote as _exc_evaluate_quote,
)
from ..services.sequence_service import SequenceService


_QUY_CACH_IN_NHAN = {
    "mot_mat": "1 mặt",
    "hai_mat": "2 mặt",
    "tu_tro": "trở tự",
    "tro_nhip": "trở nhíp",
}


STATUS_LABELS = {
    # 7 trạng thái nghiệp vụ (redesign-bao-gia §3) — bám đúng chữ chủ đầu tư chốt.
    "draft": "Nháp",
    "pending_approval": "Chờ duyệt",   # đặc thù đã "Trình duyệt", chờ Giám đốc Kinh doanh
    "approved": "Đã duyệt",             # GĐ KD duyệt xong, CHỜ sale gửi khách (tách duyệt/gửi)
    "sent": "Đã gửi khách",             # sale tự gửi (tách khỏi "duyệt")
    "accepted": "Khách đồng ý",   # một tên cho cả chip lẫn tab (07/10/2026, trước là "Khách chốt"/"Khách hàng đồng ý")
    "rejected": "Bị từ chối",   # khách từ chối HOẶC GĐ/TP từ chối đặc thù (phân biệt bằng banner/nhật ký)
    "expired": "Hết hiệu lực",
    "converted_to_order": "Đã lên đơn",
    "cancelled": "Hủy báo giá",
    # Trạng thái riêng của PHIÊN BẢN (không phải header) — pill lịch sử phiên bản dùng chung enum này.
    "locked": "Đã khóa",
    "superseded": "Đã thay thế",
}


def _kho_tp(tp) -> str | None:
    """Khổ thành phẩm dạng người đọc — `"205×145mm"`. None khi chưa khai đủ hai chiều.

    Thay cho cột chữ `kho_thanh_pham` đã DROP ở mig 0144: cột đó chỉ chép lại chính hai số này
    bằng cm ("14,5×20,5 cm") nên giữ hai nguồn là mở đường cho chúng lệch nhau.
    """
    dai = int(getattr(tp, "dai_thanh_pham", 0) or 0)
    rong = int(getattr(tp, "rong_thanh_pham", 0) or 0)
    return f"{dai}×{rong}mm" if dai and rong else None


def _dvt_dong(tp) -> str:
    """ĐVT ghi xuống dòng báo giá của 1 sản phẩm PTG — đơn vị THẬT của phần đó ("cái" cho bìa).

    Đơn vị của CỤM khi in gộp ("cuốn") đi riêng ở `_dvt_nhom_dong`. Trước mg 0264 hai thứ này
    chung một ô: đơn vị cụm bị đè lên mọi dòng cho bản in gộp đọc trúng, đổi lại mọi màn KHÔNG gộp
    (đơn hàng, phiếu giao, khai báo thành phẩm) hiện "Bìa sách — 2.000 cuốn".
    """
    return (getattr(tp, "don_vi_tinh", None) or "cái")


def _dvt_nhom_dong(tp) -> str | None:
    """ĐVT của CỤM cho dòng báo giá — chỉ có nghĩa khi sản phẩm mang nhãn nhóm.

    `dvt_nhom` lạc vào một sản phẩm KHÔNG có nhãn nhóm thì bỏ qua: đơn vị của nó là của nó.
    """
    if not (getattr(tp, "nhom_bao_gia", None) or "").strip():
        return None
    return (getattr(tp, "dvt_nhom", None) or "").strip() or None


def _giay_cac_buoc(tp) -> list[int]:
    """Id giấy của sản phẩm theo thứ tự bước rồi thứ tự vật tư, không lặp. Chưa bước nào mang
    giấy (phiếu trước mg 0419) ⇒ giấy chính `giay_id`."""
    ids: list[int] = []
    for r in sorted(getattr(tp, "thanh_phams", []) or [], key=lambda r: (r.thu_tu or 0, r.id or 0)):
        for v in getattr(r, "vat_tus", []) or []:
            if v.hang_loai == "giay" and v.vat_tu_id not in ids:
                ids.append(v.vat_tu_id)
    if not ids and getattr(tp, "giay_id", None) is not None:
        ids.append(tp.giay_id)
    return ids


def markup_binh_quan(items, status: str) -> float | None:
    """Markup bình quân của báo giá = lợi nhuận ÷ (giá vốn + chiết khấu), cộng số đã làm tròn từng
    dòng — ĐÚNG công thức khối "Giá bán đề xuất" ở chi tiết (`bao-gia-tong.ts`). Cột "Lãi" của danh
    sách dùng hàm này (#11, 18/10/2026: trước đó lấy markup dòng đầu, trước chiết khấu).

    Khách chốt một phần ⇒ chỉ dòng khách lấy; chưa chốt, hoặc chốt trước khi có cờ, ⇒ mọi dòng."""
    da_chot = status in (STATUS_ACCEPTED, STATUS_CONVERTED_TO_ORDER)
    dong = [i for i in items if i.accepted] if da_chot and any(i.accepted for i in items) else list(items)
    if not dong:
        return None
    cost = sum(round(float(i.total_cost_snapshot or 0)) for i in dong)
    ck = sum(round(float(i.discount_amount or 0)) for i in dong)
    sell = sum(round(float(i.selling_price or 0)) for i in dong)
    goc = cost + ck
    return (sell - goc) / goc * 100 if goc > 0 else None


def dien_giai_tu_thanh_phan(db, tp) -> str | None:
    """Bung DIỄN GIẢI quy cách (in ra báo giá) từ 1 'sản phẩm' của bài tính giá.

    Mỗi dòng = 1 gạch đầu dòng trên bản in: khổ · giấy · in · gia công. Là ĐỀ XUẤT — người soạn
    báo giá sửa/bổ sung được (máy không suy ra nổi bồi sóng, đục lỗ, cột thành phẩm…). Thiếu dữ
    liệu thì BỎ dòng đó, KHÔNG bịa (dòng trống trên báo giá gửi khách tệ hơn là không có dòng).
    """
    from ..models.vat_lieu_kho import GiayNguyen

    dong: list[str] = []

    # Khổ thành phẩm: số đo thật. Nhãn chữ `kho_thanh_pham` đã DROP (mig 0144) — nó vốn chỉ chép
    # lại đúng hai số này bằng cm nên bỏ đi không mất gì.
    if _kho_tp(tp):
        dong.append(f"KT: {_kho_tp(tp)}")

    # Giấy: tên + định lượng từ danh mục.
    # GỠ 2026-08-09 (Đợt 4 · K): hậu tố "(khách cấp)". Công ty luôn cấp giấy, nên nhãn đó chỉ còn
    # là câu thừa trên báo giá — và tệ hơn, nó hứa với khách một điều giá không còn phản ánh.
    # Giấy nay là vật tư của BƯỚC (mg 0419): kể MỌI giấy theo thứ tự bước — hộp bồi sóng mà báo giá
    # chỉ ghi tờ couche là hứa với khách một món khác. Phiếu cũ chưa có giấy ở bước thì rơi về
    # `giay_id`. Tên đã chứa định lượng ("COUCHE 150GSM") thì không gắn thêm "150g".
    # Giấy trước, sóng sau (mg 0426) — dù sóng khai ở bước trước In.
    giays = [g for g in (db.get(GiayNguyen, gid) for gid in _giay_cac_buoc(tp)) if g is not None]
    for giay in sorted(giays, key=lambda g: g.loai == "song"):
        g = giay.ten or ""
        if giay.gsm and str(int(giay.gsm)) not in g:
            g = f"{g} {int(giay.gsm)}g".strip()
        if g:
            dong.append(g)

    # In: số màu + quy cách. 2 mặt khác số màu → "4+1 màu"; bằng nhau → "4 màu".
    if getattr(tp, "co_in", False):
        a, b = int(getattr(tp, "so_mau_a", 0) or 0), int(getattr(tp, "so_mau_b", 0) or 0)
        mau = f"{a}+{b}" if b and b != a else (str(a) if a else "")
        if mau:
            nhan = _QUY_CACH_IN_NHAN.get(getattr(tp, "quy_cach_in", None) or "", "")
            dong.append(f"In {mau} màu {nhan}".strip())

    # Gia công sau in: chuỗi công đoạn theo đúng thứ tự người tính giá đã khai.
    gia_cong = [
        (r.ten or "").strip()
        for r in sorted(getattr(tp, "thanh_phams", []) or [], key=lambda r: (r.thu_tu or 0, r.id or 0))
        if (r.ten or "").strip()
    ]
    # Mỗi công đoạn một dòng — không nối bằng "·" (#68).
    dong.extend(gia_cong)

    return "\n".join(dong) or None


class QuotationError(Exception):
    """Base for quotation domain errors."""
    pass


class QuotationValidationError(QuotationError):
    """A field failed validation."""
    pass


class QuotationNotFound(QuotationError):
    """No quotation with that id."""
    pass


class QuotationForbidden(QuotationError):
    """The quotation exists but is outside the caller's data scope."""
    pass


class QuotationConflict(QuotationError):
    """Optimistic-lock or illegal state transition."""
    pass


class QuotationLocked(QuotationError):
    """Attempt to edit a locked quotation."""
    pass


class QuotationService:
    def __init__(
        self,
        quotations: QuotationRepository,
        audit: AuditLogRepository,
        customers=None,
        sequence: SequenceService | None = None,
    ) -> None:
        self.quotations = quotations
        self.audit = audit
        self._customers = customers
        self.sequence = sequence

    def _customer_display_name(self, customer_id: int | None) -> str | None:
        if customer_id is None or self._customers is None:
            return None
        c = self._customers.get_by_id(customer_id)
        return c.name if c else None

    def _customer_defaults(self, customer_id: int | None) -> dict:
        """Auto-fill từ CRM (redesign-bao-gia §4): người liên hệ CHÍNH (`CustomerContact.is_primary`)
        + ĐC giao MẶC ĐỊNH (`CustomerAddress.is_default`). Repo list_* đã xếp is_primary/is_default
        lên đầu; fallback phần tử đầu nếu chưa đặt cờ. Rỗng nếu không có khách/repo."""
        out = {
            "contact_name": None, "contact_phone": None, "contact_title": None,
            "contact_email": None, "delivery_address": None,
        }
        if customer_id is None or self._customers is None:
            return out
        contacts = list(getattr(self._customers, "list_contacts", lambda _cid: [])(customer_id))
        primary = next((c for c in contacts if c.is_primary), contacts[0] if contacts else None)
        if primary is not None:
            out.update(
                contact_name=primary.name, contact_phone=primary.phone,
                contact_title=primary.title, contact_email=primary.email,
            )
        else:
            # Chưa có danh bạ liên hệ riêng → lấy tạm liên hệ ngay trên hồ sơ khách
            # (Customer.contact_name / phone) để ô "Người liên hệ" không trống.
            cust = self._customers.get_by_id(customer_id)
            if cust is not None:
                out.update(
                    contact_name=getattr(cust, "contact_name", None),
                    contact_phone=getattr(cust, "phone", None),
                    contact_email=getattr(cust, "email", None),
                )
        addrs = list(getattr(self._customers, "list_addresses", lambda _cid: [])(customer_id))
        default_addr = next((a for a in addrs if a.is_default), addrs[0] if addrs else None)
        if default_addr is not None:
            out["delivery_address"] = default_addr.address
        return out

    # --- Khách hàng KẾ THỪA từ phiếu tính giá (chủ dự án chốt 04/10/2026) -------------------
    # Khách, điểm giao, người nhận, ghi chú nội bộ chọn Ở PHIẾU; báo giá chỉ chép, không sửa được.
    KE_THUA_TU_PHIEU = (
        "customer_id", "delivery_address", "contact_name_snapshot", "contact_phone_snapshot",
        "contact_title_snapshot", "contact_email_snapshot", "internal_note",
    )

    def chep_khach_tu_phieu(self, quote: Quote, ptg) -> None:
        """Chép khách + điểm giao + người nhận + ghi chú (→ `internal_note`) từ phiếu sang báo giá.

        NV phụ trách báo giá = người phụ trách KHÁCH (05/10/2026), không phải người bấm tạo: trợ lý
        soạn hộ cho khách của Huyên thì báo giá đứng tên Huyên — đơn lên từ báo giá chép tên này,
        hoa hồng chụp theo nó. Khách chưa gán ai thì giữ người soạn."""
        from ..repositories.org_scope import chu_cua

        quote.customer_id = ptg.customer_id
        quote.salesperson_id = chu_cua(self.quotations.db, ptg.customer_id, quote.salesperson_id)
        quote.customer_name_snapshot = self._customer_display_name(ptg.customer_id)
        quote.delivery_address = ptg.delivery_address
        quote.contact_name_snapshot = ptg.contact_name_snapshot
        quote.contact_phone_snapshot = ptg.contact_phone_snapshot
        quote.contact_title_snapshot = ptg.contact_title_snapshot
        quote.contact_email_snapshot = ptg.contact_email_snapshot
        quote.internal_note = ptg.ghi_chu

    def dong_bo_nhap_theo_phieu(self, ptg, *, actor) -> Quote | None:
        """Phiếu vừa lưu ⇒ báo giá NHÁP của phiếu theo ngay: khách/điểm giao/người nhận/ghi chú VÀ
        số lượng/giá vốn từng sản phẩm (`_ap_so_tu_phieu`). KHÔNG commit — người gọi chốt một lần.

        Báo giá đã qua Nháp (chờ duyệt, đã gửi khách, ...) GIỮ NGUYÊN: khách đã/đang nhận tờ báo giá
        với số đó. Màn báo giá báo "phiếu đã đổi" (`phieu_doi`) và cho tạo phiên bản mới theo phiếu
        (`resync_from_ptg`). `ptg.thanh_phans` phải nạp sẵn (kèm `thanh_phams`)."""
        q = self.quotations.cua_phieu(ptg.id)
        if q is None or q.status != STATUS_DRAFT:
            return None
        self.chep_khach_tu_phieu(q, ptg)
        version = self.quotations.db.get(QuoteVersion, q.current_version_id) if q.current_version_id else None
        doi_so = version is not None and self._ap_so_tu_phieu(version, ptg)
        self.audit.create_collapsing(
            actor_user_id=actor.id, action="update_quote", target=f"quote:{q.id}",
            detail=f"{q.quote_number}: cập nhật theo phiếu tính giá {ptg.ma}"
            + (" (số lượng / giá vốn)" if doi_so else ""),
            commit=False,
        )
        return q

    # --- Số lượng / giá vốn THEO PHIẾU (chốt 05/10/2026) ---------------------------------------
    @staticmethod
    def _sp_phieu(ptg) -> list:
        return sorted(ptg.thanh_phans, key=lambda t: (t.thu_tu or 0, t.id or 0))

    @staticmethod
    def _sl_sp(tp, ptg) -> int:
        return int(tp.so_luong) or int(ptg.so_luong) or 1     # 0 = lấy SL mặc định phiếu

    def _nap_giay(self, tps) -> list:
        """Nạp một lượt mọi giấy các sản phẩm dùng — `dien_giai_tu_thanh_phan` gọi `db.get` từng
        cái, có sẵn trong identity map thì khỏi một câu SQL mỗi sản phẩm. Identity map giữ tham
        chiếu YẾU: người gọi phải giữ list trả về suốt vòng lặp, buông ra là bị dọn."""
        from sqlalchemy import select

        from ..models.vat_lieu_kho import GiayNguyen

        ids = {gid for tp in tps for gid in _giay_cac_buoc(tp)}
        if not ids:
            return []
        return self.quotations.db.execute(select(GiayNguyen).where(GiayNguyen.id.in_(ids))).scalars().all()

    def phieu_doi(self, version, ptg) -> bool:
        """Số lượng / giá vốn / danh sách sản phẩm của phiếu KHÁC các dòng của phiên bản này."""
        hien = {it.phieu_thanh_phan_id: it for it in version.items if it.phieu_thanh_phan_id is not None}
        tps = self._sp_phieu(ptg)
        if {tp.id for tp in tps} != set(hien):
            return True
        return any(
            int(hien[tp.id].quantity) != self._sl_sp(tp, ptg)
            or abs(float(hien[tp.id].total_cost_snapshot or 0) - float(tp.gia_von_tp or 0)) > 0.5
            for tp in tps
        )

    def _gia_dong(self, it: QuoteItem, *, cost: float, qty: int) -> None:
        """Tính lại tiền một dòng với giá vốn / SL mới, GIỮ ý người soạn: % chiết khấu (trên giá vốn),
        % lợi nhuận (trên vốn + chiết khấu), giá bán GÕ TAY (giữ nguyên số đã gõ), VAT."""
        cu = float(it.selling_price or 0)
        von_cu = float(it.total_cost_snapshot or 0)
        pct_ck = (float(it.discount_amount or 0) / von_cu * 100) if von_cu > 0 else 0.0
        p = self.calculate_pricing(
            total_cost=cost, margin_percent=float(it.margin_percent or 0),
            manual_selling_price=cu if it.gia_go_tay else None,
            discount_percent=pct_ck, vat_percent=float(it.vat_percent or 0), quantity=qty,
        )
        it.quantity = qty
        it.total_cost_snapshot = cost
        it.margin_percent = p["margin_percent"]
        it.selling_price = p["selling_price"]
        it.unit_price = p["unit_price"]
        it.discount_amount = p["discount_amount"]
        it.vat_amount = p["vat_amount"]
        it.final_amount = p["final_amount"]

    def _cong_tong(self, version) -> None:
        """Tổng của phiên bản — CÙNG phép tính với đơn hàng (lỗi #62, 19/10/2026): giá bán tròn từng
        dòng, gồm VAT = ⌊Σ giá tròn·(100 + VAT%)/100⌋ (`order_repo._line_total_with_vat`). Khách chốt
        MỘT PHẦN ⇒ chỉ dòng khách lấy (#61), như khối tổng ở chi tiết và như đơn kéo sang; phiên bản
        chốt trước khi có cờ (không dòng nào `accepted`) thì cộng hết."""
        its = list(version.items)
        if version.status == VERSION_STATUS_ACCEPTED and any(i.accepted for i in its):
            its = [i for i in its if i.accepted]
        ban = [int(round(float(i.selling_price or 0))) for i in its]
        gom_vat_x100 = sum(b * (100 + int(round(float(i.vat_percent or 0)))) for b, i in zip(ban, its))
        version.total_cost_snapshot = sum(float(i.total_cost_snapshot or 0) for i in its)
        version.subtotal_amount = sum(ban)
        version.discount_amount = sum(float(i.discount_amount or 0) for i in its)
        version.final_amount = gom_vat_x100 // 100
        version.vat_amount = version.final_amount - version.subtotal_amount

    def _ap_so_tu_phieu(self, version, ptg) -> bool:
        """Cập nhật TẠI CHỖ dòng của `version` theo sản phẩm của phiếu, khớp theo
        `phieu_thanh_phan_id` (id sản phẩm ỔN ĐỊNH khi lưu phiếu, xem `_ghi_thanh_phans`).

        Dòng khớp: đổi SL, giá vốn, tên, khổ, nhóm, ĐVT; tiền tính lại GIỮ markup / giá gõ tay /
        % chiết khấu / VAT; diễn giải, ảnh minh họa, ghi chú dòng GIỮ NGUYÊN (người soạn có thể đã
        sửa). Sản phẩm mới ⇒ thêm dòng (markup mặc định 20%). Sản phẩm đã xoá khỏi phiếu ⇒ bỏ dòng.
        Pin chết (sản phẩm bị dựng lại, id mới) mà TÊN trùng một sản phẩm chưa có dòng ⇒ coi là
        cùng sản phẩm: nối lại pin, giữ nguyên ý người soạn.
        Tên / khổ / nhóm / ĐVT luôn theo phiếu. Trả True nếu có gì đổi về số / danh sách dòng."""
        doi_so = self.phieu_doi(version, ptg)
        db = self.quotations.db
        tps = self._sp_phieu(ptg)
        con = {tp.id for tp in tps}
        hien = {it.phieu_thanh_phan_id: it for it in version.items if it.phieu_thanh_phan_id in con}
        mo_coi = [it for it in version.items if it.phieu_thanh_phan_id not in hien]
        for tp in tps:
            if tp.id in hien:
                continue
            ten = (tp.ten or ptg.ten_san_pham or "").strip().casefold()
            cu = next((it for it in mo_coi if (it.product_name or "").strip().casefold() == ten), None)
            if ten and cu is not None:
                mo_coi.remove(cu)
                cu.phieu_thanh_phan_id = tp.id
                hien[tp.id] = cu
        for it in mo_coi:
            version.items.remove(it)       # delete-orphan xoá dòng
        _giay = self._nap_giay([tp for tp in tps if tp.id not in hien])  # noqa: F841 — giữ trong identity map
        vat_mac_dinh = next((float(i.vat_percent) for i in version.items), 10.0)
        for pos, tp in enumerate(tps):
            qty, cost = self._sl_sp(tp, ptg), float(tp.gia_von_tp or 0)
            it = hien.get(tp.id)
            if it is None:
                p = self.calculate_pricing(total_cost=cost, margin_percent=20.0, vat_percent=vat_mac_dinh, quantity=qty)
                it = QuoteItem(
                    quote_version_id=version.id, phieu_thanh_phan_id=tp.id,
                    dien_giai=dien_giai_tu_thanh_phan(db, tp), margin_percent=20.0,
                    vat_percent=vat_mac_dinh, quantity=qty, total_cost_snapshot=cost,
                    selling_price=p["selling_price"], unit_price=p["unit_price"],
                    discount_amount=0, vat_amount=p["vat_amount"], final_amount=p["final_amount"],
                )
                version.items.append(it)
            elif int(it.quantity) != qty or abs(float(it.total_cost_snapshot or 0) - cost) > 0.5:
                self._gia_dong(it, cost=cost, qty=qty)
            it.line_no = pos + 1
            it.product_type = tp.loai_thanh_phan or "san_pham"
            it.product_name = tp.ten or ptg.ten_san_pham or f"Sản phẩm {pos + 1}"
            it.product_spec_text = _kho_tp(tp)
            it.nhom = getattr(tp, "nhom_bao_gia", None) or None
            it.unit = _dvt_dong(tp)
            it.dvt_nhom = _dvt_nhom_dong(tp)
        if doi_so:
            db.flush()
            self._cong_tong(version)
        return doi_so

    def _nap_phieu(self, phieu_tinh_gia_id: int):
        """Phiếu kèm sản phẩm + chuỗi công đoạn (diễn giải đọc tên công đoạn) — hai câu SELECT
        cho cả phiếu, không lazy-load từng sản phẩm."""
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from ..models.phieu_tinh_gia import PhieuThanhPhan, PhieuTinhGia

        return self.quotations.db.execute(
            select(PhieuTinhGia).where(PhieuTinhGia.id == phieu_tinh_gia_id)
            .options(selectinload(PhieuTinhGia.thanh_phans).selectinload(PhieuThanhPhan.thanh_phams))
        ).scalar_one_or_none()

    @staticmethod
    def _chep_dong(nguon, dich) -> None:
        """Chép mọi dòng của phiên bản `nguon` sang `dich` NGUYÊN TRẠNG: giá gõ tay, diễn giải,
        ảnh minh họa, nhóm/ĐVT cụm, ghi chú — bản v(n+1) in ra phải giống bản khách đã nhận."""
        for item in nguon.items:
            dich.items.append(QuoteItem(
                phieu_thanh_phan_id=item.phieu_thanh_phan_id,
                line_no=item.line_no,
                product_type=item.product_type,
                product_name=item.product_name,
                product_spec_text=item.product_spec_text,
                dien_giai=item.dien_giai,
                product_spec_snapshot_json=item.product_spec_snapshot_json,
                nhom=item.nhom,
                anh_minh_hoa=item.anh_minh_hoa,
                quantity=item.quantity,
                unit=item.unit,
                dvt_nhom=item.dvt_nhom,
                total_cost_snapshot=item.total_cost_snapshot,
                margin_percent=item.margin_percent,
                selling_price=item.selling_price,
                gia_go_tay=item.gia_go_tay,
                unit_price=item.unit_price,
                discount_amount=item.discount_amount,
                vat_percent=item.vat_percent,
                vat_amount=item.vat_amount,
                final_amount=item.final_amount,
                note=item.note,
                po_code=item.po_code,
            ))

    # --- Pricing calculation engine (Phase 2B) --------------------------------
    @staticmethod
    def calculate_pricing(
        total_cost: float,
        margin_percent: float,
        manual_selling_price: float | None = None,
        manual_unit_price: float | None = None,
        discount_amount: float = 0.0,
        discount_percent: float = 0.0,
        vat_percent: float = 0.0,
        rounding: str = "no_rounding",
        quantity: int = 1,
        profit_amount: float | None = None,
    ) -> dict[str, Any]:
        """Giá bán = giá vốn + tiền chiết khấu + tiền lợi nhuận (chủ chốt 18/10/2026).

        - Tiền chiết khấu = `discount_percent` × giá vốn, hoặc số tiền `discount_amount` gõ thẳng
          (số tiền > 0 thắng). CỘNG vào giá bán — khách trả đủ, khoản này sau đó hoàn lại cho khách.
        - Tiền lợi nhuận = `margin_percent` × (giá vốn + chiết khấu), hoặc `profit_amount` gõ thẳng.
        - Giá bán gõ tay (`manual_*`) thắng cả hai: chiết khấu giữ nguyên, lợi nhuận là phần còn lại.
        - Giá bán chính là số tiền trước VAT khách phải trả; VAT tính trên nó. `discount_amount` trả
          ra là phần chiết khấu NẰM TRONG giá bán (không còn là khoản trừ)."""
        quantity = max(1, quantity)
        total_cost = float(total_cost)

        # 1. Chiết khấu (tiền) — cộng vào giá bán
        if float(discount_amount) > 0:
            chiet_khau = float(discount_amount)
        else:
            chiet_khau = total_cost * max(0.0, float(discount_percent)) / 100.0
        chiet_khau = float(round(max(0.0, chiet_khau)))
        goc = total_cost + chiet_khau

        # 2. Giá bán
        if manual_selling_price is not None and manual_selling_price > 0:
            selling_price = float(manual_selling_price)
        elif manual_unit_price is not None and manual_unit_price > 0:
            selling_price = float(manual_unit_price) * quantity
        else:
            if profit_amount is not None:
                loi_nhuan = float(profit_amount)
            else:
                loi_nhuan = goc * max(0.0, float(margin_percent)) / 100.0
            selling_price = goc + float(round(loi_nhuan))

        # 3. Rounding
        if rounding == "round_up_1000":
            selling_price = float(math.ceil(selling_price / 1000.0) * 1000)
        elif rounding == "round_up_5000":
            selling_price = float(math.ceil(selling_price / 5000.0) * 5000)
        elif rounding == "round_up_10000":
            selling_price = float(math.ceil(selling_price / 10000.0) * 10000)

        # 4. Lợi nhuận thực = phần còn lại sau vốn và chiết khấu; % trên (vốn + chiết khấu)
        loi_nhuan = selling_price - goc
        margin_pct = (loi_nhuan / goc * 100.0) if goc > 0 else 0.0
        actual_margin = ((selling_price - total_cost) / selling_price) * 100.0 if selling_price > 0 else 0.0

        # 5. VAT trên giá bán
        subtotal = max(0.0, selling_price)
        vat_amount = subtotal * (max(0.0, float(vat_percent)) / 100.0)
        final_amount = subtotal + vat_amount
        unit_price = selling_price / quantity

        return {
            "selling_price": selling_price,
            "unit_price": unit_price,
            "actual_margin": actual_margin,
            "margin_percent": round(margin_pct, 2),
            "profit_amount": loi_nhuan,
            "discount_amount": chiet_khau,
            "subtotal": subtotal,
            "vat_amount": vat_amount,
            "final_amount": final_amount,
        }

    # --- reads ----------------------------------------------------------------
    def list_quotations(
        self,
        *,
        scope: str,
        actor,
        q: str | None = None,
        status: str | None = None,
        sort: str = "-created_at",
        page: int = 1,
        size: int = 20,
        nguoi: int | None = None,
        loc: LocBaoGia | None = None,
    ):
        return self.quotations.list(
            scope=scope, actor=actor, q=q, status=status, sort=sort, page=page, size=size,
            nguoi=nguoi, loc=loc,
        )

    def get_quotation(self, *, quotation_id: int, scope: str, actor) -> Quote:
        quote = self.quotations.get_by_id(quotation_id)
        if quote is None:
            raise QuotationNotFound("Không tìm thấy báo giá.")
        if not self.quotations.can_access(quote=quote, scope=scope, actor=actor):
            raise QuotationForbidden("Bạn không có quyền xem báo giá này.")
        return quote

    def stats(
        self, *, scope: str, actor, nguoi: int | None = None, q: str | None = None,
        loc: LocBaoGia | None = None,
    ) -> dict:
        return self.quotations.stats(scope=scope, actor=actor, nguoi=nguoi, q=q, loc=loc)

    def dem_theo_khach(self, *, scope: str, actor) -> list[tuple[int, str, int]]:
        return self.quotations.dem_theo_khach(scope=scope, actor=actor)

    def dem_theo_nguoi_duyet(self, *, scope: str, actor) -> list[tuple[int, str, int]]:
        return self.quotations.dem_theo_nguoi_duyet(scope=scope, actor=actor)

    def tom_tat_duyet(self, rows: list[Quote]) -> dict[int, dict]:
        return self.quotations.tom_tat_duyet(rows)

    def don_hang_cua(self, rows: list[Quote]) -> dict[int, tuple[int, str, str]]:
        return self.quotations.don_hang_cua([r.id for r in rows])

    def dem_theo_nguoi(self, *, scope: str, actor) -> dict[int, int]:
        return self.quotations.dem_theo_nguoi(scope=scope, actor=actor)

    def pending_approval_count(self, *, scope: str, actor, can_approve: bool) -> int:
        """Badge 'chờ tôi duyệt': CHỈ người có quyền duyệt đặc thù mới có số; người khác = 0."""
        if not can_approve:
            return 0
        return self.quotations.count_pending_approval(scope=scope, actor=actor)

    def notify_summary(self, *, scope: str, actor, can_approve: bool) -> dict:
        """Số nuôi real-time badge/toast luồng gửi duyệt (SSE snapshot + REST fallback):
        - `pending_approval_count`: số chờ TÔI duyệt (chỉ người duyệt mới có số).
        - `my_decided_unseen`: số báo giá của TÔI (người soạn) vừa được GĐ quyết mà tôi chưa xem."""
        return {
            "pending_approval_count": self.pending_approval_count(
                scope=scope, actor=actor, can_approve=can_approve
            ),
            "my_decided_unseen": self.quotations.count_my_decided_unseen(actor.id),
        }

    def mark_decisions_seen(self, *, actor) -> None:
        """Người soạn xác nhận đã xem các quyết định duyệt/từ chối → đóng badge/toast phía Sale."""
        self.quotations.mark_my_decisions_seen(actor.id)

    def user_names(self, user_ids: set[int]) -> dict[int, str]:
        """Map user_id → tên hiển thị (người phụ trách trên list)."""
        ids = {i for i in user_ids if i}
        if not ids:
            return {}
        from sqlalchemy import select as _select
        from ..models.user import User as _User
        return dict(
            self.quotations.db.execute(
                _select(_User.id, _User.name).where(_User.id.in_(ids))
            ).all()
        )

    def activity(self, *, quotation_id: int, scope: str, actor) -> list[dict]:
        """Nhật ký tương tác THẬT của 1 báo giá (feed Hoạt động) — ai làm gì, khi nào. Đọc audit
        log theo target `quote:{id}` (mọi vai trò sale/TP/GĐ đụng cùng phiếu đều để lại dấu vết),
        cũ→mới ĐẢO thành mới→cũ, kèm NGƯỜI thao tác. RBAC: qua get_quotation (đúng phạm vi).

        Người thao tác ghi theo HỒ SƠ ("Ban giám đốc · Giám đốc · Nguyễn Văn Giám") — xem
        `actor_display`; KHÔNG dùng `user_names` (tên tài khoản, chỉ hợp cho cột phụ trách ở list)."""
        from .actor_display import actor_labels

        quote = self.get_quotation(quotation_id=quotation_id, scope=scope, actor=actor)
        rows = self.audit.list_by_target(f"quote:{quote.id}", limit=200)
        names = actor_labels(self.quotations.db, {r.actor_user_id for r in rows if r.actor_user_id})
        return [
            {
                "action": r.action,
                "actor_name": names.get(r.actor_user_id) if r.actor_user_id else None,
                "detail": r.detail,
                "at": r.created_at,
            }
            for r in rows
        ]

    def effective_contact(self, quote: Quote) -> dict:
        """Người liên hệ để HIỂN THỊ ở chi tiết báo giá: ưu tiên SNAPSHOT (đã đóng băng khi
        gửi/khóa); nếu snapshot trống (phiếu cũ / khách chưa có danh bạ) thì lấy tạm liên hệ chính
        hiện tại của khách để ô "Người liên hệ" không trống. Không ghi đè snapshot (chỉ để xem)."""
        if quote.contact_name_snapshot or quote.contact_phone_snapshot:
            return {
                "name": quote.contact_name_snapshot,
                "phone": quote.contact_phone_snapshot,
                "title": quote.contact_title_snapshot,
                "email": quote.contact_email_snapshot,
            }
        d = self._customer_defaults(quote.customer_id)
        return {
            "name": d["contact_name"], "phone": d["contact_phone"],
            "title": d["contact_title"], "email": d["contact_email"],
        }

    def version_history(self, quote: Quote) -> list[QuoteVersion]:
        return self.quotations.versions_of(quote.quote_number)

    def customer_display(self, quote: Quote):
        if quote.customer_id is None or self._customers is None:
            return None
        return quotation_ports.CustomerRefAdapter(self._customers).get_customer(quote.customer_id)

    def phieu_tinh_gia_ref(self, quote: Quote) -> dict:
        """Tham chiếu Phiếu tính giá NGUỒN (redesign-bao-gia §6, link mở phiếu). {id, ma} — id=None
        cho báo giá cũ chưa neo phiếu nào."""
        if quote.phieu_tinh_gia_id is None:
            return {"id": None, "ma": None}
        from ..models.phieu_tinh_gia import PhieuTinhGia
        ptg = self.quotations.db.get(PhieuTinhGia, quote.phieu_tinh_gia_id)
        return {"id": quote.phieu_tinh_gia_id, "ma": ptg.ma if ptg else None}

    def phieu_doi_theo(self, quote: Quote, version) -> bool:
        """Phiếu nguồn đã đổi số lượng / giá vốn / sản phẩm so với phiên bản đang xem — màn báo giá
        hiện băng kèm nút cập nhật. Đã lên đơn / đã huỷ thì thôi báo (không đồng bộ được nữa)."""
        if (quote.phieu_tinh_gia_id is None or version is None
                or quote.status in (STATUS_CONVERTED_TO_ORDER, STATUS_CANCELLED)):
            return False
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from ..models.phieu_tinh_gia import PhieuTinhGia

        ptg = self.quotations.db.execute(
            select(PhieuTinhGia).where(PhieuTinhGia.id == quote.phieu_tinh_gia_id)
            .options(selectinload(PhieuTinhGia.thanh_phans))
        ).scalar_one_or_none()
        return ptg is not None and self.phieu_doi(version, ptg)

    # --- writes ---------------------------------------------------------------
    def create_quotation(
        self,
        *,
        customer_id: int | None,
        phieu_tinh_gia_id: int | None = None,
        margin_percent: float | None = None,
        valid_until: date | None = None,
        terms_text: str | None = None,
        customer_note: str | None = None,
        internal_note: str | None = None,
        actor,
    ) -> Quote:
        """Tạo báo giá TỪ 1 Phiếu tính giá. Từ Đợt 5 đây là nguồn DUY NHẤT — đường Estimate
        (cụm tính giá đời cũ) đã gỡ hẳn, không còn `estimate_id`/`picks`."""
        if phieu_tinh_gia_id is None:
            raise QuotationValidationError(
                "Báo giá phải xuất phát từ một Phiếu tính giá — chọn phiếu trước khi tạo."
            )
        if valid_until and valid_until < date.today():
            raise QuotationValidationError("Hạn hiệu lực không được ở quá khứ.")
        # Mặc định hạn hiệu lực = 30 ngày kể từ hôm nay (ngày tạo phiên bản mới nhất). Để trống chủ ý
        # (không truyền) → auto +30; muốn "đến khi có thông báo" thì xoá ở màn chi tiết sau.
        if valid_until is None:
            valid_until = date.today() + timedelta(days=30)

        # Điều khoản: caller bỏ trống → điền sẵn bộ mặc định để sale sửa ngay trên màn báo giá.
        terms_text = (terms_text or "").strip() or DEFAULT_TERMS

        return self._create_from_ptg(
            phieu_tinh_gia_id=phieu_tinh_gia_id,
            customer_id=customer_id,
            margin_percent=margin_percent,
            valid_until=valid_until,
            terms_text=terms_text,
            customer_note=customer_note,
            internal_note=internal_note,
            actor=actor,
        )

    def _create_from_ptg(
        self, *, phieu_tinh_gia_id: int, customer_id: int | None, margin_percent: float | None,
        valid_until: date | None, terms_text, customer_note, internal_note, actor,
    ) -> Quote:
        """BG-1: tạo báo giá TỪ 1 Phiếu tính giá (PTG) — 1 dòng / mỗi "sản phẩm" (PhieuThanhPhan). Giá
        vốn KHÓA = `gia_von_tp` (snapshot copy-on-write, sửa PTG sau không đổi báo giá). SL = so_luong
        sản phẩm (0 → SL mặc định phiếu). Markup/VAT MẶC ĐỊNH (PhieuThanhPhan không có 2 field này) —
        sales chỉnh sau. MỘT phiếu ↔ MỘT báo giá, mọi trạng thái. Ghi một lần commit."""
        from sqlalchemy.exc import IntegrityError

        db = self.quotations.db
        ptg = self._nap_phieu(phieu_tinh_gia_id)
        if ptg is None:
            raise QuotationValidationError("Không tìm thấy phiếu tính giá.")
        if not ptg.thanh_phans:
            raise QuotationValidationError("Phiếu tính giá chưa có sản phẩm nào để báo giá.")
        # Khách chọn Ở PHIẾU (04/10/2026) — `customer_id` của payload bị bỏ qua.
        if ptg.customer_id is None:
            raise QuotationValidationError(
                "Phiếu tính giá chưa chọn khách hàng — chọn khách ở phiếu tính giá rồi mới lập báo giá."
            )

        # MỘT phiếu ↔ MỘT báo giá, mọi trạng thái (chốt 04/10/2026; DB có UNIQUE, mg 0365).
        # Điều chỉnh báo giá đã có → "Tạo phiên bản mới" TRONG nó; báo giá khác → nhân bản phiếu.
        da_co = self.quotations.cua_phieu(phieu_tinh_gia_id)
        if da_co is not None:
            raise QuotationConflict(
                f"Phiếu {ptg.ma} đã có báo giá {da_co.quote_number} — mỗi phiếu tính giá chỉ một "
                "báo giá. Sửa trong báo giá đó, hoặc nhân bản phiếu để lập báo giá khác."
            )
        quote_number = self.sequence.generate_code("quotation") if self.sequence else "BG26-0001"
        quote = Quote(
            quote_number=quote_number,
            phieu_tinh_gia_id=phieu_tinh_gia_id,
            salesperson_id=actor.id,
            status=STATUS_DRAFT,
            valid_until=valid_until,
            terms_text=terms_text,
            customer_note=customer_note,
            created_by=actor.id,
        )
        # Khách, điểm giao, người nhận, ghi chú nội bộ: chép từ PHIẾU (chọn ở phiếu, chỉ đọc ở đây).
        self.chep_khach_tu_phieu(quote, ptg)
        db.add(quote)
        try:
            db.flush()
        except IntegrityError:
            # Hai người cùng bấm "Lập báo giá" một lúc: UNIQUE (mg 0365) chặn người thứ hai.
            db.rollback()
            raise QuotationConflict(
                f"Phiếu {ptg.ma} vừa có báo giá — mỗi phiếu tính giá chỉ một báo giá."
            ) from None

        version = QuoteVersion(
            quote_id=quote.id, version_number=1, status=VERSION_STATUS_DRAFT, created_by=actor.id,
        )
        db.add(version)
        db.flush()

        default_margin = float(margin_percent) if margin_percent is not None else 20.0
        self._fill_version_from_ptg(
            version, ptg, margin_by_index=None, default_margin=default_margin, default_vat=10.0,
        )
        quote.current_version_id = version.id

        self.audit.create(  # commit MỘT lần: báo giá + phiên bản + dòng + nhật ký
            actor_user_id=actor.id, action="create_quote", target=f"quote:{quote.id}",
            detail=f"Tạo báo giá {quote.quote_number} v1 từ phiếu tính giá {ptg.ma} "
            f"({len(ptg.thanh_phans)} sản phẩm)",
        )
        return quote

    def _fill_version_from_ptg(
        self, version, ptg, *, margin_by_index: dict[int, float] | None,
        default_margin: float, default_vat: float,
    ) -> None:
        """Dựng dòng báo giá TỪ các 'sản phẩm' (PhieuThanhPhan) của PTG vào 1 version + gộp tổng.
        Giá vốn KHÓA = gia_von_tp; SL = so_luong sản phẩm (0 → SL mặc định phiếu). `margin_by_index`
        GIỮ markup theo VỊ TRÍ dòng (0-based) khi ĐỒNG BỘ LẠI — KHÔNG theo phieu_thanh_phan_id. (Id
        thành phần ỔN ĐỊNH từ 07/09/2026, nhưng vị trí vẫn là khoá đúng hơn: bản báo giá cũ có thể
        đã sửa tay, dòng thêm tay không mang pin nào cả.) Dòng chưa có ở bản cũ → dùng default_margin. Duyệt theo thứ tự
        (thu_tu, id) cho ổn định — khớp cách engine sắp xếp."""
        subtotal = discount = vat = final = total_cost = 0.0
        tps = self._sp_phieu(ptg)
        _giay = self._nap_giay(tps)  # noqa: F841 — giữ trong identity map
        for pos, tp in enumerate(tps):
            i = pos + 1
            qty = int(tp.so_luong) or int(ptg.so_luong) or 1     # 0 = lấy SL mặc định phiếu
            cost = float(tp.gia_von_tp or 0)
            margin = (margin_by_index or {}).get(pos, default_margin)
            pricing = self.calculate_pricing(
                total_cost=cost, margin_percent=margin, vat_percent=default_vat, quantity=qty,
            )
            self.quotations.db.add(QuoteItem(
                quote_version_id=version.id,
                phieu_thanh_phan_id=tp.id,
                line_no=i,
                product_type=tp.loai_thanh_phan or "san_pham",
                product_name=tp.ten or ptg.ten_san_pham or f"Sản phẩm {i}",
                product_spec_text=_kho_tp(tp),
                # Đông cứng lúc tạo: sửa PTG về sau KHÔNG đổi bản đã gửi khách (đồng bộ → version mới).
                dien_giai=dien_giai_tu_thanh_phan(self.quotations.db, tp),
                # Nhãn nhóm: chỉ để BẢN IN gom dòng (ruột + bìa → 1 dòng "quyển sách"). Dữ liệu
                # vẫn 1 dòng/thành phần để markup riêng + mạch xuống sản xuất không đứt.
                nhom=(getattr(tp, "nhom_bao_gia", None) or None),
                quantity=qty,
                # ĐVT chảy từ sản phẩm PTG: `unit` = đơn vị THẬT của phần này (bìa "cái"), còn
                # `dvt_nhom` = đơn vị cụm cho bản in gộp ("cuốn"). Nhóm chưa chọn ⇒ NULL, bản in
                # rơi về ĐVT của dòng đầu cụm như luật cũ.
                unit=_dvt_dong(tp),
                dvt_nhom=_dvt_nhom_dong(tp),
                total_cost_snapshot=cost,
                margin_percent=margin,
                selling_price=pricing["selling_price"],
                unit_price=pricing["unit_price"],
                discount_amount=pricing["discount_amount"],
                vat_percent=default_vat,
                vat_amount=pricing["vat_amount"],
                final_amount=pricing["final_amount"],
            ))
            subtotal += pricing["selling_price"]
            discount += pricing["discount_amount"]
            vat += pricing["vat_amount"]
            final += pricing["final_amount"]
            total_cost += cost
        version.total_cost_snapshot = total_cost
        version.subtotal_amount = subtotal
        version.discount_amount = discount
        version.vat_amount = vat
        version.final_amount = final

    def resync_from_ptg(self, *, phieu_tinh_gia_id: int, scope: str, actor) -> tuple[Quote, str]:
        """Báo giá của phiếu theo số lượng / giá vốn / sản phẩm HIỆN TẠI của phiếu.

        NHÁP → cập nhật TẠI CHỖ (`_ap_so_tu_phieu`). Đã qua nháp (chờ duyệt, đã duyệt, đã gửi, khách
        đồng ý/từ chối, hết hạn) → PHIÊN BẢN MỚI v(n+1) nháp: chép nguyên các dòng bản cũ rồi áp số
        của phiếu, bản cũ → superseded. Cả hai đường GIỮ markup, giá gõ tay, % chiết khấu, VAT, diễn
        giải, ảnh minh họa của từng dòng. Đã lên đơn / đã huỷ thì CHẶN.
        Trả `(quote, mode)` với mode ∈ {"draft_synced","new_version"}. Ghi một lần commit."""
        db = self.quotations.db
        ptg = self._nap_phieu(phieu_tinh_gia_id)
        if ptg is None:
            raise QuotationValidationError("Không tìm thấy phiếu tính giá.")
        if not ptg.thanh_phans:
            raise QuotationValidationError("Phiếu tính giá chưa có sản phẩm nào để báo giá.")

        quote = self.quotations.cua_phieu(phieu_tinh_gia_id)
        if quote is None:
            raise QuotationConflict("Phiếu tính giá này chưa có báo giá.")
        # RBAC scope: chỉ đồng bộ báo giá trong phạm vi của người thao tác.
        self.get_quotation(quotation_id=quote.id, scope=scope, actor=actor)
        if quote.status == STATUS_CONVERTED_TO_ORDER:
            raise QuotationConflict(
                f"Báo giá {quote.quote_number} đã lên đơn hàng — không thể đồng bộ lại từ phiếu tính giá."
            )
        if quote.status == STATUS_CANCELLED:
            raise QuotationConflict(
                f"Báo giá {quote.quote_number} đã huỷ — không đồng bộ lại từ phiếu tính giá."
            )
        current = db.get(QuoteVersion, quote.current_version_id) if quote.current_version_id else None
        if current is None:
            raise QuotationConflict("Báo giá chưa có phiên bản để đồng bộ.")
        if ptg.customer_id is not None:
            self.chep_khach_tu_phieu(quote, ptg)

        if quote.status == STATUS_DRAFT:
            self._ap_so_tu_phieu(current, ptg)
            # "update_quote" (Cập nhật báo giá), KHÔNG "change_order" — feed dịch mã đó thành
            # "Tạo phiên bản mới", sai với đường nháp sửa tại chỗ.
            self.audit.create(
                actor_user_id=actor.id, action="update_quote", target=f"quote:{quote.id}",
                detail=f"{quote.quote_number}: cập nhật theo phiếu tính giá {ptg.ma} (bản nháp v{current.version_number})",
            )
            return quote, "draft_synced"

        current.status = VERSION_STATUS_SUPERSEDED
        new_version = QuoteVersion(
            quote_id=quote.id,
            version_number=current.version_number + 1,
            status=VERSION_STATUS_DRAFT,
            vat_percent=current.vat_percent,
            change_reason=f"Cập nhật theo phiếu tính giá {ptg.ma}",
            created_by=actor.id,
        )
        db.add(new_version)
        db.flush()
        self._chep_dong(current, new_version)
        db.flush()
        self._ap_so_tu_phieu(new_version, ptg)
        self._cong_tong(new_version)
        quote.current_version_id = new_version.id
        quote.status = STATUS_DRAFT
        quote.valid_until = date.today() + timedelta(days=30)
        self.audit.create(
            actor_user_id=actor.id, action="change_order", target=f"quote:{quote.id}",
            detail=f"{quote.quote_number}: v{current.version_number} → v{new_version.version_number} "
            f"cập nhật theo phiếu tính giá {ptg.ma}",
        )
        return quote, "new_version"

    # --- BG-2: "báo giá đặc thù" — GĐ duyệt (cùng máy exception_gate với A2) --------

    def exception_eval(self, quote: Quote) -> dict:
        """Soi 'báo giá đặc thù' trên VERSION HIỆN TẠI — cổng **theo TỪNG KHÁCH HÀNG** (redesign):
        - LUÔN áp (chung): Giá trị đơn ≥ 1 tỷ · Bán dưới vốn.
        - Theo rào của KH (bỏ ngưỡng 15% cứng): CHIẾT KHẤU (soi từng sản phẩm) ngoài `discount_min/max_pct` · **MARKUP**
          (lợi nhuận / GIÁ VỐN — đúng con số Sale gõ ở ô Markup%) ngoài `margin_min/max_pct`. Trục
          BIÊN (lợi nhuận / giá bán) đã BỎ 29/08/2026: markup 10% ⇔ biên 9,1% nên soi bằng biên thì
          báo giá gõ đúng rào vẫn bị bắt trình duyệt. KH chưa đặt rào (None) → bỏ qua cổng đó;
          KH null (khách lẻ) → chỉ 2 cổng chung.
        Số lấy từ tổng đã lưu của version: subtotal (trước VAT, đã gồm CK) · giá vốn · discount (CK nằm trong giá bán) ·
        total gồm VAT · cost. (Cổng công nợ HOÃN tới khi build phân hệ Công nợ/AR.)"""
        version = (
            self.quotations.db.get(QuoteVersion, quote.current_version_id)
            if quote.current_version_id else None
        )
        if version is None:
            return _exc_evaluate_quote(subtotal=0, total_gross=0, cost=None)
        # Giá bán đã GỒM chiết khấu (khoản sẽ hoàn lại khách) ⇒ doanh thu khách trả = subtotal. Soi markup
        # bằng lợi nhuận / (vốn + chiết khấu): đưa `cost` = vốn + chiết khấu vào cổng.
        subtotal_net = int(round(float(version.subtotal_amount)))
        discount = int(round(float(version.discount_amount)))
        total_gross = int(round(float(version.final_amount)))
        von = int(round(float(version.total_cost_snapshot)))
        cost = von + discount
        # Rào chính sách tài chính của KHÁCH (None nếu chưa đặt / khách lẻ chưa chọn). Ngoài khoảng
        # [min,max] (cả 2 chiều) → đặc thù; rào nào để None thì bỏ chiều đó.
        cust = self._customers.get_by_id(quote.customer_id) if (quote.customer_id and self._customers) else None
        # Rào chiết khấu soi TỪNG sản phẩm khách thấy: dòng cùng nhãn `nhom` (ruột + bìa) là MỘT sản
        # phẩm, cộng chung giá bán + chiết khấu rồi mới so.
        sp: dict[str, dict] = {}
        for it in version.items:
            nh = (it.nhom or "").strip()
            ln = sp.setdefault(nh or f"#{it.id}", {"ten": nh or it.product_name, "gross": 0.0, "discount": 0.0})
            ln["gross"] += float(it.total_cost_snapshot or 0)      # % chiết khấu tính trên GIÁ VỐN
            ln["discount"] += float(it.discount_amount or 0)
        return _exc_evaluate_quote(
            subtotal=subtotal_net, total_gross=total_gross, cost=cost,
            discount_amount=discount, subtotal_gross=von,
            discount_lines=list(sp.values()),
            discount_min_pct=(cust.discount_min_pct if cust else None),
            discount_max_pct=(cust.discount_max_pct if cust else None),
            markup_min_pct=(cust.markup_min_pct if cust else None),
            markup_max_pct=(cust.markup_max_pct if cust else None),
        )

    def approval_status(self, quote: Quote, exc: dict | None = None) -> dict:
        """Tình trạng duyệt 'báo giá đặc thù' — DELEGATE về exception_gate.approval_status."""
        if exc is None:
            exc = self.exception_eval(quote)
        row = self.quotations.latest_approval(quote.id)
        latest = None if row is None else {
            "decision": row.decision, "total": row.total, "subtotal": row.subtotal,
            "cost": row.cost, "note": row.note, "decided_at": row.decided_at,
        }
        return _exc_approval_status(exc, latest)

    def quote_gate(self, quote: Quote) -> dict:
        """Khối 'báo giá đặc thù' cho output/UI (nhãn định tính + `markup_pct` = % trên GIÁ VỐN).
        Kèm AI đã quyết định gần nhất (tên + thời điểm) để UI hiện 'đã được X duyệt/từ chối'."""
        exc = self.exception_eval(quote)
        appr = self.approval_status(quote, exc)
        row = self.quotations.latest_approval(quote.id)
        decided_by_name = None
        if row is not None and row.decided_by:
            decided_by_name = self.user_names({row.decided_by}).get(row.decided_by)
        return {
            "exception_required": appr["required"],
            "exception_status": appr["status"],       # none|pending|approved|rejected|stale
            "exception_cleared": appr["cleared"],
            "exceptions": exc["triggers"],
            "exception_note": appr["note"],
            "markup_pct": exc["markup_pct"],
            "exception_decision": row.decision if row is not None else None,
            "exception_decided_by_name": decided_by_name,
            "exception_decided_at": row.decided_at if row is not None else None,
        }

    def record_approval(self, *, quotation_id: int, decision: str, note: str | None, scope: str, actor):
        """Giám đốc Kinh doanh DUYỆT / TỪ CHỐI 'báo giá đặc thù' — chỉ khi báo giá đang **Chờ duyệt**
        (`pending_approval`, tức đã 'Trình duyệt'). Ghim số + ngưỡng (audit). Chặn nếu báo giá KHÔNG
        thuộc diện đặc thù."""
        if decision not in _EXC_DECISIONS:
            raise QuotationValidationError("Quyết định không hợp lệ (chỉ 'approved' / 'rejected').")
        quote = self.get_quotation(quotation_id=quotation_id, scope=scope, actor=actor)
        exc = self.exception_eval(quote)
        if not exc["triggers"]:
            raise QuotationValidationError(
                "Báo giá không thuộc diện đặc thù — không cần Giám đốc Kinh doanh duyệt."
            )
        if quote.status != STATUS_PENDING_APPROVAL:
            raise QuotationValidationError(
                "Chỉ duyệt khi báo giá đang 'Chờ duyệt' (Sales phải TRÌNH DUYỆT trước)."
            )
        # Người duyệt PHẢI phản hồi lý do — dù đồng ý hay từ chối (redesign-bao-gia §10, chủ đầu tư chốt).
        if not note or not note.strip():
            raise QuotationValidationError(
                "Phải nêu lý do/ý kiến khi duyệt hoặc từ chối báo giá đặc thù."
            )
        row = self.quotations.create_approval(
            quote_id=quote.id,
            decision=decision,
            triggers_json=[t["key"] for t in exc["triggers"]],
            total=exc["total_gross"],
            subtotal=exc["subtotal"],
            cost=exc["cost"],
            markup_pct_snapshot=exc["markup_pct"],
            min_markup_pct=exc["markup_min_pct"],
            high_value_threshold=exc["high_value_threshold"],
            note=note,
            decided_by=actor.id,
        )
        # Lái trạng thái: GĐ DUYỆT → "Đã duyệt" (approved, khóa; KHÔNG gửi, KHÔNG freeze — sale tự gửi
        # khách sau, freeze lúc gửi). TỪ CHỐI → "Bị từ chối" (rejected, KHÓA) — sale bấm "Tạo phiên
        # bản mới" để sửa rồi trình duyệt lại (versioning CHỈ ở trạng thái từ chối).
        version = self.quotations.db.get(QuoteVersion, quote.current_version_id)
        if decision == _EXC_APPROVED:
            quote.status = STATUS_APPROVED
            if version:
                version.status = VERSION_STATUS_LOCKED
        else:
            quote.status = STATUS_REJECTED
            if version:
                version.status = VERSION_STATUS_REJECTED
        # Real-time: đánh dấu "có quyết định MỚI chưa xem" cho người soạn → badge/toast phía Sale.
        quote.decision_seen_at = None
        self.quotations.update(quote)
        verb = "duyệt" if decision == _EXC_APPROVED else "từ chối"
        # KHÔNG ghim vai vào câu log ("Giám đốc KD …"): người bấm có thể là GĐ Kinh doanh, TP Kinh
        # doanh hay Giám đốc công ty — ai cũng cầm `can_approve_exception`. Vai thật lấy từ HỒ SƠ
        # của người thao tác (`actor_display`), câu log chỉ tả VIỆC.
        self.audit.create(
            actor_user_id=actor.id, action=f"quote_exception_{decision}", target=f"quote:{quote.id}",
            detail=f"{quote.quote_number}: {verb} báo giá đặc thù "
            f"({' và '.join(t['label'] for t in exc['triggers'])})",
        )
        return row

    def list_approvals(self, *, quotation_id: int, scope: str, actor) -> list:
        quote = self.get_quotation(quotation_id=quotation_id, scope=scope, actor=actor)
        return self.quotations.list_approvals(quote.id)

    # --- Tài liệu đính kèm (NỘI BỘ: file khách gửi / mẫu thiết kế / ảnh tham khảo) ---
    # Lớp tài liệu tách khỏi dữ liệu giá: cho thêm/xóa ở MỌI trạng thái trừ Hủy (chủ đầu tư chốt).
    # Mọi thao tác để lại vết ai-gì-lúc-nào ở feed Hoạt động (audit theo target quote:{id}).
    def list_attachments(self, *, quotation_id: int, scope: str, actor) -> list:
        quote = self.get_quotation(quotation_id=quotation_id, scope=scope, actor=actor)
        return self.quotations.list_attachments(quote.id)

    def add_attachment(
        self, *, quotation_id: int, scope: str, actor,
        file_name: str, file_url: str, file_type: str | None,
    ):
        quote = self.get_quotation(quotation_id=quotation_id, scope=scope, actor=actor)
        if quote.status == STATUS_CANCELLED:
            raise QuotationLocked("Báo giá đã hủy — không đính kèm tài liệu được.")
        att = self.quotations.add_attachment(
            quote.id, file_name=file_name, file_url=file_url,
            file_type=file_type, uploaded_by=actor.id,
        )
        self.audit.create(
            actor_user_id=actor.id, action="quote_attach_add", target=f"quote:{quote.id}",
            detail=f"{quote.quote_number}: đính kèm tài liệu {file_name}",
        )
        return att

    def delete_attachment(self, *, quotation_id: int, attachment_id: int, scope: str, actor) -> str | None:
        """Xóa 1 đính kèm. Trả `file_url` để router dọn object trong storage (tránh file rác)."""
        quote = self.get_quotation(quotation_id=quotation_id, scope=scope, actor=actor)
        if quote.status == STATUS_CANCELLED:
            raise QuotationLocked("Báo giá đã hủy — không sửa tài liệu đính kèm được.")
        att = self.quotations.get_attachment(attachment_id)
        if att is None or att.quote_id != quote.id:
            raise QuotationNotFound("Không tìm thấy tài liệu đính kèm.")
        file_url = att.file_url
        self.quotations.delete_attachment(att)
        self.audit.create(
            actor_user_id=actor.id, action="quote_attach_delete", target=f"quote:{quote.id}",
            detail=f"{quote.quote_number}: xóa tài liệu {att.file_name}",
        )
        return file_url

    # --- Ảnh minh họa của DÒNG báo giá (in ở cột "Hình ảnh minh họa" bản gửi khách) ------------

    def _cum_in(self, quote: Quote, item_id: int) -> tuple[QuoteItem, list[QuoteItem]]:
        """Trả dòng được trỏ + TẤT CẢ dòng cùng CỤM IN với nó trong version đang hiệu lực.

        Cụm in = đúng cái bản in gom lại thành một dòng (`utils/gop-nhom.ts`): các dòng cùng nhãn
        `nhom` gộp trước, rồi các cụm cùng TÊN hiển thị gộp tiếp. Nên khóa cụm = nhãn `nhom` nếu
        có, không thì `product_name` — chuẩn hóa bỏ khoảng trắng thừa + không phân biệt hoa
        thường, y như `khoaNhan()` bên FE (gõ lệch hoa vẫn cùng cụm).
        """
        version = (
            self.quotations.db.get(QuoteVersion, quote.current_version_id)
            if quote.current_version_id else None
        )
        items = list(version.items) if version else []
        item = next((i for i in items if i.id == item_id), None)
        if item is None:
            raise QuotationNotFound("Không tìm thấy dòng báo giá.")
        khoa = ((item.nhom or item.product_name) or "").strip().lower()
        cum = [i for i in items if ((i.nhom or i.product_name) or "").strip().lower() == khoa]
        return item, (cum or [item])

    def set_item_image(self, *, quotation_id: int, item_id: int, file_url: str, scope: str, actor) -> tuple[list[int], list[str]]:
        """Gắn ảnh minh họa cho CẢ CỤM chứa dòng `item_id`.

        Trả `(id các dòng đã nhận ảnh, URL ảnh cũ cần dọn)`: URL cũ nào không còn dòng nào trỏ
        tới thì router xóa khỏi storage — thay ảnh mà giữ file cũ là để rác vĩnh viễn.
        """
        quote = self.get_quotation(quotation_id=quotation_id, scope=scope, actor=actor)
        if quote.status == STATUS_CANCELLED:
            raise QuotationLocked("Báo giá đã hủy — không đổi ảnh minh họa được.")
        item, cum = self._cum_in(quote, item_id)
        cu = {i.anh_minh_hoa for i in cum if i.anh_minh_hoa and i.anh_minh_hoa != file_url}
        for i in cum:
            i.anh_minh_hoa = file_url
        self.quotations.db.flush()
        ten = (item.nhom or item.product_name or "").strip()
        self.audit.create(
            actor_user_id=actor.id, action="quote_item_image_set", target=f"quote:{quote.id}",
            detail=f"{quote.quote_number}: đặt ảnh minh họa cho «{ten}»",
        )
        return [i.id for i in cum], sorted(self._url_mo_coi(quote, cu))

    def clear_item_image(self, *, quotation_id: int, item_id: int, scope: str, actor) -> list[str]:
        """Gỡ ảnh minh họa khỏi cả cụm. Trả URL cần dọn khỏi storage."""
        quote = self.get_quotation(quotation_id=quotation_id, scope=scope, actor=actor)
        if quote.status == STATUS_CANCELLED:
            raise QuotationLocked("Báo giá đã hủy — không đổi ảnh minh họa được.")
        item, cum = self._cum_in(quote, item_id)
        cu = {i.anh_minh_hoa for i in cum if i.anh_minh_hoa}
        for i in cum:
            i.anh_minh_hoa = None
        self.quotations.db.flush()
        ten = (item.nhom or item.product_name or "").strip()
        self.audit.create(
            actor_user_id=actor.id, action="quote_item_image_clear", target=f"quote:{quote.id}",
            detail=f"{quote.quote_number}: gỡ ảnh minh họa của «{ten}»",
        )
        return sorted(self._url_mo_coi(quote, cu))

    def _url_mo_coi(self, quote: Quote, urls: set[str]) -> set[str]:
        """Lọc ra các URL KHÔNG còn dòng nào (ở bất kỳ phiên bản nào của phiếu) trỏ tới.

        Phiên bản cũ giữ nguyên ảnh đã gửi khách, nên xóa ở bản mới KHÔNG được dọn file mà bản
        v1 vẫn đang in.
        """
        if not urls:
            return set()
        con_dung: set[str] = set()
        for v in quote.versions:
            for i in v.items:
                if i.anh_minh_hoa in urls:
                    con_dung.add(i.anh_minh_hoa)
        return urls - con_dung

    def update_quotation(
        self,
        *,
        quotation_id: int,
        scope: str,
        actor,
        valid_until: date | None,
        terms_text: str | None = None,
        customer_note: str | None = None,
        ke_thua_gui: dict | None = None,
        items_payload: list[dict] | None = None,
    ) -> Quote:
        """`ke_thua_gui` = các ô KẾ THỪA từ phiếu (`KE_THUA_TU_PHIEU`) mà client CÓ gửi lên. Gửi
        đúng giá trị đang có thì bỏ qua (client cũ echo cả form); gửi khác ⇒ 422, chỉ đường sửa ở phiếu."""
        quote = self.get_quotation(quotation_id=quotation_id, scope=scope, actor=actor)
        if quote.status not in (STATUS_DRAFT,):
            raise QuotationLocked("Chỉ chỉnh sửa được báo giá ở trạng thái nháp.")

        if valid_until and valid_until < date.today():
            raise QuotationValidationError("Hạn hiệu lực không được ở quá khứ.")

        # Khách / điểm giao / người nhận / ghi chú nội bộ KẾ THỪA từ phiếu tính giá (04/10/2026):
        # máy chủ từ chối đổi ở đây, không chỉ dựa vào màn ẩn ô.
        def _chuan(v):
            return (v.strip() or None) if isinstance(v, str) else v
        for field, value in (ke_thua_gui or {}).items():
            if field in self.KE_THUA_TU_PHIEU and _chuan(value) != _chuan(getattr(quote, field)):
                raise QuotationValidationError(
                    "Khách hàng, địa chỉ giao, người nhận và ghi chú nội bộ lấy từ phiếu tính giá — "
                    "sửa ở phiếu tính giá."
                )
        quote.valid_until = valid_until
        quote.terms_text = (terms_text or "").strip() or DEFAULT_TERMS
        quote.customer_note = customer_note

        # Find Draft Version
        version = self.quotations.db.get(QuoteVersion, quote.current_version_id)
        if not version or version.status != VERSION_STATUS_DRAFT:
            raise QuotationLocked("Phiên bản hiện tại không ở trạng thái nháp để chỉnh sửa.")

        # Update Items and Recalculate
        subtotal = 0.0
        discount = 0.0
        vat = 0.0
        final = 0.0
        total_cost = 0.0

        if items_payload is not None:
            # We map the submitted array of items to the DB
            item_map = {item.id: item for item in version.items}
            for ip in items_payload:
                item_id = ip.get("id")
                if item_id and item_id in item_map:
                    db_item = item_map[item_id]
                    pricing = self.calculate_pricing(
                        total_cost=float(db_item.total_cost_snapshot),
                        margin_percent=float(ip.get("margin_percent", db_item.margin_percent)),
                        manual_selling_price=ip.get("manual_selling_price"),
                        manual_unit_price=ip.get("manual_unit_price"),
                        discount_amount=float(ip.get("discount_amount", 0.0)),
                        discount_percent=float(ip.get("discount_percent", 0.0)),
                        profit_amount=ip.get("profit_amount"),
                        vat_percent=float(ip.get("vat_percent", db_item.vat_percent)),
                        rounding=ip.get("rounding", "no_rounding"),
                        quantity=db_item.quantity,
                    )
                    db_item.margin_percent = pricing["margin_percent"]
                    db_item.selling_price = pricing["selling_price"]
                    db_item.gia_go_tay = (
                        ip.get("manual_selling_price") is not None
                        or ip.get("manual_unit_price") is not None
                    )
                    db_item.unit_price = pricing["unit_price"]
                    db_item.discount_amount = pricing["discount_amount"]
                    db_item.vat_percent = ip.get("vat_percent", db_item.vat_percent)
                    db_item.vat_amount = pricing["vat_amount"]
                    db_item.final_amount = pricing["final_amount"]
                    db_item.note = ip.get("note", db_item.note)
                    db_item.po_code = ip.get("po_code", db_item.po_code)
                    db_item.dien_giai = ip.get("dien_giai", db_item.dien_giai)

                    subtotal += pricing["selling_price"]
                    discount += pricing["discount_amount"]
                    vat += pricing["vat_amount"]
                    final += pricing["final_amount"]
                    total_cost += float(db_item.total_cost_snapshot)
        else:
            # Just sum up existing items
            for db_item in version.items:
                subtotal += float(db_item.selling_price)
                discount += float(db_item.discount_amount)
                vat += float(db_item.vat_amount)
                final += float(db_item.final_amount)
                total_cost += float(db_item.total_cost_snapshot)

        version.total_cost_snapshot = total_cost
        version.subtotal_amount = subtotal
        version.discount_amount = discount
        version.vat_amount = vat
        version.final_amount = final

        self.quotations.update(quote)

        # Gộp các lần "Cập nhật báo giá" liên tiếp của cùng người → 1 mục (bump thời điểm), tránh
        # nhật ký Hoạt động phình vô tận khi lưu nháp/sửa nhiều lần.
        self.audit.create_collapsing(
            actor_user_id=actor.id,
            action="update_quote",
            target=f"quote:{quote.id}",
            detail=f"Cập nhật báo giá {quote.quote_number} v{version.version_number}",
        )
        return quote

    # --- Writes: Transition (redesign-bao-gia §3) -----------------------------
    def _apply_send(self, quote: Quote, version) -> None:
        """Thân bước 'Gửi khách': khóa phiên bản + freeze snapshot copy-on-write + đặt hạn hiệu lực
        nếu chưa có."""
        if version:
            version.status = VERSION_STATUS_SENT
            version.sent_at = datetime.now(timezone.utc)
            # Freeze cost breakdown lúc gửi khách (copy-on-write, P0 §34).
            if version.internal_cost_snapshot_json is None:
                # B5 (redesign-bao-gia §8): đường PhieuTinhGia — freeze phân rã giá vốn theo các DÒNG đã
                # khóa lúc tạo (total_cost_snapshot per PhieuThanhPhan) để bản gửi không đổi khi PTG sửa.
                version.internal_cost_snapshot_json = {
                    "source": "phieu_tinh_gia",
                    "lines": [
                        {
                            "phieu_thanh_phan_id": it.phieu_thanh_phan_id,
                            "product_name": it.product_name,
                            "quantity": it.quantity,
                            "total_cost_snapshot": float(it.total_cost_snapshot or 0),
                        }
                        for it in version.items
                    ],
                }
        quote.status = STATUS_SENT
        if quote.valid_until is None:
            quote.valid_until = date.today()

    def _apply_accept_picks(self, version, accepted_item_ids: list[int] | None) -> None:
        """Ghi quyết định khách chốt MỘT PHẦN lên các dòng của version. None → ưng tất cả (chốt nhanh /
        tương thích cũ). Có danh sách → dòng trong danh sách = ưng, còn lại = không lấy (giữ vết);
        phải ≥1 dòng ưng và id phải thuộc báo giá này."""
        items = list(version.items)
        if accepted_item_ids is None:
            for it in items:
                it.accepted = True
            return
        picked = set(accepted_item_ids)
        valid_ids = {it.id for it in items}
        if picked - valid_ids:
            raise QuotationValidationError("Có dòng được chọn không thuộc báo giá này.")
        if not (picked & valid_ids):
            raise QuotationValidationError("Phải chọn ít nhất 1 sản phẩm khách chốt.")
        for it in items:
            it.accepted = it.id in picked

    def transition(
        self,
        *,
        quotation_id: int,
        to_status: str,
        scope: str,
        actor,
        cancel_reason: str | None = None,
        accepted_item_ids: list[int] | None = None,
    ) -> Quote:
        """Chuyển trạng thái báo giá (redesign-bao-gia §3). Báo giá ĐẶC THÙ KHÔNG được gửi/khách-duyệt
        thẳng — phải TRÌNH DUYỆT (draft→pending_approval) rồi Giám đốc Kinh doanh duyệt (qua /approval).

        `accepted_item_ids` (chỉ khi to_status="accepted"): khách chốt MỘT PHẦN — id các dòng khách ƯNG;
        None = ưng tất cả. Đơn hàng sau đó chỉ kéo dòng accepted=True."""
        quote = self.get_quotation(quotation_id=quotation_id, scope=scope, actor=actor)
        version = self.quotations.db.get(QuoteVersion, quote.current_version_id)

        if to_status == STATUS_PENDING_APPROVAL:
            # Trình duyệt: CHỈ báo giá đặc thù, từ Nháp.
            if quote.status != STATUS_DRAFT:
                raise QuotationConflict(f"Không thể trình duyệt từ trạng thái {quote.status}.")
            if not self.exception_eval(quote)["triggers"]:
                raise QuotationValidationError(
                    "Báo giá không thuộc diện đặc thù — gửi khách thẳng, không cần trình duyệt."
                )
            quote.status = STATUS_PENDING_APPROVAL

        elif to_status == STATUS_SENT:
            # Gửi khách (SALE tự gửi): từ Nháp (báo giá THƯỜNG) HOẶC từ "Đã duyệt" (đặc thù đã được
            # Giám đốc Kinh doanh DUYỆT). Freeze snapshot tại mốc gửi này.
            if quote.status == STATUS_DRAFT:
                if self.quote_gate(quote)["exception_required"]:
                    raise QuotationValidationError(
                        "Báo giá thuộc diện đặc thù — phải TRÌNH DUYỆT để Giám đốc Kinh doanh duyệt "
                        "trước khi gửi khách."
                    )
            elif quote.status != STATUS_APPROVED:
                raise QuotationConflict(f"Không thể chuyển trạng thái {quote.status} -> sent")
            self._apply_send(quote, version)

        elif to_status == STATUS_ACCEPTED:
            # Khách duyệt: từ sent (chuẩn) hoặc draft (chốt trực tiếp — chỉ báo giá thường).
            if quote.status not in (STATUS_SENT, STATUS_DRAFT):
                raise QuotationConflict(f"Không thể duyệt báo giá đang ở trạng thái {quote.status}")
            if quote.status == STATUS_DRAFT and self.quote_gate(quote)["exception_required"]:
                raise QuotationValidationError(
                    "Báo giá thuộc diện đặc thù — phải trình duyệt & gửi khách trước khi khách chốt."
                )
            if quote.valid_until and quote.valid_until < date.today():
                quote.status = STATUS_EXPIRED
                self.quotations.update(quote)
                raise QuotationConflict("Báo giá đã hết hạn hiệu lực, không thể duyệt.")
            quote.status = STATUS_ACCEPTED
            if version:
                version.status = VERSION_STATUS_ACCEPTED
                version.accepted_at = datetime.now(timezone.utc)
                self._apply_accept_picks(version, accepted_item_ids)
                self._cong_tong(version)

        elif to_status == STATUS_REJECTED:
            # Khách từ chối (SAU khi gửi) — khác với Giám đốc KD từ chối duyệt (→ về Nháp).
            if quote.status != STATUS_SENT:
                raise QuotationConflict(f"Không thể từ chối báo giá đang ở trạng thái {quote.status}")
            quote.status = STATUS_REJECTED
            if version:
                version.status = VERSION_STATUS_REJECTED
                version.rejected_at = datetime.now(timezone.utc)

        elif to_status == STATUS_CANCELLED:
            # Hủy (kèm lý do) — từ mọi trạng thái làm việc TRƯỚC khi lên đơn.
            if not cancel_reason or not cancel_reason.strip():
                raise QuotationValidationError("Cần nêu lý do hủy.")
            if quote.status not in (
                STATUS_DRAFT, STATUS_PENDING_APPROVAL, STATUS_APPROVED, STATUS_SENT,
                STATUS_ACCEPTED, STATUS_REJECTED,
            ):
                raise QuotationConflict(f"Không thể hủy báo giá đang ở trạng thái {quote.status}.")
            quote.status = STATUS_CANCELLED
            quote.cancel_reason = cancel_reason
            if version:
                version.status = VERSION_STATUS_CANCELLED

        else:
            raise QuotationValidationError("Trạng thái đích không hợp lệ.")

        self.quotations.update(quote)
        self.audit.create(
            actor_user_id=actor.id,
            action=f"transition_{to_status}",
            target=f"quote:{quote.id}",
            detail=f"{quote.quote_number}: chuyển sang {STATUS_LABELS.get(to_status, to_status)}" + (f" ({cancel_reason})" if cancel_reason else ""),
        )
        return quote

    # --- Writes: Re-quote / Versioning (Phase 2C) -----------------------------
    def requote(self, *, quotation_id: int, scope: str, actor, change_reason: str) -> Quote:
        """Create a new version (re-quote) from an existing quote. `change_reason` BẮT BUỘC —
        mỗi phiên bản mới phải ghi rõ LÝ DO/thay đổi (in vào feed Hoạt động + Lịch sử phiên bản)."""
        reason = (change_reason or "").strip()
        if not reason:
            raise QuotationValidationError("Phải ghi chú/lý do cho phiên bản mới trước khi tạo.")
        quote = self.get_quotation(quotation_id=quotation_id, scope=scope, actor=actor)

        # Tạo phiên bản mới CHỈ khi báo giá BỊ TỪ CHỐI (khách từ chối HOẶC GĐ/TP từ chối đặc thù —
        # cả hai đều `rejected`) → sale sửa lại rồi trình duyệt/gửi lại. Trạng thái khác: nháp thì
        # sửa thẳng; đang chạy (chờ duyệt/đã duyệt/đã gửi) hoặc kết thúc (đồng ý/hết hạn/lên đơn/hủy)
        # thì KHÔNG đẻ phiên bản.
        if quote.status != STATUS_REJECTED:
            raise QuotationConflict(
                f"Chỉ tạo phiên bản mới khi báo giá BỊ TỪ CHỐI (hiện: '{quote.status}')."
            )

        # Mark current version as superseded
        current_version = self.quotations.db.get(QuoteVersion, quote.current_version_id)
        if current_version:
            current_version.status = VERSION_STATUS_SUPERSEDED

        # Create new version
        new_version = QuoteVersion(
            quote_id=quote.id,
            version_number=current_version.version_number + 1 if current_version else 2,
            status=VERSION_STATUS_DRAFT,
            total_cost_snapshot=current_version.total_cost_snapshot if current_version else 0.0,
            subtotal_amount=current_version.subtotal_amount if current_version else 0.0,
            discount_amount=current_version.discount_amount if current_version else 0.0,
            vat_percent=current_version.vat_percent if current_version else 0.0,
            vat_amount=current_version.vat_amount if current_version else 0.0,
            final_amount=current_version.final_amount if current_version else 0.0,
            internal_cost_snapshot_json=current_version.internal_cost_snapshot_json if current_version else None,
            change_reason=reason,
            created_by=actor.id,
        )
        self.quotations.db.add(new_version)
        self.quotations.db.flush()

        # Chép dòng sang bản mới (nhãn gộp, ĐVT cụm, ảnh minh họa theo sang — xem `_chep_dong`).
        if current_version:
            self._chep_dong(current_version, new_version)

        quote.current_version_id = new_version.id
        quote.status = STATUS_DRAFT
        # Hạn hiệu lực reset = 30 ngày kể từ phiên bản mới nhất (vừa tạo).
        quote.valid_until = date.today() + timedelta(days=30)
        # Phiên bản mới lấy khách/điểm giao/người nhận/ghi chú MỚI NHẤT của phiếu tính giá.
        if quote.phieu_tinh_gia_id is not None:
            from ..models.phieu_tinh_gia import PhieuTinhGia

            ptg = self.quotations.db.get(PhieuTinhGia, quote.phieu_tinh_gia_id)
            if ptg is not None and ptg.customer_id is not None:
                self.chep_khach_tu_phieu(quote, ptg)
        self.quotations.update(quote)

        self.audit.create(
            actor_user_id=actor.id,
            action="change_order",
            target=f"quote:{quote.id}",
            detail=f"{quote.quote_number}: tạo phiên bản v{new_version.version_number} — {reason}",
        )
        return quote
