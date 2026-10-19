"""Pydantic schemas — Yêu cầu kho & Phiếu nhập/xuất (spec-kho-de-nghi).

Lưu ý phân quyền trên các schema Out: những trường NHẠY CẢM (`don_gia`, `don_gia_nhap`,
`gia_von`, `ton_kha_dung`) đều `None`-able và được router XÓA khi người gọi thiếu quyền
(`can_view_cost` / `can_view_stock`). Ẩn ở tầng schema chứ không chỉ ẩn trên UI — nếu chỉ
ẩn cột ở FE thì số vẫn nằm trong response, mở DevTools là thấy.
"""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..services.kho_giay import chuan_kho, co_don_vi_goc, khoa_dong
from .purchase import MuaChoLenhOut


def _chuan_kho_giay(hang_loai: str | None, kho_rong, kho_dai) -> tuple[int, int]:
    """Khổ của dòng kho: giấy chuẩn hoá cạnh ngắn × cạnh dài (một cạnh ⇒ khổ chỉ-rộng `(r, 0)`); hàng
    khác ép 0 · 0 (client gửi gì cũng bỏ). Giấy KHÔNG còn dạng cuộn/tờ (10/10/2026) — đơn vị gốc của dòng
    máy chủ suy từ ĐVT, client gửi thừa `dang_giay` thì schema bỏ qua (không 422)."""
    if hang_loai is not None and hang_loai != "giay":
        return 0, 0
    return chuan_kho(kho_rong, kho_dai)


# --- Yêu cầu ----------------------------------------------------------------

class StockRequestLineIn(BaseModel):
    # MẶT HÀNG GỐC — bắt buộc chọn từ danh mục Giấy / Vật tư khác (siết 2026-08-08). Không còn
    # đường gõ tên tự do rồi kho gắn mã sau.
    hang_loai: str = Field(pattern="^(giay|vat_tu)$")
    hang_id: int = Field(gt=0)
    # XIN CHO LỆNH NÀO (mg 0175). Bỏ trống được — xin lặt vặt (băng dính, giẻ lau) không thuộc lệnh
    # nào, bắt buộc gắn là chặn luôn luồng kho đang chạy. Khai rồi thì bảng cân đối vật tư trừ phần
    # đã cấp vào ĐÚNG dòng nhu cầu, thay vì để mọi lệnh dùng chung loại giấy cùng báo thiếu.
    lsx_id: int | None = Field(default=None, gt=0)
    bai_ghep_id: int | None = Field(default=None, gt=0)
    # Đơn vị người đề nghị chọn — phải nằm trong tập đổi được của chính mặt hàng đó (service kiểm).
    dvt: str = Field(min_length=1, max_length=24)
    sl_de_nghi: float = Field(gt=0)
    # Đơn giá NHẬP do người đề nghị khai (chỉ đề nghị NHẬP), theo `dvt`. Phiếu kế thừa; kho không sửa.
    don_gia: int | None = Field(default=None, ge=0)
    ghi_chu: str | None = Field(default=None, max_length=500)
    # GIẤY: khổ mm (đủ hai cạnh hoặc chỉ rộng); hàng khác bị ép 0 · 0. Chuẩn hoá cạnh ngắn × cạnh dài
    # lúc nhận. Đơn vị gốc của dòng máy chủ suy từ `dvt` (họ tờ ⇒ tờ, họ đơn vị giá ⇒ đơn vị giá).
    kho_rong: int | float | None = Field(default=0, ge=0)
    kho_dai: int | float | None = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _chuan_kho(self) -> "StockRequestLineIn":
        self.kho_rong, self.kho_dai = _chuan_kho_giay(self.hang_loai, self.kho_rong, self.kho_dai)
        return self


class StockRequestCreate(BaseModel):
    loai: str = Field(pattern="^(NHAP|XUAT)$")
    # Kho KHÔNG chọn ở yêu cầu nữa — quyết ở bước lập phiếu. Giữ optional cho tương thích.
    kho_id: int | None = None
    # Số yêu cầu tự nhập (tuỳ chọn); bỏ trống → hệ thống tự sinh (DNN/DNX####).
    ma: str | None = Field(default=None, max_length=30)
    ngay_can: date | None = None
    # GIỜ cần hàng (mg 0384). Có thì `ngay_can` lấy theo ngày của giờ này (máy chủ tự tính).
    can_luc: datetime | None = None
    uu_tien: str = Field(default="binh_thuong", pattern="^(binh_thuong|gap)$")
    ghi_chu: str | None = Field(default=None, max_length=1000)
    # Mã loại nhập/xuất kho theo MISA (0/1/2/3…) — người tạo gõ tay; Báo cáo kho dùng để export.
    loai_kho: str | None = Field(default=None, max_length=50)
    # Nguồn đợt giao đơn mua (chỉ khi tạo từ nút "Nhập kho" ở đợt giao) — chặn nhập trùng.
    purchase_delivery_id: int | None = None
    lines: list[StockRequestLineIn] = Field(min_length=1)


class StockRequestUpdate(BaseModel):
    ngay_can: date | None = None
    can_luc: datetime | None = None
    uu_tien: str | None = Field(default=None, pattern="^(binh_thuong|gap)$")
    ghi_chu: str | None = Field(default=None, max_length=1000)
    loai_kho: str | None = Field(default=None, max_length=50)
    lines: list[StockRequestLineIn] | None = None


class StockRequestApprove(BaseModel):
    """`approved_qty`: line_id → SL duyệt. Bỏ trống = duyệt nguyên số yêu cầu."""

    approved_qty: dict[int, float] | None = None


class StockRequestReject(BaseModel):
    ly_do: str = Field(min_length=1, max_length=500)


class StockRequestLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    hang_loai: str
    hang_id: int
    # Mã · tên · nhóm của mặt hàng gốc — router gán để FE khỏi gọi thêm danh mục.
    hang_ma: str | None = None
    hang_ten: str | None = None
    hang_nhom: str | None = None
    # Ảnh minh hoạ mặt hàng (từ danh mục) — form PHIẾU NHẬP hiện + cho gắn/đổi ảnh ngay khi nhập hàng.
    hang_anh: str | None = None
    # "Cho lệnh nào" (mg 0175) + MÃ để FE hiện thẳng, khỏi gọi thêm một vòng /api/lsx cho mỗi dòng.
    lsx_id: int | None = None
    bai_ghep_id: int | None = None
    lsx_ma: str | None = None
    bai_ghep_ma: str | None = None
    dvt: str
    # Giấy: khổ mm của dòng (hàng khác: 0 · 0).
    kho_rong: int = 0
    kho_dai: int = 0
    # ĐƠN VỊ GỐC của dòng: giấy = cột `don_vi_goc` (tờ / đơn vị giá, máy chủ suy từ ĐVT); router đè bằng
    # gốc của phép quy đổi bên dưới (giấy hai số trùng nhau, hàng khác là đơn vị gốc của mã). Đi kèm
    # số đã quy về gốc + câu diễn giải ("1 ram = 500 tờ") — FE hiện dòng nhắc dưới ô SL để người khai
    # thấy trước con số sẽ vào tồn. None = không đổi được (kèm `canh_bao_dv`).
    don_vi_goc: str | None = None
    don_vi_goc_ten: str | None = None
    sl_quy_doi: float | None = None
    quy_doi_dien_giai: str | None = None
    canh_bao_dv: str | None = None
    sl_de_nghi: float
    sl_duyet: float
    sl_da_ung: float
    # Đơn giá NHẬP người yêu cầu khai — phiếu kế thừa (kho chỉ đọc). Null với yêu cầu XUẤT.
    # Mọi trường TIỀN của dòng (`don_gia`, `gia_goc`, `don_gia_ban`) chỉ có khi `can_view_cost` —
    # người tạo yêu cầu cũng không có ngoại lệ (chủ 18/09/2026).
    don_gia: int | None = None
    # Dòng thành phẩm KCS gửi nhập: `don_gia` luôn 0 (phần mềm không tính được giá gốc), giá gốc thật
    # do kế toán kho gõ trên lô sau khi ghi sổ ⇒ đọc từ lô. `gia_goc` None = "Chưa có giá gốc".
    tu_kcs: bool = False
    gia_goc: int | None = None
    # Tiền gốc đã nhập của dòng KCS = Σ giá × SL từng đợt đã ghi sổ — KHÔNG phải `gia_goc` × SL
    # (giá bình quân đã làm tròn nhân ngược lệch tổng các phiếu). None cùng lúc với `gia_goc`.
    tien_goc: int | None = None
    # Giá bán theo đơn hàng (chỉ để đọc, không vào sổ) + số đơn đi kèm.
    don_gia_ban: int | None = None
    don_ban_ma: str | None = None
    # Yêu cầu NHẬP từ đợt giao mua: hàng này mua cho lệnh nào / tồn kho (08/10/2026).
    mua_cho: list[MuaChoLenhOut] = Field(default_factory=list)
    loai_mua_cac: list[str] = Field(default_factory=list)
    # Kho phản hồi: lý do kho cấp/nhập thiếu so với còn phải cấp (nếu có).
    ly_do_thieu: str | None = None
    ghi_chu: str | None = None
    # Tính, không lưu — xem models/stock_request.py.
    sl_con_lai: float = 0.0
    # Kho đã CHỐT thực xuất bao nhiêu (điều chỉnh phiếu xuất — spec-de-nghi-cap-vat-tu-cong-doan
    # §5.5). NULL = kho CHƯA điều chỉnh lần nào, KHÁC hẳn 0 (đã chốt là không xuất gì).
    sl_chot_thuc_xuat: float | None = None
    # Đèn tín hiệu 5 màu: AI CŨNG nhận được (không kèm số nên không lộ tồn).
    muc_ton: str | None = None
    # CHỈ khi có `can_view_stock`; router xóa nếu thiếu quyền.
    ton_kha_dung: float | None = None


class StockRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ma: str
    loai: str
    nguoi_tao_id: int
    nguoi_tao_ten: str | None = None
    bo_phan_id: int | None = None
    # Ô "Bộ phận" trên mẫu 01-VT/02-VT + cột Bộ phận ở Hộp yêu cầu.
    bo_phan_ten: str | None = None
    kho_id: int | None = None
    kho_ten: str | None = None
    ngay_can: date | None = None
    uu_tien: str
    ghi_chu: str | None = None
    # Loại nhập/xuất kho (tự do — tên hoặc mã) người tạo gõ ở yêu cầu — Báo cáo kho đọc để export.
    loai_kho: str | None = None
    trang_thai: str
    nguoi_duyet_id: int | None = None
    nguoi_duyet_ten: str | None = None
    duyet_luc: datetime | None = None
    ly_do_tu_choi: str | None = None
    # Lý do KHO hủy yêu cầu (hủy phiếu → yêu cầu 'Đã hủy'). Hiện ở mục "Đã hủy".
    ly_do_huy: str | None = None
    created_at: datetime
    # Lần đổi gần nhất (tạo/cấp/hoàn tất/hủy) — FE xếp yêu cầu VỪA CÓ PHẢN HỒI lên đầu cho dễ thấy.
    updated_at: datetime
    # Id phiếu ĐANG CHỜ GHI SỔ (nếu có) — FE đổi nút "Lập phiếu" thành "Xem phiếu", chống tạo trùng.
    open_voucher_id: int | None = None
    # ĐIỀU CHUYỂN KHO (mig 0203): yêu cầu NHẬP đích có `kho_nguon_id` ⇒ là YÊU CẦU ĐIỀU CHUYỂN
    # (FE hiện nhãn "Điều chuyển từ «kho_nguon_ten»", đơn giá phiếu nhập khoá). `xuat_voucher_id` =
    # phiếu xuất nguồn đã ghi sổ (truy cặp đi–đến).
    dieu_chuyen: bool = False
    kho_nguon_id: int | None = None
    kho_nguon_ten: str | None = None
    xuat_voucher_id: int | None = None
    # NGUỒN MUA HÀNG: yêu cầu nhập lập từ một đợt giao của phiếu mua — ngăn kho hiện "DMH-… Đợt 2".
    purchase_delivery_id: int | None = None
    don_mua_id: int | None = None
    don_mua_ma: str | None = None
    dot_so: int | None = None
    # NGUỒN GIAO HÀNG (12/10/2026): đề nghị xuất giao khách / nhập trả hàng do Giao hàng lập — ô
    # "Nguồn" hiện mã lượt + mã đơn để kho biết phiếu nào lên cùng một xe, của đơn nào.
    delivery_trip_id: int | None = None
    giao_luot_ma: str | None = None
    giao_yeu_cau_ma: str | None = None
    giao_don_ma: str | None = None
    #: Khối "Giao hàng" ở ngăn đề nghị (12/10/2026): khách, xe và tài xế TỚI LẤY hàng.
    giao_khach_ten: str | None = None
    giao_xe_bien_so: str | None = None
    giao_tai_xe_ten: str | None = None
    # KHO BẮT BUỘC của phiếu (12/10/2026): đề nghị có thành phẩm ⇒ id Kho thành phẩm — thành phẩm chỉ
    # vào / ra kho đó (`services/kho_thanh_pham`), màn lập phiếu khoá ô kho. None = kho chọn tự do.
    kho_bat_buoc_id: int | None = None
    # Yêu cầu SINH TỪ ĐỀ NGHỊ CẤP VẬT TƯ CÔNG ĐOẠN (spec-de-nghi-cap-vat-tu-cong-doan) — ba trường
    # đều None với yêu cầu kho THƯỜNG (không do sản xuất lập), FE không phải phân nhánh.
    # GIỜ cần thật. `ngay_can` chỉ có DATE nên không diễn đạt được ca chiều cần hàng lúc 13h30
    # khác hẳn ca sáng cần lúc 6h.
    can_luc: datetime | None = None
    san_xuat_cong_viec_id: int | None = None
    # NGUỒN GIA CÔNG NGOÀI (mg 0339) — ô Nguồn hiện thẻ "Gia công", khớp điều kiện lọc Nguồn.
    gia_cong_ngoai_id: int | None = None
    san_xuat_cong_doan_ten: str | None = None
    lines: list[StockRequestLineOut] = []


class StockRequestPage(BaseModel):
    items: list[StockRequestOut]
    total: int


# --- Báo cáo kho (kế toán) — docs/spec-bao-cao-kho.md ---

