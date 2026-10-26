"""Báo cáo TỔNG HỢP CÔNG NỢ theo kỳ — docs/prd-bao-cao-cong-no.md §5.1.

Khác hẳn màn Công nợ đang có, đừng nhầm hai thứ:

  • Màn Công nợ trả lời *"HÔM NAY ai nợ mình bao nhiêu, đòi ai trước"* — ảnh chụp tại hôm nay.
  • Báo cáo này trả lời *"TRONG KỲ [tu_ngay, den_ngay] mỗi đối tượng phát sinh bao nhiêu, đầu kỳ
    bao nhiêu, cuối kỳ còn bao nhiêu"* — sổ tổng hợp theo kỳ, để đối chiếu với MISA.

**KHÔNG CHỐT KỲ** (§❶bis). Không có bảng lưu số dư cuối kỳ, không có nút "Chốt". Chọn khoảng ngày
nào cũng tính lại từ chứng từ. Tồn kho phải chốt vì là số *đi đếm mới biết*; công nợ thì *cộng lại
là ra*, y như sao kê ngân hàng.

SỐ DƯ ĐẦU KỲ dựng THUẦN từ chứng từ trong hệ: mọi thứ có ngày trước `tu_ngay` gom vào ngăn đầu
kỳ. KHÔNG có chỗ khai tay nợ cũ — màn nhập số dư đầu kỳ từ file MISA đã BỎ 04/09/2026 (*"mình
không cần làm cho họ đâu"*). Hệ quả cần biết: nợ phát sinh TRƯỚC khi dùng hệ này thì báo cáo
không thấy, nên dư cuối kỳ hụt đúng bằng phần đó.

QUY ƯỚC NỘI BỘ: mọi phép cộng chạy trên **`net` = dư Nợ − dư Có** (chuẩn kế toán), tới lúc trả ra
mới tách hai cột bằng `_hai_cot`. Nhờ thế 131 và 331 dùng CHUNG một bộ máy dù dấu ngược nhau:

  • 131 phải thu: bán ra `+net` (tăng Nợ) · thu tiền `−net`.
  • 331 phải trả: hàng về `−net` (tăng Có) · trả tiền `+net`.

Số âm KHÔNG BAO GIỜ lọt ra ngoài: âm thì nhảy sang cột bên kia. Đó là luật của sổ Nợ/Có, và cũng
là cách một khách ứng trước tiền hiện lên đúng ở cột Có của TK 131.
"""
from __future__ import annotations

from datetime import date, datetime

from ..models.accounting import RECEIPT_SOURCE_PURCHASE, SALES_INVOICE_ISSUED, VOUCHER_CASH
from .purchase_service import han_tra_dot, phan_bo_du_dot, phan_bo_tien_dot

#: Tài khoản công nợ in ra cột "TK công nợ". Cứng, vì hệ CHƯA có danh mục tài khoản kế toán —
#: `debit_account`/`credit_account` trên phiếu là chữ nhập tay (§❺). Khi nào có danh mục thật thì
#: mới lấy động; in cứng ở đây vẫn đúng với mọi dòng của hai báo cáo này.
TK_PHAI_THU = "131"
TK_PHAI_TRA = "331"

#: Khoá của dòng gom mọi khoản KHÔNG truy được về đối tượng nào (§❸ phương án A). Dùng `None` làm
#: id thật nên phải có khoá riêng để gom — không giấu tiền đi đâu cả, nhưng cũng không bịa ra một
#: khách/NCC không tồn tại.
KHONG_GAN_ID = None
KHONG_GAN_TEN_THU = "(Không gắn khách hàng)"
KHONG_GAN_TEN_TRA = "(Không gắn nhà cung cấp)"

#: Cột "TK đối ứng" của sổ chi tiết cho phiếu thu/chi TIỀN MẶT (24/09/2026). Hệ chưa có danh mục
#: tài khoản kế toán nên ghi TÊN, không ghi số hiệu 1111 — kế toán yêu cầu đúng như vậy.
TK_DOI_UNG_TIEN_MAT = "Tiền mặt"


def _ro_rong() -> dict[str, dict[str, int]]:
    """Sáu rổ rỗng. Đối tượng không nợ gì vẫn phải đủ 6 khoá — thiếu khoá là giao diện đọc ra
    `undefined` rồi in "NaN đ"."""
    from .accounting_service import AGING_KEYS

    return {k: {"amount": 0, "count": 0} for k in AGING_KEYS}


def _bo_ro(o: dict, tien: int, han: date | None, den_ngay: date) -> None:
    """Ném một khoản còn nợ vào đúng rổ tuổi, TÍNH TẠI `den_ngay`.

    ⚠️ Tại `den_ngay`, KHÔNG phải tại hôm nay — đó là toàn bộ lý do rổ tuổi ở báo cáo khác rổ tuổi
    ở màn Công nợ. Chọn kỳ đến 31/08 thì phải ra tuổi nợ đúng như tại 31/08, và in lại tháng sau
    vẫn ra đúng con số đó. Màn Công nợ neo vào hôm nay nên không làm được việc này.

    Mốc rổ lấy từ `AGING_BUCKETS` — đừng gõ lại số ngày ở đâu khác.
    """
    from .accounting_service import ro_tuoi

    if tien <= 0:
        return
    tre = (den_ngay - han).days if han is not None and den_ngay > han else 0
    khoa = ro_tuoi(tre)
    o["aging"][khoa]["amount"] += tien
    o["aging"][khoa]["count"] += 1


def _ro_ra_danh_sach(ro: dict[str, dict[str, int]]) -> list[dict]:
    """Bộ rổ → danh sách CÓ NHÃN, đúng thứ tự già dần. Giao diện chỉ việc in, không tự đặt tên."""
    from .accounting_service import AGING_BUCKETS

    return [
        {
            "key": b["key"],
            "label": b["label"],
            "amount": ro[b["key"]]["amount"],
            "count": ro[b["key"]]["count"],
        }
        for b in AGING_BUCKETS
    ]


def _hai_cot(net: int) -> tuple[int, int]:
    """`net` (Nợ − Có) → `(du_no, du_co)`. Đúng một trong hai khác 0."""
    return (net, 0) if net > 0 else (0, -net)


def ngay_chi(v) -> date:
    """Ngày tiền THỰC SỰ rời két. Bản sao có chủ đích của `AccountingService._ngay_chi`.

    Phải giống hệt nó: hai nơi chọn ngày khác nhau cho cùng một phiếu là báo cáo và màn công nợ
    cãi nhau, mà không ai biết bên nào đúng.
    """
    return v.paid_at.date() if v.paid_at is not None else v.voucher_date


