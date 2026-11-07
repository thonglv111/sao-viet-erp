"""Gom LẦN GIA CÔNG lúc phát hành, đồng bộ lúc phát hành cập nhật, huỷ khi thu hồi gói, dựng dict
đọc cho khối trên lệnh."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...audit_registry import tra
from ...models.gia_cong_ngoai import (
    KIEU_MOT_PHAN, KIEU_TRON_GOI, NOI_VE_KHACH, NOI_VE_KHO, NOI_VE_XUONG, GiaCongNgoai, _utcnow,
)
from ...models.lsx import LB_THUE_NGOAI, LsxCongDoan, LsxCongDoanPhuThuoc
from ...models.purchase import Supplier
from ...models.san_xuat import SanXuatCongViec
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.gia_cong_ngoai_repo import GiaCongNgoaiRepository
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from ..gio_xuong import thuc_te_hien_thi
from ..san_xuat.san_luong import he_so_nhanh_toa
from . import trang_thai
from .tron_goi import goi_y_cap_giay, ly_do_khong_nhan_ve


def _f(v) -> float | None:
    return float(v) if v is not None else None


def _canh_ke_tiep(db: Session, lsx_id: int) -> set[tuple[int, int]]:
    """Cạnh (buoc_truoc_id, buoc_sau_id) của lệnh — nguồn DUY NHẤT để biết hai bước có "liền
    nhau" hay chỉ tình cờ đứng cạnh nhau trong danh sách `thu_tu` (hai nhánh song song của cùng
    một bước cha KHÔNG liền nhau, dù `thu_tu` sát nhau)."""
    return set(db.execute(
        select(LsxCongDoanPhuThuoc.buoc_truoc_id, LsxCongDoanPhuThuoc.buoc_sau_id)
        .join(LsxCongDoan, LsxCongDoan.id == LsxCongDoanPhuThuoc.buoc_sau_id)
        .where(LsxCongDoan.lsx_id == lsx_id)
    ).all())


def _cap_ke_tiep_bai_ghep(db: Session, buoc_chungs: list) -> set[tuple[int, int]]:
    """Cặp (bước chung x, bước chung y) LIỀN NHAU ở MỌI lệnh thành viên — bước lệnh x phủ có cạnh
    DAG sang bước lệnh y phủ (routing không khai cạnh ⇒ so `thu_tu` liền kề, cùng luật
    `_quet_dai_thue_ngoai`). Chỉ một lệnh có bước riêng chen giữa là hai lần gia công khác nhau:
    hàng của lệnh đó phải về xưởng làm bước riêng rồi mới đi tiếp."""
    repo = SanXuatRepository(db)
    phu = {c.id: {m.lsx_id: m.lsx_step_key for m in c.thanh_phans} for c in buoc_chungs}
    cache: dict[int, tuple[dict, set, list]] = {}

    def lenh(lsx_id: int):
        if lsx_id not in cache:
            steps = repo.routing_steps(lsx_id)
            cache[lsx_id] = ({cd.step_key: cd for cd in steps}, _canh_ke_tiep(db, lsx_id),
                             [cd.step_key for cd in steps])
        return cache[lsx_id]

    def lien(lsx_id: int, k1: str, k2: str) -> bool:
        theo_key, canh, thu_tu = lenh(lsx_id)
        x, y = theo_key.get(k1), theo_key.get(k2)
        if x is None or y is None:
            return False
        if canh:
            return (x.id, y.id) in canh
        i = thu_tu.index(k1)
        return i + 1 < len(thu_tu) and thu_tu[i + 1] == k2

    ra: set[tuple[int, int]] = set()
    for x, y in zip(buoc_chungs, buoc_chungs[1:]):
        px, py = phu.get(x.id) or {}, phu.get(y.id) or {}
        if px and set(px) == set(py) and all(lien(l, px[l], py[l]) for l in px):
            ra.add((x.id, y.id))
    return ra


def _quet_dai_thue_ngoai(steps, canh: set[tuple[int, int]], cv_by_step: dict, *,
                         bi_phu: set[str] | None = None, bai_ghep: bool = False) -> list[list]:
    """Cắt routing (đã sắp `thu_tu`) thành các dải bước "Thuê ngoài" LIỀN NHAU, CÙNG nhà gia
    công. "Liền nhau" đi theo CẠNH DAG (`dai[-1].id → cd.id` phải có cạnh) — routing KHÔNG khai
    cạnh nào (tuyến tính cũ) thì lùi về so `thu_tu` liền kề như trước. Ném lỗi nếu gặp bước thuê
    ngoài chưa chọn nhà gia công.

    Bước LỆNH bị bài ghép phủ ngắt dải — nó thuộc lần của BÀI GHÉP (spec 2026-09-27 §3: bước chung
    và bước riêng không chung một lần). Nhận biết bằng `bi_phu` (step_key bị phủ, đọc từ bảng phủ)
    hoặc công việc của nó mang `bai_ghep_id`. `bai_ghep=True`: `steps` là các bước CHUNG của một bài
    (`canh` = `_cap_ke_tiep_bai_ghep`; rỗng nghĩa là không cặp nào liền nhau)."""
    co_canh_nao = bool(canh) or bai_ghep
    bi_phu = bi_phu or set()
    ra: list[list] = []
    dai: list = []

    def dong() -> None:
        if dai:
            ra.append(list(dai))
            dai.clear()

    for cd in steps:
        cvs = cv_by_step.get(cd.step_key) or []
        chung = not bai_ghep and (cd.step_key in bi_phu or any(cv.bai_ghep_id for cv in cvs))
        if cd.loai_buoc != LB_THUE_NGOAI or chung:
            dong()
            continue
        if cd.nha_cung_cap_id is None:
            noi = "màn Bài ghép" if bai_ghep else "Kế hoạch SX"
            raise ValueError(
                f"Bước{' chung' if bai_ghep else ''} “{cd.ten}” thuê ngoài chưa chọn nhà gia công "
                f"— chọn ở {noi} rồi phát hành lại.")
        if dai:
            ke_tiep = (not co_canh_nao) or ((dai[-1].id, cd.id) in canh)
            if dai[-1].nha_cung_cap_id != cd.nha_cung_cap_id or not ke_tiep:
                dong()
        dai.append(cd)
    dong()
    return ra


def _tao_lan(db: Session, audit: AuditLogRepository, *, dai: list, cv_by_step: dict,
             uid: int | None, lsx_id: int | None = None,
             bai_ghep_id: int | None = None) -> GiaCongNgoai:
    cuoi = dai[-1]
    gcn = GiaCongNgoai(
        lsx_id=lsx_id, bai_ghep_id=bai_ghep_id, kieu=KIEU_MOT_PHAN,
        nha_cung_cap_id=cuoi.nha_cung_cap_id, nha_cung_cap_ten=cuoi.nha_cung_cap or "",
        ten_viec=" + ".join(c.ten for c in dai),
        # Không có đơn giá (chủ chốt 27/09 + 07/10/2026): tiền kế toán gõ ở phiếu chi theo hoá
        # đơn nhà gia công. Đơn vị = đơn vị ra của bước cuối dải — đơn vị của con số chốt.
        don_vi=cuoi.don_vi_ra, created_by=uid,
    )
    db.add(gcn)
    db.flush()
    for c in dai:
        for cv in cv_by_step.get(c.step_key) or []:
            cv.gia_cong_ngoai_id = gcn.id
            cv.department_id = None
            cv.may_id = None
    audit.create(
        actor_user_id=uid, action="gia_cong_ngoai_dat", target=f"gia_cong_ngoai:{gcn.id}",
        detail=f"Phát hành: {gcn.ten_viec} — {gcn.nha_cung_cap_ten}", commit=False,
    )
    return gcn


def _huy_lan(db: Session, audit: AuditLogRepository, gcn: GiaCongNgoai, uid: int | None,
             ly_do: str) -> None:
    gcn.huy_luc, gcn.huy_boi_id, gcn.ly_do_huy = _utcnow(), uid, ly_do[:500]
    gcn.version += 1
    audit.create(actor_user_id=uid, action="gia_cong_ngoai_huy",
                 target=f"gia_cong_ngoai:{gcn.id}", detail=ly_do[:500], commit=False)


def gom_lan_khi_phat_hanh(db: Session, *, lsx_ids: set[int], cv_by_step: dict, actor) -> list:
    """Dải bước "Thuê ngoài" LIỀN NHAU, CÙNG nhà gia công ⇒ MỘT lần (spec §2). Gọi trong giao
    dịch phát hành, KHÔNG commit. Công việc của dải: gắn `gia_cong_ngoai_id`, gỡ tổ + máy (không
    vào bàn tổ nào). Bước đã bị bài ghép phủ bỏ qua — bài ghép là đợt 2 (spec §9)."""
    repo = SanXuatRepository(db)
    audit = AuditLogRepository(db)
    uid = getattr(actor, "id", None)
    tao: list[GiaCongNgoai] = []
    for lsx_id in sorted(lsx_ids):
        steps = repo.routing_steps(lsx_id)
        canh = _canh_ke_tiep(db, lsx_id)
        bi_phu = GiaCongNgoaiRepository(db).step_keys_bi_phu(lsx_id)
        for dai in _quet_dai_thue_ngoai(steps, canh, cv_by_step, bi_phu=bi_phu):
            tao.append(_tao_lan(db, audit, lsx_id=lsx_id, dai=dai, cv_by_step=cv_by_step, uid=uid))
    db.flush()
    return tao


def gom_lan_bai_ghep_khi_phat_hanh(db: Session, *, bai_ghep_ids: set[int], cv_by_step: dict,
                                   actor) -> list:
    """Bước CHUNG thuê ngoài của bài ghép (spec 2026-09-27 §2 bước 2): dải bước chung liền nhau
    (ở mọi lệnh thành viên), cùng nhà gia công ⇒ MỘT lần gắn `bai_ghep_id` (không gắn lệnh). Công
    việc chung của dải: gắn lần, gỡ tổ + máy. Gọi trong giao dịch phát hành, KHÔNG commit."""
    repo = SanXuatRepository(db)
    audit = AuditLogRepository(db)
    uid = getattr(actor, "id", None)
    tao: list[GiaCongNgoai] = []
    for bg_id in sorted(bai_ghep_ids or ()):
        steps = repo.bai_ghep_cong_doans(bg_id)
        canh = _cap_ke_tiep_bai_ghep(db, steps)
        for dai in _quet_dai_thue_ngoai(steps, canh, cv_by_step, bai_ghep=True):
            tao.append(_tao_lan(db, audit, bai_ghep_id=bg_id, dai=dai, cv_by_step=cv_by_step,
                                uid=uid))
    db.flush()
    return tao


def _phuc_hoi_cv_mo_coi(db: Session, gcn_repo: GiaCongNgoaiRepository, huy_trong_luot: list,
                        cd_by_step: dict) -> None:
    """Sau khi huỷ (các) lần trong lượt đồng bộ này: công việc nào VẪN còn trỏ `gia_cong_ngoai_id`
    về đúng lần vừa huỷ (nghĩa là KHÔNG được `_tao_lan` gom sang lần mới ngay sau đó — bước đã hết
    thuê ngoài, hoặc dải co lại bỏ rơi nó) là việc MỒ CÔI: gỡ liên kết, trả lại tổ/máy theo routing
    HIỆN TẠI của đúng bước đó (cùng nguồn `lsx_cong_doan.department_id`/`may_id` mà phát hành lần
    đầu dùng — không suy đoán lại)."""
    for gcn in huy_trong_luot:
        for cv in gcn_repo.cong_viec_cua(gcn.id):
            cd = cd_by_step.get(cv.step_key)
            cv.gia_cong_ngoai_id = None
            cv.department_id = cd.department_id if cd is not None else None
            cv.may_id = cd.may_id if cd is not None else None


def dong_bo_lan_khi_cap_nhat(db: Session, *, lsx_ids: set[int], actor) -> None:
    """Sau Phát hành cập nhật (§4.3): đồng bộ lần gia công theo routing hiện tại — IDEMPOTENT,
    KHÔNG commit.

    Lần đã MANG ĐI hoặc đã CHỐT giữ NGUYÊN tuyệt đối (hàng đã ở ngoài xưởng — sửa lại là xoá vết,
    kể cả khi kế hoạch đổi nhà gia công/routing sau đó). Lần CHƯA mang đi:
      · Dải KHÔNG đổi (đúng tập công việc cũ) ⇒ chỉ đồng bộ NCC/tên/đơn giá theo routing hiện tại,
        không đẻ dòng mới, giữ nguyên lịch sử/`id`.
      · Dải ĐỔI (bước thêm/bớt, hoặc hai lần cũ giờ gộp làm một) ⇒ HUỶ (các) dòng cũ rồi gom lại
        từ đầu — cùng một hàm `_quet_dai_thue_ngoai`/`_tao_lan` mà lúc phát hành lần đầu dùng.
      · Bước MỚI vừa đổi routing thành "Thuê ngoài" (trước đó không phải) cũng được gom thành lần.
      · Bước KHÔNG còn nằm trong dải thuê ngoài nào (đổi lại thành nội bộ) ⇒ lần cũ của nó bị huỷ.

    Việc MỒ CÔI (Fix round 2): huỷ lần không tự xoá `gia_cong_ngoai_id` trên công việc — công việc
    nào bị bỏ lại (bước hết thuê ngoài, hoặc dải co lại) được trả về tổ/máy theo routing hiện tại
    ở CUỐI hàm (`_phuc_hoi_cv_mo_coi`), sau khi mọi lần mới đã gom xong (để không giành lại nhầm
    công việc vừa được gom sang lần mới)."""
    repo = SanXuatRepository(db)
    gcn_repo = GiaCongNgoaiRepository(db)
    audit = AuditLogRepository(db)
    uid = getattr(actor, "id", None)

    for lsx_id in sorted(lsx_ids):
        steps = repo.routing_steps(lsx_id)
        cv_by_step: dict[str, list] = {}
        for cv in db.execute(
            select(SanXuatCongViec).where(SanXuatCongViec.lsx_id == lsx_id)
        ).scalars():
            if cv.step_key:
                cv_by_step.setdefault(cv.step_key, []).append(cv)
        # Bước bị bài ghép PHỦ không có công việc mang `lsx_id` (công việc chung mang `bai_ghep_id`)
        # ⇒ phải đọc bảng phủ, không thì nó bị coi như bước riêng: lần RỖNG hoặc "chưa chọn nhà gia
        # công" (lỗi phát hiện 27/09/2026 — spec đợt 2 §1).
        dai_list = _quet_dai_thue_ngoai(steps, _canh_ke_tiep(db, lsx_id), cv_by_step,
                                        bi_phu=gcn_repo.step_keys_bi_phu(lsx_id))
        _dong_bo_mot(db, audit, gcn_repo, uid, steps=steps, cv_by_step=cv_by_step,
                     dai_list=dai_list, lans=gcn_repo.cua_lenh(lsx_id), nguon={"lsx_id": lsx_id})
    db.flush()


def dong_bo_lan_bai_ghep_khi_cap_nhat(db: Session, *, bai_ghep_ids: set[int], actor) -> None:
    """Phát hành cập nhật nguồn BÀI GHÉP: đồng bộ lần của bước chung theo kế hoạch bài hiện tại —
    cùng luật `dong_bo_lan_khi_cap_nhat` (lần đã mang đi / đã chốt giữ nguyên). KHÔNG commit."""
    repo = SanXuatRepository(db)
    gcn_repo = GiaCongNgoaiRepository(db)
    audit = AuditLogRepository(db)
    uid = getattr(actor, "id", None)
    for bg_id in sorted(bai_ghep_ids or ()):
        steps = repo.bai_ghep_cong_doans(bg_id)
        cv_by_step: dict[str, list] = {}
        for cv in gcn_repo.cong_viec_chung_song(bg_id):
            cv_by_step.setdefault(cv.step_key, []).append(cv)
        dai_list = _quet_dai_thue_ngoai(steps, _cap_ke_tiep_bai_ghep(db, steps), cv_by_step,
                                        bai_ghep=True)
        _dong_bo_mot(db, audit, gcn_repo, uid, steps=steps, cv_by_step=cv_by_step,
                     dai_list=dai_list, lans=gcn_repo.cua_bai_ghep(bg_id),
                     nguon={"bai_ghep_id": bg_id})
    db.flush()


def _dong_bo_mot(db: Session, audit: AuditLogRepository, gcn_repo: GiaCongNgoaiRepository,
                 uid: int | None, *, steps: list, cv_by_step: dict, dai_list: list, lans: list,
                 nguon: dict) -> None:
    """Lõi đồng bộ của MỘT nguồn (một lệnh hoặc một bài ghép) — xem `dong_bo_lan_khi_cap_nhat`."""
    cd_by_step = {cd.step_key: cd for cd in steps}
    # Lần MỞ (chưa mang đi / chưa chốt / chưa huỷ) — thứ DUY NHẤT được đụng vào ở đây.
    mo = [g for g in lans
          if g.kieu == KIEU_MOT_PHAN and g.huy_luc is None and g.chot_luc is None
          and g.mang_di_luc is None]
    mo_by_step: dict[str, GiaCongNgoai] = {}
    for g in mo:
        for cv in gcn_repo.cong_viec_cua(g.id):
            if cv.step_key:
                mo_by_step[cv.step_key] = g

    da_xu_ly: set[int] = set()
    huy_trong_luot: list[GiaCongNgoai] = []
    for dai in dai_list:
        step_keys = [c.step_key for c in dai]
        lans_lien_quan = {mo_by_step[sk] for sk in step_keys if sk in mo_by_step}
        cuoi = dai[-1]
        if len(lans_lien_quan) == 1:
            (gcn,) = lans_lien_quan
            cv_hien_tai = {cv.id for c in dai for cv in cv_by_step.get(c.step_key) or []}
            cv_cua_lan = {cv.id for cv in gcn_repo.cong_viec_cua(gcn.id)}
            if cv_hien_tai == cv_cua_lan:
                # Dải KHÔNG đổi — chỉ đồng bộ NCC/tên/đơn vị theo routing hiện tại.
                doi = (gcn.nha_cung_cap_id != cuoi.nha_cung_cap_id
                       or gcn.don_vi != cuoi.don_vi_ra)
                if doi:
                    gcn.nha_cung_cap_id = cuoi.nha_cung_cap_id
                    gcn.nha_cung_cap_ten = cuoi.nha_cung_cap or ""
                    gcn.ten_viec = " + ".join(c.ten for c in dai)
                    gcn.don_vi = cuoi.don_vi_ra
                    gcn.version += 1
                    audit.create(
                        actor_user_id=uid, action="gia_cong_ngoai_dat",
                        target=f"gia_cong_ngoai:{gcn.id}",
                        detail=f"Cập nhật lịch: đồng bộ nhà gia công — "
                               f"{gcn.nha_cung_cap_ten}",
                        commit=False,
                    )
                da_xu_ly.add(gcn.id)
                continue
        # Dải mới hoặc dải đã đổi bố cục — huỷ (các) lần cũ liên quan rồi gom lại từ đầu.
        for gcn in lans_lien_quan:
            if gcn.id in da_xu_ly:
                continue
            _huy_lan(db, audit, gcn, uid, "Cập nhật lịch — routing đổi, gom lại lần gia công.")
            da_xu_ly.add(gcn.id)
            huy_trong_luot.append(gcn)
        gcn_moi = _tao_lan(db, audit, dai=dai, cv_by_step=cv_by_step, uid=uid, **nguon)
        da_xu_ly.add(gcn_moi.id)

    # Lần mở còn lại không nằm trong dải thuê-ngoài nào nữa (routing đổi lại thành nội bộ).
    for g in mo:
        if g.id not in da_xu_ly:
            _huy_lan(db, audit, g, uid, "Cập nhật lịch — bước không còn thuê ngoài.")
            huy_trong_luot.append(g)

    # Trả việc MỒ CÔI về tổ/máy — làm SAU CÙNG, sau khi mọi lần mới trong lượt này đã gom
    # xong, để không cướp nhầm công việc vừa được `_tao_lan` gán sang lần mới.
    _phuc_hoi_cv_mo_coi(db, gcn_repo, huy_trong_luot, cd_by_step)


def huy_lan_cua_goi(db: Session, *, goi_id: int, actor, ly_do: str) -> int:
    """Gói bị thu hồi ⇒ lần CHƯA mang đi và CHƯA chốt của gói HUỶ theo (không xoá — giữ vết). Lần
    đã mang đi / đã chốt giữ NGUYÊN — hàng đã ở ngoài xưởng hoặc đã ghi sổ, huỷ là xoá vết (bình
    thường `co_cong_viec_da_bat_dau` đã chặn từ trước khi gọi tới đây; kiểm lại ở đây cho chắc).
    KHÔNG commit."""
    repo = GiaCongNgoaiRepository(db)
    audit = AuditLogRepository(db)
    uid = getattr(actor, "id", None)
    n = 0
    for gcn in repo.lan_cua_goi(goi_id):
        if gcn.huy_luc is not None or gcn.chot_luc is not None or gcn.mang_di_luc is not None:
            continue
        _huy_lan(db, audit, gcn, uid, ly_do)
        n += 1
    db.flush()
    return n


def noi_ve_hop_le(db: Session, gcn, chang_sau: list) -> list[str]:
    """Dải còn chặng sau ⇒ chỉ về xưởng. Dải chứa bước cuối / trọn gói ⇒ kho, hoặc khách khi dòng
    đơn của lệnh đứng riêng một cụm bán (§4 bước 5). Lần của BÀI GHÉP không có nhánh giao thẳng
    (spec 2026-09-27 §3 — các lệnh thường thuộc nhiều đơn/khách)."""
    if chang_sau:
        return [NOI_VE_XUONG]
    if gcn.bai_ghep_id is not None:
        return [NOI_VE_KHO]
    # Bản cài tắt giao hàng: giao thẳng ghi chuyến giao, mà phân hệ đó không có ⇒ chỉ còn về kho.
    from ...phan_he import GIAO_HANG, tat

    if tat(GIAO_HANG):
        return [NOI_VE_KHO]
    from .giao_thang import dong_don_dung_rieng

    return [NOI_VE_KHO, NOI_VE_KHACH] if dong_don_dung_rieng(db, gcn.lsx_id) else [NOI_VE_KHO]


def _goi_y_chot(gcn, dau, cuoi) -> float | None:
    """Số điền sẵn khi chốt, theo ĐƠN VỊ CỦA LẦN (đầu ra bước cuối). Hàng gửi đi tính theo đầu vào
    bước đầu (vd tờ) còn chốt tính theo đầu ra bước cuối (vd con) — quy qua tỉ lệ ra/vào kế hoạch
    của chính dải, không điền thẳng số tờ vào ô con. Trọn gói lấy số đặt."""
    if gcn.sl_gui is None:
        return _f(gcn.sl_dat)
    vao = float(dau.so_luong_vao or 0) if dau is not None else 0
    ra = float(cuoi.so_luong_ra or 0) if cuoi is not None else 0
    if vao <= 0 or ra <= 0:
        return _f(gcn.sl_gui)
    return float(round(float(gcn.sl_gui) * ra / vao))


def _ly_do_khong_mo_lai(db: Session, gcn, *, pc, cuoi) -> str | None:
    from .chot import ly_do_khong_mo_lai  # chot import lan ⇒ import trễ tránh vòng

    return ly_do_khong_mo_lai(db, gcn, pc=pc, cuoi=cuoi)


def co_buoc_truoc(db: Session, dau) -> bool:
    """Công việc đầu của lần có bước đứng trước không (không ⇒ người mang đi tự gõ số). Công việc
    CHUNG của bài ghép không có `lsx_cong_doan_id` ⇒ suy theo chặng trước (bàn giao đến từ đâu)."""
    if dau is None:
        return False
    if dau.bai_ghep_cong_doan_id is not None:
        return bool(SanXuatSanLuongRepository(db).cong_viec_chang_truoc(dau))
    return GiaCongNgoaiRepository(db).co_buoc_truoc(dau.lsx_cong_doan_id)


NHANH_TOA, NHANH_XUONG, NHANH_KHO = "toa", "xuong", "kho"


def nhanh_bai_ghep(db: Session, cuoi, chang_sau: list) -> str:
    """Cái đứng sau lần gia công của bài ghép (spec 2026-09-27 §3): điểm toả sang bước riêng từng
    lệnh (cạnh toả mang `ty_le_ghep` do phát hành dựng) · bước chung kế tiếp · hết bước."""
    if cuoi is not None and any(
            c.ty_le_ghep for c in SanXuatSanLuongRepository(db).canh_toa_di_tu(cuoi.id)):
        return NHANH_TOA
    return NHANH_XUONG if chang_sau else NHANH_KHO


def nguon_lan(db: Session, gcn) -> dict:
    """Nhãn nguồn của lần: mã lệnh, hoặc "BG-01 (LSX-A, LSX-B)" cho lần của bài ghép — dùng cho
    khối trên màn, hàng chờ chi, lý do phiếu chi."""
    sx = SanXuatRepository(db)
    if gcn.bai_ghep_id is None:
        lsx = sx.lsx(gcn.lsx_id) if gcn.lsx_id else None
        ma = lsx.ma if lsx else ""
        return {"lsx_ma": ma, "bai_ghep_ma": None, "lenh": [], "nhan_nguon": ma}
    repo = GiaCongNgoaiRepository(db)
    bg = repo.bai_ghep(gcn.bai_ghep_id)
    so_con = sx.thanh_vien_so_con({gcn.bai_ghep_id})
    ma_lenh = repo.ma_cua_lenh(so_con)
    lenh = [{"id": i, "ma": ma_lenh.get(i, ""), "so_con": so_con[i]}
            for i in sorted(so_con, key=lambda i: (ma_lenh.get(i, ""), i))]
    ma_bg = bg.ma if bg else ""
    return {"lsx_ma": "", "bai_ghep_ma": ma_bg, "lenh": lenh,
            "nhan_nguon": f"{ma_bg} ({', '.join(l['ma'] for l in lenh)})"}


def chia_theo_lenh(db: Session, gcn, cuoi, chang_sau: list) -> list[dict]:
    """Bảng chia số chốt về từng lệnh — hộp chốt hiện TRƯỚC khi bấm (spec 2026-09-27 §2 bước 5).
    Rỗng khi lần không toả (lần của lệnh, hoặc chốt về bước chung kế — một bàn giao)."""
    if gcn.bai_ghep_id is None or cuoi is None:
        return []
    nhanh = nhanh_bai_ghep(db, cuoi, chang_sau)
    sl_repo = SanXuatSanLuongRepository(db)
    repo = GiaCongNgoaiRepository(db)
    ra: list[dict] = []
    if nhanh == NHANH_TOA:
        for c in sl_repo.canh_toa_di_tu(cuoi.id):
            dich = sl_repo.cong_viec(c.dich_cong_viec_id)
            if not c.ty_le_ghep or dich is None or dich.lsx_id is None:
                continue
            # `he_so_nhan` = đúng hệ số toả dùng lúc chốt: bước nhận ăn tờ ghép thì × 1 (nó tự cắt
            # ra `so_con` con mỗi tờ), ăn con thì × số con/tờ.
            ra.append({"lsx_id": dich.lsx_id, "so_con": float(c.ty_le_ghep),
                       "he_so_nhan": he_so_nhanh_toa(c),
                       "don_vi": c.don_vi_dich or dich.don_vi_vao, "buoc_nhan": dich.ten_cong_doan})
    elif nhanh == NHANH_KHO:
        don_vi = repo.don_vi_ra_buoc_bi_phu(cuoi.bai_ghep_cong_doan_id)
        for lsx_id, con in SanXuatRepository(db).thanh_vien_so_con({gcn.bai_ghep_id}).items():
            ra.append({"lsx_id": lsx_id, "so_con": float(con), "he_so_nhan": float(con),
                       "don_vi": don_vi.get(lsx_id) or cuoi.don_vi_ra, "buoc_nhan": None})
    ma = repo.ma_cua_lenh({r["lsx_id"] for r in ra})
    for r in ra:
        r["lsx_ma"] = ma.get(r["lsx_id"], "")
    ra.sort(key=lambda r: (r["lsx_ma"], r["lsx_id"]))
    return ra


def lan_dict(db: Session, gcn, *, _cache: dict | None = None) -> dict:
    repo = GiaCongNgoaiRepository(db)
    sl_repo = SanXuatSanLuongRepository(db)
    cvs = repo.cong_viec_cua(gcn.id)
    dau = cvs[0] if cvs else None
    cuoi = cvs[-1] if cvs else None
    chang_sau = sl_repo.cong_viec_chang_sau(cuoi) if cuoi is not None else []
    cho = repo.ban_giao_cho_mang_di(dau.id) if dau is not None and gcn.kieu == KIEU_MOT_PHAN else []
    ten = repo.user_names({gcn.created_by, gcn.mang_di_boi_id, gcn.chot_boi_id, gcn.huy_boi_id})
    # Số điện thoại đọc SỐNG từ danh mục (lần chỉ chép tên lúc đặt) — người kế hoạch gọi nhà gia
    # công hỏi hàng ngay trên khối, khỏi mở màn Nhà cung cấp.
    ncc = db.get(Supplier, gcn.nha_cung_cap_id)
    pc = repo.phieu_chi_song([gcn.id]).get(gcn.id)
    nguon = nguon_lan(db, gcn)
    # Chỉ trọn gói xưởng cấp giấy mới có đề nghị xuất giấy — lần khác khỏi tốn câu hỏi kho.
    xuat = (repo.yeu_cau_xuat_cua(gcn.id)
            if gcn.kieu == KIEU_TRON_GOI and gcn.xuong_cap_giay else [])
    return {
        "id": gcn.id, "lsx_id": gcn.lsx_id, "lsx_ma": nguon["lsx_ma"],
        "bai_ghep_id": gcn.bai_ghep_id, "bai_ghep_ma": nguon["bai_ghep_ma"],
        "lenh": nguon["lenh"], "nhan_nguon": nguon["nhan_nguon"],
        "chia_theo_lenh": chia_theo_lenh(db, gcn, cuoi, chang_sau),
        # Người xem thao tác được không — router điền theo phạm vi (lần của bài ghép cần phạm vi
        # trên MỌI lệnh thành viên, spec 2026-09-27 §5).
        "chi_xem": False,
        "kieu": gcn.kieu, "trang_thai": trang_thai(gcn),
        "nha_cung_cap_id": gcn.nha_cung_cap_id, "nha_cung_cap_ten": gcn.nha_cung_cap_ten,
        "nha_cung_cap_sdt": (ncc.phone or None) if ncc is not None else None,
        # Mốc "giao việc": trọn gói = lúc đặt; một phần = lúc phát hành gom ra lần này.
        "tao_boi_ten": ten.get(gcn.created_by), "tao_luc": thuc_te_hien_thi(gcn.created_at),
        "ten_viec": gcn.ten_viec, "don_vi": gcn.don_vi,
        "sl_dat": _f(gcn.sl_dat), "xuong_cap_giay": bool(gcn.xuong_cap_giay),
        "don_vi_gui": dau.don_vi_vao if dau is not None else None,
        "sl_cho_mang_di": round(sum(float(b.so_luong) for b in cho), 3),
        "co_buoc_truoc": co_buoc_truoc(db, dau),
        "mang_di_boi_ten": ten.get(gcn.mang_di_boi_id), "mang_di_luc": thuc_te_hien_thi(gcn.mang_di_luc),
        "sl_gui": _f(gcn.sl_gui),
        "sl_goi_y_chot": _goi_y_chot(gcn, dau, cuoi),
        "chot_boi_ten": ten.get(gcn.chot_boi_id), "chot_luc": thuc_te_hien_thi(gcn.chot_luc),
        "sl_cuoi": _f(gcn.sl_cuoi), "noi_ve": gcn.noi_ve,
        "noi_ve_hop_le": noi_ve_hop_le(db, gcn, chang_sau if gcn.kieu == KIEU_MOT_PHAN else []),
        "chang_sau": [{"id": c.id, "ten": c.ten_cong_doan} for c in chang_sau],
        "huy_boi_ten": ten.get(gcn.huy_boi_id), "huy_luc": thuc_te_hien_thi(gcn.huy_luc),
        "ly_do_huy": gcn.ly_do_huy,
        "phieu_chi": {"id": pc.id, "code": pc.code} if pc is not None else None,
        "ly_do_khong_mo_lai": _ly_do_khong_mo_lai(db, gcn, pc=pc, cuoi=cuoi),
        # Nhật ký hiện NGAY trên lần (spec §6) — đọc thẳng audit theo target, nhãn từ registry.
        # Chi tiết audit của lần gia công viết sẵn bằng lời (không mã nội bộ, không tiền).
        "lich_su": [
            {"luc": thuc_te_hien_thi(a.created_at), "ai": a.actor_name_luc_do or "",
             "viec": tra(a.action).nhan, "chi_tiet": a.detail or ""}
            for a in AuditLogRepository(db).list_by_target(f"gia_cong_ngoai:{gcn.id}", limit=50)
        ],
        "xuat_giay": _xuat_giay(xuat, repo),
        "cap_giay": goi_y_cap_giay(db, gcn, co_xuat=bool(xuat)),
        "ly_do_khong_nhan_ve": ly_do_khong_nhan_ve(repo, gcn, xuat),
        "version": gcn.version,
    }


def _xuat_giay(xuat: list, repo: GiaCongNgoaiRepository) -> dict | None:
    """Đề nghị xuất giấy còn sống + khổ / số tờ của dòng giấy — ô Giấy hiện thẻ khổ, số tờ, trạng
    thái kho, mã đề nghị và các phiếu xuất kho đã lập theo nó (bấm mở được)."""
    if not xuat:
        return None
    r = xuat[0]
    ln = next((x for x in r.lines if x.hang_loai == "giay"), None)
    return {"id": r.id, "ma": r.ma, "trang_thai": r.trang_thai,
            "kho_rong": int(ln.kho_rong or 0) if ln is not None else 0,
            "kho_dai": int(ln.kho_dai or 0) if ln is not None else 0,
            "so_to": _f(ln.sl_de_nghi) if ln is not None else None,
            "don_vi": ln.dvt if ln is not None else None,
            "phieu": [{"id": v.id, "ma": v.ma, "ngay": v.ngay, "trang_thai": v.trang_thai}
                      for v in repo.phieu_cua_yeu_cau(r.id)]}


def _lan_huy_gon(gcn, *, lsx_ma: str, ten: dict) -> dict:
    """Lần ĐÃ HUỶ trên màn lệnh chỉ là một dòng trong "Đã huỷ N lần" (ai huỷ, lúc nào, vì sao) —
    khỏi dựng phần cấp giấy / phiếu chi / bước sau / nhật ký: mỗi thứ là câu hỏi DB, nhân theo số
    lần huỷ, mà màn không đọc."""
    return {
        "id": gcn.id, "lsx_id": gcn.lsx_id, "lsx_ma": lsx_ma, "nhan_nguon": lsx_ma,
        "bai_ghep_id": gcn.bai_ghep_id, "kieu": gcn.kieu, "trang_thai": trang_thai(gcn),
        "nha_cung_cap_id": gcn.nha_cung_cap_id, "nha_cung_cap_ten": gcn.nha_cung_cap_ten,
        "tao_boi_ten": ten.get(gcn.created_by), "tao_luc": thuc_te_hien_thi(gcn.created_at),
        "ten_viec": gcn.ten_viec, "don_vi": gcn.don_vi, "sl_dat": _f(gcn.sl_dat),
        "xuong_cap_giay": bool(gcn.xuong_cap_giay),
        "huy_boi_ten": ten.get(gcn.huy_boi_id), "huy_luc": thuc_te_hien_thi(gcn.huy_luc),
        "ly_do_huy": gcn.ly_do_huy, "version": gcn.version,
    }


def lan_cua_lenh(db: Session, lsx_id: int) -> list[dict]:
    """Lần của lệnh + lần của BÀI GHÉP chứa lệnh (màn lệnh hiện dòng chỉ đọc cho lần bài ghép —
    thao tác ở màn bài ghép, spec 2026-09-27 §4). Lần đã huỷ đi bản gọn (`_lan_huy_gon`)."""
    repo = GiaCongNgoaiRepository(db)
    cua_lenh = repo.cua_lenh(lsx_id)
    huy = [g for g in cua_lenh if g.huy_luc is not None]
    gon: dict[int, dict] = {}
    if huy:
        ma = repo.ma_cua_lenh({lsx_id}).get(lsx_id, "")
        ten = repo.user_names({u for g in huy for u in (g.created_by, g.huy_boi_id)})
        gon = {g.id: _lan_huy_gon(g, lsx_ma=ma, ten=ten) for g in huy}
    ra = [gon.get(g.id) or lan_dict(db, g) for g in cua_lenh]
    bg_id = repo.bai_ghep_cua_lenh(lsx_id)
    if bg_id is not None:
        ra += [{**lan_dict(db, g), "chi_xem": True} for g in repo.cua_bai_ghep(bg_id)
               if g.huy_luc is None]
    return ra


def lan_cua_bai_ghep(db: Session, bai_ghep_id: int) -> list[dict]:
    return [lan_dict(db, g) for g in GiaCongNgoaiRepository(db).cua_bai_ghep(bai_ghep_id)]
