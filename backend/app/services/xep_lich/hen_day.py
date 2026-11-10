"""Bàn HẸN ĐẨY của Xếp lịch + vòng nền tự đẩy (08/11/2026, docs/design-go-toc-do-may-va-xep-lich.md).

Người điều phối hẹn giờ đẩy cho lệnh (`xep_lich_lenh.bat_dau_at`, giờ xưởng, đúng giờ người chọn,
không trải theo ca). Tới giờ, `quet_tu_day` đẩy lệnh bằng ĐÚNG hàm phát hành của nút Đẩy ngay
(`XepLichLenhService.phat_hanh`) và bằng quyền của người hẹn. Đẩy không được thì lệnh "kẹt": ghi lý
do, người hẹn nhận thông báo, vòng sau không thử lại cho tới khi có người hẹn lại giờ.

Quy ước giờ: giờ hẹn là giờ tường của xưởng dán nhãn UTC (như mọi mốc lịch, `gio_xuong`); lúc đẩy
(`created_at` của gói) và lúc kẹt là UTC thật, đổi sang giờ xưởng khi trả ra.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy.orm import Session

from ...models.lsx import LB_THUE_NGOAI
from ...models.xep_lich_lenh import XepLichLenh
from ...repositories.xep_lich_hen_repo import DongNhe, XepLichHenRepository
from ...repositories.xep_lich_lenh_repo import XepLichLenhRepository
from ..gio_xuong import gio_xuong, ve_gio_xuong, ve_utc_that
from . import sau_phat_hanh
from .service import TT_XEP_DUOC, XepLichLenhError, XepLichLenhService

log = logging.getLogger(__name__)

TAB = ("ket", "chua_hen", "da_hen", "da_day")
KHOANG_TOI_DA = 92
SAT_HAN_NGAY = 2
KET_MAT_QUYEN = "Người hẹn không còn quyền đẩy lệnh"

HANH_DONG_HEN = ("xep_lich_hen_day", "xep_lich_doi_gio_hen", "xep_lich_bo_hen",
                 "xep_lich_tu_day", "xep_lich_tu_day_ket")
#: Tên việc ở tab Lịch sử hẹn. Năm mã mới đọc nhãn chung của Nhật ký; hai mã cũ của Xếp lịch đổi
#: chữ cho đúng nghĩa trên bàn hẹn đẩy.
_VIEC_RIENG = {"xep_lich_phat_hanh": "Đẩy ngay", "xep_lich_go_phat_hanh": "Thu hồi về chờ đẩy"}

_DEN_OK = "ok"
_MUC_DONG = {"xanh": "ok", "xam": "ok", "vang": "vang", "khong_ro": "vang", "do": "do"}


class HenDayError(Exception):
    """Lỗi người dùng sửa được — 400."""


class HenDayNotFound(HenDayError):
    """Không có lệnh / không có hẹn — 404."""


# ---------------------------------------------------------------- giờ
def gio_hen_tu_client(dt: datetime) -> datetime:
    """Giờ hẹn từ màn → giờ xưởng dán nhãn UTC. Ô chọn giờ gửi naive (đã là giờ xưởng); chuỗi kèm
    offset thì quy về giờ xưởng."""
    if dt.tzinfo is None:
        d = dt.replace(tzinfo=timezone.utc)
    else:
        d = ve_gio_xuong(dt.astimezone(timezone.utc))
    return d.replace(second=0, microsecond=0)


def _gio_xuong_cua(dt: datetime | None) -> datetime | None:
    """Giờ hẹn đọc từ DB (SQLite trả naive) → aware nhãn UTC để so sánh."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _ra(dt: datetime | None) -> datetime | None:
    return dt.replace(tzinfo=None) if dt is not None else None


def _fmt(dt: datetime | None) -> str:
    return _gio_xuong_cua(dt).strftime("%d/%m/%Y %H:%M") if dt is not None else "—"


def kiem_khoang(tu: date, den: date) -> None:
    if den < tu:
        raise HenDayError("Ngày cuối phải sau ngày đầu.")
    if (den - tu).days > KHOANG_TOI_DA:
        raise HenDayError(f"Khoảng ngày tối đa {KHOANG_TOI_DA} ngày.")


