"""Bàn THỰC HIỆN tại tổ — mặt đọc (§11, §18 `/api/san-xuat/teams` + `/work-items`).

Đây là nền của Giai đoạn 2: mỗi node LÁ trong Khối Sản xuất là một tổ; tổ trưởng mở bàn của tổ
mình thấy các công việc ĐÃ PHÁT HÀNH (đọc từ snapshot gói, không đọc-sống routing). Lát này CHỈ
ĐỌC — phân công / phiên chạy / sản lượng là các lát sau (thêm bảng riêng).

Phạm vi tổ theo DÒNG QUYỀN THEO TỔ (mg 0302, `services/quyen_to.py`): mỗi nút khối Sản xuất một
dòng Xem · Phạm vi · 4 quyền chi tiết; bàn cấp gom gộp các tổ trực thuộc.
"""
from __future__ import annotations

import math
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.department import Department
from ...models.may_thiet_bi import MayThietBi
from ...models.san_xuat import CV_HOAN_THANH, CV_TAM_DUNG
from ...models.san_xuat_thuc_thi import PHIEN_TAM_DUNG
from ...models.user import User
from ...repositories.attendance_repo import AttendanceRepository
from ...repositories.don_vi_do_repo import DonViDoRepository, nhan_don_vi
from ...repositories.rbac_repo import DepartmentRepository
from ...repositories.san_xuat_kcs_repo import SanXuatKcsRepository
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from ...repositories.san_xuat_thuc_thi_repo import SanXuatThucThiRepository
from ...repositories.san_xuat_vat_tu_repo import SanXuatVatTuRepository
from ...repositories.stock_request_repo import StockRequestRepository
from ...services.rbac_service import AuthorizationService
from ..quyen_to import (
    MUC_CUA_TOI,
    MUC_TAT_CA,
    VIEC_CHI_TIET,
    VIEC_THUC_HIEN,
    VIEC_XAC_NHAN,
    VIEC_XEM,
    QuyenTo,
    quyen_to_cua,
    quyen_tren_viec,
)
from ..gio_xuong import lich_hien_thi, thuc_te_hien_thi, ve_utc_that
from ..kho_giay import DON_VI_TO_KHO, co_don_vi_goc, khoa_dong, nhan_kho
from ..may_trang_thai import bao_hong_dang_mo
from . import dau_vao, loc_ban_to, routing_dai, viec_khoan
from .nguoi_ghi import ung_vien_ghi
from .nguoi_trong_me import nguoi_theo_me
from .thuc_thi import _aware
from .tinh_trang_nguoi import hom_nay, tinh_trang_nhieu
from .vat_tu_de_nghi import _hang_service, _kh_service, can_luc_hien_thi, lan_con_mo

MODULE = "san_xuat"


def _pham_vi_doc(db: Session, user: User, team_id: int | None) -> tuple[QuyenTo, str]:
    """(quyền tổ của user, mức XEM trên `team_id`) — chặn nếu tổ nằm ngoài phạm vi xem."""
    q = quyen_to_cua(db, user)
    muc = q.muc(VIEC_XEM, team_id)
    if muc is None:
        raise PermissionError("Ngoài phạm vi tổ được phép xem.")
    return q, muc


def _nhan_vien_id(db: Session, user: User) -> int | None:
    """Hồ sơ nhân viên nối với tài khoản. Chưa nối thì phần "Của tôi" rỗng — không rơi về "thấy hết"."""
    nv = SanXuatThucThiRepository(db).nhan_vien_theo_user(user.id)
    return nv.id if nv is not None else None


def _loc_viec_cua_tho(db: Session, user: User, rows: list) -> list:
    """Giữ lại đúng những việc user đang được giao. Tài khoản chưa nối hồ sơ nhân viên
    (`employee.user_id`) thì không có việc nào — không rơi về "thấy hết"."""
    tt = SanXuatThucThiRepository(db)
    nv = tt.nhan_vien_theo_user(user.id)
    if nv is None:
        return []
    cho_phep = tt.cong_viec_ids_duoc_giao(nv.id, {cv.id for cv in rows})
    return [cv for cv in rows if cv.id in cho_phep]


def teams(db: Session, user: User, authz: AuthorizationService) -> list[dict]:
    """Menu Bàn tổ = các nút khối Sản xuất user XEM được, theo thứ tự cây + cấp thụt lề (mg 0302).

    Bàn của một nút cấp gom phủ cả VÙNG của nó (nút + mọi đơn vị trực thuộc), nên badge của nút là
    tổng badge các tổ trong vùng — mỗi tổ đếm đúng phạm vi user: thấy trọn thì đếm cả tổ, chỉ
    "Của tôi" thì đếm việc đang giao cho mình (navbar báo đúng số dòng mở ra thấy).

    KCS không còn nằm trên menu Bàn tổ (KCS theo lệnh, mg 0306) — người KCS vào màn KCS riêng."""
    q = quyen_to_cua(db, user)
    ban = q.ban_thay_duoc()
    if not ban:
        return []
    repo = SanXuatRepository(db)
    tron, rieng = q.tron[VIEC_XEM], q.rieng[VIEC_XEM]
    nv_id = _nhan_vien_id(db, user) if rieng else None
    badge = repo.dem_cho_lam_theo_to(tron, employee_id=nv_id, rieng_ids=rieng)
    ids = {did for did, _, _ in ban}
    dept_map = {d.id: d for d in DepartmentRepository(db).list_all() if d.id in ids}
    bang = q.bang()
    cho_xn = _to_cho_xac_nhan(db, q.tron[VIEC_XAC_NHAN])
    ra = []
    for did, cap, muc in ban:
        d = dept_map.get(did)
        vung = q.cay.vung(did)
        ra.append({
            "id": did,
            "ten": d.name if d else q.cay.ten.get(did, ""),
            "ma": (d.code if d else None) or "",
            "cap": cap,
            # "Tôi vào bàn này chỉ với phần CỦA TÔI" — tính sẵn, đừng để FE tự suy từ phạm vi.
            "la_tho": muc == MUC_CUA_TOI,
            "so_viec_cho": sum(badge.get(x, 0) for x in vung),
            "so_cho_xac_nhan": sum(1 for cac_to in cho_xn if cac_to & vung),
            # Mức từng việc trên CHÍNH nút này — thao tác cấp tổ (xác nhận vật tư, đóng thiếu nhóm)
            # đòi `all`; nút trên từng công việc đọc `quyen` của drawer.
            "quyen": bang.get(did, {}),
        })
    return ra


def _num(x) -> float | None:
    return None if x is None else float(x)


def _may_thiet_bi_nhan(db: Session, may_ids: set[int]) -> dict[int, str]:
    """{may_id: tên máy} tra ĐÚNG danh mục `may_thiet_bi` — KHÁC bảng `machines` cũ mà
    `SanXuatRepository.may_nhan` dùng (đó là danh mục máy của Tính giá). `san_xuat_cong_viec.may_id`
    / `san_xuat_phien_chay.may_id` đều neo theo `MayThietBi.id` (xem `snapshot.py`), nên đọc TÊN máy cho phiên chạy phải tra đúng bảng này chứ không phải bảng cũ."""
    if not may_ids:
        return {}
    rows = db.execute(
        select(MayThietBi.id, MayThietBi.ten).where(MayThietBi.id.in_(may_ids))
    ).all()
    return {mid: ten for mid, ten in rows}


def _con_thieu(
    cv, tong_tot: float, thuc_nhan: float | None = None
) -> tuple[float | None, float | None]:
    """(mục tiêu, còn thiếu) của MỘT bước — dẫn xuất, KHÔNG lưu cột (spec-thuc-te-vs-ke-hoach §2.3).

    Mốc chấm là `so_luong_ra` (snapshot lúc phát hành, đã đúng `don_vi_ra`), so thẳng với
    `tong_tot` không cần quy đổi. NHƯNG khi tổ trước giao thiếu, chấm tổ này theo kế hoạch là đổ
    oan: hụt đó là của tổ trước. Nhận được bao nhiêu thì mốc rút theo bấy nhiêu — quy theo TỈ LỆ
    vì đầu vào và đầu ra khác đơn vị (nhận "tờ", ra "cái"): kế hoạch 12 tờ → 1.188 cái, thực nhận
    11 tờ ⇒ mốc còn 1.188 × 11 / 12 = 1.089 cái.

    Kế hoạch KHÔNG bị đè — `cv.so_luong_ra` vẫn nguyên, FE hiện cả hai số cạnh nhau.

    Mốc chỉ RÚT XUỐNG, không bao giờ đẩy lên: nhà in cố ý giao dư để bù hao (1.050 tờ cho 1.000
    cái), nhận dư không có nghĩa tổ phải làm nhiều hơn cam kết. Bỏ cái kẹp này là mốc phình theo
    lượng bù hao và tổ nào cũng "còn thiếu".

    Không nhận từ ai (`thuc_nhan is None` — bước ĐẦU chuỗi lấy vật tư từ kho) hoặc bước không khai
    `so_luong_vao` ⇒ giữ nguyên mốc kế hoạch. Bước không khai mục tiêu ⇒ trả None, đừng bịa 0:
    "còn thiếu 0" và "không biết thiếu bao nhiêu" là hai câu khác hẳn nhau.

    Chạy DƯ thì kẹp về 0 — số âm ở ô "còn thiếu" chỉ làm người đọc dừng lại đoán nghĩa.

    Có `he_so_quy_doi` (Bế 2 con/tờ) thì quy theo hệ số đó, CÙNG luật trần ghi mẻ
    (`dau_vao.tran_ghi`). Tỉ lệ ra/vào của kế hoạch gồm cả tờ bù hao (3.000 con / 1.580 tờ ≈ 1,9)
    nên nhận 1.200 tờ ra mốc 2.278,48 con — vừa lẻ, vừa lệch trần 2.400 ngay trong hộp Ghi mẻ.
    Chỉ bước không có hệ số mới dùng tỉ lệ. Mốc đã rút thì làm tròn XUỐNG: không có nửa con.
    """
    if cv.so_luong_ra is None:
        return None, None
    muc_tieu = float(cv.so_luong_ra)
    vao = None if cv.so_luong_vao is None else float(cv.so_luong_vao)
    he_so = float(cv.he_so_quy_doi or 0)
    if thuc_nhan is not None:
        if he_so > 0:
            theo_nhan = float(thuc_nhan) * he_so
        elif vao is not None and vao > 0:
            theo_nhan = muc_tieu * float(thuc_nhan) / vao
        else:
            theo_nhan = None
        if theo_nhan is not None and theo_nhan < muc_tieu:
            muc_tieu = float(math.floor(theo_nhan + 1e-6))
    return muc_tieu, max(muc_tieu - float(tong_tot), 0.0)


def _thuc_nhan(cv, nhan_map: dict[int, dict[str, float]]) -> float | None:
    """Lượng bước này nhận được, tính THEO ĐÚNG đơn vị đầu vào của nó.

    Bàn giao ghi đơn vị riêng; lấy nhầm đơn vị rồi đem chia cho `so_luong_vao` là ra con số bịa
    (nhận 26.888 "con" chia cho 68 "tờ"). Bước không khai `don_vi_vao`, hoặc không có bàn giao nào
    đúng đơn vị đó ⇒ None = coi như không rút mốc, giữ kế hoạch."""
    theo_dv = nhan_map.get(cv.id)
    if not theo_dv or not cv.don_vi_vao:
        return None
    return theo_dv.get(cv.don_vi_vao)


def _nhan_vao(db: Session, sl: SanXuatSanLuongRepository, cv, thuc_nhan: float | None) -> float | None:
    """Lượng bước này ĐÃ NHẬN, đơn vị VÀO — vế trái của luật "nhận − tốt = lỗi" (27/09/2026).

    Có bàn giao chốt về ⇒ số đó. Không có ⇒ hỏi cùng nguồn với trần ghi mẻ (`dau_vao.tran_ghi`:
    cùng tổ cùng lệnh thì số tốt bước trước, khác tổ thì bàn giao, chưa giao = 0). Bước ĐẦU chuỗi
    (không có bước trước) lấy vật tư từ kho ⇒ số vào kế hoạch. Còn lại không biết ⇒ None."""
    if thuc_nhan is not None:
        return thuc_nhan
    t = dau_vao.tran_nhan(db, cv, repo=sl)
    if t is not None:
        return float(t["da_nhan"])
    if cv.so_luong_vao is not None and not dau_vao.nhom_truoc(sl, cv):
        return float(cv.so_luong_vao)
    return None


