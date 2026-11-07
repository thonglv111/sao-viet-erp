"""Bộ quyền NHẬN TIN của một người — để hub SSE chỉ giao sự kiện cho người có liên quan.

Xem `realtime.EventHub.gui`. Bộ quyền nạp MỘT lần lúc nối SSE (và nạp lại khi quyền đổi), không
phải mỗi lần gửi: gửi là việc nóng (mỗi cú bấm), nối là việc thưa.

Gồm:
  · khoá module người đó XEM được (`role_permissions.can_read`) — cùng nguồn với menu, nên ai thấy
    màn nào thì nhận tin của màn đó;
  · `to:<id>` cho mỗi tổ người đó xem được ở Bàn tổ (trọn tổ hoặc chỉ việc của mình) — tính theo
    cây phòng ban như `services/quyen_to`, kể cả quyền kế thừa từ nút cha;
  · khoá GIẢ `BAN_TO` cho cổng FE không phải một ô quyền (có Xem ở ít nhất một dòng quyền tổ —
    `coQuyenBanTo`). Màn KCS nay là ô thật `kcs` (09/10/2026), không cần khoá giả.

Phần dưới là TẬP MÀN NGHE theo nhóm sự kiện, chép theo FE: `lib/suKienNhom.ts` (loại → nhóm) và
`AppShell.renderContent` (màn nào nhận `tickCua(nhóm…)`), mỗi màn quy về khoá module gác nó ở
`Sidebar.MODULES_BY_NAV_ID`. Nơi gửi lấy HỢP các tập của những nhóm mà loại sự kiện đó nhích — thà
thừa một màn còn hơn một màn đứng số cũ (nội bộ = real-time). Đổi `tickCua` của màn nào ở FE thì
sửa tập tương ứng ở đây.
"""
from __future__ import annotations

from collections.abc import Iterable

from .db import SessionLocal

# --- Khoá GIẢ (không phải ô quyền trong ma trận) -------------------------------------------------
#: Có Xem ở ít nhất một dòng quyền tổ `to_sx_*` — cùng cổng `coQuyenBanTo` của FE (menu Tổ sản xuất,
#: badge tổ). Dùng khi sự kiện đụng bàn tổ mà không biết tổ nào.
BAN_TO = "ban_to"
#: Màn KCS — dòng `kcs` của ma trận vai (09/10/2026; trước là khoá giả theo phòng ban "Tổ KCS").
KCS = "kcs"