class BaoCaoKhoRow(BaseModel):
    """1 dòng hàng của 1 phiếu ĐÃ GHI SỔ — cho màn Báo cáo kho (kế toán) + export MISA."""

    voucher_id: int
    ngay_ghi_so: date | None = None      # = ngày hạch toán (MISA)
    ngay_ct: date | None = None          # = ngày chứng từ (ngày lập phiếu)
    so_ct: str                            # = số chứng từ (mã phiếu)
    loai: str                             # NHAP / XUAT
    loai_kho: str | None = None           # loại (tự do) người tạo gõ ở yêu cầu
    ma_hang: str | None = None
    ten_hang: str | None = None
    dvt: str | None = None
    # Giấy: đơn vị gốc + khổ của dòng phiếu (cột "Khổ"). Hàng khác: "" · 0 · 0.
    don_vi_goc: str = ""
    kho_rong: int = 0
    kho_dai: int = 0
    so_luong: float
    don_gia: int | None = None
    thanh_tien: float | None = None
    kho_id: int | None = None
    kho_ten: str | None = None
    han_su_dung: date | None = None       # hạn sử dụng của lô dòng này (từ stock_lots.hsd)
    # ĐIỀU CHUYỂN nội bộ (mig 0203): FE gắn nhãn "điều chuyển" + LOẠI dòng này khỏi tổng mua/bán
    # ở Tổng quan (chỉ tính luân chuyển từng kho, không thổi phồng "mua/bán trong kỳ").
    dieu_chuyen: bool = False
    hang_loai: str | None = None          # giay | vat_tu — khoá danh mục của dòng
    #: Nhóm hàng cho điều kiện "Loại hàng": giay | vat_tu | thanh_pham (vật tư bật cờ thành phẩm).
    nhom_hang: str | None = None
    #: Tên (hoặc khoảng ngày) của kỳ ĐÃ KHÓA SỔ phủ ngày chứng từ của dòng; None = chưa khóa.
    ky_khoa: str | None = None
    #: Phiếu sinh ra từ đâu (mã + chữ hiện): nhap_mua · nhap_thanh_pham · nhap_gia_cong · nhap_tra_vat_tu ·
    #: nhap_khac · xuat_san_xuat · xuat_giao_khach · xuat_gia_cong · xuat_khac.
    ly_do: str | None = None
    ly_do_ten: str | None = None
    lenh: str | None = None               # mã lệnh sản xuất của dòng (nếu có)
    don_hang: str | None = None           # số đơn hàng bán
    khach_hang: str | None = None
    nha_cung_cap: str | None = None       # NCC của đợt mua, hoặc nhà gia công ngoài
    bo_phan: str | None = None            # bộ phận lập yêu cầu kho
    ma_yeu_cau: str | None = None
    nguoi_giao_nhan: str | None = None
    nguoi_lap: str | None = None          # người lập phiếu
    dien_giai: str | None = None


class LuaChonDem(BaseModel):
    """Một giá trị chọn được trong menu Lọc + số dòng mang giá trị đó (đếm trước khi áp điều kiện)."""

    value: str
    nhan: str
    so: int = 0


class LuaChonBaoCaoKho(BaseModel):
    """Giá trị cho nút Lọc của các bảng Báo cáo kho — chỉ những giá trị CÓ trong kỳ + kho + ô tìm
    đang xem (bấm vào không ra bảng rỗng), đếm trước khi áp các điều kiện thuộc tính."""

    hang_loai: list[LuaChonDem] = []
    mat_hang: list[LuaChonDem] = []
    phat_sinh: list[LuaChonDem] = []
    ton: list[LuaChonDem] = []
    loai_phieu: list[LuaChonDem] = []
    ly_do: list[LuaChonDem] = []
    khach_hang: list[LuaChonDem] = []
    nha_cung_cap: list[LuaChonDem] = []


class BaoCaoKhoPage(BaseModel):
    items: list[BaoCaoKhoRow]
    total: int
    #: Tổng tiền của MỌI dòng khớp lọc (không chỉ trang đang xem); None khi người xem không có
    #: ô xem giá của màn — cùng luật ẩn tiền với từng dòng.
    tong_tien: int | None = None
    lua_chon: LuaChonBaoCaoKho | None = None


class BaoCaoChuyenKhoRow(BaseModel):
    """1 dòng hàng của MỘT điều chuyển ĐÃ GHI SỔ — cho màn Báo cáo kho (tab Chuyển kho) + export
    theo mẫu MISA 'Chuyển kho' (Xuất tại kho → Nhập tại kho trên cùng 1 dòng)."""

    voucher_id: int                       # phiếu NHẬP đích (đại diện điều chuyển)
    ngay_ghi_so: date | None = None       # = ngày hạch toán (MISA)
    ngay_ct: date | None = None           # = ngày chứng từ (ngày lập phiếu nhập đích)
    so_ct: str                            # = số chứng từ (mã phiếu nhập đích)
    ma_hang: str | None = None
    ten_hang: str | None = None
    dvt: str | None = None
    so_luong: float
    don_gia_von: int | None = None        # giá vốn chốt từ nguồn (đ/đơn vị gốc)
    tien_von: float | None = None
    kho_xuat_ten: str | None = None       # Xuất tại kho = kho nguồn
    kho_nhap_ten: str | None = None       # Nhập tại kho = kho đích
    # ID kho nguồn/đích — để Sổ Chuyển kho tô MÀU + ổ khóa theo kỳ đã khóa (giống Nhập/Xuất).
    kho_xuat_id: int | None = None
    kho_nhap_id: int | None = None
    dien_giai: str | None = None          # ghi chú điều chuyển
    hang_loai: str | None = None
    nhom_hang: str | None = None          # giay | vat_tu | thanh_pham
    ky_khoa: str | None = None            # kỳ đã khóa sổ phủ dòng (ở kho nguồn hoặc kho đích)


class BaoCaoChuyenKhoPage(BaseModel):
    items: list[BaoCaoChuyenKhoRow]
    total: int
    #: Tổng tiền của MỌI dòng khớp lọc (không chỉ trang đang xem); None khi người xem không có
    #: ô xem giá của màn — cùng luật ẩn tiền với từng dòng.
    tong_tien: int | None = None
    lua_chon: LuaChonBaoCaoKho | None = None


class BaoCaoNXTRow(BaseModel):
    """1 dòng Nhập-Xuất-Tồn theo kỳ (bình quân gia quyền cuối kỳ) của MỘT mặt hàng tại MỘT kho.

    Đơn giá BQ = (GT đầu kỳ + GT nhập)/(SL đầu kỳ + SL nhập); GT xuất = BQ × SL xuất; GT cuối =
    GT đầu + GT nhập − GT xuất (SL cũng vậy). Đầu kỳ = luỹ kế TỒN + GT của MỌI chuyển động TRƯỚC
    `tu` (định giá BQ trên toàn lịch sử trước kỳ) — 'đầu kỳ này = cuối kỳ trước'. SL theo ĐVT gốc."""

    kho_id: int | None = None
    kho_ten: str | None = None
    hang_loai: str
    hang_id: int
    ma_hang: str | None = None
    ten_hang: str | None = None
    hang_nhom: str | None = None          # "Giấy" | "Vật tư" | "Thành phẩm" — cho FE gom nhóm
    nhom_hang: str | None = None          # giay | vat_tu | thanh_pham — điều kiện "Loại hàng"
    dvt: str | None = None
    # Giấy: khổ (mm) + đơn vị gốc — dòng tách theo khoá tồn (cùng khổ khác đơn vị gốc là hai dòng).
    # Hàng khác: 0 · 0 · "" (gom theo mã).
    kho_rong: int = 0
    kho_dai: int = 0
    don_vi_goc: str = ""
    dau_sl: float = 0
    # Bốn ô GIÁ TRỊ nhận None (không phải 0) khi người xem thiếu `kho:view_cost`: họ vẫn đọc được
    # SỐ LƯỢNG nhập-xuất-tồn, chỉ không thấy tiền (xem `_an_tien` ở `routers/kho_baocao.py`).
    # Ghi 0 thì người đọc tin là "kỳ này không phát sinh tiền" — sai lệch còn tệ hơn ô trống.
    dau_gt: int | None = 0
    nhap_sl: float = 0
    nhap_gt: int | None = 0
    xuat_sl: float = 0
    xuat_gt: int | None = 0
    cuoi_sl: float = 0
    cuoi_gt: int | None = 0
    don_gia_bq: float | None = None       # đơn giá bình quân của kỳ (đ/ĐVT gốc)


