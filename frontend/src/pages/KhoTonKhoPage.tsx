// Màn "Kho hàng" của MỘT kho vật lý — bấm 1 kho dưới section "Kho hàng" trên navbar.
//
// Đây là VIỆC CỦA KHO (chỉ ai có `can_view_stock` mới thấy — gate ở AppShell). Gồm 2 tab:
//   • Tồn kho:  gom lô theo VẬT TƯ, bung xem từng lô (tồn = Σ sl_con_lai, spec §6).
//   • Phiếu kho: phiếu nhập/xuất ĐÃ LẬP tại kho này (chuyển vào đây thay vì ở Hộp yêu cầu — phiếu
//     là chứng từ của kho, nên nằm cùng chỗ với tồn/ngưỡng).
// Đặt ngưỡng tồn nằm ở đây (không ở màn yêu cầu) vì ngưỡng gắn với kho vật lý: bấm ô Min/Max
// hoặc badge Trạng thái của 1 mã → popup đặt ngưỡng (chỉ khi có quyền set_threshold).
// Giá vốn CHỈ hiện với `can_view_cost` — thiếu quyền thì cột giá biến mất (ẩn cột, không "—").
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  ApiError,
  api,
  type DuBaoTonRow,
  type HangLoai,
  type NhomTon,
  type TinhTrangTon,
  type TonNhomMuc,
  type StockLot,
  type StockMaterialHistoryPage,
  type TabLichSuMatHang,
  type StockThreshold,
  type StockVoucher,
} from "../api/client";
import { useCan } from "../auth/permissions";
import { CodeLink } from "../components/CodeLink";
import { PhanTrangDayDu } from "../components/PhanTrangDayDu";
import { Button } from "../components/Button";
import {
  CuonLuoi, ChonCot, LocNhanhTrangThai, OTim, rongLuoi, soVN, useCauHinhLuoi,
  type CotLuoi, type MauTT,
} from "../components/LuoiDs";
import { EmptyRow as DongTrongLds } from "../components/EmptyState";
import { Select } from "../components/Select";
import type { NavigateFn } from "../components/AppShell";
import { fmtDate, fmtDateISO, fmtDateTime, money } from "../utils/format";
import { qrToSvg } from "../lib/qr";
import { chuanKho, coDonViGoc, khoaNguong, khoaTon, nhanDongTon, nhanKho } from "../lib/khoGiay";
import { tenDonVi, useNapTenDonVi } from "./tenDonVi";
import {
  DecimalInput,
  AN_DIEU_CHUYEN,
  DEFAULT_PAGE_SIZE,
  ChipTrangThaiPhieu,
  fmtKg,
  fmtQty,
  todayISO,
} from "./khoShared";
import { InboxRequestDrawer, VoucherDrawer, TransferDrawer } from "./KhoYeuCauPage";
import { khoaTonKho } from "../auth/quyenKho";
import {
  LOC_PK_TRONG,
  MOC_PHIEU_KHO,
  locPKLenUrl,
  locPKTuUrl,
  thamSoLocPK,
  useDieuKienPhieuKho,
  type LocPhieuKho,
} from "./loc-kho/dieu-kien-phieu-kho";
import {
  LOC_TON_TRONG,
  MOC_TON_KHO,
  dieuKienTonKho,
  locTonLenUrl,
  locTonTuUrl,
  thamSoLocTon,
  type LocTonKho,
} from "./loc-kho/dieu-kien-ton-kho";
import { ThanhLoc } from "./thanh-loc/ThanhLoc";
import { kyLenUrl, kyTuUrl, thamSoKy, type KyDS } from "./thanh-loc/ky-danh-sach";
import { dkTheoTab, soDaAp, type DieuKien } from "./thanh-loc/thanh-loc";
import { useLocMan } from "./thanh-loc/useLocMan";
import { ConfirmDialog } from "../components/ConfirmDialog";
import "./rebuild-catalog.css";
import "./kho-request.css";
import { NganPhai } from "./ke-toan/shared/NganPhai";
import "./ke-toan/ke-toan.css";
import { ngayCanMua, tinhDuBao, type DuBao } from "./ton-kho/duBao";
import { ThuocMuc } from "./ton-kho/ThanhNguong";
import { HopNguong } from "./ton-kho/HopNguong";
import { tenTrungLap } from "./ton-kho/tenTrung";
import { AnhMatHang, TongQuanTon } from "./ton-kho/TongQuanTon";
import "./ton-kho/ton-kho.css";

import {
  ArrowLeftRight,
  Printer,
  QrCode,
  ShoppingCart,
  Gauge,
} from "lucide-react";




/** Nhãn khổ + đơn vị gốc cạnh mã của MỘT dòng tồn: giấy "780 × 905 mm (tờ)", "khổ 1000 mm (kg)",
 *  lô chưa có khổ "chưa có khổ (kg)"; hàng khác rỗng — vật tư khác cũng tách dòng theo đơn vị gốc
 *  nhưng không có khổ, đơn vị đã nằm ở cột ĐVT. */
function nhanTonNhom(g: MaterialGroup): string {
  const laGiay = g.hang_loai === "giay";
  return nhanDongTon(laGiay ? g.goc : "", g.khoRong, g.khoDai, { laGiay });
}

interface MaterialGroup {
  /** Khoá GỘP của bảng tồn: cặp trỏ danh mục gốc. Chuỗi `"giay:12"` dùng làm key của Map/JSX
   *  vì tuple không so sánh được bằng `===` trong Map. */
  hang_loai: HangLoai;
  hang_id: number;
  key: string;
  /** Giấy: đơn vị gốc của DÒNG tồn (mã + khổ + đơn vị gốc là một dòng). Hàng khác: "" · 0 · 0. */
  goc: string;
  khoRong: number;
  khoDai: number;
  code: string | null;
  name: string | null;
  // `dvt` = TÊN có dấu để HIỂN THỊ (tờ/cái); `dvtCode` = MÃ (to/cai) cho logic (vd seed mua hàng).
  dvt: string | null;
  dvtCode: string | null;
  // Ảnh minh hoạ mặt hàng (từ danh mục). null = chưa có ảnh. Sửa được trong drawer (quyền danh mục).
  anh: string | null;
  total: number;
  value: number; // Σ sl_con_lai × đơn giá — chỉ có nghĩa khi thấy giá
  lots: StockLot[];
  // Vị trí cất (kệ/ô) distinct, ƯU TIÊN lô nhập gần nhất → rồi giữ thứ tự xuất hiện đầu.
  // Rỗng = chưa lô nào khai vị trí. Dùng ở cột Vị trí (cắt +K) và tab Tổng quan (đủ).
  viTris: string[];
  // Hạn sử dụng: hạn SỚM NHẤT (gần hết hạn nhất) của các lô CÒN tồn + số hạn KHÁC (cột "+N").
  // null = không lô nào còn tồn có hạn.
  hsdSoonest: string | null;
  hsdOthers: number;
  // Phán quyết + số dự báo của dòng do MÁY CHỦ trả (Cần mua, chip Tình trạng, Sắp xuất/Sắp về/Dự kiến còn,
  // dòng dự báo cho ngăn chi tiết). null = chưa có (dòng dựng từ lô rời).
  muc: TonNhomMuc | null;
  // Số lô khả dụng là thành phẩm KCS CHƯA CÓ giá gốc — `value` đang cộng 0 cho các lô này.
  chuaGiaGoc: number;
}

type TonTab = "ton" | "nhap" | "xuat" | "dc";

// Kỳ + bộ lọc của các tab (06/10/2026): ghi lên URL theo mã màn của kho (`kho-item:<id>`). Một state
// chung cho hai nhóm tab — kỳ phiếu (mốc Ngày tạo/Ngày nhập xuất/Ngày ghi sổ) và kỳ tồn (mốc Nhập gần
// nhất) dùng chung khoảng ngày; đổi sang nhóm tab kia thì kỳ về "Tất cả".
type LocManPK = { ky: KyDS; loc: LocPhieuKho; ton: LocTonKho };
const LOC_MAN_PK_TRONG: LocManPK = { ky: { loai: "tat_ca", moc: "tao" }, loc: LOC_PK_TRONG, ton: LOC_TON_TRONG };
const docLocManPK = (p: URLSearchParams): LocManPK => ({
  ky: kyTuUrl(p, [...MOC_PHIEU_KHO.map(([m]) => m), ...MOC_TON_KHO.map(([m]) => m)], "tao"),
  loc: locPKTuUrl(p),
  ton: locTonTuUrl(p),
});
const ghiLocManPK = (t: LocManPK) => ({ ...kyLenUrl(t.ky, "tao"), ...locPKLenUrl(t.loc), ...locTonLenUrl(t.ton) });

const NHOM_TON_TRONG: Record<NhomTon, number> = { all: 0, can_mua: 0, du_ton: 0, chuakhai: 0, sap_het_han: 0 };

// ── Lưới danh sách (khuôn chung 08/10/2026) ──────────────────────────────────
interface CotKho extends CotLuoi { w?: number; n?: boolean; tip?: string }

/** Tồn kho: [chọn] Vật tư, Khổ, Định lượng, ĐVT, Nhập gần nhất, Vị trí, Hạn sử dụng (khi có), Đang có, Sắp xuất, Sắp về, Dự kiến
 *  còn, Giá trị (khi thấy giá), Mức tồn, Tình trạng. */
export const COT_TON: CotKho[] = [
  { key: "chon", label: "Chọn", coDinh: true, w: 40 },
  { key: "vattu", label: "Vật tư", coDinh: true, w: 260 },
  // Khổ và ĐVT là hai cột riêng như Báo cáo kho (10/10/2026): cùng mã cùng khổ mà khác đơn vị là
  // hai dòng, đọc theo cột ĐVT là phân biệt được.
  { key: "kho", label: "Khổ", w: 130 },
  { key: "dl", label: "Định lượng", w: 100, n: true, tip: "Định lượng (gsm) khai ở danh mục giấy" },
  { key: "dvt", label: "ĐVT", w: 70 },
  { key: "nhap", label: "Nhập gần nhất", w: 120 },
  { key: "vitri", label: "Vị trí", w: 150 },
  { key: "hsd", label: "Hạn sử dụng", w: 150, tip: "Hạn SỚM NHẤT của lô còn tồn" },
  { key: "co", label: "Đang có", w: 130, n: true },
  { key: "quykg", label: "Quy kg", w: 110, n: true, tip: "Số tờ đang có quy ra kg theo khổ và định lượng" },
  { key: "sapxuat", label: "Sắp xuất", w: 100, n: true, tip: "Lệnh còn phải lấy hàng này (theo bảng cân đối vật tư) cộng đề nghị xuất chưa ghi sổ (giao hàng, gia công ngoài)" },
  { key: "sapve", label: "Sắp về", w: 100, n: true, tip: "Đơn mua đã hẹn ngày về" },
  { key: "dukien", label: "Dự kiến còn", w: 120, n: true, tip: "Đang có trừ Sắp xuất cộng Sắp về" },
  { key: "giatri", label: "Giá trị", w: 130, n: true },
  { key: "mucton", label: "Mức tồn", w: 230, tip: "Tối thiểu và tối đa tại kho này, bấm để sửa" },
  { key: "tinhtrang", label: "Tình trạng" },
];

/** Phiếu nhập / xuất: Số phiếu, Ngày tạo, Ngày nhập (hoặc xuất), Theo yêu cầu, Mặt hàng, Tổng SL, Giá vốn
 *  (khi thấy giá), Trạng thái, Người lập. */
const COT_PHIEU: CotKho[] = [
  { key: "ma", label: "Số phiếu", coDinh: true, w: 150 },
  { key: "ngay", label: "Ngày tạo", w: 104 },
  { key: "ngaypx", label: "Ngày nhập", w: 110 },
  { key: "yeucau", label: "Theo yêu cầu", w: 130 },
  { key: "mathang", label: "Mặt hàng", w: 90, n: true },
  { key: "tongsl", label: "Tổng SL", w: 110, n: true },
  { key: "giavon", label: "Giá vốn", w: 130, n: true },
  { key: "tt", label: "Trạng thái", w: 140 },
  { key: "nguoi", label: "Người lập" },
];

/** Chip Tình trạng: máy chủ trả MÃ tình trạng, ở đây chỉ đổi sang chữ + lớp màu. */
const CHIP_TINH_TRANG: Record<TinhTrangTon, { nhan: string; lop: "mua" | "thua" | "se-vuot" | "chua" }> = {
  het: { nhan: "Hết", lop: "mua" },
  can_mua: { nhan: "Cần mua", lop: "mua" },
  vuot: { nhan: "Vượt tối đa", lop: "thua" },
  se_vuot: { nhan: "Sẽ vượt tối đa", lop: "se-vuot" },
  chua: { nhan: "Chưa đặt mức", lop: "chua" },
};

/** Chip của dòng: thành phẩm thiếu thì phải SẢN XUẤT chứ không mua (12/10/2026) — chỉ đổi chữ, luật
 *  tính và màu giữ nguyên. */
const chipTinhTrang = (muc: TonNhomMuc | null | undefined) => {
  if (!muc?.tinh_trang) return null;
  const c = CHIP_TINH_TRANG[muc.tinh_trang];
  return muc.tinh_trang === "can_mua" && muc.la_thanh_pham ? { ...c, nhan: "Cần sản xuất" } : c;
};