# --- Màn nghe theo NHÓM sự kiện (FE `suKienNhom.ts`) ----------------------------------------------
#: nhóm `ban_hang`: Báo giá · Đơn hàng bán · Giao hàng · Kế hoạch SX · Công nợ phải thu · Phiếu thu.
MAN_BAN_HANG = ("bao_gia", "don_hang_ban", "giao_hang", "san_xuat", "cong_no_phai_thu", "phieu_thu")
#: nhóm `mua_ke_toan`: drawer Đơn hàng bán (hoá đơn) · Yêu cầu mua hàng (menu mở cho cả bao_gia, kho,
#: san_xuat, dm_giay, ke_toan) · Mua hàng · Nhà cung cấp · Đơn mua hàng (kế toán) · Phiếu chi ·
#: Công nợ phải trả · Công nợ phải thu · Phiếu thu.
MAN_MUA_KE_TOAN = (
    "don_hang_ban", "yeu_cau_mua_hang", "bao_gia", "kho", "san_xuat", "dm_giay", "ke_toan",
    "thu_mua", "nha_cung_cap", "phieu_chi", "cong_no_phai_tra", "cong_no_phai_thu", "phieu_thu",
)
#: nhóm `nhan_su`: Chấm công · Nghỉ phép · Tăng ca · Lương.
MAN_NHAN_SU = ("cham_cong", "nghi_phep", "tang_ca", "luong")
#: nhóm `san_xuat` TRỪ bàn tổ: KCS · drawer Đơn hàng bán (tiến độ) · Kế hoạch SX · Hồ sơ lệnh SX ·
#: Theo dõi SX · Kế hoạch vật tư · Bài ghép · Xếp lịch. Bàn tổ thêm riêng bằng `to=` / `BAN_TO`.
MAN_THEO_LENH = (
    KCS, "don_hang_ban", "san_xuat", "lenh_san_xuat", "theo_doi_san_xuat", "ke_hoach_vat_tu",
    "bai_ghep_2", "xep_lich", "ke_hoach_bo_phan",
)
#: nhóm `kho` TRỪ bàn tổ: Yêu cầu nhập xuất · KCS · drawer Đơn hàng bán · Kế hoạch vật tư.
MAN_KHO = ("kho", KCS, "don_hang_ban", "ke_hoach_vat_tu")
#: nhóm `giao_hang`: Giao hàng · drawer Đơn hàng bán.
MAN_GIAO_HANG = ("don_hang_ban", "giao_hang")
#: nhóm `khvt`: Kế hoạch SX (đèn vật tư) · Kế hoạch vật tư.
MAN_KHVT = ("san_xuat", "ke_hoach_vat_tu")
#: Nhật ký — tick RIÊNG (`nhatKyTick`), không thuộc nhóm nào.
MAN_NHAT_KY = ("activity_log",)
#: nhóm `danh_muc`: màn phiếu tính giá đang mở (nạp lại danh mục nguồn + lời nhắc "danh mục đã đổi").
MAN_DANH_MUC = ("tinh_gia_thanh",)


def hop(*tap: Iterable[str]) -> list[str]:
    """Hợp các tập màn nghe — đầu vào của `hub.gui(quyen=…)`."""
    ra: set[str] = set()
    for t in tap:
        ra.update(t)
    return sorted(ra)


#: Lệnh / đơn xuống sản xuất đổi (`lsx_changed`, `order_ordered`, `order_sx_hint_changed`): FE nhích
#: nhóm `san_xuat` + `ban_hang` (+ `khvt`) và nạp badge Kế hoạch SX / Bài ghép / Xếp lịch. KHÔNG gồm
#: bàn tổ — bàn tổ chỉ bày công việc của gói ĐÃ phát hành; cửa phát hành / thu hồi tự thêm `BAN_TO`.
NGHE_LENH = hop(MAN_THEO_LENH, MAN_BAN_HANG, MAN_KHVT)


def kem_ban_to(quyen: Iterable[str], team_ids: Iterable[int | None]) -> dict:
    """Tham số `hub.gui` cho sự kiện đụng bàn tổ: biết tổ ⇒ `to=` đúng các tổ đó; không biết tổ nào
    (bước chung, thuê ngoài…) ⇒ mọi người có Bàn tổ (`BAN_TO`) — thiếu còn tệ hơn thừa."""
    teams = sorted({int(t) for t in team_ids if t})
    return {"quyen": hop(quyen, () if teams else (BAN_TO,)), "to": teams}


def nap_quyen_nhan(user_id: int) -> frozenset[str]:
    from .models.user import User
    from .repositories.quyen_to_repo import KHOA_TIEN_TO
    from .repositories.rbac_repo import RoleRepository
    from .services.quyen_to import VIEC_XEM, quyen_to_cua
    from .services.rbac_service import AuthorizationService

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None:
            return frozenset()
        khoa = set(AuthorizationService(RoleRepository(db)).readable_modules(user))
        if any(k.startswith(KHOA_TIEN_TO) for k in khoa):
            khoa.add(BAN_TO)
        if user.role_id is not None:
            q = quyen_to_cua(db, user)
            khoa.update(f"to:{t}" for t in q.tron[VIEC_XEM] | q.rieng[VIEC_XEM])
        return frozenset(khoa)
    finally:
        db.close()