def _nhan_loi(db: Session, sl: SanXuatSanLuongRepository, cv, thuc_nhan, tot: float) -> dict:
    """{nhan, nhan_ra, loi}. Tổ chỉ ghi số TỐT; bấm Kết thúc thì phần còn lại tự thành LỖI."""
    nhan = _nhan_vao(db, sl, cv, thuc_nhan)
    nhan_ra = dau_vao.quy_ra(cv, nhan)
    loi = None
    if cv.trang_thai == CV_HOAN_THANH and nhan_ra is not None:
        loi = max(nhan_ra - float(tot), 0.0)
    return {"nhan": nhan, "nhan_ra": nhan_ra, "loi": loi}


def _so_lieu_map(
    db: Session, sl: SanXuatSanLuongRepository,
    rows, tot_map: dict[int, float], nhan_map: dict[int, dict[str, float]]
) -> dict[int, dict]:
    """{cong_viec_id: số thực tế + còn thiếu + nhận/lỗi} cho cả bàn tổ — tổng tốt và bàn giao nạp
    GỘP một lần; chỉ dòng chưa có bàn giao mới hỏi thêm nguồn trước."""
    ket = {}
    for cv in rows:
        tot = tot_map.get(cv.id, 0.0)
        nhan = _thuc_nhan(cv, nhan_map)
        muc_tieu, thieu = _con_thieu(cv, tot, nhan)
        ket[cv.id] = {
            "thuc_nhan": nhan, "da_lam": tot, "muc_tieu": muc_tieu, "con_thieu": thieu,
            **_nhan_loi(db, sl, cv, nhan, tot),
        }
    return ket


def _dm(cv, khoa: str):
    """Một khoá của `dinh_muc_json` — ảnh chụp CŨ thiếu khoá thêm sau thì trả None, không nổ.

    Không ép kiểu và không lấp 0: khoá vắng nghĩa là "lệnh phát hành trước ngày có khoá này", mà
    0 phút chạy / kíp 0 người là câu khác hẳn và FE sẽ bày ra như số thật.
    """
    return cv.dinh_muc_json.get(khoa) if isinstance(cv.dinh_muc_json, dict) else None


def _item_dict(cv, lsx_map, bg_map, may_map, nhom_map, phien_map=None, so_map=None,
               chay_ids: set[int] | None = None, kcs_map=None, khach_map=None) -> dict:
    """Một dòng công việc trên timeline — nhãn nguồn/nhóm/máy đã resolve theo lô (§18)."""
    if cv.bai_ghep_id and cv.bai_ghep_id in bg_map:
        nguon_ma, nguon_ten = bg_map[cv.bai_ghep_id]
        nguon_loai = "bai_ghep"
        khach = (khach_map or {}).get(("bai_ghep", cv.bai_ghep_id))
    elif cv.lsx_id and cv.lsx_id in lsx_map:
        nguon_ma, nguon_ten = lsx_map[cv.lsx_id]
        nguon_loai = "lsx"
        khach = (khach_map or {}).get(("lsx", cv.lsx_id))
    else:
        nguon_ma, nguon_ten, nguon_loai, khach = "", "", "", None
    return {
        "id": cv.id,
        # Tổ THẬT của việc — bàn nút cha gộp việc nhiều tổ con, nên thao tác theo tổ (danh chọn
        # người, xác nhận nhận vật tư) phải lấy tổ ở đây chứ không lấy nút đang mở.
        "department_id": cv.department_id,
        "goi_id": cv.goi_id,
        "phien_ban_so": cv.phien_ban_so,
        "nguon_loai": nguon_loai,
        "nguon_ma": nguon_ma,
        "nguon_ten": nguon_ten,
        # Tên khách của lệnh (bài ghép: khách mọi lệnh thành viên) — tổ nhìn biết hàng của ai.
        "khach_hang": khach,
        "nhom_id": cv.nhom_id,
        "nhom": nhom_map.get(cv.nhom_id or 0, ""),
        "ten_cong_doan": cv.ten_cong_doan,
        # Bước của LỆNH — phân đoạn thứ hai trở đi tìm lại ô mình trên dải routing qua khoá này
        # (ô dải chỉ ghi id phân đoạn đầu). Bước chạy chung của bài ghép không có.
        "step_key": cv.step_key if not cv.bai_ghep_cong_doan_id else None,
        "nhom_cong_doan": cv.nhom_cong_doan,
        "loai_buoc": cv.loai_buoc,
        "la_kcs_cuoi": cv.la_kcs_cuoi,
        # Dấu KCS trên thẻ việc (KCS theo lệnh): số lần kiểm + Σ đạt + Σ lỗi do việc này gây. Chỗ
        # gọi không nạp `kcs_map` thì để 0 — drawer đọc chi tiết qua mục "Kết quả KCS".
        "kcs_so_lan": (kcs_map or {}).get(cv.id, (0, 0.0, 0.0))[0],
        "kcs_dat": (kcs_map or {}).get(cv.id, (0, 0.0, 0.0))[1],
        "kcs_loi": (kcs_map or {}).get(cv.id, (0, 0.0, 0.0))[2],
        "may": may_map.get(cv.may_id or 0, ""),
        "may_id": cv.may_id,      # máy HIỆN TẠI — FE cần để dựng ô chọn "Đổi máy" (§7.2 mở rộng)
        # Hai thang giờ khác nhau gặp nhau ở ĐÂY (xem `services/gio_xuong.py`): mốc kế hoạch là
        # giờ tường dán nhãn UTC, mốc phiên chạy là UTC THẬT. Cùng quy về wall-clock giờ xưởng
        # rồi mới trả — không thì cùng một thanh Gantt đo bằng hai cây thước lệch nhau 7 tiếng.
        "du_kien_bat_dau": lich_hien_thi(cv.du_kien_bat_dau),
        "du_kien_ket_thuc": lich_hien_thi(cv.du_kien_ket_thuc),
        # Lúc việc tới tay tổ = lúc phát hành tạo thẻ việc (`created_at`, UTC THẬT → giờ xưởng).
        # "Phát hành cập nhật" sửa đè tại chỗ nên mốc này giữ nguyên lần nhận đầu.
        "nhan_luc": thuc_te_hien_thi(cv.created_at),
        # Số người dự kiến chốt lúc phát hành (§7.1) — FE so với roster để đòi lý do khi lệch.
        # Bước NGOÀI dòng giấy: đo bằng đơn vị của CHÍNH nó (ghi kẽm đếm bản, đóng thùng đếm
        # thùng) nên `so_luong_vao == so_luong_ra` và cột "SL vào → ra" phải hiện MỘT số. Cờ này
        # là ảnh chụp lúc phát hành — FE không suy lại được từ mã đơn vị, xem `dinh_muc_json`.
        "ngoai_dong": bool(_dm(cv, "ngoai_dong")),
        # Dải thời lượng chạy: ba số cùng thang, bằng nhau khi máy chưa khai tốc độ min/max.
        "chay_phut": _dm(cv, "chay_phut"),
        "chay_phut_min": _dm(cv, "chay_phut_min"),
        "chay_phut_max": _dm(cv, "chay_phut_max"),
        # Dặn dò của kế hoạch + thẻ quy cách rút gọn — hai thứ tổ trưởng không có cửa nào tra
        # ngược (không có quyền `lsx`), nên chúng đi theo thẻ việc từ lúc phát hành.
        "ghi_chu": cv.ghi_chu,
        "quy_cach": cv.quy_cach_json or None,
        "so_luong_vao": _num(cv.so_luong_vao),
        "so_luong_ra": _num(cv.so_luong_ra),
        "don_vi_vao": cv.don_vi_vao,
        "don_vi_ra": cv.don_vi_ra,
        "trang_thai": cv.trang_thai,
        # Ba số thực tế + còn thiếu — dẫn xuất, chỉ để BÀY (§2.3). `muc_tieu` đã rút theo lượng
        # THỰC NHẬN (xem `_con_thieu`), còn `so_luong_ra` ở trên vẫn là kế hoạch nguyên vẹn. Chỗ
        # gọi không nạp `so_map` (vd. khối "cong_viec" của drawer) thì cứ None, không bịa số.
        "thuc_nhan": (so_map or {}).get(cv.id, {}).get("thuc_nhan"),
        "da_lam": (so_map or {}).get(cv.id, {}).get("da_lam"),
        "muc_tieu": (so_map or {}).get(cv.id, {}).get("muc_tieu"),
        "con_thieu": (so_map or {}).get(cv.id, {}).get("con_thieu"),
        "nhan": (so_map or {}).get(cv.id, {}).get("nhan"),
        "nhan_ra": (so_map or {}).get(cv.id, {}).get("nhan_ra"),
        "loi": (so_map or {}).get(cv.id, {}).get("loi"),
        # Định mức vật tư đóng băng lúc phát hành (§4.2) — đã đúng hình `VatTuDinhMucOut`, không cần dựng lại.
        "dinh_muc_vat_tu": cv.vat_tu_json or [],
        # Nhà gia công + khuôn — ảnh chụp lúc phát hành, thẻ việc tự đứng được không tra ngược lệnh.
        "nha_cung_cap": cv.nha_cung_cap,
        "khuon": cv.khuon_json or None,
        "khuon_da_nhan": cv.khuon_nhan_luc is not None,
        "khuon_da_tra": cv.khuon_tra_luc is not None,
        # Lớp thực-tế (§5.1): các phiên chạy đã ghi; phiên còn mở giữ ket_thuc=None (FE kéo tới "bây giờ").
        "thuc_te": [
            {"bat_dau": thuc_te_hien_thi(p.bat_dau), "ket_thuc": thuc_te_hien_thi(p.ket_thuc)}
            for p in (phien_map or {}).get(cv.id, [])
        ],
        # Người xem bấm được Bắt đầu / Tạm dừng / Kết thúc ngay trên dòng? Chỗ gọi không truyền
        # `chay_ids` (vd. khối "cong_viec" của drawer — drawer đọc `quyen`) thì cứ False.
        "chay_duoc": cv.id in (chay_ids or ()),
    }


def _viec_chay_duoc(db: Session, user: User, q: QuyenTo, rows: list) -> set[int]:
    """Việc nào người xem giữ Thực hiện lệnh — cùng luật `quyen_tren_viec`, nhưng gộp MỘT truy vấn
    phân công cho mọi việc mức "Của tôi" thay vì hỏi từng dòng."""
    ra: set[int] = set()
    cho_rieng: set[int] = set()
    for cv in rows:
        muc = q.muc(VIEC_THUC_HIEN, cv.department_id)
        if muc == MUC_TAT_CA:
            ra.add(cv.id)
        elif muc == MUC_CUA_TOI:
            cho_rieng.add(cv.id)
    if cho_rieng:
        emp_id = _nhan_vien_id(db, user)
        if emp_id is not None:
            ra |= SanXuatThucThiRepository(db).cong_viec_ids_duoc_giao(emp_id, cho_rieng)
    return ra


def _dung_items(db: Session, repo: SanXuatRepository, rows: list,
                chay_ids: set[int] | None = None) -> list[dict]:
    """Dựng payload thẻ việc cho một tập bước — GỘP mọi truy vấn phụ, không N+1 theo dòng."""
    if not rows:
        return []
    lsx_map = repo.lsx_nhan({cv.lsx_id for cv in rows if cv.lsx_id})
    bg_map = repo.bai_ghep_nhan({cv.bai_ghep_id for cv in rows if cv.bai_ghep_id})
    khach_map = repo.khach_nhan({cv.lsx_id for cv in rows if cv.lsx_id},
                                {cv.bai_ghep_id for cv in rows if cv.bai_ghep_id})
    may_map = repo.may_nhan({cv.may_id for cv in rows if cv.may_id})
    nhom_map = repo.nhom_nhan({cv.nhom_id for cv in rows if cv.nhom_id})
    # Lớp thực-tế: phiên chạy của cả gói trong MỘT truy vấn (§5.1), tránh N+1 theo từng việc.
    phien_map = SanXuatThucThiRepository(db).phien_theo_cong_viec({cv.id for cv in rows})
    # Còn thiếu (§2.3): nạp tổng TỐT gộp cho cả bàn tổ rồi tính tại chỗ — không gọi `tong_tot`
    # (một truy vấn/việc) theo từng dòng, bàn tổ có thể có hàng chục công việc.
    sl_repo = SanXuatSanLuongRepository(db)
    cv_ids = {cv.id for cv in rows}
    so_map = _so_lieu_map(db, sl_repo, rows, sl_repo.tong_tot_nhieu(cv_ids),
                          sl_repo.tong_thuc_nhan_nhieu(cv_ids))
    kcs_repo = SanXuatKcsRepository(db)
    kiem = kcs_repo.tong_kiem_nhieu(cv_ids)
    # Chip lỗi trên thẻ việc tính lỗi DO công đoạn này gây (08/10/2026), kể cả KCS bắt ở bước sau —
    # không phải lỗi KCS bắt được tại đây mà quy về bước khác.
    loi_do = kcs_repo.loi_do_cong_doan_nhieu(cv_ids)
    kcs_map = {
        cid: (kiem.get(cid, (0, 0.0, 0.0))[0], kiem.get(cid, (0, 0.0, 0.0))[1], loi_do.get(cid, 0.0))
        for cid in set(kiem) | set(loi_do)
    }
    # Người đang được giao — dòng phụ cột Trạng thái của lưới (09/10/2026).
    ten_map = SanXuatThucThiRepository(db).ten_nguoi_dang_giao_nhieu(cv_ids)
    return [
        {**_item_dict(cv, lsx_map, bg_map, may_map, nhom_map, phien_map, so_map, chay_ids, kcs_map,
                      khach_map), "nguoi_lam": ten_map.get(cv.id, [])}
        for cv in rows
    ]


