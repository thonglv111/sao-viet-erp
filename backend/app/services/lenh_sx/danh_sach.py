"""Tầng DANH SÁCH của màn "Hồ sơ lệnh sản xuất" — tra cứu mọi lệnh đã phát hành (làm gọn 05/10/2026).

`danh_sach()` trả bảng + facet bốn tab theo KHÂU (`trang_thai.khau`): Tất cả · Đang sản xuất ·
Sau sản xuất · Đã giao đủ. Khâu không đọc cờ cảnh báo, nên danh sách KHÔNG chạy `can_doi()` lẫn
đường găng — cảnh báo là việc của màn Theo dõi (`theo_doi.py`).

Lọc hai tầng, như trước:
  TẦNG 1 — SQL (`_loc_sql`): phạm vi người bán + đã phát hành, `q`, khách, khoảng hạn SX.
  TẦNG 2 — Python: lệnh đã giao hết tách bằng `_tach_da_giao_het` (A7, không nạp); lệnh còn sống
           qua MỘT `boi_canh.nap()` rồi `khau()` ⇒ đếm tab ⇒ lọc tab ⇒ sắp ⇒ cắt trang.

Sắp: tab Đang sản xuất và Sau sản xuất giữ GẤP → hạn tăng → mã (`_khoa_sap`); tab Tất cả và Đã giao
đủ là tra cứu nên hạn GIẢM dần → mã (`_khoa_sap_tra_cuu`) — xếp tăng thì trang 1 toàn lệnh cũ.

`_soi`, `buoc_hien_tai`, `may_cua_buoc`, `chang` giữ nguyên chữ ký: đơn hàng bán
(`services/don_hang_tien_do.py`) và Theo dõi gọi chúng.

Không một số tiền nào: hàm dựng dòng chỉ chạm mã · tên · khách · đơn · số lượng · hạn · khâu.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ...models.bai_ghep_cong_doan import BaiGhepCongDoanMap
from ...models.customer import Customer
from ...models.lsx import TT_DA_DONG, Lsx, LsxCongDoan
from ...models.order import Order
from ...models.san_xuat import BUOC_THUE_NGOAI, CV_DANG_CHAY, CV_HOAN_THANH, CV_TAM_DUNG, SanXuatCongViec
from ...models.san_xuat_kcs import KCS_KHONG_DAT
from ...repositories.lenh_sx_doc_repo import LenhNhe, LenhSxDocRepository
from ...repositories.loc_danh_sach import dk_khoang_ngay
from ..can_doi_cache import lay_hoac_tinh
from . import boi_canh, pham_vi, tien_do, trang_thai
from .boi_canh import BoiCanh

# Tab "tất cả" đứng cạnh ba khâu của `trang_thai.KHAU`; giá trị đi thẳng ra `?tab=` của API.
TAB_TAT_CA = "tat_ca"
TAB_CHO_PHEP = (TAB_TAT_CA,) + trang_thai.KHAU

PAGE_SIZE_MAC_DINH = 50
PAGE_SIZE_TOI_DA = 200

# Trạng thái MỘT chặng trên dải công đoạn của dòng bảng. Bốn giá trị này là HỢP ĐỒNG với
# `.hslsx__chang--*` bên `frontend/src/pages/lenh-san-xuat.css` — đổi chuỗi ở đây là đốt mất màu
# bên kia mà không ai báo. Chúng KHÁC `CV_*` của model: `CV_PHAT_HANH` và mọi thứ chưa chạy đều
# gộp về `cho`, còn một bước tách nhiều lần chạy thì bốn giá trị này nói về CẢ chặng.
CHANG_XONG = "xong"
CHANG_CHAY = "chay"
CHANG_DUNG = "dung"
CHANG_CHO = "cho"

# Mốc "vô cùng" để sắp xếp: lệnh KHÔNG có hạn SX xuống cuối bảng (không có hạn thì không gấp),
# công việc chưa xếp lịch xuống cuối chuỗi bước.
_NGAY_XA = date(9999, 12, 31)
_LUC_XA = datetime(9999, 12, 31, tzinfo=timezone.utc)
_LUC_XUA = datetime(1, 1, 1, tzinfo=timezone.utc)


def _aware(dt: datetime) -> datetime:
    """SQLite trả datetime NAIVE — ép aware UTC trước khi so/trừ (bẫy tái phát của repo). Khai lại
    cục bộ thay vì import `tien_do._aware` (tên `_`-riêng tư của module khác), đúng thói quen sẵn
    có của gói này."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


