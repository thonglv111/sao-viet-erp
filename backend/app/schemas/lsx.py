"""Pydantic schemas — Lệnh sản xuất (LSX).

3 nhóm: (a) HÀNG CHỜ = đơn Sale đã chuyển xuống SX còn dòng chưa lên lệnh; (b) PREVIEW = danh sách
lệnh DỰ KIẾN dẫn xuất tại chỗ từ dòng đơn + phiếu tính giá (chưa ghi DB); (c) LSX = lệnh đã tạo
(kèm routing + checklist thiếu).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field



# ============================ Hàng chờ ============================
class HangChoItem(BaseModel):
    order_id: int
    order_no: str
    customer_name: str | None = None
    sale_name: str | None = None
    delivery_committed_date: date | None = None
    is_rush: bool = False
    production_note: str | None = None
    san_xuat_released_at: datetime | None = None
    created_at: datetime | None = None   # ngày tạo đơn — cột "Ngày tạo" + mốc kỳ `tao`
    so_dong: int = 0        # tổng dòng đơn
    so_dong_co_lsx: int = 0  # dòng đã lên lệnh
    # Tên các hạng mục của đơn (OrderLine.description, bỏ trùng) — service đã trả từ lâu nhưng
    # schema thiếu nên Pydantic nuốt im lặng, cột "Sản phẩm" của hàng chờ luôn trống.
    san_pham_tom_tat: str | None = None


class HangChoOut(BaseModel):
    items: list[HangChoItem]
    total: int          # TỔNG số đơn còn nợ lệnh, không phải số dòng của trang
    page: int = 1
    size: int = 50


# ============================ Preview (lệnh dự kiến) ============================
class PreviewRouting(BaseModel):
    thu_tu: int
    ten: str
    nhom: str | None = None
    # Cùng bộ mã với `LsxCongDoanOut.loai_buoc` — THAY cờ `thue_ngoai` cũ để màn "lệnh dự kiến"
    # và màn lệnh đã tạo hiển thị giống nhau (`thue_ngoai` chỉ là một giá trị của trường này).
    loai_buoc: str = "may"
    department_id: int | None = None
    department_ten: str | None = None
    nha_cung_cap: str | None = None


class PreviewLine(BaseModel):
    order_line_id: int
    ten: str
    so_luong_dat: int
    don_vi_tinh: str
    phieu_thanh_phan_id: int | None = None
    ptg_ma: str | None = None
    # Nhãn nhóm (ruột + bìa của 1 cuốn) — CHỈ để gom hiển thị cho dễ đọc. Sản xuất vẫn tạo
    # 1 LỆNH cho MỖI dòng: ruột và bìa chạy máy khác nhau, không gộp được.
    nhom: str | None = None
    # Số của engine chạy lại theo SL của ĐƠN (không lấy số lúc tính giá).
    # None = CHƯA tính được (dòng chưa có bài tính giá) → UI hiện "—", KHÔNG bày số 0 giả.
    bu_hao_to: int | None = None
    so_to_ke_hoach: int | None = None
    so_to_nguyen: int | None = None
    so_con: int | None = None
    so_kem: int | None = None
    so_luot: int | None = None
    # MÃ đơn vị từng chặng dòng giấy của DÒNG NÀY (`don_vi_chuoi`). Bảng hàng chờ xếp nhiều dòng
    # đơn cạnh nhau, mỗi dòng có thể đếm bằng đơn vị khác — nên đơn vị đi theo dòng, không nằm ở
    # tiêu đề cột. Gửi MÃ, client tra tên trong danh mục Đơn vị. None = routing không nói tới chặng
    # đó (vd không có bước xả giấy) ⇒ client dùng nhãn mặc định.
    don_vi_to: str | None = None
    don_vi_to_nguyen: str | None = None
    don_vi_tp: str | None = None
    don_vi_tay: str | None = None
    routing: list[PreviewRouting] = Field(default_factory=list)
    quy_cach: dict | None = None
    # SL lúc tính giá khác SL đơn → cảnh báo mềm (vẫn lấy số của đơn).
    sl_ptg: int | None = None
    # Đã tạo lệnh rồi → khoá dòng.
    lsx_id: int | None = None
    lsx_ma: str | None = None
    # Kho đang có bao nhiêu SẢN PHẨM BÁN này của khách (11/10/2026, mg 0394): tồn của mã thành phẩm
    # trừ phần các yêu cầu giao (mọi đơn) đang giữ chưa xuất. Tính theo CỤM — ruột và bìa cùng một
    # cuốn mang cùng số, đơn vị là đơn vị cụm (`ton_dvt`). None = khách chưa từng có mã này.
    ton_san: float | None = None
    ton_dvt: str | None = None


class PreviewOut(BaseModel):
    order_id: int
    order_no: str
    customer_name: str | None = None
    sale_name: str | None = None
    delivery_committed_date: date | None = None
    is_rush: bool = False
    production_note: str | None = None
    lines: list[PreviewLine]


class TaoLsxIn(BaseModel):
    order_line_ids: list[int] = Field(default_factory=list)


# ============================ LSX ============================
class LeadTimeOut(BaseModel):
    """Tổng thời gian dẫn của cả lệnh — DẪN XUẤT, không lưu cột."""

    tong_phut: float = 0
    chiem_may_phut: float = 0     # phần ĂN capacity máy/tổ (không gồm chờ, di chuyển)
    so_ngay: float = 0            # quy ước 8h/ngày, CHƯA trừ nghỉ lễ/ca kíp
    ngay_du_kien_xong: date | None = None
    ngay_con_lai: int | None = None   # tới `han_giao_khach`; âm = đã trễ


class LsxBuocVatTuIn(BaseModel):
    # DANH MỤC nào chứa món — `"giay"` (NVL chính, người lập lệnh tự chọn) hay `"vat_tu"`
    # (mực/keo/màng, bung từ đầu việc). Mặc định `"vat_tu"`: client cũ không gửi thì hiểu y như
    # trước khi bước chọn được NVL chính (08/09/2026).
    hang_loai: Literal["giay", "vat_tu"] = "vat_tu"
    vat_tu_id: int
    # Vật tư khác: máy TỰ TÍNH bằng công thức định mức của vật tư + chip — số gửi lên bị bỏ
    # (01/10/2026). Giấy cũng vậy: số + khổ + đơn vị (+ đơn vị gốc) do máy chủ ghi theo ĐẦU VÀO của bước
    # (spec 2026-10-01 dong-giay-theo-dau-vao §4) — `so_luong` / `kho_*` giữ để client cũ không 422.
    so_luong: float | None = Field(default=None, ge=0)
    # True = dòng MÁY bung khi chọn công việc khoán ⇒ lần bung sau thay được. False = người tự thêm
    # hoặc đã sửa số ⇒ máy chừa ra. Mặc định False: client cũ không gửi thì coi như người khai.
    tu_dong: bool = False
    # Khổ dòng GIẤY: bị bỏ qua (máy chủ lấy từ quy cách lệnh). Vật tư khác: khổ TUỲ CHỌN người kế
    # hoạch gõ (mm; một cạnh = khổ chỉ-rộng như màng bóng; 0 · 0 = không khổ) — 27/10/2026.
    kho_rong: int = 0
    kho_dai: int = 0
    # CHIP của vật tư: {mã chip: số} — chép từ phiếu tính giá, sửa được ở lệnh nháp.
    gia_tri_chip: dict[str, float] | None = None
    # True = người gõ định mức ⇒ máy giữ `so_luong` gửi lên thay vì tính bằng công thức (vật tư khác).
    sua_tay: bool = False


class LsxBuocVatTuOut(BaseModel):
    id: int
    hang_loai: str = "vat_tu"
    # Dòng giấy: `giay` | `song` (loại của mã, mg 0426). Vật tư khác: "".
    giay_loai: str = ""
    vat_tu_id: int
    vat_tu_ma: str
    vat_tu_ten: str
    don_vi: str
    so_luong: float
    kho_rong: int = 0
    kho_dai: int = 0
    # Giấy: đơn vị gốc của dòng (`to` khi bước nhận tờ; đơn vị giá của mã khi nhận giấy khổ rộng) —
    # máy chủ ghi theo đầu vào của bước. Hàng khác "". Thay `dang_giay` (10/10/2026).
    don_vi_goc: str = ""
    tu_dong: bool = False
    sua_tay: bool = False
    gia_tri_chip: dict[str, float] = Field(default_factory=dict)
    chips: list[dict] = Field(default_factory=list)


class KhuonMoiIn(BaseModel):
    """Nhánh "làm dao mới" ở bước lệnh. KHÔNG có `khach_hang_id` — server lấy từ chính lệnh."""

    ten: str = Field(min_length=1, max_length=200)
    loai: str | None = None
    # 🔴 `ngay_ve_du_kien` ĐÃ GỠ (mg `0293`) — dao mới vào kho ở `dang_dat_lam`, không kèm ngày.


class PhuThuocOption(BaseModel):
    lsx_id: int
    lsx_ma: str
    nhom: str | None = None
    step_key: str
    ten_buoc: str
    thu_tu: int


class LsxCongDoanIn(BaseModel):
    """Một dòng routing client gửi lên để upsert tại chỗ theo ``step_key``."""

    thu_tu: int | None = None
    step_key: str | None = None
    cong_doan_id: int | None = None
    ten: str | None = None
    nhom: str | None = None
    loai_buoc: str | None = None
    # `bat_buoc` GỠ khỏi bộ nhận 07/09/2026: bước đã nằm trong routing thì PHẢI làm. Cột vẫn còn
    # ở `lsx_cong_doan` nhưng do server giữ TRUE (migration 0275 backfill dòng cũ) — client không
    # còn ô sửa nên nhận field này chỉ mở đường ghi nhầm `false` mà không ai gỡ lại được.
    # `kcs_tieu_chi_bo_sung_json` GỠ 08/09/2026 (mg `0283`): tiêu chí KCS chỉ còn MỘT nguồn là
    # danh mục Tiêu chí KCS gắn theo công đoạn — xem `docs/design-kcs-theo-cong-doan.md` mục 5.
    department_id: int | None = None
    may_id: int | None = None
    #: Con dao của bước (`khuon_be.id`). Gửi null = bỏ gán.
    khuon_be_id: int | None = None

    # ⚠️ `piece_rate_id` GỠ 18/09/2026 (mg `0320`): bước lệnh thôi chọn đầu việc khoán. Việc khoán
    #    chọn LÚC GHI MẺ ở bàn tổ, nơi thợ biết mình vừa làm gì.
    # Số lượng & hao hụt
    so_luong_vao: float | None = None
    so_luong_ra: float | None = None
    don_vi_vao: str | None = None
    don_vi_ra: str | None = None
    he_so_quy_doi: float | None = Field(default=None, gt=0)
    hao_hut: float | None = Field(default=None, ge=0)
    hao_hut_pct: float | None = Field(default=None, ge=0)
    so_luot_chay: int | None = Field(default=None, ge=1)
    # Năng suất & thời gian (phút)
    # SỐ GIỜ KẾ HOẠCH của bước TỔ (mg `0319`) — người lập lệnh gõ tay, KHÔNG kế thừa từ danh mục.
    # Nhận số lẻ (4,5 giờ) nên là `float`; 0 HỢP LỆ và không cảnh báo (§5.1). Thay chỗ
    # `so_nhan_cong_tieu_chuan` (kíp chuẩn) đã gỡ cùng ngày (mg `0321`).
    so_gio_ke_hoach: float | None = Field(default=None, ge=0)
    # Hai ô gõ được ở tab Thời gian. `setup_phut` · `chay_phut` · `di_chuyen_phut` vẫn BỎ khỏi
    # input: chuẩn bị + tốc độ kế thừa SỐNG từ module Máy, người kế hoạch không sửa tại bước.
    phat_sinh_phut: float | None = Field(default=None, ge=0)
    # Gia công ngoài (spec 2026-09-26): nhà gia công = NCC có tích "Nhận gia công". Chỉ gửi ID —
    # tên (`nha_cung_cap`) do máy chủ ghi theo NCC đã chọn, client không gửi chữ.
    nha_cung_cap_id: int | None = None
    ghi_chu: str | None = None
    phu_thuoc_step_keys: list[str] | None = None
    vat_tus: list[LsxBuocVatTuIn] | None = None


class LsxCongDoanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    step_key: str
    thu_tu: int
    cong_doan_id: int | None = None
    ten: str
    nhom: str | None = None
    loai_buoc: str
    bat_buoc: bool = True
    department_id: int | None = None
    department_ten: str | None = None
    may_id: int | None = None
    may_ten: str | None = None
    #: Bước đã có việc chạy ở bàn tổ ⇒ ngăn bước khoá ô tổ/máy (đổi máy ở bàn tổ).
    da_bat_dau: bool = False
    # Hai CỜ đọc từ danh mục Công đoạn — quyết định bước có hỏi khuôn không, và `tooling_type` là
    # chiều lọc thứ hai của ô chọn dao. Bốn field `khuon_be_*` là ẢNH CHỤP để bày cho thợ (mã · tên
    # · SỐ KỆ · tình trạng · ngày về), server ghép sẵn nên màn khỏi tra danh mục Khuôn.
    requires_tooling: bool = False
    tooling_type: str | None = None
    khuon_be_id: int | None = None
    khuon_be_ma: str | None = None
    khuon_be_ten: str | None = None
    khuon_be_so_ke: str | None = None
    khuon_be_tinh_trang: str | None = None
    # Ý ĐỊNH của sale chép từ phiếu tính giá + chỗ lệch với con dao kế hoạch đã chốt. `khuon_lech`
    # là câu tiếng Việt server dựng sẵn (hoặc None) — mọi màn nói cùng một câu, FE không suy lại.
    khuon_nguon: str | None = None
    khuon_phi: float = 0
    khuon_lech: str | None = None

    so_luong_vao: float
    so_luong_ra: float
    # NULL = bước KHÔNG CHẠM GIẤY (chế bản đếm kẽm) → đứng ngoài chuỗi tính ngược. Khai `str`
    # cứng thì mọi lần mở chi tiết lệnh có bước chế bản là 500.
    don_vi_vao: str | None = None
    don_vi_ra: str | None = None
    # Bước có nằm trên DÒNG GIẤY không — quyết định bởi CỜ TRẠM của danh mục Đơn vị, FE không tự
    # suy được từ mã. Sai/thiếu field này thì màn hiện hai số 0 (số lượng + hao) mà không nói vì sao.
    tren_dong_giay: bool = True
    # ⚠️ `don_vi_san_luong` · `loi_quy_doi` · `san_luong_dien_giai` GỠ 18/09/2026 (mg `0324`) cùng
    #    công thức sản lượng ra của công đoạn — bước ngoài dòng giấy nay là số tự khai ở bước.
    he_so_quy_doi: float
    hao_hut: float
    hao_hut_pct: float
    ty_le_hao_hut: float = 0      # derived = hao_hut / so_luong_vao
    so_luot_chay: int = 1

    #: SỐ GIỜ KẾ HOẠCH của bước TỔ — ô gõ tay (mg `0319`). Bước máy luôn 0 và không đọc tới.
    so_gio_ke_hoach: float = 0
    # `setup_phut` KẾ THỪA từ máy (read-only trên UI); `phat_sinh_phut` là ô người gõ.
    setup_phut: float = 0
    phat_sinh_phut: float = 0
    # CHỜ KỸ THUẬT (mực khô · keo đông · màng nguội) — kế thừa từ danh mục Công đoạn theo cặp
    # (công đoạn × loại SP), SỬA ĐÈ được tại bước. Vào `tong_phut` nhưng KHÔNG vào `chiem_may_phut`:
    # tờ nằm trên pallet chờ khô thì máy vẫn chạy job khác.
    chay_phut: float | None = None      # dẫn xuất: SL vào × 60 ÷ tốc độ máy × số lượt
    # derived — thời lượng theo tốc độ TRUNG BÌNH (Gantt đặt thanh), kèm dải nhanh/chậm nhất
    # suy từ tốc độ tối đa / tối thiểu của máy. Máy chưa khai dải ⇒ cả ba bằng nhau.
    chiem_may_phut: float = 0
    chiem_may_phut_min: float = 0
    chiem_may_phut_max: float = 0
    tong_phut: float = 0
    thoi_luong_dien_giai: dict = Field(default_factory=dict)

    nha_cung_cap_id: int | None = None
    nha_cung_cap: str | None = None
    ghi_chu: str | None = None

    # ⚠️ `khoan_rate_id` · `khoan_ten` · `khoan_chon_duoc` GỠ 18/09/2026 (mg `0320`): bước thôi chọn
    #    đầu việc khoán — việc khoán chọn LÚC GHI MẺ ở bàn tổ, nơi thợ biết mình vừa làm gì.
    # `[{vat_tu_id, so_luong, dien_giai}]` — lượng tính sẵn cho MỌI vật tư theo bước này. Drawer
    # chọn món nào là điền số ngay, khỏi bắt gõ tay. Món chưa tính ra được thì KHÔNG có ở đây.
    vat_tu_goi_y: list[dict] = Field(default_factory=list)
    # Số ĐÚNG RA phải là theo danh mục HIỆN TẠI, khi nó KHÁC số đã lưu (None = không lệch).
    # Lệnh là ẢNH CHỤP nên server không tự đè — chỉ phơi ra để màn gạch số cũ + mời "Tính lại".
    so_luong_vao_moi: float | None = None
    so_luong_ra_moi: float | None = None
    phu_thuoc_step_keys: list[str] = Field(default_factory=list)
    vat_tus: list[LsxBuocVatTuOut] = Field(default_factory=list)


class LsxListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ma: str
    loai: str
    ten: str
    # Nhãn nhóm đọc-sống từ dòng đơn: lệnh "Bìa" phải cho biết nó thuộc "Catalogue A4 - 32 trang".
    nhom: str | None = None
    trang_thai: str
    order_id: int
    order_no: str | None = None
    customer_name: str | None = None
    so_luong_dat: int
    don_vi_tinh: str
    so_to_ke_hoach: int
    han_giao_khach: date | None = None
    han_hoan_thanh_sx: date | None = None
    is_rush: bool = False
    created_at: datetime | None = None   # ngày tạo lệnh — cột "Ngày tạo" + mốc kỳ `tao`
    to_dau_ten: str | None = None   # tổ của bước đầu (nhìn biết ai bắt việc)
    so_cong_doan: int = 0
    # MÃ đơn vị chặng TỜ IN của lệnh này — cột "Tờ in" liệt kê nhiều lệnh, mỗi lệnh có thể đếm
    # bằng đơn vị xưởng tự đặt. Client tra tên ở danh mục Đơn vị.
    don_vi_to: str | None = None
    # Gia công ngoài của lệnh (lần chưa huỷ) — None = lệnh không đi gia công. Không khai ở đây là
    # Pydantic nuốt im lặng và bảng lệnh lại không biết lệnh nào đang nằm ở nhà gia công.
    gia_cong: "LsxListGiaCong | None" = None


class LsxListGiaCong(BaseModel):
    """Lần ĐẠI DIỆN của lệnh trên dòng danh sách — xem `gia_cong_ngoai.tom_tat_theo_lenh`."""

    kieu: str                     # mot_phan | tron_goi
    trang_thai: str               # cho_mang_di | dang_o_ngoai | dang_gia_cong | da_xong
    nha_cung_cap_ten: str
    ten_viec: str
    bai_ghep_ma: str | None = None
    so_lan: int = 1
    so_lan_mo: int = 0
    # Trọn gói xưởng cấp giấy chưa gửi đề nghị xuất giấy — bảng lệnh hiện chip "Chờ cấp giấy".
    cho_cap_giay: bool = False


LsxListItem.model_rebuild()


class LsxListOut(BaseModel):
    items: list[LsxListItem]
    total: int          # TỔNG số lệnh khớp lọc, không phải số dòng của trang
    page: int = 1
    size: int = 50
    # Số trên từng tab lọc, đếm ở máy chủ theo cùng bộ lọc TRỪ `trang_thai` (tab đang không được
    # chọn vẫn khoe số của nó). Khoá `all` = tổng. Không khai ở đây là Pydantic nuốt im lặng.
    facets: dict[str, int] = {}


class BoLocDonItem(BaseModel):
    id: int
    order_no: str
    customer_id: int | None = None
    customer_name: str | None = None


class BoLocKhachItem(BaseModel):
    id: int
    name: str


class LsxBoLocOut(BaseModel):
    """Nguồn của hai ô lọc "Đơn hàng" / "Khách hàng" trên bảng lệnh — chỉ những đơn ĐANG có lệnh."""

    orders: list[BoLocDonItem] = []
    customers: list[BoLocKhachItem] = []


# ⚠️ `BoDauViecOut` GỠ 18/09/2026 (mg `0320`): bước thôi ghim đầu việc nên không có gì mồ côi.


# ⚠️ `DanhMucDoiTruong` GỠ 18/09/2026 (mg `0320`): nó mô tả MỘT ô của ảnh chụp khoán bị lệch,
#    mà ảnh chụp ấy đã bay khỏi bước lệnh.


class DanhMucDoiVatTu(BaseModel):
    """Một dòng vật tư lệch giữa bước và danh mục. `so_luong_cu`/`so_luong_moi` để trống một bên
    tuỳ rổ: rổ THÊM chưa có số cũ, rổ BỎ không còn số mới."""

    hang_loai: str = "vat_tu"
    vat_tu_id: int
    ma: str | None = None
    ten: str | None = None
    don_vi: str | None = None
    so_luong_cu: float | None = None
    so_luong_moi: float | None = None


class DanhMucDoiBuoc(BaseModel):
    buoc_id: int
    step_key: str | None = None
    thu_tu: int = 0
    ten: str = ""
    # ⚠️ Ba khoá KHOÁN (`khoan` · `khoan_chua_chon` · `khoan_mo_coi`) GỠ 18/09/2026 (mg `0320`):
    #    bước thôi ghim ảnh chụp đầu việc nên không có gì lệch với danh mục. Băng còn đúng hai
    #    việc — VẬT TƯ của công đoạn và MÁY bị gỡ khỏi công đoạn.
    vat_tu_them: list[DanhMucDoiVatTu] = Field(default_factory=list)
    # Bước đang có mà danh mục không còn bung. CHỈ BÁO — nút cập nhật không xoá dòng nào.
    vat_tu_bo: list[DanhMucDoiVatTu] = Field(default_factory=list)
    vat_tu_lech: list[DanhMucDoiVatTu] = Field(default_factory=list)
    may_canh_bao: str | None = None


class DanhMucDoiOut(BaseModel):
    """Danh mục Công đoạn đã đổi sau lúc lệnh chụp ảnh — `None` ở `LsxOut` khi còn khớp hết.

    Xem `services.lsx_danh_muc_doi` để biết vì sao so NỘI DUNG chứ không so `updated_at` như băng
    cùng loại ở phiếu tính giá.
    """

    so_buoc: int
    co_the_cap_nhat: bool
    ly_do_khoa: str | None = None
    buocs: list[DanhMucDoiBuoc] = Field(default_factory=list)


class TieuChiKcsDoiCongDoan(BaseModel):
    cong_viec_id: int
    ten: str
    cu: list[str] = Field(default_factory=list)
    moi: list[str] = Field(default_factory=list)
    them: list[str] = Field(default_factory=list)
    bo: list[str] = Field(default_factory=list)
    doi_thu_tu: bool = False
    da_bat_dau: bool = False


class TieuChiKcsDoiOut(BaseModel):
    """Thẻ việc của lệnh đã phát hành mà tiêu chí KCS chụp lúc phát hành khác danh mục
    hiện tại — `None` ở `LsxOut` khi khớp hết. Lấy bộ mới bằng nút "Cập nhật tiêu chí" của băng."""

    so_cong_doan: int
    cong_doans: list[TieuChiKcsDoiCongDoan] = Field(default_factory=list)


class LsxOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ma: str
    loai: str
    lsx_goc_id: int | None = None
    ten: str
    # Nhãn nhóm ĐỌC SỐNG từ dòng đơn (không lấy trong quy_cach_json — ảnh chụp cũ sẽ trống).
    nhom: str | None = None
    trang_thai: str

    order_id: int
    order_line_id: int
    order_no: str | None = None
    # Trạng thái ĐƠN (không phải trang_thai của lệnh) — client dùng để ẩn tab Công đoạn khi đơn
    # đã hủy, xem `_EXCLUDED_ORDER_STATUSES` bên customer_analytics.py cho quy ước cùng gốc.
    order_status: str | None = None
    customer_name: str | None = None
    customer_po_no: str | None = None
    sale_name: str | None = None
    quote_version_id: int | None = None
    quote_number: str | None = None
    quote_version_number: int | None = None
    phieu_thanh_phan_id: int | None = None
    ptg_id: int | None = None
    ptg_ma: str | None = None

    so_luong_dat: int
    don_vi_tinh: str
    so_to_ke_hoach: int
    so_to_nguyen: int
    so_con: int
    # MÃ đơn vị bốn CHẶNG dòng giấy của lệnh này (`dong_giay.don_vi_chuoi`). Server chấm MỘT chỗ
    # rồi gửi cho cả ba màn; client chỉ tra TÊN trong danh mục Đơn vị. None = routing không nói tới
    # chặng đó — client hiện mỗi con số, KHÔNG bịa nhãn.
    don_vi_to: str | None = None
    don_vi_to_nguyen: str | None = None
    don_vi_tp: str | None = None
    don_vi_tay: str | None = None

    ban_giao_at: datetime | None = None
    han_giao_khach: date | None = None
    han_hoan_thanh_sx: date | None = None
    is_rush: bool

    quy_cach_json: dict | None = None
    may_id: int | None = None
    may_ten: str | None = None

    nguoi_phu_trach_id: int | None = None
    nguoi_phu_trach_ten: str | None = None
    ghi_chu: str | None = None
    # "Lưu ý sản xuất (gửi xưởng)" đọc SỐNG từ đơn — nguồn ô lưu ý thợ thấy trên lệnh.
    luu_y_gui_xuong: str | None = None
    created_at: datetime
    updated_at: datetime

    cong_doans: list[LsxCongDoanOut] = Field(default_factory=list)
    # `thieu` CHẶN nút "Sẵn sàng lập kế hoạch" (§12). Rổ cảnh báo MỀM §14 (`canh_bao`) đã gỡ
    # 25/08/2026 — server vẫn tính mỗi lần mở lệnh mà không màn nào đọc.
    thieu: list[str] = Field(default_factory=list)
    # Mã thiếu cấp BƯỚC → id các bước dính (`thieu_to_may`, `thieu_nha_gia_cong`, `thieu_khuon`):
    # màn lệnh gọi đích danh bước nào chặn nút Sẵn sàng, khỏi phải mở từng bước ra dò.
    thieu_buoc: dict[str, list[int]] = Field(default_factory=dict)
    lead_time: LeadTimeOut | None = None
    # `khoan_tien_tong` gỡ 11/09/2026 cùng tiền khoán ở tầng lệnh — tổng công thợ là số của kế toán
    # lương, tính theo bảng giá TẠI KỲ TÍNH LƯƠNG, không phải Σ ảnh chụp lúc bung lệnh.
    # Chừa TÁCH CHIỀU, tính lúc đọc bằng `chua_theo_chieu` — màn lệnh chỉ hiện, không cộng lại.
    chua_dai: float = 0
    chua_rong: float = 0
    # Lệnh đang ghép chung tờ với ai. None = in riêng. Khi có, THÔNG SỐ TỜ (máy in, giấy, khổ tờ
    # in, số con) đọc theo bài — sửa ở màn lệnh không có tác dụng.
    bai_ghep: LsxBaiGhepOut | None = None
    # Lệnh đang GIỮ CHỖ vật tư. `_chan_dang_giu_cho` chặn sửa số lượng / quy cách / routing và xoá
    # lệnh — chặn CẢ bản xem trước (`xem_truoc_routing`), cố ý. Cờ này ra tới client để màn lệnh
    # khoá bảng routing và nói ngay đường lùi ("nhả chỗ ở Kế hoạch vật tư"): thiếu nó thì người
    # kế hoạch sửa xong cả routing mới ăn 409 lúc bấm Lưu, mà mỗi lần đổi công đoạn thì xem-trước
    # 409 im lặng nên số trên bảng đứng im không ai giải thích.
    giu_cho_bat: bool = False
    # Nguồn giấy máy chọn lúc lập lệnh (spec 2026-10-24-chuan-bi-giay §7). None = lệnh cũ / không giấy.
    nguon_giay: str | None = None
    # Lệnh chưa phát hành mà KHÔNG giao trọn gói được (đi chung lệnh khác / bài ghép) — câu nêu đích
    # danh lệnh đang dính. Màn lệnh thay nút "Gia công trọn gói" bằng chip nói lý do (câu ngắn trên
    # mặt chip, câu đầy đủ ở chú thích), khỏi để người kế hoạch điền xong hộp thoại mới biết.
    # None = được (hoặc lệnh đã qua bước đặt trọn gói).
    tron_goi_chan: str | None = None
    tron_goi_chan_ngan: str | None = None
    # Danh mục Công đoạn đã đổi sau lúc lệnh chụp ảnh (None = còn khớp). Lệnh KHÔNG tự lấy số mới;
    # băng trên màn lệnh nói lệch chỗ nào rồi để người lập kế hoạch bấm "Cập nhật theo danh mục".
    danh_muc_doi: DanhMucDoiOut | None = None
    tieu_chi_kcs_doi: TieuChiKcsDoiOut | None = None


class BuocBiDeOut(BaseModel):
    """Một bước của lệnh đang bị bài ghép ĐÈ — số ở đây là của CẢ LƯỢT chung, không phải của lệnh."""

    gop_step_key: str
    ten: str
    to_ten: str | None = None
    may_ten: str | None = None
    so_luong_vao: float = 0
    so_luong_ra: float = 0
    hao_hut: float = 0


class LsxBaiGhepOut(BaseModel):
    id: int
    ma: str
    trang_thai: str
    may_id: int | None = None
    may_ten: str | None = None
    giay_id: int | None = None
    kho_in_dai: int | None = None
    kho_in_rong: int | None = None
    so_con_tren_to: int = 1
    # `lsx_step_key → bước chung đang đè lên nó`. Thay `buoc_in_step_key` (giả định bước in là điểm
    # gộp duy nhất — sai, bài còn gộp CTP/cán/bế). Quên sửa model này một lần rồi: service trả
    # `buoc_bi_de` mà pydantic lọc mất, badge + hai số phía lệnh thành code chết mà không ai báo.
    buoc_bi_de: dict[str, BuocBiDeOut] = Field(default_factory=dict)


class DoiNguonGiayIn(BaseModel):
    """`PUT /lsx/{id}/nguon-giay` — người kế hoạch đổi nguồn giấy; Cuộn phải kèm rộng cuộn (mm)."""

    nguon: Literal["to_in", "to_nguyen", "cuon", "mua"]
    rong_cuon: int | None = None


class LsxQuyCachIn(BaseModel):
    """THÔNG SỐ của lệnh mà kế hoạch sửa được tại chỗ — snapshot vẫn là snapshot.

    Lệnh KHÔNG tự bám theo phiếu tính giá; đây chỉ là mở khoá cho người kế hoạch chỉnh ảnh chụp
    mà không phải quay về phiếu rồi tạo lại lệnh (tạo lại là mất sạch routing đã chỉnh).

    Chỉ NGUYÊN NHÂN nằm ở đây. HỆ QUẢ (`so_kem` · `so_luot` · `so_manh_xa` · `so_to_ke_hoach` ·
    `so_to_nguyen`) server tính lại từ đúng bộ này, client gửi lên cũng bị bỏ — xem
    `LsxService.ap_quy_cach`.
    """

    giay_id: int | None = None
    nguon_giay: str | None = None
    kho_nguyen_dai: float | None = Field(default=None, ge=0)
    kho_nguyen_rong: float | None = Field(default=None, ge=0)
    kho_in_dai: float | None = Field(default=None, ge=0)
    kho_in_rong: float | None = Field(default=None, ge=0)
    dai_thanh_pham: float | None = Field(default=None, ge=0)
    rong_thanh_pham: float | None = Field(default=None, ge=0)
    quy_cach_in: str | None = None
    muc_a: list[str] | None = None
    muc_b: list[str] | None = None
    so_trang: int | None = Field(default=None, ge=1)
    trang_moi_tay: int | None = Field(default=None, ge=1)
    bleed_mm: float | None = Field(default=None, ge=0)
    khe_cat_mm: float | None = Field(default=None, ge=0)
    con_auto: bool | None = None


class LsxUpdateIn(BaseModel):
    ten: str | None = None
    so_luong_dat: int | None = Field(default=None, ge=0)
    don_vi_tinh: str | None = None
    # Cụm THÔNG SỐ (ảnh chụp từ phiếu) — sửa cái nào là mọi số dẫn xuất tính lại ngay.
    quy_cach: LsxQuyCachIn | None = None
    so_to_ke_hoach: int | None = Field(default=None, ge=0)
    so_to_nguyen: int | None = Field(default=None, ge=0)
    so_con: int | None = Field(default=None, ge=1)
    han_hoan_thanh_sx: date | None = None
    is_rush: bool | None = None
    may_id: int | None = None
    nguoi_phu_trach_id: int | None = None
    ghi_chu: str | None = None


class RoutingReplaceIn(BaseModel):
    cong_doans: list[LsxCongDoanIn] = Field(default_factory=list)
    # §10: routing lệch bài tính giá → ghi lý do vào nhật ký (người xác nhận đã có ở audit).
    ly_do: str | None = None


class XemTruocRoutingRow(BaseModel):
    """1 bước trong payload XEM TRƯỚC routing — các trường chuỗi ngược cần để suy số.

    KHÔNG mang vật tư / khoán / phụ thuộc (những thứ chỉ ảnh hưởng lúc LƯU, không đổi dòng chảy số
    lượng — số lượng chạy theo `thu_tu`, không theo cạnh phụ thuộc), để payload gọn và không lỡ
    chạm guard vật-tư/phụ-thuộc của `replace_routing`. Muốn bước chèn giữa ra đúng số thì đưa nó về
    đúng vị trí `thu_tu` (chèn đúng chỗ ở FE), không phải khai cạnh phụ thuộc cho xem-trước.
    """

    step_key: str | None = None
    thu_tu: int | None = None
    cong_doan_id: int | None = None
    ten: str | None = None
    nhom: str | None = None
    loai_buoc: str | None = None
    department_id: int | None = None
    may_id: int | None = None


class XemTruocRoutingIn(BaseModel):
    cong_doans: list[XemTruocRoutingRow] = Field(default_factory=list)


class XemTruocRoutingBuoc(BaseModel):
    """DÒNG CHẢY của 1 bước sau khi đổi/chèn công đoạn — khớp field `_cong_doan_dict` trả ra."""

    step_key: str | None = None
    so_luong_vao: float
    so_luong_ra: float
    don_vi_vao: str | None = None
    don_vi_ra: str | None = None
    he_so_quy_doi: float
    hao_hut: float
    hao_hut_pct: float
    tren_dong_giay: bool = True


class XemTruocRoutingOut(BaseModel):
    cong_doans: list[XemTruocRoutingBuoc] = Field(default_factory=list)


class TinhNguocRow(BaseModel):
    """1 dòng GỢI Ý của phép tính ngược — chưa ghi DB, người kế hoạch xem rồi mới bấm áp dụng."""

    id: int
    thu_tu: int
    ten: str
    so_luong_vao: float
    so_luong_ra: float
    don_vi_vao: str | None = None
    don_vi_ra: str | None = None


class TinhNguocOut(BaseModel):
    rows: list[TinhNguocRow] = Field(default_factory=list)
    # Số tờ bài tính giá chốt — để người dùng thấy ngay routing đang lệch báo giá bao nhiêu.
    so_to_ke_hoach: int = 0


class BuocMacDinhOut(BaseModel):
    """Bộ mặc định khi ĐỔI một bước sang công đoạn khác — client áp đè lên dòng đang sửa.

    KHÔNG có số lượng vào/ra: chúng thuộc CHUỖI chứ không thuộc công đoạn, nên giữ nguyên số người
    kế hoạch đang cân (lệch thì đã có cảnh báo `dut_chuyen` + nút "Tính ngược").

    KHÔNG có `loai_buoc`/`may_id`/`nang_suat`/`don_vi_nang_suat`/`so_nhan_cong*`: loại Máy-Tổ-Thuê
    ngoài, máy cụ thể và nguồn năng suất thuộc chính bước KHSX, đổi công đoạn không được đụng tới.
    Khai lại ở đây là schema tự đòi thứ service cố ý không trả — `loai_buoc` bắt buộc mà thiếu làm
    endpoint 500 mọi lần gọi, còn mấy trường kia lặng lẽ đẩy 0/null vô nghĩa xuống client.
    """

    cong_doan_id: int
    ten: str
    nhom: str | None = None
    #: Tổ MẶC ĐỊNH (tổ đầu danh sách) + cả danh sách tổ phụ trách công đoạn (mg `0312`) — ô chọn tổ
    #: của bước chỉ được chọn trong danh sách này.
    department_id: int | None = None
    department_ids: list[int] = Field(default_factory=list)
    don_vi_vao: str | None = None
    don_vi_ra: str | None = None
    he_so_quy_doi: float
    #: Cặp đơn vị trên có nằm trên DÒNG GIẤY không. Đi kèm hai ô trên vì client áp cả cụm một lượt;
    #: thiếu nó thì dòng vừa đổi sang ghi kẽm (`m² → bài in`) vẫn đeo cờ của công đoạn cũ.
    tren_dong_giay: bool = True
    #: Bước có phải mượn dụng cụ trong kho Khuôn & khung không, và LOẠI nào (`khuon_be` ·
    #: `khuon_ep` · `khung_lua`). Đi kèm vì ô chọn dao lọc theo đúng hai cờ này — thiếu chúng thì
    #: bước vừa đổi sang công đoạn cần khung lụa vẫn bày kho dao BẾ cho tới lúc lưu và nạp lại.
    requires_tooling: bool = False
    tooling_type: str | None = None
    setup_phut: float
    #: GỢI Ý máy cho công đoạn mới — chỉ có số khi công đoạn khai ĐÚNG MỘT máy còn dùng. Không mâu
    #: thuẫn với đoạn "KHÔNG có `may_id`" ở trên: chỗ đó cấm GHI ĐÈ máy người ta đã chọn, còn đây
    #: là số để client điền vào ô đang TRỐNG. Cần vì cách đo giờ chạy và tốc độ đều treo ở cặp
    #: (công đoạn × máy) — bước trống máy thì bảng thời gian không bao giờ ra số.
    may_id_goi_y: int | None = None


class TrangThaiIn(BaseModel):
    trang_thai: str


class LsxActivityItem(BaseModel):
    """Một dòng nhật ký lệnh — câu dựng ở máy chủ (`services/lsx_nhat_ky.py`), gom cả vết của gia
    công ngoài, phiếu chi, xưởng, kho… chứ không riêng audit target `lsx:{id}`."""
    at: datetime | None = None
    actor_name: str | None = None
    action: str
    tieu_de: str
    #: Mẩu phụ (số hỏng, mã phiếu, lý do) — FE vẽ thành thẻ nhỏ.
    the: list[str] = []
    #: Tên công đoạn khi dòng đến từ một công việc ở xưởng.
    buoc: str | None = None
    tone: str | None = None


class LsxActivityOut(BaseModel):
    items: list[LsxActivityItem]


class LsxDinhKemOut(BaseModel):
    """Một tệp đính kèm của lệnh. `nguoi_tai_ten` do máy chủ ghép từ tài khoản — không có ô nhập."""
    id: int
    ten_tep: str
    file_url: str
    content_type: str | None = None
    kich_thuoc: int
    nguoi_tai_ten: str | None = None
    tai_luc: datetime


class LsxDinhKemListOut(BaseModel):
    items: list[LsxDinhKemOut]


# --- Hàng đèn tổng quan (Đợt 1 redesign 18/08/2026) ---------------------------
class DenItem(BaseModel):
    """Một chấm trên hàng đèn của bảng lệnh.

    `muc` ∈ `do` · `vang` · `ok` — FE **chỉ vẽ chấm cho `do`/`vang`**, `ok` để trống ô.
    `chu` là câu người dùng đọc được (tooltip + bản đủ chữ ở màn chi tiết).
    `nhay` = `{man, id}` để bấm chấm là tới thẳng chỗ sửa, không phải tự đi tìm màn.
    """
    muc: str
    chu: str = ""
    nhay: dict | None = None


class LsxDenOut(BaseModel):
    """Bốn thứ bảng lệnh CHƯA nói. Hạn vẫn cố ý KHÔNG có đèn — cột `Hạn` đã tô màu, và cột `CĐ` đã
    đỏ khi lệnh chưa có công đoạn; đèn nói lại chuyện cột bên cạnh vừa nói chỉ làm loãng.

    `danh_muc` thêm 07/09/2026: KHÔNG có cột nào nói hộ nó. Ảnh chụp khoán + dòng vật tư của bước
    đóng băng từ lúc bung lệnh, xưởng sửa công thức ở danh mục Công đoạn thì lệnh đã tạo im lặng
    giữ số cũ — không có chấm này thì người lập kế hoạch phải mở từng lệnh mới biết cái nào lệch.
    """
    vat_tu: DenItem
    may_gio: DenItem
    nguoi: DenItem
    danh_muc: DenItem


class LsxTongQuanItem(BaseModel):
    lsx_id: int
    # Độ dư nhỏ nhất giữa các bước đã xếp (ngày làm việc, âm = đang trễ). `None` khi lệnh chưa
    # vào kế hoạch ⇒ FE lùi về `classHan` đếm ngày lịch như cũ.
    slack_ngay: int | None = None
    den: LsxDenOut


class LsxTongQuanOut(BaseModel):
    items: list[LsxTongQuanItem]