def _trong_cua_so(cv, tu_ngay: date | None, den_ngay: date | None) -> bool:
    """Bước có GIAO với cửa sổ ngày? Bước chưa xếp giờ LUÔN giữ lại — nó nằm ở khúc "chưa định
    giờ" của cột trái, cắt nó theo cửa sổ là làm nó mất hẳn khỏi mọi trang."""
    if cv.du_kien_bat_dau is None or cv.du_kien_ket_thuc is None:
        return True
    if den_ngay is not None and cv.du_kien_bat_dau.date() > den_ngay:
        return False
    if tu_ngay is not None and cv.du_kien_ket_thuc.date() < tu_ngay:
        return False
    return True


def _lich_cua_so(db: Session, tu_ngay: date | None, den_ngay: date | None) -> dict:
    """Ngày nghỉ, ngày lễ / làm bù và ca xưởng cho trục ngày của Lịch bàn tổ (10/10/2026) — trục đọc
    Lịch làm việc như bàn Xếp lịch thay vì tự đoán T7/CN. Cùng nguồn `CalendarService` +
    `ca_lich_xuong` với Xếp lịch (`XepLichService._ngay_nghi` / `_ngay_dac_biet`). Thiếu một mép
    cửa sổ hoặc cửa sổ quá 92 ngày thì chỉ trả ca."""
    from ...repositories.audit_repo import AuditLogRepository
    from ...repositories.calendar_repo import CalendarRepository
    from ..calendar_service import CalendarService
    from ..xep_lich.trai_lich import mo_ta_ca

    ra: dict = {"cac_ca": mo_ta_ca(AttendanceRepository(db).ca_lich_xuong()),
                "ngay_nghi": [], "ngay_dac_biet": []}
    if tu_ngay is None or den_ngay is None or not 0 <= (den_ngay - tu_ngay).days <= 92:
        return ra
    cal = CalendarService(CalendarRepository(db), AuditLogRepository(db))
    d = tu_ngay
    while d <= den_ngay:
        if not cal.is_working_day(d):
            ra["ngay_nghi"].append(d)
        sp = cal._special_for(d)
        if sp is not None:
            ra["ngay_dac_biet"].append({"ngay": d, "loai": sp.kind, "ten": sp.name})
        d += timedelta(days=1)
    return ra


def _dau_ngay_xuong(d: date | None) -> datetime | None:
    """0 giờ của một NGÀY XƯỞNG → UTC THẬT, để so với `created_at` (thang thực thi)."""
    if d is None:
        return None
    return ve_utc_that(datetime.combine(d, time.min, tzinfo=timezone.utc))


def _mep_ky(moc: str, d: date | None) -> datetime | None:
    """0 giờ ngày XƯỞNG `d` theo đúng thang của cột mốc: `du_kien` là thang LỊCH (giờ tường dán
    nhãn UTC) nên giữ nguyên; `nhan`/`tao` là `created_at` UTC THẬT nên quy về UTC thật."""
    if d is None:
        return None
    if moc == "du_kien":
        return datetime.combine(d, time.min, tzinfo=timezone.utc)
    return _dau_ngay_xuong(d)


def _digest(rows) -> dict[str, int]:
    """Đếm bước theo trạng thái cho nhãn của một lệnh — cùng bốn khoá mà FE `sxDigest` dùng."""
    d = {"released": 0, "running": 0, "paused": 0, "completed": 0}
    for cv in rows:
        d[cv.trang_thai if cv.trang_thai in d else "released"] += 1
    return d


def work_items(
    db: Session, user: User, authz: AuthorizationService, *, team_id: int,
    nhom: str = "lenh",
    tim: str | None = None,
    trang: int = 1,
    co_trang: int = 20,
    tu_ngay: date | None = None,
    den_ngay: date | None = None,
    cho_xac_nhan: bool = False,
    trang_thai: set[str] | None = None,
    moc: str = "nhan",
    sap_xep: str = "moi_nhan",
    cho_loai: set[str] | None = None,
    toi: str | None = None,
    vuong: set[str] | None = None,
    tre: str | None = None,
    nguoi: set[int] | None = None,
    gap: str | None = None,
) -> dict:
    """Việc đã phát hành của MỘT tổ. Hai hình, chọn bằng `nhom`:

    · `"lenh"` (mặc định) — **đầu mục là LỆNH SX / BÀI GHÉP**, mỗi lệnh một dòng, bên trong là các
      CÔNG ĐOẠN của chính tổ này (thẻ việc giữ nguyên hình cũ — đơn vị việc vẫn là công đoạn).
      Chủ xưởng chốt 11/09/2026: *"lệnh hoặc bài ghép thôi, chứ không làm sao tôi biết được công
      đoạn đó cho lệnh nào"*. Gom nhóm + CẮT TRANG ở máy chủ, đơn vị trang là LỆNH.
    · `"phang"` — mảng bước phẳng như trước, cho view **Gantt** (trục thời gian không có tầng
      lệnh). Nhận thêm cửa sổ `tu_ngay`/`den_ngay` để Gantt chỉ kéo đúng khoảng đang xem thay vì
      cả bàn.

    `tim` (ô tìm kiếm của bàn) lọc Ở SQL, trước khi cắt trang — chỉ có nghĩa với `nhom="lenh"`;
    chế độ phẳng kéo trọn bàn nên màn tự lọc lấy.

    Bàn của nút cấp gom phủ cả VÙNG của nút (mg 0302). Trong vùng, tổ nào user thấy trọn thì lấy
    cả tổ; tổ nào chỉ "Của tôi" thì chỉ việc đang giao cho mình — lọc ĐẨY XUỐNG SQL, trước cả lúc
    gom lệnh và cắt trang (§6 spec). Router ép kiểu `nhom` bằng `Literal` trước khi gọi
    xuống đây — service nhận `str` thô là đủ.

    `cho_xac_nhan` (ô "chờ xác nhận" của bàn, §11.5): chỉ giữ lệnh có ÍT NHẤT MỘT công đoạn đang
    chờ tổ bấm (bàn giao đến · lỗi KCS chưa xem) — lọc trước khi cắt trang, cả lệnh
    vẫn hiện đủ công đoạn của tổ.

    Lọc nâng cao (chỉ `nhom="lenh"`, lọc trước khi cắt trang): `trang_thai` giữ lệnh có bước ở
    trạng thái ấy VÀ trong lệnh chỉ bày các bước khớp; kỳ `tu_ngay`/`den_ngay` (NGÀY XƯỞNG, gồm cả
    hai đầu) theo mốc `moc` — `nhan` lúc tổ nhận lệnh (mặc định), `tao` ngày tạo lệnh, `du_kien`
    dự kiến bắt đầu (06/10/2026: thay `nhan_tu`/`nhan_den`); `sap_xep` mặc định lệnh nhận SAU nằm
    trên — xem repo. Ở `nhom="phang"`, `tu_ngay`/`den_ngay` vẫn là cửa sổ Gantt.

    Thanh lọc 6 điều kiện (09/10/2026, chỉ `nhom="lenh"`): `cho_loai` (loại việc chờ tổ bấm),
    `toi` (hàng đang tới đâu), `vuong` (chưa bắt đầu được vì), `tre` (trễ giờ dự kiến), `nguoi`
    (người đang được giao), `gap` (10/10/2026: `gap` lệnh gấp / `thuong` lệnh thường) — tính trên
    MỌI việc của bàn (`loc_ban_to`), giữ việc khớp TẤT CẢ điều kiện kể cả `trang_thai`, rồi đi
    đúng đường `chi_cong_viec_ids` trước khi cắt trang. Trong lệnh chỉ bày đúng các việc khớp.
    Mỗi lệnh mang `is_rush` để bàn gắn thẻ GẤP cạnh mã."""
    repo = SanXuatRepository(db)
    q, _muc = _pham_vi_doc(db, user, team_id)
    tron, rieng = q.pham_vi_ban(team_id)
    emp_id = _nhan_vien_id(db, user) if rieng else None
    chi_ids = _cv_cho_xac_nhan(db, q, team_id) if cho_xac_nhan else None
    loc = {"toi": toi, "vuong": set(vuong or ()), "tre": tre, "nguoi": set(nguoi or ()),
           "cho": set(cho_loai or ()), "gap": gap}
    can = loc_ban_to.can_cua(loc) if nhom == "lenh" else set()
    khop_ids: set[int] | None = None
    if can:
        tat_ca = repo.cong_viec_cua_to(tron, employee_id=emp_id, rieng_ids=rieng)
        tt = loc_ban_to.thuoc_tinh(db, repo, tat_ca, can=can,
                                   cho_theo_loai=_cv_cho_theo_loai(db, q, team_id) if "cho" in can else None)
        khop_ids = {cv.id for cv in tat_ca
                    if loc_ban_to.khop(tt[cv.id], loc) and (not trang_thai or cv.trang_thai in trang_thai)}
        chi_ids = khop_ids if chi_ids is None else chi_ids & khop_ids

    if nhom == "phang":
        # A7 (28/09/2026) — cửa sổ đẩy xuống SQL TRƯỚC khi nạp, không kéo cả lịch sử của tổ về rồi
        # mới lọc. Mép SQL NỚI thêm một ngày mỗi đầu: `_trong_cua_so` so `.date()` của giá trị đọc
        # ra (giờ tường dán nhãn UTC), còn SQL so mốc thời điểm — nới cho khỏi lệch múi/biên ngày;
        # lọt thừa thì `_trong_cua_so` ngay dưới gạt lại chính xác như cũ.
        rows = repo.cong_viec_cua_to(
            tron, employee_id=emp_id, rieng_ids=rieng,
            cham_tu=(datetime.combine(tu_ngay, time.min, tzinfo=timezone.utc) - timedelta(days=1)
                     if tu_ngay is not None else None),
            cham_den=(datetime.combine(den_ngay, time.min, tzinfo=timezone.utc) + timedelta(days=2)
                      if den_ngay is not None else None),
        )
        if tu_ngay is not None or den_ngay is not None:
            rows = [cv for cv in rows if _trong_cua_so(cv, tu_ngay, den_ngay)]
        if chi_ids is not None:
            rows = [cv for cv in rows if cv.id in chi_ids]
        return {"team_id": team_id, "nhom": "phang",
                "cong_viec": _dung_items(db, repo, rows, _viec_chay_duoc(db, user, q, rows)),
                **_lich_cua_so(db, tu_ngay, den_ngay)}

    khoa_trang, tong = repo.lenh_cua_to_phan_trang(
        tron, employee_id=emp_id, rieng_ids=rieng, tim=tim, trang=trang,
        co_trang=co_trang, chi_cong_viec_ids=chi_ids, trang_thai=trang_thai,
        moc=moc, ky_tu=_mep_ky(moc, tu_ngay),
        ky_den=_mep_ky(moc, den_ngay + timedelta(days=1) if den_ngay else None),
        sap_xep=sap_xep)
    khoa = [k for k, _, _ in khoa_trang]
    rows = repo.cong_viec_cua_lenh(tron, khoa, employee_id=emp_id, rieng_ids=rieng)
    # Dải routing: chuỗi công đoạn ĐẦY ĐỦ của lệnh, kể cả bước của tổ khác (chỉ đọc). Dựng từ
    # `rows` TRƯỚC khi lọc `trang_thai` — lọc trạng thái là thao tác của danh sách VIỆC, dải thì
    # phải luôn đủ chuỗi, không thì tổ lọc "đang chạy" một cái là dải cụt mất mấy bước.
    dai_theo_khoa = routing_dai.dung_routing(db, repo, khoa=khoa, cv_cua_toi=rows)
    # "Nhận" của lệnh tính trên MỌI bước của tổ (cùng khoá sắp của repo), trước khi lọc trạng thái.
    nhan_lenh: dict[tuple[str, int | None], datetime] = {}
    for cv in rows:
        k = ("bai_ghep", cv.bai_ghep_id) if cv.bai_ghep_id else ("lsx", cv.lsx_id)
        if cv.created_at and (k not in nhan_lenh or cv.created_at < nhan_lenh[k]):
            nhan_lenh[k] = cv.created_at
    if trang_thai:
        rows = [cv for cv in rows if cv.trang_thai in trang_thai]
    if khop_ids is not None:
        rows = [cv for cv in rows if cv.id in khop_ids]
    item_theo_id = {it["id"]: it for it in _dung_items(db, repo, rows, _viec_chay_duoc(db, user, q, rows))}
    cv_theo_khoa: dict[tuple[str, int | None], list] = {}
    for cv in rows:
        k = ("bai_ghep", cv.bai_ghep_id) if cv.bai_ghep_id else ("lsx", cv.lsx_id)
        cv_theo_khoa.setdefault(k, []).append(cv)

    lsx_map = repo.lsx_nhan({i for loai, i in khoa if loai == "lsx" and i})
    bg_map = repo.bai_ghep_nhan({i for loai, i in khoa if loai == "bai_ghep" and i})
    tao_map = repo.ngay_tao_nguon(set(lsx_map), set(bg_map))
    gap_set = repo.nguon_gap(set(lsx_map), set(bg_map))
    ra: list[dict] = []
    for (loai, nid), som, muon in khoa_trang:
        cvs = cv_theo_khoa.get((loai, nid), [])
        ma, ten = (bg_map if loai == "bai_ghep" else lsx_map).get(nid or 0, ("", ""))
        ma, ten = ma or "", ten or ""
        # Khách lấy lại từ thẻ việc đã dựng (cùng lệnh ⇒ cùng khách), khỏi tra DB thêm lượt nữa.
        khach = next((item_theo_id[cv.id]["khach_hang"] for cv in cvs if cv.id in item_theo_id), None)
        ra.append({
            "nguon_loai": loai,
            "nguon_ma": ma,
            "nguon_ten": ten,
            "khach_hang": khach,
            "lsx_id": nid if loai == "lsx" else None,
            "bai_ghep_id": nid if loai == "bai_ghep" else None,
            "is_rush": (loai, nid) in gap_set,
            "som_nhat": lich_hien_thi(som),
            "muon_nhat": lich_hien_thi(muon),
            "nhan_luc": thuc_te_hien_thi(nhan_lenh.get((loai, nid))),
            "tao_luc": thuc_te_hien_thi(tao_map.get((loai, nid or 0))),
            "so_viec": len(cvs),
            "digest": _digest(cvs),
            "routing": dai_theo_khoa.get((loai, nid), []),
            "cong_viec": [item_theo_id[cv.id] for cv in cvs if cv.id in item_theo_id],
        })
    return {"team_id": team_id, "nhom": "lenh",
            "trang": {"trang": trang, "co_trang": co_trang, "tong": tong},
            "lenh": ra}


