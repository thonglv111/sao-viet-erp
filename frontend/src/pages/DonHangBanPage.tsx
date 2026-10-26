// Đơn hàng bán — redesign-don-hang-ban.md (P1: list + chi tiết + sửa thông tin đặt-hàng).
// Cọc/chốt/hủy = P2–P5. Icon dùng bộ Icon nhà (không emoji).
// Màn này KHÔNG tạo đơn: đơn sinh từ màn Báo giá khi khách chốt. Luồng duyệt đơn đặc thù đã gỡ.
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { OGoDinhDang } from "../components/OGoDinhDang";

import { Button } from "../components/Button";
import { ChonNgay } from "../components/ChonNgay";
import { Icon, type IconName } from "../components/Icons";
import { DinhKemTep } from "../components/DinhKemTep";
import { EmptyRow, EmptyState } from "../components/EmptyState";
import { LocNguoiPhuTrach } from "../components/LocNguoiPhuTrach";
import { PhanTrangDayDu } from "../components/PhanTrangDayDu";
import {
  CuonLuoi,
  ChipTT, ChonCot, LocNhanhTrangThai, OTim, rongLuoi, TieuDeSapXep, ngayVN, soVN, tenKhachGon, useCauHinhLuoi, type CotLuoi, type MauTT,
} from "../components/LuoiDs";
import { useAuth } from "../auth/useAuth";
import { useCan } from "../auth/permissions";
import {
  BangSanXuatMon, BuocGiaoHang, CanhBaoTre, ChanKhung, TomTat, coHangCum, napTruocTienDo, tomTatTienDo, useTienDoDon,
  viecTiepTheo,
} from "./giao-hang/tien-do-don";
import { duocHuyDon, trangThaiSanXuat } from "./don-hang-ban-dieu-kien";
import {
  api,
  ApiError,
  type DonTienDoYeuCau,
  type LsxListItem,
  type OrderDetail,
  type OrderRow,
  type OrderStatsOut,
  type SalesInvoiceListOut,
  type SalesInvoiceRow,
  type LuotGiaoHoaDon,
} from "../api/client";
import { PhieuXuatBanHangPrint } from "./giao-hang/phieu-giao-hang";
import { DepositReceiptDialog } from "./ke-toan/phieu-thu/modals/DepositReceiptDialog";
import { TraLaiTienKhachModal } from "./ke-toan/phieu-chi/modals/TraLaiTienKhachModal";
import { batTatRongHet, docDoRong, ghiDoRong } from "./ke-toan/shared/doRongNgan";
import { LOC_DH_TRONG, locDHLenUrl, locDHTuUrl, thamSoLocDH, useDieuKienDonHang, type LocDonHang } from "./loc-kinh-doanh/dieu-kien-don-hang";
import { ThanhLoc } from "./thanh-loc/ThanhLoc";
import { dkTheoTab } from "./thanh-loc/thanh-loc";
import { kyLenUrl, kyTuUrl, thamSoKy, type KyDS } from "./thanh-loc/ky-danh-sach";
import { useLocMan } from "./thanh-loc/useLocMan";
import { gopTheoNhom } from "../utils/gop-nhom";
import { layHoaDonNapTruoc, layLenhNapTruoc, layNhatKyNapTruoc, napTruocNganDon } from "./napTruocNganDon";
import "./don-hang-ban.css";
import { fmtDateTime } from "../utils/format";
import { homNayVN, ngayCuaMoc } from "../utils/ky";

function vnd(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("vi-VN") + "₫";
}
function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
/** Tên gọi của người Việt là chữ cuối ("Nguyễn Thị Huyên" → "Huyên"); họ tên đủ để ở `title`. */
const tenGoi = (ten: string) => ten.trim().split(/\s+/).pop() ?? ten;

// V5: hình thức thu của Phiếu thu Kế toán (PAYMENT_VOUCHER_TYPES).
const RECEIPT_METHOD_LABELS: Record<string, string> = {
  cash: "Tiền mặt",
  bank_transfer: "Chuyển khoản",
};

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  draft: { label: "Nháp", bg: "#eef1f6", fg: "#48566a" },
  ordered: { label: "Đã chốt", bg: "#e4f5ec", fg: "#1f8a52" },
  cancelled: { label: "Hủy", bg: "#fdecea", fg: "#b4432b" },
  hoan_tat: { label: "Hoàn tất", bg: "#e4f5ec", fg: "#1f8a52" },
  // dormant (thiết kế đã bỏ) — map để dữ liệu cũ không phun enum thô ra UI
  on_hold: { label: "Tạm giữ", bg: "#fdf2e0", fg: "#a9631a" },
  change_order: { label: "Đổi đơn", bg: "#fdf2e0", fg: "#a9631a" },
};

type TabDef = {
  id: string;
  label: string;
  status?: string;
  countKey: keyof OrderStatsOut;
};
// Tab "Chờ duyệt" đã bỏ cùng luồng duyệt đơn đặc thù — nó chỉ đếm đơn nhập tay, mà đường tạo
// đơn tay đã gỡ nên tab đó vĩnh viễn rỗng.
// "Sẵn sàng chốt" và "Chờ cọc" lọc + đếm ở MÁY CHỦ (06/10/2026). Trước đó hai tab này lọc trong
// trình duyệt trên 200 đơn nháp theo "đủ cọc" — sai từ khi cọc thành bước SAU chốt:
// - Sẵn sàng chốt = đơn nháp đã qua cổng chốt (báo giá khách đồng ý còn hạn, có PO, có ngày giao,
//   mọi dòng đã định giá).
// - Chờ cọc = đã chốt mà chưa xuống sản xuất (đủ cọc là tự chuyển) — đúng ô "Chờ đủ cọc" của bảng.
// - Hoàn tất = đã chốt, khách nhận đủ mọi dòng, hoá đơn đã ghi đủ (06/10/2026). Vẫn nằm trong
//   "Đã chốt" vì trạng thái lưu của đơn không đổi; thẻ trên dòng đổi thành "Hoàn tất".
const TABS: TabDef[] = [
  { id: "all", label: "Tất cả", countKey: "all" },
  { id: "draft", label: "Nháp", status: "draft", countKey: "draft" },
  { id: "san_sang", label: "Sẵn sàng chốt", status: "san_sang", countKey: "san_sang" },
  { id: "cho_coc", label: "Chờ cọc", status: "cho_coc", countKey: "cho_coc" },
  { id: "ordered", label: "Đã chốt", status: "ordered", countKey: "ordered" },
  { id: "hoan_tat", label: "Hoàn tất", status: "hoan_tat", countKey: "hoan_tat" },
  { id: "cancelled", label: "Hủy", status: "cancelled", countKey: "cancelled" },
];

const PAGE_SIZE = 25;

// Dải kỳ tính theo ngày tạo / ngày chốt / ngày giao hẹn.
const MOC_DH: [string, string][] = [["tao", "Ngày tạo"], ["chot", "Ngày chốt"], ["giao", "Ngày giao hẹn"]];
type LocMan = { ky: KyDS; loc: LocDonHang };
const LOC_MAN_TRONG: LocMan = { ky: { loai: "tat_ca", moc: "tao" }, loc: LOC_DH_TRONG };
const docLocMan = (p: URLSearchParams): LocMan => ({
  ky: kyTuUrl(p, MOC_DH.map(([m]) => m), "tao"),
  loc: locDHTuUrl(p),
});
const ghiLocMan = (t: LocMan) => ({ ...kyLenUrl(t.ky, "tao"), ...locDHLenUrl(t.loc) });

