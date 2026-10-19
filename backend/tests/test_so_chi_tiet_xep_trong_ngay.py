"""Sao kê công nợ: cùng ngày thì chứng từ phát sinh nợ đứng trước phiếu trả (lỗi #73 bấm lại 19/10/2026).

Công nợ NCC tab Sao kê xếp phiếu chi 09:00 trước đợt nhận hàng nhập vào hệ 10:00 cùng ngày, nên số
dư giữa kỳ ra âm (−300.000, −1.190.000) dù NCC chưa bao giờ bị trả trước.
"""
from __future__ import annotations

from datetime import date, datetime

from app.services.bao_cao_cong_no import _so_chi_tiet

NGAY = date(2026, 10, 18)


def _ct(loai, so_ct, gio, net):
    return {"doi_tuong_id": 7, "ngay": NGAY, "loai": loai, "so_ct": so_ct,
            "luc": datetime(2026, 10, 18, gio), "net": net, "dien_giai": "", "tk_doi_ung": ""}


def test_dot_nhan_hang_dung_truoc_phieu_chi_cung_ngay():
    so = _so_chi_tiet(
        [_ct("phieu_chi", "PC00040", 9, 300_000), _ct("dot_giao", "DMH-1 đợt 2", 10, -390_000)],
        doi_tuong_id=7, tu_ngay=NGAY, den_ngay=NGAY, tk="331", tieu_de="", ten_khong_gan="",
    )
    assert [d["so_ct"] for d in so["dong"]] == ["DMH-1 đợt 2", "PC00040"]
