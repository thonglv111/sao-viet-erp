"""Database engine + session wiring (the ONLY module that builds the engine).

Repositories receive a Session and own all SQL; services/routes never touch the
engine directly. SQL stays portable across SQLite (local/test) and Postgres
(Docker/prod) — see docs/ARCHITECTURE.md.
"""
from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import TypeVar

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

from .config import settings


def _make_engine():
    url = settings.database_url
    connect_args: dict = {}
    engine_kwargs: dict = {}

    if url.startswith("sqlite"):
        # SQLite needs this to be used across FastAPI's threadpool.
        connect_args["check_same_thread"] = False
        if ":memory:" in url:
            # Keep a single shared connection so an in-memory DB (tests) survives
            # across requests/threads.
            engine_kwargs["poolclass"] = StaticPool
    else:
        # Postgres: pool CO GIÃN theo số worker và ngân sách `max_connections` (app/tai_nguyen.py).
        # Mặc định của SQLAlchemy (5 + 10, chờ 30s) đặt cạnh 40 luồng threadpool là công thức cho
        # "đứng 30 giây rồi lỗi hàng loạt" khi đông người.
        from .tai_nguyen import cau_hinh_pool

        pool = cau_hinh_pool(
            settings.svn_so_worker,
            pg_max_connections=settings.pg_max_connections,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
        )
        engine_kwargs.update(
            pool_size=pool["pool_size"],
            max_overflow=pool["max_overflow"],
            pool_timeout=settings.db_pool_timeout,
            # Kết nối chết ngầm (Postgres restart, mạng Docker chớp) bị phát hiện TRƯỚC khi dùng,
            # không để request nhận lỗi "server closed the connection unexpectedly".
            pool_pre_ping=True,
            pool_recycle=1800,
        )
        if url.startswith("postgresql"):
            # jit=off (26/10/2026): câu nhiều subquery tương quan (lịch xếp máy) bị planner ước
            # lượng đắt quá `jit_above_cost` ⇒ Postgres bỏ 3,5 s BIÊN DỊCH JIT cho một câu chạy
            # thật 45 ms. Truy vấn OLTP ở đây không có ca nào lợi từ JIT.
            tuy_chon = ["-c jit=off"]
            if settings.db_statement_timeout_ms > 0:
                tuy_chon.append(f"-c statement_timeout={settings.db_statement_timeout_ms}")
            connect_args["options"] = " ".join(tuy_chon)

    eng = create_engine(url, connect_args=connect_args, **engine_kwargs)
    if url.startswith("sqlite"):
        event.listen(eng, "connect", _dang_ky_ham_sqlite)
    return eng


def _dang_ky_ham_sqlite(dbapi_conn, _record) -> None:
    """Hàm `bo_dau` cho tìm kiếm không dấu — Postgres dùng `translate` sẵn có, SQLite không có
    nên đăng ký bản Python (xem `repositories/tim_khong_dau.py`)."""
    from .repositories.tim_khong_dau import bo_dau

    dbapi_conn.create_function("bo_dau", 1, lambda v: None if v is None else bo_dau(str(v)),
                               deterministic=True)


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()


_T = TypeVar("_T")


def get_db(request: Request = None) -> Iterator[Session]:  # type: ignore[assignment]
    """FastAPI dependency: yield a request-scoped session, always closed.

    Request GET/HEAD đánh dấu phiên chỉ đọc (`db.info["chi_doc"]`) để `nho_trong_luot_doc` được nhớ
    kết quả truy vấn đọc lặp lại trong cùng một lượt (08/11/2026, tối ưu tải phân hệ Tổ sản xuất)."""
    db = SessionLocal()
    db.info["chi_doc"] = request is not None and request.method in ("GET", "HEAD")
    try:
        yield db
    finally:
        db.close()


def nho_trong_luot_doc(db: Session, khoa: tuple, tinh: Callable[[], _T]) -> _T:
    """Nhớ kết quả `tinh()` theo `khoa` trong MỘT phiên của request GET. Phiên ghi (POST/PUT/…, hay
    phiên tự mở ngoài request) luôn tính lại: trong lượt ghi, dữ liệu vừa sửa phải đọc lại thật.

    Dùng cho truy vấn đọc thuần bị gọi lặp nhiều lần trong một lượt dựng màn (vd chặng trước của
    một việc: trần nhận, đầu vào, công đoạn trước đều hỏi lại). Bên gọi không được sửa giá trị trả
    về (danh sách dùng chung giữa các lần gọi)."""
    if not db.info.get("chi_doc"):
        return tinh()
    nho = db.info.setdefault("nho_doc", {})
    if khoa not in nho:
        nho[khoa] = tinh()
    return nho[khoa]


def init_db() -> None:
    """Create tables for models registered on Base.

    Spec-01 uses create_all (+ seed) instead of Alembic migrations; migrations
    are an explicit follow-up (see docs/product-specs/spec-01-auth.md).
    """
    # Import models so they register on Base.metadata before create_all.
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_role_permission_columns()


def _ensure_role_permission_columns() -> None:
    """Micro-migration: thêm các cột quyền chi tiết mới vào `role_permissions` nếu thiếu.

    `create_all` KHÔNG ALTER bảng đã tồn tại; hàm này ADD COLUMN cho DB cũ nên KHÔNG cần
    xóa/seed lại (giữ nguyên dữ liệu). Idempotent — chỉ thêm cột còn thiếu.
    """
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    if "role_permissions" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("role_permissions")}
    default = "0" if engine.dialect.name == "sqlite" else "false"
    for col in (
        "can_reassign",
        "can_export",
        "can_view_debt",
        "can_approve",
        "can_manage_status",
        "can_reset_password",
        "can_lock",
        "can_revoke_sessions",
        "can_assign_role",
        "can_transfer",
        "can_set_head",
        "can_requote",
        "can_manage_price",
        "can_cancel",
        "can_manage_permissions",
        "can_clone",
        "can_toggle_active",
        "can_reparent",
    ):
        if col not in existing:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"ALTER TABLE role_permissions "
                        f"ADD COLUMN {col} BOOLEAN NOT NULL DEFAULT {default}"
                    )
                )
