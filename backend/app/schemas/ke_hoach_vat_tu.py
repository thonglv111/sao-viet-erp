"""Pydantic schemas — bảng CÂN ĐỐI vật tư của Kế hoạch sản xuất.

⚠️ KHÔNG có trường tiền nào ở đây, và đừng thêm. Bảng này mở cho vai Kế hoạch SX (`san_xuat`),
trong khi giá vốn lô hàng thuộc quyền Kho/Kế toán (`view_cost`). Phơi một cột giá "cho tiện" là mở
toàn bộ bảng giá vốn cho một vai chưa từng được cấp quyền đó — mà lỗi kiểu này không ai báo.
"""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class MuaKhacQuyCach(BaseModel):
    """Một yêu cầu/đơn "Mua cho" lệnh mà khác khổ hoặc ĐVT với nhu cầu (lỗi #23) — chỉ để gọi tên."""

    ma: str
    so_luong: float
    #: MÃ đơn vị trên dòng đơn — FE dịch bằng `nhanDonVi`.
    don_vi: str | None = None
    kho_rong: int = 0
    kho_dai: int = 0


class CanDoiDong(BaseModel):
    """1 dòng nhu cầu = 1 lệnh (hoặc 1 bài ghép) cần mặt hàng này vào một ngày."""

    #: `vat_tu` = có so tồn · `cong_cu` = khuôn bế, không so tồn (chỉ hỏi có sẵn sàng đúng lúc không).
    loai: str
    lsx_id: int | None = None
    bai_ghep_id: int | None = None
    buoc_id: int | None = None
    #: Mã lệnh / mã bài — thứ người dùng đọc.
    ma: str
    #: Tên sản phẩm của lệnh (hoặc tên bài ghép) — dòng nhóm lệnh ở lưới Kế hoạch vật tư.
    ten_sp: str | None = None
    #: Lệnh có cờ GẤP. CHỈ ĐỂ BÀY — máy không xếp ưu tiên, không cướp chỗ, không nhắc. Người lập kế
    #: hoạch nhìn cờ rồi tự quyết nhả chỗ của lệnh nào (chủ chốt 17/08/2026).
    is_rush: bool = False
    #: Tên bước tiêu thụ, để biết "cần cho khâu nào".
    ten_viec: str | None = None
    #: NGÀY CẦN HÀNG người lập gõ trên yêu cầu mua hàng đã lập cho lệnh/bài này (sớm nhất nếu có
    #: nhiều) — đọc ngược qua `yeu_cau_mua_nguon_lenh`, KHÔNG suy (18/09/2026). Chưa mua gì thì `None`.
    ngay_can: date | None = None
    #: Khách của lệnh (qua `orders.customer_id`). Dòng BÀI GHÉP gom nhiều lệnh: một khách thì là
    #: tên khách, nhiều khách thì là chuỗi `"3 khách"` — cố ý không bốc một tên làm đại diện.
    khach_ten: str | None = None
    #: Hạn giao KHÁCH (`lsx.han_giao_khach`), KHÁC hạn nội bộ `han_hoan_thanh_sx` mà bảng dùng để
    #: xếp thứ tự ăn tồn. Bài ghép lấy hạn sớm nhất trong các thành viên.
    han_giao_khach: date | None = None
    #: Hạn HOÀN THÀNH SX nội bộ — chính là thứ tự ăn tồn của bảng. Màn Tồn kho vẽ dự báo theo mốc này.
    han_sx: date | None = None

    #: Mọi số dưới đây theo ĐƠN VỊ GỐC của mặt hàng (kho đếm theo đơn vị đó). `None` ở dòng công cụ.
    nhu_cau: float | None = None
    #: Hai đơn vị cùng lúc: "2.961 tờ ≈ 116 kg" — kế hoạch nghĩ theo tờ, kho đếm theo đơn vị gốc.
    nhu_cau_hien_thi: str = ""
    da_cap: float | None = None
    #: CHỈ LÀ NHÃN — hàng chưa ra khỏi kho thì tồn vẫn còn, không vào phép trừ nào.
    dang_linh: float | None = None
    con_phai_co: float | None = None
    con_lai_sau: float | None = None
    #: Phần thiếu RIÊNG của dòng này (không phải thiếu luỹ kế) — tick nhiều dòng rồi cộng vẫn đúng.
    thieu: float | None = None

    #: xam | xanh | vang | do | **khong_ro**.
    #:
    #: `khong_ro` cố ý tách khỏi `xam`: xám nghĩa là "đã cấp đủ, hết việc phải lo", dán nhãn đó lên
    #: một dòng chưa ai tính nổi là nói ngược sự thật.
    trang_thai: str = "xam"
    #: [MỚI 30/08/2026] Giữ chỗ gộp theo (chủ thể, mặt hàng) của DÒNG này — KHÔNG phải phần riêng
    #: của dòng khi cùng chủ thể ăn cùng món ở nhiều bước (xem `GiuChoService.gan_giu_cho_vao_bang`).
    da_giu_kho: float | None = None
    da_giu_dang_ve: float | None = None
    co_the_giu_kho: float | None = None
    co_the_giu_dang_ve: float | None = None
    trang_thai_giu: str | None = None
    nguon_dang_ve: list[dict] | None = None
    canh_bao: list[str] = Field(default_factory=list)
    ly_do_canh_bao: str | None = None
    #: [MỚI 10/10/2026] Nhu cầu ra đơn vị mã CHƯA khai ở danh mục (cùng cờ của nhóm) — không lập
    #: mua được dòng này (`/de-nghi-mua` chặn 400).
    don_vi_chua_khai: bool = False
    #: [MỚI 18/10/2026] Yêu cầu/đơn "Mua cho" lệnh này mà KHÁC khổ/ĐVT với nhu cầu (lỗi #23).
    mua_khac_quy_cach: list[MuaKhacQuyCach] = Field(default_factory=list)


