"""Tuỳ chọn phiên Postgres của engine (26/10/2026).

JIT phải tắt ở MỌI kết nối Postgres: lịch xếp máy mất 3,5 s biên dịch JIT cho một câu chạy thật
45 ms. statement_timeout vẫn đi kèm khi được khai.
"""
from __future__ import annotations

from app import db as db_mod


def _options(monkeypatch, timeout_ms: int) -> str:
    bat = {}

    def _gia_create_engine(url, connect_args=None, **_kw):
        bat["connect_args"] = connect_args or {}
        return object()

    monkeypatch.setattr(db_mod.settings, "database_url", "postgresql+psycopg2://u:p@h:5432/d")
    monkeypatch.setattr(db_mod.settings, "db_statement_timeout_ms", timeout_ms)
    monkeypatch.setattr(db_mod, "create_engine", _gia_create_engine)
    db_mod._make_engine()
    return bat["connect_args"].get("options", "")


def test_postgres_tat_jit_kem_statement_timeout(monkeypatch):
    opt = _options(monkeypatch, 30000)
    assert "-c jit=off" in opt
    assert "-c statement_timeout=30000" in opt


def test_postgres_tat_jit_ca_khi_khong_khai_timeout(monkeypatch):
    opt = _options(monkeypatch, 0)
    assert opt == "-c jit=off"