class BaoCaoNXTPage(BaseModel):
    items: list[BaoCaoNXTRow]
    total: int
    tu: date | None = None
    den: date | None = None
    # Kỳ này ĐÃ tính giá (có snapshot chốt) chưa. False = đang tạm tính live (chưa bấm Tính giá kỳ).
    da_tinh: bool = False
    # Kỳ này (theo ngày `den`) đã bị KHÓA sổ chưa — đã khóa thì không tính lại được.
    da_khoa: bool = False
    # Khi `den` rơi vào GIỮA một kỳ ĐÃ TÍNH (chốt ở ngày khác): mốc chốt + tên của kỳ đó. Báo cáo
    # vẫn hiện Giá trị cuối kỳ nhưng là số TẠM TÍNH tới `den` (khác số đã chốt tại `ky_da_tinh_den`).
    ky_da_tinh_den: date | None = None
    ky_da_tinh_ten: str | None = None
    lua_chon: LuaChonBaoCaoKho | None = None


class ThanhPhamChuaGiaGocRow(BaseModel):
    """Một lô GỐC thành phẩm nhập từ KCS (design nhập kho thành phẩm §5). `don_gia` theo đơn vị dòng
    phiếu nhập (`dvt`); `sl_con_lai` là tổng cả họ lô (lô gốc + lô sinh ra qua điều chuyển), đơn vị gốc."""

    lot_id: int
    ma_lo: str
    ngay_nhap: date | None = None
    kho_id: int | None = None
    kho_ten: str | None = None
    hang_id: int
    ma_hang: str | None = None
    ten_hang: str | None = None
    dvt: str | None = None
    dvt_ten: str | None = None
    so_luong_nhap: float
    don_gia: int
    don_gia_ban: int | None = None
    lsx_ma: str | None = None
    order_ma: str | None = None
    khach_hang: str | None = None
    sl_con_lai: float
    don_vi_goc_ten: str | None = None
    so_lo: int


class LuaChonLocGiaGoc(BaseModel):
    id: int
    ten: str | None = None


class ThanhPhamChuaGiaGocPage(BaseModel):
    items: list[ThanhPhamChuaGiaGocRow]
    total: int
    page: int
    size: int
    # Lựa chọn cho ô lọc nâng cao — chỉ kho/khách có lô gốc thành phẩm từ KCS.
    cac_kho: list[LuaChonLocGiaGoc] = []
    cac_khach: list[LuaChonLocGiaGoc] = []
    cac_hang: list[LuaChonLocGiaGoc] = []


class TinhGiaKyIn(BaseModel):
    """Body 'Tính giá kỳ (bình quân)' — chốt tồn cuối kỳ vào snapshot. kho_id null = mọi kho."""

    tu: date
    den: date
    ten: str | None = Field(default=None, max_length=120)
    kho_id: int | None = None

    @model_validator(mode="after")
    def _chk(self) -> "TinhGiaKyIn":
        if self.den < self.tu:
            raise ValueError("Ngày đến phải ≥ ngày từ.")
        self.ten = (self.ten or "").strip() or None
        return self


class KhoKhoaSoIn(BaseModel):
    kho_id: int | None = None             # None = TOÀN KHO
    tu_ngay: date
    den_ngay: date
    hanh_dong: str = Field(default="khoa", pattern="^(khoa|mo)$")
    ten: str | None = Field(default=None, max_length=120)   # tên kỳ (chỉ khi 'khoa')

    @model_validator(mode="after")
    def _check_range(self):
        if self.den_ngay < self.tu_ngay:
            raise ValueError("Ngày đến phải lớn hơn hoặc bằng ngày từ.")
        return self


class KhoKhoaSoRow(BaseModel):
    id: int
    kho_id: int | None = None
    kho_ten: str | None = None            # None khi kho_id None = "Toàn kho"
    tu_ngay: date
    den_ngay: date
    hanh_dong: str                        # 'khoa' | 'mo'
    nguoi_khoa_ten: str | None = None
    khoa_luc: datetime | None = None
    ten: str | None = None                # tên kỳ (nếu có)


class KhoExportLogRow(BaseModel):
    """1 dòng nhật ký thao tác báo cáo kho (XUẤT EXCEL hoặc TÍNH GIÁ KỲ) — cho tab 'Lịch sử thao tác'."""
    thoi_diem: datetime
    # Loại thao tác để FE tô badge: "export" (xuất Excel) | "tinh_gia" (tính giá kỳ).
    hanh_dong: str = "export"
    loai: str                             # nhãn: "Nhập kho"/"Xuất kho"/… hoặc "Tính giá kỳ"
    pham_vi: str                          # loại báo cáo · kho (vd "Nhập kho · Kho nguyên vật liệu")
    khoang_ngay: str | None = None        # "01/08/2026 – 18/08/2026" hoặc None
    ten_ky: str | None = None             # tên kỳ đã khóa nếu khoảng ngày trùng kỳ; "Toàn bộ" nếu ko lọc ngày
    nguoi_ten: str | None = None


class KhoaSoKyRow(BaseModel):
    """1 kỳ CÒN đang khóa (đã gộp khoảng liền mạch) — cho tab 'Kỳ đã khóa' chọn nhanh + xuất."""
    kho_id: int | None = None             # None = Toàn kho
    kho_ten: str | None = None
    tu_ngay: date
    den_ngay: date
    khoa_luc: datetime | None = None      # thời điểm khóa quyết định tại ngày đầu kỳ
    ten: str | None = None                # tên kỳ (từ bản ghi 'khoa' quyết định)
    mien_tru: list[str] = []              # (kỳ TOÀN KHO) tên các kho đã MỞ RIÊNG trong kỳ này


class KyDaTinhRow(BaseModel):
    """1 kỳ ĐÃ TÍNH GIÁ (có snapshot `kho_ky_ton`) — cho tab 'Kỳ đã tính' chọn nhanh + đối chiếu."""
    tu_ngay: date
    den_ngay: date
    ten: str | None = None                # tên kỳ đã đặt khi tính (đại diện)
    so_mat_hang: int                      # số dòng snapshot = số (kho × mặt hàng)
    so_kho: int                           # số kho có tồn cuối kỳ
    tong_gt_cuoi: int                     # tổng giá trị tồn cuối kỳ (đồng)
    tinh_luc: datetime                    # lần tính gần nhất
    da_khoa: bool = False                 # kỳ (theo ngày cuối) đã khóa sổ chưa


class StockVoucherCancel(BaseModel):
    """Body khi HỦY phiếu nháp — BẮT BUỘC lý do; yêu cầu chuyển 'Đã hủy' kèm lý do này."""

    ly_do: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def _strip(self) -> "StockVoucherCancel":
        self.ly_do = self.ly_do.strip()
        if not self.ly_do:
            raise ValueError("Phải nhập lý do hủy.")
        return self


class DieuChinhLichSuRow(BaseModel):
    """1 lần ĐIỀU CHỈNH phiếu xuất — cho 'Lịch sử điều chỉnh' trong drawer phiếu (ai · bộ phận · lúc nào)."""
    thoi_diem: datetime
    nguoi_ten: str | None = None
    bo_phan_ten: str | None = None
    chi_tiet: str | None = None           # "Bản kẽm 74: 19 → 7; …"
    ly_do: str | None = None              # lý do điều chỉnh (bắt buộc khi thao tác)


class DieuChinhXuatLineIn(BaseModel):
    """1 dòng phiếu XUẤT điều chỉnh GIẢM: `line_id` + số lượng MỚI (theo ĐVT của dòng, ≤ hiện tại)."""

    line_id: int = Field(gt=0)
    so_luong_moi: float = Field(gt=0)


class DieuChinhXuatIn(BaseModel):
    """Body điều chỉnh phiếu XUẤT đã ghi sổ khi SX dùng ÍT hơn số đã xuất (xuất 10 → dùng 7).

    Chỉ liệt kê dòng CÓ ĐỔI; dòng không gửi giữ nguyên. Server chặn nếu không dòng nào giảm thật.
    BẮT BUỘC `ly_do` — điều chỉnh phiếu đã ghi sổ là thao tác đụng sổ, phải ghi rõ vì sao."""

    lines: list[DieuChinhXuatLineIn] = Field(min_length=1)
    ly_do: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def _strip_ly_do(self) -> "DieuChinhXuatIn":
        self.ly_do = self.ly_do.strip()
        if not self.ly_do:
            raise ValueError("Phải nhập lý do điều chỉnh.")
        return self


