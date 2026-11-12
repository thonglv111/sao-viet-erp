"""Chọn nguồn giấy + dựng khâu chuẩn bị giấy khi lập lệnh (spec 2026-10-24-chuan-bi-giay §7).

Hàm thuần: không đụng DB. Tồn tự do hỏi qua callable `ton_tu_do(khoa) -> float` với khoá `khoa_ton`
như kho thật, nên lớp gọi tự quyết đọc tồn từ đâu (giữ chỗ, bài ghép).

Thứ tự ưu tiên: tờ đúng khổ in (lấy thẳng) → tờ khổ nguyên (thêm Tề giấy in) → cuộn rộng bằng một
cạnh khổ nguyên, dư tối đa 30 mm (thêm Cắt giấy cuộn, rồi Tề nếu khổ nguyên > khổ in) → đề nghị mua.
Luật này nay chỉ còn bài ghép dùng; lệnh rời đi qua `phuong_an_lay` bên dưới.

Phương án lấy ở kho (12/11/2026, mockup chuan-bi-vat-lieu.html): mỗi khổ đang có trong kho chứa được khổ
cần là một phương án, chấm 100 điểm = đủ tồn 50 + ít bước chuẩn bị 30 + ít thừa giấy 20, lấy 8 cao nhất.
Luôn có phương án "tờ đúng khổ cần" kể cả tồn 0: thiếu thì Kế hoạch vật tư đề nghị mua.
"""
from __future__ import annotations

import math
from typing import Callable, NamedTuple

from app.models.cong_doan import CD_CAT_CUON, CD_TE_GIAY_IN, CD_TE_SONG
from app.services.kho_giay import chuan_kho, kg_tu_to, khoa_ton

NGUON_GIAY = ("to_in", "to_nguyen", "cuon", "mua")
CUON_DU_TOI_DA_MM = 30


class DauVaoGiay(NamedTuple):
    giay_id: int
    gsm: float
    kho_in: tuple[int, int]
    kho_nguyen: tuple[int, int] | None
    so_to_in: int
    so_manh_xa: int | None


class NguonChon(NamedTuple):
    nguon: str
    rong_cuon: int | None
    ly_do: str | None


class BuocChuanBi(NamedTuple):
    ma: str
    dong_giay: dict | None


def kho_nguyen_dung_duoc(kho_nguyen, kho_in) -> bool:
    """Khổ nguyên đủ hai cạnh và CHỨA ĐƯỢC khổ in (xoay được). Số mảnh xả không đủ để xét: engine ép
    tối thiểu 1 mảnh cả khi khổ nguyên nhỏ hơn khổ in."""
    ngan, dai = chuan_kho(*(kho_nguyen or (0, 0)))
    in_ngan, in_dai = chuan_kho(*(kho_in or (0, 0)))
    return bool(ngan and dai and in_ngan and in_dai and ngan >= in_ngan and dai >= in_dai)


def _co_kho_nguyen(dv: DauVaoGiay) -> bool:
    return bool(dv.so_manh_xa and dv.so_manh_xa > 0 and kho_nguyen_dung_duoc(dv.kho_nguyen, dv.kho_in))


def can_tgi(dv: DauVaoGiay) -> bool:
    """Có khổ nguyên khác khổ in ⇒ cần Tề giấy in từ tờ nguyên xuống khổ in (spec §7: bỏ Tề chỉ khi
    khổ nguyên = khổ in — một mảnh mà khổ lớn hơn vẫn phải Tề)."""
    return _co_kho_nguyen(dv) and chuan_kho(*dv.kho_nguyen) != chuan_kho(*dv.kho_in)


def _to_nguyen_can(dv: DauVaoGiay) -> int:
    return math.ceil(dv.so_to_in / dv.so_manh_xa)


def _canh_con_lai(kho_nguyen: tuple[int, int], rong_cuon: int) -> int:
    """Cạnh khổ nguyên KHÔNG khớp rộng cuộn. Khớp cả hai cạnh ⇒ coi cạnh lớn là cạnh khớp."""
    ngan, dai = chuan_kho(*kho_nguyen)
    return ngan if dai <= rong_cuon <= dai + CUON_DU_TOI_DA_MM else dai


