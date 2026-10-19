// Báo cáo kho (kế toán) — ba tab (11/10/2026): Nhập-Xuất-Tồn (tổng hợp · chi tiết phiếu đã ghi sổ ·
// biểu đồ, CHUNG một bộ lọc kho + kỳ) · Giá gốc thành phẩm · Kỳ kế toán (mỗi kỳ một dòng: khóa sổ →
// tính giá, kèm lịch sử thao tác). docs/spec-bao-cao-kho.md. Chỉ quyền `close_book` vào.
import { ChonNgay } from "../components/ChonNgay";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  api,
  ApiError,
  type BaoCaoChuyenKhoRow,
  type BaoCaoKhoRow,
  type BaoCaoNXTRow,
  type HangLoai,
  type KhoaSoKyRow,
  type KhoExportLog,
  type KhoKhoaSoRow,
  type KyDaTinh,
  type LocThuocTinhKho,
  type LuaChonBaoCaoKho,
  type StockMaterialHistory,
} from "../api/client";
import { crud } from "../api/rebuildCatalog";
import { useCan } from "../auth/permissions";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icons";
import { EmptyRow, EmptyState } from "../components/EmptyState";
import { PhanTrangDayDu } from "../components/PhanTrangDayDu";
import { Select } from "../components/Select";
import { KhoGiaGocThanhPham } from "./KhoGiaGocThanhPham";
import { NutKho, NutKyBaoCao } from "./NutKhoKyBaoCao";
import { VoucherDrawer } from "./KhoYeuCauPage";
import { AN_DIEU_CHUYEN, DEFAULT_PAGE_SIZE, fmtQty, todayISO, useHeaderTitles } from "./khoShared";
import { Activity, CircleDot, User, Warehouse } from "lucide-react";
import { coDonViGoc, nhanKho } from "../lib/khoGiay";
import { useDebounced } from "../utils/useDebounced";
import { ThanhLoc } from "./thanh-loc/ThanhLoc";
import { khoangKy, type Khoang, type KyDS } from "./thanh-loc/ky-danh-sach";
import { soDaAp, type DieuKien, type GiaTriDK } from "./thanh-loc/thanh-loc";
import {
  ChipTT, ChonCot, CuonLuoi, OTim, rongLuoi, useCauHinhLuoi, type CauHinhLuoi, type CotLuoi, type MauTT,
} from "../components/LuoiDs";
import { useLocMan } from "./thanh-loc/useLocMan";
import {
  LOC_MAN_SO_KHO_TRONG,
  MAN_BAO_CAO_KHO,
  MOC_SO_KHO,
  dieuKienSoKho,
  dieuKienThuocTinh,
  locManSoKhoLenUrl,
  locTheoBang,
  locManSoKhoTuUrl,
  thamSoKySoKho,
  type LocSoKho,
} from "./dieu-kien-bao-cao-kho";
import "./rebuild-catalog.css";
import "./kho-request.css";
import { taoLuot } from "../lib/luotMoiNhat";

type KhoOpt = { id: number; ma: string; ten: string };
type Tab = "tong-quan" | "nxt" | "gia-goc" | "ky";

/** 1 dòng tab "Kỳ kế toán" — kỳ ĐANG KHÓA ghép với lần tính giá của nó. Luật (29/08/2026): khóa sổ
 *  trước rồi mới tính giá; mở sổ thì xoá số đã chốt. `kyIdx` = vị trí trong `kyList` (-1: kỳ có số đã
 *  tính mà không còn khóa — dữ liệu cũ, chỉ hiện cho khỏi mất dấu). */
type KyKeToanRow = {
  key: string;
  ten: string | null;
  tu: string;
  den: string;
  pham_vi: string;
  mien_tru: string[];
  khoa_luc: string | null;
  tinh: KyDaTinh | null;
  kyIdx: number;
};

/** ẨN tab "Tổng quan" (chỉ giao diện — code dashboard giữ nguyên). Bật lại: đổi thành `false`. */
const AN_TAB_TONG_QUAN = true;
/** ẨN nút "Xuất Excel" ở ĐẦU TRANG (mẫu MISA của tab Sổ kho). KHÔNG đụng nút "Xuất Excel" của tab
 *  Nhập-Xuất-Tồn. Bật lại: đổi thành `false`. */
const AN_NUT_XUAT_EXCEL_SO = true;

/** 1 dòng "Lịch sử thao tác" — gộp khóa/mở kỳ + xuất Excel. `tu`/`den` chỉ có ở khóa/mở (cho phễu ngày). */
type HistRow = {
  key: string;
  thoi_diem: string | null;
  hanh_dong: "khoa" | "mo" | "export" | "tinh_gia";
  pham_vi: string;
  khoang_ngay: string | null;
  ten_ky: string | null;
  nguoi_ten: string | null;
  tu?: string;
  den?: string;
};


function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}
/** Ngày bắt đầu HỢP LỆ cho kỳ khóa MỚI = ngày LIỀN SAU ngày đã khóa xa nhất trong phạm vi.
 *
 *  Kỳ RỜI NGÀY: kỳ trước kết thúc HẾT ngày cuối, kỳ sau bắt đầu ngày kế tiếp — mỗi ngày chỉ thuộc
 *  đúng MỘT kỳ (không đếm 2 lần, nhãn "từ…đến…" khớp nội dung). Số dư vẫn nối: cuối kỳ trước =
 *  đầu kỳ sau. Chưa khóa gì trong phạm vi → null. */
function nextKhoaTu(kyList: KhoaSoKyRow[], scope: number | "all"): string | null {
  const trong = kyList.filter((k) =>
    scope === "all" ? k.kho_id == null : k.kho_id == null || k.kho_id === scope,
  );
  if (trong.length === 0) return null;
  const maxDen = trong.reduce((m, k) => {
    const d = k.den_ngay.slice(0, 10);
    return d > m ? d : m;
  }, "");
  if (!maxDen) return null;
  const [y, m, d] = maxDen.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// Tên kỳ TỰ SINH từ khoảng ngày: trọn 1 tháng dương lịch → "Tháng M/YYYY"; ngược lại → "DD/MM/YYYY–DD/MM/YYYY".
function autoTenKy(tu: string | null, den: string | null): string {
  if (!tu || !den) return "";
  const t = tu.slice(0, 10);
  const d = den.slice(0, 10);
  const [ty, tm, td] = t.split("-").map(Number);
  const [dy, dm, dd] = d.split("-").map(Number);
  const lastDay = new Date(ty, tm, 0).getDate();  // tm 1-based + day 0 = ngày cuối tháng tm
  if (ty === dy && tm === dm && td === 1 && dd === lastDay) return `Tháng ${tm}/${ty}`;
  return `${fmtDate(t)}–${fmtDate(d)}`;
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  // Backend lưu UTC nhưng serialize KHÔNG kèm offset (naive) → thêm 'Z' để đổi về giờ máy cho đúng.
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return fmtDate(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}
function fmtMoney(n: number | null): string {
  return n == null ? "" : n.toLocaleString("vi-VN");
}
// Rút gọn tiền cho DẢI KPI (13.840.611.094 → "13,84 tỷ", 111.615.707 → "111,6 tr") để dải gọn,
// không tràn ô; số đầy đủ để ở tooltip (title). KHÔNG dùng cho Sổ kho / bảng chi tiết.
function fmtMoneyShort(n: number | null): string {
  if (n == null) return "";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) + " tỷ";
  if (a >= 1e6) return (n / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 }) + " triệu";
  if (a >= 1e3) return (n / 1e3).toLocaleString("vi-VN", { maximumFractionDigits: 0 }) + " nghìn";
  return n.toLocaleString("vi-VN");
}

// Bảng màu lát biểu đồ tròn — dùng đúng biến màu app (moss·rust·plum·amber·signal), ash cho "Khác".
const DONUT_COLORS = [
  "var(--moss)",
  "var(--rust)",
  "var(--plum)",
  "var(--amber)",
  "var(--signal)",
  "var(--ash)",
];

// Màu series biểu đồ kho — cố định theo LOẠI (không theo thứ hạng): Nhập moss · Xuất rust · Chuyển
// slate. Đúng --moss/--rust của phân hệ kho; slate cho điều chuyển (dịch nội bộ, tông trung tính).
const SERIES = {
  nhapDark: "#2f5d3a",
  nhapLight: "#6f9e79",
  xuatDark: "#c5400a",
  xuatLight: "#e8996a",
  move: "#64748b",
} as const;
const RC_DOT: Record<string, string> = { nhap: SERIES.nhapDark, xuat: SERIES.xuatDark, chuyen: SERIES.move };

type DonutSeg = { label: string; color: string; from: number; to: number; pct: number };

// Donut tỉ trọng giá trị theo mặt hàng: TOP 5 + gộp phần còn lại thành "Khác" (khỏi loạn quá nhiều
// lát). Trả các lát kèm mốc % để dựng conic-gradient.
function buildDonut(
  items: { ten: string | null; ma: string | null; tien: number }[],
  total: number,
): DonutSeg[] {
  const base = total > 0 ? total : items.reduce((s, x) => s + x.tien, 0) || 1;
  // BỎ mặt hàng chiếm < 0.5% giá trị (làm tròn ra "0%" — nhìn rối vô nghĩa): gộp hết vào "Khác".
  const big = items.filter((x) => x.tien > 0 && x.tien / base >= 0.005).slice(0, 5);
  const shown = big.reduce((s, x) => s + x.tien, 0);
  const khac = Math.max(0, base - shown);
  const segs = [
    ...big.map((t) => ({ label: t.ten ?? t.ma ?? "?", val: t.tien })),
    ...(khac / base >= 0.005 ? [{ label: "Khác", val: khac }] : []),
  ].filter((s) => s.val > 0);
  const denom = segs.reduce((s, x) => s + x.val, 0) || 1;
  let acc = 0;
  return segs.map((s, i) => {
    const from = (acc / denom) * 100;
    acc += s.val;
    return {
      label: s.label,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      from,
      to: (acc / denom) * 100,
      pct: (s.val / denom) * 100,
    };
  });
}

// Icon khóa/mở theo bộ icon dự án (SVG line, thừa kế currentColor) — thay cho emoji.
function LockIcon({ open = false, size = 13 }: { open?: boolean; size?: number }) {
  return <Icon name={open ? "lockOpen" : "lock"} size={size} style={{ verticalAlign: "-2px" }} />;
}

/** [đầu tháng, cuối tháng] hiện tại (ISO yyyy-mm-dd) — kỳ mặc định cho tab Nhập-Xuất-Tồn. */
function curMonthRange(): [string, string] {
  const d = new Date();
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
}

/* ---------------------------------------------------------------- lưới (11/10/2026) */
// Mọi bảng của màn dùng lưới chung (khuôn Sản lượng của bàn tổ): kéo rộng cột, ghim, đổi chỗ, ẩn qua nút
// Cột; tiêu đề MỘT hàng (ghim đo theo hàng tiêu đề đầu) nên bảng Nhập-Xuất-Tồn bỏ tiêu đề hai tầng.

interface CotBC extends CotLuoi { w?: number; n?: boolean; tien?: boolean }
const COT_NXT: CotBC[] = [
  { key: "ma", label: "Mã hàng", coDinh: true, w: 120 },
  { key: "ten", label: "Tên hàng", w: 240 },
  { key: "kho_giay", label: "Khổ", w: 100 },
  { key: "dvt", label: "ĐVT", w: 70 },
  { key: "dau_sl", label: "SL đầu kỳ", w: 110, n: true },
  { key: "dau_gt", label: "Giá trị đầu kỳ", w: 130, n: true, tien: true },
  { key: "nhap_sl", label: "SL nhập", w: 110, n: true },
  { key: "nhap_gt", label: "Giá trị nhập", w: 130, n: true, tien: true },
  { key: "xuat_sl", label: "SL xuất", w: 110, n: true },
  { key: "xuat_gt", label: "Giá trị xuất", w: 130, n: true, tien: true },
  { key: "cuoi_sl", label: "SL cuối kỳ", w: 110, n: true },
  { key: "cuoi_gt", label: "Giá trị cuối kỳ", w: 140, n: true, tien: true },
  { key: "bq", label: "Đơn giá BQ", w: 120, n: true, tien: true },
];
const COT_PHIEU: CotBC[] = [
  { key: "so_ct", label: "Số CT", coDinh: true, w: 130 },
  { key: "loai", label: "Loại phiếu", w: 110 },
  { key: "ngay_ct", label: "Ngày nhập/xuất kho", w: 120 },
  { key: "ly_do", label: "Lý do nhập / xuất", w: 200 },
  { key: "ngay_ghi_so", label: "Ngày ghi sổ", w: 110 },
  { key: "ky_khoa", label: "Kỳ khóa sổ", w: 170 },
  { key: "kho", label: "Kho", w: 160 },
  { key: "ma", label: "Mã hàng", w: 110 },
  { key: "ten", label: "Tên hàng", w: 240 },
  { key: "nhom", label: "Loại hàng", w: 110 },
  { key: "kho_giay", label: "Khổ", w: 100 },
  { key: "dvt", label: "ĐVT", w: 70 },
  { key: "sl", label: "Số lượng", w: 110, n: true },
  { key: "dg", label: "Đơn giá", w: 120, n: true, tien: true },
  { key: "tt", label: "Thành tiền", w: 130, n: true, tien: true },
  { key: "lenh", label: "Lệnh sản xuất", w: 130 },
  { key: "don_hang", label: "Đơn hàng", w: 110 },
  { key: "khach_hang", label: "Khách hàng", w: 200 },
  { key: "nha_cung_cap", label: "Nhà cung cấp", w: 200 },
  { key: "bo_phan", label: "Bộ phận yêu cầu", w: 160 },
  { key: "ma_yeu_cau", label: "Mã yêu cầu", w: 130 },
  { key: "nguoi_giao_nhan", label: "Người giao / nhận", w: 160 },
  { key: "nguoi_lap", label: "Người lập phiếu", w: 160 },
  { key: "hsd", label: "Hạn sử dụng", w: 110 },
  { key: "dien_giai", label: "Diễn giải" },
];
/** Cột phụ ẩn sẵn (bật ở nút Cột) — hiện đủ 25 cột thì lưới quá rộng để đọc. */
const AN_SAN_PHIEU = ["ngay_ghi_so", "nhom", "don_hang", "bo_phan", "ma_yeu_cau", "nguoi_giao_nhan", "nguoi_lap", "hsd"];
const NHAN_NHOM_HANG: Record<string, string> = { giay: "Giấy", vat_tu: "Vật tư", thanh_pham: "Thành phẩm" };
const COT_CHUYEN: CotBC[] = [
  { key: "so_ct", label: "Số CT", coDinh: true, w: 130 },
  { key: "ngay_ct", label: "Ngày nhập/xuất kho", w: 120 },
  { key: "ngay_ghi_so", label: "Ngày ghi sổ", w: 110 },
  { key: "ky_khoa", label: "Kỳ khóa sổ", w: 170 },
  { key: "tuyen", label: "Tuyến", w: 260 },
  { key: "ma", label: "Mã hàng", w: 110 },
  { key: "ten", label: "Tên hàng", w: 240 },
  { key: "dvt", label: "ĐVT", w: 70 },
  { key: "sl", label: "Số lượng", w: 110, n: true },
  { key: "dg", label: "Đơn giá vốn", w: 120, n: true, tien: true },
  { key: "tt", label: "Tiền vốn", w: 130, n: true, tien: true },
  { key: "dien_giai", label: "Diễn giải" },
];
const COT_KY: CotBC[] = [
  { key: "ten", label: "Tên kỳ", coDinh: true, w: 170 },
  { key: "khoang", label: "Khoảng ngày", w: 200 },
  { key: "pham_vi", label: "Phạm vi", w: 190 },
  { key: "trang_thai", label: "Trạng thái", w: 160 },
  { key: "khoa_luc", label: "Khóa lúc", w: 140 },
  { key: "tinh_luc", label: "Tính giá lúc", w: 140 },
  { key: "gt", label: "Giá trị cuối kỳ", w: 150, n: true, tien: true },
  { key: "nut", label: "Thao tác", coDinh: true, w: 200 },
];
const COT_LS: CotBC[] = [
  { key: "thoi_diem", label: "Thời điểm", coDinh: true, w: 140 },
  { key: "hanh_dong", label: "Hành động", w: 130 },
  { key: "pham_vi", label: "Phạm vi", w: 200 },
  { key: "khoang", label: "Khoảng ngày", w: 200 },
  { key: "ten_ky", label: "Tên kỳ", w: 170 },
  { key: "nguoi", label: "Người thực hiện" },
];
/** Người không có ô "Xem giá thành": máy chủ đã trả tiền rỗng — bỏ luôn cột cho khỏi tốn chỗ. */
const theoQuyenTien = (cot: CotBC[], xem: boolean) => (xem ? cot : cot.filter((c) => !c.tien));
/** Bộ cột đang vẽ: xếp theo thứ tự người xem, bỏ cột ẩn, áp độ rộng đã kéo. */
const cotHien = (luoi: CauHinhLuoi, cot: CotBC[]) => luoi.rongHien(luoi.xep(cot).filter((c) => !luoi.an.has(c.key)));

