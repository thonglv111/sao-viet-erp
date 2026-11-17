"""Nhập / xuất Excel dòng hàng của trang Tạo đơn thương mại — chỉ In Hà Phương (16/11/2026).

Trang đầu "Mặt hàng" có năm cột: Mã hàng, Tên hàng, Đơn vị, Số lượng, VAT %. File không có cột đơn giá: dòng nhập
vào lấy giá bán khai trên trang, chưa khai thì người lập gõ trên trang. Trang thứ hai "Danh mục hàng" liệt kê mọi
hàng thương mại đang bán (mã, tên, đơn vị) để chọn mã trong ô Mã hàng; Tên hàng tự hiện theo mã, chỉ để nhìn.

Xuất ra đúng các dòng đang có trên trang (chưa lưu cũng được); không có dòng nào thì ra file mẫu. Nhập vào thì chỉ
ĐỌC file và trả các dòng đã kiểm để trang điền vào bảng, chưa ghi gì vào đơn: người bán xem lại rồi mới bấm lưu.
Cả file là một lượt: còn dòng lỗi thì không trả dòng nào, báo đủ các dòng lỗi một lần.
"""
from __future__ import annotations

from io import BytesIO

from sqlalchemy.orm import Session

from ...repositories.thuong_mai_repo import ThuongMaiRepository
from .don_thuong_mai import DonThuongMaiError, dvt_cua_hang

COT = ["Mã hàng", "Tên hàng", "Đơn vị", "Số lượng", "VAT %"]
RONG = [18, 44, 14, 14, 10]
GHI_CHU = [
    "Bắt buộc. Chọn trong danh sách hoặc gõ mã (không phân biệt chữ hoa, chữ thường). "
    "Mã có ở trang Danh mục hàng.",
    "Tự hiện theo mã hàng, không cần gõ. Phần mềm không đọc cột này.",
    "Bỏ trống là đơn vị chính của mặt hàng. Gõ tên hoặc mã đơn vị đã khai cho mặt hàng.",
    "Bắt buộc. Số nguyên lớn hơn 0.",
    "Số nguyên từ 0 đến 100. Bỏ trống là 0.",
]
TOI_DA_DONG = 500
DONG_MAU = 200  # số dòng kẻ sẵn của file mẫu
TRANG_DM = "Danh mục hàng"

NEN_TIEU_DE = "34495E"
NEN_TU_HIEN = "F2F4F7"
VIEN = "D0D5DD"


def _ten_dvt(ma_ten: list[tuple[str, str]]) -> dict[str, str]:
    return {m.strip().lower(): (t or m) for m, t in ma_ten}


def _ke_tieu_de(ws, cot: list[str], rong: list[int]) -> None:
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    ws.append(cot)
    vien = Side(style="thin", color=VIEN)
    for i, o in enumerate(ws[1]):
        o.font = Font(bold=True, color="FFFFFF")
        o.fill = PatternFill("solid", fgColor=NEN_TIEU_DE)
        o.alignment = Alignment(horizontal="center", vertical="center")
        o.border = Border(left=vien, right=vien, top=vien, bottom=vien)
        ws.column_dimensions[o.column_letter].width = rong[i]
    ws.row_dimensions[1].height = 24
    ws.freeze_panes = "A2"


def _ke_dong(ws, tu: int, den: int, so_cot: int) -> None:
    from openpyxl.styles import Alignment, Border, Side

    vien = Side(style="thin", color=VIEN)
    khung = Border(left=vien, right=vien, top=vien, bottom=vien)
    for r in range(tu, den + 1):
        ws.row_dimensions[r].height = 20
        for c in range(1, so_cot + 1):
            ws.cell(r, c).border = khung
            ws.cell(r, c).alignment = Alignment(vertical="center")


def _vua_trang(ws) -> None:
    """In ra vừa bề ngang một trang giấy nằm, lặp dòng tiêu đề."""
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = "1:1"