def _khoa_to_in(dv: DauVaoGiay) -> tuple:
    return khoa_ton("giay", dv.giay_id, goc="to", kho_rong=dv.kho_in[0], kho_dai=dv.kho_in[1])


def _khoa_to_nguyen(dv: DauVaoGiay) -> tuple:
    return khoa_ton("giay", dv.giay_id, goc="to", kho_rong=dv.kho_nguyen[0], kho_dai=dv.kho_nguyen[1])


def _rong_cuon_thu(dv: DauVaoGiay) -> list[int]:
    """Rộng cuộn dùng được: mỗi cạnh khổ nguyên, dư tối đa `CUON_DU_TOI_DA_MM`, hẹp trước."""
    return sorted({w for canh in dv.kho_nguyen for w in range(canh, canh + CUON_DU_TOI_DA_MM + 1)})


def _khoa_cuon(dv: DauVaoGiay, w: int) -> tuple:
    return khoa_ton("giay", dv.giay_id, goc="kg", kho_rong=w, kho_dai=0)


def khoa_ung_vien(dv: DauVaoGiay) -> list[tuple]:
    """Mọi khoá tồn `chon_nguon` có thể hỏi — bên gọi đọc tồn tự do MỘT lượt cho cả danh sách."""
    if not _co_kho_nguyen(dv):
        return [_khoa_to_in(dv)]
    return [_khoa_to_in(dv), _khoa_to_nguyen(dv), *(_khoa_cuon(dv, w) for w in _rong_cuon_thu(dv))]


def chon_nguon(dv: DauVaoGiay, ton_tu_do: Callable[[tuple], float]) -> NguonChon:
    if ton_tu_do(_khoa_to_in(dv)) >= dv.so_to_in:
        return NguonChon("to_in", None, None)
    if not _co_kho_nguyen(dv):
        return NguonChon("mua", None, "thiếu khổ nguyên")
    can = _to_nguyen_can(dv)
    if can_tgi(dv) and ton_tu_do(_khoa_to_nguyen(dv)) >= can:
        return NguonChon("to_nguyen", None, None)
    for w in (_rong_cuon_thu(dv) if dv.gsm else ()):   # chưa khai định lượng ⇒ không tính được kg cuộn
        if ton_tu_do(_khoa_cuon(dv, w)) >= kg_tu_to(can, w, _canh_con_lai(dv.kho_nguyen, w), dv.gsm):
            return NguonChon("cuon", w, None)
    return NguonChon("mua", None, None)


def ma_buoc_giay(nguon: str, dv: DauVaoGiay) -> list[str]:
    """Mã công đoạn chuẩn bị chèn trước bước đầu của chuỗi, theo thứ tự."""
    te = [CD_TE_GIAY_IN] if can_tgi(dv) else []
    if nguon == "cuon":
        # Cuộn LUÔN qua Tề (L-SX-21, chủ chốt 26/10/2026): Cắt giấy cuộn khoá `to_nguyen → to_nguyen`
        # còn In nhận `to`, nên cuộn cắt đúng khổ in mà bỏ Tề là chuỗi đứt đơn vị, lưu không được.
        return [CD_CAT_CUON, CD_TE_GIAY_IN]
    if nguon in ("to_nguyen", "mua"):
        return te
    return []