function DauLuoi({ cot, luoi }: { cot: CotBC[]; luoi: CauHinhLuoi }) {
  return (
    <>
      <colgroup>
        {cot.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
      </colgroup>
      <thead>
        <tr>{cot.map((c) => <th key={c.key} className={c.n ? "n" : undefined}>{c.key === "nut" ? "" : c.label}{luoi.keo(c.key)}</th>)}</tr>
      </thead>
    </>
  );
}

// Tab Kỳ kế toán: lọc TẠI CHỖ — danh sách kỳ và lịch sử thao tác nạp trọn (vài chục dòng mỗi năm).
type TrangThaiKy = "cho_tinh" | "tinh_toi" | "da_chot" | "chua_khoa";
const THU_TU_TT_KY: TrangThaiKy[] = ["cho_tinh", "tinh_toi", "da_chot", "chua_khoa"];
const NHAN_TT_KY: Record<TrangThaiKy, string> = {
  cho_tinh: "Chờ tính giá", tinh_toi: "Mới tính giữa kỳ", da_chot: "Đã chốt giá", chua_khoa: "Chưa khóa",
};
const MAU_TT_KY: Record<TrangThaiKy, MauTT> = { cho_tinh: "vang", tinh_toi: "cyan", da_chot: "xanh", chua_khoa: "xam" };
const NHAN_HD: Record<HistRow["hanh_dong"], string> = { tinh_gia: "Tính giá kỳ", khoa: "Khóa kỳ", mo: "Mở kỳ", export: "Xuất Excel" };
const MAU_HD: Record<HistRow["hanh_dong"], MauTT> = { tinh_gia: "tim", khoa: "cam", mo: "la", export: "slate" };
const THU_TU_HD: HistRow["hanh_dong"][] = ["tinh_gia", "khoa", "mo", "export"];

type LocKy = { trang_thai: string[]; pham_vi: string[] };
type LocLs = { hanh_dong: string[]; pham_vi: string[]; nguoi: string[] };
const LOC_KY_TRONG: LocKy = { trang_thai: [], pham_vi: [] };
const LOC_LS_TRONG: LocLs = { hanh_dong: [], pham_vi: [], nguoi: [] };
const MOC_KY: [string, string][] = [["khoang", "Khoảng ngày của kỳ"], ["khoa_luc", "Ngày khóa"]];
const MOC_LS: [string, string][] = [["thoi_diem", "Thời điểm thao tác"], ["khoang", "Khoảng ngày của kỳ"]];
const KY_KY_MAC_DINH: KyDS = { loai: "tat_ca", moc: "khoang" };
const KY_LS_MAC_DINH: KyDS = { loai: "tat_ca", moc: "thoi_diem" };

function trangThaiKy(r: KyKeToanRow): TrangThaiKy {
  if (r.kyIdx < 0) return "chua_khoa";
  if (!r.tinh) return "cho_tinh";
  return r.tinh.den_ngay.slice(0, 10) >= r.den ? "da_chot" : "tinh_toi";
}
/** Giá trị chọn được của nút Lọc + số dòng mang nó. `thuTu` cố định thứ tự (trạng thái), không thì A-Z. */
function demGiaTri<T>(rows: T[], lay: (r: T) => string | null | undefined, nhan?: (v: string) => string, thuTu?: string[]): GiaTriDK[] {
  const dem = new Map<string, number>();
  for (const r of rows) {
    const v = lay(r);
    if (v) dem.set(v, (dem.get(v) ?? 0) + 1);
  }
  const ds = thuTu ? thuTu.filter((v) => dem.has(v)) : [...dem.keys()].sort((a, b) => a.localeCompare(b, "vi"));
  return ds.map((v) => ({ value: v, nhan: nhan ? nhan(v) : v, so: dem.get(v) }));
}
/** Kỳ [tu, den] có giao khoảng lọc không. */
const giaoKhoang = (tu: string, den: string, k: Khoang) => den.slice(0, 10) >= k.tu && tu.slice(0, 10) <= k.den;
/** Thời điểm (ISO) có rơi vào khoảng lọc không. */
const trongKhoang = (d: string | null, k: Khoang) => !!d && k.tu <= d.slice(0, 10) && d.slice(0, 10) <= k.den;

export function KhoBaoCaoPage({ token }: { token: string }) {
  // Hover tiêu đề cột → hiện tên cột đầy đủ (kể cả khi bị cắt) — 1 ref bọc cả trang, phủ mọi bảng.
  const pageRef = useHeaderTitles<HTMLElement>();
  const [tab, setTab] = useState<Tab>(AN_TAB_TONG_QUAN ? "nxt" : "tong-quan");
  // Chiều của phần "Chi tiết phiếu": Nhập · Xuất · Chuyển kho (sổ điều chuyển nội bộ đã ghi sổ).
  // Nhập và xuất CHUNG một bảng (11/10/2026) — lọc bằng điều kiện "Loại phiếu" của nút Lọc. Chuyển
  // kho nội bộ vẫn là bảng riêng (đang ẩn theo `AN_DIEU_CHUYEN`).
  const [soChieu, setSoChieu] = useState<"PHIEU" | "CHUYEN">("PHIEU");
  // Kho của tab Nhập-Xuất-Tồn (đi theo kỳ đã khóa) — dùng CHUNG cho tổng hợp lẫn chi tiết phiếu.
  const [khoId, setKhoId] = useState<number | null>(null);
  // Tổng quan (đang ẩn): kỳ + kho của thanh lọc riêng. Chi tiết phiếu chỉ lấy phần khoảng số (SL /
  // đơn giá / thành tiền) của thanh lọc này — kỳ và kho đi theo bộ lọc chung của tab.
  const [locMan, setLocMan] = useLocMan(MAN_BAO_CAO_KHO, LOC_MAN_SO_KHO_TRONG, locManSoKhoTuUrl, locManSoKhoLenUrl);
  const ky = locMan.ky;
  const datKy = (k: KyDS) => setLocMan({ ky: k, loc: locMan.loc });
  const datLoc = (l: LocSoKho) => setLocMan({ ky: locMan.ky, loc: l });
  // Kỳ của tab N-X-T, mặc định THÁNG HIỆN TẠI để vào tab là thấy số ngay thay vì bảng trống.
  const [nxtTu, setNxtTu] = useState(() => curMonthRange()[0]);
  const [nxtDen, setNxtDen] = useState(() => curMonthRange()[1]);
  // Kỳ (đã khóa) đang chọn ở ô "Kỳ" — index trong kyList; -1 = nhập ngày tay. Khi CÓ chọn kỳ thì
  // "Từ ngày" khóa cứng (= đầu kỳ), chỉ cho sửa "Đến ngày" (tính giá tới bất kỳ thời điểm trong kỳ).
  const [nxtKyIdx, setNxtKyIdx] = useState(-1);
  // Mốc kỳ mà khoảng ngày đang gắn theo ("tu|den|kho") — để biết khi nào phải nạp lại trọn khoảng.
  const kyDaGan = useRef<string | null>(null);
  // Cách xem số liệu của kỳ: Tổng hợp (N-X-T) · Chi tiết phiếu (từng dòng phiếu đã ghi sổ) · Biểu đồ.
  const [nxtView, setNxtView] = useState<"bang" | "chitiet" | "bieudo">("bang");
  // Tab Kỳ kế toán: danh sách kỳ ↔ lịch sử thao tác (khóa / mở / tính giá / xuất Excel).
  const [kyView, setKyView] = useState<"ky" | "lichsu">("ky");

  // Sổ kho: máy chủ trả ĐÚNG trang đang xem + tổng số dòng + tổng tiền mọi dòng khớp lọc.
  const [rows, setRows] = useState<BaoCaoKhoRow[]>([]);
  const [chuyenRows, setChuyenRows] = useState<BaoCaoChuyenKhoRow[]>([]);
  const [soDong, setSoDong] = useState(0);
  const [tongTienSo, setTongTienSo] = useState<number | null>(null);
  // Tab N-X-T (bình quân gia quyền cuối kỳ) — 1 dòng / mặt hàng / kho.
  const [nxtRows, setNxtRows] = useState<BaoCaoNXTRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [khoList, setKhoList] = useState<KhoOpt[]>([]);
  const [exporting, setExporting] = useState(false);

  // Khóa/mở kỳ + lịch sử + các kỳ CÒN đang khóa (tab "Kỳ đã khóa")
  const [locks, setLocks] = useState<KhoKhoaSoRow[]>([]);
  // Lịch sử XUẤT EXCEL (gộp vào tab "Lịch sử thao tác" cùng khóa/mở kỳ).
  const [exports, setExports] = useState<KhoExportLog[]>([]);
  const [kyList, setKyList] = useState<KhoaSoKyRow[]>([]);
  const [kyDaTinhList, setKyDaTinhList] = useState<KyDaTinh[]>([]);
  const [khoaOpen, setKhoaOpen] = useState(false);
  const [khoaScope, setKhoaScope] = useState<"all" | number>("all");
  const [khoaHanhDong, setKhoaHanhDong] = useState<"khoa" | "mo">("khoa");
  const [khoaTu, setKhoaTu] = useState("");
  const [khoaDen, setKhoaDen] = useState(todayISO());
  const [khoaTen, setKhoaTen] = useState("");   // tên kỳ khi KHÓA (tuỳ chọn, chặn trùng)
  const [khoaBusy, setKhoaBusy] = useState(false);
  const [khoaError, setKhoaError] = useState<string | null>(null);

  useEffect(() => {
    crud("/api/kho")
      .list(token, { active: true })
      .then((r) =>
        setKhoList(
          r.items.map((w) => ({ id: Number(w.id), ma: String(w.ma), ten: String(w.ten) })),
        ),
      )
      .catch(() => {});
  }, [token]);

  const loadLocks = useCallback(() => {
    api.kho.baoCao.khoaSo(token).then(setLocks).catch(() => {});
    api.kho.baoCao.ky(token).then(setKyList).catch(() => {});
  }, [token]);
  useEffect(() => {
    loadLocks();
  }, [loadLocks]);
  // Mở tab Kỳ kế toán → nạp lại các lần tính giá + lịch sử xuất Excel (xảy ra ở tab khác).
  useEffect(() => {
    if (tab !== "ky") return;
    api.kho.baoCao.lichSuExport(token).then(setExports).catch(() => {});
    api.kho.baoCao.kyDaTinh(token).then(setKyDaTinhList).catch(() => {});
  }, [token, tab]);

  // Ô "Xem giá thành" của CHÍNH màn Báo cáo kho (05/10/2026 — mỗi màn kho một ô xem giá riêng).
  const can = useCan();
  const canViewCost = can("bao_cao_kho", "view_cost");
  // Tính giá kỳ + khoá/mở kỳ = ô "Khóa sổ" (`close_book`), đúng cổng máy chủ (#53): người chỉ có
  // Xem trước đó thấy nút, điền hộp xong mới ăn 403.
  const canCloseBook = can("bao_cao_kho", "close_book");
  const [search, setSearch] = useState("");
  const searchTre = useDebounced(search.trim());
  // Điều kiện THUỘC TÍNH của nút Lọc (loại phiếu, lý do, loại hàng, mặt hàng, đối tác, phát sinh, tồn) — chung
  // cho Tổng hợp và Chi tiết phiếu; mỗi bảng chỉ gửi phần nó nhận (`locTheoBang`). Lọc ở máy chủ.
  const [locTT, setLocTT] = useState<LocThuocTinhKho>({});
  const [luaChonNxt, setLuaChonNxt] = useState<LuaChonBaoCaoKho | null>(null);
  const [luaChonCt, setLuaChonCt] = useState<LuaChonBaoCaoKho | null>(null);
  const khoaLocNxt = JSON.stringify(locTheoBang(locTT, "nxt"));
  const khoaLocCt = JSON.stringify(locTheoBang(locTT, "chitiet"));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  // Tham số máy chủ của Chi tiết phiếu (trừ chiều + trang) — chung cho bảng và file Excel. Kỳ + kho
  // lấy ĐÚNG bộ lọc chung của tab N-X-T (theo ngày nhập/xuất kho — cùng mốc với N-X-T và khóa kỳ),
  // nên đổi qua lại Tổng hợp ↔ Chi tiết không phải lọc lại.
  const thamSoSo = useMemo(
    () => ({
      tu_ngay: nxtTu || null,
      den_ngay: nxtDen || null,
      moc: nxtTu && nxtDen ? "ct" : null,
      kho_id: khoId,
      q: searchTre || null,
      loc: JSON.parse(khoaLocCt) as LocThuocTinhKho,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nxtTu, nxtDen, khoId, searchTre, khoaLocCt],
  );
  // Đổi điều kiện / chiều / cỡ trang ⇒ về trang 1.
  const khoaLocSo = JSON.stringify([thamSoSo, soChieu, pageSize]);
  const [khoaLocDaThay, setKhoaLocDaThay] = useState(khoaLocSo);
  if (khoaLocDaThay !== khoaLocSo) {
    setKhoaLocDaThay(khoaLocSo);
    setPage(1);
  }

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const p = { ...thamSoSo, page, size: pageSize };
    // ⚠ `dong`/`exportXlsxBlobUrl` KHÔNG nhận "CHUYEN" (loai = NHAP/XUAT) → branch TRƯỚC khi gọi.
    if (soChieu === "CHUYEN") {
      api.kho.baoCao
        .chuyenKho(token, p)
        .then((r) => { setChuyenRows(r.items); setSoDong(r.total); setTongTienSo(r.tong_tien ?? null); setLuaChonCt(r.lua_chon ?? null); })
        .catch((e) => setError(e instanceof ApiError ? e.message : "Không tải được báo cáo."))
        .finally(() => setLoading(false));
    } else {
      api.kho.baoCao
        .dong(token, p)
        .then((r) => { setRows(r.items); setSoDong(r.total); setTongTienSo(r.tong_tien ?? null); setLuaChonCt(r.lua_chon ?? null); })
        .catch((e) => setError(e instanceof ApiError ? e.message : "Không tải được báo cáo."))
        .finally(() => setLoading(false));
    }
  }, [token, thamSoSo, soChieu, page, pageSize]);
  useEffect(() => {
    if (tab === "nxt" && nxtView === "chitiet") load();
  }, [load, tab, nxtView]);

  // Tab N-X-T: nạp theo kỳ [tu, den] + kho (BẮT BUỘC chọn kỳ) + ô Tìm — lọc ở máy chủ.
  const [nxtDaTinh, setNxtDaTinh] = useState(false);   // kỳ này đã tính giá (snapshot) chưa
  const [nxtDaKhoa, setNxtDaKhoa] = useState(false);   // kỳ này đã khóa sổ chưa
  // "Đến ngày" rơi GIỮA một kỳ ĐÃ TÍNH (chốt ở ngày khác) → vẫn hiện cuối kỳ, dạng TẠM TÍNH.
  const [nxtKyBao, setNxtKyBao] = useState<{ den: string; ten: string | null } | null>(null);
  // Lượt về sau không được đè lượt mới hơn (#48): lúc vào màn có lượt "tháng này" mặc định rồi lượt
  // theo kỳ đã khoá, lượt tháng về chậm hơn là bảng hiện số tạm tính dưới tên kỳ đã chốt.
  const luotNxt = useRef(taoLuot()).current;
  const loadNxt = useCallback(() => {
    const conMoi = luotNxt.bat();
    if (!nxtTu || !nxtDen) {
      setNxtRows([]); setNxtDaTinh(false); setNxtDaKhoa(false); setNxtKyBao(null); return;
    }
    setLoading(true);
    setError(null);
    api.kho.baoCao
      .nxt(token, { tu: nxtTu, den: nxtDen, kho_id: khoId, q: searchTre || undefined, loc: JSON.parse(khoaLocNxt) })
      .then((p) => {
        if (!conMoi()) return;
        setNxtRows(p.items); setNxtDaTinh(p.da_tinh); setNxtDaKhoa(p.da_khoa); setLuaChonNxt(p.lua_chon ?? null);
        setNxtKyBao(p.ky_da_tinh_den ? { den: p.ky_da_tinh_den, ten: p.ky_da_tinh_ten } : null);
      })
      .catch((e) => { if (conMoi()) setError(e instanceof ApiError ? e.message : "Không tải được báo cáo N-X-T."); })
      .finally(() => { if (conMoi()) setLoading(false); });
  }, [token, nxtTu, nxtDen, khoId, searchTre, khoaLocNxt, luotNxt]);
  // Chi tiết phiếu nạp riêng (xem `load`) — hai bên dùng chung cờ `loading` nên đừng nạp chồng.
  const xemTongHop = tab === "nxt" && nxtView !== "chitiet";
  useEffect(() => {
    if (xemTongHop) loadNxt();
  }, [loadNxt, xemTongHop]);
  // Tab N-X-T bám theo KỲ ĐÃ KHÓA: "Từ ngày" LUÔN là đầu của kỳ đang chọn.
  // Chưa chọn kỳ → tự chọn (kỳ chứa hôm nay, không có thì kỳ mới nhất).
  // ĐÃ chọn → vẫn phải ĐỒNG BỘ LẠI ngày: `kyList` đổi dưới chân khi vừa khóa/mở sổ, index cũ trỏ
  // sang kỳ khác ⇒ nhãn dropdown một đằng mà Từ/Đến một nẻo (bug 09/09: dropdown "01/08–09/09"
  // nhưng Từ ngày vẫn là 01/09 mặc định, nên tính giá + báo cáo chạy sai khoảng).
  // Không có kỳ nào đã khóa → để nguyên khoảng mặc định (tháng hiện tại) cho còn xem được.
  useEffect(() => {
    if (tab !== "nxt" || kyList.length === 0) return;
    let i = nxtKyIdx;
    if (i < 0) {
      const hnay = todayISO();
      const j = kyList.findIndex(
        (k) => k.tu_ngay.slice(0, 10) <= hnay && hnay <= k.den_ngay.slice(0, 10),
      );
      i = j >= 0 ? j : 0;
    } else if (i > kyList.length - 1) {
      i = kyList.length - 1;      // danh sách vừa ngắn lại (mở sổ) → kẹp cho khỏi trỏ ra ngoài
    }
    const k = kyList[i];
    if (!k) return;
    if (i !== nxtKyIdx) setNxtKyIdx(i);
    // Nạp trọn khoảng MỖI KHI GẮN SANG MỘT KỲ KHÁC — nhận diện kỳ bằng chính khoảng ngày + kho,
    // KHÔNG so với `nxtTu` (đầu kỳ có thể trùng ngẫu nhiên với mặc định ⇒ bỏ sót việc nạp "đến").
    // Đã gắn rồi thì thôi, nên người dùng đổi "đến ngày" để tính giữa kỳ không bị ghi đè.
    const moc = `${k.tu_ngay.slice(0, 10)}|${k.den_ngay.slice(0, 10)}|${k.kho_id ?? ""}`;
    if (kyDaGan.current !== moc) {
      kyDaGan.current = moc;
      setNxtTu(k.tu_ngay.slice(0, 10));
      setNxtDen(k.den_ngay.slice(0, 10));
      setKhoId(k.kho_id ?? null);
    }
  }, [tab, kyList, nxtKyIdx]);

  // "Tính giá kỳ" (bình quân, kiểu MISA) — popup xác nhận rồi chốt tồn cuối kỳ vào snapshot.
  const [tinhOpen, setTinhOpen] = useState(false);
  const [tinhBusy, setTinhBusy] = useState(false);
  const [tinhErr, setTinhErr] = useState<string | null>(null);
  // Xuất Excel bảng N-X-T (mẫu MISA: nhóm theo kho + dòng cộng). File = ĐÚNG kỳ/kho đang xem.
  const [nxtExporting, setNxtExporting] = useState(false);
  async function exportNxt() {
    if (!nxtTu || !nxtDen) return;
    setNxtExporting(true);
    setError(null);
    let url: string | null = null;
    try {
      url = await api.kho.baoCao.nxtExportXlsxBlobUrl(token, {
        tu: nxtTu, den: nxtDen, kho_id: khoId, q: searchTre || undefined, loc: JSON.parse(khoaLocNxt),
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `Nhap-Xuat-Ton ${fmtDate(nxtTu)}–${fmtDate(nxtDen)}.xlsx`.replace(/\//g, "-");
      document.body.appendChild(a);
      a.click();
      a.remove();
      api.kho.baoCao.lichSuExport(token).then(setExports).catch(() => {});   // hiện ở Lịch sử thao tác
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không xuất được Excel N-X-T.");
    } finally {
      if (url) URL.revokeObjectURL(url);
      setNxtExporting(false);
    }
  }

  // Mở popup Tính giá: BẮT BUỘC dựa trên 1 KỲ ĐÃ KHÓA. Chưa chọn kỳ mà có kỳ đã khóa → chọn sẵn
  // kỳ khớp khoảng đang xem, không thì kỳ mới nhất (index 0).
  function openTinhPopup() {
    setTinhErr(null);
    if (nxtKyIdx < 0 && kyList.length) {
      const match = kyList.findIndex((k) => k.tu_ngay.slice(0, 10) === nxtTu && k.den_ngay.slice(0, 10) === nxtDen);
      const i = match >= 0 ? match : 0;
      const k = kyList[i];
      setNxtKyIdx(i);
      setNxtTu(k.tu_ngay.slice(0, 10));
      setNxtDen(k.den_ngay.slice(0, 10));
      setKhoId(k.kho_id ?? null);
    }
    setTinhOpen(true);
  }
  async function tinhGiaKy() {
    if (!nxtTu || !nxtDen) return;
    if (nxtKyIdx < 0) { setTinhErr("Chọn một kỳ đã khóa để tính giá."); return; }
    setTinhBusy(true);
    setTinhErr(null);
    try {
      // ĐẦU KỲ lấy THẲNG từ kỳ đã khóa đang chọn, KHÔNG tin `nxtTu` — nếu state lệch (danh sách kỳ
      // vừa đổi) thì chốt nhầm khoảng là hỏng cả snapshot. "Đến" giữ theo người dùng (tính giữa kỳ)
      // nhưng kẹp trong kỳ.
      const kSel = kyList[nxtKyIdx];
      const tuKy = kSel ? kSel.tu_ngay.slice(0, 10) : nxtTu;
      const denKy = kSel ? kSel.den_ngay.slice(0, 10) : nxtDen;
      const den = nxtDen < tuKy || nxtDen > denKy ? denKy : nxtDen;
      const ten = (kSel?.ten?.trim() || autoTenKy(tuKy, den)) || null;
      const p = await api.kho.baoCao.tinhGiaKy(token, { tu: tuKy, den, kho_id: khoId, ten });
      setNxtDaTinh(p.da_tinh);
      setNxtDaKhoa(p.da_khoa);
      setNxtKyBao(null);            // vừa chốt đúng mốc này → không còn là "tạm tính trong kỳ"
      setTinhOpen(false);
      // Máy chủ trả bảng chưa áp nút Lọc — nạp lại theo đúng bộ lọc đang xem.
      if (tab === "nxt") loadNxt();
      // Dòng kỳ ở tab Kỳ kế toán đổi sang "Đã chốt giá" + lịch sử có thêm lần tính.
      api.kho.baoCao.kyDaTinh(token).then(setKyDaTinhList).catch(() => {});
      api.kho.baoCao.lichSuExport(token).then(setExports).catch(() => {});
    } catch (e) {
      setTinhErr(e instanceof ApiError ? e.message : "Không tính được giá kỳ.");
    } finally {
      setTinhBusy(false);
    }
  }

  // Bấm 1 mặt hàng ở bảng N-X-T → popup lô NHẬP + lịch sử XUẤT của mặt hàng đó (tại kho của dòng).
  const [matInfo, setMatInfo] = useState<
    { kho_id: number; kho_ten: string | null; hang_loai: HangLoai; hang_id: number; ten: string | null; dvt: string | null } | null
  >(null);
  const [matHist, setMatHist] = useState<StockMaterialHistory | null>(null);
  const [matLoading, setMatLoading] = useState(false);
  const [matErr, setMatErr] = useState<string | null>(null);
  function openMatHang(r: BaoCaoNXTRow) {
    if (r.kho_id == null) return;
    const kho = r.hang_loai === "giay" && r.kho_rong ? nhanKho(r.kho_rong, r.kho_dai) : "";
    setMatInfo({ kho_id: r.kho_id, kho_ten: r.kho_ten, hang_loai: r.hang_loai as HangLoai, hang_id: r.hang_id,
      ten: kho ? `${r.ten_hang ?? ""} (${kho})` : r.ten_hang, dvt: r.dvt });
    setMatHist(null);
    setMatErr(null);
    setMatLoading(true);
    // Giấy: dòng N-X-T là một (khổ, đơn vị gốc); vật tư khác một đơn vị gốc — lịch sử lọc đúng dòng đó.
    const giay = !coDonViGoc(r.hang_loai) ? undefined
      : { goc: r.don_vi_goc ?? "", kho_rong: r.kho_rong, kho_dai: r.kho_dai };
    api.kho.phieu
      .lichSuVatTu(token, r.hang_loai as HangLoai, r.hang_id, r.kho_id, giay, "bao_cao")
      .then(setMatHist)
      .catch((e) => setMatErr(e instanceof ApiError ? e.message : "Không tải được lịch sử mặt hàng."))
      .finally(() => setMatLoading(false));
  }

  // Bấm mã phiếu trong popup lô → đóng popup lô, mở PHIẾU đó (chỉ xem — không sửa/ghi sổ ở đây).
  const [giaGocTong, setGiaGocTong] = useState<number | null>(null);
  const [openVoucherId, setOpenVoucherId] = useState<number | null>(null);
  function openVoucher(vid: number | null) {
    if (vid == null) return;
    setMatInfo(null);
    setMatHist(null);
    setOpenVoucherId(vid);
  }

  // Tab "Tổng quan": cần CẢ Nhập + Xuất + Chuyển kho theo cùng bộ lọc kho/ngày. Nhập/Xuất từ Sổ (đã
  // lọc bỏ điều chuyển) → tổng mua/bán KHÔNG bị điều chuyển thổi phồng; Chuyển kho nạp RIÊNG (endpoint
  // /bao-cao/chuyen-kho) để vẫn HIỆN được ở dashboard dù đã bỏ khỏi Sổ Nhập/Xuất.
  const [dashRows, setDashRows] = useState<BaoCaoKhoRow[]>([]);
  const [dashChuyen, setDashChuyen] = useState<BaoCaoChuyenKhoRow[]>([]);
  const loadDash = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.kho.baoCao.dong(token, { ...thamSoKySoKho(ky), kho_id: locMan.loc.kho ?? null, loai: "NHAP" }),
      api.kho.baoCao.dong(token, { ...thamSoKySoKho(ky), kho_id: locMan.loc.kho ?? null, loai: "XUAT" }),
      api.kho.baoCao.chuyenKho(token, { ...thamSoKySoKho(ky), kho_id: locMan.loc.kho ?? null }),
    ])
      .then(([n, x, c]) => { setDashRows([...n.items, ...x.items]); setDashChuyen(c.items); })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Không tải được tổng quan."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, JSON.stringify(ky), locMan.loc.kho]);
  useEffect(() => {
    if (tab === "tong-quan") loadDash();
  }, [loadDash, tab]);


  // Tổng hợp dashboard — tính client-side từ ĐÚNG data sổ (khớp con số tab Sổ nhập-xuất).
  const dash = useMemo(() => {
    // Sổ Nhập/Xuất giờ HIỆN điều chuyển (như nhập/xuất thường). Nhưng ở dashboard, LOẠI điều chuyển
    // khỏi Tổng nhập/Tổng xuất (mua/bán) — điều chuyển là dịch kho nội bộ A→B, cộng vào là thổi
    // phồng mua/bán. Điều chuyển hiện RIÊNG ở thẻ "Chuyển kho nội bộ" (từ dashChuyen).
    const bizRows = dashRows.filter((r) => !r.dieu_chuyen);
    const nhap = bizRows.filter((r) => r.loai === "NHAP");
    const xuat = bizRows.filter((r) => r.loai === "XUAT");
    const sumTien = (rs: BaoCaoKhoRow[]) => rs.reduce((s, r) => s + (r.thanh_tien ?? 0), 0);
    const soPhieu = (rs: BaoCaoKhoRow[]) => new Set(rs.map((r) => r.so_ct)).size;
    const tongNhap = sumTien(nhap);
    const tongXuat = sumTien(xuat);

    const khoAgg = new Map<number, { ten: string; nhap: number; xuat: number; phieu: Set<string> }>();
    for (const r of bizRows) {
      const key = r.kho_id ?? -1;
      let cur = khoAgg.get(key);
      if (!cur) {
        cur = { ten: r.kho_ten ?? "—", nhap: 0, xuat: 0, phieu: new Set() };
        khoAgg.set(key, cur);
      }
      if (r.loai === "NHAP") cur.nhap += r.thanh_tien ?? 0;
      else cur.xuat += r.thanh_tien ?? 0;
      cur.phieu.add(r.so_ct);
    }
    const theoKho = [...khoAgg.values()]
      .map((k) => ({ ten: k.ten, nhap: k.nhap, xuat: k.xuat, phieu: k.phieu.size }))
      .sort((a, b) => b.nhap + b.xuat - (a.nhap + a.xuat));

    const topBy = (rs: BaoCaoKhoRow[]) => {
      const m = new Map<
        string,
        { ma: string | null; ten: string | null; dvt: string | null; sl: number; tien: number }
      >();
      for (const r of rs) {
        // Giấy tách theo khổ + đơn vị gốc — gộp dòng đếm tờ với dòng đếm kg là cộng hai thang khác nhau.
        const kho = r.don_vi_goc && r.kho_rong ? nhanKho(r.kho_rong, r.kho_dai) : "";
        const key = `${r.ma_hang ?? r.ten_hang ?? "?"}|${kho}|${r.don_vi_goc ?? ""}`;
        let cur = m.get(key);
        if (!cur) {
          cur = { ma: r.ma_hang, ten: kho ? `${r.ten_hang ?? ""} (${kho})` : r.ten_hang, dvt: r.dvt, sl: 0, tien: 0 };
          m.set(key, cur);
        }
        cur.sl += r.so_luong ?? 0;
        cur.tien += r.thanh_tien ?? 0;
      }
      return [...m.values()].sort((a, b) => b.tien - a.tien).slice(0, 10);
    };

    // Chuyển kho (từ dashChuyen): theo TUYẾN (từ kho → đến kho) + TOP mặt hàng chuyển.
    const tuyenAgg = new Map<string, { tuyen: string; giaTri: number; phieu: Set<string> }>();
    for (const r of dashChuyen) {
      const tuyen = `${r.kho_xuat_ten ?? "—"} → ${r.kho_nhap_ten ?? "—"}`;
      let cur = tuyenAgg.get(tuyen);
      if (!cur) {
        cur = { tuyen, giaTri: 0, phieu: new Set() };
        tuyenAgg.set(tuyen, cur);
      }
      cur.giaTri += r.tien_von ?? 0;
      cur.phieu.add(r.so_ct);
    }
    const chuyenTheoTuyen = [...tuyenAgg.values()]
      .map((t) => ({ tuyen: t.tuyen, giaTri: t.giaTri, phieu: t.phieu.size }))
      .sort((a, b) => b.giaTri - a.giaTri)
      .slice(0, 10);
    const topChuyenMap = new Map<
      string,
      { ma: string | null; ten: string | null; dvt: string | null; sl: number; tien: number }
    >();
    for (const r of dashChuyen) {
      const key = r.ma_hang ?? r.ten_hang ?? "?";
      let cur = topChuyenMap.get(key);
      if (!cur) {
        cur = { ma: r.ma_hang, ten: r.ten_hang, dvt: r.dvt, sl: 0, tien: 0 };
        topChuyenMap.set(key, cur);
      }
      cur.sl += r.so_luong ?? 0;
      cur.tien += r.tien_von ?? 0;
    }
    const topChuyen = [...topChuyenMap.values()].sort((a, b) => b.tien - a.tien).slice(0, 10);

    // Chuỗi thời gian Nhập/Xuất — mặc định theo NGÀY; tự gộp theo THÁNG nếu quá nhiều ngày (>45)
    // để biểu đồ khỏi tràn/rối.
    const ngayCo = new Set(
      [
        ...bizRows.map((r) => (r.ngay_ghi_so ?? "").slice(0, 10)),
        ...dashChuyen.map((r) => (r.ngay_ghi_so ?? "").slice(0, 10)),
      ].filter(Boolean),
    );
    const theoThang = ngayCo.size > 45;
    const tsMap = new Map<string, { nhap: number; xuat: number; chuyen: number }>();
    const bump = (raw: string, field: "nhap" | "xuat" | "chuyen", val: number) => {
      if (!raw) return;
      const k = theoThang ? raw.slice(0, 7) : raw.slice(0, 10);
      let cur = tsMap.get(k);
      if (!cur) {
        cur = { nhap: 0, xuat: 0, chuyen: 0 };
        tsMap.set(k, cur);
      }
      cur[field] += val;
    };
    for (const r of bizRows) bump(r.ngay_ghi_so ?? "", r.loai === "NHAP" ? "nhap" : "xuat", r.thanh_tien ?? 0);
    // Chuyển kho nội bộ — cột thứ 3 trên biểu đồ (theo tiền vốn điều chuyển).
    for (const r of dashChuyen) bump(r.ngay_ghi_so ?? "", "chuyen", r.tien_von ?? 0);
    const chuoi = [...tsMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, v]) => ({
        key: k,
        label: theoThang ? `${k.slice(5)}/${k.slice(0, 4)}` : `${k.slice(8)}/${k.slice(5, 7)}`,
        nhap: v.nhap,
        xuat: v.xuat,
        chuyen: v.chuyen,
      }));
    const chuoiMax = Math.max(1, ...chuoi.map((c) => Math.max(c.nhap, c.xuat, c.chuyen)));

    return {
      tongNhap,
      tongXuat,
      chenhLech: tongNhap - tongXuat,
      phieuNhap: soPhieu(nhap),
      phieuXuat: soPhieu(xuat),
      soMatHang: new Set(bizRows.map((r) => r.ma_hang ?? r.ten_hang ?? "?")).size,
      soDong: bizRows.length,
      chuyenGiaTri: dashChuyen.reduce((s, r) => s + (r.tien_von ?? 0), 0),
      chuyenSoPhieu: new Set(dashChuyen.map((r) => r.so_ct)).size,
      chuyenSoDong: dashChuyen.length,
      chuyenTheoTuyen,
      topChuyen,
      theoKho,
      topNhap: topBy(nhap),
      topXuat: topBy(xuat),
      theoThang,
      chuoi,
      chuoiMax,
    };
  }, [dashRows, dashChuyen]);

  // Điều kiện của thanh lọc (Chi tiết phiếu + Tổng quan). Kho lấy từ danh mục kho đang dùng.
  const khoGiaTri = useMemo(() => khoList.map((k) => ({ value: String(k.id), nhan: k.ten })), [khoList]);
  const dieuKienSo = useMemo(
    () => dieuKienSoKho(khoGiaTri, { chuyen: soChieu === "CHUYEN", xemGia: canViewCost }),
    [khoGiaTri, soChieu, canViewCost],
  );
  const dieuKienTongQuan = useMemo(() => dieuKienSo.filter((d) => d.khoa === "kho"), [dieuKienSo]);
  // Tổng hợp: Phát sinh + Tồn cuối kỳ đứng đầu, rồi các thuộc tính hàng.
  const dieuKienNxt = useMemo(() => dieuKienThuocTinh<LocThuocTinhKho>(luaChonNxt, "nxt"), [luaChonNxt]);
  // Chi tiết phiếu: Loại phiếu + Lý do, loại hàng + mặt hàng, rồi khách hàng / nhà cung cấp. Khoảng số
  // lượng / tiền đã bỏ (11/10/2026) — chẳng ai cắt sổ nhập xuất theo khoảng tiền.
  const dieuKienCt = useMemo(() => dieuKienThuocTinh<LocThuocTinhKho>(luaChonCt, "chitiet"), [luaChonCt]);
  const locCt = JSON.parse(khoaLocCt) as LocThuocTinhKho;
  // Giữ phần của Tổng hợp (phát sinh, tồn) khi đổi điều kiện ở Chi tiết phiếu, và ngược lại.
  const datLocCt = (l: LocThuocTinhKho) => setLocTT((cu) => ({ ...locTheoBang(cu, "nxt"), ...locTheoBang(l, "chitiet") }));
  const coLocNxt = searchTre !== "" || soDaAp(dieuKienNxt, locTT) > 0;
  const coLocCt = searchTre !== "" || soDaAp(dieuKienCt, locCt) > 0;
  const xoaLocNxt = () => { setSearch(""); setLocTT({}); };
  const xoaLocCt = () => { setSearch(""); setLocTT({}); };

  const luoiNxt = useCauHinhLuoi("kho-bc-nxt");
  const luoiPhieu = useCauHinhLuoi("kho-bc-phieu-gop", AN_SAN_PHIEU);
  const luoiChuyen = useCauHinhLuoi("kho-bc-chuyen");
  const luoiKy = useCauHinhLuoi("kho-bc-ky");
  const luoiLs = useCauHinhLuoi("kho-bc-lichsu");
  const cotNxtDs = useMemo(() => theoQuyenTien(COT_NXT, canViewCost), [canViewCost]);
  const cotPhieuDs = useMemo(() => theoQuyenTien(COT_PHIEU, canViewCost), [canViewCost]);
  const cotChuyenDs = useMemo(() => theoQuyenTien(COT_CHUYEN, canViewCost), [canViewCost]);
  const cotKyDs = useMemo(() => theoQuyenTien(COT_KY, canViewCost), [canViewCost]);

  // Tab Kỳ kế toán: ô tìm + kỳ + nút Lọc riêng cho từng cách xem (lọc tại chỗ).
  const [kyTim, setKyTim] = useState("");
  const [kyKyDS, setKyKyDS] = useState<KyDS>(KY_KY_MAC_DINH);
  const [locKy, setLocKy] = useState<LocKy>(LOC_KY_TRONG);
  const [lsTim, setLsTim] = useState("");
  const [lsKyDS, setLsKyDS] = useState<KyDS>(KY_LS_MAC_DINH);
  const [locLs, setLocLs] = useState<LocLs>(LOC_LS_TRONG);
  // Sổ kho tự về trang 1 khi đổi lọc (xem `khoaLocSo`); ở đây lo các bảng còn lọc tại chỗ.
  useEffect(() => {
    setPage(1);
  }, [tab, kyView, kyTim, kyKyDS, locKy, lsTim, lsKyDS, locLs]);

  // --- Lịch sử thao tác: GỘP khóa/mở kỳ + xuất Excel thành MỘT dòng, mới nhất trước ---
  const histRows = useMemo<HistRow[]>(() => {
    const fromLocks: HistRow[] = locks.map((l) => ({
      key: `lock-${l.id}`,
      thoi_diem: l.khoa_luc,
      hanh_dong: l.hanh_dong,
      pham_vi: l.kho_id == null ? "Toàn kho" : l.kho_ten ?? `Kho #${l.kho_id}`,
      khoang_ngay: `${fmtDate(l.tu_ngay)} – ${fmtDate(l.den_ngay)}`,
      ten_ky: l.ten,
      nguoi_ten: l.nguoi_khoa_ten,
      tu: l.tu_ngay,
      den: l.den_ngay,
    }));
    const fromExports: HistRow[] = exports.map((e, i) => ({
      key: `${e.hanh_dong}-${i}-${e.thoi_diem}`,
      thoi_diem: e.thoi_diem,
      hanh_dong: e.hanh_dong === "tinh_gia" ? "tinh_gia" : "export",
      pham_vi: e.pham_vi,
      khoang_ngay: e.khoang_ngay,
      ten_ky: e.ten_ky,
      nguoi_ten: e.nguoi_ten,
    }));
    return [...fromLocks, ...fromExports].sort((a, b) =>
      (b.thoi_diem ?? "").localeCompare(a.thoi_diem ?? ""),
    );
  }, [locks, exports]);

  const filteredHist = useMemo(() => {
    const q = lsTim.trim().toLowerCase();
    const k = khoangKy(lsKyDS);
    return histRows.filter((r) => {
      if (locLs.hanh_dong.length && !locLs.hanh_dong.includes(r.hanh_dong)) return false;
      if (locLs.pham_vi.length && !locLs.pham_vi.includes(r.pham_vi)) return false;
      if (locLs.nguoi.length && !locLs.nguoi.includes(r.nguoi_ten ?? "")) return false;
      // Kỳ theo "Khoảng ngày của kỳ" chỉ khớp thao tác có kỳ (khóa/mở); xuất Excel không mang ngày kỳ.
      if (k && (lsKyDS.moc === "khoang" ? !(r.tu && r.den && giaoKhoang(r.tu, r.den, k)) : !trongKhoang(r.thoi_diem, k))) return false;
      if (!q) return true;
      return (
        r.pham_vi.toLowerCase().includes(q) ||
        (r.nguoi_ten ?? "").toLowerCase().includes(q) ||
        (r.ten_ky ?? "").toLowerCase().includes(q) ||
        (r.khoang_ngay ?? "").toLowerCase().includes(q)
      );
    });
  }, [histRows, lsTim, lsKyDS, locLs]);
  const dieuKienLs = useMemo<DieuKien<LocLs>[]>(() => [{
    khoa: "hanh_dong", nhan: "Hành động", icon: Activity, kieu: "nhieu",
    giaTri: demGiaTri(histRows, (r) => r.hanh_dong, (v) => NHAN_HD[v as HistRow["hanh_dong"]], THU_TU_HD),
    doc: (l) => l.hanh_dong,
    ghi: (l, v) => ({ ...l, hanh_dong: v }),
  }, {
    khoa: "pham_vi", nhan: "Phạm vi", icon: Warehouse, kieu: "nhieu", tim: true,
    giaTri: demGiaTri(histRows, (r) => r.pham_vi),
    doc: (l) => l.pham_vi,
    ghi: (l, v) => ({ ...l, pham_vi: v }),
  }, {
    khoa: "nguoi", nhan: "Người thực hiện", icon: User, kieu: "nhieu", tim: true,
    giaTri: demGiaTri(histRows, (r) => r.nguoi_ten),
    doc: (l) => l.nguoi,
    ghi: (l, v) => ({ ...l, nguoi: v }),
  }], [histRows]);
  const pagedHist = useMemo(
    () => filteredHist.slice((page - 1) * pageSize, page * pageSize),
    [filteredHist, page, pageSize],
  );

  // --- Kỳ kế toán: kỳ đang khóa GHÉP lần tính giá của nó, rồi lọc + phân trang ---
  // Lần tính giá thuộc kỳ khóa khi cùng ngày đầu và ngày cuối nằm trong kỳ (tính giữa kỳ thì ngày
  // cuối sớm hơn). Kỳ khóa riêng một kho không trùng ngày với kỳ toàn kho nên không ghép nhầm.
  const kyRows = useMemo<KyKeToanRow[]>(() => {
    const daGhep = new Set<KyDaTinh>();
    const out: KyKeToanRow[] = kyList.map((k, i) => {
      const tu = k.tu_ngay.slice(0, 10);
      const den = k.den_ngay.slice(0, 10);
      const tinh = kyDaTinhList
        .filter((t) => t.tu_ngay.slice(0, 10) === tu && t.den_ngay.slice(0, 10) <= den)
        .sort((a, b) => b.den_ngay.localeCompare(a.den_ngay))[0] ?? null;
      if (tinh) daGhep.add(tinh);
      return {
        key: `khoa-${k.kho_id ?? "all"}-${tu}`,
        ten: k.ten,
        tu,
        den,
        pham_vi: k.kho_id == null ? "Toàn kho" : k.kho_ten ?? `Kho #${k.kho_id}`,
        mien_tru: k.kho_id == null ? k.mien_tru ?? [] : [],
        khoa_luc: k.khoa_luc,
        tinh,
        kyIdx: i,
      };
    });
    for (const t of kyDaTinhList) {
      if (daGhep.has(t)) continue;
      out.push({
        key: `tinh-${t.tu_ngay}-${t.den_ngay}`,
        ten: t.ten,
        tu: t.tu_ngay.slice(0, 10),
        den: t.den_ngay.slice(0, 10),
        pham_vi: t.so_kho > 1 ? `${t.so_kho} kho` : "1 kho",
        mien_tru: [],
        khoa_luc: null,
        tinh: t,
        kyIdx: -1,
      });
    }
    return out.sort((a, b) => b.den.localeCompare(a.den) || b.tu.localeCompare(a.tu));
  }, [kyList, kyDaTinhList]);
  const filteredKy = useMemo(() => {
    const q = kyTim.trim().toLowerCase();
    const k = khoangKy(kyKyDS);
    return kyRows.filter((r) => {
      if (locKy.trang_thai.length && !locKy.trang_thai.includes(trangThaiKy(r))) return false;
      if (locKy.pham_vi.length && !locKy.pham_vi.includes(r.pham_vi)) return false;
      if (k && (kyKyDS.moc === "khoa_luc" ? !trongKhoang(r.khoa_luc, k) : !giaoKhoang(r.tu, r.den, k))) return false;
      if (!q) return true;
      return (
        (r.ten ?? "").toLowerCase().includes(q) ||
        r.pham_vi.toLowerCase().includes(q) ||
        `${fmtDate(r.tu)} – ${fmtDate(r.den)}`.toLowerCase().includes(q)
      );
    });
  }, [kyRows, kyTim, kyKyDS, locKy]);
  const dieuKienKy = useMemo<DieuKien<LocKy>[]>(() => [{
    khoa: "trang_thai", nhan: "Trạng thái", icon: CircleDot, kieu: "nhieu",
    giaTri: demGiaTri(kyRows, trangThaiKy, (v) => NHAN_TT_KY[v as TrangThaiKy], THU_TU_TT_KY),
    doc: (l) => l.trang_thai,
    ghi: (l, v) => ({ ...l, trang_thai: v }),
  }, {
    khoa: "pham_vi", nhan: "Phạm vi", icon: Warehouse, kieu: "nhieu", tim: true,
    giaTri: demGiaTri(kyRows, (r) => r.pham_vi),
    doc: (l) => l.pham_vi,
    ghi: (l, v) => ({ ...l, pham_vi: v }),
  }], [kyRows]);
  const pagedKy = useMemo(
    () => filteredKy.slice((page - 1) * pageSize, page * pageSize),
    [filteredKy, page, pageSize],
  );
  // Cỡ trang dùng chung cho cả 4 bảng; đổi cỡ thì về trang 1 ngay trong cùng lượt (không đợi
  // effect reset) để không có một khung hình cắt sai trang.
  const doiCoTrang = (n: number) => {
    setPageSize(n);
    setPage(1);
  };

  async function doExport() {
    setExporting(true);
    setError(null);
    try {
      // Tên file DỄ HIỂU thay UUID của blob. Bắt buộc gán a.download tên thật — để rỗng thì trình
      // duyệt lấy id blob làm tên (khó nhìn). CHUYEN có endpoint export riêng (mẫu MISA "Chuyển kho").
      const { tu_ngay: tuNgay, den_ngay: denNgay } = thamSoSo;
      const khoang = tuNgay && denNgay ? ` ${tuNgay} đến ${denNgay}` : "";
      // File Excel = ĐÚNG bảng đang xem: cùng kỳ, kho, ô tìm và khoảng số với Sổ (không cắt trang).
      // Mẫu MISA tách sổ nhập / sổ xuất ⇒ bảng gộp phải lọc đúng MỘT loại phiếu mới xuất được.
      const loaiPhieu = locTT.loai_phieu?.length === 1 ? (locTT.loai_phieu[0] as "NHAP" | "XUAT") : null;
      if (soChieu !== "CHUYEN" && !loaiPhieu) {
        setError("Lọc đúng một loại phiếu (nhập hoặc xuất) rồi mới xuất Excel theo mẫu MISA.");
        return;
      }
      const url =
        soChieu === "CHUYEN" || !loaiPhieu
          ? await api.kho.baoCao.chuyenKhoExportXlsxBlobUrl(token, thamSoSo)
          : await api.kho.baoCao.exportXlsxBlobUrl(token, loaiPhieu, thamSoSo);
      const a = document.createElement("a");
      a.href = url;
      const chieu = soChieu === "CHUYEN" ? "chuyển" : loaiPhieu === "NHAP" ? "nhập" : "xuất";
      a.download = `Báo cáo ${chieu} kho${khoang}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không xuất được Excel.");
    } finally {
      setExporting(false);
    }
  }

  // Gắn bộ lọc chung của tab N-X-T vào một kỳ đã khóa (khoảng ngày + kho của kỳ). Ghi luôn mốc vào
  // `kyDaGan` để effect đồng bộ kỳ không nạp đè lần nữa.
  function chonKy(i: number) {
    const k = kyList[i];
    if (!k) return;
    const tu = k.tu_ngay.slice(0, 10);
    const den = k.den_ngay.slice(0, 10);
    kyDaGan.current = `${tu}|${den}|${k.kho_id ?? ""}`;
    setNxtKyIdx(i);
    setNxtTu(tu);
    setNxtDen(den);
    setKhoId(k.kho_id ?? null);
  }
  // "Xem số liệu" ở dòng kỳ → sang Nhập-Xuất-Tồn (tổng hợp) của đúng kỳ đó.
  function xemKy(r: KyKeToanRow) {
    if (r.kyIdx < 0) return;
    chonKy(r.kyIdx);
    setSearch("");
    setNxtView("bang");
    setTab("nxt");
  }
  // "Tính giá" ở dòng kỳ → mở luôn hộp tính giá cho kỳ đó, ở nguyên tab Kỳ kế toán.
  function tinhGiaDongKy(r: KyKeToanRow) {
    if (r.kyIdx < 0) return;
    chonKy(r.kyIdx);
    setTinhErr(null);
    setTinhOpen(true);
  }

  // Điền sẵn dialog theo hành động: MỞ → lấy kỳ đang khóa MỚI NHẤT (kyList[0]) để khỏi gõ ngày;
  // KHÓA → về mặc định trống (Đến = hôm nay), phạm vi theo kho đang lọc.
  function fillKhoa(action: "khoa" | "mo") {
    setKhoaHanhDong(action);
    setKhoaError(null);
    setKhoaTen("");
    if (action === "mo" && kyList.length > 0) {
      const k = kyList[0];
      setKhoaScope(k.kho_id ?? "all");
      setKhoaTu(k.tu_ngay.slice(0, 10));
      setKhoaDen(k.den_ngay.slice(0, 10));
    } else if (action === "khoa") {
      // Kiểu MISA: chỉ cần chọn MỐC "Đến ngày"; "Từ ngày" TỰ MAP = ngày liền sau kỳ khóa gần nhất
      // (vẫn cho sửa tay nếu muốn khóa khoảng khác).
      const sc = khoId != null ? khoId : "all";
      setKhoaScope(sc);
      setKhoaTu(nextKhoaTu(kyList, sc) ?? "");
      setKhoaDen(todayISO());
    }
  }
  function openKhoa() {
    loadLocks();
    // Có kỳ đang khóa → mở dialog ở luồng MỞ + điền sẵn kỳ MỚI NHẤT; không có kỳ nào → luồng KHÓA.
    fillKhoa(kyList.length > 0 ? "mo" : "khoa");
    setKhoaOpen(true);
  }
  async function saveKhoa() {
    if (!khoaTu || !khoaDen) {
      setKhoaError("Chọn cả ngày từ và ngày đến.");
      return;
    }
    if (khoaDen < khoaTu) {
      setKhoaError("Ngày đến phải ≥ ngày từ.");
      return;
    }
    setKhoaBusy(true);
    setKhoaError(null);
    try {
      await api.kho.baoCao.setKhoaSo(token, {
        kho_id: khoaScope === "all" ? null : khoaScope,
        tu_ngay: khoaTu,
        den_ngay: khoaDen,
        hanh_dong: khoaHanhDong,
        ten: khoaHanhDong === "khoa" ? khoaTen.trim() || null : null,
      });
      loadLocks();
      // Mở sổ xoá số đã chốt của phần mở → nạp lại để dòng kỳ ở tab Kỳ kế toán đổi trạng thái ngay.
      api.kho.baoCao.kyDaTinh(token).then(setKyDaTinhList).catch(() => {});
      setKhoaOpen(false);
    } catch (e) {
      setKhoaError(e instanceof ApiError ? e.message : "Không thực hiện được.");
    } finally {
      setKhoaBusy(false);
    }
  }

  function oNxt(key: string, r: BaoCaoNXTRow, hienCuoiKy: boolean) {
    switch (key) {
      case "ma": return <td key={key}>{r.ma_hang ?? "—"}</td>;
      case "ten": return <td key={key} title={r.ten_hang ?? undefined}>{r.ten_hang ?? "—"}</td>;
      case "kho_giay": return <td key={key}>{r.kho_rong && r.kho_dai ? nhanKho(r.kho_rong, r.kho_dai) : "—"}</td>;
      case "dvt": return <td key={key}>{r.dvt ?? ""}</td>;
      case "dau_sl": return <td key={key} className="n">{fmtQty(r.dau_sl)}</td>;
      case "dau_gt": return <td key={key} className="n">{fmtMoney(r.dau_gt)}</td>;
      case "nhap_sl": return <td key={key} className="n">{fmtQty(r.nhap_sl)}</td>;
      case "nhap_gt": return <td key={key} className="n">{fmtMoney(r.nhap_gt)}</td>;
      case "xuat_sl": return <td key={key} className="n">{fmtQty(r.xuat_sl)}</td>;
      case "xuat_gt": return <td key={key} className="n">{fmtMoney(r.xuat_gt)}</td>;
      case "cuoi_sl": return <td key={key} className="n">{fmtQty(r.cuoi_sl)}</td>;
      case "cuoi_gt": return <td key={key} className="n">{hienCuoiKy ? fmtMoney(r.cuoi_gt) : ""}</td>;
      case "bq": return <td key={key} className="n">{r.don_gia_bq != null ? fmtMoney(Math.round(r.don_gia_bq)) : "—"}</td>;
      default: return <td key={key} />;
    }
  }
  /** Ô "Kỳ khóa sổ": tên kỳ đã khóa phủ ngày chứng từ (máy chủ tra), trống = chưa khóa. */
  const oKyKhoa = (key: string, k: string | null | undefined) => (
    <td key={key} className={k ? undefined : "lds-mu"} title={k ? `Thuộc kỳ đã khóa sổ ${k}` : undefined}>
      {k ? <><LockIcon size={12} /> {k}</> : "Chưa khóa"}
    </td>
  );
  /** Ô chữ có thể trống: trống thì gạch mờ, dài thì di chuột xem đủ. */
  const oChu = (key: string, v: string | null | undefined) => (
    <td key={key} title={v ?? undefined} className={v ? undefined : "lds-mu"}>{v ?? "—"}</td>
  );
  function oPhieu(key: string, r: BaoCaoKhoRow) {
    switch (key) {
      case "so_ct": return <td key={key}>{r.so_ct}</td>;
      case "loai":
        return (
          <td key={key}>
            <ChipTT mau={r.loai === "NHAP" ? "xanh" : "cam"}>{r.loai === "NHAP" ? "Nhập kho" : "Xuất kho"}</ChipTT>
          </td>
        );
      case "ly_do": return oChu(key, r.ly_do_ten);
      case "nhom": return oChu(key, r.nhom_hang ? NHAN_NHOM_HANG[r.nhom_hang] ?? r.nhom_hang : null);
      case "lenh": return oChu(key, r.lenh);
      case "don_hang": return oChu(key, r.don_hang);
      case "khach_hang": return oChu(key, r.khach_hang);
      case "nha_cung_cap": return oChu(key, r.nha_cung_cap);
      case "bo_phan": return oChu(key, r.bo_phan);
      case "ma_yeu_cau": return oChu(key, r.ma_yeu_cau);
      case "nguoi_giao_nhan": return oChu(key, r.nguoi_giao_nhan);
      case "nguoi_lap": return oChu(key, r.nguoi_lap);
      case "dien_giai": return oChu(key, r.dien_giai);
      case "ngay_ct": return <td key={key}>{fmtDate(r.ngay_ct)}</td>;
      case "ngay_ghi_so": return <td key={key}>{fmtDate(r.ngay_ghi_so)}</td>;
      case "ky_khoa": return oKyKhoa(key, r.ky_khoa);
      case "kho": return <td key={key} title={r.kho_ten ?? undefined}>{r.kho_ten ?? "—"}</td>;
      case "ma": return <td key={key}>{r.ma_hang ?? "—"}</td>;
      case "ten": return <td key={key} title={r.ten_hang ?? undefined}>{r.ten_hang ?? "—"}</td>;
      case "kho_giay": return <td key={key}>{r.don_vi_goc && r.kho_rong ? nhanKho(r.kho_rong, r.kho_dai) : "—"}</td>;
      case "dvt": return <td key={key}>{r.dvt ?? ""}</td>;
      case "sl": return <td key={key} className="n">{fmtQty(r.so_luong)}</td>;
      case "dg": return <td key={key} className="n">{fmtMoney(r.don_gia)}</td>;
      case "tt": return <td key={key} className="n">{fmtMoney(r.thanh_tien)}</td>;
      case "hsd": return <td key={key}>{r.han_su_dung ? fmtDate(r.han_su_dung) : "—"}</td>;
      default: return <td key={key} />;
    }
  }
  function oChuyen(key: string, r: BaoCaoChuyenKhoRow) {
    switch (key) {
      case "so_ct": return <td key={key}>{r.so_ct}</td>;
      case "ngay_ct": return <td key={key}>{fmtDate(r.ngay_ct)}</td>;
      case "ngay_ghi_so": return <td key={key}>{fmtDate(r.ngay_ghi_so)}</td>;
      case "ky_khoa": return oKyKhoa(key, r.ky_khoa);
      case "tuyen": {
        const t = `${r.kho_xuat_ten ?? "—"} → ${r.kho_nhap_ten ?? "—"}`;
        return <td key={key} title={t}>{t}</td>;
      }
      case "ma": return <td key={key}>{r.ma_hang ?? "—"}</td>;
      case "ten": return <td key={key} title={r.ten_hang ?? undefined}>{r.ten_hang ?? "—"}</td>;
      case "dvt": return <td key={key}>{r.dvt ?? ""}</td>;
      case "sl": return <td key={key} className="n">{fmtQty(r.so_luong)}</td>;
      case "dg": return <td key={key} className="n">{fmtMoney(r.don_gia_von)}</td>;
      case "tt": return <td key={key} className="n">{fmtMoney(r.tien_von)}</td>;
      case "dien_giai": return <td key={key} title={r.dien_giai ?? undefined} className={r.dien_giai ? undefined : "lds-mu"}>{r.dien_giai ?? "—"}</td>;
      default: return <td key={key} />;
    }
  }
  function oKy(key: string, r: KyKeToanRow) {
    switch (key) {
      case "ten": return <td key={key}>{r.ten?.trim() || autoTenKy(r.tu, r.den)}</td>;
      case "khoang": return <td key={key}>{fmtDate(r.tu)} – {fmtDate(r.den)}</td>;
      case "pham_vi": {
        const tru = r.mien_tru.length > 0 ? `trừ ${r.mien_tru.join(", ")}` : "";
        return (
          <td key={key} title={tru ? `${r.pham_vi} ${tru}` : r.pham_vi}>
            {r.pham_vi}{tru && <span className="lds-mu"> {tru}</span>}
          </td>
        );
      }
      case "trang_thai": {
        const tt = trangThaiKy(r);
        return (
          <td key={key}>
            <ChipTT mau={MAU_TT_KY[tt]} title={tt === "chua_khoa" ? "Có số đã tính nhưng kỳ không còn khóa" : undefined}>
              {tt === "tinh_toi" && r.tinh ? `Tính tới ${fmtDate(r.tinh.den_ngay)}` : NHAN_TT_KY[tt]}
            </ChipTT>
          </td>
        );
      }
      case "khoa_luc": return <td key={key}>{fmtDateTime(r.khoa_luc)}</td>;
      case "tinh_luc": return <td key={key}>{r.tinh ? fmtDateTime(r.tinh.tinh_luc) : "—"}</td>;
      case "gt": return <td key={key} className="n">{r.tinh ? fmtMoney(r.tinh.tong_gt_cuoi) : ""}</td>;
      case "nut":
        return (
          <td key={key} className="lds-nut">
            {r.kyIdx >= 0 && (
              <>
                {canCloseBook && <><button type="button" className="lds-btn lds-btn--xs" onClick={() => tinhGiaDongKy(r)} disabled={tinhBusy}>
                  {r.tinh ? "Tính lại giá" : "Tính giá"}
                </button>{" "}</>}
                <button type="button" className="lds-btn lds-btn--xs" onClick={() => xemKy(r)}>Xem số liệu</button>
              </>
            )}
          </td>
        );
      default: return <td key={key} />;
    }
  }
  function oLs(key: string, r: HistRow) {
    switch (key) {
      case "thoi_diem": return <td key={key}>{fmtDateTime(r.thoi_diem)}</td>;
      case "hanh_dong": return <td key={key}><ChipTT mau={MAU_HD[r.hanh_dong]}>{NHAN_HD[r.hanh_dong]}</ChipTT></td>;
      case "pham_vi": return <td key={key} title={r.pham_vi}>{r.pham_vi}</td>;
      case "khoang": return <td key={key} className={r.khoang_ngay ? undefined : "lds-mu"}>{r.khoang_ngay ?? "—"}</td>;
      case "ten_ky": return <td key={key} className={r.ten_ky ? undefined : "lds-mu"}>{r.ten_ky ?? "—"}</td>;
      case "nguoi": return <td key={key}>{r.nguoi_ten ?? "—"}</td>;
      default: return <td key={key} />;
    }
  }
  // Nút Kỳ: tên kỳ đã khóa đang chọn (kèm khoảng đang xem), chưa khóa kỳ nào thì chính khoảng ngày.
  const cacKyNut = kyList.map((k) => ({
    nhan: k.ten?.trim() || autoTenKy(k.tu_ngay, k.den_ngay),
    khoang: `${fmtDate(k.tu_ngay)} – ${fmtDate(k.den_ngay)}`,
    kho: k.kho_ten ?? null,
    tu: k.tu_ngay.slice(0, 10),
    den: k.den_ngay.slice(0, 10),
  }));
  const kyDangChon = nxtKyIdx >= 0 ? cacKyNut[nxtKyIdx] : undefined;
  const nhanNutKy = kyDangChon?.nhan
    ?? (nxtTu && nxtDen ? autoTenKy(nxtTu, nxtDen) : "Chọn khoảng ngày");
  const phuNutKy = kyDangChon
    ? (nxtDen && nxtDen !== kyDangChon.den ? `tới ${fmtDate(nxtDen)}` : undefined)
    : undefined;

  /** Dòng trống của lưới: khác nhau giữa "chưa có gì" và "lọc không ra", có nút Xoá bộ lọc. */
  const dongTrong = (colSpan: number, chu: string, xoa?: () => void) => (
    <tr>
      <td colSpan={colSpan} className="lds-trong">
        {chu}{" "}
        {xoa && <button type="button" className="lds-lk" onClick={xoa}>Xoá bộ lọc</button>}
      </td>
    </tr>
  );

  return (
    <main className="rc kho-list kho-baocao" ref={pageRef}>
      <header className="rc__head">
        <div className="rc__headrow">
          <h1 className="rc__title">Báo cáo kho</h1>
          <span className="rc__count">
            {tab === "tong-quan"
              ? `${dashRows.length} dòng sổ`
              : tab === "nxt"
                ? nxtView === "chitiet" ? `${soDong} dòng` : `${nxtRows.length} mặt hàng`
                : tab === "gia-goc"
                  ? `${giaGocTong ?? 0} lô gốc`
                  : kyView === "lichsu"
                    ? `${histRows.length} thao tác`
                    : `${kyRows.length} kỳ`}
          </span>
          {/* Khóa / mở kỳ là việc của KỲ → chỉ nằm ở tab Kỳ kế toán. */}
          {tab === "ky" && canCloseBook && (
            <button
              type="button"
              className="btn btn--secondary kho-export-btn"
              onClick={openKhoa}
              title="Khóa / mở sổ kỳ kế toán theo khoảng ngày — toàn kho hoặc từng kho"
            >
              <LockIcon size={15} /> Khóa / mở kỳ
            </button>
          )}
          {/* Tab N-X-T: gom hành động lên ĐẦU TRANG cho thanh lọc bên dưới chỉ còn bộ lọc.
              Thứ tự: Cách xem · Tính giá kỳ · Xuất Excel. */}
          {tab === "nxt" && (
            <>
              <div className="kho-chieu-segmented" role="group" aria-label="Cách xem">
                {(
                  [
                    ["bang", "Tổng hợp"],
                    ["chitiet", "Chi tiết phiếu"],
                    ["bieudo", "Biểu đồ"],
                  ] as const
                ).map(([v, nhan]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={nxtView === v}
                    className={`kho-chieu-btn${nxtView === v ? " is-active" : ""}`}
                    onClick={() => setNxtView(v)}
                  >
                    {nhan}
                  </button>
                ))}
              </div>
              {canCloseBook && <button
                type="button"
                className="btn btn--accent kho-export-btn"
                disabled={!nxtTu || !nxtDen || tinhBusy}
                onClick={openTinhPopup}
                title="Tính giá bình quân cuối kỳ & chốt tồn cuối kỳ để kỳ sau nối tiếp (như MISA)"
              >
                {nxtDaTinh ? "Tính lại giá kỳ" : "Tính giá kỳ"}
              </button>}
              {nxtView !== "chitiet" && (
                <button
                  type="button"
                  className="btn btn--secondary kho-export-btn"
                  disabled={!nxtTu || !nxtDen || nxtExporting || nxtRows.length === 0}
                  onClick={exportNxt}
                  title="Xuất Excel bảng Nhập-Xuất-Tồn đang xem (mẫu MISA)"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  {nxtExporting ? "Đang xuất…" : "Xuất Excel"}
                </button>
              )}
            </>
          )}
          {!AN_NUT_XUAT_EXCEL_SO && tab === "nxt" && nxtView === "chitiet" && (
            <button
              type="button"
              className="btn btn--secondary kho-export-btn"
              disabled={exporting || soDong === 0}
              onClick={doExport}
              title="Xuất Excel đúng mẫu MISA (theo chiều đang chọn)"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              {exporting ? "Đang xuất…" : "Xuất Excel"}
            </button>
          )}
        </div>
      </header>

      <div className="kho-shell">
        <div className="kho-shell__fns">
          {(
            [
              ["tong-quan", "Tổng quan"],
              ["nxt", "Nhập-Xuất-Tồn"],
              ["gia-goc", "Giá gốc thành phẩm"],
              ["ky", "Kỳ kế toán"],
            ] as const
          ).filter(([id]) => !(AN_TAB_TONG_QUAN && id === "tong-quan") && (id !== "gia-goc" || canViewCost)).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`kho-shell__fn${tab === id ? " is-active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rc__empty-state" style={{ color: "var(--rust, #b4531f)" }}>{error}</div>
      )}

      {tab === "tong-quan" && (
        <>
          <div className="rc__toolbar tl-thanh">
            <ThanhLoc ky={ky} moc={MOC_SO_KHO} onKy={datKy} dieuKien={dieuKienTongQuan} loc={locMan.loc} onLoc={datLoc} />
          </div>

          {loading ? (
            <EmptyState trangThai="dang-tai" inline />
          ) : dashRows.length === 0 ? (
            <div className="rc__empty-state">Chưa có phiếu ghi sổ nào trong phạm vi lọc.</div>
          ) : (
            <div className="kho-dash">
              {/* Dải KPI ngang liền — Nhập / Xuất / Chênh lệch / Mặt hàng / Chuyển kho, theo bộ lọc kho
                  + ngày. Số rút gọn cho gọn dải; rê chuột (title) xem số đầy đủ. */}
              <div className="kho-dash__strip">
                <div className="kho-dash__seg">
                  <span className="kho-dash__label">Tổng nhập</span>
                  <span className="kho-dash__val" title={`${fmtMoney(dash.tongNhap)} đ`}>
                    {fmtMoneyShort(dash.tongNhap)}
                  </span>
                  <span className="kho-dash__sub">{dash.phieuNhap} phiếu nhập</span>
                </div>

                <div className="kho-dash__seg">
                  <span className="kho-dash__label">Tổng xuất</span>
                  <span className="kho-dash__val" title={`${fmtMoney(dash.tongXuat)} đ`}>
                    {fmtMoneyShort(dash.tongXuat)}
                  </span>
                  <span className="kho-dash__sub">{dash.phieuXuat} phiếu xuất</span>
                </div>

                <div className="kho-dash__seg">
                  <span className="kho-dash__label">Chênh lệch Nhập − Xuất</span>
                  <span className="kho-dash__val" title={`${fmtMoney(dash.chenhLech)} đ`}>
                    {fmtMoneyShort(dash.chenhLech)}
                  </span>
                  <span className="kho-dash__sub">= Tổng nhập − Tổng xuất</span>
                </div>

                <div className="kho-dash__seg">
                  <span className="kho-dash__label">Mặt hàng luân chuyển</span>
                  <span className="kho-dash__val">{dash.soMatHang}</span>
                  <span className="kho-dash__sub">{dash.soDong} dòng sổ</span>
                </div>

                {dash.chuyenSoDong > 0 && (
                  <div className="kho-dash__seg">
                    <span className="kho-dash__label">Chuyển kho nội bộ</span>
                    <span className="kho-dash__val" title={`${fmtMoney(dash.chuyenGiaTri)} đ`}>
                      {fmtMoneyShort(dash.chuyenGiaTri)}
                    </span>
                    <span className="kho-dash__sub">
                      {dash.chuyenSoPhieu} phiếu gồm {dash.chuyenSoDong} dòng
                    </span>
                  </div>
                )}
              </div>

              {/* Biểu đồ theo thời gian — Recharts cột nhóm Nhập/Xuất/Chuyển; trục Y rút gọn, lưới mờ,
                  tooltip. ResponsiveContainer tự vừa khung — không cuộn tay như bản CSS cũ. */}
              {dash.chuoi.length > 0 && (
                <section className="rc-sec">
                  <h3 className="rc-sec__title">
                    Nhập / Xuất{dash.chuyenSoDong > 0 ? " / Chuyển kho" : ""} theo {dash.theoThang ? "tháng" : "ngày"}
                  </h3>
                  <div className="kho-rc-legend">
                    <span className="kho-rc-legitem"><i className="kho-rc-dot" style={{ background: SERIES.nhapDark }} />Nhập</span>
                    <span className="kho-rc-legitem"><i className="kho-rc-dot" style={{ background: SERIES.xuatDark }} />Xuất</span>
                    {dash.chuyenSoDong > 0 && (
                      <span className="kho-rc-legitem"><i className="kho-rc-dot" style={{ background: SERIES.move }} />Chuyển kho</span>
                    )}
                  </div>
                  <div className="kho-rc-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={dash.chuoi} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barCategoryGap="22%">
                        <defs>
                          <linearGradient id="bcNhap" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={SERIES.nhapDark} stopOpacity={0.9} />
                            <stop offset="95%" stopColor={SERIES.nhapDark} stopOpacity={0.32} />
                          </linearGradient>
                          <linearGradient id="bcXuat" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={SERIES.xuatDark} stopOpacity={0.9} />
                            <stop offset="95%" stopColor={SERIES.xuatDark} stopOpacity={0.32} />
                          </linearGradient>
                          <linearGradient id="bcMove" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={SERIES.move} stopOpacity={0.9} />
                            <stop offset="95%" stopColor={SERIES.move} stopOpacity={0.32} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#cbd5e1" }} tick={{ fontSize: 11, fill: "var(--ash)" }} interval="preserveStartEnd" minTickGap={14} />
                        <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v) => fmtMoneyShort(Number(v))} tick={{ fontSize: 11, fill: "var(--ash)" }} />
                        <Tooltip
                          cursor={{ fill: "rgba(15,23,42,0.04)" }}
                          content={({ active, payload, label }) =>
                            active && payload && payload.length ? (
                              <div className="custom-recharts-tooltip">
                                <div className="custom-recharts-tooltip__title">
                                  {dash.theoThang ? "Tháng" : "Ngày"} {String(label)}
                                </div>
                                {payload.map((e) => (
                                  <div key={String(e.dataKey)} className="custom-recharts-tooltip__row">
                                    <span className="kho-rc-ttname">
                                      <i className="kho-rc-dot" style={{ background: RC_DOT[String(e.dataKey)] }} />
                                      {e.name}
                                    </span>
                                    <b>{fmtMoney(Number(e.value))} đ</b>
                                  </div>
                                ))}
                              </div>
                            ) : null
                          }
                        />
                        <Bar dataKey="nhap" name="Nhập" fill="url(#bcNhap)" stroke={SERIES.nhapDark} radius={[4, 4, 0, 0]} maxBarSize={22} />
                        <Bar dataKey="xuat" name="Xuất" fill="url(#bcXuat)" stroke={SERIES.xuatDark} radius={[4, 4, 0, 0]} maxBarSize={22} />
                        {dash.chuyenSoDong > 0 && (
                          <Bar dataKey="chuyen" name="Chuyển kho" fill="url(#bcMove)" stroke={SERIES.move} radius={[4, 4, 0, 0]} maxBarSize={22} />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}

              {/* Nhập / Xuất theo kho — cột NGANG (Recharts) để so sánh trực quan giữa các kho. */}
              {dash.theoKho.length > 0 && (
                <section className="rc-sec">
                  <h3 className="rc-sec__title">Nhập / Xuất theo kho</h3>
                  <div className="kho-rc-legend">
                    <span className="kho-rc-legitem"><i className="kho-rc-dot" style={{ background: SERIES.nhapDark }} />Nhập</span>
                    <span className="kho-rc-legitem"><i className="kho-rc-dot" style={{ background: SERIES.xuatDark }} />Xuất</span>
                  </div>
                  <div className="kho-rc-chart" style={{ height: Math.max(140, dash.theoKho.length * 54 + 24) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dash.theoKho} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }} barCategoryGap="26%">
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                        <XAxis type="number" tickFormatter={(v) => fmtMoneyShort(Number(v))} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--ash)" }} />
                        <YAxis type="category" dataKey="ten" width={128} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} tick={{ fontSize: 11, fill: "var(--ink)" }} />
                        <Tooltip
                          cursor={{ fill: "rgba(15,23,42,0.04)" }}
                          content={({ active, payload, label }) =>
                            active && payload && payload.length ? (
                              <div className="custom-recharts-tooltip">
                                <div className="custom-recharts-tooltip__title">{String(label)}</div>
                                {payload.map((e) => (
                                  <div key={String(e.dataKey)} className="custom-recharts-tooltip__row">
                                    <span className="kho-rc-ttname">
                                      <i className="kho-rc-dot" style={{ background: RC_DOT[String(e.dataKey)] }} />
                                      {e.name}
                                    </span>
                                    <b>{fmtMoney(Number(e.value))} đ</b>
                                  </div>
                                ))}
                              </div>
                            ) : null
                          }
                        />
                        <Bar dataKey="nhap" name="Nhập" fill={SERIES.nhapLight} stroke={SERIES.nhapDark} radius={[0, 4, 4, 0]} maxBarSize={15} />
                        <Bar dataKey="xuat" name="Xuất" fill={SERIES.xuatLight} stroke={SERIES.xuatDark} radius={[0, 4, 4, 0]} maxBarSize={15} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}

              {/* Chuyển kho nội bộ — theo TUYẾN (từ kho → đến kho) + top mặt hàng chuyển. Chỉ hiện khi
                  có điều chuyển; điều chuyển KHÔNG tính vào Tổng nhập/xuất (mua/bán) ở trên. */}
              {dash.chuyenSoDong > 0 && (
                <div className="kho-dash__cols">
                  <section className="rc-sec">
                    <h3 className="rc-sec__title">Chuyển kho theo tuyến</h3>
                    <div className="kho-lines__wrap">
                      <table className="kho-lines">
                        <thead>
                          <tr>
                            <th>Tuyến (từ kho → đến kho)</th>
                            <th className="kho-num">Giá trị</th>
                            <th className="kho-num">Số phiếu</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dash.chuyenTheoTuyen.map((t, i) => (
                            <tr key={i}>
                              <td>{t.tuyen}</td>
                              <td className="kho-num">{fmtMoney(t.giaTri)}</td>
                              <td className="kho-num">{t.phieu}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="rc-sec">
                    <h3 className="rc-sec__title">Top mặt hàng chuyển kho</h3>
                    <div className="kho-lines__wrap">
                      <table className="kho-lines">
                        <thead>
                          <tr>
                            <th>Mặt hàng</th>
                            <th className="kho-num">SL</th>
                            <th className="kho-num">Giá trị</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dash.topChuyen.map((t, i) => (
                            <tr key={i}>
                              <td>
                                <div className="kho-lines__name">{t.ten ?? "—"}</div>
                                <div className="kho-lines__code">{t.ma ?? ""}</div>
                              </td>
                              <td className="kho-num">{fmtQty(t.sl)} {t.dvt ?? ""}</td>
                              <td className="kho-num">{fmtMoney(t.tien)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              )}

              {/* Tỉ trọng giá trị theo mặt hàng — biểu đồ TRÒN (donut): top 5 + "Khác", cho Nhập & Xuất. */}
              <div className="kho-dash__cols">
                {([
                  ["Tỉ trọng nhập", buildDonut(dash.topNhap, dash.tongNhap)],
                  ["Tỉ trọng xuất", buildDonut(dash.topXuat, dash.tongXuat)],
                ] as const).map(([ten, segs]) => (
                  <section className="rc-sec" key={ten}>
                    <h3 className="rc-sec__title">{ten}</h3>
                    {segs.length === 0 ? (
                      <p className="kho-hint">Không có dòng nào.</p>
                    ) : (
                      <div className="kho-donut">
                        <div
                          className="kho-donut__ring"
                          role="img"
                          aria-label={segs.map((s) => `${s.label} ${Math.round(s.pct)}%`).join(", ")}
                          style={{
                            background: `conic-gradient(${segs
                              .map((s) => `${s.color} ${s.from}% ${s.to}%`)
                              .join(", ")})`,
                          }}
                        />
                        <ul className="kho-donut__legend">
                          {segs.map((s, i) => (
                            <li className="kho-donut__leg" key={i} title={s.label}>
                              <span className="kho-donut__dot" style={{ background: s.color }} />
                              <span className="kho-donut__legname">{s.label}</span>
                              <span className="kho-donut__legpct">{Math.round(s.pct)}%</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                ))}
              </div>

              {/* Top mặt hàng — BẢNG THUẦN (Mặt hàng · SL · Giá trị). */}
              <div className="kho-dash__cols">
                {([
                  ["Top mặt hàng nhập", dash.topNhap],
                  ["Top mặt hàng xuất", dash.topXuat],
                ] as const).map(([tenBang, top]) => (
                  <section className="rc-sec" key={tenBang}>
                    <h3 className="rc-sec__title">{tenBang}</h3>
                    {top.length === 0 ? (
                      <p className="kho-hint">Không có dòng nào.</p>
                    ) : (
                      <div className="kho-lines__wrap">
                        <table className="kho-lines">
                          <thead>
                            <tr>
                              <th>Mặt hàng</th>
                              <th className="kho-num">SL</th>
                              <th className="kho-num">Giá trị</th>
                            </tr>
                          </thead>
                          <tbody>
                            {top.map((t, i) => (
                              <tr key={i}>
                                <td>
                                  <div className="kho-lines__name">{t.ten ?? "—"}</div>
                                  <div className="kho-lines__code">{t.ma ?? ""}</div>
                                </td>
                                <td className="kho-num">
                                  {fmtQty(t.sl)} {t.dvt ?? ""}
                                </td>
                                <td className="kho-num">{fmtMoney(t.tien)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Tab Nhập-Xuất-Tồn — Tổng hợp, Chi tiết phiếu và Biểu đồ CHUNG một kho + một kỳ + nút Lọc thuộc
          tính, đổi cách xem không phải lọc lại. Lưới chung (11/10/2026): kéo rộng, ghim, đổi chỗ cột. */}
      {tab === "nxt" && (() => {
        const hienCuoiKy = nxtDaTinh || nxtKyBao !== null;
        // Ô Tìm đã lọc ở máy chủ (`q`).
        const filtered = nxtRows;
        // Gom NHÓM theo kho (đã sort sẵn ở server theo kho → tên hàng).
        const groups: { kho: string; rows: BaoCaoNXTRow[] }[] = [];
        for (const r of filtered) {
          const ten = r.kho_ten ?? "— Chưa gắn kho —";
          const g = groups[groups.length - 1];
          if (g && g.kho === ten) g.rows.push(r);
          else groups.push({ kho: ten, rows: [r] });
        }
        // Dữ liệu 2 biểu đồ: (1) Top mặt hàng theo GT tồn cuối kỳ; (2) Nhập vs Xuất (GT) theo kho.
        const topCuoi = [...filtered]
          .filter((r) => (r.cuoi_gt ?? 0) > 0)
          .sort((a, b) => (b.cuoi_gt ?? 0) - (a.cuoi_gt ?? 0))
          .slice(0, 12)
          .map((r) => ({ ten: r.ten_hang ?? r.ma_hang ?? "—", gt: r.cuoi_gt ?? 0 }));
        const nxTheoKhoMap = new Map<string, { kho: string; nhap: number; xuat: number }>();
        for (const r of filtered) {
          const k = r.kho_ten ?? "— Chưa gắn kho —";
          const e = nxTheoKhoMap.get(k) ?? { kho: k, nhap: 0, xuat: 0 };
          e.nhap += r.nhap_gt ?? 0;
          e.xuat += r.xuat_gt ?? 0;
          nxTheoKhoMap.set(k, e);
        }
        const nxTheoKho = [...nxTheoKhoMap.values()];
        const chuyen = soChieu === "CHUYEN";
        const luoiCt = chuyen ? luoiChuyen : luoiPhieu;
        const cotCtDs = chuyen ? cotChuyenDs : cotPhieuDs;
        return (
        <div className="lds">
          {nxtView === "chitiet" ? null : !nxtTu || !nxtDen ? (
            <div className="banner banner--info" style={{ marginBottom: 8 }}>
              <span>Chọn <b>kỳ</b> (hoặc Từ ngày / đến ngày) để xem báo cáo Nhập-Xuất-Tồn.</span>
            </div>
          ) : nxtDaTinh ? (
            <div className="banner banner--info" style={{ marginBottom: 8 }}>
              <span><b>Đã tính giá kỳ</b> (bình quân gia quyền cuối kỳ){nxtDaKhoa ? ". Kỳ đã khóa sổ" : ""}. Có phát sinh mới thì bấm “Tính lại giá kỳ”.</span>
            </div>
          ) : nxtKyBao ? (
            <div className="banner banner--info" style={{ marginBottom: 8 }}>
              <span>
                Kỳ {nxtKyBao.ten ? <b>“{nxtKyBao.ten}”</b> : "này"} <b>đã tính giá</b> tới{" "}
                <b>{fmtDate(nxtKyBao.den)}</b>. Bạn đang xem tới <b>{fmtDate(nxtDen)}</b> (giữa kỳ) nên
                mọi giá trị là số <b>tạm tính</b> tới ngày đó — khác số đã chốt cuối kỳ.
                <button
                  type="button"
                  className="rc__link-btn"
                  style={{ marginLeft: 8 }}
                  onClick={() => setNxtDen(nxtKyBao.den.slice(0, 10))}
                >
                  Xem tới {fmtDate(nxtKyBao.den)} →
                </button>
              </span>
            </div>
          ) : (
            // Luật 29/08/2026: khóa sổ trước rồi mới tính giá — kỳ chưa khóa thì nói thẳng bước còn
            // thiếu và dẫn sang tab Kỳ kế toán, đừng để người dùng bấm "Tính giá kỳ" rồi mới biết.
            <div className="banner banner--warn" style={{ marginBottom: 8 }}>
              {nxtDaKhoa ? (
                <span>
                  Kỳ đã khóa sổ nhưng <b>chưa tính giá</b>. Đơn giá BQ và Giá trị xuất là số tạm tính;
                  Giá trị cuối kỳ để trống tới khi bấm “Tính giá kỳ” (số này làm đầu kỳ sau).
                </span>
              ) : (
                <span>
                  Kỳ này <b>chưa khóa sổ</b> nên chưa tính giá được. Đơn giá BQ và Giá trị xuất là số
                  tạm tính; Giá trị cuối kỳ để trống.
                  {/* Người chỉ xem không khoá sổ được — đừng chỉ họ tới nút họ không có (#77). */}
                  {canCloseBook && (
                    <button type="button" className="rc__link-btn" style={{ marginLeft: 8 }} onClick={() => setTab("ky")}>
                      Khóa sổ ở Kỳ kế toán →
                    </button>
                  )}
                </span>
              )}
            </div>
          )}

          {/* Phương án B (11/10/2026): một hàng [Tìm] [Kho] [Kỳ] [Lọc] … [Cột]. Kho + Kỳ hiện ngoài
              vì chúng quyết định số đầu kỳ và việc tính giá. */}
          <section className="lds-loc">
            <div className="lds-loc__thanh tl-thanh" role="search">
              <OTim value={search} onChange={setSearch}
                placeholder={nxtView === "chitiet" ? "Tìm số chứng từ, hàng, lệnh, khách" : "Tìm mã, tên hàng"}
                ariaLabel="Tìm trong báo cáo kho" />
              <NutKho ds={khoList} khoId={khoId} onDoi={setKhoId} />
              <NutKyBaoCao
                cacKy={cacKyNut}
                kyIdx={nxtKyIdx}
                tu={nxtTu}
                den={nxtDen}
                nhan={nhanNutKy}
                phu={phuNutKy}
                onChonKy={chonKy}
                onTu={setNxtTu}
                onDen={setNxtDen}
                onThangNay={() => { const [a, b] = curMonthRange(); setNxtKyIdx(-1); setNxtTu(a); setNxtDen(b); }}
              />
              {nxtView === "chitiet" && !AN_DIEU_CHUYEN && (
                <div className="kho-chieu-segmented" role="group" aria-label="Sổ">
                  {(
                    [
                      ["PHIEU", "Nhập và xuất"],
                      ["CHUYEN", "Chuyển kho"],
                    ] as const
                  ).map(([val, lbl]) => (
                    <button
                      key={val}
                      type="button"
                      aria-pressed={soChieu === val}
                      className={`kho-chieu-btn${soChieu === val ? " is-active" : ""}`}
                      onClick={() => setSoChieu(val)}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              )}
              {nxtView === "chitiet"
                ? <ThanhLoc key="ct" dieuKien={dieuKienCt} loc={locCt} onLoc={datLocCt} />
                : <ThanhLoc key="nxt" dieuKien={dieuKienNxt} loc={locTT} onLoc={setLocTT} />}
              {nxtView === "bang" && <ChonCot cot={cotNxtDs} {...luoiNxt.chonCot} />}
              {nxtView === "chitiet" && <ChonCot key={soChieu} cot={cotCtDs} {...luoiCt.chonCot} />}
            </div>
          </section>

          {nxtView === "chitiet" && (() => {
            const cot = cotHien(luoiCt, cotCtDs);
            return (
              <div className="lds-sheet">
                <CuonLuoi key={soChieu} ghim={luoiCt.soGhim(cot)}>
                  <table className="lds-g" style={{ minWidth: rongLuoi(cot) }}>
                    <DauLuoi cot={cot} luoi={luoiCt} />
                    <tbody>
                      {loading ? (
                        <EmptyRow colSpan={cot.length} trangThai="dang-tai" />
                      ) : soDong === 0 ? (
                        coLocCt
                          ? dongTrong(cot.length, "Không có dòng nào khớp điều kiện đang lọc.", xoaLocCt)
                          : dongTrong(cot.length, chuyen
                            ? "Không có dòng điều chuyển nào đã ghi sổ trong kỳ."
                            : "Không có phiếu nhập hay xuất nào đã ghi sổ trong kỳ.")
                      ) : chuyen ? (
                        chuyenRows.map((r, i) => <tr key={`${r.voucher_id}-${i}`}>{cot.map((c) => oChuyen(c.key, r))}</tr>)
                      ) : (
                        rows.map((r, i) => <tr key={`${r.voucher_id}-${i}`}>{cot.map((c) => oPhieu(c.key, r))}</tr>)
                      )}
                      {!loading && soDong > 0 && canViewCost && (
                        <tr className="lds-cong">
                          {cot.map((c, k) =>
                            c.key === "tt" ? <td key={c.key} className="n">{fmtMoney(tongTienSo)}</td>
                              : k === 0 ? <td key={c.key} className="lead">{chuyen ? "Tổng tiền vốn" : "Tổng thành tiền"} {soDong} dòng</td>
                                : <td key={c.key} />)}
                        </tr>
                      )}
                    </tbody>
                  </table>
                </CuonLuoi>
                {soDong > 0 && (
                  <PhanTrangDayDu trang={page} size={pageSize} tong={soDong} soDong={chuyen ? chuyenRows.length : rows.length}
                    onTrang={setPage} onSize={doiCoTrang} loading={loading} donVi="dòng"
                    ariaLabel={chuyen ? "Phân trang sổ chuyển kho" : "Phân trang phiếu nhập xuất kho"} />
                )}
              </div>
            );
          })()}

          {nxtView === "bang" && (() => {
            const cot = cotHien(luoiNxt, cotNxtDs);
            return (
              <div className="lds-sheet">
                <CuonLuoi ghim={luoiNxt.soGhim(cot)}>
                  <table className="lds-g" style={{ minWidth: rongLuoi(cot) }}>
                    <DauLuoi cot={cot} luoi={luoiNxt} />
                    <tbody>
                      {loading ? (
                        <EmptyRow colSpan={cot.length} trangThai="dang-tai" />
                      ) : filtered.length === 0 ? (
                        coLocNxt
                          ? dongTrong(cot.length, "Không có mặt hàng nào khớp điều kiện đang lọc.", xoaLocNxt)
                          : dongTrong(cot.length, "Không có mặt hàng nào phát sinh hoặc còn tồn trong kỳ.")
                      ) : (
                        groups.map((g) => {
                          const t: Record<string, number | null> = { dau_gt: 0, nhap_gt: 0, xuat_gt: 0, cuoi_gt: 0 };
                          for (const r of g.rows) {
                            t.dau_gt! += r.dau_gt ?? 0; t.nhap_gt! += r.nhap_gt ?? 0;
                            t.xuat_gt! += r.xuat_gt ?? 0; t.cuoi_gt! += r.cuoi_gt ?? 0;
                          }
                          if (!hienCuoiKy) t.cuoi_gt = null;
                          return (
                            <Fragment key={g.kho}>
                              <tr className="lds-nhom">
                                <td colSpan={cot.length}>
                                  <span className="lds-dinh-trai">{g.kho}<span className="lds-tag">{g.rows.length} mặt hàng</span></span>
                                </td>
                              </tr>
                              {g.rows.map((r) => (
                                <tr
                                  key={`${r.kho_id}-${r.hang_loai}-${r.hang_id}-${r.kho_rong}-${r.kho_dai}-${r.don_vi_goc}`}
                                  className="lds-dong"
                                  tabIndex={0}
                                  title="Xem lô nhập và lịch sử xuất của mặt hàng"
                                  onClick={() => openMatHang(r)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMatHang(r); }
                                  }}
                                >
                                  {cot.map((c) => oNxt(c.key, r, hienCuoiKy))}
                                </tr>
                              ))}
                              <tr className="lds-cong">
                                {cot.map((c, k) =>
                                  k === 0 ? <td key={c.key} className="lead">Cộng {g.kho}</td>
                                    : c.key in t ? <td key={c.key} className="n">{t[c.key] == null ? "" : fmtMoney(t[c.key])}</td>
                                      : <td key={c.key} />)}
                              </tr>
                            </Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </CuonLuoi>
              </div>
            );
          })()}

          {nxtView === "bieudo" && (
            <div style={{ display: "grid", gap: 16 }}>
              {/* Biểu đồ 1 — Giá trị tồn CUỐI KỲ: chỉ khi ĐÃ TÍNH (số chốt), khớp cột cuối kỳ ở bảng. */}
              <div className="card" style={{ padding: 16 }}>
                <div className="rc-sec__title" style={{ marginBottom: 8 }}>
                  Top mặt hàng theo giá trị tồn cuối kỳ
                  {hienCuoiKy && !nxtDaTinh && (
                    <span className="rc__muted" style={{ fontWeight: 400 }}> (tạm tính tới {fmtDate(nxtDen)})</span>
                  )}
                </div>
                {!hienCuoiKy ? (
                  <div className="rc__empty-state">Kỳ chưa tính giá — bấm “Tính giá kỳ” để xem Top giá trị tồn cuối kỳ.</div>
                ) : topCuoi.length === 0 ? (
                  <div className="rc__empty-state">Không có mặt hàng còn tồn cuối kỳ.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(200, topCuoi.length * 34)}>
                    <BarChart data={topCuoi} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }} barCategoryGap="28%">
                      <CartesianGrid horizontal={false} stroke="#eef2f7" />
                      <XAxis type="number" tickFormatter={(v) => fmtMoneyShort(Number(v))} tick={{ fontSize: 11, fill: "var(--ash)" }} axisLine={{ stroke: "#cbd5e1" }} tickLine={false} />
                      <YAxis type="category" dataKey="ten" width={150} tick={{ fontSize: 11, fill: "var(--ink)" }} axisLine={{ stroke: "#cbd5e1" }} tickLine={false} />
                      <Tooltip formatter={(v) => [fmtMoney(Number(v)), "Giá trị cuối kỳ"]} />
                      <Bar dataKey="gt" name="Giá trị cuối kỳ" fill="var(--moss, #2f5d3a)" radius={[0, 4, 4, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              {/* Biểu đồ 2 — Nhập vs Xuất (giá trị) theo kho: luôn hiện (số đã biết / tạm tính). */}
              <div className="card" style={{ padding: 16 }}>
                <div className="rc-sec__title" style={{ marginBottom: 8 }}>
                  Nhập vs Xuất (giá trị) theo kho{!nxtDaTinh && <span className="rc__muted" style={{ fontWeight: 400 }}> (xuất tạm tính)</span>}
                </div>
                {nxTheoKho.every((k) => k.nhap === 0 && k.xuat === 0) ? (
                  <div className="rc__empty-state">Không có phát sinh nhập / xuất trong kỳ.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={nxTheoKho} margin={{ top: 4, right: 16, left: 8, bottom: 4 }} barGap={4} barCategoryGap="24%">
                      <CartesianGrid vertical={false} stroke="#eef2f7" />
                      <XAxis dataKey="kho" tick={{ fontSize: 11, fill: "var(--ink)" }} axisLine={{ stroke: "#cbd5e1" }} tickLine={false} interval={0} />
                      <YAxis tickFormatter={(v) => fmtMoneyShort(Number(v))} tick={{ fontSize: 11, fill: "var(--ash)" }} axisLine={{ stroke: "#cbd5e1" }} tickLine={false} />
                      <Tooltip formatter={(v, n) => [fmtMoney(Number(v)), n]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="nhap" name="Nhập" fill="var(--moss, #2f5d3a)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                      <Bar dataKey="xuat" name="Xuất" fill="var(--rust, #c5400a)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {tab === "gia-goc" && canViewCost && <KhoGiaGocThanhPham token={token} onCount={setGiaGocTong} />}

      {/* Kỳ kế toán (11/10/2026, gộp ba tab Kỳ đã tính / Lịch sử thao tác / Kỳ đã khóa): mỗi kỳ MỘT
          dòng đi theo hai bước khóa sổ → tính giá, hành động nằm ngay trên dòng. Lịch sử là cách xem
          thứ hai của cùng tab. Lưới chung + nút Lọc; lọc tại chỗ vì cả hai danh sách đã nạp trọn. */}
      {tab === "ky" && (() => {
        const lichSu = kyView === "lichsu";
        const luoi = lichSu ? luoiLs : luoiKy;
        const cotDs = lichSu ? COT_LS : cotKyDs;
        const cot = cotHien(luoi, cotDs);
        const coLoc = lichSu
          ? lsTim.trim() !== "" || lsKyDS.loai !== "tat_ca" || soDaAp(dieuKienLs, locLs) > 0
          : kyTim.trim() !== "" || kyKyDS.loai !== "tat_ca" || soDaAp(dieuKienKy, locKy) > 0;
        const xoaLoc = lichSu
          ? () => { setLsTim(""); setLsKyDS(KY_LS_MAC_DINH); setLocLs(LOC_LS_TRONG); }
          : () => { setKyTim(""); setKyKyDS(KY_KY_MAC_DINH); setLocKy(LOC_KY_TRONG); };
        const tong = lichSu ? filteredHist.length : filteredKy.length;
        return (
          <div className="lds" key={kyView}>
            <section className="lds-loc">
              <div className="lds-loc__thanh tl-thanh" role="search">
                <div className="kho-chieu-segmented" role="group" aria-label="Cách xem">
                  {(
                    [
                      ["ky", "Các kỳ"],
                      ["lichsu", "Lịch sử thao tác"],
                    ] as const
                  ).map(([v, nhan]) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={kyView === v}
                      className={`kho-chieu-btn${kyView === v ? " is-active" : ""}`}
                      onClick={() => setKyView(v)}
                    >
                      {nhan}
                    </button>
                  ))}
                </div>
                {lichSu ? (
                  <>
                    <OTim value={lsTim} onChange={setLsTim} placeholder="Tìm phạm vi, người, tên kỳ" ariaLabel="Tìm thao tác" />
                    <ThanhLoc ky={lsKyDS} moc={MOC_LS} onKy={setLsKyDS} dieuKien={dieuKienLs} loc={locLs} onLoc={setLocLs} />
                  </>
                ) : (
                  <>
                    <OTim value={kyTim} onChange={setKyTim} placeholder="Tìm tên kỳ, phạm vi, ngày" ariaLabel="Tìm kỳ" />
                    <ThanhLoc ky={kyKyDS} moc={MOC_KY} onKy={setKyKyDS} dieuKien={dieuKienKy} loc={locKy} onLoc={setLocKy} />
                  </>
                )}
                <ChonCot cot={cotDs} {...luoi.chonCot} />
              </div>
            </section>

            <div className="lds-sheet">
              <CuonLuoi ghim={luoi.soGhim(cot)}>
                <table className="lds-g" style={{ minWidth: rongLuoi(cot) }}>
                  <DauLuoi cot={cot} luoi={luoi} />
                  <tbody>
                    {lichSu ? (
                      filteredHist.length === 0 ? (
                        histRows.length === 0
                          ? dongTrong(cot.length, "Chưa có thao tác nào.")
                          : dongTrong(cot.length, "Không có thao tác nào khớp điều kiện đang lọc.", coLoc ? xoaLoc : undefined)
                      ) : (
                        pagedHist.map((r) => <tr key={r.key}>{cot.map((c) => oLs(c.key, r))}</tr>)
                      )
                    ) : filteredKy.length === 0 ? (
                      kyRows.length === 0
                        ? dongTrong(cot.length, canCloseBook
                          ? "Chưa có kỳ nào. Bấm “Khóa / mở kỳ” để khóa sổ kỳ đầu tiên, rồi tính giá ngay trên dòng kỳ."
                          : "Chưa có kỳ nào được khóa sổ.")
                        : dongTrong(cot.length, "Không có kỳ nào khớp điều kiện đang lọc.", coLoc ? xoaLoc : undefined)
                    ) : (
                      pagedKy.map((r) => <tr key={r.key}>{cot.map((c) => oKy(c.key, r))}</tr>)
                    )}
                  </tbody>
                </table>
              </CuonLuoi>
              {tong > 0 && (
                <PhanTrangDayDu trang={page} size={pageSize} tong={tong} soDong={lichSu ? pagedHist.length : pagedKy.length}
                  onTrang={setPage} onSize={doiCoTrang} donVi={lichSu ? "thao tác" : "kỳ"}
                  ariaLabel={lichSu ? "Phân trang lịch sử thao tác kỳ" : "Phân trang kỳ kế toán"} />
              )}
            </div>
          </div>
        );
      })()}

      <ConfirmDialog
        open={khoaOpen}
        title={khoaHanhDong === "khoa" ? "Khóa kỳ kế toán kho" : "Mở lại kỳ kế toán kho"}
        confirmLabel={khoaHanhDong === "khoa" ? "Khóa sổ" : "Mở sổ"}
        cancelLabel="Hủy"
        busy={khoaBusy}
        error={khoaError}
        confirmDisabled={!khoaTu || !khoaDen}
        onConfirm={saveKhoa}
        onCancel={() => setKhoaOpen(false)}
      >
        <div className="kho-khoa">
          <div className="kho-khoa__field">
            <span className="kho-khoa__label">Hành động</span>
            <div className="kho-khoa__seg">
              {(
                [
                  ["khoa", "Khóa kỳ"],
                  ["mo", "Mở kỳ"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`kho-khoa__seg-btn${
                    khoaHanhDong === id ? (id === "khoa" ? " is-khoa" : " is-mo") : ""
                  }`}
                  onClick={() => fillKhoa(id)}
                >
                  <LockIcon open={id === "mo"} size={15} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="kho-khoa__field">
            <span className="kho-khoa__label">Phạm vi</span>
            <Select
              portal
              ariaLabel="Phạm vi"
              value={khoaScope === "all" ? "" : String(khoaScope)}
              onChange={(v) => {
                const sc = v ? Number(v) : "all";
                setKhoaScope(sc);
                // Đổi phạm vi → mốc đã khóa khác → map lại "Từ ngày" cho đúng phạm vi mới.
                if (khoaHanhDong === "khoa") setKhoaTu(nextKhoaTu(kyList, sc) ?? "");
              }}
              options={[
                { value: "", label: "Toàn kho" },
                ...khoList.map((k) => ({ value: String(k.id), label: `${k.ma} ${k.ten}` })),
              ]}
            />
          </div>

          <div className="kho-khoa__row">
            <div className="kho-khoa__field">
              <label className="kho-khoa__label" htmlFor="khoa-tu">Từ ngày</label>
              <ChonNgay id="khoa-tu" aria-label="Từ ngày" className="rc-input" value={khoaTu} max={khoaDen || undefined} onChange={(v) => setKhoaTu(v)} />
            </div>
            <div className="kho-khoa__field">
              <label className="kho-khoa__label" htmlFor="khoa-den">Đến ngày</label>
              <ChonNgay id="khoa-den" aria-label="Đến ngày" className="rc-input" value={khoaDen} min={khoaTu || undefined} onChange={(v) => setKhoaDen(v)} />
            </div>
          </div>


          {/* KHÓA: đặt TÊN kỳ (tuỳ chọn) — trùng tên kỳ đang khóa khác thì backend chặn. */}
          {khoaHanhDong === "khoa" && (
            <div className="kho-khoa__field">
              <label className="kho-khoa__label" htmlFor="khoa-ten">Tên kỳ (tuỳ chọn)</label>
              <input
                id="khoa-ten"
                className="rc-input"
                value={khoaTen}
                maxLength={120}
                onChange={(e) => setKhoaTen(e.target.value)}
                placeholder="vd Kỳ tháng 7/2026"
              />
            </div>
          )}

          <p className={`kho-khoa__note kho-khoa__note--${khoaHanhDong}`}>
            <LockIcon open={khoaHanhDong === "mo"} size={14} />
            <span>
              {khoaHanhDong === "khoa"
                ? "Phiếu có NGÀY GHI SỔ (ngày hạch toán) trong khoảng này thuộc kỳ đã chốt — không ghi sổ vào kỳ này được. Khóa xong bấm “Tính giá” ở dòng của kỳ để chốt giá bình quân."
                : "Mở lại kỳ để ghi sổ tiếp. Đặt “Đến ngày” = ngày cuối đang khóa. Số đã tính giá của phần mở bị xoá, khóa lại phải tính lại. Thao tác nào cũng lưu vào Lịch sử."}
            </span>
          </p>

          {/* KHÓA: hiện KỲ KHÓA GẦN NHẤT theo phạm vi (kyList sắp mới nhất trước) để biết đã chốt tới
              đâu → đặt "Từ ngày" cho khớp, tránh giẫm kỳ cũ. */}
          {khoaHanhDong === "khoa" &&
            (() => {
              const k = kyList.find((x) => (x.kho_id ?? "all") === khoaScope);
              return k ? (
                <p className="kho-khoa__kyten">
                  Kỳ khóa gần nhất: <b>{fmtDate(k.tu_ngay)} – {fmtDate(k.den_ngay)}</b>
                  {k.ten ? ` (${k.ten})` : ""}
                </p>
              ) : null;
            })()}

          {/* MỞ: hiện TÊN kỳ ĐANG KHÓA sắp được mở (nếu kỳ có đặt tên) để biết rõ đang mở kỳ nào. */}
          {khoaHanhDong === "mo" &&
            (() => {
              const k = kyList.find(
                (x) => (x.kho_id ?? "all") === khoaScope && x.den_ngay.slice(0, 10) === khoaDen,
              );
              return k?.ten ? (
                <p className="kho-khoa__kyten">
                  Kỳ đang khóa: <b>{k.ten}</b>
                </p>
              ) : null;
            })()}
        </div>
      </ConfirmDialog>

      {/* Popup "Tính giá kỳ" (bình quân cuối kỳ, kiểu MISA) — chốt tồn cuối kỳ vào snapshot.
          BẮT BUỘC dựa trên 1 KỲ ĐÃ KHÓA (khóa sổ trước rồi mới tính). */}
      <ConfirmDialog
        open={tinhOpen}
        title="Tính giá kỳ (bình quân cuối kỳ)"
        confirmLabel={(tab === "ky" ? kyRows.some((r) => r.kyIdx === nxtKyIdx && r.tinh) : nxtDaTinh) ? "Tính lại" : "Tính giá kỳ"}
        confirmDisabled={nxtKyIdx < 0 || !nxtTu || !nxtDen}
        cancelLabel="Hủy"
        busy={tinhBusy}
        error={tinhErr}
        onConfirm={tinhGiaKy}
        onCancel={() => setTinhOpen(false)}
      >
        <div className="kho-khoa">
          <p className="kho-hint" style={{ marginTop: 0 }}>
            Tính đơn giá <b>bình quân gia quyền cuối kỳ</b> cho từng mặt hàng và <b>chốt tồn cuối kỳ</b>;
            kỳ sau đọc số này làm đầu kỳ. Không đụng giá vốn phiếu xuất (đích danh).
          </p>
          {kyList.length === 0 ? (
            <div className="banner banner--warn" style={{ marginBottom: 0, alignItems: "flex-start" }}>
              <span>
                Chưa có <b>kỳ nào được khóa sổ</b>. Phải <b>khóa sổ kỳ</b> trước rồi mới tính giá cho kỳ đó.
                <button
                  type="button"
                  className="rc__link-btn"
                  style={{ display: "block", marginTop: 6 }}
                  onClick={() => { setTinhOpen(false); openKhoa(); }}
                >
                  Khóa sổ kỳ ngay →
                </button>
              </span>
            </div>
          ) : (
            <>
              {/* Chọn 1 KỲ ĐÃ KHÓA để tính (điền sẵn khoảng ngày + tên kỳ). */}
              <label className="kho-khoa__field">
                <span className="kho-khoa__label">Kỳ đã khóa</span>
                <select
                  className="rc-input"
                  value={String(nxtKyIdx)}
                  onChange={(e) => chonKy(Number(e.target.value))}
                >
                  <option value="-1" disabled>— Chọn kỳ đã khóa —</option>
                  {kyList.map((k, i) => (
                    <option key={i} value={i}>
                      {(k.ten || "Kỳ")} từ {fmtDate(k.tu_ngay)} đến {fmtDate(k.den_ngay)}
                      {k.kho_ten ? ` (${k.kho_ten})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="kho-khoa__field">
                <span className="kho-khoa__label">Kỳ sẽ tính</span>
                <div style={{ fontWeight: "var(--fw-medium)", color: "var(--ink)" }}>
                  {nxtTu ? fmtDate(nxtTu) : "—"} → {nxtDen ? fmtDate(nxtDen) : "—"}
                  {" ("}
                  {khoId == null ? "Tất cả kho" : (khoList.find((w) => w.id === khoId)?.ten ?? `Kho #${khoId}`)}
                  {")"}
                </div>
              </div>
              {/* Tên kỳ = tên của kỳ ĐÃ KHÓA đang chọn (kỳ khóa không đặt tên → suy từ khoảng ngày). */}
              <div className="kho-khoa__field">
                <span className="kho-khoa__label">Tên kỳ</span>
                <div style={{ fontWeight: "var(--fw-medium)", color: "var(--ink)" }}>
                  {(nxtKyIdx >= 0 ? kyList[nxtKyIdx]?.ten?.trim() : "") || autoTenKy(nxtTu, nxtDen) || "—"}
                  <span className="rc__muted" style={{ fontWeight: 400 }}> (theo kỳ đã khóa)</span>
                </div>
              </div>
            </>
          )}
        </div>
      </ConfirmDialog>

      {/* Popup lô NHẬP + lịch sử XUẤT của 1 mặt hàng (bấm dòng ở bảng N-X-T). Chỉ xem, không sửa. */}
      <ConfirmDialog
        open={matInfo !== null}
        wide
        hideConfirm
        title={`${matInfo?.ten ?? "Mặt hàng"} — Lô nhập / xuất${matInfo?.kho_ten ? ` (${matInfo.kho_ten})` : ""}`}
        cancelLabel="Đóng"
        onConfirm={() => {}}
        onCancel={() => { setMatInfo(null); setMatHist(null); }}
      >
        {matErr && <div className="banner banner--error" style={{ marginBottom: 8 }}>{matErr}</div>}
        {matLoading || !matHist ? (
          <EmptyState trangThai="dang-tai" gon nhanTai="Đang tải lịch sử mặt hàng…" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div className="rc-sec__title" style={{ marginBottom: 6 }}>
                Lô nhập ({matHist.nhap.length}). Tồn hiện tại: <b>{fmtQty(matHist.on_hand)}</b> {matInfo?.dvt ?? ""}
              </div>
              <div className="kho-bc-wrap" style={{ maxHeight: 260 }}>
                <table className="rc__table kho-bc">
                  <thead><tr>
                    <th>Phiếu</th><th>Ngày nhập</th>
                    <th className="kho-bc__num">SL ban đầu</th><th className="kho-bc__num">SL còn</th>
                    <th className="kho-bc__num">Đơn giá nhập</th><th>Vị trí</th><th>HSD</th>
                  </tr></thead>
                  <tbody>
                    {matHist.nhap.length === 0 ? (
                      <tr><td colSpan={7} className="rc__empty-state">Chưa có lô nhập.</td></tr>
                    ) : matHist.nhap.map((l) => (
                      <tr key={l.id}>
                        <td>
                          {l.voucher_id != null ? (
                            <button type="button" className="rc__code-badge kho-bc__voucher" onClick={() => openVoucher(l.voucher_id)}>
                              {l.voucher_ma ?? `#${l.voucher_id}`}
                            </button>
                          ) : "—"}
                        </td>
                        <td>{fmtDate(l.ngay_nhap)}</td>
                        <td className="kho-bc__num">{fmtQty(l.sl_ban_dau)}</td>
                        <td className="kho-bc__num">{fmtQty(l.sl_con_lai)}</td>
                        <td className="kho-bc__num">{l.don_gia_nhap != null ? fmtMoney(l.don_gia_nhap) : "—"}</td>
                        <td>{l.vi_tri ?? "—"}</td>
                        <td>{l.hsd ? fmtDate(l.hsd) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <div className="rc-sec__title" style={{ marginBottom: 6 }}>Lịch sử xuất ({matHist.xuat.length})</div>
              <div className="kho-bc-wrap" style={{ maxHeight: 260 }}>
                <table className="rc__table kho-bc">
                  <thead><tr>
                    <th>Phiếu</th><th>Ngày</th>
                    <th className="kho-bc__num">SL xuất</th><th className="kho-bc__num">Đơn giá vốn</th>
                  </tr></thead>
                  <tbody>
                    {matHist.xuat.length === 0 ? (
                      <tr><td colSpan={4} className="rc__empty-state">Chưa có lượt xuất.</td></tr>
                    ) : matHist.xuat.map((x, i) => (
                      <tr key={`${x.voucher_id}-${i}`}>
                        <td>
                          {x.voucher_id != null ? (
                            <button type="button" className="rc__code-badge kho-bc__voucher" onClick={() => openVoucher(x.voucher_id)}>
                              {x.voucher_ma ?? `#${x.voucher_id}`}
                            </button>
                          ) : "—"}
                        </td>
                        <td>{fmtDate(x.ngay)}</td>
                        <td className="kho-bc__num">{fmtQty(x.so_luong)}</td>
                        <td className="kho-bc__num">{x.don_gia != null ? fmtMoney(x.don_gia) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </ConfirmDialog>

      {/* Mở PHIẾU đã chọn từ popup lô — chỉ XEM (không lập/ghi sổ/điều chỉnh ở màn báo cáo). */}
      {openVoucherId != null && (
        <VoucherDrawer
          token={token}
          voucherId={openVoucherId}
          canCreate={false}
          canPost={false}
          canViewCost={canViewCost}
          onClose={() => setOpenVoucherId(null)}
          onChanged={() => {}}
        />
      )}
    </main>
  );
}
