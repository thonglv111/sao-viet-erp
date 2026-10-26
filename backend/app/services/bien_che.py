"""MỘT định nghĩa "BIÊN CHẾ" cho cả 5 phân hệ (bản rà liên thông 08/09/2026, nhóm gốc 1).

Trước đó chấm công/phép nhìn 2 cột `hire_date`/`resign_date` + phòng ban HIỆN TẠI, còn lương suy
theo `employee_events` tại cuối kỳ. Hai định nghĩa lệch nhau đúng ở ca biên: tuyển lại (tháng trống
giữa hai lần làm bỗng có công lễ + phụ cấp), nghỉ dài hạn / đình chỉ (vẫn bấm giờ ra công, hưởng
công lễ), chấm bù / đơn phép cho ngày sau nghỉ việc, nghỉ đúng ngày lễ (chấm công đếm 1 công lễ,
lương thì không). Từ nay mọi nơi hỏi cùng một câu: *"ngày d, người này có đang làm việc không, ở
phòng nào?"* — và hỏi ĐÚNG MỘT CHỖ này.

Quy ước:
- `resign_date` = NGÀY ĐẦU KHÔNG LÀM (thống nhất A8): ngày đó đã ngoài biên chế.
- "Đang làm" = thử việc · hết thử việc (chờ xác nhận) · chính thức. Nghỉ dài hạn (thai sản, ốm dài,
  không lương dài) và đình chỉ là NGOÀI biên chế: không lương, không công lễ, không bấm giờ — chủ
  chốt 07/09/2026: *"nghỉ dài hạn mặc định không có lương, thế thôi; ai trả cho họ là luồng ngoài"*.
- Trạng thái/phòng tại một ngày dựng lại từ `employee_events` (field `status` / `department`,
  có `effective_date`): trạng thái TRƯỚC sự kiện đầu tiên là `from_value` của nó, sau mỗi sự kiện
  là `to_value`. Không có sự kiện nào của trường đó thì lấy cột hiện tại. Cách này đúng cho cả sự
  kiện đã áp sớm vào cột (dữ liệu cũ) lẫn sự kiện đúng ngày.
"""
from __future__ import annotations

import calendar
from bisect import bisect_right
from datetime import date, timedelta

from ..models.employee import (
    STATUS_ACTIVE,
    STATUS_ON_LEAVE,
    STATUS_PROBATION,
    STATUS_PROBATION_ENDED,
    STATUS_RESIGNED,
    STATUS_SUSPENDED,
)

#: Trạng thái được coi là ĐANG LÀM VIỆC (có công, có lương, được bấm giờ).
TRANG_THAI_DANG_LAM = frozenset({STATUS_PROBATION, STATUS_PROBATION_ENDED, STATUS_ACTIVE})


def _loc_xep(events, field: str) -> list:
    return sorted(
        (e for e in (events or [])
         if getattr(e, "field", None) == field and getattr(e, "effective_date", None) is not None),
        key=lambda e: (e.effective_date, e.id or 0),
    )


#: Dấu "lấy giá trị cột hiện tại" trong mốc đã dựng — cột có thể đổi giữa hai lần hỏi nên không
#: chụp cứng giá trị vào bản nhớ.
_HIEN_TAI = object()


def _moc(events, field: str):
    """Dựng MỘT lần các mốc của một trường: `(giá trị trước mốc đầu, [ngày], [giá trị sau ngày])`.

    `gia_tri[i]` = giá trị sau khi áp MỌI sự kiện có ngày ≤ `ngay[i]` — đúng phép duyệt tuần tự cũ
    (sự kiện thiếu `to_value` giữ nguyên giá trị đang có). None = trường không có sự kiện nào."""
    evs = _loc_xep(events, field)
    if not evs:
        return None
    dau = evs[0].from_value if evs[0].from_value is not None else _HIEN_TAI
    cur = dau
    ngay, gia_tri = [], []
    for e in evs:
        if e.to_value is not None:
            cur = e.to_value
        ngay.append(e.effective_date)
        gia_tri.append(cur)
    return dau, ngay, gia_tri


def _moc_nho(events, field: str):
    # Danh sách nạp gộp (`DsSuKien`) nhớ sẵn mốc đã dựng: bảng công hỏi 31 ngày × mỗi người.
    nho = getattr(events, "nho", None)
    return nho(("bien_che_moc", field), lambda: _moc(events, field)) if nho else _moc(events, field)


def _gia_tri_tren_ngay(gia_tri_hien_tai, events, field: str, d: date):
    m = _moc_nho(events, field)
    if m is None:
        return gia_tri_hien_tai
    dau, ngay, gia_tri = m
    i = bisect_right(ngay, d)
    v = dau if i == 0 else gia_tri[i - 1]
    return gia_tri_hien_tai if v is _HIEN_TAI else v


