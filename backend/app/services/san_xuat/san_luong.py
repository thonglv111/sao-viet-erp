"""Thực hiện sản xuất — SẢN LƯỢNG: ghi batch + lot đầu vào (Giai đoạn 3, §10.3 · §11.1).

Điều phối lệnh GHI batch sản lượng. Tuân §18 như lát phiên-chạy: kiểm quyền tại service (đúng
tổ trưởng) → transaction → ghi audit → (SSE do router phát sau commit). Truy vấn/ghi DB nằm ở
`repositories/san_xuat_san_luong_repo.py`; ở đây chỉ luật.

Luật cứng (§11.1): `tong = tot + hong` (dung sai làm tròn 3 số lẻ); hỏng ghi kèm mô tả tự do
(`mo_ta_loi`, tuỳ chọn) — danh mục lý do/lỗi ĐÃ GỠ. Chọn lot đầu vào (§10.3) dựng quan hệ truy vết
mẻ công đoạn trước → batch đầu ra.

Từ 18/09/2026 (mg `0318`) mẻ ghi theo CÔNG VIỆC KHOÁN của tổ, bắt buộc, kèm các VIỆC PHÁT SINH đã
làm — kiểm + chụp ảnh ở `viec_khoan.chuan_hoa_khi_ghi`. Việc phát sinh KHÔNG cộng vào `tong` /
`tot` / `hong`: nó là con số ĐỨNG CẠNH sản lượng (*"mẻ sản lượng 3.000 và thay kẽm 2"*), không đi
vào tiến độ, bàn giao, KCS hay nhập kho. Tầng CHIA sản lượng cho từng người GỠ HẲN cùng ngày —
chủ xưởng: *"ghi nhận thế thôi, đừng có chia bất cứ gì"*.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ...models.san_xuat import BUOC_THUE_NGOAI, CV_DANG_CHAY, CV_HOAN_THANH, CV_TAM_DUNG
from ...models.san_xuat_san_luong import (
    BG_XAC_NHAN,
    SanXuatBanGiao,
    SanXuatBatch,
    SanXuatBatchLotVao,
    SanXuatKetQuaNhanh,
)
from ...repositories.don_vi_do_repo import DonViDoRepository, nhan_don_vi
from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from ..gio_xuong import moc_tu_client
from .dau_vao import _so, bang_dv_viec, kiem_giam_buoc_sau, kiem_tran_ghi, tran_buoc_sau
from .nguoi_ghi import chot_nguoi, ghi_nguoi, sua_nguoi
from .nguoi_trong_me import ngay_cua_me
from .thuc_thi import _gate, _kiem_version, _moc
from .viec_khoan import anh_chup_tuy_chon, chuan_hoa_khi_ghi, chup_lai_bac, quy_cach_cua_viec

# Dung sai làm tròn cho ràng buộc tong = tot + hong: cột Numeric(18,3) nên nửa bậc số lẻ cuối là
# 0.0005 — quá ngưỡng này coi như nhập lệch chứ không phải sai số làm tròn.
_EPS = 0.0005
# Chỉ ghi sản lượng cho công việc ĐÃ khởi động (đang chạy / tạm dừng / đã xong) — chưa bắt đầu thì
# chưa có gì để ghi.
_TRANG_THAI_GHI_DUOC = (CV_DANG_CHAY, CV_TAM_DUNG, CV_HOAN_THANH)
# Độ lệch đồng hồ chấp nhận giữa máy tổ gõ giờ và máy chủ khi chặn mẻ ở tương lai.
_LECH_DONG_HO = timedelta(minutes=5)
# Mẻ Y HỆT (cùng việc, người, cửa sổ giờ, số) ghi lại trong khoảng này = một lần bấm bị gửi lại.
_CHONG_GHI_LAI = timedelta(seconds=30)


def _so_khong_am(x, ten: str) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        raise ValueError(f"{ten} không hợp lệ.")
    if v != v or v in (float("inf"), float("-inf")):  # NaN/inf
        raise ValueError(f"{ten} không hợp lệ.")
    if v < 0:
        raise ValueError(f"{ten} không được âm.")
    return v


def _ket_qua_batch(cv, batch: SanXuatBatch | None, ket_qua_lsx: list[dict] | None = None) -> dict:
    return {
        "cong_viec_id": cv.id,
        "department_id": cv.department_id,
        "trang_thai": cv.trang_thai,
        "version": cv.version,
        "batch_id": batch.id if batch is not None else None,
        "ket_qua_lsx": ket_qua_lsx or [],
    }


def he_so_nhanh_toa(canh) -> float:
    """Một đơn vị đầu RA của điểm toả thành bao nhiêu đơn vị ĐẦU VÀO của bước riêng nhận.

    Bước nhận ăn con/thành phẩm ⇒ × số con/tờ ghép (`ty_le_ghep`). Bước nhận ăn CÙNG đơn vị với
    điểm toả (tờ ghép vào Cắt thành phẩm) ⇒ × 1: tờ → con là việc của chính bước đó, hệ số của nó
    đã là số con/tờ ghép (`snapshot.dung_diem_toa`). Nhân ở đây nữa là nhân hai lần — E2E 27/09/2026
    ra "10.320 tờ" cho 2.580 tờ ghép và trần ghi mẻ 41.280 con."""
    nguon = (canh.don_vi_nguon or "").strip()
    if nguon and nguon == (canh.don_vi_dich or "").strip():
        return 1.0
    return float(canh.ty_le_ghep or 0)


def _toa_san_luong(
    db: Session, repo: SanXuatSanLuongRepository, *, cv, batch: SanXuatBatch, tot: float, actor,
) -> list[dict]:
    """Tự TOẢ sản lượng TỐT của một batch điểm-toả sang các nhánh LSX riêng (§ điểm toả bài ghép).

    Mỗi cạnh `SanXuatPhuThuoc` xuất phát từ `cv` (điểm toả, do `dung_diem_toa` sinh lúc phát hành)
    mang `ty_le_ghep` = số con/tờ của lệnh đích — quy `tot` ra đơn vị vào của nhánh qua
    `he_so_nhanh_toa` (bước nhận ăn tờ thì giữ nguyên số tờ ghép), rồi bàn
    giao THẲNG dạng đã xác nhận (không qua đề xuất/xác nhận hai bên): số này suy MỘT CHIỀU từ
    `tot`, không thể vượt, nên không cần vòng thương lượng như bàn giao người khai tay (§11.2)."""
    if tot <= 0:
        return []
    canh = repo.canh_toa_di_tu(cv.id)
    if not canh:
        return []
    ket_qua: list[dict] = []
    now = _moc()
    for c in canh:
        dich_cv = repo.cong_viec(c.dich_cong_viec_id)
        if dich_cv is None or dich_cv.lsx_id is None or not c.ty_le_ghep:
            continue
        sl_nhanh = round(tot * he_so_nhanh_toa(c), 3)
        if sl_nhanh <= 0:
            continue
        don_vi_nhanh = c.don_vi_dich or dich_cv.don_vi_vao or batch.don_vi
        kq = SanXuatKetQuaNhanh(
            batch_id=batch.id, lsx_id=dich_cv.lsx_id, so_luong=sl_nhanh, don_vi=don_vi_nhanh,
        )
        repo.add(kq)
        bg = SanXuatBanGiao(
            nguon_cong_viec_id=cv.id,
            dich_cong_viec_id=dich_cv.id,
            cung_to=False,
            so_luong=sl_nhanh,
            don_vi=don_vi_nhanh,
            trang_thai=BG_XAC_NHAN,
            de_xuat_by_id=getattr(actor, "id", None),
            de_xuat_luc=now,
            xac_nhan_by_id=getattr(actor, "id", None),
            xac_nhan_luc=now,
        )
        repo.add(bg)
        repo.flush()
        kq.ban_giao_id = bg.id
        ket_qua.append({
            "lsx_id": dich_cv.lsx_id, "so_luong": sl_nhanh, "don_vi": don_vi_nhanh,
            "ban_giao_id": bg.id,
        })
    return ket_qua


def _chuan_hoa_lot(
    repo: SanXuatSanLuongRepository, dich_cv, don_vi_mac_dinh: str, raw: dict,
    dv_ten: dict[str, str],
) -> SanXuatBatchLotVao:
    """Dựng một dòng lot đầu vào từ payload thô, kiểm §10.3. KHÔNG add vào session (caller làm).
    Nguồn duy nhất là mẻ đầu ra của công đoạn trước (lot BTP trong kho đã gỡ 17/09/2026)."""
    so_luong = _so_khong_am(raw.get("so_luong"), "Số lượng lot")
    if so_luong <= 0:
        raise ValueError("Số lượng lot phải lớn hơn 0.")
    don_vi = (raw.get("don_vi") or don_vi_mac_dinh or "").strip()
    if not don_vi:
        raise ValueError("Lot đầu vào chưa có đơn vị.")

    nguon_batch_id = raw.get("nguon_batch_id")
    if not nguon_batch_id:
        raise ValueError("Lot từ công đoạn trước phải chọn batch nguồn.")
    nguon = repo.batch(int(nguon_batch_id))
    if nguon is None:
        raise ValueError("Không tìm thấy batch nguồn của lot đầu vào.")
    if nguon.cong_viec_id == dich_cv.id:
        raise ValueError("Batch nguồn không được trùng chính công việc đang ghi.")
    # Batch nguồn là điểm toả bài ghép (đã tách theo LSX) — công việc đang ghi phải THUỘC một
    # LSX có phần trong đó, và không được dùng vượt phần đã toả cho LSX của chính nó.
    if dich_cv.lsx_id is not None and repo.co_ket_qua_nhanh(nguon.id):
        kq = repo.ket_qua_nhanh_cua(nguon.id, dich_cv.lsx_id)
        if kq is None:
            raise ValueError(
                "Batch nguồn đã toả theo từng lệnh sản xuất — lệnh này không có phần trong đó."
            )
        da_dung = repo.da_dung_nhanh(nguon.id, dich_cv.lsx_id)
        if da_dung + so_luong > float(kq.so_luong) + _EPS:
            raise ValueError(
                f"Vượt phần đã toả cho lệnh sản xuất này "
                f"({float(kq.so_luong):g} {nhan_don_vi(dv_ten, kq.don_vi)})."
            )

    return SanXuatBatchLotVao(
        nguon_batch_id=int(nguon_batch_id),
        so_luong=so_luong,
        don_vi=don_vi,
    )


def _aware(dt: datetime) -> datetime:
    """SQLite trả datetime NAIVE (vốn là UTC) — ép nhãn UTC trước khi so với `_moc()`."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _khoang_luc_bam(db: Session, repo: SanXuatSanLuongRepository, cv) -> tuple[datetime, datetime]:
    """Cửa sổ lần ghi khi tổ KHÔNG gõ giờ (10/10/2026, chủ xưởng: *"thời gian sẽ theo cái nút ghi
    sản lượng"*): kết thúc = lúc bấm; bắt đầu = kết thúc lần ghi gần nhất, chưa ghi lần nào thì đầu
    phiên chạy đầu tiên — đúng mốc hộp Ghi sản lượng vẫn gợi ý trước đây."""
    from ...repositories.san_xuat_thuc_thi_repo import SanXuatThucThiRepository

    bay_gio = _moc()
    cuoi_me = [_aware(b.ket_thuc) for b in repo.cac_batch(cv.id)
               if b.ket_thuc is not None and _aware(b.ket_thuc) <= bay_gio]
    if cuoi_me:
        return max(cuoi_me), bay_gio
    dau_phien = [_aware(p.bat_dau) for p in SanXuatThucThiRepository(db).cac_phien(cv.id)
                 if p.bat_dau is not None and _aware(p.bat_dau) <= bay_gio]
    return (min(dau_phien) if dau_phien else bay_gio), bay_gio