# --- TẦNG 1: những gì SQL nói được ---------------------------------------------------------------
def _co_buoc(cot_cong_viec, cot_routing, gia_tri):
    """"Lệnh này có bước nào mang `gia_tri` không" — hỏi BA nơi bước có thể sống.

    · `san_xuat_cong_viec` NEO THẲNG (`lsx_id = Lsx.id`) — snapshot lúc phát hành, và là nơi thực
      thi GHI ĐÈ về sau (`thuc_thi.doi_may` đổi máy giữa chừng). Sự thật hiện hành của bước RIÊNG.
    · `san_xuat_cong_viec` QUA CẦU GHÉP — bước bị BÀI GHÉP phủ KHÔNG đẻ công việc riêng: cả cụm
      dùng CHUNG một công việc mang `lsx_id IS NULL` + `bai_ghep_cong_doan_id`
      (`snapshot.dung_cong_viec`). Vế đầu không với tới nó, và máy/nhóm THẬT của ca in ghép chỉ
      nằm ở đây — `bai_ghep_cong_doan.may_id` được chụp vào công việc chung lúc phát hành và
      KHÔNG chỗ nào ghi ngược về `lsx_cong_doan.may_id` (grep cả `bai_ghep_service` lẫn
      `bai_ghep_2_service`: 0 chỗ ghi). Thiếu vế này thì lọc `?may_id=` bỏ sót đúng lệnh in ghép ở
      đúng khâu nặng nhất của nó — bảng hiện tên máy mà lọc theo chính máy đó lại trả rỗng.
      Cầu: `san_xuat_cong_viec.bai_ghep_cong_doan_id` → `bai_ghep_cong_doan_map` → `lsx_id`
      (`models/bai_ghep_cong_doan.py:146` — bảng phủ neo bằng `lsx_step_key`, nhưng nó có sẵn cột
      `lsx_id` nên không phải đi vòng qua `step_key`).
    · `lsx_cong_doan` = routing của chính lệnh. Bắt ca bước đã khai máy/nhóm ở routing mà snapshot
      chưa mang (`thoi_gian_lsx_step` trả `None` thì `snapshot` lùi về `cd.may_id`, nhưng routing
      sửa SAU phát hành thì hai bên lệch).

    Ba `EXISTS` trong cùng một `WHERE` ⇒ vẫn MỘT câu SQL, không phải ba lượt đi DB.
    """
    return or_(
        select(SanXuatCongViec.id)
        .where(SanXuatCongViec.lsx_id == Lsx.id, cot_cong_viec == gia_tri)
        .exists(),
        select(SanXuatCongViec.id)
        .join(
            BaiGhepCongDoanMap,
            BaiGhepCongDoanMap.bai_ghep_cong_doan_id
            == SanXuatCongViec.bai_ghep_cong_doan_id,
        )
        .where(BaiGhepCongDoanMap.lsx_id == Lsx.id, cot_cong_viec == gia_tri)
        .exists(),
        select(LsxCongDoan.id)
        .where(LsxCongDoan.lsx_id == Lsx.id, cot_routing == gia_tri)
        .exists(),
    )


# Mốc ngày của dải kỳ (06/10/2026): (cột, là cột Date). Mặc định `tao` = ngày tạo lệnh. Hạn SX nội
# bộ đã gỡ 08/11/2026: `moc=han_sx` của link cũ vẫn nhận và hiểu như hạn giao.
MOC = {
    "tao": (Lsx.created_at, False),
    "han_giao": (Lsx.han_giao_khach, True),
    "han_sx": (Lsx.han_giao_khach, True),
}


