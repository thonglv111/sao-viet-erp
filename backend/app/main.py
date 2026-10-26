"""FastAPI application entrypoint.

Creates the app, applies CORS, mounts routers, and on startup initializes the
schema (create_all) + seeds the admin user. Run with:
    uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from . import khoi_dong
from .bat_loi_chung import BatLoiChung
from .config import assert_secure_config, settings
from .cong_dong_thoi import CongDongThoi, gioi_han_mac_dinh
from .db import SessionLocal
from .services import su_kien_danh_muc  # noqa: F401 — đăng ký listener SSE "danh mục đã đổi"
from .routers import (
    accounting,
    module_notifications,
    auth,
    attendance,
    calendar,
    leaves,
    late_early,
    overtime,
    payroll,
    customers,
    employees,
    files,
    machines,
    operations,
    purchases,
    noi_quy,
    profile,
    quotations,
    orders,
    bao_cao_kinh_doanh,
    rbac,
    may_thiet_bi,
    vat_lieu_kho,
    cong_doan,
    xe,
    don_vi_do,
    bien_cong_thuc,
    kho,
    kho_baocao,
    delivery,
    kho_request,
    kho_voucher,
    public_scan,
    khuon_be,
    danh_muc_xoa,
    nhat_ky_danh_muc,
    nhom_dung_chung,
    notifications,
    tinh_gia,
    phieu_tinh_gia,
    lsx,
    bai_ghep_2,
    xep_lich,
    ke_hoach_vat_tu,
    ky_thuat_may,
    san_xuat,
    san_xuat_kcs_tieu_chi,
    cong_doan_tag,
    lenh_san_xuat,
    theo_doi_san_xuat,
    tai_san,
    muc_thu_chi,
    bao_cao_thu_chi,
    gia_cong_ngoai,
)

# File người dùng tải lên KHÔNG còn mount công khai ở /static — chúng đi qua kho file
# (app/storage.py) và chỉ đọc được qua /api/files sau khi kiểm đăng nhập + quyền
# (app/routers/files.py). Mount cũ là lỗ hở: ai có URL là xem được CCCD/hợp đồng/chứng từ.


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Real-time SSE hub: ghim event loop đang chạy để publisher (endpoint sync trong threadpool) đẩy
    # sự kiện an toàn qua call_soon_threadsafe (app/realtime.py).
    from .realtime import hub
    hub.set_loop(asyncio.get_running_loop())
    # Có REDIS_URL → đẩy qua pub/sub, chạy được nhiều worker. Không có → in-process, 1 worker.
    if settings.redis_url:
        hub.connect_redis(settings.redis_url)
    # Refuse to boot in production with an insecure JWT secret (no-op in development).
    assert_secure_config(settings)
    # Schema + seed + bucket: `serve.py` đã làm MỘT lần trước khi bật các worker thì bỏ qua ở đây
    # (N worker cùng migrate là đua khoá DDL). Chạy thẳng uvicorn (dev/test) thì làm như cũ.
    if not khoi_dong.schema_da_san():
        khoi_dong.chuan_bi()
    else:
        await khoi_dong.cho_schema_san()
    # Ticker nhắc lịch hẹn chăm sóc real-time (SSE): quét hẹn tới giờ → "ting" người phụ trách.
    # 0 = tắt (test). Chạy nền, huỷ khi shutdown. Nhiều worker thì mỗi vòng chỉ MỘT worker giành
    # được quyền chạy (`locks.chay_mot_noi`) — các worker còn lại ngủ tiếp.
    reminder_task: asyncio.Task | None = None
    bao_tri_task: asyncio.Task | None = None
    don_dep_task: asyncio.Task | None = None
    don_tep_task: asyncio.Task | None = None
    phieu_luong_task: asyncio.Task | None = None
    if settings.care_reminder_seconds > 0:
        from .care_reminders import run_care_reminder_loop
        reminder_task = asyncio.create_task(run_care_reminder_loop(settings.care_reminder_seconds))
        # Nhắc phiếu bảo trì tới hạn — dùng chung công tắc `care_reminder_seconds` (0 = tắt trong
        # test). Quét thưa hơn 10 lần: hẹn khách tính bằng phút, còn bảo trì tính bằng NGÀY, quét
        # dày chỉ tốn vòng lặp chứ không sớm hơn được phút nào.
        from .bao_tri_reminders import run_bao_tri_reminder_loop
        bao_tri_task = asyncio.create_task(
            run_bao_tri_reminder_loop(max(60, settings.care_reminder_seconds * 10))
        )
        # Phiếu lương hẹn giờ công bố: tới giờ mở thì báo từng người (#39) — cùng nhịp nhắc hẹn.
        from .services.phieu_luong_mo import run_phieu_luong_mo_loop
        phieu_luong_task = asyncio.create_task(
            run_phieu_luong_mo_loop(settings.care_reminder_seconds)
        )
        # Dọn refresh token quá hạn mỗi giờ (thay cho quét ở mỗi lượt đăng nhập).
        from .don_dinh_ky import run_don_dep_loop
        don_dep_task = asyncio.create_task(run_don_dep_loop())
        if settings.don_tep_mo_coi:
            from .don_dinh_ky import run_don_tep_loop
            don_tep_task = asyncio.create_task(run_don_tep_loop())
    # Cầu Redis→SSE: nghe channel chung, bơm sự kiện vào các kết nối của worker này.
    bridge_task: asyncio.Task | None = None
    if hub.uses_redis:
        bridge_task = asyncio.create_task(hub.run_redis_bridge())
    try:
        yield
    finally:
        for task in (reminder_task, bao_tri_task, don_dep_task, don_tep_task, phieu_luong_task, bridge_task):
            if task is not None:
                task.cancel()


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

# Vết người gọi (IP + thiết bị) cho nhật ký + cổng giới hạn số request chạy cùng lúc — xem
# `app/cong_dong_thoi.py`. Khai TRƯỚC CORS để CORS nằm NGOÀI cùng: câu 503 "máy chủ đang bận" vẫn
# mang header CORS, FE khác origin (dev :5173) đọc được thay vì thấy lỗi CORS khó hiểu.
app.add_middleware(
    CongDongThoi,
    gioi_han=gioi_han_mac_dinh(),
    cho_toi_da=settings.cho_hang_doi_giay,
)
# Lỗi 500 chưa bắt trả JSON từ trong CORS — xem `app/bat_loi_chung.py`. Cũng khai TRƯỚC CORS.
app.add_middleware(BatLoiChung)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # `allow_headers` ở trên là header của REQUEST (những gì trình duyệt được phép GỬI lên) — không
    # liên quan gì tới header của RESPONSE. Mặc định CORS giấu MỌI response header khỏi JS ngoài
    # một danh sách an toàn nhỏ (không có `Content-Disposition`), nên FE ở origin khác (`:5173` lúc
    # dev so với API `:8000`) gọi `resp.headers.get("Content-Disposition")` luôn nhận `null` dù
    # server đã gửi đúng header — bug Task 14 (N28) dính đúng chỗ này. Khai riêng để trình duyệt
    # PHÁT `Access-Control-Expose-Headers` cho JS đọc được.
    expose_headers=["Content-Disposition"],
)


app.include_router(auth.router)
app.include_router(files.router)
app.include_router(profile.router)
app.include_router(noi_quy.router)
app.include_router(rbac.router)
app.include_router(nhom_dung_chung.router)
app.include_router(customers.router)
app.include_router(employees.router)
app.include_router(attendance.router)
app.include_router(calendar.router)
app.include_router(leaves.router)
app.include_router(overtime.router)
app.include_router(late_early.router)
app.include_router(payroll.router)
app.include_router(quotations.router)
app.include_router(orders.router)
app.include_router(bao_cao_kinh_doanh.router)
app.include_router(purchases.router)
app.include_router(accounting.router)
app.include_router(module_notifications.router)
app.include_router(machines.router)
app.include_router(operations.router)
# Gỡ (2026-07-16): products · plate_die_rates · norms — không màn nào gọi, module quyền đã bỏ
# (migration 0069). Gỡ (2026-08-08, Đợt 5): materials · costings · estimates — cụm tính giá đời cũ
# đã xoá hẳn. Bảng norms/plate_die_rates GIỮ: engine tính giá đang chạy vẫn đọc.
app.include_router(may_thiet_bi.router)
app.include_router(may_thiet_bi.nhom_may_router)   # danh mục Nhóm máy (cùng module quyền)
app.include_router(vat_lieu_kho.router)
app.include_router(cong_doan.router)
app.include_router(san_xuat_kcs_tieu_chi.router)   # danh mục Tiêu chí KCS (module quyền `dm_kcs_tieu_chi`)
app.include_router(xe.router)
app.include_router(don_vi_do.router)
app.include_router(bien_cong_thuc.router)
# Các router con của Kho phải đăng ký TRƯỚC `kho.router`: kho.router có `/api/kho/{kho_id}`
# (1 đoạn) nên sẽ nuốt `/api/kho/de-nghi` và `/api/kho/nguong-ton` nếu đứng trước —
# FastAPI khớp theo THỨ TỰ đăng ký, không theo độ cụ thể.
app.include_router(delivery.router)
app.include_router(kho_request.router)
app.include_router(kho_voucher.router)
app.include_router(kho_voucher.threshold_router)
# Điều chuyển kho: /api/kho/dieu-chuyen — path RIÊNG, đăng ký TRƯỚC kho.router (path 1 đoạn).
app.include_router(kho_voucher.dieu_chuyen_router)
# Báo cáo kho (kế toán): /api/kho/bao-cao/* + /api/kho/khoa-so — TRƯỚC kho.router (path 1 đoạn).
app.include_router(kho_baocao.router)
app.include_router(notifications.router)
# Router CÔNG KHAI (không auth) — trang tra kho khi quét tem QR. Mã ký HMAC chống dò id.
app.include_router(public_scan.router)
app.include_router(kho.router)
app.include_router(khuon_be.router)
app.include_router(nhat_ky_danh_muc.router)   # nhật ký 1 bản ghi — chung cho 11 màn danh mục
app.include_router(danh_muc_xoa.router)       # "còn ai dùng không" — chung cho 9 màn danh mục
app.include_router(tinh_gia.router)
app.include_router(phieu_tinh_gia.router)
app.include_router(lsx.router)
# Màn Bài ghép cũ gỡ 18/08/2026 (mg 0216) — router `/api/bai-ghep` xoá, chỉ còn bản này. ENGINE
# (`services/bai_ghep_service.py` + `repositories/bai_ghep_repo.py`) vẫn là của chung, đừng nhầm
# là code chết: router này chạy trên đó.
app.include_router(bai_ghep_2.router)
app.include_router(xep_lich.router)          # Xếp lịch — bàn cấp LỆNH, module quyền `xep_lich`
                                             # (bàn theo công đoạn `xep_lich_2` xoá hẳn 18/09/2026, mg 0314)
app.include_router(ke_hoach_vat_tu.router)   # bảng cân đối vật tư (cùng module quyền `san_xuat`)
app.include_router(ky_thuat_may.router)      # sửa chữa + phiếu bảo trì (module quyền `ky_thuat_may`)
app.include_router(san_xuat.router)          # bàn Thực hiện sản xuất tại tổ (cùng module quyền `san_xuat`)
app.include_router(cong_doan_tag.router)     # nhãn gán cho bước công đoạn — dùng chung LSX + Bài ghép (module quyền `san_xuat`)
app.include_router(lenh_san_xuat.router)    # màn Lệnh sản xuất (danh sách + KPI) — module quyền `lenh_san_xuat`, phạm vi theo NGƯỜI BÁN
app.include_router(theo_doi_san_xuat.router)  # màn Theo dõi sản xuất (Kanban) — module quyền `theo_doi_san_xuat`, cột lấy động từ danh mục cong_doan (Ruling C113)
app.include_router(gia_cong_ngoai.router)    # Gia công ngoài — cùng module quyền `san_xuat`
app.include_router(tai_san.router)            # sổ tài sản cố định + CCDC (module quyền `tai_san`; không còn kỳ chốt từ 08/09/2026)
app.include_router(muc_thu_chi.router)        # danh mục Mục thu chi (module quyền `dm_muc_thu_chi`)
app.include_router(bao_cao_thu_chi.router)    # Báo cáo thu chi theo mục × tháng (module quyền `bao_cao_thu_chi`)



def _thu_db() -> None:
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
    finally:
        db.close()


@app.get("/api/health", tags=["health"])
async def health() -> JSONResponse:
    """Sống THẬT = trả lời được VÀ nói chuyện được với DB. Healthcheck của compose + deploy dựa vào
    đây — trước chỉ trả `ok` cứng nên DB chết mà container vẫn "khoẻ".

    `async` + đẩy truy vấn sang threadpool có hạn giờ: đang đông người thì health vẫn không phải xếp
    hàng sau cả loạt request (nó cũng được miễn cổng đồng thời, xem `cong_dong_thoi.py`)."""
    try:
        await asyncio.wait_for(run_in_threadpool(_thu_db), timeout=3.0)
    except Exception:  # noqa: BLE001 — mọi kiểu hỏng đều là "DB không trả lời"
        return JSONResponse({"status": "loi", "db": "khong_tra_loi"}, status_code=503)
    return JSONResponse({"status": "ok", "db": "ok"})
