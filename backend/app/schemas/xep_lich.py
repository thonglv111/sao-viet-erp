"""Schema Xếp lịch (cấp LỆNH SẢN XUẤT).

CẢNH BÁO đã dính một lần ở chỗ khác: `response_model` của Pydantic BỎ IM LẶNG mọi khoá service
trả về mà schema không khai — không lỗi, không log, FE chỉ nhận `undefined`. Thêm số nào thì phải
đi hết dây: dict của service → schema ở đây → type TS ở `api/xepLich3.ts`.
"""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class DoanChayOut(BaseModel):
    """Một đoạn máy chạy liền mạch — lớp đậm bên trong thanh Gantt."""

    tu: datetime
    den: datetime
    buoc_index: int


class DoanChoOut(BaseModel):
    """Quãng lệnh ĐỨNG CHỜ lệnh khác trong cụm (5b, 08/10/2026) — dẫn xuất, không lưu."""

    tu: datetime
    den: datetime
    cong_doan_id: int


class LienOut(BaseModel):
    """Một bước của lệnh này dính một bước của lệnh khác — đường nối trên lưới + dải trong ngăn.

    `loai`: `cho` = bước này đợi bước kia xong · `doi` = bước kia đợi bước này xong · `chung` = in
    chung một lượt bài ghép. `luc_nay` / `luc_khac` là hai đầu đường nối: với `cho` là (bước này bắt
    đầu, bước kia xong); `doi` ngược lại; `chung` là hai giờ bắt đầu. `None` = lệnh kia chưa xếp lịch.
    """

    loai: str
    cong_doan_id: int
    thu_tu: int
    ten_buoc: str
    lsx_id_khac: int
    ma_khac: str
    ten_lenh_khac: str
    cong_doan_id_khac: int
    thu_tu_khac: int
    ten_buoc_khac: str
    luc_nay: datetime | None = None
    luc_khac: datetime | None = None
    bai_ghep_ma: str | None = None
    # Giờ của chính bước BÊN NÀY (viền tím quanh bước in chung trên lưới).
    bat_dau_nay: datetime | None = None
    ket_thuc_nay: datetime | None = None


class CumLenhOut(BaseModel):
    lsx_id: int
    ma: str
    ten: str
    trang_thai: str
    co_lich: bool = False
    ket_thuc: datetime | None = None


class CumOut(BaseModel):
    """Cụm lệnh PHÁT HÀNH CÙNG NHAU (bài ghép · cùng nhóm thành phẩm · phụ thuộc chéo).

    `ten` là tiêu đề hàng cụm trên lưới; `phu` là câu phụ ("cùng đơn DH015"), có thể trống.
    """

    id: int
    ten: str
    phu: str | None = None
    bai_ghep_ma: list[str] = Field(default_factory=list)
    lsx: list[CumLenhOut] = Field(default_factory=list)


class _LichChung(BaseModel):
    """Phần LỊCH dùng chung giữa dòng Gantt và panel chi tiết."""

    bat_dau_at: datetime | None = None
    ket_thuc: datetime | None = None
    chay_phut: float = 0.0
    # Khoảng hở giữa các đoạn chạy: nghỉ giữa ca + ngoài ca + ngày nghỉ. Trả lời đúng câu người
    # dùng hỏi khi nhìn thanh: "vì sao nó dài hơn giờ chạy?".
    nghi_ngoai_ca_phut: float = 0.0
    # Quãng đứng chờ lệnh khác trong cụm — KHÔNG nằm trong `nghi_ngoai_ca_phut`.
    cho_phut: float = 0.0
    doan: list[DoanChayOut] = Field(default_factory=list)
    cho: list[DoanChoOut] = Field(default_factory=list)
    ghi_chu: list[str] = Field(default_factory=list)
    updated_at: datetime | None = None
    # Id cụm phát hành cùng nhau (`None` = lệnh đứng một mình) + các bước dính lệnh khác.
    cum_id: int | None = None
    lien: list[LienOut] = Field(default_factory=list)