def _bo_tien_to(chi_tiet: str | None) -> str | None:
    """Nhật ký ghi "Lệnh LSX…: …" để đọc được ở Nhật ký hệ thống; trong ngăn của chính lệnh đó
    thì tiền tố thừa."""
    if not chi_tiet:
        return None
    if chi_tiet.startswith("Lệnh ") and ": " in chi_tiet:
        return chi_tiet.split(": ", 1)[1] or None
    return chi_tiet


# ---------------------------------------------------------------- đèn vật tư
def den_vat_tu(db: Session, lsx_ids: list[int]) -> dict[int, dict]:
    """`{lsx_id: {muc, chu, ve}}` cho tập lệnh chưa đẩy — CÙNG nguồn đèn Vật tư màn Lệnh SX
    (`lsx_tong_quan.den_vat_tu_va_bang`). Bảng cân đối là thứ đắt nhất của bàn nên đi qua đệm
    `can_doi_cache` (khoá theo tập id, tự xoá khi kho/mua/phát hành đổi).

    `ve`: ngày phiếu mua về cho món còn thiếu. Mỗi món lấy phiếu về SỚM nhất; cả lệnh lấy món về
    MUỘN nhất (lệnh chỉ đủ khi món cuối về). Có món thiếu mà chưa phiếu nào ghi ngày về ⇒ None."""
    from ..can_doi_cache import lay_hoac_tinh
    from ..lsx_tong_quan import den_vat_tu_va_bang

    ids = sorted({int(i) for i in lsx_ids if i})
    if not ids:
        return {}

    def tinh() -> dict:
        den, bang = den_vat_tu_va_bang(db, ids)
        ve: dict[int, date | None] = {}
        mat_ngay: set[int] = set()
        for g in (bang or {}).get("items") or []:
            ngay = [p.get("ngay_ve") for p in g.get("phieu_mua") or [] if p.get("ngay_ve")]
            som = min(ngay) if ngay else None
            for d in g.get("dong") or []:
                lid = d.get("lsx_id")
                if lid not in den or d.get("trang_thai") not in ("vang", "do"):
                    continue
                if som is None:
                    mat_ngay.add(lid)
                elif ve.get(lid) is None or som > ve[lid]:
                    ve[lid] = som
        return {"den": {str(i): {
            "muc": (den.get(i) or {}).get("muc") or _DEN_OK,
            "chu": (den.get(i) or {}).get("chu") or "",
            "ve": (ve[i].isoformat() if (i in ve and i not in mat_ngay and ve[i]) else None),
        } for i in ids}}

    kq = lay_hoac_tinh(tinh, loai="xep_lich_ban", lsx_ids=ids)
    return {int(k): v for k, v in kq["den"].items()}