class PhieuMuaTom(BaseModel):
    """Một phiếu ĐANG CHẠY của mặt hàng — chỉ đủ để GỌI TÊN, không mang số lượng, không mang tiền.

    Trả lời câu *"cái nào đang yêu cầu mua"*: trước đó ba tình huống rất khác nhau (chưa ai mua ·
    đã đề nghị chờ duyệt · đã duyệt chưa hẹn ngày) đều vẽ ĐỎ giống hệt, nên người dùng bấm Mua
    chồng lên phiếu đã có.
    """

    #: Mã phiếu — `PMH-…` (phiếu mua của thu mua) hoặc `YCMH-…` (đề nghị của bộ phận).
    ma: str
    #: `pmh` | `ycmh`. Hai chuỗi khác nhau, tra ở hai màn khác nhau, nên phải phân biệt được.
    loai: str
    #: Trạng thái THÔ, FE tự dịch ra chữ (gửi chữ Việt sẵn thì hai đầu lệch nhau lúc thêm trạng
    #: thái mới). Với `pmh` là trạng thái của chính phiếu (`pending_approval`, `approved`…).
    #: Với `ycmh` là trạng thái của RIÊNG MÓN NÀY, không phải của yêu cầu cha — ngoài `open` còn
    #: hai giá trị chỉ tồn tại ở cấp món: `dang_lap_don` (thu mua đang gõ phiếu nháp cho nó) và
    #: `don_bi_tu_choi` (phiếu lập cho nó bị trả, đang chờ lập lại).
    trang_thai: str
    #: Ngày về NCC hẹn — chỉ PMH mới có, và cũng chỉ khi NCC đã chốt ngày.
    ngay_ve: date | None = None


class CungKhoKhacDonVi(BaseModel):
    """Tồn / hàng đang về của CÙNG mã + CÙNG khổ nhưng KHÁC đơn vị gốc với nhóm (vd nhóm đếm tờ, bên
    cạnh là kg) — chỉ để bày cạnh nhau, máy không trừ chéo (tờ và kg không quy đổi)."""

    don_vi_goc: str
    don_vi_goc_ten: str
    ton: float = 0
    dang_ve: float = 0


