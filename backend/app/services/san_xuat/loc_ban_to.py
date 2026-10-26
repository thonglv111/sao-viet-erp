"""Thuộc tính LỌC của từng công việc trên bàn tổ (09/10/2026, thanh lọc 6 điều kiện).

Bàn tổ lọc theo những thứ không nằm sẵn (hoặc không chỉ nằm) trên cột của `san_xuat_cong_viec`:
· `toi`   — hàng đang tới đâu so với bước của tổ (dựng từ dải routing của lệnh);
· `vuong` — vì sao CHƯA bắt đầu được (đúng các cổng của `thuc_thi.bat_dau`, không tự đặt luật mới);
· `may`   — máy của việc (22/10/2026, thay `tre` trễ giờ dự kiến đã gỡ);
· `khach` — khách của lệnh; bài ghép chạy chung nhiều lệnh nên có thể nhiều khách (22/10/2026);
· `nguoi` — ai đang được giao;
· `cho`   — loại việc đang chờ tổ bấm (bàn giao đến, lỗi KCS chưa xem);
· `gap`   — lệnh / bài ghép có gắn cờ GẤP hay không (`is_rush`, 10/10/2026).

Khoá đắt (`toi` phải dựng routing, `vuong` chạy cổng từng việc) chỉ tính khi chỗ gọi xin — màn
không lọc gì thì không tốn thêm truy vấn nào."""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.san_xuat import CV_DANG_CHAY, CV_HOAN_THANH, CV_PHAT_HANH, CV_TAM_DUNG
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from ...repositories.san_xuat_thuc_thi_repo import SanXuatThucThiRepository
from . import routing_dai

TOI = ("toi", "con_1", "con_2_3", "con_4", "qua")
VUONG = ("chua_giao_tho", "chua_nhan_khuon", "chua_nhan_buoc_truoc", "chua_san_sang_vat_tu")
CHO = ("ban_giao", "kcs")
GAP = ("gap", "thuong")
KHOA = ("toi", "vuong", "may", "khach", "nguoi", "cho", "gap")

_DANG_LAM = (CV_DANG_CHAY, CV_TAM_DUNG)


def vi_tri_hang(dai: list[dict], cong_viec_id: int, step_key: str | None = None) -> str | None:
    """Hàng đang tới đâu so với bước của `cong_viec_id`.

    Bước hàng đang ở (c) = bước XA NHẤT đang chạy/tạm dừng; không bước nào đang làm thì bước đầu
    chưa xong; xong hết thì bước cuối. So với bước của việc (m): c>m `qua`, c==m `toi`, m-c==1
    `con_1`, 2..3 `con_2_3`, ≥4 `con_4`. Dải rỗng hoặc không thấy bước của việc ⇒ None (bài ghép
    chưa có dải). Ô dải chỉ ghi `cong_viec_id` của phân đoạn ĐẦU — các phân đoạn sau của cùng
    bước tìm lại ô mình qua `step_key`. Cùng luật `viTriHang` ở FE."""
    if not dai:
        return None
    m = next((i for i, o in enumerate(dai, start=1)
              if o.get("cong_viec_id") == cong_viec_id or (step_key and o.get("step_key") == step_key)), None)
    if m is None:
        return None
    c = 0
    for i, o in enumerate(dai, start=1):
        if o.get("trang_thai") in _DANG_LAM:
            c = i
    if c == 0:
        c = next((i for i, o in enumerate(dai, start=1) if o.get("trang_thai") != CV_HOAN_THANH), len(dai))
    if c > m:
        return "qua"
    if c == m:
        return "toi"
    d = m - c
    return "con_1" if d == 1 else "con_2_3" if d <= 3 else "con_4"


def _khoa_lenh(cv) -> tuple[str, int | None]:
    return ("bai_ghep", cv.bai_ghep_id) if cv.bai_ghep_id else ("lsx", cv.lsx_id)


