"""Tiền KHOÁN của một kỳ lương — đọc từ LẦN GHI sản lượng (21/10/2026).

Spec: `docs/superpowers/specs/2026-10-20-hai-luong-khoi-san-xuat-design.md`. Kết quả cộng vào vế
khoán của phép so hai lương (`PayrollService._compute`).

Mỗi lần ghi có cấu hình Khoán của công đoạn:

    tiền lần ghi = công thức khoán (biến của lần ghi: `sl_ghi`, `sl_tot`, `gia_co_dinh`, …)
                   — không khai công thức ⇒ `gia_co_dinh + sl_tot × don_gia`
                   — công thức không gọi chip `don_gia_khoan` ⇒ ra LƯỢNG, × đơn giá
                 + Σ việc phát sinh (số lượng × đơn giá của tổ)

Giá là ẢNH CHỤP giá của TỔ lúc ghi (`viec_khoan.chuan_hoa_khi_ghi`); thiếu giá / công thức lỗi thì
lần ghi vào `thieu_gia` kèm lý do — không đoán giá.

Giả định (plan 21/10/2026, chờ chủ duyệt):
  1. Tiền một lần ghi chia ĐỀU cho những người được tick ở lần ghi đó.
  2. Ngày của lần ghi = ngày giờ xưởng của giờ bắt đầu (`ngay_cua_me`).
  3. Chỉ tiêu ngày so với tiền GỐC của tổ trong ngày (trước nhân đôi CN trùng lễ); 50% phần vượt
     (= tăng ca khoán) chia theo tỷ lệ phần mỗi người hôm đó. Tổ chưa khai chỉ tiêu thì lấy mốc
     của tổ cha gần nhất.
  4. Tổ trưởng: mốc hiệu lực tại NGÀY CUỐI kỳ; quỹ = tiền sản lượng (đã áp luật ngày, chưa gồm
     tăng ca khoán) của tổ + mọi tổ con. Ăn chia: mọi phần × (1 − tỷ lệ), tổ trưởng + tỷ lệ × quỹ.
     Ăn thưởng: tổ trưởng + tỷ lệ × quỹ, không ai bị trừ.

Luật ngày: tổ in (`la_to_in`) bỏ sản lượng ngày CN / lễ (ngày đó ăn công ngoài phép so); tổ khác
ngày CN trùng lễ tính GẤP ĐÔI.
"""
from __future__ import annotations

import calendar as _cal
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..models.payroll import TO_TRUONG_CHIA, TO_TRUONG_THUONG
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.calendar_repo import CalendarRepository
from ..repositories.khoan_ky_repo import KhoanKyRepository
from .bien_cong_thuc import (
    MAC_DINH_TANG_LENH, cong_thuc_ra_tien, ngu_canh_lenh, quy_cach_bien, quy_cach_bien_bai,
)
from .calendar_service import CalendarService
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


