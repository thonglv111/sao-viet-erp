"""Thực hiện sản xuất — BÀN GIAO công đoạn (Giai đoạn 3, §11.2 · §11.3).

Một số lượng THỐNG NHẤT mỗi lần giao — không lưu hai con số cạnh tranh. Cùng tổ + cùng LSX thì
tự `confirmed`; khác tổ/khác LSX thì `proposed` → bên NHẬN xác nhận đúng con số cuối.

Số lần giao ĐI THEO MẺ: "Điều chỉnh số" trên lần giao GỠ 10/10/2026 — bên giao sửa số ở chính mẻ
(`san_luong.sua_so_me`), lần giao chứa mẻ đổi theo; khác tổ thì bên nhận xác nhận lại.

Quyền (dòng quyền theo tổ, mg 0302): ĐỀ XUẤT/SỬA đòi Xác nhận sản lượng ở tổ NGUỒN; XÁC NHẬN đòi
Xác nhận sản lượng trọn tổ ĐÍCH. Tất cả siết ở service, router chỉ gác coarse.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.san_xuat_san_luong import (
    BG_DE_XUAT,
    BG_XAC_NHAN,
    SanXuatBanGiao,
    SanXuatBanGiaoBatch,
)
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from ..quyen_to import VIEC_XAC_NHAN, nguoi_co_quyen
from .dau_vao import cung_to_cung_lsx
from .thuc_thi import _gate, _kiem_version, _moc
from .san_luong import _EPS


def _nguoi_nhan(db: Session, user, *department_ids: int | None) -> list[int]:
    """Người giữ quyền Xác nhận sản lượng (cả tổ) ở các tổ này — trừ chính người vừa bấm."""
    uid = getattr(user, "id", None)
    ket: set[int] = set()
    for d in department_ids:
        ket.update(nguoi_co_quyen(db, d, VIEC_XAC_NHAN))
    ket.discard(uid)
    return sorted(ket)


def cho_xac_nhan_lai(bg: SanXuatBanGiao) -> bool:
    """Bên giao sửa số mẻ của lần giao đã xác nhận, bên nhận CHƯA xác nhận lại số mới (10/10/2026).
    Số mới vẫn có hiệu lực — cờ này chỉ lái nút Xác nhận và hộp việc chờ của tổ nhận."""
    return bg.trang_thai == BG_XAC_NHAN and bg.xac_nhan_luc is None and not bg.cung_to


# Tự xác nhận ⇔ cùng tổ VÀ cùng LSX (§11.2). Luật này nay nằm ở `dau_vao.cung_to_cung_lsx` vì
# cổng đầu vào và trần ghi mẻ cũng đọc nó — giữ hai bản là hai bản trôi khác hướng.
_la_cung_to = cung_to_cung_lsx


def _ket_qua(
    bg: SanXuatBanGiao, nguon_cv, dich_cv, *,
    notify_user_ids: list[int] | None = None, su_kien: str = "",
) -> dict:
    return {
        "ban_giao_id": bg.id,
        "trang_thai_ban_giao": bg.trang_thai,
        "so_luong": float(bg.so_luong),
        "version": bg.version,
        "nguon_cong_viec_id": bg.nguon_cong_viec_id,
        "dich_cong_viec_id": bg.dich_cong_viec_id,
        "nguon_department_id": nguon_cv.department_id if nguon_cv else None,
        "dich_department_id": dich_cv.department_id if dich_cv else None,
        "notify_user_ids": list(notify_user_ids or []),
        # Nhãn cho toast của người nhận (§18) — họ thường không mở đúng công đoạn này.
        "su_kien": su_kien,
        "nguon_ten": nguon_cv.ten_cong_doan if nguon_cv else "",
        "dich_ten": dich_cv.ten_cong_doan if dich_cv else "",
        "don_vi": bg.don_vi,
    }


def lap_ban_giao(
    db: Session, *, user, nguon_cv, dich_cv, so_luong: float, don_vi: str, batch_ids: list[int],
) -> SanXuatBanGiao:
    """LÕI ghi một bàn giao — KHÔNG gate, KHÔNG commit, không tự tính số.

    `de_xuat` gác quyền tổ nguồn + suy số từ mẻ rồi gọi vào đây. Phiếu nhận thuê gia công về
    xưởng (`services/thue_gia_cong`) gác quyền module và giao ĐÚNG số nhận — công việc thuê gia
    công không có tổ nào để gác theo dòng quyền tổ."""
    repo = SanXuatSanLuongRepository(db)
    cung_to = _la_cung_to(nguon_cv, dich_cv)
    now = _moc()
    uid = getattr(user, "id", None)
    bg = SanXuatBanGiao(
        nguon_cong_viec_id=nguon_cv.id, dich_cong_viec_id=dich_cv.id, cung_to=cung_to,
        so_luong=so_luong, don_vi=don_vi,
        trang_thai=BG_XAC_NHAN if cung_to else BG_DE_XUAT,
        de_xuat_by_id=uid, de_xuat_luc=now,
        xac_nhan_by_id=uid if cung_to else None, xac_nhan_luc=now if cung_to else None,
    )
    repo.add(bg)
    repo.flush()
    for batch_id in batch_ids:
        repo.add(SanXuatBanGiaoBatch(ban_giao_id=bg.id, batch_id=batch_id))
    AuditLogRepository(db).create(
        actor_user_id=uid, action="san_xuat_ban_giao_de_xuat", target=f"san_xuat_ban_giao:{bg.id}",
        detail=(f"nguon={nguon_cv.id} dich={dich_cv.id} sl={so_luong} "
                f"me={','.join(map(str, batch_ids)) or '-'} {'cung_to' if cung_to else 'de_xuat'}"),
        commit=False,
    )
    return bg


def ghi_xac_nhan(db: Session, *, bg: SanXuatBanGiao, user) -> None:
    """LÕI xác nhận — KHÔNG gate, KHÔNG commit. `xac_nhan` gác quyền tổ đích; Phiếu giao thuê gia
    công gác quyền module (đích là công việc thuê gia công, không tổ nào nhận)."""
    bg.trang_thai = BG_XAC_NHAN
    bg.xac_nhan_by_id = getattr(user, "id", None)
    bg.xac_nhan_luc = _moc()
    bg.version += 1
    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None), action="san_xuat_ban_giao_xac_nhan",
        target=f"san_xuat_ban_giao:{bg.id}", detail=f"sl={float(bg.so_luong)}", commit=False,
    )


def ket_qua_cho_ben_nhan(db: Session, *, user, bg, nguon_cv, dich_cv) -> dict:
    """Bàn giao MỚI chờ bên nhận: báo người Xác nhận sản lượng ở tổ ĐÍCH (cùng tổ ⇒ không báo ai).
    Đích là công việc THUÊ GIA CÔNG thì không tổ nào nhận — báo người lập phiếu giao (ô
    `thue_gia_cong:create`) bằng sự kiện "sẵn sàng giao": Hàng chờ đổi tình trạng không cần F5."""
    if dich_cv.tgc_viec_id is not None:
        from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository
        from ..thue_gia_cong.thong_tin_lenh import cua_viec

        uid = getattr(user, "id", None)
        tgc = ThueGiaCongRepository(db)
        ra = _ket_qua(bg, nguon_cv, dich_cv, su_kien="san_sang_giao", notify_user_ids=[
            u for u in tgc.nguoi_co("thue_gia_cong", "create") if u != uid])
        viec = tgc.viec(dich_cv.tgc_viec_id)
        lenh = cua_viec(db, [viec]).get(viec.id, []) if viec is not None else []
        ra["lsx_ma"] = ", ".join(l["lsx_ma"] for l in lenh)
        ra["tgc_viec_id"] = dich_cv.tgc_viec_id
        return ra
    notify = [] if bg.trang_thai == BG_XAC_NHAN else _nguoi_nhan(db, user, dich_cv.department_id)
    return _ket_qua(bg, nguon_cv, dich_cv, notify_user_ids=notify, su_kien="de_xuat")


def ket_qua_da_nhan(db: Session, *, user, bg, nguon_cv, dich_cv) -> dict:
    """Bên nhận vừa xác nhận: báo người Xác nhận sản lượng ở tổ NGUỒN."""
    return _ket_qua(bg, nguon_cv, dich_cv, su_kien="xac_nhan", notify_user_ids=_nguoi_nhan(
        db, user, nguon_cv.department_id if nguon_cv else None))


def _so_theo_me(
    repo: SanXuatSanLuongRepository,
    nguon_cv,
    batch_ids: list[int] | None,
    *,
    ban_giao: SanXuatBanGiao | None = None,
) -> tuple[list[int], float]:
    """Chọn mẻ ⇒ ra số lượng giao (14/09/2026). Tổ KHÔNG gõ số: số = tổng TỐT của các mẻ chọn.

    Còn mẻ chưa giao thì phải chọn ít nhất một; mẻ đã đi theo lần giao KHÁC thì không chọn lại được.
    Hết mẻ chưa giao mà vẫn còn lẻ (số cũ trước khi giao theo mẻ) thì giao nốt phần lẻ, không mẻ.
    Số không vượt phần còn chưa giao: bàn giao tạo trước khi có giao-theo-mẻ không gắn mẻ nào, nên
    mẻ cũ vẫn hiện "chưa giao" dù số đã đi rồi.

    `ban_giao` = lần giao đang SỬA: mẻ của chính nó chọn lại được, số của nó không tính là đã giao."""
    cua_no: set[int] = set()
    con_lai = repo.tong_tot(nguon_cv.id) - repo.tong_da_giao(nguon_cv.id)
    if ban_giao is not None:
        cua_no = set(repo.me_cua_ban_giao_nhieu([ban_giao.id]).get(ban_giao.id, []))
        con_lai += float(ban_giao.so_luong)
    da_giao = repo.batch_da_giao_ids(nguon_cv.id) - cua_no
    chua_giao = {
        b.id: b for b in repo.cac_batch(nguon_cv.id)
        if b.id not in da_giao and float(b.tot) > _EPS
    }
    chon = list(dict.fromkeys(batch_ids or []))
    if chon:
        if any(i not in chua_giao for i in chon):
            raise ValueError("Có lần ghi không thuộc bước này, không có sản lượng tốt hoặc đã giao rồi.")
        sl = min(sum(float(chua_giao[i].tot) for i in chon), con_lai)
    elif chua_giao:
        raise ValueError("Chọn sản lượng cần giao.")
    else:
        sl = con_lai
    if sl <= _EPS:
        raise ValueError("Không còn sản lượng tốt để giao.")
    return chon, sl


def de_xuat(
    db: Session,
    *,
    user,
    nguon_cong_viec_id: int,
    dich_cong_viec_id: int | None,
    don_vi: str | None = None,
    batch_ids: list[int] | None = None,
) -> dict:
    """Bên NGUỒN đề xuất giao sản lượng tốt sang công đoạn sau (§11.2).

    Cùng tổ + cùng LSX → `confirmed` ngay. Khác → `proposed`, chờ bên đích xác nhận.

    ĐÍCH phải là chặng sau theo routing lệnh (`cong_viec_chang_sau`) — không còn chọn tự do trong
    mọi việc cùng lệnh. Bước cuối lệnh (không có chặng sau) KHÔNG bàn giao: thành phẩm rời tổ qua
    KCS kiểm rồi đề nghị nhập kho. "Giao ra kho" (`dich=None`) ĐÃ GỠ 17/09/2026 — nó đẻ một bàn giao
    không ai xác nhận được, treo mãi ở `proposed`.

    GIAO THEO MẺ: số lượng suy ra từ mẻ chọn (`_so_theo_me`), không nhận số gõ tay. Đếm thực tế lệch
    thì bên giao sửa số ở mẻ (`san_luong.sua_so_me`), lần giao đổi theo."""
    repo = SanXuatSanLuongRepository(db)
    nguon_cv = repo.cong_viec(nguon_cong_viec_id)
    if nguon_cv is None:
        raise ValueError("Không tìm thấy công việc nguồn.")
    _gate(db, user, nguon_cv, VIEC_XAC_NHAN)
    from .dong_lenh import chan_neu_da_dong

    chan_neu_da_dong(db, nguon_cv)

    chang_sau = {c.id: c for c in repo.cong_viec_chang_sau(nguon_cv)}
    if not chang_sau:
        raise ValueError(
            "Bước cuối của lệnh không bàn giao — thành phẩm vào kho qua KCS kiểm và đề nghị nhập kho."
        )
    if not dich_cong_viec_id:
        raise ValueError("Bước này còn chặng sau theo routing — phải giao cho chặng sau.")
    if dich_cong_viec_id not in chang_sau:
        raise ValueError("Đích bàn giao không phải chặng sau của bước này theo routing.")
    dich_cv = chang_sau[dich_cong_viec_id]

    chon, sl = _so_theo_me(repo, nguon_cv, batch_ids)

    don_vi_bg = (don_vi or nguon_cv.don_vi_ra or "").strip()
    if not don_vi_bg:
        raise ValueError("Bàn giao chưa có đơn vị.")

    bg = lap_ban_giao(db, user=user, nguon_cv=nguon_cv, dich_cv=dich_cv, so_luong=sl,
                      don_vi=don_vi_bg, batch_ids=chon)
    db.commit()
    return ket_qua_cho_ben_nhan(db, user=user, bg=bg, nguon_cv=nguon_cv, dich_cv=dich_cv)


def sua_de_xuat(
    db: Session,
    *,
    user,
    ban_giao_id: int,
    batch_ids: list[int] | None,
    expected_version: int | None = None,
) -> dict:
    """Bên NGUỒN sửa lại MẺ đi theo lần giao khi còn `proposed` (§11.2) — tick nhầm thì gỡ ra, sót
    thì thêm vào; số lượng tính lại theo mẻ. Đã xác nhận thì không đổi mẻ nữa, chỉ sửa số mẻ."""
    repo = SanXuatSanLuongRepository(db)
    bg = repo.ban_giao(ban_giao_id)
    if bg is None:
        raise ValueError("Không tìm thấy bàn giao.")
    if bg.trang_thai != BG_DE_XUAT:
        raise ValueError("Chỉ sửa được đề xuất chưa xác nhận.")
    nguon_cv = repo.cong_viec(bg.nguon_cong_viec_id)
    dich_cv = repo.cong_viec(bg.dich_cong_viec_id) if bg.dich_cong_viec_id else None
    _gate(db, user, nguon_cv, VIEC_XAC_NHAN)
    _kiem_version(bg, expected_version)

    chon, sl = _so_theo_me(repo, nguon_cv, batch_ids, ban_giao=bg)
    sl_truoc = float(bg.so_luong)

    # Gỡ dòng cũ TRƯỚC rồi mới thêm: `batch_id` UNIQUE, mà trong một lần flush SQLAlchemy chèn
    # trước xoá sau. Mẻ giữ nguyên thì giữ nguyên dòng.
    cu = {lk.batch_id: lk for lk in repo.lien_ket_me(bg.id)}
    for batch_id, lk in cu.items():
        if batch_id not in chon:
            repo.delete(lk)
    repo.flush()
    for batch_id in chon:
        if batch_id not in cu:
            repo.add(SanXuatBanGiaoBatch(ban_giao_id=bg.id, batch_id=batch_id))

    bg.so_luong = sl
    bg.version += 1
    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None),
        action="san_xuat_ban_giao_sua",
        target=f"san_xuat_ban_giao:{bg.id}",
        detail=f"sl={sl_truoc:g}->{sl:g} me={','.join(map(str, chon)) or '-'}",
    )
    db.commit()
    return _ket_qua(bg, nguon_cv, dich_cv, su_kien="sua", notify_user_ids=_nguoi_nhan(
        db, user, dich_cv.department_id if dich_cv else None))


def xac_nhan(
    db: Session,
    *,
    user,
    ban_giao_id: int,
    expected_version: int | None = None,
) -> dict:
    """Bên ĐÍCH xác nhận đúng con số cuối (§11.2). Số này thành đầu ra được chấp nhận + đầu vào khả dụng.

    Cũng là nút XÁC NHẬN LẠI sau khi bên giao sửa số mẻ (`cho_xac_nhan_lai`): ghi lại ai nhận, lúc nào."""
    repo = SanXuatSanLuongRepository(db)
    bg = repo.ban_giao(ban_giao_id)
    if bg is None:
        raise ValueError("Không tìm thấy bàn giao.")
    nhan_lai = cho_xac_nhan_lai(bg)
    if bg.trang_thai != BG_DE_XUAT and not nhan_lai:
        raise ValueError("Bàn giao này không ở trạng thái chờ xác nhận.")
    if bg.dich_cong_viec_id is None:
        raise ValueError("Công đoạn nhận của bàn giao này không còn — không xác nhận được.")
    nguon_cv = repo.cong_viec(bg.nguon_cong_viec_id)
    dich_cv = repo.cong_viec(bg.dich_cong_viec_id)
    if dich_cv is not None and dich_cv.tgc_viec_id is not None:
        # Hàng giao sang bước thuê gia công: không tổ nào nhận — nhận bằng Phiếu giao.
        from ..thue_gia_cong import CHAN_NHAN_TAY

        raise ValueError(CHAN_NHAN_TAY)
    _gate(db, user, dich_cv, VIEC_XAC_NHAN)
    if nguon_cv is not None:
        from .dong_lenh import chan_neu_da_dong

        chan_neu_da_dong(db, nguon_cv)
    _kiem_version(bg, expected_version)

    ghi_xac_nhan(db, bg=bg, user=user)
    db.commit()
    return ket_qua_da_nhan(db, user=user, bg=bg, nguon_cv=nguon_cv, dich_cv=dich_cv)