/** Phán quyết của trang theo khoá dòng tồn (cùng dạng `MaterialGroup.key`). */
const mucTheoKhoa = (nhom: TonNhomMuc[]): Record<string, TonNhomMuc> =>
  Object.fromEntries(nhom.map((m) => [m.khoa, m]));

const NHAN_NGAY_PHIEU: Record<string, string> = { nhap: "Ngày nhập", xuat: "Ngày xuất", dc: "Ngày chuyển" };



/** Gom lô của các mặt hàng (một trang do máy chủ cắt) thành dòng tồn — mỗi khoá tồn một nhóm. Thứ tự nhóm =
 *  thứ tự lô máy chủ trả (đã xếp theo tên mặt hàng rồi khổ), nên không sắp lại ở đây. */
function gomNhomTon(lots: StockLot[], mucs: Record<string, TonNhomMuc>): MaterialGroup[] {
  const m = new Map<string, MaterialGroup>();
    for (const lot of lots) {
      // Giấy: một dòng mỗi (mã, khổ, đơn vị gốc); vật tư khác: một dòng mỗi (mã, đơn vị gốc) — khoá
      // 5 phần trùng `TonNhomMuc.khoa` của máy chủ. Cùng khổ mà một lô đếm tờ, một lô đếm kg là HAI
      // dòng: tờ và kg không cộng được.
      const key = khoaTon(lot);
      let g = m.get(key);
      if (!g) {
        const laGiay = lot.hang_loai === "giay";
        g = {
          hang_loai: lot.hang_loai,
          hang_id: lot.hang_id,
          key,
          goc: coDonViGoc(lot.hang_loai) ? lot.don_vi_goc ?? "" : "",
          khoRong: laGiay ? lot.kho_rong : 0,
          khoDai: laGiay ? lot.kho_dai : 0,
          code: lot.hang_ma,
          name: lot.hang_ten,
          dvt: lot.dvt_ten ?? lot.dvt,
          dvtCode: lot.dvt,
          anh: lot.hang_anh,
          total: 0,
          value: 0,
          lots: [],
          viTris: [],
          hsdSoonest: null,
          hsdOthers: 0,
          muc: null,
          chuaGiaGoc: 0,
        };
        m.set(key, g);
      }
      // TỒN KHẢ DỤNG = chỉ lô `available` (khớp backend `on_hand`/`LOT_ISSUABLE`). Lô chờ KCS
      // (`qc_wait`) / giữ chỗ (`hold`) / lỗi (`defect`) KHÔNG tính vào "khả dụng" — trước đây cộng
      // bừa nên list lệch drawer (vd 300,25 list vs 285,25 drawer). Vẫn giữ MỌI lô trong `g.lots`
      // để hiển thị vị trí / HSD / lịch sử.
      if (lot.trang_thai === "available") {
        g.total += lot.sl_con_lai;
        g.value += lot.sl_con_lai * (lot.don_gia_nhap ?? 0);
        if (lot.tu_kcs && !lot.don_gia_nhap && lot.sl_con_lai > 0) g.chuaGiaGoc += 1;
      }
      g.lots.push(lot);
    }
    const arr = [...m.values()];
    for (const g of arr) {
      // g.total/g.value đã cộng ĐÚNG (lô hết cộng 0). Chỉ giữ lô CÒN TỒN cho phần hiển thị
      // (số đợt nhập · vị trí · ngày). Vật tư xuất hết → nhóm vẫn tồn tại (đã tạo từ lô hết) với
      // tồn 0 + đèn "Hết"; nhưng lô hết KHÔNG đếm vào số đợt / vị trí.
      g.lots = g.lots.filter((l) => l.sl_con_lai > 0);
      // Lô trong mỗi nhóm: nhập trước lên trước (FIFO), để đọc lịch sử nhập tự nhiên.
      g.lots.sort((a, b) => a.ngay_nhap.localeCompare(b.ngay_nhap));
      // Vị trí: dùng BẢN SAO sort GIẢM DẦN (nhập mới trước) để KHÔNG phá FIFO ở trên, rồi
      // distinct giữ thứ tự xuất hiện đầu — vị trí của lô mới nhất lên đầu danh sách.
      const seen = new Set<string>();
      const viTris: string[] = [];
      for (const lot of [...g.lots].sort((a, b) => b.ngay_nhap.localeCompare(a.ngay_nhap))) {
        const v = (lot.vi_tri ?? "").trim();
        if (v && !seen.has(v)) {
          seen.add(v);
          viTris.push(v);
        }
      }
      g.viTris = viTris;
      // Hạn sử dụng: distinct các hạn của lô CÒN tồn, sắp TĂNG dần → hạn sớm nhất lên đầu (FEFO).
      const hsds = [...new Set(g.lots.map((l) => l.hsd).filter((h): h is string => !!h))].sort();
      g.hsdSoonest = hsds[0] ?? null;
      g.hsdOthers = Math.max(0, hsds.length - 1);
      g.muc = mucs[g.key] ?? null;
    }
    return arr;
}

