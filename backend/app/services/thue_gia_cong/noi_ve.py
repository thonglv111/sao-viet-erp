"""NƠI VỀ của một dòng phiếu nhận gia công (spec 2026-11-13 §4.4) — điểm nối 3 với xưởng / kho / giao hàng.

Mỗi dòng phiếu nhận ghi MỘT mẻ (tốt = đạt, hỏng = hỏng) lên công việc cuối của việc, rồi rẽ:
  · xưởng — bàn giao sang bước sau (một phiếu nhận một bàn giao, tổ sau làm dần);
  · điểm toả bài ghép — số tờ ghép toả sang bước riêng từng lệnh (`_toa_san_luong`);
  · kho — đề nghị nhập thành phẩm mang `tgc_phieu_nhan_id`, KHÔNG ghi KCS (Q4: kho tự kiểm);
    bài ghép hết bước ⇒ mỗi lệnh một đề nghị theo số con/tờ;
  · khách — nhà gia công giao thẳng (chỉ dòng đơn bán đứng riêng một cụm, không cho bài ghép).
Gỡ (huỷ phiếu nhận) xoá đúng những gì dòng đã đẻ ra, khi chứng từ phía sau chưa chạy."""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.san_xuat import NHOM_DONG
from ...models.san_xuat_san_luong import BG_DE_XUAT, SanXuatBatch
from ...models.thue_gia_cong import NOI_VE_KHACH, NOI_VE_KHO, NOI_VE_XUONG
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository
from ..san_xuat import ban_giao
from ..san_xuat import kho as sx_kho
from ..san_xuat.san_luong import _toa_san_luong, he_so_nhanh_toa

_EPS = 1e-9
NHAN_NOI_VE = {NOI_VE_XUONG: "về xưởng", NOI_VE_KHO: "về kho", NOI_VE_KHACH: "giao thẳng cho khách"}
NHANH_TOA, NHANH_XUONG, NHANH_KHO = "toa", "xuong", "kho"


# --- Đọc --------------------------------------------------------------------------------------
def noi_ve_hop_le(db: Session, viec, chang_sau: list) -> list[str]:
    """Dải còn chặng sau ⇒ chỉ về xưởng. Dải chứa bước cuối / trọn gói ⇒ kho, hoặc khách khi dòng
    đơn của lệnh đứng riêng một cụm bán. Việc của BÀI GHÉP không có nhánh giao thẳng (các lệnh
    thường thuộc nhiều đơn / khách)."""
    if chang_sau:
        return [NOI_VE_XUONG]
    if viec.bai_ghep_id is not None:
        return [NOI_VE_KHO]
    # Bản cài tắt giao hàng: giao thẳng ghi chuyến giao, mà phân hệ đó không có ⇒ chỉ còn về kho.
    from ...phan_he import GIAO_HANG, tat

    if tat(GIAO_HANG):
        return [NOI_VE_KHO]
    from .giao_thang import dong_don_dung_rieng

    return [NOI_VE_KHO, NOI_VE_KHACH] if dong_don_dung_rieng(db, viec.lsx_id) else [NOI_VE_KHO]


def nhanh_bai_ghep(db: Session, cuoi, chang_sau: list) -> str:
    """Cái đứng sau việc của bài ghép: điểm toả sang bước riêng từng lệnh (cạnh toả mang
    `ty_le_ghep` do phát hành dựng), bước chung kế tiếp, hoặc hết bước."""
    if cuoi is not None and any(
            c.ty_le_ghep for c in SanXuatSanLuongRepository(db).canh_toa_di_tu(cuoi.id)):
        return NHANH_TOA
    return NHANH_XUONG if chang_sau else NHANH_KHO


def chia_theo_lenh(db: Session, viec, cuoi, chang_sau: list) -> list[dict]:
    """Bảng chia số nhận về từng lệnh — form nhận hiện TRƯỚC khi lưu. Rỗng khi việc không toả (việc
    của lệnh, hoặc về bước chung kế — một bàn giao)."""
    if viec.bai_ghep_id is None or cuoi is None:
        return []
    nhanh = nhanh_bai_ghep(db, cuoi, chang_sau)
    sl_repo = SanXuatSanLuongRepository(db)
    repo = ThueGiaCongRepository(db)
    ra: list[dict] = []
    if nhanh == NHANH_TOA:
        for c in sl_repo.canh_toa_di_tu(cuoi.id):
            dich = sl_repo.cong_viec(c.dich_cong_viec_id)
            if not c.ty_le_ghep or dich is None or dich.lsx_id is None:
                continue
            # `he_so_nhan` = đúng hệ số toả lúc lưu: bước nhận ăn tờ ghép thì × 1 (nó tự cắt ra
            # `so_con` con mỗi tờ), ăn con thì × số con/tờ.
            ra.append({"lsx_id": dich.lsx_id, "so_con": float(c.ty_le_ghep),
                       "he_so_nhan": he_so_nhanh_toa(c),
                       "don_vi": c.don_vi_dich or dich.don_vi_vao, "buoc_nhan": dich.ten_cong_doan})
    elif nhanh == NHANH_KHO:
        don_vi = repo.don_vi_ra_buoc_bi_phu(cuoi.bai_ghep_cong_doan_id)
        for lsx_id, con in SanXuatRepository(db).thanh_vien_so_con({viec.bai_ghep_id}).items():
            ra.append({"lsx_id": lsx_id, "so_con": float(con), "he_so_nhan": float(con),
                       "don_vi": don_vi.get(lsx_id) or cuoi.don_vi_ra, "buoc_nhan": None})
    ma = repo.ma_cua_lenh({r["lsx_id"] for r in ra})
    for r in ra:
        r["lsx_ma"] = ma.get(r["lsx_id"], "")
    ra.sort(key=lambda r: (r["lsx_ma"], r["lsx_id"]))
    return ra


