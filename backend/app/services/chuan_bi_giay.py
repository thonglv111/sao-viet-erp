"""Chọn nguồn giấy + dựng khâu chuẩn bị giấy khi lập lệnh (spec 2026-10-24-chuan-bi-giay §7).

Hàm thuần: không đụng DB. Tồn tự do hỏi qua callable `ton_tu_do(khoa) -> float` với khoá `khoa_ton`
như kho thật, nên lớp gọi tự quyết đọc tồn từ đâu (giữ chỗ, bài ghép).

Thứ tự ưu tiên: tờ đúng khổ in (lấy thẳng) → tờ khổ nguyên (thêm Tề giấy in) → cuộn rộng bằng một
cạnh khổ nguyên, dư tối đa 30 mm (thêm Cắt giấy cuộn, rồi Tề nếu khổ nguyên > khổ in) → đề nghị mua.
"""
from __future__ import annotations

import math
from typing import Callable, NamedTuple

from app.models.cong_doan import CD_CAT_CUON, CD_TE_GIAY_IN
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


def _co_kho_nguyen(dv: DauVaoGiay) -> bool:
    return bool(dv.kho_nguyen and all(dv.kho_nguyen) and dv.so_manh_xa and dv.so_manh_xa > 0)


def can_tgi(dv: DauVaoGiay) -> bool:
    """Có khổ nguyên và xả ra hơn một mảnh ⇒ cần Tề giấy in từ tờ nguyên xuống khổ in."""
    return _co_kho_nguyen(dv) and dv.so_manh_xa > 1


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
    for w in _rong_cuon_thu(dv):
        if ton_tu_do(_khoa_cuon(dv, w)) >= kg_tu_to(can, w, _canh_con_lai(dv.kho_nguyen, w), dv.gsm):
            return NguonChon("cuon", w, None)
    return NguonChon("mua", None, None)


def ma_buoc_giay(nguon: str, dv: DauVaoGiay) -> list[str]:
    """Mã công đoạn chuẩn bị chèn trước bước đầu của chuỗi, theo thứ tự."""
    te = [CD_TE_GIAY_IN] if can_tgi(dv) else []
    if nguon == "cuon":
        return [CD_CAT_CUON, *te]
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