class _Gom:
    """Máy cộng cho MỘT báo cáo: mỗi đối tượng một ô ba ngăn (đầu kỳ · phát sinh · cuối kỳ)."""

    def __init__(self, tu_ngay: date, den_ngay: date, tk: str, ten_khong_gan: str) -> None:
        self.tu_ngay = tu_ngay
        self.den_ngay = den_ngay
        self.tk = tk
        self.ten_khong_gan = ten_khong_gan
        self.o: dict[int | None, dict] = {}

    def muc(self, doi_tuong_id: int | None, ten: str | None, ma: str | None = None) -> dict:
        o = self.o.get(doi_tuong_id)
        if o is None:
            o = {
                "doi_tuong_id": doi_tuong_id,
                "ma": ma,
                "ten": (ten or "").strip() or self.ten_khong_gan,
                "tk": self.tk,
                # `net` cộng dồn; tách hai cột ở phút chót trong `ket_qua()`.
                "_dau": 0,
                "_ps_no": 0,
                "_ps_co": 0,
                # Tiền HOÀN trong kỳ (đã nằm trong PS) — giao diện tách khỏi Bán ra / Nhận hàng.
                "_hoan": 0,
                "aging": _ro_rong(),
            }
            self.o[doi_tuong_id] = o
        elif ma and not o["ma"]:
            o["ma"] = ma
        return o

    def cong(self, o: dict, ngay: date, net: int, *, hoan: bool = False) -> None:
        """Ném một chứng từ vào đúng ngăn: trước kỳ → đầu kỳ · trong kỳ → phát sinh · sau kỳ → bỏ.
        `hoan`: chứng từ hoàn tiền — vẫn vào PS như cũ (sổ MISA giữ nguyên), đếm riêng thêm vào `hoan`."""
        if not net:
            return
        if ngay < self.tu_ngay:
            o["_dau"] += net
        elif ngay <= self.den_ngay:
            if hoan:
                o["_hoan"] += abs(net)
            if net > 0:
                o["_ps_no"] += net
            else:
                o["_ps_co"] += -net
        # ngày > den_ngay: ngoài kỳ, không thuộc báo cáo này.

    def ket_qua(self, *, an_dong_trong: bool = True) -> list[dict]:
        ra: list[dict] = []
        for o in self.o.values():
            dau, ps_no, ps_co = o["_dau"], o["_ps_no"], o["_ps_co"]
            cuoi = dau + ps_no - ps_co
            if an_dong_trong and not (dau or ps_no or ps_co or cuoi):
                continue
            dau_no, dau_co = _hai_cot(dau)
            cuoi_no, cuoi_co = _hai_cot(cuoi)
            ra.append(
                {
                    "doi_tuong_id": o["doi_tuong_id"],
                    "ma": o["ma"],
                    "ten": o["ten"],
                    "tk": o["tk"],
                    "dau_no": dau_no,
                    "dau_co": dau_co,
                    "ps_no": ps_no,
                    "ps_co": ps_co,
                    "hoan": o["_hoan"],
                    "cuoi_no": cuoi_no,
                    "cuoi_co": cuoi_co,
                    "aging": o["aging"],
                }
            )
        # Dòng "không gắn đối tượng" luôn xuống CUỐI: nó không phải một đối tượng thật, để nó lẫn
        # giữa danh sách sắp theo tên là gây hiểu nhầm rằng hệ có một khách tên như thế.
        ra.sort(key=lambda r: (r["doi_tuong_id"] is None, (r["ten"] or "").lower()))
        return ra


def _tong(items: list[dict]) -> dict:
    """Dòng TỔNG CỘNG. Cộng thẳng từng cột chứ KHÔNG cộng `net` rồi tách lại.

    Cố ý: nếu tách lại thì một khách dư Nợ 10 và một khách dư Có 10 sẽ triệt tiêu thành 0/0, trong
    khi sổ phải ghi rõ "10 bên Nợ, 10 bên Có". Bản xuất của MISA cũng cộng theo cột (tổng phải thu
    cuối kỳ của họ: Nợ 36,1 tỷ VÀ Có 4,5 tỷ cùng lúc).
    """
    cot = ("dau_no", "dau_co", "ps_no", "ps_co", "cuoi_no", "cuoi_co")
    return {
        "so_dong": len(items),
        **{k: sum(i[k] for i in items) for k in cot},
        "hoan": sum(i.get("hoan", 0) for i in items),
    }


# ══════════════════════════════════════════════════════════════════════════════════
# DÒNG CHỨNG TỪ — nguồn DUY NHẤT cho cả sổ tổng hợp lẫn SỔ CHI TIẾT (§5.1)
# ══════════════════════════════════════════════════════════════════════════════════
#
# Vì sao phải gom về một chỗ: sổ chi tiết là thứ kế toán mở ra để giải thích con số của sổ tổng
# hợp ("PS Nợ 304.500.000 gồm phiếu nào?"). Nếu hai bên tự đi hỏi chứng từ theo đường riêng thì
# chỉ cần lệch một luật ngày (vd phiếu chi lấy `voucher_date` thay vì `paid_at`) là luỹ kế cuối sổ
# chi tiết không khớp dư cuối kỳ — mà lúc đó không ai biết bên nào sai. Cùng một danh sách thì
# không thể lệch, và `test_bao_cao_cong_no.py` còn canh thêm bằng bài đối chiếu hai bên.
#
# Mỗi phần tử: `net` > 0 → ghi cột NỢ · `net` < 0 → ghi cột CÓ (quy ước ở đầu file).

#: Loại chứng từ HOÀN TIỀN (hoàn cho khách ở 131, NCC hoàn ở 331). Sổ MISA ghi chúng cùng cột với
#: hoá đơn / hàng về; giao diện thì tính là thu âm / trả âm để cột Bán ra / Nhận hàng chỉ còn hàng
#: (12/10/2026) — nên báo cáo trả riêng tổng `hoan`.
LOAI_HOAN = frozenset({"hoan_tien_khach", "hoan_tien"})


def _so_hoa_don(hd) -> str:
    """Số hiển thị của hoá đơn bán. Chưa điền số thì lùi về id — sổ không được có dòng trống số."""
    so = (hd.invoice_number or "").strip()
    ky_hieu = (getattr(hd, "invoice_symbol", None) or "").strip()
    if so:
        return f"{ky_hieu} {so}".strip()
    return f"HĐ #{hd.id}"


def _tk_doi_ung(phuong_thuc: str | None, phieu) -> str:
    """"TK đối ứng" của một phiếu thu/chi — đi theo HÌNH THỨC tiền của chính phiếu đó.

    Tiền mặt ⇒ "Tiền mặt". Chuyển khoản ⇒ tài khoản ngân hàng CỦA CÔNG TY mà tiền đi ra/vào
    ("Vietinbank - 106875591156"), lấy từ bản CHỤP trên phiếu trước: tài khoản sửa tên/đóng sau
    này thì sổ cũ vẫn in đúng tài khoản lúc tiền chạy. Phiếu cũ chưa có bản chụp mới lùi về danh mục.
    """
    if phuong_thuc == VOUCHER_CASH:
        return TK_DOI_UNG_TIEN_MAT
    ngan_hang = (getattr(phieu, "company_bank_name_snapshot", None) or "").strip()
    so_tk = (getattr(phieu, "company_account_number_snapshot", None) or "").strip()
    if not (ngan_hang or so_tk):
        tk = getattr(phieu, "company_bank_account", None)
        if tk is not None:
            ngan_hang, so_tk = (tk.bank_name or "").strip(), (tk.account_number or "").strip()
    return " - ".join(x for x in (ngan_hang, so_tk) if x) or "Chuyển khoản"


def ncc_cua_phieu_chi(v) -> int | None:
    if v.supplier_id is not None:
        return v.supplier_id
    return v.purchase_request.supplier_id if v.purchase_request is not None else None


_ncc_cua_phieu_chi = ncc_cua_phieu_chi


def _ncc_cua_hoan(p) -> int | None:
    """NCC của phiếu thu hoàn tiền: gắn thẳng (lập từ ngăn Công nợ phải trả, mg 0397) hoặc suy từ
    phiếu chi gốc (phiếu cũ lập từ phiếu chi)."""
    if getattr(p, "supplier_id", None) is not None:
        return p.supplier_id
    v = p.payment_voucher
    return _ncc_cua_phieu_chi(v) if v is not None else None


