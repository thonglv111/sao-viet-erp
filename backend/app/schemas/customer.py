"""Pydantic request/response models for the Khách hàng (CRM) API — spec-06.

Field-level constraints here are the first line of validation (400/422 shape); the
service enforces the domain rules (MST format, non-blank name, duplicate-check-soft).
"""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class _CustomerIdentity(BaseModel):
    """Thông tin ĐỊNH DANH khách (form Thêm/Sửa, redesign spec-06 v2). Không đụng chính sách
    tài chính (sửa qua endpoint /financial riêng, tránh PUT định-danh xóa nhầm hạn mức/rào)."""

    name: str = Field(min_length=1, max_length=255)
    # Loại KH: ca_nhan | cong_ty (service validate; default cong_ty).
    customer_kind: str = Field(default="cong_ty", max_length=12)
    tax_code: str | None = Field(default=None, max_length=20)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=500)
    contact_name: str | None = Field(default=None, max_length=255)
    sale_user_id: int | None = None


class CustomerCreate(_CustomerIdentity):
    """Khách MỚI = thông tin định danh; chính sách tài chính về default an toàn
    (credit_limit=0, chưa khai điều khoản, chưa đặt rào) — đặt sau qua /financial."""


class CustomerUpdate(_CustomerIdentity):
    pass


class CustomerFinancialIn(BaseModel):
    """Chính sách tài chính khách (redesign spec-06 v2) — endpoint /financial, gate
    `set_credit_terms`. Ghi ĐẦY ĐỦ nhóm này: hạn mức công nợ (tiền) + số ngày công nợ tối đa
    (net terms, kể từ ngày xuất HĐ) + rào chiết khấu/markup min–max. Lưu + hiển thị; chặn báo
    giá / cảnh báo quá hạn là SEAM."""

    credit_limit: int = Field(default=0, ge=0)
    # Số ngày công nợ tối đa kể từ ngày xuất hóa đơn. None = chưa đặt hạn ngày.
    payment_term_days: int | None = Field(default=None, ge=0)
    discount_min_pct: float | None = Field(default=None, ge=0, le=100)
    discount_max_pct: float | None = Field(default=None, ge=0, le=100)
    markup_min_pct: float | None = Field(default=None, ge=0, le=100)
    markup_max_pct: float | None = Field(default=None, ge=0, le=100)
    # Kê giá (20/10/2026): % kê công ty giữ lại nộp thuế TNDN (mặc định 20) + rào kê (% trên giá bán).
    ke_thue_tndn_pct: float = Field(default=20, ge=0, le=100)
    ke_min_pct: float | None = Field(default=None, ge=0, le=100)
    ke_max_pct: float | None = Field(default=None, ge=0, le=100)


class DuplicateRef(BaseModel):
    """Points at an existing customer that already carries the submitted MST (soft warn)."""

    id: int
    code: str
    name: str


class DuplicateWarn(BaseModel):
    """Một cảnh báo trùng MỀM (khảo sát #8/#15: check theo MST + tên cty + email —
    cảnh báo, không chặn). `field` ∈ tax_code|name|email."""

    field: str
    id: int
    code: str
    name: str