def dong_giay_buoc_dau(nguon: NguonChon, dv: DauVaoGiay, so_to_vao_buoc_dau: int) -> dict:
    """Dòng giấy xin kho của bước ĐẦU chuỗi (bước chuẩn bị nếu có, không thì bước In).

    Cắt cuộn ⇒ kg theo rộng cuộn × cạnh còn lại; Tề ⇒ tờ khổ nguyên; không có bước chuẩn bị ⇒ tờ khổ in.
    `so_to_vao_buoc_dau` đã gồm bù hao của bước đó (tờ nguyên hoặc tờ in tuỳ bước)."""
    dong = {"hang_loai": "giay", "vat_tu_id": dv.giay_id}
    if nguon.nguon == "cuon":
        kg = kg_tu_to(so_to_vao_buoc_dau, nguon.rong_cuon, _canh_con_lai(dv.kho_nguyen, nguon.rong_cuon), dv.gsm)
        # Đề nghị kho lưu 2 số lẻ ⇒ làm tròn LÊN tới 0,01 kg, cấp đủ đề nghị là đủ nhu cầu (không treo
        # vài gam "còn phải lấy" ở bảng cân đối). 1e-9 để số tròn sẵn không nhảy thêm 0,01.
        kg = math.ceil(kg * 100 - 1e-9) / 100
        return {**dong, "so_luong": kg, "don_vi_goc": "kg", "kho_rong": nguon.rong_cuon, "kho_dai": 0}
    kr, kd = chuan_kho(*(dv.kho_nguyen if CD_TE_GIAY_IN in ma_buoc_giay(nguon.nguon, dv) else dv.kho_in))
    return {**dong, "so_luong": so_to_vao_buoc_dau, "don_vi_goc": "to", "kho_rong": kr, "kho_dai": kd}


def dong_song(song_id: int, kho_in: tuple[int, int], so_to_vao_ts: int) -> dict:
    """Dòng sóng xin kho của bước Tề sóng: tờ khổ in."""
    kr, kd = chuan_kho(*kho_in)
    return {"hang_loai": "giay", "vat_tu_id": song_id, "so_luong": so_to_vao_ts, "don_vi_goc": "to",
            "kho_rong": kr, "kho_dai": kd}


# ── Phương án lấy ở kho (lệnh rời) ───────────────────────────────────────────────────────────────

SO_PHUONG_AN = 8
DIEM_TON, DIEM_BUOC, DIEM_THUA = 50, 30, 20
TRU_MOT_BUOC = 10
THUA_HET_DIEM = 0.5  # thừa bằng nửa diện tích cần ⇒ 0 điểm thừa


class KhoLay(NamedTuple):
    dang: str  # "to" | "cuon"
    rong: int
    dai: int  # cuộn: 0


class PhuongAn(NamedTuple):
    kho: KhoLay
    so_manh: int
    canh_cat: int | None  # cuộn: chiều dài mỗi tờ cắt ra
    ma_buoc: list[str]
    can: float  # tờ hoặc kg cần lấy ở kho
    don_vi: str  # "to" | "kg"
    ton: float
    diem: int
    thua: float  # tỉ lệ diện tích thừa so với phần dùng


def _kho(kho: KhoLay) -> KhoLay:
    if kho.dang == "cuon":
        return KhoLay("cuon", int(kho.rong), 0)
    return KhoLay("to", *chuan_kho(kho.rong, kho.dai))