class CongDoanOut(BaseModel):
    """Dòng bảng công đoạn trong panel.

    HAI CHẾ ĐỘ, cắt bằng `trang_thai`:
      · `None` — lệnh CHƯA phát hành. Không có mốc bước, đúng spec §4: bàn cấp lệnh chỉ cần hai
        mốc của cả lệnh, mốc từng bước là số thừa khi chưa có gì để so.
      · có giá trị — lệnh ĐÃ phát hành. Lúc này mốc bước hết thừa: nó là vế KẾ HOẠCH của phép so
        với vế THỰC TẾ, thứ duy nhất trả lời "bước nào xong sớm, bước nào xong muộn".

    Cả `ke_hoach_*` lẫn `thuc_*` đều đã ĐƯỢC BỌC về CÙNG một thang (giờ tường, không nhãn) ở
    service — xem `services/gio_xuong.py`. Đừng trừ hai mốc này ở FE để suy ra `lech_phut`; số đó
    tính ở BE, trên mốc gốc chưa bọc.
    """

    id: int
    thu_tu: int
    ten: str
    loai_buoc: str | None = None
    # Mã bài ghép đang phủ bước này — khi có, loại/tổ/nhà gia công là của BƯỚC CHUNG.
    bai_ghep_ma: str | None = None
    # Máy ĐANG GIAO CHẠY (`san_xuat_cong_viec.may_id`) nếu lệnh đã phát hành, không thì máy kế
    # hoạch. `may_nguon` nói rõ nguồn nào (`thuc_thi` · `ke_hoach`), và khi xưởng đã đổi máy thì
    # `may_ke_hoach_ten` giữ tên máy kế hoạch để màn đối chiếu được — số giờ tính theo máy ĐANG
    # CHẠY, vì tốc độ treo ở cặp (công đoạn × máy).
    may_id: int | None = None
    may_ten: str | None = None
    may_nguon: str | None = None
    may_ke_hoach_ten: str | None = None
    to_ten: str | None = None
    # `None` = kế hoạch CHƯA khai. Cột nguồn là `NOT NULL default 0` nên 0 chính là "chưa khai"
    # (không bước nào thật sự nhận vào 0 đơn vị) — service đổi 0 → `None` ngay ở mép API để màn
    # khỏi in "0 tờ", câu đọc như "bước này không nhận gì vào".
    so_luong_vao: float | None = None
    # `don_vi_vao` là MÃ trong `don_vi_do` (`to`, `con`); `don_vi_vao_ten` là chữ cho người đọc.
    don_vi_vao: str | None = None
    don_vi_vao_ten: str | None = None
    # ⚠️ `so_nguoi_chuan` GỠ 18/09/2026 (mg `0321`): kíp chuẩn của bước đã bay cùng cột. Nó chỉ là
    #    số HIỂN THỊ trên dòng bước, không luật nào của xếp lịch bám vào.
    chay_phut: float = 0.0
    # `chua_quy_doi` = không tính được giờ; `canh_bao` là câu nói rõ thiếu gì (do `thoi_luong_buoc`
    # phát, không dựng lại ở FE).
    phuong_phap: str | None = None
    canh_bao: str | None = None
    # Lớp phụ thuộc (đường dài nhất tới bước). `song_song` = còn bước khác cùng lớp, tức bảng bày
    # 1→N nhưng hai bước đó KHÔNG chặn nhau. Bàn cấp lệnh vẫn trải tuần tự — xem `trai_lich`.
    lop: int = 0
    song_song: bool = False
    la_thue_ngoai: bool = False
    mau_index: int = 0
    # --- lớp THỰC TẾ. Toàn bộ `None` ⇔ lệnh chưa phát hành (xem docstring). ---
    # `released` (tổ chưa động) · `running` · `paused` · `completed`.
    trang_thai: str | None = None
    ke_hoach_bat_dau: datetime | None = None
    ke_hoach_ket_thuc: datetime | None = None
    # Mốc phiên chạy ĐẦU TIÊN của bước; `None` = tổ chưa bấm Bắt đầu bao giờ.
    thuc_bat_dau: datetime | None = None
    # Chỉ có khi bước đã ĐÓNG (`completed`) — đang chạy thì chưa có mốc xong để nói.
    thuc_ket_thuc: datetime | None = None
    # Chênh mốc KẾT THÚC, phút. DƯƠNG = xong muộn hơn kế hoạch, ÂM = xong sớm. Chỉ có khi bước đã
    # đóng VÀ kế hoạch có khai mốc kết thúc.
    lech_phut: int | None = None
    # --- giờ DẪN XUẤT của bước theo lịch kế hoạch đã trải theo cụm (ngăn chi tiết) ---
    du_kien_bat_dau: datetime | None = None
    du_kien_ket_thuc: datetime | None = None
    # Bước sẵn sàng lúc này nhưng đợi lệnh khác tới `du_kien_bat_dau`. `None` = không chờ ai.
    cho_tu: datetime | None = None
    lien: list[LienOut] = Field(default_factory=list)


class NgayDacBietOut(BaseModel):
    """Một ngày khai ở Lịch làm việc. `loai`: `off` nghỉ lễ · `work` làm bù · `off1x` nghỉ khác."""

    ngay: date
    loai: str
    ten: str | None = None


class KhungGioOut(BaseModel):
    tu: str      # "HH:MM"
    den: str