class CustomerRow(BaseModel):
    """A row in the Danh bạ list. `receivable` stays None + `no_ar_module=True` until
    Công nợ (SEAM-16) is built — never a fabricated 0. `revenue_12m` / `orders_total` /
    `last_order_at` are DERIVED FROM REAL ORDERS, default to honest zero/None when the
    customer has no history. Redesign spec-06 v2: bỏ `tier` (tự phân loại) + `status` +
    chiết khấu mặc định cũ; thêm `customer_kind` + rào chiết khấu/markup. Chính sách tài
    chính AI CŨNG XEM (không ẩn); sửa gate `set_credit_terms` ở service."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    customer_kind: str = "cong_ty"
    tax_code: str | None
    phone: str | None
    email: str | None = None
    address: str | None = None
    contact_name: str | None = None
    credit_limit: int
    # Số ngày công nợ tối đa (net terms, kể từ ngày xuất HĐ). None = chưa đặt hạn ngày.
    payment_term_days: int | None = None
    sale_user_id: int | None
    sale_name: str | None = None
    created_at: datetime | None = None
    # Công nợ (chỉ-đọc). None + no_ar_module → UI shows "—" / "Chưa có phân hệ Công nợ".
    receivable: int | None = None
    no_ar_module: bool = True
    # --- derived from real orders (số THẬT; bỏ tier) ---
    revenue_12m: int = 0
    # Số đơn đã chốt trong cùng 12 tháng với `revenue_12m` — cột "Mua hàng" ghép hai số này,
    # đừng ghép doanh số 12 tháng với số đơn mọi thời kỳ.
    orders_12m: int = 0
    orders_total: int = 0
    last_order_at: date | None = None
    # --- Rào chiết khấu / MARKUP (spec-06 v2) — hiển thị cho mọi người.
    # markup = lợi nhuận / GIÁ VỐN (không phải biên trên giá bán). ---
    discount_min_pct: float | None = None
    discount_max_pct: float | None = None
    markup_min_pct: float | None = None
    markup_max_pct: float | None = None
    # --- Kê giá (20/10/2026): thuế TNDN trên kê (%) + rào kê (% trên giá bán) ---
    ke_thue_tndn_pct: float = 20
    ke_min_pct: float | None = None
    ke_max_pct: float | None = None
    # --- Nhãn thủ công (#7) — sales gán tay, chips trên danh bạ ---
    tags: list[str] = []


class CustomerKpis(BaseModel):
    """The list header KPI strip — rolled up over the whole scoped book, real orders.
    Redesign spec-06 v2: bỏ tier (loyal/partner), chỉ còn số THẬT."""

    total_customers: int
    new_this_month: int
    avg_order_value: int
    total_revenue: int = 0


class CustomerListOut(BaseModel):
    items: list[CustomerRow]
    total: int
    page: int
    size: int
    kpis: CustomerKpis
    # Hàng lọc nhanh "Trạng thái mua hàng": đếm trên tập đang lọc (mọi điều kiện TRỪ chính ô mua).
    dem_mua: dict[str, int] = {}
    # Dòng "Cộng" của lưới: tổng mua 12 tháng của CẢ tập lọc (không riêng trang đang xem).
    tong_mua_12m: int = 0


class CustomerCreateOut(BaseModel):
    """Create/update response: the customer + soft duplicate warnings (không chặn).
    `duplicate` giữ lại cho chỗ gọi cũ (= cảnh báo MST đầu tiên); `duplicates` là danh
    sách đầy đủ theo MST + tên cty + email."""

    customer: CustomerRow
    duplicate: DuplicateRef | None = None
    duplicates: list[DuplicateWarn] = []


# --- Người liên hệ (#10–#11) -----------------------------------------------


class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    title: str | None = Field(default=None, max_length=120)
    duty: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=255)
    is_primary: bool = False


class ContactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    title: str | None = None
    duty: str | None = None
    phone: str | None = None
    email: str | None = None
    is_primary: bool


class ContactsOut(BaseModel):
    items: list[ContactOut]


# --- Địa chỉ giao hàng (#9) --------------------------------------------------


class AddressIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    address: str = Field(min_length=1, max_length=500)
    phone: str | None = Field(default=None, max_length=30)
    note: str | None = Field(default=None, max_length=500)
    is_default: bool = False


class AddressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    address: str
    phone: str | None = None
    note: str | None = None
    is_default: bool


class AddressesOut(BaseModel):
    items: list[AddressOut]


# --- Tài liệu đính kèm (#21) --------------------------------------------------


class CustomerAttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    doc_kind: str
    file_name: str
    file_url: str
    file_type: str | None = None
    uploaded_at: datetime


class CustomerAttachmentsOut(BaseModel):
    items: list[CustomerAttachmentOut]


# --- Nhãn thủ công (#7: sales gán tay để phân loại chăm sóc) --------------------


class TagIn(BaseModel):
    label: str = Field(min_length=1, max_length=50)


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str


class TagsOut(BaseModel):
    items: list[TagOut]


# --- Kho nhãn dùng chung (thêm / xoá nhãn — 16/08/2026) -------------------------


class KhoNhanRow(BaseModel):
    """Một nhãn trong kho + số khách đang mang nó.

    `so_khach` để màn hình hỏi có SỐ trước khi xoá ("3 khách đang mang nhãn này") thay vì một hộp
    thoại "bạn có chắc không" — đếm sẵn ở đây nên không phải gọi thêm vòng nào lúc bấm xoá."""

    id: int
    label: str
    so_khach: int = 0


class KhoNhanOut(BaseModel):
    items: list[KhoNhanRow]


class KhoNhanXoaOut(BaseModel):
    so_khach_da_go: int


# --- Ghi chú tự do (tab Ghi chú — lưu ý team về khách) --------------------------


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class NoteUpdateIn(BaseModel):
    """Sửa ghi chú. Cả hai optional để PUT lo được RIÊNG LẺ: chỉ sửa nội dung, hoặc chỉ
    bật/tắt ghim. `body=None` → không đụng nội dung; `pinned=None` → không đụng ghim."""

    body: str | None = Field(default=None, max_length=4000)
    pinned: bool | None = None


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    body: str
    pinned: bool
    created_at: datetime
    updated_at: datetime | None = None
    # `edited` = đã sửa nội dung (updated_at != None). `author_name` do router nạp.
    edited: bool = False
    author_name: str | None = None


class NotesOut(BaseModel):
    items: list[NoteOut]


# --- Chăm sóc khách hàng (#20/#27/#28) -----------------------------------------


class CareEventIn(BaseModel):
    kind: str = Field(default="khac", max_length=24)
    note: str = Field(min_length=1, max_length=1000)
    # Cho phép ghi bù (buổi gặp hôm qua); bỏ trống = bây giờ.
    happened_at: datetime | None = None


class CareEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    note: str
    happened_at: datetime
    actor_name: str | None = None


class CareEventsOut(BaseModel):
    items: list[CareEventOut]


class CareTaskIn(BaseModel):
    note: str = Field(min_length=1, max_length=500)
    due_date: datetime
    assignee_user_id: int | None = None
    # Lịch lặp (redesign-lich-hen-cham-soc): none/day/week/month · mỗi N · đến ngày.
    repeat_freq: str = Field(default="none", max_length=8)
    repeat_interval: int = Field(default=1, ge=1)
    repeat_until: datetime | None = None


class CareTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    note: str
    due_date: datetime
    status: str
    assignee_user_id: int | None = None
    assignee_name: str | None = None
    done_at: datetime | None = None
    repeat_freq: str = "none"
    repeat_interval: int = 1
    repeat_until: datetime | None = None
    series_id: int | None = None
    ket_qua: str | None = None
    # Đang mở mà giờ hẹn đã qua — tính khi đọc (thay mức nhắc lần 1/2/3, gỡ 05/10/2026).
    tre: bool = False


class CareTasksOut(BaseModel):
    items: list[CareTaskOut]
    # Đánh giá chăm sóc (#28 — "nhắc lần 1,2,3 sẽ đánh giá tiêu chuẩn chăm sóc"):
    # đếm việc đã xong đúng hạn / xong trễ / đang quá hạn — số thật từ tasks.
    done_on_time: int = 0
    done_late: int = 0
    overdue_open: int = 0


class CareTaskStatusIn(BaseModel):
    """Đổi trạng thái việc chăm sóc: done | cancelled | open (mở lại)."""

    status: str
    # Khi hoàn thành có thể ghi luôn một dòng nhật ký chăm sóc (kind + note).
    log_kind: str | None = Field(default=None, max_length=24)
    log_note: str | None = Field(default=None, max_length=1000)


class CareOccurrenceOut(BaseModel):
    """1 lần hẹn trên LỊCH (redesign-lich-hen-cham-soc). `task_id=None` ⇒ lần ẢO (tương lai chưa
    materialize). `series_id` = id hẹn-đầu-chuỗi để thao tác 1 lần."""

    task_id: int | None = None
    series_id: int | None = None
    note: str
    due_date: datetime
    status: str
    is_virtual: bool = False
    repeat_freq: str = "none"
    tre: bool = False             # đang mở mà giờ hẹn đã qua
    # Lần nào của chuỗi (khoá ngoại lệ) — gửi lại nguyên văn khi thao tác. Với lần đã dời, khác
    # `due_date`; lấy `due_date` thay vào là thao tác nhầm sang một lần khác.
    occurrence_date: datetime | None = None
    ket_qua: str | None = None    # ghi chú kết quả của lần hẹn
    assignee_user_id: int | None = None
    assignee_name: str | None = None


class CareCalendarOut(BaseModel):
    items: list[CareOccurrenceOut]


class OccurrenceActionIn(BaseModel):
    """Thao tác 1 lần hẹn: complete | cancel | reschedule | ghi (ghi chú kết quả)."""

    action: str
    occurrence_date: datetime | None = None   # lần nào của chuỗi (bắt buộc với hẹn lặp)
    new_due: datetime | None = None           # với reschedule
    log_kind: str | None = Field(default=None, max_length=24)
    log_note: str | None = Field(default=None, max_length=1000)
    # Ghi chú kết quả; None = không đụng, chuỗi rỗng = xoá. Đi kèm complete hoặc action "ghi".
    ket_qua: str | None = Field(default=None, max_length=2000)


class LichHenDong(CareOccurrenceOut):
    """Một lần hẹn trên nút "Lịch hẹn" của danh bạ — như trên lịch của một khách, kèm khách."""

    customer_id: int
    customer_code: str
    customer_name: str


class LichHenOut(BaseModel):
    items: list[LichHenDong]
    so: int = 0              # trễ + hôm nay còn mở trong `items` — số đỏ trên nút
    co_nhom: bool = False    # người xem có thấy hẹn của người khác không (hiện nút Của tôi/Cả nhóm)


# --- Nhập Excel (#23; thay đường CSV cũ 11/09/2026) ---------------------------
#
# `dong` LUÔN là số dòng THẬT trên sheet Excel (tính cả dòng tiêu đề), không phải số thứ tự bản
# ghi: người dùng đang nhìn file trong Excel, nói "dòng 7" thì họ bấm Ctrl+G tới đúng dòng 7.


class NhapExcelLoi(BaseModel):
    """Một dòng KHÔNG ghi được. Còn một dòng lỗi thì cả file không ghi gì."""

    dong: int
    cot: str = ""
    ly_do: str


class NhapExcelCanhBao(BaseModel):
    """Cảnh báo MỀM — vẫn ghi: trùng MST / tên / email (§34: không chặn), gỡ Sale phụ trách, đổi
    cùng lúc tên lẫn MST (nghi trỏ nhầm khách)."""

    dong: int
    ly_do: str


class NhapExcelThayDoi(BaseModel):
    """Một ô sẽ đổi trên một khách ĐÃ CÓ (bản 2, 17/09/2026) — xem trước đọc được "cũ → mới"."""

    dong: int
    ma: str
    ten: str
    cot: str
    cu: str
    moi: str


class NhapExcelOut(BaseModel):
    """Tổng kết một lượt nhập. `preview` và `commit` trả CÙNG hình dạng; khác đúng ở `da_ghi`."""

    hop_le: bool
    tong_dong: int
    tao_moi: int
    cap_nhat: int = 0
    khong_doi: int = 0
    da_ghi: bool
    #: Có ô tài chính đã điền / đã sửa nhưng người nhập không có quyền ⇒ đã bỏ qua đúng mấy cột đó.
    bo_qua_tai_chinh: bool = False
    loi: list[NhapExcelLoi] = []
    canh_bao: list[NhapExcelCanhBao] = []
    thay_doi: list[NhapExcelThayDoi] = []


class ReceivableCard(BaseModel):
    """The read-only Công nợ card on the detail screen (spec-06 KH-04).

    When Công nợ is not built (SEAM-16), `available=False` and every number is None —
    the UI renders "Chưa có phân hệ Công nợ", NOT a fake 0.
    """

    available: bool
    credit_limit: int
    balance: int | None = None
    usage_pct: int | None = None
    over_limit: bool | None = None
    message: str | None = None


class CustomerDetailOut(BaseModel):
    customer: CustomerRow
    receivable: ReceivableCard
    #: Số trên nhãn tab Lịch sử mua hàng / báo giá (mọi trạng thái, mọi thời gian).
    so_don: int = 0
    so_bao_gia: int = 0


class SaleOption(BaseModel):
    """Một người trong hộp chọn "NV phụ trách" (hộp lọc, ô gán khi tạo/sửa, hộp điều chuyển).

    `co_the_gan=False` = người này KHÔNG đủ tư cách nhận khách mới (ngoài khối Kinh doanh / đã
    khoá tài khoản) nhưng vẫn đang giữ khách trong tầm nhìn ⇒ hộp LỌC hiện, ô GÁN ẩn."""

    id: int
    name: str
    # Vai trò + phòng để hộp chọn hiện 2 tầng ("Lê Sale Một" / "NV Sales · Kinh doanh") — cùng một
    # cái tên xuất hiện ở 3 chỗ, không có chức danh thì không biết ai là trưởng ai là nhân viên.
    vai_tro: str | None = None
    phong_ban: str | None = None
    co_the_gan: bool = True
    # Số khách người này đang phụ trách TRONG TẦM NHÌN của người xem (hộp Điều chuyển cần con số
    # này để biết chuyển bao nhiêu; 0 = chưa giữ khách nào).
    so_kh: int = 0


class CustomerReassignIn(BaseModel):
    """Điều chuyển khách hàng (trưởng phòng KD). Hai chế độ:
    - `customer_ids` (checkbox): chuyển các khách được chọn; hoặc
    - `from_sale_user_id`: chuyển TOÀN BỘ khách của một Sale.
    `to_sale_user_id` là nhân viên đích (bắt buộc)."""

    to_sale_user_id: int
    customer_ids: list[int] | None = None
    from_sale_user_id: int | None = None


class CustomerReassignOut(BaseModel):
    moved: int
    skipped: int = 0


# --- Số liệu hồ sơ THEO KỲ (04/10/2026) — thay Dashboard 12 tháng cứng ---------------------
# Mọi khối nhận khoảng ngày [tu, den] và trả kèm CÙNG KỲ NĂM TRƯỚC (`*_cu`). Tiền chỉ cộng đơn
# ĐÃ CHỐT (xem services/khach_hang_so_lieu.py).


class TongDonOut(BaseModel):
    doanh_so: int
    so_don: int
    tb_don: int | None
    so_huy: int
    tien_huy: int


class TongBaoGiaOut(BaseModel):
    so_bg: int
    tong_gia_tri: int
    #: Tỉ lệ chốt = thắng / đã chào (luật ở customer_analytics.CHOT_*).
    thang: int
    da_chao: int
    ti_le: int | None
    #: Số ngày trung bình từ lúc lập báo giá tới đơn đầu tiên sinh ra từ nó.
    tb_ngay_chot: int | None


class CotOut(BaseModel):
    tu: date
    den: date
    doanh_so: int
    so_don: int
    doanh_so_cu: int
    so_don_cu: int


class SanPhamKyOut(BaseModel):
    ten: str
    doanh_so: int
    so_lan: int
    lan_cuoi: date | None
    doanh_so_cu: int


class DiemDonOut(BaseModel):
    ngay: date
    tong: int
    huy: bool


class NhipOut(BaseModel):
    tb_ngay: int
    lan_cuoi: date
    so_ngay_tu_lan_cuoi: int
    nhanh_nhat: int
    lau_nhat: int
    so_don: int
    du_kien: date


class DangChoOut(BaseModel):
    so: int
    tong: int
    sap_het_han: int


class ThongKeKhachOut(BaseModel):
    tu: date
    den: date
    tu_cu: date
    den_cu: date
    #: Bước thật của biểu đồ (có thể thô hơn bước xin nếu kỳ quá dài).
    buoc: str
    don: TongDonOut
    don_cu: TongDonOut
    bao_gia: TongBaoGiaOut
    bao_gia_cu: TongBaoGiaOut
    cot: list[CotOut]
    san_pham: list[SanPhamKyOut]
    nhip: NhipOut | None
    diem_don: list[DiemDonOut]
    dang_cho: DangChoOut


class DongDonOut(BaseModel):
    id: int
    order_no: str
    status: str
    order_kind: str
    tong: int | None
    created_at: datetime
    bao_gia_id: int | None
    bao_gia_ma: str | None
    san_pham: list[str]


class TrangDonOut(BaseModel):
    items: list[DongDonOut]
    tong_so: int
    #: Số đơn theo nhóm (chot/nhap/huy) trong kỳ + ô tìm — số trên các nút lọc.
    dem: dict[str, int]
    tien_chot: int
    tien_huy: int = 0
    trang: int
    co: int


class DongBaoGiaOut(BaseModel):
    id: int
    code: str
    version: int
    status: str
    #: cho / thanh_don / tu_choi / het_han / chua_gui / huy
    nhom: str
    total: int | None
    valid_until: date | None
    created_at: datetime
    don_id: int | None
    don_ma: str | None
    don_ngay: datetime | None


class TrangBaoGiaOut(BaseModel):
    items: list[DongBaoGiaOut]
    tong_so: int
    dem: dict[str, int]
    trang: int
    co: int


# --- Nhật ký khách hàng (unified activity timeline, real events) ---------------


class CustomerAuditRowOut(BaseModel):
    """One entry in a customer's Nhật ký. Merges profile edits (from the audit log) with
    real document events (orders/quotations). `ref_type`/`ref_id` let the UI drill through
    to the source document; profile rows carry neither."""

    at: datetime
    kind: str  # "profile" | "order" | "quote"
    action: str
    title: str
    detail: str
    actor_name: str | None = None
    ref_type: str | None = None  # "order" | "quotation"
    ref_id: int | None = None


class CustomerAuditOut(BaseModel):
    items: list[CustomerAuditRowOut]


# Reuse for created_at exposure if needed later.
__all__ = [
    "CustomerCreate",
    "CustomerUpdate",
    "CustomerFinancialIn",
    "NoteIn",
    "NoteUpdateIn",
    "NoteOut",
    "NotesOut",
    "DuplicateWarn",
    "ContactIn",
    "ContactOut",
    "ContactsOut",
    "AddressIn",
    "AddressOut",
    "AddressesOut",
    "CustomerAttachmentOut",
    "CustomerAttachmentsOut",
    "NhapExcelLoi",
    "NhapExcelCanhBao",
    "NhapExcelOut",
    "CustomerRow",
    "CustomerKpis",
    "CustomerListOut",
    "CustomerCreateOut",
    "CustomerDetailOut",
    "ReceivableCard",
    "DuplicateRef",
    "SaleOption",
    "ThongKeKhachOut",
    "TrangDonOut",
    "DongDonOut",
    "TrangBaoGiaOut",
    "DongBaoGiaOut",
    "CustomerAuditRowOut",
    "CustomerAuditOut",
]