def tao_batch(
    db: Session,
    *,
    user,
    cong_viec_id: int,
    bat_dau: datetime | None = None,
    ket_thuc: datetime | None = None,
    tong,
    tot,
    hong=0,
    don_vi: str | None = None,
    mo_ta_loi: str | None = None,
    ghi_chu: str | None = None,
    lot_vao: list[dict] | None = None,
    phat_sinh: list[dict] | None = None,
    nguoi_ids: list[int] | None = None,
    tuy_chon: dict[str, float] | None = None,
    mat_in: str | None = None,
    tu_giao: bool = True,
) -> dict:
    """Ghi MỘT batch sản lượng (§11.1) + lot đầu vào (§10.3) + việc khoán & phát sinh (§7.1).

    Ràng buộc: `tong = tot + hong`. Đơn vị bỏ trống ⇒ lấy `don_vi_ra` của công việc (đơn vị bản
    địa công đoạn). Khoán được tự lấy theo công đoạn nguồn. `phat_sinh` là
    `[{phat_sinh_id, so_luong}]`, cho phép rỗng. `nguoi_ids` = người làm lần này: người tổ mình tổ
    tick + người tổ khác tổ thêm thẳng (`nguoi_ghi.chot_nguoi`).

    Không truyền giờ (hộp Ghi sản lượng từ 10/10/2026) ⇒ giờ theo lúc bấm, xem `_khoang_luc_bam`.

    `tu_giao` = ghi xong tự đề xuất giao lần ghi này sang chặng sau (`_tu_de_xuat_giao`); test dựng
    sẵn mẻ để thử Đề xuất giao bằng tay thì tắt."""
    repo = SanXuatSanLuongRepository(db)
    cv = repo.cong_viec(cong_viec_id)
    if cv is None:
        raise ValueError("Không tìm thấy công việc.")
    if cv.gia_cong_ngoai_id is not None:
        from ..gia_cong_ngoai import CHAN_XUONG

        raise ValueError(CHAN_XUONG)
    _gate(db, user, cv)
    from .dong_lenh import chan_neu_da_dong

    chan_neu_da_dong(db, cv, cho_viec_dang_chay=True)
    if cv.trang_thai not in _TRANG_THAI_GHI_DUOC:
        raise ValueError("Chỉ ghi sản lượng cho công việc đã bắt đầu.")

    tong_f = _so_khong_am(tong, "Tổng số lượng")
    tot_f = _so_khong_am(tot, "Số lượng tốt")
    hong_f = _so_khong_am(hong, "Số lượng hỏng")
    # Mẻ 0 hợp lệ (19/09/2026): ca chỉ làm việc phát sinh (thay kẽm, lên khuôn…) vẫn phải có mẻ để
    # ghi nhận ai có mặt + việc phát sinh; số 0 không cộng gì vào tiến độ/bàn giao.
    if abs(tong_f - (tot_f + hong_f)) > _EPS:
        raise ValueError("Tổng số lượng phải bằng Tốt + Hỏng.")

    tu_lay_gio = bat_dau is None and ket_thuc is None
    if not tu_lay_gio and (bat_dau is None or ket_thuc is None):
        raise ValueError("Batch phải có khoảng thời gian bắt đầu và kết thúc.")
    # Ô `datetime-local` gửi chuỗi KHÔNG offset ⇒ naive = GIỜ TƯỜNG xưởng. Quy về UTC THẬT ngay ở
    # cửa vào để cửa sổ mẻ đo cùng thước với khoảng tham gia và chấm công (§7.3/§12.1), xem
    # `services/gio_xuong.moc_tu_client`.
    if not tu_lay_gio:
        bat_dau = moc_tu_client(bat_dau)
        ket_thuc = moc_tu_client(ket_thuc)
    if not tu_lay_gio and ket_thuc < bat_dau:
        raise ValueError("Kết thúc batch không được trước khi bắt đầu.")
    # Mẻ ghi SAU khi làm xong. Cửa sổ ở tương lai là gõ nhầm hoặc để nguyên giờ kế hoạch (16/09/2026:
    # ba mẻ Dán mang 17/09 20:00→22:50 khi bước mới chạy từ 16/09 15:24) — không dấu chấm công nào
    # rơi vào đó nên cổng §7.3 chặn chốt phân bổ mãi. Nới vài phút cho đồng hồ máy tổ lệch máy chủ.
    if not tu_lay_gio and ket_thuc > _moc() + _LECH_DONG_HO:
        raise ValueError("Giờ kết thúc đang ở sau thời điểm hiện tại — chỉ ghi phần đã làm xong.")

    # Chống ghi trùng: giờ cao điểm máy chủ chậm, tổ bấm "Ghi mẻ" lần nữa (hoặc mạng tự gửi lại) ⇒
    # trước đây ra HAI mẻ y hệt, sản lượng nhân đôi. Khoá việc rồi mới tìm, để hai lượt đồng thời
    # cũng xếp hàng. Mẻ y hệt trong `_CHONG_GHI_LAI` ⇒ trả lại mẻ đó, không ghi thêm. Phải đứng
    # TRƯỚC `kiem_tran_ghi`: lượt gửi lại của một mẻ vừa chạm trần sẽ bị trần chặn oan.
    repo.khoa_cong_viec(cv.id)
    da_co = repo.me_vua_ghi(
        cong_viec_id=cv.id, created_by=getattr(user, "id", None),
        bat_dau=None if tu_lay_gio else bat_dau, ket_thuc=None if tu_lay_gio else ket_thuc,
        tong=tong_f, tot=tot_f, hong=hong_f,
        # Giờ THẬT, không phải `_moc()`: so với `created_at` — cột này luôn ghi giờ thật.
        tu_luc=datetime.now(timezone.utc) - _CHONG_GHI_LAI,
    )
    if da_co is not None:
        return _ket_qua_batch(cv, da_co)
    if tu_lay_gio:
        # Sau khoá việc: hai lượt ghi liền nhau nối đúng vào nhau, không chồng cửa sổ.
        bat_dau, ket_thuc = _khoang_luc_bam(db, repo, cv)

    don_vi_batch = (don_vi or cv.don_vi_ra or "").strip()
    if not don_vi_batch:
        raise ValueError("Công đoạn chưa có đơn vị sản lượng — báo kỹ thuật khai đơn vị ra cho công đoạn này.")
    # Sản lượng được CỘNG THẲNG rồi đem trừ `so_luong_ra` (mục tiêu bước) — không có tầng quy đổi ở
    # đây. Nhận đơn vị khác `don_vi_ra` là cộng táo với cam: 20 ram ghi vào bước khai 10.000 tờ ra
    # "còn thiếu 9.980" dù việc đã xong. Từ chối rõ ràng đúng hơn là cộng nhầm im lặng.
    don_vi_cv = (cv.don_vi_ra or "").strip()
    # Câu này TỔ đọc, nên nói tên đơn vị ("tờ") chứ đừng nói mã ("to") — cột giữ mã, xem
    # `DonViDoRepository.ten_theo_ma`.
    dv_ten = bang_dv_viec(db, cv)
    if don_vi_cv and don_vi_batch != don_vi_cv:
        raise ValueError(
            f"Đơn vị sản lượng phải là “{nhan_don_vi(dv_ten, don_vi_cv)}” — "
            f"đúng đơn vị đầu ra của bước này."
        )
    # Dựng lot + kiểm việc khoán TRƯỚC khi add batch để bắt lỗi sớm (chưa chạm session cho tới khi
    # hợp lệ hết) — add nửa mẻ rồi mới báo "việc phát sinh không thuộc việc này" là để lại rác
    # trong session của request.
    don_vi_lot_mac_dinh = (cv.don_vi_vao or don_vi_batch or "").strip()
    cac_lot = [
        _chuan_hoa_lot(repo, cv, don_vi_lot_mac_dinh, r, dv_ten)
        for r in (lot_vao or [])
    ]
    # Trần theo số đã nhận từ công đoạn trước × hệ số quy đổi (19/09/2026) — xem `dau_vao`. Đứng
    # SAU lot: lot trỏ đúng mẻ nguồn nên câu lỗi của lot (vượt phần đã toả…) cụ thể hơn.
    kiem_tran_ghi(db, repo, cv, tot_f)
    khoan, ten_cong_doan = repo.khoan_cua_cong_viec(cv)
    o_khoan, cac_phat_sinh = chuan_hoa_khi_ghi(
        db, khoan=khoan, ten_cong_doan=ten_cong_doan, phat_sinh=phat_sinh,
        department_id=cv.department_id, tuy_chon=tuy_chon, mat_in=mat_in,
        # Bậc giá (Bài in) chọn từ quy cách in của lệnh — chỉ đọc khi công đoạn chia bậc.
        qc=quy_cach_cua_viec(db, cv) if khoan is not None and khoan.bac_gia else None,
    )
    nguoi = chot_nguoi(db, cv, nguoi_ids, ngay_cua_me(bat_dau))

    batch = SanXuatBatch(
        cong_viec_id=cv.id,
        bat_dau=bat_dau,
        ket_thuc=ket_thuc,
        tong=tong_f,
        tot=tot_f,
        hong=hong_f,
        don_vi=don_vi_batch,
        mo_ta_loi=(mo_ta_loi or "").strip() or None,
        ghi_chu=(ghi_chu or "").strip() or None,
        created_by=getattr(user, "id", None),
        **o_khoan,
    )
    repo.add(batch)
    repo.flush()  # cần batch.id để neo lot + việc phát sinh
    for lot in cac_lot:
        lot.batch_id = batch.id
        repo.add(lot)
    for ps in cac_phat_sinh:
        ps.batch_id = batch.id
        repo.add(ps)
    ghi_nguoi(db, batch.id, nguoi)

    from ...repositories.audit_repo import AuditLogRepository
    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None),
        action="san_xuat_tao_batch",
        target=f"san_xuat_batch:{batch.id}",
        detail=(f"cong_viec={cv.id} tot={tot_f} hong={hong_f} "
                f"khoan_cong_doan={o_khoan['khoan_cong_doan_id']} "
                f"phat_sinh={len(cac_phat_sinh)} nguoi={len(nguoi)}"),
    )
    ket_qua_lsx = _toa_san_luong(db, repo, cv=cv, batch=batch, tot=tot_f, actor=user)
    giao = None if ket_qua_lsx or not tu_giao else _tu_de_xuat_giao(db, repo, cv=cv, batch=batch, user=user)
    db.commit()
    ra = _ket_qua_batch(cv, batch, ket_qua_lsx)
    ra["ban_giao"] = None
    if giao is not None:
        from .ban_giao import ket_qua_cho_ben_nhan

        bg, dich_cv = giao
        ra["ban_giao"] = ket_qua_cho_ben_nhan(db, user=user, bg=bg, nguon_cv=cv, dich_cv=dich_cv)
    return ra