def _loc_sql(
    sale_ids: set[int] | None, *,
    q: str | None, khach_hang_id: int | None, tu_ngay: date | None, den_ngay: date | None,
    moc: str = "tao", order_id: int | None = None, gia_cong: str | None = None,
    phu_trach_id: int | None = None,
):
    """`select(Lsx.id)` đã gắn hết phần lọc SQL diễn đạt được.

    Khoảng ngày soi cột theo `moc` (`MOC`); với mốc hạn, lệnh chưa có hạn rơi ra ngoài mọi khoảng.
    Khách đi qua SUBQUERY trên `orders`, không `join`: phạm vi hẹp có thể đã join `orders` rồi.
    """
    stmt = pham_vi.loc_lsx_da_phat_hanh(select(Lsx.id), sale_ids)

    if q and q.strip():
        mau = f"%{q.strip()}%"
        don_khop = (
            select(Order.id)
            .outerjoin(Customer, Customer.id == Order.customer_id)
            .where(or_(Order.order_no.ilike(mau), Customer.name.ilike(mau)))
        )
        stmt = stmt.where(
            or_(Lsx.ma.ilike(mau), Lsx.ten.ilike(mau), Lsx.order_id.in_(don_khop))
        )
    if khach_hang_id is not None:
        stmt = stmt.where(
            Lsx.order_id.in_(select(Order.id).where(Order.customer_id == khach_hang_id))
        )
    if order_id is not None:
        stmt = stmt.where(Lsx.order_id == order_id)
    if phu_trach_id is not None:
        stmt = stmt.where(Lsx.order_id.in_(select(Order.id).where(pham_vi.chu_don() == phu_trach_id)))
    if gia_cong:
        from ...repositories.gia_cong_ngoai_repo import lsx_ids_loc_gia_cong

        stmt = stmt.where(Lsx.id.in_(lsx_ids_loc_gia_cong(gia_cong)))
    cot, la_ngay = MOC.get(moc, MOC["tao"])
    for dk in dk_khoang_ngay(cot, tu_ngay, den_ngay, cot_ngay=la_ngay):
        stmt = stmt.where(dk)
    return stmt


# --- TẦNG 2: những gì chỉ tính lúc đọc mới biết ---------------------------------------------------
def _soi(db: Session, lsx_ids: list[int], bay_gio: datetime) -> tuple[BoiCanh, dict[int, dict]]:
    """MỘT lượt nạp + MỘT lượt đọc đèn vật tư cho CẢ TẬP, rồi tính trạng thái từng lệnh.

    `den_vat_tu` BẮT BUỘC truyền vào `trang_thai_chinh`/`co_canh_bao`: bỏ trống là im lặng bỏ cờ
    `thieu_vat_tu` (xem docstring `trang_thai.py`), và khi đó tab Cảnh báo thiếu người mà không ai
    """
    bc = boi_canh.nap(db, lsx_ids)
    den = _den_vat_tu_co_cache(db, lsx_ids)
    ket: dict[int, dict] = {}
    for i in lsx_ids:
        co = trang_thai.co_canh_bao(bc, i, bay_gio, den_vat_tu=den)
        tt = trang_thai.trang_thai_chinh(bc, i, bay_gio, den_vat_tu=den)
        ket[i] = {
            "canh_bao": co,
            "trang_thai": tt,
            "tre": trang_thai.CO_TRE_HAN in co,
        }
    return bc, ket


def _den_vat_tu_co_cache(db: Session, lsx_ids: list[int]) -> dict[int, str]:
    """Đèn vật tư qua cache 45 giây của bảng cân đối (`services/can_doi_cache.py`), khoá theo TẬP
    lệnh. Màn tải lại CẢ `danh_sach` lẫn `summary` sau MỖI sự kiện SSE, mỗi lượt là một lần
    `can_doi()` — cache cho hai lượt ấy (và mọi tab đang mở cùng tập) dùng chung một kết quả.

    Đèn không phụ thuộc người gọi: phạm vi người bán đã cắt ở tầng 1, nên cùng tập id ⇒ cùng đèn.
    Xoá sớm ở chính những chỗ đang xoá cache cân đối (giữ chỗ, ghi sổ kho, lệnh, xếp lịch); chỗ
    khác thì đèn trễ tối đa 45 giây — đèn chỉ để NHÌN, vật tư không chặn xếp lịch hay phát hành. JSON làm khoá dict thành chuỗi nên đổi lại về int."""
    tho = lay_hoac_tinh(
        lambda: {str(k): v for k, v in trang_thai.den_vat_tu_theo_lo(db, lsx_ids).items()},
        loai="den_lenh_sx", lsx_ids=sorted(lsx_ids),
    )
    return {int(k): v for k, v in tho.items()}


