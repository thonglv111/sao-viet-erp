"""Nhật ký của MỘT lệnh sản xuất — tab "Nhật ký" ở chi tiết lệnh (10/10/2026).

Trước đây tab chỉ đọc audit có target `lsx:{id}`, nên một lệnh giao trọn gói đã nhận về, đã xuất
giấy, đã chi tiền vẫn chỉ hiện "Tạo lệnh" và "Sửa routing". Audit ghi theo đối tượng bị tác động,
nên ở đây gom MỌI đối tượng gắn với lệnh (đọc từ bảng, `repositories/lsx_nhat_ky_repo.py`):

- chính lệnh; lần gia công ngoài + phiếu chi của nó; bài ghép chứa lệnh; dòng xếp lịch; nhóm thành
  phẩm (đóng/mở lại lệnh); gói phát hành; phiếu đề nghị mua có dòng mua cho lệnh;
- từng công việc ở xưởng: dùng lại câu của tab Lịch sử bàn tổ (`san_xuat.lich_su_viec.cac_dong`)
  — chạy máy, giao thợ, mẻ, bàn giao, vật tư, KCS — gắn thẻ tên công đoạn;
- kho: đề nghị xuất/nhập và phiếu kho KHÔNG ghi audit, nên đọc mốc thẳng từ bảng (duyệt, từ chối,
  ghi sổ). Đề nghị đi qua công việc xưởng hoặc gia công ngoài đã có dòng audit lúc lập, không lặp.

Không bày TIỀN: phiếu chi chỉ nêu mã.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .. import audit_registry
from ..models.lsx import NHAN_TRANG_THAI
from ..models.stock_request import REQ_CANCELLED, REQ_NHAP, REQ_REJECTED
from ..models.stock_voucher import VOUCHER_CANCELLED, VOUCHER_NHAP, VOUCHER_POSTED
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.lsx_nhat_ky_repo import LsxNhatKyRepository
from .actor_display import actor_labels
from .san_xuat import lich_su_viec

_TONE = {"g": "moss", "r": "signal", "b": "steel"}
_KV = re.compile(r"(\w+)=([^\s]+)")


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _dong(at, *, action: str, tieu_de: str, uid: int | None = None, ten: str = "",
          the: list[str] | None = None, tone: str | None = None, buoc: str | None = None) -> dict:
    return {"at": _utc(at), "action": action, "tieu_de": tieu_de, "_uid": uid, "_ten": ten,
            "the": [t for t in (the or []) if t], "tone": tone, "buoc": buoc}


def _tu_audit(l, vouchers: dict) -> dict:
    """Một dòng audit của lệnh hoặc đối tượng gắn với lệnh → câu đọc được."""
    nhan = audit_registry.tra(l.action, l.target).nhan
    loai, _, sid = l.target.partition(":")
    d = (l.detail or "").strip()
    tieu_de, the = d or nhan, []
    if loai == "payment_voucher":
        ma, _, ly_do = d.partition(":") if l.action == "cancel_payment_voucher" else (d.split(" ")[0], "", "")
        tieu_de, the = f"{nhan} {ma.strip()}".strip(), [f"Lý do: {ly_do.strip()}" if ly_do.strip() else ""]
    elif loai == "department_purchase_request":
        tieu_de = f"{nhan} {d}".strip()
    elif loai == "san_xuat_nhom":
        k = dict(_KV.findall(d))
        tieu_de, the = nhan, [f"đạt {k['dat']}" if k.get("dat") else ""]
    elif loai == "voucher":
        v = vouchers.get(int(sid)) if sid.isdigit() else None
        try:
            j = json.loads(d)
        except ValueError:
            j = {}
        tieu_de = f"{nhan} {v.ma}" if v else nhan
        the = [j.get("noi_dung", ""), f"Lý do: {j['ly_do']}" if j.get("ly_do") else ""]
    elif l.action == "lsx_trang_thai":
        # Dòng cũ ghi mã thô ("→ san_sang"); từ 10/10/2026 máy chủ ghi nhãn.
        truoc, mui, ma_tt = d.rpartition(" → ")
        if mui and ma_tt in NHAN_TRANG_THAI:
            tieu_de = f"{truoc} → {NHAN_TRANG_THAI[ma_tt]}"
    elif l.action == "gia_cong_ngoai_huy" and d and not d.startswith("Huỷ"):
        tieu_de, the = nhan, [f"Lý do: {d}"]
    tone = "rust" if l.action in ("create_lsx", "lsx_trang_thai") else None
    return _dong(l.created_at, action=l.action, tieu_de=tieu_de, uid=l.actor_user_id,
                 ten=l.actor_name_luc_do or "", the=the, tone=tone)


def nhat_ky(db: Session, lsx_id: int) -> list[dict]:
    """Mới nhất trên cùng. Người gọi đã kiểm quyền xem lệnh."""
    repo = LsxNhatKyRepository(db)
    cvs = repo.cong_viec(lsx_id)
    cv_ids = [c.id for c in cvs]
    tgc = repo.thue_gia_cong(lsx_id, cv_ids)
    reqs = repo.yeu_cau_kho(lsx_id, cv_ids, tgc)
    vouchers = {v.id: v for v in repo.phieu_kho([r.id for r in reqs])}

    targets = (
        [f"lsx:{lsx_id}"]
        + [f"tgc_viec:{i}" for i in tgc["viec"]]
        + [f"tgc_don:{i}" for i in tgc["don"]]
        + [f"tgc_phieu_giao:{i}" for i in tgc["phieu_giao"]]
        + [f"tgc_phieu_nhan:{i}" for i in tgc["phieu_nhan"]]
        + [f"payment_voucher:{i}" for i in repo.phieu_chi(tgc["phieu_nhan"])]
        + [f"bai_ghep:{i}" for i in repo.bai_ghep(lsx_id)]
        + [f"xep_lich:{i}" for i in repo.xep_lich(lsx_id)]
        + [f"san_xuat_nhom:{i}" for i in repo.nhom(lsx_id)]
        + [f"san_xuat_goi:{i}" for i in repo.goi(cv_ids)]
        + [f"department_purchase_request:{i}" for i in repo.yeu_cau_mua(lsx_id)]
        + [f"voucher:{i}" for i in vouchers]
    )
    logs = [l for ds in AuditLogRepository(db).list_by_targets(targets).values() for l in ds]
    items = [_tu_audit(l, vouchers) for l in logs]

    # Công việc ở xưởng — câu của bàn tổ, gắn tên công đoạn. Một dòng audit chạm HAI bước của lệnh
    # (bàn giao, KCS quy lỗi) thì mỗi bước kể một câu — giữ câu của phía chính, bỏ phía phụ.
    dong_cv = [(cv, x) for cv in cvs for x in lich_su_viec.cac_dong(db, cv, gio=lambda dt: dt)]
    phia_chinh = {x["_id"] for _cv, x in dong_cv if x.get("_id") and not x.get("_phu")}
    for cv, x in dong_cv:
        if x.get("_phu") and x.get("_id") in phia_chinh:
            continue
        # Việc trọn gói không thuộc tổ nào — "Tổ nhận lệnh" sai nghĩa, dòng "Giao trọn gói" đã kể.
        if x["cau"] == "Tổ nhận lệnh" and cv.department_id is None:
            continue
        ten = x.get("_ai") or ""
        the = list(x["ct"])
        if ten and ten in the:
            the.remove(ten)
        if x.get("ly_do"):
            the.append(f"Lý do: {x['ly_do']}")
        items.append(_dong(x["luc"], action=f"cong_viec:{x['nhom']}", tieu_de=x["cau"],
                           uid=x.get("_uid"), ten=ten, the=the, tone=_TONE.get(x.get("mau") or ""),
                           buoc=cv.ten_cong_doan))

    # Kho — đề nghị và phiếu không ghi audit, đọc mốc từ bảng.
    da_co_audit = set(cv_ids)
    for r in reqs:
        chieu = "nhập" if r.loai == REQ_NHAP else "xuất"
        qua_audit = (r.san_xuat_cong_viec_id in da_co_audit or r.vat_tu_tra_cong_viec_id in da_co_audit
                     or r.tgc_phieu_giao_id in tgc["phieu_giao"]
                     or r.tgc_phieu_nhan_id in tgc["phieu_nhan"])
        if not qua_audit:
            items.append(_dong(r.created_at, action="kho_de_nghi", tieu_de=f"Lập đề nghị {chieu} kho {r.ma}",
                               uid=r.nguoi_tao_id, tone="steel"))
        if r.trang_thai == REQ_REJECTED and r.duyet_luc:
            items.append(_dong(r.duyet_luc, action="kho_tu_choi", tieu_de=f"Từ chối đề nghị {chieu} kho {r.ma}",
                               uid=r.nguoi_duyet_id, the=[f"Lý do: {r.ly_do_tu_choi}" if r.ly_do_tu_choi else ""],
                               tone="signal"))
        elif r.duyet_luc and r.nguoi_duyet_id:
            items.append(_dong(r.duyet_luc, action="kho_duyet", tieu_de=f"Duyệt đề nghị {chieu} kho {r.ma}",
                               uid=r.nguoi_duyet_id))
        if r.trang_thai == REQ_CANCELLED:
            items.append(_dong(r.updated_at, action="kho_huy", tieu_de=f"Huỷ đề nghị {chieu} kho {r.ma}",
                               the=[f"Lý do: {r.ly_do_huy}" if r.ly_do_huy else ""]))
    for v in vouchers.values():
        chieu = "nhập" if v.loai == VOUCHER_NHAP else "xuất"
        if v.trang_thai == VOUCHER_POSTED:
            items.append(_dong(v.ghi_so_luc or v.updated_at, action="kho_ghi_so",
                               tieu_de=f"Kho ghi sổ phiếu {chieu} {v.ma}",
                               uid=v.nguoi_ghi_so_id or v.nguoi_lap_id, tone="moss"))
        elif v.trang_thai != VOUCHER_CANCELLED:
            items.append(_dong(v.created_at, action="kho_lap_phieu", tieu_de=f"Kho lập phiếu {chieu} {v.ma}",
                               uid=v.nguoi_lap_id))

    nhan_ai = actor_labels(db, {x["_uid"] for x in items if x["_uid"]})
    for x in items:
        uid, ten = x.pop("_uid"), x.pop("_ten")
        x["actor_name"] = nhan_ai.get(uid) if uid else (ten or None)
    epoch = datetime.min.replace(tzinfo=timezone.utc)
    items.sort(key=lambda x: x["at"] or epoch, reverse=True)
    return items