def _tu_de_xuat_giao(db: Session, repo: SanXuatSanLuongRepository, *, cv, batch: SanXuatBatch, user):
    """Ghi sản lượng xong thì TỰ đề xuất giao chính lần ghi đó sang chặng sau (22/10/2026, chủ xưởng:
    *"lúc nhấn ghi sản lượng thì nó tự tạo đề xuất giao sang công đoạn tiếp theo"*).

    Như bấm Đề xuất giao với đúng một mẻ: cùng tổ + cùng lệnh thì tự xác nhận, khác thì chờ bên nhận.
    Không tự giao khi: lần ghi không có số tốt, bước cuối lệnh (thành phẩm qua KCS), NHIỀU chặng sau
    (bước sau tách lần chạy / routing rẽ nhánh — tổ phải chọn, vẫn bấm tay), hoặc lệnh đã đóng (ghi
    mẻ còn được cho việc đang chạy, giao thì không). Số không vượt phần còn chưa giao — bàn giao cũ
    trước khi giao theo mẻ không gắn mẻ nào."""
    from .ban_giao import lap_ban_giao
    from .dong_lenh import nhom_da_dong

    if float(batch.tot) <= _EPS:
        return None
    chang_sau = repo.cong_viec_chang_sau(cv)
    if len(chang_sau) != 1 or nhom_da_dong(db, cv):
        return None
    sl = min(float(batch.tot), repo.tong_tot(cv.id) - repo.tong_da_giao(cv.id))
    if sl <= _EPS:
        return None
    dich_cv = chang_sau[0]
    bg = lap_ban_giao(db, user=user, nguon_cv=cv, dich_cv=dich_cv, so_luong=round(sl, 3),
                      don_vi=batch.don_vi, batch_ids=[batch.id])
    return bg, dich_cv