# ---------------------------------------------------------------- service
class HenDayService:
    def __init__(self, db: Session, audit=None) -> None:
        self.db = db
        self.audit = audit
        self.repo = XepLichHenRepository(db)
        self.lenh_repo = XepLichLenhRepository(db)

    # ------------------------------------------------------------ bàn
    def _chia_tab(self, ds: list[DongNhe], tu: date, den: date) -> dict[str, list[DongNhe]]:
        """`tu`/`den` lọc giờ hẹn của tab Đã hẹn; tab Đã đẩy đã lọc theo lúc đẩy ở truy vấn."""
        hen_tu = datetime.combine(tu, time.min, tzinfo=timezone.utc)
        hen_den = datetime.combine(den + timedelta(days=1), time.min, tzinfo=timezone.utc)
        nhom: dict[str, list[DongNhe]] = {t: [] for t in TAB}
        for d in ds:
            if d.trang_thai not in TT_XEP_DUOC:
                nhom["da_day"].append(d)
            elif d.hen_luc is None:
                nhom["chua_hen"].append(d)
            elif d.ket_ly_do:
                nhom["ket"].append(d)
            elif hen_tu <= _gio_xuong_cua(d.hen_luc) < hen_den:
                nhom["da_hen"].append(d)
        return nhom

    def _nap(self, *, tu: date, den: date, tim: str | None, day_tu: date | None = None,
             day_den: date | None = None):
        """Tab Đã hẹn xem theo `tu`/`den`, tab Đã đẩy theo khoảng riêng `day_tu`/`day_den` (mockup B:
        Đã hẹn mở từ hôm nay tới, Đã đẩy từ hôm nay lùi lại). Hai khoảng tách nhau để số trên MỌI tab
        đúng bằng số dòng khi bấm vào tab đó, dù đang đứng ở tab nào. Thiếu khoảng riêng thì dùng chung."""
        day_tu, day_den = day_tu or tu, day_den or den
        kiem_khoang(tu, den)
        kiem_khoang(day_tu, day_den)
        ds = self.repo.dong_nhe(
            cho_day=TT_XEP_DUOC, tim=tim,
            day_tu=ve_utc_that(datetime.combine(day_tu, time.min, tzinfo=timezone.utc)),
            day_den=ve_utc_that(datetime.combine(day_den + timedelta(days=1), time.min,
                                                 tzinfo=timezone.utc)))
        nhom = self._chia_tab(ds, tu, den)
        den_vt = den_vat_tu(self.db, [d.id for t in ("ket", "chua_hen", "da_hen") for d in nhom[t]])
        return nhom, den_vt

    @staticmethod
    def _sat(d: DongNhe, hom_nay: date) -> bool:
        return d.han_giao_khach is not None and (d.han_giao_khach - hom_nay).days <= SAT_HAN_NGAY

    @staticmethod
    def _thieu(d: DongNhe, tab: str, den_vt: dict) -> bool:
        return tab != "da_day" and (den_vt.get(d.id) or {}).get("muc", _DEN_OK) != _DEN_OK

    def _qua_loc(self, d, tab, den_vt, hom_nay, *, gap, thieu_vat_tu, sat_han) -> bool:
        if gap and not d.is_rush:
            return False
        if sat_han and not self._sat(d, hom_nay):
            return False
        return not (thieu_vat_tu and not self._thieu(d, tab, den_vt))

    @staticmethod
    def _xep(ds: list[DongNhe], tab: str) -> list[DongNhe]:
        if tab == "da_hen":
            return sorted(ds, key=lambda d: (not d.is_rush, _gio_xuong_cua(d.hen_luc), d.id))
        if tab == "da_day":
            xa = datetime.min.replace(tzinfo=timezone.utc)
            ds = sorted(ds, key=lambda d: d.id)
            ds = sorted(ds, key=lambda d: _gio_xuong_cua(d.da_day_luc) or xa, reverse=True)
            return sorted(ds, key=lambda d: not d.is_rush)
        return sorted(ds, key=lambda d: (not d.is_rush, d.han_giao_khach is None,
                                         d.han_giao_khach or date.max, d.id))

    def _loc_tab(self, *, tab, tu, den, tim, gap, thieu_vat_tu, sat_han, hom_nay, day_tu=None,
                 day_den=None):
        if tab not in TAB:
            raise HenDayError("Tab không hợp lệ.")
        hom_nay = hom_nay or gio_xuong().date()
        nhom, den_vt = self._nap(tu=tu, den=den, tim=tim, day_tu=day_tu, day_den=day_den)
        loc = dict(gap=gap, thieu_vat_tu=thieu_vat_tu, sat_han=sat_han)
        con = {t: [d for d in nhom[t] if self._qua_loc(d, t, den_vt, hom_nay, **loc)] for t in TAB}
        return nhom, con, den_vt, hom_nay

    def ids_theo_loc(self, *, tab: str, tu: date, den: date, tim: str | None = None,
                     gap: bool = False, thieu_vat_tu: bool = False, sat_han: bool = False,
                     hom_nay: date | None = None, day_tu: date | None = None,
                     day_den: date | None = None) -> list[int]:
        _n, con, _d, _h = self._loc_tab(tab=tab, tu=tu, den=den, tim=tim, gap=gap,
                                        thieu_vat_tu=thieu_vat_tu, sat_han=sat_han, hom_nay=hom_nay,
                                        day_tu=day_tu, day_den=day_den)
        return [d.id for d in self._xep(con[tab], tab)]

    def ban(self, *, tab: str, tu: date, den: date, tim: str | None = None, gap: bool = False,
            thieu_vat_tu: bool = False, sat_han: bool = False, trang: int = 1,
            moi_trang: int = 25, hom_nay: date | None = None, day_tu: date | None = None,
            day_den: date | None = None) -> dict:
        nhom, con, den_vt, hom_nay = self._loc_tab(
            tab=tab, tu=tu, den=den, tim=tim, gap=gap, thieu_vat_tu=thieu_vat_tu,
            sat_han=sat_han, hom_nay=hom_nay, day_tu=day_tu, day_den=day_den)
        goc = nhom[tab]
        ds = self._xep(con[tab], tab)
        dem_ngay: dict[str, int] = {}
        for d in con["da_hen"]:
            k = _gio_xuong_cua(d.hen_luc).date().isoformat()
            dem_ngay[k] = dem_ngay.get(k, 0) + 1
        trang = max(1, trang)
        trang_nay = ds[(trang - 1) * moi_trang: trang * moi_trang]
        return {
            "dong": self._dong_day_du(trang_nay, den_vt),
            "tong": len(ds),
            "dem_tab": {t: len(con[t]) for t in TAB},
            "dem_loc": {"gap": sum(d.is_rush for d in goc),
                        "thieu_vat_tu": sum(self._thieu(d, tab, den_vt) for d in goc),
                        "sat_han": sum(self._sat(d, hom_nay) for d in goc)},
            "dem_ngay": dict(sorted(dem_ngay.items())),
        }

    def _dong_day_du(self, ds: list[DongNhe], den_vt: dict) -> list[dict]:
        if not ds:
            return []
        ids = [d.id for d in ds]
        lenh = self.repo.lenh_va_khach(ids)
        ten = self.repo.ten_nguoi(d.nguoi_hen_id for d in ds)
        cum_id: dict[int, int] = {}
        for c in self.lenh_repo.cum_lien_thong(ids):
            if len(c) >= 2:
                for i in c:
                    cum_id[i] = min(c)
        ra = []
        for d in ds:
            l, khach = lenh[d.id]
            vt = den_vt.get(d.id) if d.trang_thai in TT_XEP_DUOC else None
            ra.append({
                "lsx_id": d.id, "ma": d.ma, "ten": l.ten, "customer_name": khach,
                "trang_thai": d.trang_thai,
                "is_rush": d.is_rush, "so_luong_dat": l.so_luong_dat, "don_vi_tinh": l.don_vi_tinh,
                "han_giao_khach": d.han_giao_khach,
                "hen_luc": _ra(_gio_xuong_cua(d.hen_luc)),
                "nguoi_hen": ten.get(d.nguoi_hen_id) if d.nguoi_hen_id else None,
                "da_day_luc": _ra(ve_gio_xuong(d.da_day_luc)),
                "ket_ly_do": d.ket_ly_do,
                "ket_luc": _ra(ve_gio_xuong(d.ket_luc)),
                "vat_tu": {"muc": vt["muc"], "chu": vt["chu"]} if vt else None,
                "vat_tu_ve": date.fromisoformat(vt["ve"]) if vt and vt.get("ve") else None,
                "cum_id": cum_id.get(d.id),
                "updated_at": l.updated_at,
            })
        return ra

    # ------------------------------------------------------------ ghi
    def hen(self, lsx_ids: list[int], hen_luc: datetime, *, actor,
            bay_gio: datetime | None = None) -> int:
        ids = [int(i) for i in dict.fromkeys(lsx_ids) if i]
        if not ids:
            raise HenDayError("Chưa chọn lệnh nào.")
        luc = gio_hen_tu_client(hen_luc)
        if luc <= (_gio_xuong_cua(bay_gio) or gio_xuong()):
            raise HenDayError("Giờ hẹn phải sau bây giờ.")
        lenh = self.lenh_repo.lsx_theo_ids(ids)
        thieu = [i for i in ids if i not in lenh]
        if thieu:
            raise HenDayNotFound(f"Không tìm thấy lệnh #{thieu[0]}.")
        sai = [lenh[i].ma for i in ids if lenh[i].trang_thai not in TT_XEP_DUOC]
        if sai:
            raise HenDayError(f"LSX {', '.join(sai[:5])} chưa sẵn sàng hoặc đã đẩy.")
        hang = self.lenh_repo.theo_nhieu_lsx(ids)
        for i in ids:
            r = hang.get(i)
            if r is None:
                self.db.add(XepLichLenh(lsx_id=i, bat_dau_at=luc, created_by=actor.id,
                                        nguoi_hen_id=actor.id))
                viec, chi_tiet = "xep_lich_hen_day", _fmt(luc)
            else:
                viec, chi_tiet = "xep_lich_doi_gio_hen", f"{_fmt(r.bat_dau_at)} sang {_fmt(luc)}"
                r.bat_dau_at, r.nguoi_hen_id, r.ket_ly_do, r.ket_luc = luc, actor.id, None, None
            self._vet(actor.id, viec, i, f"Lệnh {lenh[i].ma}: {chi_tiet}")
        self.db.commit()
        return len(ids)

    def bo_hen(self, lsx_id: int, *, actor) -> None:
        r = self.lenh_repo.theo_lsx(lsx_id)
        if r is None:
            raise HenDayNotFound("Lệnh chưa có giờ hẹn.")
        l = self.lenh_repo.lsx_theo_ids([lsx_id]).get(lsx_id)
        if l is not None and l.trang_thai not in TT_XEP_DUOC:
            raise HenDayError(f"Lệnh {l.ma} đã đẩy, không còn giờ hẹn để bỏ.")
        self._vet(actor.id, "xep_lich_bo_hen", lsx_id,
                  f"Lệnh {getattr(l, 'ma', lsx_id)}: {_fmt(r.bat_dau_at)}")
        self.db.delete(r)
        self.db.commit()

    def day_ngay(self, lsx_ids: list[int], *, actor) -> dict:
        """Đẩy lần lượt. Lệnh đã theo cụm của lệnh trước xuống xưởng thì tính là đã đẩy, không báo
        lỗi; lỗi của từng lệnh gom vào `loi`, lệnh khác vẫn đi."""
        svc = XepLichLenhService(self.db, self.lenh_repo, self.audit)
        da_day: list[str] = []
        loi: list[dict] = []
        vat_tu = {"so_yeu_cau": 0, "bo_qua": []}
        theo_cum: set[int] = set()
        for i in [int(x) for x in dict.fromkeys(lsx_ids) if x]:
            if i in theo_cum:
                continue
            try:
                kq = svc.phat_hanh(i, actor=actor)
            except XepLichLenhError as exc:
                self.db.rollback()
                l = self.lenh_repo.lsx_theo_ids([i]).get(i)
                loi.append({"ma": getattr(l, "ma", f"#{i}"), "ly_do": str(exc)})
                continue
            sau_phat_hanh.bao(self.db, kq, actor_id=actor.id)
            theo_cum |= set(kq["cum_lsx"])
            da_day.append(kq["ma"])
            vat_tu["so_yeu_cau"] += kq["vat_tu"]["so_yeu_cau"]
            vat_tu["bo_qua"] += kq["vat_tu"]["bo_qua"]
        con = [i for i in dict.fromkeys(int(x) for x in lsx_ids if x) if i in theo_cum]
        ma = {l.id: l.ma for l in self.lenh_repo.lsx_theo_ids(con).values()}
        da_day = list(dict.fromkeys(da_day + [ma[i] for i in con if i in ma]))
        return {"da_day": da_day, "loi": loi, "vat_tu": vat_tu}

    def _vet(self, actor_id, viec: str, lsx_id: int, chi_tiet: str) -> None:
        if self.audit is not None:
            self.audit.create(actor_user_id=actor_id, action=viec, target=f"lsx:{lsx_id}",
                              detail=chi_tiet, commit=False)

    # ------------------------------------------------------------ ngăn
    def lich_su_hen(self, lsx_id: int) -> list[dict]:
        from ...audit_registry import tra
        from ...repositories.audit_repo import AuditLogRepository

        if not self.lenh_repo.lsx_theo_ids([lsx_id]):
            raise HenDayNotFound("Không tìm thấy lệnh sản xuất.")
        logs = AuditLogRepository(self.db).list_by_targets(
            [f"lsx:{lsx_id}"], actions=[*HANH_DONG_HEN, *_VIEC_RIENG])[f"lsx:{lsx_id}"]
        ten = self.repo.ten_nguoi(a.actor_user_id for a in logs)
        return [{
            "luc": _ra(ve_gio_xuong(a.created_at)),
            "nguoi": ten.get(a.actor_user_id) if a.actor_user_id else "Hệ thống",
            "viec": _VIEC_RIENG.get(a.action) or tra(a.action).nhan,
            "chi_tiet": None if a.action == "xep_lich_phat_hanh" else _bo_tien_to(a.detail),
        } for a in logs]

    def ngan(self, lsx_id: int) -> dict:
        from ..lsx_tong_quan import den_vat_tu_va_bang
        from ..quyen_to import doc_cay
        from ..san_xuat.bo_phan import bo_phan_cua

        lenh = self.repo.lenh_va_khach([lsx_id])
        if lsx_id not in lenh:
            raise HenDayNotFound("Không tìm thấy lệnh sản xuất.")
        l, _k = lenh[lsx_id]
        r = self.lenh_repo.theo_lsx(lsx_id)
        d = DongNhe(l.id, l.ma, bool(l.is_rush), l.han_giao_khach, l.trang_thai,
                    r.bat_dau_at if r else None, r.ket_ly_do if r else None,
                    r.ket_luc if r else None, r.nguoi_hen_id if r else None,
                    None if l.trang_thai in TT_XEP_DUOC else self.repo.da_day_luc(lsx_id))
        den_vt = den_vat_tu(self.db, [lsx_id]) if l.trang_thai in TT_XEP_DUOC else {}
        dau = self._dong_day_du([d], den_vt)[0]

        vat_tu: list[dict] = []
        cds = self.repo.cong_doan(lsx_id)
        ma_dv = set()
        _den, bang = den_vat_tu_va_bang(self.db, [lsx_id])
        for g in (bang or {}).get("items") or []:
            dong = [x for x in g.get("dong") or [] if x.get("lsx_id") == lsx_id]
            if not dong:
                continue
            can = sum(float(x.get("nhu_cau") or 0) for x in dong)
            giu = sum(float(x.get("da_giu_kho") or 0) + float(x.get("da_giu_dang_ve") or 0)
                      for x in dong)
            mau = [x.get("trang_thai") for x in dong]
            muc = "do" if "do" in mau else ("vang" if any(_MUC_DONG.get(m) == "vang" for m in mau)
                                            else "ok")
            phieu = sorted((p for p in g.get("phieu_mua") or [] if p.get("ngay_ve")),
                           key=lambda p: p["ngay_ve"])
            if giu > 0 and giu + 1e-6 >= can:
                chu = "Đã giữ chỗ"
            elif muc == "ok":
                chu = "Đủ trong kho"
            elif phieu:
                chu = f"Về {phieu[0]['ngay_ve'].strftime('%d/%m')}"
            elif muc == "do":
                chu = "Thiếu"
            else:
                chu = next((x.get("ly_do_canh_bao") for x in dong if x.get("ly_do_canh_bao")),
                           None) or "Đang về"
            dv = g.get("don_vi_goc")
            if dv:
                ma_dv.add(dv)
            vat_tu.append({"ten": g.get("hang_ten") or g.get("hang_ma") or "", "can": round(can, 4),
                           "da_giu": round(giu, 4), "don_vi": dv, "muc": muc, "chu": chu,
                           "don_mua": (phieu[0]["ma"] if phieu else
                                       next((p.get("ma") for p in g.get("phieu_mua") or []), None))})
        ma_dv |= {c.don_vi_ra for c in cds if c.don_vi_ra}
        ten_dv = self.lenh_repo.ten_don_vi(sorted(ma_dv)) if ma_dv else {}
        for v in vat_tu:
            v["don_vi"] = ten_dv.get(v["don_vi"], v["don_vi"]) if v["don_vi"] else None

        cay = doc_cay(self.db)
        cong_doan = []
        for n, c in enumerate(cds, start=1):
            if c.loai_buoc == LB_THUE_NGOAI:
                bp = "Thuê ngoài"
            else:
                bp_id = bo_phan_cua(cay, c.department_id)
                bp = cay.ten.get(bp_id) if bp_id else None
            cong_doan.append({"buoc": n, "ten": c.ten, "bo_phan": bp,
                              "so_luong": float(c.so_luong_ra or 0),
                              "don_vi": ten_dv.get(c.don_vi_ra, c.don_vi_ra) if c.don_vi_ra else None})
        return {"dau": dau, "vat_tu": vat_tu, "cong_doan": cong_doan}