class KhoanKyService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = KhoanKyRepository(db)
        self.cal = CalendarService(CalendarRepository(db), AuditLogRepository(db))

    # ------------------------------------------------------------------ tiền MỘT lần ghi
    def _quy_cach(self, cv, lenh: dict, bai_cache: dict) -> dict:
        if cv.lsx_id and int(cv.lsx_id) in lenh:
            return quy_cach_bien(lenh[int(cv.lsx_id)])
        if cv.bai_ghep_id:
            bid = int(cv.bai_ghep_id)
            if bid not in bai_cache:
                bai = self.repo.bai_ghep(bid)
                bai_cache[bid] = quy_cach_bien_bai(bai) if bai is not None else {}
            return bai_cache[bid]
        return {}

    @staticmethod
    def _tien_chinh(khoan, b, qc: dict) -> float:
        """Tiền phần chính của lần ghi; công thức lỗi ⇒ `ValueError` kèm câu lỗi."""
        don_gia = float(b.don_gia_khoan_snapshot)
        gia_cd = _so(b.gia_co_dinh_khoan_snapshot)
        tong, tot = _so(b.tong), _so(b.tot)
        ct = (khoan.cong_thuc_khoan or "").strip()
        if not ct:
            return gia_cd + tot * don_gia
        ctx = {**ngu_canh_lenh(qc), **MAC_DINH_TANG_LENH,
               "sl_vao": tong, "sl_ra": tot, "sl_ghi": tong, "sl_tot": tot,
               "gia_co_dinh": gia_cd, "don_gia_khoan": don_gia}
        v = safe_eval(ct, ctx)
        return v if cong_thuc_ra_tien(ct) else v * don_gia

    # ------------------------------------------------------------------ cả kỳ
    def tinh(self, year: int, month: int) -> dict:
        dau = date(year, month, 1)
        cuoi = date(year, month, _cal.monthrange(year, month)[1])
        # Lấy rộng một ngày mỗi đầu rồi lọc lại theo ngày giờ xưởng.
        tu = datetime.combine(dau - timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        den = datetime.combine(cuoi + timedelta(days=2), datetime.min.time(), tzinfo=timezone.utc)
        cap = [(b, cv) for b, cv in self.repo.lan_ghi_trong_khoang(tu, den)
               if (dd := ngay_cua_me(b.bat_dau)) is not None and dau <= dd <= cuoi]

        ids = [int(b.id) for b, _ in cap]
        nguoi = self.repo.nguoi_theo_lan_ghi(ids)
        phat_sinh = self.repo.phat_sinh_theo_lan_ghi(ids)
        khoan_map = self.repo.khoan_theo_id({int(b.khoan_cong_doan_id) for b, _ in cap})
        lenh = self.repo.lenh_theo_id({int(cv.lsx_id) for _, cv in cap if cv.lsx_id})
        pb = self.repo.phong_ban()
        le = {s.day for s in self.cal.paid_holidays_in_month(year, month)}
        bai_cache: dict = {}

        def ten_to(dep_id) -> str:
            d = pb.get(int(dep_id)) if dep_id else None
            return d.name if d is not None else "—"

        thieu: list[dict] = []
        canh_bao: list[str] = []
        # Phần của từng người từng lần ghi, ĐÃ áp luật ngày: [emp, tổ, ngày, batch_id, tiền].
        phan: list[list] = []
        chi_tiet: dict[int, list[dict]] = defaultdict(list)
        # Quỹ GỐC của tổ trong ngày và phần gốc của mỗi người — cho chỉ tiêu ngày.
        quy_ngay: dict[tuple[int, date], float] = defaultdict(float)
        phan_ngay: dict[tuple[int, date], dict[int, float]] = defaultdict(lambda: defaultdict(float))

        for b, cv in cap:
            d = ngay_cua_me(b.bat_dau)
            to = int(cv.department_id) if cv.department_id else None
            khoan = khoan_map.get(int(b.khoan_cong_doan_id))
            ten_cd = b.ten_khoan_snapshot or (khoan.cong_doan.ten if khoan is not None else "—")

            def bao(ly_do: str) -> None:
                thieu.append({"batch_id": int(b.id), "cong_doan": ten_cd, "to": ten_to(to),
                              "ngay": d.strftime("%d/%m"), "ly_do": ly_do})

            ds = nguoi.get(int(b.id)) or []
            if khoan is None:
                bao("cấu hình Khoán của công đoạn đã bị gỡ")
                continue
            if not ds:
                bao("chưa tick người làm")
                continue
            if b.don_gia_khoan_snapshot is None:
                bao("tổ chưa có giá ở bảng giá theo tổ")
                tien = 0.0
            else:
                try:
                    tien = self._tien_chinh(khoan, b, self._quy_cach(cv, lenh, bai_cache))
                except ValueError as e:
                    bao(f"công thức khoán lỗi — {e}")
                    tien = 0.0
            for r in phat_sinh.get(int(b.id)) or []:
                if r.don_gia_snapshot is None:
                    bao(f'việc phát sinh "{r.ten_snapshot}" chưa có giá của tổ')
                    continue
                tien += _so(r.so_luong) * float(r.don_gia_snapshot)
            if tien == 0:
                continue

            la_cn, la_le = self.cal.la_ngay_nghi_tuan(d), d in le
            to_in = bool(getattr(pb.get(to), "la_to_in", False)) if to else False
            if to_in and (la_cn or la_le):
                he_so, ghi_chu = 0.0, "tổ in ngày Chủ nhật / lễ — ngày đó ăn công, không tính sản lượng"
            elif la_cn and la_le:
                he_so, ghi_chu = 2.0, "Chủ nhật trùng lễ — sản lượng ×2"
            else:
                he_so, ghi_chu = 1.0, None
            moi = tien / len(ds)
            for r in ds:
                emp = int(r.employee_id)
                phan.append([emp, to, d, int(b.id), moi * he_so])
                chi_tiet[emp].append({
                    "loai": "lan_ghi", "batch_id": int(b.id), "ngay": d.isoformat(),
                    "cong_doan": ten_cd, "to": ten_to(to), "so_luong": _so(b.tong),
                    "tien_lan_ghi": round(tien), "so_nguoi": len(ds),
                    "tien": round(moi * he_so), "ghi_chu": ghi_chu,
                })
                if he_so > 0 and to is not None:
                    phan_ngay[(to, d)][emp] += moi
            if he_so > 0 and to is not None:
                quy_ngay[(to, d)] += tien

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
            if ct <= 0 or quy <= ct:
                continue
            them = 0.5 * (quy - ct)
            for emp, p in phan_ngay[(to, d)].items():
                t = them * p / quy
                tang_ca[emp] += t
                chi_tiet[emp].append({
                    "loai": "tang_ca_khoan", "ngay": d.isoformat(), "to": ten_to(to),
                    "tien": round(t),
                    "ghi_chu": f"tổ làm {_vnd(quy)} đ, chỉ tiêu {_vnd(ct)} đ/ngày — 50% phần vượt",
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
        for dep_id, moc in moc_tt.items():
            dep = pb.get(dep_id)
            if dep is None:
                continue
            nhanh = cay(dep_id)
            quy = sum(p[4] for p in phan if p[1] in nhanh)
            if quy <= 0:
                continue
            ty_le = _so(moc.ty_le) / 100.0
            head = emp_cua_tk.get(int(dep.head_user_id)) if dep.head_user_id else None
            kieu = "ăn chia" if moc.che_do == TO_TRUONG_CHIA else "ăn thưởng"
            if head is None:
                canh_bao.append(f"Tổ {dep.name} khai tổ trưởng {kieu} {_so(moc.ty_le):g}% nhưng chưa "
                                f"có người đứng đầu tổ có hồ sơ nhân viên — chưa trích.")
                continue
            if moc.che_do == TO_TRUONG_CHIA:
                tru: dict[int, float] = defaultdict(float)
                for p in phan:
                    if p[1] in nhanh:
                        tru[p[0]] += p[4] * ty_le
                        p[4] *= (1 - ty_le)
                for emp, t in tru.items():
                    chi_tiet[emp].append({
                        "loai": "to_truong_tru", "to": dep.name, "tien": -round(t),
                        "ghi_chu": f"trích {_so(moc.ty_le):g}% sản lượng cho tổ trưởng (ăn chia)",
                    })
            them_tt[head] += ty_le * quy
            chi_tiet[head].append({
                "loai": "to_truong", "to": dep.name, "tien": round(ty_le * quy),
                "ghi_chu": f"tổ trưởng {kieu} {_so(moc.ty_le):g}% × quỹ tổ {_vnd(quy)} đ",
            })

        khoan: dict[int, float] = defaultdict(float)
        for p in phan:
            khoan[p[0]] += p[4]
        for emp, t in them_tt.items():
            khoan[emp] += t
        return {
            "khoan": {e: round(v) for e, v in khoan.items() if round(v) != 0},
            "tang_ca_khoan": {e: round(v) for e, v in tang_ca.items() if round(v) != 0},
            "thieu_gia": thieu,
            "canh_bao": canh_bao,
            "theo_nguoi": dict(chi_tiet),
        }