def trang_thai_tren_ngay(emp, events, d: date) -> tuple[str, int | None]:
    """(trạng thái, department_id) của `emp` tại ngày `d`, dựng từ `events` (mọi sự kiện của NV)."""
    status = _gia_tri_tren_ngay(emp.status, events, "status", d)
    dept_now = getattr(emp, "department_id", None)
    dept = _gia_tri_tren_ngay(str(dept_now) if dept_now is not None else None, events, "department", d)
    try:
        dept_id = int(dept) if dept not in (None, "", "None") else None
    except (TypeError, ValueError):
        dept_id = dept_now
    return status, dept_id


def trong_bien_che(emp, events, d: date) -> bool:
    """Ngày `d` người này có ĐANG LÀM VIỆC không (đủ điều kiện có công, công lễ, bấm giờ, đơn)."""
    return ly_do_ngoai_bien_che(emp, events, d) is None


def ly_do_ngoai_bien_che(emp, events, d: date) -> str | None:
    """None = trong biên chế. Chuỗi = lý do (đã viết cho người dùng đọc, dùng chung mọi cửa ghi)."""
    ten = getattr(emp, "full_name", None) or "Nhân viên"
    hire = getattr(emp, "hire_date", None)
    if hire is not None and d < hire:
        return f"{ten} chưa vào làm ngày {d:%d/%m/%Y} (ngày vào làm {hire:%d/%m/%Y})."
    resign = getattr(emp, "resign_date", None)
    if resign is not None and d >= resign:
        return f"{ten} đã nghỉ việc từ {resign:%d/%m/%Y} — ngày {d:%d/%m/%Y} ngoài biên chế."
    # Chỉ cần TRẠNG THÁI — phòng ban không quyết định biên chế, khỏi dựng lại nó mỗi ngày.
    status = _gia_tri_tren_ngay(emp.status, events, "status", d)
    if status in TRANG_THAI_DANG_LAM:
        return None
    if status == STATUS_ON_LEAVE:
        return (f"{ten} đang nghỉ dài hạn ngày {d:%d/%m/%Y} — không có công/lương; "
                f"HCNS bấm \"Đi làm lại\" ở hồ sơ trước.")
    if status == STATUS_SUSPENDED:
        return f"{ten} đang bị đình chỉ ngày {d:%d/%m/%Y} — không có công/lương."
    if status == STATUS_RESIGNED:
        return f"{ten} đã nghỉ việc — ngày {d:%d/%m/%Y} ngoài biên chế."
    return f"{ten} không ở trạng thái đang làm việc ngày {d:%d/%m/%Y} ({status})."


def ngay_trong_bien_che_thang(emp, events, year: int, month: int) -> set[int]:
    """TẬP NGÀY (1..31) trong tháng mà `trong_bien_che` trả True — tính bằng KHOẢNG, không hỏi
    từng ngày (26/10/2026: bảng công 6.300 người × 31 ngày là 240 nghìn lượt hỏi).

    Cùng luật với `ly_do_ngoai_bien_che`: [hire_date, resign_date) giao với các đoạn trạng thái
    "đang làm" dựng từ sự kiện `status`."""
    last = calendar.monthrange(year, month)[1]
    lo, hi = date(year, month, 1), date(year, month, last)
    hire = getattr(emp, "hire_date", None)
    if hire is not None and hire > lo:
        lo = hire
    resign = getattr(emp, "resign_date", None)
    if resign is not None and resign - timedelta(days=1) < hi:
        hi = resign - timedelta(days=1)
    if lo > hi:
        return set()
    m = _moc_nho(events, "status")
    if m is None:
        return set(range(lo.day, hi.day + 1)) if emp.status in TRANG_THAI_DANG_LAM else set()
    dau, ngay, gia_tri = m
    out: set[int] = set()
    tu = lo
    while tu <= hi:
        # Đoạn [tu, đến] cùng một trạng thái: tới trước mốc kế tiếp lớn hơn `tu`.
        i = bisect_right(ngay, tu)
        v = dau if i == 0 else gia_tri[i - 1]
        if v is _HIEN_TAI:
            v = emp.status
        den = min(hi, ngay[i] - timedelta(days=1)) if i < len(ngay) else hi
        if v in TRANG_THAI_DANG_LAM:
            out.update(range(tu.day, den.day + 1))
        tu = den + timedelta(days=1)
    return out


def trong_bien_che_thang(emp, events, year: int, month: int) -> bool:
    """Có ÍT NHẤT một ngày trong tháng còn biên chế — ai lên Bảng công / có dòng lương."""
    return bool(ngay_trong_bien_che_thang(emp, events, year, month))