class CanDoiNhom(BaseModel):
    """Gom theo MẶT HÀNG: một khối = một thứ phải lo, các dòng bên trong là các lệnh giành nhau nó."""

    loai_nhom: str                   # vat_tu | cong_cu
    hang_loai: str
    hang_id: int
    hang_ma: str | None = None
    hang_ten: str | None = None
    #: Khổ giấy của nhóm (mm) — giấy so tồn theo (mã, khổ, đơn vị gốc), hai khổ là hai nhóm. Hàng
    #: khác 0 · 0.
    kho_rong: int = 0
    kho_dai: int = 0
    #: MÃ đơn vị gốc của nhóm. Giấy: phần thứ năm của khoá (`to` cho họ tờ, đơn vị giá của mã cho
    #: kg/tấn…) — cùng mã cùng khổ khác đơn vị gốc là hai nhóm. Vật tư khác (mg 0390): đơn vị đã
    #: khai mà nhóm của nó chứa ĐVT nhu cầu (kg / thùng là hai nhóm). Hàng khác: đơn vị giá của mã.
    don_vi_goc: str | None = None
    ton: float | None = None
    #: Giấy / vật tư: cùng mã + cùng khổ, KHÁC đơn vị gốc — bày cạnh `ton`, không trừ.
    cung_kho_khac_don_vi: list[CungKhoKhacDonVi] = Field(default_factory=list)
    #: [MỚI 10/10/2026] `don_vi_goc` của nhóm không thuộc nhóm đơn vị nào mã đã khai ở danh mục
    #: (nhu cầu tờ của giấy chỉ khai kg). Bảng báo `ly_do_chua_khai` thay nút lập mua.
    don_vi_chua_khai: bool = False
    #: "Chưa khai đơn vị “tờ” ở danh mục Giấy cho “C150”." — chỉ có khi `don_vi_chua_khai`.
    ly_do_chua_khai: str | None = None
    tong_can: float | None = None
    so_dong_do: int = 0
    #: Số dòng KHÔNG đánh giá được. Bộ lọc "chỉ mặt hàng đang thiếu" GIỮ LẠI nhóm có số này > 0 —
    #: thứ máy không tính nổi thì phải lo nhiều hơn, không phải ít hơn.
    so_dong_khong_ro: int = 0
    #: Chỉ nhóm công cụ mới có — tình trạng khuôn.
    khuon_tinh_trang: str | None = None
    #: Phiếu đang chạy của mặt hàng, xếp CHẮC → LỎNG (đã duyệt có ngày về đứng đầu). Treo ở nhóm
    #: chứ không ở dòng: phiếu mua không biết lệnh nào, nó chỉ biết mua món gì.
    phieu_mua: list[PhieuMuaTom] = Field(default_factory=list)
    dong: list[CanDoiDong] = Field(default_factory=list)


class CanDoiDem(BaseModel):
    """Số trên thanh tab của cách nhìn theo mặt hàng — đếm sau `q` + `hang_loai`, TRƯỚC
    `tinh_trang` (xem `KeHoachVatTuService.loc_hien_thi`). `theo_loai` đếm trước `hang_loai`."""

    so_nhom: int = 0
    so_dong_do: int = 0
    so_dong_khong_ro: int = 0
    so_nhom_du: int = 0
    theo_loai: dict[str, int] = Field(default_factory=dict)


