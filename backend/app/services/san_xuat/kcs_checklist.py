"""KCS cuối xét tiêu chí GỘP của cả chuỗi (`docs/design-tieu-chi-kcs-lam-lai.md` §3, 08/10/2026).

Tiêu chí khai cho MỌI công đoạn (danh mục Tiêu chí KCS) nhưng KCS chỉ soi bằng mắt ở bước CUỐI —
lúc hàng đã thành phẩm. Bước cuối vì vậy xét tiêu chí của MỌI công đoạn đứng trước nó, kể cả các
lệnh PHỤ cùng nhóm thành phẩm (chốt 08/10: "gộp cả tiêu chí lệnh phụ vào KCS cuối"). Gộp lúc ĐỌC,
không chép thêm cột: nguồn vẫn là ảnh chụp `kcs_tieu_chi_json` của từng công việc lúc phát hành.

Khoá kết quả = cặp (công việc nguồn, `thu_tu` trong ảnh chụp của nó) — hai công đoạn khác nhau đều
có tiêu chí số 1. Phần tử kết quả cũ thiếu `cong_viec_id` là của chính công việc lần kiểm.

Luật khi lưu ở bước cuối (`kiem_ket_qua`):
  · mọi tiêu chí gộp phải có kết quả đạt / không đạt;
  · tiêu chí của công đoạn X không đạt ⇒ lần kiểm phải có dòng lỗi quy về X — không đạt mà không
    ghi lỗi thì tổ X không được báo, số đạt không trừ, kết quả là lời nói suông.
Công thức đạt / gửi kho KHÔNG đổi: đạt = phần chưa kiểm − Σ dòng lỗi (đơn vị bước cuối).
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...repositories.san_xuat_kcs_repo import SanXuatKcsRepository
from ..lenh_sx import boi_canh


def _lsx_chinh(repo: SanXuatKcsRepository, cv, lsx_id: int | None) -> int | None:
    """Lệnh mang công việc đang kiểm: lệnh riêng của nó, không thì lệnh KCS đang mở (việc ghép phủ
    nhiều lệnh), không nữa thì thân chính của nhóm."""
    if cv.lsx_id:
        return cv.lsx_id
    if lsx_id:
        return lsx_id
    nhom = repo.nhom(cv.nhom_id)
    return nhom.than_chinh_lsx_id if nhom is not None else None


def _viec_thue_ngoai(bc, ids) -> list:
    """Công việc thuê ngoài của các lệnh trong bối cảnh — chuỗi KCS bỏ qua chúng."""
    return [c for l in ids if l in bc.lenh for c in bc.cong_viec_du(l) if c.tgc_viec_id is not None]


def chuoi_gop(db: Session, cv, lsx_id: int | None = None) -> list:
    """Chuỗi công việc mà bước cuối `cv` xét tiêu chí + quy lỗi về được: các lệnh PHỤ cùng nhóm
    trước (theo mã lệnh, mỗi lệnh theo thứ tự routing), rồi lệnh CHÍNH từ đầu tới chính `cv`.
    Khử trùng theo id (việc bài ghép phủ nhiều lệnh chỉ đứng một chỗ).

    BỎ bước THUÊ NGOÀI (11/10/2026, chủ chốt): KCS không xét tiêu chí của nhà gia công và không quy
    lỗi về họ — số nhận về đã chốt ở lần gia công. Chính `cv` thì luôn giữ.

    `cv` không thuộc lệnh chính ⇒ `ValueError` (cùng câu với đường quy lỗi cũ)."""
    from .kcs import _thu_tu_cong_doan      # import lười: kcs.py import ngược module này

    repo = SanXuatKcsRepository(db)
    chinh = _lsx_chinh(repo, cv, lsx_id)
    if not chinh:
        return [cv]
    nhom_id = cv.nhom_id or repo.nhom_id_cua_lsx(chinh)
    ids = set(repo.lsx_trong_nhom(nhom_id)) | {chinh}
    bc = boi_canh.nap(db, sorted(ids))
    if chinh not in bc.lenh:
        return [cv]
    thu_tu = repo.thu_tu_buoc(ids)
    cvs_chinh = bc.cong_viec_du(chinh)
    if all(c.id != cv.id for c in cvs_chinh):
        raise ValueError("Công đoạn đang kiểm không thuộc lệnh này.")
    khoa = _thu_tu_cong_doan(bc, chinh, thu_tu)
    moc = khoa(cv)

    out: list = []
    thay: set[int] = {c.id for c in _viec_thue_ngoai(bc, ids) if c.id != cv.id}
    phu = sorted((l for l in ids if l != chinh and l in bc.lenh),
                 key=lambda l: (bc.lenh[l].ma or "", l))
    for lid in phu:
        for c in sorted(bc.cong_viec_du(lid), key=_thu_tu_cong_doan(bc, lid, thu_tu)):
            if c.id not in thay:
                thay.add(c.id)
                out.append(c)
    for c in sorted(cvs_chinh, key=khoa):
        if khoa(c) <= moc and c.id not in thay:
            thay.add(c.id)
            out.append(c)
    return out


def checklist_gop(db: Session, chuoi: list, lsx_chinh: int | None) -> list[dict]:
    """Tiêu chí gộp theo thứ tự chuỗi. Bước bị CHIA PHÂN ĐOẠN (nhiều công việc cùng một bước lệnh)
    chỉ góp tiêu chí MỘT lần, gắn vào phân đoạn có `phan_doan_so` lớn nhất trong chuỗi — tiêu chí
    soi trên thành phẩm, không soi từng nửa mẻ."""
    dai_dien: dict[tuple, object] = {}
    for c in chuoi:
        k = (c.lsx_id, c.lsx_cong_doan_id) if c.lsx_cong_doan_id else ("cv", c.id)
        cu = dai_dien.get(k)
        if cu is None or (c.phan_doan_so or 1) > (cu.phan_doan_so or 1):
            dai_dien[k] = c
    giu = {c.id for c in dai_dien.values()}
    co_tieu_chi = [c for c in chuoi if c.id in giu and c.kcs_tieu_chi_json]
    if not co_tieu_chi:
        return []
    repo = SanXuatKcsRepository(db)
    lenh = {l.id: l for l in (repo.lsx(i) for i in {c.lsx_id for c in co_tieu_chi if c.lsx_id}) if l}
    out = []
    for c in co_tieu_chi:
        l = lenh.get(c.lsx_id)
        for it in c.kcs_tieu_chi_json:
            if not isinstance(it, dict) or it.get("thu_tu") is None:
                continue
            out.append({
                "cong_viec_id": c.id,
                "ten_cong_doan": c.ten_cong_doan,
                "nhom_cong_doan": c.nhom_cong_doan,
                "tieu_chi_id": it.get("tieu_chi_id"),
                "ma": it.get("ma"),
                "thu_tu": int(it["thu_tu"]),
                "ten": it.get("ten") or "",
                "lsx_id": c.lsx_id,
                "lsx_ma": l.ma if l else None,
                "ten_lenh": l.ten if l else None,
                "la_lenh_phu": bool(c.lsx_id and lsx_chinh and c.lsx_id != lsx_chinh),
            })
    return out


def khoa_ket_qua(kq: dict, cv_mac_dinh: int) -> tuple[int, int]:
    """(công việc nguồn, thu_tu) của một phần tử kết quả — thiếu `cong_viec_id` = công việc lần kiểm."""
    return int(kq.get("cong_viec_id") or cv_mac_dinh), int(kq["thu_tu"])


def kiem_ket_qua(cv, gop: list[dict], ket_qua: list[dict] | None,
                 cv_co_loi: set[int]) -> list[dict] | None:
    """Kiểm kết quả xét tiêu chí gộp của bước cuối rồi trả bản chuẩn `[{cong_viec_id, thu_tu, dat,
    ghi_chu}]` theo thứ tự gộp. `gop` rỗng (chuỗi không công đoạn nào có tiêu chí) ⇒ trả nguyên.

    `cv_co_loi` = công việc có ít nhất một dòng lỗi quy về trong lần kiểm này."""
    if not gop:
        return ket_qua
    theo_khoa: dict[tuple[int, int], dict] = {}
    for kq in ket_qua or []:
        if isinstance(kq, dict) and kq.get("thu_tu") is not None and kq.get("dat") is not None:
            theo_khoa[khoa_ket_qua(kq, cv.id)] = kq
    thieu = [m for m in gop if (m["cong_viec_id"], m["thu_tu"]) not in theo_khoa]
    if thieu:
        ten = list(dict.fromkeys(m["ten_cong_doan"] for m in thieu))
        raise ValueError(f"Còn {len(thieu)} tiêu chí chưa ghi kết quả ({', '.join(ten)}).")
    out = []
    for m in gop:
        kq = theo_khoa[(m["cong_viec_id"], m["thu_tu"])]
        dat = bool(kq.get("dat"))
        if not dat and m["cong_viec_id"] not in cv_co_loi:
            raise ValueError(
                f"Công đoạn {m['ten_cong_doan']} có tiêu chí không đạt nhưng chưa ghi lỗi."
            )
        out.append({
            "cong_viec_id": m["cong_viec_id"], "thu_tu": m["thu_tu"], "dat": dat,
            "ghi_chu": (kq.get("ghi_chu") or "").strip() or None,
        })
    return out