def _chung_tu_phai_thu(
    hoa_don, phieu, khach_don, ma_khach, hoan_khach=(), den_ngay: date | None = None
) -> list[dict]:
    """Phải thu: hoá đơn bán → NỢ (khách nợ thêm) · phiếu thu → CÓ (khách trả bớt) · phiếu chi
    hoàn tiền cho khách → NỢ (tiền khách đã đưa nay trả lại).

    Chỉ chứng từ truy được về MỘT khách (11/10/2026): phiếu thu lập tay không gắn hoá đơn/đơn là
    chuyện của Báo cáo thu chi, không phải nợ của ai — trước đây nó dồn thành một dòng không tên."""

    def _dt(kh_id: int | None, ten_lui: str | None) -> dict:
        k = ma_khach.get(kh_id) if kh_id else None
        return {
            "doi_tuong_id": kh_id,
            "ten": (k.name if k else None) or ten_lui,
            "ma": k.code if k else None,
        }

    ra: list[dict] = []
    for hd in hoa_don:
        ra.append({
            **_dt(hd.customer_id, hd.customer_name_snapshot),
            "ngay": hd.invoice_date,
            "loai": "hoa_don",
            "so_ct": _so_hoa_don(hd),
            # Sao kê tách cột Ký hiệu và mở đơn bán của hoá đơn (13/10/2026).
            "ky_hieu": (getattr(hd, "invoice_symbol", None) or "").strip() or None,
            "don_id": getattr(hd, "order_id", None),
            "dien_giai": "Hoá đơn bán hàng",
            "luc": getattr(hd, "created_at", None),
            "net": int(hd.amount_vnd),
            "tk_doi_ung": "",
        })
    for p in phieu:
        if p.source_type == RECEIPT_SOURCE_PURCHASE:
            continue  # tiền NCC trả lại — thuộc 331, không phải 131.
        # Một phiếu = một dòng Có, kể cả phiếu gộp nhiều hoá đơn/đơn (mọi dòng cùng một khách).
        kh_id = getattr(p, "customer_id", None)
        if kh_id is None and p.sales_invoice is not None:
            kh_id = p.sales_invoice.customer_id
        elif kh_id is None and p.order_id is not None:
            kh_id = khach_don.get(p.order_id)
        if kh_id is None:
            continue
        ra.append({
            **_dt(kh_id, p.customer_name_snapshot),
            "ngay": p.receipt_date,
            "loai": "phieu_thu",
            "so_ct": p.code,
            "dien_giai": (p.content or "").strip() or "Khách trả tiền",
            "luc": getattr(p, "received_at", None) or getattr(p, "created_at", None),
            "net": -int(p.amount_vnd),
            "tk_doi_ung": _tk_doi_ung(p.receipt_method, p),
        })
    for v in hoan_khach:
        ra.append({
            **_dt(v.customer_id, None),
            "ngay": ngay_chi(v),
            "loai": "hoan_tien_khach",
            "so_ct": v.code,
            "dien_giai": (v.content or "").strip() or "Hoàn tiền cho khách",
            "luc": getattr(v, "paid_at", None),
            "net": int(v.amount_vnd),
            "tk_doi_ung": _tk_doi_ung(v.voucher_type, v),
        })
    return ra


def _chung_tu_phai_tra(don, chi, hoan, ma_ncc, *, den_ngay: date) -> list[dict]:
    """Phải trả: đợt giao → CÓ (nợ tăng) · phiếu chi → NỢ (nợ giảm) · NCC hoàn tiền → CÓ.
    `chi` chỉ gồm phiếu chi truy được nhà cung cấp — `_nap_phai_tra` đã lọc."""

    def _dt(ncc_id: int | None, ten_lui: str | None) -> dict:
        n = ma_ncc.get(ncc_id) if ncc_id else None
        return {
            "doi_tuong_id": ncc_id,
            "ten": (n.name if n else None) or ten_lui,
            "ma": n.code if n else None,
        }

    ra: list[dict] = []
    for pr in don:
        tien_dot = phan_bo_du_dot(pr)
        for d in getattr(pr, "deliveries", None) or []:
            tien = int(tien_dot.get(d.id, {}).get("amount", 0) or 0)
            if not tien or d.delivery_date > den_ngay:
                continue
            ra.append({
                **_dt(pr.supplier_id, None),
                "ngay": d.delivery_date,
                "loai": "dot_giao",
                # Số ĐỢT TRONG ĐƠN, không phải id bản ghi — cùng bài học đã vá ở
                # `cong_no_chi_tiet_phai_tra` (đợt đầu tiên hiện thành "Đợt #20" vì id là 20).
                "so_ct": f"{pr.code} đợt {d.seq_no}",
                # Hoá đơn NCC của đợt (13/10/2026): sao kê tách Số hoá đơn, Ký hiệu, Ngày hoá đơn
                # khỏi ngày nhận hàng của dòng.
                "so_hoa_don": (d.invoice_number or "").strip() or None,
                "ky_hieu": (getattr(d, "invoice_symbol", None) or "").strip() or None,
                "ngay_hoa_don": d.invoice_date,
                "don_ma": pr.code,
                "dien_giai": "Hàng đã nhận",
                "luc": getattr(d, "created_at", None),
                "net": -tien,
                # Hàng về không phải phiếu thu/chi — TK đối ứng chỉ đi theo phiếu tiền.
                "tk_doi_ung": "",
            })
    for v in chi:
        ra.append({
            **_dt(_ncc_cua_phieu_chi(v), v.supplier_name_snapshot),
            "ngay": ngay_chi(v),
            "loai": "phieu_chi",
            "so_ct": v.code,
            "dien_giai": (v.content or "").strip() or "Chi trả nhà cung cấp",
            # `paid_at` là mốc tiền THẬT SỰ rời két — cùng nguồn `ngay_chi` đang dùng.
            "luc": getattr(v, "paid_at", None),
            "net": int(v.amount_vnd),
            "tk_doi_ung": _tk_doi_ung(v.voucher_type, v),
        })
    for p in hoan:
        ra.append({
            **_dt(_ncc_cua_hoan(p), p.supplier_name_snapshot),
            "ngay": p.receipt_date,
            "loai": "hoan_tien",
            "so_ct": p.code,
            "dien_giai": (p.content or "").strip() or "Nhà cung cấp hoàn tiền",
            "luc": getattr(p, "received_at", None) or getattr(p, "created_at", None),
            "net": -int(p.amount_vnd),
            "tk_doi_ung": _tk_doi_ung(p.receipt_method, p),
        })
    return ra


def _nap_phai_thu(
    repo, *, den_ngay: date, hoa_don_da_nap: list | None = None
) -> tuple[list, list, dict, dict, list]:
    """Nạp nguyên liệu TK 131 MỘT LẦN. Dùng chung cho sổ tổng hợp và sổ chi tiết — hai bên phải
    nhìn CÙNG một tập chứng từ, không chỉ cùng luật cộng.

    `hoa_don_da_nap` = MỌI hoá đơn `issued` (chưa lọc ngày) mà người gọi đã nạp sẵn bằng đúng
    `list_sales_invoices(status=issued)` — màn Công nợ phải thu truyền vào để khỏi nạp lần hai.
    Không truyền thì tự nạp như cũ."""
    nguon = (
        hoa_don_da_nap
        if hoa_don_da_nap is not None
        else repo.list_sales_invoices(status=SALES_INVOICE_ISSUED)
    )
    hoa_don = [hd for hd in nguon if hd.invoice_date <= den_ngay]
    phieu = repo.phieu_thu_cho_bao_cao(den_ngay=den_ngay)
    hoan_khach = [v for v in repo.phieu_chi_hoan_khach() if ngay_chi(v) <= den_ngay]
    khach_don = repo.khach_cua_don([p.order_id for p in phieu if p.order_id is not None])
    khach_phieu = {p.customer_id for p in phieu if getattr(p, "customer_id", None)}
    # Nạp danh mục khách MỘT LẦN cho cả ba nguồn. Trước đó dùng hai bản đồ rời nên khách chỉ có
    # phiếu thu (chưa hoá đơn nào) rơi vào nhánh tên-snapshot và MẤT mã — mà mã chính là thứ để
    # đối chiếu với sổ MISA.
    ma_khach = repo.customers_by_ids(
        {hd.customer_id for hd in hoa_don if hd.customer_id}
        | {p.sales_invoice.customer_id for p in phieu if p.sales_invoice is not None}
        | set(khach_don.values())
        | khach_phieu
        | {v.customer_id for v in hoan_khach}
    )
    return hoa_don, phieu, khach_don, ma_khach, hoan_khach


def _nap_phai_tra(
    repo, purchases, *, den_ngay: date, don_da_nap: list | None = None
) -> tuple[list, list, list, dict]:
    """Nạp nguyên liệu TK 331 MỘT LẦN — xem ghi chú ở `_nap_phai_thu`.

    `don_da_nap` = kết quả `purchases.list_for_payables()` mà người gọi đã nạp sẵn (màn Công nợ
    phải trả truyền vào để khỏi nạp lại cả lịch sử phiếu mua). Không truyền thì tự nạp như cũ."""
    don = don_da_nap if don_da_nap is not None else purchases.list_for_payables()
    # Chỉ phiếu chi truy được NCC (11/10/2026). Chi nội bộ, tạm ứng lương, chi lặt vặt không
    # phải nợ của ai — chúng nằm ở Báo cáo thu chi, không dồn thành một dòng không tên ở đây.
    chi = [
        v for v in repo.phieu_chi_cho_bao_cao()
        if ngay_chi(v) <= den_ngay and _ncc_cua_phieu_chi(v) is not None
    ]
    hoan = [
        p
        for p in repo.phieu_thu_cho_bao_cao(den_ngay=den_ngay)
        if p.source_type == RECEIPT_SOURCE_PURCHASE
    ]
    # Nạp danh mục NCC MỘT LẦN cho cả bốn nguồn. Trước đó chỉ lấy tên từ `list_for_payables`, nên
    # NCC chỉ có NỢ CŨ (chưa đơn nào trong hệ) rơi ra dòng mang tên mã MISA thay vì tên thật —
    # NCC chỉ có phiếu chi (chưa đơn nào) từng rơi ra dòng mang tên snapshot thay vì tên thật.
    ma_ncc = repo.ncc_theo_ids(
        {pr.supplier_id for pr in don if pr.supplier_id}
        | {n for n in (_ncc_cua_phieu_chi(v) for v in chi) if n}
        | {n for n in (_ncc_cua_hoan(p) for p in hoan) if n}
    )
    return don, chi, hoan, ma_ncc


