"""Khổ + đơn vị gốc của giấy (spec 2026-10-01-giay-dem-to-theo-kho; bỏ dạng cuộn/tờ 10/10/2026).
MỘT nơi chuẩn hoá — đừng tự min/max."""
from __future__ import annotations

import math

#: Khoá so tồn / giữ chỗ / nhu cầu: (hang_loai, hang_id, kho_rong, kho_dai, don_vi_goc).
#: Giấy KHÔNG còn DẠNG cuộn/tờ (chủ chốt 10/10/2026): một mã giấy tách theo KHỔ + ĐƠN VỊ GỐC của dòng.
#: Vật tư khác (cả thành phẩm — kho mang `vat_tu`) tách theo ĐƠN VỊ GỐC, khổ 0 · 0 (mg 0390). Đơn vị
#: gốc = đơn vị đã khai ở danh mục mà nhóm của nó chứa ĐVT dòng (`GocMatHang`). Hàng khác: "".
Khoa = tuple[str, int, int, int, str]

#: `hang_loai` mà dòng kho / mua / nhu cầu mang ĐƠN VỊ GỐC (danh mục khai được nhiều đơn vị).
CO_DON_VI_GOC = frozenset({"giay", "vat_tu"})


def co_don_vi_goc(hang_loai: str | None) -> bool:
    return hang_loai in CO_DON_VI_GOC


def _mm(x) -> int:
    try:
        v = int(round(float(x)))
    except (TypeError, ValueError):
        return 0
    return v if v > 0 else 0


def chuan_kho(a, b) -> tuple[int, int]:
    """Hai cạnh mm, thứ tự tuỳ ý → (cạnh ngắn, cạnh dài). Thiếu cạnh = 0; một cạnh ⇒ (cạnh, 0)."""
    x, y = _mm(a), _mm(b)
    if x and y:
        return (min(x, y), max(x, y))
    return (x or y, 0)


def la_kho_to(rong_mm, dai_mm) -> bool:
    """Khổ ĐỦ hai cạnh ⇒ giấy tờ (số tờ là gốc). Một cạnh ⇒ cuộn, đếm kg."""
    return bool(_mm(rong_mm) and _mm(dai_mm))


def kg_tu_to(so_to: float, rong_mm: float, dai_mm: float, gsm: float) -> float:
    """kg = số tờ × rộng/1000 × dài/1000 × gsm/1000 (spec 2026-10-24-chuan-bi-giay §5)."""
    return float(so_to) * float(rong_mm) / 1000 * float(dai_mm) / 1000 * float(gsm) / 1000


def to_tu_kg(kg: float, rong_mm: float, dai_mm: float, gsm: float) -> int:
    """Số tờ từ kg, LÀM TRÒN XUỐNG — tờ lẻ không có thật. Thiếu khổ hai cạnh / gsm ⇒ ValueError."""
    if not la_kho_to(rong_mm, dai_mm) or not gsm or float(gsm) <= 0:
        raise ValueError("Cần đủ khổ hai cạnh và định lượng để quy kg ra tờ.")
    # Cộng 1e-9 để 299.35 kg đúng bằng N tờ không rơi xuống N−1 vì sai số dấu phẩy động.
    return math.floor(float(kg) / kg_tu_to(1, rong_mm, dai_mm, gsm) + 1e-9)


def dinh_luong_va_quy_kg(hang_loai: str, mat_hang, so_luong, kho_rong, kho_dai,
                         don_vi_goc: str | None) -> tuple[int | None, float | None]:
    """Hai ô chỉ đọc của dòng tồn (spec 2026-10-24-chuan-bi-giay §6): `(định lượng, quy kg)`.
    Định lượng = gsm của danh mục, chỉ giấy. Quy kg chỉ cho giấy TỜ (gốc tờ, khổ hai cạnh, có gsm);
    cuộn đã đếm kg ⇒ None."""
    if hang_loai != "giay":
        return None, None
    gsm = getattr(mat_hang, "gsm", None) or None
    if not gsm or _goc(don_vi_goc) != DON_VI_TO_KHO or not la_kho_to(kho_rong, kho_dai):
        return gsm, None
    return gsm, round(kg_tu_to(float(so_luong or 0), kho_rong, kho_dai, gsm), 2)