def chon_dich(chang_sau: list, dich_cong_viec_id: int | None):
    if len(chang_sau) == 1:
        return chang_sau[0]
    dich = next((c for c in chang_sau if c.id == dich_cong_viec_id), None)
    if dich is None:
        raise ValueError("Bước sau có nhiều nhánh — chọn bước nhận hàng.")
    return dich


# --- Ghi --------------------------------------------------------------------------------------
def ghi(db: Session, *, user, don, viec, cuoi, me, so: float, chang_sau: list, noi_ve: str,
        dich, phieu_nhan_id: int, xac_nhan_ngay: bool, ngay_khach_nhan=None) -> dict:
    """Rẽ nhánh cho MỘT dòng. Trả `{ban_giao: [bg], yeu_cau_khos: [req]}` — router báo sau commit.
    `dich` = công việc bước sau đã chọn (nhánh xưởng thường); `xac_nhan_ngay` = người nhận có quyền
    Xác nhận sản lượng ở tổ đích ⇒ bàn giao vào thẳng trạng thái đã xác nhận."""
    nguon = f"gia công ngoài ({don.nha_cung_cap_ten})"
    if viec.bai_ghep_id is not None:
        nhanh = nhanh_bai_ghep(db, cuoi, chang_sau)
        if nhanh == NHANH_TOA and noi_ve == NOI_VE_XUONG:
            kq = _toa_san_luong(db, SanXuatSanLuongRepository(db), cv=cuoi, batch=me, tot=so, actor=user)
            bgs = ThueGiaCongRepository(db).ban_giao_theo_id([x["ban_giao_id"] for x in kq])
            return {"ban_giao": list(bgs.values()), "yeu_cau_khos": []}
        if nhanh == NHANH_KHO and noi_ve == NOI_VE_KHO:
            return {"ban_giao": [], "yeu_cau_khos": _ve_kho_tung_lenh(
                db, user=user, viec=viec, cuoi=cuoi, so=so, nguon=nguon, phieu_nhan_id=phieu_nhan_id)}
    if noi_ve == NOI_VE_XUONG:
        bg = ban_giao.lap_ban_giao(db, user=user, nguon_cv=cuoi, dich_cv=dich, so_luong=so,
                                   don_vi=me.don_vi, batch_ids=[me.id])
        if xac_nhan_ngay and bg.trang_thai == BG_DE_XUAT:
            ban_giao.ghi_xac_nhan(db, bg=bg, user=user)
        return {"ban_giao": [bg], "yeu_cau_khos": []}
    if noi_ve == NOI_VE_KHO:
        req, _ra = sx_kho.lap_yeu_cau_nhap_tp(db, user=user, cv=cuoi, so_kcs=so, nguon_ghi=nguon,
                                              tgc_phieu_nhan_id=phieu_nhan_id)
        return {"ban_giao": [], "yeu_cau_khos": [req]}
    if noi_ve == NOI_VE_KHACH:
        from .giao_thang import ghi_giao_thang

        ghi_giao_thang(db, user=user, don=don, lsx_id=viec.lsx_id, cv=cuoi, so=so,
                       phieu_nhan_id=phieu_nhan_id, ngay_khach_nhan=ngay_khach_nhan)
        return {"ban_giao": [], "yeu_cau_khos": []}
    raise ValueError("Nơi về không hợp lệ.")


def _ve_kho_tung_lenh(db: Session, *, user, viec, cuoi, so: float, nguon: str, phieu_nhan_id: int) -> list:
    """Bước chung CUỐI của bài ghép về kho: số nhận là tờ ghép ⇒ mỗi lệnh nhập `số × số con/tờ` của
    mình, theo đơn vị ra của bước riêng lệnh đó. Mỗi lệnh một đề nghị nhập — nhóm / đơn thuộc về lệnh,
    không thuộc công việc chung."""
    repo, sx = ThueGiaCongRepository(db), SanXuatRepository(db)
    don_vi = repo.don_vi_ra_buoc_bi_phu(cuoi.bai_ghep_cong_doan_id)
    reqs = []
    for lsx_id, con in sorted(sx.thanh_vien_so_con({viec.bai_ghep_id}).items()):
        phan = round(so * float(con or 0), 3)
        if phan <= _EPS:
            continue
        tv = sx.member_of_lsx(lsx_id)
        nhom_id = tv.nhom_id if tv is not None else None
        dv = don_vi.get(lsx_id) or cuoi.don_vi_ra
        req, _ra = sx_kho.lap_yeu_cau_nhap_tp(db, user=user, cv=cuoi, so_kcs=phan, nguon_ghi=nguon,
                                              tgc_phieu_nhan_id=phieu_nhan_id, theo_lenh=(nhom_id, lsx_id, dv))
        reqs.append(req)
    return reqs


