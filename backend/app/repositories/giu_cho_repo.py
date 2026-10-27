"""Truy vấn bảng GIỮ CHỖ vật tư. Không luật nghiệp vụ nào ở đây — xem `giu_cho_service`."""
from __future__ import annotations

from sqlalchemy import delete, func, or_, select, tuple_
from sqlalchemy.orm import Session

from ..models.vat_tu_giu_cho import VatTuGiuCho
from ..services.kho_giay import kho_mo

#: Khoá giữ chỗ = khoá tồn `kho_giay.Khoa`: (loai, id, kho_rong, kho_dai, don_vi_goc).
Hang = tuple[str, int, int, int, str]


def khoa5(h) -> Hang:
    """Cặp `(loai, id)` ⇒ `(loai, id, 0, 0, "")`; khoá 5 phần tử giữ nguyên (đơn vị gốc chữ thường)."""
    h = tuple(h)
    if len(h) == 5:
        return (h[0], int(h[1]), int(h[2]), int(h[3]), str(h[4] or "").strip().lower())
    return (h[0], int(h[1]), 0, 0, "")


class GiuChoRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def da_giu_map(self, hangs: list[Hang]) -> dict[Hang, float]:
        """`{(loại, id, rộng, dài, đơn vị gốc): TỔNG đang giữ}` — gộp MỌI chủ thể, MỌI nguồn.

        Đây là số bị trừ khỏi tồn để ra TỒN TỰ DO, nên phải gộp cả `dang_ve`: phần bám vào lô đang
        mua cũng đã có chủ, hàng về tới nơi là thuộc về lệnh đó rồi.

        Khoá VẬT TƯ trống khổ (`kho_mo`) cộng phần giữ MỌI khổ cùng mã + đơn vị gốc — cùng luật tra
        tồn (`StockLotRepository._tong_theo_khoa`), không thì tồn tự do của nó âm/dương sai.
        """
        if not hangs:
            return {}
        cot = (VatTuGiuCho.hang_loai, VatTuGiuCho.hang_id, VatTuGiuCho.kho_rong,
               VatTuGiuCho.kho_dai, VatTuGiuCho.don_vi_goc)
        tat_ca = {khoa5(h) for h in hangs}
        keys = sorted(k for k in tat_ca if not kho_mo(k))
        found: dict = {}
        if keys:
            rows = self.db.execute(
                select(*cot, func.sum(VatTuGiuCho.so_luong))
                .where(tuple_(*cot).in_(keys))
                .group_by(*cot)
            )
            found = {(loai, int(hid), int(kr or 0), int(kd or 0), goc or ""): float(tong or 0)
                     for loai, hid, kr, kd, goc, tong in rows}
        mo = sorted({(k[0], k[1], k[4]) for k in tat_ca if kho_mo(k)})
        if mo:
            cot_mo = (VatTuGiuCho.hang_loai, VatTuGiuCho.hang_id, VatTuGiuCho.don_vi_goc)
            for loai, hid, goc, tong in self.db.execute(
                    select(*cot_mo, func.sum(VatTuGiuCho.so_luong))
                    .where(tuple_(*cot_mo).in_(mo)).group_by(*cot_mo)):
                found[(loai, int(hid), 0, 0, goc or "")] = float(tong or 0)
        return {tuple(h): found.get(khoa5(h), 0.0) for h in hangs}

    def cua_chu_the(self, *, lsx_id: int | None, bai_ghep_id: int | None) -> list[VatTuGiuCho]:
        stmt = select(VatTuGiuCho)
        stmt = (stmt.where(VatTuGiuCho.lsx_id == lsx_id) if lsx_id is not None
                else stmt.where(VatTuGiuCho.bai_ghep_id == bai_ghep_id))
        return list(self.db.execute(stmt.order_by(VatTuGiuCho.id.asc())).scalars())

    def cua_nhieu_chu_the(
        self, chu_the: list[tuple[int | None, int | None]]
    ) -> dict[tuple[int | None, int | None], list[VatTuGiuCho]]:
        """Gộp `cua_chu_the()` cho NHIỀU chủ thể một lượt — 1 query thay vì N.

        `giu_theo_chu_the_hang()` gọi `trang_thai()` cho từng chủ thể trong bảng; để mỗi lần tự
        query riêng thì N chủ thể (có thể tới hàng trăm lệnh) là N round-trip DB không cần thiết.
        Màn danh sách lệnh hỏi trạng thái giữ chỗ của cả trang cũng đi qua đây.

        TOÀN ÁNH trên `chu_the`: chủ thể không có dòng nào vẫn có khoá, giá trị `[]`. Nhờ vậy khoá
        VẮNG mang đúng MỘT nghĩa — nơi gọi đang hỏi ngoài lô đã tra — nên `trang_thai()` phân biệt
        được "không giữ chỗ gì" với "chưa tra" thay vì phải đoán.
        """
        ra: dict[tuple[int | None, int | None], list[VatTuGiuCho]] = {c: [] for c in chu_the}
        lsx_ids = [c[0] for c in chu_the if c[0] is not None]
        bai_ids = [c[1] for c in chu_the if c[1] is not None]
        if not lsx_ids and not bai_ids:
            return ra
        dieu_kien = []
        if lsx_ids:
            dieu_kien.append(VatTuGiuCho.lsx_id.in_(lsx_ids))
        if bai_ids:
            dieu_kien.append(VatTuGiuCho.bai_ghep_id.in_(bai_ids))
        rows = self.db.execute(
            select(VatTuGiuCho).where(or_(*dieu_kien)).order_by(VatTuGiuCho.id.asc())
        ).scalars()
        for r in rows:
            ra.setdefault((r.lsx_id, r.bai_ghep_id), []).append(r)
        return ra

    def xoa_cua_chu_the(self, *, lsx_id: int | None, bai_ghep_id: int | None) -> int:
        stmt = delete(VatTuGiuCho)
        stmt = (stmt.where(VatTuGiuCho.lsx_id == lsx_id) if lsx_id is not None
                else stmt.where(VatTuGiuCho.bai_ghep_id == bai_ghep_id))
        n = self.db.execute(stmt).rowcount or 0
        self.db.commit()
        return n

    def them(self, rows: list[VatTuGiuCho]) -> None:
        if not rows:
            return
        self.db.add_all(rows)
        self.db.commit()

    def tat_ca(self) -> list[VatTuGiuCho]:
        """MỌI dòng giữ chỗ, kể cả của chủ thể đã rơi khỏi bảng cân đối.

        Cần cho danh sách "giữ lâu chưa chạy": lệnh bị kéo ngược về `nhap` biến mất khỏi bảng cân
        đối nhưng dòng giữ chỗ VẪN trừ vào tồn tự do của mọi người khác. Chỉ duyệt theo bảng cân
        đối thì đúng những chỗ giữ tệ nhất lại là chỗ không ai nhìn thấy.
        """
        return list(self.db.execute(
            select(VatTuGiuCho).order_by(VatTuGiuCho.id.asc())).scalars())

    def chu_the_da_xep_lich(self) -> tuple[set[int], set[int]]:
        """`(lsx_ids, bai_ghep_ids)` ĐÃ có dòng trên bàn xếp lịch.

        Không lọc theo trạng thái dòng lịch (`cho_xep` / `da_xep`): cửa chặn giữ chỗ nằm ở lúc ĐƯA
        VÀO kế hoạch, nên chỉ cần có dòng là chủ thể đó đã đi qua cửa — tức chỗ giữ đã dùng đúng
        việc của nó. Lọc thêm `da_xep` sẽ đếm nhầm lệnh đang chờ gán máy thành "giữ mà chưa chạy".
        """
        from ..models.xep_lich import XepLichCongDoan
        from ..services.xep_lich.moc import lsx_da_xep

        lsx = set(self.db.execute(
            select(XepLichCongDoan.lsx_id).where(XepLichCongDoan.lsx_id.isnot(None))).scalars())
        # Lệnh xếp ở màn 3 KHÔNG đẻ dòng `xep_lich_cong_doan` nào — thiếu dòng dưới đây thì mọi
        # lệnh của màn mới bị coi là "chưa qua cửa kế hoạch" và chỗ giữ vật tư của nó bị nhả.
        lsx |= lsx_da_xep(self.db)
        bai = set(self.db.execute(
            select(XepLichCongDoan.bai_ghep_id)
            .where(XepLichCongDoan.bai_ghep_id.isnot(None))).scalars())
        return lsx, bai

    def dang_bat(self) -> tuple[set[int], set[int]]:
        """`(lsx_ids, bai_ghep_ids)` đang BẬT công tắc — nguồn cho `nhat_them` khi hàng về."""
        from ..models.bai_ghep import BaiGhep
        from ..models.lsx import Lsx

        lsx = set(self.db.execute(
            select(Lsx.id).where(Lsx.giu_cho_bat.is_(True))).scalars())
        bai = set(self.db.execute(
            select(BaiGhep.id).where(BaiGhep.giu_cho_bat.is_(True))).scalars())
        return lsx, bai

    def co_bat_nhieu(
        self, chu_the: list[tuple[int | None, int | None]]
    ) -> dict[tuple[int | None, int | None], bool]:
        """Cờ công tắc giữ chỗ của NHIỀU chủ thể một lượt — 2 câu thay vì N.

        `trang_thai()` đọc cờ này bằng `db.get(Lsx)` cho TỪNG chủ thể. Màn đọc lại hỏi cả trang:
        hàng ba đèn của Kế hoạch SX (`lsx_tong_quan`) và bảng "Theo lệnh" của Kế hoạch vật tư đều
        lặp qua hàng chục lệnh ⇒ đúng một câu SELECT mỗi lệnh, đo được 18/09/2026 (12 lệnh: 12 câu
        chỉ để đọc một cột bool). Hỏi ĐÍCH DANH lô đang cần chứ không dùng `dang_bat()`: hàm kia
        quét cả bảng lệnh (đúng cho `nhat_them` vì nó cần mọi chủ thể đang bật, phí cho màn đọc).

        TOÀN ÁNH trên `chu_the` — cùng lý do `cua_nhieu_chu_the`: khoá VẮNG chỉ có MỘT nghĩa là
        "nơi gọi hỏi ngoài lô đã tra", nên `trang_thai()` phân biệt được với "cờ đang tắt".
        """
        from ..models.bai_ghep import BaiGhep
        from ..models.lsx import Lsx

        ra: dict[tuple[int | None, int | None], bool] = {c: False for c in chu_the}
        lsx_ids = [c[0] for c in chu_the if c[0] is not None]
        bai_ids = [c[1] for c in chu_the if c[1] is not None]
        if lsx_ids:
            for i, bat in self.db.execute(
                select(Lsx.id, Lsx.giu_cho_bat).where(Lsx.id.in_(lsx_ids))
            ).all():
                ra[(i, None)] = bool(bat)
        if bai_ids:
            for i, bat in self.db.execute(
                select(BaiGhep.id, BaiGhep.giu_cho_bat).where(BaiGhep.id.in_(bai_ids))
            ).all():
                ra[(None, i)] = bool(bat)
        return ra