def _goc(goc) -> str:
    return (goc or "").strip().lower()


def khoa_ton(hang_loai: str, hang_id: int, *, goc: str | None = None,
             kho_rong=0, kho_dai=0) -> Khoa:
    """Giấy: (giay, id, rộng, dài, đơn vị gốc) — khổ chỉ-rộng là (rộng, 0) và KHÔNG khớp khổ hai
    cạnh; cùng khổ khác đơn vị gốc (tờ vs kg) là hai món. Vật tư: (vat_tu, id, 0, 0, đơn vị gốc).
    Hàng khác: (loai, id, 0, 0, "")."""
    if hang_loai == "vat_tu":
        return ("vat_tu", int(hang_id), 0, 0, _goc(goc))
    if hang_loai != "giay":
        return (hang_loai, int(hang_id), 0, 0, "")
    kr, kd = chuan_kho(kho_rong, kho_dai)
    return ("giay", int(hang_id), kr, kd, _goc(goc))


def khoa_dong(hang_loai: str, hang_id: int, goc: str | None, kho_rong=0, kho_dai=0) -> tuple:
    """Khoá CHỐNG TRÙNG dòng trên một chứng từ (yêu cầu kho, phiếu, đề nghị cấp): cùng mã khác
    khổ / khác đơn vị gốc là hai dòng hợp lệ (vật tư: cùng mã khác đơn vị gốc)."""
    if hang_loai == "vat_tu":
        return ("vat_tu", int(hang_id), _goc(goc) or None, 0, 0)
    if hang_loai != "giay":
        return (hang_loai, int(hang_id), None, 0, 0)
    kr, kd = chuan_kho(kho_rong, kho_dai)
    return ("giay", int(hang_id), _goc(goc), kr, kd)


def don_vi_khai(obj) -> list[str]:
    """Danh sách đơn vị KHAI ở danh mục của một mã: ĐVT chính (`don_vi_gia`) rồi `don_vi_them`, chữ
    thường, bỏ rỗng / trùng. Mỗi đơn vị là gốc của một nhóm quy đổi (spec 2026-10-10 nhiều ĐVT)."""
    ra: list[str] = []
    for u in [getattr(obj, "don_vi_gia", None), *(getattr(obj, "don_vi_them", None) or [])]:
        g = _goc(u)
        if g and g not in ra:
            ra.append(g)
    return ra


