"""Phiếu công nghệ A4 — bản in giấy phát cho TỔ SẢN XUẤT (Task 13).

Khác báo giá đối ngoại: phiếu này đi xuống XƯỞNG chứ không phải cho khách, và nội dung của nó
(routing một lệnh dài) không có TRẦN số dòng — 40 công đoạn là chuyện thường. Vẽ tay bằng
`canvas` như `routers/quotations.py::_render_pdf` thì "tự chia trang không cắt bảng giữa dòng"
phải tự lập trình lại từ đầu; dùng `platypus` (`SimpleDocTemplate` + `Table(repeatRows=1)`) thì
ReportLab tự lo — `Table.split()` chỉ cắt ở RANH GIỚI DÒNG, không bao giờ giữa một dòng.

--- KHÔNG MỘT SỐ TIỀN NÀO -----------------------------------------------------------------------
Ràng buộc toàn cục của plan (giống `services/lenh_sx/ho_so.py`). Phiếu này KHÔNG tự mở một đường
đọc DB thứ hai: nó gọi `ho_so.ho_so()` và xin ĐÚNG bốn khối nó in — `thong_tin` / `thong_so` /
`routing` / `phien_ban` (tham số `chi_khoi`).

ĐỌC KỸ NGUỒN BẢO ĐẢM — bản đầu của đoạn này dẫn SAI. Nó viết "an toàn vì `ho_so.py` khai TỪNG
TRƯỜNG nên không có cột tiền nào để quên in". Nhưng chính `ho_so.py:50-56` nói ngược: *LƯỚI THẬT
LÀ SCHEMA, KHÔNG PHẢI FILE NÀY* — `response_model` lặng lẽ vứt mọi khoá không khai ở `ThongSoOut`,
và vì tin lưới ấy nên `ho_so.py` CỐ Ý cấp phép cho người sau đổ nguyên `quy_cach_json` (có
`phi_giao_hang`) vào `_thong_so`. Đường PDF gọi THẲNG service, không đi qua `response_model`, nên
lưới đó KHÔNG có ở đây.

Hôm nay phiếu vẫn sạch, nhưng vì một lý do KHÁC: nó TỰ GỌI TÊN từng khoá nó in (`thong_so_rows`,
`routing_rows` bên dưới), không đổ dict nào ra giấy. Lưới thay cho schema là bài
`test_khong_mot_so_tien_nao_len_giay` — bài đó bắt CHUỖI THẬT lúc nó được vẽ. Thêm một ô vào phiếu
thì đó là chỗ bắt được tiền lọt lên giấy; đừng xoá nó.

Đây cũng là lý do route mới đi ĐÚNG một cửa quyền với `GET /api/lenh-san-xuat/{id}`:
`ho_so.ho_so()` tự ném 404 (lệnh không tồn tại / chưa phát hành) hoặc 403 (lệnh có thật nhưng
ngoài phạm vi người gọi) qua `pham_vi.chan_ngoai_pham_vi` — phiếu không viết lại phép kiểm đó
lần hai (và `chi_khoi` KHÔNG đụng tới cửa ấy: nó chạy trước, luôn luôn), còn tải PDF không đụng
cột `phien_ban` (đọc, không ghi) nên không làm nó tăng lên.

--- FONT: DejaVu Sans, CÓ DẤU ĐẦY ĐỦ ------------------------------------------------------------
v1 của task này từng bỏ dấu tiếng Việt (font Helvetica/Vera đi kèm ReportLab 4.4.5 thiếu ký tự có
dấu, và lúc đó repo chưa có font nào khác) — chủ dự án bác quyết định đó: phiếu công nghệ PHẢI có
dấu đầy đủ, vì đây là giấy tổ trưởng cầm đọc tên công đoạn/quy cách, bỏ dấu là đánh đố người đọc.
Phần nạp font nằm ở `services/pdf_font.py` — DÙNG CHUNG với bản in báo giá (`routers/quotations.py`),
vì cả hai đều bị bác cùng một lý do; chép hai bản đăng ký là hai chỗ phải sửa khi đổi font.

`pdf_font.cat_vua` (cắt chữ theo `stringWidth`) cũng ở đó và cũng dùng chung — nó vốn là hàm
riêng của `quotations.py`, dời sang khi chân trang phiếu này cần cắt tên người in. Không chép:
task này đã một lần chép hàm tra tên đơn vị rồi để hai bản lệch nhau (Q-03).

--- ĐƠN VỊ: IN TÊN, KHÔNG IN MÃ -----------------------------------------------------------------
Cột `don_vi_vao`/`don_vi_ra` của `lsx_cong_doan` (và `don_vi_tinh` của `lsx`) giữ MÃ danh mục
(`to`, `kem`, `cai`, `ram`…) — xem `models/don_vi_do.py:127-128`: "Mã dùng trong công thức / API
… CHỮ HIỂN THỊ nằm ở `ten`." In thẳng mã lên phiếu giấy là đưa tổ trưởng đọc "480 to" thay vì
"480 tờ".

Dùng ĐÚNG hai hàm mà file anh em `ho_so.py` đang dùng cho nhật ký (`:710`, `:761`, `:794`, `:803`):
`DonViDoRepository.ten_theo_ma()` nạp bảng tra MỘT lần cho cả phiếu, `nhan_don_vi(bang, ma)` tra
tên — mã lạ trả CHÍNH MÃ ĐÓ, không bịa không nuốt. Bản trước của file này chép lại cả hai thành
`_bang_ten_don_vi`/`_nhan_dv`, và hai bản ĐÃ LỆCH: mã rỗng ra `""` ở bản gốc nhưng `"—"` ở bản
chép, tức cùng một lệnh mà nhật ký hiện một kiểu còn phiếu in một kiểu. Gạch ngang cho ô trống là
việc của chỗ HIỂN THỊ (`gia_tri()` bên dưới), không phải của hàm tra tên.

--- BỐ CỤC: PHIẾU ĐI THEO HÀNG, CHIA THEO KHÂU (04/11/2026, phương án B) -----------------------
Mockup `docs/mockups/phieu-cong-nghe-lam-lai-3-phuong-an.html` (thay bản 13/10 `phieu-cong-nghe-3-
phuong-an.html`). Tờ giấy đi theo hàng qua từng tổ nên phần lớn trang là bảng các bước có Ô TRỐNG
để ghi tay: giờ bắt đầu, giờ xong, số đạt, số hỏng, người làm ký, bước sau nhận ký (bước thuê
ngoài: "Giao đi" / "Nhận về"). Bảng chia DẢI theo nhóm công đoạn (Trước In, In, Gia công sau in,
Dịch vụ khác); thông số nằm trên dải của khâu đọc nó — giấy, khổ nguyên, xuất kho ở Trước In; khổ
in, mực, kẽm ở In; thành phẩm, số con ở Gia công sau in — mỗi thông tin in đúng MỘT lần, không
còn lưới thông số chung ở đầu phiếu. Dưới mỗi bước có dòng "Lấy" kể vật tư khai ở bước đó. Dòng cao
tối thiểu 11 mm để lệnh hộp/thùng 10 bước vừa một trang. Không chữ đậm, không dấu "·" hay dấu phẩy
nối mẩu dữ liệu, ngày dạng 06/11/2026, ô chưa khai thì KHÔNG in. In máy laser đen trắng vẫn đọc được.

Cột "Lớp" GỠ (13/10): tổ trưởng không đọc được 0 1 2 3. Thứ tự thi công nói bằng lời ở dòng phụ của
bước, và CHỈ ở bước mà dòng ngay trên nó không nói đúng (`_lam_sau`). Cột "Nhóm" và "Loại bước"
cũng gỡ: dòng phụ ghi thẳng máy và tổ, hoặc "Thuê ngoài: <nhà gia công>".

--- KHOÁ MÁY: DỊCH SANG TIẾNG VIỆT TRƯỚC KHI IN -------------------------------------------------
Phiếu mang hai khoá máy đọc: `quy_cach_in` (`mot_mat`…) và `loai_buoc` (`thue_ngoai`…). Cùng một
loại lỗi với "480 to", trên cùng tờ giấy.

ĐÃ KIỂM từng nhóm là ENUM KHAI CỨNG TRONG CODE chứ không phải dòng danh mục — `models/lsx.py:67-70`
(`LB_MAY`/`LB_TO`/`LB_THUE_NGOAI` + `LOAI_BUOC`), `models/phieu_tinh_gia.py:124` (cột `quy_cach_in`, chú thích `mot_mat|hai_mat(AB)|tu_tro|tro_nhip`;
`thanh_phan_engine.py:139` và `_may_fit.py:53` so thẳng bằng chuỗi). Luật "danh mục là ĐỘNG, cấm
hardcode tên" áp cho DÒNG DANH MỤC — enum trong code thì bảng nhãn khai cạnh nơi in là đúng chỗ.

Nhãn chép đúng chữ MÀN HÌNH đang hiện cho cùng dữ liệu (`LenhSxHoSoView.CACH_IN`,
`client.LSX_LOAI_BUOC_META`), để giấy và màn không nói hai kiểu.
KHÔNG import từ `quotation_service._QUY_CACH_IN_NHAN`: bảng đó viết cho câu văn giữa dòng của báo
giá gửi khách ("In 4 màu trở nhíp" — chữ thường, không có "(AB)"), khác chữ trên màn hồ sơ, mà
import còn kéo cả chuỗi module báo giá vào đường in của xưởng.

Khoá lạ (ảnh chụp lệnh cũ, hoặc enum thêm giá trị mới mà quên chỗ này) ⇒ IN NGUYÊN KHOÁ — cùng
luật `nhan_don_vi`: thà tổ thấy một chữ khó đọc còn hơn ô trống hoặc một cái tên hệ tự bịa.

--- QR --------------------------------------------------------------------------------------
Nội dung QR: `{base}/#lsx=<lsx_id>&pv=<phien_ban>` — HASH FRAGMENT, không phải query string, vì FE
là SPA điều hướng bằng state/hash (`AppShell.navigate`), không có route thật đọc `?ho-so=...`.
`pv` là chính con số `phien_ban` đang in ở đầu mỗi trang: cho phép một màn hồ sơ tương lai so `pv`
trên QR với `phien_ban` hiện tại của lệnh rồi cảnh báo "phiếu giấy này là bản cũ". MỘT QR cho cả
lệnh — không QR riêng từng công đoạn. KHÔNG nhúng token đăng nhập: trang đích vẫn đòi đăng nhập,
và một QR in trên giấy lưu hành khắp xưởng không được mang credential nào.

Đi cùng `pv` là MỐC IN + NGƯỜI IN ở chân trang: `pv` chỉ so được nếu người cầm tờ giấy biết nó in
lúc nào. Xem chỗ dựng `chan_trang` trong `render_pdf`.

`{base}` = `settings.frontend_origin` (thêm ở `config.py`, Task 13): mặc định lấy origin ĐẦU của
`CORS_ORIGINS` — chỗ đã khai "frontend nằm ở đâu" cho từng môi trường, nên deploy không phải khai
thêm biến mới. Rỗng (không có origin nào cấu hình) thì QR mang đường dẫn TƯƠNG ĐỐI
`/#lsx=...&pv=...` — không ném lỗi, không bỏ QR.

BẪY của fallback đó: ai thêm một origin nội bộ lên ĐẦU `CORS_ORIGINS` là QR im lặng trỏ sai host,
không lỗi không cảnh báo. Vì thế `FRONTEND_BASE_URL` đã được ghi vào `.env.example` +
`backend/.env.example` kèm đúng cảnh báo này — nhưng KHÔNG vào danh sách `REQUIRED` của
`.github/workflows/deploy.yml`: fallback là chủ ý, biến này không bắt buộc.
"""
from __future__ import annotations