# ══════════════════════════════════════════════════════════════════════════════════
# KHOẢN CÒN NỢ tại `den_ngay` — nguồn DUY NHẤT cho rổ tuổi của sổ tổng hợp VÀ tab "Đợt còn nợ"
# ══════════════════════════════════════════════════════════════════════════════════
#
# Tab "Đợt còn nợ" (11/10/2026, phương án C) là thứ người xem mở ra để giải thích các cột tuổi nợ
# của một dòng. Hai bên đi CÙNG một vòng cấn trừ thì cộng các khoản trong tab ra đúng bằng ô của
# dòng đó — tự viết vòng thứ hai là mở cửa cho hai con số cãi nhau.


def phan_bo_hoan_khong_don(khoan: list[dict], hoan: dict) -> dict:
    """Tiền trả lại khách KHÔNG gắn đơn (vd. hàng lỗi) cộng nợ lại vào hoá đơn của khách (17/10/2026):
    khoản hạn MUỘN NHẤT trước, mỗi khoản tới đủ giá trị gốc; phần vượt hết sức chứa dồn vào khoản muộn
    nhất. Đây là luật cũ của `_can_theo_so_du` cho tiền hoàn, nay áp riêng — tiền đang để ở đơn khác
    KHÔNG còn cấn chéo sang hoá đơn của đơn này (chủ chốt 17/10/2026: tiền đơn nào trừ vào hoá đơn đơn
    đó; tổng các khoản có thể lớn hơn dư Nợ 131 đúng bằng tiền khách đang để).

    `khoan`: dict có `id`, `doi_tuong_id`, `han`, `ngay`, `goc`, `con_no`, tuỳ chọn `thua` (tiền thu
    đích danh VƯỢT giá trị hoá đơn). `hoan`: `{doi_tuong_id: tiền}`. Phần thu vượt trừ vào tiền hoàn
    trước: khách đã trả lại phần được cộng nợ thì không cộng lần nữa. Trả `{id: tiền cộng thêm}`.
    Dùng chung cho ảnh chụp hôm nay (`receivable_rows`) và sổ theo kỳ."""
    theo_dt: dict = {}
    for k in khoan:
        theo_dt.setdefault(k["doi_tuong_id"], []).append(k)
    them: dict = {}
    for dt, tien in hoan.items():
        ds = sorted(theo_dt.get(dt, []),
                    key=lambda k: (k["han"] is None, k["han"] or date.max, k["ngay"], k["id"]))
        con = int(tien) - sum(k.get("thua", 0) for k in ds)
        if not ds or con <= 0:
            continue
        for k in reversed(ds):
            cong = min(max(0, k["goc"] - k["con_no"]), con)
            if cong:
                them[k["id"]] = them.get(k["id"], 0) + cong
                con -= cong
        if con:
            them[ds[-1]["id"]] = them.get(ds[-1]["id"], 0) + con
    return them


def _khoan_phai_thu(hoa_don, phieu, hoan_khach=(), den_ngay: date | None = None) -> list[dict]:
    """Phần CÒN LẠI của từng hoá đơn bán tính tới `den_ngay` (phiếu đã nạp sẵn tới mốc đó).

    Phải tính lại ở đây, không mượn `remaining_amount` của `_receivable_rows` — số đó là "còn lại
    tính tới HÔM NAY", nên tiền khách trả SAU kỳ đã bị trừ mất và tuổi nợ của kỳ cũ hoá ra nhẹ đi.
    Cách cấn trừ y hệt `receivable_rows`: thu ĐÍCH DANH hoá đơn trừ trước, quỹ tiền của đơn (cọc +
    tiền hoá đơn đã huỷ − đã trả lại theo đơn) cấn FIFO theo (ngày hoá đơn, id), tiền trả lại không
    gắn đơn cộng nợ lại (`phan_bo_hoan_khong_don`). Chép luật ở đây là có ý — bản gốc không nhận mốc
    ngày. `hoan_khach` = phiếu chi trả lại khách đã nạp tới cùng mốc."""
    thu_dich_danh: dict[int, int] = {}
    coc_theo_don: dict[int, int] = {}
    for p in phieu:
        if p.source_type == RECEIPT_SOURCE_PURCHASE:
            continue
        # Tiền đi theo DÒNG phân bổ (17/10/2026) — phiếu gộp trả nhiều hoá đơn / cọc nhiều đơn.
        for l in getattr(p, "lines", None) or []:
            hd = l.sales_invoice if l.sales_invoice_id is not None else None
            if hd is not None and hd.status != SALES_INVOICE_ISSUED:
                # Hoá đơn đã huỷ: tiền khách đã trả về quỹ của đơn như cọc (`quy_tien_don`).
                coc_theo_don[hd.order_id] = coc_theo_don.get(hd.order_id, 0) + int(l.amount_vnd)
            elif l.sales_invoice_id is not None:
                thu_dich_danh[l.sales_invoice_id] = (
                    thu_dich_danh.get(l.sales_invoice_id, 0) + int(l.amount_vnd)
                )
            else:
                coc_theo_don[l.order_id] = coc_theo_don.get(l.order_id, 0) + int(l.amount_vnd)

    tra_theo_don: dict[int, int] = {}
    hoan_rieng: dict[int, int] = {}
    for v in hoan_khach:
        if v.order_id is not None:
            tra_theo_don[v.order_id] = tra_theo_don.get(v.order_id, 0) + int(v.amount_vnd)
        elif v.customer_id is not None:
            hoan_rieng[v.customer_id] = hoan_rieng.get(v.customer_id, 0) + int(v.amount_vnd)

    theo_don: dict[int, list] = {}
    for hd in hoa_don:
        theo_don.setdefault(hd.order_id, []).append(hd)

    ra: list[dict] = []
    for don_id, ds in theo_don.items():
        con_coc = max(0, coc_theo_don.get(don_id, 0) - tra_theo_don.get(don_id, 0))
        for hd in sorted(ds, key=lambda x: (x.invoice_date, x.id)):
            tien = int(hd.amount_vnd)
            truc_tiep = min(tien, thu_dich_danh.get(hd.id, 0))
            bu_coc = min(con_coc, max(0, tien - truc_tiep))
            con_coc -= bu_coc
            ra.append({
                "id": hd.id,
                "hoa_don_id": hd.id,
                "doi_tuong_id": hd.customer_id,
                "ten_lui": hd.customer_name_snapshot,
                "so_ct": _so_hoa_don(hd),
                "ngay": hd.invoice_date,
                "han": hd.due_date,
                "goc": tien,
                "con_no": max(0, tien - truc_tiep - bu_coc),
                "thua": max(0, thu_dich_danh.get(hd.id, 0) - int(hd.amount_vnd)),
            })
    them = phan_bo_hoan_khong_don(ra, hoan_rieng)
    for k in ra:
        k["con_no"] += them.get(k["id"], 0)
    return ra


