"""CHỜ TRẢ TIỀN và PHIẾU CHI thuê gia công (spec 2026-11-13 §4.6) — ERPNext Purchase Invoice gộp nhiều
Purchase Receipt, bỏ PR/PI/bút toán.

  · Chờ trả tiền = phiếu nhận còn hiệu lực chưa có phiếu chi còn hiệu lực. Mỗi phiếu nhận kèm số đạt,
    hỏng, hụt (khi dòng đơn đã hoàn tất) cạnh tiền tạm tính — Q3: không tự trừ hỏng / hụt.
  · Một phiếu chi trả NHIỀU phiếu nhận CÙNG nhà gia công (khuôn phiếu chi cước giao): số tiền điền
    sẵn Σ tạm tính, sửa được theo hoá đơn thật; lệch thì bắt lý do, lý do vào nội dung phiếu. Tiền
    chia về từng phiếu nhận theo tỷ lệ tạm tính, phần lẻ dồn phiếu cuối (`tgc_phieu_chi_nhan`).
  · Không công nợ 331: không gắn `supplier_id`, `phieu_chi_cho_bao_cao` loại hẳn nguồn này.
  · Huỷ phiếu chi (màn Phiếu chi) ⇒ phiếu nhận tự về Chờ trả tiền (dòng nối chỉ tính phiếu sống).
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.accounting import VOUCHER_SOURCE_GIA_CONG
from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository
from . import thong_tin_lenh

_MAX_PHIEU = 50
_LY_DO_TOI_THIEU = 3


def _tam_tinh_dong(x) -> int:
    return int(round(float(x.sl_dat) * float(x.don_gia or 0)))


def _cac_dong(db: Session, repo: ThueGiaCongRepository, phieus) -> dict[int, list[dict]]:
    """`{phieu_nhan_id: [dòng]}` — tên việc, đạt, hỏng, hụt, đơn vị, đơn giá, tạm tính."""
    ids = [p.id for p in phieus]
    dongs = repo.dong_phieu_nhan(ids)
    dons = repo.nhieu_don({p.don_id for p in phieus})
    dds = {d.id: d for ds in repo.dong_cua_nhieu_don(dons.keys()).values() for d in ds}
    viecs = repo.nhieu_viec({d.viec_id for d in dds.values()})
    cvs = repo.cong_viec_cua_nhieu_viec(viecs.keys())
    out: dict[int, list[dict]] = {}
    for p in phieus:
        ra = []
        for x in dongs.get(p.id, []):
            dd = dds.get(x.don_dong_id)
            v = viecs.get(dd.viec_id) if dd else None
            cv_ds = cvs.get(dd.viec_id, []) if dd else []
            hut = None
            if dd is not None and dd.hoan_tat_luc is not None and dd.hao_hut is not None:
                hut = float(dd.hao_hut)
            ra.append({
                "ten_viec": v.ten_viec if v else "",
                "dat": float(x.sl_dat), "hong": float(x.sl_hong), "hut": hut,
                "don_vi": (dd.don_vi if dd and dd.don_vi else (cv_ds[-1].don_vi_ra if cv_ds else None)),
                "don_gia": float(x.don_gia or 0), "tam_tinh": _tam_tinh_dong(x),
            })
        out[p.id] = ra
    return out


def danh_sach(db: Session, *, q: str | None = None, nha_cung_cap_id: int | None = None) -> list[dict]:
    repo = ThueGiaCongRepository(db)
    phieus = repo.phieu_nhan_cho_tra(q=q, nha_cung_cap_id=nha_cung_cap_id)
    if not phieus:
        return []
    dons = repo.nhieu_don({p.don_id for p in phieus})
    dongs = _cac_dong(db, repo, phieus)
    dds = {d.id: d for ds in repo.dong_cua_nhieu_don(dons.keys()).values() for d in ds}
    viecs = repo.nhieu_viec({d.viec_id for d in dds.values()})
    lenh_viec = thong_tin_lenh.cua_viec(db, viecs.values())
    dong_pn = repo.dong_phieu_nhan([p.id for p in phieus])
    ten = repo.user_names({p.nguoi_nhan_id for p in phieus})
    out = []
    for p in phieus:
        don = dons.get(p.don_id)
        lenh: dict[int, dict] = {}
        for x in dong_pn.get(p.id, []):
            dd = dds.get(x.don_dong_id)
            for l in lenh_viec.get(dd.viec_id, []) if dd else []:
                lenh.setdefault(l["lsx_id"], l)
        ds = dongs.get(p.id, [])
        out.append({
            "phieu_nhan_id": p.id, "ma": p.ma, "nhan_luc": p.nhan_luc,
            "don_id": p.don_id, "ma_don": don.ma if don else "",
            "nha_cung_cap_id": don.nha_cung_cap_id if don else None,
            "nha_cung_cap_ten": don.nha_cung_cap_ten if don else "",
            "nguoi_nhan_ten": ten.get(p.nguoi_nhan_id),
            "lenh": list(lenh.values()), "dong": ds,
            "tam_tinh": sum(d["tam_tinh"] for d in ds),
        })
    return out


def dem(db: Session) -> int:
    return len(ThueGiaCongRepository(db).phieu_nhan_cho_tra())


def chia_tien(tong: int, tam_tinh: list[int]) -> list[int]:
    """Chia `tong` theo tỷ lệ tạm tính, phần lẻ dồn phần tử cuối. Tạm tính cộng 0 ⇒ chia đều."""
    n = len(tam_tinh)
    goc = sum(tam_tinh)
    if n == 0:
        return []
    if goc <= 0:
        phan = [tong // n] * n
    else:
        phan = [tong * t // goc for t in tam_tinh]
    phan[-1] += tong - sum(phan)
    return phan


def tao_phieu_chi(svc, *, actor, phieu_nhan_ids: list[int] | None, ly_do_lech: str | None,
                  values: dict) -> dict:
    """MỘT phiếu chi trả nhiều phiếu nhận CÙNG nhà gia công. `svc` = AccountingService.

    Khoá các phiếu nhận rồi kiểm: còn hiệu lực, chưa có phiếu chi sống, cùng một nhà gia công. Số
    tiền lấy từ payload (kế toán sửa theo hoá đơn), khác Σ tạm tính thì bắt `ly_do_lech`."""
    from ..accounting_service import AccountingNotFound, AccountingValidationError
    from ..dinh_dang import so_vn

    db = svc.repo.db
    repo = ThueGiaCongRepository(db)
    ids = [int(i) for i in (phieu_nhan_ids or [])]
    if not ids:
        raise AccountingValidationError("Chưa chọn phiếu nhận nào để trả tiền.")
    if len(ids) > _MAX_PHIEU:
        raise AccountingValidationError(f"Một phiếu chi tối đa {_MAX_PHIEU} phiếu nhận.")
    if len(set(ids)) != len(ids):
        raise AccountingValidationError("Có phiếu nhận bị chọn trùng hai lần.")
    phieus = []
    for i in sorted(ids):
        p = repo.khoa_phieu_nhan(i)
        if p is None:
            raise AccountingNotFound("Không tìm thấy phiếu nhận.")
        phieus.append(p)
    phieus.sort(key=lambda p: ids.index(p.id))
    for p in phieus:
        if p.huy_luc is not None:
            raise AccountingValidationError(f"Phiếu nhận {p.ma} đã huỷ.")
    da_chi = repo.phieu_chi_song_cua_phieu_nhan(ids)
    if da_chi:
        pid, ma_pc = next(iter(da_chi.items()))
        ma_pn = next(p.ma for p in phieus if p.id == pid)
        raise AccountingValidationError(f"Phiếu nhận {ma_pn} đã có phiếu chi {ma_pc}.")
    dons = repo.nhieu_don({p.don_id for p in phieus})
    nha = {dons[p.don_id].nha_cung_cap_id for p in phieus if p.don_id in dons}
    if len(nha) != 1:
        raise AccountingValidationError("Các phiếu nhận phải cùng một nhà gia công mới trả chung một phiếu chi được.")
    don0 = dons[phieus[0].don_id]
    dongs = repo.dong_phieu_nhan(ids)
    tam_tinh = [sum(_tam_tinh_dong(x) for x in dongs.get(p.id, [])) for p in phieus]
    tong_tt = sum(tam_tinh)
    try:
        so_tien = int(round(float(values.get("amount") or 0)))
    except (TypeError, ValueError):
        raise AccountingValidationError("Số tiền không hợp lệ.") from None
    if so_tien <= 0:
        raise AccountingValidationError("Số tiền phải lớn hơn 0.")
    ly_do = (ly_do_lech or "").strip()
    lech = so_tien != tong_tt
    if lech and len(ly_do) < _LY_DO_TOI_THIEU:
        raise AccountingValidationError(
            f"Số tiền {so_vn(so_tien)}đ lệch tạm tính {so_vn(tong_tt)}đ — ghi lý do lệch (ít nhất 3 ký tự).")
    ma = [p.ma for p in phieus]
    noi_dung = (values.get("content") or "").strip() or f"Trả tiền thuê gia công {', '.join(ma)}"
    if lech:
        noi_dung = f"{noi_dung}. Lệch tạm tính: {ly_do}"
    vals = {
        **values,
        "source_type": VOUCHER_SOURCE_GIA_CONG,
        "currency": "VND",
        "exchange_rate": 1,
        "amount": so_tien,
        "content": noi_dung[:500],
    }
    prepared = svc._prepare_standalone_voucher(vals, gia_cong=don0)
    prepared["source_code_snapshot"] = ", ".join(ma)[:32]
    prepared["customer_id"] = None
    voucher = svc._new_voucher(None, prepared, actor.id, doc_no=svc._next_voucher_doc_no())
    svc._chan_ky_khoa(voucher)
    db.add(voucher)
    for p, phan in zip(phieus, chia_tien(so_tien, tam_tinh)):
        repo.them_dong_chi(voucher, p.id, phan)
    saved = svc.repo.save_voucher(voucher)
    chi_tiet = f"{saved.code} <- Thuê gia công {don0.nha_cung_cap_ten} {', '.join(ma)}: {so_vn(so_tien)}đ"
    if lech:
        chi_tiet += f" (tạm tính {so_vn(tong_tt)}đ, lệch: {ly_do})"
    svc.audit.create(actor_user_id=actor.id, action="create_payment_voucher",
                     target=f"payment_voucher:{saved.id}", detail=chi_tiet[:500])
    return svc._voucher_out(saved)


__all__ = ["danh_sach", "dem", "tao_phieu_chi", "chia_tien"]