import io
import re
from typing import NamedTuple
from xml.sax.saxutils import escape as _xml_escape

from sqlalchemy.orm import Session

from ...config import settings
from ...models.don_vi_do import TRAM_CAI, TRAM_TO_NGUYEN, nhan_tram
from ...repositories.don_vi_do_repo import DonViDoRepository, nhan_don_vi
from ...repositories.lsx_repo import LsxRepository
from ..gio_xuong import gio_xuong
from ..pdf_font import THUONG, cat_vua, dang_ky_font as _dang_ky_font
from . import ho_so

# Khổ A4 dùng lề 15mm hai bên ⇒ khung nội dung rộng 180mm. Mọi bảng bên dưới cộng KHÔNG vượt số
# đó — cộng vừa khít độ rộng khung là rủi ro tràn 1-2px khi ReportLab làm tròn, nên chừa dư.
_LE_MM = 15.0

#: Cỡ chữ chân trang. Khai thành hằng vì phép CẮT chân trang phải đo bằng đúng cỡ đang vẽ — đổi
#: một chỗ mà quên chỗ kia là chuỗi cắt theo cỡ này rồi vẽ bằng cỡ khác, tức lại đè "Trang N/M".
_CO_CHAN_TRANG = 7.5

#: Chuỗi DÀI NHẤT mà ô số trang có thể chiếm — chân trang trái cắt để chừa đúng chỗ này.
_TRANG_DAI_NHAT = "Trang 999/999"