function Chip({ icon, label, tone }: { icon: IconName; label: string; tone: "warn" | "muted" | "info" | "rush" }) {
  return (
    <span className={`dhb__chip tone--${tone}`}>
      <Icon name={icon} size={12} /> {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status };
  return (
    <span className={`dhb__status-badge status--${status}`}>
      {m.label}
    </span>
  );
}

function RowFlags({ o }: { o: OrderRow }) {
  return (
    <span className="dhb__flags">
      {o.is_rush && <Chip icon="bell" label="GẤP" tone="rush" />}
      {/* "Chờ duyệt" + "Gia công" đã bỏ cùng luồng duyệt và trường Bản chất đơn; chip "Không giá
          vốn" (đơn nhập tay cũ, cost_basis='none') ẩn 04/10/2026 — gần như dòng nào cũng có, nhiễu. */}
    </span>
  );
}

interface Props {
  navigate?: (id: string, params?: Record<string, unknown>) => void;
  openOrderId?: number | null;   // deep-link từ Báo giá ("Xem đơn") → mở drawer đơn vừa tạo
  /** Đi kèm `openOrderId`: mở ngăn ở đúng chặng này thay vì chặng đang chạy (Công nợ → "hoadon"). */
  openOrderChang?: "hoadon" | null;
  /** Tick nhóm bán hàng + sản xuất + kho + giao hàng (kênh SSE chung của AppShell) — drawer đơn nạp
   *  lại tiến độ. Trước 28/09/2026 drawer tự mở kênh SSE riêng. */
  eventTick?: number;
  /** Tick nhóm mua hàng · kế toán — drawer nạp lại hoá đơn bán của đơn. */
  keToanTick?: number;
}

export function DonHangBanPage({ navigate, openOrderId, openOrderChang, eventTick, keToanTick }: Props) {
  // Chặng mở sẵn của ngăn — chỉ cho đơn mở qua liên kết; mở từ danh sách thì về chặng đang chạy.
  const [changMo, setChangMo] = useState<"hoadon" | null>(null);
  const { token } = useAuth();
  const can = useCan();
  // `create` KHÔNG còn được dùng ở màn này (đơn sinh từ Báo giá) — quyền vẫn tồn tại, gác ở đó.
  const canUpdate = can("don_hang_ban", "update");
  // Thu cọc = lập phiếu thu ⇒ hỏi Phiếu thu → Tạo (13/10/2026, trước đó là ô riêng của Đơn hàng bán).
  const canRecordDeposit = can("phieu_thu", "create");

  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  // Hộp lọc NV phụ trách — null = tất cả người trong tầm nhìn.
  const [nguoi, setNguoi] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(PAGE_SIZE);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [tong, setTong] = useState({ giaTri: 0, coc: 0 });
  const [sort, setSort] = useState("-created_at");
  const luoi = useCauHinhLuoi("don-hang-ban");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // `/enums` không còn được nạp ở đây: nó chỉ phục vụ hộp thoại tạo đơn (đã xoá). Nhãn trạng thái
  // dùng bảng STATUS_META tĩnh phía trên.

  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [stats, setStats] = useState<OrderStatsOut | null>(null);
  // Dải kỳ + bộ lọc nâng cao — ghi lên URL, nhớ theo màn khi sang màn khác rồi quay lại.
  const [locMan, setLocMan] = useLocMan("don-hang-ban", LOC_MAN_TRONG, docLocMan, ghiLocMan);
  const dkRieng = useDieuKienDonHang();
  // "Trạng thái" trong nút Lọc đọc/ghi thẳng tab — không đẻ state lọc thứ hai.
  const dieuKien = [
    dkTheoTab<LocDonHang>({
      tabs: TABS.map((t) => ({ id: t.id, nhan: t.label, so: stats?.[t.countKey] })),
      tatCa: "all",
      dang: tab,
      dat: setTab,
    }),
    ...dkRieng,
  ];
  const khoaLoc = JSON.stringify({ ...thamSoKy(locMan.ky), ...thamSoLocDH(locMan.loc) });
  const tabDangMo = TABS.find((x) => x.id === tab) ?? TABS[0];

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    api.orders
      .list(token, {
        q: q || undefined, status: tabDangMo.status, nguoi,
        sort, page, size, loc: JSON.parse(khoaLoc),
      })
      .then((r) => {
        setRows(r.items);
        setTotal(r.total);
        setTong({ giaTri: r.tong_gia_tri ?? 0, coc: r.tong_coc ?? 0 });
      })
      .catch((e) => setErr(String(e?.message ?? e)))
      .finally(() => setLoading(false));
    // Số trên tab theo ĐÚNG ô tìm, kỳ, bộ lọc đang áp: bấm tab nào bảng ra đúng số đó.
    api.orders
      .stats(token, undefined, nguoi, { q: q || undefined, ...JSON.parse(khoaLoc) })
      .then(setStats)
      .catch(() => {});
  }, [token, q, tabDangMo.status, sort, page, size, nguoi, khoaLoc]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [tab, q, nguoi, khoaLoc]);

  const coLoc = !!q.trim() || khoaLoc !== "{}" || nguoi != null || tab !== "all";

  // `trangThai` biết từ dòng danh sách: đơn nháp không có tiến độ nên khỏi bắn trước. Mở qua liên
  // kết (không biết trạng thái) thì để ngăn tự hỏi như cũ.
  function openDetail(id: number, dong?: OrderRow, chang: "hoadon" | null = null) {
    if (!token) return;
    setChangMo(chang);
    napTruocTienDo(token, id, !!dong && dong.status !== "draft");
    napTruocNganDon(token, id, dong);
    api.orders.get(token, id).then(setSelected).catch((e) => setErr(String(e?.message ?? e)));
  }

  // Deep-link từ Báo giá (nút "Xem đơn" sau khi tạo đơn) → mở drawer đơn ngay khi vào màn.
  useEffect(() => {
    if (token && openOrderId) openDetail(openOrderId, undefined, openOrderChang ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, openOrderId, openOrderChang]);

  // Cột ngày thứ hai theo mốc kỳ: Ngày tạo / Ngày chốt (mốc "Ngày giao hẹn" đã có cột Hẹn giao).
  const mocNgay = locMan.ky.moc === "chot" ? "chot" : "tao";
  const cotHien = luoi.rongHien(luoi.xep(COT_DH).filter((c) => !luoi.an.has(c.key)).map((c) =>
    c.key === "ngay" && mocNgay === "chot" ? { ...c, label: "Ngày chốt", sx: "ordered_at" } : c));
  const viTriGia = cotHien.findIndex((c) => c.key === "gia");
  const muc = TABS.map((t) => ({ key: t.id, label: t.label, count: stats?.[t.countKey], mau: MAU_TAB[t.id] }));

  return (
    <main className="dhb-container lds">
      {/* Màn này KHÔNG tạo đơn: đơn chỉ sinh từ Báo giá khi khách đồng ý — nên đầu trang không có nút chính. */}
      <header className="lds-dau">
        <h1 className="lds-dau__ten">Đơn hàng bán</h1>
      </header>

      {err && <div className="banner banner--error" role="alert">{err}</div>}

      <section className="lds-loc">
        <LocNhanhTrangThai muc={muc} dang={tab} onChon={setTab} />
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim value={q} onChange={setQ} placeholder="Tìm mã đơn, khách, PO, hàng" ariaLabel="Tìm đơn hàng" />
          <ThanhLoc
            ky={locMan.ky}
            moc={MOC_DH}
            onKy={(ky) => setLocMan({ ...locMan, ky })}
            dieuKien={dieuKien}
            loc={locMan.loc}
            onLoc={(loc) => setLocMan({ ...locMan, loc })}
          />
          <LocNguoiPhuTrach nap={api.orders.nguoiPhuTrach} value={nguoi} onChange={setNguoi} donVi="đơn" />
          <ChonCot cot={COT_DH} {...luoi.chonCot} />
        </div>
      </section>

      <div className="lds-sheet">
        <CuonLuoi ghim={luoi.soGhim(cotHien)}>
          <table className="lds-g" style={{ minWidth: rongLuoi(cotHien) }}>
            <colgroup>
              {cotHien.map((c) => (
                <col key={c.key} style={c.w ? { width: c.w } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {cotHien.map((c) => (
                  <th key={c.key} className={c.n ? "n" : undefined}>
                    {c.sx ? <TieuDeSapXep label={c.label} cot={c.sx} sort={sort} onSort={setSort} /> : c.label}
                    {luoi.keo(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && <EmptyRow colSpan={cotHien.length} trangThai="dang-tai" />}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    {coLoc ? "Không có đơn nào khớp điều kiện đang lọc." : "Chưa có đơn hàng."}
                  </td>
                </tr>
              )}
              {rows.map((o) => (
                <tr
                  key={o.id}
                  className="lds-dong"
                  tabIndex={0}
                  onClick={() => openDetail(o.id, o)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      openDetail(o.id, o);
                    }
                  }}
                >
                  {cotHien.map((c) => (
                    <ODon key={c.key} cot={c.key} o={o} mocNgay={mocNgay} />
                  ))}
                </tr>
              ))}
              {/* Dòng Cộng: Σ giá trị và Σ cọc đã thu của MỌI đơn khớp bộ lọc (máy chủ cộng). */}
              {rows.length > 0 && viTriGia > 0 ? (
                <tr className="lds-cong lds-nhom">
                  <td className="lead" colSpan={viTriGia}>
                    <span className="lds-dinh-trai">Cộng {total.toLocaleString("vi-VN")} đơn</span>
                  </td>
                  {cotHien.slice(viTriGia).map((c) =>
                    c.key === "gia" ? (
                      <td key={c.key} className="n">{soVN(tong.giaTri)}</td>
                    ) : c.key === "coc" ? (
                      <td key={c.key} title="Tổng cọc đã thu">{soVN(tong.coc)}</td>
                    ) : (
                      <td key={c.key} />
                    ),
                  )}
                </tr>
              ) : null}
            </tbody>
          </table>
        </CuonLuoi>
        {!err && total > 0 && (
          <PhanTrangDayDu
            trang={page}
            size={size}
            tong={total}
            soDong={rows.length}
            onTrang={setPage}
            onSize={(n) => {
              setSize(n);
              setPage(1);
            }}
            loading={loading}
            donVi="đơn"
            ariaLabel="Phân trang đơn hàng bán"
          />
        )}
      </div>

      {selected && (
        <OrderDrawer
          order={selected}
          canUpdate={canUpdate}
          canRecordDeposit={canRecordDeposit}
          onClose={() => setSelected(null)}
          onSaved={(d) => {
            setSelected(d);
            load();
          }}
          navigate={navigate}
          eventTick={eventTick}
          keToanTick={keToanTick}
          moChang={changMo}
        />
      )}
    </main>
  );
}

// --- Lưới danh sách (phương án A, 07/10/2026) --------------------------------------------------
// Thứ tự: Mã, Ngày tạo, Khách, Hàng, PO khách, Giá trị, Trạng thái, rồi các khâu theo luồng (Hẹn giao,
// Cọc, Sản xuất, Giao khách), cuối là Phụ trách.
const COT_DH: (CotLuoi & { w?: number; n?: boolean; sx?: string })[] = [
  { key: "ma", label: "Mã đơn", coDinh: true, w: 105, sx: "order_no" },
  { key: "ngay", label: "Ngày tạo", w: 100, sx: "created_at" },
  { key: "khach", label: "Khách hàng", w: 190 },
  { key: "hang", label: "Hàng", w: 190 },
  { key: "po", label: "PO khách", w: 95 },
  { key: "gia", label: "Giá trị", w: 115, n: true },
  { key: "tt", label: "Trạng thái", w: 105, sx: "status" },
  { key: "hen", label: "Hẹn giao", w: 165, sx: "delivery_committed_date" },
  { key: "coc", label: "Cọc", w: 125 },
  { key: "giao", label: "Giao khách", w: 120 },
  { key: "nv", label: "Phụ trách" },
];

// Chấm màu hàng lọc nhanh = sắc chip trạng thái trên dòng.
const MAU_TAB: Record<string, MauTT | undefined> = {
  draft: "slate",
  san_sang: "cham",
  cho_coc: "vang",
  ordered: "xanh",
  hoan_tat: "la",
  cancelled: "xam",
};

/** Trạng thái trên dòng: đơn đã chốt tách thêm "Chờ cọc" (chưa xuống sản xuất) và "Hoàn tất". */
function trangThaiDong(o: OrderRow): { nhan: string; mau: MauTT } {
  if (o.status === "ordered") {
    if (o.dang_cho.length === 1 && o.dang_cho[0] === "xong") return { nhan: "Hoàn tất", mau: "la" };
    if (!o.san_xuat_released_at) return { nhan: "Chờ cọc", mau: "vang" };
    return { nhan: "Đã chốt", mau: "xanh" };
  }
  if (o.status === "draft") return { nhan: "Nháp", mau: "slate" };
  if (o.status === "cancelled") return { nhan: "Hủy", mau: "xam" };
  return { nhan: STATUS_META[o.status]?.label ?? o.status, mau: "cam" };
}

/** Còn bao nhiêu ngày tới hẹn giao — chỉ đơn đã chốt, chưa giao đủ. Không kết luận "trễ". */
function conNgayGiao(o: OrderRow): number | null {
  if (o.status !== "ordered" || !o.delivery_committed_date) return null;
  if (o.san_xuat_mon.length > 0 && o.san_xuat_mon.every((m) => m.khach_nhan_du ?? m.da_giao >= m.dat)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${o.delivery_committed_date}T00:00:00`);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  return days < 0 ? null : days;
}

function ODon({ cot, o, mocNgay }: { cot: string; o: OrderRow; mocNgay: "tao" | "chot" }) {
  const mu = <span className="lds-mu3">—</span>;
  switch (cot) {
    case "ma":
      return (
        <td title={o.quotation_code ? `Từ báo giá ${o.quotation_code}` : undefined}>
          {o.order_no}
          {o.is_rush ? <span className="lds-tag lds-do">Gấp</span> : null}
        </td>
      );
    case "ngay":
      return <td>{ngayVN(mocNgay === "chot" ? o.ordered_at : o.created_at)}</td>;
    case "khach":
      return o.customer_name ? <td title={o.customer_name}>{tenKhachGon(o.customer_name)}</td> : <td>{mu}</td>;
    case "hang":
      return (
        <td title={o.first_line_desc ?? undefined}>
          {o.first_line_desc ?? mu}
          {o.line_count > 1 ? <span className="lds-tag">+{o.line_count - 1}</span> : null}
        </td>
      );
    case "po":
      return <td title={o.customer_po_no ?? undefined}>{o.customer_po_no ?? mu}</td>;
    case "gia":
      return <td className="n">{soVN(o.total_with_vat)}</td>;
    case "tt": {
      const t = trangThaiDong(o);
      return <td><ChipTT mau={t.mau}>{t.nhan}</ChipTT></td>;
    }
    case "hen": {
      const con = conNgayGiao(o);
      return (
        <td>
          {o.delivery_committed_date ? ngayVN(o.delivery_committed_date) : mu}
          {con != null ? (
            <span className={`lds-u${con <= 3 ? " lds-cam" : ""}`}>{con === 0 ? "hôm nay" : `còn ${con} ngày`}</span>
          ) : null}
        </td>
      );
    }
    case "coc": {
      // Đơn huỷ: tiền khách còn giữ (cọc + tiền hoá đơn đã huỷ, 17/10/2026) là việc kế toán phải trả —
      // nói thẳng ra, không "Đủ cọc".
      if (o.status === "cancelled") {
        const daNhan = o.tien_khach_da_nhan ?? o.deposit_received;
        const conGiu = o.tien_khach_con_giu ?? 0;
        if (conGiu > 0) {
          return <td title={`Đã nhận ${vnd(daNhan)}`}><ChipTT mau="cam" vuong>Còn giữ {soVN(conGiu)}</ChipTT></td>;
        }
        return <td>{daNhan > 0 ? <span className="lds-mu3">Đã trả lại</span> : <span className="lds-mu3">Không cọc</span>}</td>;
      }
      if (!o.deposit_required) return <td>{o.status === "draft" ? mu : <span className="lds-mu3">Không cọc</span>}</td>;
      return o.deposit_ok ? (
        <td title={`Đã thu ${vnd(o.deposit_received)}`}><ChipTT mau="la" vuong>Đủ cọc</ChipTT></td>
      ) : (
        <td title={`Cần cọc ${vnd(o.deposit_required)}`}>
          <span className="lds-vang">{soVN(o.deposit_received)}</span>
          <span className="lds-u">/ {soVN(o.deposit_required)}</span>
        </td>
      );
    }
    case "giao": {
      // Giao khách: suy từ số đã giao của từng mặt hàng (cùng nguồn với tiến độ đơn).
      if (o.status !== "ordered" || !o.san_xuat_released_at || o.san_xuat_mon.length === 0) return <td>{mu}</td>;
      const du = o.san_xuat_mon.every((m) => m.khach_nhan_du ?? m.da_giao >= m.dat);
      const mot = o.san_xuat_mon.some((m) => m.da_giao > 0);
      return (
        <td>
          <ChipTT vuong mau={du ? "la" : mot ? "cyan" : "slate"}>{du ? "Khách đã nhận" : mot ? "Giao một phần" : "Chưa giao"}</ChipTT>
        </td>
      );
    }
    case "nv":
      return <td title={o.sale_name ?? undefined}>{o.sale_name ? tenGoi(o.sale_name) : mu}</td>;
    default:
      return <td />;
  }
}

// --- Drawer chi tiết ----------------------------------------------------------
/** Thanh kéo mép trái của ngăn đơn — dùng CHUNG độ rộng `--kt-ngan-w` với mọi ngăn mở từ bên phải
 *  (mặc định 1180px, nhớ trong localStorage): kéo ngăn này thì ngăn Kế toán cũng theo và ngược lại.
 *  Bấm đúp bật/tắt rộng hết. (06/10/2026 — trước đó ngăn đơn cố định 50vw.) */
function ThanhKeoNgan() {
  const dangKeo = useRef(false);
  const [keo, setKeo] = useState(false);
  useLayoutEffect(() => {
    const dat = () => document.documentElement.style.setProperty("--kt-ngan-w", `${docDoRong()}px`);
    dat();
    window.addEventListener("resize", dat);
    return () => window.removeEventListener("resize", dat);
  }, []);
  return (
    <div
      className={`dhb__drawer-keo${keo ? " is-keo" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Kéo để đổi độ rộng"
      title="Kéo để nới rộng. Bấm đúp để mở rộng hết."
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dangKeo.current = true;
        setKeo(true);
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
      }}
      onPointerMove={(e) => { if (dangKeo.current) ghiDoRong(window.innerWidth - e.clientX); }}
      onPointerUp={() => { dangKeo.current = false; setKeo(false); }}
      onPointerCancel={() => { dangKeo.current = false; setKeo(false); }}
      onDoubleClick={batTatRongHet}
    />
  );
}

function OrderDrawer({
  order, canUpdate, canRecordDeposit, onClose, onSaved, navigate,
  eventTick, keToanTick, moChang,
}: {
  order: OrderDetail;
  canUpdate: boolean;
  canRecordDeposit: boolean;
  onClose: () => void;
  onSaved: (d: OrderDetail) => void;
  navigate?: (id: string, params?: Record<string, unknown>) => void;
  eventTick?: number;
  keToanTick?: number;
  /** Mở sẵn chặng này (liên kết từ Công nợ phải thu) thay cho chặng đang chạy. */
  moChang?: "hoadon" | null;
}) {
  const { token } = useAuth();
  const can = useCan();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // In phiếu xuất kho bán hàng / 02-VT theo MỘT yêu cầu, sau khi kho ghi sổ (13/10/2026). Nút "Xem
  // bản in" cả đơn ở đầu ngăn đã gỡ (13/10/2026) — giấy tờ in theo từng lần xuất.
  const [inYc, setInYc] = useState<DonTienDoYeuCau | null>(null);
  const [invoiceBook, setInvoiceBook] = useState<SalesInvoiceListOut | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const canCreateInvoice = can("phieu_thu", "create");
  const canCancelInvoice = can("phieu_thu", "cancel");
  // Đơn đã huỷ còn tiền khách: nút trả lại = lập phiếu chi trả lại tiền cho khách (12/10/2026). Từ
  // 17/10/2026 tiền còn giữ gồm cả tiền đã thu của hoá đơn đã huỷ — số do máy chủ tính, cùng hàng
  // "Chờ trả lại khách" của Phiếu chi.
  const [traCoc, setTraCoc] = useState(false);
  const cocConGiu = order.tien_khach_con_giu ?? 0;
  const tienDaNhan = order.tien_khach_da_nhan ?? order.deposit_received;
  const coTienHd = tienDaNhan > order.deposit_received;
  // Hủy đơn (nháp hay đã chốt) = ô Sửa đơn, đúng cổng máy chủ (#53).
  const canCancel = duocHuyDon(order.status, canUpdate);

  // `dungNapTruoc` chỉ ở lần nạp đầu của ngăn: lấy lại lời gọi đã bắn lúc bấm mở đơn.
  const taiHoaDon = useCallback(async (dungNapTruoc: boolean) => {
    if (!token) return;
    setInvoiceLoading(true);
    setInvoiceError(null);
    try {
      setInvoiceBook(await ((dungNapTruoc && layHoaDonNapTruoc(order.id))
        || api.accounting.salesInvoices(token, order.id)));
    } catch (error) {
      setInvoiceError(error instanceof ApiError ? error.message : "Không tải được hóa đơn của đơn bán.");
    } finally {
      setInvoiceLoading(false);
    }
  }, [token, order.id]);
  const loadInvoices = useCallback(() => taiHoaDon(false), [taiHoaDon]);

  useEffect(() => {
    setInvoiceBook(null);
    void taiHoaDon(true);
  }, [taiHoaDon]);

  // Kế toán ghi/huỷ hoá đơn, thu tiền ⇒ nạp lại sổ hoá đơn. Đi theo tick nhóm kế toán của kênh SSE
  // CHUNG (AppShell) — trước đây drawer mở thêm một kênh riêng mỗi lần mở.
  const keToanTickDaNap = useRef(keToanTick);
  useEffect(() => {
    if (keToanTickDaNap.current === keToanTick) return;
    keToanTickDaNap.current = keToanTick;
    void loadInvoices();
  }, [keToanTick, loadInvoices]);

  async function upConsent(f: File) { if (token) onSaved(await api.orders.uploadConsent(token, order.id, f)); }
  async function delConsent(aid: number) { if (token) onSaved(await api.orders.deleteConsent(token, order.id, aid)); }
  const [acts, setActs] = useState<{ at: string; actor_name: string | null; action: string; detail: string }[]>([]);
  const isDraft = order.status === "draft";
  const [drawerTab, setDrawerTab] = useState<"overview" | "commercial" | "files" | "history">("overview");
  // Tiền chiết khấu (hoàn lại khách) và kê (cộng sau giá bán, chi lại sau khi khách trả đủ) đều nằm
  // trong thành tiền: tổng đơn, và ô từng dòng / cụm ("—" khi không có).
  const tongCk = order.lines.reduce((t, l) => t + (l.chiet_khau ?? 0), 0);
  const tongKe = order.lines.reduce((t, l) => t + (l.ke_gia ?? 0), 0);
  const ckDong = (ds: { chiet_khau?: number | null }[]) => {
    const t = ds.reduce((x, l) => x + (l.chiet_khau ?? 0), 0);
    return t > 0 ? soVN(t) : "—";
  };
  const keDong = (ds: { ke_gia?: number | null }[]) => {
    const t = ds.reduce((x, l) => x + (l.ke_gia ?? 0), 0);
    return t > 0 ? soVN(t) : "—";
  };

  const isChotDone = order.status === "ordered" || order.ordered_at != null;
  // Vòng đời: CHỐT (thông tin) → CỌC (kế toán thu, SAU chốt) → SẢN XUẤT. Cọc 'xong' = đã chốt VÀ
  // (không cần cọc HOẶC thu đủ). Trước chốt → cọc chưa tới lượt.
  const noDeposit = order.deposit_required <= 0;
  const isCocDone = isChotDone && order.deposit_ok;
  const remaining = Math.max(0, order.deposit_required - order.deposit_received);

  // Bước Sản xuất — đọc LỆNH THẬT của bàn Kế hoạch SX (`/api/lsx`). Chưa chuyển → chờ kế hoạch lên
  // lệnh → đang chạy. "Xong" thuộc pha THỰC THI (nhập kho thành phẩm) — chưa dựng nên luôn false,
  // đừng suy ra từ trạng thái lệnh ở lát này.
  const [lenhs, setLenhs] = useState<LsxListItem[]>([]);
  useEffect(() => {
    if (!token || order.status !== "ordered" || !order.san_xuat_released_at) {
      setLenhs([]);
      return;
    }
    (layLenhNapTruoc(order.id) || api.lsx.list(token, { order_id: order.id }))
      .then((r) => setLenhs(r.items)).catch(() => setLenhs([]));
  }, [token, order.id, order.status, order.san_xuat_released_at]);
  const sxReleased = !!order.san_xuat_released_at;
  // Tiến độ SX (gồm cả nhập kho) → Giao do máy chủ gộp theo sản phẩm (`/orders/{id}/tien-do`), tự tươi qua SSE.
  const { td, taiLai: taiTienDo } = useTienDoDon(order.id, order.status !== "draft", eventTick);
  const tt = tomTatTienDo(td);
  // Lệnh xong hết = MỌI lệnh của đơn xong VÀ không còn món nào thiếu nguồn (không lệnh mà tồn kho
  // không đủ) — thiếu một món là chưa thể xong, dù các lệnh đã chạy hết.
  const thieuNguon = tt.thieuNguon.length;
  const lenhXongHet = td != null && td.cum.length > 0 && thieuNguon === 0 && (tt.coLenh ? tt.sxXong : sxReleased);
  // Bước "Nhập kho" riêng ĐÃ GỘP vào Sản xuất (05/10/2026): Sản xuất chỉ XONG khi mọi sản phẩm đã
  // đủ hàng trong kho (kho nhận đủ thành phẩm KCS gửi sang, hoặc tồn kho gánh đủ).
  const khoDone = td != null && tt.khoXong;
  const sxDone = lenhXongHet && khoDone;
  const giaoDone = td != null && tt.giaoXong;
  // #54: không xem được lệnh thì `lenhs` rỗng — lấy "có lệnh" theo tiến độ máy chủ gộp.
  const sxState = trangThaiSanXuat(sxReleased, lenhs.length, tt.coLenh);
  // Món có lệnh đã đóng hết mà hàng chưa đủ (máy chủ chốt `o = dong_thieu`) — không còn "đang chạy".
  const soMonDongThieu = (td?.cum ?? []).filter((c) => c.o === "dong_thieu").length;
  // Chỉ BÁO thiếu nguồn khi Kế hoạch đã bắt đầu lên lệnh: trước đó mọi món đều chưa có lệnh, báo
  // "4 món chưa có nguồn" lúc vừa chuyển xuống chỉ là báo động giả.
  const baoThieuNguon = sxState === "chay" && thieuNguon > 0;
  // Chữ phụ dưới tên chặng Sản xuất: thiếu nguồn được ưu tiên báo; còn lại nói kho đã đủ mấy món —
  // nhập kho là khâu cuối của sản xuất nên "kho đủ" chính là thước đo sản xuất xong.
  const sxText = order.status === "cancelled" ? "đơn đã hủy"
    : !isChotDone ? "—"
    : !sxReleased ? "chưa chuyển"
    : sxDone ? "xong"
    : baoThieuNguon ? `${thieuNguon} món chưa có nguồn`
    : sxState === "cho_kh" ? "chờ lệnh"
    : soMonDongThieu > 0 ? `đóng thiếu ${soMonDongThieu} món`
    : td ? `kho đủ ${tt.soMonDuHang}/${tt.soMon} món` : "…";
  const soMonGiaoDu = (td?.cum ?? []).filter((c) => c.khach_nhan_du ?? c.da_giao >= c.dat).length;
  const ngayNgan = (v: string | null | undefined) => fmtDate(v ?? null).replace(/\/\d{4}$/, "");
  const giaoSub = !isChotDone ? "—"
    : giaoDone ? "đã giao đủ"
    : td && tt.giaoPct > 0 ? `đủ ${soMonGiaoDu}/${tt.soMon} món`
    : tt.soYeuCauMo > 0 ? `${tt.soYeuCauMo} yêu cầu mở`
    : order.delivery_committed_date ? `hạn ${ngayNgan(order.delivery_committed_date)}` : "—";

  const chotSub = order.status === "cancelled" ? "đã hủy"
    : isChotDone ? ngayNgan(order.ordered_at ?? order.created_at) : "chưa chốt";
  const cocText = !isChotDone ? "chưa tới" : noDeposit ? "không cần" : order.deposit_ok ? "đủ" : "chờ cọc";
  const invoiceStage = !invoiceBook || invoiceBook.invoiced_amount <= 0
    ? "none"
    : invoiceBook.uninvoiced_amount > 0
      ? "partial"
      : "full";
  const invoiceStageLabel = invoiceStage === "full"
    ? "Đã ghi đủ"
    : invoiceStage === "partial"
      ? "Đã ghi một phần"
      : "Chưa ghi";

  const [activeStep, setActiveStep] = useState<"coc" | "chot" | "sanxuat" | "giao" | "hoadon">("coc");
  const buocDang: typeof activeStep | null = order.status === "cancelled" ? null
    : !isChotDone ? "chot" : !isCocDone ? "coc" : !sxDone ? "sanxuat"
    : !giaoDone ? "giao" : invoiceStage !== "full" ? "hoadon" : null;
  const viec = viecTiepTheo({
    trangThai: order.status,
    canCoc: !noDeposit,
    duCoc: order.deposit_ok,
    thieuCoc: remaining,
    chuyenSxLuc: order.san_xuat_released_at,
    gap: order.is_rush,
    hanGiao: order.delivery_committed_date,
    td,
    hoaDon: invoiceStage,
  });
  const khungO = (k: typeof activeStep) => `dhb__chang-o${activeStep === k ? " is-mo" : ""}`;
  const CHANG: { k: typeof activeStep; nhan: string; sub: string; xong: boolean; canhBao?: boolean }[] = [
    { k: "chot", nhan: "Chốt", sub: chotSub, xong: isChotDone },
    { k: "coc", nhan: "Cọc", sub: cocText, xong: isCocDone },
    { k: "sanxuat", nhan: "Sản xuất", sub: sxText, xong: sxDone, canhBao: baoThieuNguon && order.status !== "cancelled" },
    { k: "giao", nhan: "Giao", sub: giaoSub, xong: giaoDone },
    { k: "hoadon", nhan: "Hóa đơn", sub: invoiceStageLabel.toLowerCase(), xong: invoiceStage === "full" },
  ];

  // Nạp lại mỗi khi đơn đổi (Lưu, chốt, cọc… trả về đơn mới — lỗi #64). Chỉ lần đầu lấy lời gọi bắn
  // sẵn lúc bấm mở đơn; các lần sau phải hỏi lại, bản bắn sẵn là nhật ký TRƯỚC thao tác.
  const nkLan = useRef(0);
  useEffect(() => {
    if (!token) return;
    const dau = nkLan.current++ === 0;
    ((dau && layNhatKyNapTruoc(order.id)) || api.orders.activity(token, order.id))
      .then((r) => setActs(r.items)).catch(() => {});
  }, [token, order]);

  useEffect(() => {
    // Đơn hủy → dừng chuỗi tại "Chốt" (đã có khối lý-do-hủy riêng), đừng để mặc định trôi
    // xuống bước sau như thể lệnh còn đang chờ xử lý.
    const defaultStep = order.status === "cancelled"
      ? "chot"
      : moChang ? moChang
      : !isChotDone ? "chot" : !isCocDone ? "coc" : !sxDone ? "sanxuat"
      : !giaoDone ? "giao" : "hoadon";
    setActiveStep(defaultStep);
    // Chỉ chọn bước mặc định khi MỞ đơn / đổi trạng thái / tiến độ vừa tải xong — SSE tự tươi
    // không được giật bước người dùng đang xem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, order.status, isChotDone, isCocDone, td != null]);

  // Ngăn đơn làm lại theo khuôn Shopify (12/10/2026, mockup docs/mockups/ngan-don-hang-ban-3-phuong-an.html,
  // nút "A bản 3"): tab Tổng quan hai cột — trái thẻ Tiến độ + thẻ chặng đang chọn, phải ba thẻ thuộc
  // tính đơn. Mỗi thẻ chặng CHỈ nói chuyện của chặng đó; mỗi thông tin nằm đúng một chỗ: hạn giao ở
  // dòng việc tiếp theo, ngày chốt ở thẻ Chốt, người phụ trách ở đầu ngăn, báo giá nguồn ở thẻ Đơn hàng.
  const soNgayHen = order.delivery_committed_date && order.ordered_at
    ? Math.round((Date.parse(order.delivery_committed_date.slice(0, 10)) - Date.parse(ngayCuaMoc(order.ordered_at))) / 86_400_000)
    : null;
  const phieuCuoi = order.deposits.length > 0
    ? order.deposits.reduce((a, d) => (d.created_at > a.created_at ? d : a))
    : null;
  const moBaoGia = () => navigate?.("bao-gia", { openQuoteId: order.quotation_id });

  return (
    <div
      onClick={onClose}
      className="dhb__drawer-overlay"
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="dhb__drawer-content"
      >
        <ThanhKeoNgan />
        <header className="dhb__drawer-header">
          <div className="dhb__drawer-headmain">
            <div className="dhb__drawer-headtop">
              <h2 className="dhb__drawer-title">{order.order_no}</h2>
              <StatusBadge status={order.status} />
              <RowFlags o={order} />
            </div>
            <div className="dhb__drawer-cust">
              <span className="dhb__drawer-khach">{order.customer_name ?? "—"}</span>
              {order.sale_name && <span>{order.sale_name} phụ trách</span>}
            </div>
          </div>
          {isDraft && canUpdate && (
            <button className="btn btn--secondary" style={{ height: 32 }} onClick={() => setEditing(true)}>Sửa</button>
          )}
          {canCancel && (
            <button className="btn btn--secondary" style={{ height: 32 }} onClick={() => setCancelling(true)}>Hủy đơn</button>
          )}
          <button className="btn btn--ghost" style={{ height: 32 }} onClick={onClose} aria-label="Đóng"><Icon name="x" size={16} /></button>
        </header>

        <div className="dhb__drawer-tabs" role="tablist">
          {([
            ["overview", "Tổng quan", null],
            ["commercial", "Hàng hoá", order.lines.length],
            ["files", "Tệp đính kèm", order.consent_attachments.length],
            ["history", "Nhật ký", acts.length],
          ] as const).map(([k, nhan, dem]) => (
            <button key={k} role="tab" aria-selected={drawerTab === k} onClick={() => setDrawerTab(k)}
              className={`dhb__drawer-tab ${drawerTab === k ? "is-active" : ""}`}>
              {nhan}{dem != null && <span className="dhb__drawer-tab-dem">{dem}</span>}
            </button>
          ))}
        </div>

        <div className="dhb__drawer-body">
          {drawerTab === "overview" && (
            <div className="dhb__tq">
              <div className="dhb__tq-trai">
                <section className="dhb__the">
                  <div className="dhb__the-than dhb__the-than--tien-do">
                    <CanhBaoTre td={order.status === "ordered" && !giaoDone ? td : null} />

                    {/* Thanh chặng (khuôn Atlassian progress tracker): năm chấm trên một trục, đoạn đã đi
                        tô xanh tới chặng đang chạy. Bấm chặng để xem thẻ chặng bên dưới. */}
                    <div className="dhb__path" role="tablist" aria-label="Các chặng của đơn">
                      <span className="dhb__path-truc" aria-hidden="true">
                        <i style={{ width: `${(buocDang == null ? (order.status === "cancelled" ? 0 : 1)
                          : CHANG.findIndex((c) => c.k === buocDang) / (CHANG.length - 1)) * 100}%` }} />
                      </span>
                      {CHANG.map((c) => {
                        const dang = c.k === buocDang;
                        // Giao đã có phần trong lúc Sản xuất chưa xong ⇒ "dở dang song song".
                        const doDang = !c.xong && !dang && c.k === "giao" && td != null && tt.giaoPct > 0;
                        return (
                          <button key={c.k} type="button" role="tab" aria-selected={activeStep === c.k}
                            aria-label={`${c.nhan}: ${c.sub}`}
                            className={`dhb__path-buoc${c.xong ? " is-done" : dang ? " is-dang" : doDang ? " is-do" : ""}${activeStep === c.k ? " is-selected" : ""}`}
                            onClick={() => setActiveStep(c.k)}>
                            <span className="dhb__path-cham">
                              {c.xong && <Icon name="check" size={10} />}
                            </span>
                            <span className="dhb__path-o">
                              <b>{c.nhan}</b>
                              <small className={c.canhBao ? "is-warn" : undefined}>{c.sub}</small>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Dòng việc tiếp theo: trái là đơn đang chờ ai làm gì, phải là hạn giao + số ngày còn
                        lại — hạn giao chỉ nói ở đây. */}
                    {viec && (() => {
                      const theHan = viec.the.find((t) => t.loai === "han");
                      const theKhac = viec.the.filter((t) => t.loai !== "han");
                      const coHan = order.delivery_committed_date && order.status !== "cancelled";
                      return (
                        <div className="dhb__viec">
                          <div className="dhb__viec-chu">
                            <span className="dhb__viec-cau">{viec.cau}</span>
                            {theKhac.length > 0 && (
                              <span className="dhb__viec-the">
                                {theKhac.map((t) => (
                                  <span key={t.nhan} className={`dhb__sx-tag${t.tone ? ` dhb__sx-tag--${t.tone}` : ""}`}>{t.nhan}</span>
                                ))}
                              </span>
                            )}
                            {viec.nut && (viec.nut.toi !== activeStep)
                              && (viec.nut.toi !== "ke-hoach-sx" || can("san_xuat", "read")) && (
                              <Button variant="secondary" className="dhb__viec-nut"
                                onClick={() => {
                                  const toi = viec.nut!.toi;
                                  if (toi === "ke-hoach-sx") navigate?.("ke-hoach-sx", { openSxOrderId: order.id });
                                  else setActiveStep(toi);
                                }}>
                                {viec.nut.nhan}
                              </Button>
                            )}
                          </div>
                          {coHan && (
                            <div className="dhb__viec-han">
                              <small>Hạn giao cam kết</small>
                              <span className="dhb__mono">{fmtDate(order.delivery_committed_date)}</span>
                              {theHan
                                ? <em className={theHan.tone ? `is-${theHan.tone}` : undefined}>{theHan.nhan.replace(" tới hạn giao", "")}</em>
                                : giaoDone ? <em>đã giao đủ</em> : null}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </section>

                {/* Thẻ chặng: chỉ thẻ đang chọn hiện (ẩn bằng CSS để form đang gõ dở không mất khi đổi chặng). */}
                <div className={khungO("chot")}>
                  <TheChang tieuDe="Chốt đơn">
                    {isDraft ? (
                      // Chốt đơn đi theo quyền SỬA đơn (05/10/2026) — không có ô quyền riêng, khớp máy chủ.
                      <div className="dhb__the-than">
                        <ConfirmPanel order={order} canManage={canUpdate} canExtend={canUpdate} onSaved={onSaved} />
                      </div>
                    ) : order.status === "ordered" ? (
                      <>
                        <TomTat d={[
                          { nhan: "Chốt lúc", so: fmtDateTime(order.ordered_at) },
                          ...(order.ordered_by_name ? [{ nhan: "Người chốt", so: order.ordered_by_name }] : []),
                          { nhan: "Giá trị chốt", dien: "gồm VAT", so: soVN(order.total_with_vat) },
                          ...(soNgayHen != null ? [{ nhan: "Thời gian giao đã hẹn", dien: "tính từ lúc chốt", so: `${soNgayHen} ngày` }] : []),
                        ]} />
                        <ChanKhung chu="Đã chốt nên hàng hoá và giá không sửa được nữa." />
                      </>
                    ) : order.status === "cancelled" ? (
                      <>
                        <TomTat d={[
                          { nhan: "Lý do hủy", so: order.cancel_reason ?? "—" },
                          ...(order.cancel_fault ? [{ nhan: "Lỗi tại", so: order.cancel_fault === "khach" ? "Khách hàng" : "Xưởng in" }] : []),
                          ...(tienDaNhan > 0 ? [
                            { nhan: coTienHd ? "Tiền khách đã đưa" : "Cọc đã nhận", dien: coTienHd ? "cọc và hóa đơn đã hủy" : undefined, so: soVN(tienDaNhan) },
                            ...(order.deposit_refunded > 0 ? [{ nhan: "Đã trả lại", so: soVN(order.deposit_refunded) }] : []),
                            { nhan: "Còn giữ", so: soVN(cocConGiu), tong: true, tone: cocConGiu > 0 ? "chu" as const : undefined },
                          ] : []),
                        ]} />
                        {cocConGiu > 0 && order.customer_id != null && can("phieu_chi", "create") && (
                          <ChanKhung chu={coTienHd ? "Đơn đã hủy nhưng còn giữ tiền của khách." : "Đơn đã hủy nhưng còn giữ cọc của khách."}>
                            <button type="button" className="btn" onClick={() => setTraCoc(true)}>{coTienHd ? "Trả lại tiền khách" : "Trả lại cọc"}</button>
                          </ChanKhung>
                        )}
                      </>
                    ) : null}
                  </TheChang>
                </div>

                <div className={khungO("coc")}>
                  <TheChang tieuDe="Cọc">
                    {!isChotDone ? (
                      <ChanKhung chu="Đơn phải chốt trước, sau chốt kế toán thu cọc ở đây." />
                    ) : noDeposit && order.deposits.length === 0 ? (
                      <ChanKhung chu="Khách này không phải đặt cọc. Đơn đã xuống Kế hoạch sản xuất ngay lúc chốt." />
                    ) : (
                      <>
                        <TomTat d={[
                          { nhan: "Cần thu", dien: order.deposit_pct != null ? `${order.deposit_pct}% giá trị đơn` : undefined,
                            so: soVN(order.deposit_required) },
                          ...order.deposits.map((d) => ({
                            khoa: `pt-${d.id}`,
                            nhan: can("phieu_thu", "read") ? (
                              <button type="button" className="dhb__td-link" title="Mở phiếu thu này bên Kế toán"
                                onClick={() => navigate?.("ke-toan-phieu-thu", { focusReceiptQuery: d.code })}>
                                {d.doc_no ?? d.code}
                              </button>
                            ) : (d.doc_no ?? d.code),
                            dien: `${RECEIPT_METHOD_LABELS[d.receipt_method] ?? d.receipt_method} lúc ${fmtDateTime(d.created_at)}`
                              + (d.gop && d.tong_phieu ? ` phiếu gộp ${soVN(d.tong_phieu)}` : ""),
                            so: soVN(d.amount),
                          })),
                          { nhan: "Đã thu", dien: order.deposits.length > 0 ? `${order.deposits.length} phiếu thu` : undefined,
                            so: soVN(order.deposit_received), tong: true },
                          { nhan: "Còn thiếu", so: soVN(remaining), tone: remaining > 0 ? "chu" : undefined },
                        ]} />
                        <ChanKhung chu={isCocDone
                          ? (phieuCuoi ? `Đủ cọc lúc ${fmtDateTime(phieuCuoi.created_at)}.` : "Đủ cọc.")
                          : canRecordDeposit ? "Thiếu cọc thì đơn chưa xuống sản xuất." : "Chờ kế toán thu cọc."}>
                          {!isCocDone && canRecordDeposit && <DepositForm order={order} onSaved={onSaved} />}
                        </ChanKhung>
                      </>
                    )}
                  </TheChang>
                </div>

                <div className={khungO("sanxuat")}>
                  <TheChang tieuDe="Sản xuất">
                    {order.status === "cancelled" ? (
                      <ChanKhung chu={sxReleased
                        ? "Đơn đã hủy. Trước đó đã chuyển xuống sản xuất nhưng chưa lên lệnh nào."
                        : "Đơn đã hủy, chưa từng chuyển xuống sản xuất."} />
                    ) : order.status !== "ordered" ? (
                      <ChanKhung chu="Đơn phải chốt trước mới chuyển xuống sản xuất được." />
                    ) : !sxReleased ? (
                      <ChanKhung chu="Chờ kế toán thu đủ cọc. Đủ cọc là đơn tự xuống hàng chờ Kế hoạch sản xuất." />
                    ) : (
                      <>
                        {td && td.cum.length > 0 && (() => {
                          const mot = td.cum.length === 1 ? td.cum[0] : null;
                          const lenhAll = td.cum.flatMap((c) => c.lenh);
                          const chay = lenhAll.filter((l) => !l.xong);
                          const dangLam = td.cum.reduce((a, c) => a + Math.max(0, c.dat - Math.min(c.dat, coHangCum(c))), 0);
                          const vuong = new Set(chay.flatMap((l) => l.canh_bao)).size;
                          const dv = mot?.don_vi ? ` ${mot.don_vi}` : "";
                          return (
                            <TomTat d={[
                              mot
                                ? mot.o === "dong_thieu"
                                  // Lệnh đã đóng: không ai "còn phải làm" nữa — đó là phần THIẾU.
                                  ? { nhan: "Thiếu", dien: "lệnh đã đóng", so: `${soVN(dangLam)}${dv}`, tone: "chu" }
                                  : { nhan: "Còn phải làm", so: `${soVN(dangLam)}${dv}` }
                                : { nhan: "Món đủ hàng", so: `${tt.soMonDuHang} / ${tt.soMon}`, tone: tt.khoXong ? "ok" : undefined },
                              { nhan: "Dự kiến xong",
                                so: td.du_kien_xong ? fmtDate(td.du_kien_xong) : soMonDongThieu > 0 ? "đã đóng" : tt.sxXong ? "đã xong" : "chưa ước được",
                                tone: (td.tre_ngay ?? 0) > 0 || (!td.du_kien_xong && !tt.sxXong && lenhAll.length > 0) ? "chu" : undefined,
                                dien: (td.tre_ngay ?? 0) > 0 ? `trễ ${td.tre_ngay} ngày so với hạn giao`
                                  : vuong > 0 ? `${vuong} vướng mắc đang mở`
                                  : td.du_kien_xong ? "kịp hạn giao" : undefined },
                            ]} />
                          );
                        })()}
                        <div className="dhb__the-bang">
                          <BangSanXuatMon td={td}
                            onMoLenh={navigate && can("san_xuat", "read") ? (id) => navigate("ke-hoach-sx", { openLsxId: id }) : undefined} />
                        </div>
                        {can("san_xuat", "read") && (
                          <ChanKhung chu="Theo dõi từng công đoạn của lệnh ở Kế hoạch sản xuất.">
                            <button type="button" className="btn"
                              onClick={() => navigate?.("ke-hoach-sx", { openSxOrderId: order.id })}>
                              Mở Kế hoạch sản xuất ↗
                            </button>
                          </ChanKhung>
                        )}
                      </>
                    )}
                  </TheChang>
                </div>

                <div className={khungO("giao")}>
                  <TheChang tieuDe="Giao hàng">
                    <BuocGiaoHang order={order} td={td} taiLai={taiTienDo} onIn={setInYc} navigate={navigate} />
                  </TheChang>
                </div>

                <div className={khungO("hoadon")}>
                  <TheChang tieuDe="Hóa đơn">
                    <InvoicePanel
                      order={order}
                      book={invoiceBook}
                      loading={invoiceLoading}
                      error={invoiceError}
                      canCreate={canCreateInvoice}
                      canCancel={canCancelInvoice}
                      onChanged={loadInvoices}
                      navigate={navigate}
                    />
                  </TheChang>
                </div>
              </div>

              <div className="dhb__tq-phai">
                <TheBen tieuDe="Đơn hàng">
                  <DongBen k="Nguồn" v={order.source_type === "bao_gia" && order.quotation_code ? (
                    <>
                      {can("bao_gia", "read")
                        ? <button type="button" className="dhb__td-link" onClick={moBaoGia}>{order.quotation_code} ↗</button>
                        : order.quotation_code}
                      {order.quotation_version != null && <span className="dhb__muted dhb__ben-phu">bản {order.quotation_version}</span>}
                    </>
                  ) : "Nhập giá tay"} />
                  <DongBen k="Loại đơn" v={order.order_kind === "bo_sung" ? "Đơn bổ sung" : "Đơn mới"} />
                  {order.parent_order_no && <DongBen k="Đơn gốc" v={order.parent_order_no} />}
                  <DongBen k="Số PO khách" v={order.customer_po_no || "—"} />
                  <DongBen k="Ngày tạo" v={<span className="dhb__mono">{fmtDate(order.created_at)}</span>} />
                  <DongBen k="Cọc quy định" v={order.deposit_amount != null ? `${soVN(order.deposit_amount)} đ` : order.deposit_pct != null ? `${order.deposit_pct}%` : "—"} />
                </TheBen>

                {/* Lưu ý sản xuất — sửa được cả khi đã chốt (đường hẹp D3 → realtime bàn Kế hoạch). */}
                <ProductionHintEditor order={order} canEdit={order.status === "ordered" && canUpdate} onSaved={onSaved} />

                <TheBen tieuDe="Giao tới">
                  <div className="dhb__ben-ic"><Icon name="users" size={14} /><span>{order.delivery_contact_name || "—"}</span></div>
                  {order.delivery_contact_phone && (
                    <div className="dhb__ben-ic"><Icon name="phone" size={14} /><span className="dhb__mono">{order.delivery_contact_phone}</span></div>
                  )}
                  <div className="dhb__ben-ic is-dau"><Icon name="mapPin" size={14} /><span className="dhb__muted">{order.delivery_address || "—"}</span></div>
                  {order.delivery_note && (
                    <div className="dhb__ben-nhom">
                      <small>Lưu ý giao hàng</small>
                      <div>{order.delivery_note}</div>
                    </div>
                  )}
                </TheBen>
              </div>
            </div>
          )}

          {drawerTab === "commercial" && (
            <div className="dhb__hh">
              <section className="dhb__the">
                {order.source_type === "bao_gia" && order.quotation_code && (
                  <div className="dhb__the-dau dhb__hh-dau">
                    <span className="dhb__muted">Theo báo giá</span>
                    <button type="button" className="dhb__td-link" onClick={moBaoGia}>{order.quotation_code} ↗</button>
                    {order.quotation_version != null && <span className="dhb__muted">bản {order.quotation_version}</span>}
                  </div>
                )}
                <div className="dhb__the-bang">
                  <table className="dhb__g">
                    <thead>
                      <tr>
                        <th>Mặt hàng</th>
                        <th className="dhb__text-right">Số lượng</th>
                        <th>Đơn vị</th>
                        <th className="dhb__text-right">Đơn giá</th>
                        <th className="dhb__text-right">VAT</th>
                        <th className="dhb__text-right" title="Đã nằm trong đơn giá — chi lại cho khách khi hóa đơn thu đủ">Chiết khấu</th>
                        {tongKe > 0 && (
                          <th className="dhb__text-right" title="Đã cộng vào đơn giá — chi lại cho người bên khách, trừ thuế TNDN, khi hóa đơn thu đủ">Kê</th>
                        )}
                        <th className="dhb__text-right">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Mặt đối ngoại của đơn → gộp theo nhãn nhóm y như báo giá khách đã nhận (ruột + bìa
                          = 1 quyển). Nhóm thì SỔ ra từng phần cho người trong nhà xem đủ. */}
                      {gopTheoNhom(order.lines, (l) => ({
                        nhom: l.nhom,
                        ten: l.description,
                        soLuong: l.qty,
                        donViTinh: l.don_vi_tinh || "",
                        dvtNhom: l.dvt_nhom,
                        thanhTien: l.line_total ?? 0,
                        tienVat: 0,
                        vatPct: l.vat_pct_estimate,
                      })).flatMap((g) => {
                        const dongLe = g.goc.length === 1;
                        return [
                          <tr key={g.key} className={dongLe ? undefined : "dhb__comm-nhom"}>
                            <td>
                              {g.ten}
                              {!dongLe && <span className="dhb__comm-nhomSub">{g.goc.length} phần</span>}
                            </td>
                            <td className="dhb__mono dhb__text-right">{soVN(g.soLuong)}</td>
                            <td>{g.donViTinh || "—"}</td>
                            <td className="dhb__mono dhb__text-right">{g.donGia == null ? "—" : soVN(g.donGia)}</td>
                            <td className="dhb__mono dhb__text-right">{g.vatPct === null ? "—" : `${g.vatPct}%`}</td>
                            <td className="dhb__mono dhb__text-right">{ckDong(g.goc)}</td>
                            {tongKe > 0 && <td className="dhb__mono dhb__text-right">{keDong(g.goc)}</td>}
                            <td className="dhb__mono dhb__text-right">{soVN(g.thanhTien)}</td>
                          </tr>,
                          ...(dongLe ? [] : g.goc.map((l, k) => (
                            <tr key={`${g.key}-${l.id}`}
                              className={`dhb__comm-con${k === g.goc.length - 1 ? " dhb__comm-conCuoi" : ""}`}>
                              <td>{l.description}</td>
                              <td className="dhb__mono dhb__text-right">{soVN(l.qty)}</td>
                              <td>{l.don_vi_tinh || "—"}</td>
                              <td className="dhb__mono dhb__text-right">{l.unit_price_snapshot == null ? "—" : soVN(l.unit_price_snapshot)}</td>
                              <td className="dhb__mono dhb__text-right">{l.vat_pct_estimate}%</td>
                              <td className="dhb__mono dhb__text-right">{ckDong([l])}</td>
                              {tongKe > 0 && <td className="dhb__mono dhb__text-right">{keDong([l])}</td>}
                              <td className="dhb__mono dhb__text-right">{l.line_total == null ? "—" : soVN(l.line_total)}</td>
                            </tr>
                          ))),
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="dhb__hh-tong">
                  {/* Khoảng trống bên trái khối tổng: nói một lần chiết khấu / kê là gì, ai nhận, bao giờ chi. */}
                  {(tongCk > 0 || tongKe > 0) && (
                    <p className="dhb__hh-ghi">
                      {tongCk > 0 && tongKe > 0 ? "Chiết khấu và kê đã nằm trong đơn giá" : tongCk > 0 ? "Chiết khấu đã nằm trong đơn giá" : "Kê đã nằm trong đơn giá"}
                      . Khách trả đủ hóa đơn nào thì kế toán chi lại phần của hóa đơn đó
                      {tongCk > 0 ? ": chiết khấu trả lại cho khách" : ""}
                      {tongCk > 0 && tongKe > 0 ? "; " : tongKe > 0 ? ": " : ""}
                      {tongKe > 0 ? "kê trả cho người bên khách sau khi trừ thuế TNDN" : ""}.
                    </p>
                  )}
                  <TomTat d={[
                    { nhan: "Cộng trước VAT", so: order.total == null ? "—" : soVN(order.total) },
                    ...(tongCk > 0 ? [{ nhan: "Trong đó chiết khấu", so: soVN(tongCk) }] : []),
                    ...(tongKe > 0 ? [{ nhan: "Trong đó kê", so: soVN(tongKe) }] : []),
                    { nhan: "Thuế VAT", so: order.total == null ? "—" : soVN(order.total_with_vat - order.total) },
                    { nhan: "Tổng gồm VAT", so: soVN(order.total_with_vat), tong: true },
                  ]} />
                </div>
              </section>
              {/* Khối Lợi nhuận (giá vốn, lãi gộp, biên) đã gỡ 13/10/2026 theo yêu cầu người dùng. */}
            </div>
          )}

          {drawerTab === "files" && (
            <section className="dhb__the">
              <div className="dhb__the-than">
                {order.consent_attachments.length === 0 && !(isDraft && canUpdate) && (
                  <p className="dhb__muted" style={{ fontSize: 13, margin: 0 }}>Chưa có tệp đính kèm.</p>
                )}
                <DinhKemTep
                  items={order.consent_attachments.map((a) => ({
                    id: a.id,
                    ten_tep: a.file_name ?? "tệp",
                    file_url: a.url,
                    content_type: a.content_type,
                    kich_thuoc: a.size_bytes ?? 0,
                    nguoi_tai_ten: a.uploaded_by_name ?? null,
                    tai_luc: a.uploaded_at,
                  }))}
                  canEdit={isDraft && canUpdate}
                  maxBytes={10 * 1024 * 1024}
                  moTa="Ảnh hoặc tệp PDF liên quan tới đơn hàng."
                  dinhDang={["PDF", "PNG, JPG"]}
                  accept="image/*,application/pdf"
                  taiLen={upConsent}
                  xoa={(t) => delConsent(t.id)}
                />
              </div>
            </section>
          )}

          {drawerTab === "history" && (
            <section className="dhb__the">
              <div className="dhb__the-than">
                {acts.length === 0 && <p className="dhb__muted" style={{ fontSize: 13, margin: 0 }}>Chưa có.</p>}
                {acts.map((a, i) => (
                  <div key={i} className="dhb__nk">
                    <span className="dhb__mono dhb__muted">{fmtDateTime(a.at)}</span>
                    <span>{a.actor_name ?? "—"}</span>
                    <span>{a.detail || a.action}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        {editing && (
          <EditDialog
            order={order}
            onCancel={() => setEditing(false)}
            onSaved={(d) => { setEditing(false); onSaved(d); }}
          />
        )}
        {cancelling && (
          <CancelDialog
            order={order}
            onClose={() => setCancelling(false)}
            onSaved={(d) => { setCancelling(false); onSaved(d); }}
          />
        )}
        {traCoc && order.customer_id != null && (
          <TraLaiTienKhachModal
            khachId={order.customer_id}
            khachTen={order.customer_name ?? "Khách hàng"}
            don={{ id: order.id, ma: order.order_no, daNhan: tienDaNhan, conLai: cocConGiu,
              ...(coTienHd ? { daTraLai: order.deposit_refunded } : {}) }}
            onClose={() => setTraCoc(false)}
            onDone={() => {
              setTraCoc(false);
              if (token) void api.orders.get(token, order.id).then(onSaved).catch(() => undefined);
            }}
          />
        )}
        {inYc && <PhieuXuatBanHangPrint d={order} yc={inYc} onClose={() => setInYc(null)} />}
      </aside>
    </div>
  );
}

/** Thẻ chặng / thẻ nội dung bên trái: tiêu đề rồi thân (dòng tóm tắt, bảng, dải chân). */
function TheChang({ tieuDe, children }: { tieuDe: string; children: React.ReactNode }) {
  return (
    <section className="dhb__the">
      <div className="dhb__the-dau"><h4>{tieuDe}</h4></div>
      {children}
    </section>
  );
}

/** Thẻ thuộc tính đơn ở cột phải. */
function TheBen({ tieuDe, nut, children }: { tieuDe: string; nut?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="dhb__ben">
      <div className="dhb__ben-dau"><h4>{tieuDe}</h4>{nut}</div>
      {children}
    </section>
  );
}

function DongBen({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="dhb__ben-kv"><span>{k}</span><span>{v}</span></div>;
}

/** Hai ô đầu nhóm của một lượt trong bảng hóa đơn — trải dọc hết các dòng hóa đơn của lượt. */
function ODauLuot({ ma, ngay, giaTri, soDong }: { ma: string; ngay: string | null; giaTri: number; soDong: number }) {
  return (
    <>
      <td rowSpan={soDong} className="dhb__g-hai dhb__hd-luot">
        <span className="dhb__mono">{ma}</span>
        {ngay && <small>giao {fmtDate(ngay)}</small>}
      </td>
      <td rowSpan={soDong} className="dhb__mono dhb__text-right dhb__hd-luot">{soVN(giaTri)}</td>
    </>
  );
}

function InvoicePanel({
  order,
  book,
  loading,
  error,
  canCreate,
  canCancel,
  onChanged,
  navigate,
}: {
  order: OrderDetail;
  book: SalesInvoiceListOut | null;
  loading: boolean;
  error: string | null;
  canCreate: boolean;
  canCancel: boolean;
  onChanged: () => Promise<void>;
  navigate?: (id: string, params?: Record<string, unknown>) => void;
}) {
  const { token } = useAuth();
  const today = homNayVN();
  // Lượt đang ghi hóa đơn: hóa đơn lập theo từng lượt khách đã nhận, không vượt hàng của lượt.
  const [luotGhi, setLuotGhi] = useState<LuotGiaoHoaDon | null>(null);
  const showCreate = luotGhi !== null;
  const [symbol, setSymbol] = useState("");
  const [number, setNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SalesInvoiceRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [moHuy, setMoHuy] = useState(false);

  const issued = book?.items.filter((item) => item.status === "issued") ?? [];
  const outstanding = issued.reduce((sum, item) => sum + item.remaining_amount, 0);
  const truCoc = issued.reduce((sum, item) => sum + item.deposit_offset_amount, 0);
  // "Khách đã trả" chỉ tính tới giá trị hóa đơn; khoản trả dư là tiền chờ trả lại — hiện riêng một dòng.
  const daTra = issued.reduce((sum, item) => sum + Math.min(item.direct_received_amount, item.amount_vnd), 0);
  // Số còn phải trả lại lấy từ máy chủ: đã trừ phần chi trả lại rồi, và cấn quỹ của đơn vào hóa đơn khác.
  const traDu = book?.cho_tra_lai ?? 0;
  const phieuThu = book?.phieu_thu ?? [];
  // Tiền trả lại khách KHÔNG gắn đơn cộng nợ lại vào hoá đơn (17/10/2026) là khoản RIÊNG
  // (`hoan_khong_don`): trừ cọc / đã trả giữ số thật của phiếu, tóm tắt thêm một dòng cộng.
  const hoanNgoai = issued.reduce((sum, item) => sum + (item.hoan_khong_don ?? 0), 0);
  const thuHdHuy = cancelTarget?.direct_received_amount ?? 0;
  // Tiền của hoá đơn đã huỷ về quỹ của đơn như cọc ⇒ dòng trừ ghi cả hai loại phiếu (17/10/2026).
  const phieuHdHuy = book?.phieu_thu_hd_huy ?? [];
  // Số phiếu thu mở phiếu bên Kế toán — cùng cách chặng Cọc.
  const linkPhieu = (code: string, docNo: string | null) => navigate ? (
    <button type="button" className="dhb__td-link" title="Mở phiếu thu này bên Kế toán"
      onClick={() => navigate("ke-toan-phieu-thu", { focusReceiptQuery: code })}>{docNo ?? code}</button>
  ) : <span>{docNo ?? code}</span>;
  const depositAlreadyOffset = issued.reduce((sum, item) => sum + item.deposit_offset_amount, 0);
  // Tiền có thể cấn = cọc + tiền hoá đơn đã huỷ về quỹ đơn, trừ phần đã cấn (L-VAI-36).
  const tienHdHuy = phieuHdHuy.reduce((sum, p) => sum + p.amount, 0);
  const depositAvailable = Math.max(0, (book?.deposit_received ?? 0) + tienHdHuy - depositAlreadyOffset);
  const enteredAmount = Math.max(0, Number(amount || 0));
  const expectedOffset = Math.min(depositAvailable, enteredAmount);
  const expectedDebt = Math.max(0, enteredAmount - expectedOffset);
  const termDays = book?.payment_term_days ?? null;
  // Hạn trả = ngày hóa đơn + số ngày công nợ của khách — đúng công thức máy chủ chốt lúc ghi.
  const dueDate = termDays != null && /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)
    ? new Date(Date.parse(`${invoiceDate}T00:00:00Z`) + termDays * 86_400_000).toISOString().slice(0, 10)
    : null;
  // Trần duy nhất là cả đơn: tổng hóa đơn không vượt tổng đơn gồm VAT — đúng luật máy chủ. Phần chưa
  // ghi của lượt chỉ là số điền sẵn.
  const tranDon = book?.uninvoiced_amount ?? 0;
  const remainingAfter = tranDon - enteredAmount;
  const luotGiao = book?.luot_giao ?? [];

  useEffect(() => {
    if (!luotGhi || !book) return;
    setAmount(String(Math.min(luotGhi.con_ghi, book.uninvoiced_amount) || book.uninvoiced_amount));
    setSymbol((prev) => prev || book.last_invoice_symbol || "");
    setInvoiceDate(today);
    setFormError(null);
  }, [luotGhi, book, today]);

  async function createInvoice(event: React.FormEvent) {
    event.preventDefault();
    if (!token || !book || !luotGhi || saving) return;
    if (!symbol.trim() || !number.trim() || !invoiceDate) {
      setFormError("Vui lòng nhập ký hiệu, số hóa đơn và ngày hóa đơn.");
      return;
    }
    if (invoiceDate > today) {
      setFormError("Ngày hóa đơn không được nằm trong tương lai.");
      return;
    }
    if (!Number.isFinite(enteredAmount) || enteredAmount <= 0 || enteredAmount > tranDon) {
      setFormError(`Giá trị hóa đơn phải từ 1 đến ${vnd(tranDon)}.`);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await api.accounting.createSalesInvoice(token, {
        order_id: order.id,
        invoice_symbol: symbol.trim(),
        invoice_number: number.trim(),
        invoice_date: invoiceDate,
        delivery_trip_id: luotGhi.trip_id,
        amount_vnd: Math.round(enteredAmount),
      });
      setLuotGhi(null);
      setSymbol("");
      setNumber("");
      await onChanged();
    } catch (cause) {
      setFormError(cause instanceof ApiError ? cause.message : "Không ghi nhận được hóa đơn.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelInvoice(event: React.FormEvent) {
    event.preventDefault();
    if (!token || !cancelTarget || saving) return;
    if (!cancelReason.trim()) {
      setFormError("Vui lòng nhập lý do hủy hóa đơn.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await api.accounting.cancelSalesInvoice(token, cancelTarget.id, cancelReason.trim());
      setCancelTarget(null);
      setCancelReason("");
      await onChanged();
    } catch (cause) {
      setFormError(cause instanceof ApiError ? cause.message : "Không hủy được hóa đơn.");
    } finally {
      setSaving(false);
    }
  }

  // Khung Hoá đơn (khuôn Shopify 12/10/2026): dòng tóm tắt, bảng hoá đơn, dải chân có nút ghi nhận.
  const coTheGhi = order.status === "ordered" && canCreate && (book?.uninvoiced_amount ?? 0) > 0;

  // Bảng hóa đơn theo lượt (phương án A 13/10/2026): mỗi lượt một nhóm dòng, hóa đơn của lượt nằm
  // ngay trong nhóm; hóa đơn đã hủy gom ở chân bảng.
  const idLuot = new Set(luotGiao.map((l) => l.trip_id));
  const hdCuaLuot = (id: number) => issued.filter((i) => i.delivery_trip_id === id);
  const hdChuaGan = issued.filter((i) => i.delivery_trip_id == null || !idLuot.has(i.delivery_trip_id));
  const daHuy = book?.items.filter((i) => i.status === "cancelled") ?? [];
  // Hóa đơn vượt hàng của lượt mình (hoặc hóa đơn cũ chưa gắn lượt) phủ sang lượt khác — máy chủ dồn
  // theo thứ tự giao; ở đây chỉ gọi tên nguồn.
  const nguonPhu = [
    ...luotGiao
      .filter((l) => hdCuaLuot(l.trip_id).reduce((s, i) => s + i.amount_vnd, 0) > l.gia_tri)
      .map((l) => `lượt ${l.ma}`),
    ...(hdChuaGan.length > 0 ? ["chưa gắn lượt"] : []),
  ];
  const tenNguon = nguonPhu.length === 1 ? `hóa đơn ${nguonPhu[0]}` : "hóa đơn khác";
  const oHoaDon = (item: SalesInvoiceRow) => {
    const huy = item.status === "cancelled";
    const ghiChu = [
      item.created_by_name && `${item.created_by_name} ghi`,
      huy && item.cancel_reason && `Lý do hủy: ${item.cancel_reason}`,
    ].filter(Boolean).join("\n");
    return (
      <>
        <td className="dhb__g-hai dhb__hd-sohd" title={ghiChu}>
          <span className="dhb__mono">{item.invoice_number}</span>
          <small>{fmtDate(item.invoice_date)}</small>
        </td>
        <td className="dhb__mono dhb__muted">{item.invoice_symbol}</td>
        <td className="dhb__text-right dhb__g-hai">
          <span className="dhb__mono">{soVN(item.amount_vnd)}</span>
          {/* Chiết khấu / kê của hóa đơn (20/10/2026) — trước VAT, chi lại khách khi hóa đơn thu đủ. */}
          {(item.chiet_khau ?? 0) > 0 && <small>chiết khấu {soVN(item.chiet_khau ?? 0)}</small>}
          {(item.ck_da_chi ?? 0) > 0 && <small>đã chi chiết khấu {soVN(item.ck_da_chi ?? 0)}</small>}
          {(item.ke_gia ?? 0) > 0 && <small>kê {soVN(item.ke_gia ?? 0)}</small>}
          {(item.ke_thue_tndn ?? 0) > 0 && <small>thuế TNDN trên kê {soVN(item.ke_thue_tndn ?? 0)}</small>}
          {(item.ke_da_chi ?? 0) > 0 && <small>đã chi kê {soVN(item.ke_da_chi ?? 0)}</small>}
        </td>
        <td className={item.due_date && !huy ? "dhb__mono" : "dhb__muted"}>
          {huy ? "" : item.due_date ? fmtDate(item.due_date) : "chưa đặt"}
        </td>
        <td className="dhb__text-right dhb__g-hai">
          {huy
            ? <ChipTT mau="xam">Đã hủy</ChipTT>
            : item.remaining_amount > 0
              ? <span className="dhb__mono">{soVN(item.remaining_amount)}</span>
              : <span><ChipTT mau="la">Đã thu đủ</ChipTT></span>}
          {/* Vì sao còn nợ nhỏ hơn giá trị: phần trừ cọc và phần khách đã trả của chính hóa đơn này. */}
          {!huy && item.deposit_offset_amount > 0 && <small>{phieuHdHuy.length > 0 ? "trừ tiền đã thu" : "trừ cọc"} {soVN(item.deposit_offset_amount)}</small>}
          {!huy && item.direct_received_amount > 0 && <small>đã trả {soVN(item.direct_received_amount)}</small>}
          {!huy && (item.hoan_khong_don ?? 0) > 0 && <small>cộng lại {soVN(item.hoan_khong_don ?? 0)} đã trả khách ngoài đơn</small>}
        </td>
        <td className="dhb__text-right dhb__g-nut">
          {/* Khách đã trả vẫn hủy được (17/10/2026): tiền về quỹ của đơn, trừ vào hóa đơn ghi lại. */}
          {!huy && canCancel && (
            <button type="button" className="dhb__td-link dhb__td-link--do" title="Hủy hóa đơn"
              onClick={() => { setCancelTarget(item); setCancelReason(""); setFormError(null); }}>
              Hủy
            </button>
          )}
        </td>
      </>
    );
  };
  return (
    <>
      {error && <div className="banner banner--error" role="alert" style={{ margin: "0 20px 8px" }}>{error}</div>}
      {formError && !showCreate && <div className="banner banner--error" role="alert" style={{ margin: "0 20px 8px" }}>{formError}</div>}
      {loading && !book && <div className="dhb__the-than"><EmptyState trangThai="dang-tai" gon nhanTai="Đang tải sổ hóa đơn…" /></div>}

      {book && (
        <>
          {/* Đọc từ trên xuống ra đúng phép trừ: Đã ghi hóa đơn − Trừ cọc − Khách đã trả = Còn phải thu;
              hai dòng trừ ghi số phiếu thu để biết tiền nằm ở chứng từ nào (13/10/2026). */}
          <TomTat d={[
            { nhan: "Tổng đơn", dien: "gồm VAT", so: soVN(book.order_total) },
            { nhan: "Đã giao", dien: "gồm VAT", so: soVN(book.delivered_amount ?? 0) },
            { nhan: "Đã giao chưa ghi", so: soVN(book.invoiceable_amount ?? 0),
              tone: (book.invoiceable_amount ?? 0) > 0 ? "chu" : undefined },
            { nhan: "Đã ghi hóa đơn", dien: issued.length > 0 ? `${issued.length} hóa đơn` : undefined, so: soVN(book.invoiced_amount) },
            ...(truCoc > 0 ? [{
              nhan: phieuHdHuy.length > 0 ? "Trừ tiền đã thu" : "Trừ cọc",
              dien: (
                <span className="dhb__g-cach">
                  {order.deposits.map((d) => <span key={d.id}>{linkPhieu(d.code, d.doc_no)}</span>)}
                  {phieuHdHuy.map((p) => <span key={`h${p.id}`}>{linkPhieu(p.code, p.doc_no)}</span>)}
                </span>
              ),
              so: `−${soVN(truCoc)}`,
            }] : []),
            ...(daTra > 0 ? [{
              nhan: "Khách đã trả",
              dien: (
                <span className="dhb__g-cach">
                  {phieuThu.map((p) => (
                    <span key={p.id} title={p.gop ? `Phiếu gộp nhiều chứng từ. Phần của hoá đơn này ${soVN(p.amount)}` : undefined}>
                      {linkPhieu(p.code, p.doc_no)}
                    </span>
                  ))}
                </span>
              ),
              so: `−${soVN(daTra)}`,
            }] : []),
            ...(hoanNgoai > 0 ? [{
              nhan: "Đã trả lại khách ngoài đơn",
              dien: "cộng nợ lại",
              so: `+${soVN(hoanNgoai)}`,
            }] : []),
            { nhan: "Còn phải thu", dien: "trên các hóa đơn đã ghi", so: soVN(outstanding), tong: true,
              tone: outstanding > 0 ? "chu" : undefined },
            ...(traDu > 0 ? [{
              nhan: "Khách trả dư",
              dien: "chờ trả lại ở Phiếu chi",
              so: soVN(traDu),
            }] : []),
          ]} />

          {(luotGiao.length > 0 || book.items.length > 0) && (
            <div className="dhb__the-bang">
              <table className="dhb__g dhb__hd">
                <thead>
                  <tr>
                    <th>Lượt giao</th>
                    <th className="dhb__text-right">Giá trị hàng</th>
                    <th>Số hóa đơn</th>
                    <th>Ký hiệu</th>
                    <th className="dhb__text-right">Giá trị hóa đơn</th>
                    <th>Hạn thu</th>
                    <th className="dhb__text-right">Còn nợ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {luotGiao.map((l) => {
                    const hd = hdCuaLuot(l.trip_id);
                    const rieng = Math.min(hd.reduce((s, i) => s + i.amount_vnd, 0), l.gia_tri);
                    const phu = Math.max(0, l.da_ghi - rieng);
                    const dongCon = l.con_ghi > 0 || hd.length === 0;
                    const dau = <ODauLuot ma={l.ma} ngay={l.ngay_giao} giaTri={l.gia_tri} soDong={hd.length + (dongCon ? 1 : 0)} />;
                    return (
                      <Fragment key={l.trip_id}>
                        {hd.map((item, k) => <tr key={item.id}>{k === 0 && dau}{oHoaDon(item)}</tr>)}
                        {dongCon && (
                          <tr>
                            {hd.length === 0 && dau}
                            {l.con_ghi > 0 ? (
                              <>
                                <td className="dhb__g-hai">
                                  <span className="dhb__muted">chưa ghi</span>
                                  {phu > 0 && <small>{soVN(phu)} đã gồm trong {tenNguon}</small>}
                                </td>
                                <td />
                                <td className="dhb__mono dhb__text-right dhb__muted">
                                  {l.con_ghi !== l.gia_tri ? `còn ${soVN(l.con_ghi)}` : ""}
                                </td>
                                <td />
                                <td />
                                <td className="dhb__text-right dhb__g-nut">
                                  {coTheGhi && (
                                    <button type="button" className="dhb__td-link" onClick={() => { setFormError(null); setLuotGhi(l); }}>Ghi hóa đơn</button>
                                  )}
                                </td>
                              </>
                            ) : (
                              <td colSpan={6} className="dhb__muted">đã gồm trong {tenNguon}</td>
                            )}
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {hdChuaGan.map((item, k) => (
                    <tr key={item.id}>
                      {k === 0 && (
                        <>
                          <td rowSpan={hdChuaGan.length} className="dhb__muted dhb__hd-luot">chưa gắn lượt</td>
                          <td rowSpan={hdChuaGan.length} className="dhb__hd-luot" />
                        </>
                      )}
                      {oHoaDon(item)}
                    </tr>
                  ))}
                  {daHuy.length > 0 && (
                    <tr className="dhb__hd-huy">
                      <td colSpan={8}>
                        <button type="button" className="dhb__hd-mo" aria-expanded={moHuy} onClick={() => setMoHuy((v) => !v)}>
                          {daHuy.length} hóa đơn đã hủy
                          <Icon name="chevron" size={14} />
                        </button>
                      </td>
                    </tr>
                  )}
                  {moHuy && daHuy.map((item) => (
                    <tr key={item.id} className="is-cancelled">
                      <td className={item.luot_giao_ma ? "dhb__mono" : ""}>{item.luot_giao_ma ?? "chưa gắn lượt"}</td>
                      <td />
                      {oHoaDon(item)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {cancelTarget && (
            <form className="dhb__invoice-cancel-form" style={{ margin: "0 20px 12px" }} onSubmit={cancelInvoice}>
              <div>
                <span>Hủy hóa đơn {cancelTarget.invoice_number}</span>
                {thuHdHuy > 0 ? (
                  <small>
                    {`Khách đã trả ${soVN(thuHdHuy)} cho hóa đơn này. Phiếu thu giữ nguyên, số tiền được trừ vào hóa đơn ghi lại. Đơn không còn gì để ghi hóa đơn thì khoản này sang Phiếu chi, mục Chờ trả lại khách.`}
                  </small>
                ) : (
                  <small>Hủy xong, lượt giao của hóa đơn này ghi lại được hóa đơn mới.</small>
                )}
              </div>
              <textarea className="dhb__input" rows={2} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Lý do hủy *" />
              <div className="dhb__invoice-form-actions">
                <button type="button" className="btn btn--secondary" onClick={() => setCancelTarget(null)} disabled={saving}>Đóng</button>
                <button type="submit" className="btn btn--danger" disabled={saving}>{saving ? "Đang hủy..." : "Xác nhận hủy"}</button>
              </div>
            </form>
          )}

          <ChanKhung chu={luotGiao.length === 0 && order.status === "ordered"
            ? "Hóa đơn ghi theo hàng khách đã nhận. Chưa có lượt nào giao xong."
            : "Hóa đơn ghi theo từng lượt khách đã nhận. Chỉ hóa đơn đã ghi mới thành công nợ phải thu."} />
        </>
      )}
      {/* Popup gắn vào body: khung chi tiết đơn có thể đang trượt (transform) làm `position: fixed`
          bám theo khung chứ không theo màn hình. */}
      {showCreate && book && createPortal(
        <div className="dhb__modal-overlay" style={{ zIndex: 80 }} onClick={(event) => { event.stopPropagation(); if (!saving) setLuotGhi(null); }}>
            <form className="dhb__modal-content dhb__invoice-form dhb__invoice-form--popup" onSubmit={createInvoice}
              onClick={(event) => event.stopPropagation()}>
              <h3 className="dhb__modal-title">Ghi nhận hóa đơn cho lượt {luotGhi?.ma}</h3>
              <p className="dhb__invoice-lead">Xuất hóa đơn điện tử xong thì chép thông tin trên hóa đơn vào đây.</p>
              <div className="dhb__invoice-form-grid">
                <label>
                  <span>Ký hiệu <b>*</b></span>
                  <input className="dhb__input" value={symbol} maxLength={64} onChange={(event) => { setSymbol(event.target.value); setFormError(null); }} placeholder="VD: 1C26TSV" autoFocus={!symbol} />
                  <small className="dhb__invoice-hint">
                    {book.last_invoice_symbol && symbol === book.last_invoice_symbol
                      ? "Điền sẵn ký hiệu dùng lần trước, hóa đơn khác dãy thì sửa lại."
                      : "Chép đúng như trên hóa đơn."}
                  </small>
                </label>
                <label>
                  <span>Số hóa đơn <b>*</b></span>
                  <input className="dhb__input" value={number} maxLength={64} onChange={(event) => { setNumber(event.target.value); setFormError(null); }} placeholder="VD: 00001234" autoFocus={!!symbol} />
                </label>
                <label>
                  <span>Ngày hóa đơn <b>*</b></span>
                  <ChonNgay className="dhb__input" aria-label="Ngày hóa đơn" min={order.ordered_at ? ngayCuaMoc(order.ordered_at) : undefined} max={today} value={invoiceDate} onChange={(v) => { setInvoiceDate(v); setFormError(null); }} />
                </label>
                <label>
                  <span>Giá trị hóa đơn <b>*</b></span>
                  <span className="dhb__invoice-money-wrap">
                    <OGoDinhDang className="dhb__input dhb__invoice-money" inputMode="numeric"
                      value={amount ? Number(amount).toLocaleString("vi-VN") : ""}
                      onChange={(event) => { setAmount(event.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "")); setFormError(null); }} />
                    <i>đ</i>
                  </span>
                  <small className={`dhb__invoice-hint${remainingAfter < 0 ? " is-loi" : ""}`}>
                    {remainingAfter < 0
                      ? `Vượt phần đơn chưa ghi hóa đơn (${vnd(tranDon)}).`
                      : remainingAfter === 0
                        ? "Ghi xong là đủ tổng giá trị đơn."
                        : `Đơn còn ${vnd(remainingAfter)} chưa ghi hóa đơn.`}
                  </small>
                </label>
              </div>
              <div className="dhb__invoice-result">
                <h4>Sau khi ghi nhận</h4>
                <dl>
                  <dt>Khách nợ thêm</dt>
                  <dd>
                    <b>{vnd(expectedDebt)}</b>
                    {expectedOffset > 0 && <small>đã trừ {vnd(expectedOffset)} tiền cọc</small>}
                  </dd>
                  <dt>Hạn trả</dt>
                  <dd>
                    {dueDate ? (
                      <>
                        <b>{fmtDate(dueDate)}</b>
                        <small>{termDays} ngày công nợ của khách</small>
                      </>
                    ) : (
                      <span className="dhb__invoice-warn">Chưa có hạn trả vì khách chưa đặt số ngày công nợ ở hồ sơ khách hàng.</span>
                    )}
                  </dd>
                </dl>
              </div>
              {formError && <div className="banner banner--error" role="alert">{formError}</div>}
              <div className="dhb__invoice-form-actions">
                <button type="button" className="btn btn--secondary" onClick={() => setLuotGhi(null)} disabled={saving}>Hủy</button>
                <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Đang lưu..." : "Ghi nhận"}</button>
              </div>
            </form>
            </div>,
        document.body,
      )}
    </>
  );
}

function CancelDialog({ order, onClose, onSaved }: { order: OrderDetail; onClose: () => void; onSaved: (d: OrderDetail) => void }) {
  const { token } = useAuth();
  const isOrdered = order.status === "ordered";
  const [reason, setReason] = useState("");
  const [fault, setFault] = useState("khach");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      onSaved(await api.orders.cancel(token, order.id, reason, isOrdered ? fault : null));
    } catch (e: unknown) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} className="dhb__modal-overlay" style={{ zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} className="dhb__modal-content" style={{ width: 440 }}>
        <h3 className="dhb__modal-title" style={{ fontSize: 18 }}>Hủy đơn {order.order_no}</h3>
        <p style={{ color: "var(--ash)", fontSize: 13, marginTop: 0, marginBottom: 12 }}>
          {isOrdered
            ? "Đơn đã chốt — báo giá KHÔNG mở lại; cọc giữ nguyên, trả lại khách bằng nút Trả lại cọc trên đơn đã huỷ."
            : "Đơn nháp — hủy xong báo giá vẫn dùng lại được."}
        </p>
        {isOrdered && (
          <Field label="Lỗi tại ai">
            <select value={fault} onChange={(e) => setFault(e.target.value)} className="dhb__select" style={{ width: "100%" }}>
              <option value="khach">Khách hàng</option>
              <option value="xuong">Xưởng in</option>
            </select>
          </Field>
        )}
        <Field label="Lý do hủy">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Nêu lý do; nếu đã chốt, kể luôn tình trạng lúc hủy (vd: đã ra kẽm, khách đổi ý)." className="dhb__input" style={{ minHeight: 60, resize: "vertical" }} />
        </Field>
        {err && <div className="banner banner--error">{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>Đóng</button>
          <button className="btn btn--primary" onClick={submit} disabled={busy || !reason.trim()}>{busy ? "Đang hủy…" : "Xác nhận hủy"}</button>
        </div>
      </div>
    </div>
  );
}

// D3: Sale đổi GẤP / lưu ý SX SAU khi đơn đã CHỐT (đơn khóa sửa) → đường hẹp production-hint →
// backend broadcast → bàn Kế hoạch "ting" (badge nhảy). Chỉ 2 field, không đụng phần còn lại của đơn.
function ProductionHintEditor({ order, canEdit, onSaved }: { order: OrderDetail; canEdit: boolean; onSaved: (d: OrderDetail) => void }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [isRush, setIsRush] = useState(order.is_rush);
  const [note, setNote] = useState(order.production_note ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = isRush !== order.is_rush || note.trim() !== (order.production_note ?? "");

  async function save() {
    if (!token) return;
    setSaving(true);
    setErr(null);
    try {
      const d = await api.orders.updateProductionHint(token, order.id, {
        is_rush: isRush,
        production_note: note.trim(),
      });
      onSaved(d);
      setSaved(true);
      setOpen(false);
    } catch (e: unknown) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TheBen tieuDe="Lưu ý sản xuất" nut={canEdit && !open ? (
      <button type="button" className="dhb__ben-sua" title="Sửa lưu ý sản xuất" aria-label="Sửa lưu ý sản xuất"
        onClick={() => { setIsRush(order.is_rush); setNote(order.production_note ?? ""); setSaved(false); setOpen(true); }}>
        <Icon name="pencil" size={14} />
      </button>
    ) : undefined}>
      {!open ? (
        <>
          {order.is_rush && <div style={{ marginBottom: 4 }}><ChipTT mau="do">Gấp, ưu tiên xưởng</ChipTT></div>}
          <div className={order.production_note ? undefined : "dhb__muted"}>{order.production_note || "Chưa có lưu ý gửi xưởng"}</div>
          {saved && <small className="dhb__ben-xong">Đã cập nhật, bàn Kế hoạch nhận ngay.</small>}
        </>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={isRush} onChange={(e) => setIsRush(e.target.checked)} />
            <span>Hàng gấp, ưu tiên ở xưởng</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Lưu ý cho xưởng in (vd: in test màu trước, giấy khách ứng…)"
            className="dhb__input"
            style={{ minHeight: 60, resize: "vertical" }}
          />
          {err && <div className="banner banner--error">{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn--ghost" onClick={() => setOpen(false)} disabled={saving}>Đóng</button>
            <button className="btn btn--primary" onClick={save} disabled={saving || !dirty}>
              {saving ? "Đang lưu…" : "Lưu và báo xưởng"}
            </button>
          </div>
        </div>
      )}
    </TheBen>
  );
}

// --- Form sửa đặt-hàng --------------------------------------------------------
// Popup sửa đơn nháp — bấm "Sửa" ở đầu drawer là mở ngay, không phải cuộn tìm form dưới thân.
function EditDialog({ order, onCancel, onSaved }: { order: OrderDetail; onCancel: () => void; onSaved: (d: OrderDetail) => void }) {
  const { token } = useAuth();
  const [po, setPo] = useState(order.customer_po_no ?? "");
  const [date, setDate] = useState(order.delivery_committed_date ?? "");
  const [deliveryNote, setDeliveryNote] = useState(order.delivery_note ?? "");
  const [productionNote, setProductionNote] = useState(order.production_note ?? "");
  const [isRush, setIsRush] = useState(order.is_rush);
  const [depositPct, setDepositPct] = useState(order.deposit_pct != null ? String(order.deposit_pct).replace(".", ",") : "");
  // Cọc hai tab (20/10/2026): "%" trên tổng đơn gồm VAT hoặc "Số" tiền gõ thẳng. Lưu tab nào thì máy
  // chủ xoá cách kia. Số tiền không vượt tổng đơn gồm VAT.
  const [cocKieu, setCocKieu] = useState<"pct" | "so">(order.deposit_amount != null ? "so" : "pct");
  const [depositAmount, setDepositAmount] = useState(order.deposit_amount != null ? String(order.deposit_amount) : "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!token) return;
    const tienCoc = depositAmount === "" ? null : Number(depositAmount);
    if (cocKieu === "so" && tienCoc != null && tienCoc > order.total_with_vat) {
      setErr(`Tiền cọc không được vượt giá trị đơn hàng (${soVN(order.total_with_vat)} đ).`);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const d = await api.orders.update(token, order.id, {
        customer_po_no: po || null,
        delivery_committed_date: date || null,
        delivery_note: deliveryNote.trim() || null,
        production_note: productionNote.trim() || null,
        is_rush: isRush,
        ...(cocKieu === "so"
          ? { deposit_amount: tienCoc, ...(tienCoc == null ? { deposit_pct: null } : {}) }
          : { deposit_pct: depositPct.trim() === "" ? null : Math.min(100, Number(depositPct.replace(",", ".")) || 0),
              ...(depositPct.trim() === "" ? { deposit_amount: null } : {}) }),
      });
      onSaved(d);
    } catch (e: unknown) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={onCancel} className="dhb__modal-overlay" style={{ zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} className="dhb__modal-content" style={{ width: 480, display: "grid", gap: 8 }}>
      <h3 className="dhb__modal-title" style={{ fontSize: 18, margin: 0 }}>Sửa đơn {order.order_no}</h3>
      <Field label="Số PO khách"><input value={po} onChange={(e) => setPo(e.target.value)} className="dhb__input" /></Field>
      <Field label="Cọc phải thu">
        <div className="dhb__coc">
          <div className="dhb__coc-tab" role="tablist" aria-label="Cọc phải thu — cách nhập">
            {(["pct", "so"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={cocKieu === k}
                className={cocKieu === k ? "is-on" : undefined} onClick={() => { setCocKieu(k); setErr(null); }}>
                {k === "pct" ? "%" : "Số"}
              </button>
            ))}
          </div>
          {cocKieu === "pct" ? (
            <OGoDinhDang
              type="text"
              inputMode="decimal"
              aria-label="% cọc"
              value={depositPct}
              onChange={(e) => {
                // Nhận số thập phân "12,5" (L-VAI-33): giữ chữ số và MỘT dấu phẩy/chấm; kẹp 100 lúc gửi.
                const v = e.target.value.replace(/[^0-9.,]/g, "");
                const i = v.search(/[.,]/);
                setDepositPct(i < 0 ? v : v.slice(0, i) + "," + v.slice(i + 1).replace(/[.,]/g, ""));
              }}
              placeholder="vd 30"
              className="dhb__input"
            />
          ) : (
            <span className="dhb__invoice-money-wrap">
              <OGoDinhDang className="dhb__input dhb__invoice-money" inputMode="numeric" aria-label="Tiền cọc"
                value={depositAmount ? Number(depositAmount).toLocaleString("vi-VN") : ""}
                onChange={(e) => { setDepositAmount(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "")); setErr(null); }}
                placeholder={`tối đa ${soVN(order.total_with_vat)}`} />
              <i>đ</i>
            </span>
          )}
        </div>
      </Field>
      <Field label="Ngày giao cam kết"><ChonNgay aria-label="Ngày giao cam kết" value={date} onChange={(v) => setDate(v)} className="dhb__input" /></Field>
      {/* Địa chỉ giao + người nhận: KẾ THỪA từ báo giá gốc (Sale chọn ở màn Báo giá) — chỉ đọc ở
          đây, không sửa lại được trên đơn. */}
      <Field label="Địa chỉ giao">
        <div className="dhb__pick-echo">{order.delivery_address || "—"}</div>
      </Field>
      <Field label="Người nhận">
        <div className="dhb__pick-echo">
          {[order.delivery_contact_name, order.delivery_contact_phone].filter(Boolean).join(" · ") || "—"}
        </div>
      </Field>
      <Field label="Lưu ý giao hàng"><textarea value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} placeholder="Dặn tài xế / khâu giao (giờ giao, tầng, gọi trước…)" className="dhb__input" style={{ minHeight: 56, resize: "vertical" }} /></Field>
      <Field label="Lưu ý sản xuất"><textarea value={productionNote} onChange={(e) => setProductionNote(e.target.value)} placeholder="Dặn tổ in / xưởng (canh màu, cấn bế, gia công…)" className="dhb__input" style={{ minHeight: 56, resize: "vertical" }} /></Field>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer", userSelect: "none" }}>
        <input type="checkbox" checked={isRush} onChange={(e) => setIsRush(e.target.checked)} /> Hàng gấp (ưu tiên sản xuất)
      </label>
      {/* 3 ô "Bản chất đơn" · "Pháp nhân xuất HĐ" · "MST xuất HĐ" đã gỡ (2026-08-04). */}
      {err && <div className="banner banner--error">{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        <button className="btn btn--ghost" onClick={onCancel} disabled={saving}>Hủy</button>
        <button className="btn btn--primary" onClick={save} disabled={saving}>{saving ? "Đang lưu…" : "Lưu"}</button>
      </div>
      </div>
    </div>
  );
}

// Modal "Tạo đơn hàng" đã XOÁ: đơn chỉ sinh từ màn Báo giá khi khách chốt.

function ConfirmPanel({ order, canManage, canExtend, onSaved }: { order: OrderDetail; canManage: boolean; canExtend: boolean; onSaved: (d: OrderDetail) => void }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function doConfirm() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      onSaved(await api.orders.confirm(token, order.id));
    } catch (e: unknown) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }
  async function doExtend() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      onSaved(await api.orders.extendQuote(token, order.id));
    } catch (e: unknown) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {order.can_confirm ? (
        <div style={{ color: "#1f8a52", display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <Icon name="check" size={15} /> Đủ điều kiện chốt
        </div>
      ) : (
        <div style={{ display: "grid", gap: 4 }}>
          {order.confirm_blockers.map((b, i) => (
            <div key={i} style={{ color: "#b4432b", display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <Icon name="x" size={13} /> {b}
            </div>
          ))}
        </div>
      )}
      {order.quote_expired && canExtend && (
        <button className="btn btn--ghost" style={{ justifySelf: "start" }} disabled={busy} onClick={doExtend} title="Đặt lại hạn hiệu lực báo giá nguồn = hôm nay + 30 ngày">
          <Icon name="clock" size={14} /> Gia hạn báo giá (+30 ngày)
        </button>
      )}
      {err && <div className="banner banner--error">{err}</div>}
      {canManage && (
        <button className="btn btn--primary" style={{ justifySelf: "start" }} disabled={busy || !order.can_confirm} onClick={doConfirm}>
          <Icon name="check" size={15} /> Chốt đơn
        </button>
      )}
    </div>
  );
}

// `ApprovalPanel` + `APPROVAL_STATE_META` đã XOÁ cùng luồng duyệt đơn đặc thù.

// Form thu cọc = form Lập phiếu thu của Kế toán (`DepositReceiptDialog`), chỉ khác phần riêng của cọc.
function DepositForm({ order, onSaved }: { order: OrderDetail; onSaved: (d: OrderDetail) => void }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [canhBao, setCanhBao] = useState<string | null>(null);
  return (
    <>
      <Button variant="accent" onClick={() => { setCanhBao(null); setOpen(true); }}>Lập phiếu thu cọc</Button>
      {canhBao && <div className="banner banner--error" style={{ margin: "8px 0 0" }}>{canhBao}</div>}
      {open && (
        <DepositReceiptDialog
          order={order}
          coTheTaiTep={can("phieu_thu", "create")}
          onClose={() => setOpen(false)}
          onSaved={(d, cb) => {
            setOpen(false);
            setCanhBao(cb ?? null);
            onSaved(d);
          }}
        />
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 8 }}>
      <span style={{ display: "block", fontSize: 12, color: "var(--ash)", marginBottom: 3 }}>{label}</span>
      {children}
    </label>
  );
}