class CanDoiOut(BaseModel):
    """`bo_qua` (danh sách lệnh/bài không cân đối được) GỠ 23/09/2026 — bảng chỉ cân đối thứ ĐÃ
    khai; chưa khai thì vắng mặt. Cửa chặn nằm ở xếp lịch, xem `_gom_nhu_cau`."""

    items: list[CanDoiNhom] = Field(default_factory=list)
    #: Cùng nghĩa `TheoLenhOut.so_giu_lau`, đếm trên TOÀN XƯỞNG (không theo `q`). Đi kèm ở đây để
    #: badge trên nút "Theo lệnh" khỏi phải gọi `/theo-lenh` — lời gọi đó dựng lại cả bảng cân đối.
    so_giu_lau: int = 0
    #: Số của thanh tab (06/10/2026). `None` ở đường nội bộ không qua router.
    dem: CanDoiDem | None = None


class DeNghiMuaDong(BaseModel):
    """Khoá của một dòng trên bảng — server tự tính lại số thiếu, client KHÔNG gửi số lượng.

    Cố ý không nhận `quantity`: client giữ bản chụp cũ, mà trong lúc người dùng ngồi nhìn bảng thì
    kho có thể đã cấp hoặc hàng đã về. Nhận số của client là đặt mua theo một sự thật đã hết hạn.
    """

    hang_loai: str = Field(pattern="^(giay|vat_tu)$")
    hang_id: int = Field(gt=0)
    #: Khổ của nhóm (giấy) — một phần của khoá; hàng khác gửi 0 · 0.
    kho_rong: int = Field(default=0, ge=0)
    kho_dai: int = Field(default=0, ge=0)
    #: Đơn vị gốc của nhóm (giấy) — phần thứ năm của khoá (10/10/2026). Gửi lại nguyên giá trị máy
    #: chủ phát; bỏ trống thì máy chủ tự dò khi mã + khổ + lệnh + bước chỉ có một đơn vị gốc.
    don_vi_goc: str = Field(default="", max_length=16)
    lsx_id: int | None = None
    bai_ghep_id: int | None = None
    #: Bước tiêu thụ — phần cuối của khoá. Client gửi lại đúng giá trị nhận được ở `CanDoiDong`.
    #: Thiếu nó thì hai dòng của cùng một lệnh (cùng món, hai công đoạn) tra ra cùng một chỗ và
    #: yêu cầu mua ra một nửa số cần.
    buoc_id: int | None = None


class DeNghiMuaNguon(DeNghiMuaDong):
    """Khoá dòng KÈM số đề nghị của dòng (đơn vị gốc) — xem-trước trả về, form gửi nguyên văn vào
    `nguon_lenh` lúc Lưu. Đơn mua lập từ yêu cầu chia "phần đặt cho lệnh" theo số này (mg 0378)."""

    so_luong: float | None = None