# --- Phiếu -------------------------------------------------------------------

class StockVoucherLineIn(BaseModel):
    # Mặt hàng KẾ THỪA từ dòng đề nghị (kho không đổi được), nên phiếu chỉ gửi `request_line_id`.
    # Bỏ `material_id` + cụm `new_*`: đường "kho tạo hàng mới lúc lập phiếu" đã đóng (siết).
    request_line_id: int
    so_luong: float = Field(gt=0)
    # Phiếu NHẬP: giá của lô sắp tạo. Phiếu XUẤT: bỏ qua (giá lấy từ lô).
    don_gia: int | None = Field(default=None, ge=0)
    # Phiếu XUẤT: bắt buộc. Phiếu NHẬP: bỏ qua (lô sinh ra lúc ghi sổ).
    lot_id: int | None = None
    # Lý do cấp/nhập THIẾU (khi SL < còn phải cấp) — bắt buộc nếu thiếu; ghi vào yêu cầu (kho phản hồi).
    ly_do: str | None = Field(default=None, max_length=500)
    ghi_chu: str | None = Field(default=None, max_length=500)
    # Phiếu NHẬP: vị trí cất lô trong kho (kệ/ô) — thủ kho khai; ghi sổ chép sang lô.
    vi_tri: str | None = Field(default=None, max_length=100)
    # Phiếu NHẬP: hạn sử dụng của lô sắp tạo (tuỳ chọn). Tách hạn = nhiều dòng (mỗi hạn 1 dòng),
    # phần dư không hạn để None. XUẤT bỏ qua.
    hsd: date | None = None
    # Phiếu NHẬP giấy: khổ của lô sắp tạo. Bỏ trống ⇒ kế thừa dòng yêu cầu. Đơn vị gốc LUÔN theo dòng
    # yêu cầu. Phiếu XUẤT: bỏ qua — khổ + đơn vị lấy từ dòng yêu cầu, lô phải khớp.
    kho_rong: int | float | None = Field(default=0, ge=0)
    kho_dai: int | float | None = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _chuan_kho(self) -> "StockVoucherLineIn":
        self.kho_rong, self.kho_dai = _chuan_kho_giay(None, self.kho_rong, self.kho_dai)
        return self


class StockVoucherCreate(BaseModel):
    request_id: int
    kho_id: int
    # Số phiếu tự nhập (tuỳ chọn); bỏ trống → hệ thống tự sinh (PNK/PXK####).
    ma: str | None = Field(default=None, max_length=30)
    ngay: date | None = None
    ghi_chu: str | None = Field(default=None, max_length=1000)
    lines: list[StockVoucherLineIn] = Field(min_length=1)
    # Người dùng bấm "Tạo và ghi sổ": xét khoá kỳ NGAY lúc tạo, đừng để lại phiếu nháp khi lượt ghi
    # sổ sau đó bị chặn (#45, 18/10/2026). Lập nháp thuần thì bỏ trống — vẫn lập được trong kỳ khoá.
    ghi_so: bool = False


class StockVoucherLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    request_line_id: int
    hang_loai: str
    hang_id: int
    hang_ma: str | None = None
    hang_ten: str | None = None
    dvt: str | None = None
    kho_rong: int = 0
    kho_dai: int = 0
    lot_id: int | None = None
    ma_lo: str | None = None
    # Hạn sử dụng của lô (phiếu NHẬP) — để phiếu điều chuyển hiện HSD đích danh theo TỪNG LÔ. Không
    # phải số tiền nên KHÔNG ẩn theo `can_view_cost`. None = lô không hạn.
    hsd: date | None = None
    # Vị trí cất lô (kệ/ô) — phiếu NHẬP; để phiếu điều chuyển HIỆN/KHAI vị trí per-lô. None = chưa khai.
    vi_tri: str | None = None
    # SL người yêu cầu XIN trên dòng yêu cầu gốc (đọc-nối từ StockRequestLine, không lưu cột).
    # Để phiếu đối chiếu "yêu cầu vs thực nhận/xuất". None nếu không nối được dòng yêu cầu.
    sl_de_nghi: float | None = None
    so_luong: float
    # Số đã quy về đơn vị gốc (số thật sự chạy vào lô) + đơn vị đó — để bản in và màn phiếu nói rõ
    # "10 ram (= 419,25 kg)" thay vì để người đọc tự đoán con số nào vào tồn.
    sl_goc: float | None = None
    don_vi_goc: str | None = None
    ghi_chu: str | None = None
    # Hai trường tiền — router xóa khi thiếu `can_view_cost`.
    don_gia: int | None = None
    thanh_tien: int | None = None
    # Dòng là thành phẩm KCS mà lô CHƯA CÓ giá gốc (kế toán kho gõ sau ở Báo cáo kho) ⇒ số 0 ở hai
    # trường trên là "chưa biết", không phải miễn phí — màn và bản in ghi "Chưa có giá gốc". Luôn
    # False khi thiếu `can_view_cost` (biết "giá đang 0" cũng là biết giá).
    chua_gia_goc: bool = False
    # Nguồn của hàng (lệnh / đơn / khách, đọc ở LÔ GỐC như StockLotOut) — để phiếu nói hàng này của ai.
    # Dòng xuất gộp nhiều lô khác đơn thì nối các mã bằng ", ". Không phải tiền nên không ẩn.
    lsx_ma: str | None = None
    order_ma: str | None = None
    khach_hang: str | None = None
    # Giá bán của đơn (đ / đvt dòng yêu cầu), chỉ tham khảo, không vào sổ kho. Là tiền ⇒ None khi
    # thiếu `can_view_cost`; dòng xuất gộp các lô có giá bán khác nhau cũng None.
    don_gia_ban: int | None = None


class StockVoucherOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ma: str
    loai: str
    request_id: int
    request_ma: str | None = None
    # Loại phiếu (tự do) người tạo gõ ở YÊU CẦU — hiện trên phiếu + list; Báo cáo kho dùng export.
    loai_kho: str | None = None
    kho_id: int
    kho_ten: str | None = None
    ngay: date
    nguoi_lap_id: int
    nguoi_lap_ten: str | None = None
    # Chuỗi trách nhiệm lấy từ YÊU CẦU gốc: ai yêu cầu · ai duyệt (phiếu tự nó không có bước duyệt).
    nguoi_de_nghi_ten: str | None = None
    nguoi_duyet_ten: str | None = None
    # Người GHI SỔ (duyệt/chốt phiếu) — chỉ có sau khi đã ghi sổ.
    nguoi_ghi_so_ten: str | None = None
    nguoi_giao_nhan: str | None = None
    ghi_chu: str | None = None
    trang_thai: str
    ghi_so_luc: datetime | None = None
    created_at: datetime
    # ĐIỀU CHUYỂN KHO (mig 0203): true cho cả phiếu xuất nguồn lẫn phiếu nhập đích — FE/báo cáo
    # gắn nhãn "điều chuyển"; báo cáo loại khỏi tổng mua/bán.
    dieu_chuyen: bool = False
    lines: list[StockVoucherLineOut] = []
    # Tổng giá vốn — chỉ có khi `can_view_cost`.
    gia_von: int | None = None


class StockVoucherPage(BaseModel):
    items: list[StockVoucherOut]
    total: int
    #: Số phiếu theo tab màn tồn từng kho (`nhap` / `xuat` / `dc`) — cùng bộ lọc, trừ tab.
    dem_theo_tab: dict[str, int] | None = None


# --- Điều chuyển kho (spec-dieu-chuyen-kho) ---------------------------------