class GocMatHang:
    """ĐƠN VỊ GỐC của một dòng (giấy / vật tư) suy từ ĐVT dòng + danh sách đơn vị đã khai — MỘT luật
    cho kho, mua hàng, kế hoạch vật tư (spec 2026-10-10-mat-hang-nhieu-don-vi-tinh): gốc là đơn vị đã
    khai mà nhóm quy đổi của nó (module Đơn vị) chứa ĐVT dòng; không thuộc nhóm nào ⇒ None (người gọi
    chặn "đơn vị chưa khai"). Mã chặng tờ của lệnh (`to_nguyen`) tính như `to`. Dựng một lần mỗi lượt
    (đọc bảng đơn vị + cặp)."""

    def __init__(self, dvs: dict, cap_rows) -> None:
        self._dvs, self._cap = dvs, list(cap_rows or [])
        self._ho: dict[str, frozenset] = {}

    @classmethod
    def tu_db(cls, db) -> "GocMatHang":
        from ..repositories.don_vi_do_repo import DonViDoRepository
        from .quy_doi_service import don_vi_map

        repo = DonViDoRepository(db)
        return cls(don_vi_map(repo.all_rows()), repo.cap_rows())

    def ho(self, goc: str) -> frozenset:
        """Mã + tên (chữ thường) mọi đơn vị đổi được về `goc`."""
        g = _goc(goc)
        if g not in self._ho:
            from .quy_doi_service import don_vi_dung_duoc

            ds = don_vi_dung_duoc(g, self._dvs, self._cap, None)
            ten = {_goc(d.get("ten")) for d in ds if d.get("ten")}
            self._ho[g] = frozenset({_goc(d["ma"]) for d in ds} | ten | {g})
        return self._ho[g]

    def goc(self, dvt: str | None, khai) -> str | None:
        """`khai`: danh sách đơn vị đã khai (`don_vi_khai`). ĐVT trống ⇒ ĐVT chính."""
        ds = [g for g in (_goc(u) for u in (khai or [])) if g]
        m = _goc(dvt)
        if not m:
            return ds[0] if ds else None
        if la_ma_to_giay(m):
            m = DON_VI_TO_KHO
        for u in ds:
            if m == u or m in self.ho(u):
                return u
        return None

    def cung_nhom(self, a: str | None, b: str | None) -> bool:
        """Hai đơn vị cùng một nhóm quy đổi (khai thêm đơn vị cùng nhóm là thừa — bị chặn)."""
        x, y = _goc(a), _goc(b)
        if not x or not y:
            return False
        if la_ma_to_giay(x):
            x = DON_VI_TO_KHO
        if la_ma_to_giay(y):
            y = DON_VI_TO_KHO
        return x == y or y in self.ho(x) or x in self.ho(y)


def nhan_kho(kho_rong: int, kho_dai: int) -> str:
    """"780 × 905 mm" · khổ chỉ-rộng "khổ 1000 mm" · không có ⇒ "chưa có khổ"."""
    if kho_rong and kho_dai:
        return f"{kho_rong} × {kho_dai} mm"
    if kho_rong:
        return f"khổ {kho_rong} mm"
    return "chưa có khổ"


#: Đơn vị đếm giấy TỜ ở KHO và MUA HÀNG (chủ chốt 07/10/2026): một chữ "tờ" — tờ nào khác tờ nào
#: là do KHỔ. Chữ "tờ nguyên / tờ in" chỉ còn trong sản xuất (mã chặng, xem `don_vi_do.TRAM_*`).
DON_VI_TO_KHO = "to"

#: Hai đơn vị mọi mã giấy BẮT BUỘC có (chốt 18/10/2026): bước nhận tờ đếm tờ, bước ra kg đếm kg.
#: Ở module Đơn vị & quy đổi hai mã này bị KHOÁ — không xoá, không ngừng dùng, không đổi mã.
GIAY_DON_VI_BAT_BUOC = (DON_VI_TO_KHO, "kg")


def la_ma_to_giay(dvt: str | None) -> bool:
    """Mã đếm TỜ của dòng giấy: đơn vị kho `to` hoặc mã chặng tờ của lệnh (`to_nguyen`, `to`).
    Qua cửa kho các mã này là MỘT đơn vị, hệ số 1."""
    from ..models.don_vi_do import TRAM_TO, TRAM_TO_NGUYEN

    return (dvt or "").strip().lower() in {DON_VI_TO_KHO, TRAM_TO_NGUYEN, TRAM_TO}


def don_vi_goc_to() -> str:
    """MÃ đơn vị đếm lô/dòng giấy TỜ ở kho và mua hàng."""
    return DON_VI_TO_KHO


