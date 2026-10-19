"""Kế hoạch vật tư — bảng CÂN ĐỐI: *cần bao nhiêu · có bao nhiêu · thiếu bao nhiêu · bao giờ phải đặt*.

Hệ đã tính ngược ra nhu cầu từng bước (lệnh hộp 10.000 cái → 2.961 tờ nguyên), kho đã có sổ lô và
tồn theo mặt hàng gốc, thu mua đã có yêu cầu mua + ngày về dự kiến — nhưng ba khối đó không nhìn
thấy nhau. File này là chỗ chúng gặp nhau, và **chỉ đọc**: không khoá lô, không giữ chỗ vật lý,
không lĩnh hộ ai. "Giữ chỗ" ở đây chỉ là THỨ TỰ TRONG BẢNG theo hạn sản xuất — lệnh nào phải xong
trước thì được tính trước, lệnh sau nhìn phần còn lại.

Bốn giai đoạn của `can_doi()`:
  (a) gom dòng nhu cầu (giấy của lệnh chưa ghép · giấy của bài ghép · vật tư khai tay · khuôn bế),
  (b) đọc NGÀY CẦN của từng dòng từ yêu cầu mua hàng đã lập cho lệnh đó — KHÔNG suy,
  (c) quy mọi thứ về ĐƠN VỊ GỐC của mặt hàng (kho đếm theo đơn vị đó),
  (d) chạy con trỏ tồn theo hạn sản xuất cho từng mặt hàng.

⚠️ HAI BẪY ĐẾM HAI LẦN — sai chỗ này là đi mua giấy thừa mà không ai phát hiện:

1. **Đã cấp**: kho xuất rồi thì `stock_lots.sl_con_lai` ĐÃ GIẢM, tức tồn đã phản ánh. Phần đã cấp
   vì thế chỉ được trừ vào NHU CẦU, TUYỆT ĐỐI không trừ thêm lần nữa vào tồn.
2. **"Đang mua" chính là "hàng đang về"** — cùng một lô hàng, một cái tên khác. Chỉ cộng MỘT lần,
   ở dòng cộng hàng đang về. Không có thêm phép trừ "đang mua" nào khỏi nhu cầu.

Và một cái bẫy ngược lại: *đang lĩnh* (đề nghị kho đã lập, kho CHƯA ghi sổ) chỉ được hiện làm NHÃN.
Hàng chưa ra khỏi kho thì tồn vẫn còn — trừ nó là trừ một thứ chưa xảy ra.

Mọi số ở đây DẪN XUẤT, tính lúc đọc, không lưu bảng nào.
"""
from __future__ import annotations

import math
from contextlib import contextmanager
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.bai_ghep import BaiGhep
from ..models.bai_ghep_cong_doan import BaiGhepCongDoan
from ..models.customer import Customer
from ..models.order import Order
from ..models.lsx import (
    TT_DA_LAP_KE_HOACH,
    TT_DA_PHAT_HANH,
    TT_SAN_SANG,
    Lsx,
)
from ..models.purchase import (
    DPR_IN_PURCHASE,
    DPR_OPEN,
    DPR_PENDING_APPROVAL,
    PR_DRAFT,
    PR_PENDING,
)
from ..models.stock_request import REQ_DONE
from ..models.vat_lieu_kho import HANG_GIAY
from ..repositories.ke_hoach_vat_tu_repo import KeHoachVatTuRepository
from ..repositories.purchase_repo import DepartmentPurchaseRequestRepository
from .bien_cong_thuc import quy_cach_bien_bai
from .mach_mua import dung_mach as _dung_mach
from .kho_giay import (
    GocMatHang,
    co_don_vi_goc,
    don_vi_khai,
    chuan_kho,
    don_vi_goc_to,
    dong_giay_theo_dau_vao,
    goi_y_dong_giay,
    khoa_ton,
    khoa_ton_cua,
    la_ma_to_giay,
)
from .quy_doi_service import _so, cap_map, doi, don_vi_map
from .stock_request_service import StockRequestService

# Lệnh ở ba trạng thái này là thứ kế hoạch phải lo giấy: đã chốt kỹ thuật, chỉ còn chờ chạy.
# `nhap`/`cho_bo_sung` chưa chốt quy cách nên số tờ còn xê dịch — đưa vào bảng là mua theo số sắp đổi.
TRANG_THAI_TINH = (TT_SAN_SANG, TT_DA_LAP_KE_HOACH, TT_DA_PHAT_HANH)

MAU_XAM, MAU_XANH, MAU_VANG, MAU_DO = "xam", "xanh", "vang", "do"
# Trạng thái THỨ NĂM: dòng KHÔNG ĐÁNH GIÁ ĐƯỢC (thiếu đường quy đổi đơn vị).
#
# Vì sao không gộp vào `xam`: xám nghĩa là "đã cấp đủ, hết việc phải lo" — mạnh hơn cả "đủ". Dòng
# hệ thống không tính nổi mà đeo nhãn đó là nói ngược sự thật, và tệ hơn: nó rơi khỏi bộ lọc "chỉ
# mặt hàng đang thiếu", tức biến mất đúng lúc người ta đi tìm việc phải lo.
MAU_KHONG_RO = "khong_ro"
# Cờ cảnh báo trên dòng — tập MỞ, phía FE chỉ cần biết dòng có cảnh báo thì tô nhạt + hiện tooltip.
CB_KHONG_DOI_CHIEU = "khong_doi_chieu_duoc"
# Dòng GIẤY chưa có đủ hai cạnh khổ — giấy tờ so tồn theo (mã, khổ), thiếu khổ thì không biết so với
# lô nào. Cùng nhóm "không đánh giá được" với cờ trên, chỉ khác câu hướng dẫn.
CB_GIAY_CHUA_KHO = "giay_chua_kho"

# NGÀY CẦN KHÔNG SUY (18/09/2026, chủ chốt): trước đây hệ tự tính "giờ bắt đầu bước − 2 tiếng",
# lệnh chưa xếp thì "hạn SX − thời gian dẫn", rồi còn chặn đề nghị mua / không cộng hàng về sau
# ngày đó. Nay ngày cần CHỈ là "Ngày cần hàng" người lập gõ trên yêu cầu mua hàng, đọc ngược qua
# `yeu_cau_mua_nguon_lenh`; lệnh không phải mua thì để trống, và không có gì bị chặn theo ngày.


class KeHoachVatTuError(Exception):
    pass


class KeHoachVatTuValidationError(KeHoachVatTuError):
    pass


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


# HAI TRẠNG THÁI CHIP CHỈ CÓ Ở CẤP MÓN — không phải trạng thái của phiếu nào cả.
#
# Chủ chốt 24/08/2026 (*"đọc thì phải hiển thị lên ui chứ"*): món đã đi qua thu mua rồi mà hỏng
# giữa chừng thì KHÔNG được nói "mới đề nghị". `YCMH-260820-JI8X` là ca thật: thu mua đã lập
# `PMH-260820-YC1U` cho đúng món Couché 300 đó, phiếu bị TỪ CHỐI, việc đang đứng chờ người lập lại
# — mà chip vẫn báo "mới đề nghị", người lập kế hoạch tưởng chỉ cần chờ.
#
# Phải đặt tên riêng chứ không mượn trạng thái PMH: chip mang mã YCMH, dán chữ "rejected" lên đó
# là người đọc tưởng CHÍNH YÊU CẦU bị từ chối.
VET_DANG_LAP_DON = "dang_lap_don"
VET_DON_BI_TU_CHOI = "don_bi_tu_choi"


def _xep_vet(v: dict) -> int:
    """Thứ tự CHẮC → LỎNG của một vết mua. Chip vật tư chỉ đủ chỗ MỘT dòng nên nó lấy phần tử đầu;
    thứ tự này quyết định người dùng đọc được câu nào trước.

    Phiếu đã duyệt kèm ngày về là lời hứa chắc nhất (*"1/9 có hàng"*); YCMH vừa lập là lỏng nhất
    (*"đã có người đề nghị, chưa ai duyệt"*). Xếp ngược lại thì chip báo "mới đề nghị" trong khi
    hàng đã nằm trên xe — đúng kiểu tin xấu che mất tin tốt.
    """
    if v.get("loai") == "pmh":
        if v.get("trang_thai") == PR_PENDING:
            return 2
        return 0 if v.get("ngay_ve") else 1
    # `don_bi_tu_choi` xếp CUỐI đúng theo luật chắc→lỏng: nó là món đang kẹt, chưa ai hứa gì.
    # Đẩy nó lên đầu thì một mặt hàng vừa có hàng về 30/8 vừa có món kẹt sẽ khoe cái kẹt trước —
    # tin xấu che mất tin tốt, đúng cái docstring trên vừa cấm.
    return {
        DPR_IN_PURCHASE: 3,
        VET_DANG_LAP_DON: 3,
        DPR_PENDING_APPROVAL: 4,
        VET_DON_BI_TU_CHOI: 6,
    }.get(v.get("trang_thai"), 5)


def _gop_ma(mas: list[str], toi_da: int = 64) -> str:
    """Mã các lệnh nguồn cho ô chứng từ liên quan (String(64)) — hết chỗ thì ghi "+n" số lệnh còn
    lại, không cắt im lặng: gộp 8 lệnh mà ô chỉ hiện 5 là người đọc tưởng yêu cầu mua cho 5 lệnh.
    Danh sách đủ vẫn nằm ở `nguon`."""
    ra = ""
    for i, ma in enumerate(mas):
        thu = f"{ra}, {ma}" if ra else ma
        con = len(mas) - i - 1
        if len(thu) + (len(f" +{con}") if con else 0) > toi_da:
            return f"{ra} +{len(mas) - i}" if ra else ma[:toi_da]
        ra = thu
    return ra


def _khoa_dong(hang_loai, hang_id, kho_rong, kho_dai, goc, d: dict) -> tuple:
    """KHOÁ nhận dạng MỘT dòng của bảng cân đối — hợp đồng giữa bảng và nút "Đề nghị mua".

    TÁM phần tử (10/10/2026 thêm ĐƠN VỊ GỐC sau khổ): giấy bỏ dạng cuộn/tờ, cùng mã cùng khổ mà một
    bên đếm tờ một bên đếm kg là hai nhóm, hai dòng. Client gửi lại nguyên `khoa_mua`/`khoa_do` máy
    chủ phát ra (đã mang `don_vi_goc`); client cũ không gửi thì `gom_de_nghi` tự dò (xem đó). Khổ là
    một phần của khoá: cùng lệnh, cùng bước, cùng mã giấy mà hai khổ là hai dòng (giấy mặt + giấy
    đáy cùng mã). Vật tư khác cũng mang đơn vị gốc (mg 0390): keo kg và keo thùng là hai dòng.
    """
    return (hang_loai, hang_id, int(kho_rong or 0), int(kho_dai or 0),
            (goc or "") if co_don_vi_goc(hang_loai) else "",
            d.get("lsx_id"), d.get("bai_ghep_id"), d.get("buoc_id"))


def _khoa5(k) -> tuple:
    """Khoá tồn 5 phần tử `(loai, id, rộng, dài, đơn vị gốc)` từ cặp `(loai, id)` / khoá 4 phần cũ /
    khoá 5 phần sẵn có — thiếu phần nào thì phần đó rỗng (khổ 0 · 0, gốc "")."""
    k = tuple(k)
    if len(k) >= 5:
        return khoa_ton(k[0], int(k[1]), goc=k[4], kho_rong=k[2], kho_dai=k[3])
    if len(k) == 4:
        return khoa_ton(k[0], int(k[1]), kho_rong=k[2], kho_dai=k[3])
    return khoa_ton(k[0], int(k[1]))


def _giay_chua_kho(hang: tuple, dv_to: str) -> bool:
    """Dòng giấy chưa đủ khổ để so tồn: đếm tờ cần đủ HAI cạnh (tờ nào khác tờ nào là do khổ);
    đơn vị khác (kg, tấn…) cần ít nhất khổ RỘNG — khổ chỉ-rộng `(r, 0)` là khổ của giấy khổ rộng."""
    if hang[4] == dv_to:
        return not (hang[2] and hang[3])
    return not hang[2]


def phan_cua_phan_doan(tong: float, so_vao: list[float], vi_tri: int) -> float:
    """Phần của phân đoạn `vi_tri` trong `tong`, chia theo số vào của từng phân đoạn (chưa khai số
    vào thì chia đều). Phân đoạn cuối nhận số dư để cộng lại đúng bằng `tong`."""
    n = len(so_vao)
    if n <= 1:
        return tong
    cong = sum(max(float(x or 0), 0.0) for x in so_vao)
    ty_le = [max(float(x or 0), 0.0) / cong for x in so_vao] if cong > 0 else [1 / n] * n
    if vi_tri == n - 1:
        return tong - sum(round(tong * t, 4) for t in ty_le[:-1])
    return round(tong * ty_le[vi_tri], 4)