class DieuChuyenItemIn(BaseModel):
    """1 mặt hàng cần điều chuyển. `so_luong` theo ĐƠN VỊ GỐC của mặt hàng."""

    hang_loai: str = Field(pattern="^(giay|vat_tu)$")
    hang_id: int = Field(gt=0)
    so_luong: float = Field(gt=0)
    # Vị trí cất ở KHO ĐÍCH (kệ/ô) — tuỳ chọn, khai ngay lúc ấn điều chuyển; áp cho MỌI lô của mặt
    # hàng này. Thủ kho đích còn sửa lại được ở drawer trước khi ghi sổ.
    vi_tri: str | None = Field(default=None, max_length=100)
    # GIẤY / VẬT TƯ: nhóm lô nguồn cần chuyển — khổ (chỉ giấy) + ĐƠN VỊ GỐC của dòng tồn (`don_vi_goc` đọc từ dòng tồn,
    # "to" / "kg"…). `so_luong` theo đơn vị gốc đó. Cùng mã khác khổ / khác đơn vị = hai dòng. Bỏ trống
    # `don_vi_goc` ⇒ máy chủ suy từ lô ở kho nguồn khi chúng cùng một đơn vị, không thì chặn.
    don_vi_goc: str | None = Field(default=None, max_length=16)
    kho_rong: int | float | None = Field(default=0, ge=0)
    kho_dai: int | float | None = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _chuan_kho(self) -> "DieuChuyenItemIn":
        self.kho_rong, self.kho_dai = _chuan_kho_giay(self.hang_loai, self.kho_rong, self.kho_dai)
        if not co_don_vi_goc(self.hang_loai):
            self.don_vi_goc = None
        elif self.don_vi_goc is not None:
            self.don_vi_goc = self.don_vi_goc.strip().lower() or None
        return self


class DieuChuyenIn(BaseModel):
    """Ấn ĐIỀU CHUYỂN 1 HAY NHIỀU mặt hàng kho nguồn → kho đích (gộp vào MỘT yêu cầu điều chuyển)."""

    kho_nguon_id: int
    kho_den_id: int
    items: list[DieuChuyenItemIn] = Field(min_length=1)
    ghi_chu: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _valid(self) -> "DieuChuyenIn":
        if self.kho_nguon_id == self.kho_den_id:
            raise ValueError("Kho nguồn và kho đích phải khác nhau.")
        seen: set = set()
        for it in self.items:
            # Giấy: cùng mã khác khổ / khác đơn vị gốc là hai dòng hợp lệ.
            key = khoa_dong(it.hang_loai, it.hang_id, it.don_vi_goc, it.kho_rong, it.kho_dai)
            if key in seen:
                raise ValueError("Một mặt hàng chỉ được điều chuyển 1 dòng — gộp số lượng lại.")
            seen.add(key)
        return self


class DieuChuyenOut(BaseModel):
    """Kết quả ấn điều chuyển: MỘT yêu cầu điều chuyển (NHẬP đích) + phiếu xuất nguồn NHÁP + phiếu
    NHẬP đích DỰNG SẴN (nháp, khoá giá vốn + HSD đích danh theo lô) để kho đích chỉ việc ghi sổ."""

    yeu_cau_id: int
    yeu_cau_ma: str
    phieu_xuat_id: int
    phieu_xuat_ma: str
    # Phiếu NHẬP đích hệ dựng sẵn (nháp) — kho đích ghi sổ phiếu này để hoàn tất điều chuyển.
    phieu_nhap_id: int
    phieu_nhap_ma: str
    kho_nguon_id: int
    kho_den_id: int
    so_dong: int
    # Tổng giá vốn điều chuyển (Σ theo từng mặt hàng) — router XÓA khi thiếu `can_view_cost`.
    gia_von: int | None = None


class StockVoucherAttachmentOut(BaseModel):
    """Hóa đơn/chứng từ gốc đính kèm phiếu — chỉ metadata + đường dẫn tải (mount /static)."""

    id: int
    stock_voucher_id: int
    file_name: str
    file_url: str
    file_type: str | None = None
    uploaded_by: int | None = None
    uploaded_at: datetime


class StockVoucherAttachmentListOut(BaseModel):
    items: list[StockVoucherAttachmentOut]


# --- Lô & phân bổ ------------------------------------------------------------

class StockLotKhoIn(BaseModel):
    """Kho bổ sung KHỔ cho lô giấy cũ chưa có khổ — chỉ ghi khổ, số lượng / đơn vị / giá giữ nguyên."""

    kho_rong: int = Field(ge=1, le=100000)
    kho_dai: int = Field(default=0, ge=0, le=100000)


class StockLotViTriIn(BaseModel):
    """Sửa vị trí cất lô (kệ/ô) trong kho."""

    vi_tri: str | None = Field(default=None, max_length=100)


class GiaGocIn(BaseModel):
    """Kế toán kho gõ giá gốc cho lô thành phẩm — đ theo đơn vị dòng phiếu nhập (đ/hộp)."""

    don_gia: int = Field(ge=0)


class GiaGocOut(BaseModel):
    lot_id: int
    ma_lo: str
    don_gia_cu: int
    don_gia: int
    don_gia_nhap: int
    so_lo: int


class StockVoucherLineViTri(BaseModel):
    line_id: int
    vi_tri: str | None = Field(default=None, max_length=100)


class StockVoucherViTriIn(BaseModel):
    """Khai/sửa VỊ TRÍ cất lô cho các dòng phiếu NHẬP còn NHÁP (trước khi ghi sổ) — dùng cho phiếu
    ĐIỀU CHUYỂN (phiếu đích dựng sẵn không có form nhập vị trí). Ghi sổ chép sang lô."""

    lines: list[StockVoucherLineViTri] = Field(default_factory=list)


class StockLotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ma_lo: str
    hang_loai: str
    hang_id: int
    hang_ma: str | None = None
    hang_ten: str | None = None
    # Ảnh minh hoạ mặt hàng (từ danh mục) — màn Tồn kho gom theo mặt hàng nên chép sẵn vào lô.
    hang_anh: str | None = None
    # ĐƠN VỊ GỐC của mặt hàng — `sl_ban_dau`/`sl_con_lai` của lô đều theo đơn vị này. `dvt` = MÃ
    # (to/cai/kem…), `dvt_ten` = TÊN có dấu (tờ/cái/bản kẽm) để HIỂN THỊ. Mã giữ cho logic/quy đổi.
    dvt: str | None = None
    dvt_ten: str | None = None
    kho_id: int
    vi_tri: str | None = None
    # Giấy: đơn vị gốc + khổ của lô (vật tư khác: "" · 0 · 0). Lô cũ chưa có khổ: 0 · 0.
    don_vi_goc: str = ""
    kho_rong: int = 0
    kho_dai: int = 0
    ngay_nhap: date
    ncc: str | None = None
    sl_ban_dau: float
    sl_con_lai: float
    hsd: date | None = None
    trang_thai: str
    # Phiếu NHẬP đã tạo ra lô này — màn Tồn kho hiển thị lô THEO MÃ PHIẾU (link mở phiếu). Null = đầu kỳ.
    voucher_id: int | None = None
    voucher_ma: str | None = None
    # Giá vốn của lô — chỉ có khi `can_view_cost`. Thủ kho chọn lô mà không thấy giá.
    don_gia_nhap: int | None = None
    # SL yêu cầu đã sinh ra lô (đọc-nối qua dòng phiếu NHẬP tạo lô → dòng yêu cầu). Không lưu cột.
    # Không phải tiền → luôn hiện được. None = lô đầu kỳ / không nối được dòng yêu cầu.
    sl_de_nghi: float | None = None
    # ĐƠN VỊ của `sl_de_nghi` (đơn vị người xin khai) — có thể KHÁC `dvt` gốc của lô (xin 'tờ',
    # lô lưu 'ram'). Lịch sử ghi rõ để không nhìn "40.000 (tờ)" cạnh "80 (ram)" tưởng lệch.
    dvt_yeu_cau: str | None = None
    # Lô này SINH RA từ phiếu ĐIỀU CHUYỂN (nhận về) → lịch sử mặt hàng xếp vào tab "Chuyển kho"
    # riêng, không lẫn tab Nhập thường. Không lưu cột — router suy từ voucher tạo lô.
    dieu_chuyen: bool = False
    # NGUỒN LÔ (design nhập kho thành phẩm §5–§6) — đọc ở lô gốc, sống qua điều chuyển. `tu_kcs` = thành
    # phẩm nhập từ KCS (lô này mới có "giá gốc" sửa sau). `don_gia_ban` chỉ có khi `can_view_cost`.
    lo_goc_id: int | None = None
    lsx_ma: str | None = None
    order_ma: str | None = None
    khach_hang: str | None = None
    don_gia_ban: int | None = None
    tu_kcs: bool = False