def _khoan_phai_tra(don, *, den_ngay: date):
    """Phần còn nợ của từng ĐỢT GIAO tính tới `den_ngay`.

    `phan_bo_tien_dot(..., den_ngay=...)` chỉ đếm tiền đã chi TỚI HẾT ngày đó, nên phần còn nợ
    của từng đợt là con số ĐÚNG TẠI MỐC ĐANG XEM. Hạn trả lấy bằng `han_tra_dot` — cùng thang
    4 bậc mà màn Công nợ đang dùng, không tự đặt luật hạn riêng ở đây."""
    for pr in don:
        phan_bo, _, _ = phan_bo_tien_dot(pr, den_ngay=den_ngay)
        for m in phan_bo:
            d = m["delivery"]
            if d.delivery_date > den_ngay:
                continue
            yield {
                "doi_tuong_id": pr.supplier_id,
                "ten_lui": None,
                # Số ĐỢT TRONG ĐƠN, cùng cách ghi với dòng "Hàng đã nhận" của sổ chi tiết.
                "so_ct": f"{pr.code} đợt {d.seq_no}",
                "ngay": d.delivery_date,
                "han": han_tra_dot(d, pr.supplier),
                "goc": int(m["amount"]),
                "con_no": int(m["con_no"]),
            }


def _con_no_theo_doi_tuong(chung_tu: list[dict], *, phai_tra: bool) -> dict:
    """Còn nợ cuối kỳ của từng đối tượng theo SỔ (cộng `net` mọi chứng từ tới `den_ngay`), kẹp ≥ 0.
    131 nợ là dư Nợ (`net` dương), 331 nợ là dư Có (`net` âm)."""
    so_du: dict = {}
    for c in chung_tu:
        so_du[c["doi_tuong_id"]] = so_du.get(c["doi_tuong_id"], 0) + c["net"]
    return {k: max(0, -v if phai_tra else v) for k, v in so_du.items()}


def _can_theo_so_du(khoan: list[dict], con_no_dt: dict) -> list[dict]:
    """Cân phần còn nợ của các khoản cho cộng lại ĐÚNG bằng còn nợ của đối tượng trên sổ.

    Vòng cấn trừ đích danh (`_khoan_phai_*`) chỉ trừ tiền vào đúng hoá đơn / đợt mà phiếu trỏ tới.
    Sổ thì cộng MỌI chứng từ tiền của đối tượng, nên hai bên lệch nhau ở (12/10/2026, dữ liệu dev):
      - tiền trả CHƯA cấn được vào khoản nào (cọc đơn khác chưa có hoá đơn, trả thừa một hoá đơn)
        ⇒ sổ đã trừ, mốc hạn chưa trừ: trừ dần vào khoản tới hạn SỚM NHẤT (trả cái cũ trước);
      - hoàn tiền (phiếu chi hoàn khách, phiếu thu NCC hoàn) ⇒ sổ cộng nợ lại, mốc hạn bỏ qua: cộng
        ngược vào khoản tới hạn MUỘN NHẤT, mỗi khoản không quá giá trị gốc của nó.
    Phần hoàn vượt hết sức chứa của các khoản (hiếm) dồn vào khoản muộn nhất để tổng vẫn khớp sổ.
    Đối tượng trả trước (dư bên kia) thì mọi khoản về 0."""
    theo_dt: dict = {}
    for k in khoan:
        theo_dt.setdefault(k["doi_tuong_id"], []).append(dict(k))
    ra: list[dict] = []
    for dt, ds in theo_dt.items():
        ds.sort(key=lambda k: (k["han"] is None, k["han"] or date.max, k["ngay"], k["so_ct"]))
        lech = sum(k["con_no"] for k in ds) - con_no_dt.get(dt, 0)
        if lech > 0:
            for k in ds:
                bot = min(k["con_no"], lech)
                k["con_no"] -= bot
                lech -= bot
        elif lech < 0 and ds:
            them = -lech
            for k in reversed(ds):
                cong = min(max(0, k["goc"] - k["con_no"]), them)
                k["con_no"] += cong
                them -= cong
            ds[-1]["con_no"] += them
        ra.extend(ds)
    return ra


def _ra_khoan_con_no(khoan, *, doi_tuong_id: int | None, den_ngay: date) -> dict:
    """Lọc các khoản CÒN NỢ của một đối tượng + gắn rổ tuổi tại `den_ngay`.

    Xếp khoản trễ lâu nhất lên đầu (đó là thứ cần trả / đòi trước), khoản chưa có hạn xuống cuối."""
    from .accounting_service import ro_tuoi

    ra = []
    for k in khoan:
        if k["doi_tuong_id"] != doi_tuong_id or k["con_no"] <= 0:
            continue
        tre = (den_ngay - k["han"]).days if k["han"] is not None else 0
        ra.append({
            "so_ct": k["so_ct"],
            "ngay": k["ngay"],
            "han": k["han"],
            "con_no": k["con_no"],
            # Âm = còn bấy nhiêu ngày mới tới hạn; 0 = đúng hạn hôm đó; None = chưa đặt hạn.
            "tre_ngay": tre if k["han"] is not None else None,
            "ro": ro_tuoi(max(0, tre)),
        })
    ra.sort(key=lambda r: (r["han"] is None, r["han"] or den_ngay, r["ngay"], r["so_ct"]))
    return {"den_ngay": den_ngay, "items": ra, "tong": sum(r["con_no"] for r in ra)}


def khoan_con_no_phai_thu(repo, *, doi_tuong_id: int | None, den_ngay: date) -> dict:
    """Các hoá đơn bán CÒN NỢ của một khách tại `den_ngay` — tab "Hoá đơn còn nợ"."""
    hoa_don, phieu, _khach_don, _ma_khach, hoan_khach = _nap_phai_thu(repo, den_ngay=den_ngay)
    # Theo ĐƠN, không cân theo dư 131 (17/10/2026) — xem `phan_bo_hoan_khong_don`.
    khoan = _khoan_phai_thu(hoa_don, phieu, hoan_khach, den_ngay)
    return _ra_khoan_con_no(khoan, doi_tuong_id=doi_tuong_id, den_ngay=den_ngay)


def khoan_con_no_phai_tra(
    repo, purchases, *, doi_tuong_id: int | None, den_ngay: date
) -> dict:
    """Các đợt giao CÒN NỢ của một nhà cung cấp tại `den_ngay` — tab "Đợt còn nợ"."""
    don, chi, hoan, ma_ncc = _nap_phai_tra(repo, purchases, den_ngay=den_ngay)
    chung_tu = _chung_tu_phai_tra(don, chi, hoan, ma_ncc, den_ngay=den_ngay)
    khoan = _can_theo_so_du(
        list(_khoan_phai_tra(don, den_ngay=den_ngay)), _con_no_theo_doi_tuong(chung_tu, phai_tra=True)
    )
    return _ra_khoan_con_no(khoan, doi_tuong_id=doi_tuong_id, den_ngay=den_ngay)


# ══════════════════════════════════════════════════════════════════════════════════
# LỌC NHANH + PHÂN TRANG của sổ tổng hợp (11/10/2026, phương án C)
# ══════════════════════════════════════════════════════════════════════════════════

#: Hàng lọc nhanh của sổ tổng hợp. `con_no` / `tra_truoc` đọc theo BÊN của tài khoản: 331 còn nợ là
#: dư Có, 131 còn nợ là dư Nợ — bên kia là tiền đã trả trước (331) / khách ứng trước (131).
THE_SO = ("all", "con_no", "qua_han", "tra_truoc")


def _khop_the(d: dict, the: str) -> bool:
    from .accounting_service import AGING_KEYS_TRE

    con_no, truoc = (d["cuoi_co"], d["cuoi_no"]) if d["tk"] == TK_PHAI_TRA else (d["cuoi_no"], d["cuoi_co"])
    if the == "con_no":
        return con_no > 0
    if the == "tra_truoc":
        return truoc > 0
    if the == "qua_han":
        return any((d.get("aging") or {}).get(k, {}).get("amount", 0) > 0 for k in AGING_KEYS_TRE)
    return True


def _con_no(d: dict) -> float:
    return d["cuoi_co"] if d["tk"] == TK_PHAI_TRA else d["cuoi_no"]