def sua_so_me(
    db: Session,
    *,
    user,
    batch_id: int,
    tot,
    ly_do: str | None = None,
    expected_version: int | None = None,
    nguoi_ids: list[int] | None = None,
    tuy_chon: dict[str, float] | None = None,
) -> dict:
    """Sửa SỐ LÀM ĐƯỢC của một mẻ đã ghi (10/10/2026) — thay "Điều chỉnh số" trên lần giao: chủ
    xưởng *"bỏ điều chỉnh số ở các lần giao, sửa số ở chỗ lần mẻ ấy"*.

    Quyền: Xác nhận sản lượng ở tổ của công đoạn (cùng quyền đề xuất bàn giao) — mẻ ghi bằng Thực
    hiện lệnh, sửa lại con số tổ đã chịu là việc của người xác nhận.

    - Tăng: không vượt trần ghi mẻ (số nhận trừ lỗi KCS), tính như mẻ khác đã ghi giữ nguyên.
    - Giảm: Σ mẻ không xuống dưới số KCS đã kiểm đạt ở bước; trần bước sau không tụt dưới số bước
      đó đã ghi mẻ (`dau_vao.kiem_giam_buoc_sau`).
    - Mẻ đã giao: số lần giao đổi theo phần chênh. Lần giao đã xác nhận mà khác tổ ⇒ xoá ai nhận,
      lúc nào — bên nhận xác nhận lại. Mẻ đã giao không sửa về 0 (lần giao còn gì mà nhận).
    - Mẻ điểm toả bài ghép đã chia số cho từng lệnh ⇒ không sửa.

    Lịch sử: audit `san_xuat_sua_batch` trên mẻ; mẻ đã giao thì thêm `san_xuat_ban_giao_theo_me`
    trên lần giao để bước nhận cũng thấy trong Lịch sử của nó.

    Cùng hộp đổi được NGƯỜI làm lần đó, kể cả người tổ khác (`nguoi_ids`, None = không đụng) —
    audit `san_xuat_sua_nguoi_batch`.

    Cũng đổi được TUỲ CHỌN KHI GHI (Đợt 2, `tuy_chon`, None = không đụng): chụp lại theo khai hiện
    tại của công đoạn; chỉ đổi tuỳ chọn cũng là một lần sửa, ghi vào audit `san_xuat_sua_batch`."""
    from ...repositories.audit_repo import AuditLogRepository
    from ...repositories.san_xuat_kcs_repo import SanXuatKcsRepository
    from ..quyen_to import VIEC_XAC_NHAN

    repo = SanXuatSanLuongRepository(db)
    batch = repo.batch(batch_id)
    if batch is None:
        raise ValueError("Không tìm thấy lần ghi sản lượng.")
    cv = repo.cong_viec(batch.cong_viec_id)
    if cv is None:
        raise ValueError("Không tìm thấy công việc của lần ghi sản lượng.")
    if cv.gia_cong_ngoai_id is not None:
        from ..gia_cong_ngoai import CHAN_XUONG

        raise ValueError(CHAN_XUONG)
    _gate(db, user, cv, VIEC_XAC_NHAN)
    from .dong_lenh import chan_neu_da_dong

    chan_neu_da_dong(db, cv)
    _kiem_version(batch, expected_version)

    moi = _so_khong_am(tot, "Số lượng làm được")
    cu = float(batch.tot)
    tc_moi = None
    if tuy_chon is not None:
        khoan, _ten = repo.khoan_cua_cong_viec(cv)
        tc_moi = anh_chup_tuy_chon(khoan, tuy_chon)
        if tc_moi == (batch.tuy_chon_khoan or None):
            tc_moi = None
    if abs(moi - cu) <= _EPS:
        if nguoi_ids is None and tc_moi is None:
            raise ValueError("Số mới trùng số đang ghi.")
        return _sua_nguoi_me(db, user, batch, cv, nguoi_ids, ly_do, tc_moi)
    if repo.co_ket_qua_nhanh(batch.id):
        raise ValueError("Lần ghi này đã chia số cho từng lệnh trong bài ghép — không sửa số được.")
    repo.khoa_cong_viec(cv.id)
    bg = repo.ban_giao_cua_me(batch.id)
    if bg is not None and moi <= _EPS:
        raise ValueError("Sản lượng lần này đã giao sang bước sau — không sửa về 0 được.")
    dv_ten = bang_dv_viec(db, cv)
    dv = nhan_don_vi(dv_ten, batch.don_vi) if batch.don_vi else ""

    truoc: dict = {}
    if moi > cu:
        kiem_tran_ghi(db, repo, cv, moi, bo_qua=cu)
    else:
        da_dat = sum(float(k.so_luong_dat or 0) for k in SanXuatKcsRepository(db).cac_kcs_batch(cv.id))
        con = repo.tong_tot(cv.id) - cu + moi
        if con < da_dat - _EPS:
            raise ValueError(
                f"KCS đã kiểm đạt {_so(da_dat)} {dv} ở bước này — tổng sản lượng không xuống dưới số "
                f"đó được (sửa thế thì còn {_so(con)})."
            )
        truoc = tran_buoc_sau(db, repo, cv)

    tc_cu = batch.tuy_chon_khoan
    batch.tot = moi
    batch.tong = moi + float(batch.hong or 0)
    if tc_moi is not None:
        batch.tuy_chon_khoan = tc_moi
        chup_lai_bac(db, batch, khoan, cv)
    batch.version += 1
    cho_nhan_lai = False
    dich_cv = None
    sl_bg_cu = None
    if bg is not None:
        dich_cv = repo.cong_viec(bg.dich_cong_viec_id) if bg.dich_cong_viec_id else None
        sl_bg_cu = float(bg.so_luong)
        bg.so_luong = round(max(0.0, sl_bg_cu + moi - cu), 3)
        bg.version += 1
        # Đã xác nhận ⇒ bên nhận xác nhận lại số mới; trừ cùng tổ và bước gia công ngoài (không tổ nào nhận).
        cho_nhan_lai = (bg.trang_thai == BG_XAC_NHAN and not bg.cung_to and dich_cv is not None
                        and dich_cv.gia_cong_ngoai_id is None)
        if cho_nhan_lai:
            bg.xac_nhan_by_id = None
            bg.xac_nhan_luc = None
    doi_nguoi = sua_nguoi(db, batch, cv, nguoi_ids) if nguoi_ids is not None else None
    repo.flush()
    if moi < cu:
        try:
            kiem_giam_buoc_sau(db, repo, cv, truoc)
        except ValueError:
            db.rollback()
            raise

    uid = getattr(user, "id", None)
    ly = (ly_do or "").strip()[:300]
    audit = AuditLogRepository(db)
    if doi_nguoi is not None:
        _audit_nguoi(audit, uid, batch, doi_nguoi, ly)
    audit.create(
        actor_user_id=uid, action="san_xuat_sua_batch", target=f"san_xuat_batch:{batch.id}",
        detail=(f"tot={cu:g}->{moi:g} ban_giao={bg.id if bg else '-'}"
                f"{' cho_nhan_lai' if cho_nhan_lai else ''}" + _doi_tuy_chon(tc_cu, tc_moi)
                + (f" | {ly}" if ly else "")),
        commit=False,
    )
    if bg is not None:
        audit.create(
            actor_user_id=uid, action="san_xuat_ban_giao_theo_me", target=f"san_xuat_ban_giao:{bg.id}",
            detail=(f"sl={sl_bg_cu:g}->{float(bg.so_luong):g} me={batch.id}"
                    f"{' cho_nhan_lai' if cho_nhan_lai else ''}" + (f" | {ly}" if ly else "")),
            commit=False,
        )
    db.commit()

    ra = _ket_qua_batch(cv, batch)
    ra["ban_giao"] = None
    if bg is not None:
        from .ban_giao import _ket_qua, _nguoi_nhan

        nguon_cv = cv
        # Bên nhận cần biết khi phải xác nhận lại, hoặc khi đề xuất đang chờ họ vừa đổi số.
        bao = cho_nhan_lai or (bg.trang_thai != BG_XAC_NHAN and dich_cv is not None
                               and dich_cv.gia_cong_ngoai_id is None)
        ra["ban_giao"] = _ket_qua(
            bg, nguon_cv, dich_cv,
            su_kien="sua_me" if cho_nhan_lai else "sua",
            notify_user_ids=_nguoi_nhan(db, user, dich_cv.department_id) if bao and dich_cv else [],
        )
    return ra


