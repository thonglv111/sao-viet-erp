"""Thực hiện sản xuất — PHÁT HÀNH CẬP NHẬT & THU HỒI GÓI khi lịch đổi sau phát hành (§4.3).

Bối cảnh: sau phát hành, người lập kế hoạch có thể sửa THỜI GIAN / NGUỒN LỰC (máy) của công việc
CHƯA BẮT ĐẦU ở bàn Xếp lịch. Thay đổi đó nằm ở lịch sống (`xep_lich_cong_doan`) — là "bản nháp";
chỉ có hiệu lực khi bấm **Phát hành cập nhật** ở đây, khi ấy snapshot của các việc chưa bắt đầu được
CHỤP LẠI theo lịch hiện tại và gói lên một phiên bản mới.

Luật §4.3 (chốt bởi chủ dự án):
  · Chỉ việc CHƯA bắt đầu mới được cập nhật. "Đã bắt đầu" = trạng thái ≠ `released` HOẶC đã có ≥1
    phiên chạy — hai tín hiệu này do `bat_dau` đặt cùng lúc, soi cả hai cho chắc.
  · Mỗi lần cập nhật: tăng `goi.version_hien_tai`, đẻ một `san_xuat_phien_ban(loai=cap_nhat)` kèm
    LÝ DO bắt buộc (giữ lịch sử phiên bản đủ) — KHÔNG xoá phiên bản cũ.
  · Việc chưa bắt đầu được tái chụp (máy + giờ dự kiến) theo lịch hiện tại, gắn `phien_ban_so` mới;
    MỌI phân công trước + thỏa thuận hỗ trợ của nó bị HUỶ ⇒ các tổ phải xác nhận lại.
  · Việc ĐÃ bắt đầu: giữ nguyên snapshot (không đổi lịch/tuyến/tỷ lệ ghép/dữ liệu) — không đụng tới.
  · Khi BẤT KỲ việc nào trong gói đã bắt đầu ⇒ KHÔNG được thu hồi toàn bộ gói (chỉ chặn thu-hồi,
    không chặn cập-nhật phần còn chưa bắt đầu).

TÁI CHỤP thời gian + máy (thứ bàn Xếp lịch đổi được sau phát hành) VÀ **hành lý đọc-để-làm** của
thẻ việc (10/09/2026): đơn vị bản địa · cờ + câu diễn giải sản lượng bước ngoài dòng · kíp chuẩn ·
dải phút chạy · dặn dò của kế hoạch · thẻ quy cách rút gọn. Xem
`docs/superpowers/specs/2026-09-10-ban-to-du-thong-tin-design.md` §8: lệnh phát hành TRƯỚC ngày có
mấy khoá ấy lấy đủ thông tin bằng đúng cửa này (migration cố ý không backfill).

**Tiêu chí KCS** (09/10/2026): cũng tái chụp theo danh mục Tiêu chí KCS hiện tại — khai thêm tiêu
chí cho công đoạn thì lệnh đang chạy nhận được qua cửa này, chỉ ở việc CHƯA bắt đầu. Trừ việc mà tiêu
chí đã có kết quả ở một lần kiểm (bước cuối xét gộp cả nhóm): kết quả khoá theo `thu_tu` của bản
chụp, chụp lại là kết quả cũ trỏ nhầm câu.

Vẫn KHÔNG đụng: số lượng vào/ra · khoán · định mức vật tư · con dao · tuyến. Đó là
CAM KẾT đã đóng băng (§4.2) — chúng chảy thẳng vào lương, kho và bàn giao, đọc-sống lại là xê dịch
việc thợ đang làm dở. Hành lý ở trên thì ngược lại: nó chỉ để ĐỌC, mà giữ bản cũ nghĩa là thợ đọc
một câu dặn dò đã bị kế hoạch sửa từ lâu.

Hàm ở đây CHỦ GIAO DỊCH cho nhánh cập-nhật (tự commit); còn `thu_hoi_goi` nằm TRONG giao dịch gỡ
phát hành của `xep_lich_van_de_service` nên KHÔNG commit. Router phát SSE sau khi service trả về.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ...models.san_xuat import (
    BUOC_MAY,
    BUOC_THUE_NGOAI,
    CV_PHAT_HANH,
    NHOM_DONG,
    GOI_DA_THU_HOI,
    GOI_DANG_PHAT_HANH,
    PB_CAP_NHAT,
    SanXuatCongViec,
    SanXuatCongViecLichSu,
    SanXuatGoiPhatHanh,
    SanXuatPhienBan,
)
from ...models.san_xuat_thuc_thi import PC_DA_RUT
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.san_xuat_kcs_repo import SanXuatKcsRepository
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.san_xuat_thuc_thi_repo import SanXuatThucThiRepository
from ..dong_giay import ban_do_tram
from ..gio_xuong import thuc_te_hien_thi
from .snapshot import _checklist, _dinh_muc, _hanh_ly, _SoPhatHanh

_LY_DO_RUT = "Phát hành cập nhật — phân công cần xác nhận lại."


# --- Trợ giúp ------------------------------------------------------------------------------
def _refs(repo: SanXuatRepository, nguon: str, id: int) -> tuple[set[int], set[int]]:
    """(lsx_ids, bai_ghep_ids) để tìm gói đang hiệu lực. Bài ghép kéo theo các LSX thành viên."""
    if nguon == "lsx":
        return {id}, set()
    if nguon == "in_ghep":
        return set(repo.lsx_ids_cua_bai_ghep({id})), {id}
    raise ValueError(f"Nguồn không hợp lệ: {nguon!r} (cần 'lsx' hoặc 'in_ghep').")


def _da_bat_dau_ids(
    thuc: SanXuatThucThiRepository, all_cv: list[SanXuatCongViec]
) -> set[int]:
    """Id các công việc ĐÃ bắt đầu: có phiên chạy HOẶC trạng thái đã rời `released`."""
    ids = {cv.id for cv in all_cv}
    da = thuc.cong_viec_co_phien(ids)
    da |= {cv.id for cv in all_cv if cv.trang_thai != CV_PHAT_HANH}
    return da


def _lich_nguon(repo: SanXuatRepository, cv: SanXuatCongViec) -> list[tuple]:
    """MỌI phân đoạn đang xếp của công đoạn nguồn, theo `phan_doan_so`.

    Mỗi phần tử `(may_id, start, finish, phan_doan_so, so_luong)` — xem `repo.lich_lsx_step`."""
    if cv.bai_ghep_cong_doan_id is not None:
        return repo.lich_bg_step(cv.bai_ghep_cong_doan_id)
    if cv.lsx_cong_doan_id is not None:
        dong = repo.lich_lsx_step(cv.lsx_cong_doan_id)
        if dong:
            return dong
        # Lệnh xếp ở bàn Xếp lịch: không dòng lịch nào, mốc bước là số dẫn xuất. Trả rỗng ở đây thì
        # "Phát hành cập nhật" coi mọi việc là "lịch đã tách/gộp" và bỏ qua sạch — người điều độ
        # dời giờ cả lệnh xong bấm cập nhật mà bàn tổ không đổi một phút nào.
        from ..xep_lich.moc import moc_theo_buoc

        moc = moc_theo_buoc(repo.db, [cv.lsx_id]) if cv.lsx_id else {}
        bd_kt = moc.get(cv.lsx_cong_doan_id)
        if bd_kt:
            return [(None, bd_kt[0], bd_kt[1], 1, None)]
    return []


def _thoi_gian_nguon(repo: SanXuatRepository, cv: SanXuatCongViec):
    """(may_id, start, finish) của ĐÚNG lần chạy mà công việc này đại diện — hoặc `None` khi lịch
    không còn phân đoạn đó.

    Một bước tách N lần chạy đẻ N công việc cùng `step_key` (mg `0254`); khớp bằng `phan_doan_so`.
    Bản trước gọi `thoi_gian_*_step` — hàm đó trả DÒNG ĐẦU TIÊN — nên phát hành cập nhật dập giờ
    và máy của lần 1 lên cả N việc: lần 2 mất ca của mình mà không ai báo.

    Trả `None` (thay vì đoán một dòng khác) khi số lần chạy đã đổi sau phát hành — tách thêm hoặc
    gộp lại. Việc đó giữ nguyên snapshot cũ và được ĐẾM RIÊNG để nói ra, vì lúc ấy tập công việc
    không còn ánh xạ 1-1 với lịch: muốn khớp lại phải thu hồi gói rồi phát hành lần đầu.
    """
    lich = _lich_nguon(repo, cv)
    if not lich:
        return (None, None, None)
    for may_id, start, finish, phan_doan_so, _sl in lich:
        if phan_doan_so == cv.phan_doan_so:
            return (may_id, start, finish)
    return None


def _cd_nguon(db: Session, cv: SanXuatCongViec):
    """Bước KẾ HOẠCH đứng sau công việc (`lsx_cong_doan` / `bai_ghep_cong_doan`) — None nếu mất.

    Snapshot ghim cả hai id nên không phải đọc lại nhãn tiếng Việt để dò ngược.
    """
    if cv.bai_ghep_cong_doan_id is not None:
        from ...models.bai_ghep_cong_doan import BaiGhepCongDoan

        return db.get(BaiGhepCongDoan, cv.bai_ghep_cong_doan_id)
    if cv.lsx_cong_doan_id is not None:
        from ...models.lsx import LsxCongDoan

        return db.get(LsxCongDoan, cv.lsx_cong_doan_id)
    return None


def _tai_chup_hanh_ly(db: Session, cv: SanXuatCongViec, so, tram: dict[str, str]) -> bool:
    """Chụp lại HÀNH LÝ đọc-để-làm của một công việc chưa bắt đầu. Trả True nếu có chụp được.

    Đi qua ĐÚNG `snapshot._hanh_ly` / `snapshot._dinh_muc` mà lần phát hành đầu dùng — chép tay
    một bản thứ hai ở đây là mở đường cho hai lần phát hành ra hai hình dữ liệu khác nhau.

    `ty_le` (phần sản lượng của phân đoạn) suy lại từ CHÍNH cặp số đã ghim: bước tách hai mẻ thì
    mỗi thẻ chỉ gánh phần phút chạy của mẻ mình. Số lượng không đụng tới nên tỷ lệ cũ vẫn đúng.
    """
    cd = _cd_nguon(db, cv)
    if cd is None:
        return False
    hanh_ly = _hanh_ly(so, cd, lsx_id=cv.lsx_id, bai_ghep_id=cv.bai_ghep_id, tram=tram)
    vao_buoc = float(cd.so_luong_vao or 0)
    ty_le = (float(cv.so_luong_vao or 0) / vao_buoc
             if vao_buoc > 0 and (cv.phan_doan_tong or 1) > 1 else 1.0)
    cv.don_vi_vao = hanh_ly["don_vi_vao"]
    cv.don_vi_ra = hanh_ly["don_vi_ra"]
    cv.dinh_muc_json = _dinh_muc(cd, hanh_ly, ty_le)
    cv.ghi_chu = hanh_ly["ghi_chu"]
    cv.quy_cach_json = hanh_ly["quy_cach_json"]
    return True


def _huy_phan_cong(thuc: SanXuatThucThiRepository, cv: SanXuatCongViec) -> int:
    """Huỷ phân công của một việc chưa bắt đầu. Trả số phân công đã huỷ. Việc chưa bắt đầu không có
    khoảng tham gia mở, nên chỉ cần rút dòng roster."""
    n_pc = 0
    for pc in thuc.phan_cong_hoat_dong(cv.id):
        pc.trang_thai = PC_DA_RUT
        pc.ly_do_rut = _LY_DO_RUT
        pc.version += 1
        n_pc += 1
    cv.version += 1
    return n_pc


# --- Đọc: thông tin gói (cho UI quyết nút Cập nhật / Thu hồi) --------------------------------
def thong_tin_goi(db: Session, *, nguon: str, id: int) -> dict:
    """Trạng thái gói phát hành của một LSX/bài ghép + lịch sử phiên bản + số việc đã/chưa bắt đầu.

    `co_goi=False` khi chưa phát hành (hoặc lệnh phát hành trước khi có lớp thực hiện). Chỉ đọc."""
    repo = SanXuatRepository(db)
    thuc = SanXuatThucThiRepository(db)
    lsx_ids, bg_ids = _refs(repo, nguon, id)
    goi = repo.goi_hien_tai_cua(lsx_ids, bg_ids)
    lich_su_goi = [_goi_lich_su(g) for g in repo.cac_goi_cua(lsx_ids, bg_ids)]
    if goi is None:
        return {"co_goi": False, "lich_su_goi": lich_su_goi}
    all_cv = repo.cong_viec_cua_goi(goi.id)
    so_da = len(_da_bat_dau_ids(thuc, all_cv))
    so_chua = len(all_cv) - so_da
    dang = goi.trang_thai == GOI_DANG_PHAT_HANH
    phien_bans = sorted(goi.phien_bans, key=lambda p: p.so)
    return {
        "co_goi": True,
        "goi_id": goi.id,
        "ma": goi.ma,
        "trang_thai": goi.trang_thai,
        "version_hien_tai": goi.version_hien_tai,
        "so_cong_viec": len(all_cv),
        "so_da_bat_dau": so_da,
        "so_chua_bat_dau": so_chua,
        "cho_phep_cap_nhat": dang and so_chua > 0,
        "cho_phep_thu_hoi": dang and so_da == 0,
        "phien_bans": [_phien_ban(p) for p in phien_bans],
        "lich_su_goi": lich_su_goi,
    }


def _phien_ban(p) -> dict:
    return {
        "so": p.so,
        "loai": p.loai,
        "ly_do": p.ly_do,
        "phat_hanh_by_id": p.phat_hanh_by_id,
        # `created_at` là UTC thật — đưa về giờ xưởng như mọi mốc thực thi khác.
        "luc": thuc_te_hien_thi(p.created_at).isoformat() if p.created_at else None,
    }


def _goi_lich_su(g) -> dict:
    """Một gói trong tab Lịch sử phát hành, kể cả gói đã thu hồi kèm lý do (lỗi #25, 18/10/2026)."""
    return {
        "goi_id": g.id,
        "ma": g.ma,
        "trang_thai": g.trang_thai,
        "thu_hoi_ly_do": g.thu_hoi_ly_do,
        "thu_hoi_luc": thuc_te_hien_thi(g.thu_hoi_at).isoformat() if g.thu_hoi_at else None,
        "phien_bans": [_phien_ban(p) for p in sorted(g.phien_bans, key=lambda p: p.so)],
    }


# --- Tiêu chí KCS của lệnh đang chạy: soi cũ → mới, rồi cập nhật riêng ----------------------
def _soi_tieu_chi(db: Session, lsx_id: int) -> list[tuple]:
    """`[(công việc, bản chụp mới)]` của lệnh mà bộ tiêu chí đang giữ khác danh mục hiện tại.

    Khác "Phát hành cập nhật": soi CẢ việc đã bắt đầu. Tiêu chí không phải cam kết với tổ (không
    vào lương, kho, bàn giao) — nó chỉ là thứ bước KCS cuối xét, nên việc đang chạy vẫn lấy bộ mới
    được. Hai chỗ KHÔNG đụng: việc mà tiêu chí đã có KẾT QUẢ ở một lần kiểm (kết quả khoá theo
    `thu_tu` của bản chụp, chụp lại là kết quả cũ trỏ nhầm câu), và nhóm đã đóng."""
    repo = SanXuatRepository(db)
    goi = repo.goi_hien_tai_cua({lsx_id}, set())
    if goi is None or goi.trang_thai != GOI_DANG_PHAT_HANH:
        return []
    cvs = [cv for cv in repo.cong_viec_cua_goi(goi.id) if cv.lsx_id == lsx_id]
    if not cvs:
        return []
    kcs = SanXuatKcsRepository(db)
    dong = set()
    for n in {cv.nhom_id for cv in cvs}:
        nh = kcs.nhom(n)
        if nh is not None and nh.trang_thai == NHOM_DONG:
            dong.add(n)
    cd_cua = {cv.id: _cd_nguon(db, cv) for cv in cvs}
    tieu_chi_theo_cd = repo.checklist_theo_cong_doan(
        {cd.cong_doan_id for cd in cd_cua.values() if cd is not None and cd.cong_doan_id})
    da_xet = kcs.cong_viec_da_xet_tieu_chi({cv.nhom_id for cv in cvs})
    ra: list[tuple] = []
    for cv in sorted(cvs, key=lambda c: c.id):
        cd = cd_cua[cv.id]
        if cd is None or cv.id in da_xet or cv.nhom_id in dong:
            continue
        moi = _checklist(cd, tieu_chi_theo_cd)
        if _ten_tc(cv.kcs_tieu_chi_json) != _ten_tc(moi):
            ra.append((cv, moi))
    return ra


def _ten_tc(ds) -> list[str]:
    return [x.get("ten") or "" for x in (ds or []) if isinstance(x, dict)]


def tieu_chi_kcs_lech(db: Session, lsx_id: int) -> list[dict]:
    """Bảng cũ → mới cho băng "Tiêu chí KCS đã đổi" ở hồ sơ lệnh. Rỗng khi khớp hết. Chỉ đọc.

    Mỗi phần tử `{cong_viec_id, ten, cu: [câu], moi: [câu], them, bo, doi_thu_tu, da_bat_dau}` —
    so theo CÂU CHỮ, vì người lập kế hoạch đọc câu chứ không đọc id."""
    soi = _soi_tieu_chi(db, lsx_id)
    if not soi:
        return []
    da_bat_dau = _da_bat_dau_ids(SanXuatThucThiRepository(db), [cv for cv, _ in soi])
    ra: list[dict] = []
    for cv, moi_json in soi:
        cu, moi = _ten_tc(cv.kcs_tieu_chi_json), _ten_tc(moi_json)
        ra.append({
            "cong_viec_id": cv.id,
            "ten": cv.ten_cong_doan,
            "cu": cu,
            "moi": moi,
            "them": [x for x in moi if x not in cu],
            "bo": [x for x in cu if x not in moi],
            "doi_thu_tu": sorted(cu) == sorted(moi),
            "da_bat_dau": cv.id in da_bat_dau,
        })
    return ra


def cap_nhat_tieu_chi_kcs(db: Session, *, lsx_id: int, actor) -> int:
    """Nút "Cập nhật tiêu chí" của băng: chụp lại tiêu chí KCS theo danh mục cho đúng các việc băng
    liệt kê (cùng `_soi_tieu_chi`). KHÔNG đụng lịch, phân công, phiên bản gói — tổ không phải xác
    nhận lại gì. Tự commit. Trả số công việc đã cập nhật."""
    soi = _soi_tieu_chi(db, lsx_id)
    if not soi:
        raise ValueError("Tiêu chí KCS của lệnh đã khớp danh mục, không có gì để cập nhật.")
    for cv, moi in soi:
        cv.kcs_tieu_chi_json = moi
    AuditLogRepository(db).create(
        actor_user_id=getattr(actor, "id", None),
        action="san_xuat.cap_nhat_tieu_chi_kcs",
        target=f"lsx:{lsx_id}",
        detail="Cập nhật tiêu chí KCS theo danh mục: " + "; ".join(cv.ten_cong_doan for cv, _ in soi),
    )
    SanXuatRepository(db).commit()
    return len(soi)


# --- Ghi: phát hành cập nhật (chủ giao dịch) ------------------------------------------------
def phat_hanh_cap_nhat(db: Session, *, nguon: str, id: int, ly_do: str, actor) -> dict:
    """Tái chụp các việc CHƯA bắt đầu theo lịch hiện tại → phiên bản mới (§4.3). Tự commit.

    Chặn nếu chưa có gói / gói đã thu hồi / không còn việc nào chưa bắt đầu. Việc đã bắt đầu giữ
    nguyên; các việc cập nhật bị huỷ phân công + hỗ trợ (buộc tổ xác nhận lại).

    "Tái chụp" gồm máy + giờ VÀ hành lý đọc-để-làm (đơn vị · kíp · phút chạy · dặn dò · quy cách) —
    xem docstring module để biết cái gì cố ý KHÔNG chụp lại."""
    ly_do = (ly_do or "").strip()
    if len(ly_do) < 3:
        raise ValueError("Phát hành cập nhật phải ghi lý do (tối thiểu 3 ký tự).")
    repo = SanXuatRepository(db)
    thuc = SanXuatThucThiRepository(db)
    lsx_ids, bg_ids = _refs(repo, nguon, id)
    goi = repo.goi_hien_tai_cua(lsx_ids, bg_ids)
    if goi is None:
        raise ValueError("Chưa phát hành — không có gói để cập nhật.")
    if goi.trang_thai != GOI_DANG_PHAT_HANH:
        raise ValueError("Gói đã thu hồi — không thể cập nhật.")

    all_cv = repo.cong_viec_cua_goi(goi.id)
    da_bat_dau = _da_bat_dau_ids(thuc, all_cv)
    chua = [cv for cv in all_cv if cv.id not in da_bat_dau]
    if not chua:
        raise ValueError("Mọi công việc trong gói đã bắt đầu — không còn gì để cập nhật.")

    actor_uid = getattr(actor, "id", None)
    new_ver = goi.version_hien_tai + 1
    repo.add(SanXuatPhienBan(
        goi_id=goi.id, so=new_ver, loai=PB_CAP_NHAT, ly_do=ly_do[:500],
        phat_hanh_by_id=actor_uid,
    ))
    goi.version_hien_tai = new_ver
    goi.version += 1

    so_huy_pc = 0
    so_lech_phan_doan = 0
    # Hộp số dẫn xuất dùng CHUNG cho cả vòng: nó cache quy cách theo lệnh / theo bài, dựng mới mỗi
    # việc là chạy lại `quy_cach_bien` (bài ghép còn phải `tinh_so_to`) cho từng thẻ.
    so = _SoPhatHanh(db)
    tram = ban_do_tram(db)
    # Tiêu chí KCS: tra danh mục MỘT lần cho cả vòng; bỏ qua việc đã có kết quả xét tiêu chí.
    cd_cua = {cv.id: _cd_nguon(db, cv) for cv in chua}
    tieu_chi_theo_cd = repo.checklist_theo_cong_doan(
        {cd.cong_doan_id for cd in cd_cua.values() if cd is not None and cd.cong_doan_id})
    da_xet = SanXuatKcsRepository(db).cong_viec_da_xet_tieu_chi({cv.nhom_id for cv in chua})
    for cv in chua:
        moc = _thoi_gian_nguon(repo, cv)
        if moc is None:                 # lịch đã tách thêm/gộp lại — không còn lần chạy này
            so_lech_phan_doan += 1
            continue
        may_id, start, finish = moc
        _tai_chup_hanh_ly(db, cv, so, tram)
        if cd_cua[cv.id] is not None and cv.id not in da_xet:
            cv.kcs_tieu_chi_json = _checklist(cd_cua[cv.id], tieu_chi_theo_cd)
        # CHỤP BẢN CŨ TRƯỚC KHI ĐÈ. Ba dòng dưới sửa đè tại chỗ (cố ý — `cv.id` bị phụ thuộc,
        # phân công, hỗ trợ, batch, bàn giao, KCS trỏ tới), nên không chụp ở đây là bản cũ biến
        # mất vĩnh viễn và không ai trả lời được "v3 hứa bước này chạy lúc mấy giờ".
        db.add(SanXuatCongViecLichSu(
            goi_id=goi.id, phien_ban_so=cv.phien_ban_so, cong_viec_id=cv.id,
            may_id=cv.may_id, du_kien_bat_dau=cv.du_kien_bat_dau,
            du_kien_ket_thuc=cv.du_kien_ket_thuc,
        ))
        # Việc GIA CÔNG NGOÀI không vào bàn tổ nào, không máy — giữ `may_id=None`, đừng gán đè.
        if may_id is not None and cv.gia_cong_ngoai_id is None:
            cv.may_id = may_id
        # TỔ + MÁY của BƯỚC KẾ HOẠCH (spec máy thuộc tổ §4.8): lệnh xếp ở bàn cấp lệnh không có dòng
        # lịch theo công đoạn nên `may_id` ở trên luôn None, còn tổ thì trước đây không dòng nào
        # chép — người kế hoạch đổi bước sang tổ khác, bấm cập nhật mà bàn tổ y nguyên. Dòng lịch
        # có máy (bàn xếp theo công đoạn cũ) vẫn thắng máy của bước. Việc đổi tổ rời bàn cũ sang
        # bàn mới; `lsx_changed` của router nhích mọi bàn tổ nên cả hai bàn tự nạp.
        buoc = cd_cua[cv.id]
        # Bước loại Tổ cũng đổi tổ (như lần phát hành đầu ở `snapshot`); máy chỉ cho bước Máy.
        if buoc is not None and cv.gia_cong_ngoai_id is None and cv.loai_buoc != BUOC_THUE_NGOAI:
            if buoc.department_id is not None:
                cv.department_id = buoc.department_id
            if may_id is None and cv.loai_buoc == BUOC_MAY:
                cv.may_id = buoc.may_id
        cv.du_kien_bat_dau = start
        cv.du_kien_ket_thuc = finish
        cv.phien_ban_so = new_ver
        so_huy_pc += _huy_phan_cong(thuc, cv)
    so_cap_nhat = len(chua) - so_lech_phan_doan

    # GIA CÔNG NGOÀI (spec 2026-09-26, Fix round 1): "Phát hành cập nhật" cũng tạo/giữ lần gia
    # công — routing có thể đổi nhà gia công / thêm-bớt bước thuê ngoài sau lần phát hành đầu.
    # Lần đã mang đi / đã chốt được hàm này TỰ giữ nguyên, không cần lọc trước ở đây.
    from ..gia_cong_ngoai.lan import dong_bo_lan_bai_ghep_khi_cap_nhat, dong_bo_lan_khi_cap_nhat

    dong_bo_lan_khi_cap_nhat(db, lsx_ids=lsx_ids, actor=actor)
    # Lần của bước CHUNG bài ghép (spec 2026-09-27) — cùng luật, nguồn là bài.
    dong_bo_lan_bai_ghep_khi_cap_nhat(db, bai_ghep_ids=bg_ids, actor=actor)
    # Giờ cần của yêu cầu vật tư tự lập đi theo lịch mới (tổ đã sửa thì giữ) — trước audit, vì
    # audit tự commit.
    from .vat_tu_tu_lap import doi_can_luc_theo_lich

    yeu_cau_doi_gio = doi_can_luc_theo_lich(db, goi_id=goi.id)

    AuditLogRepository(db).create(
        actor_user_id=actor_uid,
        action="san_xuat.phat_hanh_cap_nhat",
        target=f"san_xuat_goi:{goi.id}",
        detail=(f"Cập nhật lịch → phiên bản {new_ver}: tái chụp {so_cap_nhat} việc chưa bắt đầu, "
                f"giữ nguyên {len(da_bat_dau)} việc đã bắt đầu; huỷ {so_huy_pc} phân công"
                + (f"; {so_lech_phan_doan} việc lệch lần chạy (lịch đã tách/gộp lại) giữ nguyên"
                   if so_lech_phan_doan else "")
                + f". Lý do: {ly_do[:200]}"),
    )
    repo.commit()
    return {
        "goi_id": goi.id,
        "ma": goi.ma,
        "version_hien_tai": new_ver,
        "so_cong_viec_cap_nhat": so_cap_nhat,
        "so_giu_nguyen": len(da_bat_dau),
        "so_huy_phan_cong": so_huy_pc,
        # >0 ⇒ số lần chạy đã đổi sau phát hành; những việc đó KHÔNG được cập nhật, UI phải nói ra.
        "so_lech_phan_doan": so_lech_phan_doan,
        "yeu_cau_doi_gio": yeu_cau_doi_gio,
    }


# --- Thu hồi gói (nằm trong giao dịch gỡ-phát-hành — KHÔNG commit) ---------------------------
def co_cong_viec_da_bat_dau(db: Session, *, nguon: str, id: int) -> bool:
    """Gói đang hiệu lực của LSX/bài ghép có việc nào đã bắt đầu? (Chặn thu hồi toàn gói — §4.3.)"""
    repo = SanXuatRepository(db)
    thuc = SanXuatThucThiRepository(db)
    lsx_ids, bg_ids = _refs(repo, nguon, id)
    goi = repo.goi_hien_tai_cua(lsx_ids, bg_ids)
    if goi is None:
        return False
    if _da_bat_dau_ids(thuc, repo.cong_viec_cua_goi(goi.id)):
        return True
    # Hàng đã mang ra nhà gia công (hoặc đã chốt) = việc ĐÃ chạy, dù công việc gia công không có
    # phiên bắt đầu nào — thu hồi lúc này là xoá dấu vết hàng đang nằm ngoài xưởng.
    from ...repositories.gia_cong_ngoai_repo import GiaCongNgoaiRepository

    return GiaCongNgoaiRepository(db).co_lan_da_di_trong_goi(goi.id)


def thu_hoi_goi(db: Session, *, nguon: str, id: int, actor, ly_do: str | None = None) -> int:
    """Thu hồi gói phát hành khi CHƯA việc nào bắt đầu: đánh `da_thu_hoi` (biến khỏi bàn tổ) + huỷ
    phân công/hỗ trợ còn treo. KHÔNG commit — nằm trong giao dịch gỡ-phát-hành của caller. Trả số
    công việc trong gói (0 nếu không có gói). Người gọi phải chặn trước bằng `co_cong_viec_da_bat_dau`."""
    repo = SanXuatRepository(db)
    thuc = SanXuatThucThiRepository(db)
    lsx_ids, bg_ids = _refs(repo, nguon, id)
    goi = repo.goi_hien_tai_cua(lsx_ids, bg_ids)
    if goi is None:
        return 0
    all_cv = repo.cong_viec_cua_goi(goi.id)
    actor_uid = getattr(actor, "id", None)
    for cv in all_cv:
        _huy_phan_cong(thuc, cv)
    from ..gia_cong_ngoai.lan import huy_lan_cua_goi

    huy_lan_cua_goi(db, goi_id=goi.id, actor=actor, ly_do=f"Thu hồi gói phát hành {goi.ma}")
    # Yêu cầu xuất vật tư kho chưa xuất thì huỷ (spec 2026-10-18 §4.5); id đi lên tầng gọi qua
    # `db.info` để báo kho sau commit.
    from .vat_tu_tu_lap import KHOA_YC_HUY, huy_khi_thu_hoi

    db.info.setdefault(KHOA_YC_HUY, []).extend(huy_khi_thu_hoi(db, goi_id=goi.id, actor_id=actor_uid))
    goi.trang_thai = GOI_DA_THU_HOI
    goi.thu_hoi_ly_do = (ly_do or "").strip()[:500] or None
    goi.thu_hoi_at = datetime.now(timezone.utc)
    goi.thu_hoi_by_id = actor_uid
    goi.version += 1
    AuditLogRepository(db).create(
        actor_user_id=actor_uid,
        action="san_xuat.thu_hoi_goi",
        target=f"san_xuat_goi:{goi.id}",
        detail=f"Thu hồi gói phát hành {goi.ma} ({len(all_cv)} công việc) — gỡ phát hành khi chưa việc nào bắt đầu.",
        commit=False,
    )
    repo.flush()
    return len(all_cv)
