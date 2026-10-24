"""Công đoạn — service: CRUD + validate (§8).

Thân CRUD dùng chung ở `services/catalog_base.CatalogService`; ở đây chỉ còn luật riêng.
"""
from __future__ import annotations

import keyword
import re

from ..models.cong_doan import (
    CD_HE_THONG, CHE_DO_TINH, DON_VI_BAC, KIEU_BU_HAO, NHOM, O_KHOA_HE_THONG, PRICING_BASIS,
    TOOLING_TYPE, CongDoan, la_cong_doan_he_thong,
)
from ..models.don_vi_do import TRAM_DONG_GIAY, tram_chay_xuoi
from ..repositories.cong_doan_repo import CongDoanRepository
from .bien_cong_thuc import BIEN, LOAI_CONG_DOAN, LOAI_KHOAN, LOAI_QUY_DOI, TEN_HAM_CAM
from .catalog_base import (
    CatalogDuplicate, CatalogError, CatalogNotFound, CatalogService, CatalogValidationError,
)
from .thanh_phan_engine import kiem_cong_thuc

def _gia_theo_to_sach(rows, *, co_dinh: bool) -> list[dict] | None:
    """Chuẩn hoá bảng giá theo tổ về `[{department_id, (bac), (gia_co_dinh), don_gia}]`; rỗng ⇒
    None (= mọi tổ dùng giá chung). Dòng không có tổ thì bỏ. `bac` chỉ giữ khi có (công đoạn chia
    bậc) — dòng của công đoạn thường giữ nguyên hình dạng cũ."""
    ra: list[dict] = []
    for r in rows or []:
        r = dict(r)
        if not r.get("department_id"):
            continue
        dong = {"department_id": int(r["department_id"])}
        if str(r.get("bac") or "").strip():
            dong["bac"] = str(r["bac"]).strip()
        dong["don_gia"] = None if r.get("don_gia") is None else float(r["don_gia"])
        if co_dinh:
            dong["gia_co_dinh"] = float(r.get("gia_co_dinh") or 0)
        ra.append(dong)
    return ra or None


def _bac_gia_sach(rows) -> list[dict] | None:
    """Chuẩn hoá bậc giá `[{ma, ten, mau_tu, mau_den, pha, tuy_chon_ma, tuy_chon_co, gom_uv}]`;
    rỗng ⇒ None (= không chia bậc). Ô điều kiện trống = không xét."""
    def so(v):
        return None if v is None or str(v).strip() == "" else float(v)

    ra = []
    for b in rows or []:
        b = dict(b)
        ra.append({
            "ma": str(b.get("ma") or "").strip(),
            "ten": " ".join(str(b.get("ten") or "").split()),
            "mau_tu": so(b.get("mau_tu")),
            "mau_den": so(b.get("mau_den")),
            "pha": b.get("pha") or None,
            "tuy_chon_ma": (str(b.get("tuy_chon_ma") or "").strip().lower()) or None,
            "tuy_chon_co": b.get("tuy_chon_co") or None,
            "gom_uv": bool(b.get("gom_uv")),
        })
    return ra or None


class CongDoanError(CatalogError):
    pass


class CongDoanValidationError(CongDoanError, CatalogValidationError):
    pass


class CongDoanDuplicate(CongDoanError, CatalogDuplicate):
    pass


class CongDoanNotFound(CongDoanError, CatalogNotFound):
    pass


_NHAN_O_KHOA = {"ma": "mã", "ten": "tên", "nhom": "nhóm", "don_vi_vao": "đơn vị đầu vào",
                "don_vi_ra": "đơn vị đầu ra"}