def so_manh(kho: KhoLay, kho_can: tuple[int, int]) -> tuple[int, int | None]:
    """Số khổ cần lấy được từ một tờ (xoay được), hoặc từ một nhát cắt cuộn. Cuộn trả kèm cạnh cắt:
    cắt dài bằng cạnh dài khổ cần (xếp cạnh ngắn theo bề rộng) hay ngược lại, cách nào nhiều mảnh hơn,
    hoà thì cách thừa ít hơn."""
    w, h = chuan_kho(*kho_can)
    if not (w and h):
        return 0, None
    if kho.dang == "cuon":
        r = int(kho.rong)
        cach = [(r // w, h, (r - (r // w) * w) * h), (r // h, w, (r - (r // h) * h) * w)]
        manh, canh, _ = max(cach, key=lambda c: (c[0], -c[2]))
        return (manh, canh) if manh else (0, None)
    a, b = chuan_kho(kho.rong, kho.dai)
    return max((a // w) * (b // h), (a // h) * (b // w)), None


def ma_buoc_lay(vat_lieu: str, kho: KhoLay, kho_can: tuple[int, int]) -> list[str]:
    """Bước chuẩn bị chèn trước bước nhận vật liệu. Cuộn LUÔN Cắt cuộn rồi Tề (L-SX-21: Cắt giấy cuộn ra
    `to_nguyen`, In nhận `to`)."""
    te = CD_TE_SONG if vat_lieu == "song" else CD_TE_GIAY_IN
    if kho.dang == "cuon":
        return [CD_CAT_CUON, CD_TE_GIAY_IN]
    return [] if chuan_kho(kho.rong, kho.dai) == chuan_kho(*kho_can) else [te]


def nguon_dan_xuat(kho: KhoLay, kho_can: tuple[int, int]) -> str:
    """Giá trị `lsx.nguon_giay` suy từ khổ đang lấy (giữ cho chỗ cũ còn đọc)."""
    if kho.dang == "cuon":
        return "cuon"
    return "to_in" if chuan_kho(kho.rong, kho.dai) == chuan_kho(*kho_can) else "to_nguyen"


def _phuong_an(vat_lieu, kho, kho_can, so_to_can, gsm, ton) -> PhuongAn | None:
    manh, canh = so_manh(kho, kho_can)
    if not manh:
        return None
    w, h = chuan_kho(*kho_can)
    so_to_kho = math.ceil(so_to_can / manh) if so_to_can > 0 else 0
    if kho.dang == "cuon":
        dt = kho.rong * canh
        can = math.ceil(kg_tu_to(so_to_kho, kho.rong, canh, gsm) * 100 - 1e-9) / 100
        don_vi = "kg"
    else:
        dt = kho.rong * kho.dai
        can, don_vi = so_to_kho, "to"
    dung = manh * w * h
    thua = (dt - dung) / dung
    buoc = ma_buoc_lay(vat_lieu, kho, kho_can)
    d_ton = DIEM_TON if can <= 0 or ton >= can else DIEM_TON * max(ton, 0) / can
    d_buoc = max(0, DIEM_BUOC - TRU_MOT_BUOC * len(buoc))
    d_thua = max(0.0, DIEM_THUA * (1 - thua / THUA_HET_DIEM))
    return PhuongAn(kho, manh, canh, buoc, can, don_vi, ton, round(d_ton + d_buoc + d_thua), thua)


def phuong_an_lay(vat_lieu: str, kho_can: tuple[int, int], so_to_can: int, gsm: float,
                  ton: list[tuple[int, int, str, float]]) -> list[PhuongAn]:
    """Phương án lấy vật liệu ở kho, điểm cao trước, tối đa `SO_PHUONG_AN`.

    `ton` = [(rộng, dài, đơn vị gốc, tồn tự do)] như `ton_giay_theo_kho` (cuộn: dài 0, tồn kg). Tờ lưu
    theo kg đổi ra tờ theo khổ. Sóng không xét cuộn. Khổ không chứa nổi một mảnh khổ cần thì bỏ."""
    kho_can = chuan_kho(*kho_can)
    gop: dict[KhoLay, float] = {}
    for rong, dai, goc, so in ton:
        if not rong:
            continue
        kho = _kho(KhoLay("cuon" if not dai else "to", rong, dai or 0))
        # Sóng không xét cuộn; giấy chưa khai định lượng (mg 0475) thì không quy được tờ ra kg
        # cuộn nên bỏ cuộn, khỏi ra phương án "cần 0 kg".
        if kho.dang == "cuon" and (vat_lieu == "song" or not gsm):
            continue
        so = float(so or 0)
        if kho.dang == "to" and goc == "kg":
            mot_to = kg_tu_to(1, kho.rong, kho.dai, gsm)
            so = so / mot_to if mot_to else 0.0
        gop[kho] = gop.get(kho, 0.0) + so
    gop.setdefault(KhoLay("to", *kho_can), 0.0)
    ds = [pa for kho, so in gop.items() if (pa := _phuong_an(vat_lieu, kho, kho_can, so_to_can, gsm, so))]
    ds.sort(key=lambda p: (-p.diem, len(p.ma_buoc), p.thua, p.kho))
    return ds[:SO_PHUONG_AN]
