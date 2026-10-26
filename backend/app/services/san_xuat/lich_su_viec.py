"""Lịch sử MỘT công việc — tab "Lịch sử" của ngăn bàn tổ (09/10/2026, mockup `ban-to-ngan-B-day-du`).

Gom `audit_logs` của MỌI đối tượng gắn với công việc: chính công việc (chạy máy, giao thợ, khuôn,
đề nghị vật tư, nhập kho), các mẻ, các lần bàn giao đi và đến, các đề nghị vật tư, phiếu xuất vật
tư tổ đã nhận, lần kiểm KCS ở bước này hoặc quy lỗi về bước này, lỗi KCS tổ đã xem. (Hỗ trợ chéo gỡ mg 0389 — nhật ký cũ `san_xuat.ho_tro.*` không còn gom vào.)
Id đối tượng đọc từ BẢNG (không quét `detail` cả bảng nhật ký). Thêm hai mốc đọc thẳng bảng: "Tổ
nhận lệnh" và các lần báo máy hỏng từ việc này (yêu cầu sửa chữa neo `cong_viec_id`).

Câu dựng ở máy chủ từ đối tượng còn sống (tên máy, tên bước, đơn vị); đối tượng đã mất thì đọc số
trong `detail`, không có nữa thì rơi về nhãn của `audit_registry` (nguồn nhãn duy nhất). Không bày
TIỀN — chỉ số lượng. Các mẩu phụ là danh sách `ct`, FE vẽ thành thẻ nhỏ (không nối bằng dấu).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ... import audit_registry
from ...models.san_xuat_thuc_thi import PHIEN_DOI_MAY, PHIEN_KET_THUC, PHIEN_TAM_DUNG
from ...models.user import User
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.don_vi_do_repo import nhan_don_vi
from ...repositories.ky_thuat_may_repo import KyThuatMayRepository
from ...repositories.san_xuat_kcs_repo import SanXuatKcsRepository
from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from ...repositories.san_xuat_thuc_thi_repo import SanXuatThucThiRepository
from ...repositories.san_xuat_vat_tu_repo import SanXuatVatTuRepository
from ..gio_xuong import thuc_te_hien_thi
from .board import MUC_CUA_TOI, _loc_viec_cua_tho, _may_thiet_bi_nhan, _pham_vi_doc
from .dau_vao import bang_dv_viec

NHOM_LS = ("chay_may", "nguoi_khuon", "san_luong", "ban_giao", "vat_tu", "kcs", "khac")

_KV = re.compile(r"(\w+)=([^\s]+)")


def _kv(detail: str | None) -> dict[str, str]:
    return dict(_KV.findall(detail or ""))


def _so(x) -> str:
    """Số kiểu Việt cho câu: 1.250 · 2,5."""
    try:
        f = float(x)
    except (TypeError, ValueError):
        return str(x)
    s = f"{f:,.3f}".rstrip("0").rstrip(".")
    return s.replace(",", "\x00").replace(".", ",").replace("\x00", ".")


def _ly_do(detail: str | None) -> str | None:
    """Lý do gõ kèm khi sửa số mẻ — phần sau " | " của `detail`."""
    _, sep, ly = (detail or "").partition(" | ")
    return ly.strip() or None if sep else None


def _utc(t: datetime) -> datetime:
    """SQLite trả mốc không nhãn múi giờ — coi là UTC như lúc ghi."""
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def _chay(bat_dau: datetime, ket_thuc: datetime) -> str:
    """'chạy 28 phút' / 'chạy 1 giờ 5 phút' — phiên vừa đóng chạy bao lâu."""
    phut = round((_utc(ket_thuc) - _utc(bat_dau)).total_seconds() / 60)
    if phut < 1:
        return "chạy chưa tới 1 phút"
    g, p = divmod(phut, 60)
    return "chạy " + (f"{g} giờ {p} phút" if g and p else f"{g} giờ" if g else f"{p} phút")


def _dong(luc, nhom: str, cau: str, ct: list[str] | None = None, *, ly_do: str | None = None,
          mau: str = "", id_: int = 0) -> dict:
    return {"luc": luc, "nhom": nhom, "cau": cau, "ct": [c for c in (ct or []) if c],
            "ly_do": (ly_do or "").strip() or None, "mau": mau, "_id": id_}


def lich_su(db: Session, user: User, *, cong_viec_id: int) -> dict:
    """{"items": [dòng mới nhất trên cùng], "dem": {nhóm: số dòng}}.

    Cùng phạm vi ĐỌC với ngăn chi tiết (`board.chi_tiet_cong_viec`): ngoài phạm vi ⇒
    `PermissionError`; không có công việc ⇒ `LookupError`."""
    tt = SanXuatThucThiRepository(db)
    cv = tt.cong_viec(cong_viec_id)
    if cv is None:
        raise LookupError("Không tìm thấy công việc.")
    _q, muc = _pham_vi_doc(db, user, cv.department_id)
    if muc == MUC_CUA_TOI and not _loc_viec_cua_tho(db, user, [cv]):
        raise PermissionError("Chỉ xem được việc đã giao cho mình.")

    items = cac_dong(db, cv)
    for x in items:
        # Người thao tác tách khỏi thẻ, lên dòng "người · giờ" như nhật ký lệnh (10/10/2026).
        x["nguoi"] = x.pop("_ai", "") or None
        if x["nguoi"] and x["nguoi"] in x["ct"]:
            x["ct"].remove(x["nguoi"])
        for k in ("_id", "_uid", "_phu"):
            x.pop(k, None)
    dem = {n: 0 for n in NHOM_LS}
    for x in items:
        dem[x["nhom"]] += 1
    return {"items": items, "dem": dem}


def cac_dong(db: Session, cv, *, gio=thuc_te_hien_thi) -> list[dict]:
    """Các dòng lịch sử của MỘT công việc, mới nhất trên cùng — KHÔNG kiểm quyền (người gọi lo).

    Ngoài khoá công khai, mỗi dòng mang `_ai` (tên người thao tác đã nằm trong `ct`) và `_uid`
    (tài khoản) để nhật ký LỆNH (`services/lsx_nhat_ky.py`) tách người ra khỏi thẻ. `gio` đổi
    thang giờ trả ra: bàn tổ cần giờ xưởng không nhãn, nhật ký lệnh giữ UTC như audit của lệnh."""
    tt = SanXuatThucThiRepository(db)
    sl = SanXuatSanLuongRepository(db)
    vt = SanXuatVatTuRepository(db)
    kcs = SanXuatKcsRepository(db)

    # --- Đối tượng gắn với công việc (đọc từ bảng) ---------------------------------------------
    batches = {b.id: b for b in sl.cac_batch(cv.id)}
    bgs = {b.id: b for b in [*sl.ban_giao_tu_nguon(cv.id), *sl.ban_giao_toi_dich(cv.id)]}
    dns = {d.id: d for d in vt.cac_de_nghi(cv.id)}
    kcs_tai = {b.id: b for b in kcs.cac_kcs_batch(cv.id)}
    kcs_quy = {b.id: b for b in kcs.batch_quy_loi_ve(cv.id)}
    lois = [
        l for bid, ds in kcs.cac_loi_nhieu([*kcs_tai, *kcs_quy]).items() for l in ds
        if l.cong_doan_ref_id == cv.id or (l.cong_doan_ref_id is None and bid in kcs_tai)
    ]
    # Báo máy hỏng từ việc này: yêu cầu sửa chữa neo `cong_viec_id`, nhật ký của nó nằm dưới target
    # của Kỹ thuật máy nên đọc thẳng bảng. Việc đang tạm dừng hoặc chọn "vẫn chạy" thì không có
    # dòng Tạm dừng nào kể lại sự cố — thiếu dòng này là tổ mất dấu.
    su_co = KyThuatMayRepository(db).yeu_cau_cua_cong_viec(cv.id)

    targets = (
        [f"san_xuat_cong_viec:{cv.id}"]
        + [f"san_xuat_batch:{i}" for i in batches]
        + [f"san_xuat_ban_giao:{i}" for i in bgs]
        + [f"san_xuat_vat_tu_de_nghi:{i}" for i in dns]
        + [f"san_xuat_kcs_batch:{i}" for i in [*kcs_tai, *kcs_quy]]
        + [f"san_xuat_kcs_loi:{l.id}" for l in lois]
    )
    theo_target = AuditLogRepository(db).list_by_targets(targets)
    # Id có thể bị CẤP LẠI (xoá dữ liệu tay rồi đặt lại sequence): nhật ký của đối tượng cũ cùng id
    # nằm chung target. Bỏ dòng ghi TRƯỚC lúc đối tượng hiện tại ra đời (L-SX-24), nới 1 phút cho
    # dòng audit ghi cùng giao dịch tạo.
    sinh = {f"san_xuat_cong_viec:{cv.id}": cv.created_at}
    for ten, bang in (("san_xuat_batch", batches), ("san_xuat_ban_giao", bgs),
                      ("san_xuat_vat_tu_de_nghi", dns),
                      ("san_xuat_kcs_batch", {**kcs_tai, **kcs_quy}),
                      ("san_xuat_kcs_loi", {l.id: l for l in lois})):
        for i, obj in bang.items():
            sinh[f"{ten}:{i}"] = getattr(obj, "created_at", None)
    logs = [
        l for tg, ds in theo_target.items() for l in ds
        if sinh.get(tg) is None or l.created_at is None
        or _utc(l.created_at) >= _utc(sinh[tg]) - timedelta(minutes=1)
    ]

    # --- Bảng tra theo lô (một truy vấn mỗi loại) -----------------------------------------------
    dv_bang = bang_dv_viec(db, cv)
    dv = lambda ma: nhan_don_vi(dv_bang, ma)  # noqa: E731
    emp_ids: set[int] = set()
    phien = tt.cac_phien(cv.id)
    may_ids: set[int] = {p.may_id for p in phien if p.may_id} | {y.may_id for y in su_co}
    for l in logs:
        k = _kv(l.detail)
        if l.action in ("san_xuat_phan_cong", "san_xuat_go_phan_cong") and k.get("employee_id", "").isdigit():
            emp_ids.add(int(k["employee_id"]))
        if l.action == "san_xuat_doi_may":
            may_ids |= {int(x) for x in re.findall(r"\d+", l.detail or "")}
    ten_nv = tt.ten_nhan_vien_nhieu(emp_ids)
    ten_may = _may_thiet_bi_nhan(db, may_ids)
    phien_may = {p.so_thu_tu: ten_may.get(p.may_id) for p in phien}

    def chay_bao_lau(l, loai: str) -> str | None:
        """Dòng Tạm dừng / Kết thúc / Đổi máy kèm phiên vừa đóng chạy bao lâu (thay bảng Phiên chạy
        đã gỡ khỏi ngăn, 22/10/2026). Audit không ghi số phiên ⇒ khớp theo loại đóng + mốc đóng gần
        nhất: đóng phiên và ghi audit cùng một giao dịch. Kết thúc lúc đang tạm dừng thì không có
        phiên nào đóng theo ⇒ không kèm."""
        t = _utc(l.created_at)
        lech = lambda p: abs((_utc(p.ket_thuc) - t).total_seconds())  # noqa: E731
        p = min((p for p in phien if p.ket_thuc and p.loai_dong == loai), key=lech, default=None)
        return _chay(p.bat_dau, p.ket_thuc) if p and lech(p) <= 120 else None
    doi_tac = kcs.cong_viec_nhieu(
        {b.nguon_cong_viec_id for b in bgs.values()} | {b.dich_cong_viec_id for b in bgs.values()}
        | {b.cong_viec_id for b in kcs_quy.values()}
    )
    ten_buoc = lambda i: (doi_tac[i].ten_cong_doan if i in doi_tac else "bước khác")  # noqa: E731
    ten_actor = kcs.ten_nguoi({l.actor_user_id for l in logs if l.actor_user_id and not l.actor_name_luc_do})
    dv_ra = dv(cv.don_vi_ra) if cv.don_vi_ra else ""

    def ai(l) -> str:
        return l.actor_name_luc_do or ten_actor.get(l.actor_user_id or 0, "")

    def dung(l) -> dict | None:
        a, k, luc = l.action, _kv(l.detail), gio(l.created_at)
        loai, _, sid = l.target.partition(":")
        oid = int(sid) if sid.isdigit() else 0
        nguoi = ai(l)
        d = lambda *x, **kw: {**_dong(luc, *x, id_=l.id, **kw), "_ai": nguoi, "_uid": l.actor_user_id}  # noqa: E731

        # Chạy máy
        if a == "san_xuat_bat_dau":
            n = int(k["phien"]) if k.get("phien", "").isdigit() else None
            return d("chay_may", f"Bắt đầu phiên {n}" if n else "Bắt đầu", [phien_may.get(n) if n else None, nguoi], mau="g")
        if a == "san_xuat_tam_dung":
            return d("chay_may", "Tạm dừng", [chay_bao_lau(l, PHIEN_TAM_DUNG), nguoi], ly_do=l.detail)
        if a == "san_xuat_ket_thuc":
            return d("chay_may", "Kết thúc việc", [chay_bao_lau(l, PHIEN_KET_THUC), nguoi], mau="g")
        if a == "san_xuat_doi_may":
            so = [int(x) for x in re.findall(r"\d+", l.detail or "")]
            chay = chay_bao_lau(l, PHIEN_DOI_MAY)
            if len(so) == 2:
                return d("chay_may", f"Đổi máy {ten_may.get(so[0], 'cũ')} sang {ten_may.get(so[1], 'mới')}", [chay, nguoi])
            return d("chay_may", "Đổi máy", [chay, nguoi])
        # Người và khuôn
        if a in ("san_xuat_phan_cong", "san_xuat_go_phan_cong"):
            ten = ten_nv.get(int(k["employee_id"])) if k.get("employee_id", "").isdigit() else None
            dong_tu = "Giao thợ" if a == "san_xuat_phan_cong" else "Rút thợ"
            return d("nguoi_khuon", f"{dong_tu} {ten}" if ten else dong_tu, [nguoi])
        if a == "san_xuat_nhan_khuon":
            return d("nguoi_khuon", f"Nhận khuôn {l.detail}".strip(), [nguoi])
        if a == "san_xuat_tra_khuon":
            return d("nguoi_khuon", f"Trả khuôn {l.detail} về kệ".replace("  ", " "), [nguoi])
        # Sản lượng
        if a == "san_xuat_tao_batch":
            # Số LÚC GHI (detail), không phải số sống: mẻ sửa số được (10/10/2026), dòng sửa kể sau.
            b = batches.get(oid)
            tot = float(k["tot"]) if k.get("tot") else (float(b.tot) if b else 0.0)
            hong = float(k["hong"]) if k.get("hong") else (float(b.hong) if b else 0.0)
            don_vi = dv(b.don_vi) if b else dv_ra
            return d("san_luong", f"Ghi sản lượng {_so(tot)} {don_vi} tốt".replace("  ", " "),
                     [f"hỏng {_so(hong)}" if hong > 0 else None, nguoi], mau="g")
        if a == "san_xuat_me_cap_nhat_danh_muc":
            return d("san_luong", "Cập nhật sản lượng theo danh mục", [nguoi])
        if a == "san_xuat_sua_batch":
            b = batches.get(oid)
            don_vi = dv(b.don_vi) if b else dv_ra
            m = re.search(r"tot=([\d.]+)->([\d.]+)", l.detail or "")
            cau = (f"Sửa số sản lượng từ {_so(m[1])} thành {_so(m[2])} {don_vi}" if m else "Sửa số sản lượng").replace("  ", " ")
            return d("san_luong", cau, ["chờ bước nhận xác nhận lại" if " cho_nhan_lai" in (l.detail or "") else None,
                                        nguoi], ly_do=_ly_do(l.detail))
        if a == "san_xuat_sua_nguoi_batch":
            m = re.match(r"bot=([^;]*);them=(.*?)(?: \| |$)", l.detail or "")
            bot = [t for t in (m[1] if m else "").split("/") if t]
            them = [t for t in (m[2] if m else "").split("/") if t]
            return d("san_luong", "Sửa người làm sản lượng",
                     [*(f"bỏ {t}" for t in bot), *(f"thêm {t}" for t in them), nguoi],
                     ly_do=_ly_do(l.detail))
        # Bàn giao
        if a.startswith("san_xuat_ban_giao_"):
            bg = bgs.get(oid)
            don_vi = dv(bg.don_vi) if bg else dv_ra
            la_nguon = bg is None or bg.nguon_cong_viec_id == cv.id
            if a == "san_xuat_ban_giao_de_xuat":
                so_l = _so(k.get("sl", bg.so_luong if bg else 0))
                if la_nguon:
                    dich = ten_buoc(bg.dich_cong_viec_id) if bg and bg.dich_cong_viec_id else None
                    return d("ban_giao", f"Đề xuất giao {so_l} {don_vi}" + (f" sang {dich}" if dich else ""),
                             [nguoi], mau="b")
                return d("ban_giao", f"Bước {ten_buoc(bg.nguon_cong_viec_id)} đề xuất giao {so_l} {don_vi}",
                         [nguoi], mau="b")
            if a == "san_xuat_ban_giao_xac_nhan":
                so_l = _so(k.get("sl", bg.so_luong if bg else 0))
                if la_nguon and bg and bg.dich_cong_viec_id:
                    return d("ban_giao", f"Bước {ten_buoc(bg.dich_cong_viec_id)} xác nhận nhận {so_l} {don_vi}",
                             [nguoi], mau="g")
                return d("ban_giao", f"Xác nhận nhận {so_l} {don_vi}", [nguoi], mau="g")
            m = re.search(r"([\d.]+)\s*->\s*([\d.]+)", l.detail or "")
            if a == "san_xuat_ban_giao_sua" and m:
                return d("ban_giao", f"Sửa lần giao từ {_so(m[1])} thành {_so(m[2])} {don_vi}", [nguoi])
            if a == "san_xuat_ban_giao_theo_me" and m:
                # Bước giao đã có dòng "Sửa số mẻ" — dòng này chỉ kể cho bước NHẬN.
                if la_nguon:
                    return None
                cau = f"Bước {ten_buoc(bg.nguon_cong_viec_id)} sửa số sản lượng, lần giao từ {_so(m[1])} thành {_so(m[2])} {don_vi}"
                return d("ban_giao", cau, ["cần xác nhận lại" if " cho_nhan_lai" in (l.detail or "") else None, nguoi],
                         ly_do=_ly_do(l.detail))
            if a == "san_xuat_ban_giao_dieu_chinh" and m:
                # Điều chỉnh trên lần giao đã gỡ 10/10/2026 — dòng cũ vẫn kể lại.
                return d("ban_giao", f"Điều chỉnh số giao từ {_so(m[1])} thành {_so(m[2])} {don_vi}", [nguoi])
        # Vật tư
        if a == "san_xuat_de_nghi_vat_tu":
            m = re.search(r"lần (\d+)", l.detail or "")
            dong_kho = re.search(r"(\d+) dòng", l.detail or "")
            return d("vat_tu", f"Đề nghị cấp vật tư lần {m[1]}" if m else "Đề nghị cấp vật tư",
                     [f"{dong_kho[1]} món gửi kho" if dong_kho else None, nguoi], mau="b")
        if a == "san_xuat_sua_de_nghi_vat_tu":
            dn = dns.get(oid)
            return d("vat_tu", f"Sửa đề nghị vật tư lần {dn.lan_so}" if dn else "Sửa đề nghị vật tư",
                     [nguoi], mau="b")
        if a == "san_xuat_nhap_lai_vat_tu":
            return d("vat_tu", "Yêu cầu nhập lại vật tư thừa", [k.get("ma"), nguoi], mau="b")
        if a == "san_xuat_kho_yeu_cau_nhap":
            sl_kcs = k.get("so_luong_kcs")
            return d("vat_tu", "Đề nghị nhập kho thành phẩm",
                     [f"{_so(sl_kcs)} {dv_ra}".strip() if sl_kcs else None, k.get("ma"), nguoi], mau="b")
        # KCS
        if a == "san_xuat_kcs_kiem":
            if oid in kcs_tai or oid not in kcs_quy:
                dat, loi = float(k.get("dat", 0) or 0), float(k.get("loi", 0) or 0)
                return d("kcs", f"KCS kiểm {_so(dat)} đạt {_so(loi)} lỗi", [nguoi], mau="r" if loi > 0 else "g")
            m = re.search(rf"quy_loi\(cong_viec={cv.id}, sl=([\d.]+)\)", l.detail or "")
            buoc = ten_buoc(kcs_quy[oid].cong_viec_id)
            return d("kcs", f"KCS ở {buoc} ghi {_so(m[1])} lỗi do bước này" if m
                     else f"KCS ở {buoc} quy lỗi về bước này", [nguoi], mau="r")
        if a == "san_xuat_kcs_da_xem_loi":
            return d("kcs", "Tổ đã xem lỗi KCS", [nguoi])
        return d("khac", audit_registry.tra(a, l.target).nhan, [nguoi])

    def phia_phu(l) -> bool:
        """Cùng MỘT dòng audit kể từ bước bên kia: bàn giao nhìn từ bước nhận, KCS quy lỗi về bước
        này. Nhật ký lệnh gom mọi bước nên chỉ giữ một phía (`services/lsx_nhat_ky.py`)."""
        loai, _, sid = l.target.partition(":")
        oid = int(sid) if sid.isdigit() else 0
        if loai == "san_xuat_ban_giao":
            return oid in bgs and bgs[oid].nguon_cong_viec_id != cv.id
        if loai == "san_xuat_kcs_batch":
            return oid in kcs_quy and oid not in kcs_tai
        return False

    items = [{**x, "_phu": phia_phu(l)} for l in logs if (x := dung(l)) is not None]
    items += [
        {**_dong(gio(y.thoi_diem), "chay_may", f"Báo máy hỏng {y.bo_phan_hong}".strip(),
                 [y.ma, ten_may.get(y.may_id), "máy đang dừng" if y.may_dung else None, y.nguoi_bao_ten],
                 ly_do=y.mo_ta, mau="r"), "_ai": y.nguoi_bao_ten, "_uid": None}
        for y in su_co
    ]
    items.sort(key=lambda x: (x["luc"] or datetime.min, x["_id"]), reverse=True)
    if cv.created_at is not None:
        items.append({**_dong(gio(cv.created_at), "khac", "Tổ nhận lệnh",
                              [f"Gói phát hành {cv.phien_ban_so}" if cv.phien_ban_so else None]),
                      "_ai": "", "_uid": None})
    return items