def _audit_nguoi(audit, uid, batch: SanXuatBatch, doi: tuple[list[str], list[str]], ly: str) -> None:
    bot, them = doi
    audit.create(
        actor_user_id=uid, action="san_xuat_sua_nguoi_batch", target=f"san_xuat_batch:{batch.id}",
        detail=(f"bot={'/'.join(bot)};them={'/'.join(them)}" + (f" | {ly}" if ly else "")),
        commit=False,
    )


def _doi_tuy_chon(cu: list | None, moi: list | None) -> str:
    """Đoạn audit " tuy_chon=trung_khuon:1->0" — chỉ các tuỳ chọn đổi giá trị."""
    if moi is None:
        return ""
    truoc = {t["ma"]: t["gia_tri"] for t in (cu or [])}
    doi = [f"{t['ma']}:{truoc.get(t['ma'], 0):g}->{t['gia_tri']:g}" for t in moi
           if truoc.get(t["ma"], 0) != t["gia_tri"]]
    return f" tuy_chon={'/'.join(doi)}" if doi else ""


def _sua_nguoi_me(db: Session, user, batch: SanXuatBatch, cv, nguoi_ids: list[int] | None,
                  ly_do: str | None, tc_moi: list | None = None) -> dict:
    """Nhánh của `sua_so_me` khi số giữ nguyên, chỉ đổi người làm và/hoặc tuỳ chọn khi ghi."""
    from ...repositories.audit_repo import AuditLogRepository

    doi = sua_nguoi(db, batch, cv, nguoi_ids) if nguoi_ids is not None else None
    if doi is None and tc_moi is None:
        raise ValueError("Số và người làm đều chưa đổi gì.")
    audit = AuditLogRepository(db)
    uid = getattr(user, "id", None)
    ly = (ly_do or "").strip()[:300]
    if doi is not None:
        _audit_nguoi(audit, uid, batch, doi, ly)
    if tc_moi is not None:
        f = float(batch.tot)
        audit.create(
            actor_user_id=uid, action="san_xuat_sua_batch", target=f"san_xuat_batch:{batch.id}",
            detail=f"tot={f:g}->{f:g}" + _doi_tuy_chon(batch.tuy_chon_khoan, tc_moi)
                   + (f" | {ly}" if ly else ""),
            commit=False,
        )
        batch.tuy_chon_khoan = tc_moi
        # Tuỳ chọn đổi (bỏ tick Mực UV) có thể đổi bậc giá ⇒ chụp lại bậc + giá của bậc mới.
        chup_lai_bac(db, batch, SanXuatSanLuongRepository(db).khoan_cua_cong_viec(cv)[0], cv)
    batch.version += 1
    db.commit()
    ra = _ket_qua_batch(cv, batch)
    ra["ban_giao"] = None
    return ra


def them_lot(
    db: Session,
    *,
    user,
    batch_id: int,
    nguon_batch_id: int | None = None,
    so_luong=0,
    don_vi: str | None = None,
) -> dict:
    """Bổ sung MỘT lot đầu vào cho batch đã tạo (§10.3) — khi tổ trưởng nhập truy vết sau."""
    repo = SanXuatSanLuongRepository(db)
    batch = repo.batch(batch_id)
    if batch is None:
        raise ValueError("Không tìm thấy batch.")
    cv = repo.cong_viec(batch.cong_viec_id)
    if cv is None:
        raise ValueError("Không tìm thấy công việc của batch.")
    _gate(db, user, cv)

    don_vi_lot_mac_dinh = (cv.don_vi_vao or batch.don_vi or "").strip()
    lot = _chuan_hoa_lot(
        repo,
        cv,
        don_vi_lot_mac_dinh,
        {
            "nguon_batch_id": nguon_batch_id,
            "so_luong": so_luong,
            "don_vi": don_vi,
        },
        DonViDoRepository(db).ten_theo_ma(),
    )
    lot.batch_id = batch.id
    repo.add(lot)
    db.commit()
    return _ket_qua_batch(cv, batch)