def loc_dem(
    db: Session, user: User, authz: AuthorizationService, *, team_id: int,
    tim: str | None = None,
    tu_ngay: date | None = None,
    den_ngay: date | None = None,
    moc: str = "nhan",
) -> dict:
    """Số đếm cho menu Lọc của bàn tổ (09/10/2026). Đếm theo CÔNG VIỆC, trên các việc của bàn sau
    khi áp ô tìm + kỳ, TRƯỚC các điều kiện lọc khác — người xem thấy mỗi giá trị còn bao nhiêu việc
    nếu chọn nó. Cùng phạm vi đọc với `work_items`."""
    repo = SanXuatRepository(db)
    q, _muc = _pham_vi_doc(db, user, team_id)
    tron, rieng = q.pham_vi_ban(team_id)
    emp_id = _nhan_vien_id(db, user) if rieng else None
    khoa_trang, _tong = repo.lenh_cua_to_phan_trang(
        tron, employee_id=emp_id, rieng_ids=rieng, tim=tim, trang=1, co_trang=10**6,
        moc=moc, ky_tu=_mep_ky(moc, tu_ngay),
        ky_den=_mep_ky(moc, den_ngay + timedelta(days=1) if den_ngay else None))
    rows = repo.cong_viec_cua_lenh(tron, [k for k, _, _ in khoa_trang], employee_id=emp_id, rieng_ids=rieng)
    tt = loc_ban_to.thuoc_tinh(db, repo, rows, can=set(loc_ban_to.KHOA),
                               cho_theo_loai=_cv_cho_theo_loai(db, q, team_id))

    def _dem(khoa: str, gia_tri: tuple[str, ...]) -> dict[str, int]:
        d = {g: 0 for g in gia_tri}
        for t in tt.values():
            v = t[khoa]
            for g in ([v] if isinstance(v, str) else v if v else []):
                if g in d:
                    d[g] += 1
        return d

    trang_thai = {s: 0 for s in ("released", "running", "paused", "completed")}
    for cv in rows:
        if cv.trang_thai in trang_thai:
            trang_thai[cv.trang_thai] += 1
    # Người làm: thợ của các tổ trên bàn (kể cả người chưa giao việc nào — số 0) + người đang được
    # giao dù ở tổ khác.
    so_nguoi: dict[int, int] = {}
    for t in tt.values():
        for e in t["nguoi"]:
            so_nguoi[e] = so_nguoi.get(e, 0) + 1
    tt_repo = SanXuatThucThiRepository(db)
    ten: dict[int, str] = {}
    for dept_id in sorted(tron):
        for emp in tt_repo.nhan_vien_cua_to(dept_id):
            ten.setdefault(emp.id, emp.full_name)
    for e in so_nguoi:
        if e not in ten and (emp := tt_repo.nhan_vien(e)) is not None:
            ten[e] = emp.full_name
    nguoi = sorted(({"id": e, "ten": n, "so": so_nguoi.get(e, 0)} for e, n in ten.items()),
                   key=lambda x: (-x["so"], x["ten"] or ""))
    return {
        "trang_thai": trang_thai,
        "cho": _dem("cho", loc_ban_to.CHO),
        "toi": _dem("toi", loc_ban_to.TOI),
        "vuong": _dem("vuong", loc_ban_to.VUONG),
        "tre": _dem("tre", loc_ban_to.TRE),
        "gap": _dem("gap", loc_ban_to.GAP),
        "nguoi": nguoi,
    }


def nhan_vien_chon(
    db: Session, user: User, authz: AuthorizationService, *, team_id: int
) -> dict:
    """Nhân viên chọn được để GIAO vào việc của một tổ (ô "Giao người" ở drawer, §7.1).

    Cùng phạm vi ĐỌC như `work_items` (tổ phải trong quyền user, nếu không → chặn). Endpoint riêng
    của module `san_xuat` để tổ trưởng KHÔNG cần quyền `nhan_su` mới đổ được danh chọn. `la_luong_khoan`
    suy từ `has_piece_work` của chính tổ (mọi người trong tổ cùng chế độ) — FE không lọc ai, cũng không
    gắn thẻ "công nhật" nữa (09/10/2026). `co_tai_khoan` để biết ai nhận được thông báo đẩy.
    """
    _pham_vi_doc(db, user, team_id)
    dept = db.get(Department, team_id)
    la_khoan = bool(dept and dept.has_piece_work)
    ds = SanXuatThucThiRepository(db).nhan_vien_cua_to(team_id)
    # Đang chạy việc nào / chờ mấy việc / nghỉ gì — xem `tinh_trang_nguoi`. Ngày là ngày XƯỞNG.
    ngay = hom_nay()
    tt = tinh_trang_nhieu(db, ds, ngay=ngay)
    return {
        "team_id": team_id,
        "hom_nay": ngay,
        "nhan_vien": [
            {
                "id": e.id,
                "code": e.code,
                "full_name": e.full_name,
                "la_luong_khoan": la_khoan,
                "co_tai_khoan": e.user_id is not None,
                **tt[e.id],
            }
            for e in ds
        ],
    }


def _to_cho_xac_nhan(db: Session, xn_ids: set[int]) -> list[set[int]]:
    """Mỗi việc đang chờ xác nhận → tập tổ (trong `xn_ids`) đang phải đứng tên cho nó. Badge menu
    đếm một việc cho một nút khi tập đó chạm vùng của nút."""
    if not xn_ids:
        return []
    ra: list[set[int]] = [
        {dept} for _bg, dept in SanXuatSanLuongRepository(db).ban_giao_cho_nhan_cua_to(xn_ids)
    ]
    # Lỗi KCS tổ chưa bấm "Đã xem" — cũng là việc tổ phải bấm, badge đếm chung.
    ra.extend({l.to_chiu_id} for l in SanXuatKcsRepository(db).loi_chua_xem_nhieu_to(xn_ids))
    return ra


def _cv_cho_theo_loai(db: Session, q, team_id: int) -> dict[str, set[int]]:
    """Công đoạn đang có việc chờ tổ bấm trên bàn `team_id`, TÁCH theo loại (`ban_giao`, `kcs`) —
    cùng hai nguồn, cùng luật tổ với `cho_xac_nhan`, chỉ lấy id để lọc bảng việc."""
    xn_ids = set(q.cay.vung(team_id)) & q.tron[VIEC_XAC_NHAN]
    if not xn_ids:
        return {"ban_giao": set(), "kcs": set()}
    bg = {b.dich_cong_viec_id for b, _dept in SanXuatSanLuongRepository(db).ban_giao_cho_nhan_cua_to(xn_ids)}
    kcs = SanXuatKcsRepository(db)
    loi = kcs.loi_chua_xem_nhieu_to(xn_ids)
    # Lỗi quy về công đoạn đứng trước nằm ở công đoạn CHỊU lỗi, không phải công đoạn của lần kiểm —
    # cùng luật với `kcs.loi_cho_xem`, không thì bàn tổ chịu lỗi lọc ra trắng.
    batch = kcs.kcs_batch_nhieu({l.kcs_batch_id for l in loi if not l.cong_doan_ref_id})
    kl = {l.cong_doan_ref_id or (batch[l.kcs_batch_id].cong_viec_id if l.kcs_batch_id in batch else None)
          for l in loi}
    return {"ban_giao": {i for i in bg if i}, "kcs": {i for i in kl if i}}


def _cv_cho_xac_nhan(db: Session, q, team_id: int) -> set[int]:
    """Hợp các loại của `_cv_cho_theo_loai` — ô "chờ xác nhận" cũ (view Lịch còn dùng)."""
    return set().union(*_cv_cho_theo_loai(db, q, team_id).values())


def cho_xac_nhan(db: Session, user: User, *, team_id: int) -> dict:
    """Việc chờ tổ bấm trên bàn `team_id` (§9.1, §11.2, §11.5, §18).

    Hai loại việc tổ mình phải bấm: bàn giao đến chờ nhận và lỗi KCS báo về tổ chưa bấm "Đã xem"
    (KCS theo lệnh, mg 0306). Thỏa thuận hỗ trợ chéo gỡ 10/10/2026 (mg 0389).
    Chỉ tính tổ trong vùng của bàn mà user giữ Xác nhận sản lượng trọn tổ (cùng luật với nút ghi).

    `tren_ban`: công đoạn của dòng nằm trong tổ user thấy TRỌN trên bàn này ⇒ bàn đã vẽ nó (chấm đỏ
    trên dòng, xác nhận trong ngăn chi tiết). `False` ⇒ không có dòng nào để gắn, bàn liệt kê riêng khi bật ô "chờ xác nhận"."""
    q, _muc = _pham_vi_doc(db, user, team_id)
    xn_ids = set(q.cay.vung(team_id)) & q.tron[VIEC_XAC_NHAN]
    if not xn_ids:
        return {"team_id": team_id, "ban_giao": [], "kcs_loi": []}
    tron, _rieng = q.pham_vi_ban(team_id)
    repo = SanXuatRepository(db)
    sl = SanXuatSanLuongRepository(db)
    bgs = [bg for bg, _dept in sl.ban_giao_cho_nhan_cua_to(xn_ids)]
    from .kcs import loi_cho_xem  # import muộn: kcs.py đọc ngược board lúc gác phạm vi

    kcs_loi = loi_cho_xem(db, xn_ids)
    cvs = sl.cong_viec_nhieu(
        {b.nguon_cong_viec_id for b in bgs} | {b.dich_cong_viec_id for b in bgs}
        | {l["cong_viec_id"] for l in kcs_loi}
    )

    def _tren_ban(cid) -> bool:
        cv = cvs.get(cid)
        return cv is not None and cv.department_id in tron
    to_ten = repo.to_ten_nhan({c.department_id for c in cvs.values() if c.department_id})
    lsx_map = repo.lsx_nhan({c.lsx_id for c in cvs.values() if c.lsx_id})

    def _cv(cid):
        return cvs.get(cid)

    def _lsx_ma(cv):
        return lsx_map.get(cv.lsx_id, (None, None))[0] if cv is not None and cv.lsx_id else None

    ban_giao = []
    for b in bgs:
        nguon, dich = _cv(b.nguon_cong_viec_id), _cv(b.dich_cong_viec_id)
        ban_giao.append({
            "id": b.id,
            "nguon_cong_viec_id": b.nguon_cong_viec_id,
            "nguon_ten": nguon.ten_cong_doan if nguon else "",
            "nguon_to_ten": to_ten.get(nguon.department_id) if nguon and nguon.department_id else None,
            "dich_cong_viec_id": b.dich_cong_viec_id,
            "dich_ten": dich.ten_cong_doan if dich else "",
            "dich_to_ten": to_ten.get(dich.department_id) if dich and dich.department_id else None,
            "lsx_ma": _lsx_ma(dich),
            "so_luong": float(b.so_luong),
            "don_vi": b.don_vi,
            "de_xuat_luc": thuc_te_hien_thi(b.de_xuat_luc),
            "version": b.version,
            "tren_ban": _tren_ban(b.dich_cong_viec_id),
        })
    for l in kcs_loi:
        l["tren_ban"] = _tren_ban(l["cong_viec_id"])

    return {"team_id": team_id, "ban_giao": ban_giao, "kcs_loi": kcs_loi}