class TheoLenhHang(BaseModel):
    """Một MẶT HÀNG mà một lệnh/bài cần — đã gộp mọi công đoạn của lệnh đó."""

    hang_loai: str
    hang_id: int
    #: Khổ giấy (mm) — giữ chỗ khoá (mã, khổ, đơn vị gốc); hàng khác 0 · 0.
    kho_rong: int = 0
    kho_dai: int = 0
    hang_ma: str | None = None
    hang_ten: str | None = None
    #: Giấy: MÃ đơn vị gốc — phần thứ năm của khoá. Hàng khác: đơn vị giá của mã.
    don_vi_goc: str | None = None
    #: Theo ĐƠN VỊ GỐC. `can` = tổng `con_phai_co` của mọi bước (đã trừ phần kho cấp rồi).
    can: float = 0
    thieu: float = 0
    dang_giu: float = 0
    #: [MỚI 30/08/2026] Tách nguồn + trạng thái giữ 6 mức. Xem `GiuChoService.giu_theo_chu_the_hang`.
    da_giu_kho: float = 0
    da_giu_dang_ve: float = 0
    co_the_giu_kho: float = 0
    co_the_giu_dang_ve: float = 0
    trang_thai_giu: str = "xam"
    #: Mã PMH cụ thể đang góp cho phần `da_giu_dang_ve` (spec §4 "để FE hiện được đang bám đơn
    #: nào") — mỗi phần tử {"purchase_request_line_id": int, "ma_pmh": str|None, "so_luong": float}.
    nguon_dang_ve: list[dict] = Field(default_factory=list)
    #: Bao nhiêu công đoạn của lệnh này ăn món đó — >1 là lời nhắc rằng con số đã gộp.
    so_buoc: int = 0
    #: Màu NẶNG NHẤT trong các bước. Thẻ chỉ hiện được một màu, và phải là màu tệ nhất.
    trang_thai: str = "xam"
    #: Ngày cần hàng trên YCMH đã lập cho lệnh này mua món này (sớm nhất). Chưa mua ⇒ `None`.
    ngay_can: date | None = None
    #: MỌI phiếu đang chạy của món (kể cả YCMH chưa duyệt, kể cả PMH chưa hẹn ngày), xếp CHẮC →
    #: LỎNG — "ai đang lo món này".
    phieu_mua: list[PhieuMuaTom] = Field(default_factory=list)
    #: Bao nhiêu lệnh/bài KHÁC đang thiếu chính món này — câu *"nhả ra thì ai đỡ"* của hộp xác nhận.
    #:
    #: Tính trên TOÀN BỘ bảng, trước mọi bộ lọc: đếm sau bộ lọc thì màn đang lọc sẽ báo "0 lệnh
    #: khác đang thiếu" trong khi thật ra có ba, và người dùng quyết dựa trên con số do chính bộ
    #: lọc của họ tạo ra.
    so_lenh_khac_thieu: int = 0
    #: Khoá dòng của TỪNG dòng đỏ, để nút "Đề nghị mua" trên thẻ đi lại đúng cửa `/de-nghi-mua`.
    #: Cố ý không gộp: một lệnh ăn cùng món ở hai công đoạn là hai dòng, gộp là mua một nửa.
    khoa_do: list[DeNghiMuaDong] = Field(default_factory=list)


class TheoLenhRow(BaseModel):
    """Một thẻ = MỘT lệnh (hoặc bài ghép) — cách nhìn *"lệnh này chạy được chưa"*."""

    lsx_id: int | None = None
    bai_ghep_id: int | None = None
    ma: str
    is_rush: bool = False
    #: Ngày cần hàng SỚM NHẤT trên các YCMH đã lập cho lệnh này. Lệnh không phải mua (tồn đủ) ⇒ `None`.
    ngay_can: date | None = None
    #: Khách + hạn giao khách của lệnh — xem `CanDoiDong.khach_ten` / `.han_giao_khach`, thẻ lệnh
    #: chỉ nhặt lại giá trị đã có trên dòng chứ không tự tra thêm.
    khach_ten: str | None = None
    han_giao_khach: date | None = None
    #: Còn giữ chỗ nhưng ĐÃ RƠI khỏi bảng cân đối (lệnh bị kéo về nháp…). Chỗ giữ vẫn trừ vào tồn
    #: tự do của mọi người khác, nên phải bày ra để có đường nhả — không thì nó vô hình.
    ngoai_pham_vi: bool = False

    bat: bool = False
    #: Giữ đủ 100% ⇒ cửa xếp lịch mở. Đây là điều kiện DUY NHẤT của cửa đó.
    du: bool = False
    khong_ro: bool = False
    da_xep_lich: bool = False
    giu_tu: datetime | None = None
    so_ngay_giu: int | None = None
    #: Đã bật · đã giữ quá ngưỡng · mà chưa hề đưa vào kế hoạch. Máy CHỈ BÀY, không tự nhả.
    giu_lau_chua_chay: bool = False

    so_mat_hang: int = 0
    so_thieu: int = 0
    so_khong_ro: int = 0
    hang: list[TheoLenhHang] = Field(default_factory=list)


class TheoLenhOut(BaseModel):
    items: list[TheoLenhRow] = Field(default_factory=list)
    #: Đếm trên TOÀN BỘ danh sách, không phải phần đang lọc — nếu không thì bật bộ lọc là con số
    #: tự khớp với chính nó và chẳng còn nói lên điều gì.
    so_giu_lau: int = 0
    #: Số trên thanh tab (06/10/2026): đếm sau `q` + `chi_can_lo`, TRƯỚC `giu` — khoá `tat_ca`,
    #: `du`, `dang`, `tat`, `giu_lau`.
    dem_theo_tab: dict[str, int] = Field(default_factory=dict)


