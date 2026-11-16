"""Real-time event hub (SSE) — luồng "gửi duyệt" nội bộ đẩy tức thì.

Nguyên tắc sản phẩm (CLAUDE.md): gửi/thông báo NỘI BỘ phải REAL-TIME.

Hai chế độ, chọn theo `REDIS_URL`, API của hub giữ nguyên nên mọi chỗ gọi `publish/broadcast`
không phải sửa dòng nào:

  - **Không có Redis** (test, máy dev): đẩy IN-PROCESS: mọi kết nối SSE nằm chung 1 tiến trình
    nên 1 dict trong RAM là đủ. Ràng buộc: đúng **1 uvicorn worker**.
  - **Có Redis**: `publish/broadcast` bắn lên channel `svn:events`, mỗi worker `SUBSCRIBE` rồi
    bơm vào subscriber cục bộ của mình → chạy được **nhiều worker**. Redis chớp tắt thì rơi về
    đẩy cục bộ (người cùng worker vẫn nhận) và tự nối lại.

GỬI THEO ĐỐI TƯỢNG (`gui`, 28/09/2026 — audit sức chịu tải A3). `broadcast` tới MỌI kết nối làm
mọi màn đang mở của cả công ty nạp lại theo từng cú bấm của bất kỳ ai: 200 người mở app, một
người ghi mẻ là 200 × (số màn nghe) request dội về máy chủ. `gui(event, quyen=…, to=…, nguoi=…)`
chỉ giao cho kết nối của người CÓ quyền xem module liên quan / tổ liên quan / đích danh.

Lọc ở phía NHẬN, không hỏi DB mỗi lần gửi: mỗi kết nối SSE mang theo bộ quyền của người đó
(`subscribe(…, quyen=…)`, nạp lúc nối — `doi_tuong_nhan.nap_quyen_nhan`). Một gói tin Redis cho
mỗi sự kiện dù bao nhiêu người nhận; worker nào có kết nối khớp thì giao. Kết nối không khai bộ
quyền (None) nhận hết — an toàn hơn là lọt mất tin. Quyền đổi (`quyen_doi`) ⇒ kết nối đó bị đánh
dấu cần nạp lại bộ quyền (luồng SSE tự nạp ở nhịp kế tiếp).

An toàn luồng: endpoint SYNC của FastAPI chạy trong threadpool, KHÔNG phải thread của event loop.
`asyncio.Queue` không thread-safe → mọi thao tác đẩy được lịch qua `loop.call_soon_threadsafe` để
chạy trên loop. `set_loop()` gọi 1 lần lúc startup (main.py). Nếu chưa có loop (vd test) → no-op.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import Iterable
from typing import Any

# Mọi worker cùng nghe một channel; `user_id = None` nghĩa là broadcast (hoặc gửi theo `dich`).
CHANNEL = "svn:events"

# Người nhận bị rớt tin (hàng đợi đầy — mạng chậm, tab ngủ) ⇒ giao diện tự nạp lại badge + màn
# đang mở thay vì tin rằng mình đang đủ tin.
SU_KIEN_DONG_BO_LAI = "dong_bo_lai"
_SU_KIEN_QUYEN_DOI = "quyen_doi"

# Redis chết thì thử lại sau ngần này giây — đừng để mất hẳn kênh đẩy chỉ vì một cú chớp mạng.
_RECONNECT_DELAY = 2.0


class EventHub:
    def __init__(self) -> None:
        # user_id -> tập hàng đợi (1 người có thể mở nhiều tab).
        self._subs: dict[int, set[asyncio.Queue]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._redis: Any = None
        # Giữ tham chiếu task đang bay, nếu không Python có thể thu gom giữa chừng.
        self._pending: set[asyncio.Task] = set()
        # hàng đợi -> bộ quyền của người giữ kết nối (None = chưa biết ⇒ nhận hết).
        self._quyen: dict[asyncio.Queue, frozenset[str] | None] = {}
        # Kết nối cần nạp lại bộ quyền (vừa nhận `quyen_doi`).
        self._can_nap_lai: set[asyncio.Queue] = set()

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def connect_redis(self, url: str) -> None:
        """Bật chế độ pub/sub. Gọi lúc startup khi có REDIS_URL (main.py)."""
        import redis.asyncio as redis  # import trễ: không có Redis thì khỏi cần thư viện

        self._redis = redis.from_url(url, decode_responses=True)

    @property
    def uses_redis(self) -> bool:
        return self._redis is not None

    # --- phía SSE endpoint (chạy trên loop) -----------------------------------
    def subscribe(self, user_id: int, *, quyen: frozenset[str] | None = None) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._subs.setdefault(user_id, set()).add(q)
        self._quyen[q] = quyen
        return q

    def cap_nhat_quyen(self, q: asyncio.Queue, quyen: frozenset[str] | None) -> None:
        self._quyen[q] = quyen
        self._can_nap_lai.discard(q)

    def can_nap_lai_quyen(self, q: asyncio.Queue) -> bool:
        return q in self._can_nap_lai

    def unsubscribe(self, user_id: int, q: asyncio.Queue) -> None:
        subs = self._subs.get(user_id)
        if subs is not None:
            subs.discard(q)
            if not subs:
                self._subs.pop(user_id, None)
        self._quyen.pop(q, None)
        self._can_nap_lai.discard(q)

    # --- phía publisher (có thể chạy trong threadpool → schedule lên loop) -----
    def publish(self, user_id: int, event: dict[str, Any]) -> None:
        """Đẩy 1 sự kiện tới MỌI kết nối của 1 người dùng."""
        self._dispatch(user_id, event)

    def broadcast(self, event: dict[str, Any]) -> None:
        """Đẩy 1 sự kiện tới MỌI kết nối đang mở. Hầu như không nơi nào nên dùng — xem `gui`."""
        self._dispatch(None, event)

    def gui(
        self,
        event: dict[str, Any],
        *,
        quyen: Iterable[str] | None = None,
        to: Iterable[int] | None = None,
        nguoi: Iterable[int] | None = None,
    ) -> None:
        """Đẩy 1 sự kiện tới người CÓ LIÊN QUAN: xem được một trong các module `quyen`, HOẶC xem được
        một trong các tổ `to` (Bàn tổ), HOẶC có tên trong `nguoi`. Ba vế hợp lại (phép HOẶC).

        Không truyền vế nào = broadcast. Vế rỗng (vd tổ không xác định) thì chỉ còn các vế khác —
        cả ba rỗng là KHÔNG ai nhận, đúng nghĩa "không có đối tượng"."""
        if quyen is None and to is None and nguoi is None:
            self._dispatch(None, event)
            return
        dich = {
            "quyen": sorted({str(k) for k in quyen or ()}),
            "to": sorted({int(t) for t in to or () if t is not None}),
            "nguoi": sorted({int(u) for u in nguoi or () if u is not None}),
        }
        self._dispatch(None, event, dich)

    # --- nội bộ ---------------------------------------------------------------
    def _dispatch(self, user_id: int | None, event: dict[str, Any], dich: dict | None = None) -> None:
        if self._redis is None:
            self._schedule(lambda: self._deliver_local(user_id, event, dich))
            return
        self._schedule(lambda: self._spawn(self._publish_redis(user_id, event, dich)))

    def _deliver_local(self, user_id: int | None, event: dict[str, Any],
                       dich: dict | None = None) -> None:
        """Bơm vào subscriber của CHÍNH tiến trình này (chạy trên loop)."""
        if user_id is not None:
            qs = self._subs.get(user_id, ())
            if event.get("type") == _SU_KIEN_QUYEN_DOI:
                self._can_nap_lai.update(qs)
            self._put(qs, event)
            return
        if dich is None:
            for qs in list(self._subs.values()):
                self._put(qs, event)
            return
        quyen = set(dich.get("quyen") or ())
        to = {f"to:{t}" for t in dich.get("to") or ()}
        nguoi = set(dich.get("nguoi") or ())
        for uid, qs in list(self._subs.items()):
            if uid in nguoi:
                self._put(qs, event)
            else:
                self._put([q for q in qs if self._khop(q, quyen, to)], event)

    def _khop(self, q: asyncio.Queue, quyen: set[str], to: set[str]) -> bool:
        cua_nguoi = self._quyen.get(q)
        if cua_nguoi is None:
            return True
        return not cua_nguoi.isdisjoint(quyen) or not cua_nguoi.isdisjoint(to)

    async def _publish_redis(self, user_id: int | None, event: dict[str, Any],
                             dich: dict | None = None) -> None:
        payload = json.dumps({"user_id": user_id, "dich": dich, "event": event}, default=str)
        try:
            await self._redis.publish(CHANNEL, payload)
        except Exception:
            # Redis hỏng: ít nhất người dùng cùng worker vẫn nhận được — đẩy cục bộ bù.
            self._deliver_local(user_id, event, dich)

    async def run_redis_bridge(self) -> None:
        """Task nền: nghe channel rồi bơm vào subscriber cục bộ. Chạy suốt vòng đời app.

        Sự kiện do CHÍNH worker này publish cũng quay về qua đây — một đường giao duy nhất,
        không phải phân nhánh 'của mình' / 'của worker khác'.
        """
        while True:
            pubsub = None
            try:
                pubsub = self._redis.pubsub()
                await pubsub.subscribe(CHANNEL)
                async for message in pubsub.listen():
                    if message.get("type") != "message":
                        continue
                    try:
                        payload = json.loads(message["data"])
                    except (ValueError, TypeError):
                        continue  # rác trên channel không được làm chết cầu nối
                    self._deliver_local(payload.get("user_id"), payload.get("event") or {},
                                        payload.get("dich"))
            except asyncio.CancelledError:
                raise
            except Exception:
                await asyncio.sleep(_RECONNECT_DELAY)
            finally:
                if pubsub is not None:
                    try:
                        await pubsub.aclose()
                    except Exception:
                        pass

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    @staticmethod
    def _put(queues, event: dict[str, Any]) -> None:
        for q in list(queues):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # Người nhận quá chậm (mạng yếu, tab ngủ): 200 tin dồn lại thì từng tin cũng hết
                # nghĩa. Bỏ cả hàng, để lại MỘT tin "đồng bộ lại" — giao diện tự nạp lại badge +
                # màn đang mở. Trước đây lặng lẽ bỏ tin mới: badge đứng số cũ tới khi F5.
                while True:
                    try:
                        q.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                q.put_nowait({"type": SU_KIEN_DONG_BO_LAI})

    def _schedule(self, fn) -> None:
        loop = self._loop
        if loop is None:
            return  # chưa có loop (test/headless) → no-op, không vỡ luồng nghiệp vụ
        try:
            loop.call_soon_threadsafe(fn)
        except RuntimeError:
            # loop đã đóng (đang shutdown) → bỏ qua.
            pass


# Singleton dùng chung toàn app.
hub = EventHub()


def phat_ban_giao(res: dict) -> None:
    """Bàn giao đổi trạng thái → refresh CẢ hai bàn tổ (nguồn + đích) + đẩy tới người cần hành động.

    Dùng chung cho MỌI cửa ghi bàn giao — bàn tổ (`routers/san_xuat.py`) và Phiếu giao của Thuê
    gia công đều gọi vào đây, không đẻ bản thứ hai (một gói mang cả
    hai tổ `team_ids`, không phải mỗi tổ một gói: `broadcast` tới MỌI kết nối và mỗi gói bump tick
    chung ở FE, nên hai gói là mọi màn đang mở nạp lại hai lượt cho một cú bấm — đo 16/09/2026 ở
    bàn tổ: danh sách việc ×3, hộp thư kho ×2, chờ xác nhận ×2 cho một Đề xuất)."""
    from .doi_tuong_nhan import MAN_THEO_LENH

    teams = sorted({t for t in (res.get("nguon_department_id"), res.get("dich_department_id")) if t})
    if teams:
        hub.gui({
            "type": "san_xuat_ban_giao_changed",
            "team_ids": teams,
            "ban_giao_id": res.get("ban_giao_id"),
            "trang_thai": res.get("trang_thai_ban_giao"),
        }, quyen=MAN_THEO_LENH, to=teams)
    for uid in res.get("notify_user_ids") or []:
        hub.publish(uid, {
            "type": "san_xuat_ban_giao",
            "ban_giao_id": res.get("ban_giao_id"),
            "trang_thai": res.get("trang_thai_ban_giao"),
            "su_kien": res.get("su_kien"),
            "nguon_ten": res.get("nguon_ten"),
            "dich_ten": res.get("dich_ten"),
            "so_luong": res.get("so_luong"),
            "don_vi": res.get("don_vi"),
            "lsx_ma": res.get("lsx_ma"),
        })


def phat_dong_lenh(ket: dict) -> None:
    """KCS vừa đóng / mở lại lệnh (cả nhóm thành phẩm) → mọi màn bày lệnh refresh + báo Sale/Kế
    hoạch NGAY (§17). Gửi theo QUYỀN: người xem sản xuất (gồm bàn tổ, KCS, xếp lịch, kế hoạch SX) /
    bán hàng / giao hàng."""
    from .doi_tuong_nhan import BAN_TO, MAN_BAN_HANG, MAN_GIAO_HANG, MAN_THEO_LENH, hop

    hub.gui({
        "type": "san_xuat_lenh_dong",
        "nhom_id": ket.get("nhom_id"),
        "order_id": ket.get("order_id"),
        "kieu": ket.get("kieu"),
        "lenh_ma": ket.get("lenh_ma") or [],
        "da_dat": ket.get("da_dat"),
        "muc_tieu": ket.get("muc_tieu"),
        "don_vi": ket.get("don_vi") or "",
    }, quyen=hop(MAN_THEO_LENH, MAN_BAN_HANG, MAN_GIAO_HANG, (BAN_TO,)))