def _bat_dau(cv: SanXuatCongViec) -> datetime:
    return _aware(cv.du_kien_bat_dau) if cv.du_kien_bat_dau is not None else _LUC_XA


def _ket_thuc(cv: SanXuatCongViec) -> datetime:
    return _aware(cv.du_kien_ket_thuc) if cv.du_kien_ket_thuc is not None else _LUC_XUA


def buoc_hien_tai(bc: BoiCanh, lsx_id: int) -> SanXuatCongViec | None:
    """Bước để hiện ở cột "Công đoạn": ĐANG CHẠY > TẠM DỪNG > bước chờ sớm nhất > bước cuối đã xong.

    Đọc `cong_viec_du` chứ không `cong_viec`: ca in GHÉP là bước nặng nhất của lệnh và nó nằm ở
    công việc chung; bỏ nó đi thì lệnh đang chạy máy in lại hiện tên bước chế bản.

    Lệnh đã xong hết bước vẫn hiện bước CUỐI (không để trống): "Đóng gói" nói đúng lệnh dừng ở đâu,
    còn một ô rỗng thì người đọc không phân biệt được với "chưa có routing".
    """
    cvs = bc.cong_viec_du(lsx_id)
    if not cvs:
        return None
    for tt in (CV_DANG_CHAY, CV_TAM_DUNG):
        nhom = [cv for cv in cvs if cv.trang_thai == tt]
        if nhom:
            return min(nhom, key=lambda cv: (_bat_dau(cv), cv.id))
    cho = [cv for cv in cvs if cv.trang_thai != CV_HOAN_THANH]
    if cho:
        return min(cho, key=lambda cv: (_bat_dau(cv), cv.id))
    return max(cvs, key=lambda cv: (_ket_thuc(cv), cv.id))


def may_cua_buoc(bc: BoiCanh, cv: SanXuatCongViec | None) -> int | None:
    """Máy của bước đang xét: `cong_viec.may_id` — máy HIỆN TẠI, `thuc_thi.doi_may` ghi vào đây.

    Nhánh lùi về phiên chạy là PHÒNG THỦ CHIỀU SÂU, không phải một ca đang sống: `bat_dau`
    chụp `cv.may_id` vào phiên (`thuc_thi.py:281`) và `doi_may` ghi cả hai (`:473` và `:491`), nên
    hôm nay `cv.may_id IS NULL` kéo theo mọi phiên của nó cũng `may_id IS NULL` — vòng lặp dưới
    không bao giờ trả khác `None`. Giữ lại vì nó rẻ (đọc bộ nhớ) và vì đường ghi phiên có thể đổi;
    ĐỪNG đọc nó như bằng chứng rằng ca ấy có thật.
    """
    if cv is None:
        return None
    if cv.may_id is not None:
        return cv.may_id
    for p in sorted(bc.phien[cv.id], key=lambda p: _aware(p.bat_dau), reverse=True):
        if p.may_id is not None:
            return p.may_id
    return None


def _khoa_chang(cv: SanXuatCongViec) -> str:
    """Khoá gộp của một chặng.

    `step_key` NULLABLE (`models/san_xuat.py`) nên phải có đường lùi, và đường lùi phải là id của
    CHÍNH công việc chứ không phải tên: hai bước trùng tên trong một lệnh (in mặt trước / in mặt
    sau đều tên "In") mà lùi về tên là bị gộp làm một chặng.
    """
    return cv.step_key or f"cv:{cv.id}"