def ho_tro_ung_vien(
    db: Session, user: User, authz: AuthorizationService, *, team_id: int
) -> dict:
    """Người TỔ KHÁC tổ thêm được vào lần ghi sản lượng: thợ ở các tổ SX KHÁC. Cùng phạm vi ĐỌC
    như `work_items` (tổ phải trong quyền user). Mỗi người kèm nhãn tổ gốc để tổ biết đang thêm ai
    từ đâu."""
    _pham_vi_doc(db, user, team_id)
    # Ứng viên = thợ mọi tổ SX (kể cả tổ user không quản), trừ tổ đang thực hiện.
    moi_to = DepartmentRepository(db).to_san_xuat()
    to_ten = {d.id: d.name for d in moi_to}
    ds = SanXuatThucThiRepository(db).nhan_vien_ho_tro_ung_vien(
        {d.id for d in moi_to}, team_id
    )
    ngay = hom_nay()
    tt = tinh_trang_nhieu(db, ds, ngay=ngay)
    return {
        "team_id": team_id,
        "hom_nay": ngay,
        "nhan_vien": [
            {
                "id": e.id,
                "code": e.code,
                "full_name": e.full_name,
                "to_id": e.department_id,
                "to_ten": to_ten.get(e.department_id) if e.department_id else None,
                **tt[e.id],
            }
            for e in ds
        ],
    }


def _lan_dung_may(phien_rows, cv) -> list[tuple[datetime, datetime | None, str]]:
    """Các lần DỪNG MÁY của công việc (§5.2): `(tu, den, ly_do)`, mốc UTC thật.

    Bấm Tạm dừng là ĐÓNG phiên đang chạy (`loai_dong='tam_dung'` + lý do), nên máy dừng TỪ
    `ket_thuc` của phiên đó TỚI lúc phiên kế tiếp mở. Không có phiên kế: việc còn tạm dừng thì chưa
    hết dừng (`den` None); đã Kết thúc thẳng từ lúc dừng thì hết ở `hoan_thanh_luc`.

    Khoảng [bat_dau, ket_thuc] của chính phiên tạm dừng là lúc máy CHẠY. Lấy nó làm giờ dừng là mẻ
    09:09–09:11 hiện "Dừng máy 09:09–00:21" cho lần hết giấy lúc nửa đêm (DB dev 17/09/2026)."""
    ra = []
    for i, p in enumerate(phien_rows):
        if p.loai_dong != PHIEN_TAM_DUNG or not p.ly_do or p.ket_thuc is None:
            continue
        tu = _aware(p.ket_thuc)
        if i + 1 < len(phien_rows):
            den = _aware(phien_rows[i + 1].bat_dau)
        elif cv.trang_thai == CV_TAM_DUNG:
            den = None
        else:
            den = _aware(cv.hoan_thanh_luc) if cv.hoan_thanh_luc is not None else tu
        ra.append((tu, den, p.ly_do))
    return ra


def _dung_giao_me(lan_dung, b) -> list[tuple[datetime, datetime | None, str]]:
    """Các lần dừng máy GIAO với cửa sổ mẻ. Chạm đúng mép (dừng lúc mẻ vừa xong, chạy lại lúc mẻ
    sau vừa bắt đầu) không tính — không thì một lần dừng hiện ở cả hai mẻ kề nhau. Dừng chưa hết
    coi như kéo tới hiện tại."""
    bd, kt = _aware(b.bat_dau), _aware(b.ket_thuc)
    return [d for d in lan_dung if d[0] < kt and (d[1] is None or d[1] > bd)]


def _phien_giao_me(phien_rows, b) -> list:
    """Các phiên chạy GIAO với cửa sổ mẻ — nền của "máy nào chạy mẻ này" (§5.2). Máy đứng trên
    PHIÊN chứ không trên công việc, nên đọc `cv.may_id` chỉ ra máy HIỆN TẠI, sai cho mẻ chạy trước
    lúc đổi máy. Lần dừng máy của mẻ KHÔNG đọc ở đây, xem `_lan_dung_may`.

    Ép `_aware` vì SQLite trả naive (bẫy naive/aware của module). Phiên đang mở (`ket_thuc` NULL)
    coi như kéo dài tới hiện tại nên vẫn tính là giao."""
    bd, kt = _aware(b.bat_dau), _aware(b.ket_thuc)
    ra = []
    for p in phien_rows:
        pbd = _aware(p.bat_dau)
        pkt = _aware(p.ket_thuc) if p.ket_thuc is not None else None
        if pbd <= kt and (pkt is None or pkt >= bd):
            ra.append(p)
    return ra


def _ca_cua_moc(cas, moc_tuong: datetime):
    """Ca (và NGÀY của ca đó) mà `moc_tuong` (giờ TƯỜNG, NAIVE) rơi vào — `(ca, ngay)` hoặc None.

    Ca qua nửa đêm tính theo mốc BẮT ĐẦU ca (Ruling C120): việc chạy 01:00 nằm trong cửa sổ
    `[0, end_minute)` của HÔM NAY là phần ĐUÔI của ca đã bắt đầu TỐI HÔM QUA — ngày của ca lùi một
    ngày. `cas` phải đã sort theo `start_minute` (đúng thứ tự `ca_lich_xuong()` trả về).

    Chuyển từ `lenh_sx/bang_theo_doi.py` (05/10/2026) khi tab Theo ca bị xoá — bàn tổ là nơi duy
    nhất còn dùng luật này."""
    phut = moc_tuong.hour * 60 + moc_tuong.minute
    ngay = moc_tuong.date()
    for ca in cas:
        if not ca.is_overnight:
            if ca.start_minute <= phut < ca.end_minute:
                return ca, ngay
        elif phut >= ca.start_minute:
            return ca, ngay
        elif phut < ca.end_minute:
            return ca, ngay - timedelta(days=1)
    return None


def _ca_cua(cas, dt) -> str | None:
    """Tên CA chứa mốc THỰC THI `dt` (UTC thật), hoặc None khi mốc rơi ngoài mọi ca đã khai.

    Dùng `_ca_cua_moc` ngay trên: luật ca qua nửa đêm (Ruling C120) chỉ nên có MỘT chỗ, hai bản
    chép nhau là sớm muộn lệch nhau. "Ngoài ca" là một câu trả lời thật và tổ trưởng cần thấy đúng
    nó — đừng đoán ca gần nhất.

    Phút ca (`start_minute`) là phút-trong-ngày theo GIỜ TƯỜNG, nên phải đưa mốc về giờ xưởng
    trước khi so — trả UTC thật vào đây là mẻ 20:00 rơi vào Ca 1 (13:00)."""
    if dt is None:
        return None
    kq = _ca_cua_moc(list(cas), thuc_te_hien_thi(dt))
    return kq[0].name if kq else None


def _bg_dict(b, doi_tac_id, doi_tac_map, me_map, ten, ben_map=None) -> dict:
    """Một dòng bàn giao — hai bên thấy như nhau ai đề xuất, ai xác nhận, lúc nào; tên đọc từ tài khoản đã thao tác (`ten` = `{user_id: tên}` gom sẵn một lần). `ben_map`
    = `{cong_viec_id: {cong_doan, to}}` cho hai đầu giao/nhận; đích None = nhập kho."""
    ben_map = ben_map or {}
    nguon = ben_map.get(b.nguon_cong_viec_id, {})
    dich = ben_map.get(b.dich_cong_viec_id or 0, {})
    return {
        "nguon_cong_doan": nguon.get("cong_doan"),
        "nguon_to": nguon.get("to"),
        "dich_cong_doan": dich.get("cong_doan") if b.dich_cong_viec_id else "Kho",
        "dich_to": dich.get("to"),
        "id": b.id,
        "doi_tac_cong_viec_id": doi_tac_id,
        "doi_tac_ten": doi_tac_map.get(doi_tac_id or 0, ""),
        "cung_to": b.cung_to,
        "so_luong": float(b.so_luong),
        "don_vi": b.don_vi,
        "trang_thai": b.trang_thai,
        "version": b.version,
        "batch_ids": me_map.get(b.id, []),
        "nguoi_de_xuat": ten.get(b.de_xuat_by_id),
        "de_xuat_luc": thuc_te_hien_thi(b.de_xuat_luc),
        "nguoi_xac_nhan": ten.get(b.xac_nhan_by_id),
        "xac_nhan_luc": thuc_te_hien_thi(b.xac_nhan_luc),
    }


def _dong_giay_nhan_tu(kh_svc, cv) -> list[tuple]:
    """`[(dòng giấy LsxCongDoanVatTu của bước, tên bước trước)]` — giấy bước của `cv` nhận từ bước
    trước vì không phải bước đầu mang mã đó (`buoc_nhan_tu`)."""
    if not cv.lsx_id or not cv.lsx_cong_doan_id:
        return []
    nhan = kh_svc.buoc_nhan_tu(cv.lsx_id).get(cv.lsx_cong_doan_id)
    if not nhan:
        return []
    return [(v, nhan["tu_buoc"]) for v in nhan["dong"]]