# --- Gỡ ---------------------------------------------------------------------------------------
def _nhom_ids(db: Session, viec, cuoi) -> list[int]:
    """Nhóm thành phẩm mà số nhận về kho / khách đã chạm: nhóm của công việc cuối, hoặc — việc của
    bài ghép — nhóm của từng lệnh thành viên."""
    if viec.bai_ghep_id is None:
        return [cuoi.nhom_id] if cuoi is not None and cuoi.nhom_id else []
    sx = SanXuatRepository(db)
    ra = []
    for lsx_id in sorted(sx.thanh_vien_so_con({viec.bai_ghep_id})):
        tv = sx.member_of_lsx(lsx_id)
        if tv is not None and tv.nhom_id and tv.nhom_id not in ra:
            ra.append(tv.nhom_id)
    return ra


def _bg_cua_dong(db: Session, dong) -> list:
    """Bàn giao dòng phiếu nhận đã đẻ: qua mẻ (xưởng thường) hoặc qua kết quả toả (bài ghép)."""
    if not dong.batch_id:
        return []
    sl_repo = SanXuatSanLuongRepository(db)
    bg = sl_repo.ban_giao_cua_me(dong.batch_id)
    if bg is not None:
        return [bg]
    ids = [kq.ban_giao_id for kq in sl_repo.ket_qua_nhanh_cua_batch(dong.batch_id) if kq.ban_giao_id]
    return list(ThueGiaCongRepository(db).ban_giao_theo_id(ids).values())


def ly_do_khong_go(db: Session, *, dong, viec, cuoi, nguoi_nhan_id: int | None) -> str | None:
    """Lý do KHÔNG gỡ được một dòng — CHỈ ĐỌC, cùng cửa với `go`. None = gỡ được."""
    sl_repo = SanXuatSanLuongRepository(db)
    if dong.noi_ve == NOI_VE_XUONG:
        for bg in _bg_cua_dong(db, dong):
            dich = sl_repo.cong_viec(bg.dich_cong_viec_id)
            ten = dich.ten_cong_doan if dich is not None else "bước sau"
            if dich is not None and sl_repo.cac_batch(dich.id) and bg.trang_thai != BG_DE_XUAT:
                return (f"Tổ bước “{ten}” đã ghi sản lượng trên hàng nhận về — không huỷ được. Nhờ tổ "
                        "xoá lần ghi đó trước nếu số nhận cần sửa.")
            tu_xac_nhan = (bg.xac_nhan_by_id is not None and bg.xac_nhan_by_id == nguoi_nhan_id
                           and bg.xac_nhan_by_id == bg.de_xuat_by_id)
            if bg.trang_thai != BG_DE_XUAT and not tu_xac_nhan:
                return f"Tổ bước “{ten}” đã xác nhận nhận hàng — không huỷ được phiếu nhận."
        return None
    sx = SanXuatRepository(db)
    for nhom_id in _nhom_ids(db, viec, cuoi):
        nhom = sx.nhom(nhom_id)
        if nhom is not None and nhom.trang_thai == NHOM_DONG:
            return "Lệnh đã đóng — mở lại lệnh trước rồi mới huỷ phiếu nhận."
    return None


def go(db: Session, *, dong) -> None:
    """Gỡ phần XƯỞNG của một dòng (bàn giao + kết quả toả) và mẻ. Đề nghị kho / chuyến giao thẳng gỡ
    theo PHIẾU ở `phieu_nhan.huy` (chúng khoá theo `tgc_phieu_nhan_id`). Gọi SAU `ly_do_khong_go`."""
    if not dong.batch_id:
        return
    sl_repo = SanXuatSanLuongRepository(db)
    bgs = _bg_cua_dong(db, dong)   # đọc TRƯỚC khi xoá kết quả toả (bàn giao toả tìm qua đó)
    for kq in sl_repo.ket_qua_nhanh_cua_batch(dong.batch_id):
        sl_repo.delete(kq)
    sl_repo.flush()
    for bg in bgs:
        for lk in sl_repo.lien_ket_me(bg.id):
            sl_repo.delete(lk)
        sl_repo.flush()
        sl_repo.delete(bg)
    sl_repo.flush()
    me = db.get(SanXuatBatch, dong.batch_id)
    dong.batch_id = None
    if me is not None:
        sl_repo.delete(me)
    sl_repo.flush()
