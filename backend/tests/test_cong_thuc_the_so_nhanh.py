"""`cong_thuc_chu` / `cong_thuc_the_so` chỉ đụng biến CÓ trong công thức (26/10/2026).

Trải lịch một bàn tháng gọi hai hàm này cho mọi bước; bản cũ chạy `re.sub` cho từng biến của cả từ
điển dù công thức chỉ dùng hai ba biến. Kết quả phải y nguyên bản cũ.
"""
from __future__ import annotations

import re

import app.services.don_vi_do_service as M
from app.services.bien_cong_thuc import LOAI_QUY_DOI, bien_cho
from app.services.quy_doi_service import _so


def _chu_cu(ct):
    ra = ct or ""
    for b in bien_cho(LOAI_QUY_DOI):
        ra = re.sub(rf"\b{b['ma']}\b", b["nhan"], ra)
    return ra.replace("*", "×").replace("/", "÷")


def _the_so_cu(ct, ctx):
    ra = ct or ""
    for b in sorted(bien_cho(LOAI_QUY_DOI), key=lambda x: -len(x["ma"])):
        if b["ma"] in ctx and ctx[b["ma"]] is not None:
            ra = re.sub(rf"\b{b['ma']}\b", _so(ctx[b["ma"]]), ra)
    return ra.replace("*", "×").replace("/", "÷")


MA = [b["ma"] for b in bien_cho(LOAI_QUY_DOI)]
CONG_THUC = [
    "", "sl_vao", "sl_ra * 200", "sl_vao / so_luot_chay", "(sl_vao + sl_ra) * 2 / 3",
    " * ".join(MA[:6]), " + ".join(MA), "max(sl_vao, 1) * khong_co_bien_nay",
]


def test_ket_qua_y_nguyen_ban_cu():
    ctx = {m: i * 1.5 + 0.25 for i, m in enumerate(MA)}
    ctx_thieu = {m: (None if i % 3 == 0 else i) for i, m in enumerate(MA) if i % 2 == 0}
    for ct in CONG_THUC:
        assert M.cong_thuc_chu(ct) == _chu_cu(ct), ct
        for c in (ctx, ctx_thieu, {}):
            assert M.cong_thuc_the_so(ct, c) == _the_so_cu(ct, c), ct


def test_chi_thay_bien_co_trong_cong_thuc(monkeypatch):
    dem = [0]
    goc = re.sub

    def dem_sub(*a, **k):
        dem[0] += 1
        return goc(*a, **k)

    monkeypatch.setattr(M.re, "sub", dem_sub)
    ctx = {m: 2 for m in MA}
    M.cong_thuc_the_so("sl_ra * 200", ctx)
    assert dem[0] <= 2, dem[0]
