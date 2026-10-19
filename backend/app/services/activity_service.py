"""Activity-log read logic — màn Nhật ký hoạt động.

Đọc-only: dòng audit do các service khác ghi. Việc của tầng này là ba thứ mà trước 25/09/2026
frontend đang tự làm trên 100 dòng đã tải về (nên làm sai):

1. **Lọc + phân trang ở MÁY CHỦ** (`liet_ke`). Trần cứng 100 dòng đã bỏ; bộ lọc mặc định là 30
   ngày gần nhất và màn hiển thị đúng khoảng ngày đó ra ô chọn, không giấu.
2. **Nhãn tiếng Việt + nhóm** lấy từ `audit_registry` thay vì bảng khai tay ở frontend.
3. **Che dòng theo quyền**: `detail` của nhật ký chứa số tiền thật (giá gốc lô, tiền hoá đơn, đơn
   giá giờ máy). Ai không mở được màn sinh ra dòng thì không đọc dòng đó — nhưng SỐ DÒNG BỊ CHE
   được trả về để màn nói rõ, nhật ký không được nuốt im lặng.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone

from .. import audit_registry as reg
from ..repositories.loc_danh_sach import VN_TZ
from ..models.user import User
from ..repositories.audit_repo import AuditLogRepository, BoLoc
from ..repositories.employee_repo import EmployeeRepository
from ..repositories.user_repo import UserRepository
from .rbac_service import AuthorizationService

#: Cửa sổ mặc định khi người dùng không chọn khoảng ngày. Có hai lý do: (a) tìm chuỗi trong
#: `detail` mà không chặn ngày là quét cả bảng phình nhanh nhất hệ; (b) người mở màn hầu như luôn
#: hỏi "hôm nay/tuần này ai làm gì". Màn ĐỔ SẴN khoảng ngày này ra ô chọn nên không có gì bị giấu.
CUA_SO_MAC_DINH_NGAY = 30

TRAN_LIMIT = 200


_NV_ID = re.compile(r"employee_id=(\d+)")


# Vài màn ghi `detail` dạng JSON để màn của chúng tách cột (Điều chỉnh phiếu xuất, Tính giá kỳ kho).
# Nhật ký chung đọc ra câu — không in `{"noi_dung": …}` thô (#70).
_NHAN_KHOA_JSON = {"ly_do": "Lý do", "khoang_ngay": "Khoảng ngày", "ten_ky": "Tên kỳ"}


def _doc_json(s: str) -> str:
    if not s.startswith("{"):
        return s
    try:
        d = json.loads(s)
    except ValueError:
        return s
    if not isinstance(d, dict):
        return s
    phan = []
    for k, v in d.items():
        if v is None or v == "":
            continue
        nhan = _NHAN_KHOA_JSON.get(k)
        phan.append(f"{nhan}: {v}" if nhan else str(v))
    return ". ".join(phan) if phan else s


def _ten_tho(e, so: str) -> str:
    if e is None:
        return f"thợ #{so}"
    ma = (getattr(e, "code", None) or "").strip()
    return f"thợ {e.full_name} ({ma})" if ma else f"thợ {e.full_name}"


class ActivityService:
    def __init__(self, audit: AuditLogRepository, users: UserRepository,
                 authz: AuthorizationService | None = None) -> None:
        self.audit = audit
        self.users = users
        self.authz = authz

    # --- Quyền: dòng nào người này không được đọc ------------------------------------------
    def _chan(self, user: User | None) -> tuple[list[str], list[str]]:
        """(mã action bị chặn, loại danh mục bị chặn) cho người đang xem.

        Gác MỞ: dòng nào `audit_registry` không biết thuộc màn nào thì không chặn. Với nhật ký,
        che nhầm tệ hơn hở — nên chỉ che khi biết chắc màn nào sinh ra dòng và người xem không
        mở được màn ấy."""
        if user is None or self.authz is None:
            return [], []
        doc_duoc = set(self.authz.readable_modules(user))
        chan_action = [
            h.ma for h in reg.HANH_DONG if h.module and h.module not in doc_duoc
        ]
        chan_dm = [
            d.loai for d in reg.DANH_MUC if d.module not in doc_duoc
        ]
        # Tên loại đời cũ còn nằm trong `audit_logs` phải chặn cùng, không thì lịch sử cũ lọt.
        chan_dm += [
            alias for d in reg.DANH_MUC if d.module not in doc_duoc for alias in d.alias_loai
        ]
        return chan_action, chan_dm

    # --- Đọc -------------------------------------------------------------------------------
    def liet_ke(
        self,
        *,
        user: User | None = None,
        q: str | None = None,
        tu: datetime | None = None,
        den: datetime | None = None,
        actions: list[str] | None = None,
        actor_ids: list[int] | None = None,
        loais: list[str] | None = None,
        limit: int = 50,
        trang: int = 1,
        neo: str | None = None,
        tat_ca: bool = False,
    ) -> dict:
        loc = _bo_loc(q, tu, den, actions, actor_ids, loais, tat_ca=tat_ca)
        chan_action, chan_dm = self._chan(user)
        limit = max(1, min(int(limit or 50), TRAN_LIMIT))
        trang = max(1, int(trang or 1))

        rows, neo = self.audit.tim(
            loc, chan_action=chan_action, chan_dm=chan_dm, limit=limit, trang=trang, neo=neo
        )
        ket = {
            "items": self._dong(rows),
            "trang": trang,
            # Mốc ảnh chụp: màn gửi lại nguyên si ở mọi trang sau để xấp trang không trượt.
            "neo": neo,
            "tu": loc.tu,
            "den": loc.den,
            # Tổng phải trả ở MỌI trang, khác bản cursor trước đây: thanh phân trang đánh số
            # 1 · 2 · 3 … n cần biết `n`, không thể suy ra từ trang đang xem. Một COUNT trên cùng
            # mệnh đề WHERE, có index `(created_at)` cắt trước, nên rẻ.
            "tong": self.audit.dem(loc, chan_action=chan_action, chan_dm=chan_dm, neo=neo),
        }
        if trang == 1:
            # Số dòng bị che là COUNT thứ hai và không đổi khi lật trang ⇒ chỉ đếm ở trang đầu.
            ket["so_dong_bi_an"] = self.audit.dem_bi_chan(
                loc, chan_action=chan_action, chan_dm=chan_dm, neo=neo
            )
        return ket

    def _dong(self, rows) -> list[dict]:
        # Chỉ tra `users` cho những dòng CŨ chưa có tên chụp sẵn — dòng mới đọc thẳng từ cột.
        can_tra = {r.actor_user_id for r in rows if r.actor_user_id and not r.actor_name_luc_do}
        ten = self.users.map_by_ids(can_tra) if can_tra else {}
        # "employee_id=123" (phân công thợ ở bàn tổ) → tên thợ (#70). Giữ nguyên chuỗi gốc trong DB
        # vì lịch sử việc đọc ngược số đó; chỉ đổi lúc trình bày.
        nv_ids = {int(m) for r in rows for m in _NV_ID.findall(r.detail or "")}
        nv = EmployeeRepository(self.audit.db).map_by_ids(nv_ids) if nv_ids else {}

        def _chi_tiet(s: str | None) -> str | None:
            if not s:
                return s
            s = _doc_json(s)
            if not nv_ids:
                return s
            return _NV_ID.sub(lambda m: _ten_tho(nv.get(int(m.group(1))), m.group(1)), s)

        ra = []
        for r in rows:
            hd = reg.tra(r.action, r.target or "")
            u = ten.get(r.actor_user_id) if r.actor_user_id else None
            ra.append(
                {
                    "id": r.id,
                    "actor_user_id": r.actor_user_id,
                    # Tên CHỤP TẠI LÚC GHI đi trước: người đổi tên thì nhật ký cũ vẫn nói đúng
                    # tên lúc đó. Dòng cũ (trước mg `0336`) không có ⇒ tra ngược như trước.
                    "actor_name": r.actor_name_luc_do or (u.name if u else None),
                    "ip": r.ip or None,
                    "user_agent": r.user_agent or None,
                    "action": r.action,
                    "nhan": hd.nhan,
                    "nhom": hd.nhom,
                    "target": r.target,
                    "target_loai": (r.target or "").split(":", 1)[0] or None,
                    "target_nhan": reg.nhan_doi_tuong(r.target),
                    "detail": _chi_tiet(r.detail),
                    "created_at": r.created_at,
                }
            )
        return ra

    def danh_muc_hanh_dong(self, *, user: User | None = None,
                           q: str | None = None, tu: datetime | None = None,
                           den: datetime | None = None, tat_ca: bool = False) -> dict:
        """Danh mục cho hai dropdown + chip nhóm, ĐẾM theo khoảng ngày đang xem.

        Trước đây frontend sinh danh sách này từ 100 dòng đã tải ⇒ người/hành động không có mặt
        trong 100 dòng cuối thì không tồn tại để chọn."""
        loc = _bo_loc(q, tu, den, None, None, None, tat_ca=tat_ca)
        chan_action, chan_dm = self._chan(user)
        theo_action = self.audit.facet_action(loc, chan_action=chan_action, chan_dm=chan_dm)
        theo_actor = self.audit.facet_actor(loc, chan_action=chan_action, chan_dm=chan_dm)

        nhom_dem: dict[str, int] = {k: 0 for k, _ in reg.NHOM}
        hanh_dong = []
        for ma, n in sorted(theo_action, key=lambda x: -x[1]):
            hd = reg.tra(ma)
            nhom_dem[hd.nhom] = nhom_dem.get(hd.nhom, 0) + n
            hanh_dong.append({"ma": ma, "nhan": hd.nhan, "nhom": hd.nhom, "so_dong": n})

        ids = {a for a, _ in theo_actor if a}
        ten = self.users.map_by_ids(ids)
        nguoi = [
            {
                "id": a,
                "ten": (ten[a].name if a in ten else None) if a else None,
                "so_dong": n,
            }
            for a, n in sorted(theo_actor, key=lambda x: -x[1])
        ]
        return {
            "hanh_dong": hanh_dong,
            "nguoi": nguoi,
            "nhom": [
                {"khoa": k, "nhan": nhan, "so_dong": nhom_dem.get(k, 0)} for k, nhan in reg.NHOM
            ],
            # Loại đối tượng của khối danh mục, kèm nhãn + id mục menu để màn Nhật ký dịch
            # `giay:12` thành "Giấy #12" và bấm sang được đúng màn — thay vì in mã thô.
            "loai": [
                {"loai": d.loai, "nhan": d.nhan, "path": d.path} for d in reg.DANH_MUC
            ],
            "tu": loc.tu,
            "den": loc.den,
        }

    def xuat(self, **kw):
        """Sinh từng dòng CSV theo ĐÚNG bộ lọc đang xem, lật trang ngầm — để endpoint xuất stream
        chứ không dựng cả tệp trong RAM. Neo của trang đầu đi theo suốt lượt xuất: thao tác diễn ra
        trong lúc đang tải tệp không chen vào giữa làm lặp dòng."""
        neo = None
        so = 1
        while True:
            trang = self.liet_ke(limit=TRAN_LIMIT, trang=so, neo=neo, **kw)
            for d in trang["items"]:
                yield d
            if len(trang["items"]) < TRAN_LIMIT:
                return
            neo = trang["neo"]
            so += 1

    # --- Tương thích ngược: đường cũ, còn test/màn khác gọi --------------------------------
    def list_recent(self, limit: int = 100) -> list[dict]:
        return self._dong(self.audit.list_recent(limit))


def doc_moc_ky(s: str | None, *, cuoi: bool) -> datetime | None:
    """Một đầu của kỳ trên thanh lọc (06/10/2026: `tu_ngay` / `den_ngay` như mọi danh sách khác).

    Chuỗi NGÀY `YYYY-MM-DD` là một ngày theo giờ Việt Nam: đầu kỳ = 00:00 VN, cuối kỳ = hết
    23:59:59.999999 VN — cùng ranh với `dk_khoang_ngay`. Chuỗi có giờ (đường cũ, link cũ) vẫn
    nhận nguyên như trước. Sai định dạng ⇒ `ValueError` (router đổi thành 422)."""
    if s is None or not s.strip():
        return None
    s = s.strip()
    if len(s) == 10:
        d = date.fromisoformat(s)
        if cuoi:
            d += timedelta(days=1)
        dau = datetime(d.year, d.month, d.day, tzinfo=VN_TZ).astimezone(timezone.utc)
        return dau - timedelta(microseconds=1) if cuoi else dau
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _bo_loc(q, tu, den, actions, actor_ids, loais, *, tat_ca: bool = False) -> BoLoc:
    """`tat_ca` = người dùng chọn kỳ "Tất cả" trên thanh lọc ⇒ bỏ cửa sổ 30 ngày mặc định (chỉ
    áp khi không ai nói gì về đầu kỳ)."""
    den = den or datetime.now(timezone.utc)
    if tu is None and not tat_ca:
        tu = den - timedelta(days=CUA_SO_MAC_DINH_NGAY)
    return BoLoc(
        q=(q or "").strip() or None,
        tu=tu,
        den=den,
        actions=[a for a in (actions or []) if a],
        actor_ids=[int(a) for a in (actor_ids or [])],
        loais=[l for l in (loais or []) if l],
    )