class KhungLapOut(KhungGioOut):
    """Một khung giờ không chạy lặp lại trong lịch của lệnh, vd. nghỉ cơm 11:00–12:00 × 4 lần."""

    so_lan: int = 0
    phut: float = 0.0


class NgayNghiOut(BaseModel):
    ngay: date
    phut: float = 0.0
    # Tên ngày lễ nếu có; `None` = nghỉ theo cấu hình tuần, FE tự ghi thứ.
    ten: str | None = None
    loai: str | None = None


class CaXuongOut(KhungGioOut):
    """Một ca xưởng kèm bữa nghỉ đã khai — "Ca 1 06:00–15:00 (nghỉ 12:00–13:00)"."""

    ten: str
    nghi_tu: str | None = None
    nghi_den: str | None = None


class PhanTachNghiOut(BaseModel):
    """Diễn giải phần không chạy của thanh: năm loại `*_phut` cộng lại bằng `nghi_ngoai_ca_phut` + `cho_phut`."""

    ca_san_xuat: list[KhungGioOut] = Field(default_factory=list)
    # Từng ca có tên; rỗng khi xưởng chưa khai ca nào (khung lùi 8 tiếng) — FE dùng `ca_san_xuat`.
    cac_ca: list[CaXuongOut] = Field(default_factory=list)
    nghi_giua_ca_phut: float = 0.0
    nghi_giua_ca: list[KhungLapOut] = Field(default_factory=list)
    ngoai_ca_phut: float = 0.0
    ngoai_ca: list[KhungLapOut] = Field(default_factory=list)
    ngay_nghi_phut: float = 0.0
    ngay_nghi: list[NgayNghiOut] = Field(default_factory=list)
    gia_cong_ngoai_phut: float = 0.0
    cho_lenh_khac_phut: float = 0.0


class ChiTietOut(_LichChung):
    lsx_id: int
    ma: str
    ten: str
    trang_thai: str
    is_rush: bool = False
    customer_name: str | None = None
    order_no: str | None = None
    customer_po_no: str | None = None
    sale_name: str | None = None
    so_luong_dat: int = 0
    don_vi_tinh: str | None = None
    so_to_ke_hoach: int = 0
    so_to_nguyen: int = 0
    so_con: int = 1
    han_giao_khach: date | None = None
    nguoi_phu_trach_ten: str | None = None
    luu_y_gui_xuong: str | None = None
    # Quy cách đọc từ `quy_cach_json` — ẢNH CHỤP lúc tạo lệnh, khoá có thể trống. Trống thì FE BỎ
    # ô, đừng in `null` hay bịa nhãn.
    giay: str | None = None
    giays: list[str] = Field(default_factory=list)   # mọi giấy khai ở các bước
    kho_in: str | None = None
    so_mau: str | None = None
    so_kem: str | None = None
    # ⚠️ `so_nguoi_tong` GỠ 18/09/2026 (mg `0321`) cùng kíp chuẩn của bước — số hiển thị trên thẻ
    #    lệnh, không luật nào bám.
    cong_doans: list[CongDoanOut] = Field(default_factory=list)
    # Theo lịch KẾ HOẠCH (cùng lượt trải với `ket_thuc`/`nghi_ngoai_ca_phut`). `None` = chưa xếp.
    phan_tach_nghi: PhanTachNghiOut | None = None
    # Mốc xong TÍNH LẠI theo việc đã xảy ra: bước xong sớm kéo nó lùi, xong muộn đẩy nó ra. `None`
    # ⇔ `co_thuc_te=False` (lệnh chưa phát hành) — panel khi đó chỉ bày MỘT số như trước.
    # `ket_thuc` (kế thừa `_LichChung`) vẫn là mốc theo KẾ HOẠCH; hai số cố ý bày cạnh nhau.
    ket_thuc_thuc_te: datetime | None = None
    # `ket_thuc_thuc_te - ket_thuc`, phút. DƯƠNG = thực tế đang kéo lệnh muộn hơn kế hoạch.
    lech_ket_thuc_phut: int | None = None
    co_thuc_te: bool = False
    # Mốc CẢ LỆNH thật sự vào việc (phiên chạy sớm nhất). KHÔNG đổi khi người dùng dời mốc — lệnh
    # đã bắt đầu lúc nào là chuyện đã rồi, thứ dời được chỉ là PHẦN CÒN LẠI. Panel phải bày nó
    # cạnh ô nhập, không thì người đọc thấy mốc mới 11/09 rồi tưởng cả lệnh dời sang 11/09.
    thuc_bat_dau_lenh: datetime | None = None
    so_buoc_xong: int = 0
    so_buoc: int = 0
    cum: CumOut | None = None