def loc_the_va_cat_trang(
    bc: dict, *, the: str | None, page: int, size: int | None, sap_xep: str | None = None
) -> dict:
    """Áp hàng lọc nhanh rồi cắt trang. Chạy SAU ô tìm và lọc rổ tuổi.

    - `dem_the`: số dòng mỗi mục lọc nhanh, đếm trên tập ĐÃ qua ô tìm / rổ tuổi (đúng nếp các
      danh sách khác: tab đếm theo bộ lọc) nhưng TRƯỚC khi áp chính mục lọc nhanh.
    - `tong` + `tong_aging`: dòng Cộng của MỌI dòng khớp bộ lọc, không chỉ trang đang xem.
    - `aging` (dải toàn màn) giữ nguyên — xem `_loc_ro` ở router.
    - `size` bỏ trống = trả hết (người gọi cũ, file Excel).
    - `sap_xep="con_no"`: còn nợ cuối kỳ giảm dần, để dạng biểu đồ lấy trang đầu làm các đối tượng
      nợ nhiều nhất (xếp trong trình duyệt thì sai khi quá một trang). Bỏ trống = theo tên."""
    from .accounting_service import AGING_KEYS

    goc = bc["items"]
    dem = {t: sum(1 for d in goc if _khop_the(d, t)) for t in THE_SO}
    giu = [d for d in goc if _khop_the(d, the or "all")] if the in THE_SO else goc
    if sap_xep == "con_no":
        giu = sorted(giu, key=_con_no, reverse=True)
    tong_ro = {k: sum((d.get("aging") or {}).get(k, {}).get("amount", 0) for d in giu) for k in AGING_KEYS}
    total = len(giu)
    if size:
        page = max(1, page)
        trang = giu[(page - 1) * size: page * size]
    else:
        page, trang = 1, giu
    return {
        **bc,
        "items": trang,
        "tong": _tong(giu),
        "tong_aging": tong_ro,
        "dem_the": dem,
        "total": total,
        "page": page,
        "size": size or total,
    }


def cat_trang_so_chi_tiet(so: dict, *, page: int, size: int | None) -> dict:
    """Cắt trang SỔ CHI TIẾT ở máy chủ, MỚI NHẤT LÊN ĐẦU (chủ chốt Cách 1: Đầu kỳ → phát sinh mới
    đến cũ → Cuối kỳ). Luỹ kế đã tính trên CẢ sổ theo thứ tự thời gian nên cắt sau không làm sai
    số nào; hai mốc đầu kỳ / cuối kỳ là trường riêng, trang nào cũng có. `size` bỏ trống = giữ nguyên
    thứ tự cũ, trả hết (file Excel và người gọi cũ)."""
    dong = so["dong"]
    if not size:
        return {**so, "so_dong": len(dong)}
    moi_truoc = list(reversed(dong))
    page = max(1, page)
    return {**so, "dong": moi_truoc[(page - 1) * size: page * size], "so_dong": len(dong)}


# Thứ tự trong một ngày của sổ chi tiết: chứng từ phát sinh nợ trước, chứng từ trả/thu sau.
_HANG_TRONG_NGAY = {"hoa_don": 0, "dot_giao": 0}


def _so_chi_tiet(
    chung_tu: list[dict],
    *,
    doi_tuong_id: int | None,
    tu_ngay: date,
    den_ngay: date,
    tk: str,
    tieu_de: str,
    ten_khong_gan: str,
) -> dict:
    """Sổ chi tiết của MỘT đối tượng: số dư đầu kỳ → từng chứng từ theo ngày → luỹ kế (§5.1).

    Luỹ kế chạy trên `net` rồi mới tách hai cột, y hệt sổ tổng hợp — nên dòng cuối cùng LUÔN bằng
    ô "Dư cuối kỳ" của chính đối tượng đó bên sổ tổng hợp. Đó là chỗ tự kiểm: lệch nhau nghĩa là
    có chứng từ rơi mất, và bài test đối chiếu hai bên sẽ đỏ.

    `doi_tuong_id = None` = dòng gom các khoản KHÔNG truy được về đối tượng nào (§❸).
    """
    cua_ai = [c for c in chung_tu if c["doi_tuong_id"] == doi_tuong_id and c["net"]]

    dau = sum(c["net"] for c in cua_ai if c["ngay"] < tu_ngay)
    trong_ky = sorted(
        (c for c in cua_ai if tu_ngay <= c["ngay"] <= den_ngay),
        # Cùng một ngày thì xếp theo GIỜ ghi nhận (`luc`), rồi tới số chứng từ cho ổn định — in
        # lại sổ phải ra đúng thứ tự cũ, không phụ thuộc thứ tự SQL trả về. So bằng chuỗi ISO để
        # không vấp chuyện datetime có/không mang múi giờ.
        # Trong một ngày, chứng từ PHÁT SINH nợ (hoá đơn, đợt nhận hàng) đứng trước chứng từ trả/thu:
        # nhận hàng nhập vào hệ sau phiếu chi cùng ngày thì số dư giữa kỳ ra âm (#73).
        key=lambda c: (
            c["ngay"],
            _HANG_TRONG_NGAY.get(c["loai"], 1),
            c["luc"].isoformat() if isinstance(c.get("luc"), datetime) else "",
            c["so_ct"] or "",
        ),
    )

    dau_no, dau_co = _hai_cot(dau)
    luy = dau
    dong: list[dict] = []
    for c in trong_ky:
        luy += c["net"]
        no, co = _hai_cot(c["net"])
        lk_no, lk_co = _hai_cot(luy)
        dong.append({
            "ngay": c["ngay"],
            # Giờ:phút GHI NHẬN (phiếu chi/thu = lúc tiền chạy, còn lại = lúc nhập vào hệ). Ngày
            # nghiệp vụ trong hệ chỉ có NGÀY, không có giờ — nên đây là thứ duy nhất tách được
            # thứ tự của nhiều chứng từ cùng một ngày.
            "luc": c.get("luc"),
            "loai": c["loai"],
            "so_ct": c["so_ct"],
            "ky_hieu": c.get("ky_hieu"),
            "don_id": c.get("don_id"),
            "so_hoa_don": c.get("so_hoa_don"),
            "ngay_hoa_don": c.get("ngay_hoa_don"),
            "don_ma": c.get("don_ma"),
            "dien_giai": c["dien_giai"],
            "tk_doi_ung": c.get("tk_doi_ung") or "",
            "no": no,
            "co": co,
            "luy_ke_no": lk_no,
            "luy_ke_co": lk_co,
        })

    cuoi_no, cuoi_co = _hai_cot(luy)
    goc = cua_ai[0] if cua_ai else None
    return {
        "tk": tk,
        "tieu_de": tieu_de,
        "doi_tuong_id": doi_tuong_id,
        "ma": (goc or {}).get("ma"),
        "ten": ((goc or {}).get("ten") or "").strip() or ten_khong_gan,
        "tu_ngay": tu_ngay,
        "den_ngay": den_ngay,
        "dau_no": dau_no,
        "dau_co": dau_co,
        "dong": dong,
        "ps_no": sum(d["no"] for d in dong),
        "ps_co": sum(d["co"] for d in dong),
        "hoan": sum(abs(c["net"]) for c in trong_ky if c["loai"] in LOAI_HOAN),
        "cuoi_no": cuoi_no,
        "cuoi_co": cuoi_co,
    }


