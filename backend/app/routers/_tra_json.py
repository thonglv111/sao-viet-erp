"""Trả JSON cho response LỚN (bảng công / lưới phân ca / bảng lương cả công ty) trong MỘT lượt.

Trả model về cho FastAPI thì nó làm lại ba lượt: `model_dump` ra dict → kiểm lại theo
`response_model` → serialize → `json.dumps`. Bảng công 6.300 người × ~20 ô là 130 nghìn ô, ba lượt
đó tốn nhiều giây (26/10/2026). Ở đây kiểm đúng schema `response_model` một lần bằng pydantic-core
rồi ghi JSON thẳng — cùng trường, cùng giá trị (by_alias như FastAPI). Route vẫn khai
`response_model` để OpenAPI giữ nguyên.
"""
from __future__ import annotations

from fastapi import Response
from pydantic import BaseModel


def tra_json(model: type[BaseModel], data) -> Response:
    """Kiểm `data` (dict / object) theo `model` rồi trả thẳng JSON."""
    obj = data if isinstance(data, model) else model.model_validate(data)
    return Response(content=obj.model_dump_json(by_alias=True), media_type="application/json")