class CongDoanService(CatalogService):
    LOAI = "cong_doan"
    E_NOT_FOUND = CongDoanNotFound
    E_DUPLICATE = CongDoanDuplicate
    E_VALIDATION = CongDoanValidationError
    MSG_NOT_FOUND = "Không tìm thấy công đoạn."
    MSG_DUPLICATE = "Mã công đoạn đã tồn tại."

    def __init__(self, repo: CongDoanRepository, audit=None) -> None:
        super().__init__(repo, audit)

    def create(self, data: dict, actor_id: int | None = None):
        return self._dong_bo_may(super().create(data, actor_id))

    def update(self, item_id: int, data: dict, actor_id: int | None = None):
        return self._dong_bo_may(super().update(item_id, data, actor_id))

    def _dong_bo_may(self, cd: CongDoan) -> CongDoan:
        """Tick thêm tổ ⇒ máy của tổ đó có ngay dòng (công thức trống) trong bảng "Máy chạy được
        công đoạn này" — máy đi theo tổ, không ai chọn tay (spec máy thuộc tổ §4.4)."""
        from .may_to import dong_bo_cong_doan_may

        if dong_bo_cong_doan_may(self.repo.db, cong_doan_ids=[cd.id]):
            self.repo.db.commit()
        return cd

    def _chuan_hoa(self, data: dict) -> dict:
        """Khử trùng danh sách tổ phụ trách, GIỮ thứ tự chọn (tổ đầu là mặc định của bước lệnh).

        `department_ids = None` là VẮNG (giữ nguyên danh sách đang có — ô trống ở file Excel) — bỏ
        khoá hẳn để repo không tưởng đó là "xoá hết tổ". Danh sách RỖNG thì đúng là gỡ hết tổ.
        """
        data = dict(data)
        if "department_ids" in data:
            ids = data.get("department_ids")
            if ids is None:
                data.pop("department_ids")
            else:
                data["department_ids"] = list(dict.fromkeys(int(i) for i in ids if i))
        if "khoan" in data and data.get("khoan") is not None:
            k = dict(data["khoan"])
            k["unit"] = (str(k.get("unit") or "").strip().lower()) or None
            k["cong_thuc_khoan"] = (str(k.get("cong_thuc_khoan") or "").strip()) or None
            k["gia_theo_to"] = _gia_theo_to_sach(k.get("gia_theo_to"), co_dinh=True)
            k["bac_gia"] = _bac_gia_sach(k.get("bac_gia"))
            k["gia_co_dinh"] = float(k.get("gia_co_dinh") or 0)
            k["tuy_chon"] = [
                {
                    "ma": str(t.get("ma") or "").strip().lower(),
                    "ten": " ".join(str(t.get("ten") or "").split()),
                    "kieu": t.get("kieu") or "co_khong",
                    "goi_y": (" ".join(str(t.get("goi_y") or "").split())) or None,
                }
                for t in (k.get("tuy_chon") or [])
            ]
            k["viec_phat_sinh"] = [
                {
                    **dict(r),
                    "ten": " ".join(str(r.get("ten") or "").split()),
                    "don_vi": (str(r.get("don_vi") or "").strip().lower()) or None,
                    "gia_theo_to": _gia_theo_to_sach(r.get("gia_theo_to"), co_dinh=False),
                }
                for r in (k.get("viec_phat_sinh") or [])
            ]
            data["khoan"] = k
        return data

    def _anh_chup_nhan_ban(self, goc) -> dict:
        """Bản sao mang theo danh sách tổ — ảnh chụp nhật ký chỉ có chúng dưới dạng chữ."""
        data = super()._anh_chup_nhan_ban(goc)
        data["department_ids"] = list(goc.department_ids)
        data["khoan"] = None if goc.khoan is None else {
            "unit": goc.khoan.unit,
            "unit_price": float(goc.khoan.unit_price),
            "cong_thuc_khoan": goc.khoan.cong_thuc_khoan,
            "gia_theo_to": goc.khoan.gia_theo_to,
            "gia_co_dinh": float(goc.khoan.gia_co_dinh or 0),
            "tuy_chon": goc.khoan.tuy_chon or [],
            "bac_gia": goc.khoan.bac_gia,
            "viec_phat_sinh": [
                {"ten": v.ten, "don_gia": float(v.don_gia), "don_vi": v.don_vi,
                 "gia_theo_to": v.gia_theo_to}
                for v in goc.khoan.viec_phat_sinh
            ],
        }
        return data

    def _kiem_bac_bu_hao(self, data: dict) -> None:
        """Soi bảng bậc bù hao khai trên công đoạn (chỉ khi `kieu_bu_hao = theo_bac`).

        Người khai chỉ gõ MỐC TRÊN, giao diện tự nối khoảng — nên luật ở đây chặn đúng những gì
        cái nối ấy không tự lo được: bảng rỗng, mốc không tăng, bậc vô hạn lạc chỗ. Cận dưới KHÔNG
        có trong dữ liệu (xem `bu_hao_engine.tra_bac_raw`) nên khoảng hở/chồng không thể xảy ra.

        Dọn luôn khoá lạ: chỉ giữ `sl_den | gia_tri | don_vi`. Client cũ còn gửi `sl_tu` thì bỏ im
        lặng, không nổ — ô ấy đã hết nghĩa.
        """
        if data.get("kieu_bu_hao") != "theo_bac":
            return
        bac = data.get("bac_bu_hao") or []
        if not isinstance(bac, list) or not bac:
            raise CongDoanValidationError(
                "Chọn “Theo bậc số lượng” thì phải khai ít nhất một bậc. [E-CD-BUHAO-BAC]")
        sach: list[dict] = []
        moc_truoc: float | None = None
        for i, b in enumerate(bac):
            if not isinstance(b, dict):
                raise CongDoanValidationError("Bậc bù hao không hợp lệ. [E-CD-BUHAO-BAC]")
            don_vi = b.get("don_vi") or "to"
            if don_vi not in DON_VI_BAC:
                raise CongDoanValidationError(
                    f"Bậc {i + 1}: đơn vị chỉ nhận Tờ hoặc %. [E-CD-BUHAO-BAC]")
            try:
                gia_tri = float(b.get("gia_tri") or 0)
            except (TypeError, ValueError):
                raise CongDoanValidationError(
                    f"Bậc {i + 1}: giá trị phải là số. [E-CD-BUHAO-BAC]") from None
            if gia_tri < 0:
                raise CongDoanValidationError(
                    f"Bậc {i + 1}: giá trị bù hao không được âm. [E-CD-BUHAO-BAC]")
            sl_den = b.get("sl_den")
            if sl_den in (None, ""):
                if i != len(bac) - 1:
                    raise CongDoanValidationError(
                        "Bậc vô hạn phải nằm CUỐI bảng — bậc khai sau nó không bao giờ được tra "
                        "tới. [E-CD-BUHAO-BAC]")
                sach.append({"sl_den": None, "gia_tri": gia_tri, "don_vi": don_vi})
                continue
            try:
                sl_den = float(sl_den)
            except (TypeError, ValueError):
                raise CongDoanValidationError(
                    f"Bậc {i + 1}: mốc số lượng phải là số. [E-CD-BUHAO-BAC]") from None
            if sl_den <= 0:
                raise CongDoanValidationError(
                    f"Bậc {i + 1}: mốc số lượng phải lớn hơn 0. [E-CD-BUHAO-BAC]")
            if moc_truoc is not None and sl_den <= moc_truoc:
                raise CongDoanValidationError(
                    f"Bậc {i + 1}: mốc phải lớn hơn mốc của bậc trên ({moc_truoc:,.0f}). "
                    f"[E-CD-BUHAO-BAC]")
            moc_truoc = sl_den
            sach.append({"sl_den": int(sl_den) if sl_den.is_integer() else sl_den,
                         "gia_tri": gia_tri, "don_vi": don_vi})
        if sach[-1]["sl_den"] is not None:
            raise CongDoanValidationError(
                "Bậc cuối phải để trống mốc (vô hạn) — nếu không, đơn vượt mốc cuối sẽ không tra "
                "được bù hao. [E-CD-BUHAO-BAC]")
        data["bac_bu_hao"] = sach

    def _kiem_to(self, data: dict, obj: CongDoan | None) -> list[int]:
        """Danh sách tổ SẼ LƯU (vắng = giữ của bản ghi). Tổ MỚI thêm phải là TỔ — nút lá trong khối
        Sản xuất (07/10/2026; trước đó chấp nhận mọi phòng ban, kể cả nút cha). Tổ đang lưu mà nay
        đã bị xoá / thành nút cha thì để yên — chặn là khoá luôn đường sửa công đoạn đó."""
        cu = list(obj.department_ids) if obj is not None else []
        if "department_ids" not in data:
            return cu
        ids = data["department_ids"]
        moi = {i for i in ids if i not in cu}
        if moi and moi - {d.id for d in self.repo.phong_ban_tos()}:
            raise CongDoanValidationError(
                "Tổ phụ trách phải là tổ cuối trong cây tổ chức, không chọn phòng ban có tổ con.")
        return ids

    def _kiem_he_thong(self, data: dict, obj: CongDoan | None) -> None:
        """Công đoạn hệ thống (spec 2026-10-24-chuan-bi-giay §3): mã/tên/nhóm/đơn vị vào–ra đúng
        bảng `CD_HE_THONG`, không ngừng dùng — kể cả qua Excel (nhập Excel cũng đi `update`)."""
        if obj is None or not la_cong_doan_he_thong(obj.ma):
            return
        chuan = {"ma": obj.ma, **CD_HE_THONG[obj.ma]}
        for o in O_KHOA_HE_THONG:
            if o in data and ((data.get(o) or "").strip() or None) != chuan[o]:
                raise CongDoanValidationError(
                    f"Công đoạn hệ thống «{chuan['ten']}»: không đổi {_NHAN_O_KHOA[o]}.")
        if data.get("active") is False:
            raise CongDoanValidationError(
                f"Công đoạn hệ thống «{chuan['ten']}»: không ngừng dùng được.")

    def dat_active(self, item_id: int, active: bool, actor_id: int | None = None):
        cd = self.get(item_id)
        if not active and la_cong_doan_he_thong(cd.ma):
            raise CongDoanValidationError(
                f"Công đoạn hệ thống «{cd.ten}»: không ngừng dùng được.")
        return super().dat_active(item_id, active, actor_id)

    def _blockers(self, obj) -> list[str]:
        if la_cong_doan_he_thong(obj.ma):
            return ["công đoạn của hệ thống"]
        return super()._blockers(obj)

    def _validate(self, data: dict, obj: CongDoan | None = None) -> None:
        self._kiem_he_thong(data, obj)
        if not (data.get("ma") or "").strip():
            raise CongDoanValidationError("Mã công đoạn không được trống.")
        if not (data.get("ten") or "").strip():
            raise CongDoanValidationError("Tên công đoạn không được trống.")
        if data.get("nhom") not in NHOM:
            raise CongDoanValidationError("Nhóm công đoạn không hợp lệ.")
        # MÁY của công đoạn phải CÓ THẬT và còn dùng — `may_id` là soft-ref nên không có FK gác hộ.
        # Máy đã thanh lý mà vẫn nằm trong danh sách thì bước lệnh gán được một máy không tồn tại
        # trên bàn xếp lịch.
        may_rows = data.get("may_lam_duoc") or []
        if may_rows:
            may_ids = [int(r.get("may_id") or 0) for r in may_rows]
            if len(set(may_ids)) != len(may_ids):
                raise CongDoanValidationError("Một máy chỉ khai được một lần trong công đoạn.")
            song = self.repo.mays(set(may_ids))
            for mid in may_ids:
                may = song.get(mid)
                if may is None or not may.active:
                    raise CongDoanValidationError(
                        "Máy không còn trong danh mục hoặc đã ngừng dùng.")
            for r in may_rows:
                # Chuẩn hoá TẠI ĐÂY để mọi đường vào (form, Excel, API) cùng một dạng: khoảng
                # trắng thừa làm `if cong_thuc:` ở engine tưởng có khai rồi `safe_eval("  ")` nổ.
                for k in ("cong_thuc_gio", "cong_thuc_gia"):
                    r[k] = ((r.get(k) or "").strip()) or None
            # W-CD-GIA-NGOAI-IN: công thức GIÁ chỉ có nghĩa ở công đoạn nhóm In — phiếu tính giá
            # chỉ chọn máy ở khối In của thành phần, nên câu khai cho máy bế/cán không có đường
            # nào chảy tới. Màn danh mục đã ẩn ô này ngoài nhóm In, nhưng bảng Excel thì KHÔNG:
            # không dọn ở đây thì một câu gõ nhầm vẫn nằm trong DB và `tinh_gia_service` vẫn đọc
            # ra, giá lệch mà chẳng màn nào bày cho người dùng thấy vì sao.
            if data.get("nhom") != "print":
                for r in may_rows:
                    r["cong_thuc_gia"] = None
            # Soi SAU khi dọn: ngoài nhóm In ô giá vừa bị ép None, chặn nó là chặn một câu sắp bị
            # vứt đi. Gọi tên MÁY trong câu lỗi — bảng nhiều dòng, không nói tên thì người khai
            # phải mở từng panel để dò xem mình gõ hỏng ở đâu.
            for r in may_rows:
                ten_may = getattr(song.get(int(r.get("may_id") or 0)), "ten", "")
                o = f" (máy {ten_may})" if ten_may else ""
                self._kiem_o(r.get("cong_thuc_gio"), nhan=f"Công thức giờ chạy{o}",
                             loai=LOAI_QUY_DOI)
                self._kiem_o(r.get("cong_thuc_gia"), nhan=f"Công thức giá{o}",
                             loai=LOAI_CONG_DOAN)
        self._kiem_to(data, obj)
        self._kiem_khoan(data.get("khoan"))
        # ⚠️ Khối validate "định mức đầu việc" (năng suất người-giờ · kíp chuẩn · công thức tiền
        #    công · cách đo giờ) GỠ 18/09/2026 (mg `0320`): công đoạn thôi khai đầu việc. Việc khoán
        #    nay chọn LÚC GHI MẺ ở bàn tổ, còn thời lượng bước tổ do người lập lệnh gõ tay
        #    (`so_gio_ke_hoach`). Vật tư ở lại nhưng treo thẳng vào CÔNG ĐOẠN (§3.1).
        self._kiem_vat_tu(data.get("vat_tus") or [], self._vat_tu_dang_co(obj))

        che_do = data.get("che_do_tinh", "theo_san_luong")
        if che_do not in CHE_DO_TINH:
            raise CongDoanValidationError("Chế độ tính không hợp lệ.")
        if data.get("pricing_basis") not in PRICING_BASIS:
            raise CongDoanValidationError("Tính theo sản lượng cần pricing_basis hợp lệ. [E-CD-BASIS]")
        # GIỮ ĐƯỢC giá trị vốn có, chỉ chặn GÁN MỚI — cùng luật với đơn vị đã ngừng dùng
        # (`vat_lieu_kho_service._kiem_don_vi`). Cần vì `"kem"` vừa bị gỡ khỏi `TOOLING_TYPE`
        # (16/08/2026): công đoạn cũ nào còn mang giá trị đó thì sửa TÊN thôi cũng ăn lỗi
        # "Loại dụng cụ không hợp lệ", trong khi người dùng chẳng đụng vào ô ấy. Đo trên DB dev
        # là 0/13, nhưng prod chưa đếm được nên không đoán.
        tooling = data.get("tooling_type")
        if tooling not in (None, "") and tooling not in TOOLING_TYPE                 and tooling != getattr(obj, "tooling_type", None):
            raise CongDoanValidationError("Loại dụng cụ không hợp lệ.")
        if data.get("kieu_bu_hao", "khong") not in KIEU_BU_HAO:
            raise CongDoanValidationError("Kiểu bù hao không hợp lệ. [E-CD-BUHAO]")
        self._kiem_bac_bu_hao(data)
        # Đơn vị vào/ra là MENU ĐÓNG 5 CHẶNG dòng giấy (06/09/2026) — không còn trỏ vào danh mục
        # Đơn vị & quy đổi. Hai ca hợp lệ, không có ca thứ ba:
        #   - cùng để TRỐNG        → bước NGOÀI dòng giấy (ghi kẽm, đóng thùng): đứng ngoài chuỗi bù
        #                            hao; đơn vị + số do người lập lệnh tự khai ở bước
        #                            (`lsx_service.tu_khai_don_vi`)
        #   - hai đầu đều là CHẶNG → bước trên dòng giấy, phải đúng chiều (`tram_chay_xuoi`)
        #
        # Trước đây bước ngoài dòng khai đơn vị THẬT của nó (`bai → kem`) và "có nằm trên dòng
        # giấy không" hỏi cờ `don_vi_do.tram_dong_giay`. Cờ ấy đã gỡ: nó chỉ cho ĐỔI TÊN một chặng
        # chứ không thêm được chặng thứ 6, đổi lại bắt người khai danh mục đơn vị (kho, mua hàng)
        # phải hiểu dòng giấy. Nay bỏ trống chính là câu "ngoài dòng giấy" — nói thẳng, một ô.
        #
        # GỠ 18/09/2026 (mg `0324`): "Công thức sản lượng ra" + "Đơn vị sản lượng" của bước ngoài
        # dòng giấy, kèm luật chặn vòng tròn `sl_vao`/`sl_ra` trong công thức ấy.
        dv_vao = (data.get("don_vi_vao") or "").strip() or None
        dv_ra = (data.get("don_vi_ra") or "").strip() or None
        data["don_vi_vao"], data["don_vi_ra"] = dv_vao, dv_ra
        if (dv_vao is None) != (dv_ra is None):
            raise CongDoanValidationError(
                "Đơn vị đầu vào và đầu ra phải cùng khai, hoặc cùng để trống. [E-CD-DONVI]")
        if dv_vao is not None:
            if la := [m for m in dict.fromkeys((dv_vao, dv_ra)) if m not in TRAM_DONG_GIAY]:
                raise CongDoanValidationError(
                    f"Đơn vị {' · '.join(la)} không nằm trên dòng giấy. Ô đơn vị của công đoạn "
                    f"chỉ nhận 5 chặng: tờ nguyên · tờ in · con · tay sách · thành phẩm — hoặc "
                    f"để TRỐNG cả hai nếu bước không chạm giấy. [E-CD-DONVI]")
            if not tram_chay_xuoi(dv_vao, dv_ra):
                raise CongDoanValidationError(
                    f"Không quy đổi được {dv_vao} → {dv_ra}. Dòng giấy chỉ chảy một chiều: "
                    f"tờ nguyên → tờ in → con/tay → thành phẩm. [E-CD-DONVI]"
                )
        # W-CD-PRINT-SPOIL: bước in không nên có spoilage (bù hao lấy từ máy) — ép 0.
        if data.get("nhom") == "print" and data.get("spoilage_pct"):
            data["spoilage_pct"] = 0
        # Công thức phải CHẠY ĐƯỢC mới cho lưu (07/09/2026) — trước đây không ô công thức nào của
        # công đoạn bị soi ở server. Kiểm cuối cùng để câu lỗi cú pháp không chen trước những câu
        # lỗi nghiệp vụ cụ thể hơn (chiều dòng giấy) — người khai cần nghe cái bệnh nặng trước.
        self._kiem_o(data.get("cong_thuc_gia"), nhan="Công thức tính giá", loai=LOAI_CONG_DOAN)

    def _kiem_khoan(self, k: dict | None) -> None:
        """Kiểm aggregate Khoán; `None`/rỗng là yêu cầu chưa cấu hình hoặc gỡ cấu hình."""
        if not k:
            return
        unit = k.get("unit")
        gia = k.get("unit_price")
        if not unit or gia is None:
            raise CongDoanValidationError("Cấu hình khoán cần đủ đơn vị tính và đơn giá.")
        try:
            if float(gia) < 0:
                raise CongDoanValidationError("Đơn giá khoán không được âm.")
        except (TypeError, ValueError) as e:
            raise CongDoanValidationError("Đơn giá khoán không hợp lệ.") from e
        rows = k.get("viec_phat_sinh") or []
        mas = {str(unit), *(str(r.get("don_vi")) for r in rows if r.get("don_vi"))}
        co = self.repo.don_vi_theo_ma(mas)
        if unit not in co:
            raise CongDoanValidationError(
                f'Đơn vị tính khoán "{unit}" không có trong danh mục Đơn vị & quy đổi.')
        da_co: set[str] = set()
        for i, r in enumerate(rows, start=1):
            ten = r.get("ten") or ""
            if not ten:
                raise CongDoanValidationError(f"Tên việc phát sinh (dòng {i}) không được trống.")
            khoa = " ".join(ten.casefold().split())
            if khoa in da_co:
                raise CongDoanValidationError(f'Việc phát sinh "{ten}" bị trùng tên.')
            da_co.add(khoa)
            if r.get("don_gia") is None:
                raise CongDoanValidationError(f'Chưa nhập đơn giá cho việc phát sinh "{ten}".')
            if float(r["don_gia"]) < 0:
                raise CongDoanValidationError(f'Đơn giá của việc phát sinh "{ten}" không được âm.')
            if not r.get("don_vi") or r["don_vi"] not in co:
                raise CongDoanValidationError(
                    f'Đơn vị tính của việc phát sinh "{ten}" không có trong danh mục Đơn vị & quy đổi.')
            self._kiem_gia_theo_to(r.get("gia_theo_to"), nhan=f'việc phát sinh "{ten}"')
        tuy_chon = k.get("tuy_chon") or []
        bac = k.get("bac_gia") or []
        self._kiem_bac_gia(bac, tuy_chon)
        self._kiem_gia_theo_to(k.get("gia_theo_to"), nhan="công đoạn",
                               bac={b["ma"]: b["ten"] for b in bac})
        if float(k.get("gia_co_dinh") or 0) < 0:
            raise CongDoanValidationError("Giá cố định chung không được âm.")
        self._kiem_tuy_chon(tuy_chon)
        # Công thức chạy THẬT ở lần ghi sản lượng (`khoan_ky`, 21/10/2026) — soi bằng bộ chip ô khoán
        # cộng chip của tuỳ chọn khi ghi (Đợt 2).
        self._kiem_o(k.get("cong_thuc_khoan"), nhan="Công thức khoán", loai=LOAI_KHOAN,
                     bien_them=[t["ma"] for t in tuy_chon])

    @staticmethod
    def _kiem_tuy_chon(rows: list[dict]) -> None:
        """Tuỳ chọn khi ghi (Đợt 2): tên không trống; mã là tên biến hợp lệ, không trùng chip hệ
        thống / tên hàm / tuỳ chọn khác của cùng công đoạn — trùng là công thức hiểu sai biến."""
        da_co: set[str] = set()
        for i, t in enumerate(rows, start=1):
            ten, ma = t.get("ten") or "", t.get("ma") or ""
            if not ten:
                raise CongDoanValidationError(f"Tên tuỳ chọn khi ghi (dòng {i}) không được trống.")
            if ma in TEN_HAM_CAM or keyword.iskeyword(ma) or ma in {b["ma"] for b in BIEN}:
                raise CongDoanValidationError(
                    f'Mã tuỳ chọn "{ma}" trùng chip có sẵn hoặc tên hàm — đặt mã khác.')
            if not re.fullmatch(r"[a-z][a-z0-9_]*", ma):
                raise CongDoanValidationError(
                    f'Mã tuỳ chọn "{ma or ten}" chỉ gồm chữ thường không dấu, số và dấu gạch dưới.')
            if ma in da_co:
                raise CongDoanValidationError(f'Mã tuỳ chọn "{ma}" bị trùng giữa hai tuỳ chọn.')
            if t.get("kieu") not in ("co_khong", "so"):
                raise CongDoanValidationError(f'Kiểu của tuỳ chọn "{ten}" không hợp lệ.')
            da_co.add(ma)

    @staticmethod
    def _kiem_bac_gia(rows: list[dict], tuy_chon: list[dict]) -> None:
        """Bậc giá (22/10/2026): tên không trống, mã không trùng, khoảng màu không ngược, tuỳ chọn
        làm điều kiện phải là tuỳ chọn Có / không của chính công đoạn."""
        co_khong = {t["ma"] for t in tuy_chon if t.get("kieu") == "co_khong"}
        da_co: set[str] = set()
        for i, b in enumerate(rows, start=1):
            ten = b["ten"] or f"dòng {i}"
            if not b["ten"]:
                raise CongDoanValidationError(f"Tên bậc giá (dòng {i}) không được trống.")
            if not b["ma"]:
                raise CongDoanValidationError(f'Bậc giá "{ten}" thiếu mã.')
            if b["ma"] in da_co:
                raise CongDoanValidationError(f'Mã bậc giá "{b["ma"]}" bị trùng giữa hai bậc.')
            da_co.add(b["ma"])
            tu, den = b["mau_tu"], b["mau_den"]
            if (tu is not None and tu < 0) or (den is not None and den < 0):
                raise CongDoanValidationError(f'Bậc giá "{ten}": số màu không được âm.')
            if tu is not None and den is not None and tu > den:
                raise CongDoanValidationError(
                    f'Bậc giá "{ten}": Màu từ ({tu:g}) lớn hơn Màu đến ({den:g}).')
            if b["pha"] not in (None, "co", "khong") or b["tuy_chon_co"] not in (None, "co", "khong"):
                raise CongDoanValidationError(f'Bậc giá "{ten}": điều kiện không hợp lệ.')
            if b["tuy_chon_ma"] and b["tuy_chon_ma"] not in co_khong:
                raise CongDoanValidationError(
                    f'Bậc giá "{ten}" xét tuỳ chọn "{b["tuy_chon_ma"]}" — công đoạn không có tuỳ '
                    f"chọn Có / không mang mã đó.")
            if bool(b["tuy_chon_ma"]) != bool(b["tuy_chon_co"]):
                raise CongDoanValidationError(
                    f'Bậc giá "{ten}": chọn tuỳ chọn thì phải chọn Có hoặc Không, và ngược lại.')

    def _kiem_gia_theo_to(self, rows: list[dict] | None, *, nhan: str,
                          bac: dict[str, str] | None = None) -> None:
        """Bảng giá theo tổ: mỗi ô (tổ, bậc) một dòng, tổ phải có thật, giá không âm, phải có đơn
        giá. Công đoạn chia bậc (`bac` = {mã: tên}) thì mọi dòng phải trỏ đúng một bậc đang khai;
        không chia bậc thì không dòng nào được mang bậc."""
        if not rows:
            return
        from ..models.department import Department

        bac = bac or {}
        for r in rows:
            mb = r.get("bac")
            if bac and not mb:
                raise CongDoanValidationError(
                    f"Bảng giá theo tổ của {nhan}: công đoạn chia bậc thì mỗi dòng giá phải thuộc một bậc.")
            if not bac and mb:
                raise CongDoanValidationError(
                    f"Bảng giá theo tổ của {nhan} có dòng mang bậc {mb} nhưng công đoạn chưa khai bậc giá.")
            if mb and mb not in bac:
                raise CongDoanValidationError(
                    f"Bảng giá theo tổ của {nhan} trỏ tới bậc {mb} không có trong danh sách bậc.")
        ids = [int(r["department_id"]) for r in rows]
        khoa = [(int(r["department_id"]), r.get("bac")) for r in rows]
        if len(set(khoa)) != len(khoa):
            raise CongDoanValidationError(f"Bảng giá theo tổ của {nhan} có tổ khai hai lần.")
        ten = dict(self.repo.db.query(Department.id, Department.name)
                   .filter(Department.id.in_(ids)).all())
        for r in rows:
            dep = int(r["department_id"])
            if dep not in ten:
                raise CongDoanValidationError(
                    f"Bảng giá theo tổ của {nhan} có tổ không còn trong cây tổ chức (id {dep}).")
            o_cua = f"tổ {ten[dep]}" + (f" bậc {bac[r['bac']]}" if r.get("bac") else "")
            if r.get("don_gia") is None:
                raise CongDoanValidationError(
                    f"Bảng giá theo tổ của {nhan}: {o_cua} chưa nhập đơn giá.")
            for o, chu in (("don_gia", "đơn giá"), ("gia_co_dinh", "giá cố định")):
                if r.get(o) is not None and float(r[o]) < 0:
                    raise CongDoanValidationError(
                        f"Bảng giá theo tổ của {nhan}: {chu} của {o_cua} không được âm.")

    @staticmethod
    def _kiem_o(cong_thuc: str | None, *, nhan: str, loai: str, bien_them=()) -> None:
        """Một ô công thức — xem `thanh_phan_engine.kiem_cong_thuc`. Đổi sang họ lỗi của màn này
        để `loi_http` trả 422 kèm câu chữ cho người khai, không lọt thành 500."""
        try:
            kiem_cong_thuc(cong_thuc, nhan=nhan, loai=loai, bien_them=bien_them)
        except ValueError as e:
            raise CongDoanValidationError(str(e)) from e

    @staticmethod
    def _vat_tu_dang_co(obj: CongDoan | None) -> set[int]:
        """Vật tư ĐÃ khai trên công đoạn này — để `_kiem_vat_tu` biết cái nào là giữ lại chứ
        không phải gán mới. Rỗng khi tạo mới."""
        return {
            int(v.vat_tu_id)
            for v in (getattr(obj, "vat_tus", None) or [])
            if v.vat_tu_id
        }

    def _kiem_vat_tu(self, rows: list[dict], dang_co: set[int] | None = None) -> None:
        """Vật tư gắn vào CÔNG ĐOẠN (nền BOM, mg 0191 → chuyển tầng mg `0316`) — id phải có thật
        và còn dùng.

        Vật tư đã ngừng dùng mà lọt vào đây thì tới lúc bung ở bước lệnh nó sẽ rơi im lặng (query
        bung lọc `active`), và người khai không hiểu vì sao dòng mình khai không hiện ra.
        Chỉ kiểm DANH SÁCH — định mức không khai ở tầng này (từ 01/10/2026 nó nằm ở công thức
        của chính vật tư, `vat_tu_in_an.cong_thuc_dinh_muc`).

        `dang_co` = vật tư vốn đã khai trên công đoạn này. Chặn GÁN MỚI vật tư đã ngừng, nhưng
        không chặn khi giữ nguyên: nếu không thì đổi mỗi cái tên công đoạn cũng bị chặn chỉ vì một
        vật tư trong đó đã ngừng từ lâu, và người dùng không có đường nào sửa nữa.
        """
        ids = [int(r["vat_tu_id"]) for r in rows if r.get("vat_tu_id")]
        if not ids:
            return
        if len(ids) != len(set(ids)):
            raise CongDoanValidationError("Một vật tư không được chọn trùng trong công đoạn.")
        can = set(ids)
        co = self.repo.vat_tus(can)
        giu = dang_co or set()
        for vid in sorted(can):
            vt = co.get(vid)
            if vt is None:
                raise CongDoanValidationError("Vật tư không tồn tại hoặc đã ngừng sử dụng.")
            if not vt.active and vid not in giu:
                raise CongDoanValidationError(
                    f"Vật tư “{vt.ten}” đã ngừng dùng — chọn vật tư khác, "
                    f"hoặc bật lại ở màn Vật tư khác.")
            if not (vt.don_vi_gia or "").strip():
                raise CongDoanValidationError(
                    f"Vật tư “{vt.ten}” chưa chọn đơn vị tính — chưa quy đổi ra số lượng được. "
                    f"Khai đơn vị ở màn Vật tư khác trước.")

    # GỠ 08/09/2026: `gan_ten_don_vi` — tra `don_vi_vao`/`don_vi_ra` vào danh mục Đơn vị & quy đổi
    # rồi gán `don_vi_vao_ten`/`don_vi_ra_ten`. Nó ra đời (12/08/2026) khi hai ô ấy CÒN trỏ danh
    # mục, và mục đích là dẹp một bảng nhãn cứng bên frontend đang lệch với danh mục.
    #
    # Từ mg `0273` (06/09/2026) hai ô đó KHÔNG còn trỏ danh mục nữa: chúng là menu ĐÓNG đúng 5
    # chặng dòng giấy (`TRAM_DONG_GIAY`). Phép tra ở lại thành ra lấy tên của một đơn vị KHO tình
    # cờ trùng mã, nên đúng cái lỗi hàm này từng dẹp lại quay về — chỉ đảo vai: danh sách hiện
    # "con → cái" (tên đơn vị kho) còn drawer hiện "Con (mảnh bế ra) → Thành phẩm" (nhãn chặng).
    # Tệ hơn: ai đổi tên đơn vị `con` ở màn Kho là chữ trong cột Đơn vị của màn Công đoạn đổi theo,
    # dù dòng giấy chẳng liên quan gì.
    #
    # Nay CHẶNG chỉ có một bộ nhãn (`models/don_vi_do.TRAM_NHAN`, frontend soi `TRAM_DONG_GIAY`),
    # server thôi gửi tên.

    def dem_theo_nhom(self, **kw) -> dict[str, int]:
        """Số công đoạn theo giai đoạn — cho tab lọc của màn Công đoạn (xem repo)."""
        return self.repo.dem_theo_nhom(**kw)

    def dem_theo_to(self, **kw) -> list[dict]:
        """Số công đoạn theo tổ phụ trách, kèm tên tổ — cho thanh lọc (xem repo)."""
        return self.repo.dem_theo_to(**kw)

    def phong_ban_options(self) -> list[dict]:
        """TỔ cho dropdown 'Phòng ban / Tổ phụ trách' ở form Công đoạn (`{id, ma, ten}`).

        Dùng ĐỊNH NGHĨA CHUNG `to_san_xuat()` = nút LÁ trong nhánh Khối Sản xuất (mục H). Trước
        đây endpoint này đổ CẢ CHA LẪN CON, nên người khai chọn được "Xưởng in" (một tầng giữa)
        làm tổ phụ trách — và quỹ giờ-người ở bàn xếp lịch đếm chồng quân số của chính tổ con.

        CHỈ nút lá, không ngoại lệ (07/10/2026). Trước đó nút cha đang được công đoạn trỏ tới vẫn
        được kèm vào với nhãn "(không còn là tổ)" — người dùng không muốn thấy nút cha ở ô này.
        Công đoạn còn trỏ nút cha thì ô chọn bày nó thành chip "không còn trong danh sách" để gỡ.

        Ở tầng service chứ không phải router (trước 15/08/2026 nó nằm trong
        `routers/cong_doan.list_phong_ban_options`, và router tự dựng hai repository).
        """
        return [{"id": d.id, "ma": d.code, "ten": d.name} for d in self.repo.phong_ban_tos()]

    # ⚠️ `dau_viec_options()` GỠ 18/09/2026 (mg `0320`): bảng "Đầu việc và định mức của tổ" đã
    #    biến khỏi drawer Công đoạn nên không còn dropdown nào cần đổ. Việc khoán của tổ nay đọc ở
    #    bàn tổ lúc ghi mẻ (`san_xuat/san_luong.viec_khoan_cua_to`).
