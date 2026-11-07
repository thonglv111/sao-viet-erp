"""Kế hoạch bộ phận (07/11/2026, `docs/design-lenh-san-xuat-ke-hoach-bo-phan.md` §5–6).

Phát lệnh đưa mỗi bước Nội bộ tới khay của BỘ PHẬN NHẬN (`san_xuat_cong_viec.bo_phan_id`) với
`department_id = NULL` — chưa nhóm nào thấy. Người kế hoạch của bộ phận chọn máy + nhóm, xếp thứ tự
chạy, rồi bấm Giao: lúc đó việc mới mang `department_id` = nhóm và hiện ở Việc của tổ.

Luật:
- Máy chỉ chọn trong máy của bộ phận chạy được công đoạn; nhóm chỉ chọn trong nhóm của bộ phận mà
  công đoạn có tick, và (công đoạn ràng buộc tổ) nhóm phải có máy đó.
- Máy in từ bài tính giá là GỢI Ý. Đổi sang máy khác bắt buộc nhập lý do; mỗi lần đổi ghi nhật ký
  của lệnh (máy cũ, máy mới, lý do, người đổi — người lấy từ tài khoản).
- Việc đã giao mà nhóm chưa bắt đầu (chưa chạy, chưa ghi sản lượng) thì rút lại được.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..models.cong_doan import CongDoan
from ..models.role import SCOPE_ALL
from ..models.san_xuat import BUOC_MAY, BUOC_TO, CV_HOAN_THANH, CV_PHAT_HANH
from ..models.san_xuat_thuc_thi import PC_DA_RUT
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.ke_hoach_bo_phan_repo import KeHoachBoPhanRepository
from ..repositories.may_to_repo import MayToRepository
from .quyen_to import CayKhoi, doc_cay
from .san_xuat.bo_phan import bo_phan_cua, danh_sach_bo_phan, nhom_cua_bo_phan

MODULE = "ke_hoach_bo_phan"


class KhbpLoi(ValueError):
    """Thao tác không hợp lệ (400)."""


class KhbpXungDot(ValueError):
    """Trạng thái đã đổi (409)."""


class KhbpKhongThay(LookupError):
    """Không có việc / bộ phận, hoặc ngoài phạm vi (404)."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