#: Bốn khối phiếu thật sự in ra giấy. Truyền vào `ho_so.ho_so(chi_khoi=...)` để nút In không kéo
#: theo engine cân đối vật tư + giao hàng + KCS + timeline — xem docstring `ho_so.ho_so`.
_KHOI_CAN = {"thong_tin", "thong_so", "routing", "phien_ban"}

# --- Bảng nhãn cho KHOÁ MÁY (xem docstring module: cả ba đều là enum cứng trong code) ------------
#: `phieu_tinh_gia.quy_cach_in` — chữ y hệt màn hồ sơ (`LenhSxHoSoView.CACH_IN`).
_NHAN_QUY_CACH_IN = {
    "mot_mat": "1 mặt",
    "hai_mat": "2 mặt (AB)",
    "tu_tro": "Tự trở",
    "tro_nhip": "Trở nhíp",
}
#: `lsx.LOAI_BUOC` — chữ y hệt chip loại bước trên màn hồ sơ (`client.LSX_LOAI_BUOC_META`).
_NHAN_LOAI_BUOC = {
    "may": "Máy",
    "to": "Tổ",
    "thue_ngoai": "Thuê ngoài",
}
#: `cong_doan.NHOM` — chữ y hệt ô lọc Nhóm công đoạn trên màn (`keHoachSxShared.NHOM_CONG_DOAN`).
#: Thứ tự khoá = thứ tự dải khâu trên giấy. Nhóm lạ gom vào dải cuối.
_NHAN_KHAU = {
    "prepress": "Trước In",
    "print": "In",
    "finishing": "Gia công sau in",
    "other": "Dịch vụ khác",
}


class PhieuPdf(NamedTuple):
    """Bytes PDF + TÊN FILE gợi ý cho `Content-Disposition`.

    Tên file đi kèm nội dung chứ không để router tự dựng: chỉ service mới có `lsx.ma` trong tay
    (nó vừa đọc qua cửa phạm vi), router đọc lại là mở một đường đọc DB thứ hai — không đi qua
    cửa ấy — cho đúng một chuỗi.
    """

    ten_file: str
    noi_dung: bytes


def _ten_file(ma: str) -> str:
    """`LSX26-0001` -> `phieu-cong-nghe-LSX26-0001.pdf`.

    Lọc ký tự về `[A-Za-z0-9._-]`: `Content-Disposition` là header HTTP, một dấu `"` hay xuống
    dòng lọt vào `filename="..."` là header vỡ (và về nguyên tắc là chỗ tiêm header). Mã lệnh do
    `SequenceService` sinh nên hôm nay vốn đã sạch — bộ lọc này để nó vẫn sạch khi có người đổi
    khuôn mã.
    """
    an_toan = re.sub(r"[^A-Za-z0-9._-]+", "-", ma).strip("-") or "lenh"
    return f"phieu-cong-nghe-{an_toan}.pdf"


def _nhan_khoa(bang: dict[str, str], khoa: str | None) -> str:
    """Khoá enum → chữ tiếng Việt. Khoá rỗng ⇒ `""` (chỗ hiển thị lo gạch ngang), khoá lạ ⇒ CHÍNH
    KHOÁ ĐÓ.

    Luật "khoá lạ ⇒ in nguyên khoá, không bịa không nuốt" là chung với
    `don_vi_do_repo.nhan_don_vi`. Chỗ CỐ Ý khác: hàm kia tra `bang.get(k.lower(), k)`, hàm này
    tra `bang.get(k, k)` — **không hạ chữ thường**. Chú thích cũ ở đây khai "cùng luật" trống
    không nên đọc thành "giống hệt"; viết lại cho đúng thứ code thật sự làm.

    Vì sao không thêm `.lower()`: mã đơn vị tới từ DANH MỤC người dùng gõ (`don_vi_do.ma`) nên
    chuẩn hoá là đúng; còn ba nhóm khoá ở đây là ENUM do code viết ra và phần còn lại của hệ so
    chúng BẰNG CHUỖI Y NGUYÊN — `thanh_phan_engine.py:137,139` (`== "mot_mat"`,
    `in ("tu_tro","tro_nhip")`), `_may_fit.py:53`, `lsx_service.py:2603,2696`,
    `bien_cong_thuc.py:306`, và `quotation_service.py:99` cũng tra không hạ chữ. Hạ chữ RIÊNG ở
    đây thì một giá trị `"Mot_Mat"` sẽ ra giấy là "1 mặt" trong khi engine coi nó là khoá lạ và
    tính 1 mặt/2 mặt theo nhánh khác — tờ giấy nói một đằng, hệ tính một nẻo, mà không ai thấy.
    In nguyên `Mot_Mat` lên giấy thì người đọc biết ngay có gì đó sai.
    """
    k = (khoa or "").strip()
    return bang.get(k, k)


def noi_dung_qr(lsx_id: int, phien_ban: int | None) -> str:
    """URL để tổ trưởng quét QR mở đúng hồ sơ lệnh — xem docstring module về hình dạng chuỗi.

    `phien_ban=None` (lệnh chưa từng có gói phát hành — không nên xảy ra với một lệnh đã qua cửa
    `chan_ngoai_pham_vi`, nhưng hàm này không có quyền giả định) ⇒ `pv=` rỗng, vẫn là một URL hợp
    lệ chứ không ném lỗi.
    """
    base = settings.frontend_origin
    pv = "" if phien_ban is None else str(phien_ban)
    return f"{base}/#lsx={lsx_id}&pv={pv}"