def thuoc_tinh(
    db: Session,
    repo: SanXuatRepository,
    rows: list,
    *,
    can: set[str],
    cho_theo_loai: dict[str, set[int]] | None = None,
) -> dict[int, dict]:
    """{cv_id: {"toi": str|None, "vuong": set, "may": set[int], "khach": dict[int, str],
    "nguoi": set[int], "cho": set, "gap": "gap"|"thuong"|None}}.

    `rows` = MỌI công việc của bàn trong phạm vi đọc của người xem (cả các bước khác của tổ trong
    cùng lệnh — dải routing cần biết bước nào là "của tôi"). `cho_theo_loai` = kết quả
    `board._cv_cho_theo_loai` (chỗ gọi đã có sẵn, khỏi tính lại)."""
    ra: dict[int, dict] = {
        cv.id: {"toi": None, "vuong": set(), "may": set(), "khach": {}, "nguoi": set(), "cho": set(),
                "gap": None}
        for cv in rows
    }
    if not rows:
        return ra
    ids = set(ra)

    if "gap" in can:
        # Cờ GẤP nằm trên LỆNH / BÀI GHÉP, không trên công việc — mọi bước của lệnh cùng một giá trị.
        gap = repo.nguon_gap({cv.lsx_id for cv in rows if not cv.bai_ghep_id and cv.lsx_id},
                             {cv.bai_ghep_id for cv in rows if cv.bai_ghep_id})
        for cv in rows:
            ra[cv.id]["gap"] = "gap" if _khoa_lenh(cv) in gap else "thuong"

    if "may" in can:
        for cv in rows:
            if cv.may_id:
                ra[cv.id]["may"] = {cv.may_id}

    if "khach" in can:
        khach = repo.khach_cua_lenh({cv.lsx_id for cv in rows if not cv.bai_ghep_id and cv.lsx_id},
                                    {cv.bai_ghep_id for cv in rows if cv.bai_ghep_id})
        for cv in rows:
            ra[cv.id]["khach"] = khach.get(_khoa_lenh(cv), {})

    if "toi" in can:
        khoa = sorted({_khoa_lenh(cv) for cv in rows}, key=lambda k: (k[0], k[1] or 0))
        dai = routing_dai.dung_routing(db, repo, khoa=khoa, cv_cua_toi=rows)
        for cv in rows:
            d = dai.get(_khoa_lenh(cv))
            if d is None and not cv.bai_ghep_id and not cv.bai_ghep_cong_doan_id:
                # Lệnh MỘT bước: `dung_routing` không dựng dải cho nó, nhưng hàng chỉ có thể ở đây.
                d = [{"cong_viec_id": cv.id, "trang_thai": cv.trang_thai}]
            sk = cv.step_key if not cv.bai_ghep_cong_doan_id else None
            ra[cv.id]["toi"] = vi_tri_hang(d or [], cv.id, sk)

    nguoi = SanXuatThucThiRepository(db).nguoi_dang_giao_nhieu(ids) if {"nguoi", "vuong"} & can else {}
    if "nguoi" in can:
        for cid, emps in nguoi.items():
            ra[cid]["nguoi"] = set(emps)

    if "vuong" in can:
        # Đúng thứ tự cổng của `thuc_thi.bat_dau`: người → đầu vào bước trước → khuôn.
        # Import muộn: dau_vao đọc ngược board.
        from .dau_vao import thieu_dau_vao
        from .trang_thai_vat_tu import chan_bat_dau, trang_thai_vat_tu

        sl = SanXuatSanLuongRepository(db)
        # Cổng vật tư chỉ chặn lần bắt đầu đầu (`dau_vao.kiem_bat_dau`) — tính lô một lần.
        vt = trang_thai_vat_tu(db, [cv for cv in rows if cv.trang_thai == CV_PHAT_HANH])
        for cv in rows:
            if cv.trang_thai not in (CV_PHAT_HANH, CV_TAM_DUNG):
                continue
            v = ra[cv.id]["vuong"]
            if not nguoi.get(cv.id):
                v.add("chua_giao_tho")
            if cv.khuon_json and cv.khuon_nhan_luc is None:
                v.add("chua_nhan_khuon")
            if thieu_dau_vao(sl, cv):
                v.add("chua_nhan_buoc_truoc")
            tt = vt.get(cv.id)
            if tt and chan_bat_dau(tt["muc"]):
                v.add("chua_san_sang_vat_tu")

    if "cho" in can and cho_theo_loai:
        for loai, cv_ids in cho_theo_loai.items():
            for cid in cv_ids & ids:
                ra[cid]["cho"].add(loai)
    return ra


def khop(tt: dict, loc: dict) -> bool:
    """Một việc có khớp MỌI điều kiện đang lọc không. Trong một điều kiện nhiều giá trị là HOẶC.

    `loc`: {"toi": str|None, "vuong": set, "may": set[int], "khach": set[int], "nguoi": set[int],
    "cho": set, "gap": str|None}."""
    if loc.get("toi") and tt["toi"] != loc["toi"]:
        return False
    if loc.get("gap") and tt["gap"] != loc["gap"]:
        return False
    if loc.get("vuong") and not (tt["vuong"] & loc["vuong"]):
        return False
    if loc.get("may") and not (tt["may"] & loc["may"]):
        return False
    if loc.get("khach") and not (tt["khach"].keys() & loc["khach"]):
        return False
    if loc.get("nguoi") and not (tt["nguoi"] & loc["nguoi"]):
        return False
    if loc.get("cho") and not (tt["cho"] & loc["cho"]):
        return False
    return True


def can_cua(loc: dict) -> set[str]:
    """Những khoá thật sự phải tính cho bộ lọc này."""
    return {k for k in KHOA if loc.get(k)}