def _ten_chang(cv: SanXuatCongViec) -> str:
    """Tên công đoạn ĐÃ BỎ hậu tố phân đoạn.

    `snapshot._ten_phan_doan` gắn " (lần 1/2)" vào `ten_cong_doan` của từng lần chạy để tổ phân
    biệt hai thẻ cùng công đoạn trên bàn. Nhưng dải chặng gộp mọi lần chạy về MỘT đốt, nên đốt đó
    phải mang tên bước — "In" — chứ không phải "In (lần 1/2)", vốn vừa sai nghĩa vừa dài gấp đôi
    trong một ô rộng vài chục pixel.

    Dựng lại hậu tố từ CHÍNH cặp cột `phan_doan_so`/`phan_doan_tong` rồi mới cắt, không dò bằng
    biểu thức chính quy: khớp hụt thì trả nguyên tên (chấp nhận được), còn regex khớp thừa là ăn
    mất một khúc tên bước thật.
    """
    ten = cv.ten_cong_doan or ""
    tong = cv.phan_doan_tong or 1
    if tong > 1:
        hau_to = f" (lần {cv.phan_doan_so}/{tong})"
        if ten.endswith(hau_to):
            return ten[: -len(hau_to)]
    return ten


def chang(bc: BoiCanh, lsx_id: int, cv_nay: SanXuatCongViec | None) -> list[dict]:
    """Dải chặng của MỘT lệnh — mỗi công đoạn một đốt, để bảng vẽ được cả ĐƯỜNG ĐI chứ không chỉ
    bước đang chạy.

    KHÔNG tốn thêm câu SQL nào: `cong_viec_du` đọc từ `BoiCanh` mà `boi_canh.nap` đã nạp một lượt
    cho cả trang. Đừng sửa thành đọc `LsxCongDoan` ngay tại đây — làm thế là đẻ ra một vòng N+1
    đúng 50 lượt mỗi lần lật trang.

    GỘP theo `step_key`: một bước tách N lần chạy (mg `0254`) đẻ N công việc CÙNG `step_key`,
    nhưng trên dải nó vẫn là MỘT công đoạn. Không gộp thì lệnh nào có bước tách cũng dài gấp đôi
    và người đọc tưởng xưởng phải chạy thêm bước.

    Sắp theo `du_kien_bat_dau`, KHÔNG theo `thu_tu`: `thu_tu` là thứ tự GÕ ở bảng kế hoạch — bìa
    và ruột chạy song song vẫn mang số 1 và 2 (xem `ho_so._lop_topo`). Dải này là một trục THỜI
    GIAN, nên hai bước song song đứng cạnh nhau là đúng; xếp theo `thu_tu` là vẽ ra một chuỗi
    tuần tự không có thật. Bước chưa xếp lịch (`du_kien_bat_dau IS NULL`) rơi xuống cuối nhờ mốc
    `_LUC_XA` của `_bat_dau`.

    `hien_tai` bám ĐÚNG `buoc_hien_tai` mà cột "Công đoạn" đang hiện — hai chỗ lệch nhau thì dải
    chỉ một đốt còn chữ nói một bước khác, và người đọc mất lòng tin vào cả hai.
    """
    cvs = bc.cong_viec_du(lsx_id)
    if not cvs:
        return []
    khoa_nay = _khoa_chang(cv_nay) if cv_nay is not None else None
    # `dict` giữ thứ tự chèn (3.7+) và ta chèn theo thứ tự đã sắp, nên mỗi chặng đứng đúng chỗ
    # của LẦN CHẠY SỚM NHẤT của nó.
    nhom: dict[str, list[SanXuatCongViec]] = {}
    for cv in sorted(cvs, key=lambda c: (_bat_dau(c), c.id)):
        nhom.setdefault(_khoa_chang(cv), []).append(cv)
    ra: list[dict] = []
    for khoa, ds in nhom.items():
        tts = {cv.trang_thai for cv in ds}
        # Thứ tự xét CÓ Ý: một bước tách ba lần chạy mà một lần đang chạy thì cả chặng là "đang
        # chạy", dù hai lần kia đã xong. "Xong" chỉ khi KHÔNG còn lần nào chưa xong.
        if tts == {CV_HOAN_THANH}:
            tt = CHANG_XONG
        elif CV_DANG_CHAY in tts:
            tt = CHANG_CHAY
        elif CV_TAM_DUNG in tts:
            tt = CHANG_DUNG
        else:
            tt = CHANG_CHO
        ra.append({
            "ten": _ten_chang(ds[0]),
            "nhom": ds[0].nhom_cong_doan,
            "trang_thai": tt,
            "hien_tai": khoa == khoa_nay,
            # Bước thuê ngoài (viền cam trên tuyến bước) và bước có lô KCS không đạt (viền đỏ mảnh).
            "ngoai": any(cv.loai_buoc == BUOC_THUE_NGOAI or cv.gia_cong_ngoai_id is not None for cv in ds),
            "kcs_loi": any(k.ket_luan == KCS_KHONG_DAT for cv in ds for k in bc.kcs.get(cv.id, ())),
        })
    return ra


