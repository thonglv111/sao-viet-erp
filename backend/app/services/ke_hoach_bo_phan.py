"""Kế hoạch bộ phận (07/11/2026, `docs/design-lenh-san-xuat-ke-hoach-bo-phan.md` §5–6, §11).

Phát lệnh đưa mỗi bước Nội bộ tới BỘ PHẬN NHẬN (`san_xuat_cong_viec.bo_phan_id`) với
`department_id = NULL` — chưa nhóm nào thấy. Người kế hoạch của bộ phận bấm Giao, chọn máy + nhóm
trong cùng một thao tác: việc mang `department_id` = nhóm và hiện ngay ở Việc của tổ. Không có bước
Xếp nháp, không có thứ tự chạy do kế hoạch sắp (08/11/2026, doc §11).

Trạng thái trên kế hoạch KHÔNG lưu riêng: ghép từ "đã giao chưa" của bộ phận và trạng thái chạy của
tổ (`trang_thai_ke_hoach`), nên tổ bấm Bắt đầu / Tạm dừng / Kết thúc là kế hoạch đổi theo.

Luật:
- Máy chỉ chọn trong máy của bộ phận chạy được công đoạn; nhóm chỉ chọn trong nhóm của bộ phận mà
  công đoạn có tick, và (công đoạn ràng buộc tổ) nhóm phải có máy đó.
- Máy theo báo giá (máy in của bài tính giá) là GỢI Ý. Chạy máy khác bắt buộc nhập lý do; ghi nhật
  ký của lệnh (máy theo báo giá, máy chạy, lý do, người giao — người lấy từ tài khoản).
- Việc đã giao mà nhóm chưa bắt đầu (chưa chạy, chưa ghi sản lượng) thì rút lại được.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..models.cong_doan import CongDoan
from ..models.san_xuat import (
    BUOC_MAY, BUOC_TO, CV_DANG_CHAY, CV_HOAN_THANH, CV_PHAT_HANH, CV_TAM_DUNG,
)
from ..models.san_xuat_thuc_thi import PC_DA_RUT
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.ke_hoach_bo_phan_repo import KeHoachBoPhanRepository
from ..repositories.may_to_repo import MayToRepository
from ..repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from .quyen_to import CayKhoi, doc_cay
from .san_xuat.bo_phan import danh_sach_bo_phan, nhom_cua_bo_phan

# Chip Hoàn thành của bảng việc chỉ giữ việc xong trong ngần này ngày — bảng không phình mãi.
NGAY_GIU_HOAN_THANH = 7

KH_CHUA_GIAO = "chua_giao"
KH_DA_GIAO = "da_giao"
KH_DANG_CHAY = "dang_chay"
KH_TAM_DUNG = "tam_dung"
KH_HOAN_THANH = "hoan_thanh"
_TRANG_THAI_KH = (KH_CHUA_GIAO, KH_DA_GIAO, KH_DANG_CHAY, KH_TAM_DUNG, KH_HOAN_THANH)
_TU_TO = {CV_PHAT_HANH: KH_DA_GIAO, CV_DANG_CHAY: KH_DANG_CHAY, CV_TAM_DUNG: KH_TAM_DUNG,
          CV_HOAN_THANH: KH_HOAN_THANH}


def trang_thai_ke_hoach(v) -> str:
    """Năm trạng thái của việc trên kế hoạch bộ phận — chữ Đang chạy, Tạm dừng, Hoàn thành trùng
    Việc của tổ. Chưa giao là của bộ phận; bốn cái sau đọc thẳng trạng thái tổ đang giữ."""
    if v.da_giao_at is None and v.trang_thai != CV_HOAN_THANH:
        return KH_CHUA_GIAO
    return _TU_TO.get(v.trang_thai, KH_DA_GIAO)


class KhbpLoi(ValueError):
    """Thao tác không hợp lệ (400)."""


class KhbpXungDot(ValueError):
    """Trạng thái đã đổi (409)."""


class KhbpCam(PermissionError):
    """Có Xem nhưng không có Giao việc ở bộ phận này (403)."""


class KhbpKhongThay(LookupError):
    """Không có việc / bộ phận, hoặc ngoài phạm vi (404)."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