def _qr_drawing(value: str, size_mm: float = 20.0):
    """Widget QR của chính ReportLab (`graphics.barcode.qr`) — KHÔNG dùng gói `qrcode`/`Pillow`
    ngoài, chưa từng có trong `requirements.txt` và task này không được thêm thư viện mới."""
    from reportlab.graphics.barcode import qr
    from reportlab.graphics.shapes import Drawing
    from reportlab.lib.units import mm

    widget = qr.QrCodeWidget(value)
    x0, y0, x1, y1 = widget.getBounds()
    w, h = (x1 - x0) or 1, (y1 - y0) or 1
    size = size_mm * mm
    d = Drawing(size, size, transform=[size / w, 0, 0, size / h, 0, 0])
    d.add(widget)
    return d


def _ngay(v) -> str:
    """`date`/`datetime`/chuỗi ISO ⇒ `06/11/2026`. Rỗng ⇒ `""` (chưa khai thì không in)."""
    if not v:
        return ""
    if hasattr(v, "strftime"):
        return v.strftime("%d/%m/%Y")
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(v))
    return f"{m.group(3)}/{m.group(2)}/{m.group(1)}" if m else str(v)


def _so(v) -> str:
    """Số kiểu Việt: `2075.0` ⇒ `2.075`, `137.5` ⇒ `137,5`. `None` ⇒ `""`."""
    if v is None:
        return ""
    f = float(v)
    if f.is_integer():
        return f"{int(f):,}".replace(",", ".")
    return f"{f:g}".replace(".", ",")


def _noi_loi(ds: list[str]) -> str:
    """`["2"]` ⇒ `2`, `["2", "3"]` ⇒ `2 và 3`, `["2", "3", "4"]` ⇒ `2, 3 và 4` — câu nói, không
    phải chuỗi dữ liệu nối dấu."""
    return ds[0] if len(ds) == 1 else f"{', '.join(ds[:-1])} và {ds[-1]}"


def _lam_sau(nodes: list[dict], thu_tu_in: list[int] | None = None) -> dict[int, str]:
    """`{id bước: "Làm sau bước 2 và 3"}` — CHỈ cho bước mà dòng NGAY TRÊN nó trên giấy không nói
    đúng nó chờ ai.

    `nodes` theo thứ tự hồ sơ (cũng là số bước in ở cột #); `thu_tu_in` là thứ tự DÒNG thật trên
    giấy (dải khâu gom dòng lại), mặc định trùng `nodes`. Bước chờ đúng dòng ngay trên nó thì im —
    thứ tự dòng đã nói đủ, chuỗi thẳng ⇒ `{}`. Bước không chờ ai mà không đứng đầu ⇒ "Làm ngay từ
    đầu": im lặng ở đó là để thợ đọc thành "đợi dòng trên".

    04/11/2026: trước đó hễ routing có nhánh là MỌI bước ghi "Làm sau bước X", kể cả bước chỉ chờ
    dòng ngay trên — lệnh thùng 10 bước in 9 dòng chữ thừa để nói đúng hai chỗ rẽ.
    """
    stt = {n["id"]: i for i, n in enumerate(nodes, start=1)}
    theo_id = {n["id"]: n for n in nodes}
    thu_tu = thu_tu_in if thu_tu_in is not None else [n["id"] for n in nodes]
    ra: dict[int, str] = {}
    for vi_tri, nid in enumerate(thu_tu):
        truoc = sorted(stt[t] for t in (theo_id[nid].get("phu_thuoc") or []) if t in stt)
        tren = [stt[thu_tu[vi_tri - 1]]] if vi_tri else []
        if truoc == tren:
            continue
        ra[nid] = f"Làm sau bước {_noi_loi([str(x) for x in truoc])}" if truoc else "Làm ngay từ đầu"
    return ra


