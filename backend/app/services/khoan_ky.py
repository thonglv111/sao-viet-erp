"""Tiền KHOÁN của một kỳ lương — đọc từ LẦN GHI sản lượng (21/10/2026).

Spec: `docs/superpowers/specs/2026-10-20-hai-luong-khoi-san-xuat-design.md`. Kết quả cộng vào vế
khoán của phép so hai lương (`PayrollService._compute`).

Mỗi lần ghi có cấu hình Khoán của công đoạn:

    tiền lần ghi = công thức khoán (biến của lần ghi: `sl_ghi`, `gia_co_dinh`, `so_lan_chay`,
                   `tien_gio`, `tu_tro`, tuỳ chọn khi ghi của công đoạn, …)
                   — không khai công thức ⇒ 0 (chủ 22/10: tiền phải tường minh trên công
                     thức, không ngầm `gia_co_dinh + sl_ghi × don_gia`; mg 0434 chép công
                     thức đó vào các công đoạn đang để trống)
                   — kết quả công thức LÀ tiền, máy không tự nhân đơn giá (chủ 22/10)
                 + Σ việc phát sinh (số lượng × đơn giá của tổ)

Giá là ẢNH CHỤP giá của TỔ lúc ghi (`viec_khoan.chuan_hoa_khi_ghi`); thiếu giá / công thức lỗi thì
lần ghi vào `thieu_gia` kèm lý do — không đoán giá.

`sl_ghi` = số TỐT của lần ghi — cột "Số lượng" thợ gõ ở bàn tổ (Đợt 2, chủ 21/10).

Giả định (plan 21/10/2026, chờ chủ duyệt):
  1. Tiền một lần ghi chia cho những người được tick ở lần ghi đó theo tỷ lệ LƯƠNG CA MÁY giữa
     chính họ (Đợt 2, chủ 21/10 "áp cho mọi tổ") — mức do `PayrollService.muc_khoan` dựng, xem
     `MucKhoan`. Người mức 0 ⇒ lần ghi vào `thieu_gia`, không chia đều. Người ăn công nhật
     (`an_cong_nhat_hieu_luc`, thử việc mặc định là công nhật) vẫn có phần; `_compute` ép phần
     đó về 0, không dồn cho ai.
  2. Ngày của lần ghi = ngày giờ xưởng của giờ bắt đầu (`ngay_cua_me`).
  3. Chỉ tiêu ngày so với tiền GỐC của tổ trong ngày (trước nhân đôi CN trùng lễ); 50% phần vượt
     (= tăng ca khoán) chia theo tỷ lệ phần mỗi người hôm đó. Tổ chưa khai chỉ tiêu thì lấy mốc
     của tổ cha gần nhất.
  4. Tổ trưởng: mốc hiệu lực tại NGÀY CUỐI kỳ; quỹ = tiền sản lượng (đã áp luật ngày, chưa gồm
     tăng ca khoán) của tổ + mọi tổ con. Ăn chia: mọi phần × (1 − tỷ lệ), tổ trưởng + tỷ lệ × quỹ.
     Ăn thưởng: tổ trưởng + tỷ lệ × quỹ, không ai bị trừ.

Ngày dừng máy (Đợt 2, `khoan_dung_may`): tổ ăn chỉ tiêu ngày, chia cho người tổ trưởng tick theo
lương ca máy; cộng thêm nếu hôm đó vẫn có lần ghi. Tiền này KHÔNG vào quỹ ngày so chỉ tiêu (tăng
ca khoán) và KHÔNG vào quỹ tổ trưởng.

Luật ngày: tổ in (`la_to_in`) bỏ sản lượng ngày CN / lễ (ngày đó ăn công ngoài phép so); tổ khác
ngày CN trùng lễ tính GẤP ĐÔI.
"""
from __future__ import annotations

import calendar as _cal
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..models.payroll import LY_DO_DUNG_MAY, TO_TRUONG_CHIA, TO_TRUONG_THUONG
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.calendar_repo import CalendarRepository
from ..repositories.khoan_ky_repo import KhoanKyRepository
from .bien_cong_thuc import (
    MAC_DINH_TANG_LENH, TEN_HAM_CAM, ngu_canh_lenh, nhan, quy_cach_bien,
)
from .calendar_service import CalendarService
from .san_xuat import viec_khoan
from .san_xuat.nguoi_trong_me import ngay_cua_me
from .thanh_phan_engine import safe_eval



def _vnd(x: float) -> str:
    """Số tiền kiểu Việt: 620.000 (dấu chấm ngăn nghìn)."""
    return f"{round(x):,}".replace(",", ".")