class KeHoachBoPhanService:
    def __init__(self, db: Session, *, user, scope: str | None) -> None:
        self.db = db
        self.user = user
        self.scope = scope or "own"
        self.repo = KeHoachBoPhanRepository(db)
        self._cay: CayKhoi | None = None

    # ---------------- phạm vi ----------------

    @property
    def cay(self) -> CayKhoi:
        if self._cay is None:
            self._cay = doc_cay(self.db)
        return self._cay

    def bo_phan_thay_duoc(self) -> list[int]:
        """Phạm vi Tất cả ⇒ mọi bộ phận; còn lại ⇒ bộ phận chứa phòng của người xem, hoặc các bộ
        phận nằm dưới phòng của họ (người ngồi ở phòng gốc Sản xuất)."""
        ds = danh_sach_bo_phan(self.cay)
        if self.scope == SCOPE_ALL:
            return ds
        did = getattr(self.user, "department_id", None)
        if did is None:
            return []
        cua = bo_phan_cua(self.cay, did)
        if cua is not None:
            return [cua]
        return [b for b in ds if self.cay.la_to_tien(did, b)]

    def _gac(self, bo_phan_id: int | None) -> int:
        if bo_phan_id is None or bo_phan_id not in self.bo_phan_thay_duoc():
            raise KhbpKhongThay("Không có bộ phận này trong phạm vi của bạn.")
        return int(bo_phan_id)

    def danh_sach(self) -> list[dict]:
        return [{"id": b, "ten": self.cay.ten.get(b, f"#{b}"), "tu_lam": self.cay.la(b)}
                for b in self.bo_phan_thay_duoc()]

    # ---------------- đọc bảng ----------------

    def _cong_doan_cua(self, viec: list) -> dict[int, tuple[CongDoan | None, int | None]]:
        """`{cv.id: (công đoạn danh mục, máy gợi ý của bước)}` — nạp theo lô."""
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

    def bang(self, bo_phan_id: int) -> dict:
        bp = self._gac(bo_phan_id)
        vung = self.cay.vung(bp)
        may_bp = self.repo.may_cua_to(vung)
        to_cua_may = MayToRepository(self.db).to_cua_may([m.id for m in may_bp])
        viec = self.repo.viec_cua_bo_phan(bp)
        cd_cua = self._cong_doan_cua(viec)
        lenh = self.repo.lenh(v.lsx_id for v in viec if v.lsx_id)
        bai = self.repo.ma_bai(v.bai_ghep_id for v in viec if v.bai_ghep_id)
        may_ten = {m.id: m for m in may_bp}
        # Ngoặc bắt buộc: `-` ưu tiên hơn `|`, thiếu ngoặc thì máy của bộ phận lọt vào "máy ngoài".
        ngoai = self.repo.may(({v.may_id for v in viec} | {g for _c, g in cd_cua.values()})
                              - set(may_ten))
        may_ten.update(ngoai)
        khau = self._khau_truoc(viec)

        ds = []
        for v in viec:
            cd, goi_y = cd_cua[v.id]
            may_chon, nhom_chon = self._lua_chon(bp, cd, may_bp, to_cua_may)
            l = lenh.get(v.lsx_id) if v.lsx_id else None
            dm = v.dinh_muc_json or {}
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
                "chay_phut": dm.get("chay_phut"), "setup_phut": dm.get("setup_phut"),
                "may_id": v.may_id, "may_goi_y_id": goi_y,
                "may_goi_y_ten": self._ten_may(may_ten.get(goi_y)),
                "department_id": v.department_id,
                "nhom_xep_id": (v.nhom_xep_id if v.nhom_xep_id is not None
                                else self._nhom_goi_y(nhom_chon, v.may_id, to_cua_may)),
                "department_ten": self.cay.ten.get(v.department_id) if v.department_id else None,
                "da_giao_at": v.da_giao_at.isoformat() if v.da_giao_at else None,
                # Đã rời khay "Lệnh mới tới": có máy (kể cả máy tính giá) hoặc đã chọn Làm tay.
                "da_xep": v.may_id is not None or v.nhom_xep_id is not None,
                "trang_thai": v.trang_thai,
                "thu_tu_xep": v.thu_tu_xep,
                "may_chon": may_chon, "nhom_chon": nhom_chon,
                "quy_cach": v.quy_cach_json, "ghi_chu": v.ghi_chu, "khuon": v.khuon_json,
                "khau_truoc": khau.get(v.id),
            })
        return {
            "bo_phan": {"id": bp, "ten": self.cay.ten.get(bp), "tu_lam": self.cay.la(bp)},
            "nhom": [{"id": d, "ten": self.cay.ten.get(d)}
                     for d, _cap in self.cay.thu_tu() if d in vung and self.cay.la(d)] or
                    [{"id": bp, "ten": self.cay.ten.get(bp)}],
            "may": [{"id": m.id, "ma": m.ma, "ten": m.ten,
                     "nhom_ids": [t for t in to_cua_may.get(m.id, []) if t in vung]}
                    for m in may_bp],
            "may_ngoai": [{"id": m.id, "ma": m.ma, "ten": m.ten} for m in ngoai.values()],
            "viec": ds,
        }

    @staticmethod
    def _ten_may(m) -> str | None:
        return f"{m.ma} {m.ten}".strip() if m is not None else None

    def _khau_truoc(self, viec: list) -> dict[int, dict]:
        """Khâu trước của từng việc trong lệnh: tên bước + đang ở đâu. Chỉ để báo, không chặn.
        Nhiều khâu trước (nhánh gộp) thì nói khâu CHƯA XONG — đó là khâu đang giữ hàng."""
        ra: dict[int, dict] = {}
        for d, ds in self.repo.viec_truoc(viec).items():
            if not ds:
                continue
            c = next((x for x in ds if x.trang_thai != CV_HOAN_THANH), ds[0])
            ra[d] = {"ten": c.ten_cong_doan, "trang_thai": c.trang_thai,
                     "da_giao": c.da_giao_at is not None or c.bo_phan_id is None,
                     "o": self.cay.ten.get(c.department_id or c.bo_phan_id)}
        return ra

    # ---------------- ghi ----------------

    def _viec(self, cv_id: int, version: int | None):
        v = self.repo.cong_viec(cv_id)
        if v is None or v.bo_phan_id is None:
            raise KhbpKhongThay("Không tìm thấy việc.")
        self._gac(v.bo_phan_id)
        if version is not None and int(version) != int(v.version):
            raise KhbpXungDot("Việc vừa được người khác sửa — tải lại rồi làm tiếp.")
        return v

    def _audit(self, v, action: str, detail: str) -> None:
        AuditLogRepository(self.db).create(
            actor_user_id=getattr(self.user, "id", None), action=action,
            target=f"lsx:{v.lsx_id}" if v.lsx_id else f"bai_ghep:{v.bai_ghep_id}",
            detail=detail, commit=False)

    def xep(self, cv_id: int, *, may_id: int | None, department_id: int | None,
            ly_do: str | None = None, version: int | None = None) -> dict:
        """Đặt máy (None = Làm tay) + nhóm cho việc CHƯA GIAO. Đổi khỏi máy gợi ý phải có lý do."""
        v = self._viec(cv_id, version)
        if v.da_giao_at is not None:
            raise KhbpXungDot("Việc đã giao xuống nhóm — rút lại trước khi đổi.")
        bp = int(v.bo_phan_id)
        vung = self.cay.vung(bp)
        may_bp = self.repo.may_cua_to(vung)
        to_cua_may = MayToRepository(self.db).to_cua_may([m.id for m in may_bp])
        cd, goi_y = self._cong_doan_cua([v])[v.id]
        may_chon, nhom_chon = self._lua_chon(bp, cd, may_bp, to_cua_may)
        if may_id is not None and int(may_id) not in may_chon and int(may_id) != goi_y:
            raise KhbpLoi("Máy này không thuộc bộ phận hoặc không chạy được công đoạn.")
        if department_id is not None:
            if int(department_id) not in nhom_chon:
                raise KhbpLoi("Nhóm này không làm được công đoạn ở bộ phận.")
            if (may_id is not None and cd is not None and cd.department_ids
                    and int(department_id) not in to_cua_may.get(int(may_id), [])):
                raise KhbpLoi("Máy này không thuộc nhóm đã chọn.")
        ly_do = (ly_do or "").strip()
        # Trả về khay (máy lẫn nhóm đều trống) chỉ là "chưa xếp", không phải đổi máy ⇒ khỏi lý do;
        # lý do đòi lúc đặt từ khay vào máy khác máy tính giá (lúc đó `v.may_id` đã trống).
        ve_khay = may_id is None and department_id is None
        if (goi_y is not None and not ve_khay and may_id != v.may_id and may_id != goi_y):
            if not ly_do:
                raise KhbpLoi("Đổi máy khác máy đã tính giá phải nhập lý do.")
            ten = self.repo.may({goi_y, v.may_id, may_id} - {None})
            moi = self._ten_may(ten.get(may_id)) or "Làm tay"
            goc = self._ten_may(ten.get(goi_y))
            # Từ khay (chưa xếp) hoặc đang ở đúng máy tính giá: chỉ một câu "chạy X thay máy tính giá".
            # Đang ở máy khác / Làm tay: nói cả chỗ cũ.
            if (v.may_id is None and v.nhom_xep_id is None) or v.may_id == goi_y:
                cau = f"chạy {moi} thay máy tính giá {goc}"
            else:
                cu = self._ten_may(ten.get(v.may_id)) or "Làm tay"
                cau = f"đổi {cu} sang {moi}, máy tính giá là {goc}"
            self._audit(v, "kh_bo_phan_doi_may",
                        f"{v.ten_cong_doan}: {cau}. Lý do: {ly_do[:300]}")
        if v.may_id != may_id:
            v.thu_tu_xep = None
        v.may_id = may_id
        # Nhóm CHỌN chưa giao nằm ở `nhom_xep_id`, không ở `department_id` (bàn tổ đọc cột ấy).
        v.nhom_xep_id = department_id
        v.version += 1
        self.db.commit()
        return {"id": v.id, "version": v.version, "bo_phan_id": bp}

    def sap_xep(self, bo_phan_id: int, *, may_id: int | None, ids: list[int]) -> None:
        """Thứ tự chạy trong một cột (máy hoặc Làm tay). Chỉ việc của bộ phận, đúng cột đó."""
        bp = self._gac(bo_phan_id)
        for i, cv_id in enumerate(ids):
            v = self.repo.cong_viec(int(cv_id))
            if v is None or v.bo_phan_id != bp or v.may_id != may_id:
                raise KhbpLoi("Danh sách thứ tự lẫn việc của cột khác — tải lại rồi làm tiếp.")
            v.thu_tu_xep = i + 1
        self.db.commit()

    def giao(self, bo_phan_id: int, ids: list[int] | None = None) -> list:
        """Giao xuống nhóm mọi việc chưa giao đã có nhóm (máy hoặc Làm tay). Trả các việc đã giao."""
        from .san_xuat.thuc_thi import giao_ca_to

        bp = self._gac(bo_phan_id)
        chon = set(int(i) for i in ids) if ids else None
        viec = [v for v in self.repo.viec_cua_bo_phan(bp)
                if v.da_giao_at is None and (chon is None or v.id in chon)]
        vung = self.cay.vung(bp)
        may_bp = self.repo.may_cua_to(vung)
        to_cua_may = MayToRepository(self.db).to_cua_may([m.id for m in may_bp])
        cd_cua = self._cong_doan_cua(viec)
        da = []
        for v in viec:
            nhom = v.nhom_xep_id
            if nhom is None:
                _may, nhom_chon = self._lua_chon(bp, cd_cua[v.id][0], may_bp, to_cua_may)
                nhom = self._nhom_goi_y(nhom_chon, v.may_id, to_cua_may)
            if nhom is None:
                continue
            v.department_id = nhom
            v.nhom_xep_id = nhom
            v.loai_buoc = BUOC_MAY if v.may_id else BUOC_TO
            v.da_giao_at = _now()
            v.da_giao_by_id = getattr(self.user, "id", None)
            v.version += 1
            self.db.flush()
            giao_ca_to(self.db, v)
            self._audit(v, "kh_bo_phan_giao",
                        f"Giao «{v.ten_cong_doan}» cho {self.cay.ten.get(nhom)}")
            da.append(v)
        if chon is not None and not da:
            raise KhbpLoi("Chưa có việc nào đủ nhóm để giao.")
        self.db.commit()
        return da

    def rut(self, cv_id: int, version: int | None = None) -> dict:
        """Rút việc đã giao về khay bộ phận — chỉ khi nhóm chưa bắt đầu."""
        v = self._viec(cv_id, version)
        if v.da_giao_at is None:
            raise KhbpXungDot("Việc chưa giao.")
        if v.trang_thai != CV_PHAT_HANH or self.repo.da_ghi_san_luong(v.id):
            raise KhbpXungDot("Nhóm đã bắt đầu làm — không rút lại được.")
        nhom_cu = v.department_id
        for pc in self.repo.phan_cong_hoat_dong(v.id):
            pc.trang_thai = PC_DA_RUT
            pc.ly_do_rut = "Bộ phận rút việc về để xếp lại."
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

    def tep(self, cv_id: int) -> list[dict]:
        """Tệp của (các) lệnh mà việc thuộc về — dùng lại `tep_lenh._nhom_tep`."""
        from ..repositories.san_xuat_repo import SanXuatRepository
        from .san_xuat.tep_lenh import _nhom_tep

        v = self._viec(cv_id, None)
        repo = SanXuatRepository(self.db)
        lsx_ids = repo.lsx_ids_cua_bai_ghep({v.bai_ghep_id}) if v.bai_ghep_id else {v.lsx_id}
        return _nhom_tep(self.db, repo, lsx_ids)