def _vat_tu_cap(db: Session, sl, kh_svc, cv, cac_dn, du_lieu_cu: bool) -> dict:
    """Khối vật tư cấp của drawer công đoạn (spec-de-nghi-cap-vat-tu-cong-doan §6).

    Ba con số của mỗi mặt hàng cộng dồn qua MỌI lần đề nghị — lần bổ sung là CỘNG THÊM, không ghi
    đè lần trước. `sl_thuc_xuat` lấy từ dòng phiếu `posted` HIỆN TẠI (ưu tiên `sl_goc`), tức là số
    SAU điều chỉnh: đọc `sl_da_ung` cũng ra số đó, nhưng đọc thẳng chứng từ thì không phụ thuộc
    thứ tự các bước cập nhật.

    Ruling task-7 25 (brief gốc tự mâu thuẫn — dặn "không truy vấn trong vòng lặp" rồi chính nó
    viết N+1): hai hàm repo GỘP (`yeu_cau_tom_tat`, `ten_hang_nhieu`) gọi ĐÚNG MỘT LẦN trước hai
    vòng lặp bên dưới; thân vòng lặp chỉ tra dict, không chạm DB lần nào nữa.
    """
    ke_hoach = kh_svc.nhu_cau_cua_cong_viec(cv)
    req_ids = [d.stock_request_id for d in cac_dn if d.stock_request_id]
    thuc_xuat = sl.thuc_xuat_theo_hang(req_ids)
    nhap_lai = sl.nhap_lai_theo_hang(cv.id)      # phần tổ đã trả kho (phiếu NHẬP ghi sổ)
    tom_tat = sl.yeu_cau_tom_tat(req_ids)
    yc_nhap = sl.yeu_cau_nhap_lai(cv.id)        # yêu cầu nhập tổ trả hàng thừa (mọi trạng thái)
    phieu_nhap = sl.phieu_nhap_da_ghi_so([r.id for r in yc_nhap])

    # Giấy bước này NHẬN từ bước trước (spec 2026-10-01 §5): không phải nhu cầu, không xin cấp —
    # chỉ hiện một dòng trung tính "Nhận từ …" để người ở tổ biết giấy đi đâu. Chỉ bước của LỆNH
    # mang dòng giấy (bước chung của bài không có) nên công việc của bài bỏ qua.
    dong_nhan_tu = _dong_giay_nhan_tu(kh_svc, cv)

    tat_ca_khoa = {(k["hang_loai"], k["hang_id"]) for k in ke_hoach} | {
        (d.hang_loai, d.hang_id) for dn in cac_dn for d in dn.dongs
    } | {("giay", int(v.vat_tu_id)) for v, _ in dong_nhan_tu} | {(k[0], k[1]) for k in nhap_lai} | {
        (ln.hang_loai, ln.hang_id) for r in yc_nhap for ln in r.lines
    }
    ten_map = sl.ten_hang_nhieu(tat_ca_khoa)

    # Gom theo `khoa_dong`: giấy cùng mã khác khổ / khác đơn vị gốc là hai hàng đối chiếu (spec giấy
    # tờ × khổ; bỏ dạng cuộn/tờ 10/10/2026).
    def _giay(goc, kr, kd) -> dict:
        return {"don_vi_goc": goc or "", "kho_rong": int(kr or 0), "kho_dai": int(kd or 0)}

    def _goc_dn(d) -> str | None:
        """Đơn vị gốc của dòng đề nghị đã lưu: giấy / vật tư là `dvt_goc` (mã gốc của khoá, mg 0388;
        vật tư từ mg 0390)."""
        return (d.dvt_goc or "").strip().lower() if co_don_vi_goc(d.hang_loai) else None

    gom: dict[tuple, dict] = {}
    for k in ke_hoach:
        gom[khoa_dong(k["hang_loai"], k["hang_id"], k.get("don_vi_goc"),
                      k.get("kho_rong"), k.get("kho_dai"))] = {
            "hang_loai": k["hang_loai"], "hang_id": k["hang_id"], "ten": k["ten"],
            **_giay(k.get("don_vi_goc"), k.get("kho_rong"), k.get("kho_dai")),
            "dvt": k["dvt"], "dvt_goc": k["dvt_goc"],
            "sl_ke_hoach": k["sl"], "sl_ke_hoach_goc": k["sl_goc"],
            "sl_yeu_cau": 0.0, "sl_yeu_cau_goc": 0.0,
            "sl_thuc_xuat": 0.0, "_cac_dvt": {k["dvt"]},
        }
    # Ruling task-7 47: `doi_chieu[].sl_yeu_cau` cộng dồn qua MỌI lần (đúng cho khối đối chiếu),
    # nhưng form "Sửa đề nghị" cần đúng dòng CỦA RIÊNG lần đang sửa — `sua()` THAY THẾ toàn bộ dòng
    # của một lần, điền số cộng dồn vào sẽ âm thầm thổi phồng. Gom `dongs_theo_lan` NGAY trong vòng
    # lặp này (không truy vấn thêm) để `cac_de_nghi` bên dưới đính đúng dòng riêng từng lần.
    dongs_theo_lan: dict[int, list[dict]] = {}
    for dn in cac_dn:
        dongs_theo_lan[dn.id] = []
        for d in dn.dongs:
            key = khoa_dong(d.hang_loai, d.hang_id, _goc_dn(d), d.kho_rong, d.kho_dai)
            ten = ten_map.get((d.hang_loai, d.hang_id)) or f"#{d.hang_id}"
            row = gom.setdefault(key, {
                "hang_loai": d.hang_loai, "hang_id": d.hang_id,
                "ten": ten, **_giay(_goc_dn(d), d.kho_rong, d.kho_dai),
                "dvt": d.dvt, "dvt_goc": d.dvt_goc,
                "sl_ke_hoach": float(d.sl_ke_hoach), "sl_ke_hoach_goc": float(d.sl_ke_hoach_goc),
                "sl_yeu_cau": 0.0, "sl_yeu_cau_goc": 0.0,
                "sl_thuc_xuat": 0.0, "_cac_dvt": set(),
            })
            row["sl_yeu_cau"] += float(d.sl_yeu_cau)
            row["sl_yeu_cau_goc"] += float(d.sl_yeu_cau_goc)
            row["_cac_dvt"].add(d.dvt)
            dongs_theo_lan[dn.id].append({
                "hang_loai": d.hang_loai, "hang_id": d.hang_id,
                "ten": ten, **_giay(_goc_dn(d), d.kho_rong, d.kho_dai),
                "dvt": d.dvt, "dvt_goc": d.dvt_goc,
                "sl_ke_hoach": float(d.sl_ke_hoach), "sl_ke_hoach_goc": float(d.sl_ke_hoach_goc),
                "sl_yeu_cau": float(d.sl_yeu_cau), "sl_yeu_cau_goc": float(d.sl_yeu_cau_goc),
                "ly_do_chenh_lech": d.ly_do_chenh_lech,
            })
    for key, sl_ra in thuc_xuat.items():
        if key in gom:
            gom[key]["sl_thuc_xuat"] = sl_ra
    # Dòng "nhận từ" dựng TRƯỚC vòng nhập lại: bước nhận giấy qua bàn giao vẫn trả thừa được (§3.5)
    # và phần trả phải trừ vào chính dòng nhận-từ, không đẻ dòng riêng đè mất nhãn "Nhận từ".
    for v, tu_buoc in dong_nhan_tu:
        dvt = v.don_vi_snapshot or ""
        # Đơn vị gốc máy chủ đã ghi cho dòng bước; dòng cũ chưa ghi thì suy từ ĐVT.
        goc = (v.don_vi_goc or "").strip().lower() or kh_svc.goc_cua_dvt("giay", int(v.vat_tu_id), dvt)
        key = khoa_dong("giay", int(v.vat_tu_id), goc, v.kho_rong, v.kho_dai)
        if key in gom:  # đã có dòng thật (kế hoạch/đề nghị) cùng mã+khổ+gốc ⇒ không đè nhãn lên nó
            continue
        sl_kh = float(v.so_luong)
        try:
            sl_goc, _ten = kh_svc.ve_don_vi_goc("giay", int(v.vat_tu_id), dvt, sl_kh, goc=goc)
            # MÃ gốc — cùng nhãn gốc với dòng kế hoạch thật (`nhu_cau_cua_cong_viec`).
            dvt_goc = goc
        except Exception:  # noqa: BLE001 - dòng thông tin: không quy đổi được thì hiện thang khai
            sl_goc, dvt_goc = sl_kh, dvt
        gom[key] = {
            "hang_loai": "giay", "hang_id": int(v.vat_tu_id),
            "ten": ten_map.get(("giay", int(v.vat_tu_id))) or v.vat_tu_ten_snapshot
                   or f"#{v.vat_tu_id}",
            **_giay(goc, v.kho_rong, v.kho_dai),
            "dvt": dvt, "dvt_goc": dvt_goc,
            "sl_ke_hoach": sl_kh, "sl_ke_hoach_goc": sl_goc,
            "sl_yeu_cau": 0.0, "sl_yeu_cau_goc": 0.0,
            "sl_thuc_xuat": 0.0, "_cac_dvt": {dvt},
            "nhan_tu": tu_buoc,
        }

    # NHẬP LẠI trừ vào ĐÚNG dòng đã xuất cùng `khoa_dong`. Trả khác khổ với mọi dòng đã xuất (xin
    # 2.700 tờ 800×1090, trả 70 tờ 790×1090) thì trừ vào dòng đã xuất cùng (mã, đơn vị gốc) có thực
    # xuất lớn nhất — thang gốc cùng một đơn vị nên trừ được — còn dòng trả hiện như dòng THÔNG TIN
    # ("nhập lại 70 · 790×1090", `nhap_lai_vao` = nhãn dòng đích), KHÔNG có thực dùng riêng. Không có
    # dòng đã xuất nào cùng (mã, đơn vị gốc) thì dòng trả đứng riêng, thực dùng âm là bất thường thật.
    def _dv_goc(loai, hid, goc) -> str:
        if co_don_vi_goc(loai) and goc:
            return goc      # khoá giấy / vật tư đã mang mã gốc
        try:
            return kh_svc.hang.don_vi_cua_mat_hang(loai, int(hid)).get("don_vi_goc") or ""
        except Exception:  # noqa: BLE001 - chỉ để dán nhãn đơn vị: không có thì để trống
            return ""

    for key, sl_vao in nhap_lai.items():
        if key not in gom:
            dv = _dv_goc(key[0], key[1], key[2])
            gom[key] = {
                "hang_loai": key[0], "hang_id": key[1],
                "ten": ten_map.get((key[0], key[1])) or f"#{key[1]}",
                **_giay(key[2], key[3], key[4]),
                "dvt": dv, "dvt_goc": dv,
                "sl_ke_hoach": 0.0, "sl_ke_hoach_goc": 0.0,
                "sl_yeu_cau": 0.0, "sl_yeu_cau_goc": 0.0,
                "sl_thuc_xuat": 0.0, "_cac_dvt": {dv},
            }
        if key in thuc_xuat or gom[key].get("nhan_tu"):
            gom[key]["sl_nhap_lai"] = gom[key].get("sl_nhap_lai", 0.0) + sl_vao
            continue
        dich = [k for k in thuc_xuat if k in gom and k[:3] == key[:3]]
        if not dich:
            # Bước "nhận từ": trả khác khổ trừ vào dòng nhận-từ cùng (mã, đơn vị gốc).
            dich = [k for k, r in gom.items() if r.get("nhan_tu") and k[:3] == key[:3]]
        if not dich:
            gom[key]["sl_nhap_lai"] = gom[key].get("sl_nhap_lai", 0.0) + sl_vao
            continue
        k_dich = max(dich, key=lambda k: thuc_xuat.get(k, gom[k]["sl_ke_hoach_goc"]))
        gom[k_dich]["sl_nhap_lai"] = gom[k_dich].get("sl_nhap_lai", 0.0) + sl_vao
        gom[key]["sl_nhap_lai"] = gom[key].get("sl_nhap_lai", 0.0) + sl_vao
        gom[key]["nhap_lai_vao"] = (
            nhan_kho(k_dich[3], k_dich[4]) if key[0] == "giay" and k_dich[2] == DON_VI_TO_KHO
            else gom[k_dich]["ten"])


    doi_chieu = []
    for row in gom.values():
        # MÁY so bằng thang GỐC (models/san_xuat_vat_tu.py:85-87); `sl_thuc_xuat` (từ
        # `StockVoucherLine.sl_goc`) vốn đã là thang gốc — so nó với `sl_yeu_cau` (thang tổ khai)
        # là so 100 tờ với 12 kg (vòng sửa 1, Important 2+3).
        row.setdefault("nhan_tu", None)
        row.setdefault("sl_nhap_lai", 0.0)
        # THỰC DÙNG = kho thực xuất − tổ nhập lại (thang gốc). Không kẹp ≥ 0: nhập lại nhiều hơn đã
        # xuất là dữ liệu bất thường, để số âm lộ ra thay vì che.
        row.setdefault("nhap_lai_vao", None)
        # Dòng THÔNG TIN (trả khác khổ đã xuất): phần trừ nằm ở dòng đích, không có thực dùng riêng.
        if row["nhap_lai_vao"]:
            row["sl_thuc_dung"] = None
        elif row["nhan_tu"]:
            # Dòng "nhận từ": không có phiếu xuất ⇒ thực dùng = kế hoạch nhận − nhập lại.
            row["sl_thuc_dung"] = row["sl_ke_hoach_goc"] - row["sl_nhap_lai"]
        else:
            row["sl_thuc_dung"] = row["sl_thuc_xuat"] - row["sl_nhap_lai"]
        row["lech_ke_hoach"] = row["sl_yeu_cau_goc"] - row["sl_ke_hoach_goc"]
        row["lech_thuc_te"] = row["sl_thuc_xuat"] - row["sl_yeu_cau_goc"]
        if row["nhan_tu"]:  # dòng "nhận từ": không có gì để lệch
            row["lech_ke_hoach"] = row["lech_thuc_te"] = 0.0
        # Khoá gom là `khoa_dong` — KHÔNG có đơn vị, nên một hàng có thể ôm dòng kế hoạch
        # khai "ram" và dòng tổ khai "tờ". Cộng hai số đó lại rồi in ra là nói dối. Thang gốc là
        # thứ DUY NHẤT chắc chắn chung, nên hàng lẫn đơn vị thì hiện bằng nó (vòng sửa 1, 2c).
        if len(row.pop("_cac_dvt")) > 1:
            row["dvt"] = row["dvt_goc"]
            row["sl_ke_hoach"] = row["sl_ke_hoach_goc"]
            row["sl_yeu_cau"] = row["sl_yeu_cau_goc"]
        doi_chieu.append(row)

    lan_cuoi = cac_dn[-1] if cac_dn else None
    req_repo = StockRequestRepository(db)
    tt = tom_tat.get(lan_cuoi.stock_request_id, {}).get("trang_thai") if lan_cuoi else None
    # `lan_con_mo` là vị ngữ DÙNG CHUNG với cổng thật của `tao()` (vòng sửa 1, Important 1) — hai
    # bên tính TỪ CÙNG một hàm nên không lệch nhau được nữa: `co_the_tao_bo_sung` giờ là phủ định
    # ĐÚNG BẰNG điều kiện ném của `tao()`, theo cấu trúc chứ không theo trí nhớ.
    con_mo = lan_con_mo(
        lan_cuoi,
        co_voucher=req_repo.co_voucher(lan_cuoi.stock_request_id) if lan_cuoi else False,
        trang_thai_kho=tt,
    )
    # `created_by_id`/`updated_by_id` là mã TÀI KHOẢN (users.id) — tra tên ở đây; FE từng tra bằng
    # danh sách thợ của việc (mã nhân viên) nên người gửi hiện "NV #1".
    ten_tk = SanXuatKcsRepository(db).ten_nguoi(
        {d.created_by_id for d in cac_dn} | {d.updated_by_id for d in cac_dn}
        | {r.nguoi_tao_id for r in yc_nhap} | {p.nguoi_ghi_so_id or p.nguoi_lap_id for p in phieu_nhap})
    return {
        "ke_hoach": ke_hoach,
        "cac_de_nghi": [{
            # `can_luc_hien_thi` gỡ nhãn UTC: Postgres trả AWARE, để nguyên là FE dịch thêm +7h.
            "id": d.id, "lan_so": d.lan_so, "loai": d.loai,
            "can_luc": can_luc_hien_thi(d.can_luc),
            "stock_request_id": d.stock_request_id,
            "stock_request_ma": tom_tat.get(d.stock_request_id, {}).get("ma"),
            "stock_request_trang_thai": tom_tat.get(d.stock_request_id, {}).get("trang_thai"),
            "created_by_id": d.created_by_id, "updated_by_id": d.updated_by_id,
            "created_by_ten": ten_tk.get(d.created_by_id), "updated_by_ten": ten_tk.get(d.updated_by_id),
            "created_at": thuc_te_hien_thi(d.created_at),
            "updated_at": thuc_te_hien_thi(d.updated_at),
            "dongs": dongs_theo_lan[d.id],
        } for d in cac_dn],
        "doi_chieu": doi_chieu,
        # Tổ trả hàng thừa về kho: hiện cùng danh sách chứng từ để tổ thấy ngay yêu cầu vừa gửi —
        # cột Nhập lại của bảng trên chỉ tăng khi kho ghi sổ phiếu nhập. Chỉ số lượng, không giá.
        "cac_nhap_lai": [{
            "id": r.id, "ma": r.ma, "trang_thai": r.trang_thai,
            "can_luc": can_luc_hien_thi(r.can_luc),
            "created_by_ten": ten_tk.get(r.nguoi_tao_id),
            "created_at": thuc_te_hien_thi(r.created_at),
            "dongs": [{
                "hang_loai": ln.hang_loai, "hang_id": ln.hang_id,
                "ten": ten_map.get((ln.hang_loai, ln.hang_id)) or f"#{ln.hang_id}",
                **_giay(ln.don_vi_goc, ln.kho_rong, ln.kho_dai),
                "dvt": ln.dvt, "sl": float(ln.sl_de_nghi or 0),
            } for ln in r.lines],
            "cac_phieu": [{
                "voucher_id": p.id, "ma": p.ma,
                "nhap_luc": thuc_te_hien_thi(p.ghi_so_luc) if p.ghi_so_luc else None,
                "nguoi_nhap": ten_tk.get(p.nguoi_ghi_so_id or p.nguoi_lap_id),
            } for p in phieu_nhap if p.request_id == r.id],
        } for r in yc_nhap],
        "de_nghi_co_the_sua_id": lan_cuoi.id if con_mo else None,
        "co_the_tao_bo_sung": not con_mo,
        "du_lieu_cu": du_lieu_cu,
    }