# ══════════════════════════════════════════════════════════════════════════════════
# TK 131 — PHẢI THU KHÁCH HÀNG
# ══════════════════════════════════════════════════════════════════════════════════
def tong_hop_phai_thu(
    repo, *, tu_ngay: date, den_ngay: date,
    hoa_don_da_nap: list | None = None, tinh_tuoi: bool = True,
) -> dict:
    """Sổ tổng hợp công nợ phải thu (TK 131) cho kỳ `[tu_ngay, den_ngay]`.

    `hoa_don_da_nap` (tuỳ chọn): xem `_nap_phai_thu`. `tinh_tuoi=False` bỏ phần PHÂN TUỔI NỢ — rổ
    tuổi của mọi dòng ra 0. Chỉ màn Công nợ (kỳ kết thúc hôm nay, đọc số theo ảnh chụp) dùng,
    vì nó không đọc rổ tuổi của sổ; sổ báo cáo luôn tính đủ.

    PS Nợ = hoá đơn bán `issued` có `invoice_date` trong kỳ.
    PS Có = phiếu thu `received` có `receipt_date` trong kỳ, truy về khách qua hoá đơn hoặc đơn.

    CỌC ĐƠN HÀNG cũng là PS Có, kể cả khi chưa cấn trừ vào hoá đơn nào — khách đã đưa tiền thì
    131 phải ghi Có. Chính nhánh này làm nên cột "dư cuối kỳ bên Có" (khách ứng trước) mà bản
    xuất MISA vẫn có 4,5 tỷ.

    Phiếu thu `purchase_refund` (NCC hoàn tiền) KHÔNG thuộc 131 — nó là chuyện của 331.
    """
    gom = _Gom(tu_ngay, den_ngay, TK_PHAI_THU, KHONG_GAN_TEN_THU)
    hoa_don, phieu, khach_don, ma_khach, hoan_khach = _nap_phai_thu(
        repo, den_ngay=den_ngay, hoa_don_da_nap=hoa_don_da_nap
    )

    def _muc(kh_id: int | None, ten_lui: str | None) -> dict:
        k = ma_khach.get(kh_id) if kh_id else None
        return gom.muc(kh_id, (k.name if k else None) or ten_lui, k.code if k else None)

    # --- PS Nợ (hoá đơn bán) + PS Có (phiếu thu) ---
    # Đi qua ĐÚNG luồng chứng từ mà sổ chi tiết dùng, không tự lặp lại luật ngày/dấu ở đây.
    # `ban_ky`: phần PS Nợ là HOÁ ĐƠN — cột "Bán trong kỳ" của màn Công nợ đọc số này; PS Nợ còn gồm
    # phiếu hoàn tiền khách, không phải bán.
    ban_ky: dict[int | None, int] = {}
    chung_tu = _chung_tu_phai_thu(hoa_don, phieu, khach_don, ma_khach, hoan_khach, den_ngay)
    for ct in chung_tu:
        gom.cong(
            gom.muc(ct["doi_tuong_id"], ct["ten"], ct["ma"]), ct["ngay"], ct["net"],
            hoan=ct["loai"] in LOAI_HOAN,
        )
        if ct["loai"] == "hoa_don" and tu_ngay <= ct["ngay"] <= den_ngay:
            ban_ky[ct["doi_tuong_id"]] = ban_ky.get(ct["doi_tuong_id"], 0) + ct["net"]

    # ── PHÂN TUỔI NỢ tại `den_ngay` (§5.3) ────────────────────────────────────────────────
    #
    # Phải tính lại phần CÒN LẠI của từng hoá đơn TÍNH TỚI `den_ngay`, không mượn
    # `remaining_amount` của `_receivable_rows` — số đó là "còn lại tính tới HÔM NAY", nên tiền
    # khách trả SAU kỳ đã bị trừ mất và tuổi nợ của kỳ cũ hoá ra nhẹ đi. In lại kỳ tháng 7 vào
    # tháng 9 mà ra số khác lần in tháng 8 thì báo cáo hết dùng được.
    #
    # Cách cấn trừ y hệt `receivable_rows`: thu ĐÍCH DANH hoá đơn trừ trước, cọc của đơn cấn FIFO
    # theo (ngày hoá đơn, id). Chép luật ở đây là có ý — bản gốc không nhận mốc ngày.
    # Từ 17/10/2026 tuổi nợ đi THEO ĐƠN (không cân theo dư 131): tiền khách đang để ở đơn khác không
    # trừ vào hoá đơn của đơn này, nên sáu mốc hạn của một khách có thể cộng lớn hơn dư Nợ cuối kỳ
    # đúng bằng phần tiền đó. Phiếu trả lại không gắn đơn vẫn cộng nợ lại (`phan_bo_hoan_khong_don`).
    khoan = _khoan_phai_thu(hoa_don, phieu, hoan_khach, den_ngay) if tinh_tuoi else ()
    for k in khoan:
        _bo_ro(_muc(k["doi_tuong_id"], k["ten_lui"]), k["con_no"], k["han"], den_ngay)

    items = gom.ket_qua()
    for it in items:
        it["ban_ky"] = ban_ky.get(it["doi_tuong_id"], 0)
    tong_ro = _ro_rong()
    for o in gom.o.values():
        for k, v in o["aging"].items():
            tong_ro[k]["amount"] += v["amount"]
            tong_ro[k]["count"] += v["count"]

    return {
        "aging": _ro_ra_danh_sach(tong_ro),
        "tk": TK_PHAI_THU,
        "tieu_de": "TỔNG HỢP CÔNG NỢ PHẢI THU",
        "nhan_ma": "Mã khách hàng",
        "nhan_ten": "Tên khách hàng",
        "tu_ngay": tu_ngay,
        "den_ngay": den_ngay,
        "items": items,
        "tong": _tong(items),
    }


# ══════════════════════════════════════════════════════════════════════════════════
# TK 331 — PHẢI TRẢ NGƯỜI BÁN
# ══════════════════════════════════════════════════════════════════════════════════
def tong_hop_phai_tra(
    repo, purchases, *, tu_ngay: date, den_ngay: date,
    don_da_nap: list | None = None, tinh_tuoi: bool = True,
) -> dict:
    """Sổ tổng hợp công nợ phải trả (TK 331) cho kỳ `[tu_ngay, den_ngay]`.

    `don_da_nap` (tuỳ chọn): xem `_nap_phai_tra`. `tinh_tuoi=False` bỏ phần PHÂN TUỔI NỢ (mỗi đơn
    một lượt `phan_bo_tien_dot`) — rổ tuổi của mọi dòng ra 0. Chỉ màn Công nợ (kỳ kết thúc hôm
    nay, đọc số theo ảnh chụp) dùng, vì nó không đọc rổ tuổi của sổ; sổ báo cáo luôn tính đủ.

    PS Có = giá trị HÀNG ĐÃ NHẬN, theo `delivery_date` của từng đợt giao (chốt 03/09/2026: ghi nợ
    NCC theo NGÀY HÀNG VỀ, không phải ngày hoá đơn NCC — §5.4). Tiền của đợt lấy từ
    `phan_bo_du_dot`, tức là phần giao VƯỢT số đặt vẫn ghi 0đ, y hệt màn công nợ.

    PS Nợ = phiếu chi `paid`, theo ngày tiền rời két (`paid_at`, không có thì `voucher_date`).

    PS Có (thêm) = phiếu thu `purchase_refund` — NCC hoàn tiền lại thì nợ TĂNG trở lại.
    """
    gom = _Gom(tu_ngay, den_ngay, TK_PHAI_TRA, KHONG_GAN_TEN_TRA)
    don, chi, hoan, ma_ncc = _nap_phai_tra(
        repo, purchases, den_ngay=den_ngay, don_da_nap=don_da_nap
    )

    def _muc(ncc_id: int | None, ten_lui: str | None) -> dict:
        n = ma_ncc.get(ncc_id) if ncc_id else None
        return gom.muc(ncc_id, (n.name if n else None) or ten_lui, n.code if n else None)

    # --- PS Có (hàng đã nhận theo từng ĐỢT GIAO) + PS Nợ (phiếu chi) + PS Có (NCC hoàn tiền) ---
    # Đi qua ĐÚNG luồng chứng từ mà sổ chi tiết dùng, không tự lặp lại luật ngày/dấu ở đây.
    chung_tu = _chung_tu_phai_tra(don, chi, hoan, ma_ncc, den_ngay=den_ngay)
    for ct in chung_tu:
        gom.cong(
            gom.muc(ct["doi_tuong_id"], ct["ten"], ct["ma"]), ct["ngay"], ct["net"],
            hoan=ct["loai"] in LOAI_HOAN,
        )

    # ── PHÂN TUỔI NỢ tại `den_ngay` (§5.3) ────────────────────────────────────────────────
    #
    # `phan_bo_tien_dot(..., den_ngay=...)` chỉ đếm tiền đã chi TỚI HẾT ngày đó, nên phần còn nợ
    # của từng đợt là con số ĐÚNG TẠI MỐC ĐANG XEM. Hạn trả lấy bằng `han_tra_dot` — cùng thang
    # 4 bậc mà màn Công nợ đang dùng, không tự đặt luật hạn riêng ở đây.
    # Tiền trả chưa vào đợt nào và tiền NCC hoàn được cân theo số dư của sổ — xem `_can_theo_so_du`.
    khoan = (
        _can_theo_so_du(
            list(_khoan_phai_tra(don, den_ngay=den_ngay)), _con_no_theo_doi_tuong(chung_tu, phai_tra=True)
        )
        if tinh_tuoi else ()
    )
    for k in khoan:
        _bo_ro(_muc(k["doi_tuong_id"], None), k["con_no"], k["han"], den_ngay)

    items = gom.ket_qua()
    tong_ro = _ro_rong()
    for o in gom.o.values():
        for k, v in o["aging"].items():
            tong_ro[k]["amount"] += v["amount"]
            tong_ro[k]["count"] += v["count"]

    return {
        "aging": _ro_ra_danh_sach(tong_ro),
        "tk": TK_PHAI_TRA,
        "tieu_de": "TỔNG HỢP CÔNG NỢ PHẢI TRẢ",
        "nhan_ma": "Mã nhà cung cấp",
        "nhan_ten": "Tên nhà cung cấp",
        "tu_ngay": tu_ngay,
        "den_ngay": den_ngay,
        "items": items,
        "tong": _tong(items),
    }