def _dong(bc: BoiCanh, lsx_id: int, khau_ct: tuple[str, str | None],
          tron_goi: dict[int, str | None] | None = None) -> dict:
    """MỘT dòng bảng tra cứu: cột tĩnh + tuyến bước (12/10/2026, chỉ đọc bảng bước và trạng thái
    việc đã nạp — không chạy dự kiến xong). Lệnh gia công trọn gói gộp về MỘT bước: routing mẫu
    của nó không ai ghi nên không bày ra."""
    tron_goi = tron_goi or {}
    lsx = bc.lenh[lsx_id]
    don = bc.don.get(lsx.order_id)
    khach = bc.khach.get(don.customer_id) if don is not None and don.customer_id else None
    return {
        "id": lsx.id,
        "ma": lsx.ma,
        "ten": lsx.ten,
        "so_luong_dat": lsx.so_luong_dat,
        "don_vi_tinh": lsx.don_vi_tinh,
        "khach_hang": khach.name if khach is not None else None,
        "order_id": lsx.order_id,
        "order_no": don.order_no if don is not None else None,
        "han_hoan_thanh_sx": lsx.han_hoan_thanh_sx,
        "is_rush": bool(lsx.is_rush),
        "khau": khau_ct[0],
        "khau_chi_tiet": khau_ct[1],
        "da_dong": lsx.trang_thai == TT_DA_DONG,
        "created_at": lsx.created_at,
        "han_giao_khach": lsx.han_giao_khach,
        "tron_goi": lsx_id in tron_goi,
        "nha_gia_cong": tron_goi.get(lsx_id),
        "chang": [] if lsx_id in tron_goi else chang(bc, lsx_id, buoc_hien_tai(bc, lsx_id)),
    }


def _khoa_sap(lsx: LenhNhe) -> tuple:
    """Thứ tự mặc định: GẤP trước · hạn SX gần trước · mã lệnh.

    Sắp ở Python chứ không `ORDER BY`: tập đã nằm sẵn trong bộ nhớ (tầng 2 phải duyệt hết để đếm
    tab), và `NULLS LAST` thì SQLite với Postgres không nói cùng một câu — cắt trang mà thứ tự
    lệch giữa hai DB là lỗi chỉ hiện ra trên production.

    Mã lệnh đứng cuối khoá để thứ tự TOÀN PHẦN: hai lệnh cùng độ gấp cùng hạn mà không có nấc phân
    giải cuối thì trang 1 và trang 2 có quyền chồng nhau.

    Nhận `LenhNhe` (ba cột phẳng) chứ không `bc.lenh[...]`: từ A7 lệnh đã giao hết KHÔNG qua
    `boi_canh.nap()` nữa, nhưng vẫn phải đứng đúng chỗ trong tab Hoàn thành / Tất cả.
    """
    return (0 if lsx.is_rush else 1, lsx.han_giao_khach or _NGAY_XA, lsx.ma or "")


def _khoa_sap_tra_cuu(lsx: LenhNhe) -> tuple:
    """Tab Tất cả / Đã giao đủ: hạn giao GIẢM dần, lệnh chưa có hạn xuống cuối, mã làm nấc cuối để
    thứ tự toàn phần (trang 1 và trang 2 không chồng nhau)."""
    han = lsx.han_giao_khach
    return (0 if han is not None else 1, -han.toordinal() if han is not None else 0, lsx.ma or "")