def xuat(db: Session, lines: list[dict]) -> bytes:
    from openpyxl import Workbook
    from openpyxl.comments import Comment
    from openpyxl.styles import Alignment, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation

    repo = ThuongMaiRepository(db)
    hang = repo.hang_theo_id([int(ln["hang_id"]) for ln in lines if ln.get("hang_id")])
    ten_dvt = _ten_dvt(repo.don_vi_ma_ten())
    wb = Workbook()
    ws = wb.active
    ws.title = "Mặt hàng"
    _ke_tieu_de(ws, COT, RONG)
    for o, gc in zip(ws[1], GHI_CHU):
        o.comment = Comment(gc, "Phần mềm")
        o.comment.width, o.comment.height = 260, 90

    # Trang Danh mục hàng: nguồn cho danh sách chọn mã và cho Tên hàng tự hiện.
    dm = wb.create_sheet(TRANG_DM)
    _ke_tieu_de(dm, ["Mã hàng", "Tên hàng", "Đơn vị chính", "Đơn vị khác"], [18, 44, 14, 24])
    ds = repo.hang_thuong_mai_dang_ban()
    for h in ds:
        dv = dvt_cua_hang(h)
        dm.append([h.ma, h.ten, ten_dvt.get(dv[0], dv[0]) if dv else None,
                   ", ".join(ten_dvt.get(m, m) for m in dv[1:]) or None])
    cuoi_dm = max(len(ds) + 1, 2)
    _ke_dong(dm, 2, cuoi_dm, 4)
    _vua_trang(dm)

    dong = []
    for ln in lines:
        h = hang.get(int(ln.get("hang_id") or 0))
        if h is None:
            continue
        dvt = (ln.get("dvt") or h.don_vi_gia or "").strip().lower()
        dong.append([h.ma, ten_dvt.get(dvt, dvt), ln.get("qty"), int(ln.get("vat_pct") or 0)])

    nen_tu_hien = PatternFill("solid", fgColor=NEN_TU_HIEN)
    so_dong = max(DONG_MAU, len(dong) + 50)
    _ke_dong(ws, 2, so_dong + 1, 5)
    for r in range(2, so_dong + 2):
        d = dong[r - 2] if r - 2 < len(dong) else [None, None, None, None]
        ws.cell(r, 1, d[0])
        ws.cell(r, 2, f'=IF(A{r}="","",IFERROR(VLOOKUP(A{r},\'{TRANG_DM}\'!$A:$B,2,FALSE),"Không có mã này"))')
        ws.cell(r, 3, d[1])
        ws.cell(r, 4, d[2])
        ws.cell(r, 5, d[3])
        ws.cell(r, 2).fill = nen_tu_hien
        ws.cell(r, 4).number_format = "#,##0"
        ws.cell(r, 4).alignment = ws.cell(r, 5).alignment = Alignment(horizontal="right", vertical="center")

    vung = lambda c: f"{c}2:{c}{so_dong + 1}"  # noqa: E731
    ma = DataValidation(type="list", formula1=f"='{TRANG_DM}'!$A$2:$A${cuoi_dm}", allow_blank=True,
                        errorStyle="warning", showErrorMessage=True, errorTitle="Mã hàng",
                        error="Mã này không có ở trang Danh mục hàng. Vẫn giữ?")
    sl = DataValidation(type="whole", operator="greaterThan", formula1="0", allow_blank=True,
                        showErrorMessage=True, errorTitle="Số lượng", error="Số lượng là số nguyên lớn hơn 0.")
    vat = DataValidation(type="whole", operator="between", formula1="0", formula2="100", allow_blank=True,
                         showErrorMessage=True, errorTitle="VAT %", error="VAT % là số nguyên từ 0 đến 100.")
    for dv, c in ((ma, "A"), (sl, "D"), (vat, "E")):
        ws.add_data_validation(dv)
        dv.add(vung(c))

    _vua_trang(ws)
    wb.calculation.fullCalcOnLoad = True
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def _chuoi(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def _so(v, nhan: str) -> float | None:
    s = _chuoi(v)
    if not s:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    # "1.000" / "1,000" kiểu gõ tay: bỏ dấu nghìn.
    try:
        return float(s.replace(".", "").replace(",", "").replace(" ", ""))
    except ValueError:
        raise ValueError(f"{nhan} «{s}» không phải số") from None


def doc(db: Session, du_lieu: bytes) -> list[dict]:
    """Các dòng `{hang_id, dvt, qty, vat_pct, hang}` đọc từ file (`hang` là mặt hàng, router lọc tiền). Lỗi ⇒ `DonThuongMaiError` kể đủ dòng."""
    from openpyxl import load_workbook

    try:
        wb = load_workbook(BytesIO(du_lieu), read_only=True, data_only=True)
    except Exception:  # noqa: BLE001 — file hỏng / không phải xlsx
        raise DonThuongMaiError("Không đọc được file. Chọn file Excel .xlsx (tải file mẫu nếu cần).") from None
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise DonThuongMaiError("File không có dòng nào.")
    tieu_de = [_chuoi(c).lower() for c in rows[0]]
    vi_tri = {ten: tieu_de.index(ten.lower()) for ten in COT if ten.lower() in tieu_de}
    if "Mã hàng" not in vi_tri or "Số lượng" not in vi_tri:
        raise DonThuongMaiError("Dòng đầu file phải có cột «Mã hàng» và «Số lượng» (tải file mẫu để xem đúng cột).")

    def o(dong: tuple, ten: str):
        i = vi_tri.get(ten)
        return dong[i] if i is not None and i < len(dong) else None

    # Dòng có hàng = có Mã hàng hoặc Số lượng. Tên hàng là công thức tự hiện, VAT % người ta hay kéo sẵn cả cột.
    doc_cot = [vi_tri["Mã hàng"], vi_tri["Số lượng"]]
    du = [(so, r) for so, r in enumerate(rows[1:], start=2)
          if any(_chuoi(r[i]) for i in doc_cot if i < len(r))]
    if not du:
        raise DonThuongMaiError("File chưa có mặt hàng nào dưới dòng tiêu đề.")
    if len(du) > TOI_DA_DONG:
        raise DonThuongMaiError(f"Mỗi lần nhập tối đa {TOI_DA_DONG} dòng.")

    repo = ThuongMaiRepository(db)
    hang = repo.hang_thuong_mai_theo_ma([_chuoi(o(r, "Mã hàng")) for _, r in du])
    theo_ten = {}
    for m, t in repo.don_vi_ma_ten():
        theo_ten.setdefault(t.strip().lower(), m.strip().lower())
        theo_ten.setdefault(m.strip().lower(), m.strip().lower())

    ra: list[dict] = []
    loi: list[str] = []
    for so, r in du:
        try:
            ma = _chuoi(o(r, "Mã hàng"))
            if not ma:
                raise ValueError("thiếu mã hàng")
            h = hang.get(ma.lower())
            if h is None:
                raise ValueError(f"mã «{ma}» không có trong danh mục Hàng thương mại")
            if not h.active:
                raise ValueError(f"«{h.ten}» đã ngừng bán")
            go = _chuoi(o(r, "Đơn vị")).lower()
            dvt = theo_ten.get(go, go) if go else (h.don_vi_gia or "").strip().lower()
            if dvt not in dvt_cua_hang(h):
                raise ValueError(f"«{h.ten}» chưa khai đơn vị «{go or dvt}»")
            sl = _so(o(r, "Số lượng"), "Số lượng")
            if sl is None or sl <= 0 or not float(sl).is_integer():
                raise ValueError("số lượng phải là số nguyên lớn hơn 0")
            vat = _so(o(r, "VAT %"), "VAT %") or 0
            if not 0 <= vat <= 100 or not float(vat).is_integer():
                raise ValueError("VAT % phải là số nguyên từ 0 đến 100")
            ra.append({"hang_id": h.id, "dvt": dvt, "qty": int(sl), "vat_pct": int(vat), "hang": h})
        except ValueError as e:
            loi.append(f"Dòng {so}: {e}.")
    if loi:
        raise DonThuongMaiError("File chưa nhập được. " + " ".join(loi[:20])
                                + (f" Còn {len(loi) - 20} dòng lỗi khác." if len(loi) > 20 else ""))
    return ra