class TonNhomDem(BaseModel):
    """Số MẶT HÀNG (nhóm tồn) theo 5 nhóm lọc của màn Tồn kho — đếm trên tập đã lọc bởi ô tìm, kỳ Nhập và các khoảng; bỏ riêng bộ lọc nhóm."""

    all: int = 0
    can_mua: int = 0
    du_ton: int = 0
    chuakhai: int = 0
    sap_het_han: int = 0


class AllocationLineOut(BaseModel):
    lot_id: int
    ma_lo: str
    ngay_nhap: date
    hsd: date | None = None
    sl_con_lai: float
    so_luong: float
    don_vi_goc: str = ""
    kho_rong: int = 0
    kho_dai: int = 0
    don_gia_nhap: int | None = None
    # Nguồn lô thành phẩm (đọc ở lô gốc) + cảnh báo "Lô này sản xuất cho đơn DH…" khi xuất cho Giao
    # hàng mà lô thuộc đơn khác cùng khách.
    order_ma: str | None = None
    khach_hang: str | None = None
    canh_bao: str | None = None
    # Lô thành phẩm KCS kế toán chưa gõ giá gốc: `don_gia_nhap` 0 là "chưa biết", không phải 0 đ.
    chua_gia_goc: bool = False


class AllocationOut(BaseModel):
    """Gợi ý phân bổ lô cho 1 dòng xuất. `thieu` > 0 = kho không đủ hàng."""

    lines: list[AllocationLineOut]
    thieu: float


# --- Lịch sử Nhập/Xuất theo vật tư (popup màn Tồn kho) -----------------------

class MaterialXuatRow(BaseModel):
    """1 dòng phiếu XUẤT đã ghi sổ của mã hàng — để theo dõi xuất RIÊNG với nhập (lô)."""

    ngay: date
    voucher_id: int
    voucher_ma: str | None = None
    lot_id: int | None = None
    ma_lo: str | None = None
    # SL yêu cầu đã sinh ra dòng xuất (đọc-nối qua dòng phiếu XUẤT → dòng yêu cầu). Không lưu cột.
    sl_de_nghi: float | None = None
    # ĐƠN VỊ của `sl_de_nghi` (đơn vị người xin) — có thể khác đơn vị gốc; ghi rõ cho cột SL yêu cầu.
    dvt_yeu_cau: str | None = None
    so_luong: float
    # Giá vốn ĐÍCH DANH của lô đã xuất — router XÓA khi thiếu `can_view_cost`.
    don_gia: int | None = None
    # Dòng xuất này thuộc phiếu ĐIỀU CHUYỂN (chuyển đi) → lịch sử mặt hàng xếp vào tab "Chuyển kho".
    dieu_chuyen: bool = False
    # Vị trí + HSD của LÔ đã xuất (đọc cùng câu) và lô thành phẩm từ KCS chưa có giá gốc.
    vi_tri: str | None = None
    hsd: date | None = None
    chua_gia_goc: bool = False


class MaterialHistoryOut(BaseModel):
    """Lịch sử 1 mã hàng tại 1 kho: NHẬP = các lô (kể cả đã hết) · XUẤT = dòng phiếu xuất."""

    hang_loai: str
    hang_id: int
    hang_ma: str | None = None
    hang_ten: str | None = None
    dvt: str | None = None
    on_hand: float
    nhap: list[StockLotOut] = []
    xuat: list[MaterialXuatRow] = []


class MaterialChuyenRow(BaseModel):
    """1 dòng tab "Chuyển kho" của ngăn mặt hàng: lô NHẬN VỀ (`chieu=in`) hoặc dòng CHUYỂN ĐI (`out`)."""

    key: str
    chieu: str
    ngay: date
    voucher_id: int | None = None
    voucher_ma: str | None = None
    so_luong: float
    don_gia: int | None = None
    chua_gia_goc: bool = False
    vi_tri: str | None = None
    hsd: date | None = None


class MaterialHistoryPage(BaseModel):
    """MỘT trang của một tab ngăn mặt hàng (Lô tồn / Lịch sử nhập / Lịch sử xuất / Chuyển kho).

    Cắt trang ở DB: lịch sử một mặt hàng dày lên theo năm, không nạp cả về trình duyệt. `dem` = số
    dòng của MỌI tab (cho số trên tab), `lo`/`xuat`/`chuyen` chỉ một trong ba có dòng theo `tab`."""

    hang_loai: str
    hang_id: int
    hang_ma: str | None = None
    hang_ten: str | None = None
    dvt: str | None = None
    on_hand: float
    tab: str
    page: int
    size: int
    dem: dict[str, int]
    lo: list[StockLotOut] = []
    xuat: list[MaterialXuatRow] = []
    chuyen: list[MaterialChuyenRow] = []


# --- Tra kho CÔNG KHAI (quét tem QR, không đăng nhập) -------------------------
# TUYỆT ĐỐI không có trường tiền (giá vốn/đơn giá): trang này ai có link cũng xem được.

class PublicScanLot(BaseModel):
    ma_lo: str | None = None
    ngay_nhap: date
    hsd: date | None = None
    vi_tri: str | None = None
    sl_con_lai: float


class PublicScanMove(BaseModel):
    """1 lần nhập/xuất gần đây (công khai — TUYỆT ĐỐI KHÔNG có tiền)."""

    loai: str              # NHAP / XUAT
    ngay: date | None = None
    so_ct: str
    so_luong: float


class PublicScanOut(BaseModel):
    """Dữ liệu tra kho công khai: tên vật tư · ĐVT · kho · tổng tồn · vị trí · lịch sử nhập/xuất."""

    material_code: str | None = None
    material_name: str | None = None
    dvt: str | None = None
    kho_ten: str | None = None
    on_hand: float
    # Đường ảnh minh hoạ CÔNG KHAI (`/api/public/vat-lieu-anh?t=…`) — dùng lại chính token QR để
    # serve, không cần đăng nhập. None = vật tư chưa có ảnh.
    anh_url: str | None = None
    lots: list[PublicScanLot] = []
    history: list[PublicScanMove] = []


# --- Ngưỡng tồn ---------------------------------------------------------------

