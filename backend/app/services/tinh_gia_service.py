"""Service tính giá THEO THÀNH PHẦN — resolve danh mục cho phiếu rồi gọi `thanh_phan_engine`.

`compute_phieu_snapshot(db, phieu)` bơm khổ/gsm/công thức giấy + máy + công đoạn (kèm
`cong_thuc_gia`) cho mọi thành phần, chạy engine, ghi ảnh chụp kết quả lên phiếu.
1 engine duy nhất (`thanh_phan_engine`); engine `/preview` cũ đã bỏ.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models.cong_doan import CongDoan, CongDoanMay
from ..models.may_thiet_bi import MayThietBi
from ..models.vat_lieu_kho import GiayNguyen, VatTuInAn
from .dong_giay import ban_do_tram
from .thanh_phan_engine import compute_phieu


def _f(v, d: float = 0.0) -> float:
    if v is None:
        return d
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


@dataclass
class DanhMucNapSan:
    """Danh mục mà CẢ PHIẾU trỏ tới, nạp một lượt (04/10/2026). Trước đây mỗi sản phẩm tự hỏi lại
    giấy, máy, công thức theo máy, công đoạn, vật tư, chip — 6 câu SQL mỗi sản phẩm, phiếu 10 sản
    phẩm là 60 câu cho một lần xem trước. Nay mỗi loại MỘT câu `IN (...)` cho cả phiếu, số câu không
    tăng theo số sản phẩm / bước / vật tư. Giữ map cũng là giữ đối tượng sống: identity map của
    Session chỉ giữ tham chiếu yếu."""
    giay: dict[int, GiayNguyen] = field(default_factory=dict)
    may: dict[int, MayThietBi] = field(default_factory=dict)
    # may_id → {cong_doan_id: công thức giá của cặp (công đoạn, máy)}
    ct_gia_may: dict[int, dict[int, str]] = field(default_factory=dict)
    cong_doan: dict[int, CongDoan] = field(default_factory=dict)
    vat_tu: dict[int, VatTuInAn] = field(default_factory=dict)
    # Đơn vị + cặp quy đổi (`don_vi_map` / `cap_map`) — để quy đơn giá giấy khai theo ram/tấn/...
    # về giá một tờ (một kg). Chỉ nạp khi phiếu có giấy.
    dvs: dict[str, dict] = field(default_factory=dict)
    cap: dict[str, dict[str, float]] = field(default_factory=dict)


def he_so_gia_giay(ma: str | None, nap: DanhMucNapSan) -> float | None:
    """Hệ số nhân đơn giá giấy khai theo `ma` ra giá MỘT TỜ (16/10/2026): đ/ram × 1/500.

    Giấy bán theo cân không về tờ được ⇒ về kg (đ/tấn × 1/1.000), công thức cân của engine đếm
    kg. `to`/`kg` = 1. Không có đường quy đổi (hoặc chưa khai đơn vị) ⇒ None — engine lùi về luật
    cũ, không bịa hệ số."""
    from .quy_doi_service import duong_di, he_so_duong

    if not ma:
        return None
    ma = ma.strip().lower()
    for goc in ("to", "kg"):
        if ma == goc:
            return 1.0
        duong = duong_di(ma, goc, nap.cap)
        if duong:
            hs = he_so_duong(duong, nap.cap)
            return 1.0 / hs if hs > 0 else None
    return None


def nap_danh_muc_phieu(db: Session, tps) -> DanhMucNapSan:
    giay_ids = {int(tp.giay_id) for tp in tps if tp.giay_id is not None}
    may_ids = {int(tp.may_id) for tp in tps if tp.may_id is not None}
    cd_ids = {int(r.cong_doan_id) for tp in tps for r in tp.thanh_phams if r.cong_doan_id is not None}
    vt_ids = {int(v.vat_tu_id) for tp in tps for r in tp.thanh_phams for v in r.vat_tus
              if v.vat_tu_id is not None}
    nap = DanhMucNapSan()
    if giay_ids:
        nap.giay = {g.id: g for g in db.execute(
            select(GiayNguyen).where(GiayNguyen.id.in_(giay_ids))).scalars()}
        from ..repositories.don_vi_do_repo import DonViDoRepository
        from .quy_doi_service import cap_map, don_vi_map

        repo = DonViDoRepository(db)
        nap.dvs = don_vi_map(repo.all_rows())
        nap.cap = cap_map(repo.cap_rows())
    if may_ids:
        nap.may = {m.id: m for m in db.execute(
            select(MayThietBi).where(MayThietBi.id.in_(may_ids))).scalars()}
        for may_id, cd_id, ct in db.execute(
            select(CongDoanMay.may_id, CongDoanMay.cong_doan_id, CongDoanMay.cong_thuc_gia)
            .where(CongDoanMay.may_id.in_(may_ids))
        ).all():
            nap.ct_gia_may.setdefault(int(may_id), {})[int(cd_id)] = ct or ""
    if cd_ids:
        nap.cong_doan = {c.id: c for c in db.execute(
            select(CongDoan).where(CongDoan.id.in_(cd_ids))).scalars()}
    if vt_ids:
        nap.vat_tu = {v.id: v for v in db.execute(
            select(VatTuInAn).where(VatTuInAn.id.in_(vt_ids))
            .options(selectinload(VatTuInAn.chips))).scalars()}
    return nap


def _vat_tus_cua_buoc(db: Session, buoc: PhieuThanhPham,
                      vat_tu_map: dict[int, VatTuInAn] | None = None) -> list[dict]:
    """Vật tư của MỘT bước kèm công thức giá + chip của vật tư (engine không tự tra DB).

    Vật tư đã xoá khỏi danh mục thì bỏ im lặng — danh mục là nguồn sống."""
    out: list[dict] = []
    for vt in sorted(buoc.vat_tus or [], key=lambda r: (r.thu_tu or 0, r.id or 0)):
        m = vat_tu_map.get(vt.vat_tu_id) if vat_tu_map is not None else db.get(VatTuInAn, vt.vat_tu_id)
        if m is None:
            continue
        out.append({
            "vat_tu_id": m.id,
            "ten": m.ten,
            "don_gia": _f(m.don_gia),
            "don_vi_gia": m.don_vi_gia,
            "cong_thuc_gia": m.cong_thuc_gia,
            "cong_thuc_dinh_muc": m.cong_thuc_dinh_muc,
            "chips": [{"ma": c.ma, "ten": c.ten, "don_vi": c.don_vi} for c in m.chips],
            "gia_tri_chip": dict(vt.gia_tri_chip or {}),
        })
    return out


def _cong_doan_to_dict(cd: CongDoan, tram: dict[str, str] | None = None,
                       *, ct_gia_may: str | None = None) -> dict:
    return {
        "id": cd.id,
        "ma": cd.ma,
        "ten": cd.ten,
        # Tên in cho thợ — engine gọi bước bằng tên này khi có (`_ten_buoc`), cho khớp đúng chip
        # người lập phiếu nhìn thấy bên màn phiếu (`cdName` bên FE cũng ưu tiên nó).
        "ten_hien_thi": cd.ten_hien_thi,
        "nhom": cd.nhom,
        "kieu_bu_hao": cd.kieu_bu_hao,
        "bac_bu_hao": cd.bac_bu_hao,
        "so_to_bu_hao": cd.so_to_bu_hao,
        "che_do_tinh": cd.che_do_tinh,
        "pricing_basis": cd.pricing_basis,
        # G2: bơm công thức cấu hình → engine dùng thay pricing_basis cũ.
        # 06/09/2026: công thức của CẶP (công đoạn, máy) thắng công thức chung của công đoạn — mỗi
        # máy in một đơn giá. Chỉ thắng khi cặp đó THẬT SỰ khai; cặp có dòng mà ô trống thì vẫn
        # dùng công thức chung, không để phiếu ra 0đ vì một ô người ta cố ý bỏ trống.
        "cong_thuc_gia": (ct_gia_may or "").strip() or cd.cong_thuc_gia,
        "setup_cost": _f(cd.setup_cost),
        "setup_time": _f(cd.setup_time),
        "run_rate": _f(cd.run_rate) if cd.run_rate is not None else None,
        "rate_tiers": cd.rate_tiers,
        "size_tiers": cd.size_tiers,
        "first_unit_floor": _f(cd.first_unit_floor) if cd.first_unit_floor is not None else None,
        "min_charge": _f(cd.min_charge) if cd.min_charge is not None else None,
        "spoilage_pct": _f(cd.spoilage_pct),
        # Hai cờ dụng cụ: engine dùng để biết bước nào ĐƯỢC PHÉP mang phí khuôn, và để kêu khi
        # bước cần dao mà chưa khai phí. Trước đây engine hoàn toàn không thấy hai cờ này.
        "requires_tooling": bool(cd.requires_tooling),
        "tooling_type": cd.tooling_type,
        # Đơn vị vào/ra khai ở danh mục — engine cần để tra bù hao ĐÚNG đơn vị và biết bước nào là
        # ranh giới quy đổi. Hệ số thì engine tự có (`con`, `so_manh_xa` của chính phiếu).
        "don_vi_vao": cd.don_vi_vao,
        "don_vi_ra": cd.don_vi_ra,
        # TRẠM dòng giấy của hai đơn vị đó (None = ngoài dòng giấy). Engine là hàm THUẦN nên không
        # tự tra danh mục được — tầng này có `db` thì tra hộ. Thiếu hai khoá này thì engine lùi về
        # luật cũ "có khai đơn vị = trên dòng giấy", đúng với dữ liệu thời chỉ 5 mã khai được.
        "tram_vao": tram.get(cd.don_vi_vao) if tram else None,
        "tram_ra": tram.get(cd.don_vi_ra) if tram else None,
    }


# ============================ Mô hình THEO THÀNH PHẦN ============================
_TP_SCALAR_FIELDS = (
    "thu_tu", "loai_thanh_phan", "ten", "dai_thanh_pham", "rong_thanh_pham",
    # `don_vi_tinh` đi qua engine như mọi trường khác → lệnh sản xuất kế thừa được ĐVT từ PHIẾU,
    # thôi cảnh mỗi tầng tự lấy một đường rồi không ai kiểm chúng có khớp nhau không.
    "don_vi_tinh", "so_to_per_sp", "so_trang", "trang_moi_tay", "so_luong",
    "giay_id", "kho_nguyen", "kho_nguyen_dai", "kho_nguyen_rong", "don_gia_giay",
    "don_gia_don_vi", "nguon_giay",
    "chua_nhip", "bleed_mm", "khe_cat_mm",
    "co_in", "che_ban_loai", "che_ban_don_gia", "quy_cach_in",
    "kho_in_dai", "kho_in_rong", "so_con", "con_auto", "may_id", "don_gia_cong_in",
    # `muc_a`/`muc_b` là TẬP mã mực người dùng khai — nguồn sự thật của số kẽm. Ba số `so_mau_*`
    # đi cùng ở đây chỉ để đọc lại phiếu cũ chưa backfill; engine LUÔN tính lại chúng từ tập rồi
    # ghi đè xuống DB (`_ghi_so_mau_dan_xuat`), nên đừng tin số client gửi lên.
    "muc_a", "muc_b", "so_mau_a", "so_mau_b", "so_mau_pha",
    # ⑤ Phí giao hàng của CẢ sản phẩm — engine cộng thẳng vào giá vốn (nhóm "Giao hàng").
    "phi_giao_hang",
    # Nhãn gộp báo giá — engine đếm SẢN PHẨM theo cụm (ruột + bìa cùng nhãn = 1), không ăn vào tiền.
    "nhom_bao_gia",
)
_ROW_SCALAR_FIELDS = (
    "thu_tu", "cong_doan_id", "ten", "don_gia", "so_luong", "bu_hao",
    "so_mat", "so_vi_tri", "dien_tich", "nha_cung_cap", "ghi_chu",
    # Phí khuôn của bước — engine CÓ cộng vào giá vốn (một dòng tiền trong nhóm Công đoạn).
    "phi_khuon",
    # Khuôn có sẵn hay làm mới. KHÔNG ăn vào tiền: engine chỉ đọc nó để biết nên nhắc gì
    # (`_canh_bao_khuon`), còn lệnh SX đọc lại để so ý định của sale với con dao kế hoạch thật sự
    # chọn.
    "khuon_nguon",
)


def _resolve_thanh_phan(db: Session, tp, nap: DanhMucNapSan | None = None) -> dict:
    """ORM PhieuThanhPhan → dict phẳng ĐÃ resolve danh mục (giấy khổ/gsm + công đoạn) cho engine.

    `nap` = danh mục đã nạp sẵn cho cả phiếu (`nap_danh_muc_phieu`). Vắng thì tự nạp cho riêng
    thành phần này — nơi gọi lặp qua nhiều thành phần nên truyền vào để khỏi hỏi lại từng cái."""
    if nap is None:
        nap = nap_danh_muc_phieu(db, [tp])
    d: dict = {}
    for k in _TP_SCALAR_FIELDS:
        v = getattr(tp, k, None)
        # `list` cho `muc_a`/`muc_b` (cột JSON) — không có nhánh này thì nó rơi xuống `_f()` và
        # một danh sách mực thành 0.0 trong im lặng, kéo số kẽm về 0.
        if isinstance(v, (int, str, bool, list)) or v is None:
            d[k] = v
        else:
            d[k] = _f(v)  # Decimal → float

    # Giấy: bơm định lượng + tên + CÔNG THỨC + đơn giá. Đơn giá/kg CHỐT CỨNG ở danh mục Giấy —
    # luôn lấy theo record (phiếu không sửa). Khổ KHÔNG còn ở danh mục → nhập tay ở phiếu (kho_nguyen).
    if tp.giay_id is not None:
        giay = nap.giay.get(int(tp.giay_id))
        if giay is not None:
            d["gsm"] = giay.gsm
            d["giay_ten"] = giay.ten
            d["cong_thuc_gia"] = giay.cong_thuc_gia   # G1: bơm công thức cấu hình từ danh mục Giấy
            d["don_gia_giay"] = _f(giay.don_gia)      # chốt cứng: đơn giá/kg theo danh mục
            d["don_gia_don_vi"] = giay.don_vi_gia
            d["don_gia_giay_he_so"] = he_so_gia_giay(giay.don_vi_gia, nap)

    # Khổ giấy nguyên ①: nhập tay ở phiếu (kho_nguyen_dai/rong). Áp cả khi khách cấp giấy.
    if _f(d.get("kho_nguyen_dai")):
        d["kho_dai"] = _f(d.get("kho_nguyen_dai"))
    if _f(d.get("kho_nguyen_rong")):
        d["kho_rong"] = _f(d.get("kho_nguyen_rong"))

    # Máy: bơm 3 nhóm KHÁC nhau (đừng gộp):
    #  · kho_may_*  = khổ giấy CHẠY máy (kho_max) → dùng XẢ GIẤY (cắt tờ in từ giấy nguyên). Luôn lấy.
    #  · kho_in_*   = khổ tờ in ② = khổ giấy in THẬT, CHƯA trừ gì. Engine tự trừ chừa khi bình bài.
    #                 KHÔNG đổ vùng in vào đây nữa: vùng in đã trừ sẵn nhíp/lề, đổ vào rồi trừ chừa
    #                 lần nữa là TRỪ HAI LẦN (hụt 14-19% số con). Thiếu → fallback khổ giấy máy.
    #  · chừa + vùng in = thông số kỹ thuật để engine trừ đúng chiều / cảnh báo. Phiếu để trống thì
    #                 lấy theo máy (xem `_compute_one`). Chừa lấy nhíp GIẤY, không lấy mép nhíp bản kẽm.
    if tp.may_id is not None:
        may = nap.may.get(int(tp.may_id))
        if may is not None:
            if may.kho_max_dai:
                d["kho_may_dai"] = may.kho_max_dai
            if may.kho_max_rong:
                d["kho_may_rong"] = may.kho_max_rong
            if not _f(d.get("kho_in_dai")):
                d["kho_in_dai"] = may.kho_max_dai or 0
            if not _f(d.get("kho_in_rong")):
                d["kho_in_rong"] = may.kho_max_rong or 0
            d["nhip_giay_mm"] = may.nhip_giay_mm or 0
            d["le_hong_mm"] = may.le_hong_mm or 0
            d["duoi_thang_mau_mm"] = may.duoi_thang_mau_mm or 0
            d["vung_in_dai"] = may.vung_in_dai or 0
            d["vung_in_rong"] = may.vung_in_rong or 0

    # Dòng gia công sau in: bơm cấu hình công đoạn cho MỌI dòng có gắn danh mục.
    #
    tram = ban_do_tram(db)   # đọc MỘT lần cho cả phiếu, không hỏi lại từng dòng
    # Máy in được chọn ở khối In của THÀNH PHẦN (`PhieuThanhPhan.may_id`) — đây là chỗ DUY NHẤT
    # phiếu tính giá chọn máy, nên chỉ dòng công đoạn nhóm In mới có cơ hội ăn công thức riêng.
    ct_gia_theo_cd = nap.ct_gia_may.get(int(tp.may_id), {}) if tp.may_id is not None else {}
    cd_map, vt_map = nap.cong_doan, nap.vat_tu
    rows: list[dict] = []
    for row in sorted(tp.thanh_phams, key=lambda r: (r.thu_tu or 0, r.id or 0)):
        rd: dict = {}
        for k in _ROW_SCALAR_FIELDS:
            v = getattr(row, k, None)
            rd[k] = v if (isinstance(v, (int, str, bool)) or v is None) else _f(v)
        if row.cong_doan_id is not None:
            cd = cd_map.get(row.cong_doan_id)
            if cd is not None:
                # Chốt lại nhóm ở ĐÂY nữa dù `CongDoanService._validate` đã dọn lúc lưu: dòng
                # cũ khai trước luật vẫn nằm trong DB, mà giá sai kiểu này không màn nào bày ra.
                rd["cong_doan"] = _cong_doan_to_dict(
                    cd, tram,
                    ct_gia_may=ct_gia_theo_cd.get(cd.id) if cd.nhom == "print" else None)
        rd["vat_tus"] = _vat_tus_cua_buoc(db, row, vt_map)
        rows.append(rd)
    d["thanh_phams"] = rows

    # Chi phí khác: KHÔNG tra danh mục, KHÔNG công thức — chép nguyên cặp (tên, tiền) người lập
    # phiếu gõ. Đây chính là chỗ hứng khoản chưa có danh mục nào nhận, nên resolve cái gì cũng
    # sai. Dòng trống tên lẫn tiền vẫn chép sang: engine tự bỏ dòng 0đ, còn cái tên thì nó giữ.
    d["chi_phi_khacs"] = [
        {"ten": (cp.ten or "").strip(), "so_tien": _f(cp.so_tien)}
        for cp in sorted(getattr(tp, "chi_phi_khacs", []) or [], key=lambda r: (r.thu_tu or 0, r.id or 0))
    ]
    return d


def compute_phieu_snapshot(db: Session, phieu) -> dict:
    """Resolve danh mục cho MỌI thành phần + gọi engine + GHI ảnh chụp lên `phieu` (in-place).

    KHÔNG commit (caller commit). Trả `result` dict engine đầy đủ.
    """
    so_luong = int(phieu.so_luong or 0)
    tps = sorted(phieu.thanh_phans, key=lambda t: (t.thu_tu or 0, t.id or 0))
    nap = nap_danh_muc_phieu(db, tps)
    resolved = [_resolve_thanh_phan(db, tp, nap) for tp in tps]
    result = compute_phieu(so_luong=so_luong, thanh_phans=resolved)

    # gán giá vốn từng thành phần + ghi ngược SỐ BÀI IN dẫn xuất (so_trang / trang_moi_tay) để
    # bản lệnh và báo giá đọc được mà không phải tính lại.
    for comp in result["meta"]["components"]:
        idx = comp["idx"]
        if 0 <= idx < len(tps):
            tps[idx].gia_von_tp = comp["gia_von_tp"]
            if comp.get("so_to_per_sp"):
                tps[idx].so_to_per_sp = int(comp["so_to_per_sp"])
            # Ba số màu là DẪN XUẤT của tập mực — engine chốt, DB chép lại. Nhờ vậy ~28 chỗ đang
            # đọc `so_mau_a/b/pha` (công thức mực, `_may_fit`, lệnh SX, bài ghép, báo giá) không
            # phải biết gì về tập mực, mà cũng không thể lệch với nó.
            tps[idx].so_mau_a = int(comp.get("so_mau_a") or 0)
            tps[idx].so_mau_b = int(comp.get("so_mau_b") or 0)
            tps[idx].so_mau_pha = int(comp.get("so_mau_pha") or 0)

    tong = float(result.get("grand_total") or 0)
    phieu.tong_gia_von = tong
    phieu.gia_von_don = float(result.get("meta", {}).get("gia_von_don") or 0)  # đơn giá bình quân (Σ vốn / Σ SL)
    phieu.result_json = result
    phieu.warnings_json = result.get("warnings") or []
    # ĐÓNG DẤU GIỜ TÍNH. Không dựa vào `onupdate` được: bấm "Tính giá" mà không sửa gì thì mọi cột
    # đều bằng giá trị cũ, SQLAlchemy không sinh UPDATE, `updated_at` đứng im — và lời nhắc
    # "danh mục đã đổi" sẽ không bao giờ tắt dù người dùng đã tính lại.
    phieu.updated_at = datetime.now(timezone.utc)
    return result


# ============================ DANH MỤC ĐỔI SAU KHI TÍNH ============================
# Phiếu tính giá giữ ẢNH CHỤP: mở lại phiếu là đọc lại đúng con số + đúng cái tên của lần bấm
# "Tính giá" gần nhất, KHÔNG tính lại. Đó là chủ ý — phiếu đã báo cho khách mà ai sửa đơn giá
# trong danh mục một cái là hàng loạt phiếu cũ đổi số theo thì không còn tin được số nào.
#
# Nhưng im lặng hoàn toàn cũng sai: người dùng đổi tên/cấu hình công đoạn xong mở phiếu ra thấy
# y như cũ, tưởng phần mềm hỏng. Nên phiếu TỰ BIẾT MÌNH ĐÃ CŨ và nói ra — còn bấm tính lại hay
# không vẫn là quyền của người lập phiếu, máy không tự sửa số.


def _utc(v: datetime | None) -> datetime | None:
    """Giờ từ SQLite về là NAIVE, từ Postgres về là AWARE. So thẳng hai kiểu ⇒ TypeError."""
    if v is None:
        return None
    return v if v.tzinfo is not None else v.replace(tzinfo=timezone.utc)


def danh_muc_doi_sau_khi_tinh(db: Session, phieu) -> dict | None:
    """Danh mục mà phiếu đang dùng có gì lệch so với lần tính gần nhất không?

    `None` = phiếu còn khớp danh mục. Ngược lại:
        `{"luc": datetime, "ten": [...], "ngung": [...], "xoa": [...]}`

    BA RỔ TÁCH RIÊNG vì người đọc phải làm ba việc khác nhau:
      * `ten`   — mục còn dùng được, chỉ ĐỔI cấu hình/tên ⇒ bấm tính lại là xong;
      * `ngung` — mục bị NGỪNG DÙNG (bấm "Xóa" ở màn danh mục mà mục còn nơi dùng thì hệ chỉ tắt
        cờ `active`) ⇒ tính lại vẫn ra số, nhưng lần sau không chọn lại được, nên phải thay bước;
      * `xoa`   — mục đã XOÁ HẲN, id trong phiếu trỏ vào hư không ⇒ tính lại là dòng đó mất cấu
        hình danh mục. Gộp cả ba vào một chữ "đã chỉnh sửa" là nói sai việc người dùng vừa làm.

    Mốc so sánh là `phieu.updated_at`: mọi đường ghi phiếu (POST/PUT) đều chạy
    `compute_phieu_snapshot` ngay trước khi commit, nên ngày sửa phiếu CHÍNH LÀ ngày tính.
    """
    moc = _utc(getattr(phieu, "updated_at", None))
    if moc is None:
        return None

    giay_ids: set[int] = set()
    may_ids: set[int] = set()
    cd_ids: set[int] = set()
    vt_ids: set[int] = set()
    # Tên công đoạn ĐÃ LƯU trong dòng phiếu: mục bị xoá hẳn khỏi danh mục thì đây là cái tên DUY
    # NHẤT còn lại để gọi nó ra ("Cán màng mờ 2 mặt" thay vì "Công đoạn #14").
    ten_luu_cd: dict[int, str] = {}
    for tp in phieu.thanh_phans:
        if tp.giay_id:
            giay_ids.add(int(tp.giay_id))
        if tp.may_id:
            may_ids.add(int(tp.may_id))
        for f in tp.thanh_phams:
            if f.cong_doan_id:
                cid = int(f.cong_doan_id)
                cd_ids.add(cid)
                if f.ten and cid not in ten_luu_cd:
                    ten_luu_cd[cid] = str(f.ten)
            for vt in f.vat_tus:
                if vt.vat_tu_id:
                    # Khoá CẶP: dòng giấy của bước trỏ `giay_nguyen`, không phải `vat_tu_in_an`.
                    (giay_ids if vt.hang_loai == "giay" else vt_ids).add(int(vt.vat_tu_id))

    # Bậc bù hao NAY nằm trên chính công đoạn (22/09/2026) nên đã được soi cùng dòng Công đoạn
    # ngay dưới — sửa bậc là `cong_doan.updated_at` nhảy. Trước đây bù hao là danh mục riêng, công
    # đoạn chỉ trỏ bằng `bu_hao_id`, nên phải bắc thêm một cầu đếm sang đó mới thấy (lỗi 8,
    # 25/08/2026): chỉnh bù hao xong mở phiếu thấy y như cũ, không một chữ báo phải tính lại.
    sua: list[str] = []
    ngung: list[str] = []
    xoa: list[str] = []
    for model, ids, nhan, ten_luu in (
        (CongDoan, cd_ids, "Công đoạn", ten_luu_cd),
        (GiayNguyen, giay_ids, "Giấy", {}),
        (MayThietBi, may_ids, "Máy", {}),
        (VatTuInAn, vt_ids, "Vật tư", {}),
    ):
        if not ids:
            continue
        con_song: set[int] = set()
        # Lọc mốc bằng Python chứ không bằng WHERE: cột giờ trên SQLite (test) không so được với
        # datetime aware ở tầng SQL, mà số dòng ở đây tối đa vài chục.
        for row_id, row_ten, row_luc, row_active in db.execute(
            select(model.id, model.ten, model.updated_at, model.active).where(model.id.in_(ids))
        ).all():
            rid = int(row_id)
            con_song.add(rid)
            ten_muc = (str(row_ten).strip() if row_ten else "") or ten_luu.get(rid) or f"{nhan} #{rid}"
            if not row_active:
                ngung.append(ten_muc)
            else:
                luc = _utc(row_luc)
                if luc is not None and luc > moc:
                    sua.append(ten_muc)
        for rid in sorted(ids - con_song):
            xoa.append(ten_luu.get(rid) or f"{nhan} #{rid}")

    if not (sua or ngung or xoa):
        return None
    return {
        "luc": moc,
        "ten": sorted(set(sua)),
        "ngung": sorted(set(ngung)),
        "xoa": sorted(set(xoa)),
    }