def render_pdf(
    db: Session, lsx_id: int, *, sale_ids: set[int] | None, nguoi_in: str | None = None
) -> PhieuPdf:
    """Dựng phiếu công nghệ A4 cho MỘT lệnh đã phát hành. Trả `PhieuPdf(ten_file, noi_dung)`.

    Ném `HTTPException` 404/403 giống hệt `GET /api/lenh-san-xuat/{id}` (xem docstring module) —
    router chỉ gọi hàm này, không tự kiểm quyền lần hai.

    `nguoi_in` = tên người đang đăng nhập, in ở chân trang cạnh mốc giờ in. Router có sẵn `user`
    nên truyền xuống; `None` thì chân trang chỉ có mốc giờ (service không tự đọc user — tầng
    service không được biết chuyện đăng nhập).
    """
    _dang_ky_font()

    from reportlab.graphics import renderPDF
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase.pdfmetrics import stringWidth
    from reportlab.pdfgen.canvas import Canvas
    from reportlab.platypus import (
        BaseDocTemplate, Frame, KeepTogether, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    )

    ho_so_dict = ho_so.ho_so(db, lsx_id, sale_ids=sale_ids, chi_khoi=_KHOI_CAN)
    tt = ho_so_dict["thong_tin"]
    ts = ho_so_dict["thong_so"]
    nodes = ho_so_dict["routing"]["nodes"]
    phien_ban = ho_so_dict["phien_ban"]
    bang_dv = DonViDoRepository(db).ten_theo_ma()

    rong_a4, cao_a4 = A4
    le = _LE_MM * mm
    xam = colors.HexColor("#666666")
    vien = colors.HexColor("#444444")

    def kieu(ten: str, co: float, mau=colors.black) -> ParagraphStyle:
        return ParagraphStyle(ten, fontName=THUONG, fontSize=co, leading=co * 1.3, textColor=mau)

    s_nhan = kieu("pcn_nhan", 7.5, xam)
    s_gt = kieu("pcn_gt", 9.5)
    s_phu = kieu("pcn_phu", 7.5, colors.HexColor("#555555"))
    s_go = kieu("pcn_go", 6.5, colors.HexColor("#999999"))
    s_th = kieu("pcn_th", 7.5, vien)
    s_kh = kieu("pcn_kh", 9)
    s_vt = kieu("pcn_vt", 7.5, colors.HexColor("#222222"))

    def p(txt, kieu_chu: ParagraphStyle) -> Paragraph:
        return Paragraph(_xml_escape(str(txt)), kieu_chu)

    def dv(ma_dv) -> str:
        return nhan_don_vi(bang_dv, ma_dv) if ma_dv else ""

    def so_dv(v, ma_dv) -> str:
        """`2.075 tờ nguyên`. Số rỗng ⇒ `""`, đơn vị rỗng ⇒ chỉ số."""
        if v is None:
            return ""
        return f"{_so(v)} {dv(ma_dv)}".strip()

    dvt_sp = (tt.get("don_vi_tinh") or "").strip()

    def dv_buoc(ma_dv) -> str:
        """Đơn vị của BƯỚC. Cột `don_vi_vao/ra` giữ MÃ CHẶNG dòng giấy, KHÔNG phải mã danh mục Đơn
        vị (xem `models/don_vi_do.py` trên `TRAM_NHAN`) ⇒ tra nhãn chặng (`to` → "tờ in"), chặng
        Thành phẩm gọi bằng ĐVT sản phẩm của lệnh (`cai` → "hộp"), mã ngoài chặng mới rơi về danh
        mục. Y hệt `nhanChangLenh` của màn hồ sơ. Trước 04/11/2026 phiếu tra thẳng danh mục nên DB
        không còn dòng `to_nguyen` là giấy in "1.500 to_nguyen"."""
        k = (ma_dv or "").strip()
        if not k:
            return ""
        if k.lower() == TRAM_CAI and dvt_sp:
            return dv(dvt_sp)
        return nhan_tram(k, ngan=True) or dv(k)

    def so_buoc(v, ma_dv) -> str:
        if v is None:
            return ""
        return f"{_so(v)} {dv_buoc(ma_dv)}".strip()

    # --- Dòng thông tin lệnh (ngay dưới đầu trang) -------------------------------------------
    # Mỗi cặp nhãn + giá trị dính liền bằng dấu cách không ngắt, giữa các cặp là dấu cách thường
    # ⇒ xuống dòng chỉ xảy ra GIỮA hai cặp, không bao giờ tách nhãn khỏi giá trị của nó.
    def cap(nhan_: str, gia_tri) -> str | None:
        txt = str(gia_tri or "").strip()
        if not txt:
            return None
        nbsp = lambda x: x.replace(" ", "&nbsp;")  # noqa: E731
        return f'<font color="#666666">{nbsp(nhan_)}</font>&nbsp;{nbsp(_xml_escape(txt))}'

    so_luong = so_dv(tt.get("so_luong_dat"), tt.get("don_vi_tinh")) if tt.get("so_luong_dat") else ""
    cap_tt = [c for c in (
        cap("Khách", tt.get("khach_hang")),
        cap("Đặt", so_luong),
        cap("Hạn SX", _ngay(tt.get("han_hoan_thanh_sx"))),
        cap("Hạn giao", _ngay(tt.get("han_giao_khach"))),
        cap("Đơn", tt.get("order_no")),
        cap("Kinh doanh", tt.get("sale")),
    ) if c]
    story: list = []
    if cap_tt:
        story.append(Paragraph(("&nbsp;" * 6 + " ").join(cap_tt), kieu("pcn_tt", 8.5)))
    if (tt.get("ghi_chu") or "").strip():
        story += [Spacer(1, 1.5 * mm), Paragraph(cap("Ghi chú", tt["ghi_chu"]) or "", kieu("pcn_gc", 8.5))]
    if (ts.get("ghi_chu_ky_thuat") or "").strip():
        story += [Spacer(1, 1.5 * mm), Paragraph(cap("Ghi chú kỹ thuật", ts["ghi_chu_ky_thuat"]) or "", kieu("pcn_gckt", 8.5))]

    # --- Thông số THEO KHÂU (KHAI TỪNG TRƯỜNG như `ho_so._thong_so` — không đổ dict) ----------
    def kho(dai, rong) -> str:
        """`790 × 1090 mm`. ĐƠN VỊ là bắt buộc: màn hồ sơ (`LenhSxHoSoView.khoMm`) cảnh báo thẳng
        rằng bỏ `mm` là ra "một tờ giấy nguyên 860 × 650 cm — to bằng gian phòng". Khổ nhập bằng mm
        ở cả phiếu tính giá lẫn màn Kế hoạch SX, hồ sơ chỉ chép lại ảnh chụp đó."""
        if dai is None and rong is None:
            return ""
        # Không chấm hàng nghìn ở khổ: "1.090 mm" dễ đọc thành một mét chín.
        mm_ = lambda v: "?" if v is None else f"{float(v):g}".replace(".", ",")  # noqa: E731
        return f"{mm_(dai)} × {mm_(rong)} mm"

    def mau_muc(so_mau, muc: list[str]):
        """Dãy ô mực C M Y K, mỗi ô RỘNG THEO CHỮ ("TRẮNG", "PANTONE 186C" không tràn khung).

        Bỏ con số "N màu" (04/11/2026): số màu khai tay hay lệch với dãy mực (lệnh 4 màu mà 5 mực),
        dãy mực và Số kẽm đã nói đủ. Lệnh cũ có số màu mà không khai mực thì vẫn in "N màu".
        Không màu không mực ⇒ None."""
        muc = [str(m).strip() for m in (muc or []) if str(m).strip()]
        if not muc:
            return f"{_so(so_mau)} màu" if so_mau else None
        bang = Table(
            [muc],
            colWidths=[stringWidth(m, THUONG, 7) + 2.6 * mm for m in muc],
            rowHeights=[4.4 * mm],
            hAlign="LEFT",
        )
        bang.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, -1), THUONG, 7),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ("BOX", (0, 0), (-1, -1), 0.6, vien),
            ("INNERGRID", (0, 0), (-1, -1), 0.6, vien),
        ]))
        return bang

    so_trang = ts.get("so_trang")
    nhieu_trang = bool(so_trang) and float(so_trang) > 1
    # Hộp bồi couche lên sóng: ô Giấy + ô Sóng tách theo loại (mg 0426). Lệnh cũ nhiều mã cùng loại thì
    # ô kể đủ, mỗi mã một dòng; nhiều GIẤY thì bỏ định lượng — `dinh_luong` chỉ là gsm của giấy chính.
    giays, songs = LsxRepository(db).giay_song_cac_buoc(lsx_id)
    nhieu_giay = len(giays) > 1

    # Thông số nào nằm trên dải của khâu đọc nó: tổ xả cuộn đọc giấy và xuất kho, thợ in đọc khổ in
    # và mực, tổ bế dán đọc thành phẩm và số con. Mỗi thông tin in ĐÚNG MỘT lần.
    ts_khau: dict[str, list[tuple[str, object]]] = {
        "prepress": [
            ("Giấy", giays if len(giays) > 1 else (giays[0] if giays else ts.get("giay_ten"))),
            ("Định lượng", f"{_so(ts['dinh_luong'])} g/m²" if ts.get("dinh_luong") and not nhieu_giay else ""),
            # Sóng (mg 0426) — ngay sau định lượng của giấy, chỉ khi lệnh có sóng.
            ("Sóng", songs if len(songs) > 1 else (songs[0] if songs else "")),
            ("Khổ nguyên", kho(ts.get("kho_nguyen_dai"), ts.get("kho_nguyen_rong"))),
            ("Xả", f"{_so(ts['so_manh_xa'])} tờ in một tờ nguyên" if ts.get("so_manh_xa") else ""),
            ("Xuất kho", so_buoc(ts.get("so_to_nguyen"), TRAM_TO_NGUYEN) if ts.get("so_to_nguyen") else ""),
        ],
        "print": [
            ("Khổ in", kho(ts.get("kho_in_dai"), ts.get("kho_in_rong"))),
            ("Tờ in", so_dv(ts.get("so_to_ke_hoach"), "to") if ts.get("so_to_ke_hoach") else ""),
            ("Quy cách in", _nhan_khoa(_NHAN_QUY_CACH_IN, ts.get("quy_cach_in"))),
            ("Mặt A", mau_muc(ts.get("so_mau_a"), ts.get("muc_a"))),
            ("Mặt B", mau_muc(ts.get("so_mau_b"), ts.get("muc_b"))),
            # "kẽm" (bản in offset), KHÔNG phải "kèm" — cả hệ gọi nó là "Số kẽm".
            ("Số kẽm", _so(ts.get("so_kem")) if ts.get("so_kem") else ""),
            ("Số trang", f"{_so(so_trang)} trang" if nhieu_trang else ""),
            ("Trang một tay", f"{_so(ts['trang_moi_tay'])} trang" if nhieu_trang and ts.get("trang_moi_tay") else ""),
        ],
        "finishing": [
            ("Thành phẩm", kho(ts.get("dai_thanh_pham"), ts.get("rong_thanh_pham"))),
            ("Con", f"{_so(ts['so_con'])} con một tờ in" if ts.get("so_con") else ""),
        ],
    }
    ts_khau = {k: [(n, v) for n, v in ds if v not in (None, "", [])] for k, ds in ts_khau.items()}

    rong_khung = rong_a4 - 2 * le
    s_khau = kieu("pcn_khau", 10)

    def dai_thong_so(cac_cap: list[tuple[str, object]]) -> list:
        """Các cặp nhãn + giá trị CHẢY NGANG như một dòng chữ, xuống dòng khi hết bề rộng. Mỗi dòng
        là một bảng một hàng đo đúng bề rộng từng ô — nhãn và giá trị vẫn là hai ô riêng, nên giá trị
        (vd hai tên giấy chồng nhau) giữ nguyên chuỗi của nó."""
        rong_cho = rong_khung - 9  # đệm trái phải của ô dải khâu
        cac_dong: list[list[tuple]] = [[]]
        con_lai = rong_cho
        for nhan_, gt in cac_cap:
            w_nhan = stringWidth(nhan_, THUONG, 7.5) + 1.8 * mm
            if isinstance(gt, Table):
                o_gt, w_gt = gt, sum(gt._colWidths)
            elif isinstance(gt, list):
                o_gt = Paragraph("<br/>".join(_xml_escape(g) for g in gt), s_gt)
                w_gt = max(stringWidth(g, THUONG, 9.5) for g in gt)
            else:
                o_gt, w_gt = p(gt, s_gt), stringWidth(str(gt), THUONG, 9.5)
            w_gt = min(w_gt + 1, rong_cho - w_nhan)
            khe = 6 * mm
            if cac_dong[-1] and w_nhan + w_gt > con_lai:
                cac_dong.append([])
                con_lai = rong_cho
            cac_dong[-1].append((p(nhan_, s_nhan), w_nhan, o_gt, w_gt + khe))
            con_lai -= w_nhan + w_gt + khe
        ra = []
        for dong in cac_dong:
            if not dong:
                continue
            o = [x for c in dong for x in (c[0], c[2])]
            w = [x for c in dong for x in (c[1], c[3])]
            t = Table([o], colWidths=w, hAlign="LEFT")
            t.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                *[("TOPPADDING", (i, 0), (i, 0), 2) for i in range(0, len(o), 2)],
            ]))
            ra.append(t)
        return ra

    # --- Bảng các bước chia theo khâu — bảng DÀI, chỗ cần tự chia trang -----------------------
    # Bước đánh số theo thứ tự hồ sơ (lớp rồi thứ tự), dải khâu chỉ GOM dòng lại, không đánh số lại.
    so_buoc_cua = {n["id"]: i for i, n in enumerate(nodes, start=1)}
    khau_cua = {n["id"]: n.get("nhom") if n.get("nhom") in _NHAN_KHAU else "other" for n in nodes}
    thu_tu_in = [n["id"] for k in _NHAN_KHAU for n in nodes if khau_cua[n["id"]] == k]
    cho = _lam_sau(nodes, thu_tu_in)
    vat_tu_buoc = LsxRepository(db).vat_tu_cac_buoc(lsx_id)

    def _dong_buoc(node: dict, i: int) -> list:
        # Dựng ô theo thứ tự ĐỌC (số, tên, dòng phụ, số lượng) — bài test soi mặt giấy theo thứ tự đó.
        o_stt, o_ten = p(i, s_gt), p(node.get("ten") or "", s_gt)
        # Dòng phụ của ô Công đoạn: AI làm, lấy gì, lấy dao ở đâu, chờ bước nào — thợ đọc một ô là đủ.
        ncc = (node.get("nha_cung_cap") or "").strip()
        ngoai = bool(ncc) or node.get("loai_buoc") == "thue_ngoai"
        if ngoai:
            nhan_ngoai = _nhan_khoa(_NHAN_LOAI_BUOC, "thue_ngoai")
            # Bước thuê ngoài mà không ghi tên nhà gia công thì tổ không biết giao hàng cho ai.
            phu = [f"{nhan_ngoai}: {ncc}" if ncc else nhan_ngoai]
        else:
            phu = [x for x in ((node.get("may") or "").strip(), (node.get("to") or "").strip()) if x]
        o_phu = [p(x, s_phu) for x in phu]
        # Vật tư khai ở bước: tổ biết phải lĩnh gì, bao nhiêu, không phải đi hỏi kế hoạch.
        for ten, sl, ma_dv in vat_tu_buoc.get(node["id"], []):
            o_phu.append(Paragraph(
                f'<font color="#777777">Lấy</font>&nbsp;{_xml_escape(f"{ten} {_so(sl)} {dv(ma_dv)}".strip())}',
                s_vt))
        # Dao chưa về thì nói THẲNG — im lặng ở đây là để thợ đi tìm một con dao không có trong kho.
        k_ma = (node.get("khuon_be_ma") or "").strip()
        if k_ma:
            ke = (node.get("khuon_be_so_ke") or "").strip()
            if node.get("khuon_be_tinh_trang") == "dang_dat_lam":
                o_phu.append(p(f"Khuôn {k_ma} chưa về", s_phu))
            else:
                o_phu.append(p(f"Khuôn {k_ma} ở {ke}" if ke else f"Khuôn {k_ma}", s_phu))
        if node["id"] in cho:
            o_phu.append(p(cho[node["id"]], s_phu))

        vao = so_buoc(node.get("so_luong_vao"), node.get("don_vi_vao"))
        ra = so_buoc(node.get("so_luong_ra"), node.get("don_vi_ra"))
        dv_ra = dv_buoc(node.get("don_vi_ra") or node.get("don_vi_vao"))
        # Ô STT kèm một khoảng trống để MỌI dòng cao tối thiểu ~11 mm — đủ một dòng số viết tay và
        # một chữ ký (04/11/2026 hạ từ 17 mm: lệnh hộp 10 bước kể cả dòng vật tư phải vừa một trang). Dòng nhiều chữ
        # hơn thì tự cao thêm.
        return [
            [o_stt, Spacer(1, 4.8 * mm)],
            [o_ten, *o_phu],
            [*([p(vao, s_kh)] if vao else []), *([p(f"ra {ra}", s_phu)] if ra else [])],
            p("Giao đi", s_go) if ngoai else "",
            p("Nhận về", s_go) if ngoai else "",
            p(dv_ra, s_go) if dv_ra else "",
            p(dv_ra, s_go) if dv_ra else "",
            "",
            "",
        ]

    dong_bang = [[p(t, s_th) for t in (
        "#", "Công đoạn", "Kế hoạch", "Bắt đầu", "Xong",
        "Số đạt", "Số hỏng", "Người làm ký", "Bước sau nhận ký",
    )]]
    kieu_dai: list[tuple] = []
    theo_id = {n["id"]: n for n in nodes}
    for k in _NHAN_KHAU:
        cac_buoc = [nid for nid in thu_tu_in if khau_cua[nid] == k]
        # Khâu không có bước mà có thông số (lệnh thuê ngoài trọn khâu in) vẫn in dải: thông số
        # không được mất chỉ vì không có dòng nào đứng dưới nó.
        if not cac_buoc and not ts_khau.get(k):
            continue
        r = len(dong_bang)
        dong_bang.append([[p(_NHAN_KHAU[k], s_khau), *dai_thong_so(ts_khau.get(k, []))]] + [""] * 8)
        kieu_dai += [
            ("SPAN", (0, r), (-1, r)),
            ("BACKGROUND", (0, r), (-1, r), colors.HexColor("#f2f2f2")),
            ("LINEABOVE", (0, r), (-1, r), 1.2, colors.black),
            ("TOPPADDING", (0, r), (-1, r), 4),
            ("BOTTOMPADDING", (0, r), (-1, r), 3),
        ]
        if cac_buoc:
            # Dải khâu không được đứng trơ một mình ở đáy trang, tách khỏi bước đầu của nó.
            kieu_dai.append(("NOSPLIT", (0, r), (-1, r + 1)))
        for nid in cac_buoc:
            dong_bang.append(_dong_buoc(theo_id[nid], so_buoc_cua[nid]))

    bang_buoc = Table(
        dong_bang,
        # 179 mm trong khung 180: chừa dư 1 mm cho phép làm tròn. Cột # 9 mm để "10" không gãy dòng.
        colWidths=[mm * w for w in (9, 52, 32, 13, 13, 15, 15, 15, 15)],
        repeatRows=1,
    )
    bang_buoc.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("VALIGN", (0, 0), (-1, 0), "BOTTOM"),
        ("GRID", (0, 0), (-1, -1), 0.8, vien),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f2f2f2")),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        *kieu_dai,
    ]))
    story += [Spacer(1, 3 * mm), bang_buoc]

    # Ô ghi chú xưởng + ô KCS cuối ký: dính liền nhau, sang trang thì sang cả cặp.
    o_cuoi = Table(
        [[p("Xưởng ghi chú", s_nhan), "", p("KCS cuối ký, ghi ngày", s_nhan)]],
        colWidths=[116 * mm, 4 * mm, 60 * mm],
        rowHeights=[18 * mm],
        hAlign="LEFT",
    )
    o_cuoi.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (0, 0), 0.8, vien),
        ("BOX", (2, 0), (2, 0), 0.8, vien),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(KeepTogether([Spacer(1, 3 * mm), o_cuoi]))

    ma = tt.get("ma") or f"LSX-{lsx_id}"
    ten_sp = (tt.get("ten") or "").strip()
    gap = bool(tt.get("is_rush"))
    phien_ban_text = f"Phiên bản {phien_ban if phien_ban is not None else '—'}"
    qr_drawing = _qr_drawing(noi_dung_qr(lsx_id, phien_ban), 22.0)

    # MỐC IN + NGƯỜI IN ở chân trang. `pv` trong QR có mặt để một màn hồ sơ sau này so được "tờ
    # giấy này là bản cũ" — nhưng một tờ giấy đi khắp xưởng mà không ghi in LÚC NÀO thì người đang
    # cầm nó không tự đối chiếu được, phải đi hỏi. Tên người in để còn biết hỏi ai khi tờ giấy và
    # màn hình nói khác nhau.
    #
    # Lấy `gio_xuong()` — đồng hồ XƯỞNG (giờ tường máy chủ), cùng quy ước với mọi mốc mà tổ đọc
    # trên màn. Tính MỘT lần: mọi trang của cùng một tờ phiếu phải mang cùng một mốc.
    chan_trang = f"In lúc {gio_xuong().strftime('%d/%m/%Y %H:%M')}"
    if (nguoi_in or "").strip():
        chan_trang += f" bởi {nguoi_in.strip()}"

    # CẮT THEO BỀ RỘNG THẬT, không theo số ký tự (bản cắt cứng 28 ký tự từng đè lên ô số trang).
    # `cat_vua` cắt từ ĐUÔI nên thứ mất trước là tên người in, mốc giờ sống lâu nhất — không biết
    # in lúc nào thì `pv` trên QR hết đối chiếu được. Dấu "…" báo có chữ đã bị cắt. Chừa chỗ cho
    # ô "Trang N/M" canh phải: bề rộng `_TRANG_DAI_NHAT` cộng 3 mm khe.
    rong_chan_trang = (
        rong_a4 - 2 * le - stringWidth(_TRANG_DAI_NHAT, THUONG, _CO_CHAN_TRANG) - 3 * mm
    )
    chan_trang = cat_vua(chan_trang, rong_chan_trang, THUONG, _CO_CHAN_TRANG)
    rong_ten = rong_a4 - 2 * le - 22 * mm - 6 * mm

    # Vẽ ĐẦU trang lúc ReportLab dựng từng trang (`onFirstPage` = `onLaterPages` ⇒ mã LSX + phiên
    # bản + QR có trên MỌI trang — bài canh `test_moi_trang_deu_co_ma_va_phien_ban`). Vẽ thẳng lên
    # canvas nên KHÔNG choán chỗ của luồng nội dung đang tự chia trang bên dưới.
    def _dau_trang(c, _doc) -> None:
        c.saveState()
        c.setFillColor(xam)
        c.setFont(THUONG, 7.5)
        c.drawString(le, cao_a4 - 14 * mm, "PHIẾU CÔNG NGHỆ")
        c.setFillColor(colors.black)
        c.setFont(THUONG, 17)
        c.drawString(le, cao_a4 - 21.5 * mm, ma)
        if gap:
            # Lệnh gấp: ô viền chữ "GẤP" ngay cạnh mã — đen trắng vẫn nổi, không dựa vào màu.
            x = le + stringWidth(ma, THUONG, 17) + 4 * mm
            c.setLineWidth(1)
            c.rect(x, cao_a4 - 22.4 * mm, stringWidth("GẤP", THUONG, 9) + 3 * mm, 6 * mm)
            c.setFont(THUONG, 9)
            c.drawString(x + 1.5 * mm, cao_a4 - 20.6 * mm, "GẤP")
        if ten_sp:
            c.setFont(THUONG, 11)
            c.drawString(le, cao_a4 - 27.5 * mm, cat_vua(ten_sp, rong_ten, THUONG, 11))
        renderPDF.draw(qr_drawing, c, rong_a4 - le - 22 * mm, cao_a4 - 34 * mm)
        c.setFillColor(xam)
        c.setFont(THUONG, 7.5)
        c.drawCentredString(rong_a4 - le - 11 * mm, cao_a4 - 37 * mm, phien_ban_text)
        c.setStrokeColor(colors.black)
        c.setLineWidth(1)
        c.line(le, cao_a4 - 40 * mm, rong_a4 - le, cao_a4 - 40 * mm)
        c.restoreState()

    # CHÂN trang cần TỔNG số trang ("Trang 1/2") mà lúc dựng trang 1 chưa ai biết có mấy trang ⇒
    # hoãn: giữ trạng thái từng trang, tới `save()` mới vẽ chân trang rồi xuất. Mẫu "NumberedCanvas"
    # quen thuộc của ReportLab — dựng một lượt, không phải dựng hai lần để đếm.
    def _chan(c, tong: int) -> None:
        c.saveState()
        c.setStrokeColor(colors.HexColor("#dddddd"))
        c.setLineWidth(0.8)
        c.line(le, 11.5 * mm, rong_a4 - le, 11.5 * mm)
        c.setFillColor(xam)
        c.setFont(THUONG, _CO_CHAN_TRANG)
        c.drawString(le, 8 * mm, chan_trang)
        c.drawRightString(rong_a4 - le, 8 * mm, f"Trang {c.getPageNumber()}/{tong}")
        c.restoreState()

    class _CanvasDemTrang(Canvas):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self._trang_cho: list[dict] = []

        def showPage(self):  # noqa: N802 (tên của ReportLab)
            self._trang_cho.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            tong = len(self._trang_cho)
            for trang in self._trang_cho:
                self.__dict__.update(trang)
                _chan(self, tong)
                Canvas.showPage(self)
            Canvas.save(self)

    buf = io.BytesIO()
    # Khung nội dung KHÔNG đệm (Frame mặc định đệm 6pt mỗi cạnh): mép trái của dòng thông tin,
    # lưới thông số và bảng các bước phải thẳng hàng với mã LSX và vạch đầu trang vẽ ở `le`.
    tren, duoi = 42 * mm, 16 * mm
    khung = Frame(le, duoi, rong_a4 - 2 * le, cao_a4 - tren - duoi,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc = BaseDocTemplate(buf, pagesize=A4, title=f"Phiếu công nghệ {ma}",
                          pageTemplates=[PageTemplate("phieu", [khung], onPage=_dau_trang)])
    doc.build(story, canvasmaker=_CanvasDemTrang)
    return PhieuPdf(ten_file=_ten_file(ma), noi_dung=buf.getvalue())