def chi_tiet_cong_viec(
    db: Session, user: User, authz: AuthorizationService, *, cong_viec_id: int
) -> dict:
    """Drawer một công việc: thanh kế hoạch + roster + phiên chạy + khoảng tham gia + sản lượng /
    bàn giao / vật tư (§5.1, §10–§11, §18).

    Cùng phạm vi ĐỌC như `work_items`: công việc phải thuộc một tổ user được thấy, nếu không → chặn.
    """
    repo = SanXuatRepository(db)
    tt = SanXuatThucThiRepository(db)
    cv = tt.cong_viec(cong_viec_id)
    if cv is None:
        raise ValueError("Không tìm thấy công việc.")
    q, muc = _pham_vi_doc(db, user, cv.department_id)
    la_tho = muc == MUC_CUA_TOI
    if la_tho and not _loc_viec_cua_tho(db, user, [cv]):
        raise PermissionError("Chỉ xem được việc đã giao cho mình.")

    lsx_map = repo.lsx_nhan({cv.lsx_id} if cv.lsx_id else set())
    bg_map = repo.bai_ghep_nhan({cv.bai_ghep_id} if cv.bai_ghep_id else set())
    may_map = repo.may_nhan({cv.may_id} if cv.may_id else set())
    nhom_map = repo.nhom_nhan({cv.nhom_id} if cv.nhom_id else set())

    roster = tt.phan_cong_hoat_dong(cv.id)
    khoang = tt.cac_khoang(cv.id)
    phien_rows = tt.cac_phien(cv.id)
    # Tên máy cho TỪNG phiên (có thể khác nhau nếu đã đổi máy giữa chừng, §7.2 mở rộng) — tra
    # theo đúng bảng `may_thiet_bi`, không dùng `may_map` (đó là bảng `machines` cũ, xem
    # `_may_thiet_bi_nhan`).
    phien_may_ten = _may_thiet_bi_nhan(db, {p.may_id for p in phien_rows if p.may_id})
    lan_dung = _lan_dung_may(phien_rows, cv)

    emp_ids = {pc.employee_id for pc in roster} | {k.employee_id for k in khoang}
    ten_map = repo.nhan_vien_nhan(emp_ids) if emp_ids else {}
    # Ảnh đại diện cho roster + khoảng tham gia — đọc sống từ tài khoản, người đổi ảnh là drawer mở
    # lần sau thấy ngay. Không có = FE vẽ chữ cái đầu.
    anh_map = repo.anh_dai_dien({pc.employee_id for pc in roster} | {k.employee_id for k in khoang})

    # --- Sản lượng · bàn giao · vật tư (Giai đoạn 3) -----------------------------------------
    sl = SanXuatSanLuongRepository(db)
    khoan_hien_tai, ten_cong_doan_khoan = sl.khoan_cua_cong_viec(cv)
    batches = sl.cac_batch(cv.id)
    _tong_tot_cv = sl.tong_tot(cv.id)
    # Lượng tổ này THẬT SỰ nhận được (bàn giao đã xác nhận về đây) — mốc chấm rút theo nó, xem
    # `_con_thieu`. None = không ai giao cho (bước đầu chuỗi) ⇒ giữ mốc kế hoạch.
    _thuc_nhan_cv = _thuc_nhan(cv, sl.tong_thuc_nhan_nhieu({cv.id}))
    _muc_tieu_cv, _con_thieu_cv = _con_thieu(cv, _tong_tot_cv, _thuc_nhan_cv)
    _nhan_loi_cv = _nhan_loi(db, sl, cv, _thuc_nhan_cv, _tong_tot_cv)

    # Máy + ca + sự cố + đầu việc của TỪNG mẻ (§5.2) — mọi số đã có sẵn trong DB, chỉ là chưa ai
    # nối ra mặt đọc. Tập ca lấy đúng nguồn dùng chung của xưởng (`ca_lich_xuong`, cùng tập mà Xếp
    # lịch và Theo dõi sản xuất dùng) để mẻ không bị gán một ca mà hai màn kia không biết tới.
    ca_list = AttendanceRepository(db).ca_lich_xuong()

    lot_map = sl.lot_vao_cua_nhieu([b.id for b in batches])
    # VIỆC PHÁT SINH của từng mẻ (mg `0318`) — một truy vấn cho cả tab, xem `phat_sinh_cua_nhieu`.
    # KHÔNG cộng vào `tong_tot`/`muc_tieu`/`con_thieu`: nó là con số đứng CẠNH sản lượng.
    ps_map = sl.phat_sinh_cua_nhieu([b.id for b in batches])
    # Băng "Danh mục đã đổi" của từng mẻ đọc chung một bản nạp (việc khoán của tổ + phát sinh sống).
    nap_dmd = viec_khoan.nap_doi_chieu(
        db, department_id=cv.department_id,
        ps_rows=[r for rows in ps_map.values() for r in rows],
    ) if any(b.piece_rate_id for b in batches) else ({}, {})
    # Tên đơn vị cho ảnh chụp của mẻ + của việc phát sinh — cột giữ MÃ (`kem`), tổ đọc TÊN.
    dv_me_ten = DonViDoRepository(db).ten_theo_ma()
    # AI LÀM từng lần ghi — CÙNG một hàm với tab Sản lượng và màn thợ (ảnh chụp tổ tick lúc ghi),
    # để drawer và hai màn kia không bao giờ lệch nhau. Không số phút (chốt ý 13).
    # Người không thuộc tổ CHỦ mẻ (tổ của bước) kèm nhãn tổ gốc — tổ trưởng biết ngay ai sang giúp.
    theo_me = nguoi_theo_me(db, [b.id for b in batches])
    to_goc_ten = repo.to_ten_nhan({
        n["department_id"] for ds in theo_me.values() for n in ds
        if n["department_id"] and n["department_id"] != cv.department_id
    })

    def _nguoi_me(batch_id: int) -> list[dict]:
        return [
            {
                "employee_id": n["employee_id"],
                "ho_ten": n["ho_ten"],
                "to_ten": (to_goc_ten.get(n["department_id"])
                           if n["department_id"] and n["department_id"] != cv.department_id
                           else None),
                "la_ho_tro": n["la_ho_tro"],
            }
            for n in theo_me.get(batch_id, [])
        ]
    bg_di = sl.ban_giao_tu_nguon(cv.id)
    bg_den = sl.ban_giao_toi_dich(cv.id)
    doi_tac_ids = {b.dich_cong_viec_id for b in bg_di if b.dich_cong_viec_id} | {
        b.nguon_cong_viec_id for b in bg_den
    }
    # Vòng sửa 1, Minor 4: gộp một truy vấn cho cả tập đối tác thay vì `db.get` từng cái (N+1 về
    # HÌNH DẠNG — `doi_tac_ids` thường 0-5 phần tử, không phải chỗ nghẽn, nhưng rẻ để sửa đúng
    # khuôn `*_nhieu` Task 7 vừa dựng).
    doi_tac_cvs = sl.cong_viec_nhieu(doi_tac_ids)
    doi_tac_map = {i: c.ten_cong_doan for i, c in doi_tac_cvs.items()}
    # Hai đầu của mỗi lần giao: công đoạn nào, tổ nào (bước thuê ngoài = nhà gia công) — thẻ bàn
    # giao ghi đủ "công đoạn · tổ · ai · lúc nào" cho CẢ bên giao lẫn bên nhận.
    _ben_cvs = {cv.id: cv, **doi_tac_cvs}
    _ben_to = repo.to_ten_nhan({c.department_id for c in _ben_cvs.values() if c.department_id})
    ben_map = {
        i: {
            "cong_doan": c.ten_cong_doan,
            "to": (c.nha_cung_cap if c.loai_buoc == "thue_ngoai" and c.nha_cung_cap
                   else _ben_to.get(c.department_id) if c.department_id else None),
        }
        for i, c in _ben_cvs.items()
    }
    vt_repo = SanXuatVatTuRepository(db)
    cac_dn = vt_repo.cac_de_nghi(cv.id)
    req_ids = [d.stock_request_id for d in cac_dn if d.stock_request_id]
    vouchers, du_lieu_cu = sl.voucher_xuat_cua_cong_viec(cv, req_ids)
    _nguoi_xuat = {
        int(r[0]): r[1] for r in db.execute(select(User.id, User.name).where(User.id.in_(
            {v.nguoi_ghi_so_id or v.nguoi_lap_id for v in vouchers} - {None}))).all()
    } if vouchers else {}

    kh_svc = _kh_service(db, _hang_service(db))
    vat_tu_cap = _vat_tu_cap(db, sl, kh_svc, cv, cac_dn, du_lieu_cu)

    # ĐÍCH bàn giao = chặng sau theo routing lệnh (§11.2) — FE bày cố định, chỉ cho chọn khi bước
    # sau tách lần chạy/rẽ nhánh. Rỗng = bước cuối lệnh — không bàn giao, thành phẩm qua KCS.
    chang_sau = sl.cong_viec_chang_sau(cv)
    chang_sau_to_ten = repo.to_ten_nhan({c.department_id for c in chang_sau if c.department_id})
    # Mẻ nào đã đi theo lần giao nào — form bàn giao chỉ tick sẵn mẻ chưa giao.
    me_map = sl.me_cua_ban_giao_nhieu([b.id for b in bg_di] + [b.id for b in bg_den])
    me_da_giao = sl.batch_da_giao_ids(cv.id)
    ten_bg = SanXuatKcsRepository(db).ten_nguoi(
        {u for b in (*bg_di, *bg_den) for u in (b.de_xuat_by_id, b.xac_nhan_by_id)}
    )

    # Dải công đoạn đầy đủ của lệnh — khối "Hàng đang tới đâu" ở cột phải của ngăn (09/10/2026).
    # "Của tôi" = các bước cùng tổ với việc này trong lệnh; bài ghép chưa có dải ⇒ rỗng.
    routing: list[dict] = []
    dai_duoi: dict | None = None
    if cv.lsx_id and not cv.bai_ghep_id:
        cvs_lenh = [c for c in repo.cong_viec_cua_goi_cho_lenh({cv.goi_id}, {cv.lsx_id})
                    if c.lsx_id == cv.lsx_id]
        cung_to = [c for c in cvs_lenh if c.department_id == cv.department_id]
        routing = routing_dai.dung_routing(
            db, repo, khoa=[("lsx", cv.lsx_id)], cv_cua_toi=cung_to or [cv],
        ).get(("lsx", cv.lsx_id), [])
        # Ô đuôi: làm xong bước cuối thì hàng đi đâu (11/10/2026).
        dai_duoi = routing_dai.o_duoi(db, routing, cvs_lenh)

    return {
        "routing": routing,
        "dai_duoi": dai_duoi,
        "bao_hong_may": bao_hong_dang_mo(db, cv.may_id),
        # Vòng sửa 1, mục 2: truyền đúng bộ số đã tính ở trên — nếu không, "cong_viec.con_thieu"
        # trả null trong khi "san_luong.con_thieu" ngay bên dưới có số, hai giá trị khác nhau cho
        # CÙNG một khái niệm trong CÙNG một response là nói dối.
        "cong_viec": _item_dict(
            cv, lsx_map, bg_map, may_map, nhom_map,
            khach_map=repo.khach_nhan({cv.lsx_id} if cv.lsx_id else set(),
                                      {cv.bai_ghep_id} if cv.bai_ghep_id else set()),
            so_map={cv.id: {
                "thuc_nhan": _thuc_nhan_cv, "da_lam": _tong_tot_cv,
                "muc_tieu": _muc_tieu_cv, "con_thieu": _con_thieu_cv, **_nhan_loi_cv,
            }},
        ),
        "trang_thai": cv.trang_thai,
        "version": cv.version,
        # Bốn quyền chi tiết của người đang xem trên CHÍNH việc này — drawer bật/tắt nút theo đây.
        "quyen": quyen_tren_viec(db, user.id, cv, q=q),
        # MỨC của từng quyền ở tổ này ("all" | "own"; không có khoá = không được cấp). `quyen` tắt
        # vì hai lý do khác nhau — không được cấp, hoặc chỉ "Của tôi" mà việc chưa giao cho mình —
        # và drawer phải nói đúng lý do nào, không thì người đã bật quyền đọc thấy "cần quyền".
        "quyen_muc": {v: m for v in VIEC_CHI_TIET if (m := q.muc(v, cv.department_id))},
        "khoan": ({
            "id": khoan_hien_tai.id,
            "ten": ten_cong_doan_khoan or cv.ten_cong_doan,
            "don_gia": float(khoan_hien_tai.unit_price),
            "don_vi": khoan_hien_tai.unit,
            "don_vi_ten": nhan_don_vi(dv_me_ten, khoan_hien_tai.unit),
            "phat_sinh": [
                {
                    "id": ps.id, "ten": ps.ten, "don_gia": float(ps.don_gia),
                    "don_vi": ps.don_vi,
                    "don_vi_ten": nhan_don_vi(dv_me_ten, ps.don_vi),
                }
                for ps in khoan_hien_tai.viec_phat_sinh
            ],
        } if khoan_hien_tai else None),
        "phan_cong": [
            {
                "id": pc.id,
                "employee_id": pc.employee_id,
                "ho_ten": ten_map.get(pc.employee_id, ("", None))[0],
                "la_luong_khoan": pc.la_luong_khoan,
                "co_tai_khoan": ten_map.get(pc.employee_id, ("", None))[1] is not None,
                "avatar_url": anh_map.get(pc.employee_id),
                "trang_thai": pc.trang_thai,
            }
            for pc in roster
        ],
        "phien_chay": [
            {
                "id": p.id,
                "so_thu_tu": p.so_thu_tu,
                "may_id": p.may_id,
                "may_ten": phien_may_ten.get(p.may_id or 0),
                "bat_dau": thuc_te_hien_thi(p.bat_dau),
                "ket_thuc": thuc_te_hien_thi(p.ket_thuc),
                "loai_dong": p.loai_dong,
                "ly_do_bat_dau_tre": p.ly_do_bat_dau_tre,
                "ly_do": p.ly_do,
            }
            for p in phien_rows
        ],
        "khoang_tham_gia": [
            {
                "id": k.id,
                "phien_chay_id": k.phien_chay_id,
                "employee_id": k.employee_id,
                "ho_ten": ten_map.get(k.employee_id, ("", None))[0],
                "avatar_url": anh_map.get(k.employee_id),
                "bat_dau": thuc_te_hien_thi(k.bat_dau),
                "ket_thuc": thuc_te_hien_thi(k.ket_thuc),
            }
            for k in khoang
        ],
        # Người tổ mình bày trong hộp Ghi sản lượng (10/10/2026): ai đang được giao, kèm nghỉ / đang
        # ở việc khác đã bắt đầu / đang sang hỗ trợ tổ khác, và có tick sẵn không.
        "nguoi_ghi": ung_vien_ghi(db, cv, [pc.employee_id for pc in roster], hom_nay()),
        "san_luong": {
            "tong_tot": _tong_tot_cv,
            "da_giao": sl.tong_da_giao(cv.id),
            # Mục tiêu bước + thực nhận + còn thiếu (§2.3) — dẫn xuất, chỉ để BÀY, không đổi
            # cổng đóng nhóm.
            "muc_tieu": _muc_tieu_cv,
            "thuc_nhan": _thuc_nhan_cv,
            "con_thieu": _con_thieu_cv,
            **_nhan_loi_cv,
            "don_vi": cv.don_vi_ra,
            "batches": [
                {
                    "id": b.id,
                    # Cửa sổ mẻ là mốc THỰC THI (UTC thật từ mg 0298 — trước đó tổ gõ giờ tường
                    # rồi bị dán nhãn UTC, lệch đúng 7 tiếng so với phiên chạy/chấm công).
                    "bat_dau": thuc_te_hien_thi(b.bat_dau),
                    "ket_thuc": thuc_te_hien_thi(b.ket_thuc),
                    "tong": float(b.tong),
                    "tot": float(b.tot),
                    "hong": float(b.hong),
                    "don_vi": b.don_vi,
                    "mo_ta_loi": b.mo_ta_loi,
                    "ghi_chu": b.ghi_chu,
                    "version": b.version,
                    "may_ten": next(
                        (phien_may_ten.get(p.may_id or 0) for p in _phien_giao_me(phien_rows, b)
                         if p.may_id), None),
                    "ca_ten": _ca_cua(ca_list, b.bat_dau),
                    "su_co": [
                        {"bat_dau": thuc_te_hien_thi(tu), "ket_thuc": thuc_te_hien_thi(den),
                         "ly_do": ly_do}
                        for tu, den, ly_do in _dung_giao_me(lan_dung, b)
                    ],
                    "nguoi_tham_gia": (nguoi_me := _nguoi_me(b.id)),
                    "so_nguoi": len(nguoi_me),
                    "da_ban_giao": b.id in me_da_giao,
                    # Việc khoán của mẻ = ẢNH CHỤP lúc ghi, KHÔNG tra danh mục sống: mẻ là chứng
                    # từ, phải đọc lại đúng bối cảnh của nó. Danh mục đổi thì băng dưới nói, và
                    # chỉ đổi khi NGƯỜI bấm (§7.2b).
                    "viec_khoan_id": b.khoan_cong_doan_id or b.piece_rate_id,
                    "viec_khoan_ten": b.ten_khoan_snapshot,
                    "viec_khoan_don_vi": b.don_vi_khoan_snapshot,
                    "viec_khoan_don_vi_ten": nhan_don_vi(dv_me_ten, b.don_vi_khoan_snapshot)
                    if b.don_vi_khoan_snapshot else None,
                    "viec_khoan_don_gia": (float(b.don_gia_khoan_snapshot)
                                           if b.don_gia_khoan_snapshot is not None else None),
                    "phat_sinh": [
                        {
                            "id": r.id,
                            "phat_sinh_id": r.phat_sinh_id,
                            "so_luong": float(r.so_luong),
                            "ten": r.ten_snapshot,
                            "don_vi": r.don_vi_snapshot,
                            "don_vi_ten": nhan_don_vi(dv_me_ten, r.don_vi_snapshot)
                            if r.don_vi_snapshot else None,
                            "don_gia": (float(r.don_gia_snapshot)
                                        if r.don_gia_snapshot is not None else None),
                        }
                        for r in ps_map.get(b.id, [])
                    ],
                    "danh_muc_doi": viec_khoan.danh_muc_doi(
                        db, b, ps_map.get(b.id, []), department_id=cv.department_id,
                        nap=nap_dmd),
                    "lot_vao": [
                        {
                            "id": lot.id,
                            "nguon_batch_id": lot.nguon_batch_id,
                            "so_luong": float(lot.so_luong),
                            "don_vi": lot.don_vi,
                        }
                        for lot in lot_map.get(b.id, [])
                    ],
                }
                for b in batches
            ],
        },
        "ban_giao_di": [
            _bg_dict(b, b.dich_cong_viec_id, doi_tac_map, me_map, ten_bg, ben_map)
            for b in bg_di
        ],
        "ban_giao_den": [
            _bg_dict(b, b.nguon_cong_viec_id, doi_tac_map, me_map, ten_bg, ben_map)
            for b in bg_den
        ],
        # Đầu vào theo routing (19/09/2026, `dau_vao`): công đoạn trước + trần ghi mẻ + còn thiếu
        # nguồn nào thì chưa bắt đầu được — cùng hàm máy chủ dùng để CHẶN, drawer chỉ bày lại.
        "cong_doan_truoc": dau_vao.cong_doan_truoc(db, sl, cv),
        "tran_ghi": (
            {**t, "da_ghi": _tong_tot_cv, "con_ghi_duoc": max(0.0, t["toi_da"] - _tong_tot_cv)}
            if (t := dau_vao.tran_ghi(db, cv, repo=sl)) else None
        ),
        "thieu_dau_vao": dau_vao.thieu_dau_vao(sl, cv),
        "ban_giao_chang_sau": [
            {
                "cong_viec_id": c.id,
                "ten_cong_doan": c.ten_cong_doan,
                "to_id": c.department_id,
                "to_ten": chang_sau_to_ten.get(c.department_id) if c.department_id else None,
                "du_kien_bat_dau": lich_hien_thi(c.du_kien_bat_dau),
                "phan_doan_so": c.phan_doan_so,
                "phan_doan_tong": c.phan_doan_tong,
                "loai_buoc": c.loai_buoc,
                "nha_cung_cap": c.nha_cung_cap,
                "trang_thai": c.trang_thai,
            }
            for c in chang_sau
        ],
        "vat_tu": [
            {
                "voucher_id": v.id,
                "ma": v.ma,
                "request_id": v.request_id,
                "xuat_luc": thuc_te_hien_thi(v.ghi_so_luc) if v.ghi_so_luc else None,
                "nguoi_xuat": _nguoi_xuat.get(v.nguoi_ghi_so_id or v.nguoi_lap_id),
            }
            for v in vouchers
        ],
        "vat_tu_cap": vat_tu_cap,
    }
