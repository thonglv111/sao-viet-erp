"""Schema mặt ĐỌC của module Thực hiện sản xuất (Giai đoạn 2 — bàn tổ).

Chỉ khai phần đang dùng: danh sách tổ + badge, và công việc đã phát hành của một tổ. Service trả
dict nên các schema này chỉ để `response_model` khoá hình dạng ra FE (Pydantic nuốt field lạ IM
LẶNG — thêm field ở service phải thêm ở đây, xem [[pydantic-nuot-field-im-lang]])."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from .loc_danh_sach import LuaChonLoc
from .lsx import LsxDinhKemOut
from .xep_lich import CaXuongOut, NgayDacBietOut


class TeamOut(BaseModel):
    id: int
    ten: str
    ma: str
    # Vai của NGƯỜI ĐANG XEM ở tổ này, không phải thuộc tính của tổ: cùng một tổ, tổ trưởng thấy
    # `false` còn thợ trong tổ thấy `true`.
    la_tho: bool = False
    so_viec_cho: int
    # Bàn giao đến + lỗi KCS chưa xem đang chờ tổ trong vùng (người xem giữ Xác nhận
    # sản lượng trọn tổ) — cộng vào badge menu cùng `so_viec_cho`.
    so_cho_xac_nhan: int = 0
    # Quyền theo tổ (mg 0302): cấp thụt lề trên cây khối Sản xuất + mức từng việc trên CHÍNH nút
    # này (`{"read"|"run_order"|"confirm_output"|"warehouse": "all"|"own"}`, vắng = không có).
    cap: int = 0
    quyen: dict[str, str] = {}


class TeamsOut(BaseModel):
    teams: list[TeamOut]


class ThucTeKhoangOut(BaseModel):
    """Một phiên chạy THỰC TẾ (§7.2) để vẽ lớp thực-tế đè lên thanh kế hoạch (§5.1). `ket_thuc=None`
    = phiên còn mở (đang chạy) → FE kéo tới "bây giờ"."""
    bat_dau: datetime
    ket_thuc: datetime | None = None


class VatTuDinhMucOut(BaseModel):
    """Một dòng định mức vật tư của bước — đóng băng lúc phát hành (`vat_tu_json`), KHÁC "vật tư"
    ở drawer (đó là phiếu XUẤT đã cấp cho cả LSX, không phải định mức theo bước)."""
    vat_tu_id: int | None = None
    ma: str | None = None
    ten: str | None = None
    don_vi: str | None = None
    so_luong: float | None = None


class KhuonChipOut(BaseModel):
    """Ảnh chụp khuôn của bước, đủ để vẽ chip — KHÔNG phải bản sao của danh mục.

    Đọc từ `san_xuat_cong_viec.khuon_json` (chụp lúc phát hành), không tra danh mục sống: tổ phải
    thấy đúng con dao đã chốt, kể cả khi kế hoạch đổi dao sau đó.
    """
    ma: str | None = None
    ten: str | None = None
    so_ke: str | None = None
    tinh_trang: str | None = None


class MonVatTuOut(BaseModel):
    ten: str
    dvt: str | None = None
    sl_xin: float
    sl_da_xuat: float
    chot_thieu: bool = False
    lan_so: int | None = None
    muc: str


class TrangThaiVatTuOut(BaseModel):
    """Chip cột Vật tư của lưới bàn tổ (spec 2026-10-18 §5.1) — cùng hàm với cổng Bắt đầu."""
    muc: str            # chua_yeu_cau | cho_kho | kho_dang_soan | cap_thieu | san_sang
    mon: list[MonVatTuOut] = []


class WorkItemOut(BaseModel):
    id: int
    department_id: int | None = None  # tổ thật của việc (bàn nút cha gộp nhiều tổ con)
    goi_id: int
    phien_ban_so: int
    nguon_loai: str          # "lsx" | "bai_ghep" | ""
    nguon_ma: str
    nguon_ten: str
    khach_hang: str | None = None  # khách của lệnh; bài ghép = khách các lệnh thành viên nối " · "
    don_vi_tinh: str | None = None  # ĐVT thành phẩm của lệnh — tên chặng "cai" ("cuốn")
    nhom_id: int | None = None   # id nhóm thành phẩm (khoá cho panel Kho §14 + checklist đóng §16)
    nhom: str                # nhãn nhóm thành phẩm
    ten_cong_doan: str
    nhom_cong_doan: str | None = None
    loai_buoc: str
    la_kcs_cuoi: bool
    # Dấu KCS trên thẻ việc (KCS theo lệnh, mg 0306): số lần kiểm + Σ đạt/lỗi. Chỗ gọi không nạp
    # thì để 0 — không có nghĩa là "đã kiểm, không lỗi".
    kcs_so_lan: int = 0
    kcs_dat: float = 0.0
    kcs_loi: float = 0.0
    may: str
    may_id: int | None = None    # máy HIỆN TẠI — FE cần để dựng ô chọn "Đổi máy" (§7.2 mở rộng)
    du_kien_bat_dau: datetime | None = None
    du_kien_ket_thuc: datetime | None = None
    # Lúc việc TỚI TAY tổ = lúc phát hành tạo thẻ việc (giờ xưởng) — mốc để lọc/tra về sau.
    nhan_luc: datetime | None = None
    so_luong_vao: float | None = None
    so_luong_ra: float | None = None
    don_vi_vao: str | None = None
    don_vi_ra: str | None = None
    # Bước NGOÀI dòng giấy (ghi kẽm đếm bản, đóng thùng đếm thùng): vào = ra nên cột "SL vào → ra"
    # hiện MỘT số kèm đơn vị bản địa. Cờ là ẢNH CHỤP lúc phát hành — FE không suy lại được từ mã
    # đơn vị. `sl_dien_giai` GỠ 18/09/2026 (mg `0324`).
    ngoai_dong: bool = False
    trang_thai: str
    # Dải thời lượng CHẠY của thẻ (phút, đã chia theo phần sản lượng của phân đoạn). Ba số bằng
    # nhau ⇒ máy chưa khai tốc độ min/max, UI bỏ phần trong ngoặc chứ đừng vẽ râu 0. None = lệnh
    # phát hành trước 10/09/2026 (ảnh chụp chưa có khoá) — "Phát hành cập nhật" là cách lấy về.
    chay_phut: float | None = None
    chay_phut_min: float | None = None
    chay_phut_max: float | None = None
    # DẶN DÒ của người lập kế hoạch + THẺ QUY CÁCH rút gọn: tổ trưởng không có quyền `lsx` nên
    # không mở nổi hồ sơ lệnh — hai thứ này đi theo thẻ việc, không phải cửa tra ngược.
    ghi_chu: str | None = None
    quy_cach: dict | None = None
    # Định mức vật tư đóng băng lúc phát hành (view "Danh sách") — đọc thẳng `vat_tu_json`.
    dinh_muc_vat_tu: list[VatTuDinhMucOut] = []
    # Lớp thực-tế đè lên thanh kế hoạch (§5.1): các phiên chạy đã ghi, phiên mở để ket_thuc=None.
    thuc_te: list[ThucTeKhoangOut] = []
    # Lớp SỐ THỰC TẾ — DẪN XUẤT, không lưu (§2.3). `so_luong_vao`/`so_luong_ra` ở trên là KẾ HOẠCH
    # và không bị đè; `muc_tieu` là mốc đã rút theo lượng thực nhận (tổ trước giao thiếu thì tổ sau
    # không bị chấm theo kế hoạch). Chỗ gọi không nạp map thì cứ None, không bịa số.
    thuc_nhan: float | None = None
    da_lam: float | None = None
    muc_tieu: float | None = None
    con_thieu: float | None = None
    # Luật ô tiến độ (27/09/2026): Nhận bao nhiêu, tốt bao nhiêu, còn lại là LỖI. `nhan` theo đơn
    # vị VÀO (bước đầu chuỗi = số vào kế hoạch lấy từ kho; cùng tổ = số tốt bước trước), `nhan_ra`
    # quy về đơn vị RA để so với tốt; `loi` chỉ có khi đã Kết thúc = nhan_ra − tốt.
    nhan: float | None = None
    nhan_ra: float | None = None
    loi: float | None = None
    # Nhà gia công + khuôn: ảnh chụp lúc phát hành. `khuon = None` ⇒ bước không dùng dụng cụ, thẻ
    # việc không vẽ gì; có `khuon` mà `khuon_da_nhan = false` ⇒ nút Bắt đầu bị chặn (§ cổng khuôn).
    nha_cung_cap: str | None = None
    khuon: KhuonChipOut | None = None
    khuon_da_nhan: bool = False
    khuon_da_tra: bool = False
    # Người xem giữ Thực hiện lệnh trên việc này (máy chủ tính theo dòng quyền tổ) — nút chạy nhanh
    # trên dòng bảng hiện theo cờ này.
    chay_duoc: bool = False
    # Họ tên người đang được giao (phân công còn hiệu lực) — dòng phụ cột Trạng thái của lưới bàn
    # tổ. Rỗng = chưa giao thợ. Drawer không điền (đã có roster riêng).
    nguoi_lam: list[str] = []
    step_key: str | None = None
    # Mức vật tư của bước — None = bước không cần vật tư (ô trống). Drawer không điền.
    trang_thai_vat_tu: TrangThaiVatTuOut | None = None


class TrangOut(BaseModel):
    """Vị trí trang + tổng số LỆNH (không phải tổng số bước) — đơn vị trang của bàn tổ là LỆNH."""
    trang: int
    co_trang: int
    tong: int


class RoutingBuocOut(BaseModel):
    """Một BƯỚC trên dải routing của thẻ lệnh (`docs/design-dai-routing-tren-ban-to.md`).

    Bước của tổ KHÁC chỉ mang bấy nhiêu: tên · tổ · trạng thái · số · đã giao sang tôi.
    `cong_viec_id` để None có chủ đích — FE không được có đường mở drawer việc của tổ khác."""
    thu_tu: int
    step_key: str | None = None
    ten_cong_doan: str
    to_id: int | None = None
    to_ten: str | None = None
    la_cua_toi: bool
    la_kcs_cuoi: bool
    # Bước thuê ngoài — chấm trên dải tuyến nhỏ của lưới viền cam (09/10/2026).
    thue_ngoai: bool = False
    trang_thai: str
    phan_doan_tong: int = 1
    chay_chung: bool = False          # bước chạy chung của bài ghép
    ke_hoach: float | None = None
    thuc_te: float = 0.0
    don_vi: str | None = None
    # Bước NGUỒN: đã giao sang tổ đang xem bao nhiêu (chỉ bàn giao đã chốt).
    da_giao_sang_toi: float | None = None
    # Bước CỦA TỔ ĐANG XEM: đã nhận bao nhiêu, theo đúng đơn vị đầu vào của bước.
    da_nhan: float | None = None
    cong_viec_id: int | None = None


class DaiDuoiOut(BaseModel):
    """Ô ĐUÔI của dải ở ngăn chi tiết (11/10/2026) — làm xong bước cuối của lệnh thì hàng đi đâu.

    `loai`: `cho_mang_di` · `o_ngoai` (bước cuối thuê ngoài, lần chưa chốt) · `ve_buoc` (sang bước
    của lệnh khác — lệnh đi kèm nhập vào lệnh chính) · `ve_kho` · `giao_khach`.
    `noi`: nhà gia công (`cho_mang_di`/`o_ngoai`) hoặc tên bước nhận (`ve_buoc`).
    `so` + `don_vi`: số của trạng thái đó — chờ mang đi / đã mang đi / đã giao sang / về kho /
    khách nhận / đã gửi kho. `cho_nhan` (chỉ `ve_buoc`): phần đã giao mà bên nhận chưa xác nhận."""
    loai: str
    noi: str | None = None
    lsx_ma: str | None = None
    so: float | None = None
    cho_nhan: float | None = None
    don_vi: str | None = None
    luc: datetime | None = None


class LenhNhomOut(BaseModel):
    """Một LỆNH SX (hoặc BÀI GHÉP) trên bàn tổ, kèm các công đoạn CỦA TỔ trong lệnh ấy.

    Đơn vị VIỆC vẫn là CÔNG ĐOẠN: `cong_viec` là các bước tổ thực sự bấm Bắt đầu / Ghi sản lượng,
    giữ nguyên `WorkItemOut`. Lệnh chỉ là ĐẦU MỤC bọc ngoài, để tổ trưởng biết công đoạn đó của
    lệnh nào. Bài ghép là MỘT dòng, không xẻ theo lệnh thành viên: nó chạy một lần trên một tờ."""
    nguon_loai: str               # "lsx" | "bai_ghep"
    nguon_ma: str
    nguon_ten: str
    khach_hang: str | None = None
    lsx_id: int | None = None
    bai_ghep_id: int | None = None
    is_rush: bool = False              # lệnh / bài ghép gắn cờ GẤP — bàn gắn thẻ cạnh mã (10/10/2026)
    som_nhat: datetime | None = None   # giờ dự kiến bước SỚM NHẤT của tổ trong lệnh
    muon_nhat: datetime | None = None
    nhan_luc: datetime | None = None   # lúc tổ nhận việc SỚM NHẤT của lệnh (giờ xưởng)
    tao_luc: datetime | None = None    # ngày tạo LỆNH / BÀI GHÉP (giờ xưởng) — cột "Ngày tạo"
    so_viec: int
    digest: dict[str, int]             # released / running / paused / completed
    # Chuỗi công đoạn ĐẦY ĐỦ của lệnh (mọi tổ, chỉ đọc). Rỗng khi lệnh chỉ có một bước.
    routing: list[RoutingBuocOut] = []
    cong_viec: list[WorkItemOut]


class WorkItemsOut(BaseModel):
    team_id: int
    nhom: str = "lenh"                 # "lenh" (mặc định) | "phang" (Gantt)
    trang: TrangOut | None = None      # chỉ có ở nhom="lenh"
    lenh: list[LenhNhomOut] = []
    cong_viec: list[WorkItemOut] = []  # chỉ có ở nhom="phang" — hình CŨ, Gantt không phải sửa
    # Chỉ có ở nhom="phang": trục ngày Lịch bàn tổ đọc Lịch làm việc như bàn Xếp lịch (10/10/2026).
    ngay_nghi: list[date] = []
    ngay_dac_biet: list[NgayDacBietOut] = []
    cac_ca: list[CaXuongOut] = []


class NguoiLocDemOut(BaseModel):
    id: int
    ten: str | None = None
    so: int = 0


class WorkItemsLocDemOut(BaseModel):
    """Số đếm cho menu Lọc của bàn tổ — đếm theo công việc (09/10/2026)."""
    trang_thai: dict[str, int]
    cho: dict[str, int]
    toi: dict[str, int]
    vuong: dict[str, int]
    gap: dict[str, int] = {}   # `gap` lệnh gấp / `thuong` lệnh thường (10/10/2026)
    nguoi: list[NguoiLocDemOut]
    may: list[NguoiLocDemOut] = []     # 22/10/2026 — thay `tre` (trễ giờ dự kiến) đã gỡ
    khach: list[NguoiLocDemOut] = []


class LichSuDongOut(BaseModel):
    """Một dòng tab Lịch sử của ngăn công việc (09/10/2026). `luc` cùng thang giờ xưởng các mốc
    khác của ngăn; `ct` = mẩu phụ (FE vẽ thẻ nhỏ); `mau`: "g" làm ra, "b" gửi đi/đề nghị, "r" lỗi
    hay sự cố, "" xám."""
    luc: datetime | None = None
    nhom: str
    cau: str
    ct: list[str] = []
    ly_do: str | None = None
    mau: str = ""
    #: Người thao tác — tách khỏi `ct`, FE in dòng phụ "người · giờ".
    nguoi: str | None = None


class LichSuViecOut(BaseModel):
    items: list[LichSuDongOut]
    dem: dict[str, int]


class ViecDangChayOut(BaseModel):
    """Việc một người ĐANG CHẠY (khoảng tham gia còn mở) — mã lệnh/bài ghép + công đoạn + tổ."""
    cong_viec_id: int
    ma: str | None = None
    ten_cong_doan: str
    to_ten: str | None = None


class ViecChoOut(ViecDangChayOut):
    """Việc một người CÓ TÊN trong tổ nhưng chưa chạy (`released`) hoặc đang tạm dừng (`paused`)."""
    trang_thai: str


class KhoangNghiPhepOut(BaseModel):
    """Một đơn nghỉ phép ĐÃ DUYỆT (nguyên ngày, gồm cả hai đầu)."""
    tu: date
    den: date


class TinhTrangNguoiOut(BaseModel):
    """Tình trạng người ở ô chọn giao việc / thêm người tổ khác (`services/san_xuat/tinh_trang_nguoi`).
    `ly_do_nghi`: "Nghỉ dài hạn" / "Đang đình chỉ" (hồ sơ) — chặn. `nghi_phep`: khoảng ngày để FE
    so với ngày đang chọn — trùng thì chặn. `dang_chay`: cảnh báo. `viec_cho`: thông tin."""
    ly_do_nghi: str | None = None
    nghi_phep: list[KhoangNghiPhepOut] = []
    dang_chay: ViecDangChayOut | None = None
    viec_cho: list[ViecChoOut] = []


class NhanVienChonOut(TinhTrangNguoiOut):
    """Một người chọn được cho ô "Giao người" (§7.1). `la_luong_khoan` chỉ ghi nhận — FE không dùng tới (09/10/2026 gỡ thẻ "công nhật")."""
    id: int
    code: str | None = None
    full_name: str
    la_luong_khoan: bool
    co_tai_khoan: bool


class NhanVienChonListOut(BaseModel):
    team_id: int
    # Ngày XƯỞNG máy chủ dùng để xét nghỉ phép — FE so `nghi_phep` với ngày này, không lấy giờ máy.
    hom_nay: date
    nhan_vien: list[NhanVienChonOut]


class HoTroUngVienOut(TinhTrangNguoiOut):
    """Một thợ tổ KHÁC tổ thêm được vào lần ghi sản lượng — kèm nhãn tổ gốc."""
    id: int
    code: str | None = None
    full_name: str
    to_id: int | None = None
    to_ten: str | None = None


class HoTroUngVienListOut(BaseModel):
    team_id: int
    hom_nay: date
    nhan_vien: list[HoTroUngVienOut]


class ChoXacNhanBanGiaoOut(BaseModel):
    """Một bàn giao đến đang chờ tổ nhận xác nhận (§11.2)."""
    id: int
    nguon_cong_viec_id: int
    nguon_ten: str
    nguon_to_ten: str | None = None
    dich_cong_viec_id: int
    dich_ten: str
    dich_to_ten: str | None = None
    lsx_ma: str | None = None
    so_luong: float
    don_vi: str
    de_xuat_luc: datetime | None = None
    version: int
    # `True` = công đoạn nằm trên bàn đang xem (tổ thấy trọn) — chấm đỏ trên dòng, xác nhận trong
    # ngăn chi tiết; `False` = bàn không vẽ công đoạn đó, liệt kê riêng khi bật ô "chờ xác nhận".
    tren_ban: bool = False


class ChoXacNhanKcsLoiOut(BaseModel):
    """Một lỗi KCS báo về tổ mà tổ chưa bấm "Đã xem" (KCS theo lệnh, mg 0306)."""
    loi_id: int
    kcs_batch_id: int
    cong_viec_id: int | None = None
    to_id: int | None = None
    ten_cong_doan: str = ""
    # Bước KCS bắt lỗi khi lỗi quy về công đoạn trước; None = bắt ngay tại công đoạn này.
    phat_hien_o: str | None = None
    lsx_ma: str | None = None
    mo_ta: str | None = None
    so_luong: float
    don_vi: str | None = None
    nguoi_kiem: str | None = None
    luc: datetime | None = None
    so_anh: int = 0
    version: int
    # `True` = công đoạn nằm trên bàn đang xem (tổ thấy trọn) — chấm đỏ trên dòng, xác nhận trong
    # ngăn chi tiết; `False` = bàn không vẽ công đoạn đó, liệt kê riêng khi bật ô "chờ xác nhận".
    tren_ban: bool = False


class ChoXacNhanOut(BaseModel):
    team_id: int
    ban_giao: list[ChoXacNhanBanGiaoOut]
    kcs_loi: list[ChoXacNhanKcsLoiOut] = []


# --- Mặt GHI: phân công / phiên chạy (Giai đoạn 2, §7) ---------------------------------------
class PhanCongIn(BaseModel):
    employee_id: int
    expected_version: int | None = None


class GoPhanCongIn(BaseModel):
    ly_do: str | None = None
    expected_version: int | None = None


class BatDauIn(BaseModel):
    # Sớm/trễ so với dự kiến không hỏi lý do nữa (gỡ 16/09/2026), số người lệch kíp cũng không
    # (gỡ 18/09/2026, mg `0321`) — client cũ còn gửi `ly_do_tre`/`ly_do_so_nguoi` thì pydantic bỏ qua
    # im lặng.
    expected_version: int | None = None


class DoiMayIn(BaseModel):
    """Đổi máy giữa chừng (§7.2 mở rộng 31/08/2026) — xem `services/san_xuat/thuc_thi.doi_may`."""
    may_id: int
    ly_do: str | None = None
    expected_version: int | None = None


class TamDungIn(BaseModel):
    ly_do: str                          # bắt buộc (§7.2)
    expected_version: int | None = None


class KetThucIn(BaseModel):
    expected_version: int | None = None


class SuCoIn(BaseModel):
    """Báo sự cố tại tổ (31/08/2026) — xem `services/san_xuat/su_co.bao_su_co`.

    KHÔNG có ô "máy": server lấy đúng máy của công việc đang chạy. `cong_viec_id`/`lsx_id` cũng
    do server chốt — client khai được là mở cửa hậu treo yêu cầu hỏng máy lên lệnh của tổ khác.
    Không có ô bộ phận hỏng, `mo_ta` (triệu chứng) không bắt buộc (11/10/2026).
    """
    mo_ta: str | None = None
    # nhe | trung_binh | nghiem_trong (models.ky_thuat_may.MUC_DO). `min_length=1` vì `str` bắt
    # buộc vẫn nhận `""`, mà rỗng lọt xuống thì bị đặt ngầm thành `trung_binh` — mức không ai chọn
    # nhưng lại chen trên các yêu cầu Nhẹ thật trong hàng chờ (review vòng 1, Minor 4).
    muc_do: str = Field(min_length=1)
    dung_san_xuat: bool = False
    expected_version: int | None = None


class LenhKetQuaOut(BaseModel):
    """Kết quả một lệnh ghi — đủ để FE cập nhật thanh + version lạc quan."""
    cong_viec_id: int
    department_id: int | None = None
    trang_thai: str
    version: int


class SuCoKetQuaOut(LenhKetQuaOut):
    """Như `LenhKetQuaOut` + con trỏ sang yêu cầu sửa chữa vừa gửi — để màn hình nói được
    "đã gửi YC-0042 tới tổ sửa chữa" thay vì một câu chung chung."""
    yeu_cau_id: int
    yeu_cau_ma: str


# --- Drawer chi tiết: roster + phiên + khoảng tham gia --------------------------------------
class PhanCongItemOut(BaseModel):
    id: int
    employee_id: int
    ho_ten: str
    la_luong_khoan: bool
    co_tai_khoan: bool
    avatar_url: str | None = None   # ảnh tài khoản; null = chưa có tài khoản/chưa đặt ảnh → FE vẽ chữ cái
    trang_thai: str


class PhienChayOut(BaseModel):
    id: int
    so_thu_tu: int
    may_id: int | None = None    # máy CHẠY TRONG PHIÊN NÀY — đổi máy đẻ phiên khác (mg 0247)
    may_ten: str | None = None
    bat_dau: datetime
    ket_thuc: datetime | None = None
    loai_dong: str | None = None
    ly_do_bat_dau_tre: str | None = None  # chỉ còn ở phiên cũ — luật lý do trễ đã gỡ 16/09/2026
    ly_do: str | None = None


class KhoangThamGiaOut(BaseModel):
    id: int
    phien_chay_id: int
    employee_id: int
    ho_ten: str
    avatar_url: str | None = None
    bat_dau: datetime
    ket_thuc: datetime | None = None


# --- Sản lượng · bàn giao · vật tư trên drawer (Giai đoạn 3) --------------------------------
class LotVaoOut(BaseModel):
    id: int
    nguon_batch_id: int | None = None   # mẻ công đoạn trước (SET NULL nếu mẻ bị gỡ)
    so_luong: float
    don_vi: str


class NguoiThamGiaBatchOut(BaseModel):
    """Một người có mặt trong mẻ (drawer). `to_ten` chỉ có khi người đó KHÔNG thuộc tổ chủ mẻ —
    người tổ khác sang giúp, tổ thêm thẳng lúc ghi."""

    employee_id: int
    ho_ten: str
    to_ten: str | None = None
    # Người ngoài danh sách được giao, tổ thêm lúc ghi (người tổ khác sang giúp).
    la_ho_tro: bool = False


class ViecNganOut(BaseModel):
    """Mã lệnh + tên công đoạn — ghi chú cạnh tên người trong hộp Ghi sản lượng."""

    cong_viec_id: int
    ma: str | None = None
    ten_cong_doan: str = ""


class NguoiGhiOut(BaseModel):
    """Một người tổ mình trong hộp Ghi sản lượng (10/10/2026, `nguoi_ghi.ung_vien_ghi`)."""

    employee_id: int
    ho_ten: str
    nghi: str | None = None                       # có ⇒ mờ, không tick
    dang_o: list[ViecNganOut] = []                # việc khác đã bắt đầu, chưa kết thúc
    tick_san: bool = True


class SlToTotHongOut(BaseModel):
    """Tốt · hỏng của một ĐƠN VỊ — không bao giờ cộng lẫn hai đơn vị."""

    don_vi: str | None = None
    tot: float = 0
    hong: float = 0


class SlToMeNguoiOut(BaseModel):
    """Một người có mặt trong mẻ. `to_ten` CHỈ có khi người đó không thuộc tổ chủ mẻ — nhãn
    "(tổ bế)" để tổ trưởng biết ngay ai là người mình, ai sang giúp (§7.3b luật 2)."""

    employee_id: int
    ho_ten: str
    to_ten: str | None = None


class SlToMePhatSinhOut(BaseModel):
    """Việc phát sinh của mẻ trong tab Sản lượng — ảnh chụp lúc ghi, KHÔNG cộng vào sản lượng."""

    ten: str | None = None
    so_luong: float
    don_vi: str | None = None
    don_vi_ten: str | None = None


class SlToMeOut(BaseModel):
    """Một MẺ. Không số phút của ai, không ô chia — sản xuất chỉ ghi nhận (§7.3b luật 3)."""

    batch_id: int
    ngay: date | None = None
    bat_dau: datetime | None = None
    ket_thuc: datetime | None = None
    viec_khoan_ten: str | None = None
    tot: float = 0
    hong: float = 0
    don_vi: str | None = None
    nguoi: list[SlToMeNguoiOut] = []
    phat_sinh: list[SlToMePhatSinhOut] = []


class SlToCongDoanOut(BaseModel):
    cong_viec_id: int
    ten_cong_doan: str
    to_id: int | None = None
    to_ten: str = ""
    #: True = mẻ của TỔ KHÁC (chủ mẻ ngoài phạm vi đang xem) mà có người của tổ mình trong đó —
    #: FE xếp vào mục "người của tổ đi làm ở tổ khác" và KHÔNG cộng vào dòng tổng (§7.3b).
    la_khach: bool = False
    so_me: int = 0
    san_luong: list[SlToTotHongOut] = []
    me: list[SlToMeOut] = []


class SlToKhoOut(BaseModel):
    dai: float
    rong: float


class SlToQuyCachOut(BaseModel):
    """Giấy + ba khổ (mm) của nguồn — cùng thẻ quy cách ở bàn tổ, tách số để bảng chia cột."""

    giay: str | None = None
    dinh_luong: float | None = None
    to_nguyen: SlToKhoOut | None = None
    to_in: SlToKhoOut | None = None
    con: SlToKhoOut | None = None


class SlToLenhOut(BaseModel):
    nguon_loai: str
    nguon_id: int | None = None
    ma: str = ""
    ten: str = ""
    so_me: int = 0
    ngay_dau: date | None = None
    ngay_cuoi: date | None = None
    quy_cach: SlToQuyCachOut | None = None
    san_luong: list[SlToTotHongOut] = []
    cong_doan: list[SlToCongDoanOut] = []


class SlToTongOut(SlToTotHongOut):
    so_me: int = 0


class SlToDonViOut(BaseModel):
    id: int
    ten: str
    cap: int = 0


class SlToNguoiChonOut(BaseModel):
    id: int
    ten: str


class SlToLuaChonOut(BaseModel):
    """Giá trị chọn được của nút "Lọc" tab Sản lượng (10/10/2026)."""

    cong_doan: list[str] = []
    nguoi: list[SlToNguoiChonOut] = []


class SanLuongToOut(BaseModel):
    """Tab SẢN LƯỢNG của bàn tổ (spec 2026-09-14 §6, sửa 18/09/2026 §7.3b). Ngày = ngày BẮT ĐẦU
    mẻ, giờ xưởng; `tong` tính trên CẢ bộ lọc (không chỉ trang) và CHỈ gồm MẺ CỦA TỔ. KHÔNG có
    ô tiền, không ô chia."""

    team_id: int
    tu: date
    den: date
    to_id: int | None = None
    trang: int
    co_trang: int
    tong_lenh: int
    co_pham_vi_tron: bool = False
    co_pham_vi_rieng: bool = False
    cac_to: list[SlToDonViOut] = []
    lua_chon: SlToLuaChonOut = SlToLuaChonOut()
    tong: list[SlToTongOut] = []
    lenh: list[SlToLenhOut] = []
    cap_nhat_luc: datetime | None = None


class MeSuCoOut(BaseModel):
    """Một lần DỪNG MÁY rơi vào cửa sổ mẻ — suy từ phiên `loai_dong='tam_dung'`, không bảng mới.
    Dừng TỪ lúc phiên đó đóng TỚI lúc phiên kế mở (`board._lan_dung_may`); `ket_thuc` trống = chưa
    chạy lại."""

    bat_dau: datetime | None = None
    ket_thuc: datetime | None = None
    ly_do: str | None = None


# ⚠️ `ChiaDongOut` + `ChiaDuKienOut` GỠ 18/09/2026 cùng tầng chia sản lượng (mg `0322`): mẻ không
#    còn bản chia nào, nháp hay chốt. Mẻ nay chỉ mang danh sách NGƯỜI THAM GIA.


class MeDanhMucDoiOut(BaseModel):
    """Một dòng của băng "Danh mục đã đổi so với lúc ghi mẻ" (§7.2b). `mat=True` = dòng đã bị xoá
    khỏi danh mục: mẻ GIỮ ảnh chụp, hệ không tự gỡ."""

    truong: str
    nhan: str
    cu: str | None = None
    moi: str | None = None
    mat: bool = False


class MePhatSinhOut(BaseModel):
    """Việc phát sinh đã ghi của một mẻ — ảnh chụp lúc ghi, KHÔNG cộng vào sản lượng."""

    id: int
    phat_sinh_id: int
    so_luong: float
    ten: str | None = None
    don_vi: str | None = None
    don_vi_ten: str | None = None
    don_gia: float | None = None


class TuyChonLanGhiOut(BaseModel):
    ma: str
    ten: str
    kieu: str
    gia_tri: float


class TuyChonKhaiOut(BaseModel):
    """Một "tuỳ chọn khi ghi" công đoạn khai — hộp Ghi sản lượng bày ô Có / không hoặc ô Số."""

    ma: str
    ten: str
    kieu: str = "co_khong"
    goi_y: str | None = None


class BatchOut(BaseModel):
    id: int
    bat_dau: datetime
    ket_thuc: datetime
    tong: float
    tot: float
    hong: float
    don_vi: str
    mo_ta_loi: str | None = None
    ghi_chu: str | None = None
    version: int
    # Đọc trọn mẻ (§5.2): máy ĐÃ CHẠY mẻ này (lấy từ PHIÊN, không phải `cv.may_id`), ca, và
    # các lần dừng máy rơi vào cửa sổ mẻ.
    may_ten: str | None = None
    ca_ten: str | None = None
    so_nguoi: int = 0
    su_co: list[MeSuCoOut] = []
    nguoi_tham_gia: list[NguoiThamGiaBatchOut]
    lot_vao: list[LotVaoOut]
    # Mẻ đã đi theo một lần bàn giao chưa (`san_xuat_ban_giao_batch`) — form bàn giao chỉ liệt kê
    # mẻ chưa giao.
    da_ban_giao: bool = False
    # VIỆC KHOÁN của mẻ + ảnh chụp lúc ghi (mg `0318`). `viec_khoan_id = None` = mẻ ghi TRƯỚC
    # 18/09/2026 — bày "chưa khai việc khoán", KHÔNG đoán hộ.
    viec_khoan_id: int | None = None
    viec_khoan_ten: str | None = None
    viec_khoan_don_vi: str | None = None
    viec_khoan_don_vi_ten: str | None = None
    viec_khoan_don_gia: float | None = None
    # Ảnh chụp tuỳ chọn khi ghi (Đợt 2): `[{ma, ten, kieu, gia_tri}]`; None = công đoạn không khai
    # hoặc lần ghi trước Đợt 2.
    tuy_chon_khoan: list[TuyChonLanGhiOut] | None = None
    # Tên bậc giá chụp lúc ghi (Bài in) — None = công đoạn không chia bậc hoặc lệnh không khớp bậc.
    bac_khoan_ten: str | None = None
    phat_sinh: list[MePhatSinhOut] = []
    # Băng "Danh mục đã đổi so với lúc ghi mẻ" (§7.2b) — rỗng = ảnh chụp còn khớp danh mục.
    danh_muc_doi: list[MeDanhMucDoiOut] = []


class SanLuongOut(BaseModel):
    tong_tot: float
    da_giao: float
    # Mục tiêu của BƯỚC (`san_xuat_cong_viec.so_luong_ra`) và phần chưa đạt — DẪN XUẤT, không lưu.
    # Không khai ở đây là Pydantic nuốt IM LẶNG: service trả dict, FE nhận undefined, không ai lỗi.
    muc_tieu: float | None = None
    thuc_nhan: float | None = None
    con_thieu: float | None = None
    nhan: float | None = None
    nhan_ra: float | None = None
    loi: float | None = None
    don_vi: str | None = None
    batches: list[BatchOut]


class BanGiaoOut(BaseModel):
    """Một dòng bàn giao trên drawer — `doi_tac_*` là công đoạn ở đầu kia (đích khi giao đi, nguồn
    khi nhận về)."""
    id: int
    doi_tac_cong_viec_id: int | None = None
    doi_tac_ten: str
    doi_tac_to_ten: str | None = None      # tổ ở đầu kia; None = thuê ngoài / chưa gán tổ
    # Hai đầu của lần giao — thẻ ghi đủ công đoạn · tổ cho cả bên giao lẫn bên nhận. `*_to` của bước
    # thuê ngoài là nhà gia công; `dich_cong_doan` = "Kho" khi giao thẳng vào kho.
    nguon_cong_doan: str | None = None
    nguon_to: str | None = None
    dich_cong_doan: str | None = None
    dich_to: str | None = None
    cung_to: bool
    so_luong: float
    don_vi: str
    trang_thai: str                     # proposed | confirmed
    version: int
    batch_ids: list[int] = []           # các mẻ của công đoạn nguồn đi theo lần giao này
    # Ai đề xuất / ai xác nhận, lúc nào — hai bên thấy như nhau. Tên từ tài khoản đã thao tác;
    # None khi tài khoản không còn. Chưa xác nhận ⇒ `nguoi_xac_nhan`/`xac_nhan_luc` None.
    nguoi_de_xuat: str | None = None
    de_xuat_luc: datetime | None = None
    nguoi_xac_nhan: str | None = None
    xac_nhan_luc: datetime | None = None


class BanGiaoChangSauOut(BaseModel):
    """CHẶNG SAU theo routing lệnh — đích bàn giao hợp lệ duy nhất (§11.2). Nhiều dòng khi bước
    sau tách lần chạy hoặc routing rẽ nhánh; rỗng = bước cuối lệnh (không bàn giao — thành phẩm qua KCS)."""
    cong_viec_id: int
    ten_cong_doan: str
    to_id: int | None = None
    to_ten: str | None = None
    du_kien_bat_dau: datetime | None = None
    phan_doan_so: int = 1
    phan_doan_tong: int = 1
    loai_buoc: str
    nha_cung_cap: str | None = None
    trang_thai: str


class CongDoanTruocOut(BaseModel):
    """Một công đoạn TRƯỚC theo routing (từng lần chạy) — khối "Công đoạn trước" của tab Nhận
    (19/09/2026). Kế hoạch / thực tế theo đơn vị RA của nó; đã giao theo đơn vị bàn giao."""
    cong_viec_id: int
    ten_cong_doan: str
    phan_doan_so: int = 1
    phan_doan_tong: int = 1
    to_ten: str | None = None
    # Bước trước cùng tổ + cùng lệnh: không cổng, không cần bàn giao (`dau_vao.cung_to_cung_lsx`).
    cung_to: bool = False
    trang_thai: str
    ke_hoach: float | None = None
    don_vi: str | None = None
    thuc_te: float = 0
    da_giao: float = 0
    da_xac_nhan: float = 0
    cho_xac_nhan: float = 0
    don_vi_giao: str | None = None


class TranGhiOut(BaseModel):
    """Trần Σ số làm được của công đoạn = số đã nhận × hệ số quy đổi − lỗi KCS bắt tại công đoạn
    (`dau_vao.tran_ghi`). `toi_da` là trần đã trừ lỗi; `toi_da_nhan` là trần theo số nhận."""
    toi_da: float
    toi_da_nhan: float
    loi_kcs: float = 0
    da_nhan: float
    he_so: float
    don_vi_nhan: str | None = None
    # None ở bước đầu chuỗi (`dau_chuoi`): số nhận lấy theo kế hoạch, không có công đoạn nguồn.
    nguon_ten: str | None = None
    # Nguồn cùng tổ ⇒ `da_nhan` là SẢN LƯỢNG bước trước, không phải số bàn giao — đổi cả câu chữ.
    cung_to: bool = False
    dau_chuoi: bool = False
    da_ghi: float
    con_ghi_duoc: float


class PhieuXuatVatTuOut(BaseModel):
    """Phiếu xuất kho đã ghi sổ cho công việc — có phiếu là tổ đã có hàng (11/10/2026: bỏ bước tổ
    bấm "xác nhận nhận")."""
    voucher_id: int
    ma: str
    # Yêu cầu sinh ra phiếu — ngăn đặt phiếu cạnh đúng đề nghị của nó.
    request_id: int | None = None
    xuat_luc: datetime | None = None
    nguoi_xuat: str | None = None


# ⚠️ `PhanBoDongOut` · `BuTruDongOut` · `LoaiTruDongOut` · `PhanBoChiTietOut` GỠ 18/09/2026 cùng
#    bốn bảng phân bổ (mg `0322`).


class VatTuCapDoiChieuOut(BaseModel):
    """Một mặt hàng trong bản đối chiếu (spec-de-nghi-cap-vat-tu-cong-doan §6): kế hoạch / đã yêu
    cầu / kho thực xuất, cộng dồn qua MỌI lần đề nghị.

    `dvt`/`sl_ke_hoach`/`sl_yeu_cau` là thang NGƯỜI KHAI, để bản in đúng chữ; `dvt_goc`/
    `sl_ke_hoach_goc`/`sl_yeu_cau_goc` là thang GỐC MÁY so lệch (`lech_ke_hoach`/`lech_thuc_te`
    tính trên hai cột `_goc` — vòng sửa 1, Important 2+3, theo đúng docstring
    `models/san_xuat_vat_tu.py:85-87`)."""
    hang_loai: str
    hang_id: int
    ten: str
    #: Giấy: đơn vị gốc của khoá dòng (`to` / đơn vị giá…) — cùng giá trị `dvt_goc`; hàng khác "".
    don_vi_goc: str = ""
    kho_rong: int = 0
    kho_dai: int = 0
    dvt: str
    dvt_goc: str
    sl_ke_hoach: float
    sl_ke_hoach_goc: float
    sl_yeu_cau: float
    sl_yeu_cau_goc: float
    sl_thuc_xuat: float
    # Phần tổ đã nhập lại kho (phiếu NHẬP ghi sổ) và THỰC DÙNG = thực xuất − nhập lại (thang gốc).
    sl_nhap_lai: float = 0.0
    # None ⇒ dòng THÔNG TIN của phần trả khác khổ đã xuất: phần trừ nằm ở dòng đích (`nhap_lai_vao`).
    sl_thuc_dung: float | None = 0.0
    nhap_lai_vao: str | None = None
    lech_ke_hoach: float
    lech_thuc_te: float
    # Giấy bước này nhận từ bước trước (spec 2026-10-01 §5): tên bước trước; None = tự lấy từ kho.
    nhan_tu: str | None = None


class VatTuCapDongOut(BaseModel):
    """Một dòng CỦA RIÊNG một lần đề nghị (ruling task-7 47) — KHÁC `VatTuCapDoiChieuOut.sl_yeu_cau`
    (cộng dồn qua mọi lần): form "Sửa đề nghị" thay THẾ toàn bộ dòng của đúng lần đang sửa, nên
    phải điền đúng số của lần đó, không phải tổng. Mang cả cột `_goc` (vòng sửa 1) để form điền
    sẵn không bao giờ phải đoán thang."""
    hang_loai: str
    hang_id: int
    ten: str
    #: Giấy: đơn vị gốc của khoá dòng (`to` / đơn vị giá…) — cùng giá trị `dvt_goc`; hàng khác "".
    don_vi_goc: str = ""
    kho_rong: int = 0
    kho_dai: int = 0
    dvt: str
    dvt_goc: str
    sl_ke_hoach: float
    sl_ke_hoach_goc: float
    sl_yeu_cau: float
    sl_yeu_cau_goc: float
    ly_do_chenh_lech: str | None = None


class VatTuCapLanOut(BaseModel):
    """Một LẦN tổ đề nghị (lịch sử) trên drawer."""
    id: int
    lan_so: int
    loai: str
    tu_lap: bool = False        # lần hệ thống tự lập lúc phát hành lệnh (spec 2026-10-18)
    can_luc: datetime
    stock_request_id: int | None = None
    stock_request_ma: str | None = None
    stock_request_trang_thai: str | None = None
    created_by_id: int | None = None
    updated_by_id: int | None = None
    # Tên TÀI KHOẢN gửi / sửa — `*_by_id` là users.id, không tra được bằng danh sách thợ của việc.
    created_by_ten: str | None = None
    updated_by_ten: str | None = None
    created_at: datetime
    updated_at: datetime
    dongs: list[VatTuCapDongOut] = []


class VatTuNhapLaiDongOut(BaseModel):
    hang_loai: str
    hang_id: int
    ten: str
    don_vi_goc: str = ""
    kho_rong: int = 0
    kho_dai: int = 0
    dvt: str
    sl: float


class PhieuNhapLaiOut(BaseModel):
    voucher_id: int
    ma: str
    nhap_luc: datetime | None = None
    nguoi_nhap: str | None = None


class VatTuNhapLaiOut(BaseModel):
    """Một yêu cầu NHẬP tổ trả vật tư thừa về kho — chỉ số lượng, không giá."""
    id: int
    ma: str
    trang_thai: str
    can_luc: datetime | None = None
    created_by_ten: str | None = None
    created_at: datetime
    dongs: list[VatTuNhapLaiDongOut] = []
    cac_phieu: list[PhieuNhapLaiOut] = []       # phiếu NHẬP kho đã ghi sổ của yêu cầu này


class VatTuCapOut(BaseModel):
    """Khối vật tư cấp của drawer công đoạn (spec-de-nghi-cap-vat-tu-cong-doan §6)."""
    ke_hoach: list[dict] = []
    cac_de_nghi: list[VatTuCapLanOut] = []
    doi_chieu: list[VatTuCapDoiChieuOut] = []
    cac_nhap_lai: list[VatTuNhapLaiOut] = []
    de_nghi_co_the_sua_id: int | None = None
    co_the_tao_bo_sung: bool = True
    # Công đoạn chưa từng có đề nghị nên phiếu đang lấy theo đường lùi `lsx_id` — UI phải nói rõ
    # đây là dữ liệu trước 31/08/2026, đừng để người đọc tưởng nó cùng độ tin cậy.
    du_lieu_cu: bool = False


class TepLenhNhomOut(BaseModel):
    """Tệp đính kèm của MỘT lệnh, nhìn từ Bàn tổ (chỉ đọc). Bài ghép thì mỗi lệnh thành viên một nhóm."""
    lsx_id: int
    lsx_ma: str
    lsx_ten: str | None = None
    items: list[LsxDinhKemOut]


class TepLenhOut(BaseModel):
    nhom: list[TepLenhNhomOut]


class MayDoiRow(BaseModel):
    id: int
    ma: str
    ten: str | None = None
    loai_may: str | None = None
    # Trạng thái LÚC NÀY, cùng nguồn cột Trạng thái của màn Thiết bị (`services/may_trang_thai.py`):
    # ranh | co_phieu_sua | dang_chay | bao_tri | may_dung | khoa.
    trang_thai: str
    nhan: str
    chi_tiet: str | None = None


class MayDoiOut(BaseModel):
    """Ô "Đổi máy" của bàn tổ — máy làm được công đoạn của việc, kèm tình trạng từng máy."""
    items: list[MayDoiRow]
    # True = danh sách đã bị công đoạn thu hẹp (khai máy hoặc nhóm máy); False = chưa khai, mọi máy.
    theo_cong_doan: bool


class BaoHongMayOut(BaseModel):
    """Một lần báo hỏng chưa xử lý xong của máy đang làm việc — dòng "Máy" ở ngăn bàn tổ."""
    loai: str  # "yeu_cau" (chờ tổ sửa chữa nhận) | "phieu" (đã nhận, chờ sửa)
    id: int
    ma: str
    trang_thai: str
    may_dung: bool = False
    trieu_chung: str | None = None
    thoi_diem: datetime | None = None


class WorkItemChiTietOut(BaseModel):
    cong_viec: WorkItemOut
    trang_thai: str
    version: int
    # Dải công đoạn đầy đủ của lệnh (cùng hình ô `SxLenhNhom.routing`) — rỗng khi lệnh một bước
    # hoặc bài ghép.
    routing: list[RoutingBuocOut] = []
    # Ô đuôi của dải: làm xong bước cuối thì hàng đi đâu — None khi không có dải.
    dai_duoi: DaiDuoiOut | None = None
    # Báo hỏng còn mở của máy đang làm việc này (11/10/2026) — rỗng khi việc không gắn máy.
    bao_hong_may: list[BaoHongMayOut] = []
    # Bốn quyền chi tiết của NGƯỜI ĐANG XEM trên chính việc này (mg 0302) — drawer bật/tắt nút.
    quyen: dict[str, bool] = {}
    # Mức của từng quyền đó ở tổ ("all" | "own") — để drawer phân biệt "không được cấp" với
    # "Của tôi nhưng việc chưa giao cho mình".
    quyen_muc: dict[str, str] = {}
    # Cấu hình Khoán hiện tại của công đoạn. None = công đoạn chưa cấu hình; vẫn ghi mẻ được.
    khoan: "KhoanCongDoanThucThiOut | None" = None
    phan_cong: list[PhanCongItemOut]
    nguoi_ghi: list[NguoiGhiOut] = []
    phien_chay: list[PhienChayOut]
    khoang_tham_gia: list[KhoangThamGiaOut]
    san_luong: SanLuongOut
    ban_giao_di: list[BanGiaoOut]
    ban_giao_den: list[BanGiaoOut]
    # Đầu vào theo routing: công đoạn trước · trần ghi mẻ (None = không trần) · tên công đoạn
    # trước chưa giao được gì (rỗng = bắt đầu được).
    cong_doan_truoc: list[CongDoanTruocOut] = []
    tran_ghi: TranGhiOut | None = None
    thieu_dau_vao: list[str] = []
    # Câu chặn Bắt đầu vì vật tư chưa sẵn sàng (spec 2026-10-18 §5.3); None = không chặn.
    vat_tu_chua_san_sang: str | None = None
    ban_giao_chang_sau: list[BanGiaoChangSauOut]
    vat_tu: list[PhieuXuatVatTuOut]
    vat_tu_cap: VatTuCapOut = VatTuCapOut()


# --- Mặt GHI: sản lượng · bàn giao · vật tư (Giai đoạn 3, §10–§11) ---------------------------
class LotVaoIn(BaseModel):
    nguon_batch_id: int | None = None   # mẻ đầu ra của công đoạn trước — bắt buộc (service kiểm)
    so_luong: float
    don_vi: str | None = None           # trống ⇒ đơn vị vào của công việc


class MePhatSinhIn(BaseModel):
    """Một việc PHÁT SINH thợ đã làm trong mẻ (§7.1) — tick rồi gõ số lượng."""

    phat_sinh_id: int
    so_luong: float = Field(gt=0)


class BatchIn(BaseModel):
    # Hộp Ghi sản lượng không gửi giờ (10/10/2026): máy chủ lấy lúc bấm làm kết thúc, bắt đầu nối
    # lần ghi trước (chưa có thì đầu phiên chạy). Gửi thì phải gửi đủ cả hai.
    bat_dau: datetime | None = None
    ket_thuc: datetime | None = None
    tong: float
    tot: float
    hong: float = 0
    don_vi: str | None = None           # trống ⇒ đơn vị ra của công việc
    mo_ta_loi: str | None = None
    ghi_chu: str | None = None
    lot_vao: list[LotVaoIn] = []
    # Việc phát sinh — không cộng vào sản lượng, xem `SanXuatBatchPhatSinh`.
    phat_sinh: list[MePhatSinhIn] = []
    # Người làm lần này: tổ mình tick + người tổ khác tổ thêm; None = bộ tick sẵn của tổ.
    nguoi_ids: list[int] | None = None
    # Giá trị tuỳ chọn khi ghi `{ma: giá trị}` (Đợt 2); thiếu mã ⇒ 0.
    tuy_chon: dict[str, float] = {}
    # Lệnh in AB: mặt máy chạy ở lần ghi này ("a" / "b") — bậc giá theo số màu mặt đó.
    mat_in: Literal["a", "b"] | None = None


class ThemLotIn(BaseModel):
    nguon_batch_id: int | None = None
    so_luong: float
    don_vi: str | None = None


class ViecPhatSinhChonOut(BaseModel):
    """Một việc phát sinh bày trong form Ghi mẻ — TÊN · ĐƠN GIÁ · ĐVT, đúng ba thứ phải hiện."""

    id: int
    ten: str
    don_gia: float
    don_vi: str
    don_vi_ten: str | None = None
    # Giá lấy theo TỔ của việc (bảng giá theo tổ, 21/10/2026); tổ vắng trong bảng ⇒ thiếu giá.
    thieu_gia: bool = False


class BacTheoChonOut(BaseModel):
    """Giá của tổ ứng với một tổ hợp tick (`chon` = {mã tuỳ chọn: 0/1}) — công đoạn chia bậc."""

    chon: dict[str, float] = {}
    mat: Literal["a", "b"] | None = None   # lệnh in AB: tổ hợp của mặt nào
    bac_ma: str | None = None
    bac_ten: str | None = None
    so_mau: float = 0
    so_mau_pha: float = 0
    gia_co_dinh: float = 0.0
    don_gia: float = 0.0
    thieu_gia: bool = False


class KhoanCongDoanThucThiOut(BaseModel):
    """Cấu hình cố định của công đoạn bày trong form Ghi mẻ — không có thao tác chọn nguồn."""

    id: int
    ten: str
    don_gia: float
    don_vi: str
    don_vi_ten: str | None = None
    phat_sinh: list[ViecPhatSinhChonOut] = []
    # Giá theo tổ (21/10/2026): giá cố định mỗi lần ghi + đơn giá của TỔ làm việc này.
    gia_co_dinh: float = 0.0
    thieu_gia: bool = False
    tuy_chon: list[TuyChonKhaiOut] = []
    # Bậc giá (Bài in, 22/10/2026): rỗng = công đoạn không chia bậc. Số màu là màu MỘT lượt máy.
    bac_theo_chon: list[BacTheoChonOut] = []
    so_mau: float | None = None
    so_mau_pha: float | None = None


class KetQuaNhanhOut(BaseModel):
    lsx_id: int
    so_luong: float
    don_vi: str
    ban_giao_id: int | None = None


class SanLuongKetQuaOut(BaseModel):
    cong_viec_id: int
    department_id: int | None = None
    trang_thai: str
    version: int
    batch_id: int | None = None
    ket_qua_lsx: list[KetQuaNhanhOut] = []


class BanGiaoDeXuatIn(BaseModel):
    dich_cong_viec_id: int                # chặng sau theo routing — bước cuối lệnh không bàn giao
    don_vi: str | None = None
    # Mẻ đi theo lần giao (bắt buộc khi còn mẻ chưa giao). Số lượng suy ra từ mẻ, không nhận số gõ.
    batch_ids: list[int] = []


class BanGiaoSuaIn(BaseModel):
    batch_ids: list[int] = []             # danh sách mẻ MỚI của lần giao còn chờ xác nhận
    expected_version: int | None = None


class BanGiaoXacNhanIn(BaseModel):
    expected_version: int | None = None


class SuaSoMeIn(BaseModel):
    """Sửa số làm được của một mẻ đã ghi (10/10/2026, thay "Điều chỉnh số" trên lần giao)."""
    tot: float
    ly_do: str | None = None            # tuỳ chọn — hiện ở Lịch sử cho cả bên nhận đọc
    expected_version: int | None = None
    nguoi_ids: list[int] | None = None  # người làm lần đó, kể cả tổ khác; None = không đổi
    tuy_chon: dict[str, float] | None = None  # tuỳ chọn khi ghi (Đợt 2); None = không đổi


class BanGiaoKetQuaOut(BaseModel):
    ban_giao_id: int
    trang_thai_ban_giao: str
    so_luong: float
    version: int
    nguon_cong_viec_id: int
    dich_cong_viec_id: int | None = None
    nguon_department_id: int | None = None
    dich_department_id: int | None = None


# ⚠️ Mọi schema PHÂN BỔ (`PhanBo*In/Out`, `LoaiTru*`, `GoLoaiTruIn`, `BuTru*`) GỠ 18/09/2026
#    cùng sáu endpoint chia sản lượng (mg `0322`).


# --- KCS theo LỆNH (mg 0306, docs/design-kcs-theo-lenh.md) -----------------------------------
class KcsChecklistKetQuaIn(BaseModel):
    """Một kết quả tiêu chí, khoá theo cặp (công việc nguồn, `thu_tu` trong `kcs_tieu_chi_json` của
    nó). Bước KCS cuối xét tiêu chí gộp cả chuỗi (08/10/2026) nên phải nói tiêu chí của công việc
    nào; bỏ trống = của chính công việc lần kiểm."""
    cong_viec_id: int | None = None
    thu_tu: int
    dat: bool
    ghi_chu: str | None = None


class KcsBaoLoiNguonOut(BaseModel):
    """Phần lỗi của lần kiểm quy về công đoạn đứng trước — báo tổ đó xem, tính trách nhiệm."""
    cong_viec_id: int
    department_id: int | None = None
    ten_cong_doan: str = ""
    so_loi: float


class KcsKiemKetQuaOut(BaseModel):
    """Kết quả một lần kiểm công đoạn. `notify_user_ids` KHÔNG phơi FE — router đẩy SSE rồi Pydantic
    tự nuốt (không khai ở đây là cố ý)."""
    kcs_batch_id: int
    loi_id: int | None = None
    cong_viec_id: int
    department_id: int | None = None
    lsx_id: int | None = None
    nhom_id: int | None = None
    ten_cong_doan: str = ""
    so_dat: float
    so_loi: float
    ket_luan: str
    version: int
    bao_loi_nguon: list[KcsBaoLoiNguonOut] = []


class KcsDaXemKetQuaOut(BaseModel):
    loi_id: int
    kcs_batch_id: int
    cong_viec_id: int | None = None
    department_id: int | None = None
    da_xem_luc: datetime | None = None
    nguoi_xem: str | None = None
    version: int


class KcsAnhOut(BaseModel):
    id: int
    file_name: str
    file_url: str
    file_type: str | None = None


class KcsLanKiemLoiOut(BaseModel):
    id: int
    mo_ta: str | None = None
    so_luong: float
    don_vi: str | None = None
    to_chiu_id: int | None = None
    to_chiu_ten: str | None = None
    # Công đoạn CHỊU lỗi — khác công đoạn của lần kiểm khi KCS quy lỗi về bước trước (19/09/2026).
    cong_doan_id: int | None = None
    cong_doan_ten: str | None = None
    da_xem_luc: datetime | None = None
    nguoi_xem: str | None = None
    anh: list[KcsAnhOut] = []


class KcsChiTietTieuChiOut(BaseModel):
    """Một tiêu chí bước KCS cuối xét — gộp từ ảnh chụp `kcs_tieu_chi_json` của mọi công việc trong
    chuỗi (`services/san_xuat/kcs_checklist.checklist_gop`), kèm công việc + lệnh nguồn để form
    gom thẻ theo công đoạn."""
    cong_viec_id: int | None = None
    ten_cong_doan: str | None = None
    nhom_cong_doan: str | None = None
    tieu_chi_id: int | None = None
    ma: str | None = None
    ten: str | None = None
    thu_tu: int = 0
    lsx_id: int | None = None
    lsx_ma: str | None = None
    ten_lenh: str | None = None
    la_lenh_phu: bool = False


class KcsLanKiemOut(BaseModel):
    id: int
    # Công đoạn được kiểm (nơi KCS bắt lỗi).
    cong_viec_id: int | None = None
    cong_doan_ten: str | None = None
    nguoi_kiem: str | None = None
    luc: datetime | None = None
    so_dat: float
    so_loi: float
    don_vi: str | None = None
    ket_luan: str
    checklist: list[dict] = []
    ghi_chu: str | None = None
    version: int
    loi: list[KcsLanKiemLoiOut] = []


class KcsCuoiTongOut(BaseModel):
    tot: float = 0
    dat: float = 0
    da_de_nghi_kho: float = 0
    don_vi: str | None = None


class KcsCongViecOut(BaseModel):
    """Mục "Kết quả KCS" của một công đoạn (drawer bàn tổ)."""
    cong_viec_id: int
    la_kcs_cuoi: bool = False
    # Chỉ công đoạn cuối: số tốt tổ ghi, KCS đạt, đã đề nghị kho (công đoạn giữa không có "đạt").
    cuoi: KcsCuoiTongOut | None = None
    checklist: list[KcsChiTietTieuChiOut] = []
    lan_kiem: list[KcsLanKiemOut] = []
    # Lần kiểm ở bước SAU có lỗi quy về công đoạn này — mỗi lần chỉ mang lỗi của công đoạn này.
    lan_kiem_buoc_sau: list[KcsLanKiemOut] = []


class KcsYeuCauKhoOut(BaseModel):
    """Một dòng yêu cầu NHẬP kho thành phẩm sinh từ công đoạn cuối — số theo đơn vị của món."""
    request_id: int
    ma: str
    trang_thai: str
    sl_de_nghi: float
    sl_da_nhan: float
    don_vi: str | None = None
    tao_luc: datetime | None = None


class KcsCuoiTomTatOut(BaseModel):
    tot: float
    dat: float
    da_yeu_cau: float
    con_gui_kho: float
    # Phương án B nâng cấp (09/10/2026): cột "Đã kiểm đạt / cần" + "Chờ kiểm". `don_vi` là MÃ chặng.
    cho_kiem: float = 0
    muc_tieu: float | None = None
    don_vi: str | None = None


class KcsChuoiNutOut(BaseModel):
    """Một ô nhỏ ở cột Chuỗi: `trang_thai` xong | chay | chua | loi (gây lỗi đè trạng thái chạy)."""
    ten: str
    trang_thai: str
    la_kcs_cuoi: bool = False


class KcsLoiGayOut(BaseModel):
    """Lỗi do một công đoạn của lệnh gây — bắt ở đâu cũng tính; đơn vị là của nơi bắt."""
    ten: str
    don_vi: str | None = None
    so_luong: float


class KcsLenhItemOut(BaseModel):
    lsx_id: int
    ma: str
    ten: str = ""
    khach: str | None = None
    nhom_ma: str | None = None
    nhom_trang_thai: str | None = None
    # Đơn vị tính của sản phẩm trên lệnh — chặng Thành phẩm gọi bằng chữ này ("cuốn").
    don_vi_tinh: str | None = None
    so_cong_doan: int
    so_da_kiem: int
    so_loi: float
    cuoi: KcsCuoiTomTatOut | None = None
    # Cột "Ngày tạo" + "Lần KCS gần nhất" (06/10/2026) — cũng là hai mốc kỳ `tao` / `kcs`.
    created_at: datetime | None = None
    kcs_gan_nhat: datetime | None = None
    la_lenh_phu: bool = False
    # Lệnh phụ: tên công đoạn của lệnh chính mà nó ghép vào.
    noi_vao: str | None = None
    chuoi: list[KcsChuoiNutOut] = []
    loi_gay: list[KcsLoiGayOut] = []
    # da_dong | cho_kiem | chua_gui_kho | cho_dong | cho_to | dang_lam | da_xong
    tinh_trang: str


class KcsLenhDemOut(BaseModel):
    """Số trên các nút lọc nhanh — cùng các điều kiện khác (tìm, khách, kỳ) đang áp."""
    tat_ca: int = 0
    cho_kiem: int = 0
    chua_gui_kho: int = 0
    cho_dong: int = 0
    da_dong: int = 0


class KcsLenhListOut(BaseModel):
    items: list[KcsLenhItemOut]
    tong: int
    trang: int
    co_trang: int
    dem: KcsLenhDemOut


class KcsGiaTriTenOut(BaseModel):
    ten: str
    so: int


class KcsGiaTriLocOut(BaseModel):
    """Giá trị các ô lọc lấy từ dữ liệu màn KCS (11/10/2026), mỗi giá trị kèm số lệnh."""
    to: list[LuaChonLoc]
    cong_doan: list[KcsGiaTriTenOut]
    nguoi_kiem: list[LuaChonLoc]


class KcsLenhDauOut(BaseModel):
    id: int
    ma: str
    ten: str = ""
    khach: str | None = None
    nhom_id: int | None = None
    nhom_ma: str | None = None
    nhom_trang_thai: str | None = None
    # Đơn vị tính của sản phẩm trên lệnh — màn KCS gọi chặng Thành phẩm bằng chữ này ("cuốn").
    don_vi_tinh: str | None = None


class KcsMeOut(BaseModel):
    """Một mẻ tổ đã ghi, bày trong form kiểm KCS — `so_luong` là số làm được (tốt)."""
    id: int
    bat_dau: datetime | None = None
    ket_thuc: datetime | None = None
    so_luong: float
    don_vi: str | None = None
    nguoi_ghi: str | None = None
    nguoi: list[str] = []


class KcsLoiBuocSauOut(BaseModel):
    """Lỗi KCS bắt ở bước sau mà quy về công đoạn này — gộp theo bước bắt + đơn vị của bước đó."""
    phat_hien_o: str
    don_vi: str | None = None
    so_luong: float


class KcsNguonLoiOut(BaseModel):
    """Một công việc mà bước KCS cuối quy lỗi về được (chuỗi gộp, kể cả lệnh phụ cùng nhóm)."""
    cong_viec_id: int
    ten: str
    lsx_ma: str | None = None
    to_ten: str = ""
    la_dang_kiem: bool = False


class KcsTieuChiCuaOut(BaseModel):
    """Một tiêu chí của CHÍNH công đoạn — ảnh chụp lúc phát hành, khoá `thu_tu`."""
    thu_tu: int
    ma: str | None = None
    ten: str = ""


class KcsCongDoanOut(BaseModel):
    cong_viec_id: int
    ten: str
    phan_doan_so: int = 1
    phan_doan_tong: int = 1
    to_id: int | None = None
    to_ten: str = ""
    trang_thai: str
    tot: float
    hong: float
    don_vi: str | None = None
    la_kcs_cuoi: bool
    # Bước thuê ngoài — số `tot` là số chốt nhà gia công trả về, không phải tổ làm (11/10/2026).
    gia_cong_ngoai: bool = False
    nha_gia_cong: str | None = None
    checklist: list[KcsChiTietTieuChiOut] = []
    tieu_chi: list[KcsTieuChiCuaOut] = []
    nguon_loi: list[KcsNguonLoiOut] = []
    so_lan_kiem: int
    tong_dat: float
    tong_loi: float
    loi_tai_cho: float = 0.0             # bắt ở đây VÀ do chính công đoạn này (08/10/2026)
    da_yeu_cau_kho: float = 0.0
    con_gui_kho: float = 0.0
    yeu_cau_kho: list[KcsYeuCauKhoOut] = []
    lan_kiem: list[KcsLanKiemOut] = []
    loi_buoc_sau: list[KcsLoiBuocSauOut] = []
    # Bối cảnh cho form kiểm (19/09/2026) — kế hoạch, máy, dặn dò, quy cách, mẻ tổ đã ghi.
    so_luong_ra: float | None = None
    may: str | None = None
    ghi_chu_ky_thuat: str | None = None
    quy_cach: dict | None = None
    me: list[KcsMeOut] = []


class KcsChuoiCongDoanOut(BaseModel):
    lsx: KcsLenhDauOut
    cong_doan: list[KcsCongDoanOut]


class KcsLanNhomOut(KcsChuoiCongDoanOut):
    """Một làn của sơ đồ nhóm. `noi_vao_cong_viec_id` = công việc lệnh chính mà lệnh phụ ghép vào."""
    la_lenh_phu: bool = False
    noi_vao_cong_viec_id: int | None = None


class KcsNhomDauOut(BaseModel):
    id: int
    ma: str
    ten: str | None = None
    trang_thai: str
    khach: str | None = None


class KcsSoDoNhomOut(BaseModel):
    nhom: KcsNhomDauOut | None = None
    lenh: list[KcsLanNhomOut]


class KcsBaoCaoTheoNgayRow(BaseModel):
    ngay: date
    tong_nhan: float
    tong_dat: float
    tong_loi: float


class KcsBaoCaoCongDoanRow(BaseModel):
    ten_cong_doan: str
    tong_so_luong: float


class KcsBaoCaoToRow(BaseModel):
    to_id: int
    ten: str
    tong_so_luong: float


class KcsBaoCaoLichSuRow(BaseModel):
    """Một lần kiểm đã ghi — bảng "Kết quả đã ghi" ở dashboard KCS."""
    kcs_batch_id: int
    cong_viec_id: int
    thoi_diem: datetime | None = None
    so_luong_dat: float
    so_luong_khong_dat: float
    don_vi: str = ""
    nguon_ma: str = ""
    nguon_ten: str = ""
    ten_cong_doan: str = ""
    nguoi_ghi: str | None = None
    trang_thai_gui_kho: str = "khong_ap_dung"


class KcsCongDoanLocOut(BaseModel):
    id: int
    ma: str
    ten: str
    nhom: str | None = None


class KcsCongDoanLocListOut(BaseModel):
    """Danh mục công đoạn cho ô lọc dashboard KCS — đọc dưới quyền Xem theo tổ."""
    items: list[KcsCongDoanLocOut]


class KcsBaoCaoTieuChiRow(BaseModel):
    ten: str
    cong_doan: str
    lsx_ma: str | None = None
    to_ten: str | None = None
    lan_xet: int
    hong: int
    # Σ số lỗi KCS ghi THẲNG theo tiêu chí ở công đoạn giữa (09/10/2026); `don_vi` là MÃ chặng.
    loi_o_cong_doan: float = 0
    don_vi: str | None = None
    # Số lần ghi lỗi gắn tiêu chí này (11/10/2026).
    lan: int = 0


class KcsNhietCot(BaseModel):
    """Cột ngày (`2026-10-08`, nhãn `08/10`) — kỳ có hơn 31 ngày lỗi thì là tháng (`2026-10`)."""
    khoa: str
    nhan: str


class KcsNhietDong(BaseModel):
    """Một dòng bảng lỗi theo ngày: công đoạn gây lỗi (kèm lệnh) hoặc tổ chịu; `o` = {khoá cột: số}."""
    ten: str
    lsx_ma: str | None = None
    don_vi: str | None = None
    o: dict[str, float]
    tong: float
    lan: int = 0


class KcsAnhLoiOut(BaseModel):
    file_name: str
    file_url: str
    file_type: str | None = None


class KcsLanLoiRow(BaseModel):
    """Một lần ghi lỗi — danh sách "Các lần ghi lỗi" của tab Báo cáo lỗi (11/10/2026). Lệnh/khách là
    của công đoạn GÂY; `tai_cho` = bắt ngay ở công đoạn gây; `don_vi` là MÃ chặng."""
    loi_id: int
    kcs_batch_id: int
    thoi_diem: datetime | None = None
    lsx_ma: str | None = None
    san_pham: str | None = None
    khach: str | None = None
    cong_doan: str
    to: str | None = None
    tieu_chi: str | None = None
    ghi_chu: str | None = None
    noi_bat: str
    tai_cho: bool
    so_luong: float
    don_vi: str | None = None
    anh: list[KcsAnhLoiOut] = []
    nguoi_ghi: str | None = None


class KcsNhomLoi(BaseModel):
    """Một mục của dạng Biểu đồ (công đoạn gây / tổ chịu / tiêu chí). `ngay` = {khoá trục: số lần}."""
    ten: str
    lan: int
    so_theo_dv: dict[str, float] = {}
    so_lenh: int = 0
    tai_cho: int = 0
    lot: int = 0
    ngay: dict[str, int] = {}


class KcsPhanTich(BaseModel):
    cong_doan: list[KcsNhomLoi] = []
    to: list[KcsNhomLoi] = []
    tieu_chi: list[KcsNhomLoi] = []


class KcsTrucMoc(BaseModel):
    """Một mốc trục thời gian liền (ngày, hoặc tháng khi kỳ dài) kèm nhận/đạt của bước cuối."""
    khoa: str
    nhan: str
    nhan_cuoi: float = 0
    dat_cuoi: float = 0


class KcsKyTruoc(BaseModel):
    tu: date
    den: date
    tong_luot: int
    ty_le_dat: float | None = None
    so_lan_ghi_loi: int
    so_lenh_loi: int


class KcsLocCongDoan(BaseModel):
    ten: str
    so: int = 0


class KcsBaoCaoOut(BaseModel):
    tong_luot: int
    tong_nhan: float
    tong_dat: float
    tong_loi: float
    ty_le_dat: float | None = None
    theo_ngay: list[KcsBaoCaoTheoNgayRow]
    cong_doan: list[KcsBaoCaoCongDoanRow]
    to: list[KcsBaoCaoToRow]
    lich_su: list[KcsBaoCaoLichSuRow] = []
    # Phương án B nâng cấp (09/10/2026): ba cách xem của tab Báo cáo lỗi.
    so_lan_ghi_loi: int = 0
    tieu_chi: list[KcsBaoCaoTieuChiRow] = []
    nhiet_cot: list[KcsNhietCot] = []
    nhiet_cong_doan: list[KcsNhietDong] = []
    nhiet_to: list[KcsNhietDong] = []
    # Giá trị cho menu Lọc của tab (09/10/2026), kèm số lượt kiểm trong kỳ + ô tìm.
    loc_khach: list[LuaChonLoc] = []
    loc_cong_doan: list[KcsLocCongDoan] = []
    # Dạng Bảng | Biểu đồ (11/10/2026).
    so_lenh_loi: int = 0
    ky_truoc: KcsKyTruoc | None = None
    truc: list[KcsTrucMoc] = []
    phan_tich: KcsPhanTich = KcsPhanTich()
    lan_loi: list[KcsLanLoiRow] = []
    lan_loi_tong: int = 0


# --- NHẬP KHO THÀNH PHẨM (yêu cầu nhập xuất của kho thật) -----------------------------------
class NhapKhoTpDongOut(BaseModel):
    hang_id: int
    ma_hang: str
    ten_hang: str
    dvt: str | None = None
    sl_de_nghi: float
    don_gia_ban: int | None = None


class NhapKhoYcKetQuaOut(BaseModel):
    """Kết quả nút "Tạo yêu cầu nhập kho": MỘT yêu cầu NHẬP của kho thật. `so_luong` theo đơn vị ra
    của công đoạn (số KCS vừa gửi); `dong[].sl_de_nghi` theo đơn vị của món thành phẩm."""
    request_id: int
    ma: str
    cong_viec_id: int
    so_luong: float
    don_vi: str | None = None
    dong: list[NhapKhoTpDongOut] = []


# --- Tổ đề nghị cấp vật tư công đoạn (spec-de-nghi-cap-vat-tu-cong-doan §6) ------------------
class VatTuDeNghiDongIn(BaseModel):
    hang_loai: str
    hang_id: int
    #: Giấy: khổ mm (spec giấy đếm tờ × khổ §4.5) — server chuẩn hoá lại khổ, đơn vị gốc máy chủ suy
    #: từ `dvt` (giấy bỏ dạng cuộn/tờ 10/10/2026; client cũ gửi thừa `dang_giay` thì bị bỏ qua).
    #: Vật tư khác bỏ qua khổ.
    kho_rong: int = Field(default=0, ge=0)
    kho_dai: int = Field(default=0, ge=0)
    dvt: str
    sl_yeu_cau: float = 0.0


class VatTuDeNghiIn(BaseModel):
    # GIỜ cần, không phải ngày: kho soạn theo ca. `stock_requests.ngay_can` chỉ lưu phần DATE.
    can_luc: datetime
    # Ghi chú tổ gõ cho thủ kho (đi thẳng vào `stock_requests.ghi_chu`); trống = câu mặc định.
    ghi_chu: str | None = Field(default=None, max_length=1000)
    lines: list[VatTuDeNghiDongIn] = []


class VatTuNhapLaiDongIn(BaseModel):
    """Một dòng vật tư thừa tổ trả về kho. Giấy: khổ mm (server chuẩn hoá, kiểm khổ theo đơn vị gốc
    suy từ `dvt`; `dang_giay` client cũ gửi thừa thì bị bỏ qua)."""
    hang_loai: Literal["giay", "vat_tu"]
    hang_id: int
    dvt: str
    so_luong: float
    kho_rong: int = Field(default=0, ge=0)
    kho_dai: int = Field(default=0, ge=0)


class VatTuNhapLaiIn(BaseModel):
    ghi_chu: str | None = Field(default=None, max_length=500)
    # Giờ trả hàng (không bắt buộc): có thì yêu cầu nhập lại mang ngày + giờ cần.
    can_luc: datetime | None = None
    lines: list[VatTuNhapLaiDongIn] = []


# --- ĐÓNG LỆNH THỦ CÔNG (spec 2026-09-29) ---
class DongLenhCanhBaoOut(BaseModel):
    ma: str          # chua_kiem | chua_gui_kho | thieu_muc_tieu | viec_do
    cau: str


class DongLenhLenhOut(BaseModel):
    id: int
    ma: str


class DongLenhTinhTrangOut(BaseModel):
    """Khối "Đóng lệnh" ở màn KCS — số tóm tắt + cảnh báo cho hộp xác nhận. KHÔNG có cổng."""
    nhom_id: int
    order_id: int | None = None
    trang_thai: str                      # in_production | closed
    version: int
    lenh: list[DongLenhLenhOut]
    muc_tieu: float | None = None
    da_dat: float = 0.0
    don_vi: str = ""
    canh_bao: list[DongLenhCanhBaoOut] = []
    dong_boi: str | None = None
    dong_luc: datetime | None = None
    duoc_dong_thieu: bool = False        # người xem đóng được khi còn cảnh báo / mở lại


class DongLenhIn(BaseModel):
    expected_version: int | None = None


class DongLenhKetQuaOut(BaseModel):
    nhom_id: int
    order_id: int | None = None
    trang_thai: str
    kieu: str                            # dong | mo_lai
    version: int
    lenh_ma: list[str] = []
    da_dat: float = 0.0
    muc_tieu: float | None = None
    don_vi: str = ""


# --- Báo dừng máy ở bàn tổ (Đợt 2, 21/10/2026) -------------------------------------------------
class DungMayIn(BaseModel):
    ngay: date
    ly_do: str                          # may_hu | het_hang
    sua_chua_id: int | None = None      # phiếu sửa máy, khi Máy hư
    ghi_chu: str | None = None
    nguoi_ids: list[int] = []           # người hưởng — tổ trưởng tick


class DungMaySuaIn(BaseModel):
    """Sửa ngày đã báo — mọi thứ trừ ngày (đổi ngày = xoá rồi báo lại)."""
    ly_do: str
    sua_chua_id: int | None = None
    ghi_chu: str | None = None
    nguoi_ids: list[int] = []


class DungMayNguoiOut(BaseModel):
    employee_id: int
    ho_ten: str = ""


class DungMayOut(BaseModel):
    id: int
    department_id: int
    ngay: date
    ly_do: str
    ly_do_ten: str
    sua_chua_id: int | None = None
    sua_chua_ma: str | None = None
    ghi_chu: str | None = None
    nguoi: list[DungMayNguoiOut] = []


class PhieuSuaChonOut(BaseModel):
    id: int
    ma: str
    may_ten: str | None = None
    bo_phan_hong: str | None = None


class DungMayListOut(BaseModel):
    ky_da_chot: list[str] = []          # "YYYY-MM" kỳ lương đã chốt / đã chi — khoá ngày thuộc kỳ đó
    ds: list[DungMayOut] = []
    nguoi: list[DungMayNguoiOut] = []
    phieu_sua: list[PhieuSuaChonOut] = []