# ══════════════════════════════════════════════════════════════════════════════════
# SỔ CHI TIẾT CÔNG NỢ theo MỘT đối tượng (§5.1) — "thứ kế toán cần khi ngồi đối chiếu với NCC"
# ══════════════════════════════════════════════════════════════════════════════════
def so_chi_tiet_phai_thu(
    repo, *, doi_tuong_id: int | None, tu_ngay: date, den_ngay: date
) -> dict:
    """Sổ chi tiết TK 131 của một khách hàng. `doi_tuong_id=None` = dòng không gắn khách (dữ liệu cũ)."""
    hoa_don, phieu, khach_don, ma_khach, hoan_khach = _nap_phai_thu(repo, den_ngay=den_ngay)
    return _so_chi_tiet(
        _chung_tu_phai_thu(hoa_don, phieu, khach_don, ma_khach, hoan_khach, den_ngay),
        doi_tuong_id=doi_tuong_id,
        tu_ngay=tu_ngay,
        den_ngay=den_ngay,
        tk=TK_PHAI_THU,
        tieu_de="SỔ CHI TIẾT CÔNG NỢ PHẢI THU",
        ten_khong_gan=KHONG_GAN_TEN_THU,
    )


def so_chi_tiet_phai_tra(
    repo, purchases, *, doi_tuong_id: int | None, tu_ngay: date, den_ngay: date
) -> dict:
    """Sổ chi tiết TK 331 của một nhà cung cấp. `doi_tuong_id=None` = dòng không gắn NCC (dữ liệu cũ)."""
    don, chi, hoan, ma_ncc = _nap_phai_tra(repo, purchases, den_ngay=den_ngay)
    return _so_chi_tiet(
        _chung_tu_phai_tra(don, chi, hoan, ma_ncc, den_ngay=den_ngay),
        doi_tuong_id=doi_tuong_id,
        tu_ngay=tu_ngay,
        den_ngay=den_ngay,
        tk=TK_PHAI_TRA,
        tieu_de="SỔ CHI TIẾT CÔNG NỢ PHẢI TRẢ",
        ten_khong_gan=KHONG_GAN_TEN_TRA,
    )


#: Giá trị mặc định của `loc` = lấy MỌI đối tượng. Không dùng `None` vì `None` đã là id THẬT của
#: dòng gom "không gắn đối tượng".
TAT_CA = object()


def _so_chi_tiet_moi_doi_tuong(
    chung_tu: list[dict], *, tu_ngay: date, den_ngay: date, tk: str, tieu_de: str,
    ten_khong_gan: str, loc=TAT_CA,
) -> dict:
    """Sổ chi tiết của MỌI đối tượng trong kỳ, gộp một bộ — cho file Excel chi tiết (24/09/2026).

    Tập đối tượng và thứ tự lấy ĐÚNG từ máy cộng của sổ tổng hợp (`_Gom.ket_qua`): cùng người,
    cùng thứ tự, cùng luật bỏ dòng trắng — mở hai file cạnh nhau là dò được từng người. Mỗi người
    vẫn đi qua `_so_chi_tiet`, nên dòng cộng của họ tự khớp ô dư cuối kỳ bên sổ tổng hợp.
    """
    gom = _Gom(tu_ngay, den_ngay, tk, ten_khong_gan)
    theo_ai: dict[int | None, list[dict]] = {}
    for ct in chung_tu:
        gom.cong(
            gom.muc(ct["doi_tuong_id"], ct["ten"], ct["ma"]), ct["ngay"], ct["net"],
            hoan=ct["loai"] in LOAI_HOAN,
        )
        theo_ai.setdefault(ct["doi_tuong_id"], []).append(ct)
    # Chọn MỘT người (24/09/2026): lấy cả người trắng số trong kỳ — đã chọn đích danh thì vẫn ra sổ
    # (đầu kỳ = cuối kỳ), không trả một file rỗng khó hiểu.
    cac_muc = (
        gom.ket_qua() if loc is TAT_CA
        else [m for m in gom.ket_qua(an_dong_trong=False) if m["doi_tuong_id"] == loc]
    )
    so = []
    for muc in cac_muc:
        mot = _so_chi_tiet(
            theo_ai.get(muc["doi_tuong_id"], []), doi_tuong_id=muc["doi_tuong_id"],
            tu_ngay=tu_ngay, den_ngay=den_ngay, tk=tk, tieu_de=tieu_de,
            ten_khong_gan=ten_khong_gan,
        )
        # Mã/tên theo sổ tổng hợp (đã gom mã từ mọi chứng từ), không theo chứng từ đầu tiên.
        mot["ma"], mot["ten"] = muc["ma"], muc["ten"]
        so.append(mot)
    return {
        "tk": tk,
        "tieu_de": tieu_de,
        "tu_ngay": tu_ngay,
        "den_ngay": den_ngay,
        "mot_nguoi": loc is not TAT_CA,
        "so": so,
        "tong": {
            k: sum(m[k] for m in so)
            for k in ("dau_no", "dau_co", "ps_no", "ps_co", "cuoi_no", "cuoi_co")
        },
    }


def so_chi_tiet_tat_ca_phai_thu(repo, *, tu_ngay: date, den_ngay: date, loc=TAT_CA) -> dict:
    """Sổ chi tiết TK 131 của MỌI khách có số trong kỳ — hoặc đúng một khách (`loc`)."""
    hoa_don, phieu, khach_don, ma_khach, hoan_khach = _nap_phai_thu(repo, den_ngay=den_ngay)
    return _so_chi_tiet_moi_doi_tuong(
        _chung_tu_phai_thu(hoa_don, phieu, khach_don, ma_khach, hoan_khach, den_ngay),
        tu_ngay=tu_ngay, den_ngay=den_ngay, tk=TK_PHAI_THU,
        tieu_de="SỔ CHI TIẾT CÔNG NỢ PHẢI THU", ten_khong_gan=KHONG_GAN_TEN_THU, loc=loc,
    )


def so_chi_tiet_tat_ca_phai_tra(
    repo, purchases, *, tu_ngay: date, den_ngay: date, loc=TAT_CA
) -> dict:
    """Sổ chi tiết TK 331 của MỌI nhà cung cấp có số trong kỳ — hoặc đúng một NCC (`loc`)."""
    don, chi, hoan, ma_ncc = _nap_phai_tra(repo, purchases, den_ngay=den_ngay)
    return _so_chi_tiet_moi_doi_tuong(
        _chung_tu_phai_tra(don, chi, hoan, ma_ncc, den_ngay=den_ngay),
        tu_ngay=tu_ngay, den_ngay=den_ngay, tk=TK_PHAI_TRA,
        tieu_de="SỔ CHI TIẾT CÔNG NỢ PHẢI TRẢ", ten_khong_gan=KHONG_GAN_TEN_TRA, loc=loc,
    )


__all__ = [
    "KHONG_GAN_TEN_THU",
    "KHONG_GAN_TEN_TRA",
    "TK_PHAI_THU",
    "TK_PHAI_TRA",
    "ngay_chi",
    "so_chi_tiet_phai_thu",
    "so_chi_tiet_phai_tra",
    "so_chi_tiet_tat_ca_phai_thu",
    "so_chi_tiet_tat_ca_phai_tra",
    "tong_hop_phai_thu",
    "tong_hop_phai_tra",
]