def _tach_da_giao_het(db: Session, ids: list[int]) -> tuple[dict[int, LenhNhe], set[int]]:
    """`(cột nhẹ của MỌI lệnh, tập lệnh ĐÃ GIAO HẾT)` — MỘT câu SQL, không nạp đối tượng con nào.

    Đây là cửa "lọc còn sống" của A7 (28/09/2026). Lệnh đã giao hết CHẮC CHẮN ra `TAB_HOAN_THANH`
    — luật số 1 của `trang_thai_chinh`, ăn trước mọi nhánh, không đọc gì ngoài hai con số này — nên
    xếp tab cho nó không cần `boi_canh.nap()` lẫn `can_doi()`. Phán quyết đi qua ĐÚNG
    `trang_thai.giao_du` (lõi của `_da_giao_het`), và `da_giao` cộng y câu 11b của `boi_canh`: tập
    này là tập CON chính xác của những lệnh `_soi` sẽ xếp vào Hoàn thành, không rộng hơn một lệnh.

    Vì sao cắt theo GIAO HẾT chứ không theo `da_dong`: KCS đóng lệnh xong hàng vẫn có thể chưa giao
    — lệnh đó còn ở tab trước Hoàn thành. Lệnh giao xong từ năm ngoái thì vẫn nằm trong tầng 1 mãi
    mãi (xem "CHI PHÍ PHẢI BIẾT" ở docstring module), nên cửa này giữ cho phần nặng chỉ còn lệnh sống.
    """
    nhe = LenhSxDocRepository(db).lenh_nhe(ids)
    xong = {i for i, l in nhe.items() if trang_thai.giao_du(l.so_luong_dat, l.da_giao)}
    return nhe, xong


def danh_sach(
    db: Session, *, sale_ids: set[int] | None,
    tab: str | None = None, q: str | None = None, khach_hang_id: int | None = None,
    tu_ngay: date | None = None, den_ngay: date | None = None, moc: str = "tao",
    order_id: int | None = None, gia_cong: str | None = None, phu_trach_id: int | None = None,
    page: int = 1, page_size: int = PAGE_SIZE_MAC_DINH,
) -> dict:
    """`{items, total, page, page_size, dem_theo_tab}` — bảng đã lọc, đếm và CẮT TRANG ở máy chủ.

    `dem_theo_tab` là FACET: đổi ô lọc thì số đổi, bấm sang tab khác thì số đứng yên.
    """
    page = max(1, page)
    page_size = max(1, min(page_size, PAGE_SIZE_TOI_DA))

    ids = list(db.execute(_loc_sql(
        sale_ids, q=q, khach_hang_id=khach_hang_id, tu_ngay=tu_ngay, den_ngay=den_ngay,
        moc=moc, order_id=order_id, gia_cong=gia_cong, phu_trach_id=phu_trach_id,
    )).scalars())
    nhe, da_giao_het = _tach_da_giao_het(db, ids)
    song = [i for i in ids if i not in da_giao_het]
    bc = boi_canh.nap(db, song)
    kh: dict[int, tuple[str, str | None]] = {i: trang_thai.khau(bc, i) for i in song}
    for i in da_giao_het:
        kh[i] = (trang_thai.KHAU_DA_GIAO, None)

    dem = {t: 0 for t in trang_thai.KHAU}
    for i in ids:
        dem[kh[i][0]] += 1
    dem[TAB_TAT_CA] = len(ids)

    if tab and tab != TAB_TAT_CA:
        ids = [i for i in ids if kh[i][0] == tab]
    if tab in (trang_thai.KHAU_DANG_SX, trang_thai.KHAU_SAU_SX):
        ids.sort(key=lambda i: _khoa_sap(nhe[i]))
    else:
        ids.sort(key=lambda i: _khoa_sap_tra_cuu(nhe[i]))

    dau = (page - 1) * page_size
    trang = ids[dau:dau + page_size]
    tap_song = set(song)
    bc_trang = boi_canh.nap(db, [i for i in trang if i not in tap_song])
    from ...repositories.gia_cong_ngoai_repo import GiaCongNgoaiRepository

    tron_goi = {i: g.nha_cung_cap_ten for i, g, _bg in GiaCongNgoaiRepository(db).cua_nhieu_lenh(trang)
                if g.kieu == "tron_goi"}
    return {
        "items": [_dong(bc if i in tap_song else bc_trang, i, kh[i], tron_goi) for i in trang],
        "total": len(ids),
        "page": page,
        "page_size": page_size,
        "dem_theo_tab": dem,
    }


