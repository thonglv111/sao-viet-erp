"""Pydantic schemas for Thu mua MVP."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..services.kho_giay import chuan_kho


def _chuan_kho_dong(obj, *, de_trong: bool):
    """Khổ giấy của một dòng mua: hai cạnh mm chuẩn (ngắn, dài); hàng khác giấy ép 0 · 0.
    `de_trong`: dòng đơn mua không gửi khổ (cả hai None) ⇒ để None cho server chép khổ cần; dòng
    đơn mua chưa gửi mặt hàng (server kế thừa từ dòng yêu cầu) thì chỉ chuẩn hoá, server ép 0 sau."""
    if de_trong and obj.kho_rong is None and obj.kho_dai is None:
        return obj
    if obj.hang_loai is not None and obj.hang_loai != "giay":
        obj.kho_rong, obj.kho_dai = 0, 0
    else:
        obj.kho_rong, obj.kho_dai = chuan_kho(obj.kho_rong, obj.kho_dai)
    return obj


class SupplierItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Gắn về MẶT HÀNG GỐC (mg 0172). Để trống với thứ NCC bán ngoài danh mục vật tư (dịch vụ,
    # gia công) — dòng đó vẫn lưu được, chỉ không vào bảng so giá.
    hang_loai: str | None = Field(default=None, pattern="^(giay|vat_tu)$")
    hang_id: int | None = Field(default=None, gt=0)
    item_name: str = Field(min_length=1, max_length=255)
    unit: str = Field(min_length=1, max_length=32)
    unit_price: int = Field(gt=0)
    vat_percent: float = Field(default=0, ge=0, le=100)
    note: str | None = Field(default=None, max_length=2000)
    # KHỔ giấy (mm): đủ hai cạnh, hoặc chỉ rộng (`r, 0`). Giấy KHÔNG còn dạng bán cuộn/tờ (chủ chốt
    # 10/10/2026) — tờ hay kg là do ĐVT `unit`. Vật tư khác bị ép 0 · 0.
    kho_rong: int = Field(default=0, ge=0)
    kho_dai: int = Field(default=0, ge=0)

    @model_validator(mode="before")
    @classmethod
    def _bo_dang_ban(cls, data):
        # FE cũ còn gửi `dang_ban` trong lúc chuyển — bỏ qua chứ đừng 422 (extra="forbid").
        if isinstance(data, dict) and "dang_ban" in data:
            data = {k: v for k, v in data.items() if k != "dang_ban"}
        return data

    @model_validator(mode="after")
    def _kho_giay(self):
        if self.hang_loai == "giay":
            self.kho_rong, self.kho_dai = chuan_kho(self.kho_rong, self.kho_dai)
        else:
            self.kho_rong, self.kho_dai = 0, 0
        return self


class SupplierItemImportRow(BaseModel):
    """Một mặt hàng ĐỌC ĐƯỢC từ file — chưa vào DB, mới chỉ nạp vào form."""

    item_name: str
    kho_rong: int = 0
    kho_dai: int = 0
    unit: str
    unit_price: int
    vat_percent: float
    note: str | None = None


class SupplierItemImportError(BaseModel):
    #: Số dòng trong file EXCEL (đã tính cả dòng tiêu đề) — người dùng mở file là nhảy đúng chỗ.
    row: int
    message: str


class SupplierItemImportOut(BaseModel):
    """Kết quả ĐỌC file. Dòng hỏng không huỷ dòng lành: `items` và `errors` cùng có mặt."""

    items: list[SupplierItemImportRow] = Field(default_factory=list)
    errors: list[SupplierItemImportError] = Field(default_factory=list)
    total_rows: int = 0


class SupplierIn(BaseModel):
    # MÃ NCC — để trống được. Dùng khớp với mã bên sổ MISA khi đối chiếu công nợ 331
    # (docs/prd-bao-cao-cong-no.md §❷). Chuỗi rỗng ⇒ NULL, xem `_ma_ncc` ở service: hai NCC cùng
    # mã "" sẽ đụng UNIQUE, mà đó không phải lỗi người dùng gây ra.
    code: str | None = Field(default=None, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    tax_code: str = Field(min_length=1, max_length=20)
    phone: str = Field(min_length=1, max_length=30)
    email: str = Field(min_length=1, max_length=255)
    address: str = Field(min_length=1, max_length=500)
    contact_name: str = Field(min_length=1, max_length=255)
    supplier_group: str = Field(min_length=1, max_length=32)
    payment_terms: str | None = Field(default=None, max_length=255)
    # HẠN MỨC công nợ (VNĐ). 0 = không đặt hạn mức ⇒ không bao giờ báo vượt.
    credit_limit: int = Field(default=0, ge=0)
    # ĐỊNH MỨC = số NGÀY cho nợ kể từ ngày giao. 0 = trả ngay · None = CHƯA ĐẶT hạn (đợt giao của
    # NCC này không vào cột Quá hạn). Hai thứ khác nhau, đừng ép None thành 0.
    credit_days: int | None = Field(default=None, ge=0)
    # Cách tính hạn trả (16/10/2026): None = từ ngày hoá đơn; 1–31 = chốt hằng tháng ngày đó
    # (31 = cuối tháng). Thuộc NCC — đơn mua không có điều khoản riêng.
    debt_cutoff_day: int | None = Field(default=None, ge=1, le=31)
    status: str = Field(default="active", max_length=16)
    # Tích "Nhận gia công" (26/09/2026) — ô chọn Nhà gia công ở Kế hoạch SX lọc theo cờ này.
    nhan_gia_cong: bool = False
    note: str | None = Field(default=None, max_length=2000)
    items: list[SupplierItemIn] = Field(default_factory=list)


class SupplierItemRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier_id: int
    # Mặt hàng gốc dòng này bán. None = thứ ngoài danh mục vật tư (dịch vụ, gia công).
    hang_loai: str | None = None
    hang_id: int | None = None
    item_name: str
    kho_rong: int = 0
    kho_dai: int = 0
    unit: str
    unit_price: int
    vat_percent: float
    # Phải phơi ra: ô chọn NCC ở form phiếu mua lọc theo cờ này. Không có nó thì giao diện mời một
    # NCC đã ngưng bán mặt hàng đó, người dùng chọn xong mới bị backend từ chối — bẫy.
    is_active: bool = True
    note: str | None = None
    #: 1 đơn vị NCC bán bằng bao nhiêu ĐƠN VỊ GỐC của mặt hàng. `None` = không quy đổi được
    #: (mặt hàng ngoài danh mục, hoặc thiếu cặp quy đổi) — KHÔNG được coi là 1.
    he_so_ve_goc: float | None = None
    #: Đơn giá đã quy về đ/đơn-vị-gốc = `unit_price ÷ he_so_ve_goc`. Đây là con số DUY NHẤT so
    #: ngang được giữa các NCC báo theo đơn vị khác nhau (1.020.000đ/ram vs 24.500đ/kg).
    #: `None` = chưa quy đổi được ⇒ màn hình phải xếp CUỐI kèm lý do, đừng lặng lẽ dùng giá thô.
    gia_quy_doi: int | None = None
    #: Đơn vị gốc mà `gia_quy_doi` quy về — giấy: "to" (họ tờ) hoặc `don_vi_gia` của mã (kg…),
    #: suy từ `unit` của CHÍNH dòng; vật tư: đơn vị gốc của mặt hàng. "" = không quy đổi được.
    don_vi_goc: str = ""
    created_at: datetime
    updated_at: datetime


class SupplierRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str | None = None
    name: str
    tax_code: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    contact_name: str | None = None
    supplier_group: str | None = None
    payment_terms: str | None = None
    credit_limit: int = 0
    credit_days: int | None = None
    debt_cutoff_day: int | None = None
    status: str
    nhan_gia_cong: bool = False
    note: str | None = None
    created_at: datetime
    updated_at: datetime
    items: list[SupplierItemRow] = Field(default_factory=list)

    # --- SAO ĐÁNH GIÁ: máy tự tính từ phiếu mua hàng, không ai chấm tay ------------------------
    # Luật đầy đủ ở `services/danh_gia_ncc.py`. Ở đây chỉ nhắc một điều dễ làm sai nhất:
    # ⚠️ `rating = null` nghĩa là CHƯA ĐÁNH GIÁ (chưa có đơn nào đủ điều kiện), KHÔNG phải 0 sao.
    # Giao diện phải hiện "Chưa đánh giá", đừng vẽ 0 ngôi sao — đó là vu oan cho NCC mới.
    # Thang sao thấp nhất là 1, nên 0 không bao giờ là một giá trị hợp lệ ở đây.
    rating: float | None = None
    #: Số đơn ĐƯỢC TÍNH vào trung bình (không phải tổng số đơn của NCC).
    rating_count: int = 0
    on_time_count: int = 0
    late_count: int = 0
    #: Trễ trung bình tính TRÊN CÁC ĐƠN TRỄ. `null` = chưa trễ đơn nào.
    avg_late_days: float | None = None


class SupplierListOut(BaseModel):
    items: list[SupplierRow]
    total: int
    page: int
    size: int


class SupplierNhomDem(BaseModel):
    supplier_group: str
    so_ncc: int


class SupplierTongQuanOut(BaseModel):
    tong: int
    dang_hop_tac: int
    tam_ngung: int
    nhom: list[SupplierNhomDem]


class SupplierItemCatalogRow(BaseModel):
    item_name: str
    unit: str
    supplier_count: int
    min_unit_price: int


class SupplierItemCatalogOut(BaseModel):
    items: list[SupplierItemCatalogRow]


# --- So giá NCC theo MẶT HÀNG GỐC (mg 0172) ----------------------------------

class SoGiaRow(BaseModel):
    """1 NCC bán mặt hàng đang xét, giá đã QUY VỀ ĐƠN VỊ GỐC để so ngang."""

    supplier_id: int
    supplier_name: str
    supplier_item_id: int
    kho_rong: int = 0
    kho_dai: int = 0
    #: Đơn vị gốc của `unit` dòng này (giấy: "to" hoặc `don_vi_gia` của mã) — `gia_quy_doi` quy về đây.
    don_vi_goc: str = ""
    #: Cùng họ đơn vị với ĐVT dòng đang mua (`don_vi` gửi lên). Không gửi ⇒ True hết. Dòng khác họ
    #: (tờ vs kg) không so giá ngang được — xếp sau, chọn thì dòng đơn đổi ĐVT + giá theo NCC.
    cung_ho: bool = True
    #: Đúng khổ đang hỏi. False = dòng khổ 0 · 0 (NCC bán mọi khổ) — xếp sau dòng đúng khổ cùng họ.
    #: Không gửi khổ ⇒ True hết.
    dung_kho: bool = True
    unit: str                # MÃ đơn vị NCC bán (ram, thung, cai…)
    unit_ten: str | None = None  # TÊN có dấu để hiển thị ("thùng", "cái"); None = trùng mã / không tra được
    unit_price: int           # giá theo đơn vị đó
    vat_percent: float
    # Giá quy về ĐƠN VỊ GỐC của mặt hàng — cột duy nhất so được giữa các NCC. None = không quy
    # đổi được (đơn vị NCC nằm ngoài tập đổi được); UI phải hiện lý do chứ đừng xếp hạng bừa.
    gia_quy_doi: int | None = None
    gia_quy_doi_vat: int | None = None
    dien_giai: str | None = None
    ly_do: str | None = None


class SoGiaOut(BaseModel):
    hang_loai: str
    hang_id: int
    hang_ma: str | None = None
    hang_ten: str | None = None
    don_vi_goc: str | None = None
    don_vi_goc_ten: str | None = None
    # Sắp: dòng `cung_ho` trước, rồi `gia_quy_doi` tăng dần; dòng không quy đổi được xếp cuối nhóm.
    items: list[SoGiaRow] = []


class PurchaseRequestLineIn(BaseModel):
    # Mặt hàng gốc (mg 0174). Client thường KHÔNG gửi — server tự kế thừa từ dòng YCMH nguồn
    # (`_chot_noi_dong`). Gửi thì thắng, vì thu mua đổi mặt hàng khi lập phiếu là hợp lệ.
    hang_loai: str | None = Field(default=None, pattern="^(giay|vat_tu)$")
    hang_id: int | None = Field(default=None, gt=0)
    item_name: str = Field(min_length=1, max_length=255)
    unit: str = Field(min_length=1, max_length=32)
    quantity: float = Field(gt=0)
    expected_unit_price: int = Field(gt=0)
    discount_percent: float = Field(default=0, ge=0, le=100)
    vat_percent: float = Field(default=0, ge=0, le=100)
    note: str | None = Field(default=None, max_length=2000)
    # Dòng YCMH đẻ ra dòng này. Không bắt buộc — thu mua vẫn được thêm dòng ngoài yêu cầu, và
    # phiếu lập trước 05/08/2026 không có. Server chốt id phải thuộc đúng yêu cầu nguồn.
    department_request_line_id: int | None = Field(default=None, gt=0)
    #: Khổ MUA (mm) của giấy tờ. KHÔNG gửi ⇒ server chép khổ cần của dòng YCMH nguồn.
    kho_rong: int | None = Field(default=None, ge=0)
    kho_dai: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _kho(self):
        return _chuan_kho_dong(self, de_trong=True)


class DepartmentPurchaseRequestLineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Mặt hàng gốc (mg 0174) — bảng cân đối vật tư gửi kèm khi bấm "Đề nghị mua", nhờ đó phiếu mua
    # sinh ra sau đó biết mình đang mua đúng lô giấy nào mà không phải ghép bằng tên.
    hang_loai: str | None = Field(default=None, pattern="^(giay|vat_tu)$")
    hang_id: int | None = Field(default=None, gt=0)
    item_name: str = Field(min_length=1, max_length=255)
    unit: str = Field(min_length=1, max_length=32)
    quantity: float = Field(gt=0)
    note: str | None = Field(default=None, max_length=2000)
    #: Khổ CẦN (mm) của giấy tờ — Kế hoạch vật tư gửi theo dòng cân đối; vật tư khác ép 0 · 0.
    kho_rong: int = Field(default=0, ge=0)
    kho_dai: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _kho(self):
        return _chuan_kho_dong(self, de_trong=False)


class YeuCauMuaNguonLenhIn(BaseModel):
    """Mặt hàng này mua cho lệnh/bài nào — Kế hoạch vật tư gửi kèm khi mở form "Đề nghị mua".

    Đúng khoá dòng của bảng cân đối (`_khoa_dong`). Server chỉ giữ liên kết có mặt hàng trùng một
    dòng của yêu cầu."""

    model_config = ConfigDict(extra="forbid")

    hang_loai: str = Field(pattern="^(giay|vat_tu)$")
    hang_id: int = Field(gt=0)
    #: Khổ của dòng giấy (0 · 0 với vật tư khác) — `_khoa_dong` mang khổ từ spec giấy tờ × khổ.
    kho_rong: int = Field(default=0, ge=0)
    kho_dai: int = Field(default=0, ge=0)
    #: MÃ đơn vị gốc của ô (phần thứ năm của khoá, mg 0391) — giấy tờ vs kg, keo kg vs thùng là hai
    #: ô. Xem-trước trả về trong `nguon`, form gửi lại nguyên văn. Rỗng = liên kết cũ, khớp mọi gốc.
    don_vi_goc: str = Field(default="", max_length=16)
    lsx_id: int | None = Field(default=None, gt=0)
    bai_ghep_id: int | None = Field(default=None, gt=0)
    buoc_id: int | None = Field(default=None, gt=0)
    #: Số đề nghị cho dòng này, đơn vị gốc của mặt hàng (mg 0378). Đơn mua lập từ yêu cầu chia
    #: "phần đặt cho lệnh" theo số này. Thiếu ⇒ chia theo số cần hiện tại của ô.
    so_luong: float | None = Field(default=None, ge=0)


class DepartmentPurchaseRequestIn(BaseModel):
    source_type: str | None = Field(default=None, max_length=32)
    # Ô GỘP "Nội dung / mục đích" (07/08/2026). Client cũ còn gửi `purpose` + `note`, server nối
    # lại — bắt mọi nơi gọi API đổi cùng lúc với giao diện là chuyện không xảy ra được.
    content: str | None = Field(default=None, max_length=4000)
    related_document_type: str | None = Field(default=None, max_length=64)
    related_document_code: str | None = Field(default=None, max_length=64)
    purpose: str | None = Field(default=None, max_length=500)
    needed_date: date
    note: str | None = Field(default=None, max_length=2000)
    lines: list[DepartmentPurchaseRequestLineIn] = Field(min_length=1)
    # Chỉ đọc lúc TẠO (mg 0325). Form sửa không gửi, và có gửi thì cũng bỏ qua: "mua cho lệnh nào"
    # là sự thật lúc lập, sửa số lượng không đổi nó.
    nguon_lenh: list[YeuCauMuaNguonLenhIn] = Field(default_factory=list, max_length=500)
    #: Loại mua (08/10/2026): theo_yeu_cau | mua_ton. `cho_lsx` máy chủ tự đặt khi có `nguon_lenh`.
    loai_mua: str | None = Field(default=None, max_length=16)


class PurchaseRequestIn(BaseModel):
    supplier_id: int = Field(gt=0)
    content: str | None = Field(default=None, max_length=4000)
    source_request_ids: list[int] = Field(min_length=1)
    purpose: str | None = Field(default=None, max_length=500)
    needed_date: date
    expected_receipt_date: date | None = None
    note: str | None = Field(default=None, max_length=2000)
    lines: list[PurchaseRequestLineIn] = Field(min_length=1)


class PurchaseRequestBatchLineIn(PurchaseRequestLineIn):
    """Dòng hàng ĐÃ GÁN nhà cung cấp — dùng cho đường tạo cả mẻ.

    Một phiếu mua là thoả thuận với MỘT nhà cung cấp, nên khi yêu cầu chứa hàng của nhiều nơi thì
    phải tách thành nhiều phiếu. Gán NCC ở đây, backend nhóm lại rồi đẻ phiếu."""

    supplier_id: int = Field(gt=0)


class PurchaseRequestBatchIn(BaseModel):
    """Tạo NHIỀU phiếu mua trong MỘT lần, nhóm theo nhà cung cấp của từng dòng.

    Vì sao không để giao diện gọi API tạo phiếu nhiều lần: tạo phiếu đầu là yêu cầu nguồn bị GIỮ
    CHỖ ngay, lần gọi thứ hai cho NCC khác sẽ bị chặn. Gộp một lần cũng để hỏng thì hỏng cả mẻ,
    không để lại phiếu mồ côi."""

    source_request_ids: list[int] = Field(min_length=1)
    content: str | None = Field(default=None, max_length=4000)
    purpose: str | None = Field(default=None, max_length=500)
    needed_date: date
    expected_receipt_date: date | None = None
    note: str | None = Field(default=None, max_length=2000)
    lines: list[PurchaseRequestBatchLineIn] = Field(min_length=1)


class StatusHistoryOut(BaseModel):
    """Một lần đổi trạng thái. `source='may'` ⇒ hệ TỰ SUY, `changed_by_name` để trống."""

    id: int
    from_status: str | None = None
    to_status: str
    source: str
    changed_by_name: str | None = None
    reason: str | None = None
    created_at: datetime


class PurchaseActivityOut(BaseModel):
    """Một mốc trong lịch sử ĐƠN MUA.

    Lịch sử trạng thái chỉ trả lời đơn đã đi từ trạng thái nào sang trạng thái nào. Đợt giao là
    sự kiện nghiệp vụ riêng: giao thêm một đợt có thể vẫn giữ trạng thái ``Giao một phần`` nhưng
    người dùng vẫn cần thấy nó trong chi tiết đơn.
    """

    id: str
    event_type: str
    title: str
    detail: str | None = None
    actor_name: str | None = None
    source: str | None = None
    from_status: str | None = None
    to_status: str | None = None
    reason: str | None = None
    created_at: datetime


class MuaChoLenhOut(BaseModel):
    """Một lệnh (hoặc bài ghép) mà món / dòng đơn mua này mua cho — cột "Mua cho" (08/10/2026)."""

    loai: str  # lsx | bai
    id: int
    ma: str
    #: Số đề nghị cho lệnh này, đơn vị gốc của dòng yêu cầu. None = liên kết lập trước mg 0378.
    so_luong: float | None = None


class PurchaseRequestLineOut(BaseModel):
    id: int
    item_name: str
    unit: str
    quantity: float
    # None = chưa khai lúc nhận hàng ⇒ hiểu là nhận đủ `quantity`.
    received_quantity: float | None = None
    expected_unit_price: int
    discount_percent: float
    discount_amount: int
    vat_percent: float
    vat_amount: int
    line_total: int
    note: str | None = None
    # Dòng YCMH đẻ ra dòng này (mg 0174b) — client cần lại để chi tiết yêu cầu hiện đúng tình
    # trạng từng sản phẩm, và để form SỬA gửi lại đúng liên kết thay vì làm rỗng nó. Phải khai ở
    # ĐÂY nữa: service trả dict + `response_model` ⇒ field không có trong schema Out bị Pydantic bỏ
    # IM LẶNG, API trả 201 mà người gọi nhận `undefined`, và test sửa đơn mua đứt-liên-kết đỏ.
    department_request_line_id: int | None = None
    # Liên kết MẶT HÀNG GỐC (mg 0174) — để Nhập kho từ đợt giao TỰ ĐIỀN vật tư thay vì bỏ trống.
    # None khi dòng mua chỉ có tên chữ (không link danh mục) → kho phải chọn tay.
    hang_loai: str | None = None
    hang_id: int | None = None
    hang_ma: str | None = None
    hang_ten: str | None = None
    #: Khổ MUA (mm) — giấy tờ; vật tư khác 0 · 0. Nhập kho từ đợt giao chép sang yêu cầu nhập.
    kho_rong: int = 0
    kho_dai: int = 0
    #: Mua cho: loại mua + yêu cầu của món mà dòng trỏ tới, và các lệnh. None = dòng không nối món.
    loai_mua: str | None = None
    yeu_cau_ma: str | None = None
    mua_cho: list[MuaChoLenhOut] = Field(default_factory=list)


class LineFulfilmentOut(BaseModel):
    """Một dòng yêu cầu đã vào phiếu nào, của NCC nào, tới đâu rồi."""

    purchase_request_id: int
    purchase_code: str
    purchase_status: str
    supplier_name: str | None = None
    ordered_quantity: float
    ordered_unit: str
    # None = chưa khai lúc nhận hàng ⇒ hiểu là nhận đủ `ordered_quantity`.
    received_quantity: float | None = None


class DepartmentPurchaseRequestLineOut(BaseModel):
    id: int
    # Form sửa YCMH cần đúng cặp này để nạp lại dropdown ĐVT của chính mặt hàng đã chọn.
    # Chỉ trả tên + ĐVT sẽ làm ô ĐVT bị khóa dù bản ghi vẫn có đơn vị.
    hang_loai: str | None = None
    hang_id: int | None = None
    #: Khổ CẦN (mm) — giấy tờ; vật tư khác 0 · 0.
    kho_rong: int = 0
    kho_dai: int = 0
    item_name: str
    unit: str
    quantity: float
    expected_unit_price: int
    line_total: int
    note: str | None = None
    # None = dòng chưa vào phiếu nào, HOẶC phiếu lập trước 05/08/2026 (chưa có nối dòng ↔ dòng).
    # Giao diện phải phân biệt hai ca, đừng hiện như nhau.
    fulfilment: LineFulfilmentOut | None = None
    # HUỶ TỪNG MÓN (mg 0233). `cancelled_at` khác None = món này đã bị bỏ khỏi yêu cầu; nó vẫn
    # nằm trong danh sách (gạch ngang + lý do) chứ không biến mất — biến mất là người xem tưởng
    # mình nhớ nhầm.
    cancelled_at: datetime | None = None
    cancelled_by_name: str | None = None
    cancel_reason: str | None = None
    # Luật "món này bỏ được không" tính ở máy chủ. `can_cancel=False` kèm `cancel_block_reason`
    # ⇒ giao diện vẫn BÀY nút, chỉ khoá lại và in đúng câu này (đừng ẩn nút — khoá và nói lý do).
    can_cancel: bool = False
    cancel_block_reason: str | None = None
    #: Các lệnh mà món này mua cho (rỗng với Mua tồn / Theo yêu cầu).
    mua_cho: list[MuaChoLenhOut] = Field(default_factory=list)


class DepartmentRequestPurchaseOut(BaseModel):
    id: int
    code: str
    status: str
    supplier_name: str | None = None


class DepartmentPurchaseRequestOut(BaseModel):
    id: int
    code: str
    status: str
    # Trạng thái nghiệp vụ dùng để HIỂN THỊ/LỌC, suy từ các đơn mua con.
    # Không ghi đè `status`: `status` vẫn là trạng thái tổng hợp được lưu để khóa luồng.
    # Từ mg 0233 nó còn nhận giá trị `partially_cancelled` — ĐÈ lên nhãn tiến độ khi có món bị bỏ.
    workflow_status: str
    # Nhãn tiến độ THUẦN, không bị "Huỷ một phần" che. Giao diện in nó thành dòng chữ nhỏ dưới huy
    # hiệu để không mất thông tin "phần còn lại đang tới đâu".
    progress_status: str
    cancelled_line_count: int = 0
    active_line_count: int = 0
    source_type: str
    loai_mua: str = "theo_yeu_cau"
    #: Gộp lệnh của mọi món còn sống.
    mua_cho: list[MuaChoLenhOut] = Field(default_factory=list)
    requesting_department_id: int | None = None
    requesting_department_name: str | None = None
    requested_by_user_id: int | None = None
    requested_by_name: str | None = None
    related_document_type: str | None = None
    related_document_code: str | None = None
    purpose: str
    content: str | None = None
    reject_reason: str | None = None
    status_history: list[StatusHistoryOut] = Field(default_factory=list)
    needed_date: date
    note: str | None = None
    created_at: datetime
    updated_at: datetime
    total_estimate: int
    lines: list[DepartmentPurchaseRequestLineOut]
    # Các phiếu mua sinh ra từ yêu cầu này — luôn có, kể cả khi `fulfilment` theo dòng còn rỗng.
    purchase_requests: list[DepartmentRequestPurchaseOut] = []


class DepartmentPurchaseRequestListOut(BaseModel):
    items: list[DepartmentPurchaseRequestOut]
    total: int
    page: int
    size: int
    # Số yêu cầu theo trạng thái hiển thị (`workflow_status`) + `tat_ca` — cùng bộ lọc, chưa lọc
    # trạng thái (06/10/2026).
    dem_theo_tab: dict[str, int] | None = None


class YeuCauMonOut(BaseModel):
    """Một MÓN của yêu cầu mua hàng — dòng của chế độ "Xem theo: Từng món" (phương án 3, 07/10/2026).

    `tinh_trang`: cho_lap | nhap | cho_duyet | tra_lai | cho_hang | mot_phan | du | nhap_kho | huy.
    `tien_do`: 0 → 5 nấc (có đơn, duyệt, đặt NCC, hàng về, nhập kho); 3.5 = về một phần.
    `chon_duoc`: tick được để lập đơn — yêu cầu còn chờ lập đơn, món còn sống, chưa vào đơn nào
    còn sống. Chỉ nói về tình trạng MÓN; quyền lập đơn của người xem thì giao diện tự AND thêm."""

    line_id: int
    request_id: int
    request_code: str
    request_status: str
    content: str | None = None
    requesting_department_name: str | None = None
    requested_by_name: str | None = None
    created_at: datetime
    needed_date: date
    hang_loai: str | None = None
    hang_id: int | None = None
    kho_rong: int = 0
    kho_dai: int = 0
    item_name: str
    unit: str
    quantity: float
    note: str | None = None
    purchase_request_id: int | None = None
    purchase_code: str | None = None
    purchase_status: str | None = None
    supplier_name: str | None = None
    ordered_quantity: float | None = None
    received_quantity: float | None = None
    tinh_trang: str
    tien_do: float
    chon_duoc: bool
    cancel_reason: str | None = None
    loai_mua: str = "theo_yeu_cau"
    mua_cho: list[MuaChoLenhOut] = Field(default_factory=list)


class YeuCauMonListOut(BaseModel):
    items: list[YeuCauMonOut]
    total: int
    page: int
    size: int
    # Số món theo `tinh_trang` + `tat_ca` — cùng bộ lọc, chưa lọc tình trạng.
    dem_theo_tab: dict[str, int]
    # Số yêu cầu khác nhau có món trong bộ lọc (chân bảng: "x món của y yêu cầu").
    so_yeu_cau: int


class LuaChonLocMa(BaseModel):
    """Một lựa chọn của ô lọc mà khoá không phải một id số — vd mặt hàng `giay:12` (cặp
    `hang_loai`, `hang_id`). Cùng hình với `LuaChonLoc`, chỉ đổi `id` thành `ma` kiểu chuỗi."""

    ma: str
    ten: str
    so: int = 0


class PurchaseRequestSourceOut(BaseModel):
    id: int
    department_request_id: int
    code: str
    status: str | None = None
    source_type: str | None = None
    loai_mua: str | None = None
    content: str | None = None
    purpose: str | None = None
    needed_date: date | None = None
    requesting_department_name: str | None = None
    requested_by_name: str | None = None


class PurchaseDeliveryLineOut(BaseModel):
    id: int
    purchase_request_line_id: int
    item_name: str
    unit: str
    #: SL thực nhận của đợt. Từ 28/08/2026 ĐƯỢC PHÉP vượt số đặt.
    quantity: float
    #: Phần sinh tiền của `quantity` (máy chia luỹ kế — xem `phan_bo_du_dot`).
    quantity_tinh_tien: float = 0
    #: Phần DƯ, giá 0đ. `quantity_tinh_tien + quantity_du == quantity`.
    quantity_du: float = 0
    #: Đơn giá chốt trên dòng đơn (chưa CK/VAT) và thành tiền phần tính tiền của dòng (đã CK/VAT) —
    #: đúng số `phan_bo_du_dot` cộng vào giá trị đợt.
    don_gia: int = 0
    thanh_tien: int = 0
    #: KHỔ THỰC NHẬN (giấy tờ): khổ lưu ở đợt, hoặc khổ đặt khi đợt không ghi. 0 · 0 với hàng khác.
    kho_rong: int = 0
    kho_dai: int = 0
    #: NCC giao khác khổ đặt — hàng vào tồn theo khổ nhận.
    khac_kho_dat: bool = False
    note: str | None = None


class PurchaseDepositVoucherOut(BaseModel):
    """Một lần chi cho đơn: phiếu ĐẶT CỌC (form phiếu chi cảnh báo trùng) hoặc phiếu trả ĐỢT (lịch sử
    popup chi tiết khoản). `amount` là phần của đơn/đợt này — phiếu gộp (`gop`) chỉ góp phần dòng."""

    voucher_id: int | None = None
    code: str
    doc_no: str | None = None
    amount: int
    voucher_date: date
    gop: bool = False


class PurchaseDeliveryOut(BaseModel):
    id: int
    seq_no: int
    # Liên thông Kho: đợt đã sinh yêu cầu NHẬP (chưa hủy) chưa → nút "Nhập kho" đổi "Đã nhập kho".
    da_nhap_kho: bool = False
    stock_request_id: int | None = None
    stock_request_ma: str | None = None
    # Nấc kho (11/10/2026): cho_gui_kho | kho_chua_nhap | da_nhap_kho — yêu cầu nhập Hoàn tất mới là
    # đã nhập; `da_nhap_kho` ở trên chỉ nghĩa là ĐÃ GỬI yêu cầu.
    kho: str = "cho_gui_kho"
    delivery_date: date
    due_date: date | None = None
    # True = NCC chưa khai số ngày cho nợ ⇒ đợt này không bao giờ vào cột Quá hạn. Màn hình phải
    # đẩy nó lên đầu kèm badge, không để chìm — im lặng ở đây là một món nợ không ai canh.
    chua_dat_han: bool = False
    invoice_symbol: str | None = None
    invoice_number: str | None = None
    invoice_date: date | None = None
    note: str | None = None
    # Thành tiền của đợt — MÁY TÍNH từ số lượng × đơn giá/CK/VAT đã chốt trên phiếu, không ai gõ
    # tay (chủ chốt 07/08/2026, đảo lại quyết định 06/08).
    amount: int
    paid_amount: int = 0
    # Cọc của cả đơn chiếu xuống đợt này, và phần CÒN NỢ sau khi trừ cả hai.
    # `con_no` là TRẦN lập phiếu chi thanh toán cho đợt — form phải bám nó, KHÔNG bám công nợ cả
    # đơn (lỗi 07/08/2026: trả thừa cho đợt 2 xoá sổ luôn nợ của đợt 1).
    coc_bu: int = 0
    con_no: int = 0
    phieu_chi: list[PurchaseDepositVoucherOut] = Field(default_factory=list)
    # Đợt giao đẻ ra công nợ ⇒ phải truy được ai khai, lúc nào.
    created_by_name: str | None = None
    created_at: datetime | None = None
    lines: list[PurchaseDeliveryLineOut] = Field(default_factory=list)


class PurchaseAttachmentOut(BaseModel):
    id: int
    delivery_id: int | None = None
    kind: str
    file_name: str
    file_url: str
    file_type: str | None = None
    uploaded_by_name: str | None = None
    uploaded_at: datetime


class PurchaseDeliveryLineIn(BaseModel):
    purchase_request_line_id: int
    quantity: float = Field(gt=0)
    # Khổ thực nhận của dòng giấy tờ — bỏ trống (0 · 0) = đúng khổ đặt.
    kho_rong: int = Field(default=0, ge=0)
    kho_dai: int = Field(default=0, ge=0)
    note: str | None = Field(default=None, max_length=2000)


class PurchaseDeliveryIn(BaseModel):
    delivery_date: date
    invoice_symbol: str | None = Field(default=None, max_length=64)
    invoice_number: str | None = Field(default=None, max_length=64)
    invoice_date: date | None = None
    note: str | None = Field(default=None, max_length=2000)
    # None khi SỬA = giữ nguyên các dòng hàng, chỉ đổi phần đầu đợt (ngày, hoá đơn).
    # Hạn trả KHÔNG nhận từ ngoài (16/10/2026): máy tính theo điều khoản NCC lúc ghi/sửa đợt.
    lines: list[PurchaseDeliveryLineIn] | None = None


class PurchaseInvoiceAssignIn(BaseModel):
    """Gán MỘT hoá đơn cho NHIỀU đợt giao — ca NCC giao 3 đợt rồi mới xuất một hoá đơn chung."""

    delivery_ids: list[int] = Field(min_length=1)
    invoice_symbol: str | None = Field(default=None, max_length=64)
    invoice_number: str | None = Field(default=None, max_length=64)
    invoice_date: date | None = None


class PurchaseSubmitIn(BaseModel):
    # Cọc CHỐT lúc gửi duyệt (15/10/2026): người duyệt đồng ý đúng con số này. None = giữ số đang
    # có trên đơn (gọi cũ không gửi thân).
    deposit_expected: int | None = Field(default=None, ge=0)


class PurchaseContractIn(BaseModel):
    contract_number: str | None = Field(default=None, max_length=64)
    # Cọc DỰ KIẾN — chỉ để đối chiếu, KHÔNG vào công thức công nợ (cọc thật là phiếu chi).
    deposit_expected: int = Field(default=0, ge=0)


class SupplierCreditOut(BaseModel):
    #: Điều khoản thanh toán khai ở danh mục NCC — chữ tự do ("Công nợ 30 ngày", "Thanh toán ngay").
    payment_terms: str | None = None
    credit_limit: int = 0
    credit_days: int | None = None
    no_hien_tai: int = 0
    vuot_han_muc: bool = False
    vuot_bao_nhieu: int = 0


class PurchaseRequestOut(BaseModel):
    id: int
    code: str
    status: str
    supplier_id: int | None = None
    supplier_name: str | None = None
    purpose: str | None = None
    needed_date: date | None = None
    expected_receipt_date: date | None = None
    #: Điều khoản trả của NCC (16/10/2026 — thuộc NCC, đơn không có điều khoản riêng): số ngày cho
    #: nợ + ngày chốt hằng tháng (1–31, 31 = cuối tháng; None = tính từ ngày hoá đơn).
    supplier_credit_days: int | None = None
    supplier_debt_cutoff_day: int | None = None
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    submitted_at: datetime | None = None
    approved_by_user_id: int | None = None
    approved_by_name: str | None = None
    approved_at: datetime | None = None
    note: str | None = None
    created_at: datetime
    updated_at: datetime
    content: str | None = None
    reject_reason: str | None = None
    status_history: list[StatusHistoryOut] = Field(default_factory=list)
    # Timeline này gồm đổi trạng thái VÀ các lần ghi/sửa/xóa đợt giao.
    activity_history: list[PurchaseActivityOut] = Field(default_factory=list)
    contract_number: str | None = None
    deposit_expected: int = 0
    total_estimate: int
    # Giá trị hàng THỰC NHẬN (theo số đã khai / Σ đợt giao).
    received_total: int = 0
    # Giá trị hàng ĐÃ VỀ — số đẻ ra công nợ. Đơn chưa giao đợt nào thì = 0 dù đơn to bao nhiêu.
    gia_tri_da_giao: int = 0
    paid_amount: int
    receipt_received_amount: int = 0
    net_paid: int = 0
    # = CÔNG NỢ của phiếu, và cũng là trần lập phiếu chi THANH TOÁN.
    outstanding_amount: int
    # Trần lập phiếu ĐẶT CỌC — theo giá trị đơn đặt, vì cọc là chi khi hàng chưa về.
    tran_dat_coc: int = 0
    # Phiếu đặt cọc ĐÃ lập cho đơn này. Dùng để CẢNH BÁO khi lập phiếu cọc thứ hai — không chặn:
    # ứng thêm là ca có thật, và mỗi lần tiền rời két phải có chứng từ riêng.
    coc_da_lap: list[PurchaseDepositVoucherOut] = Field(default_factory=list)
    coc_da_chi: int = 0
    #: Cọc đã chi mà CHƯA bù vào đợt giao nào — đợt ghi tiếp theo sẽ được trừ phần này trước.
    coc_chua_bu: int = 0
    payment_status: str
    nhom_tien: str | None = None
    payment_voucher_count: int
    sources: list[PurchaseRequestSourceOut]
    lines: list[PurchaseRequestLineOut]
    #: Mua cho của cả đơn: các loại có mặt (cho_lsx, mua_ton, theo_yeu_cau theo thứ tự đó) và lệnh gộp.
    loai_mua_cac: list[str] = Field(default_factory=list)
    mua_cho: list[MuaChoLenhOut] = Field(default_factory=list)
    deliveries: list[PurchaseDeliveryOut] = Field(default_factory=list)
    attachments: list[PurchaseAttachmentOut] = Field(default_factory=list)


class PurchaseRequestListOut(BaseModel):
    items: list[PurchaseRequestOut]
    total: int
    page: int
    size: int
    # Số phiếu theo trạng thái (cùng bộ lọc, chưa lọc trạng thái) + `tat_ca` — chỉ hộp Đơn mua hàng
    # của Kế toán trả; nơi khác để None.
    dem_theo_tab: dict[str, int] | None = None
    # Số đơn theo nhóm TIỀN (chua_tra | mot_phan | qua_han | da_tra) — cùng bộ lọc, trước khi lọc
    # nhóm Hàng lẫn nhóm Tiền. Đơn chưa phát sinh nợ không vào nhóm nào.
    dem_theo_tien: dict[str, int] | None = None


class MuaHangChoChiOut(BaseModel):
    """Một dòng tab "Mua hàng chờ chi" (màn Phiếu chi): ĐƠN + khoản còn phải chi của đơn đó.
    `don` là nguyên dòng đơn như hộp Đơn mua hàng — form lập phiếu chi dùng thẳng, các đợt còn nợ
    đọc ở `don.deliveries[].con_no`."""

    don: PurchaseRequestOut
    # Cọc khai lúc gửi duyệt còn chưa chi (không quá phần giá trị đơn còn chưa trả).
    coc_can_chi: int
    # Số đợt giao còn nợ và tổng nợ của chúng (đã trừ phần cọc bù vào đợt).
    so_dot_no: int
    no_dot: int
    tong_can_chi: int
    # Hạn trả gần nhất trong các đợt còn nợ; None = chưa có đợt nào (chỉ còn cọc).
    han_gan_nhat: date | None = None
    qua_han: bool = False


class PurchaseNotifySummaryOut(BaseModel):
    """Badge Thu mua (sidebar `mua-hang`). FE cộng thẳng ba số — nên mọi con số người gọi KHÔNG
    được thấy phải là 0, đừng để FE tự nhớ luật che."""

    # YCMH đang *Chờ mua* — việc đang nằm trên bàn thu mua.
    ycmh_cho_lap_phieu: int = 0
    # PMH bị từ chối đang chờ Thu mua sửa và gửi lại chính phiếu đó. Dễ bị bỏ quên nhất.
    pmh_bi_tu_choi: int = 0
    # Đợt giao quá hạn trả mà còn nợ. 0 với người KHÔNG có `ke_toan:read` — không rò công nợ.
    dot_giao_qua_han: int = 0


class ReasonIn(BaseModel):
    reason: str | None = Field(default=None, max_length=2000)


class ReceivedLineIn(BaseModel):
    line_id: int
    # None = xoá khai báo, quay về "nhận đủ".
    received_quantity: float | None = Field(default=None, ge=0)


class ReceivedLinesIn(BaseModel):
    """Số thực nhận từng dòng. Bỏ trống `lines` = nhận đủ như đã đặt (đường gọi cũ vẫn chạy)."""

    lines: list[ReceivedLineIn] = Field(default_factory=list)
