"""Schema Xếp lịch (cấp LỆNH SẢN XUẤT).

CẢNH BÁO đã dính một lần ở chỗ khác: `response_model` của Pydantic BỎ IM LẶNG mọi khoá service
trả về mà schema không khai — không lỗi, không log, FE chỉ nhận `undefined`. Thêm số nào thì phải
đi hết dây: dict của service → schema ở đây → type TS ở `api/xepLich3.ts`.
"""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class DoanChayOut(BaseModel):
    """Một đoạn máy chạy liền mạch — lớp đậm bên trong thanh Gantt."""

    tu: datetime
    den: datetime
    buoc_index: int


class DoanThucTeOut(BaseModel):
    """Một quãng lệnh THẬT SỰ chạy (theo phiên chạy của tổ), đã gộp phần các bước chồng giờ nhau."""

    tu: datetime
    den: datetime


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


class DongLichOut(_LichChung):
    """Một dòng trên bàn Gantt = MỘT lệnh sản xuất."""

    model_config = ConfigDict(from_attributes=True)

    lsx_id: int
    ma: str
    ten: str
    customer_name: str | None = None
    trang_thai: str
    is_rush: bool = False
    so_luong_dat: int = 0
    don_vi_tinh: str | None = None
    so_to_ke_hoach: int = 0
    so_con: int = 1
    han_hoan_thanh_sx: date | None = None
    han_giao_khach: date | None = None
    may_ten: str | None = None
    # Số bước chưa tính được giờ (thiếu máy / thiếu quy đổi) — nút lọc nhanh "có thể xong muộn".
    so_buoc_chua_gio: int = 0
    # Bước chạy đè vùng khoá máy / máy đang dừng chờ sửa — chỉ nhắc, không chặn.
    canh_bao_may: list[str] = Field(default_factory=list)
    # --- MÉP THANH của lệnh ĐÃ CHẠY DỞ (cả hai `None` khi lệnh chưa vào việc) ---
    # Thanh KHÔNG bắt đầu ở `bat_dau_at`: từ khi mốc đổi nghĩa thành "bắt đầu phần còn lại", mốc
    # nằm ở TƯƠNG LAI trong khi lệnh đã chạy từ trước. Vẽ từ mốc là nói lệnh chưa bắt đầu, ngược
    # hẳn với chính panel của nó. Màn vẽ:
    #     mép trái  = `thuc_bat_dau_lenh` ?? `bat_dau_at`
    #     mép phải  = `ket_thuc_thuc_te`  ?? `ket_thuc`
    #     đoạn `thuc_bat_dau_lenh` → `bat_dau_at` là phần ĐÃ CHẠY: khoá lại, không kéo được.
    # `bat_dau_at` vẫn là con số duy nhất kéo-thả ghi xuống, đừng đổi nghĩa nó.
    thuc_bat_dau_lenh: datetime | None = None
    ket_thuc_thuc_te: datetime | None = None
    # Các quãng CHẠY THẬT bên trong đoạn `thuc_bat_dau_lenh` → `bat_dau_at`. Cả đoạn đó là "đã vào
    # việc rồi NẰM CHỜ" chứ không phải đã chạy: lệnh chạy 13 phút hôm 09/09 rồi chờ tới 06:00 14/09
    # mà tô một tông "đã chạy" suốt 5 ngày thì bàn đang nói dối. Màn vẽ nền CHỜ cho cả đoạn rồi
    # chồng các quãng này lên.
    doan_thuc_te: list[DoanThucTeOut] = Field(default_factory=list)
    # Chỉ có ở phản hồi của PUT — cho băng thông báo biết mốc vừa bị dời.
    da_doi: bool | None = None
    thong_bao: str | None = None


class DemNhanhOut(BaseModel):
    """Số lệnh của ba nút lọc nhanh đầu màn (trên tập đã qua tìm + Lọc)."""

    tre: int = 0
    muon: int = 0
    chua: int = 0


class KhachLocOut(BaseModel):
    id: int
    ten: str
    so: int = 0


class ThuMocOut(BaseModel):
    """Xem trước lúc kéo — thả ở mốc này thì bắt đầu / xong lúc nào. Không ghi gì."""

    bat_dau: datetime
    ket_thuc: datetime
    da_doi: bool = False
    cho_phut: float = 0.0


class LichOut(BaseModel):
    dem: DemNhanhOut = Field(default_factory=DemNhanhOut)
    khach_loc: list[KhachLocOut] = Field(default_factory=list)
    dong: list[DongLichOut] = Field(default_factory=list)
    tong: int = 0
    # Ngày KHÔNG làm việc trong đúng cửa sổ đang xem — lễ, ngày làm bù, cấu hình tuần của xưởng.
    # FE ĐỪNG tự suy "T7 + CN": xưởng này khai `works_sat = true` nên đoán kiểu đó tô sai ngay
    # thứ 7 đầu tiên, còn lễ và làm bù thì không có cách nào đoán.
    ngay_nghi: list[date] = Field(default_factory=list)
    # Ngày khai ở Lịch làm việc trong cửa sổ — trục ghi tên lễ, tô làm bù (mục 6 mockup).
    ngay_dac_biet: list[NgayDacBietOut] = Field(default_factory=list)
    # Ca xưởng — đầu màn ghi giờ ca.
    cac_ca: list[CaXuongOut] = Field(default_factory=list)
    # Cụm của các dòng đang hiện — hàng tiêu đề cụm.
    cum: list[CumOut] = Field(default_factory=list)


class NgayDacBietOut(BaseModel):
    """Một ngày khai ở Lịch làm việc. `loai`: `off` nghỉ lễ · `work` làm bù · `off1x` nghỉ khác."""

    ngay: date
    loai: str
    ten: str | None = None


class TheHangChoOut(BaseModel):
    lsx_id: int
    ma: str
    ten: str
    customer_name: str | None = None
    han_hoan_thanh_sx: date | None = None
    han_giao_khach: date | None = None
    is_rush: bool = False
    so_to_ke_hoach: int = 0
    so_luong_dat: int = 0
    don_vi_tinh: str | None = None
    chay_phut: float = 0.0
    so_buoc: int = 0
    #: Ngày tạo lệnh — hiện trên thẻ hàng chờ (06/10/2026).
    created_at: datetime | None = None


class HangChoOut(BaseModel):
    dong: list[TheHangChoOut] = Field(default_factory=list)
    tong: int = 0


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
    han_hoan_thanh_sx: date | None = None
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


class DatMocIn(BaseModel):
    bat_dau_at: datetime
    # Chốt chống ghi đè: mốc `updated_at` mà màn đang cầm. Bỏ trống = đặt lần đầu (kéo từ hàng
    # chờ) — không có gì để so, và KHÔNG được đòi.
    expected_updated_at: datetime | None = None


class PhatHanhCapNhatIn(BaseModel):
    """Lý do đẩy lịch mới xuống xưởng. BẮT BUỘC — tổ đang cầm giấy in lịch cũ, đổi ngầm là mất vết.

    Ngưỡng 3 ký tự khớp `release_update.phat_hanh_cap_nhat`; service màn 3 chặn trước để ra 400
    kèm câu của màn, thay vì `ValueError` chung với "không còn gì để cập nhật".
    """

    ly_do: str = Field(..., max_length=500)


LichOut.model_rebuild()


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