def goi_y_dong_giay(qc: dict) -> dict:
    """Gợi ý dòng giấy của bước lệnh (spec §4.2) từ quy cách đã gộp số cột (`quy_cach_bien`):
    khổ nguyên + số tờ nguyên; thiếu khổ nguyên thì khổ tờ in + số tờ vào máy. Không công thức.

    Trả `{so_luong, kho_rong, kho_dai, don_vi, dien_giai, ly_do}`; chưa đủ dữ kiện ⇒ `so_luong=None`
    kèm `ly_do` (ô để trống cho người lập lệnh gõ, khổ vẫn điền nếu có)."""
    def so(*khoa):
        for k in khoa:
            try:
                v = float(qc.get(k) or 0)
            except (TypeError, ValueError):
                v = 0.0
            if v > 0:
                return v
        return 0.0

    kr, kd = chuan_kho(so("kho_nguyen_dai", "kho_dai"), so("kho_nguyen_rong", "kho_rong"))
    nguon, to = "khổ nguyên", so("to_nguyen")
    if not (kr and kd):
        kr, kd = chuan_kho(so("kho_in_dai"), so("kho_in_rong"))
        nguon, to = "khổ tờ in", so("to_dau_vao")
    if not (kr and kd):
        kr = kd = 0
    from ..models.don_vi_do import TRAM_TO_NGUYEN

    # Dòng giấy của BƯỚC lệnh là dữ liệu SẢN XUẤT ⇒ mã chặng tờ nguyên, không phải đơn vị kho.
    out = {"kho_rong": kr, "kho_dai": kd, "don_vi": TRAM_TO_NGUYEN,
           "so_luong": None, "dien_giai": None, "ly_do": None}
    if not (kr and kd):
        out["ly_do"] = "Lệnh chưa có khổ giấy — gõ tay."
    elif to <= 0:
        out["ly_do"] = "Lệnh chưa có số tờ — gõ tay."
    else:
        out["so_luong"] = round(to, 3)
        out["dien_giai"] = f"Theo {nguon} của lệnh {nhan_kho(kr, kd)}"
    return out