class VatTuLenhOut(BaseModel):
    """Đèn vật tư của một lệnh — thẻ "thiếu vật tư" trên thanh. `muc`: `ok` · `vang` · `do`."""

    lsx_id: int
    muc: str
    chu: str = ""


class PhatHanhCapNhatIn(BaseModel):
    """Lý do đẩy lịch mới xuống xưởng. BẮT BUỘC — tổ đang cầm giấy in lịch cũ, đổi ngầm là mất vết.

    Ngưỡng 3 ký tự khớp `release_update.phat_hanh_cap_nhat`; service màn 3 chặn trước để ra 400
    kèm câu của màn, thay vì `ValueError` chung với "không còn gì để cập nhật".
    """

    ly_do: str = Field(..., max_length=500)



class MayGonOut(BaseModel):
    id: int
    ma: str
    ten: str


class VungKhoaIn(BaseModel):
    """Khoảng máy nghỉ khai tay ở Xếp lịch (bảo trì / hỏng / nghỉ / khác)."""
    tu: datetime
    den: datetime
    ly_do: str = Field("bao_tri", max_length=20)
    note: str | None = Field(None, max_length=500)


class VungKhoaOut(BaseModel):
    id: int
    may_id: int
    start: datetime
    finish: datetime
    ly_do: str
    note: str | None = None
    kieu: str


# ---------------------------------------------------------------- bàn hẹn đẩy (08/11/2026)
class DenVatTuOut(BaseModel):
    muc: str            # ok | vang | do
    chu: str = ""


class DongBanOut(BaseModel):
    """Một lệnh trên bàn hẹn đẩy. Mọi mốc giờ là giờ xưởng, naive."""

    lsx_id: int
    ma: str
    ten: str
    customer_name: str | None = None
    # `san_sang` · `da_lap_ke_hoach` (chờ đẩy) · `da_phat_hanh` · `da_dong` (đã đẩy).
    trang_thai: str = ""
    is_rush: bool = False
    so_luong_dat: int = 0
    don_vi_tinh: str | None = None
    han_giao_khach: date | None = None
    hen_luc: datetime | None = None
    nguoi_hen: str | None = None
    da_day_luc: datetime | None = None
    ket_ly_do: str | None = None
    ket_luc: datetime | None = None
    vat_tu: DenVatTuOut | None = None
    vat_tu_ve: date | None = None
    cum_id: int | None = None
    updated_at: datetime | None = None


class DemTabOut(BaseModel):
    ket: int = 0
    chua_hen: int = 0
    da_hen: int = 0
    da_day: int = 0


class DemLocOut(BaseModel):
    gap: int = 0
    thieu_vat_tu: int = 0
    sat_han: int = 0


class BanOut(BaseModel):
    dong: list[DongBanOut]
    tong: int
    dem_tab: DemTabOut
    # Đếm trong tab đang xem, TRƯỚC khi áp ba lọc nhanh.
    dem_loc: DemLocOut
    # `YYYY-MM-DD` → số lệnh hẹn đẩy ngày đó (theo bộ lọc). Ngày không có lệnh thì vắng mặt.
    dem_ngay: dict[str, int]


class HenIn(BaseModel):
    lsx_ids: list[int] = Field(min_length=1, max_length=500)
    hen_luc: datetime


class HenTheoLocIn(BaseModel):
    tab: str
    tu: date
    den: date
    tim: str | None = Field(default=None, max_length=100)
    gap: bool = False
    thieu_vat_tu: bool = False
    sat_han: bool = False
    hen_luc: datetime


class HenKqOut(BaseModel):
    ok: bool = True
    so_lenh: int


class DayNgayIn(BaseModel):
    lsx_ids: list[int] = Field(min_length=1, max_length=100)


class DayNgayLoiOut(BaseModel):
    ma: str
    ly_do: str


class DayNgayOut(BaseModel):
    da_day: list[str]
    loi: list[DayNgayLoiOut]
    # Gộp của mọi lệnh vừa đẩy: số yêu cầu xuất tự gửi kho + món chưa tự lập được (như /phat-hanh).
    vat_tu: dict = Field(default_factory=lambda: {"so_yeu_cau": 0, "bo_qua": []})


class LichSuHenOut(BaseModel):
    luc: datetime
    nguoi: str | None = None
    viec: str
    chi_tiet: str | None = None


class VatTuNganOut(BaseModel):
    ten: str
    can: float
    da_giu: float
    don_vi: str | None = None
    muc: str
    chu: str
    don_mua: str | None = None


class CongDoanNganOut(BaseModel):
    buoc: int
    ten: str
    bo_phan: str | None = None
    so_luong: float
    don_vi: str | None = None


class NganOut(BaseModel):
    dau: DongBanOut
    vat_tu: list[VatTuNganOut]
    cong_doan: list[CongDoanNganOut]
