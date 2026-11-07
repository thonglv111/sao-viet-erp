"""Báo cáo KCS — tổng hợp theo filter + scope, và xuất Excel hai sheet (§5.7, mg 0250).

TÁCH RIÊNG khỏi `kcs.py` (chỉ đọc, không viết) để không làm file đó phình thêm. Endpoint JSON
(`bao_cao_kcs`) và endpoint Excel (`xuat_excel_kcs`) dùng CHUNG một hàm lấy dòng dữ liệu
(`_hang_kcs_theo_scope`) — bắt buộc để "cùng filter trả cùng tổng" (§9 mục 10) không thể lệch
khi một bên sửa mà quên bên kia.

KCS theo lệnh (mg 0306): một lần kiểm chỉ còn một loại, tổ gắn với nó là tổ của CÔNG ĐOẠN bị kiểm
(`cong_viec.department_id`). Người thuộc tổ KCS thấy mọi lần kiểm; người khác thấy lần kiểm trên
công đoạn của tổ mình XEM TRỌN, và lần kiểm ở tổ khác có lỗi quy về tổ đó (08/10/2026).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.cong_doan import CongDoan
from ...models.customer import Customer
from ...models.department import Department
from ...models.lsx import Lsx
from ...models.order import Order
from ...models.san_xuat import SanXuatCongViec
from ...models.san_xuat_kcs import (
    KCS_DAT,
    KCS_DAT_MOT_PHAN,
    KCS_KHONG_DAT,
    SanXuatKcsBatch,
    SanXuatKcsLoi,
)
from ...models.user import User
from ...repositories.san_xuat_kcs_repo import SanXuatKcsRepository
from ...services.rbac_service import AuthorizationService
from ..gio_xuong import thuc_te_hien_thi
from ..quyen_to import VIEC_XEM, quyen_to_cua

# Cùng chữ với màn KCS (`kcsNhan.KCS_KET_LUAN`) — "Có lỗi", không phải "Đạt một phần".
_KET_LUAN_LABEL = {KCS_DAT: "Đạt", KCS_DAT_MOT_PHAN: "Có lỗi", KCS_KHONG_DAT: "Không đạt"}
_CHUA_PHAN_LOAI = "Chưa phân loại"


def _trang_thai_gui_kho(cv: SanXuatCongViec, dong: list, *, dat: float, tot: float) -> str:
    """Trạng thái gửi kho của CÔNG ĐOẠN cuối (yêu cầu kho tính theo công đoạn, không theo lần kiểm):
    kho còn dòng chưa nhận ⇒ `dang_cho`; còn số đạt chưa gửi ⇒ `chua_gui`; không thì `da_nhap`."""
    if not cv.la_kcs_cuoi:
        return "khong_ap_dung"
    if any(d.cho_kho for d in dong):
        return "dang_cho"
    da_gui = sum(d.sl_da_de_nghi_kcs for d in dong)
    if not dong or min(dat, tot) - da_gui > 0.0005:
        return "chua_gui"
    return "da_nhap"


def _ve_gio_vn(dt: datetime | None) -> datetime | None:
    """Quy mốc THỰC THI (UTC thật) về giờ tường xưởng, bỏ tzinfo — đúng convention đầu ra của
    `services/san_xuat/*.py`. Đi qua `gio_xuong.thuc_te_hien_thi` để chỉ có MỘT chỗ quy đổi (và
    lấy đúng múi máy chủ thay vì ghim cứng Asia/Bangkok)."""
    return thuc_te_hien_thi(dt)


def _ngay_vn(dt: datetime | None) -> date | None:
    v = _ve_gio_vn(dt)
    return v.date() if v else None


def _hang_kcs_theo_scope(
    db: Session,
    user: User,
    authz: AuthorizationService,
    *,
    tu: date | None = None,
    den: date | None = None,
    lsx_id: int | None = None,
    tu_khoa: str | None = None,
    cong_doan_id: int | None = None,
    khach_id: int | None = None,
    cong_doan: str | None = None,
) -> list[tuple[SanXuatKcsBatch, SanXuatCongViec]]:
    """Danh sách (batch, công việc) đã lọc filter + scope — NGUỒN DUY NHẤT cho cả `bao_cao_kcs`
    và `xuat_excel_kcs` (§9 mục 10: hai đầu ra phải cùng tổng).

    Thanh lọc của tab Báo cáo lỗi (09/10/2026): `tu`/`den` theo NGÀY KIỂM, `tu_khoa` khớp mã/tên lệnh,
    số đơn, tên khách (cùng ô tìm với tab Lệnh), `khach_id` khách của đơn, `cong_doan` tên công đoạn
    bị kiểm (tên snapshot — xem chú thích `cong_doan_id`)."""
    from .kcs import xem_kcs

    # Có Xem KCS thì thấy mọi tổ; người khác chỉ tổ XEM TRỌN — "Của tôi" không mở số liệu cả tổ.
    ids_thay_duoc = None if xem_kcs(db, user) else quyen_to_cua(db, user).tron[VIEC_XEM]
    # Lần kiểm ở tổ khác mà có lỗi quy về tổ mình thấy được — tổ chịu phải thấy lỗi của mình
    # (08/10/2026, lỗi tính theo công đoạn GÂY).
    batch_co_loi_cua_minh = (
        SanXuatKcsRepository(db).batch_co_loi_cua_to(ids_thay_duoc) if ids_thay_duoc else set()
    )

    stmt = (
        select(SanXuatKcsBatch, SanXuatCongViec)
        .join(SanXuatCongViec, SanXuatKcsBatch.cong_viec_id == SanXuatCongViec.id)
        .where(SanXuatCongViec.gia_cong_ngoai_id.is_(None))
        .order_by(SanXuatKcsBatch.bat_dau, SanXuatKcsBatch.id)
    )
    if lsx_id:
        stmt = stmt.where(SanXuatCongViec.lsx_id == lsx_id)
    if cong_doan_id:
        # Không FK trực tiếp từ SanXuatCongViec tới danh mục CongDoan (công đoạn neo LỎNG qua
        # lsx_cong_doan_id/bai_ghep_cong_doan_id — id KHÔNG ổn định, replace_routing tái sinh id,
        # join trực tiếp có thể mất dấu batch cũ). So khớp theo TÊN snapshot thay vào — cùng cách
        # công đoạn được hiển thị ở mọi nơi khác trong module (Ruling 3).
        cd = db.get(CongDoan, cong_doan_id)
        ten_cd = cd.ten if cd is not None else "\0__khong_khop__"
        stmt = stmt.where(SanXuatCongViec.ten_cong_doan == ten_cd)
    if tu_khoa:
        kw = f"%{tu_khoa.strip()}%"
        stmt = stmt.where(
            SanXuatCongViec.lsx_id.in_(
                select(Lsx.id)
                .join(Order, Lsx.order_id == Order.id, isouter=True)
                .join(Customer, Order.customer_id == Customer.id, isouter=True)
                .where(Lsx.ma.ilike(kw) | Lsx.ten.ilike(kw) | Order.order_no.ilike(kw)
                       | Customer.name.ilike(kw))
            )
        )
    if khach_id:
        stmt = stmt.where(SanXuatCongViec.lsx_id.in_(
            select(Lsx.id).join(Order, Lsx.order_id == Order.id).where(Order.customer_id == khach_id)
        ))
    if cong_doan:
        stmt = stmt.where(SanXuatCongViec.ten_cong_doan == cong_doan)

    out: list[tuple[SanXuatKcsBatch, SanXuatCongViec]] = []
    for kcs, cv in db.execute(stmt).all():
        if (ids_thay_duoc is not None and cv.department_id not in ids_thay_duoc
                and kcs.id not in batch_co_loi_cua_minh):
            continue
        d = _ngay_vn(kcs.bat_dau)
        if tu and (d is None or d < tu):
            continue
        if den and (d is None or d > den):
            continue
        out.append((kcs, cv))
    return out


def _checklist_rows_cho_batch(kcs: SanXuatKcsBatch, cv: SanXuatCongViec,
                              cv_theo_id: dict[int, SanXuatCongViec]) -> list[dict]:
    """1 dòng/tiêu chí/kết quả — JOIN `checklist_json` (câu trả lời) với ảnh chụp
    `kcs_tieu_chi_json` (mã/tên) của công việc NGUỒN — hai field JSON KHÁC NHAU (mục 3.7). Khoá =
    (công việc nguồn, `thu_tu`): bước KCS cuối xét tiêu chí gộp cả chuỗi (08/10/2026), phần tử cũ
    thiếu `cong_viec_id` là của chính công việc lần kiểm. `cv_theo_id` = công việc nguồn nạp sẵn."""
    if not kcs.checklist_json:
        return []
    out = []
    for kq in kcs.checklist_json:
        if not isinstance(kq, dict):
            continue
        nguon = cv_theo_id.get(kq.get("cong_viec_id") or cv.id) or cv
        if not nguon.kcs_tieu_chi_json:
            continue        # việc cũ không có ảnh chụp tiêu chí — không đẻ dòng rác
        tc = next((t for t in (nguon.kcs_tieu_chi_json or [])
                   if isinstance(t, dict) and t.get("thu_tu") == kq.get("thu_tu")), {})
        out.append({
            "kcs_batch_id": kcs.id,
            "thoi_diem": _ve_gio_vn(kcs.bat_dau),
            "cong_doan": nguon.ten_cong_doan,
            "ma": tc.get("ma"),
            "ten": tc.get("ten"),
            "dat": bool(kq.get("dat")),
            "ghi_chu": kq.get("ghi_chu"),
        })
    return out


def _xep_hang_loi(db: Session, batch_ids: list[int]) -> dict:
    """Bảng xếp hạng công đoạn / tổ — SUM(so_luong) giảm dần (mục 2 dùng TỔNG số lượng chứ không
    phải trung bình tỷ lệ; mục 3 áp cùng nguyên tắc TỔNG cho xếp hạng). Tổ: LOẠI HẲN các dòng
    `to_chiu_id IS NULL` (mục 4 — không gán bừa vào "chưa xác định").

    Xếp hạng theo NHÓM LỖI đã gỡ cùng danh mục Lý do & lỗi SX — lỗi nay chỉ có mô tả tự do, gom
    nhóm theo chuỗi tự do là thống kê nói dối."""
    if not batch_ids:
        return {"cong_doan": [], "to": []}
    rows = list(
        db.scalars(select(SanXuatKcsLoi).where(SanXuatKcsLoi.kcs_batch_id.in_(batch_ids)))
    )
    cv_ids = {l.cong_doan_ref_id for l in rows if l.cong_doan_ref_id}
    ten_cong_doan_map = (
        {c.id: c.ten_cong_doan for c in db.scalars(
            select(SanXuatCongViec).where(SanXuatCongViec.id.in_(cv_ids))
        )}
        if cv_ids else {}
    )
    to_ids = {l.to_chiu_id for l in rows if l.to_chiu_id}
    to_ten_map = (
        {d.id: d.name for d in db.scalars(select(Department).where(Department.id.in_(to_ids)))}
        if to_ids else {}
    )

    cd_acc: dict[str, float] = {}
    to_acc: dict[int, float] = {}
    for l in rows:
        sl = float(l.so_luong or 0)
        if l.cong_doan_ref_id and l.cong_doan_ref_id in ten_cong_doan_map:
            key = ten_cong_doan_map[l.cong_doan_ref_id]
            cd_acc[key] = cd_acc.get(key, 0.0) + sl
        if l.to_chiu_id:  # mục 4: bỏ hẳn khỏi xếp hạng tổ nếu chưa xác định trách nhiệm
            to_acc[l.to_chiu_id] = to_acc.get(l.to_chiu_id, 0.0) + sl

    cong_doan = sorted(
        ({"ten_cong_doan": k, "tong_so_luong": v} for k, v in cd_acc.items()),
        key=lambda r: r["tong_so_luong"], reverse=True,
    )
    to = sorted(
        (
            {"to_id": k, "ten": to_ten_map.get(k, ""), "tong_so_luong": v}
            for k, v in to_acc.items()
        ),
        key=lambda r: r["tong_so_luong"], reverse=True,
    )
    return {"cong_doan": cong_doan, "to": to}


def _tieu_chi_hong(db: Session, hang: list[tuple[SanXuatKcsBatch, SanXuatCongViec]],
                   rows: list[dict] | None = None, chon: dict | None = None, khoa_ngay=None) -> list[dict]:
    """Bảng "Theo tiêu chí" (09/10/2026): mỗi tiêu chí đã xét ở các lần kiểm BƯỚC CUỐI — số lần xét,
    số lần KCS tick nó là mục hỏng. Không có số lỗi: một thẻ có lỗi mang MỘT số cho cả công đoạn dù
    tick mấy mục, chia cho từng tiêu chí là bịa. Khoá = (công việc nguồn, `thu_tu`).

    Cột "Lỗi ghi ở công đoạn" (09/10/2026): công đoạn GIỮA tick tiêu chí không đạt kèm SỐ LỖI riêng
    của tiêu chí đó (`so_luong` trong `checklist_json`) — cộng thẳng, đơn vị của công đoạn.

    Bấm-lọc (11/10/2026): ngày thu hẹp các lần kiểm, công đoạn/tổ thu hẹp dòng; chiều tiêu chí là
    của chính bảng nên không áp. `lan` = số lần ghi lỗi gắn tiêu chí đó (dòng `rows`)."""
    chon = chon or {}
    if chon.get("ngay") and khoa_ngay:
        hang = [(k, cv) for k, cv in hang
                if (d := _ngay_vn(k.bat_dau)) is not None and khoa_ngay(d) == chon["ngay"]]
    lan: dict[tuple, int] = {}
    for r in rows or []:
        if r["tieu_chi"] and _khop(r, chon, khoa_ngay, tru="tieu_chi"):
            k = (r["tieu_chi"], r["cong_doan"], r["lsx_ma"])
            lan[k] = lan.get(k, 0) + 1
    dem: dict[tuple[int, int], list[float]] = {}
    for kcs, cv in hang:
        for kq in kcs.checklist_json or []:
            if not isinstance(kq, dict) or kq.get("thu_tu") is None:
                continue
            a = dem.setdefault((int(kq.get("cong_viec_id") or cv.id), int(kq["thu_tu"])), [0, 0, 0.0])
            if cv.la_kcs_cuoi:
                a[0] += 1
                a[1] += 0 if kq.get("dat") else 1
            else:
                a[2] += float(kq.get("so_luong") or 0)
    if not dem:
        return []
    repo = SanXuatKcsRepository(db)
    nguon = repo.cong_viec_nhieu({c for c, _t in dem})
    lenh = repo.ma_lsx_nhieu({c.lsx_id for c in nguon.values()})
    to = repo.ten_to({c.department_id for c in nguon.values()})
    out = []
    for (cid, tt), (xet, hong, loi_giua) in dem.items():
        c = nguon.get(cid)
        if c is None:
            continue
        tc = next((t for t in (c.kcs_tieu_chi_json or [])
                   if isinstance(t, dict) and t.get("thu_tu") == tt), {})
        ten = tc.get("ten") or f"Tiêu chí {tt}"
        to_ten = to.get(c.department_id) if c.department_id else None
        if chon.get("cong_doan") and c.ten_cong_doan != chon["cong_doan"]:
            continue
        if chon.get("to") and to_ten != chon["to"]:
            continue
        out.append({
            "ten": ten,
            "cong_doan": c.ten_cong_doan,
            "lsx_ma": lenh.get(c.lsx_id),
            "to_ten": to_ten,
            "lan": lan.get(((tc.get("ten") or "").strip(), c.ten_cong_doan, lenh.get(c.lsx_id)), 0),
            "lan_xet": int(xet),
            "hong": int(hong),
            "loi_o_cong_doan": loi_giua,
            "don_vi": c.don_vi_ra,
        })
    out.sort(key=lambda r: (-r["hong"], -(r["hong"] / r["lan_xet"] if r["lan_xet"] else 0),
                            -r["loi_o_cong_doan"], r["cong_doan"], r["ten"]))
    return out


_TOI_DA_COT_NGAY = 31
# Trục ngày của dạng Biểu đồ (11/10/2026): kỳ dài hơn chừng này thì gộp cột theo tháng.
_TOI_DA_NGAY_TRUC = 62
_LOI_KHAC = "Lỗi khác"
# Ba chiều bấm-lọc của tab Báo cáo lỗi + ngày (khoá cột trục) — giá trị là TÊN đang hiện.
CHIEU_CHON = ("cong_doan", "to", "tieu_chi", "ngay")


def _tach_tieu_chi(mo_ta: str | None, gay: SanXuatCongViec | None) -> tuple[str | None, str | None]:
    """Dòng lỗi tick theo tiêu chí lưu mô tả `"<tên tiêu chí>"` hoặc `"<tên>: <ghi chú>"`
    (`kcs._chuan_hoa_cac_loi`) — tách lại theo ảnh chụp tiêu chí của công đoạn GÂY, tên dài thử trước.
    Không khớp tên nào ⇒ "Lỗi khác" (cả dòng cũ ghi trước khi có tick tiêu chí). Cùng luật với
    `tachMoTa` ở `KcsGhiLoiGiua.tsx`."""
    m = (mo_ta or "").strip()
    ten = sorted({(t.get("ten") or "").strip() for t in (gay.kcs_tieu_chi_json or []) if isinstance(t, dict)}
                 if gay is not None else set(), key=len, reverse=True)
    for t in ten:
        if not t:
            continue
        if m == t:
            return t, None
        if m.startswith(f"{t}: "):
            return t, m[len(t) + 2:] or None
    return None, m or None


def _dv_hien(dv: str | None, dvt: str | None) -> str | None:
    """Chặng thành phẩm (mã `cai`) gọi bằng đơn vị tính của sản phẩm trên lệnh ("cái", "cuốn"), y như
    hộp Kiểm hàng và kho. Không đổi thì bảng báo cáo ghi "thành phẩm" còn hộp kiểm ghi "cái" cho
    cùng một số (05/11/2026). Mã chặng khác giữ nguyên để giao diện tự dịch."""
    if dv and dvt and dv.strip().lower() == "cai":
        return dvt
    return dv


def _dong_loi(db: Session, hang: list[tuple[SanXuatKcsBatch, SanXuatCongViec]], *,
              day_du: bool = True) -> list[dict]:
    """MỖI lần ghi lỗi (dòng `san_xuat_kcs_loi` có số > 0) của các lần kiểm `hang` thành một dòng
    phân tích — nguồn chung của bảng ngày, ba chiều xếp hạng, danh sách "Các lần ghi lỗi" và sheet
    Excel cùng tên (11/10/2026). Lệnh/khách là của công đoạn GÂY (lệnh phụ có thể khác lệnh bị kiểm);
    `tai_cho` = bắt ngay ở công đoạn gây, ngược lại là lọt tới công đoạn sau. `day_du=False` bỏ ảnh,
    người ghi, khách — đủ cho số kỳ trước."""
    repo = SanXuatKcsRepository(db)
    loi_map = repo.cac_loi_nhieu([k.id for k, _cv in hang])
    loi_all = [(kcs, cv, l) for kcs, cv in hang for l in loi_map.get(kcs.id, []) if float(l.so_luong or 0) > 0]
    if not loi_all:
        return []
    gay = repo.cong_viec_nhieu({l.cong_doan_ref_id for _k, _c, l in loi_all})
    lsx_ids = {c.lsx_id for c in gay.values()} | {cv.lsx_id for _k, cv, _l in loi_all}
    lenh: dict[int, tuple[str, str, str | None]] = {}
    dvt: dict[int, str | None] = {}
    if lsx_ids:
        for lid, ma, ten, khach, dv_tinh in db.execute(
            select(Lsx.id, Lsx.ma, Lsx.ten, Customer.name, Lsx.don_vi_tinh)
            .join(Order, Lsx.order_id == Order.id, isouter=True)
            .join(Customer, Order.customer_id == Customer.id, isouter=True)
            .where(Lsx.id.in_({i for i in lsx_ids if i}))
        ).all():
            lenh[lid] = (ma, ten, khach)
            dvt[lid] = dv_tinh
    ten_to = repo.ten_to({l.to_chiu_id for _k, _c, l in loi_all})
    anh = repo.anh_cua_loi_nhieu([l.id for _k, _c, l in loi_all]) if day_du else {}
    nguoi = repo.ten_nguoi({l.created_by for _k, _c, l in loi_all}) if day_du else {}
    out: list[dict] = []
    for kcs, cv, l in loi_all:
        g = gay.get(l.cong_doan_ref_id) or cv
        ma, ten_lenh, khach = lenh.get(g.lsx_id, (None, None, None))
        tc, ghi = _tach_tieu_chi(l.mo_ta, g)
        out.append({
            "loi_id": l.id,
            "kcs_batch_id": kcs.id,
            "ngay": _ngay_vn(kcs.bat_dau),
            "thoi_diem": _ve_gio_vn(kcs.bat_dau),
            "lsx_ma": ma,
            "san_pham": ten_lenh,
            "khach": khach,
            "cong_doan": g.ten_cong_doan,
            "to": ten_to.get(l.to_chiu_id) if l.to_chiu_id else None,
            "tieu_chi": tc,
            "ghi_chu": ghi,
            "noi_bat": cv.ten_cong_doan,
            "tai_cho": g.id == cv.id,
            "so_luong": float(l.so_luong or 0),
            # Đơn vị là của nơi BẮT (lỗi đếm theo đơn vị bước đang kiểm) ⇒ ĐVT lệnh của bước đó.
            "don_vi": _dv_hien(l.don_vi or kcs.don_vi or None, dvt.get(cv.lsx_id)),
            "anh": [{"file_name": a.file_name, "file_url": a.file_url, "file_type": a.file_type}
                    for a in anh.get(l.id, [])],
            "nguoi_ghi": nguoi.get(l.created_by) if l.created_by else None,
        })
    return out


def _gia_tri(r: dict, chieu: str) -> str | None:
    """Giá trị của dòng lỗi theo một chiều — "Lỗi khác" cho dòng không gắn tiêu chí; tổ chưa rõ thì
    None (mục 4: không vào chiều tổ)."""
    if chieu == "tieu_chi":
        return r["tieu_chi"] or _LOI_KHAC
    return r[chieu]


def _khop(r: dict, chon: dict, khoa_ngay, tru: str | None = None) -> bool:
    for k, v in chon.items():
        if k == tru or v is None:
            continue
        if k == "ngay":
            if r["ngay"] is None or khoa_ngay(r["ngay"]) != v:
                return False
        elif _gia_tri(r, k) != v:
            return False
    return True


def _hom_nay() -> date:
    return thuc_te_hien_thi(datetime.now(timezone.utc)).date()


def _truc(hang, rows: list[dict], tu: date | None, den: date | None) -> tuple[list[dict], object]:
    """Trục thời gian LIỀN của dạng Biểu đồ: từ đầu kỳ tới cuối kỳ (không quá hôm nay); kỳ "Mọi thời
    gian" thì từ ngày có dữ liệu đầu tới cuối. Dài quá `_TOI_DA_NGAY_TRUC` ngày thì gộp theo tháng.
    Mỗi mốc kèm nhận/đạt của lần kiểm bước CUỐI (đường tỷ lệ đạt). Trả (trục, hàm khoá ngày)."""
    ngay_co = [d for d in (_ngay_vn(k.bat_dau) for k, _cv in hang) if d] + [r["ngay"] for r in rows if r["ngay"]]
    dau = tu or (min(ngay_co) if ngay_co else None)
    cuoi = min(den, _hom_nay()) if den else (max(ngay_co) if ngay_co else None)
    if dau is None or cuoi is None or cuoi < dau:
        return [], (lambda d: d.isoformat())
    theo_thang = (cuoi - dau).days + 1 > _TOI_DA_NGAY_TRUC
    khoa = (lambda d: d.strftime("%Y-%m")) if theo_thang else (lambda d: d.isoformat())
    nhan = (lambda d: d.strftime("%m/%Y")) if theo_thang else (lambda d: d.strftime("%d/%m"))
    truc: dict[str, dict] = {}
    d = dau
    while d <= cuoi:
        truc.setdefault(khoa(d), {"khoa": khoa(d), "nhan": nhan(d), "nhan_cuoi": 0.0, "dat_cuoi": 0.0})
        d += timedelta(days=1)
    for kcs, cv in hang:
        nd = _ngay_vn(kcs.bat_dau)
        if cv.la_kcs_cuoi and nd and khoa(nd) in truc:
            truc[khoa(nd)]["nhan_cuoi"] += float(kcs.so_luong_nhan)
            truc[khoa(nd)]["dat_cuoi"] += float(kcs.so_luong_dat)
    return list(truc.values()), khoa


def _phan_tich(rows: list[dict], chon: dict, khoa_ngay) -> dict:
    """Ba chiều của dạng Biểu đồ. Mỗi mục: số lần ghi lỗi, số theo đơn vị, số lệnh, bắt tại chỗ /
    lọt — tính trên dòng đã lọc mọi điều kiện TRỪ chính chiều đó (bấm một thanh thì các thanh khác
    vẫn còn để so); `ngay` = số lần theo mốc trục, tính trên dòng đã lọc mọi điều kiện TRỪ ngày (cột
    ngày bấm chọn thì các ngày khác vẫn hiện). Thanh đếm theo SỐ LẦN vì đơn vị khác nhau không cộng."""
    out: dict[str, list[dict]] = {}
    for chieu in ("cong_doan", "to", "tieu_chi"):
        acc: dict[str, dict] = {}

        def muc(ten: str) -> dict:
            return acc.setdefault(ten, {"ten": ten, "lan": 0, "so_theo_dv": {}, "lenh": set(),
                                        "tai_cho": 0, "lot": 0, "ngay": {}})
        for r in rows:
            ten = _gia_tri(r, chieu)
            if ten is None:
                continue
            if _khop(r, chon, khoa_ngay, tru=chieu):
                a = muc(ten)
                a["lan"] += 1
                dv = r["don_vi"] or ""
                a["so_theo_dv"][dv] = a["so_theo_dv"].get(dv, 0.0) + r["so_luong"]
                if r["lsx_ma"]:
                    a["lenh"].add(r["lsx_ma"])
                a["tai_cho" if r["tai_cho"] else "lot"] += 1
            if r["ngay"] and _khop(r, chon, khoa_ngay, tru="ngay"):
                a = muc(ten)
                k = khoa_ngay(r["ngay"])
                a["ngay"][k] = a["ngay"].get(k, 0) + 1
        out[chieu] = sorted(
            ({**a, "so_lenh": len(a.pop("lenh"))} for a in acc.values()),
            key=lambda a: (-a["lan"], a["ten"]),
        )
    return out


def _bang_nhiet(rows: list[dict], chon: dict, khoa_ngay) -> dict:
    """Lỗi theo NGÀY (09/10/2026): hai bảng cùng trục cột — dòng là công đoạn GÂY lỗi (theo lệnh) và
    là tổ chịu; mỗi ô là số lỗi trong ngày, đơn vị của nơi bắt nên đơn vị là một phần của khoá dòng.
    Kỳ dài hơn 31 ngày có lỗi thì cột gộp theo tháng. Lỗi chưa rõ tổ không vào bảng tổ (mục 4).
    Điều kiện bấm-lọc (11/10/2026) áp như `_phan_tich`: trừ chính chiều của bảng."""
    rows_cd = [r for r in rows if r["ngay"] and _khop(r, chon, khoa_ngay, tru="cong_doan")]
    rows_to = [r for r in rows if r["ngay"] and _khop(r, chon, khoa_ngay, tru="to")]
    ngay = sorted({r["ngay"] for r in rows_cd + rows_to})
    theo_thang = len(ngay) > _TOI_DA_COT_NGAY
    khoa_cot = (lambda d: d.strftime("%Y-%m")) if theo_thang else (lambda d: d.isoformat())
    nhan_cot = (lambda d: d.strftime("%m/%Y")) if theo_thang else (lambda d: d.strftime("%d/%m"))
    cot: dict[str, str] = {}
    for d in ngay:
        cot.setdefault(khoa_cot(d), nhan_cot(d))

    def gom(ds: list[dict], khoa, ten, lenh) -> list[dict]:
        acc: dict[tuple, dict] = {}
        for r in ds:
            dv = r["don_vi"] or ""
            x = acc.setdefault(khoa(r), {"ten": ten(r) or "", "lsx_ma": lenh(r), "don_vi": dv or None,
                                         "o": {}, "tong": 0.0, "lan": 0})
            k = khoa_cot(r["ngay"])
            x["o"][k] = x["o"].get(k, 0.0) + r["so_luong"]
            x["tong"] += r["so_luong"]
            x["lan"] += 1
        return sorted(acc.values(), key=lambda x: (-x["tong"], x["ten"]))

    return {
        "cot": [{"khoa": k, "nhan": v} for k, v in cot.items()],
        "cong_doan": gom(rows_cd, lambda r: (r["lsx_ma"], r["cong_doan"], r["don_vi"] or ""),
                         lambda r: r["cong_doan"], lambda r: r["lsx_ma"]),
        "to": gom([r for r in rows_to if r["to"]], lambda r: (r["to"], r["don_vi"] or ""),
                  lambda r: r["to"], lambda r: None),
    }


def _ky_truoc(db: Session, user: User, authz: AuthorizationService, filters: dict,
              chon: dict | None = None) -> dict | None:
    """Kỳ liền trước CÙNG độ dài (đầu kỳ tới hôm nay nếu kỳ chưa hết) — chỉ bốn con số so sánh của
    hàng số. Kỳ "Mọi thời gian" thì không có kỳ trước. Lần ghi lỗi / lệnh có lỗi áp cùng bấm-lọc
    (trừ mốc ngày — kỳ trước không có ngày đó) để so cùng một phạm vi."""
    tu, den = filters.get("tu"), filters.get("den")
    if not tu or not den:
        return None
    cuoi = min(den, _hom_nay())
    so_ngay = (cuoi - tu).days + 1
    if so_ngay <= 0:
        return None
    tu_t, den_t = tu - timedelta(days=so_ngay), tu - timedelta(days=1)
    hang = _hang_kcs_theo_scope(db, user, authz, **{**filters, "tu": tu_t, "den": den_t})
    chon_kt = {k: v for k, v in (chon or {}).items() if k != "ngay" and v}
    rows = [r for r in _dong_loi(db, hang, day_du=False) if _khop(r, chon_kt, None)]
    nhan = sum(float(k.so_luong_nhan) for k, cv in hang if cv.la_kcs_cuoi)
    dat = sum(float(k.so_luong_dat) for k, cv in hang if cv.la_kcs_cuoi)
    return {
        "tu": tu_t, "den": den_t, "tong_luot": len(hang),
        "ty_le_dat": (dat / nhan) if nhan else None,
        "so_lan_ghi_loi": len(rows),
        "so_lenh_loi": len({r["lsx_ma"] for r in rows if r["lsx_ma"]}),
    }


def _lich_su_rows(
    db: Session, hang: list[tuple[SanXuatKcsBatch, SanXuatCongViec]]
) -> list[dict]:
    """Bảng "Kết quả đã ghi" — MỘT dòng/batch, đã áp đúng filter+scope của `_hang_kcs_theo_scope`.

    Dòng dựng thẳng từ DB (không ghép từ state phiên của FE) nên bền qua F5 và mang sẵn người ghi
    — việc bị kiểm thuộc tổ KHÁC tổ của người KCS nên không thể lấy từ bàn tổ của họ."""
    if not hang:
        return []
    from ...repositories.san_xuat_repo import SanXuatRepository

    repo_sx = SanXuatRepository(db)
    lsx_map = repo_sx.lsx_nhan({cv.lsx_id for _k, cv in hang if cv.lsx_id})
    dvt_map = repo_sx.lsx_dvt({cv.lsx_id for _k, cv in hang if cv.lsx_id})
    bg_map = repo_sx.bai_ghep_nhan({cv.bai_ghep_id for _k, cv in hang if cv.bai_ghep_id})
    nguoi_ids = {k.created_by for k, _cv in hang if k.created_by}
    nguoi_ten = (
        {u.id: u.name for u in db.scalars(select(User).where(User.id.in_(nguoi_ids)))}
        if nguoi_ids else {}
    )
    from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
    from .kho import dong_nhap_kho_cua_cong_viec

    cuoi_ids = {cv.id for _k, cv in hang if cv.la_kcs_cuoi}
    dong_map = dong_nhap_kho_cua_cong_viec(db, cuoi_ids)
    dat_map = {i: sum(float(k.so_luong_dat or 0) for k in ds)
               for i, ds in SanXuatKcsRepository(db).cac_kcs_batch_nhieu(cuoi_ids).items()}
    tot_map = SanXuatSanLuongRepository(db).tong_tot_nhieu(cuoi_ids)

    out: list[dict] = []
    for kcs, cv in hang:
        if cv.bai_ghep_id and cv.bai_ghep_id in bg_map:
            ma, ten = bg_map[cv.bai_ghep_id]
        elif cv.lsx_id and cv.lsx_id in lsx_map:
            ma, ten = lsx_map[cv.lsx_id]
        else:
            ma, ten = "", ""
        out.append({
            "kcs_batch_id": kcs.id,
            "cong_viec_id": kcs.cong_viec_id,
            "thoi_diem": _ve_gio_vn(kcs.ket_thuc) or _ve_gio_vn(kcs.bat_dau),
            "so_luong_dat": float(kcs.so_luong_dat or 0),
            "so_luong_khong_dat": float(kcs.so_luong_khong_dat or 0),
            "don_vi": _dv_hien(kcs.don_vi, dvt_map.get(cv.lsx_id)) or "",
            "nguon_ma": ma,
            "nguon_ten": ten,
            "ten_cong_doan": cv.ten_cong_doan,
            "nguoi_ghi": nguoi_ten.get(kcs.created_by) if kcs.created_by else None,
            "trang_thai_gui_kho": _trang_thai_gui_kho(
                cv, dong_map.get(cv.id, []), dat=dat_map.get(cv.id, 0.0), tot=tot_map.get(cv.id, 0.0)),
        })
    out.sort(key=lambda r: (r["thoi_diem"] is not None, r["thoi_diem"]), reverse=True)
    return out


def cong_doan_loc(db: Session) -> list[dict]:
    """Ô lọc "Công đoạn" của dashboard KCS. Tổ KCS kiểm việc của tổ khác nên cần trọn danh mục,
    nhưng người chỉ giữ quyền tổ thì không đọc được Danh mục công đoạn (`dm_cong_doan`) — trước
    đây màn gọi thẳng `/api/cong-doan` và ăn 403 im lặng, ô lọc rỗng. Chỉ trả mã/tên/giai đoạn,
    không lộ công thức giá hay định mức của danh mục."""
    return [
        {"id": cd.id, "ma": cd.ma, "ten": cd.ten, "nhom": cd.nhom}
        for cd in SanXuatKcsRepository(db).cong_doan_dang_dung()
    ]


def _gia_tri_loc(
    db: Session, hang: list[tuple[SanXuatKcsBatch, SanXuatCongViec]], *,
    khach_id: int | None, cong_doan: str | None,
) -> dict:
    """Giá trị + số lượt kiểm cho menu Lọc của tab Báo cáo lỗi. `hang` đã lọc kỳ + ô tìm nhưng CHƯA
    lọc khách/công đoạn; số của mỗi điều kiện tính theo điều kiện kia đang chọn (đổi khách thì số
    trên các công đoạn đổi theo, và ngược lại)."""
    lsx_ids = {cv.lsx_id for _k, cv in hang if cv.lsx_id}
    khach_cua: dict[int, tuple[int, str]] = {}
    if lsx_ids:
        for lid, kid, ten in db.execute(
            select(Lsx.id, Customer.id, Customer.name)
            .join(Order, Lsx.order_id == Order.id)
            .join(Customer, Order.customer_id == Customer.id)
            .where(Lsx.id.in_(lsx_ids))
        ).all():
            khach_cua[lid] = (int(kid), ten)
    dem_khach: dict[tuple[int, str], int] = {}
    dem_cd: dict[str, int] = {}
    for _kcs, cv in hang:
        k = khach_cua.get(cv.lsx_id) if cv.lsx_id else None
        if k and (not cong_doan or cv.ten_cong_doan == cong_doan):
            dem_khach[k] = dem_khach.get(k, 0) + 1
        if cv.ten_cong_doan and (not khach_id or (k and k[0] == khach_id)):
            dem_cd[cv.ten_cong_doan] = dem_cd.get(cv.ten_cong_doan, 0) + 1
    # Khách đang chọn mà kỳ mới không còn lượt nào vẫn phải có tên để khối "Khách hàng | … | ×" hiện chữ.
    if khach_id and not any(k[0] == khach_id for k in dem_khach):
        kh = db.get(Customer, khach_id)
        if kh is not None:
            dem_khach[(kh.id, kh.name)] = 0
    return {
        "loc_khach": [{"id": i, "ten": t, "so": n} for (i, t), n in sorted(dem_khach.items(), key=lambda x: x[0][1])],
        "loc_cong_doan": [{"ten": t, "so": n} for t, n in sorted(dem_cd.items())],
    }


def bao_cao_kcs(
    db: Session, user: User, authz: AuthorizationService, *, chon: dict | None = None,
    trang: int = 1, co_trang: int = 25, **filters,
) -> dict:
    """Tổng hợp cho dashboard (§6.2 KPI + biểu đồ). `**filters` = tham số của `_hang_kcs_theo_scope`
    (tu/den/lsx_id/tu_khoa/cong_doan_id/khach_id/cong_doan) — router forward nguyên `Query()`
    params vào đây.

    11/10/2026 (dạng Bảng | Biểu đồ): `chon` = điều kiện bấm-lọc trên tab (công đoạn gây, tổ chịu,
    tiêu chí, mốc trục ngày — `CHIEU_CHON`) chỉ thu hẹp phần LỖI (bảng ngày, bảng tiêu chí, ba chiều
    phân tích, danh sách lần ghi lỗi, hai số Lần ghi lỗi / Lệnh có lỗi kể cả kỳ trước); lượt kiểm và
    tỷ lệ đạt theo thanh lọc. `trang`/`co_trang` cắt
    danh sách "Các lần ghi lỗi" ở máy chủ."""
    chon = {k: v for k, v in (chon or {}).items() if k in CHIEU_CHON and v}
    hang = _hang_kcs_theo_scope(db, user, authz, **filters)
    khach_id, cong_doan = filters.get("khach_id"), filters.get("cong_doan")
    hang_rong = (
        _hang_kcs_theo_scope(db, user, authz, **{**filters, "khach_id": None, "cong_doan": None})
        if khach_id or cong_doan else hang
    )
    batch_ids = [kcs.id for kcs, _cv in hang]

    # Nhận/đạt/tỷ lệ chỉ tính công đoạn CUỐI — công đoạn giữa KCS chỉ ghi lỗi (đạt = 0), gộp vào thì
    # tỷ lệ đạt tụt oan (19/09/2026). Lỗi vẫn cộng mọi công đoạn.
    tong_nhan = sum(float(kcs.so_luong_nhan) for kcs, cv in hang if cv.la_kcs_cuoi)
    tong_dat = sum(float(kcs.so_luong_dat) for kcs, cv in hang if cv.la_kcs_cuoi)
    tong_loi = sum(float(kcs.so_luong_khong_dat) for kcs, _cv in hang)
    ty_le_dat = (tong_dat / tong_nhan) if tong_nhan else None  # mục 2: tổng/tổng, KHÔNG trung bình

    theo_ngay: dict[date, dict[str, float]] = {}
    for kcs, cv in hang:
        d = _ngay_vn(kcs.bat_dau)
        if d is None:
            continue
        acc = theo_ngay.setdefault(d, {"tong_nhan": 0.0, "tong_dat": 0.0, "tong_loi": 0.0})
        if cv.la_kcs_cuoi:
            acc["tong_nhan"] += float(kcs.so_luong_nhan)
            acc["tong_dat"] += float(kcs.so_luong_dat)
        acc["tong_loi"] += float(kcs.so_luong_khong_dat)
    theo_ngay_list = [
        {"ngay": d, **acc} for d, acc in sorted(theo_ngay.items())
    ]

    xep_hang = _xep_hang_loi(db, batch_ids)
    rows = _dong_loi(db, hang)
    truc, khoa_ngay = _truc(hang, rows, filters.get("tu"), filters.get("den"))
    nhiet = _bang_nhiet(rows, chon, khoa_ngay)
    loc_rows = sorted((r for r in rows if _khop(r, chon, khoa_ngay)),
                      key=lambda r: (r["thoi_diem"] is not None, r["thoi_diem"], r["loi_id"]), reverse=True)
    co_trang = max(1, min(co_trang, 200))
    trang = max(1, trang)
    return {
        "tong_luot": len(hang),
        "tong_nhan": tong_nhan,
        "tong_dat": tong_dat,
        "tong_loi": tong_loi,
        "ty_le_dat": ty_le_dat,
        "theo_ngay": theo_ngay_list,
        "cong_doan": xep_hang["cong_doan"],
        "to": xep_hang["to"],
        "lich_su": _lich_su_rows(db, hang),
        # Hai số lỗi bám cả bấm-lọc (11/10/2026); lượt kiểm + tỷ lệ đạt chỉ theo thanh lọc.
        "so_lan_ghi_loi": len(loc_rows),
        "so_lenh_loi": len({r["lsx_ma"] for r in loc_rows if r["lsx_ma"]}),
        "ky_truoc": _ky_truoc(db, user, authz, filters, chon),
        "truc": truc,
        "phan_tich": _phan_tich(rows, chon, khoa_ngay),
        "lan_loi": [{k: v for k, v in r.items() if k != "ngay"}
                    for r in loc_rows[(trang - 1) * co_trang: trang * co_trang]],
        "lan_loi_tong": len(loc_rows),
        "tieu_chi": _tieu_chi_hong(db, hang, rows, chon, khoa_ngay),
        "nhiet_cot": nhiet["cot"],
        "nhiet_cong_doan": nhiet["cong_doan"],
        "nhiet_to": nhiet["to"],
        **_gia_tri_loc(db, hang_rong, khach_id=khach_id, cong_doan=cong_doan),
    }


def _ten_file_xlsx(tu: date | None, den: date | None) -> str:
    t = tu.isoformat() if tu else "toanbo"
    d = den.isoformat() if den else "toanbo"
    return f"bao-cao-kcs-{t}_{d}.xlsx"


_TEN_CACH_XEM = {"cong_doan": "Theo công đoạn", "to": "Theo tổ", "tieu_chi": "Theo tiêu chí"}


def xuat_excel_kcs(
    db: Session, user: User, authz: AuthorizationService, *, chon: dict | None = None,
    xem: str = "cong_doan", **filters,
) -> tuple[bytes, str]:
    """Workbook (§5.7) — dùng CHUNG `_hang_kcs_theo_scope` với `bao_cao_kcs` (§9 mục 10). Trả `(bytes, filename)`.

    11/10/2026: xuất ĐÚNG những gì tab đang chọn — thanh lọc (`**filters`), bấm-lọc (`chon`) và cách
    xem (`xem`). Sheet 1 "Tổng hợp" ghi điều kiện lọc + hàng số; sheet 2 là bảng của cách xem (cùng
    số với màn); sheet 3 các lần ghi lỗi đã áp bấm-lọc, mới nhất trước. Hai sheet dữ liệu gốc theo
    lượt kiểm ("Kết quả KCS", "Chi tiết checklist") chỉ theo thanh lọc — lượt kiểm không có chiều
    công đoạn gây / tổ chịu / tiêu chí để bấm-lọc."""
    from io import BytesIO

    from openpyxl import Workbook  # lazy import: thiếu dep chỉ hỏng route này, không sập app
    from openpyxl.styles import Font

    hang = _hang_kcs_theo_scope(db, user, authz, **filters)
    batch_ids = [kcs.id for kcs, _cv in hang]

    lsx_ids = {cv.lsx_id for _kcs, cv in hang if cv.lsx_id}
    lsx_ma = (
        {l.id: l.ma for l in db.scalars(select(Lsx).where(Lsx.id.in_(lsx_ids)))}
        if lsx_ids else {}
    )
    to_ids = {cv.department_id for _kcs, cv in hang if cv.department_id}
    to_ten = (
        {d.id: d.name for d in db.scalars(select(Department).where(Department.id.in_(to_ids)))}
        if to_ids else {}
    )
    nguoi_ids = {kcs.created_by for kcs, _cv in hang if kcs.created_by}
    nguoi_ten = (
        {u.id: u.name for u in db.scalars(select(User).where(User.id.in_(nguoi_ids)))}
        if nguoi_ids else {}
    )

    repo = SanXuatKcsRepository(db)
    loi_by_batch = repo.cac_loi_nhieu(batch_ids)
    loi_ids_all = [l.id for ls in loi_by_batch.values() for l in ls]
    anh_by_loi = repo.anh_cua_loi_nhieu(loi_ids_all)
    # Công đoạn CHỊU từng lỗi — KCS quy được lỗi bắt ở bước sau về bước trước (19/09/2026).
    cd_chiu = repo.cong_viec_nhieu(
        {l.cong_doan_ref_id for ls in loi_by_batch.values() for l in ls if l.cong_doan_ref_id}
    )
    # Công việc NGUỒN của từng kết quả tiêu chí (bước cuối xét tiêu chí gộp cả chuỗi) — một lượt.
    cv_theo_id = {cv.id: cv for _kcs, cv in hang}
    cv_theo_id.update(repo.cong_viec_nhieu({
        kq.get("cong_viec_id") for kcs, _cv in hang for kq in (kcs.checklist_json or [])
        if isinstance(kq, dict) and kq.get("cong_viec_id") not in cv_theo_id
    }))

    chon = {k: v for k, v in (chon or {}).items() if k in CHIEU_CHON and v}
    xem = xem if xem in _TEN_CACH_XEM else "cong_doan"
    rows = _dong_loi(db, hang)
    _truc_, khoa_ngay = _truc(hang, rows, filters.get("tu"), filters.get("den"))
    loc_rows = sorted((r for r in rows if _khop(r, chon, khoa_ngay)),
                      key=lambda r: (r["thoi_diem"] is not None, r["thoi_diem"], r["loi_id"]), reverse=True)
    kt = _ky_truoc(db, user, authz, filters, chon)
    tong_nhan = sum(float(k.so_luong_nhan) for k, cv in hang if cv.la_kcs_cuoi)
    tong_dat = sum(float(k.so_luong_dat) for k, cv in hang if cv.la_kcs_cuoi)

    def dd(d: date | None) -> str:
        return d.strftime("%d/%m/%Y") if d else ""

    wb = Workbook()
    ws0 = wb.active
    ws0.title = "Tổng hợp"
    tu, den = filters.get("tu"), filters.get("den")
    kh = db.get(Customer, filters["khach_id"]) if filters.get("khach_id") else None
    dieu_kien = [
        ("Kỳ (theo ngày kiểm)", f"{dd(tu)} – {dd(den)}" if tu or den else "Mọi thời gian"),
        ("Tìm", filters.get("tu_khoa") or ""),
        ("Khách hàng", kh.name if kh else ""),
        ("Công đoạn", filters.get("cong_doan") or ""),
        ("Công đoạn gây lỗi", chon.get("cong_doan", "")),
        ("Tổ chịu", chon.get("to", "")),
        ("Tiêu chí", chon.get("tieu_chi", "")),
        ("Ngày", next((m["nhan"] for m in _truc_ if m["khoa"] == chon.get("ngay")), chon.get("ngay", ""))),
        ("Cách xem", _TEN_CACH_XEM[xem]),
    ]
    ws0.append(["Điều kiện lọc", ""])
    ws0["A1"].font = Font(bold=True)
    for ten, gt in dieu_kien:
        ws0.append([ten, gt or "Tất cả"])
    ws0.append([])
    ws0.append(["Số liệu", "Kỳ này", "Kỳ trước"])
    for cell in ws0[ws0.max_row]:
        cell.font = Font(bold=True)
    so_lenh = len({r["lsx_ma"] for r in loc_rows if r["lsx_ma"]})
    ws0.append(["Lượt kiểm", len(hang), kt["tong_luot"] if kt else None])
    ws0.append(["Tỷ lệ đạt ở bước cuối", (tong_dat / tong_nhan) if tong_nhan else None,
                kt["ty_le_dat"] if kt else None])
    for c in (2, 3):
        ws0.cell(row=ws0.max_row, column=c).number_format = "0.0%"
    ws0.append(["Lần ghi lỗi", len(loc_rows), kt["so_lan_ghi_loi"] if kt else None])
    ws0.append(["Lệnh có lỗi", so_lenh, kt["so_lenh_loi"] if kt else None])
    if kt:
        ws0.append(["Kỳ trước", f"{dd(kt['tu'])} – {dd(kt['den'])}"])
    ws0.column_dimensions["A"].width = 26
    ws0.column_dimensions["B"].width = 36
    ws0.column_dimensions["C"].width = 14

    # Sheet 2: bảng của cách xem đang chọn — cùng hàm với màn.
    wsx = wb.create_sheet(_TEN_CACH_XEM[xem])
    if xem == "tieu_chi":
        wsx.append(["Tiêu chí", "Công đoạn", "Lệnh", "Tổ chịu", "Lần ghi lỗi", "Lỗi ghi ở công đoạn",
                    "Đơn vị", "Lần xét", "Hỏng", "Tỷ lệ hỏng"])
        for t in _tieu_chi_hong(db, hang, rows, chon, khoa_ngay):
            wsx.append([t["ten"], t["cong_doan"], t["lsx_ma"] or "", t["to_ten"] or "", t["lan"],
                        t.get("loi_o_cong_doan") or 0, t.get("don_vi") or "", t["lan_xet"], t["hong"],
                        (t["hong"] / t["lan_xet"]) if t["lan_xet"] else 0])
            wsx.cell(row=wsx.max_row, column=10).number_format = "0%"
    else:
        nhiet = _bang_nhiet(rows, chon, khoa_ngay)
        cot = nhiet["cot"]
        dau = ["Công đoạn gây lỗi", "Lệnh"] if xem == "cong_doan" else ["Tổ chịu"]
        wsx.append([*dau, "Đơn vị", "Lần", *[c["nhan"] for c in cot], "Cộng"])
        for d in nhiet[xem]:
            wsx.append([d["ten"], *([d["lsx_ma"] or ""] if xem == "cong_doan" else []), d["don_vi"] or "",
                        d["lan"], *[d["o"].get(c["khoa"]) for c in cot], d["tong"]])
    for cell in wsx[1]:
        cell.font = Font(bold=True)
    wsx.freeze_panes = "B2"

    ws1 = wb.create_sheet("Kết quả KCS")
    headers1 = [
        "Mã kết quả", "Thời điểm", "Mã LSX", "Công đoạn", "Tổ", "Số kiểm",
        "Số đạt", "Số lỗi", "Đơn vị", "Kết luận", "Ghi chú", "Người kiểm",
        "Mô tả lỗi", "URL ảnh", "Công đoạn chịu lỗi",
    ]
    ws1.append(headers1)
    for cell in ws1[1]:
        cell.font = Font(bold=True)
    _COL_SO_LUONG_1 = {6, 7, 8}  # Số kiểm / Số đạt / Số lỗi
    for kcs, cv in hang:
        loi_list = loi_by_batch.get(kcs.id, [])
        loi_mo_ta_set = sorted({
            (l.mo_ta or "").strip() or _CHUA_PHAN_LOAI for l in loi_list
        })
        anh_urls = [a.file_url for l in loi_list for a in anh_by_loi.get(l.id, [])]
        ws1.append([
            kcs.id, _ve_gio_vn(kcs.bat_dau),
            lsx_ma.get(cv.lsx_id, "") if cv.lsx_id else "",
            cv.ten_cong_doan, to_ten.get(cv.department_id, "") if cv.department_id else "",
            float(kcs.so_luong_nhan), float(kcs.so_luong_dat),
            float(kcs.so_luong_khong_dat), kcs.don_vi,
            _KET_LUAN_LABEL.get(kcs.ket_luan, kcs.ket_luan), kcs.ghi_chu or "",
            nguoi_ten.get(kcs.created_by, ""),
            "; ".join(loi_mo_ta_set) if loi_list else "",
            "; ".join(anh_urls),
            "; ".join(
                f"{cd_chiu[l.cong_doan_ref_id].ten_cong_doan} ({float(l.so_luong or 0):g})"
                for l in loi_list if l.cong_doan_ref_id in cd_chiu
            ),
        ])
        r = ws1.max_row
        for c in _COL_SO_LUONG_1:
            ws1.cell(row=r, column=c).number_format = "#,##0.###"
        ws1.cell(row=r, column=2).number_format = "dd/mm/yyyy hh:mm"
    ws1.freeze_panes = "A2"
    ws1.auto_filter.ref = ws1.dimensions

    ws2 = wb.create_sheet("Chi tiết checklist")
    ws2.append(["Mã kết quả", "Thời điểm", "Công đoạn", "Mã tiêu chí", "Tên tiêu chí", "Đạt", "Ghi chú"])
    for cell in ws2[1]:
        cell.font = Font(bold=True)
    for kcs, cv in hang:
        for cr in _checklist_rows_cho_batch(kcs, cv, cv_theo_id):
            ws2.append([
                cr["kcs_batch_id"], cr["thoi_diem"], cr["cong_doan"] or "",
                cr["ma"] or "", cr["ten"] or "", "Có" if cr["dat"] else "Không", cr["ghi_chu"] or "",
            ])
            ws2.cell(row=ws2.max_row, column=2).number_format = "dd/mm/yyyy hh:mm"
    ws2.freeze_panes = "A2"
    ws2.auto_filter.ref = ws2.dimensions

    # Sheet 3 (11/10/2026): từng lần ghi lỗi — cùng nguồn + cùng bấm-lọc với danh sách trên tab.
    ws3 = wb.create_sheet("Các lần ghi lỗi", 2)
    ws3.append(["Lúc", "Lệnh", "Sản phẩm", "Khách hàng", "Công đoạn gây lỗi", "Tiêu chí", "Ghi chú",
                "Bắt ở", "Số lỗi", "Đơn vị", "Tổ chịu", "Người ghi", "URL ảnh"])
    for cell in ws3[1]:
        cell.font = Font(bold=True)
    for r in loc_rows:
        ws3.append([
            r["thoi_diem"], r["lsx_ma"] or "", r["san_pham"] or "", r["khach"] or "", r["cong_doan"],
            r["tieu_chi"] or _LOI_KHAC, r["ghi_chu"] or "",
            "Tại công đoạn" if r["tai_cho"] else r["noi_bat"], r["so_luong"], r["don_vi"] or "",
            r["to"] or "", r["nguoi_ghi"] or "", "; ".join(a["file_url"] for a in r["anh"]),
        ])
        ws3.cell(row=ws3.max_row, column=1).number_format = "dd/mm/yyyy hh:mm"
        ws3.cell(row=ws3.max_row, column=9).number_format = "#,##0.###"
    ws3.freeze_panes = "A2"
    ws3.auto_filter.ref = ws3.dimensions

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue(), _ten_file_xlsx(filters.get("tu"), filters.get("den"))