class KeHoachBoPhanService:
    def __init__(self, db: Session, *, user, xem: set[int], giao: set[int] | None = None) -> None:
        """`xem` / `giao`: id bộ phận mà vai bật Xem / Giao việc ở dòng Kế hoạch của nó."""
        self.db = db
        self.user = user
        self.xem = set(xem)
        self.duoc_giao = set(giao or ())
        self.repo = KeHoachBoPhanRepository(db)
        self._cay: CayKhoi | None = None

    # ---------------- phạm vi ----------------

    @property
    def cay(self) -> CayKhoi:
        if self._cay is None:
            self._cay = doc_cay(self.db)
        return self._cay

    def bo_phan_thay_duoc(self) -> list[int]:
        """Bộ phận của cây mà vai bật Xem ở dòng Kế hoạch của nó (thứ tự theo cây)."""
        return [b for b in danh_sach_bo_phan(self.cay) if b in self.xem]

    def _gac(self, bo_phan_id: int | None, *, ghi: bool = False) -> int:
        if bo_phan_id is None or bo_phan_id not in self.bo_phan_thay_duoc():
            raise KhbpKhongThay("Không có bộ phận này trong phạm vi của bạn.")
        if ghi and int(bo_phan_id) not in self.duoc_giao:
            raise KhbpCam("Bạn chỉ được xem kế hoạch của bộ phận này, không được giao việc.")
        return int(bo_phan_id)

    def danh_sach(self) -> list[dict]:
        """Bộ phận người xem mở được, kèm người đó có Giao việc ở bộ phận không."""
        return [{"id": b, "ten": self.cay.ten.get(b, f"#{b}"), "tu_lam": self.cay.la(b),
                 "giao_duoc": b in self.duoc_giao}
                for b in self.bo_phan_thay_duoc()]

    # ---------------- đọc bảng ----------------

    def _cong_doan_cua(self, viec: list) -> dict[int, tuple[CongDoan | None, int | None]]:
        """`{cv.id: (công đoạn danh mục, máy theo báo giá của bước)}` — nạp theo lô."""
        bl = self.repo.buoc_lsx(v.lsx_cong_doan_id for v in viec if v.lsx_cong_doan_id)
        bb = self.repo.buoc_bai(v.bai_ghep_cong_doan_id for v in viec if v.bai_ghep_cong_doan_id)
        ra: dict[int, tuple[CongDoan | None, int | None]] = {}
        cds: dict[int, CongDoan | None] = {}
        for v in viec:
            buoc = (bl.get(v.lsx_cong_doan_id) if v.lsx_cong_doan_id
                    else bb.get(v.bai_ghep_cong_doan_id) if v.bai_ghep_cong_doan_id else None)
            cd_id = getattr(buoc, "cong_doan_id", None)
            if cd_id and cd_id not in cds:
                cds[cd_id] = self.db.get(CongDoan, cd_id)
            ra[v.id] = (cds.get(cd_id) if cd_id else None, getattr(buoc, "may_id", None))
        return ra

    def _lua_chon(self, bo_phan_id: int, cd: CongDoan | None, may_bp: list,
                  to_cua_may: dict[int, list[int]]) -> tuple[list[int], list[int]]:
        """(máy chọn được, nhóm chọn được) cho một việc của công đoạn `cd` ở bộ phận."""
        tick = cd.department_ids if cd is not None else []
        nhom = nhom_cua_bo_phan(self.cay, bo_phan_id, tick)
        may_cd = ({int(r.may_id) for r in cd.may_lam_duoc if r.may_id is not None}
                  if cd is not None else set())
        nhom_set = set(nhom)
        may = [m.id for m in may_bp
               if m.id in may_cd and nhom_set & set(to_cua_may.get(m.id, []))]
        return may, nhom

    @staticmethod
    def _nhom_goi_y(nhom_chon: list[int], may_id: int | None,
                    to_cua_may: dict[int, list[int]]) -> int | None:
        """Nhóm điền sẵn khi chỉ còn MỘT nhóm hợp lệ (bộ phận tự làm, hoặc máy chỉ thuộc một nhóm)."""
        ds = nhom_chon
        if may_id is not None:
            co_may = [n for n in nhom_chon if n in to_cua_may.get(int(may_id), [])]
            ds = co_may or nhom_chon
        return ds[0] if len(ds) == 1 else None

    def _dong_viec(self, bp: int, viec: list, may_bp: list,
                   to_cua_may: dict[int, list[int]]) -> tuple[list[dict], dict]:
        """Dòng việc của bảng (cùng dạng cho Kanban và bảng việc phân trang) + máy ngoài bộ phận
        mà các dòng nhắc tới (máy đã giao hoặc máy theo báo giá ở tổ khác)."""
        cd_cua = self._cong_doan_cua(viec)
        lenh = self.repo.lenh(v.lsx_id for v in viec if v.lsx_id)
        bai = self.repo.ma_bai(v.bai_ghep_id for v in viec if v.bai_ghep_id)
        may_ten = {m.id: m for m in may_bp}
        # Ngoặc bắt buộc: `-` ưu tiên hơn `|`, thiếu ngoặc thì máy của bộ phận lọt vào "máy ngoài".
        ngoai = self.repo.may(({v.may_id for v in viec} | {g for _c, g in cd_cua.values()})
                              - set(may_ten))
        tot = SanXuatSanLuongRepository(self.db).tong_tot_nhieu(
            [v.id for v in viec if v.trang_thai in (CV_DANG_CHAY, CV_TAM_DUNG, CV_HOAN_THANH)])
        ly_do = self.repo.ly_do_tam_dung([v.id for v in viec if v.trang_thai == CV_TAM_DUNG])

        ds = []
        # Máy, nhóm chọn được chỉ phụ thuộc công đoạn: tính một lần cho mỗi công đoạn, không mỗi việc.
        lua_chon: dict[int | None, tuple[list[int], list[int]]] = {}
        for v in viec:
            cd, goi_y = cd_cua[v.id]
            k = cd.id if cd is not None else None
            if k not in lua_chon:
                lua_chon[k] = self._lua_chon(bp, cd, may_bp, to_cua_may)
            may_chon, nhom_chon = lua_chon[k]
            l = lenh.get(v.lsx_id) if v.lsx_id else None
            qc = v.quy_cach_json or {}
            ds.append({
                "id": v.id, "version": v.version,
                "lsx_id": v.lsx_id, "lsx_ma": l[0].ma if l else None,
                "lsx_ten": l[0].ten if l else None,
                "bai_ghep_id": v.bai_ghep_id, "bai_ghep_ma": bai.get(v.bai_ghep_id),
                "khach_hang": l[1] if l else None,
                "han_giao": l[2].isoformat() if l and l[2] else None,
                "ten_cong_doan": v.ten_cong_doan, "nhom_cong_doan": v.nhom_cong_doan,
                "so_luong_vao": float(v.so_luong_vao) if v.so_luong_vao is not None else None,
                "so_luong_ra": float(v.so_luong_ra) if v.so_luong_ra is not None else None,
                "don_vi_vao": v.don_vi_vao, "don_vi_ra": v.don_vi_ra,
                # Số màu phủ giấy của quy cách (cùng ô "Số màu" trên thẻ quy cách của tổ).
                "so_mau": qc.get("so_mau"),
                "may_id": v.may_id, "may_goi_y_id": goi_y,
                "department_id": v.department_id,
                "department_ten": self.cay.ten.get(v.department_id) if v.department_id else None,
                # Nhóm điền sẵn cho lần Giao: nhóm cũ (việc vừa rút về) hoặc nhóm duy nhất hợp lệ.
                "nhom_goi_y_id": (v.nhom_xep_id if v.nhom_xep_id is not None
                                  else self._nhom_goi_y(nhom_chon, v.may_id or goi_y, to_cua_may)),
                # Lúc việc tới bộ phận (lệnh phát) — dòng "Tới …" dưới mã lệnh, mốc kỳ của bảng việc.
                "toi_luc": v.created_at.isoformat() if v.created_at else None,
                "da_giao_at": v.da_giao_at.isoformat() if v.da_giao_at else None,
                "trang_thai": v.trang_thai,
                "trang_thai_kh": trang_thai_ke_hoach(v),
                "da_lam": tot.get(v.id, 0.0) if v.trang_thai != CV_PHAT_HANH else None,
                "ly_do_tam_dung": ly_do.get(v.id),
                "hoan_thanh_luc": v.hoan_thanh_luc.isoformat() if v.hoan_thanh_luc else None,
                "may_chon": may_chon, "nhom_chon": nhom_chon,
            })
        return ds, ngoai

    def _may_bo_phan(self, bp: int) -> tuple[list, dict[int, list[int]]]:
        may_bp = self.repo.may_cua_to(self.cay.vung(bp))
        return may_bp, MayToRepository(self.db).to_cua_may([m.id for m in may_bp])

    def bang(self, bo_phan_id: int) -> dict:
        """Cả bộ phận cho Kanban và khay Giao: máy, nhóm, việc còn sống + việc xong trong
        `NGAY_GIU_HOAN_THANH` ngày. Bảng việc đọc `trang_viec` (lọc, đếm, cắt trang ở máy chủ)."""
        bp = self._gac(bo_phan_id)
        vung = self.cay.vung(bp)
        may_bp, to_cua_may = self._may_bo_phan(bp)
        viec = self.repo.viec_cua_bo_phan(bp, xong_tu=_now() - timedelta(days=NGAY_GIU_HOAN_THANH))
        ds, ngoai = self._dong_viec(bp, viec, may_bp, to_cua_may)
        return {
            "bo_phan": {"id": bp, "ten": self.cay.ten.get(bp), "tu_lam": self.cay.la(bp),
                        "giao_duoc": bp in self.duoc_giao},
            "nhom": [{"id": d, "ten": self.cay.ten.get(d)}
                     for d, _cap in self.cay.thu_tu() if d in vung and self.cay.la(d)] or
                    [{"id": bp, "ten": self.cay.ten.get(bp)}],
            "may": [{"id": m.id, "ma": m.ma, "ten": m.ten,
                     "nhom_ids": [t for t in to_cua_may.get(m.id, []) if t in vung],
                     "tinh_trang": tt}
                    for m, tt in zip(may_bp, self._tinh_trang_may(
                        may_bp, {v.may_id for v in viec if v.trang_thai == CV_DANG_CHAY and v.may_id}))],
            "may_ngoai": [{"id": m.id, "ma": m.ma, "ten": m.ten} for m in ngoai.values()],
            "viec": ds,
        }

    def trang_viec(self, bo_phan_id: int, *, trang_thai: str, tim: str | None = None,
                   tu_ngay=None, den_ngay=None, may_id: int | None = None, nhom_id: int | None = None,
                   trang: int = 1, co_trang: int = 25) -> dict:
        """Bảng việc: một trang ở chip `trang_thai` (`tat_ca` = mọi trạng thái), kèm tổng khớp và số
        ở từng chip (cùng tìm, kỳ, lọc). Việc Hoàn thành không giới hạn ngày ở đây — kỳ của thanh lọc
        lo phần đó. Kèm máy (nhóm, tình trạng, số việc chờ) và nhóm của bộ phận để chọn máy, nhóm
        ngay trên dòng mà không chờ bảng cả bộ phận (Kanban)."""
        bp = self._gac(bo_phan_id)
        if trang_thai != "tat_ca" and trang_thai not in _TRANG_THAI_KH:
            raise KhbpLoi("Trạng thái không hợp lệ.")
        loc = {"tim": (tim or "").strip() or None, "tu_ngay": tu_ngay, "den_ngay": den_ngay,
               "may_id": may_id, "nhom_id": nhom_id}
        co_trang = max(1, min(int(co_trang), 100))
        viec, tong = self.repo.trang_viec(bp, trang_thai=trang_thai, offset=(max(1, trang) - 1) * co_trang,
                                          limit=co_trang, **loc)
        dem = self.repo.dem_trang_thai(bp, **loc)
        may_bp, to_cua_may = self._may_bo_phan(bp)
        ds, ngoai = self._dong_viec(bp, viec, may_bp, to_cua_may)
        vung = self.cay.vung(bp)
        chay, cho = self.repo.viec_theo_may(bp)
        dem_tt = {k: dem.get(k, 0) for k in _TRANG_THAI_KH}
        return {
            "items": ds, "tong": tong, "trang": max(1, trang), "co_trang": co_trang,
            "dem": {**dem_tt, "tat_ca": sum(dem_tt.values())},
            "giao_duoc": bp in self.duoc_giao,
            "so_cho_lam_tay": cho.get(None, 0),
            "nhom": [{"id": d, "ten": self.cay.ten.get(d)}
                     for d, _cap in self.cay.thu_tu() if d in vung and self.cay.la(d)] or
                    [{"id": bp, "ten": self.cay.ten.get(bp)}],
            "may": [*({"id": m.id, "ma": m.ma, "ten": m.ten,
                       "nhom_ids": [t for t in to_cua_may.get(m.id, []) if t in vung],
                       "tinh_trang": tt, "so_cho": cho.get(m.id, 0)}
                      for m, tt in zip(may_bp, self._tinh_trang_may(may_bp, chay))),
                    *({"id": m.id, "ma": m.ma, "ten": m.ten} for m in ngoai.values())],
        }

    def _tinh_trang_may(self, may_bp: list, chay: set[int]) -> list[dict]:
        """Tình trạng lúc này của từng máy, cùng bộ chữ `may_trang_thai.NHAN`.

        Máy khoá, bảo trì, hỏng, có phiếu sửa: đọc `trang_thai_may`. "Đang chạy" thì KHÔNG đọc dòng
        Xếp lịch (lệnh nay phát không cần giờ) mà đọc việc của bộ phận tổ đang chạy trên máy."""
        from .may_trang_thai import NHAN, TT_DANG_CHAY, TT_RANH, trang_thai_may

        ids = [m.id for m in may_bp]
        tt = {k: x for k, x in trang_thai_may(self.db, ids, xep_lich=False).items()
              if x["trang_thai"] != TT_DANG_CHAY}
        ra = []
        for m in may_bp:
            ma = tt[m.id]["trang_thai"] if m.id in tt else (TT_DANG_CHAY if m.id in chay else TT_RANH)
            ra.append({"ma": ma, "nhan": NHAN[ma]})
        return ra

    @staticmethod
    def _ten_may(m) -> str | None:
        """Tên máy cho câu nhật ký — tên, không ghép mã (máy chưa đặt tên thì mới dùng mã)."""
        return (m.ten or m.ma) if m is not None else None

    # ---------------- ghi ----------------

    def _viec(self, cv_id: int, version: int | None, *, ghi: bool = False):
        v = self.repo.cong_viec(cv_id)
        if v is None or v.bo_phan_id is None:
            raise KhbpKhongThay("Không tìm thấy việc.")
        self._gac(v.bo_phan_id, ghi=ghi)
        if version is not None and int(version) != int(v.version):
            raise KhbpXungDot("Việc vừa được người khác sửa — tải lại rồi làm tiếp.")
        return v

    def _audit(self, v, action: str, detail: str) -> None:
        AuditLogRepository(self.db).create(
            actor_user_id=getattr(self.user, "id", None), action=action,
            target=f"lsx:{v.lsx_id}" if v.lsx_id else f"bai_ghep:{v.bai_ghep_id}",
            detail=detail, commit=False)

    def giao(self, cv_id: int, *, may_id: int | None, department_id: int | None,
             ly_do: str | None = None, version: int | None = None):
        """Giao một việc CHƯA GIAO: chọn máy (None = Làm tay) và nhóm trong cùng một thao tác, nhóm
        thấy việc ngay. Chạy khác máy theo báo giá phải có lý do, ghi vào nhật ký của lệnh.

        Không truyền nhóm thì lấy nhóm duy nhất hợp lệ (máy chỉ thuộc một nhóm); không suy được thì
        báo lỗi để người chọn."""
        from .san_xuat.thuc_thi import giao_ca_to

        v = self._viec(cv_id, version, ghi=True)
        if v.da_giao_at is not None:
            raise KhbpXungDot("Việc đã giao xuống nhóm.")
        if v.trang_thai != CV_PHAT_HANH:
            raise KhbpXungDot("Việc đã chạy, không giao lại được.")
        bp = int(v.bo_phan_id)
        vung = self.cay.vung(bp)
        may_bp = self.repo.may_cua_to(vung)
        to_cua_may = MayToRepository(self.db).to_cua_may([m.id for m in may_bp])
        cd, goi_y = self._cong_doan_cua([v])[v.id]
        may_chon, nhom_chon = self._lua_chon(bp, cd, may_bp, to_cua_may)
        if may_id is not None and int(may_id) not in may_chon and int(may_id) != goi_y:
            raise KhbpLoi("Máy này không thuộc bộ phận hoặc không chạy được công đoạn.")
        nhom = (int(department_id) if department_id is not None
                else self._nhom_goi_y(nhom_chon, may_id, to_cua_may))
        if nhom is None:
            raise KhbpLoi("Chọn nhóm làm việc này.")
        if nhom not in nhom_chon:
            raise KhbpLoi("Nhóm này không làm được công đoạn ở bộ phận.")
        if (may_id is not None and cd is not None and cd.department_ids
                and nhom not in to_cua_may.get(int(may_id), [])):
            raise KhbpLoi("Máy này không thuộc nhóm đã chọn.")
        ly_do = (ly_do or "").strip()
        if goi_y is not None and may_id != goi_y:
            if not ly_do:
                raise KhbpLoi("Chạy khác máy theo báo giá phải nhập lý do.")
            ten = self.repo.may({goi_y, may_id} - {None})
            moi = self._ten_may(ten.get(may_id)) or "Làm tay"
            goc = self._ten_may(ten.get(goi_y))
            self._audit(v, "kh_bo_phan_doi_may",
                        f"{v.ten_cong_doan}: chạy {moi} thay máy theo báo giá {goc}. "
                        f"Lý do: {ly_do[:300]}")
        v.may_id = may_id
        v.department_id = nhom
        v.nhom_xep_id = nhom
        v.loai_buoc = BUOC_MAY if may_id else BUOC_TO
        v.da_giao_at = _now()
        v.da_giao_by_id = getattr(self.user, "id", None)
        v.version += 1
        self.db.flush()
        giao_ca_to(self.db, v)
        self._audit(v, "kh_bo_phan_giao", f"Giao «{v.ten_cong_doan}» cho {self.cay.ten.get(nhom)}")
        self.db.commit()
        return v

    def rut(self, cv_id: int, version: int | None = None) -> dict:
        """Rút việc đã giao về bộ phận — chỉ khi tổ chưa bấm Bắt đầu. Máy và nhóm cũ giữ lại để
        lần Giao sau điền sẵn."""
        v = self._viec(cv_id, version, ghi=True)
        if v.da_giao_at is None:
            raise KhbpXungDot("Việc chưa giao.")
        if v.trang_thai != CV_PHAT_HANH or self.repo.da_ghi_san_luong(v.id):
            raise KhbpXungDot("Nhóm đã bắt đầu làm — không rút lại được.")
        nhom_cu = v.department_id
        for pc in self.repo.phan_cong_hoat_dong(v.id):
            pc.trang_thai = PC_DA_RUT
            pc.ly_do_rut = "Bộ phận rút việc về để giao lại."
            pc.version += 1
        v.nhom_xep_id = nhom_cu
        v.department_id = None
        v.da_giao_at = None
        v.da_giao_by_id = None
        v.version += 1
        self._audit(v, "kh_bo_phan_rut",
                    f"Rút «{v.ten_cong_doan}» khỏi {self.cay.ten.get(nhom_cu)} về bộ phận")
        self.db.commit()
        return {"id": v.id, "version": v.version, "nhom_cu": nhom_cu, "bo_phan_id": v.bo_phan_id}

    # ---------------- ngăn chi tiết (cùng ngăn của Việc của tổ, chỉ xem) ----------------

    def chi_tiet(self, cv_id: int, authz) -> dict:
        """Ngăn của Việc của tổ cho việc của bộ phận. Gác theo BỘ PHẬN (việc chưa giao chưa có tổ),
        quyền ghi trả rỗng nên mọi nút của tổ khoá."""
        from .san_xuat.board import chi_tiet_cong_viec

        self._viec(cv_id, None)
        return chi_tiet_cong_viec(self.db, self.user, authz, cong_viec_id=cv_id, chi_xem=True)

    def lich_su(self, cv_id: int) -> dict:
        from .san_xuat.lich_su_viec import lich_su

        self._viec(cv_id, None)
        return lich_su(self.db, self.user, cong_viec_id=cv_id, chi_xem=True)

    def tep(self, cv_id: int) -> list[dict]:
        """Tệp của (các) lệnh mà việc thuộc về — dùng lại `tep_lenh._nhom_tep`."""
        from ..repositories.san_xuat_repo import SanXuatRepository
        from .san_xuat.tep_lenh import _nhom_tep

        v = self._viec(cv_id, None)
        repo = SanXuatRepository(self.db)
        lsx_ids = repo.lsx_ids_cua_bai_ghep({v.bai_ghep_id}) if v.bai_ghep_id else {v.lsx_id}
        return _nhom_tep(self.db, repo, lsx_ids)
