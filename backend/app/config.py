"""Application configuration.

Cross-cutting concern loaded once from the environment (never hard-coded secrets;
see docs/SECURITY.md). `DATABASE_URL` selects SQLite (local/test) or Postgres
(Docker/prod) against the same SQL layer.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Đường dẫn TUYỆT ĐỐI tới <backend>/.env. Nếu để ".env" tương đối, tiến trình chạy từ gốc repo
# (pytest, script) sẽ đọc nhầm `.env` của docker-compose — file đó khai biến cho tầng HẠ TẦNG
# (APP_ENV, POSTGRES_*, cổng). Đã vỡ thật: `.env` gốc mang APP_ENV=production làm mọi test dùng
# fixture `client` chết vì guard JWT_SECRET. Hai file, hai mục đích, không được lẫn vào nhau.
_BACKEND_ENV = Path(__file__).resolve().parents[1] / ".env"

# The well-known dev default. Convenient for zero-config local runs, but it is public
# (it lives in source/examples) so it must never sign tokens in production.
INSECURE_DEFAULT_JWT_SECRET = "dev-insecure-secret-change-me"

# A real signing secret must be hard to guess. 32 random chars is the floor.
MIN_JWT_SECRET_LEN = 32
# Sàn số vòng bcrypt cho production. Hạ dưới mức này là làm yếu băm mật khẩu thật.
MIN_BCRYPT_ROUNDS = 12


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_BACKEND_ENV,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "GAN App"

    # Deployment environment. "production" turns on the strict secret guard below;
    # "development" (default) keeps zero-config local runs working.
    app_env: str = "development"

    # SQLite by default so the app + tests run with zero external services.
    # docker-compose overrides this to the Postgres service URL.
    database_url: str = "sqlite:///./dev.db"

    # --- Auth / JWT --------------------------------------------------------
    # JWT_SECRET MUST be overridden in any real deployment via the environment.
    jwt_secret: str = INSECURE_DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    # Short-lived: a stale access token is refreshed silently via the refresh cookie
    # (spec-03). Keep small so a revoked session's window is short.
    access_token_expire_minutes: int = 15
    # Long-lived refresh token (httpOnly cookie); rotated on every refresh (spec-03).
    refresh_token_expire_days: int = 7
    # Số vòng bcrypt khi băm mật khẩu. Mặc định 12 = mức của thư viện, KHÔNG hạ ở dev/prod.
    # Tồn tại chỉ để BỘ TEST hạ xuống `BCRYPT_ROUNDS=4`: một lượt băm 12 vòng tốn ~0,4s, mà mỗi
    # test đều seed admin rồi đăng nhập ⇒ ~1s/test chỉ để băm một mật khẩu ai cũng biết.
    # `assert_secure_config` CHẶN production chạy dưới `MIN_BCRYPT_ROUNDS`.
    bcrypt_rounds: int = 12

    # --- Seed user (no self-registration this spec) ----------------------
    seed_admin_username: str = "admin"
    seed_admin_password: str = "admin123"
    seed_admin_name: str = "Admin"

    # Initial password set on HR-created accounts (no invite email this spec).
    # MUST be changed by the user in a real deployment (docs/SECURITY.md).
    default_user_password: str = "password123"

    # Nhắc lịch hẹn chăm sóc real-time: chu kỳ (giây) của ticker in-process quét hẹn vừa tới giờ
    # để đẩy "ting" (SSE) cho người phụ trách. 0 = TẮT (test đặt 0 để không đụng DB in-memory).
    # Nhiều worker: mỗi vòng chỉ MỘT worker giành được quyền chạy (`locks.giu_vai_chinh`).
    care_reminder_seconds: int = 60

    # Seed illustrative Kinh doanh staff + customers (spec-06 CRM demo data) on startup.
    # OFF by default so automated tests keep a minimal, predictable dataset; the dev /
    # browser-validate runtime turns it ON (SEED_DEMO=true in .env) to exercise the
    # own/department/all data-scope on the Khách hàng screen.
    seed_demo: bool = False

    # Phân hệ TẮT theo bản cài (docs/prd-tat-phan-he-theo-ban-cai.md), cách nhau dấu phẩy:
    # `luong`, `khoan`, `hoa_hong`, `giao_hang`. Rỗng = bật hết (Sao Việt Nhật). In Hà Phương đặt đủ
    # bốn. Đọc qua `app.phan_he`, đừng tách chuỗi này ở chỗ khác.
    phan_he_tat: str = ""
    # Phân hệ CHỈ BẬT KHI KHAI (08/11/2026): chiều ngược của `phan_he_tat`. Tính năng chỉ In Hà Phương
    # có (`thuong_mai`, `giao_hang_hp`) mặc định TẮT; bản cài nào muốn dùng thì khai tên ở đây.
    phan_he_bat: str = ""

    # --- Sức chịu tải: TỰ CO GIÃN theo máy (app/tai_nguyen.py) -------------
    # Mọi số 0 / -1 dưới đây nghĩa là "tự tính theo CPU/RAM của container". Đặt số dương qua biến
    # môi trường khi muốn chốt tay (vd VPS dùng chung với dịch vụ khác).
    #
    # Số worker uvicorn (`app/serve.py`). 0 = 2×CPU, trần theo RAM và 8.
    web_concurrency: int = 0
    # Số worker THẬT đang chạy — `serve.py` đặt biến SVN_SO_WORKER cho các worker con để chia ngân
    # sách kết nối DB. Chạy thẳng uvicorn (dev/test) thì 1.
    svn_so_worker: int = 1
    # `max_connections` của Postgres — ngân sách kết nối chung cho mọi worker (phải khớp cấu hình
    # Postgres, xem deploy/postgres/tu-chinh.sh).
    pg_max_connections: int = 200
    db_pool_size: int = 0
    db_max_overflow: int = -1
    # Chờ lấy kết nối tối đa bấy nhiêu giây rồi báo lỗi. Ngắn có chủ đích: cổng đồng thời
    # (`app/cong_dong_thoi.py`) đã giữ số request đang chạy ≤ số kết nối, nên chờ lâu ở đây là
    # dấu hiệu kết nối bị giữ bất thường — báo sớm tốt hơn đứng hình 30 giây.
    db_pool_timeout: int = 10
    # Một câu SQL chạy quá lâu bị Postgres huỷ — không để một truy vấn chạy lạc giữ kết nối mãi.
    # 0 = tắt. Khớp `proxy_read_timeout` của nginx (120s): quá mức đó người dùng đã nhận lỗi rồi.
    db_statement_timeout_ms: int = 120_000
    # Số request HTTP (trừ SSE, health) được chạy cùng lúc trong MỘT worker. 0 = pool + overflow − 2
    # ⇒ request đang chạy không bao giờ phải tranh kết nối DB; dư ra thì XẾP HÀNG ở cổng (không tốn
    # luồng, không giữ kết nối).
    max_request_dong_thoi: int = 0
    # Xếp hàng ở cổng quá bấy nhiêu giây ⇒ trả 503 "máy chủ đang bận" để client thử lại.
    cho_hang_doi_giay: float = 30.0
    # uvicorn giết worker không trả ping trong bấy nhiêu giây (mặc định của nó là 5 — quá ngắn khi
    # máy bão hoà CPU, xem `serve.noi_han_ping_worker`).
    worker_ping_giay: float = 30.0

    # --- Redis (pub/sub SSE + lock) ---------------------------------------
    # RỖNG = không có Redis → hub SSE chạy in-process và lock thành no-op (app/realtime.py,
    # app/locks.py). Nhờ vậy pytest + máy dev không cần dựng service ngoài.
    # Có giá trị (vd redis://redis:6379/0) → SSE đẩy qua pub/sub nên chạy được >1 worker.
    redis_url: str = ""

    # --- MinIO / S3 (kho file) --------------------------------------------
    # RỖNG = ghi thẳng đĩa <backend>/static (LocalStorage). Có endpoint → MinIO.
    # Xem app/storage.py; bucket riêng tư, người dùng đọc qua /api/files có kiểm quyền.
    minio_endpoint: str = ""
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = "svn-files"
    # true = /api/files chỉ KIỂM QUYỀN rồi giao nginx kéo byte thẳng từ MinIO (X-Accel-Redirect tới
    # `location /_kho_tep/` trong frontend/nginx.conf) thay vì Python bơm từng khúc. CHỈ bật khi
    # đứng sau nginx của image `web` (compose); chạy uvicorn trần ở dev thì để false.
    kho_tep_qua_nginx: bool = False
    # Dọn object MinIO không còn dòng DB nào trỏ tới, mỗi ngày một lượt (`services/don_tep_mo_coi.py`).
    # Chỉ chạy với MinIO — LocalStorage (dev/test) không bao giờ bị dọn.
    don_tep_mo_coi: bool = True

    # --- CORS --------------------------------------------------------------
    # Comma-separated list of allowed frontend origins.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    # --- Frontend base URL (QR trên phiếu công nghệ trỏ về đây) -------------
    # Để trống thì lấy origin đầu tiên của CORS_ORIGINS — chỗ đó vốn đã khai "frontend nằm ở đâu"
    # cho từng môi trường, nên deploy không phải khai thêm biến mới (Task 13, phiếu công nghệ).
    frontend_base_url: str = ""

    @property
    def frontend_origin(self) -> str:
        v = self.frontend_base_url.strip().rstrip("/")
        if v:
            return v
        ds = self.cors_origin_list
        return ds[0].rstrip("/") if ds else ""

    @property
    def is_production(self) -> bool:
        return self.app_env.strip().lower() == "production"


def assert_secure_config(s: Settings) -> None:
    """Fail fast in production when the JWT secret is insecure.

    Raises RuntimeError (so the process refuses to start) when `app_env` is production and
    `jwt_secret` is empty, the known public default, or shorter than `MIN_JWT_SECRET_LEN`.
    In development this is a no-op, so a fresh clone runs with zero configuration.
    """
    if not s.is_production:
        return

    secret = s.jwt_secret or ""
    if secret in ("", INSECURE_DEFAULT_JWT_SECRET) or len(secret) < MIN_JWT_SECRET_LEN:
        raise RuntimeError(
            "Refusing to start: APP_ENV=production requires a strong JWT_SECRET. "
            f"Set JWT_SECRET in the environment to a random string of at least "
            f"{MIN_JWT_SECRET_LEN} characters "
            '(e.g. `python -c "import secrets; print(secrets.token_urlsafe(48))"`).'
        )

    if s.bcrypt_rounds < MIN_BCRYPT_ROUNDS:
        raise RuntimeError(
            f"Refusing to start: APP_ENV=production requires BCRYPT_ROUNDS >= "
            f"{MIN_BCRYPT_ROUNDS} (got {s.bcrypt_rounds}). Chỉ bộ test mới được hạ số vòng."
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