def dong_giay_theo_dau_vao(*, don_vi_vao: str | None, so_luong_vao: float, so_luong_ra: float,
                           quy_cach: dict, gsm: float | None, tram_ra: str | None = None) -> dict:
    """Dòng giấy của MỘT bước, dẫn xuất từ ĐẦU VÀO của bước — MỘT luật cho phiếu tính giá, lệnh, kế
    hoạch vật tư (chốt 18/10/2026, spec 2026-10-18-luong-giay-theo-dau-vao-buoc).

    - Nhận tờ in (`TRAM_TO`) ⇒ SL vào, đếm tờ, khổ tờ in (thiếu thì khổ nguyên).
    - Nhận tờ nguyên (`TRAM_TO_NGUYEN`) ⇒ SL vào, đếm tờ, khổ nguyên.
    - Nhận con / cái ⇒ **kg** = gsm × khổ chi tiết (khổ thành phẩm) × SL vào; nhận tay (tờ gấp) ⇒
      khổ tờ in. Khổ của dòng = khổ ấy.
    - Đầu vào "—" (bỏ trống, vd cắt từ cuộn) hoặc đơn vị ngoài 5 chặng ⇒ **kg** = gsm × khổ tờ RA ×
      SL ra. Bên gọi tìm SL ra (chuỗi bù hao ngược: SL vào của bước kế tiếp) và `tram_ra` = chặng của
      thứ đó (tờ in ⇒ khổ in, còn lại ⇒ khổ nguyên). Khổ của dòng chỉ còn cạnh rộng, `hien_kho=False`.

    `don_vi` = mã chặng vào ở nhánh tờ, "kg" ở nhánh cân — bên gọi đổi sang đơn vị của mã giấy.
    `kho_tinh` = (rộng, dài) mm đã dùng để tính — đủ hai cạnh kể cả khi khổ của dòng chỉ còn cạnh rộng.
    Thiếu khổ / gsm ⇒ `so_luong=None` + `ly_do`, không đoán số.
    """
    from ..models.don_vi_do import TRAM_CAI, TRAM_CON, TRAM_TAY, TRAM_TO, TRAM_TO_NGUYEN
    from .dong_giay import ban_do_tram, tram_cua

    def so(*khoa):
        for k in khoa:
            try:
                v = float((quy_cach or {}).get(k) or 0)
            except (TypeError, ValueError):
                v = 0.0
            if v > 0:
                return v
        return 0.0

    ng_r, ng_d = chuan_kho(so("kho_nguyen_rong"), so("kho_nguyen_dai"))
    in_r, in_d = chuan_kho(so("kho_in_rong"), so("kho_in_dai"))
    tp_r, tp_d = chuan_kho(so("rong_thanh_pham"), so("dai_thanh_pham"))
    tram = tram_cua(don_vi_vao, ban_do_tram()) if don_vi_vao else None
    out = {"so_luong": None, "don_vi": don_vi_vao or "", "kho_rong": 0,
           "kho_dai": 0, "hien_kho": True, "kho_tinh": (0, 0), "ly_do": None}
    if tram == TRAM_TO:
        kr, kd = (in_r, in_d) if (in_r and in_d) else (ng_r, ng_d)
        out.update(so_luong=float(so_luong_vao or 0), kho_rong=kr, kho_dai=kd, kho_tinh=(kr, kd))
        if not (kr and kd):
            out.update(so_luong=None, ly_do="Chưa có khổ giấy (khổ tờ in / khổ nguyên).")
        return out
    if tram == TRAM_TO_NGUYEN:
        out.update(so_luong=float(so_luong_vao or 0), kho_rong=ng_r, kho_dai=ng_d, kho_tinh=(ng_r, ng_d))
        if not (ng_r and ng_d):
            out.update(so_luong=None, ly_do="Chưa có khổ nguyên của giấy.")
        return out

    def _kg(sl: float, kr: int, kd: int, *, thieu_kho: str) -> None:
        out["kho_tinh"] = (kr, kd)
        if not (kr and kd):
            out.update(so_luong=None, ly_do=thieu_kho)
        elif not gsm or float(gsm) <= 0:
            out.update(so_luong=None, ly_do="Giấy chưa khai định lượng (gsm) nên không tính được số kg.")
        else:
            out["so_luong"] = float(sl or 0) * (kr / 1000) * (kd / 1000) * float(gsm) / 1000

    out["don_vi"] = "kg"
    if tram in (TRAM_CON, TRAM_CAI, TRAM_TAY):
        kr, kd = (in_r, in_d) if tram == TRAM_TAY else (tp_r, tp_d)
        out.update(kho_rong=kr, kho_dai=kd)
        _kg(so_luong_vao, kr, kd, thieu_kho=("Chưa có khổ tờ in để tính số kg giấy." if tram == TRAM_TAY
                                            else "Chưa có khổ thành phẩm (khổ của cái/con) để tính số kg giấy."))
        return out
    # "—" / đơn vị ngoài dòng giấy: lượng theo thứ bước NHẢ RA.
    kr, kd = (in_r, in_d) if tram_ra == TRAM_TO and in_r and in_d else (ng_r, ng_d)
    out.update(kho_rong=kr, kho_dai=0, hien_kho=False)
    _kg(so_luong_ra, kr, kd, thieu_kho="Chưa có khổ nguyên để tính số kg giấy.")
    return out


def khoa_ton_cua(obj) -> tuple:
    """Khoá tra tồn của một lô / dòng (có `hang_loai`, `hang_id`, `don_vi_goc`, `kho_rong`, `kho_dai`).
    Giấy + vật tư ⇒ `khoa_ton` 5 phần tử. Hàng khác ⇒ cặp `(loai, id)` — gom mọi lô của mã."""
    loai, hid = obj.hang_loai, int(obj.hang_id)
    if not co_don_vi_goc(loai):
        return (loai, hid)
    return khoa_ton(loai, hid, goc=getattr(obj, "don_vi_goc", "") or "",
                    kho_rong=getattr(obj, "kho_rong", 0) or 0, kho_dai=getattr(obj, "kho_dai", 0) or 0)