def _so(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


@dataclass(frozen=True)
class MucKhoan:
    """Mức lương của từng người cho tiền khoán kỳ (Đợt 2).

    `luong_ca_may` = trọng số chia tiền một lần ghi: (lương vị trí + trách nhiệm) × hệ số thử việc
    + phụ cấp tháng (ô Phụ cấp khác + khoản thu ở hồ sơ). `nen_gio` = lương vị trí + trách nhiệm —
    gốc của chip `tien_gio` (÷ 26 ÷ 8 × giờ, không phụ cấp, không × thử việc)."""

    luong_ca_may: dict[int, float] = field(default_factory=dict)
    nen_gio: dict[int, float] = field(default_factory=dict)
    # Người ĂN LƯƠNG KHOÁN cuối kỳ (tổ tính hai lương, không ăn công nhật) — lần ghi ở công đoạn chưa
    # có cấu hình Khoán chỉ cảnh báo khi có họ hoặc khi tổ đã có lần ghi có Khoán (L-SX-27). None =
    # nơi gọi không biết ⇒ chỉ xét tổ.
    an_khoan: frozenset[int] | None = None


_TU_TRO = ("tu_tro", "tro_nhip")
_RE_TIEN_GIO = re.compile(r"\btien_gio\b")
_RE_CHIP_LUONG = re.compile(r"\b(sl_ghi|sl_vao|sl_ra|so_luot_chay)\b")
_RE_DON_GIA = re.compile(r"\bdon_gia_khoan\b")


def cong_thuc_cua_lan_ghi(khoan, b) -> str:
    """Công thức tính tiền của lần ghi: ảnh chụp lúc ghi (mg 0431); lần ghi cũ chưa chụp (NULL) dùng
    công thức hiện tại của công đoạn."""
    ct = getattr(b, "cong_thuc_khoan_snapshot", None)
    return (khoan.cong_thuc_khoan if ct is None else ct) or ""


def _luong_thanh_dong(ct: str | None) -> bool:
    """Công thức có chip lượng mà KHÔNG gọi `don_gia_khoan` ⇒ kết quả công thức là tiền nên lượng bị
    cộng như tiền đồng (1 tờ = 1đ). Không đoán ý người khai, không tự nhân — chỉ nói ra trước chốt."""
    ct = ct or ""
    return bool(_RE_CHIP_LUONG.search(ct) and not _RE_DON_GIA.search(ct))


def _khop_lam_tron(ds: list[dict], tong: float) -> None:
    lech = round(tong) - sum(x["tien"] for x in ds)
    if lech and ds:
        max(ds, key=lambda x: abs(x["tien"]))["tien"] += lech


def _so_vn(v: float) -> str:
    """Số kiểu Việt như FE `num` (vi-VN, tối đa 3 chữ số lẻ): 1500 → "1.500", 1.5 → "1,5"."""
    nguyen, _, le = f"{v:.3f}".rstrip("0").rstrip(".").partition(".")
    dau = "-" if nguyen.startswith("-") else ""
    return f"{dau}{int(nguyen.lstrip('-')):,}".replace(",", ".") + (f",{le}" if le else "")


_RE_TEN = re.compile(r"\b[a-z_][a-z0-9_]*\b")


def _lam_dep(s: str) -> str:
    # Hằng số gõ trong công thức ("80000") chấm ngăn nghìn như số thế vào.
    s = re.sub(r"(?<![\d.,])\d{4,}(?![\d.,])", lambda m: _so_vn(float(m.group(0))), s)
    return s.replace("*", "×").replace("/", "÷").replace(" - ", " − ")


def _dien_giai_chu(ct: str, ten: dict[str, str]) -> str:
    """Vế chữ của diễn giải — chỉ phụ thuộc công thức + tên tuỳ chọn, nơi gọi cache được."""
    def chu(m: re.Match) -> str:
        ma = m.group(0)
        return ma if ma in TEN_HAM_CAM else ten.get(ma) or nhan(ma)
    return _lam_dep(_RE_TEN.sub(chu, ct))


def dien_giai(ct: str, ctx: dict, ten: dict[str, str], ket_qua: float, *, ve_chu: str | None = None) -> str:
    """Công thức → "chữ = thế số = kết quả" cho bong bóng tiền ở màn Khoán theo tổ. Tên chip lấy từ
    từ điển chung, tuỳ chọn khi ghi lấy tên công đoạn khai (`ten`); hàm (`max`, `if`…) giữ nguyên.
    `ve_chu` = `_dien_giai_chu(ct, ten)` tính sẵn."""
    def so(m: re.Match) -> str:
        ma = m.group(0)
        return _so_vn(_so(ctx[ma])) if ma in ctx and ma not in TEN_HAM_CAM else ma

    chu = _dien_giai_chu(ct, ten) if ve_chu is None else ve_chu
    return f"{chu} = {_lam_dep(_RE_TEN.sub(so, ct))} = {_vnd(ket_qua)}"


def _nhan_tuy_chon(anh: list | None) -> list[str]:
    """Thẻ tuỳ chọn khác 0 của lần ghi cho ngăn soi: "trùng khuôn", "3 số lỗ đục"."""
    ra = []
    for t in anh or []:
        v = _so(t.get("gia_tri"))
        if v == 0:
            continue
        ten = str(t.get("ten") or t.get("ma") or "").lower()
        ra.append(ten if t.get("kieu") == "co_khong" else f"{_so_vn(v)} {ten}")
    return ra


def cong_thuc_cua_ban_ghi(r: dict) -> str | None:
    """Diễn giải công thức của một bản ghi sổ (`tinh(so=True)`) — dựng lúc cần nếu đã hoãn."""
    if r.get("cong_thuc") is None and r.get("_dien_giai"):
        ct, ctx, ten, tien, chu = r["_dien_giai"]
        return dien_giai(ct, ctx, ten, tien, ve_chu=chu)
    return r.get("cong_thuc")


class KhoanKyService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = KhoanKyRepository(db)
        self.cal = CalendarService(CalendarRepository(db), AuditLogRepository(db))

    # ------------------------------------------------------------------ tiền MỘT lần ghi
    def _quy_cach(self, cv, lenh: dict, bai_cache: dict) -> dict:
        # `bai_cache` giữ luôn quy cách lệnh (khoá ("lsx", id)) — một lệnh có hàng chục lần ghi.
        if cv.lsx_id and int(cv.lsx_id) in lenh:
            k = ("lsx", int(cv.lsx_id))
            if k not in bai_cache:
                bai_cache[k] = quy_cach_bien(lenh[int(cv.lsx_id)])
            return bai_cache[k]
        if cv.bai_ghep_id:
            bid = int(cv.bai_ghep_id)
            if bid not in bai_cache:
                # Cùng đường với lúc phát hành (`san_xuat/snapshot.py`): mực GỘP của mọi thành viên
                # (`so_mau_pha`, `so_kem`) + ba số tờ ở cấp bài. Gọi thẳng `quy_cach_bien_bai` thiếu
                # `muc` ⇒ bài ghép có Pantone vẫn ăn so_mau_pha = 0.
                from ..repositories.bai_ghep_repo import BaiGhepRepository
                from .bai_ghep_service import BaiGhepService

                bai = self.repo.bai_ghep(bid)
                svc = BaiGhepService(self.db, BaiGhepRepository(self.db), None, None)
                bai_cache[bid] = svc.quy_cach_bien_cua_bai(bai) if bai is not None else {}
            return bai_cache[bid]
        return {}

    @staticmethod
    def _ngu_canh(khoan, b, qc: dict, them: dict[str, float], lenh_ctx: dict | None = None) -> dict:
        """Biến của lần ghi cho công thức khoán.

        `them` = chip Đợt 2 của lần ghi (`so_lan_chay`, `tien_gio`, `tu_tro`). Tuỳ chọn khi ghi:
        mọi mã công đoạn đang khai mặc định 0 (lần ghi cũ chưa có ảnh chụp vẫn tính được), đè bằng
        ảnh chụp của lần ghi. `lenh_ctx` = `ngu_canh_lenh(qc)` tính sẵn (nơi gọi cache theo lệnh)."""
        tuy_chon = {t["ma"]: 0.0 for t in (khoan.tuy_chon or []) if t.get("ma")}
        tuy_chon.update({t["ma"]: _so(t.get("gia_tri")) for t in (b.tuy_chon_khoan or []) if t.get("ma")})
        return {**(ngu_canh_lenh(qc) if lenh_ctx is None else lenh_ctx), **MAC_DINH_TANG_LENH,
                **tuy_chon, **them,
                "sl_vao": _so(b.tong), "sl_ra": _so(b.tot), "sl_ghi": _so(b.tot),
                "gia_co_dinh": _so(b.gia_co_dinh_khoan_snapshot),
                "don_gia_khoan": float(b.don_gia_khoan_snapshot)}

    @classmethod
    def _tien_chinh(cls, khoan, b, qc: dict, them: dict[str, float], ctx: dict | None = None) -> float:
        """Tiền phần chính của lần ghi; công thức lỗi ⇒ `ValueError` kèm câu lỗi. `ctx` = ngữ cảnh
        `_ngu_canh` dựng sẵn (nơi gọi dùng lại cho diễn giải)."""
        ct = cong_thuc_cua_lan_ghi(khoan, b).strip()
        if not ct:
            return 0.0                    # không có trên công thức thì không tính (chủ 22/10)
        # Kết quả công thức LÀ tiền, không nhân thêm gì (chủ 22/10).
        return safe_eval(ct, cls._ngu_canh(khoan, b, qc, them) if ctx is None else ctx)

    @staticmethod
    def chip_lenh(qc: dict, bac: dict | None) -> dict[str, float]:
        """Chip của lần ghi đọc từ quy cách lệnh + bậc đã chụp: `tu_tro`, `gia_gom_uv`."""
        return {
            "tu_tro": 1.0 if qc.get("quy_cach_in") in _TU_TRO else 0.0,
            # Bậc giá đã gồm mực UV (Pantone UV) ⇒ công thức thôi nhân đôi (22/10/2026).
            "gia_gom_uv": 1.0 if (bac or {}).get("gom_uv") else 0.0,
        }

    @staticmethod
    def _tay_ra(tay, tien_may: float, da_de: bool) -> dict:
        """Trường sửa tay của một lần ghi trong sổ (`so=True`)."""
        return {"loai": "lan_ghi", "tien_may": tien_may if da_de else None, "tay": da_de,
                "ghi_chu_tay": tay.ghi_chu if tay is not None else None,
                "sua_boi_id": tay.sua_boi_id if tay is not None else None,
                "sua_luc": tay.sua_luc if tay is not None else None}

    @staticmethod
    def _khoa_chay(cv, b) -> tuple:
        """CÙNG lệnh ở CÙNG công đoạn — lệnh hoặc bài ghép; việc không neo lệnh thì theo chính nó."""
        if cv.lsx_id or cv.bai_ghep_id:
            return (cv.lsx_id, cv.bai_ghep_id, int(b.khoan_cong_doan_id))
        return ("cv", int(cv.id), int(b.khoan_cong_doan_id))

    def _so_lan_chay(self, cap, den: datetime, cuoi: date) -> dict[tuple, int]:
        """Số lần ghi của mỗi khoá tới HẾT NGÀY cuối kỳ (giờ xưởng) — kể cả lần ở kỳ trước."""
        if not cap:
            return {}
        # Lần ghi trước 00:00 UTC của ngày áp chót chắc chắn rơi vào ngày xưởng ≤ ngày cuối kỳ (lệch
        # múi giờ ≤ 14 giờ) ⇒ để CSDL đếm gộp; chỉ khúc đuôi mới cần lọc từng dòng theo giờ xưởng.
        gom_truoc = datetime.combine(cuoi - timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        gop, dong = self.repo.lan_chay(den, {int(b.khoan_cong_doan_id) for b, _ in cap},
                                       lsx_ids={int(cv.lsx_id) for _, cv in cap if cv.lsx_id},
                                       bai_ids={int(cv.bai_ghep_id) for _, cv in cap if cv.bai_ghep_id},
                                       cv_ids={int(cv.id) for _, cv in cap}, gom_truoc=gom_truoc)

        def khoa(r) -> tuple:
            # Cùng khoá với `_khoa_chay` — dòng ở đây chỉ có cột, không có đối tượng.
            return ((r.lsx_id, r.bai_ghep_id, int(r.khoan_cong_doan_id)) if r.lsx_id or r.bai_ghep_id
                    else ("cv", int(r.cv_id), int(r.khoan_cong_doan_id)))

        dem: dict[tuple, int] = defaultdict(int)
        for r in gop:
            dem[khoa(r)] += int(r.so)
        for r in dong:
            if (dd := ngay_cua_me(r.bat_dau)) is not None and dd <= cuoi:
                dem[khoa(r)] += 1
        return dem

    @staticmethod
    def _cap_dung_chip(cap, khoan_map: dict, chip: str) -> list:
        """Lần ghi của kỳ mà công thức (ảnh chụp, hoặc hiện tại nếu chưa chụp) gọi `chip` — chip đắt
        (đếm lại cả lịch sử) chỉ tính cho chúng."""
        re_chip = re.compile(rf"\b{chip}\b")
        return [(b, cv) for b, cv in cap
                if (k := khoan_map.get(int(b.khoan_cong_doan_id))) is not None
                and re_chip.search(cong_thuc_cua_lan_ghi(k, b))]

    def _so_lan_thu_viec(self, cap, den: datetime, cuoi: date, khoan_map: dict) -> dict[tuple, int]:
        """Số lần ghi (cùng khoá với `so_lan_chay`, tới hết ngày cuối kỳ) có ít nhất một người làm
        đang thử việc ở NGÀY ghi — đọc trạng thái hồ sơ theo sự kiện nhân sự, không ai tick."""
        from ..repositories.employee_repo import EmployeeRepository
        from .bien_che import trang_thai_tren_ngay
        from .payroll_service import la_thu_viec

        cap = self._cap_dung_chip(cap, khoan_map, "so_lan_thu_viec")
        if not cap:
            return {}
        dong = self.repo.nguoi_lan_chay(den, {int(b.khoan_cong_doan_id) for b, _ in cap},
                                        lsx_ids={int(cv.lsx_id) for _, cv in cap if cv.lsx_id},
                                        bai_ids={int(cv.bai_ghep_id) for _, cv in cap if cv.bai_ghep_id},
                                        cv_ids={int(cv.id) for _, cv in cap})
        emp_ids = {int(r.employee_id) for r in dong}
        nv_repo = EmployeeRepository(self.db)
        ho_so, su_kien = nv_repo.get_many(emp_ids), nv_repo.events_map(emp_ids)
        lan: dict[int, tuple] = {}
        for r in dong:
            dd = ngay_cua_me(r.bat_dau)
            e = ho_so.get(int(r.employee_id))
            if dd is None or dd > cuoi or e is None or int(r.batch_id) in lan:
                continue
            if la_thu_viec(e, trang_thai_tren_ngay(e, su_kien.get(int(e.id), []), dd)[0]):
                lan[int(r.batch_id)] = ((r.lsx_id, r.bai_ghep_id, int(r.khoan_cong_doan_id))
                                        if r.lsx_id or r.bai_ghep_id
                                        else ("cv", int(r.cv_id), int(r.khoan_cong_doan_id)))
        dem: dict[tuple, int] = defaultdict(int)
        for k in lan.values():
            dem[k] += 1
        return dem

    def _chay_tiep(self, cap, den: datetime, khoan_map: dict) -> set[int]:
        """Lần ghi có lần liền trước trên cùng máy (không máy ⇒ cùng tổ) là CHÍNH dòng công việc này
        và CÙNG ngày xưởng — qua đêm máy rửa mực, sáng canh lại nên sổ T08 trả lên bài (24/10/2026)."""
        cap = self._cap_dung_chip(cap, khoan_map, "chay_tiep")
        if not cap:
            return set()
        truoc = self.repo.viec_lien_truoc({int(b.id) for b, _ in cap}, den)
        ra = set()
        for b, cv in cap:
            t = truoc.get(int(b.id))
            if t and t[0] == int(cv.id) and ngay_cua_me(t[1]) == ngay_cua_me(b.bat_dau):
                ra.add(int(b.id))
        return ra

    def _chip_khuon(self, cap, den: datetime, khoan_map: dict) -> tuple[set[int], set[int]]:
        """(lần ghi trùng khuôn, lần ghi khuôn mới) — đọc dao của bước lệnh, không ai tick (26/10/2026).

        Trùng khuôn: lần liền trước trên cùng máy (không máy ⇒ cùng tổ) dùng CÙNG dao — dao còn nằm
        trên máy, kể cả qua đêm. Khuôn mới: lần ghi đầu tiên từng dùng con dao đó. Bước không trỏ
        dao thì cả hai 0 (lên khuôn thường)."""
        cap = {int(b.id): (b, cv) for c in ("trung_khuon", "khuon_moi")
               for b, cv in self._cap_dung_chip(cap, khoan_map, c)}
        if not cap:
            return set(), set()
        truoc = self.repo.viec_lien_truoc(set(cap), den)
        dao = self.repo.dao_cua_viec({int(cv.id) for _, cv in cap.values()} | {t[0] for t in truoc.values()})
        trung = {bid for bid, (_, cv) in cap.items()
                 if (k := dao.get(int(cv.id))) and bid in truoc and dao.get(truoc[bid][0]) == k}
        dau = self.repo.lan_dau_cua_dao({dao[int(cv.id)] for _, cv in cap.values() if int(cv.id) in dao})
        return trung, {bid for bid in cap if bid in dau}

    # ------------------------------------------------------------------ cả kỳ
    def tinh(self, year: int, month: int, muc: MucKhoan, *, so: bool = False,
             dien_giai_ngay: bool = True, theo_nguoi: bool = True) -> dict:
        """`so=True` ⇒ thêm `"so"`: bản ghi theo LẦN GHI / ngày dừng máy / ngày của tổ / mốc tổ
        trưởng, số đã áp luật ngày và đã trích tổ trưởng — nguồn của màn Khoán theo tổ
        (`services/khoan_theo_to.py`), để màn đó không tự tính lại.

        `dien_giai_ngay=False` ⇒ `cong_thuc` của bản ghi để None, đọc bằng `cong_thuc_cua_ban_ghi`
        lúc cần — màn Khoán theo tổ chỉ bày một tổ, diễn giải cả nghìn lần ghi của cả xưởng là phí.
        `theo_nguoi=False` ⇒ không dựng ngăn soi từng người (`"theo_nguoi"` rỗng) — chỉ ngăn soi một
        dòng lương đọc nó; tiền, thiếu giá, cảnh báo, sổ không đổi."""
        dau = date(year, month, 1)
        cuoi = date(year, month, _cal.monthrange(year, month)[1])
        # Lấy rộng một ngày mỗi đầu rồi lọc lại theo ngày giờ xưởng.
        tu = datetime.combine(dau - timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        den = datetime.combine(cuoi + timedelta(days=2), datetime.min.time(), tzinfo=timezone.utc)
        ngay_lan: dict[int, date] = {}   # batch_id → ngày giờ xưởng, tính một lần
        cap = []
        for b, cv in self.repo.lan_ghi_trong_khoang(tu, den):
            if (dd := ngay_cua_me(b.bat_dau)) is not None and dau <= dd <= cuoi:
                cap.append((b, cv))
                ngay_lan[int(b.id)] = dd

        ids = [int(b.id) for b, _ in cap]
        nguoi = self.repo.nguoi_theo_lan_ghi(ids)
        phat_sinh = self.repo.phat_sinh_theo_lan_ghi(ids)
        khoan_map = self.repo.khoan_theo_id({int(b.khoan_cong_doan_id) for b, _ in cap})
        lenh = self.repo.lenh_cho_quy_cach({int(cv.lsx_id) for _, cv in cap if cv.lsx_id})
        pb = self.repo.phong_ban()
        le = {s.day for s in self.cal.paid_holidays_in_month(year, month)}
        bai_cache: dict = {}
        nc_cache: dict = {}    # ("lsx"|"bai", id) → ngu_canh_lenh(quy cách) — một lệnh nhiều lần ghi
        chu_cache: dict = {}   # (công thức, cấu hình khoán) → vế chữ của diễn giải
        so_lan = self._so_lan_chay(cap, den, cuoi)
        so_lan_tv = self._so_lan_thu_viec(cap, den, cuoi, khoan_map)
        chay_tiep = self._chay_tiep(cap, den, khoan_map)
        trung_khuon, khuon_moi = self._chip_khuon(cap, den, khoan_map)
        ten_nv = self.repo.ten_nhan_vien({int(r.employee_id) for rs in nguoi.values() for r in rs})
        # Kế toán sửa tay (23/10/2026): tiền gõ đè + ghi chú theo lần ghi.
        tay_lan = self.repo.lan_ghi_tay(ids)
        da_tay: set[int] = set()   # lần ghi đã đè tiền ⇒ cảnh báo thiếu giá của nó rụng

        def ten_to(dep_id) -> str:
            d = pb.get(int(dep_id)) if dep_id else None
            return d.name if d is not None else "—"

        thieu: list[dict] = []
        canh_bao: list[str] = []
        da_nhac_dong: set[int] = set()   # công đoạn khoán đã nhắc "lượng thành tiền đồng"
        # Phần của từng người từng lần ghi, ĐÃ áp luật ngày: [emp, tổ, ngày, batch_id, tiền].
        phan: list[list] = []
        chi_tiet: dict[int, list[dict]] = defaultdict(list)
        ct_lan: dict[tuple[int, int], dict] = {}   # (người, lần ghi) → dòng ngăn soi
        # Quỹ GỐC của tổ trong ngày và phần gốc của mỗi người — cho chỉ tiêu ngày.
        quy_ngay: dict[tuple[int, date], float] = defaultdict(float)
        phan_ngay: dict[tuple[int, date], dict[int, float]] = defaultdict(lambda: defaultdict(float))
        so_ban_ghi: dict[int, dict] = {}   # `so=True`: batch_id → bản ghi lần ghi
        so_dm: list[dict] = []
        so_ngay: list[dict] = []
        so_tt: list[dict] = []

        for b, cv in cap:
            d = ngay_lan[int(b.id)]
            n_thieu = len(thieu)
            to = int(cv.department_id) if cv.department_id else None
            khoan = khoan_map.get(int(b.khoan_cong_doan_id))
            ten_cd = b.ten_khoan_snapshot or (khoan.cong_doan.ten if khoan is not None else "—")
            ds = nguoi.get(int(b.id)) or []
            w = {int(r.employee_id): _so(muc.luong_ca_may.get(int(r.employee_id))) for r in ds}
            chua = [ten_nv.get(e, f"#{e}") for e, v in w.items() if v <= 0]
            # Có người + ai cũng có lương ca máy ⇒ tiền lần ghi (kể cả số kế toán gõ tay) chia được.
            chia_duoc = bool(ds) and not chua

            def bao(ly_do: str, sua: str = "gia") -> None:
                # `sua` = chỗ phải sửa, câu cảnh báo trước chốt chia nhóm theo nó: "gia" (tab Khoán
                # của công đoạn), "cau_hinh" (cấu hình Khoán đã gỡ), "luong" (hồ sơ lương), "lan_ghi"
                # (bàn tổ). `chia_duoc` = kế toán gõ tay thì câu rụng (tiền đã có chỗ đi).
                thieu.append({"batch_id": int(b.id), "cong_doan": ten_cd, "to": ten_to(to),
                              "ngay": d.strftime("%d/%m"), "ly_do": ly_do, "sua": sua,
                              "chia_duoc": chia_duoc})

            # Nhánh chặn (L-SX-41): máy không tính tiền nhưng lần ghi VẪN vào sổ 0 đ — số kế toán gõ
            # tay vẫn ăn, câu cảnh báo nói đúng chỗ phải sửa.
            chan = True
            if khoan is None:
                bao("cấu hình Khoán của công đoạn đã bị gỡ", "cau_hinh")
            elif not ds:
                bao("chưa tick người làm", "lan_ghi")
            elif chua:
                bao(f"{', '.join(chua)} chưa có lương ca máy", "luong")
            else:
                chan = False
            bac = b.bac_khoan_snapshot or None
            cong_thuc = None
            hoan_dg = None
            ctx = None
            tien = 0.0
            if chan:
                pass
            elif b.don_gia_khoan_snapshot is None:
                if bac and not bac.get("ma"):
                    bao(f"{viec_khoan.mo_ta_mau(bac)} chưa khớp bậc giá nào")
                elif bac:
                    bao(f"tổ chưa có giá bậc {bac.get('ten')} ({viec_khoan.mo_ta_mau(bac)})")
                else:
                    bao("tổ chưa có giá ở bảng giá theo tổ")
            elif _RE_TIEN_GIO.search(cong_thuc_cua_lan_ghi(khoan, b)) and b.ket_thuc <= b.bat_dau:
                bao("công thức tính theo giờ mà lần ghi chưa có giờ kết thúc", "lan_ghi")
                chan = True
            else:
                qc = self._quy_cach(cv, lenh, bai_cache)
                k_qc = ("lsx", int(cv.lsx_id)) if cv.lsx_id and int(cv.lsx_id) in lenh else (
                    ("bai", int(cv.bai_ghep_id)) if cv.bai_ghep_id else None)
                if k_qc is None:
                    nc = ngu_canh_lenh(qc)
                elif k_qc in nc_cache:
                    nc = nc_cache[k_qc]
                else:
                    nc = nc_cache[k_qc] = ngu_canh_lenh(qc)
                gio = max(0.0, (b.ket_thuc - b.bat_dau).total_seconds() / 3600.0)
                them = {
                    "so_lan_chay": float(max(1, so_lan.get(self._khoa_chay(cv, b), 0))),
                    "so_lan_thu_viec": float(so_lan_tv.get(self._khoa_chay(cv, b), 0)),
                    "chay_tiep": 1.0 if int(b.id) in chay_tiep else 0.0,
                    "trung_khuon": 1.0 if int(b.id) in trung_khuon else 0.0,
                    "khuon_moi": 1.0 if int(b.id) in khuon_moi else 0.0,
                    "tien_gio": sum(_so(muc.nen_gio.get(e)) for e in w) / 26 / 8 * gio,
                    **self.chip_lenh(qc, bac),
                }
                if _luong_thanh_dong(cong_thuc_cua_lan_ghi(khoan, b)) and int(khoan.id) not in da_nhac_dong:
                    da_nhac_dong.add(int(khoan.id))
                    canh_bao.append(f"Công đoạn {khoan.cong_doan.ten}: công thức khoán có sản lượng mà không "
                                    f"nhân Đơn giá khoán — sản lượng đang cộng như tiền đồng. Nhân sản "
                                    f"lượng với Đơn giá khoán ở Danh mục → Công đoạn → tab Khoán nếu cần.")
                ctx = self._ngu_canh(khoan, b, qc, them, nc)
                try:
                    tien = self._tien_chinh(khoan, b, qc, them, ctx)
                except ValueError as e:
                    bao(f"công thức khoán lỗi — {e}")
                    tien = 0.0
                else:
                    ct = cong_thuc_cua_lan_ghi(khoan, b).strip()
                    if so and ct:
                        k_chu = (ct, int(khoan.id))
                        ten_tc = {t["ma"]: t.get("ten") or t["ma"] for t in (khoan.tuy_chon or []) if t.get("ma")}
                        if k_chu not in chu_cache:
                            chu_cache[k_chu] = _dien_giai_chu(ct, ten_tc)
                        hoan_dg = (ct, ctx, ten_tc, tien, chu_cache[k_chu])
                        if dien_giai_ngay:
                            cong_thuc = dien_giai(*hoan_dg[:4], ve_chu=hoan_dg[4])
            tien_chinh = tien
            ps_so: list[dict] = []
            # Nhánh chặn không đọc việc phát sinh (cấu hình Khoán có thể đã gỡ).
            ct_ps_song = {} if chan else {int(v.id): v.cong_thuc for v in khoan.viec_phat_sinh}
            for r in () if chan else (phat_sinh.get(int(b.id)) or []):
                # "Cách tính giá" (24/10/2026): công thức ra đơn giá trên chính lần ghi — ảnh chụp lúc
                # ghi; dòng ghi trước mg 0443 (NULL) đọc công thức hiện tại của danh mục.
                ct_ps = (r.cong_thuc_snapshot if r.cong_thuc_snapshot is not None
                         else ct_ps_song.get(int(r.phat_sinh_id))) or ""
                if ct_ps.strip():
                    if ctx is None:
                        bao(f'việc phát sinh "{r.ten_snapshot}" tính theo công thức mà lần ghi chưa có giá')
                        continue
                    try:
                        dg = float(safe_eval(ct_ps, ctx))
                    except ValueError as e:
                        bao(f'cách tính giá của việc phát sinh "{r.ten_snapshot}" lỗi — {e}')
                        continue
                elif r.don_gia_snapshot is None:
                    bao(f'việc phát sinh "{r.ten_snapshot}" chưa có giá của tổ')
                    continue
                else:
                    dg = float(r.don_gia_snapshot)
                tien += _so(r.so_luong) * dg
                ps_so.append({"ten": r.ten_snapshot, "so_luong": _so(r.so_luong),
                              "don_vi": getattr(r, "don_vi_snapshot", None),
                              "don_gia": dg, "tien": _so(r.so_luong) * dg})
            tien_may = tien
            tay = tay_lan.get(int(b.id))
            if tay is not None and tay.tien is not None:
                tien = _so(tay.tien)
                da_tay.add(int(b.id))
            # Tiền khoán ra âm (L-SX-34): giữ đúng số công thức — luật "công thức tường minh" — chỉ nói
            # ra trước chốt để người khai xem lại.
            if tien < 0:
                canh_bao.append(f"Lần ghi {ten_cd} — {ten_to(to)} ngày {d.strftime('%d/%m')}: tiền khoán "
                                f"ra âm {_vnd(tien)} đ — xem lại công thức ở Danh mục → Công đoạn → tab "
                                f"Khoán, hoặc gõ tay tiền ở Khoán theo tổ.")
            # Lý do máy chưa tính được của CHÍNH lần ghi — sổ và ngăn soi in ra (L-SX-29).
            ly_do = [t["ly_do"] for t in thieu[n_thieu:]]
            # Lần ghi máy chưa tính được (thiếu giá, công thức lỗi, nhánh chặn) vẫn vào sổ + ngăn soi
            # với tiền 0 để kế toán gõ tay; lần ghi ra 0 vì công thức không tính thì bỏ như cũ.
            if tien == 0 and int(b.id) not in da_tay and not ly_do:
                continue

            la_cn, la_le = self.cal.la_ngay_nghi_tuan(d), d in le
            to_in = bool(getattr(pb.get(to), "la_to_in", False)) if to else False
            if to_in and (la_cn or la_le):
                he_so, ghi_chu = 0.0, "tổ in ngày Chủ nhật / lễ — ngày đó ăn công, không tính sản lượng"
            elif la_cn and la_le:
                he_so, ghi_chu = 2.0, "Chủ nhật trùng lễ — sản lượng ×2"
            else:
                he_so, ghi_chu = 1.0, None
            tong_w = sum(w.values())
            the = _nhan_tuy_chon(b.tuy_chon_khoan)
            # Không người / có người chưa có lương ca máy ⇒ không chia (câu cảnh báo còn đứng).
            for r in ds if chia_duoc else ():
                emp = int(r.employee_id)
                moi = tien * w[emp] / tong_w
                phan.append([emp, to, d, int(b.id), moi * he_so])
                # `tien` là số SAU khi trích tổ trưởng (khối tổ trưởng bên dưới điền lại + ghi % trích
                # vào `to_truong`) — ngăn soi không còn dòng trừ riêng (chủ chốt 22/10/2026).
                if theo_nguoi:
                    ct_lan[(emp, int(b.id))] = {
                        "loai": "lan_ghi", "batch_id": int(b.id), "ngay": d.isoformat(),
                        "cong_doan": ten_cd, "to": ten_to(to), "so_luong": _so(b.tot),
                        "tien_lan_ghi": round(tien), "so_nguoi": len(ds),
                        "ty_le": w[emp] / tong_w, "luong_bu_lo": w[emp], "tong_luong_bu_lo": tong_w,
                        "to_truong": [], "tuy_chon": the, "tien": round(moi * he_so), "ghi_chu": ghi_chu,
                        "chua_tinh": ly_do,
                    }
                    chi_tiet[emp].append(ct_lan[(emp, int(b.id))])
                if he_so > 0 and to is not None:
                    phan_ngay[(to, d)][emp] += moi
            if chia_duoc and he_so > 0 and to is not None:
                quy_ngay[(to, d)] += tien
            if so:
                so_ban_ghi[int(b.id)] = {
                    "batch_id": int(b.id), "ngay": d, "bat_dau": b.bat_dau, "to_id": to,
                    "cong_viec_id": int(cv.id), "lsx_id": cv.lsx_id, "bai_ghep_id": cv.bai_ghep_id,
                    "cong_doan": ten_cd, "bac": (bac or {}).get("ten"), "tuy_chon": the,
                    "phat_sinh": ps_so, "so_luong": _so(b.tot), "don_vi": b.don_vi,
                    "tien_chinh": tien_chinh, "tien": tien, "he_so": he_so, "ghi_chu": ghi_chu,
                    "cong_thuc": cong_thuc, "_dien_giai": hoan_dg, "chua_tinh": ly_do, "khong_khoan": False,
                    # Điền lại SAU khi trích tổ trưởng — đây mới là số người đó nhận.
                    "nguoi": ({int(r.employee_id): tien * w[int(r.employee_id)] / tong_w * he_so for r in ds}
                              if chia_duoc else {}),
                    "to_truong": [],
                    **self._tay_ra(tay, tien_may, int(b.id) in da_tay),
                }

        # --- Lần ghi ở công đoạn CHƯA có cấu hình Khoán (L-SX-27) ------------------------------
        # Dòng 0 đ + câu "chưa có cấu hình Khoán", KHÔNG vào `cap` (đếm lần chạy đọc mã Khoán). Chỉ
        # nói ở tổ đã có lần ghi có Khoán trong kỳ hoặc khi có người ăn lương khoán được tick — tổ ăn
        # lương thời gian cũng ghi sản lượng, réo hết là ngập câu trước chốt. Ô Tiền khoá: không có
        # cấu hình Khoán thì không gõ tay được (`khoan_sua_tay`).
        to_co_khoan = {int(cv.department_id) for _, cv in cap if cv.department_id}
        cap0 = [(b, cv, dd) for b, cv in self.repo.lan_ghi_khong_khoan(tu, den)
                if (dd := ngay_cua_me(b.bat_dau)) is not None and dau <= dd <= cuoi]
        nguoi0 = self.repo.nguoi_theo_lan_ghi([int(b.id) for b, _, _ in cap0]) if cap0 else {}
        for b, cv, d in cap0:
            to = int(cv.department_id) if cv.department_id else None
            tick = {int(r.employee_id) for r in nguoi0.get(int(b.id)) or []}
            if not ((to is not None and to in to_co_khoan) or (muc.an_khoan and tick & muc.an_khoan)):
                continue
            ly = "công đoạn chưa có cấu hình Khoán"
            thieu.append({"batch_id": int(b.id), "cong_doan": cv.ten_cong_doan or "—", "to": ten_to(to),
                          "ngay": d.strftime("%d/%m"), "ly_do": ly, "sua": "chua_khoan", "chia_duoc": False})
            if so:
                so_ban_ghi[int(b.id)] = {
                    "batch_id": int(b.id), "ngay": d, "bat_dau": b.bat_dau, "to_id": to,
                    "cong_viec_id": int(cv.id), "lsx_id": cv.lsx_id, "bai_ghep_id": cv.bai_ghep_id,
                    "cong_doan": cv.ten_cong_doan or "—", "bac": None, "tuy_chon": [], "phat_sinh": [],
                    "so_luong": _so(b.tot), "don_vi": b.don_vi, "tien_chinh": 0.0, "tien": 0.0,
                    "he_so": 1.0, "ghi_chu": None, "cong_thuc": None, "_dien_giai": None,
                    "chua_tinh": [ly], "khong_khoan": True, "nguoi": {}, "to_truong": [],
                    **self._tay_ra(None, 0.0, False),
                }

        # --- Dòng tay kế toán chèn vào sổ (23/10/2026) ------------------------------------
        # Vào quỹ tổ và `phan` (tổ trưởng trích như lần ghi), hệ số ngày 1, KHÔNG vào `quy_ngay`
        # (không sinh tăng ca khoán) — tiền kế toán gõ là tiền chốt.
        dong_tay = self.repo.dong_tay(year, month)
        ten_nv.update(self.repo.ten_nhan_vien(
            {int(e) for r in dong_tay for e in (r.nguoi_ids or [])} - set(ten_nv)))
        for r in dong_tay:
            to, d, key = int(r.department_id), r.ngay, f"tay:{r.id}"
            tien = _so(r.tien)
            ds = [int(e) for e in (r.nguoi_ids or [])]
            w = {e: _so(muc.luong_ca_may.get(e)) for e in ds}
            chua = [ten_nv.get(e, f"#{e}") for e, v in w.items() if v <= 0]
            loi = (f"{', '.join(chua)} chưa có lương ca máy" if chua
                   else None if ds else "chưa chọn người tham gia")
            if loi:
                thieu.append({"batch_id": None, "cong_doan": r.noi_dung or "Dòng tay", "to": ten_to(to),
                              "ngay": d.strftime("%d/%m"), "ly_do": loi,
                              "sua": "luong" if chua else "dong_tay"})
            else:
                tong_w = sum(w.values())
                for e in ds:
                    moi = tien * w[e] / tong_w
                    phan.append([e, to, d, key, moi])
                    if not theo_nguoi:
                        continue
                    ct_lan[(e, key)] = {
                        "loai": "lan_ghi", "batch_id": None, "ngay": d.isoformat(),
                        "cong_doan": r.noi_dung or "Dòng tay", "to": ten_to(to), "so_luong": 0.0,
                        "tien_lan_ghi": round(tien), "so_nguoi": len(ds),
                        "ty_le": w[e] / tong_w, "luong_bu_lo": w[e], "tong_luong_bu_lo": tong_w,
                        "to_truong": [], "tuy_chon": [], "tien": round(moi),
                        "ghi_chu": "dòng tay kế toán thêm",
                    }
                    chi_tiet[e].append(ct_lan[(e, key)])
            if so:
                so_ban_ghi[key] = {
                    "batch_id": None, "loai": "dong_tay", "dong_tay_id": int(r.id), "noi_dung": r.noi_dung,
                    "nguoi_ids": ds, "loi": loi,
                    "ngay": d, "bat_dau": datetime.combine(d, datetime.max.time(), tzinfo=timezone.utc),
                    "to_id": to, "cong_viec_id": None, "lsx_id": None, "bai_ghep_id": None,
                    "cong_doan": r.noi_dung or "", "bac": None, "tuy_chon": [], "phat_sinh": [],
                    "so_luong": 0.0, "don_vi": None, "tien_chinh": tien, "tien": tien, "he_so": 1.0,
                    "ghi_chu": None, "cong_thuc": None, "nguoi": {e: 0.0 for e in ds} if loi else {},
                    "to_truong": [], "tien_may": None, "tay": True, "ghi_chu_tay": r.ghi_chu,
                    "sua_boi_id": r.sua_boi_id, "sua_luc": r.sua_luc,
                }
        # Kế toán đã gõ tay tiền lần ghi ⇒ câu thiếu giá / công thức của lần đó rụng; câu "không chia
        # được" (không người, thiếu lương ca máy) vẫn đứng — số gõ tay chưa có ai nhận.
        thieu = [t for t in thieu if t["batch_id"] is None or t["batch_id"] not in da_tay
                 or not t.get("chia_duoc", True)]

        # --- Tăng ca khoán: 50% phần tổ vượt chỉ tiêu ngày ------------------------------
        moc_chi_tieu = self.repo.chi_tieu_ngay(cuoi)

        def chi_tieu(to: int, d: date) -> float:
            dep, da_qua = to, set()
            while dep and dep not in da_qua:
                da_qua.add(dep)
                hop = [m for m in moc_chi_tieu.get(dep, []) if m.ap_dung_tu <= d]
                if hop:
                    return _so(hop[-1].so_tien)
                dep = getattr(pb.get(dep), "parent_id", None)
            return 0.0

        tang_ca: dict[int, float] = defaultdict(float)
        for (to, d), quy in quy_ngay.items():
            ct = chi_tieu(to, d)
            ngay_so = {"to_id": to, "ngay": d, "quy": quy, "chi_tieu": ct, "tang_ca": 0.0, "nguoi": {}}
            if so:
                so_ngay.append(ngay_so)
            if ct <= 0 or quy <= ct:
                continue
            them = 0.5 * (quy - ct)
            ngay_so["tang_ca"] = them
            for emp, p in phan_ngay[(to, d)].items():
                t = them * p / quy
                tang_ca[emp] += t
                ngay_so["nguoi"][emp] = t
                chi_tiet[emp].append({
                    "loai": "tang_ca_khoan", "ngay": d.isoformat(), "to": ten_to(to),
                    "tien_lan_ghi": round(them), "ty_le": p / quy, "tien": round(t),
                    "ghi_chu": f"tổ làm {_vnd(quy)} đ, chỉ tiêu {_vnd(ct)} đ/ngày — 50% phần vượt",
                })

        # --- Ngày dừng máy: tổ ăn chỉ tiêu ngày ----------------------------------------
        them_dm: dict[int, float] = defaultdict(float)
        dm = self.repo.dung_may_trong_khoang(dau, cuoi)
        ma_sc = self.repo.ma_sua_chua({r.sua_chua_id for r in dm})
        ten_nv.update(self.repo.ten_nhan_vien(
            {int(e) for r in dm for e in (r.nguoi_ids or [])} - set(ten_nv)))
        for r in dm:
            to, ngay_s = int(r.department_id), r.ngay.strftime("%d/%m")
            muc_ngay = chi_tieu(to, r.ngay)
            if muc_ngay <= 0:
                canh_bao.append(f"Tổ {ten_to(to)} chưa khai chỉ tiêu ngày — ngày dừng máy {ngay_s} "
                                f"chưa tính.")
                continue
            ds = [int(e) for e in (r.nguoi_ids or [])]
            w = {e: _so(muc.luong_ca_may.get(e)) for e in ds}
            chua = [ten_nv.get(e, f"#{e}") for e, v in w.items() if v <= 0]
            if not ds or chua:
                thieu.append({"batch_id": None, "cong_doan": "Dừng máy", "to": ten_to(to), "ngay": ngay_s,
                              "ly_do": (f"{', '.join(chua)} chưa có lương ca máy" if chua
                                        else "chưa chọn người hưởng"),
                              "sua": "luong" if chua else "dung_may"})
                continue
            tong_w = sum(w.values())
            if so:
                so_dm.append({"ngay": r.ngay, "to_id": to, "ly_do": LY_DO_DUNG_MAY.get(r.ly_do, r.ly_do),
                              "sua_chua": ma_sc.get(int(r.sua_chua_id)) if r.sua_chua_id else None,
                              "ghi_chu": r.ghi_chu, "tien": muc_ngay,
                              "nguoi": {e: muc_ngay * w[e] / tong_w for e in ds}})
            for e in ds:
                t = muc_ngay * w[e] / tong_w
                them_dm[e] += t
                chi_tiet[e].append({
                    "loai": "dung_may", "ngay": r.ngay.isoformat(), "to": ten_to(to),
                    "ly_do": LY_DO_DUNG_MAY.get(r.ly_do, r.ly_do),
                    "sua_chua": ma_sc.get(int(r.sua_chua_id)) if r.sua_chua_id else None,
                    "ghi_chu": r.ghi_chu, "tien_ngay": round(muc_ngay), "so_nguoi": len(ds),
                    "ty_le": w[e] / tong_w, "luong_bu_lo": w[e], "tong_luong_bu_lo": tong_w,
                    "tien": round(t),
                })

        # --- Tổ trưởng ăn chia / ăn thưởng ---------------------------------------------
        con: dict[int, list[int]] = defaultdict(list)
        for dep in pb.values():
            if dep.parent_id:
                con[int(dep.parent_id)].append(int(dep.id))

        def cay(goc: int) -> set[int]:
            ra, hang = set(), [goc]
            while hang:
                x = hang.pop()
                if x in ra:
                    continue
                ra.add(x)
                hang.extend(con.get(x, []))
            return ra

        moc_tt = {k: v for k, v in self.repo.to_truong(cuoi).items()
                  if v.che_do in (TO_TRUONG_CHIA, TO_TRUONG_THUONG) and _so(v.ty_le) > 0}
        emp_cua_tk = self.repo.nhan_vien_theo_tai_khoan(
            {int(pb[k].head_user_id) for k in moc_tt if k in pb and pb[k].head_user_id})
        them_tt: dict[int, float] = defaultdict(float)
        # Vị trí trong `phan` theo tổ — mỗi mốc chỉ duyệt phần của nhánh mình (giữ NGUYÊN thứ tự của
        # `phan` để phép cộng ra đúng từng bit như duyệt cả danh sách).
        vt_theo_to: dict = defaultdict(list)
        for i, p in enumerate(phan):
            vt_theo_to[p[1]].append(i)
        for dep_id, moc in moc_tt.items():
            dep = pb.get(dep_id)
            if dep is None:
                continue
            nhanh = cay(dep_id)
            phan_nhanh = [phan[i] for i in sorted(i for t in nhanh for i in vt_theo_to.get(t, ()))]
            quy = sum(p[4] for p in phan_nhanh)
            if quy <= 0:
                continue
            ty_le = _so(moc.ty_le) / 100.0
            head = emp_cua_tk.get(int(dep.head_user_id)) if dep.head_user_id else None
            kieu = "ăn chia" if moc.che_do == TO_TRUONG_CHIA else "ăn thưởng"
            if head is None:
                canh_bao.append(f"Tổ {dep.name} khai tổ trưởng {kieu} {_so(moc.ty_le):g}% nhưng chưa "
                                f"có người đứng đầu tổ có hồ sơ nhân viên — chưa trích.")
                continue
            if so:
                # Phần tổ trưởng của TỪNG lần ghi — tính trên số TRƯỚC khi trích ở mốc này.
                theo_lan: dict[int, float] = defaultdict(float)
                for p in phan_nhanh:
                    theo_lan[p[3]] += p[4] * ty_le
                for bid, t in theo_lan.items():
                    if bid in so_ban_ghi:
                        so_ban_ghi[bid]["to_truong"].append({"dep_id": dep_id, "emp": head, "che_do": moc.che_do,
                                                         "ty_le": _so(moc.ty_le), "tien": t})
                so_tt.append({"dep_id": dep_id, "emp": head, "che_do": moc.che_do,
                              "ty_le": _so(moc.ty_le), "quy": quy, "tien": ty_le * quy})
            if moc.che_do == TO_TRUONG_CHIA:
                for p in phan_nhanh:
                    p[4] *= (1 - ty_le)
                    lan = ct_lan.get((p[0], p[3]))
                    if lan is not None:
                        lan["tien"] = round(p[4])
                        lan["to_truong"].append(_so(moc.ty_le))
            them_tt[head] += ty_le * quy
            chi_tiet[head].append({
                "loai": "to_truong", "to": dep.name, "tien_lan_ghi": round(quy), "ty_le": ty_le,
                "tien": round(ty_le * quy), "ghi_chu": kieu,
            })

        khoan: dict[int, float] = defaultdict(float)
        for p in phan:
            khoan[p[0]] += p[4]
        for emp, t in them_tt.items():
            khoan[emp] += t
        for emp, t in them_dm.items():
            khoan[emp] += t
        # Ngăn soi cộng các dòng ĐÃ làm tròn, cột lương làm tròn TỔNG ⇒ lệch ±1đ. Dòng lớn nhất gánh
        # phần lệch để hai bên ra cùng một số.
        for emp, ds in (chi_tiet.items() if theo_nguoi else ()):
            _khop_lam_tron([x for x in ds if x["loai"] != "tang_ca_khoan"], khoan.get(emp, 0.0))
            _khop_lam_tron([x for x in ds if x["loai"] == "tang_ca_khoan"], tang_ca.get(emp, 0.0))
        # --- Cộng thêm từng người: cộng thẳng vào lương, ngoài quỹ tổ và phép so ---------------
        ct_rows = self.repo.cong_them(year, month)
        cong_them: dict[int, float] = defaultdict(float)
        for r in ct_rows:
            if r.tien is not None:
                cong_them[int(r.employee_id)] += _so(r.tien)
        ra = {
            "khoan": {e: round(v) for e, v in khoan.items() if round(v) != 0},
            "cong_them": {e: round(v) for e, v in cong_them.items() if round(v) != 0},
            "tang_ca_khoan": {e: round(v) for e, v in tang_ca.items() if round(v) != 0},
            "thieu_gia": thieu,
            "canh_bao": canh_bao,
            "theo_nguoi": dict(chi_tiet) if theo_nguoi else {},
        }
        if so:
            for p in phan:
                if p[3] in so_ban_ghi:
                    so_ban_ghi[p[3]]["nguoi"][p[0]] = p[4]
            ra["so"] = {"lan_ghi": list(so_ban_ghi.values()), "dung_may": so_dm, "ngay": so_ngay,
                        "to_truong": so_tt,
                        "cong_them": [{"to_id": int(r.department_id), "emp": int(r.employee_id),
                                       "tien": None if r.tien is None else _so(r.tien), "ghi_chu": r.ghi_chu,
                                       "sua_boi_id": r.sua_boi_id, "sua_luc": r.sua_luc} for r in ct_rows]}
        return ra