class GiuChoIn(BaseModel):
    """Đúng MỘT chủ thể. Router chặn cả-hai-cùng-trống và cả-hai-cùng-có."""

    lsx_id: int | None = None
    bai_ghep_id: int | None = None


class GiuChoNhieuIn(BaseModel):
    """Bật giữ chỗ hàng loạt — mỗi phần tử vẫn phải đúng MỘT chủ thể như `GiuChoIn`."""

    chu_the: list[GiuChoIn] = Field(min_length=1, max_length=200)


class GiuChoNhieuDong(BaseModel):
    lsx_id: int | None = None
    bai_ghep_id: int | None = None
    du: bool


class GiuChoNhieuOut(BaseModel):
    items: list[GiuChoNhieuDong]


class DeNghiMuaIn(BaseModel):
    dong: list[DeNghiMuaDong] = Field(min_length=1)
    ghi_chu: str | None = Field(default=None, max_length=2000)
    #: Chỉ cửa tạo thẳng (`POST /de-nghi-mua`) đọc — ngày cần hàng do người gõ, hệ không suy.
    needed_date: date | None = None


class DeNghiMuaDongOut(BaseModel):
    """Một dòng ĐÃ GỘP theo mặt hàng — đúng hình dạng ô vật tư của form Yêu cầu mua hàng."""

    hang_loai: str
    hang_id: int
    #: Khổ CẦN (giấy) — đổ vào dòng yêu cầu mua.
    kho_rong: int = 0
    kho_dai: int = 0
    item_name: str
    unit: str
    quantity: float


class DeNghiMuaXemTruocOut(BaseModel):
    """Bản NHÁP của yêu cầu mua — tính xong nhưng CHƯA GHI gì vào cơ sở dữ liệu.

    Vì sao có cửa này (20/08/2026, theo yêu cầu chủ): bấm "Đề nghị mua ngay" mà hệ tự đẻ luôn một
    yêu cầu rồi bảo "sang màn Mua hàng xem lại" là bắt người ta ký trước rồi mới được đọc. Cửa
    xem-trước trả về ĐÚNG những gì đường tạo thật sẽ dùng (số lượng gộp · nội dung · lệnh nguồn), FE
    đổ thẳng vào form "Tạo yêu cầu mua hàng" cho người dùng nhìn, sửa, rồi mới bấm Lưu.

    Dùng CHUNG `gom_de_nghi` với `POST /de-nghi-mua`, nên số ở form không thể lệch số hệ sẽ ghi —
    trừ đúng phần người dùng cố ý sửa tay.
    """

    #: Luôn `lsx` — giữ nguyên vết "yêu cầu này sinh từ lệnh sản xuất nào".
    related_document_type: str = "lsx"
    related_document_code: str
    #: Luôn `None` (18/09/2026): hệ KHÔNG suy ngày cần nữa — người lập tự gõ "Ngày cần hàng" trên
    #: form, và chính ngày đó quay về làm "Ngày cần" của lệnh trên Kế hoạch vật tư.
    needed_date: date | None = None
    #: Ô "Nội dung / mục đích" của form.
    noi_dung: str
    lines: list[DeNghiMuaDongOut]
    #: Khoá các dòng đã tick — form gửi lại nguyên văn lúc Lưu để yêu cầu nhớ mình mua cho lệnh nào.
    nguon: list[DeNghiMuaNguon] = Field(default_factory=list)


class DeNghiMuaOut(BaseModel):
    """Trả MÃ yêu cầu để FE mở lên xem — cố ý KHÔNG tự gửi đi thu mua.

    Máy ghi nhận, người quyết: kế hoạch xem lại số lượng, sửa được, rồi mới bấm gửi ở màn mua hàng.
    """

    id: int
    code: str


