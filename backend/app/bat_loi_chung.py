"""Middleware ASGI THUẦN: lỗi chưa bắt (500) trả JSON từ BÊN TRONG CORS.

Không có lớp này thì 500 do `ServerErrorMiddleware` của Starlette trả — lớp đó nằm NGOÀI CORS nên
phản hồi thiếu header CORS. FE khác origin (dev :5173) bị trình duyệt chặn đọc, `client.ts` nhận
status 0 và báo "Không kết nối được máy chủ" thay cho lỗi máy chủ thật (bấm thử 25/10/2026, gốc
chung của L-SX-02, L-VAI-27).

Gửi 500 xong vẫn ném lại: uvicorn ghi traceback như cũ, TestClient vẫn thấy ngoại lệ.
"""
from __future__ import annotations

import json

_THAN_500 = json.dumps(
    {"detail": "Máy chủ gặp lỗi khi xử lý yêu cầu này. Thử lại, nếu vẫn lỗi thì báo quản trị."},
    ensure_ascii=False,
).encode("utf-8")


class BatLoiChung:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        da_gui = False

        async def gui(message) -> None:
            nonlocal da_gui
            if message["type"] == "http.response.start":
                da_gui = True
            await send(message)

        try:
            await self.app(scope, receive, gui)
        except Exception:
            # Phản hồi đã bắt đầu (luồng SSE, tải file) thì không chèn được gì nữa.
            if not da_gui:
                await send({
                    "type": "http.response.start", "status": 500,
                    "headers": [(b"content-type", b"application/json; charset=utf-8"),
                                (b"content-length", str(len(_THAN_500)).encode())],
                })
                await send({"type": "http.response.body", "body": _THAN_500})
            raise