export function KhoTonKhoPage({
  khoId,
  ten,
  ma,
  navigate,
  token,
  openMatHangKey = null,
  khoOptions = [],
}: {
  khoId: number;
  ten: string;
  ma?: string;
  token: string;
  navigate: NavigateFn;
  /** Deep-link tem QR: mở thẳng drawer lô + vị trí của vật tư này khi tồn đã tải xong. */
  openMatHangKey?: string | null;
  /** Mọi kho đã khai báo — để drawer chọn KHO ĐÍCH khi điều chuyển (loại kho hiện tại). */
  khoOptions?: { id: number; ma: string; ten: string }[];
}) {
  const can = useCan();
  // Ô "Xem giá thành" của DÒNG KHO NÀY (05/10/2026): bật ở Kho giấy thì chỉ thấy tiền ở Kho giấy.
  const canViewCost = can(khoaTonKho(khoId), "view_cost");
  // Mỗi kho một dòng quyền `ton_kho_<id>` (05/10/2026) — Xem = số tồn + lô của KHO NÀY, ô chi tiết
  // "Khai ngưỡng tồn" = ngưỡng của kho này. Kho khác bật/tắt không ảnh hưởng.
  const canViewStock = can(khoaTonKho(khoId), "read");
  const canCreate = can("kho", "create");
  // ĐÃ GỘP quyền: ghi sổ + hủy dùng CHUNG quyền lập phiếu (create) — không còn 'post' riêng.
  const canPost = canCreate;
  const canSetThreshold = can(khoaTonKho(khoId), "set_threshold");

  const [tab, setTab] = useState<TonTab>("ton");
  // Tab Tồn kho: lô của các MẶT HÀNG trong trang hiện tại — máy chủ đã gom theo mặt hàng, lọc, đếm 5
  // nhóm và cắt trang (08/10/2026). `groups` bên dưới dựng dòng từ đúng các lô này.
  const [lots, setLots] = useState<StockLot[]>([]);
  const [tonTotal, setTonTotal] = useState(0);
  const [demNhom, setDemNhom] = useState<Record<NhomTon, number>>(NHOM_TON_TRONG);
  // Có mặt hàng nào của kho khai hạn sử dụng — cột Hạn sử dụng chỉ hiện khi có.
  const [coHsd, setCoHsd] = useState(false);
  // Phán quyết từng dòng của trang hiện tại, theo khoá dòng tồn; `duBaoOk` false = dự báo hỏng tạm thời.
  const [mucTheo, setMucTheo] = useState<Record<string, TonNhomMuc>>({});
  const [duBaoOk, setDuBaoOk] = useState(true);
  const [chiThanhPham, setChiThanhPham] = useState(false);
  // Khoá `"giay:12"` — cặp (hang_loai, hang_id) dẹp thành chuỗi để dùng làm key Record/JSX.
  const [thresholds, setThresholds] = useState<Record<string, StockThreshold>>({});
  // Phiếu của tab đang xem — ĐÚNG một trang, máy chủ đã lọc/đếm/phân trang (06/10/2026).
  const [vouchers, setVouchers] = useState<StockVoucher[]>([]);
  const [vTotal, setVTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingV, setLoadingV] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // Vật tư đang mở popup lịch sử Nhập/Xuất (thay cho bung inline).
  const [openMaterial, setOpenMaterial] = useState<MaterialGroup | null>(null);
  // Mặt hàng đã tick để tạo Yêu cầu mua hàng / điều chuyển / in tem (chỉ tab Tồn kho). Giữ cả đối
  // tượng dòng chứ không chỉ khoá: chọn xuyên trang thì dòng của trang trước không còn trong `groups`.
  const [chon, setChon] = useState<Map<string, MaterialGroup>>(new Map());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [openVoucher, setOpenVoucher] = useState<number | null>(null);
  // Bump khi 1 phiếu đổi (điều chỉnh / ghi sổ / điều chuyển) → popup Lịch sử mặt hàng đang mở nạp lại
  // tồn + lịch sử NGAY (không bắt đóng-mở / reload trang).
  const [matTick, setMatTick] = useState(0);
  // Tab "Điều chuyển": mở MẶT TIỀN phiếu điều chuyển (TransferDrawer, keyed theo yêu cầu DC) thay vì
  // phiếu nhập/xuất chung — để hiện đúng "PHIẾU ĐIỀU CHUYỂN" + in mẫu điều chuyển, không phải PNK.
  const [openTransfer, setOpenTransfer] = useState<number | null>(null);
  const [openRequest, setOpenRequest] = useState<number | null>(null);
  // Từ MỘT phiếu điều chuyển (nhập-đích hoặc XUẤT-nguồn "chuyển đi") → mở mặt tiền PHIẾU ĐIỀU CHUYỂN.
  // Vế XUẤT-nguồn: phiếu KHÔNG mang id yêu cầu DC đích, phải hỏi BE tra ngược qua `xuat_voucher_id`.
  // Nếu không phải phiếu điều chuyển (404) → fallback mở phiếu thường.
  const openTransferByVoucher = useCallback((voucherId: number) => {
    api.kho.dieuChuyen
      .byVoucher(token, voucherId)
      .then((r) => setOpenTransfer(r.request_id))
      .catch(() => setOpenVoucher(voucherId));
  }, [token]);
  // Điều chuyển HÀNG LOẠT: mở popup cho các mã đã tick → gộp vào 1 yêu cầu điều chuyển.
  const [dcBulkOpen, setDcBulkOpen] = useState(false);
  // Cột ẩn / thứ tự cột người xem đã chọn — nhớ theo màn, mỗi lưới một khoá.
  const luoiTon = useCauHinhLuoi("kho-ton");
  const luoiPhieu = useCauHinhLuoi("kho-phieu-kho");
  // Popup đặt ngưỡng cho MỘT mã — mở khi bấm ô Min/Max hoặc badge Trạng thái (cần set_threshold).
  const [nguongFor, setNguongFor] = useState<MaterialGroup | null>(null);
  // Nhóm lọc nhanh của bảng tồn (phương án C): Tất cả · Cần mua · Vượt tối đa · Chưa đặt mức · Sắp hết hạn.
  const [nhom, setNhom] = useState<NhomTon>("all");
  // Kỳ + điều kiện: ba tab phiếu (Trạng thái, Người lập, Giá vốn khi xem được giá kho này) và tab Tồn
  // kho (khoảng Đang có, Giá trị tồn; kỳ theo ngày nhập gần nhất).
  const [locMan, setLocManGoc] = useLocMan(`kho-item:${khoId}`, LOC_MAN_PK_TRONG, docLocManPK, ghiLocManPK);
  const setLocMan = (t: LocManPK) => {
    setLocManGoc(t);
    setPage(1);
  };
  const dieuKienPK = useDieuKienPhieuKho(khoId, canViewCost);
  const dieuKienTon = useMemo(() => dieuKienTonKho(canViewCost), [canViewCost]);
  const kyTon = useMemo<KyDS>(() => ({ ...locMan.ky, moc: "nhap" }), [locMan.ky]);
  const kyPhieu = useMemo<KyDS>(
    () => (locMan.ky.moc === "nhap" ? { ...locMan.ky, moc: "tao" } : locMan.ky), [locMan.ky]);
  const khoaLocPK = JSON.stringify({ ...thamSoKy(kyPhieu), ...thamSoLocPK(locMan.loc, canViewCost) });
  const coLocPK = kyPhieu.loai !== "tat_ca" || soDaAp(dieuKienPK, locMan.loc) > 0;
  const khoangTon = thamSoKy(kyTon);
  const khoaLocTon = JSON.stringify({
    ngay_tu: khoangTon.tu_ngay, ngay_den: khoangTon.den_ngay, ...thamSoLocTon(locMan.ton, canViewCost),
  });
  const coLocTon = kyTon.loai !== "tat_ca" || soDaAp(dieuKienTon, locMan.ton) > 0 || nhom !== "all";
  // Đổi ô tìm / nhóm lọc / tab thì về trang 1 NGAY trong cùng lượt — khỏi một lượt nạp thừa (trang cũ).
  const datQ = (v: string) => {
    setQ(v);
    setPage(1);
  };
  const chonNhom = (n: NhomTon) => {
    setNhom(n);
    setPage(1);
  };
  // Đổi tab → XÓA sạch bộ lọc của tab Tồn kho; sang nhóm tab kia (Tồn kho ↔ Phiếu) thì kỳ cũng về "Tất
  // cả" vì hai nhóm tính kỳ theo mốc khác nhau.
  const chonTab = (id: TonTab) => {
    if (id === tab) return;
    const sangNhomKhac = (tab === "ton") !== (id === "ton");
    setTab(id);
    setNhom("all");
    setPage(1);
    setLocManGoc({
      ...locMan,
      ton: LOC_TON_TRONG,
      ky: sangNhomKhac ? { loai: "tat_ca", moc: id === "ton" ? "nhap" : "tao" } : locMan.ky,
    });
  };
  // Lập yêu cầu mua = đúng ô của màn Yêu cầu mua hàng (Xem để vào màn, Thao tác để lập).
  const coTheMua = can("yeu_cau_mua_hang", "read") && can("yeu_cau_mua_hang", "create");

  // Ngưỡng tồn của KHO NÀY: nạp một lần theo kho, vá tại chỗ khi lưu (`HopNguong.onSaved`). Lỗi / thiếu
  // quyền vẫn xem được tồn.
  const loadNguong = useCallback(() => {
    api.kho.nguongTon
      .list(token, khoId)
      .catch(() => [] as StockThreshold[])
      .then((ths) => {
        const map: Record<string, StockThreshold> = {};
        for (const t of ths) if (t.kho_id === khoId) map[khoaNguong(t)] = t;
        setThresholds(map);
      });
  }, [token, khoId]);
  useEffect(() => {
    loadNguong();
  }, [loadNguong]);
  // Ngưỡng của một dòng: tra theo khoá NGƯỠNG (giấy kèm khổ + đơn vị gốc, cùng khoá với dòng tồn).
  const nguongCua = useCallback(
    (g: MaterialGroup) => thresholds[khoaNguong({ hang_loai: g.hang_loai, hang_id: g.hang_id, kho_rong: g.khoRong, kho_dai: g.khoDai, don_vi_goc: g.goc })],
    [thresholds],
  );

  // Tồn kho: MỘT trang mặt hàng theo ô tìm + nhóm + điều kiện — máy chủ lọc, đếm, cắt trang.
  // Lượt gọi mới nhất thắng: gõ tìm / đổi trang nhanh thì response về muộn của lượt cũ không được đè.
  const qTon = q.trim();
  const luotTon = useRef(0);
  const load = useCallback(() => {
    const luot = ++luotTon.current;
    setLoading(true);
    api.kho.phieu
      .tonNhom(token, { kho_id: khoId, page, size: pageSize, q: qTon, nhom, ...JSON.parse(khoaLocTon) })
      .then((r) => {
        if (luot !== luotTon.current) return;
        setLots(r.items);
        setTonTotal(r.total);
        setDemNhom(r.dem);
        setCoHsd(r.co_hsd);
        setMucTheo(mucTheoKhoa(r.nhom));
        setDuBaoOk(r.du_bao_ok);
        setChiThanhPham(!!r.chi_thanh_pham);
        setError(null);
      })
      .catch((e) => {
        if (luot === luotTon.current) setError(e instanceof ApiError ? e.message : "Không tải được tồn kho.");
      })
      .finally(() => {
        if (luot === luotTon.current) setLoading(false);
      });
  }, [token, khoId, page, pageSize, qTon, nhom, khoaLocTon]);

  // Phiếu của tab đang xem. Tab Tồn kho không nạp phiếu.
  const qPK = q.trim();
  const luotPhieu = useRef(0);
  const loadVouchers = useCallback(() => {
    if (tab === "ton") return;
    const luot = ++luotPhieu.current;
    setLoadingV(true);
    api.kho.phieu
      .list(token, {
        kho_id: khoId,
        q: qPK || null,
        loc: { nhom: tab, man: "ton", ...JSON.parse(khoaLocPK) },
        page,
        size: pageSize,
      })
      .then((r) => {
        if (luot !== luotPhieu.current) return;
        setVouchers(r.items);
        setVTotal(r.total);
        setError(null);
      })
      .catch((e) => {
        if (luot === luotPhieu.current) setError(e instanceof ApiError ? e.message : "Không tải được phiếu kho.");
      })
      .finally(() => {
        if (luot === luotPhieu.current) setLoadingV(false);
      });
  }, [token, khoId, tab, qPK, khoaLocPK, page, pageSize]);

  // Gõ tìm → chờ 300ms rồi mới hỏi máy chủ. Chỉ chờ khi Ô TÌM vừa đổi: mở màn, đổi tab, đổi trang,
  // đổi bộ lọc thì hỏi ngay — trước đây mọi lần nạp đều đứng chờ 300ms vô cớ.
  const qTonTruoc = useRef(qTon);
  useEffect(() => {
    if (tab !== "ton") return;
    if (qTonTruoc.current === qTon) {
      load();
      return;
    }
    qTonTruoc.current = qTon;
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load, qTon, tab]);
  const qPKTruoc = useRef(qPK);
  useEffect(() => {
    if (tab === "ton") return;
    if (qPKTruoc.current === qPK) {
      loadVouchers();
      return;
    }
    qPKTruoc.current = qPK;
    const t = setTimeout(loadVouchers, 300);
    return () => clearTimeout(t);
  }, [loadVouchers, qPK, tab]);

  const groups = useMemo<MaterialGroup[]>(() => gomNhomTon(lots, mucTheo), [lots, mucTheo]);
  const tenTrung = useMemo(() => tenTrungLap(groups), [groups]);

  // Dòng dự báo → dòng thời gian + "Đề nghị mua" của ngăn chi tiết và form mua. CHỈ phần trình bày; phán quyết
  // "Cần mua" và chip Tình trạng của dòng là của máy chủ (`g.muc`).
  // Phán quyết của ngăn (Cần mua / vượt tối đa) GHI ĐÈ bằng của máy chủ để ngăn không bao giờ lệch chip ở dòng;
  // phần còn lại của `tinhDuBao` (dòng thời gian, số thiếu, đề nghị mua) chỉ để trình bày.
  const duBaoCua = (g: MaterialGroup): DuBao | null => {
    if (!g.muc?.du_bao) return null;
    const d = tinhDuBao(g.total, g.muc.du_bao, nguongCua(g));
    const tt = g.muc.tinh_trang;
    return {
      ...d,
      canMua: g.muc.can_mua,
      trangThai: g.muc.can_mua ? "can_mua" : tt === "vuot" || tt === "se_vuot" ? "vuot" : "du",
      mocVuot: tt === "vuot" ? "nay" : tt === "se_vuot" && d.mocVuot !== "nay" ? d.mocVuot : null,
    };
  };

  // Dựng lại MỘT nhóm tồn từ khoá mặt hàng (`"giay:12"` hoặc `"giay:12:780:905"`), không phụ thuộc trang
  // đang xem: dùng khi tem QR trỏ tới mặt hàng nằm ngoài trang, và khi làm tươi popup lịch sử của
  // mặt hàng đã trôi khỏi trang.
  const napNhomTheoKhoa = useCallback(async (key: string): Promise<MaterialGroup | null> => {
    const [loai, id] = key.split(":");
    if ((loai !== "giay" && loai !== "vat_tu") || !/^\d+$/.test(id ?? "")) return null;
    const r = await api.kho.phieu.tonNhom(token, {
      kho_id: khoId, page: 1, size: 200, hang_loai: loai, hang_id: Number(id),
    });
    const gs = gomNhomTon(r.items, mucTheoKhoa(r.nhom));
    return gs.find((x) => x.key === key) ?? gs.find((x) => `${x.hang_loai}:${x.hang_id}` === key) ?? null;
  }, [token, khoId]);

  // Deep-link tem QR: khi có khoá mặt hàng (`"giay:12"`) + tồn đã tải → bung drawer đúng mặt hàng (1 lần
  // cho mỗi khoá, ref chặn mở lại sau khi người dùng đóng). Mặt hàng ngoài trang đang xem thì hỏi riêng.
  const deepLinkedId = useRef<string | null>(null);
  useEffect(() => {
    if (!openMatHangKey || deepLinkedId.current === openMatHangKey || loading) return;
    // Tem QR ký theo MÃ (`giay:12`) — giấy tách nhiều dòng theo khổ thì mở dòng đầu của mã.
    const g = groups.find((x) => x.key === openMatHangKey)
      ?? groups.find((x) => `${x.hang_loai}:${x.hang_id}` === openMatHangKey);
    deepLinkedId.current = openMatHangKey;
    if (g) {
      setOpenMaterial(g);
      return;
    }
    napNhomTheoKhoa(openMatHangKey).then((n) => n && setOpenMaterial(n)).catch(() => {});
  }, [openMatHangKey, groups, loading, napNhomTheoKhoa]);

  // Phiếu / điều chuyển / điều chỉnh vừa đổi số tồn: popup lịch sử đang mở mà mặt hàng không còn nằm trong
  // trang thì nhóm giữ trong state đã cũ — dựng lại từ máy chủ. (Còn trong trang thì `groups` đã tươi.)
  useEffect(() => {
    if (!openMaterial || matTick === 0 || groups.some((g) => g.key === openMaterial.key)) return;
    napNhomTheoKhoa(openMaterial.key).then((n) => n && setOpenMaterial(n)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matTick]);



  function toggleSel(g: MaterialGroup) {
    setChon((prev) => {
      const next = new Map(prev);
      if (next.has(g.key)) next.delete(g.key);
      else next.set(g.key, g);
      return next;
    });
  }
  // Dòng đã chọn, lấy bản MỚI NHẤT nếu còn nằm trong trang (tồn có thể đổi sau khi nạp lại).
  const chonDs = () => [...chon.values()].map((g) => groups.find((x) => x.key === g.key) ?? g);
  const tatCaTrang = groups.length > 0 && groups.every((g) => chon.has(g.key));
  function toggleTrang() {
    setChon((prev) => {
      const next = new Map(prev);
      if (tatCaTrang) for (const g of groups) next.delete(g.key);
      else for (const g of groups) next.set(g.key, g);
      return next;
    });
  }
  const xoaLocTon = () => {
    setQ("");
    setNhom("all");
    setLocMan({ ...locMan, ton: LOC_TON_TRONG, ky: { loai: "tat_ca", moc: "nhap" } });
  };


  // "Tạo yêu cầu mua" mở form Tạo yêu cầu mua hàng ở màn Yêu cầu mua hàng, ĐÃ điền sẵn từng dòng —
  // cùng đường seed Kế hoạch vật tư đang đi, không dựng form mua thứ hai ở màn kho. Người lập vẫn là
  // người bấm Lưu: số đề nghị chỉ là đề xuất, còn phải làm tròn theo ram / kiện.
  //
  // Số đề nghị = (Tối đa, trống thì Tối thiểu) − Dự kiến; Dự kiến đã trừ lệnh sắp lĩnh và cộng hàng
  // đang về nên phần đã có đơn mua đang về không bị đặt trùng. Phép tính ghi vào ghi chú dòng để
  // người duyệt thấy số từ đâu ra. Ngày cần hàng = mốc sớm nhất rơi dưới ngưỡng.
  function moFormMua(gs: MaterialGroup[]) {
    if (gs.length === 0) return;
    const homNay = todayISO();
    const dongs = gs.map((g) => ({ g, dk: tinhDuBao(g.total, g.muc?.du_bao ?? undefined, nguongCua(g)) }));
    const ngayCan = dongs.map(({ dk }) => ngayCanMua(dk, homNay)).sort()[0] ?? homNay;
    navigate("yeu-cau-mua-hang", {
      purchaseSeedLines: dongs.map(({ g, dk }) => ({
        hang_loai: g.hang_loai,
        hang_id: g.hang_id,
        item_name: g.name ?? g.code ?? "",
        unit: g.dvtCode ?? "",
        quantity: dk.deNghi,
        note: dk.dich?.day && dk.thieu > 0
          // Số mua để đỡ điểm thấp nhất (tồn thủng trước khi hàng về), không phải để về Tối đa.
          ? `Tồn thấp nhất ${fmtQty(dk.thapNhat)} dưới tối thiểu ${fmtQty(dk.thieu)}`
          : dk.dich && dk.dich.nhan !== "Thiếu"
          ? `${dk.dich.nhan} ${fmtQty(dk.dich.so)} trừ Dự kiến ${fmtQty(dk.duKien)}`
          : dk.deNghi > 0 ? `Lệnh sắp lĩnh vượt tồn ${fmtQty(dk.deNghi)}` : null,
        // Giấy tờ: nhóm tồn đã tách theo khổ ⇒ khổ cần = khổ của nhóm.
        kho_rong: g.khoRong,
        kho_dai: g.khoDai,
      })),
      purchaseSeedPurpose: `Bổ sung tồn ${ten} dưới mức tối thiểu`,
      purchaseSeedHeader: { source_type: "kho", loai_mua: "mua_ton", needed_date: ngayCan },
    });
  }

  // Chọn nhiều dòng để lập yêu cầu mua (ô Yêu cầu mua hàng) hoặc in tem / điều chuyển (ô Kho).
  const selectable = canCreate || coTheMua;
  const cotTonDs = COT_TON.filter(
    (c) => (c.key !== "chon" || selectable) && (c.key !== "hsd" || coHsd) && (c.key !== "giatri" || canViewCost));
  const cotTon = luoiTon.rongHien(luoiTon.xep(cotTonDs).filter((c) => !luoiTon.an.has(c.key)));
  const cotPhieuDs = COT_PHIEU
    .filter((c) => c.key !== "giavon" || canViewCost)
    .map((c) => (c.key === "ngaypx" ? { ...c, label: NHAN_NGAY_PHIEU[tab] ?? c.label } : c));
  const cotPhieu = luoiPhieu.rongHien(luoiPhieu.xep(cotPhieuDs).filter((c) => !luoiPhieu.an.has(c.key)));

  // Hàng lọc nhanh của bảng tồn — số do máy chủ đếm trên tập đã lọc bởi ô tìm, kỳ Nhập và các khoảng; bỏ riêng bộ lọc nhóm (không theo trang).
  const mucTon: { key: NhomTon; label: string; count: number; mau?: MauTT }[] = [
    { key: "all", label: "Tất cả", count: demNhom.all },
    { key: "can_mua", label: chiThanhPham ? "Cần sản xuất" : "Cần mua", count: demNhom.can_mua, mau: "cam" },
    { key: "du_ton", label: "Vượt tối đa", count: demNhom.du_ton, mau: "xanh" },
    { key: "chuakhai", label: "Chưa đặt mức", count: demNhom.chuakhai, mau: "xam" },
    ...(demNhom.sap_het_han > 0 || nhom === "sap_het_han"
      ? [{ key: "sap_het_han" as const, label: "Sắp hết hạn", count: demNhom.sap_het_han, mau: "vang" as const }]
      : []),
  ];
  // Nhóm cũng có mặt trong nút Lọc (đọc/ghi chính `nhom`, không đẻ state thứ hai).
  const dkTon: DieuKien<LocTonKho>[] = [
    dkTheoTab<LocTonKho>({
      tabs: mucTon.map((m) => ({ id: m.key, nhan: m.label, so: m.count })),
      tatCa: "all", dang: nhom, dat: (id) => chonNhom(id as NhomTon), nhan: "Nhóm",
    }),
    ...dieuKienTon,
  ];
  // Nhóm đang mở popup lịch sử, lấy bản MỚI NHẤT (sau ghi sổ / điều chỉnh `load()` dựng lại nhóm).
  const matMo = openMaterial ? groups.find((g) => g.key === openMaterial.key) ?? openMaterial : null;
  const nutQr = (g: MaterialGroup) => void printMaterialQr(token, khoId, g.hang_loai, g.hang_id, g.code, g.name);

  return (
    <main className="rc kho-list lds">
      <header className="lds-dau">
        <h1 className="lds-dau__ten">{ten}</h1>
        {ma && <span className="tkh-the">{ma}</span>}
        <div className="kho-shell__fns" role="tablist" aria-label="Tồn kho và phiếu kho" style={{ margin: 0 }}>
          {(
            [
              ["ton", "Tồn kho"],
              ["nhap", "Phiếu nhập"],
              ["xuat", "Phiếu xuất"],
              ["dc", "Điều chuyển"],
            ] as const
          ).filter(([id]) => !(AN_DIEU_CHUYEN && id === "dc")).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`kho-shell__fn${tab === id ? " is-active" : ""}`}
              onClick={() => chonTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <section className="lds-loc">
        {tab === "ton" && <LocNhanhTrangThai muc={mucTon} dang={nhom} onChon={(k) => chonNhom(k as NhomTon)} ariaLabel="Lọc nhanh theo mức tồn" />}
        {/* Đang tick chọn: hàng công cụ nhường chỗ cho thao tác trên các dòng đã chọn (băng chọn đen cũ). */}
        {tab === "ton" && selectable && chon.size > 0 ? (
          <div className="lds-loc__thanh lds-loc__chon" role="region" aria-label="Mặt hàng đã chọn">
            <span>Đã chọn {chon.size} mặt hàng</span>
            <button type="button" className="lds-btn" onClick={() => setChon(new Map())}>Bỏ chọn</button>
            <div className="lds-loc__phai">
              {!AN_DIEU_CHUYEN && canCreate && khoOptions.filter((w) => w.id !== khoId).length > 0 && (
                <button type="button" className="lds-btn" onClick={() => setDcBulkOpen(true)}>
                  <ArrowLeftRight size={14} aria-hidden="true" />Điều chuyển
                </button>
              )}
              {chon.size === 1 && (
                <button type="button" className="lds-btn" onClick={() => nutQr(chonDs()[0])}>
                  <QrCode size={14} aria-hidden="true" />In tem QR
                </button>
              )}
              {/* Thành phẩm thiếu thì sản xuất chứ không mua — chỉ mua được các dòng không phải thành phẩm. */}
              {coTheMua && chonDs().some((g) => !g.muc?.la_thanh_pham) && (
                <Button variant="accent" onClick={() => moFormMua(chonDs().filter((g) => !g.muc?.la_thanh_pham))}>
                  <ShoppingCart size={14} aria-hidden="true" />Tạo yêu cầu mua
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="lds-loc__thanh tl-thanh" role="search">
            <OTim
              value={q}
              onChange={datQ}
              placeholder={tab === "ton" ? "Tìm mã, tên vật tư" : "Tìm số phiếu, mã yêu cầu, vật tư"}
              ariaLabel={tab === "ton" ? "Tìm vật tư trong kho" : "Tìm phiếu kho"}
            />
            {tab === "ton" ? (
              <ThanhLoc
                ky={kyTon}
                moc={MOC_TON_KHO}
                onKy={(ky) => setLocMan({ ...locMan, ky })}
                dieuKien={dkTon}
                loc={locMan.ton}
                onLoc={(ton) => setLocMan({ ...locMan, ton })}
              />
            ) : (
              <ThanhLoc
                ky={kyPhieu}
                moc={MOC_PHIEU_KHO}
                onKy={(ky) => setLocMan({ ...locMan, ky })}
                dieuKien={dieuKienPK}
                loc={locMan.loc}
                onLoc={(loc) => setLocMan({ ...locMan, loc })}
              />
            )}
            {tab === "ton"
              ? <ChonCot cot={cotTonDs} {...luoiTon.chonCot} />
              : <ChonCot cot={cotPhieuDs} {...luoiPhieu.chonCot} />}
          </div>
        )}
      </section>

      <div className="lds-sheet">
        {tab === "ton" ? (
          <CuonLuoi ghim={luoiTon.soGhim(cotTon)}>
            <table className="lds-g" style={{ minWidth: rongLuoi(cotTon) }}>
              <colgroup>
                {cotTon.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
              </colgroup>
              <thead>
                <tr>
                  {cotTon.map((c) => (
                    <th key={c.key} className={c.n ? "n" : c.key === "chon" ? "c" : undefined} title={c.tip}>
                      {c.key === "chon" ? (
                        <input
                          type="checkbox"
                          className="lds-cb"
                          aria-label="Chọn tất cả mặt hàng trên trang"
                          checked={tatCaTrang}
                          onChange={toggleTrang}
                        />
                      ) : (
                        <>
                          {c.label}
                          {luoiTon.keo(c.key)}
                        </>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && groups.length === 0 ? (
                  <DongTrongLds colSpan={cotTon.length} trangThai="dang-tai" />
                ) : error ? (
                  <tr>
                    <td colSpan={cotTon.length} className="lds-trong">
                      <span className="lds-do">{error}</span>{" "}
                      <button type="button" className="lds-lk" onClick={load}>Thử lại</button>
                    </td>
                  </tr>
                ) : groups.length === 0 ? (
                  <tr>
                    <td colSpan={cotTon.length} className="lds-trong">
                      {demNhom.all === 0 && !qTon && !coLocTon
                        ? "Kho này chưa có hàng. Hàng sẽ xuất hiện sau khi ghi sổ phiếu nhập."
                        : "Không có vật tư nào khớp điều kiện đang lọc."}{" "}
                      {(qTon || coLocTon) && (
                        <button type="button" className="lds-lk" onClick={xoaLocTon}>Xoá bộ lọc</button>
                      )}
                    </td>
                  </tr>
                ) : (
                  groups.map((g) => (
                    <MaterialRow
                      key={g.key}
                      g={g}
                      cot={cotTon}
                      hienMa={!!g.code && !!g.name && tenTrung.has(g.name)}
                      checked={chon.has(g.key)}
                      dangMo={openMaterial?.key === g.key}
                      onToggleSel={() => toggleSel(g)}
                      onOpen={() => setOpenMaterial(g)}
                      threshold={nguongCua(g)}
                      canSetThreshold={canSetThreshold}
                      onSetThreshold={setNguongFor}
                    />
                  ))
                )}
              </tbody>
            </table>
          </CuonLuoi>
        ) : (
          <CuonLuoi ghim={luoiPhieu.soGhim(cotPhieu)}>
            <table className="lds-g" style={{ minWidth: rongLuoi(cotPhieu) }}>
              <colgroup>
                {cotPhieu.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
              </colgroup>
              <thead>
                <tr>{cotPhieu.map((c) => <th key={c.key} className={c.n ? "n" : undefined}>{c.label}{luoiPhieu.keo(c.key)}</th>)}</tr>
              </thead>
              <tbody>
                {loadingV && vouchers.length === 0 ? (
                  <DongTrongLds colSpan={cotPhieu.length} trangThai="dang-tai" />
                ) : error ? (
                  <tr>
                    <td colSpan={cotPhieu.length} className="lds-trong">
                      <span className="lds-do">{error}</span>{" "}
                      <button type="button" className="lds-lk" onClick={loadVouchers}>Thử lại</button>
                    </td>
                  </tr>
                ) : vouchers.length === 0 ? (
                  <tr>
                    <td colSpan={cotPhieu.length} className="lds-trong">
                      {!coLocPK && !qPK
                        ? "Chưa có phiếu kho nào ở kho này. Phiếu được lập từ một yêu cầu đã duyệt."
                        : "Không có phiếu nào khớp điều kiện đang lọc."}{" "}
                      {(coLocPK || qPK !== "") && (
                        <button
                          type="button"
                          className="lds-lk"
                          onClick={() => {
                            setQ("");
                            setLocMan(LOC_MAN_PK_TRONG);
                          }}
                        >
                          Xoá bộ lọc
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  vouchers.map((v) => {
                    const moPhieu = () =>
                      v.dieu_chuyen
                        ? v.loai === "NHAP"
                          ? setOpenTransfer(v.request_id) // nhập-đích: request_id CHÍNH là DC đích
                          : openTransferByVoucher(v.id) // xuất-nguồn: hỏi BE tra DC đích
                        : setOpenVoucher(v.id);
                    return (
                      <tr
                        key={v.id}
                        className={`lds-dong${openVoucher === v.id ? " is-chon" : ""}`}
                        tabIndex={0}
                        onClick={moPhieu}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            moPhieu();
                          }
                        }}
                      >
                        {cotPhieu.map((c) => (
                          <OPhieu key={c.key} cot={c.key} v={v} tab={tab} onMoYeuCau={setOpenRequest} />
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </CuonLuoi>
        )}
        {/* Máy chủ cắt trang cả hai tab: `tong` = số mặt hàng (tab Tồn kho) hoặc số phiếu khớp lọc. */}
        {!error && (tab === "ton" ? tonTotal : vTotal) > 0 && (
          <PhanTrangDayDu trang={page} size={pageSize} tong={tab === "ton" ? tonTotal : vTotal}
            soDong={tab === "ton" ? groups.length : vouchers.length}
            onTrang={setPage} onSize={(n) => { setPageSize(n); setPage(1); }}
            loading={tab === "ton" ? loading : loadingV}
            donVi={tab === "ton" ? "vật tư" : "phiếu"}
            ariaLabel={tab === "ton" ? "Phân trang tồn kho" : "Phân trang phiếu kho"} />
        )}
      </div>

      {openMaterial && (
        // Popup lịch sử Nhập/Xuất của 1 vật tư. Bấm mã lô / số phiếu bên trong → mở VoucherDrawer
        // (render SAU khối này nên chồng lên trên). Vẫn giữ "bấm mã lô ra phiếu".
        <MaterialHistoryDrawer
          key={`mat-${openMaterial.key}`}
          token={token}
          khoId={khoId}
          khoTen={ten}
          // Đọc lại nhóm MỚI theo khoá: sau ghi sổ / điều chỉnh `load()` dựng lại nhóm, ảnh chụp lúc
          // bấm mở sẽ giữ lô cũ.
          material={matMo ?? openMaterial}
          threshold={nguongCua(matMo ?? openMaterial)}
          canViewCost={canViewCost}
          canSetThreshold={canSetThreshold}
          coTheMua={coTheMua}
          duBao={duBaoCua(matMo ?? openMaterial)}
          duRow={(matMo ?? openMaterial).muc?.du_bao ?? undefined}
          duBaoLoi={duBaoOk ? null : "Không tải được dự báo tồn."}
          onMua={() => moFormMua([openMaterial])}
          onDatNguong={() => setNguongFor(openMaterial)}
          onXemDonMua={can("thu_mua", "read") ? (ma) => navigate("mua-hang", { focusRequestCode: ma }) : undefined}
          refreshTick={matTick}
          // Kho ĐÍCH khi điều chuyển = mọi kho khác kho hiện tại.
          khoDich={khoOptions.filter((w) => w.id !== khoId)}
          onOpenVoucher={setOpenVoucher}
          onOpenTransfer={openTransferByVoucher}
          // Điều chuyển xong TRỪ TỒN NGUỒN NGAY → nạp lại tồn + phiếu để bảng phản ánh tức thì.
          onDieuChuyenDone={() => {
            load();
            loadVouchers();
            setMatTick((t) => t + 1);
          }}
          onClose={() => setOpenMaterial(null)}
          onAnhChanged={(hl, hid, url) =>
            setLots((prev) =>
              prev.map((l) =>
                l.hang_loai === hl && l.hang_id === hid ? { ...l, hang_anh: url } : l,
              ),
            )
          }
        />
      )}

      {openVoucher != null && (
        <VoucherDrawer
          key={`v-${openVoucher}`}
          token={token}
          voucherId={openVoucher}
          canCreate={canCreate}
          canPost={canPost}
          canViewCost={canViewCost}
          onClose={() => setOpenVoucher(null)}
          onChanged={() => {
            loadVouchers();
            load();
            setMatTick((t) => t + 1);   // popup Lịch sử mặt hàng (nếu đang mở) nạp lại tồn ngay
          }}
        />
      )}

      {openTransfer != null && (
        <TransferDrawer
          key={`tr-${openTransfer}`}
          token={token}
          requestId={openTransfer}
          canCreate={canCreate}
          canViewCost={canViewCost}
          onClose={() => setOpenTransfer(null)}
          onChanged={() => {
            loadVouchers();
            load();
            setMatTick((t) => t + 1);   // popup Lịch sử mặt hàng (nếu đang mở) nạp lại tồn ngay
          }}
        />
      )}

      {openRequest != null && (
        // Chỉ ĐỌC: mở yêu cầu gốc từ mã "Theo yêu cầu". Lập phiếu vẫn làm ở Hộp yêu cầu, nên
        // canCreate=false (ẩn nút Lập phiếu / Tiếp nhận / Chuẩn bị).
        <InboxRequestDrawer
          key={`req-${openRequest}`}
          token={token}
          khoId={khoId}
          requestId={openRequest}
          canCreate={false}
          canViewStock={canViewStock}
          canViewCost={canViewCost}
          onClose={() => setOpenRequest(null)}
          onCreateVoucher={() => {}}
        />
      )}

      {nguongFor && (
        // Hộp đặt ngưỡng cho 1 dòng (mở từ bảng, ngăn, chip). Lưu xong cập nhật thresholds tại chỗ
        // → cột So với ngưỡng, Dự kiến, nhóm lọc và ngăn đang mở đổi ngay.
        <HopNguong
          key={`ng-${nguongFor.key}`}
          token={token}
          khoId={khoId}
          khoTen={ten}
          dong={{
            hang_loai: nguongFor.hang_loai,
            hang_id: nguongFor.hang_id,
            goc: nguongFor.goc,
            khoRong: nguongFor.khoRong,
            khoDai: nguongFor.khoDai,
            ten: nguongFor.name ?? nguongFor.code ?? "vật tư",
            nhanKho: nhanTonNhom(nguongFor),
            dvt: nguongFor.dvt ?? "",
            ton: nguongFor.total,
          }}
          hienTai={nguongCua(nguongFor)}
          duKien={nguongFor.muc?.du_kien ?? null}
          // Số đếm nhóm (Cần mua, Chưa đặt mức…) do máy chủ tính theo ngưỡng ⇒ nạp lại sau khi lưu.
          onSaved={(t) => {
            setThresholds((prev) => ({
              ...prev,
              [khoaNguong({ hang_loai: nguongFor.hang_loai, hang_id: nguongFor.hang_id, kho_rong: nguongFor.khoRong, kho_dai: nguongFor.khoDai, don_vi_goc: nguongFor.goc })]: t,
            }));
            load();
          }}
          onClose={() => setNguongFor(null)}
        />
      )}

      {dcBulkOpen && (
        <DieuChuyenDialog
          token={token}
          khoNguonId={khoId}
          khoNguonTen={ten}
          khoDich={khoOptions.filter((w) => w.id !== khoId)}
          items={chonDs().map((g) => dcItemTu(g, g.total))}
          onDone={() => {
            setDcBulkOpen(false);
            setChon(new Map());
            load();
            loadVouchers();
          }}
          onCancel={() => setDcBulkOpen(false)}
        />
      )}
    </main>
  );
}


// In tem QR cho MỘT vật tư ở MỘT kho. Mã QR trỏ TRANG TRA KHO CÔNG KHAI qua token đã KÝ
// (`#s=<token>`) — quét KHÔNG cần đăng nhập và KHÔNG dò id tuần tự được (services/qr_token).
// Dùng chung cho nút QR trên từng hàng Tồn kho VÀ nút "In tem" trong drawer → tem giống hệt.
async function printMaterialQr(
  authToken: string,
  khoId: number,
  hangLoai: HangLoai,
  hangId: number,
  code?: string | null,
  name?: string | null,
) {
  // Mở cửa sổ NGAY trong nhịp click (tránh popup-blocker chặn sau await); điền nội dung sau.
  const w = window.open("", "_blank", "width=460,height=600");
  if (!w) return;
  w.document.write(
    `<!doctype html><meta charset="utf-8"><title>Tem QR</title>` +
      `<body style="font-family:system-ui,sans-serif;text-align:center;padding:48px;color:#64748b">Đang tạo tem…</body>`,
  );
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
  try {
    // Lấy token đã ký từ server (cần đăng nhập — người in tem luôn đang đăng nhập).
    const { token } = await api.kho.phieu.qrToken(authToken, khoId, hangLoai, hangId);
    const url = `${window.location.origin}/#s=${token}`;
    // border 4 = quiet-zone chuẩn (đủ khoảng trắng để máy quét bắt được, kể cả khi in nhỏ).
    const svg = qrToSvg(url, { border: 4 });
    const c = esc(code ?? "");
    const n = esc(name ?? "");
    w.document.open();
    w.document.write(
      `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Tem QR ${c || n}</title>` +
        `<style>*{box-sizing:border-box}body{font-family:'Be Vietnam Pro',system-ui,sans-serif;margin:0;padding:24px;text-align:center;color:#0f172a}` +
        `.card{display:inline-block;border:1px solid #cbd5e1;border-radius:12px;padding:20px 24px}` +
        `.code{font-size:22px;font-weight:800;letter-spacing:.5px}.name{font-size:14px;color:#475569;margin:4px 0 14px;max-width:280px}` +
        `svg{width:280px;height:280px}.hint{font-size:11px;color:#94a3b8;margin-top:10px}</style></head>` +
        `<body><div class="card"><div class="code">${c}</div><div class="name">${n}</div>${svg}` +
        `<div class="hint">Quét để xem lô &amp; vị trí trong kho</div></div>` +
        `<script>window.onload=function(){window.focus();window.print()}</script></body></html>`,
    );
    w.document.close();
  } catch {
    w.document.open();
    w.document.write(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui,sans-serif;text-align:center;padding:48px;color:#c5400a">` +
        `Không tạo được tem QR. Đóng cửa sổ này và thử lại.</body>`,
    );
    w.document.close();
  }
}

export function MaterialRow({
  g,
  cot,
  hienMa = false,
  checked,
  dangMo,
  onToggleSel,
  onOpen,
  threshold,
  canSetThreshold,
  onSetThreshold,
}: {
  g: MaterialGroup;
  cot: CotKho[];
  /** Có dòng khác cùng tên (thành phẩm hai khách trùng tên) ⇒ kèm mã để phân biệt. */
  hienMa?: boolean;
  checked: boolean;
  /** Dòng đang mở ở popup lịch sử — viền đủ bốn cạnh. */
  dangMo: boolean;
  onToggleSel: () => void;
  onOpen: () => void;
  threshold: StockThreshold | undefined;
  canSetThreshold: boolean;
  onSetThreshold: (g: MaterialGroup) => void;
}) {
  const newest = g.lots.length ? g.lots[g.lots.length - 1].ngay_nhap : null;
  const viMore = g.viTris.length - 1;
  const min = threshold?.nguong_ton ?? null;
  const max = threshold?.nguong_toi_da ?? null;
  // Cần mua, chip Tình trạng và các số dự báo đều do máy chủ trả (`g.muc`); ở đây chỉ trình bày.
  const muc = g.muc;
  const tt = chipTinhTrang(muc);
  // Số 0 để gạch mờ — cột Sắp xuất / Sắp về phần lớn trống, in "0" khắp nơi chỉ thêm nhiễu. null = dự báo
  // chưa dùng được lúc này.
  const soPhu = (n: number | null | undefined) =>
    n == null ? <span className="lds-mu3" title="Dự báo chưa dùng được">…</span>
      : n === 0 ? <span className="lds-mu3">–</span> : fmtQty(n);
  const duKien = muc?.du_kien ?? null;
  const lopDk = duKien == null ? undefined : muc?.duoi_cuoi ? "tkh-do" : max != null && duKien > max ? "tkh-cam" : undefined;
  const chan = (e: ReactMouseEvent) => e.stopPropagation();

  const o = (c: CotKho) => {
    switch (c.key) {
      case "chon":
        return (
          <td key={c.key} className="c" onClick={chan}>
            <input
              type="checkbox"
              className="lds-cb"
              aria-label={`Chọn ${g.name ?? g.code ?? ""}`}
              checked={checked}
              onChange={onToggleSel}
            />
          </td>
        );
      case "vattu":
        // Chỉ tên; mã nằm ở ô tìm kiếm và đầu ngăn, khổ và ĐVT ở cột riêng. Riêng khi hai dòng
        // trùng tên (thành phẩm của hai khách) thì kèm mã mờ, không thì kho không biết dòng nào của ai.
        return (
          <td key={c.key} title={[g.name, g.code].filter(Boolean).join(" ")}>
            <div className="tkh-vt">
              <span className="tkh-vt__ten">{g.name ?? g.code ?? "—"}</span>
              {hienMa && <span className="lds-mu3">{g.code}</span>}
            </div>
          </td>
        );
      case "kho":
        return (
          <td key={c.key}>
            {g.hang_loai === "giay" ? nhanKho(g.khoRong, g.khoDai) : <span className="lds-mu3">–</span>}
          </td>
        );
      case "dl":
        return <td key={c.key} className="n">{muc?.dinh_luong ?? <span className="lds-mu3">–</span>}</td>;
      case "dvt":
        return <td key={c.key}>{g.dvt ?? <span className="lds-mu3">–</span>}</td>;
      case "nhap":
        return <td key={c.key}>{newest == null ? <span className="lds-mu3">–</span> : fmtDateISO(newest)}</td>;
      case "vitri":
        // Chip kệ mới nhập gần nhất + "+N" (rê chuột thấy đủ).
        return (
          <td key={c.key} title={g.viTris.length ? g.viTris.join(", ") : undefined}>
            {g.viTris.length === 0 ? (
              <span className="lds-mu3">Chưa gắn</span>
            ) : (
              <div className="kho-loc-cell">
                {g.viTris.slice(0, 1).map((v) => (
                  <span key={v} className="kho-badge-loc" title={v}>
                    {v}
                  </span>
                ))}
                {viMore > 0 ? <span className="kho-loc-cell__more">+{viMore}</span> : null}
              </div>
            )}
          </td>
        );
      case "hsd": {
        // Đỏ khi có lô CÒN TỒN đã quá hạn (hsdSoonest tính từ lô sl_con_lai>0).
        const quaHan = g.hsdSoonest != null && g.hsdSoonest < todayISO();
        return (
          <td key={c.key} className={quaHan ? "lds-do" : undefined}
            title={g.hsdSoonest && g.hsdOthers ? `Còn ${g.hsdOthers} hạn khác` : undefined}>
            {g.hsdSoonest == null ? (
              <span className="lds-mu3">–</span>
            ) : (
              <>
                {fmtDateISO(g.hsdSoonest)}
                {quaHan && <span className="lds-tag">Quá hạn</span>}
                {g.hsdOthers > 0 ? <span className="lds-u">+{g.hsdOthers}</span> : null}
              </>
            )}
          </td>
        );
      }
      case "co":
        return (
          <td key={c.key} className="n">
            {fmtQty(g.total)}
          </td>
        );
      case "quykg":
        // Cuộn đã đếm kg ⇒ máy chủ trả null, để trống.
        return <td key={c.key} className="n">{muc?.quy_kg == null ? <span className="lds-mu3">–</span> : fmtKg(muc.quy_kg)}</td>;
      // Phép tính: Đang có − Sắp xuất + Sắp về = Dự kiến còn.
      case "sapxuat":
        return <td key={c.key} className="n">{soPhu(muc?.can_lenh)}</td>;
      case "sapve":
        return <td key={c.key} className="n">{soPhu(muc?.dang_ve)}</td>;
      case "dukien":
        return (
          <td key={c.key} className="n">
            {duKien == null ? soPhu(null) : <span className={lopDk}>{fmtQty(duKien)}</span>}
          </td>
        );
      case "giatri":
        return (
          <td key={c.key} className="n">
            <GiaTriTon value={g.value} chuaGiaGoc={g.chuaGiaGoc} />
          </td>
        );
      case "mucton":
        // Thước mảnh có số hai đầu; bấm để sửa. Chưa đặt thì nút viền đứt ngay trong ô.
        return (
          <td key={c.key}>
            {min != null ? (
              <div
                {...(canSetThreshold
                  ? { role: "button", tabIndex: 0, title: "Sửa mức tồn", className: "tkh-tm-nut",
                    onClick: (e: ReactMouseEvent) => { e.stopPropagation(); onSetThreshold(g); } }
                  : {})}>
                <ThuocMuc ton={g.total} duKien={duKien} min={min} max={max} fmt={fmtQty} />
              </div>
            ) : canSetThreshold ? (
              <button type="button" className="tkh-dat" onClick={(e) => { e.stopPropagation(); onSetThreshold(g); }}>
                <Gauge aria-hidden="true" />Đặt mức
              </button>
            ) : (
              <span className="lds-mu3">Chưa đặt</span>
            )}
          </td>
        );
      case "tinhtrang":
        return <td key={c.key}>{tt && <span className={`tkh-chip tkh-chip--${tt.lop}`}>{tt.nhan}</span>}</td>;
      default:
        return <td key={c.key} />;
    }
  };

  return (
    <tr
      className={`lds-dong${dangMo ? " is-chon" : ""}`}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {cot.map(o)}
    </tr>
  );
}

/** Ô của lưới Phiếu nhập / Phiếu xuất. */
function OPhieu({ cot, v, tab, onMoYeuCau }: {
  cot: string;
  v: StockVoucher;
  tab: TonTab;
  onMoYeuCau: (requestId: number) => void;
}) {
  switch (cot) {
    case "ma":
      return (
        <td title={v.ma}>
          {v.ma}
          {tab === "dc" && <span className="lds-tag">{v.loai === "XUAT" ? "Chuyển đi" : "Nhận về"}</span>}
        </td>
      );
    case "ngay":
      return <td title={fmtDateTime(v.created_at)}>{fmtDate(v.created_at)}</td>;
    case "ngaypx":
      return <td>{fmtDateISO(v.ngay)}</td>;
    case "yeucau":
      return (
        <td title={v.request_ma ?? undefined}>
          {v.request_ma ? (
            <CodeLink code={v.request_ma} onOpen={() => onMoYeuCau(v.request_id)} />
          ) : (
            <span className="lds-mu3">—</span>
          )}
        </td>
      );
    case "mathang":
      return <td className="n">{v.lines.length}</td>;
    case "tongsl":
      return <td className="n">{fmtQty(v.lines.reduce((s, l) => s + l.so_luong, 0))}</td>;
    case "giavon":
      return (
        <td className="n">
          {v.gia_von === 0 && v.lines.some((l) => l.chua_gia_goc) ? (
            <NhanChuaGiaGoc />
          ) : v.gia_von != null ? (
            soVN(v.gia_von)
          ) : (
            ""
          )}
        </td>
      );
    case "tt":
      return <td><ChipTrangThaiPhieu status={v.trang_thai} /></td>;
    case "nguoi":
      return <td title={v.nguoi_lap_ten ?? undefined}>{v.nguoi_lap_ten ?? "—"}</td>;
    default:
      return <td />;
  }
}

/** Ô HSD của một lô — dùng chung cho cả tab Nhập và Xuất.
 *
 *  Quá hạn thì tô đỏ + có `title`: cột hạn dùng mà không cảnh báo thì chỉ là thêm một cột chữ,
 *  trong khi đúng thứ thủ kho cần biết là "lô này còn dùng được không". Lô không khai HSD (bản
 *  kẽm, giấy…) vẫn hiện "—" mờ như cũ — phần lớn vật tư in không có hạn. */
function HsdCell({ hsd }: { hsd: string | null | undefined }) {
  if (!hsd) return <td className="lds-mu">—</td>;
  const quaHan = hsd < todayISO();
  return (
    <td
      className={quaHan ? "lds-do" : undefined}
      title={quaHan ? "Đã quá hạn" : undefined}
    >
      {fmtDateISO(hsd)}
    </td>
  );
}

function MaterialHistoryDrawer({
  token,
  khoId,
  khoTen,
  material,
  threshold,
  canViewCost,
  canSetThreshold,
  coTheMua,
  duBao,
  duRow,
  duBaoLoi,
  khoDich,
  refreshTick,
  onOpenVoucher,
  onOpenTransfer,
  onDieuChuyenDone,
  onMua,
  onDatNguong,
  onXemDonMua,
  onClose,
  onAnhChanged,
}: {
  token: string;
  khoId: number;
  khoTen: string;
  material: MaterialGroup;
  threshold: StockThreshold | undefined;
  canViewCost: boolean;
  canSetThreshold: boolean;
  /** Lập được yêu cầu mua hàng (Xem + Thao tác ở màn Yêu cầu mua hàng). */
  coTheMua: boolean;
  /** Dự báo của dòng này (null = chưa tải xong). */
  duBao: DuBao | null;
  duRow: DuBaoTonRow | undefined;
  duBaoLoi: string | null;
  /** Kho ĐÍCH khả dĩ khi điều chuyển (đã loại kho hiện tại). Rỗng → ẩn nút "Chuyển kho". */
  khoDich: { id: number; ma: string; ten: string }[];
  /** Cha bump khi phiếu đổi (điều chỉnh/ghi sổ) → ngăn nạp lại tồn + lịch sử ngay, khỏi reload. */
  refreshTick?: number;
  onOpenVoucher: (voucherId: number) => void;
  /** Bấm phiếu ở tab "Lịch sử chuyển kho" → mở mặt tiền PHIẾU ĐIỀU CHUYỂN (không phải mẫu nhập/xuất). */
  onOpenTransfer: (voucherId: number) => void;
  /** Điều chuyển thành công → cha nạp lại tồn + phiếu (tồn nguồn đã bị trừ ngay). */
  onDieuChuyenDone: () => void;
  /** Mở ngăn Yêu cầu mua (chồng lên ngăn này) cho đúng mặt hàng này. */
  onMua: () => void;
  onDatNguong: () => void;
  /** Mở màn Mua hàng đúng đơn (undefined = không có quyền xem màn đó). */
  onXemDonMua?: (ma: string) => void;
  onClose: () => void;
  /** Đổi/gỡ ảnh xong → báo cha cập nhật `hang_anh` mọi lô cùng mặt hàng (mở lại không bị ảnh cũ). */
  onAnhChanged: (hangLoai: HangLoai, hangId: number, url: string | null) => void;
}) {
  useNapTenDonVi(); // nạp nhãn đơn vị (danh mục) để ghi rõ đơn vị ở các bảng lịch sử
  const [data, setData] = useState<StockMaterialHistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ảnh minh hoạ mặt hàng: thêm/đổi/xoá ngay trong Tổng quan. Cho ai LẬP PHIẾU KHO (`kho.create`)
  // hoặc sửa DANH MỤC (`dm_giay`/`dm_vat_tu` update) — khớp guard ở backend.
  const can = useCan();
  const canEditAnh =
    can("kho", "create") ||
    can(material.hang_loai === "giay" ? "dm_giay" : "dm_vat_tu", "update");
  // Điều chuyển kho: quyền lập phiếu kho + phải có kho đích. Trừ tồn nguồn NGAY (mở dialog xác nhận).
  const canCreate = can("kho", "create");
  const [dcOpen, setDcOpen] = useState(false);
  // Lô giấy CŨ chưa có dạng/khổ: kho bổ sung ngay tại tab "Lô tồn".
  const [bsLot, setBsLot] = useState<StockLot | null>(null);
  const [tab, setTab] = useState<"tong_quan" | "lo_ton" | "nhap" | "xuat" | "chuyen">("tong_quan");
  const [page, setPage] = useState(1);

  // In tem = hàm dùng chung (giống nút In tem QR ở băng chọn của bảng). Tự lấy token ký rồi in.
  function printQr() {
    void printMaterialQr(token, khoId, material.hang_loai, material.hang_id, material.code, material.name);
  }

  const DRAWER_PAGE = 10;
  // Tab Tổng quan cần số trên tab + tồn thực có ⇒ hỏi trang đầu của Lô tồn (nhẹ nhất). Bấm sang
  // Lô tồn trang 1 thì trùng khoá ⇒ không hỏi lại.
  const tabNap: TabLichSuMatHang = tab === "tong_quan" ? "lo_ton" : tab;
  // Đúng một dòng tồn: giấy theo khổ + đơn vị gốc, vật tư khác theo đơn vị gốc (khổ 0).
  const giay = coDonViGoc(material.hang_loai) ? { goc: material.goc, kho_rong: material.khoRong, kho_dai: material.khoDai } : undefined;
  const khoaNap = JSON.stringify([material.hang_loai, material.hang_id, khoId, giay, tabNap, page, refreshTick]);
  const khoaDaNap = useRef<string | null>(null);
  useEffect(() => {
    if (khoaDaNap.current === khoaNap) return;
    let alive = true;
    setLoading(true);
    api.kho.phieu
      .lichSuTrang(token, material.hang_loai, material.hang_id, khoId, tabNap, page, DRAWER_PAGE, giay)
      .then((d) => {
        if (!alive) return;
        khoaDaNap.current = khoaNap;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (alive) setError(e instanceof ApiError ? e.message : "Không tải được lịch sử.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // `refreshTick` nằm trong `khoaNap`: cha bump sau khi phiếu đổi (điều chỉnh / ghi sổ) → tồn +
    // lịch sử nạp lại NGAY, không bắt đóng mở lại ngăn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [khoaNap, token]);

  // Đơn vị GỐC của mã hàng (ram/tờ…) — nhãn cho MỌI số theo đơn vị lô (SL nhập/xuất/chuyển).
  // Cột "SL yêu cầu" thì theo đơn vị NGƯỜI XIN (dvt_yeu_cau, có thể khác) — ghi riêng từng dòng.
  const dvtGoc = tenDonVi(data?.dvt) ?? data?.dvt ?? "";
  const dvtYeuCau = (ma?: string | null) => (ma ? tenDonVi(ma) ?? ma : dvtGoc);
  // Trang đang bày — chỉ lấy khi đúng tab (đang chờ trang tab mới thì bảng cũ không lẫn sang).
  const trang = data && data.tab === tabNap ? data : null;
  const dem = data?.dem;
  const loTonPaged = trang?.tab === "lo_ton" ? trang.lo : [];
  const nhapPaged = trang?.tab === "nhap" ? trang.lo : [];
  const xuatPaged = trang?.xuat ?? [];
  const chuyenPaged = trang?.chuyen ?? [];
  // Lô còn tồn (FIFO) cho Tổng quan + đầu ngăn = lô của dòng trên bảng (đã nạp sẵn, cha nạp lại sau
  // mỗi lần phiếu đổi) — không cần hỏi lại máy chủ.
  const loTon = material.lots;
  // Thành phẩm: lô mang nguồn (lệnh / đơn / khách, đọc ở lô gốc nên sống qua điều chuyển) + giá bán
  // từ đơn. Giấy, vật tư không có nguồn ⇒ không bày hai cột này.
  const loTrang = trang?.lo ?? [];
  const coNguon = loTrang.some((l) => l.order_ma || l.lsx_ma);
  const coGiaBan = canViewCost && loTrang.some((l) => l.don_gia_ban != null);
  const choTab = loading && !trang;

  const dvt = material.dvt ?? dvtGoc;
  const nhan = nhanTonNhom(material);
  const tabs = [
    { id: "tong_quan", nhan: "Tổng quan" },
    { id: "lo_ton", nhan: "Lô tồn", dem: dem?.lo_ton },
    { id: "nhap", nhan: "Lịch sử nhập", dem: dem?.nhap },
    { id: "xuat", nhan: "Lịch sử xuất", dem: dem?.xuat },
    ...(AN_DIEU_CHUYEN ? [] : [{ id: "chuyen", nhan: "Lịch sử chuyển kho", dem: dem?.chuyen }]),
  ];
  // Chip đầu ngăn = đúng chip cột Tình trạng của dòng trên bảng.
  const tt = chipTinhTrang(material.muc);

  return (
    <>
      <NganPhai
        duongDan={<span>{khoTen}</span>}
        tieuDe={
          <span className="tkh-ngan-tieu">
            <AnhMatHang token={token} hangLoai={material.hang_loai} hangId={material.hang_id}
              ten={material.name ?? material.code ?? ""} anh={material.anh} canEdit={canEditAnh}
              onChanged={(url) => onAnhChanged(material.hang_loai, material.hang_id, url)} />
            {material.name ?? material.code ?? "—"}
          </span>
        }
        the={
          <>
            {tt && (tt.lop === "chua" && canSetThreshold ? (
              <button type="button" className="tkh-chip tkh-chip--chua tkh-chip--bam" onClick={onDatNguong} title="Đặt mức tồn">{tt.nhan}</button>
            ) : (
              <span className={`tkh-chip tkh-chip--${tt.lop}`}>{tt.nhan}</span>
            ))}
            {duBao && duBao.tre.length > 0 && (
              <span className="tkh-chip tkh-chip--tre">{duBao.tre.length} việc trễ hẹn</span>
            )}
          </>
        }
        phuDe={
          <>
            {material.code && <span className="tkh-goi">{material.code}</span>}
            {nhan && <span className="tkh-the">{nhan}</span>}
            {material.viTris.slice(0, 3).map((v) => <span key={v} className="tkh-the">{v}</span>)}
          </>
        }
        hanhDong={
          <>
            {!AN_DIEU_CHUYEN && canCreate && khoDich.length > 0 && material.total > 0 && (
              <button type="button" className="tkh-btn" onClick={() => setDcOpen(true)}>
                <ArrowLeftRight aria-hidden="true" />Chuyển kho
              </button>
            )}
            <button type="button" className="tkh-btn" onClick={printQr}>
              <Printer aria-hidden="true" />In tem kệ
            </button>
            {coTheMua && !material.muc?.la_thanh_pham && (
              <button type="button" className="tkh-btn" onClick={onMua}>
                <ShoppingCart aria-hidden="true" />Tạo yêu cầu mua
              </button>
            )}
          </>
        }
        tabs={tabs}
        tab={tab}
        onTab={(id) => {
          setTab(id as typeof tab);
          setPage(1); // mỗi tab phân trang riêng
        }}
        // Ngăn phiếu (VoucherDrawer…) mở chồng lên theo khuôn cũ: Esc là của nó, đừng đóng ngăn này.
        onDong={() => {
          if (document.querySelector(".rc-drawer__scrim")) return;
          onClose();
        }}
      >
          {error && (
            <div className="banner banner--error" role="alert">
              <span>{error}</span>
            </div>
          )}
          {tab === "tong_quan" ? (
            <TongQuanTon
              token={token}
              mh={{
                hang_loai: material.hang_loai,
                hang_id: material.hang_id,
                ten: material.name ?? material.code ?? "—",
                dvt,
                ton: material.total,
                giaTri: material.value,
                goc: material.goc,
                khoRong: material.khoRong,
                khoDai: material.khoDai,
                laThanhPham: !!material.muc?.la_thanh_pham,
              }}
              loTon={loTon}
              th={threshold}
              duBao={duBao}
              duRow={duRow}
              loiDuBao={duBaoLoi}
              canSetThreshold={canSetThreshold}
              canViewCost={canViewCost}
              coTheMua={coTheMua}
              onMua={onMua}
              onDatNguong={onDatNguong}
              onXemDonMua={onXemDonMua}
              onOpenVoucher={onOpenVoucher}
            />
          ) : choTab ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <span key={i} className="rc-skel" style={{ width: `${90 - i * 12}%` }} />
              ))}
            </div>
          ) : tab === "lo_ton" ? (
            !dem?.lo_ton ? (
              <p className="kho-hint">Không còn lô nào tồn cho vật tư này.</p>
            ) : (
              <div className="lds-bang">
                {/* minWidth = cột cố định + 140 cho Vị trí: chật hơn thân ngăn thì khung cuộn ngang chứ không ép Vị trí về 0. */}
                <table className="lds-g" style={{ minWidth: 120 + 100 + (coNguon ? 170 : 0) + 120 + (material.hang_loai === "giay" ? 110 + 150 : 0) + 100 + (canViewCost ? 110 : 0) + (coGiaBan ? 110 : 0) + (canViewCost ? 110 : 0) + 140 }}>
                  <colgroup>
                    <col style={{ width: 120 }} />
                    <col style={{ width: 100 }} />
                    {coNguon && <col style={{ width: 170 }} />}
                    <col style={{ width: 120 }} />
                    {material.hang_loai === "giay" && <col style={{ width: 110 }} />}
                    {material.hang_loai === "giay" && <col style={{ width: 150 }} />}
                    <col />
                    <col style={{ width: 100 }} />
                    {canViewCost && <col style={{ width: 110 }} />}
                    {coGiaBan && <col style={{ width: 110 }} />}
                    {canViewCost && <col style={{ width: 110 }} />}
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Phiếu</th>
                      <th>Ngày nhập</th>
                      {coNguon && <th>Đơn và khách</th>}
                      <th className="n">Còn lại</th>
                      {material.hang_loai === "giay" && <th className="n">Quy kg</th>}
                      {material.hang_loai === "giay" && <th>Dạng / khổ</th>}
                      <th>Vị trí</th>
                      <th>HSD</th>
                      {canViewCost && <th className="n">Đơn giá</th>}
                      {coGiaBan && <th className="n">Giá bán</th>}
                      {canViewCost && <th className="n">Giá trị</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {loTonPaged.map((lot) => (
                      <tr key={lot.id}>
                        <td>
                          {lot.voucher_id != null ? (
                            <CodeLink
                              code={lot.voucher_ma ?? lot.ma_lo}
                              onOpen={() => onOpenVoucher(lot.voucher_id!)}
                            />
                          ) : (
                            "Đầu kỳ"
                          )}
                        </td>
                        <td>{fmtDateISO(lot.ngay_nhap)}</td>
                        {coNguon && <NguonLoCell lot={lot} />}
                        <td className="n">{`${fmtQty(lot.sl_con_lai)} ${dvtGoc}`.trim()}</td>
                        {material.hang_loai === "giay" && (
                          <td className="n">{lot.quy_kg == null ? "—" : fmtKg(lot.quy_kg)}</td>
                        )}
                        {material.hang_loai === "giay" && (
                          <td>
                            {nhanKho(lot.kho_rong, lot.kho_dai)}
                            {!lot.kho_rong && canCreate && (
                              <button type="button" className="kho-bsdk__nut" onClick={() => setBsLot(lot)}>
                                Bổ sung khổ
                              </button>
                            )}
                          </td>
                        )}
                        <td>{lot.vi_tri ?? "—"}</td>
                        <HsdCell hsd={lot.hsd} />
                        {canViewCost && <GiaGocCell lot={lot} />}
                        {coGiaBan && (
                          <td className="n">{lot.don_gia_ban != null ? money(lot.don_gia_ban) : "—"}</td>
                        )}
                        {canViewCost && (
                          <td className="n">
                            {loChuaGiaGoc(lot) ? "—" : money(Math.round(lot.sl_con_lai * (lot.don_gia_nhap ?? 0)))}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : tab === "nhap" ? (
            !dem?.nhap ? (
              <p className="kho-hint">Chưa có lô nhập nào cho vật tư này.</p>
            ) : (
              <div className="lds-bang">
                <table className="lds-g" style={{ minWidth: 120 + 100 + (coNguon ? 170 : 0) + 120 + 120 + 100 + (canViewCost ? 110 : 0) + (coGiaBan ? 110 : 0) + 140 }}>
                  <colgroup>
                    <col style={{ width: 120 }} />
                    <col style={{ width: 100 }} />
                    {coNguon && <col style={{ width: 170 }} />}
                    <col style={{ width: 120 }} />
                    <col style={{ width: 120 }} />
                    <col />
                    <col style={{ width: 100 }} />
                    {canViewCost && <col style={{ width: 110 }} />}
                    {coGiaBan && <col style={{ width: 110 }} />}
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Phiếu</th>
                      <th>Ngày nhập</th>
                      {coNguon && <th>Đơn và khách</th>}
                      {/* SL yêu cầu (số đã xin trên yêu cầu sinh ra lô) đứng TRƯỚC SL nhập thực tế. */}
                      <th className="n">SL yêu cầu</th>
                      <th className="n">SL nhập</th>
                      <th>Vị trí</th>
                      <th>HSD</th>
                      {canViewCost && <th className="n">Đơn giá</th>}
                      {coGiaBan && <th className="n">Giá bán</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {nhapPaged.map((lot) => (
                      <tr key={lot.id}>
                        {/* Lô hiển thị theo MÃ PHIẾU nhập (đi theo phiếu) — bấm mở phiếu. Đầu kỳ = không có phiếu. */}
                        <td>
                          {lot.voucher_id != null ? (
                            <CodeLink
                              code={lot.voucher_ma ?? lot.ma_lo}
                              onOpen={() => onOpenVoucher(lot.voucher_id!)}
                            />
                          ) : (
                            "Đầu kỳ"
                          )}
                        </td>
                        <td>{fmtDateISO(lot.ngay_nhap)}</td>
                        {coNguon && <NguonLoCell lot={lot} />}
                        <td className="n">
                          {lot.sl_de_nghi != null
                            ? `${fmtQty(lot.sl_de_nghi)} ${dvtYeuCau(lot.dvt_yeu_cau)}`.trim()
                            : "—"}
                        </td>
                        <td className="n">{`${fmtQty(lot.sl_ban_dau)} ${dvtGoc}`.trim()}</td>
                        {/* Vị trí là dữ liệu ĐÃ CHỐT sau ghi sổ → CHỈ hiển thị, không cho sửa. */}
                        <td>{lot.vi_tri ?? "—"}</td>
                        <HsdCell hsd={lot.hsd} />
                        {canViewCost && <GiaGocCell lot={lot} />}
                        {coGiaBan && (
                          <td className="n">{lot.don_gia_ban != null ? money(lot.don_gia_ban) : "—"}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : tab === "xuat" ? (
            !dem?.xuat ? (
            <p className="kho-hint">Chưa có lần xuất nào cho vật tư này.</p>
          ) : (
            <div className="lds-bang">
              <table className="lds-g">
                <colgroup>
                  <col style={{ width: 130 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 120 }} />
                  <col />
                  <col style={{ width: 100 }} />
                  {canViewCost && <col style={{ width: 120 }} />}
                </colgroup>
                <thead>
                  <tr>
                    {/* Số phiếu ĐỨNG TRƯỚC ngày, đúng thứ tự tab Nhập — mở drawer là mắt rơi vào
                        cùng một chỗ dù đang ở tab nào. */}
                    <th>Số phiếu</th>
                    <th>Ngày xuất</th>
                    {/* SL yêu cầu (số đã xin trên yêu cầu sinh ra dòng xuất) đứng TRƯỚC SL xuất thực tế. */}
                    <th className="n">SL yêu cầu</th>
                    <th className="n">SL xuất</th>
                    {/* Vị trí + HSD của LÔ đã xuất — cùng bộ cột với tab Nhập để mắt không phải
                        đổi chỗ khi bấm qua lại giữa hai tab. */}
                    <th>Vị trí</th>
                    <th>HSD</th>
                    {canViewCost && <th className="n">Giá vốn</th>}
                  </tr>
                </thead>
                <tbody>
                  {xuatPaged.map((r, i) => {
                    return (
                    <tr key={`${r.voucher_id}-${r.lot_id}-${i}`}>
                      <td>
                        <CodeLink
                          code={r.voucher_ma ?? "—"}
                          onOpen={() => onOpenVoucher(r.voucher_id)}
                        />
                      </td>
                      <td>{fmtDateISO(r.ngay)}</td>
                      <td className="n">
                        {r.sl_de_nghi != null
                          ? `${fmtQty(r.sl_de_nghi)} ${dvtYeuCau(r.dvt_yeu_cau)}`.trim()
                          : "—"}
                      </td>
                      <td className="n">{`${fmtQty(r.so_luong)} ${dvtGoc}`.trim()}</td>
                      <td>{r.vi_tri ?? "—"}</td>
                      <HsdCell hsd={r.hsd} />
                      {canViewCost && (
                        <td className="n">
                          {r.chua_gia_goc ? (
                            <NhanChuaGiaGoc />
                          ) : r.don_gia != null ? (
                            money(Math.round(r.don_gia * r.so_luong))
                          ) : (
                            ""
                          )}
                        </td>
                      )}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
          ) : !dem?.chuyen ? (
            <p className="kho-hint">Chưa có lần chuyển kho nào cho vật tư này.</p>
          ) : (
            <div className="kho-lines__wrap">
              <table className="kho-lines">
                <thead>
                  <tr>
                    <th style={{ minWidth: 130 }}>Số phiếu</th>
                    <th style={{ width: 96 }}>Ngày</th>
                    <th style={{ minWidth: 100 }}>Chiều</th>
                    <th className="kho-num">Số lượng</th>
                    <th style={{ minWidth: 96 }}>Vị trí</th>
                    <th style={{ width: 96 }}>HSD</th>
                    {canViewCost && <th className="kho-num">Giá trị</th>}
                  </tr>
                </thead>
                <tbody>
                  {chuyenPaged.map((r) => (
                    <tr key={r.key}>
                      <td className="kho-lines__code">
                        {r.voucher_id != null ? (
                          <CodeLink
                            code={r.voucher_ma ?? "—"}
                            onOpen={() => onOpenTransfer(r.voucher_id!)}
                          />
                        ) : (
                          r.voucher_ma ?? "—"
                        )}
                      </td>
                      <td className="kho-lines__code">{fmtDateISO(r.ngay)}</td>
                      {/* Chiều điều chuyển ở góc nhìn của KHO NÀY: nhận về (là kho đích) / chuyển đi
                          (là kho nguồn). Text tự rõ nghĩa nên giữ màu trung tính, không tô đỏ/xanh. */}
                      <td className="rc__nowrap">
                        <span style={{ fontSize: 12, color: "var(--ash)" }}>
                          {r.chieu === "in" ? "⇄ nhận về" : "⇄ chuyển đi"}
                        </span>
                      </td>
                      <td className="kho-num">{`${fmtQty(r.so_luong)} ${dvtGoc}`.trim()}</td>
                      <td className="kho-lines__vt">{r.vi_tri ?? "—"}</td>
                      <HsdCell hsd={r.hsd} />
                      {canViewCost && (
                        <td className="kho-num">
                          {r.chua_gia_goc ? (
                            <NhanChuaGiaGoc />
                          ) : r.don_gia != null ? (
                            money(Math.round(r.don_gia * r.so_luong))
                          ) : (
                            ""
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab !== "tong_quan" && (dem?.[tabNap] ?? 0) > DRAWER_PAGE && (
            <DrawerPager page={page} total={dem?.[tabNap] ?? 0} pageSize={DRAWER_PAGE} onPage={setPage} />
          )}
      </NganPhai>
    {bsLot && (
      <BoSungKhoDialog
        token={token}
        lot={bsLot}
        dvt={dvtGoc}
        onDone={() => {
          setBsLot(null);
          onDieuChuyenDone();
          onClose(); // dòng tồn đổi nhóm (chưa có khổ → có khổ) → đóng ngăn, cha nạp lại danh sách
        }}
        onCancel={() => setBsLot(null)}
      />
    )}
    {dcOpen && (
      <DieuChuyenDialog
        token={token}
        khoNguonId={khoId}
        khoNguonTen={khoTen}
        khoDich={khoDich}
        items={[dcItemTu(material, data?.on_hand ?? material.total)]}
        onDone={() => {
          setDcOpen(false);
          onDieuChuyenDone();
          onClose(); // tồn nguồn đã đổi → đóng ngăn, cha đã nạp lại danh sách
        }}
        onCancel={() => setDcOpen(false)}
      />
    )}
    </>
  );
}

// Kho bổ sung KHỔ cho một lô giấy chưa có khổ (nhập trước khi khai khổ). Chỉ ghi khổ — số lượng,
// đơn vị và giá của lô giữ nguyên: tờ và kg không quy đổi lẫn nhau nên không có gì để đổi.
function BoSungKhoDialog({
  token,
  lot,
  dvt,
  onDone,
  onCancel,
}: {
  token: string;
  lot: StockLot;
  dvt: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [rong, setRong] = useState("");
  const [dai, setDai] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const [r, d] = chuanKho(rong, dai);
    if (!(r > 0)) {
      setError("Nhập khổ (mm), ít nhất cạnh rộng.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.kho.phieu.boSungKhoLo(token, lot.id, { kho_rong: r, kho_dai: d });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không bổ sung được khổ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open
      title="Bổ sung khổ cho lô"
      confirmLabel="Lưu"
      cancelLabel="Hủy"
      busy={busy}
      error={error}
      onConfirm={() => void save()}
      onCancel={onCancel}
    >
      <div className="rc-grid">
        <p className="rc-field__hint">
          {`Lô ${lot.ma_lo} đang ghi ${fmtQty(lot.sl_con_lai)} ${dvt}.`.trim()}{" "}
          Chỉ ghi khổ, số lượng và đơn vị giữ nguyên. Chỉ có khổ rộng thì để trống ô dài.
        </p>
        <div className="rc-field">
          <span className="rc-field__label">Khổ</span>
          <div className="kho-bsdk__kho">
            <input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="rộng"
              aria-label="Cạnh rộng (mm)"
              value={rong}
              autoFocus
              onChange={(e) => setRong(e.target.value)}
            />
            <span>×</span>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="dài"
              aria-label="Cạnh dài (mm), để trống nếu chỉ có khổ rộng"
              value={dai}
              onChange={(e) => setDai(e.target.value)}
            />
            <span>mm</span>
          </div>
        </div>
      </div>
    </ConfirmDialog>
  );
}

// Dialog ĐIỀU CHUYỂN 1 mặt hàng sang kho khác. Trừ tồn nguồn NGAY khi xác nhận (tự lập + ghi sổ
// phiếu xuất), rồi sinh YÊU CẦU ĐIỀU CHUYỂN ở đích cho kho đích lập phiếu nhận. Tái dùng ConfirmDialog.
// 1 mặt hàng trong popup điều chuyển (dùng chung cho 1 mặt hàng ở drawer LẪN nhiều mặt hàng tick
// hàng loạt ở danh sách tồn).
interface DcItem {
  hang_loai: HangLoai;
  hang_id: number;
  /** Giấy: đơn vị gốc + khổ của dòng tồn — điều chuyển đúng nhóm lô đó. Hàng khác: "" · 0 · 0. */
  goc: string;
  khoRong: number;
  khoDai: number;
  ten: string;
  dvt: string;
  tonKhaDung: number;
}

/** Một dòng tồn → một dòng điều chuyển (tên kèm khổ để hai khổ cùng mã không đọc như trùng). */
function dcItemTu(g: MaterialGroup, tonKhaDung: number): DcItem {
  const kho = nhanTonNhom(g);
  const ten = g.name ?? g.code ?? "vật tư";
  return {
    hang_loai: g.hang_loai, hang_id: g.hang_id, goc: g.goc, khoRong: g.khoRong, khoDai: g.khoDai,
    ten: kho ? `${ten} · ${kho}` : ten, dvt: g.dvt ?? "", tonKhaDung,
  };
}

function DieuChuyenDialog({
  token,
  khoNguonId,
  khoNguonTen,
  khoDich,
  items,
  onDone,
  onCancel,
}: {
  token: string;
  khoNguonId: number;
  khoNguonTen: string;
  khoDich: { id: number; ma: string; ten: string }[];
  items: DcItem[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const keyOf = (it: DcItem) =>
    khoaTon({ hang_loai: it.hang_loai, hang_id: it.hang_id, don_vi_goc: it.goc, kho_rong: it.khoRong, kho_dai: it.khoDai });
  const [khoDenId, setKhoDenId] = useState<number | null>(null);
  // SL chuyển từng mặt hàng — mặc định = tồn khả dụng (chuyển hết), sửa được từng dòng.
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map((it) => [keyOf(it), it.tonKhaDung > 0 ? String(it.tonKhaDung) : ""]),
    ),
  );
  // Vị trí cất ở KHO ĐÍCH (kệ/ô) — tuỳ chọn, khai ngay lúc ấn; áp cho mọi lô của mặt hàng.
  const [viTri, setViTri] = useState<Record<string, string>>({});
  const [ghiChu, setGhiChu] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nhieu = items.length > 1;

  async function chuyen() {
    if (khoDenId == null) {
      setError("Chọn kho đích.");
      return;
    }
    const chosen: { it: DcItem; sl: number }[] = [];
    for (const it of items) {
      const sl = Number(qty[keyOf(it)]);
      if (!Number.isFinite(sl) || sl <= 0) continue;
      if (sl > it.tonKhaDung + 1e-9) {
        setError(`“${it.ten}” vượt tồn khả dụng (${fmtQty(it.tonKhaDung)} ${it.dvt}).`);
        return;
      }
      chosen.push({ it, sl });
    }
    if (chosen.length === 0) {
      setError("Nhập số lượng > 0 cho ít nhất 1 mặt hàng.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.kho.phieu.dieuChuyen(token, {
        kho_nguon_id: khoNguonId,
        kho_den_id: khoDenId,
        items: chosen.map((x) => ({
          hang_loai: x.it.hang_loai,
          hang_id: x.it.hang_id,
          ...(coDonViGoc(x.it.hang_loai) ? { don_vi_goc: x.it.goc, kho_rong: x.it.khoRong, kho_dai: x.it.khoDai } : {}),
          so_luong: x.sl,
          vi_tri: (viTri[keyOf(x.it)] ?? "").trim() || null,
        })),
        ghi_chu: ghiChu.trim() || null,
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không điều chuyển được.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open
      wide={nhieu}
      title={nhieu ? `Chuyển kho — ${items.length} mặt hàng` : `Chuyển kho — ${items[0]?.ten ?? "vật tư"}`}
      message={`Gộp vào MỘT yêu cầu điều chuyển sang kho đích. Tồn CHƯA đổi — chỉ trừ kho “${khoNguonTen}” và cộng kho đích KHI kho đích ghi sổ phiếu nhập.`}
      confirmLabel="Điều chuyển"
      cancelLabel="Hủy"
      busy={busy}
      error={error}
      confirmDisabled={khoDenId == null}
      onConfirm={() => void chuyen()}
      onCancel={onCancel}
    >
      <div className="rc-grid kho-setth">
        <div className="rc-field">
          <span className="rc-field__label">Từ kho (nguồn)</span>
          <input className="rc-input" value={khoNguonTen} disabled readOnly />
        </div>
        <div className="rc-field">
          <label className="rc-field__label" htmlFor="dc-kho-den">
            Đến kho (đích) <em>*</em>
          </label>
          <Select
            id="dc-kho-den"
            portal
            ariaLabel="Kho đích"
            placeholder="— Chọn kho đích —"
            value={khoDenId}
            onChange={(v) => setKhoDenId(v as number | null)}
            options={khoDich.map((w) => ({ value: w.id, label: w.ten, hint: w.ma }))}
          />
        </div>
      </div>

      {/* Khung ngoài `kho-dc-lines` giữ lề trên + cuộn ngang khi hộp hẹp (điện thoại); cột cố định cộng lại
          + 150 cho cột Vật tư, chật hơn thì khung ngoài cuộn. */}
      <div className="kho-dc-lines">
        <div className="lds-bang lds-bang--nhap">
        <table className="lds-g" style={{ minWidth: 150 + 110 + 110 + 170 }}>
          <colgroup>
            <col />
            <col style={{ width: 110 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 170 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Vật tư</th>
              <th className="n">Tồn khả dụng</th>
              <th className="n">SL chuyển</th>
              <th>Vị trí (kho đích)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const k = keyOf(it);
              return (
                <tr key={k}>
                  <td>{it.ten}</td>
                  <td className="n">
                    {fmtQty(it.tonKhaDung)} {it.dvt}
                  </td>
                  <td className="n">
                    <DecimalInput
                      className="rc-input kho-num"
                      value={qty[k] ? Number(qty[k]) : null}
                      allowNull
                      onChange={(n) => setQty((prev) => ({ ...prev, [k]: n == null ? "" : String(n) }))}
                      aria-label={`SL chuyển ${it.ten}`}
                    />
                  </td>
                  <td>
                    <input
                      className="rc-input"
                      value={viTri[k] ?? ""}
                      onChange={(e) => setViTri((prev) => ({ ...prev, [k]: e.target.value }))}
                      placeholder="kệ / ô… (tuỳ chọn)"
                      aria-label={`Vị trí ${it.ten}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      <div className="rc-field">
        <label className="rc-field__label" htmlFor="dc-ghichu">
          Ghi chú
        </label>
        <input
          id="dc-ghichu"
          className="rc-input"
          value={ghiChu}
          maxLength={1000}
          placeholder="Lý do / ghi chú điều chuyển (tuỳ chọn)"
          onChange={(e) => setGhiChu(e.target.value)}
        />
      </div>
    </ConfirmDialog>
  );
}

/** Ô nguồn lô thành phẩm: đơn (kèm lệnh) trên, khách dưới. Lô không nguồn ⇒ "—". */
function NguonLoCell({ lot }: { lot: StockLot }) {
  if (!lot.order_ma && !lot.lsx_ma) return <td className="lds-mu">—</td>;
  return (
    <td>
      {lot.order_ma}
      {lot.lsx_ma && <span className="lds-tag">{lot.lsx_ma}</span>}
      {lot.khach_hang && <span className="lds-u">{lot.khach_hang}</span>}
    </td>
  );
}

/** Lô thành phẩm KCS mà kế toán chưa gõ giá gốc — `don_gia_nhap` 0 là "chưa biết", không phải miễn phí. */
function loChuaGiaGoc(lot: StockLot | undefined): boolean {
  return !!lot?.tu_kcs && !lot.don_gia_nhap;
}

function NhanChuaGiaGoc() {
  return (
    <span className="badge-sem badge-sem--amber" title="Kế toán kho gõ ở Báo cáo kho › Giá gốc thành phẩm">
      Chưa có giá gốc
    </span>
  );
}

/** Ô đơn giá lô. Thành phẩm KCS còn giá gốc 0 ⇒ nhãn "Chưa có giá gốc" (kế toán gõ ở Báo cáo kho ›
 *  Giá gốc thành phẩm) thay vì in số 0 như thể hàng miễn phí. */
function GiaGocCell({ lot }: { lot: StockLot }) {
  if (loChuaGiaGoc(lot)) {
    return (
      <td className="n">
        <NhanChuaGiaGoc />
      </td>
    );
  }
  return <td className="n">{money(lot.don_gia_nhap ?? 0)}</td>;
}

/** Giá trị tồn của một mặt hàng. Lô KCS chưa có giá gốc đang cộng 0: chưa lô nào có giá thì ghi thẳng
 *  "Chưa có giá gốc"; có giá một phần thì in số kèm dòng nhắc là số chưa trọn. */
function GiaTriTon({ value, chuaGiaGoc }: { value: number; chuaGiaGoc: number }) {
  if (chuaGiaGoc > 0 && value === 0) return <NhanChuaGiaGoc />;
  return (
    <>
      {money(Math.round(value))}
      {chuaGiaGoc > 0 && (
        <div className="kho-hint kho-hint--xuong-dong">chưa gồm {chuaGiaGoc} lô chưa có giá gốc</div>
      )}
    </>
  );
}

// Phân trang cho bảng trong drawer Lịch sử Nhập/Xuất — cùng khung .kho-pager với màn Tồn kho.
function DrawerPager({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="kho-pager">
      <span className="kho-pager__page">{total} dòng</span>
      <div className="rc__spacer" />
      <button
        type="button"
        className="btn btn--ghost"
        disabled={page <= 1}
        onClick={() => onPage(Math.max(1, page - 1))}
      >
        Trước
      </button>
      <span className="kho-pager__page">
        Trang {page} / {maxPage}
      </span>
      <button
        type="button"
        className="btn btn--ghost"
        disabled={page >= maxPage}
        onClick={() => onPage(Math.min(maxPage, page + 1))}
      >
        Sau
      </button>
    </div>
  );
}