# ================== LƯỚI (spec một ô một phiếu §5, 07/10/2026) ==================


class LuoiPhieu(BaseModel):
    """Một mạch phiếu (yêu cầu → đơn) tóm tắt — xem `services/mach_mua.tom_tat`."""

    #: Mã hiện trên ô: mã đơn nếu đã có đơn sống, không thì mã yêu cầu.
    ma: str
    #: `pmh` | `ycmh` — `ma` là mã đơn hay mã yêu cầu.
    loai: str
    #: moi_de_nghi | don_bi_tra | dang_lap_don | cho_duyet | da_dat_hang | da_nhap_kho
    buoc: str
    ngay_ve: date | None = None
    yc_ma: str
    yc_id: int
    yc_line_id: int
    pr_id: int | None = None
    co_don: bool = False
    #: Huỷ được bằng nút "Huỷ phiếu" (huỷ món trên yêu cầu) — chỉ khi chưa đơn sống nào nắm món.
    co_the_huy: bool = False
    #: Chỉ có ở danh sách "phiếu nên huỷ".
    lap_cho: list[str] = Field(default_factory=list)
    ly_do: str | None = None
    #: Số phiếu đặt cho Ô này (đơn vị gốc) — chỉ có ở phiếu của dòng lưới.
    phan: float | None = None


class LuoiNgayCoHang(BaseModel):
    #: da_xuat | co_san | ngay_ve | hen | None
    loai: str | None = None
    ngay: date | None = None


class LuoiBuoc(BaseModel):
    buoc_id: int | None = None
    ten_viec: str | None = None
    can: float = 0
    da_xuat: float = 0
    thieu: float = 0


class LuoiDong(BaseModel):
    """MỘT Ô = lệnh/bài × mặt hàng (giấy thêm khổ), đã gộp mọi công đoạn."""

    khoa: str
    #: `l:<lsx_id>` | `b:<bai_ghep_id>`
    chu: str
    lsx_id: int | None = None
    bai_ghep_id: int | None = None
    ma: str
    #: Lệnh đã ra khỏi kế hoạch — cách xem theo mặt hàng ghi nhãn cạnh mã lệnh.
    ngoai_pham_vi: bool = False
    #: `<loai>:<id>:<rộng>:<dài>:<đơn vị gốc>` (giấy; hàng khác phần cuối rỗng)
    hang: str
    hang_loai: str
    hang_id: int
    kho_rong: int = 0
    kho_dai: int = 0
    #: MÃ đơn vị gốc của khoá (giấy `to` / đơn vị giá…; hàng khác ""). `dvt` là TÊN để hiện.
    don_vi_goc: str = ""
    hang_ma: str | None = None
    hang_ten: str
    dvt: str
    can: float
    da_xuat: float
    giu_kho: float
    giu_ve: float
    #: Đã xuất + đã giữ trong kho + đã giữ trên đơn đang về — cột "Đã có" trên lưới.
    da_giu: float
    con_thieu: float
    #: Số sẽ đề nghị mua nếu tick (phần thiếu theo bảng cân đối) — chỉ dòng "Cần mua".
    so_de_nghi: float = 0
    phieu: LuoiPhieu | None = None
    trung: list[LuoiPhieu] = Field(default_factory=list)
    #: Mã đơn mà ô đang giữ PHẦN DƯ trên đó ("dư từ …").
    du_tu: list[str] = Field(default_factory=list)
    ngay_co_hang: LuoiNgayCoHang
    #: chua_tinh | can_mua | nen_nha | dang_mua | chua_giu | cho_ve | co_kho | da_xuat
    tinh_trang: str
    ghi_chu: list[str] = Field(default_factory=list)
    buoc: list[LuoiBuoc] = Field(default_factory=list)
    #: Khoá dòng bảng cân đối để gửi `/de-nghi-mua/xem-truoc` — chỉ dòng "Cần mua" và đơn vị
    #: đã khai (`don_vi_chua_khai` ⇒ rỗng).
    khoa_mua: list[DeNghiMuaDong] = Field(default_factory=list)
    #: [MỚI 10/10/2026] Đơn vị của ô chưa khai ở danh mục — FE hiện `ly_do_chua_khai` thay nút mua.
    don_vi_chua_khai: bool = False
    ly_do_chua_khai: str | None = None
    #: [MỚI 18/10/2026] Xem `CanDoiDong.mua_khac_quy_cach` — có thì `khoa_mua` rỗng.
    mua_khac_quy_cach: list[MuaKhacQuyCach] = Field(default_factory=list)