# ---------------------------------------------------------------- vòng nền
def _bao_ket(db: Session, r: XepLichLenh, ly_do: str, ma: str, bay_gio_that: datetime) -> None:
    from ...repositories.audit_repo import AuditLogRepository
    from ..thong_bao_man import bao

    r.ket_ly_do = ly_do
    r.ket_luc = bay_gio_that
    AuditLogRepository(db).create(actor_user_id=r.nguoi_hen_id, action="xep_lich_tu_day_ket",
                                  target=f"lsx:{r.lsx_id}",
                                  detail=f"Lệnh {ma}: {ly_do}", commit=False)
    db.commit()
    if r.nguoi_hen_id:
        bao(db, kenh="xep_lich", loai="tu_day_ket", actor_id=None, nguoi_nhan=[r.nguoi_hen_id],
            ma=ma)
    sau_phat_hanh.phat_lich_doi(r.lsx_id)


def quet_tu_day(bay_gio: datetime | None = None) -> int:
    """Đẩy mọi lệnh đã tới giờ hẹn. Trả số lệnh đã đẩy (kể cả lệnh đi theo cụm)."""
    from ...db import SessionLocal
    from ...repositories.audit_repo import AuditLogRepository
    from ...repositories.rbac_repo import RoleRepository
    from ..rbac_service import AuthorizationService

    now = _gio_xuong_cua(bay_gio) or gio_xuong()
    db = SessionLocal()
    da_day = 0
    try:
        repo = XepLichHenRepository(db)
        for lsx_id in repo.hang_toi_gio(now, TT_XEP_DUOC):
            try:
                r = repo.khoa_hang(lsx_id)
                l = XepLichLenhRepository(db).lsx_theo_ids([lsx_id]).get(lsx_id)
                if (r is None or l is None or r.ket_ly_do or l.trang_thai not in TT_XEP_DUOC
                        or _gio_xuong_cua(r.bat_dau_at) > now):
                    db.rollback()
                    continue
                nguoi = repo.nguoi(r.nguoi_hen_id)
                if (nguoi is None or not nguoi.is_active or not AuthorizationService(
                        RoleRepository(db)).can(nguoi, "xep_lich", "approve")):
                    _bao_ket(db, r, KET_MAT_QUYEN, l.ma, datetime.now(timezone.utc))
                    continue
                hen_luc, nguoi_id, ma = r.bat_dau_at, nguoi.id, l.ma
                try:
                    kq = XepLichLenhService(db, XepLichLenhRepository(db), None).phat_hanh(
                        lsx_id, actor=nguoi)
                except XepLichLenhError as exc:
                    db.rollback()
                    r = repo.khoa_hang(lsx_id)
                    if r is not None:
                        _bao_ket(db, r, str(exc), ma, datetime.now(timezone.utc))
                    continue
                AuditLogRepository(db).create(
                    actor_user_id=nguoi_id, action="xep_lich_tu_day", target=f"lsx:{lsx_id}",
                    detail=f"Lệnh {ma}: giờ hẹn {_fmt(hen_luc)}")
                sau_phat_hanh.bao(db, kq, actor_id=nguoi_id)
                da_day += len(kq["cum_lsx"])
            except Exception:  # noqa: BLE001 — một lệnh hỏng không chặn các lệnh sau
                db.rollback()
                log.exception("tu day lenh %s failed", lsx_id)
    finally:
        db.close()
    return da_day


async def run_tu_day_loop(interval: int = 60) -> None:
    """Vòng nền như `phieu_luong_mo`: chỉ worker giữ vai mới quét; nuốt lỗi để vòng sống tiếp."""
    from ...locks import giu_vai_chinh

    while True:
        await asyncio.sleep(interval)
        if not await asyncio.to_thread(giu_vai_chinh, "xep_lich_tu_day", ttl_ms=interval * 3000):
            continue
        try:
            await asyncio.to_thread(quet_tu_day)
        except Exception:  # noqa: BLE001
            log.exception("xep lich tu day loop scan failed")
