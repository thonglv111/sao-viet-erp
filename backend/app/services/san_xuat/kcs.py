"""Thực hiện sản xuất — KCS theo LỆNH (`docs/design-kcs-theo-lenh.md`, mg `0306`).

KCS mở một lệnh → bấm một công đoạn → ghi Số lỗi (18/09/2026: form chỉ còn ô này — số đạt do máy
chủ suy từ phần tổ đã làm mà chưa kiểm, xem `_phan_chua_kiem`). MỘT hành động duy nhất
(`kiem_cong_doan`), làm được trên công đoạn đang chạy / tạm dừng / đã xong, lặp bao nhiêu lần cũng
được. Tuân §18: kiểm quyền tại service → transaction → audit → (SSE do router phát sau commit).

Luật cứng:
  · Quyền = dòng `kcs` của ma trận vai (09/10/2026, thay cờ phòng ban `is_kcs`): Xem = màn KCS +
    báo cáo mọi tổ; Thao tác (`create`) = ghi lần kiểm, gửi nhập kho, đóng lệnh đủ; ô chi tiết
    "Đóng lệnh thiếu" (`close_short`) = đóng khi còn việc chưa xong / mở lại (`dong_lenh`).
    Không phạm vi theo tổ — KCS kiểm cả chuỗi của MỌI tổ.
  · Lần kiểm đã ghi KHÔNG sửa được (điều chỉnh đã gỡ 08/10/2026) — ghi sai thì ghi lần kiểm mới.
  · Kiểm KHÔNG trừ số, KHÔNG đẻ `san_xuat_batch`, KHÔNG đổi trạng thái công việc — bản ghi chất
    lượng thuần.
  · Lỗi > 0 ⇒ mô tả + ≥1 ảnh. Tổ chịu = tổ của công đoạn chịu lỗi — mặc định chính công đoạn đang
    kiểm, KCS chọn được công đoạn đứng trước trong cùng lệnh (19/09/2026); tổ đó nhận thông báo
    tức thì và "Đã xem" (`phan_hoi_luc`).
  · Công đoạn cuối của nhóm (`la_kcs_cuoi`) ⇒ Σ đạt ≤ Σ tốt tổ đã ghi; phần đạt đó là số đề xuất
    nhập kho (`kho.tao_yeu_cau_nhap_kho_cong_doan`).
  · Công đoạn GIỮA (19/09/2026) ⇒ KCS chỉ GHI LỖI khi thấy, không bắt buộc: không có số đạt (luôn
    0), không "phần chưa kiểm"; trần Σ lỗi ≤ Σ tốt tổ đã ghi (`_chi_ghi_loi`). Từ 09/10/2026 KCS
    tick tiêu chí KHÔNG ĐẠT của chính công đoạn (hoặc "Lỗi khác"), mỗi tiêu chí một số lỗi; ảnh
    không bắt buộc; lỗi luôn của chính công đoạn (`_chuan_hoa_dong_giua`).
  · Bước cuối xét tiêu chí GỘP của cả chuỗi, kể cả lệnh phụ cùng nhóm, và quy lỗi được về mọi
    công việc của chuỗi đó (`kcs_checklist`, 08/10/2026).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy.orm import Session

from ...models.san_xuat import CV_DANG_CHAY, CV_HOAN_THANH, CV_TAM_DUNG, NHOM_DONG
from ...models.san_xuat_kcs import (
    KCS_DAT,
    KCS_DAT_MOT_PHAN,
    KCS_KHONG_DAT,
    SanXuatKcsBatch,
    SanXuatKcsLoi,
    SanXuatKcsLoiAnh,
)
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.san_xuat_kcs_repo import SanXuatKcsRepository
from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from ..gio_xuong import thuc_te_hien_thi
from ..lenh_sx import boi_canh
from ..quyen_to import MUC_CUA_TOI, VIEC_XAC_NHAN, gate_to_tron, nguoi_co_quyen
from .kcs_checklist import checklist_gop, chuoi_gop, khoa_ket_qua, kiem_ket_qua
from .nguoi_trong_me import nguoi_theo_me
from .thuc_thi import _moc

# Dung sai làm tròn (cột Numeric(18,3)) — như san_luong.
_EPS = 0.0005
# Lần kiểm Y HỆT của cùng người trong khoảng này = một lần bấm "Lưu" bị gửi lại.
_CHONG_GHI_LAI = timedelta(seconds=30)
# Kiểm được công đoạn ĐÃ khởi động (đang chạy / tạm dừng / đã xong).
_TRANG_THAI_KIEM_DUOC = (CV_DANG_CHAY, CV_TAM_DUNG, CV_HOAN_THANH)
_CO_TRANG = 30


def _so_khong_am(x, ten: str) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        raise ValueError(f"{ten} không hợp lệ.")
    if v != v or v in (float("inf"), float("-inf")):
        raise ValueError(f"{ten} không hợp lệ.")
    if v < 0:
        raise ValueError(f"{ten} không được âm.")
    return v


# --- Quyền KCS: dòng `kcs` của ma trận vai (09/10/2026) ---------------------------------------
def _authz(db: Session):
    from ...repositories.rbac_repo import RoleRepository
    from ..rbac_service import AuthorizationService

    return AuthorizationService(RoleRepository(db))


def xem_kcs(db: Session, user) -> bool:
    """Ô Xem của dòng KCS — màn KCS, chuỗi công đoạn, ảnh lỗi, báo cáo MỌI tổ, Xuất Excel."""
    return _authz(db).can(user, "kcs", "read")


def gate_xem_kcs(db: Session, user) -> None:
    if not xem_kcs(db, user):
        raise PermissionError("Bạn không có quyền xem KCS.")


def gate_kcs(db: Session, user) -> None:
    """Ô Thao tác của dòng KCS — ghi lần kiểm, gửi yêu cầu nhập kho thành phẩm, đóng lệnh đủ."""
    if not _authz(db).can(user, "kcs", "create"):
        raise PermissionError("Bạn không có quyền thao tác KCS.")


# --- Luật dùng chung ------------------------------------------------------------------------
def _ket_luan(dat: float, loi: float) -> str:
    if loi <= _EPS:
        return KCS_DAT
    if dat <= _EPS:
        return KCS_KHONG_DAT
    return KCS_DAT_MOT_PHAN


def _chuan_hoa_anh(raw: dict, uploaded_by: int | None) -> SanXuatKcsLoiAnh:
    file_url = (raw.get("file_url") or "").strip()
    file_name = (raw.get("file_name") or "").strip()
    if not file_url or not file_name:
        raise ValueError("Ảnh bằng chứng thiếu tên file hoặc đường dẫn.")
    return SanXuatKcsLoiAnh(
        file_name=file_name[:255],
        file_url=file_url[:500],
        file_type=(raw.get("file_type") or None),
        uploaded_by=uploaded_by,
    )


def _chan_vuot_tot(db: Session, repo: SanXuatKcsRepository, cv, dat_moi: float) -> None:
    """Công đoạn cuối nhóm: Σ đạt không vượt Σ tốt tổ đã ghi — phần đạt là số đưa vào kho."""
    if not cv.la_kcs_cuoi:
        return
    tot = SanXuatSanLuongRepository(db).tong_tot(cv.id)
    da_dat = repo.tong_dat(cv.id)
    if da_dat + dat_moi > tot + _EPS:
        raise ValueError(
            f"Công đoạn cuối: tổng đạt ({da_dat + dat_moi:g}) vượt số tốt tổ đã ghi ({tot:g})."
        )


def _phan_chua_kiem(db: Session, repo: SanXuatKcsRepository, cv) -> float:
    """Phần tổ đã làm mà KCS chưa kiểm = Σ số lượng các mẻ − Σ (đạt + lỗi) các lần kiểm trước."""
    tot = SanXuatSanLuongRepository(db).tong_tot(cv.id)
    da_kiem = sum(
        float(k.so_luong_dat or 0) + float(k.so_luong_khong_dat or 0) for k in repo.cac_kcs_batch(cv.id)
    )
    return max(0.0, tot - da_kiem)


def _chi_ghi_loi(db: Session, repo: SanXuatKcsRepository, cv, loi_sl: float) -> float:
    """Công đoạn GIỮA: KCS chỉ ghi lỗi khi thấy, không bắt buộc và không có "đạt" (19/09/2026 — chỉ
    KCS cuối mới kiểm đạt để nhập kho). Trả số đạt = 0. Công đoạn đã bắt đầu là ghi được, KHÔNG chờ
    tổ ghi mẻ và không chặn trần theo số tổ đã ghi (10/10/2026 — KCS thấy lỗi ngay lúc máy chạy, tổ
    thường ghi mẻ sau).

    Công đoạn ĐÃ KẾT THÚC thì trần quay lại (#31 bấm thử 18/10/2026): tổ đã ghi hết sản lượng, nên
    Σ lỗi bắt tại công đoạn (cũ + lần này) không vượt Σ tốt tổ đã ghi. Không có trần đó thì gõ nhầm
    1.300 cho bước In đã làm 1.250 tờ vẫn lưu được — và lần ghi lỗi không sửa được trên giao diện."""
    if loi_sl <= _EPS:
        raise ValueError("Nhập ít nhất một dòng lỗi.")
    if cv.trang_thai == CV_HOAN_THANH:
        from .dau_vao import _so

        tot = SanXuatSanLuongRepository(db).tong_tot(cv.id)
        con = max(0.0, tot - repo.tong_loi(cv.id))
        if loi_sl > con + _EPS:
            raise ValueError(
                f"Công đoạn đã xong, tổ đã làm {_so(tot)}: số lỗi {_so(loi_sl)} vượt phần "
                f"còn ghi được {_so(con)}."
            )
    return 0.0


def _dat_cong_doan_cuoi(db: Session, repo: SanXuatKcsRepository, cv, so_dat, loi_sl: float) -> float:
    """Công đoạn CUỐI: kiểm đạt để nhập kho. `so_dat` bỏ trống ⇒ lần kiểm bao TRỌN phần tổ đã làm mà
    chưa kiểm, đạt = phần đó − số lỗi; gửi tường minh = kiểm một phần, đạt + lỗi không vượt phần đó."""
    chua_kiem = _phan_chua_kiem(db, repo, cv)
    if chua_kiem <= _EPS:
        raise ValueError("Tổ chưa ghi thêm sản lượng nào từ lần kiểm trước — chưa có gì để kiểm.")
    if so_dat in (None, ""):
        if loi_sl > chua_kiem + _EPS:
            raise ValueError(
                f"Số lỗi ({loi_sl:g}) vượt phần tổ đã làm mà chưa kiểm ({chua_kiem:g})."
            )
        dat = max(0.0, chua_kiem - loi_sl)
    else:
        dat = _so_khong_am(so_dat, "Số đạt")
        if dat + loi_sl > chua_kiem + _EPS:
            raise ValueError(
                f"Đạt + lỗi ({dat + loi_sl:g}) vượt phần tổ đã làm mà chưa kiểm ({chua_kiem:g})."
            )
    if dat + loi_sl <= _EPS:
        raise ValueError("Nhập số đạt hoặc số lỗi.")
    return dat


def _cong_doan_nguon_hop_le(db: Session, repo: SanXuatKcsRepository, cv,
                            lsx_id: int | None) -> dict[int, object]:
    """{cong_viec_id: công việc} KCS được quy lỗi về khi đang kiểm `cv`: các công đoạn của CÙNG lệnh
    đứng từ đầu chuỗi tới chính `cv` (thứ tự routing, như màn chuỗi công đoạn). Lỗi bắt ở bước sau
    mà gốc ở bước trước (lem mực thấy lúc đóng gói) thì trách nhiệm là của tổ bước trước.

    Bước CUỐI nhóm còn quy được về công việc của các lệnh PHỤ cùng nhóm (`kcs_checklist.chuoi_gop`).

    `lsx_id` = lệnh KCS đang mở — việc GHÉP phủ nhiều lệnh nên không tự suy được lệnh nào."""
    if cv.la_kcs_cuoi:
        return {c.id: c for c in chuoi_gop(db, cv, lsx_id)}
    lid = lsx_id or cv.lsx_id
    if not lid:
        return {cv.id: cv}
    bc = boi_canh.nap(db, [lid])
    cvs = bc.cong_viec_du(lid)
    if all(c.id != cv.id for c in cvs):
        raise ValueError("Công đoạn đang kiểm không thuộc lệnh này.")
    khoa = _thu_tu_cong_doan(bc, lid, repo.thu_tu_buoc([lid]))
    moc = khoa(cv)
    # Bước thuê ngoài không nhận lỗi KCS (11/10/2026) — cùng luật `chuoi_gop`.
    return {c.id: c for c in cvs if khoa(c) <= moc and (c.gia_cong_ngoai_id is None or c.id == cv.id)}


def _tieu_chi_cua(cv) -> dict[int, dict]:
    """{thu_tu: tiêu chí} trong ảnh chụp `kcs_tieu_chi_json` của chính công việc."""
    return {
        int(t["thu_tu"]): t for t in (cv.kcs_tieu_chi_json or [])
        if isinstance(t, dict) and t.get("thu_tu") is not None
    }


def _chuan_hoa_dong_giua(cv, cac_loi: list[dict], uid: int | None) -> list[tuple]:
    """Công đoạn GIỮA (09/10/2026, `docs/design-kcs-ghi-loi-giua.md`): mỗi dòng là MỘT tiêu chí của
    chính công đoạn mà KCS tick "không đạt" (`thu_tu`), hoặc "Lỗi khác" (không `thu_tu`). Số lỗi bắt
    buộc; ảnh không bắt buộc; ghi chú (`mo_ta` gửi lên) chỉ bắt buộc ở Lỗi khác. Lỗi luôn của chính
    công đoạn — lỗi gốc ở bước trước thì ghi ở bước đó, đếm theo đơn vị bước đó.

    Mô tả lưu = câu tiêu chí, có ghi chú thì nối sau dấu hai chấm — tổ đọc ở đâu cũng hiểu."""
    tieu_chi = _tieu_chi_cua(cv)
    da_tick: set[int] = set()
    out = []
    for i, r in enumerate(cac_loi, start=1):
        if (r.get("cong_viec_id") or cv.id) != cv.id:
            raise ValueError(
                "Công đoạn giữa chỉ ghi lỗi của chính nó — lỗi do bước trước thì ghi ở bước đó."
            )
        tt = r.get("thu_tu")
        ten = None
        if tt is not None:
            try:
                tt = int(tt)
            except (TypeError, ValueError):
                raise ValueError(f"Dòng lỗi {i}: tiêu chí không hợp lệ.")
            tc = tieu_chi.get(tt)
            if tc is None:
                raise ValueError(f"Dòng lỗi {i}: tiêu chí không còn trong lệnh, mở lại để nạp bộ mới.")
            if tt in da_tick:
                raise ValueError(f"Tiêu chí “{tc.get('ten') or tt}” bị ghi hai lần.")
            da_tick.add(tt)
            ten = (tc.get("ten") or "").strip() or f"Tiêu chí {tt}"
        sl = _so_khong_am(r.get("so_luong"), f"Số lỗi dòng {i}")
        if sl <= _EPS:
            raise ValueError(f"{ten or 'Lỗi khác'}: số lỗi phải lớn hơn 0.")
        ghi = (r.get("mo_ta") or "").strip()
        if ten is None and not ghi:
            raise ValueError("Lỗi khác: ghi chú lỗi gì.")
        mo_ta = (f"{ten}: {ghi}" if ghi else ten) if ten else ghi
        out.append((cv, sl, mo_ta[:500], [_chuan_hoa_anh(a, uid) for a in r.get("anh") or []], tt))
    return out


def _chuan_hoa_cac_loi(db: Session, repo: SanXuatKcsRepository, cv, cac_loi: list[dict],
                       lsx_id: int | None, uid: int | None,
                       nguon: dict[int, object] | None = None) -> list[tuple]:
    """Kiểm từng dòng lỗi → [(công việc chịu lỗi, số lượng, mô tả, ảnh, thu_tu tiêu chí)]. Công
    đoạn giữa đi `_chuan_hoa_dong_giua`. Bước cuối: mỗi dòng số > 0, mô tả, ≥1 ảnh; công đoạn chịu
    bỏ trống = chính công đoạn đang kiểm. `nguon` = tập quy lỗi được đã tính sẵn (bước cuối dùng
    chung chuỗi gộp với phần tiêu chí, khỏi nạp hai lần)."""
    if not cv.la_kcs_cuoi:
        return _chuan_hoa_dong_giua(cv, cac_loi, uid)
    # Bước cuối tick theo TIÊU CHÍ (11/10/2026, như hộp Ghi lỗi): dòng có `thu_tu` là một tiêu chí
    # không đạt của công đoạn chịu — mô tả = câu tiêu chí, ghi chú (nếu có) nối sau dấu hai chấm.
    # Dòng không `thu_tu` là "Lỗi khác": ghi chú bắt buộc. Ảnh vẫn bắt buộc ở mọi dòng bước cuối.
    out = []
    da_tick: set[tuple[int, int]] = set()
    for i, r in enumerate(cac_loi, start=1):
        sl = _so_khong_am(r.get("so_luong"), f"Số lỗi dòng {i}")
        if sl <= _EPS:
            raise ValueError(f"Dòng lỗi {i}: số lượng phải lớn hơn 0.")
        cid = r.get("cong_viec_id") or cv.id
        if cid == cv.id:
            chiu = cv
        else:
            if nguon is None:
                nguon = _cong_doan_nguon_hop_le(db, repo, cv, lsx_id)
            chiu = nguon.get(cid)
            if chiu is None:
                raise ValueError(
                    f"Dòng lỗi {i}: chỉ quy lỗi được về công đoạn đứng trước trong cùng lệnh"
                    + (" hoặc lệnh cùng nhóm." if cv.la_kcs_cuoi else ".")
                )
        ghi = (r.get("mo_ta") or "").strip()
        tt = r.get("thu_tu")
        if tt is not None:
            try:
                tt = int(tt)
            except (TypeError, ValueError):
                raise ValueError(f"Dòng lỗi {i}: tiêu chí không hợp lệ.")
            tc = _tieu_chi_cua(chiu).get(tt)
            if tc is None:
                raise ValueError(f"Dòng lỗi {i}: tiêu chí không còn trong lệnh, mở lại để nạp bộ mới.")
            if (chiu.id, tt) in da_tick:
                raise ValueError(f"Tiêu chí “{tc.get('ten') or tt}” bị ghi hai lần.")
            da_tick.add((chiu.id, tt))
            ten = (tc.get("ten") or "").strip() or f"Tiêu chí {tt}"
            mo_ta = f"{ten}: {ghi}" if ghi else ten
        elif not ghi:
            raise ValueError(f"Dòng lỗi {i}: phải mô tả lỗi.")
        else:
            mo_ta = ghi
        if not r.get("anh"):
            raise ValueError(f"Dòng lỗi {i}: phải kèm ít nhất một ảnh.")
        out.append((chiu, sl, mo_ta[:500], [_chuan_hoa_anh(a, uid) for a in r["anh"]], tt))
    return out


# --- Ghi ------------------------------------------------------------------------------------
def kiem_cong_doan(
    db: Session,
    *,
    user,
    cong_viec_id: int,
    so_dat=None,
    so_loi=0,
    checklist_ket_qua: list[dict] | None = None,
    ghi_chu: str | None = None,
    loi_mo_ta: str | None = None,
    anh: list[dict] | None = None,
    cac_loi: list[dict] | None = None,
    lsx_id: int | None = None,
) -> dict:
    """Ghi MỘT lần kiểm công đoạn. Người kiểm do server chốt từ tài khoản.

    Lỗi đi theo DÒNG (`cac_loi`, 19/09/2026): mỗi dòng số lượng + mô tả + ảnh + công đoạn CHỊU lỗi —
    mặc định chính công đoạn đang kiểm, KCS chọn được công đoạn đứng trước trong cùng lệnh. Số lỗi
    của lần kiểm = Σ các dòng, vẫn đếm bằng đơn vị công đoạn đang kiểm (hàng hỏng ở đây); còn trách
    nhiệm + thông báo đi về tổ của công đoạn chịu. Không có `cac_loi` = lối cũ một lỗi
    (`so_loi` + `loi_mo_ta` + `anh`) quy về chính công đoạn.

    Trả `notify_user_ids` = người Xác nhận sản lượng trọn tổ bị kiểm, và `bao_loi_nguon` = mỗi
    công đoạn trước bị quy lỗi một mục kèm người cần báo (router đẩy SSE).

    Công đoạn giữa chỉ ghi lỗi (`_chi_ghi_loi`, bỏ qua `so_dat` + tiêu chí). Công đoạn cuối:
    `so_dat` bỏ trống (form KCS chỉ gõ số lỗi): lần kiểm bao TRỌN phần tổ đã làm mà chưa kiểm, đạt =
    phần đó − số lỗi. Gửi `so_dat` tường minh = kiểm MỘT PHẦN, đạt + lỗi vẫn không được vượt phần
    đó. Hai nhánh chung một trần: lỗi/đạt là hàng tổ đã ghi, tổ chưa ghi mẻ thì chưa có gì để kiểm —
    trước 19/09/2026 nhánh tường minh không chặn nên đã có lần kiểm 1 lỗi trên công đoạn kiểm hết."""
    gate_kcs(db, user)
    repo = SanXuatKcsRepository(db)
    cv = repo.cong_viec(cong_viec_id)
    if cv is None:
        raise ValueError("Không tìm thấy công đoạn.")
    if cv.gia_cong_ngoai_id is not None:
        from ..gia_cong_ngoai import CHAN_XUONG

        raise ValueError(CHAN_XUONG)
    from .dong_lenh import chan_neu_da_dong

    chan_neu_da_dong(db, cv)
    if cv.trang_thai not in _TRANG_THAI_KIEM_DUOC:
        raise ValueError("Công đoạn chưa bắt đầu nên chưa kiểm được.")

    uid = getattr(user, "id", None)
    # Bước cuối: chuỗi gộp (cả lệnh phụ cùng nhóm) — vừa là tập quy lỗi được, vừa là nguồn tiêu chí.
    chuoi = chuoi_gop(db, cv, lsx_id) if cv.la_kcs_cuoi else None
    if cac_loi is not None:
        dong_loi = _chuan_hoa_cac_loi(
            db, repo, cv, cac_loi, lsx_id, uid,
            nguon={c.id: c for c in chuoi} if chuoi is not None else None,
        )
        loi_sl = sum(d[1] for d in dong_loi)
        if so_loi not in (None, "", 0) and abs(_so_khong_am(so_loi, "Số lỗi") - loi_sl) > _EPS:
            raise ValueError("Tổng các dòng lỗi phải bằng số lỗi.")
    else:
        loi_sl = _so_khong_am(so_loi if so_loi not in (None, "") else 0, "Số lỗi")
        dong_loi = None

    # Chống ghi lặp: máy chủ chậm, KCS bấm "Lưu" lần nữa ⇒ trước đây ra hai lần kiểm, lỗi nhân đôi
    # (và lượt sau thường bị trần "vượt phần đã làm" chặn với câu khó hiểu). Khoá công đoạn để hai
    # lượt đồng thời xếp hàng; lần kiểm y hệt trong `_CHONG_GHI_LAI` ⇒ trả lại lần đó, KHÔNG báo
    # lại tổ. Đứng TRƯỚC các trần vì lượt gửi lại sẽ bị trần chặn oan.
    SanXuatSanLuongRepository(db).khoa_cong_viec(cv.id)
    ghi_chu_sach = (ghi_chu or "").strip() or None
    so_dat_ro = (None if so_dat in (None, "") else _so_khong_am(so_dat, "Số đạt"))
    da_co = repo.lan_kiem_vua_ghi(
        cong_viec_id=cv.id, created_by=uid, so_loi=loi_sl, so_dat=so_dat_ro, ghi_chu=ghi_chu_sach,
        tu_luc=datetime.now(timezone.utc) - _CHONG_GHI_LAI,
    )
    if da_co is not None:
        return _ket_qua_lan_kiem_cu(db, repo, cv, da_co, user, lsx_id)

    if not cv.la_kcs_cuoi:
        dat = _chi_ghi_loi(db, repo, cv, loi_sl)
        checklist_ket_qua = None
    else:
        dat = _dat_cong_doan_cuoi(db, repo, cv, so_dat, loi_sl)

    if dong_loi is None:
        dong_loi = []
        if loi_sl > _EPS:
            mo_ta = (loi_mo_ta or "").strip()
            if not mo_ta:
                raise ValueError("Có lỗi thì phải mô tả lỗi.")
            # Ảnh chỉ bắt buộc ở bước cuối (09/10/2026) — công đoạn giữa ghi nhanh khi thấy.
            if not anh and cv.la_kcs_cuoi:
                raise ValueError("Có lỗi thì phải kèm ít nhất một ảnh.")
            dong_loi = [(cv, loi_sl, mo_ta, [_chuan_hoa_anh(r, uid) for r in anh or []], None)]
    if not cv.la_kcs_cuoi:
        # Tiêu chí KCS tick "không đạt" ở công đoạn giữa, kèm số lỗi của nó — báo cáo Theo tiêu chí
        # và khung công đoạn trên sơ đồ đếm từ đây. Lỗi khác không vào.
        checklist_ket_qua = [
            {"cong_viec_id": cv.id, "thu_tu": tt, "dat": False, "so_luong": sl}
            for _c, sl, _m, _a, tt in dong_loi if tt is not None
        ] or None
    if chuoi is not None:
        checklist_ket_qua = kiem_ket_qua(
            cv, checklist_gop(db, chuoi, lsx_id or cv.lsx_id), checklist_ket_qua,
            {chiu.id for chiu, *_ in dong_loi},
        )
        # Dòng lỗi gắn tiêu chí ⇒ cất số lỗi vào kết quả tiêu chí đó (báo cáo Theo tiêu chí đếm từ đây,
        # như công đoạn giữa).
        so_theo_tc: dict[tuple[int, int], float] = {}
        for chiu, sl, _m, _a, tt in dong_loi:
            if tt is not None:
                so_theo_tc[(chiu.id, tt)] = so_theo_tc.get((chiu.id, tt), 0.0) + sl
        # Chuỗi chưa gắn tiêu chí ⇒ `kiem_ket_qua` trả nguyên checklist form gửi, có thể thiếu
        # `cong_viec_id` — khoá theo luật chung (thiếu = công việc của lần kiểm).
        for kq in checklist_ket_qua or []:
            if not isinstance(kq, dict) or kq.get("thu_tu") is None:
                continue
            k = khoa_ket_qua(kq, cv.id)
            if k in so_theo_tc:
                if kq["dat"]:
                    raise ValueError("Tiêu chí có ghi lỗi thì phải là không đạt.")
                kq["so_luong"] = so_theo_tc[k]
    _chan_vuot_tot(db, repo, cv, dat)

    luc = _moc()
    don_vi = (cv.don_vi_ra or "").strip()
    kcs = SanXuatKcsBatch(
        cong_viec_id=cv.id,
        nhom_id=cv.nhom_id,
        bat_dau=luc,
        ket_thuc=luc,
        so_luong_nhan=dat + loi_sl,
        so_luong_dat=dat,
        so_luong_khong_dat=loi_sl,
        don_vi=don_vi,
        ket_luan=_ket_luan(dat, loi_sl),
        ghi_chu=(ghi_chu or "").strip() or None,
        checklist_json=checklist_ket_qua,
        created_by=uid,
    )
    repo.add(kcs)
    repo.flush()

    loi_id = None
    # Công đoạn TRƯỚC bị quy lỗi — gom theo công việc chịu để mỗi tổ nhận một thông báo.
    nguon: dict[int, dict] = {}
    for chiu, sl, mo_ta, cac_anh, _tt in dong_loi:
        loi = SanXuatKcsLoi(
            kcs_batch_id=kcs.id,
            mo_ta=mo_ta,
            to_chiu_id=chiu.department_id,
            cong_doan_ref_id=chiu.id,
            so_luong=sl,
            don_vi=don_vi or None,
            created_by=uid,
        )
        repo.add(loi)
        repo.flush()
        for a in cac_anh:
            a.loi_id = loi.id
            repo.add(a)
        loi_id = loi_id or loi.id
        if chiu.id != cv.id:
            m = nguon.setdefault(chiu.id, {
                "cong_viec_id": chiu.id, "department_id": chiu.department_id,
                "ten_cong_doan": chiu.ten_cong_doan, "so_loi": 0.0, "loi_id": loi.id,
            })
            m["so_loi"] += sl
    so_loi_cua_to = sum(d[1] for d in dong_loi if d[0].id == cv.id)

    AuditLogRepository(db).create(
        actor_user_id=uid,
        action="san_xuat_kcs_kiem",
        target=f"san_xuat_kcs_batch:{kcs.id}",
        detail=f"cong_viec={cv.id} dat={dat:g} loi={loi_sl:g}" + "".join(
            f" quy_loi(cong_viec={m['cong_viec_id']}, sl={m['so_loi']:g})" for m in nguon.values()
        ),
    )
    db.commit()
    for m in nguon.values():
        m["notify_user_ids"] = nguoi_co_quyen(db, m["department_id"], VIEC_XAC_NHAN)
    lsx = repo.lsx(cv.lsx_id or lsx_id)
    return {
        "kcs_batch_id": kcs.id,
        "loi_id": loi_id,
        "cong_viec_id": cv.id,
        "department_id": cv.department_id,
        "lsx_id": cv.lsx_id,
        "lsx_ma": lsx.ma if lsx else None,
        "nhom_id": cv.nhom_id,
        "ten_cong_doan": cv.ten_cong_doan,
        "la_kcs_cuoi": bool(cv.la_kcs_cuoi),
        "so_dat": dat,
        "so_loi": loi_sl,
        "ket_luan": kcs.ket_luan,
        "version": kcs.version,
        "nguoi_kiem": getattr(user, "name", None),
        "notify_user_ids": nguoi_co_quyen(db, cv.department_id, VIEC_XAC_NHAN),
        # Thông báo tới tổ bị kiểm chỉ nói phần lỗi CỦA tổ đó — phần quy về bước trước đi riêng.
        "don_vi": don_vi or None,
        "so_loi_cua_to": so_loi_cua_to,
        "bao_loi_nguon": list(nguon.values()),
    }


def _ket_qua_lan_kiem_cu(db: Session, repo: SanXuatKcsRepository, cv, kcs, user,
                         lsx_id: int | None) -> dict:
    """Kết quả của một lần kiểm ĐÃ ghi, cùng khuôn với `kiem_cong_doan` — cho lượt gửi lại. Danh sách
    người cần báo để TRỐNG: tổ đã được báo ở lượt đầu, báo lại là "ting" hai lần cho một lần kiểm."""
    lsx = repo.lsx(cv.lsx_id or lsx_id)
    so_loi = float(kcs.so_luong_khong_dat or 0)
    return {
        "kcs_batch_id": kcs.id,
        "loi_id": repo.loi_dau_id(kcs.id),
        "cong_viec_id": cv.id,
        "department_id": cv.department_id,
        "lsx_id": cv.lsx_id,
        "lsx_ma": lsx.ma if lsx else None,
        "nhom_id": cv.nhom_id,
        "ten_cong_doan": cv.ten_cong_doan,
        "so_dat": float(kcs.so_luong_dat or 0),
        "so_loi": so_loi,
        "ket_luan": kcs.ket_luan,
        "version": kcs.version,
        "nguoi_kiem": getattr(user, "name", None),
        "notify_user_ids": [],
        "don_vi": kcs.don_vi or None,
        "so_loi_cua_to": 0.0,
        "bao_loi_nguon": [],
        # Router dọn ảnh vừa tải lên của lượt gửi lại — lần kiểm cũ đã giữ ảnh của nó.
        "la_gui_lai": True,
    }


def ghi_kcs_ngoai_phan_mem(db: Session, *, cv, so_dat: float, uid: int | None,
                           ghi_chu: str, theo_lenh: tuple[int | None, str] | None = None,
                           ) -> SanXuatKcsBatch:
    """Bản ghi KCS ĐẠT tổng hợp cho công việc GIA CÔNG NGOÀI cuối nhóm (spec gia công §10).

    KCS làm ngoài phần mềm; con số chốt đứng thay. Không gate, không commit — `gia_cong_ngoai.chot`
    gác `san_xuat:update`. Nhờ bản ghi này "còn gửi kho" / đóng nhóm / trạng thái lệnh chạy nguyên
    đường cũ. Báo cáo KCS loại nó (`kcs_bao_cao`).

    `theo_lenh=(nhom_id, don_vi)`: công việc CHUNG của bài ghép ghi phần của TỪNG lệnh vào nhóm
    của lệnh đó (spec gia công bài ghép 2026-09-27 §3)."""
    luc = _moc()
    nhom_id, don_vi = theo_lenh if theo_lenh is not None else (cv.nhom_id, cv.don_vi_ra)
    kcs = SanXuatKcsBatch(
        cong_viec_id=cv.id, nhom_id=nhom_id, bat_dau=luc, ket_thuc=luc,
        so_luong_nhan=so_dat, so_luong_dat=so_dat, so_luong_khong_dat=0,
        don_vi=(don_vi or "").strip(), ket_luan=_ket_luan(so_dat, 0),
        ghi_chu=ghi_chu[:500], created_by=uid,
    )
    db.add(kcs)
    db.flush()
    return kcs


def _so_da_gui_kho(db: Session, cv) -> float:
    """Σ đã đề nghị nhập kho còn hiệu lực của công đoạn (đơn vị KCS) — đọc yêu cầu kho thật."""
    from .kho import dong_nhap_kho_cua_cong_viec, so_da_de_nghi_kcs

    if not cv.la_kcs_cuoi:
        return 0.0
    return so_da_de_nghi_kcs(dong_nhap_kho_cua_cong_viec(db, [cv.id]).get(cv.id, []))


def da_xem_loi(db: Session, *, user, loi_id: int) -> dict:
    """Tổ bị báo lỗi bấm "Đã xem" — người Xác nhận sản lượng TRỌN tổ chịu. Bấm lại không đổi gì."""
    repo = SanXuatKcsRepository(db)
    loi = repo.loi(loi_id)
    if loi is None:
        raise ValueError("Không tìm thấy lỗi.")
    gate_to_tron(db, getattr(user, "id", None), loi.to_chiu_id, VIEC_XAC_NHAN)
    kcs = repo.kcs_batch(loi.kcs_batch_id)
    if loi.phan_hoi_luc is None:
        loi.phan_hoi_by_id = getattr(user, "id", None)
        loi.phan_hoi_luc = _moc()
        loi.version += 1
        AuditLogRepository(db).create(
            actor_user_id=getattr(user, "id", None),
            action="san_xuat_kcs_da_xem_loi",
            target=f"san_xuat_kcs_loi:{loi.id}",
            detail=f"to={loi.to_chiu_id}",
        )
        db.commit()
    return {
        "loi_id": loi.id,
        "kcs_batch_id": loi.kcs_batch_id,
        "cong_viec_id": kcs.cong_viec_id if kcs else None,
        "department_id": loi.to_chiu_id,
        "da_xem_luc": thuc_te_hien_thi(loi.phan_hoi_luc),
        "nguoi_xem": repo.ten_nguoi([loi.phan_hoi_by_id]).get(loi.phan_hoi_by_id),
        "nguoi_kiem_id": kcs.created_by if kcs else None,
        "version": loi.version,
    }


# --- Đọc ------------------------------------------------------------------------------------
def _lan_kiem_ra(db: Session, repo: SanXuatKcsRepository,
                 batches: list[SanXuatKcsBatch]) -> dict[int, dict]:
    """{kcs_batch_id: lần kiểm bày ra} — lỗi/ảnh/tên người nạp GỘP một lượt."""
    ids = [b.id for b in batches]
    loi_map = repo.cac_loi_nhieu(ids)
    tat_ca_loi = [l for ds in loi_map.values() for l in ds]
    anh_map = repo.anh_cua_loi_nhieu([l.id for l in tat_ca_loi])
    ten = repo.ten_nguoi(
        {b.created_by for b in batches} | {l.phan_hoi_by_id for l in tat_ca_loi}
    )
    # Tên công đoạn của lần kiểm + công đoạn/tổ CHỊU từng lỗi — lỗi quy về bước trước phải nói rõ.
    cvs = repo.cong_viec_nhieu(
        {b.cong_viec_id for b in batches} | {l.cong_doan_ref_id for l in tat_ca_loi if l.cong_doan_ref_id}
    )
    ten_to = repo.ten_to({l.to_chiu_id for l in tat_ca_loi if l.to_chiu_id})

    def _ten_cd(cid) -> str | None:
        c = cvs.get(cid) if cid else None
        return c.ten_cong_doan if c else None

    out: dict[int, dict] = {}
    for b in batches:
        out[b.id] = {
            "id": b.id,
            "cong_viec_id": b.cong_viec_id,
            "cong_doan_ten": _ten_cd(b.cong_viec_id),
            "nguoi_kiem": ten.get(b.created_by),
            "luc": thuc_te_hien_thi(b.ket_thuc or b.created_at),
            "so_dat": float(b.so_luong_dat or 0),
            "so_loi": float(b.so_luong_khong_dat or 0),
            "don_vi": b.don_vi,
            "ket_luan": b.ket_luan,
            "checklist": b.checklist_json or [],
            "ghi_chu": b.ghi_chu,
            "version": b.version,
            "loi": [
                {
                    "id": l.id,
                    "mo_ta": l.mo_ta,
                    "so_luong": float(l.so_luong or 0),
                    "don_vi": l.don_vi,
                    "to_chiu_id": l.to_chiu_id,
                    "to_chiu_ten": ten_to.get(l.to_chiu_id) if l.to_chiu_id else None,
                    "cong_doan_id": l.cong_doan_ref_id,
                    "cong_doan_ten": _ten_cd(l.cong_doan_ref_id),
                    "da_xem_luc": thuc_te_hien_thi(l.phan_hoi_luc),
                    "nguoi_xem": ten.get(l.phan_hoi_by_id),
                    "anh": [
                        {"id": a.id, "file_name": a.file_name, "file_url": a.file_url,
                         "file_type": a.file_type}
                        for a in anh_map.get(l.id, [])
                    ],
                }
                for l in loi_map.get(b.id, [])
            ],
        }
    return out


def ket_qua_kcs_cong_viec(db: Session, user, cong_viec_id: int) -> dict:
    """Mục "Kết quả KCS" của một công đoạn. Người có Xem KCS xem mọi công đoạn; người khác theo phạm vi
    XEM của dòng quyền theo tổ (cùng phạm vi với chi tiết công việc)."""
    repo = SanXuatKcsRepository(db)
    cv = repo.cong_viec(cong_viec_id)
    if cv is None:
        raise ValueError("Không tìm thấy công đoạn.")
    if not xem_kcs(db, user):
        from .board import _loc_viec_cua_tho, _pham_vi_doc

        _q, muc = _pham_vi_doc(db, user, cv.department_id)
        if muc == MUC_CUA_TOI and not _loc_viec_cua_tho(db, user, [cv]):
            raise PermissionError("Chỉ xem được việc đã giao cho mình.")
    batches = repo.cac_kcs_batch(cong_viec_id)
    sau = repo.batch_quy_loi_ve(cong_viec_id)
    ra = _lan_kiem_ra(db, repo, batches + sau)
    # Công đoạn cuối: tổ thấy KCS đạt bao nhiêu trên số tốt mình ghi và đã đề nghị kho bao nhiêu —
    # công đoạn giữa không có "đạt" nên không có dòng này.
    cuoi = None
    if cv.la_kcs_cuoi:
        cuoi = {
            "tot": SanXuatSanLuongRepository(db).tong_tot(cv.id),
            "dat": repo.tong_dat(cv.id),
            "da_de_nghi_kho": _so_da_gui_kho(db, cv),
            "don_vi": (cv.don_vi_ra or "").strip() or None,
        }
    return {
        "cong_viec_id": cv.id,
        "la_kcs_cuoi": bool(cv.la_kcs_cuoi),
        "cuoi": cuoi,
        "checklist": _checklist_doc(db, cv, None),
        "lan_kiem": [ra[b.id] for b in reversed(batches)],
        "lan_kiem_buoc_sau": _chi_loi_quy_ve(ra, sau, cv.id),
    }


def _chuoi_doc(db: Session, cv, lsx_id: int | None) -> list:
    """`chuoi_gop` cho đường ĐỌC: dữ liệu lệch (công việc không còn trong lệnh) thì rơi về chính nó
    thay vì làm màn trắng."""
    try:
        return chuoi_gop(db, cv, lsx_id)
    except ValueError:
        return [cv]


def _checklist_doc(db: Session, cv, lsx_id: int | None, chuoi: list | None = None) -> list[dict]:
    """Tiêu chí bước cuối xét (gộp cả chuỗi); bước giữa không xét tiêu chí nào."""
    if not cv.la_kcs_cuoi:
        return []
    return checklist_gop(db, chuoi if chuoi is not None else _chuoi_doc(db, cv, lsx_id),
                         lsx_id or cv.lsx_id)


def _chi_loi_quy_ve(ra: dict[int, dict], batches, cong_viec_id: int) -> list[dict]:
    """Lần kiểm ở bước sau, mỗi lần chỉ giữ các lỗi quy về `cong_viec_id` — mới nhất trước. Tổ chỉ
    cần thấy lỗi của mình; số đạt/lỗi toàn lần kiểm là của bước kia nên để nguyên cho biết bối cảnh."""
    out = []
    for b in reversed(batches):
        lk = ra[b.id]
        loi = [l for l in lk["loi"] if l["cong_doan_id"] == cong_viec_id]
        if loi:
            out.append({**lk, "loi": loi})
    return out


def _thu_tu_cong_doan(bc, lsx_id: int, thu_tu: dict[int, tuple[int, int]]):
    """Khoá xếp chuỗi công đoạn theo thứ tự routing của lệnh: việc riêng theo bước của nó, việc
    ghép theo bước sớm nhất của lệnh mà nó phủ."""
    def khoa(cv):
        if cv.lsx_id == lsx_id:
            buoc = [cv.lsx_cong_doan_id]
        else:
            buoc = bc.buoc_phu.get(cv.id, [])
        tt = [thu_tu[b][1] for b in buoc if b in thu_tu and thu_tu[b][0] == lsx_id]
        return (min(tt) if tt else 10**9, cv.phan_doan_so or 1, cv.id)
    return khoa


def _dong_kho_cua(bc, cv) -> list:
    """Dòng yêu cầu nhập kho của MỘT công đoạn cuối. `bc.nhap_kho_tp` phát dòng của công đoạn cuối
    cho mọi lệnh cùng nhóm — lọc lại đúng `cong_viec_id` và khử trùng."""
    if not cv.la_kcs_cuoi:
        return []
    thay: dict[int, object] = {}
    for ds in bc.nhap_kho_tp.values():
        for d in ds:
            if d.cong_viec_id == cv.id:
                thay.setdefault(d.line_id, d)
    return sorted(thay.values(), key=lambda d: d.line_id)


def _da_gui_kho(bc, cv) -> float:
    """Σ đã đề nghị kho còn hiệu lực của MỘT công đoạn cuối (đơn vị KCS)."""
    return sum(d.sl_da_de_nghi_kcs for d in _dong_kho_cua(bc, cv))


def _tom_cuoi(bc, cvs) -> dict | None:
    cvs = [c for c in cvs if c.gia_cong_ngoai_id is None]
    cuoi = [cv for cv in cvs if cv.la_kcs_cuoi]
    if not cuoi:
        return None
    tot = sum(float(b.tot or 0) for cv in cuoi for b in bc.batch[cv.id])
    dat = sum(float(k.so_luong_dat or 0) for cv in cuoi for k in bc.kcs[cv.id])
    loi = sum(float(k.so_luong_khong_dat or 0) for cv in cuoi for k in bc.kcs[cv.id])
    da_yc = sum(_da_gui_kho(bc, cv) for cv in cuoi)
    co_muc_tieu = [cv for cv in cuoi if cv.so_luong_ra is not None]
    return {
        "tot": tot, "dat": dat, "da_yeu_cau": da_yc,
        "con_gui_kho": max(0.0, min(dat, tot) - da_yc),
        # Cùng công thức với form kiểm: phần tổ đã làm mà chưa lần kiểm nào bao (đạt + lỗi).
        "cho_kiem": max(0.0, tot - dat - loi),
        "muc_tieu": sum(float(cv.so_luong_ra) for cv in co_muc_tieu) if co_muc_tieu else None,
        "don_vi": next((cv.don_vi_ra for cv in cuoi if cv.don_vi_ra), None),
    }


# Tình trạng MỘT lệnh ở danh sách KCS (09/10/2026, phương án B nâng cấp) — một chữ, xét theo thứ tự
# việc KCS phải làm trước. Lọc nhanh đếm và lọc theo đúng chữ này.
TT_DA_DONG = "da_dong"
TT_CHO_KIEM = "cho_kiem"
TT_CHUA_GUI_KHO = "chua_gui_kho"
TT_CHO_DONG = "cho_dong"
TT_CHO_TO = "cho_to"
TT_DANG_LAM = "dang_lam"
TT_DA_XONG = "da_xong"
LOC_NHANH = ("tat_ca", TT_CHO_KIEM, TT_CHUA_GUI_KHO, TT_CHO_DONG, TT_DA_DONG)


def _tinh_trang_lenh(nhom, cvs, cuoi: dict | None) -> str:
    """Nhóm đóng ⇒ Đã đóng. Lệnh có bước cuối: còn hàng chờ kiểm ⇒ Chờ kiểm; còn đạt chưa gửi kho ⇒
    Chưa gửi kho; xong hết việc ⇒ Chờ đóng lệnh; không thì KCS đang chờ tổ làm. Lệnh PHỤ (không có
    bước cuối, KCS kiểm ở lệnh chính) chỉ nói tổ đang làm tới đâu."""
    if nhom is not None and nhom.trang_thai == NHOM_DONG:
        return TT_DA_DONG
    xong_het = all(cv.trang_thai == CV_HOAN_THANH for cv in cvs)
    if cuoi is None:
        if xong_het:
            return TT_DA_XONG
        return TT_DANG_LAM if any(cv.trang_thai in _TRANG_THAI_KIEM_DUOC for cv in cvs) else TT_CHO_TO
    if cuoi["cho_kiem"] > _EPS:
        return TT_CHO_KIEM
    if cuoi["con_gui_kho"] > _EPS:
        return TT_CHUA_GUI_KHO
    return TT_CHO_DONG if xong_het else TT_CHO_TO


def _nut_chuoi(cv, gay: dict) -> str:
    """Ô nhỏ của chuỗi: gây lỗi (bắt ở đâu cũng tính) đè lên trạng thái chạy."""
    if gay.get(cv.id):
        return "loi"
    if cv.trang_thai == CV_HOAN_THANH:
        return "xong"
    return "chay" if cv.trang_thai in (CV_DANG_CHAY, CV_TAM_DUNG) else "chua"


def _ten_cv(cv) -> str:
    tong = cv.phan_doan_tong or 1
    return f"{cv.ten_cong_doan} ({cv.phan_doan_so or 1}/{tong})" if tong > 1 else cv.ten_cong_doan


def _dong_danh_sach(db: Session, repo: SanXuatKcsRepository, ids: list[int]) -> list[dict]:
    """Dòng lưới cho các lệnh `ids` (giữ thứ tự) — nạp GỘP một lượt: bối cảnh, thứ tự routing, lỗi
    gây bởi từng công việc, cạnh lệnh phụ → lệnh chính."""
    if not ids:
        return []
    bc = boi_canh.nap(db, ids)
    thu_tu = repo.thu_tu_buoc(ids)
    cvs_cua = {
        lid: sorted(bc.cong_viec_du(lid), key=_thu_tu_cong_doan(bc, lid, thu_tu))
        for lid in ids if lid in bc.lenh
    }
    gay: dict[int, dict[str, float]] = {}
    for cid, dv, sl in repo.loi_gay_boi({cv.id for ds in cvs_cua.values() for cv in ds}):
        acc = gay.setdefault(cid, {})
        acc[dv or ""] = acc.get(dv or "", 0.0) + sl
    nhom_cua = {
        lid: next((bc.nhom[cv.nhom_id] for cv in cvs if cv.nhom_id in bc.nhom), None)
        for lid, cvs in cvs_cua.items()
    }
    noi = repo.noi_lenh_phu({n.id for n in nhom_cua.values() if n is not None})
    cv_noi = repo.cong_viec_nhieu(noi.values())

    items = []
    for lid in ids:
        lenh = bc.lenh.get(lid)
        if lenh is None:
            continue
        cvs = cvs_cua[lid]
        don = bc.don.get(lenh.order_id)
        khach = bc.khach.get(don.customer_id) if don and don.customer_id else None
        nhom = nhom_cua[lid]
        cuoi = _tom_cuoi(bc, cvs)
        # Lỗi do lệnh này gây — theo thứ tự chuỗi, gộp phân đoạn cùng tên; đơn vị là của nơi bắt.
        loi: dict[tuple[str, str], float] = {}
        for cv in cvs:
            for dv, sl in gay.get(cv.id, {}).items():
                loi[(cv.ten_cong_doan, dv)] = loi.get((cv.ten_cong_doan, dv), 0.0) + sl
        dich = cv_noi.get(noi[lid]) if lid in noi else None
        items.append({
            "lsx_id": lid,
            "ma": lenh.ma,
            "ten": lenh.ten,
            "khach": khach.name if khach else None,
            "nhom_ma": nhom.ma if nhom else None,
            "nhom_trang_thai": nhom.trang_thai if nhom else None,
            "don_vi_tinh": lenh.don_vi_tinh or None,
            "so_cong_doan": len(cvs),
            "so_da_kiem": sum(1 for cv in cvs if bc.kcs[cv.id]),
            "so_loi": sum(float(k.so_luong_khong_dat or 0) for cv in cvs for k in bc.kcs[cv.id]),
            "cuoi": cuoi,
            "created_at": lenh.created_at,
            # Lần KCS gần nhất — cùng tập công việc với mốc kỳ `kcs` ở repo (`kcs_gan_nhat_cua_lenh`).
            "kcs_gan_nhat": max(
                (k.ket_thuc for cv in cvs for k in bc.kcs[cv.id] if k.ket_thuc is not None),
                default=None,
            ),
            "la_lenh_phu": bool(nhom and nhom.than_chinh_lsx_id and nhom.than_chinh_lsx_id != lid),
            "noi_vao": dich.ten_cong_doan if dich is not None else None,
            "chuoi": [
                {"ten": _ten_cv(cv), "trang_thai": _nut_chuoi(cv, gay),
                 "la_kcs_cuoi": bool(cv.la_kcs_cuoi)}
                for cv in cvs
            ],
            "loi_gay": [
                {"ten": ten, "don_vi": dv or None, "so_luong": sl} for (ten, dv), sl in loi.items()
            ],
            "tinh_trang": _tinh_trang_lenh(nhom, cvs, cuoi),
        })
    return items


def _tinh_trang_nhieu(db: Session, ids: list[int]) -> dict[int, str]:
    """Chỉ TÌNH TRẠNG của các lệnh `ids` — đúng những gì `_tinh_trang_lenh` cần (bối cảnh + tóm bước
    cuối), không nạp thứ tự routing, lỗi gây, cạnh lệnh phụ. Dùng để đếm nút / lọc ba nút tình trạng
    cho MỌI lệnh nhóm còn mở; dòng lưới đầy đủ chỉ dựng cho lệnh của trang (L-VAI-13, 26/10/2026)."""
    if not ids:
        return {}
    from .kho import dong_nhap_kho_cua_cong_viec

    nen = SanXuatKcsRepository(db).tinh_trang_nen(ids)
    # Dòng nhập kho của công đoạn cuối — phát cho mọi lệnh cùng nhóm, đúng như `boi_canh.nap` câu 12.
    dong_theo_cv = dong_nhap_kho_cua_cong_viec(db, [r[0] for r in nen["cv_cuoi"]])
    nhap: dict[int, list] = {i: [] for i in ids}
    for cv_id, nhom_id_cv, lsx_id in nen["cv_cuoi"]:
        dich = set(nen["lsx_theo_nhom"].get(nhom_id_cv, ())) if nhom_id_cv else set()
        if lsx_id in nhap:
            dich.add(lsx_id)
        for i in dich:
            if i in nhap:
                nhap[i].extend(dong_theo_cv.get(cv_id, []))
    # Bối cảnh RÚT GỌN cùng hình với `BoiCanh` cho `_tom_cuoi` / `_da_gui_kho`: mỗi công việc một
    # "mẻ" mang Σ tốt và một "lần kiểm" mang Σ đạt / lỗi — tổng như cộng từng dòng.
    bc = SimpleNamespace(
        batch=defaultdict(list, {c: [SimpleNamespace(tot=t)] for c, t in nen["tot"].items()}),
        kcs=defaultdict(list, {c: [SimpleNamespace(so_luong_dat=d, so_luong_khong_dat=k)]
                               for c, (d, k) in nen["kiem"].items()}),
        nhap_kho_tp=nhap,
    )
    out: dict[int, str] = {}
    for lid in ids:
        if lid not in nen["lenh"]:
            continue
        cvs = nen["cv"][lid]
        nhom = next((nen["nhom"][cv.nhom_id] for cv in cvs if cv.nhom_id in nen["nhom"]), None)
        out[lid] = _tinh_trang_lenh(nhom, cvs, _tom_cuoi(bc, cvs))
    return out


def danh_sach_lenh_kcs(
    db: Session, user, *, tim: str | None = None, trang: int = 1, nhanh: str = "tat_ca",
    co_trang: int = _CO_TRANG, **loc,
) -> dict:
    """Danh sách lệnh cho màn KCS — phân trang + tìm + lọc ở máy chủ. `co_trang` do ô Dòng/trang ở
    chân bảng gửi lên; router đã chặn 1..100, ở đây chỉ chặn dưới cho lời gọi nội bộ.

    `nhanh` = nút lọc nhanh (09/10/2026): `tat_ca` mọi lệnh, `da_dong` nhóm đã đóng — hai nút này
    lọc + cắt trang thẳng bằng SQL. Ba nút còn lại theo TÌNH TRẠNG (`_tinh_trang_lenh`), chỉ tính
    được trên số liệu: tính cho mọi lệnh nhóm còn mở khớp các điều kiện khác rồi mới cắt trang. Chỉ tính
    TÌNH TRẠNG (`_tinh_trang_nhieu`) cho tập đó; dòng lưới đầy đủ chỉ dựng cho lệnh của trang."""
    gate_xem_kcs(db, user)
    repo = SanXuatKcsRepository(db)
    nhanh = nhanh if nhanh in LOC_NHANH else "tat_ca"
    trang = max(1, int(trang or 1))
    co_trang = max(1, int(co_trang or _CO_TRANG))
    offset = (trang - 1) * co_trang
    # `loc` = thanh lọc (06/10/2026): `khach_id`, `tu_ngay`/`den_ngay`/`moc`.
    ids_mo, so_mo = repo.trang_lenh(tim=tim, gom_da_dong=False, offset=0, limit=None, **loc)
    tt_mo = _tinh_trang_nhieu(db, ids_mo)
    _ids, so_dong = repo.trang_lenh(
        tim=tim, gom_da_dong=False, chi_da_dong=True, offset=0, limit=0, **loc)
    dem = {k: sum(1 for t in tt_mo.values() if t == k)
           for k in (TT_CHO_KIEM, TT_CHUA_GUI_KHO, TT_CHO_DONG)}
    dem.update(tat_ca=so_mo + so_dong, da_dong=so_dong)

    if nhanh in ("tat_ca", TT_DA_DONG):
        ids, tong = repo.trang_lenh(
            tim=tim, gom_da_dong=True, chi_da_dong=nhanh == TT_DA_DONG, offset=offset,
            limit=co_trang, **loc,
        )
    else:
        # Giữ thứ tự `ids_mo` (thứ tự repo) như khi còn dựng dòng cho cả tập.
        khop = [i for i in ids_mo if tt_mo.get(i) == nhanh]
        tong = len(khop)
        ids = khop[offset:offset + co_trang]
    items = _dong_danh_sach(db, repo, ids)
    return {"items": items, "tong": tong, "trang": trang, "co_trang": co_trang, "dem": dem}


def khach_loc_kcs(db: Session, user) -> list[dict]:
    """Ô "Khách hàng" của thanh lọc màn KCS: khách có lệnh đã vào nhóm thành phẩm, kèm số lệnh."""
    gate_xem_kcs(db, user)
    return [{"id": i, "ten": t, "so": n} for i, t, n in SanXuatKcsRepository(db).khach_loc()]


def gia_tri_loc_kcs(db: Session, user) -> dict:
    """Giá trị các ô lọc lấy từ dữ liệu của màn KCS (11/10/2026), mỗi giá trị kèm số lệnh:
    tổ gây lỗi, công đoạn gây lỗi, người kiểm. Cùng tập lệnh với danh sách (đã vào nhóm)."""
    gate_xem_kcs(db, user)
    repo = SanXuatKcsRepository(db)
    to: dict[int, set[int]] = {}
    cd: dict[str, set[int]] = {}
    for lid, did, ten in repo.loi_gay_theo_lenh():
        if did is not None:
            to.setdefault(int(did), set()).add(lid)
        if ten:
            cd.setdefault(ten, set()).add(lid)
    nguoi: dict[int, set[int]] = {}
    for lid, uid in repo.nguoi_kiem_theo_lenh():
        nguoi.setdefault(uid, set()).add(lid)
    ten_to = repo.ten_to(to)
    ten_nguoi = repo.ten_nguoi(nguoi)
    theo_ten = lambda ds: sorted(ds, key=lambda o: o["ten"].lower())  # noqa: E731
    return {
        "to": theo_ten([{"id": i, "ten": ten_to.get(i, f"Tổ #{i}"), "so": len(s)} for i, s in to.items()]),
        "cong_doan": theo_ten([{"ten": t, "so": len(s)} for t, s in cd.items()]),
        "nguoi_kiem": theo_ten([{"id": i, "ten": ten_nguoi.get(i, f"Người #{i}"), "so": len(s)}
                                for i, s in nguoi.items()]),
    }


def chuoi_cong_doan_kcs(db: Session, user, lsx_id: int) -> dict:
    """Chuỗi công đoạn của MỘT lệnh theo thứ tự routing, kèm tổng tốt/hỏng tổ đã ghi và các lần
    kiểm — màn KCS bấm vào một công đoạn để kiểm."""
    gate_xem_kcs(db, user)
    repo = SanXuatKcsRepository(db)
    bc = boi_canh.nap(db, [lsx_id])
    lenh = bc.lenh.get(lsx_id)
    if lenh is None:
        raise ValueError("Không tìm thấy lệnh sản xuất.")
    cvs = bc.cong_viec_du(lsx_id)
    cvs.sort(key=_thu_tu_cong_doan(bc, lsx_id, repo.thu_tu_buoc([lsx_id])))
    tat_ca_kcs = [k for cv in cvs for k in bc.kcs[cv.id]]
    # Lần kiểm ở chỗ KHÁC quy lỗi về công đoạn của lệnh này — gồm KCS cuối của thân chính quy về
    # bước của lệnh PHỤ cùng nhóm (lần kiểm đó không nằm trong `bc.kcs` của lệnh phụ).
    co = {k.id for k in tat_ca_kcs}
    quy_tu_ngoai = [k for k in repo.batch_quy_loi_ve_nhieu([cv.id for cv in cvs]) if k.id not in co]
    ra = _lan_kiem_ra(db, repo, tat_ca_kcs + quy_tu_ngoai)
    # Bước cuối: chuỗi gộp — nguồn tiêu chí + ô "công đoạn chịu lỗi" của form kiểm.
    gop = {cv.id: _chuoi_doc(db, cv, lsx_id) for cv in cvs if cv.la_kcs_cuoi}
    ten_to = repo.ten_to({cv.department_id for cv in cvs}
                         | {c.department_id for ch in gop.values() for c in ch})
    ma_lenh = repo.ma_lsx_nhieu({c.lsx_id for ch in gop.values() for c in ch})
    don = bc.don.get(lenh.order_id)
    khach = bc.khach.get(don.customer_id) if don and don.customer_id else None
    nhom = next((bc.nhom[cv.nhom_id] for cv in cvs if cv.nhom_id in bc.nhom), None)
    # Mẻ tổ đã ghi (19/09/2026): form kiểm bày kèm để KCS biết đang kiểm chồng hàng nào — người trong
    # mẻ và người ghi nạp GỘP một lượt cho cả chuỗi, mẻ thì `bc.batch` đã có sẵn.
    tat_ca_me = [b for cv in cvs for b in bc.batch[cv.id]]
    nguoi_me = nguoi_theo_me(db, {b.id for b in tat_ca_me})
    nguoi_ghi = repo.ten_nguoi({b.created_by for b in tat_ca_me if b.created_by})
    # Lỗi KCS bắt ở bước SAU mà quy về bước này — {cong_viec_id: {(bước bắt, đơn vị): số}}. Đơn vị
    # là của bước bắt (hàng hỏng ở đó), không quy đổi về đơn vị bước này.
    quy_ve: dict[int, dict[tuple[str, str], float]] = {}
    for k in tat_ca_kcs + quy_tu_ngoai:
        for l in ra[k.id]["loi"]:
            if l["cong_doan_id"] and l["cong_doan_id"] != k.cong_viec_id:
                khoa = (ra[k.id]["cong_doan_ten"] or "", l["don_vi"] or "")
                acc = quy_ve.setdefault(l["cong_doan_id"], {})
                acc[khoa] = acc.get(khoa, 0.0) + l["so_luong"]

    cong_doan = []
    for cv in cvs:
        ds = bc.kcs[cv.id]
        tot = sum(float(b.tot or 0) for b in bc.batch[cv.id])
        dat = sum(float(k.so_luong_dat or 0) for k in ds)
        da_yc = _da_gui_kho(bc, cv)
        may = bc.may.get(cv.may_id) if cv.may_id else None
        cong_doan.append({
            "cong_viec_id": cv.id,
            "ten": cv.ten_cong_doan,
            "phan_doan_so": cv.phan_doan_so,
            "phan_doan_tong": cv.phan_doan_tong,
            "to_id": cv.department_id,
            "to_ten": ten_to.get(cv.department_id or 0, ""),
            "trang_thai": cv.trang_thai,
            "tot": tot,
            "hong": sum(float(b.hong or 0) for b in bc.batch[cv.id]),
            "don_vi": cv.don_vi_ra,
            "la_kcs_cuoi": bool(cv.la_kcs_cuoi),
            "checklist": _checklist_doc(db, cv, lsx_id, gop.get(cv.id)),
            # Tiêu chí của CHÍNH công đoạn (ảnh chụp lúc phát hành) — danh sách tick ở hộp Ghi lỗi
            # công đoạn giữa, và bảng Tiêu chí trên khung công đoạn của sơ đồ.
            "tieu_chi": [
                {"thu_tu": tt, "ma": t.get("ma"), "ten": t.get("ten") or ""}
                for tt, t in sorted(_tieu_chi_cua(cv).items())
            ],
            # Công việc bước cuối quy lỗi về được (chuỗi gộp, kể cả lệnh phụ) — bước giữa rỗng: form
            # tự lấy các công đoạn đứng trước trong cùng lệnh như cũ.
            "nguon_loi": [
                {"cong_viec_id": c.id, "ten": c.ten_cong_doan, "lsx_ma": ma_lenh.get(c.lsx_id),
                 "to_ten": ten_to.get(c.department_id or 0, ""), "la_dang_kiem": c.id == cv.id}
                for c in gop.get(cv.id, [])
            ],
            "so_lan_kiem": len(ds),
            "tong_dat": dat,
            "tong_loi": sum(float(k.so_luong_khong_dat or 0) for k in ds),
            # Lỗi bắt ở đây VÀ do chính công đoạn này (08/10/2026) — cùng `loi_buoc_sau` là lỗi tính
            # cho công đoạn; tình trạng KCS của nó theo hai số này, không theo `tong_loi` nơi bắt.
            "loi_tai_cho": sum(
                l["so_luong"] for k in ds for l in ra[k.id]["loi"]
                if l["cong_doan_id"] in (None, cv.id)
            ),
            "da_yeu_cau_kho": da_yc,
            "con_gui_kho": (
                max(0.0, min(dat, tot) - da_yc)
                if cv.la_kcs_cuoi and cv.gia_cong_ngoai_id is None else 0.0
            ),
            "gia_cong_ngoai": cv.gia_cong_ngoai_id is not None,
            "nha_gia_cong": cv.nha_cung_cap if cv.gia_cong_ngoai_id is not None else None,
            "yeu_cau_kho": [
                {"request_id": d.request_id, "ma": d.request_ma, "trang_thai": d.trang_thai,
                 "sl_de_nghi": round(d.sl_hieu_luc, 3), "sl_da_nhan": round(d.sl_da_nhan, 3),
                 "don_vi": d.dvt, "tao_luc": thuc_te_hien_thi(d.created_at)}
                for d in _dong_kho_cua(bc, cv)
            ],
            "lan_kiem": [ra[k.id] for k in reversed(ds)],
            "loi_buoc_sau": [
                {"phat_hien_o": ten, "don_vi": dv or None, "so_luong": sl}
                for (ten, dv), sl in quy_ve.get(cv.id, {}).items()
            ],
            # Bối cảnh cho form kiểm: kế hoạch, máy, dặn dò + thẻ quy cách chụp lúc phát hành (cùng
            # nguồn với ngăn chi tiết của bàn tổ) — KCS đối chiếu hàng với quy cách ngay trong form.
            "so_luong_ra": float(cv.so_luong_ra) if cv.so_luong_ra is not None else None,
            "may": may.ten if may else None,
            "ghi_chu_ky_thuat": cv.ghi_chu,
            "quy_cach": cv.quy_cach_json or None,
            "me": [
                {"id": b.id, "bat_dau": thuc_te_hien_thi(b.bat_dau),
                 "ket_thuc": thuc_te_hien_thi(b.ket_thuc), "so_luong": float(b.tot or 0),
                 "don_vi": b.don_vi,
                 "nguoi_ghi": nguoi_ghi.get(b.created_by) if b.created_by else None,
                 "nguoi": [n["ho_ten"] for n in nguoi_me.get(b.id, [])]}
                for b in sorted(bc.batch[cv.id], key=lambda b: (b.ket_thuc, b.id), reverse=True)
            ],
        })
    return {
        "lsx": {
            "id": lenh.id, "ma": lenh.ma, "ten": lenh.ten,
            "khach": khach.name if khach else None,
            "nhom_id": nhom.id if nhom else None,
            "nhom_ma": nhom.ma if nhom else None,
            "nhom_trang_thai": nhom.trang_thai if nhom else None,
            "don_vi_tinh": lenh.don_vi_tinh or None,
        },
        "cong_doan": cong_doan,
    }


def so_do_nhom_kcs(db: Session, user, lsx_id: int) -> dict:
    """Sơ đồ cả NHÓM thành phẩm của lệnh (phương án B nâng cấp, 09/10/2026): mỗi lệnh một làn — lệnh
    phụ trước (theo mã), lệnh chính cuối — mỗi làn đúng là chuỗi công đoạn của `chuoi_cong_doan_kcs`.
    `noi_vao_cong_viec_id` = công việc của lệnh chính mà lệnh phụ ghép vào (cạnh phụ thuộc chéo chụp
    lúc phát hành). Lệnh không có công đoạn nào (vd gia công trọn gói) không thành làn."""
    gate_xem_kcs(db, user)
    repo = SanXuatKcsRepository(db)
    if repo.lsx(lsx_id) is None:
        raise ValueError("Không tìm thấy lệnh sản xuất.")
    nhom = repo.nhom(repo.nhom_id_cua_lsx(lsx_id))
    ids = sorted(set(repo.lsx_trong_nhom(nhom.id if nhom else None)) | {lsx_id})
    chinh = nhom.than_chinh_lsx_id if nhom and nhom.than_chinh_lsx_id in ids else lsx_id
    noi = repo.noi_lenh_phu([nhom.id]) if nhom else {}
    lan = []
    for lid in ids:
        r = chuoi_cong_doan_kcs(db, user, lid)
        if not r["cong_doan"] and lid != lsx_id:
            continue
        phu = lid != chinh
        lan.append({**r, "la_lenh_phu": phu, "noi_vao_cong_viec_id": noi.get(lid) if phu else None})
    lan.sort(key=lambda l: (not l["la_lenh_phu"], l["lsx"]["ma"] or ""))
    than = next((l for l in lan if not l["la_lenh_phu"]), lan[0])
    return {
        "nhom": {
            "id": nhom.id, "ma": nhom.ma, "ten": nhom.ten or None, "trang_thai": nhom.trang_thai,
            "khach": than["lsx"]["khach"],
        } if nhom else None,
        "lenh": lan,
    }


def loi_cho_xem(db: Session, to_ids) -> list[dict]:
    """Lỗi KCS gửi tới các tổ này mà tổ chưa bấm "Đã xem" — dòng "KCS báo lỗi" ở bàn tổ."""
    repo = SanXuatKcsRepository(db)
    rows = repo.loi_chua_xem_nhieu_to(set(to_ids))
    if not rows:
        return []
    batches = repo.kcs_batch_nhieu({l.kcs_batch_id for l in rows})
    cvs = repo.cong_viec_nhieu(
        {b.cong_viec_id for b in batches.values()} | {l.cong_doan_ref_id for l in rows}
    )
    ten = repo.ten_nguoi({b.created_by for b in batches.values()})
    anh_map = repo.anh_cua_loi_nhieu([l.id for l in rows])
    lsx_ma = repo.ma_lsx_nhieu({cv.lsx_id for cv in cvs.values()})
    out = []
    for l in rows:
        b = batches.get(l.kcs_batch_id)
        bat = cvs.get(b.cong_viec_id) if b else None
        # Dòng lỗi gắn vào công đoạn CHỊU lỗi (chấm đỏ + tab KCS của công đoạn đó); bắt ở bước sau
        # thì nói thêm bước bắt.
        cv = cvs.get(l.cong_doan_ref_id) or bat
        out.append({
            "loi_id": l.id,
            "kcs_batch_id": l.kcs_batch_id,
            "cong_viec_id": cv.id if cv else None,
            "to_id": l.to_chiu_id,
            "ten_cong_doan": cv.ten_cong_doan if cv else "",
            "phat_hien_o": bat.ten_cong_doan if bat is not None and bat is not cv else None,
            "lsx_ma": lsx_ma.get(cv.lsx_id) if cv else None,
            "mo_ta": l.mo_ta,
            "so_luong": float(l.so_luong or 0),
            "don_vi": l.don_vi,
            "nguoi_kiem": ten.get(b.created_by) if b else None,
            "luc": thuc_te_hien_thi(l.created_at),
            "so_anh": len(anh_map.get(l.id, [])),
            "version": l.version,
        })
    return out