def khach_trong_pham_vi(db: Session, sale_ids: set[int] | None) -> list[dict]:
    """Khách CỦA CHÍNH các lệnh đã phát hành trong phạm vi người gọi — MỘT câu SQL.

    Nguồn chung của ô Khách ở cả Hồ sơ lệnh (`bo_loc` dưới đây) lẫn Theo dõi
    (`bang_theo_doi.bo_loc`); chọn một khách không có lệnh nào là ngõ cụt nên không bày cả sổ
    khách. Sắp theo tên rồi id để thứ tự ổn định."""
    trong = pham_vi.loc_lsx_da_phat_hanh(select(Lsx.id), sale_ids)
    rows = db.execute(
        select(Customer.id, Customer.name)
        .join(Order, Order.customer_id == Customer.id)
        .join(Lsx, Lsx.order_id == Order.id)
        .where(Lsx.id.in_(trong))
        .distinct()
    ).all()
    return sorted(
        ({"id": cid, "ten": ten} for cid, ten in rows),
        key=lambda k: (k["ten"] or "", k["id"]),
    )


def khach_loc(db: Session, *, sale_ids: set[int] | None) -> list[dict]:
    """Ô "Khách hàng" của thanh lọc: `{id, ten, so}` — khách có lệnh đã phát hành trong phạm vi,
    `so` = số lệnh. MỘT câu SQL."""
    trong = pham_vi.loc_lsx_da_phat_hanh(select(Lsx.id), sale_ids)
    rows = db.execute(
        select(Customer.id, Customer.name, func.count(Lsx.id))
        .join(Order, Order.customer_id == Customer.id)
        .join(Lsx, Lsx.order_id == Order.id)
        .where(Lsx.id.in_(trong))
        .group_by(Customer.id, Customer.name)
        .order_by(Customer.name)
    ).all()
    return [{"id": i, "ten": t or f"Khách #{i}", "so": n} for i, t, n in rows]


def don_loc(db: Session, *, sale_ids: set[int] | None) -> list[dict]:
    """Ô "Đơn hàng" của thanh lọc: `{id, ten, so}` — đơn có lệnh đã phát hành trong phạm vi,
    `ten` = số đơn, `so` = số lệnh. Đơn mới nhất trước."""
    trong = pham_vi.loc_lsx_da_phat_hanh(select(Lsx.id), sale_ids)
    rows = db.execute(
        select(Order.id, Order.order_no, func.count(Lsx.id))
        .join(Lsx, Lsx.order_id == Order.id)
        .where(Lsx.id.in_(trong))
        .group_by(Order.id, Order.order_no)
        .order_by(Order.order_no.desc())
    ).all()
    return [{"id": i, "ten": t, "so": n} for i, t, n in rows]


def bo_loc(db: Session, *, sale_ids: set[int] | None) -> dict:
    """Nguồn ô Khách của Hồ sơ lệnh, gác `lenh_san_xuat:read` (không mượn đường của Theo dõi)."""
    return {"khach_hang": khach_trong_pham_vi(db, sale_ids)}


def phu_trach_loc(db: Session, *, sale_ids: set[int] | None) -> list[dict]:
    """Ô "Phụ trách" của thanh lọc: chủ đơn (luật Đơn hàng bán) của các lệnh trong phạm vi, kèm số lệnh."""
    from ...models.user import User

    trong = pham_vi.loc_lsx_da_phat_hanh(select(Lsx.id), sale_ids)
    chu = pham_vi.chu_don().label("chu")
    sub = select(chu).select_from(Lsx).join(Order, Order.id == Lsx.order_id).where(Lsx.id.in_(trong)).subquery()
    rows = db.execute(
        select(User.id, User.name, func.count()).join(sub, sub.c.chu == User.id)
        .group_by(User.id, User.name).order_by(User.name)
    ).all()
    return [{"id": i, "ten": t or f"Người dùng #{i}", "so": n} for i, t, n in rows]