class LuoiLichSu(BaseModel):
    luc: datetime | None = None
    chu: str


class LuoiLenh(BaseModel):
    chu: str
    lsx_id: int | None = None
    bai_ghep_id: int | None = None
    ma: str
    ten_sp: str | None = None
    khach_ten: str | None = None
    han_giao_khach: date | None = None
    is_rush: bool = False
    ngoai_pham_vi: bool = False
    #: Công tắc giữ chỗ của lệnh (`giu_cho_bat`).
    bat: bool = False
    lich_su: list[LuoiLichSu] = Field(default_factory=list)


class LuoiPhanO(BaseModel):
    ma: str
    so: float


class LuoiDon(BaseModel):
    """Một dòng đơn mua của mặt hàng — ngăn mặt hàng, tab Đơn mua."""

    ma: str | None = None
    buoc: str
    ngay_ve: date | None = None
    #: Đơn đã đặt: số CÒN ĐANG VỀ; đơn chưa đặt: số trên đơn.
    so: float
    dat_cho: list[LuoiPhanO] = Field(default_factory=list)
    du: float = 0
    giu_du: list[LuoiPhanO] = Field(default_factory=list)
    du_trong: float = 0
    #: Đơn đã đặt nhà cung cấp có ngày về — chỉ phần dư của đơn đó mới giữ được.
    da_dat: bool = True


class LuoiHang(BaseModel):
    hang: str
    hang_loai: str
    hang_id: int
    kho_rong: int = 0
    kho_dai: int = 0
    #: MÃ đơn vị gốc của khoá (xem `LuoiDong.don_vi_goc`).
    don_vi_goc: str = ""
    kho: str | None = None
    hang_ma: str | None = None
    hang_ten: str
    dvt: str
    ton: float = 0
    dang_ve: float = 0
    #: Giấy / vật tư: tồn / đang về cùng mã + cùng khổ, KHÁC đơn vị gốc — bày cạnh, không trừ.
    cung_kho_khac_don_vi: list[CungKhoKhacDonVi] = Field(default_factory=list)
    #: [MỚI 10/10/2026] Xem `LuoiDong.don_vi_chua_khai`.
    don_vi_chua_khai: bool = False
    ly_do_chua_khai: str | None = None
    can: float = 0
    da_giu: float = 0
    con_thieu: float = 0
    dat_du: float = 0
    don: list[LuoiDon] = Field(default_factory=list)
    nen_huy: list[LuoiPhieu] = Field(default_factory=list)
    ghi_chu: list[str] = Field(default_factory=list)
    lich_su: list[LuoiLichSu] = Field(default_factory=list)


class LuoiNhom(BaseModel):
    khoa: str
    lenh: LuoiLenh | None = None
    hang: LuoiHang | None = None
    dong: list[LuoiDong]


class LuoiOut(BaseModel):
    items: list[LuoiNhom]
    tong_nhom: int
    tong_dong: int
    page: int
    size: int
    #: Số dòng theo tình trạng — tính sau ô tìm + loại hàng, TRƯỚC tab tình trạng.
    dem: dict[str, int]


class LuoiLenhOut(BaseModel):
    lenh: LuoiLenh
    dong: list[LuoiDong]


class LuoiHangOut(BaseModel):
    hang: LuoiHang
    dong: list[LuoiDong]