class StockThresholdIn(BaseModel):
    hang_loai: str = Field(pattern="^(giay|vat_tu)$")
    hang_id: int = Field(gt=0)
    kho_id: int
    nguong_ton: float = Field(ge=0)
    # Bỏ trống → service suy ra = nguong_ton × 1.3 (spec §7).
    nguong_can_ton: float | None = Field(default=None, ge=0)
    nguong_toi_da: float | None = Field(default=None, ge=0)
    canh_bao: bool = True
    # Giấy: ngưỡng đặt riêng cho từng dòng tồn = khổ (mm, đủ hai cạnh hoặc chỉ rộng) + ĐƠN VỊ GỐC
    # (`don_vi_goc` của dòng tồn — "to" / "kg"…). Vật tư: khổ 0 · 0 + đơn vị gốc (mg 0390).
    kho_rong: int = 0
    kho_dai: int = 0
    don_vi_goc: str = Field(default="", max_length=16)

    @model_validator(mode="after")
    def _khoa_kho(self):
        if not co_don_vi_goc(self.hang_loai):
            self.kho_rong, self.kho_dai, self.don_vi_goc = 0, 0, ""
            return self
        self.kho_rong, self.kho_dai = _chuan_kho_giay(self.hang_loai, self.kho_rong, self.kho_dai)
        self.don_vi_goc = (self.don_vi_goc or "").strip().lower()
        return self


class StockThresholdOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    hang_loai: str
    hang_id: int
    hang_ma: str | None = None
    hang_ten: str | None = None
    kho_id: int
    kho_rong: int = 0
    kho_dai: int = 0
    don_vi_goc: str = ""
    nguong_ton: float
    nguong_can_ton: float | None = None
    nguong_toi_da: float | None = None
    canh_bao: bool


class StockLevelOut(BaseModel):
    """Mức tồn của 1 mã hàng. `ton_kha_dung` chỉ có khi `can_view_stock` — thiếu quyền thì
    người dùng vẫn thấy `muc_ton` (đèn 5 màu) để biết sắp hết mà không biết còn bao nhiêu."""

    hang_loai: str
    hang_id: int
    muc_ton: str
    ton_kha_dung: float | None = None


# GỠ 2026-08-08: `StockMaterialCreate` + `StockMaterialQuyDoi` — hai cửa cho kho tự đẻ mặt
# hàng và tự khai quy đổi cho từng dòng. Nay mặt hàng phải có sẵn trong danh mục Giấy / Vật
# tư khác, còn quy đổi lấy từ đồ thị đơn vị dùng chung.


class DuBaoLenhRow(BaseModel):
    """Một lệnh (hoặc bài ghép) sắp lĩnh mặt hàng — theo đúng thứ tự ăn tồn của bảng cân đối."""

    ma: str
    lsx_id: int | None = None
    bai_ghep_id: int | None = None
    ten_viec: str | None = None
    khach_ten: str | None = None
    han_sx: date | None = None
    #: Σ `con_phai_co` của chủ thể với mặt hàng này — đơn vị GỐC.
    can: float = 0
    #: Phần đã giữ chỗ (kho + đang về) của chủ thể — để bày, không vào phép trừ.
    da_giu: float = 0
    #: Việc xuất là ĐỀ NGHỊ XUẤT còn treo ở kho này (giao hàng, gia công ngoài, xuất lẻ) chứ không
    #: phải lệnh — `ma` là số đề nghị, `han_sx` là ngày cần (12/10/2026).
    de_nghi_id: int | None = None


class DuBaoVeRow(BaseModel):
    ma: str | None = None
    ngay_ve: date
    sl: float
    # Hàng đang về này mua cho lệnh nào / tồn kho (08/10/2026).
    mua_cho: list[MuaChoLenhOut] = Field(default_factory=list)
    loai_mua_cac: list[str] = Field(default_factory=list)


class TonKhoaRow(BaseModel):
    """Tồn toàn xưởng của MỘT khoá (khổ + đơn vị gốc) của một mặt hàng — không tiền. Số theo đơn vị
    gốc của khoá: giấy theo `don_vi_goc` của lô (tờ / đơn vị giá), hàng khác theo đơn vị gốc của mã."""

    kho_rong: int = 0
    kho_dai: int = 0
    ton: float = 0
    don_vi_goc: str | None = None
    don_vi_goc_ten: str | None = None


class DuBaoTonRow(BaseModel):
    """Dự báo của MỘT dòng màn Tồn kho (khoá tồn 5 phần). Số đều theo đơn vị GỐC của dòng.

    Không có tiền: PMH chỉ được gọi tên (`phieu_mua`), giá nằm ở sổ giá của danh mục."""

    hang_loai: str
    hang_id: int
    kho_rong: int = 0
    kho_dai: int = 0
    #: Giấy: đơn vị gốc của dòng (tờ / đơn vị giá). Hàng khác "".
    don_vi_goc: str = ""
    #: Tồn TOÀN XƯỞNG mà bảng cân đối đang dùng — giữ chỗ không chia theo kho, nên màn kho cần
    #: số này để nói "lệnh tính trên tồn mọi kho". `None` = không lệnh nào cần mã này.
    ton_toan_xuong: float | None = None
    can_lenh: float = 0
    dang_ve: float = 0
    lenh: list[DuBaoLenhRow] = Field(default_factory=list)
    ve: list[DuBaoVeRow] = Field(default_factory=list)
    phieu_mua: list[dict] = Field(default_factory=list)


class TonNhomMuc(BaseModel):
    """Phán quyết của MỘT dòng tồn (nhóm) trong trang — máy chủ là nguồn DUY NHẤT của "Cần mua", chip
    Tình trạng và các số dự báo mà dòng bày; màn không tự tính lại. Không có tiền."""

    #: Khoá dòng tồn dạng chuỗi như `khoaTon` bên màn, luôn 5 phần: `giay:12:780:905:to` ·
    #: `giay:12:1000:0:kg` · `vat_tu:5:0:0:`.
    khoa: str
    hang_loai: str
    hang_id: int
    kho_rong: int = 0
    kho_dai: int = 0
    don_vi_goc: str = ""
    can_mua: bool = False
    #: Đã khai ngưỡng cho dòng này ở kho này (cùng khổ + đơn vị gốc; lô giấy chưa có khổ khớp ngưỡng 0 × 0).
    co_nguong: bool = False
    #: Mặt hàng là THÀNH PHẨM (`vat_tu_in_an.la_thanh_pham`) — thiếu thì phải sản xuất chứ không mua, màn
    #: đổi chữ "Cần mua" thành "Cần sản xuất" (12/10/2026). Luật tính không đổi.
    la_thanh_pham: bool = False
    #: `het` · `can_mua` · `vuot` (đang vượt tối đa) · `se_vuot` · `chua` (chưa đặt mức) · None (trong mức).
    tinh_trang: str | None = None
    #: Sắp xuất / Sắp về / Dự kiến còn của dòng; None khi dự báo không dùng được lúc này.
    can_lenh: float | None = None
    dang_ve: float | None = None
    du_kien: float | None = None
    duoi_cuoi: bool = False
    #: Dòng dự báo đầy đủ (lệnh, đơn về) cho ngăn chi tiết — chỉ dòng trong trang; None khi dự báo hỏng.
    du_bao: DuBaoTonRow | None = None


class TonNhomPage(BaseModel):
    """Một trang màn Tồn kho của MỘT kho — máy chủ đã lọc, đếm, cắt trang theo MẶT HÀNG.

    `items` = lô của các mặt hàng TRONG TRANG (không phải một dòng mỗi mặt hàng): màn gom chúng thành
    dòng tồn như cũ. `total` = số mặt hàng khớp lọc (không phải số lô). `nhom` = phán quyết từng dòng."""

    items: list[StockLotOut]
    total: int
    dem: TonNhomDem
    #: Có mặt hàng nào của kho khai hạn sử dụng — màn chỉ bày cột Hạn sử dụng khi có.
    co_hsd: bool = False
    nhom: list[TonNhomMuc] = Field(default_factory=list)
    #: False khi dự báo hỏng tạm thời: "Cần mua" lùi về mức tồn so với ngưỡng, các số dự báo để trống.
    du_bao_ok: bool = True
    #: Mọi mặt hàng của kho đều là thành phẩm — nhóm lọc "Cần mua" đổi tên thành "Cần sản xuất".
    chi_thanh_pham: bool = False