class KeHoachVatTuService:
    """Bảng cân đối vật tư. CHỈ ĐỌC — không có đường nào từ đây ghi vào kho.

    Nhận sẵn service/repo từ router (`get_service(db)`), không tự dựng: cùng lối
    `routers/kho_request.py`, và nhờ vậy test bơm được bản giả cho từng nguồn số liệu.
    """

    def __init__(
        self,
        db: Session,
        *,
        lsx_repo,
        bai_ghep_repo,
        hang,
        lots,
        requests,
        purchases,
        suppliers,
        don_vi,
        repo=None,
        dpr=None,
    ) -> None:
        self.db = db
        # Repo RIÊNG của bảng cân đối — mọi truy vấn của màn này đi qua đây, service thôi tự
        # `db.execute`. Mặc định tự dựng để chỗ gọi cũ không phải sửa; test bơm bản giả được.
        self.repo = repo or KeHoachVatTuRepository(db)
        self.lsx_repo = lsx_repo
        self.bai_ghep_repo = bai_ghep_repo
        self.hang = hang                # VatLieuKhoService — danh mục gốc + quy đổi
        self.lots = lots                # StockLotRepository
        self.requests = requests        # StockRequestRepository
        self.purchases = purchases      # PurchaseRequestRepository
        # YCMH của bộ phận — chỉ để bảng NÓI ĐƯỢC "đã có ai đề nghị mua món này chưa". Tự dựng
        # như `repo` ở trên để chỗ gọi cũ khỏi phải sửa; test bơm bản giả được.
        self.dpr = dpr or DepartmentPurchaseRequestRepository(db)
        self.suppliers = suppliers      # SupplierRepository
        self.don_vi = don_vi            # DonViDoRepository
        # Bản nhớ phiếu mua của MỘT lượt đọc (`nho_phieu_mua`) — None = đọc thẳng repo mỗi lần.
        self._nho: dict | None = None

    @contextmanager
    def nho_phieu_mua(self):
        """Trong khối này mỗi danh sách phiếu mua/YCMH chỉ đọc DB MỘT lần.

        Một lượt dựng bảng cân đối + gắn giữ chỗ + dự báo tồn gọi `_hang_dang_ve` và
        `_vet_mua_theo_hang` ở ba chỗ khác nhau; mỗi lần là nạp lại nguyên phiếu kèm dòng + đợt giao
        (đo 07/10/2026: `/lo/du-bao` lúc nguội đọc `dong_dang_ve` 4 lần). Chỉ bật cho đường ĐỌC —
        đường ghi (`doi_soat_dang_ve`) cần số tươi sau khi vừa nhận hàng nên không bọc khối này.
        Lồng nhau thì khối ngoài giữ bản nhớ."""
        if self._nho is not None:
            yield
            return
        self._nho = {}
        try:
            yield
        finally:
            self._nho = None

    def _doc(self, ten: str, fn):
        if self._nho is None:
            return fn()
        if ten not in self._nho:
            self._nho[ten] = list(fn())
        return self._nho[ten]

    # ================== (c) QUY VỀ ĐƠN VỊ GỐC ==================

    def _nap_don_vi(self) -> None:
        """Nạp danh mục đơn vị + bảng cặp MỘT lần cho cả bảng (không N+1 theo dòng)."""
        # `all_rows`: bảng tra để QUY VỀ ĐƠN VỊ GỐC cho kế hoạch đã lập. Đơn vị ngừng dùng mà lọc
        # ở đây thì dòng vật tư cũ mất đường quy đổi, số về 0 trong im lặng.
        self._dvs = don_vi_map(self.don_vi.all_rows())
        self._cap_rows = list(self.don_vi.cap_rows())
        # Đồ thị cặp quy đổi dựng SẴN một lần cho cả bảng. Trước 18/08/2026 chỗ này đi qua
        # `doi_theo_quy_cach`, mà hàm đó gọi `cap_map(...)` — dựng LẠI nguyên đồ thị — ở MỖI dòng.
        # Bảng cân đối có bao nhiêu dòng thì đồ thị dựng lại bấy nhiêu lần, trong khi bảng cặp là
        # danh mục dùng chung, không đổi giữa hai dòng. Đo hồ sơ 300 lệnh: 30% thời gian `can_doi`
        # rơi vào `_quy_doi_dong` mà phần lớn là dựng lại đồ thị này.
        self._cap = cap_map(self._cap_rows)
        self._dv_to_cache = None
        # Hệ số theo CẶP (từ, về) — xem `_he_so`. Xoá cùng lúc với danh mục đơn vị vừa nạp lại.
        self._he_so_cache: dict[tuple[str, str], dict] = {}
        self._gg = None

    def _dv_to(self) -> str:
        """MÃ đơn vị đếm giấy TỜ ở kho / mua hàng (`to`) — nhớ một lần cho cả bảng."""
        if getattr(self, "_dv_to_cache", None) is None:
            self._dv_to_cache = don_vi_goc_to()
        return self._dv_to_cache

    def _obj(self, hang):
        """Bản ghi danh mục của mặt hàng — `_objs` khoá theo CẶP mã, khổ không đổi danh mục."""
        return getattr(self, "_objs", {}).get((hang[0], int(hang[1])))

    def _goc_giay(self) -> GocMatHang:
        """Bộ suy đơn vị gốc dòng giấy / vật tư — dựng trên bảng đơn vị ĐÃ nạp, một lần cho cả lượt."""
        if getattr(self, "_gg", None) is None:
            if not hasattr(self, "_dvs"):
                self._nap_don_vi()
            self._gg = GocMatHang(self._dvs, self._cap_rows)
        return self._gg

    def _goc_cua(self, hang_loai: str, hang_id: int, dvt: str | None) -> str:
        """ĐƠN VỊ GỐC của một dòng giấy / vật tư suy từ ĐVT dòng (`kho_giay.GocMatHang`): đơn vị đã
        khai mà nhóm của nó chứa ĐVT; ĐVT chưa khai ⇒ chính ĐVT (nhóm đó mang `don_vi_chua_khai`).
        Hàng khác ⇒ "" (khoá không mang gốc). Cần `_objs` đã nạp mã này."""
        if not co_don_vi_goc(hang_loai):
            return ""
        obj = self._obj((hang_loai, hang_id))
        goc = self._goc_giay().goc(dvt, don_vi_khai(obj) if obj is not None else [])
        if goc:
            return goc
        # Đơn vị chưa khai ⇒ giữ chính mã ĐVT làm khoá riêng (không gộp nhầm vào nhóm khác); mã
        # chặng tờ của lệnh (`to_nguyen`) vẫn là tờ của kho.
        m = (dvt or "").strip().lower()
        return self._dv_to() if hang_loai == HANG_GIAY and la_ma_to_giay(m) else m

    def _chua_khai(self, hang: tuple) -> bool:
        """Đơn vị gốc của khoá KHÔNG thuộc nhóm nào mã đã khai ở danh mục (vd. nhu cầu tờ của mã giấy
        chỉ khai kg) — bảng báo ngay ở dòng đó và không cho lập mua (spec 2026-10-10 §3)."""
        if not co_don_vi_goc(hang[0]) or len(hang) < 5 or not hang[4]:
            return False
        obj = self._obj(hang)
        khai = don_vi_khai(obj) if obj is not None else []
        return bool(khai) and self._goc_giay().goc(hang[4], khai) is None

    def cau_chua_khai(self, hang: tuple) -> str:
        """Câu "Chưa khai đơn vị “tờ” ở danh mục Giấy cho “C150”." của nhóm `_chua_khai`."""
        goc = hang[4] if len(hang) >= 5 else ""
        ten_dv = (getattr(self, "_dvs", {}).get(goc) or {}).get("ten") or goc
        obj = self._obj(hang)
        dm = "Giấy" if hang[0] == HANG_GIAY else "Vật tư khác"
        ten = f" cho “{obj.ten}”" if obj is not None else ""
        return f"Chưa khai đơn vị “{ten_dv}” ở danh mục {dm}{ten}."

    def _khoa_mua(self, ln) -> tuple:
        """Khoá tồn của một dòng đơn mua / yêu cầu mua: mã + khổ MUA + đơn vị gốc của `unit` dòng —
        mua 5 tấn giấy không bù cho nhu cầu tờ cùng khổ. Hàng khác giấy `(…, 0, 0, "")`."""
        loai, hid = ln.hang_loai, int(ln.hang_id)
        return khoa_ton(loai, hid, goc=self._goc_cua(loai, hid, getattr(ln, "unit", None)),
                        kho_rong=getattr(ln, "kho_rong", 0) or 0,
                        kho_dai=getattr(ln, "kho_dai", 0) or 0)

    def _ve_goc(self, hang: tuple, dvt: str, so_luong: float, *, goc: str | None = None) -> dict:
        """Quy `so_luong` từ `dvt` về ĐƠN VỊ GỐC của dòng. Trả `{sl, don_vi_goc, don_vi_goc_ten,
        hien_thi}` hoặc `{loi}`.

        GIẤY không còn dạng cuộn/tờ (10/10/2026): gốc là phần thứ năm của khoá (`goc` ép thì theo
        `goc`; khoá chưa mang gốc thì suy từ `dvt`). Gốc `to` ⇒ đếm "tờ" (mã chặng tờ của lệnh quy
        về hệ số 1 — tờ nào khác tờ nào là do khổ); gốc khác ⇒ họ của nó (kg ↔ tấn). Tờ và kg KHÔNG
        quy đổi: dòng ghi kg mà khoá đếm tờ rơi vào "không đối chiếu được". VẬT TƯ KHÁC khai nhiều
        đơn vị (mg 0390) cũng lấy gốc ở phần thứ năm của khoá (kg / thùng). Hàng khác: `don_vi_gia`.
        """
        obj = self._obj(hang)
        if obj is None:
            return {"loi": "Mặt hàng không còn trong danh mục."}
        giay = hang[0] == HANG_GIAY
        # Vật tư chưa khai ĐVT nào ⇒ nhánh dưới báo "chưa chọn đơn vị tính" như cũ.
        if co_don_vi_goc(hang[0]) and (giay or don_vi_khai(obj)):
            goc = (goc or (hang[4] if len(hang) >= 5 else "") or "").strip().lower()
            if not goc:
                goc = self._goc_cua(hang[0], int(hang[1]), dvt)
            if giay and goc == self._dv_to() and la_ma_to_giay(dvt):
                # Mã chặng tờ của lệnh (`to_nguyen` / `to`) và đơn vị kho `to` là MỘT tờ, hệ số 1
                # — tờ nào khác tờ nào là do khổ, không do đơn vị (chủ chốt 07/10/2026).
                goc_ten = (self._dvs.get(goc) or {}).get("ten") or "tờ"
                sl = _f(so_luong)
                return {"sl": sl, "don_vi_goc": goc, "don_vi_goc_ten": goc_ten,
                        "hien_thi": f"{_so(so_luong)} {goc_ten}"}
        else:
            goc = (getattr(obj, "don_vi_gia", None) or "").strip()
        if not goc:
            return {"loi": f"“{obj.ten}” chưa chọn đơn vị tính ở danh mục."}
        hs = self._he_so(dvt, goc)
        if "loi" in hs:
            if giay:
                ten_goc = (self._dvs.get(goc.lower()) or {}).get("ten") or goc
                return {"loi": f"Dòng giấy ghi theo “{dvt}” — không đổi được về {ten_goc} (tờ và "
                               "kg không quy đổi), sửa ở bước của lệnh."}
            return {"loi": hs["loi"]}
        gia_tri = _f(so_luong) * hs["he_so"]
        goc_ten, dvt_ten = hs["goc_ten"], hs["dvt_ten"]
        # Hai đơn vị cùng lúc: kế hoạch NGHĨ theo đơn vị của dòng, kho ĐẾM theo đơn vị gốc. Hiện một
        # cái thôi là một trong hai bên phải nhẩm trong đầu, mà nhẩm thì sai.
        hien_thi = (
            f"{_so(so_luong)} {dvt_ten}"
            if dvt_ten == goc_ten
            else f"{_so(so_luong)} {dvt_ten} ≈ {_so(gia_tri)} {goc_ten}"
        )
        return {"sl": float(gia_tri), "don_vi_goc": goc, "don_vi_goc_ten": goc_ten,
                "hien_thi": hien_thi}

    def _he_so(self, dvt: str, goc: str) -> dict:
        """`{he_so, goc_ten, dvt_ten}` hoặc `{loi}` của cặp `dvt → goc` — NHỚ theo cặp.

        Phép đổi theo cặp là TUYẾN TÍNH (`doi` = số × tích hệ số dọc đường, hoặc giữ nguyên khi
        cùng đơn vị), nên hỏi engine MỘT lần với 1 rồi nhân là ra đúng từng bit như gọi cho từng
        dòng. Bảng cân đối có hàng nghìn dòng mà chỉ vài chục cặp đơn vị; gọi `doi` mỗi dòng là tìm
        đường + dựng chuỗi diễn giải hàng nghìn lần để vứt (đo 30/09/2026: ~0,4s / 10 nghìn dòng).
        `doi` thẳng thay cho `doi_theo_quy_cach`: hàm kia chỉ làm thêm đúng hai việc — bỏ `qc`
        (đã hết dùng từ 14/08/2026) và dựng `cap_map`, thứ nay đã có sẵn ở `self._cap`.
        """
        khoa = ((dvt or "").strip().lower(), goc)
        nho = getattr(self, "_he_so_cache", None)
        if nho is None:
            nho = self._he_so_cache = {}
        kq = nho.get(khoa)
        if kq is None:
            mot = doi(1.0, dvt, goc, self._dvs, self._cap)
            if "gia_tri" not in mot:
                kq = {"loi": mot.get("ly_do") or "Không đổi được đơn vị."}
            else:
                kq = {
                    "he_so": float(mot["gia_tri"]),
                    "goc_ten": (self._dvs.get(goc.lower()) or {}).get("ten") or goc,
                    "dvt_ten": (self._dvs.get(khoa[0]) or {}).get("ten") or dvt,
                }
            nho[khoa] = kq
        return kq

    # ================== (a) GOM DÒNG NHU CẦU ==================

    def _lenh_trong_pham_vi(
        self, include_lsx_ids: set[int] | None = None, *, chi_lsx_ids: set[int] | None = None
    ) -> list[Lsx]:
        # `chi_lsx_ids` = hỏi ĐÍCH DANH, không kèm `trang_thai IN TRANG_THAI_TINH`: người gọi đã
        # tự chọn tập lệnh (đúng trang đang hiện), lọc thêm trạng thái ở đây chỉ làm đèn của lệnh
        # nháp im lặng biến mất. Xem docstring `can_doi` cho ranh giới hai phạm vi.
        if chi_lsx_ids:
            return self.lsx_repo.theo_ids(set(chi_lsx_ids))
        include = {int(i) for i in (include_lsx_ids or set()) if i}
        return self.lsx_repo.cho_mrp(trang_thai=TRANG_THAI_TINH, include_ids=include)

    def _bai_trong_pham_vi(self, lenh_ids: set[int], *, hep: bool = False) -> list[BaiGhep]:
        """Bài ghép có ÍT NHẤT MỘT lệnh thành viên đang trong phạm vi.

        Không lọc theo trạng thái của chính bài: bài còn `nhap` mà thành viên đã `san_sang` thì
        giấy vẫn phải mua — trạng thái bài nói về việc bình bài đã xong chưa, không nói về giấy.

        `hep=True` đẩy phép lọc đó xuống SQL thay vì kéo mọi bài của xưởng về rồi lọc bằng Python.
        Kết quả y hệt; chỉ đường toàn xưởng mới cần bản kéo-hết, vì ở đó `lenh_ids` là cả xưởng.
        """
        if hep:
            return self.bai_ghep_repo.chua_lsx(lenh_ids)
        return [
            b
            for b in self.bai_ghep_repo.list()
            if any(tv.lsx_id in lenh_ids for tv in b.thanh_viens)
        ]

    # ================== (b) NGÀY CẦN ==================

    def _nap_ngay_can(self, lsx_ids: set[int], bai_ids: set[int]) -> None:
        """Ngày cần hàng trên các YCMH còn hiệu lực đã lập cho những lệnh/bài này — MỘT câu."""
        self._ngay_can_map = (
            self.dpr.ngay_can_theo_chu_the(lsx_ids, bai_ids) if (lsx_ids or bai_ids) else {}
        )

    def _ngay_can_cua(self, hang: tuple, lsx_id: int | None, bai_ghep_id: int | None) -> date | None:
        return getattr(self, "_ngay_can_map", {}).get((hang[0], int(hang[1]), lsx_id, bai_ghep_id))

    # ================== (b') KHÁCH HÀNG CỦA LỆNH ==================

    def _nap_khach(self, lenh: list[Lsx]) -> None:
        """`lsx_id → tên khách`, MỘT câu cho cả bảng.

        Người lập kế hoạch nhìn bảng này để quyết mua gì trước; "lệnh của ai" là một nửa câu trả
        lời, mà lệnh chỉ giữ `order_id` nên tên khách phải đi qua đơn hàng. Tra từng lệnh một là
        đúng cái N+1 mà `LsxService._customer_names` đã dựng hàm gộp để tránh — bảng cân đối duyệt
        cả xưởng nên còn tệ hơn.

        `isouter`: đơn chưa gắn khách (`customer_id` NULL) vẫn phải giữ dòng lệnh trên bảng, chỉ
        là ô khách để trống.
        """
        self._khach_map: dict[int, str | None] = {}
        order_ids = {int(l.order_id) for l in lenh if getattr(l, "order_id", None)}
        if not order_ids:
            return
        rows = self.db.execute(
            select(Order.id, Customer.name)
            .select_from(Order)
            .join(Customer, Customer.id == Order.customer_id, isouter=True)
            .where(Order.id.in_(order_ids))
        ).all()
        theo_don = {oid: ten for oid, ten in rows}
        self._khach_map = {
            l.id: theo_don.get(int(l.order_id)) for l in lenh if getattr(l, "order_id", None)
        }

    def _khach_cua(self, lsx_id: int | None) -> str | None:
        return getattr(self, "_khach_map", {}).get(lsx_id) if lsx_id else None

    # ================== CÁC NGUỒN SỐ ĐÃ CÓ ==================

    def _da_cap_dang_linh(self) -> tuple[dict, dict]:
        """`{(hang, lsx_id, bai_ghep_id): số}` cho ĐÃ CẤP và ĐANG LĨNH, đơn vị GỐC.

        `sl_da_ung` = kho ĐÃ ghi sổ (tồn đã trừ) ⇒ **đã cấp**.
        `sl_duyet − sl_da_ung` = đề nghị còn treo, kho chưa ghi sổ ⇒ **đang lĩnh** (chỉ là nhãn).

        ⚠️ KHOÁ Ở ĐÂY CHỈ CÓ 3 PHẦN TỬ — thiếu chiều BƯỚC, khác `_khoa_dong()` (5 phần tử). Cố ý,
        vì phiếu xuất kho chỉ gắn `lsx_id`/`bai_ghep_id`, KHÔNG có `lsx_cong_doan_id`: kho xuất cho
        một LỆNH, không xuất cho một bước.

        Hệ quả CHƯA XỬ: lệnh ăn cùng một món ở hai bước thì cùng một số "đã cấp" bị trừ vào CẢ HAI
        dòng ⇒ cả hai ra `con_phai_co = 0` ⇒ bảng báo "đã cấp đủ" trong khi xưởng còn thiếu một nửa.
        Kiểu sai tệ hơn báo thiếu oan.

        Chưa nổ vì tới 17/08/2026 `stock_request_lines` còn RỖNG. Nhưng Đợt 2 §2.3 sẽ nối "xuất kho
        cho lệnh → giảm phần giữ chỗ", tức nhánh này bắt đầu có dữ liệu — **phải quyết cách PHÂN BỔ
        số đã cấp cấp-lệnh xuống từng bước TRƯỚC khi dựng `ton_tu_do`**, không thì tồn tự do kế
        thừa nguyên phép trừ hai lần. Không sửa được bằng cách thêm `buoc_id` vào khoá: dữ liệu
        nguồn không mang chiều đó.

        Số trên dòng đề nghị theo ĐƠN VỊ NGƯỜI KHAI, phải quy về gốc mới so được với nhu cầu.
        """
        da_cap: dict[tuple, float] = {}
        dang_linh: dict[tuple, float] = {}
        for ln, trang_thai in self.requests.dong_xuat_theo_lenh():
            # Khoá tồn của dòng đề nghị: giấy ⇒ (mã, khổ, đơn vị gốc) — dòng xin kg không tra tới
            # dòng nhu cầu đếm tờ cùng khổ, đúng ý: số kg không trừ được vào số tờ.
            hang = _khoa5(khoa_ton_cua(ln))
            if self._obj(hang) is None:
                continue
            if co_don_vi_goc(hang[0]) and not hang[4]:
                # Dòng chưa ghi gốc (dữ liệu trước mg 0388 chưa backfill) — suy từ ĐVT của dòng.
                hang = (*hang[:4], self._goc_cua(hang[0], hang[1], ln.dvt))
            # ⚠️ Giấy của lệnh THÀNH VIÊN bài ghép KHÔNG có dòng nhu cầu riêng (một dòng cho cả
            # bài, chống đếm đôi). Thủ kho lại chọn được "lệnh" thay vì "bài" trên cùng một ô, nên
            # phần đã cấp phải QUY VỀ BÀI — không thì nó rơi vào một khoá chẳng dòng nào tra tới,
            # và bài ghép hiện đỏ dù kho đã cấp đủ giấy.
            lsx_id, bg_id = ln.lsx_id, ln.bai_ghep_id
            if bg_id is None and lsx_id in self._bai_cua_lenh:
                lsx_id, bg_id = None, self._bai_cua_lenh[lsx_id]
            khoa = (hang, lsx_id, bg_id)
            for nguon, bang in (
                (_f(ln.sl_da_ung), da_cap),
                # Đề nghị đã DONE thì phần chênh duyệt−ứng là phần kho chốt KHÔNG cấp nữa (giao
                # thiếu, đóng phiếu), không phải hàng đang trên đường ra khỏi kho.
                (0.0 if trang_thai == REQ_DONE else StockRequestService.con_lai(ln),
                 dang_linh),
            ):
                if nguon <= 0:
                    continue
                kq = self._ve_goc(hang, ln.dvt, nguon)
                if "sl" in kq:
                    bang[khoa] = bang.get(khoa, 0.0) + kq["sl"]
        return da_cap, dang_linh

    def nap_nen_quy_doi(self, hangs: list[tuple]) -> None:
        """Nạp ĐỦ nền để `_ve_goc()` chạy được NGOÀI `can_doi()`.

        `_objs` (object mặt hàng) và `_dvs`/`_cap` (danh mục đơn vị + đồ thị cặp quy đổi) chỉ được
        nạp bên trong `can_doi()`. Đường ĐỐI SOÁT giữ chỗ (`GiuChoService.doi_soat_dang_ve`, chạy
        khi PMH huỷ/đóng/đổi đợt giao) chỉ hỏi MỘT mặt hàng: dựng cả bảng cân đối ở đó là chạy
        nguyên engine cho TOÀN kế hoạch chỉ để đọc một con số. Nạp đúng phần cần, không gọi
        `can_doi()`.

        Bỏ hàm này thì `_hang_dang_ve()` nổ `AttributeError: '_objs'` — `deps.py` bơm một
        `KeHoachVatTuService` VỪA DỰNG vào `PurchaseService`, nó chưa từng dựng bảng.
        """
        if not hasattr(self, "_dvs"):
            self._nap_don_vi()
        if not hasattr(self, "_objs"):
            self._objs = {}
        # Nhận cặp hoặc khoá tồn 5 phần tử — danh mục khoá theo cặp mã.
        thieu = sorted({(h[0], int(h[1])) for h in hangs} - set(self._objs))
        if thieu:
            self._objs.update(self.hang.map_theo_cap(thieu))

    def dang_ve_va_vet_mua(self, hangs: list[tuple]) -> tuple[dict, dict]:
        """Hàng đang về + vết mua (PMH/YCMH đang chạy) cho các mặt hàng — KHÔNG dựng bảng cân đối.

        Màn Tồn kho cần hai thứ này cho cả mặt hàng CHƯA lệnh nào cần (bảng cân đối không có nhóm
        của chúng). Cùng một nguồn với bảng (`_hang_dang_ve`, `_vet_mua_theo_hang`) để hai màn
        không đếm hàng đang về theo hai luật.
        """
        self.nap_nen_quy_doi(hangs)
        return self._hang_dang_ve(), self._vet_mua_theo_hang()

    def _nhap_dot(self) -> dict[int, str]:
        """`{id đợt giao: trạng thái yêu cầu nhập}` của mọi phiếu đang về — một câu, nhớ theo lượt."""
        if self._nho is not None and "nhap_dot" in self._nho:
            return self._nho["nhap_dot"]
        doc = getattr(self.purchases, "trang_thai_nhap_dot", None)   # bản giả trong test cũ không có
        ids = [d.id for p in self._doc("dang_ve", self.purchases.dong_dang_ve)
               for d in getattr(p, "deliveries", None) or []]
        m = doc(ids) if doc and ids else {}
        if self._nho is not None:
            self._nho["nhap_dot"] = m
        return m

    def _hang_dang_ve(self) -> dict[tuple, list[tuple[date, float, str | None, int]]]:
        """`{hang: [(ngày về, số còn về, mã phiếu mua, id dòng phiếu)]}` đã sắp theo ngày — đơn vị GỐC.

        Mã phiếu + id dòng phiếu đi kèm cho giữ chỗ (`GiuChoService`) bám đúng dòng phiếu mua.

        "Đang mua" và "hàng đang về" là MỘT thứ; đây là chỗ DUY NHẤT nó được cộng vào. Dòng phiếu
        KHÔNG gắn mặt hàng gốc thì bỏ qua hẳn — ghép ngược bằng tên hàng là đoán, mà đoán trúng
        nhầm lô giấy khác thì bảng báo đủ trong khi thật ra thiếu.

        `expected_receipt_date` trống ⇒ KHÔNG cộng: hàng không có ngày về thì không hứa được với
        lệnh nào cả.
        """
        from .purchase_service import da_vao_ton_theo_dong, ngay_ve_cua_phieu

        ra: dict[tuple, list[tuple[date, float, str | None, int]]] = {}
        nhap = self._nhap_dot()
        for phieu in self._doc("dang_ve", self.purchases.dong_dang_ve):
            ngay_ve = ngay_ve_cua_phieu(phieu, nhap)
            if ngay_ve is None:
                continue
            # Chỉ đợt ĐÃ VÀO TỒN mới trừ khỏi "còn về" (#57): nhận rồi mà kho chưa nhập thì tồn chưa
            # có, hàng vẫn phải đứng ở đây.
            da_giao = da_vao_ton_theo_dong(phieu, nhap)
            for ln in phieu.lines:
                if not ln.hang_loai or not ln.hang_id:
                    continue
                # Giấy chỉ bù cho nhu cầu đúng mã + đúng KHỔ MUA + đúng ĐƠN VỊ GỐC (khoá 5 phần):
                # mua kg khổ 1000 không bù nhu cầu tờ, khổ chỉ-rộng không bù khổ hai cạnh.
                if self._obj((ln.hang_loai, ln.hang_id)) is None:
                    continue
                hang = self._khoa_mua(ln)
                # Phiếu CÓ đợt giao ⇒ Σ các đợt. Phiếu CHƯA có đợt nào (mọi phiếu lập trước
                # 06/08/2026) ⇒ đọc `received_quantity`, KHÔNG mặc định 0: đường cũ `mark_received`
                # cho khai nhận một phần rồi "mở lại đơn" đưa phiếu về `purchased`; coi là chưa
                # nhận gì thì phần đã nhập kho bị đếm HAI LẦN (một lần ở tồn, một lần ở đang về)
                # và bảng báo đủ trong khi thật ra thiếu.
                #
                # Cố ý KHÔNG tái dùng `qty_thuc_nhan`: hàm đó đọc `received_quantity` NULL là "nhận
                # đủ" — đúng cho câu hỏi công nợ, sai cho câu hỏi này (mọi phiếu `purchased` bình
                # thường sẽ ra `con_ve = 0`, tức không phiếu nào được tính là đang về).
                nhan = (
                    float(da_giao.get(ln.id, 0.0)) if da_giao is not None
                    else _f(ln.received_quantity)
                )
                con_ve = _f(ln.quantity) - nhan
                if con_ve <= 0:
                    continue
                kq = self._ve_goc(hang, ln.unit, con_ve)
                if "sl" in kq:
                    ra.setdefault(hang, []).append(
                        (ngay_ve, kq["sl"], getattr(phieu, "code", None), int(ln.id)))
        for ds in ra.values():
            ds.sort(key=lambda x: x[0])
        return ra

    def hang_dang_mua_khong_ngay(self) -> set[tuple]:
        """TẬP mặt hàng có phiếu mua ĐANG VỀ nhưng NCC CHƯA hẹn ngày (`expected_receipt_date` trống).

        Đây đúng là nhánh mà `_hang_dang_ve` CỐ Ý bỏ (không ngày thì không hứa được với lệnh nào),
        nên trên bảng cân đối nó rơi vào MÀU ĐỎ y như chưa mua gì. Cửa phát hành cần tách riêng để
        NÓI ĐÚNG việc: "đã đặt mua, giục NCC chốt ngày" khác hẳn "chưa mua gì". Chỉ cần định danh
        mặt hàng để giao với danh sách còn thiếu — KHÔNG quy đổi số lượng (câu hỏi là "có/không",
        không phải "bao nhiêu").
        """
        from .purchase_service import da_vao_ton_theo_dong, ngay_ve_cua_phieu

        dong: list = []
        nhap = self._nhap_dot()
        for phieu in self._doc("dang_ve", self.purchases.dong_dang_ve):
            if ngay_ve_cua_phieu(phieu, nhap) is not None:
                continue
            da_giao = da_vao_ton_theo_dong(phieu, nhap)
            for ln in phieu.lines:
                if not ln.hang_loai or not ln.hang_id:
                    continue
                nhan = (
                    float(da_giao.get(ln.id, 0.0)) if da_giao is not None
                    else _f(ln.received_quantity)
                )
                if _f(ln.quantity) - nhan > 0:
                    dong.append(ln)
        if not dong:
            return set()
        # Khoá 5 phần cần đơn vị giá của mã (suy gốc dòng mua kg/tấn) — nạp một lượt.
        self.nap_nen_quy_doi([(ln.hang_loai, ln.hang_id) for ln in dong])
        return {self._khoa_mua(ln) for ln in dong}

    def _vet_mua_theo_hang(self) -> dict[tuple, list[dict]]:
        """`{hang: [{ma, loai, trang_thai, ngay_ve}]}` — MỌI phiếu đang chạy của mặt hàng đó.

        Thuần NHÃN, không đụng một phép cộng nào của bảng: số vẫn chỉ nhận hàng từ `_hang_dang_ve`.
        Chỗ này trả lời câu người dùng hỏi ngày 20/08/2026 — *"sao biết được cái nào đang yêu cầu
        mua"* — vì trước đó ba tình huống khác hẳn nhau lại vẽ y hệt nhau trên màn:

        * PMH duyệt rồi, có ngày về  → cộng vào hàng đang về, dòng thành vàng (đã nói được).
        * PMH duyệt rồi, NCC chưa hẹn ngày → ĐỎ, giống hệt chưa mua gì.
        * YCMH mới đề nghị / chờ duyệt   → ĐỎ + còn nguyên nút Mua ⇒ bấm phát nữa là phiếu trùng.

        Gộp cả hai chuỗi (YCMH của bộ phận → PMH của thu mua) vì người lập kế hoạch chỉ cần biết
        "đã có ai lo món này chưa", không cần biết nó đang nằm ở khâu nào.
        """
        from .purchase_service import da_vao_ton_theo_dong, ngay_ve_cua_phieu

        ra: dict[tuple, list[dict]] = {}
        nhap = self._nhap_dot()

        def _them(hang: tuple, ma: str | None, loai: str, trang_thai: str, ngay_ve) -> None:
            if not ma:
                return
            ds = ra.setdefault(hang, [])
            # Một phiếu khai cùng mặt hàng ở hai dòng (hai khổ, hai lô) vẫn chỉ là MỘT phiếu.
            if any(x["ma"] == ma for x in ds):
                return
            ds.append({"ma": ma, "loai": loai, "trang_thai": trang_thai, "ngay_ve": ngay_ve})

        phieu_song = [*self._doc("dang_ve", self.purchases.dong_dang_ve), *self._doc("cho_duyet", self.purchases.dong_cho_duyet)]
        # DÒNG YÊU CẦU ĐÃ CÓ ĐƠN MUA ĐANG CHẠY. Dựng từ chính danh sách vừa nạp (không thêm query)
        # để đoạn YCMH bên dưới biết món nào Thu mua đã cầm — TRẢ LỜI THEO TỪNG MÓN, không theo
        # trạng thái của cả yêu cầu (chủ chốt 24/08/2026: *"phải đi vào trong trạng thái của từng
        # sản phẩm trong yêu cầu ấy chứ không phải yêu cầu"*). Trước đây yêu cầu 3 món mà Thu mua
        # mới lập đơn cho 1 món thì CẢ BA món đều đeo chip "đang mua" — hai món kia thực ra vẫn
        # đang nằm chờ, không ai lo.
        # Cố ý KHÔNG loại dòng đã nhận đủ ở đây: nhận đủ rồi thì món đó cũng hết "đang chờ Thu mua".
        dong_yc_da_co_don: set[int] = {
            int(ln.department_request_line_id)
            for phieu in phieu_song
            for ln in phieu.lines
            if getattr(ln, "department_request_line_id", None) is not None
        }
        # DÒNG YÊU CẦU ĐÃ ĐI QUA THU MUA NHƯNG CHƯA THÀNH LỜI HỨA NÀO (24/08/2026).
        # Phiếu nháp và phiếu bị từ chối không cộng một ký hàng nào, nên chúng KHÔNG nằm trong
        # `phieu_song` ở trên — và trước hôm nay chúng cũng không nói được câu nào, món rơi thẳng
        # về nhãn "mới đề nghị" như thể chưa ai đụng vào. Đọc thêm đúng một câu truy vấn để chip
        # nói được món đang kẹt ở đâu.
        #
        # NHÁP THẮNG BỊ-TỪ-CHỐI: thu mua bị trả phiếu rồi mở phiếu mới gõ lại thì việc đang chạy
        # tiếp, không còn kẹt. Ngược lại thì chip báo kẹt trong khi người ta đang làm.
        dong_yc_kep: dict[int, str] = {}
        for phieu in self._doc("nhap_tu_choi", self.purchases.dong_nhap_hoac_bi_tu_choi):
            nhan_kep = (
                VET_DANG_LAP_DON if phieu.status == PR_DRAFT else VET_DON_BI_TU_CHOI
            )
            for ln in phieu.lines:
                src = getattr(ln, "department_request_line_id", None)
                if src is None:
                    continue
                if dong_yc_kep.get(int(src)) == VET_DANG_LAP_DON:
                    continue
                dong_yc_kep[int(src)] = nhan_kep

        for phieu in phieu_song:
            da_giao = da_vao_ton_theo_dong(phieu, nhap)
            for ln in phieu.lines:
                if not ln.hang_loai or not ln.hang_id:
                    continue
                if self._obj((ln.hang_loai, ln.hang_id)) is None:
                    continue
                hang = self._khoa_mua(ln)
                nhan = (
                    float(da_giao.get(ln.id, 0.0)) if da_giao is not None
                    else _f(ln.received_quantity)
                )
                # Dòng đã VÀO TỒN đủ thì phiếu không còn là việc đang chạy của mặt hàng này (nhận đủ
                # mà kho chưa nhập vẫn là việc đang chạy — #57).
                if _f(ln.quantity) - nhan <= 0:
                    continue
                _them(hang, getattr(phieu, "code", None), "pmh", phieu.status,
                      ngay_ve_cua_phieu(phieu, nhap))

        for yc in self._doc("dang_de_nghi", self.dpr.dang_de_nghi):
            for ln in yc.lines:
                if not ln.hang_loai or not ln.hang_id:
                    continue
                # Món đã bị bộ phận BỎ khỏi yêu cầu (mg 0233) — không còn ai chờ nó nữa.
                if getattr(ln, "cancelled_at", None) is not None:
                    continue
                # Món đã có đơn mua đang chạy → chip PMH ở trên đã nói rồi, nói thêm chip YCMH chỉ
                # làm người đọc tưởng có hai việc song song.
                if ln.id in dong_yc_da_co_don:
                    continue
                # Khổ CẦN + đơn vị gốc trên dòng yêu cầu mua — chip treo đúng nhóm (mã, khổ, gốc).
                if self._obj((ln.hang_loai, ln.hang_id)) is None:
                    continue
                hang = self._khoa_mua(ln)
                # Trạng thái của CHÍNH MÓN NÀY, không phải của yêu cầu cha: tới được đây nghĩa
                # là chưa đơn mua sống nào cầm nó. Còn nó đang *đứng ở đâu* thì hỏi tiếp đơn cũ —
                # chưa đơn nào là "mới đề nghị", có đơn nháp là thu mua đang gõ, có đơn bị từ chối
                # là việc đang kẹt chờ lập lại. Ba tình huống, ba câu khác nhau.
                _them(hang, yc.code, "ycmh", dong_yc_kep.get(ln.id, DPR_OPEN), None)

        for ds in ra.values():
            ds.sort(key=lambda v: (_xep_vet(v), v["ngay_ve"] or date.max, v["ma"]))
        return ra

    def dung_mach(self, can_o: dict[tuple, float]) -> dict:
        """Mạch phiếu của mọi ô (`services/mach_mua.dung_mach`) — yêu cầu còn mở + đơn lập từ nó.

        `can_o` = số cần hiện tại của từng ô, dùng cho liên kết cũ chưa ghi số đề nghị."""
        ycs = self._doc("dang_de_nghi", self.dpr.dang_de_nghi)
        # Bản giả trong test cũ không có hàm này — không có đơn nào lập từ yêu cầu.
        doc_don = getattr(self.purchases, "dong_tu_yeu_cau", None)
        dong_don = doc_don([ln.id for yc in ycs for ln in yc.lines]) if ycs and doc_don else []
        self.nap_nen_quy_doi(
            [(ln.hang_loai, ln.hang_id) for yc in ycs for ln in yc.lines
             if ln.hang_loai and ln.hang_id]
            + [(d.hang_loai, d.hang_id) for d in dong_don if d.hang_loai and d.hang_id])

        def ve_goc(hang, dvt, sl):
            if hang is None or self._obj(hang) is None:
                return None
            return self._ve_goc(hang, dvt, sl).get("sl")

        doc_nhap = getattr(self.purchases, "trang_thai_nhap_dot", None)
        dot_ids = {dt.id for d in dong_don for dt in getattr(d.request, "deliveries", None) or []}
        nhap = {**self._nhap_dot(), **(doc_nhap(list(dot_ids)) if doc_nhap and dot_ids else {})}
        return _dung_mach(ycs, dong_don, ve_goc=ve_goc, can_o=lambda k: can_o.get(k, 0.0),
                          khoa=self._khoa_mua, nhap_dot=nhap)

    @property
    def mach(self) -> dict:
        """Mạch của lượt `can_doi()` gần nhất — rỗng nếu chưa dựng bảng."""
        return getattr(self, "_mach", None) or {"mach": [], "theo_o": {}, "dat_cho": {}, "peg": {},
                                                "khac": {}}

    # ================== HÀM CHÍNH ==================

    def can_doi(
        self,
        *,
        q: str | None = None,
        chi_thieu: bool = False,
        include_lsx_ids: set[int] | None = None,
        chi_lsx_ids: set[int] | None = None,
    ) -> dict:
        """Bảng cân đối vật tư. `chi_lsx_ids` giới hạn phạm vi về ĐÚNG những lệnh đó.

        Hai phạm vi, đừng lẫn. Mặc định (không truyền gì) là phạm vi TOÀN XƯỞNG: mọi lệnh trong
        `TRANG_THAI_TINH`. Màn Kế hoạch vật tư phải dùng bản này — nó vẽ cả bảng cân đối, cắt bớt
        là âm thầm tính THIẾU nhu cầu và mua hụt giấy.

        `chi_lsx_ids` là phạm vi HẸP cho đường chỉ cần nhu cầu của vài lệnh đã biết tên: hàng ba
        đèn của màn Kế hoạch SX hỏi đúng 50 lệnh đang hiện, rồi chỉ đọc ra `nhu_cau` của từng lệnh
        (`GiuChoService.trang_thai` → `_nhu_cau_theo_chu_the`). Nhu cầu của một lệnh không phụ
        thuộc lệnh khác, nên hai phạm vi cho CÙNG một con số — chỉ khác cái giá. Không có nó thì
        mở một trang 50 lệnh là kéo cả xưởng về RAM: đo 18/09/2026 thấy hỏi cùng 6 lệnh mà phải
        nạp 12 → 48 dòng khi số lệnh trong xưởng gấp bốn, tức tuyến tính theo lịch sử nhập liệu.

        `include_lsx_ids` KHÁC hẳn: nó THÊM lệnh vào phạm vi toàn xưởng (lệnh đang mở trên màn dù
        trạng thái nào). Truyền cả hai thì `chi_lsx_ids` thắng và `include_lsx_ids` nhập vào nó.
        """
        self._nap_don_vi()
        hep = {int(i) for i in (chi_lsx_ids or set()) if i}
        if hep:
            hep |= {int(i) for i in (include_lsx_ids or set()) if i}
        lenh = self._lenh_trong_pham_vi(include_lsx_ids, chi_lsx_ids=hep or None)
        lenh_map = {l.id: l for l in lenh}
        bais = self._bai_trong_pham_vi(set(lenh_map), hep=bool(hep))
        # lệnh thành viên → bài chứa nó; dùng để quy "đã cấp" gắn nhầm vào lệnh về đúng dòng bài.
        self._bai_cua_lenh: dict[int, int] = {
            tv.lsx_id: b.id for b in bais for tv in b.thanh_viens
        }

        self._nap_ngay_can(set(lenh_map), {b.id for b in bais})
        self._nap_khach(lenh)

        tho = self._gom_nhu_cau(lenh, lenh_map, bais)
        self._nap_mat_hang(tho)
        self._quy_doi_dong(tho)
        tho, da_tieu = self._bo_buoc_da_xong(tho)

        da_cap, dang_linh = self._da_cap_dang_linh()
        # Phần đã cấp cho bước VỪA RỤNG coi như đã tiêu vào chính bước đó. Không trừ thì số ấy trôi
        # sang dòng còn lại của cùng lệnh + cùng mặt hàng (`da_cap` không có chiều bước — xem
        # `_da_cap_dang_linh`) và dán "đã cấp đủ" lên một bước chưa hề nhận hàng.
        for khoa, sl in da_tieu.items():
            if khoa in da_cap:
                da_cap[khoa] = max(0.0, da_cap[khoa] - sl)
        dang_ve = self._hang_dang_ve()
        vet_mua = self._vet_mua_theo_hang()
        # Mạch phiếu của từng ô + phần ĐẶT CHO LỆNH trên đơn đang về (spec một ô một phiếu).
        can_o: dict[tuple, float] = {}
        for d in tho:
            k = (d["hang"], d["lsx_id"], d["bai_ghep_id"])
            can_o[k] = can_o.get(k, 0.0) + _f(d["nhu_cau"])
        for k in list(can_o):
            can_o[k] = max(0.0, can_o[k] - _f(da_cap.get(k)))
        self._mach = self.dung_mach(can_o)
        # Tồn theo khoá 5 phần tử: giấy = Σ lô đúng mã + đúng khổ + đúng đơn vị gốc ở mọi kho (tờ và
        # kg không cộng lẫn). Dòng giấy chưa có khổ vẫn tra — nhóm đó bị cờ "chưa khổ" nên số tồn chỉ
        # để nhìn, không ai đem cân.
        ton = self.lots.on_hand_map(sorted({d["hang"] for d in tho}))

        nhom = self._chay_con_tro(tho, ton=ton, dang_ve=dang_ve, da_cap=da_cap,
                                  dang_linh=dang_linh, vet_mua=vet_mua,
                                  peg=self._mach["peg"], khac=self._mach.get("khac"))
        self._gan_cung_kho_khac_don_vi(nhom, dang_ve)
        return {"items": self._loc(nhom, q=q, chi_thieu=chi_thieu)}

    def vat_tu_hieu_luc(self, bai_ghep_id: int) -> dict:
        """Chiếu bảng cân đối xuống đúng một bài cho tab Vật tư của Bài ghép 2.

        Engine ``can_doi`` vẫn là nguồn duy nhất của quy đổi/số lượng. Phép chiếu chỉ giữ giấy và
        vật tư của chính bài hoặc bước riêng của thành viên, rồi tính lại tổng sau lọc; tuyệt đối
        không bê ``tong_can`` toàn xưởng vào tab bài.
        """
        bg = self.bai_ghep_repo.get(bai_ghep_id)
        if bg is None:
            from .bai_ghep_service import BaiGhepNotFound
            raise BaiGhepNotFound("Không tìm thấy bài ghép")
        member_ids = {tv.lsx_id for tv in bg.thanh_viens}
        gang_step_keys = {c.id: c.step_key for c in self._buoc_chung(bg.id)}
        can_doi = self.can_doi(include_lsx_ids=member_ids)
        items: list[dict] = []
        for nhom in can_doi["items"]:
            dong = []
            for row in nhom.get("dong", []):
                la_bai = row.get("bai_ghep_id") == bg.id
                la_lenh = row.get("bai_ghep_id") is None and row.get("lsx_id") in member_ids
                if not (la_bai or la_lenh):
                    continue
                dong.append({
                    "pham_vi": "bai_ghep" if la_bai else "lsx",
                    "lsx_id": row.get("lsx_id"),
                    "bai_ghep_id": row.get("bai_ghep_id"),
                    "buoc_id": row.get("buoc_id"),
                    "gang_step_key": gang_step_keys.get(row.get("buoc_id")) if la_bai else None,
                    "ma": row["ma"],
                    "ten_viec": row.get("ten_viec"),
                    "nhu_cau": round(_f(row.get("nhu_cau")), 4),
                    "nhu_cau_hien_thi": row.get("nhu_cau_hien_thi") or "",
                })
            if not dong:
                continue
            items.append({
                "loai_nhom": nhom["loai_nhom"],
                "hang_loai": nhom["hang_loai"],
                "hang_id": nhom["hang_id"],
                "hang_ma": nhom.get("hang_ma"),
                "hang_ten": nhom.get("hang_ten"),
                "kho_rong": nhom.get("kho_rong", 0),
                "kho_dai": nhom.get("kho_dai", 0),
                "don_vi_goc": nhom.get("don_vi_goc"),
                "tong_can": round(sum(_f(row["nhu_cau"]) for row in dong), 4),
                "dong": dong,
            })
        return {"bai_ghep_id": bg.id, "items": items}

    def nhu_cau_cua_cong_viec(self, cv) -> list[dict]:
        """Vật tư KẾ HOẠCH của MỘT công việc sản xuất (spec-de-nghi-cap-vat-tu-cong-doan §3).

        Đi qua ĐÚNG `_gom_nhu_cau` mà bảng cân đối đang dùng, rồi LỌC về đúng bước — không viết
        lại MRP. Hai nguồn tính nhu cầu thì sớm muộn lệch, và lệch ở đây là tổ xin sai số vật tư.

        KHÔNG đọc `cv.vat_tu_json`: snapshot ấy dựng lúc phát hành công việc, còn `_gom_nhu_cau`
        đọc dòng vật tư SỐNG của bước — hai nguồn lệch nhau sau mỗi lần sửa lệnh.

        Giấy neo vào ĐÚNG bước người lập kế hoạch khai nó (08/09/2026), nên chỉ công việc của bước
        đó mới thấy dòng giấy — đúng nghiệp vụ: tổ cán màng không đi xin giấy in.
        """
        lsx_id = cv.lsx_id
        bai_id = cv.bai_ghep_id
        if not lsx_id and not bai_id:
            return []

        self._nap_don_vi()
        # Đường này chỉ cần mặt hàng + số, không cần ngày cần.
        self._ngay_can_map = {}
        khoa_nho = ("bai", int(bai_id)) if bai_id else ("lsx", int(lsx_id))
        tho = self._tho_nho.get(khoa_nho) if self._tho_nho is not None else None
        if tho is None:
            tho = self._tho_cua_pham_vi(lsx_id, bai_id)
            if self._tho_nho is not None:
                self._tho_nho[khoa_nho] = tho

        # Neo về ĐÚNG bước: dòng lệnh so `buoc_id` với `lsx_cong_doan_id`, dòng bài so với
        # `bai_ghep_cong_doan_id` (hai không gian id khác nhau — cặp `(lsx_id, bai_ghep_id)` trên
        # dòng đã phân biệt sẵn, xem chú thích `_dong_bai`). Chép dòng: `_nap_mat_hang` /
        # `_quy_doi_dong` ghi vào dòng, dòng gốc còn nằm trong bộ nhớ đệm cho bước khác.
        neo_lsx = cv.lsx_cong_doan_id
        neo_bg = cv.bai_ghep_cong_doan_id
        cua_buoc = [
            dict(d) for d in tho
            if (d["bai_ghep_id"] and neo_bg and d["buoc_id"] == neo_bg)
            or (d["lsx_id"] and neo_lsx and d["lsx_id"] == lsx_id and d["buoc_id"] == neo_lsx)
        ]
        if not cua_buoc:
            return []
        gom = self._gom_theo_khoa(cua_buoc)
        if int(getattr(cv, "phan_doan_tong", None) or 1) > 1:
            self._chia_phan_doan(cv, gom)
        return gom

    #: Bộ nhớ đệm `_gom_nhu_cau` theo phạm vi, chỉ sống trong `nho_nhu_cau()`.
    _tho_nho: dict | None = None

    @contextmanager
    def nho_nhu_cau(self):
        """Trong khối này `nhu_cau_cua_cong_viec` tính `_gom_nhu_cau` MỘT lần cho mỗi lệnh/bài —
        phát hành cụm hàng chục bước khỏi cân đối lại từng bước. Chỉ dùng khi dòng vật tư của
        bước không đổi giữa chừng (lập yêu cầu không đụng tới chúng)."""
        cu = self._tho_nho
        self._tho_nho = {} if cu is None else cu
        try:
            yield
        finally:
            self._tho_nho = cu

    def _chia_phan_doan(self, cv, gom: list[dict]) -> None:
        """Bước tách nhiều phân đoạn lịch: mỗi phân đoạn mang phần số kế hoạch theo số vào của nó,
        không phải nguyên số của cả bước (N phân đoạn xin nguyên số là xin gấp N lần)."""
        cung = self.repo.phan_doan_cung_buoc(cv)
        vi_tri = next((i for i, x in enumerate(cung) if x.id == cv.id), None)
        if vi_tri is None or len(cung) <= 1:
            return
        so_vao = [float(x.so_luong_vao or 0) for x in cung]
        for d in gom:
            d["sl"] = phan_cua_phan_doan(float(d["sl"] or 0), so_vao, vi_tri)
            d["sl_goc"] = phan_cua_phan_doan(float(d["sl_goc"] or 0), so_vao, vi_tri)

    def _tho_cua_pham_vi(self, lsx_id, bai_id) -> list[dict]:
        # Phạm vi HẸP thật: đúng lệnh/bài của công việc này. Đừng quay lại `_lenh_trong_pham_vi`
        # — nó đi qua `cho_mrp`, hàm luôn OR thêm `trang_thai IN TRANG_THAI_TINH`, nên nó kéo về
        # mọi lệnh còn sống của xưởng và biến một lần mở form thành một lần `can_doi()` toàn bảng.
        if bai_id:
            b = self.bai_ghep_repo.get(bai_id)
            bais = [b] if b is not None else []
        elif lsx_id:
            # Lệnh có thể là thành viên một bài ghép: khi đó giấy nằm ở dòng BÀI, không ở dòng
            # lệnh (xem `_dong_bai`). Vẫn phải tìm bài chứa nó, nếu không `bais` rỗng và dòng giấy
            # của bài biến mất khỏi kết quả.
            bais = self._bai_trong_pham_vi({int(lsx_id)})
        else:
            bais = []
        lsx_ids = {int(lsx_id)} if lsx_id else set()
        lsx_ids |= {tv.lsx_id for b in bais for tv in b.thanh_viens}
        lenh = self.lsx_repo.theo_ids(lsx_ids)
        lenh_map = {l.id: l for l in lenh}
        return self._gom_nhu_cau(lenh, lenh_map, bais)

    def _gom_theo_khoa(self, cua_buoc: list[dict]) -> list[dict]:
        self._nap_mat_hang(cua_buoc)
        self._quy_doi_dong(cua_buoc)

        # Gộp trùng SAU khi đã về đơn vị gốc — gộp trước là cộng 100 tờ với 12 kg. Khoá gộp là khoá
        # tồn 5 phần tử: cùng mã giấy hai khổ (hay cùng khổ một tờ một kg) là hai dòng xin cấp.
        # Tên lấy thẳng từ `self._objs`, đơn vị gốc là phần thứ năm của khoá (giấy, vật tư) hoặc
        # `obj.don_vi_gia`, số gốc là `d["nhu_cau"]` (khoá do `_quy_doi_dong` đặt).
        gom: dict[tuple, dict] = {}
        for d in cua_buoc:
            k = d["hang"]
            loai, hid, kr, kd, goc = k
            obj = self._obj(k)
            ten = obj.ten if obj is not None else f"#{hid}"
            co_goc = co_don_vi_goc(loai) and bool(goc)
            dvt_goc = (goc if co_goc
                       else getattr(obj, "don_vi_gia", None) if obj is not None else None)
            sl_goc = float(d.get("nhu_cau") or 0)
            cu = gom.get(k)
            if cu is None:
                gom[k] = {
                    "hang_loai": loai, "hang_id": int(hid), "ten": ten,
                    "don_vi_goc": goc if co_goc else "", "kho_rong": kr, "kho_dai": kd,
                    "dvt": d["dvt"], "sl": float(d["sl"] or 0),
                    "dvt_goc": dvt_goc or d["dvt"], "sl_goc": sl_goc,
                }
            else:
                cu["sl_goc"] += sl_goc
                # Đơn vị hiển thị chỉ cộng được khi TRÙNG; khác đơn vị thì bày theo đơn vị GỐC,
                # đừng cộng bừa hai thang rồi in ra một con số không có nghĩa.
                if cu["dvt"] == d["dvt"]:
                    cu["sl"] += float(d["sl"] or 0)
                else:
                    cu["dvt"] = cu["dvt_goc"]
                    cu["sl"] = cu["sl_goc"]
        return list(gom.values())

    def ve_don_vi_goc(self, hang_loai: str, hang_id: int, dvt: str, sl: float, *,
                      goc: str | None = None) -> tuple[float, str]:
        """Quy `sl` từ `dvt` về đơn vị GỐC của mặt hàng `(hang_loai, hang_id)`.

        Wrapper CÔNG KHAI mỏng quanh `_ve_goc` — Task 3 (đề nghị cấp vật tư) dùng nó để BE tự quy
        đổi lại số client gửi lên, không tin số của client. Tự nạp `self._objs` cho mặt hàng này
        nếu chưa có (gọi thẳng từ ngoài `can_doi()`/`nhu_cau_cua_cong_viec` là bình thường — vd
        dòng khai thêm ngoài kế hoạch).

        Ném `KeHoachVatTuError` khi không quy đổi được, KHÔNG trả 0 im lặng: Task 3 dùng con số
        này để so lệch kế hoạch, trả 0 âm thầm là một dòng "lệch" giả.

        Giấy: `goc` (đơn vị gốc của dòng, `to` / đơn vị giá…) ép gốc; bỏ trống ⇒ suy từ `dvt` (họ tờ
        về `to`, họ đơn vị giá về đơn vị giá). Mã gốc thật nằm ở `don_vi_goc_cua`.
        """
        kq = self._ve_goc_cong_khai(hang_loai, hang_id, dvt, sl, goc=goc)
        return float(kq["sl"]), kq["don_vi_goc_ten"]

    def don_vi_goc_cua(self, hang_loai: str, hang_id: int, dvt: str, *,
                       goc: str | None = None) -> str:
        """MÃ đơn vị gốc mà `ve_don_vi_goc` quy về (giấy: `to` / đơn vị giá…; hàng khác: đơn vị giá)
        — bên gọi ghi nó vào dòng đề nghị / nhập lại. Ném `KeHoachVatTuError` như `ve_don_vi_goc`."""
        return self._ve_goc_cong_khai(hang_loai, hang_id, dvt, 1.0, goc=goc)["don_vi_goc"]

    def goc_cua_dvt(self, hang_loai: str, hang_id: int, dvt: str | None) -> str:
        """Đơn vị gốc của một dòng GIẤY suy từ ĐVT dòng (`kho_giay.GocGiay`) — không quy đổi số,
        không ném lỗi; hàng khác giấy ⇒ "". Dùng để dựng khoá dòng (`khoa_dong`) từ dòng client gửi
        (client không gửi đơn vị gốc — máy chủ suy)."""
        if not co_don_vi_goc(hang_loai):
            return ""
        self.nap_nen_quy_doi([(hang_loai, int(hang_id))])
        return self._goc_cua(hang_loai, int(hang_id), dvt)

    def _ve_goc_cong_khai(self, hang_loai, hang_id, dvt, sl, *, goc=None) -> dict:
        hang = (hang_loai, int(hang_id))
        self.nap_nen_quy_doi([hang])
        kq = self._ve_goc(_khoa5(hang), dvt, float(sl), goc=goc)
        if "loi" in kq:
            raise KeHoachVatTuError(kq["loi"])
        # Đơn vị không thuộc nhóm nào mã đã khai (spec 2026-10-10): xin / trả kho theo đơn vị đó
        # là chứng từ kho không ghi được — báo ngay, đừng để `_goc_cua` lấy chính ĐVT làm gốc.
        if self._chua_khai((hang_loai, int(hang_id), 0, 0, kq.get("don_vi_goc") or "")):
            raise KeHoachVatTuError(self.cau_chua_khai(
                (hang_loai, int(hang_id), 0, 0, kq.get("don_vi_goc") or "")))
        return kq

    # ---- (a) ----------------------------------------------------------------

    def _gom_nhu_cau(self, lenh, lenh_map, bais) -> list[dict]:
        tho: list[dict] = []

        # --- giấy của LỆNH: ĐÃ GỠ 08/09/2026 -------------------------------
        # Trước đây lệnh tự đẻ một dòng giấy từ `quy_cach_json.giay_id` + `so_to_nguyen`, rồi treo
        # ngày cần lên "bước đầu tiên chạm tờ" (`_buoc_dau_dong_giay`). Hai chỗ đoán, hai chỗ sai:
        # người lập kế hoạch không chọn được loại giấy nào khác, không đổi được bước tiêu thụ, và
        # một lệnh chỉ ôm được ĐÚNG MỘT loại giấy — trong khi hộp carton cần giấy mặt + giấy sóng
        # + giấy đáy, mỗi loại vào một bước khác nhau.
        #
        # Nay giấy là một DÒNG VẬT TƯ của bước (`lsx_cong_doan_vat_tu` với `hang_loai='giay'`), đi
        # chung vòng "vật tư khai tay ở bước lệnh" ngay dưới; ngày cần lấy theo CHÍNH bước mang nó.
        # BÀI GHÉP giữ nguyên `bai_ghep.giay_id`: giấy in của một lượt chạy chung thuộc về BÀI.

        # --- giấy của BÀI GHÉP: MỘT dòng cho cả bài ------------------------
        # Thành viên nạp MỘT lần cho mỗi bài rồi dùng lại ở vòng vật tư dưới (hạn + khách của bài).
        #
        # Mọi thứ engine hỏi TỪNG BÀI (bước chung, bản đồ gộp, "lệnh thuộc bài nào", thành viên
        # nằm ngoài phạm vi) nạp LÔ một lần ở đây — hỏi trong vòng lặp là mỗi bài đội ~15 câu.
        self._bai_ctx: dict[int, dict] = {}
        bai_ids = [bg.id for bg in bais]
        tv_ids = [tv.lsx_id for bg in bais for tv in bg.thanh_viens]
        ngoai = self.bai_ghep_repo.lsx_by_ids(sorted({i for i in tv_ids if i not in lenh_map}))
        self._chung_nap = self.bai_ghep_repo.buoc_chung_theo_bai(bai_ids)
        if bais:
            self._bg().nap_truoc(bai_ids, tv_ids, buoc_chung=self._chung_nap)
        # Neo giấy bài = bước chung THẬT nhận giấy (`buoc_giay_bai`, cùng luật đường tự lập yêu cầu
        # khi phát hành): Ghi kẽm CTP đứng đầu tuyến bài (đơn vị `kem`) không phải bước lấy giấy.
        from .san_xuat.buoc_giay_bai import buoc_lay_giay_bai_lo

        neo_bai = buoc_lay_giay_bai_lo(
            self.db, {bg.id: list(self._buoc_chung(bg.id)) for bg in bais if bg.giay_id})
        for bg in bais:
            ids = [tv.lsx_id for tv in bg.thanh_viens]
            lsx_map = {i: lenh_map[i] if i in lenh_map else ngoai[i]
                       for i in ids if i in lenh_map or i in ngoai}
            self._bai_ctx[bg.id] = lsx_map
            if not bg.giay_id:
                continue
            so_to_dict = self._tinh_so_to(bg, lsx_map)
            # Khổ + số tờ của giấy bài (spec §4.2), cùng luật với dòng giấy của lệnh: khổ nguyên của
            # bài với `to_nguyen_can`; thiếu khổ nguyên thì khổ tờ in của bài với `tong_to`. Dẫn xuất,
            # không có cột: khổ in sửa ở bài, khổ nguyên đi theo thành viên.
            qc_bai = quy_cach_bien_bai(bg, thanh_vien=lsx_map.values(), so_to=so_to_dict)
            buoc = sorted(self._buoc_chung(bg.id), key=lambda c: c.thu_tu)
            neo = neo_bai.get(bg.id)
            gy = self._giay_bai_theo_buoc_dau(neo, qc_bai, so_to_dict)
            if gy is None:
                gy = goi_y_dong_giay(qc_bai)
            neo = neo or (buoc[0] if buoc else None)
            # Bước đầu nhận tờ (mã chặng tờ) ⇒ dòng đếm "tờ"; nhận giấy khổ rộng ⇒ dòng kg (đơn vị
            # gốc suy sau khi nạp danh mục — kg thường thuộc họ đơn vị giá của mã, xem `_nap_mat_hang`).
            # `dong_giay_theo_dau_vao` trả "kg" khi bước nhận con/cái/tay hoặc đầu vào ngoài 5 chặng.
            to = (gy.get("don_vi") or "").strip().lower() != "kg"
            if not to and gy.get("so_luong") is None:
                # Giấy khổ rộng thiếu gsm / khổ: KHÔNG lấy số tờ dán nhãn kg — dòng cảnh báo, nhu cầu 0.
                d = self._dong_bai(bg, khoa_ton(HANG_GIAY, bg.giay_id, kho_rong=gy["kho_rong"]),
                                   gy.get("don_vi") or "kg", 0.0, neo)
                d["ly_do_loi"] = (gy.get("ly_do")
                                  or "Bài ghép chưa tính được khối lượng giấy khổ rộng.")
                tho.append(d)
                continue
            so_to = _f(gy["so_luong"]) or (_f(so_to_dict.get("to_nguyen_can")) if to else 0.0)
            if so_to <= 0:
                continue
            d = self._dong_bai(bg, khoa_ton(HANG_GIAY, bg.giay_id,
                                            goc=self._dv_to() if to else None,
                                            kho_rong=gy["kho_rong"], kho_dai=gy["kho_dai"]),
                               self._dv_to() if to else gy["don_vi"], so_to, neo)
            d["ly_do_chua_kho"] = "Bài ghép chưa có khổ giấy — khai khổ tờ in của bài."
            tho.append(d)

        # --- vật tư khai tay ở bước lệnh ------------------------------------
        buoc_map = {cd.id: (cd, l) for l in lenh for cd in l.cong_doans}
        bi_buoc_chung_de = self.repo.step_keys_bi_buoc_chung_de({bg.id for bg in bais})
        # Lệnh gia công TRỌN GÓI (spec gia công ngoài §4): nhà gia công lo vật tư. Xưởng cấp giấy
        # thì chỉ GIẤY còn là nhu cầu của xưởng; không thì lệnh không cần gì từ kho.
        from ..repositories.gia_cong_ngoai_repo import GiaCongNgoaiRepository

        gc_repo = GiaCongNgoaiRepository(self.db)
        lan_tg = gc_repo.tron_goi_cua_lenh({l.id for l in lenh})
        tron_goi = {i: bool(g.xuong_cap_giay) for i, g in lan_tg.items()}
        # Giấy của lệnh trọn gói XƯỞNG CẤP (06/10/2026): đã gửi đề nghị xuất ⇒ nhu cầu = đúng dòng
        # đề nghị (khổ + số tờ người kế hoạch chọn, cùng khoá với "đã cấp" nên kho xuất là trừ);
        # chưa gửi ⇒ dòng giấy khai ở bước như mọi lệnh, không có thì theo quy cách lệnh (phiếu
        # tính giá). Lần đã chốt số: hàng đã về, giấy không còn là việc phải lo.
        cap_mo = {i: g for i, g in lan_tg.items() if g.xuong_cap_giay and g.chot_luc is None}
        dong_xuat = gc_repo.dong_xuat_giay_cua_lan([g.id for g in cap_mo.values()])
        giay_theo_de_nghi = {i for i, g in cap_mo.items() if dong_xuat.get(g.id)}
        co_giay_buoc: set[int] = set()
        if buoc_map:
            vts = self.repo.vat_tu_theo_buoc_lenh(list(buoc_map))
            # Giấy: chỉ BƯỚC ĐẦU (theo thu_tu) mang mã đó lấy từ kho (spec 2026-10-01 §5); dòng ở các
            # bước sau là "nhận từ bước trước" — không phải nhu cầu.
            buoc_dau = self._buoc_dau_giay(vts, buoc_map)
            for vt in vts:
                cd, l = buoc_map[vt.lsx_cong_doan_id]
                if cd.step_key in bi_buoc_chung_de or _f(vt.so_luong) <= 0:
                    continue
                if l.id in tron_goi and not (l.id in cap_mo and vt.hang_loai == HANG_GIAY
                                             and l.id not in giay_theo_de_nghi):
                    continue
                if vt.hang_loai == HANG_GIAY and buoc_dau.get((l.id, vt.vat_tu_id)) != cd.id:
                    continue
                # `vt.hang_loai` chứ không đóng đinh `"vat_tu"`: từ 08/09/2026 dòng của bước có thể
                # trỏ vào danh mục GIẤY — đó là đường DUY NHẤT giấy vào bảng cân đối ở tầng lệnh.
                # Giấy mang khổ + đơn vị gốc của dòng (máy chủ ghi lúc lưu bước; dòng cũ chưa có
                # gốc thì suy từ ĐVT ở `_nap_mat_hang`), vật tư khác `(…, 0, 0, "")`.
                hang = khoa_ton(vt.hang_loai, vt.vat_tu_id,
                                goc=getattr(vt, "don_vi_goc", None) or "",
                                kho_rong=vt.kho_rong or 0, kho_dai=vt.kho_dai or 0)
                d = self._dong_lenh(l, hang, vt.don_vi_snapshot, _f(vt.so_luong), cd)
                tho.append(d)
                if vt.hang_loai == HANG_GIAY:
                    co_giay_buoc.add(l.id)
        tho.extend(self._giay_tron_goi(lenh_map, cap_mo, dong_xuat, co_giay_buoc))

        # --- lệnh/bài không sinh dòng nào: KHÔNG nói gì (23/09/2026) --------
        # Trước đây khối này đẻ danh sách `bo_qua` ("Lệnh chưa khai vật tư nào ở bước — kể cả
        # giấy.", "Bài ghép chưa chọn giấy chung.") để ba màn bày lên thành băng cảnh báo. Đã gỡ
        # hẳn: bảng cân đối chỉ cân đối thứ ĐÃ được khai, chưa khai thì vắng mặt, không phải một
        # cảnh báo phải đọc mỗi lần mở màn. Đèn vật tư ở Kế hoạch SX (`lsx_tong_quan`) và cảnh báo
        # phát hành (`xep_lich/release.py`) tự hỏi `GiuChoService.trang_thai`, không đọc danh sách
        # này. Đừng dựng lại nó ở tầng engine.

        # --- vật tư khai tay ở bước CHUNG của bài ---------------------------
        # Một câu cho mọi bài; giữ thứ tự bài → dòng vật tư như vòng hỏi từng bài trước đây.
        chung = {c.id: (c, bg) for bg in bais for c in self._buoc_chung(bg.id)}
        theo_bai: dict[int, list] = {}
        for vt in self.repo.vat_tu_theo_buoc_chung(list(chung)):
            theo_bai.setdefault(chung[vt.bai_ghep_cong_doan_id][1].id, []).append(vt)
        for bg in bais:
            for vt in theo_bai.get(bg.id, []):
                if _f(vt.so_luong) <= 0:
                    continue
                tho.append(
                    self._dong_bai(bg, ("vat_tu", int(vt.vat_tu_id), 0, 0, ""), vt.don_vi_snapshot,
                                   _f(vt.so_luong), chung[vt.bai_ghep_cong_doan_id][0])
                )
        return tho

    def _giay_tron_goi(self, lenh_map: dict, cap_mo: dict, dong_xuat: dict,
                       co_giay_buoc: set[int]) -> list[dict]:
        """Dòng giấy của lệnh trọn gói xưởng cấp — xem chú thích ở `_gom_nhu_cau`. Lệnh không chạy
        ở xưởng nên dòng không neo bước nào (`buoc_id=None`): không bước nào "chạy xong" làm nó rụng
        nhầm, và nó rụng đúng lúc lần gia công chốt số. Không query thêm (quy cách đọc sẵn)."""
        from .gia_cong_ngoai.tron_goi import de_xuat_tu_quy_cach

        ra: list[dict] = []
        for lsx_id, g in cap_mo.items():
            l = lenh_map.get(lsx_id)
            if l is None:
                continue
            dong = dong_xuat.get(g.id) or []
            if dong:
                for ln in dong:
                    # Cùng khoá với "đã cấp" (`_da_cap_dang_linh` đọc chính dòng này) ⇒ kho xuất là trừ.
                    hang = khoa_ton(HANG_GIAY, int(ln.hang_id),
                                    goc=getattr(ln, "don_vi_goc", None) or "",
                                    kho_rong=ln.kho_rong or 0, kho_dai=ln.kho_dai or 0)
                    d = self._dong_lenh(l, hang, ln.dvt, _f(ln.sl_de_nghi), None)
                    d["ten_viec"] = "Cấp giấy gia công trọn gói"
                    ra.append(d)
                continue
            if lsx_id in co_giay_buoc:
                continue
            dx = de_xuat_tu_quy_cach(l)
            if not (dx["giay_id"] and dx["kho_rong"] and dx["kho_dai"] and _f(dx["so_to"]) > 0):
                continue
            hang = khoa_ton(HANG_GIAY, dx["giay_id"], goc=self._dv_to(),
                            kho_rong=dx["kho_rong"], kho_dai=dx["kho_dai"])
            d = self._dong_lenh(l, hang, self._dv_to(), _f(dx["so_to"]), None)
            d["ten_viec"] = "Cấp giấy gia công trọn gói"
            ra.append(d)
        return ra

    @staticmethod
    def _buoc_dau_giay(vts, buoc_map) -> dict[tuple[int, int], int]:
        """`{(lsx_id, vat_tu_id): id bước}` — bước ĐẦU (thu_tu nhỏ nhất, hoà thì id nhỏ) có dòng giấy
        của mã đó trong lệnh. Thứ tự theo `thu_tu` của bước, không theo đồ thị phụ thuộc."""
        dau: dict[tuple[int, int], tuple] = {}
        for vt in vts:
            if vt.hang_loai != HANG_GIAY or _f(vt.so_luong) <= 0:
                continue
            cd, l = buoc_map[vt.lsx_cong_doan_id]
            k = (l.id, int(vt.vat_tu_id))
            moc = (cd.thu_tu or 0, cd.id)
            if k not in dau or moc < dau[k][0]:
                dau[k] = (moc, cd.id)
        return {k: v[1] for k, v in dau.items()}

    def _giay_bai_theo_buoc_dau(self, neo, qc_bai: dict, so_to: dict) -> dict | None:
        """Dòng giấy của BÀI theo đầu vào của bước chung ĐẦU (kể cả bước cắt tổ chèn). Số lượng lấy từ
        số tờ của bài, KHÔNG từ `so_luong_vao` của bước (bước cắt chung có thể để 0). Bước chưa khai
        đơn vị vào ⇒ None, tầng gọi dùng `goi_y_dong_giay` như trước."""
        from ..models.don_vi_do import TRAM_TO
        from .dong_giay import ban_do_tram, ma_cua_tram, tram_cua

        dv_vao = (getattr(neo, "don_vi_vao", None) or "").strip()
        if not dv_vao and getattr(neo, "nhom", None) == "print":
            # Bước In chưa khai đơn vị vào: In nhận TỜ IN (spec §5 — không bước cắt ⇒ mua khổ in).
            dv_vao = ma_cua_tram(TRAM_TO, ban_do_tram()) or ""
        if not dv_vao:
            return None

        to_nguyen = _f(so_to.get("to_nguyen_can"))
        vao = _f(so_to.get("tong_to")) if tram_cua(dv_vao, ban_do_tram()) == TRAM_TO else to_nguyen
        gy = dong_giay_theo_dau_vao(don_vi_vao=dv_vao, so_luong_vao=vao, so_luong_ra=to_nguyen,
                                    quy_cach=qc_bai, gsm=qc_bai.get("gsm"))
        gy["so_luong"] = _f(gy["so_luong"]) or None
        return gy

    def buoc_nhan_tu(self, lsx_id: int) -> dict[int, dict]:
        """`{lsx_cong_doan_id: {"hang_id", "tu_buoc"}}` cho dòng giấy KHÔNG phải bước đầu của mã —
        bước ấy nhận giấy từ bước trước (tên bước đứng ngay trước nó có cùng mã giấy)."""
        lenh = self.lsx_repo.theo_ids({int(lsx_id)})
        buoc_map = {cd.id: (cd, l) for l in lenh for cd in l.cong_doans}
        if not buoc_map:
            return {}
        vts = [v for v in self.repo.vat_tu_theo_buoc_lenh(list(buoc_map))
               if v.hang_loai == HANG_GIAY and _f(v.so_luong) > 0]
        # Cùng tập bước với `_gom_nhu_cau`: bước bị bước chung của bài đè, hay lệnh gia công trọn gói
        # mà xưởng không cấp giấy, không đóng góp gì — không được làm nhãn "nhận từ" nêu tên nó.
        bais = self._bai_trong_pham_vi({int(lsx_id)})
        bi_de = self.repo.step_keys_bi_buoc_chung_de({bg.id for bg in bais})
        from ..repositories.gia_cong_ngoai_repo import GiaCongNgoaiRepository

        tron_goi = GiaCongNgoaiRepository(self.db).tron_goi_dang_chay({l.id for l in lenh})

        def _dong_gop(v) -> bool:
            cd, l = buoc_map[v.lsx_cong_doan_id]
            return not (cd.step_key in bi_de or (l.id in tron_goi and not tron_goi[l.id]))

        theo_ma: dict[int, list] = {}
        for v in vts:
            cd = buoc_map[v.lsx_cong_doan_id][0]
            theo_ma.setdefault(int(v.vat_tu_id), []).append(((cd.thu_tu or 0, cd.id), cd, _dong_gop(v)))
        kq: dict[int, dict] = {}
        for hang_id, ds in theo_ma.items():
            ds.sort(key=lambda x: x[0])
            for i in range(1, len(ds)):
                _, cd, ok = ds[i]
                if not ok:
                    continue
                truoc = [x[1] for x in ds[:i] if x[2]]
                if truoc:
                    kq[cd.id] = {
                        "hang_id": hang_id, "tu_buoc": truoc[-1].ten,
                        # Dòng giấy (mã này, > 0) của chính bước — người gọi khỏi đọc lại DB.
                        "dong": [v for v in vts
                                 if v.lsx_cong_doan_id == cd.id and int(v.vat_tu_id) == hang_id],
                    }
        return kq

    def _bo_buoc_da_xong(self, tho: list[dict]) -> tuple[list[dict], dict[tuple, float]]:
        """Bỏ dòng của BƯỚC đã chạy xong — trả `(dòng còn lại, {khoá đã cấp: lượng coi như tiêu})`.

        Bản chất bảng cân đối là "CÒN phải lo gì". Một bước chạy xong tức là nó đã có đủ đồ để
        chạy — không còn gì để mua, để giữ chỗ, để nhắc. Trước 23/09/2026 dòng ấy nằm lại vĩnh
        viễn dưới dạng "đã cấp đủ" (xám, `con_phai_co = 0`), vì `lsx.trang_thai` dừng ở
        `da_phat_hanh` và không có mốc nào sau đó — bảng chỉ dài thêm, không bao giờ ngắn lại.

        Mốc rụng là BƯỚC, không phải LỆNH: vật tư neo vào đúng bước tiêu thụ nó (08/09/2026), nên
        lệnh in xong mà chưa cán màng thì dòng giấy rụng còn dòng keo vẫn ở lại. Chờ cả lệnh xong
        mới rụng là giữ lại đúng những dòng đã hết việc.

        Lượng trả về ở vế thứ hai theo ĐƠN VỊ GỐC (dòng đã qua `_quy_doi_dong`) và dùng CHÍNH khoá
        mà `_chay_con_tro` tra `da_cap` — khoá nào không khớp thì tầng gọi trừ 0, vô hại.
        """
        co_buoc = [d for d in tho if d.get("buoc_id")]
        if not co_buoc:
            return tho, {}
        xong_lsx, xong_bai = self.repo.buoc_da_chay_xong(
            lsx_buoc_ids={int(d["buoc_id"]) for d in co_buoc if not d.get("bai_ghep_id")},
            bai_buoc_ids={int(d["buoc_id"]) for d in co_buoc if d.get("bai_ghep_id")},
        )
        if not xong_lsx and not xong_bai:
            return tho, {}
        con_lai: list[dict] = []
        da_tieu: dict[tuple, float] = {}
        for d in tho:
            buoc = d.get("buoc_id")
            xong = bool(buoc) and (
                int(buoc) in (xong_bai if d.get("bai_ghep_id") else xong_lsx)
            )
            if not xong:
                con_lai.append(d)
                continue
            khoa = (d["hang"], d["lsx_id"], d["bai_ghep_id"])
            da_tieu[khoa] = da_tieu.get(khoa, 0.0) + _f(d.get("nhu_cau"))
        return con_lai, da_tieu

    def _buoc_chung(self, bai_ghep_id: int) -> list[BaiGhepCongDoan]:
        nap = getattr(self, "_chung_nap", None)
        if nap is not None and bai_ghep_id in nap:
            return nap[bai_ghep_id]
        return self.repo.buoc_chung(bai_ghep_id)

    def _bg(self):
        """Engine bài ghép, dựng một lần cho cả request. `sequence=None`: đường này chỉ ĐỌC."""
        if getattr(self, "_bg_svc", None) is None:
            from ..repositories.audit_repo import AuditLogRepository
            from .bai_ghep_service import BaiGhepService

            self._bg_svc = BaiGhepService(
                self.db, self.bai_ghep_repo, AuditLogRepository(self.db), None
            )
        return self._bg_svc

    def _tinh_so_to(self, bg: BaiGhep, lsx_map: dict) -> dict:
        """Số tờ NGUYÊN của cả bài — gọi thẳng engine bài ghép, KHÔNG tự cộng lại.

        Đây là chỗ dễ ngứa tay viết lại `so_to_tot + hao` cho nhanh. Đừng: `tinh_so_to` còn phải đi
        qua đúng cầu `to_nguyen → to` (số mảnh xả) và cộng hao TRƯỚC khi chia — cộng sau là đòi
        giấy gấp mấy lần. Một engine, một kết quả.
        """
        return self._bg().tinh_so_to(bg, lsx_map)

    def _dong_lenh(self, l: Lsx, hang, dvt, sl, buoc) -> dict:
        return {
            "hang": hang, "loai": "vat_tu", "lsx_id": l.id, "bai_ghep_id": None,
            "buoc_id": getattr(buoc, "id", None),
            "ma": l.ma, "ten_viec": getattr(buoc, "ten", None),
            "ten_sp": getattr(l, "ten", None) or None,
            "ngay_can": self._ngay_can_cua(hang, l.id, None),
            # "Lệnh của ai, giao ngày nào" — hai câu mà người lập kế hoạch luôn phải hỏi kèm khi
            # nhìn một dòng thiếu hàng. `han_giao_khach` là hạn KHÁCH (lấy từ đơn), khác
            # `han_sx` ở trên là hạn nội bộ do kế hoạch đặt — đừng thay nhau.
            "khach_ten": self._khach_cua(l.id),
            "han_giao_khach": getattr(l, "han_giao_khach", None),
            # Thứ tự ăn tồn — xem `_chay_con_tro`. Hạn là ngày NGƯỜI khai, không phải ngày suy.
            "han_sx": getattr(l, "han_hoan_thanh_sx", None),
            "dvt": dvt, "sl": sl,
            # Cờ GẤP của lệnh — chỉ để BÀY, máy không xếp ưu tiên hộ (chủ chốt 17/08/2026).
            # Người lập kế hoạch nhìn cờ rồi tự quyết nhả chỗ của lệnh nào.
            "is_rush": bool(getattr(l, "is_rush", False)),
        }

    def _khach_han_bai(self, lsx_map: dict) -> dict:
        """Khách + hạn giao của một BÀI, gộp từ các lệnh thành viên."""
        tens = sorted({t for t in (self._khach_cua(lid) for lid in (lsx_map or {})) if t})
        hans = [h for h in (getattr(l, "han_giao_khach", None)
                            for l in (lsx_map or {}).values()) if h]
        return {
            "khach_ten": (tens[0] if len(tens) == 1 else (f"{len(tens)} khách" if tens else None)),
            "han_giao_khach": min(hans) if hans else None,
        }

    def _dong_bai(self, bg: BaiGhep, hang, dvt, sl, buoc) -> dict:
        lsx_map = getattr(self, "_bai_ctx", {}).get(bg.id, {})
        # Bài chạy chung một lượt ⇒ xếp theo hạn SỚM NHẤT của các thành viên.
        hans = [h for h in (getattr(l, "han_hoan_thanh_sx", None)
                            for l in (lsx_map or {}).values()) if h]
        return {
            "hang": hang, "loai": "vat_tu", "lsx_id": None, "bai_ghep_id": bg.id,
            # Cùng lý do như `_dong_lenh`. Ở đây `buoc_id` là `bai_ghep_cong_doan.id` — KHÁC không
            # gian id với bước lệnh, nhưng cặp `(lsx_id, bai_ghep_id)` trong khoá đã phân biệt sẵn
            # (dòng bài luôn có `lsx_id=None`), nên không cần thêm cờ loại.
            "buoc_id": getattr(buoc, "id", None),
            "ma": bg.ma, "ten_viec": getattr(buoc, "ten", None),
            "ten_sp": getattr(bg, "ten", None) or None,
            "ngay_can": self._ngay_can_cua(hang, None, bg.id),
            "han_sx": min(hans) if hans else None,
            # Bài gom nhiều lệnh ⇒ có thể nhiều khách. Một tên thì nói tên; nhiều tên thì nói
            # ĐÚNG là "3 khách" chứ không bốc một cái tên làm đại diện — người đọc sẽ tưởng cả
            # bài của khách đó. Hạn giao lấy SỚM NHẤT, cùng lẽ với `han_sx` ngay trên.
            **self._khach_han_bai(lsx_map),
            "dvt": dvt, "sl": sl,
            # Bài GẤP khi có ÍT NHẤT MỘT thành viên gấp — cả bài chạy chung một lượt, không tách được.
            "is_rush": any(bool(getattr(l, "is_rush", False)) for l in (lsx_map or {}).values()),
        }

    # ---- (c) ----------------------------------------------------------------

    def _nap_mat_hang(self, tho: list[dict]) -> None:
        self._objs = self.hang.map_theo_cap(
            sorted({(d["hang"][0], int(d["hang"][1])) for d in tho if d["hang"]}))
        # Dòng giấy / vật tư chưa mang đơn vị gốc (dòng bước cũ, giấy khổ rộng của bài, vật tư bước
        # chung của bài) ⇒ suy từ ĐVT của dòng — phải đợi danh mục nạp xong mới biết đơn vị đã khai.
        for d in tho:
            h = d["hang"]
            if h and co_don_vi_goc(h[0]) and not h[4]:
                d["hang"] = (*h[:4], self._goc_cua(h[0], int(h[1]), d.get("dvt")))

    def _quy_doi_dong(self, tho: list[dict]) -> None:
        for d in tho:
            # Số trên dòng là số ĐÃ CHỐT (bước lệnh: người lập lệnh gõ / điền sẵn; bài ghép: engine
            # bài) — chỉ đổi ĐƠN VỊ ĐO, không chạy công thức nào nữa.
            if d.get("ly_do_loi"):
                kq = {"loi": d["ly_do_loi"], "cb": CB_KHONG_DOI_CHIEU}
            elif d["hang"][0] == HANG_GIAY and _giay_chua_kho(d["hang"], self._dv_to()):
                kq = {"loi": d.get("ly_do_chua_kho")
                      or "Dòng giấy chưa có khổ — sửa ở bước của lệnh.", "cb": CB_GIAY_CHUA_KHO}
            elif self._chua_khai(d["hang"]):
                # Đơn vị chưa khai ở danh mục (spec 2026-10-10 §3): không đối chiếu được với tồn
                # của mã — dòng "chưa rõ" kèm câu chỉ chỗ khai; nhóm mang `don_vi_chua_khai`.
                kq = {"loi": self.cau_chua_khai(d["hang"]), "cb": CB_KHONG_DOI_CHIEU}
            else:
                kq = self._ve_goc(d["hang"], d["dvt"], d["sl"])
            if "loi" in kq:
                d["nhu_cau"] = 0.0
                d["nhu_cau_hien_thi"] = "—" if d.get("ly_do_loi") else f"{_so(d['sl'])} {d['dvt']}"
                d["canh_bao"] = [kq.get("cb") or CB_KHONG_DOI_CHIEU]
                d["ly_do_canh_bao"] = kq["loi"]
            else:
                d["nhu_cau"] = kq["sl"]
                d["nhu_cau_hien_thi"] = kq["hien_thi"]
                d["canh_bao"] = []
                d["ly_do_canh_bao"] = None

    # ---- (d) ----------------------------------------------------------------

    def _chay_con_tro(self, tho, *, ton, dang_ve, da_cap, dang_linh, vet_mua=None,
                      peg=None, khac=None) -> list[dict]:
        # Phần đã cấp CÒN LẠI chưa gán cho dòng nào — bản sao để trừ dần, không đụng dict gốc.
        cap_con = dict(da_cap)
        theo_hang: dict[tuple, list[dict]] = {}
        for d in tho:
            theo_hang.setdefault(d["hang"], []).append(d)
        # PHẦN ĐẶT CHO LỆNH còn đang về (07/10/2026): chỉ ô đã đặt nó được dùng, không vào hàng
        # chung. Ô không còn trên bảng (lệnh xong, huỷ) thì phần của nó thành hàng chung.
        co_mat = {(d["hang"], d["lsx_id"], d["bai_ghep_id"]) for d in tho}
        peg_o: dict[tuple, float] = {}
        peg_hang: dict[tuple, float] = {}
        line_hang = {lid: h for h, ds in dang_ve.items() for _n, _sl, _m, lid in ds}
        for lid, theo_o in (peg or {}).items():
            h = line_hang.get(lid)
            if h is None:
                continue
            for k, sl in theo_o.items():
                if k in co_mat:
                    peg_o[k] = peg_o.get(k, 0.0) + sl
                    peg_hang[h] = peg_hang.get(h, 0.0) + sl

        ra: list[dict] = []
        for hang, ds in theo_hang.items():
            obj = self._obj(hang)
            chua_khai = self._chua_khai(hang)
            # THỨ TỰ ĂN TỒN = HẠN SẢN XUẤT (18/09/2026): lệnh phải xong trước được tính trước. Không
            # còn xếp theo ngày cần — ngày đó giờ chỉ có khi đã lập yêu cầu mua, tức sau khi bảng đã
            # cân đối xong. Lệnh chưa khai hạn xuống CUỐI: không được chen lên trước lệnh có hạn.
            ds.sort(key=lambda d: (d.get("han_sx") is None, d.get("han_sx") or date.max, d["ma"]))
            # Số dòng của cùng (mặt hàng, chủ thể) — quyết định có phải CHIA phần đã cấp không.
            so_dong_khoa: dict[tuple, int] = {}
            for d in ds:
                k = (hang, d["lsx_id"], d["bai_ghep_id"])
                so_dong_khoa[k] = so_dong_khoa.get(k, 0) + 1
            con_lai_chi_ton = float(ton.get(hang, 0.0))
            # ⚠️ Bẫy đếm hai lần #2: hàng đang về cộng MỘT lần, ở đây, cho cả mặt hàng — không có
            # phép trừ "đang mua" nào nữa ở dưới. Không so ngày về với ngày cần: hệ không suy ngày
            # cần, nên cũng không có "về muộn" để loại lô nào ra.
            # Hàng đang về CHUNG = tổng đang về − phần đã đặt cho lệnh còn trên bảng.
            con_lai = con_lai_chi_ton + max(0.0, sum(
                sl for _ngay, sl, _ma, _lid in dang_ve.get(hang, [])) - peg_hang.get(hang, 0.0))
            dong_out: list[dict] = []
            so_do = 0
            so_khong_ro = 0
            tong_can = 0.0
            for d in ds:
                khoa_cap = (hang, d["lsx_id"], d["bai_ghep_id"])
                cap_tong = _f(da_cap.get(khoa_cap))
                if so_dong_khoa.get(khoa_cap, 0) <= 1:
                    cap = cap_tong
                else:
                    cap = min(_f(cap_con.get(khoa_cap)), _f(d["nhu_cau"]))
                    cap_con[khoa_cap] = _f(cap_con.get(khoa_cap)) - cap
                linh = dang_linh.get(khoa_cap, 0.0)
                # ⚠️ Bẫy đếm hai lần #1: `cap` chỉ trừ vào NHU CẦU. Tồn (`con_lai`) đã giảm sẵn khi
                # kho ghi sổ — trừ thêm lần nữa là lệnh sau báo thiếu oan.
                #
                # Kẹp sàn 0: cấp DƯ không được biến thành hàng trả lại kho. Bản kế hoạch viết
                # `con_lai -= con_phai_co` trần, nhưng `con_phai_co` âm thì phép trừ đó CỘNG vào
                # tồn một số hàng không tồn tại.
                con_phai_co = max(0.0, _f(d["nhu_cau"]) - cap)
                # Phần đặt cho CHÍNH ô này trên đơn đang về phủ trước; phần còn lại mới ăn hàng chung.
                k_o = (hang, d["lsx_id"], d["bai_ghep_id"])
                dung_peg = min(con_phai_co, peg_o.get(k_o, 0.0))
                if dung_peg > 0:
                    peg_o[k_o] -= dung_peg
                phan_chung = con_phai_co - dung_peg
                truoc = con_lai
                con_lai -= phan_chung
                con_lai_chi_ton -= phan_chung
                if d["canh_bao"]:
                    # Nhu cầu = 0 vì KHÔNG ĐỔI ĐƯỢC (hoặc giấy chưa có khổ), không phải vì không cần. Rơi vào nhánh `xam`
                    # dưới là dán nhãn "đã cấp đủ" lên một dòng chưa ai tính nổi.
                    mau = MAU_KHONG_RO
                elif con_phai_co <= 0:
                    mau = MAU_XAM
                elif dung_peg <= 0 and con_lai_chi_ton >= 0:
                    mau = MAU_XANH          # đủ bằng chính tồn đang có
                elif con_lai >= 0:
                    mau = MAU_VANG          # chỉ đủ nhờ hàng đang về
                else:
                    mau = MAU_DO
                # Phần thiếu RIÊNG của dòng này = phần nó không được phủ. KHÔNG lấy `−con_lai`
                # (thiếu luỹ kế): tick hai dòng đỏ rồi gộp một yêu cầu mua thì số luỹ kế cộng
                # chồng lên nhau, đi mua thừa đúng phần đã đếm hai lần.
                thieu = max(0.0, phan_chung - max(0.0, truoc))
                if mau == MAU_DO:
                    so_do += 1
                elif mau == MAU_KHONG_RO:
                    so_khong_ro += 1
                tong_can += con_phai_co
                dong_out.append({
                    "loai": d["loai"],
                    "lsx_id": d["lsx_id"],
                    "bai_ghep_id": d["bai_ghep_id"],
                    "buoc_id": d.get("buoc_id"),
                    "is_rush": bool(d.get("is_rush")),
                    "ma": d["ma"],
                    "ten_viec": d["ten_viec"],
                    "ten_sp": d.get("ten_sp"),
                    "ngay_can": d["ngay_can"],
                    "khach_ten": d.get("khach_ten"),
                    "han_giao_khach": d.get("han_giao_khach"),
                    # Hạn SX = khoá xếp thứ tự ăn tồn ở trên — màn Tồn kho vẽ dự báo theo đúng mốc này.
                    "han_sx": d.get("han_sx"),
                    "nhu_cau": round(_f(d["nhu_cau"]), 4),
                    "nhu_cau_hien_thi": d["nhu_cau_hien_thi"],
                    "da_cap": round(cap, 4),
                    "dang_linh": round(linh, 4),
                    "con_phai_co": round(con_phai_co, 4),
                    "con_lai_sau": round(con_lai, 4),
                    "thieu": round(thieu, 4),
                    "trang_thai": mau,
                    "canh_bao": d["canh_bao"],
                    "ly_do_canh_bao": d["ly_do_canh_bao"],
                    # Cùng cờ của nhóm — dòng là đơn vị người tick để lập mua.
                    "don_vi_chua_khai": chua_khai,
                    # Đã có yêu cầu/đơn "Mua cho" lệnh này nhưng khác khổ/ĐVT (lỗi #23): không bù
                    # số (tờ và kg không quy đổi), chỉ để không ai đề nghị mua lần hai.
                    "mua_khac_quy_cach": list((khac or {}).get(
                        (hang[0], int(hang[1]), d["lsx_id"], d["bai_ghep_id"]), [])),
                })
            ra.append({
                "loai_nhom": "vat_tu",
                "hang_loai": hang[0],
                "hang_id": hang[1],
                "hang_ma": getattr(obj, "ma", None),
                "hang_ten": getattr(obj, "ten", None),
                # Nhóm = (mã, khổ, đơn vị gốc): giấy hai khổ là hai nhóm, cùng khổ mà một bên đếm tờ
                # một bên đếm kg cũng là hai nhóm; tồn của nhóm chỉ là lô đúng khoá.
                "kho_rong": hang[2],
                "kho_dai": hang[3],
                # MÃ đơn vị gốc — giấy / vật tư là phần thứ năm của khoá (`to` / kg / thùng…), hàng
                # khác là đơn vị giá của mã. Giữ chỗ dựng lại khoá nhóm từ chính ô này.
                "don_vi_goc": ((hang[4] if len(hang) >= 5 else "") if co_don_vi_goc(hang[0])
                               else getattr(obj, "don_vi_gia", None)) or None,
                # Nhu cầu ra đơn vị mã CHƯA khai ở danh mục (nhu cầu tờ của giấy chỉ khai kg) — bảng
                # báo ở dòng, KHÔNG cho lập mua (`gom_de_nghi` chặn). Câu đọc được ở `ly_do_chua_khai`.
                "don_vi_chua_khai": chua_khai,
                "ly_do_chua_khai": self.cau_chua_khai(hang) if chua_khai else None,
                "ton": round(float(ton.get(hang, 0.0)), 4),
                # Tồn / đang về CÙNG mã + CÙNG khổ nhưng KHÁC đơn vị gốc — chỉ để bày cạnh nhau,
                # máy KHÔNG trừ chéo (tờ và kg không quy đổi). Điền ở `_gan_cung_kho_khac_don_vi`.
                "cung_kho_khac_don_vi": [],
                "tong_can": round(tong_can, 4),
                "so_dong_do": so_do,
                "so_dong_khong_ro": so_khong_ro,
                # Vết mua treo ở MẶT HÀNG chứ không ở dòng: phiếu mua không biết lệnh nào, nó chỉ
                # biết mua món gì. Dán xuống từng dòng là bịa ra quan hệ phiếu↔lệnh không có thật.
                "phieu_mua": (vet_mua or {}).get(hang, []),
                "dong": dong_out,
            })
        # Nhóm không đánh giá được xếp ngay sau nhóm thiếu: cả hai đều là việc phải lo, chỉ khác
        # là một cái biết thiếu bao nhiêu, một cái chưa biết gì.
        ra.sort(key=lambda g: (-g["so_dong_do"], -g["so_dong_khong_ro"], g["hang_ma"] or "",
                               g["kho_rong"], g["kho_dai"]))
        return ra

    def _gan_cung_kho_khac_don_vi(self, nhom: list[dict], dang_ve: dict) -> None:
        """Điền `cung_kho_khac_don_vi` cho nhóm GIẤY / VẬT TƯ: tồn + hàng đang về của cùng mã + cùng
        khổ mà khác đơn vị gốc (vd nhóm cần 3.000 tờ khổ 1000 × 0 bên cạnh 800 kg cùng khổ trong kho;
        keo cần 20 kg bên cạnh 2 thùng keo — vật tư khổ 0 · 0).

        Người lập kế hoạch tự quyết có đem số kg đó đi xả tờ hay không — máy không cộng hộ vì tờ và
        kg không có hệ số. Một câu tồn cho mọi mã của bảng (`ton_moi_goc`)."""
        co_goc = [g for g in nhom if co_don_vi_goc(g["hang_loai"])]
        doc = getattr(self.repo, "ton_moi_goc", None)
        if not co_goc or doc is None:
            return
        ton_all = doc({(g["hang_loai"], int(g["hang_id"])) for g in co_goc})
        ve_all: dict[tuple, float] = {}
        for h, ds in dang_ve.items():
            if co_don_vi_goc(h[0]) and len(h) >= 5:
                k = (h[0], int(h[1]), int(h[2]), int(h[3]), h[4] or "")
                ve_all[k] = ve_all.get(k, 0.0) + sum(sl for _n, sl, _m, _l in ds)
        for g in co_goc:
            goc = g.get("don_vi_goc") or ""
            cung = (g["hang_loai"], int(g["hang_id"]), int(g["kho_rong"]), int(g["kho_dai"]))
            khac = sorted({k[4] for k in (*ton_all, *ve_all) if k[:4] == cung and k[4] != goc})
            ra = []
            for g2 in khac:
                t = ton_all.get((*cung, g2), 0.0)
                v = ve_all.get((*cung, g2), 0.0)
                if t <= 0 and v <= 0:
                    continue
                ra.append({"don_vi_goc": g2,
                           "don_vi_goc_ten": ((self._dvs.get(g2) or {}).get("ten") or g2
                                              or "chưa ghi đơn vị"),
                           "ton": round(t, 4), "dang_ve": round(v, 4)})
            g["cung_kho_khac_don_vi"] = ra

    # ---- 1.3 DÒNG CÔNG CỤ (khuôn bế) ---------------------------------------

    # ---- lọc hiển thị -------------------------------------------------------

    @staticmethod
    def _loc(nhom: list[dict], *, q: str | None, chi_thieu: bool) -> list[dict]:
        ra = nhom
        if q:
            k = q.strip().lower()
            ra = [
                g for g in ra
                if k in (g["hang_ma"] or "").lower()
                or k in (g["hang_ten"] or "").lower()
                or any(k in (d["ma"] or "").lower() for d in g["dong"])
            ]
        if chi_thieu:
            # Giữ NGUYÊN mọi dòng của nhóm còn lại: các dòng xám/xanh phía trên chính là thứ đã ăn
            # hết tồn, bỏ chúng đi thì con số "còn lại sau" trong bảng không cộng ra được nữa.
            #
            # Nhóm KHÔNG ĐÁNH GIÁ ĐƯỢC cũng ở lại: "chỉ thứ đang thiếu" nghĩa là "chỉ thứ phải lo",
            # mà thứ máy không tính nổi thì phải lo NHIỀU HƠN chứ không phải ít hơn. Lọc nó đi là
            # giấu đúng cái cần thấy.
            ra = [g for g in ra
                  if g["so_dong_do"] > 0
                  or g.get("so_dong_khong_ro", 0) > 0]
        return ra

    @staticmethod
    def loc_hien_thi(nhom: list[dict], *, hang_loai: str | None = None,
                     tinh_trang: str | None = None) -> tuple[list[dict], dict]:
        """Thanh tab + thanh lọc của màn Kế hoạch vật tư (06/10/2026) — lọc Ở MÁY CHỦ.

        Chạy SAU bảng cân đối đã cache (`q`), nên đổi tab không dựng lại bảng toàn xưởng. Số đếm
        tính trên tập đã qua `q` + `hang_loai` nhưng TRƯỚC `tinh_trang` — số trên tab không tự tụt
        theo chính tab đang chọn. `theo_loai` đếm trước `hang_loai` (số bên cạnh từng giá trị của
        điều kiện "Loại hàng").

        `tinh_trang`: `thieu` = nhóm có dòng đỏ; `khong_ro` = nhóm có dòng chưa đánh giá được;
        `du` = không dòng nào đỏ hay chưa rõ.
        """
        theo_loai: dict[str, int] = {}
        for g in nhom:
            theo_loai[g["hang_loai"]] = theo_loai.get(g["hang_loai"], 0) + 1
        ra = [g for g in nhom if not hang_loai or g["hang_loai"] == hang_loai]
        du = [g for g in ra if not g["so_dong_do"] and not g.get("so_dong_khong_ro", 0)]
        dem = {
            "so_nhom": len(ra),
            "so_dong_do": sum(g["so_dong_do"] for g in ra),
            "so_dong_khong_ro": sum(g.get("so_dong_khong_ro", 0) for g in ra),
            "so_nhom_du": len(du),
            "theo_loai": theo_loai,
        }
        if tinh_trang == "thieu":
            ra = [g for g in ra if g["so_dong_do"] > 0]
        elif tinh_trang == "khong_ro":
            ra = [g for g in ra if g.get("so_dong_khong_ro", 0) > 0]
        elif tinh_trang == "du":
            ra = du
        return ra, dem

    # ================== ĐỀ NGHỊ MUA ==================

    def gom_de_nghi(self, chon: list[dict]) -> dict:
        """Gom các dòng được tick thành MỘT yêu cầu mua bộ phận.

        Trả `{lines, needed_date, related_document_code, nguon}` để router gọi service thu mua hiện
        có — không đẻ đường tạo yêu cầu mua thứ hai.

        Số lượng = ĐÚNG phần thiếu của từng dòng, KHÔNG làm tròn ram/kiện: thu mua tự làm tròn lúc
        đặt, còn kế hoạch làm tròn thì con số gửi đi không còn kiểm lại được với bảng.

        `needed_date` luôn `None` (18/09/2026): người lập tự gõ ngày cần hàng trên form, và CHÍNH
        ngày đó quay về làm "Ngày cần" của lệnh qua `nguon` (khoá các dòng đã tick).
        """
        bang = self.can_doi()
        tra: dict[tuple, dict] = {}
        # Khoá BỎ phần đơn vị gốc → các khoá đủ — client cũ không gửi `don_vi_goc` thì vẫn tra ra
        # dòng khi mã + khổ + lệnh + bước chỉ có MỘT đơn vị gốc (gần như luôn vậy).
        tra_mo: dict[tuple, list[tuple]] = {}
        for g in bang["items"]:
            if g["loai_nhom"] != "vat_tu":
                continue
            for d in g["dong"]:
                k = _khoa_dong(g["hang_loai"], g["hang_id"], g["kho_rong"], g["kho_dai"],
                               g.get("don_vi_goc"), d)
                tra[k] = (g, d)
                tra_mo.setdefault(k[:4] + k[5:], []).append(k)
        lines: list[dict] = []
        mas: list[str] = []
        nguon: list[dict] = []
        gop: dict[tuple, dict] = {}
        # Khoá đã tick — CHỐNG TRÙNG. Client gửi hai lần cùng một khoá (bấm đúp, hoặc bảng cũ) thì
        # vòng dưới sẽ cộng `thieu` hai lượt và đi mua gấp đôi. `Set` chặn ngay tại cửa.
        da_xet: set[tuple] = set()
        for c in chon:
            loai = c.get("hang_loai")
            kr, kd = (chuan_kho(c.get("kho_rong"), c.get("kho_dai")) if loai == HANG_GIAY
                      else (0, 0))
            khoa = _khoa_dong(loai, int(c.get("hang_id") or 0), kr, kd, c.get("don_vi_goc"), c)
            if co_don_vi_goc(loai) and not khoa[4]:
                ung = tra_mo.get(khoa[:4] + khoa[5:], [])
                if len(ung) == 1:
                    khoa = ung[0]
            if khoa in da_xet:
                continue
            da_xet.add(khoa)
            found = tra.get(khoa)
            if found is None:
                raise KeHoachVatTuValidationError(
                    "Dòng đã đổi kể từ lúc mở bảng (được cấp hoặc đã có hàng về) — tải lại bảng "
                    "cân đối rồi chọn lại."
                )
            g, d = found
            if g.get("don_vi_chua_khai"):
                # Nhu cầu ra đơn vị mã chưa khai: mua về cũng không nhập kho được (máy chủ chặn
                # đơn vị chưa khai) — khai đơn vị ở danh mục trước.
                raise KeHoachVatTuValidationError(
                    (g.get("ly_do_chua_khai") or "Chưa khai đơn vị này ở danh mục.")
                    + " Khai thêm đơn vị ở danh mục rồi mới đề nghị mua."
                )
            if _f(d["thieu"]) <= 0:
                raise KeHoachVatTuValidationError(
                    f"Dòng {d['ma']} không còn thiếu — không đề nghị mua nữa."
                )
            # Gộp theo khoá tồn (mã, khổ, đơn vị gốc): hai khổ — hay cùng khổ một tờ một kg — của
            # cùng mã giấy là hai dòng yêu cầu mua.
            key = khoa_ton(g["hang_loai"], g["hang_id"], goc=khoa[4], kho_rong=g["kho_rong"],
                           kho_dai=g["kho_dai"])
            # MỘT ô MỘT phiếu: ô đã có phiếu còn chạy thì không đề nghị lần hai.
            ph = (self.mach["theo_o"].get((key, d.get("lsx_id"), d.get("bai_ghep_id")))
                  or {}).get("phieu")
            if ph is not None:
                raise KeHoachVatTuValidationError(
                    f"Lệnh {d['ma']} đã có phiếu {ph['ma']} cho mặt hàng này. Huỷ phiếu đó trước "
                    "rồi mới đề nghị lại."
                )
            cur = gop.setdefault(key, {"g": g, "sl": 0.0})
            cur["sl"] += _f(d["thieu"])
            if d["ma"] not in mas:
                mas.append(d["ma"])
            nguon.append({
                "hang_loai": g["hang_loai"], "hang_id": g["hang_id"],
                "kho_rong": g["kho_rong"], "kho_dai": g["kho_dai"], "don_vi_goc": khoa[4],
                "lsx_id": d.get("lsx_id"), "bai_ghep_id": d.get("bai_ghep_id"),
                "buoc_id": d.get("buoc_id"),
                # Số đề nghị của dòng — đơn mua lập từ yêu cầu chia phần đặt cho lệnh theo số này.
                "so_luong": round(_f(d["thieu"]), 4),
            })
        if not gop:
            raise KeHoachVatTuValidationError("Chưa chọn dòng nào.")
        for (loai, hid, kr, kd, _goc), cur in gop.items():
            g = cur["g"]
            lines.append({
                "hang_loai": loai,
                "hang_id": hid,
                # Khổ CẦN — thu mua chép sang khổ MUA (sửa được) lúc lập đơn.
                "kho_rong": kr,
                "kho_dai": kd,
                "item_name": g["hang_ten"],
                "unit": g["don_vi_goc"] or "",
                # Làm tròn LÊN tới 0,01: cột `quantity` là Numeric(14,2) và ô số lượng trên form
                # YCMH đi bước 0,01 — số 3 lẻ (vd 79,475) bị trình duyệt chặn Lưu. Mua dư một chút
                # thì còn phủ đủ chỗ thiếu; làm tròn xuống là mua hụt.
                "quantity": math.ceil(round(cur["sl"] * 100, 6)) / 100,
            })
        return {
            "lines": lines,
            "needed_date": None,
            "related_document_code": _gop_ma(mas),
            "nguon": nguon,
        }
